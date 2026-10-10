// El explorador: pasar de un archivo a otro no recarga la página. Sobre un .md abierto directo (file://) el otro
// archivo se lee y se dibuja en el lugar, con el archivo a la vista en el fragmento (#lmd-file=...) para que
// recargar, atrás y adelante lo vuelvan a mostrar; un .txt, un .json o un .yaml de la carpeta se abren dentro de
// SharpMD y se guardan en su formato. En la app, con una carpeta abierta, lo mismo. Con tiempos del clic al pintado.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
import { tally, sleep, root } from './rig.mjs';
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(60); } };
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ---------- La carpeta de prueba, en el disco de verdad ----------
const disk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-exp-')));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-expp-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const BIG = '# Big\n\n' + Array.from({ length: 3000 }, (_, i) => (i % 50 === 0 ? '## Section ' + i + '\n\n' : '') + 'Paragraph number ' + i + ' with some **bold** text and a [link](b.md).').join('\n\n') + '\n';
const FILES = {
  'a.md': '# Alpha\n\nFirst file. Links: [text](notes.txt), [data](data.json), [deep](sub/c.md), [beta](b.md), [ghost](ghost.md).\n\nfindme-alpha\n',
  'b.md': '# Beta\n\nSecond file. findme-beta\n\n## Part two\n\nMore.\n',
  'big.md': BIG,
  'notes.txt': 'plain line one\n<b>not html</b>\n# not a heading\n',
  'crlf.txt': 'one\r\ntwo\r\n',
  'data.json': '{\n  "name": "sharp",\n  "n": 1\n}\n',
  'conf.yaml': 'a: 1\nb: two\n',
  'sub/c.md': '# Gamma\n\n![dot](dot.png)\n\n[up](../b.md) and [side](side.txt)\n',
  'sub/side.txt': 'side text\n',
};
for (let i = 1; i <= 40; i++) FILES['n' + String(i).padStart(2, '0') + '.md'] = '# Note ' + i + '\n\nBody ' + i + '.\n';
fs.mkdirSync(path.join(disk, 'sub'));
for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(disk, name), text);
fs.writeFileSync(path.join(disk, 'pic.png'), PNG); fs.writeFileSync(path.join(disk, 'sub', 'dot.png'), PNG);
const U = (name) => pathToFileURL(path.join(disk, name)).href;
const onDisk = (name) => fs.readFileSync(path.join(disk, name), 'utf8');

// La misma carpeta servida por un sitio, sin listado: un .md ahí sí puede tomar su dirección real.
const TYPES = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.yaml': 'application/yaml', '.png': 'image/png' };
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''); const file = path.join(disk, rel);
  // Un archivo que no está responde 200 con una página, como hacen muchos sitios: eso no es una nota.
  if (!file.startsWith(disk) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Not here</title><p id="nothere">Not here</p>'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const WEB = 'http://127.0.0.1:' + site.address().port + '/';

const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  // El acceso a file:// se da desde la página de extensiones, como lo haría una persona.
  const admin = await ctx.newPage();
  await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
  await admin.evaluate(async () => { for (const e of await chrome.developerPrivate.getExtensionsInfo()) await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: e.id, fileAccess: true }); });
  await admin.close();
  // Todo a la vista en el explorador (no solo Markdown), la barra más ancha que de fábrica y la herramienta de JSON prendida.
  const setting = (patch) => sw.evaluate((x) => new Promise((resolve) => chrome.storage.local.get('settings', (got) => chrome.storage.local.set({ settings: Object.assign({}, got.settings || {}, x, { tools: Object.assign({}, (got.settings || {}).tools, x.tools) }) }, resolve))), patch);
  await setting({ filesOnlyMarkdown: false, sidebarWidth: 360, tools: { jsonyaml: true } });

  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  // El mundo del script de contenido: ahí viven LMD y la ventana que ve el lector. Se usa para simular la carpeta
  // que la persona elige al guardar: lee por la extensión y escribe en el disco de verdad a través de la prueba.
  const cdp = await ctx.newCDPSession(page); let world = 0;
  cdp.on('Runtime.executionContextCreated', (e) => { const c = e.context; if (c.auxData && c.auxData.type === 'isolated' && c.origin === 'chrome-extension://' + id) world = c.id; });
  await cdp.send('Runtime.enable');
  const inExt = async (fn, arg) => { const r = await cdp.send('Runtime.evaluate', { expression: '(' + fn + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')', contextId: world, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value; };
  await cdp.send('Runtime.addBinding', { name: '__diskWrite', executionContextName: 'SharpMD: Markdown reader & editor' });
  const wrote = [];
  cdp.on('Runtime.bindingCalled', (e) => {
    if (e.name !== '__diskWrite') return;
    const m = JSON.parse(e.payload); const file = decodeURIComponent(new URL(m.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
    fs.writeFileSync(file, m.text); wrote.push(path.relative(disk, file).replace(/\\/g, '/'));
    cdp.send('Runtime.evaluate', { expression: 'window.__wroteDone && window.__wroteDone()', contextId: e.executionContextId }).catch(() => {});
  });
  const armPicker = () => inExt((base) => {
    const read = (url) => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'fetchText', url }, (r) => resolve(r && r.ok ? r.text : null)));
    const gone = () => Object.assign(new Error('not there'), { name: 'NotFoundError' });
    const perm = { queryPermission: async () => 'granted', requestPermission: async () => 'granted' };
    const file = (url, name) => Object.assign({ kind: 'file', name,
      getFile: async () => { const t = await read(url); if (t == null) throw gone(); return { name, size: t.length, lastModified: 0, text: async () => t }; },
      createWritable: async () => { let buf = ''; return { write: async (t) => { buf = String(t); }, close: () => new Promise((resolve) => { window.__wroteDone = resolve; window.__diskWrite(JSON.stringify({ url, text: buf })); }) }; } }, perm);
    const dir = (url) => Object.assign({ kind: 'directory', name: 'folder',
      getDirectoryHandle: async (n) => dir(url + encodeURIComponent(n) + '/'),
      getFileHandle: async (n) => { const u = url + encodeURIComponent(n); if ((await read(u)) == null) throw gone(); return file(u, n); } }, perm);
    window.__picked = 0;
    window.showDirectoryPicker = async () => { window.__picked++; return dir(base); };
  }, U('a.md').replace(/a\.md$/, ''));

  const open = async (name, hash) => { if (hash) await page.goto('about:blank'); await page.goto(U(name) + (hash || '')); await page.waitForSelector('.lmd-article'); await page.waitForSelector('.lmd-node[data-url$="/a.md"]'); await sleep(350); };
  const state = () => page.evaluate(() => ({
    title: document.title, name: document.querySelector('.lmd-docname').textContent, h1: (document.querySelector('.lmd-article h1') || { textContent: '' }).textContent.trim(),
    url: location.href, keep: window.__keep === 1, active: [...document.querySelectorAll('.lmd-node.lmd-active')].map((n) => n.textContent.trim()),
    plain: (document.querySelector('.lmd-article .lmd-plain') || { textContent: null }).textContent, splash: !!document.querySelector('#lmd-splash'),
    dirty: document.documentElement.classList.contains('lmd-dirty'), focus: document.activeElement && document.activeElement.classList.contains('lmd-node') ? document.activeElement.textContent.trim() : '',
  }));
  const shows = (title, ms) => until(() => page.evaluate((t) => document.title === t && document.querySelector('.lmd-docname').textContent === t && !!document.querySelector('.lmd-article'), title), ms || 8000);
  const node = (name) => '.lmd-node[data-url$="/' + name + '"]';
  const keep = () => page.evaluate(() => { window.__keep = 1; });
  const said = () => page.evaluate(() => document.querySelector('.lmd-foot .lmd-status').textContent);

  // ---------- Sobre un .md del disco ----------
  console.log('Sobre un archivo del disco: el explorador');
  await open('a.md');
  const kinds = await page.evaluate(() => { const o = {}; document.querySelectorAll('.lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node').forEach((n) => { o[n.textContent.trim()] = [n.dataset.kind, (n.querySelector('.lmd-node-ico') || { innerHTML: '' }).innerHTML, n.getAttribute('href') || '']; }); return o; });
  check('el explorador lista Markdown, texto, datos y lo demás', ['a.md', 'b.md', 'notes.txt', 'data.json', 'conf.yaml', 'pic.png', 'sub'].every((n) => kinds[n]), Object.keys(kinds).slice(0, 12));
  check('y cada uno dice qué es', kinds['a.md'][0] === 'md' && kinds['notes.txt'][0] === 'txt' && kinds['data.json'][0] === 'data' && kinds['conf.yaml'][0] === 'data' && kinds['pic.png'][0] === 'image' && kinds.sub[0] === 'dir', Object.entries(kinds).slice(0, 8).map(([k, v]) => [k, v[0]]));
  check('con un ícono distinto para Markdown, texto, datos y el resto', new Set([kinds['a.md'][1], kinds['notes.txt'][1], kinds['data.json'][1], kinds['pic.png'][1]]).size === 4 && kinds['data.json'][1] === kinds['conf.yaml'][1] && kinds['a.md'][1] === kinds['b.md'][1] && /^<svg/.test(kinds['notes.txt'][1]));
  check('un .txt lleva la dirección que lo abre dentro de SharpMD; un .md y una imagen, la suya', kinds['notes.txt'][2] === U('a.md') + '#lmd-file=notes.txt' && kinds['b.md'][2] === U('b.md') && kinds['pic.png'][2] === U('pic.png'), [kinds['notes.txt'][2], kinds['b.md'][2]]);
  const push = await page.evaluate((to) => { try { history.pushState(null, '', to); return 'ok'; } catch (e) { return e.name; } }, U('b.md'));
  check('Chrome no deja que una página file:// lleve su dirección a otro archivo: por eso el fragmento', push === 'SecurityError', push);

  console.log('Cambiar de archivo no recarga la página');
  // Una carpeta desplegada, el explorador corrido hacia abajo y un valor en la ventana: todo tiene que seguir ahí.
  await page.click(node('sub/')); await page.waitForSelector(node('sub/c.md'));
  await keep();
  const pane = '.lmd-pane-files';
  await page.evaluate((sel) => { const p = document.querySelector(sel); p.scrollTop = Math.round((p.scrollHeight - p.clientHeight) / 2); }, pane); await sleep(150);
  const before = await page.evaluate((sel) => { const p = document.querySelector(sel); const box = p.getBoundingClientRect(); const vis = [...document.querySelectorAll('a.lmd-node')].filter((n) => { const r = n.getBoundingClientRect(); return r.top > box.top + 30 && r.bottom < box.bottom - 60; }); return { y: p.scrollTop, max: p.scrollHeight - p.clientHeight, pick: vis[1].textContent.trim(), next: vis[2].textContent.trim(), w: getComputedStyle(document.documentElement).getPropertyValue('--lmd-side-w').trim(), theme: document.documentElement.className.replace(/\blmd-(dirty|editing|searching|held)\b/g, '').trim() }; }, pane);
  check('el explorador tiene para correr y la barra tomó el ancho elegido', before.max > 200 && before.y > 100 && before.w === '360px' && /^n\d\d\.md$/.test(before.pick), before);
  await page.click(node(before.pick));
  await shows(before.pick);
  const s1 = await state();
  const after = await page.evaluate((sel) => ({ y: document.querySelector(sel).scrollTop, open: [...document.querySelectorAll('.lmd-node-dir.lmd-open')].map((n) => n.textContent.trim()), sub: !!document.querySelector('.lmd-node[data-url$="/sub/c.md"]') && !!document.querySelector('.lmd-node[data-url$="/sub/c.md"]').offsetParent, w: getComputedStyle(document.documentElement).getPropertyValue('--lmd-side-w').trim(), theme: document.documentElement.className.replace(/\blmd-(dirty|editing|searching|held)\b/g, '').trim(), pre: document.querySelectorAll('body > pre').length }), pane);
  check('tocar un archivo lo abre sin recargar: lo que había en la ventana sigue ahí', s1.keep && s1.title === before.pick && s1.h1 === 'Note ' + Number(before.pick.slice(1, 3)) && !s1.splash && after.pre === 0, s1);
  check('la dirección lleva el archivo a la vista en el fragmento', s1.url === U('a.md') + '#lmd-file=' + before.pick, s1.url);
  check('el explorador marca el archivo abierto, y solo ese', J(s1.active) === J([before.pick]), s1.active);
  check('la carpeta desplegada sigue desplegada y el explorador no se movió', after.open.includes('sub') && after.sub && Math.abs(after.y - before.y) < 3, [before.y, after]);
  check('el ancho de la barra y el tema quedan como estaban', after.w === '360px' && after.theme === before.theme, [after.w, after.theme, before.theme]);
  const where1 = await page.evaluate(() => document.activeElement === document.body || !document.querySelector('.lmd-sidebar').contains(document.activeElement));
  check('con el mouse el foco pasa al documento: Espacio y AvPág lo mueven a él', s1.focus === '' && where1, s1.focus);
  await page.focus(node(before.pick)); await page.keyboard.press('ArrowDown');
  const f2 = (await state()).focus;
  await page.keyboard.press('Enter'); await shows(before.next);
  const s2 = await state();
  check('flecha abajo pasa al siguiente y Enter lo abre, también sin recargar', f2 === before.next && s2.title === before.next && s2.keep && s2.focus === before.next && s2.url.endsWith('#lmd-file=' + before.next), [f2, s2]);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await shows(before.pick);
  check('y flecha arriba vuelve al anterior', (await state()).title === before.pick && (await state()).keep);
  // Derecha e izquierda sobre una carpeta la despliegan y la pliegan; izquierda sobre un archivo va a su carpeta.
  await page.focus(node('sub/c.md')); await page.keyboard.press('ArrowLeft');
  const onDir = await page.evaluate(() => document.activeElement.dataset.kind + ':' + document.activeElement.classList.contains('lmd-open'));
  await page.keyboard.press('ArrowLeft'); const shut = await page.evaluate(() => document.activeElement.classList.contains('lmd-open'));
  await page.keyboard.press('ArrowRight'); const reopened = await page.evaluate(() => document.activeElement.classList.contains('lmd-open'));
  check('izquierda va a la carpeta y la pliega, derecha la despliega', onDir === 'dir:true' && shut === false && reopened === true, [onDir, shut, reopened]);

  console.log('Atrás, adelante y recargar');
  await page.goBack(); await shows(before.next);
  const b1 = await state();
  check('atrás muestra el archivo anterior, sin recargar', b1.title === before.next && b1.keep && J(b1.active) === J([before.next]), b1);
  await page.goBack(); await shows(before.pick); await page.goBack(); await shows('a.md');
  const b2 = await state();
  check('y hasta el archivo que cargó el navegador, con su dirección limpia', b2.title === 'a.md' && b2.h1 === 'Alpha' && b2.url === U('a.md') && b2.keep, b2);
  await page.goForward(); await shows(before.pick);
  const b3 = await state();
  check('adelante vuelve al siguiente', b3.title === before.pick && b3.keep && b3.url === U('a.md') + '#lmd-file=' + before.pick, b3);
  await page.reload(); await page.waitForSelector('.lmd-article'); await shows(before.pick); await page.waitForSelector('.lmd-node.lmd-active'); await sleep(300);
  const r1 = await state();
  check('recargar vuelve a mostrar el archivo que se estaba viendo, no el que cargó el navegador', !r1.keep && r1.title === before.pick && r1.h1 === 'Note ' + Number(before.pick.slice(1, 3)) && r1.url === U('a.md') + '#lmd-file=' + before.pick && J(r1.active) === J([before.pick]), r1);
  const copied = r1.url; const other = await ctx.newPage(); other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(copied); await other.waitForSelector('.lmd-article');
  const o1 = await until(() => other.evaluate((t) => document.title === t && document.querySelector('.lmd-article h1').textContent.trim(), before.pick));
  check('y la dirección copiada abre ese mismo archivo en otra pestaña', o1 === 'Note ' + Number(before.pick.slice(1, 3)), o1);
  await other.close();
  await open('a.md', '#lmd-file=gone.md');
  const g1 = await state();
  check('un fragmento a un archivo que ya no está deja el que cargó el navegador, lo dice y limpia la dirección', g1.title === 'a.md' && g1.h1 === 'Alpha' && g1.url === U('a.md') && /Could not find "gone\.md"/.test(await said()), [g1, await said()]);
  await open('a.md', '#lmd-file=pic.png');
  check('y uno a algo que SharpMD no dibuja no se sigue', (await state()).title === 'a.md' && (await state()).h1 === 'Alpha');
  await open('a.md', '#lmd-file=https://example.com/x.md');
  check('ni uno que apunta fuera del disco', (await state()).title === 'a.md' && (await state()).h1 === 'Alpha');
  await open('a.md', '#lmd-file=sub/c.md'); await page.waitForSelector('.lmd-node.lmd-active');
  const g2 = await state();
  // Escribir otro fragmento con la página ya abierta tampoco recarga: si el archivo no está, queda el que se veía.
  await keep(); await page.goto(U('a.md') + '#lmd-file=gone.md'); await sleep(700);
  const g3 = await state();
  check('y pedir por la dirección uno que no está, con otro a la vista, deja ese a la vista y con su dirección', g3.keep && g3.title === 'c.md' && g3.url === U('a.md') + '#lmd-file=sub/c.md' && /Could not find "gone\.md"/.test(await said()), [g3, await said()]);
  check('un fragmento a una subcarpeta abre ese archivo, con el árbol desplegado hasta él', g2.title === 'c.md' && g2.h1 === 'Gamma' && J(g2.active) === J(['c.md']), g2);

  console.log('Texto, JSON y YAML se abren dentro de SharpMD');
  await open('a.md'); await keep();
  await page.click(node('notes.txt')); await shows('notes.txt');
  const t1 = await state(); const t1x = await page.evaluate(() => ({ b: document.querySelectorAll('.lmd-article b').length, h: document.querySelectorAll('.lmd-article h1').length }));
  check('un .txt del explorador se abre en el lector, sin recargar, como texto plano', t1.keep && t1.plain === FILES['notes.txt'] && t1.url === U('a.md') + '#lmd-file=notes.txt' && J(t1.active) === J(['notes.txt']), t1);
  check('y su contenido no se interpreta: ni HTML ni Markdown', t1x.b === 0 && t1x.h === 0, t1x);
  await page.click(node('data.json')); await shows('data.json');
  const j1 = await until(() => page.evaluate(() => { const c = document.querySelector('.lmd-article .lmd-code code'); return c && document.querySelector('.lmd-article .lmd-jy') ? { code: c.textContent, lang: (document.querySelector('.lmd-code-lang') || {}).textContent, keys: [...document.querySelectorAll('.lmd-jy .lmd-jy-k')].map((k) => k.textContent) } : null; }));
  check('un .json se abre en el lector, con su árbol', !!j1 && j1.code.trim() === FILES['data.json'].trim() && j1.lang === 'json' && j1.keys.join(',').includes('name') && (await state()).keep, j1);
  await page.click(node('conf.yaml')); await shows('conf.yaml');
  const y1 = await until(() => page.evaluate(() => (document.querySelector('.lmd-article .lmd-jy') ? document.querySelector('.lmd-article .lmd-code code').textContent : null)));
  check('y un .yaml también', !!y1 && y1.trim() === FILES['conf.yaml'].trim() && (await state()).keep, y1);
  await page.reload(); await page.waitForSelector('.lmd-article'); await shows('conf.yaml');
  check('recargar sobre un .yaml lo vuelve a mostrar dentro de SharpMD', (await state()).title === 'conf.yaml' && !!(await until(() => page.evaluate(() => !!document.querySelector('.lmd-article .lmd-code code')))));
  // Lo que SharpMD no dibuja se abre como siempre: lo muestra el navegador.
  await open('a.md');
  await Promise.all([page.waitForURL(U('pic.png')), page.click(node('pic.png'))]);
  check('una imagen del explorador la abre el navegador, como antes', page.url() === U('pic.png') && !(await page.$('.lmd-article')), page.url());

  console.log('Los enlaces de una nota a otros archivos de la carpeta');
  await open('a.md'); await keep();
  await page.click('.lmd-article a[href="notes.txt"]'); await shows('notes.txt');
  const l1 = await state();
  check('un enlace relativo a un .txt lo abre dentro de SharpMD, sin recargar', l1.keep && l1.plain === FILES['notes.txt'] && l1.url === U('a.md') + '#lmd-file=notes.txt', l1);
  await page.goBack(); await shows('a.md');
  await page.click('.lmd-article a[href="data.json"]'); await shows('data.json');
  check('y uno a un .json también', (await state()).keep && !!(await until(() => page.evaluate(() => !!document.querySelector('.lmd-article .lmd-code code')))));
  await page.goBack(); await shows('a.md');
  await page.click('.lmd-article a[href="sub/c.md"]'); await shows('c.md');
  const l2 = await until(() => page.evaluate(() => { const i = document.querySelector('.lmd-article img'); return i && i.complete && i.naturalWidth ? { w: i.naturalWidth, src: i.src } : null; }));
  check('en un archivo de otra carpeta abierto en el lugar, las imágenes relativas salen de su carpeta', !!l2 && l2.w === 1 && l2.src === U('sub/dot.png') && (await state()).keep, l2);
  await page.click('.lmd-article a[data-lmd-href="side.txt"]'); await shows('side.txt');
  const l3 = await state();
  check('y sus enlaces relativos también: el .txt de al lado es el de esa carpeta', l3.plain === 'side text\n' && l3.url === U('a.md') + '#lmd-file=sub/side.txt' && l3.keep, l3);
  await page.goBack(); await shows('c.md');
  await page.click('.lmd-article a[data-lmd-href="../b.md"]'); await shows('b.md');
  check('y el que sube una carpeta llega al archivo de arriba', (await state()).h1 === 'Beta' && (await state()).url === U('a.md') + '#lmd-file=b.md' && (await state()).keep);

  console.log('La búsqueda sigue ahí al cambiar de archivo');
  await open('a.md'); await keep();
  await page.fill('.lmd-search input', 'findme'); await page.waitForSelector('.lmd-results .lmd-res-file');
  await until(() => page.evaluate(() => document.querySelectorAll('.lmd-results .lmd-res').length >= 2));
  await page.click('.lmd-results .lmd-res[data-url$="/b.md"] .lmd-res-file'); await shows('b.md');
  const q1 = await page.evaluate(() => ({ q: document.querySelector('.lmd-search input').value, results: document.querySelectorAll('.lmd-results .lmd-res').length, shown: !document.querySelector('.lmd-results').hidden, here: (document.querySelector('.lmd-res-here') || { dataset: {} }).dataset.url || '', count: document.querySelector('.lmd-search-count').textContent, url: location.href, keep: window.__keep === 1 }));
  check('abrir un resultado no recarga y deja la búsqueda y sus resultados a la vista', q1.keep && q1.q === 'findme' && q1.shown && q1.results >= 2 && q1.here === U('b.md') && /1/.test(q1.count) && q1.url === U('a.md') + '#lmd-file=b.md', q1);
  await page.fill('.lmd-search input', ''); await sleep(300);

  console.log('Guardar escribe en el archivo que está a la vista');
  const setValue = async (text) => { await page.click('.lmd-raw-edit'); await page.keyboard.press('Control+A'); await page.keyboard.insertText(text); };
  const typeIn = async (has, text) => { await page.locator('.lmd-article .lmd-editable', { hasText: has }).first().click(); await page.keyboard.press('Control+End'); await page.keyboard.type(text, { delay: 10 }); };
  const blur = () => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  await open('a.md'); await keep(); await armPicker();
  await page.click(node('b.md')); await shows('b.md');
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article .lmd-editable');
  await typeIn('Second file.', ' EDITED'); await blur(); await sleep(200);
  check('editar deja el documento con cambios sin guardar', (await state()).dirty);
  await page.keyboard.press('Control+s'); await page.waitForSelector('.lmd-ask [data-ask=dir]'); await page.click('.lmd-ask [data-ask=dir]');
  await until(() => onDisk('b.md').includes('EDITED'));
  check('guardar escribe en el archivo abierto en el lugar, no en el que cargó el navegador', onDisk('b.md') === FILES['b.md'].replace('findme-beta', 'findme-beta EDITED') && onDisk('a.md') === FILES['a.md'] && J(wrote) === J(['b.md']), [onDisk('b.md'), wrote]);
  await until(async () => !(await state()).dirty);
  check('y queda guardado', !(await state()).dirty && (await state()).keep);
  // Con el permiso ya dado, lo pendiente se guarda al pasar a otro archivo: en el que se deja.
  await typeIn('More.', ' MORE'); await blur(); await sleep(200);
  await page.click(node('n01.md')); await shows('n01.md');
  check('al pasar a otro archivo, lo pendiente se guarda en el que se deja', onDisk('b.md').includes('More. MORE') && onDisk('n01.md') === FILES['n01.md'] && J(wrote) === J(['b.md', 'b.md']) && (await state()).keep && !(await state()).dirty, [wrote, onDisk('b.md').slice(-30)]);
  // Sin permiso para escribir: se pide, y si no se da se pregunta antes de perder lo escrito.
  await page.waitForSelector('.lmd-article .lmd-editable'); // se venía editando: la nota nueva sigue en edición
  await typeIn('Body 1.', ' DRAFT'); await blur(); await sleep(200);
  await page.click(node('n02.md')); await page.waitForSelector('.lmd-ask [data-ask=no]');
  const askTitle = await page.textContent('.lmd-ask h3');
  await page.click('.lmd-ask [data-ask=no]'); await page.waitForSelector('.lmd-dlg-card');
  const dlg = await page.evaluate(() => ({ title: document.querySelector('.lmd-dlg-card h3').textContent, text: document.querySelector('.lmd-dlg-card p').textContent, buttons: [...document.querySelectorAll('.lmd-dlg-card [data-dlg]')].map((b) => b.textContent) }));
  await page.click('.lmd-dlg-card [data-dlg=no]'); await sleep(300);
  const stay = await state(); const stayText = await page.evaluate(() => document.querySelector('.lmd-article').textContent);
  check('con cambios sin guardar y sin permiso, pide el permiso y después pregunta', askTitle === 'Permission to save' && dlg.title === 'Unsaved changes' && /n01\.md/.test(dlg.text) && J(dlg.buttons) === J(['Cancel', 'Leave without saving']), [askTitle, dlg]);
  check('cancelar deja el archivo donde estaba, con lo escrito', stay.title === 'n01.md' && stay.dirty && stayText.includes('Body 1. DRAFT') && stay.url === U('a.md') + '#lmd-file=n01.md' && stay.keep, stay);
  // Atrás con cambios sin guardar: tampoco se pierden, y la dirección vuelve a la del archivo que sigue a la vista.
  await page.goBack(); await page.waitForSelector('.lmd-ask [data-ask=no]'); await page.click('.lmd-ask [data-ask=no]'); await page.waitForSelector('.lmd-dlg-card'); await page.click('.lmd-dlg-card [data-dlg=no]'); await sleep(300);
  const stay2 = await state();
  check('atrás con cambios sin guardar pregunta igual, y al cancelar la dirección sigue siendo la del archivo a la vista', stay2.title === 'n01.md' && stay2.dirty && stay2.url === U('a.md') + '#lmd-file=n01.md' && stay2.keep, stay2);
  await page.click(node('n02.md')); await page.waitForSelector('.lmd-ask [data-ask=no]'); await page.click('.lmd-ask [data-ask=no]'); await page.waitForSelector('.lmd-dlg-card'); await page.click('.lmd-dlg-card [data-dlg=ok]'); await shows('n02.md');
  const left = await state();
  check('salir sin guardar pasa al otro archivo y no escribe nada', left.title === 'n02.md' && !left.dirty && left.keep && onDisk('n01.md') === FILES['n01.md'] && onDisk('n02.md') === FILES['n02.md'] && wrote.length === 2, [left, wrote]);
  await page.click('[data-act=mode-read]'); await sleep(200);

  // Un .txt y un .json se editan como texto y se guardan en su archivo, con sus saltos de línea.
  const names = () => fs.readdirSync(disk).sort().join(',');
  const listed = names();
  await page.click(node('crlf.txt')); await shows('crlf.txt');
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-raw-edit:not([hidden])');
  await page.click('.lmd-raw-edit'); await page.keyboard.press('Control+End'); await page.keyboard.type('three');
  await page.keyboard.press('Control+s'); await page.waitForSelector('.lmd-ask [data-ask=dir]'); await page.click('.lmd-ask [data-ask=dir]');
  await until(() => onDisk('crlf.txt').includes('three'));
  check('un .txt editado se guarda en su .txt, con sus saltos de línea', onDisk('crlf.txt') === 'one\r\ntwo\r\nthree' && wrote[wrote.length - 1] === 'crlf.txt' && names() === listed, [J(onDisk('crlf.txt')), wrote]);
  await until(async () => !(await state()).dirty);
  await page.click('[data-act=mode-read]'); await sleep(200);
  const tAfter = await state();
  check('y de vuelta en lectura muestra lo guardado, como texto', tAfter.plain === 'one\ntwo\nthree' && tAfter.title === 'crlf.txt' && tAfter.keep, tAfter);
  await page.click(node('data.json')); await shows('data.json');
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-raw-edit:not([hidden])');
  const NEWJSON = '{\n  "name": "sharp",\n  "n": 2,\n  "ok": true\n}\n';
  await setValue(NEWJSON);
  await page.keyboard.press('Control+s'); await page.waitForSelector('.lmd-ask [data-ask=dir]'); await page.click('.lmd-ask [data-ask=dir]');
  await until(() => onDisk('data.json').includes('"ok"'));
  check('un .json editado se guarda en su .json, tal cual', onDisk('data.json') === NEWJSON && wrote[wrote.length - 1] === 'data.json' && names() === listed && onDisk('a.md') === FILES['a.md'], [onDisk('data.json'), wrote]);
  await until(async () => !(await state()).dirty);
  await page.click('[data-act=mode-read]'); await sleep(300);
  // Lo que cambia afuera en el archivo a la vista entra solo: se relee ese, no el que cargó el navegador.
  await page.click(node('n03.md')); await shows('n03.md');
  fs.writeFileSync(path.join(disk, 'n03.md'), '# Note 3\n\nChanged outside.\n');
  const fresh = await until(() => page.evaluate(() => document.querySelector('.lmd-article').textContent.includes('Changed outside.')), 6000);
  check('la recarga automática relee el archivo a la vista', !!fresh && (await state()).title === 'n03.md' && (await state()).keep, await state());

  console.log('El explorador se entera solo de lo que cambia en la carpeta');
  const polls = () => page.evaluate(() => +document.documentElement.dataset.lmdTreePolls || 0);
  const tree = () => page.evaluate(() => { const o = {}; document.querySelectorAll('.lmd-tree-box .lmd-node').forEach((n) => { o[decodeURIComponent(n.dataset.url.split('/').slice(n.dataset.kind === 'dir' ? -3 : -2).join('/'))] = n.dataset.kind + (n.classList.contains('lmd-node-new') ? '*' : ''); }); return o; });
  const leaf = (o, name) => Object.keys(o).filter((k) => k.replace(/\/$/, '').endsWith('/' + name)).map((k) => o[k])[0] || '';
  const has = (name, ms) => until(async () => leaf(await tree(), name), ms || 12000);
  const gone = (name, ms) => until(async () => !leaf(await tree(), name), ms || 12000);
  const subCount = () => page.evaluate(() => { const n = document.querySelector('.lmd-node[data-url$="/sub/"] .lmd-node-n'); return n && !n.hidden ? n.dataset.n : ''; });
  await open('a.md'); await keep();
  await page.click(node('sub/')); await page.waitForSelector(node('sub/c.md'));
  await until(async () => (await subCount()) === '2');
  await page.evaluate((sel) => { const p = document.querySelector(sel); p.scrollTop = 120; }, pane); await sleep(150);
  await page.focus(node('n02.md'));
  const k0 = await page.evaluate((sel) => ({ y: document.querySelector(sel).scrollTop, count: (document.querySelector('.lmd-node[data-url$="/sub/"] .lmd-node-n') || { dataset: {} }).dataset.n }), pane);
  const p0 = await polls(); await sleep(4600);
  check('con la pestaña a la vista, el explorador vuelve a mirar la carpeta cada pocos segundos', (await polls()) > p0, [p0, await polls()]);
  fs.writeFileSync(path.join(disk, 'zz-new.md'), '# Brand new\n'); fs.writeFileSync(path.join(disk, 'sub', 'made-by-ai.md'), '# From outside\n'); fs.mkdirSync(path.join(disk, 'zz-dir'));
  const n1 = await has('zz-new.md'); const n2 = await has('made-by-ai.md'); const n3 = await has('zz-dir');
  const k1 = await page.evaluate((sel) => ({ y: document.querySelector(sel).scrollTop, open: [...document.querySelectorAll('.lmd-node-dir.lmd-open')].map((n) => n.textContent.trim()), focus: document.activeElement.classList.contains('lmd-node') ? document.activeElement.textContent.trim() : '', active: [...document.querySelectorAll('.lmd-node.lmd-active')].map((n) => n.textContent.trim()), keep: window.__keep === 1 }), pane);
  check('un archivo creado afuera aparece solo, sin recargar', n1 === 'md*' && k1.keep, [n1, k1.keep]);
  check('también el de una subcarpeta desplegada, y una carpeta nueva', n2 === 'md*' && n3 === 'dir*', [n2, n3]);
  check('lo nuevo queda marcado, y lo que ya estaba no', Object.values(await tree()).filter((v) => v.endsWith('*')).length === 3, await tree());
  check('las carpetas desplegadas, la posición, el foco y el archivo marcado quedan como estaban', k1.open.join() === 'sub' && Math.abs(k1.y - k0.y) < 3 && k1.focus === 'n02.md' && J(k1.active) === J(['a.md']), [k0, k1]);
  check('y el contador de la carpeta se pone al día (cuenta lo que se lista: las notas y la imagen)', k0.count === '3' && !!(await until(async () => (await subCount()) === '4')), [k0.count, await subCount()]);
  check('la marca de nuevo se va sola a los segundos', !!(await until(async () => !Object.values(await tree()).some((v) => v.endsWith('*')), 12000)));
  await page.click(node('zz-new.md')); await shows('zz-new.md');
  check('y el archivo nuevo se abre como cualquier otro', (await state()).h1 === 'Brand new' && (await state()).keep);
  await page.click(node('a.md')); await shows('a.md');
  fs.rmSync(path.join(disk, 'zz-new.md')); fs.rmdirSync(path.join(disk, 'zz-dir')); fs.renameSync(path.join(disk, 'n40.md'), path.join(disk, 'n40-renamed.md'));
  const g1x = await gone('zz-new.md'); const g2x = await gone('zz-dir'); const g3x = await gone('n40.md'); const r40 = await has('n40-renamed.md');
  check('uno borrado afuera desaparece, y uno renombrado cambia de nombre', !!g1x && !!g2x && !!g3x && r40 === 'md*' && (await state()).keep && (await state()).title === 'a.md', [g1x, g2x, g3x, r40]);
  fs.renameSync(path.join(disk, 'n40-renamed.md'), path.join(disk, 'n40.md')); await has('n40.md');
  // Con la pestaña oculta no se mira nada; al volver, enseguida.
  await inExt(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await sleep(600); const ph = await polls();
  fs.writeFileSync(path.join(disk, 'zz-hidden.md'), '# While hidden\n');
  await sleep(9000);
  check('con la pestaña oculta el explorador no sondea', (await polls()) === ph && !leaf(await tree(), 'zz-hidden.md'), [ph, await polls()]);
  await inExt(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check('y al volver a la pestaña se pone al día enseguida', (await has('zz-hidden.md', 2500)) === 'md*' && (await state()).keep, await tree());
  // El botón de la cabecera lo fuerza.
  const refresh = await page.evaluate(() => { const b = document.querySelector('.lmd-zone-files .lmd-zone-head [data-act=tree-refresh]'); return b ? { title: b.title, w: b.getBoundingClientRect().width } : null; });
  fs.writeFileSync(path.join(disk, 'zz-forced.md'), '# Forced\n');
  await page.click('[data-act=tree-refresh]');
  const forced = await has('zz-forced.md', 2500);
  check('el botón Refresh de la cabecera lo fuerza, y lo dice', !!refresh && refresh.title === 'Refresh the file list' && refresh.w > 10 && refresh.w < 48 && !!forced && /File list refreshed/.test(await said()) && (await state()).keep, [refresh, forced, await said()]);
  fs.rmSync(path.join(disk, 'zz-hidden.md')); fs.rmSync(path.join(disk, 'zz-forced.md')); fs.rmSync(path.join(disk, 'sub', 'made-by-ai.md'));
  // El archivo abierto se borra afuera, con cambios sin guardar: se avisa y lo escrito sigue ahí.
  await page.click(node('n05.md')); await shows('n05.md');
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article .lmd-editable');
  await typeIn('Body 5.', ' UNSAVED'); await blur(); await sleep(200);
  await page.evaluate(() => { window.__said = []; const n = document.querySelector('.lmd-foot .lmd-status'); new MutationObserver(() => { if (n.textContent) window.__said.push(n.textContent); }).observe(n, { childList: true, characterData: true, subtree: true }); });
  fs.rmSync(path.join(disk, 'n05.md'));
  const told = await until(() => page.evaluate(() => window.__said.find((t) => /no longer in the folder/.test(t))), 12000);
  const d5 = await state(); const d5text = await page.evaluate(() => ({ text: document.querySelector('.lmd-article').textContent, gone: document.documentElement.classList.contains('lmd-doc-gone'), node: !!document.querySelector('.lmd-node[data-url$="/n05.md"]') }));
  check('si el archivo abierto se borra afuera, se avisa', told === '"n05.md" is no longer in the folder. What you see is still here.' && d5text.gone && !d5text.node, [told, d5text.gone]);
  check('y lo escrito sin guardar sigue a la vista, sin recargar', d5.title === 'n05.md' && d5.dirty && d5text.text.includes('Body 5. UNSAVED') && d5.keep, d5);
  await sleep(5000);
  check('el aviso sale una sola vez', (await page.evaluate(() => window.__said.filter((t) => /no longer in the folder/.test(t)).length)) === 1);
  await page.click(node('n06.md')); await page.waitForSelector('.lmd-ask [data-ask=no]'); await page.click('.lmd-ask [data-ask=no]'); await page.waitForSelector('.lmd-dlg-card'); await page.click('.lmd-dlg-card [data-dlg=ok]'); await shows('n06.md');
  await page.click('[data-act=mode-read]'); await sleep(200);
  fs.writeFileSync(path.join(disk, 'n05.md'), FILES['n05.md']);
  // El archivo que cargó el navegador desaparece mientras se mira otro: la sesión sigue.
  fs.renameSync(path.join(disk, 'a.md'), path.join(disk, 'a-moved.md'));
  await gone('a.md');
  await page.click(node('n07.md')); await shows('n07.md');
  const h7 = await state();
  check('si desaparece el archivo que cargó el navegador, se sigue pasando de un archivo a otro', h7.h1 === 'Note 7' && h7.keep && h7.url === U('a.md') + '#lmd-file=n07.md' && !(await page.evaluate(() => document.documentElement.classList.contains('lmd-doc-gone'))), h7);
  fs.renameSync(path.join(disk, 'a-moved.md'), path.join(disk, 'a.md')); await has('a.md');

  console.log('Tiempos sobre un archivo del disco, del clic al documento pintado');
  const timeTo = async (p, sel, title, h1) => {
    const t0 = Date.now();
    await p.click(sel);
    await p.waitForFunction(([t, h]) => { const x = document.querySelector('.lmd-article h1'); return document.title === t && !!x && x.textContent.trim() === h && !!document.querySelector('.lmd-node.lmd-active'); }, [title, h1], { polling: 'raf', timeout: 30000 });
    return Date.now() - t0;
  };
  const runs = { small: [], big: [] };
  for (let k = 0; k < 5; k++) {
    await page.click(node('a.md')); await shows('a.md'); await sleep(250);
    runs.small.push(await timeTo(page, node('b.md'), 'b.md', 'Beta'));
    await page.click(node('a.md')); await shows('a.md'); await sleep(250);
    runs.big.push(await timeTo(page, node('big.md'), 'big.md', 'Big'));
  }
  console.log('  en el lugar: chico ' + J(runs.small) + ' ms, 3.000 bloques ' + J(runs.big) + ' ms');
  // Lo de antes, para comparar: la misma carpeta, navegando a la dirección del otro archivo (página nueva entera).
  const nav = { small: [], big: [] };
  for (let k = 0; k < 3; k++) {
    for (const [key, name, h1] of [['small', 'b.md', 'Beta'], ['big', 'big.md', 'Big']]) {
      await open('a.md');
      const t0 = Date.now();
      await page.evaluate((u) => { location.href = u; }, U(name));
      await page.waitForFunction(([t, h]) => { const x = document.querySelector('.lmd-article h1'); return document.title === t && !!x && x.textContent.trim() === h && !!document.querySelector('.lmd-node.lmd-active'); }, [name, h1], { polling: 'raf', timeout: 30000 });
      nav[key].push(Date.now() - t0);
    }
  }
  console.log('  navegando (como antes): chico ' + J(nav.small) + ' ms, 3.000 bloques ' + J(nav.big) + ' ms');
  check('un archivo chico cambia en un instante', median(runs.small) < 250, runs.small);
  check('y uno de 3.000 bloques, en lo que tarda en dibujarse', median(runs.big) < 3000, runs.big);
  check('en el lugar no tarda más que navegar', median(runs.small) <= median(nav.small) + 30 && median(runs.big) <= median(nav.big) + 150, [runs, nav]);

  // ---------- Un .md servido por un sitio ----------
  console.log('Sobre un .md de un sitio');
  const web = await ctx.newPage(); web.on('pageerror', (e) => errors.push(e.message));
  const wstate = () => web.evaluate(() => ({ title: document.title, h1: (document.querySelector('.lmd-article h1') || { textContent: '' }).textContent.trim(), url: location.href, keep: window.__keep === 1, plain: (document.querySelector('.lmd-article .lmd-plain') || { textContent: null }).textContent }));
  const wshows = (title) => until(() => web.evaluate((t) => document.title === t && !!document.querySelector('.lmd-article'), title));
  await web.goto(WEB + 'a.md'); await web.waitForSelector('.lmd-article h1'); await sleep(400); await web.evaluate(() => { window.__keep = 1; });
  await web.click('.lmd-article a[href="b.md"]'); await wshows('b.md');
  const w1 = await wstate();
  check('un enlace a otro Markdown del sitio se abre en el lugar y toma su dirección real', w1.keep && w1.h1 === 'Beta' && w1.url === WEB + 'b.md', w1);
  await web.goBack(); await wshows('a.md');
  check('atrás vuelve, sin recargar', (await wstate()).keep && (await wstate()).h1 === 'Alpha' && (await wstate()).url === WEB + 'a.md', await wstate());
  await web.click('.lmd-article a[href="notes.txt"]'); await wshows('notes.txt');
  const w2 = await wstate();
  check('un .txt del sitio se abre dentro de SharpMD, con el archivo en el fragmento', w2.keep && w2.plain === FILES['notes.txt'] && w2.url === WEB + 'a.md#lmd-file=notes.txt', w2);
  await web.reload(); await web.waitForSelector('.lmd-article'); await wshows('notes.txt');
  check('y recargar lo vuelve a mostrar', (await wstate()).plain === FILES['notes.txt'] && !(await wstate()).keep, await wstate());
  await web.goto(WEB + 'a.md'); await web.waitForSelector('.lmd-article h1'); await sleep(400);
  await Promise.all([web.waitForURL(WEB + 'ghost.md'), web.click('.lmd-article a[href="ghost.md"]')]);
  check('lo que el sitio responde con una página no se dibuja como nota: lo abre el navegador', web.url() === WEB + 'ghost.md' && !(await web.$('.lmd-article')) && !!(await web.$('#nothere')), web.url());
  await web.close();

  // ---------- La app, con una carpeta abierta ----------
  console.log('La app con una carpeta: ya cambiaba en el lugar');
  const app = await ctx.newPage(); app.on('pageerror', (e) => errors.push(e.message));
  await app.goto('chrome-extension://' + id + '/src/app.html'); await app.waitForSelector('.lmd-home');
  await app.evaluate(async ([files, big, png]) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp', { create: true });
    const put = async (d, n, t) => { const h = await d.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(t); await w.close(); };
    for (const [n, t] of Object.entries(files)) { if (n.startsWith('sub/')) await put(await dir.getDirectoryHandle('sub', { create: true }), n.slice(4), t); else await put(dir, n, t); }
    await put(dir, 'big.md', big);
    await put(dir, 'report.docx', new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0, 1, 2, 3]));
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)); await put(dir, 'pic.png', bytes); await put(await dir.getDirectoryHandle('sub', { create: true }), 'dot.png', bytes);
    window.showDirectoryPicker = async () => dir;
  }, [Object.fromEntries(Object.entries(FILES).filter(([n]) => n !== 'big.md')), BIG, PNG.toString('base64')]);
  await app.click('[data-home=dir]'); await app.waitForSelector(node('a.md')); await sleep(600);
  const ashows = (title) => until(() => app.evaluate((t) => document.title === t, title));
  const astate = () => app.evaluate(() => ({ title: document.title, h1: (document.querySelector('.lmd-article h1') || { textContent: '' }).textContent.trim(), url: location.href, keep: window.__keep === 1, plain: (document.querySelector('.lmd-article .lmd-plain') || { textContent: null }).textContent, splash: !!document.querySelector('#lmd-splash'), text: document.querySelector('.lmd-article').textContent,
    focus: document.activeElement && document.activeElement.classList.contains('lmd-node') ? document.activeElement.textContent.trim() : '', open: [...document.querySelectorAll('.lmd-node-dir.lmd-open')].map((n) => n.textContent.trim()), dlg: !!document.querySelector('.lmd-imp') }));
  await app.click(node('a.md')); await ashows('a.md');
  await app.click(node('sub/')); await app.waitForSelector(node('sub/c.md'));
  await app.evaluate(() => { window.__keep = 1; });
  const ay0 = await app.evaluate((sel) => { const p = document.querySelector(sel); p.scrollTop = 150; return p.scrollTop; }, pane); await sleep(150);
  // Uno que ya está a la vista: así el clic no corre el explorador por su cuenta.
  const apick = await app.evaluate((sel) => { const box = document.querySelector(sel).getBoundingClientRect(); const vis = [...document.querySelectorAll('a.lmd-node[data-kind=md]')].filter((n) => { const r = n.getBoundingClientRect(); return /^n\d+\.md$/.test(n.textContent.trim()) &&r.top > box.top + 30 && r.bottom < box.bottom - 60; }); return [vis[1].textContent.trim(), vis[2].textContent.trim()]; }, pane);
  const anum = (n) => 'Note ' + Number(n.slice(1, 3));
  await app.click(node(apick[0])); await ashows(apick[0]);
  const a1 = await astate(); const ay1 = await app.evaluate((sel) => document.querySelector(sel).scrollTop, pane);
  check('en la app, tocar un archivo de la carpeta no recarga ni muestra la pantalla de carga', a1.keep && a1.h1 === anum(apick[0]) && !a1.splash, a1);
  check('la carpeta desplegada y la posición del explorador quedan como estaban', a1.open.includes('sub') && ay0 > 100 && Math.abs(ay1 - ay0) < 3, [ay0, ay1, a1.open]);
  check('con el mouse el foco pasa al documento', a1.focus === '', a1.focus);
  await app.focus(node(apick[0])); await app.keyboard.press('ArrowDown'); await app.keyboard.press('Enter'); await ashows(apick[1]);
  check('con el teclado, las flechas y Enter recorren los archivos y el foco se queda en el explorador', (await astate()).focus === apick[1] && (await astate()).keep && (await astate()).h1 === anum(apick[1]), await astate());
  const akinds = await app.evaluate(() => { const o = {}; document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node').forEach((n) => { o[n.textContent.trim()] = n.dataset.kind; }); return o; });
  check('en la app el explorador también distingue Markdown, texto, datos y el resto', akinds['a.md'] === 'md' && akinds['notes.txt'] === 'txt' && akinds['data.json'] === 'data' && akinds['conf.yaml'] === 'data' && akinds['report.docx'] === 'office' && akinds['pic.png'] === 'image' && akinds.sub === 'dir', akinds);
  // El interruptor "Solo Markdown" de la cabecera del panel: muestra y oculta lo que no es una nota, y el contador lo sigue.
  const shownNow = () => app.evaluate(() => { const o = {}; document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node').forEach((n) => { o[n.textContent.trim().replace(/\d+$/, '')] = (n.querySelector('.lmd-node-n') || { dataset: {} }).dataset.n || ''; }); return { names: Object.keys(o), sub: o.sub, pressed: document.querySelector('.lmd-tree-only').getAttribute('aria-pressed') }; });
  await until(async () => (await shownNow()).sub === '3'); const sw0 = await shownNow();
  await app.click('.lmd-tree-only'); await until(async () => !(await shownNow()).names.includes('pic.png') && (await shownNow()).sub === '2'); const sw1 = await shownNow();
  check('el interruptor Solo Markdown oculta lo que no es una nota, y el contador de la carpeta lo sigue', sw0.pressed === "false" && sw0.names.includes("pic.png") && sw0.names.includes("data.json") && sw0.sub === "3" && sw1.pressed === "true" && !sw1.names.includes("pic.png") && !sw1.names.includes("data.json") && !sw1.names.includes("report.docx") && sw1.names.includes("notes.txt") && sw1.sub === "2", [sw0.pressed, sw0.sub, sw1.pressed, sw1.sub, sw1.names.filter((n) => !/^n\d/.test(n))]);
  await app.click('.lmd-tree-only'); await until(async () => (await shownNow()).names.includes('pic.png'));
  check('y apagado vuelve a mostrar todo lo que la app abre', (await shownNow()).pressed === 'false' && (await shownNow()).names.includes('report.docx'));
  await app.click(node('pic.png')); await until(() => app.evaluate(() => !!document.querySelector('.lmd-vw-stage img') && document.querySelector('.lmd-vw-stage img').naturalWidth === 1));
  check('una imagen de la carpeta se ve en el visor, sin salir de la app', await app.evaluate(() => /^blob:/.test(document.querySelector('.lmd-vw-stage img').src) && document.querySelector('.lmd-docname').textContent === 'pic.png' && /1 × 1 px/.test(document.querySelector('.lmd-vw-info').textContent)) && (await astate()).keep);
  await app.click(node('notes.txt')); await ashows('notes.txt');
  check('un .txt se abre en la app, sin recargar', (await astate()).plain === FILES['notes.txt'] && (await astate()).keep, await astate());
  const opfs = (name) => app.evaluate(async (n) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp'); return (await (await dir.getFileHandle(n)).getFile()).text(); }, name);
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-raw-edit:not([hidden])');
  await app.click('.lmd-raw-edit'); await app.keyboard.press('Control+End'); await app.keyboard.type('added line');
  await app.keyboard.press('Control+s');
  const savedTxt = await until(async () => (await opfs('notes.txt')).includes('added line'));
  check('y se guarda en su .txt', !!savedTxt && (await opfs('notes.txt')) === FILES['notes.txt'] + 'added line' && (await opfs('a.md')) === FILES['a.md'], await opfs('notes.txt'));
  await app.click('[data-act=mode-read]'); await sleep(300);
  // Un archivo que SharpMD no dibuja: se abre como siempre, o se ofrece convertirlo si la herramienta está prendida.
  await app.click(node('report.docx')); await ashows('report.docx');
  const d1 = await astate();
  check('un Word no se dibuja: dice que se puede convertir y ofrece Importar a Markdown', /can turn it into a note/.test(d1.text) && !d1.dlg && await app.evaluate(() => !!document.querySelector('.lmd-notice [data-act=import-here]')), d1.text.slice(0, 80));
  await app.click(node('a.md')); await ashows('a.md');
  await setting({ tools: { import: true } }); await sleep(900);
  await app.click(node('report.docx'));
  const d2 = await until(() => app.evaluate(() => !!document.querySelector('.lmd-imp')), 15000);
  check('con Importar a Markdown prendida, tocar un .docx ofrece convertirlo y la nota abierta queda', !!d2 && (await astate()).title === 'a.md' && (await astate()).keep, await astate());
  await app.evaluate(() => { const b = document.querySelector('.lmd-imp [data-imp=cancel]'); if (b) b.click(); }); await sleep(500);
  await app.evaluate(() => { const b = document.querySelector('.lmd-imp [data-imp=cancel]'); if (b) b.click(); }); await sleep(300);
  await setting({ tools: { import: false } }); await sleep(600);
  const afile = (name, text) => app.evaluate(async ([n, t]) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp'); if (t == null) await dir.removeEntry(n); else { const h = await dir.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(t); await w.close(); } }, [name, text]);
  const anode = (name) => app.evaluate((n) => { const x = document.querySelector('.lmd-node[data-url$="/' + n + '"]'); return x ? (x.classList.contains('lmd-node-new') ? 'new' : 'old') : ''; }, name);
  await app.evaluate(() => { window.__keep = 1; });
  await afile('zz-app-new.md', '# App new\n');
  const an1 = await until(() => anode('zz-app-new.md'), 12000);
  check('en la app, un archivo creado afuera en la carpeta abierta aparece solo y marcado', an1 === 'new' && (await astate()).keep && (await astate()).open.includes('sub'), [an1, await astate()]);
  await afile('zz-app-new.md', null);
  check('y uno borrado desaparece', !!(await until(async () => !(await anode('zz-app-new.md')), 12000)) && (await astate()).keep);
  check('la app también tiene el botón Refresh', !!(await app.$('.lmd-zone-files .lmd-zone-head [data-act=tree-refresh]')));
  const aruns = { small: [], big: [] };
  for (let k = 0; k < 5; k++) {
    await app.click(node('a.md')); await ashows('a.md'); await sleep(250);
    aruns.small.push(await timeTo(app, node('b.md'), 'b.md', 'Beta'));
    await app.click(node('a.md')); await ashows('a.md'); await sleep(250);
    aruns.big.push(await timeTo(app, node('big.md'), 'big.md', 'Big'));
  }
  console.log('  la app: chico ' + J(aruns.small) + ' ms, 3.000 bloques ' + J(aruns.big) + ' ms');
  check('en la app un archivo chico cambia en un instante', median(aruns.small) < 250, aruns.small);
  // ---------- El nombre de arriba: renombrar en el lugar, y dónde está el archivo ----------
  console.log('El nombre de arriba: renombrar y dónde está el archivo');
  const status = () => app.evaluate(() => document.querySelector('.lmd-status').textContent);
  const typeName = async (name, key) => { await app.click('.lmd-docname'); await app.waitForSelector('.lmd-docname-input'); await app.fill('.lmd-docname-input', name); await app.keyboard.press(key || 'Enter'); await sleep(500); };
  const inDir = (name) => app.evaluate(async (n) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp'); try { await d.getFileHandle(n); return true; } catch (e) { return false; } }, name);
  const menuOfTitle = async () => { await app.click('.lmd-docname', { button: 'right' }); await app.waitForSelector('.lmd-menu-narrow', { timeout: 2500 }).catch(() => {}); const items = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-narrow button')].map((b) => b.textContent.trim())); await app.keyboard.press('Escape'); await sleep(150); return items; };
  await app.click(node('b.md')); await ashows('b.md');
  await app.click('[data-act=mode-read]').catch(() => {}); await sleep(200);
  await app.click('.lmd-docname'); await sleep(250);
  const readClick = await app.locator('.lmd-docname-input').count();
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-article .lmd-editable');
  await app.click('.lmd-docname'); await app.waitForSelector('.lmd-docname-input', { timeout: 3000 }).catch(() => {});
  const sel = await app.evaluate(() => { const i = document.querySelector('.lmd-docname-input'); return i ? i.value.slice(i.selectionStart, i.selectionEnd) + '|' + i.value : ''; });
  check('leyendo, un clic sobre el nombre no lo edita; editando la nota, un clic lo vuelve un campo con el nombre elegido sin la extensión', readClick === 0 && sel === 'b|b.md', [readClick, sel]);
  await app.fill('.lmd-docname-input', 'never'); await app.keyboard.press('Escape'); await sleep(300);
  check('Escape cancela: el nombre y el archivo quedan como estaban', (await astate()).title === 'b.md' && (await app.textContent('.lmd-docname')) === 'b.md' && await inDir('b.md') && !(await inDir('never.md')));
  await typeName('bad:name');
  const bad1 = await status();
  await typeName('a');
  const bad2 = await status();
  check('un nombre con caracteres inválidos o que ya existe no se aplica, y lo dice', bad1 === 'That name has characters that cannot be used' && bad2 === 'A file with that name already exists' && (await astate()).title === 'b.md' && await inDir('b.md'), [bad1, bad2]);
  await typeName('beta renamed'); await ashows('beta renamed.md');
  const ren = await app.evaluate(() => ({ title: document.title, name: document.querySelector('.lmd-docname').textContent, f: new URLSearchParams(location.search).get('f'), active: (document.querySelector('.lmd-node.lmd-active') || { textContent: '' }).textContent.trim(), h1: document.querySelector('.lmd-article h1').textContent.trim(), keep: window.__keep === 1 }));
  check('Enter renombra el archivo de la carpeta, conservando .md, y todo lo sigue: pestaña, dirección y explorador', ren.title === 'beta renamed.md' && ren.name === 'beta renamed.md' && /\/beta%20renamed\.md$/.test(ren.f) && ren.active === 'beta renamed.md' && ren.h1 === 'Beta' && ren.keep && await inDir('beta renamed.md') && !(await inDir('b.md')), ren);
  const recent = await app.evaluate(async () => (await LMD.store.rootsAll()).map((r) => decodeURIComponent(r.last || '')));
  check('y los recientes apuntan al nombre nuevo', recent.some((l) => /\/beta renamed\.md$/.test(l)), recent);
  const m1 = await menuOfTitle();
  check('el menú del nombre: de una carpeta elegida con el selector no se conoce la ruta, así que solo ofrece renombrar', J(m1) === J(['Rename']), m1);
  // Una nota del navegador.
  await app.evaluate(() => LMD.store.notePut('nota.md', '# Nota\n\ntexto\n'));
  await app.goto('chrome-extension://' + id + '/src/app.html?f=' + encodeURIComponent('local/nota.md') + '&edit=1'); await app.waitForSelector('.lmd-article .lmd-editable');
  await typeName('otra nota'); await ashows('otra nota.md');
  const loc = await app.evaluate(async () => ({ names: (await LMD.store.notesAll()).map((n) => n.name), f: new URLSearchParams(location.search).get('f') }));
  check('una nota del navegador se renombra igual desde el título', loc.names.includes('otra nota.md') && !loc.names.includes('nota.md') && loc.f === 'local/otra%20nota.md', loc);
  // Un archivo suelto, sin su carpeta: se renombra si el navegador sabe mover ese archivo; si no, dice cómo.
  await app.evaluate(async () => { const root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('suelto.md', { create: true }); const w = await h.createWritable(); await w.write('# Suelto\n'); await w.close(); window.__loose = h; await LMD.store.handlesPut({ key: 'root:loose1', root: true, id: 'loose1', kind: 'file', name: h.name, handle: h, at: Date.now(), last: 'loose1/suelto.md' }); });
  await app.goto('chrome-extension://' + id + '/src/app.html?f=' + encodeURIComponent('loose1/suelto.md') + '&edit=1'); await app.waitForSelector('.lmd-article .lmd-editable');
  await typeName('movido'); await sleep(600);
  const loose = await app.evaluate(() => ({ title: document.title, handle: window.__loose ? window.__loose.name : '', dlg: (document.querySelector('.lmd-dlg-card h3') || {}).textContent || '', ok: (document.querySelector('.lmd-dlg-card [data-dlg=ok]') || {}).textContent || '' }));
  check('un archivo suelto se renombra si el navegador puede moverlo; si no, dice que hay que abrir su carpeta', (loose.title === 'movido.md') || (loose.dlg === 'To rename it, open its folder' && loose.ok === 'Open folder'), loose);
  console.log('  archivo suelto: ' + (loose.title === 'movido.md' ? 'el navegador lo movió (FileSystemFileHandle.move)' : 'sin move(): ofrece abrir la carpeta'));
  await app.keyboard.press('Escape');
  // ---------- Abrir una carpeta es leer: el permiso de guardar se pide recién al editar, con un aviso propio ----------
  console.log('Abrir una carpeta no pide escritura; editar sí, con el aviso de la app antes');
  await app.goto('chrome-extension://' + id + '/src/app.html'); await app.waitForSelector('.lmd-home');
  await app.evaluate(async () => {
    // El permiso de escritura, simulado: arranca sin dar, y cada pedido queda anotado.
    window.__perm = { write: 'prompt', read: 'granted', answer: 'granted', asks: [], pickers: [] };
    FileSystemHandle.prototype.queryPermission = async function (o) { return o && o.mode === 'readwrite' ? window.__perm.write : window.__perm.read; };
    FileSystemHandle.prototype.requestPermission = async function (o) { const m = (o && o.mode) || 'read'; window.__perm.asks.push(m); if (m === 'readwrite') { window.__perm.write = window.__perm.answer; return window.__perm.write; } window.__perm.read = 'granted'; return 'granted'; };
    for (const r of await LMD.store.rootsAll()) await LMD.store.handlesDelete(r.key);
    window.__dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp');
    window.showDirectoryPicker = async (o) => { window.__perm.pickers.push(o || {}); return window.__dir; };
  });
  const perm = () => app.evaluate(() => { const b = document.querySelector('[data-write]'); const d = document.querySelector('.lmd-dlg-card'); return { asks: window.__perm.asks.slice(), pickers: window.__perm.pickers.map((o) => o.mode || 'read'), gate: !!document.querySelector('[data-gate]'), ro: b && b.offsetParent ? b.textContent : '', editing: !!document.querySelector('.lmd-article .lmd-editable'), editTitle: document.querySelector('[data-act=mode-edit]').title, doc: document.title,
    dlg: d ? { title: d.querySelector('h3').textContent, text: d.querySelector('p').textContent, buttons: [...d.querySelectorAll('.lmd-ask-actions button')].map((x) => x.textContent) } : null }; });
  await app.click('[data-home=dir]'); await app.waitForSelector(node('a.md')); await sleep(700);
  const p1 = await perm();
  check('abrir una carpeta con el botón pide solo lectura: sin pedido de escritura y sin pantalla intermedia', J(p1.pickers) === J(['read']) && p1.asks.length === 0 && !p1.gate && !p1.dlg && !!p1.doc, p1);
  check('la carpeta queda en solo lectura, y se nota: una línea en el explorador y el botón de editar lo avisa', p1.ro === 'Read-only · Allow saving' && p1.editTitle === 'Edit: the browser will ask for permission to save' && !p1.editing, p1);
  // Arrastrada: el arrastre ya da lectura, y tampoco se pide nada.
  await app.evaluate(async () => { for (const r of await LMD.store.rootsAll()) await LMD.store.handlesDelete(r.key); });
  await app.goto('chrome-extension://' + id + '/src/app.html'); await app.waitForSelector('.lmd-home');
  const patch = () => app.evaluate(async () => {
    window.__perm = window.__perm || { write: 'prompt', read: 'granted', answer: 'granted', asks: [], pickers: [] };
    FileSystemHandle.prototype.queryPermission = async function (o) { return o && o.mode === 'readwrite' ? window.__perm.write : window.__perm.read; };
    FileSystemHandle.prototype.requestPermission = async function (o) { const m = (o && o.mode) || 'read'; window.__perm.asks.push(m); if (m === 'readwrite') { window.__perm.write = window.__perm.answer; return window.__perm.write; } window.__perm.read = 'granted'; return 'granted'; };
    window.__dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('exp');
  });
  await patch();
  await app.evaluate(() => { const box = document.querySelector('.lmd-home'); const ev = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], items: [{ kind: 'file', getAsFileSystemHandle: async () => window.__dir, getAsFile: () => null }], files: [] } }); box.dispatchEvent(ev); });
  await app.waitForSelector(node('a.md'), { timeout: 8000 }).catch(() => {}); await sleep(700);
  const p2 = await perm();
  check('arrastrar una carpeta la abre igual: ningún pedido al navegador, ninguna pantalla de "confirmar el acceso"', p2.asks.length === 0 && !p2.gate && !p2.dlg && !!p2.doc && p2.ro === 'Read-only · Allow saving', p2);
  // Editar: primero el aviso de la app, y recién con su botón sale el pedido del navegador.
  await app.click(node('a.md')); await ashows('a.md');
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-dlg-card', { timeout: 4000 }).catch(() => {});
  const p3 = await perm();
  check('al pasar a edición sale el aviso propio, sin nombrar a Chrome, y todavía no se le pidió nada al navegador', !!p3.dlg && p3.dlg.title === 'Save in "exp"' && p3.dlg.text === 'To save in this folder, the browser will ask for permission. That box belongs to the browser and shows in its language: choose the option that saves the changes.' && J(p3.dlg.buttons) === J(['Stay read-only', 'Allow saving']) && p3.asks.length === 0 && !/Chrome|[!¡—–]/.test(p3.dlg.title + p3.dlg.text), p3);
  await app.click('.lmd-dlg-card [data-dlg=no]'); await sleep(400);
  const p4 = await perm();
  check('"Seguir en solo lectura" no pide nada y deja la nota leyendo', p4.asks.length === 0 && !p4.editing && !p4.dlg && p4.ro === 'Read-only · Allow saving', p4);
  await app.evaluate(() => { window.__perm.answer = 'denied'; });
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-dlg-card'); await app.click('.lmd-dlg-card [data-dlg=ok]'); await sleep(500);
  const p5 = await perm();
  check('si en el cuadro del navegador se dice que no, la carpeta sigue abierta en solo lectura y se puede reintentar', J(p5.asks) === J(['readwrite']) && !p5.editing && !p5.dlg && p5.ro === 'Read-only · Allow saving' && p5.doc === 'a.md', p5);
  await app.evaluate(() => { window.__perm.answer = 'granted'; window.__perm.write = 'prompt'; });
  await app.click('[data-write]'); await app.waitForSelector('.lmd-dlg-card'); await app.click('.lmd-dlg-card [data-dlg=ok]'); await sleep(600);
  const p6 = await perm();
  check('desde la línea del explorador se vuelve a pedir; otorgado, la línea se va y el botón de editar ya no avisa', J(p6.asks) === J(['readwrite', 'readwrite']) && p6.ro === '' && !/permission/.test(p6.editTitle) && !p6.dlg, p6);
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-article .lmd-editable');
  await app.locator('.lmd-article .lmd-editable', { hasText: 'findme-alpha' }).first().click(); await app.keyboard.press('Control+End'); await app.keyboard.type(' saved-with-permission'); await app.keyboard.press('Control+s');
  check('con el permiso dado se edita y se guarda en el archivo, sin volver a preguntar', !!(await until(() => app.evaluate(async () => /saved-with-permission/.test(await (await (await window.__dir.getFileHandle('a.md')).getFile()).text())), 8000)) && (await perm()).asks.length === 2);
  // Sin permiso, la app no entra sola en edición ni pregunta sola; y crear o renombrar ahí también avisa antes.
  await app.evaluate(() => { window.__perm.write = 'prompt'; });
  await app.click(node('conf.yaml')).catch(() => {}); await sleep(300);
  await app.click(node('a.md')); await ashows('a.md'); await sleep(500);
  const p7 = await perm();
  check('sin permiso, abrir otra nota no entra sola en edición ni muestra el aviso', !p7.editing && !p7.dlg && p7.asks.length === 2, p7);
  await app.click(node('a.md'), { button: 'right' }); await app.waitForSelector('.lmd-menu-narrow [data-f=ren]'); await app.click('.lmd-menu-narrow [data-f=ren]'); await app.waitForSelector('.lmd-dlg-card', { timeout: 4000 }).catch(() => {});
  const p8 = await perm();
  check('renombrar un archivo de esa carpeta muestra primero el mismo aviso', !!p8.dlg && p8.dlg.title === 'Save in "exp"' && J(p8.dlg.buttons) === J(['Stay read-only', 'Allow saving']), p8);
  await app.click('.lmd-dlg-card [data-dlg=no]'); await sleep(300);
  // Reabrir una carpeta reciente a la que el navegador le venció la lectura: se pide lectura, nunca escritura.
  await app.evaluate(() => { window.__perm.read = 'prompt'; window.__perm.asks = []; });
  await app.evaluate(() => { const b = document.querySelector('[data-act=go-home]'); if (b) b.click(); });
  await sleep(500);
  const lastOf = await app.evaluate(async () => { const r = (await LMD.store.rootsAll()).find((x) => x.kind === 'dir'); return r ? r.last : ''; });
  await app.evaluate((f) => { history.pushState(null, '', location.pathname + '?f=' + encodeURIComponent(f)); window.dispatchEvent(new PopStateEvent('popstate')); }, lastOf);
  await sleep(1200);
  const p9 = await perm();
  check('reabrir una reciente pide, a lo sumo, lectura: nunca escritura', !p9.asks.includes('readwrite') && (p9.asks.length === 0 || J([...new Set(p9.asks)]) === J(['read'])), p9);
  const gateText = await app.evaluate(() => { const g = document.querySelector('[data-gate]'); return g ? g.closest('.lmd-home-card').textContent : ''; });
  check('y si hace falta el clic, la pantalla dice "el navegador", no Chrome', !/Chrome/.test(gateText), gateText);
  await app.close();

  check('sin errores de JavaScript en ninguna página', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  check('la prueba corrió hasta el final', false, String(e && e.stack || e).slice(0, 600));
} finally {
  await ctx.close(); site.close();
  for (const d of [profile, disk]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows suelta los archivos después */ } }
}
process.exit(done() ? 1 : 0);
