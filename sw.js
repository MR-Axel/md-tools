// Service worker de la versión web (sharpmd.app): deja la app usable sin conexión. La extensión no lo usa.
// Lo registra src/web.js con la versión en la dirección (sw.js?v=2.39.0): cada versión tiene su caché y,
// al activarse, borra las anteriores.
//  - El HTML de la app va primero a la red, y a la caché solo si la red no responde: nadie queda en una versión vieja.
//  - Scripts, estilos, íconos y tipografías salen de la caché y se renuevan por detrás para la próxima carga.
//  - Lo que va a otro origen (el servidor de sincronización, el pago) no se toca ni se guarda.
'use strict';

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'sharpmd-';
const CACHE = PREFIX + VERSION;
const ROOT = new URL('./', self.location.href);

// El esqueleto: lo que carga src/app.html. Una prueba (tests/mobile.mjs) falla si acá falta algo de esa página.
const SHELL = [
  'src/app.html', 'src/content.css', 'src/editors.css', 'vendor/hljs-themes.css', 'manifest.webmanifest',
  'src/boot.js', 'src/web.js', 'src/defaults.js', 'src/storeapp.js', 'src/kit.js', 'src/touch.js', 'src/formula.js', 'src/dialog.js', 'src/templates.js', 'src/markdown.js',
  'src/theme.js', 'src/serialize.js', 'src/store.js', 'src/seal.js', 'src/cloud.js', 'src/home.js', 'src/write.js', 'src/links.js',
  'src/emoji-data.js', 'src/emoji.js', 'src/diagram.js', 'src/extras.js', 'src/board.js', 'src/sync.js', 'src/comments.js', 'src/vault.js', 'src/live.js', 'src/team.js', 'src/content.js',
  'vendor/markdown-it.min.js', 'vendor/markdown-it-emoji.min.js', 'vendor/markdown-it-sub.min.js', 'vendor/markdown-it-sup.min.js',
  'vendor/markdown-it-ins.min.js', 'vendor/markdown-it-mark.min.js', 'vendor/markdown-it-abbr.min.js', 'vendor/markdown-it-deflist.min.js',
  'vendor/markdown-it-footnote.min.js', 'vendor/markdown-it-multimd-table.min.js', 'vendor/markdown-it-container.min.js',
  'vendor/purify.min.js', 'vendor/highlight.min.js',
  'vendor/fonts/inter.woff2', 'vendor/fonts/inter-italic.woff2',
  'vendor/katex/katex.min.js', 'vendor/katex/katex.min.css',
  'icons/icon32.png', 'icons/icon128.png', 'icons/icon192.png', 'icons/icon512.png',
];
// Los diagramas (Mermaid, Graphviz) y las tipografías de las fórmulas pesan: se guardan la primera vez que se usan.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((path) => new Request(new URL(path, ROOT), { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Lo guardado se busca por ruta, sin lo que venga después del "?": app.html?f=… es la misma página.
const keyOf = (url) => url.origin + url.pathname;
const keep = (cache, url, res) => (res && res.ok && res.type === 'basic' ? cache.put(keyOf(url), res.clone()).catch(() => {}) : Promise.resolve());

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(keyOf(url));
  const fresh = fetch(req).then((res) => { keep(cache, url, res); return res; });
  if (!saved) return fresh;
  // Con una copia guardada no se espera a una red que no contesta.
  const late = new Promise((resolve) => setTimeout(resolve, 4000, null));
  try { return (await Promise.race([fresh, late])) || saved; } catch (err) { return saved; }
}

async function cacheFirst(req, url, e) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(keyOf(url));
  const fresh = fetch(req).then((res) => keep(cache, url, res).then(() => res));
  if (!saved) return fresh;
  e.waitUntil(fresh.catch(() => {}));
  return saved;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // Solo la app y lo que ella carga. La portada, la página de pago y el resto del sitio van siempre a la red.
  const path = url.pathname.slice(ROOT.pathname.length);
  if (!/^(src|vendor|icons)\//.test(path) && path !== 'manifest.webmanifest') return;
  if (req.mode === 'navigate' || /\.html$/.test(path)) e.respondWith(networkFirst(req, url));
  else e.respondWith(cacheFirst(req, url, e));
});
