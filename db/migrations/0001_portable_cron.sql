-- Переносимость: адрес edge-функций больше не зашит в расписания.
-- Он хранится в Vault (секрет icase_functions_url) и задаётся при выкладке (deploy/migrate.sh):
--   свой сервер:     http://functions:9000           (внутри docker-сети, без выхода в интернет)
--   облако Supabase: https://<проект>.supabase.co/functions/v1
create or replace function public.icase_functions_url() returns text
language sql stable security definer set search_path = public, vault as $$
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'icase_functions_url'), 'http://functions:9000')
$$;

create or replace function public.icase_set_functions_url(p_url text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  if p_url is null or p_url !~ '^https?://[^ ]+$' then raise exception 'Некорректный адрес функций: %', p_url; end if;
  select id into v from vault.secrets where name = 'icase_functions_url';
  if v is null then perform vault.create_secret(rtrim(p_url,'/'), 'icase_functions_url');
  else perform vault.update_secret(v, rtrim(p_url,'/')); end if;
end $$;

revoke execute on function public.icase_functions_url(), public.icase_set_functions_url(text) from public, anon, authenticated;

-- секрет для вызовов по расписанию (на новой базе его ещё нет)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'icase_site_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24),'hex'), 'icase_site_cron_token');
  end if;
end $$;

-- сами расписания — в db/always/10_cron.sql (применяется при каждой выкладке)
