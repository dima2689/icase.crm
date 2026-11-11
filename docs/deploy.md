# Размещение iCase на своём сервере

Всё работает на одном VPS в России: база Supabase (Postgres, вход, API, хранилище фото, edge-функции) и CRM.
Каждая выкладка проходит через GitHub: push в `main` → проверки (CI) → автоматическая выкладка на сервер.

```
 Телефоны, кассы, ПК ──HTTPS──▶ Caddy (80/443, сертификаты Let's Encrypt)
                                  ├─ crm.<домен>  → статичные файлы CRM (/srv/icase/crm)
                                  └─ api.<домен>  → Supabase api-gw:8000 → auth / rest / realtime / storage / functions
                                                                         └─ Postgres 17 (наружу закрыт)
 Сайт (WooCommerce) ──HTTPS──▶ api.<домен>/functions/v1/site-api
 Таймеры сервера: бэкап 03:30 → S3, проверка каждые 10 мин → Telegram
```

## 1. Что купить и подготовить

| Что | Рекомендация | Примерно в месяц |
|---|---|---|
| VPS | Timeweb Cloud / Selectel / REG.RU: **4 vCPU, 8 ГБ RAM, 80 ГБ NVMe**, Ubuntu 24.04, дата-центр в РФ | 2–3 тыс. ₽ |
| S3-хранилище для бэкапов | Selectel Object Storage или Timeweb S3, **у другого провайдера или в другом регионе**, чем VPS | 50–200 ₽ |
| Почта для писем входа | Яндекс 360 / Mail.ru для бизнеса / Unisender Go — ящик вида `crm@ваш-домен` с паролем приложения для SMTP | 0–300 ₽ |
| Домен | две записи: `crm.<домен>` и `api.<домен>` | — |

Персональные данные клиентов (152-ФЗ): сервер и бэкапы — в РФ. Тестовую базу Supabase во Франкфурте для реальных данных не используем.

## 2. DNS

У регистратора домена создайте A-записи на IP сервера:

```
crm.<домен>   A   <IP сервера>
api.<домен>   A   <IP сервера>
```

## 3. Подготовка сервера (один раз, ~15 минут)

На своём компьютере создайте ключ, которым GitHub будет выкладывать версии:

```bash
ssh-keygen -t ed25519 -N "" -f icase_deploy -C github-actions
```

На сервере (от root):

```bash
git clone https://github.com/dima2689/icase.crm /root/icase && cd /root/icase   # или scp -r deploy root@IP:/root/icase/
mkdir -p /etc/icase && cp deploy/icase.env.example /etc/icase/icase.env && nano /etc/icase/icase.env
#   домены, ACME_EMAIL, SMTP, S3, BACKUP_PASSPHRASE (длинный пароль — сохраните его в менеджере паролей!)
bash deploy/install.sh "$(cat icase_deploy.pub)"   # содержимое публичного ключа
```

`install.sh` делает: обновления безопасности, Docker (с зеркалами реестра), swap, пользователя `deploy` (может только запускать выкладку),
вход по SSH только по ключам, файрвол (22/80/443), fail2ban, официальный docker-набор Supabase с новыми секретами,
выключенную самостоятельную регистрацию, таймеры бэкапа и проверки.

## 4. Секреты в GitHub

Репозиторий → Settings → Environments → **production** (создать) → Secrets:

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | IP или имя сервера |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | содержимое файла `icase_deploy` (приватный ключ) |
| `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan -t ed25519 <IP>` |

В environment **production** можно включить «Required reviewers» — тогда каждая выкладка ждёт нажатия «Approve».

## 5. Первая выкладка

Actions → **Deploy** → Run workflow (или любой push в `main` после зелёного CI). Затем на сервере:

```bash
/opt/icase/app/deploy/create-owner.sh you@mail.ru "Имя Фамилия"   # печатает временный пароль
systemctl start icase-backup.timer icase-health.timer
/opt/icase/app/deploy/healthcheck.sh                              # все пункты должны быть ✓
```

Откройте `https://crm.<домен>`, войдите, смените пароль, добавьте сотрудников (Настройки → Сотрудники).
На телефонах/кассах откройте новый адрес и заново «Добавить на экран „Домой“».

Сайт: в CRM → Настройки → Сайт создайте ключ; в плагине/сайте адрес API — `https://api.<домен>/functions/v1/site-api`.
Эвотор: вебхук — `https://api.<домен>/functions/v1/evotor?key=…` (ключ — в CRM → Настройки → Эвотор).

## 6. Перенос данных с тестовой базы (если нужно)

Тестовая база содержит только демо-данные — обычно начинаем с чистой. Если что-то нужно перенести (справочник товаров, цены),
выгрузите из CRM в Excel и загрузите обратно в новую CRM через импорт.

## Как устроена выкладка

`deploy/deploy.sh` на сервере, по шагам:
1. бэкап базы перед выкладкой (локально, 5 последних);
2. настройки Supabase из `/etc/icase/icase.env` (домены, SMTP);
3. edge-функции → `volumes/functions`, перезапуск;
4. миграции: `deploy/migrate.sh` — на новой базе `db/prelude.sql` + `db/schema.sql`, затем новые `db/migrations/NNNN_*.sql`
   (учёт в `public.icase_migrations`), затем повторяемые `db/always/*.sql` (расписания, хранилище);
5. CRM: копия файлов, `js/config.js` с адресом API и публичным ключом, новая версия service worker (кассы обновятся сами);
6. перезагрузка Caddy и проверка `healthcheck.sh`.

Новые изменения базы — только новым файлом `db/migrations/0002_что_делаем.sql` (не правкой старых). CI проверяет каждую
ветку: ставит Supabase с нуля, применяет схему, сравнивает отпечаток с рабочей базой (`db/tests/compare.sh`),
прогоняет сквозные проверки, делает бэкап → полный сброс → восстановление и проверяет снова.

## Повседневное

| Задача | Команда (на сервере) |
|---|---|
| Состояние | `/opt/icase/app/deploy/healthcheck.sh` |
| Версии / откат приложения | `sudo /opt/icase/bin/icase-release --list` / `--rollback` (база не откатывается) |
| Бэкап сейчас | `/opt/icase/app/deploy/backup.sh` |
| Восстановить на этом сервере | `/opt/icase/app/deploy/restore.sh /var/backups/icase/<файл>.tar.gpg --fresh` |
| Восстановить на новом сервере | шаги 3 → `restore.sh s3:daily/<файл>.tar.gpg --fresh` → Deploy |
| Studio (просмотр базы) | `ssh -L 3000:127.0.0.1:3000 root@<IP>` → http://localhost:3000 (логин/пароль — `DASHBOARD_*` в `/opt/icase/supabase/.env`) |
| Логи | `cd /opt/icase/supabase && docker compose logs -f --tail 100 auth rest functions` |
| Обновить Supabase | поменять `SB_REF` в `deploy/lib.sh` → ветка → CI зелёный → main |

Проверка восстановления раз в квартал: поднять временный VPS, `install.sh`, `restore.sh s3:... --fresh`, открыть CRM.

## Безопасность

- Наружу открыты только 22 (ключи), 80/443. Postgres, пулер и Studio — только `127.0.0.1`.
- Секретный ключ `service_role` есть только на сервере (`/opt/icase/supabase/.env`, права 600) и в бэкапах (зашифрованы).
- Регистрация выключена; сотрудников добавляет владелец.
- Заголовки: HSTS, CSP (только свои скрипты + API), запрет встраивания в чужие сайты.
- Бэкапы: AES-256 (gpg), пароль `BACKUP_PASSPHRASE` хранится отдельно от сервера; 14 дневных + 8 недельных копий в S3.
