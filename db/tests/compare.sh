#!/usr/bin/env bash
# Сравнивает схему базы с отпечатком рабочей (db/tests/fingerprint.prod.md5).
#   PSQL="docker exec -i supabase-db psql -U postgres -d postgres" db/tests/compare.sh
# Печатает строки, которых нет в рабочей базе (лишние/изменённые здесь), и число строк, которых здесь не хватает.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
PSQL="${PSQL:-docker exec -i supabase-db psql -U postgres -d postgres}"
$PSQL -qAt -v ON_ERROR_STOP=1 -f - < "$D/fingerprint.sql" > /tmp/fp.lines
python3 - "$D/fingerprint.prod.md5" /tmp/fp.lines <<'PY'
import sys,hashlib
prod={l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')}
lines=[l.rstrip('\n') for l in open(sys.argv[2]) if l.strip()]
h={hashlib.md5(l.encode()).hexdigest()[:10]:l for l in lines}
extra=[h[k] for k in sorted(h) if k not in prod]; missing=sorted(prod-set(h))
print(f"строк здесь: {len(lines)}, в рабочей: {len(prod)}")
for l in extra: print("  + "+l[:220])
if missing: print("  не хватает (хэши строк рабочей базы): "+" ".join(missing))
sys.exit(1 if extra or missing else 0)
PY
