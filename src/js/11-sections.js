/* ---------- разделы сайта ---------- */
function markSection() {
  const cur = !$('mapView').hidden ? 'btnMap' : !$('scadaView').hidden ? 'btnScada' : 'btnJournal';
  for (const id of ['btnJournal', 'btnMap', 'btnScada']) { $(id).classList.toggle('on', id === cur); if (id === cur) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  document.body.classList.toggle('in-sec', cur !== 'btnJournal');
  document.documentElement.style.setProperty('--toph', document.querySelector('header.top').offsetHeight + 'px');
}
function ensureHome() { if (!JOURNAL_ON && $('mapView').hidden && $('scadaView').hidden) openMap(mapSel && mapSel.b, mapSel && mapSel.n, mapZoom); }
function closeScada() { $('scadaView').hidden = true; markSection(); ensureHome(); }
function openScada() { closeSheet(); $('mapView').hidden = true; mapZoom = false; $('scadaView').hidden = false; markSection(); }
$('btnScada').onclick = openScada;
$('scadaClose').onclick = closeScada;
$('btnScadaCal').onclick = () => { closeScada(); openDrawer('lists'); };
$('btnJournal').onclick = () => { closeMap(); closeScada(); window.scrollTo({ top: 0 }); };
window.addEventListener('resize', markSection);
$('mapClose').onclick = closeMap;
$('mapBack').onclick = mapBack;
$('mapBlk').addEventListener('click', e => { const d = e.target.closest('.dcm'); if (d) mapPickDc(d); else mapPickTrk(e.target.closest('.tc')); });
$('mapBlk').addEventListener('keydown', e => {
  const g = e.target.closest('.tc');
  if (!g) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mapPickTrk(g); return; }
  const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
  if (!d) return;
  e.preventDefault();
  const b = trkData.blocks.get(mapSel.b); let r = +g.dataset.r, c = +g.dataset.c;
  for (let i = 0; i < 60; i++) { // перепрыгиваем пустые места до ближайшего трекера в этом направлении
    r += d[0]; c += d[1];
    const v = b.pos.get(r + ',' + c);
    if (v != null) { const t = $('mapBlk').querySelector('.tc[data-n="' + v + '"]'); if (t) { g.tabIndex = -1; t.tabIndex = 0; t.focus(); } return; }
    if (r < 1 || c < 1 || r > b.rows + 1 || c > b.cols + 1) return;
  }
});
$('mapSvg').addEventListener('click', e => { const d = e.target.closest('.dp'); if (d) mapPickDcField(d); else mapPick(e.target.closest('.mb')); });
$('mapSvg').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mapPick(e.target.closest('.mb')); } });

