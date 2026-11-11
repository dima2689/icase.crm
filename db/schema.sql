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
-- site_config отдаёт секреты: только сервис
revoke execute on function site_config() from public, anon, authenticated;
grant execute on function site_config() to service_role;
-- v3: старая цена для ценника со скидкой
alter table products add column if not exists old_price numeric(12,2) check (old_price is null or old_price >= 0);

-- ===== v3: финансы =====
alter type pay_method add value if not exists 'debt';

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

-- ===== v3: сервис, зарплата, заказы поставщикам =====
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

-- ===== v3: связки данных =====
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

-- ===== v3 этап 4: бонусы, выкуп и комиссия, выписка =====
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

-- ===== v3: закупочные цены скрыты на уровне базы =====
-- v3: закупочные цены скрыты на уровне базы.
-- Колонки себестоимости закрыты для чтения через API у всех; владелец, управляющий и кладовщик получают их функциями costs_*.
-- Функции базы (продажа, приход, отчёты) работают от владельца схемы и видят всё.
-- ВАЖНО: после добавления колонок в эти таблицы вызывайте select refresh_col_grants();

create or replace function refresh_col_grants() returns void language plpgsql security definer set search_path = public as $$
declare r record; cols text;
begin
  for r in select * from (values ('products', array['cost','last_cost']), ('units', array['cost']), ('sale_items', array['cost']),
                                 ('stock_doc_lines', array['cost']), ('repair_parts', array['cost'])) v(t, hidden) loop
    execute format('revoke select on %I from anon, authenticated', r.t);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = r.t and column_name <> all(r.hidden);
    execute format('grant select (%s) on %I to authenticated', cols, r.t);
  end loop;
end $$;
revoke execute on function refresh_col_grants() from public, anon, authenticated;
select refresh_col_grants();

-- какие колонки можно читать (для списка полей в запросах интерфейса)
create or replace function api_cols(p_tables text[]) returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(t, cols), '{}'::jsonb) from (
    select table_name t, string_agg(column_name, ',' order by column_name) cols
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = any(p_tables) and privilege_type = 'SELECT' and grantee in ('authenticated','PUBLIC')
    group by table_name) x
$$;
revoke execute on function api_cols(text[]) from public, anon;
grant execute on function api_cols(text[]) to authenticated;

create or replace function cost_reader() returns boolean language sql stable security definer set search_path = public as $$ select has_role('owner','manager','storekeeper') $$;
create or replace function costs_products() returns table(id uuid, cost numeric, last_cost numeric) language sql stable security definer set search_path = public as $$
  select id, cost, last_cost from products where cost_reader() $$;
create or replace function costs_units() returns table(id uuid, cost numeric) language sql stable security definer set search_path = public as $$
  select id, cost from units where cost_reader() $$;
create or replace function costs_sale_items() returns table(id bigint, cost numeric) language sql stable security definer set search_path = public as $$
  select id, cost from sale_items where cost_reader() $$;
create or replace function costs_doc_lines() returns table(id bigint, cost numeric) language sql stable security definer set search_path = public as $$
  select id, cost from stock_doc_lines where cost_reader() $$;
create or replace function costs_repair_parts() returns table(id bigint, cost numeric) language sql stable security definer set search_path = public as $$
  select id, cost from repair_parts where cost_reader() $$;
revoke execute on function cost_reader(), costs_products(), costs_units(), costs_sale_items(), costs_doc_lines(), costs_repair_parts() from public, anon;
grant execute on function costs_products(), costs_units(), costs_sale_items(), costs_doc_lines(), costs_repair_parts() to authenticated;
revoke execute on function cost_reader() from authenticated;

-- ===== v3: касса Эвотор =====
-- v3: касса Эвотор через облачное API (api.evotor.ru).
-- Облако Эвотора умеет: принимать товары и цены из CRM, отдавать чеки (запросом и вебхуком «Отправить чек»).
-- Отправить чек на печать из CRM на кассу облачное API не умеет — фискальный чек пробивается на терминале.
-- CRM сверяет каждую свою продажу с фискальным чеком и может создать продажу из чека, пробитого только на Эвоторе.

alter table settings add column if not exists evotor jsonb not null default '{"push_products":true,"match_minutes":30}'::jsonb;

create table if not exists evotor_receipts (
  id text primary key,                         -- идентификатор документа в Облаке Эвотор
  store_id text not null,
  point_id uuid references points(id) on delete set null,
  device_id text,
  doc_type text not null,                      -- SELL / PAYBACK / …
  number text,
  closed_at timestamptz not null,
  total numeric(12,2) not null default 0,
  payments jsonb not null default '{}'::jsonb, -- {cash, card}
  items jsonb not null default '[]'::jsonb,    -- [{product_id, name, qty, price, sum}]
  sale_id uuid references sales(id) on delete set null,
  return_id uuid references returns(id) on delete set null,
  status text not null default 'new' check (status in ('new','matched','created','ignored')),
  note text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists evotor_receipts_point on evotor_receipts(point_id, closed_at);
create unique index if not exists evotor_receipts_sale on evotor_receipts(sale_id) where sale_id is not null;
create unique index if not exists evotor_receipts_ret on evotor_receipts(return_id) where return_id is not null;
alter table evotor_receipts enable row level security;
drop policy if exists er_r on evotor_receipts;
create policy er_r on evotor_receipts for select using (has_role('owner','manager','seller'));
grant select on evotor_receipts to authenticated;
do $$ begin execute 'alter publication supabase_realtime add table evotor_receipts'; exception when others then null; end $$;

/* --- секреты и настройки для функции evotor (только service_role) --- */
create or replace function evotor_config() returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_token'),
    'hook_key', (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_hook'),
    'cfg', (select evotor from settings where id = 1),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('point_id', id, 'store_id', evotor_store_id, 'wh', cash_wh, 'name', name)), '[]'::jsonb) from points where evotor_store_id is not null and is_active))
$$;
revoke execute on function evotor_config() from public, anon, authenticated;
grant execute on function evotor_config() to service_role;

-- токен Облака Эвотора — только владелец, хранится в Vault
create or replace function evotor_set_token(p_token text) returns void language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  if nullif(trim(coalesce(p_token,'')),'') is null then raise exception 'Вставьте токен'; end if;
  select id into v from vault.secrets where name = 'icase_evotor_token';
  if v is null then perform vault.create_secret(trim(p_token), 'icase_evotor_token'); else perform vault.update_secret(v, trim(p_token)); end if;
  -- ключ для адреса вебхука создаётся один раз
  if not exists (select 1 from vault.secrets where name = 'icase_evotor_hook') then
    perform vault.create_secret(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'icase_evotor_hook');
  end if;
end $$;
create or replace function evotor_status() returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not has_role('owner','manager') then raise exception 'Нет права'; end if;
  return jsonb_build_object('has_token', exists(select 1 from vault.secrets where name = 'icase_evotor_token'),
    'hook_key', case when has_role('owner') then (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_hook') end,
    'last', (select max(created_at) from evotor_receipts), 'new', (select count(*) from evotor_receipts where status = 'new'));
end $$;
revoke execute on function evotor_set_token(text), evotor_status() from public, anon;
grant execute on function evotor_set_token(text), evotor_status() to authenticated;

/* --- товары для выгрузки на кассы точки --- */
create or replace function evotor_products(p_wh uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', left(p.name, 100), 'price', p.price, 'cost_price', p.cost,
      'quantity', coalesce((select qty from stock s where s.product_id = p.id and s.warehouse_id = p_wh), 0),
      'barcodes', case when p.barcode is not null then jsonb_build_array(p.barcode) else '[]'::jsonb end,
      'article_number', p.sku, 'measure_name', 'шт', 'tax', 'NO_VAT', 'allow_to_sell', true, 'type', 'NORMAL')), '[]'::jsonb)
  from products p where not p.is_archived
$$;
revoke execute on function evotor_products(uuid) from public, anon, authenticated;
grant execute on function evotor_products(uuid) to service_role;

/* --- приём чеков и автосверка с продажами CRM --- */
-- p = [{id, store_id, device_id, doc_type, number, closed_at, total, payments, items, raw}]
create or replace function evotor_ingest(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; r evotor_receipts; pt uuid; win int := coalesce(((select evotor from settings where id=1)->>'match_minutes')::int, 30); n_new int := 0; n_match int := 0; s uuid;
begin
  for x in select * from jsonb_array_elements(coalesce(p,'[]')) loop
    select id into pt from points where evotor_store_id = x->>'store_id' limit 1;
    insert into evotor_receipts(id, store_id, point_id, device_id, doc_type, number, closed_at, total, payments, items, raw)
      values (x->>'id', x->>'store_id', pt, x->>'device_id', coalesce(x->>'doc_type','SELL'), x->>'number', (x->>'closed_at')::timestamptz,
        coalesce((x->>'total')::numeric,0), coalesce(case jsonb_typeof(x->'payments') when 'string' then (x->>'payments')::jsonb else x->'payments' end,'{}'),
        coalesce(case jsonb_typeof(x->'items') when 'string' then (x->>'items')::jsonb else x->'items' end,'[]'), x->'raw')
      on conflict (id) do nothing returning * into r;
    if r.id is null then continue; end if;
    n_new := n_new + 1;
    if r.doc_type = 'SELL' and r.point_id is not null then
      select sl.id into s from sales sl where sl.point_id = r.point_id and sl.status <> 'cancelled' and abs(sl.total - r.total) < 1
        and abs(extract(epoch from sl.created_at - r.closed_at)) <= win*60
        and not exists (select 1 from evotor_receipts e where e.sale_id = sl.id)
        order by abs(extract(epoch from sl.created_at - r.closed_at)) limit 1;
      if s is not null then update evotor_receipts set sale_id = s, status = 'matched' where id = r.id; n_match := n_match + 1; end if;
    elsif r.doc_type = 'PAYBACK' and r.point_id is not null then
      select rt.id into s from returns rt join sales sl on sl.id = rt.sale_id where sl.point_id = r.point_id and abs(rt.amount - r.total) < 1
        and abs(extract(epoch from rt.created_at - r.closed_at)) <= win*60
        and not exists (select 1 from evotor_receipts e where e.return_id = rt.id)
        order by abs(extract(epoch from rt.created_at - r.closed_at)) limit 1;
      if s is not null then update evotor_receipts set return_id = s, status = 'matched' where id = r.id; n_match := n_match + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('new', n_new, 'matched', n_match);
end $$;
revoke execute on function evotor_ingest(jsonb) from public, anon, authenticated;
grant execute on function evotor_ingest(jsonb) to service_role;

-- ручная привязка / отметка «не учитывать»
create or replace function evotor_link(p_id text, p_sale uuid, p_ignore boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if p_ignore then update evotor_receipts set status = 'ignored' where id = p_id;
  elsif p_sale is null then update evotor_receipts set sale_id = null, status = 'new' where id = p_id;
  else
    if exists (select 1 from evotor_receipts where sale_id = p_sale and id <> p_id) then raise exception 'Эта продажа уже связана с другим чеком'; end if;
    update evotor_receipts set sale_id = p_sale, status = 'matched' where id = p_id;
  end if;
end $$;
-- продажа в CRM по чеку, пробитому только на Эвоторе: списываем товар, деньги — в смену точки
create or replace function evotor_create_sale(p_id text) returns uuid language plpgsql security definer set search_path = public as $$
declare r evotor_receipts; it jsonb; items jsonb := '[]'; pays jsonb := '[]'; wh uuid; pr products; v uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into r from evotor_receipts where id = p_id for update;
  if r.id is null or r.status <> 'new' or r.doc_type <> 'SELL' then raise exception 'Чек уже обработан или это не продажа'; end if;
  if r.point_id is null then raise exception 'Магазин Эвотора не привязан к точке CRM'; end if;
  select cash_wh into wh from points where id = r.point_id;
  for it in select * from jsonb_array_elements(r.items) loop
    select * into pr from products where id::text = it->>'product_id';
    if pr.id is null then select * into pr from products where barcode is not null and barcode = it->>'barcode' limit 1; end if;
    if pr.id is not null and pr.track_serial then raise exception 'В чеке «%» — товар с IMEI: оформите продажу в кассе CRM и выберите экземпляр', pr.name; end if;
    if pr.id is not null then items := items || jsonb_build_object('product_id', pr.id, 'qty', round((it->>'qty')::numeric)::int, 'price', (it->>'price')::numeric, 'discount', greatest(0, (it->>'qty')::numeric*(it->>'price')::numeric - (it->>'sum')::numeric));
    else items := items || jsonb_build_object('product_id', null, 'name', coalesce(it->>'name','Позиция Эвотора'), 'kind', 'goods', 'qty', round((it->>'qty')::numeric)::int, 'price', (it->>'price')::numeric,
      'discount', greatest(0, (it->>'qty')::numeric*(it->>'price')::numeric - (it->>'sum')::numeric)); end if;
  end loop;
  if coalesce((r.payments->>'cash')::numeric,0) > 0 then pays := pays || jsonb_build_object('method','cash','amount',(r.payments->>'cash')::numeric); end if;
  if coalesce((r.payments->>'card')::numeric,0) > 0 then pays := pays || jsonb_build_object('method','card','amount',(r.payments->>'card')::numeric); end if;
  v := create_sale(wh, null, items, pays, 0, null, 0, null, 'store');
  update evotor_receipts set sale_id = v, status = 'created' where id = r.id;
  return v;
end $$;
revoke execute on function evotor_link(text,uuid,boolean), evotor_create_sale(text) from public, anon;
grant execute on function evotor_link(text,uuid,boolean), evotor_create_sale(text) to authenticated;

-- забирать чеки из Облака каждые 10 минут (если токен задан); вебхук «Отправить чек» приходит сразу
select cron.unschedule('icase-evotor-pull') where exists (select 1 from cron.job where jobname = 'icase-evotor-pull');
select cron.schedule('icase-evotor-pull', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://wputkpwptwaxwzebszua.supabase.co/functions/v1/evotor',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name = 'icase_site_cron_token')),
    body := '{"action":"pull"}'::jsonb)
  where exists (select 1 from vault.secrets where name = 'icase_evotor_token')
    and exists (select 1 from public.points where evotor_store_id is not null);
$cron$);


-- ===== mig_perf.sql: RLS initplan, разделение политик, индексы внешних ключей =====
-- v3: оптимизация базы.
-- 1) Политики RLS: has_role()/is_staff()/auth.uid() вычисляются один раз на запрос (обёртка SELECT), а не для каждой строки.
-- 2) Политики «на всё» (ALL), которые дублируют политику чтения, делятся на INSERT/UPDATE/DELETE —
--    при чтении проверяется одна политика вместо двух-трёх. Права доступа не меняются.
-- 3) Индексы на внешние ключи, по которым идут связи и выборки (кроме ссылок «кто создал»).
-- Миграцию можно запускать повторно.

/* --- ремонт: две политики чтения (сотрудники и кабинет клиента) → одна --- */
do $$ declare q text; begin
  select qual into q from pg_policies where schemaname='public' and tablename='repairs' and policyname='staff_read';
  if q is not null and exists (select 1 from pg_policies where schemaname='public' and tablename='repairs' and policyname='own_repairs') then
    execute 'drop policy own_repairs on repairs';
    execute 'drop policy staff_read on repairs';
    execute format('create policy staff_read on repairs for select using ((%s) or (customer_id in (select c.id from customers c where c.auth_user = (select auth.uid()))))', q);
  end if;
end $$;

do $$
declare p record; q text; w text; rl text; perm text; split boolean; n int := 0;
  wrap constant text := '(?<!SELECT )(has_role\(VARIADIC ARRAY\[[^\]]*\]\)|is_staff\(\)|auth\.uid\(\)|my_role\(\)|my_point\(\))';
begin
  for p in select * from pg_policies where schemaname = 'public' order by tablename, policyname loop
    q := case when p.qual is null then null else regexp_replace(p.qual, wrap, '(SELECT \1)', 'g') end;
    w := case when p.with_check is null then null else regexp_replace(p.with_check, wrap, '(SELECT \1)', 'g') end;
    split := p.cmd = 'ALL' and exists (select 1 from pg_policies o where o.schemaname = 'public' and o.tablename = p.tablename
               and o.policyname <> p.policyname and o.cmd in ('SELECT','ALL') and o.permissive = 'PERMISSIVE');
    if q is not distinct from p.qual and w is not distinct from p.with_check and not split then continue; end if;
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into rl from unnest(p.roles) r;
    perm := case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    if split then
      execute format('create policy %I on public.%I as %s for insert to %s with check (%s)', p.policyname || '_ins', p.tablename, perm, rl, coalesce(w, q));
      execute format('create policy %I on public.%I as %s for update to %s using (%s) with check (%s)', p.policyname || '_upd', p.tablename, perm, rl, q, coalesce(w, q));
      execute format('create policy %I on public.%I as %s for delete to %s using (%s)', p.policyname || '_del', p.tablename, perm, rl, q);
    else
      execute format('create policy %I on public.%I as %s for %s to %s%s%s', p.policyname, p.tablename, perm, p.cmd, rl,
        case when q is not null then format(' using (%s)', q) else '' end,
        case when w is not null then format(' with check (%s)', w) else '' end);
    end if;
    n := n + 1;
  end loop;
  raise notice 'политик обновлено: %', n;
end $$;

/* --- индексы на внешние ключи --- */
do $$
declare f record; n int := 0;
begin
  for f in
    select c.conrelid::regclass::text tbl, a.attname col, c.confrelid::regclass::text ref
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey,1) = 1
      and c.confrelid <> 'public.staff'::regclass            -- «кто создал/провёл» — по ним не ищем
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s(%I)', left(replace(f.tbl,'public.','') || '_' || f.col || '_fk', 63), f.tbl, f.col);
    n := n + 1;
  end loop;
  raise notice 'индексов на внешние ключи: %', n;
end $$;

-- частые выборки интерфейса
create index if not exists sales_created_idx on sales(created_at desc);
create index if not exists cash_ops_created_idx on cash_ops(created_at desc);
create index if not exists cash_ops_ref_idx on cash_ops(ref);
create index if not exists returns_created_idx on returns(created_at desc);
create index if not exists units_imei2_idx on units(imei2) where imei2 is not null;
analyze;


-- ===== mig_imei.sql: база IMEI (TAC), артикулы коробок, обучение на приёмках =====
-- =====================================================================
-- iCase · база IMEI: определение модели по IMEI (TAC), артикулу Apple с коробки и опыту своих приёмок
--  tac_db       — справочник TAC (первые 8 цифр IMEI → бренд, модель, номер модели, год). Источник:
--                 github.com/MoazEb/tac-database (MIT), загружается функциями tac_import_start/tac_import_finish.
--  device_hints — чему CRM научилась сама: TAC и артикул коробки → модель каталога, память, цвет, опции
--                 (пополняется автоматически при каждом приходе экземпляра).
--  device_lookup(code) — что за устройство: модель, вероятная память/цвет, проверка контрольной цифры,
--                 есть ли уже такой экземпляр в базе.
-- =====================================================================

create table if not exists tac_db (
  tac text primary key,
  brand text not null,
  model text not null,           -- «iPhone 15 Pro Max», «Galaxy S24»
  model_no text,                 -- A3106, SM-S921B
  year int
);
alter table tac_db enable row level security;
drop policy if exists staff_read on tac_db;
create policy staff_read on tac_db for select using ((select is_staff()));

create table if not exists device_hints (
  key text primary key,          -- 'tac:35982437' | 'part:MTUV3'
  model_id uuid references apple_models(id) on delete cascade,
  name text,                     -- последнее название товара
  brand text,
  stats jsonb not null default '{}'::jsonb,  -- {"model":{id:n},"memory":{"256 ГБ":3},"color":{...},"opts":{"SIM":{"eSIM":2}}}
  hits int not null default 0,
  updated_at timestamptz not null default now()
);
alter table device_hints enable row level security;
drop policy if exists staff_read on device_hints;
create policy staff_read on device_hints for select using ((select is_staff()));

alter table units add column if not exists part_no text;   -- артикул Apple с коробки (MTUV3ZD/A)

-- приход экземпляра запоминает артикул коробки
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
      kit = coalesce(nullif(p->>'kit',''), pr.kit), diagnostics = nullif(p->>'diagnostics',''), attrs = v_attrs,
      part_no = coalesce(nullif(regexp_replace(upper(trim(p->>'part_no')),'^1P',''),''), part_no)
    where id = u.id;
    o_id := u.id; o_created := false;
  else
    insert into units(product_id, imei, imei2, serial_no, warehouse_id, status, condition, battery_health, kit, diagnostics, cost, price, last_ref, attrs, part_no)
    values (p_product, v_imei, v_imei2, v_sn, p_wh, 'in_stock', coalesce(nullif(p->>'condition',''), pr.condition), nullif(p->>'battery_health','')::int,
      coalesce(nullif(p->>'kit',''), pr.kit), nullif(p->>'diagnostics',''), coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), nullif(p->>'price','')::numeric, p_ref, v_attrs, nullif(regexp_replace(upper(trim(p->>'part_no')),'^1P',''),''))
    returning id into o_id;
    o_created := true; o_before := null;
  end if;
end $$;
revoke execute on function unit_receive(uuid,uuid,jsonb,numeric,text) from public, anon, authenticated;

/* ---------- нормализация ---------- */
create or replace function imei_luhn_ok(p text) returns boolean language sql immutable as $$
  select case when p !~ '^\d{15}$' then false else (
    select sum(case when i % 2 = 0 then (d*2)/10 + (d*2)%10 else d end) % 10 = 0
    from (select i, substr(p, i, 1)::int d from generate_series(1,15) i) x) end
$$;

-- артикул Apple: MTUV3ZD/A, 1PMTUV3ZD/A (так он закодирован в штрихкоде коробки) → базовые 5 символов
create or replace function apple_part_base(p text) returns text language sql immutable as $$
  select case when u ~ '^(1P)?[A-Z][A-Z0-9]{4}[A-Z]{1,2}/[A-Z]$' then substr(regexp_replace(u,'^1P',''),1,5) end
  from (select upper(regexp_replace(coalesce(p,''),'\s','','g')) u) x
$$;

-- «APPLE IPHONE SE (2ND GEN)» → «iPhone SE (2nd Gen)»
create or replace function tac_pretty(p_brand text, p_model text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    initcap(case when upper(p_model) like upper(p_brand)||' %' then substr(p_model, length(p_brand)+2) else p_model end),
    '\mIphone','iPhone','g'),'\mIpad','iPad','g'),'\mSe\M','SE','g'),'\mFe\M','FE','g'),'\mXr\M','XR','g'),'\mXs\M','XS','g'),'(\d)E\M','\1e','g'),'\mAirpods','AirPods','g'))
$$;

create or replace function model_key(p text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(p,'')),'^apple\s+',''),'[^a-z0-9]','','g')
$$;

-- модель справочника TAC → модель каталога CRM
create or replace function tac_catalog_model(p_model text, p_model_no text) returns uuid language sql stable security definer set search_path=public as $$
  select id from apple_models m
  where m.is_active and model_key(m.name) = case
      when upper(coalesce(p_model_no,'')) ~ 'A(2275|2296|2298)' or p_model ilike '%SE (2nd%' or p_model ilike '%SE(2nd%' then model_key('iPhone SE (2-го поколения)')
      when upper(coalesce(p_model_no,'')) ~ 'A(2595|2782|2783|2784|2785)' or p_model ilike '%SE (3rd%' then model_key('iPhone SE (3-го поколения)')
      else model_key(p_model) end
  order by m.sort desc limit 1
$$;

/* ---------- загрузка справочника TAC (владелец) ---------- */
create or replace function tac_import_start(p_url text default 'https://raw.githubusercontent.com/MoazEb/tac-database/main/tac_full.csv')
returns bigint language plpgsql security definer set search_path=public, extensions as $$
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  return net.http_get(url := p_url, timeout_milliseconds := 120000);
end $$;

create or replace function tac_load_csv(p_csv text) returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  create temp table _tac on commit drop as
  select m[1] brand, m[2] tac, trim(both '"' from m[3]) specs
  from regexp_split_to_table(p_csv, E'\r?\n') l, regexp_match(l, '^([^,]+),([0-9]{6,8}),(.+)$') m
  where l !~ '^Brand,';
  insert into tac_db(tac,brand,model,model_no,year)
  select distinct on (t) t, b, tac_pretty(b, mdl), case when mno ~ '^[A-Za-z0-9][A-Za-z0-9/-]{2,}$' then upper(mno) end, yr from (
    select lpad(tac,8,'0') t, brand brand_raw,
      case when length(brand)<=3 then upper(brand) else initcap(brand) end b,
      split_part(specs, ', ', 1) mdl,
      coalesce((regexp_match(specs, '\m(A\d{4})\M'))[1], case when split_part(specs,', ',3) !~ '^\d{4}$' then split_part(split_part(specs,', ',3),' - ',1) end) mno,
      (regexp_match(specs, ',\s*((?:19|20)\d{2})(?:,|$)'))[1]::int yr
    from _tac) x
  where mdl <> '' and upper(trim(mdl)) <> upper(trim(brand_raw))
  order by t
  on conflict (tac) do update set brand=excluded.brand, model=excluded.model, model_no=excluded.model_no, year=excluded.year;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function tac_import_finish(p_request bigint) returns jsonb language plpgsql security definer set search_path=public, extensions as $$
declare r record; n int;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select status_code, content, error_msg into r from net._http_response where id = p_request;
  if not found then return jsonb_build_object('status','wait'); end if;
  if r.status_code is distinct from 200 then return jsonb_build_object('status','error','code',r.status_code,'error',r.error_msg); end if;
  n := tac_load_csv(r.content);
  return jsonb_build_object('status','ok','rows',n,'total',(select count(*) from tac_db));
end $$;
revoke execute on function tac_load_csv(text) from public, anon, authenticated;

/* ---------- обучение на своих приёмках ---------- */
create or replace function device_hint_add(p_key text, p_product uuid) returns void language plpgsql security definer set search_path=public as $$
declare p record; s jsonb; k text; v text;
begin
  if p_key is null then return; end if;
  select catalog_id, name, brand, memory, color, attrs into p from products where id = p_product;
  if not found then return; end if;
  insert into device_hints(key) values (p_key) on conflict do nothing;
  select stats into s from device_hints where key = p_key for update;
  if p.catalog_id is not null then s := jsonb_set(jsonb_set(s,'{model}',coalesce(s->'model','{}')), array['model', p.catalog_id::text], to_jsonb(coalesce((s#>>array['model',p.catalog_id::text])::int,0)+1)); end if;
  if p.memory is not null then s := jsonb_set(jsonb_set(s,'{memory}',coalesce(s->'memory','{}')), array['memory',p.memory], to_jsonb(coalesce((s#>>array['memory',p.memory])::int,0)+1)); end if;
  if p.color is not null then s := jsonb_set(jsonb_set(s,'{color}',coalesce(s->'color','{}')), array['color',p.color], to_jsonb(coalesce((s#>>array['color',p.color])::int,0)+1)); end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p.attrs,'{}')) where jsonb_typeof(value)='string' and value #>> '{}' <> '' loop
    s := jsonb_set(jsonb_set(jsonb_set(s,'{opts}',coalesce(s->'opts','{}')), array['opts',k], coalesce(s#>array['opts',k],'{}')), array['opts',k,v], to_jsonb(coalesce((s#>>array['opts',k,v])::int,0)+1));
  end loop;
  update device_hints set stats = s, hits = hits + 1, name = p.name, brand = coalesce(p.brand, brand),
    model_id = coalesce((select key::uuid from jsonb_each_text(s->'model') order by value::int desc limit 1), model_id), updated_at = now()
  where key = p_key;
end $$;
revoke execute on function device_hint_add(text, uuid) from public, anon, authenticated;

create or replace function units_learn() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' or new.imei is distinct from old.imei or new.part_no is distinct from old.part_no or new.product_id is distinct from old.product_id then
    if new.imei ~ '^\d{15}$' then perform device_hint_add('tac:'||left(new.imei,8), new.product_id); end if;
    if new.imei2 ~ '^\d{15}$' and left(new.imei2,8) <> left(coalesce(new.imei,''),8) then perform device_hint_add('tac:'||left(new.imei2,8), new.product_id); end if;
    if apple_part_base(new.part_no) is not null then perform device_hint_add('part:'||apple_part_base(new.part_no), new.product_id); end if;
  end if;
  return new;
end $$;
drop trigger if exists units_learn on units;
create trigger units_learn after insert or update of imei, imei2, part_no, product_id on units for each row execute function units_learn();

/* ---------- что за устройство ---------- */
create or replace function device_lookup(p_code text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_c text := upper(regexp_replace(coalesce(p_code,''),'\s','','g')); v_kind text; v_tac text; v_part text; t tac_db%rowtype; h device_hints%rowtype;
  res jsonb; u record; v_mid uuid; m record; best jsonb := '{}'; one jsonb; f text;
begin
  if not is_staff() then raise exception 'Нет доступа'; end if;
  if v_c ~ '^\d{14,15}$' then v_kind := 'imei'; v_tac := left(v_c,8);
  elsif apple_part_base(v_c) is not null then v_kind := 'part'; v_part := apple_part_base(v_c);
  elsif v_c ~ '^S[A-Z0-9]{10}$' or v_c ~ '^S[A-Z0-9]{12}$' then v_kind := 'serial'; v_c := substr(v_c,2);
  elsif v_c ~ '^[A-Z0-9]{8,14}$' and v_c ~ '[A-Z]' and v_c ~ '\d' then v_kind := 'serial';
  else v_kind := 'unknown'; end if;
  res := jsonb_build_object('kind',v_kind,'code',case when v_kind='part' then regexp_replace(v_c,'^1P','') else v_c end);
  if v_kind = 'imei' then res := res || jsonb_build_object('tac',v_tac,'valid',case when length(v_c)=15 then imei_luhn_ok(v_c) end); end if;

  if v_tac is not null then
    select * into t from tac_db d where d.tac = v_tac;
    if found then res := res || jsonb_build_object('ref', jsonb_build_object('brand',t.brand,'model',t.model,'model_no',t.model_no,'year',t.year));
      if t.brand ilike 'apple' then v_mid := tac_catalog_model(t.model, t.model_no); end if; end if;
    select * into h from device_hints d where d.key = 'tac:'||v_tac;
  elsif v_part is not null then
    select * into h from device_hints d where d.key = 'part:'||v_part;
  end if;

  if h.key is not null then
    -- вероятное значение берём, только если оно встречалось не реже чем в 80% приёмок
    foreach f in array array['memory','color'] loop
      one := null;
      select jsonb_build_object('value',key,'n',value::int,'of',tot) into one
      from (select key, value, sum(value::int) over () tot from jsonb_each_text(coalesce(h.stats->f,'{}'))) x
      where value::int >= 0.8*tot order by value::int desc limit 1;
      if one is not null then best := best || jsonb_build_object(f, one); end if;
    end loop;
    res := res || jsonb_build_object('learned', jsonb_build_object('model_id',h.model_id,'name',h.name,'brand',h.brand,'hits',h.hits,'stats',h.stats,'best',best));
    v_mid := coalesce(h.model_id, v_mid);
  end if;
  if v_mid is not null then select id, family, name into m from apple_models where id = v_mid;
    if found then res := res || jsonb_build_object('model', jsonb_build_object('id',m.id,'family',m.family,'name',m.name)); end if; end if;

  if v_kind in ('imei','serial') then
    select un.id, un.status, un.product_id, p.name into u
    from units un join products p on p.id = un.product_id
    where un.imei = v_c or un.imei2 = v_c or upper(un.serial_no) = v_c limit 1;
    if found then res := res || jsonb_build_object('unit', jsonb_build_object('id',u.id,'status',u.status,'product_id',u.product_id,'name',u.name)); end if;
  end if;
  return res;
end $$;
create or replace function tac_stats() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('tac',(select count(*) from tac_db),'apple',(select count(*) from tac_db where brand='Apple'),
    'learned',(select count(*) from device_hints),'parts',(select count(*) from device_hints where key like 'part:%')) where is_staff()
$$;
grant execute on function device_lookup(text), tac_stats() to authenticated;
grant execute on function tac_import_start(text), tac_import_finish(bigint) to authenticated;

select refresh_col_grants();
