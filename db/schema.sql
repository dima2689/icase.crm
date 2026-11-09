-- =====================================================================
-- iCase · единая база данных v3: сеть точек (Supabase / PostgreSQL 15+)
-- Одна база для CRM, приложения сотрудников и сайта.
-- Склады, документы, кассовые смены, возвраты, ремонт, роли, журнал.
-- Запуск: Supabase → SQL Editor → вставить файл целиком → Run.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- перечисления ----------
create type staff_role      as enum ('owner','manager','seller','master','storekeeper');
create type repair_status   as enum ('new','diag','approve','work','parts','ready','done','cancel');
create type pay_method      as enum ('cash','card','sbp','transfer');
create type move_type       as enum ('in','sale','return','repair','repair_back','writeoff','transfer_out','transfer_in','inventory','tradein','supret','cancel','import');
create type doc_type        as enum ('in','transfer','writeoff','inventory','supret');
create type doc_status      as enum ('draft','posted','cancelled');
create type cashop_type     as enum ('sale','refund','repair','prepay','cashin','cashout');
create type sale_channel    as enum ('store','site','avito','phone');

-- ---------- настройки ----------
create table settings (
  id int primary key default 1 check (id = 1),
  shop_name text not null default 'iCase', city text, address text, phone text, inn text,
  device_warranty_months int not null default 0,
  repair_warranty_days int not null default 90,
  require_shift boolean not null default true,
  storage_days int not null default 30,
  dead_days int not null default 60,
  receipt_footer text
);
insert into settings(id) values (1);

-- ---------- торговые точки ----------
create table points (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, address text, phone text,
  patent_no text,                                      -- патент ПСН точки
  evotor_store_id text,                                -- магазин в личном кабинете Эвотора
  cash_wh uuid, service_wh uuid,                       -- склад кассы и склад сервиса точки (связи ниже)
  sort int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- сотрудники ----------
create table staff (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role staff_role not null default 'seller',
  point_id uuid references points(id),                 -- основная точка (владельцу и управляющему не нужна)
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create function my_role() returns staff_role language sql stable security definer set search_path = public as
  $$ select role from staff where id = auth.uid() and is_active $$;
create function has_role(variadic roles staff_role[]) returns boolean language sql stable security definer set search_path = public as
  $$ select coalesce(my_role() = any(roles), false) $$;
create function is_staff() returns boolean language sql stable set search_path = public as $$ select my_role() is not null $$;
create function my_point() returns uuid language sql stable security definer set search_path = public as
  $$ select point_id from staff where id = auth.uid() and is_active $$;
-- может ли сотрудник работать на точке: владелец и управляющий — везде, остальные — на своей
create function can_work_at(p_point uuid) returns boolean language sql stable set search_path = public as
  $$ select has_role('owner','manager') or (is_staff() and my_point() = p_point) $$;

-- ---------- справочники ----------
create table warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, kind text, address text,
  point_id uuid references points(id),                 -- к какой точке относится (null — общий склад)
  sort int not null default 0, is_active boolean not null default true
);
alter table points add foreign key (cash_wh) references warehouses(id), add foreign key (service_wh) references warehouses(id);
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, parent_id uuid references categories(id),
  is_device boolean not null default false,
  unique (parent_id, name)
);
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null, inn text, contact text, phone text, note text
);
create table services (                                -- прайс работ сервиса
  id uuid primary key default gen_random_uuid(),
  name text not null, grp text, price numeric(12,2) not null default 0, is_active boolean not null default true
);

-- ---------- клиенты ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Без имени',
  phone text unique,                                   -- 10 цифр без +7
  phone2 text, email text, birthday date,
  source text, discount numeric(5,2) not null default 0 check (discount between 0 and 100),
  tags text[] not null default '{}',
  blacklisted boolean not null default false, black_reason text,
  note text,
  merged_into uuid references customers(id),           -- дубликат, объединён
  auth_user uuid references auth.users(id),            -- кабинет клиента на сайте
  woo_id bigint unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on customers using gin (to_tsvector('russian', name));

-- ---------- товары и остатки ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references categories(id),
  brand text, condition text not null default 'Новый',
  sku text unique, barcode text unique, serial text unique,   -- IMEI для поштучных
  cost numeric(12,2) not null default 0,               -- средняя закупочная
  last_cost numeric(12,2),
  price numeric(12,2) not null default 0,              -- розница (наличная цена)
  min_qty int not null default 0,
  warranty_months int not null default 0,
  battery_health int check (battery_health between 0 and 100),   -- ёмкость АКБ, %
  diagnostics text,                                    -- результат диагностики
  kit text,                                            -- комплектация
  avito_price numeric(12,2),                           -- цена на Авито (если отличается)
  ownership text not null default 'own' check (ownership in ('own','commission')),  -- своё или на комиссии
  consignor_id uuid,                                   -- комитент (клиент), для товара на комиссии
  consignor_payout numeric(12,2),                      -- сколько выплатить комитенту после продажи
  on_site boolean not null default false, on_avito boolean not null default false,
  is_archived boolean not null default false,
  description text, photos text[] not null default '{}',
  woo_id bigint unique, avito_id text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on products using gin (to_tsvector('russian', name || ' ' || coalesce(sku,'') || ' ' || coalesce(barcode,'') || ' ' || coalesce(serial,'')));

create table stock (                                   -- остаток по складам
  product_id uuid references products(id) on delete cascade,
  warehouse_id uuid references warehouses(id),
  qty int not null default 0 check (qty >= 0),
  primary key (product_id, warehouse_id)
);
create table stock_movements (                         -- единственный способ изменить остаток
  id bigint generated always as identity primary key,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  type move_type not null,
  qty int not null,
  ref text, note text,
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on stock_movements(product_id, created_at desc);

create function apply_movement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update stock set qty = qty + new.qty where product_id = new.product_id and warehouse_id = new.warehouse_id
    and qty + new.qty >= 0;
  if not found then
    if new.qty < 0 then
      raise exception 'Не хватает «%» на складе «%»', (select name from products where id = new.product_id), (select name from warehouses where id = new.warehouse_id);
    end if;
    insert into stock(product_id, warehouse_id, qty) values (new.product_id, new.warehouse_id, new.qty);
  end if;
  update products set updated_at = now() where id = new.product_id;
  return new;
end $$;
create trigger trg_apply_movement after insert on stock_movements for each row execute function apply_movement();

-- ---------- складские документы ----------
create table stock_docs (
  id uuid primary key default gen_random_uuid(),
  num text not null unique,
  type doc_type not null,
  status doc_status not null default 'draft',
  wh_from uuid references warehouses(id), wh_to uuid references warehouses(id),
  supplier_id uuid references suppliers(id), invoice text,
  reason text, category_id uuid references categories(id), note text,
  created_by uuid references staff(id) default auth.uid(), created_at timestamptz not null default now(),
  posted_by uuid references staff(id), posted_at timestamptz,
  cancelled_by uuid references staff(id), cancelled_at timestamptz
);
create table stock_doc_lines (
  id bigint generated always as identity primary key,
  doc_id uuid not null references stock_docs(id) on delete cascade,
  product_id uuid not null references products(id),
  qty int,                                             -- для прихода/перемещения/списания
  expected int, counted int,                           -- для инвентаризации
  cost numeric(12,2) not null default 0
);
create sequence doc_num_seq;

-- провести документ: все движения одной транзакцией
create function post_doc(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d stock_docs; l record; cur int; before_qty int;
begin
  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права проводить документы'; end if;
  select * into d from stock_docs where id = p_doc for update;
  if d.status <> 'draft' then raise exception 'Документ % уже проведён или отменён', d.num; end if;
  for l in select * from stock_doc_lines where doc_id = p_doc loop
    if d.type = 'in' then
      select coalesce(sum(qty),0) into before_qty from stock where product_id = l.product_id;
      insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'in',l.qty,d.num);
      if l.cost > 0 then                               -- средняя закупочная цена
        update products set last_cost = l.cost,
          cost = case when before_qty > 0 then round((before_qty*cost + l.qty*l.cost)/(before_qty+l.qty)) else l.cost end
        where id = l.product_id;
      end if;
    elsif d.type = 'transfer' then
      insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_from,'transfer_out',-l.qty,d.num);
      insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'transfer_in',l.qty,d.num);
    elsif d.type in ('writeoff','supret') then
      insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (l.product_id,d.wh_from,d.type::text::move_type,-l.qty,d.num,d.reason);
    elsif d.type = 'inventory' then
      if l.counted is null then raise exception 'Не все строки инвентаризации посчитаны'; end if;
      select coalesce(qty,0) into cur from stock where product_id = l.product_id and warehouse_id = d.wh_to;
      if coalesce(cur,0) <> l.counted then
        insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'inventory',l.counted-coalesce(cur,0),d.num);
      end if;
    end if;
  end loop;
  update stock_docs set status='posted', posted_by=auth.uid(), posted_at=now() where id = p_doc;
  insert into audit_log(action, ref) values ('Проведён документ', d.num);
end $$;

-- отменить проведение: обратные движения (не пройдёт, если товар уже ушёл)
create function cancel_doc(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d stock_docs; m record;
begin
  if not has_role('owner','manager') then raise exception 'Отменять документы может управляющий или владелец'; end if;
  select * into d from stock_docs where id = p_doc for update;
  if d.status <> 'posted' then raise exception 'Документ не проведён'; end if;
  for m in select product_id, warehouse_id, sum(qty) q from stock_movements where ref = d.num and type <> 'cancel' group by 1,2 loop
    if m.q <> 0 then insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (m.product_id,m.warehouse_id,'cancel',-m.q,d.num,'Отмена документа'); end if;
  end loop;
  update stock_docs set status='cancelled', cancelled_by=auth.uid(), cancelled_at=now() where id = p_doc;
  insert into audit_log(action, ref) values ('Отмена документа', d.num);
end $$;

-- ---------- кассовые смены ----------
create sequence shift_num_seq;
create table shifts (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'С-' || nextval('shift_num_seq'),
  point_id uuid not null references points(id),
  status text not null default 'open' check (status in ('open','closed')),
  opened_by uuid references staff(id) default auth.uid(), opened_at timestamptz not null default now(),
  open_cash numeric(12,2) not null default 0,
  closed_by uuid references staff(id), closed_at timestamptz,
  counted_cash numeric(12,2), expected_cash numeric(12,2), diff numeric(12,2), close_note text
);
create unique index one_open_shift_per_point on shifts (point_id) where status = 'open';   -- одна открытая смена на точку

create table cash_ops (
  id bigint generated always as identity primary key,
  shift_id uuid references shifts(id),
  type cashop_type not null,
  method pay_method not null,
  amount numeric(12,2) not null,                        -- + приход в кассу, − расход
  ref text, note text,
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create function current_shift(p_point uuid) returns uuid language sql stable set search_path = public as $$ select id from shifts where status='open' and point_id = p_point limit 1 $$;
create function shift_expected_cash(p_shift uuid) returns numeric language sql stable set search_path = public as
  $$ select s.open_cash + coalesce((select sum(amount) from cash_ops where shift_id = s.id and method = 'cash'),0) from shifts s where s.id = p_shift $$;
create function close_shift(p_point uuid, p_counted numeric, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare s uuid := current_shift(p_point); e numeric;
begin
  if not can_work_at(p_point) then raise exception 'Нет доступа к этой точке'; end if;
  if s is null then raise exception 'Нет открытой смены на точке'; end if;
  e := shift_expected_cash(s);
  if abs(p_counted - e) >= 1 and coalesce(p_note,'') = '' then raise exception 'Опишите причину расхождения %', p_counted - e; end if;
  update shifts set status='closed', closed_by=auth.uid(), closed_at=now(), counted_cash=p_counted, expected_cash=e, diff=p_counted-e, close_note=p_note where id = s;
end $$;

-- ---------- продажи ----------
create sequence sale_num_seq start 5001;
create table sales (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'П-' || nextval('sale_num_seq'),
  point_id uuid references points(id),
  warehouse_id uuid not null references warehouses(id),
  shift_id uuid references shifts(id),
  customer_id uuid references customers(id),
  channel sale_channel not null default 'store',
  subtotal numeric(12,2) not null, discount numeric(12,2) not null default 0,
  tradein_device text, tradein_imei text, tradein_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  status text not null default 'done' check (status in ('done','partial','returned')),
  fiscal_receipt_id text, woo_order_id bigint unique,
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table sale_items (
  id bigint generated always as identity primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id),
  name text not null, serial text,
  qty int not null check (qty > 0), price numeric(12,2) not null, line_discount numeric(12,2) not null default 0,
  cost numeric(12,2) not null default 0, warranty_months int not null default 0,
  kind text check (kind in ('goods','service'))  -- только у произвольных позиций (product_id is null)
);
create table sale_payments (
  id bigint generated always as identity primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  method pay_method not null, amount numeric(12,2) not null
);

-- items: [{"product_id":"…","qty":1,"price":47500,"discount":0}]  payments: [{"method":"cash","amount":47500}]
create function create_sale(p_wh uuid, p_customer uuid, p_items jsonb, p_payments jsonb,
  p_discount numeric default 0, p_tradein_device text default null, p_tradein_amount numeric default 0, p_tradein_imei text default null,
  p_channel sale_channel default 'store') returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale uuid; v_num text; v_sub numeric := 0; v_total numeric; v_paid numeric; it jsonb; p products;
        v_point uuid := (select point_id from warehouses where id = p_wh); v_shift uuid;
        st settings; v_ti uuid; v_cat uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права продавать'; end if;
  if p_channel = 'store' and not can_work_at(v_point) then raise exception 'Вы не можете продавать с этой точки'; end if;
  v_shift := current_shift(v_point);
  select * into st from settings where id = 1;
  if st.require_shift and v_shift is null then raise exception 'Откройте кассовую смену'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from products where id = (it->>'product_id')::uuid;
    if (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0)/(it->>'qty')::int < p.cost and not has_role('owner','manager') then
      raise exception '«%» дешевле закупки: нужно разрешение управляющего', p.name; end if;
    v_sub := v_sub + (it->>'qty')::int * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0);
  end loop;
  v_total := greatest(0, v_sub - p_discount - p_tradein_amount);
  select coalesce(sum((x->>'amount')::numeric),0) into v_paid from jsonb_array_elements(p_payments) x;
  if abs(v_paid - v_total) >= 0.5 then raise exception 'Оплата % не равна сумме чека %', v_paid, v_total; end if;
  insert into sales(point_id,warehouse_id,shift_id,customer_id,channel,subtotal,discount,tradein_device,tradein_imei,tradein_amount,total)
    values (v_point,p_wh,v_shift,p_customer,p_channel,v_sub,p_discount,p_tradein_device,p_tradein_imei,p_tradein_amount,v_total) returning id,num into v_sale,v_num;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from products where id = (it->>'product_id')::uuid;
    insert into sale_items(sale_id,product_id,name,serial,qty,price,line_discount,cost,warranty_months)
      values (v_sale,p.id,p.name,p.serial,(it->>'qty')::int,(it->>'price')::numeric,coalesce((it->>'discount')::numeric,0),p.cost,
        case when exists(select 1 from categories c where c.id=p.category_id and (c.is_device or exists(select 1 from categories pc where pc.id=c.parent_id and pc.is_device)))
             then coalesce(nullif(p.warranty_months,0), st.device_warranty_months) else p.warranty_months end);
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,p_wh,'sale',-(it->>'qty')::int,v_num);  -- остаток проверит check(qty>=0)
  end loop;
  insert into sale_payments(sale_id,method,amount) select v_sale,(x->>'method')::pay_method,(x->>'amount')::numeric from jsonb_array_elements(p_payments) x;
  insert into cash_ops(shift_id,type,method,amount,ref) select v_shift,'sale',(x->>'method')::pay_method,(x->>'amount')::numeric,v_num from jsonb_array_elements(p_payments) x where (x->>'amount')::numeric <> 0;
  if p_tradein_device is not null then
    select id into v_cat from categories where is_device and parent_id is null order by name limit 1;
    insert into products(name,category_id,condition,serial,cost,price,description)
      values (p_tradein_device,v_cat,'Б/у хорошее',p_tradein_imei,p_tradein_amount,p_tradein_amount,'Trade-in по '||v_num) returning id into v_ti;
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (v_ti,p_wh,'tradein',1,v_num);
  end if;
  insert into integration_jobs(target,action,payload) values ('kassa','sale_receipt',jsonb_build_object('sale_id',v_sale));
  insert into audit_log(action,ref,details) values ('Продажа',v_num,v_total::text);
  return v_sale;
end $$;

-- ---------- возвраты ----------
create sequence return_num_seq;
create table returns (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'В-' || nextval('return_num_seq'),
  sale_id uuid not null references sales(id),
  customer_id uuid references customers(id),
  amount numeric(12,2) not null, method pay_method not null,
  reason text not null, note text,
  warehouse_id uuid references warehouses(id), is_defect boolean not null default false,
  shift_id uuid references shifts(id),
  staff_id uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table return_items (
  id bigint generated always as identity primary key,
  return_id uuid not null references returns(id) on delete cascade,
  sale_item_id bigint not null references sale_items(id),
  qty int not null check (qty > 0)
);
-- items: [{"sale_item_id":1,"qty":1}]
create function create_return(p_sale uuid, p_items jsonb, p_amount numeric, p_method pay_method, p_reason text,
  p_wh uuid default null, p_defect boolean default false, p_note text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare s sales; v_ret uuid; v_num text; it jsonb; si sale_items; done_qty int; v_wh uuid; v_shift uuid; left_total int;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права оформлять возвраты'; end if;
  select * into s from sales where id = p_sale for update;
  v_shift := current_shift(coalesce(s.point_id,(select point_id from warehouses where id = s.warehouse_id)));
  if p_method = 'cash' and (v_shift is null or shift_expected_cash(v_shift) < p_amount) then raise exception 'Нет открытой смены или наличных в кассе'; end if;
  v_wh := coalesce(p_wh, s.warehouse_id);
  insert into returns(sale_id,customer_id,amount,method,reason,note,warehouse_id,is_defect,shift_id)
    values (p_sale,s.customer_id,p_amount,p_method,p_reason,p_note,v_wh,p_defect,v_shift) returning id,num into v_ret,v_num;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into si from sale_items where id = (it->>'sale_item_id')::bigint and sale_id = p_sale;
    select coalesce(sum(ri.qty),0) into done_qty from return_items ri where ri.sale_item_id = si.id;
    if done_qty + (it->>'qty')::int > si.qty then raise exception 'Нельзя вернуть больше, чем продано: %', si.name; end if;
    insert into return_items(return_id,sale_item_id,qty) values (v_ret,si.id,(it->>'qty')::int);
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (si.product_id,v_wh,'return',(it->>'qty')::int,v_num);
    if p_defect then insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (si.product_id,v_wh,'writeoff',-(it->>'qty')::int,v_num,'Брак по возврату'); end if;
  end loop;
  insert into cash_ops(shift_id,type,method,amount,ref,note) values (v_shift,'refund',p_method,-p_amount,v_num,'Возврат по '||s.num);
  select coalesce(sum(si2.qty),0) - coalesce((select sum(ri.qty) from return_items ri join sale_items x on x.id=ri.sale_item_id where x.sale_id=p_sale),0)
    into left_total from sale_items si2 where si2.sale_id = p_sale;
  update sales set status = case when left_total <= 0 then 'returned' else 'partial' end where id = p_sale;
  insert into audit_log(action,ref,details) values ('Возврат',v_num,s.num||' · '||p_amount);
  return v_ret;
end $$;

-- ---------- ремонт ----------
create sequence repair_num_seq start 1001;
create table repairs (
  id uuid primary key default gen_random_uuid(),
  num text not null unique default 'Р-' || nextval('repair_num_seq'),
  point_id uuid references points(id),                 -- где принят
  customer_id uuid not null references customers(id),
  device text not null, imei text, problem text not null,
  kit text, appearance text, device_pass text,
  status repair_status not null default 'new',
  master text, diagnosis text,
  estimate numeric(12,2) not null default 0,
  approved boolean, approved_sum numeric(12,2),
  final_price numeric(12,2) not null default 0,
  due_date date, ready_at timestamptz, closed_at timestamptz,
  warranty_days int not null default 90,
  warranty_of uuid references repairs(id),             -- гарантийное обращение
  cancel_reason text,
  fiscal_receipt_id text,
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on repairs(status);
create index on repairs(customer_id);
create table repair_services (
  id bigint generated always as identity primary key,
  repair_id uuid not null references repairs(id) on delete cascade,
  service_id uuid references services(id), name text not null, price numeric(12,2) not null default 0, qty int not null default 1
);
create table repair_parts (
  id bigint generated always as identity primary key,
  repair_id uuid not null references repairs(id) on delete cascade,
  product_id uuid not null references products(id), warehouse_id uuid not null references warehouses(id),
  name text not null, qty int not null default 1, price numeric(12,2) not null default 0, cost numeric(12,2) not null default 0,
  returned boolean not null default false
);
-- запчасть в ремонт = движение со склада сервиса
create function repair_part_move() returns trigger language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select num into n from repairs where id = coalesce(new.repair_id, old.repair_id);
  if tg_op = 'INSERT' then
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (new.product_id,new.warehouse_id,'repair',-new.qty,n);
  elsif tg_op = 'UPDATE' and new.returned and not old.returned then
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (new.product_id,new.warehouse_id,'repair_back',new.qty,n);
  end if;
  return new;
end $$;
create trigger trg_repair_part after insert or update of returned on repair_parts for each row execute function repair_part_move();

create table repair_history (
  id bigint generated always as identity primary key,
  repair_id uuid not null references repairs(id) on delete cascade,
  status repair_status not null, note text,
  staff_id uuid references staff(id) default auth.uid(),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create function log_repair_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into repair_history(repair_id,status) values (new.id,new.status);
    insert into integration_jobs(target,action,payload) values ('telegram','repair_status',jsonb_build_object('repair_id',new.id,'status',new.status));
  end if;
  return null;
end $$;
create trigger trg_repair_status after insert or update of status on repairs for each row execute function log_repair_status();

-- ---------- интеграции и журнал ----------
create table integration_jobs (
  id bigint generated always as identity primary key,
  target text not null check (target in ('woocommerce','avito','kassa','telegram','sms')),
  action text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','done','error')),
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), done_at timestamptz
);
create function queue_product_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.on_site or (tg_op='UPDATE' and old.on_site) then insert into integration_jobs(target,action,payload) values ('woocommerce','upsert_product',jsonb_build_object('product_id',new.id)); end if;
  if new.on_avito or (tg_op='UPDATE' and old.on_avito) then insert into integration_jobs(target,action,payload) values ('avito','upsert_product',jsonb_build_object('product_id',new.id)); end if;
  return new;
end $$;
create trigger trg_product_sync after insert or update of price, name, on_site, on_avito, updated_at on products for each row execute function queue_product_sync();

create table audit_log (
  id bigint generated always as identity primary key,
  staff_id uuid default auth.uid(), action text not null, ref text, details text,
  created_at timestamptz not null default now()
);
create function audit_price() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then insert into audit_log(action,ref,details) values ('Изменение цены',new.name,old.price||' → '||new.price); end if;
  return new;
end $$;
create trigger trg_audit_price after update of price on products for each row execute function audit_price();

-- ---------- представления ----------
create view v_stock with (security_invoker = true) as
  select p.id, p.name, c.name as category, w.name as warehouse, s.qty, p.cost, p.price
  from stock s join products p on p.id=s.product_id join warehouses w on w.id=s.warehouse_id left join categories c on c.id=p.category_id
  where s.qty <> 0;
create view v_point_revenue with (security_invoker = true) as                          -- выручка по точкам и дням
  select x.point_id, pt.name as point, x.d as day, sum(x.amount) as revenue from (
    select point_id, created_at::date as d, total as amount from sales
    union all select s.point_id, r.created_at::date, -r.amount from returns r join sales s on s.id = r.sale_id
    union all select point_id, closed_at::date, final_price from repairs where status in ('done','cancel')
  ) x left join points pt on pt.id = x.point_id group by 1,2,3;
create view v_low_stock with (security_invoker = true) as
  select p.id, p.name, p.min_qty, coalesce(sum(s.qty),0) as qty from products p left join stock s on s.product_id=p.id
  where not p.is_archived and p.min_qty > 0 group by p.id having coalesce(sum(s.qty),0) <= p.min_qty;
create view v_daily_revenue with (security_invoker = true) as
  select d as day, sum(amount) as revenue from (
    select created_at::date as d, total as amount from sales
    union all select created_at::date, -amount from returns
    union all select closed_at::date, final_price from repairs where status in ('done','cancel')
  ) x group by d;
-- каталог для сайта отдаёт Edge Function (публичного представления нет)

-- ---------- права (Row Level Security) ----------
do $$ declare t text; begin
  foreach t in array array['settings','points','staff','warehouses','categories','suppliers','services','customers','products','stock','stock_movements',
    'stock_docs','stock_doc_lines','shifts','cash_ops','sales','sale_items','sale_payments','returns','return_items','repairs','repair_services',
    'repair_parts','repair_history','integration_jobs','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy staff_read on %I for select using (is_staff())', t);
  end loop;
end $$;
-- запись по ролям (продажи, возвраты, проведение документов идут через функции выше)
create policy w_settings  on settings   for update using (has_role('owner','manager'));
create policy w_staff     on staff      for all using (has_role('owner')) with check (has_role('owner'));
create policy w_points    on points     for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy w_dicts1    on warehouses for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy w_dicts2    on categories for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy w_dicts3    on services   for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
create policy w_sup       on suppliers  for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
create policy w_cust      on customers  for all using (is_staff()) with check (is_staff());
create policy w_prod      on products   for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
create policy w_docs      on stock_docs for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
create policy w_doclines  on stock_doc_lines for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
create policy w_shift     on shifts     for insert with check (has_role('owner','manager','seller') and can_work_at(point_id));
create policy w_cash_in   on cash_ops   for insert with check (is_staff() and (type <> 'cashout' or has_role('owner','manager')));
create policy w_rep       on repairs    for all using (has_role('owner','manager','seller','master')) with check (has_role('owner','manager','seller','master'));
create policy w_rep_s     on repair_services for all using (has_role('owner','manager','seller','master')) with check (has_role('owner','manager','seller','master'));
create policy w_rep_p     on repair_parts    for all using (has_role('owner','manager','master')) with check (has_role('owner','manager','master'));
create policy w_jobs      on integration_jobs for update using (has_role('owner','manager'));
-- клиент с кабинетом видит свои ремонты (клиентское приложение)
create policy own_repairs on repairs for select using (customer_id in (select id from customers where auth_user = auth.uid()));

-- ---------- служебное ----------
create function touch() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;
create trigger t1 before update on customers for each row execute function touch();
create trigger t2 before update on repairs   for each row execute function touch();
alter publication supabase_realtime add table points, repairs, products, stock, sales, customers, shifts, cash_ops, stock_docs;

-- ---------- права на функции ----------
revoke execute on function apply_movement(), audit_price(), log_repair_status(), queue_product_sync(), repair_part_move(), touch() from public, anon, authenticated;
revoke execute on function my_role(), has_role(variadic staff_role[]), my_point(), is_staff(), can_work_at(uuid),
  current_shift(uuid), shift_expected_cash(uuid), post_doc(uuid), cancel_doc(uuid), close_shift(uuid, numeric, text),
  create_sale(uuid, uuid, jsonb, jsonb, numeric, text, numeric, text, sale_channel),
  create_return(uuid, jsonb, numeric, pay_method, text, uuid, boolean, text) from public, anon;
grant execute on function my_role(), has_role(variadic staff_role[]), my_point(), is_staff(), can_work_at(uuid),
  current_shift(uuid), shift_expected_cash(uuid), post_doc(uuid), cancel_doc(uuid), close_shift(uuid, numeric, text),
  create_sale(uuid, uuid, jsonb, jsonb, numeric, text, numeric, text, sale_channel),
  create_return(uuid, jsonb, numeric, pay_method, text, uuid, boolean, text) to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ============================================================
-- Миграции после основной схемы (применены 8 ноября 2026)
-- ============================================================

-- icase_v3_auth_bootstrap: заявки сотрудников, первый владелец, номера документов, касса→смена
create table staff_requests (
  id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  email text, full_name text,
  created_at timestamptz not null default now()
);
alter table staff_requests enable row level security;
create policy req_insert_own on staff_requests for insert to authenticated with check (id = auth.uid());
create policy req_read on staff_requests for select to authenticated using (id = auth.uid() or has_role('owner','manager'));
create policy req_delete on staff_requests for delete to authenticated using (has_role('owner'));

create function claim_owner(p_name text) returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  if exists (select 1 from staff) then raise exception 'Владелец уже назначен'; end if;
  insert into staff(id, full_name, role) values (auth.uid(), coalesce(nullif(p_name,''),'Владелец'), 'owner');
  delete from staff_requests where id = auth.uid();
  return 'owner';
end $$;
create function staff_exists() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from staff) $$;
revoke execute on function claim_owner(text), staff_exists() from public, anon;
grant execute on function claim_owner(text), staff_exists() to authenticated;

create function set_doc_num() returns trigger language plpgsql set search_path = public as $$
begin
  if new.num is null or new.num = '' then
    new.num := (case new.type when 'in' then 'ПР-' when 'transfer' then 'ПМ-' when 'writeoff' then 'СП-' when 'inventory' then 'ИН-' else 'ВП-' end) || nextval('doc_num_seq');
  end if;
  return new;
end $$;
create trigger trg_doc_num before insert on stock_docs for each row execute function set_doc_num();
revoke execute on function set_doc_num() from public, anon, authenticated;

alter table cash_ops add column point_id uuid references points(id);
create function set_cashop_shift() returns trigger language plpgsql set search_path = public as $$
begin
  if new.shift_id is null and new.point_id is not null then new.shift_id := current_shift(new.point_id); end if;
  return new;
end $$;
create trigger trg_cashop_shift before insert on cash_ops for each row execute function set_cashop_shift();
revoke execute on function set_cashop_shift() from public, anon, authenticated;

-- icase_v3_realtime_audit
alter publication supabase_realtime add table settings, staff, staff_requests, warehouses, categories, suppliers, services,
  stock_movements, stock_doc_lines, sale_items, sale_payments, returns, return_items, repair_services, repair_parts, repair_history, audit_log, integration_jobs;
create policy audit_insert on audit_log for insert to authenticated with check (is_staff() and staff_id = auth.uid());

-- icase_v3_merge_customers
create function merge_customers(p_from uuid, p_to uuid) returns void language plpgsql security definer set search_path = public as $$
declare a customers; b customers;
begin
  if not has_role('owner','manager') then raise exception 'Объединять клиентов может управляющий или владелец'; end if;
  if p_from = p_to then raise exception 'Это один и тот же клиент'; end if;
  select * into a from customers where id = p_from for update;
  select * into b from customers where id = p_to for update;
  if a.id is null or b.id is null then raise exception 'Клиент не найден'; end if;
  update sales set customer_id = p_to where customer_id = p_from;
  update returns set customer_id = p_to where customer_id = p_from;
  update repairs set customer_id = p_to where customer_id = p_from;
  update products set consignor_id = p_to where consignor_id = p_from;
  update customers set phone = null, merged_into = p_to where id = p_from;
  update customers set note = nullif(concat_ws(E'\n', b.note, a.note), ''),
    tags = array(select distinct unnest(b.tags || a.tags)),
    phone2 = coalesce(b.phone2, a.phone) where id = p_to;
  insert into audit_log(action, ref) values ('Объединение клиентов', a.name || ' → ' || b.name);
end $$;
revoke execute on function merge_customers(uuid, uuid) from public, anon;
grant execute on function merge_customers(uuid, uuid) to authenticated;

-- icase_v3_receipt_fields: реквизиты для документов, модель/память/цвет, снимок характеристик в строке продажи
alter table settings
  add column legal_name text,            -- «ИП Фамилия Имя Отчество»
  add column ogrnip text,
  add column site_url text,
  add column review_url text,
  add column receipt_ack text not null default 'Устройство осмотрено, проверено, претензий к внешнему виду и комплектации не имею.';
alter table products add column model text, add column memory text, add column color text;
alter table sale_items
  add column model text, add column memory text, add column color text,
  add column condition text, add column battery_health int, add column kit text;
create function snapshot_sale_item() returns trigger language plpgsql security definer set search_path = public as $$
declare p products;
begin
  if new.product_id is not null then
    select * into p from products where id = new.product_id;
    new.model := coalesce(new.model, p.model); new.memory := coalesce(new.memory, p.memory); new.color := coalesce(new.color, p.color);
    new.condition := coalesce(new.condition, p.condition); new.battery_health := coalesce(new.battery_health, p.battery_health); new.kit := coalesce(new.kit, p.kit);
  end if;
  return new;
end $$;
create trigger trg_sale_item_snapshot before insert on sale_items for each row execute function snapshot_sale_item();
revoke execute on function snapshot_sale_item() from public, anon, authenticated;

-- icase_v3_print_config: шаблон товарного чека и свои шаблоны ценников
alter table settings
  add column doc_config jsonb not null default '{}'::jsonb,
  add column tag_templates jsonb not null default '[]'::jsonb;

-- icase_v3_serials: серийный учёт по IMEI / SN, каталог моделей Apple
-- ================= серийный учёт: единицы техники по IMEI / серийному номеру =================
create type unit_status as enum ('in_stock','sold','written_off','returned_supplier','in_repair','reserved');

create table apple_models (                              -- справочник моделей Apple
  id uuid primary key default gen_random_uuid(),
  family text not null,                                  -- iPhone, iPad, Mac, Apple Watch, AirPods, Другое
  name text not null,
  year int,
  memories text[] not null default '{}',
  colors text[] not null default '{}',
  options jsonb not null default '{}'::jsonb,            -- {"SIM":["nano-SIM + eSIM","eSIM"],"ОЗУ":["16 ГБ","24 ГБ"]}
  sort int not null default 0,
  is_active boolean not null default true,
  unique (family, name)
);

alter table products
  add column track_serial boolean not null default false,  -- учёт по IMEI / серийным номерам
  add column attrs jsonb not null default '{}'::jsonb,       -- SIM, ОЗУ, размер корпуса, сеть и т.п.
  add column catalog_id uuid references apple_models(id) on delete set null;

create table units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  imei text, imei2 text, serial_no text,
  warehouse_id uuid references warehouses(id),
  status unit_status not null default 'in_stock',
  condition text,
  battery_health int check (battery_health between 0 and 100),
  diagnostics text, kit text,
  cost numeric(12,2) not null default 0,
  price numeric(12,2),                                     -- своя цена экземпляра (б/у); пусто — цена товара
  note text,
  sale_item_id bigint references sale_items(id),
  last_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (imei is not null or serial_no is not null)
);
create unique index units_imei_uq on units(imei) where imei is not null;
create unique index units_imei2_uq on units(imei2) where imei2 is not null;
create unique index units_sn_uq on units(upper(serial_no)) where serial_no is not null;
create index units_product_idx on units(product_id, status);
create index units_wh_idx on units(warehouse_id) where status = 'in_stock';
create trigger t3 before update on units for each row execute function touch();

alter table sale_items add column unit_id uuid references units(id);
alter table stock_doc_lines
  add column new_units jsonb not null default '[]'::jsonb,  -- приход: [{imei, imei2, serial_no, condition, battery_health, price, cost, kit, diagnostics}]
  add column unit_ids uuid[] not null default '{}',         -- перемещение / списание / возврат поставщику
  add column found_codes text[] not null default '{}',      -- инвентаризация: отсканированные IMEI / SN
  add column unit_log jsonb not null default '[]'::jsonb;   -- что изменилось при проведении (для отмены)

-- найти единицу по любому коду
create function find_unit(p_code text) returns units language sql stable set search_path = public as $$
  select * from units where imei = trim(p_code) or imei2 = trim(p_code) or upper(serial_no) = upper(trim(p_code)) limit 1
$$;

-- принять единицу на склад: новая или ранее проданная/списанная (тот же IMEI вернулся через trade-in или выкуп)
create function unit_receive(p_product uuid, p_wh uuid, p jsonb, p_cost numeric, p_ref text, out o_id uuid, out o_created boolean, out o_before jsonb)
language plpgsql security definer set search_path = public as $$
declare v_imei text := nullif(trim(p->>'imei'),''); v_sn text := nullif(trim(p->>'serial_no'),''); v_imei2 text := nullif(trim(p->>'imei2'),'');
        u units; pr products;
begin
  if v_imei is null and v_sn is null then raise exception 'Укажите IMEI или серийный номер'; end if;
  select * into pr from products where id = p_product;
  select * into u from units where (v_imei is not null and (imei = v_imei or imei2 = v_imei)) or (v_sn is not null and upper(serial_no) = upper(v_sn)) limit 1 for update;
  if u.id is not null then
    if u.status in ('in_stock','reserved','in_repair') then
      raise exception 'IMEI/SN % уже числится на складе («%»)', coalesce(v_imei, v_sn), (select name from products where id = u.product_id);
    end if;
    o_before := jsonb_build_object('product_id',u.product_id,'wh',u.warehouse_id,'status',u.status,'cost',u.cost,'price',u.price,'condition',u.condition,'battery_health',u.battery_health,'sale_item_id',u.sale_item_id);
    update units set product_id = p_product, warehouse_id = p_wh, status = 'in_stock', sale_item_id = null, last_ref = p_ref,
      imei = coalesce(v_imei, imei), imei2 = coalesce(v_imei2, imei2), serial_no = coalesce(v_sn, serial_no),
      cost = coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), price = nullif(p->>'price','')::numeric,
      condition = coalesce(nullif(p->>'condition',''), pr.condition), battery_health = nullif(p->>'battery_health','')::int,
      kit = coalesce(nullif(p->>'kit',''), pr.kit), diagnostics = nullif(p->>'diagnostics','')
    where id = u.id;
    o_id := u.id; o_created := false;
  else
    insert into units(product_id, imei, imei2, serial_no, warehouse_id, status, condition, battery_health, kit, diagnostics, cost, price, last_ref)
    values (p_product, v_imei, v_imei2, v_sn, p_wh, 'in_stock', coalesce(nullif(p->>'condition',''), pr.condition), nullif(p->>'battery_health','')::int,
      coalesce(nullif(p->>'kit',''), pr.kit), nullif(p->>'diagnostics',''), coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), nullif(p->>'price','')::numeric, p_ref)
    returning id into o_id;
    o_created := true; o_before := null;
  end if;
end $$;

-- провести документ (с серийным учётом)
create or replace function post_doc(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d stock_docs; l record; p products; cur int; before_qty int; n int; r record; u units; lg jsonb; code text; seen uuid[];
begin
  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права проводить документы'; end if;
  select * into d from stock_docs where id = p_doc for update;
  if d.status <> 'draft' then raise exception 'Документ % уже проведён или отменён', d.num; end if;
  for l in select * from stock_doc_lines where doc_id = p_doc order by id loop
    select * into p from products where id = l.product_id;
    lg := '[]'::jsonb;
    if p.track_serial then
      ---------------- серийный товар ----------------
      if d.type = 'in' then
        n := jsonb_array_length(l.new_units);
        if n = 0 then raise exception 'Укажите IMEI / серийные номера для «%»', p.name; end if;
        select coalesce(sum(qty),0) into before_qty from stock where product_id = p.id;
        for r in select * from unit_receive_all(p.id, d.wh_to, l.new_units, l.cost, d.num) loop
          lg := lg || jsonb_build_object('id',r.o_id,'created',r.o_created,'before',r.o_before,'after',jsonb_build_object('wh',d.wh_to,'status','in_stock'));
        end loop;
        insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,d.wh_to,'in',n,d.num);
        if l.cost > 0 then
          update products set last_cost = l.cost, cost = case when before_qty > 0 then round((before_qty*cost + n*l.cost)/(before_qty+n)) else l.cost end where id = p.id;
        end if;
        update stock_doc_lines set qty = n, unit_log = lg where id = l.id;
      elsif d.type in ('transfer','writeoff','supret') then
        n := coalesce(array_length(l.unit_ids,1),0);
        if n = 0 then raise exception 'Выберите экземпляры (IMEI / SN) для «%»', p.name; end if;
        for u in select * from units where id = any(l.unit_ids) for update loop
          if u.product_id <> p.id or u.status <> 'in_stock' or u.warehouse_id is distinct from d.wh_from then
            raise exception 'IMEI/SN % нет в наличии на складе «%»', coalesce(u.imei,u.serial_no), (select name from warehouses where id = d.wh_from);
          end if;
          lg := lg || jsonb_build_object('id',u.id,'created',false,'before',jsonb_build_object('wh',u.warehouse_id,'status',u.status),
            'after',jsonb_build_object('wh',case when d.type='transfer' then d.wh_to end,'status',case d.type when 'transfer' then 'in_stock' when 'writeoff' then 'written_off' else 'returned_supplier' end));
          update units set warehouse_id = case when d.type='transfer' then d.wh_to end,
            status = case d.type when 'transfer' then 'in_stock' when 'writeoff' then 'written_off' else 'returned_supplier' end::unit_status, last_ref = d.num where id = u.id;
        end loop;
        if jsonb_array_length(lg) <> n then raise exception 'Часть выбранных экземпляров «%» не найдена', p.name; end if;
        if d.type = 'transfer' then
          insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,d.wh_from,'transfer_out',-n,d.num);
          insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,d.wh_to,'transfer_in',n,d.num);
        else
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (p.id,d.wh_from,d.type::text::move_type,-n,d.num,d.reason);
        end if;
        update stock_doc_lines set qty = n, unit_log = lg where id = l.id;
      elsif d.type = 'inventory' then
        select coalesce(qty,0) into cur from stock where product_id = p.id and warehouse_id = d.wh_to;
        cur := coalesce(cur,0); seen := '{}';
        foreach code in array l.found_codes loop
          select * into u from units where imei = trim(code) or imei2 = trim(code) or upper(serial_no) = upper(trim(code)) limit 1 for update;
          if u.id is null then raise exception 'IMEI/SN % не числится в базе — оформите приход', code; end if;
          if u.product_id <> p.id then raise exception 'IMEI/SN % относится к товару «%»', code, (select name from products where id = u.product_id); end if;
          if u.status <> 'in_stock' then raise exception 'IMEI/SN % числится как %', code, case u.status when 'sold' then 'проданный' when 'written_off' then 'списанный' when 'returned_supplier' then 'возвращённый поставщику' else u.status::text end; end if;
          if u.id = any(seen) then continue; end if;
          seen := seen || u.id;
          if u.warehouse_id is distinct from d.wh_to then        -- нашли на этом складе, а числился на другом
            lg := lg || jsonb_build_object('id',u.id,'created',false,'before',jsonb_build_object('wh',u.warehouse_id,'status',u.status),'after',jsonb_build_object('wh',d.wh_to,'status','in_stock'));
            insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (p.id,u.warehouse_id,'inventory',-1,d.num,'Найден на складе '||(select name from warehouses where id = d.wh_to));
            update units set warehouse_id = d.wh_to, last_ref = d.num where id = u.id;
          end if;
        end loop;
        for u in select * from units where product_id = p.id and status = 'in_stock' and warehouse_id = d.wh_to and not (id = any(seen)) for update loop
          lg := lg || jsonb_build_object('id',u.id,'created',false,'before',jsonb_build_object('wh',u.warehouse_id,'status',u.status),'after',jsonb_build_object('wh',null,'status','written_off'));
          update units set status = 'written_off', warehouse_id = null, last_ref = d.num, note = concat_ws(E'\n', note, 'Недостача по '||d.num) where id = u.id;
        end loop;
        n := coalesce(array_length(seen,1),0);
        if n <> cur then insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,d.wh_to,'inventory',n-cur,d.num); end if;
        update stock_doc_lines set counted = n, unit_log = lg where id = l.id;
      end if;
    else
      ---------------- обычный товар ----------------
      if d.type = 'in' then
        select coalesce(sum(qty),0) into before_qty from stock where product_id = l.product_id;
        insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'in',l.qty,d.num);
        if l.cost > 0 then
          update products set last_cost = l.cost,
            cost = case when before_qty > 0 then round((before_qty*cost + l.qty*l.cost)/(before_qty+l.qty)) else l.cost end
          where id = l.product_id;
        end if;
      elsif d.type = 'transfer' then
        insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_from,'transfer_out',-l.qty,d.num);
        insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'transfer_in',l.qty,d.num);
      elsif d.type in ('writeoff','supret') then
        insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (l.product_id,d.wh_from,d.type::text::move_type,-l.qty,d.num,d.reason);
      elsif d.type = 'inventory' then
        if l.counted is null then raise exception 'Не все строки инвентаризации посчитаны'; end if;
        select coalesce(qty,0) into cur from stock where product_id = l.product_id and warehouse_id = d.wh_to;
        if coalesce(cur,0) <> l.counted then
          insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (l.product_id,d.wh_to,'inventory',l.counted-coalesce(cur,0),d.num);
        end if;
      end if;
    end if;
  end loop;
  update stock_docs set status='posted', posted_by=auth.uid(), posted_at=now() where id = p_doc;
  insert into audit_log(action, ref) values ('Проведён документ', d.num);
end $$;

-- приход всех единиц строки
create function unit_receive_all(p_product uuid, p_wh uuid, p_units jsonb, p_cost numeric, p_ref text)
returns table(o_id uuid, o_created boolean, o_before jsonb) language plpgsql security definer set search_path = public as $$
declare x jsonb; r record;
begin
  for x in select * from jsonb_array_elements(p_units) loop
    select * into r from unit_receive(p_product, p_wh, x, p_cost, p_ref);
    o_id := r.o_id; o_created := r.o_created; o_before := r.o_before; return next;
  end loop;
end $$;

-- отменить проведение (с возвратом экземпляров в прежнее состояние)
create or replace function cancel_doc(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
declare d stock_docs; m record; l record; e jsonb; u units;
begin
  if not has_role('owner','manager') then raise exception 'Отменять документы может управляющий или владелец'; end if;
  select * into d from stock_docs where id = p_doc for update;
  if d.status <> 'posted' then raise exception 'Документ не проведён'; end if;
  for l in select * from stock_doc_lines where doc_id = p_doc loop
    for e in select * from jsonb_array_elements(l.unit_log) loop
      select * into u from units where id = (e->>'id')::uuid for update;
      if u.id is null then continue; end if;
      if u.status::text <> e->'after'->>'status' or u.warehouse_id is distinct from nullif(e->'after'->>'wh','')::uuid then
        raise exception 'IMEI/SN % уже продан или перемещён после этого документа — отменить нельзя', coalesce(u.imei,u.serial_no);
      end if;
      if u.product_id <> l.product_id then
        raise exception 'IMEI/SN % уже относится к другому товару — отменить нельзя', coalesce(u.imei,u.serial_no);
      end if;
      if (e->>'created')::boolean then
        if exists(select 1 from sale_items where unit_id = u.id) then
          raise exception 'IMEI/SN % уже участвовал в продажах — отменить приход нельзя', coalesce(u.imei,u.serial_no);
        end if;
        delete from units where id = u.id;
      elsif e->'before' ? 'product_id' then
        update units set product_id = (e->'before'->>'product_id')::uuid, warehouse_id = nullif(e->'before'->>'wh','')::uuid, status = (e->'before'->>'status')::unit_status,
          cost = (e->'before'->>'cost')::numeric, price = nullif(e->'before'->>'price','')::numeric, condition = e->'before'->>'condition',
          battery_health = nullif(e->'before'->>'battery_health','')::int, sale_item_id = nullif(e->'before'->>'sale_item_id','')::bigint where id = u.id;
      else
        update units set warehouse_id = nullif(e->'before'->>'wh','')::uuid, status = (e->'before'->>'status')::unit_status where id = u.id;
      end if;
    end loop;
  end loop;
  for m in select product_id, warehouse_id, sum(qty) q from stock_movements where ref = d.num and type <> 'cancel' group by 1,2 loop
    if m.q <> 0 then insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (m.product_id,m.warehouse_id,'cancel',-m.q,d.num,'Отмена документа'); end if;
  end loop;
  update stock_docs set status='cancelled', cancelled_by=auth.uid(), cancelled_at=now() where id = p_doc;
  insert into audit_log(action, ref) values ('Отмена документа', d.num);
end $$;

-- продажа: серийный товар продаётся конкретным экземпляром
-- items: [{"product_id":"…","unit_id":"…","qty":1,"price":47500,"discount":0}]
create or replace function create_sale(p_wh uuid, p_customer uuid, p_items jsonb, p_payments jsonb,
  p_discount numeric default 0, p_tradein_device text default null, p_tradein_amount numeric default 0, p_tradein_imei text default null,
  p_channel sale_channel default 'store') returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale uuid; v_num text; v_sub numeric := 0; v_total numeric; v_paid numeric; it jsonb; p products; u units; v_cost numeric;
        v_point uuid := (select point_id from warehouses where id = p_wh); v_shift uuid; v_si bigint;
        st settings; v_ti uuid; v_cat uuid; v_code text;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права продавать'; end if;
  if p_channel = 'store' and not can_work_at(v_point) then raise exception 'Вы не можете продавать с этой точки'; end if;
  v_shift := current_shift(v_point);
  select * into st from settings where id = 1;
  if st.require_shift and v_shift is null and p_channel = 'store' then raise exception 'Откройте кассовую смену'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it->>'product_id','') is null then  -- произвольная позиция: товар или услуга не из справочника
      if nullif(trim(coalesce(it->>'name','')),'') is null then raise exception 'Укажите название произвольной позиции'; end if;
      if coalesce((it->>'qty')::int,0) < 1 or coalesce((it->>'price')::numeric,-1) < 0 then raise exception 'Проверьте количество и цену «%»', it->>'name'; end if;
      v_sub := v_sub + (it->>'qty')::int * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0);
      continue;
    end if;
    select * into p from products where id = (it->>'product_id')::uuid;
    v_cost := p.cost;
    if p.track_serial then
      if nullif(it->>'unit_id','') is null then raise exception 'Выберите IMEI / серийный номер для «%»', p.name; end if;
      if (it->>'qty')::int <> 1 then raise exception 'Серийный товар продаётся по одной штуке'; end if;
      select cost into v_cost from units where id = (it->>'unit_id')::uuid;
    end if;
    if (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0)/(it->>'qty')::int < coalesce(v_cost,0) and not has_role('owner','manager') then
      raise exception '«%» дешевле закупки: нужно разрешение управляющего', p.name; end if;
    v_sub := v_sub + (it->>'qty')::int * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0);
  end loop;
  v_total := greatest(0, v_sub - p_discount - p_tradein_amount);
  select coalesce(sum((x->>'amount')::numeric),0) into v_paid from jsonb_array_elements(p_payments) x;
  if abs(v_paid - v_total) >= 0.5 then raise exception 'Оплата % не равна сумме чека %', v_paid, v_total; end if;
  insert into sales(point_id,warehouse_id,shift_id,customer_id,channel,subtotal,discount,tradein_device,tradein_imei,tradein_amount,total)
    values (v_point,p_wh,v_shift,p_customer,p_channel,v_sub,p_discount,p_tradein_device,p_tradein_imei,p_tradein_amount,v_total) returning id,num into v_sale,v_num;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it->>'product_id','') is null then
      insert into sale_items(sale_id,product_id,name,kind,serial,qty,price,line_discount,cost,warranty_months)
        values (v_sale,null,trim(it->>'name'),case when it->>'kind'='goods' then 'goods' else 'service' end,nullif(trim(coalesce(it->>'serial','')),''),
          (it->>'qty')::int,(it->>'price')::numeric,coalesce((it->>'discount')::numeric,0),
          case when has_role('owner','manager') then coalesce((it->>'cost')::numeric,0) else 0 end,coalesce((it->>'warranty')::int,0));
      continue;
    end if;
    select * into p from products where id = (it->>'product_id')::uuid;
    u := null;
    if p.track_serial then
      select * into u from units where id = (it->>'unit_id')::uuid for update;
      if u.id is null or u.product_id <> p.id or u.status <> 'in_stock' or u.warehouse_id is distinct from p_wh then
        raise exception 'IMEI/SN % нет в наличии на складе «%»', coalesce(u.imei,u.serial_no,'?'), (select name from warehouses where id = p_wh);
      end if;
    end if;
    insert into sale_items(sale_id,product_id,unit_id,name,serial,qty,price,line_discount,cost,warranty_months,condition,battery_health,kit)
      values (v_sale,p.id,u.id,p.name,coalesce(u.imei,u.serial_no,p.serial),(it->>'qty')::int,(it->>'price')::numeric,coalesce((it->>'discount')::numeric,0),coalesce(u.cost,p.cost),
        case when exists(select 1 from categories c where c.id=p.category_id and (c.is_device or exists(select 1 from categories pc where pc.id=c.parent_id and pc.is_device)))
             then coalesce(nullif(p.warranty_months,0), st.device_warranty_months) else p.warranty_months end,
        coalesce(u.condition,p.condition),coalesce(u.battery_health,p.battery_health),coalesce(u.kit,p.kit))
      returning id into v_si;
    if u.id is not null then update units set status = 'sold', warehouse_id = null, sale_item_id = v_si, last_ref = v_num where id = u.id; end if;
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,p_wh,'sale',-(it->>'qty')::int,v_num);
  end loop;
  insert into sale_payments(sale_id,method,amount) select v_sale,(x->>'method')::pay_method,(x->>'amount')::numeric from jsonb_array_elements(p_payments) x;
  insert into cash_ops(shift_id,type,method,amount,ref) select v_shift,'sale',(x->>'method')::pay_method,(x->>'amount')::numeric,v_num from jsonb_array_elements(p_payments) x where (x->>'amount')::numeric <> 0;
  if p_tradein_device is not null then
    select id into v_cat from categories where is_device and parent_id is null order by name limit 1;
    v_code := nullif(trim(coalesce(p_tradein_imei,'')),'');
    insert into products(name,category_id,condition,serial,cost,price,description,track_serial)
      values (p_tradein_device,v_cat,'Б/у хорошее',null,p_tradein_amount,p_tradein_amount,'Trade-in по '||v_num,v_code is not null) returning id into v_ti;
    if v_code is not null then
      perform unit_receive(v_ti, p_wh, case when v_code ~ '^\d{15}$' then jsonb_build_object('imei',v_code) else jsonb_build_object('serial_no',v_code) end, p_tradein_amount, v_num);
    end if;
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (v_ti,p_wh,'tradein',1,v_num);
  end if;
  insert into integration_jobs(target,action,payload) values ('kassa','sale_receipt',jsonb_build_object('sale_id',v_sale));
  insert into audit_log(action,ref,details) values ('Продажа',v_num,v_total::text);
  return v_sale;
end $$;

-- возврат: экземпляр возвращается на склад или списывается как брак
create or replace function create_return(p_sale uuid, p_items jsonb, p_amount numeric, p_method pay_method, p_reason text,
  p_wh uuid default null, p_defect boolean default false, p_note text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare s sales; v_ret uuid; v_num text; it jsonb; si sale_items; done_qty int; v_wh uuid; v_shift uuid; left_total int;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права оформлять возвраты'; end if;
  select * into s from sales where id = p_sale for update;
  v_shift := current_shift(coalesce(s.point_id,(select point_id from warehouses where id = s.warehouse_id)));
  if p_method = 'cash' and (v_shift is null or shift_expected_cash(v_shift) < p_amount) then raise exception 'Нет открытой смены или наличных в кассе'; end if;
  v_wh := coalesce(p_wh, s.warehouse_id);
  insert into returns(sale_id,customer_id,amount,method,reason,note,warehouse_id,is_defect,shift_id)
    values (p_sale,s.customer_id,p_amount,p_method,p_reason,p_note,v_wh,p_defect,v_shift) returning id,num into v_ret,v_num;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into si from sale_items where id = (it->>'sale_item_id')::bigint and sale_id = p_sale;
    select coalesce(sum(ri.qty),0) into done_qty from return_items ri where ri.sale_item_id = si.id;
    if done_qty + (it->>'qty')::int > si.qty then raise exception 'Нельзя вернуть больше, чем продано: %', si.name; end if;
    insert into return_items(return_id,sale_item_id,qty) values (v_ret,si.id,(it->>'qty')::int);
    if si.product_id is not null then
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (si.product_id,v_wh,'return',(it->>'qty')::int,v_num);
    if p_defect then insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (si.product_id,v_wh,'writeoff',-(it->>'qty')::int,v_num,'Брак по возврату'); end if;
    end if;
    if si.unit_id is not null then
      update units set status = case when p_defect then 'written_off' else 'in_stock' end::unit_status, warehouse_id = case when p_defect then null else v_wh end,
        sale_item_id = case when p_defect then sale_item_id end, last_ref = v_num where id = si.unit_id;
    end if;
  end loop;
  insert into cash_ops(shift_id,type,method,amount,ref,note) values (v_shift,'refund',p_method,-p_amount,v_num,'Возврат по '||s.num);
  select coalesce(sum(si2.qty),0) - coalesce((select sum(ri.qty) from return_items ri join sale_items x on x.id=ri.sale_item_id where x.sale_id=p_sale),0)
    into left_total from sale_items si2 where si2.sale_id = p_sale;
  update sales set status = case when left_total <= 0 then 'returned' else 'partial' end where id = p_sale;
  insert into audit_log(action,ref,details) values ('Возврат',v_num,s.num||' · '||p_amount);
  return v_ret;
end $$;

-- права
alter table units enable row level security;
alter table apple_models enable row level security;
create policy staff_read on units for select using (is_staff());
create policy staff_read on apple_models for select using (is_staff());
create policy w_units on units for update using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
create policy w_models on apple_models for all using (has_role('owner','manager')) with check (has_role('owner','manager'));
revoke insert, update, delete on units from authenticated;
grant update (condition, battery_health, diagnostics, kit, price, note, imei, imei2, serial_no) on units to authenticated;
revoke all on units, apple_models from anon;
revoke execute on function find_unit(text), unit_receive(uuid,uuid,jsonb,numeric,text), unit_receive_all(uuid,uuid,jsonb,numeric,text) from public, anon, authenticated;
alter publication supabase_realtime add table units, apple_models;

-- icase_v3_print_config / icase_v3_used_attrs: параметры б/у у экземпляра, категория «б/у»
alter table units add column attrs jsonb not null default '{}'::jsonb;
grant update (attrs) on units to authenticated;
alter table categories add column is_used boolean not null default false;
create or replace function unit_receive(p_product uuid, p_wh uuid, p jsonb, p_cost numeric, p_ref text, out o_id uuid, out o_created boolean, out o_before jsonb)
language plpgsql security definer set search_path = public as $$
declare v_imei text := nullif(trim(p->>'imei'),''); v_sn text := nullif(trim(p->>'serial_no'),''); v_imei2 text := nullif(trim(p->>'imei2'),'');
        u units; pr products; v_attrs jsonb := coalesce(p->'attrs','{}'::jsonb);
begin
  if v_imei is null and v_sn is null then raise exception 'Укажите IMEI или серийный номер'; end if;
  select * into pr from products where id = p_product;
  select * into u from units where (v_imei is not null and (imei = v_imei or imei2 = v_imei)) or (v_sn is not null and upper(serial_no) = upper(v_sn)) limit 1 for update;
  if u.id is not null then
    if u.status in ('in_stock','reserved','in_repair') then
      raise exception 'IMEI/SN % уже числится на складе («%»)', coalesce(v_imei, v_sn), (select name from products where id = u.product_id);
    end if;
    o_before := jsonb_build_object('product_id',u.product_id,'wh',u.warehouse_id,'status',u.status,'cost',u.cost,'price',u.price,'condition',u.condition,'battery_health',u.battery_health,'sale_item_id',u.sale_item_id);
    update units set product_id = p_product, warehouse_id = p_wh, status = 'in_stock', sale_item_id = null, last_ref = p_ref,
      imei = coalesce(v_imei, imei), imei2 = coalesce(v_imei2, imei2), serial_no = coalesce(v_sn, serial_no),
      cost = coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), price = nullif(p->>'price','')::numeric,
      condition = coalesce(nullif(p->>'condition',''), pr.condition), battery_health = nullif(p->>'battery_health','')::int,
      kit = coalesce(nullif(p->>'kit',''), pr.kit), diagnostics = nullif(p->>'diagnostics',''), attrs = v_attrs
    where id = u.id;
    o_id := u.id; o_created := false;
  else
    insert into units(product_id, imei, imei2, serial_no, warehouse_id, status, condition, battery_health, kit, diagnostics, cost, price, last_ref, attrs)
    values (p_product, v_imei, v_imei2, v_sn, p_wh, 'in_stock', coalesce(nullif(p->>'condition',''), pr.condition), nullif(p->>'battery_health','')::int,
      coalesce(nullif(p->>'kit',''), pr.kit), nullif(p->>'diagnostics',''), coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), nullif(p->>'price','')::numeric, p_ref, v_attrs)
    returning id into o_id;
    o_created := true; o_before := null;
  end if;
end $$;
revoke execute on function unit_receive(uuid,uuid,jsonb,numeric,text) from public, anon, authenticated;

-- icase_v3_site: обмен с сайтом WooCommerce (см. db/mig_site.sql — там же расширения pg_net/pg_cron и расписание)
-- v3: обмен с сайтом (WooCommerce): выгрузка цен/остатков/товаров/б/у экземпляров, приём заказов с резервом

alter table settings
  add column if not exists site_url text,
  add column if not exists site_sync boolean not null default false,       -- выгружать цены и остатки на сайт
  add column if not exists site_orders boolean not null default false,     -- принимать заказы с сайта
  add column if not exists site_warehouses uuid[] not null default '{}',   -- склады, остатки которых видны на сайте
  add column if not exists site_new_status text not null default 'draft' check (site_new_status in ('draft','publish')),
  add column if not exists site_reserve_wh uuid references warehouses(id),
  add column if not exists site_last_sync timestamptz,
  add column if not exists site_last_error text;

alter table products add column if not exists woo_id bigint unique, add column if not exists site_synced_at timestamptz;
alter table units add column if not exists on_site boolean not null default true, add column if not exists woo_id bigint unique;

insert into warehouses(name, kind, sort) values ('Резерв · сайт', 'Резерв', 99) on conflict (name) do nothing;
update settings set site_reserve_wh = (select id from warehouses where name = 'Резерв · сайт') where id = 1 and site_reserve_wh is null;

-- ---------- заказы с сайта ----------
do $$ begin create type site_order_status as enum ('new','confirmed','done','cancelled'); exception when duplicate_object then null; end $$;
create table if not exists site_orders (
  id uuid primary key default gen_random_uuid(),
  woo_id bigint unique,
  num text not null unique,
  status site_order_status not null default 'new',
  woo_status text,
  customer_id uuid references customers(id),
  name text, phone text, email text, address text, delivery text, payment text,
  paid boolean not null default false,
  total numeric(12,2) not null default 0,
  note text,
  items jsonb not null default '[]',      -- [{product_id,unit_id,name,sku,qty,price,from:[{wh,qty}],problem}]
  problems text,
  sale_id uuid references sales(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table site_orders enable row level security;
drop policy if exists staff_read on site_orders;
create policy staff_read on site_orders for select using (is_staff());
revoke insert, update, delete on site_orders from authenticated;
revoke all on site_orders from anon;
do $$ begin alter publication supabase_realtime add table site_orders; exception when others then null; end $$;

-- ---------- очередь выгрузки: без дублей ----------
create index if not exists integration_jobs_pending on integration_jobs(target, status) where status = 'pending';
create or replace function site_enqueue(p_action text, p_payload jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from integration_jobs where target='woocommerce' and status='pending' and action=p_action and payload=p_payload) then
    insert into integration_jobs(target,action,payload) values ('woocommerce',p_action,p_payload);
  end if;
end $$;

create or replace function queue_product_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.on_site or new.woo_id is not null or (tg_op='UPDATE' and old.on_site) or exists(select 1 from units u where u.product_id=new.id and u.woo_id is not null) then
    perform site_enqueue('sync_product', jsonb_build_object('product_id',new.id));
  end if;
  if new.on_avito or (tg_op='UPDATE' and old.on_avito) then
    if not exists (select 1 from integration_jobs where target='avito' and status='pending' and payload=jsonb_build_object('product_id',new.id)) then
      insert into integration_jobs(target,action,payload) values ('avito','upsert_product',jsonb_build_object('product_id',new.id)); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_product_sync on products;
create trigger trg_product_sync after insert or update of price, name, on_site, on_avito, updated_at, category_id, description, is_archived on products
  for each row execute function queue_product_sync();

create or replace function queue_unit_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from products p where p.id=new.product_id and (p.on_site or p.woo_id is not null)) or new.woo_id is not null then
    perform site_enqueue('sync_product', jsonb_build_object('product_id',new.product_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_unit_sync on units;
create trigger trg_unit_sync after insert or update of status, warehouse_id, price, on_site, condition, battery_health, kit, attrs on units
  for each row execute function queue_unit_sync();

-- ---------- что видно на сайте ----------
create or replace function site_is_used(p products) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from categories c left join categories pc on pc.id = c.parent_id
    where c.id = p.category_id and (c.is_used or coalesce(pc.is_used,false)));
$$;

-- p_ids = null — весь каталог; иначе только эти товары. Возвращает позиции для WooCommerce.
create or replace function site_feed(p_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st settings; p products; u units; out jsonb := '[]'; cat text[]; c categories; pc categories; q int;
begin
  select * into st from settings where id = 1;
  for p in select * from products where (p_ids is null and (on_site or woo_id is not null or id in (select product_id from units where woo_id is not null))) or id = any(p_ids) loop
    select * into c from categories where id = p.category_id;
    select * into pc from categories where id = c.parent_id;
    cat := array_remove(array[pc.name, c.name], null);
    if p.track_serial and site_is_used(p) then
      -- б/у: каждый экземпляр отдельной карточкой
      for u in select * from units where product_id = p.id and (woo_id is not null or (status = 'in_stock' and on_site and warehouse_id = any(st.site_warehouses))) loop
        out := out || jsonb_build_object('kind','unit','crm_id',u.id,'product_id',p.id,'woo_id',u.woo_id,
          'sku','U-'||coalesce(u.imei,u.serial_no,left(u.id::text,8)),
          'name',concat_ws(' · ',p.name,coalesce(u.condition,p.condition),case when u.battery_health is not null then 'АКБ '||u.battery_health||'%' end),
          'price',coalesce(u.price,p.price),
          'qty',case when p.on_site and not p.is_archived and u.status='in_stock' and u.on_site and u.warehouse_id = any(st.site_warehouses) then 1 else 0 end,
          'visible',p.on_site and not p.is_archived and u.status='in_stock' and u.on_site and u.warehouse_id = any(st.site_warehouses),
          'categories',to_jsonb(cat),'brand',p.brand,'model',p.model,'memory',p.memory,'color',p.color,
          'condition',coalesce(u.condition,p.condition),'battery',u.battery_health,'kit',coalesce(u.kit,p.kit),
          'used',coalesce(u.attrs,'{}'::jsonb),'description',p.description,'photos',to_jsonb(p.photos));
      end loop;
    else
      if p.track_serial then
        select count(*) into q from units where product_id = p.id and status = 'in_stock' and warehouse_id = any(st.site_warehouses);
      else
        select coalesce(sum(qty),0) into q from stock where product_id = p.id and warehouse_id = any(st.site_warehouses);
      end if;
      out := out || jsonb_build_object('kind','product','crm_id',p.id,'product_id',p.id,'woo_id',p.woo_id,
        'sku',coalesce(p.sku,p.barcode,'CRM-'||left(p.id::text,8)),'name',p.name,'price',p.price,
        'qty',case when p.on_site and not p.is_archived then q else 0 end,'visible',p.on_site and not p.is_archived,
        'categories',to_jsonb(cat),'brand',p.brand,'model',p.model,'memory',p.memory,'color',p.color,'condition',p.condition,
        'attrs',coalesce(p.attrs,'{}'::jsonb),'description',p.description,'photos',to_jsonb(p.photos));
    end if;
  end loop;
  return out;
end $$;

-- ---------- служебные функции для edge-функций (только service_role) ----------
create or replace function site_config() returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare st settings;
begin
  select * into st from settings where id = 1;
  return jsonb_build_object('sync',st.site_sync,'orders',st.site_orders,'url',st.site_url,'new_status',st.site_new_status,
    'woo_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_key'),
    'woo_secret',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_secret'),
    'api_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_site_api_key'));
end $$;
create or replace function site_check_cron(p_token text) returns boolean language sql stable security definer set search_path = public, vault as $$
  select p_token is not null and p_token = (select decrypted_secret from vault.decrypted_secrets where name='icase_site_cron_token');
$$;
create or replace function site_jobs_take(p_limit int default 50) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  with j as (select id from integration_jobs where target='woocommerce' and status='pending' order by id limit p_limit for update skip locked)
  update integration_jobs i set attempts = attempts + 1 from j where i.id = j.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'payload',payload,'attempts',attempts) order by id),'[]') into r
    from (select * from integration_jobs where target='woocommerce' and status='pending' order by id limit p_limit) x;
  return r;
end $$;
create or replace function site_jobs_finish(p_done bigint[], p_failed jsonb default '[]') returns void language plpgsql security definer set search_path = public as $$
declare f jsonb;
begin
  update integration_jobs set status='done', done_at=now(), last_error=null where id = any(p_done);
  for f in select * from jsonb_array_elements(p_failed) loop
    update integration_jobs set last_error = f->>'error', status = case when attempts >= 5 then 'error' else 'pending' end where id = (f->>'id')::bigint;
  end loop;
end $$;
create or replace function site_set_woo(p_kind text, p_id uuid, p_woo bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'unit' then update units set woo_id = p_woo where id = p_id;
  else update products set woo_id = p_woo, site_synced_at = now() where id = p_id; end if;
end $$;
create or replace function site_sync_log(p_error text) returns void language sql security definer set search_path = public as $$
  update settings set site_last_sync = now(), site_last_error = p_error where id = 1;
$$;

-- найти товар/экземпляр по позиции заказа WooCommerce
create or replace function site_resolve(p_woo bigint, p_sku text, out o_product uuid, out o_unit uuid) language plpgsql stable security definer set search_path = public as $$
declare s text := nullif(trim(coalesce(p_sku,'')),'');
begin
  if p_woo is not null then
    select product_id, id into o_product, o_unit from units where woo_id = p_woo;
    if o_unit is not null then return; end if;
    select id into o_product from products where woo_id = p_woo;
    if o_product is not null then return; end if;
  end if;
  if s is null then return; end if;
  if s like 'U-%' then
    select product_id, id into o_product, o_unit from units where imei = substr(s,3) or upper(serial_no) = upper(substr(s,3)) limit 1;
    if o_unit is not null then return; end if;
  end if;
  select id into o_product from products where sku = s or barcode = s or (s like 'CRM-%' and left(id::text,8) = substr(s,5)) limit 1;
end $$;

-- приём заказа (вебхук WooCommerce): создать/обновить заказ, зарезервировать товар
create or replace function site_order_upsert(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare st settings; o site_orders; v_id uuid; li jsonb; items jsonb := '[]'; r record; need int; take int; w record; fr jsonb; prob text;
        v_phone text; v_cust uuid; v_wst text := p->>'status'; v_num text; it jsonb; probs text[] := '{}'; u units;
begin
  select * into st from settings where id = 1;
  select * into o from site_orders where woo_id = (p->>'id')::bigint for update;
  if o.id is not null then
    update site_orders set woo_status = v_wst, paid = paid or v_wst in ('processing','completed'), updated_at = now() where id = o.id;
    if v_wst in ('cancelled','refunded','failed') and o.status in ('new','confirmed') then perform site_order_release(o.id, 'Отменён на сайте'); end if;
    return o.id;
  end if;
  if v_wst in ('cancelled','refunded','failed','trash','checkout-draft') then return null; end if;
  v_num := 'С-' || coalesce(p->>'number', p->>'id');
  v_phone := right(regexp_replace(coalesce(p#>>'{billing,phone}',''),'\D','','g'),10);
  if length(v_phone) = 10 then
    select id into v_cust from customers where phone = v_phone;
    if v_cust is null then
      insert into customers(name, phone, email, source)
        values (coalesce(nullif(trim(concat_ws(' ',p#>>'{billing,first_name}',p#>>'{billing,last_name}')),''),'Без имени'), v_phone, nullif(p#>>'{billing,email}',''), 'Сайт')
        returning id into v_cust;
    end if;
  end if;
  -- позиции и резерв
  for li in select * from jsonb_array_elements(coalesce(p->'line_items','[]')) loop
    select * into r from site_resolve(coalesce(nullif((li->>'variation_id')::bigint,0),(li->>'product_id')::bigint), li->>'sku');
    prob := null; fr := '[]';
    need := greatest(1, coalesce((li->>'quantity')::int,1));
    if r.o_product is null then
      prob := 'нет в CRM';
    elsif r.o_unit is not null then
      select * into u from units where id = r.o_unit for update;
      if u.status = 'in_stock' and u.warehouse_id = any(st.site_warehouses) then
        insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,u.warehouse_id,'transfer_out',-1,v_num,'Резерв заказа с сайта');
        insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,st.site_reserve_wh,'transfer_in',1,v_num,'Резерв заказа с сайта');
        fr := jsonb_build_array(jsonb_build_object('wh',u.warehouse_id,'qty',1));
        update units set status = 'reserved', warehouse_id = st.site_reserve_wh, last_ref = v_num where id = u.id;
        need := 1;
      else prob := 'экземпляр уже продан или не на складе сайта'; end if;
    else
      if (select track_serial from products where id = r.o_product) then
        -- новая техника по IMEI: резервируем первые свободные экземпляры
        for u in select * from units where product_id = r.o_product and status = 'in_stock' and warehouse_id = any(st.site_warehouses) order by created_at limit need for update loop
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,u.warehouse_id,'transfer_out',-1,v_num,'Резерв заказа с сайта');
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,st.site_reserve_wh,'transfer_in',1,v_num,'Резерв заказа с сайта');
          update units set status = 'reserved', warehouse_id = st.site_reserve_wh, last_ref = v_num where id = u.id;
          fr := fr || jsonb_build_object('wh',u.warehouse_id,'qty',1,'unit',u.id);
        end loop;
        take := jsonb_array_length(fr);
        if take < need then prob := 'не хватает '||(need-take)||' шт'; end if;
      else
        take := need;
        for w in select warehouse_id, qty from stock where product_id = r.o_product and warehouse_id = any(st.site_warehouses) and qty > 0 order by qty desc loop
          exit when take <= 0;
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (r.o_product,w.warehouse_id,'transfer_out',-least(take,w.qty),v_num,'Резерв заказа с сайта');
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (r.o_product,st.site_reserve_wh,'transfer_in',least(take,w.qty),v_num,'Резерв заказа с сайта');
          fr := fr || jsonb_build_object('wh',w.warehouse_id,'qty',least(take,w.qty));
          take := take - least(take,w.qty);
        end loop;
        if take > 0 then prob := 'не хватает '||take||' шт'; end if;
      end if;
    end if;
    if prob is not null then probs := probs || (coalesce(li->>'name','?')||': '||prob); end if;
    items := items || jsonb_build_object('product_id',r.o_product,'unit_id',r.o_unit,'name',li->>'name','sku',li->>'sku','qty',need,
      'price',round(coalesce((li->>'total')::numeric,0)/greatest(need,1),2),'woo_line',li->>'id','from',fr,'problem',prob);
  end loop;
  insert into site_orders(woo_id,num,woo_status,customer_id,name,phone,email,address,delivery,payment,paid,total,note,items,problems,created_at)
    values ((p->>'id')::bigint, v_num, v_wst, v_cust,
      nullif(trim(concat_ws(' ',p#>>'{billing,first_name}',p#>>'{billing,last_name}')),''), nullif(v_phone,''), nullif(p#>>'{billing,email}',''),
      nullif(trim(concat_ws(', ',nullif(p#>>'{shipping,city}',''),nullif(p#>>'{shipping,address_1}',''),nullif(p#>>'{shipping,address_2}',''))),''),
      (select string_agg(x->>'method_title',', ') from jsonb_array_elements(coalesce(p->'shipping_lines','[]')) x),
      nullif(p->>'payment_method_title',''), v_wst in ('processing','completed'),
      coalesce((p->>'total')::numeric,0), nullif(p->>'customer_note',''), items, nullif(array_to_string(probs,'; '),''),
      coalesce((p->>'date_created_gmt')::timestamptz, now()))
    returning id into v_id;
  insert into audit_log(action,ref,details) values ('Заказ с сайта',v_num,coalesce(p->>'total','0'));
  return v_id;
end $$;

-- снять резерв (отмена заказа)
create or replace function site_order_release(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare o site_orders; st settings; it jsonb; f jsonb;
begin
  select * into st from settings where id = 1;
  select * into o from site_orders where id = p_id for update;
  if o.status not in ('new','confirmed') then raise exception 'Заказ уже %', case o.status when 'done' then 'проведён' else 'отменён' end; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    for f in select * from jsonb_array_elements(coalesce(it->'from','[]')) loop
      insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values ((it->>'product_id')::uuid,st.site_reserve_wh,'transfer_out',-(f->>'qty')::int,o.num,'Снятие резерва');
      insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values ((it->>'product_id')::uuid,(f->>'wh')::uuid,'transfer_in',(f->>'qty')::int,o.num,'Снятие резерва');
      if coalesce(f->>'unit', it->>'unit_id') is not null then
        update units set status = 'in_stock', warehouse_id = (f->>'wh')::uuid, last_ref = o.num where id = coalesce(f->>'unit', it->>'unit_id')::uuid and status = 'reserved';
      end if;
    end loop;
  end loop;
  update site_orders set status = 'cancelled', note = concat_ws(' · ', note, p_reason), updated_at = now() where id = p_id;
  if o.woo_id is not null then perform site_enqueue('order_status', jsonb_build_object('woo_id',o.woo_id,'status','cancelled')); end if;
end $$;

-- действия сотрудников
create or replace function site_order_confirm(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  update site_orders set status = 'confirmed', updated_at = now() where id = p_id and status = 'new';
end $$;
create or replace function site_order_cancel(p_id uuid, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  perform site_order_release(p_id, coalesce(p_reason,'Отменён в CRM'));
end $$;
-- провести продажу по заказу: товар уходит из резерва, продажа с каналом «сайт»
create or replace function site_order_complete(p_id uuid, p_payments jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare o site_orders; st settings; it jsonb; f jsonb; items jsonb := '[]'; v_sale uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into st from settings where id = 1;
  select * into o from site_orders where id = p_id for update;
  if o.status not in ('new','confirmed') then raise exception 'Заказ уже %', case o.status when 'done' then 'проведён' else 'отменён' end; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    if it->>'product_id' is null then   -- позиции нет в каталоге CRM: проводим как товар вне каталога (без списания со склада)
      items := items || jsonb_build_object('product_id',null,'name',it->>'name','kind','goods','qty',(it->>'qty')::int,'price',(it->>'price')::numeric,'discount',0);
      continue;
    end if;
    if coalesce((select sum((x->>'qty')::int) from jsonb_array_elements(coalesce(it->'from','[]')) x),0) < (it->>'qty')::int then
      raise exception 'Не весь товар зарезервирован: %', it->>'name'; end if;
    if jsonb_array_length(coalesce(it->'from','[]')) > 0 and (it->'from'->0->>'unit' is not null or it->>'unit_id' is not null) then
      for f in select * from jsonb_array_elements(it->'from') loop
        update units set status = 'in_stock' where id = coalesce(f->>'unit', it->>'unit_id')::uuid and status = 'reserved';
        items := items || jsonb_build_object('product_id',it->>'product_id','unit_id',coalesce(f->>'unit', it->>'unit_id'),'qty',1,'price',(it->>'price')::numeric,'discount',0);
      end loop;
    else
      items := items || jsonb_build_object('product_id',it->>'product_id','qty',(it->>'qty')::int,'price',(it->>'price')::numeric,'discount',0);
    end if;
  end loop;
  v_sale := create_sale(st.site_reserve_wh, o.customer_id, items, p_payments, 0, null, 0, null, 'site');
  update site_orders set status = 'done', sale_id = v_sale, paid = true, updated_at = now() where id = p_id;
  if o.woo_id is not null then perform site_enqueue('order_status', jsonb_build_object('woo_id',o.woo_id,'status','completed')); end if;
  return v_sale;
end $$;

-- настройки обмена (владелец): ключи WooCommerce хранятся в Vault, наружу не отдаются
create or replace function site_set_credentials(p_url text, p_key text, p_secret text) returns void language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  update settings set site_url = nullif(trim(p_url),'') where id = 1;
  if nullif(trim(coalesce(p_key,'')),'') is not null then
    select id into v from vault.secrets where name = 'icase_woo_key';
    if v is null then perform vault.create_secret(trim(p_key),'icase_woo_key'); else perform vault.update_secret(v, trim(p_key)); end if;
  end if;
  if nullif(trim(coalesce(p_secret,'')),'') is not null then
    select id into v from vault.secrets where name = 'icase_woo_secret';
    if v is null then perform vault.create_secret(trim(p_secret),'icase_woo_secret'); else perform vault.update_secret(v, trim(p_secret)); end if;
  end if;
end $$;
-- состояние обмена для экрана настроек (без самих секретов)
create or replace function site_status() returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not has_role('owner','manager') then raise exception 'Нет права'; end if;
  return jsonb_build_object(
    'has_keys', exists(select 1 from vault.secrets where name='icase_woo_key') and exists(select 1 from vault.secrets where name='icase_woo_secret'),
    'pending', (select count(*) from integration_jobs where target='woocommerce' and status='pending'),
    'errors', (select count(*) from integration_jobs where target='woocommerce' and status='error'),
    'last_errors', (select coalesce(jsonb_agg(x),'[]') from (select action, payload, last_error, created_at from integration_jobs where target='woocommerce' and last_error is not null order by id desc limit 5) x),
    'on_site', (select count(*) from products where on_site and not is_archived),
    'linked', (select count(*) from products where woo_id is not null) + (select count(*) from units where woo_id is not null));
end $$;
-- ключ доступа сайта к CRM (для вебхука заказов и фида) — показывается только владельцу
create or replace function site_api_key(p_regenerate boolean default false) returns text language plpgsql security definer set search_path = public, vault, extensions as $$
declare v uuid; k text;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select id into v from vault.secrets where name = 'icase_site_api_key';
  if v is null or p_regenerate then
    k := encode(gen_random_bytes(24),'hex');
    if v is null then perform vault.create_secret(k,'icase_site_api_key'); else perform vault.update_secret(v,k); end if;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name='icase_site_api_key');
end $$;
-- выгрузить весь каталог заново
create or replace function site_resync() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not has_role('owner','manager') then raise exception 'Нет права'; end if;
  update integration_jobs set status='pending', attempts=0 where target='woocommerce' and status='error';
  for r in select id from products where on_site or woo_id is not null loop perform site_enqueue('sync_product', jsonb_build_object('product_id',r.id)); n := n + 1; end loop;
  return n;
end $$;


-- продажи по сайту — без кассовой смены (оплата онлайн или при получении)
create or replace function create_sale(p_wh uuid, p_customer uuid, p_items jsonb, p_payments jsonb,
  p_discount numeric default 0, p_tradein_device text default null, p_tradein_amount numeric default 0, p_tradein_imei text default null,
  p_channel sale_channel default 'store') returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale uuid; v_num text; v_sub numeric := 0; v_total numeric; v_paid numeric; it jsonb; p products; u units; v_cost numeric;
        v_point uuid := (select point_id from warehouses where id = p_wh); v_shift uuid; v_si bigint;
        st settings; v_ti uuid; v_cat uuid; v_code text;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права продавать'; end if;
  if p_channel = 'store' and not can_work_at(v_point) then raise exception 'Вы не можете продавать с этой точки'; end if;
  v_shift := current_shift(v_point);
  select * into st from settings where id = 1;
  if st.require_shift and v_shift is null and p_channel = 'store' then raise exception 'Откройте кассовую смену'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it->>'product_id','') is null then  -- произвольная позиция: товар или услуга не из справочника
      if nullif(trim(coalesce(it->>'name','')),'') is null then raise exception 'Укажите название произвольной позиции'; end if;
      if coalesce((it->>'qty')::int,0) < 1 or coalesce((it->>'price')::numeric,-1) < 0 then raise exception 'Проверьте количество и цену «%»', it->>'name'; end if;
      v_sub := v_sub + (it->>'qty')::int * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0);
      continue;
    end if;
    select * into p from products where id = (it->>'product_id')::uuid;
    v_cost := p.cost;
    if p.track_serial then
      if nullif(it->>'unit_id','') is null then raise exception 'Выберите IMEI / серийный номер для «%»', p.name; end if;
      if (it->>'qty')::int <> 1 then raise exception 'Серийный товар продаётся по одной штуке'; end if;
      select cost into v_cost from units where id = (it->>'unit_id')::uuid;
    end if;
    if (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0)/(it->>'qty')::int < coalesce(v_cost,0) and not has_role('owner','manager') then
      raise exception '«%» дешевле закупки: нужно разрешение управляющего', p.name; end if;
    v_sub := v_sub + (it->>'qty')::int * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0);
  end loop;
  v_total := greatest(0, v_sub - p_discount - p_tradein_amount);
  select coalesce(sum((x->>'amount')::numeric),0) into v_paid from jsonb_array_elements(p_payments) x;
  if abs(v_paid - v_total) >= 0.5 then raise exception 'Оплата % не равна сумме чека %', v_paid, v_total; end if;
  insert into sales(point_id,warehouse_id,shift_id,customer_id,channel,subtotal,discount,tradein_device,tradein_imei,tradein_amount,total)
    values (v_point,p_wh,v_shift,p_customer,p_channel,v_sub,p_discount,p_tradein_device,p_tradein_imei,p_tradein_amount,v_total) returning id,num into v_sale,v_num;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it->>'product_id','') is null then
      insert into sale_items(sale_id,product_id,name,kind,serial,qty,price,line_discount,cost,warranty_months)
        values (v_sale,null,trim(it->>'name'),case when it->>'kind'='goods' then 'goods' else 'service' end,nullif(trim(coalesce(it->>'serial','')),''),
          (it->>'qty')::int,(it->>'price')::numeric,coalesce((it->>'discount')::numeric,0),
          case when has_role('owner','manager') then coalesce((it->>'cost')::numeric,0) else 0 end,coalesce((it->>'warranty')::int,0));
      continue;
    end if;
    select * into p from products where id = (it->>'product_id')::uuid;
    u := null;
    if p.track_serial then
      select * into u from units where id = (it->>'unit_id')::uuid for update;
      if u.id is null or u.product_id <> p.id or u.status <> 'in_stock' or u.warehouse_id is distinct from p_wh then
        raise exception 'IMEI/SN % нет в наличии на складе «%»', coalesce(u.imei,u.serial_no,'?'), (select name from warehouses where id = p_wh);
      end if;
    end if;
    insert into sale_items(sale_id,product_id,unit_id,name,serial,qty,price,line_discount,cost,warranty_months,condition,battery_health,kit)
      values (v_sale,p.id,u.id,p.name,coalesce(u.imei,u.serial_no,p.serial),(it->>'qty')::int,(it->>'price')::numeric,coalesce((it->>'discount')::numeric,0),coalesce(u.cost,p.cost),
        case when exists(select 1 from categories c where c.id=p.category_id and (c.is_device or exists(select 1 from categories pc where pc.id=c.parent_id and pc.is_device)))
             then coalesce(nullif(p.warranty_months,0), st.device_warranty_months) else p.warranty_months end,
        coalesce(u.condition,p.condition),coalesce(u.battery_health,p.battery_health),coalesce(u.kit,p.kit))
      returning id into v_si;
    if u.id is not null then update units set status = 'sold', warehouse_id = null, sale_item_id = v_si, last_ref = v_num where id = u.id; end if;
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (p.id,p_wh,'sale',-(it->>'qty')::int,v_num);
  end loop;
  insert into sale_payments(sale_id,method,amount) select v_sale,(x->>'method')::pay_method,(x->>'amount')::numeric from jsonb_array_elements(p_payments) x;
  insert into cash_ops(shift_id,type,method,amount,ref) select v_shift,'sale',(x->>'method')::pay_method,(x->>'amount')::numeric,v_num from jsonb_array_elements(p_payments) x where (x->>'amount')::numeric <> 0;
  if p_tradein_device is not null then
    select id into v_cat from categories where is_device and parent_id is null order by name limit 1;
    v_code := nullif(trim(coalesce(p_tradein_imei,'')),'');
    insert into products(name,category_id,condition,serial,cost,price,description,track_serial)
      values (p_tradein_device,v_cat,'Б/у хорошее',null,p_tradein_amount,p_tradein_amount,'Trade-in по '||v_num,v_code is not null) returning id into v_ti;
    if v_code is not null then
      perform unit_receive(v_ti, p_wh, case when v_code ~ '^\d{15}$' then jsonb_build_object('imei',v_code) else jsonb_build_object('serial_no',v_code) end, p_tradein_amount, v_num);
    end if;
    insert into stock_movements(product_id,warehouse_id,type,qty,ref) values (v_ti,p_wh,'tradein',1,v_num);
  end if;
  insert into integration_jobs(target,action,payload) values ('kassa','sale_receipt',jsonb_build_object('sale_id',v_sale));
  insert into audit_log(action,ref,details) values ('Продажа',v_num,v_total::text);
  return v_sale;
end $$;

-- права
revoke execute on function site_enqueue(text,jsonb), queue_unit_sync(), site_feed(uuid[]), site_config(), site_check_cron(text), site_jobs_take(int),
  site_jobs_finish(bigint[],jsonb), site_set_woo(text,uuid,bigint), site_sync_log(text), site_resolve(bigint,text), site_order_upsert(jsonb),
  site_order_release(uuid,text), site_is_used(products) from public, anon, authenticated;
grant execute on function site_feed(uuid[]), site_config(), site_check_cron(text), site_jobs_take(int), site_jobs_finish(bigint[],jsonb),
  site_set_woo(text,uuid,bigint), site_sync_log(text), site_order_upsert(jsonb) to service_role;
revoke execute on function site_order_confirm(uuid), site_order_cancel(uuid,text), site_order_complete(uuid,jsonb), site_set_credentials(text,text,text),
  site_status(), site_api_key(boolean), site_resync() from public, anon;
grant execute on function site_order_confirm(uuid), site_order_cancel(uuid,text), site_order_complete(uuid,jsonb), site_set_credentials(text,text,text),
  site_status(), site_api_key(boolean), site_resync() to authenticated;

grant update (on_site) on units to authenticated;

-- icase_v3_supplier_prices
-- v3: прайсы поставщиков — загрузка, поиск, сравнение цен, привязка к товарам CRM
alter table suppliers add column if not exists price_updated_at timestamptz, add column if not exists price_note text;
create table if not exists supplier_prices (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null, sku text, brand text,
  price numeric(12,2) not null default 0,
  stock text,                                   -- наличие у поставщика как в прайсе: «есть», «5», «под заказ 3 дня»
  note text,
  product_id uuid references products(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists supplier_prices_supplier on supplier_prices(supplier_id);
create index if not exists supplier_prices_product on supplier_prices(product_id);
alter table supplier_prices enable row level security;
drop policy if exists r_sp on supplier_prices;
drop policy if exists w_sp on supplier_prices;
create policy r_sp on supplier_prices for select using (has_role('owner','manager','storekeeper'));
create policy w_sp on supplier_prices for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
revoke all on supplier_prices from anon;
grant select, insert, update, delete on supplier_prices to authenticated;
do $$ begin alter publication supabase_realtime add table supplier_prices; exception when others then null; end $$;

-- загрузить прайс: p_mode 'replace' — заменить весь прайс поставщика, 'append' — добавить строки (для больших прайсов частями)
create or replace function supplier_price_load(p_supplier uuid, p_rows jsonb, p_mode text default 'replace') returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права загружать прайсы'; end if;
  if not exists (select 1 from suppliers where id = p_supplier) then raise exception 'Поставщик не найден'; end if;
  if p_mode = 'replace' then delete from supplier_prices where supplier_id = p_supplier; end if;
  insert into supplier_prices(supplier_id, name, sku, brand, price, stock, note, product_id)
  select p_supplier, left(trim(r->>'name'),300), nullif(trim(r->>'sku'),''), nullif(trim(r->>'brand'),''),
         coalesce(substring(regexp_replace(replace(coalesce(r->>'price',''),',','.'),'\s','','g') from '[0-9]+(?:\.[0-9]+)?')::numeric,0),
         nullif(trim(r->>'stock'),''), nullif(trim(r->>'note'),''),
         coalesce(
           (select p.id from products p where nullif(trim(r->>'sku'),'') is not null and (p.sku = trim(r->>'sku') or p.barcode = trim(r->>'sku')) limit 1),
           (select p.id from products p where lower(p.name) = lower(trim(r->>'name')) and not p.is_archived limit 1))
  from jsonb_array_elements(p_rows) r
  where nullif(trim(r->>'name'),'') is not null;
  get diagnostics n = row_count;
  update suppliers set price_updated_at = now() where id = p_supplier;
  return n;
end $$;
revoke execute on function supplier_price_load(uuid,jsonb,text) from public, anon;
grant execute on function supplier_price_load(uuid,jsonb,text) to authenticated;

-- icase_v3_site_fields
-- v3: выбор, что передавать на сайт; гарантия в выгрузке
alter table settings add column if not exists site_fields jsonb not null default '{
 "create":{"categories":true,"attributes":true,"description":true,"photos":true},
 "update":{"price":true,"stock":true,"status":true,"name":false,"categories":false,"attributes":false,"description":false,"photos":false},
 "attrs":{"brand":true,"model":true,"memory":true,"color":true,"condition":true,"warranty":true,"battery":true,"kit":true,"used":true,"extra":true},
 "global_attrs":true}'::jsonb;

create or replace function site_feed(p_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st settings; p products; u units; out jsonb := '[]'; cat text[]; c categories; pc categories; q int; w int;
begin
  select * into st from settings where id = 1;
  for p in select * from products where (p_ids is null and (on_site or woo_id is not null or id in (select product_id from units where woo_id is not null))) or id = any(p_ids) loop
    select * into c from categories where id = p.category_id;
    select * into pc from categories where id = c.parent_id;
    cat := array_remove(array[pc.name, c.name], null);
    w := case when coalesce(c.is_device,false) or coalesce(pc.is_device,false) then coalesce(nullif(p.warranty_months,0), st.device_warranty_months) else p.warranty_months end;
    if p.track_serial and site_is_used(p) then
      -- б/у: каждый экземпляр отдельной карточкой
      for u in select * from units where product_id = p.id and (woo_id is not null or (status = 'in_stock' and on_site and warehouse_id = any(st.site_warehouses))) loop
        out := out || jsonb_build_object('kind','unit','crm_id',u.id,'product_id',p.id,'woo_id',u.woo_id,
          'sku','U-'||coalesce(u.imei,u.serial_no,left(u.id::text,8)),
          'name',concat_ws(' · ',p.name,coalesce(u.condition,p.condition),case when u.battery_health is not null then 'АКБ '||u.battery_health||'%' end),
          'price',coalesce(u.price,p.price),
          'qty',case when p.on_site and not p.is_archived and u.status='in_stock' and u.on_site and u.warehouse_id = any(st.site_warehouses) then 1 else 0 end,
          'visible',p.on_site and not p.is_archived and u.status='in_stock' and u.on_site and u.warehouse_id = any(st.site_warehouses),
          'categories',to_jsonb(cat),'brand',p.brand,'model',p.model,'memory',p.memory,'color',p.color,
          'condition',coalesce(u.condition,p.condition),'battery',u.battery_health,'kit',coalesce(u.kit,p.kit),
          'used',coalesce(u.attrs,'{}'::jsonb),'attrs',coalesce(p.attrs,'{}'::jsonb),'warranty',w,'description',p.description,'photos',to_jsonb(p.photos));
      end loop;
    else
      if p.track_serial then
        select count(*) into q from units where product_id = p.id and status = 'in_stock' and warehouse_id = any(st.site_warehouses);
      else
        select coalesce(sum(qty),0) into q from stock where product_id = p.id and warehouse_id = any(st.site_warehouses);
      end if;
      out := out || jsonb_build_object('kind','product','crm_id',p.id,'product_id',p.id,'woo_id',p.woo_id,
        'sku',coalesce(p.sku,p.barcode,'CRM-'||left(p.id::text,8)),'name',p.name,'price',p.price,
        'qty',case when p.on_site and not p.is_archived then q else 0 end,'visible',p.on_site and not p.is_archived,
        'categories',to_jsonb(cat),'brand',p.brand,'model',p.model,'memory',p.memory,'color',p.color,'condition',p.condition,
        'attrs',coalesce(p.attrs,'{}'::jsonb),'warranty',w,'description',p.description,'photos',to_jsonb(p.photos));
    end if;
  end loop;
  return out;
end $$;

create or replace function site_config() returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare st settings;
begin
  select * into st from settings where id = 1;
  return jsonb_build_object('sync',st.site_sync,'orders',st.site_orders,'url',st.site_url,'new_status',st.site_new_status,'fields',st.site_fields,
    'woo_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_key'),
    'woo_secret',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_secret'),
    'api_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_site_api_key'));
end $$;
-- после смены набора полей — выгрузить каталог заново (только если что-то уже связано с сайтом)
create or replace function site_fields_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.site_fields is distinct from old.site_fields then
    for r in select id from products where woo_id is not null or on_site or id in (select product_id from units where woo_id is not null) loop
      perform site_enqueue('sync_product', jsonb_build_object('product_id',r.id));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_site_fields on settings;
create trigger trg_site_fields after update of site_fields on settings for each row execute function site_fields_changed();
revoke execute on function site_fields_changed() from public, anon, authenticated;

-- icase_v3_site_custom
-- v3: свой сайт (Next.js): режим обмена, адрес уведомлений сайта, статус заказа для покупателя
alter table settings
  add column if not exists site_mode text not null default 'custom' check (site_mode in ('custom','woocommerce')),
  add column if not exists site_hook_url text;
update settings set site_mode = 'custom' where id = 1 and site_mode is null;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'icase_site_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24),'hex'), 'icase_site_hook_secret');
  end if;
end $$;

create or replace function site_config() returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare st settings;
begin
  select * into st from settings where id = 1;
  return jsonb_build_object('mode',st.site_mode,'hook_url',st.site_hook_url,'sync',st.site_sync,'orders',st.site_orders,'url',st.site_url,
    'new_status',st.site_new_status,'fields',st.site_fields,
    'woo_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_key'),
    'woo_secret',(select decrypted_secret from vault.decrypted_secrets where name='icase_woo_secret'),
    'api_key',(select decrypted_secret from vault.decrypted_secrets where name='icase_site_api_key'),
    'hook_secret',(select decrypted_secret from vault.decrypted_secrets where name='icase_site_hook_secret'));
end $$;

-- секрет, которым CRM подписывает уведомления сайту (показывается только владельцу)
create or replace function site_hook_secret(p_regenerate boolean default false) returns text language plpgsql security definer set search_path = public, vault, extensions as $$
declare v uuid;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select id into v from vault.secrets where name = 'icase_site_hook_secret';
  if v is null then perform vault.create_secret(encode(gen_random_bytes(24),'hex'),'icase_site_hook_secret');
  elsif p_regenerate then perform vault.update_secret(v, encode(gen_random_bytes(24),'hex')); end if;
  return (select decrypted_secret from vault.decrypted_secrets where name='icase_site_hook_secret');
end $$;

-- статус заказа для покупателя на сайте: номер + последние 4 цифры телефона
create or replace function site_order_public(p_num text, p_phone4 text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('num',o.num,'status',o.status,'paid',o.paid,'total',o.total,'created_at',o.created_at,
    'items',(select jsonb_agg(jsonb_build_object('name',i->>'name','qty',(i->>'qty')::int,'price',(i->>'price')::numeric)) from jsonb_array_elements(o.items) i))
  from site_orders o where o.num = p_num and right(coalesce(o.phone,''),4) = right(regexp_replace(coalesce(p_phone4,''),'\D','','g'),4) and length(regexp_replace(coalesce(p_phone4,''),'\D','','g')) >= 4;
$$;

revoke execute on function site_order_public(text,text) from public, anon, authenticated;
grant execute on function site_order_public(text,text) to service_role;
revoke execute on function site_hook_secret(boolean) from public, anon;
grant execute on function site_hook_secret(boolean) to authenticated;

-- icase_v3_auth
-- v3: авторизация и управление сотрудниками
alter table staff
  add column if not exists email text,
  add column if not exists must_change_password boolean not null default false,  -- временный пароль: сменить при входе
  add column if not exists last_seen_at timestamptz,
  add column if not exists blocked_at timestamptz;
update staff s set email = u.email from auth.users u where u.id = s.id and s.email is null;

-- владелец всегда один и активен: снять или отключить его можно только передачей прав
create or replace function staff_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then raise exception 'Владельца удалить нельзя — сначала передайте права'; end if;
    return old;
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or not new.is_active) and current_setting('icase.transfer', true) is distinct from '1' then
    raise exception 'Владельца нельзя отключить или сменить ему роль — передайте права владельца другому сотруднику';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and current_setting('icase.transfer', true) is distinct from '1' then
    raise exception 'Назначить владельца можно только передачей прав';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_guard on staff;
create trigger trg_staff_guard before update or delete on staff for each row execute function staff_guard();

-- свой профиль: имя и телефон
create or replace function staff_me_update(p_name text, p_phone text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Нет доступа'; end if;
  update staff set full_name = coalesce(nullif(trim(p_name),''), full_name), phone = nullif(trim(coalesce(p_phone,'')),'') where id = auth.uid();
end $$;
-- пароль сменён (снимает требование сменить временный пароль)
create or replace function staff_password_changed() returns void language plpgsql security definer set search_path = public as $$
begin
  update staff set must_change_password = false where id = auth.uid();
  insert into audit_log(action, ref) values ('Смена пароля', (select full_name from staff where id = auth.uid()));
end $$;
-- отметка входа (для списка сотрудников)
create or replace function staff_touch() returns void language sql security definer set search_path = public as $$
  update staff set last_seen_at = now(), email = coalesce(email, (select email from auth.users where id = auth.uid())) where id = auth.uid();
$$;
-- передача прав владельца
create or replace function transfer_owner(p_to uuid) returns void language plpgsql security definer set search_path = public as $$
declare t staff;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select * into t from staff where id = p_to;
  if t.id is null or not t.is_active then raise exception 'Сотрудник не найден или отключён'; end if;
  if t.id = auth.uid() then raise exception 'Вы уже владелец'; end if;
  perform set_config('icase.transfer', '1', true);
  update staff set role = 'owner', point_id = null where id = p_to;
  update staff set role = 'manager' where id = auth.uid();
  insert into audit_log(action, ref, details) values ('Передача прав владельца', t.full_name, 'прежний владелец стал управляющим');
end $$;
-- служебное для edge-функции staff-admin: отметить блокировку/временный пароль (только service_role)
create or replace function staff_admin_mark(p_id uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  update staff set
    is_active = coalesce((p_patch->>'is_active')::boolean, is_active),
    blocked_at = case when p_patch ? 'is_active' then case when (p_patch->>'is_active')::boolean then null else now() end else blocked_at end,
    must_change_password = coalesce((p_patch->>'must_change_password')::boolean, must_change_password),
    email = coalesce(p_patch->>'email', email)
  where id = p_id;
end $$;

-- при первом входе владельца — сохранить email
create or replace function claim_owner(p_name text) returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  if exists (select 1 from staff) then raise exception 'Владелец уже назначен'; end if;
  insert into staff(id, full_name, role, email) values (auth.uid(), coalesce(nullif(p_name,''),'Владелец'), 'owner', (select email from auth.users where id = auth.uid()));
  delete from staff_requests where id = auth.uid();
  return 'owner';
end $$;

revoke execute on function staff_me_update(text,text), staff_password_changed(), staff_touch(), transfer_owner(uuid) from public, anon;
grant execute on function staff_me_update(text,text), staff_password_changed(), staff_touch(), transfer_owner(uuid) to authenticated;
revoke execute on function staff_admin_mark(uuid,jsonb), staff_guard() from public, anon, authenticated;
grant execute on function staff_admin_mark(uuid,jsonb) to service_role;
