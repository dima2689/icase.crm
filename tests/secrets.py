#!/usr/bin/env python3
"""Ищет в репозитории секретные ключи: JWT с ролью service_role и новые ключи sb_secret_."""
import base64, json, pathlib, re, sys
JWT = re.compile(r'eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}')
bad = []
for p in pathlib.Path('.').rglob('*'):
    if not p.is_file() or '.git' in p.parts or p.stat().st_size > 5_000_000: continue
    try: t = p.read_text(errors='ignore')
    except Exception: continue
    if re.search(r'sb_secret_[A-Za-z0-9]{10,}', t): bad.append(f'{p}: sb_secret_')
    for m in JWT.finditer(t):
        s = m.group(1); s += '=' * (-len(s) % 4)
        try: role = json.loads(base64.urlsafe_b64decode(s)).get('role')
        except Exception: continue
        if role not in ('anon', None): bad.append(f'{p}: JWT role={role}')
print('\n'.join(bad) or 'секретных ключей не найдено'); sys.exit(1 if bad else 0)
