"""Запускает все проверки в браузере Chromium. Код выхода 1, если что-то не прошло.
Использование: python tests/run_all.py   (APP=путь/к/index.html, если нужно проверить другой файл)"""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
failed = []
for name in ['test_syntax.py', 'test_ui.py', 'test_rules.py', 'test_features.py', 'test_solar.py', 'test_github.py']:
    print('\n=== ' + name + ' ===', flush=True)
    r = subprocess.run([sys.executable, os.path.join(HERE, name)], capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if line.startswith(('PASS', 'FAIL', 'FAILED')) or ('Traceback' in line and r.returncode != 0):
            print(line[:240])
    ok = r.returncode == 0 and 'FAIL ' not in out
    m = re.search(r'^FAILED: (.*)$', out, re.M)
    if m and m.group(1).strip() != 'none':
        ok = False
    if not ok:
        failed.append(name)
print('\nИТОГ:', 'всё прошло' if not failed else 'не прошло: ' + ', '.join(failed))
sys.exit(1 if failed else 0)
