"""Защита от случайной публикации открытого текста учебника.
Репозиторий публичный, а в учебнике есть служебные заметки о сервере. Здесь проверяется, что в репозиторий не попало ничего открытого:
сам документ, его части, служебные слова и адреса. Служебные слова хранятся только в виде хэшей, чтобы эта проверка сама ничего не выдавала."""
import hashlib, os, re, subprocess, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)

# SHA-256 служебных слов (названия сервера, продукта, процессов и утилит из заметок). Сами слова сюда не пишем.
FORBIDDEN = {
    '9dbd612d68dcbaa213faadb9b0ef09c03389b881bfc20f5d781e62d23898855e', '6c055c80f0055243abb928f07dc32619b2b6ded5cd9c15651c2ff8bec772ad7c',
    '31066b8a87076fddca09d87b9914f0c668c66ea9043ae72e1fc61e7e587ba096', '2eb5256b587e2e971906004eb6ae5d1c245dc7dbf59b4d754e9f1ef44c5a694c',
    '2ba99f2b8e83025185d07c784e471c5bb7c75a9ddd72850491dc15a48322b0b9', '1fc81ab16837ca7e7f776ba233fe3415fc675124c691daa7d85fa022ddc3c14e',
}


ALLOWED_UCHEBNIK = {'uchebnik/index.html', 'uchebnik/encrypt.html', 'uchebnik/book.enc'}
out = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard'], cwd=REPO, capture_output=True, text=True)
files = sorted(set(f for f in out.stdout.splitlines() if f and os.path.isfile(os.path.join(REPO, f))))
check('список файлов репозитория получен', len(files) > 5, len(files))

bad_names = [f for f in files if re.search(r'solar-uchebnik|worklog', os.path.basename(f), re.I)]
check('в репозитории нет файла открытого учебника по имени', not bad_names, bad_names)
extra = [f for f in files if f.startswith('uchebnik/') and f not in ALLOWED_UCHEBNIK]
check('в папке uchebnik только страница входа, шифровальщик и book.enc', not extra, extra)

hits_words, hits_struct, hits_ip, big = [], [], [], []
for f in files:
    path = os.path.join(REPO, f)
    size = os.path.getsize(path)
    if f != 'uchebnik/book.enc' and f.endswith(('.html', '.htm')) and size > 300 * 1024: big.append((f, size))
    try: text = open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, OSError): continue
    for tok in set(re.findall(r'[a-z0-9_]{4,}', text.lower())):
        if hashlib.sha256(tok.encode()).hexdigest() in FORBIDDEN: hits_words.append((f, 'служебное слово'))
    if text.count('data-l="ru"') >= 20: hits_struct.append(f)
    ips = {m for m in re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text) if not m.startswith(('127.', '0.', '255.'))}
    if len(ips) >= 4: hits_ip.append((f, len(ips)))
check('служебных слов из заметок о сервере нигде нет', not hits_words, sorted(set(hits_words)))
check('нет разметки полного учебника (двуязычные блоки)', not hits_struct, hits_struct)
check('нет россыпи IP-адресов (4 и больше разных в одном файле)', not hits_ip, hits_ip)
check('нет больших открытых HTML-файлов (больше 300 КБ)', not big, big)
gi = open(os.path.join(REPO, '.gitignore'), encoding='utf-8').read()
check('.gitignore не пускает открытый учебник', 'solar-uchebnik*' in gi and '*uchebnik*.html' in gi)
print('\nFAILED:', fails if fails else 'none')
sys.exit(1 if fails else 0)
