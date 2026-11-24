#!/usr/bin/env python3
"""Собирает index.html из исходников в src/.

    python build.py           собрать index.html
    python build.py --check   проверить, что index.html собран из текущих src/ (код выхода 1, если нет)

Исходники:
    src/page.html   разметка; места /*@CSS@*/ и /*@JS@*/ заменяются стилями и кодом
    src/app.css     стили
    src/js/*.js     код, склеивается по порядку имён (01-…, 02-…); это один общий скрипт, порядок важен

Готовая страница остаётся одним файлом: её можно открыть с GitHub Pages и двойным кликом с диска.
Content-Security-Policy разрешает только этот скрипт: вместо 'unsafe-inline' в script-src стоит его хеш SHA-256,
поэтому любой другой код на странице (например, подложенный через данные обработчик onerror) не выполнится.
Хеш считается здесь при каждой сборке, руками его не трогать. index.html руками тоже не править: правка
пропадёт при следующей сборке, а если хеш не совпадёт, браузер не запустит скрипт и страница перестанет работать.
Только стандартная библиотека Python."""
import base64, glob, hashlib, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'index.html')
CSP_UNSAFE = "script-src 'unsafe-inline'"


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def build():
    page, css = read(os.path.join(SRC, 'page.html')), read(os.path.join(SRC, 'app.css'))
    parts = sorted(glob.glob(os.path.join(SRC, 'js', '*.js')))
    if not parts:
        sys.exit('нет файлов в src/js')
    for p in parts:
        if not re.match(r'\d\d-[a-z0-9-]+\.js$', os.path.basename(p)):
            sys.exit('имя файла кода должно быть вида 01-name.js: ' + p)
    js = ''.join(read(p) for p in parts)
    for marker in ('/*@CSS@*/', '/*@JS@*/', CSP_UNSAFE):
        if page.count(marker) != 1:
            sys.exit(f'в src/page.html должно быть ровно одно «{marker}»')
    if re.search(r'</script|<!--', js, re.I) or re.search(r'</style', css, re.I):
        sys.exit('в коде или стилях встретилось </script>, </style> или <!--: они сломают встроенный блок')
    script = '\n' + js  # точное содержимое между <script> и </script>, по нему и считается хеш
    digest = base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode()
    out = (page.replace(CSP_UNSAFE, f"script-src 'sha256-{digest}'")
               .replace('/*@CSS@*/\n', css).replace('\n/*@JS@*/\n', script))
    return out, digest, len(parts)


def main():
    out, digest, n = build()
    if '--check' in sys.argv[1:]:
        cur = read(OUT) if os.path.exists(OUT) else ''
        if cur != out:
            print('index.html не совпадает с исходниками в src/. Правьте файлы в src/ и запускайте: python build.py')
            sys.exit(1)
        print(f'index.html собран из src/ ({n} файлов кода), хеш скрипта sha256-{digest}')
        return
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print(f'index.html собран: {len(out) // 1024} КБ, {n} файлов кода, хеш скрипта sha256-{digest}')


if __name__ == '__main__':
    main()
