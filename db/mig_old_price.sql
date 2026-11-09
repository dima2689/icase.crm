-- v3: старая цена для ценника со скидкой
alter table products add column if not exists old_price numeric(12,2) check (old_price is null or old_price >= 0);
