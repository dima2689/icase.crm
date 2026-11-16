#!/usr/bin/env bash
# Ставит официальный docker-набор Supabase в $SB_DIR и настраивает его под iCase.
# Повторный запуск безопасен: секреты не перегенерируются, обновляются только настройки из /etc/icase/icase.env.
#   --ci   режим проверки в GitHub Actions: без доменов/SMTP, наружу ничего не публикуется
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
CI_MODE=0; [ "${1:-}" = "--ci" ] && CI_MODE=1

if [ ! -f "$SB_DIR/docker-compose.yml" ]; then
  log "скачиваю Supabase docker ($SB_REF)"
  tmp=$(mktemp -d)
  git clone -q --depth 1 --filter=blob:none --sparse --branch "$SB_REF" https://github.com/supabase/supabase "$tmp/sb"
  (cd "$tmp/sb" && git sparse-checkout set docker)
  mkdir -p "$SB_DIR"; cp -a "$tmp/sb/docker/." "$SB_DIR/"; rm -rf "$tmp"
  echo "$SB_REF" > "$SB_DIR/.supabase-version"
fi
cd "$SB_DIR"
if [ ! -f .env ]; then
  log "генерирую секреты Supabase"
  cp .env.example .env
  sh utils/generate-keys.sh --update-env >/dev/null
  sb_set POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  sb_set DASHBOARD_PASSWORD "$(openssl rand -hex 16)"
  chmod 600 .env
fi

sb_set FUNCTIONS_VERIFY_JWT false          # функции iCase сами проверяют вход
sb_set ENABLE_ANONYMOUS_USERS false
sb_set ENABLE_PHONE_SIGNUP false
sb_set STUDIO_DEFAULT_ORGANIZATION iCase
sb_set STUDIO_DEFAULT_PROJECT iCase

if [ $CI_MODE = 1 ]; then
  sb_set ENABLE_EMAIL_AUTOCONFIRM true
  sb_set DISABLE_SIGNUP false
  exit 0
fi

load_env
mkdir -p "$SB_DIR/icase"; cp "$HERE/Caddyfile" "$SB_DIR/icase/Caddyfile"; cp "$HERE/docker-compose.icase.yml" "$SB_DIR/"
sb_set COMPOSE_FILE docker-compose.yml:docker-compose.icase.yml
sb_set SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
sb_set API_EXTERNAL_URL "https://$API_DOMAIN/auth/v1"
sb_set SITE_URL "$SITE_URL"
sb_set ADDITIONAL_REDIRECT_URLS "$SITE_URL/**"
sb_set CRM_DOMAIN "$CRM_DOMAIN"; sb_set API_DOMAIN "$API_DOMAIN"; sb_set ACME_EMAIL "$ACME_EMAIL"
# на сервере уже работает свой Caddy (служба caddy на 80/443)? Тогда HTTPS делает он, а наш Caddy — только http внутри
if [ -z "${ICASE_EDGE:-}" ] && systemctl is-active --quiet caddy 2>/dev/null; then ICASE_EDGE=host-caddy; fi
if [ "${ICASE_EDGE:-}" = host-caddy ]; then
  sb_set ICASE_HTTP_BIND 127.0.0.1:18090; sb_set ICASE_HTTPS_BIND 127.0.0.1:18091; sb_set ICASE_SITE_SCHEME http
  # короткие адреса CRM (icase-dzr.ru, www.icase-dzr.ru → https://crm.icase-dzr.ru).
  # CRM_ALIASES в icase.env задаёт их явно; без него берём домен без «crm.» и www — но только если DNS уже смотрит
  # на этот сервер (и нет AAAA на чужой адрес): иначе сертификат не выпустится, а чужой сайт перехватывать нельзя
  aliases=""
  if [ -n "${CRM_ALIASES+x}" ]; then cand="$CRM_ALIASES"
  else case "$CRM_DOMAIN" in crm.*) base="${CRM_DOMAIN#crm.}"; cand="$base www.$base";; *) cand="";; esac; fi
  mine=" $(hostname -I 2>/dev/null || true) "
  for a in $cand; do
    v4=$(getent ahostsv4 "$a" 2>/dev/null | awk '{print $1}' | sort -u || true); v6=$(getent ahostsv6 "$a" 2>/dev/null | awk '$1 ~ /:/ && $1 !~ /^::ffff:/ {print $1}' | sort -u || true)
    ok=1; [ -n "$v4" ] || ok=0
    for ip in $v4 $v6; do case "$mine" in *" $ip "*) ;; *) ok=0;; esac; done
    if [ $ok = 1 ]; then aliases="$aliases${aliases:+, }$a"; else log "адрес $a пока не смотрит на этот сервер (A: ${v4:-нет}${v6:+, AAAA: $v6}) — CRM по нему не открываю"; fi
  done
  {
    echo "# iCase CRM — создано deploy/supabase-setup.sh; HTTPS здесь, дальше — Caddy iCase в Docker"
    printf '%s, %s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:18090\n}\n' "$CRM_DOMAIN" "$API_DOMAIN"
    if [ -n "$aliases" ]; then printf '%s {\n\tredir https://%s{uri} permanent\n}\n' "$aliases" "$CRM_DOMAIN"; fi
  } > /etc/caddy/icase.caddy
  if [ -n "$aliases" ]; then log "короткие адреса CRM: $aliases → https://$CRM_DOMAIN"; fi
  if ! grep -qE '^[[:space:]]*import[[:space:]]+/etc/caddy/icase\.caddy' /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-icase
    printf '\nimport /etc/caddy/icase.caddy\n' >> /etc/caddy/Caddyfile
  fi
  if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy
  else
    [ -f /etc/caddy/Caddyfile.before-icase ] && cp /etc/caddy/Caddyfile.before-icase /etc/caddy/Caddyfile
    die "Caddy сервера не принял настройки iCase — его файл возвращён как был"
  fi
  log "HTTPS для $CRM_DOMAIN и $API_DOMAIN — через Caddy сервера (/etc/caddy/icase.caddy)"
else
  sb_set ICASE_HTTP_BIND 80; sb_set ICASE_HTTPS_BIND 443; sb_set ICASE_SITE_SCHEME https
fi
# сотрудники не регистрируются сами: их добавляет владелец (staff-admin), первого — deploy/create-owner.sh
sb_set DISABLE_SIGNUP true
sb_set ENABLE_EMAIL_AUTOCONFIRM false
if [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_PASS:-}" ]; then
  sb_set SMTP_HOST "$SMTP_HOST"; sb_set SMTP_PORT "$SMTP_PORT"; sb_set SMTP_USER "$SMTP_USER"; sb_set SMTP_PASS "$SMTP_PASS"
  sb_set SMTP_ADMIN_EMAIL "$SMTP_ADMIN_EMAIL"; sb_set SMTP_SENDER_NAME "$SMTP_SENDER_NAME"
else
  warn "SMTP не задан: письма входа и сброса пароля отправляться не будут (ссылки входа можно выдавать из CRM)"
fi
mkdir -p "$CRM_DIR"
log "Supabase настроен в $SB_DIR"
