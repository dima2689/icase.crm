-- iCase CRM v3 · аудит безопасности и целостности (11.11.2026)
-- 1) функции не вызываются без входа; 2) продажа проверяет количество, цену, скидки и способы оплаты;
-- 3) «в долг» и «предоплатой» — только через свои функции; 4) продавец не меняет цену, только скидку;
-- 5) защита от перебора номеров заказов/ремонтов на сайте.

/* ---------- 1. анонимам — никаких функций ---------- */
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
-- права authenticated не трогаем: служебные функции им закрыты отдельно

/* ---------- 2–4. проверки в create_sale ---------- */
do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.create_sale(uuid,uuid,jsonb,jsonb,numeric,text,numeric,text,sale_channel)'::regprocedure);
  if position('icase.sale_trusted' in src) > 0 then return; end if;
  -- общие проверки сразу после проверки прав
  src := replace(src,
$a$  if p_channel = 'store' and not can_work_at(v_point) then raise exception 'Вы не можете продавать с этой точки'; end if;$a$,
$b$  if p_channel = 'store' and not can_work_at(v_point) then raise exception 'Вы не можете продавать с этой точки'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'В чеке нет товаров'; end if;
  if coalesce(p_discount,0) < 0 or coalesce(p_tradein_amount,0) < 0 then raise exception 'Скидка и зачёт trade-in не могут быть отрицательными'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) x where coalesce((x->>'amount')::numeric,0) < 0) then raise exception 'Сумма оплаты не может быть отрицательной'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) x where x->>'method' = 'debt') and coalesce(current_setting('icase.sale_debt', true),'') <> '1' then
    raise exception 'Продажа в долг оформляется через «В долг» с телефоном покупателя'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) x where x->>'method' = 'prepaid') and coalesce(current_setting('icase.sale_trusted', true),'') <> '1' then
    raise exception 'Оплата «предоплатой» возможна только при выдаче предзаказа'; end if;$b$);
  -- количество, цена, скидка у каждой позиции каталога; продавец не меняет цену
  src := replace(src,
$a$    select * into p from products where id = (it->>'product_id')::uuid;
    v_cost := p.cost;$a$,
$b$    select * into p from products where id = (it->>'product_id')::uuid;
    if p.id is null then raise exception 'Товар не найден'; end if;
    if coalesce((it->>'qty')::numeric,0) < 1 or (it->>'qty')::numeric <> trunc((it->>'qty')::numeric) then raise exception 'Проверьте количество «%»', p.name; end if;
    if coalesce((it->>'price')::numeric,-1) < 0 or coalesce((it->>'discount')::numeric,0) < 0
       or coalesce((it->>'discount')::numeric,0) > (it->>'qty')::numeric * (it->>'price')::numeric then raise exception 'Проверьте цену и скидку «%»', p.name; end if;
    if not has_role('owner','manager','storekeeper') and coalesce(current_setting('icase.sale_trusted', true),'') <> '1'
       and abs((it->>'price')::numeric - coalesce((select nullif(un.price,0) from units un where un.id = nullif(it->>'unit_id','')::uuid), p.price)) >= 0.01 then
      raise exception 'Цену «%» меняет только управляющий — дайте скидку', p.name; end if;
    v_cost := p.cost;$b$);
  -- произвольная позиция: скидка в пределах суммы
  src := replace(src,
$a$      if coalesce((it->>'qty')::int,0) < 1 or coalesce((it->>'price')::numeric,-1) < 0 then raise exception 'Проверьте количество и цену «%»', it->>'name'; end if;$a$,
$b$      if coalesce((it->>'qty')::numeric,0) < 1 or (it->>'qty')::numeric <> trunc((it->>'qty')::numeric) or coalesce((it->>'price')::numeric,-1) < 0
         or coalesce((it->>'discount')::numeric,0) < 0 or coalesce((it->>'discount')::numeric,0) > (it->>'qty')::numeric * (it->>'price')::numeric then
        raise exception 'Проверьте количество, цену и скидку «%»', it->>'name'; end if;$b$);
  -- скидка на чек и trade-in не больше суммы
  src := replace(src,
$a$  v_total := greatest(0, v_sub - p_discount - p_tradein_amount);$a$,
$b$  if coalesce(p_discount,0) > v_sub + 0.5 then raise exception 'Скидка больше суммы чека'; end if;
  v_total := greatest(0, v_sub - p_discount - p_tradein_amount);$b$);
  if position('icase.sale_trusted' in src) = 0 or position('Проверьте количество «%»' in src) = 0 or position('Скидка больше суммы чека' in src) = 0 then
    raise exception 'create_sale: не удалось применить проверки — текст функции изменился'; end if;
  execute src;
end $mig$;

/* ---------- флаги для доверенных вызовов create_sale ---------- */
do $mig$
declare f text; src text; pat text; rep text;
begin
  foreach f in array array['create_sale_debt','preorder_sell','site_order_complete','evotor_create_sale'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace;
    if src is null or position('icase.sale_' in replace(src,'icase.preorder_sell','')) > 0 then continue; end if;
    -- перед вызовом create_sale ставим флаг, после — снимаем
    pat := case f when 'create_sale_debt' then '  v_sale := create_sale(' when 'site_order_complete' then '  v_sale := create_sale(' else '  v := create_sale(' end;
    rep := case f when 'create_sale_debt' then '  perform set_config(''icase.sale_debt'',''1'',true);' || chr(10) || pat
                   else '  perform set_config(''icase.sale_trusted'',''1'',true);' || chr(10) || pat end;
    if position(pat in src) = 0 then raise exception '%: не найден вызов create_sale', f; end if;
    src := replace(src, pat, rep);
    execute src;
  end loop;
end $mig$;
-- флаги транзакционные (set_config(..., true)): после функции они действуют до конца транзакции одного запроса — снимаем вручную в обёртках не требуется,
-- но чтобы последующие вызовы в той же транзакции не унаследовали доверие, create_sale сбрасывает их сам
do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.create_sale(uuid,uuid,jsonb,jsonb,numeric,text,numeric,text,sale_channel)'::regprocedure);
  if position('сброс флагов доверия' in src) > 0 then return; end if;
  src := replace(src,
$a$  insert into sales(point_id,warehouse_id,shift_id,customer_id,channel,subtotal,discount,tradein_device,tradein_imei,tradein_amount,total)$a$,
$b$  perform set_config('icase.sale_trusted','',true); perform set_config('icase.sale_debt','',true); -- сброс флагов доверия
  insert into sales(point_id,warehouse_id,shift_id,customer_id,channel,subtotal,discount,tradein_device,tradein_imei,tradein_amount,total)$b$);
  if position('сброс флагов доверия' in src) = 0 then raise exception 'create_sale: не найдено место сброса флагов'; end if;
  execute src;
end $mig$;

/* ---------- 5. защита от перебора номеров на сайте ---------- */
create table if not exists api_throttle (k text not null, at timestamptz not null default now());
create index if not exists api_throttle_k_at on api_throttle (k, at);
alter table api_throttle enable row level security;   -- политик нет: читает и пишет только service_role
create or replace function api_throttle_hit(p_key text, p_limit int default 20, p_window_s int default 3600) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from api_throttle where at < now() - interval '1 day';
  select count(*) into n from api_throttle where k = p_key and at > now() - make_interval(secs => p_window_s);
  if n >= p_limit then return false; end if;
  insert into api_throttle(k) values (p_key);
  return true;
end $$;
revoke execute on function api_throttle_hit(text,int,int) from public, anon, authenticated;
grant execute on function api_throttle_hit(text,int,int) to service_role;

/* ---------- 6. деньги в возвратах и ремонте ---------- */
create or replace function repair_total(p_id uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(nullif(coalesce((select sum(price*qty) from repair_services where repair_id = r.id),0)
    + coalesce((select sum(price*qty) from repair_parts where repair_id = r.id and not returned),0), 0), r.approved_sum, r.estimate, 0)
  from repairs r where r.id = p_id
$$;
revoke execute on function repair_total(uuid) from public, anon;

do $mig$
declare src text;
begin
  -- возврат: сумма не больше стоимости возвращаемых товаров и остатка по чеку, только своя точка
  src := pg_get_functiondef('public.create_return(uuid,jsonb,numeric,pay_method,text,uuid,boolean,text)'::regprocedure);
  if position('Сумма возврата больше' in src) = 0 then
    src := replace(src, 'left_total int;', 'left_total int; v_max numeric;');
    src := replace(src,
$a$  select * into s from sales where id = p_sale for update;$a$,
$b$  select * into s from sales where id = p_sale for update;
  if s.id is null then raise exception 'Продажа не найдена'; end if;
  if not has_role('owner','manager') and not can_work_at(coalesce(s.point_id,(select point_id from warehouses where id = s.warehouse_id))) then
    raise exception 'Возврат оформляют на точке, где была продажа'; end if;
  if coalesce(p_amount,-1) < 0 then raise exception 'Сумма возврата не может быть отрицательной'; end if;
  if p_method in ('debt','prepaid') then raise exception 'Верните деньги наличными, картой, QR или переводом'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Выберите товары для возврата'; end if;
  select coalesce(sum(((jj->>'qty')::numeric * x.price - coalesce(x.line_discount,0) * (jj->>'qty')::numeric / nullif(x.qty,0))
      * case when s.subtotal > 0 then (s.total + coalesce(s.tradein_amount,0)) / s.subtotal else 1 end), 0) into v_max
    from jsonb_array_elements(p_items) jj join sale_items x on x.id = (jj->>'sale_item_id')::bigint and x.sale_id = p_sale;
  if p_amount > v_max + 0.5 then raise exception 'Сумма возврата больше стоимости возвращаемых товаров (% ₽)', round(v_max); end if;
  if p_amount > s.total + coalesce(s.tradein_amount,0) - coalesce((select sum(amount) from returns where sale_id = p_sale),0) + 0.5 then
    raise exception 'Сумма возврата больше, чем осталось по чеку'; end if;$b$);
    if position('Сумма возврата больше' in src) = 0 then raise exception 'create_return: не применилось'; end if;
    execute src;
  end if;

  -- отказ от ремонта: плата за диагностику не отрицательная
  src := pg_get_functiondef('public.repair_cancel(uuid,text,numeric,pay_method)'::regprocedure);
  if position('Плата за диагностику не может' in src) = 0 then
    src := replace(src,
$a$  paid := repair_paid(p_id); back := round(paid - coalesce(p_fee,0), 2);$a$,
$b$  if coalesce(p_fee,0) < 0 then raise exception 'Плата за диагностику не может быть отрицательной'; end if;
  if p_method in ('debt','prepaid') then raise exception 'Выберите способ: наличные, карта, QR или перевод'; end if;
  paid := repair_paid(p_id); back := round(paid - coalesce(p_fee,0), 2);$b$);
    if position('Плата за диагностику не может' in src) = 0 then raise exception 'repair_cancel: не применилось'; end if;
    execute src;
  end if;

  -- выдача ремонта: оплаты одного знака, без «долга/предоплаты»; скидку на итог даёт только управляющий
  src := pg_get_functiondef('public.repair_issue(uuid,numeric,jsonb)'::regprocedure);
  if position('Скидку на ремонт даёт' in src) = 0 then
    src := replace(src,
$a$  if coalesce(p_final,0) < 0 then raise exception 'Неверная сумма'; end if;$a$,
$b$  if coalesce(p_final,0) < 0 then raise exception 'Неверная сумма'; end if;
  if not has_role('owner','manager') and r.warranty_of is null and p_final < repair_total(p_id) - 0.5 then
    raise exception 'Скидку на ремонт даёт управляющий: итог не может быть меньше % ₽', round(repair_total(p_id)); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) e where e->>'method' in ('debt','prepaid')) then
    raise exception 'Выберите способ: наличные, карта, QR или перевод'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) e where (e->>'amount')::numeric > 0)
     and exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) e where (e->>'amount')::numeric < 0) then
    raise exception 'В одной выдаче нельзя и принимать, и возвращать деньги'; end if;$b$);
    if position('Скидку на ремонт даёт' in src) = 0 then raise exception 'repair_issue: не применилось'; end if;
    execute src;
  end if;
end $mig$;

/* ---------- 7. прямые записи в таблицы ---------- */
-- касса: продавец только вносит наличные в открытую смену своей точки; изъятие — управляющий; прочие операции — только через функции
drop policy if exists w_cash_in on cash_ops;
create policy w_cash_in on cash_ops for insert with check (
  (select is_staff()) and method = 'cash'
  and exists (select 1 from shifts s where s.id = shift_id and s.status = 'open' and can_work_at(s.point_id))
  and ((type = 'cashin' and amount > 0) or (type = 'cashout' and amount < 0 and (select has_role('owner','manager')))));
-- ремонт: менять и удалять карточку напрямую — только управляющий; остальные — через функции (статус, выдача, отказ)
drop policy if exists w_rep_upd on repairs;
create policy w_rep_upd on repairs for update using ((select has_role('owner','manager'))) with check ((select has_role('owner','manager')));
drop policy if exists w_rep_del on repairs;
create policy w_rep_del on repairs for delete using ((select has_role('owner')));
-- работы в закрытом ремонте меняет только управляющий
drop policy if exists w_rep_s_ins on repair_services;
create policy w_rep_s_ins on repair_services for insert with check ((select has_role('owner','manager'))
  or ((select has_role('seller','master')) and exists (select 1 from repairs r where r.id = repair_id and r.status not in ('done','cancel'))));
drop policy if exists w_rep_s_upd on repair_services;
create policy w_rep_s_upd on repair_services for update using ((select has_role('owner','manager'))
  or ((select has_role('seller','master')) and exists (select 1 from repairs r where r.id = repair_id and r.status not in ('done','cancel'))));
drop policy if exists w_rep_s_del on repair_services;
create policy w_rep_s_del on repair_services for delete using ((select has_role('owner','manager'))
  or ((select has_role('seller','master')) and exists (select 1 from repairs r where r.id = repair_id and r.status not in ('done','cancel'))));
-- клиентов удаляет только управляющий (у клиента история продаж и ремонтов)
drop policy if exists w_cust_del on customers;
create policy w_cust_del on customers for delete using ((select has_role('owner','manager')));

/* ---------- 8. в доверенных вызовах клиент не может сам указать «предоплату» или «долг» ---------- */
do $mig$
declare f text; src text; pat text;
begin
  foreach f in array array['preorder_sell','site_order_complete'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace;
    if src is null or position('Способ оплаты: наличные' in src) > 0 then continue; end if;
    pat := case f when 'preorder_sell' then $a$  if not has_role('owner','manager','seller') then raise exception 'Нет права продавать'; end if;$a$ else null end;
    if f = 'site_order_complete' then pat := substring(src from '(\n  if not has_role\([^\n]*\n)'); pat := ltrim(pat, E'\n'); pat := rtrim(pat, E'\n'); end if;
    if pat is null or position(pat in src) = 0 then raise exception '%: не найдено место для проверки', f; end if;
    src := replace(src, pat, pat || E'\n' || $b$  if exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]')) e where e->>'method' in ('debt','prepaid') or coalesce((e->>'amount')::numeric,0) < 0) then
    raise exception 'Способ оплаты: наличные, карта, QR или перевод, сумма не отрицательная'; end if;$b$);
    execute src;
  end loop;
end $mig$;
