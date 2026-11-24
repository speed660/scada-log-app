/* ---------- форма звонка ---------- */
let adding = null; // 'type' | 'action' — добавление своего пункта
function lastUsedType() {
  const e = [...alive()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return e ? e.deviceType : '';
}
function closeActionFor(e) {
  const acts = state.settings.actions;
  const order = e.restore && !e.open ? [RX_AUTO, RX_RUN] : [RX_RUN, RX_AUTO];
  for (const rx of order) { const a = acts.find(x => rx.test(x)); if (a) return a; }
  return '';
}
function pickHTML(kind, list, cur) {
  const items = [...list]; if (cur && !items.includes(cur)) items.push(cur);
  return items.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(v)}</button>`).join('') +
    (adding === kind
      ? `<span class="own"><input id="own-${kind}" maxlength="40" placeholder="${kind === 'type' ? 'Своё устройство' : 'Своё действие'}" aria-label="${kind === 'type' ? 'Своё устройство' : 'Своё действие'}"><button type="button" class="own-ok" data-own="${kind}">Добавить</button></span>`
      : `<button type="button" class="add-own" data-add="${kind}">+ Своё</button>`);
}
function renderPickers() {
  $('pType').innerHTML = pickHTML('type', state.settings.deviceTypes, form.type);
  $('pAction').innerHTML = pickHTML('action', state.settings.actions, form.action);
}
const syncAngle = () => { $('angleGroup').hidden = !(RX_ANGLE.test(form.action) || $('fAngle').value.trim() !== ''); renderSolar(); };
const syncOrig = () => { $('origGroup').hidden = !$('fRestore').checked; };
function applyType(v) { form.type = v; renderPickers(); fillDatalists(); }
function applyAction(v) {
  form.action = v;
  if (!editingId && !linkingId) { $('fRestore').checked = RX_RESTORE.test(v); syncOrig(); }
  renderPickers(); syncAngle();
  if (!$('angleGroup').hidden) $('fAngle').focus();
}
function commitOwn(kind) {
  const inp = $('own-' + kind), v = inp ? inp.value.trim() : '';
  adding = null;
  if (v) {
    const key = kind === 'type' ? 'deviceTypes' : 'actions';
    const exist = state.settings[key].find(x => x.toLowerCase() === v.toLowerCase());
    const val = exist || v;
    if (!exist) { state.settings[key].push(v); state.settings.updatedAt = new Date().toISOString(); persist(); toast('Добавлено в список: ' + v); }
    if (kind === 'type') applyType(val); else applyAction(val);
  } else renderPickers();
}
function onPick(kind, ev) {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.add) { adding = kind; renderPickers(); $('own-' + kind).focus(); return; }
  if (b.dataset.own) { commitOwn(kind); return; }
  if (b.dataset.v !== undefined) { if (adding) adding = null; kind === 'type' ? applyType(b.dataset.v) : applyAction(b.dataset.v); }
}
$('pType').onclick = ev => onPick('type', ev);
$('pAction').onclick = ev => onPick('action', ev);
$('composer').addEventListener('keydown', ev => {
  const inp = ev.target.closest && ev.target.closest('.own input');
  if (!inp) return;
  const kind = inp.id.replace('own-', '');
  if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commitOwn(kind); }
  else if (ev.key === 'Escape') { ev.stopPropagation(); adding = null; renderPickers(); }
});
$('fRestore').addEventListener('change', () => { syncOrig(); if ($('fRestore').checked) $('fOrig').focus(); });

function uniqRecent(key, pred) {
  const seen = new Set(), out = [];
  for (const e of [...alive()].sort((a, b) => b.ts.localeCompare(a.ts))) {
    if (pred && !pred(e)) continue;
    const v = e[key];
    if (v && !seen.has(v)) { seen.add(v); out.push(v); if (out.length >= 300) break; }
  }
  return out;
}
const opts = arr => arr.map(v => `<option value="${esc(v)}">`).join('');
function fillDatalists() {
  $('dlDev').innerHTML = opts(uniqRecent('device', e => e.deviceType === form.type));
  $('dlLoc').innerHTML = opts(uniqRecent('location'));
  $('dlOrig').innerHTML = opts([...new Set(['Авто', 'Авто, угол 0°', 'В работе', ...uniqRecent('origState')])]);
  $('dlBy').innerHTML = opts([...new Set(alive().map(e => e.by).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')));
}
function setMode(mode) {
  $('cTitle').textContent = { new: 'Новый звонок', edit: 'Изменить запись', return: 'Возврат устройства', repeat: 'Повторный звонок' }[mode];
  $('btnCancelEdit').hidden = mode === 'new';
  $('btnSave').textContent = mode === 'edit' ? 'Сохранить изменения' : 'Записать';
}
// Что изменилось при правке записи: список {k, a, b}, где a — было, b — стало.
const FIELD_LABELS = { ts: 'время звонка', caller: 'звонивший', deviceType: 'устройство', device: 'номер', location: 'место', action: 'что просили', angle: 'угол', restore: 'вернуть в исходное', origState: 'исходное состояние', notes: 'примечание' };
function diffEntry(old, nw) {
  const out = [], cut = v => String(v == null ? '' : v).slice(0, 300);
  const add = (k, a, b) => { if (cut(a) !== cut(b)) out.push({ k, a: cut(a), b: cut(b) }); };
  const oc = callerOf(old);
  add('caller', oc.name || fmtPhone(oc.phone), nw.callerName || fmtPhone(nw.callerPhone));
  if (old.ts !== nw.ts) add('ts', old.ts, nw.ts);
  add('deviceType', old.deviceType, nw.deviceType); add('device', old.device, nw.device); add('location', old.location, nw.location);
  add('action', old.action, nw.action);
  add('angle', old.angle == null ? '' : fmtAngle(old.angle), nw.angle == null ? '' : fmtAngle(nw.angle));
  add('restore', old.restore ? 'да' : 'нет', nw.restore ? 'да' : 'нет');
  add('origState', old.origState, nw.origState); add('notes', old.notes, nw.notes);
  return out;
}
function resetComposer() {
  editingId = null; linkingId = null; adding = null; setMode('new');
  form.type = lastUsedType() || state.settings.deviceTypes[0] || '';
  form.action = '';
  clearWho();
  ['fDev', 'fLoc', 'fAngle', 'fNotes', 'fOrig'].forEach(id => { $(id).value = ''; });
  trkSel = null; trkItems = []; if ($('fTrk')) { $('fTrk').value = ''; closeTrkList(); renderTrk(); }
  $('fTs').value = toLocalInput(new Date()); tsAuto = true;
  $('fRestore').checked = false;
  renderPickers(); syncAngle(); syncOrig(); fillDatalists();
}
function loadComposer(mode, src) {
  resetComposer(); setMode(mode);
  editingId = mode === 'edit' ? src.id : null;
  linkingId = mode === 'return' ? src.id : null;
  form.type = src.deviceType;
  form.action = mode === 'return' ? closeActionFor(src) : src.action;
  $('fDev').value = src.device; $('fLoc').value = src.location;
  if (mode === 'return') {
    if (src.restore && src.origState) {
      const m = src.origState.match(/(-?\d+(?:[.,]\d+)?)\s*°/);
      if (m) $('fAngle').value = m[1].replace('.', ',');
      $('fNotes').value = 'Вернули в исходное: ' + src.origState;
    }
  } else {
    if (src.angle != null) $('fAngle').value = fmtAngle(src.angle);
    if (mode === 'edit') {
      $('fNotes').value = src.notes;
      $('fRestore').checked = src.restore; $('fOrig').value = src.origState;
    } else { $('fRestore').checked = RX_RESTORE.test(form.action); }
  }
  $('fTs').value = toLocalInput(mode === 'edit' ? new Date(src.ts) : new Date());
  tsAuto = mode !== 'edit';
  const w = findW(src.workerId);
  if (w && !w.deleted) selectWorker(w.id);
  else if (src.callerName || src.callerPhone) $('fWho').value = src.callerName || fmtPhone(src.callerPhone);
  renderPickers(); syncAngle(); syncOrig(); fillDatalists();
  openComposer(mode === 'edit' ? $('fNotes') : (form.workerId ? (mode === 'return' ? $('btnSave') : $('fDev')) : $('fWho')));
}
try { $('fBy').value = localStorage.getItem(LS_ME) || ''; } catch (e) { /* нет доступа */ }
function refreshTs() { if (tsAuto && !editingId) $('fTs').value = toLocalInput(new Date()); }
$('fTs').addEventListener('input', () => { tsAuto = false; renderSolar(); });
function openComposer(focusEl) {
  refreshTs(); renderSolar();
  if (mqMobile.matches) { $('composer').classList.add('open'); $('scrim').hidden = false; }
  setTimeout(() => (focusEl || (form.workerId ? $('fDev') : $('fWho'))).focus(), mqMobile.matches ? 260 : 0);
}
function closeSheet() {
  $('composer').classList.remove('open');
  if ($('drawer').hidden) $('scrim').hidden = true;
}
$('fab').onclick = () => openComposer();
$('btnSheetClose').onclick = closeSheet;
$('btnCancelEdit').onclick = () => { resetComposer(); closeSheet(); };


