import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.environ.get('APP') or os.path.join(HERE, '..', 'index.html'))
FIXTURE = os.path.join(HERE, 'fixtures', 'sample-log.json')
OUT = tempfile.mkdtemp(prefix='scadalog-test-')
ME_SCRIPT = "try{localStorage.setItem('scadalog.me','Тест-диспетчер')}catch(e){}"


import http.server, shutil, threading
def serve_app(app=None):
    """Отдаёт журнал по http://127.0.0.1 и возвращает адрес. Тесты с перезагрузкой страницы открывают журнал так, а не через file://:
    у file:// хранилище браузера в Chromium иногда пропадает при перезагрузке, и проверка падала сама по себе (примерно раз в четыре запуска)."""
    root = tempfile.mkdtemp(prefix='site-', dir=OUT)
    shutil.copy(app or APP, os.path.join(root, 'index.html'))
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}/index.html'
