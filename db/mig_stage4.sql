-- v3 этап 4: бонусная программа, выкуп и комиссия у частных лиц (договоры), импорт банковской выписки

/* =========================== БОНУСЫ =========================== */
-- настройки: {on, earn_pct, max_pay_pct, welcome}
alter table settings add column if not exists loyalty jsonb not null default '{"on":false,"earn_pct":3,"max_pay_pct":30,"welcome":0}'::jsonb;
create table if not exists bonus_ops (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  sale_id uuid references sales(id) on delete set null,
  return_id uuid references returns(id) on delete set null,
  kind text not null check (kind in ('earn','spend','return','manual','welcome')),
  amount numeric(12,2) not null,
  note text,
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists bonus_ops_cust on bonus_ops(customer_id);
alter table bonus_ops enable row level security;
drop policy if exists bo_r on bonus_ops;
create policy bo_r on bonus_ops for select using (has_role('owner','manager','seller','master'));
grant select on bonus_ops to authenticated;

create or replace function bonus_balance(p_customer uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount),0) from bonus_ops where customer_id = p_customer
$$;
create or replace function loyalty_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select loyalty from settings where id = 1), '{}'::jsonb)
$$;
-- начисление за покупку (после всех оплат; продажа в долг тоже — бонусы за всю сумму)
create or replace function bonus_on_sale() returns trigger language plpgsql security definer set search_path = public as $$
declare cfg jsonb := loyalty_cfg(); pctv numeric; v numeric;
begin
  if new.customer_id is null or coalesce((cfg->>'on')::boolean,false) = false then return new; end if;
  pctv := coalesce((cfg->>'earn_pct')::numeric,0);
  v := floor(new.total * pctv / 100);
  if v > 0 then insert into bonus_ops(customer_id, sale_id, kind, amount, note) values (new.customer_id, new.id, 'earn', v, 'За покупку ' || new.num); end if;
  return new;
end $$;
drop trigger if exists trg_bonus_sale on sales;
create trigger trg_bonus_sale after insert on sales for each row execute function bonus_on_sale();
-- возврат: списываем начисленное за возвращённую часть (не больше остатка на счёте)
create or replace function bonus_on_return() returns trigger language plpgsql security definer set search_path = public as $$
declare s sales; earned numeric; v numeric; bal numeric;
begin
  select * into s from sales where id = new.sale_id;
  if s.customer_id is null or s.total <= 0 then return new; end if;
  select coalesce(sum(amount),0) into earned from bonus_ops where sale_id = s.id and kind = 'earn';
  if earned <= 0 then return new; end if;
  v := least(earned, round(earned * new.amount / s.total));
  bal := bonus_balance(s.customer_id);
  v := least(v, greatest(bal,0));
  if v > 0 then insert into bonus_ops(customer_id, sale_id, return_id, kind, amount, note) values (s.customer_id, s.id, new.id, 'return', -v, 'Возврат ' || new.num); end if;
  return new;
end $$;
drop trigger if exists trg_bonus_return on returns;
create trigger trg_bonus_return after insert on returns for each row execute function bonus_on_return();
-- приветственные бонусы новому клиенту
create or replace function bonus_on_customer() returns trigger language plpgsql security definer set search_path = public as $$
declare cfg jsonb := loyalty_cfg(); v numeric := coalesce((cfg->>'welcome')::numeric,0);
begin
  if coalesce((cfg->>'on')::boolean,false) and v > 0 and new.phone is not null then
    insert into bonus_ops(customer_id, kind, amount, note) values (new.id, 'welcome', v, 'Приветственные бонусы');
  end if;
  return new;
end $$;
drop trigger if exists trg_bonus_customer on customers;
create trigger trg_bonus_customer after insert on customers for each row execute function bonus_on_customer();
revoke execute on function bonus_on_sale(), bonus_on_return(), bonus_on_customer() from public, anon, authenticated;

-- продажа с оплатой бонусами: бонусы уменьшают сумму чека (как скидка), проверяется остаток и лимит
create or replace function create_sale_bonus(p_bonus numeric, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare cfg jsonb := loyalty_cfg(); c customers; bal numeric; v uuid; sub numeric := 0; it jsonb; maxp numeric; due date;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  if coalesce((cfg->>'on')::boolean,false) = false then raise exception 'Бонусная программа выключена'; end if;
  select * into c from customers where id = nullif(p->>'p_customer','')::uuid for update;
  if c.id is null then raise exception 'Бонусы списываются только у покупателя с телефоном'; end if;
  p_bonus := round(coalesce(p_bonus,0));
  if p_bonus <= 0 then raise exception 'Укажите, сколько бонусов списать'; end if;
  bal := bonus_balance(c.id);
  if p_bonus > bal then raise exception 'У клиента только % бонусов', bal; end if;
  for it in select * from jsonb_array_elements(p->'p_items') loop sub := sub + (it->>'qty')::numeric * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0); end loop;
  maxp := floor((sub - coalesce((p->>'p_discount')::numeric,0)) * coalesce((cfg->>'max_pay_pct')::numeric,100) / 100);
  if p_bonus > maxp then raise exception 'Бонусами можно оплатить не больше % ₽ (% %% чека)', maxp, coalesce(cfg->>'max_pay_pct','100'); end if;
  if exists (select 1 from jsonb_array_elements(p->'p_payments') x where x->>'method' = 'debt') then
    v := create_sale_debt(nullif(p->>'p_wh','')::uuid, c.id, p->'p_items', p->'p_payments', coalesce((p->>'p_discount')::numeric,0) + p_bonus,
      nullif(p->>'p_tradein_device',''), coalesce((p->>'p_tradein_amount')::numeric,0), nullif(p->>'p_tradein_imei',''), nullif(p->>'p_due','')::date);
  else
    v := create_sale(nullif(p->>'p_wh','')::uuid, c.id, p->'p_items', p->'p_payments', coalesce((p->>'p_discount')::numeric,0) + p_bonus,
      nullif(p->>'p_tradein_device',''), coalesce((p->>'p_tradein_amount')::numeric,0), nullif(p->>'p_tradein_imei',''), 'store');
  end if;
  insert into bonus_ops(customer_id, sale_id, kind, amount, note) values (c.id, v, 'spend', -p_bonus, 'Оплата бонусами ' || (select num from sales where id = v));
  return v;
end $$;
create or replace function bonus_adjust(p_customer uuid, p_amount numeric, p_note text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if coalesce(p_amount,0) = 0 then raise exception 'Укажите сумму'; end if;
  if bonus_balance(p_customer) + p_amount < 0 then raise exception 'Нельзя списать больше остатка'; end if;
  insert into bonus_ops(customer_id, kind, amount, note) values (p_customer, 'manual', round(p_amount), coalesce(nullif(p_note,''),'Ручная корректировка'));
end $$;
revoke execute on function create_sale_bonus(numeric,jsonb), bonus_adjust(uuid,numeric,text), bonus_balance(uuid), loyalty_cfg() from public, anon;
grant execute on function create_sale_bonus(numeric,jsonb), bonus_adjust(uuid,numeric,text), bonus_balance(uuid) to authenticated;
revoke execute on function loyalty_cfg() from authenticated;

/* =========================== ВЫКУП И КОМИССИЯ У ЧАСТНЫХ ЛИЦ =========================== */
create sequence if not exists deal_seq;
create table if not exists buy_deals (
  id uuid primary key default gen_random_uuid(),
  num text not null unique,
  kind text not null check (kind in ('buyout','commission')),
  customer_id uuid not null references customers(id),
  point_id uuid references points(id) on delete set null,
  product_id uuid references products(id),
  unit_id uuid references units(id),
  device text not null,
  imei text,
  amount numeric(12,2) not null,          -- выкуп: заплатили клиенту; комиссия: выплатить клиенту после продажи
  price numeric(12,2),                    -- комиссия: цена продажи
  term_days int,                          -- комиссия: срок реализации
  pay_method pay_method,
  person jsonb not null default '{}'::jsonb,   -- паспортные данные для договора (персональные данные!)
  status text not null default 'open' check (status in ('open','sold','paid','returned','cancelled')),
  sale_id uuid references sales(id) on delete set null,
  debt_id uuid references debts(id) on delete set null,
  note text,
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(), closed_at timestamptz
);
alter table units add column if not exists deal_id uuid references buy_deals(id) on delete set null;
alter table buy_deals enable row level security;
drop policy if exists bd_r on buy_deals; drop policy if exists bd_w on buy_deals;
create policy bd_r on buy_deals for select using (has_role('owner','manager','seller','storekeeper'));
grant select on buy_deals to authenticated;

-- p = {kind, customer_id, point_id, wh_id, product_id?, device, imei|serial_no, condition, battery_health, kit, attrs, amount, price, term_days, pay_method, person{}, note}
create or replace function buy_deal_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare d buy_deals; pid uuid := nullif(p->>'product_id','')::uuid; v_cat uuid; u uuid; code text; wh uuid := nullif(p->>'wh_id','')::uuid; sh uuid; k text := p->>'kind';
        amt numeric := round(coalesce((p->>'amount')::numeric,0),2); pt uuid;
begin
  if not has_role('owner','manager','seller','storekeeper') then raise exception 'Нет права'; end if;
  if k not in ('buyout','commission') then raise exception 'Выберите: выкуп или комиссия'; end if;
  if nullif(p->>'customer_id','') is null then raise exception 'Укажите клиента'; end if;
  if coalesce(trim(p->>'device'),'') = '' then raise exception 'Укажите устройство'; end if;
  code := nullif(trim(coalesce(p->>'imei', p->>'serial_no','')),'');
  if code is null then raise exception 'Укажите IMEI или серийный номер'; end if;
  if amt <= 0 then raise exception 'Укажите сумму'; end if;
  if k = 'commission' and coalesce((p->>'price')::numeric,0) < amt then raise exception 'Цена продажи должна быть не меньше выплаты клиенту'; end if;
  if coalesce(p->'person'->>'doc','') = '' then raise exception 'Нужны паспортные данные продавца для договора'; end if;
  select point_id into pt from warehouses where id = wh;
  if pid is null then
    select id into v_cat from categories where is_used and parent_id is null order by name limit 1;
    if v_cat is null then select id into v_cat from categories where is_device and parent_id is null order by name limit 1; end if;
    insert into products(name, category_id, condition, cost, price, track_serial, ownership)
      values (trim(p->>'device'), v_cat, coalesce(nullif(p->>'condition',''),'Б/у хорошее'), amt, coalesce(nullif(p->>'price','')::numeric, amt), true, case when k='commission' then 'commission' else 'own' end)
      returning id into pid;
  end if;
  insert into buy_deals(num, kind, customer_id, point_id, product_id, device, imei, amount, price, term_days, pay_method, person, note)
    values ((case when k='buyout' then 'ДВ-' else 'ДК-' end) || nextval('deal_seq'), k, (p->>'customer_id')::uuid, coalesce(nullif(p->>'point_id','')::uuid, pt), pid, trim(p->>'device'), code,
      amt, nullif(p->>'price','')::numeric, nullif(p->>'term_days','')::int, case when k='buyout' then coalesce(nullif(p->>'pay_method',''),'cash')::pay_method end, coalesce(p->'person','{}'), nullif(p->>'note',''))
    returning * into d;
  select o_id into u from unit_receive(pid, wh, jsonb_strip_nulls(jsonb_build_object(case when code ~ '^\d{15}$' then 'imei' else 'serial_no' end, code,
      'condition', p->>'condition', 'battery_health', p->>'battery_health', 'kit', p->>'kit', 'price', p->>'price')), amt, d.num);
  update units set deal_id = d.id, origin_ref = d.num, attrs = coalesce(p->'attrs', attrs) where id = u;
  update buy_deals set unit_id = u where id = d.id;
  insert into stock_movements(product_id, warehouse_id, type, qty, ref, note) values (pid, wh, 'in', 1, d.num, case when k='buyout' then 'Выкуп у частного лица' else 'Приём на комиссию' end);
  if k = 'buyout' then
    sh := current_shift(d.point_id);
    if sh is null and d.pay_method = 'cash' then raise exception 'Для выплаты наличными откройте смену'; end if;
    insert into cash_ops(shift_id, point_id, type, method, amount, ref, note) values (sh, d.point_id, 'cashout', d.pay_method, -amt, d.num, 'Выкуп: ' || d.device);
  end if;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), case when k='buyout' then 'Выкуп у клиента' else 'Приём на комиссию' end, d.num, d.device || ' · ' || amt::text || ' ₽');
  return d.id;
end $$;

-- продан комиссионный экземпляр → долг комитенту (выплачивается через «Финансы → Долги»); выкуп — сделка закрыта продажей
create or replace function deal_on_unit_sold() returns trigger language plpgsql security definer set search_path = public as $$
declare d buy_deals; s uuid; c customers; dbt uuid;
begin
  if new.deal_id is null or new.status <> 'sold' or old.status = 'sold' then return new; end if;
  select * into d from buy_deals where id = new.deal_id for update;
  if d.status <> 'open' then return new; end if;
  select sale_id into s from sale_items where id = new.sale_item_id;
  if d.kind = 'commission' then
    select * into c from customers where id = d.customer_id;
    insert into debts(direction, kind, counterparty, customer_id, sale_id, amount, note)
      values ('out', 'customer', coalesce(nullif(c.name,'Без имени'), '+7' || c.phone), c.id, s, d.amount, 'Комиссия ' || d.num || ': выплата за проданный ' || d.device)
      returning id into dbt;
    update buy_deals set status = 'sold', sale_id = s, debt_id = dbt where id = d.id;
  else
    update buy_deals set status = 'done', sale_id = s, closed_at = now() where id = d.id;
  end if;
  return new;
end $$;
-- статус 'done' нужен для выкупа
alter table buy_deals drop constraint if exists buy_deals_status_check;
alter table buy_deals add constraint buy_deals_status_check check (status in ('open','sold','paid','returned','cancelled','done'));
drop trigger if exists trg_deal_sold on units;
create trigger trg_deal_sold after update of status on units for each row execute function deal_on_unit_sold();
-- выплатили комитенту — сделка закрыта
create or replace function deal_on_debt() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then update buy_deals set status = 'paid', closed_at = now() where debt_id = new.id and status = 'sold'; end if;
  return new;
end $$;
drop trigger if exists trg_deal_debt on debts;
create trigger trg_deal_debt after update of status on debts for each row execute function deal_on_debt();
revoke execute on function deal_on_unit_sold(), deal_on_debt() from public, anon, authenticated;

-- клиент забрал комиссионное устройство обратно
create or replace function buy_deal_return(p_id uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare d buy_deals; u units;
begin
  if not has_role('owner','manager','seller','storekeeper') then raise exception 'Нет права'; end if;
  select * into d from buy_deals where id = p_id for update;
  if d.kind <> 'commission' or d.status <> 'open' then raise exception 'Вернуть можно только непроданное комиссионное устройство'; end if;
  select * into u from units where id = d.unit_id for update;
  if u.status <> 'in_stock' then raise exception 'Устройство сейчас не на складе (статус: %)', u.status; end if;
  insert into stock_movements(product_id, warehouse_id, type, qty, ref, note) values (u.product_id, u.warehouse_id, 'writeoff', -1, d.num, 'Возврат комитенту');
  update units set status = 'written_off', warehouse_id = null, last_ref = d.num where id = u.id;
  update buy_deals set status = 'returned', closed_at = now(), note = coalesce(nullif(p_note,''), note) where id = d.id;
end $$;
revoke execute on function buy_deal_create(jsonb), buy_deal_return(uuid,text) from public, anon;
grant execute on function buy_deal_create(jsonb), buy_deal_return(uuid,text) to authenticated;

/* =========================== БАНКОВСКАЯ ВЫПИСКА =========================== */
alter table fin_ops add column if not exists ext_id text;
create unique index if not exists fin_ops_ext on fin_ops(account_id, ext_id) where ext_id is not null;
alter table suppliers add column if not exists inn text;
-- операция из выписки: повторный импорт той же строки ничего не создаёт
create or replace function fin_op_import(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if exists (select 1 from fin_ops where account_id = (p->>'account_id')::uuid and ext_id = p->>'ext_id') then return null; end if;
  v := fin_op_create_payee(p);
  update fin_ops set ext_id = nullif(p->>'ext_id','') where id = v;
  return v;
end $$;
revoke execute on function fin_op_import(jsonb) from public, anon;
grant execute on function fin_op_import(jsonb) to authenticated;

do $$ declare t text; begin
  foreach t in array array['bonus_ops','buy_deals'] loop
    begin execute format('alter publication supabase_realtime add table %I', t); exception when others then null; end;
  end loop;
end $$;
