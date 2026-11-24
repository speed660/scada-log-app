/* ---------- выбор работника ---------- */
let whoItems = [], whoActive = -1;
function clearWho() {
  form.workerId = ''; form.newWorker = false;
  $('fWho').value = ''; $('fWho').hidden = false;
  $('whoChip').hidden = true; $('newWorker').hidden = true;
  closeWhoList();
}
function selectWorker(id) {
  const w = findW(id); if (!w) return;
  form.workerId = id; form.newWorker = false;
  $('whoChipText').innerHTML = `<b>${esc(w.name || 'Без имени')}</b>${w.phone ? `<small>${esc(fmtPhone(w.phone))}</small>` : ''}`;
  $('whoChip').hidden = false; $('fWho').hidden = true; $('newWorker').hidden = true;
  closeWhoList();
}
function startNewWorker(q) {
  form.workerId = ''; form.newWorker = true;
  const ph = isPhoneLike(q);
  $('nwName').value = ph ? '' : q.trim();
  $('nwPhone').value = ph && maskUz(q).local ? maskUz(q).text : '';
  $('fWho').hidden = true; $('whoChip').hidden = true; $('newWorker').hidden = false;
  closeWhoList();
  (ph ? $('nwName') : $('nwPhone')).focus();
}
function whoMatches(q) {
  const t = q.trim().toLowerCase(), digits = q.replace(/\D/g, ''), st = workerStats();
  return aliveW()
    .filter(w => !t || w.name.toLowerCase().includes(t) || (digits.length >= 2 && w.phone.includes(digits)))
    .sort((a, b) => ((st.get(b.id) || {}).last || '').localeCompare((st.get(a.id) || {}).last || '') || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 8);
}
function drawWho() {
  $('whoList').innerHTML = whoItems.map((it, i) => it.w
    ? `<div class="opt${i === whoActive ? ' active' : ''}" role="option" data-i="${i}"><b>${esc(it.w.name || 'Без имени')}</b><small>${esc(fmtPhone(it.w.phone))}</small></div>`
    : `<div class="opt add${i === whoActive ? ' active' : ''}" role="option" data-i="${i}">Добавить в базу: «${esc(it.add)}»</div>`).join('');
}
function renderWhoList() {
  const q = $('fWho').value, qt = q.trim(), p = normPhone(qt);
  const matches = whoMatches(q);
  whoItems = matches.map(w => ({ w }));
  if (qt && !matches.some(w => w.name.toLowerCase() === qt.toLowerCase() || (p.length >= 7 && w.phone === p))) whoItems.push({ add: qt });
  if (!whoItems.length) { closeWhoList(); return; }
  whoActive = qt ? 0 : -1;
  drawWho();
  $('whoList').hidden = false; $('fWho').setAttribute('aria-expanded', 'true');
}
function closeWhoList() { $('whoList').hidden = true; $('fWho').setAttribute('aria-expanded', 'false'); whoActive = -1; }
function chooseWho(i) { const it = whoItems[i]; if (!it) return; if (it.w) { selectWorker(it.w.id); $('fDev').focus(); } else startNewWorker(it.add); }
$('fWho').addEventListener('input', renderWhoList);
$('fWho').addEventListener('focus', renderWhoList);
$('fWho').addEventListener('blur', () => setTimeout(closeWhoList, 120));
$('fWho').addEventListener('keydown', e => {
  if ($('whoList').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    whoActive = (whoActive + (e.key === 'ArrowDown' ? 1 : -1) + whoItems.length) % whoItems.length;
    drawWho();
  } else if (e.key === 'Enter' && whoActive >= 0 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); chooseWho(whoActive); }
  else if (e.key === 'Escape') { e.stopPropagation(); closeWhoList(); }
});
$('whoList').addEventListener('mousedown', e => e.preventDefault());
$('whoList').addEventListener('click', e => { const o = e.target.closest('[data-i]'); if (o) chooseWho(+o.dataset.i); });
$('whoClear').onclick = () => { clearWho(); $('fWho').focus(); };
$('nwCancel').onclick = () => { clearWho(); $('fWho').focus(); };

function resolveCaller() {
  if (form.workerId) return { w: findW(form.workerId) };
  let name = '', phone = '';
  if (form.newWorker) {
    const ph = phoneFrom($('nwPhone'));
    if (ph.bad) { $('nwPhone').focus(); return { error: PHONE_BAD }; }
    name = $('nwName').value.trim(); phone = ph.phone;
    if (!name && !phone) return { error: 'Укажи имя или телефон работника' };
  } else {
    const q = $('fWho').value.trim();
    if (!q) return { w: null };
    const p = normPhone(q);
    const byPhone = p.length >= 7 && aliveW().find(w => w.phone === p);
    if (byPhone) return { w: byPhone };
    const byName = aliveW().filter(w => w.name.toLowerCase() === q.toLowerCase());
    if (byName.length === 1) return { w: byName[0] };
    if (isPhoneLike(q)) { if (p.length !== 12 || !p.startsWith('998')) return { error: PHONE_BAD }; phone = p; } else name = q;
  }
  const dup = phone && aliveW().find(w => w.phone === phone);
  if (dup) return { w: dup, note: 'Номер уже есть в базе: ' + (dup.name || fmtPhone(dup.phone)) };
  const now = new Date().toISOString();
  const w = { id: uid(), name, phone, note: '', createdAt: now, updatedAt: now, deleted: false };
  state.workers.push(w);
  return { w, added: true };
}

function saveEntry() {
  if (adding) commitOwn(adding);
  if (!form.action) { toast('Выбери, что просили', { error: true }); return; }
  const device = $('fDev').value.trim(), location = $('fLoc').value.trim();
  if (!device && !location) { toast('Укажи номер устройства или место', { error: true }); $('fDev').focus(); return; }
  const rawA = $('fAngle').value.trim().replace(',', '.');
  const angle = rawA === '' ? null : Number(rawA);
  if (angle !== null && (!isFinite(angle) || Math.abs(angle) > 90)) { toast('Угол: число от -90 до 90', { error: true }); $('fAngle').focus(); return; }
  // Поле времени хранит минуты. Если при правке время не трогали, оставляем исходное значение с секундами, иначе оно «меняется» само.
  const cur0 = editingId && find(editingId);
  const tsIso = cur0 && $('fTs').value === toLocalInput(new Date(cur0.ts)) ? cur0.ts
    : (tsAuto && !editingId) || !$('fTs').value ? new Date().toISOString() : new Date($('fTs').value).toISOString();
  if (new Date(tsIso) - Date.now() > 10 * 60000) { toast('Время звонка в будущем. Проверь дату и время', { error: true }); $('fTs').focus(); return; }
  const me = $('fBy').value.trim().replace(/\s+/g, ' ');
  if (!me) { toast('Укажи, кто записывает: поле «Диспетчер»', { error: true }); $('fBy').focus(); if (mqMobile.matches) $('fBy').scrollIntoView({ block: 'center' }); return; }
  const r = resolveCaller();
  if (r.error) { toast(r.error, { error: true }); return; }
  const now = new Date().toISOString(), w = r.w, restore = $('fRestore').checked;
  const data = {
    ts: tsIso,
    workerId: w ? w.id : '', callerName: w ? w.name : '', callerPhone: w ? w.phone : '',
    deviceType: form.type, location, device, action: form.action, angle,
    open: editingId && find(editingId) ? !!find(editingId).open : false, restore, origState: restore ? $('fOrig').value.trim() : '',
    notes: $('fNotes').value.trim(), updatedAt: now
  };
  if (editingId) {
    const cur = find(editingId);
    if (!cur || !canEdit(cur)) { toast('Эта запись уже в прошлом дне, её нельзя менять', { error: true }); resetComposer(); closeSheet(); render(); return; }
    if (dayKey(new Date(tsIso)) !== todayKey()) { toast('Сегодняшнюю запись нельзя перенести на другой день', { error: true }); $('fTs').focus(); return; }
  }
  const wasEdit = !!editingId;
  let id = editingId;
  try { localStorage.setItem(LS_ME, me); } catch (e) { /* нет доступа */ }
  if (wasEdit) {
    const en = find(editingId);
    const ch = en ? diffEntry(en, data) : [];
    if (!ch.length) { resetComposer(); closeSheet(); render(); toast('Изменений нет'); return; }
    Object.assign(en, data);
    en.history = [...(en.history || []), { at: now, by: me, ch }].slice(-30);
  }
  else {
    id = uid();
    state.entries.push({ id, createdAt: now, linkedTo: linkingId || '', closedBy: '', deleted: false, by: me, history: [], ...data });
    const orig = linkingId && find(linkingId);
    if (orig) { orig.closedBy = id; orig.updatedAt = now; }
  }
  persist();
  viewDay = dayKey(new Date(data.ts));
  resetComposer(); closeSheet(); render(); flash(id);
  toast(r.note || (wasEdit ? 'Изменения сохранены' : r.added ? 'Записано, работник добавлен в базу' : 'Записано'));
}
$('form').addEventListener('submit', e => { e.preventDefault(); saveEntry(); });

