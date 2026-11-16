-- Бот Telegram магазина (служба icase-bot на сервере) ↔ CRM.
-- Бот ходит в edge-функцию bot-api с ключом X-Bot-Key. Функция работает под service_role,
-- поэтому всё ниже закрыто от сотрудников и сайта: execute только у service_role (и у владельца — для ключа).
-- Персональные данные клиентов (имена, телефоны) бот не получает.

-- ключ бота: в vault, отдельный от ключа сайта (у бота есть закупочные цены и выручка)
create or replace function bot_api_key(p_regenerate boolean default false) returns text language plpgsql security definer set search_path = public, vault, extensions as $$
declare v uuid; k text;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not has_role('owner') then raise exception 'Только владелец'; end if;
  select id into v from vault.secrets where name = 'icase_bot_api_key';
  if v is null or p_regenerate then
    k := encode(gen_random_bytes(24),'hex');
    if v is null then perform vault.create_secret(k,'icase_bot_api_key'); else perform vault.update_secret(v,k); end if;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name='icase_bot_api_key');
end $$;

-- ключ для проверки запроса (только edge-функция)
create or replace function bot_api_secret() returns text language plpgsql stable security definer set search_path = public, vault as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name='icase_bot_api_key');
end $$;

-- поиск: IMEI / серийный / штрихкод / артикул / номер ремонта — точное совпадение; иначе товары по словам названия
create or replace function bot_lookup(p_q text, p_limit int default 8) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_q,'')); qn text; lim int := least(greatest(coalesce(p_limit,8),1),20);
        units_j jsonb; prods_j jsonb; reps_j jsonb; words text[];
begin
  if length(q) < 2 then return jsonb_build_object('units','[]'::jsonb,'products','[]'::jsonb,'repairs','[]'::jsonb); end if;
  qn := regexp_replace(q, '^[#№\s]+', '');
  -- экземпляры: полный IMEI/серийный или последние 4–6 цифр IMEI
  select coalesce(jsonb_agg(x order by x->>'status', x->>'title'),'[]') into units_j from (
    select jsonb_build_object(
      'title', p.name, 'imei', u.imei, 'imei2', u.imei2, 'serial', u.serial_no, 'status', u.status::text,
      'warehouse', w.name, 'price', coalesce(u.price, p.price), 'cost', u.cost,
      'condition', coalesce(u.condition, p.condition), 'battery', u.battery_health,
      'days', (current_date - u.created_at::date),
      'sold_at', s.created_at, 'sale_num', s.num, 'sale_price', si.price - si.line_discount,
      'warranty_until', case when s.id is not null and si.warranty_months > 0 then (s.created_at::date + make_interval(months => si.warranty_months))::date end) x
    from units u join products p on p.id = u.product_id
    left join warehouses w on w.id = u.warehouse_id
    left join sale_items si on si.id = u.sale_item_id
    left join sales s on s.id = si.sale_id
    where u.imei = qn or u.imei2 = qn or upper(u.serial_no) = upper(qn)
       or (qn ~ '^[0-9]{4,6}$' and (u.imei like '%'||qn or u.imei2 like '%'||qn) and u.status in ('in_stock','reserved','in_repair'))
    limit lim) t;
  -- ремонты: номер Р-123 / 123 или IMEI
  select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') into reps_j from (
    select jsonb_build_object('num', r.num, 'device', r.device, 'imei', r.imei, 'status', r.status::text, 'problem', r.problem,
      'estimate', r.estimate, 'final_price', r.final_price, 'due_date', r.due_date, 'ready_at', r.ready_at, 'closed_at', r.closed_at,
      'master', r.master, 'created_at', r.created_at, 'point', pt.name) x
    from repairs r left join points pt on pt.id = r.point_id
    where upper(r.num) = upper(regexp_replace(qn, '^[РрPp]-?', 'Р-')) or (qn ~ '^[0-9]{1,7}$' and r.num = 'Р-'||qn)
       or (length(qn) >= 8 and r.imei = qn)
    order by r.created_at desc limit 5) t;
  -- товары: точный код или все слова названия
  words := array(select w from unnest(regexp_split_to_array(lower(replace(q,'ё','е')), '\s+')) w where w <> '');
  select coalesce(jsonb_agg(x order by (x->>'qty')::int > 0 desc, length(x->>'title')),'[]') into prods_j from (
    select jsonb_build_object('title', p.name, 'sku', p.sku, 'price', p.price, 'cost', p.cost, 'condition', p.condition,
      'qty', coalesce((select sum(qty) from stock where product_id = p.id),0),
      'by_wh', (select coalesce(jsonb_agg(jsonb_build_object('wh', w.name, 'qty', st.qty) order by w.sort, w.name),'[]')
                from stock st join warehouses w on w.id = st.warehouse_id where st.product_id = p.id and st.qty > 0)) x
    from products p
    where not p.is_archived and (
      p.barcode = qn or p.sku = qn
      or (jsonb_array_length(units_j) = 0 and jsonb_array_length(reps_j) = 0
          and (select bool_and(lower(replace(p.name,'ё','е')) like '%'||w||'%') from unnest(words) w)))
    order by coalesce((select sum(qty) from stock where product_id = p.id),0) > 0 desc, length(p.name)
    limit lim) t;
  return jsonb_build_object('units', units_j, 'products', prods_j, 'repairs', reps_j);
end $$;

-- сводка за день (по московскому времени): продажи, оплаты, возвраты, ремонты, открытые смены
create or replace function bot_summary(p_day date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Europe/Moscow')::date);
        t0 timestamptz := (d::timestamp at time zone 'Europe/Moscow'); t1 timestamptz := ((d + 1)::timestamp at time zone 'Europe/Moscow');
begin
  return jsonb_build_object(
    'day', d,
    'sales', (select count(*) from sales where created_at >= t0 and created_at < t1),
    'revenue', (select coalesce(sum(total),0) from sales where created_at >= t0 and created_at < t1),
    'profit', (select coalesce(sum((si.price - si.line_discount) * si.qty - si.cost * si.qty),0) from sale_items si join sales s on s.id = si.sale_id
               where s.created_at >= t0 and s.created_at < t1),
    'by_method', (select coalesce(jsonb_object_agg(method, amt),'{}') from (select sp.method::text method, sum(sp.amount) amt from sale_payments sp join sales s on s.id = sp.sale_id
                  where s.created_at >= t0 and s.created_at < t1 group by sp.method) m),
    'returns', (select coalesce(sum(amount),0) from returns where created_at >= t0 and created_at < t1),
    'repairs_new', (select count(*) from repairs where created_at >= t0 and created_at < t1),
    'repairs_done', (select count(*) from repairs where status = 'done' and closed_at >= t0 and closed_at < t1),
    'repairs_ready', (select count(*) from repairs where status = 'ready'),
    'repairs_open', (select count(*) from repairs where status not in ('done','cancel')),
    'stock_qty', (select coalesce(sum(st.qty),0) from stock st join warehouses w on w.id = st.warehouse_id where coalesce(w.kind,'') <> 'Резерв'),
    'stock_retail', (select coalesce(sum(st.qty * p.price),0) from stock st join products p on p.id = st.product_id join warehouses w on w.id = st.warehouse_id where coalesce(w.kind,'') <> 'Резерв'),
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object('point', pt.name, 'opened_at', sh.opened_at, 'cash', shift_expected_cash(sh.id))),'[]')
               from shifts sh join points pt on pt.id = sh.point_id where sh.status = 'open'));
end $$;

-- события для бота (очередь integration_jobs, target telegram): смена статуса ремонта, приход предзаказа.
-- Старше суток не отправляем — отмечаем выполненными (чтобы при первом подключении бот не прислал всю историю).
create or replace function bot_events_take(p_limit int default 50) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update integration_jobs set status = 'done', done_at = now(), last_error = 'старое событие — не отправлено'
   where target = 'telegram' and status = 'pending' and created_at < now() - interval '1 day';
  return (select coalesce(jsonb_agg(x order by (x->>'id')::bigint),'[]') from (
    select jsonb_build_object('id', j.id, 'action', j.action, 'at', j.created_at,
      'repair', case when j.action = 'repair_status' then (select jsonb_build_object('num', r.num, 'device', r.device, 'status', j.payload->>'status',
                 'final_price', r.final_price, 'estimate', r.estimate, 'point', pt.name) from repairs r left join points pt on pt.id = r.point_id where r.id = (j.payload->>'repair_id')::uuid) end,
      'preorder', case when j.action = 'preorder_arrived' then (select jsonb_build_object('num', o.num, 'product', p.name, 'price', o.price)
                 from preorders o join products p on p.id = o.product_id where o.id = (j.payload->>'preorder_id')::uuid) end) x
    from integration_jobs j where j.target = 'telegram' and j.status = 'pending' order by j.id limit least(greatest(coalesce(p_limit,50),1),200)) t);
end $$;
create or replace function bot_events_done(p_ids bigint[]) returns int language sql security definer set search_path = public as $$
  with u as (update integration_jobs set status = 'done', done_at = now(), attempts = attempts + 1
             where target = 'telegram' and status = 'pending' and id = any(p_ids) returning 1) select count(*)::int from u $$;

-- заявка на оценку trade-in из бота → задача в CRM (повторная отправка той же заявки обновляет задачу)
create or replace function bot_tradein(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := 'bot-tradein:' || coalesce(nullif(p->>'id',''), '?'); t tasks; ttl text; nt text; amt numeric := nullif(p->>'amount','')::numeric;
begin
  if coalesce(p->>'model','') = '' then raise exception 'Укажите модель устройства'; end if;
  ttl := left('Trade-in: ' || btrim(concat_ws(' ', p->>'model', p->>'memory', p->>'color')) || case when amt > 0 then ' — оценка ' || replace(to_char(amt, 'FM999G999G999'), ',', ' ') || ' ₽' else '' end, 200);
  nt := concat_ws(E'\n',
    case when coalesce(p->>'imei','') <> '' then 'IMEI ' || (p->>'imei') end,
    case when coalesce(p->>'serial','') <> '' then 'S/N ' || (p->>'serial') end,
    case when coalesce(p->>'battery','') <> '' then 'АКБ ' || (p->>'battery') || '%' end,
    nullif(p->>'condition',''), nullif(p->>'note',''),
    'Из бота Telegram' || case when coalesce(p->>'creator','') <> '' then ', оценил: ' || (p->>'creator') else '' end
      || case when coalesce(p->>'status','') = 'declined' then ' · клиент отказался' else '' end);
  insert into tasks(title, note, ref_type, ref_id, auto_key, status, created_by)
  values (ttl, nt, 'tradein', p->>'id', k, case when p->>'status' = 'declined' then 'cancelled' else 'open' end, null)
  on conflict (auto_key) do update set title = excluded.title, note = excluded.note,
    status = case when tasks.status = 'done' then 'done' else excluded.status end
  returning * into t;
  return jsonb_build_object('task_id', t.id, 'status', t.status);
end $$;

revoke execute on function bot_api_secret(), bot_lookup(text,int), bot_summary(date), bot_events_take(int), bot_events_done(bigint[]), bot_tradein(jsonb)
  from public, anon, authenticated;
revoke execute on function bot_api_key(boolean) from public, anon;
grant execute on function bot_api_key(boolean) to authenticated, service_role;
grant execute on function bot_api_secret(), bot_lookup(text,int), bot_summary(date), bot_events_take(int), bot_events_done(bigint[]), bot_tradein(jsonb) to service_role;
