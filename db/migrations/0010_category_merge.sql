-- Категории (17.11.2026): объединение двух категорий одной операцией.
-- category_merge(src, dst) переносит в dst товары и подкатегории src и удаляет src.
-- Подкатегория с тем же названием в dst объединяется с ней (рекурсивно).
-- Складские документы инвентаризации, привязанные к src, переходят на dst.
-- Существующие данные меняются только при вызове функции владельцем или управляющим.

create or replace function category_merge(p_src uuid, p_dst uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; c record; ex uuid; s_name text; d_name text;
begin
  if not has_role('owner','manager') then raise exception 'Объединять категории может владелец или управляющий'; end if;
  if p_src is null or p_dst is null or p_src = p_dst then raise exception 'Выберите другую категорию'; end if;
  select name into s_name from categories where id = p_src;
  select name into d_name from categories where id = p_dst;
  if s_name is null or d_name is null then raise exception 'Категория не найдена'; end if;
  if exists (with recursive d as (select id from categories where id = p_src
                                  union all select c2.id from categories c2 join d on c2.parent_id = d.id)
             select 1 from d where id = p_dst) then
    raise exception 'Нельзя объединить категорию с её подкатегорией';
  end if;
  update products set category_id = p_dst where category_id = p_src;
  get diagnostics n = row_count;
  for c in select id, name from categories where parent_id = p_src loop
    select id into ex from categories where parent_id = p_dst and lower(name) = lower(c.name) limit 1;
    if ex is not null then
      k := category_merge(c.id, ex); n := n + k;
    else
      update categories set parent_id = p_dst where id = c.id;
    end if;
  end loop;
  update stock_docs set category_id = p_dst where category_id = p_src;
  delete from categories where id = p_src;
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Объединение категорий', s_name || ' → ' || d_name, n::text || ' товаров');
  return n;
end $$;
revoke execute on function category_merge(uuid, uuid) from public, anon;
grant execute on function category_merge(uuid, uuid) to authenticated;
