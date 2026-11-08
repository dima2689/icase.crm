-- v3: прайсы поставщиков — загрузка, поиск, сравнение цен, привязка к товарам CRM
alter table suppliers add column if not exists price_updated_at timestamptz, add column if not exists price_note text;
create table if not exists supplier_prices (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null, sku text, brand text,
  price numeric(12,2) not null default 0,
  stock text,                                   -- наличие у поставщика как в прайсе: «есть», «5», «под заказ 3 дня»
  note text,
  product_id uuid references products(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists supplier_prices_supplier on supplier_prices(supplier_id);
create index if not exists supplier_prices_product on supplier_prices(product_id);
alter table supplier_prices enable row level security;
drop policy if exists r_sp on supplier_prices;
drop policy if exists w_sp on supplier_prices;
create policy r_sp on supplier_prices for select using (has_role('owner','manager','storekeeper'));
create policy w_sp on supplier_prices for all using (has_role('owner','manager','storekeeper')) with check (has_role('owner','manager','storekeeper'));
revoke all on supplier_prices from anon;
grant select, insert, update, delete on supplier_prices to authenticated;
do $$ begin alter publication supabase_realtime add table supplier_prices; exception when others then null; end $$;

-- загрузить прайс: p_mode 'replace' — заменить весь прайс поставщика, 'append' — добавить строки (для больших прайсов частями)
create or replace function supplier_price_load(p_supplier uuid, p_rows jsonb, p_mode text default 'replace') returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role('owner','manager','storekeeper') then raise exception 'Нет права загружать прайсы'; end if;
  if not exists (select 1 from suppliers where id = p_supplier) then raise exception 'Поставщик не найден'; end if;
  if p_mode = 'replace' then delete from supplier_prices where supplier_id = p_supplier; end if;
  insert into supplier_prices(supplier_id, name, sku, brand, price, stock, note, product_id)
  select p_supplier, left(trim(r->>'name'),300), nullif(trim(r->>'sku'),''), nullif(trim(r->>'brand'),''),
         coalesce(substring(regexp_replace(replace(coalesce(r->>'price',''),',','.'),'\s','','g') from '[0-9]+(?:\.[0-9]+)?')::numeric,0),
         nullif(trim(r->>'stock'),''), nullif(trim(r->>'note'),''),
         coalesce(
           (select p.id from products p where nullif(trim(r->>'sku'),'') is not null and (p.sku = trim(r->>'sku') or p.barcode = trim(r->>'sku')) limit 1),
           (select p.id from products p where lower(p.name) = lower(trim(r->>'name')) and not p.is_archived limit 1))
  from jsonb_array_elements(p_rows) r
  where nullif(trim(r->>'name'),'') is not null;
  get diagnostics n = row_count;
  update suppliers set price_updated_at = now() where id = p_supplier;
  return n;
end $$;
revoke execute on function supplier_price_load(uuid,jsonb,text) from public, anon;
grant execute on function supplier_price_load(uuid,jsonb,text) to authenticated;
