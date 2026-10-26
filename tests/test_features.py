"""Диспетчер (кто записал), история правок, подсветка просрочки, поворот рядов трекера, порог просрочки в настройках."""
from playwright.sync_api import sync_playwright
from common import *
import json, sys, time

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
    pg.goto('file://' + APP); pg.wait_for_timeout(300)

    data = {"app": "scada-log", "version": 4, "savedAt": "2026-10-26T04:00:00Z",
            "settings": {"deviceTypes": ["TCU", "Инвертор"], "actions": ["Остановка", "Запуск", "Ручной режим", "Изменение угла", "Возврат в авто", "Другое"], "updatedAt": ""},
            "workers": [],
            "entries": [
                entry("fresh", "2026-10-26T04:30:00.000Z", restore=True, origState="Авто", device="FRESH"),   # 09:30, ждёт 30 мин
                entry("late1", "2026-10-26T01:00:00.000Z", restore=True, origState="Авто", device="LATE1"),   # 06:00, ждёт 4 ч
                entry("plain", "2026-10-26T03:00:00.000Z", device="PLAIN"),
            ]}
    path = os.path.join(OUT, 'features.json'); open(path, 'w').write(json.dumps(data))
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.set_input_files('#importInput', path); pg.wait_for_timeout(300)
    pg.click('#drawerClose')

    # ---------- 1. диспетчер ----------
    check('dispatcher field exists, remembered', pg.input_value('#fBy') == 'Тест-диспетчер', pg.input_value('#fBy'))
    pg.fill('#fBy', '')
    pg.click('#pAction button[data-v="Запуск"]'); pg.fill('#fDev', 'NEW-1'); pg.fill('#fLoc', '3'); pg.fill('#fWho', 'Тест'); pg.keyboard.press('Enter')
    pg.click('#btnSave')
    check('empty dispatcher refused', 'Диспетчер' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('no entry created without dispatcher', pg.evaluate("state.entries.every(e => e.device !== 'NEW-1')"))
    pg.fill('#fBy', '  Алиша   Иванов ')
    pg.click('#btnSave')
    check('saved with dispatcher', 'Записано' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    new = pg.evaluate("state.entries.find(e => e.device === 'NEW-1')")
    check('by stored and trimmed', new and new['by'] == 'Алиша Иванов', new and new['by'])
    check('by remembered in browser', pg.evaluate("localStorage.getItem('scadalog.me')") == 'Алиша Иванов')
    check('"Записал" shown in the entry', 'Записал: Алиша Иванов' in pg.inner_text('#calls'))
    check('dispatcher name offered in datalist', 'Алиша Иванов' in pg.inner_html('#dlBy'))

    # ---------- 2. история правок ----------
    nid = new['id']
    pg.fill('#fBy', 'Другой Диспетчер')
    pg.locator('.call[data-id="%s"] [data-act=edit]' % nid).click(force=True)
    pg.fill('#fNotes', 'первая правка')
    pg.fill('#fLoc', '4')
    pg.click('#btnSave')
    check('edit saved', 'Изменения сохранены' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    en = pg.evaluate("state.entries.find(e => e.id === '%s')" % nid)
    check('history has one record', len(en['history']) == 1, en['history'])
    ch = {c['k']: (c['a'], c['b']) for c in en['history'][0]['ch']}
    check('history records notes and location (old -> new)', ch.get('notes') == ('', 'первая правка') and ch.get('location') == ('3', '4'), ch)
    check('history records who edited', en['history'][0]['by'] == 'Другой Диспетчер', en['history'][0]['by'])
    check('original author unchanged by edit', en['by'] == 'Алиша Иванов', en['by'])
    check('"Правок: 1" shown', 'Правок: 1' in pg.inner_text('#calls'))
    # раскрытая история не схлопывается при перерисовке
    pg.locator('.call[data-id="%s"] .c-hist summary' % nid).click(); pg.wait_for_timeout(150)
    pg.evaluate('render()')
    check('open history stays open after re-render', pg.evaluate("document.querySelector('.call[data-id=\"%s\"] .c-hist').open" % nid))
    check('history text shows old and new values', '«3» → «4»' in pg.inner_text('#calls'), pg.inner_text('.call[data-id="%s"] .c-hist' % nid))
    check('untouched time is not logged as a change', 'время звонка' not in pg.inner_text('#calls'))
    # правка без изменений
    pg.locator('.call[data-id="%s"] [data-act=edit]' % nid).click(force=True)
    pg.click('#btnSave')
    check('no-change edit says so', 'Изменений нет' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('no-change edit adds no history', len(pg.evaluate("state.entries.find(e => e.id === '%s').history" % nid)) == 1)
    # история переживает перезагрузку и импорт
    pg.reload(); pg.wait_for_load_state('load'); pg.wait_for_timeout(600)
    check('history persisted after reload', len(pg.evaluate("state.entries.find(e => e.id === '%s').history" % nid)) == 1)

    # ---------- 5. просрочка возврата ----------
    check('late entry flagged in waiting list', pg.locator('#waitList .w-item.late').count() == 1 and 'LATE1' in pg.inner_text('#waitList .w-item.late'), pg.inner_text('#waitList').replace('\n', ' | '))
    check('fresh entry not flagged', 'FRESH' not in pg.inner_text('#waitList .w-item.late'))
    check('waiting title mentions late', 'просрочено: 1' in pg.inner_text('#waitTitle'), pg.inner_text('#waitTitle'))
    check('call row marked late', pg.locator('.call.late').count() == 1)
    check('tab title shows count', pg.title() == '(1) Журнал диспетчера', pg.title())
    # порог 0 выключает, порог 1 час всё ещё ловит одну, порог 0,4 ловит две
    pg.click('#btnMenu'); pg.click('[data-tab=lists]')
    pg.fill('#sAlert', '0'); pg.click('#btnSaveLists')
    check('threshold 0 disables highlight', pg.locator('.w-item.late').count() == 0 and pg.title() == 'Журнал диспетчера', pg.title())
    pg.fill('#sAlert', '0,4'); pg.click('#btnSaveLists')
    check('threshold 0,4 h catches both', pg.locator('.w-item.late').count() == 2, pg.locator('.w-item.late').count())
    pg.fill('#sAlert', '100'); pg.click('#btnSaveLists')
    check('bad threshold rejected', 'от 0 до 72' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    pg.fill('#sAlert', '2'); pg.click('#btnSaveLists')
    check('threshold saved in settings', pg.evaluate('state.settings.alertHours') == 2)
    check('saving lists keeps station settings', pg.evaluate('state.settings.site.maxAngle') == 60)

    # ---------- 4. поворот рядов ----------
    pg.fill('#sLat', '41.3111'); pg.fill('#sLon', '69.2797'); pg.fill('#sMax', '60'); pg.fill('#sSkew', '70')
    pg.click('#btnSaveSite')
    check('skew > 60 rejected', 'Поворот рядов' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    pg.fill('#sSkew', '-15,5'); pg.click('#btnSaveSite')
    check('skew saved', pg.evaluate('state.settings.site.skew') == -15.5, pg.evaluate('state.settings.site.skew'))
    pg.fill('#sSkew', ''); pg.click('#btnSaveSite')
    check('empty skew = 0', pg.evaluate('state.settings.site.skew') == 0)
    pg.click('#drawerClose')
    res = pg.evaluate("""() => {
      const site = { lat: 41.3111, lon: 69.2797, maxAngle: 89, gcr: null, westPositive: true };
      let maxIdentityErr = 0, maxZeroErr = 0, n = 0;
      for (const iso of ['2026-03-21T02:00:00Z', '2026-06-21T01:00:00Z', '2026-06-21T05:00:00Z', '2026-10-13T03:00:00Z', '2026-10-13T10:30:00Z', '2026-12-21T04:00:00Z', '2026-12-21T09:00:00Z']) {
        const p = sunPos(new Date(iso), site.lat, site.lon);
        if (p.el <= 2) continue;
        for (const sk of [-40, -15, 0, 12, 33]) {
          // Поворот рядов на sk при азимуте солнца az даёт то же, что ряды север-юг при азимуте az - sk
          const a = trackerAngle(p, { ...site, skew: sk }).raw;
          const b = trackerAngle({ el: p.el, az: p.az - sk }, { ...site, skew: 0 }).raw;
          maxIdentityErr = Math.max(maxIdentityErr, Math.abs(a - b)); n++;
        }
        const z0 = trackerAngle(p, site).raw, z1 = trackerAngle(p, { ...site, skew: 0 }).raw;
        maxZeroErr = Math.max(maxZeroErr, Math.abs(z0 - z1));
      }
      // в полдень при рядах север-юг угол близок к нулю, а при повороте рядов на 20° — нет
      const noon = sunPos(new Date('2026-10-13T07:10:00Z'), site.lat, site.lon);
      return { maxIdentityErr, maxZeroErr, n, noon0: trackerAngle(noon, site).raw, noon20: trackerAngle(noon, { ...site, skew: 20 }).raw };
    }""")
    check('rotation identity holds', res['maxIdentityErr'] < 1e-9 and res['n'] > 20, res)
    check('skew undefined/0 equals old formula', res['maxZeroErr'] < 1e-12)
    check('noon angle ~0 for N-S rows', abs(res['noon0']) < 5, res['noon0'])
    check('noon angle differs when rows are rotated', abs(res['noon20'] - res['noon0']) > 5, res['noon20'])

    # ---------- Excel не ломается с новыми столбцами ----------
    ok = pg.evaluate("""async () => { const blob = buildXlsx(alive()); const buf = new Uint8Array(await blob.arrayBuffer()); return buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4b; }""")
    check('xlsx builds (zip header)', ok)

    real = [e for e in errs if 'Failed to load resource' not in e]
    check('no console errors', not real, real)
    b.close()

print('\nFAILED:', fails if fails else 'none')
sys.exit(1 if fails else 0)
