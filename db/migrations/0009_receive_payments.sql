-- Приёмка (17.11.2026): оплата накладной с нескольких счетов, доставка в себестоимости,
-- черновик приёмки на сервере, наценка по умолчанию.
--
-- 1. stock_docs.payments — оплата при проведении: [{"account_id": uuid, "amount": number}, ...].
--    Старое поле pay_account (вся сумма с одного счёта) продолжает работать, если payments пуст.
-- 2. stock_docs.extra_cost — доставка и прочие расходы. Интерфейс делит её по позициям
--    пропорционально закупке и записывает в себестоимость строк (stock_doc_lines.cost — скрытая колонка).
--    Себестоимость экземпляров в new_units не пишется: эта колонка видна продавцу.
-- 3. stock_doc_lines.sale_price — цена продажи из черновика приёмки. Проведение её не читает:
--    цену товара меняет интерфейс до проведения, как и раньше.
-- 4. settings.receive — настройки приёмки: {"markup": % наценки по умолчанию, "round": шаг округления цены}.
-- 5. Отмена проведённой приёмки отменяет все оплаты по её долгу (деньги возвращаются на счета) и сам долг.
--    Если наличные уже нельзя вернуть в кассу (смена закрыта), отмена приёмки не проходит с понятной ошибкой.
-- Существующие данные не меняются.

alter table stock_docs add column if not exists payments jsonb not null default '[]'::jsonb;
alter table stock_docs add column if not exists extra_cost numeric(12,2) not null default 0 check (extra_cost >= 0);
alter table stock_doc_lines add column if not exists sale_price numeric(12,2);
alter table settings add column if not exists receive jsonb not null default '{"markup":0,"round":10}'::jsonb;
-- новая колонка stock_doc_lines должна попасть в разрешённые для чтения (себестоимость по-прежнему скрыта)
select refresh_col_grants();

create or replace function fin_doc_posted() returns trigger language plpgsql security definer set search_path = public as $$
declare v_sum numeric; v_debt uuid; s suppliers; p jsonb; v_paid numeric := 0; v_amt numeric; o record;
        v_pays jsonb := coalesce(new.payments, '[]'::jsonb);
begin
  if new.type <> 'in' or new.supplier_id is null then return new; end if;
  if new.status = 'posted' and old.status is distinct from 'posted' then
    select coalesce(sum(case when p2.track_serial then (select coalesce(sum(u.cost),0) from units u where u.last_ref = new.num and u.product_id = l.product_id)
                             else coalesce(l.qty,0) * l.cost end),0)
      into v_sum from stock_doc_lines l join products p2 on p2.id = l.product_id where l.doc_id = new.id;
    if v_sum <= 0 then return new; end if;
    select * into s from suppliers where id = new.supplier_id;
    insert into debts(direction, kind, counterparty, supplier_id, doc_id, amount, note, created_by)
      values ('out', 'supplier', s.name, s.id, new.id, round(v_sum,2), 'Приёмка ' || new.num || coalesce(', накладная ' || new.invoice, ''), new.posted_by)
      returning id into v_debt;
    if jsonb_array_length(v_pays) = 0 and new.pay_account is not null then
      v_pays := jsonb_build_array(jsonb_build_object('account_id', new.pay_account, 'amount', round(v_sum,2)));
    end if;
    for p in select * from jsonb_array_elements(v_pays) loop
      v_amt := round(coalesce(nullif(p->>'amount','')::numeric, 0), 2);
      continue when v_amt <= 0 or nullif(p->>'account_id','') is null;
      v_paid := v_paid + v_amt;
      if v_paid > round(v_sum,2) + 0.5 then
        raise exception 'Оплата поставщику (% ₽) больше суммы приёмки (% ₽)', v_paid, round(v_sum,2);
      end if;
      perform fin_op_create(jsonb_build_object('kind','out','account_id',(p->>'account_id')::uuid,'amount',v_amt,'debt_id',v_debt,
        'category_id',(select id from fin_categories where name = 'Закупка товара' limit 1),'counterparty',s.name,'note','Оплата приёмки ' || new.num));
    end loop;
  elsif new.status = 'cancelled' and old.status = 'posted' then
    for o in select f.id from fin_ops f join debts d on d.id = f.debt_id
             where d.doc_id = new.id and f.cancelled_at is null loop
      perform fin_op_cancel(o.id);
    end loop;
    update debts set status = 'cancelled', note = coalesce(note,'') || ' · приёмка отменена'
      where doc_id = new.id and status <> 'cancelled';
  end if;
  return new;
end $$;
revoke execute on function fin_doc_posted() from public, anon, authenticated;

/* оплату поставщику при приёмке проводят только владелец и управляющий (у остальных нет доступа к счетам) */
create or replace function stock_docs_seller_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if has_role('seller') then new.po_id := null; end if;
  if not has_role('owner','manager') then new.pay_account := null; new.payments := '[]'::jsonb; end if;
  return new;
end $$;
