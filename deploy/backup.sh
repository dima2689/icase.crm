#!/usr/bin/env bash
# Резервная копия iCase: база (данные CRM + сотрудники + секреты Vault), фото ремонта, ключи и настройки.
# Всё шифруется паролем BACKUP_PASSPHRASE (gpg AES-256) и отправляется в S3, если он настроен.
#   backup.sh                 — ночная копия (таймер icase-backup), локально + S3
#   backup.sh --local --tag X — только локально (перед выкладкой)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
LOCAL=0; TAG=nightly
while [ $# -gt 0 ]; do case "$1" in --local) LOCAL=1; shift;; --tag) TAG="$2"; shift 2;; *) die "неизвестный параметр $1";; esac; done
[ -f "$ICASE_ENV" ] && load_env
: "${BACKUP_PASSPHRASE:?задайте BACKUP_PASSPHRASE в $ICASE_ENV}"
BK_DIR="${BACKUP_DIR:-/var/backups/icase}"; mkdir -p "$BK_DIR"; chmod 700 "$BK_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx supabase-db; then warn "база не запущена — бэкап пропущен"; exit 0; fi
if [ -z "$(psql_db -qAt -c "select to_regclass('public.settings')")" ]; then warn "база пустая — бэкап пропущен"; exit 0; fi

STAMP=$(date +%Y%m%d-%H%M%S); NAME="icase-$STAMP-$TAG"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; mkdir "$W/$NAME"; D="$W/$NAME"

log "дамп базы"
docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc -n public > "$D/public.dump"
docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc --data-only \
  -t auth.users -t auth.identities -t auth.mfa_factors -t storage.buckets -t storage.objects -t vault.secrets > "$D/sys.dump"
docker exec supabase-db sh -c 'cat /etc/postgresql-custom/pgsodium_root.key 2>/dev/null' > "$D/pgsodium_root.key" || true
log "файлы хранилища"
if [ -d "$SB_DIR/volumes/storage" ]; then tar -C "$SB_DIR/volumes/storage" -czf "$D/storage.tar.gz" .; fi
cp "$SB_DIR/.env" "$D/supabase.env"
[ -f "$ICASE_ENV" ] && cp "$ICASE_ENV" "$D/icase.env"
{
  echo "created=$(date -Is)"; echo "host=$(hostname)"; echo "version=$(cat /opt/icase/CURRENT 2>/dev/null || echo '?')"
  echo "supabase=$(cat "$SB_DIR/.supabase-version" 2>/dev/null || echo '?')"
  psql_db -qAt -c "select 'rows.'||t||'='||n from (values ('sales',(select count(*) from sales)),('repairs',(select count(*) from repairs)),('customers',(select count(*) from customers)),('products',(select count(*) from products)),('staff',(select count(*) from staff))) v(t,n)"
} > "$D/manifest.txt"

OUT="$BK_DIR/$NAME.tar.gpg"
tar -C "$W" -cf - "$NAME" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 -o "$OUT" 3<<<"$BACKUP_PASSPHRASE"
chmod 600 "$OUT"
log "готово: $OUT ($(du -h "$OUT" | cut -f1))"

# локально: 7 ночных и 5 предвыкладочных
ls -t "$BK_DIR"/icase-*-nightly.tar.gpg 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -t "$BK_DIR"/icase-*-pre-*.tar.gpg 2>/dev/null | tail -n +6 | xargs -r rm -f

if [ $LOCAL = 0 ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ]; then
  export RCLONE_CONFIG_ICS3_TYPE=s3 RCLONE_CONFIG_ICS3_PROVIDER=Other RCLONE_CONFIG_ICS3_ENDPOINT="$S3_ENDPOINT" \
         RCLONE_CONFIG_ICS3_REGION="${S3_REGION:-}" RCLONE_CONFIG_ICS3_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
         RCLONE_CONFIG_ICS3_SECRET_ACCESS_KEY="$S3_SECRET_KEY" RCLONE_CONFIG_ICS3_NO_CHECK_BUCKET=true
  log "отправка в S3 ($S3_BUCKET)"
  if rclone copyto "$OUT" "ics3:$S3_BUCKET/daily/$NAME.tar.gpg" --s3-no-check-bucket -q; then
    [ "$(date +%u)" = 7 ] && rclone copyto "$OUT" "ics3:$S3_BUCKET/weekly/$NAME.tar.gpg" -q
    rclone delete "ics3:$S3_BUCKET/daily" --min-age "${BACKUP_KEEP_DAYS:-14}d" -q || true
    rclone delete "ics3:$S3_BUCKET/weekly" --min-age "$(( ${BACKUP_KEEP_WEEKS:-8} * 7 ))d" -q || true
  else
    alert "бэкап не отправлен в S3"; die "не удалось отправить бэкап в S3"
  fi
fi
