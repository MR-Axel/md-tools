// Nube de punta a punta: entrar con el código, nota nueva en la nube, token y una IA escribiendo por MCP,
// el árbol de la carpeta Nube (crear, renombrar, mover, eliminar, límite) y el trabajo sin conexión.
// Todo contra un servidor local: la nube de verdad queda apagada con cloudUrl 'off' antes de apuntar acá.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 19000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
// El servidor se apaga y se vuelve a levantar sobre los mismos datos para probar el trabajo sin conexión.
const startServer = async () => {
  const s = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', MCP_FREE: '1', SHARE_FREE: '1', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; s.stdout.on('data', (d) => { log += d; }); s.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  return s;
};
const stopServer = async () => { const gone = new Promise((r) => server.once('exit', r)); server.kill(); await gone; };
let server = await startServer();

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(() => { window.confirm = () => true; window.prompt = () => window.__answer || null; });
const home = `chrome-extension://${id}/src/app.html`;
const o = {};
const mcp = (token, name, args) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json());

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  await app.goto(home); await app.waitForSelector('.lmd-home');
  o.sinServidor = await app.evaluate(() => document.querySelector('.lmd-home-cloud').hidden);
  await app.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url } }, resolve)), base);
  await app.goto(home); await app.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
  await app.click('[data-cloud=ask]'); await app.fill('[data-field=email]', 'ana@ejemplo.test');
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  const code = (await started.json()).dev_code;
  await app.waitForSelector('[data-field=code]'); await app.fill('[data-field=code]', '999999' === code ? '000000' : '999999'); await app.click('[data-cloud=verify]');
  await app.waitForSelector('.lmd-home-cloud-err'); o.codigoMalo = await app.textContent('.lmd-home-cloud-err');
  await app.fill('[data-field=code]', code); await app.click('[data-cloud=verify]');
  await app.waitForSelector('[data-cloud=logout]'); o.cuenta = [await app.textContent('.lmd-home-acct-who b'), await app.textContent('.lmd-home-acct-who small')];

  await Promise.all([app.waitForNavigation(), app.click('[data-home=new]')]); await app.waitForSelector('.lmd-draft');
  o.url = /f=cloud%2Fnota-/.test(app.url());
  await app.keyboard.type('# Plan'); await app.keyboard.press('Enter'); await app.keyboard.type('Escrito en la app.'); await app.click('.lmd-foot .lmd-status', { force: true });
  await app.waitForFunction(() => /Guardando/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 4000 }).catch(() => {});
  await app.waitForFunction(() => /nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 8000 });
  o.estado = await app.textContent('.lmd-savestate');
  o.icono = await app.evaluate(() => document.querySelector('.lmd-sync').className);
  const noteUrl = app.url(); const notePath = decodeURIComponent(decodeURIComponent(noteUrl.split('f=cloud%2F')[1].split('&')[0]));

  const page2 = await ctx.newPage(); await page2.goto(home); await page2.waitForSelector('.lmd-home-item');
  o.enInicio = await page2.textContent('.lmd-home-item');
  // "Conectar una IA" abre el mismo panel que Ajustes → IA, en una ventana: ahí se crea el token.
  await page2.click('[data-cloud=ai]'); await page2.waitForSelector('.lmd-acct-card [data-c=token]'); await page2.click('[data-c=token]'); await page2.waitForSelector('.lmd-ai-new');
  const fields = await page2.evaluate(() => [...document.querySelectorAll('.lmd-acct-card .lmd-field input')].map((i) => i.value));
  o.campos = [fields[0], fields[1].slice(0, 4), fields[2].slice(0, 44)];
  const token = fields[1];
  const read = await mcp(token, 'read_note', { path: notePath });
  o.leeLaIA = read.result.content[0].text;
  await mcp(token, 'append_note', { path: notePath, text: 'Agregado por la IA.' });
  await page2.close();
  await app.bringToFront();
  await app.waitForFunction(() => /Agregado por la IA/.test(document.querySelector('.markdown-body').textContent), null, { timeout: 20000 });
  o.veLoDeLaIA = true;

  await app.evaluate(() => LMD.store.notePut('suelta.md', '# Suelta\n\nNota del navegador.'));
  await app.goto(home + '?f=' + encodeURIComponent('local/suelta.md')); await app.waitForSelector('.lmd-sync:not([hidden])');
  o.iconoFuera = await app.evaluate(() => document.querySelector('.lmd-sync').className);
  await Promise.all([app.waitForNavigation(), app.click('.lmd-sync')]); await app.waitForSelector('.markdown-body h1');
  o.subida = [/f=cloud%2Fsuelta\.md/.test(app.url()), await app.textContent('.markdown-body h1')];
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=history]');
  o.historialBloqueado = await app.evaluate(() => document.querySelector('.lmd-menu [data-s=history]').classList.contains('lmd-locked'));
  await app.keyboard.press('Escape'); await app.mouse.click(700, 500);
  await app.click('.lmd-sync'); await app.click('.lmd-menu [data-s=share]'); await app.waitForSelector('.lmd-share');
  await app.fill('[data-sh=email]', 'beto@ejemplo.test'); await app.click('[data-sh=invite]'); await app.waitForSelector('[data-sh=people] li');
  o.invitado = await app.textContent('[data-sh=people] li span');
  await app.fill('[data-sh=pass]', 'manzana-42'); await app.click('[data-sh=link]'); await app.waitForSelector('[data-sh=links] li input');
  const shareUrl = await app.inputValue('[data-sh=links] li input');
  o.enlace = /app\.html\?f=pub%2F/.test(shareUrl);
  await app.click('[data-sh=close]');
  const visitor = await ctx.newPage();
  await visitor.addInitScript(() => { let n = 0; window.prompt = () => (n++ ? 'manzana-42' : 'equivocada'); });
  await visitor.goto(home + '?' + shareUrl.split('?')[1]); await visitor.waitForSelector('.markdown-body h1');
  o.publico = [await visitor.textContent('.markdown-body h1'), await visitor.title(), await visitor.evaluate(() => document.documentElement.classList.contains('lmd-readonly'))];
  await visitor.click('[data-act=mode-edit]'); await visitor.waitForTimeout(300);
  o.publicoNoEdita = await visitor.evaluate(() => !document.documentElement.classList.contains('lmd-editing'));
  await visitor.close();

  // ---------- Árbol de la carpeta Nube ----------
  const mail = 'ana@ejemplo.test';
  const session = await app.evaluate(() => new Promise((resolve) => chrome.storage.local.get('cloud', (r) => resolve(r.cloud.session))));
  const api = (method, p, body, s) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}), body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
  const paths = async () => (await api('GET', '/notes', undefined, session)).map((n) => n.path).sort();
  const serverText = async (p) => (await api('GET', '/notes/' + encodeURIComponent(p), undefined, session)).text;
  const answer = (v) => app.evaluate((x) => { window.__answer = x; }, v);
  const cloudUrl = (p) => home + '?f=' + encodeURIComponent('cloud/' + p.split('/').map(encodeURIComponent).join('/'));
  const said = async (re) => { await app.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 8000 }); return app.textContent('.lmd-foot .lmd-status'); };
  const menu = async (name, act) => { await app.locator('.lmd-node', { hasText: name }).first().click({ button: 'right' }); await app.waitForSelector('.lmd-menu [data-f=' + act + ']'); };
  const opened = async () => { await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node'); };

  await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node');
  await answer('proyecto/plan.md');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-tree-new')]); await opened();
  o.creada = [/f=cloud%2Fproyecto%2Fplan\.md/.test(app.url()), await app.textContent('.markdown-body h1'), (await paths()).includes('proyecto/plan.md')];

  await answer('ideas'); await menu('plan.md', 'dir');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-menu [data-f=dir]')]); await opened();
  o.carpeta = [/ideas%2Fnota\.md/.test(app.url()), (await paths()).includes('proyecto/ideas/nota.md')];

  // Renombrar la nota abierta la deja abierta en su ruta nueva.
  await answer('proyecto/ideas/lista.md'); await menu('nota.md', 'ren');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-menu [data-f=ren]')]); await opened();
  let now = await paths();
  o.renombrada = [/ideas%2Flista\.md/.test(app.url()), await app.title(), await app.textContent('.markdown-body h1'), now.includes('proyecto/ideas/lista.md') && !now.includes('proyecto/ideas/nota.md')];

  // Mover una nota que no está abierta, y renombrar la carpeta de la que sí.
  await app.click('.lmd-tree-head .lmd-tree-up:not(.lmd-tree-new):not(.lmd-tree-open)'); await app.waitForSelector('.lmd-node-dir');
  await answer('archivo/plan.md'); await menu('plan.md', 'ren'); await app.click('.lmd-menu [data-f=ren]');
  for (let i = 0; i < 40 && !(await paths()).includes('archivo/plan.md'); i++) await app.waitForTimeout(150);
  now = await paths();
  o.movida = now.includes('archivo/plan.md') && !now.includes('proyecto/plan.md');
  await app.waitForSelector('.lmd-node-dir');
  await answer('proyecto/borradores'); await app.locator('.lmd-node-dir', { hasText: 'ideas' }).click({ button: 'right' });
  await Promise.all([app.waitForNavigation(), app.click('.lmd-menu [data-f=ren]')]); await opened();
  o.carpetaRenombrada = [/borradores%2Flista\.md/.test(app.url()), (await paths()).includes('proyecto/borradores/lista.md')];

  // Renombrar desde el título de arriba: el nombre vale dentro de la carpeta donde está la nota.
  const retitle = async (name) => { await app.dblclick('.lmd-docname'); await app.fill('.lmd-docname-input', name); await Promise.all([app.waitForNavigation(), app.keyboard.press('Enter')]); await opened(); };
  await retitle('listado');
  now = await paths();
  o.tituloNube = [/borradores%2Flistado\.md/.test(app.url()), await app.title(), now.includes('proyecto/borradores/listado.md') && !now.includes('proyecto/borradores/lista.md')];
  await retitle('lista.md');

  // Arrastrar en el árbol: a una carpeta, de vuelta a la raíz, y la nota abierta.
  const up = '.lmd-tree-head .lmd-tree-up:not(.lmd-tree-new):not(.lmd-tree-open)';
  const node = (name) => app.locator('.lmd-node', { hasText: name }).first();
  const drag = async (from, to) => {
    await from.hover(); await app.mouse.down(); await to.hover(); await to.hover();
    const marked = await app.evaluate(() => { const m = document.querySelector('.lmd-drop'); return !m ? '' : m.dataset.url ? decodeURIComponent(m.dataset.url.replace(/\/$/, '').split('/').pop()) : 'raíz'; });
    await app.mouse.up();
    return marked;
  };
  const until = async (fn) => { for (let i = 0; i < 40 && !fn(await paths()); i++) await app.waitForTimeout(150); return paths(); };
  await app.click(up); await app.waitForSelector('.lmd-node-dir.lmd-open'); await app.click(up); await app.waitForSelector('.lmd-node-kids .lmd-node.lmd-active');
  o.arrastreNube = [await drag(node('suelta.md'), node('archivo'))];
  now = await until((p) => p.includes('archivo/suelta.md'));
  o.arrastreNube.push(now.includes('archivo/suelta.md') && !now.includes('suelta.md'));
  await app.waitForFunction(() => ![...document.querySelectorAll('.lmd-tree > .lmd-node')].some((n) => n.textContent.trim() === 'suelta.md'));
  await node('archivo').click(); await app.waitForSelector('.lmd-node-kids .lmd-node:has-text("suelta.md")');
  o.arrastreNube.push(await drag(node('suelta.md'), app.locator('.lmd-tree-head')));
  now = await until((p) => p.includes('suelta.md'));
  o.arrastreNube.push(now.includes('suelta.md') && !now.includes('archivo/suelta.md'));
  await app.waitForFunction(() => [...document.querySelectorAll('.lmd-tree > .lmd-node')].some((n) => n.textContent.trim() === 'suelta.md'));
  await app.waitForSelector('.lmd-node-kids .lmd-node.lmd-active');
  const [, marked] = await Promise.all([app.waitForNavigation(), drag(node('lista.md'), node('proyecto'))]); await opened();
  now = await paths();
  o.arrastreAbiertaNube = [marked, /f=cloud%2Fproyecto%2Flista\.md/.test(app.url()), await app.title(), now.includes('proyecto/lista.md') && !now.includes('proyecto/borradores/lista.md')];
  await answer('proyecto/borradores/lista.md'); await menu('lista.md', 'ren');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-menu [data-f=ren]')]); await opened();

  await answer('borrar.md');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-tree-new')]); await opened();
  await menu('lista.md', 'del'); await app.click('.lmd-menu [data-f=del]');
  for (let i = 0; i < 40 && (await paths()).includes('proyecto/borradores/lista.md'); i++) await app.waitForTimeout(150);
  await app.waitForFunction(() => document.querySelectorAll('.lmd-node').length === 1);
  o.eliminada = [!(await paths()).includes('proyecto/borradores/lista.md'), await app.evaluate(() => [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim()))];

  // Plan gratis: con diez notas, la undécima no se crea y el aviso invita al plan pago.
  const before = await paths();
  for (let i = before.length; i < 10; i++) await api('PUT', '/notes/relleno-' + i + '.md', { text: 'x' }, session);
  await answer('once.md'); await app.click('.lmd-tree-new');
  o.limite = [await said('límite'), (await paths()).length];
  for (let i = before.length; i < 10; i++) await api('DELETE', '/notes/relleno-' + i + '.md', undefined, session);

  // Una nota compartida solo para ver: ni renombrar ni crear al lado.
  const bs = await api('POST', '/auth/start', { email: 'beto@ejemplo.test' });
  const beto = (await api('POST', '/auth/verify', { email: 'beto@ejemplo.test', code: bs.dev_code })).session;
  await api('PUT', '/notes/de-beto.md', { text: '# De Beto\n' }, beto);
  await api('POST', '/shares', { path: 'de-beto.md', email: mail, role: 'view', kind: 'note' }, beto);
  const owner = (await api('GET', '/shared', undefined, session))[0].owner;
  // Aunque la pestaña venga de editar, una nota de solo lectura abre leyendo y no pasa a edición.
  await app.evaluate(() => sessionStorage.setItem('lmd-edit', String(Date.now())));
  await app.goto(cloudUrl('~' + owner + '/de-beto.md')); await opened();
  const editing = () => app.evaluate(() => document.documentElement.classList.contains('lmd-editing'));
  o.soloLectura = [await editing()];
  await app.locator('.markdown-body h1').dblclick(); await app.waitForTimeout(300); o.soloLectura.push(await editing());
  await app.locator('.markdown-body h1').click({ button: 'right' }); await app.waitForTimeout(300); o.soloLectura.push(await editing(), await app.locator('.lmd-menu').count());
  await app.keyboard.press('F2'); await app.dblclick('.lmd-docname'); await app.waitForTimeout(200); o.soloLectura.push(await app.locator('.lmd-docname-input').count());
  await app.evaluate(() => sessionStorage.removeItem('lmd-edit'));
  o.soloVer = [await app.evaluate(() => document.documentElement.classList.contains('lmd-readonly'))];
  await answer('otra.md'); await menu('de-beto.md', 'ren'); await app.click('.lmd-menu [data-f=ren]');
  o.soloVer.push(await said('Solo quien'));
  await app.click('.lmd-tree-new');
  o.soloVer.push(await said('solo lectura'), (await api('GET', '/notes', undefined, beto)).length);

  // ---------- Sin conexión ----------
  const copy = (p) => app.evaluate(([who, note]) => LMD.store.cloudGet(who, note), [mail, p]);
  const queued = async (p, re) => { for (let i = 0; i < 60; i++) { const c = await copy(p); if (c && c.pending && re.test(c.text)) return true; await app.waitForTimeout(200); } return false; };
  const write = async (text) => { await app.keyboard.type(text); await app.click('.lmd-foot .lmd-status', { force: true }); };
  const savedToCloud = () => app.waitForFunction(() => /Guardado en la nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 30000 });
  await app.goto(cloudUrl('suelta.md')); await opened();
  await stopServer();
  let asks = 0; const countAsks = (r) => { if (r.url().endsWith('/account')) asks++; }; app.on('request', countAsks);
  await app.goto(cloudUrl('suelta.md') + '&edit=1'); await app.waitForSelector('.lmd-draft');
  o.sinConexion = [await app.textContent('.markdown-body h1'), await app.textContent('.lmd-savestate'), await app.evaluate(() => document.querySelector('.lmd-sync').className)];
  await write('Escrito sin conexión.');
  o.enCola = await queued('suelta.md', /Escrito sin conexión/);
  await app.waitForTimeout(1000); app.off('request', countAsks); o.pedidosSinConexion = asks;
  await app.goto(home); await app.waitForSelector('.lmd-home-item');
  o.inicioSinConexion = await app.evaluate(() => [...document.querySelectorAll('.lmd-home-item')].map((a) => a.textContent).filter((t) => /suelta\.md/.test(t)));
  await app.goto(cloudUrl('relleno-que-no-esta.md')); await app.waitForSelector('.lmd-home-msg:not([hidden])');
  o.sinCopia = await app.textContent('.lmd-home-msg');

  // Vuelve el servidor, y mientras tanto la nota cambió allá: al abrirla se juntan las dos ediciones.
  server = await startServer();
  await api('PUT', '/notes/suelta.md', { text: '# Suelta cambiada\n\nNota del navegador.' }, session);
  await app.goto(cloudUrl('suelta.md')); await opened(); await savedToCloud();
  o.mezclada = [await app.textContent('.markdown-body h1'), await serverText('suelta.md'), (await copy('suelta.md')).pending];

  // Con la nota abierta durante el corte: lo escrito espera y sube solo cuando vuelve.
  await stopServer();
  await app.click('[data-act=mode-edit]'); await app.evaluate(() => document.querySelector('.markdown-body .lmd-add').click()); await app.waitForSelector('.lmd-draft');
  await write('Segunda sin conexión.');
  o.enCola2 = [await queued('suelta.md', /Segunda sin conexión/), await app.textContent('.lmd-savestate')];
  server = await startServer();
  await savedToCloud();
  o.subioSola = [await serverText('suelta.md'), (await copy('suelta.md')).pending, await app.evaluate(() => document.querySelector('.lmd-sync').className)];

  // Corte solo del lado del navegador: mientras dura, la nota cambia en el servidor. Al volver se juntan sin recargar.
  const cut = (route) => route.abort();
  await ctx.route(base + '/**', cut);
  await app.evaluate(() => document.querySelector('.markdown-body .lmd-add').click()); await app.waitForSelector('.lmd-draft');
  await write('Tercera sin conexión.');
  o.enCola3 = await queued('suelta.md', /Tercera sin conexión/);
  await api('PUT', '/notes/suelta.md', { text: (await serverText('suelta.md')).replace('# Suelta cambiada', '# Suelta otra vez') }, session);
  await ctx.unroute(base + '/**', cut);
  await savedToCloud();
  o.mezclaAbierta = [await serverText('suelta.md'), await app.textContent('.markdown-body h1')];

  // La cola de notas que no están abiertas se sube desde el inicio. Si las dos ediciones se pisan,
  // gana el servidor y lo escrito acá queda aparte, como nota del navegador.
  const was = await serverText('suelta.md');
  await app.goto(home); await app.waitForSelector('.lmd-home-item');
  await app.evaluate(([who, text]) => Promise.all([
    LMD.store.cloudPut(who, 'suelta.md', { text: text.replace('Nota del navegador.', 'Nota editada sin conexión.'), base: text, pending: true, role: 'owner' }),
    LMD.store.cloudPut(who, 'archivo/plan.md', { text: '# plan\n\nAgregado sin conexión.\n', base: '# plan\n', pending: true, role: 'owner' }),
  ]), [mail, was]);
  await api('PUT', '/notes/suelta.md', { text: was.replace('Nota del navegador.', 'Nota editada en otro lado.') }, session);
  await app.goto(home); await app.waitForSelector('.lmd-home-item');
  for (let i = 0; i < 40 && ((await copy('suelta.md')) || {}).pending; i++) await app.waitForTimeout(150);
  o.cola = [await serverText('archivo/plan.md'), await serverText('suelta.md'), (await copy('suelta.md')).pending, await app.evaluate(() => LMD.store.noteGet('suelta (sin conexión).md').then((n) => n && n.text))];
  await app.goto(home); await app.waitForSelector('[data-cloud=logout]'); await app.click('[data-cloud=logout]'); await app.waitForSelector('[data-cloud=ask]');
  o.salio = (await app.locator('.lmd-home-item', { hasText: 'en la nube' }).count()) === 0;
  o.sinCopias = await app.evaluate((who) => LMD.store.cloudAll(who).then((all) => all.length), mail);
  await app.goto(noteUrl.replace('&edit=1', '')); await app.waitForSelector('.lmd-home-msg:not([hidden])');
  o.sinSesion = await app.textContent('.lmd-home-msg');
} catch (e) { o.excepcion = String(e && e.stack || e).slice(0, 600); }

const J = (v) => JSON.stringify(v);
const checks = [
  ['con la nube apagada en Ajustes no aparece', o.sinServidor === true],
  ['un código equivocado avisa', /no coincide/.test(o.codigoMalo || ''), o.codigoMalo],
  ['entrar muestra la cuenta, el plan y el cupo', o.cuenta && o.cuenta[0] === 'ana@ejemplo.test' && /^Plan gratis · 0 de 10 notas/.test(o.cuenta[1]), o.cuenta],
  ['con la cuenta abierta, la nota nueva va a la nube', o.url === true],
  ['se guarda sola en la nube', /Guardado en la nube/.test(o.estado || ''), o.estado],
  ['el ícono de la nube marca la nota como sincronizada', /lmd-sync-ok/.test(o.icono || ''), o.icono],
  ['en una nota del navegador el ícono aparece apagado', /lmd-sync-off/.test(o.iconoFuera || ''), o.iconoFuera],
  ['un clic la sube a la nube', o.subida && o.subida[0] && /Suelta/.test(o.subida[1]), o.subida],
  ['el historial figura bloqueado en el plan gratis', o.historialBloqueado === true],
  ['compartir con otra cuenta la deja en la lista', /beto@ejemplo\.test/.test(o.invitado || ''), o.invitado],
  ['crea un enlace público para la app web', o.enlace === true],
  ['el enlace con contraseña abre de solo lectura', o.publico && /Suelta/.test(o.publico[0]) && o.publico[1] === 'suelta.md' && o.publico[2] === true && o.publicoNoEdita === true, o.publico],
  ['aparece en el inicio como nota de la nube', /en la nube/.test(o.enInicio || ''), o.enInicio],
  ['el panel para conectar una IA da URL, token y comando', o.campos && o.campos[0] === base + '/mcp' && o.campos[1] === 'mdt_' && o.campos[2].startsWith('claude mcp add --transport http sharpmd'), o.campos],
  ['la IA lee por MCP lo escrito en la app', (o.leeLaIA || '').trim() === '# Plan\n\nEscrito en la app.', o.leeLaIA],
  ['lo que agrega la IA aparece en la app sin recargar', o.veLoDeLaIA === true],
  ['el árbol de la Nube crea una nota dentro de una carpeta', o.creada && o.creada[0] && /plan/.test(o.creada[1]) && o.creada[2], o.creada],
  ['una carpeta nueva nace con su primera nota', o.carpeta && o.carpeta[0] && o.carpeta[1], o.carpeta],
  ['renombrar la nota abierta la deja abierta en su ruta nueva', o.renombrada && o.renombrada[0] && o.renombrada[1] === 'lista.md' && /nota/.test(o.renombrada[2]) && o.renombrada[3], o.renombrada],
  ['renombrar con otra ruta mueve la nota', o.movida === true],
  ['renombrar una carpeta mueve lo que tiene adentro', o.carpetaRenombrada && o.carpetaRenombrada[0] && o.carpetaRenombrada[1], o.carpetaRenombrada],
  ['renombrar desde el título deja la nota de la nube abierta con su nombre nuevo', o.tituloNube && o.tituloNube[0] && o.tituloNube[1] === 'listado.md' && o.tituloNube[2], o.tituloNube],
  ['arrastrar en el árbol de la Nube mueve la nota a la carpeta y de vuelta a la raíz', J(o.arrastreNube) === J(['archivo', true, 'raíz', true]), o.arrastreNube],
  ['arrastrar la nota abierta de la nube la deja abierta en su ruta nueva', J(o.arrastreAbiertaNube) === J(['proyecto', true, 'lista.md', true]), o.arrastreAbiertaNube],
  ['una nota de solo lectura no entra en edición ni se renombra desde el título', J(o.soloLectura) === J([false, false, false, 0, 0]), o.soloLectura],
  ['eliminar desde el árbol la saca de la nube', o.eliminada && o.eliminada[0] && J(o.eliminada[1]) === '["borrar.md"]', o.eliminada],
  ['en el límite del plan gratis no crea y invita al plan pago', o.limite && /límite de notas del plan gratis/.test(o.limite[0]) && /plan pago/.test(o.limite[0]) && !/[!¡—]/.test(o.limite[0]) && o.limite[1] === 10, o.limite],
  ['una nota compartida solo para ver no se renombra ni deja crear al lado', o.soloVer && o.soloVer[0] === true && /Solo quien creó/.test(o.soloVer[1]) && /solo lectura/.test(o.soloVer[2]) && o.soloVer[3] === 1, o.soloVer],
  ['sin conexión la nota abre desde la copia y lo marca', o.sinConexion && /Suelta/.test(o.sinConexion[0]) && /Sin conexión/.test(o.sinConexion[1]) && /lmd-sync-err/.test(o.sinConexion[2]), o.sinConexion],
  ['lo escrito sin conexión queda en la cola', o.enCola === true],
  ['sin conexión no queda consultando la cuenta en bucle', o.pedidosSinConexion < 10, o.pedidosSinConexion],
  ['sin conexión el inicio lista las notas con copia', o.inicioSinConexion && o.inicioSinConexion.length === 1 && /copia sin conexión/.test(o.inicioSinConexion[0]), o.inicioSinConexion],
  ['sin conexión y sin copia, lo dice', /Sin conexión/.test(o.sinCopia || '') && /no tiene copia/.test(o.sinCopia || ''), o.sinCopia],
  ['al volver, lo de la cola se mezcla con lo que cambió en el servidor', o.mezclada && /Suelta cambiada/.test(o.mezclada[0]) && /^# Suelta cambiada/.test(o.mezclada[1]) && /Escrito sin conexión\./.test(o.mezclada[1]) && o.mezclada[2] === false, o.mezclada],
  ['con la nota abierta durante el corte, sube sola al volver', o.enCola2 && o.enCola2[0] === true && /Sin conexión/.test(o.enCola2[1]) && o.subioSola && /Segunda sin conexión\./.test(o.subioSola[0]) && /Escrito sin conexión\./.test(o.subioSola[0]) && o.subioSola[1] === false && /lmd-sync-ok/.test(o.subioSola[2]), [o.enCola2, o.subioSola]],
  ['si la nota cambió en el servidor durante el corte, se mezcla en vez de pisar', o.enCola3 === true && o.mezclaAbierta && /^# Suelta otra vez/.test(o.mezclaAbierta[0]) && /Tercera sin conexión\./.test(o.mezclaAbierta[0]) && /Segunda sin conexión\./.test(o.mezclaAbierta[0]) && /Suelta otra vez/.test(o.mezclaAbierta[1]), [o.enCola3, o.mezclaAbierta]],
  ['la cola de notas cerradas se sube desde el inicio', o.cola && /Agregado sin conexión/.test(o.cola[0]), o.cola],
  ['si las dos ediciones se pisan no se pierde ninguna', o.cola && /editada en otro lado/.test(o.cola[1]) && !/editada sin conexión/.test(o.cola[1]) && o.cola[2] === false && /editada sin conexión/.test(o.cola[3] || ''), o.cola],
  ['salir saca las notas de la nube del inicio', o.salio === true],
  ['salir borra las copias locales de la cuenta', o.sinCopias === 0, o.sinCopias],
  ['sin sesión no se abre una nota de la nube', /Entrá a tu cuenta/.test(o.sinSesion || ''), o.sinSesion],
  ['sin errores', errors.length === 0 && !o.excepcion, [errors, o.excepcion]],
];
console.log('Nube y MCP');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
