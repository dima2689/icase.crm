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
