/* ---------- IndexedDB: только ссылка на рабочий файл ---------- */
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('scadalog', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    };
  });
}

/* ---------- рабочий файл ---------- */
const fail = e => { if (e && e.name !== 'AbortError') toast(e.message || String(e), { error: true }); };
function updateFileUI() {
  const st = $('fileState');
  let text, cls = 'warn', note;
  if (fileHandle && !fileError) { text = 'Сохраняется в ' + fileHandle.name; cls = 'ok'; note = 'Подключён ' + fileHandle.name + '. Каждая запись сразу сохраняется в него.'; }
  else if (fileHandle) { text = 'Ошибка записи в ' + fileHandle.name; note = 'Последняя запись в файл не удалась. Данные есть в браузере, подключи файл заново.'; }
  else if (pendingHandle) { text = 'Подключить ' + pendingHandle.name; note = 'После перезапуска браузер просит подтвердить доступ к файлу ' + pendingHandle.name + '.'; }
  else if (FS_OK) { text = 'Не сохраняется в файл'; note = 'Сейчас данные только в этом браузере. Создай файл или открой существующий, и каждая запись будет сохраняться в него автоматически.'; }
  else { text = 'Хранится в браузере'; cls = ''; note = 'Этот браузер не умеет писать в файл (нужен Chrome или Edge на компьютере). Для переноса используй резервную копию.'; }
  if (gh.cfg) { const g = ghStatus(); text = g.text; cls = g.cls; if (!fileHandle) note = 'Основное хранилище: GitHub. Локальный файл необязателен, его можно подключить дополнительно.'; }
  st.className = 'file-state ' + cls;
  $('fileStateText').textContent = text;
  st.title = text;
  $('fileNote').textContent = note;
  $('btnReconnect').hidden = !pendingHandle;
  if (pendingHandle) $('btnReconnect').textContent = 'Подключить ' + pendingHandle.name;
  $('btnNewFile').hidden = $('btnOpenFile').hidden = !FS_OK;
}
async function connect(handle) {
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
      await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Нет доступа к файлу');
  const txt = await (await handle.getFile()).text();
  if (txt.trim()) absorb(parseData(JSON.parse(txt)));
  fileHandle = handle; pendingHandle = null; fileError = false;
  try { await idb('readwrite', s => s.put(handle, 'handle')); } catch (e) { console.warn(e); }
  updateFileUI(); persist(); renderPickers(); render(); renderDrawer();
  toast('Файл подключён: ' + handle.name);
}
$('btnNewFile').onclick = async () => { try { await connect(await showSaveFilePicker({ suggestedName: 'scada-log.json', types: JSON_TYPES })); } catch (e) { fail(e); } };
$('btnOpenFile').onclick = async () => { try { const [h] = await showOpenFilePicker({ types: JSON_TYPES }); await connect(h); } catch (e) { fail(e); } };
$('btnReconnect').onclick = async () => { try { await connect(pendingHandle); } catch (e) { fail(e); } };
$('fileState').onclick = async () => {
  if (gh.cfg && !ghToken) { ghUnlock(); return; }
  if (pendingHandle) { try { await connect(pendingHandle); } catch (e) { fail(e); } }
  else openDrawer('data');
};

