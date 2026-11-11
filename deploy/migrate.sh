#!/usr/bin/env bash
# Применяет схему базы iCase.
#   Новая база:        db/prelude.sql + db/schema.sql (базовая схема) + все db/migrations/*.sql
#   Существующая база: только ещё не применённые db/migrations/*.sql
# Затем каждый раз выполняются повторяемые db/always/*.sql (расписания, хранилище).
# Учёт ведётся в таблице public.icase_migrations. Каждая миграция — в своей транзакции.
#
# Использование: PSQL="docker exec -i supabase-db psql -U postgres -d postgres" deploy/migrate.sh [путь_к_репозиторию]
#   FUNCTIONS_URL — адрес edge-функций для расписаний (по умолчанию http://functions:9000)
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PSQL="${PSQL:-docker exec -i supabase-db psql -U postgres -d postgres}"
FUNCTIONS_URL="${FUNCTIONS_URL:-http://functions:9000}"
q() { $PSQL -v ON_ERROR_STOP=1 -qAt "$@"; }

state=$(q -c "select case when to_regclass('public.icase_migrations') is not null then 'tracked'
                          when to_regclass('public.settings') is not null then 'legacy'
                          else 'empty' end")
echo "migrate: база — $state"

if [ "$state" = "empty" ]; then
  echo "migrate: новая база → prelude + schema.sql"
  q -1 -f - < "$ROOT/db/prelude.sql"
  q -1 -f - < "$ROOT/db/schema.sql"
fi
if [ "$state" != "tracked" ]; then
  q -c "create table if not exists public.icase_migrations(name text primary key, applied_at timestamptz not null default now());
        alter table public.icase_migrations enable row level security;
        revoke all on public.icase_migrations from anon, authenticated;
        insert into public.icase_migrations(name) values ('0000_baseline') on conflict do nothing;"
fi

n=0
for f in "$ROOT"/db/migrations/*.sql; do
  [ -e "$f" ] || continue
  name=$(basename "$f" .sql)
  if [ -n "$(q -c "select 1 from public.icase_migrations where name = '$name'")" ]; then continue; fi
  echo "migrate: применяю $name"
  { cat "$f"; echo; echo "insert into public.icase_migrations(name) values ('$name');"; } | q -1 -f -
  n=$((n+1))
done
q -c "select public.icase_set_functions_url('$FUNCTIONS_URL')" >/dev/null
for f in "$ROOT"/db/always/*.sql; do
  [ -e "$f" ] || continue
  echo "migrate: повторяемый $(basename "$f")"
  q -1 -f - < "$f" >/dev/null
done
q -c "notify pgrst, 'reload schema'" >/dev/null
echo "migrate: применено новых миграций — $n"
