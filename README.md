# iCase CRM

CRM магазина iCase (Дзержинск, ТРК «Рояль»): касса, склад и IMEI, ремонты, клиенты, закупки, финансы, сайт.
Работает как приложение в браузере и на телефоне (PWA) — https://crm.icase-dzr.ru (короткий адрес https://icase-dzr.ru).

## Продукты iCase и их репозитории

| Продукт | Адрес | Репозиторий | Где на сервере 177.177.215.110 |
| --- | --- | --- | --- |
| CRM (этот репозиторий) | https://crm.icase-dzr.ru, API https://api.icase-dzr.ru | `dima2689/icase.crm` | `/opt/icase`, Supabase в Docker |
| Сайт и кабинет покупателя (на проверке) | https://test.айкейс.рф, https://test-app.айкейс.рф | `dima2689/icase-store` | `/opt/icase-review`, Docker (проект `icase-review`) |
| Бот Telegram и его мини-приложение | бот в Telegram, мини-приложение `177-177-215-110.sslip.io` | `dima2689/icase-crm`, ветка `server-2026-11-16` | `/opt/icase-bot`, служба `icase-bot` |
| Сайт WooCommerce (действующий) | https://icase52.ru | — (хостинг Timeweb) | не на этом сервере |

Как они связаны: бот берёт товары, остатки, IMEI, ремонты и сводку из CRM ([bot-api](supabase/functions/bot-api/handler.ts));
сайт icase52.ru связан с CRM через WooCommerce ([docs/site-api.md](docs/site-api.md)); сайт айкейс.рф пока работает со своей базой.

## Документы
- [Сервер и выкладка](docs/deploy.md) — установка, обновление через GitHub Actions, бэкапы, проверка.
- [API для сайта](docs/site-api.md) — каталог, заказы, статусы ремонтов.
- [IMEI и серийные товары](docs/imei.md).
- [Телефон](docs/mobile.md) — CRM как приложение на телефоне.

## Выкладка
Изменение в ветке `main` → проверка CI → Deploy на сервер (сам). Ручные действия — во вкладке Actions:
**Server setup** (установка и настройки), **Server inspect** (только просмотр), **Bot connect** (обновление бота и его связь с CRM).
Секреты в репозиторий и в чат не кладутся: они хранятся в GitHub (Settings → Environments → production) и на сервере.
