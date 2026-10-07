// Script de contenido que corre solo en la app web (sharpmd.app/src/app.html): es el puente entre esa página y la
// extensión. La página pide por window.postMessage, este script reenvía al service worker (src/bridge-sw.js) y le
// devuelve la respuesta. La página no recibe ninguna API de la extensión: solo las respuestas a esos pedidos.
(function () {
  'use strict';
  if (window.top !== window) return;
  const root = document.documentElement;
  const TAG = 1;
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const post = (data) => window.postMessage(Object.assign({ lmdBridge: TAG }, data), location.origin);
  const gone = (id) => { delete root.dataset.lmdExt; post({ dir: 'res', id, res: { ok: false, error: 'gone' } }); };

  // La página sabe que la extensión está por esta marca, que lleva la versión instalada.
  root.dataset.lmdExt = chrome.runtime.getManifest().version;

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.lmdBridge !== TAG || d.dir !== 'req' || typeof d.id !== 'number' || typeof d.op !== 'string') return;
    // Si la extensión se recargó o se quitó, este script quedó suelto: la página sigue con su propio depósito.
    if (!alive()) { gone(d.id); return; }
    try {
      chrome.runtime.sendMessage({ type: 'bridge', op: d.op, args: d.args, by: d.by }, (res) => {
        if (chrome.runtime.lastError || !res) gone(d.id); else post({ dir: 'res', id: d.id, res });
      });
    } catch (err) { gone(d.id); }
  });

  // Algo cambió del lado de la extensión: la página vuelve a mirar.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.bridgeRev) post({ dir: 'event', what: 'store', by: (changes.bridgeRev.newValue || {}).by || '' });
      if (changes.settings) post({ dir: 'event', what: 'prefs' });
    });
    // El botón de la extensión pregunta si la app cargó en esta pestaña.
    chrome.runtime.onMessage.addListener((msg, sender, respond) => { if (msg && msg.type === 'bridge-ping') respond({ ok: true }); });
  } catch (e) { /* extensión recargada */ }
})();
