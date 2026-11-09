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
-- site_config отдаёт секреты: только сервис
revoke execute on function site_config() from public, anon, authenticated;
grant execute on function site_config() to service_role;
