// Carpetas con contraseña, en la app: proteger una carpeta (con la clave de respaldo como paso obligado), abrirla,
// trabajar adentro como en cualquier carpeta, sin conexión, desbloquear para la IA, recordar en el dispositivo,
// entrar con la clave de respaldo, quitar la protección, y que ni la contraseña ni la llave viajen al servidor
// salvo al desbloquear para la IA. Todo contra un servidor local.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.LMD = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', 'seal.js'), 'utf8'));
const Z = globalThis.LMD.seal;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 27000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const startServer = async () => {
  const s = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; s.stdout.on('data', (d) => { log += d; }); s.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  return s;
};
const stopServer = async () => { const gone = new Promise((r) => server.once('exit', r)); server.kill(); await gone; };
let server = await startServer();
const api = (method, p, body, s, more) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, more || {}), body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
const enc = encodeURIComponent;
const mail = 'ana@ejemplo.test';
const session = (await api('POST', '/auth/verify', { email: mail, code: (await api('POST', '/auth/start', { email: mail })).dev_code })).session;
await api('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
const put = (p, text) => api('PUT', '/notes/' + enc(p), { text }, session);
const raw = async (p) => (await api('GET', '/notes/' + enc(p), undefined, session)).text;
const list = () => api('GET', '/notes', undefined, session);
const vaults = () => api('GET', '/vaults', undefined, session);
await put('diario/lunes.md', '# Lunes\n\nPrimera versión, mandarina-0.\n');
await put('diario/lunes.md', '# Lunes\n\nSecreto de la nota, mandarina.\n');
await put('diario/sub/carta.md', '# Carta\n\nmandarina-carta\n');
await put('trabajo/plan.md', '# Plan\n\nNada secreto.\n');
await put('suelta.md', '# Suelta\n\nmandarina-suelta\n');
const token = (await api('POST', '/tokens', { name: 'ia' }, session)).token;
const mcp = async (name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token); return { text: r.result.content[0].text, err: !!r.result.isError }; };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
// Todo lo que sale hacia el servidor queda anotado: de ahí se mira que la contraseña y la llave no viajen.
const sent = []; ctx.on('request', (r) => { if (r.url().startsWith(base)) sent.push({ method: r.method(), url: r.url().slice(base.length), body: r.postData() || '' }); });
let app = await ctx.newPage(); const errors = []; const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); return p.addInitScript(autoDialogs); };
await watch(app);
const home = `chrome-extension://${id}/src/app.html`;
const o = {};
const PASS = 'caballo correcto batería grapa'; const PASS2 = 'otra contraseña bien larga 9'; const PASS3 = 'la tercera, por la clave de respaldo';
const CLOUD = '.lmd-xroot[data-root=cloud]'; const CARD = '.lmd-vault-card';
const cloudUrl = (p) => home + '?f=' + enc('cloud/' + p.split('/').map(enc).join('/'));
const said = async (re) => { await app.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 15000 }); return app.textContent('.lmd-foot .lmd-status'); };
const opened = async () => { await app.waitForSelector('.markdown-body h1'); await app.waitForSelector(CLOUD + ' .lmd-node'); };
const folder = (name) => app.locator(CLOUD + ' .lmd-node-dir', { hasText: name }).first();
const menu = async (name, act) => { await app.locator(CLOUD + ' .lmd-node', { hasText: name }).first().click({ button: 'right' }); await app.waitForSelector('.lmd-menu [data-f=' + act + ']'); await app.click('.lmd-menu [data-f=' + act + ']'); };
const menuItems = async (name) => { await app.locator(CLOUD + ' .lmd-node', { hasText: name }).first().click({ button: 'right' }); await app.waitForSelector('.lmd-menu [data-f]'); const items = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f)); await app.keyboard.press('Escape'); return items; };
const closed = () => app.waitForSelector(CARD, { state: 'detached', timeout: 30000 });
const fail = async () => { await app.waitForSelector(CARD + ' .lmd-dlg-err:not([hidden])'); return app.textContent(CARD + ' .lmd-dlg-err'); };
const answer = (v) => app.evaluate((x) => { window.__answer = x; }, v);
const shut = (name) => app.evaluate(([sel, n]) => { const d = [...document.querySelectorAll(sel + ' .lmd-node-vault')].find((x) => x.textContent.trim() === n); return d ? d.classList.contains('lmd-vault-shut') : null; }, [CLOUD, name]);
const kids = (name) => app.evaluate(([sel, n]) => { const d = [...document.querySelectorAll(sel + ' .lmd-node-dir')].find((x) => x.textContent.trim() === n); let k = d && d.nextElementSibling; while (k && !k.classList.contains('lmd-node-kids')) k = k.nextElementSibling; return k && !k.hidden ? [...k.querySelectorAll(':scope > .lmd-node')].map((x) => x.textContent.trim()) : null; }, [CLOUD, name]);
const until = async (fn, ms) => { for (let i = 0; i < (ms || 8000) / 150; i++) { const v = await fn(); if (v) return v; await app.waitForTimeout(150); } return fn(); };
const savedToCloud = () => app.waitForFunction(() => /Guardado en la nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 30000 });
const write = async (text) => { await app.keyboard.type(text); await app.click('.lmd-foot .lmd-status', { force: true }); };
let K = null; let key = null; // la llave de datos, sacada de la clave de respaldo que mostró la app
const plainOf = async (p) => Z.open(key, p, await raw(p));

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(([url, s, m]) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: s, email: m, at: url } }, resolve)), [base, session, mail]);
  await app.goto(cloudUrl('trabajo/plan.md')); await opened();

  // ---------- Proteger ----------
  o.menuComun = await menuItems('diario');
  await menu('diario', 'v-protect'); await app.waitForSelector(CARD);
  o.dialogo = await app.evaluate((sel) => { const c = document.querySelector(sel); return { title: c.querySelector('h3').textContent, warn: c.querySelector('.lmd-vault-warn').textContent, notes: c.querySelector('.lmd-vault-notes').textContent, focus: document.activeElement.dataset.v }; }, CARD);
  await app.fill('[data-v=p1]', 'corta'); o.fuerza = [await app.textContent('[data-v=meter] span')];
  await app.click('[data-v=ok]'); o.cortaAvisa = await fail();
  await app.fill('[data-v=p1]', PASS); o.fuerza.push(await app.textContent('[data-v=meter] span'));
  await app.fill('[data-v=p2]', PASS + 'x'); await app.click('[data-v=ok]'); o.distintasAvisa = await fail();
  await app.fill('[data-v=p2]', PASS); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-vault-key');
  o.sinCrearTodavia = (await vaults()).length;
  const shown = await app.evaluate(() => [...document.querySelectorAll('.lmd-vault-key span')].map((s) => s.textContent).join('-'));
  o.respaldo = [/^([A-HJ-NP-Z2-9]{4}-){12}[A-HJ-NP-Z2-9]{4}$/.test(shown), await app.evaluate(() => document.querySelector('[data-v=ok]').disabled)];
  const [download] = await Promise.all([app.waitForEvent('download'), app.click('[data-v=down]')]);
  const file = path.join(profile, 'respaldo.txt'); await download.saveAs(file);
  const saved = fs.readFileSync(file, 'utf8');
  o.respaldo.push(download.suggestedFilename(), saved.includes(shown) && saved.includes('diario/') && saved.includes(mail), await app.evaluate(() => document.querySelector('[data-v=ok]').disabled));
  K = Z.backupKey(shown); key = (await Z.derive(K)).key;
  await app.click('[data-v=ok]'); await closed();
  o.protegida = [await said('protegida')];
  const after = await list(); const V = (await vaults())[0];
  o.protegida.push(after.filter((n) => n.path.startsWith('diario/')).every((n) => n.v === 1), (await raw('diario/lunes.md')).startsWith('vault1:'), await plainOf('diario/lunes.md'), await plainOf('diario/sub/carta.md'),
    (await api('GET', '/versions/' + enc('diario/lunes.md'), undefined, session)).length, V.folder, V.iters, V.check === (await Z.derive(K)).check, (await raw('trabajo/plan.md')).startsWith('# Plan'));
  await app.waitForSelector(CLOUD + ' .lmd-node-vault');
  o.candado = [await shut('diario'), await app.evaluate((sel) => document.querySelector(sel + ' .lmd-node-vault .lmd-node-lock').title, CLOUD)];
  o.menuProtegida = await menuItems('diario'); o.menuAdentro = await (async () => { await folder('diario').click(); await app.waitForSelector(CLOUD + ' .lmd-node-kids .lmd-node:has-text("sub")'); return menuItems('sub'); })();

  // ---------- Adentro, como en cualquier carpeta ----------
  await app.locator(CLOUD + ' .lmd-node-kids a.lmd-node', { hasText: 'lunes.md' }).click(); await app.waitForSelector('.markdown-body h1:has-text("Lunes")');
  o.abre = [await app.textContent('.markdown-body p'), await app.textContent('.lmd-savestate')];
  await app.click('[data-act=mode-edit]'); await app.evaluate(() => document.querySelector('.markdown-body .lmd-add').click()); await app.waitForSelector('.lmd-draft');
  await write('Escrito con la carpeta protegida.'); await savedToCloud();
  const copy = await app.evaluate(([who]) => LMD.store.cloudGet(who, 'diario/lunes.md'), [mail]);
  const idb = await app.evaluate(() => LMD.store.handlesAll().then((all) => JSON.stringify(all.map((r) => Object.assign({}, r, { cryptoKey: undefined })))));
  o.guarda = [(await raw('diario/lunes.md')).startsWith('vault1:'), /Escrito con la carpeta protegida\./.test(await plainOf('diario/lunes.md')), copy.sealed === true && copy.text.startsWith('vault1:') && copy.base.startsWith('vault1:'), /mandarina|Escrito con la carpeta/.test(idb)];
  // Pasar un bloque a una nota nueva (blocks.js): nace en la misma carpeta protegida, cifrada.
  {
    await app.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await app.waitForTimeout(500);
    const at = await app.evaluate(() => { const art = document.querySelector('.lmd-article'); const p = [...art.children].find((n) => /Escrito con la carpeta/.test(n.textContent)); const r = p.getBoundingClientRect(); return { x: art.getBoundingClientRect().left + 22, y: r.top + r.height / 2 }; });
    await app.mouse.click(at.x, at.y); await app.click('.lmd-bsel-bar [data-bs=more]'); await app.click('.lmd-bsel-menu [data-bs=doc-copy]');
    const made = 'diario/Escrito con la carpeta protegida.md';
    await until(async () => (await list()).some((n) => n.path === made));
    o.bloques = [String(await raw(made)).startsWith('vault1:'), await plainOf(made)];
    await api('DELETE', '/notes/' + enc(made) + '?forever=1', undefined, session); await app.keyboard.press('Escape');
  }
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=share]');
  o.menuNube = await app.evaluate(() => ({ share: document.querySelector('.lmd-menu [data-s=share]').classList.contains('lmd-locked'), note: (document.querySelector('.lmd-menu-note') || {}).textContent || '', comments: !!document.querySelector('.lmd-menu [data-s=comments].lmd-locked') }));
  await app.click('.lmd-menu [data-s=share]'); o.menuNube.avisa = await said('carpeta protegida'); o.menuNube.sinVentana = await app.locator('.lmd-share').count();
  // Historial: las versiones están cifradas y la app las muestra en claro.
  await app.click('.lmd-sync'); await app.click('.lmd-menu [data-s=history]'); await app.waitForSelector('.lmd-hist');
  o.historial = [await app.locator('.lmd-hist [data-v]').count()];
  if (o.historial[0]) { await app.click('.lmd-hist [data-v]'); await app.waitForFunction(() => document.querySelector('.lmd-hist pre').textContent.length > 0); o.historial.push(await app.textContent('.lmd-hist pre')); }
  await app.click('.lmd-hist [data-h=no]');
  // Crear, renombrar, mover hacia adentro y hacia afuera, eliminar.
  await answer('nueva.md'); await Promise.all([app.waitForNavigation(), menu('lunes.md', 'new')]); await opened();
  o.crea = [/diario%2Fnueva\.md/.test(app.url()), (await raw('diario/nueva.md')).startsWith('vault1:'), await plainOf('diario/nueva.md')];
  await answer('diario/renombrada.md'); await Promise.all([app.waitForNavigation(), menu('nueva.md', 'ren')]); await opened();
  o.renombra = [/diario%2Frenombrada\.md/.test(app.url()), await plainOf('diario/renombrada.md'), (await list()).some((n) => n.path === 'diario/nueva.md')];
  await answer('afuera.md'); await Promise.all([app.waitForNavigation(), menu('renombrada.md', 'ren')]); await opened();
  o.sale = [/f=cloud%2Fafuera\.md/.test(app.url()), await raw('afuera.md'), await app.textContent('.markdown-body h1')];
  await answer('diario/suelta.md'); await menu('suelta.md', 'ren');
  await until(async () => (await list()).some((n) => n.path === 'diario/suelta.md'));
  o.entra = [(await raw('diario/suelta.md')).startsWith('vault1:'), await plainOf('diario/suelta.md'), (await list()).some((n) => n.path === 'suelta.md')];
  await app.waitForSelector(CLOUD + ' .lmd-node-kids a.lmd-node:has-text("suelta.md")');
  await menu('suelta.md', 'del');
  o.borra = await until(async () => !(await list()).some((n) => n.path === 'diario/suelta.md'));
  await answer('bitacora'); await menu('diario', 'ren'); o.noSeRenombra = [await said('no se renombra'), (await vaults())[0].folder];

  // ---------- Bloqueada en una pestaña nueva ----------
  await app.goto(cloudUrl('trabajo/plan.md')); await opened(); await app.waitForSelector(CLOUD + ' .lmd-vault-shut');
  o.bloqueada = [await shut('diario'), await kids('diario'), await app.evaluate((sel) => [...document.querySelectorAll(sel + ' .lmd-node')].some((n) => /lunes/.test(n.textContent)), CLOUD)];
  await folder('diario').click(); await app.waitForSelector(CARD + ' [data-v=p]');
  o.pide = [await app.textContent(CARD + ' h3'), await app.evaluate(() => document.activeElement.type)];
  await app.fill('[data-v=p]', 'no es esta'); await app.click('[data-v=ok]'); o.pide.push(await fail(), await shut('diario'));
  await app.fill('[data-v=p]', PASS); await app.keyboard.press('Enter'); await closed();
  await app.waitForSelector(CLOUD + ' .lmd-node-kids a.lmd-node:has-text("lunes.md")');
  o.desbloquea = [await shut('diario'), await kids('diario')];
  // Entrar por la dirección de una nota con la carpeta bloqueada: pide la contraseña y, si se cancela, lo dice.
  await app.goto(cloudUrl('diario/lunes.md')); await app.waitForSelector(CARD + ' [data-v=p]');
  await app.click('[data-v=no]'); await app.waitForSelector('.lmd-home-msg:not([hidden])'); o.porDireccion = [await app.textContent('.lmd-home-msg')];
  await app.goto(cloudUrl('diario/lunes.md')); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]');
  await app.waitForSelector('.markdown-body h1:has-text("Lunes")'); o.porDireccion.push(await app.textContent('.markdown-body h1'));

  // ---------- Sin conexión ----------
  await savedToCloud();
  await stopServer();
  await app.click('[data-act=mode-edit]'); await app.evaluate(() => document.querySelector('.markdown-body .lmd-add').click()); await app.waitForSelector('.lmd-draft');
  await write('Escrito sin conexión.');
  const queued = await until(async () => { const c = await app.evaluate(([who]) => LMD.store.cloudGet(who, 'diario/lunes.md'), [mail]); return c && c.pending ? c : null; });
  o.cola = [!!queued && queued.sealed === true && queued.text.startsWith('vault1:') && !/Escrito sin/.test(JSON.stringify(queued)), queued ? /Escrito sin conexión\./.test(await Z.open(key, 'diario/lunes.md', queued.text)) : false, await app.textContent('.lmd-savestate')];
  server = await startServer();
  await savedToCloud();
  o.subio = /Escrito sin conexión\./.test(await plainOf('diario/lunes.md'));
  // Con la nota cerrada: lo que quedó pendiente se junta, ya descifrado, con lo que cambió en el servidor.
  const was = await plainOf('diario/sub/carta.md');
  await app.goto(cloudUrl('trabajo/plan.md')); await opened();
  await folder('diario').click(); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await closed();
  await put('diario/sub/carta.md', await Z.seal(key, 'diario/sub/carta.md', was.replace('# Carta', '# Carta cambiada')));
  await app.evaluate(([p, mine, basis]) => LMD.cloud.stash(p, mine, basis), ['diario/sub/carta.md', was + '\nAgregado sin conexión.\n', was]);
  await app.evaluate(() => LMD.cloud.flush());
  o.mezcla = await until(async () => { await app.evaluate(() => LMD.cloud.flush()); const t = await plainOf('diario/sub/carta.md'); return /Carta cambiada/.test(t) && /Agregado sin conexión\./.test(t) ? t : ''; });

  // ---------- Desbloquear para la IA ----------
  o.iaBloqueada = (await mcp('read_note', { path: 'diario/lunes.md' })).err;
  const before = sent.length;
  await menu('diario', 'v-ai'); await app.waitForSelector(CARD + ' [data-v=time]');
  o.iaDialogo = await app.evaluate((sel) => ({ title: document.querySelector(sel + ' h3').textContent, text: [...document.querySelectorAll(sel + ' .lmd-vault-body > p')].map((p) => p.textContent).join(' | '), times: [...document.querySelectorAll(sel + ' [data-min]')].map((b) => b.dataset.min + ':' + b.textContent).join(), on: document.querySelector(sel + ' [data-min].lmd-on').dataset.min }), CARD);
  await app.click('[data-min="15"]'); await app.fill('[data-v=p]', 'equivocada'); await app.click('[data-v=ok]'); o.iaMala = [await fail(), (await vaults())[0].ai];
  await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await closed();
  await app.waitForSelector(CLOUD + ' .lmd-vault-line');
  const open = (await vaults())[0];
  o.iaAbierta = [await app.textContent(CLOUD + ' .lmd-vault-state'), await app.textContent(CLOUD + ' .lmd-vault-line [data-vault-ailock]'), open.ai && Math.round((open.ai.until - Date.now()) / 60000), (await mcp('read_note', { path: 'diario/lunes.md' })).text.split('\n')[0]];
  const unlocks = sent.slice(before).filter((r) => /\/vaults\/\d+\/unlock$/.test(r.url));
  o.iaPedido = [unlocks.length, unlocks.every((r) => !r.body.includes(PASS)), unlocks.some((r) => JSON.parse(r.body).key === Z.b64(K) && JSON.parse(r.body).minutes === 15)];
  await mcp('append_note', { path: 'diario/lunes.md', text: 'Agregado por la IA.' });
  await app.goto(cloudUrl('diario/lunes.md')); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await app.waitForSelector('.markdown-body h1:has-text("Lunes")');
  o.iaEscribe = await app.evaluate(() => /Agregado por la IA\./.test(document.querySelector('.markdown-body').textContent));
  await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=ai]'); await app.waitForSelector('.lmd-vault-list li');
  o.ajustes = [await app.textContent('.lmd-vault-list li span'), await app.textContent('.lmd-vault-list li button'), await app.textContent('.lmd-vault-tokens')];
  await app.click('.lmd-vault-list [data-vault-ailock]');
  await app.waitForFunction(() => /Bloqueada para la IA/.test((document.querySelector('.lmd-vault-list li span') || {}).textContent || ''), null, { timeout: 10000 });
  o.ajustes.push(await app.textContent('.lmd-vault-list li span'), await app.textContent('.lmd-vault-list li button'), (await vaults())[0].ai, (await mcp('read_note', { path: 'diario/lunes.md' })).err, await app.locator(CLOUD + ' .lmd-vault-line').count());
  await app.click('[data-act=close-panel]'); await app.waitForTimeout(200);

  // ---------- Bloquear, recordar en este dispositivo, olvidar ----------
  await menu('diario', 'v-lock'); await app.waitForSelector(CLOUD + ' .lmd-vault-shut'); await app.waitForSelector('.lmd-home:not([hidden])');
  o.bloquear = [await shut('diario'), await app.title(), await app.evaluate(() => !document.querySelector('.lmd-home').hidden)];
  await folder('diario').click(); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.check('[data-v=keep]'); await app.click('[data-v=ok]'); await closed();
  await app.goto(cloudUrl('diario/lunes.md')); await app.waitForSelector('.markdown-body h1:has-text("Lunes")'); await app.waitForSelector(CLOUD + ' .lmd-node-vault');
  o.recuerda = [await app.locator(CARD).count(), await shut('diario'), await app.evaluate(([who, check]) => LMD.store.vkeyGet(who, check).then((k) => k && [k.type, k.extractable, k.algorithm.name, k.algorithm.length].join()), [mail, V.check]), (await menuItems('diario')).includes('v-drop')];
  await menu('diario', 'v-drop'); await said('ya no recuerda');
  o.olvida = [await app.evaluate(([who, check]) => LMD.store.vkeyGet(who, check), [mail, V.check]), await shut('diario')];
  await app.goto(cloudUrl('trabajo/plan.md')); await opened(); await app.waitForSelector(CLOUD + ' .lmd-vault-shut'); o.olvida.push(await shut('diario'));

  // ---------- Contraseña olvidada: la clave de respaldo ----------
  await folder('diario').click(); await app.waitForSelector(CARD + ' [data-v=forgot]'); await app.click('[data-v=forgot]'); await app.waitForSelector(CARD + ' [data-v=bk]');
  await app.fill('[data-v=bk]', 'esto no es una clave'); await app.fill('[data-v=p1]', PASS3); await app.fill('[data-v=p2]', PASS3); await app.click('[data-v=ok]'); o.respaldoMalo = [await fail()];
  await app.fill('[data-v=bk]', Z.backupText(Z.newKey())); await app.click('[data-v=ok]'); o.respaldoMalo.push(await fail());
  await app.fill('[data-v=bk]', shown.toLowerCase().replace(/-/g, ' ')); await app.click('[data-v=ok]'); await closed();
  o.respaldoEntra = [await said('Contraseña cambiada'), await until(() => shut('diario').then((s) => s === false))];
  await menu('diario', 'v-lock'); await app.waitForSelector(CLOUD + ' .lmd-vault-shut'); await said('Carpeta bloqueada$');
  await folder('diario').click(); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); o.respaldoEntra.push(await fail());
  await app.fill('[data-v=p]', PASS3); await app.click('[data-v=ok]'); await closed(); o.respaldoEntra.push(await until(() => shut('diario').then((s) => s === false)));
  // Cambiar la contraseña desde el menú.
  await menu('diario', 'v-pass'); await app.waitForSelector(CARD + ' [data-v=p0]');
  await app.fill('[data-v=p0]', PASS); await app.fill('[data-v=p1]', PASS2); await app.fill('[data-v=p2]', PASS2); await app.click('[data-v=ok]'); o.cambia = [await fail()];
  await app.fill('[data-v=p0]', PASS3); await app.click('[data-v=ok]'); await closed(); o.cambia.push(await said('Contraseña cambiada'));
  let oldFails = false; try { await Z.unwrap((await vaults())[0], PASS3); } catch (e) { oldFails = e.code === 'bad_password'; }
  o.cambia.push(oldFails, Buffer.from(await Z.unwrap((await vaults())[0], PASS2)).equals(Buffer.from(K)), await plainOf('diario/lunes.md').then((t) => /mandarina/.test(t)));

  // ---------- Teléfono: entra y se maneja con el dedo ----------
  const phone = await ctx.newPage(); await watch(phone); await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(cloudUrl('trabajo/plan.md')); await phone.waitForSelector('.markdown-body h1');
  await phone.click('[data-act=sidebar]'); await phone.waitForSelector(CLOUD + ' .lmd-vault-shut'); await phone.waitForTimeout(350);
  await phone.locator(CLOUD + ' .lmd-node-dir', { hasText: 'diario' }).click(); await phone.waitForSelector(CARD + ' [data-v=p]');
  const fits = () => phone.evaluate((sel) => { const c = document.querySelector(sel).getBoundingClientRect(); const b = [...document.querySelectorAll(sel + ' .lmd-ask-actions button')].map((x) => x.getBoundingClientRect()); return { inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, noScroll: document.documentElement.scrollWidth <= innerWidth, tall: b.every((r) => r.height >= 40 && r.bottom <= innerHeight) }; }, CARD);
  o.telefono = [await fits()];
  await phone.fill('[data-v=p]', PASS2); await phone.click('[data-v=ok]'); await phone.waitForSelector(CARD, { state: 'detached', timeout: 30000 });
  await phone.waitForSelector(CLOUD + ' .lmd-node-kids a.lmd-node:has-text("lunes.md")');
  await phone.locator(CLOUD + ' .lmd-node-dir', { hasText: 'diario' }).click({ button: 'right' }); await phone.click('.lmd-menu [data-f=v-ai]'); await phone.waitForSelector(CARD + ' [data-v=time]');
  o.telefono.push(await fits(), await phone.evaluate(() => { const s = document.querySelector('[data-v=time]').getBoundingClientRect(); return [...document.querySelectorAll('[data-min]')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= s.left && r.right <= s.right && r.height >= 36; }); }));
  await phone.click('[data-min="0"]'); await phone.fill('[data-v=p]', PASS2); await phone.click('[data-v=ok]'); await phone.waitForSelector(CARD, { state: 'detached', timeout: 30000 });
  await phone.click('[data-act=sidebar]').catch(() => {}); await phone.waitForSelector(CLOUD + ' .lmd-vault-line');
  o.telefono.push(await phone.textContent(CLOUD + ' .lmd-vault-state'), await phone.evaluate((sel) => { const b = document.querySelector(sel + ' [data-vault-ailock]').getBoundingClientRect(); return b.height >= 32 && b.right <= innerWidth; }, CLOUD));
  // La otra pestaña se entera sola: tiene una nota abierta y le llega el aviso.
  await app.bringToFront(); await app.waitForSelector(CLOUD + ' .lmd-vault-line', { timeout: 15000 }); o.aviso = await app.textContent(CLOUD + ' .lmd-vault-state');
  await phone.bringToFront(); await phone.click(CLOUD + ' [data-vault-ailock]'); await phone.waitForSelector(CLOUD + ' .lmd-vault-line', { state: 'detached', timeout: 10000 });
  o.telefono.push((await vaults())[0].ai);
  await phone.close(); await app.bringToFront();

  // ---------- Quitar la protección ----------
  await menu('diario', 'v-off'); await app.waitForSelector(CARD + ' [data-v=p]');
  o.quitar = [await app.evaluate((sel) => [...document.querySelectorAll(sel + ' .lmd-vault-body > p')].map((p) => p.textContent).join(' | '), CARD), await app.evaluate(() => document.querySelector('[data-v=ok]').classList.contains('lmd-btn-danger'))];
  await app.fill('[data-v=p]', 'nada que ver'); await app.click('[data-v=ok]'); o.quitar.push(await fail(), (await vaults())[0].state);
  await app.fill('[data-v=p]', PASS2); await app.click('[data-v=ok]'); await closed();
  o.quitar.push(await said('ya no está protegida'), (await vaults()).length, (await list()).some((n) => n.v), await raw('diario/lunes.md').then((t) => /^# Lunes/.test(t) && /mandarina/.test(t)), await app.locator(CLOUD + ' .lmd-node-vault').count(), (await mcp('read_note', { path: 'diario/lunes.md' })).err);

  // ---------- Si se corta al proteger: lo que quedó en claro se cifra al desbloquear ----------
  // Se arma el caso desde afuera: la carpeta ya figura protegida en el servidor y sus notas siguen en claro.
  await app.goto(cloudUrl('afuera.md')); await opened();
  const K9 = Z.newKey(); const d9 = await Z.derive(K9);
  await api('POST', '/vaults', Object.assign({ folder: 'trabajo', check: d9.check }, await Z.wrap(K9, PASS)), session);
  o.reanuda = [(await list()).filter((n) => n.path.startsWith('trabajo/')).some((n) => n.v), (await mcp('read_note', { path: 'trabajo/plan.md' })).err];
  await app.goto(cloudUrl('afuera.md')); await opened(); await app.waitForSelector(CLOUD + ' .lmd-vault-shut');
  await folder('trabajo').click(); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await closed();
  o.reanuda.push(await until(async () => (await list()).filter((n) => n.path.startsWith('trabajo/')).every((n) => n.v === 1)), await Z.open(d9.key, 'trabajo/plan.md', await raw('trabajo/plan.md')));

  // ---------- Papelera: una nota protegida va y vuelve cifrada ----------
  const bin = () => api('GET', '/trash', undefined, session);
  const seal9 = (p, text) => Z.seal(d9.key, p, text); const open9 = async (p) => Z.open(d9.key, p, await raw(p));
  await api('DELETE', '/trash', undefined, session);
  await app.waitForSelector(CLOUD + ' .lmd-node-kids a.lmd-node:has-text("plan.md")');
  await menu('plan.md', 'del');
  await until(async () => !(await list()).some((n) => n.path === 'trabajo/plan.md'));
  const t1 = await bin();
  o.papeleraCofre = [t1.length === 1 && t1[0].protected === true && t1[0].path === 'trabajo/plan.md'];
  // Con el nombre ocupado vuelve con otro nombre: la app la descifra con su ruta de antes y la cifra para la nueva.
  await api('PUT', '/notes/' + enc('trabajo/plan.md'), { text: await seal9('trabajo/plan.md', 'la nueva') }, session);
  await app.click(CLOUD + ' > .lmd-trash-link'); await app.waitForSelector('.lmd-trash li');
  o.papeleraCofre.push(await app.locator('.lmd-trash li .lmd-trash-name svg').count());
  await app.click('.lmd-trash li [data-tr=back]');
  await until(async () => (await list()).some((n) => n.path === 'trabajo/plan (2).md'));
  o.papeleraCofre.push((await raw('trabajo/plan (2).md')).startsWith('vault1:'), await open9('trabajo/plan (2).md'), await open9('trabajo/plan.md'), (await bin()).length);
  await app.click('.lmd-trash [data-tr=no]');
  // Con la carpeta bloqueada, restaurar con otro nombre pide la contraseña.
  await api('DELETE', '/notes/' + enc('trabajo/plan (2).md'), undefined, session);
  await api('PUT', '/notes/' + enc('trabajo/plan (2).md'), { text: await seal9('trabajo/plan (2).md', 'otra más') }, session);
  await menu('trabajo', 'v-lock'); await app.waitForSelector(CLOUD + ' .lmd-vault-shut'); await said('Carpeta bloqueada$');
  await app.click(CLOUD + ' > .lmd-trash-link'); await app.waitForSelector('.lmd-trash li'); await app.click('.lmd-trash li [data-tr=back]');
  await app.waitForSelector(CARD + ' [data-v=p]'); await app.click(CARD + ' [data-v=no]');
  await app.waitForSelector('.lmd-trash .lmd-dlg-err:not([hidden])');
  o.papeleraBloqueada = [await app.textContent('.lmd-trash .lmd-dlg-err'), (await bin()).length];
  await app.click('.lmd-trash li [data-tr=back]'); await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click(CARD + ' [data-v=ok]'); await closed();
  await until(async () => (await list()).some((n) => n.path === 'trabajo/plan (2) (2).md'));
  o.papeleraBloqueada.push(await open9('trabajo/plan (2) (2).md'), (await bin()).length);
  await app.click('.lmd-trash [data-tr=no]');

  // ---------- Contraseña perdida: eliminar la carpeta y sus notas, sin desbloquearla ----------
  await api('DELETE', '/notes/' + enc('trabajo/plan.md'), undefined, session);
  await menu('trabajo', 'v-lock'); await app.waitForSelector(CLOUD + ' .lmd-vault-shut'); await said('Carpeta bloqueada$');
  o.sinClave = [(await menuItems('trabajo')).includes('v-destroy'), (await bin()).some((x) => x.path.startsWith('trabajo/'))];
  // Se llega también desde "¿Olvidaste la contraseña?", para quien tampoco tiene la clave de respaldo.
  await folder('trabajo').click(); await app.waitForSelector(CARD + ' [data-v=forgot]'); await app.click('[data-v=forgot]'); await app.waitForSelector(CARD + ' [data-v=lost]'); await app.click('[data-v=lost]');
  await app.waitForSelector(CARD + ' [data-v=name]');
  o.eliminarCofre = [await app.textContent(CARD + ' h3'), await app.textContent(CARD + ' .lmd-vault-warn'), await app.evaluate(() => document.querySelector('[data-v=ok]').classList.contains('lmd-btn-danger'))];
  await app.fill('[data-v=name]', 'Trabajo'); await app.click(CARD + ' [data-v=ok]'); o.eliminarCofre.push(await fail(), (await vaults()).length);
  await app.fill('[data-v=name]', 'trabajo'); await app.keyboard.press('Enter'); await closed();
  o.eliminarCofre.push(await said('Carpeta eliminada'), (await vaults()).length, (await list()).some((n) => n.path.startsWith('trabajo/')), (await bin()).some((x) => x.path.startsWith('trabajo/')), (await list()).some((n) => n.path === 'afuera.md'),
    await app.locator(CLOUD + ' .lmd-node-dir:has-text("trabajo")').count(), await app.evaluate((who) => LMD.store.cloudAll(who).then((all) => all.filter((c) => c.path.startsWith('trabajo/')).length), mail));

  // ---------- Lo que viajó ----------
  const all = sent.map((r) => r.url + ' ' + r.body).join('\n');
  const backupForms = [shown, shown.replace(/-/g, ''), Z.b64(K), Buffer.from(K).toString('hex'), Buffer.from(K).toString('base64url')];
  const withKey = sent.filter((r) => backupForms.some((f) => (r.url + ' ' + r.body).includes(f)));
  o.viajo = [[PASS, PASS2, PASS3].some((p) => all.includes(p) || all.includes(enc(p))), withKey.length > 0 && withKey.every((r) => /^\/vaults\/\d+\/unlock$/.test(r.url) && r.method === 'POST'), /mandarina|Escrito con la carpeta|Escrito sin conexión/.test(sent.filter((r) => /^\/notes\/diario|\/rename/.test(r.url) && r.method !== 'GET' && !/afuera/.test(r.url + r.body) && r.body.includes('vault1:')).map((r) => r.body).join('\n')),
    sent.filter((r) => r.method === 'PUT' && /^\/notes\/diario/.test(r.url)).length];
  o.nativos = await app.evaluate(() => window.__native);
} catch (e) { o.excepcion = String(e && e.stack || e).slice(0, 900); }

const J = (v) => JSON.stringify(v);
const checks = [
  ['una nota protegida eliminada queda cifrada en la papelera, y con el nombre ocupado vuelve con otro, cifrada para su ruta nueva', J(o.papeleraCofre) === J([true, 1, true, '# Plan\n\nNada secreto.\n', 'la nueva', 0]), o.papeleraCofre],
  ['con la carpeta bloqueada, restaurar con otro nombre pide la contraseña; sin ella no restaura', o.papeleraBloqueada && /Desbloqueá la carpeta/.test(o.papeleraBloqueada[0]) && J(o.papeleraBloqueada.slice(1)) === J([1, '# Plan\n\nNada secreto.\n', 0]), o.papeleraBloqueada],
  ['una carpeta bloqueada ofrece eliminarla con sus notas, sin pedir la contraseña', J(o.sinClave) === J([true, true]), o.sinClave],
  ['eliminar la carpeta pide escribir su nombre y avisa que no se recupera', o.eliminarCofre && /Eliminar "trabajo" y sus notas/.test(o.eliminarCofre[0]) && /No van a la papelera/.test(o.eliminarCofre[1]) && o.eliminarCofre[2] === true && /no es el nombre/.test(o.eliminarCofre[3]) && o.eliminarCofre[4] === 1, o.eliminarCofre],
  ['con el nombre escrito se van la carpeta, sus notas, lo suyo de la papelera y las copias locales; lo demás queda', o.eliminarCofre && /Carpeta eliminada/.test(o.eliminarCofre[5]) && J(o.eliminarCofre.slice(6)) === J([0, false, false, true, 0, 0]), o.eliminarCofre],
  ['una carpeta común de la nube ofrece protegerla con contraseña', (o.menuComun || []).includes('v-protect') && !(o.menuComun || []).includes('v-lock'), o.menuComun],
  ['el diálogo dice antes de crear que sin contraseña ni clave de respaldo no hay recuperación, y que los nombres no se cifran', o.dialogo && o.dialogo.title === 'Proteger "diario" con contraseña' && /no se pueden recuperar\. Tampoco desde SharpMD\./.test(o.dialogo.warn) && /nombres de las notas y de las carpetas no se cifran/.test(o.dialogo.notes) && /historial anterior de estas notas se elimina/.test(o.dialogo.notes) && o.dialogo.focus === 'p1' && !/[!¡—]/.test(o.dialogo.warn + o.dialogo.notes), o.dialogo],
  ['el indicador de fortaleza acompaña a la contraseña', J(o.fuerza) === J(['Al menos 8 caracteres', 'Fuerte']), o.fuerza],
  ['una contraseña corta o dos distintas se avisan ahí mismo', /al menos 8 caracteres/.test(o.cortaAvisa || '') && /no coinciden/.test(o.distintasAvisa || ''), [o.cortaAvisa, o.distintasAvisa]],
  ['la clave de respaldo es un paso obligado: sin descargarla o copiarla no se sigue, y hasta ahí no se creó nada', o.respaldo && o.respaldo[0] && o.respaldo[1] === true && o.sinCrearTodavia === 0 && /^sharpmd-clave-de-respaldo-diario\.txt$/.test(o.respaldo[2]) && o.respaldo[3] && o.respaldo[4] === false, [o.respaldo, o.sinCrearTodavia]],
  ['al confirmar, las notas que ya había quedan cifradas y su historial en claro se va', o.protegida && /protegida/.test(o.protegida[0]) && o.protegida[1] && o.protegida[2] && /Secreto de la nota, mandarina\./.test(o.protegida[3]) && /mandarina-carta/.test(o.protegida[4]) && o.protegida[5] === 0, o.protegida],
  ['el servidor guarda la carpeta con 600.000 vueltas y el valor de comprobación de esa llave, y no toca las demás carpetas', o.protegida && o.protegida[6] === 'diario' && o.protegida[7] === 600000 && o.protegida[8] === true && o.protegida[9] === true, o.protegida],
  ['la carpeta lleva un candado, abierto mientras está desbloqueada en la pestaña', o.candado && o.candado[0] === false && /desbloqueada/.test(o.candado[1]), o.candado],
  ['el menú de la carpeta protegida ofrece bloquear, abrir para la IA, cambiar la contraseña, quitar la protección y eliminarla; una de adentro, nada de eso', J((o.menuProtegida || []).filter((f) => /^v-/.test(f))) === J(['v-lock', 'v-ai', 'v-pass', 'v-off', 'v-destroy']) && !(o.menuAdentro || ['v-']).some((f) => /^v-/.test(f)), [o.menuProtegida, o.menuAdentro]],
  ['una nota protegida abre como cualquiera', o.abre && /Secreto de la nota, mandarina\./.test(o.abre[0]) && /Guardado en la nube/.test(o.abre[1]), o.abre],
  ['al guardar viaja cifrada, y la copia para usar sin conexión también queda cifrada', o.guarda && o.guarda[0] && o.guarda[1] && o.guarda[2] && o.guarda[3] === false, o.guarda],
  ['compartir y comentar para la IA explican en una línea por qué no están, con el camino a seguir', o.menuNube && o.menuNube.share && /Carpeta protegida/.test(o.menuNube.note) && /movela a otra carpeta/.test(o.menuNube.note) && o.menuNube.comments && /carpeta protegida/.test(o.menuNube.avisa) && o.menuNube.sinVentana === 0, o.menuNube],
  ['el historial de una nota protegida se lee en claro en la app', o.historial && o.historial[0] >= 1 && /mandarina/.test(o.historial[1] || ''), o.historial],
  ['pasar un bloque a una nota nueva la deja en la misma carpeta protegida, cifrada', o.bloques && o.bloques[0] === true && /Escrito con la carpeta protegida\./.test(o.bloques[1]), o.bloques],
  ['crear adentro: la nota nace cifrada', o.crea && o.crea[0] && o.crea[1] && /^# nueva/.test(o.crea[2]), o.crea],
  ['renombrar adentro: queda cifrada para su ruta nueva', o.renombra && o.renombra[0] && /^# nueva/.test(o.renombra[1]) && o.renombra[2] === false, o.renombra],
  ['sacarla de la carpeta la descifra', o.sale && o.sale[0] && /^# nueva/.test(o.sale[1]) && /nueva/.test(o.sale[2]), o.sale],
  ['meter una nota la cifra', o.entra && o.entra[0] && /mandarina-suelta/.test(o.entra[1]) && o.entra[2] === false, o.entra],
  ['eliminar adentro funciona igual', o.borra === true, o.borra],
  ['la carpeta protegida no se renombra, y se dice qué hacer', o.noSeRenombra && /Quitale la protección primero/.test(o.noSeRenombra[0]) && o.noSeRenombra[1] === 'diario', o.noSeRenombra],
  ['en otra pestaña queda bloqueada y no muestra lo que tiene adentro', J(o.bloqueada) === J([true, null, false]), o.bloqueada],
  ['al abrirla pide la contraseña una vez, y una equivocada se avisa', o.pide && o.pide[0] === 'Desbloquear "diario"' && o.pide[1] === 'password' && o.pide[2] === 'Esa contraseña no coincide.' && o.pide[3] === true, o.pide],
  ['con la correcta se despliega', o.desbloquea && o.desbloquea[0] === false && (o.desbloquea[1] || []).includes('lunes.md'), o.desbloquea],
  ['entrar por la dirección de una nota bloqueada pide la contraseña; al cancelar, lo dice', o.porDireccion && /está en una carpeta protegida\. Desbloqueala para abrirla\./.test(o.porDireccion[0]) && /^Lunes/.test(o.porDireccion[1]), o.porDireccion],
  ['sin conexión, lo escrito espera cifrado en la cola', o.cola && o.cola[0] && o.cola[1] && /Sin conexión/.test(o.cola[2]), o.cola],
  ['al volver la conexión sube solo, cifrado', o.subio === true],
  ['lo pendiente se mezcla en el navegador, sobre el texto descifrado', !!o.mezcla, o.mezcla],
  ['desbloquear para la IA explica qué significa y deja elegir la duración', o.iaDialogo && o.iaDialogo.title === 'Desbloquear "diario" para la IA' && /el servidor puede leer y escribir las notas de esta carpeta/.test(o.iaDialogo.text) && /solo en la memoria del servidor y se olvida al vencer/.test(o.iaDialogo.text) && o.iaDialogo.times === '15:15 minutos,60:1 hora,480:8 horas,0:Hasta que la bloquee' && o.iaDialogo.on === '60', o.iaDialogo],
  ['con una contraseña equivocada no se desbloquea para la IA', o.iaBloqueada === true && o.iaMala && /no coincide/.test(o.iaMala[0]) && o.iaMala[1] === null, [o.iaBloqueada, o.iaMala]],
  ['abierta para la IA: el explorador dice hasta cuándo y deja bloquearla, y la IA lee', o.iaAbierta && /^Abierta para la IA hasta las \d{1,2}:\d{2}/.test(o.iaAbierta[0]) && o.iaAbierta[1] === 'Bloquear ahora' && o.iaAbierta[2] >= 14 && o.iaAbierta[2] <= 15 && o.iaAbierta[3] === '# Lunes', o.iaAbierta],
  ['al desbloquear para la IA viaja la llave y nunca la contraseña', J(o.iaPedido) === J([1, true, true]), o.iaPedido],
  ['lo que escribe la IA con la carpeta abierta se ve en la app', o.iaEscribe === true],
  ['Ajustes → IA muestra el estado, "Bloquear ahora", y que las carpetas protegidas no entran en los tokens', o.ajustes && /diario\/.*Abierta para la IA hasta las/.test(o.ajustes[0]) && o.ajustes[1] === 'Bloquear ahora' && /no entran en ningún token, salvo mientras estén desbloqueadas/.test(o.ajustes[2]), o.ajustes],
  ['"Bloquear ahora" la cierra para la IA en el servidor y en la pantalla', o.ajustes && /Bloqueada para la IA/.test(o.ajustes[3]) && o.ajustes[4] === 'Desbloquear para la IA' && o.ajustes[5] === null && o.ajustes[6] === true && o.ajustes[7] === 0, o.ajustes],
  ['bloquear cierra la nota abierta de esa carpeta', J(o.bloquear) === J([true, 'SharpMD', true]), o.bloquear],
  ['"Recordar en este dispositivo" guarda una llave que no se puede exportar y abre sin pedir nada', o.recuerda && o.recuerda[0] === 0 && o.recuerda[1] === false && o.recuerda[2] === 'secret,false,AES-GCM,256' && o.recuerda[3] === true, o.recuerda],
  ['"Olvidar" la borra: en la próxima pestaña vuelve a pedir la contraseña', o.olvida && o.olvida[0] === null && o.olvida[1] === false && o.olvida[2] === true, o.olvida],
  ['la clave de respaldo mal escrita o de otra carpeta se rechaza', o.respaldoMalo && /no tiene la forma correcta/.test(o.respaldoMalo[0]) && /no es la de esta carpeta/.test(o.respaldoMalo[1]), o.respaldoMalo],
  ['con la clave de respaldo se entra y se pone una contraseña nueva; la vieja deja de servir', o.respaldoEntra && /Contraseña cambiada/.test(o.respaldoEntra[0]) && o.respaldoEntra[1] === true && /no coincide/.test(o.respaldoEntra[2]) && o.respaldoEntra[3] === true, o.respaldoEntra],
  ['cambiar la contraseña pide la actual y no toca las notas', o.cambia && /no coincide/.test(o.cambia[0]) && /Contraseña cambiada/.test(o.cambia[1]) && o.cambia[2] === true && o.cambia[3] === true && o.cambia[4] === true, o.cambia],
  ['en un teléfono las ventanas entran en la pantalla y los botones se tocan', o.telefono && [o.telefono[0], o.telefono[1]].every((f) => f.inside && f.noScroll && f.tall) && o.telefono[2] === true, o.telefono],
  ['en un teléfono se abre para la IA sin vencimiento y se bloquea desde el explorador', o.telefono && o.telefono[3] === 'Abierta para la IA hasta que la bloquees' && o.telefono[4] === true && o.telefono[5] === null, o.telefono],
  ['otra pestaña con una nota abierta se entera sola del cambio de estado', /Abierta para la IA/.test(o.aviso || ''), o.aviso],
  ['quitar la protección dice qué pasa y pide la contraseña', o.quitar && /el servidor las va a poder leer/.test(o.quitar[0]) && /historial cifrado de estas notas se elimina/.test(o.quitar[0]) && o.quitar[1] === true && /no coincide/.test(o.quitar[2]) && o.quitar[3] === 'on', o.quitar],
  ['al quitarla, todo queda descifrado y la carpeta vuelve a ser común', o.quitar && /ya no está protegida/.test(o.quitar[4]) && o.quitar[5] === 0 && o.quitar[6] === false && o.quitar[7] === true && o.quitar[8] === 0 && o.quitar[9] === false, o.quitar],
  ['si se cortó al proteger, las notas que quedaron en claro no las lee la IA y se cifran al desbloquear la carpeta', o.reanuda && o.reanuda[0] === false && o.reanuda[1] === true && o.reanuda[2] === true && /Nada secreto/.test(o.reanuda[3]), o.reanuda],
  ['la contraseña nunca viaja al servidor', o.viajo && o.viajo[0] === false, o.viajo],
  ['la llave solo viaja al desbloquear para la IA', o.viajo && o.viajo[1] === true, o.viajo],
  ['lo que se guarda en la carpeta protegida viaja cifrado', o.viajo && o.viajo[2] === false && o.viajo[3] > 3, o.viajo],
  ['sin errores, y sin cuadros nativos del navegador', errors.length === 0 && !o.excepcion && J(o.nativos) === '[]', [errors, o.excepcion, o.nativos]],
];
console.log('Carpetas con contraseña (app)');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
