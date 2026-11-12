#!/usr/bin/env bash
# Проверка, что iCase работает. Код выхода 0 — всё в порядке.
#   healthcheck.sh          — сервер (через домены, с TLS)
#   healthcheck.sh --ci     — проверка в GitHub Actions (http://localhost:8000)
#   healthcheck.sh --cron   — из таймера: при сбое шлёт уведомление в Telegram (если настроен)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
MODE="${1:-}"
FAIL=0; ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }; bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; MSG="${MSG:-}$*; "; }

if [ "$MODE" = "--ci" ]; then API="http://localhost:8000"; CRM=""
else load_env; API="https://$API_DOMAIN"; CRM="https://$CRM_DOMAIN"; fi
ANON=$(sb_get ANON_KEY)
K=(); [ "${HC_INSECURE:-0}" = 1 ] && K=(-k)   # проверка на тестовом стенде с локальным сертификатом
code() { curl -s "${K[@]}" -o /tmp/icase-hc.body -w '%{http_code}' -m 15 "$@"; }

wait_healthy 5 >/dev/null 2>&1 && ok "контейнеры работают" || bad "есть неисправные контейнеры: $(docker ps -a --format '{{.Names}}:{{.Status}}' | grep -E 'unhealthy|Restarting|Exited' | tr '\n' ' ')"

c=$(code -H "apikey: $ANON" "$API/auth/v1/health"); [ "$c" = 200 ] && ok "вход (auth) $c" || bad "auth/v1/health → $c"
c=$(code -H "apikey: $ANON" "$API/rest/v1/settings?select=id")
if [ "$c" = 200 ] && [ "$(cat /tmp/icase-hc.body)" != "[]" ]; then bad "аноним читает settings (RLS/права!)"; else ok "без входа данные закрыты ($c)"; fi
c=$(code "$API/functions/v1/site-api/catalog"); case "$c" in 401|503) ok "функции отвечают ($c)";; *) bad "functions/v1/site-api → $c";; esac
c=$(code -H "apikey: $ANON" "$API/storage/v1/bucket/repair-photos"); case "$c" in 200|400|401|403|404) ok "хранилище отвечает ($c)";; *) bad "storage → $c";; esac

r=$(psql_db -qAt -c "select (select count(*) from cron.job where jobname like 'icase-%')||'|'||(select count(*) from public.icase_migrations)||'|'||coalesce((select public.icase_functions_url()),'')" 2>/dev/null || echo "err")
IFS='|' read -r jobs migs _ <<<"$r"
[ "${jobs:-0}" -ge 2 ] && ok "расписания: $jobs" || bad "расписания не найдены ($r)"
[ "${migs:-0}" -ge 1 ] && ok "миграций учтено: $migs" || bad "нет учёта миграций"
# база достаёт до функций (так работают расписания: выгрузка на сайт, чеки Эвотора)
rid=$(psql_db -qAt -c "select net.http_get(public.icase_functions_url()||'/site-api/catalog')" 2>/dev/null || true)
st=""; for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1; st=$(psql_db -qAt -c "select status_code from net._http_response where id=${rid:-0}" 2>/dev/null || true); [ -n "$st" ] && break; done
case "$st" in 401|503) ok "база достаёт до функций ($st)";; *) bad "база не достаёт до функций (${st:-нет ответа}) — расписания не сработают";; esac
f=$(psql_db -qAt -c "select count(*) from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname like 'icase-%' and d.status='failed' and d.start_time > now()-interval '1 hour'" 2>/dev/null || echo 0)
[ "${f:-0}" -lt 5 ] && ok "сбоев фоновых задач за час: ${f:-0}" || bad "фоновые задачи падают: $f за час"

if [ -n "$CRM" ]; then
  c=$(code "$CRM/"); { [ "$c" = 200 ] && grep -q "iCase" /tmp/icase-hc.body; } && ok "CRM открывается" || bad "CRM → $c"
  c=$(code "$CRM/js/config.js"); grep -q "$API_DOMAIN" /tmp/icase-hc.body && ok "CRM смотрит на $API_DOMAIN" || bad "config.js не указывает на $API_DOMAIN"
  if [ "${HC_INSECURE:-0}" = 1 ]; then ok "сертификат: тестовый стенд, не проверяем"; else
  d=$(echo | openssl s_client -servername "$CRM_DOMAIN" -connect "$CRM_DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$d" ]; then left=$(( ($(date -d "$d" +%s) - $(date +%s)) / 86400 )); [ $left -gt 10 ] && ok "сертификат ещё $left дн." || bad "сертификат истекает через $left дн."; else bad "нет TLS-сертификата"; fi; fi
  last=$(ls -t /var/backups/icase/*.gpg 2>/dev/null | head -1)
  if [ -n "$last" ] && [ $(( $(date +%s) - $(stat -c %Y "$last") )) -lt 93600 ]; then ok "свежий бэкап: $(basename "$last")"; else bad "нет бэкапа за последние сутки"; fi
  u=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "$u" -lt 85 ] && ok "диск занят на $u%" || bad "диск занят на $u%"
  m=$(free | awk '/Mem:/{printf "%d", ($2-$7)*100/$2}'); [ "$m" -lt 92 ] && ok "память занята на $m%" || bad "память занята на $m%"
fi

ST=/run/icase-health.state
if [ $FAIL = 1 ]; then
  # уведомлять при первом сбое и потом не чаще раза в час
  if [ "$MODE" = "--cron" ] && { [ ! -f "$ST" ] || [ -n "$(find "$ST" -mmin +60)" ]; }; then alert "проблемы: $MSG"; date > "$ST"; fi
  exit 1
fi
if [ "$MODE" = "--cron" ] && [ -f "$ST" ]; then alert "снова всё работает"; rm -f "$ST"; fi
exit 0
