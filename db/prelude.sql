-- Расширения, которые нужны db/schema.sql. Выполняется один раз перед базовой схемой на новой базе.
-- В образе supabase/postgres все они уже есть, нужно только включить.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;
