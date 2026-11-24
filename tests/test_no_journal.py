"""Страница диспетчера скрыта (по умолчанию): главная — карта с поиском трекера, доступ к данным в меню, пароль спрашивается только когда нужна карта; ?journal=1 возвращает журнал.
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
    URL0 = serve_app(journal=False)
    pg.goto(URL0); pg.wait_for_timeout(500)

    mock['log'] = open(FIXTURE, encoding='utf-8').read()  # журнал в репозитории уже есть
    # A. вид по умолчанию
    names = pg.evaluate("[...document.querySelectorAll('#sections .sec')].filter(e => e.offsetParent).map(e => e.textContent.trim())")
    check('A: разделы Карта, SCADA, Учебник (без Журнала)', names == ['Карта', 'SCADA', 'Учебник'], names)
    check('A: главная — карта, отмечен раздел «Карта»', pg.is_visible('#mapView') and pg.evaluate("document.querySelector('#sections .sec.on').textContent.trim()") == 'Карта')
    check('A: журнал, форма звонка и кнопка записи скрыты', not pg.is_visible('main.layout') and not pg.is_visible('#composer') and not pg.is_visible('#fab') and not pg.is_visible('#fileState'))
    check('A: крестика закрытия карты нет', not pg.is_visible('#mapClose'))
    check('A: заголовок страницы про станцию', pg.inner_text('.brand') == 'Карта станции')
    check('A: карта просит подключить GitHub', 'GitHub' in pg.inner_text('#mapMsg'), pg.inner_text('#mapMsg'))
    check('A: подсказка называет вкладку «Доступ к данным»', 'Доступ к данным' in pg.inner_text('#mapMsg'), pg.inner_text('#mapMsg'))
    check('A: поиск пока недоступен', pg.is_disabled('#mapFind'))
    check('A: код журнала на месте (элементы в разметке)', pg.evaluate("!!document.getElementById('composer') && !!document.getElementById('fTrk') && !!document.getElementById('tab-workers')"))
    pg.press('body', 'Escape')
    check('A: Escape карту не закрывает', pg.is_visible('#mapView'))

    # B. меню: только доступ к данным
    pg.click('#btnMenu')
    tabs = pg.evaluate("[...document.querySelectorAll('.tabs [data-tab]')].filter(e => e.offsetParent).map(e => e.textContent.trim())")
    check('B: в меню одна вкладка «Доступ к данным»', tabs == ['Доступ к данным'], tabs)
    check('B: форма GitHub видна', pg.is_visible('#ghForm') and pg.is_visible('#ghRepo'))
    check('B: рабочий файл, Excel и копии скрыты', not pg.is_visible('#btnNewFile') and not pg.is_visible('#btnXlsx') and not pg.is_visible('#btnExport'))
    check('B: работники и настройки формы скрыты', not pg.is_visible('#wForm') and not pg.is_visible('#sTypes'))
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', GOOD); pg.fill('#ghPass', 'shift-pass-1'); pg.fill('#ghPass2', 'shift-pass-1')
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js("document.getElementById('loader').hidden")
    pg.evaluate('closeDrawer()')
    pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)
    check('B: после подключения на главной нарисована схема', pg.locator('#mapSvg .mb').count() == 2)
    check('B: поиск доступен', not pg.is_disabled('#mapFind'))

    # C. поиск трекера на карте
    pg.fill('#mapFind', 'ерунда')
    check('C: непонятный запрос — подсказка, не ошибка', pg.is_visible('#mapFindList') and 'Не понял' in pg.inner_text('#mapFindList'), pg.inner_text('#mapFindList'))
    pg.fill('#mapFind', '1-6')
    check('C: найден трекер 6 блока 1', pg.is_visible('#mapFindList') and 'Блок 1 · трекер 6' in pg.inner_text('#mapFindList'), pg.inner_text('#mapFindList'))
    pg.press('#mapFind', 'Enter')
    check('C: открыта сетка блока 1, трекер 6 выбран', pg.is_visible('#mapBlk') and pg.evaluate("document.querySelector('#mapBlk .tc.sel').dataset.n") == '6' and pg.inner_text('#mapTitle') == 'Блок 1')
    check('C: поле поиска очищено, список закрыт', pg.input_value('#mapFind') == '' and not pg.is_visible('#mapFindList'))
    check('C: в карточке нет кнопки «Подставить в «Место»»', 'Подставить' not in pg.inner_text('#mapCard'), pg.inner_text('#mapCard'))
    pg.fill('#mapFind', 'блок 2')
    pg.click('#mapFindList [data-i="0"]')
    check('C: поиск блока открывает схему поля с выбранным блоком', pg.is_visible('#mapSvg') and pg.evaluate("document.querySelector('#mapSvg .mb.sel').dataset.n") == '2')
    pg.fill('#mapFind', '1-6'); pg.press('#mapFind', 'Escape')
    check('C: Escape в поиске стирает запрос и не закрывает карту', pg.input_value('#mapFind') == '' and pg.is_visible('#mapView'))

    # D. SCADA и возврат на карту
    pg.click('#btnScada')
    check('D: раздел SCADA открыт, про сверку угла нет, планы есть', pg.is_visible('#scadaView') and 'В планах' in pg.inner_text('#scadaView') and 'Расчёт угла' not in pg.inner_text('#scadaView') and not pg.is_visible('#scadaClose'))
    pg.press('body', 'Escape')
    check('D: Escape из SCADA возвращает на карту', not pg.is_visible('#scadaView') and pg.is_visible('#mapView'))
    pg.click('#btnScada'); pg.click('#btnMap')
    check('D: кнопка «Карта» возвращает на карту', pg.is_visible('#mapView') and not pg.is_visible('#scadaView'))

    # E. блокировка и перезагрузка: пароль спрашивается только когда нужна карта
    pg.click('#btnMenu'); pg.click('#btnGhLock'); pg.evaluate('closeDrawer()')
    check('E: после блокировки карта остаётся главной и предлагает разблокировать', pg.is_visible('#mapView') and pg.is_visible('#mapMsg [data-act=unlock]') and not pg.is_visible('#mapSvg'))
    pg.reload(); pg.wait_for_timeout(1200)
    check('E: после перезагрузки окно пароля само не появляется', not pg.is_visible('#passDlg'))
    check('E: на странице видно кнопку «Разблокировать»', pg.is_visible('#mapMsg [data-act=unlock]'), pg.inner_text('#mapMsg'))
    pg.click('#mapMsg [data-act=unlock]'); pg.wait_for_selector('#passDlg:not([hidden])', timeout=5000)
    pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter')
    pg.wait_for_selector('#mapSvg:not([hidden])', timeout=10000)
    check('E: после пароля карта загрузилась', pg.locator('#mapSvg .mb').count() == 2)
    check('E: в журнал на GitHub ничего не записывалось', mock['writes'] == 0, mock['writes'])

    # F. журнал можно вернуть адресом ?journal=1
    pg.goto(URL0 + '?journal=1'); pg.wait_for_timeout(1500)
    if pg.is_visible('#passDlg'):
        pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter'); pg.wait_for_timeout(1500)
    names = pg.evaluate("[...document.querySelectorAll('#sections .sec')].filter(e => e.offsetParent).map(e => e.textContent.trim())")
    check('F: с ?journal=1 вернулись журнал и все четыре раздела', pg.is_visible('main.layout') and pg.is_visible('#composer') and names == ['Журнал', 'Карта', 'SCADA', 'Учебник'], names)
    check('F: заголовок снова «Журнал диспетчера»', pg.inner_text('.brand') == 'Журнал диспетчера')

    check('нет ошибок в консоли', not errs, errs[:3])
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nВсе проверки скрытой страницы диспетчера пройдены')
sys.exit(1 if fails else 0)
