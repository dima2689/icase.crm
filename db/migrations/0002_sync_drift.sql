-- Выравнивание рабочей базы со схемой в репозитории (найдено сравнением отпечатков в CI).
-- site_order_upsert и create_sale_bonus: в рабочей базе версии без лишних переменных (it, due) — приводим к schema.sql.
-- create_sale_bonus: версия из schema.sql. Индекс внешнего ключа device_hints.model_id.

create or replace function site_order_upsert(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare st settings; o site_orders; v_id uuid; li jsonb; items jsonb := '[]'; r record; need int; take int; w record; fr jsonb; prob text;
        v_phone text; v_cust uuid; v_wst text := p->>'status'; v_num text; it jsonb; probs text[] := '{}'; u units;
begin
  select * into st from settings where id = 1;
  select * into o from site_orders where woo_id = (p->>'id')::bigint for update;
  if o.id is not null then
    update site_orders set woo_status = v_wst, paid = paid or v_wst in ('processing','completed'), updated_at = now() where id = o.id;
    if v_wst in ('cancelled','refunded','failed') and o.status in ('new','confirmed') then perform site_order_release(o.id, 'Отменён на сайте'); end if;
    return o.id;
  end if;
  if v_wst in ('cancelled','refunded','failed','trash','checkout-draft') then return null; end if;
  v_num := 'С-' || coalesce(p->>'number', p->>'id');
  v_phone := right(regexp_replace(coalesce(p#>>'{billing,phone}',''),'\D','','g'),10);
  if length(v_phone) = 10 then
    select id into v_cust from customers where phone = v_phone;
    if v_cust is null then
      insert into customers(name, phone, email, source)
        values (coalesce(nullif(trim(concat_ws(' ',p#>>'{billing,first_name}',p#>>'{billing,last_name}')),''),'Без имени'), v_phone, nullif(p#>>'{billing,email}',''), 'Сайт')
        returning id into v_cust;
    end if;
  end if;
  -- позиции и резерв
  for li in select * from jsonb_array_elements(coalesce(p->'line_items','[]')) loop
    select * into r from site_resolve(coalesce(nullif((li->>'variation_id')::bigint,0),(li->>'product_id')::bigint), li->>'sku');
    prob := null; fr := '[]';
    need := greatest(1, coalesce((li->>'quantity')::int,1));
    if r.o_product is null then
      prob := 'нет в CRM';
    elsif r.o_unit is not null then
      select * into u from units where id = r.o_unit for update;
      if u.status = 'in_stock' and u.warehouse_id = any(st.site_warehouses) then
        insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,u.warehouse_id,'transfer_out',-1,v_num,'Резерв заказа с сайта');
        insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,st.site_reserve_wh,'transfer_in',1,v_num,'Резерв заказа с сайта');
        fr := jsonb_build_array(jsonb_build_object('wh',u.warehouse_id,'qty',1));
        update units set status = 'reserved', warehouse_id = st.site_reserve_wh, last_ref = v_num where id = u.id;
        need := 1;
      else prob := 'экземпляр уже продан или не на складе сайта'; end if;
    else
      if (select track_serial from products where id = r.o_product) then
        -- новая техника по IMEI: резервируем первые свободные экземпляры
        for u in select * from units where product_id = r.o_product and status = 'in_stock' and warehouse_id = any(st.site_warehouses) order by created_at limit need for update loop
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,u.warehouse_id,'transfer_out',-1,v_num,'Резерв заказа с сайта');
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (u.product_id,st.site_reserve_wh,'transfer_in',1,v_num,'Резерв заказа с сайта');
          update units set status = 'reserved', warehouse_id = st.site_reserve_wh, last_ref = v_num where id = u.id;
          fr := fr || jsonb_build_object('wh',u.warehouse_id,'qty',1,'unit',u.id);
        end loop;
        take := jsonb_array_length(fr);
        if take < need then prob := 'не хватает '||(need-take)||' шт'; end if;
      else
        take := need;
        for w in select warehouse_id, qty from stock where product_id = r.o_product and warehouse_id = any(st.site_warehouses) and qty > 0 order by qty desc loop
          exit when take <= 0;
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (r.o_product,w.warehouse_id,'transfer_out',-least(take,w.qty),v_num,'Резерв заказа с сайта');
          insert into stock_movements(product_id,warehouse_id,type,qty,ref,note) values (r.o_product,st.site_reserve_wh,'transfer_in',least(take,w.qty),v_num,'Резерв заказа с сайта');
          fr := fr || jsonb_build_object('wh',w.warehouse_id,'qty',least(take,w.qty));
          take := take - least(take,w.qty);
        end loop;
        if take > 0 then prob := 'не хватает '||take||' шт'; end if;
      end if;
    end if;
    if prob is not null then probs := probs || (coalesce(li->>'name','?')||': '||prob); end if;
    items := items || jsonb_build_object('product_id',r.o_product,'unit_id',r.o_unit,'name',li->>'name','sku',li->>'sku','qty',need,
      'price',round(coalesce((li->>'total')::numeric,0)/greatest(need,1),2),'woo_line',li->>'id','from',fr,'problem',prob);
  end loop;
  insert into site_orders(woo_id,num,woo_status,customer_id,name,phone,email,address,delivery,payment,paid,total,note,items,problems,created_at)
    values ((p->>'id')::bigint, v_num, v_wst, v_cust,
      nullif(trim(concat_ws(' ',p#>>'{billing,first_name}',p#>>'{billing,last_name}')),''), nullif(v_phone,''), nullif(p#>>'{billing,email}',''),
      nullif(trim(concat_ws(', ',nullif(p#>>'{shipping,city}',''),nullif(p#>>'{shipping,address_1}',''),nullif(p#>>'{shipping,address_2}',''))),''),
      (select string_agg(x->>'method_title',', ') from jsonb_array_elements(coalesce(p->'shipping_lines','[]')) x),
      nullif(p->>'payment_method_title',''), v_wst in ('processing','completed'),
      coalesce((p->>'total')::numeric,0), nullif(p->>'customer_note',''), items, nullif(array_to_string(probs,'; '),''),
      coalesce((p->>'date_created_gmt')::timestamptz, now()))
    returning id into v_id;
  insert into audit_log(action,ref,details) values ('Заказ с сайта',v_num,coalesce(p->>'total','0'));
  return v_id;
end $$;

create or replace function create_sale_bonus(p_bonus numeric, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare cfg jsonb := loyalty_cfg(); c customers; bal numeric; v uuid; sub numeric := 0; it jsonb; maxp numeric; due date;
begin
  if not has_role('owner','manager','seller') then raise exception 'Нет права'; end if;
  if coalesce((cfg->>'on')::boolean,false) = false then raise exception 'Бонусная программа выключена'; end if;
  select * into c from customers where id = nullif(p->>'p_customer','')::uuid for update;
  if c.id is null then raise exception 'Бонусы списываются только у покупателя с телефоном'; end if;
  p_bonus := round(coalesce(p_bonus,0));
  if p_bonus <= 0 then raise exception 'Укажите, сколько бонусов списать'; end if;
  bal := bonus_balance(c.id);
  if p_bonus > bal then raise exception 'У клиента только % бонусов', bal; end if;
  for it in select * from jsonb_array_elements(p->'p_items') loop sub := sub + (it->>'qty')::numeric * (it->>'price')::numeric - coalesce((it->>'discount')::numeric,0); end loop;
  maxp := floor((sub - coalesce((p->>'p_discount')::numeric,0)) * coalesce((cfg->>'max_pay_pct')::numeric,100) / 100);
  if p_bonus > maxp then raise exception 'Бонусами можно оплатить не больше % ₽ (% %% чека)', maxp, coalesce(cfg->>'max_pay_pct','100'); end if;
  if exists (select 1 from jsonb_array_elements(p->'p_payments') x where x->>'method' = 'debt') then
    v := create_sale_debt(nullif(p->>'p_wh','')::uuid, c.id, p->'p_items', p->'p_payments', coalesce((p->>'p_discount')::numeric,0) + p_bonus,
      nullif(p->>'p_tradein_device',''), coalesce((p->>'p_tradein_amount')::numeric,0), nullif(p->>'p_tradein_imei',''), nullif(p->>'p_due','')::date);
  else
    v := create_sale(nullif(p->>'p_wh','')::uuid, c.id, p->'p_items', p->'p_payments', coalesce((p->>'p_discount')::numeric,0) + p_bonus,
      nullif(p->>'p_tradein_device',''), coalesce((p->>'p_tradein_amount')::numeric,0), nullif(p->>'p_tradein_imei',''), 'store');
  end if;
  insert into bonus_ops(customer_id, sale_id, kind, amount, note) values (c.id, v, 'spend', -p_bonus, 'Оплата бонусами ' || (select num from sales where id = v));
  return v;
end $$;

create index if not exists device_hints_model_id_fk on public.device_hints (model_id);
