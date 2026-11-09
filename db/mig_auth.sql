-- v3: авторизация и управление сотрудниками
alter table staff
  add column if not exists email text,
  add column if not exists must_change_password boolean not null default false,  -- временный пароль: сменить при входе
  add column if not exists last_seen_at timestamptz,
  add column if not exists blocked_at timestamptz;
update staff s set email = u.email from auth.users u where u.id = s.id and s.email is null;

-- владелец всегда один и активен: снять или отключить его можно только передачей прав
create or replace function staff_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then raise exception 'Владельца удалить нельзя — сначала передайте права'; end if;
    return old;
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or not new.is_active) and current_setting('icase.transfer', true) is distinct from '1' then
    raise exception 'Владельца нельзя отключить или сменить ему роль — передайте права владельца другому сотруднику';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and current_setting('icase.transfer', true) is distinct from '1' then
    raise exception 'Назначить владельца можно только передачей прав';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_guard on staff;
create trigger trg_staff_guard before update or delete on staff for each row execute function staff_guard();

-- свой профиль: имя и телефон
create or replace function staff_me_update(p_name text, p_phone text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Нет доступа'; end if;
  update staff set full_name = coalesce(nullif(trim(p_name),''), full_name), phone = nullif(trim(coalesce(p_phone,'')),'') where id = auth.uid();
end $$;
-- пароль сменён (снимает требование сменить временный пароль)
create or replace function staff_password_changed() returns void language plpgsql security definer set search_path = public as $$
begin
  update staff set must_change_password = false where id = auth.uid();
  insert into audit_log(action, ref) values ('Смена пароля', (select full_name from staff where id = auth.uid()));
end $$;
-- отметка входа (для списка сотрудников)
create or replace function staff_touch() returns void language sql security definer set search_path = public as $$
  update staff set last_seen_at = now(), email = coalesce(email, (select email from auth.users where id = auth.uid())) where id = auth.uid();
$$;
-- передача прав владельца
create or replace function transfer_owner(p_to uuid) returns void language plpgsql security definer set search_path = public as $$
declare t staff;
begin
  if not has_role('owner') then raise exception 'Только владелец'; end if;
  select * into t from staff where id = p_to;
  if t.id is null or not t.is_active then raise exception 'Сотрудник не найден или отключён'; end if;
  if t.id = auth.uid() then raise exception 'Вы уже владелец'; end if;
  perform set_config('icase.transfer', '1', true);
  update staff set role = 'owner', point_id = null where id = p_to;
  update staff set role = 'manager' where id = auth.uid();
  insert into audit_log(action, ref, details) values ('Передача прав владельца', t.full_name, 'прежний владелец стал управляющим');
end $$;
-- служебное для edge-функции staff-admin: отметить блокировку/временный пароль (только service_role)
create or replace function staff_admin_mark(p_id uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  update staff set
    is_active = coalesce((p_patch->>'is_active')::boolean, is_active),
    blocked_at = case when p_patch ? 'is_active' then case when (p_patch->>'is_active')::boolean then null else now() end else blocked_at end,
    must_change_password = coalesce((p_patch->>'must_change_password')::boolean, must_change_password),
    email = coalesce(p_patch->>'email', email)
  where id = p_id;
end $$;

-- при первом входе владельца — сохранить email
create or replace function claim_owner(p_name text) returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  if exists (select 1 from staff) then raise exception 'Владелец уже назначен'; end if;
  insert into staff(id, full_name, role, email) values (auth.uid(), coalesce(nullif(p_name,''),'Владелец'), 'owner', (select email from auth.users where id = auth.uid()));
  delete from staff_requests where id = auth.uid();
  return 'owner';
end $$;

revoke execute on function staff_me_update(text,text), staff_password_changed(), staff_touch(), transfer_owner(uuid) from public, anon;
grant execute on function staff_me_update(text,text), staff_password_changed(), staff_touch(), transfer_owner(uuid) to authenticated;
revoke execute on function staff_admin_mark(uuid,jsonb), staff_guard() from public, anon, authenticated;
grant execute on function staff_admin_mark(uuid,jsonb) to service_role;
