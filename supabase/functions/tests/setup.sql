\set ON_ERROR_STOP 1
insert into points(name) values ('Галерея');
insert into staff values ('00000000-0000-0000-0000-000000000001','Тест','owner',null);
insert into warehouses(name,point_id) select 'Зал',id from points;
insert into warehouses(name) values ('Сервис');
update points p set cash_wh=w.id from warehouses w where w.point_id=p.id;
update settings set site_warehouses = array[(select id from warehouses where name='Зал')], site_sync=true;
insert into categories(name) values ('Аксессуары');
insert into categories(name,is_device,is_used) values ('Б/у техника',true,true);
insert into categories(name,is_device) values ('Смартфоны',true);
insert into products(name,category_id,price,cost,sku,on_site) select 'Чехол',id,990,300,'CASE1',true from categories where name='Аксессуары';
insert into products(name,category_id,price,cost,on_site,track_serial,condition) select 'iPhone 13 128',id,38000,30000,true,true,'Б/у отличное' from categories where name='Б/у техника';
insert into products(name,category_id,price,cost,on_site,track_serial,condition,sku,memory,color) select 'iPhone 16 128',id,80000,70000,true,true,'Новый','IP16','128 ГБ','Черный' from categories where name='Смартфоны';
insert into stock_docs(num,type,wh_to) select 'ПР-1','in',id from warehouses where name='Зал';
insert into stock_doc_lines(doc_id,product_id,qty,cost) select (select id from stock_docs),id,5,300 from products where name='Чехол';
insert into stock_doc_lines(doc_id,product_id,qty,cost,new_units) select (select id from stock_docs),id,0,30000,'[{"imei":"353000000000013","battery_health":"88","price":"39000"},{"imei":"353000000000021","battery_health":"93"}]' from products where name='iPhone 13 128';
insert into stock_doc_lines(doc_id,product_id,qty,cost,new_units) select (select id from stock_docs),id,0,70000,'[{"imei":"356000000000011"},{"imei":"356000000000029"}]' from products where name='iPhone 16 128';
select post_doc(id) from stock_docs;
-- 2 Сервис: чехлы там не видны сайту
insert into stock_movements(product_id,warehouse_id,type,qty,ref) select p.id,w.id,'in',3,'x' from products p, warehouses w where p.name='Чехол' and w.name='Сервис';
