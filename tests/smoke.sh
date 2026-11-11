#!/usr/bin/env bash
# Сквозная проверка живого стека (в GitHub Actions после выкладки):
# вход владельца, чтение под владельцем, RPC, хранилище, staff-admin, закрытость для анонима.
#   API=http://localhost:8000 ANON=... EMAIL=... PASS=... tests/smoke.sh
set -euo pipefail
: "${API:?}" "${ANON:?}" "${EMAIL:?}" "${PASS:?}"
F=0; ok(){ echo "  ✓ $*"; }; bad(){ echo "  ✗ $*"; F=1; }
j(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

TOK=$(curl -fsS "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | j 'd["access_token"]') && ok "вход владельца" || { bad "вход не удался"; exit 1; }
H=(-H "apikey: $ANON" -H "Authorization: Bearer $TOK")

r=$(curl -fsS "${H[@]}" "$API/rest/v1/staff?select=role"); [[ "$r" == *owner* ]] && ok "владелец видит сотрудников" || bad "staff: $r"
c=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST -H "Content-Type: application/json" -d '{}' "$API/rest/v1/rpc/staff_touch"); [[ "$c" == 20* ]] && ok "RPC staff_touch $c" || bad "RPC staff_touch $c"
r=$(curl -fsS "${H[@]}" "$API/rest/v1/settings?select=shop_name"); [[ "$r" == *iCase* ]] && ok "настройки читаются" || bad "settings: $r"
r=$(curl -s "${H[@]}" -X POST -H "Content-Type: application/json" -d '{"name":"Smoke-точка"}' -H "Prefer: return=representation" "$API/rest/v1/points"); [[ "$r" == *Smoke* ]] && ok "запись (точка) создаётся" || bad "points insert: $r"

printf '\xff\xd8\xff\xe0smoke' > /tmp/smoke.jpg
c=$(curl -s -o /tmp/st.out -w '%{http_code}' "${H[@]}" -H "Content-Type: image/jpeg" --data-binary @/tmp/smoke.jpg "$API/storage/v1/object/repair-photos/smoke/test.jpg")
[ "$c" = 200 ] && ok "фото загружается в repair-photos" || bad "storage upload $c $(cat /tmp/st.out)"
c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Content-Type: image/jpeg" --data-binary @/tmp/smoke.jpg "$API/storage/v1/object/repair-photos/smoke/anon.jpg")
[[ "$c" == 4* ]] && ok "аноним не загружает фото ($c)" || bad "аноним загрузил фото ($c)"

r=$(curl -s "${H[@]}" -H "Content-Type: application/json" -d '{"action":"list"}' "$API/functions/v1/staff-admin"); [[ "$r" == *"$EMAIL"* ]] && ok "staff-admin отвечает владельцу" || bad "staff-admin: ${r:0:200}"
c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"action":"list"}' "$API/functions/v1/staff-admin"); [[ "$c" == 4* ]] && ok "staff-admin без входа — $c" || bad "staff-admin без входа — $c"

for t in customers sales repairs staff points; do
  r=$(curl -s -H "apikey: $ANON" "$API/rest/v1/$t?select=*&limit=1"); [[ "$r" == "[]" || "$r" == *code* || "$r" == *message* ]] && ok "аноним: $t закрыта" || bad "аноним читает $t: ${r:0:120}"
done
c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -X POST -H "Content-Type: application/json" -d '{}' "$API/rest/v1/rpc/staff_touch"); [[ "$c" == 4* ]] && ok "аноним не вызывает RPC ($c)" || bad "аноним вызвал RPC ($c)"
c=$(curl -s -o /dev/null -w '%{http_code}' "$API/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"x@y.ru","password":"Passw0rd!x"}')
echo "  · регистрация: $c (на сервере должна быть выключена)"
exit $F
