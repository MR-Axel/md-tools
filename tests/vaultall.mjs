// Toda la nube protegida con una contraseña, en la app, y el aviso de la primera nota en la nube: sale una sola vez
// por cuenta (queda anotado en el servidor, así que no vuelve en otro dispositivo), "Ahora no" lo cierra para
// siempre, y "Proteger con contraseña" lleva a proteger toda la nube: lo que había se cifra acá, lo nuevo nace
// cifrado, y compartir, publicar y la IA quedan afuera salvo que se desbloquee. Todo contra un servidor local.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.LMD = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', 'seal.js'), 'utf8'));
const Z = globalThis.LMD.seal;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 27900 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base, PAGES_URL: 'http://pages.localhost:' + PORT, AUTH_PER_IP: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 80 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const ask = async (method, p, body, s, more) => { const r = await fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, more || {}), body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const enc = encodeURIComponent;
const enter = async (mail, pro) => { const s = (await ask('POST', '/auth/verify', { email: mail, code: (await ask('POST', '/auth/start', { email: mail })).json.dev_code })).json.session; if (pro) await ask('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' }); return s; };
const onDisk = (what) => fs.readdirSync(data).filter((f) => fs.statSync(path.join(data, f)).isFile()).some((f) => fs.readFileSync(path.join(data, f)).includes(Buffer.from(what)));
const J = JSON.stringify;

// Tres cuentas: Ana dice "Ahora no", Beto protege toda su nube, Cora mira el aviso en el teléfono de la app de la tienda.
const ANA = 'ana@ejemplo.test'; const BETO = 'beto@ejemplo.test'; const CORA = 'cora@ejemplo.test';
const sAna = await enter(ANA, false); const sBeto = await enter(BETO, true); const sCora = await enter(CORA, false);
const put = (s, p, text) => ask('PUT', '/notes/' + enc(p), { text }, s);
const raw = async (s, p) => (await ask('GET', '/notes/' + enc(p), undefined, s)).json.text;
const seen = async (s) => (await ask('GET', '/account', undefined, s)).json.protect_seen;
await put(sAna, 'primera.md', '# Primera\n\nNota de Ana.\n');
await put(sBeto, 'suelta.md', '# Suelta\n\nSecreto de la raíz, frambuesa-raiz.\n');
await put(sBeto, 'suelta.md', '# Suelta\n\nSecreto de la raíz, frambuesa-raiz, segunda versión.\n');
await put(sBeto, 'diario/lunes.md', '# Lunes\n\nSecreto del diario, frambuesa-lunes.\n');
await put(sBeto, 'diario/sub/carta.md', '# Carta\n\nframbuesa-carta\n');
await put(sCora, 'primera.md', '# Primera\n\nNota de Cora.\n');
await ask('POST', '/shares', { path: 'diario/lunes.md', email: ANA, role: 'view' }, sBeto);
const link = (await ask('POST', '/links', { path: 'suelta.md' }, sBeto)).json.token;
const token = (await ask('POST', '/tokens', { name: 'ia' }, sBeto)).json.token;
const mcp = async (name, args) => { const r = await ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token); return { text: r.json.result.content[0].text, err: !!r.json.result.isError }; };

const errors = [];
const launch = async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const home = `chrome-extension://${new URL(sw.url()).host}/src/app.html`;
  const page = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.addInitScript(autoDialogs); return p; };
  // Entrar con una cuenta: la sesión se deja escrita donde la app la guarda.
  const as = async (p, s, mail) => { await p.goto(home); await p.waitForSelector('.lmd-home'); await p.evaluate(([url, ss, m]) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: ss, email: m, at: url } }, resolve)), [base, s, mail]); };
  return { ctx, profile, home, page, as, url: (p, more) => home + '?f=' + enc('cloud/' + p.split('/').map(enc).join('/')) + (more || '') };
};
const A = await launch(); const B = await launch();
const sent = []; A.ctx.on('request', (r) => { if (r.url().startsWith(base)) sent.push({ method: r.method(), url: r.url().slice(base.length), body: r.postData() || '' }); });
const CLOUD = '.lmd-xroot[data-root=cloud]'; const CARD = '.lmd-vault-card'; const HINT = '.lmd-protect-hint';
const PASS = 'caballo correcto batería grapa'; const PASS2 = 'otra contraseña bien larga 9';
const o = {};
// Escribe un renglón en la nota abierta y espera a que quede guardado en la nube.
const edit = async (p, text) => {
  if (!(await p.$('.lmd-draft'))) { if (await p.$('[data-act=mode-edit]:not(.lmd-on)')) await p.click('[data-act=mode-edit]').catch(() => {}); await p.evaluate(() => document.querySelector('.markdown-body .lmd-add').click()); await p.waitForSelector('.lmd-draft'); }
  await p.keyboard.type(text); await p.click('.lmd-foot .lmd-status', { force: true });
  await p.waitForFunction(() => /Guardado en la nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 30000 });
};
const hintOf = (p) => p.evaluate((sel) => { const h = document.querySelector(sel); if (!h) return null; const r = h.getBoundingClientRect(); return { title: h.querySelector('b').textContent, text: h.querySelector('p').textContent, buttons: [...h.querySelectorAll('button')].map((b) => b.textContent), modal: !!document.querySelector('.lmd-ask, .lmd-dlg'), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, tall: [...h.querySelectorAll('button')].every((b) => b.getBoundingClientRect().height >= 40), noScroll: document.documentElement.scrollWidth <= innerWidth }; }, HINT);
const noHint = async (p) => { await p.waitForTimeout(1800); return !(await p.$(HINT)); };
const said = async (p, re) => { await p.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 20000 }); return p.textContent('.lmd-foot .lmd-status'); };
const closed = (p) => p.waitForSelector(CARD, { state: 'detached', timeout: 60000 });
const fail = async (p) => { await p.waitForSelector(CARD + ' .lmd-dlg-err:not([hidden])'); return p.textContent(CARD + ' .lmd-dlg-err'); };
const settingsCloud = async (p) => { await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=cloud]'); await p.waitForSelector('.lmd-panel-card .lmd-e2e'); };
const e2e = (p) => p.evaluate(() => { const l = document.querySelector('.lmd-panel-card .lmd-e2e'); const sec = document.querySelector('.lmd-panel-card .lmd-sec'); return { kind: l.dataset.e2e, text: l.querySelector('p').textContent, buttons: [...l.querySelectorAll('button')].map((b) => b.textContent || b.title), above: !!(l.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING),
  card: document.querySelector('[data-sec-row=vaults]').textContent, cardActs: [...document.querySelectorAll('[data-sec-row=vaults] [data-c]')].map((b) => b.dataset.c) }; });
let K = null; let key = null;

try {
  // ---------- El aviso: una vez por cuenta ----------
  let app = await A.page(); await A.as(app, sAna, ANA);
  o.antes = await seen(sAna);
  await app.goto(A.url('primera.md')); await app.waitForSelector('.markdown-body h1');
  o.sinGuardar = await noHint(app); // abrir una nota no lo muestra: hace falta guardar algo
  await edit(app, 'Un renglón de Ana.'); await app.waitForSelector(HINT);
  o.aviso = await hintOf(app); o.anotado = await seen(sAna);
  // No frena nada: se sigue escribiendo con el aviso a la vista.
  await edit(app, ' Sigo escribiendo.'); o.sigue = [!!(await app.$(HINT)), /Sigo escribiendo/.test(await raw(sAna, 'primera.md'))];
  await app.click(HINT + ' [data-ph=no]'); o.ahoraNo = !(await app.$(HINT));
  await edit(app, ' Otra vez.'); o.noVuelve = [await noHint(app)];
  await app.reload(); await app.waitForSelector('.markdown-body h1'); await edit(app, ' Y otra.'); o.noVuelve.push(await noHint(app));
  // Otro dispositivo: otro navegador, con su propio almacenamiento.
  const other = await B.page(); await B.as(other, sAna, ANA);
  await other.goto(B.url('primera.md')); await other.waitForSelector('.markdown-body h1'); await edit(other, ' Desde otro equipo.'); o.noVuelve.push(await noHint(other));
  // Ajustes → Nube: el estado, arriba del bloque de seguridad, con el botón.
  await settingsCloud(app); o.estadoApagado = await e2e(app);
  await app.click('[data-act=close-panel]'); await app.close();

  // ---------- Cómo funciona ----------
  // Cora: el aviso en el teléfono de la app de la tienda.
  const phone = await B.page(); await phone.setViewportSize({ width: 390, height: 844 }); await B.as(phone, sCora, CORA);
  await phone.goto(B.url('primera.md', '&src=android')); await phone.waitForSelector('.markdown-body h1');
  o.tienda = await phone.evaluate(() => LMD.storeApp === true);
  await phone.evaluate(() => LMD.cloud.save('primera.md', '# Primera\n\nNota de Cora, guardada desde el teléfono.\n')); await phone.waitForSelector(HINT);
  o.telefono = await hintOf(phone);
  await phone.click(HINT + ' [data-ph=how]'); await phone.waitForSelector('.lmd-panel-card .lmd-e2e');
  o.como = [!(await phone.$(HINT)), await phone.evaluate(() => { const l = document.querySelector('.lmd-panel-card .lmd-e2e'); const b = l.querySelector('button').getBoundingClientRect(); return [l.dataset.e2e, b.height >= 40 && b.right <= innerWidth, document.documentElement.scrollWidth <= innerWidth]; }), await seen(sCora)];
  // Desde ahí se llega al mismo paso: proteger toda la nube. En el teléfono la ventana entra en la pantalla.
  await phone.click('.lmd-panel-card .lmd-e2e [data-c=protect-all]'); await phone.waitForSelector(CARD + ' [data-v=p1]');
  o.como.push(await phone.evaluate((sel) => { const c = document.querySelector(sel).getBoundingClientRect(); return [document.querySelector(sel + ' h3').textContent, c.left >= 0 && c.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth]; }, CARD));
  await phone.click(CARD + ' [data-v=no]'); await phone.close();

  // ---------- Proteger toda la nube ----------
  app = await A.page(); await A.as(app, sBeto, BETO);
  await app.goto(A.url('diario/lunes.md')); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector(CLOUD + ' .lmd-node');
  await edit(app, 'Escrito antes de proteger.'); await app.waitForSelector(HINT);
  o.compartido = [(await ask('GET', '/shares?path=' + enc('diario/lunes.md'), undefined, sBeto)).json.people.length, (await ask('GET', '/public/' + link)).status];
  await app.click(HINT + ' [data-ph=go]'); await app.waitForSelector(CARD + ' [data-v=p1]');
  o.dialogo = await app.evaluate((sel) => { const c = document.querySelector(sel); return { title: c.querySelector('h3').textContent, lead: c.querySelector('.lmd-vault-body > p').textContent, changes: [...c.querySelectorAll('.lmd-vault-changes li')].map((li) => li.textContent), warn: c.querySelector('.lmd-vault-warn').textContent, hint: !!document.querySelector('.lmd-protect-hint') }; }, CARD);
  await app.fill('[data-v=p1]', 'corta'); await app.click('[data-v=ok]'); o.corta = await fail(app);
  await app.fill('[data-v=p1]', PASS); await app.fill('[data-v=p2]', PASS); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-vault-key');
  const shown = await app.evaluate(() => [...document.querySelectorAll('.lmd-vault-key span')].map((s) => s.textContent).join('-'));
  o.respaldo = [/^([A-HJ-NP-Z2-9]{4}-){12}[A-HJ-NP-Z2-9]{4}$/.test(shown), await app.evaluate(() => document.querySelector('[data-v=ok]').disabled), (await ask('GET', '/vaults', undefined, sBeto)).json.length, await app.textContent(CARD + ' [data-v=ok]')];
  const [download] = await Promise.all([app.waitForEvent('download'), app.click('[data-v=down]')]);
  const file = path.join(A.profile, 'respaldo.txt'); await download.saveAs(file);
  const saved = fs.readFileSync(file, 'utf8');
  o.respaldo.push(download.suggestedFilename(), saved.includes(shown) && saved.includes(BETO) && /nube protegida/.test(saved), await app.evaluate(() => document.querySelector('[data-v=ok]').disabled));
  K = Z.backupKey(shown); key = (await Z.derive(K)).key;
  await app.click('[data-v=ok]'); await closed(app);
  o.protegida = [await said(app, 'protegida')];
  const notes = (await ask('GET', '/notes', undefined, sBeto)).json; const V = (await ask('GET', '/vaults', undefined, sBeto)).json[0];
  const texts = {}; for (const n of notes) texts[n.path] = await raw(sBeto, n.path);
  o.protegida.push(notes.length, notes.every((n) => n.v === 1), Object.values(texts).every((t) => t.startsWith('vault1:')), await Z.open(key, 'suelta.md', texts['suelta.md']), /frambuesa-lunes[\s\S]*Escrito antes de proteger/.test(await Z.open(key, 'diario/lunes.md', texts['diario/lunes.md'])), await Z.open(key, 'diario/sub/carta.md', texts['diario/sub/carta.md']),
    V.folder, V.root, V.check === (await Z.derive(K)).check);
  // En la base del servidor de pruebas no queda texto legible de esas notas: ni la versión de ahora, ni el historial.
  o.disco = [onDisk('frambuesa-raiz'), onDisk('frambuesa-lunes'), onDisk('frambuesa-carta'), onDisk('Escrito antes de proteger'), onDisk('Nota de Ana')];
  o.afuera = [(await ask('GET', '/shares?path=' + enc('diario/lunes.md'), undefined, sBeto)).json.people.length, (await ask('GET', '/public/' + link)).status, (await ask('GET', '/versions/' + enc('suelta.md'), undefined, sBeto)).json.length];
  // La nota abierta sigue a la vista, y el explorador muestra el candado de la nube con los nombres de las notas.
  await app.waitForSelector(CLOUD + ' .lmd-root-lock');
  o.explorador = [await app.textContent('.markdown-body h1'), await app.textContent(CLOUD + ' .lmd-root-lock .lmd-vault-state'), await app.locator(CLOUD + ' .lmd-node', { hasText: 'suelta.md' }).count(), await app.locator(CLOUD + ' .lmd-node-vault').count()];

  // ---------- Lo nuevo nace cifrado ----------
  await edit(app, ' Escrito con la nube protegida.');
  await app.evaluate(() => LMD.cloud.write('nueva.md', '# Nueva\n\nframbuesa-nueva\n'));
  const clear = await put(sBeto, 'en-claro.md', '# En claro\n');
  o.nuevo = [(await raw(sBeto, 'nueva.md')).startsWith('vault1:'), await Z.open(key, 'nueva.md', await raw(sBeto, 'nueva.md')), /Escrito con la nube protegida/.test(await Z.open(key, 'diario/lunes.md', await raw(sBeto, 'diario/lunes.md'))), clear.status, clear.json && clear.json.error, onDisk('frambuesa-nueva'), onDisk('Escrito con la nube protegida')];
  const copy = await app.evaluate(([who]) => LMD.store.cloudGet(who, 'diario/lunes.md'), [BETO]);
  o.nuevo.push(copy.sealed === true && copy.text.startsWith('vault1:'));

  // ---------- Compartir, enlaces, publicar ----------
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=share]');
  o.compartir = [await app.textContent('.lmd-menu .lmd-menu-note'), await app.evaluate(() => document.querySelector('.lmd-menu [data-s=share]').classList.contains('lmd-locked'))];
  await app.click('.lmd-menu [data-s=share]'); o.compartir.push(await said(app, 'no se comparte'), !(await app.$('.lmd-share')));
  const share = await ask('POST', '/shares', { path: 'suelta.md', email: ANA, role: 'view' }, sBeto); const lk = await ask('POST', '/links', { path: 'suelta.md' }, sBeto);
  const site = await ask('POST', '/sites', { folder: 'diario', slug: 'diario-de-beto', title: 'Diario', lang: 'es' }, sBeto);
  o.compartir.push(share.status, lk.status, site.status, site.json && site.json.error, await app.evaluate(() => LMD.sync.canPublish('diario')));

  // ---------- La IA por MCP ----------
  const locked = await mcp('read_note', { path: 'suelta.md' }); const found = await mcp('search_notes', { query: 'frambuesa' });
  o.ia = [locked.err, /protected with a password and are locked/.test(locked.text), (() => { try { const v = JSON.parse(found.text); return v.locked_folders.join() === '/' && v.results.every((r) => !r.hits || !r.hits.length) && /Unlock for the AI/.test(v.note); } catch (e) { return found.text; } })()];
  await ask('POST', '/vaults/' + V.id + '/unlock', { key: Z.b64(K), minutes: 15 }, sBeto);
  const open = await mcp('read_note', { path: 'suelta.md' });
  await ask('POST', '/vaults/' + V.id + '/lock', {}, sBeto);
  o.ia.push(open.err, /frambuesa-raiz/.test(open.text), (await mcp('read_note', { path: 'suelta.md' })).err);

  // ---------- Ajustes: el estado ----------
  await settingsCloud(app); await app.waitForFunction(() => document.querySelector('.lmd-panel-card .lmd-e2e').dataset.e2e === 'all');
  o.estadoTodo = await e2e(app);
  o.sitio = await app.evaluate(() => { const s = document.querySelector('.lmd-panel-card .lmd-site-sec'); return s ? [s.textContent, !!s.querySelector('[data-c=site-new]')] : null; });
  await app.click('[data-ptab=ai]'); await app.waitForSelector('.lmd-vault-list li');
  o.ajustesIa = await app.textContent('.lmd-vault-list li span');
  await app.click('[data-act=close-panel]'); await app.waitForTimeout(200);

  // ---------- Bloquear, y entrar con la contraseña ----------
  await app.click(CLOUD + ' .lmd-root-lock [data-root-vault=v-lock]'); await app.waitForSelector(CLOUD + ' .lmd-root-lock.lmd-team-shut'); await app.waitForSelector('.lmd-home:not([hidden])');
  await app.waitForSelector(CLOUD + ' .lmd-root-lock.lmd-team-shut');
  o.bloqueada = [await app.evaluate(() => !document.querySelector('.lmd-home').hidden), await app.textContent(CLOUD + ' .lmd-root-lock .lmd-vault-state'), await app.locator(CLOUD + ' .lmd-node', { hasText: 'suelta.md' }).count()];
  // Crear una nota con la nube bloqueada pide la contraseña y la nota nace cifrada.
  const made = app.evaluate(() => LMD.cloud.write('con-llave.md', '# Con llave\n\nframbuesa-llave\n').then(() => 'ok', (e) => e.code));
  await app.waitForSelector(CARD + ' [data-v=p]'); await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await closed(app);
  o.creaBloqueada = [await made, (await raw(sBeto, 'con-llave.md')).startsWith('vault1:'), onDisk('frambuesa-llave')];
  await app.waitForSelector(CLOUD + ' .lmd-root-lock [data-root-vault=v-lock]'); await app.click(CLOUD + ' .lmd-root-lock [data-root-vault=v-lock]'); await app.waitForSelector(CLOUD + ' .lmd-root-lock.lmd-team-shut');
  await app.locator(CLOUD + ' a.lmd-node', { hasText: 'suelta.md' }).click(); await app.waitForSelector(CARD + ' [data-v=p]');
  o.pide = [await app.textContent(CARD + ' h3'), await app.textContent(CARD + ' .lmd-vault-body > p')];
  await app.fill('[data-v=p]', 'no es la contraseña'); await app.click('[data-v=ok]'); o.pide.push(await fail(app), !!(await app.$('.markdown-body h1:has-text("Suelta")')));
  await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]'); await closed(app);
  await app.waitForSelector('.markdown-body h1:has-text("Suelta")'); o.pide.push(await app.textContent('.markdown-body p'));

  // ---------- La clave de respaldo ----------
  await app.click(CLOUD + ' .lmd-root-lock [data-root-vault=v-lock]'); await app.waitForSelector(CLOUD + ' .lmd-root-lock.lmd-team-shut'); await app.waitForSelector('.lmd-home:not([hidden])');
  await app.click(CLOUD + ' .lmd-root-lock [data-root-vault=v-unlock]'); await app.waitForSelector(CARD + ' [data-v=forgot]'); await app.click('[data-v=forgot]'); await app.waitForSelector(CARD + ' [data-v=bk]');
  await app.fill('[data-v=bk]', Z.backupText(Z.newKey())); await app.fill('[data-v=p1]', PASS2); await app.fill('[data-v=p2]', PASS2); await app.click('[data-v=ok]'); o.clave = [await fail(app)];
  await app.fill('[data-v=bk]', shown.toLowerCase()); await app.click('[data-v=ok]'); await closed(app);
  await app.waitForSelector(CLOUD + ' .lmd-root-lock:not(.lmd-team-shut)');
  o.clave.push(await app.textContent(CLOUD + ' .lmd-root-lock .lmd-vault-state'));
  const V2 = (await ask('GET', '/vaults', undefined, sBeto)).json[0];
  let old = false; try { await Z.unwrap(V2, PASS); old = true; } catch (e) { /* la anterior ya no abre */ }
  o.clave.push(old, (await Z.derive(await Z.unwrap(V2, PASS2))).check === V2.check);

  // ---------- Lo que viajó ----------
  const all = sent.map((r) => r.url + ' ' + r.body).join('\n');
  o.viajo = [[PASS, PASS2].some((p) => all.includes(p) || all.includes(enc(p))), all.includes(Z.b64(K)) || all.includes(shown), sent.filter((r) => r.method === 'POST' && r.url === '/account/protect-seen').length];

  // ---------- Sin la contraseña ni la clave: eliminar todo, con el correo ----------
  await app.click(CLOUD + ' .lmd-root-lock [data-root-vault=menu]'); await app.waitForSelector('.lmd-menu [data-f=v-destroy]');
  o.menu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f));
  await app.click('.lmd-menu [data-f=v-destroy]'); await app.waitForSelector(CARD + ' [data-v=name]');
  await app.fill('[data-v=name]', 'diario'); await app.click('[data-v=ok]'); o.eliminar = [await fail(app)];
  await app.fill('[data-v=name]', BETO); await app.click('[data-v=ok]'); await closed(app);
  await app.waitForSelector(CLOUD + ' .lmd-root-lock', { state: 'detached' });
  o.eliminar.push(await app.locator(CLOUD + ' .lmd-node').count(),(await ask('GET', '/notes', undefined, sBeto)).json.length, (await ask('GET', '/vaults', undefined, sBeto)).json.length, (await put(sBeto, 'de-nuevo.md', '# De nuevo\n')).status);
  o.nativos = await app.evaluate(() => window.__native);
} catch (e) { o.excepcion = String(e && e.stack || e); }

const TEXT = 'La nube está cifrada, y el servidor guarda esa llave para poder compartir tus notas y dárselas a tu IA. Para que ni el servidor pueda leerlas, protegelas con una contraseña: quedan cifradas de extremo a extremo.';
const checks = [
  ['una cuenta nueva no vio el aviso, y abrir una nota no lo muestra', o.antes === false && o.sinGuardar === true, [o.antes, o.sinGuardar]],
  ['al guardar la primera nota en la nube sale el aviso, con su título, su texto y sus tres salidas', o.aviso && o.aviso.title === 'Tu nota está en la nube' && o.aviso.text === TEXT && J(o.aviso.buttons) === J(['Proteger con contraseña', 'Ahora no', 'Cómo funciona']), o.aviso],
  ['el aviso es una tarjeta que no frena nada: sin ventana encima, y se sigue guardando con él a la vista', o.aviso && o.aviso.modal === false && o.aviso.inside && J(o.sigue) === J([true, true]), [o.aviso, o.sigue]],
  ['que ya se vio queda anotado en la cuenta, en el servidor', o.anotado === true, o.anotado],
  ['"Ahora no" lo cierra, y no vuelve al guardar, al recargar ni en otro dispositivo', o.ahoraNo === true && J(o.noVuelve) === J([true, true, true]), [o.ahoraNo, o.noVuelve]],
  ['Ajustes → Nube dice "apagada" arriba del bloque de seguridad, con el botón para activarla', o.estadoApagado && o.estadoApagado.kind === 'off' && /Protección de extremo a extremo: apagada/.test(o.estadoApagado.text) && J(o.estadoApagado.buttons) === J(['Proteger con contraseña']) && o.estadoApagado.above, o.estadoApagado],
  ['la tarjeta "Carpetas protegidas" lleva al mismo paso y a proteger una carpeta', o.estadoApagado && J(o.estadoApagado.cardActs) === J(['protect-all', 'protect']), o.estadoApagado && o.estadoApagado.cardActs],
  ['en un teléfono el aviso entra en la pantalla y sus botones se tocan (la app de la tienda se mira en storeapp.mjs)', o.telefono && o.telefono.title === 'Tu nota está en la nube' && o.telefono.inside && o.telefono.tall && o.telefono.noScroll, [o.tienda, o.telefono]],
  ['"Cómo funciona" cierra el aviso y abre Ajustes → Nube, con el estado y su botón', o.como && o.como[0] === true && J(o.como[1]) === J(['off', true, true]) && o.como[2] === true, o.como],
  ['desde Ajustes, en el teléfono, se llega a proteger toda la nube y la ventana entra', o.como && J(o.como[3]) === J(['Proteger tu nube con contraseña', true]), o.como && o.como[3]],
  ['"Proteger con contraseña" abre proteger toda la nube y cierra el aviso', o.dialogo && o.dialogo.title === 'Proteger tu nube con contraseña' && o.dialogo.hint === false && /cifradas de extremo a extremo/.test(o.dialogo.lead), o.dialogo],
  ['antes de confirmar dice qué cambia: el servidor no lee, sin compartir ni publicar, la IA solo desbloqueando, y sin contraseña ni clave no hay recuperación',
    o.dialogo && o.dialogo.changes.length === 4 && /servidor ya no puede leer/.test(o.dialogo.changes[0]) && /Compartir, los enlaces públicos, publicar un sitio/.test(o.dialogo.changes[1]) && /IA por MCP.*solo si las desbloqueás/.test(o.dialogo.changes[2]) && /historial anterior, la papelera/.test(o.dialogo.changes[3]) && /Si perdés la contraseña y la clave de respaldo, tus notas no se pueden recuperar/.test(o.dialogo.warn), o.dialogo],
  ['una contraseña corta no pasa', /al menos 8 caracteres/.test(o.corta || ''), o.corta],
  ['la clave de respaldo se muestra y no se sigue sin descargarla o copiarla; hasta ahí no se creó nada', o.respaldo && o.respaldo[0] === true && o.respaldo[1] === true && o.respaldo[2] === 0 && o.respaldo[3] === 'Proteger mi nube' && /^sharpmd-clave-de-respaldo-nube\.txt$/.test(o.respaldo[4]) && o.respaldo[5] === true && o.respaldo[6] === false, o.respaldo],
  ['proteger todo cifra en el navegador las notas que ya había, las de la raíz y las de las carpetas', o.protegida && /Tu nube quedó protegida/.test(o.protegida[0]) && o.protegida[1] === 3 && o.protegida[2] === true && o.protegida[3] === true && /frambuesa-raiz, segunda versión/.test(o.protegida[4]) && o.protegida[5] === true && /frambuesa-carta/.test(o.protegida[6]), o.protegida],
  ['queda como una sola protección sobre la raíz, con la llave de la clave de respaldo', o.protegida && o.protegida[7] === '' && o.protegida[8] === true && o.protegida[9] === true, o.protegida && o.protegida.slice(7)],
  ['en la base del servidor ya no hay texto legible de esas notas, y sí el de otra cuenta sin proteger', o.disco && J(o.disco) === J([false, false, false, false, true]), o.disco],
  ['lo que estaba compartido, el enlace público y el historial anterior se van', J(o.compartido) === J([1, 200]) && J(o.afuera) === J([0, 404, 0]), [o.compartido, o.afuera]],
  ['la nota abierta sigue a la vista y el explorador muestra el candado de la nube, con los nombres de las notas', o.explorador && o.explorador[0] === 'Lunes' && o.explorador[1] === 'Protegida, abierta en esta pestaña' && o.explorador[2] === 1 && o.explorador[3] === 0, o.explorador],
  ['lo nuevo nace cifrado: una nota nueva, un guardado y la copia local; el servidor rechaza texto en claro', o.nuevo && o.nuevo[0] === true && /frambuesa-nueva/.test(o.nuevo[1]) && o.nuevo[2] === true && o.nuevo[3] === 409 && o.nuevo[4] === 'vault' && o.nuevo[5] === false && o.nuevo[6] === false && o.nuevo[7] === true, o.nuevo],
  ['compartir queda bloqueado y se dice por qué, en el menú y al intentarlo', o.compartir && /Nube protegida: sin compartir, enlaces públicos/.test(o.compartir[0]) && o.compartir[1] === true && /Tu nube está protegida con contraseña: el servidor no puede leer esta nota/.test(o.compartir[2]) && o.compartir[3] === true, o.compartir],
  ['el servidor rechaza compartir, enlaces públicos y publicar un sitio', o.compartir && o.compartir[4] === 409 && o.compartir[5] === 409 && o.compartir[6] === 409 && o.compartir[7] === 'vault' && o.compartir[8] === false, o.compartir && o.compartir.slice(4)],
  ['la IA por MCP no lee ni busca con la nube bloqueada, y se le dice qué pedir', o.ia && o.ia[0] === true && o.ia[1] === true && o.ia[2] === true, o.ia],
  ['desbloqueada para la IA lee; al bloquear deja de leer', o.ia && o.ia[3] === false && o.ia[4] === true && o.ia[5] === true, o.ia],
  ['Ajustes → Nube dice "activada en toda tu nube", con bloquear y el menú, y la tarjeta ya no ofrece proteger', o.estadoTodo && o.estadoTodo.kind === 'all' && /Protección de extremo a extremo: activada en toda tu nube/.test(o.estadoTodo.text) && o.estadoTodo.buttons[0] === 'Bloquear' && o.estadoTodo.buttons.length === 2 && /Toda tu nube está protegida/.test(o.estadoTodo.card) && o.estadoTodo.cardActs.length === 0, o.estadoTodo],
  ['Ajustes dice que con toda la nube protegida no se publican sitios, y no ofrece publicar', o.sitio && /no se publican sitios/.test(o.sitio[0]) && o.sitio[1] === false, o.sitio],
  ['Ajustes → IA la lista como "Toda tu nube", bloqueada para la IA', /Toda tu nube.*Bloqueada para la IA/.test(o.ajustesIa || ''), o.ajustesIa],
  ['bloquear cierra la nota abierta; los nombres siguen a la vista', o.bloqueada && o.bloqueada[0] === true && o.bloqueada[1] === 'Protegida, bloqueada' && o.bloqueada[2] === 1, o.bloqueada],
  ['crear una nota con la nube bloqueada pide la contraseña y la nota nace cifrada', J(o.creaBloqueada) === J(['ok', true, false]), o.creaBloqueada],
  ['abrir una nota pide la contraseña; con una equivocada no abre, con la correcta sí', o.pide && o.pide[0] === 'Desbloquear "Tu nube"' && /Tu nube está protegida con contraseña/.test(o.pide[1]) && /no coincide/.test(o.pide[2]) && o.pide[3] === false && /frambuesa-raiz/.test(o.pide[4]), o.pide],
  ['con la clave de respaldo se pone una contraseña nueva; una clave de otra nube se rechaza y la contraseña vieja deja de servir', o.clave && /no es la de tu nube/.test(o.clave[0]) && o.clave[1] === 'Protegida, abierta en esta pestaña' && o.clave[2] === false && o.clave[3] === true, o.clave],
  ['ni la contraseña ni la llave viajaron al servidor, y el aviso se anotó una sola vez', o.viajo && o.viajo[0] === false && o.viajo[1] === false && o.viajo[2] === 2, o.viajo], // dos cuentas pasaron por este navegador: una vez cada una
  ['sin contraseña ni clave queda eliminar todo, confirmando con el correo de la cuenta', o.menu && o.menu.includes('v-destroy') && o.menu.includes('v-off') && o.menu.includes('v-pass') && o.eliminar && /no es el correo/.test(o.eliminar[0]) && o.eliminar[1] === 0 && o.eliminar[2] === 0 && o.eliminar[3] === 0 && o.eliminar[4] === 200, [o.menu, o.eliminar]],
  ['sin errores, y sin cuadros nativos del navegador', errors.length === 0 && !o.excepcion && J(o.nativos) === '[]', [errors, o.excepcion, o.nativos]],
];
console.log('Toda la nube con contraseña y el aviso de la primera vez (app)');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await A.ctx.close(); await B.ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
for (const d of [A.profile, B.profile, data]) fs.rmSync(d, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
