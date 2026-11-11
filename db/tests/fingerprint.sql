-- Отпечаток схемы: сравниваем рабочую базу и базу, собранную из db/schema.sql + db/migrations.
-- Строки «вид|имя|подробности», отсортированы. Различия = схема в репозитории не совпадает с рабочей.
with t as (
  select 'table|'||c.relname||'|'||string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then '!' else '' end, ',' order by a.attname) l
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind in ('r','v','p') group by c.relname
  union all select 'func|'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(trim(regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','g'),'--[^\n]*','','g'),'\s+',' ','g')))||'|'||p.prosecdef
  from pg_proc p where p.pronamespace='public'::regnamespace
  union all select 'policy|'||schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||md5(coalesce(qual,'')||coalesce(with_check,''))
  from pg_policies where schemaname in ('public','storage')
  union all select 'trigger|'||c.relname||'.'||tg.tgname||'|'||pg_get_triggerdef(tg.oid)
  from pg_trigger tg join pg_class c on c.oid=tg.tgrelid where c.relnamespace='public'::regnamespace and not tg.tgisinternal
  union all select 'enum|'||t.typname||'|'||string_agg(e.enumlabel,',' order by e.enumsortorder)
  from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname
  union all select 'index|'||indexname||'|'||md5(indexdef) from pg_indexes where schemaname='public'
  union all select 'rls|'||relname||'|'||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
  union all select 'bucket|'||id||'|'||public::text from storage.buckets
  union all select 'cron|'||jobname||'|'||schedule||'|'||md5(regexp_replace(command,'\s+',' ','g')) from cron.job
)
select l from t order by l;
