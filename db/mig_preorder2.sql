-- =====================================================================
-- iCase · предзаказы, часть 2: перемещение забронированного устройства на точку клиента
-- =====================================================================
create or replace function preorder_move(p_id uuid, p_wh uuid) returns void language plpgsql security definer set search_path=public as $$
declare o preorders; u units; from_wh uuid;
begin
  select * into o from preorders where id = p_id for update;
  if o.status <> 'arrived' or o.unit_id is null then raise exception 'Нет забронированного экземпляра'; end if;
  if not exists (select 1 from warehouses where id = p_wh and (o.point_id is null or point_id = o.point_id)) then raise exception 'Выберите склад точки предзаказа'; end if;
  if not (has_role('owner','manager','storekeeper') or (has_role('seller') and my_point() = o.point_id)) then raise exception 'Нет права перемещать'; end if;
  select * into u from units where id = o.unit_id for update;
  if u.status <> 'reserved' then raise exception 'Экземпляр не в резерве'; end if;
  from_wh := u.warehouse_id;
  if from_wh = p_wh then return; end if;
  update units set warehouse_id = p_wh, last_ref = o.num where id = u.id;
  insert into stock_movements(product_id, warehouse_id, type, qty, ref, note) values (u.product_id, from_wh, 'transfer_out', -1, o.num, 'Предзаказ: на точку клиента');
  insert into stock_movements(product_id, warehouse_id, type, qty, ref, note) values (u.product_id, p_wh, 'transfer_in', 1, o.num, 'Предзаказ: на точку клиента');
  insert into audit_log(staff_id, action, ref, details) values (auth.uid(), 'Предзаказ перемещён', o.num,
    (select name from warehouses where id = from_wh) || ' → ' || (select name from warehouses where id = p_wh));
end $$;
revoke execute on function preorder_move(uuid,uuid) from public, anon;
grant execute on function preorder_move(uuid,uuid) to authenticated;
