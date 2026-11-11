-- =====================================================================
-- iCase · ремонт, часть 2
--  * фото устройства (Storage, приватная корзина repair-photos) и чек-лист осмотра при приёме/выдаче;
--  * модель каталога у ремонта и прайс работ по моделям (цена + запчасть для работы);
--  * заявки на запчасти: «ждёт запчасть» → приход на склад → заявка «пришла», ремонт снова «в работе», задача мастеру;
--  * согласование цены клиентом по ссылке (токен), через сайт (site-api, ключ сайта).
-- =====================================================================

alter table repairs add column if not exists checklist jsonb not null default '{}'::jsonb,   -- {"intake":{"Экран":"ok"|"bad"|"na"}, "issue":{…}, "note":"…"}
  add column if not exists model_id uuid references apple_models(id) on delete set null,
  add column if not exists approve_token uuid not null default gen_random_uuid(),
  add column if not exists client_decision jsonb;                                         -- {"decision":"yes"|"no","at":…,"sum":…,"comment":…}
create index if not exists repairs_model_id_fk on repairs(model_id);

/* ---------- фото ---------- */
create table if not exists repair_photos (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references repairs(id) on delete cascade,
  path text not null,
  kind text not null default 'intake' check (kind in ('intake','work','issue')),
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists repair_photos_repair_id_fk on repair_photos(repair_id);
alter table repair_photos enable row level security;
drop policy if exists staff_read on repair_photos;
create policy staff_read on repair_photos for select using ((select is_staff()));
drop policy if exists rp_ins on repair_photos;
create policy rp_ins on repair_photos for insert with check ((select has_role('owner','manager','seller','master')) and created_by = (select auth.uid()));
drop policy if exists rp_del on repair_photos;
create policy rp_del on repair_photos for delete using ((select has_role('owner','manager')) or (created_by = (select auth.uid()) and created_at > now() - interval '1 day'));

do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('repair-photos', 'repair-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
      on conflict (id) do nothing;
    execute 'drop policy if exists repair_photos_read on storage.objects';
    execute 'create policy repair_photos_read on storage.objects for select to authenticated using (bucket_id = ''repair-photos'' and (select public.is_staff()))';
    execute 'drop policy if exists repair_photos_write on storage.objects';
    execute 'create policy repair_photos_write on storage.objects for insert to authenticated with check (bucket_id = ''repair-photos'' and (select public.has_role(''owner'',''manager'',''seller'',''master'')))';
    execute 'drop policy if exists repair_photos_del on storage.objects';
    execute 'create policy repair_photos_del on storage.objects for delete to authenticated using (bucket_id = ''repair-photos'' and (select public.has_role(''owner'',''manager'')))';
  end if;
end $$;

/* ---------- чек-лист, модель ---------- */
create or replace function repair_set(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r repairs;
begin
  if not has_role('owner','manager','seller','master') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_id for update;
  if r.id is null then raise exception 'Ремонт не найден'; end if;
  if r.status in ('done','cancel') and not has_role('owner','manager') and not (p ? 'checklist' and r.status = 'done' and r.closed_at > now() - interval '1 hour') then
    raise exception 'Ремонт закрыт'; end if;
  update repairs set
    checklist = case when p ? 'checklist' then checklist || (p->'checklist') else checklist end,
    model_id = case when p ? 'model_id' then nullif(p->>'model_id','')::uuid else model_id end
  where id = p_id;
end $$;

/* ---------- прайс работ по моделям ---------- */
create table if not exists service_prices (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  model_id uuid not null references apple_models(id) on delete cascade,
  price numeric(12,2) not null default 0,
  part_product_id uuid references products(id) on delete set null,   -- запчасть, которая уходит на эту работу
  unique (service_id, model_id)
);
create index if not exists service_prices_model_idx on service_prices(model_id);
create index if not exists service_prices_part_idx on service_prices(part_product_id);
alter table service_prices enable row level security;
drop policy if exists staff_read on service_prices;
create policy staff_read on service_prices for select using ((select is_staff()));
drop policy if exists sp_ins on service_prices;
create policy sp_ins on service_prices for insert with check ((select has_role('owner','manager')));
drop policy if exists sp_upd on service_prices;
create policy sp_upd on service_prices for update using ((select has_role('owner','manager'))) with check ((select has_role('owner','manager')));
drop policy if exists sp_del on service_prices;
create policy sp_del on service_prices for delete using ((select has_role('owner','manager')));

/* ---------- заявки на запчасти ---------- */
create table if not exists repair_part_requests (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references repairs(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  qty int not null default 1 check (qty > 0),
  status text not null default 'ordered' check (status in ('ordered','arrived','cancelled')),
  note text,
  created_by uuid references staff(id) default auth.uid(), created_at timestamptz not null default now(), arrived_at timestamptz
);
create index if not exists rpr_repair_id_fk on repair_part_requests(repair_id);
create index if not exists rpr_open_idx on repair_part_requests(product_id, created_at) where status = 'ordered';
alter table repair_part_requests enable row level security;
drop policy if exists staff_read on repair_part_requests;
create policy staff_read on repair_part_requests for select using ((select is_staff()));

create or replace function repair_part_request(p_repair uuid, p_product uuid, p_name text, p_qty int default 1, p_note text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare r repairs; v uuid; nm text;
begin
  if not has_role('owner','manager','master','seller') then raise exception 'Нет права'; end if;
  select * into r from repairs where id = p_repair for update;
  if r.id is null or r.status in ('done','cancel') then raise exception 'Ремонт закрыт'; end if;
  nm := coalesce(nullif(trim(p_name),''), (select name from products where id = p_product));
  if nm is null then raise exception 'Укажите запчасть'; end if;
  insert into repair_part_requests(repair_id, product_id, name, qty, note) values (p_repair, p_product, nm, greatest(1, coalesce(p_qty,1)), nullif(trim(p_note),'')) returning id into v;
  if r.status <> 'parts' then update repairs set status = 'parts' where id = p_repair; end if;
  insert into repair_history(repair_id, status, note) values (p_repair, 'parts', 'Заказана запчасть: ' || nm);
  return v;
end $$;

create or replace function repair_part_request_set(p_id uuid, p_status text) returns void language plpgsql security definer set search_path=public as $$
declare q repair_part_requests;
begin
  if not has_role('owner','manager','master','seller','storekeeper') then raise exception 'Нет права'; end if;
  if p_status not in ('arrived','cancelled','ordered') then raise exception 'Неверный статус'; end if;
  select * into q from repair_part_requests where id = p_id for update;
  if q.id is null then raise exception 'Заявка не найдена'; end if;
  update repair_part_requests set status = p_status, arrived_at = case when p_status = 'arrived' then now() else arrived_at end where id = p_id;
  perform repair_parts_check(q.repair_id);
end $$;

-- все заявки ремонта закрыты → ремонт из «ждёт запчасть» снова «в работе», мастеру задача
create or replace function repair_parts_check(p_repair uuid) returns void language plpgsql security definer set search_path=public as $$
declare r repairs;
begin
  select * into r from repairs where id = p_repair for update;
  if r.status <> 'parts' then return; end if;
  if exists (select 1 from repair_part_requests where repair_id = p_repair and status = 'ordered') then return; end if;
  if not exists (select 1 from repair_part_requests where repair_id = p_repair and status = 'arrived') then return; end if;
  update repairs set status = 'work' where id = p_repair;
  insert into repair_history(repair_id, status, note) values (p_repair, 'work', 'Запчасти пришли — можно продолжать ремонт');
  insert into tasks(auto_key, title, due_date, note, customer_id, ref_type, ref_id, point_id, assignee)
  values ('rep-parts-' || r.num || '-' || to_char(now(),'YYYYMMDDHH24MI'), 'Пришли запчасти для ремонта ' || r.num || ' (' || r.device || ')', current_date,
          (select string_agg(name, ', ') from repair_part_requests where repair_id = p_repair and status = 'arrived'), r.customer_id, 'repair', r.id::text, r.point_id, r.master_id)
  on conflict (auto_key) do nothing;
end $$;
revoke execute on function repair_parts_check(uuid) from public, anon, authenticated;

-- приход товара на склад закрывает самые ранние заявки на эту запчасть
create or replace function movements_repair_parts() returns trigger language plpgsql security definer set search_path=public as $$
declare q record; n int := new.qty; reps uuid[] := '{}';
begin
  if new.qty > 0 and new.type in ('in','transfer_in','return') then
    for q in select id, repair_id, qty from repair_part_requests where product_id = new.product_id and status = 'ordered' order by created_at for update loop
      exit when n < q.qty;
      update repair_part_requests set status = 'arrived', arrived_at = now() where id = q.id;
      n := n - q.qty; reps := reps || q.repair_id;
    end loop;
    if array_length(reps,1) > 0 then perform repair_parts_check(x) from unnest(reps) x; end if;
  end if;
  return null;
end $$;
drop trigger if exists movements_repair_parts on stock_movements;
create trigger movements_repair_parts after insert on stock_movements for each row execute function movements_repair_parts();
revoke execute on function movements_repair_parts() from public, anon, authenticated;

/* ---------- согласование клиентом по ссылке (через сайт, ключ сайта) ---------- */
create or replace function repair_quote(p_num text, p_token text) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('num', r.num, 'device', r.device, 'status', r.status, 'problem', r.problem, 'diagnosis', r.diagnosis,
    'works', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'qty', s.qty, 'price', s.price) order by s.id) from repair_services s where s.repair_id = r.id), '[]'::jsonb),
    'parts', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty, 'price', p.price) order by p.id) from repair_parts p where p.repair_id = r.id and not p.returned), '[]'::jsonb),
    'total', coalesce(nullif(coalesce((select sum(price*qty) from repair_services where repair_id = r.id),0) + coalesce((select sum(price*qty) from repair_parts where repair_id = r.id and not returned),0), 0), r.approved_sum, r.estimate),
    'paid', repair_paid(r.id), 'due_date', r.due_date, 'decision', r.client_decision,
    'can_decide', r.status in ('new','diag','approve'),
    'shop', (select jsonb_build_object('name', shop_name, 'phone', phone, 'address', address) from settings where id = 1))
  from repairs r where upper(r.num) = upper(trim(p_num)) and r.approve_token::text = trim(p_token)
$$;

create or replace function repair_client_decide(p_num text, p_token text, p_decision text, p_comment text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r repairs; q jsonb;
begin
  if p_decision not in ('yes','no') then raise exception 'Неверное решение'; end if;
  select * into r from repairs where upper(num) = upper(trim(p_num)) and approve_token::text = trim(p_token) for update;
  if r.id is null then raise exception 'Ремонт не найден'; end if;
  if r.status not in ('new','diag','approve') then raise exception 'Решение уже не требуется'; end if;
  q := repair_quote(r.num, r.approve_token::text);
  update repairs set client_decision = jsonb_build_object('decision', p_decision, 'at', now(), 'sum', q->'total', 'comment', nullif(trim(coalesce(p_comment,'')),'')),
    approved = (p_decision = 'yes'), approved_sum = case when p_decision = 'yes' then (q->>'total')::numeric else approved_sum end,
    status = case when p_decision = 'yes' then 'work'::repair_status else status end
  where id = r.id;
  insert into repair_history(repair_id, status, note) values (r.id, case when p_decision = 'yes' then 'work'::repair_status else r.status end,
    case when p_decision = 'yes' then 'Клиент согласовал ремонт по ссылке: ' else 'Клиент отказался по ссылке: ' end || coalesce(q->>'total','0') || ' ₽' || coalesce(' · «' || nullif(trim(p_comment),'') || '»',''));
  insert into tasks(auto_key, title, due_date, note, customer_id, ref_type, ref_id, point_id, assignee)
  values ('rep-decide-' || r.num || '-' || to_char(now(),'YYYYMMDDHH24MISS'),
          case when p_decision = 'yes' then 'Клиент согласовал ремонт ' || r.num || ' — можно делать' else 'Клиент отказался от ремонта ' || r.num || ' — оформить отказ' end,
          current_date, nullif(trim(coalesce(p_comment,'')),''), r.customer_id, 'repair', r.id::text, r.point_id, r.master_id)
  on conflict (auto_key) do nothing;
  return repair_quote(r.num, r.approve_token::text);
end $$;
revoke execute on function repair_quote(text,text), repair_client_decide(text,text,text,text) from public, anon, authenticated;
grant execute on function repair_quote(text,text), repair_client_decide(text,text,text,text) to service_role;

revoke execute on function repair_set(uuid,jsonb), repair_part_request(uuid,uuid,text,int,text), repair_part_request_set(uuid,text) from public, anon;
grant execute on function repair_set(uuid,jsonb), repair_part_request(uuid,uuid,text,int,text), repair_part_request_set(uuid,text) to authenticated;
select refresh_col_grants();
