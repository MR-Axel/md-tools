// Un PDF, un libro o una imagen del disco en el visor de SharpMD, con la extensión cargada de verdad:
//  - "Abrir los PDF del disco con SharpMD" (Ajustes > Instalar): apagado, un file:///…pdf queda en el visor
//    del navegador y sobre él no corre nada; prendido, pasa al visor de SharpMD, con su carpeta en el explorador;
//  - la salida "Abrir con el visor del navegador", sin rebote, y atrás y adelante;
//  - desde el lector de un .md del disco, el clic en un PDF, un libro o una imagen (explorador o enlace de la nota);
//  - un PDF de más de 20 MB, que llega entero sin pasar por los mensajes, y el tope de tamaño de cada tipo.
// Los archivos se arman acá: los PDF los imprime Chromium, el libro es un zip mínimo.
//   node pdfopen.mjs
import { tally, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import zlib from 'zlib'; import { pathToFileURL } from 'url';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(100); } };
const BIN = process.env.CHROME_BIN || chromium.executablePath();

// ---------- Archivos de prueba ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const parts = []; const central = []; let offset = 0; const names = Object.keys(files);
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name], 'utf8'); const body = zlib.deflateRawSync(data); const nm = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nm.length, 26);
    parts.push(head, nm, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(data), 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nm); offset += 30 + nm.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat(central, [end]));
}
function png(w, h, rgb) {
  const row = Buffer.alloc(1 + w * 4); const rows = [];
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const o = 1 + x * 4; row[o] = rgb[0]; row[o + 1] = rgb[1]; row[o + 2] = rgb[2]; row[o + 3] = 255; } rows.push(Buffer.from(row)); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const XH = (title, body) => '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + title + '</title></head><body>' + body + '</body></html>';
const EPUB = zip({
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Quiet Harbour</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  'ch1.xhtml': XH('One', '<h1>Chapter One</h1><p>The lighthouse stood alone.</p>'),
});
// El PDF sale de imprimir una página con Chromium. noise: además, una imagen de ruido que no se comprime, para que
// el archivo pese lo que se pide (en megas).
async function makePdf(pages, noise) {
  const maker = await chromium.launch({ executablePath: BIN }); const page = await maker.newPage();
  const body = Array.from({ length: pages }, (_, i) => '<section style="page-break-after:always"><h1>Part ' + (i + 1) + '</h1><p>This is the text of page number ' + (i + 1) + '.</p></section>').join('');
  await page.setContent('<!doctype html><html><head><title>Test Book</title><style>body{font:14pt Georgia,serif;margin:0}section{padding:10mm}img{width:100mm}</style></head><body>' + body + '</body></html>');
  if (noise) await page.evaluate(async (mb) => {
    const side = Math.ceil(Math.sqrt(mb * 1048576 / 3)); const c = document.createElement('canvas'); c.width = side; c.height = side; const g = c.getContext('2d'); const d = g.createImageData(side, side);
    for (let i = 0; i < d.data.length; i += 65536) crypto.getRandomValues(d.data.subarray(i, Math.min(d.data.length, i + 65536)));
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
    g.putImageData(d, 0, 0);
    const img = new Image(); img.src = c.toDataURL('image/png'); await img.decode(); document.body.appendChild(img);
  }, noise);
  const buf = await page.pdf({ width: '148mm', height: '210mm', outline: true, printBackground: true, timeout: 120000 });
  await maker.close();
  return buf;
}

const disk = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-pdfdisk-')));
const urlOf = (...p) => pathToFileURL(path.join(disk, ...p)).href;
fs.mkdirSync(path.join(disk, 'img')); fs.mkdirSync(path.join(disk, 'sub dir'));
fs.writeFileSync(path.join(disk, 'libro.pdf'), await makePdf(5));
const BIG = await makePdf(3, 21);
fs.writeFileSync(path.join(disk, 'grande.pdf'), BIG);
fs.writeFileSync(path.join(disk, 'cuento.epub'), EPUB);
fs.writeFileSync(path.join(disk, 'img', 'foto.png'), png(300, 200, [200, 80, 40]));
fs.writeFileSync(path.join(disk, 'img', 'enorme.png'), Buffer.alloc(41 * 1048576)); // pasa el tope de las imágenes (40 MB)
fs.writeFileSync(path.join(disk, 'sub dir', 'otro más.pdf'), fs.readFileSync(path.join(disk, 'libro.pdf')));
fs.writeFileSync(path.join(disk, 'nota.md'), '# Nota del disco\n\nVer [el libro](libro.pdf), [la página tres](libro.pdf#page=3), [la foto](img/foto.png) y [otra nota](otra.md).\n');
fs.writeFileSync(path.join(disk, 'otra.md'), '# Otra\n');
fs.writeFileSync(path.join(disk, 'datos.bin'), Buffer.from([0, 1, 2, 3]));

// Un PDF servido por un sitio: ese nunca se toca.
const site = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(fs.readFileSync(path.join(disk, 'libro.pdf'))); });
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const WEB_PDF = 'http://127.0.0.1:' + site.address().port + '/libro.pdf';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-pdfopen-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: BIN, viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const errors = [];
try {
  const first = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(first.url()).host; const OWN = 'chrome-extension://' + id + '/src/app.html';
  const SW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://' + id)) || ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const bg = async (fn, arg) => (await SW()).evaluate(fn, arg);
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  await bg(() => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }));
  const registered = () => bg(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({ id: s.id, js: s.js, matches: s.matches.slice().sort(), all: s.allFrames })));
  const setting = () => bg(async () => (await LMD.load()).diskPdf);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  // Ir a un archivo del disco: si la pestaña pasa a otra dirección a mitad de la carga, la navegación "falla" y está bien.
  const visit = async (url) => { await page.goto(url).catch(() => {}); };
  const inApp = () => page.url().startsWith(OWN + '?f=');
  const viewing = (kind, ms) => until(() => inApp() && page.evaluate((k) => { const p = window.LMD && LMD.viewer && LMD.viewer.peek(); return !!p && p.ready && p.kind === k ? p : null; }, kind), ms || 20000);
  const tree = () => page.evaluate(() => { const sec = document.querySelector('.lmd-xroot[data-root=fs]'); return sec ? { title: sec.querySelector('.lmd-tree-path').textContent.trim() + ' | ' + sec.querySelector('.lmd-root-tog').title, names: [...sec.querySelectorAll('.lmd-node .lmd-node-name')].map((n) => n.textContent), active: (sec.querySelector('.lmd-node.lmd-active .lmd-node-name') || {}).textContent || '' } : null; });
  let tabs = 0; // cuántas pestañas había antes de cada paso: no se tiene que sumar ninguna
  const quiet = async (ms) => { const at = page.url(); await sleep(ms || 2500); return page.url() === at; };

  // ---------- El manifest: ni permisos ni scripts nuevos ----------
  console.log('Manifest');
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  check('los mismos permisos de siempre, sin tabs, webNavigation ni declarativeNetRequest', J(man.permissions) === J(['storage', 'scripting']) && J(man.host_permissions) === J(['file:///*', '*://*/*']), [man.permissions, man.host_permissions]);
  check('ningún script del manifest corre sobre un PDF, y la app sigue abierta solo a sharpmd.app', !man.content_scripts.some((c) => c.matches.some((m) => /pdf|epub|\*\.\*|<all_urls>/i.test(m)) || c.js.includes('src/pdfopen.js')) && man.web_accessible_resources.every((w) => !w.matches.some((m) => /^file:/.test(m))));
  check('el script que lleva un PDF al visor existe y no lee ni toca el documento', fs.existsSync(path.join(root, 'src', 'pdfopen.js')) && !/querySelector|innerHTML|fetch\(|document\.body/.test(fs.readFileSync(path.join(root, 'src', 'pdfopen.js'), 'utf8')));

  // ---------- Apagado: nada cambia ----------
  console.log('Con el ajuste apagado');
  check('el ajuste viene apagado y no hay ningún script registrado', (await setting()) === false && J(await registered()) === '[]', await registered());
  await visit(urlOf('libro.pdf'));
  check('un PDF del disco queda en el visor del navegador', (await quiet()) && page.url() === urlOf('libro.pdf') && (await page.evaluate(() => document.contentType)) === 'application/pdf', page.url());
  check('la página de la app no puede leer file:// por su cuenta: por eso lee el service worker', await (async () => { const p = await ctx.newPage(); await p.goto(OWN); await p.waitForSelector('.lmd-home'); const r = await p.evaluate(async (u) => { try { await fetch(u); return 'leyó'; } catch (e) { return 'no'; } }, urlOf('libro.pdf')); await p.close(); return r === 'no'; })());

  // ---------- El interruptor, en Ajustes ----------
  console.log('El interruptor en Ajustes');
  await page.goto(OWN); await page.waitForSelector('.lmd-home');
  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=inst]'); await page.waitForSelector('input[data-inst=pdf]');
  const sw0 = await page.evaluate(() => { const i = document.querySelector('input[data-inst=pdf]'); const lab = i && i.closest('label'); const hint = lab && lab.nextElementSibling; return i ? { on: i.checked, text: lab.textContent.trim(), hint: hint ? hint.textContent : '', hintCls: hint ? hint.className : '', shown: !!lab.offsetParent, sec: lab.closest('section').querySelector('h3').textContent, after: (() => { let n = lab.previousElementSibling; while (n && n.tagName !== 'H4') n = n.previousElementSibling; return n ? n.textContent : ''; })() } : null; });
  check('está en Ajustes > Instalar, debajo de "Abrir los .md con doble clic", apagado, con una línea de ayuda corta', !!sw0 && sw0.on === false && sw0.shown && sw0.sec === 'Install' && sw0.after === 'Open .md files with a double click' && sw0.text === 'Open PDFs from disk with SharpMD' && sw0.hintCls === 'lmd-hint' && /browser viewer/.test(sw0.hint) && /websites do not change/.test(sw0.hint) && sw0.hint.length < 130 && !/[!—]/.test(sw0.text + sw0.hint), sw0);
  await page.evaluate(() => LMD.setLang('es'));
  check('y su texto en castellano', (await page.evaluate(() => [LMD.t('Abrir los PDF del disco con SharpMD'), LMD.t('Abrir con el visor del navegador')])).join('|') === 'Abrir los PDF del disco con SharpMD|Abrir con el visor del navegador');
  await page.evaluate(() => LMD.setLang('en'));
  await page.click('input[data-inst=pdf]');
  const reg = await until(async () => { const r = await registered(); return r.length ? r : null; }, 5000);
  check('prenderlo guarda el ajuste y registra el script solo sobre PDF del disco, en el marco principal', (await setting()) === true && !!reg && reg.length === 1 && reg[0].id === 'lmd-pdf' && J(reg[0].js) === J(['src/pdfopen.js']) && J(reg[0].matches) === J(['file:///*.PDF', 'file:///*.pdf']) && reg[0].all === false, reg);

  // ---------- Prendido: el PDF se ve en SharpMD ----------
  console.log('Con el ajuste prendido');
  tabs = ctx.pages().length;
  await visit(urlOf('libro.pdf'));
  const v1 = await viewing('pdf');
  check('un PDF del disco pasa al visor de SharpMD, en la misma pestaña', !!v1 && v1.n === 5 && ctx.pages().length === tabs, [page.url(), v1]);
  const at1 = await page.evaluate(() => ({ f: new URL(location.href).searchParams.get('f'), name: document.querySelector('.lmd-docname').textContent, title: document.title, total: document.querySelector('.lmd-vw-total').textContent, pages: document.querySelectorAll('.lmd-vw-page').length, bin: document.documentElement.classList.contains('lmd-bin'), copy: !!document.querySelector('.lmd-copybar:not([hidden])') }));
  check('con su nombre, sus páginas y sin cartel de copia', at1.name === 'libro.pdf' && at1.title === 'libro.pdf' && at1.total === '/ 5' && at1.pages === 5 && at1.bin && !at1.copy && /^fs\//.test(at1.f) && at1.f.endsWith('/libro.pdf'), at1);
  check('la primera página se dibuja, con su texto', !!(await until(() => page.evaluate(() => { const c = document.querySelector('.lmd-vw-page canvas'); const t = document.querySelector('.lmd-vw-page .lmd-vw-text'); return !!c && c.width > 100 && !!t && /Part 1/.test(t.textContent); }), 15000)));
  const t1 = await until(async () => { const t = await tree(); return t && t.names.length >= 5 ? t : null; }, 8000);
  check('el explorador muestra la carpeta del archivo: notas, PDF, libro y subcarpetas, sin lo que SharpMD no abre', !!t1 && J(t1.names) === J(['img', 'sub dir', 'cuento.epub', 'grande.pdf', 'libro.pdf', 'nota.md', 'otra.md']) && t1.active === 'libro.pdf' && t1.title.includes(path.basename(disk)), t1);
  const bar = await page.evaluate(() => { const b = document.querySelector('.lmd-vw-bar [data-vw=native]'); return b ? { label: b.getAttribute('aria-label'), title: b.title, shown: !!b.offsetParent, w: Math.round(b.getBoundingClientRect().width) } : null; });
  check('la barra del visor tiene la salida "Abrir con el visor del navegador"', !!bar && bar.label === 'Open with the browser viewer' && bar.shown && bar.w >= 32, bar);
  check('la ruta del archivo se puede copiar desde el menú', await (async () => { await page.click('.lmd-topbar [data-act=export]'); await page.waitForSelector('.lmd-menu-export'); const acts = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export [data-more]')].map((b) => b.dataset.more)); await page.keyboard.press('Escape'); return acts.includes('copy-path') && acts.includes('export-md') ? true : (console.log(acts), false); })());

  // ---------- La salida al visor del navegador ----------
  console.log('La salida al visor del navegador');
  await page.click('.lmd-vw-bar [data-vw=native]');
  await until(() => page.url().startsWith('file:'), 8000);
  check('un toque lleva ese archivo al visor del navegador, y ahí queda (sin rebote)', page.url() === urlOf('libro.pdf') + '#lmd-native' && (await quiet(3000)) && (await page.evaluate(() => document.contentType)) === 'application/pdf', page.url());
  await page.reload().catch(() => {});
  check('recargar ahí tampoco lo trae de vuelta', (await quiet(2500)) && page.url() === urlOf('libro.pdf') + '#lmd-native', page.url());
  await page.goBack().catch(() => {});
  check('atrás vuelve al visor de SharpMD', !!(await viewing('pdf')), page.url());
  await page.goBack().catch(() => {});
  await until(() => page.url().startsWith('file:'), 8000);
  check('y atrás de nuevo deja el PDF en el visor del navegador, sin rebotar a SharpMD', page.url() === urlOf('libro.pdf') && (await quiet(3000)), page.url());
  await page.goForward().catch(() => {});
  check('adelante vuelve a SharpMD', !!(await viewing('pdf')), page.url());

  // ---------- La página pedida, nombres con espacios y acentos, y la web ----------
  console.log('Direcciones');
  await visit(urlOf('libro.pdf') + '#page=4');
  const v4 = await viewing('pdf');
  check('la página pedida en la dirección (#page=4) llega al visor', !!v4 && !!(await until(() => page.evaluate(() => LMD.viewer.peek().page === 3), 6000)), v4);
  await visit(urlOf('sub dir', 'otro más.pdf'));
  const v5 = await viewing('pdf');
  check('un nombre con espacios y acentos, en una subcarpeta', !!v5 && v5.n === 5 && (await page.evaluate(() => document.querySelector('.lmd-docname').textContent)) === 'otro más.pdf' && (await until(async () => ((await tree()) || {}).active === 'otro más.pdf', 6000)), [page.url(), await tree()]);
  await visit(WEB_PDF);
  check('un PDF de un sitio web no se toca', (await quiet(3000)) && page.url() === WEB_PDF, page.url());

  // ---------- Del visor a una nota, y de la nota al visor ----------
  console.log('El lector de un .md del disco');
  await visit(urlOf('libro.pdf')); await viewing('pdf');
  await until(async () => ((await tree()) || { names: [] }).names.includes('nota.md'), 8000);
  const mdHref = await page.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=fs] a.lmd-node')].find((a) => a.querySelector('.lmd-node-name').textContent === 'nota.md').href);
  await page.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=fs] a.lmd-node')].find((a) => a.querySelector('.lmd-node-name').textContent === 'nota.md').click());
  await until(() => page.url().startsWith('file:'), 8000); await page.waitForSelector('.markdown-body h1');
  check('en el explorador del visor, una nota lleva a su lector, en su dirección del disco', mdHref === urlOf('nota.md') && page.url() === urlOf('nota.md') && (await page.evaluate(() => document.querySelector('.markdown-body h1').textContent)) === 'Nota del disco', [mdHref, page.url()]);
  // De acá en más, con el ajuste apagado: el clic desde el lector no depende de él.
  await bg(() => LMD.patch({ diskPdf: false }));
  check('apagar el ajuste quita el script', !!(await until(async () => (await registered()).length === 0, 5000)), await registered());
  const node = (name) => page.evaluate((n) => { const a = [...document.querySelectorAll('.lmd-pane-files a.lmd-node')].find((x) => x.querySelector('.lmd-node-name').textContent === n); if (!a) return false; a.click(); return true; }, name);
  const reader = async () => { await visit(urlOf('nota.md')); await page.waitForSelector('.markdown-body h1'); await until(() => page.evaluate(() => document.querySelectorAll('.lmd-pane-files a.lmd-node').length >= 4), 8000); };
  await reader();
  check('el explorador del lector lista el PDF, el libro y las notas', J(await page.evaluate(() => [...document.querySelectorAll('.lmd-pane-files .lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node .lmd-node-name, .lmd-pane-files .lmd-xroot[data-root=disk] > .lmd-tree > a .lmd-node-name')].map((n) => n.textContent))) === J(['img', 'sub dir', 'cuento.epub', 'grande.pdf', 'libro.pdf', 'nota.md', 'otra.md']), await page.evaluate(() => [...document.querySelectorAll('.lmd-pane-files .lmd-node-name')].map((n) => n.textContent)));
  tabs = ctx.pages().length;
  await node('libro.pdf');
  const r1 = await viewing('pdf');
  check('clic en un PDF del explorador: se ve en el visor de SharpMD, en la misma pestaña, con el ajuste apagado', !!r1 && r1.n === 5 && ctx.pages().length === tabs && (await page.evaluate(() => document.querySelector('.lmd-docname').textContent)) === 'libro.pdf', [page.url(), r1]);
  await page.goBack().catch(() => {});
  check('y atrás vuelve a la nota', !!(await until(() => page.url() === urlOf('nota.md'), 8000)) && !!(await page.waitForSelector('.markdown-body h1').catch(() => null)), page.url());
  await reader();
  await page.click('.markdown-body a[href="libro.pdf#page=3"]');
  const r2 = await viewing('pdf');
  check('un enlace de la nota a un PDF, con su página', !!r2 && !!(await until(() => page.evaluate(() => LMD.viewer.peek().page === 2), 6000)), [page.url(), r2]);
  await reader();
  await page.click('.markdown-body a[href="img/foto.png"]');
  const r3 = await viewing('image');
  check('un enlace a una imagen: el visor de imágenes, con la carpeta de la imagen en el explorador', !!r3 && (await page.evaluate(() => document.querySelector('.lmd-docname').textContent)) === 'foto.png' && !!(await until(async () => ((await tree()) || {}).active === 'foto.png', 6000)) && !!(await page.evaluate(() => { const i = document.querySelector('.lmd-vw-stage img'); return i && i.naturalWidth === 300 && /^blob:/.test(i.src); })), [page.url(), await tree()]);
  check('la imagen también tiene la salida al visor del navegador', await page.evaluate(() => !!document.querySelector('.lmd-vw-bar [data-vw=native]')));
  await reader();
  await node('cuento.epub');
  const r4 = await viewing('epub');
  check('clic en un libro (EPUB): se lee en SharpMD en vez de descargarse, sin salida al visor del navegador', !!r4 && /lighthouse/.test(await page.evaluate(() => document.querySelector('.lmd-article').textContent)) && !(await page.evaluate(() => !!document.querySelector('.lmd-vw-bar [data-vw=native]'))), [page.url(), r4]);
  await reader();
  await page.click('.markdown-body a[href="otra.md"]');
  check('un enlace a otra nota sigue abriéndose en el lector, como antes', !!(await until(() => page.evaluate(() => document.querySelector('.markdown-body h1').textContent === 'Otra'), 6000)) && page.url().startsWith('file:'), page.url());
  await visit(urlOf('libro.pdf'));
  check('con el ajuste apagado, el PDF abierto directo vuelve a quedar en el visor del navegador', (await quiet(3000)) && page.url() === urlOf('libro.pdf'), page.url());

  // ---------- Archivos grandes ----------
  console.log('Archivos grandes');
  check('el PDF grande de la prueba pesa más de 20 MB', BIG.length > 20 * 1048576, Math.round(BIG.length / 1048576) + ' MB');
  await reader();
  const t0 = Date.now();
  await node('grande.pdf');
  const big = await viewing('pdf', 60000); const took = Date.now() - t0;
  const bigSize = await page.evaluate(async (u) => { const r = await LMD.bridge.readBlob(u); const f = r.blob; return f ? { size: f.size, type: f.type, head: new TextDecoder().decode(await f.slice(0, 5).arrayBuffer()) } : r; }, urlOf('grande.pdf')).catch((e) => String(e));
  check('un PDF de más de 20 MB llega entero y se abre', !!big && big.n >= 3 && bigSize.size === BIG.length && bigSize.head === '%PDF-' && bigSize.type === 'application/pdf' && took < 45000, [big, bigSize, took + ' ms']);
  console.log('   (' + Math.round(BIG.length / 1048576) + ' MB en ' + took + ' ms)');
  check('y su primera página se dibuja', !!(await until(() => page.evaluate(() => { const c = document.querySelector('.lmd-vw-page canvas'); return !!c && c.width > 100; }), 30000)));
  const tooBig = await bg(async (u) => new Promise((resolve) => { const ch = new BroadcastChannel('lmd-disk'); let got = false; ch.onmessage = () => { got = true; }; LMD.bridgeHost.onDisk({ type: 'disk', op: 'file', url: u, id: 'abcdefgh1234' }, { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, url: chrome.runtime.getURL('src/app.html') }, (r) => setTimeout(() => { ch.close(); resolve([r, got]); }, 300)); }), urlOf('img', 'enorme.png'));
  check('lo que pasa el tope de su tipo no se entrega: se corta al pasarlo', J(tooBig) === J([{ ok: true, opened: false, why: 'size', max: 40 }, false]), tooBig);
  await page.goto(OWN + '?f=' + encodeURIComponent('fs/' + decodeURIComponent(new URL(urlOf('img', 'enorme.png')).pathname).split('/').filter(Boolean).map(encodeURIComponent).join('/')));
  const said = await until(() => page.evaluate(() => (document.querySelector('.lmd-home').textContent.match(/"enorme\.png" is over[^.]*\./) || [''])[0]), 15000);
  check('y la app lo dice en una línea', said === '"enorme.png" is over 40 MB, the limit for that file type.', said);

  // ---------- El enlace que abre un archivo del disco, en la página de la extensión ----------
  console.log('El enlace #open= en la página de la extensión');
  await page.goto('about:blank'); await page.goto(OWN + '#open=' + encodeURIComponent(urlOf('libro.pdf')));
  await page.waitForSelector('.lmd-dlg [data-dlg=ok]');
  const asked = await page.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg').textContent, hash: location.hash }));
  check('un enlace a un PDF del disco pregunta antes de abrir, con la ruta a la vista', asked.title === 'Open this file from your disk?' && asked.text.includes(path.join(disk, 'libro.pdf')) && asked.hash === '', asked);
  await page.click('.lmd-dlg [data-dlg=ok]');
  const o1 = await viewing('pdf');
  check('y al aceptar se ve en el visor', !!o1 && o1.n === 5, [page.url(), o1]);
  await page.goto('about:blank'); await page.goto(OWN + '#open=' + encodeURIComponent(urlOf('datos.bin')));
  await page.waitForSelector('.lmd-dlg [data-dlg=ok]');
  check('un enlace a otro tipo de archivo se sigue rechazando', (await page.evaluate(() => document.querySelector('.lmd-dlg h3').textContent)) === 'This link cannot be opened');

  // ---------- Quién puede pedir qué ----------
  console.log('Quién puede pedir');
  const app = { id: id, tab: { id: 1 }, frameId: 0, url: OWN };
  const askDisk = (msg, sender) => bg(([m, s]) => new Promise((resolve) => { const r = LMD.bridgeHost.onDisk(m, s, resolve); if (r === false) { /* ya contestó */ } }), [msg, sender]);
  const refused = [
    await askDisk({ op: 'file', url: urlOf('libro.pdf'), id: 'abcdefgh1234' }, { id, tab: { id: 1 }, frameId: 0, url: 'https://sharpmd.app/src/app.html' }),
    await askDisk({ op: 'file', url: urlOf('libro.pdf'), id: 'abcdefgh1234' }, { id, tab: { id: 1 }, frameId: 0, url: urlOf('nota.md') }),
    await askDisk({ op: 'file', url: urlOf('libro.pdf'), id: 'abcdefgh1234' }, { id, tab: { id: 1 }, frameId: 2, url: OWN }),
    await askDisk({ op: 'list', url: pathToFileURL(disk).href + '/' }, { id: 'otraextension', tab: { id: 1 }, frameId: 0, url: OWN }),
  ];
  check('leer y listar el disco: solo la página de la app de esta extensión, en su marco principal', refused.every((r) => J(r) === J({ ok: false, error: 'refused' })), refused);
  const shapes = [
    await askDisk({ op: 'file', url: urlOf('nota.md'), id: 'abcdefgh1234' }, app), await askDisk({ op: 'file', url: urlOf('datos.bin'), id: 'abcdefgh1234' }, app),
    await askDisk({ op: 'file', url: urlOf('libro.pdf').replace('/libro.pdf', '/img/../libro.pdf'), id: 'abcdefgh1234' }, app), await askDisk({ op: 'file', url: 'file://servidor/compartido/libro.pdf', id: 'abcdefgh1234' }, app),
    await askDisk({ op: 'file', url: WEB_PDF, id: 'abcdefgh1234' }, app), await askDisk({ op: 'file', url: urlOf('libro.pdf'), id: '../x' }, app), await askDisk({ op: 'file', url: urlOf('libro.pdf') + '?x=1', id: 'abcdefgh1234' }, app),
    await askDisk({ op: 'list', url: pathToFileURL(disk).href }, app), await askDisk({ op: 'list', url: pathToFileURL(disk).href + '/../' }, app), await askDisk({ op: 'list', url: 'http://127.0.0.1/' }, app), await askDisk({ op: 'otro' }, app),
  ];
  check('solo PDF, libros e imágenes del disco, sin "..", sin servidor, sin consulta; y solo carpetas bien escritas', shapes.every((r) => J(r) === J({ ok: false, error: 'shape' })), shapes);
  const gone = await askDisk({ op: 'file', url: urlOf('no-existe.pdf'), id: 'abcdefgh1234' }, app);
  const rows = await askDisk({ op: 'list', url: pathToFileURL(disk).href + '/' }, app);
  check('un archivo que no está se dice, y el listado trae carpetas, notas y lo que el visor muestra, nada más', J(gone) === J({ ok: true, opened: false, why: 'missing' }) && rows.ok && rows.listed && J(rows.rows.map((r) => r.name + (r.dir ? '/' : '')).sort()) === J(['cuento.epub', 'grande.pdf', 'img/', 'libro.pdf', 'nota.md', 'otra.md', 'sub dir/']), [gone, rows]);
  const askView = (msg, sender) => bg(([m, s]) => new Promise((resolve) => { LMD.bridgeHost.onView(m, s, resolve); }), [msg, sender]);
  const views = [
    await askView({ url: urlOf('libro.pdf') }, app), await askView({ url: urlOf('libro.pdf') }, { id, tab: { id: 1 }, frameId: 0, url: 'https://example.com/nota.md' }),
    await askView({ url: urlOf('nota.md') }, { id, tab: { id: 1 }, frameId: 0, url: urlOf('nota.md') }), await askView({ url: WEB_PDF }, { id, tab: { id: 1 }, frameId: 0, url: urlOf('nota.md') }),
    await askView({}, { id, tab: { id: 1 }, frameId: 0, url: urlOf('libro.pdf') }), await askView({}, { id, tab: { id: 1 }, frameId: 0, url: urlOf('img', 'foto.png') }),
  ];
  check('llevar una pestaña al visor: solo desde un archivo del disco, solo a lo que el visor muestra, y el PDF abierto directo solo con el ajuste prendido',
    J(views.map((r) => r.error)) === J(['refused', 'refused', 'shape', 'shape', 'off', 'shape']), views);

  check('sin errores de página', errors.length === 0, errors);
} catch (e) {
  check('la prueba corrió sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
} finally {
  await ctx.close(); site.close();
  for (const d of [profile, disk]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ } }
}
process.exit(done() ? 1 : 0);
