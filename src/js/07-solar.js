/* ---------- Солнце и угол трекера ---------- */
// Положение солнца: алгоритм NOAA (Meeus), точность около 0,01°. Время берём в UTC, часовой пояс компьютера не важен.
const RAD = Math.PI / 180;
function sunPos(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const ecc = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const om = 125.04 - 1934.136 * T;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * RAD);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * ecc * Math.sin(M * RAD) + 4 * ecc * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * ecc * ecc * Math.sin(2 * M * RAD));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  const H = ((((utcMin + eot + 4 * lon) / 4 - 180) + 180) % 360 + 360) % 360 - 180; // часовой угол, ° (после полудня > 0)
  const phi = lat * RAD, h = H * RAD;
  const el = Math.asin(Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h))));
  const azS = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)); // от юга к западу
  return { el: el / RAD, az: (azS / RAD + 180 + 360) % 360 }; // высота и азимут (0 = север, 90 = восток)
}
// Одноосный трекер, горизонтальная ось север-юг. θ > 0: стол наклонён на запад, θ < 0: на восток.
function trackerAngle(p, site) {
  const el = p.el * RAD, az = p.az * RAD;
  // Солнце в осях, привязанных к ряду: xa — составляющая поперёк оси трекера. При повороте рядов 0 это прежняя формула.
  const sk = (site.skew || 0) * RAD;
  const xa = Math.cos(el) * Math.sin(az) * Math.cos(sk) - Math.cos(el) * Math.cos(az) * Math.sin(sk);
  const raw = Math.atan2(-xa, Math.sin(el)) / RAD;
  let th = raw, bt = false;
  if (site.gcr) {
    const r = Math.cos(th * RAD) / site.gcr;
    if (r < 1) { th -= Math.sign(th) * Math.acos(r) / RAD; bt = true; } // backtracking: cos(θист − θ) = cos(θист) / GCR
  }
  const lim = site.maxAngle, clipped = Math.abs(th) > lim;
  return { raw, cmd: Math.max(-lim, Math.min(lim, th)), clipped, backtrack: bt };
}
function sunTimes(day0, site) {
  const f = t => sunPos(new Date(t), site.lat, site.lon).el + 0.833; // 0,833° — стандартный учёт рефракции и диска солнца
  const bis = (a, b) => { const sa = f(a) < 0; for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if ((f(m) < 0) === sa) a = m; else b = m; } return new Date((a + b) / 2); };
  const t0 = day0.getTime(), step = 600000;
  let rise = null, set = null, prev = f(t0);
  for (let t = t0 + step; t <= t0 + 86400000; t += step) {
    const cur = f(t);
    if (prev < 0 && cur >= 0 && !rise) rise = bis(t - step, t);
    else if (prev >= 0 && cur < 0 && !set) set = bis(t - step, t);
    prev = cur;
  }
  return { rise, set };
}
function renderSolar() {
  const box = $('solar');
  if (!box || $('angleGroup').hidden) return;
  const site = state.settings.site;
  const ts = $('fTs').value ? new Date($('fTs').value) : new Date();
  if (isNaN(ts)) { box.innerHTML = ''; return; }
  const p = sunPos(ts, site.lat, site.lon), tr = p.el > 0 ? trackerAngle(p, site) : null;
  const st = sunTimes(new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()), site);
  const d = th => (site.westPositive ? th : -th);
  const r1 = v => Math.round(v * 10) / 10;
  const num = v => String(r1(v)).replace('.', ',');
  const sg = v => (r1(v) > 0 ? '+' : r1(v) < 0 ? '−' : '') + num(Math.abs(v)) + '°';
  const dir = th => (th > 0.5 ? 'к западу' : th < -0.5 ? 'к востоку' : 'горизонтально');
  const when = hm(ts) + (dayKey(ts) !== todayKey() ? ', ' + shortDate(ts) : '');
  let top;
  if (tr) {
    const notes = [];
    if (tr.backtrack && !tr.clipped) notes.push('С учётом backtracking, прямо на солнце было бы ' + sg(d(tr.raw)) + '.');
    else if (tr.clipped) notes.push('Упирается в предел ±' + num(site.maxAngle) + '°, прямо на солнце было бы ' + sg(d(tr.raw)) + '.');
    top = `<div class="solar-top"><span class="solar-val">${sg(d(tr.cmd))}</span><span class="solar-dir">${dir(tr.cmd)}</span><button type="button" data-sa="${r1(d(tr.cmd))}">Подставить</button></div>
      <div class="solar-sub">Солнце в ${when}: высота ${num(p.el)}°, азимут ${num(p.az)}°. ${notes.join(' ')}</div>`;
  } else {
    top = `<div class="solar-top"><span class="solar-dir">Солнце за горизонтом в ${when}</span></div>`;
  }
  const east = r1(d(-site.maxAngle)), west = r1(d(site.maxAngle));
  box.innerHTML = top +
    `<div class="solar-btns"><button type="button" data-sa="${east}">К восходу ${sg(d(-site.maxAngle))}</button><button type="button" data-sa="${west}">К закату ${sg(d(site.maxAngle))}</button>${tsAuto ? '' : '<button type="button" data-now>На текущее время</button>'}</div>
     <div class="solar-sub">Восход ${st.rise ? hm(st.rise) : '—'}, закат ${st.set ? hm(st.set) : '—'}</div>` +
    (site.set ? '' : '<div class="solar-sub"><b>Расчёт по координатам Ташкента.</b> <button type="button" class="link" data-site>Указать координаты станции</button></div>');
}
$('solar').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.sa !== undefined) { $('fAngle').value = b.dataset.sa.replace('.', ','); $('fAngle').focus(); }
  else if ('now' in b.dataset) { tsAuto = true; refreshTs(); renderSolar(); }
  else if ('site' in b.dataset) openDrawer('lists');
});
function fillSite() {
  const s = state.settings.site;
  $('sLat').value = String(s.lat); $('sLon').value = String(s.lon); $('sMax').value = String(s.maxAngle);
  $('sGcr').value = s.gcr ? String(s.gcr).replace('.', ',') : ''; $('sSign').value = s.westPositive ? 'w' : 'e';
  $('sSkew').value = s.skew ? String(s.skew).replace('.', ',') : '';
}
$('sLat').addEventListener('input', () => { // «41.31, 69.28» из Google Maps целиком
  const m = $('sLat').value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) { $('sLat').value = m[1]; $('sLon').value = m[2]; }
});
$('btnGeo').onclick = () => {
  if (!navigator.geolocation) { toast('Это устройство не отдаёт координаты', { error: true }); return; }
  navigator.geolocation.getCurrentPosition(
    pos => { $('sLat').value = pos.coords.latitude.toFixed(5); $('sLon').value = pos.coords.longitude.toFixed(5); toast('Координаты подставлены. Нажми «Сохранить станцию»'); },
    () => toast('Не удалось определить место. Введи координаты вручную', { error: true }),
    { enableHighAccuracy: true, timeout: 15000 });
};
$('btnSaveSite').onclick = () => {
  const num = id => parseFloat($(id).value.replace(',', '.'));
  const lat = num('sLat'), lon = num('sLon'), mx = num('sMax'), g = $('sGcr').value.trim(), gcr = g === '' ? null : parseFloat(g.replace(',', '.'));
  const sk = $('sSkew').value.trim() === '' ? 0 : num('sSkew');
  if (!isFinite(sk) || Math.abs(sk) > 60) { toast('Поворот рядов: число от -60 до 60', { error: true }); $('sSkew').focus(); return; }
  if (!isFinite(lat) || Math.abs(lat) > 90) { toast('Широта: число от -90 до 90', { error: true }); $('sLat').focus(); return; }
  if (!isFinite(lon) || Math.abs(lon) > 180) { toast('Долгота: число от -180 до 180', { error: true }); $('sLon').focus(); return; }
  if (!isFinite(mx) || mx < 10 || mx > 90) { toast('Предельный угол: от 10 до 90', { error: true }); $('sMax').focus(); return; }
  if (gcr !== null && (!isFinite(gcr) || gcr < 0.1 || gcr > 0.95)) { toast('GCR: число от 0,1 до 0,95 или пусто', { error: true }); $('sGcr').focus(); return; }
  state.settings = { ...state.settings, site: { lat, lon, maxAngle: mx, gcr, skew: sk, westPositive: $('sSign').value === 'w', set: true }, updatedAt: new Date().toISOString() };
  persist(); renderSolar(); calNote = ''; renderCal(); toast('Станция сохранена');
};

/* ---------- Сверка угла со SCADA ---------- */
const LS_CAL = 'scadalog.calib';
function calLoad() { try { const a = JSON.parse(localStorage.getItem(LS_CAL) || '[]'); return Array.isArray(a) ? a.filter(p => p && isFinite(+p.a) && !isNaN(new Date(p.t))) : []; } catch (e) { return []; } }
function calSave(a) { try { localStorage.setItem(LS_CAL, JSON.stringify(a.slice(-12))); } catch (e) { /* нет доступа */ } }
// Угол по расчёту в градусах SCADA (со знаком станции) или null, если солнце за горизонтом.
function calcFor(t, site) {
  const p = sunPos(new Date(t), site.lat, site.lon);
  if (p.el <= 0) return null;
  const tr = trackerAngle(p, site);
  return { v: site.westPositive ? tr.cmd : -tr.cmd, clipped: tr.clipped, bt: tr.backtrack };
}
const fmtDeg = v => (Math.round(v * 10) / 10 > 0 ? '+' : Math.round(v * 10) / 10 < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '°';
let calNote = '';
function renderCal() {
  const box = $('calOut'); if (!box) return;
  if (!$('cTime').value) $('cTime').value = toLocalInput(new Date());
  const pts = calLoad(), site = state.settings.site;
  if (!pts.length) { box.innerHTML = calNote ? `<p class="sum">${calNote}</p>` : ''; return; }
  let sum = 0, n = 0;
  const rows = pts.map((p, i) => {
    const c = calcFor(p.t, site), d = new Date(p.t);
    if (!c) return `<tr><td>${esc(shortDate(d))} ${hm(d)}</td><td>${fmtDeg(p.a)}</td><td colspan="2">солнце за горизонтом</td><td><button type="button" class="x" data-calx="${i}" aria-label="Убрать точку">✕</button></td></tr>`;
    const diff = c.v - p.a;
    sum += Math.abs(diff); n++;
    return `<tr><td>${esc(shortDate(d))} ${hm(d)}</td><td>${fmtDeg(p.a)}</td><td>${fmtDeg(c.v)}${c.clipped ? ' (предел)' : c.bt ? ' (backtracking)' : ''}</td><td class="${Math.abs(diff) > 3 ? 'bad' : 'ok'}">${fmtDeg(diff)}</td><td><button type="button" class="x" data-calx="${i}" aria-label="Убрать точку">✕</button></td></tr>`;
  });
  const avg = n ? sum / n : null;
  box.innerHTML = `<table><thead><tr><th>Время</th><th>SCADA</th><th>Расчёт</th><th>Разница</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` +
    (avg != null ? `<p class="sum">Средняя ошибка: <b class="${avg > 3 ? 'bad' : 'ok'}">${String(Math.round(avg * 10) / 10).replace('.', ',')}°</b> по ${n} точкам. Хорошим совпадением считается до 2–3°.</p>` : '') +
    (calNote ? `<p class="sum">${calNote}</p>` : '');
}
// Среднеквадратичная ошибка расчёта по точкам при заданных параметрах станции.
function calRms(pts, site) {
  let s2 = 0, n = 0;
  for (const p of pts) { const c = calcFor(p.t, site); if (c) { s2 += (c.v - p.a) ** 2; n++; } }
  return n ? Math.sqrt(s2 / n) : null;
}
function calFit() {
  const pts = calLoad(), site = state.settings.site;
  const up = pts.filter(p => calcFor(p.t, site));
  if (up.length < 2) { calNote = 'Для подбора нужно хотя бы 2 точки при солнце над горизонтом.'; renderCal(); return; }
  let best = null;
  for (let k = -450; k <= 450; k++) {
    const sk = k / 10, r = calRms(up, { ...site, skew: sk });
    if (best === null || r < best.r - 1e-9 || (Math.abs(r - best.r) < 1e-9 && Math.abs(sk) < Math.abs(best.sk))) best = { sk, r };
  }
  const now = calRms(up, site), flipped = calRms(up, { ...site, westPositive: !site.westPositive });
  const f1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  let t = `Лучший поворот рядов: <b>${f1(best.sk)}°</b>, ошибка ${f1(best.r)}° (сейчас ${f1(site.skew || 0)}°, ошибка ${f1(now)}°).`;
  if (flipped < now * 0.5 && flipped < best.r + 1) t += ' <b class="bad">Похоже, знак угла обратный: проверьте настройку «Знак угла в SCADA».</b>';
  else if (best.r > 4) t += ' Ошибка остаётся большой. Возможные причины: включён backtracking (укажите GCR), другой предельный угол, наклон участка или неверные координаты.';
  else if (Math.abs(best.sk - (site.skew || 0)) >= 1) t += ' <button type="button" class="ghost" id="btnCalApply">Подставить в настройки</button>';
  calNote = t; renderCal();
  const ap = $('btnCalApply'); if (ap) ap.onclick = () => { $('sSkew').value = String(best.sk).replace('.', ','); calNote = 'Значение подставлено в поле «Поворот рядов». Нажмите «Сохранить станцию».'; renderCal(); };
}
$('btnCalAdd').onclick = () => {
  const t = $('cTime').value, a = parseFloat($('cAngle').value.replace(',', '.').replace('−', '-'));
  if (!t || isNaN(new Date(t))) { toast('Укажи время', { error: true }); $('cTime').focus(); return; }
  if (!isFinite(a) || Math.abs(a) > 90) { toast('Угол: число от -90 до 90', { error: true }); $('cAngle').focus(); return; }
  if (new Date(t) - Date.now() > 10 * 60000) { toast('Время в будущем', { error: true }); return; }
  calSave([...calLoad(), { t: new Date(t).toISOString(), a }]);
  $('cAngle').value = ''; calNote = ''; renderCal(); $('cAngle').focus();
};
$('btnCalFit').onclick = calFit;
$('btnCalClear').onclick = () => { calSave([]); calNote = ''; renderCal(); };
$('calOut').addEventListener('click', ev => {
  const b = ev.target.closest('[data-calx]'); if (!b) return;
  const a = calLoad(); a.splice(+b.dataset.calx, 1); calSave(a); calNote = ''; renderCal();
});

