from playwright.sync_api import sync_playwright
from common import *
import json, sys
F = APP
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

def entry(i, ts, **kw):
    e = {"id": i, "createdAt": ts, "linkedTo": "", "closedBy": "", "deleted": False, "ts": ts, "workerId": "",
         "callerName": "Тест", "callerPhone": "", "deviceType": "TCU", "location": "1", "device": "D-" + i, "action": "Ручной режим",
         "angle": None, "open": False, "restore": False, "origState": "", "notes": "", "updatedAt": ts}
    e.update(kw); return e

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860})
    ctx.add_init_script(ME_SCRIPT)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.clock.install(time='2026-10-26T10:00:00+05:00')
    pg.goto('file://' + F); pg.wait_for_timeout(300)

    data = {"app": "scada-log", "version": 4, "savedAt": "2026-10-26T04:00:00Z",
            "settings": {"deviceTypes": ["TCU", "Инвертор"], "actions": ["Остановка", "Запуск", "Ручной режим", "Изменение угла", "Возврат в авто", "Другое"], "updatedAt": ""},
            "workers": [],
            "entries": [
                entry("today1", "2026-10-26T03:30:00.000Z"),                                             # 08:30 сегодня
                entry("yest1",  "2026-10-25T07:00:00.000Z"),                                             # вчера
                entry("old_open", "2026-10-24T06:00:00.000Z", action="Остановка", open=True, device="OLD-OPEN"),  # старая «нужно запустить»
                entry("gone", "2026-10-26T02:00:00.000Z", deleted=True, device="GONE"),                  # старая удалённая
            ]}
    open(os.path.join(OUT, 'rules.json'), 'w').write(json.dumps(data))
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.set_input_files('#importInput', os.path.join(OUT, 'rules.json')); pg.wait_for_timeout(300)
    pg.click('#drawerClose')

    # --- флажок «нужно запустить» исчез ---
    check('fOpen checkbox removed', pg.locator('#fOpen').count() == 0)
    check('no "нужно запустить" text in form', 'нужно запустить' not in pg.inner_text('#form'))
    check('restore checkbox still there', pg.locator('#fRestore').count() == 1)
    pg.click('#pAction button[data-v="Остановка"]')
    check('Остановка does not tick anything', not pg.is_checked('#fRestore'))
    pg.click('#pAction button[data-v="Ручной режим"]')
    check('Ручной режим still ticks restore', pg.is_checked('#fRestore'))
    # новая запись «Остановка» не попадает в «ожидают возврата»
    pg.click('#pAction button[data-v="Остановка"]')
    pg.fill('#fDev', 'NEW-STOP'); pg.fill('#fLoc', '9'); pg.fill('#fWho', 'Тест'); pg.keyboard.press('Enter')
    pg.click('#btnSave')
    check('new stop entry saved', 'Записано' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    waiting = pg.inner_text('#waiting')
    check('new stop is not pending', 'NEW-STOP' not in waiting, waiting.replace('\n', ' | ')[:120])
    check('legacy open entry still pending (not lost)', 'OLD-OPEN' in waiting)

    # --- сегодняшние: «Изменить» есть, «Удалить» нет ---
    today_txt = pg.inner_html('#calls')
    check('today: edit present', 'data-act="edit"' in today_txt)
    check('today: no delete button', 'data-act="del"' not in today_txt and 'Удалить' not in pg.inner_text('#calls'))
    check('subtitle says Сегодня', pg.inner_text('#daySub').startswith('Сегодня'))

    # правка сегодняшней записи работает
    pg.locator('.call[data-id="today1"] [data-act=edit]').click(force=True)
    pg.fill('#fNotes', 'поправил')
    pg.click('#btnSave')
    check('edit today saved', 'Изменения сохранены' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('edit today persisted', pg.evaluate("state.entries.find(e => e.id === 'today1').notes") == 'поправил')
    # перенос сегодняшней на вчера запрещён
    pg.locator('.call[data-id="today1"] [data-act=edit]').click(force=True)
    pg.fill('#fTs', '2026-10-25T09:00')
    pg.click('#btnSave')
    check('moving today entry to yesterday refused', 'нельзя перенести' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('entry day unchanged after refusal', pg.evaluate("state.entries.find(e => e.id === 'today1').ts") == '2026-10-26T03:30:00.000Z')
    pg.click('#btnCancelEdit')

    # --- вчера: только просмотр ---
    pg.click('#prevDay')
    check('yesterday subtitle read-only', pg.inner_text('#daySub').startswith('Только просмотр'), pg.inner_text('#daySub'))
    y = pg.inner_html('#calls')
    check('yesterday: entry visible', 'data-id="yest1"' in y)
    check('yesterday: no edit button', 'data-act="edit"' not in y)
    check('yesterday: no delete button', 'data-act="del"' not in y)
    check('yesterday: repeat still available', 'data-act="repeat"' in y)
    # прямой вызов в обход кнопок тоже не пускает
    r = pg.evaluate("""() => { loadComposer && 0; const e = state.entries.find(x => x.id === 'yest1');
        document.querySelector('.call[data-id="yest1"]').insertAdjacentHTML('beforeend', '<button data-act="edit" id="fake">x</button>');
        document.getElementById('fake').click(); return document.getElementById('toastText').textContent; }""")
    check('forced edit click on past entry refused', 'прошлых дней' in r, r)
    check('composer not switched to edit mode', pg.evaluate('editingId') is None)
    # saveEntry-защита: форма «зависла» в режиме правки, а запись уже вчерашняя
    r2 = pg.evaluate("""() => { editingId = 'yest1'; document.getElementById('fDev').value='X'; document.getElementById('fLoc').value='1';
        document.getElementById('fTs').value = '2026-10-25T12:00'; tsAuto = false;
        form.type='TCU'; form.action='Запуск'; resolveCaller = () => ({ w: null }); saveEntry(); return document.getElementById('toastText').textContent; }""")
    check('saveEntry refuses past entry even if form is stuck', 'уже в прошлом дне' in r2, r2)
    check('past entry unchanged', pg.evaluate("state.entries.find(e => e.id === 'yest1').device") == 'D-yest1')

    # --- старая удалённая запись не показывается; старые данные читаются ---
    pg.click('#btnToday')
    check('legacy deleted entry hidden', 'GONE' not in pg.inner_text('#calls'))

    # --- возврат старой «ожидающей» записи работает ---
    pg.locator('#waitList .btn-return').first.click()
    pg.click('#btnSave')
    check('return legacy pending works', 'Записано' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('legacy pending closed', pg.evaluate("!!state.entries.find(e => e.id === 'old_open').closedBy"))

    real = [e for e in errs if 'Failed to load resource' not in e]
    check('no console errors', not real, real)
    b.close()
print('\nFAILED:', fails if fails else 'none')
