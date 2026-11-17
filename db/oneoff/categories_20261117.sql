-- Порядок в категориях товаров (17.11.2026), по просьбе владельца.
-- Меняются только категории и привязка товаров к ним. Товары, цены и остатки не меняются.
-- Скрипт идемпотентный: повторный запуск ничего не ломает. Транзакцию открывает и закрывает вызывающий.
do $$
declare acc uuid; gl uuid; xi uuid; used uuid; ip18 uuid; c record; n int; total int := 0;
  sub_acc text[] := array['Зарядные устройства','Кабели','Чехлы','Наушники','Держатели и MagSafe'];
  s text;
begin
  -- 1. Аксессуары: исправить опечатку, разложить по подкатегориям
  update categories set name = 'Аксессуары' where parent_id is null and name = 'Акссесуары';
  select id into acc from categories where parent_id is null and name = 'Аксессуары';
  if acc is null then insert into categories(name) values ('Аксессуары') returning id into acc; end if;
  foreach s in array sub_acc loop
    insert into categories(name, parent_id) select s, acc where not exists (select 1 from categories where parent_id = acc and name = s);
  end loop;
  select id into xi from categories where parent_id is null and name = 'Xiaomi';
  update products p set category_id = coalesce(case
      when p.name ~* 'термокружка|увлажнитель' then xi
      when p.name ~* 'чехол' then (select id from categories where parent_id = acc and name = 'Чехлы')
      when p.name ~* 'адаптер|зарядный блок|power adapter|hoco pd' then (select id from categories where parent_id = acc and name = 'Зарядные устройства')
      when p.name ~* 'кабел' then (select id from categories where parent_id = acc and name = 'Кабели')
      when p.name ~* 'наушник|earpods' then (select id from categories where parent_id = acc and name = 'Наушники')
      when p.name ~* 'держател|картхолдер|magsafe' then (select id from categories where parent_id = acc and name = 'Держатели и MagSafe')
    end, p.category_id)
  where p.category_id = acc;
  get diagnostics n = row_count; total := total + n;

  -- 2. Стекла → Аксессуары / Защитные стекла / iPhone, Samsung
  update categories set name = 'Защитные стекла', parent_id = acc where parent_id is null and name = 'Стекла';
  select id into gl from categories where parent_id = acc and name = 'Защитные стекла';
  if gl is not null then
    insert into categories(name, parent_id) select 'iPhone', gl where not exists (select 1 from categories where parent_id = gl and name = 'iPhone');
    insert into categories(name, parent_id) select 'Samsung', gl where not exists (select 1 from categories where parent_id = gl and name = 'Samsung');
    update products p set category_id = case when p.name ~* 'samsung' then (select id from categories where parent_id = gl and name = 'Samsung')
                                             when p.name ~* 'iphone' then (select id from categories where parent_id = gl and name = 'iPhone') else p.category_id end
    where p.category_id = gl;
    get diagnostics n = row_count; total := total + n;
  end if;

  -- 3. iPhone б/у → Б/у техника (б/у, устройство) / iPhone, Apple Watch, Samsung
  update categories set name = 'Б/у техника' where parent_id is null and name = 'iPhone б/у';
  select id into used from categories where parent_id is null and name = 'Б/у техника';
  if used is not null then
    update categories set is_used = true, is_device = true where id = used;
    foreach s in array array['iPhone','Apple Watch','Samsung'] loop
      insert into categories(name, parent_id, is_used, is_device) select s, used, true, true where not exists (select 1 from categories where parent_id = used and name = s);
    end loop;
    update products p set category_id = case when p.name ~* 'apple watch' then (select id from categories where parent_id = used and name = 'Apple Watch')
                                             when p.name ~* 'samsung' then (select id from categories where parent_id = used and name = 'Samsung')
                                             when p.name ~* 'iphone' then (select id from categories where parent_id = used and name = 'iPhone') else p.category_id end
    where p.category_id = used;
    get diagnostics n = row_count; total := total + n;
  end if;

  -- 4. товары без категории и лежащие прямо в «Apple / iPhone»
  select c3.id into ip18 from categories c3 join categories c2 on c2.id = c3.parent_id join categories c1 on c1.id = c2.parent_id
    where c1.parent_id is null and c1.name = 'Apple' and c2.name = 'iPhone' and c3.name = 'iPhone 18 Pro Max';
  update products set category_id = ip18 where ip18 is not null and name ~* '^iphone 18 pro max' and name !~* 'б/у|акб'
    and (category_id is null or category_id = (select c2.id from categories c2 join categories c1 on c1.id = c2.parent_id where c1.parent_id is null and c1.name = 'Apple' and c2.name = 'iPhone'));
  get diagnostics n = row_count; total := total + n;
  update products set category_id = xi where category_id is null and xi is not null and name ~* '^xiaomi';
  get diagnostics n = row_count; total := total + n;
  update products set category_id = (select id from categories where parent_id = used and name = 'iPhone')
    where category_id is null and used is not null and name ~* '^iphone' and name ~* 'б/у|акб';
  get diagnostics n = row_count; total := total + n;

  -- 5. пустые категории (без товаров и подкатегорий), найденные при разборе
  for c in select c2.id from categories c2 left join categories p on p.id = c2.parent_id left join categories pp on pp.id = p.parent_id
           where (p.name, c2.name) in (('Samsung','Fold-series'),('iPhone','iPhone 13'),('iPhone','iPhone 15'),('iPhone','iPhone Duo'),
                  ('Аксессуары Apple','Зарядные кабели'),('Аксессуары Apple','Зарядные устройства'),('Аксессуары Apple','Клавиатуры'),('Аксессуары Apple','Трекпады'),('Аксессуары Apple','Чехол-клавиатура'))
             and not exists (select 1 from products x where x.category_id = c2.id)
             and not exists (select 1 from categories k where k.parent_id = c2.id)
             and not exists (select 1 from stock_docs d where d.category_id = c2.id) loop
    delete from categories where id = c.id;
  end loop;

  insert into audit_log(staff_id, action, ref, details) values (null, 'Порядок в категориях', 'по просьбе владельца', total::text || ' товаров переложено');
  raise notice 'переложено товаров: %', total;
end $$;
