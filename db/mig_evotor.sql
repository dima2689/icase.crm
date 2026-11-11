-- v3: касса Эвотор через облачное API (api.evotor.ru).
-- Облако Эвотора умеет: принимать товары и цены из CRM, отдавать чеки (запросом и вебхуком «Отправить чек»).
-- Отправить чек на печать из CRM на кассу облачное API не умеет — фискальный чек пробивается на терминале.
-- CRM сверяет каждую свою продажу с фискальным чеком и может создать продажу из чека, пробитого только на Эвоторе.

alter table settings add column if not exists evotor jsonb not null default '{"push_products":true,"match_minutes":30}'::jsonb;

create table if not exists evotor_receipts (
  id text primary key,                         -- идентификатор документа в Облаке Эвотор
  store_id text not null,
  point_id uuid references points(id) on delete set null,
  device_id text,
  doc_type text not null,                      -- SELL / PAYBACK / …
  number text,
  closed_at timestamptz not null,
  total numeric(12,2) not null default 0,
  payments jsonb not null default '{}'::jsonb, -- {cash, card}
  items jsonb not null default '[]'::jsonb,    -- [{product_id, name, qty, price, sum}]
  sale_id uuid references sales(id) on delete set null,
  return_id uuid references returns(id) on delete set null,
  status text not null default 'new' check (status in ('new','matched','created','ignored')),
  note text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists evotor_receipts_point on evotor_receipts(point_id, closed_at);
create unique index if not exists evotor_receipts_sale on evotor_receipts(sale_id) where sale_id is not null;
create unique index if not exists evotor_receipts_ret on evotor_receipts(return_id) where return_id is not null;
alter table evotor_receipts enable row level security;
drop policy if exists er_r on evotor_receipts;
create policy er_r on evotor_receipts for select using (has_role('owner','manager','seller'));
grant select on evotor_receipts to authenticated;
do $$ begin execute 'alter publication supabase_realtime add table evotor_receipts'; exception when others then null; end $$;

/* --- секреты и настройки для функции evotor (только service_role) --- */
create or replace function evotor_config() returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'token', (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_token'),
    'hook_key', (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_hook'),
    'cfg', (select evotor from settings where id = 1),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('point_id', id, 'store_id', evotor_store_id, 'wh', cash_wh, 'name', name)), '[]'::jsonb) from points where evotor_store_id is not null and is_active))
$$;
revoke execute on function evotor_config() from public, anon, authenticated;
grant execute on function evotor_config() to service_role;

-- токен Облака Эвотора — только владелец, хранится в Vault
create or replace function evotor_set_token(p_token text) returns void language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  if nullif(trim(coalesce(p_token,'')),'') is null then raise exception 'Вставьте токен'; end if;
  select id into v from vault.secrets where name = 'icase_evotor_token';
  if v is null then perform vault.create_secret(trim(p_token), 'icase_evotor_token'); else perform vault.update_secret(v, trim(p_token)); end if;
  -- ключ для адреса вебхука создаётся один раз
  if not exists (select 1 from vault.secrets where name = 'icase_evotor_hook') then
    perform vault.create_secret(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'icase_evotor_hook');
  end if;
end $$;
create or replace function evotor_status() returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not has_role('owner','manager') then raise exception 'Нет права'; end if;
  return jsonb_build_object('has_token', exists(select 1 from vault.secrets where name = 'icase_evotor_token'),
    'hook_key', case when has_role('owner') then (select decrypted_secret from vault.decrypted_secrets where name = 'icase_evotor_hook') end,
    'last', (select max(created_at) from evotor_receipts), 'new', (select count(*) from evotor_receipts where status = 'new'));
end $$;
revoke execute on function evotor_set_token(text), evotor_status() from public, anon;
grant execute on function evotor_set_token(text), evotor_status() to authenticated;

/* --- товары для выгрузки на кассы точки --- */
create or replace function evotor_products(p_wh uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', left(p.name, 100), 'price', p.price, 'cost_price', p.cost,
      'quantity', coalesce((select qty from stock s where s.product_id = p.id and s.warehouse_id = p_wh), 0),
      'barcodes', case when p.barcode is not null then jsonb_build_array(p.barcode) else '[]'::jsonb end,
      'article_number', p.sku, 'measure_name', 'шт', 'tax', 'NO_VAT', 'allow_to_sell', true, 'type', 'NORMAL')), '[]'::jsonb)
  from products p where not p.is_archived
$$;
revoke execute on function evotor_products(uuid) from public, anon, authenticated;
grant execute on function evotor_products(uuid) to service_role;

/* --- приём чеков и автосверка с продажами CRM --- */
-- p = [{id, store_id, device_id, doc_type, number, closed_at, total, payments, items, raw}]
create or replace function evotor_ingest(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; r evotor_receipts; pt uuid; win int := coalesce(((select evotor from settings where id=1)->>'match_minutes')::int, 30); n_new int := 0; n_match int := 0; s uuid;
begin
  for x in select * from jsonb_array_elements(coalesce(p,'[]')) loop
    select id into pt from points where evotor_store_id = x->>'store_id' limit 1;
    insert into evotor_receipts(id, store_id, point_id, device_id, doc_type, number, closed_at, total, payments, items, raw)
      values (x->>'id', x->>'store_id', pt, x->>'device_id', coalesce(x->>'doc_type','SELL'), x->>'number', (x->>'closed_at')::timestamptz,
        coalesce((x->>'total')::numeric,0), coalesce(case jsonb_typeof(x->'payments') when 'string' then (x->>'payments')::jsonb else x->'payments' end,'{}'),
        coalesce(case jsonb_typeof(x->'items') when 'string' then (x->>'items')::jsonb else x->'items' end,'[]'), x->'raw')
      on conflict (id) do nothing returning * into r;
    if r.id is null then continue; end if;
    n_new := n_new + 1;
    if r.doc_type = 'SELL' and r.point_id is not null then
      select sl.id into s from sales sl where sl.point_id = r.point_id and sl.status <> 'cancelled' and abs(sl.total - r.total) < 1
        and abs(extract(epoch from sl.created_at - r.closed_at)) <= win*60
        and not exists (select 1 from evotor_receipts e where e.sale_id = sl.id)
        order by abs(extract(epoch from sl.created_at - r.closed_at)) limit 1;
      if s is not null then update evotor_receipts set sale_id = s, status = 'matched' where id = r.id; n_match := n_match + 1; end if;
    elsif r.doc_type = 'PAYBACK' and r.point_id is not null then
      select rt.id into s from returns rt join sales sl on sl.id = rt.sale_id where sl.point_id = r.point_id and abs(rt.amount - r.total) < 1
        and abs(extract(epoch from rt.created_at - r.closed_at)) <= win*60
        and not exists (select 1 from evotor_receipts e where e.return_id = rt.id)
        order by abs(extract(epoch from rt.created_at - r.closed_at)) limit 1;
      if s is not null then update evotor_receipts set return_id = s, status = 'matched' where id = r.id; n_match := n_match + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('new', n_new, 'matched', n_match);
end $$;
revoke execute on function evotor_ingest(jsonb) from public, anon, authenticated;
grant execute on function evotor_ingest(jsonb) to service_role;

-- ручная привязка / отметка «не учитывать»
create or replace function evotor_link(p_id text, p_sale uuid, p_ignore boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role('owner','manager') then raise exception 'Только владелец или управляющий'; end if;
  if p_ignore then update evotor_receipts set status = 'ignored' where id = p_id;
  elsif p_sale is null then update evotor_receipts set sale_id = null, status = 'new' where id = p_id;
  else
    if exists (select 1 from evotor_receipts where sale_id = p_sale and id <> p_id) then raise exception 'Эта продажа уже связана с другим чеком'; end if;
    update evotor_receipts set sale_id = p_sale, status = 'matched' where id = p_id;
  end if;
end $$;
-- продажа в CRM по чеку, пробитому только на Эвоторе: списываем товар, деньги — в смену точки
create or replace function evotor_create_sale(p_id text) returns uuid language plpgsql security definer set search_path = public as $$
declare r evotor_receipts; it jsonb; items jsonb := '[]'; pays jsonb := '[]'; wh uuid; pr products; v uuid;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  select * into r from evotor_receipts where id = p_id for update;
  if r.id is null or r.status <> 'new' or r.doc_type <> 'SELL' then raise exception 'Чек уже обработан или это не продажа'; end if;
  if r.point_id is null then raise exception 'Магазин Эвотора не привязан к точке CRM'; end if;
  select cash_wh into wh from points where id = r.point_id;
  for it in select * from jsonb_array_elements(r.items) loop
    select * into pr from products where id::text = it->>'product_id';
    if pr.id is null then select * into pr from products where barcode is not null and barcode = it->>'barcode' limit 1; end if;
    if pr.id is not null and pr.track_serial then raise exception 'В чеке «%» — товар с IMEI: оформите продажу в кассе CRM и выберите экземпляр', pr.name; end if;
    if pr.id is not null then items := items || jsonb_build_object('product_id', pr.id, 'qty', round((it->>'qty')::numeric)::int, 'price', (it->>'price')::numeric, 'discount', greatest(0, (it->>'qty')::numeric*(it->>'price')::numeric - (it->>'sum')::numeric));
    else items := items || jsonb_build_object('product_id', null, 'name', coalesce(it->>'name','Позиция Эвотора'), 'kind', 'goods', 'qty', round((it->>'qty')::numeric)::int, 'price', (it->>'price')::numeric,
      'discount', greatest(0, (it->>'qty')::numeric*(it->>'price')::numeric - (it->>'sum')::numeric)); end if;
  end loop;
  if coalesce((r.payments->>'cash')::numeric,0) > 0 then pays := pays || jsonb_build_object('method','cash','amount',(r.payments->>'cash')::numeric); end if;
  if coalesce((r.payments->>'card')::numeric,0) > 0 then pays := pays || jsonb_build_object('method','card','amount',(r.payments->>'card')::numeric); end if;
  v := create_sale(wh, null, items, pays, 0, null, 0, null, 'store');
  update evotor_receipts set sale_id = v, status = 'created' where id = r.id;
  return v;
end $$;
revoke execute on function evotor_link(text,uuid,boolean), evotor_create_sale(text) from public, anon;
grant execute on function evotor_link(text,uuid,boolean), evotor_create_sale(text) to authenticated;

-- забирать чеки из Облака каждые 10 минут (если токен задан); вебхук «Отправить чек» приходит сразу
select cron.unschedule('icase-evotor-pull') where exists (select 1 from cron.job where jobname = 'icase-evotor-pull');
select cron.schedule('icase-evotor-pull', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://wputkpwptwaxwzebszua.supabase.co/functions/v1/evotor',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name = 'icase_site_cron_token')),
    body := '{"action":"pull"}'::jsonb)
  where exists (select 1 from vault.secrets where name = 'icase_evotor_token')
    and exists (select 1 from public.points where evotor_store_id is not null);
$cron$);
