/* ---------- Поиск TCU (в данных и коде «трекер»: одна клетка сетки = один TCU, привод на 2 ряда панелей) ---------- */
/* Данные станции лежат в приватном репозитории (map/trackers.json) и держатся только в памяти вкладки:
   «Заблокировать» и отключение GitHub их стирают. В браузере и в публичном репозитории их нет. */
const TRK_FILE = 'map/trackers.json', TRK_FIXES = 'map/corrections.json', DC_FILE = 'map/dc.json';
let mapLayout = null, mapSel = null, mapErr = '', mapLoading = null, mapZoom = false, mapDc = false;
let trkData = null, trkErr = '', trkLoading = null, trkItems = [], trkActive = -1, trkSel = null;
const nfmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
async function trkFile(path, optional) {
  const r = await ghFetch(ghApi('/contents/' + encPath(path) + (gh.cfg.branch ? '?ref=' + encodeURIComponent(gh.cfg.branch) : '')), {}, [404]);
  if (r.status === 404) { if (optional) return null; throw new GhError('В репозитории нет файла ' + path, { kind: 'notfound' }); }
  const j = r.data;
  if (!j || Array.isArray(j) || j.type !== 'file') throw new GhError('По пути ' + path + ' лежит не файл', { kind: 'notfound' });
  let b = j.content;
  if (!b && j.size > 0) b = (await ghFetch(ghApi('/git/blobs/' + j.sha))).data.content; // файл больше 1 МБ
  try { return JSON.parse(b64dec(b)); } catch (e) { throw new GhError('Файл ' + path + ' не читается', { kind: 'corrupt' }); }
}
function trkBuild(d, fx) {
  if (!d || d.app !== 'scada-map-data' || !Array.isArray(d.blocks)) throw new GhError('Файл трекеров в другом формате', { kind: 'corrupt' });
  const blocks = new Map(), cnt = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  let total = 0;
  for (const b of d.blocks) {
    if (!b || !Number.isInteger(b.n) || !Array.isArray(b.trackers)) continue;
    const nums = new Map(), pos = new Map();
    for (const t of b.trackers) if (Array.isArray(t) && t.length >= 3 && t.slice(0, 3).every(Number.isInteger)) { nums.set(t[0], [t[1], t[2]]); pos.set(t[1] + ',' + t[2], t[0]); }
    // В файл могут писать все, у кого есть токен, поэтому в разметку попадают только проверенные числа и строки.
    blocks.set(b.n, { n: b.n, phase: b.phase === 1 || b.phase === 2 ? b.phase : 0, freq: b.freq == null ? '' : String(b.freq), range: b.id_range == null ? '' : String(b.id_range), outer: cnt(b.outer), inner: cnt(b.inner), deep: cnt(b.deep), half: cnt(b.half), rows: cnt(b.grid_rows), cols: cnt(b.grid_cols), box: Array.isArray(b.box) && b.box.length >= 2 && b.box.slice(0, 2).every(Number.isInteger) ? b.box : null, nums, pos });
    total += nums.size;
  }
  if (!blocks.size) throw new GhError('В файле трекеров нет блоков', { kind: 'corrupt' });
  const fixes = fx && Array.isArray(fx.items) ? fx.items.filter(i => i && Number.isInteger(i.block) && i.status !== 'rejected') : [];
  return { blocks, total, fixes };
}
/* DC-ящики (комбайнер-боксы, 汇流箱) из map/dc.json: место ящика на сетке блока и, где на чертеже подписаны стринги, его трекеры.
   Файл могут менять все, у кого есть токен, поэтому в дело идут только проверенные числа и номера вида «07». */
function dcBuild(d, td) {
  const out = new Map(), int = v => Number.isInteger(v) && v >= 0;
  if (!d || d.app !== 'scada-map-dc' || !Array.isArray(d.blocks)) return out;
  for (const b of d.blocks) {
    if (!b || !int(b.n) || !td.blocks.has(b.n) || !Array.isArray(b.boxes)) continue;
    const boxes = new Map(), owner = new Map();
    for (const x of b.boxes) {
      if (!x || typeof x.id !== 'string' || !/^\d{2}$/.test(x.id) || !Array.isArray(x.cell) || x.cell.length < 2 || !int(x.cell[0]) || !int(x.cell[1])) continue;
      const trs = Array.isArray(x.trackers) ? x.trackers.filter(int) : [];
      boxes.set(x.id, { id: x.id, cell: [x.cell[0], x.cell[1]], near: int(x.near) ? x.near : 0, trackers: trs });
      for (const t of trs) owner.set(t, x.id);
    }
    if (boxes.size) out.set(b.n, { exact: b.source === 'подписи', boxes, owner });
  }
  return out;
}
const dcRanges = a => { // [1,2,3,7,9,10] → «1–3, 7, 9–10»
  const s = [...a].sort((x, y) => x - y), out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? '' + s[i] : s[i] + '–' + s[j]); i = j; }
  return out.join(', ');
};
/* Запрос DC-ящика: «13.07», «дс 13 07», «бокс 13-07», «13.07.05» (стринг). Без слова понимаем только запись через точку. */
function dcParse(q) {
  const s = String(q || '').toLowerCase().replace(/ё/g, 'е').trim();
  const word = /(^|[^a-zа-я])(dc|дс|дисбокс|бокс|ящик|комбайнер)/.test(s) || s.includes('汇流箱');
  const m = s.match(/(\d{1,2})\s*[.\s/-]\s*(\d{1,2})(?:\s*[.-]\s*(\d{1,2}))?/);
  if (!m) return null;
  const dot = /^[^\d]*\d{1,2}\.\d{2}(\.\d{1,2})?[^\d]*$/.test(s);
  if (!word && !dot) return null;
  return { b: +m[1], id: String(+m[2]).padStart(2, '0'), s: m[3] ? String(+m[3]).padStart(2, '0') : '', only: word || !!m[3] };
}
function trkLoad() {
  if (trkData) return Promise.resolve(true);
  if (!ghReady()) { renderTrk(); return Promise.resolve(false); }
  if (trkLoading) return trkLoading;
  trkErr = '';
  trkLoading = (async () => {
    try {
      const d = await trkFile(TRK_FILE, false);
      let fx = null;
      try { fx = await trkFile(TRK_FIXES, true); } catch (e) { fx = null; } // список поправок не обязателен
      let dc = null;
      try { dc = await trkFile(DC_FILE, true); } catch (e) { dc = null; } // DC-ящики тоже необязательны
      if (!ghToken) return false; // пока грузили, GitHub заблокировали: данные не оставляем
      trkData = trkBuild(d, fx);
      trkData.dc = dcBuild(dc, trkData);
      return true;
    } catch (e) { trkData = null; trkErr = (e && e.message) || 'неизвестная ошибка'; return false; }
    finally { trkLoading = null; renderTrk(); renderGh(); }
  })();
  renderTrk();
  return trkLoading;
}
function trkClear() {
  trkData = null; trkErr = ''; trkSel = null; trkItems = [];
  mapLayout = null; mapSel = null; mapErr = ''; mapZoom = false; mapDc = false; closeMap();
  if ($('fTrk')) { $('fTrk').value = ''; closeTrkList(); renderTrk(); }
}
/* Разбор запроса. Понимает «13-87», «13 87», «13/87», «блок 13 трекер 87», «блок 13 tcu 87», «трекер 87 блок 13», «BLK13-TRK087», «б13 т87», «13б 87т».
   Одно число без слов неоднозначно: это может быть и блок, и номер трекера. */
const TRK_B = ['(?:блока|блок|block|blk|бл)', '(?:б|b)'], TRK_T = ['(?:трекера|трекер|tracker|trk|tcu|тсу|тцу|тр)', '(?:т|t)'];
function trkAssoc(s, w) {
  const tries = [
    ['(?:^|[^a-zа-я])' + w[0] + '\\.?\\s*[-_#№:]*\\s*(\\d+)', 0], ['(\\d+)\\s*[-_]?\\s*' + w[0] + '(?![a-zа-я])', 1],
    ['(?:^|[^a-zа-я])' + w[1] + '\\.?[-_#№:]?(\\d+)', 0], ['(\\d+)' + w[1] + '(?![a-zа-я])', 1]
  ];
  for (const [rx, lead] of tries) {
    const m = new RegExp(rx).exec(s);
    if (m) return { n: +m[1], at: lead ? m.index : m.index + m[0].length - m[1].length };
  }
  return null;
}
function trkParse(q) {
  const s = String(q || '').toLowerCase().replace(/ё/g, 'е');
  const all = [...s.matchAll(/\d+/g)].map(m => ({ n: +m[0], at: m.index }));
  if (!all.length || all.length > 2) return null;
  // «трекер 13-87», «tcu 13-87»: слово перед парой «блок-номер» — только приставка, как у «13-87»
  const pre = /^\s*(?:трекера|трекер|tracker|trk|tcu|тсу|тцу)\.?\s*[#№:]?\s*(\d+)\s*[-/.]\s*(\d+)\s*$/.exec(s);
  if (pre) return { block: +pre[1], tr: +pre[2] };
  const b = trkAssoc(s, TRK_B), t = trkAssoc(s, TRK_T);
  if (b && t && b.at === t.at) return null;
  const rest = all.filter(x => !(b && x.at === b.at) && !(t && x.at === t.at));
  let block = b ? b.n : null, tr = t ? t.n : null;
  if (block == null && tr == null) {
    if (all.length === 2) { block = all[0].n; tr = all[1].n; } else return { any: all[0].n };
  } else if (block == null) { if (rest.length) block = rest[0].n; }
  else if (tr == null) { if (rest.length) tr = rest[0].n; }
  return { block, tr };
}
function trkHits(n) { return [...trkData.blocks.values()].filter(x => x.nums.has(n)).map(x => x.n); }
function trkResolve(q) {
  const dq = trkData && trkData.dc && trkData.dc.size ? dcParse(q) : null;
  let dcIt = null;
  if (dq) {
    const D = trkData.dc.get(dq.b), box = D && D.boxes.get(dq.id);
    dcIt = box ? { k: 'dc', b: dq.b, id: dq.id, n: box.near, s: dq.s } : trkData.blocks.has(dq.b) ? { k: 'nodc', b: dq.b, id: dq.id, has: !!D } : null;
    if (dq.only) return dcIt ? [dcIt] : [];
  }
  const res = trkResolveTrk(q);
  return dcIt ? [dcIt, ...res] : res;
}
function trkResolveTrk(q) {
  const p = trkParse(q);
  if (!p || !trkData) return [];
  const B = trkData.blocks, out = [], tops = () => { const ks = [...B.keys()]; return Math.min(...ks) + '–' + Math.max(...ks); };
  const byTracker = n => {
    const hits = trkHits(n);
    hits.slice(0, 6).forEach(b => out.push({ k: 'trk', b, n }));
    if (hits.length > 6) out.push({ k: 'more', n, c: hits.length - 6 });
    if (!hits.length) out.push({ k: 'none', n });
  };
  if (p.any != null) { if (B.has(p.any)) out.push({ k: 'block', b: p.any }); byTracker(p.any); return out; }
  if (p.block != null && !B.has(p.block)) return [{ k: 'nob', b: p.block, r: tops() }];
  if (p.block != null && p.tr != null) return [{ k: 'trk', b: p.block, n: p.tr }];
  if (p.block != null) return [{ k: 'block', b: p.block }];
  if (p.tr != null) byTracker(p.tr);
  return out;
}
const trkSelectable = it => it && (it.k === 'trk' || it.k === 'block' || it.k === 'dc');
const trkLabel = it => it.k === 'block' ? 'Блок ' + it.b : it.k === 'dc' ? 'Блок ' + it.b + ' · DC-ящик ' + it.id : 'Блок ' + it.b + ' · TCU ' + it.n;
function trkNear(b, r, c) {
  const at = (rr, cc) => b.pos.get(rr + ',' + cc);
  const side = d => { for (let k = 1; k <= 3; k++) { const v = at(r, c + d * k); if (v != null) return v; } };
  return { 'слева': side(-1), 'справа': side(1), 'выше': at(r - 1, c), 'ниже': at(r + 1, c) };
}
const trkNumOf = s => { const m = /TRK0*(\d+)/i.exec(String(s || '')); return m ? +m[1] : null; };
function dcCardHTML(it, inMap) {
  const b = trkData && trkData.blocks.get(it.b), D = trkData && trkData.dc && trkData.dc.get(it.b), x = D && D.boxes.get(it.id);
  if (!b || !x) return '';
  const at = `ряд ${x.cell[0]}, колонка ${x.cell[1]}`;
  const rows = [`<dt>Где</dt><dd>${x.near ? `рядом с TCU ${x.near} (${at})` : at}${D.exact ? '' : ', ±1 TCU'}</dd>`];
  if (it.s) rows.push(`<dt>Стринг</dt><dd>${esc(b.n + '.' + x.id + '.' + it.s)}</dd>`);
  // строка длинная: отдельным абзацем, чтобы на телефоне не сжимать колонку значений
  const own = x.trackers.length ? `<p class="trk-note2">Его стринги лежат на рядах TCU: ${esc(dcRanges(x.trackers))} (${x.trackers.length} TCU)</p>` : '';
  const foot = own + '<p class="trk-note2">Ящик собирает ток от стрингов, TCU поворачивает панели, это разные системы.</p><p class="trk-foot">' + (D.exact ? 'По чертежу постоянного тока блока (подписи стрингов).' : 'По чертежу постоянного тока без подписей стрингов: место примерное, на каких рядах его стринги, неизвестно.') + '</p>';
  const acts = inMap ? '' : `<div class="trk-acts"><button type="button" class="ghost" data-act="map" data-b="${b.n}" data-dc="${esc(x.id)}">Показать на схеме</button></div>`;
  return `<h4>${esc('DC-ящик ' + b.n + '.' + x.id)}<small>Блок ${b.n}</small></h4><dl>${rows.join('')}</dl>${foot}${acts}`;
}
function trkCardHTML(it, inMap) {
  if (it && it.k === 'dc') return dcCardHTML(it, inMap);
  const b = trkData && trkData.blocks.get(it.b);
  if (!b) return '';
  const D = trkData.dc && trkData.dc.get(b.n);
  const phase = b.phase === 1 ? '1-я очередь' : b.phase === 2 ? '2-я очередь' : '';
  const fixLine = f => `<p class="trk-warn">Замечание к таблице (не подтверждено): ${esc(f.found)} → ${esc(f.proposed)}</p>`;
  const zones = `внешних ${b.outer}, внутренних ${b.inner}, глубинных ${b.deep}` + (b.half ? `, полукомплектов ${b.half}` : '');
  const foot = '<p class="trk-foot">Положение по схеме блока из таблицы станции, не по GPS.</p>';
  const rows = [`<dt>Канал связи</dt><dd>${esc(b.freq)}</dd>`];
  let head, warn = '', acts, loc;
  if (it.k === 'block') {
    head = `Блок ${b.n}`; loc = 'Блок ' + b.n;
    rows.push(`<dt>TCU</dt><dd>${b.nums.size}${b.range ? ' (номера ' + esc(b.range) + ')' : ''}</dd>`);
    rows.push(`<dt>На схеме</dt><dd>${plural(b.rows, 'ряд', 'ряда', 'рядов')}, до ${b.cols} колонок</dd>`);
    rows.push(`<dt>Зоны ветра</dt><dd>${zones}</dd>`);
    if (trkData.dc && trkData.dc.size) rows.push(`<dt>DC-ящики</dt><dd>${D ? D.boxes.size + (D.exact ? '' : ' (места примерные)') : 'ещё не размечены'}</dd>`);
    warn = trkData.fixes.filter(f => f.block === b.n).map(fixLine).join('');
  } else {
    head = `Блок ${b.n} · TCU ${it.n}`; loc = `Блок ${b.n}, TCU ${it.n}`;
    const pos = b.nums.get(it.n);
    const rel = trkData.fixes.filter(f => f.block === b.n && (trkNumOf(f.found) === it.n || trkNumOf(f.proposed) === it.n));
    warn = rel.map(fixLine).join('');
    if (pos) {
      rows.push(`<dt>В блоке</dt><dd>ряд ${pos[0]}, колонка ${pos[1]} (всего ${plural(b.rows, 'ряд', 'ряда', 'рядов')}, до ${b.cols} колонок)</dd>`);
      const near = Object.entries(trkNear(b, pos[0], pos[1])).filter(([, v]) => v != null).map(([k, v]) => k + ' ' + v).join(', ');
      if (near) rows.push(`<dt>Рядом</dt><dd>${esc(near)}</dd>`);
      if (D && D.owner.has(it.n)) rows.push(`<dt>Стринги идут в</dt><dd>DC-ящик ${esc(b.n + '.' + D.owner.get(it.n))}</dd>`);
      rows.push(`<dt>Зоны ветра блока</dt><dd>${zones}</dd>`);
    } else {
      rows.length = 0;
      rows.push(`<dt>Статус</dt><dd>такого номера нет в таблице блока (TCU ${b.nums.size}${b.range ? ', номера ' + esc(b.range) : ''})</dd>`, `<dt>Канал связи</dt><dd>${esc(b.freq)}</dd>`);
    }
  }
  acts = `<div class="trk-acts">` + (JOURNAL_ON ? `<button type="button" class="ghost" data-act="fill" data-loc="${esc(loc)}">Подставить в «Место»</button>` : '') +
    (inMap ? '' : ` <button type="button" class="ghost" data-act="map" data-b="${b.n}"${it.k === 'trk' ? ` data-n="${it.n}"` : ''}>Показать на схеме</button>`) + '</div>';
  return `<h4>${esc(head)}${phase ? `<small>${phase}</small>` : ''}</h4><dl>${rows.join('')}</dl>${warn}${foot}${acts}`;
}
function renderTrk() {
  const note = $('trkNote'), card = $('trkCard'), inp = $('fTrk');
  if (!note) return;
  let msg = '', act = '';
  if (!gh.cfg) msg = 'Поиск использует данные станции из приватного репозитория. Подключи GitHub в меню «Данные».';
  else if (!ghToken) { msg = 'GitHub заблокирован. Разблокируй, чтобы искать TCU.'; act = 'unlock'; }
  else if (trkLoading) msg = 'Загружаю данные станции…';
  else if (trkErr) { msg = 'Не удалось загрузить данные станции: ' + trkErr + '.'; act = 'retry'; }
  else if (trkData) msg = 'Данные станции: ' + plural(trkData.blocks.size, 'блок', 'блока', 'блоков') + ', ' + nfmt(trkData.total) + ' TCU.';
  note.textContent = msg;
  if (act) { note.append(' '); const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'link'; bt.dataset.act = act; bt.textContent = act === 'unlock' ? 'Разблокировать' : 'Повторить'; note.append(bt); }
  inp.disabled = !trkData;
  if (trkSel && trkData) { card.innerHTML = trkCardHTML(trkSel); card.hidden = !card.innerHTML; } else { card.innerHTML = ''; card.hidden = true; }
}
function closeTrkList() { $('trkList').hidden = true; $('fTrk').setAttribute('aria-expanded', 'false'); trkActive = -1; }
function trkRowsHTML(items, active) {
  return items.map((it, i) => {
    if (it.k === 'block') return `<div class="opt${i === active ? ' active' : ''}" role="option" data-i="${i}"><b>Блок ${it.b}</b><small>канал ${esc(trkData.blocks.get(it.b).freq)}</small></div>`;
    if (it.k === 'trk') {
      const b = trkData.blocks.get(it.b), pos = b.nums.get(it.n);
      return `<div class="opt${i === active ? ' active' : ''}" role="option" data-i="${i}"><b>Блок ${it.b} · TCU ${it.n}</b><small>${pos ? 'ряд ' + pos[0] + ', колонка ' + pos[1] : 'нет в таблице'}</small></div>`;
    }
    if (it.k === 'dc') return `<div class="opt${i === active ? ' active' : ''}" role="option" data-i="${i}"><b>Блок ${it.b} · DC-ящик ${esc(it.id)}</b><small>${it.s ? esc('стринг ' + it.s) + (it.n ? ', ' : '') : ''}${it.n ? 'рядом с TCU ' + it.n : ''}</small></div>`;
    if (it.k === 'nodc') return `<div class="opt muted" role="option" aria-disabled="true">${esc(it.has ? `В блоке ${it.b} нет DC-ящика ${it.id}` : `DC-ящики блока ${it.b} ещё не размечены`)}</div>`;
    const t = it.k === 'more' ? `TCU ${it.n} есть ещё в блоках: ${it.c}. Добавь номер блока`
      : it.k === 'none' ? `TCU ${it.n} нет ни в одном блоке` : it.k === 'nob' ? `Блока ${it.b} нет (блоки ${it.r})` : 'Не понял. Пример: 13-87, блок 13 TCU 87 или трекер 87';
    return `<div class="opt muted" role="option" aria-disabled="true">${esc(t)}</div>`;
  }).join('');
}
function drawTrkList() {
  $('trkList').innerHTML = trkRowsHTML(trkItems, trkActive);
  $('trkList').hidden = !trkItems.length; $('fTrk').setAttribute('aria-expanded', String(!!trkItems.length));
}
function onTrkInput() {
  const q = $('fTrk').value.trim();
  trkSel = null; trkItems = [];
  if (q && trkData) {
    trkItems = trkResolve(q);
    if (!trkItems.length) trkItems = [{ k: 'hint' }];
    // одно однозначное совпадение: сразу показываем карточку, список не нужен
    if (trkItems.length === 1 && trkSelectable(trkItems[0])) { trkSel = trkItems[0]; trkItems = []; }
  }
  trkActive = trkItems.findIndex(trkSelectable);
  drawTrkList(); renderTrk();
}
function chooseTrk(i) {
  const it = trkItems[i];
  if (!trkSelectable(it)) return;
  trkSel = it; trkItems = []; $('fTrk').value = trkLabel(it);
  closeTrkList(); renderTrk();
}
$('fTrk').addEventListener('input', onTrkInput);
$('fTrk').addEventListener('focus', () => { if (!trkData) trkLoad(); });
$('fTrk').addEventListener('blur', () => setTimeout(closeTrkList, 120));
$('fTrk').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!$('trkList').hidden && trkActive >= 0) chooseTrk(trkActive); return; }
  if ($('trkList').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const ok = trkItems.map((it, i) => trkSelectable(it) ? i : -1).filter(i => i >= 0);
    if (!ok.length) return;
    const at = ok.indexOf(trkActive);
    trkActive = ok[(at + (e.key === 'ArrowDown' ? 1 : -1) + ok.length) % ok.length];
    drawTrkList();
  } else if (e.key === 'Escape') { e.stopPropagation(); closeTrkList(); }
});
$('trkList').addEventListener('mousedown', e => e.preventDefault());
$('trkList').addEventListener('click', e => { const o = e.target.closest('[data-i]'); if (o) chooseTrk(+o.dataset.i); });
document.addEventListener('click', e => {
  const a = e.target.closest('#trkCard [data-act], #trkNote [data-act], #mapCard [data-act], #mapMsg [data-act]');
  if (!a) return;
  if (a.dataset.act === 'map') openMap(+a.dataset.b, +a.dataset.n || 0, !!(a.dataset.n || a.dataset.dc), a.dataset.dc || '');
  else if (a.dataset.act === 'zoom') { mapZoom = true; renderMap(); mapSeeSel(); }
  else if (a.dataset.act === 'fill') { closeMap(); $('fLoc').value = a.dataset.loc; $('fLoc').dispatchEvent(new Event('input', { bubbles: true })); toast('Подставлено в «Место»: ' + a.dataset.loc); $('fLoc').focus(); }
  else if (a.dataset.act === 'unlock') ghUnlock();
  else if (a.dataset.act === 'retry') { mapErr = ''; if (!$('mapView').hidden) openMap(mapSel && mapSel.b, mapSel && mapSel.n, mapZoom); else trkLoad(); }
});

