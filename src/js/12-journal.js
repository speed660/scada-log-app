/* ---------- день ---------- */
function stateHTML(e, byId) {
  if (isPending(e)) return `<span class="c-state ${isLate(e) ? 'late' : 'open'}">${esc(needText(e))}${isLate(e) ? '. Ждёт уже ' + fmtAgo(e.ts) : ''}</span>`;
  if (e.closedBy && (e.open || e.restore)) {
    const c = byId.get(e.closedBy);
    const what = e.restore && !e.open ? 'Возвращено в исходное' : 'Запущено';
    return `<span class="c-state done">${what}${c && !c.deleted ? ' в ' + hm(new Date(c.ts)) : ''}</span>`;
  }
  if (e.linkedTo) {
    const o = byId.get(e.linkedTo);
    if (o) return `<span class="c-state link">После «${esc(o.action)}» в ${hm(new Date(o.ts))}${dayKey(new Date(o.ts)) !== dayKey(new Date(e.ts)) ? ', ' + shortDate(new Date(o.ts)) : ''}</span>`;
  }
  return '';
}
const HUES = [192, 28, 262, 140, 335, 215, 55, 0, 100, 300];
const typeHue = t => { const i = state.settings.deviceTypes.indexOf(t); return i >= 0 ? HUES[i % HUES.length] : hue(t); };
const tag = t => t ? `<span class="tag" style="--h:${typeHue(t)}">${esc(t)}</span>` : '';
const whatText = e => `${tag(e.deviceType)}<b>${esc(e.device || e.location || '—')}</b>${e.device && e.location ? ', ' + esc(e.location) : ''}. ${esc(e.action)}${e.angle != null ? ', угол ' + fmtAngle(e.angle) + '°' : ''}`;
const histOpen = new Set();
const histVal = (k, v) => k === 'ts' ? (v ? hm(new Date(v)) : '') : v;
function histHTML(e) {
  const h = e.history || [];
  if (!h.length) return '';
  const items = h.map(x => `<li><b>${hm(new Date(x.at))}${x.by ? ' ' + esc(x.by) : ''}:</b> ` + x.ch.map(c => `${esc(FIELD_LABELS[c.k] || c.k)}: «${esc(histVal(c.k, c.a)) || '—'}» → «${esc(histVal(c.k, c.b)) || '—'}»`).join('; ') + '</li>').join('');
  return `<details class="c-hist" data-hid="${esc(e.id)}"${histOpen.has(e.id) ? ' open' : ''}><summary>Правок: ${h.length}</summary><ul>${items}</ul></details>`;
}
document.addEventListener('toggle', ev => {
  const d = ev.target;
  if (d && d.classList && d.classList.contains('c-hist')) { if (d.open) histOpen.add(d.dataset.hid); else histOpen.delete(d.dataset.hid); }
}, true);
function callHTML(e, byId) {
  const c = callerOf(e), pending = isPending(e);
  const who = c.name || c.phone
    ? `<b>${esc(c.name || fmtPhone(c.phone))}</b>${c.name && c.phone ? `<a href="tel:+${esc(c.phone)}">${esc(fmtPhone(c.phone))}</a>` : ''}`
    : '<span class="muted">Звонивший не указан</span>';
  return `<li class="call${pending ? ' is-open' : ''}${isLate(e) ? ' late' : ''}" data-id="${esc(e.id)}">
    <time class="c-time" datetime="${esc(e.ts)}">${hm(new Date(e.ts))}</time><span class="c-dot"></span>
    <div class="c-body">
      <div class="c-who">${who}</div>
      <div class="c-what">${whatText(e)}</div>
      ${stateHTML(e, byId)}
      ${e.notes ? `<p class="c-notes">${esc(e.notes)}</p>` : ''}
      ${e.by ? `<p class="c-meta">Записал: ${esc(e.by)}</p>` : ''}
      ${histHTML(e)}
      <div class="c-acts">
        ${pending ? '<button type="button" class="ret" data-act="return">Вернуть</button>' : ''}
        <button type="button" data-act="repeat">Повторить</button>
        ${canEdit(e) ? '<button type="button" data-act="edit">Изменить</button>' : ''}
      </div>
    </div></li>`;
}
function render() {
  const all = alive(), byId = new Map(state.entries.map(e => [e.id, e]));
  const d0 = fromKey(viewDay), d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const day = all.filter(e => { const t = new Date(e.ts); return t >= d0 && t < d1; }).sort((a, b) => b.ts.localeCompare(a.ts));
  const isToday = viewDay === todayKey();

  $('dayTitle').textContent = longDate(d0);
  $('daySub').textContent = (isToday ? 'Сегодня, ' : 'Только просмотр, ') + (day.length ? calls(day.length) : 'звонков нет');
  $('nextDay').disabled = viewDay >= todayKey();
  $('btnToday').hidden = isToday;
  $('dayPick').value = viewDay;
  $('dayPick').max = todayKey();

  // лента суток
  const pct = t => ((t.getHours() * 60 + t.getMinutes()) / 1440 * 100).toFixed(3) + '%';
  $('tapeTrack').innerHTML = day.map(e => {
    const t = new Date(e.ts), c = callerOf(e);
    return `<button type="button" class="mk${isLate(e) ? ' late' : isPending(e) ? ' open' : ''}" style="left:${pct(t)}" data-goto="${esc(e.id)}" title="${esc(hm(t) + ' ' + (c.name || '') + ': ' + (e.device || e.location) + ', ' + e.action)}" aria-label="${esc(hm(t) + ', ' + (e.device || e.location))}"></button>`;
  }).join('') + (isToday ? `<span class="now" style="left:${pct(new Date())}"></span>` : '');
  $('tapeHours').innerHTML = [0, 3, 6, 9, 12, 15, 18, 21].map(h => `<span${h % 6 ? ' class="minor"' : ''} style="left:${h / 24 * 100}%">${pad(h)}:00</span>`).join('');

  // ожидают возврата (за все дни)
  const open = all.filter(isPending).sort((a, b) => a.ts.localeCompare(b.ts));
  $('waiting').hidden = !open.length;
  const late = open.filter(isLate);
  $('waitTitle').textContent = 'Ожидают возврата: ' + open.length + (late.length ? ', просрочено: ' + late.length : '');
  $('waiting').classList.toggle('has-late', late.length > 0);
  document.title = (late.length ? '(' + late.length + ') ' : '') + 'Журнал диспетчера';
  $('waitList').innerHTML = open.map(e => {
    const c = callerOf(e);
    return `<div class="w-item${isLate(e) ? ' late' : ''}" data-id="${esc(e.id)}">
      <button type="button" class="what" data-goto="${esc(e.id)}">${whatText(e)}${c.name ? '. Звонил ' + esc(c.name) : ''}<span class="need">${esc(needText(e))}</span></button>
      <span class="ago" title="${esc(new Date(e.ts).toLocaleString('ru-RU'))}">${fmtAgo(e.ts)}</span>
      <button type="button" class="btn-return" data-act="return">Вернуть</button></div>`;
  }).join('');

  // звонки дня
  $('calls').innerHTML = day.map(e => callHTML(e, byId)).join('');
  $('empty').hidden = !!day.length;
  if (!day.length) {
    const prev = all.filter(e => new Date(e.ts) < d0).sort((a, b) => b.ts.localeCompare(a.ts))[0];
    $('empty').innerHTML = (isToday && !all.length
      ? 'Здесь появятся звонки с поля. Заполни форму и нажми «Записать».'
      : 'За этот день звонков не записано.') +
      (prev ? `<br><button type="button" class="ghost" data-day="${dayKey(new Date(prev.ts))}">Перейти к ${esc(shortDate(new Date(prev.ts)))}, последний день со звонками</button>` : '');
  }
}
function goToDay(k, flashId) { viewDay = k > todayKey() ? todayKey() : k; render(); if (flashId) flash(flashId); }
function shiftDay(n) { const d = fromKey(viewDay); d.setDate(d.getDate() + n); goToDay(dayKey(d)); }
function flash(id) {
  const el = [...document.querySelectorAll('.call')].find(x => x.dataset.id === id);
  if (!el) return;
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
$('prevDay').onclick = () => shiftDay(-1);
$('nextDay').onclick = () => shiftDay(1);
$('btnToday').onclick = () => goToDay(todayKey());
$('dayPick').onchange = () => { if ($('dayPick').value) goToDay($('dayPick').value); };

document.addEventListener('click', ev => {
  const g = ev.target.closest('[data-goto]');
  if (g) { const e = find(g.dataset.goto); if (e) { if (!$('drawer').hidden) closeDrawer(); goToDay(dayKey(new Date(e.ts)), e.id); } return; }
  const dbtn = ev.target.closest('[data-day]');
  if (dbtn) { goToDay(dbtn.dataset.day); return; }
  const a = ev.target.closest('[data-act]');
  if (!a) return;
  const row = a.closest('[data-id]'), e = row && find(row.dataset.id);
  if (!e) return;
  const act = a.dataset.act;
  if (act === 'return') loadComposer('return', e);
  else if (act === 'repeat') loadComposer('repeat', e);
  else if (act === 'edit') { if (canEdit(e)) loadComposer('edit', e); else toast('Записи прошлых дней нельзя менять', { error: true }); }
});

