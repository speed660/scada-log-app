from playwright.sync_api import sync_playwright
from common import *
import json, sys, base64, time

F = APP
GOOD = 'github_pat_goodtoken1234567890abcd'
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

mock = {'exists': False, 'text': '', 'n': 0, 'puts': 0, 'gets': 0, 'c409': 0, 'hang': False, 'abort': False,
        'private': True, 'inject_on_put': None, 'inspect': None, 'inspected': None}
def sha(): return f'sha{mock["n"]}'
def etag(): return f'W/"e{mock["n"]}"'
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,if-none-match,accept',
        'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-expose-headers': 'ETag,X-RateLimit-Remaining,Retry-After,X-RateLimit-Reset'}

def other_dispatcher_writes(eid):
    d = json.loads(mock['text']) if mock['exists'] else {'app': 'scada-log', 'version': 4, 'settings': None, 'workers': [], 'entries': []}
    d['entries'].append({"id": eid, "createdAt": "2026-10-13T06:10:00.000Z", "linkedTo": "", "closedBy": "", "deleted": False,
        "ts": "2026-10-13T06:10:00.000Z", "workerId": "", "callerName": "Другой", "callerPhone": "", "deviceType": "Инвертор",
        "location": "5", "device": "INV-5", "action": "Остановка", "angle": None, "open": True, "restore": False,
        "origState": "", "notes": "", "updatedAt": "2026-10-13T06:10:05.000Z"})
    mock['text'] = json.dumps(d); mock['exists'] = True; mock['n'] += 1

def handler(route, request):
    if request.method == 'OPTIONS':
        route.fulfill(status=204, headers=CORS); return
    if mock['hang']: return
    if mock['abort']:
        route.abort('connectionrefused'); return
    if mock['inspect'] and mock['inspected'] is None:
        mock['inspected'] = pg_ref[0].evaluate("({inert: document.querySelector('main.layout').inert && document.querySelector('#fab').inert, loader: !document.getElementById('loader').hidden})")
    url = request.url.split('?')[0]
    auth = request.headers.get('authorization', '')
    def js(status, obj, extra=None):
        h = dict(CORS); h['content-type'] = 'application/json'
        if extra: h.update(extra)
        route.fulfill(status=status, headers=h, body=json.dumps(obj))
    if auth != 'Bearer ' + GOOD:
        js(401, {'message': 'Bad credentials'}); return
    if url == 'https://api.github.com/repos/o/r':
        js(200, {'private': mock['private'], 'permissions': {'push': True}, 'default_branch': 'main'}); return
    if url == 'https://api.github.com/repos/o/r/contents/scada-log.json':
        if request.method == 'GET':
            mock['gets'] += 1
            if not mock['exists']: js(404, {'message': 'Not Found'}); return
            if request.headers.get('if-none-match') == etag():
                route.fulfill(status=304, headers={**CORS, 'etag': etag()}); return
            body = {'type': 'file', 'sha': sha(), 'size': len(mock['text'].encode()), 'content': base64.encodebytes(mock['text'].encode()).decode(), 'encoding': 'base64'}
            js(200, body, {'etag': etag()}); return
        if request.method == 'PUT':
            if mock['inject_on_put']:
                other_dispatcher_writes(mock['inject_on_put']); mock['inject_on_put'] = None
            b = json.loads(request.post_data)
            ok = (b.get('sha') == sha()) if mock['exists'] else ('sha' not in b)
            if not ok:
                mock['c409'] += 1
                js(409, {'message': 'does not match'}); return
            mock['text'] = base64.b64decode(b['content']).decode(); mock['exists'] = True; mock['n'] += 1; mock['puts'] += 1
            js(200, {'content': {'sha': sha()}}); return
    js(404, {'message': 'Not Found'})

pg_ref = [None]
def wait_js(expr, timeout=8000):
    t = time.time()
    while time.time() - t < timeout / 1000:
        if pg_ref[0].evaluate(expr): return True
        pg_ref[0].wait_for_timeout(100)
    raise TimeoutError(expr)
def remote_ids():
    return [e['id'] for e in json.loads(mock['text'])['entries']] if mock['exists'] else []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860})
    ctx.add_init_script(ME_SCRIPT)
    pg = ctx.new_page(); pg_ref[0] = pg
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.route('https://api.github.com/**', handler)
    dialogs = []
    def on_dialog(d):
        dialogs.append(d.message); (d.accept() if mock.get('accept', True) else d.dismiss())
    pg.on('dialog', on_dialog)
    pg.goto('file://' + F); pg.wait_for_timeout(300)

    # A. импорт одной записи, открываем вкладку «Данные»
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.set_input_files('#importInput', '' + FIXTURE + ''); pg.wait_for_timeout(200)
    check('A: 1 entry imported', pg.evaluate('state.entries.length') == 1)
    check('A: github form visible', pg.is_visible('#ghForm') and not pg.is_visible('#ghOn'))

    # B. неверный токен: ошибка в загрузчике, интерфейс заблокирован, «Отмена» всё возвращает
    pg.fill('#ghRepo', 'o/r'); pg.fill('#ghToken', 'bad-token-xxxxxxxxxxxxxxxxxxxx'); pg.fill('#ghPass','shift-pass-1'); pg.fill('#ghPass2','shift-pass-1')
    mock['inspect'] = True; mock['inspected'] = None
    pg.click('#btnGhConnect')
    pg.wait_for_selector('#loaderBtns:not([hidden])', timeout=5000)
    check('B: loader shown with error', 'Токен' in pg.inner_text('#loaderErr'), pg.inner_text('#loaderErr'))
    check('B: UI blocked during request', mock['inspected'] and mock['inspected']['inert'] and mock['inspected']['loader'], mock['inspected'])
    check('B: UI still inert while error shown', pg.evaluate("document.querySelector('main.layout').inert"))
    pg.screenshot(path=OUT + '/gh_loader_error.png')
    pg.click('#loaderClose')
    check('B: loader closed, UI free', pg.evaluate("document.getElementById('loader').hidden && !document.querySelector('main.layout').inert"))
    check('B: not connected', pg.evaluate('gh.cfg') is None and pg.evaluate("localStorage.getItem('scadalog.gh')") is None)

    # N. публичный репозиторий: предупреждение, отказ
    mock['private'] = False; mock['accept'] = False
    pg.fill('#ghToken', GOOD); pg.fill('#ghPass','shift-pass-1'); pg.fill('#ghPass2','shift-pass-1'); pg.click('#btnGhConnect'); pg.wait_for_timeout(600)
    check('N: public repo warning shown', any('публичный' in d for d in dialogs), dialogs)
    check('N: public repo not connected', pg.evaluate('gh.cfg') is None and pg.is_hidden('#loader'))
    mock['private'] = True; mock['accept'] = True

    # C. успешное подключение: файла в репозитории нет, создаётся из локальных данных
    pg.fill('#ghToken', GOOD); pg.fill('#ghPass','shift-pass-1'); pg.fill('#ghPass2','shift-pass-1'); mock['inspected'] = None
    pg.click('#btnGhConnect'); pg.wait_for_selector('#ghOn:not([hidden])', timeout=8000)
    wait_js('document.getElementById("loader").hidden')
    check('C: connected', pg.evaluate('!!gh.cfg'))
    check('C: remote file created with local entry', mock['exists'] and remote_ids() == ['mv69kgbs88dbv'], remote_ids())
    check('C: one PUT', mock['puts'] == 1, mock['puts'])
    chip = pg.inner_text('#fileStateText')
    check('C: chip says saved', 'GitHub: сохранено' in chip, chip)
    local_store = pg.evaluate("localStorage.getItem('scadalog.v2')")
    check('C: token not in app data', GOOD not in local_store and GOOD not in mock['text'] and GOOD not in pg.evaluate('serialize()'))
    check('C: token not plaintext in gh storage', GOOD not in pg.evaluate("localStorage.getItem('scadalog.gh')") and 'ct' in pg.evaluate("localStorage.getItem('scadalog.gh')"))
    check('C: token field cleared', pg.input_value('#ghToken') == '')

    # D. в покое ничего лишнего не отправляется (нет бесконечных коммитов)
    puts0 = mock['puts']
    for _ in range(3):
        pg.evaluate('ghRun()'); pg.wait_for_timeout(250)
    check('D: idle syncs make no extra PUT', mock['puts'] == puts0, (puts0, mock['puts']))
    pg.click('#drawerClose')

    # E. новая запись уходит в GitHub одним коммитом, серия сохранений склеивается
    pg.click('#pAction button[data-v="Запуск"]'); pg.fill('#fDev', 'TCU-9'); pg.fill('#fLoc', '7')
    pg.click('#btnSave'); pg.wait_for_timeout(2600)
    check('E: new entry reached GitHub', len(remote_ids()) == 2, remote_ids())
    check('E: exactly one more PUT', mock['puts'] == puts0 + 1, mock['puts'])
    puts1 = mock['puts']
    pg.evaluate("state.entries[0].notes = 'тест'; state.entries[0].updatedAt = new Date().toISOString(); persist(); persist(); persist();")
    pg.wait_for_timeout(2600)
    check('E: 3 quick saves = 1 PUT', mock['puts'] == puts1 + 1, (puts1, mock['puts']))

    # F. запись другого диспетчера подтягивается кнопкой, лишнего PUT нет
    other_dispatcher_writes('zz1')
    puts2 = mock['puts']
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhSync')
    wait_js('document.getElementById("loader").hidden', timeout=8000)
    check('F: pulled other dispatcher entry', pg.evaluate("state.entries.some(e => e.id === 'zz1')"))
    check('F: no extra PUT after pull', mock['puts'] == puts2, (puts2, mock['puts']))
    pg.click('#drawerClose')

    # G. конфликт записи: между чтением и записью кто-то успел записать, слияние без потерь
    mock['inject_on_put'] = 'zz2'; c0 = mock['c409']
    pg.evaluate("state.entries[0].notes = 'после конфликта'; state.entries[0].updatedAt = new Date().toISOString(); persist();")
    pg.wait_for_timeout(3500)
    ids = remote_ids()
    check('G: 409 happened', mock['c409'] == c0 + 1, mock['c409'] - c0)
    check('G: remote has both other entry and ours', 'zz2' in ids and 'mv69kgbs88dbv' in ids and len(ids) == 4, ids)
    check('G: local has zz2 too', pg.evaluate("state.entries.some(e => e.id === 'zz2')"))
    check('G: our note survived', json.loads(mock['text'])['entries'][0]['notes'] == 'после конфликта' or any(e['notes'] == 'после конфликта' for e in json.loads(mock['text'])['entries']))

    # H. таймаут ожидания ответа: загрузчик показывает ошибку, потом «Повторить»
    pg.evaluate('GH_TIMEOUT = 600'); mock['hang'] = True
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhSync')
    check('H: loader visible while waiting', pg.is_visible('#loader'))
    pg.wait_for_selector('#loaderBtns:not([hidden])', timeout=6000)
    check('H: timeout message', 'не ответил' in pg.inner_text('#loaderErr'), pg.inner_text('#loaderErr'))
    mock['hang'] = False
    pg.click('#loaderRetry'); wait_js('document.getElementById("loader").hidden', timeout=8000)
    check('H: retry succeeded, UI free', pg.evaluate("!document.querySelector('main.layout').inert && gh.err === null"))
    pg.click('#drawerClose')
    pg.evaluate('GH_TIMEOUT = 15000')

    # I. нет связи: данные остаются, статус предупреждает, потом уходят
    mock['abort'] = True
    pg.evaluate("state.entries[0].notes = 'без связи'; state.entries[0].updatedAt = new Date().toISOString(); persist();")
    pg.wait_for_timeout(2600)
    chip = pg.inner_text('#fileStateText')
    check('I: chip shows no connection', 'нет связи' in chip, chip)
    check('I: data safe in browser', 'без связи' in pg.evaluate("localStorage.getItem('scadalog.v2')"))
    mock['abort'] = False
    pg.evaluate('ghRun()'); pg.wait_for_timeout(1200)
    check('I: sent after connection returned', any(e['notes'] == 'без связи' for e in json.loads(mock['text'])['entries']))
    check('I: chip ok again', 'сохранено' in pg.inner_text('#fileStateText'), pg.inner_text('#fileStateText'))

    # J. перезагрузка: просит пароль; неверный не пускает; верный загружает
    pg.reload(); pg.wait_for_selector('#passDlg:not([hidden])', timeout=8000)
    check('J: password dialog after reload', pg.is_visible('#passDlg') and 'заблокирован' in pg.inner_text('#pdTitle').lower(), pg.inner_text('#pdTitle'))
    pg.fill('#pd1', 'wrong-password'); pg.press('#pd1', 'Enter'); pg.wait_for_timeout(2500)
    check('J: wrong password rejected', 'Неверный пароль' in pg.inner_text('#pdErr'), pg.inner_text('#pdErr'))
    check('J: UI blocked while locked dialog open', pg.evaluate("document.querySelector('main.layout').inert"))
    pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter')
    wait_js("document.getElementById('passDlg').hidden && document.getElementById('loader').hidden", 15000)
    check('J: unlocked and synced', pg.evaluate('!!gh.cfg') and pg.evaluate('state.entries.length') == 4, pg.evaluate('state.entries.length'))
    mock['inspect'] = None
    # J2. «Работать без GitHub»: приложение остаётся рабочим
    pg.reload(); pg.wait_for_selector('#passDlg:not([hidden])', timeout=8000)
    pg.click('#pdCancel')
    check('J2: usable without GitHub', pg.evaluate("!document.querySelector('main.layout').inert") and pg.evaluate('state.entries.length') == 4)
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    check('J2: locked state shows unlock button', pg.is_visible('#btnGhUnlock'))
    pg.click('#drawerClose')
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhUnlock'); pg.wait_for_selector('#passDlg:not([hidden])')
    pg.fill('#pd1', 'shift-pass-1'); pg.press('#pd1', 'Enter')
    wait_js("document.getElementById('passDlg').hidden && document.getElementById('loader').hidden", 15000)
    check('J2: unlocked from settings', pg.evaluate('!!ghToken'))
    pg.click('#drawerClose')

    # K. CSP: наружу, кроме GitHub, ходить нельзя
    r = pg.evaluate("fetch('https://example.com/').then(() => 'allowed').catch(() => 'blocked')")
    check('K: CSP blocks other hosts', r == 'blocked', r)

    # L. отключение
    pg.evaluate('ghRun()'); pg.wait_for_timeout(500)
    pg.click('#btnMenu'); pg.click('[data-tab=data]'); pg.click('#btnGhOff')
    check('L: disconnected, token removed', pg.evaluate('gh.cfg') is None and pg.evaluate("localStorage.getItem('scadalog.gh')") is None)
    check('L: data kept locally', pg.evaluate('state.entries.length') == 4)
    pg.screenshot(path=OUT + '/gh_section.png')

    real = [e for e in errs if 'Failed to load resource' not in e and 'net::ERR' not in e and 'example.com' not in e]
    print('console errors (filtered):', real)
    check('no page errors / CSP violations', not real, real)
    pg.unroute_all(behavior='ignoreErrors')
    b.close()

print('\nFAILED:', fails if fails else 'none')
