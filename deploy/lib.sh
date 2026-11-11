# shellcheck shell=bash
# Общие функции скриптов iCase (подключается через `. lib.sh`).
SB_DIR="${SB_DIR:-/opt/icase/supabase}"     # проект Supabase (docker compose)
ICASE_ENV="${ICASE_ENV:-/etc/icase/icase.env}"
CRM_DIR="${CRM_DIR:-/srv/icase/crm}"
SB_REF="${SB_REF:-self-hosted/v0.8.4}"      # версия официального docker-набора Supabase

log()  { printf '\033[1;34m[icase]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[icase]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[icase]\033[0m %s\n' "$*" >&2; exit 1; }

load_env() {
  [ -f "$ICASE_ENV" ] || die "нет $ICASE_ENV (образец: deploy/icase.env.example)"
  set -a
  # shellcheck disable=SC1090
  . "$ICASE_ENV"
  set +a
  SITE_URL="${SITE_URL:-https://$CRM_DOMAIN}"
}
sb_get() { grep -m1 "^$1=" "$SB_DIR/.env" | cut -d= -f2-; }
# записать KEY=VALUE в .env Supabase (заменить, если есть)
sb_set() {
  local k="$1" v="$2" f="$SB_DIR/.env"
  if grep -q "^$k=" "$f"; then
    python3 - "$f" "$k" "$v" <<'PY'
import sys
f,k,v=sys.argv[1:]
L=open(f).read().split('\n')
L=[(k+'='+v) if l.startswith(k+'=') else l for l in L]
open(f,'w').write('\n'.join(L))
PY
  else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}
dc() { (cd "$SB_DIR" && docker compose --progress quiet "$@"); }
psql_db() { docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_admin() { docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
alert() {
  [ -n "${ALERT_TG_TOKEN:-}" ] && [ -n "${ALERT_TG_CHAT:-}" ] || return 0
  curl -fsS -m 10 "https://api.telegram.org/bot$ALERT_TG_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ALERT_TG_CHAT" --data-urlencode "text=iCase $(hostname): $*" >/dev/null || true
}
wait_healthy() {  # дождаться, пока все контейнеры проекта станут healthy/running
  local t=0 lim="${1:-300}" bad
  while [ $t -lt "$lim" ]; do
    bad=$(docker ps -a --filter "label=com.docker.compose.project=$(basename "$SB_DIR")" --format '{{.Names}} {{.Status}}' \
          | grep -E 'starting|unhealthy|Restarting|Exited|Created' || true)
    [ -z "$bad" ] && return 0
    sleep 5; t=$((t+5))
  done
  echo "$bad" >&2; return 1
}
wait_db() {  # база принимает запросы (образ Supabase после первого старта ещё раз перезапускает Postgres)
  local t=0 ok=0
  while [ $t -lt "${1:-180}" ]; do
    if docker exec supabase-db psql -U postgres -d postgres -qAt -c 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ $ok -ge 3 ] && return 0; else ok=0; fi
    sleep 3; t=$((t+3))
  done
  return 1
}
