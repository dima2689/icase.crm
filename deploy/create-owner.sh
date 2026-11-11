#!/usr/bin/env bash
# Создаёт первого пользователя-владельца (самостоятельная регистрация на сервере выключена).
#   create-owner.sh owner@example.ru "Имя Фамилия"
# Печатает временный пароль — войдите и смените его в CRM (Профиль → Пароль).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/lib.sh"
EMAIL="${1:?email}"; NAME="${2:-Владелец}"; CI_MODE=0; [ "${3:-}" = "--ci" ] && CI_MODE=1
if [ $CI_MODE = 1 ]; then API="http://localhost:8000"; else load_env; API="https://$API_DOMAIN"; fi
[ -z "$(psql_db -qAt -c "select 1 from public.staff where role='owner' limit 1")" ] || die "владелец уже есть — новых сотрудников добавляет он сам в CRM"
SRV=$(sb_get SERVICE_ROLE_KEY)
PASS="${OWNER_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"
body=$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True,"user_metadata":{"full_name":sys.argv[3]}}))' "$EMAIL" "$PASS" "$NAME")
res=$(curl -fsS -m 20 -X POST "$API/auth/v1/admin/users" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" -H "Content-Type: application/json" -d "$body") \
  || die "не удалось создать пользователя (уже есть такой email?)"
uid=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])' <<<"$res")
psql_db -q -v uid="$uid" -v nm="$NAME" -v em="$EMAIL" <<'SQL'
insert into public.staff(id, full_name, role, email) values (:'uid', :'nm', 'owner', :'em');
insert into public.audit_log(action, ref, details) values ('Создан владелец', :'em', 'deploy/create-owner.sh');
SQL
log "владелец создан: $EMAIL"
[ $CI_MODE = 1 ] || echo "Временный пароль: $PASS   (смените после первого входа)"
