/* ---------- данные ---------- */
const DEF_SITE = { lat: 41.3111, lon: 69.2797, maxAngle: 60, gcr: null, skew: 0, westPositive: true, set: false }; // по умолчанию Ташкент
function normSite(s) {
  s = s && typeof s === 'object' ? s : {};
  const n = (v, d, lo, hi) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x >= lo && x <= hi ? x : d; };
  return {
    lat: n(s.lat, DEF_SITE.lat, -90, 90), lon: n(s.lon, DEF_SITE.lon, -180, 180),
    maxAngle: n(s.maxAngle, DEF_SITE.maxAngle, 10, 90), gcr: n(s.gcr, null, 0.1, 0.95), skew: n(s.skew, 0, -60, 60),
    westPositive: s.westPositive !== false, set: !!s.set
  };
}
function normSettings(raw) {
  const list = (v, d) => { const a = Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : []; return a.length ? a : [...d]; };
  return {
    deviceTypes: list(raw && raw.deviceTypes, DEFAULTS.deviceTypes),
    actions: list(raw && raw.actions, DEFAULTS.actions),
    site: normSite(raw && raw.site),
    alertHours: (() => { const h = parseFloat(String(raw && raw.alertHours != null ? raw.alertHours : '').replace(',', '.')); return isFinite(h) && h >= 0 && h <= 72 ? h : 2; })(),
    updatedAt: raw && raw.updatedAt ? iso(raw.updatedAt) : ''
  };
}
function normHist(h) {
  if (!Array.isArray(h)) return [];
  const t = v => String(v == null ? '' : v).slice(0, 300);
  return h.map(x => x && Array.isArray(x.ch) ? { at: iso(x.at), by: str(x.by), ch: x.ch.map(c => c && c.k ? { k: t(c.k), a: t(c.a), b: t(c.b) } : null).filter(Boolean) } : null).filter(x => x && x.ch.length).slice(-30);
}
function normEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const legacy = 'text' in e && !('action' in e); // самая первая версия
  const a = e.angle === '' || e.angle == null || !isFinite(+e.angle) ? null : +e.angle;
  const out = {
    id: str(e.id) || uid(), ts: iso(e.ts || e.createdAt),
    workerId: str(e.workerId), callerName: str(e.callerName || e.caller), callerPhone: normPhone(e.callerPhone),
    deviceType: legacy ? 'Другое' : str(e.deviceType), location: legacy ? str(e.tag) : str(e.location),
    device: str(e.device), action: legacy ? 'Другое' : str(e.action), angle: a,
    open: !!e.open, restore: !!e.restore, origState: str(e.origState),
    linkedTo: str(e.linkedTo), closedBy: str(e.closedBy),
    notes: legacy ? str(e.text) : str(e.notes), by: str(e.by), history: normHist(e.history),
    createdAt: iso(e.createdAt || e.ts), updatedAt: iso(e.updatedAt || e.createdAt || e.ts), deleted: !!e.deleted
  };
  return (out.action || out.device || out.location || out.notes) ? out : null;
}
function normWorker(w) {
  if (!w || typeof w !== 'object') return null;
  const out = {
    id: str(w.id) || uid(), name: str(w.name), phone: normPhone(w.phone), note: str(w.note),
    createdAt: iso(w.createdAt), updatedAt: iso(w.updatedAt || w.createdAt), deleted: !!w.deleted
  };
  return (out.name || out.phone) ? out : null;
}
function parseData(data) {
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
  if (!arr) throw new Error('Это не файл журнала');
  const obj = Array.isArray(data) ? {} : data;
  return {
    entries: arr.map(normEntry).filter(Boolean),
    workers: Array.isArray(obj.workers) ? obj.workers.map(normWorker).filter(Boolean) : [],
    settings: obj.settings ? normSettings(obj.settings) : null
  };
}
// Слияние по id: побеждает более свежая правка. Удалённое остаётся пометкой, чтобы не «воскресало» при загрузке копии.
// История правок двух копий одной записи объединяется, чтобы правка с другого компьютера не терялась.
function mergeHist(a, b) {
  const seen = new Map();
  for (const h of [...(a || []), ...(b || [])]) seen.set(h.at + '|' + h.by + '|' + stable(h.ch), h);
  return [...seen.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-30);
}
function mergeById(a, b) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const c = m.get(x.id);
    if (!c) { m.set(x.id, x); continue; }
    const win = x.updatedAt > c.updatedAt ? x : c, lose = win === x ? c : x;
    if (win.history || lose.history) win.history = mergeHist(win.history, lose.history);
    m.set(x.id, win);
  }
  return [...m.values()];
}
function absorb(got) {
  state.entries = mergeById(state.entries, got.entries);
  state.workers = mergeById(state.workers, got.workers);
  if (got.settings && got.settings.updatedAt > state.settings.updatedAt) state.settings = got.settings;
}

let state = { entries: [], workers: [], settings: normSettings(null) };
let fileHandle = null, pendingHandle = null, writeChain = Promise.resolve(), fileError = false;
let viewDay = todayKey();
let editingId = null, linkingId = null, tsAuto = true;
const form = { type: '', action: '', workerId: '', newWorker: false };

const alive = () => state.entries.filter(e => !e.deleted);
const aliveW = () => state.workers.filter(w => !w.deleted);
const find = id => state.entries.find(e => e.id === id);
const findW = id => id ? state.workers.find(w => w.id === id) : null;
const isPending = e => (e.open || e.restore) && !e.closedBy;
const isLate = e => isPending(e) && state.settings.alertHours > 0 && Date.now() - new Date(e.ts) > state.settings.alertHours * 3600000;
// Править можно только записи сегодняшнего дня (по дате звонка). Записи прошлых дней закрыты. Удалять записи нельзя вообще.
const canEdit = e => dayKey(new Date(e.ts)) === todayKey();
function callerOf(e) {
  const w = findW(e.workerId);
  if (w && !w.deleted) return { name: w.name, phone: w.phone };
  return { name: e.callerName, phone: e.callerPhone };
}
function needText(e) {
  const parts = [];
  if (e.open) parts.push('нужно запустить');
  if (e.restore) parts.push('вернуть в исходное' + (e.origState ? ': ' + e.origState : ''));
  const s = parts.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function workerStats() {
  const m = new Map();
  for (const e of alive()) {
    if (!e.workerId) continue;
    const s = m.get(e.workerId) || { n: 0, last: '' };
    s.n++; if (e.ts > s.last) s.last = e.ts;
    m.set(e.workerId, s);
  }
  return m;
}
function serialize() {
  return JSON.stringify({ app: 'scada-log', version: 4, savedAt: new Date().toISOString(), settings: state.settings, workers: state.workers, entries: state.entries }, null, 2);
}
// Файл для GitHub: без отступов, но каждая запись на своей строке и по порядку времени. Он примерно на четверть меньше читаемой копии,
// а история коммитов по-прежнему показывает, какая именно запись изменилась. Читается тем же кодом, это обычный JSON.
function serializeRemote() {
  const lines = a => '[\n' + a.map(x => JSON.stringify(x)).join(',\n') + '\n]';
  const entries = [...state.entries].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : byId(a, b)));
  const workers = [...state.workers].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : byId(a, b)));
  return '{"app":"scada-log","version":4,"savedAt":' + JSON.stringify(new Date().toISOString()) + ',\n"settings":' + JSON.stringify(state.settings) +
    ',\n"workers":' + lines(workers) + ',\n"entries":' + lines(entries) + '\n}\n';
}
function persist() { saveLocal(); ghSchedule(); }
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ settings: state.settings, workers: state.workers, entries: state.entries })); } catch (e) { console.warn(e); }
  writeFile();
}
function writeFile() {
  if (!fileHandle) return;
  const h = fileHandle, data = serialize();
  writeChain = writeChain.then(async () => {
    const w = await h.createWritable(); await w.write(data); await w.close();
    if (fileError) { fileError = false; updateFileUI(); }
  }).catch(err => {
    console.error(err); fileError = true; updateFileUI();
    toast('Не удалось записать в файл. Данные сохранены в браузере', { error: true });
  });
}

