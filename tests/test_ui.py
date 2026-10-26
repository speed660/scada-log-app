from playwright.sync_api import sync_playwright
from common import *
import json, sys

F = APP
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id='Asia/Tashkent', locale='ru-RU', viewport={'width': 1280, 'height': 860}, accept_downloads=True)
    ctx.add_init_script(ME_SCRIPT)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.clock.install(time='2026-10-13T11:02:00+05:00')
    pg.goto('file://' + F)
    pg.wait_for_timeout(300)

    # ---- 1. иконки по центру ----
    def centered(sel):
        r = pg.evaluate("""s => { const b=document.querySelector(s).getBoundingClientRect(), i=document.querySelector(s+' svg').getBoundingClientRect();
          return [Math.abs((b.left+b.width/2)-(i.left+i.width/2)), Math.abs((b.top+b.height/2)-(i.top+i.height/2))]; }""", sel)
        return r
    for sel in ['#prevDay', '#nextDay']:
        dx, dy = centered(sel)
        check('icon centered ' + sel, dx < 0.6 and dy < 0.6, (round(dx, 2), round(dy, 2)))
    pg.locator('.day-nav').screenshot(path=OUT + '/nav_after.png')

    # ---- 2. импорт копии ----
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    pg.set_input_files('#importInput', '' + FIXTURE + '')
    pg.wait_for_timeout(200)
    check('import toast', 'Копия загружена' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))

    # ---- 3. маска телефона: форма работника ----
    pg.click('[data-tab=workers]')
    w = pg.locator('#wPhone')
    w.click()
    check('prefix on focus', w.input_value() == '+998 ', w.input_value())
    w.press_sequentially('901234567', delay=10)
    check('mask typed', w.input_value() == '+998 90 123 45 67', w.input_value())
    w.fill('')            # очистка как пользователь
    w.blur(); w.click()
    w.press_sequentially('+998 93 555 12 34')
    check('mask typed with country code', w.input_value() == '+998 93 555 12 34', w.input_value())
    # вставка целиком
    w.fill('')
    w.evaluate("el => { el.value='+998901112233'; el.dispatchEvent(new Event('input')); }")
    check('mask paste full', w.input_value() == '+998 90 111 22 33', w.input_value())
    w.evaluate("el => { el.value='998901112233'; el.dispatchEvent(new Event('input')); }")
    check('mask paste 998xxxxxxxxx', w.input_value() == '+998 90 111 22 33', w.input_value())
    w.evaluate("el => { el.value='901112233'; el.dispatchEvent(new Event('input')); }")
    check('mask paste local 9 digits', w.input_value() == '+998 90 111 22 33', w.input_value())
    w.evaluate("el => { el.value='998123456'; el.dispatchEvent(new Event('input')); }")
    check('mask paste local starting 998', w.input_value() == '+998 99 812 34 56', w.input_value())
    # неполный номер -> ошибка
    w.fill(''); w.evaluate("el => { el.value='+998 90 12'; el.dispatchEvent(new Event('input')); }")
    pg.fill('#wName', 'Тест Тестов')
    pg.click('#wForm button[type=submit]')
    check('incomplete phone rejected', 'неполный' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    # дубликат по номеру из импорта
    w.evaluate("el => { el.value='+998901234500'; el.dispatchEvent(new Event('input')); }")
    pg.click('#wForm button[type=submit]')
    check('duplicate phone rejected', 'уже у' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    # нормальный номер
    w.evaluate("el => { el.value='+998 90 555 66 77'; el.dispatchEvent(new Event('input')); }")
    pg.click('#wForm button[type=submit]')
    check('worker saved', 'добавлен' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('worker listed masked', '+998 90 555 66 77' in pg.inner_text('#wList'))
    # пустой телефон: blur убирает префикс
    w.click(); w.blur()
    check('empty after blur', w.input_value() == '', repr(w.input_value()))
    # редактирование: сохраняется
    pg.locator('[data-wact=edit]').first.click()
    check('edit shows masked phone', pg.input_value('#wPhone').startswith('+998 '), pg.input_value('#wPhone'))
    pg.click('#wCancel')
    pg.click('#drawerClose')

    # ---- 4. звонок: угол, солнце, время ----
    pg.click('#pAction button[data-v="Изменение угла"]')
    check('angle group visible', pg.is_visible('#angleGroup'))
    solar = pg.inner_text('#solar')
    print('SOLAR TEXT:', solar.replace('\n', ' | '))
    check('solar shows angle', '°' in solar and 'Подставить' in solar)
    check('solar default coords warning', 'Ташкента' in solar)
    ts0 = pg.input_value('#fTs')
    check('fTs = now (11:02)', ts0.endswith('11:02'), ts0)
    pg.clock.fast_forward('01:00:00')
    pg.wait_for_timeout(200)
    ts1 = pg.input_value('#fTs')
    check('fTs follows clock when untouched', ts1.endswith('12:02') or ts1.endswith('12:01') or ts1.endswith('12:03'), ts1)
    # подставить
    pg.click('#solar .solar-top button[data-sa]')
    v = pg.input_value('#fAngle')
    check('angle substituted', v != '' and not v.endswith('.'), v)
    # восток / запад
    pg.click('#solar button:has-text("К восходу")')
    check('east button = -60', pg.input_value('#fAngle') == '-60', pg.input_value('#fAngle'))
    pg.click('#solar button:has-text("К закату")')
    check('west button = 60', pg.input_value('#fAngle') == '60', pg.input_value('#fAngle'))
    # ручное время отключает автообновление
    pg.fill('#fTs', '2026-10-13T08:00')
    check('solar for 08:00 shows time', '08:00' in pg.inner_text('#solar'), pg.inner_text('#solar')[:80])
    pg.screenshot(path=OUT + '/composer_solar.png')

    # будущее время запрещено
    pg.fill('#fTs', '2027-10-13T08:00')
    pg.fill('#fDev', '101-106'); pg.fill('#fLoc', '30'); pg.fill('#fAngle', '40')
    pg.fill('#fWho', 'Рабочий'); pg.keyboard.press('Enter')
    pg.click('#btnSave')
    check('future time rejected', 'будущем' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    # нормальное сохранение
    pg.fill('#fTs', '2026-10-13T11:30')
    pg.click('#btnSave')
    check('entry saved', 'Записано' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    check('entry shown with angle', 'угол 40°' in pg.inner_text('#calls'))

    # ---- 5. новый работник из формы звонка + маска ----
    pg.click('#pAction button[data-v="Запуск"]')
    pg.fill('#fWho', '90 777 88 99')
    pg.wait_for_timeout(100)
    pg.locator('#whoList .opt.add').click()
    check('new worker block masked', pg.input_value('#nwPhone') == '+998 90 777 88 99', pg.input_value('#nwPhone'))
    pg.fill('#nwName', 'Новый')
    pg.evaluate("el => { el.value='+998 90 77'; el.dispatchEvent(new Event('input')); }", pg.locator('#nwPhone').element_handle())
    pg.fill('#fDev', 'TCU-1')
    pg.click('#btnSave')
    check('new worker incomplete phone rejected', 'неполный' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    pg.click('#btnCancelEdit') if pg.is_visible('#btnCancelEdit') else None

    # ---- 6. настройки станции ----
    pg.click('#btnMenu'); pg.click('[data-tab=lists]')
    pg.fill('#sLat', '40.1234, 66.5678')
    check('paste lat,lon splits', pg.input_value('#sLon') == '66.5678' and pg.input_value('#sLat') == '40.1234', (pg.input_value('#sLat'), pg.input_value('#sLon')))
    pg.fill('#sMax', '55'); pg.fill('#sGcr', '0,35'); pg.select_option('#sSign', 'e')
    pg.click('#btnSaveSite')
    check('site saved', 'Станция сохранена' in pg.inner_text('#toastText'), pg.inner_text('#toastText'))
    pg.click('#btnSaveLists')   # не должен сбросить станцию
    pg.click('#drawerClose')
    stored = pg.evaluate("JSON.parse(localStorage.getItem('scadalog.v2')).settings.site")
    check('site persisted and survives list save', stored['lat'] == 40.1234 and stored['maxAngle'] == 55 and stored['gcr'] == 0.35 and stored['westPositive'] is False and stored['set'] is True, stored)
    pg.fill('#sLat', '') if False else None
    pg.click('#pAction button[data-v="Изменение угла"]')
    t = pg.inner_text('#solar')
    check('no default-coords warning after save', 'Ташкента' not in t)
    check('sign inverted: east button is +55', 'К восходу +55°' in t, t.replace('\n', ' | '))
    pg.click('#btnCancelEdit') if pg.is_visible('#btnCancelEdit') else None

    # ---- 7. Excel скачивается при CSP ----
    pg.click('#btnMenu'); pg.click('[data-tab=data]')
    with pg.expect_download() as dl:
        pg.click('#btnXlsx')
    d = dl.value
    check('xlsx download', d.suggested_filename.endswith('.xlsx'), d.suggested_filename)
    with pg.expect_download() as dl2:
        pg.click('#btnExport')
    check('json backup download', dl2.value.suggested_filename.endswith('.json'), dl2.value.suggested_filename)
    pg.click('#drawerClose')

    # ---- 8. тёмная тема и телефон ----
    pg.emulate_media(color_scheme='dark')
    pg.screenshot(path=OUT + '/desktop_dark.png')
    pg.emulate_media(color_scheme='light')
    m = ctx.new_page()
    m.set_viewport_size({'width': 390, 'height': 800})
    m.on('console', lambda x: errs.append('mobile ' + x.type + ': ' + x.text) if x.type in ('error', 'warning') else None)
    m.on('pageerror', lambda e: errs.append('mobile PAGEERROR ' + str(e)))
    m.goto('file://' + F)
    m.wait_for_timeout(300)
    m.screenshot(path=OUT + '/mobile_home.png')
    m.click('#fab'); m.wait_for_timeout(400)
    m.click('#pAction button[data-v="Изменение угла"]'); m.wait_for_timeout(200)
    m.screenshot(path=OUT + '/mobile_sheet.png')
    dx, dy = m.evaluate("""() => { const b=document.querySelector('#btnSheetClose').getBoundingClientRect(), i=document.querySelector('#btnSheetClose svg').getBoundingClientRect(); return [Math.abs(b.left+b.width/2-i.left-i.width/2), Math.abs(b.top+b.height/2-i.top-i.height/2)]; }""")
    check('mobile close icon centered', dx < 0.6 and dy < 0.6, (dx, dy))
    ov = m.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check('no horizontal overflow on mobile', not ov)
    # тост не перекрывает кнопку
    m.click('#btnSheetClose'); m.wait_for_timeout(300)
    m.evaluate("toast('Проверка уведомления')"); m.wait_for_timeout(400)
    tb = m.evaluate("(() => { const t=document.getElementById('toast').getBoundingClientRect(), f=document.getElementById('fab').getBoundingClientRect(); return [t.bottom, f.top]; })()")
    check('toast above fab', tb[0] <= tb[1] + 1, tb)
    m.screenshot(path=OUT + '/mobile_toast.png')

    print('CONSOLE/ERRORS:', errs)
    check('no console errors (CSP etc.)', not errs, errs)
    b.close()

print('\nFAILED:', fails if fails else 'none')
