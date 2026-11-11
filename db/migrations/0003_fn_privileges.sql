-- Права как в рабочей базе: служебные функции не вызываются сотрудниками напрямую.
-- debt_left — внутренний расчёт остатка долга; *_preorder — функции триггеров (триггерам права EXECUTE не нужны).
revoke execute on function public.debt_left(uuid), public.units_preorder(), public.movements_preorder() from public, anon, authenticated;
