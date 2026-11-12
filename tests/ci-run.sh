#!/usr/bin/env bash
# Обёртка шага CI: при ошибке выводит хвост лога в аннотацию (её видно на странице запуска и через API без входа).
#   tests/ci-run.sh "название" команда [аргументы...]
T="$1"; shift
L=$(mktemp)
"$@" 2>&1 | tee "$L"; rc=${PIPESTATUS[0]}
if [ "$rc" != 0 ]; then
  grep -Ev ' (Container|Volume|Network) |NOTICE: ' "$L" | tail -n 40 | cut -c1-300 | sed -e 's/%/%25/g' -e 's/\r//g' | awk 'BEGIN{ORS="%0A"}{print}' > "$L.e"
  echo "::error title=$T (код $rc)::$(cat "$L.e")"
fi
exit "$rc"
