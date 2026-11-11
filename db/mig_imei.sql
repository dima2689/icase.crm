-- =====================================================================
-- iCase · база IMEI: определение модели по IMEI (TAC), артикулу Apple с коробки и опыту своих приёмок
--  tac_db       — справочник TAC (первые 8 цифр IMEI → бренд, модель, номер модели, год). Источник:
--                 github.com/MoazEb/tac-database (MIT), загружается функциями tac_import_start/tac_import_finish.
--  device_hints — чему CRM научилась сама: TAC и артикул коробки → модель каталога, память, цвет, опции
--                 (пополняется автоматически при каждом приходе экземпляра).
--  device_lookup(code) — что за устройство: модель, вероятная память/цвет, проверка контрольной цифры,
--                 есть ли уже такой экземпляр в базе.
-- =====================================================================

create table if not exists tac_db (
  tac text primary key,
  brand text not null,
  model text not null,           -- «iPhone 15 Pro Max», «Galaxy S24»
  model_no text,                 -- A3106, SM-S921B
  year int
);
alter table tac_db enable row level security;
drop policy if exists staff_read on tac_db;
create policy staff_read on tac_db for select using ((select is_staff()));

create table if not exists device_hints (
  key text primary key,          -- 'tac:35982437' | 'part:MTUV3'
  model_id uuid references apple_models(id) on delete cascade,
  name text,                     -- последнее название товара
  brand text,
  stats jsonb not null default '{}'::jsonb,  -- {"model":{id:n},"memory":{"256 ГБ":3},"color":{...},"opts":{"SIM":{"eSIM":2}}}
  hits int not null default 0,
  updated_at timestamptz not null default now()
);
alter table device_hints enable row level security;
drop policy if exists staff_read on device_hints;
create policy staff_read on device_hints for select using ((select is_staff()));

alter table units add column if not exists part_no text;   -- артикул Apple с коробки (MTUV3ZD/A)

-- приход экземпляра запоминает артикул коробки
create or replace function unit_receive(p_product uuid, p_wh uuid, p jsonb, p_cost numeric, p_ref text, out o_id uuid, out o_created boolean, out o_before jsonb)
language plpgsql security definer set search_path = public as $$
declare v_imei text := nullif(trim(p->>'imei'),''); v_sn text := nullif(trim(p->>'serial_no'),''); v_imei2 text := nullif(trim(p->>'imei2'),'');
        u units; pr products; v_attrs jsonb := coalesce(p->'attrs','{}'::jsonb);
begin
  if v_imei is null and v_sn is null then raise exception 'Укажите IMEI или серийный номер'; end if;
  select * into pr from products where id = p_product;
  select * into u from units where (v_imei is not null and (imei = v_imei or imei2 = v_imei)) or (v_sn is not null and upper(serial_no) = upper(v_sn)) limit 1 for update;
  if u.id is not null then
    if u.status in ('in_stock','reserved','in_repair') then
      raise exception 'IMEI/SN % уже числится на складе («%»)', coalesce(v_imei, v_sn), (select name from products where id = u.product_id);
    end if;
    o_before := jsonb_build_object('product_id',u.product_id,'wh',u.warehouse_id,'status',u.status,'cost',u.cost,'price',u.price,'condition',u.condition,'battery_health',u.battery_health,'sale_item_id',u.sale_item_id);
    update units set product_id = p_product, warehouse_id = p_wh, status = 'in_stock', sale_item_id = null, last_ref = p_ref,
      imei = coalesce(v_imei, imei), imei2 = coalesce(v_imei2, imei2), serial_no = coalesce(v_sn, serial_no),
      cost = coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), price = nullif(p->>'price','')::numeric,
      condition = coalesce(nullif(p->>'condition',''), pr.condition), battery_health = nullif(p->>'battery_health','')::int,
      kit = coalesce(nullif(p->>'kit',''), pr.kit), diagnostics = nullif(p->>'diagnostics',''), attrs = v_attrs,
      part_no = coalesce(nullif(regexp_replace(upper(trim(p->>'part_no')),'^1P',''),''), part_no)
    where id = u.id;
    o_id := u.id; o_created := false;
  else
    insert into units(product_id, imei, imei2, serial_no, warehouse_id, status, condition, battery_health, kit, diagnostics, cost, price, last_ref, attrs, part_no)
    values (p_product, v_imei, v_imei2, v_sn, p_wh, 'in_stock', coalesce(nullif(p->>'condition',''), pr.condition), nullif(p->>'battery_health','')::int,
      coalesce(nullif(p->>'kit',''), pr.kit), nullif(p->>'diagnostics',''), coalesce(nullif(p->>'cost','')::numeric, p_cost, 0), nullif(p->>'price','')::numeric, p_ref, v_attrs, nullif(regexp_replace(upper(trim(p->>'part_no')),'^1P',''),''))
    returning id into o_id;
    o_created := true; o_before := null;
  end if;
end $$;
revoke execute on function unit_receive(uuid,uuid,jsonb,numeric,text) from public, anon, authenticated;

/* ---------- нормализация ---------- */
create or replace function imei_luhn_ok(p text) returns boolean language sql immutable as $$
  select case when p !~ '^\d{15}$' then false else (
    select sum(case when i % 2 = 0 then (d*2)/10 + (d*2)%10 else d end) % 10 = 0
    from (select i, substr(p, i, 1)::int d from generate_series(1,15) i) x) end
$$;

-- артикул Apple: MTUV3ZD/A, 1PMTUV3ZD/A (так он закодирован в штрихкоде коробки) → базовые 5 символов
create or replace function apple_part_base(p text) returns text language sql immutable as $$
  select case when u ~ '^(1P)?[A-Z][A-Z0-9]{4}[A-Z]{1,2}/[A-Z]$' then substr(regexp_replace(u,'^1P',''),1,5) end
  from (select upper(regexp_replace(coalesce(p,''),'\s','','g')) u) x
$$;

-- «APPLE IPHONE SE (2ND GEN)» → «iPhone SE (2nd Gen)»
create or replace function tac_pretty(p_brand text, p_model text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    initcap(case when upper(p_model) like upper(p_brand)||' %' then substr(p_model, length(p_brand)+2) else p_model end),
    '\mIphone','iPhone','g'),'\mIpad','iPad','g'),'\mSe\M','SE','g'),'\mFe\M','FE','g'),'\mXr\M','XR','g'),'\mXs\M','XS','g'),'(\d)E\M','\1e','g'),'\mAirpods','AirPods','g'))
$$;

create or replace function model_key(p text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(p,'')),'^apple\s+',''),'[^a-z0-9]','','g')
$$;

-- модель справочника TAC → модель каталога CRM
create or replace function tac_catalog_model(p_model text, p_model_no text) returns uuid language sql stable security definer set search_path=public as $$
  select id from apple_models m
  where m.is_active and model_key(m.name) = case
      when upper(coalesce(p_model_no,'')) ~ 'A(2275|2296|2298)' or p_model ilike '%SE (2nd%' or p_model ilike '%SE(2nd%' then model_key('iPhone SE (2-го поколения)')
      when upper(coalesce(p_model_no,'')) ~ 'A(2595|2782|2783|2784|2785)' or p_model ilike '%SE (3rd%' then model_key('iPhone SE (3-го поколения)')
      else model_key(p_model) end
  order by m.sort desc limit 1
$$;

/* ---------- загрузка справочника TAC (владелец) ---------- */
create or replace function tac_import_start(p_url text default 'https://raw.githubusercontent.com/MoazEb/tac-database/main/tac_full.csv')
returns bigint language plpgsql security definer set search_path=public, extensions as $$
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  return net.http_get(url := p_url, timeout_milliseconds := 120000);
end $$;

create or replace function tac_load_csv(p_csv text) returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  create temp table _tac on commit drop as
  select m[1] brand, m[2] tac, trim(both '"' from m[3]) specs
  from regexp_split_to_table(p_csv, E'\r?\n') l, regexp_match(l, '^([^,]+),([0-9]{6,8}),(.+)$') m
  where l !~ '^Brand,';
  insert into tac_db(tac,brand,model,model_no,year)
  select distinct on (t) t, b, tac_pretty(b, mdl), case when mno ~ '^[A-Za-z0-9][A-Za-z0-9/-]{2,}$' then upper(mno) end, yr from (
    select lpad(tac,8,'0') t, brand brand_raw,
      case when length(brand)<=3 then upper(brand) else initcap(brand) end b,
      split_part(specs, ', ', 1) mdl,
      coalesce((regexp_match(specs, '\m(A\d{4})\M'))[1], case when split_part(specs,', ',3) !~ '^\d{4}$' then split_part(split_part(specs,', ',3),' - ',1) end) mno,
      (regexp_match(specs, ',\s*((?:19|20)\d{2})(?:,|$)'))[1]::int yr
    from _tac) x
  where mdl <> '' and upper(trim(mdl)) <> upper(trim(brand_raw))
  order by t
  on conflict (tac) do update set brand=excluded.brand, model=excluded.model, model_no=excluded.model_no, year=excluded.year;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function tac_import_finish(p_request bigint) returns jsonb language plpgsql security definer set search_path=public, extensions as $$
declare r record; n int;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select status_code, content, error_msg into r from net._http_response where id = p_request;
  if not found then return jsonb_build_object('status','wait'); end if;
  if r.status_code is distinct from 200 then return jsonb_build_object('status','error','code',r.status_code,'error',r.error_msg); end if;
  n := tac_load_csv(r.content);
  return jsonb_build_object('status','ok','rows',n,'total',(select count(*) from tac_db));
end $$;
revoke execute on function tac_load_csv(text) from public, anon, authenticated;

/* ---------- обучение на своих приёмках ---------- */
create or replace function device_hint_add(p_key text, p_product uuid) returns void language plpgsql security definer set search_path=public as $$
declare p record; s jsonb; k text; v text;
begin
  if p_key is null then return; end if;
  select catalog_id, name, brand, memory, color, attrs into p from products where id = p_product;
  if not found then return; end if;
  insert into device_hints(key) values (p_key) on conflict do nothing;
  select stats into s from device_hints where key = p_key for update;
  if p.catalog_id is not null then s := jsonb_set(jsonb_set(s,'{model}',coalesce(s->'model','{}')), array['model', p.catalog_id::text], to_jsonb(coalesce((s#>>array['model',p.catalog_id::text])::int,0)+1)); end if;
  if p.memory is not null then s := jsonb_set(jsonb_set(s,'{memory}',coalesce(s->'memory','{}')), array['memory',p.memory], to_jsonb(coalesce((s#>>array['memory',p.memory])::int,0)+1)); end if;
  if p.color is not null then s := jsonb_set(jsonb_set(s,'{color}',coalesce(s->'color','{}')), array['color',p.color], to_jsonb(coalesce((s#>>array['color',p.color])::int,0)+1)); end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p.attrs,'{}')) where jsonb_typeof(value)='string' and value #>> '{}' <> '' loop
    s := jsonb_set(jsonb_set(jsonb_set(s,'{opts}',coalesce(s->'opts','{}')), array['opts',k], coalesce(s#>array['opts',k],'{}')), array['opts',k,v], to_jsonb(coalesce((s#>>array['opts',k,v])::int,0)+1));
  end loop;
  update device_hints set stats = s, hits = hits + 1, name = p.name, brand = coalesce(p.brand, brand),
    model_id = coalesce((select key::uuid from jsonb_each_text(s->'model') order by value::int desc limit 1), model_id), updated_at = now()
  where key = p_key;
end $$;
revoke execute on function device_hint_add(text, uuid) from public, anon, authenticated;

create or replace function units_learn() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' or new.imei is distinct from old.imei or new.part_no is distinct from old.part_no or new.product_id is distinct from old.product_id then
    if new.imei ~ '^\d{15}$' then perform device_hint_add('tac:'||left(new.imei,8), new.product_id); end if;
    if new.imei2 ~ '^\d{15}$' and left(new.imei2,8) <> left(coalesce(new.imei,''),8) then perform device_hint_add('tac:'||left(new.imei2,8), new.product_id); end if;
    if apple_part_base(new.part_no) is not null then perform device_hint_add('part:'||apple_part_base(new.part_no), new.product_id); end if;
  end if;
  return new;
end $$;
drop trigger if exists units_learn on units;
create trigger units_learn after insert or update of imei, imei2, part_no, product_id on units for each row execute function units_learn();

/* ---------- что за устройство ---------- */
create or replace function device_lookup(p_code text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_c text := upper(regexp_replace(coalesce(p_code,''),'\s','','g')); v_kind text; v_tac text; v_part text; t tac_db%rowtype; h device_hints%rowtype;
  res jsonb; u record; v_mid uuid; m record; best jsonb := '{}'; one jsonb; f text;
begin
  if not is_staff() then raise exception 'Нет доступа'; end if;
  if v_c ~ '^\d{14,15}$' then v_kind := 'imei'; v_tac := left(v_c,8);
  elsif apple_part_base(v_c) is not null then v_kind := 'part'; v_part := apple_part_base(v_c);
  elsif v_c ~ '^S[A-Z0-9]{10}$' or v_c ~ '^S[A-Z0-9]{12}$' then v_kind := 'serial'; v_c := substr(v_c,2);
  elsif v_c ~ '^[A-Z0-9]{8,14}$' and v_c ~ '[A-Z]' and v_c ~ '\d' then v_kind := 'serial';
  else v_kind := 'unknown'; end if;
  res := jsonb_build_object('kind',v_kind,'code',case when v_kind='part' then regexp_replace(v_c,'^1P','') else v_c end);
  if v_kind = 'imei' then res := res || jsonb_build_object('tac',v_tac,'valid',case when length(v_c)=15 then imei_luhn_ok(v_c) end); end if;

  if v_tac is not null then
    select * into t from tac_db d where d.tac = v_tac;
    if found then res := res || jsonb_build_object('ref', jsonb_build_object('brand',t.brand,'model',t.model,'model_no',t.model_no,'year',t.year));
      if t.brand ilike 'apple' then v_mid := tac_catalog_model(t.model, t.model_no); end if; end if;
    select * into h from device_hints d where d.key = 'tac:'||v_tac;
  elsif v_part is not null then
    select * into h from device_hints d where d.key = 'part:'||v_part;
  end if;

  if h.key is not null then
    -- вероятное значение берём, только если оно встречалось не реже чем в 80% приёмок
    foreach f in array array['memory','color'] loop
      one := null;
      select jsonb_build_object('value',key,'n',value::int,'of',tot) into one
      from (select key, value, sum(value::int) over () tot from jsonb_each_text(coalesce(h.stats->f,'{}'))) x
      where value::int >= 0.8*tot order by value::int desc limit 1;
      if one is not null then best := best || jsonb_build_object(f, one); end if;
    end loop;
    res := res || jsonb_build_object('learned', jsonb_build_object('model_id',h.model_id,'name',h.name,'brand',h.brand,'hits',h.hits,'stats',h.stats,'best',best));
    v_mid := coalesce(h.model_id, v_mid);
  end if;
  if v_mid is not null then select id, family, name into m from apple_models where id = v_mid;
    if found then res := res || jsonb_build_object('model', jsonb_build_object('id',m.id,'family',m.family,'name',m.name)); end if; end if;

  if v_kind in ('imei','serial') then
    select un.id, un.status, un.product_id, p.name into u
    from units un join products p on p.id = un.product_id
    where un.imei = v_c or un.imei2 = v_c or upper(un.serial_no) = v_c limit 1;
    if found then res := res || jsonb_build_object('unit', jsonb_build_object('id',u.id,'status',u.status,'product_id',u.product_id,'name',u.name)); end if;
  end if;
  return res;
end $$;
create or replace function tac_stats() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('tac',(select count(*) from tac_db),'apple',(select count(*) from tac_db where brand='Apple'),
    'learned',(select count(*) from device_hints),'parts',(select count(*) from device_hints where key like 'part:%')) where is_staff()
$$;
grant execute on function device_lookup(text), tac_stats() to authenticated;
grant execute on function tac_import_start(text), tac_import_finish(bigint) to authenticated;

select refresh_col_grants();
