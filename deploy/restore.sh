#!/usr/bin/env bash
# Восстановление iCase из резервной копии на ЧИСТЫЙ стек (новый сервер или сброшенный).
#   restore.sh /var/backups/icase/icase-....tar.gpg
#   restore.sh s3:daily/icase-....tar.gpg          — скачать из S3
#   restore.sh <файл> --fresh                       — сначала удалить текущую базу и файлы на этом сервере (спросит подтверждение)
# Ключи (.env Supabase, ключ шифрования Vault) берутся из копии, поэтому прежние ссылки и секреты продолжают работать.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"; . "$HERE/lib.sh"
SRC="${1:?укажите файл копии}"; FRESH=0; YES=0
shift; for a in "$@"; do case "$a" in --fresh) FRESH=1;; --yes) YES=1;; *) die "неизвестный параметр $a";; esac; done
[ -f "$ICASE_ENV" ] && load_env
: "${BACKUP_PASSPHRASE:?нужен BACKUP_PASSPHRASE}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT

if [[ "$SRC" == s3:* ]]; then
  export RCLONE_CONFIG_ICS3_TYPE=s3 RCLONE_CONFIG_ICS3_PROVIDER=Other RCLONE_CONFIG_ICS3_ENDPOINT="$S3_ENDPOINT" \
         RCLONE_CONFIG_ICS3_REGION="${S3_REGION:-}" RCLONE_CONFIG_ICS3_ACCESS_KEY_ID="$S3_ACCESS_KEY" RCLONE_CONFIG_ICS3_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
  rclone copyto "ics3:$S3_BUCKET/${SRC#s3:}" "$W/b.tar.gpg"; SRC="$W/b.tar.gpg"
fi
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$SRC" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$W" -xf -
D=$(find "$W" -mindepth 1 -maxdepth 1 -type d -name 'icase-*' | head -1); [ -d "$D" ] || die "в копии нет данных"
log "копия: $(grep created "$D/manifest.txt")"; grep '^rows\.' "$D/manifest.txt" | sed 's/^/  /'

if [ $FRESH = 1 ]; then
  if [ $YES = 0 ]; then read -r -p "Удалить ТЕКУЩУЮ базу и файлы на этом сервере и восстановить копию? Напишите ДА: " a; [ "$a" = "ДА" ] || die "отменено"; fi
  log "сброс стека"
  dc down -v --remove-orphans || true
  # файлы принадлежат пользователям контейнеров: без root удаляем через sudo
  rm -rf "$SB_DIR/volumes/db/data" "$SB_DIR/volumes/storage" 2>/dev/null || sudo -n rm -rf "$SB_DIR/volumes/db/data" "$SB_DIR/volumes/storage"
  cp "$D/supabase.env" "$SB_DIR/.env"; chmod 600 "$SB_DIR/.env"
fi

log "запуск базы"
dc up -d db; wait_healthy 180 || die "база не поднялась"
[ -z "$(psql_db -qAt -c "select to_regclass('public.settings')")" ] || die "база не пустая: восстанавливать можно только на чистый стек (используйте --fresh)"
if [ -s "$D/pgsodium_root.key" ]; then
  log "ключ шифрования Vault"
  docker cp "$D/pgsodium_root.key" supabase-db:/etc/postgresql-custom/pgsodium_root.key
  docker exec -u root supabase-db sh -c 'chown postgres:postgres /etc/postgresql-custom/pgsodium_root.key; chmod 600 /etc/postgresql-custom/pgsodium_root.key'
  dc restart db; wait_healthy 180 || die "база не поднялась после смены ключа"
fi
log "запуск остальных сервисов (создают свои схемы)"
dc up -d; wait_healthy 420 || die "сервисы не поднялись"

log "восстановление данных"
psql_admin -q -f - < "$ROOT/db/prelude.sql"
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --data-only --disable-triggers < "$D/sys.dump" 2> "$W/sys.err" || true
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres < "$D/public.dump" 2> "$W/pub.err" || true
for e in sys pub; do
  n=$(grep -c '^pg_restore: error' "$W/$e.err" || true)
  if [ "$n" != 0 ]; then warn "$e: ошибок $n"; grep '^pg_restore: error' "$W/$e.err" | grep -v 'schema "public" already exists' | head -20 >&2; fi
done
if [ -f "$D/storage.tar.gz" ]; then
  mkdir -p "$SB_DIR/volumes/storage" 2>/dev/null || sudo -n mkdir -p "$SB_DIR/volumes/storage"
  tar -C "$SB_DIR/volumes/storage" -xzf "$D/storage.tar.gz" 2>/dev/null || sudo -n tar -C "$SB_DIR/volumes/storage" -xzf "$D/storage.tar.gz"
fi

log "миграции и расписания"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres" FUNCTIONS_URL="http://functions:9000" "$HERE/migrate.sh" "$ROOT"
dc restart rest storage functions >/dev/null; wait_healthy 180 || true
log "проверка строк:"
psql_db -qAt -c "select 'rows.sales='||(select count(*) from sales)||' rows.repairs='||(select count(*) from repairs)||' rows.customers='||(select count(*) from customers)||' rows.staff='||(select count(*) from staff)"
log "восстановлено. Если менялся сервер — запустите deploy/deploy.sh, чтобы заново выложить CRM и прокси."
