"""DC-ящики на сетке блока, их поиск и масштаб схемы.
Данные выдуманные: tests/fixtures/map-sample.json, map-field-sample.json и dc-sample.json; настоящих данных станции здесь нет."""
from playwright.sync_api import sync_playwright
from common import *
import json, base64, time, sys

GOOD = 'github_pat_goodtoken1234567890abcd'
FILES = {name: open(os.path.join(HERE, 'fixtures', f), encoding='utf-8').read() for name, f in
         [('map/trackers.json', 'map-sample.json'), ('map/field.json', 'map-field-sample.json'), ('map/dc.json', 'dc-sample.json')]}
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
    if url == base: js(200, {'private': True, 'permissions': {'push': True}, 'default_branch': 'main'}); return
    for name, body in FILES.items():
        if url == base + '/contents/' + name:
            js(200, {'type': 'file', 'sha': name, 'size': len(body), 'content': base64.b64encode(body.encode()).decode(), 'encoding': 'base64'}); return
    js(404, {'message': 'Not Found'})

vb = lambda sel='#mapSvg': [float(x) for x in pg.get_attribute(sel, 'viewBox').split()]
base = lambda sel='#mapSvg': [float(x) for x in pg.get_attribute(sel, 'data-base').split()]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860})
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.route('https://api.github.com/**', handler)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(serve_app(journal=False)); pg.wait_for_timeout(400)
    pg.click('#btnMenu')
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', GOOD); pg.fill('#ghPass', 'shift-pass-1'); pg.fill('#ghPass2', 'shift-pass-1')
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js("document.getElementById('loader').hidden")
    pg.evaluate('closeDrawer()')
    pg.wait_for_selector('#mapSvg:not([hidden])', timeout=8000)

    # A. масштаб схемы поля
    check('A: кнопки масштаба видны', pg.is_visible('#mapZoomIn') and pg.is_visible('#mapZoomOut') and pg.is_visible('#mapFit'))
    check('A: при открытии поле целиком', vb() == base(), (vb(), base()))
    check('A: «Всё поле» и «−» выключены, пока поле целиком', pg.is_disabled('#mapFit') and pg.is_disabled('#mapZoomOut'))
    w0 = vb()[2]
    pg.click('#mapZoomIn')
    check('A: «+» приближает', vb()[2] < w0 * 0.7, vb())
    pg.click('#mapZoomOut')
    check('A: «−» отдаляет обратно', abs(vb()[2] - w0) < 0.01, vb())
    box = pg.locator('#mapSvg').bounding_box()
    pg.mouse.move(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.5); pg.mouse.wheel(0, -400); pg.wait_for_timeout(200)
    check('A: колесо мыши приближает', vb()[2] < w0 * 0.9, vb())
    x_before = vb()[0]
    pg.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5); pg.mouse.down()
    pg.mouse.move(box['x'] + box['width'] * 0.5 + 120, box['y'] + box['height'] * 0.5, steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    check('A: перетаскивание сдвигает схему', vb()[0] < x_before - 0.5, (x_before, vb()[0]))
    check('A: после перетаскивания блок не выбран', not pg.is_visible('#mapCard'))
    pg.keyboard.press('0'); pg.wait_for_timeout(100)
    pg.click('#mapFit')
    check('A: «Всё поле» возвращает поле целиком', vb() == base())
    hs = pg.evaluate("[document.querySelector('#mapSvg .mb .num').getBoundingClientRect().height, document.querySelector('#mapSvg .mb .fr').getBoundingClientRect().height]")
    check('A: номер блока на экране не крупнее ~16 px, канал ~11 px', 0 < hs[0] <= 22 and 0 < hs[1] <= 16, hs)
    pg.click('#mapZoomIn'); pg.click('#mapZoomIn')
    hs2 = pg.evaluate("document.querySelector('#mapSvg .mb .num').getBoundingClientRect().height")
    check('A: при приближении подпись не раздувается', hs2 <= 22, hs2)
    pg.click('#mapFit')

    # B. поиск DC-ящика с точкой: и ящик, и трекер
    pg.fill('#mapFind', '1.02'); pg.wait_for_timeout(200)
    items = pg.inner_text('#mapFindList')
    check('B: «1.02» — сначала DC-ящик, потом трекер', items.find('DC-ящик 02') >= 0 and items.find('трекер 2') > items.find('DC-ящик 02'), items)
    pg.press('#mapFind', 'Enter'); pg.wait_for_selector('#mapBlk:not([hidden])', timeout=5000)
    check('B: открыта сетка блока 1', pg.inner_text('#mapTitle') == 'Блок 1')
    check('B: на сетке три DC-ящика, мусорные записи отброшены', pg.locator('#mapBlk .dcm').count() == 3 and pg.evaluate("!document.getElementById('pwn')"), pg.locator('#mapBlk .dcm').count())
    check('B: ящик 02 выбран', pg.evaluate("document.querySelector('#mapBlk .dcm.sel').dataset.dc") == '02')
    own = pg.evaluate("[...document.querySelectorAll('#mapBlk .tc.dco')].map(g => +g.dataset.n).sort((a,b)=>a-b)")
    check('B: подсвечены трекеры ящика 02', own == [3, 4, 7, 8, 11, 12], own)
    card = pg.inner_text('#mapCard')
    check('B: карточка ящика', 'DC-ящик 02' in card and '6: 3–4, 7–8, 11–12' in card and 'у трекера 8' in card and '±1' not in card, card)
    check('B: кнопка «Весь блок» в сетке', pg.inner_text('#mapFit') == 'Весь блок')
    pg.click('#mapBlk .dcm[data-dc="02"]'); pg.wait_for_timeout(150)
    check('B: повторный клик по ящику снимает выбор', pg.locator('#mapBlk .dcm.sel').count() == 0 and pg.locator('#mapBlk .tc.dco').count() == 0)
    pg.click('#mapBlk .dcm[data-dc="03"]'); pg.wait_for_timeout(150)
    check('B: клик по другому ящику выбирает его', 'DC-ящик 03' in pg.inner_text('#mapCard'))
    pg.click('#mapBlk .tc[data-n="6"]'); pg.wait_for_timeout(150)
    check('B: в карточке трекера виден его DC-ящик', 'DC-ящик' in pg.inner_text('#mapCard') and '1.01' in pg.inner_text('#mapCard'), pg.inner_text('#mapCard'))
    pg.click('#mapZoomIn'); w1 = vb('#mapBlk')[2]
    check('B: сетку блока тоже можно приближать', w1 < base('#mapBlk')[2] * 0.7, w1)

    # C. явное слово «дс»: только ящик; примерное место из вектора
    pg.fill('#mapFind', 'дс 2 01'); pg.wait_for_timeout(200)
    items = pg.inner_text('#mapFindList')
    check('C: «дс 2 01» — только DC-ящик', 'DC-ящик 01' in items and pg.locator('#mapFindList .opt').count() == 1, items)
    pg.press('#mapFind', 'Enter'); pg.wait_for_selector('#mapBlk .dcm.sel', timeout=5000)
    check('C: метка примерного ящика пунктиром', pg.evaluate("document.querySelector('#mapBlk .dcm.sel').classList.contains('approx')"))
    card = pg.inner_text('#mapCard')
    check('C: в карточке сказано, что место примерное', '±1 трекер' in card and 'примерное' in card, card)
    pg.fill('#mapFind', 'дс 1 05'); pg.wait_for_timeout(200)
    check('C: несуществующий ящик — подсказка', 'нет DC-ящика 05' in pg.inner_text('#mapFindList'), pg.inner_text('#mapFindList'))
    pg.fill('#mapFind', '1.01.03'); pg.wait_for_timeout(200)
    check('C: номер стринга ведёт к ящику', 'DC-ящик 01' in pg.inner_text('#mapFindList') and 'стринг 03' in pg.inner_text('#mapFindList'), pg.inner_text('#mapFindList'))
    pg.fill('#mapFind', '')

    # D. карточка блока на схеме поля
    pg.click('#mapBack'); pg.wait_for_selector('#mapSvg:not([hidden])', timeout=5000)
    pg.locator('#mapSvg .mb[data-n="1"]').dispatch_event('click'); pg.wait_for_timeout(150)
    check('D: в карточке блока число DC-ящиков', 'DC-ящики' in pg.inner_text('#mapCard') and '3' in pg.inner_text('#mapCard'), pg.inner_text('#mapCard'))

    check('нет ошибок в консоли', not errs, errs[:3])
    b.close()

print('\nFAILED: ' + ', '.join(fails) if fails else '\nFAILED: none')
sys.exit(1 if fails else 0)
