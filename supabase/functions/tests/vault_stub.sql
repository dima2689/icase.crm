create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets(name,secret) values(n,s) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret=s where id=i $$;
do $$ begin create role service_role; exception when others then null; end $$;
