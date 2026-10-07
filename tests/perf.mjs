// Medición de carga de la app web. No forma parte de `npm test`: se corre a mano, antes y después de tocar la carga.
//   node perf.mjs            tabla completa (dos redes, frío y caliente, inicio y nota nueva)
//   RUNS=5 node perf.mjs     más corridas por celda (se informa la mediana)
//   JSON=1 node perf.mjs     además, los números crudos en una línea
// El sitio se sirve como en GitHub Pages: comprimido, con caché corta y por HTTP/2 si hay openssl para armar un
// certificado de prueba (sin él, HTTP/1.1: los pedidos chicos salen más caros de lo que son en producción).
// La red y la CPU se limitan por CDP. "Usable" es cuando se va la pantalla de carga y hay inicio o nota a la vista;
// "interactiva", el primer momento de reposo del hilo principal después de eso.
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import http from 'http'; import http2 from 'http2'; import zlib from 'zlib';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const ZIP = /\.(html|js|css|json|webmanifest|svg|md)$/;
const RUNS = Number(process.env.RUNS || 3);
// Los perfiles de las herramientas de Chrome.
const NETS = {
  'Fast 4G': { downloadThroughput: 9e6 / 8 * 0.9, uploadThroughput: 1.5e6 / 8 * 0.9, latency: 60 * 2.75 },
  'Slow 4G': { downloadThroughput: 1.6e6 / 8 * 0.9, uploadThroughput: 750e3 / 8 * 0.9, latency: 150 * 3.75 },
};
const PAGES = { inicio: '/src/app.html', 'nota nueva': '/src/app.html?new=1' };

const zipped = new Map();
function answer(url) {
  const rel = decodeURIComponent(url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' };
  let body = fs.readFileSync(file);
  if (ZIP.test(file)) {
    if (!zipped.has(file)) zipped.set(file, zlib.gzipSync(body));
    body = zipped.get(file); headers['content-encoding'] = 'gzip';
  }
  return { headers, body };
}
function cert() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdperf-')); const key = path.join(dir, 'k.pem'); const crt = path.join(dir, 'c.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const out = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) }; fs.rmSync(dir, { recursive: true, force: true }); return out;
  } catch (e) { return null; }
}
async function serve() {
  const tls = process.env.H1 ? null : cert();
  const handler = (req, res) => { const a = answer(req.url); if (!a) { res.writeHead(404); res.end(); return; } res.writeHead(200, a.headers); res.end(a.body); };
  const server = tls ? http2.createSecureServer({ ...tls, allowHTTP1: true }, handler) : http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: (tls ? 'https' : 'http') + '://localhost:' + server.address().port, h2: !!tls };
}

// Lo que la página anota de sí misma: cuándo se fue la pantalla de carga y cuándo quedó en reposo.
const PROBE = () => {
  const m = window.__perf = { usable: 0, idle: 0 };
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  const look = () => {
    if (m.usable) return;
    const s = document.getElementById('lmd-splash');
    if (s && !s.classList.contains('lmd-splash-out')) return;
    if (!document.querySelector('.lmd-home, .lmd-article')) return;
    m.usable = performance.now(); obs.disconnect();
    idle(() => { m.idle = performance.now(); });
  };
  const obs = new MutationObserver(look);
  document.addEventListener('DOMContentLoaded', () => { obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); look(); });
};

async function visit(ctx, url, net) {
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reqs = new Map(); let bytes = 0; let count = 0; let frozen = null;
  cdp.on('Network.requestWillBeSent', (e) => { if (!/^(data|blob):/.test(e.request.url)) reqs.set(e.requestId, 1); });
  cdp.on('Network.loadingFinished', (e) => { if (reqs.has(e.requestId) && !frozen) { bytes += e.encodedDataLength; count++; } });
  await page.addInitScript(PROBE);
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__perf && window.__perf.usable, null, { timeout: 120000 });
  frozen = { bytes, count };
  await page.waitForFunction(() => window.__perf.idle, null, { timeout: 120000 });
  const m = await page.evaluate(() => ({ usable: window.__perf.usable, idle: window.__perf.idle, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0 }));
  // Que de verdad se pueda escribir: en una nota nueva, el bloque editable existe.
  return { page, cdp, ...m, ...frozen };
}
async function swReady(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise((r) => { if (navigator.serviceWorker.controller) r(); else navigator.serviceWorker.addEventListener('controllerchange', r); setTimeout(r, 8000); })));
  // La precarga en reposo, si la hay, termina antes de la segunda visita.
  await page.waitForTimeout(2500);
}

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const { server, origin, h2 } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), args: ['--ignore-certificate-errors'] });
const rows = []; const rawOut = {};
for (const [netName, net] of Object.entries(NETS)) {
  for (const [pageName, rel] of Object.entries(PAGES)) {
    const cold = []; const warm = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', ignoreHTTPSErrors: true });
      const a = await visit(ctx, origin + rel, net); cold.push(a);
      // Segunda visita: sin limitar la red mientras el service worker termina de guardar, y de nuevo limitada.
      await a.cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
      await swReady(a.page); await a.page.close();
      const b = await visit(ctx, origin + rel, net); warm.push(b);
      await ctx.close();
    }
    for (const [temp, list] of [['frío', cold], ['caliente', warm]]) {
      const r = { red: netName, pagina: pageName, visita: temp, pedidos: median(list.map((x) => x.count)), kB: Math.round(median(list.map((x) => x.bytes)) / 1024), fcp: Math.round(median(list.map((x) => x.fcp))), usable: Math.round(median(list.map((x) => x.usable))), interactiva: Math.round(median(list.map((x) => x.idle))) };
      rows.push(r);
    }
  }
}
await browser.close(); server.close();
console.log('Servido por ' + (h2 ? 'HTTP/2' : 'HTTP/1.1') + ', comprimido, CPU 4x, mediana de ' + RUNS + ' corridas\n');
console.log('| red | página | visita | pedidos | kB | primer pintado (ms) | usable (ms) | interactiva (ms) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log('| ' + [r.red, r.pagina, r.visita, r.pedidos, r.kB, r.fcp, r.usable, r.interactiva].join(' | ') + ' |');
if (process.env.JSON) console.log('\n' + JSON.stringify(rows));
if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
process.exit(0);
