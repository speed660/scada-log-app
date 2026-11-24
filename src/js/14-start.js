/* ---------- старт ---------- */
(async function init() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) absorb(parseData(JSON.parse(raw)));
    else { const old = localStorage.getItem(LS_OLD); if (old) absorb(parseData(JSON.parse(old))); }
  } catch (e) { console.warn(e); }
  ghLoadCfg(); resetComposer(); updateFileUI(); render(); renderGhSection();
  if (!JOURNAL_ON) {
    curTab = 'data';
    document.querySelector('.brand').textContent = 'Карта станции';
    document.querySelector('[data-tab=data]').textContent = 'Доступ к данным';
    const gn = document.querySelector('#ghForm .note'); if (gn) gn.textContent = 'Данные станции (схема поля и таблицы) лежат в приватном репозитории GitHub. Укажи репозиторий и токен: токен шифруется паролем и хранится только на этом устройстве.';
    openMap();
  }
  setInterval(() => { // «сколько прошло», линия текущего времени и время в форме
    if (document.hidden) return;
    render();
    if (document.activeElement !== $('fTs')) refreshTs();
    renderSolar();
    if (ghReady() && !gh.halted && !gh.running) ghRun(); // раз в минуту забираем записи других диспетчеров
  }, 60000);
  (async () => {
    if (ghLegacy) {
      const ok = await passDialog('set', async p => saveGhCfg(await sealToken(ghToken, p, gh.cfg)));
      toast(ok ? 'Токен зашифрован' : 'Токен работает до закрытия страницы');
    }
    if (ghReady()) ghLoad(); else if (gh.cfg && JOURNAL_ON) ghUnlock(); // без страницы диспетчера пароль спрашиваем только когда нужна схема
  })();
  if (!FS_OK) return;
  try {
    const h = await idb('readonly', s => s.get('handle'));
    if (!h) return;
    if (await h.queryPermission({ mode: 'readwrite' }) === 'granted') await connect(h);
    else { pendingHandle = h; updateFileUI(); }
  } catch (e) { console.error(e); }
})();
