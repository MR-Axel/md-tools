// Las tres herramientas que leen del programa local (src/localtools.js): Servidores locales, Worktrees y Sesiones
// locales, y "Mostrar en el Explorador". El programa es el de la carpeta local/, levantado acá mismo en un puerto libre:
//   - una vez con una máquina de mentira (los ejemplos guardados de local/test/fixtures), para recorrer la interfaz y
//     sacar capturas sin un solo dato de la máquina donde corre la prueba;
//   - otra vez con la máquina de verdad, para emparejar, ver un servidor que la prueba levanta en un puerto alto y
//     cerrarlo con confirmación. Es lo único que se cierra: nada que la prueba no haya levantado.
// El explorador de archivos no se abre nunca: el programa anota qué archivo habría mostrado.
//   SHOTS=C:\tmp\aglocal node localtools.mjs      (deja capturas en esa carpeta)
import { rig, tally, sleep, root } from './rig.mjs';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const local = (f) => require(path.join(root, 'local', 'src', f));
const { create } = local('server.js'); const servers = local('servers.js'); const config = local('config.js'); const win = local('platform/windows.js');
const { NAME, CMD } = local('name.js');

const R = await rig();
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, lang, tools]) => { try { if (localStorage.getItem('lt:listo')) return; localStorage.setItem('lt:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}]);
  return { ctx, page };
}
const goHome = async (page) => { await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250); };
const toolsTab = async (page) => { await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); };
const choose = async (page, id) => { await page.evaluate((t) => { const c = document.querySelector('.lmd-tl-card[data-tool=' + t + ']'); c.scrollIntoView({ block: 'nearest' }); c.querySelector('.lmd-tl-main').click(); }, id); await sleep(200); };
const flip = async (page, id) => { await page.evaluate((t) => document.querySelector('.lmd-tl-card[data-tool=' + t + ']').scrollIntoView({ block: 'nearest' }), id); await page.click('.lmd-tl-card[data-tool=' + id + '] .lmd-switch'); await sleep(350); };
const scripts = (page, file) => page.evaluate((f) => [...document.scripts].filter((s) => s.src.split('/').pop() === f).length, file);
const side = (page) => page.evaluate(() => { const s = document.querySelector('.lmd-tl-side'); const a = s.querySelector('.lmd-tl-opts'); return { tool: s.dataset.tool, name: s.querySelector('h4').textContent, about: s.querySelector('.lmd-tl-about').textContent, scene: (s.querySelector('.lmd-peek').firstElementChild || {}).className || '', turn: !s.querySelector('.lmd-tl-turn').hidden, why: s.querySelector('[data-tl-side=why]').hidden ? '' : s.querySelector('[data-tl-side=why]').textContent, text: a.innerText, on: s.querySelector('[data-tl-side=on]').checked, off: s.querySelector('[data-tl-side=on]').disabled, wide: a.scrollWidth > a.clientWidth + 1 }; });
const rowOf = (page, id) => page.evaluate((t) => { const c = document.querySelector('.lmd-tl-card[data-tool=' + t + ']'); const n = c.querySelector('.lmd-tl-need'); return { name: c.querySelector('.lmd-tl-main b').textContent, on: c.querySelector('[data-tool-on]').checked, disabled: c.querySelector('[data-tool-on]').disabled, need: n && !n.hidden ? n.textContent : '', why: (c.querySelector(':scope > .lmd-tl-why') || {}).textContent || '', off: c.classList.contains('lmd-tl-off') }; }, id);
const marks = (page) => page.evaluate(() => { const bad = []; document.querySelectorAll('.lmd-tl-card, .lmd-tl-side, .lmd-ask').forEach((n) => { const t = n.textContent + ' ' + [...n.querySelectorAll('[title]')].map((x) => x.title).join(' '); if (/[!¡—–]/.test(t)) bad.push(t.slice(0, 80)); }); return bad; });
const IDS = ['localservers', 'localworktrees', 'localagents'];

// ---------- El programa, dos veces ----------
const TOKEN = 'prueba-0123456789abcdefghijklmnopqrstuvwxyzABC';
const fx = (name) => fs.readFileSync(path.join(root, 'local', 'test', 'fixtures', name), 'utf8');
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lt-prueba-')));
const notes = path.join(base, 'notes'); fs.mkdirSync(notes); const note = path.join(notes, 'plan.md'); fs.writeFileSync(note, '# plan\n');
const outsideNote = path.join(base, 'afuera.md'); fs.writeFileSync(outsideNote, '# afuera\n');
const cfgOf = (extra) => Object.assign(JSON.parse(JSON.stringify(config.DEFAULTS)), { port: 0, origins: [R.origin], probeHttp: false, folders: [notes] }, extra);
// La de mentira: los procesos y puertos de los ejemplos guardados. "Cerrar" los saca de la lista y lo anota.
const fake = { killed: [], shown: [], procs: win.parseProcs(fx('procs.json')), listeners: win.parseNetstat(fx('netstat-en.txt')) };
const fakeEnv = Object.assign(servers.environment('win32'), { home: 'C:\\Users\\sam', selfPid: 999999, osDirs: ['C:\\Windows'], systemDirs: ['C:\\Windows', 'C:\\Program Files', 'C:\\Users\\sam\\AppData'],
  exists: (p) => ['c:\\users\\sam\\code\\notes-app\\.git', 'c:\\users\\sam\\code\\notes-app\\package.json', 'c:\\users\\sam\\code\\site\\.git'].includes(p.toLowerCase()),
  readJson: (p) => (/notes-app\\package\.json$/i.test(p) ? { name: 'notes-app', version: '1.4.2' } : /node_modules\\vite\\package\.json$/i.test(p) ? { name: 'vite', version: '5.4.2' } : null) });
const A = create({ cfg: cfgOf({}), token: TOKEN, fixed: true, env: fakeEnv, reveal: (f) => fake.shown.push(f), platform: {
  listeners: async () => fake.listeners.slice(), processes: async () => fake.procs.slice(), stop: () => {}, capabilities: () => ({ cwd: true }),
  killTree: async (pid) => { fake.killed.push(pid); fake.listeners = fake.listeners.filter((l) => l.pid !== pid); fake.procs = fake.procs.filter((p) => p.pid !== pid); } } });
const portA = await A.listen(); const codeA = portA + '.' + TOKEN;
// La de verdad, con un servidor de prueba en una carpeta de proyecto.
const realShown = [];
const B = create({ cfg: cfgOf({ probeHttp: true }), token: TOKEN, fixed: true, reveal: (f) => realShown.push(f) });
const portB = await B.listen(); const codeB = portB + '.' + TOKEN;
const DEMO = path.join(root, 'local', 'test', '.real', 'demo-app'); const DEMO_PORT = 45000 + Math.floor(Math.random() * 900);
fs.mkdirSync(DEMO, { recursive: true });
fs.writeFileSync(path.join(DEMO, 'package.json'), J({ name: 'demo-app', version: '9.8.7', private: true }) + '\n');
fs.writeFileSync(path.join(DEMO, 'server.js'), "require('http').createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<title>Demo</title>'); }).listen(Number(process.argv[2]), '127.0.0.1');\n");
const demo = spawn(process.execPath, ['server.js', String(DEMO_PORT)], { cwd: DEMO, stdio: 'ignore', windowsHide: true });
let demoGone = false; demo.on('exit', () => { demoGone = true; });

try {
  // ---------- Las tres filas, apagadas ----------
  await step('Las tres filas en Herramientas, apagadas por defecto y sin pedir nada', async () => {
    const { ctx, page } = await open();
    await goHome(page); await toolsTab(page); await sleep(200);
    const rows = []; for (const id of IDS) rows.push(await rowOf(page, id));
    check('están las tres, con su nombre, apagadas y sin motivo en contra', J(rows.map((r) => r.name)) === J(['Local servers', 'Worktrees', 'Local sessions']) && rows.every((r) => !r.on && !r.disabled && !r.off && !r.need && !r.why), rows);
    check('son las últimas de las quince', await page.evaluate((ids) => { const all = [...document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card')].map((c) => c.dataset.tool); return all.length === 15 && JSON.stringify(all.slice(-3)) === JSON.stringify(ids); }, IDS));
    check('apagadas no cargan su archivo ni ofrecen mostrar en el explorador', await scripts(page, 'localtools.js') === 0 && await page.evaluate(() => !LMD.localtools && typeof LMD.reveal === 'undefined'));
    const seen = [];
    for (const id of IDS) { await choose(page, id); seen.push(await side(page)); }
    check('cada una tiene su detalle: nombre, descripción, ilustración propia y la invitación a prenderla', J(seen.map((s) => s.scene)) === J(['lmd-pk lmd-pk-ports', 'lmd-pk lmd-pk-wt', 'lmd-pk lmd-pk-sess']) && seen.every((s, i) => s.tool === IDS[i] && s.about.length > 40 && s.turn && !s.on && !s.off && !s.text), seen);
    check('Sesiones locales no se confunde con Agentes: dice que son las de esta computadora', /open on this computer/.test(seen[2].about) && seen[2].name === 'Local sessions' && (await rowOf(page, 'agents')).name === 'Agents', seen[2]);
    check('sin signos de admiración ni rayas', (await marks(page)).length === 0, await marks(page));
    await ctx.close();
  });

  // ---------- Sin el programa, y emparejar ----------
  await step('El detalle sin emparejar, y emparejar pegando el código', async () => {
    const { ctx, page } = await open();
    await goHome(page); await toolsTab(page); await sleep(200);
    await flip(page, 'localservers'); await page.waitForSelector('.lmd-tl-side[data-tool=localservers] .lmd-lt-code');
    const s0 = await side(page);
    check('al prenderla se pide su archivo, y el detalle dice en dos líneas qué es y cómo instalarlo', await scripts(page, 'localtools.js') === 1 && s0.on && s0.text.includes(NAME) && /Nothing goes through our servers/.test(s0.text) && /Install it, start it and paste here the code it shows/.test(s0.text) && !s0.wide, s0);
    const link = await page.evaluate(() => { const a = document.querySelector('.lmd-tl-side .lmd-tl-opts a'); return { href: a.href, text: a.textContent, target: a.target, rel: a.rel }; });
    check('con el enlace a la página de instalación, que abre aparte', link.href === 'https://sharpmd.app/local-tools.html' && link.text === 'How to install it' && link.target === '_blank' && /noopener/.test(link.rel), link);
    check('la fila avisa que falta emparejar', (await rowOf(page, 'localservers')).need === 'Not paired yet');
    await shot(page, '01-detalle-sin-emparejar');
    const say = () => page.evaluate(() => document.querySelector('.lmd-tl-side .lmd-lt-note').textContent);
    await page.fill('.lmd-lt-code', 'cualquier cosa'); await page.click('[data-lt=pair]');
    check('un código mal escrito no se prueba', /does not have the expected shape/.test(await say()));
    await page.fill('.lmd-lt-code', portA + '.' + 'x'.repeat(43)); await page.click('[data-lt=pair]');
    await until(async () => /not its own/.test(await say()));
    check('el código de otro programa no empareja', /not its own/.test(await say()) && await page.evaluate(() => !LMD.localtools.paired() && typeof LMD.reveal === 'undefined'), await say());
    await page.fill('.lmd-lt-code', '1.' + TOKEN); await page.click('[data-lt=pair]');
    check('un puerto que no puede ser tampoco', /does not have the expected shape/.test(await say()));
    // Un puerto donde no hay nadie: el programa no está corriendo
    await page.fill('.lmd-lt-code', '1999.' + TOKEN); await page.click('[data-lt=pair]');
    await until(async () => /is not answering|will ask|has blocked/.test(await say()));
    check('sin el programa corriendo lo dice, con su nombre', new RegExp(NAME + ' is not answering|will ask|has blocked').test(await say()), await say());
    await page.fill('.lmd-lt-code', codeA); await page.keyboard.press('Enter');
    await page.waitForSelector('.lmd-tl-side [data-lt=open]');
    const s1 = await side(page);
    check('con el código bueno queda emparejada: lo dice, resume lo que hay y ofrece la lista', /Paired with/.test(s1.text) && s1.text.includes(NAME) && /2 development servers · 5 ports in all/.test(s1.text) && /See the servers/.test(s1.text) && /Unpair/.test(s1.text) && !s1.wide, s1);
    check('el código quedó en este navegador y no en las preferencias', await page.evaluate(() => !!localStorage.getItem('lmd:local-pair') && !/local-pair|prueba-0123/.test(localStorage.getItem('mdtools:settings') || '')));
    check('el aviso de la fila se fue, y ahora se ofrece mostrar en el explorador', (await rowOf(page, 'localservers')).need === '' && await page.evaluate(() => typeof LMD.reveal === 'function'));
    await shot(page, '02-detalle-emparejada');
    // Las otras dos ya están emparejadas
    await flip(page, 'localworktrees'); await page.waitForSelector('.lmd-tl-side[data-tool=localworktrees] [data-lt=open]');
    const w = await side(page);
    check('Worktrees ya está emparejada, y sin repositorios en las carpetas elegidas lo dice', /Paired with/.test(w.text) && /0 worktrees · 0 repositories/.test(w.text), w);
    await flip(page, 'localagents'); await page.waitForSelector('.lmd-tl-side[data-tool=localagents] [data-lt=open]');
    const g = await side(page);
    check('Sesiones locales también: una sesión con su memoria', /1 open session · 854 MB/.test(g.text) && /See the sessions/.test(g.text), g);

    // ---------- La lista de servidores ----------
    await choose(page, 'localservers'); await page.waitForSelector('.lmd-tl-side[data-tool=localservers] [data-lt=open]');
    await page.click('.lmd-tl-side [data-lt=open]'); await page.waitForSelector('.lmd-lt-card .lmd-lt-row');
    const list = await page.evaluate(() => ({ panel: !document.querySelector('.lmd-panel') || document.querySelector('.lmd-panel').hidden, title: document.querySelector('.lmd-lt-card h3').textContent, label: document.querySelector('.lmd-lt-card').getAttribute('aria-label'),
      dev: [...document.querySelectorAll('.lmd-lt-list > .lmd-lt-row')].map((r) => ({ key: r.querySelector('.lmd-lt-key').textContent, name: r.querySelector('b').textContent, text: r.querySelector('.lmd-lt-what').innerText, close: !!r.querySelector('[data-lt-close]') })),
      more: [...document.querySelectorAll('details.lmd-lt-more')].map((d) => ({ sum: d.querySelector('summary').textContent, rows: d.querySelectorAll('.lmd-lt-row').length, close: d.querySelectorAll('[data-lt-close]').length, cmd: d.querySelectorAll('code').length })) }));
    check('la lista se abre en un diálogo y los ajustes se cierran', list.panel && list.title === 'Local servers' && list.label === 'Local servers', list);
    check('lo de desarrollo va primero, con proyecto, versión, herramienta, quién lo lanzó y si está abierto a la red, y se puede cerrar', list.dev.length === 2 && list.dev[0].key === ':3000' && list.dev[0].name === 'site' && /open to the network/.test(list.dev[0].text) && list.dev[1].key === ':5173' && list.dev[1].name === 'notes-app' && /v1\.4\.2 · vite 5\.4\.2/.test(list.dev[1].text) && /this computer only/.test(list.dev[1].text) && /started by Claude Code/.test(list.dev[1].text) && list.dev.every((r) => r.close), list.dev);
    check('lo del sistema va aparte, plegado, sin línea de comando y sin botón de cerrar', list.more.length === 1 && list.more[0].sum === 'System (3)' && list.more[0].close === 0 && list.more[0].cmd === 0, list.more);
    await shot(page, '03-lista-servidores');
    // Cerrar pregunta antes
    const closeBtn = '.lmd-lt-list > .lmd-lt-row:nth-of-type(2) [data-lt-close]';
    await page.click('.lmd-lt-row:has(.lmd-lt-key:text-is(":5173")) [data-lt-close]'); await page.waitForSelector('.lmd-ask [data-dlg=ok]');
    const ask = await page.evaluate(() => { const b = [...document.querySelectorAll('.lmd-ask')].pop(); return { title: b.querySelector('h3').textContent, text: b.querySelector('p').textContent, ok: b.querySelector('[data-dlg=ok]').textContent, danger: b.querySelector('[data-dlg=ok]').classList.contains('lmd-btn-danger') }; });
    check('cerrar pregunta antes, diciendo qué y en qué puerto', ask.title === 'Close this server?' && ask.text === 'notes-app, on port 5173. What it was doing is lost.' && ask.ok === 'Close' && ask.danger, ask);
    await shot(page, '04-confirmar-cierre');
    await page.click('.lmd-ask [data-dlg=no]'); await sleep(300);
    check('con Cancelar no se cierra nada', fake.killed.length === 0 && await page.locator('.lmd-lt-row:has(.lmd-lt-key:text-is(":5173"))').count() === 1, fake.killed);
    await page.click('.lmd-lt-row:has(.lmd-lt-key:text-is(":5173")) [data-lt-close]'); await page.waitForSelector('.lmd-ask [data-dlg=ok]'); await page.click('.lmd-ask [data-dlg=ok]');
    await until(() => page.evaluate(() => /Closed\./.test(document.querySelector('.lmd-lt-head .lmd-lt-note').textContent)));
    check('al confirmar se cierra ese proceso y solo ese, y la lista ya no lo tiene', J(fake.killed) === J([4242]) && await page.locator('.lmd-lt-row:has(.lmd-lt-key:text-is(":5173"))').count() === 0 && await page.locator('.lmd-lt-list > .lmd-lt-row').count() === 1, fake.killed);
    await page.keyboard.press('Escape'); await sleep(200);
    check('Escape cierra la lista', await page.evaluate(() => !document.querySelector('.lmd-lt') && !LMD.localtools.state().open));

    // ---------- Sesiones ----------
    await page.evaluate(() => LMD.localtools.open('agents')); await page.waitForSelector('.lmd-lt-card .lmd-lt-row');
    const ses = await page.evaluate(() => ({ title: document.querySelector('.lmd-lt-card h3').textContent, heads: [...document.querySelectorAll('.lmd-lt-list h5')].map((h) => h.textContent), rows: [...document.querySelectorAll('.lmd-lt-row')].map((r) => r.innerText.replace(/\s+/g, ' ')), other: (document.querySelector('.lmd-lt-list .lmd-lt-empty') || {}).textContent }));
    check('las sesiones: de qué agente, proyecto, memoria propia y de lo que lanzó, y aparte lo que es de la app de escritorio', ses.title === 'Local sessions' && J(ses.heads) === J(['Claude Code']) && ses.rows.length === 1 && /704 MB Untitled session notes-app · PID 4000 · 700 \+ 4 MB/.test(ses.rows[0]) && /Close$/.test(ses.rows[0]) && ses.other === 'Other processes of the app: 1 · 300 MB', ses);
    await shot(page, '05-lista-sesiones');
    await page.keyboard.press('Escape'); await sleep(150);

    // ---------- Mostrar en el Explorador ----------
    await page.evaluate((p) => LMD.reveal(p), note);
    await until(() => fake.shown.length === 1);
    check('LMD.reveal le pide al programa mostrar ese archivo, y el programa anota exactamente ese', J(fake.shown) === J([note]), fake.shown);
    const subDir = path.join(notes, 'sub dir'); fs.mkdirSync(subDir);
    await page.evaluate((p) => LMD.reveal(p), subDir); await until(() => fake.shown.length === 2);
    await page.evaluate((p) => LMD.reveal(p), notes); await until(() => fake.shown.length === 3);
    check('una carpeta de adentro, y la carpeta sumada misma, también se muestran', J(fake.shown) === J([note, subDir, notes]), fake.shown);
    fake.shown.length = 1;
    await page.evaluate((p) => LMD.reveal(p), outsideNote); await page.waitForSelector('.lmd-ask [data-dlg=ok]');
    const out = await page.evaluate(() => { const b = [...document.querySelectorAll('.lmd-ask')].pop(); return { title: b.querySelector('h3').textContent, text: b.querySelector('p').textContent, cancel: !!b.querySelector('[data-dlg=no]') }; });
    check('un archivo fuera de las carpetas sumadas no se muestra, y la app dice cómo sumar la carpeta', fake.shown.length === 1 && out.title === 'That folder is not added' && out.text.includes(NAME) && out.text.includes(CMD + ' folders add') && !out.cancel, out);
    await page.click('.lmd-ask [data-dlg=ok]'); await sleep(200);

    // ---------- Desemparejar ----------
    await toolsTab(page); await choose(page, 'localservers'); await page.waitForSelector('.lmd-tl-side [data-lt=unpair]'); await page.click('.lmd-tl-side [data-lt=unpair]'); await page.waitForSelector('.lmd-tl-side .lmd-lt-code');
    check('desemparejar borra el código, vuelve el aviso en las tres filas y ya no se ofrece mostrar en el explorador', await page.evaluate(() => !localStorage.getItem('lmd:local-pair') && typeof LMD.reveal === 'undefined') && (await rowOf(page, 'localservers')).need === 'Not paired yet' && (await rowOf(page, 'localagents')).need === 'Not paired yet');
    check('sin signos de admiración ni rayas', (await marks(page)).length === 0, await marks(page));
    await ctx.close();
  });

  // ---------- Contra la máquina de verdad ----------
  await step('Contra el programa real: ver el servidor de prueba y cerrarlo con confirmación', async () => {
    const { ctx, page } = await open({ tools: { localservers: true } });
    await goHome(page);
    await until(() => page.evaluate(() => !!LMD.localtools));
    check('con el código guardado, mostrar en el explorador se ofrece desde el arranque sin abrir los ajustes', await page.evaluate((code) => { LMD.localtools.pair(code); return typeof LMD.reveal === 'function' && LMD.reveal.local === true; }, codeB));
    await page.evaluate(() => LMD.localtools.open('servers')); await page.waitForSelector('.lmd-lt-card');
    const mine = page.locator('.lmd-lt-list > .lmd-lt-row:has(.lmd-lt-key:text-is(":' + DEMO_PORT + '"))');
    await until(async () => await mine.count() === 1, 15000);
    const text = await mine.count() ? (await mine.innerText()).replace(/\s+/g, ' ') : '';
    check('el servidor que levantó la prueba está entre los de desarrollo, con su proyecto, su versión y su título', /demo-app/.test(text) && /v9\.8\.7/.test(text) && /Demo/.test(text) && /this computer only/.test(text) && /PID \d+/.test(text), text);
    await mine.locator('[data-lt-close]').click(); await page.waitForSelector('.lmd-ask [data-dlg=ok]');
    check('pregunta antes de cerrarlo, y el proceso sigue vivo mientras tanto', /demo-app, on port/.test(await page.evaluate(() => [...document.querySelectorAll('.lmd-ask')].pop().querySelector('p').textContent)) && !demoGone);
    await page.click('.lmd-ask [data-dlg=ok]');
    await until(() => page.evaluate(() => /Closed\.|still running|could not/.test(document.querySelector('.lmd-lt-head .lmd-lt-note').textContent)), 15000);
    await until(() => demoGone, 4000);
    check('al confirmar: dice que se cerró, el proceso terminó y la lista ya no lo tiene', await page.evaluate(() => /Closed\./.test(document.querySelector('.lmd-lt-head .lmd-lt-note').textContent)) && demoGone && await mine.count() === 0);
    // Una página de otro origen no llega al programa aunque tenga el código
    const other = await fetch('http://127.0.0.1:' + portB + '/v1/servers', { headers: { Authorization: 'Bearer ' + TOKEN, Origin: 'https://otro-sitio.example' } });
    check('desde otro origen el programa no contesta, ni con el código', other.status === 403 && !other.headers.get('access-control-allow-origin'));
    await ctx.close();
  });

  // ---------- Si el programa se apaga ----------
  await step('Emparejada y con el programa apagado', async () => {
    const { ctx, page } = await open({ tools: { localservers: true } });
    await goHome(page); await until(() => page.evaluate(() => !!LMD.localtools));
    await page.evaluate((t) => LMD.localtools.pair('1998.' + t), TOKEN);
    await toolsTab(page); await choose(page, 'localservers'); await page.waitForSelector('.lmd-tl-side [data-lt=retry]');
    const s = await side(page);
    check('el detalle dice que no contesta, ofrece probar de nuevo, desemparejar y el panel propio para Safari', new RegExp(NAME + ' is not answering|will ask|has blocked').test(s.text) && /Try again/.test(s.text) && /Unpair/.test(s.text) && /In Safari/.test(s.text) && !s.wide, s);
    check('el enlace al panel propio va a esta computadora y lleva el código después del #', await page.evaluate((t) => document.querySelector('.lmd-tl-side .lmd-tl-opts a').href === 'http://127.0.0.1:1998/#t=' + t, TOKEN));
    await shot(page, '06-detalle-sin-respuesta');
    await ctx.close();
  });

  // ---------- En español ----------
  await step('En español', async () => {
    const { ctx, page } = await open({ lang: 'es' });
    await goHome(page); await toolsTab(page); await sleep(200);
    const names = []; for (const id of IDS) names.push((await rowOf(page, id)).name);
    check('los nombres', J(names) === J(['Servidores locales', 'Worktrees', 'Sesiones locales']), names);
    await flip(page, 'localagents'); await page.waitForSelector('.lmd-tl-side[data-tool=localagents] .lmd-lt-code');
    check('el detalle sin emparejar, y el enlace a la página en español', /programa chico que corre en tu computadora/.test((await side(page)).text) && await page.evaluate(() => document.querySelector('.lmd-tl-side .lmd-tl-opts a').href === 'https://sharpmd.app/es/local-tools.html'));
    await ctx.close();
  });

  // ---------- En el teléfono ----------
  await step('En el teléfono: deshabilitadas, con su motivo', async () => {
    const { ctx, page } = await open({ ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: R.kind !== 'firefox' }, tools: { localservers: true } });
    await goHome(page);
    await page.evaluate((code) => { try { localStorage.setItem('lmd:local-pair', JSON.stringify({ port: +code.split('.')[0], token: code.split('.')[1] })); } catch (e) { /* sin almacenamiento */ } LMD.tools.localHook(); }, codeA);
    await toolsTab(page); await sleep(200);
    const rows = []; for (const id of IDS) rows.push(await rowOf(page, id));
    check('las tres salen deshabilitadas y apagadas, aunque una estuviera guardada como prendida, y dicen por qué', rows.every((r) => r.disabled && !r.on && r.off && r.why === 'Used in the app, on the computer you code on.'), rows);
    check('no se pide su archivo ni se ofrece mostrar en el explorador, aunque haya un código guardado', await scripts(page, 'localtools.js') === 0 && await page.evaluate(() => typeof LMD.reveal === 'undefined'));
    await shot(page, '07-telefono');
    await ctx.close();
  });
} finally {
  if (!demoGone) { try { demo.kill(); } catch (e) { /* ya se fue */ } }
  await A.close(); await B.close();
  try { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(path.join(root, 'local', 'test', '.real'), { recursive: true, force: true }); } catch (e) { /* Windows suelta la carpeta después */ }
}

check('el explorador de la máquina de verdad no se pidió nunca', realShown.length === 0, realShown);
check('ninguna página tiró errores', R.errors.length === 0, R.errors.slice(0, 5));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
