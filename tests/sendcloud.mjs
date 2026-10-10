// Enviar a la nube desde el explorador: una nota o una carpeta entera, del disco o de "En este navegador", por el
// menú (clic derecho) y arrastrando hasta la sección Nube o una de sus carpetas. Siempre queda una copia y lo del
// disco no cambia. El tope del plan gratis sale del servidor (acá FREE_NOTES=6) y se dice antes de empezar.
// También: la sección Nube y su papelera en el lector de un archivo del disco (file://), con y sin sesión.
// Todo contra un servidor local, con la extensión de verdad. Capturas en C:\tmp\agnubeenv\ (o SHOTS).
// Uso: node sendcloud.mjs
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
import { rig, tally, sleep, root } from './rig.mjs';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const SHOTS = process.env.SHOTS || 'C:\\tmp\\agnubeenv';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* sin carpeta de capturas, se sigue */ }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { /* una captura que falla no frena la prueba */ } };

const FREE = 6;
const R = await rig({ FREE_NOTES: String(FREE), ALLOW_ORIGINS: '*' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const DOCS = {
  'a.md': '# Alpha\n\nLink to [beta](b.md).\n',
  'b.md': '# Beta\n\nSecond.\n',
  'notes.txt': 'plain text\n',
  'data.json': '{ "n": 1 }\n',
  'sub/c.md': '# Gamma\n\n![dot](dot.png)\n\n[up](../b.md) and [deep](deep/d.md)\n',
  'sub/deep/d.md': '# Delta\n\n[back](../c.md)\n',
};
// La carpeta del disco de verdad, para el lector de file://.
const disk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-send-')));
const READER = { 'r.md': '# Reader\n\nFrom the disk. [s](s.md)\n', 's.md': '# Second\n\nOn disk.\n', 'memo.txt': 'a memo\n', 'box/t.md': '# In a box\n\n[u](in/u.md)\n', 'box/in/u.md': '# Deeper\n' };
for (const [n, t] of Object.entries(READER)) { fs.mkdirSync(path.dirname(path.join(disk, n)), { recursive: true }); fs.writeFileSync(path.join(disk, n), t); }
const U = (name) => pathToFileURL(path.join(disk, name)).href;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-sendp-'));
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
  // El acceso a file:// se da desde la página de extensiones, como lo haría una persona.
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

  // ---------- La app, con una carpeta del disco abierta ----------
  const app = await ctx.newPage(); app.on('pageerror', (e) => errors.push(e.message));
  await app.goto(OWN); await app.waitForSelector('.lmd-home');
  const seedDisk = (files, png) => app.evaluate(async ([list, img]) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('docs', { create: true });
    const put = async (rel, data) => { const parts = rel.split('/'); let d = dir; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true }); const h = await d.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable(); await w.write(data); await w.close(); };
    for (const [n, t] of Object.entries(list)) await put(n, t);
    if (img) await put('sub/dot.png', Uint8Array.from(atob(img), (c) => c.charCodeAt(0)));
    await put('.hidden/secret.md', '# Hidden\n');
    window.showDirectoryPicker = async () => dir;
  }, [files, png]);
  const diskNow = () => app.evaluate(async () => {
    const out = {}; const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('docs');
    const walk = async (d, pre) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else if (/\.(md|txt|json)$/.test(n)) out[pre + n] = await (await h.getFile()).text(); } };
    await walk(dir, ''); return out;
  });
  await seedDisk(DOCS, PNG.toString('base64'));
  await app.evaluate(() => LMD.store.notePut('local-one.md', '# Local one\n\nLives in this browser.\n'));
  await app.click('[data-home=dir]'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node');
  const row = (page, sec, name) => page.locator('.lmd-xroot[data-root=' + sec + '] .lmd-node').filter({ has: page.locator('.lmd-node-name', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();
  const menuOf = async (page, loc) => { await loc.click({ button: 'right' }); await page.waitForSelector('.lmd-menu'); return page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => [b.dataset.f, b.textContent.trim()])); };
  const pick = (page, f) => page.click('.lmd-menu [data-f=' + f + ']');
  const sent = async (page) => { await page.waitForSelector('.lmd-sent', { timeout: 10000 }); return page.evaluate(() => { const b = document.querySelector('.lmd-sent'); return { text: b.querySelector('span').textContent, button: (b.querySelector('[data-sent=open]') || { textContent: '' }).textContent, bad: b.classList.contains('lmd-sent-bad') }; }); };
  const closeSent = (page) => page.evaluate(() => { const b = document.querySelector('.lmd-sent'); if (b) b.remove(); });
  const dlg = (page) => page.evaluate(() => {
    const c = document.querySelector('.lmd-send .lmd-send-card'); if (!c) return null;
    const t = (sel) => (c.querySelector(sel) || { textContent: '' }).textContent;
    return { title: t('h3'), copy: t('.lmd-send-copy'), dest: t('.lmd-send-dest'), change: !!c.querySelector('[data-sd=dest]'), sum: t('.lmd-send-sum'), warn: t('.lmd-send-warn'), modes: [...c.querySelectorAll('[data-mode]')].map((b) => b.textContent + (b.classList.contains('lmd-on') ? '*' : '')),
      picks: [...c.querySelectorAll('[data-pick]')].map((i) => i.dataset.pick + (i.checked ? '*' : '') + (i.disabled ? '-' : '')), img: t('.lmd-send-img'), imgs: t('.lmd-send-imgs'), none: t('.lmd-send-none'), buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent + (b.disabled ? '-' : '')),
      now: t('.lmd-send-now'), result: t('.lmd-send-result'), fails: [...c.querySelectorAll('.lmd-send-fails li')].map((li) => li.textContent), hints: [...c.querySelectorAll('.lmd-hint')].map((p) => p.textContent) };
  });
  const go = (page) => page.click('.lmd-send [data-sd=go]');

  console.log('Una nota: del navegador y del disco');
  await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-tree');
  const localMenu = await menuOf(app, row(app, 'local', 'local-one.md'));
  check('el menú de una nota del navegador ofrece enviarla a la nube', localMenu.some((i) => i[0] === 'send' && i[1] === 'Send to the cloud'), localMenu);
  await pick(app, 'send');
  const s1 = await sent(app);
  check('sin nada que decidir no hay diálogo: sale el aviso, que dice que es una copia', s1.text === 'A copy stays in the cloud. The note in this browser does not change.' && s1.button === 'Open the cloud note' && !s1.bad && !/[!¡]/.test(s1.text), s1);
  check('la nota quedó en la nube con el mismo nombre y contenido', (await textOf(ana, 'local-one.md')) === '# Local one\n\nLives in this browser.\n', await paths(ana));
  check('y la del navegador sigue donde estaba', (await app.evaluate(async () => (await LMD.store.noteGet('local-one.md') || {}).text)) === '# Local one\n\nLives in this browser.\n');
  await shot(app, '01-aviso-nota-enviada');
  await app.click('.lmd-sent [data-sent=open]');
  check('"Abrir la nota de la nube" abre la copia', !!(await until(() => app.evaluate(() => /f=cloud%2Flocal-one\.md/.test(location.href) && document.title === 'local-one.md'))), app.url());

  const diskMenu = await menuOf(app, row(app, 'disk', 'a.md'));
  check('el menú de un archivo del disco también', diskMenu.some((i) => i[0] === 'send' && i[1] === 'Send to the cloud'), diskMenu);
  await pick(app, 'send');
  const s2 = await sent(app);
  check('el aviso de un archivo del disco dice que el archivo no cambia', s2.text === 'A copy stays in the cloud. The file on disk does not change.' && s2.button === 'Open the cloud note', s2);
  check('el archivo del disco llegó igual a la nube, en la raíz', (await textOf(ana, 'a.md')) === DOCS['a.md'] && J(await paths(ana)) === J(['a.md', 'local-one.md']), await paths(ana));
  await closeSent(app);
  const jsonMenu = await menuOf(app, row(app, 'disk', 'data.json'));
  check('lo que no es una nota (un JSON) no ofrece enviarse', !jsonMenu.some((i) => i[0] === 'send'), jsonMenu);
  await app.keyboard.press('Escape');

  console.log('Ya existe una nota con ese nombre');
  await menuOf(app, row(app, 'disk', 'a.md')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const c1 = await dlg(app);
  check('si ya existe, pregunta qué hacer: saltear, reemplazar u otro nombre', c1.title === 'Send "a.md" to the cloud' && c1.copy === 'A copy stays in the cloud. The file on disk does not change.' && c1.dest === 'Cloud' && J(c1.modes) === J(['Skip', 'Replace', 'Save under another name*']) && J(c1.buttons) === J(['Cancel', 'Send']), c1);
  await shot(app, '02-dialogo-ya-existe');
  await go(app);
  const s3 = await sent(app);
  check('con otro nombre quedan las dos', /^Saved as "a-2\.md"\. /.test(s3.text) && (await textOf(ana, 'a-2.md')) === DOCS['a.md'] && (await textOf(ana, 'a.md')) === DOCS['a.md'], [s3, await paths(ana)]);
  await closeSent(app);
  const V2 = '# Alpha, second take\n\nLink to [beta](b.md).\n';
  await app.evaluate(async (t) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('docs'); const w = await (await dir.getFileHandle('a.md')).createWritable(); await w.write(t); await w.close(); }, V2);
  await menuOf(app, row(app, 'disk', 'a.md')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  await app.click('.lmd-send [data-mode=replace]'); await go(app); await sent(app);
  check('reemplazar pisa la de la nube y no suma una nota', (await textOf(ana, 'a.md')) === V2 && (await account(ana)).notes === 3, [await paths(ana), (await account(ana)).notes]);
  await closeSent(app);
  await menuOf(app, row(app, 'disk', 'a.md')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  await app.click('.lmd-send [data-mode=skip]');
  const c2 = await dlg(app);
  check('saltear no deja nada para enviar, y lo dice', c2.none === 'There is nothing new to send.' && J(c2.buttons) === J(['Cancel', 'Send-']), c2);
  await app.click('.lmd-send [data-sd=no]'); await app.waitForSelector('.lmd-send', { state: 'detached' });
  check('y no cambia nada en la nube', (await account(ana)).notes === 3 && (await textOf(ana, 'a.md')) === V2);

  console.log('Una carpeta, con el tope del plan gratis');
  const rootMenu = async (page, sec) => { await page.locator('.lmd-xroot[data-root=' + sec + '] .lmd-root-tog').click({ button: 'right' }); await page.waitForSelector('.lmd-menu'); return page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => [b.dataset.f, b.textContent.trim()])); };
  const rm = await rootMenu(app, 'disk');
  check('la raíz de la carpeta abierta ofrece enviar la carpeta', rm.some((i) => i[0] === 'send' && i[1] === 'Send the folder to the cloud'), rm);
  await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const f1 = await dlg(app);
  check('antes de empezar dice cuántas notas son y cuánto lugar queda, con el número del servidor', f1.title === 'Send the folder "docs" to the cloud' && f1.dest === 'Cloud / docs' && f1.sum === '5 notes · Free plan: 3 of ' + FREE + ' places left' && f1.copy === 'A copy stays in the cloud. The files on disk do not change.', f1);
  check('si no entran todas lo dice antes: "Entran 3 de 5"', f1.warn === '3 of 5 fit. The paid plan has no limit.' && J(f1.buttons) === J(['Cancel', 'See plans', 'Send 3 notes']), f1);
  check('deja elegir cuáles: las primeras marcadas y el resto sin poder pasarse del tope', J(f1.picks) === J(['a.md*', 'b.md*', 'notes.txt*', 'sub/c.md-', 'sub/deep/d.md-']), f1.picks);
  check('las imágenes de las notas no se suben en el plan gratis, y se avisa', f1.imgs === 'Uploading images is part of the paid plan: the notes go with their image paths as they are.' && !f1.img, [f1.imgs, f1.img]);
  await shot(app, '03-carpeta-tope-plan-gratis');
  await app.click('.lmd-send [data-pick="notes.txt"]'); await app.click('.lmd-send [data-pick="sub/deep/d.md"]');
  const f2 = await dlg(app);
  check('al cambiar la elección sigue sin pasarse', J(f2.picks) === J(['a.md*', 'b.md*', 'notes.txt-', 'sub/c.md-', 'sub/deep/d.md*']) && f2.buttons[2] === 'Send 3 notes', f2.picks);
  await go(app);
  await app.waitForSelector('.lmd-send .lmd-send-result', { timeout: 15000 });
  const f3 = await dlg(app);
  check('al final, el resumen: cuántas fueron y cuántas quedaron afuera', f3.result === '3 notes were sent. 2 were left out because they do not fit in the plan.' && J(f3.buttons) === J(['Close', 'Show in the cloud']) && !f3.fails.length, f3);
  check('la estructura se conserva dentro de una carpeta con ese nombre', J(await paths(ana)) === J(['a-2.md', 'a.md', 'docs/a.md', 'docs/b.md', 'docs/sub/deep/d.md', 'local-one.md']) && (await textOf(ana, 'docs/sub/deep/d.md')) === DOCS['sub/deep/d.md'], await paths(ana));
  check('nunca se pasó del tope ni quedó a medias sin avisar', (await account(ana)).notes === FREE && (await account(ana)).limit === FREE, await account(ana));
  await shot(app, '04-resumen-carpeta');
  await app.click('.lmd-send [data-sd=open]'); await app.waitForSelector('.lmd-send', { state: 'detached' });
  check('"Ver en la nube" deja la carpeta a la vista', !!(await until(() => app.evaluate(() => { const names = [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node')].map((n) => n.querySelector('.lmd-node-name').textContent); return names.includes('docs') && names.includes('b.md') && !!document.querySelector('.lmd-xroot[data-root=cloud] .lmd-trash-link'); }))));
  // Con el plan lleno, una sola nota tampoco entra: se dice antes.
  await menuOf(app, row(app, 'disk', 'b.md')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const full = await dlg(app);
  check('con el plan lleno no manda: lo dice y ofrece ver los planes', full.warn === '0 of 1 fit. The paid plan has no limit.' && J(full.buttons) === J(['Cancel', 'See plans', 'Send-']) && full.none === 'The free plan is full.', full);
  await shot(app, '05-plan-lleno');
  await app.click('.lmd-send [data-sd=plans]');
  check('"Ver planes" abre Plan', !!(await until(() => app.evaluate(() => { const p = document.querySelector('.lmd-panel'); return !!p && !p.hidden && /plan/i.test((p.querySelector('[data-ptab].lmd-on') || { dataset: {} }).dataset.ptab || ''); }))));
  await app.keyboard.press('Escape'); await sleep(200);
  await app.evaluate(() => { const p = document.querySelector('.lmd-panel'); if (p && !p.hidden) { const x = p.querySelector('[data-act=close-panel], .lmd-panel-close'); if (x) x.click(); } });
  check('y en la nube no entró nada de más', (await account(ana)).notes === FREE);

  console.log('Plan pago: avance, cancelar, lo que no se pudo y las imágenes');
  await signIn(pia);
  const more = {}; for (let i = 1; i <= 12; i++) more['many/n' + String(i).padStart(2, '0') + '.md'] = '# Note ' + i + '\n';
  // La página se recarga con la otra cuenta, y la carpeta del disco se vuelve a abrir.
  const reopen = async (files) => { await app.goto(OWN); await app.waitForSelector('.lmd-home'); await seedDisk(files || {}); await app.click('[data-home=dir]'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node'); await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-tree'); };
  await reopen(Object.assign({ 'many/big.md': '# Big\n\n' + 'x'.repeat(1100 * 1024) + '\n' }, more));
  const manyMenu = await menuOf(app, row(app, 'disk', 'many'));
  check('una carpeta del explorador ofrece enviarse entera', manyMenu.some((i) => i[0] === 'send' && i[1] === 'Send the folder to the cloud'), manyMenu);
  // Los guardados salen lentos, para poder cancelar a mitad.
  let slow = 350;
  await ctx.route((url) => url.href.startsWith(R.base + '/notes/'), async (r) => { if (r.request().method() === 'PUT' && slow) await sleep(slow); return r.continue(); });
  await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const p1 = await dlg(app);
  check('en el plan pago no hay tope: lo dice', p1.sum === '13 notes · Paid plan: no limit' && !p1.warn && J(p1.buttons) === J(['Cancel', 'Send 13 notes']) && p1.dest === 'Cloud / many', p1);
  await go(app);
  const mid = await until(async () => { const d = await dlg(app); return d && /^Sending [3-9] of 13…$/.test(d.now) ? d : null; }, 15000);
  check('mientras manda muestra el avance', !!mid && /^Sending \d+ of 13…$/.test(mid.now) && J(mid.buttons) === J(['Cancel']), mid && mid.now);
  await shot(app, '06-avance');
  await app.click('.lmd-send [data-sd=stop]');
  await app.waitForSelector('.lmd-send .lmd-send-result', { timeout: 15000 });
  const p2 = await dlg(app); const afterCancel = await paths(pia);
  const m2 = /^(\d+) notes? (?:was|were) sent\. Cancelled: (\d+) (?:was|were) not sent\.$/.exec(p2.result || '');
  check('cancelar a mitad frena y dice cuántas quedaron', !!m2 && +m2[1] + +m2[2] + p2.fails.length === 13 && +m2[1] >= 2 && +m2[1] < 13 && afterCancel.length === +m2[1] && afterCancel.every((p) => /^many\//.test(p)), [p2.result, afterCancel.length]);
  await app.click('.lmd-send [data-sd=no]'); await app.waitForSelector('.lmd-send', { state: 'detached' });
  slow = 0;
  await menuOf(app, row(app, 'disk', 'many')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const p3 = await dlg(app);
  check('al volver a enviarla, dice cuántas ya existen y por defecto las saltea', p3.sum === '13 notes · ' + afterCancel.length + ' already exist · Paid plan: no limit' && J(p3.modes) === J(['Skip*', 'Replace', 'Save under another name']) && p3.buttons[1] === 'Send ' + (13 - afterCancel.length) + ' notes', p3);
  await go(app); await app.waitForSelector('.lmd-send .lmd-send-result', { timeout: 30000 });
  const p4 = await dlg(app);
  check('una nota demasiado grande queda en el resumen sin frenar al resto', J(p4.fails) === J(['big.mdtoo large']) && (await paths(pia)).length === 12 && !(await paths(pia)).includes('many/big.md') && /already existed and (was|were) skipped\./.test(p4.result), [p4.result, p4.fails, (await paths(pia)).length]);
  await shot(app, '07-resumen-con-fallo');
  await app.click('.lmd-send [data-sd=no]'); await app.waitForSelector('.lmd-send', { state: 'detached' });

  // Imágenes: con plan pago se ofrece subirlas y la copia apunta al adjunto.
  await menuOf(app, row(app, 'disk', 'sub')); await pick(app, 'send'); await app.waitForSelector('.lmd-send');
  const i1 = await dlg(app);
  check('con plan pago ofrece subir las imágenes de las notas', i1.img === 'Also upload 1 image, and point the copy to it' && !i1.imgs && i1.sum === '2 notes · Paid plan: no limit', i1);
  await shot(app, '08-carpeta-con-imagenes');
  await go(app); await app.waitForSelector('.lmd-send .lmd-send-result', { timeout: 20000 });
  const i2 = await dlg(app); const cText = await textOf(pia, 'sub/c.md');
  check('la imagen sube como adjunto y la copia de la nube la nombra', i2.hints.includes('1 image was uploaded.') && /!\[dot\]\(https?:\/\/[^)]*\/f\/[0-9a-f]{40}\.png\)/.test(cText || ''), [i2.hints, cText]);
  check('los enlaces relativos entre las notas enviadas quedan como estaban', (cText || '').includes('[up](../b.md) and [deep](deep/d.md)') && (await textOf(pia, 'sub/deep/d.md')) === DOCS['sub/deep/d.md'], cText);
  await app.click('.lmd-send [data-sd=no]'); await app.waitForSelector('.lmd-send', { state: 'detached' });

  console.log('Arrastrar hasta la nube');
  const dragTo = async (page, from, to, peek) => {
    await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox(); await to.scrollIntoViewIfNeeded(); const b0 = await to.boundingBox();
    await page.mouse.move(a.x + 30, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
    const b = (await to.boundingBox()) || b0;
    await page.mouse.move(b.x + Math.min(60, b.width / 2), b.y + Math.min(14, b.height / 2), { steps: 6 }); await sleep(150);
    await page.mouse.move(b.x + Math.min(64, b.width / 2), b.y + Math.min(15, b.height / 2), { steps: 2 }); await sleep(150);
    const seen = peek ? await peek() : null;
    await page.mouse.up();
    return seen;
  };
  const dragState = (page) => page.evaluate(() => ({ tag: (document.querySelector('.lmd-drop-tag') || { textContent: '' }).textContent, mark: (document.querySelector('.lmd-drop') || { className: '' }).className, markName: ((document.querySelector('.lmd-drop .lmd-node-name, .lmd-drop .lmd-tree-path') || {}).textContent) || '' }));
  const cloudHead = (page) => page.locator('.lmd-xroot[data-root=cloud] .lmd-root-tog');
  const d1 = await dragTo(app, row(app, 'disk', 'b.md'), cloudHead(app), () => dragState(app));
  check('sobre la sección Nube, la etiqueta dice que es una copia', !!d1 && d1.tag === 'Copy to the cloud' && /lmd-xroot/.test(d1.mark), d1);
  const s4 = await sent(app);
  check('soltar un archivo del disco en la sección Nube lo envía a la raíz', s4.text === 'A copy stays in the cloud. The file on disk does not change.' && (await textOf(pia, 'b.md')) === DOCS['b.md'], [s4, await paths(pia)]);
  check('y la etiqueta se va al soltar', (await dragState(app)).tag === '');
  await closeSent(app);
  const d2 = await dragTo(app, row(app, 'local', 'local-one.md'), row(app, 'cloud', 'many'), () => dragState(app));
  await sent(app);
  check('soltar una nota del navegador sobre una carpeta de la nube la envía ahí', !!d2 && d2.tag === 'Copy to the cloud' && /lmd-node-dir/.test(d2.mark) && (await textOf(pia, 'many/local-one.md')) === '# Local one\n\nLives in this browser.\n' && !!(await app.evaluate(async () => LMD.store.noteGet('local-one.md'))), [d2, await paths(pia)]);
  await closeSent(app);
  await dragTo(app, row(app, 'disk', 'many'), cloudHead(app));
  await app.waitForSelector('.lmd-send');
  const d3 = await dlg(app);
  check('soltar una carpeta del disco abre el resumen, con el destino ya dicho', d3.title === 'Send the folder "many" to the cloud' && d3.dest === 'Cloud / many' && !d3.change && /^13 notes · 12 already exist/.test(d3.sum), d3);
  await app.click('.lmd-send [data-sd=no]'); await app.waitForSelector('.lmd-send', { state: 'detached' });
  // El arrastre de siempre, dentro del disco, sigue moviendo.
  await dragTo(app, row(app, 'disk', 'notes.txt'), row(app, 'disk', 'sub'));
  const moved = await until(async () => { const d = await diskNow(); return d['sub/notes.txt'] != null && d['notes.txt'] == null; }, 6000);
  check('el arrastre dentro del disco no cambió: sigue moviendo', !!moved && !(await paths(pia)).includes('sub/notes.txt'), Object.keys(await diskNow()));

  console.log('Lo del disco no cambia');
  const now = await diskNow();
  check('después de todos los envíos, los archivos del disco tienen su texto de siempre', now['b.md'] === DOCS['b.md'] && now['a.md'] === V2 && now['sub/c.md'] === DOCS['sub/c.md'] && now['sub/deep/d.md'] === DOCS['sub/deep/d.md'] && Object.keys(now).filter((k) => /^many\//.test(k)).length === 13, Object.keys(now));

  console.log('Carpeta protegida de la nube');
  const PASS = 'correct horse battery staple 42';
  await menuOf(app, row(app, 'cloud', 'sub')); await pick(app, 'v-protect');
  await app.waitForSelector('[data-v=p1]'); await app.fill('[data-v=p1]', PASS); await app.fill('[data-v=p2]', PASS); await app.click('[data-v=ok]');
  await app.waitForSelector('.lmd-vault-key', { timeout: 20000 });
  await Promise.all([app.waitForEvent('download').catch(() => null), app.click('[data-v=down]')]);
  await app.click('[data-v=ok]'); await sleep(600);
  // Al recargar, la carpeta queda bloqueada en la pestaña.
  await reopen();
  await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-vault-shut', { timeout: 10000 });
  await dragTo(app, row(app, 'disk', 'b.md'), row(app, 'cloud', 'sub'));
  await app.waitForSelector('[data-v=p]', { timeout: 10000 });
  check('enviar a una carpeta protegida y bloqueada pide desbloquearla', (await paths(pia)).includes('sub/b.md') === false);
  await shot(app, '09-carpeta-protegida-pide-clave');
  await app.fill('[data-v=p]', PASS); await app.click('[data-v=ok]');
  await sent(app);
  const sealed = ((await R.api('GET', '/notes/' + encodeURIComponent('sub/b.md'), undefined, pia.s)).json || {}).text || '';
  check('y la nota nueva llega cifrada, como cualquier nota de esa carpeta', sealed.length > 0 && !sealed.includes('Second') && !sealed.includes('Beta'), sealed.slice(0, 60));
  await closeSent(app);

  console.log('Sin sesión');
  await signIn(null);
  await until(() => app.evaluate(() => !LMD.cloud.signedIn() && !!document.querySelector('.lmd-xroot[data-root=cloud] .lmd-root-hint')));
  const outMenu = await menuOf(app, row(app, 'disk', 'a.md'));
  check('sin sesión la opción aparece igual', outMenu.some((i) => i[0] === 'send'), outMenu);
  await pick(app, 'send'); await app.waitForSelector('.lmd-dlg-card');
  const ask = await app.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent, ok: document.querySelector('.lmd-dlg [data-dlg=ok]').textContent }));
  check('y explica en una línea que hay que entrar, con el botón', J(ask) === J({ title: 'Send to the cloud', text: 'Sending to the cloud needs your account. Once you sign in, the upload continues.', ok: 'Sign in' }), ask);
  await shot(app, '10-sin-sesion');
  await app.click('.lmd-dlg [data-dlg=ok]');
  check('"Entrar" abre el formulario de la cuenta', !!(await until(() => app.evaluate(() => !!document.querySelector('.lmd-login [data-field=email], .lmd-login')))));
  // La sesión llega (se entró): el envío sigue solo.
  await signIn(ana);
  await app.waitForSelector('.lmd-send', { timeout: 10000 });
  const resumed = await dlg(app);
  check('al entrar, el envío se retoma donde quedó', resumed.title === 'Send "a.md" to the cloud' && resumed.warn === '0 of 1 fit. The paid plan has no limit.', resumed);
  await app.click('.lmd-send [data-sd=no]');
  await app.evaluate(() => { const b = document.querySelector('.lmd-login [data-cloud=cancel]'); if (b) b.click(); });

  // ---------- El lector de un archivo del disco (file://) ----------
  console.log('El lector de file://: la nube y su papelera');
  await signIn(pia);
  const rd = await ctx.newPage(); rd.on('pageerror', (e) => errors.push(e.message));
  await rd.goto(U('r.md')); await rd.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node');
  await rd.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node', { timeout: 10000 });
  const secs = await rd.evaluate(() => [...document.querySelectorAll('.lmd-xroot')].map((s) => ({ root: s.dataset.root, name: s.querySelector('.lmd-tree-path').textContent, nodes: [...s.querySelectorAll(':scope > .lmd-tree > .lmd-node .lmd-node-name')].map((n) => n.textContent), trash: (s.querySelector('.lmd-trash-link') || { textContent: '' }).textContent.trim(), add: !!s.querySelector('.lmd-tree-new') })));
  check('con sesión, el lateral del lector muestra también la Nube, con sus carpetas y su Papelera', secs.length === 2 && secs[0].root === 'disk' && secs[1].root === 'cloud' && secs[1].name === 'Cloud' && secs[1].trash === 'Trash' && ['many', 'sub', 'b.md'].every((n) => secs[1].nodes.includes(n)) && !secs[1].add, secs);
  await shot(rd, '11-lector-file-con-nube');
  const rMenu = await menuOf(rd, row(rd, 'disk', 's.md'));
  check('el archivo del disco ofrece enviarse desde el lector', rMenu.some((i) => i[0] === 'send' && i[1] === 'Send to the cloud') && rMenu.some((i) => i[0] === 'flink'), rMenu);
  await pick(rd, 'send'); await rd.waitForSelector('.lmd-send');
  const r1 = await dlg(rd);
  check('con carpetas en la nube pregunta a cuál: por defecto la raíz', r1.title === 'Send "s.md" to the cloud' && r1.dest === 'Cloud' && r1.change && J(r1.buttons) === J(['Cancel', 'Send']), r1);
  await rd.click('.lmd-send [data-sd=dest]'); await rd.waitForSelector('.lmd-send-pick');
  const picker = await rd.evaluate(() => [...document.querySelectorAll('.lmd-send-pick [data-mv]')].map((b) => b.querySelector('.lmd-mv-name') ? b.querySelector('.lmd-mv-name').textContent : b.textContent));
  check('el selector lista las carpetas de la nube y "Nueva carpeta"', picker[0] === 'Cloud' && picker.includes('many') && picker.includes('sub') && picker.includes('deep') && picker.includes('New folder…'), picker);
  await shot(rd, '12-lector-elegir-carpeta');
  await rd.locator('.lmd-send-pick [data-mv]', { hasText: 'many' }).first().click();
  check('la carpeta elegida queda como destino', (await dlg(rd)).dest === 'Cloud / many', await dlg(rd));
  await go(rd);
  const r2 = await sent(rd);
  check('desde el lector la nota llega a la nube por la extensión', r2.text === 'A copy stays in the cloud. The file on disk does not change.' && (await textOf(pia, 'many/s.md')) === READER['s.md'], [r2, (await paths(pia)).filter((p) => /s\.md$/.test(p))]);
  check('y el archivo del disco no cambió', fs.readFileSync(path.join(disk, 's.md'), 'utf8') === READER['s.md']);
  const opening = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await rd.click('.lmd-sent [data-sent=open]');
  const opened = await opening;
  check('"Abrir la nota de la nube" la abre en la app, en otra pestaña', !!opened && opened.url().startsWith(OWN + '?f=cloud%2Fmany%2Fs.md'), opened && opened.url());
  if (opened) await opened.close();
  await rd.bringToFront();
  const boxMenu = await menuOf(rd, row(rd, 'disk', 'box'));
  check('una carpeta del lector ofrece enviarse entera', boxMenu[0] && boxMenu[0][0] === 'send' && boxMenu[0][1] === 'Send the folder to the cloud' && !boxMenu.some((m) => /ren|del|new|mov/i.test(m[0])), boxMenu);
  await pick(rd, 'send'); await rd.waitForSelector('.lmd-send');
  const r3 = await dlg(rd);
  check('el resumen de la carpeta, también en el lector', r3.title === 'Send the folder "box" to the cloud' && r3.sum === '2 notes · Paid plan: no limit' && r3.dest === 'Cloud / box', r3);
  await go(rd); await rd.waitForSelector('.lmd-send .lmd-send-result', { timeout: 20000 });
  check('con subcarpetas, y sin tocar el disco', (await textOf(pia, 'box/t.md')) === READER['box/t.md'] && (await textOf(pia, 'box/in/u.md')) === READER['box/in/u.md'] && fs.readFileSync(path.join(disk, 'box', 't.md'), 'utf8') === READER['box/t.md'], (await paths(pia)).filter((p) => /^box/.test(p)));
  await rd.click('.lmd-send [data-sd=open]'); await rd.waitForSelector('.lmd-send', { state: 'detached' });
  check('"Ver en la nube" despliega la carpeta enviada en el lateral del lector', !!(await until(() => rd.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node .lmd-node-name')].map((n) => n.textContent).includes('t.md')))));
  await shot(rd, '13-lector-carpeta-enviada');
  const d4 = await dragTo(rd, row(rd, 'disk', 'memo.txt'), row(rd, 'cloud', 'box'), () => dragState(rd));
  await sent(rd);
  check('en el lector, arrastrar un archivo a una carpeta de la nube lo envía ahí', !!d4 && d4.tag === 'Copy to the cloud' && (await textOf(pia, 'box/memo.txt')) === READER['memo.txt'], [d4, (await paths(pia)).filter((p) => /^box/.test(p))]);
  await closeSent(rd);
  // Una nota de la nube, desde el lector, se abre en la app.
  const opening2 = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await row(rd, 'cloud', 'b.md').click();
  const opened2 = await opening2;
  check('una nota de la nube se abre en la app, y el lector sigue en su archivo', !!opened2 && opened2.url().startsWith(OWN + '?f=cloud%2Fb.md') && rd.url().startsWith(U('r.md')), opened2 && opened2.url());
  if (opened2) await opened2.close();
  await rd.bringToFront();
  const cloudNodeMenu = await rd.evaluate(() => { const n = [...document.querySelectorAll('.lmd-xroot[data-root=cloud] a.lmd-node')][0]; const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }); n.dispatchEvent(ev); return { prevented: ev.defaultPrevented, menu: !!document.querySelector('.lmd-menu') }; });
  check('desde el lector las notas de la nube no se administran: sin menú propio', !cloudNodeMenu.prevented && !cloudNodeMenu.menu, cloudNodeMenu);

  // La papelera: se ve y se restaura; borrar del todo queda en la app.
  await R.api('DELETE', '/notes/' + encodeURIComponent('b.md'), undefined, pia.s);
  await rd.click('.lmd-xroot[data-root=cloud] .lmd-trash-link'); await rd.waitForSelector('.lmd-trash');
  const bin = await rd.evaluate(() => ({ rows: [...document.querySelectorAll('.lmd-trash-list li')].map((li) => li.querySelector('b').textContent + ':' + [...li.querySelectorAll('[data-tr]')].map((b) => b.dataset.tr).join(',')), hint: (document.querySelector('.lmd-trash-mild') || { textContent: '' }).textContent, buttons: [...document.querySelectorAll('.lmd-trash .lmd-ask-actions button')].map((b) => b.textContent) }));
  check('la Papelera de la nube se abre desde el lector, con restaurar', J(bin.rows) === J(['b.md:back']) && bin.hint === 'To delete for good, open the app.' && J(bin.buttons) === J(['Close']), bin);
  await shot(rd, '14-lector-papelera');
  await rd.click('.lmd-trash [data-tr=back]');
  check('y restaurar devuelve la nota', !!(await until(async () => (await paths(pia)).includes('b.md'))));
  await rd.click('.lmd-trash [data-tr=no]');
  // La lista cerrada de rutas del puente: de la papelera pasan verla y restaurar; borrar, no.
  const viaSw = (method, p) => bg(([m, q]) => new Promise((resolve) => { const from = { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, url: 'file:///C:/notes/a.md' }; if (LMD.bridgeHost.onCloud({ method: m, path: q }, from, resolve) === false) { /* ya contestó */ } }), [method, p]);
  const okTrash = await viaSw('GET', '/trash'); const noTrash = [];
  for (const [m, p] of [['DELETE', '/trash'], ['DELETE', '/trash/1'], ['GET', '/trash/1'], ['POST', '/trash'], ['POST', '/trash/1/restore?x=1'], ['POST', '/trash/1/restore/..'], ['POST', '/trash/a/restore'], ['DELETE', '/notes/b.md'], ['POST', '/rename']]) noTrash.push((await viaSw(m, p)) || {});
  check('el puente deja ver la papelera y restaurar; borrar, vaciar, eliminar y mover notas siguen fuera', okTrash && okTrash.ok === true && okTrash.status === 200 && noTrash.every((r) => r.ok === false && r.error === 'refused'), [okTrash && okTrash.status, noTrash.map((r) => r.error || r.status)]);
  const fromApp = await app.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'cloudApi', method: 'GET', path: '/trash' }, resolve)));
  check('y solo para el lector de un archivo del disco: la página de la extensión no pasa', fromApp && fromApp.ok === false && fromApp.error === 'refused', fromApp);

  // Eliminar un archivo del disco en la app: el texto dice qué pasa.
  await app.bringToFront();
  await reopen();
  await menuOf(app, row(app, 'disk', 'data.json')); await pick(app, 'del'); await app.waitForSelector('.lmd-dlg');
  const del = await app.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent }));
  check('al eliminar un archivo del disco, la confirmación dice que no hay papelera', del.title === 'Delete "data.json"?' && del.text === 'It is deleted from the disk, without going through the trash. This cannot be undone.', del);
  await app.click('.lmd-dlg [data-dlg=no]');

  // Sin sesión, el lector muestra la fila para entrar.
  await rd.bringToFront();
  await signIn(null);
  const noSess = await until(() => rd.evaluate(() => { const s = document.querySelector('.lmd-xroot[data-root=cloud]'); const hint = s && s.querySelector('.lmd-root-hint'); return hint && !s.querySelector('.lmd-trash-link') && !s.querySelector('.lmd-node') ? hint.textContent : ''; }), 10000);
  check('sin sesión, el lector muestra la fila para entrar, sin notas ni papelera', noSess === 'Sign in to see your notes', noSess);
  await shot(rd, '15-lector-sin-sesion');
  const opening3 = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await rd.click('.lmd-xroot[data-root=cloud] .lmd-root-hint');
  const opened3 = await opening3;
  check('esa fila lleva a entrar en la app', !!opened3 && opened3.url().startsWith(OWN + '?login=1'), opened3 && opened3.url());
  if (opened3) await opened3.close();
  await rd.bringToFront();
  const outR = await menuOf(rd, row(rd, 'disk', 's.md'));
  check('y enviar sigue en el menú', outR.some((i) => i[0] === 'send'), outR);
  await rd.keyboard.press('Escape');
  // Al entrar del otro lado, la nube aparece sola en el lector.
  await signIn(pia);
  check('al entrar, la nube aparece en el lector sin recargar', !!(await until(() => rd.evaluate(() => !!document.querySelector('.lmd-xroot[data-root=cloud] .lmd-node') && !!document.querySelector('.lmd-xroot[data-root=cloud] .lmd-trash-link')), 10000)));

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
