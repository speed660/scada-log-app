/* ---------- Схема поля (уровень 1) ---------- */
const MAP_FILE = 'map/field.json';
function mapBuild(d) {
  if (!d || d.app !== 'scada-map-field' || !Array.isArray(d.blocks)) throw new GhError('Файл схемы в другом формате', { kind: 'corrupt' });
  const int = v => Number.isInteger(v), pair = a => Array.isArray(a) && a.length >= 2 && int(a[0]) && int(a[1]);
  const blocks = new Map();
  for (const b of d.blocks) {
    if (!b || !int(b.n) || !int(b.dr) || !int(b.dc)) continue;
    blocks.set(b.n, { n: b.n, dr: b.dr, dc: b.dc, cells: Array.isArray(b.cells) ? b.cells.filter(c => Array.isArray(c) && c.length >= 3 && c.every(int)) : null, extra: Array.isArray(b.extra) ? b.extra.filter(pair) : [], box: pair(b.box) ? b.box : null });
  }
  if (!blocks.size) throw new GhError('В файле схемы нет блоков', { kind: 'corrupt' });
  const roads = (Array.isArray(d.roads) ? d.roads : []).filter(a => Array.isArray(a) && a.length >= 3 && a.every(int));
  const ents = (Array.isArray(d.entrances) ? d.entrances : []).filter(e => e && typeof e.name === 'string' && int(e.r) && int(e.c));
  const unsure = new Set((Array.isArray(d.unsure) ? d.unsure : []).filter(int));
  return { blocks, roads, ents, unsure, ys: typeof d.yscale === 'number' && d.yscale > 0 ? d.yscale : 5, geo: null };
}
// Клетки каждого блока на общей сетке: положение в сетке блока + смещение. Считается при первом показе схемы после загрузки данных.
function mapGeo() {
  const L = mapLayout; if (L.geo) return L.geo;
  const geo = new Map();
  let r0 = 1e9, r1 = -1e9, c0 = 1e9, c1 = -1e9;
  for (const [n, fb] of L.blocks) {
    const info = trkData.blocks.get(n); if (!info) continue;
    const cells = [], at = new Map();
    if (fb.cells) for (const [num, r, c] of fb.cells) { cells.push([r, c]); at.set(num, [r, c]); }
    else for (const [num, rc] of info.nums) { const p = [rc[0] + fb.dr, rc[1] + fb.dc]; cells.push(p); at.set(num, p); }
    for (const p of fb.extra) cells.push(p);
    if (!cells.length) continue;
    const set = new Set(cells.map(p => p[0] + ',' + p[1]));
    // подпись ставим в самую населённую группу рядов (у блока может быть продолжение в другой полосе)
    const rows = [...new Set(cells.map(p => p[0]))].sort((a, b) => a - b), groups = []; let cur = [rows[0]];
    for (const r of rows.slice(1)) { if (r - cur[cur.length - 1] > 1) { groups.push(cur); cur = []; } cur.push(r); }
    groups.push(cur);
    let best = null, bn = -1;
    for (const g of groups) { const inG = cells.filter(p => p[0] >= g[0] && p[0] <= g[g.length - 1]); if (inG.length > bn) { bn = inG.length; best = inG; } }
    const lab = [best.reduce((a, p) => a + p[1], 0) / best.length + 0.5, best.reduce((a, p) => a + p[0], 0) / best.length + 0.5];
    // заливка: клетки одной строки подряд в один прямоугольник; контур: рёбра, где рядом нет клетки этого же блока
    let fill = '', edge = '';
    const byRow = new Map(); for (const [r, c] of cells) { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(c); }
    const ys = L.ys;
    for (const [r, cs] of byRow) {
      cs.sort((a, b) => a - b); let s0 = cs[0], pv = cs[0];
      for (const c of cs.slice(1).concat([1e9])) { if (c !== pv + 1) { fill += `M${s0} ${r * ys}h${pv - s0 + 1}v${ys}h${-(pv - s0 + 1)}z`; s0 = c; } pv = c; }
    }
    // край считается внутренним проходом, если пустое место за ним лежит внутри размаха блока по этой строке или колонке
    const rowMin = new Map(), rowMax = new Map(), colMin = new Map(), colMax = new Map();
    for (const [r, c] of cells) {
      rowMin.set(r, Math.min(c, rowMin.has(r) ? rowMin.get(r) : c)); rowMax.set(r, Math.max(c, rowMax.has(r) ? rowMax.get(r) : c));
      colMin.set(c, Math.min(r, colMin.has(c) ? colMin.get(c) : r)); colMax.set(c, Math.max(r, colMax.has(c) ? colMax.get(c) : r));
    }
    const H = [], V = [], Hi = [], Vi = [];
    for (const [r, c] of cells) {
      if (!set.has((r - 1) + ',' + c)) (r - 1 > colMin.get(c) ? Hi : H).push([r, c]);
      if (!set.has((r + 1) + ',' + c)) (r + 1 < colMax.get(c) ? Hi : H).push([r + 1, c]);
      if (!set.has(r + ',' + (c - 1))) (c - 1 > rowMin.get(r) ? Vi : V).push([c, r]);
      if (!set.has(r + ',' + (c + 1))) (c + 1 < rowMax.get(r) ? Vi : V).push([c + 1, r]);
    }
    const runs = (arr, horiz) => { // [линия, позиция] -> слитные отрезки
      const m = new Map(); for (const [a, b] of arr) { if (!m.has(a)) m.set(a, []); m.get(a).push(b); }
      let d = '';
      for (const [a, bs] of m) { bs.sort((x, y) => x - y); let s0 = bs[0], pv = bs[0];
        for (const b of bs.slice(1).concat([1e9])) { if (b !== pv + 1) { d += horiz ? `M${s0} ${a * ys}h${pv - s0 + 1}` : `M${a} ${s0 * ys}v${(pv - s0 + 1) * ys}`; s0 = b; } pv = b; } }
      return d;
    };
    edge = runs(H, true) + runs(V, false); const inner = runs(Hi, true) + runs(Vi, false);
    for (const [r, c] of cells) { if (r < r0) r0 = r; if (r > r1) r1 = r; if (c < c0) c0 = c; if (c > c1) c1 = c; }
    geo.set(n, { fill, edge, inner, lab, at, box: fb.box });
  }
  return (L.geo = { blocks: geo, r0, r1, c0, c1 });
}
function mapLoad() {
  if (mapLayout && trkData) return Promise.resolve(true);
  if (!ghReady() || mapLoading) return mapLoading || Promise.resolve(false);
  mapErr = '';
  mapLoading = (async () => {
    try {
      if (!trkData) await trkLoad();
      if (!trkData) { mapErr = trkErr || 'данные станции не загружены'; return false; }
      if (!mapLayout) {
        const d = await trkFile(MAP_FILE, false);
        if (!ghToken) return false;
        mapLayout = mapBuild(d);
      }
      return true;
    } catch (e) { mapLayout = null; mapErr = (e && e.message) || 'неизвестная ошибка'; return false; }
    finally { mapLoading = null; renderMap(); }
  })();
  renderMap();
  return mapLoading;
}
/* Масштаб схемы: колесо мыши, перетаскивание, два пальца, кнопки «+», «−» и «целиком».
   У схемы поля и у сетки блока свой вид: масштаб s (1 = целиком) и центр. Базовая рамка — data-base у svg. */
const PZ_MAX = 12, PZ = { views: {}, ptrs: new Map(), last: null, moved: false };
const pzSvg = () => $(!$('mapBlk').hasAttribute('hidden') ? 'mapBlk' : 'mapSvg');
const pzBase = svg => svg.dataset.base ? svg.dataset.base.split(' ').map(Number) : null;
const pzView = svg => PZ.views[svg.id] || { s: 1, cx: null, cy: null };
function pzApply(svg) {
  const b = pzBase(svg); if (!b) return;
  const v = pzView(svg), s = Math.min(Math.max(v.s, 1), PZ_MAX), w = b[2] / s, h = b[3] / s;
  const cx = Math.min(Math.max(v.cx == null ? b[0] + b[2] / 2 : v.cx, b[0] + w / 2), b[0] + b[2] - w / 2);
  const cy = Math.min(Math.max(v.cy == null ? b[1] + b[3] / 2 : v.cy, b[1] + h / 2), b[1] + b[3] - h / 2);
  PZ.views[svg.id] = { s, cx, cy };
  svg.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].map(x => +x.toFixed(2)).join(' '));
  svg.classList.toggle('zdc', s >= 3); // с такого приближения у DC-ящиков показываем номера
  svg.style.setProperty('--u', pzUnit(svg).toFixed(4)); // единиц схемы на пиксель экрана: по нему подписи держат размер на экране
  if (svg === pzSvg()) { $('mapZoomIn').disabled = s >= PZ_MAX - 0.01; $('mapZoomOut').disabled = $('mapFit').disabled = s <= 1.01; }
}
function pzFitHeight(svg) { // окно схемы по форме схемы: без пустых полос сверху и снизу, но не ниже 300 px и не выше экрана
  const b = pzBase(svg), box = $('mapScroll'); if (!b || !box.clientWidth) return;
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toph')) || 0;
  const bar = getComputedStyle($('mapZoom')).position === 'static' ? 50 : 0; // на телефоне кнопки под схемой
  const avail = window.innerHeight - top - 210, want = box.clientWidth * b[3] / b[2] + 16 + bar;
  box.style.height = Math.round(Math.max(300, Math.min(avail, want))) + 'px';
}
function pzSetBase(svg, base) { // при той же рамке вид не сбрасываем: перерисовка после выбора блока не должна прыгать
  const key = base.map(x => +x.toFixed(2)).join(' ');
  if (svg.dataset.base !== key) { svg.dataset.base = key; delete PZ.views[svg.id]; }
  pzFitHeight(svg); pzApply(svg);
}
function pzZoomAt(svg, k, px, py) {
  const v = pzView(svg), b = pzBase(svg); if (!b) return;
  const s = v.s, s2 = Math.min(Math.max(s * k, 1), PZ_MAX);
  const cx = v.cx == null ? b[0] + b[2] / 2 : v.cx, cy = v.cy == null ? b[1] + b[3] / 2 : v.cy;
  if (px == null) { px = cx; py = cy; }
  PZ.views[svg.id] = { s: s2, cx: px + (cx - px) * s / s2, cy: py + (cy - py) * s / s2 };
  pzApply(svg);
}
function pzFocus(svg, x, y, sMin) { const v = pzView(svg); PZ.views[svg.id] = { s: Math.max(v.s, sMin || 1), cx: x, cy: y }; pzApply(svg); }
function pzPoint(svg, cx, cy) { const m = svg.getScreenCTM && svg.getScreenCTM(); if (!m) return [null, null]; const p = new DOMPoint(cx, cy).matrixTransform(m.inverse()); return [p.x, p.y]; }
function pzUnit(svg) { const vb = svg.viewBox.baseVal; return vb && svg.clientWidth ? Math.max(vb.width / svg.clientWidth, vb.height / svg.clientHeight) : 1; }
$('mapScroll').addEventListener('wheel', e => {
  const svg = pzSvg(); if (!pzBase(svg)) return;
  e.preventDefault();
  const [x, y] = pzPoint(svg, e.clientX, e.clientY);
  pzZoomAt(svg, Math.exp(-e.deltaY * (e.deltaMode ? 0.06 : 0.0016)), x, y);
}, { passive: false });
$('mapScroll').addEventListener('pointerdown', e => {
  if (e.target.closest('.map-zoom') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  PZ.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); PZ.moved = false; PZ.last = null;
});
window.addEventListener('pointermove', e => {
  const p = PZ.ptrs.get(e.pointerId); if (!p) return;
  const svg = pzSvg(); if (!pzBase(svg)) return;
  if (PZ.ptrs.size === 1) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!PZ.moved && Math.hypot(dx, dy) < 6) return;
    PZ.moved = true; $('mapScroll').classList.add('dragging');
    const u = pzUnit(svg), v = pzView(svg), b = pzBase(svg);
    PZ.views[svg.id] = { s: v.s, cx: (v.cx == null ? b[0] + b[2] / 2 : v.cx) - dx * u, cy: (v.cy == null ? b[1] + b[3] / 2 : v.cy) - dy * u };
    pzApply(svg); p.x = e.clientX; p.y = e.clientY;
  } else if (PZ.ptrs.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, c] = [...PZ.ptrs.values()], d = Math.hypot(a.x - c.x, a.y - c.y), mid = [(a.x + c.x) / 2, (a.y + c.y) / 2];
    if (PZ.last) { const [x, y] = pzPoint(svg, mid[0], mid[1]); pzZoomAt(svg, d / PZ.last, x, y); }
    PZ.last = d; PZ.moved = true;
  }
});
const pzUp = e => { if (!PZ.ptrs.delete(e.pointerId)) return; PZ.last = null; if (!PZ.ptrs.size) $('mapScroll').classList.remove('dragging'); };
window.addEventListener('pointerup', pzUp); window.addEventListener('pointercancel', pzUp);
$('mapScroll').addEventListener('click', e => { if (PZ.moved) { e.stopPropagation(); e.preventDefault(); PZ.moved = false; } }, true); // после перетаскивания клик не выбирает блок
window.addEventListener('resize', () => { if (!$('mapView').hidden) { pzFitHeight(pzSvg()); pzApply(pzSvg()); } });
$('mapZoomIn').onclick = () => pzZoomAt(pzSvg(), 1.6);
$('mapZoomOut').onclick = () => pzZoomAt(pzSvg(), 1 / 1.6);
$('mapFit').onclick = () => { const svg = pzSvg(); delete PZ.views[svg.id]; pzApply(svg); };
$('mapView').addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); $('mapZoomIn').click(); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); $('mapZoomOut').click(); }
  else if (e.key === '0') { e.preventDefault(); $('mapFit').click(); }
});
function mapSeeSel() { // найденный трекер на схеме поля приближаем, иначе держим выбранный блок в кадре
  if (mapZoom || !mapSel || !mapLayout || !trkData) return;
  const svg = $('mapSvg'), g = mapGeo().blocks.get(mapSel.b); if (!g || !pzBase(svg)) return;
  const ys = mapLayout.ys, tg = mapSel.n && g.at.get(mapSel.n), dp = mapDc && mapSel.dc ? dcSpot(mapSel.b, g, mapSel.dc) : null;
  if (dp) pzFocus(svg, dp[1] + 0.5, (dp[0] + 0.5) * ys, 6);
  else if (tg) pzFocus(svg, tg[1] + 0.5, (tg[0] + 0.5) * ys, 4);
  else if (pzView(svg).s > 1) pzFocus(svg, g.lab[0], g.lab[1] * ys, 1);
}
/* Слой DC-ящиков на схеме поля: точка на месте трекера, около которого стоит ящик (то же место, что на сетке блока). */
function dcSpot(n, g, id) {
  const D = trkData.dc && trkData.dc.get(n), x = D && D.boxes.get(id); if (!x) return null;
  const b = trkData.blocks.get(n), num = b && b.pos.get(x.cell[0] + ',' + x.cell[1]);
  let p = num != null ? g.at.get(num) : null;
  if (!p && x.near) p = g.at.get(x.near);
  const fb = mapLayout.blocks.get(n);
  if (!p && fb && !fb.cells) p = [x.cell[0] + fb.dr, x.cell[1] + fb.dc];
  return p || null;
}
function mapDcLayer(G) {
  const ys = mapLayout.ys, f = v => +v.toFixed(2); let h = '<g class="dl">';
  for (const [n, g] of G.blocks) {
    const D = trkData.dc && trkData.dc.get(n); if (!D) continue;
    const at = new Map();
    for (const x of D.boxes.values()) { const p = dcSpot(n, g, x.id); if (!p) continue; const k = p[0] + ',' + p[1]; if (!at.has(k)) at.set(k, []); at.get(k).push([x, p]); }
    for (const list of at.values()) list.forEach(([x, p], i) => { // несколько ящиков у одного трекера раздвигаем по высоте клетки
      const cx = f(p[1] + 0.5), cy = f((p[0] + 0.5) * ys + (i - (list.length - 1) / 2) * 2.2), on = mapSel && mapSel.b === n && mapSel.dc === x.id;
      h += `<g class="dp${on ? ' sel' : ''}${x.approx ? ' approx' : ''}" data-n="${n}" data-dc="${esc(x.id)}" role="button" aria-label="DC-ящик ${n}.${esc(x.id)}">` +
        `<path class="dh" d="M${cx} ${cy}h.01"/><path class="dpt" d="M${cx} ${cy}h.01"/><text class="dt" x="${cx}" y="${cy}">${esc(x.id)}</text></g>`;
    });
  }
  return h + '</g>';
}
function openMap(b, n, zoom, dc) {
  $('scadaView').hidden = true; closeSheet();
  mapSel = b ? { b, n: n || 0, dc: dc || '' } : null;
  if (dc && trkData && trkData.dc && trkData.dc.size) mapDc = true; // найденный ящик показываем вместе со слоем
  if (!b) delete PZ.views.mapSvg; // кнопка «Карта» без цели — всё поле целиком
  mapZoom = !!(b && zoom);
  $('mapView').hidden = false; markSection();
  mapLoad().then(mapSeeSel);
  renderMap();
  $('mapClose').focus();
}
function closeMap() { if ($('mapView')) { $('mapView').hidden = true; mapZoom = false; if (typeof markSection === 'function' && $('btnScada')) { markSection(); ensureHome(); } } }
function renderMap() {
  if ($('mapView').hidden) return;
  const msg = $('mapMsg'), svg = $('mapSvg'), card = $('mapCard');
  let text = '', act = '';
  if (!gh.cfg) text = 'Схема использует данные станции из приватного репозитория. Подключи GitHub: кнопка «Меню» → «' + (JOURNAL_ON ? 'Данные' : 'Доступ к данным') + '».';
  else if (!ghToken) { text = 'GitHub заблокирован. Разблокируй, чтобы открыть схему.'; act = 'unlock'; }
  else if (mapLoading || trkLoading) text = 'Загружаю схему…';
  else if (mapErr) { text = 'Не удалось загрузить схему: ' + mapErr + '.'; act = 'retry'; }
  const fnd = $('mapFind'); fnd.disabled = !(trkData && ghToken);
  if (fnd.disabled && fnd.value) { fnd.value = ''; mapFindDraw(); }
  msg.textContent = text;
  if (act) { msg.append(' '); const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'link'; bt.dataset.act = act; bt.textContent = act === 'unlock' ? 'Разблокировать' : 'Повторить'; msg.append(bt); }
  msg.hidden = !text;
  const blkSvg = $('mapBlk'), zoomOK = !!(mapZoom && mapSel && trkData && ghToken && trkData.blocks.has(mapSel.b));
  const ready = !!(mapLayout && trkData && ghToken) && !zoomOK;
  if (zoomOK) { msg.hidden = true; $('mapTitle').textContent = 'Блок ' + mapSel.b; } else $('mapTitle').textContent = 'Схема поля';
  $('mapFit').textContent = zoomOK ? 'Весь блок' : 'Всё поле';
  $('mapZoom').hidden = !(zoomOK || (mapLayout && trkData && ghToken));
  $('mapBack').hidden = !zoomOK;
  svg.toggleAttribute('hidden', !ready); $('mapLegend').hidden = !ready; // у SVG нет свойства hidden
  const hasDc = !!(ready && trkData.dc && trkData.dc.size), dcOn = hasDc && mapDc;
  $('mapDcBtn').hidden = !hasDc; $('mapDcBtn').setAttribute('aria-pressed', String(dcOn)); $('mapDcLeg').hidden = !dcOn; $('mapDcLeg2').hidden = !(dcOn && [...mapLayout.blocks.keys()].some(n => trkData.blocks.has(n) && !(trkData.dc && trkData.dc.get(n))));
  if (ready) $('mapUnsure').hidden = !mapLayout.unsure.size;
  blkSvg.toggleAttribute('hidden', !zoomOK); $('mapLegend2').hidden = !zoomOK;
  if (zoomOK) { svg.innerHTML = ''; renderMapBlock(blkSvg, card); return; }
  blkSvg.innerHTML = '';
  if (!ready) { svg.innerHTML = ''; card.innerHTML = ''; card.hidden = true; return; }
  const L = mapLayout, ys = L.ys, G = mapGeo();
  const x0 = G.c0 - 3, y0 = (G.r0 - 1) * ys, x1 = Math.max(G.c1 + 2, ...L.ents.map(e => e.c + 62)), y1 = (G.r1 + 2) * ys;
  pzSetBase(svg, [x0, y0, x1 - x0, y1 - y0]);
  let h = (dcOn ? '<defs><pattern id="mapHatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4"/></pattern></defs>' : '') + '<g class="rd">' + L.roads.map(([r, a, b]) => `<rect x="${a}" y="${r * ys}" width="${b - a + 1}" height="${ys}"/>`).join('') + '</g>';
  for (const [n, g] of G.blocks) {
    const info = trkData.blocks.get(n), cls = info.phase === 1 ? 'ph1' : 'ph2';
    const sel = mapSel && mapSel.b === n, noDc = dcOn && !(trkData.dc && trkData.dc.get(n));
    h += `<g class="mb ${cls}${L.unsure.has(n) ? ' uncertain' : ''}${sel ? ' sel' : ''}" data-n="${n}" tabindex="0" role="button" aria-pressed="${sel ? 'true' : 'false'}" aria-label="Блок ${n}, канал ${esc(info.freq)}">` +
      `<path class="fl" d="${g.fill}"/><path class="ei" d="${g.inner}"/><path class="ed" d="${g.edge}"/>` +
      `<text class="num" x="${g.lab[0]}" y="${g.lab[1] * ys - 1}">${n}</text><text class="fr" x="${g.lab[0]}" y="${g.lab[1] * ys + 6}">${esc(info.freq)}</text>` +
      (noDc ? `<path class="hz" d="${g.fill}" fill="url(#mapHatch)"/><text class="nd" x="${g.lab[0]}" y="${g.lab[1] * ys + 10.5}">нет DC</text>` : '') + '</g>';
  }
  for (const [n, g] of G.blocks) if (g.box) h += `<rect class="bx" x="${g.box[1] + 0.5 - 1.1}" y="${(g.box[0] + 0.5) * ys - 1.1}" width="2.2" height="2.2"/>`;
  for (const e of L.ents) h += `<g class="en"><path d="M${e.c - 1} ${(e.r + 0.5) * ys - 3} l-7 3 l7 3 z"/><text x="${e.c + 1.5}" y="${(e.r + 0.5) * ys + 1.6}">${esc(e.name)}</text></g>`;
  if (dcOn) h += mapDcLayer(G);
  const tg = mapSel && mapSel.n && G.blocks.has(mapSel.b) && G.blocks.get(mapSel.b).at.get(mapSel.n);
  if (tg) h += `<g class="pin"><circle cx="${tg[1] + 0.5}" cy="${(tg[0] + 0.5) * ys}" r="4.2"/></g>`;
  svg.innerHTML = h;
  if (mapSel && trkData.blocks.has(mapSel.b)) {
    const bl = { uncertain: L.unsure.has(mapSel.b) }, dD = dcOn && mapSel.dc && trkData.dc.get(mapSel.b), dX = dD && dD.boxes.get(mapSel.dc);
    if (dX) card.innerHTML = dcCardHTML({ k: 'dc', b: mapSel.b, id: dX.id }, true) + (bl.uncertain ? '<p class="trk-warn">Положение этого блока на схеме не подтверждено.</p>' : '') + '<div class="trk-acts"><button type="button" class="ghost" data-act="zoom">Открыть блок</button></div>';
    else card.innerHTML = trkCardHTML(mapSel.n ? { k: 'trk', b: mapSel.b, n: mapSel.n } : { k: 'block', b: mapSel.b }, true) +
      (bl && bl.uncertain ? '<p class="trk-warn">Положение этого блока на схеме не подтверждено.</p>' : '') +
      `<div class="trk-acts"><button type="button" class="ghost" data-act="zoom">Открыть блок</button></div>`;
    card.hidden = false;
  } else { card.innerHTML = ''; card.hidden = true; }
}
const MB_W = 26, MB_H = 22, MB_L = 18, MB_T = 14;
function renderMapBlock(svg, card) {
  const b = trkData.blocks.get(mapSel.b), sel = mapSel.n;
  const rows = Math.max(b.rows, ...[...b.nums.values()].map(v => v[0]), 1), cols = Math.max(b.cols, ...[...b.nums.values()].map(v => v[1]), 1);
  const at = b.nums.get(sel), nb = new Set();
  if (at) for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const v = b.pos.get((at[0] + dr) + ',' + (at[1] + dc)); if (v != null) nb.add(v); }
  const W = MB_L + cols * MB_W + 4, H = MB_T + rows * MB_H + 4;
  pzSetBase(svg, [0, 0, W, H]);
  const D = trkData.dc && trkData.dc.get(b.n), dsel = D && mapSel.dc ? D.boxes.get(mapSel.dc) : null, mine = new Set(dsel ? dsel.trackers : []);
  let h = '';
  for (let c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) h += `<text class="lbl" x="${MB_L + (c - 0.5) * MB_W}" y="9">${c}</text>`;
  for (let r = 1; r <= rows; r++) h += `<text class="lbl" x="8" y="${MB_T + (r - 0.5) * MB_H + 2.4}">${r}</text>`;
  const first = sel && at ? sel : (b.nums.size ? Math.min(...b.nums.keys()) : 0);
  for (const [n, [r, c]] of b.nums) {
    const x = MB_L + (c - 1) * MB_W, y = MB_T + (r - 1) * MB_H, on = n === sel;
    h += `<g class="tc${on ? ' sel' : nb.has(n) ? ' nb' : mine.has(n) ? ' dco' : ''}" data-n="${n}" data-r="${r}" data-c="${c}" tabindex="${n === first ? 0 : -1}" role="button" aria-pressed="${on}" aria-label="TCU ${n}, ряд ${r}, колонка ${c}">` +
      `<rect x="${x + 0.6}" y="${y + 0.6}" width="${MB_W - 1.2}" height="${MB_H - 1.2}" rx="2"/><text x="${x + MB_W / 2}" y="${y + MB_H / 2 + 2.6}">${n}</text></g>`;
  }
  const bx = b.box;
  if (bx && !b.pos.has(bx[0] + ',' + bx[1])) { const x = MB_L + (bx[1] - 1) * MB_W, y = MB_T + (bx[0] - 1) * MB_H; h += `<g class="tb"><rect x="${x + 0.6}" y="${y + 0.6}" width="${MB_W - 1.2}" height="${MB_H - 1.2}" rx="2"/><text x="${x + MB_W / 2}" y="${y + MB_H / 2 + 2.2}">ящик</text></g>`; }
  if (D) { // DC-ящики: метка в правом верхнем углу клетки ближайшего к ящику трекера
    const used = new Map();
    for (const x of D.boxes.values()) {
      const k = x.cell.join(','), i = used.get(k) || 0; used.set(k, i + 1);
      const cx = MB_L + x.cell[1] * MB_W - 1, cy = MB_T + (x.cell[0] - 1) * MB_H + 1 + i * 8.5, on = dsel && dsel.id === x.id;
      h += `<g class="dcm${on ? ' sel' : ''}${x.approx ? ' approx' : ''}" data-dc="${esc(x.id)}" tabindex="-1" role="button" aria-pressed="${!!on}" aria-label="DC-ящик ${esc(b.n + '.' + x.id)}">` +
        `<rect x="${cx - 12}" y="${cy}" width="12" height="7.5" rx="1.5"/><text x="${cx - 6}" y="${cy + 5.6}">${esc(x.id)}</text></g>`;
    }
  }
  svg.innerHTML = h;
  card.innerHTML = dsel ? dcCardHTML({ k: 'dc', b: b.n, id: dsel.id }, true) : trkCardHTML(sel ? { k: 'trk', b: b.n, n: sel } : { k: 'block', b: b.n }, true); card.hidden = false;
}
let mapFindItems = [];
function mapFindDraw() {
  const q = $('mapFind').value.trim();
  mapFindItems = q && trkData ? trkResolve(q) : [];
  if (q && trkData && !mapFindItems.length) mapFindItems = [{ k: 'hint' }];
  $('mapFindList').innerHTML = trkRowsHTML(mapFindItems, mapFindItems.findIndex(trkSelectable));
  $('mapFindList').hidden = !mapFindItems.length;
}
function mapFindChoose(i) {
  const it = mapFindItems[i];
  if (!trkSelectable(it)) return;
  $('mapFind').value = ''; mapFindItems = []; $('mapFindList').hidden = true;
  openMap(it.b, it.k === 'trk' ? it.n : 0, it.k === 'trk', it.k === 'dc' ? it.id : '');
}
$('mapFind').addEventListener('input', mapFindDraw);
$('mapFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const i = mapFindItems.findIndex(trkSelectable); if (i >= 0) mapFindChoose(i); } else if (e.key === 'Escape' && $('mapFind').value) { e.stopPropagation(); $('mapFind').value = ''; mapFindDraw(); } });
$('mapFindList').addEventListener('mousedown', e => e.preventDefault());
$('mapFindList').addEventListener('click', e => { const o = e.target.closest('[data-i]'); if (o) mapFindChoose(+o.dataset.i); });
function mapPickTrk(g) {
  if (!g) return;
  mapSel = { b: mapSel.b, n: +g.dataset.n, dc: '' };
  renderMap();
  const again = $('mapBlk').querySelector('.tc.sel'); if (again) again.focus({ preventScroll: true });
  if (window.matchMedia('(max-width:860px)').matches) $('mapCard').scrollIntoView({ block: 'nearest' });
}
function mapPickDc(g) {
  if (!g) return;
  mapSel = { b: mapSel.b, n: 0, dc: mapSel.dc === g.dataset.dc ? '' : g.dataset.dc }; // повторный клик снимает выбор
  renderMap();
  if (window.matchMedia('(max-width:860px)').matches) $('mapCard').scrollIntoView({ block: 'nearest' });
}
function mapPickDcField(g) {
  if (!g || !mapDc) return;
  const b = +g.dataset.n, same = mapSel && mapSel.b === b && mapSel.dc === g.dataset.dc;
  mapSel = { b, n: 0, dc: same ? '' : g.dataset.dc }; // повторный клик снимает выбор ящика
  renderMap();
  if (window.matchMedia('(max-width:860px)').matches) $('mapCard').scrollIntoView({ block: 'nearest' });
}
$('mapDcBtn').onclick = () => { mapDc = !mapDc; if (!mapDc && mapSel) mapSel.dc = ''; renderMap(); };
function mapBack() { if (!mapZoom) return; mapZoom = false; renderMap(); mapSeeSel(); }
function mapPick(g) {
  if (!g) return;
  mapSel = { b: +g.dataset.n, n: 0, dc: '' };
  renderMap();
  const again = $('mapSvg').querySelector('.mb.sel'); if (again) again.focus({ preventScroll: true });
  if (window.matchMedia('(max-width:860px)').matches) $('mapCard').scrollIntoView({ block: 'nearest' });
}
$('btnMap').onclick = () => openMap();
