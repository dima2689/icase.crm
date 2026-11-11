-- v3: ремонт (как в LiveSklad / HelloClient), зарплата сотрудников, заказы поставщикам (как в МоёмСкладе), статус ремонта для клиента

/* =========================== РЕМОНТ =========================== */
alter table repairs add column if not exists master_id uuid references staff(id) on delete set null;
alter table repairs add column if not exists source text;
alter table repairs add column if not exists diag_fee numeric(12,2) not null default 0;
create index if not exists repairs_master on repairs(master_id);

-- запчасти — только товары без поштучного учёта (IMEI/серийные номера в ремонт не списываем)
create or replace function repair_part_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select track_serial from products where id = new.product_id) then raise exception 'Товары с IMEI/серийным номером нельзя списать в ремонт как запчасть'; end if;
  if (select status from repairs where id = new.repair_id) in ('done','cancel') then raise exception 'Ремонт уже закрыт'; end if;
  return new;
end $$;
drop trigger if exists trg_repair_part_check on repair_parts;
create trigger trg_repair_part_check before insert on repair_parts for each row execute function repair_part_check();
revoke execute on function repair_part_check() from public, anon, authenticated;

-- деньги по ремонту — в кассовую смену точки, где принят ремонт
create or replace function repair_cash(r repairs, p_type cashop_type, p_method pay_method, p_amount numeric, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare s uuid := current_shift(r.point_id); st settings;
begin
  if coalesce(p_amount,0) = 0 then return; end if;
  select * into st from settings where id = 1;
  if s is null and (st.require_shift or p_method = 'cash') then raise exception 'Откройте кассовую смену на точке'; end if;
  insert into cash_ops(shift_id, point_id, type, method, amount, ref, note) values (s, r.point_id, p_type, p_method, p_amount, r.num, p_note);
end $$;
revoke execute on function repair_cash(repairs, cashop_type, pay_method, numeric, text) from public, anon, authenticated;

create or replace function repair_paid(p_id uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount),0) from cash_ops where ref = (select num from repairs where id = p_id) and type in ('prepay','repair','refund')
$$;

-- приём: p = {customer_id, point_id, device, imei, problem, kit, appearance, device_pass, master_id, estimate, due_date, warranty_days, source, warranty_of, prepay, prepay_method}
create or replace function repair_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; r repairs;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права принимать ремонт'; end if;
  if nullif(p->>'customer_id','') is null then raise exception 'Укажите клиента'; end if;
  if coalesce(trim(p->>'device'),'') = '' then raise exception 'Укажите устройство'; end if;
  if coalesce(trim(p->>'problem'),'') = '' then raise exception 'Опишите неисправность'; end if;
  insert into repairs(point_id, customer_id, device, imei, problem, kit, appearance, device_pass, master_id, master, estimate, due_date, warranty_days, source, warranty_of)
  values (coalesce(nullif(p->>'point_id','')::uuid, my_point()), (p->>'customer_id')::uuid, trim(p->>'device'), nullif(trim(p->>'imei'),''), trim(p->>'problem'),
    nullif(p->>'kit',''), nullif(p->>'appearance',''), nullif(p->>'device_pass',''), nullif(p->>'master_id','')::uuid,
    (select full_name from staff where id = nullif(p->>'master_id','')::uuid), coalesce(nullif(p->>'estimate','')::numeric,0),
    nullif(p->>'due_date','')::date, coalesce(nullif(p->>'warranty_days','')::int, (select repair_warranty_days from settings where id=1)),
    nullif(p->>'source',''), nullif(p->>'warranty_of','')::uuid)
  returning * into r;
  if coalesce(nullif(p->>'prepay','')::numeric,0) > 0 then
    perform repair_cash(r, 'prepay', coalesce(nullif(p->>'prepay_method',''),'cash')::pay_method, (p->>'prepay')::numeric, 'Предоплата');
  end if;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Принят в ремонт', r.num, r.device);
  return r.id;
end $$;

-- изменить поля, статус и мастера
create or replace function repair_update(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r repairs; ns repair_status;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_id for update;
  if r.id is null then raise exception 'Ремонт не найден'; end if;
  if r.status in ('done','cancel') and not has_role('owner','manager') then raise exception 'Ремонт закрыт — менять может управляющий'; end if;
  ns := coalesce(nullif(p->>'status','')::repair_status, r.status);
  if ns in ('done','cancel') and ns <> r.status then raise exception 'Закрыть ремонт можно только выдачей или отменой'; end if;
  update repairs set
    device = coalesce(nullif(trim(p->>'device'),''), device), imei = case when p ? 'imei' then nullif(trim(p->>'imei'),'') else imei end,
    problem = coalesce(nullif(trim(p->>'problem'),''), problem), kit = case when p ? 'kit' then nullif(p->>'kit','') else kit end,
    appearance = case when p ? 'appearance' then nullif(p->>'appearance','') else appearance end,
    device_pass = case when p ? 'device_pass' then nullif(p->>'device_pass','') else device_pass end,
    diagnosis = case when p ? 'diagnosis' then nullif(p->>'diagnosis','') else diagnosis end,
    estimate = coalesce(nullif(p->>'estimate','')::numeric, estimate), due_date = case when p ? 'due_date' then nullif(p->>'due_date','')::date else due_date end,
    master_id = case when p ? 'master_id' then nullif(p->>'master_id','')::uuid else master_id end,
    master = case when p ? 'master_id' then (select full_name from staff where id = nullif(p->>'master_id','')::uuid) else master end,
    approved = case when p ? 'approved' then (p->>'approved')::boolean else approved end,
    approved_sum = case when p ? 'approved_sum' then nullif(p->>'approved_sum','')::numeric else approved_sum end,
    warranty_days = coalesce(nullif(p->>'warranty_days','')::int, warranty_days),
    status = ns, ready_at = case when ns = 'ready' and r.status <> 'ready' then now() when ns <> 'ready' and ns not in ('done') then null else ready_at end
  where id = p_id;
  if nullif(p->>'note','') is not null then insert into repair_history(repair_id, status, note) values (p_id, ns, p->>'note'); end if;
end $$;

-- доплата / предоплата
create or replace function repair_pay(p_id uuid, p_amount numeric, p_method pay_method) returns void language plpgsql security definer set search_path = public as $$
declare r repairs;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_id;
  if r.status in ('done','cancel') then raise exception 'Ремонт уже закрыт'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Укажите сумму'; end if;
  perform repair_cash(r, 'prepay', p_method, p_amount, 'Предоплата');
end $$;

-- выдача клиенту: итоговая цена = работы + запчасти (или указанная), доплата делится по способам оплаты
create or replace function repair_issue(p_id uuid, p_final numeric, p_payments jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r repairs; paid numeric; due numeric; got numeric; x jsonb;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_id for update;
  if r.status in ('done','cancel') then raise exception 'Ремонт уже закрыт'; end if;
  if coalesce(p_final,0) < 0 then raise exception 'Неверная сумма'; end if;
  paid := repair_paid(p_id); due := round(p_final - paid, 2);
  select coalesce(sum((e->>'amount')::numeric),0) into got from jsonb_array_elements(coalesce(p_payments,'[]')) e;
  if abs(got - due) >= 0.5 then raise exception 'К оплате %, а внесено %', greatest(due,0), got; end if;
  for x in select * from jsonb_array_elements(coalesce(p_payments,'[]')) loop
    perform repair_cash(r, case when (x->>'amount')::numeric < 0 then 'refund' else 'repair' end::cashop_type, (x->>'method')::pay_method, (x->>'amount')::numeric,
      case when (x->>'amount')::numeric < 0 then 'Возврат переплаты' else 'Оплата при выдаче' end);
  end loop;
  update repairs set status = 'done', final_price = p_final, closed_at = now(), ready_at = coalesce(ready_at, now()) where id = p_id;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Ремонт выдан', r.num, p_final::text || ' ₽');
end $$;

-- отказ / отмена: запчасти возвращаются на склад, предоплата — клиенту (минус плата за диагностику)
create or replace function repair_cancel(p_id uuid, p_reason text, p_fee numeric, p_method pay_method) returns void language plpgsql security definer set search_path = public as $$
declare r repairs; paid numeric; back numeric;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_id for update;
  if r.status in ('done','cancel') then raise exception 'Ремонт уже закрыт'; end if;
  paid := repair_paid(p_id); back := round(paid - coalesce(p_fee,0), 2);
  if back > 0 then perform repair_cash(r, 'refund', coalesce(p_method,'cash'), -back, 'Возврат предоплаты');
  elsif back < 0 then perform repair_cash(r, 'repair', coalesce(p_method,'cash'), -back, 'Оплата диагностики'); end if;
  update repair_parts set returned = true where repair_id = p_id and not returned;
  update repairs set status = 'cancel', cancel_reason = nullif(p_reason,''), diag_fee = coalesce(p_fee,0), final_price = coalesce(p_fee,0), closed_at = now() where id = p_id;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Ремонт отменён', r.num, coalesce(p_reason,''));
end $$;

-- статус для клиента на сайте: номер квитанции + последние 4 цифры телефона
create or replace function repair_public(p_num text, p_phone4 text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('num', r.num, 'device', r.device, 'status', r.status, 'due_date', r.due_date, 'ready_at', r.ready_at,
    'to_pay', case when r.status in ('done','cancel') then 0 else greatest(0, coalesce(nullif(
        coalesce((select sum(price*qty) from repair_services where repair_id = r.id),0) + coalesce((select sum(price*qty) from repair_parts where repair_id = r.id and not returned),0), 0),
        r.approved_sum, r.estimate) - repair_paid(r.id)) end,
    'history', (select jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at) order by h.created_at) from repair_history h where h.repair_id = r.id and h.note is null))
  from repairs r join customers c on c.id = r.customer_id
  where upper(r.num) = upper(trim(p_num)) and length(regexp_replace(coalesce(p_phone4,''),'\D','','g')) >= 4
    and right(coalesce(c.phone,''),4) = right(regexp_replace(coalesce(p_phone4,''),'\D','','g'),4)
$$;
revoke execute on function repair_public(text,text), repair_paid(uuid) from public, anon;
grant execute on function repair_public(text,text) to service_role;
revoke execute on function repair_public(text,text) from authenticated;
grant execute on function repair_paid(uuid), repair_create(jsonb), repair_update(uuid,jsonb), repair_pay(uuid,numeric,pay_method),
  repair_issue(uuid,numeric,jsonb), repair_cancel(uuid,text,numeric,pay_method) to authenticated;
revoke execute on function repair_create(jsonb), repair_update(uuid,jsonb), repair_pay(uuid,numeric,pay_method),
  repair_issue(uuid,numeric,jsonb), repair_cancel(uuid,text,numeric,pay_method) from public, anon;

/* =========================== ЗАРПЛАТА =========================== */
create table if not exists pay_rules (
  staff_id uuid primary key references staff(id) on delete cascade,
  base_month numeric(12,2) not null default 0,     -- оклад в месяц
  per_shift numeric(12,2) not null default 0,      -- за каждую открытую смену
  pct_sales numeric(6,2) not null default 0,       -- % от выручки своих продаж
  pct_profit numeric(6,2) not null default 0,      -- % от валовой прибыли своих продаж
  pct_works numeric(6,2) not null default 0,       -- % от стоимости работ в выданных ремонтах (мастер)
  note text,
  updated_at timestamptz not null default now()
);
alter table pay_rules enable row level security;
drop policy if exists pr_r on pay_rules; drop policy if exists pr_w on pay_rules;
create policy pr_r on pay_rules for select using (has_role('owner','manager') or staff_id = auth.uid());
create policy pr_w on pay_rules for all using (has_role('owner')) with check (has_role('owner'));
grant select, insert, update, delete on pay_rules to authenticated;
alter table fin_ops add column if not exists payee_staff uuid references staff(id) on delete set null;

-- выплата зарплаты = расход со статьёй «Зарплата» и получателем
create or replace function fin_op_create_payee(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  v := fin_op_create(p);
  if nullif(p->>'payee_staff','') is not null then update fin_ops set payee_staff = (p->>'payee_staff')::uuid where id = v; end if;
  return v;
end $$;
revoke execute on function fin_op_create_payee(jsonb) from public, anon;
grant execute on function fin_op_create_payee(jsonb) to authenticated;

/* =========================== ЗАКАЗЫ ПОСТАВЩИКАМ =========================== */
create sequence if not exists po_seq;
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'ЗП-' || nextval('po_seq'),
  supplier_id uuid references suppliers(id) on delete set null,
  wh_id uuid references warehouses(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent','partial','done','cancelled')),
  expected_date date,
  note text,
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists purchase_order_lines (
  id bigint generated always as identity primary key,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  qty int not null check (qty > 0),
  cost numeric(12,2) not null default 0,
  received int not null default 0
);
create index if not exists pol_po on purchase_order_lines(po_id);
alter table stock_docs add column if not exists po_id uuid references purchase_orders(id) on delete set null;
do $$ declare t text; begin
  foreach t in array array['purchase_orders','purchase_order_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists po_r on %I', t); execute format('drop policy if exists po_w on %I', t);
    execute format('create policy po_r on %I for select using (has_role(''owner'',''manager'',''storekeeper''))', t);
    execute format('create policy po_w on %I for all using (has_role(''owner'',''manager'',''storekeeper'')) with check (has_role(''owner'',''manager'',''storekeeper''))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    begin execute format('alter publication supabase_realtime add table %I', t); exception when others then null; end;
  end loop;
end $$;
-- приёмка по заказу: отмечаем, что пришло, и статус заказа
create or replace function po_doc_posted() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; left_cnt int;
begin
  if new.po_id is null or new.type <> 'in' then return new; end if;
  if new.status = 'posted' and old.status is distinct from 'posted' then
    for l in select product_id, sum(qty) q from stock_doc_lines where doc_id = new.id group by product_id loop
      update purchase_order_lines set received = received + l.q where po_id = new.po_id and product_id = l.product_id;
    end loop;
    select count(*) into left_cnt from purchase_order_lines where po_id = new.po_id and received < qty;
    update purchase_orders set status = case when left_cnt = 0 then 'done' else 'partial' end, updated_at = now() where id = new.po_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_po_doc on stock_docs;
create trigger trg_po_doc after update of status on stock_docs for each row execute function po_doc_posted();
revoke execute on function po_doc_posted() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['pay_rules','repair_history','repair_parts','repair_services'] loop
    begin execute format('alter publication supabase_realtime add table %I', t); exception when others then null; end;
  end loop;
end $$;
