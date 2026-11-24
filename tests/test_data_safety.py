"""Данные из приватного репозитория не могут запустить чужой код, а скрытый журнал не трогает scada-log.json.
1. В map/trackers.json вместо чисел подложен HTML: карточка блока и трекера показывает нули, кода на странице нет.
2. Страница диспетчера скрыта: после пароля к scada-log.json нет ни одного запроса, и карта открывается, даже если этот файл испорчен.
Данные выдуманные (tests/fixtures/), настоящих данных станции здесь нет."""
from playwright.sync_api import sync_playwright
from common import *
import json, base64, time, sys

GOOD = 'github_pat_goodtoken1234567890abcd'
LAYOUT = open(os.path.join(HERE, 'fixtures', 'map-field-sample.json'), encoding='utf-8').read()
data = json.loads(open(os.path.join(HERE, 'fixtures', 'map-sample.json'), encoding='utf-8').read())
PWN = '<img src=x onerror="window.__pwn=1">'
b1 = data['blocks'][0]
b1.update({'outer': PWN, 'inner': '<b id="pwn2">x</b>', 'deep': -5, 'half': 2.5, 'grid_cols': '<i id="pwn3">', 'phase': '<u id="pwn4">', 'freq': PWN, 'id_range': PWN})
SAMPLE = json.dumps(data, ensure_ascii=False)

fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)
def wait_js(expr, timeout=8000):
    t = time.time()
    while time.time() - t < timeout / 1000:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)

hits = {'log': 0}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,if-none-match,accept',
        'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-expose-headers': 'ETag'}
def handler(route, request):
    if request.method == 'OPTIONS': route.fulfill(status=204, headers=CORS); return
    url = request.url.split('?')[0]
    def js(status, obj):
        h = dict(CORS); h['content-type'] = 'application/json'
        route.fulfill(status=status, headers=h, body=json.dumps(obj))
    if request.headers.get('authorization', '') != 'Bearer ' + GOOD: js(401, {'message': 'Bad credentials'}); return
    base = 'https://api.github.com/repos/o/r'
    enc = lambda t: base64.encodebytes(t.encode()).decode()
    if url == base: js(200, {'private': True, 'permissions': {'push': True}, 'default_branch': 'main'}); return
    if url == base + '/contents/scada-log.json':
        hits['log'] += 1  # испорченный журнал: если бы карта зависела от него, она бы не открылась
        js(200, {'type': 'file', 'sha': 'bad', 'size': 9, 'content': enc('не json {'), 'encoding': 'base64'}); return
    files = {'map/trackers.json': SAMPLE, 'map/field.json': LAYOUT}
    for name, body in files.items():
        if url == base + '/contents/' + name and request.method == 'GET':
            js(200, {'type': 'file', 'sha': name, 'size': len(body), 'content': enc(body), 'encoding': 'base64'}); return
    js(404, {'message': 'Not Found'})

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860})
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.route('https://api.github.com/**', handler)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(serve_app(journal=False)); pg.wait_for_timeout(500)

    # подключение на скрытой странице диспетчера
    pg.click('#btnMenu')
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', GOOD); pg.fill('#ghPass', 'shift-pass-1'); pg.fill('#ghPass2', 'shift-pass-1')
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js("document.getElementById('loader').hidden")
    pg.evaluate('closeDrawer()')
    pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)
    check('скрытый журнал: карта открылась, хотя scada-log.json испорчен', pg.locator('#mapSvg .mb').count() == 2)
    check('скрытый журнал: к scada-log.json ни одного запроса', hits['log'] == 0, hits['log'])
    pg.click('#btnMenu')
    check('скрытый журнал: в меню написано, что данные станции загружены', 'данные станции загружены' in pg.inner_text('#ghInfo'), pg.inner_text('#ghInfo'))
    pg.evaluate('closeDrawer()')

    # карточка блока с подложенным HTML
    pg.fill('#mapFind', 'блок 1'); pg.press('#mapFind', 'Enter'); pg.wait_for_timeout(400)
    card = pg.inner_text('#mapCard')
    check('карточка блока открылась', 'Блок 1' in card, card[:80])
    check('зоны ветра: вместо HTML нули', 'внешних 0, внутренних 0, глубинных 0' in card, card)
    pg.fill('#mapFind', '1-6'); pg.press('#mapFind', 'Enter'); pg.wait_for_timeout(400)
    card = pg.inner_text('#mapCard')
    check('карточка трекера открылась', 'трекер 6' in card, card[:80])
    check('канал связи показан как текст', '<img' in pg.inner_text('#mapCard') or 'onerror' in card, card[:200])
    pg.wait_for_timeout(300)
    check('подложенный код не выполнился', pg.evaluate('window.__pwn') is None)
    check('подложенных элементов на странице нет', pg.evaluate("!document.querySelector('#pwn2,#pwn3,#pwn4') && !document.querySelector('#mapView img, #mapCard img')"))

    check('нет ошибок в консоли', not errs, errs[:3])
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nFAILED: none')
sys.exit(1 if fails else 0)
