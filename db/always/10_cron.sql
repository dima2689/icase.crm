-- Повторяемый файл: выполняется при каждой выкладке и после восстановления из бэкапа.
-- Расписания фоновых задач; адрес функций берётся из Vault (icase_functions_url).
select cron.unschedule('icase-site-sync') where exists (select 1 from cron.job where jobname = 'icase-site-sync');
select cron.schedule('icase-site-sync', '*/2 * * * *', $cron$
  select net.http_post(
    url := public.icase_functions_url() || '/site-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name = 'icase_site_cron_token')),
    body := '{}'::jsonb)
  where (select site_sync from public.settings where id = 1)
    and exists (select 1 from public.integration_jobs where target = 'woocommerce' and status = 'pending');
$cron$);

select cron.unschedule('icase-evotor-pull') where exists (select 1 from cron.job where jobname = 'icase-evotor-pull');
select cron.schedule('icase-evotor-pull', '*/10 * * * *', $cron$
  select net.http_post(
    url := public.icase_functions_url() || '/evotor',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name = 'icase_site_cron_token')),
    body := '{"action":"pull"}'::jsonb)
  where exists (select 1 from vault.secrets where name = 'icase_evotor_token')
    and exists (select 1 from public.points where evotor_store_id is not null);
$cron$);
