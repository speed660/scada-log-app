"""Проверки раздела «Учебник»: шифровальщик, страница входа, защита от утечки открытого текста в самой странице."""
from playwright.sync_api import sync_playwright
from common import *
import base64, functools, http.server, json, os, shutil, sys, threading, time

REPO = os.path.abspath(os.path.join(HERE, '..'))
SRC = os.path.join(REPO, 'uchebnik')
FIX = os.path.join(HERE, 'fixtures', 'book-sample.html')
MARK = 'ТЕСТОВЫЙ-МАРКЕР-ОТКРЫТОГО-ТЕКСТА'
PW = 'тестовый пароль из пяти слов'
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

# синтаксис встроенных скриптов обеих страниц и отсутствие внешних подключений
import re, subprocess
for n in ('index.html', 'encrypt.html'):
    t = open(os.path.join(SRC, n), encoding='utf-8').read()
    sc = re.findall(r'<script>(.*?)</script>', t, re.S)
    js = os.path.join(OUT, n + '.js'); open(js, 'w', encoding='utf-8').write('\n'.join(sc))
    r = subprocess.run(['node', '--check', js], capture_output=True, text=True)
    check(n + ': один скрипт без синтаксических ошибок', len(sc) == 1 and r.returncode == 0, r.stderr[:200])
    check(n + ': нет внешних скриптов, стилей и адресов', not re.search(r'<script[^>]+src=|<link[^>]+href=|https?://', t))

ROOT = os.path.join(OUT, 'site'); U = os.path.join(ROOT, 'uchebnik'); os.makedirs(U)
for n in ('index.html', 'encrypt.html'):
    shutil.copy(os.path.join(SRC, n), U)

class Q(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
GATE = BASE + '/uchebnik/index.html'

def until(pg, js, timeout=30):
    """Ждёт, пока выражение станет истинным. Строковый eval на страницах с CSP запрещён, поэтому опрашиваем через evaluate."""
    end = time.time() + timeout
    while time.time() < end:
        if pg.evaluate('() => !!(' + js + ')'): return True
        time.sleep(0.15)
    return False

def unlock(pg, password):
    pg.fill('#pw', password); pg.click('#go')

with sync_playwright() as p:
    br = p.chromium.launch()

    # ---------- ссылка из журнала ----------
    for w, wide in ((1280, False), (360, False), (360, True), (320, True)):
        c = br.new_context(viewport={'width': w, 'height': 800}); j = c.new_page(); j.goto('file://' + APP + '?journal=1')
        if wide: j.add_style_tag(content="html,body,button,input,select,textarea{font-family:'DejaVu Sans',sans-serif !important}")  # самый широкий из обычных шрифтов, как на сервере проверок
        tag = f'{w} px' + (', широкий шрифт' if wide else '')
        check(f'журнал: ссылка «Учебник» в шапке видна и ведёт в uchebnik/ ({tag})', j.is_visible('#linkBook') and j.get_attribute('#linkBook', 'href') == 'uchebnik/')
        over = j.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f'журнал: шапка не вылезает за экран ({tag})', over <= 0, over)
        h = j.evaluate("() => document.querySelector('.top').getBoundingClientRect().height")
        nav = j.evaluate("() => document.querySelector('#sections').getBoundingClientRect().height")
        check(f'журнал: верхняя строка шапки не раздулась ({tag})', h - nav < 80, round(h - nav))
        check(f'журнал: шапка вместе с полосой разделов не выше 130 px ({tag})', h < 130, round(h))
        c.close()

    # ---------- шифровальщик ----------
    ctx = br.new_context(accept_downloads=True); pg = ctx.new_page()
    reqs = []; pg.on('request', lambda r: reqs.append(r.url))
    pg.goto(BASE + '/uchebnik/encrypt.html')
    csp = pg.get_attribute('meta[http-equiv="Content-Security-Policy"]', 'content')
    check('шифровальщик: сеть запрещена (connect-src none)', "connect-src 'none'" in csp, csp)
    check('шифровальщик: кнопка выключена без файла и пароля', pg.is_disabled('#go'))
    pg.set_input_files('#file', FIX); pg.check('#saved')
    pg.fill('#pw1', 'короткий'); pg.fill('#pw2', 'короткий')
    check('шифровальщик: короткий пароль не принимается', pg.is_disabled('#go') and 'Слишком короткий' in pg.inner_text('#strength'), pg.inner_text('#strength'))
    pg.fill('#pw1', 'aaaaaaaaaaaaaaaa'); pg.fill('#pw2', 'aaaaaaaaaaaaaaaa')
    check('шифровальщик: пароль из одинаковых знаков не принимается', pg.is_disabled('#go'))
    pg.fill('#pw1', PW); pg.fill('#pw2', PW + 'x')
    check('шифровальщик: разные пароли блокируют кнопку', pg.is_disabled('#go') and 'не совпадают' in pg.inner_text('#status'))
    pg.fill('#pw2', PW)
    check('шифровальщик: хороший пароль включает кнопку', not pg.is_disabled('#go'))
    pg.click('#go')
    pg.wait_for_selector('#dlRow:not([hidden])', timeout=60000)
    check('шифровальщик: после проверки сообщает «Готово»', 'Готово' in pg.inner_text('#status'), pg.inner_text('#status'))
    with pg.expect_download() as d: pg.click('#dl')
    enc_path = os.path.join(U, 'book.enc'); d.value.save_as(enc_path)
    check('шифровальщик: файл называется book.enc', d.value.suggested_filename == 'book.enc', d.value.suggested_filename)
    raw = open(enc_path, encoding='utf-8').read(); j = json.loads(raw)
    check('book.enc: нужные поля и 600000 итераций', j['app'] == 'solar-uchebnik' and j['v'] == 1 and j['kdf']['iter'] == 600000 and j['enc']['name'] == 'AES-GCM' and j['gz'] is True)
    check('book.enc: открытого текста нет', MARK not in raw and base64.b64encode(MARK.encode()).decode() not in raw and 'Аварии' not in raw)
    check('шифровальщик: ни одного запроса за пределы своей страницы', all(u.startswith(BASE) or u.startswith('blob:') or u.startswith('data:') for u in reqs), [u for u in reqs if not u.startswith(BASE)])
    ctx.close()

    # ---------- страница входа ----------
    # нет файла документа
    os.rename(enc_path, enc_path + '.bak')
    ctx = br.new_context(); pg = ctx.new_page(); pg.goto(GATE)
    check('вход: нет book.enc, написано «ещё не загружен», формы нет', until(pg, "document.getElementById('msg').textContent.includes('ещё не загружен')") and not pg.is_visible('#f'))
    ctx.close(); os.rename(enc_path + '.bak', enc_path)

    ctx = br.new_context(); pg = ctx.new_page()
    errs = []; pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(GATE)
    gcsp = pg.get_attribute('meta[http-equiv="Content-Security-Policy"]', 'content')
    check('вход: CSP разрешает только свой сервер', "connect-src 'self'" in gcsp and "default-src 'none'" in gcsp, gcsp)
    check('вход: noindex', 'noindex' in pg.get_attribute('meta[name="robots"]', 'content'))
    pg.wait_for_selector('#f:not([hidden])', timeout=15000)
    check('вход: до пароля текста документа на странице нет', MARK not in pg.content())
    unlock(pg, 'неправильный пароль 123')
    check('вход: неверный пароль даёт ошибку', until(pg, "document.getElementById('msg').classList.contains('err')") and 'Неверный пароль' in pg.inner_text('#msg'), pg.inner_text('#msg'))
    check('вход: после ошибки документ не показан', pg.query_selector('#home') is None and MARK not in pg.content())
    pg.wait_for_selector('#go:not([disabled])', timeout=15000)
    unlock(pg, PW)
    check('вход: верный пароль открывает документ', until(pg, "document.getElementById('home') && document.getElementById('home').classList.contains('on')", 60), pg.title())
    check('документ: заголовок вкладки из самого документа', pg.title() == 'Тестовый учебник', pg.title())
    check('документ: скрипты документа работают (язык переключается и запоминается)', (pg.click('#lang') or True) and pg.evaluate("() => document.documentElement.getAttribute('data-lang')") == 'uz' and pg.evaluate("() => localStorage.getItem('solar-lang')") == 'uz')
    check('документ: сеть запрещена защитой (даже на свой сервер)', until(pg, "window.__net === 'blocked'", 10), pg.evaluate('() => window.__net'))
    check('документ: CSP и referrer добавлены в голову', pg.evaluate("() => !!document.querySelector('head meta[http-equiv=\"Content-Security-Policy\"]') && !!document.querySelector('meta[name=referrer][content=no-referrer]')"))
    pg.evaluate("() => { location.hash = '#faults'; }")
    check('документ: переход по разделам внутри работает', until(pg, "document.getElementById('faults').classList.contains('on')", 5))
    # перезагрузка в той же вкладке: пароль второй раз не спрашивают
    pg.reload()
    check('вход: после перезагрузки вкладки пароль не спрашивают', until(pg, "document.getElementById('home')", 60) and pg.query_selector('#f') is None)
    ctx.close()

    # новая вкладка/браузер: пароль нужен снова; глубокая ссылка работает
    ctx = br.new_context(); pg = ctx.new_page(); pg.goto(GATE + '#faults')
    pg.wait_for_selector('#f:not([hidden])', timeout=15000)
    check('вход: в новом окне пароль спрашивают снова', pg.is_visible('#pw'))
    unlock(pg, PW)
    check('вход: ссылка #faults после пароля открывает нужный раздел', until(pg, "document.getElementById('faults') && document.getElementById('faults').classList.contains('on')", 60))
    ctx.close()

    # повреждённые файлы
    good = json.loads(open(enc_path, encoding='utf-8').read())
    def serve_variant(name, body, expect_text, expect_form):
        c = br.new_context(); g = c.new_page()
        g.route('**/book.enc', lambda r: r.fulfill(status=200, content_type='application/json', body=body))
        g.goto(GATE)
        if expect_form:
            g.wait_for_selector('#f:not([hidden])', timeout=15000); unlock(g, PW)
        ok = until(g, "document.getElementById('msg').classList.contains('err')", 30)
        text = g.inner_text('#msg') if ok else ''
        check(name, ok and expect_text in text and g.query_selector('#home') is None, text)
        c.close()
    ct = bytearray(base64.b64decode(good['ct'])); ct[10] ^= 1
    bad = dict(good); bad['ct'] = base64.b64encode(bytes(ct)).decode()
    serve_variant('вход: изменённый шифртекст не открывается', json.dumps(bad), 'Неверный пароль или файл повреждён', True)
    serve_variant('вход: не JSON вместо файла', 'это не json', 'повреждён', False)
    huge = json.loads(json.dumps(good)); huge['kdf']['iter'] = 999999999
    serve_variant('вход: огромное число итераций отклоняется сразу', json.dumps(huge), 'повреждён', False)
    wrongapp = json.loads(json.dumps(good)); wrongapp['v'] = 2
    serve_variant('вход: неизвестная версия формата отклоняется', json.dumps(wrongapp), 'повреждён', False)
    br.close()
srv.shutdown()
print('\nFAILED:', fails if fails else 'none')
sys.exit(1 if fails else 0)
