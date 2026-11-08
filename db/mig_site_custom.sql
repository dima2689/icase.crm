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
