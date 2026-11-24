"""Быстрые проверки файла до запуска браузера: не пустой, нет мусора вместо кода, скрипт без синтаксических ошибок, нет секретов."""
import re, subprocess, sys, tempfile, os
from common import *

fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

s = open(APP, encoding='utf-8').read()
check('index.html не пустой (больше 50 КБ)', len(s) > 50000, len(s))
check('начинается с doctype', s.lstrip().lower().startswith('<!doctype html>'))
check('заканчивается </html>', s.rstrip().endswith('</html>'))
check('нет пути file:/// вместо кода', 'file:///' not in s[:500])
scripts = re.findall(r'<script>(.*?)</script>', s, re.S)
check('один встроенный скрипт', len(scripts) == 1, len(scripts))
js = os.path.join(OUT, 'page.js'); open(js, 'w', encoding='utf-8').write(scripts[0] if scripts else '')
r = subprocess.run(['node', '--check', js], capture_output=True, text=True)
check('скрипт без синтаксических ошибок', r.returncode == 0, r.stderr[:300])
check('нет внешних скриптов и стилей', not re.search(r'<script[^>]+src=|<link[^>]+href=', s))
check('Content-Security-Policy на месте', 'Content-Security-Policy' in s and "connect-src https://api.github.com" in s)
import base64, hashlib
csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', s)
csp = csp.group(1) if csp else ''
script_src = re.search(r"script-src ([^;]*)", csp)
script_src = script_src.group(1).strip() if script_src else ''
check("в script-src нет 'unsafe-inline'", "'unsafe-inline'" not in script_src, script_src[:60])
want = "'sha256-" + base64.b64encode(hashlib.sha256((scripts[0] if scripts else '').encode('utf-8')).digest()).decode() + "'"
check('хеш в CSP совпадает со скриптом (иначе браузер его не запустит)', script_src == want, script_src[:60] + ' / нужно ' + want[:30])
if os.path.abspath(APP) == os.path.abspath(os.path.join(HERE, '..', 'index.html')):
    r = subprocess.run([sys.executable, os.path.join(HERE, '..', 'build.py'), '--check'], capture_output=True, text=True)
    check('index.html собран из src/ (python build.py)', r.returncode == 0, (r.stdout + r.stderr).strip()[:200])
check('нет токенов GitHub в файле', not re.search(r'github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}', s))
check('нет номеров телефонов', not re.search(r'\b998\d{9}\b', s))
print('\nFAILED:', fails if fails else 'none')
sys.exit(1 if fails else 0)
