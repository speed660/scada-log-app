"""Расчёт солнца и угла трекера, сверка со SCADA, слияние истории правок.
Геометрию трекера проверяем независимо: угол из страницы сравниваем с перебором угла, при котором стол смотрит на солнце ближе всего."""
from playwright.sync_api import sync_playwright
from common import *
import json, math, sys

fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

def brute_force_angle(el, az, skew):
    """Независимая реализация. Ось трекера горизонтальная, направлена по азимуту skew.
    Стол в нулевом положении смотрит вверх. Поворачиваем его вокруг оси по формуле Родрига и ищем угол,
    при котором нормаль стола ближе всего к направлению на солнце. Знак: плюс означает наклон на запад."""
    e, a, k = math.radians(el), math.radians(az), math.radians(skew)
    sun = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))   # восток, север, вверх
    axis = (math.sin(k), math.cos(k), 0.0)
    up = (0.0, 0.0, 1.0)
    def normal(phi):
        c, s = math.cos(phi), math.sin(phi)
        cross = (axis[1] * up[2] - axis[2] * up[1], axis[2] * up[0] - axis[0] * up[2], axis[0] * up[1] - axis[1] * up[0])
        dot = sum(x * y for x, y in zip(axis, up))
        return tuple(up[i] * c + cross[i] * s + axis[i] * dot * (1 - c) for i in range(3))
    def score(deg):
        n = normal(math.radians(deg))
        return sum(x * y for x, y in zip(n, sun))
    lo, hi = -89.9, 89.9
    best = max((lo + (hi - lo) * i / 3598 for i in range(3599)), key=score)
    step = (hi - lo) / 3598
    for _ in range(40):  # уточнение
        cand = [best - step, best, best + step]
        best = max(cand, key=score); step /= 2
    return -best   # в формуле Родрига плюс смотрит на восток, у нас плюс на запад

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 900})
    ctx.add_init_script(ME_SCRIPT)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.clock.install(time='2026-10-26T17:30:00+05:00')
    pg.goto('file://' + APP); pg.wait_for_timeout(300)

    # ---------- 1. геометрия трекера против независимого перебора ----------
    cases = [(el, az, sk) for el in (5, 15, 30, 50, 70) for az in (80, 100, 130, 160, 180, 200, 230, 260, 280) for sk in (-30, -10, 0, 15, 35)]
    got = pg.evaluate("""cases => cases.map(([el, az, sk]) => trackerAngle({ el, az }, { maxAngle: 90, gcr: null, skew: sk }).raw)""", cases)
    worst = 0; worst_case = None
    for (el, az, sk), g in zip(cases, got):
        d = abs(g - brute_force_angle(el, az, sk))
        if d > worst: worst, worst_case = d, (el, az, sk, g)
    check('угол трекера совпадает с независимым перебором (%d случаев)' % len(cases), worst < 0.02, (round(worst, 4), worst_case))
    check('плюс означает наклон на запад (вечером угол положительный)', pg.evaluate("trackerAngle({ el: 20, az: 260 }, { maxAngle: 90, gcr: null, skew: 0 }).raw") > 0)
    check('утром угол отрицательный', pg.evaluate("trackerAngle({ el: 20, az: 100 }, { maxAngle: 90, gcr: null, skew: 0 }).raw") < 0)

    # ---------- 2. backtracking и предел ----------
    bt = pg.evaluate("""() => { const out = []; for (const [el, az] of [[4, 104], [10, 110], [20, 120], [35, 150], [60, 200], [8, 256]]) {
        const t = trackerAngle({ el, az }, { maxAngle: 60, gcr: 0.35, skew: 0 }), r = trackerAngle({ el, az }, { maxAngle: 90, gcr: null, skew: 0 }).raw;
        out.push({ raw: r, cmd: t.cmd, bt: t.backtrack }); } return out; }""")
    ok_rel = all((not x['bt']) or abs(math.cos(math.radians(x['raw'] - x['cmd'])) - math.cos(math.radians(x['raw'])) / 0.35) < 1e-9 for x in bt)
    check('backtracking: cos(разности углов) = cos(угла на солнце) / GCR', ok_rel and any(x['bt'] for x in bt), bt[:2])
    check('backtracking не поворачивает стол дальше, чем прямое наведение', all(abs(x['cmd']) <= abs(x['raw']) + 1e-9 for x in bt))
    lim = pg.evaluate("trackerAngle({ el: 4, az: 100 }, { maxAngle: 55, gcr: null, skew: 0 })")
    check('предельный угол ограничивает результат', abs(lim['cmd']) == 55 and lim['clipped'])

    # ---------- 3. положение солнца и восход/закат (Ташкент) ----------
    sun = pg.evaluate("""() => { const lat = 41.3111, lon = 69.2797, r = {};
        const noon = iso => { let best = null; const t0 = new Date(iso).getTime(); for (let m = -300; m <= 300; m++) { const q = sunPos(new Date(t0 + m * 60000), lat, lon); if (!best || q.el > best.el) best = q; } return best; };
        r.jun = noon('2026-06-21T07:00:00Z').el; r.sep = noon('2026-09-23T07:00:00Z').el; r.dec = noon('2026-12-21T07:00:00Z').el; r.az = noon('2026-10-13T07:00:00Z').az;
        const st = sunTimes(new Date(2026, 9, 13), { lat, lon });
        const mins = d => { const l = new Date(d.getTime() + 5 * 3600000); return l.getUTCHours() * 60 + l.getUTCMinutes(); };
        r.rise = mins(st.rise); r.set = mins(st.set); return r; }""")
    check('высота солнца в полдень 21 июня: 90 − 41,31 + 23,44 = 72,13°', abs(sun['jun'] - 72.13) < 0.1, sun['jun'])
    check('высота солнца в полдень 21 декабря: 90 − 41,31 − 23,44 = 25,25°', abs(sun['dec'] - 25.25) < 0.1, sun['dec'])
    check('высота солнца в полдень у равноденствия около 48,7°', abs(sun['sep'] - 48.6) < 0.4, sun['sep'])
    check('в солнечный полдень азимут около 180°', abs(sun['az'] - 180) < 1.5, sun['az'])
    # внешний источник на 13.10.2026, Ташкент: восход 06:33, закат 17:48 (solarwatch.app)
    check('восход 13.10.2026 в пределах 4 минут от справочных 06:33', abs(sun['rise'] - (6 * 60 + 33)) <= 4, sun['rise'])
    check('закат 13.10.2026 в пределах 4 минут от справочных 17:48', abs(sun['set'] - (17 * 60 + 48)) <= 4, sun['set'])

    # ---------- 4. сверка со SCADA в интерфейсе ----------
    site = {"lat": 41.3111, "lon": 69.2797, "maxAngle": 60, "gcr": None, "skew": 0, "westPositive": True, "set": True}
    pg.evaluate("s => { state.settings = { ...state.settings, site: s }; persist(); }", site)
    times = ['2026-10-26T08:00', '2026-10-26T11:00', '2026-10-26T14:00', '2026-10-26T16:30']

    def open_cal():
        pg.click('#btnMenu'); pg.click('[data-tab=lists]')

    def fake_scada(skew, west):
        return pg.evaluate("""([times, skew, west]) => times.map(t => { const c = calcFor(new Date(t), { ...state.settings.site, skew, westPositive: west }); return c ? Math.round(c.v * 10) / 10 : null; })""", [times, skew, west])

    true_skew = -12.0
    vals = fake_scada(true_skew, True)
    check('сверка: для 4 моментов дня есть значения', all(v is not None for v in vals), vals)
    open_cal()
    for t, v in zip(times, vals):
        pg.fill('#cTime', t); pg.fill('#cAngle', str(v).replace('.', ',')); pg.click('#btnCalAdd')
    check('сверка: 4 строки в таблице', pg.locator('#calOut tbody tr').count() == 4, pg.locator('#calOut tbody tr').count())
    check('сверка: при неверном повороте рядов ошибка заметная', 'Средняя ошибка' in pg.inner_text('#calOut') and pg.locator('#calOut .bad').count() >= 1, pg.inner_text('#calOut')[:200].replace('\n', ' | '))
    pg.click('#btnCalFit')
    txt = pg.inner_text('#calOut')
    import re
    m = re.search(r'Лучший поворот рядов: (−?-?[\d,]+)°', txt)
    best = float(m.group(1).replace('−', '-').replace(',', '.')) if m else None
    check('подбор находит заданный поворот рядов', best is not None and abs(best - true_skew) <= 0.3, (best, txt[:160].replace('\n', ' ')))
    check('подбор предлагает подставить значение', pg.locator('#btnCalApply').count() == 1)
    pg.click('#btnCalApply')
    check('значение попало в поле настроек', abs(float(pg.input_value('#sSkew').replace(',', '.')) - true_skew) <= 0.3, pg.input_value('#sSkew'))
    pg.click('#btnSaveSite')
    check('после сохранения станции ошибка в таблице мала', pg.locator('#calOut td.ok').count() == 4 and pg.locator('#calOut td.bad').count() == 0, pg.inner_text('#calOut')[:200].replace('\n', ' | '))
    # крестик убирает точку
    pg.locator('#calOut [data-calx]').first.click()
    check('точка убирается', pg.locator('#calOut tbody tr').count() == 3)
    # валидация
    pg.fill('#cAngle', '95'); pg.click('#btnCalAdd')
    check('угол больше 90 отклоняется', 'от -90 до 90' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    pg.fill('#cAngle', 'abc'); pg.click('#btnCalAdd')
    check('нечисловой угол отклоняется', 'от -90 до 90' in pg.inner_text('#toastText'))
    # знак: SCADA считает «плюс на восток», а в настройках «плюс на запад»
    pg.click('#btnCalClear')
    check('очистка убирает все точки', pg.locator('#calOut tbody tr').count() == 0)
    vals_flip = fake_scada(0, False)
    pg.evaluate("s => { state.settings = { ...state.settings, site: { ...s, skew: 0 } }; persist(); }", site)
    pg.click('#drawerClose'); open_cal()
    for t, v in zip(times, vals_flip):
        pg.fill('#cTime', t); pg.fill('#cAngle', str(v).replace('.', ',')); pg.click('#btnCalAdd')
    pg.click('#btnCalFit')
    check('подбор замечает обратный знак угла', 'знак угла обратный' in pg.inner_text('#calOut'), pg.inner_text('#calOut')[:260].replace('\n', ' | '))
    check('точки хранятся в браузере', len(pg.evaluate("JSON.parse(localStorage.getItem('scadalog.calib'))")) == 4)
    pg.click('#drawerClose')

    # ---------- 5. слияние истории правок ----------
    mh = pg.evaluate("""() => {
        const h1 = { at: '2026-10-26T05:00:00.000Z', by: 'А', ch: [{ k: 'notes', a: '', b: 'x' }] };
        const h2 = { at: '2026-10-26T05:05:00.000Z', by: 'Б', ch: [{ k: 'location', a: '1', b: '2' }] };
        const base = { id: 'e1', updatedAt: '2026-10-26T05:00:00.000Z', notes: 'x', history: [h1] };
        const other = { id: 'e1', updatedAt: '2026-10-26T05:05:00.000Z', notes: 'y', history: [h2] };
        const m1 = mergeById([base], [other]), m2 = mergeById([other], [base]), m3 = mergeById([base], [JSON.parse(JSON.stringify(base))]);
        return { a: m1.length === 1 && m1[0].history.map(h => h.by).join(''), b: m2[0].history.map(h => h.by).join(''), c: m3[0].history.length, win: m1[0].notes };
    }""")
    check('история двух копий объединяется в любом порядке', mh['a'] == 'АБ' and mh['b'] == 'АБ', mh)
    check('при слиянии побеждает более новая запись', mh['win'] == 'y')
    check('одинаковые копии не размножают историю', mh['c'] == 1)

    real = [e for e in errs if 'Failed to load resource' not in e]
    check('нет ошибок в консоли', not real, real)
    b.close()

print('\nFAILED:', fails if fails else 'none')
sys.exit(1 if fails else 0)
