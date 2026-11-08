-- v3: обмен с сайтом (WooCommerce): выгрузка цен/остатков/товаров/б/у экземпляров, приём заказов с резервом
create extension if not exists pg_net schema extensions;
create extension if not exists pg_cron;

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

-- расписание: раз в 2 минуты, если есть что выгружать и выгрузка включена — вызвать edge-функцию site-sync
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'icase_site_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24),'hex'), 'icase_site_cron_token');
  end if;
end $$;
select cron.unschedule('icase-site-sync') where exists (select 1 from cron.job where jobname = 'icase-site-sync');
select cron.schedule('icase-site-sync', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://wputkpwptwaxwzebszua.supabase.co/functions/v1/site-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name = 'icase_site_cron_token')),
    body := '{}'::jsonb)
  where (select site_sync from public.settings where id = 1)
    and exists (select 1 from public.integration_jobs where target = 'woocommerce' and status = 'pending');
$cron$);
grant update (on_site) on units to authenticated;
