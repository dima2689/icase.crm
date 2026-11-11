-- =====================================================================
-- iCase · предзаказы устройств
--  Клиент заказывает устройство, которого нет (или бронирует то, что есть), вносит предоплату.
--  Когда экземпляр приходит на склад, он автоматически резервируется за самым ранним предзаказом,
--  ставится задача «позвонить» и уведомление в очередь. При выдаче — продажа с зачётом предоплаты.
--  Отмена — возврат предоплаты (полностью или частично) и снятие резерва.
--  Деньги: предоплата и доплаты — cash_ops type 'prepay' с ref = № предзаказа; возврат — 'refund'.
--  В продаже предоплата отражается оплатой «Предоплата» (pay_method 'prepaid'), в кассу второй раз не идёт.
-- =====================================================================

alter type pay_method add value if not exists 'prepaid';

create sequence if not exists preorder_num_seq start 1001;
create table if not exists preorders (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'ПЗ-' || nextval('preorder_num_seq'),
  point_id uuid references points(id),
  customer_id uuid not null references customers(id),
  product_id uuid not null references products(id),
  unit_id uuid references units(id) on delete set null,
  price numeric(12,2) not null check (price >= 0),
  status text not null default 'waiting' check (status in ('waiting','arrived','done','cancelled')),
  due_date date, note text,
  sale_id uuid references sales(id) on delete set null,
  created_by uuid references staff(id) default auth.uid(), created_at timestamptz not null default now(),
  arrived_at timestamptz, closed_at timestamptz, closed_by uuid references staff(id), cancel_reason text
);
create index if not exists preorders_open_idx on preorders(product_id, created_at) where status in ('waiting','arrived');
create index if not exists preorders_customer_id_fk on preorders(customer_id);
create index if not exists preorders_unit_id_fk on preorders(unit_id);
create index if not exists preorders_sale_id_fk on preorders(sale_id);
create index if not exists preorders_point_id_fk on preorders(point_id);
alter table preorders enable row level security;
drop policy if exists staff_read on preorders;
create policy staff_read on preorders for select using ((select is_staff()));

create or replace function preorder_paid(p_num text) returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(amount),0) from cash_ops where ref = p_num and type in ('prepay','refund')
$$;

create or replace function preorder_cash(o preorders, p_type cashop_type, p_method pay_method, p_amount numeric, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare s uuid := current_shift(o.point_id); st settings;
begin
  if coalesce(p_amount,0) = 0 then return; end if;
  if p_method = 'prepaid' or p_method = 'debt' then raise exception 'Выберите способ оплаты'; end if;
  select * into st from settings where id = 1;
  if s is null and (st.require_shift or p_method = 'cash') then raise exception 'Откройте кассовую смену на точке'; end if;
  insert into cash_ops(shift_id, point_id, type, method, amount, ref, note) values (s, o.point_id, p_type, p_method, p_amount, o.num, p_note);
end $$;
revoke execute on function preorder_cash(preorders, cashop_type, pay_method, numeric, text) from public, anon, authenticated;

/* резерв: свободный экземпляр товара (предпочтительно на складах точки предзаказа) → предзаказ «пришёл» */
create or replace function preorder_try_reserve(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare o preorders; p products; u units; c customers;
begin
  select * into o from preorders where id = p_id for update;
  if o.status <> 'waiting' then return false; end if;
  select * into p from products where id = o.product_id;
  if p.track_serial then
    select un.* into u from units un left join warehouses w on w.id = un.warehouse_id
      where un.product_id = o.product_id and un.status = 'in_stock'
      order by (w.point_id is not distinct from o.point_id) desc, un.created_at limit 1 for update of un skip locked;
    if u.id is null then return false; end if;
    update units set status = 'reserved', last_ref = o.num where id = u.id;
    update preorders set status = 'arrived', unit_id = u.id, arrived_at = now() where id = o.id;
  else
    if coalesce((select sum(qty) from stock where product_id = o.product_id),0)
       - (select count(*) from preorders x where x.product_id = o.product_id and x.status = 'arrived') < 1 then return false; end if;
    update preorders set status = 'arrived', arrived_at = now() where id = o.id;
  end if;
  select * into c from customers where id = o.customer_id;
  insert into tasks(auto_key, title, due_date, note, customer_id, ref_type, ref_id, point_id)
  values ('po-arrived-' || o.num, 'Пришёл предзаказ ' || o.num || ': ' || p.name || ' — позвонить клиенту', current_date,
          coalesce(c.name,'') || coalesce(' · +7' || c.phone,''), o.customer_id, 'preorder', o.id, o.point_id)
  on conflict (auto_key) do nothing;
  insert into integration_jobs(target, action, payload) values ('telegram', 'preorder_arrived', jsonb_build_object('preorder_id', o.id, 'customer_id', o.customer_id, 'product', p.name));
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Предзаказ пришёл', o.num, p.name || coalesce(' · ' || u.imei, ' · ' || u.serial_no, ''));
  return true;
end $$;
revoke execute on function preorder_try_reserve(uuid) from public, anon, authenticated;

-- пришёл экземпляр → резерв за самым ранним предзаказом этого товара
create or replace function units_preorder() returns trigger language plpgsql security definer set search_path=public as $$
declare o uuid;
begin
  if coalesce(current_setting('icase.preorder_sell', true),'') = '1' then return null; end if;
  if new.status = 'in_stock' and (tg_op = 'INSERT' or old.status is distinct from 'in_stock' or old.product_id is distinct from new.product_id) then
    select id into o from preorders where product_id = new.product_id and status = 'waiting' order by created_at limit 1;
    if o is not null then perform preorder_try_reserve(o); end if;
  end if;
  return null;
end $$;
drop trigger if exists units_preorder on units;
create trigger units_preorder after insert or update of status, product_id on units for each row execute function units_preorder();

-- товар без IMEI: приход на склад отмечает предзаказы «пришёл»
create or replace function movements_preorder() returns trigger language plpgsql security definer set search_path=public as $$
declare o record; n int := new.qty;
begin
  if new.qty > 0 and new.type in ('in','transfer_in','return') and not coalesce((select track_serial from products where id = new.product_id), false) then
    for o in select id from preorders where product_id = new.product_id and status = 'waiting' order by created_at loop
      exit when n <= 0;
      if preorder_try_reserve(o.id) then n := n - 1; end if;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists movements_preorder on stock_movements;
create trigger movements_preorder after insert on stock_movements for each row execute function movements_preorder();

/* ---------- приём предзаказа ---------- */
-- p = {customer_id, product_id, price, deposit, method, due_date, note, point_id}
create or replace function preorder_create(p jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare o preorders; v uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права принимать предзаказы'; end if;
  if nullif(p->>'customer_id','') is null then raise exception 'Укажите клиента'; end if;
  if nullif(p->>'product_id','') is null then raise exception 'Выберите устройство'; end if;
  if coalesce(nullif(p->>'price','')::numeric,0) <= 0 then raise exception 'Укажите цену'; end if;
  if coalesce(nullif(p->>'deposit','')::numeric,0) > (p->>'price')::numeric then raise exception 'Предоплата больше цены'; end if;
  insert into preorders(point_id, customer_id, product_id, price, due_date, note)
  values (coalesce(nullif(p->>'point_id','')::uuid, my_point()), (p->>'customer_id')::uuid, (p->>'product_id')::uuid, (p->>'price')::numeric,
          nullif(p->>'due_date','')::date, nullif(trim(p->>'note'),''))
  returning * into o;
  perform preorder_cash(o, 'prepay', coalesce(nullif(p->>'method',''),'cash')::pay_method, coalesce(nullif(p->>'deposit','')::numeric,0), 'Предоплата за предзаказ');
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Принят предзаказ', o.num,
    (select name from products where id = o.product_id) || ' · ' || round(o.price)::text || ' ₽' || coalesce(' · предоплата ' || round(nullif((p->>'deposit')::numeric,0))::text || ' ₽',''));
  perform preorder_try_reserve(o.id);   -- если товар уже есть — сразу бронь
  return o.id;
end $$;

create or replace function preorder_pay(p_id uuid, p_amount numeric, p_method pay_method) returns void language plpgsql security definer set search_path=public as $$
declare o preorders;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into o from preorders where id = p_id for update;
  if o.status not in ('waiting','arrived') then raise exception 'Предзаказ закрыт'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Укажите сумму'; end if;
  if preorder_paid(o.num) + p_amount > o.price then raise exception 'Внесено будет больше цены (% ₽)', round(o.price); end if;
  perform preorder_cash(o, 'prepay', p_method, p_amount, 'Доплата за предзаказ');
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Доплата по предзаказу', o.num, round(p_amount)::text || ' ₽');
end $$;

create or replace function preorder_update(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path=public as $$
declare o preorders;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into o from preorders where id = p_id for update;
  if o.status not in ('waiting','arrived') then raise exception 'Предзаказ закрыт'; end if;
  if p ? 'price' and (p->>'price')::numeric <> o.price then
    if not has_role('owner','manager') then raise exception 'Цену предзаказа меняет управляющий'; end if;
    if (p->>'price')::numeric < preorder_paid(o.num) then raise exception 'Цена меньше внесённой суммы'; end if;
    insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Цена предзаказа изменена', o.num, round(o.price)::text || ' → ' || round((p->>'price')::numeric)::text);
  end if;
  update preorders set price = coalesce(nullif(p->>'price','')::numeric, price),
    due_date = case when p ? 'due_date' then nullif(p->>'due_date','')::date else due_date end,
    note = case when p ? 'note' then nullif(trim(p->>'note'),'') else note end where id = p_id;
end $$;

/* ---------- выдача: продажа с зачётом предоплаты ---------- */
-- p_payments — оплата остатка [{method, amount}], p_wh — склад, с которого продаём (по умолчанию — где лежит экземпляр)
create or replace function preorder_sell(p_id uuid, p_payments jsonb, p_wh uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare o preorders; p products; u units; paid numeric; v uuid; v_num text; wh uuid; pays jsonb := coalesce(p_payments,'[]'::jsonb);
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права продавать'; end if;
  select * into o from preorders where id = p_id for update;
  if o.status = 'waiting' then raise exception 'Устройство ещё не пришло'; end if;
  if o.status <> 'arrived' then raise exception 'Предзаказ закрыт'; end if;
  select * into p from products where id = o.product_id;
  paid := preorder_paid(o.num);
  if p.track_serial then
    select * into u from units where id = o.unit_id for update;
    if u.id is null or u.status <> 'reserved' then raise exception 'Зарезервированный экземпляр не найден'; end if;
    wh := u.warehouse_id;
    if p_wh is not null and p_wh is distinct from wh then
      raise exception 'Устройство лежит на складе «%» — сначала переместите его', (select name from warehouses where id = wh); end if;
    if not can_work_at((select point_id from warehouses where id = wh)) then
      raise exception 'Устройство лежит на складе «%» — переместите его на свою точку', (select name from warehouses where id = wh); end if;
    perform set_config('icase.preorder_sell', '1', true);
    update units set status = 'in_stock' where id = u.id;
    perform set_config('icase.preorder_sell', '', true);
  else
    wh := coalesce(p_wh, (select warehouse_id from stock where product_id = o.product_id and qty > 0 order by qty desc limit 1));
  end if;
  if paid > 0 then pays := pays || jsonb_build_array(jsonb_build_object('method','prepaid','amount',paid)); end if;
  v := create_sale(wh, o.customer_id,
    jsonb_build_array(jsonb_build_object('product_id', o.product_id, 'unit_id', u.id, 'qty', 1, 'price', o.price, 'discount', 0)),
    pays, 0, null, 0, null, 'store');
  select num into v_num from sales where id = v;
  delete from cash_ops where ref = v_num and method = 'prepaid';   -- предоплата уже в кассе с даты внесения
  update preorders set status = 'done', sale_id = v, closed_at = now(), closed_by = auth.uid() where id = o.id;
  update tasks set status = 'done', done_at = now(), done_by = auth.uid() where auto_key = 'po-arrived-' || o.num and status = 'open';
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Предзаказ выдан', o.num, v_num);
  return v;
end $$;

/* ---------- отмена: возврат предоплаты, снятие резерва ---------- */
create or replace function preorder_cancel(p_id uuid, p_refund numeric, p_method pay_method, p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare o preorders; paid numeric; nxt uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into o from preorders where id = p_id for update;
  if o.status not in ('waiting','arrived') then raise exception 'Предзаказ уже закрыт'; end if;
  paid := preorder_paid(o.num);
  p_refund := coalesce(p_refund, paid);
  if p_refund < 0 or p_refund > paid then raise exception 'Вернуть можно от 0 до % ₽', round(paid); end if;
  if p_refund < paid and not has_role('owner','manager') then raise exception 'Удержать часть предоплаты может только управляющий'; end if;
  if p_refund > 0 then perform preorder_cash(o, 'refund', p_method, -p_refund, 'Возврат предоплаты'); end if;
  update preorders set status = 'cancelled', closed_at = now(), closed_by = auth.uid(), cancel_reason = nullif(trim(p_reason),''), unit_id = null where id = o.id;
  update tasks set status = 'cancelled' where auto_key = 'po-arrived-' || o.num and status = 'open';
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Предзаказ отменён', o.num,
    concat_ws(' · ', 'возврат ' || round(p_refund)::text || ' ₽', case when p_refund < paid then 'удержано ' || round(paid - p_refund)::text || ' ₽' end, nullif(trim(p_reason),'')));
  if o.unit_id is not null then
    update units set status = 'in_stock', last_ref = o.num where id = o.unit_id and status = 'reserved';   -- триггер отдаст экземпляр следующему предзаказу
  else
    select id into nxt from preorders where product_id = o.product_id and status = 'waiting' order by created_at limit 1;
    if nxt is not null then perform preorder_try_reserve(nxt); end if;
  end if;
end $$;

revoke execute on function preorder_create(jsonb), preorder_pay(uuid,numeric,pay_method), preorder_update(uuid,jsonb), preorder_sell(uuid,jsonb,uuid),
  preorder_cancel(uuid,numeric,pay_method,text), preorder_paid(text) from public, anon;
grant execute on function preorder_create(jsonb), preorder_pay(uuid,numeric,pay_method), preorder_update(uuid,jsonb), preorder_sell(uuid,jsonb,uuid),
  preorder_cancel(uuid,numeric,pay_method,text), preorder_paid(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='preorders') then
    execute 'alter publication supabase_realtime add table preorders'; end if;
end $$;

/* ---------- товар для предзаказа из каталога Apple создаётся сразу (без подтверждения: название из справочника) ---------- */
create or replace function products_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare rpc boolean := coalesce(current_setting('icase.approval_rpc', true),'') = '1';
begin
  if tg_op = 'INSERT' then
    if not rpc and not is_approver() and approvals_on('productCreate') then
      new.approval := 'pending_create'; new.approval_by := auth.uid(); new.approval_at := now();
    elsif not rpc and not is_approver() then
      new.approval := null; new.approval_by := null; new.approval_at := null;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if not rpc and not is_approver() then
      new.approval := old.approval; new.approval_by := old.approval_by; new.approval_at := old.approval_at; new.approval_note := old.approval_note;
      if coalesce(old.is_archived,false) = false and new.is_archived and approvals_on('productDelete') then
        raise exception 'Отправка товара в архив требует подтверждения — нажмите «Запросить удаление»';
      end if;
    end if;
    return new;
  end if;
  if not rpc and not is_approver() and approvals_on('productDelete') then
    raise exception 'Удаление товара требует подтверждения — нажмите «Запросить удаление»';
  end if;
  return old;
end $$;

-- p = {model_id, memory, color, attrs:{}, name, price} → id товара «Новый» этой конфигурации (находит по названию или создаёт)
create or replace function preorder_catalog_product(p jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare m apple_models; v_name text := trim(coalesce(p->>'name','')); v uuid; v_cat uuid;
  a jsonb := case when jsonb_typeof(p->'attrs') = 'object' then p->'attrs' else '{}'::jsonb end;
begin
  if not has_role('owner','manager','seller','storekeeper') then raise exception 'Нет права'; end if;
  select * into m from apple_models where id = nullif(p->>'model_id','')::uuid;
  if m.id is null then raise exception 'Модель не найдена'; end if;
  if coalesce(array_length(m.memories,1),0) > 0 and nullif(p->>'memory','') is null then raise exception 'Выберите память'; end if;
  if coalesce(array_length(m.colors,1),0) > 0 and nullif(p->>'color','') is null then raise exception 'Выберите цвет'; end if;
  if v_name = '' or position(lower(m.name) in lower(v_name)) = 0 then raise exception 'Неверное название товара'; end if;
  select id into v from products where not coalesce(is_archived,false) and condition = 'Новый' and name = v_name limit 1;
  if v is not null then return v; end if;
  select id into v_cat from categories where parent_id is null and lower(name) = lower(m.family) limit 1;
  if v_cat is null then insert into categories(name, is_device) values (m.family, m.family <> 'Другое') returning id into v_cat; end if;
  perform set_config('icase.approval_rpc','1',true);
  insert into products(name, category_id, brand, model, memory, color, condition, attrs, catalog_id, track_serial, price)
  values (v_name, v_cat, 'Apple', m.name, nullif(p->>'memory',''), nullif(p->>'color',''), 'Новый', a, m.id, true, coalesce(nullif(p->>'price','')::numeric,0))
  returning id into v;
  perform set_config('icase.approval_rpc','',true);
  return v;
end $$;
revoke execute on function preorder_catalog_product(jsonb) from public, anon;
grant execute on function preorder_catalog_product(jsonb) to authenticated;
