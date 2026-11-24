"""Схема поля (уровень 1): загрузка из приватного репозитория (подставной GitHub), блоки, карточка, связь с поиском трекера, блокировка.
Данные выдуманные (tests/fixtures/map-sample.json и map-field-sample.json), настоящих данных станции здесь нет."""
from playwright.sync_api import sync_playwright
from common import *
import json, base64, time, sys

GOOD = 'github_pat_goodtoken1234567890abcd'
LAYOUT = open(os.path.join(HERE, 'fixtures', 'map-field-sample.json'), encoding='utf-8').read()
SAMPLE = open(os.path.join(HERE, 'fixtures', 'map-sample.json'), encoding='utf-8').read()
FIXES = json.dumps({"app": "scada-map-corrections", "version": 1, "items": [
    {"id": "c1", "block": 2, "found": "BLK2-TRK1010", "proposed": "BLK2-TRK110", "status": "proposed"},
    {"id": "c9", "block": 1, "found": "заголовок листа", "proposed": "считать 12", "status": "proposed"}]})
fails = []
def wait_js(expr, timeout=8000):
    t = time.time()
    while time.time() - t < timeout / 1000:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

mock = {'layout': True, 'map': True, 'fixes': True, 'log': None, 'n': 0, 'map_gets': 0, 'writes': 0}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,if-none-match,accept',
        'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-expose-headers': 'ETag'}
def handler(route, request):
    if request.method == 'OPTIONS': route.fulfill(status=204, headers=CORS); return
    url = request.url.split('?')[0]
    def js(status, obj, extra=None):
        h = dict(CORS); h['content-type'] = 'application/json'
        if extra: h.update(extra)
        route.fulfill(status=status, headers=h, body=json.dumps(obj))
    if request.headers.get('authorization', '') != 'Bearer ' + GOOD: js(401, {'message': 'Bad credentials'}); return
    base = 'https://api.github.com/repos/o/r'
    enc = lambda t: base64.encodebytes(t.encode()).decode()
    if url == base: js(200, {'private': True, 'permissions': {'push': True}, 'default_branch': 'main'}); return
    if url == base + '/contents/scada-log.json':
        if request.method == 'GET':
            if mock['log'] is None: js(404, {'message': 'Not Found'}); return
            js(200, {'type': 'file', 'sha': 's%d' % mock['n'], 'size': len(mock['log']), 'content': enc(mock['log']), 'encoding': 'base64'}, {'etag': 'W/"e%d"' % mock['n']}); return
        b = json.loads(request.post_data); mock['log'] = base64.b64decode(b['content']).decode(); mock['n'] += 1; mock['writes'] += 1
        js(200, {'content': {'sha': 's%d' % mock['n'], 'size': len(mock['log'])}}); return
    if url == base + '/contents/map/trackers.json' and request.method == 'GET':
        mock['map_gets'] += 1
        if not mock['map']: js(404, {'message': 'Not Found'}); return
        js(200, {'type': 'file', 'sha': 'm1', 'size': len(SAMPLE), 'content': enc(SAMPLE), 'encoding': 'base64'}); return
    if url == base + '/contents/map/field.json' and request.method == 'GET':
        if not mock['layout']: js(404, {'message': 'Not Found'}); return
        js(200, {'type': 'file', 'sha': 'l1', 'size': len(LAYOUT), 'content': enc(LAYOUT), 'encoding': 'base64'}); return
    if url == base + '/contents/map/corrections.json' and request.method == 'GET':
        if not mock['fixes']: js(404, {'message': 'Not Found'}); return
        js(200, {'type': 'file', 'sha': 'f1', 'size': len(FIXES), 'content': enc(FIXES), 'encoding': 'base64'}); return
    js(404, {'message': 'Not Found'})

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860})
    ctx.add_init_script(ME_SCRIPT)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.route('https://api.github.com/**', handler)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(serve_app()); pg.wait_for_timeout(300)

    # A. без GitHub: кнопка есть, схема объясняет, что нужно
    check('A: кнопка «Карта» в шапке', pg.is_visible('#btnMap'))
    pg.click('#btnMap')
    check('A: схема открылась', pg.is_visible('#mapView'))
    check('A: подсказка про GitHub', 'GitHub' in pg.inner_text('#mapMsg'), pg.inner_text('#mapMsg'))
    check('A: рисунка нет', not pg.is_visible('#mapSvg'))
    pg.press('body', 'Escape')
    check('A: Escape закрывает', not pg.is_visible('#mapView'))

    # B. подключаем GitHub
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', GOOD); pg.fill('#ghPass', 'shift-pass-1'); pg.fill('#ghPass2', 'shift-pass-1')
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js("document.getElementById('loader').hidden")
    pg.evaluate('closeDrawer()')
    pg.click('#btnMap'); pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)
    check('B: нарисовано 2 блока', pg.locator('#mapSvg .mb').count() == 2, pg.locator('#mapSvg .mb').count())
    check('B: очередь и канал на блоке', '4242' in pg.evaluate("document.getElementById('mapSvg').textContent"))
    check('B: блок 1 — 2-я очередь, блок 2 — 1-я', pg.evaluate("[...document.querySelectorAll('#mapSvg .mb')].map(g => g.classList.contains('ph2') ? 2 : g.classList.contains('ph1') ? 1 : 0)") == [2, 1])
    check('B: блок 2 не подтверждён', pg.evaluate("document.querySelectorAll('#mapSvg .mb.uncertain').length") == 1 and pg.is_visible('#mapUnsure'))
    check('B: дороги и ящики нарисованы', pg.locator('#mapSvg .rd rect').count() == 2 and pg.locator('#mapSvg .bx').count() == 2)
    check('B: у блока 1 три ряда клеток в заливке', pg.evaluate("document.querySelector('#mapSvg .mb[data-n=\"1\"] .fl').getAttribute('d').split('M').length - 1") == 3)
    check('B: контур блока 1 есть', len(pg.evaluate("document.querySelector('#mapSvg .mb[data-n=\"1\"] .ed').getAttribute('d')")) > 10)
    check('B: вход на схеме', 'Тестовый вход' in pg.evaluate("document.getElementById('mapSvg').textContent"))
    check('B: подпись «не масштаб»', 'не масштаб' in pg.inner_text('#mapView'))
    check('B: карточки пока нет', not pg.is_visible('#mapCard'))

    # C. выбор блока
    pg.click('#mapSvg .mb[data-n="2"]')
    card = pg.inner_text('#mapCard')
    check('C: карточка блока 2', pg.is_visible('#mapCard') and 'Блок 2' in card and '4343' in card and '1-я очередь' in card, card)
    check('C: блок отмечен', pg.evaluate("document.querySelector('#mapSvg .mb.sel').dataset.n") == '2')
    check('C: нет кнопки «Показать на схеме» внутри схемы', not pg.is_visible('#mapCard [data-act=map]'))
    check('C: у неподтверждённого блока есть пометка', 'не подтверждено' in pg.inner_text('#mapCard'), pg.inner_text('#mapCard'))
    pg.focus('#mapSvg .mb[data-n="1"]'); pg.keyboard.press('Enter')
    check('C: выбор с клавиатуры', 'Блок 1' in pg.inner_text('#mapCard'))
    pg.screenshot(path=OUT + '/field_map.png')

    # D. подставить в «Место» закрывает схему
    pg.click('#mapCard [data-act=fill]')
    check('D: схема закрылась', not pg.is_visible('#mapView'))
    check('D: место подставлено', pg.input_value('#fLoc') == 'Блок 1', pg.input_value('#fLoc'))

    # E. из поиска трекера: сразу открывается сетка блока
    if pg.is_visible('#fab') and not pg.is_visible('#fTrk'): pg.click('#fab')
    pg.fill('#fTrk', '1-6')
    check('E: в карточке трекера есть «Показать на схеме»', pg.is_visible('#trkCard [data-act=map]'))
    pg.click('#trkCard [data-act=map]')
    check('E: открыт блок 1, трекер 6 выбран', pg.is_visible('#mapBlk') and pg.evaluate("document.querySelector('#mapBlk .tc.sel').dataset.n") == '6' and pg.inner_text('#mapTitle') == 'Блок 1')
    check('E: карточка про трекер', 'трекер 6' in pg.inner_text('#mapCard') and 'ряд 2, колонка 2' in pg.inner_text('#mapCard'), pg.inner_text('#mapCard'))
    check('E: в сетке 12 трекеров', pg.locator('#mapBlk .tc').count() == 12)
    check('E: соседи подсвечены (5, 7, 2, 10)', sorted(pg.evaluate("[...document.querySelectorAll('#mapBlk .tc.nb')].map(g => +g.dataset.n)")) == [2, 5, 7, 10])
    check('E: кнопка «Вся схема» видна, поле скрыто', pg.is_visible('#mapBack') and not pg.is_visible('#mapSvg'))
    pg.screenshot(path=OUT + '/field_block.png')

    # E2. выбор другого трекера кликом и стрелками
    pg.click('#mapBlk .tc[data-n="11"]')
    check('E2: выбран 11', pg.evaluate("document.querySelector('#mapBlk .tc.sel').dataset.n") == '11' and 'трекер 11' in pg.inner_text('#mapCard'))
    pg.press('#mapBlk .tc.sel', 'ArrowLeft')
    check('E2: стрелка влево — фокус на 10', pg.evaluate("document.activeElement.dataset.n") == '10')
    pg.press('#mapBlk .tc[data-n="10"]', 'Enter')
    check('E2: Enter выбирает 10', pg.evaluate("document.querySelector('#mapBlk .tc.sel').dataset.n") == '10')

    # E3. «Вся схема» и Escape
    pg.click('#mapBack')
    check('E3: вернулись к схеме поля, блок 1 отмечен', pg.is_visible('#mapSvg') and not pg.is_visible('#mapBlk') and pg.evaluate("document.querySelector('#mapSvg .mb.sel').dataset.n") == '1' and pg.inner_text('#mapTitle') == 'Схема поля')
    check('E3: на схеме метка выбранного трекера (10) на месте', pg.locator('#mapSvg .pin circle').count() == 1 and pg.evaluate("document.querySelector('#mapSvg .pin circle').getAttribute('cx')") == '12.5' and pg.evaluate("document.querySelector('#mapSvg .pin circle').getAttribute('cy')") == '42.5')
    pg.click('#mapSvg .mb[data-n="2"]'); pg.click('#mapCard [data-act=zoom]')
    check('E3: «Открыть блок» показывает блок 2 без выбранного трекера', pg.is_visible('#mapBlk') and pg.locator('#mapBlk .tc').count() == 7 and pg.locator('#mapBlk .tc.sel').count() == 0 and 'Блок 2' in pg.inner_text('#mapCard'))
    check('E3: ящик связи нарисован в свободной ячейке', pg.locator('#mapBlk .tb').count() == 1)
    check('E3: пустое место не нарисовано трекером', pg.locator('#mapBlk .tc').count() == 7)
    pg.press('body', 'Escape')
    check('E3: Escape возвращает к схеме, не закрывая её', pg.is_visible('#mapView') and pg.is_visible('#mapSvg'))
    pg.press('body', 'Escape')
    check('E3: второй Escape закрывает', not pg.is_visible('#mapView'))

    # F. данные не попадают в хранилище и журнал
    ls = pg.evaluate('JSON.stringify(Object.assign({}, localStorage))') + pg.evaluate('JSON.stringify(Object.assign({}, sessionStorage))')
    check('F: в хранилище браузера схемы нет', 'scada-map-field' not in ls and 'Тестовый вход' not in ls)
    check('F: в журнале на GitHub схемы нет', mock['log'] is None or 'scada-map-layout' not in mock['log'])

    # G. блокировка закрывает схему и стирает данные
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhLock')
    check('G: данные схемы стёрты', pg.evaluate('mapLayout') is None and pg.evaluate('trkData') is None)
    pg.evaluate('closeDrawer()')
    pg.click('#btnMap')
    check('G: схема просит разблокировать', 'заблокирован' in pg.inner_text('#mapMsg').lower() and pg.is_visible('#mapMsg [data-act=unlock]') and not pg.is_visible('#mapSvg'), pg.inner_text('#mapMsg'))
    pg.click('#mapMsg [data-act=unlock]'); pg.wait_for_selector('#passDlg:not([hidden])', timeout=5000)
    pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter')
    wait_js("document.getElementById('passDlg').hidden && document.getElementById('loader').hidden", 15000)
    pg.wait_for_selector('#mapView:not([hidden])', timeout=3000) if False else None
    pg.click('#btnMap') if not pg.is_visible('#mapView') else None
    pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)
    check('G: после разблокировки схема есть', pg.locator('#mapSvg .mb').count() == 2)

    # H. файла схемы нет: понятная ошибка, «Повторить» работает
    pg.click('#mapClose'); pg.evaluate('trkClear()'); mock['layout'] = False
    pg.click('#btnMap'); pg.wait_for_timeout(700)
    check('H: ошибка про файл', 'нет файла map/field.json' in pg.inner_text('#mapMsg'), pg.inner_text('#mapMsg'))
    check('H: поиск трекера при этом работает', pg.evaluate('!!trkData'))
    mock['layout'] = True
    pg.click('#mapMsg [data-act=retry]'); pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)
    check('H: после повтора схема есть', pg.locator('#mapSvg .mb').count() == 2)

    # I. телефон
    pg.click('#mapClose')
    pg.set_viewport_size({'width': 360, 'height': 740}); pg.wait_for_timeout(200)
    check('I: шапка помещается', pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    pg.click('#btnMap'); pg.wait_for_selector('#mapSvg:not([hidden])', timeout=5000)
    pg.click('#mapSvg .mb[data-n="1"]'); pg.wait_for_timeout(300)
    check('I: карточка видна', pg.is_visible('#mapCard'))
    pg.click('#mapCard [data-act=zoom]'); pg.wait_for_timeout(300)
    check('I: сетка блока на телефоне видна и листается вбок', pg.is_visible('#mapBlk') and pg.evaluate("document.getElementById('mapScroll').scrollWidth >= document.getElementById('mapScroll').clientWidth"))
    check('I: страница не уехала вбок при сетке', pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    pg.screenshot(path=OUT + '/field_block_mobile.png')
    pg.click('#mapBack')
    check('I: страница под схемой не уехала вбок', pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    pg.screenshot(path=OUT + '/field_map_mobile.png')

    check('нет ошибок в консоли', not errs, errs[:3])
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nВсе проверки схемы поля пройдены')
sys.exit(1 if fails else 0)
