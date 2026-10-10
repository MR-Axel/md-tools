// Prueba en navegadores de verdad: una pagina servida desde https://sharpmd.app
// le habla al programa local. Mide dos cosas:
//   1. que deja pasar cada motor (Chromium, Firefox, WebKit) de una pagina
//      https publica a http://127.0.0.1, con y sin el permiso de red local;
//   2. que el panel propio del programa, la salida para Safari, anda en los tres.
// La pieza de la app se prueba en tests/localtools.mjs, en la raiz del repositorio.
//
// Necesita playwright-core, que no es dependencia del programa:
//   PLAYWRIGHT_CORE=<ruta a node_modules/playwright-core> node test/browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.log('Falta PLAYWRIGHT_CORE: se saltea.'); process.exit(0); }
const pw = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-local-test-'));
process.env.SHARPMD_LOCAL_HOME = HOME;
const config = require('../src/config');
const { create } = require('../src/server');
const token = config.token(false);
const app = create({ cfg: Object.assign(config.load(), { port: 0 }), token, fixed: true });
const port = await app.listen();

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? '  ok    ' : '  FALLA ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lo que hace la pagina: un GET con el token, como localtools.js.
const probe = ([p, tk]) => fetch('http://127.0.0.1:' + p + '/v1/status', { headers: { Authorization: 'Bearer ' + tk }, cache: 'no-store' })
  .then(async (r) => ({ status: r.status, app: (await r.json()).app }), (e) => ({ error: String(e.message || e) }));

// ---------- 1. Que deja pasar cada motor ----------
console.log('\n  De https://sharpmd.app (pagina real) a http://127.0.0.1:' + port + '\n');
const report = {};
for (const name of ['chromium', 'firefox', 'webkit']) {
  let browser;
  try { browser = await pw[name].launch({ headless: true }); } catch (e) { console.log('  ' + name + ': no esta instalado (' + String(e.message).split('\n')[0] + ')'); continue; }
  const version = browser.version();
  for (const grant of [false, true]) {
    const ctx = await browser.newContext();
    let granted = '';
    if (grant) {
      for (const perm of ['local-network-access', 'loopback-network']) {
        try { await ctx.grantPermissions([perm], { origin: 'https://sharpmd.app' }); granted = perm; break; } catch (e) { /* este motor no lo conoce */ }
      }
      if (!granted) { await ctx.close(); continue; }
    }
    let page;
    try { page = await ctx.newPage(); } catch (e) { console.log('  ' + name + ' ' + version + ': no tiene ese permiso (' + String(e.message).split('\n')[0] + ')'); await ctx.close().catch(() => {}); continue; }
    let line;
    try {
      await page.goto('https://sharpmd.app/robots.txt', { waitUntil: 'load', timeout: 20000 });
      const state = await page.evaluate(async () => { const out = {}; for (const n of ['local-network-access', 'loopback-network', 'local-network']) { try { out[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { /* no existe */ } } return out; });
      const good = await Promise.race([page.evaluate(probe, [port, token]), sleep(8000).then(() => ({ error: 'sin respuesta en 8 s (pregunta de permiso sin contestar)' }))]);
      const evil = good.status === 200 ? await page.evaluate(probe, [port, 'x'.repeat(43)]) : null;
      line = { permisos: state, conToken: good, conTokenErrado: evil };
    } catch (e) { line = { error: String(e.message).split('\n')[0] }; }
    report[name + (grant ? ' + permiso (' + granted + ')' : ' sin permiso')] = line;
    console.log('  ' + name + ' ' + version + (grant ? ', permiso ' + granted + ' dado' : ', sin permiso') + '\n        ' + JSON.stringify(line));
    await ctx.close();
  }
  // Desde otro sitio: el programa no contesta CORS y la pagina no puede leer nada.
  if (name === 'chromium') {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    try {
      for (const perm of ['local-network-access', 'loopback-network']) { try { await ctx.grantPermissions([perm]); break; } catch (e) { /* no lo conoce */ } }
      // La pagina se sirve desde aca mismo: lo que importa es el origen con el que le habla al programa.
      const other = 'https://otro-sitio.example';
      await page.route(other + '/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>otro</title>' }));
      await page.goto(other + '/');
      const r = await page.evaluate(probe, [port, token]);
      console.log('  chromium, desde ' + other + ' con el token correcto y el permiso dado\n        ' + JSON.stringify(r));
      check('otro sitio no puede leer aunque tenga el token', !!r.error, r);
    } catch (e) { console.log('  (no se pudo abrir otro sitio: ' + String(e.message).split('\n')[0] + ')'); }
    await ctx.close();
  }
  await browser.close();
}
const chromeOk = Object.keys(report).find((k) => k.startsWith('chromium') && report[k].conToken && report[k].conToken.status === 200);
check('Chromium llega al programa desde https://sharpmd.app', !!chromeOk, report);

// ---------- 1b. El panel propio, que es la salida para Safari ----------
console.log('\n  El panel propio (http://127.0.0.1:' + port + ')\n');
for (const name of ['chromium', 'firefox', 'webkit']) {
  let b;
  try { b = await pw[name].launch({ headless: true }); } catch (e) { continue; }
  try {
    const page = await b.newPage();
    await page.goto('http://127.0.0.1:' + port + '/#t=' + token);
    await page.waitForSelector('.row', { timeout: 20000 });
    const hashGone = !(await page.evaluate(() => location.href)).includes(token);
    await page.click('#tabs button[data-id=agents]');
    await page.waitForFunction(() => /MB|No agent sessions|No hay sesiones/.test(document.getElementById('main').innerText), null, { timeout: 20000 });
    check(name + ': el panel lista y saca el token de la barra', hashGone);
  } catch (e) { check(name + ': el panel lista', false, String(e.message).split('\n')[0]); }
  await b.close();
}

await app.close();
fs.rmSync(HOME, { recursive: true, force: true });
console.log(failed ? '\n  ' + failed + ' fallas\n' : '\n  todo bien\n');
process.exit(failed ? 1 : 0);
