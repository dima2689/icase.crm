-- v3: оптимизация базы.
-- 1) Политики RLS: has_role()/is_staff()/auth.uid() вычисляются один раз на запрос (обёртка SELECT), а не для каждой строки.
-- 2) Политики «на всё» (ALL), которые дублируют политику чтения, делятся на INSERT/UPDATE/DELETE —
--    при чтении проверяется одна политика вместо двух-трёх. Права доступа не меняются.
-- 3) Индексы на внешние ключи, по которым идут связи и выборки (кроме ссылок «кто создал»).
-- Миграцию можно запускать повторно.

/* --- ремонт: две политики чтения (сотрудники и кабинет клиента) → одна --- */
do $$ declare q text; begin
  select qual into q from pg_policies where schemaname='public' and tablename='repairs' and policyname='staff_read';
  if q is not null and exists (select 1 from pg_policies where schemaname='public' and tablename='repairs' and policyname='own_repairs') then
    execute 'drop policy own_repairs on repairs';
    execute 'drop policy staff_read on repairs';
    execute format('create policy staff_read on repairs for select using ((%s) or (customer_id in (select c.id from customers c where c.auth_user = (select auth.uid()))))', q);
  end if;
end $$;

do $$
declare p record; q text; w text; rl text; perm text; split boolean; n int := 0;
  wrap constant text := '(?<!SELECT )(has_role\(VARIADIC ARRAY\[[^\]]*\]\)|is_staff\(\)|auth\.uid\(\)|my_role\(\)|my_point\(\))';
begin
  for p in select * from pg_policies where schemaname = 'public' order by tablename, policyname loop
    q := case when p.qual is null then null else regexp_replace(p.qual, wrap, '(SELECT \1)', 'g') end;
    w := case when p.with_check is null then null else regexp_replace(p.with_check, wrap, '(SELECT \1)', 'g') end;
    split := p.cmd = 'ALL' and exists (select 1 from pg_policies o where o.schemaname = 'public' and o.tablename = p.tablename
               and o.policyname <> p.policyname and o.cmd in ('SELECT','ALL') and o.permissive = 'PERMISSIVE');
    if q is not distinct from p.qual and w is not distinct from p.with_check and not split then continue; end if;
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into rl from unnest(p.roles) r;
    perm := case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    if split then
      execute format('create policy %I on public.%I as %s for insert to %s with check (%s)', p.policyname || '_ins', p.tablename, perm, rl, coalesce(w, q));
      execute format('create policy %I on public.%I as %s for update to %s using (%s) with check (%s)', p.policyname || '_upd', p.tablename, perm, rl, q, coalesce(w, q));
      execute format('create policy %I on public.%I as %s for delete to %s using (%s)', p.policyname || '_del', p.tablename, perm, rl, q);
    else
      execute format('create policy %I on public.%I as %s for %s to %s%s%s', p.policyname, p.tablename, perm, p.cmd, rl,
        case when q is not null then format(' using (%s)', q) else '' end,
        case when w is not null then format(' with check (%s)', w) else '' end);
    end if;
    n := n + 1;
  end loop;
  raise notice 'политик обновлено: %', n;
end $$;

/* --- индексы на внешние ключи --- */
do $$
declare f record; n int := 0;
begin
  for f in
    select c.conrelid::regclass::text tbl, a.attname col, c.confrelid::regclass::text ref
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey,1) = 1
      and c.confrelid <> 'public.staff'::regclass            -- «кто создал/провёл» — по ним не ищем
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s(%I)', left(replace(f.tbl,'public.','') || '_' || f.col || '_fk', 63), f.tbl, f.col);
    n := n + 1;
  end loop;
  raise notice 'индексов на внешние ключи: %', n;
end $$;

-- частые выборки интерфейса
create index if not exists sales_created_idx on sales(created_at desc);
create index if not exists cash_ops_created_idx on cash_ops(created_at desc);
create index if not exists cash_ops_ref_idx on cash_ops(ref);
create index if not exists returns_created_idx on returns(created_at desc);
create index if not exists units_imei2_idx on units(imei2) where imei2 is not null;
analyze;
