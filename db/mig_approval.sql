-- =====================================================================
-- iCase · журнал карточек товаров и подтверждение создания/удаления управляющим
--  * каждое создание, удаление, отправка в архив/из архива, переименование товара попадает в журнал
--    (триггеры — значит и импорт, и выкуп, и приёмка, и любые другие пути);
--  * settings.approvals = {"productCreate":bool,"productDelete":bool} — включается в «Настройки → Магазин»;
--  * если включено, товар, заведённый кладовщиком (не владельцем/управляющим), ждёт подтверждения:
--    его можно принять на склад, но нельзя продать; удаление/архив кладовщиком — только через запрос;
--  * владелец или управляющий подтверждают, отклоняют или объединяют с существующей карточкой.
-- =====================================================================

alter table audit_log add column if not exists entity text, add column if not exists entity_id uuid;
create index if not exists audit_log_entity_idx on audit_log(entity, entity_id) where entity_id is not null;

alter table settings add column if not exists approvals jsonb not null default '{"productCreate":false,"productDelete":false}'::jsonb;

alter table products
  add column if not exists approval text check (approval in ('pending_create','pending_delete')),
  add column if not exists approval_by uuid references staff(id) on delete set null,
  add column if not exists approval_at timestamptz,
  add column if not exists approval_note text;
create index if not exists products_approval_idx on products(approval) where approval is not null;

create or replace function approvals_on(p_key text) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select (approvals->>p_key)::boolean from settings where id = 1), false)
$$;
create or replace function is_approver() returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is null or has_role('owner','manager')
$$;
create or replace function staff_name(p uuid) returns text language sql stable security definer set search_path=public as $$
  select coalesce((select full_name from staff where id = p), 'Сотрудник')
$$;

/* ---------- защита: подтверждение и запрет обхода ---------- */
create or replace function products_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare rpc boolean := coalesce(current_setting('icase.approval_rpc', true),'') = '1';
begin
  if tg_op = 'INSERT' then
    if not is_approver() and approvals_on('productCreate') then
      new.approval := 'pending_create'; new.approval_by := auth.uid(); new.approval_at := now();
    elsif not rpc and not is_approver() then
      new.approval := null; new.approval_by := null; new.approval_at := null;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if not rpc and not is_approver() then
      -- статус подтверждения меняется только функциями запроса/подтверждения
      new.approval := old.approval; new.approval_by := old.approval_by; new.approval_at := old.approval_at; new.approval_note := old.approval_note;
      if coalesce(old.is_archived,false) = false and new.is_archived and approvals_on('productDelete') then
        raise exception 'Отправка товара в архив требует подтверждения — нажмите «Запросить удаление»';
      end if;
    end if;
    return new;
  end if;
  -- DELETE
  if not rpc and not is_approver() and approvals_on('productDelete') then
    raise exception 'Удаление товара требует подтверждения — нажмите «Запросить удаление»';
  end if;
  return old;
end $$;
drop trigger if exists products_guard on products;
create trigger products_guard before insert or update or delete on products for each row execute function products_guard();

/* ---------- журнал ---------- */
create or replace function products_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log(staff_id, action, ref, details, entity, entity_id)
    values (auth.uid(), 'Товар создан', new.name,
      concat_ws(' · ', (select name from categories where id = new.category_id), case when new.price > 0 then round(new.price)::text || ' ₽' end,
        case when new.approval = 'pending_create' then 'ждёт подтверждения' end), 'product', new.id);
  elsif tg_op = 'DELETE' then
    insert into audit_log(staff_id, action, ref, details, entity, entity_id)
    values (auth.uid(), 'Товар удалён', old.name,
      case when old.approval = 'pending_delete' and old.approval_by is not null then 'по запросу: ' || staff_name(old.approval_by) end, 'product', old.id);
  else
    if new.is_archived is distinct from old.is_archived then
      insert into audit_log(staff_id, action, ref, details, entity, entity_id)
      values (auth.uid(), case when new.is_archived then 'Товар в архиве' else 'Товар возвращён из архива' end, new.name,
        case when old.approval = 'pending_delete' and old.approval_by is not null then 'по запросу: ' || staff_name(old.approval_by) end, 'product', new.id);
    end if;
    if new.name is distinct from old.name then
      insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Товар переименован', new.name, 'было: ' || old.name, 'product', new.id);
    end if;
    if new.category_id is distinct from old.category_id then
      insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Товар перенесён в категорию', new.name,
        coalesce((select name from categories where id = old.category_id),'—') || ' → ' || coalesce((select name from categories where id = new.category_id),'—'), 'product', new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists products_audit on products;
create trigger products_audit after insert or update of name, is_archived, category_id or delete on products for each row execute function products_audit();

-- цена — тоже со ссылкой на товар
create or replace function audit_price() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then insert into audit_log(action,ref,details,entity,entity_id) values ('Изменение цены',new.name,old.price||' → '||new.price,'product',new.id); end if;
  return new;
end $$;

/* ---------- неподтверждённый товар нельзя продать ---------- */
create or replace function sale_item_approved() returns trigger language plpgsql security definer set search_path=public as $$
declare n text;
begin
  if new.product_id is not null then
    select name into n from products where id = new.product_id and approval = 'pending_create';
    if found then raise exception 'Товар «%» ещё не подтверждён управляющим — продать его нельзя', n; end if;
  end if;
  return new;
end $$;
drop trigger if exists sale_item_approved on sale_items;
create trigger sale_item_approved before insert on sale_items for each row execute function sale_item_approved();

/* ---------- запрос на удаление (кладовщик) ---------- */
create or replace function product_request_delete(p_id uuid, p_note text default null) returns void language plpgsql security definer set search_path=public as $$
declare p products;
begin
  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права'; end if;
  select * into p from products where id = p_id for update;
  if not found then raise exception 'Товар не найден'; end if;
  if p.approval = 'pending_delete' then raise exception 'Запрос уже отправлен'; end if;
  if p.approval = 'pending_create' and p.approval_by = auth.uid() and not exists (select 1 from stock_movements where product_id = p_id) then
    perform set_config('icase.approval_rpc','1',true);
    delete from products where id = p_id;   -- свой неподтверждённый товар без движений можно убрать сразу
    return;
  end if;
  perform set_config('icase.approval_rpc','1',true);
  update products set approval = 'pending_delete', approval_by = auth.uid(), approval_at = now(), approval_note = nullif(trim(p_note),'') where id = p_id;
  insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Запрос на удаление товара', p.name, nullif(trim(p_note),''), 'product', p_id);
end $$;

create or replace function product_cancel_request(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare p products;
begin
  select * into p from products where id = p_id for update;
  if not found or p.approval is distinct from 'pending_delete' then raise exception 'Запроса нет'; end if;
  if p.approval_by is distinct from auth.uid() and not has_role('owner','manager') then raise exception 'Нет права'; end if;
  perform set_config('icase.approval_rpc','1',true);
  update products set approval = null, approval_by = null, approval_at = null, approval_note = null where id = p_id;
  insert into audit_log(staff_id, action, ref, entity, entity_id) values (auth.uid(), 'Запрос на удаление отозван', p.name, 'product', p_id);
end $$;

/* ---------- объединение карточек: всё с p_from переносится на p_into, p_from удаляется ---------- */
create or replace function product_merge(p_from uuid, p_into uuid) returns void language plpgsql security definer set search_path=public as $$
declare a products; b products; r record;
begin
  if not has_role('owner','manager') then raise exception 'Объединять товары могут владелец и управляющий'; end if;
  if p_from = p_into then raise exception 'Выберите другой товар'; end if;
  select * into a from products where id = p_from for update;
  select * into b from products where id = p_into for update;
  if a.id is null or b.id is null then raise exception 'Товар не найден'; end if;
  if coalesce(a.track_serial,false) <> coalesce(b.track_serial,false) then raise exception 'Нельзя объединить товар с IMEI и товар без IMEI'; end if;
  -- остатки складываются
  insert into stock(product_id, warehouse_id, qty) select p_into, warehouse_id, qty from stock where product_id = p_from
    on conflict (product_id, warehouse_id) do update set qty = stock.qty + excluded.qty;
  delete from stock where product_id = p_from;
  -- остальные ссылки — по внешним ключам
  for r in select c.conrelid::regclass tbl, a2.attname col from pg_constraint c join pg_attribute a2 on a2.attrelid = c.conrelid and a2.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'products'::regclass and c.conrelid <> 'stock'::regclass loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_into, p_from;
  end loop;
  perform set_config('icase.approval_rpc','1',true);
  delete from products where id = p_from;
  insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Товары объединены', b.name, 'перенесён «' || a.name || '»', 'product', p_into);
end $$;

/* ---------- решение владельца / управляющего ---------- */
create or replace function product_decide(p_id uuid, p_ok boolean, p_note text default null, p_merge_into uuid default null) returns text language plpgsql security definer set search_path=public as $$
declare p products; has_moves boolean; has_stock boolean; who text;
begin
  if not has_role('owner','manager') then raise exception 'Подтверждают владелец и управляющий'; end if;
  select * into p from products where id = p_id for update;
  if not found then raise exception 'Товар не найден'; end if;
  if p.approval is null then raise exception 'Товар не ждёт решения'; end if;
  who := staff_name(p.approval_by);
  has_moves := exists (select 1 from stock_movements where product_id = p_id) or exists (select 1 from sale_items where product_id = p_id) or exists (select 1 from units where product_id = p_id);
  has_stock := exists (select 1 from stock where product_id = p_id and qty <> 0) or exists (select 1 from units where product_id = p_id and status in ('in_stock','reserved','in_repair'));
  perform set_config('icase.approval_rpc','1',true);

  if p_merge_into is not null then
    perform product_merge(p_id, p_merge_into);
    return 'merged';
  end if;

  if p.approval = 'pending_create' then
    if p_ok then
      update products set approval = null, approval_note = null where id = p_id;
      insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Новый товар подтверждён', p.name, 'завёл: ' || who, 'product', p_id);
      return 'approved';
    end if;
    if has_stock then raise exception 'На складе есть остаток этого товара — объедините его с существующей карточкой'; end if;
    insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Новый товар отклонён', p.name, concat_ws(' · ', 'завёл: ' || who, nullif(trim(p_note),'')), 'product', p_id);
    if has_moves then update products set approval = null, is_archived = true where id = p_id; return 'archived'; end if;
    delete from products where id = p_id; return 'deleted';
  end if;

  -- pending_delete
  if not p_ok then
    update products set approval = null, approval_by = null, approval_at = null, approval_note = null where id = p_id;
    insert into audit_log(staff_id, action, ref, details, entity, entity_id) values (auth.uid(), 'Запрос на удаление отклонён', p.name, concat_ws(' · ', 'просил: ' || who, nullif(trim(p_note),'')), 'product', p_id);
    return 'kept';
  end if;
  if has_stock then raise exception 'На складе есть остаток — сначала спишите или переместите его'; end if;
  if has_moves then update products set is_archived = true, approval = null where id = p_id; return 'archived'; end if;
  delete from products where id = p_id; return 'deleted';
end $$;

revoke execute on function product_request_delete(uuid,text), product_cancel_request(uuid), product_merge(uuid,uuid), product_decide(uuid,boolean,text,uuid) from public, anon;
grant execute on function product_request_delete(uuid,text), product_cancel_request(uuid), product_merge(uuid,uuid), product_decide(uuid,boolean,text,uuid) to authenticated;
select refresh_col_grants();
