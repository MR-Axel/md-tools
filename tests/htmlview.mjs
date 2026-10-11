// Los archivos de código y la vista previa de un HTML (src/codeview.js, src/htmlrun.html).
// Qué se prueba: los números de línea y el índice de un HTML, la edición (Tab, Enter, Ctrl+S, sin herramientas de
// Markdown en el medio), y sobre todo lo que contiene a la vista previa: un HTML hostil no lee nada de la app, no
// mueve la pestaña, no abre otra, no envía formularios y no le pide nada a ningún servidor, ni estático ni con sus
// scripts andando. Los servidores "de afuera" son de acá mismo: anotan cada pedido, cada conexión y cada paquete.
//   node htmlview.mjs
//   ONLY=attack node htmlview.mjs    (una parte: pure, source, read, edit, preview, attack, scripts, runner, phone, big, ext)
//   SHOTS=C:\tmp\aghtml node htmlview.mjs   (deja ahí las capturas)
import { tally, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import { createRequire } from 'module';
import http from 'http'; import dgram from 'dgram'; import fs from 'fs'; import os from 'os'; import path from 'path'; import zlib from 'zlib';

const ONLY = process.env.ONLY || ''; const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.message || e).split('\n')[0] + ' @ ' + String(e && e.stack || '').split('\n').filter((l) => /htmlview\.mjs/.test(l)).map((l) => l.trim().replace(/^.*htmlview\.mjs:/, 'L')).join(' ')); } };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------- Servidores ----------
// El sitio: la raíz del repositorio, como en sharpmd.app.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown', '.svg': 'image/svg+xml' };
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';
// "Afuera": cualquier pedido, conexión o paquete que llegue acá es una fuga.
const out = { hits: [], conns: 0, udp: 0 };
const far = http.createServer((req, res) => {
  out.hits.push(req.method + ' ' + req.url);
  // Una página de otro sitio que intenta usar htmlrun.html como si fuera la app.
  if (req.url.startsWith('/marco.html')) { out.hits.pop(); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><body><iframe id="f" sandbox="allow-scripts" src="' + origin + '/src/htmlrun.html"></iframe><script>addEventListener("message", function (e) { document.body.dataset.got = String(e.data); document.getElementById("f").contentWindow.postMessage({ lmdRun: "<p id=x>escrito</p>" }, "*"); }); setTimeout(function () { document.getElementById("f").contentWindow.postMessage({ lmdRun: "<p id=x>escrito</p>" }, "*"); }, 600);</script>'); return; }
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('afuera');
});
far.on('connection', () => { out.conns++; });
await new Promise((r) => far.listen(0, '127.0.0.1', r));
const FAR = 'http://127.0.0.1:' + far.address().port;
const stun = dgram.createSocket('udp4'); stun.on('message', () => { out.udp++; });
await new Promise((r) => stun.bind(0, '127.0.0.1', r)); const STUN = stun.address().port;
const leaks = () => ({ hits: out.hits.slice(), conns: out.conns, udp: out.udp });
const clean = (l) => l.hits.length === 0 && l.conns === 0 && l.udp === 0;
const reset = () => { out.hits.length = 0; out.conns = 0; out.udp = 0; };

// ---------- Archivos de prueba ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgb) {
  const row = Buffer.alloc(1 + w * 4); const rows = [];
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const o = 1 + x * 4; row[o] = rgb[0]; row[o + 1] = rgb[1]; row[o + 2] = rgb[2]; row[o + 3] = 255; } rows.push(Buffer.from(row)); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const INDEX = ['<!doctype html>', '<html lang="es">', '<head>', '<meta charset="utf-8">', '<title>Sitio de prueba</title>', '<link rel="stylesheet" href="estilo.css">', '<link rel="stylesheet" href="../afuera/secreto.css">', '<style>',
  '  .ico { display: inline-block; width: 20px; height: 20px; background-image: url(iconos.png); }', '  h1 { color: rgb(10, 20, 30); }', '</style>', '<script>var enComentario = "<h1>no es un título</h1>";</script>', '</head>', '<body>', '<!-- <h2>tampoco esto</h2> -->',
  '<header id="arriba">', '  <h1>Hola mundo</h1>', '</header>', '<main>', '  <section id="uno">', '    <h2>Primera &amp; parte</h2>', '    <p class="imp">Texto <a id="frag" href="#dos">abajo</a> <a id="otro" href="sub/pagina.html">otra</a> <a id="ext" href="' + FAR + '/enlace">afuera</a></p>',
  '    <img id="logo" src="img/logo.png" alt="logo">', '    <img id="afuera" src="../afuera/foto.png" alt="afuera">', '    <img id="raiz" src="/img/logo.png" alt="raiz">', '    <span class="ico" id="ico"></span>', '    <h3>Detalle</h3>', '  </section>',
  '  <section id="dos">', '    <h2>Segunda</h2>', '    <p id="sec">secreto</p>', '  </section>', '</main>', '<script src="app.js"></script>', '<script>document.body.dataset.inline = "1";</script>', '</body>', '</html>', ''].join('\n');
const lineOf = (needle) => INDEX.split('\n').findIndex((l) => l.includes(needle)) + 1;
// Todo lo que un HTML ajeno puede intentar. R junta lo que consiguió y queda escrito en el <body>.
const HOSTILE = `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:">
<meta http-equiv="refresh" content="1;url=${FAR}/refresh">
<base href="${FAR}/base/">
<link rel="stylesheet" href="${FAR}/remoto.css"><link rel="preconnect" href="${FAR}"><link rel="dns-prefetch" href="${FAR}"><link rel="prefetch" href="${FAR}/prefetch"><link rel="preload" as="image" href="${FAR}/preload.png"><link rel="icon" href="${FAR}/icono.png">
<title>Hostil</title>
<style>@import url(${FAR}/import.css); body { background: url(${FAR}/fondo.png); } @font-face { font-family: afuera; src: url(${FAR}/letra.woff2); } h1 { font-family: afuera; }</style>
</head><body>
<h1 id="t">Hostil</h1>
<img src="${FAR}/img.png"><img src="relativa-a-la-base.png"><img srcset="${FAR}/srcset.png 1x"><picture><source srcset="${FAR}/picture.png"><img alt=""></picture>
<video src="${FAR}/video.mp4" poster="${FAR}/poster.png"></video><audio src="${FAR}/audio.mp3"></audio>
<object data="${FAR}/object"></object><embed src="${FAR}/embed">
<iframe src="${FAR}/marco"></iframe>
<iframe id="anidado" srcdoc="<script>try { parent.parent.__pwn = 3; } catch (e) {} document.documentElement.append('ANIDADO-CORRIO'); fetch('${FAR}/anidado-fetch').catch(function () {});</script><img src='${FAR}/anidado.png'>anidado"></iframe>
<form id="f" action="${FAR}/formulario" method="post"><input name="a" value="b"><button id="enviar">enviar</button></form>
<a id="js" href="javascript:try{parent.__pwn=4}catch(e){};document.body.dataset.js=1;void 0">js</a>
<a id="top" href="${FAR}/top" target="_top">top</a> <a id="ext" href="${FAR}/enlace">afuera</a> <a id="frag" href="#t">ancla</a> <a id="rel" href="otra.html">relativa</a> <a id="self" href="${FAR}/self" target="_self">self</a>
<svg width="60" height="30"><a id="svga" href="${FAR}/svg"><text y="20">svg</text></a><image href="${FAR}/svg.png" width="5" height="5"/></svg>
<img src="no-existe.png" onerror="try{parent.__pwn=5}catch(e){};document.body.dataset.onerror=1">
<script>
var FAR = ${J(FAR)}; var R = { ran: 1 };
try { R.parentLS = 'LEYO:' + parent.localStorage.getItem('secreto'); } catch (e) { R.parentLS = 'blocked'; }
try { R.topLS = 'LEYO:' + top.localStorage.getItem('secreto'); } catch (e) { R.topLS = 'blocked'; }
try { R.parentDoc = 'LEYO:' + parent.document.title; } catch (e) { R.parentDoc = 'blocked'; }
try { parent.__pwn = 1; R.parentVar = parent.__pwn === 1 ? 'ESCRIBIO' : 'no'; } catch (e) { R.parentVar = 'blocked'; }
try { localStorage.setItem('x', '1'); R.ls = 'ok'; } catch (e) { R.ls = 'blocked'; }
try { document.cookie = 'a=1'; R.cookie = document.cookie ? 'ok' : 'vacia'; } catch (e) { R.cookie = 'blocked'; }
try { indexedDB.open('x'); R.idb = 'ok'; } catch (e) { R.idb = 'blocked'; }
try { R.ext = !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch (e) { R.ext = 'blocked'; }
try { top.location = FAR + '/toploc'; R.top = 'called'; } catch (e) { R.top = 'blocked'; }
try { var w = window.open(FAR + '/open'); R.open = w ? 'ABRIO' : 'null'; } catch (e) { R.open = 'blocked'; }
try { document.getElementById('f').submit(); R.form = 'called'; } catch (e) { R.form = 'blocked'; }
try { alert('x'); R.alert = 'called'; } catch (e) { R.alert = 'blocked'; }
try { eval('R.eval = "CORRIO"'); } catch (e) { R.eval = 'blocked'; }
R.origin = self.origin;
try { var x = new XMLHttpRequest(); x.open('GET', FAR + '/xhr'); x.send(); } catch (e) { /* bloqueado */ }
try { navigator.sendBeacon(FAR + '/beacon', 'x'); } catch (e) { /* bloqueado */ }
try { new WebSocket(FAR.replace('http', 'ws') + '/ws'); } catch (e) { /* bloqueado */ }
try { new EventSource(FAR + '/sse'); } catch (e) { /* bloqueado */ }
try { new Image().src = FAR + '/img-js.png'; } catch (e) { /* bloqueado */ }
try { ['preconnect', 'dns-prefetch', 'prefetch', 'stylesheet'].forEach(function (rel) { var l = document.createElement('link'); l.rel = rel; l.href = FAR + '/link-' + rel; document.head.appendChild(l); }); } catch (e) { /* bloqueado */ }
try { var s = document.createElement('script'); s.src = FAR + '/remoto.js'; document.head.appendChild(s); } catch (e) { /* bloqueado */ }
try { new Worker(URL.createObjectURL(new Blob(['fetch("' + FAR + '/worker")'], { type: 'text/javascript' }))); R.worker = 'creado'; } catch (e) { R.worker = 'blocked'; }
try { var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${STUN}' }] }); pc.createDataChannel('x'); pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () {}); R.rtc = 'creado'; } catch (e) { R.rtc = 'blocked'; }
// El rodeo: la de un marco vacío recién creado, que es otra ventana.
try { var f2 = document.createElement('iframe'); document.body.appendChild(f2); var pc2 = new f2.contentWindow.RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${STUN}' }] }); pc2.createDataChannel('x'); pc2.createOffer().then(function (o) { return pc2.setLocalDescription(o); }).catch(function () {}); R.rtc2 = 'creado'; } catch (e) { R.rtc2 = 'blocked'; }
// Y el otro rodeo: un marco con su propio script escrito adentro, que corre en su propia ventana.
try { var f3 = document.createElement('iframe'); f3.srcdoc = '<script>try { var p = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${STUN}" }] }); p.createDataChannel("x"); p.createOffer().then(function (o) { return p.setLocalDescription(o); }).catch(function () {}); } catch (e) {}<\\/script>'; document.body.appendChild(f3); } catch (e) { /* bloqueado */ }
try { var fr = document.createElement('iframe'); fr.src = FAR + '/marco-js'; document.body.appendChild(fr); } catch (e) { /* bloqueado */ }
// Hacerse pasar por htmlrun.html y por la app, a ver si la página de arriba hace algo con eso.
try { parent.postMessage('lmd-run-ready', '*'); parent.postMessage({ lmdRun: '<script>parent.__pwn=9<\\/script>', type: 'lazyLoad', what: 'x' }, '*'); } catch (e) { /* bloqueado */ }
fetch(FAR + '/fetch', { mode: 'no-cors' }).then(function () { R.fetch = 'SALIO'; }, function () { R.fetch = 'blocked'; }).then(function () { document.body.dataset.r = JSON.stringify(R); });
</script>
</body></html>
`;
// Se va sola a otro sitio, por las tres vías.
const NAV = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${FAR}/refresh"><title>Se va</title></head><body><p id="aca">sigo aca</p><script>setTimeout(function () { try { location.href = ${J(FAR + '/location')}; } catch (e) {} }, 200); try { window.top.location.href = ${J(FAR + '/top')}; } catch (e) {} document.body.dataset.ran = 1;</script></body></html>\n`;
// Un contenido armado para romper cualquier envoltorio: cierres de etiquetas, comillas y un cierre de script.
const BREAK = `</iframe></script></textarea></style></title>"'>\`<img src=x onerror="top.__pwn=7;parent.__pwn=7"><script>try{top.__pwn=8}catch(e){}try{parent.__pwn=8}catch(e){}document.body.dataset.ran=1</script><h1 id="roto">roto</h1>\n`;
const ODD_NAME = `"'><img src=x onerror=window.__pwn=6><script>window.__pwn=6<script>.html`;
function bigHtml(kb) {
  let s = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<title>Página grande</title>\n<style>';
  for (let i = 0; i < 1500; i++) s += '.c' + i + '{color:#' + (100 + i % 899) + ';background-image:url(iconos.png);margin:' + i + 'px}';
  s += '</style>\n<script>';
  for (let i = 0; i < 1500; i++) s += 'function f' + i + '(a,b){return a+b*' + i + '+"x' + i + '"}';
  s += '</script>\n</head>\n<body>\n';
  for (let i = 1; s.length < kb * 1024; i++) s += '<section id="s' + i + '">\n  <h2>Sección ' + i + '</h2>\n  <p class="t">Texto de la sección &amp; algo más <a href="#s' + (i + 1) + '">sigue</a>.</p>\n  <ul>\n    <li>uno</li>\n    <li>dos</li>\n  </ul>\n</section>\n';
  return s + '</body>\n</html>\n';
}
const BIG = bigHtml(500);
const b64 = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8')).toString('base64');
// La carpeta abierta es web/sitio. web/afuera queda al lado: nada de ahí se puede leer desde un HTML de sitio/.
const SEED = {
  'sitio/readme.md': '# Sitio\n\nUna nota.\n', 'sitio/index.html': INDEX, 'sitio/estilo.css': '@import "base.css";\nbody { color: rgb(1, 2, 3); }\n.imp { background: url("img/logo.png"); }\n', 'sitio/base.css': 'p { margin-left: 7px; }\n',
  'sitio/app.js': 'document.body.dataset.ext = "1"; // </script><b id="colado">no</b> <!-- <script>\n', 'sitio/img/logo.png': png(8, 8, [200, 30, 30]), 'sitio/iconos.png': png(4, 4, [30, 200, 30]),
  'sitio/sub/pagina.html': '<!doctype html><title>Sub</title><link rel="stylesheet" href="../estilo.css"><link rel="stylesheet" href="../../afuera/secreto.css"><h1>Sub</h1><p id="sec">x</p><img id="logo" src="../img/logo.png"><img id="afuera" src="../../afuera/foto.png"><script>document.body.dataset.inline = "1";</script>\n',
  'sitio/hostil.html': HOSTILE, 'sitio/seva.html': NAV, 'sitio/rompe.html': BREAK, ['sitio/' + ODD_NAME]: '<h1>nombre raro</h1>\n', 'sitio/grande.html': BIG, 'sitio/plano.html': '<h1>Sin scripts</h1>\n<p>nada</p>\n',
  'sitio/lista.py': 'def f(x):\n    return x\n\n- uno\n1. dos\n', 'sitio/datos.json': '{\n  "a": 1\n}\n',
  'afuera/secreto.css': '#sec { color: rgb(9, 9, 9); }\n', 'afuera/foto.png': png(8, 8, [30, 30, 200]),
};
const SEED64 = Object.fromEntries(Object.entries(SEED).map(([k, v]) => [k, b64(v)]));
const node = (name) => '.lmd-tree-box .lmd-node[title=' + J(name) + ']';
const seed = (page, files) => page.evaluate(async (seed) => {
  const top = await navigator.storage.getDirectory();
  try { await top.removeEntry('web', { recursive: true }); } catch (e) { /* no estaba */ }
  const base = await top.getDirectoryHandle('web', { create: true });
  for (const [name, data] of Object.entries(seed)) {
    const parts = name.split('/'); let d = base;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const h = await d.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable();
    await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))); await w.close();
  }
  const dir = await base.getDirectoryHandle('sitio'); window.__dir = dir; window.showDirectoryPicker = async () => dir;
}, files || SEED64);
const disk = (page, rel) => page.evaluate(async (rel) => { let d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('web')).getDirectoryHandle('sitio'); const parts = rel.split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); }, rel);

// ---------- Navegadores ----------
const errors = []; const closers = [];
const browser = null;
// La app web, servida como en sharpmd.app. Cada parte abre su navegador con un perfil propio y vacío: en un contexto
// sin perfil, Chromium cierra la página al guardar el permiso de una carpeta.
async function web(opt, files) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-htmlweb-'));
  const ctx = await chromium.launchPersistentContext(profile, Object.assign({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'en-US' }, opt || {}));
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG) { page.on('framenavigated', (fr) => { if (fr !== page.mainFrame()) console.log('    [marco] ' + fr.url().slice(0, 90)); }); page.on('console', (m) => { if (m.type() === 'error') console.log('    [consola] ' + m.text().slice(0, 200)); }); }
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto(home); await page.waitForSelector('.lmd-home');
  await page.evaluate(() => { localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: 'off' })); localStorage.setItem('secreto', 'lo-que-no-debe-leerse'); });
  await page.reload(); await page.waitForSelector('.lmd-home');
  await seed(page, files);
  await page.click('[data-home=dir]'); await page.waitForSelector(node('readme.md'), { state: 'attached' }); await sleep(300);
  const close = ctx.close.bind(ctx);
  ctx.close = async () => { await close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ } };
  closers.push(() => ctx.close());
  return { ctx, page, dialogs };
}
// La página de la app dentro de la extensión.
async function ext(opt) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-html-'));
  const ctx = await chromium.launchPersistentContext(profile, Object.assign({ headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] }, opt || {}));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const EXT = 'chrome-extension://' + new URL(sw.url()).host;
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(EXT + '/src/app.html'); await page.waitForSelector('.lmd-home');
  await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  await page.goto(EXT + '/src/app.html'); await page.waitForSelector('.lmd-home');
  await page.evaluate(() => localStorage.setItem('secreto', 'lo-que-no-debe-leerse'));
  await seed(page);
  await page.click('[data-home=dir]'); await page.waitForSelector(node('readme.md'), { state: 'attached' }); await sleep(300);
  closers.push(async () => { await ctx.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ } });
  return { ctx, page, EXT };
}
const openFile = async (page, name, dir) => { if (dir && !(await page.$(node(dir) + '.lmd-open'))) { await page.click(node(dir)); await sleep(250); } await page.click(node(name)); await page.waitForSelector('.lmd-article pre code.lmd-cv', { state: 'attached', timeout: 15000 }); await sleep(200); };
const mode = async (page, m) => { await page.click('.lmd-cv-seg [data-cv=' + m + ']'); await sleep(150); };
// El documento de la vista previa, ya cargado. Playwright lo lee por el depurador: el aislamiento no se lo impide.
const frameOf = async (page) => { const h = await page.$('iframe.lmd-cv-frame'); return h ? h.contentFrame() : null; };
const preview = async (page, want) => until(async () => { const f = await frameOf(page); if (!f) return null; const ok = await f.evaluate((w) => document.readyState === 'complete' && !!document.body && (!w || !!document.querySelector(w)), want || '').catch(() => false); return ok ? f : null; }, 12000);
const frameAttrs = (page) => page.evaluate(() => { const f = document.querySelector('iframe.lmd-cv-frame'); return f ? { sandbox: f.getAttribute('sandbox'), has: f.hasAttribute('sandbox'), src: f.getAttribute('src') || '', srcdoc: f.hasAttribute('srcdoc'), ref: f.getAttribute('referrerpolicy'), allow: f.getAttribute('allow') } : null; });
const appState = (page) => page.evaluate(() => ({ pwn: window.__pwn, secreto: localStorage.getItem('secreto'), pwnKey: localStorage.getItem('pwn'), url: location.href, injected: document.querySelectorAll('img[onerror], script:not([src]), [data-ran]').length, frames: document.querySelectorAll('iframe').length }));

// ---------- Lo que se prueba sin navegador ----------
await step('pure', 'Las piezas sueltas: líneas, índice y rutas', async () => {
  const P = createRequire(import.meta.url)(path.join(root, 'src', 'codeview.js'));
  const parts = P.splitLines('<span class="a">x\n<span class="b">y</span>\nz</span>w\n');
  check('el resaltado se parte por líneas cerrando y reabriendo las marcas', J(parts) === J(['<span class="a">x</span>', '<span class="a"><span class="b">y</span></span>', '<span class="a">z</span>w', '']), parts);
  const o = P.outlineOf(INDEX);
  check('el índice de un HTML: título, secciones con id y títulos, con su línea y su nivel',
    o.title === 'Sitio de prueba' && o.titleLine === lineOf('<title>') && J(o.items.map((i) => [i.level, i.text, i.line])) === J([[1, '#arriba', lineOf('id="arriba"')], [2, 'Hola mundo', lineOf('Hola mundo')], [1, '#uno', lineOf('id="uno"')], [2, 'Primera & parte', lineOf('Primera')], [3, 'Detalle', lineOf('Detalle')], [1, '#dos', lineOf('id="dos"')], [2, 'Segunda', lineOf('Segunda')]]), o);
  check('lo que está dentro de un comentario o de un script no es un título', !o.items.some((i) => /no es|tampoco/.test(i.text)));
  const big = P.outlineOf(BIG); const t0 = Date.now(); P.outlineOf(BIG); const ms = Date.now() - t0;
  check('un HTML de 500 KB se recorre en menos de 300 ms y el índice tiene tope', ms < 300 && big.more === true && big.items.length === 1500 && big.title === 'Página grande', { ms, n: big.items.length });
  const R = 'https://lmd.local/d1/'; const B = R + 'sub/index.html';
  const cases = [['a.png', R + 'sub/a.png'], ['./x/a.png', R + 'sub/x/a.png'], ['../a.png', R + 'a.png'], ['a.png?v=1#x', R + 'sub/a.png'], ['/raiz.css', R + 'raiz.css'], ['x/../y.css', R + 'sub/y.css'],
    ['../../a.png', ''], ['../../../etc/passwd', ''], ['..%2f..%2fa.png', ''], ['%2e%2e/%2e%2e/a.png', ''], ['..\\..\\a.png', ''], ['../../d2/a.png', ''], ['sub/../../../d2/x', ''], ['/../d2/x', ''], ['/..%2fd2/x', ''],
    ['//evil.test/a.png', ''], ['\\\\evil.test\\a.png', ''], ['https://evil.test/a', ''], ['HTTP://evil.test/a', ''], ['javascript:alert(1)', ''], [' java\tscript:alert(1)', ''], ['data:image/png;base64,AAAA', ''], ['blob:x', ''], ['file:///c:/x', ''], ['#ancla', ''], ['', ''], ['a%00.png', ''], ['a/%2e%2e/%2e%2e/%2e%2e/x', '']];
  const got = cases.map(([v, want]) => [v, P.resolveRel(v, B, R), want]);
  check('una ruta relativa se resuelve dentro de la carpeta abierta y nunca fuera de ella', got.every((g) => g[1] === g[2]), got.filter((g) => g[1] !== g[2]));
  check('sin carpeta abierta no se resuelve nada', P.resolveRel('a.png', B, '') === '');
  check('la política de la vista previa cierra todo y solo cambia en los scripts', P.policy(false) === "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'" && P.policy(true) === P.policy(false).replace("default-src 'none'; ", "default-src 'none'; script-src 'unsafe-inline'; ") && !/https?:|\*|'self'|unsafe-eval|connect-src|frame-src/.test(P.policy(true)), [P.policy(false), P.policy(true)]);
  check('Tab sangra el renglón o los elegidos, y Shift+Tab saca la sangría', J(P.indentBlock('a\n  b\nc', 0, 6, false)) === J({ from: 0, to: 5, text: '  a\n    b', s: 2, e: 10 }) && J(P.indentBlock('a\n  b\nc', 4, 4, true)) === J({ from: 2, to: 5, text: 'b', s: 2, e: 2 }) && P.indentBlock('\tx', 2, 2, false).text === '\t' && P.indentBlock('a', 0, 0, true) === null);
});

await step('source', 'Lo que dicen los archivos', async () => {
  const meta = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('src/app.html')) || [])[1] || '';
  const fsrc = (/frame-src ([^;]*)/.exec(meta) || [])[1];
  check("la app enmarca solo páginas propias: frame-src 'self', sin blob:, data: ni otro sitio", fsrc === "'self'" && /script-src 'self' 'wasm-unsafe-eval';/.test(meta), fsrc);
  const cv = read('src/codeview.js');
  const sandboxes = [...cv.matchAll(/setAttribute\('sandbox',\s*([^)]+)\)/g)].map((m) => m[1].trim());
  check('el marco de la vista previa se crea siempre con sandbox, vacío o con allow-scripts y nada más', J(sandboxes) === J(["run ? 'allow-scripts' : ''"]) && !/allow-(same-origin|top-navigation|popups|forms|modals|downloads|pointer-lock|presentation)/.test(cv.replace(/^\s*\/\/.*$/gm, '')), sandboxes);
  check('el HTML del archivo no entra en el documento de la app: va a un DOMParser inerte y de ahí al marco', /new DOMParser\(\)\.parseFromString\(src, 'text\/html'\)/.test(cv) && !/(article|main|body)\.(innerHTML|insertAdjacentHTML)/.test(cv) && !/document\.write/.test(cv));
  check('correr scripts no se guarda en ningún lado: es un conjunto en memoria', /const runOk = new Set\(\)/.test(cv) && !/(localStorage|sessionStorage|chrome\.storage|LMD\.save|LMD\.patch)/.test(cv));
  const run = read('src/htmlrun.html'); const rcsp = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(run) || [])[1] || '';
  check('htmlrun.html lleva su política sin red y solo escribe si está aislada y el pedido viene de su propio sitio', /^default-src 'none'; script-src 'unsafe-inline';/.test(rcsp) && !/https?:|\*|'self'|unsafe-eval|connect-src|frame-src/.test(rcsp) && /form-action 'none'/.test(rcsp) && /base-uri 'none'/.test(rcsp) &&
    /if \(self\.origin !== 'null' \|\| window\.parent === window\) return;/.test(run) && /e\.source !== window\.parent \|\| e\.origin !== location\.origin/.test(run) && run.indexOf('Content-Security-Policy') < run.indexOf('<script'), rcsp);
  const manifest = JSON.parse(read('manifest.json'));
  check('el manifest no gana permisos ni páginas sandbox, y htmlrun.html no es accesible desde otros sitios', manifest.permissions.slice().sort().join() === 'scripting,storage' && !manifest.sandbox && !J(manifest.web_accessible_resources).includes('htmlrun') && manifest.content_security_policy.extension_pages === "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  check('en la extensión htmlrun.html no se usa: ahí la vista previa no pasa de estática', /const canRun = \(\) => canPreview\(\) && !OWN;/.test(cv) && /const OWN = location\.protocol === 'chrome-extension:';/.test(cv) && /a === 'run' && canRun\(\)/.test(cv));
  check('las listas de archivos nombran a codeview.js', /'src\/codeview\.js'/.test(read('sw.js')) && manifest.content_scripts[1].js.includes('src/codeview.js') && /codeview: \{ js: \['src\/codeview\.js'\] \}/.test(read('src/content.js')) && !/codeview\.js/.test(read('src/app.html')));
});

// ---------- Leer ----------
await step('read', 'Leer un HTML: números de línea, ajuste e índice', async () => {
  const { ctx, page } = await web();
  const hits = []; page.on('request', (r) => hits.push(r.url()));
  await openFile(page, 'index.html');
  const lines = INDEX.split('\n').length - 1;
  const s = await page.evaluate(() => { const code = document.querySelector('.lmd-article pre code'); const rows = [...code.querySelectorAll('.lmd-cv-l')]; const r0 = rows[0].getBoundingClientRect();
    return { rows: rows.length, n: [rows[0].dataset.n, rows[rows.length - 1].dataset.n], num: getComputedStyle(rows[4], '::before').content, text: code.textContent, h1: !!document.querySelector('.lmd-article h1, .lmd-article img, .lmd-article script, .lmd-article link, .lmd-article iframe'), bar: !document.querySelector('.lmd-cv-bar').hidden, seg: [...document.querySelectorAll('.lmd-cv-seg button')].map((b) => b.textContent + (b.classList.contains('lmd-on') ? '*' : '')), info: document.querySelector('.lmd-cv-info').textContent, pad: parseFloat(getComputedStyle(rows[0]).paddingLeft), left: r0.left, pwn: window.__pwn, frames: document.querySelectorAll('iframe').length }; });
  check('cada línea tiene su número y el texto es el del archivo, sin interpretar', s.rows === lines && J(s.n) === J(['1', String(lines)]) && s.num === '"5"' && s.text === INDEX && !s.h1 && s.pad > 20, { rows: s.rows, n: s.n, num: s.num, same: s.text === INDEX, h1: s.h1 });
  check('la barra ofrece Código, Vista previa y Lado a lado, y arranca en Código sin ningún marco', s.bar && J(s.seg) === J(['Code*', 'Preview', 'Side by side']) && s.info === lines + ' lines' && s.frames === 0 && s.pwn === undefined, s.seg);
  check('abrir el archivo no pidió nada afuera ni cargó sus recursos', clean(leaks()) && !hits.some((u) => /logo\.png|estilo\.css|app\.js/.test(u)), leaks());
  const col = await until(() => page.evaluate(() => document.querySelectorAll('.lmd-article pre code .lmd-cv-l span[class^="hljs-"]').length > 10));
  check('el color llega después, línea por línea, sin cambiar el texto', !!col && await page.evaluate((t) => document.querySelector('.lmd-article pre code').textContent === t, INDEX));
  const wrap = async () => page.evaluate(() => ({ ws: getComputedStyle(document.querySelector('.lmd-article pre code.lmd-cv')).whiteSpace, on: document.querySelector('[data-cv=wrap]').getAttribute('aria-pressed') }));
  const w0 = await wrap(); await page.click('[data-cv=wrap]'); const w1 = await wrap(); await page.click('[data-cv=wrap]'); const w2 = await wrap();
  check('el ajuste de línea se prende y se apaga', w0.ws === 'pre-wrap' && w0.on === 'true' && w1.ws === 'pre' && w1.on === 'false' && w2.ws === 'pre-wrap', [w0, w1, w2]);
  const ol = await page.evaluate(() => { const p = document.querySelector('.lmd-pane-outline'); return { title: p.querySelector('.lmd-o-title').textContent, meta: p.querySelector('.lmd-o-meta').textContent, items: [...p.querySelectorAll('.lmd-o-link')].map((b) => [b.textContent, +b.dataset.cvLine, [...b.parentNode.classList].find((c) => /^lmd-o-l\d/.test(c))]), empty: !!p.querySelector('.lmd-empty') }; });
  check('el índice muestra el título de la página y su estructura, no "no tiene títulos"', ol.title === 'Sitio de prueba' && !ol.empty && /7 sections/.test(ol.meta) && J(ol.items) === J([['#arriba', lineOf('id="arriba"'), 'lmd-o-l1'], ['Hola mundo', lineOf('Hola mundo'), 'lmd-o-l2'], ['#uno', lineOf('id="uno"'), 'lmd-o-l1'], ['Primera & parte', lineOf('Primera'), 'lmd-o-l2'], ['Detalle', lineOf('Detalle'), 'lmd-o-l3'], ['#dos', lineOf('id="dos"'), 'lmd-o-l1'], ['Segunda', lineOf('Segunda'), 'lmd-o-l2']]), ol);
  await page.click('.lmd-pane-outline .lmd-o-link >> text=Segunda'); await sleep(250);
  const hit = await page.evaluate((n) => { const r = document.querySelector('.lmd-article .lmd-cv-l[data-n="' + n + '"]'); const b = r.getBoundingClientRect(); return { hit: r.classList.contains('lmd-cv-hit'), seen: b.top > 40 && b.bottom < innerHeight, text: r.textContent.trim() }; }, lineOf('Segunda'));
  check('tocar una entrada lleva a su línea y la marca', hit.hit && hit.seen && hit.text === '<h2>Segunda</h2>', hit);
  await shot(page, 'leer-oscuro');
  // Otro archivo de código: números de línea, sin vista previa ni índice de HTML.
  await openFile(page, 'lista.py');
  const py = await page.evaluate(() => ({ rows: document.querySelectorAll('.lmd-cv-l').length, seg: document.querySelector('.lmd-cv-seg').hidden, bar: !document.querySelector('.lmd-cv-bar').hidden, outline: document.querySelector('.lmd-pane-outline').textContent }));
  check('cualquier archivo de código gana los números de línea; la vista previa es solo del HTML', py.rows === 5 && py.seg && py.bar && /no headings/i.test(py.outline), py);
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1');
  check('en una nota la barra de código no aparece', await page.evaluate(() => document.querySelector('.lmd-cv-bar').hidden && !document.querySelector('.lmd-main').classList.contains('lmd-cv-on') && document.querySelector('.lmd-pane-outline .lmd-o-title').textContent === 'Sitio'));
  await ctx.close();
});

// ---------- Editar ----------
await step('edit', 'Editar un HTML: números, color, Tab, Enter y Ctrl+S', async () => {
  const { ctx, page } = await web();
  await openFile(page, 'index.html');
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('textarea.lmd-raw-edit:not([hidden])'); await sleep(300);
  const s = await page.evaluate(() => { const ta = document.querySelector('textarea.lmd-raw-edit'); const ed = document.querySelector('.lmd-cv-ed'); const back = ed.querySelector('.lmd-cv-back'); const a = getComputedStyle(ta); const b = getComputedStyle(back);
    return { on: ed.classList.contains('lmd-cv-ed-on'), hl: ed.classList.contains('lmd-cv-hl'), gut: ed.querySelectorAll('.lmd-ed-gutter i').length, last: ed.querySelector('.lmd-ed-gutter i:last-child').textContent, spans: back.querySelectorAll('span[class^="hljs-"]').length, same: back.textContent === ta.value + '\n', color: a.color, font: [a.fontSize, a.lineHeight, a.fontFamily, a.paddingLeft, a.paddingTop, a.tabSize, a.whiteSpace].join('|') === [b.fontSize, b.lineHeight, b.fontFamily, b.paddingLeft, b.paddingTop, b.tabSize, b.whiteSpace].join('|'), value: ta.value, wrap: ta.getAttribute('wrap'), format: document.querySelector('.lmd-format').hidden, article: document.querySelector('.lmd-article').hidden, h: ta.getBoundingClientRect().height, lh: parseFloat(a.lineHeight), gl: parseFloat(getComputedStyle(ed.querySelector('.lmd-ed-gutter i')).height) }; });
  const lines = INDEX.split('\n').length;
  check('el cuadro de edición es el de siempre, con números de línea y el color por detrás', s.on && s.hl && s.gut === lines && s.last === String(lines) && s.spans > 20 && s.same && s.value === INDEX && s.wrap === 'off' && s.h > 300, { on: s.on, hl: s.hl, gut: s.gut, spans: s.spans, same: s.same, h: s.h });
  check('el texto de adelante y el color de atrás miden lo mismo, y los números también', s.font && /rgba\(0, 0, 0, 0\)/.test(s.color) && s.lh === s.gl, { font: s.font, color: s.color, lh: s.lh, gl: s.gl });
  check('ninguna herramienta de Markdown a la vista: ni la barra de formato ni los bloques', s.format && s.article && await page.evaluate(() => !document.querySelector('.lmd-article .lmd-editable') && document.querySelector('.lmd-tablebar').hidden && getComputedStyle(document.querySelector('.lmd-topbar .lmd-insert')).display === 'none'));
  await shot(page, 'editar-oscuro');
  const al = await page.evaluate(() => { const ed = document.querySelector('.lmd-cv-ed'); const r = (n) => { const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }; const ta = ed.querySelector('textarea'); const span = ed.querySelector('.lmd-cv-back code'); const cs = getComputedStyle(ta);
    return { ed: r(ed), gut: r(ed.querySelector('.lmd-ed-gutter')), i1: r(ed.querySelector('.lmd-ed-gutter i')), pane: r(ed.querySelector('.lmd-cv-pane')), ta: r(ta), back: r(ed.querySelector('.lmd-cv-back')), code: r(ed.querySelector('.lmd-cv-back code')), span: r(span), pad: [cs.paddingTop, cs.marginTop, cs.borderTopWidth, cs.boxSizing, cs.top], st: ta.scrollTop, tr: ed.querySelector('.lmd-ed-gutter').style.transform, ctr: ed.querySelector('.lmd-cv-back code').style.transform, gpad: getComputedStyle(ed.querySelector('.lmd-ed-gutter')).padding, gfont: getComputedStyle(ed.querySelector('.lmd-ed-gutter i')).font }; });
  if (process.env.DEBUG) console.log('    [alineado] ' + J(al));
  check('el color cae justo debajo del texto, y cada número a la altura de su línea', al.span[1] === al.ta[1] + 14 && al.span[0] === al.ta[0] + 8 && al.i1[1] === al.span[1] && al.st === 0 && await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.lmd-cv-back code')); return c.paddingTop === '0px' && c.paddingLeft === '0px'; }), al);
  const val = () => page.evaluate(() => { const ta = document.querySelector('textarea.lmd-raw-edit'); return { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd }; });
  const put = (a, b) => page.evaluate(([a, b]) => { const ta = document.querySelector('textarea.lmd-raw-edit'); ta.focus(); ta.setSelectionRange(a, b == null ? a : b); }, [a, b]);
  const at = INDEX.indexOf('<h1>Hola'); // la línea "  <h1>Hola mundo</h1>"
  await put(at); await page.keyboard.press('Tab');
  let v = await val();
  check('Tab sangra donde está el cursor y el foco no se va', v.v === INDEX.slice(0, at) + '  ' + INDEX.slice(at) && v.s === at + 2 && await page.evaluate(() => document.activeElement === document.querySelector('textarea.lmd-raw-edit')), v.v.slice(at - 6, at + 12));
  await page.keyboard.press('Shift+Tab'); v = await val();
  check('Shift+Tab saca la sangría', v.v === INDEX && v.s === at, [v.v.length, INDEX.length, v.s, at]);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); v = await val();
  check('y Ctrl+Z lo deshace como cualquier otra cosa escrita', v.v === INDEX, v.v.length - INDEX.length);
  const a = INDEX.indexOf('  <section id="uno">'); const b = INDEX.indexOf('    <img id="logo"');
  await put(a, b + 5); await page.keyboard.press('Tab'); v = await val();
  const block = INDEX.slice(a, INDEX.indexOf('\n', b)).split('\n');
  check('con varias líneas elegidas, Tab las sangra todas', v.v === INDEX.slice(0, a) + block.map((l) => '  ' + l).join('\n') + INDEX.slice(INDEX.indexOf('\n', b)) && v.s === a + 2 && v.e > v.s, v.v.slice(a, a + 60));
  await page.keyboard.press('Shift+Tab'); v = await val();
  check('y Shift+Tab las devuelve', v.v === INDEX, v.v.length - INDEX.length);
  const end = INDEX.indexOf('\n', INDEX.indexOf('<h2>Segunda</h2>'));
  await put(end); await page.keyboard.press('Enter'); await page.keyboard.type('- item'); await page.keyboard.press('Enter'); await page.keyboard.type('1. dos'); await page.keyboard.press('Enter'); await page.keyboard.type('x');
  v = await val(); const want = INDEX.slice(0, end) + '\n    - item\n    1. dos\n    x' + INDEX.slice(end);
  check('Enter conserva la sangría y no continúa listas ni las numera: no es Markdown', v.v === want, v.v.slice(end, end + 50));
  const live = await until(() => page.evaluate((n) => { const ed = document.querySelector('.lmd-cv-ed'); return ed.querySelectorAll('.lmd-ed-gutter i').length === n && ed.classList.contains('lmd-cv-hl') && ed.querySelector('.lmd-cv-back').textContent === document.querySelector('textarea.lmd-raw-edit').value + '\n'; }, lines + 3));
  check('los números y el color siguen a lo escrito', !!live);
  // Escape y después Tab saca el foco del cuadro.
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
  check('Escape y Tab salen del cuadro con el teclado', await page.evaluate(() => document.activeElement !== document.querySelector('textarea.lmd-raw-edit')) && (await val()).v === want);
  await page.click('textarea.lmd-raw-edit', { position: { x: 200, y: 200 } }); await page.keyboard.press('Control+s');
  const saved = await until(async () => (await disk(page, 'index.html')) === want, 6000);
  check('Ctrl+S guarda en el archivo real de la carpeta', !!saved, (await disk(page, 'index.html')).length - want.length);
  const outline = await until(() => page.evaluate(() => document.querySelector('.lmd-pane-outline .lmd-o-title').textContent === 'Sitio de prueba' && document.querySelectorAll('.lmd-pane-outline .lmd-o-link').length === 7));
  check('editando, el índice sigue ahí', !!outline);
  await page.click('.lmd-pane-outline .lmd-o-link >> text=Hola mundo'); await sleep(150);
  v = await val();
  check('y lleva el cursor a esa línea del cuadro', v.s === want.indexOf('  <h1>Hola') && v.s === v.e, [v.s, want.indexOf('  <h1>Hola')]);
  // Lado a lado: se escribe a la izquierda y la vista previa se pone al día.
  await mode(page, 'split'); const f1 = await preview(page, 'h1');
  const side = await page.evaluate(() => { const e = document.querySelector('.lmd-cv-ed').getBoundingClientRect(); const p = document.querySelector('.lmd-cv-prev').getBoundingClientRect(); return { ed: [Math.round(e.left), Math.round(e.right)], pv: [Math.round(p.left), Math.round(p.right)], top: Math.abs(e.top - p.top) < 40, h: p.height }; });
  check('lado a lado: el código a la izquierda y la página a la derecha', !!f1 && side.ed[1] <= side.pv[0] + 2 && side.pv[1] <= 1281 && side.top && side.h > 400, side);
  await put(want.indexOf('Hola mundo')); await page.keyboard.type('Chau ');
  const upd = await until(async () => { const f = await frameOf(page); return f && await f.evaluate(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Chau Hola mundo').catch(() => false); }, 6000);
  check('la vista previa sigue a lo que se escribe', !!upd);
  await shot(page, 'lado-a-lado-oscuro');
  await page.click('[data-act=mode-read]'); await sleep(500);
  check('al salir de edición vuelve el código con sus números', await page.evaluate(() => !document.querySelector('.lmd-cv-ed').classList.contains('lmd-cv-ed-on') && document.querySelectorAll('.lmd-article .lmd-cv-l').length > 30 && getComputedStyle(document.querySelector('.lmd-cv-ed')).display === 'contents'));
  // Un JSON se sigue editando como texto, y una nota no lleva nada de esto.
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1'); await page.click('[data-act=mode-edit]'); await sleep(300); await page.click('[data-act=view-raw]'); await page.waitForSelector('textarea.lmd-raw-edit:not([hidden])');
  const md = await page.evaluate(() => { const ta = document.querySelector('textarea.lmd-raw-edit'); const cs = getComputedStyle(ta); return { on: document.querySelector('.lmd-cv-ed').classList.contains('lmd-cv-ed-on'), wrap: ta.getAttribute('wrap'), pos: cs.position, color: cs.color, gut: document.querySelectorAll('.lmd-cv-ed .lmd-ed-gutter i').length, w: ta.getBoundingClientRect().width }; });
  check('el código fuente de una nota queda como siempre: sin números y sin tocar', !md.on && md.wrap === null && md.pos !== 'absolute' && !/rgba\(0, 0, 0, 0\)/.test(md.color) && md.gut === 0 && md.w > 400, md);
  await page.click('textarea.lmd-raw-edit'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- uno'); await page.keyboard.press('Enter'); await page.keyboard.type('dos');
  check('y ahí las listas de Markdown siguen andando', /\n- uno\n- dos$/.test((await val()).v), (await val()).v.slice(-20));
  await ctx.close();
});

// ---------- Vista previa ----------
await step('preview', 'Vista previa: el marco, la política y los archivos de la carpeta', async () => {
  const { ctx, page } = await web({ colorScheme: 'light' });
  reset();
  await openFile(page, 'index.html'); await mode(page, 'prev');
  const f = await preview(page, '#logo');
  const fa = await frameAttrs(page);
  check('la vista previa va en un marco con sandbox vacío: origen opaco y sin scripts', !!f && fa.has && fa.sandbox === '' && fa.srcdoc && fa.src === '' && fa.ref === 'no-referrer', fa);
  const d = await f.evaluate(() => { const st = (sel) => getComputedStyle(document.querySelector(sel)); const m = document.head.firstElementChild; const img = (id) => { const i = document.getElementById(id); return [i.naturalWidth, i.getAttribute('src').slice(0, 22)]; };
    return { first: [m.tagName, m.httpEquiv, m.content], body: st('body').color, h1: st('h1').color, p: st('p').marginLeft, imp: st('.imp').backgroundImage.slice(0, 26), ico: st('#ico').backgroundImage.slice(0, 26), sec: st('#sec').color, logo: img('logo'), afuera: img('afuera'), raiz: img('raiz'), ext: document.body.dataset.ext, inline: document.body.dataset.inline, colado: !!document.getElementById('colado'), origin: self.origin, url: location.href, links: document.querySelectorAll('link').length, base: document.querySelector('base').getAttribute('target'), targets: [...document.querySelectorAll('a')].map((a) => [a.target, a.getAttribute('href'), a.title]) }; });
  check('lo primero del documento es la política, sin red', d.first[0] === 'META' && d.first[1].toLowerCase() === 'content-security-policy' && d.first[2] === "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'" && d.origin === 'null' && d.url === 'about:srcdoc', d.first);
  check('los estilos de la carpeta se aplican: la hoja enlazada, su @import y los url() de adentro', d.body === 'rgb(1, 2, 3)' && d.h1 === 'rgb(10, 20, 30)' && d.p === '7px' && /^url\("data:image\/png/.test(d.imp) && /^url\("data:image\/png/.test(d.ico) && d.links === 0, d);
  check('las imágenes de la carpeta se ven, también las escritas desde la raíz', d.logo[0] === 8 && /^data:image\/png;base64/.test(d.logo[1]) && d.raiz[0] === 8, [d.logo, d.raiz]);
  check('lo que apunta fuera de la carpeta abierta no se lee: ni la imagen ni la hoja de estilos', d.afuera[0] === 0 && d.afuera[1] === '../afuera/foto.png' && d.sec !== 'rgb(9, 9, 9)', [d.afuera, d.sec]);
  check('estática: no corrió ningún script, ni el de la página ni el de la carpeta', d.ext === undefined && d.inline === undefined && !d.colado, [d.ext, d.inline]);
  check('los enlaces quedan sin destino: una página en blanco, en una pestaña nueva que el marco no puede abrir', d.base === '_blank' && J(d.targets) === J([['_blank', 'about:blank', ''], ['_blank', 'about:blank', 'sub/pagina.html'], ['_blank', 'about:blank', FAR + '/enlace']]), d.targets);
  const note = await page.evaluate(() => ({ text: document.querySelector('.lmd-cv-note').textContent, run: !!document.querySelector('.lmd-cv-note [data-cv=run]'), article: getComputedStyle(document.querySelector('.lmd-article')).display, w: document.querySelector('.lmd-cv-frame').getBoundingClientRect().width, bg: getComputedStyle(document.querySelector('.lmd-cv-frame')).backgroundColor }));
  check('el cartel dice que es estática y ofrece correr los scripts, con lo que significa', /Static view: scripts do not run and nothing is requested from the internet\./.test(note.text) && note.run && /They run isolated from your notes and your account, but someone else's page could signal out that you opened it\./.test(note.text) && await page.evaluate(() => document.querySelectorAll('.lmd-cv-note .lmd-cv-fine').length === 1) && note.article === 'none' && note.w > 800 && note.bg === 'rgb(255, 255, 255)', note);
  // Los enlaces no llevan a ningún lado.
  const pages0 = ctx.pages().length; const url0 = page.url();
  for (const id of ['frag', 'otro', 'ext']) { await f.click('#' + id, { timeout: 3000 }).catch(() => {}); await sleep(250); }
  const f2 = await frameOf(page);
  check('un clic en un enlace no navega la app, no abre pestañas y no rompe la vista previa', page.url() === url0 && ctx.pages().length === pages0 && !!f2 && await f2.evaluate(() => location.href === 'about:srcdoc' && !!document.getElementById('logo')).catch(() => false), [page.url(), ctx.pages().length]);
  check('y nada salió a la red', clean(leaks()), leaks());
  await shot(page, 'vista-previa-claro');
  // Un archivo de una subcarpeta: lo de más arriba dentro de la raíz sí, lo de afuera no.
  await openFile(page, 'pagina.html', 'sub'); const fs2 = await preview(page, '#logo');
  const d2 = await fs2.evaluate(() => ({ body: getComputedStyle(document.body).color, sec: getComputedStyle(document.getElementById('sec')).color, logo: document.getElementById('logo').naturalWidth, afuera: document.getElementById('afuera').naturalWidth, inline: document.body.dataset.inline }));
  check('desde una subcarpeta: ../ dentro de la raíz se resuelve, ../../ fuera de ella no', d2.body === 'rgb(1, 2, 3)' && d2.logo === 8 && d2.afuera === 0 && d2.sec !== 'rgb(9, 9, 9)' && d2.inline === undefined, d2);
  check('el modo elegido se conserva al pasar a otro HTML, pero sin scripts', (await frameAttrs(page)).sandbox === '' && await page.evaluate(() => document.querySelector('.lmd-cv-seg .lmd-on').dataset.cv === 'prev'));
  // Sin scripts en el archivo no hay nada que ofrecer.
  await openFile(page, 'plano.html'); await preview(page, 'h1');
  check('un HTML sin scripts no ofrece correrlos', await page.evaluate(() => !document.querySelector('.lmd-cv-note [data-cv=run]') && /Static view: nothing is requested from the internet\./.test(document.querySelector('.lmd-cv-note').textContent)));
  // El modo oscuro de la app no cambia la página.
  await mode(page, 'code');
  check('volver a Código saca el marco', await page.evaluate(() => !document.querySelector('iframe') && document.querySelector('.lmd-cv-prev').hidden && getComputedStyle(document.querySelector('.lmd-article')).display !== 'none'));
  await ctx.close();
});

// ---------- Ataques ----------
const noPwn = (a) => a.pwn === undefined && a.secreto === 'lo-que-no-debe-leerse' && a.pwnKey === null && a.injected === 0;
await step('attack', 'Un HTML hostil, sin scripts (lo de fábrica)', async () => {
  const { ctx, page, dialogs } = await web();
  const popups = []; ctx.on('page', (p) => popups.push(p.url()));
  const navs = []; page.on('framenavigated', (fr) => { if (fr === page.mainFrame() && !fr.url().startsWith(home)) navs.push(fr.url()); }); // abrir otro archivo cambia la dirección de la app, y eso no cuenta
  reset();
  await openFile(page, 'hostil.html');
  check('abrirlo como código no ejecuta ni pide nada', noPwn(await appState(page)) && clean(leaks()) && await page.evaluate(() => /top\.location = FAR/.test(document.querySelector('.lmd-article pre code').textContent) && !document.querySelector('.lmd-article form, .lmd-article iframe, .lmd-article base, .lmd-article meta')), leaks());
  await mode(page, 'prev'); const f = await preview(page, '#t'); await sleep(2500); // más que el meta refresh de 1 s
  const fa = await frameAttrs(page);
  const d = await (await frameOf(page)).evaluate(() => ({ r: document.body.dataset.r, js: document.body.dataset.js, onerror: document.body.dataset.onerror, url: location.href, t: !!document.getElementById('t'), base: [...document.querySelectorAll('base')].map((b) => [b.getAttribute('href'), b.getAttribute('target')]), refresh: document.querySelectorAll('meta[http-equiv=refresh i]').length, metas: [...document.querySelectorAll('meta[http-equiv]')].map((m) => m.content), links: document.querySelectorAll('link').length, imgs: [...document.images].map((i) => i.naturalWidth), font: document.fonts.size ? [...document.fonts].map((x) => x.status) : [] }));
  check('estático: su script no corre, sus manejadores tampoco', fa.sandbox === '' && !!f && d.t && d.r === undefined && d.onerror === undefined && d.js === undefined, d);
  check('su propia política, más floja, no afloja la de la app: la de la app va primero y las dos valen', d.metas.length === 2 && /^default-src 'none'/.test(d.metas[0]) && /default-src \*/.test(d.metas[1]) && d.imgs.every((w) => w === 0), d.metas);
  check('su <base> y su <meta refresh> no quedan, y el marco sigue en el mismo documento', J(d.base) === J([[null, '_blank']]) && d.refresh === 0 && d.url === 'about:srcdoc' && d.links === 0, [d.base, d.refresh, d.url]);
  const inner = await (await (await frameOf(page)).$('#anidado')).contentFrame();
  const nested = inner ? await inner.evaluate(() => ({ text: document.documentElement.innerText, url: location.href })).catch(() => null) : null;
  const kids = await (await frameOf(page)).evaluate(() => [...document.querySelectorAll('iframe, embed, object')].map((n) => [n.tagName, n.getAttribute('src'), n.getAttribute('srcdoc'), n.getAttribute('data')]));
  check('los marcos de adentro quedan vacíos: sin dirección y sin contenido propio', kids.length === 4 && kids.every((k) => k[1] === null && k[2] === null && k[3] === null) && (!nested || (nested.url === 'about:blank' && !/ANIDADO|anidado/.test(nested.text))), { kids, nested });
  if (process.env.DEBUG) console.log('    [fugas tras cargar] ' + J(leaks()) + ' anidado=' + J(nested));
  // Clics: javascript:, target=_top, afuera, relativo, self, el SVG y el botón del formulario.
  const fr = await frameOf(page);
  for (const id of ['js', 'top', 'ext', 'rel', 'self', 'frag', 'enviar', 'svga']) { await fr.click('#' + id, { timeout: 3000 }).catch(() => {}); await sleep(300); if (process.env.DEBUG) console.log('    [fugas tras #' + id + '] ' + J(leaks())); }
  await sleep(400);
  const after = await (await frameOf(page)).evaluate(() => ({ url: location.href, t: !!document.getElementById('t'), js: document.body.dataset.js })).catch(() => null);
  check('los clics (javascript:, target=_top, a otro sitio, relativo, el formulario) no hacen nada', !!after && after.url === 'about:srcdoc' && after.t && after.js === undefined && popups.length === 0 && navs.length === 0 && dialogs.length === 0, { after, popups, navs, dialogs });
  const st = await appState(page);
  check('la app queda intacta: nada leído, nada escrito, la misma dirección', noPwn(st) && /hostil\.html/.test(decodeURIComponent(st.url)), st);
  check('el servidor de afuera no recibió ni un pedido, ni una conexión, ni un paquete', clean(leaks()), leaks());
  await shot(page, 'hostil-estatico');
  // El que se va solo.
  reset(); await openFile(page, 'seva.html'); await preview(page, '#aca'); await sleep(1200);
  const gone = await (await frameOf(page)).evaluate(() => ({ url: location.href, aca: !!document.getElementById('aca'), ran: document.body.dataset.ran })).catch(() => null);
  check('una página que quiere irse sola (refresh, location) se queda donde está', !!gone && gone.url === 'about:srcdoc' && gone.aca && gone.ran === undefined && clean(leaks()) && navs.length === 0, { gone, l: leaks() });
  // El contenido y el nombre armados para romper el envoltorio.
  await openFile(page, 'rompe.html'); const fb = await preview(page, '#roto');
  const br = await fb.evaluate(() => ({ ran: document.body.dataset.ran, roto: document.getElementById('roto').textContent }));
  const stb = await appState(page);
  check('un contenido con cierres de etiquetas y comillas queda adentro del marco y no corre', br.ran === undefined && br.roto === 'roto' && noPwn(stb) && stb.frames === 1 && await page.evaluate(() => document.querySelectorAll('.lmd-main > h1, body > h1, body > img').length === 0), [br, stb]);
  await page.click(node(ODD_NAME)); await page.waitForSelector('.lmd-article pre code.lmd-cv', { state: 'attached' }); await sleep(300); const fn = await preview(page, 'h1');
  const sn = await appState(page);
  const shown = await page.evaluate(() => ({ name: document.querySelector('.lmd-docname').textContent, title: document.querySelector('.lmd-pane-outline .lmd-o-title').textContent, imgs: document.querySelectorAll('.lmd-sidebar img, .lmd-topbar img, .lmd-cv-bar img, .lmd-cv-prev img, .lmd-pane-outline script').length }));
  check('un archivo con comillas y etiquetas en el NOMBRE se muestra como texto', !!fn && noPwn(sn) && shown.imgs === 0 && shown.title === ODD_NAME && shown.name.includes('<img src=x'), [sn, shown]);
  check('en todo el recorrido no hubo ventanas, diálogos, navegación ni salida a la red', popups.length === 0 && dialogs.length === 0 && navs.length === 0 && clean(leaks()), { popups, dialogs, navs, l: leaks() });
  await ctx.close();
});

await step('scripts', 'El mismo HTML hostil, con sus scripts habilitados', async () => {
  const { ctx, page, dialogs } = await web();
  const popups = []; ctx.on('page', (p) => popups.push(p.url()));
  const navs = []; page.on('framenavigated', (fr) => { if (fr === page.mainFrame() && !fr.url().startsWith(home)) navs.push(fr.url()); }); // abrir otro archivo cambia la dirección de la app, y eso no cuenta
  reset();
  await openFile(page, 'index.html'); await mode(page, 'prev'); await preview(page, '#logo');
  await page.click('.lmd-cv-note [data-cv=run]');
  const f = await until(async () => { const fr = await frameOf(page); return fr && await fr.evaluate(() => document.body && document.body.dataset.inline === '1').catch(() => false) ? fr : null; }, 10000);
  const fa = await frameAttrs(page);
  check('con el botón, el marco pasa a allow-scripts y nada más, y carga htmlrun.html', !!f && fa.sandbox === 'allow-scripts' && fa.src === origin + '/src/htmlrun.html' && !fa.srcdoc, fa);
  const d = await f.evaluate(() => ({ ext: document.body.dataset.ext, inline: document.body.dataset.inline, colado: !!document.getElementById('colado'), origin: self.origin, body: getComputedStyle(document.body).color, logo: document.getElementById('logo').naturalWidth, metas: [...document.querySelectorAll('meta[http-equiv]')].map((m) => m.content), frag: document.getElementById('frag').target }));
  check('corren el script de la página y el de su carpeta (que entra como texto, sin romper nada)', d.ext === '1' && d.inline === '1' && !d.colado && d.body === 'rgb(1, 2, 3)' && d.logo === 8, d);
  check('sigue con el origen opaco y con la política sin red', d.origin === 'null' && d.metas[0] === "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'", d);
  check('el cartel lo dice y ofrece detenerlos', await page.evaluate(() => /scripts are running, isolated from your notes and your account\./.test(document.querySelector('.lmd-cv-note').textContent) && !!document.querySelector('.lmd-cv-note [data-cv=stop]') && !document.querySelector('.lmd-cv-note [data-cv=run]')));
  await f.click('#frag').catch(() => {}); await sleep(300);
  check('con scripts, un ancla de la página se mueve dentro de la página', d.frag === '_self' && await (await frameOf(page)).evaluate(() => /htmlrun\.html#dos$/.test(location.href) && !!document.getElementById('logo')).catch(() => false));
  await shot(page, 'con-scripts');
  // Otro archivo no hereda el permiso.
  await openFile(page, 'hostil.html'); await preview(page, '#t'); await sleep(400);
  const fb = await frameAttrs(page);
  const quiet = await (await frameOf(page)).evaluate(() => document.body.dataset.r);
  check('el permiso no pasa a otro archivo: el hostil se abre estático', fb.sandbox === '' && quiet === undefined && await page.evaluate(() => !!document.querySelector('.lmd-cv-note [data-cv=run]')), fb);
  check('y hasta acá nada salió a la red', clean(leaks()), leaks());
  // Ahora sí: el hostil con sus scripts.
  reset();
  await page.click('.lmd-cv-note [data-cv=run]');
  const fh = await until(async () => { const fr = await frameOf(page); return fr && await fr.evaluate(() => document.body && !!document.body.dataset.r).catch(() => false) ? fr : null; }, 12000);
  const R = fh ? JSON.parse(await fh.evaluate(() => document.body.dataset.r)) : {};
  check('habilitado, su script corre', R.ran === 1 && (await frameAttrs(page)).sandbox === 'allow-scripts', R);
  check('no lee ni escribe nada de la app: ni el almacenamiento, ni el documento, ni una variable', R.parentLS === 'blocked' && R.topLS === 'blocked' && R.parentDoc === 'blocked' && R.parentVar === 'blocked' && R.origin === 'null', R);
  check('no tiene almacenamiento propio ni cookies, ni ve a la extensión', R.ls === 'blocked' && R.cookie === 'blocked' && R.idb !== 'ok' && R.ext === false, R);
  check('no navega la pestaña, no abre ventanas, no evalúa texto como código, no muestra diálogos', R.top === 'blocked' && R.open !== 'ABRIO' && R.eval === 'blocked' && dialogs.length === 0, [R.top, R.open, R.eval, dialogs]);
  check('fetch no sale', R.fetch === 'blocked', R.fetch);
  check('WebRTC no está en la ventana de la página', R.rtc === 'blocked' && await fh.evaluate(() => typeof RTCPeerConnection === 'undefined' && typeof webkitRTCPeerConnection === 'undefined'), R.rtc);
  await sleep(2500); // el meta refresh, el formulario, los pedidos sueltos, WebRTC
  const fr = await frameOf(page);
  for (const id of ['top', 'ext', 'rel', 'self', 'enviar']) { await fr.click('#' + id, { timeout: 3000 }).catch(() => {}); await sleep(200); }
  await sleep(800);
  const st = await appState(page);
  check('la app queda intacta con los scripts corriendo', noPwn(st) && /hostil\.html/.test(decodeURIComponent(st.url)) && popups.length === 0 && navs.length === 0 && dialogs.length === 0, { st, popups, navs, dialogs });
  const l = leaks();
  check('el servidor de afuera no recibió ningún pedido HTTP (imágenes, estilos, fetch, XHR, beacon, WebSocket, formulario, marcos, navegación)', l.hits.length === 0, l.hits);
  // Lo que una política de contenido no cierra en este navegador, medido: conexiones que se abren sin llegar a pedir
  // nada (un <link rel=preconnect>, un marco que intenta navegar) y paquetes de WebRTC. Con eso una página puede avisar
  // que la abrieron; de la app no puede sacar nada. Es el motivo por el que los scripts no corren de fábrica.
  console.log('    con scripts, sin pedidos HTTP; lo que la política no cubre: ' + l.conns + ' conexiones sin pedido y ' + l.udp + ' paquetes de WebRTC (directo: ' + R.rtc + '; por un marco vacío: ' + R.rtc2 + '; los paquetes que haya son del marco con script propio)');
  await shot(page, 'hostil-con-scripts');
  // El que se va solo, con scripts: la política de la app no deja que el marco cargue otro sitio.
  reset(); await openFile(page, 'seva.html'); await preview(page, '#aca'); await page.click('.lmd-cv-note [data-cv=run]'); await sleep(2000);
  const st2 = await appState(page);
  check('con scripts, irse a otro sitio tampoco llega a ningún lado', leaks().hits.length === 0 && noPwn(st2) && navs.length === 0 && /seva\.html/.test(decodeURIComponent(st2.url)), { l: leaks(), navs });
  // Detener, y que no se recuerde.
  await openFile(page, 'index.html'); await preview(page, '#logo');
  check('al volver al primero en la misma sesión sigue habilitado', (await frameAttrs(page)).sandbox === 'allow-scripts');
  await page.click('.lmd-cv-note [data-cv=stop]'); await preview(page, '#logo'); await sleep(200);
  check('"Detener" vuelve a la vista estática', (await frameAttrs(page)).sandbox === '' && (await (await frameOf(page)).evaluate(() => document.body.dataset.inline)) === undefined);
  await page.click('.lmd-cv-note [data-cv=run]'); await sleep(600);
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)));
  check('el permiso no queda escrito en ningún almacenamiento', !/allow-scripts|runOk|lmd-run|"run"/.test(stored));
  await page.reload(); await page.waitForSelector('.lmd-article pre code.lmd-cv', { state: 'attached', timeout: 15000 }).catch(() => {});
  const back = await page.evaluate(() => (window.LMD && LMD.codeview ? LMD.codeview.peek() : null));
  if (back && back.mode !== 'prev') { await mode(page, 'prev'); }
  const re = await preview(page, 'h1');
  check('al recargar la página, el archivo vuelve a abrirse sin scripts', !!re && (await frameAttrs(page)).sandbox === '' && (await re.evaluate(() => document.body.dataset.inline)) === undefined, back);
  await ctx.close();
});

// ---------- htmlrun.html por su cuenta ----------
await step('runner', 'htmlrun.html no sirve para otra cosa', async () => {
  const { ctx, page } = await web();
  // Suelta en una pestaña.
  const p2 = await ctx.newPage(); await p2.goto(origin + '/src/htmlrun.html'); await sleep(300);
  await p2.evaluate(() => { window.postMessage({ lmdRun: '<p id=x>escrito</p>' }, '*'); }); await sleep(300);
  check('abierta suelta no escribe nada', await p2.evaluate(() => !document.getElementById('x') && document.body.children.length === 0));
  await p2.close();
  // Enmarcada por la app SIN aislar: tendría el origen de la app, así que no hace nada.
  const bare = await page.evaluate((src) => new Promise((resolve) => {
    const f = document.createElement('iframe'); f.src = src; let ready = false;
    const on = (e) => { if (e.source === f.contentWindow) ready = true; }; addEventListener('message', on);
    f.onload = () => { f.contentWindow.postMessage({ lmdRun: '<script>parent.__pwn = 11; localStorage.setItem("pwn", "1")<\/script><p id=x>escrito</p>' }, '*'); setTimeout(() => { let x = null; try { x = !!f.contentDocument.getElementById('x'); } catch (e) { x = 'sin acceso'; } removeEventListener('message', on); f.remove(); resolve({ ready, x, pwn: window.__pwn, key: localStorage.getItem('pwn') }); }, 700); };
    document.body.appendChild(f);
  }), origin + '/src/htmlrun.html');
  check('enmarcada sin sandbox (con el origen de la app) no avisa, no escribe y no corre nada', bare.ready === false && bare.x === false && bare.pwn === undefined && bare.key === null, bare);
  // Aislada, pero enmarcada por otro sitio: no le hace caso.
  const p3 = await ctx.newPage(); await p3.goto(FAR + '/marco.html'); await sleep(1600);
  const other = await p3.evaluate(() => document.body.dataset.got || '');
  const inner = await (await (await p3.$('#f')).contentFrame()).evaluate(() => !!document.getElementById('x')).catch(() => 'error');
  check('aislada pero dentro de otro sitio, no avisa ni escribe lo que le manden', other === '' && inner === false, { other, inner });
  await p3.close();
  // Sin aislar y fuera de la app, la política de la app tampoco deja enmarcar otra cosa.
  const blocked = await page.evaluate((far) => new Promise((resolve) => { const f = document.createElement('iframe'); const seen = []; document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective + ' ' + e.blockedURI)); f.src = far + '/otro'; document.body.appendChild(f); const b = document.createElement('iframe'); b.src = URL.createObjectURL(new Blob(['<p>blob</p>'], { type: 'text/html' })); document.body.appendChild(b); const d = document.createElement('iframe'); d.src = 'data:text/html,<p>data</p>'; document.body.appendChild(d); setTimeout(() => { f.remove(); b.remove(); d.remove(); resolve(seen); }, 800); }), FAR);
  check("la política de la app sigue sin dejar enmarcar otro sitio, un blob: ni un data:", blocked.length === 3 && blocked.every((v) => /^frame-src/.test(v)) && !out.hits.some((h) => /\/otro/.test(h)), blocked);
  await ctx.close();
});

// ---------- Teléfono ----------
await step('phone', 'A 390 px: un panel y el interruptor', async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await web({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
    // En pantalla chica el explorador está en el panel lateral.
    if (!(await page.isVisible(node('index.html')).catch(() => false))) { await page.click('[data-act=sidebar]').catch(() => {}); await sleep(300); }
    if (!(await page.isVisible(node('index.html')).catch(() => false))) { await page.evaluate(() => { const t = [...document.querySelectorAll('.lmd-tabs button, [data-tab]')].find((b) => /files/i.test(b.dataset.tab || b.textContent)); if (t) t.click(); }); await sleep(300); }
    await page.click(node('index.html')); await page.waitForSelector('.lmd-article pre code.lmd-cv', { state: 'attached', timeout: 15000 }); await sleep(400);
    const s = await page.evaluate(() => { const bar = document.querySelector('.lmd-cv-bar').getBoundingClientRect(); const seg = [...document.querySelectorAll('.lmd-cv-seg button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.cv); const wrap = document.querySelector('[data-cv=wrap]').getBoundingClientRect();
      return { over: document.documentElement.scrollWidth - innerWidth, bar: [Math.round(bar.left), Math.round(bar.right), Math.round(bar.height)], seg, wrapIn: wrap.right <= innerWidth + 1 && wrap.width > 0, rows: document.querySelectorAll('.lmd-cv-l').length, ws: getComputedStyle(document.querySelector('pre code.lmd-cv')).whiteSpace }; });
    check(scheme + ': la barra entra en 390 px, sin "Lado a lado" y sin desbordar la página', s.over <= 0 && s.bar[1] <= 391 && s.bar[2] < 60 && J(s.seg) === J(['code', 'prev']) && s.wrapIn && s.rows > 30 && s.ws === 'pre-wrap', s);
    await shot(page, 'telefono-codigo-' + scheme);
    await mode(page, 'prev'); const f = await preview(page, '#logo');
    const p = await page.evaluate(() => { const fr = document.querySelector('.lmd-cv-frame').getBoundingClientRect(); return { w: Math.round(fr.width), h: Math.round(fr.height), article: getComputedStyle(document.querySelector('.lmd-article')).display, over: document.documentElement.scrollWidth - innerWidth, bg: getComputedStyle(document.querySelector('.lmd-cv-frame')).backgroundColor, note: getComputedStyle(document.querySelector('.lmd-cv-note')).backgroundColor, run: document.querySelector('.lmd-cv-note [data-cv=run]').getBoundingClientRect().right <= innerWidth }; });
    const inner = f ? await f.evaluate(() => ({ body: getComputedStyle(document.body).color, bg: getComputedStyle(document.documentElement).backgroundColor, w: innerWidth })) : null;
    check(scheme + ': la vista previa ocupa el panel entero y conserva los colores de la página', !!f && p.w === 390 && p.h > 400 && p.article === 'none' && p.over <= 0 && p.run && p.bg === 'rgb(255, 255, 255)' && inner.body === 'rgb(1, 2, 3)' && inner.w === 390, { p, inner });
    await shot(page, 'telefono-vista-previa-' + scheme);
    await mode(page, 'code'); await page.click('[data-act=mode-edit]').catch(() => {}); await page.waitForSelector('textarea.lmd-raw-edit:not([hidden])', { timeout: 5000 }).catch(() => {}); await sleep(300);
    const e = await page.evaluate(() => { const ed = document.querySelector('.lmd-cv-ed').getBoundingClientRect(); return { on: document.querySelector('.lmd-cv-ed').classList.contains('lmd-cv-ed-on'), l: Math.round(ed.left), r: Math.round(ed.right), h: Math.round(ed.height), over: document.documentElement.scrollWidth - innerWidth }; });
    check(scheme + ': el cuadro de edición entra en el ancho', e.on && e.l >= 0 && e.r <= 390 && e.h > 300 && e.over <= 0, e);
    await shot(page, 'telefono-editar-' + scheme);
    await ctx.close();
  }
});

// ---------- Un archivo grande ----------
await step('big', 'Un HTML de 500 KB, con el CSS y el JS en una sola línea', async () => {
  const { ctx, page } = await web();
  await page.evaluate(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); });
  const t0 = Date.now();
  await page.click(node('grande.html')); await page.waitForSelector('.lmd-article pre code.lmd-cv .lmd-cv-l', { timeout: 20000 });
  const shown = Date.now() - t0;
  const lines = BIG.split('\n').length - 1;
  const s = await page.evaluate(() => ({ rows: document.querySelectorAll('.lmd-cv-l').length, len: document.querySelector('.lmd-article pre code').textContent.length, chunks: document.querySelectorAll('.lmd-cv-c').length, cv: getComputedStyle(document.querySelector('.lmd-cv-c')).contentVisibility, items: document.querySelectorAll('.lmd-pane-outline .lmd-o-link').length, more: /first 1,500/.test(document.querySelector('.lmd-pane-outline').textContent) }));
  check('se ve entero y con sus números en menos de 3 s', shown < 3000 && s.rows === lines && s.len === BIG.length && s.cv === 'auto' && s.chunks === Math.ceil(lines / 100), { shown, rows: s.rows, lines });
  check('el índice tiene tope y lo dice', s.items === 1500 && s.more, s);
  const colored = await until(() => page.evaluate(() => { const rows = document.querySelectorAll('.lmd-cv-l'); return !!rows[rows.length - 3].querySelector('span[class^="hljs-"]') && !!rows[40].querySelector('span[class^="hljs-"]'); }), 15000);
  const long = await page.evaluate(() => { const rows = document.querySelectorAll('.lmd-cv-l'); return { style: rows[5].textContent.length, kids: rows[5].children.length, tasks: window.__long.slice(), same: null }; });
  check('el color llega a todo el archivo, salvo a las líneas larguísimas, que quedan como texto', !!colored && long.style > 50000 && long.kids === 0 && await page.evaluate((n) => document.querySelector('.lmd-article pre code').textContent.length === n, BIG.length), { style: long.style, kids: long.kids });
  const worst = Math.max(0, ...long.tasks);
  console.log('    abrir: ' + shown + ' ms hasta verlo; tareas largas (ms): ' + J(long.tasks.sort((a, b) => b - a).slice(0, 8)));
  check('ninguna tarea traba la página más de 1,5 s (la peor es resaltar todo el archivo, una vez y en un rato libre)', worst < 1500, long.tasks);
  // Ir al final y volver: saltar a una línea lejana es inmediato.
  await page.evaluate(() => { window.__long.length = 0; });
  const jump = await page.evaluate(() => new Promise((resolve) => { const b = [...document.querySelectorAll('.lmd-pane-outline .lmd-o-link')].pop(); const t = performance.now(); b.click(); requestAnimationFrame(() => setTimeout(() => { const n = b.dataset.cvLine; const r = document.querySelector('.lmd-cv-l[data-n="' + n + '"]').getBoundingClientRect(); resolve({ ms: Math.round(performance.now() - t), seen: r.top > 0 && r.bottom < innerHeight }); }, 0)); }));
  check('saltar a una línea del final tarda menos de 400 ms', jump.ms < 400 && jump.seen, jump);
  // Editar.
  const t1 = Date.now(); await page.click('[data-act=mode-edit]'); await page.waitForSelector('textarea.lmd-raw-edit:not([hidden])'); const edShown = Date.now() - t1; await sleep(500);
  const e = await page.evaluate(() => { const ed = document.querySelector('.lmd-cv-ed'); return { on: ed.classList.contains('lmd-cv-ed-on'), hl: ed.classList.contains('lmd-cv-hl'), gut: ed.querySelectorAll('.lmd-ed-gutter i').length, len: document.querySelector('textarea.lmd-raw-edit').value.length, color: getComputedStyle(document.querySelector('textarea.lmd-raw-edit')).color }; });
  check('editando un archivo así el cuadro muestra su propio texto, sin color, con los números', e.on && !e.hl && e.gut === lines + 1 && e.len === BIG.length && !/rgba\(0, 0, 0, 0\)/.test(e.color) && edShown < 3000, Object.assign({ edShown }, e));
  await page.evaluate(() => { window.__long.length = 0; }); // entrar a editar acomoda el archivo entero en el cuadro, una vez; lo que sigue mide escribir
  const keys = [];
  for (let i = 0; i < 5; i++) keys.push(await page.evaluate((at) => new Promise((resolve) => { const ta = document.querySelector('textarea.lmd-raw-edit'); ta.focus(); ta.setSelectionRange(at, at); const t = performance.now(); document.execCommand('insertText', false, 'x'); requestAnimationFrame(() => setTimeout(() => resolve(Math.round(performance.now() - t)), 0)); }), BIG.length - 200 + i));
  console.log('    editar: ' + edShown + ' ms hasta el cuadro; cada tecla (ms hasta el cuadro siguiente): ' + J(keys));
  check('cada tecla se dibuja en menos de 250 ms', Math.max(...keys) < 250, keys);
  await sleep(1500);
  const after = await page.evaluate(() => window.__long.slice());
  console.log('    tareas largas mientras se edita (ms): ' + J(after.sort((a, b) => b - a).slice(0, 8)));
  check('escribir no dispara un redibujo que trabe: nada pasa de 300 ms', Math.max(0, ...after) < 300, after);
  // La vista previa de un archivo así.
  await page.click('[data-act=mode-read]'); await sleep(400);
  const t2 = Date.now(); await mode(page, 'prev'); const f = await preview(page, '#s3'); const pv = Date.now() - t2;
  console.log('    vista previa: ' + pv + ' ms');
  check('la vista previa de 500 KB aparece en menos de 4 s', !!f && pv < 4000, pv);
  await shot(page, 'grande');
  await ctx.close();
});

// ---------- La página de la extensión ----------
await step('ext', 'En la página de la extensión: estática, y lo dice', async () => {
  const { ctx, page } = await ext();
  const pages0 = ctx.pages().length;
  reset();
  await openFile(page, 'index.html'); await mode(page, 'prev'); const f = await preview(page, '#logo');
  const fa = await frameAttrs(page);
  const d = f ? await f.evaluate(() => ({ body: getComputedStyle(document.body).color, logo: document.getElementById('logo').naturalWidth, ico: getComputedStyle(document.getElementById('ico')).backgroundImage.slice(0, 20), inline: document.body.dataset.inline, origin: self.origin, ext: !!(window.chrome && chrome.runtime && chrome.runtime.id) })) : {};
  check('la vista previa estática anda igual: estilos e imágenes de la carpeta, origen opaco, sin scripts', !!f && fa.sandbox === '' && fa.srcdoc && d.body === 'rgb(1, 2, 3)' && d.logo === 8 && /^url\("data:image/.test(d.ico) && d.inline === undefined && d.origin === 'null', { fa, d });
  const note = await page.evaluate(() => ({ text: document.querySelector('.lmd-cv-note').textContent, run: !!document.querySelector('[data-cv=run]') }));
  check('no ofrece correr scripts y dice por qué', !note.run && /They cannot run in the extension\. To try them, open the file on sharpmd\.app\./.test(note.text), note);
  await shot(page, 'extension-vista-previa');
  await openFile(page, 'hostil.html'); await preview(page, '#t'); await sleep(2500);
  const fr = await frameOf(page);
  const h = await fr.evaluate(() => ({ r: document.body.dataset.r, onerror: document.body.dataset.onerror, url: location.href, imgs: [...document.images].map((i) => i.naturalWidth) }));
  for (const id of ['js', 'top', 'ext', 'rel', 'self', 'enviar']) { await fr.click('#' + id, { timeout: 3000 }).catch(() => {}); await sleep(200); }
  const st = await page.evaluate(() => ({ pwn: window.__pwn, secreto: localStorage.getItem('secreto'), url: location.href, frames: document.querySelectorAll('iframe').length }));
  check('el hostil: nada corre, nada sale, la página de la extensión queda intacta', h.r === undefined && h.onerror === undefined && h.url === 'about:srcdoc' && h.imgs.every((w) => w === 0) && st.pwn === undefined && st.secreto === 'lo-que-no-debe-leerse' && /hostil\.html/.test(decodeURIComponent(st.url)) && ctx.pages().length === pages0 && clean(leaks()), { h, st, pages: ctx.pages().length, l: leaks() });
  // Aunque alguien fuerce el permiso, en la extensión no se monta el marco con scripts.
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.cv = 'run'; document.querySelector('.lmd-cv-note').appendChild(b); b.click(); }); await sleep(600);
  check('un botón "correr" inventado no cambia nada en la extensión', (await frameAttrs(page)).sandbox === '' && clean(leaks()));
  await ctx.close();
});

for (const c of closers) await c().catch(() => {});
if (browser) await browser.close();
site.close(); far.close(); stun.close();
check('sin errores de página', errors.length === 0, errors.slice(0, 5));
process.exit(done() ? 1 : 0);
