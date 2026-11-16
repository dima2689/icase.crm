-- Бот Telegram на данных CRM (режим CRM_MODE в боте): каталог и остатки, продажи и возвраты, клиенты,
-- правка карточки товара и переоценка. Вызывает только edge-функция bot-api (service_role).

-- весь каталог для бота: товары (без архива) с категорией, кодами, ценой, остатком и резервом; дерево категорий
create or replace function bot_catalog() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'folders', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent', c.parent_id) order by c.name),'[]') from categories c),
    'products', (select coalesce(jsonb_agg(x),'[]') from (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'category_id', p.category_id, 'sku', coalesce(p.sku,''), 'barcode', p.barcode,
        'description', coalesce(p.description,''), 'price', p.price, 'cost', p.cost, 'condition', p.condition,
        'serial_tracked', coalesce(p.track_serial,false), 'updated_at', p.updated_at,
        'stock', coalesce((select sum(st.qty) from stock st join warehouses w on w.id = st.warehouse_id
                           where st.product_id = p.id and coalesce(w.kind,'') <> 'Резерв'),0),
        'reserve', coalesce((select sum(st.qty) from stock st join warehouses w on w.id = st.warehouse_id
                             where st.product_id = p.id and coalesce(w.kind,'') = 'Резерв'),0),
        'serials', (select coalesce(jsonb_agg(coalesce(u.imei, u.serial_no)),'[]') from units u
                    where u.product_id = p.id and u.status in ('in_stock','reserved'))) x
      from products p where not p.is_archived) t));
end $$;

-- одна карточка для редактора бота
create or replace function bot_product(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', coalesce(p.description,''), 'price', p.price,
    'cost', p.cost, 'archived', p.is_archived, 'updated_at', p.updated_at)
  from products p where p.id = p_id $$;

-- правка из бота: название, описание, цена; p_expect = updated_at карточки, которую видел сотрудник
create or replace function bot_product_update(p_id uuid, p_expect text, p_fields jsonb, p_actor text) returns jsonb language plpgsql security definer set search_path = public as $$
declare p products; nm text; ds text; pr numeric;
begin
  select * into p from products where id = p_id for update;
  if p.id is null or p.is_archived then raise exception 'Карточка недоступна или в архиве'; end if;
  if coalesce(p_expect,'') <> '' and p.updated_at <> p_expect::timestamptz then raise exception 'Карточка изменилась в CRM. Откройте редактор заново'; end if;
  nm := coalesce(nullif(btrim(p_fields->>'name'),''), p.name);
  ds := case when p_fields ? 'description' then p_fields->>'description' else p.description end;
  pr := coalesce(nullif(p_fields->>'price','')::numeric, p.price);
  if length(nm) > 255 or length(coalesce(ds,'')) > 4096 or pr < 0 or pr > 1000000000 then raise exception 'Недопустимые значения карточки'; end if;
  update products set name = nm, description = ds, price = round(pr, 2), updated_at = now() where id = p_id returning * into p;
  insert into audit_log(action, ref, details) values ('Карточка товара из бота', p.name, 'бот: ' || left(coalesce(p_actor,''), 100));
  return bot_product(p_id);
end $$;

-- продажи / возвраты за период (даты по Москве, включительно), по 50
create or replace function bot_sales(p_kind text, p_from date, p_to date, p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t0 timestamptz := case when p_from is null then '-infinity'::timestamptz else p_from::timestamp at time zone 'Europe/Moscow' end;
        t1 timestamptz := case when p_to is null then 'infinity'::timestamptz else (p_to + 1)::timestamp at time zone 'Europe/Moscow' end;
        off int := greatest(coalesce(p_offset,0),0);
begin
  if p_kind = 'return' then
    return jsonb_build_object(
      'total', (select count(*) from returns where created_at >= t0 and created_at < t1),
      'items', (select coalesce(jsonb_agg(x),'[]') from (select jsonb_build_object('id', r.id, 'name', r.num, 'moment', r.created_at, 'total', r.amount,
                 'applicable', true, 'cash', case when r.method = 'cash' then r.amount else 0 end,
                 'card', case when r.method in ('card','transfer') then r.amount else 0 end, 'qr', case when r.method = 'sbp' then r.amount else 0 end) x
                from returns r where r.created_at >= t0 and r.created_at < t1 order by r.created_at desc offset off limit 50) t));
  end if;
  return jsonb_build_object(
    'total', (select count(*) from sales where created_at >= t0 and created_at < t1),
    'items', (select coalesce(jsonb_agg(x),'[]') from (select jsonb_build_object('id', s.id, 'name', s.num, 'moment', s.created_at, 'total', s.total,
               'applicable', s.status <> 'returned',
               'cash', coalesce((select sum(amount) from sale_payments where sale_id = s.id and method = 'cash'),0),
               'card', coalesce((select sum(amount) from sale_payments where sale_id = s.id and method in ('card','transfer')),0),
               'qr', coalesce((select sum(amount) from sale_payments where sale_id = s.id and method = 'sbp'),0)) x
              from sales s where s.created_at >= t0 and s.created_at < t1 order by s.created_at desc offset off limit 50) t));
end $$;

create or replace function bot_finance(p_from date, p_to date) returns jsonb language sql stable security definer set search_path = public as $$
  with b as (select p_from::timestamp at time zone 'Europe/Moscow' t0, (p_to + 1)::timestamp at time zone 'Europe/Moscow' t1)
  select jsonb_build_object(
    'sales', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total),0)) from sales, b where created_at >= b.t0 and created_at < b.t1),
    'returns', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(amount),0)) from returns, b where created_at >= b.t0 and created_at < b.t1)) $$;

-- клиенты: поиск, карточка, история, сохранение (телефон в CRM — 10 цифр без +7)
create or replace function bot_customer_json(c customers) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'phone', case when c.phone is null then '' else '+7' || c.phone end,
    'email', coalesce(c.email,''), 'updated', c.updated_at::text) $$;

create or replace function bot_customers(p_q text, p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := lower(btrim(coalesce(p_q,''))); d text := regexp_replace(coalesce(p_q,''), '\D', '', 'g');
begin
  if d <> '' and q ~ '^[+0-9\s().-]+$' then d := right(d, 10); else d := ''; end if;
  return jsonb_build_object(
      'total', (select count(*) from customers c where c.merged_into is null and (q = '' or (d <> '' and c.phone like '%' || d || '%') or (d = '' and lower(c.name) like '%' || q || '%'))),
      'items', (select coalesce(jsonb_agg(bot_customer_json(c) order by lower(c.name), c.id),'[]') from (
                 select * from customers c where c.merged_into is null and (q = '' or (d <> '' and c.phone like '%' || d || '%') or (d = '' and lower(c.name) like '%' || q || '%'))
                 order by lower(c.name), c.id offset greatest(coalesce(p_offset,0),0) limit 50) c),
      'offset', greatest(coalesce(p_offset,0),0));
end $$;

create or replace function bot_customer(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select bot_customer_json(c) from customers c where c.id = p_id and c.merged_into is null $$;

create or replace function bot_customer_history(p_id uuid, p_kind text, p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare off int := greatest(coalesce(p_offset,0),0);
begin
  if p_kind = 'return' then
    return jsonb_build_object('total', (select count(*) from returns where customer_id = p_id), 'offset', off, 'kind', p_kind,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', num, 'moment', created_at, 'total', amount, 'applicable', true) order by created_at desc),'[]')
                from (select * from returns where customer_id = p_id order by created_at desc offset off limit 50) r));
  end if;
  return jsonb_build_object('total', (select count(*) from sales where customer_id = p_id), 'offset', off, 'kind', 'sale',
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', num, 'moment', created_at, 'total', total, 'applicable', status <> 'returned') order by created_at desc),'[]')
              from (select * from sales where customer_id = p_id order by created_at desc offset off limit 50) s));
end $$;

-- p = {id?, updated?, name, phone, email}; телефон: первый номер, последние 10 цифр
create or replace function bot_customer_save(p jsonb, p_actor text) returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers; ph text := nullif(right(regexp_replace(split_part(coalesce(p->>'phone',''), ',', 1), '\D', '', 'g'), 10), '');
        nm text := btrim(coalesce(p->>'name','')); em text := nullif(btrim(coalesce(p->>'email','')), ''); cid uuid := nullif(p->>'id','')::uuid;
begin
  if nm = '' or length(nm) > 255 then raise exception 'Укажите имя клиента'; end if;
  if ph is not null and length(ph) <> 10 then raise exception 'Укажите корректный телефон с кодом страны'; end if;
  if ph is not null and exists (select 1 from customers where customers.phone = ph and customers.id is distinct from cid and customers.merged_into is null) then
    raise exception 'Этот телефон уже есть у другого клиента CRM. Откройте его карточку';
  end if;
  if cid is null then
    insert into customers(name, phone, email, source) values (nm, ph, em, 'Бот Telegram') returning * into c;
    insert into audit_log(action, ref, details) values ('Клиент из бота', nm, 'бот: ' || left(coalesce(p_actor,''), 100));
  else
    select * into c from customers where customers.id = cid for update;
    if c.id is null or c.merged_into is not null then raise exception 'Клиент не найден'; end if;
    if coalesce(p->>'updated','') <> c.updated_at::text then raise exception 'Карточка изменилась в CRM. Закройте и откройте её заново'; end if;
    update customers set name = nm, phone = ph, email = em where customers.id = c.id returning * into c;
  end if;
  return bot_customer_json(c);
end $$;

revoke execute on function bot_catalog(), bot_product(uuid), bot_product_update(uuid,text,jsonb,text), bot_sales(text,date,date,int),
  bot_finance(date,date), bot_customer_json(customers), bot_customers(text,int), bot_customer(uuid), bot_customer_history(uuid,text,int),
  bot_customer_save(jsonb,text) from public, anon, authenticated;
grant execute on function bot_catalog(), bot_product(uuid), bot_product_update(uuid,text,jsonb,text), bot_sales(text,date,date,int),
  bot_finance(date,date), bot_customer_json(customers), bot_customers(text,int), bot_customer(uuid), bot_customer_history(uuid,text,int),
  bot_customer_save(jsonb,text) to service_role;
