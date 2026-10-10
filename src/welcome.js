// La bienvenida de la extensión (welcome.html): el único paso que el navegador no deja hacer solo.
//
// Una extensión instalada desde la tienda llega sin "Permitir acceso a URL de archivo", y no puede prenderlo ni
// pedirlo: acá se explica, se abre la página del navegador donde se prende, y la página se da cuenta sola cuando
// queda prendido (al volver el foco y mirando cada tanto). Si ya estaba, arranca en "Listo".
// Al cambiar ese permiso el navegador suele recargar la extensión y cerrar esta página: en ese caso la vuelve a
// abrir el service worker, que es además quien anota "Ahora no" y "No uso archivos del disco" (bridge-sw.js).
(function () {
  'use strict';
  const T = LMD.t;
  const $ = (sel) => document.querySelector(sel);
  const EN = 'Allow access to file URLs'; const ES = 'Permitir acceso a URL de archivo';
  const ask = (act) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: 'fileSetup', act }, (r) => resolve(chrome.runtime.lastError || !r ? { ok: false } : r)); }
    catch (e) { resolve({ ok: false }); }
  });
  const allowed = async () => { try { return (await chrome.extension.isAllowedFileSchemeAccess()) === true; } catch (e) { return null; } };

  let state = '';
  function show(next) {
    if (state === next) return;
    const was = state; state = next;
    document.querySelectorAll('[data-wel]').forEach((s) => { s.hidden = s.dataset.wel !== next; });
    document.documentElement.dataset.welState = next;
    // Quien estaba mirando el paso y lo ve cambiar queda parado en lo que sigue.
    if (was && next === 'done') { const go = $('[data-wel=done] [data-wel-act=app]'); if (go) go.focus(); }
  }
  let looking = false;
  async function look() {
    if (looking) return;
    looking = true;
    try {
      const ok = await allowed();
      if (ok === true) { if (state === 'need') ask('seen'); show('done'); }
      else show('need');
    } finally { looking = false; }
  }

  async function start() {
    const s = await LMD.load();
    const lang = LMD.setLang(s.language);
    document.documentElement.lang = lang;
    LMD.theme.apply(document.documentElement, s);
    // El HTML trae los textos en español, que son además la clave de cada uno.
    document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = T(n.textContent.trim()); });
    // El interruptor se llama como lo muestra el navegador, que puede estar en otro idioma que la app.
    let ui = '';
    try { ui = chrome.i18n.getUILanguage(); } catch (e) { ui = navigator.language || ''; }
    const es = /^es\b/i.test(ui);
    $('[data-wel-label]').textContent = es ? ES : EN;
    $('[data-wel-other]').textContent = T(es ? 'En un navegador en inglés dice "{a}".' : 'En un navegador en español dice "{a}".', { a: es ? EN : ES });
    $('[data-wel-mock]').setAttribute('aria-label', T('Los detalles de la extensión, con el interruptor prendido'));
    // Si no se sabe qué navegador es, la dirección puede no abrir: queda además el camino en texto.
    const how = $('[data-wel-how]');
    how.hidden = LMD.extSettings().sure;

    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-wel-act]'); if (!b) return;
      const act = b.dataset.welAct;
      if (act !== 'open') { ask(act); return; }
      const r = await ask('open');
      if (!(r && r.ok && r.opened)) how.hidden = false;
    });
    window.addEventListener('focus', look);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
    setInterval(() => { if (state === 'need') look(); }, 1500);
    await look();
  }
  start();
})();
