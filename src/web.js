// Versión web: cuando app.html se sirve desde un sitio, sin la extensión instalada, este archivo
// reemplaza lo poco que el lector le pide a Chrome (ajustes guardados y rutas de recursos).
(function () {
  'use strict';
  if (window.chrome && chrome.runtime && chrome.runtime.id) return; // corre dentro de la extensión
  // Whether this browser had opened the app before: count.js tells a first time from the rest with it.
  try { window.__MDT_NEW = !localStorage.getItem('sharpmd:app'); } catch (e) { /* sin almacenamiento */ }
  try { localStorage.setItem('sharpmd:app', '1'); } catch (e) { /* sin almacenamiento */ } // la portada manda directo a la app a quien ya la usó

  const base = new URL('..', document.currentScript.src).href;
  const KEY = 'mdtools:';
  const listeners = [];
  const read = (k) => { try { return JSON.parse(localStorage.getItem(KEY + k)); } catch (e) { return null; } };

  window.__MDT_WEB = true;
  window.chrome = {
    runtime: {
      id: 'web',
      lastError: undefined,
      getURL: (path) => base + String(path || '').replace(/^\//, ''),
      // La web siempre sirve la última versión: con update_url el lector no busca actualizaciones.
      getManifest: () => ({ version: 'web', update_url: base }),
      sendMessage: (msg, cb) => { if (cb) setTimeout(() => cb({ ok: false, error: 'web' }), 0); },
    },
    storage: {
      local: {
        get: (key, cb) => {
          const out = {}; const value = read(key);
          if (value != null) out[key] = value;
          if (cb) { setTimeout(() => cb(out), 0); return undefined; }
          return Promise.resolve(out);
        },
        set: (obj, cb) => {
          const changes = {};
          Object.keys(obj).forEach((k) => {
            changes[k] = { oldValue: read(k), newValue: obj[k] };
            try { localStorage.setItem(KEY + k, JSON.stringify(obj[k])); } catch (e) { /* sin espacio: queda para esta sesión */ }
          });
          setTimeout(() => { listeners.forEach((fn) => fn(changes, 'local')); if (cb) cb(); }, 0);
          return cb ? undefined : Promise.resolve();
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  // Un cambio de ajustes hecho en otra pestaña también llega.
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(KEY)) return;
    const parse = (v) => { try { return JSON.parse(v); } catch (err) { return null; } };
    const changes = {}; changes[e.key.slice(KEY.length)] = { oldValue: parse(e.oldValue), newValue: parse(e.newValue) };
    listeners.forEach((fn) => fn(changes, 'local'));
  });

  // Sin conexión: un service worker guarda el esqueleto de la app (sw.js, en la raíz del sitio). Se registra con la
  // versión en la dirección, así cada versión nueva lo reemplaza y arma su propia caché. La extensión no llega acá.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // Recién con la página cargada y el hilo en reposo: guardar el esqueleto no compite con la primera carga.
    const register = () => {
      const version = (window.LMD && LMD.VERSION) || '';
      navigator.serviceWorker.register(base + 'sw.js?v=' + encodeURIComponent(version), { scope: base }).catch(() => { /* sin service worker la app anda igual, con conexión */ });
    };
    window.addEventListener('load', () => { if (window.requestIdleCallback) requestIdleCallback(register, { timeout: 3000 }); else setTimeout(register, 400); });
    // El service worker avisa cuando lo que bajó por detrás es de otra versión que la de esta página (sw.js, refresh).
    // El aviso lo dibuja content.js, que sabe guardar antes de recargar; si el mensaje llega antes que él, espera acá.
    const fresh = window.__MDT_FRESH = { got: null, show: null };
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.type !== 'lmd-fresh' || !d.version || !window.LMD || d.version === LMD.VERSION) return;
      fresh.got = { version: String(d.version), stored: d.stored !== false };
      if (fresh.show) fresh.show(fresh.got);
    });
    // Una pestaña que queda abierta días no vuelve a navegar, y sin navegar el service worker no mira nada: al volver
    // a ella, y cada tanto, se le pide que mire la versión (un solo pedido chico; la vuelta entera solo si cambió).
    let asked = Date.now();
    const look = () => {
      if (document.hidden || navigator.onLine === false || Date.now() - asked < 30 * 60000) return;
      asked = Date.now();
      const sw = navigator.serviceWorker.controller; if (sw) sw.postMessage({ type: 'lmd-check' });
    };
    document.addEventListener('visibilitychange', look); setInterval(look, 10 * 60000);
  }
})();
