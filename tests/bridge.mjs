// Un solo depósito entre la app web y la extensión, el botón de la extensión, sin conexión y "Abrir con".
//
// La extensión de verdad solo le habla a https://sharpmd.app. Para probarla con la web servida en local se arma una
// copia en una carpeta temporal con dos cambios: el script de contenido del puente apunta a 127.0.0.1 y la dirección
// de la app web es la del servidor de la prueba. El código publicado no tiene ninguna puerta para eso.
// Uso: node bridge.mjs
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';
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
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const R = await rig();
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
  check('sin la extensión: no hay dónde elegir, y un botón lleva a conseguirla', J(np.heads) === J(['Chrome extension', 'Install as an app', 'Open .md files with a double click']) && np.radios.length === 0 && /Not in this browser\./.test(np.text) && np.links.some((l) => l === 'Get the extension https://github.com/MR-Axel/sharpmd#install'), np);
  check('sin aviso del navegador, dice cómo instalarla desde el menú', /From the browser menu: Install SharpMD\./.test(np.text) && !np.buttons.includes('Install') && /Its own window and "Open with" for \.md files on Windows\./.test(np.text));
  await sp.evaluate(() => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { window.__prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) })); });
  await sp.waitForSelector('[data-inst=app]', { timeout: 4000 }).catch(() => {});
  check('cuando el navegador lo permite, aparece el botón Instalar', (await paneOf(sp)).buttons.includes('Install'));
  await sp.click('[data-inst=app]'); await sp.waitForFunction(() => /Already installed\./.test(document.querySelector('[data-inst-pane]').textContent), null, { timeout: 4000 }).catch(() => {});
  check('el botón dispara la instalación y después dice que ya está instalada', (await sp.evaluate(() => window.__prompted === true)) && /Already installed\./.test((await paneOf(sp)).text));
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
  for (const d of [ext, profile]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows suelta la carpeta después */ } }
}
process.exit(bad ? 1 : 0);
