// Service worker de la versión web (sharpmd.app): deja la app usable sin conexión y hace que la segunda visita
// no espere a la red. La extensión no lo usa.
// Lo registra src/web.js con la versión en la dirección (sw.js?v=2.39.0): cada versión tiene su caché y,
// al activarse, borra las anteriores.
//  - La app (su HTML, scripts, estilos, íconos y tipografías) sale de la caché, sin esperar a la red.
//  - Con cada visita se vuelve a pedir todo por detrás y se guarda junto, de una vez: si hubo una publicación,
//    la visita siguiente ya abre la versión nueva entera, sin mezclar archivos de dos versiones.
//  - Al instalarse guarda solo lo que hace falta para el primer pintado; lo demás se guarda después, ya activo.
//  - Lo que va a otro origen (el servidor de sincronización, el pago) no se toca ni se guarda.
'use strict';

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'sharpmd-';
const CACHE = PREFIX + VERSION;
const ROOT = new URL('./', self.location.href);

// El esqueleto: lo que carga src/app.html. Una prueba (tests/mobile.mjs) falla si acá falta algo de esa página.
const SHELL = [
  'src/app.html', 'src/content.css', 'src/editors.css', 'vendor/hljs-themes.css', 'manifest.webmanifest',
  'src/boot.js', 'src/web.js', 'src/defaults.js', 'src/storeapp.js', 'src/kit.js', 'src/touch.js', 'src/dialog.js', 'src/markdown.js',
  'src/theme.js', 'src/serialize.js', 'src/store.js', 'src/bridge.js', 'src/seal.js', 'src/cloud.js', 'src/home.js', 'src/write.js', 'src/lists.js', 'src/links.js',
  'src/extras.js', 'src/images.js', 'src/board.js', 'src/page.js', 'src/fold.js', 'src/sync.js', 'src/comments.js', 'src/vault.js', 'src/live.js', 'src/team.js', 'src/install.js', 'src/tools.js', 'src/content.js',
  'vendor/markdown-it.min.js', 'vendor/markdown-it-sub.min.js', 'vendor/markdown-it-sup.min.js',
  'vendor/markdown-it-ins.min.js', 'vendor/markdown-it-mark.min.js', 'vendor/markdown-it-abbr.min.js', 'vendor/markdown-it-deflist.min.js',
  'vendor/markdown-it-footnote.min.js', 'vendor/markdown-it-multimd-table.min.js', 'vendor/markdown-it-container.min.js',
  'vendor/purify.min.js',
  'vendor/fonts/inter.woff2', 'icons/icon32.png', 'icons/icon128.png',
];
// Lo que la app pide después del primer pintado o cuando el documento lo necesita (ver LAZY_APP en src/content.js).
// Se guarda con el service worker ya activo, de a uno, para no competir con la primera carga.
const LATE = [
  'src/emoji-data.js', 'src/emoji.js', 'src/community.js', 'src/templates.js', 'src/diagram.js', 'src/formula.js',
  'src/speak.js', 'src/voice.js', 'src/dictate.js', 'src/gallery.js',
  'src/present.js', 'src/daily.js', 'src/docx.js', 'src/linkmap.js', 'src/jsonyaml.js', 'src/import.js', 'src/automate.js', 'src/publish.js', 'src/aikey.js', 'src/assistant.js', 'src/shortcuts.js',
  'vendor/highlight.min.js', 'vendor/markdown-it-emoji.min.js',
  'vendor/fonts/inter-italic.woff2',
  'vendor/katex/katex.min.js', 'vendor/katex/katex.min.css',
  'icons/icon192.png', 'icons/icon512.png', 'icons/apple-touch-icon-180.png',
];
// Los diagramas (Mermaid, Graphviz), las tipografías de las fórmulas y el lector de PDF (vendor/pdfjs) pesan: se
// guardan la primera vez que se usan.

// Lo guardado se busca por ruta, sin lo que venga después del "?": app.html?f=… es la misma página.
const keyOf = (url) => url.origin + url.pathname;
const keep = (cache, url, res) => (res && res.ok && res.type === 'basic' ? cache.put(keyOf(url), res.clone()).catch(() => {}) : Promise.resolve());
// Siempre se le pregunta al servidor si cambió: la caché del navegador no decide qué versión queda guardada.
const ask = (path, signal) => fetch(new Request(new URL(path, ROOT), { cache: 'no-cache', signal }));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((path) => new Request(new URL(path, ROOT), { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

async function late() {
  const cache = await caches.open(CACHE);
  for (const path of LATE) {
    const url = new URL(path, ROOT);
    if (await cache.match(keyOf(url))) continue;
    try { await keep(cache, url, await ask(path)); } catch (err) { return; } // sin red: quedan para la próxima
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(late));
});

// Una vuelta entera por detrás: se pide todo y recién con todo en la mano se guarda. Si algo falla (sin red, un
// archivo que no está), no se guarda nada: la caché queda como estaba, entera.
// Cada visita empieza su vuelta y corta la que hubiera en curso: una vuelta colgada no frena a las que siguen.
let round = null;
function refresh() {
  if (round) round.abort();
  if (self.navigator && self.navigator.onLine === false) return Promise.resolve();
  const stop = round = new AbortController();
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000)); // después de la carga de la página, no durante
    if (stop.signal.aborted) return;
    const timer = setTimeout(() => stop.abort(), 60000); // una red que no contesta: se prueba en la visita siguiente
    const cache = await caches.open(CACHE);
    const list = SHELL.concat(LATE); const got = [];
    for (let i = 0; i < list.length; i += 6) {
      const part = await Promise.all(list.slice(i, i + 6).map((path) => ask(path, stop.signal).then(async (res) => {
        if (!res.ok || res.type !== 'basic') throw new Error(path);
        // El cuerpo se lee entero acá: una respuesta a medio leer deja ocupada su conexión y frena a las que siguen.
        return [new URL(path, ROOT), new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })];
      })));
      got.push(...part);
    }
    clearTimeout(timer);
    if (stop.signal.aborted) return;
    await Promise.all(got.map(([url, res]) => cache.put(keyOf(url), res)));
  })().catch(() => {}).then(() => { if (round === stop) round = null; });
}

const LISTED = new Set(SHELL.concat(LATE));

async function respond(req, url, path, e) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(keyOf(url));
  const page = req.mode === 'navigate' || /\.html$/.test(path);
  if (page && saved) e.waitUntil(refresh());
  if (saved) {
    // Lo que no está en las listas (Mermaid, Graphviz, tipografías de las fórmulas) se renueva al usarlo.
    if (!LISTED.has(path)) e.waitUntil(fetch(req).then((res) => keep(cache, url, res)).catch(() => {}));
    return saved;
  }
  const res = await fetch(req);
  e.waitUntil(keep(cache, url, res));
  return res;
}

// "Compartir" desde otra app (share_target del manifiesto): llega un POST a src/share. No va a la red: lo recibido
// queda en una caché aparte y la app lo recoge al abrir (takeShared en src/install.js). Anda sin conexión.
// De varios archivos se guarda el primero que la app sabe abrir; más grande que el tope, solo queda anotado.
const SHARE_PATH = 'src/share'; const SHARE_CACHE = 'lmd-share'; const SHARE_MAX = 5 * 1024 * 1024;
const SHARE_EXT = /\.(md|markdown|mdx|mkd|mdown|txt|json|ya?ml)$/i;
async function share(req, url) {
  const back = new URL('src/app.html', ROOT);
  if (url.searchParams.get('src') === 'android') back.searchParams.set('src', 'android');
  if (req.method !== 'POST') return Response.redirect(back.href, 303);
  try {
    const form = await req.formData();
    const field = (name) => { const v = form.get(name); return typeof v === 'string' ? v.slice(0, SHARE_MAX) : ''; };
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && (f.name || f.size));
    const file = files.find((f) => SHARE_EXT.test(f.name)) || files[0] || null;
    const meta = { title: field('title'), text: field('text'), url: field('url'), count: files.length,
      file: file ? { name: String(file.name || ''), type: String(file.type || ''), size: file.size } : null };
    await caches.delete(SHARE_CACHE); // un envío anterior que nadie recogió
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(new URL(SHARE_PATH + '/meta', ROOT).href, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
    if (file && file.size <= SHARE_MAX) await cache.put(new URL(SHARE_PATH + '/file', ROOT).href, new Response(file, { headers: { 'content-type': 'application/octet-stream' } }));
    back.searchParams.set('share', '1');
  } catch (err) { /* un envío que no se pudo leer: la app abre igual, sin nada */ }
  return Response.redirect(back.href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname === ROOT.pathname + SHARE_PATH) { e.respondWith(share(req, url)); return; }
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // Solo la app y lo que ella carga. La portada, la página de pago y el resto del sitio van siempre a la red.
  const path = url.pathname.slice(ROOT.pathname.length);
  if (!/^(src|vendor|icons)\//.test(path) && path !== 'manifest.webmanifest') return;
  e.respondWith(respond(req, url, path, e));
});
