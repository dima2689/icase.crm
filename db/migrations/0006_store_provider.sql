-- Сайт айкейс.рф (репозиторий icase-store) берёт из CRM цены и остатки вместо МоегоСклада.
-- Формат ответа повторяет то, что сайт раньше читал из МоегоСклада: склады, каталог страницами, остатки по складам.
-- Вызывает только edge-функция site-api по ключу сайта (service_role); закупочные цены не отдаются.

-- справочники: склады (кроме резерва), организация и «тип цены» CRM (постоянные идентификаторы)
create or replace function site_provider_lookups() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort, name),'[]') from warehouses
               where is_active and coalesce(kind,'') <> 'Резерв'),
    'organizations', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-00000000c0de', 'name', coalesce((select shop_name from settings where id = 1), 'iCase'))),
    'priceTypes', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-0000000c0de1', 'name', 'Розничная цена CRM')),
    -- склады, остатки которых CRM показывает на сайтах (настройка «Сайт → Склады»)
    'siteStores', (select coalesce(jsonb_agg(w.id order by w.sort, w.name),'[]') from warehouses w, settings s
                   where s.id = 1 and w.id = any(s.site_warehouses) and w.is_active and coalesce(w.kind,'') <> 'Резерв')) $$;

-- товары страницами (без архива), по имени; woo_id — номер товара на icase52.ru (по нему сайт сопоставляет свои карточки)
create or replace function site_provider_catalog(p_offset int, p_limit int) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'size', (select count(*) from products where not is_archived),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', nullif(p.sku,''), 'barcode', p.barcode,
                'price', p.price, 'wooId', p.woo_id) order by p.name, p.id),'[]')
              from (select * from products where not is_archived order by name, id
                    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,100),1),1000)) p)) $$;

-- остатки по складам для списка товаров: строка на каждый товар и каждый склад (нулевые тоже)
create or replace function site_provider_stock(p_ids uuid[]) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('assortmentId', p.id, 'storeId', w.id, 'stock', coalesce(st.qty,0),
           'reserve', 0, 'inTransit', 0)), '[]')
  from products p cross join warehouses w
  left join stock st on st.product_id = p.id and st.warehouse_id = w.id
  where p.id = any(p_ids) and w.is_active and coalesce(w.kind,'') <> 'Резерв' $$;

revoke execute on function site_provider_lookups(), site_provider_catalog(int,int), site_provider_stock(uuid[]) from public, anon, authenticated;
grant execute on function site_provider_lookups(), site_provider_catalog(int,int), site_provider_stock(uuid[]) to service_role;
