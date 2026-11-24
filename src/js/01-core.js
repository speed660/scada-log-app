'use strict';
const $ = id => document.getElementById(id);
// Страница диспетчера (журнал звонков, работники, Excel, резервные копии, настройки формы) временно скрыта до перехода на сервер.
// Код и логика на месте: адрес с ?journal=1 возвращает всё как было.
const JOURNAL_ON = /[?&]journal=1(&|$)/.test(location.search);
document.documentElement.classList.toggle('no-journal', !JOURNAL_ON);
const LS_KEY = 'scadalog.v2';
const LS_OLD = 'worklog.v1';
const LS_BACKUP = 'scadalog.lastBackup';
const LS_ME = 'scadalog.me';
const FS_OK = 'showSaveFilePicker' in window;
const JSON_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];
const DEFAULTS = {
  deviceTypes: ['TCU', 'Трансформатор', 'Инвертор', 'DC-бокс', 'Панель / стринг', 'Другое'],
  actions: ['Остановка', 'Запуск', 'Ручной режим', 'Изменение угла', 'Возврат в авто', 'Сброс аварии', 'Справка / проверка', 'Другое']
};
const RX_RESTORE = /ручн|угл|угол|наклон/i; // → «вернуть в исходное»
const RX_ANGLE = /угл|угол|наклон/i;
const RX_AUTO = /авто|исходн/i;
const RX_RUN = /запуск|включ|пуск/i;
const mqMobile = window.matchMedia('(max-width: 860px)');

/* ---------- утилиты ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = v => { const d = new Date(v); return (v === '' || v == null || isNaN(d)) ? new Date().toISOString() : d.toISOString(); };
const str = v => String(v ?? '').trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fromKey = k => new Date(k + 'T00:00:00');
const todayKey = () => dayKey(new Date());
const toLocalInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const fmtAngle = a => String(a).replace('.', ',');
const hue = s => { let h = 11; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const isPhoneLike = q => /^[\d\s+()\-]{5,}$/.test(q.trim());
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return n + ' ' + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many);
}
const calls = n => plural(n, 'звонок', 'звонка', 'звонков');
const PHONE_BAD = 'Номер неполный. Нужно +998 и 9 цифр';
function normPhone(raw) { let d = String(raw || '').replace(/\D/g, ''); if (d.length === 9) d = '998' + d; return d; }
function fmtPhone(d) {
  if (!d) return '';
  if (d.length === 12 && d.startsWith('998')) return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  return (d.length >= 10 ? '+' : '') + d;
}
// Маска узбекского номера: +998 XX XXX XX XX. Код страны подставляется сам, пользователь вводит 9 цифр.
function maskUz(raw) {
  raw = String(raw || '');
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+998') || (d.startsWith('998') && d.length > 9)) d = d.slice(3);
  if (d.startsWith('998') && d.length > 9) d = d.slice(3); // вставили номер целиком в поле с готовым +998
  d = d.slice(0, 9);
  let t = '+998';
  if (d) t += ' ' + d.slice(0, 2);
  if (d.length > 2) t += ' ' + d.slice(2, 5);
  if (d.length > 5) t += ' ' + d.slice(5, 7);
  if (d.length > 7) t += ' ' + d.slice(7, 9);
  return { text: t, local: d };
}
function phoneFrom(el) {
  if (el.dataset.mask === 'off') return { phone: normPhone(el.value), bad: false };
  const { local } = maskUz(el.value);
  if (!local) return { phone: '', bad: false };
  return local.length === 9 ? { phone: '998' + local, bad: false } : { phone: '', bad: true };
}
function bindMask(el) {
  el.addEventListener('focus', () => {
    if (el.dataset.mask === 'off' || el.value) return;
    el.value = '+998 '; el.setSelectionRange(5, 5);
  });
  el.addEventListener('input', () => {
    if (el.dataset.mask === 'off') return;
    const raw = el.value, pos = el.selectionStart == null ? raw.length : el.selectionStart, atEnd = pos >= raw.length;
    const left = maskUz(raw.slice(0, pos)).local.length;
    const m = maskUz(raw);
    el.value = m.local ? m.text : '+998 ';
    let i = el.value.length;
    if (!atEnd) { let c = 0; for (i = 5; i < el.value.length && c < left; i++) if (/\d/.test(el.value[i])) c++; }
    el.setSelectionRange(i, i);
  });
  el.addEventListener('blur', () => { if (el.dataset.mask !== 'off' && !maskUz(el.value).local) el.value = ''; });
}
bindMask($('wPhone')); bindMask($('nwPhone'));

function longDate(d) {
  const o = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  const s = d.toLocaleDateString('ru-RU', o);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const shortDate = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
function fmtAgo(fromIso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fromIso)) / 60000));
  if (min < 60) return min + ' мин';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' ч ' + (min % 60) + ' мин';
  return Math.floor(h / 24) + ' д ' + (h % 24) + ' ч';
}
function toast(msg, opt = {}) {
  $('toastText').textContent = msg;
  $('toast').classList.toggle('error', !!opt.error);
  const b = $('toastAct');
  b.hidden = !opt.action;
  if (opt.action) { b.textContent = opt.action.label; b.onclick = () => { opt.action.fn(); $('toast').classList.remove('show'); }; }
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), opt.action ? 6000 : 2600);
}

