-- Права доступа по итогам тестирования (17.11.2026).
-- 1. Журнал действий: продавец и мастер видели все записи, включая финансовые операции и выплаты зарплаты.
--    Теперь журнал целиком видят владелец и управляющий; остальные — только свои записи.
drop policy if exists staff_read on audit_log;
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using ((select has_role('owner','manager')) or staff_id = (select auth.uid()));

-- 2. Закрыть смену могут те, кто работает с кассой: владелец, управляющий, продавец (как в интерфейсе).
create or replace function close_shift(p_point uuid, p_counted numeric, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare s uuid := current_shift(p_point); e numeric;
begin
  if not has_role('owner','manager','seller') then raise exception 'Закрыть смену может продавец, управляющий или владелец'; end if;
  if not can_work_at(p_point) then raise exception 'Нет доступа к этой точке'; end if;
  if s is null then raise exception 'Нет открытой смены на точке'; end if;
  e := shift_expected_cash(s);
  if abs(p_counted - e) >= 1 and coalesce(p_note,'') = '' then raise exception 'Опишите причину расхождения %', p_counted - e; end if;
  update shifts set status='closed', closed_by=auth.uid(), closed_at=now(), counted_cash=p_counted, expected_cash=e, diff=p_counted-e, close_note=p_note where id = s;
end $$;
