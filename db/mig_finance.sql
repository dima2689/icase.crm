-- v3: раздел «Финансы» — счета, приход/расход/перевод, долги (нам должны / мы должны), регулярные платежи
-- Внимание: значение 'debt' в pay_method добавляется отдельной миграцией (mig_finance_enum.sql) до этой.

create sequence if not exists fin_op_seq;
create sequence if not exists debt_seq;

-- счета: касса точки (наличные в ящике), расчётный счёт, сейф, карта владельца…
create table if not exists fin_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'cash' check (kind in ('drawer','bank','cash','card','other')),
  point_id uuid references points(id) on delete cascade,     -- для kind = 'drawer'
  opening numeric(12,2) not null default 0,                   -- остаток на дату начала учёта
  noncash boolean not null default false,                     -- сюда поступает безнал с касс (карта, СБП, перевод)
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_accounts_drawer on fin_accounts(point_id) where kind = 'drawer';

create table if not exists fin_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('in','out')),
  in_pnl boolean not null default true,                       -- учитывать в прибыли (закупка товара и вложения — нет)
  is_active boolean not null default true,
  sort int not null default 0
);

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'Д-' || nextval('debt_seq'),
  direction text not null check (direction in ('in','out')), -- in: нам должны, out: мы должны
  kind text not null default 'other' check (kind in ('supplier','customer','loan','staff','other')),
  counterparty text not null default '',
  supplier_id uuid references suppliers(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  sale_id uuid references sales(id) on delete set null,
  doc_id uuid references stock_docs(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date,
  note text,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists debts_status on debts(status);

create table if not exists fin_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'out' check (kind in ('in','out')),
  amount numeric(12,2) not null default 0,
  category_id uuid references fin_categories(id) on delete set null,
  account_id uuid references fin_accounts(id) on delete set null,
  counterparty text,
  period text not null default 'month' check (period in ('week','month','quarter','year','once')),
  next_date date not null default current_date,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists fin_ops (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'Ф-' || nextval('fin_op_seq'),
  op_date date not null default current_date,
  kind text not null check (kind in ('in','out','transfer')),
  account_id uuid not null references fin_accounts(id),
  to_account_id uuid references fin_accounts(id),
  amount numeric(12,2) not null check (amount > 0),
  category_id uuid references fin_categories(id) on delete set null,
  debt_id uuid references debts(id) on delete set null,
  plan_id uuid references fin_plans(id) on delete set null,
  counterparty text,
  note text,
  cash_op_ids bigint[] not null default '{}',                 -- движения наличных в кассе точки
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references staff(id),
  check (kind <> 'transfer' or (to_account_id is not null and to_account_id <> account_id))
);
create index if not exists fin_ops_date on fin_ops(op_date);
create index if not exists fin_ops_debt on fin_ops(debt_id);

alter table stock_docs add column if not exists pay_account uuid references fin_accounts(id) on delete set null;

-- права: всё про деньги видят и меняют только владелец и управляющий
do $$ declare t text; begin
  foreach t in array array['fin_accounts','fin_categories','fin_ops','debts','fin_plans'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists fin_r on %I', t);
    execute format('drop policy if exists fin_w on %I', t);
    execute format('create policy fin_r on %I for select using (has_role(''owner'',''manager''))', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
-- справочники и плановые платежи правятся напрямую, операции и долги — только через функции ниже
create policy fin_w on fin_accounts for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy fin_w on fin_categories for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy fin_w on fin_plans for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
grant insert, update, delete on fin_accounts, fin_categories, fin_plans to authenticated;

-- начальная настройка: касса для каждой точки, расчётный счёт, сейф, статьи. Можно вызывать повторно.
create or replace function fin_setup() returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  for p in select id, name from points loop
    insert into fin_accounts(name, kind, point_id, sort) values ('Касса · ' || p.name, 'drawer', p.id, 0) on conflict do nothing;
  end loop;
  if not exists (select 1 from fin_accounts where kind <> 'drawer') then
    insert into fin_accounts(name, kind, noncash, sort) values ('Расчётный счёт', 'bank', true, 10), ('Сейф', 'cash', false, 20);
  end if;
  if not exists (select 1 from fin_categories) then
    insert into fin_categories(name, kind, in_pnl, sort) values
      ('Закупка товара','out',false,1),('Аренда','out',true,2),('Зарплата','out',true,3),('Налоги и взносы','out',true,4),
      ('Реклама','out',true,5),('Связь и интернет','out',true,6),('Коммунальные услуги','out',true,7),('Банк и эквайринг','out',true,8),
      ('Доставка','out',true,9),('Хозрасходы','out',true,10),('Возврат займа','out',false,11),('Выплата владельцу','out',false,12),('Прочие расходы','out',true,13),
      ('Оплата долга клиентом','in',false,1),('Вложения владельца','in',false,2),('Займ получен','in',false,3),('Возврат от поставщика','in',false,4),('Прочие доходы','in',true,5);
  end if;
end $$;

-- остаток долга
create or replace function debt_left(p_debt uuid) returns numeric language sql stable security definer set search_path = public as $$
  select d.amount - coalesce((select sum(o.amount) from fin_ops o where o.debt_id = d.id and o.cancelled_at is null), 0) from debts d where d.id = p_debt
$$;
create or replace function debt_refresh(p_debt uuid) returns void language plpgsql security definer set search_path = public as $$
declare l numeric := debt_left(p_debt);
begin
  update debts set status = case when l <= 0.004 then 'closed' else 'open' end,
    closed_at = case when l <= 0.004 then coalesce(closed_at, now()) else null end
  where id = p_debt and status <> 'cancelled';
end $$;

-- движение наличных в ящике точки (нужна открытая смена)
create or replace function fin_drawer_move(p_acc fin_accounts, p_amount numeric, p_ref text, p_note text) returns bigint language plpgsql security definer set search_path = public as $$
declare s uuid := current_shift(p_acc.point_id); v bigint;
begin
  if s is null then raise exception 'На точке «%» закрыта смена — наличные в кассе можно двигать только при открытой смене', (select name from points where id = p_acc.point_id); end if;
  if p_amount < 0 and shift_expected_cash(s) + p_amount < 0 then raise exception 'В кассе не хватает наличных: есть %', shift_expected_cash(s); end if;
  insert into cash_ops(shift_id, point_id, type, method, amount, ref, note)
    values (s, p_acc.point_id, (case when p_amount >= 0 then 'cashin' else 'cashout' end)::cashop_type, 'cash', p_amount, p_ref, p_note) returning id into v;
  return v;
end $$;

-- провести операцию. p: {kind, account_id, to_account_id, amount, category_id, debt_id, plan_id, counterparty, note, op_date}
create or replace function fin_op_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare a fin_accounts; b fin_accounts; d debts; v_id uuid; v_num text; v_amt numeric := round((p->>'amount')::numeric, 2);
        v_kind text := p->>'kind'; v_ops bigint[] := '{}'; v_note text; pl fin_plans;
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Укажите сумму'; end if;
  if v_kind not in ('in','out','transfer') then raise exception 'Неизвестный тип операции'; end if;
  select * into a from fin_accounts where id = (p->>'account_id')::uuid and is_active;
  if a.id is null then raise exception 'Выберите счёт'; end if;
  if v_kind = 'transfer' then
    select * into b from fin_accounts where id = (p->>'to_account_id')::uuid and is_active;
    if b.id is null or b.id = a.id then raise exception 'Выберите другой счёт, куда переводим'; end if;
  end if;
  if nullif(p->>'debt_id','') is not null then
    select * into d from debts where id = (p->>'debt_id')::uuid for update;
    if d.id is null or d.status = 'cancelled' then raise exception 'Долг не найден'; end if;
    if (d.direction = 'out' and v_kind <> 'out') or (d.direction = 'in' and v_kind <> 'in') then raise exception 'Оплата не совпадает с направлением долга'; end if;
    if v_amt > debt_left(d.id) + 0.004 then raise exception 'Сумма больше остатка долга (%)', debt_left(d.id); end if;
  end if;
  v_num := 'Ф-' || nextval('fin_op_seq');
  v_note := coalesce(nullif(p->>'note',''), nullif(p->>'counterparty',''), case when d.id is not null then 'Долг ' || d.num end);
  if v_kind = 'in' and a.kind = 'drawer' then v_ops := v_ops || fin_drawer_move(a, v_amt, v_num, v_note); end if;
  if v_kind in ('out','transfer') and a.kind = 'drawer' then v_ops := v_ops || fin_drawer_move(a, -v_amt, v_num, coalesce(v_note, case when v_kind='transfer' then 'Инкассация → ' || b.name end)); end if;
  if v_kind = 'transfer' and b.kind = 'drawer' then v_ops := v_ops || fin_drawer_move(b, v_amt, v_num, 'Из «' || a.name || '»'); end if;
  insert into fin_ops(num, op_date, kind, account_id, to_account_id, amount, category_id, debt_id, plan_id, counterparty, note, cash_op_ids)
    values (v_num, coalesce(nullif(p->>'op_date','')::date, current_date), v_kind, a.id, b.id, v_amt,
      case when v_kind = 'transfer' then null else nullif(p->>'category_id','')::uuid end, d.id, nullif(p->>'plan_id','')::uuid,
      coalesce(nullif(p->>'counterparty',''), d.counterparty), nullif(p->>'note',''), v_ops)
    returning id into v_id;
  if d.id is not null then perform debt_refresh(d.id); end if;
  -- плановый платёж: сдвинуть дату следующего
  if nullif(p->>'plan_id','') is not null then
    select * into pl from fin_plans where id = (p->>'plan_id')::uuid for update;
    if pl.id is not null then
      update fin_plans set next_date = case pl.period when 'week' then pl.next_date + 7 when 'month' then (pl.next_date + interval '1 month')::date
        when 'quarter' then (pl.next_date + interval '3 months')::date when 'year' then (pl.next_date + interval '1 year')::date else pl.next_date end,
        is_active = pl.period <> 'once' and pl.is_active where id = pl.id;
    end if;
  end if;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(),
    case v_kind when 'in' then 'Приход денег' when 'out' then 'Расход денег' else 'Перевод между счетами' end, v_num, v_amt::text || ' ₽ · ' || a.name);
  return v_id;
end $$;

-- отменить операцию: наличные в кассе возвращаются обратной записью (только пока смена открыта)
create or replace function fin_op_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare o fin_ops; c record; s uuid;
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  select * into o from fin_ops where id = p_id for update;
  if o.id is null or o.cancelled_at is not null then raise exception 'Операция не найдена или уже отменена'; end if;
  for c in select * from cash_ops where id = any(o.cash_op_ids) loop
    select id into s from shifts where id = c.shift_id and status = 'open';
    if s is null then raise exception 'Смена, в которой были наличные по операции %, уже закрыта. Сделайте обратную операцию', o.num; end if;
    if c.amount > 0 and shift_expected_cash(s) - c.amount < 0 then raise exception 'В кассе уже нет этих наличных (есть %) — отменить нельзя', shift_expected_cash(s); end if;
    insert into cash_ops(shift_id, point_id, type, method, amount, ref, note)
      values (c.shift_id, c.point_id, (case when c.amount >= 0 then 'cashout' else 'cashin' end)::cashop_type, 'cash', -c.amount, o.num, 'Отмена ' || o.num);
  end loop;
  update fin_ops set cancelled_at = now(), cancelled_by = auth.uid() where id = o.id;
  if o.debt_id is not null then perform debt_refresh(o.debt_id); end if;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Операция отменена', o.num, o.amount::text || ' ₽');
end $$;

-- долг вручную (займ, сотрудник, клиент, поставщик без приёмки…)
create or replace function debt_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_cp text := nullif(trim(p->>'counterparty'),'');
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if coalesce((p->>'amount')::numeric,0) <= 0 then raise exception 'Укажите сумму'; end if;
  if v_cp is null then
    v_cp := coalesce((select name from suppliers where id = nullif(p->>'supplier_id','')::uuid), (select name from customers where id = nullif(p->>'customer_id','')::uuid));
  end if;
  if v_cp is null then raise exception 'Укажите, кто должен или кому должны'; end if;
  insert into debts(direction, kind, counterparty, supplier_id, customer_id, amount, due_date, note)
    values (p->>'direction', coalesce(nullif(p->>'kind',''),'other'), v_cp, nullif(p->>'supplier_id','')::uuid, nullif(p->>'customer_id','')::uuid,
      round((p->>'amount')::numeric,2), nullif(p->>'due_date','')::date, nullif(p->>'note',''))
    returning id into v;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), case when p->>'direction'='in' then 'Записан долг нам' else 'Записан наш долг' end, v_cp, (p->>'amount') || ' ₽');
  return v;
end $$;

create or replace function debt_update(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare d debts; paid numeric;
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  select * into d from debts where id = p_id for update;
  if d.id is null then raise exception 'Долг не найден'; end if;
  paid := d.amount - debt_left(d.id);
  if p ? 'amount' and (p->>'amount')::numeric < paid then raise exception 'Сумма не может быть меньше уже оплаченного (%)', paid; end if;
  if p ? 'cancel' and (p->>'cancel')::boolean then
    if paid > 0 then raise exception 'По долгу уже есть оплаты — сначала отмените их'; end if;
    update debts set status = 'cancelled' where id = d.id;
    insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Долг отменён', d.num, d.counterparty);
    return;
  end if;
  update debts set amount = coalesce(round((p->>'amount')::numeric,2), amount),
    due_date = case when p ? 'due_date' then nullif(p->>'due_date','')::date else due_date end,
    note = case when p ? 'note' then nullif(p->>'note','') else note end,
    counterparty = coalesce(nullif(trim(p->>'counterparty'),''), counterparty) where id = d.id;
  perform debt_refresh(d.id);
end $$;

-- продажа с частью «в долг»: оплата 'debt' остаётся в чеке, но не попадает в кассу
create or replace function create_sale_debt(p_wh uuid, p_customer uuid, p_items jsonb, p_payments jsonb,
  p_discount numeric default 0, p_tradein_device text default null, p_tradein_amount numeric default 0, p_tradein_imei text default null,
  p_due date default null) returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale uuid; v_num text; v_debt numeric; c customers;
begin
  select coalesce(sum((x->>'amount')::numeric),0) into v_debt from jsonb_array_elements(p_payments) x where x->>'method' = 'debt';
  if v_debt <= 0 then raise exception 'Не указана сумма в долг'; end if;
  select * into c from customers where id = p_customer;
  if c.id is null then raise exception 'Для продажи в долг укажите покупателя с телефоном'; end if;
  if c.blacklisted then raise exception 'Клиент в чёрном списке — продажа в долг недоступна'; end if;
  v_sale := create_sale(p_wh, p_customer, p_items, p_payments, p_discount, p_tradein_device, p_tradein_amount, p_tradein_imei, 'store');
  select num into v_num from sales where id = v_sale;
  delete from cash_ops where ref = v_num and method = 'debt';
  insert into debts(direction, kind, counterparty, customer_id, sale_id, amount, due_date, note)
    values ('in', 'customer', coalesce(nullif(c.name,'Без имени'), '+7' || c.phone, 'Покупатель'), c.id, v_sale, round(v_debt,2), p_due, 'Продажа ' || v_num);
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Продажа в долг', v_num, v_debt::text || ' ₽ · ' || coalesce(c.name,''));
  return v_sale;
end $$;

-- приёмка от поставщика → наш долг поставщику (или сразу оплата, если при приёмке выбран счёт)
create or replace function fin_doc_posted() returns trigger language plpgsql security definer set search_path = public as $$
declare v_sum numeric; v_debt uuid; s suppliers;
begin
  if new.type <> 'in' or new.supplier_id is null then return new; end if;
  if new.status = 'posted' and old.status is distinct from 'posted' then
    select coalesce(sum(case when p.track_serial then (select coalesce(sum(u.cost),0) from units u where u.last_ref = new.num and u.product_id = l.product_id)
                             else coalesce(l.qty,0) * l.cost end),0)
      into v_sum from stock_doc_lines l join products p on p.id = l.product_id where l.doc_id = new.id;
    if v_sum <= 0 then return new; end if;
    select * into s from suppliers where id = new.supplier_id;
    insert into debts(direction, kind, counterparty, supplier_id, doc_id, amount, note, created_by)
      values ('out', 'supplier', s.name, s.id, new.id, round(v_sum,2), 'Приёмка ' || new.num || coalesce(', накладная ' || new.invoice, ''), new.posted_by)
      returning id into v_debt;
    if new.pay_account is not null then
      perform fin_op_create(jsonb_build_object('kind','out','account_id',new.pay_account,'amount',round(v_sum,2),'debt_id',v_debt,
        'category_id',(select id from fin_categories where name = 'Закупка товара' limit 1),'counterparty',s.name,'note','Оплата приёмки ' || new.num));
    end if;
  elsif new.status = 'cancelled' and old.status = 'posted' then
    update debts set status = 'cancelled', note = coalesce(note,'') || ' · приёмка отменена'
      where doc_id = new.id and status <> 'cancelled' and debt_left(id) = amount;
  end if;
  return new;
end $$;
drop trigger if exists trg_fin_doc on stock_docs;
create trigger trg_fin_doc after update of status on stock_docs for each row execute function fin_doc_posted();

revoke execute on function fin_drawer_move(fin_accounts, numeric, text, text), fin_doc_posted(), debt_refresh(uuid) from public, anon, authenticated;
revoke execute on function fin_setup(), fin_op_create(jsonb), fin_op_cancel(uuid), debt_create(jsonb), debt_update(uuid, jsonb), debt_left(uuid),
  create_sale_debt(uuid, uuid, jsonb, jsonb, numeric, text, numeric, text, date) from public, anon;
grant execute on function fin_setup(), fin_op_create(jsonb), fin_op_cancel(uuid), debt_create(jsonb), debt_update(uuid, jsonb),
  create_sale_debt(uuid, uuid, jsonb, jsonb, numeric, text, numeric, text, date) to authenticated;

-- реальное время для новых таблиц
do $$ declare t text; begin
  foreach t in array array['fin_accounts','fin_categories','fin_ops','debts','fin_plans'] loop
    begin execute format('alter publication supabase_realtime add table %I', t); exception when others then null; end;
  end loop;
end $$;
