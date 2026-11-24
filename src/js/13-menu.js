/* ---------- меню ---------- */
let curTab = 'workers', wEditing = null, wOpen = null;
function openDrawer(tab) {
  closeSheet();
  if (tab) curTab = tab;
  $('drawer').hidden = false; $('scrim').hidden = false;
  renderDrawer();
}
function closeDrawer() {
  $('drawer').hidden = true;
  if (!$('composer').classList.contains('open')) $('scrim').hidden = true;
}
function renderDrawer() {
  if ($('drawer').hidden) return;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === curTab));
  ['workers', 'data', 'lists'].forEach(t => { $('tab-' + t).hidden = t !== curTab; });
  if (curTab === 'workers') renderWorkers();
  if (curTab === 'data') { updateFileUI(); renderBackupState(); renderGhSection(); }
  if (curTab === 'lists') { $('sTypes').value = state.settings.deviceTypes.join('\n'); $('sActions').value = state.settings.actions.join('\n'); $('sAlert').value = String(state.settings.alertHours).replace('.', ','); fillSite(); renderCal(); }
}
$('btnMenu').onclick = () => openDrawer();
$('drawerClose').onclick = closeDrawer;
$('scrim').onclick = () => { closeDrawer(); closeSheet(); };
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { curTab = b.dataset.tab; renderDrawer(); } };

/* работники */
function renderWorkers() {
  const q = $('wFilter').value.trim().toLowerCase(), qd = q.replace(/\D/g, ''), st = workerStats();
  const ws = aliveW()
    .filter(w => !q || w.name.toLowerCase().includes(q) || (qd.length >= 2 && w.phone.includes(qd)) || w.note.toLowerCase().includes(q))
    .sort((a, b) => ((st.get(b.id) || {}).last || '').localeCompare((st.get(a.id) || {}).last || '') || a.name.localeCompare(b.name, 'ru'));
  if (!ws.length) {
    $('wList').innerHTML = `<p class="note" style="margin-top:8px">${aliveW().length ? 'Никого не нашлось.' : 'База пуста. Добавь работника выше или прямо в форме звонка: впиши имя или номер и выбери «Добавить в базу».'}</p>`;
    return;
  }
  $('wList').innerHTML = ws.map(w => {
    const s = st.get(w.id);
    const meta = s ? calls(s.n) + ', последний ' + shortDate(new Date(s.last)) + ' в ' + hm(new Date(s.last)) : 'Звонков пока нет';
    let list = '';
    if (wOpen === w.id) {
      const items = alive().filter(e => e.workerId === w.id).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 15);
      list = items.length ? `<ul class="w-calls">${items.map(e => `<li><button type="button" data-goto="${esc(e.id)}"><time>${esc(shortDate(new Date(e.ts)))}, ${hm(new Date(e.ts))}</time>${esc(e.device || e.location)}: ${esc(e.action)}</button></li>`).join('')}</ul>` : '';
    }
    return `<div class="w-row" data-wid="${esc(w.id)}">
      <div class="w-name">${esc(w.name || 'Без имени')}</div>
      ${w.phone ? `<a href="tel:+${esc(w.phone)}">${esc(fmtPhone(w.phone))}</a>` : ''}
      ${w.note ? `<div class="w-meta">${esc(w.note)}</div>` : ''}
      <div class="w-meta">${meta}</div>
      <div class="w-acts">${s ? `<button type="button" data-wact="calls">${wOpen === w.id ? 'Скрыть звонки' : 'Звонки'}</button>` : ''}<button type="button" data-wact="edit">Изменить</button><button type="button" class="del" data-wact="del">Удалить</button></div>
      ${list}</div>`;
  }).join('');
}
function resetWForm() {
  wEditing = null;
  ['wName', 'wPhone', 'wNote'].forEach(id => { $(id).value = ''; });
  $('wPhone').dataset.mask = '';
  $('wFormTitle').textContent = 'Добавить работника';
  $('wCancel').hidden = true;
}
$('wFilter').addEventListener('input', renderWorkers);
$('wCancel').onclick = resetWForm;
$('wForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const name = $('wName').value.trim(), ph = phoneFrom($('wPhone')), phone = ph.phone;
  if (ph.bad) { toast(PHONE_BAD, { error: true }); $('wPhone').focus(); return; }
  if (!name && !phone) { toast('Укажи имя или телефон', { error: true }); $('wName').focus(); return; }
  const dup = phone && aliveW().find(w => w.phone === phone && w.id !== wEditing);
  if (dup) { toast('Этот номер уже у: ' + (dup.name || fmtPhone(dup.phone)), { error: true }); $('wPhone').focus(); return; }
  const now = new Date().toISOString();
  const data = { name, phone, note: $('wNote').value.trim(), updatedAt: now };
  const wasEdit = !!wEditing;
  if (wasEdit) Object.assign(findW(wEditing), data);
  else state.workers.push({ id: uid(), createdAt: now, deleted: false, ...data });
  if (wasEdit && form.workerId === wEditing) selectWorker(wEditing);
  resetWForm(); persist(); render(); renderWorkers();
  toast(wasEdit ? 'Данные работника сохранены' : 'Работник добавлен');
});
$('wList').addEventListener('click', ev => {
  const b = ev.target.closest('[data-wact]'); if (!b) return;
  const w = findW(b.closest('[data-wid]').dataset.wid); if (!w) return;
  const act = b.dataset.wact;
  if (act === 'calls') { wOpen = wOpen === w.id ? null : w.id; renderWorkers(); }
  else if (act === 'edit') {
    wEditing = w.id;
    $('wName').value = w.name; $('wPhone').value = fmtPhone(w.phone); $('wNote').value = w.note;
    $('wPhone').dataset.mask = w.phone && !w.phone.startsWith('998') ? 'off' : '';
    $('wFormTitle').textContent = 'Изменить работника'; $('wCancel').hidden = false;
    $('tab-workers').scrollTop = 0; $('wName').focus();
  } else if (act === 'del') {
    if (!confirm('Удалить «' + (w.name || fmtPhone(w.phone)) + '» из базы? Его звонки в журнале останутся.')) return;
    const now = new Date().toISOString();
    for (const e of state.entries) if (e.workerId === w.id) { e.callerName = w.name; e.callerPhone = w.phone; e.updatedAt = now; }
    w.deleted = true; w.updatedAt = now;
    if (form.workerId === w.id) clearWho();
    if (wEditing === w.id) resetWForm();
    persist(); render(); renderWorkers();
    toast('Работник удалён из базы');
  }
});

/* списки */
$('btnResetLists').onclick = () => { $('sTypes').value = DEFAULTS.deviceTypes.join('\n'); $('sActions').value = DEFAULTS.actions.join('\n'); };
$('btnSaveLists').onclick = () => {
  const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const ah = $('sAlert').value.trim() === '' ? 2 : parseFloat($('sAlert').value.replace(',', '.'));
  if (!isFinite(ah) || ah < 0 || ah > 72) { toast('Часы: число от 0 до 72', { error: true }); $('sAlert').focus(); return; }
  state.settings = normSettings({ ...state.settings, deviceTypes: lines('sTypes'), actions: lines('sActions'), alertHours: ah, updatedAt: new Date().toISOString() });
  persist(); renderPickers(); render();
  toast('Списки сохранены');
};

/* ---------- клавиатура ---------- */
document.addEventListener('keydown', e => {
  if (!$('loader').hidden || !$('passDlg').hidden) return;
  if (e.key === 'Escape') {
    if (!$('scadaView').hidden) { closeScada(); return; }
    if (!$('mapView').hidden) { if (mapZoom) mapBack(); else if (JOURNAL_ON) closeMap(); return; }
    if (!$('drawer').hidden) { closeDrawer(); return; }
    if ($('composer').classList.contains('open')) { closeSheet(); return; }
    if (editingId || linkingId) { resetComposer(); return; }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && $('composer').contains(document.activeElement)) { e.preventDefault(); saveEntry(); return; }
  const tagName = (document.activeElement && document.activeElement.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tagName) || e.ctrlKey || e.metaKey || e.altKey || !$('drawer').hidden || !$('mapView').hidden || !$('scadaView').hidden) return;
  if (['n', 'N', 'т', 'Т'].includes(e.key)) { e.preventDefault(); openComposer(); }
  else if (e.key === 'ArrowLeft') shiftDay(-1);
  else if (e.key === 'ArrowRight' && viewDay < todayKey()) shiftDay(1);
});

// Если журнал открыт в двух вкладках, запись из одной сразу появляется в другой и не затирается.
window.addEventListener('storage', e => {
  if (e.key !== LS_KEY || !e.newValue) return;
  try { absorb(parseData(JSON.parse(e.newValue))); renderPickers(); render(); renderDrawer(); renderSolar(); writeFile(); } catch (err) { console.warn(err); }
});

window.addEventListener('online', () => { if (ghReady() && !gh.halted) ghRun(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ghReady() && !gh.halted && !gh.running) ghRun(); });
window.addEventListener('beforeunload', e => { if (ghReady() && (gh.dirty || gh.running)) { e.preventDefault(); e.returnValue = ''; } });

