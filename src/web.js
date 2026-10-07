// Versión web: cuando app.html se sirve desde un sitio, sin la extensión instalada, este archivo
// reemplaza lo poco que el lector le pide a Chrome (ajustes guardados y rutas de recursos).
(function () {
  'use strict';
  if (window.chrome && chrome.runtime && chrome.runtime.id) return; // corre dentro de la extensión
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
})();
