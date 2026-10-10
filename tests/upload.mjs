// Subir a la nube desde la computadora, sin abrir antes la carpeta en la app: "Subir archivos" y "Subir carpeta" en
// el + y el clic derecho de la sección Nube y de sus carpetas, y soltar archivos o una carpeta desde el sistema sobre
// la Nube. Es el recorrido de "Enviar a la nube" (send.js) con otra fuente: la misma revisión previa, los mismos topes
// y el mismo resumen. El tope del plan gratis sale del servidor (acá FREE_NOTES=6).
// Contra un servidor local: la página de la extensión, la app web y el lector de un archivo del disco (file://).
// Capturas en C:\tmp\agsubir\ (o SHOTS).
// Uso: node upload.mjs
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
import { rig, tally, sleep, root } from './rig.mjs';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const SHOTS = process.env.SHOTS || 'C:\\tmp\\agsubir';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* sin carpeta de capturas, se sigue */ }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { /* una captura que falla no frena la prueba */ } };

const FREE = 6;
const R = await rig({ FREE_NOTES: String(FREE), ALLOW_ORIGINS: '*' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// Lo que hay en la computadora: archivos sueltos y una carpeta con subcarpetas, que la app nunca abrió.
const disk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-up-')));
const DISK = {
  'n1.md': '# One\n\nFrom the computer.\n', 'n2.txt': 'plain two\n', 'secret.md': '# Secret\n\nFor the locked folder.\n', 'web.md': '# Web\n\nUploaded from the web app.\n', 'r.md': '# Reader\n', 'fromreader.md': '# From the reader\n',
  'pack/p1.md': '# P1\n\n![s](in/shot.png)\n\n[two](in/p2.md)\n', 'pack/in/p2.md': '# P2\n', 'pack/in/deep/p3.txt': 'three\n', 'pack/other.csv': 'a,b\n', 'pack/.git/config.md': '# no\n', 'pack/node_modules/dep/readme.md': '# no\n',
};
for (const [n, t] of Object.entries(DISK)) { fs.mkdirSync(path.dirname(path.join(disk, n)), { recursive: true }); fs.writeFileSync(path.join(disk, n), t); }
fs.writeFileSync(path.join(disk, 'pic.png'), PNG); fs.writeFileSync(path.join(disk, 'pack', 'in', 'shot.png'), PNG);
const F = (name) => path.join(disk, name);
// Una carpeta que el selector de carpetas del navegador entrega como handle (acá, del almacenamiento de la página).
const TRIP = { 'a.md': '# A\n', 'b.md': '# B\n', 'data.json': '{}\n', 'sub/c.md': '# C\n\n[up](../a.md)\n', 'sub/e.txt': 'e\n', 'sub/deep/d.md': '# D\n', '.hidden/x.md': '# no\n', 'node_modules/y.md': '# no\n' };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-upp-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const errors = [];
let bad = 1;
try {
  const first = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(first.url()).host; const OWN = 'chrome-extension://' + id + '/src/app.html';
  const SW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://' + id)) || ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const bg = async (fn, arg) => (await SW()).evaluate(fn, arg);
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const admin = await ctx.newPage();
  await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
  await admin.evaluate(async () => { for (const e of await chrome.developerPrivate.getExtensionsInfo()) await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: e.id, fileAccess: true }); });
  await admin.close();

  const ana = await R.signup('ana@example.test'); const pia = await R.signup('pia@example.test', true);
  const signIn = (who) => bg(([w, base]) => chrome.storage.local.set({ cloud: w ? { session: w.s, email: w.email, at: base } : { session: '', email: '', at: base } }), [who, R.base]);
  await bg((base) => chrome.storage.local.set({ settings: { cloudUrl: base, sidebarWidth: 340, filesOnlyMarkdown: false } }), R.base);
  await signIn(ana);
  const paths = async (who) => ((await R.api('GET', '/notes', undefined, who.s)).json || []).map((n) => n.path).sort();
  const textOf = async (who, p) => ((await R.api('GET', '/notes/' + encodeURIComponent(p), undefined, who.s)).json || {}).text;
  const account = async (who) => (await R.api('GET', '/account', undefined, who.s)).json;

  const app = await ctx.newPage(); app.on('pageerror', (e) => errors.push(e.message));
  const CLOUD = '.lmd-xroot[data-root=cloud]';
  // La carpeta "trip" queda en el almacenamiento de la página, y el selector de carpetas del navegador la entrega.
  const seedTrip = (page) => page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('trip', { create: true });
    for (const [rel, text] of Object.entries(list)) { const parts = rel.split('/'); let d = dir; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true }); const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable(); await w.write(text); await w.close(); }
    window.__asked = []; window.showDirectoryPicker = async (o) => { window.__asked.push(o || null); return dir; };
  }, TRIP);
  const openApp = async () => { await app.goto(OWN); await app.waitForSelector('.lmd-home'); await seedTrip(app); await app.waitForSelector(CLOUD + ' .lmd-tree'); await app.waitForSelector(CLOUD + ' .lmd-tree-new'); };
  await openApp();
  const row = (page, sec, name) => page.locator('.lmd-xroot[data-root=' + sec + '] .lmd-node').filter({ has: page.locator('.lmd-node-name', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();
  const menuNow = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => [b.dataset.f, b.textContent.trim(), !!b.querySelector('svg')]));
  const plusMenu = async (page, sec) => { await page.click('.lmd-xroot[data-root=' + sec + '] .lmd-tree-new'); await page.waitForSelector('.lmd-menu'); return menuNow(page); };
  const rightMenu = async (page, loc) => { await loc.click({ button: 'right' }); await page.waitForSelector('.lmd-menu'); return menuNow(page); };
  // Elegir en el selector del navegador: se toca la opción y se le dan los archivos (o la carpeta).
  const choose = async (page, f, files) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.lmd-menu [data-f=' + f + ']')]); const kind = { multiple: fc.isMultiple(), dir: await fc.element().evaluate((i) => !!i.webkitdirectory), shown: await fc.element().evaluate((i) => getComputedStyle(i).display !== 'none') }; await fc.setFiles(files); return kind; };
  const sent = async (page) => { await page.waitForSelector('.lmd-sent', { timeout: 10000 }); return page.evaluate(() => { const b = document.querySelector('.lmd-sent'); return { text: b.querySelector('span').textContent, button: (b.querySelector('[data-sent=open]') || { textContent: '' }).textContent, bad: b.classList.contains('lmd-sent-bad') }; }); };
  const closeSent = (page) => page.evaluate(() => { const b = document.querySelector('.lmd-sent'); if (b) b.remove(); });
  const dlg = (page) => page.evaluate(() => {
    const c = document.querySelector('.lmd-send .lmd-send-card'); if (!c) return null;
    const t = (sel) => (c.querySelector(sel) || { textContent: '' }).textContent;
    return { title: t('h3'), copy: t('.lmd-send-copy'), dest: t('.lmd-send-dest'), change: !!c.querySelector('[data-sd=dest]'), sum: t('.lmd-send-sum'), warn: t('.lmd-send-warn'), other: t('.lmd-send-other'), modes: [...c.querySelectorAll('[data-mode]')].map((b) => b.textContent + (b.classList.contains('lmd-on') ? '*' : '')),
      picks: [...c.querySelectorAll('[data-pick]')].map((i) => i.dataset.pick + (i.checked ? '*' : '') + (i.disabled ? '-' : '')), img: t('.lmd-send-img'), imgs: t('.lmd-send-imgs'), none: t('.lmd-send-none'), buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent + (b.disabled ? '-' : '')),
      result: t('.lmd-send-result'), fails: [...c.querySelectorAll('.lmd-send-fails li')].map((li) => li.textContent), hints: [...c.querySelectorAll('.lmd-hint')].map((p) => p.textContent) };
  });
  const go = (page) => page.click('.lmd-send [data-sd=go]');
  const finish = async (page) => { await go(page); await page.waitForSelector('.lmd-send .lmd-send-result', { timeout: 20000 }); return dlg(page); };
  const shut = async (page) => { await page.click('.lmd-send [data-sd=no]'); await page.waitForSelector('.lmd-send', { state: 'detached' }); };
  const plain = (s) => !/[!¡—–]/.test(s);

  console.log('Dónde están las acciones');
  const m1 = await plusMenu(app, 'cloud');
  check('el + de la sección Nube ofrece subir archivos y subir carpeta, después de crear', J(m1.map((i) => i[0])) === J(['new', 'tpl', 'dir', 'upf', 'upd']) && J(m1.slice(3).map((i) => i[1])) === J(['Upload files', 'Upload folder']) && m1.every((i) => i[2]), m1);
  await shot(app, '01-menu-del-mas');
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-menu', { state: 'detached' });
  const m2 = await plusMenu(app, 'local');
  check('el + de "En este navegador" no: ahí no se sube', !m2.some((i) => /^up/.test(i[0])), m2);
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-menu', { state: 'detached' });
  const m3 = await rightMenu(app, app.locator(CLOUD + ' .lmd-root-tog'));
  check('el clic derecho sobre la raíz Nube también', m3.some((i) => i[0] === 'upf') && m3.some((i) => i[0] === 'upd'), m3);
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-menu', { state: 'detached' });

  console.log('Subir varios archivos');
  await plusMenu(app, 'cloud');
  const k1 = await choose(app, 'upf', [F('n1.md'), F('n2.txt'), F('pic.png')]);
  await app.waitForSelector('.lmd-send');
  const u1 = await dlg(app);
  check('el selector es de varios archivos, y no se ve en la página', k1.multiple && !k1.dir && !k1.shown, k1);
  check('antes de subir dice cuántas notas son, a dónde van y cuánto lugar queda', u1.title === 'Upload notes to the cloud' && u1.dest === 'Cloud' && !u1.change && u1.sum === '2 notes · Free plan: ' + FREE + ' of ' + FREE + ' places left' && J(u1.buttons) === J(['Cancel', 'Send 2 notes']), u1);
  check('dice que queda una copia y que lo del dispositivo no cambia', u1.copy === 'A copy stays in the cloud. The files on this device do not change.', u1.copy);
  check('lo que no es una nota se dice que no se sube', u1.other === '1 file is not a note and is not uploaded.', u1.other);
  check('los avisos son cortos, sin signos de admiración ni rayas largas', [u1.title, u1.copy, u1.sum, u1.other].every(plain));
  await shot(app, '02-subir-archivos');
  const u2 = await finish(app);
  check('suben las notas y el resumen lo dice', u2.result === '2 notes were sent.' && J(u2.buttons) === J(['Close', 'Show in the cloud']) && J(await paths(ana)) === J(['n1.md', 'n2.txt']) && (await textOf(ana, 'n1.md')) === DISK['n1.md'] && (await textOf(ana, 'n2.txt')) === DISK['n2.txt'], [u2, await paths(ana)]);
  await shut(app);
  check('y quedan a la vista en el explorador', !!(await until(() => app.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node-name')].map((n) => n.textContent).join(',') === 'n1.md,n2.txt'))));
  check('el selector no queda en la página', (await app.evaluate(() => document.querySelectorAll('.lmd-send-input').length)) === 0);

  console.log('Choque de nombres y lo que no es una nota');
  await plusMenu(app, 'cloud'); await choose(app, 'upf', [F('n1.md')]); await app.waitForSelector('.lmd-send');
  const c1 = await dlg(app);
  check('un archivo que ya existe pregunta qué hacer', c1.title === 'Upload "n1.md" to the cloud' && J(c1.modes) === J(['Skip', 'Replace', 'Save under another name*']) && c1.copy === 'A copy stays in the cloud. The file on this device does not change.' && J(c1.buttons) === J(['Cancel', 'Send']), c1);
  await shot(app, '03-ya-existe');
  await go(app);
  const s1 = await sent(app);
  check('con otro nombre quedan las dos, y el aviso lo dice', s1.text === 'Saved as "n1-2.md". A copy stays in the cloud. The file on this device does not change.' && s1.button === 'Open the cloud note' && !s1.bad && J(await paths(ana)) === J(['n1-2.md', 'n1.md', 'n2.txt']), [s1, await paths(ana)]);
  await closeSent(app);
  await plusMenu(app, 'cloud'); await choose(app, 'upf', [F('pic.png')]);
  const s2 = await sent(app);
  check('una imagen sola no sube: se dice que solo se suben notas', s2.bad && s2.text === 'Only notes are uploaded: Markdown and text files.' && plain(s2.text) && (await account(ana)).notes === 3, s2);
  await closeSent(app);

  console.log('Subir una carpeta, con el tope del plan gratis');
  await plusMenu(app, 'cloud'); await app.click('.lmd-menu [data-f=upd]'); await app.waitForSelector('.lmd-send');
  const f1 = await dlg(app);
  check('la carpeta se elige con el selector del navegador, solo para leer', J(await app.evaluate(() => window.__asked)) === J([{ mode: 'read' }]));
  check('el resumen: la carpeta, sus notas con las de las subcarpetas y el lugar que queda', f1.title === 'Upload the folder "trip" to the cloud' && f1.dest === 'Cloud / trip' && f1.sum === '5 notes · Free plan: 3 of ' + FREE + ' places left' && f1.other === '1 file is not a note and is not uploaded.', f1);
  check('si no entran todas lo dice antes de empezar, y deja elegir', f1.warn === '3 of 5 fit. The paid plan has no limit.' && J(f1.picks) === J(['a.md*', 'b.md*', 'sub/c.md*', 'sub/deep/d.md-', 'sub/e.txt-']) && J(f1.buttons) === J(['Cancel', 'See plans', 'Send 3 notes']), f1);
  await shot(app, '04-carpeta-tope-plan-gratis');
  await app.click('.lmd-send [data-pick="b.md"]'); await app.click('.lmd-send [data-pick="sub/deep/d.md"]');
  const f2 = await finish(app);
  check('el resumen final dice cuántas subieron y cuántas quedaron afuera', f2.result === '3 notes were sent. 2 were left out because they do not fit in the plan.' && !f2.fails.length, f2);
  check('las subcarpetas se conservan, y lo oculto y node_modules no viajan', J(await paths(ana)) === J(['n1-2.md', 'n1.md', 'n2.txt', 'trip/a.md', 'trip/sub/c.md', 'trip/sub/deep/d.md']) && (await textOf(ana, 'trip/sub/c.md')) === TRIP['sub/c.md'], await paths(ana));
  check('nunca se pasó del tope', (await account(ana)).notes === FREE && (await account(ana)).limit === FREE, await account(ana));
  await shut(app);
  await plusMenu(app, 'cloud'); await choose(app, 'upf', [F('secret.md'), F('web.md')]); await app.waitForSelector('.lmd-send');
  const f3 = await dlg(app);
  check('con el plan lleno no sube nada: lo dice y ofrece ver los planes', f3.warn === '0 of 2 fit. The paid plan has no limit.' && f3.none === 'The free plan is full.' && f3.buttons[1] === 'See plans' && /-$/.test(f3.buttons[2]), f3);
  await shot(app, '05-plan-lleno');
  await shut(app);
  check('y la nube quedó como estaba', (await account(ana)).notes === FREE);

  console.log('Plan pago: una carpeta por el selector de archivos, con una imagen');
  await signIn(pia); await openApp();
  // Donde no existe el selector de carpetas (Firefox, Safari), la carpeta se elige con un input de carpeta.
  await app.evaluate(() => { window.showDirectoryPicker = undefined; });
  const m4 = await plusMenu(app, 'cloud');
  check('sin selector de carpetas del navegador, "Subir carpeta" sigue estando', m4.some((i) => i[0] === 'upd'), m4);
  const k2 = await choose(app, 'upd', F('pack'));
  await app.waitForSelector('.lmd-send');
  const p1 = await dlg(app);
  check('ese selector es de carpeta', k2.dir && !k2.shown, k2);
  check('la carpeta elegida así se arma igual, con sus subcarpetas', p1.title === 'Upload the folder "pack" to the cloud' && p1.dest === 'Cloud / pack' && p1.sum === '3 notes · Paid plan: no limit' && !p1.warn && J(p1.buttons) === J(['Cancel', 'Send 3 notes']), p1);
  check('la imagen que nombra una nota se ofrece subir, y no se cuenta entre lo que no se sube', p1.img === 'Also upload 1 image, and point the copy to it' && p1.other === '1 file is not a note and is not uploaded.', [p1.img, p1.other]);
  await shot(app, '06-carpeta-con-imagen');
  const p2 = await finish(app); const p1Text = await textOf(pia, 'pack/p1.md');
  check('sube con su estructura, sin .git ni node_modules', p2.result === '3 notes were sent.' && J(await paths(pia)) === J(['pack/in/deep/p3.txt', 'pack/in/p2.md', 'pack/p1.md']) && (await textOf(pia, 'pack/in/deep/p3.txt')) === DISK['pack/in/deep/p3.txt'], [p2.result, await paths(pia)]);
  check('la imagen sube como adjunto y la copia la nombra; los enlaces entre notas quedan', p2.hints.includes('1 image was uploaded.') && /!\[s\]\(https?:\/\/[^)]*\/f\/[0-9a-f]{40}\.png\)/.test(p1Text || '') && (p1Text || '').includes('[two](in/p2.md)'), [p2.hints, p1Text]);
  await app.click('.lmd-send [data-sd=open]'); await app.waitForSelector('.lmd-send', { state: 'detached' });
  check('"Ver en la nube" deja la carpeta desplegada', !!(await until(() => app.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node-name')].map((n) => n.textContent).includes('p1.md')))));
  await app.evaluate(() => { const b = document.querySelector('.lmd-node.lmd-active'); if (b) b.blur(); });
  const m5 = await rightMenu(app, row(app, 'cloud', 'pack'));
  check('el clic derecho de una carpeta de la nube ofrece subir ahí, y el de una nota no', m5.some((i) => i[0] === 'upf' && i[1] === 'Upload files') && m5.some((i) => i[0] === 'upd' && i[1] === 'Upload folder'), m5);
  await choose(app, 'upf', [F('n1.md'), F('n2.txt')]); await app.waitForSelector('.lmd-send');
  const p3 = await dlg(app);
  check('lo que se sube desde una carpeta va a esa carpeta', p3.dest === 'Cloud / pack' && !p3.change && p3.sum === '2 notes · Paid plan: no limit', p3);
  await finish(app); await shut(app);
  check('y llega ahí', (await textOf(pia, 'pack/n1.md')) === DISK['n1.md'] && (await textOf(pia, 'pack/n2.txt')) === DISK['n2.txt'], await paths(pia));
  const m6 = await rightMenu(app, row(app, 'cloud', 'p1.md'));
  check('una nota de la nube no ofrece subir', !m6.some((i) => /^up/.test(i[0])) && m6.some((i) => i[0] === 'ren'), m6);
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-menu', { state: 'detached' });

  console.log('Soltar desde el sistema');
  // Lo que el navegador entrega al soltar: archivos de verdad en un DataTransfer, o (para una carpeta, que una página
  // no puede fabricar) los mismos objetos que da el sistema: su handle, o una entrada de webkitGetAsEntry.
  const osDrop = (page, sel, how) => page.evaluate(async ([s, h]) => {
    const to = document.querySelector(s); const b = to.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, clientX: b.left + 30, clientY: b.top + b.height / 2 };
    let dt = null;
    if (h.files) { dt = new DataTransfer(); h.files.forEach((f) => dt.items.add(new File([f[1]], f[0], { type: 'text/plain' }))); }
    else if (h.handle) { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(h.handle); dt = { types: ['Files'], files: [], dropEffect: 'none', items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: () => Promise.resolve(dir) }] }; }
    else {
      // Entradas como las de webkitGetAsEntry: una carpeta entrega su contenido de a tandas.
      const entry = (name, v) => (typeof v === 'string' ? { name, isFile: true, isDirectory: false, file: (ok) => ok(new File([v], name)) }
        : { name, isFile: false, isDirectory: true, createReader: () => { const all = Object.entries(v).map((e) => entry(e[0], e[1])); return { readEntries: (ok) => ok(all.splice(0, 2)) }; } });
      dt = { types: ['Files'], files: [], dropEffect: 'none', items: Object.entries(h.entries).map((e) => ({ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => entry(e[0], e[1]) })) };
    }
    const fire = (type) => { const ev = new DragEvent(type, Object.assign(dt instanceof DataTransfer ? { dataTransfer: dt } : {}, at)); if (!(dt instanceof DataTransfer)) Object.defineProperty(ev, 'dataTransfer', { value: dt }); to.dispatchEvent(ev); return ev.defaultPrevented; };
    window.__later = 0; const count = () => { window.__later++; }; window.addEventListener('drop', count);
    const over = fire('dragover');
    const seen = { over, tag: (document.querySelector('.lmd-drop-tag') || { textContent: '' }).textContent, mark: (document.querySelector('.lmd-drop') || { className: '' }).className, name: ((document.querySelector('.lmd-drop .lmd-node-name, .lmd-drop .lmd-tree-path') || {}).textContent) || '' };
    seen.drop = fire('drop'); window.removeEventListener('drop', count);
    seen.later = window.__later; seen.left = !!document.querySelector('.lmd-drop-tag, .lmd-xroot.lmd-drop, .lmd-node.lmd-drop');
    return seen;
  }, [sel, how]);
  const packSel = await app.evaluate(() => { const n = [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node-dir')].find((x) => x.querySelector('.lmd-node-name').textContent === 'pack'); n.setAttribute('data-test-pack', ''); return '[data-test-pack]'; });
  const d1 = await osDrop(app, packSel, { files: [['d1.md', '# D1\n'], ['d2.md', '# D2\n'], ['z.bin', 'zz']] });
  check('arrastrando sobre una carpeta de la nube se marca esa carpeta y la etiqueta dice que sube', d1.over && d1.tag === 'Upload notes to the cloud' && /lmd-node-dir/.test(d1.mark) && d1.name === 'pack', d1);
  check('al soltar se queda con el archivo (nadie más lo recibe) y limpia las marcas', d1.drop && d1.later === 0 && !d1.left, d1);
  await app.waitForSelector('.lmd-send');
  const d1d = await dlg(app);
  check('soltar archivos sobre una carpeta de la nube abre el resumen con ese destino', d1d.title === 'Upload notes to the cloud' && d1d.dest === 'Cloud / pack' && !d1d.change && d1d.sum === '2 notes · Paid plan: no limit' && d1d.other === '1 file is not a note and is not uploaded.', d1d);
  await shot(app, '07-soltar-archivos');
  await finish(app); await shut(app);
  check('y suben ahí', (await textOf(pia, 'pack/d1.md')) === '# D1\n' && (await textOf(pia, 'pack/d2.md')) === '# D2\n', await paths(pia));

  const d2 = await osDrop(app, CLOUD + ' .lmd-root-tog', { handle: 'trip' });
  check('sobre la sección Nube se marca la sección', d2.over && d2.drop && /lmd-xroot/.test(d2.mark) && d2.name === 'Cloud' && d2.later === 0, d2);
  await app.waitForSelector('.lmd-send');
  const d2d = await dlg(app);
  check('soltar una carpeta la sube entera, con su nombre', d2d.title === 'Upload the folder "trip" to the cloud' && d2d.dest === 'Cloud / trip' && d2d.sum === '5 notes · Paid plan: no limit' && d2d.other === '1 file is not a note and is not uploaded.', d2d);
  await finish(app); await shut(app);
  check('con las subcarpetas', J((await paths(pia)).filter((p) => /^trip\//.test(p))) === J(['trip/a.md', 'trip/b.md', 'trip/sub/c.md', 'trip/sub/deep/d.md', 'trip/sub/e.txt']) && (await textOf(pia, 'trip/sub/deep/d.md')) === TRIP['sub/deep/d.md'], (await paths(pia)).filter((p) => /^trip\//.test(p)));

  const d3 = await osDrop(app, CLOUD + ' .lmd-root-tog', { entries: { ent: { 'x.md': '# X\n', 'w.md': '# W\n', 'v.md': '# V\n', k: { 'y.md': '# Y\n' }, '.git': { 'no.md': '# no\n' } }, 'loose.md': '# Loose\n', 'trip': { 'a.md': '# A again\n' } } });
  await app.waitForSelector('.lmd-send');
  const d3d = await dlg(app);
  check('una carpeta y archivos sueltos soltados juntos: cada cosa con su ruta, y lo que ya existe se saltea', d3.drop && d3d.title === 'Upload notes to the cloud' && d3d.dest === 'Cloud' && d3d.sum === '6 notes · 1 already exists · Paid plan: no limit' && J(d3d.modes) === J(['Skip*', 'Replace', 'Save under another name']) && J(d3d.buttons) === J(['Cancel', 'Send 5 notes']), d3d);
  await shot(app, '08-soltar-carpeta-y-archivos');
  const d3r = await finish(app); await shut(app);
  check('suben la carpeta con su subcarpeta y los sueltos; la que existía queda como estaba', d3r.result === '5 notes were sent. 1 already existed and was skipped.' && J((await paths(pia)).filter((p) => /^(ent\/|loose)/.test(p))) === J(['ent/k/y.md', 'ent/v.md', 'ent/w.md', 'ent/x.md', 'loose.md']) && (await textOf(pia, 'trip/a.md')) === TRIP['a.md'], [d3r.result, await paths(pia)]);

  // Fuera de la nube, soltar un archivo hace lo de siempre.
  const before = (await paths(pia)).length;
  const d4 = await osDrop(app, '.lmd-xroot[data-root=local] .lmd-root-tog', { files: [['elsewhere.md', '# Elsewhere\n']] });
  await sleep(500);
  check('soltar fuera de la nube no sube nada ni marca nada: el archivo sigue su camino de siempre', d4.tag === '' && !/lmd-(xroot|node)/.test(d4.mark) && d4.later === 1 && !(await app.evaluate(() => !!document.querySelector('.lmd-send'))) && (await paths(pia)).length === before, d4);
  const d5 = await app.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4\n'], 'paper.pdf', { type: 'application/pdf' })); const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; });
  check('un PDF soltado en la ventana lo sigue tomando el visor', d5 === true && !(await app.evaluate(() => !!document.querySelector('.lmd-send'))), d5);
  await openApp();

  console.log('Destino protegido con contraseña');
  const PASS = 'correct horse battery staple 42';
  await rightMenu(app, row(app, 'cloud', 'ent')); await app.click('.lmd-menu [data-f=v-protect]');
  await app.waitForSelector('[data-v=p1]'); await app.fill('[data-v=p1]', PASS); await app.fill('[data-v=p2]', PASS); await app.click('[data-v=ok]');
  await app.waitForSelector('.lmd-vault-key', { timeout: 20000 });
  await Promise.all([app.waitForEvent('download').catch(() => null), app.click('[data-v=down]')]);
  await app.click('[data-v=ok]'); await sleep(600);
  // Al recargar, la carpeta queda bloqueada en la pestaña.
  await openApp();
  await app.waitForSelector(CLOUD + ' .lmd-vault-shut', { timeout: 10000 });
  const m7 = await rightMenu(app, row(app, 'cloud', 'ent'));
  check('una carpeta protegida y bloqueada también ofrece subir', m7.some((i) => i[0] === 'upf'), m7);
  await choose(app, 'upf', [F('secret.md')]);
  await app.waitForSelector('[data-v=p]', { timeout: 10000 });
  check('subir a una carpeta protegida y bloqueada pide la contraseña antes de mandar nada', !(await paths(pia)).includes('ent/secret.md'));
  await shot(app, '09-destino-protegido');
  await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]');
  const s3 = await sent(app);
  const sealed = ((await R.api('GET', '/notes/' + encodeURIComponent('ent/secret.md'), undefined, pia.s)).json || {}).text || '';
  check('y la nota llega cifrada, como cualquier nota de esa carpeta', !s3.bad && sealed.length > 0 && !sealed.includes('Secret') && !sealed.includes('locked folder'), [s3, sealed.slice(0, 60)]);
  await closeSent(app);
  // Ya desbloqueada, una tanda soltada ahí también va cifrada.
  await app.evaluate(() => { const n = [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node-dir')].find((x) => x.querySelector('.lmd-node-name').textContent === 'ent'); n.setAttribute('data-test-ent', ''); });
  await osDrop(app, '[data-test-ent]', { files: [['s1.md', '# Sealed one\n'], ['s2.md', '# Sealed two\n']] });
  await app.waitForSelector('.lmd-send'); await finish(app); await shut(app);
  const sealed2 = ((await R.api('GET', '/notes/' + encodeURIComponent('ent/s2.md'), undefined, pia.s)).json || {}).text || '';
  check('lo soltado sobre la carpeta protegida también', sealed2.length > 0 && !sealed2.includes('Sealed'), sealed2.slice(0, 60));

  console.log('Sin sesión');
  await signIn(null);
  await until(() => app.evaluate(() => !LMD.cloud.signedIn() && !!document.querySelector('.lmd-xroot[data-root=cloud] .lmd-root-hint')));
  const d6 = await osDrop(app, CLOUD + ' .lmd-root-tog', { files: [['out.md', '# Out\n']] });
  check('sin sesión, soltar sobre la Nube no sube ni se queda con el archivo', d6.tag === '' && d6.later === 1 && !(await app.evaluate(() => !!document.querySelector('.lmd-send, .lmd-dlg'))), d6);

  // ---------- La app web ----------
  console.log('La app web');
  const web = await R.open(pia);
  await web.page.goto(R.home); await web.page.waitForSelector(CLOUD + ' .lmd-tree-new');
  const w1 = await plusMenu(web.page, 'cloud');
  check('en la app web el + de la Nube ofrece lo mismo', w1.some((i) => i[0] === 'upf' && i[1] === 'Upload files') && w1.some((i) => i[0] === 'upd' && i[1] === 'Upload folder'), w1);
  await choose(web.page, 'upf', [F('web.md')]);
  const w2 = await sent(web.page);
  check('y un archivo sube derecho, con el aviso al pie', w2.text === 'A copy stays in the cloud. The file on this device does not change.' && w2.button === 'Open the cloud note' && (await textOf(pia, 'web.md')) === DISK['web.md'], w2);
  await web.page.click('.lmd-sent [data-sent=open]');
  check('"Abrir la nota de la nube" la abre', !!(await until(() => web.page.evaluate(() => /f=cloud%2Fweb\.md/.test(location.href) && document.title === 'web.md'))), web.page.url());
  // En español, los mismos textos.
  await web.ctx.close();
  const es = await R.open(pia);
  await es.page.goto(R.home); await es.page.waitForSelector(CLOUD + ' .lmd-tree-new');
  await es.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mdtools:settings') || '{}'); s.language = 'es'; localStorage.setItem('mdtools:settings', JSON.stringify(s)); });
  await es.page.reload(); await es.page.waitForSelector(CLOUD + ' .lmd-tree-new');
  const e1 = await plusMenu(es.page, 'cloud');
  await choose(es.page, 'upf', [F('n1.md'), F('pic.png')]); await es.page.waitForSelector('.lmd-send');
  const e2 = await dlg(es.page);
  check('en español: el menú y la ventana', J(e1.slice(3).map((i) => i[1])) === J(['Subir archivos', 'Subir carpeta']) && e2.title === 'Subir notas a la nube' && e2.copy === 'Queda una copia en la nube. Los archivos de este dispositivo no cambian.' && e2.other === '1 archivo no es una nota y no se sube.' && [e2.title, e2.copy, e2.other].every(plain), [e1, e2]);
  await shot(es.page, '10-web-en-espanol');
  await shut(es.page);
  check('la app web, sin errores de página', R.errors.length === 0, R.errors.slice(0, 5));
  await es.ctx.close();

  // ---------- El lector de un archivo del disco (file://) ----------
  console.log('El lector de file://');
  await signIn(pia);
  const rd = await ctx.newPage(); rd.on('pageerror', (e) => errors.push(e.message));
  await rd.goto(pathToFileURL(F('r.md')).href); await rd.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node');
  await rd.waitForSelector(CLOUD + ' .lmd-node', { timeout: 10000 });
  const r1 = await rightMenu(rd, rd.locator(CLOUD + ' .lmd-root-tog'));
  check('en el lector, el clic derecho de la sección Nube ofrece subir archivos', r1.some((i) => i[0] === 'upf' && i[1] === 'Upload files') && !r1.some((i) => /^(new|ren|del|dir)$/.test(i[0])), r1);
  await choose(rd, 'upf', [F('fromreader.md')]);
  const r2 = await sent(rd);
  check('y el archivo llega a la nube por la extensión', !r2.bad && (await textOf(pia, 'fromreader.md')) === DISK['fromreader.md'], [r2, (await paths(pia)).filter((p) => /reader/.test(p))]);
  await closeSent(rd);

  check('sin errores de página', errors.length === 0, errors.slice(0, 5));
  check('nada salió hacia sharpmd.app', R.outside.length === 0, R.outside.slice(0, 3));
  bad = done();
} catch (e) {
  console.log('\nLa prueba se cortó: ' + (e && e.stack || e));
} finally {
  await ctx.close().catch(() => {}); await R.close().catch(() => {});
  for (const d of [profile, disk]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows suelta la carpeta después */ } }
}
process.exit(bad ? 1 : 0);
