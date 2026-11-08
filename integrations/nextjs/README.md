# iCase CRM → сайт на Next.js

Сайт сам читает каталог из CRM по API (с кэшем), CRM сообщает сайту об изменениях, а заказы с сайта уходят в CRM и резервируют товар.

## 1. Переменные окружения сайта (`.env.local`, на хостинге — в настройках проекта)
```
ICASE_API_URL=https://wputkpwptwaxwzebszua.supabase.co/functions/v1/site-api
ICASE_API_KEY=…        # CRM → Настройки → Сайт → «Ключ API» (Показать)
ICASE_HOOK_SECRET=…    # CRM → Настройки → Сайт → «Секрет уведомлений» (Показать)
```
Ключи только на сервере: не используйте префикс `NEXT_PUBLIC_`.

## 2. Файлы
- `lib/icase.ts` — функции `getCatalog`, `getProduct`, `getCategories`, `createOrder`, `getOrderStatus` и типы товара.
- `app/api/icase/route.ts` — приём уведомлений CRM (проверка подписи, сброс кэша каталога).
- `app/api/order/route.ts` — оформление заказа: цены берутся из CRM, а не из браузера.

Нужен пакет `server-only` (`npm i server-only`), путь `@/` — как в стандартном шаблоне Next.js.

## 3. В CRM
Настройки → Сайт: режим «Свой сайт», отметить склады сайта, включить выгрузку, адрес уведомлений `https://ваш-сайт/api/icase`, нажать «Проверить подключение». Заказы — включить после переезда базы на российский сервер (152-ФЗ).

## 4. Пример страницы каталога
```tsx
import { getCatalog } from "@/lib/icase";
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  const { items, total } = await getCatalog({ q, in_stock: true, page: Number(page) || 1 });
  return <ul>{items.map((p) => <li key={p.id}><a href={`/product/${p.slug}`}>{p.name}</a> — {p.price.toLocaleString("ru-RU")} ₽</li>)}</ul>;
}
```

## Что приходит по товару
`id, sku, slug, type (product | used_unit), name, price, in_stock, qty, category[], specs[{name,value}], brand, model, memory, color, condition, warranty_months, battery (б/у), description, photos[]` — набор полей настраивается в CRM («Что передавать на сайт»). Закупочные цены не передаются никогда.
