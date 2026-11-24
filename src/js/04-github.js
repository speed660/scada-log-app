/* ---------- GitHub: журнал в файле приватного репозитория ---------- */
const GH_KEY = 'scadalog.gh';
let GH_TIMEOUT = 15000; // сколько ждём ответа GitHub, мс
const gh = { cfg: null, sealed: null, knownSha: null, size: null, etag: null, remoteCanon: null, dirty: false, running: null, again: false, err: null, lastOk: null, halted: false, timer: null, retryTimer: null, retryMs: 0 };
class GhError extends Error { constructor(msg, o) { super(msg); Object.assign(this, o); } }
const netErr = e => new GhError(e && e.name === 'AbortError' ? 'GitHub не ответил за ' + Math.round(GH_TIMEOUT / 1000) + ' с' : 'Нет связи с GitHub', { kind: 'net' });
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
// Отпечаток данных без служебных полей: так видно, отличается ли локальная копия от репозитория.
const canon = (src = state) => stable({ s: src.settings, w: [...src.workers].sort(byId), e: [...src.entries].sort(byId) });
const b64enc = t => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = t => { const s = atob(String(t).replace(/\s/g, '')), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new TextDecoder().decode(a); };
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const ghApi = p => 'https://api.github.com/repos/' + gh.cfg.repo + p;
const renderAll = () => { renderPickers(); render(); renderDrawer(); renderSolar(); };

/* Токен GitHub. В localStorage лежит только шифротекст: AES-GCM, ключ из пароля через PBKDF2-SHA256.
   Расшифрованный токен живёт в памяти этой вкладки и пропадает при закрытии, перезагрузке или «Заблокировать».
   В AAD входят репозиторий, путь и ветка: если их подменить в localStorage, токен не расшифруется. */
const TOK_ITER = 600000; // число итераций PBKDF2-SHA256 по рекомендации OWASP
let ghToken = null, ghLegacy = false;
const ghReady = () => !!(gh.cfg && ghToken);
const b64u8 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const u8b64 = t => Uint8Array.from(atob(t), ch => ch.charCodeAt(0));
const tokAad = c => new TextEncoder().encode('scadalog-gh|' + c.repo + '|' + c.path + '|' + c.branch);
async function passKey(pass, salt, iter) {
  if (!(window.crypto && crypto.subtle)) throw new Error('Шифрование недоступно: открой страницу из файла на диске или по https');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealToken(token, pass, c) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passKey(pass, salt, TOK_ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: tokAad(c) }, key, new TextEncoder().encode(token)));
  return { v: 1, iter: TOK_ITER, salt: b64u8(salt), iv: b64u8(iv), ct: b64u8(ct) };
}
async function openToken(tok, pass, c) {
  const iter = Math.min(Math.max(+tok.iter || TOK_ITER, 100000), 5000000);
  const key = await passKey(pass, u8b64(tok.salt), iter);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8b64(tok.iv), additionalData: tokAad(c) }, key, u8b64(tok.ct))); }
  catch (e) { throw new Error('Неверный пароль'); }
}
function saveGhCfg(tok) {
  localStorage.setItem(GH_KEY, JSON.stringify({ repo: gh.cfg.repo, path: gh.cfg.path, branch: gh.cfg.branch, tok }));
  gh.sealed = tok;
}
function ghLoadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(GH_KEY) || 'null');
    if (!c || !/^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) return;
    const cfg = { repo: c.repo, path: c.path || 'scada-log.json', branch: c.branch || '' };
    if (c.tok && c.tok.ct) { gh.cfg = cfg; gh.sealed = c.tok; }
    else if (c.token) { // старая версия хранила токен открытым текстом: убираем его из браузера сразу
      gh.cfg = cfg; ghToken = String(c.token); ghLegacy = true;
      localStorage.setItem(GH_KEY, JSON.stringify(cfg));
    } else { $('ghRepo').value = cfg.repo; $('ghPath').value = cfg.path; $('ghBranch').value = cfg.branch; }
  } catch (e) { console.warn(e); }
}
function ghHttpError(r, d) {
  const msg = d && d.message ? String(d.message) : '';
  const left = r.headers.get('x-ratelimit-remaining'), retry = +r.headers.get('retry-after') || 0;
  if (r.status === 401) return new GhError('Токен не подходит или истёк', { kind: 'auth', status: 401 });
  if ((r.status === 403 || r.status === 429) && (left === '0' || retry || /rate limit/i.test(msg))) {
    const reset = +r.headers.get('x-ratelimit-reset') || 0, wait = retry || Math.max(60, reset - Math.floor(Date.now() / 1000));
    return new GhError('Лимит запросов GitHub, повторю через ' + Math.ceil(wait / 60) + ' мин', { kind: 'rate', wait, status: r.status });
  }
  if (r.status === 403) return new GhError('Нет доступа. У токена должно быть право Contents: Read and write на этот репозиторий', { kind: 'auth', status: 403 });
  if (r.status === 404) return new GhError('Репозиторий, ветка или файл не найдены, либо у токена нет к ним доступа', { kind: 'notfound', status: 404 });
  if (r.status === 409 || r.status === 422) return new GhError(msg || 'Конфликт версий файла', { kind: 'conflict', status: r.status });
  if (r.status >= 500) return new GhError('GitHub временно недоступен (' + r.status + ')', { kind: 'net', status: r.status });
  return new GhError('GitHub: ' + (msg || r.status), { kind: 'other', status: r.status });
}
// Один запрос с ограничением по времени. Таймер живёт, пока не прочитано тело ответа.
async function ghFetch(url, opts = {}, allow = []) {
  if (!ghToken) throw new GhError('GitHub заблокирован, нужен пароль', { kind: 'locked' });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), GH_TIMEOUT);
  try {
    let r;
    try {
      r = await fetch(url, { ...opts, cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + ghToken, ...(opts.headers || {}) } });
    } catch (e) { throw netErr(e); }
    let data = null;
    if (r.status !== 304) { try { data = await r.json(); } catch (e) { if (ctl.signal.aborted) throw netErr(e); } }
    if (r.ok || allow.includes(r.status)) return { status: r.status, headers: r.headers, data };
    throw ghHttpError(r, data);
  } finally { clearTimeout(timer); }
}
async function ghGet() {
  const c = gh.cfg, h = {};
  if (gh.etag && gh.knownSha) h['If-None-Match'] = gh.etag;
  const r = await ghFetch(ghApi('/contents/' + encPath(c.path) + (c.branch ? '?ref=' + encodeURIComponent(c.branch) : '')), { headers: h }, [304, 404]);
  if (r.status === 304) return { fresh: false };
  if (r.status === 404) { gh.etag = null; gh.knownSha = null; return { fresh: true, text: null, sha: null }; } // файла ещё нет
  const j = r.data;
  if (!j || Array.isArray(j) || j.type !== 'file') throw new GhError('По этому пути в репозитории лежит не файл', { kind: 'notfound' });
  gh.etag = r.headers.get('ETag'); gh.size = j.size;
  if (j.sha === gh.knownSha) return { fresh: false };
  let b = j.content;
  if (!b && j.size > 0) b = (await ghFetch(ghApi('/git/blobs/' + j.sha))).data.content; // файл больше 1 МБ
  return { fresh: true, text: j.size > 0 ? b64dec(b) : '', sha: j.sha };
}
// Один цикл: забрать новое из GitHub, слить с локальным, отправить разницу. При конфликте версий повторяет.
async function ghSyncOnce() {
  const c = gh.cfg;
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await ghGet();
    if (g.fresh) {
      let rc = null;
      if (g.text != null && g.text.trim()) {
        let got;
        try { got = parseData(JSON.parse(g.text)); }
        catch (e) { throw new GhError('Файл в GitHub не читается, поэтому я его не перезаписываю. Проверь файл в репозитории', { kind: 'corrupt' }); }
        rc = canon({ settings: got.settings || state.settings, workers: got.workers, entries: got.entries });
        const before = canon();
        absorb(got);
        if (canon() !== before) { saveLocal(); renderAll(); }
      }
      gh.knownSha = g.sha;
      if (rc !== null && canon() === rc) { gh.remoteCanon = rc; gh.dirty = false; return; }
      gh.remoteCanon = rc;
    } else if (canon() === gh.remoteCanon) { gh.dirty = false; return; }
    const snap = canon(), body = { message: 'Журнал ' + hm(new Date()) + ', записей: ' + alive().length, content: b64enc(serializeRemote()) };
    if (gh.knownSha) body.sha = gh.knownSha;
    if (c.branch) body.branch = c.branch;
    try {
      const res = await ghFetch(ghApi('/contents/' + encPath(c.path)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      gh.knownSha = res.data.content.sha; gh.size = res.data.content.size || gh.size; gh.etag = null; gh.remoteCanon = snap;
      gh.dirty = canon() !== snap;
      return;
    } catch (e) {
      if (e.kind !== 'conflict') throw e;
      gh.etag = null; gh.knownSha = null; // кто-то записал раньше: забираем заново и сливаем
      if (attempt === 3) throw e;
    }
  }
}
function ghRun() {
  if (!ghReady()) return Promise.resolve({ ok: true });
  if (gh.running) { gh.again = true; return gh.running; }
  clearTimeout(gh.timer); clearTimeout(gh.retryTimer);
  gh.running = (async () => {
    try {
      do { gh.again = false; if (JOURNAL_ON) await ghSyncOnce(); } while (gh.again); // журнал скрыт: scada-log.json не читаем и не пишем, нужны только данные станции
      gh.err = null; gh.halted = false; gh.retryMs = 0; gh.lastOk = new Date();
      if (!trkErr) trkLoad().then(() => { if (!$('mapView').hidden) mapLoad(); }); // данные станции подтягиваем в фоне; сбой там не ломает журнал, после ошибки повтор только по кнопке
      return { ok: true };
    } catch (e) {
      const err = e instanceof GhError ? e : new GhError((e && e.message) || String(e), { kind: 'other' });
      gh.err = err;
      if (err.kind === 'net' || err.kind === 'conflict') { gh.retryMs = Math.min((gh.retryMs || 4000) * 2, 120000); gh.retryTimer = setTimeout(ghRun, gh.retryMs); }
      else if (err.kind === 'rate') gh.retryTimer = setTimeout(ghRun, (err.wait || 60) * 1000);
      else gh.halted = true; // токен, права, репозиторий: само не пройдёт, нужно действие человека
      return { ok: false, err };
    } finally { gh.running = null; renderGh(); }
  })();
  renderGh();
  return gh.running;
}
// Любое изменение данных: отправка через 1,5 с после последней правки, а не на каждый клик.
function ghSchedule(delay = 1500) {
  if (!gh.cfg || !JOURNAL_ON) return;
  gh.dirty = true; renderGh();
  if (gh.halted || !ghToken) return;
  clearTimeout(gh.timer); gh.timer = setTimeout(ghRun, delay);
}
function ghStatus() {
  if (!ghToken) return { text: 'GitHub: заблокирован, нужен пароль' + (gh.dirty ? ', есть неотправленное' : ''), cls: 'warn' };
  if (!JOURNAL_ON) {
    if (trkData) return { text: 'GitHub: данные станции загружены', cls: 'ok' };
    if (trkErr) return { text: 'GitHub: ' + trkErr, cls: 'err' };
    return { text: 'GitHub: загружаю данные станции…', cls: 'busy' };
  }
  if (gh.running) return { text: 'GitHub: сохраняю…', cls: 'busy' };
  if (gh.err) {
    const soft = ['net', 'rate', 'conflict'].includes(gh.err.kind);
    return { text: 'GitHub: ' + (soft ? 'нет связи, данные в браузере, повторю' : gh.err.message), cls: soft ? 'warn' : 'err' };
  }
  if (gh.dirty) return { text: 'GitHub: изменения ждут отправки', cls: 'warn' };
  if (!gh.lastOk) return { text: 'GitHub: проверяю…', cls: 'warn' };
  return { text: 'GitHub: сохранено в ' + hm(gh.lastOk), cls: 'ok' };
}
function renderGhSection() {
  if (!$('ghSection')) return;
  const on = !!gh.cfg;
  $('ghForm').hidden = on; $('ghOn').hidden = !on;
  if (!on) return;
  const locked = !ghToken;
  $('btnGhUnlock').hidden = !locked; $('btnGhSync').hidden = locked; $('btnGhLock').hidden = locked;
  const g = ghStatus();
  const sz = gh.size ? ' (' + (gh.size >= 1048576 ? (gh.size / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(gh.size / 1024)) + ' КБ') + ')' : '';
  $('ghInfo').textContent = gh.cfg.repo + ', ' + (gh.cfg.branch ? 'ветка ' + gh.cfg.branch : 'ветка по умолчанию') + ', файл ' + gh.cfg.path + sz + '. ' + g.text;
  $('ghInfo').className = 'backup-state' + (g.cls === 'ok' || g.cls === 'busy' ? '' : ' old');
}
function renderGh() { updateFileUI(); renderGhSection(); }

/* Загрузчик: на время запроса блокирует весь интерфейс и клавиатуру. Ошибка и таймаут показываются в нём же. */
let uiBlocked = 0;
const BLOCKED = ['#mapView', '#scadaView', 'header.top', 'main.layout', '#fab', '#drawer', '#scrim'];
function setInert(on) { BLOCKED.forEach(q => { const el = document.querySelector(q); if (el) el.inert = on; }); }
async function runBlocking(text, fn, opt = {}) {
  const back = document.activeElement;
  uiBlocked++; setInert(true); $('loaderBox').classList.remove('shown'); $('loader').hidden = false;
  try {
    for (;;) {
      $('loaderText').textContent = text; $('loaderSpin').hidden = false; $('loaderErr').hidden = true; $('loaderBtns').hidden = true;
      try { return await fn(); }
      catch (e) {
        if (e && e.cancelled) return null;
        $('loaderBox').classList.add('shown'); // ошибку показываем сразу, без задержки
        $('loaderSpin').hidden = true; $('loaderText').textContent = 'Не получилось';
        $('loaderErr').textContent = (e && e.message) || String(e); $('loaderErr').hidden = false;
        $('loaderClose').textContent = opt.closeLabel || 'Закрыть'; $('loaderBtns').hidden = false; $('loaderRetry').focus();
        const act = await new Promise(res => { $('loaderRetry').onclick = () => res('retry'); $('loaderClose').onclick = () => res('close'); });
        if (act === 'close') return null;
      }
    }
  } finally {
    $('loader').hidden = true;
    if (--uiBlocked === 0) setInert(false);
    if (back && back.isConnected && back.focus) try { back.focus(); } catch (e) { /* не важно */ }
  }
}

/* Окно пароля. mode 'unlock': ввести пароль; 'set': задать пароль дважды. work(pass) бросает ошибку, если не вышло. */
function passDialog(mode, work) {
  return new Promise(resolve => {
    const set = mode === 'set';
    $('pdTitle').textContent = set ? 'Задай пароль для токена GitHub' : 'GitHub заблокирован';
    $('pdText').textContent = set
      ? 'Раньше токен лежал в браузере открытым текстом, сейчас он оттуда удалён. Задай пароль, и токен сохранится зашифрованным. Если нажать «Позже», токен проработает до закрытия страницы, потом его придётся вставить заново.'
      : 'Введи пароль, чтобы отправлять записи в ' + gh.cfg.repo + ' и забирать записи других диспетчеров.';
    $('pd1').placeholder = set ? 'Пароль, не короче 8 символов' : 'Пароль';
    $('pd2').hidden = !set; $('pd1').value = $('pd2').value = ''; $('pdErr').hidden = true;
    const okLabel = set ? 'Сохранить' : 'Разблокировать';
    $('pdOk').textContent = okLabel; $('pdOk').disabled = false;
    $('pdCancel').textContent = set ? 'Позже' : 'Работать без GitHub';
    const back = document.activeElement;
    uiBlocked++; setInert(true); $('passDlg').hidden = false; $('pd1').focus();
    const err = m => { $('pdErr').textContent = m; $('pdErr').hidden = false; $('pd1').focus(); };
    const done = ok => {
      $('passDlg').hidden = true; $('pd1').value = $('pd2').value = '';
      $('pdForm').onsubmit = null; $('pdCancel').onclick = null;
      if (--uiBlocked === 0) setInert(false);
      if (back && back.isConnected && back.focus) try { back.focus(); } catch (e) { /* не важно */ }
      resolve(ok);
    };
    $('pdCancel').onclick = () => { if (!$('pdOk').disabled) done(false); };
    $('pdForm').onsubmit = async ev => {
      ev.preventDefault();
      if ($('pdOk').disabled) return;
      const p = $('pd1').value;
      if (!p) return err('Введи пароль');
      if (set && p.length < 8) return err('Пароль не короче 8 символов');
      if (set && p !== $('pd2').value) return err('Пароли не совпадают');
      $('pdOk').disabled = true; $('pdOk').textContent = 'Проверяю…'; $('pdErr').hidden = true;
      try { await work(p); done(true); }
      catch (e) { $('pdOk').disabled = false; $('pdOk').textContent = okLabel; err((e && e.message) || String(e)); $('pd1').select(); }
    };
  });
}
$('passDlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); $('pdCancel').click(); } });

const ghLoad = () => runBlocking(JOURNAL_ON ? 'Загружаю журнал из GitHub…' : 'Загружаю данные станции…', async () => {
  gh.halted = false; const r = await ghRun(); if (!r.ok) throw r.err;
  if (!JOURNAL_ON) await trkLoad(); // без журнала ждём сами данные станции; ошибку покажет карта с кнопкой «Повторить»
}, { closeLabel: 'Работать без связи' });
async function ghUnlock() {
  if (!gh.cfg || ghToken) return true;
  const ok = await passDialog('unlock', async p => { ghToken = await openToken(gh.sealed, p, gh.cfg); });
  renderGh();
  if (ok) await ghLoad();
  return ok;
}
function ghLock() {
  ghToken = null; clearTimeout(gh.timer); clearTimeout(gh.retryTimer);
  trkClear();
  renderGh();
}
function ghDisconnect() {
  clearTimeout(gh.timer); clearTimeout(gh.retryTimer);
  try { localStorage.removeItem(GH_KEY); } catch (e) { /* нет доступа */ }
  ghToken = null; gh.sealed = null; trkClear();
  Object.assign(gh, { cfg: null, knownSha: null, etag: null, remoteCanon: null, dirty: false, err: null, lastOk: null, halted: false, retryMs: 0 });
  renderGh();
}
$('btnGhConnect').onclick = async () => {
  const repo = $('ghRepo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const path = $('ghPath').value.trim().replace(/^\/+/, '') || 'scada-log.json', branch = $('ghBranch').value.trim(), token = $('ghToken').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('Репозиторий в формате владелец/название', { error: true }); $('ghRepo').focus(); return; }
  if (token.length < 20) { toast('Вставь токен доступа целиком', { error: true }); $('ghToken').focus(); return; }
  const pass = $('ghPass').value;
  if (pass.length < 8) { toast('Пароль для токена не короче 8 символов', { error: true }); $('ghPass').focus(); return; }
  if (pass !== $('ghPass2').value) { toast('Пароли не совпадают', { error: true }); $('ghPass2').focus(); return; }
  const prev = { cfg: gh.cfg, token: ghToken, sealed: gh.sealed };
  const ok = await runBlocking('Проверяю доступ к GitHub…', async () => {
    gh.cfg = { repo, path, branch }; ghToken = token;
    try {
      const info = (await ghFetch(ghApi(''))).data;
      if (info && info.permissions && !info.permissions.push) throw new GhError('У токена нет права записи в этот репозиторий. Нужно Contents: Read and write', { kind: 'auth' });
      if (info && info.private === false && !confirm('Репозиторий публичный: журнал с именами и телефонами сможет прочитать любой. Всё равно подключить?')) throw Object.assign(new Error('Отменено'), { cancelled: true });
      if (branch) await ghFetch(ghApi('/branches/' + encodeURIComponent(branch)));
      Object.assign(gh, { knownSha: null, etag: null, remoteCanon: null, err: null, halted: false, lastOk: null });
      const r = await ghRun();
      if (!r.ok) throw r.err;
      saveGhCfg(await sealToken(token, pass, gh.cfg));
      return true;
    } catch (e) { gh.cfg = prev.cfg; ghToken = prev.token; gh.sealed = prev.sealed; throw e; }
  }, { closeLabel: 'Отмена' });
  if (ok) { ['ghToken', 'ghPass', 'ghPass2'].forEach(id => { $(id).value = ''; }); renderGh(); toast('GitHub подключён, токен зашифрован'); } else renderGh();
};
$('btnGhUnlock').onclick = () => ghUnlock();
$('btnGhLock').onclick = () => { ghLock(); toast('GitHub заблокирован. Записи сохраняются в браузере'); };
$('btnGhSync').onclick = () => runBlocking('Синхронизирую с GitHub…', async () => { gh.halted = false; const r = await ghRun(); if (!r.ok) throw r.err; }, { closeLabel: 'Закрыть' });
$('btnGhOff').onclick = () => {
  if (!confirm('Отключить GitHub? Данные останутся в этом браузере, токен будет удалён из него.')) return;
  ghDisconnect(); toast('GitHub отключён');
};

