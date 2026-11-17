# Приёмка товара

This document records the decisions for stock intake that are not clear from the code.

## Payment to the supplier

- One intake document can be paid from several accounts. The interface writes `stock_docs.payments` as `[{"account_id", "amount"}]`.
- When the document is posted, `fin_doc_posted()` creates the supplier debt for the full intake sum. Then it creates one expense operation for each payment and links it to the debt. The debt shows the unpaid rest.
- The payments must not exceed the intake sum. The database rejects the posting otherwise.
- The old single field `stock_docs.pay_account` still works when `payments` is empty.
- Only the owner and the manager can attach payments. For other roles the trigger `stock_docs_seller_guard()` clears `payments` and `pay_account`.
- Cancelling a posted intake cancels every operation linked to its debt and then cancels the debt. Money returns to the accounts. If cash cannot return to a closed shift, the cancellation fails with a clear message.

## Delivery and other costs

- `stock_docs.extra_cost` stores delivery and other costs of the intake.
- The interface divides the costs between the lines in proportion to the purchase sum. It writes the result into `stock_doc_lines.cost`, so the cost of every received unit includes delivery.
- The supplier debt includes delivery, because the debt is the sum of the received cost.
- The interface does not write a cost into `new_units`. Sellers can read that column, and the cost must stay hidden from them.
- The landed cost is rounded to kopecks per unit. The debt can differ from the shown total by a few kopecks.

## Drafts

- «Сохранить черновик» stores the intake as a `stock_docs` draft with its lines. `stock_doc_lines.sale_price` keeps the sale price; posting does not read it.
- The intake screen loads drafts directly, so drafts are available in the «Касса» workplace too.
- `stock_doc_lines.cost` is hidden from the API. Users with the cost permission read it through `costs_doc_lines()`.
- A user without the cost permission sees zero purchase prices in a draft. If such a user saves the draft again, the purchase prices of that draft are lost. Posting by a seller takes prices from the product cards anyway.

## Trade-in and returns

- A unit that we sold before is not received silently. The intake screen offers the sales return by receipt, the buyout flow («Выкуп и комиссия»), or a normal intake.
- Trade-in and buyout use the buyout flow because it creates the contract with passport data and pays the client correctly.

## Unit parameters

- Region, SIM configuration, plug type, activation, grade and kit are stored in `units.attrs` (`region`, `sim`, `plug`, `act`, `grade`, `kitList`).
- The labels show region, SIM and plug next to memory and colour. The unit label barcode is the IMEI or serial number of the unit.
