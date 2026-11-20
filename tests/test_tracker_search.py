"""Поиск трекера в форме журнала: разбор запроса, карточка, загрузка данных из приватного репозитория (подставной GitHub), блокировка.
Данные в тесте выдуманные (tests/fixtures/map-sample.json), настоящих данных станции в этом репозитории нет."""
from playwright.sync_api import sync_playwright
from common import *
import json, base64, time, sys

GOOD = 'github_pat_goodtoken1234567890abcd'
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

mock = {'map': True, 'fixes': True, 'log': None, 'n': 0, 'map_gets': 0, 'writes': 0}
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

    # A. разбор запроса
    cases = {'13-87': (13, 87), '13 87': (13, 87), '13/87': (13, 87), '13.87': (13, 87), 'блок 13 трекер 87': (13, 87), 'Блок 13, трекер 87': (13, 87),
             'трекер 87 блок 13': (13, 87), 'BLK13-TRK087': (13, 87), 'blk13 trk87': (13, 87), 'б13 т87': (13, 87), '13б 87т': (13, 87),
             'блок 5': (5, None), 'бл.5': (5, None), 'трекер 87': (None, 87), 'trk087': (None, 87)}
    for q, want in cases.items():
        r = pg.evaluate('q => trkParse(q)', q)
        check('A: «%s»' % q, r and (r.get('block'), r.get('tr')) == want, r)
    check('A: одно число неоднозначно', pg.evaluate("trkParse('45')") == {'any': 45})
    check('A: TCU-045 читается как одно число', pg.evaluate("trkParse('tcu-045')") == {'any': 45})
    for q in ['', 'abc', '1 2 3', '   ']:
        check('A: «%s» не разобрано' % q, pg.evaluate('q => trkParse(q)', q) is None)

    # B. без GitHub поле выключено, объяснение понятное
    if pg.is_visible('#fab'): pg.click('#fab')
    check('B: поле выключено без GitHub', pg.is_disabled('#fTrk'))
    check('B: подсказка про GitHub', 'GitHub' in pg.inner_text('#trkNote'), pg.inner_text('#trkNote'))

    # C. подключаем GitHub, данные станции подтягиваются сами
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', GOOD); pg.fill('#ghPass', 'shift-pass-1'); pg.fill('#ghPass2', 'shift-pass-1')
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js("document.getElementById('loader').hidden")  # пока идёт загрузка, страница заблокирована
    t = time.time()
    while time.time() - t < 8 and not pg.evaluate('!!trkData'): pg.wait_for_timeout(100)
    check('C: данные загружены', pg.evaluate('!!trkData'))
    check('C: блоков и трекеров', pg.evaluate('trkData && [trkData.blocks.size, trkData.total]') == [2, 19], pg.evaluate('trkData && [trkData.blocks.size, trkData.total]'))
    check('C: поправки загружены', pg.evaluate('trkData.fixes.length') == 2)
    pg.evaluate('closeDrawer()')
    if pg.is_visible('#fab'): pg.click('#fab')
    pg.wait_for_selector('#fTrk:not([disabled])', timeout=3000)
    check('C: поле включено', not pg.is_disabled('#fTrk'))
    check('C: в заметке число блоков', 'Данные станции: 2 блока, 19 трекеров' in pg.inner_text('#trkNote').replace(' ', ' '), pg.inner_text('#trkNote'))

    # D. однозначный запрос сразу показывает карточку
    pg.fill('#fTrk', '1-6')
    card = pg.inner_text('#trkCard')
    check('D: карточка видна', pg.is_visible('#trkCard'))
    check('D: заголовок', 'Блок 1 · трекер 6' in card, card)
    check('D: положение', 'ряд 2, колонка 2' in card, card)
    check('D: канал связи', '4242' in card, card)
    check('D: соседи', 'слева 5' in card and 'справа 7' in card and 'выше 2' in card and 'ниже 10' in card, card)
    check('D: зоны', 'внешних 2, внутренних 3, глубинных 7' in card, card)
    check('D: очередь', '2-я очередь' in card, card)
    check('D: список закрыт', not pg.is_visible('#trkList'))
    pg.screenshot(path=OUT + '/trk_card.png')

    # E. блок целиком, запись о блоке с замечанием
    pg.fill('#fTrk', 'блок 2')
    card = pg.inner_text('#trkCard')
    check('E: карточка блока', 'Блок 2' in card and 'номера 1-6' in card and 'полукомплектов 1' in card and '1-я очередь' in card, card)
    check('E: замечание по блоку', 'BLK2-TRK1010' in card and 'не подтверждено' in card, card)

    # F. трекер, которого нет, и подсказка из списка поправок
    pg.fill('#fTrk', '2-110')
    card = pg.inner_text('#trkCard')
    check('F: нет в таблице', 'нет в таблице' in card, card)
    check('F: подсказка про 1010', 'BLK2-TRK1010' in card and 'BLK2-TRK110' in card, card)
    pg.fill('#fTrk', '2-1010')
    check('F: существующий с замечанием', 'ряд 3, колонка 1' in pg.inner_text('#trkCard') and 'не подтверждено' in pg.inner_text('#trkCard'), pg.inner_text('#trkCard'))

    # G. несуществующий блок, непонятный запрос, неоднозначное число
    pg.fill('#fTrk', '99-1')
    check('G: блока 99 нет', 'Блока 99 нет' in pg.inner_text('#trkList') and not pg.is_visible('#trkCard'), pg.inner_text('#trkList'))
    pg.fill('#fTrk', 'ерунда')
    check('G: непонятный запрос', 'Не понял' in pg.inner_text('#trkList'))
    pg.fill('#fTrk', '1')
    lst = pg.inner_text('#trkList')
    check('G: число 1 даёт блок и трекеры', 'Блок 1' in lst and 'Блок 1 · трекер 1' in lst and 'Блок 2 · трекер 1' in lst, lst)
    check('G: карточки ещё нет', not pg.is_visible('#trkCard'))
    pg.fill('#fTrk', '3')
    check('G: трекер 3 есть в двух блоках, блока 3 нет', 'Блок 3' not in pg.inner_text('#trkList').replace('Блок 1 · трекер 3', '').replace('Блок 2 · трекер 3', ''), pg.inner_text('#trkList'))
    pg.fill('#fTrk', '77')
    check('G: трекера 77 нигде нет', 'нет ни в одном блоке' in pg.inner_text('#trkList'), pg.inner_text('#trkList'))

    # H. выбор из списка клавиатурой, Enter не отправляет форму
    before = pg.evaluate('state.entries.length')
    pg.fill('#fTrk', '1')
    pg.press('#fTrk', 'ArrowDown'); pg.press('#fTrk', 'Enter')
    check('H: выбран пункт со стрелкой', pg.is_visible('#trkCard') and pg.input_value('#fTrk').startswith('Блок'), pg.input_value('#fTrk'))
    pg.press('#fTrk', 'Enter')
    check('H: Enter не записал звонок', pg.evaluate('state.entries.length') == before)

    # I. «Подставить в Место»
    pg.fill('#fTrk', '1-6'); pg.click('#trkCard [data-act=fill]')
    check('I: место подставлено', pg.input_value('#fLoc') == 'Блок 1, трекер 6', pg.input_value('#fLoc'))
    check('I: данные записи не тронуты', pg.input_value('#fDev') == '')

    # J. данные станции не попадают в браузерное хранилище и в страницу
    ls = pg.evaluate('JSON.stringify(Object.assign({}, localStorage))') + pg.evaluate('JSON.stringify(Object.assign({}, sessionStorage))')
    check('J: в хранилище браузера данных станции нет', '4242' not in ls and 'scada-map-data' not in ls)
    check('J: в журнале на GitHub данных станции нет', mock['log'] is None or ('4242' not in mock['log'] and 'scada-map-data' not in mock['log']))
    check('J: вёрстка без горизонтальной прокрутки', pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))

    # K. блокировка стирает данные
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhLock')
    check('K: данные стёрты', pg.evaluate('trkData') is None)
    pg.evaluate('closeDrawer()')
    if pg.is_visible('#fab'): pg.click('#fab')
    check('K: поле выключено и пустое', pg.is_disabled('#fTrk') and pg.input_value('#fTrk') == '' and not pg.is_visible('#trkCard'))
    check('K: подсказка про блокировку', 'заблокирован' in pg.inner_text('#trkNote').lower(), pg.inner_text('#trkNote'))

    # L. разблокировка из подсказки возвращает данные
    pg.click('#trkNote [data-act=unlock]'); pg.wait_for_selector('#passDlg:not([hidden])', timeout=5000)
    pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter')
    wait_js("document.getElementById('passDlg').hidden && document.getElementById('loader').hidden", 15000)
    t = time.time()
    while time.time() - t < 15 and not pg.evaluate('!!trkData'): pg.wait_for_timeout(100)
    check('L: данные снова загружены', pg.evaluate('!!trkData'))

    # M. файла нет в репозитории: ошибка понятная, журнал работает, «Повторить» перезагружает
    pg.evaluate('trkClear()')
    mock['map'] = False
    pg.fill('#fTrk', '') if not pg.is_disabled('#fTrk') else None
    pg.evaluate('trkLoad()'); pg.wait_for_timeout(600)
    check('M: ошибка про отсутствующий файл', 'нет файла map/trackers.json' in pg.inner_text('#trkNote'), pg.inner_text('#trkNote'))
    check('M: есть кнопка «Повторить»', pg.is_visible('#trkNote [data-act=retry]'))
    mock['map'] = True
    pg.click('#trkNote [data-act=retry]')
    t = time.time()
    while time.time() - t < 8 and not pg.evaluate('!!trkData'): pg.wait_for_timeout(100)
    check('M: после повтора данные есть', pg.evaluate('!!trkData'))
    n = mock['map_gets']; pg.wait_for_timeout(300)
    check('M: лишних запросов нет', mock['map_gets'] == n)

    # N. узкий экран: карточка помещается
    pg.set_viewport_size({'width': 360, 'height': 740}); pg.wait_for_timeout(200)
    pg.evaluate("openComposer()"); pg.wait_for_timeout(500); pg.fill('#fTrk', '1-6')
    pg.locator('#trkCard').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    check('N: карточка на узком экране', pg.is_visible('#trkCard'))
    check('N: без горизонтальной прокрутки', pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    pg.screenshot(path=OUT + '/trk_card_mobile.png')

    check('нет ошибок в консоли', not errs, errs[:3])
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nВсе проверки поиска трекера пройдены')
sys.exit(1 if fails else 0)
