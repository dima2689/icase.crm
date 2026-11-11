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
