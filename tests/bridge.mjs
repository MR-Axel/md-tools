// Un solo depósito entre la app web y la extensión, el botón de la extensión, sin conexión y "Abrir con".
//
// La extensión de verdad solo le habla a https://sharpmd.app. Para probarla con la web servida en local se arma una
// copia en una carpeta temporal con dos cambios: el script de contenido del puente apunta a 127.0.0.1 y la dirección
// de la app web es la del servidor de la prueba. El código publicado no tiene ninguna puerta para eso.
// Uso: node bridge.mjs
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
import { rig, tally, sleep, typeIn, leave, root } from './rig.mjs';

const { check, done } = tally();
const J = JSON.stringify;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown' };
const until = async (fn, ms) => { const t = Date.now(); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v || Date.now() - t > (ms || 10000)) return v; await sleep(150); } };

// El sitio, servido como en sharpmd.app. Se puede apagar y volver a prender en el mismo puerto: es la "red" de la web.
const serve = (port) => new Promise((resolve) => {
  const site = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
  site.listen(port || 0, '127.0.0.1', () => resolve(site));
});
const shut = (site) => new Promise((resolve) => { site.close(() => resolve()); site.closeAllConnections(); });

let site = await serve(0); const PORT = site.address().port;
const W = 'http://127.0.0.1:' + PORT; const WEB = W + '/src/app.html';
const other = await serve(0); const OTHER = 'http://127.0.0.1:' + other.address().port + '/src/app.html';

// ---------- La copia de la extensión para la prueba ----------
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-ext-'));
for (const name of ['manifest.json', '_locales', 'icons', 'src', 'vendor']) fs.cpSync(path.join(root, name), path.join(ext, name), { recursive: true });
const real = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
{
  const m = JSON.parse(J(real));
  m.content_scripts.find((c) => c.js.includes('src/bridge-cs.js')).matches = ['http://127.0.0.1/src/app.html*'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), J(m, null, 2));
  const d = path.join(ext, 'src', 'defaults.js'); const src = fs.readFileSync(d, 'utf8'); const line = "const WEB_APP_URL = 'https://sharpmd.app/src/app.html';";
  if (!src.includes(line)) throw new Error('defaults.js ya no tiene la dirección de la app web como se esperaba');
  fs.writeFileSync(d, src.replace(line, "const WEB_APP_URL = '" + WEB + "';"));
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-bridge-'));
// Una carpeta del disco con un .md de verdad, para el enlace que abre un archivo local.
const disk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-disk-')));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const R = await rig({ ALLOW_ORIGINS: '*', TEST_LOGIN: 'ana@example.test:246810' }) // una cuenta con código fijo: se entra varias veces seguidas sin el tope de un código cada 30 segundos;
const errors = [];
let bad = 1;
try {
  const first = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(first.url()).host; const OWN = 'chrome-extension://' + id + '/src/app.html';
  // El service worker de la extensión se duerme y vuelve: siempre se toma el que esté vivo.
  const SW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://' + id)) || ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const bg = async (fn, arg) => (await SW()).evaluate(fn, arg);
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  // La nube de verdad no se toca: apagada de los dos lados.
  await bg(() => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }));
  await ctx.addInitScript(() => { try { if (location.protocol === 'http:' && !localStorage.getItem('mdtools:settings')) localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: 'off' })); } catch (e) { /* página en blanco */ } });
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); return p; };
  const notesOf = (p) => p.evaluate(async () => Object.fromEntries((await LMD.store.notesAll()).map((n) => [n.name, n.text])));
  const sorted = (o) => J(Object.keys(o).sort().map((k) => [k, o[k]]));
  const extNotes = () => bg(async () => Object.fromEntries((await LMD.store.notesAll()).map((n) => [n.name, n.text])));
  const extRoots = () => bg(async () => (await LMD.store.rootsAll()).map((r) => ({ name: r.name, kind: r.kind, ghost: !!r.ghost, handle: !!r.handle })));
  const ask = (p, op, args) => p.evaluate(([o, a]) => new Promise((resolve) => {
    const n = 9e6 + Math.floor(Math.random() * 1e5);
    const on = (e) => { const d = e.data; if (d && d.lmdBridge === 1 && d.dir === 'res' && d.id === n) { removeEventListener('message', on); resolve(d.res); } };
    addEventListener('message', on); postMessage({ lmdBridge: 1, dir: 'req', id: n, op: o, args: a }, location.origin); setTimeout(() => resolve('timeout'), 3000);
  }), [op, args]);

  // ---------- El manifiesto publicado ----------
  console.log('Manifiesto');
  const cs = real.content_scripts.find((c) => c.js.includes('src/bridge-cs.js'));
  check('el puente solo corre en la app web de sharpmd.app', !!cs && J(cs.matches) === J(['https://sharpmd.app/src/app.html*']) && J(cs.js) === J(['src/bridge-cs.js']), cs);
  check('sin permisos nuevos ni externally_connectable', J(real.permissions) === J(['storage', 'scripting']) && J(real.host_permissions) === J(['file:///*', '*://*/*']) && !real.externally_connectable, [real.permissions, real.host_permissions]);
  check('el botón no tiene popup y el popup ya no está', !real.action.default_popup && !fs.existsSync(path.join(root, 'src', 'popup.html')) && !fs.existsSync(path.join(root, 'src', 'popup.js')));
  const hostSrc = ['bridge-sw.js', 'bridge-cs.js', 'bridge.js', 'background.js'].map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
  check('el código del puente no nombra localhost ni 127.0.0.1', !/localhost|127\.0\.0\.1/.test(hostSrc));
  const page = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8'); const shell = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  check('los archivos nuevos están en la página, en el manifiesto y en la caché sin conexión', ['bridge.js', 'install.js'].every((f) => page.includes('"' + f + '"') && shell.includes("'src/" + f + "'") && real.content_scripts.some((c) => c.js.includes('src/' + f))));
  const wm = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8')); const fh = (wm.file_handlers || [])[0] || {};
  check('la app instalada se ofrece en "Abrir con" para .md y .markdown', fh.action === 'src/app.html' && fh.action.startsWith(wm.scope) && ['.md', '.markdown'].every((e) => Object.values(fh.accept || {}).flat().includes(e)) && fh.launch_type === 'multiple-clients', fh);

  // ---------- Unión de los dos depósitos ----------
  console.log('Unión inicial');
  let extPage = watch(await ctx.newPage());
  await extPage.goto(OWN); await extPage.waitForSelector('.lmd-home');
  await extPage.evaluate(async () => {
    await LMD.store.notePut('ext-only.md', '# Only in the extension\n'); await LMD.store.notePut('same.md', '# Same on both\n'); await LMD.store.notePut('both.md', '# From the extension\n');
    // Lo que el puente no puede dejar pasar: la sesión de la nube, las copias de la nube y las carpetas protegidas.
    await LMD.store.cloudPut('who@example.test', 'secret.md', { text: 'SECRET-CLOUD-NOTE', base: 'SECRET-CLOUD-NOTE' });
    await LMD.store.vaultsPut('who@example.test', [{ folder: 'SECRET-VAULT' }]);
    await new Promise((resolve) => chrome.storage.local.set({ cloud: { session: 'SECRET-SESSION', email: 'who@example.test' } }, resolve));
  });
  // El depósito de la web, armado antes de que la app (y el puente) corran por primera vez.
  const seed = watch(await ctx.newPage());
  await seed.goto(W + '/privacy.html');
  check('fuera de la app web la extensión no deja ninguna marca', (await seed.evaluate(() => document.documentElement.dataset.lmdExt)) === undefined);
  await seed.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('lmd-permisos', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('h', { keyPath: 'key' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const t = open.result.transaction('h', 'readwrite'); const put = (name, text) => t.objectStore('h').put({ key: 'note:' + name, note: true, name, text, at: Date.now() });
      put('web-only.md', '# Only on the web\n'); put('same.md', '# Same on both\n'); put('both.md', '# From the web\n');
      t.oncomplete = () => { open.result.close(); resolve(); }; t.onerror = () => reject(t.error);
    };
  }));
  await seed.close();
  const web = watch(await ctx.newPage());
  await web.goto(WEB); await web.waitForSelector('.lmd-home');
  check('la web detecta la extensión y su versión', (await web.evaluate(() => document.documentElement.dataset.lmdExt)) === real.version);
  const want = { 'ext-only.md': '# Only in the extension\n', 'web-only.md': '# Only on the web\n', 'same.md': '# Same on both\n', 'both.md': '# From the web\n', 'both-2.md': '# From the extension\n' };
  await until(async () => Object.keys(await notesOf(web)).length === 5 && Object.keys(await extNotes()).length === 5);
  const joinedWeb = await notesOf(web); const joinedExt = await extNotes();
  check('al unirse, la web tiene las notas de los dos lados', sorted(joinedWeb) === sorted(want), joinedWeb);
  check('y la extensión las mismas: mismo nombre con distinto texto conserva los dos, uno con sufijo', sorted(joinedExt) === sorted(want), joinedExt);
  check('la lista de la web las muestra', await until(async () => (await web.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node')].map((n) => n.textContent.trim()).join('|'))).includes('both-2.md')));
  const leak = await web.evaluate(async () => ({ recs: (await LMD.store.handlesAll()).filter((r) => r.cloud || r.vaults || r.vkey).length, text: JSON.stringify(await LMD.store.handlesAll()) + JSON.stringify(Object.entries(localStorage)), cloud: localStorage.getItem('mdtools:cloud') }));
  check('la sesión de la nube, sus copias y las carpetas protegidas no cruzan', leak.recs === 0 && !/SECRET/.test(leak.text) && leak.cloud === null, { recs: leak.recs, cloud: leak.cloud });
  await web.reload(); await web.waitForSelector('.lmd-home'); await web.evaluate(() => LMD.bridge.sync());
  check('volver a abrir no duplica nada', Object.keys(await notesOf(web)).length === 5 && Object.keys(await extNotes()).length === 5, [await notesOf(web), await extNotes()]);

  // ---------- En vivo ----------
  console.log('El mismo depósito mientras se trabaja');
  await web.evaluate(() => LMD.store.notePut('live-web.md', '# Live web\n\nfirst line\n'));
  check('una nota creada en la web aparece en la extensión', !!(await until(async () => (await extNotes())['live-web.md'])));
  await web.goto(WEB + '?f=' + encodeURIComponent('local/live-web.md') + '&edit=1'); await web.waitForSelector('.lmd-article .lmd-editable');
  await typeIn(web, 'first line', ' typed on the web'); await leave(web);
  check('lo que se escribe en la web queda guardado en la extensión', !!(await until(async () => /typed on the web/.test((await extNotes())['live-web.md'] || ''))), (await extNotes())['live-web.md']);
  check('y también en la copia de la web, que es la que se abre al instante', /typed on the web/.test((await notesOf(web))['live-web.md'] || ''));
  await extPage.evaluate(() => LMD.store.notePut('live-ext.md', '# Live ext\n'));
  check('una nota creada en la extensión aparece en la web', !!(await until(async () => (await notesOf(web))['live-ext.md'])));
  check('y en su lista, sin recargar', !!(await until(() => web.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node')].some((n) => /live-ext\.md/.test(n.textContent))))));
  await extPage.evaluate(() => LMD.store.noteDelete('ext-only.md'));
  check('borrar en la extensión borra en la web', !!(await until(async () => !('ext-only.md' in (await notesOf(web))))));
  await web.evaluate(() => LMD.store.noteDelete('web-only.md'));
  check('borrar en la web borra en la extensión', !!(await until(async () => !('web-only.md' in (await extNotes())))));
  check('los dos lados siguen iguales', sorted(await notesOf(web)) === sorted(await extNotes()), [Object.keys(await notesOf(web)), Object.keys(await extNotes())]);
  // Un depósito que aparece vacío de golpe no se toma como "se borró todo".
  const kept = Object.keys(await extNotes()).length;
  await web.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('lmd-permisos', 1);
    open.onsuccess = () => { const t = open.result.transaction('h', 'readwrite'); const s = t.objectStore('h'); s.getAllKeys().onsuccess = (e) => { e.target.result.filter((k) => String(k).startsWith('note:')).forEach((k) => s.delete(k)); }; t.oncomplete = () => { open.result.close(); resolve(); }; };
  }));
  const emptied = Object.keys(await notesOf(web)).length;
  await web.evaluate(() => LMD.bridge.sync());
  check('si la copia de la web se pierde, la extensión no pierde nada y la web se vuelve a llenar', emptied === 0 && kept >= 4 && Object.keys(await extNotes()).length === kept && Object.keys(await notesOf(web)).length === kept, [emptied, kept, Object.keys(await notesOf(web)).length]);

  // ---------- Carpetas del disco ----------
  console.log('Carpetas: la lista es la misma y el permiso se da una vez por lado');
  // Una carpeta de verdad no se puede elegir sin el selector del sistema: se usa una del almacenamiento privado del origen.
  const makeDir = (p) => p.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('proj', { create: true }); const f = await d.getFileHandle('readme.md', { create: true }); const w = await f.createWritable(); await w.write('# Proj readme\n\nbody\n'); await w.close(); return true; });
  await makeDir(web);
  await web.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('proj'); await LMD.store.handlesPut({ key: 'root:webproj1', root: true, id: 'webproj1', kind: 'dir', name: 'proj', handle: d, at: Date.now(), last: 'webproj1/readme.md' }); });
  const ghost = await until(async () => (await extRoots()).find((r) => r.name === 'proj'));
  check('una carpeta abierta en la web figura en la extensión, sin permiso todavía', !!ghost && ghost.ghost && !ghost.handle && ghost.kind === 'dir', await extRoots());
  await makeDir(extPage);
  await extPage.goto(OWN); await extPage.waitForSelector('.lmd-home');
  const row = extPage.locator('a[data-ghost]', { hasText: 'proj' });
  await row.waitFor({ timeout: 8000 }).catch(() => {});
  check('y en Recientes dice que hay que reconectarla', (await row.count()) === 1 && /Reconnect/.test(await row.textContent().catch(() => '')), await extPage.evaluate(() => [...document.querySelectorAll('.lmd-recent')].map((n) => n.textContent)));
  await extPage.evaluate(() => { window.showDirectoryPicker = async (o) => { window.__picked = o; return (await navigator.storage.getDirectory()).getDirectoryHandle('proj'); }; });
  await row.click(); await extPage.waitForSelector('.lmd-dlg [data-dlg=ok], [data-dlg=ok]', { timeout: 5000 }).catch(() => {});
  const asks = await extPage.evaluate(() => { const b = document.querySelector('[data-dlg=ok]'); const box = b && b.closest('[role=dialog], .lmd-dlg') || document.body; return { ok: b ? b.textContent.trim() : '', text: box.textContent }; });
  check('al tocarla pregunta con un diálogo propio', asks.ok === 'Choose folder' && /Reconnect "proj"/.test(asks.text) && /opened from the other side/.test(asks.text), asks.ok);
  await extPage.click('[data-dlg=ok]'); await extPage.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  const picked = await extPage.evaluate(() => window.__picked || null);
  check('abre el selector con id y carpeta de arranque', !!picked && /^lmd-r-[a-z0-9]{4,}$/.test(picked.id) && picked.id.length <= 32 && picked.startIn === 'documents' && picked.mode === 'readwrite', picked);
  check('y queda abierta en la nota en la que estaba del otro lado', (await extPage.textContent('.markdown-body h1').catch(() => '')).startsWith('Proj readme') && /readme\.md/.test(decodeURIComponent(extPage.url())), extPage.url());
  const after = (await extRoots()).filter((r) => r.name === 'proj');
  check('ya es una carpeta de este lado: un solo renglón, con permiso', after.length === 1 && !after[0].ghost && after[0].handle, after);
  await extPage.goto(OWN); await extPage.waitForSelector('.lmd-xroot');
  check('una vez por carpeta: no vuelve a pedirla', (await extPage.locator('a[data-ghost]').count()) === 0);
  await web.evaluate(() => LMD.bridge.sync());
  const webRoots = await web.evaluate(async () => (await LMD.store.rootsAll()).map((r) => ({ name: r.name, ghost: !!r.ghost, handle: !!r.handle })));
  check('la web conserva la suya', J(webRoots) === J([{ name: 'proj', ghost: false, handle: true }]), webRoots);
  await web.evaluate(() => LMD.store.handlesDelete('root:webproj1'));
  check('quitarla de la lista en un lado la quita del otro', !!(await until(async () => !(await extRoots()).some((r) => r.name === 'proj'))), await extRoots());

  // ---------- Preferencias ----------
  console.log('Preferencias');
  await web.evaluate(() => LMD.patch({ theme: 'light', customCSS: 'body { outline: 0 }', supporter: true }));
  const extSet = await until(async () => { const s = await bg(() => LMD.load()); return s.theme === 'light' ? s : null; });
  check('el tema elegido en la web llega a la extensión', !!extSet);
  check('el CSS propio, el plan y el servidor quedan de cada lado', !!extSet && extSet.customCSS === '' && extSet.supporter === false && extSet.cloudUrl === 'off', extSet && [extSet.customCSS, extSet.supporter, extSet.cloudUrl]);
  await extPage.evaluate(() => LMD.patch({ fontSize: 19 }));
  check('el tamaño de letra elegido en la extensión llega a la web', !!(await until(async () => (await web.evaluate(() => LMD.load())).fontSize === 19)));
  check('y la web conserva lo suyo', (await web.evaluate(() => LMD.load())).customCSS === 'body { outline: 0 }');
  await web.evaluate(() => LMD.patch({ customCSS: '', supporter: false }));

  // ---------- Ajustes > Instalar ----------
  console.log('Ajustes > Instalar');
  const openInst = async (p) => { await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=inst]'); await p.waitForSelector('[data-inst-pane] h4'); await p.waitForTimeout(200); };
  const paneOf = (p) => p.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); const body = document.querySelector('.lmd-panel-body'); return { heads: [...box.querySelectorAll('h4')].map((h) => h.textContent), text: box.textContent, radios: [...box.querySelectorAll('input[name=lmd-open-in]')].map((i) => i.value + (i.checked ? '*' : '')), opts: [...box.querySelectorAll('.lmd-inst-opt')].map((l) => l.textContent.trim()), links: [...box.querySelectorAll('a')].map((a) => a.textContent.trim() + ' ' + a.href), buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()), wide: body.scrollWidth - body.clientWidth, tall: body.scrollHeight - body.clientHeight }; });
  await web.goto(WEB); await web.waitForSelector('.lmd-home'); await web.evaluate(() => LMD.bridge.sync());
  await openInst(web);
  const wp = await paneOf(web);
  check('en la web con la extensión: dónde abrir, la extensión instalada, la app y el doble clic', J(wp.heads) === J(['Open SharpMD in', 'Chrome extension', 'Install as an app', 'Open .md files with a double click']) && wp.text.includes('Installed, version ' + real.version), wp.heads);
  check('las dos opciones, con la web elegida y su texto', J(wp.radios) === J(['web*', 'ext']) && wp.opts[0] === 'Web app (recommended). Offline it opens in the extension, with the same notes.' && wp.opts[1] === 'The extension', wp.opts);
  check('sin renglón de Android mientras no haya dirección, sin signos de admiración ni rayas', !/Android/.test(wp.text) && !/[!¡—–]/.test(wp.text) && wp.wide <= 0 && wp.tall <= 0, [wp.wide, wp.tall]);
  await web.click('input[name=lmd-open-in][value=ext]');
  check('elegir "La extensión" en la web cambia la preferencia de la extensión', !!(await until(async () => (await bg(() => LMD.load())).openIn === 'ext')));
  await web.click('[data-act=close-panel]');
  await extPage.goto(OWN); await extPage.waitForSelector('.lmd-home'); await openInst(extPage);
  const ep = await paneOf(extPage);
  check('en la extensión: la opción elegida, "Esta extensión" y la app se instala desde la web', J(ep.radios) === J(['web', 'ext*']) && ep.opts[1] === 'This extension' && /It installs from the web app\./.test(ep.text) && ep.links.some((l) => l === 'Open the web app ' + WEB) && ep.tall <= 0, ep);
  // El segundo paso depende de si este navegador ya le dio a la extensión el acceso a archivos.
  const fileAccess = await bg(() => chrome.extension.isAllowedFileSchemeAccess());
  const second = fileAccess ? /File access is already on\./.test(ep.text) && !ep.buttons.includes('Extension details') : /Allow access to file URLs/.test(ep.text) && ep.buttons.includes('Extension details');
  check('el doble clic: los pasos, el acceso a archivos y la ayuda', /Right-click a \.md file, Open with, Choose another app, Chrome, Always\./.test(ep.text) && second && ep.links.some((l) => /^Help .*#faq$/.test(l)), [fileAccess, ep.buttons, ep.links]);
  await extPage.click('input[name=lmd-open-in][value=web]');
  check('y volver a "App web" desde la extensión llega a la web', !!(await until(async () => (await web.evaluate(() => LMD.load())).openIn === 'web')));
  await extPage.click('[data-act=close-panel]');

  // ---------- Qué acepta el puente ----------
  console.log('Seguridad del puente');
  const refused = [await ask(web, 'cloud.get', {}), await ask(web, 'storage.get', { key: 'cloud' }), await ask(web, '__proto__', {}), await ask(web, 'constructor', {}), await ask(web, 'toString', {})];
  check('un pedido que no está en la lista se rechaza', refused.every((r) => r && r.ok === false && r.error === 'refused'), refused);
  const shapes = [await ask(web, 'notes.put', { name: '../up.md', text: 'x' }), await ask(web, 'notes.put', { name: 'a.md', text: 5 }), await ask(web, 'notes.put', { name: 'a.md' }), await ask(web, 'notes.put', { name: '', text: 'x' }), await ask(web, 'notes.get', { name: { a: 1 } }),
    await ask(web, 'notes.del', { name: 'a/b.md' }), await ask(web, 'roots.put', { kind: 'cloud', name: 'x', at: 1 }), await ask(web, 'roots.put', { kind: 'dir', name: 'x', at: 'ayer' }), await ask(web, 'notes.put', 'texto')];
  check('un pedido con otra forma se rechaza', shapes.every((r) => r && r.ok === false && r.error === 'shape'), shapes);
  check('y nada de eso quedó guardado', !Object.keys(await extNotes()).some((n) => /^a\.md$|up\.md/.test(n)) && !(await extRoots()).some((r) => r.name === 'x'));
  const list = await ask(web, 'notes.list', {});
  check('la lista de notas solo trae nombre, fecha y huella', list.ok && list.list.length > 0 && list.list.every((n) => J(Object.keys(n).sort()) === J(['at', 'h', 'name'])), list.list && list.list[0]);
  const rl = await ask(web, 'roots.list', {});
  check('la de carpetas no trae permisos ni identificadores', rl.ok && rl.list.every((r) => J(Object.keys(r).sort()) === J(['at', 'here', 'kind', 'last', 'name'])), rl.list);
  await ask(web, 'prefs.set', { patch: { cloudUrl: 'https://evil.example', customCSS: '* { display: none }', supporter: true, enabled: false, openIn: 'otra', fontSize: 'grande', plugins: { html: 'si', inventado: true }, theme: 'dark' } });
  const guarded = await bg(() => LMD.load());
  check('de las preferencias solo pasan las de la lista, con su tipo', guarded.cloudUrl === 'off' && guarded.customCSS === '' && guarded.supporter === false && guarded.enabled === true && guarded.openIn === 'web' && guarded.fontSize === 19 && guarded.plugins.html === true && !('inventado' in guarded.plugins) && guarded.theme === 'dark', [guarded.cloudUrl, guarded.openIn, guarded.fontSize, guarded.theme]);
  const prefs = await ask(web, 'prefs.get', {});
  check('y al leerlas tampoco salen el servidor, el plan ni el CSS propio', prefs.ok && !('cloudUrl' in prefs.prefs) && !('supporter' in prefs.prefs) && !('customCSS' in prefs.prefs) && 'theme' in prefs.prefs, Object.keys(prefs.prefs || {}));
  // Otro origen (el mismo sitio en otro puerto): aunque llegara a correr el script de contenido, el service worker no le contesta.
  const stranger = watch(await ctx.newPage());
  await stranger.goto(OTHER); await stranger.waitForSelector('.lmd-home');
  const fromOther = [await ask(stranger, 'notes.list', {}), await ask(stranger, 'hello', {}), await ask(stranger, 'notes.put', { name: 'intruso.md', text: 'x' })];
  check('otro origen no recibe nada', fromOther.every((r) => r && r.ok === false) && !('intruso.md' in (await extNotes())), fromOther);
  check('y sigue con su propio depósito', (await stranger.evaluate(() => LMD.bridge.present())) === false && Object.keys(await notesOf(stranger)).length === 0);
  await stranger.close();
  const fromOwn = await extPage.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'bridge', op: 'notes.list', args: {} }, resolve)));
  check('una página de la extensión no pasa por el puente', fromOwn && fromOwn.ok === false && fromOwn.error === 'refused', fromOwn);

  // ---------- Un enlace https que abre un archivo del disco ----------
  console.log('Un enlace que abre un archivo del disco');
  const diskFile = path.join(disk, 'my notes.md'); fs.writeFileSync(diskFile, '# Local note\n\nfrom the disk, SECRET-DISK-TEXT\n');
  fs.writeFileSync(path.join(disk, 'other.md'), '# Other\n');
  const fileAt = pathToFileURL(diskFile).href; const linkTo = (base, target) => base + '#open=' + encodeURIComponent(target);
  const dlg = (p) => p.evaluate(() => {
    const c = document.querySelector('.lmd-dlg-card'); if (!c) return null; const code = c.querySelector('.lmd-dlg-path code'); const a = c.querySelector('.lmd-dlg-link a');
    return { title: c.querySelector('h3').textContent, text: [...c.querySelectorAll('p')].map((x) => x.textContent.trim()).join(' | '), path: code ? code.textContent : null, kids: code ? code.children.length : -1, buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent), link: a ? a.textContent + ' ' + a.href : '', copy: (c.querySelector('[data-dlg-copy]') || {}).textContent || '', all: c.textContent };
  }).catch(() => null);
  const gone = (p) => p.waitForSelector('.lmd-dlg-card', { state: 'detached', timeout: 4000 }).catch(() => {});
  // La app web solo recibe archivos de carpetas que la persona ya abrió con la extensión. La pregunta la dibuja la
  // página, así que la que decide es la extensión, con su propia lista.
  const wf = () => bg(() => chrome.storage.local.get('webFiles').then((r) => r.webFiles || null));
  const urlOf = (...p) => pathToFileURL(path.join(...p)).href;
  const REFUSED = J({ ok: true, opened: false, why: 'refused' });
  const disk2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-out-'))); fs.writeFileSync(path.join(disk2, 'out.md'), '# Outside\n\nSECRET-OUTSIDE\n');
  fs.mkdirSync(path.join(disk, 'sub')); fs.writeFileSync(path.join(disk, 'sub', 'deep.md'), '# Deep\n'); fs.writeFileSync(path.join(disk, 'plain.txt'), 'plain'); fs.writeFileSync(path.join(disk, 'page.html'), '<p>x</p>');
  const openInReader = async (url) => { const p = watch(await ctx.newPage()); await p.goto(url); await p.waitForSelector('.markdown-body h1'); const w = await until(async () => { const x = await wf(); return x && x.roots.length ? x : null; }); await p.close(); return w; };
  const never = [await ask(web, 'file.read', { url: fileAt }), await ask(web, 'file.read', { url: urlOf(disk, 'gone.md') })];
  check('antes de abrir nada con la extensión, la web no recibe ningún archivo, exista o no', J(never[0]) === REFUSED && J(never[1]) === REFUSED && (await wf()) === null, never);
  const listed = await openInReader(fileAt);
  check('abrir un archivo en el lector anota su carpeta en la extensión', !!listed && listed.off === false && listed.roots.length === 1 && listed.roots[0].dir === true && listed.roots[0].url.toLowerCase() === (pathToFileURL(disk).href + '/').toLowerCase(), listed);
  check('y la web no ve esa lista', !/sharpmd-disk-/.test(await web.evaluate(() => JSON.stringify(Object.entries(localStorage)))) && (await ask(web, 'files.list', {})).error === 'refused');
  const flip = fileAt.replace(/^file:\/\/\/([A-Za-z]):/, (m, d) => 'file:///' + (d === d.toUpperCase() ? d.toLowerCase() : d.toUpperCase()) + ':');
  const inRead = [await ask(web, 'file.read', { url: flip }), await ask(web, 'file.read', { url: urlOf(disk, 'sub', 'deep.md') })];
  check('un archivo de esa carpeta o de una subcarpeta se entrega, con la unidad en mayúscula o en minúscula', inRead.every((r) => r && r.ok && r.opened === true) && /SECRET-DISK-TEXT/.test(inRead[0].text) && inRead[0].name === 'my notes.md' && inRead[1].name === 'deep.md' && J(Object.keys(inRead[0]).sort()) === J(['name', 'ok', 'opened', 'text']), inRead.map((r) => [r.opened, r.why, r.name]));
  const outside = [urlOf(disk2, 'out.md'), urlOf(disk2, 'nope.md'), urlOf(path.dirname(disk), 'up.md'), pathToFileURL(disk).href + '-more/x.md', pathToFileURL(disk).href + '.md'];
  const outRead = []; for (const u of outside) outRead.push(await ask(web, 'file.read', { url: u }));
  check('fuera de esa carpeta la respuesta es la misma para un archivo que existe y para uno que no', outRead.every((r) => J(r) === REFUSED) && !/SECRET-OUTSIDE/.test(J(outRead)), outRead);
  const base2 = pathToFileURL(disk).href; const to2 = path.basename(disk2) + '/out.md';
  const escapes = [base2 + '/../' + to2, base2 + '/sub/../../' + to2, base2 + '/%2e%2e/' + to2, base2 + '/%2E%2E/' + to2, base2 + '/..%2F' + to2, base2 + '/..%5C' + to2.replace('/', '%5C'), base2 + '/sub/%2e%2e%2f%2e%2e%2f' + to2, base2 + '/./../' + to2, base2 + '//' + to2];
  const escRead = []; for (const u of escapes) escRead.push(await ask(web, 'file.read', { url: u }));
  check('".." y sus variantes codificadas no salen de la carpeta', escRead.every((r) => r && r.opened !== true && !('text' in r)) && !/SECRET-OUTSIDE/.test(J(escRead)), escRead);
  const types = [await ask(web, 'file.read', { url: urlOf(disk, 'plain.txt') }), await ask(web, 'file.read', { url: urlOf(disk, 'page.html') }), await ask(web, 'file.read', { url: 'file://server/share/a.md' }), await ask(web, 'file.read', { url: base2 + '/' })];
  check('un tipo que no es Markdown, una carpeta o una unidad de red no se entregan', types.every((r) => r && r.ok === false && r.error === 'shape'), types);
  // Quién puede sumar carpetas: solo el lector de esta extensión sobre un file://, con la dirección que da el navegador.
  const tell = (sender, msg) => bg(([s, m]) => new Promise((resolve) => LMD.bridgeHost.onSeen(m || {}, Object.assign({ id: chrome.runtime.id, tab: { id: 1 }, frameId: 0 }, s), resolve)), [sender, msg || null]);
  const told = [await tell({ url: 'https://evil.example/notes/a.md' }, { url: urlOf(disk2, 'out.md') }), await tell({ url: WEB }), await tell({ url: urlOf(disk2, 'out.md'), frameId: 1 }), await tell({ url: urlOf(disk2, 'out.md'), id: 'otra' }), await tell({ url: 'file://server/share/a.md' })];
  const fromWeb = [await ask(web, 'file.seen', { url: urlOf(disk2, 'out.md') }), await ask(web, 'files.add', { url: urlOf(disk2, 'out.md') }), await ask(web, 'prefs.set', { patch: { webFiles: { off: false, roots: [{ url: pathToFileURL(disk2).href + '/', dir: true }] } } })];
  check('un sitio, la app web o un marco no pueden sumar carpetas a la lista', told.every((r) => r && r.ok === false) && fromWeb.slice(0, 2).every((r) => r && r.ok === false && r.error === 'refused') && (await wf()).roots.length === 1 && J(await ask(web, 'file.read', { url: urlOf(disk2, 'out.md') })) === REFUSED, [told, fromWeb]);
  // Un archivo abierto muy arriba (la carpeta personal, la raíz de una unidad) habilita solo ese archivo.
  await tell({ url: 'file:///C:/Users/someone/top.md' });
  const high = (await wf()).roots.find((r) => /top\.md$/.test(r.url));
  check('una carpeta muy arriba no entra entera: vale solo el archivo abierto', !!high && high.dir === false && J(await ask(web, 'file.read', { url: 'file:///C:/Users/someone/Documents/taxes.md' })) === REFUSED && J(await ask(web, 'file.read', { url: 'file:///C:/Users/someone/other.md' })) === REFUSED, high);
  // Ajustes > Instalar, en la extensión: la lista a la vista, vaciarla, y apagar la lectura del todo.
  await openInst(extPage);
  const filesPane = () => extPage.evaluate(() => { const b = document.querySelector('[data-inst-files]'); return b ? { head: b.previousElementSibling.textContent, rows: [...b.querySelectorAll('.lmd-inst-files li')].map((li) => li.textContent), kids: b.querySelectorAll('.lmd-inst-files li *').length, on: b.querySelector('[data-inst=web-files]').checked, label: b.querySelector('label').textContent, clear: (b.querySelector('[data-inst=files-clear]') || {}).textContent || '', none: !!b.querySelector('[data-inst-none]'), all: b.textContent } : null; });
  const fp = await filesPane();
  check('Ajustes > Instalar muestra de qué carpetas puede abrir archivos la web, con su interruptor y el botón de vaciar', !!fp && fp.head === 'Folders the web app can open files from' && fp.rows.length === 2 && fp.rows.some((r) => r.toLowerCase() === (disk + path.sep).toLowerCase()) && fp.kids === 0 && fp.on === true && fp.label === 'The web app can open files from your disk through the extension' && fp.clear === 'Clear the list' && !/[!¡—–]/.test(fp.all), fp);
  await openInst(web).catch(() => {});
  check('en la web esa sección no está: se maneja solo desde la extensión', (await web.evaluate(() => !document.querySelector('[data-inst-files]') && !document.querySelector('[data-inst=web-files]'))) === true);
  await web.click('[data-act=close-panel]').catch(() => {});
  await extPage.click('[data-inst=web-files]'); await until(async () => (await wf()).off === true);
  const offRead = [await ask(web, 'file.read', { url: fileAt }), await ask(web, 'file.read', { url: urlOf(disk, 'gone.md') })];
  check('con el interruptor apagado la web no recibe nada, ni de una carpeta de la lista', (await wf()).off === true && (await wf()).roots.length === 2 && offRead.every((r) => J(r) === REFUSED), offRead);
  await extPage.waitForSelector('[data-inst=web-files]'); await extPage.click('[data-inst=web-files]'); await until(async () => (await wf()).off === false);
  // Que prendido vuelve a entregar lo prueba el enlace de más abajo, que lee un archivo de esta carpeta (los pedidos atendidos tienen un tope por minuto).
  await extPage.waitForSelector('[data-inst=files-clear]'); await extPage.click('[data-inst=files-clear]'); await until(async () => (await wf()).roots.length === 0);
  await extPage.waitForSelector('[data-inst-none]', { timeout: 4000 }).catch(() => {});
  const cleared = await filesPane();
  check('vaciar la lista la deja vacía, y la web vuelve a no recibir nada', !!cleared && cleared.rows.length === 0 && cleared.none && cleared.clear === '' && J(await ask(web, 'file.read', { url: fileAt })) === REFUSED, cleared);
  await extPage.click('[data-act=close-panel]');
  // Un enlace a un archivo fuera de la lista: la web cae al respaldo, con el selector.
  const lo = watch(await ctx.newPage());
  await lo.goto(linkTo(WEB, fileAt)); await lo.waitForSelector('.lmd-dlg-card'); await lo.click('.lmd-dlg-card [data-dlg=ok]');
  await lo.waitForFunction(() => /only opens/.test((document.querySelector('.lmd-dlg-card p') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const dOut = await dlg(lo);
  check('un enlace a un archivo fuera de la lista ofrece elegirlo a mano, sin mostrar nada de él', lo.url() === WEB && !!dOut && dOut.title === 'Open this file from your disk?' && dOut.text.startsWith('By link, the extension only opens what is in folders you already opened with it. Pick the file.') && dOut.path === diskFile && J(dOut.buttons) === J(['Cancel', 'Open']) && !/SECRET-DISK-TEXT/.test(await lo.evaluate(() => document.body.textContent)) && !/[!¡—–]/.test(dOut.all), dOut);
  await lo.close();
  // Lo que sigue abre por enlace archivos de esta carpeta: la persona la abre una vez con la extensión.
  await openInReader(fileAt);
  const lk = watch(await ctx.newPage());
  await lk.goto(linkTo(WEB, fileAt)); await lk.waitForSelector('.lmd-dlg-card');
  const d1 = await dlg(lk);
  check('el fragmento desaparece de la barra de direcciones', lk.url() === WEB && await lk.evaluate(() => location.hash === ''), lk.url());
  check('pregunta antes, con la ruta legible y dos botones', !!d1 && d1.title === 'Open this file from your disk?' && d1.path === diskFile && J(d1.buttons) === J(['Cancel', 'Open']) && d1.copy === 'Copy path' && !/[!¡—–]/.test(d1.all), d1);
  await lk.waitForTimeout(900);
  check('sin el clic no se navega', lk.url() === WEB && !!(await dlg(lk)));
  await lk.keyboard.press('Escape'); await gone(lk); await lk.waitForTimeout(500);
  check('al cancelar tampoco', lk.url() === WEB && !(await dlg(lk)));
  // Con la app ya abierta en la pestaña el enlace solo cambia el fragmento: se atiende igual. Y vale la ruta del sistema.
  await lk.goto(linkTo(WEB, diskFile)); await lk.waitForSelector('.lmd-dlg-card');
  const d2 = await dlg(lk);
  check('con la app ya abierta y la ruta del sistema tal cual, pregunta lo mismo', lk.url() === WEB && !!d2 && d2.path === diskFile && d2.title === d1.title, [lk.url(), d2]);
  const tabsWas = ctx.pages().length;
  await lk.click('.lmd-dlg-card [data-dlg=ok]');
  await lk.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  await lk.waitForFunction(() => /Opened as a copy/.test(document.body.textContent), null, { timeout: 4000 }).catch(() => {});
  const inApp = await lk.evaluate(() => ({ at: location.href.split('?')[0], f: new URLSearchParams(location.search).get('f'), h1: (document.querySelector('.markdown-body h1') || {}).textContent || '', body: (document.querySelector('.markdown-body') || {}).textContent || '', note: /Opened as a copy\. The file on your disk is not changed\./.test(document.body.textContent), dlg: !!document.querySelector('.lmd-dlg-card') }));
  check('con el clic, el archivo se muestra dentro de la app web, leído por el puente', inApp.at === WEB && inApp.f === 'mem/my%20notes.md' && inApp.h1.startsWith('Local note') && /SECRET-DISK-TEXT/.test(inApp.body) && !inApp.dlg, inApp);
  check('como copia, y lo dice', inApp.note, inApp);
  check('sin abrir otra pestaña ni llevar ninguna a un file://', ctx.pages().length === tabsWas && !ctx.pages().some((p) => p.url().startsWith('file:')), ctx.pages().map((p) => p.url()));
  const webSide = await web.evaluate(async () => ({ notes: JSON.stringify(await LMD.store.notesAll()), roots: (await LMD.store.rootsAll()).map((r) => r.name) }));
  check('la copia no queda entre las notas del navegador ni en la lista de abiertos', !/SECRET-DISK-TEXT/.test(J(webSide)) && !/my notes/.test(J(webSide)), webSide.roots);
  // Con "Abrir SharpMD en: la extensión", el mismo enlace lo muestra el lector de la extensión, en esta misma pestaña.
  await bg(() => LMD.patch({ openIn: 'ext' })); await until(() => web.evaluate(async () => (await LMD.load()).openIn === 'ext'));
  await lk.goto(linkTo(WEB, fileAt)); await lk.waitForSelector('.lmd-dlg-card'); await lk.click('.lmd-dlg-card [data-dlg=ok]');
  await lk.waitForURL((u) => u.protocol === 'file:', { timeout: 8000 }).catch(() => {});
  await lk.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  check('con "abrir en la extensión" elegido, esta pestaña pasa al archivo y lo muestra el lector, sin otra pestaña', lk.url() === fileAt && (await lk.textContent('.markdown-body h1').catch(() => '')).startsWith('Local note') && ctx.pages().length === tabsWas, [lk.url(), ctx.pages().length, tabsWas]);
  await bg(() => LMD.patch({ openIn: 'web' })); await until(() => web.evaluate(async () => (await LMD.load()).openIn === 'web'));

  // El ayudante: en el archivo abierto, el menú Copiar y el clic derecho del explorador dan ese mismo enlace.
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const clip = async (p) => { await p.bringToFront(); return p.evaluate(() => navigator.clipboard.readText()).catch((e) => 'sin portapapeles: ' + e.message); };
  await lk.bringToFront(); await lk.click('[data-act=copy]'); await lk.waitForSelector('.lmd-menu-copy');
  const copyItems = await lk.evaluate(() => [...document.querySelectorAll('.lmd-menu-copy button')].map((b) => b.textContent.trim()));
  await lk.click('.lmd-menu-copy [data-more=copy-flink]'); await lk.waitForTimeout(300);
  check('el menú Copiar ofrece el enlace a este archivo y copia el https', copyItems.includes('Copy link to this file') && (await clip(lk)) === linkTo(WEB, fileAt), [copyItems, await clip(lk)]);
  const sibling = lk.locator('.lmd-tree-box .lmd-node:not(.lmd-node-dir)', { hasText: 'other.md' });
  await sibling.waitFor({ timeout: 8000 }).catch(() => {});
  await sibling.click({ button: 'right' }).catch(() => {}); await lk.waitForSelector('.lmd-menu-narrow [data-f=flink]', { timeout: 4000 }).catch(() => {});
  const treeItems = await lk.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.textContent.trim()));
  await lk.click('.lmd-menu [data-f=flink]').catch(() => {}); await lk.waitForTimeout(300);
  check('y el clic derecho sobre un archivo del explorador, el de ese archivo', J(treeItems) === J(['Copy link to this file']) && (await clip(lk)) === linkTo(WEB, pathToFileURL(path.join(disk, 'other.md')).href), [treeItems, await clip(lk)]);
  await lk.close();

  // Un archivo que no está, y un nombre que quiere ser HTML: la ruta se muestra siempre como texto.
  const evil = path.join(disk, '<img src=x onerror=window.__pwn=1>.md');
  const lm = watch(await ctx.newPage());
  await lm.goto(linkTo(WEB, pathToFileURL(evil).href)); await lm.waitForSelector('.lmd-dlg-card');
  const d3 = await dlg(lm);
  check('un nombre con HTML se muestra como texto', !!d3 && d3.path === evil && d3.kids === 0 && await lm.evaluate(() => window.__pwn === undefined && !document.querySelector('.lmd-dlg-card img')), d3);
  await lm.click('.lmd-dlg-card [data-dlg=ok]'); await lm.waitForFunction(() => /not found/.test((document.querySelector('.lmd-dlg-card h3') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const d4 = await dlg(lm);
  check('si el archivo no existe lo dice, con la ruta y el botón que abre el selector, sin salir de la app', lm.url() === WEB && !!d4 && d4.title === 'File not found' && d4.text.startsWith('It may have been moved or renamed.') && d4.path === evil && d4.kids === 0 && J(d4.buttons) === J(['Close', 'Open']) && await lm.evaluate(() => window.__pwn === undefined), d4);
  await lm.keyboard.press('Escape'); await gone(lm);
  // Sin "Permitir acceso a URL de archivo": Chrome no deja, y la app dice cómo activarlo.
  await bg(() => { self.__allowed = chrome.extension.isAllowedFileSchemeAccess; chrome.extension.isAllowedFileSchemeAccess = async () => false; });
  const stubbed = await bg(() => chrome.extension.isAllowedFileSchemeAccess());
  await lm.goto(linkTo(WEB, fileAt)); await lm.waitForSelector('.lmd-dlg-card'); await lm.click('.lmd-dlg-card [data-dlg=ok]');
  await lm.waitForFunction(() => /access/.test((document.querySelector('.lmd-dlg-card h3') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const d5 = await dlg(lm);
  check('sin el acceso a archivos lo dice, con la ruta, el selector y el camino a los detalles de la extensión', stubbed === false && lm.url() === WEB && !!d5 && d5.title === 'File access is off' && d5.text.startsWith('The extension has no file access. Pick the file, or turn access on.') && /Extension details$/.test(d5.text) && d5.path === diskFile && J(d5.buttons) === J(['Close', 'Open']) && !/[!¡—–]/.test(d5.all), d5);
  const tabs = ctx.pages().length;
  await lm.click('.lmd-dlg-card [data-dlg-more]');
  const details = await until(() => ctx.pages().find((p) => p.url().startsWith('chrome://extensions')), 6000);
  check('y el enlace abre los detalles de esta extensión', !!details && details.url() === 'chrome://extensions/?id=' + id && ctx.pages().length === tabs + 1, ctx.pages().map((p) => p.url()));
  if (details) await details.close();
  await bg(() => { if (self.__allowed) chrome.extension.isAllowedFileSchemeAccess = self.__allowed; });

  // Lo que el service worker rechaza, pida quien pida.
  const badUrls = ['javascript:alert(1)//a.md', 'data:text/html,<script>alert(1)</script>.md', 'chrome://extensions/a.md', 'chrome-extension://' + id + '/src/app.html?a.md', 'http://127.0.0.1:' + PORT + '/README.md', 'https://example.com/a.md', 'blob:' + W + '/a.md', 'view-source:' + fileAt, 'FILE:///C:/a.md', 'file://server/share/a.md', 'file:////server/share/a.md',
    fileAt.replace(/\.md$/, '.html'), fileAt.replace(/\.md$/, '.exe'), fileAt.replace(/\.md$/, '.js'), fileAt.replace(/\.md$/, ''), fileAt + '/', fileAt + '?x=1', fileAt + '#frag', fileAt.replace(/\.md$/, '.md.html'),
    fileAt.replace(/my%20notes/, '../my%20notes'), fileAt.replace(/my%20notes/, '%2e%2e/my%20notes'), fileAt.replace(/my%20notes/, '..%5Cmy%20notes'), fileAt.replace(/my%20notes/, 'a%0Ab'), fileAt.replace(/my%20notes/, 'a\nb'), fileAt.replace(/my%20notes/, 'a%00b'), fileAt.replace(/my%20notes/, 'a'.repeat(3000)), diskFile, ' ' + fileAt, ''];
  const badRes = []; for (const u of badUrls) badRes.push(await ask(web, 'file.open', { url: u }));
  const shapeless = [await ask(web, 'file.open', {}), await ask(web, 'file.open', { url: 5 }), await ask(web, 'file.open', { url: [fileAt] }), await ask(web, 'file.open', { url: { href: fileAt } }), await ask(web, 'file.open', fileAt)];
  check('otros esquemas, otras extensiones, "..", saltos, rutas de red y rutas enormes se rechazan', badRes.concat(shapeless).every((r) => r && r.ok === false && r.error === 'shape') && web.url() === WEB, badUrls.filter((u, i) => !(badRes[i] && badRes[i].ok === false && badRes[i].error === 'shape')).map((u) => u.slice(0, 80)));
  const badRead = []; for (const u of badUrls) badRead.push(await ask(web, 'file.read', { url: u }));
  check('leer un archivo valida lo mismo que abrirlo', badRead.every((r) => r && r.ok === false && r.error === 'shape'), badUrls.filter((u, k) => !(badRead[k] && badRead[k].ok === false && badRead[k].error === 'shape')).map((u) => u.slice(0, 80)));
  const miss = await ask(web, 'file.open', { url: pathToFileURL(path.join(disk, 'gone.md')).href });
  check('la respuesta solo dice si se abrió y por qué no', J(miss) === J({ ok: true, opened: false, why: 'missing' }) && web.url() === WEB, miss);
  // Otro origen, un marco dentro de la app, y la app dentro de un marco.
  const out = watch(await ctx.newPage());
  await out.goto(OTHER); await out.waitForSelector('.lmd-home');
  const outAsk = [await ask(out, 'file.open', { url: fileAt }), await ask(out, 'file.setup', {}), await ask(out, 'file.read', { url: fileAt })];
  await out.goto(linkTo(OTHER, fileAt)); await out.waitForSelector('.lmd-dlg-card');
  const d6 = await dlg(out);
  check('otro origen no puede pedirlo: su enlace cae en el aviso de sin extensión', outAsk.every((r) => r === 'timeout' || (r && r.ok === false)) && out.url() === OTHER && !!d6 && J(d6.buttons) === J(['Cancel', 'Open']) && !ctx.pages().some((p) => p.url().startsWith('chrome://extensions')), [outAsk, d6]);
  await out.close();
  const inner = await web.evaluate(() => new Promise((resolve) => { const f = document.createElement('iframe'); f.id = 'intruso'; f.onload = () => resolve(true); document.body.appendChild(f); setTimeout(() => resolve(false), 1500); }));
  const frame = web.frames().find((f) => f !== web.mainFrame());
  const heard = web.evaluate(() => new Promise((resolve) => { const on = (e) => { const d = e.data; if (d && d.lmdBridge === 1 && d.dir === 'res' && d.id === 777001) { removeEventListener('message', on); resolve(d.res); } }; addEventListener('message', on); setTimeout(() => resolve('silencio'), 1800); }));
  if (frame) await frame.evaluate((u) => { parent.postMessage({ lmdBridge: 1, dir: 'req', id: 777001, op: 'file.open', args: { url: u } }, '*'); }, fileAt);
  check('un marco dentro de la app no puede pedirlo', !!frame && (await heard) === 'silencio' && web.url() === WEB, [inner, !!frame]);
  await web.evaluate(() => { const f = document.getElementById('intruso'); if (f) f.remove(); });
  const host = watch(await ctx.newPage());
  await host.goto(W + '/privacy.html');
  await host.evaluate((src) => new Promise((resolve) => { const f = document.createElement('iframe'); f.src = src; f.onload = () => resolve(); document.body.appendChild(f); setTimeout(resolve, 5000); }), linkTo(WEB, fileAt));
  const framed = host.frames().find((f) => f !== host.mainFrame());
  const framedState = framed ? await framed.evaluate(() => ({ mark: document.documentElement.dataset.lmdExt, can: !!(window.LMD && LMD.bridge && LMD.bridge.canOpen()) })).catch(() => ({ blocked: true })) : { none: true };
  const framedAsk = framed ? await ask(framed, 'file.open', { url: fileAt }).catch(() => 'timeout') : 'timeout';
  check('la app dentro de un marco no tiene puente', framedState.mark === undefined && !framedState.can && framedAsk === 'timeout' && host.url() === W + '/privacy.html', [framedState, framedAsk]);
  await host.close();

  // La app como página de la extensión: el mismo enlace, navegando directo.
  const op = watch(await ctx.newPage());
  await op.goto(linkTo(OWN, fileAt)); await op.waitForSelector('.lmd-dlg-card');
  const d7 = await dlg(op);
  const ownBad = await op.evaluate((u) => Promise.all(u.map((url) => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'openFile', url }, resolve)))), ['javascript:alert(1)//a.md', fileAt.replace(/\.md$/, '.html'), 'https://example.com/a.md']);
  check('en la página de la extensión pregunta igual y valida igual', op.url() === OWN && !!d7 && d7.title === 'Open this file from your disk?' && d7.path === diskFile && ownBad.every((r) => r && r.ok === false && r.error === 'shape'), [d7, ownBad]);
  await op.click('.lmd-dlg-card [data-dlg=ok]');
  await op.waitForURL((u) => u.protocol === 'file:', { timeout: 8000 }).catch(() => {});
  await op.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  check('y con el clic abre el archivo', op.url() === fileAt && (await op.textContent('.markdown-body h1').catch(() => '')).startsWith('Local note'), op.url());
  const fromFile = await op.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage);
  check('la página del archivo no tiene cómo pedirle nada a la extensión', fromFile === true);
  await op.close();
  // El tope: muchos pedidos seguidos dejan de atenderse.
  const burst = []; for (let i = 0; i < 14; i++) burst.push(await ask(web, 'file.open', { url: pathToFileURL(path.join(disk, 'gone-' + i + '.md')).href }));
  const capped = await ask(web, 'file.open', { url: fileAt });
  check('hay un tope de pedidos: pasado, ni un archivo que existe se abre', burst.some((r) => r && r.why === 'limit') && J(capped) === J({ ok: true, opened: false, why: 'limit' }) && web.url() === WEB, [burst.map((r) => r && r.why), capped]);
  await lm.close();

  // ---------- Una sola sesión entre la web y la extensión ----------
  console.log('Una sola sesión entre la web y la extensión');
  const extGet = (k) => bg((key) => chrome.storage.local.get(key).then((r) => (r[key] === undefined ? null : r[key])), k);
  const webCloud = () => web.evaluate(() => JSON.parse(localStorage.getItem('mdtools:cloud') || 'null'));
  const ANA = 'ana@example.test'; const BETO = 'beto@example.test'; const CODE = '246810';
  const codeFor = async (email) => { const r = await R.api('POST', '/auth/start', { email }); return email === ANA ? CODE : r.json.dev_code; };
  const signIn = async (p, email) => { const code = await codeFor(email); return p.evaluate(([m, c]) => LMD.cloud.verify(m, c).then((a) => a.email), [email, code]); };
  const ana = { s: (await R.api('POST', '/auth/verify', { email: ANA, code: await codeFor(ANA) })).json.session, email: ANA }; await R.api('POST', '/admin/plan', { email: ANA, plan: 'pro' }, undefined, { 'x-admin-key': R.ADMIN });
  const beto = await R.signup(BETO);
  await web.goto(WEB); await web.waitForSelector('.lmd-home');
  // Todo lo anterior corrió con la nube apagada de los dos lados: la sesión que la extensión tenía guardada no cruzó.
  check('con la nube apagada no se sincroniza nada de la sesión', (await webCloud()) === null && ((await extGet('cloud')) || {}).session === 'SECRET-SESSION', [await webCloud(), await extGet('cloud')]);
  const offAsk = [await ask(web, 'session.get', { base: R.base, email: '' }), await ask(web, 'session.put', { base: R.base, session: 'x'.repeat(32), email: ANA }), await ask(web, 'session.clear', { base: R.base, email: 'who@example.test' })];
  check('y la extensión, apagada, no contesta ni toca su sesión', offAsk.every((r) => r && r.ok === true && r.same === false && !('session' in r) && !('email' in r)) && ((await extGet('cloud')) || {}).session === 'SECRET-SESSION', offAsk);
  await bg(() => chrome.storage.local.remove('cloud'));
  // La nube prendida solo en la web: entrar ahí no le deja nada a la extensión.
  await web.evaluate((u) => LMD.patch({ cloudUrl: u }), R.base); await web.waitForTimeout(400);
  check('en la web se entra a la cuenta', (await signIn(web, ANA)) === ANA && (await webCloud()).email === ANA);
  await web.evaluate(() => LMD.bridge.sync()); await web.waitForTimeout(600);
  check('con la nube apagada en la extensión, la sesión de la web no pasa', (await extGet('cloud')) === null && (await web.evaluate(() => LMD.bridge.clash())) === null, await extGet('cloud'));
  // Un servidor propio distinto en la extensión: tampoco.
  await bg(() => LMD.patch({ cloudUrl: 'http://127.0.0.1:9' })); await web.evaluate(() => LMD.bridge.sync()); await web.waitForTimeout(600);
  const otherServer = await ask(web, 'session.get', { base: R.base, email: ANA });
  check('con otro servidor en la extensión, tampoco: cada lado con lo suyo', (await extGet('cloud')) === null && J(otherServer) === J({ ok: true, same: false }) && (await webCloud()).email === ANA, [await extGet('cloud'), otherServer]);
  // El mismo servidor de los dos lados: la sesión de la web queda en la extensión.
  await bg((u) => LMD.patch({ cloudUrl: u }), R.base);
  const landed = await until(async () => { const c = await extGet('cloud'); return c && c.email === ANA ? c : null; }, 8000);
  check('con el mismo servidor, entrar en la web deja la sesión en la extensión', !!landed && landed.session === (await webCloud()).session && landed.at === R.base, landed && { email: landed.email, at: landed.at });

  // El lector de un archivo del disco: la cuenta anda ahí mismo.
  const rd = watch(await ctx.newPage()); const rdAsked = []; rd.on('request', (r) => { if (r.url().startsWith(R.base)) rdAsked.push(r.url()); });
  await rd.goto(fileAt); await rd.waitForSelector('.markdown-body h1');
  await rd.click('[data-act=settings]'); await rd.waitForSelector('.lmd-panel-card');
  const rdTab = async (t, wait) => { await rd.click('[data-ptab=' + t + ']'); if (wait) await rd.waitForFunction(wait, null, { timeout: 8000 }).catch(() => {}); else await rd.waitForTimeout(400); };
  await rdTab('cloud', () => /ana@example\.test/.test((document.querySelector('[data-acct=cloud]') || {}).textContent || ''));
  const rc = await rd.evaluate(() => { const b = document.querySelector('[data-acct=cloud]'); return { text: b.textContent, sec: !!b.querySelector('.lmd-sec'), out: !!b.querySelector('[data-c=out]'), app: document.querySelectorAll('[data-c=app]').length, strip: !!document.querySelector('[data-direct], .lmd-direct') }; });
  check('en el lector, Nube muestra la cuenta de la web, con Salir y el bloque de seguridad', /ana@example\.test/.test(rc.text) && /Paid/.test(rc.text) && rc.sec && rc.out && !/No connection/.test(rc.text), rc.text.slice(0, 160));
  check('el lector no le pide nada al servidor desde la página: todo sale por la extensión', rdAsked.length === 0, rdAsked.slice(0, 3));
  const strips = {};
  for (const t of ['look', 'cloud', 'ai', 'auto', 'plan', 'tools']) { await rdTab(t); strips[t] = await rd.evaluate(() => !!document.querySelector('[data-direct], .lmd-direct') || /Open this file in the app|You are reading a file from your disk/.test(document.querySelector('.lmd-panel-card').textContent)); }
  check('la franja "estás leyendo un archivo de tu disco" no está en Herramientas ni en ninguna otra pestaña', Object.values(strips).every((v) => v === false), strips);
  // La primera lectura de una cuenta paga desbloquea las personalizaciones y Ajustes se vuelve a dibujar: se espera a que pase.
  await until(async () => (await bg(() => LMD.load())).supporter === true, 6000); await rd.waitForTimeout(800);
  await rdTab('ai', () => !!document.querySelector('[data-acct=ai] [data-c=token]'));
  await rd.click('[data-acct=ai] [data-c=token]'); await rd.waitForSelector('[data-acct=ai] .lmd-ai-new', { timeout: 8000 }).catch(() => {});
  const ai = await rd.evaluate(() => ({ vals: [...document.querySelectorAll('[data-acct=ai] input, [data-acct=ai] textarea')].map((n) => n.value), brief: !!document.querySelector('[data-acct=ai] [data-c=brief]'), rows: document.querySelectorAll('[data-acct=ai] .lmd-tokens li').length }));
  const srvTokens = (await R.api('GET', '/tokens', undefined, ana.s)).json;
  check('en el lector, IA (MCP) crea un token de verdad y da la dirección y las instrucciones', ai.vals.some((v) => /^mdt_/.test(v)) && ai.vals.some((v) => v.startsWith(R.base)) && ai.brief && ai.rows === 1 && Array.isArray(srvTokens) && srvTokens.length === 1, [ai.vals.map((v) => v.slice(0, 30)), ai.rows, srvTokens]);
  await rdTab('auto', () => { const p = document.querySelector('[data-auto-pane]'); return !!p && p.textContent.length > 80 && !!p.querySelector('button'); });
  const au = await rd.evaluate(() => { const p = document.querySelector('[data-auto-pane]'); return { text: p.textContent, buttons: p.querySelectorAll('button').length }; });
  check('API y automatizaciones carga con la cuenta', au.buttons > 0 && !/No connection|Sign in to your account/.test(au.text), au.text.slice(0, 200));
  await rdTab('plan', () => /This is your current plan/.test((document.querySelector('[data-acct=plan]') || {}).textContent || ''));
  const pl = await rd.evaluate(() => { const b = document.querySelector('[data-acct=plan]'); return { text: b.textContent, pay: b.querySelectorAll('a[data-pay]').length }; });
  check('Plan dice cuál es el plan de la cuenta, y desde un archivo no sale a pagar con vuelta a un file://', /This is your current plan/.test(pl.text) && pl.pay === 0, pl.text.slice(0, 160));
  await rdTab('tools'); await rd.click('[data-tsub=community]'); await rd.waitForSelector('.lmd-gal-card[data-gkind=included]', { timeout: 8000 }).catch(() => {});
  await rd.waitForTimeout(600);
  const gal = await rd.evaluate(() => { const n = document.querySelector('.lmd-gal-note'); return { note: n && !n.hidden ? n.textContent : '', share: !!document.querySelector('[data-gal=share]') }; });
  check('Comunidad consulta la galería: ya no dice que hay que abrir la app', gal.share && !/Open the app|No connection|No server/.test(gal.note), gal);
  const rdTabs = ctx.pages().length;
  await rd.click('[data-gal=share]'); await rd.waitForSelector('.lmd-gal-share', { timeout: 6000 }).catch(() => {});
  const shareDlg = await rd.evaluate(() => { const c = document.querySelector('.lmd-gal-share'); return c ? { name: c.querySelector('[data-gs=name]').value, send: !!c.querySelector('[data-gs=send]') } : null; });
  check('"Compartí el tuyo" abre el formulario ahí mismo, con esta nota, sin otra pestaña', !!shareDlg && shareDlg.name === 'my notes' && shareDlg.send && ctx.pages().length === rdTabs, shareDlg);
  await rd.fill('.lmd-gal-share [data-gs=about]', 'A note from the disk').catch(() => {}); await rd.fill('.lmd-gal-share [data-gs=author]', 'Ana Test').catch(() => {});
  await rd.click('.lmd-gal-share [data-gs=send]').catch(() => {});
  const mineRows = await until(async () => { const r = (await R.api('GET', '/gallery/mine', undefined, ana.s)).json; return Array.isArray(r) && r.length ? r : null; }, 8000);
  check('y el aporte llega al servidor con la cuenta', !!mineRows && mineRows[0].name === 'my notes', mineRows || await rd.evaluate(() => (document.querySelector('.lmd-gal-share .lmd-img-err') || {}).textContent));
  await rd.waitForSelector('.lmd-gal-share', { state: 'detached', timeout: 5000 }).catch(() => {});

  // Salir en el lector sale en la web.
  await rdTab('cloud', () => !!document.querySelector('[data-acct=cloud] [data-c=out]'));
  await rd.click('[data-acct=cloud] [data-c=out]');
  await rd.waitForSelector('[data-acct=cloud] [data-c=login]', { timeout: 8000 }).catch(() => {});
  check('salir en el lector deja el formulario de entrada', !!(await rd.$('[data-acct=cloud] [data-c=login]')) && !((await extGet('cloud')) || {}).session);
  check('y sale también en la web', !!(await until(async () => !((await webCloud()) || {}).session, 8000)) && (await web.evaluate(async () => { await LMD.cloud.ready(); return LMD.cloud.signedIn(); })) === false, await webCloud());
  // Sin sesión en ningún lado: se entra ahí mismo, con el correo y el código.
  const rdBefore = ctx.pages().length;
  await rd.click('[data-acct=cloud] [data-c=login]'); await rd.waitForSelector('[data-acct=cloud] [data-field=email]');
  await rd.fill('[data-acct=cloud] [data-field=email]', ANA); await rd.keyboard.press('Enter');
  await rd.waitForSelector('[data-acct=cloud] [data-field=code]', { timeout: 8000 }).catch(() => {});
  await rd.fill('[data-acct=cloud] [data-field=code]', CODE).catch(() => {}); await rd.keyboard.press('Enter');
  await rd.waitForFunction(() => !!document.querySelector('[data-acct=cloud] [data-c=out]'), null, { timeout: 8000 }).catch(() => {});
  check('en el lector se entra con el correo y el código, sin salir a otra pestaña', !!(await rd.$('[data-acct=cloud] [data-c=out]')) && ctx.pages().length === rdBefore && ((await extGet('cloud')) || {}).email === ANA, await rd.evaluate(() => document.querySelector('[data-acct=cloud]').textContent.slice(0, 200)));
  const back = await until(async () => { const c = await webCloud(); return c && c.session ? c : null; }, 8000);
  check('y entrar en el lector deja la sesión en la web', !!back && back.email === ANA && back.session === (await extGet('cloud')).session && (await web.evaluate(async () => { await LMD.cloud.ready(); return LMD.cloud.email(); })) === ANA, back && back.email);
  // Copiar a la nube la nota del disco: lo ofrece el botón de la nube de la barra.
  await rd.click('[data-act=close-panel]');
  const upTabs = ctx.pages().length;
  await rd.click('.lmd-sync'); await rd.waitForSelector('.lmd-dlg-card', { timeout: 5000 }).catch(() => {});
  const up = await dlg(rd);
  const [cloudTab] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), rd.click('.lmd-dlg-card [data-dlg=ok]').catch(() => {})]);
  const uploaded = await until(async () => { const r = (await R.api('GET', '/notes/' + encodeURIComponent('my notes.md'), undefined, ana.s)); return r.status === 200 ? r.json : null; }, 8000);
  check('el lector ofrece copiar la nota a la nube, y la copia llega', !!up && /Upload "my notes\.md" to the cloud\?/.test(up.title) && /the file here is left untouched/.test(up.text) && !!uploaded && /SECRET-DISK-TEXT/.test(uploaded.text), [up, uploaded && uploaded.text]);
  check('y la abre en la app, que ya tiene la misma sesión', !!cloudTab && /app\.html\?f=cloud%2Fmy%2520notes\.md/.test(cloudTab.url()) && ctx.pages().length === upTabs + 1, cloudTab && cloudTab.url());
  if (cloudTab) await cloudTab.close();
  // Salir en la web sale en la extensión, y el lector lo muestra sin recargar.
  await rd.bringToFront(); await rd.click('[data-act=settings]'); await rd.waitForSelector('.lmd-panel-card'); await rdTab('cloud', () => !!document.querySelector('[data-acct=cloud] [data-c=out]'));
  await web.evaluate(() => LMD.sync.signOut(null));
  check('salir en la web sale en la extensión', !!(await until(async () => !((await extGet('cloud')) || {}).session, 8000)), await extGet('cloud'));
  await rd.waitForSelector('[data-acct=cloud] [data-c=login]', { timeout: 8000 }).catch(() => {});
  check('y el lector, que tenía Nube abierta, pasa solo al formulario de entrada', !!(await rd.$('[data-acct=cloud] [data-c=login]')) && !(await rd.$('[data-acct=cloud] [data-c=out]')));

  // Dos cuentas distintas: no se pisa ninguna, y se dice.
  await signIn(web, ANA);
  await until(async () => ((await extGet('cloud')) || {}).email === ANA, 8000);
  await bg(([s, m, at]) => chrome.storage.local.set({ cloud: { session: s, email: m, at } }), [beto.s, BETO, R.base]); // como entrar con otra cuenta del lado de la extensión
  await until(() => web.evaluate(() => !!LMD.bridge.clash()), 8000); await web.waitForTimeout(500);
  const two = { web: await webCloud(), ext: await extGet('cloud'), clash: await web.evaluate(() => LMD.bridge.clash()), other: await extGet('bridgeOther') };
  check('con cuentas distintas no se pisa ninguna', two.web.email === ANA && two.web.session !== beto.s && two.ext.email === BETO && two.ext.session === beto.s && J(two.clash) === J({ mine: ANA, theirs: BETO }) && J(two.other) === J({ email: ANA }), { web: two.web.email, ext: two.ext.email, clash: two.clash, other: two.other });
  await rdTab('cloud', () => /beto@example\.test/.test((document.querySelector('[data-acct=cloud]') || {}).textContent || '') && !!document.querySelector('[data-acct=cloud] .lmd-acct-two'));
  const rdTwo = await rd.evaluate(() => { const p = document.querySelector('[data-acct=cloud] .lmd-acct-two'); return p ? { text: p.textContent.trim(), button: !!p.querySelector('button') } : null; });
  check('Ajustes > Nube lo dice del lado de la extensión', !!rdTwo && rdTwo.text === 'The web app is signed in as ana@example.test. Each side keeps its own account.' && !rdTwo.button, rdTwo);
  await web.bringToFront(); await web.click('[data-cloud=menu]').catch(() => {});
  await web.evaluate(() => LMD.sync.dialog('cloud', { close: () => {}, leave: async () => true, back: location.href })).catch(() => {});
  await web.waitForSelector('.lmd-acct-two', { timeout: 8000 }).catch(() => {});
  const webTwo = await web.evaluate(() => { const p = document.querySelector('.lmd-acct-two'); return p ? { text: p.firstChild.textContent.trim(), button: (p.querySelector('button') || {}).textContent || '' } : null; });
  check('y del lado de la web, con el botón para dejar una sola', !!webTwo && webTwo.text === 'The extension is signed in as beto@example.test. Each side keeps its own account.' && webTwo.button === 'Use ana@example.test on both' && !/[!¡—–]/.test(webTwo.text + webTwo.button), webTwo);
  await web.click('.lmd-acct-two button'); await web.waitForSelector('.lmd-dlg-card');
  const askTwo = await dlg(web);
  check('cambiarla pide una confirmación', !!askTwo && askTwo.title === 'Use ana@example.test on both?' && askTwo.text === 'The extension signs out of the other account.' && J(askTwo.buttons) === J(['Cancel', 'Use this account']) && (await extGet('cloud')).email === BETO, askTwo);
  await web.click('.lmd-dlg-card [data-dlg=ok]');
  const one = await until(async () => { const c = await extGet('cloud'); return c && c.email === ANA ? c : null; }, 8000);
  check('y con la confirmación queda la de la web en los dos lados', !!one && one.session === (await webCloud()).session && (await extGet('bridgeOther')) === null && (await web.evaluate(() => LMD.bridge.clash())) === null, one && one.email);
  await web.evaluate(() => { const d = document.querySelector('.lmd-acct-card [data-d=close]'); if (d) d.click(); });

  // Quién puede pedir, publicar o cerrar la sesión: solo la app web, en su origen exacto.
  const tokenNow = (await extGet('cloud')).session;
  const st2 = watch(await ctx.newPage());
  await st2.goto(OTHER); await st2.waitForSelector('.lmd-home');
  const alien = [await ask(st2, 'session.get', { base: R.base, email: '' }), await ask(st2, 'session.put', { base: R.base, session: beto.s, email: BETO, force: true }), await ask(st2, 'session.clear', { base: R.base, email: ANA })];
  await st2.close();
  const fromExtPage = await extPage.evaluate(([b, m]) => Promise.all([{ op: 'session.get', args: { base: b, email: '' } }, { op: 'session.clear', args: { base: b, email: m } }].map((q) => new Promise((resolve) => chrome.runtime.sendMessage(Object.assign({ type: 'bridge' }, q), resolve)))), [R.base, ANA]);
  check('otro origen no puede pedir, publicar ni cerrar la sesión', alien.every((r) => r === 'timeout' || (r && r.ok === false && !('session' in r))) && fromExtPage.every((r) => r && r.ok === false && r.error === 'refused') && (await extGet('cloud')).session === tokenNow && (await extGet('cloud')).email === ANA, [alien, fromExtPage]);
  const shapes2 = [await ask(web, 'session.put', { base: R.base, session: 'corta', email: ANA }), await ask(web, 'session.put', { base: R.base, session: tokenNow, email: 'sin arroba' }), await ask(web, 'session.put', { base: 'javascript:alert(1)', session: tokenNow, email: ANA }), await ask(web, 'session.put', { base: R.base, session: { a: 1 }, email: ANA }), await ask(web, 'session.get', { base: R.base, email: 5 }), await ask(web, 'session.clear', { base: R.base })];
  check('un pedido de sesión con otra forma se rechaza', shapes2.every((r) => r && r.ok === false && r.error === 'shape') && (await extGet('cloud')).session === tokenNow, shapes2);
  const got2 = await ask(web, 'session.get', { base: R.base, email: ANA });
  check('la respuesta trae solo el correo y la sesión de ese servidor', J(Object.keys(got2).sort()) === J(['email', 'ok', 'same', 'session']) && got2.session === tokenNow, Object.keys(got2));
  // El paso al servidor para el lector: solo el lector de un archivo del disco, y solo las rutas de la lista.
  const viaSw = (msg, sender) => bg(([m, s]) => new Promise((resolve) => { const from = Object.assign({ id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, url: 'file:///C:/notes/a.md' }, s); if (LMD.bridgeHost.onCloud(m, from, resolve) === false) { /* ya contestó */ } }), [msg, sender || {}]);
  const okCall = await viaSw({ method: 'GET', path: '/account', auth: true });
  const badRoutes = [['GET', '/admin/plan'], ['POST', '/admin/plan'], ['GET', '/trash'], ['DELETE', '/notes/a.md'], ['GET', '/notes/../admin/plan'], ['GET', '/notes/%2e%2e/admin'], ['GET', '/notes/a.md/../../admin'], ['GET', '/public/abc'], ['GET', '/events?path=a.md'], ['GET', 'http://127.0.0.1:9/account'], ['GET', '//evil.example/account'], ['GET', '/account#x'], ['TRACE', '/account'], ['GET', '/account\n'], ['POST', '/vaults'], ['POST', '/links'], ['GET', 5]];
  const badRes2 = []; for (const [method, p] of badRoutes) badRes2.push(await viaSw({ method, path: p }));
  check('el lector llega al servidor por la extensión', okCall && okCall.ok === true && okCall.status === 200 && okCall.json && okCall.json.email === ANA, okCall && { ok: okCall.ok, status: okCall.status });
  check('pero no a cualquier ruta: fuera de la lista se rechaza sin salir a la red', badRes2.every((r) => r && r.ok === false && r.error === 'refused'), badRoutes.filter((x, k) => !(badRes2[k] && badRes2[k].error === 'refused')));
  const badSenders = [{ url: 'https://evil.example/notes/a.md' }, { url: WEB }, { url: OWN }, { url: 'file://server/share/a.md' }, { frameId: 1 }, { id: 'otraextension' }, { tab: null }];
  const badRes3 = []; for (const s of badSenders) badRes3.push(await viaSw({ method: 'GET', path: '/account' }, s));
  const fromPages = [await extPage.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'cloudApi', method: 'GET', path: '/account' }, resolve)))];
  check('ni a cualquiera: un sitio, la app web, la página de la extensión o un marco no pasan', badRes3.concat(fromPages).every((r) => r && r.ok === false && r.error === 'refused'), badRes3.concat(fromPages));
  check('la página del archivo no ve la sesión ni tiene cómo pedirla', await rd.evaluate((t) => (typeof chrome === 'undefined' || !chrome.storage) && !window.LMD && !document.documentElement.outerHTML.includes(t), tokenNow));
  await rd.close();
  // Todo vuelve a como estaba: sin sesión y con la nube apagada de los dos lados.
  await web.evaluate(() => LMD.sync.signOut(null)); await until(async () => !((await extGet('cloud')) || {}).session, 8000);
  await web.evaluate(() => LMD.patch({ cloudUrl: 'off' })); await bg(() => LMD.patch({ cloudUrl: 'off' })); await bg(() => chrome.storage.local.remove(['cloud', 'bridgeOther']));
  await web.evaluate(() => localStorage.removeItem('mdtools:cloud')); await web.waitForTimeout(400);

  // ---------- Sin conexión, con la extensión ----------
  console.log('Sin conexión, con la extensión');
  await web.goto(WEB); await web.waitForSelector('.lmd-home');
  check('la web le avisa a la extensión que ya quedó guardada para abrir sin conexión', !!(await until(async () => (await bg(() => chrome.storage.local.get('webReady'))).webReady, 15000)));
  await web.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  await shut(site);
  await web.goto(WEB, { timeout: 20000 }).catch((e) => errors.push('sin red: ' + e.message.split('\n')[0]));
  await web.waitForSelector('.lmd-home', { timeout: 10000 }).catch(() => {});
  check('sin red, la web abre desde su caché y sigue viendo a la extensión', await web.evaluate(() => !!window.LMD && !!document.querySelector('.lmd-home') && !!document.documentElement.dataset.lmdExt).catch(() => false));
  await web.evaluate(() => LMD.store.notePut('offline-web.md', '# Written offline on the web\n'));
  check('lo escrito en la web sin red llega a la extensión', !!(await until(async () => (await extNotes())['offline-web.md'])));
  await extPage.evaluate(() => LMD.store.notePut('offline-ext.md', '# Written offline in the extension\n'));
  check('y lo de la extensión a la web', !!(await until(async () => (await notesOf(web))['offline-ext.md'])));

  // ---------- El botón de la extensión ----------
  console.log('El botón de la extensión');
  const anchor = await ctx.newPage(); // una pestaña que no es de SharpMD, para que el navegador no se quede sin ventanas
  const at = (base) => ctx.pages().filter((p) => p.url() === base || p.url().startsWith(base + '?'));
  const press = () => bg(() => LMD.bridgeHost.openSharp().then((t) => (t ? t.id : null)));
  const closeAll = async (base) => { for (const p of at(base)) await p.close(); };
  await extPage.close(); extPage = null;
  check('el clic llega a la extensión', await bg(() => chrome.action.onClicked.hasListeners()));
  let before = ctx.pages().length;
  await press(); await sleep(400);
  check('con la web ya abierta, la trae al frente en vez de abrir otra', ctx.pages().length === before && at(WEB).length === 1 && at(OWN).length === 0, ctx.pages().map((p) => p.url()));
  // Sin red, con la web ya guardada en este navegador: abre la web igual.
  await closeAll(WEB);
  await press();
  const cached = await until(async () => at(WEB)[0], 8000);
  if (cached) await cached.waitForSelector('.lmd-home', { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  check('sin red y con la web ya guardada, abre la web desde su caché', at(WEB).length === 1 && at(OWN).length === 0 && !!cached && await cached.evaluate(() => !!document.querySelector('.lmd-home')).catch(() => false) && !!(await bg(() => chrome.storage.local.get('webReady'))).webReady, ctx.pages().map((p) => p.url()));
  // Sin red y con los datos del sitio borrados: la marca quedó vieja. La pestaña pasa a la página de la extensión.
  await closeAll(WEB);
  const cdp = await ctx.newCDPSession(anchor);
  await cdp.send('Storage.clearDataForOrigin', { origin: W, storageTypes: 'service_workers,cache_storage' });
  await sleep(500);
  await press();
  check('sin red y sin la web guardada (datos del sitio borrados), termina en la página de la extensión', !!(await until(async () => at(OWN).length === 1 && at(WEB).length === 0, 12000)) && !(await bg(() => chrome.storage.local.get('webReady'))).webReady, ctx.pages().map((p) => p.url()));
  const local = at(OWN)[0];
  if (local) { await local.waitForSelector('.lmd-home', { timeout: 8000 }).catch(() => {}); check('con las mismas notas', await local.evaluate(async () => !!(await LMD.store.noteGet('offline-web.md'))).catch(() => false)); }
  before = ctx.pages().length;
  const t0 = Date.now(); await press(); const took = Date.now() - t0; await sleep(300);
  check('otro clic sin red trae esa pestaña al frente, sin demora', ctx.pages().length === before && at(OWN).length === 1 && took < 4000, took);
  await closeAll(OWN);
  await press();
  check('sin red y sin la web guardada, abre directo la página de la extensión', !!(await until(async () => at(OWN).length === 1 && at(WEB).length === 0, 8000)), ctx.pages().map((p) => p.url()));
  // Vuelve la red.
  site = await serve(PORT);
  await closeAll(OWN);
  await press();
  check('con red, abre la app web', !!(await until(async () => at(WEB).length === 1 && at(OWN).length === 0, 8000)), ctx.pages().map((p) => p.url()));
  await bg(() => LMD.patch({ openIn: 'ext' }));
  await press();
  check('con la preferencia "Esta extensión", abre la página de la extensión aunque haya red y la web esté abierta', !!(await until(async () => at(OWN).length === 1, 8000)), ctx.pages().map((p) => p.url()));
  before = ctx.pages().length; await press(); await sleep(400);
  check('y un clic más no abre otra', ctx.pages().length === before && at(OWN).length === 1);
  await bg(() => LMD.patch({ openIn: 'web' }));

  // ---------- Sin la extensión ----------
  console.log('Sin la extensión: la web sola, sin conexión');
  const who = await R.signup('offline@example.test');
  await R.api('PUT', '/notes/plan.md', { text: '# Plan\n\nfirst line\n' }, who.s);
  const solo = await R.open(who, { serviceWorkers: 'allow' });
  const sp = solo.page;
  await sp.goto(R.home); await sp.waitForSelector('.lmd-home');
  check('sin la extensión no hay puente: la web usa su depósito', await sp.evaluate(() => document.documentElement.dataset.lmdExt === undefined && LMD.bridge.present() === false));
  await sp.evaluate(() => LMD.store.notePut('mine.md', '# Mine\n\nlocal line\n'));
  await sp.evaluate(() => navigator.serviceWorker.ready); await sp.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  await sp.goto(R.noteUrl('plan.md', true)); await sp.waitForSelector('.lmd-article .lmd-editable');
  check('con red no hay aviso de sin conexión', await sp.evaluate(() => { const c = document.querySelector('.lmd-offline'); return !!c && c.hidden; }));
  await solo.ctx.setOffline(true);
  await sp.goto(R.home, { timeout: 20000 }).catch((e) => R.errors.push('sin red: ' + e.message.split('\n')[0]));
  await sp.waitForSelector('.lmd-home [data-home=new]', { timeout: 10000 }).catch(() => {});
  const chip = await sp.evaluate(() => { const c = document.querySelector('.lmd-offline'); if (!c || c.hidden) return null; const r = c.getBoundingClientRect(); const bar = document.querySelector('.lmd-topbar').getBoundingClientRect(); return { text: c.textContent.trim(), inBar: r.top >= bar.top && r.bottom <= bar.bottom + 1 && r.right <= window.innerWidth, h: Math.round(r.height), online: navigator.onLine }; }).catch(() => null);
  check('sin red la app abre y lo dice con una marca chica en la barra', !!chip && chip.text === 'Offline' && chip.inBar && chip.h <= 26 && chip.online === false, chip);
  const droid = await solo.ctx.newPage(); droid.on('pageerror', (e) => R.errors.push(e.message));
  await droid.goto(R.home + '?src=android', { timeout: 20000 }).catch((e) => R.errors.push('sin red: ' + e.message.split('\n')[0]));
  await droid.waitForSelector('.lmd-home [data-home=new]', { timeout: 10000 }).catch(() => {});
  check('sin red también abre como la app de Android (?src=android)', await droid.evaluate(() => !!window.LMD && LMD.storeApp === true && !!document.querySelector('.lmd-home [data-home=new]')).catch(() => false));
  await droid.click('[data-act=settings]').catch(() => {}); await droid.waitForSelector('.lmd-panel-card', { timeout: 5000 }).catch(() => {}); await droid.click('[data-ptab=inst]').catch(() => {}); await droid.waitForSelector('[data-inst-pane] h4', { timeout: 5000 }).catch(() => {});
  const dp = await droid.evaluate(() => { const b = document.querySelector('[data-inst-pane]'); return b ? { heads: [...b.querySelectorAll('h4')].map((h) => h.textContent), controls: b.querySelectorAll('a, button, input').length } : null; }).catch(() => null);
  check('dentro de la app de Android, Instalar solo dice cómo seguir en la computadora', !!dp && J(dp.heads) === J(['On a computer']) && dp.controls === 0, dp);
  await droid.close();
  await sp.goto(R.home + '?new=1', { timeout: 20000 }).catch(() => {}); await sp.waitForSelector('.lmd-editing .lmd-article', { timeout: 10000 }).catch(() => {});
  await sp.keyboard.type('Fresh offline note'); await sp.keyboard.press('Enter'); await sp.waitForTimeout(400); await leave(sp);
  const made = await until(async () => { const f = new URLSearchParams(new URL(sp.url()).search).get('f') || ''; if (!/^local\//.test(f)) return null; const n = await sp.evaluate((name) => LMD.store.noteGet(name), decodeURIComponent(f.slice(6))); return n && /Fresh offline note/.test(n.text) ? n : null; }, 8000);
  check('sin red se crea una nota nueva (?new=1) y lo escrito queda guardado', !!made, sp.url());
  await sp.goto(R.home + '?f=' + encodeURIComponent('local/mine.md') + '&edit=1', { timeout: 20000 }).catch(() => {}); await sp.waitForSelector('.lmd-article .lmd-editable', { timeout: 10000 }).catch(() => {});
  await typeIn(sp, 'local line', ' edited offline'); await leave(sp);
  check('y una nota del navegador se edita sin red', !!(await until(async () => /edited offline/.test((await sp.evaluate(() => LMD.store.noteGet('mine.md'))).text), 8000)));
  await sp.goto(R.noteUrl('plan.md', true), { timeout: 20000 }).catch(() => {}); await sp.waitForSelector('.lmd-article .lmd-editable', { timeout: 10000 }).catch(() => {});
  check('una nota de la nube ya abierta se abre sin red', /first line/.test(await sp.textContent('.lmd-article').catch(() => '')));
  await typeIn(sp, 'first line', ' written offline'); await leave(sp); await sp.waitForTimeout(3500);
  check('lo escrito sin red no llegó todavía al servidor', (await R.api('GET', '/notes/plan.md', undefined, who.s)).json.text === '# Plan\n\nfirst line\n');
  await solo.ctx.setOffline(false); await sp.evaluate(() => { window.dispatchEvent(new Event('online')); });
  check('y sube solo al volver la red', !!(await until(async () => /written offline/.test((await R.api('GET', '/notes/plan.md', undefined, who.s)).json.text), 20000)), (await R.api('GET', '/notes/plan.md', undefined, who.s)).json.text);
  check('el aviso de sin conexión se va', await sp.evaluate(() => document.querySelector('.lmd-offline').hidden));

  // ---------- Ajustes > Instalar en la web sola ----------
  console.log('Ajustes > Instalar, en la web sin la extensión');
  await sp.goto(R.home); await sp.waitForSelector('.lmd-home'); await openInst(sp);
  const np = await paneOf(sp);
  check('sin la extensión: no hay dónde elegir, y un botón lleva a conseguirla', J(np.heads) === J(['Chrome extension', 'Install as an app', 'Open .md files with a double click']) && np.radios.length === 0 && /Not in this browser\./.test(np.text) && np.links.some((l) => l === 'Get the extension https://github.com/SharpMD/sharpmd#install'), np);
  check('sin aviso del navegador, dice cómo instalarla desde el menú', /From the browser menu: Install SharpMD\./.test(np.text) && !np.buttons.includes('Install') && /Its own window and "Open with" for \.md files on Windows\./.test(np.text));
  await sp.evaluate(() => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { window.__prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) })); });
  await sp.waitForSelector('[data-inst=app]', { timeout: 4000 }).catch(() => {});
  check('cuando el navegador lo permite, aparece el botón Instalar', (await paneOf(sp)).buttons.includes('Install'));
  await sp.click('[data-inst=app]'); await sp.waitForFunction(() => /Already installed\./.test(document.querySelector('[data-inst-pane]').textContent), null, { timeout: 4000 }).catch(() => {});
  check('el botón dispara la instalación y después dice que ya está instalada', (await sp.evaluate(() => window.__prompted === true)) && /Already installed\./.test((await paneOf(sp)).text));
  // ---------- Un enlace que abre un archivo del disco, sin la extensión ----------
  console.log('Un enlace que abre un archivo del disco, sin la extensión');
  const PASTE = 'The path is copied. Paste it in the file name box (Ctrl+V) and press Enter.';
  const mock = () => sp.evaluate(() => {
    window.__copied = []; window.__order = []; window.__copyFails = false;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t) => { window.__order.push('copy'); if (window.__copyFails) throw new Error('sin permiso'); window.__copied.push(t); } });
    window.showOpenFilePicker = (o) => { const n = document.querySelector('.lmd-dlg-note'); window.__order.push('picker'); window.__picker = o; window.__noteAtPick = n && !n.hidden ? n.textContent : ''; return new Promise((resolve, reject) => { window.__pick = { resolve, reject }; }); };
  });
  await mock();
  const winPath = 'C:\\Users\\me\\Desktop\\my notes.md';
  await sp.goto(R.home + '#open=' + encodeURIComponent('file:///C:/Users/me/Desktop/my%20notes.md')); await sp.waitForSelector('.lmd-dlg-card');
  const nd = await sp.evaluate(() => { const c = document.querySelector('.lmd-dlg-card'); const a = c.querySelector('.lmd-dlg-link a'); const n = c.querySelector('.lmd-dlg-note'); return { at: location.href, title: c.querySelector('h3').textContent, text: c.querySelector('p').textContent, path: c.querySelector('.lmd-dlg-path code').textContent, buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent), link: a.textContent + ' ' + a.href, copy: c.querySelector('[data-dlg-copy]').textContent, note: n.hidden ? '' : n.textContent, all: c.textContent }; });
  check('sin la extensión: una línea que lo explica, la ruta, y el fragmento fuera de la barra', nd.at === R.home && nd.title === 'Open this file from your disk?' && nd.text === 'Without the Chrome extension, pick the file.' && nd.path === winPath && nd.note === '' && !/[!¡—–]/.test(nd.all), nd);
  check('con copiar la ruta, Abrir y el enlace a la extensión', nd.copy === 'Copy path' && J(nd.buttons) === J(['Cancel', 'Open']) && nd.link === 'Get the extension https://github.com/SharpMD/sharpmd#install', nd);
  await sp.click('.lmd-dlg-card [data-dlg-copy]'); await sp.waitForFunction(() => document.querySelector('[data-dlg-copy]').textContent === 'Copied', null, { timeout: 3000 }).catch(() => {});
  check('"Copiar la ruta" copia la ruta y lo dice', J(await sp.evaluate(() => window.__copied)) === J([winPath]) && (await sp.textContent('[data-dlg-copy]')) === 'Copied' && (await sp.locator('.lmd-dlg-card').count()) === 1);
  await sp.evaluate(() => { window.__copied = []; window.__order = []; });
  const soloTabs = solo.ctx.pages().length;
  await sp.click('.lmd-dlg-card [data-dlg=ok]'); await sp.waitForFunction(() => !!window.__picker, null, { timeout: 4000 }).catch(() => {});
  const fb = await sp.evaluate(() => { const n = document.querySelector('.lmd-dlg-note'); return { order: window.__order, copied: window.__copied, id: window.__picker && window.__picker.id, exts: window.__picker ? window.__picker.types.flatMap((t) => Object.values(t.accept).flat()) : [], atPick: window.__noteAtPick, open: !!document.querySelector('.lmd-dlg-card'), note: n && !n.hidden ? n.textContent : '', copyBtn: !!document.querySelector('[data-dlg-copy]') }; });
  check('"Abrir" copia la ruta como la escribe Windows y abre el selector, con el mismo clic y en ese orden', J(fb.order) === J(['copy', 'picker']) && J(fb.copied) === J([winPath]) && !/^file:/.test(fb.copied[0]) && fb.id === 'lmd-abrir' && ['.md', '.markdown', '.txt', '.json', '.yaml'].every((x) => fb.exts.includes(x)), fb);
  check('la instrucción está a la vista antes de abrir el selector y mientras está abierto', fb.atPick === PASTE && fb.note === PASTE && fb.open && fb.copyBtn && !/[!¡—–]/.test(PASTE), fb);
  // Se cierra el selector sin elegir: la pregunta sigue ahí. Y si copiar falla, lo dice y queda el botón de copiar.
  await sp.evaluate(() => { window.__pick.reject(Object.assign(new Error('cancelado'), { name: 'AbortError' })); window.__copyFails = true; window.__picker = null; });
  await sp.waitForTimeout(300);
  const still = await sp.locator('.lmd-dlg-card').count();
  await sp.click('.lmd-dlg-card [data-dlg=ok]'); await sp.waitForFunction(() => !!window.__picker && /could not be copied/.test(document.querySelector('.lmd-dlg-note').textContent), null, { timeout: 4000 }).catch(() => {});
  const fb2 = await sp.evaluate(() => ({ note: document.querySelector('.lmd-dlg-note').textContent, copyBtn: !!document.querySelector('[data-dlg-copy]'), picker: !!window.__picker }));
  check('al cancelar el selector la pregunta sigue; si copiar falla lo dice y conserva "Copiar la ruta"', still === 1 && fb2.picker && fb2.copyBtn && fb2.note === 'The path could not be copied. Copy it with the button and paste it in the file name box.', fb2);
  await sp.evaluate(() => { window.__pick.reject(Object.assign(new Error('cancelado'), { name: 'AbortError' })); });
  await sp.keyboard.press('Escape'); await sp.waitForSelector('.lmd-dlg-card', { state: 'detached', timeout: 3000 }).catch(() => {});
  check('en ningún momento se abre una pestaña con un file://', solo.ctx.pages().length === soloTabs && !solo.ctx.pages().some((p) => p.url().startsWith('file:')), solo.ctx.pages().map((p) => p.url()));
  // Con el archivo elegido se abre dentro de la app con su permiso: guardar escribe en el archivo de verdad.
  // En el navegador con perfil propio y en el otro origen: ahí el puente no contesta (cae al mismo respaldo), el
  // almacenamiento privado anda y el portapapeles es el de verdad.
  const pk = watch(await ctx.newPage());
  await pk.goto(OTHER); await pk.waitForSelector('.lmd-home');
  await pk.evaluate(() => { window.showOpenFilePicker = (o) => { window.__picker = o; return new Promise((resolve, reject) => { window.__pick = { resolve, reject }; }); }; });
  await pk.goto(linkTo(OTHER, fileAt)); await pk.waitForSelector('.lmd-dlg-card');
  const pkTabs = ctx.pages().length;
  await pk.bringToFront(); await pk.click('.lmd-dlg-card [data-dlg=ok]'); await pk.waitForFunction(() => !!window.__pick, null, { timeout: 4000 }).catch(() => {});
  check('el portapapeles de verdad queda con la ruta del sistema, no con la dirección file://', (await clip(pk)) === diskFile && !/^file:/.test(diskFile), await clip(pk));
  const pickedOk = await pk.evaluate(async () => {
    try { const f = await (await navigator.storage.getDirectory()).getFileHandle('picked.md', { create: true }); const w = await f.createWritable(); await w.write('# Picked\n\nfrom the picker\n'); await w.close(); window.__file = f; window.__pick.resolve([f]); return true; }
    catch (e) { return String(e && e.message || e); }
  });
  await pk.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  const got = await pk.evaluate(async () => { const out = []; for (const r of await LMD.store.rootsAll()) out.push({ name: r.name, kind: r.kind, same: !!r.handle && !!window.__file && await r.handle.isSameEntry(window.__file) }); return { h1: (document.querySelector('.markdown-body h1') || {}).textContent || '', dlg: !!document.querySelector('.lmd-dlg-card'), roots: out, at: location.href }; });
  check('el archivo elegido se abre dentro de la app, ligado a su permiso', pickedOk === true && got.h1.startsWith('Picked') && !got.dlg && got.roots.some((r) => r.name === 'picked.md' && r.kind === 'file' && r.same) && got.at.startsWith(OTHER), [pickedOk, got]);
  await pk.click('[data-act=mode-edit]'); await pk.waitForSelector('.lmd-article .lmd-editable');
  await typeIn(pk, 'from the picker', ' and saved in place'); await leave(pk); await pk.keyboard.press('Control+s');
  check('y guardar escribe en ese archivo', !!(await until(() => pk.evaluate(async () => /and saved in place/.test(await (await window.__file.getFile()).text())), 8000)));
  check('tampoco ahí se abre una pestaña con un file://', ctx.pages().length === pkTabs && !ctx.pages().some((p) => p.url().startsWith('file:')), ctx.pages().map((p) => p.url()));
  await pk.evaluate(async () => { for (const r of await LMD.store.rootsAll()) await LMD.store.handlesDelete(r.key); }); // la lista de abiertos queda como estaba para lo que sigue
  await pk.close();
  // Un navegador sin selector con permisos (Firefox, Safari): el de siempre, con la misma instrucción, y queda una copia.
  await sp.goto(R.home); await sp.waitForSelector('.lmd-home'); await mock(); await sp.evaluate(() => { window.showOpenFilePicker = undefined; });
  await sp.goto(R.home + '#open=' + encodeURIComponent('file:///C:/Users/me/Desktop/my%20notes.md')); await sp.waitForSelector('.lmd-dlg-card');
  const [chooser] = await Promise.all([sp.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null), sp.click('.lmd-dlg-card [data-dlg=ok]')]);
  const fb3 = await sp.evaluate(() => { const n = document.querySelector('.lmd-dlg-note'); return { note: n && !n.hidden ? n.textContent : '', copied: window.__copied, open: !!document.querySelector('.lmd-dlg-card') }; });
  if (chooser) await chooser.setFiles(diskFile);
  await sp.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  await sp.waitForFunction(() => /Opened as a copy/.test(document.body.textContent), null, { timeout: 4000 }).catch(() => {});
  const got3 = await sp.evaluate(() => ({ h1: (document.querySelector('.markdown-body h1') || {}).textContent || '', f: new URLSearchParams(location.search).get('f'), note: /Opened as a copy\. The file on your disk is not changed\./.test(document.body.textContent), dlg: !!document.querySelector('.lmd-dlg-card') }));
  check('sin showOpenFilePicker usa el selector común, con la ruta copiada y la misma instrucción', !!chooser && fb3.note === PASTE && J(fb3.copied) === J([winPath]) && fb3.open, fb3);
  check('y el documento queda como copia, con su aviso', got3.h1.startsWith('Local note') && /^mem\//.test(got3.f || '') && got3.note && !got3.dlg && !solo.ctx.pages().some((p) => p.url().startsWith('file:')), got3);
  const refusedLinks = [];
  for (const target of ['https://example.com/notes.md', 'javascript:alert(1)//a.md', 'file:///C:/Users/me/Desktop/run.exe', 'file:///C:/Users/me/../secret.md', '%E0%A4%A']) {
    await sp.goto(R.home + '#open=' + (target.startsWith('%') ? target : encodeURIComponent(target))); await sp.waitForSelector('.lmd-dlg-card', { timeout: 4000 }).catch(() => {});
    refusedLinks.push(await sp.evaluate(() => { const c = document.querySelector('.lmd-dlg-card'); return c ? c.querySelector('h3').textContent + ' / ' + [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent).join(',') + ' / ' + !!c.querySelector('.lmd-dlg-path') + ' / ' + location.hash : 'sin aviso'; }));
    await sp.keyboard.press('Escape'); await sp.waitForSelector('.lmd-dlg-card', { state: 'detached', timeout: 3000 }).catch(() => {});
  }
  check('un enlace que no es a un Markdown del disco no ofrece abrir nada', refusedLinks.every((r) => r === 'This link cannot be opened / Close / false / '), refusedLinks);
  await solo.ctx.close();

  // ---------- "Abrir con" ----------
  console.log('"Abrir con": el archivo que manda el sistema');
  // En el otro origen del navegador con perfil propio: ahí el puente no contesta y el almacenamiento privado anda.
  await ctx.addInitScript(() => { Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { window.__launch = fn; } } }); });
  const lp = watch(await ctx.newPage());
  await lp.goto(OTHER); await lp.waitForSelector('.lmd-home');
  check('la app atiende la cola de archivos del sistema', await lp.evaluate(() => typeof window.__launch === 'function'));
  await lp.evaluate(async () => {
    const f = await (await navigator.storage.getDirectory()).getFileHandle('from-windows.md', { create: true });
    const w = await f.createWritable(); await w.write('# From Windows\n\nopened with a double click\n'); await w.close();
    window.__file = f; window.__launch({ files: [f] });
  });
  await lp.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
  check('el archivo recibido se abre', (await lp.textContent('.markdown-body h1').catch(() => '')).startsWith('From Windows'), lp.url());
  const rec = await lp.evaluate(async () => { const out = []; for (const r of await LMD.store.rootsAll()) out.push({ name: r.name, kind: r.kind, handle: !!r.handle, same: !!r.handle && await r.handle.isSameEntry(window.__file) }); return out; });
  check('y queda en la lista de abiertos, con su permiso', J(rec) === J([{ name: 'from-windows.md', kind: 'file', handle: true, same: true }]), rec);
  await lp.click('[data-act=mode-edit]'); await lp.waitForSelector('.lmd-article .lmd-editable');
  await typeIn(lp, 'opened with a double click', ' and saved in place'); await leave(lp); await lp.keyboard.press('Control+s');
  check('al guardar se escribe sobre el mismo archivo', !!(await until(() => lp.evaluate(async () => /and saved in place/.test(await (await window.__file.getFile()).text())), 8000)), await lp.evaluate(async () => (await window.__file.getFile()).text()));
  check('una cola vacía o con una carpeta no rompe nada', await lp.evaluate(async () => (await LMD.install.openLaunched({ files: [] }, () => ({}))) === false && (await LMD.install.openLaunched(null, () => ({}))) === false && (await LMD.install.openLaunched({ files: [await navigator.storage.getDirectory()] }, () => ({}))) === false));
  await lp.close();

  check('sin errores de página', errors.length === 0 && R.errors.length === 0, errors.concat(R.errors).slice(0, 6));
  check('la nube de verdad no se tocó', R.outside.length === 0, R.outside.slice(0, 4));
  bad = done();
} catch (e) {
  console.error(e);
} finally {
  await ctx.close().catch(() => {});
  await R.close().catch(() => {});
  await shut(site).catch(() => {}); await shut(other).catch(() => {});
  for (const d of [ext, profile, disk].concat(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sharpmd-out-')).map((n) => path.join(os.tmpdir(), n)))) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows suelta la carpeta después */ } }
}
process.exit(bad ? 1 : 0);
