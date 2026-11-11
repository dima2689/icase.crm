-- v3: связки данных для точных отчётов (прибыль по точкам, эквайринг, начисление зарплаты, история IMEI, подготовка б/у,
-- лист ожидания и упущенный спрос, гарантия ↔ продажа, реклама по каналам, задачи)

/* ---------- настройки финансов: эквайринг, распределение общих расходов, зарплата по начислению, ПСН ---------- */
alter table settings add column if not exists fin_config jsonb not null default '{}'::jsonb;

/* ---------- операции: точка и рекламный канал ---------- */
alter table fin_ops add column if not exists point_id uuid references points(id) on delete set null;
alter table fin_ops add column if not exists channel text;
create index if not exists fin_ops_point on fin_ops(point_id);
-- касса точки — всегда эта точка
update fin_ops o set point_id = a.point_id from fin_accounts a where a.id = o.account_id and a.kind = 'drawer' and o.point_id is null;

create or replace function fin_op_create_payee(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; pt uuid;
begin
  v := fin_op_create(p);
  select coalesce(nullif(p->>'point_id','')::uuid, (select a.point_id from fin_accounts a join fin_ops o on o.account_id = a.id where o.id = v and a.kind = 'drawer')) into pt;
  update fin_ops set payee_staff = nullif(p->>'payee_staff','')::uuid, point_id = pt, channel = nullif(p->>'channel','') where id = v;
  return v;
end $$;
revoke execute on function fin_op_create_payee(jsonb) from public, anon;
grant execute on function fin_op_create_payee(jsonb) to authenticated;

-- поправить точку / канал у уже записанной операции
create or replace function fin_op_tag(p_id uuid, p_point uuid, p_channel text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  update fin_ops set point_id = p_point, channel = nullif(p_channel,'') where id = p_id;
end $$;
revoke execute on function fin_op_tag(uuid,uuid,text) from public, anon;
grant execute on function fin_op_tag(uuid,uuid,text) to authenticated;

/* ---------- экземпляры: откуда пришёл и затраты на подготовку ---------- */
alter table units add column if not exists origin_ref text;
update units set origin_ref = last_ref where origin_ref is null;
create or replace function unit_origin() returns trigger language plpgsql set search_path = public as $$
begin new.origin_ref := coalesce(new.origin_ref, new.last_ref); return new; end $$;
drop trigger if exists trg_unit_origin on units;
create trigger trg_unit_origin before insert on units for each row execute function unit_origin();
revoke execute on function unit_origin() from public, anon, authenticated;

create table if not exists unit_costs (
  id bigint generated always as identity primary key,
  unit_id uuid not null references units(id) on delete cascade,
  kind text not null check (kind in ('part','labor','other')),
  product_id uuid references products(id),
  warehouse_id uuid references warehouses(id),
  name text not null, qty int not null default 1, amount numeric(12,2) not null default 0,
  note text, staff_id uuid references staff(id) default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists unit_costs_unit on unit_costs(unit_id);
alter table unit_costs enable row level security;
drop policy if exists uc_r on unit_costs;
create policy uc_r on unit_costs for select using (has_role('owner','manager','storekeeper','master'));
grant select on unit_costs to authenticated;

-- подготовка к продаже: запчасти со склада и работа добавляются к себестоимости экземпляра
-- p_parts = [{product_id, warehouse_id, qty}]
create or replace function unit_prep(p_unit uuid, p_parts jsonb, p_labor numeric, p_note text) returns numeric language plpgsql security definer set search_path = public as $$
declare u units; x jsonb; pr products; q int; tot numeric := 0; code text;
begin
  if not has_role('owner','manager','storekeeper','master') then raise exception 'Нет права'; end if;
  select * into u from units where id = p_unit for update;
  if u.id is null then raise exception 'Экземпляр не найден'; end if;
  if u.status <> 'in_stock' then raise exception 'Подготовка возможна только для экземпляра на складе'; end if;
  code := coalesce(u.imei, u.serial_no);
  for x in select * from jsonb_array_elements(coalesce(p_parts,'[]')) loop
    select * into pr from products where id = (x->>'product_id')::uuid;
    if pr.id is null then raise exception 'Запчасть не найдена'; end if;
    if pr.track_serial then raise exception 'Товар с IMEI/серийным номером нельзя списать как запчасть'; end if;
    q := greatest(1, coalesce((x->>'qty')::int,1));
    insert into stock_movements(product_id, warehouse_id, type, qty, ref, note) values (pr.id, (x->>'warehouse_id')::uuid, 'repair', -q, 'Подготовка ' || code, coalesce(p_note,''));
    insert into unit_costs(unit_id, kind, product_id, warehouse_id, name, qty, amount, note) values (u.id, 'part', pr.id, (x->>'warehouse_id')::uuid, pr.name, q, round(pr.cost*q,2), p_note);
    tot := tot + round(pr.cost*q,2);
  end loop;
  if coalesce(p_labor,0) > 0 then
    insert into unit_costs(unit_id, kind, name, amount, note) values (u.id, 'labor', 'Работа', p_labor, p_note);
    tot := tot + p_labor;
  end if;
  if tot = 0 then raise exception 'Добавьте запчасти или стоимость работы'; end if;
  update units set cost = cost + tot where id = u.id;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Подготовка к продаже', code, tot::text || ' ₽');
  return tot;
end $$;
revoke execute on function unit_prep(uuid,jsonb,numeric,text) from public, anon;
grant execute on function unit_prep(uuid,jsonb,numeric,text) to authenticated;

/* ---------- гарантия ↔ продажа ---------- */
alter table repairs add column if not exists sale_id uuid references sales(id) on delete set null;
alter table repairs add column if not exists unit_id uuid references units(id) on delete set null;
-- ремонт по IMEI проданного у нас устройства сам связывается с продажей
create or replace function repair_link_sale() returns trigger language plpgsql security definer set search_path = public as $$
declare u units;
begin
  if new.imei is not null and (new.sale_id is null or new.unit_id is null) then
    select * into u from units where imei = trim(new.imei) or imei2 = trim(new.imei) or upper(serial_no) = upper(trim(new.imei)) limit 1;
    if u.id is not null then
      new.unit_id := coalesce(new.unit_id, u.id);
      if u.sale_item_id is not null then new.sale_id := coalesce(new.sale_id, (select sale_id from sale_items where id = u.sale_item_id)); end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_repair_link on repairs;
create trigger trg_repair_link before insert or update of imei on repairs for each row execute function repair_link_sale();
revoke execute on function repair_link_sale() from public, anon, authenticated;
update repairs set imei = imei where imei is not null;

/* ---------- лист ожидания и упущенный спрос ---------- */
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  request text not null,
  qty int not null default 1,
  max_price numeric(12,2),
  point_id uuid references points(id) on delete set null,
  status text not null default 'open' check (status in ('open','ready','done','cancelled')),
  note text,
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(), ready_at timestamptz, closed_at timestamptz
);
create table if not exists lost_demand (
  id bigint generated always as identity primary key,
  request text not null,
  product_id uuid references products(id) on delete set null,
  qty int not null default 1,
  reason text not null default 'нет в наличии',
  point_id uuid references points(id) on delete set null,
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
-- приход товара: заявки из листа ожидания становятся «пришло — позвонить»
create or replace function waitlist_on_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.qty > 0 and new.type in ('in','transfer_in','return','tradein') then
    update waitlist set status = 'ready', ready_at = now() where status = 'open' and product_id = new.product_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_waitlist_stock on stock_movements;
create trigger trg_waitlist_stock after insert on stock_movements for each row execute function waitlist_on_stock();
revoke execute on function waitlist_on_stock() from public, anon, authenticated;

/* ---------- задачи и напоминания ---------- */
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text,
  due_date date,
  assignee uuid references staff(id) on delete set null,
  point_id uuid references points(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  ref_type text, ref_id text,                         -- repair / waitlist / sale / debt / po …
  auto_key text unique,                               -- для автозадач: не создавать повторно
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(), done_at timestamptz, done_by uuid references staff(id)
);
create index if not exists tasks_open on tasks(status, due_date);

do $$ declare t text; begin
  foreach t in array array['waitlist','lost_demand','tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists x_rw on %I', t);
    execute format('create policy x_rw on %I for all using (has_role(''owner'',''manager'',''seller'',''master'',''storekeeper'')) with check (has_role(''owner'',''manager'',''seller'',''master'',''storekeeper''))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    begin execute format('alter publication supabase_realtime add table %I', t); exception when others then null; end;
  end loop;
  begin execute 'alter publication supabase_realtime add table unit_costs'; exception when others then null; end;
end $$;
