/* ---------- резервная копия ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function renderBackupState() {
  let last = '';
  try { last = localStorage.getItem(LS_BACKUP) || ''; } catch (e) { /* нет доступа */ }
  const el = $('backupState');
  if (!last) { el.textContent = 'Копию ещё не скачивали'; el.className = 'backup-state old'; return; }
  const d = new Date(last), days = Math.floor((Date.now() - d) / 86400000);
  el.textContent = 'Последняя копия: ' + shortDate(d) + ' в ' + hm(d) + (days >= 1 ? ', ' + plural(days, 'день', 'дня', 'дней') + ' назад' : '');
  el.className = 'backup-state' + (days >= 7 ? ' old' : '');
}
$('btnExport').onclick = () => {
  download(new Blob([serialize()], { type: 'application/json' }), 'scada-log-копия-' + todayKey() + '.json');
  try { localStorage.setItem(LS_BACKUP, new Date().toISOString()); } catch (e) { /* нет доступа */ }
  renderBackupState();
  toast('Копия скачана');
};
$('btnImport').onclick = () => $('importInput').click();
$('importInput').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const before = alive().length;
    absorb(parseData(JSON.parse(await f.text())));
    persist(); renderPickers(); render(); renderDrawer();
    toast('Копия загружена: было ' + before + ', стало ' + alive().length);
  } catch (err) { toast('Не удалось загрузить: ' + err.message, { error: true }); }
  e.target.value = '';
};

/* ---------- Excel (.xlsx без библиотек) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files, type) {
  const enc = new TextEncoder(), parts = [], central = [], now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type });
}
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = i => String.fromCharCode(65 + i);
function sheetXml(rows, widths) {
  const cell = (v, r, i) => {
    const ref = colName(i) + r;
    if (v == null || v === '') return '';
    if (typeof v === 'object') return `<c r="${ref}" s="${v.s}"><v>${v.n}</v></c>`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 1 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const body = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, i) => cell(v, ri + 1, i)).join('')}</row>`).join('');
  const last = colName(rows[0].length - 1) + rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}
function buildXlsx(entries) {
  const serial = d => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  const r1 = [['Дата', 'Время', 'Кто звонил', 'Телефон', 'Устройство', 'Номер', 'Место', 'Что просили', 'Угол, °', 'Что вернуть', 'Статус', 'Примечание', 'Записал', 'Правок']];
  for (const e of entries) {
    const d = new Date(e.ts), s = serial(d), c = callerOf(e);
    r1.push([{ n: Math.floor(s), s: 2 }, { n: +(s - Math.floor(s)).toFixed(8), s: 3 }, c.name, fmtPhone(c.phone),
      e.deviceType, e.device, e.location, e.action, e.angle, (e.open || e.restore) ? needText(e) : '',
      isPending(e) ? 'ждёт возврата' : (e.closedBy ? 'возвращено' : ''), e.notes, e.by, (e.history || []).length || '']);
  }
  const st = workerStats();
  const r2 = [['Имя', 'Телефон', 'Примечание', 'Звонков']];
  for (const w of [...aliveW()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) r2.push([w.name, fmtPhone(w.phone), w.note, (st.get(w.id) || { n: 0 }).n]);
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Звонки" sheetId="1" r:id="rId1"/><sheet name="Работники" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Звонки\'!$A$1:$' + colName(r1[0].length - 1) + '$' + r1.length + '</definedName><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">\'Работники\'!$A$1:$' + colName(r2[0].length - 1) + '$' + r2.length + '</definedName></definedNames></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="20" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(r1, [12, 8, 24, 18, 16, 14, 18, 20, 9, 28, 15, 40, 18, 8]) },
    { name: 'xl/worksheets/sheet2.xml', data: sheetXml(r2, [26, 18, 30, 10]) }
  ];
  return zipStore(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
$('btnXlsx').onclick = () => {
  const range = $('xlRange').value, d0 = fromKey(viewDay);
  let from = null, to = null, label = 'все';
  if (range === 'day') { from = d0; to = new Date(d0); to.setDate(to.getDate() + 1); label = viewDay; }
  else if (range === 'month') { from = new Date(d0.getFullYear(), d0.getMonth(), 1); to = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); label = viewDay.slice(0, 7); }
  const list = alive().filter(e => { const t = new Date(e.ts); return (!from || t >= from) && (!to || t < to); }).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!list.length) { toast('За этот период звонков нет', { error: true }); return; }
  download(buildXlsx(list), 'Журнал-звонков-' + label + '.xlsx');
  toast('Excel скачан: ' + calls(list.length));
};

