#!/usr/bin/env bash
# Выкладка версии iCase на сервер. Запускается из корня распакованной версии (её кладёт GitHub Actions):
#   sudo deploy/deploy.sh            — бэкап → миграции → функции → CRM → прокси → проверка
#   deploy/deploy.sh --ci            — то же без бэкапа и прокси (проверка в GitHub Actions)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"; . "$HERE/lib.sh"
CI_MODE=0; [ "${1:-}" = "--ci" ] && CI_MODE=1
CIF=(); [ $CI_MODE = 1 ] && CIF=(--ci)
VER="${ICASE_VERSION:-$(cat "$ROOT/VERSION" 2>/dev/null || date +%Y%m%d%H%M)}"

if [ $CI_MODE = 0 ]; then
  load_env
  log "версия $VER: бэкап перед выкладкой"
  "$HERE/backup.sh" --local --tag "pre-$VER"
fi

log "конфигурация Supabase"
"$HERE/supabase-setup.sh" "${CIF[@]}"

log "функции"
FN_DIR="$SB_DIR/volumes/functions"
for d in "$ROOT"/supabase/functions/*/; do
  n=$(basename "$d"); [ "$n" = tests ] && continue
  rm -rf "$FN_DIR/$n.new"; cp -a "$d" "$FN_DIR/$n.new"; rm -rf "${FN_DIR:?}/${n:?}"; mv "$FN_DIR/$n.new" "$FN_DIR/$n"
done

log "запуск сервисов"
dc up -d --remove-orphans
wait_healthy 420 && wait_db 120 || die "сервисы не поднялись"
dc restart functions >/dev/null; wait_healthy 120 || die "функции не поднялись"

log "миграции базы"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres" FUNCTIONS_URL="http://functions:9000" "$HERE/migrate.sh" "$ROOT"

log "приложение CRM"
ANON=$(sb_get ANON_KEY)
API_URL="${API_URL:-https://${API_DOMAIN:-localhost:8000}}"
[ $CI_MODE = 1 ] && API_URL="${API_URL_CI:-http://localhost:8000}"
OUT="${CRM_DIR}"; mkdir -p "$(dirname "$OUT")"
STAGE="$OUT.new"; rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -a "$ROOT"/index.html "$ROOT"/styles.css "$ROOT"/sw.js "$ROOT"/manifest*.webmanifest "$STAGE/"
cp -a "$ROOT"/icons "$ROOT"/js "$STAGE/"
cat > "$STAGE/js/config.js" <<CFG
/* Создано при выкладке ($VER). Публичный (anon) ключ: без входа сотрудника данных не даёт. */
window.ICASE_CONFIG = {
  supabaseUrl: "$API_URL",
  supabaseKey: "$ANON",
  version: "$VER"
};
CFG
# новая версия service worker → телефоны и кассы подхватят обновление сами
sed -i -E "s/const VER=\"([^\"]+)\"/const VER=\"\1-$VER\"/" "$STAGE/sw.js"
if [ -d "$OUT" ]; then rm -rf "$OUT.old"; mv "$OUT" "$OUT.old"; fi
mv "$STAGE" "$OUT"

if [ $CI_MODE = 0 ]; then
  cp "$HERE/Caddyfile" "$SB_DIR/icase/Caddyfile"
  docker exec icase-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || dc restart caddy
  echo "$VER" > /opt/icase/CURRENT
fi

log "проверка"
"$HERE/healthcheck.sh" "${CIF[@]}" || { alert "выкладка $VER: проверка не прошла"; die "проверка не прошла"; }
log "готово: версия $VER"
