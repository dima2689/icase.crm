-- =====================================================================
-- iCase · продавец принимает товар на склады своей точки (включается в «Настройки → Магазин»)
--  * только приход (type = 'in'), только на склады своей точки, документ — свой черновик;
--  * закупочную цену продавец не видит и не вводит: строка берёт текущую себестоимость товара,
--    а владельцу/управляющему ставится задача проверить цены в приёмке;
--  * оплату поставщику при приёмке продавец не проводит (долг поставщику создаётся как обычно);
--  * новые товары, заведённые продавцом, подчиняются правилу подтверждения (approvals.productCreate).
-- =====================================================================

update settings set approvals = approvals || '{"sellerReceive":true}'::jsonb where not (approvals ? 'sellerReceive');
alter table settings alter column approvals set default '{"productCreate":false,"productDelete":false,"sellerReceive":true}'::jsonb;

create or replace function seller_receive_on() returns boolean language sql stable security definer set search_path=public as $$
  select has_role('seller') and approvals_on('sellerReceive')
$$;
-- склад принадлежит точке продавца
create or replace function seller_wh_ok(p_wh uuid) returns boolean language sql stable security definer set search_path=public as $$
  select p_wh is not null and exists (select 1 from warehouses w where w.id = p_wh and w.point_id = my_point())
$$;
create or replace function seller_doc_ok(p_doc uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from stock_docs d where d.id = p_doc and d.type = 'in' and d.status = 'draft' and d.created_by = auth.uid() and seller_wh_ok(d.wh_to))
$$;

/* ---------- права: старые роли + продавец при включённой настройке ---------- */
drop policy if exists w_prod_ins on products;
create policy w_prod_ins on products for insert with check ((select has_role('owner','manager','storekeeper')) or (select seller_receive_on()));

drop policy if exists w_docs_ins on stock_docs;
create policy w_docs_ins on stock_docs for insert with check ((select has_role('owner','manager','storekeeper'))
  or ((select seller_receive_on()) and type = 'in' and seller_wh_ok(wh_to) and created_by = (select auth.uid())));
drop policy if exists w_docs_del on stock_docs;
create policy w_docs_del on stock_docs for delete using ((select has_role('owner','manager','storekeeper'))
  or ((select seller_receive_on()) and type = 'in' and status = 'draft' and created_by = (select auth.uid())));

drop policy if exists w_doclines_ins on stock_doc_lines;
create policy w_doclines_ins on stock_doc_lines for insert with check ((select has_role('owner','manager','storekeeper')) or ((select seller_receive_on()) and seller_doc_ok(doc_id)));
drop policy if exists w_doclines_del on stock_doc_lines;
create policy w_doclines_del on stock_doc_lines for delete using ((select has_role('owner','manager','storekeeper')) or ((select seller_receive_on()) and seller_doc_ok(doc_id)));

/* продавец не проводит оплату поставщику и не привязывает заказ */
create or replace function stock_docs_seller_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if has_role('seller') then new.pay_account := null; new.po_id := null; end if;
  return new;
end $$;
drop trigger if exists stock_docs_seller_guard on stock_docs;
create trigger stock_docs_seller_guard before insert or update on stock_docs for each row execute function stock_docs_seller_guard();

/* ---------- проведение: продавцу — только свой приход; цены — из карточки ---------- */
create or replace function post_doc_seller_prep(p_doc uuid) returns void language plpgsql security definer set search_path=public as $$
declare d stock_docs; miss text;
begin
  select * into d from stock_docs where id = p_doc;
  -- закупочная цена: текущая себестоимость товара (продавец её не видит и не вводит)
  update stock_doc_lines l set cost = coalesce(nullif(p.cost,0), nullif(p.last_cost,0), 0),
    new_units = coalesce((select jsonb_agg(u - 'cost') from jsonb_array_elements(l.new_units) u), '[]'::jsonb)
  from products p where p.id = l.product_id and l.doc_id = p_doc;
  select string_agg(p.name, ', ') into miss from stock_doc_lines l join products p on p.id = l.product_id where l.doc_id = p_doc and l.cost = 0;
  insert into tasks(auto_key, title, due_date, note, ref_type, ref_id, point_id)
  values ('rcv-cost-' || d.num, 'Проверить закупочные цены в приёмке ' || d.num || ' (принял продавец)', current_date,
          case when miss is not null then 'Без закупочной цены: ' || miss else 'Цены взяты из карточек товаров' end, 'doc', d.id,
          (select point_id from warehouses where id = d.wh_to))
  on conflict (auto_key) do nothing;
end $$;
revoke execute on function post_doc_seller_prep(uuid) from public, anon, authenticated;

do $$ declare src text; begin
  src := pg_get_functiondef('post_doc(uuid)'::regprocedure);
  if position('seller_receive_on' in src) = 0 then
    src := replace(src,
      $a$  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права проводить документы'; end if;
  select * into d from stock_docs where id = p_doc for update;$a$,
      $b$  select * into d from stock_docs where id = p_doc for update;
  if not has_role('owner','manager','storekeeper') then
    if not (seller_receive_on() and d.type = 'in' and d.created_by = auth.uid() and seller_wh_ok(d.wh_to)) then raise exception 'Нет права проводить документы'; end if;
    if d.status = 'draft' then perform post_doc_seller_prep(p_doc); end if;
  end if;$b$);
    if position('seller_receive_on' in src) = 0 then raise exception 'post_doc: не найдено место для вставки'; end if;
    execute src;
  end if;
end $$;

select refresh_col_grants();
