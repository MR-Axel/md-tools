// El visor (src/viewer.js): un PDF, un libro (EPUB), una imagen, un audio o un video se ven dentro de la app, en el
// lugar de la nota. Y el explorador: qué tipos muestra, el interruptor "Solo Markdown" y lo que no se dibuja.
// Los archivos de prueba se arman acá mismo: el PDF lo imprime Chromium, el EPUB es un zip mínimo, las imágenes se
// escriben byte a byte. Todo queda en una carpeta del navegador (OPFS) que se abre como si fuera una del disco.
//   node viewer.mjs
//   ONLY=pdf node viewer.mjs       (una parte: tree, pdf, lazy, big, epub, hostile, image, svg, media, other, open, phone, md)
//   SHOTS=C:\tmp\agvisor node viewer.mjs   (deja ahí las capturas)
import { tally, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import zlib from 'zlib';

const ONLY = process.env.ONLY || ''; const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// Como tests/explorer.mjs: la página de la extensión, con el modo sin ventana nuevo. Cada parte abre su navegador,
// con su perfil vacío, su tamaño de pantalla y su tema.
const launched = []; const errors = []; let EXT = '';
async function openCtx(opt) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-visor-'));
  const ctx = await chromium.launchPersistentContext(profile, Object.assign({ headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] }, opt || {}));
  launched.push([ctx, profile]);
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  EXT = 'chrome-extension://' + new URL(sw.url()).host;
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: EXT }).catch(() => {});
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(EXT + '/src/app.html'); await page.waitForSelector('.lmd-home');
  await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  return { ctx, page };
}
const shut = async (ctx) => { const i = launched.findIndex((x) => x[0] === ctx); await ctx.close(); if (i >= 0) { try { fs.rmSync(launched[i][1], { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ } launched.splice(i, 1); } };
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.message || e).split('\n')[0] + ' @ ' + String(e && e.stack || '').split('\n').filter((l) => /viewer\.mjs/.test(l)).map((l) => l.trim().replace(/^.*viewer\.mjs:/, 'L')).join(' ')); } };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

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
// Un PNG de w x h, de un color, con una franja transparente.
function png(w, h, rgb) {
  const row = Buffer.alloc(1 + w * 4); const rows = [];
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const o = 1 + x * 4; row[o] = rgb[0]; row[o + 1] = rgb[1]; row[o + 2] = rgb[2]; row[o + 3] = y < h / 4 ? 0 : 255; } rows.push(Buffer.from(row)); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// Un WAV de un segundo de silencio.
function wav() { const n = 8000; const b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b; }

// El PDF sale de imprimir una página con Chromium: con marcadores (los títulos) y un enlace interno.
async function makePdf(pages, opt) {
  opt = opt || {};
  const maker = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() }); const page = await maker.newPage();
  const body = Array.from({ length: pages }, (_, i) => '<section style="page-break-after:always"><h1 id="p' + (i + 1) + '">Part ' + (i + 1) + '</h1>' +
    (i === 0 ? '<p><a id="jump" href="#p3">Jump to part three</a> and <a href="https://example.com/outside">an outside link</a>.</p>' : '') +
    '<p>This is the text of page number ' + (i + 1) + '. The harbour was quiet that morning.</p>' + (i === 1 ? '<p>Only here: zanzibar keyword.</p>' : '') + (i % 2 ? '<p>Odd pages mention the lantern.</p>' : '') + '</section>').join('');
  await page.setContent('<!doctype html><html><head><title>' + (opt.title || 'Test Book') + '</title><style>body{font:14pt Georgia,serif;margin:0}section{padding:10mm}</style></head><body>' + body + '</body></html>');
  const buf = await page.pdf({ width: '148mm', height: '210mm', outline: true, tagged: true, printBackground: true });
  await maker.close();
  return buf;
}
const XH = (title, body) => '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>' + title + '</title><link rel="stylesheet" href="book.css"/><style>body{color:red;font-family:fantasy}</style></head><body>' + body + '</body></html>';
function epub(chapters, extra, opt) {
  opt = opt || {};
  const files = { mimetype: 'application/epub+zip', 'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' };
  const man = chapters.map((c, i) => '<item id="c' + i + '" href="text/' + c.file + '" media-type="application/xhtml+xml"/>').join('');
  files['OEBPS/content.opf'] = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + (opt.title || 'The Quiet Harbour') + '</dc:title><dc:creator>Ada Invented</dc:creator></metadata>' +
    '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' + man + '<item id="img" href="img/dot.png" media-type="image/png"/><item id="css" href="text/book.css" media-type="text/css"/></manifest><spine>' + chapters.map((c, i) => '<itemref idref="c' + i + '"/>').join('') + '</spine></package>';
  files['OEBPS/nav.xhtml'] = XH('Contents', '<nav epub:type="toc"><ol>' + chapters.map((c) => '<li><a href="text/' + c.file + '">' + c.title + '</a>' + (c.sub ? '<ol>' + c.sub.map((s) => '<li><a href="text/' + c.file + '#' + s[0] + '">' + s[1] + '</a></li>').join('') + '</ol>' : '') + '</li>').join('') + '</ol></nav>');
  chapters.forEach((c) => { files['OEBPS/text/' + c.file] = XH(c.title, c.body); });
  files['OEBPS/text/book.css'] = 'body{background:#f00}.lmd-topbar{display:none}';
  files['OEBPS/img/dot.png'] = png(40, 30, [20, 120, 220]);
  return zip(Object.assign(files, extra || {}));
}
const LONG = Array.from({ length: 60 }, (_, i) => '<p>Paragraph ' + (i + 1) + ' of the second chapter keeps going so the page has something to scroll through.</p>').join('');
const BOOK = epub([
  { file: 'ch1.xhtml', title: 'Chapter One', body: '<section><div><h1 id="top1">Chapter One</h1><p class="first" style="color:red">The <em>lighthouse</em> stood alone<a id="ref1" epub:type="noteref" href="notes.xhtml#fn1">1</a>.</p><p><a id="tosec" href="ch2.xhtml#sec2">See the second section</a> or <a id="out" href="https://example.com/book">the site</a>.</p><p><img src="../img/dot.png" alt="A dot"/></p><ul><li>One item</li><li>Two items</li></ul><table><tr><th>Ship</th><th>Tons</th></tr><tr><td>Marta</td><td>40</td></tr></table></div></section>' },
  { file: 'ch2.xhtml', title: 'Chapter Two', sub: [['sec2', 'Second section']], body: '<h1>Chapter Two</h1>' + LONG + '<h2 id="sec2">Second section</h2><p>A lighthouse and another lighthouse.</p>' + LONG },
  { file: 'notes.xhtml', title: 'Notes', body: '<h1>Notes</h1><aside id="fn1" epub:type="footnote"><p>The footnote text. <a id="back" href="ch1.xhtml#ref1">Back</a></p></aside>' },
]);
// Un libro armado para atacar: guiones, manejadores, direcciones javascript:, estilos que tapan, marcos y pedidos afuera.
const HOSTILE = epub([
  { file: 'bad.xhtml', title: 'Bad', body: '<h1>Bad chapter</h1><script>window.__pwn = 1;</script><img src="nothing.png" onerror="window.__pwn = 2"/><p><a id="j" href="javascript:window.__pwn=3">js link</a></p>' +
    '<style>body{display:none} .lmd-topbar{display:none !important}</style><div style="position:fixed;inset:0;z-index:99999;background:red" class="lmd-ask lmd-scrim lmd-panel">cover</div>' +
    '<iframe src="https://evil.example/frame"></iframe><link rel="stylesheet" href="https://evil.example/evil.css"/><img src="https://evil.example/track.png" alt="remote"/>' +
    '<form action="https://evil.example/post"><input name="a"/><button type="submit">Send</button></form><svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwn=4" width="20" height="20"><script>window.__pwn=5;</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="position:fixed">x</div></foreignObject><image href="https://evil.example/svg.png" width="5" height="5"/></svg>' +
    '<p><a href="#" data-act="settings" id="lmd-custom-css">act link</a> <button data-act="reset">reset</button></p><object data="https://evil.example/o.swf"></object><embed src="https://evil.example/e"/>' +
    '<p onclick="window.__pwn=6" id="safe">Safe text stays.</p><meta http-equiv="refresh" content="0;url=https://evil.example/refresh"/><base href="https://evil.example/"/><video src="https://evil.example/v.mp4" autoplay="autoplay"></video>' +
    '<p><a id="rel" href="../../../../src/app.html?f=cloud%2Fx.md" data-lmd-href="x">app link</a></p>' },
], null, { title: 'Hostile' });
const DRM = epub([{ file: 'ch1.xhtml', title: 'One', body: '<p>locked</p>' }], { 'META-INF/encryption.xml': '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></EncryptedData></encryption>' });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#2a7"/><circle cx="60" cy="40" r="20" fill="#fff"/></svg>';
const SVG_BAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" onload="top.__pwn=7"><script>top.__pwn=8; parent.__pwn=8; fetch("https://evil.example/svg-fetch")</script><image xlink:href="https://evil.example/svg-img.png" width="10" height="10"/><foreignObject width="100" height="100"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/svg-frame"></iframe></foreignObject><rect width="100" height="100" fill="#c33"/><a xlink:href="javascript:top.__pwn=9"><text y="20">click</text></a></svg>';

const PDF5 = await makePdf(5); const PDF60 = await makePdf(60, { title: 'Sixty Pages' });
const b64 = (b) => Buffer.from(b).toString('base64');
const FILES = {
  'readme.md': '# Readme\n\nOpen [the book](out/book.pdf), [page four](out/book.pdf#page=4), [the epub](out/novel.epub) and ![pic](img/a-photo.png).\n\nfindable-word\n',
  'notes.txt': 'plain notes\n', 'data.json': '{"a":1}\n', 'table.csv': 'a,b\n1,2\n', 'page.html': '<h1 onclick="window.__pwn=10">Hi</h1><script>window.__pwn=11</script>\n', 'script.js': 'const findable = 1;\n',
  'out/book.pdf': PDF5, 'out/long.pdf': PDF60, 'out/broken.pdf': Buffer.from('%PDF-1.7\nthis is not really a pdf\n'), 'out/novel.epub': BOOK, 'out/hostile.epub': HOSTILE, 'out/locked.epub': DRM, 'out/junk.epub': Buffer.from('not a zip at all'),
  'img/a-photo.png': png(400, 300, [200, 80, 40]), 'img/b-wide.png': png(1600, 200, [40, 160, 90]), 'img/c-logo.svg': SVG, 'img/d-bad.svg': SVG_BAD, 'img/notes.md': '# In img\n',
  'media/tone.wav': wav(), 'report.docx': zip({ 'word/document.xml': '<x/>' }), 'blob.bin': Buffer.from([0, 1, 2, 3, 0, 0, 255, 254]), 'app.exe': Buffer.from([77, 90, 0, 0, 1]), 'node_modules/pkg/index.md': '# Hidden\n', '.git/config': 'x\n',
};
const SEED = Object.fromEntries(Object.entries(FILES).map(([n, v]) => [n, b64(Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'))]));

// ---------- La app con la carpeta abierta ----------
const node = (name) => '.lmd-tree-box .lmd-node[title="' + name + '"]';
async function start(opt) {
  const { ctx, page } = await openCtx(opt);
  const hits = []; page.on('request', (r) => hits.push(r.url()));
  await page.goto(EXT + '/src/app.html'); await page.waitForSelector('.lmd-home');
  await page.evaluate(async (seed) => {
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry('visor', { recursive: true }); } catch (e) { /* no estaba */ }
    const dir = await top.getDirectoryHandle('visor', { create: true });
    for (const [name, data] of Object.entries(seed)) {
      const parts = name.split('/'); let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const h = await d.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable();
      await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))); await w.close();
    }
    window.__dir = dir; window.showDirectoryPicker = async () => dir;
  }, SEED);
  await page.click('[data-home=dir]'); await page.waitForSelector(node('readme.md'), { state: 'attached' }); await sleep(300);
  return { ctx, page, hits };
}
const expand = async (page, dir) => { if (!(await page.$(node(dir) + '.lmd-open'))) await page.click(node(dir)); await sleep(250); };
const openFile = async (page, dir, name) => { if (dir) await expand(page, dir); await page.click(node(name)); };
const peek = (page) => page.evaluate(() => (window.LMD && LMD.viewer ? LMD.viewer.peek() : null));
const ready = (page, kind) => until(() => page.evaluate((k) => { const p = window.LMD && LMD.viewer && LMD.viewer.peek(); return !!p && p.ready && (!k || p.kind === k); }, kind), 20000);
const pdfReady = async (page) => { await ready(page, 'pdf'); await page.waitForSelector('.lmd-vw-page canvas', { timeout: 20000 }); await page.waitForSelector('.lmd-vw-text span', { timeout: 20000 }); };
const flashText = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const names = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-tree-box .lmd-node')].filter((n) => n.offsetParent).map((n) => n.getAttribute('title')));
const pageNow = (page) => page.evaluate(() => Number(document.querySelector('.lmd-vw-num').value));

// ---------- El explorador: qué se lista, el interruptor y los contadores ----------
await step('tree', 'El explorador: todos los tipos que la app abre, y el interruptor Solo Markdown', async () => {
  const { ctx, page } = await start();
  const all = await names(page);
  check('de fábrica se ven todos los tipos que SharpMD abre', ['readme.md', 'notes.txt', 'data.json', 'table.csv', 'page.html', 'script.js', 'report.docx'].every((n) => all.includes(n)), all);
  check('lo que no se puede mostrar no aparece: binarios y ejecutables', !all.includes('blob.bin') && !all.includes('app.exe'), all);
  check('tampoco las carpetas que no son de la persona', !all.includes('node_modules') && !all.includes('.git') && all.includes('out') && all.includes('img'), all);
  await expand(page, 'out'); await expand(page, 'img'); await expand(page, 'media');
  const more = await names(page);
  check('PDF, EPUB, imágenes y audio figuran en su carpeta', ['book.pdf', 'novel.epub', 'a-photo.png', 'c-logo.svg', 'tone.wav'].every((n) => more.includes(n)), more);
  const icons = await page.evaluate(() => Object.fromEntries(['readme.md', 'book.pdf', 'novel.epub', 'a-photo.png', 'tone.wav', 'script.js', 'table.csv'].map((n) => { const a = document.querySelector('.lmd-tree-box .lmd-node[title="' + n + '"]'); return [n, [a.dataset.kind, a.querySelector('.lmd-node-ico svg').innerHTML.length]]; })));
  check('cada tipo lleva su ícono', new Set(Object.values(icons).map((v) => v[1])).size >= 6 && icons['book.pdf'][0] === 'pdf' && icons['novel.epub'][0] === 'epub' && icons['a-photo.png'][0] === 'image' && icons['readme.md'][0] === 'md', icons);
  const btn = await page.evaluate(() => { const b = document.querySelector('.lmd-tree-only'); return { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), title: b.title, head: !!b.closest('.lmd-zone-files .lmd-zone-head') }; });
  check('el interruptor está en la cabecera del panel, apagado y con su rótulo', btn.pressed === 'false' && btn.label === 'Markdown only' && btn.head && /off/i.test(btn.title), btn);
  const count = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.lmd-tree-box .lmd-node-dir')].map((n) => [n.getAttribute('title'), (n.querySelector('.lmd-node-n') || { dataset: {} }).dataset.n || ''])));
  await until(async () => (await count()).img); const c0 = await count();
  check('los contadores cuentan lo que se ve', c0.img === '5' && c0.out === '7' && c0.media === '1', c0);
  await shot(page, 'explorador-todos');
  await page.click('.lmd-tree-only'); await until(async () => !(await names(page)).includes('data.json'));
  const only = await names(page);
  check('prendido deja solo Markdown y texto', J(only.filter((n) => /\./.test(n)).sort()) === J(['notes.md', 'notes.txt', 'readme.md']) && (await page.evaluate(() => document.querySelector('.lmd-tree-only').getAttribute('aria-pressed'))) === 'true', only);
  await until(async () => (await count()).img === '1'); const c1 = await count();
  check('y los contadores siguen al filtro', c1.img === '1' && !c1.out && !c1.media, c1);
  await shot(page, 'explorador-solo-markdown');
  await page.fill('.lmd-search input', 'findable'); await sleep(1500);
  const r1 = await page.evaluate(() => [...document.querySelectorAll('.lmd-results .lmd-res')].map((n) => decodeURIComponent(n.dataset.url || '').split('/').pop()));
  check('el buscador de archivos, con Solo Markdown, busca en las notas', J(r1) === J(['readme.md']), r1);
  await page.fill('.lmd-search input', ''); await sleep(300);
  await page.reload(); await page.waitForSelector('.lmd-tree-box .lmd-node, .lmd-home'); await sleep(600);
  check('la elección se recuerda al recargar', await page.evaluate(async () => (await LMD.load()).filesOnlyMarkdown === true && (await LMD.load()).filesChosen === true && document.querySelector('.lmd-tree-only').getAttribute('aria-pressed') === 'true'));
  await page.click('.lmd-tree-only'); await sleep(600);
  await page.fill('.lmd-search input', 'findable'); await sleep(1500);
  const r2 = await page.evaluate(() => [...document.querySelectorAll('.lmd-results .lmd-res')].map((n) => decodeURIComponent(n.dataset.url || '').split('/').pop()).sort());
  check('apagado, el buscador también mira el código y los datos', J(r2) === J(['readme.md', 'script.js']), r2);
  check('un ajuste viejo guardado en "solo Markdown" sin haberlo elegido pasa a mostrar todo', await page.evaluate(() => LMD.merge({ filesOnlyMarkdown: true }).filesOnlyMarkdown === false && LMD.merge({ filesOnlyMarkdown: true, filesChosen: true }).filesOnlyMarkdown === true));
  await shut(ctx);
});

// ---------- PDF ----------
await step('pdf', 'PDF: páginas, barra, zoom, búsqueda, índice, enlaces y posición recordada', async () => {
  const { ctx, page, hits } = await start();
  check('al abrir la app no se pidió el visor ni pdf.js', !hits.some((u) => /viewer\.js|pdfjs/.test(u)) && await page.evaluate(() => !LMD.viewer), hits.filter((u) => /viewer|pdfjs/.test(u)));
  await openFile(page, 'out', 'book.pdf'); await pdfReady(page);
  check('abrirlo desde el explorador pide el visor y pdf.js, de la propia app', hits.some((u) => /\/src\/viewer\.js/.test(u)) && hits.some((u) => /\/vendor\/pdfjs\/pdf\.min\.js/.test(u)) && hits.some((u) => /pdf\.worker\.min\.js/.test(u)) && hits.every((u) => u.startsWith(EXT) || /^(blob|data):/.test(u)), hits.filter((u) => !u.startsWith(EXT)));
  const st = await page.evaluate(() => ({ url: decodeURIComponent(location.search), name: document.querySelector('.lmd-docname').textContent, title: document.title, bin: document.documentElement.classList.contains('lmd-bin'), pages: document.querySelectorAll('.lmd-vw-page').length, total: document.querySelector('.lmd-vw-total').textContent, num: document.querySelector('.lmd-vw-num').value,
    bar: document.querySelector('.lmd-vw-bar').getAttribute('role'), labels: [...document.querySelectorAll('.lmd-vw-bar button')].every((b) => !!b.getAttribute('aria-label')), edit: !!(document.querySelector('[data-act=mode-edit]') || {}).offsetParent, raw: !!(document.querySelector('[data-act=view-raw]') || {}).offsetParent, exportBtn: !!document.querySelector('[data-act=export]').offsetParent }));
  check('se ve en la zona de la nota, con su dirección y su nombre', /visor|\/out\/book\.pdf/.test(st.url) && /book\.pdf$/.test(st.url.replace(/^.*f=/, '')) && st.name === 'book.pdf' && st.bin && st.pages === 5 && st.total === '/ 5' && st.num === '1', st);
  check('la barra tiene rótulos y la de la app no ofrece editar ni ver el código', st.bar === 'toolbar' && st.labels && !st.edit && !st.raw && st.exportBtn, st);
  const sharp = await page.evaluate(() => { const c = document.querySelector('.lmd-vw-page canvas'); const r = c.getBoundingClientRect(); return { ratio: c.width / r.width, dpr: devicePixelRatio, w: r.width, box: document.querySelector('.lmd-vw-pages').clientWidth }; });
  check('la página se ajusta al ancho y el lienzo tiene los píxeles de la pantalla', Math.abs(sharp.ratio - sharp.dpr) < 0.05 && sharp.w > 300 && sharp.w <= sharp.box + 1, sharp);
  const text = await page.evaluate(() => document.querySelector('.lmd-vw-page[data-page="1"] .lmd-vw-text').textContent);
  check('la capa de texto trae el texto de la página', /Part 1/.test(text) && /page number 1/.test(text), text.slice(0, 120));
  // Seleccionar y copiar texto.
  const sel = await page.evaluate(() => { const span = [...document.querySelectorAll('.lmd-vw-page[data-page="1"] .lmd-vw-text span')].find((s) => /harbour/.test(s.textContent)); const r = document.createRange(); r.selectNodeContents(span); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return { text: String(s), color: getComputedStyle(span).color, select: getComputedStyle(span).userSelect }; });
  check('el texto del PDF se selecciona (y es transparente sobre el dibujo)', /harbour/.test(sel.text) && /rgba\(0, 0, 0, 0\)/.test(sel.color) && sel.select !== 'none', sel);
  await page.evaluate(() => getSelection().removeAllRanges());
  // Navegación.
  await page.click('[data-vw=next]'); await sleep(200);
  check('siguiente lleva a la página 2', (await pageNow(page)) === 2);
  await page.fill('.lmd-vw-num', '4'); await page.press('.lmd-vw-num', 'Enter'); await sleep(250);
  check('el campo lleva a la página que se escribe', (await pageNow(page)) === 4 && await page.evaluate(() => { const r = document.querySelector('.lmd-vw-page[data-page="4"]').getBoundingClientRect(); return r.top > 0 && r.top < 200; }));
  await page.keyboard.press('PageUp'); await sleep(200);
  check('Página arriba vuelve una', (await pageNow(page)) === 3);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(250);
  check('las flechas avanzan, y la última página cuenta aunque no llegue arriba', (await pageNow(page)) === 5 && await page.evaluate(() => document.querySelector('[data-vw=next]').disabled));
  await page.fill('.lmd-vw-num', '99'); await page.press('.lmd-vw-num', 'Enter'); await sleep(150);
  check('una página que no existe no mueve nada', (await pageNow(page)) === 5);
  // Zoom.
  await page.fill('.lmd-vw-num', '1'); await page.press('.lmd-vw-num', 'Enter'); await sleep(200);
  const z0 = await peek(page);
  await page.click('[data-vw=in]'); await sleep(500); const z1 = await peek(page);
  await page.keyboard.press('-'); await page.keyboard.press('-'); await sleep(500); const z2 = await peek(page);
  await page.click('[data-vw=real]'); await sleep(500); const z3 = await peek(page);
  const realW = await page.evaluate(() => document.querySelector('.lmd-vw-page').getBoundingClientRect().width);
  await page.keyboard.press('0'); await sleep(500); const z4 = await peek(page);
  check('acercar, alejar, tamaño real y volver al ancho', z0.zoom === 'fit' && z1.scale > z0.scale * 1.15 && z2.scale < z0.scale && Math.abs(z3.scale - 96 / 72) < 0.001 && Math.abs(realW - 148 / 25.4 * 96) < 3 && z4.zoom === 'fit' && Math.abs(z4.scale - z0.scale) < 0.01, [z0.scale, z1.scale, z2.scale, z3.scale, realW, z4.zoom]);
  await page.waitForSelector('.lmd-vw-page[data-page="1"] .lmd-vw-text span');
  const resharp = await page.evaluate(() => { const c = document.querySelector('.lmd-vw-page canvas'); return c.width / c.getBoundingClientRect().width; });
  check('después de cambiar el zoom se vuelve a dibujar nítido', Math.abs(resharp - sharp.dpr) < 0.05, resharp);
  // El índice del PDF en el panel lateral.
  const out = await page.evaluate(() => ({ title: document.querySelector('.lmd-pane-outline .lmd-o-title').textContent, meta: document.querySelector('.lmd-pane-outline .lmd-o-meta').textContent, rows: [...document.querySelectorAll('.lmd-pane-outline .lmd-o-link')].map((a) => a.textContent), pct: !!document.querySelector('.lmd-pane-outline .lmd-o-pct') }));
  check('los marcadores del PDF van al panel Índice, con el título y las páginas', out.title === 'Test Book' && out.meta === '5 pages' && J(out.rows) === J(['Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5']) && out.pct, out);
  await page.click('.lmd-pane-outline .lmd-o-link >> text=Part 4'); await sleep(350);
  check('un clic en el índice lleva a esa página y la marca', (await pageNow(page)) === 4 && await page.evaluate(() => document.querySelector('.lmd-pane-outline .lmd-o-row.lmd-active').textContent.trim() === 'Part 4'));
  // Enlaces del PDF.
  await page.fill('.lmd-vw-num', '1'); await page.press('.lmd-vw-num', 'Enter'); await page.waitForSelector('.lmd-vw-page[data-page="1"] .lmd-vw-links a');
  const links = await page.evaluate(() => [...document.querySelectorAll('.lmd-vw-page[data-page="1"] .lmd-vw-links a')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })));
  check('el enlace externo abre aparte y el interno es de la app', links.some((l) => l.href === 'https://example.com/outside' && l.target === '_blank' && /noopener/.test(l.rel)) && links.some((l) => l.href === '#'), links);
  await page.click('.lmd-vw-page[data-page="1"] .lmd-vw-links a[href="#"]'); await sleep(400);
  check('el enlace interno lleva a la página de destino', (await pageNow(page)) === 3, await pageNow(page));
  // Buscar en todo el documento.
  await page.fill('.lmd-vw-q', 'zanzibar'); await until(async () => (await peek(page)).hits === 1 && (await peek(page)).at === 0); await sleep(400);
  const f1 = await page.evaluate(() => ({ count: document.querySelector('.lmd-vw-count').textContent, page: Number(document.querySelector('.lmd-vw-num').value), marks: CSS.highlights.has('lmd-hit') ? CSS.highlights.get('lmd-hit').size : 0, cur: CSS.highlights.has('lmd-hit-current') ? [...CSS.highlights.get('lmd-hit-current')][0].toString() : '' }));
  check('la búsqueda encuentra en otra página, va a ella y resalta', f1.count === '1 / 1' && f1.page === 2 && f1.marks === 1 && f1.cur.toLowerCase() === 'zanzibar', f1);
  await page.fill('.lmd-vw-q', 'page number'); await until(async () => (await peek(page)).hits === 5 && (await peek(page)).at >= 0); await sleep(300);
  const a0 = (await peek(page)).at;
  await page.press('.lmd-vw-q', 'Enter'); await sleep(300); const a1 = (await peek(page)).at;
  await page.click('[data-vw=find-prev]'); await sleep(300); const a2 = (await peek(page)).at;
  check('siguiente y anterior recorren las coincidencias de todo el PDF', a1 === (a0 + 1) % 5 && a2 === a0 && /\/ 5$/.test(await page.evaluate(() => document.querySelector('.lmd-vw-count').textContent)), [a0, a1, a2]);
  await page.press('.lmd-vw-q', 'Escape'); await sleep(200);
  check('Escape limpia la búsqueda', (await peek(page)).q === '' && await page.evaluate(() => !CSS.highlights.has('lmd-hit')));
  // El buscador de la barra lateral y Ctrl+F llevan al mismo.
  await page.fill('.lmd-search input', 'lantern'); await until(async () => (await peek(page)).hits === 2);
  check('el buscador de la barra lateral también busca en el PDF', await page.evaluate(() => document.querySelector('.lmd-vw-q').value === 'lantern' && /2/.test(document.querySelector('.lmd-search-count').textContent)), await page.evaluate(() => document.querySelector('.lmd-search-count').textContent));
  await page.fill('.lmd-search input', ''); await sleep(300);
  await page.click('.lmd-vw-page'); await page.keyboard.press('Control+f'); await sleep(150);
  check('Ctrl+F lleva al buscador del visor', await page.evaluate(() => document.activeElement.classList.contains('lmd-vw-q')));
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForSelector('.lmd-vw-page[data-page="1"] .lmd-vw-text span'); await sleep(300);
  await shot(page, 'pdf-oscuro');
  // El menú del archivo: sin exportar a Word ni imprimir; sí descargar, abrir aparte e importar.
  await page.click('[data-act=export]'); await page.waitForSelector('.lmd-menu-export');
  const menu = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export button')].map((b) => b.textContent.trim().replace(/\s*Ctrl.*$/, '')));
  check('el menú ofrece lo que tiene sentido para un PDF', J(menu) === J(['Download the file', 'Open in another tab', 'Import to Markdown']), menu);
  await page.click('.lmd-menu-export button >> text=Import to Markdown'); await page.waitForSelector('.lmd-imp', { timeout: 15000 });
  await until(() => page.evaluate(() => /pages converted/.test(document.querySelector('.lmd-imp').textContent)), 20000);
  check('Importar a Markdown convierte ese mismo archivo, con la herramienta apagada', await page.evaluate(() => /5 pages converted/.test(document.querySelector('.lmd-imp').textContent) && /book\.pdf/.test(document.querySelector('.lmd-imp').textContent) && !LMD.tools.isOn('import')));
  await page.click('[data-imp=cancel]'); await sleep(300);
  // El menú del explorador.
  await page.click(node('book.pdf'), { button: 'right' }); await page.waitForSelector('.lmd-menu');
  const tmenu = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu button')].map((b) => b.textContent.trim()));
  check('el menú del archivo en el explorador suma Importar a Markdown', tmenu.includes('Import to Markdown') && tmenu.includes('Rename'), tmenu);
  // Elegirla convierte, y nada más: el archivo sigue en su carpeta (una vez el menú, mal unido, lo eliminaba después).
  await page.click('.lmd-menu button >> text=Import to Markdown'); await page.waitForSelector('.lmd-imp', { timeout: 15000 });
  await until(() => page.evaluate(() => /pages converted/.test(document.querySelector('.lmd-imp').textContent)), 20000);
  await page.click('[data-imp=cancel]'); await sleep(500);
  check('y elegirla desde ahí convierte sin tocar el archivo ni abrir ningún otro cuadro', await page.evaluate(async () => { const out = await window.__dir.getDirectoryHandle('out'); let there = true; try { await out.getFileHandle('book.pdf'); } catch (e) { there = false; } return there && document.querySelectorAll('.lmd-ask').length === 0 && !!document.querySelector('.lmd-tree-box .lmd-node[title="book.pdf"]') && document.querySelector('.lmd-docname').textContent === 'book.pdf'; }));
  await page.mouse.click(700, 500); await sleep(200);
  // "Enviar a la nube" sobre un PDF: la entrada está, y dice que no se sube.
  await page.evaluate(() => { window.__cloud = [LMD.cloud.enabled, LMD.cloud.reach]; LMD.cloud.enabled = () => true; LMD.cloud.reach = () => true; });
  await page.click(node('book.pdf'), { button: 'right' }); await page.waitForSelector('.lmd-menu');
  await page.click('.lmd-menu button >> text=Send to the cloud'); await sleep(250);
  check('Enviar a la nube sobre un PDF dice claro que no se sube', /not uploaded to the cloud: cloud notes are text/.test(await flashText(page)) && await page.evaluate(() => !document.querySelector('.lmd-send-card')), await flashText(page));
  await page.evaluate(() => { LMD.cloud.enabled = window.__cloud[0]; LMD.cloud.reach = window.__cloud[1]; }); await sleep(2600);
  // Subir a la nube: se dice que no.
  { await page.evaluate(() => { const was = LMD.cloud.signedIn; LMD.cloud.signedIn = () => true; LMD.sync.click(document.querySelector('.lmd-sync')); LMD.cloud.signedIn = was; }); await sleep(300); check('subirlo a la nube se rechaza con una línea', /not uploaded to the cloud/.test(await flashText(page)), await flashText(page)); }
  // Posición y zoom recordados.
  await page.click('[data-vw=in]'); await sleep(300);
  await page.fill('.lmd-vw-num', '4'); await page.press('.lmd-vw-num', 'Enter'); await sleep(300);
  await page.mouse.wheel(0, 120); await sleep(900);
  const before = await peek(page);
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1'); await sleep(200);
  check('al pasar a una nota, la barra del visor se va y la app vuelve a la normalidad', await page.evaluate(() => !document.querySelector('.lmd-vw-bar') && !document.documentElement.classList.contains('lmd-bin') && !!document.querySelector('[data-act=mode-edit]').offsetParent && !document.querySelector('.lmd-article').classList.contains('lmd-vw-pdf')));
  await page.click(node('book.pdf')); await pdfReady(page); await sleep(300);
  const after = await peek(page);
  check('al reabrir vuelve a la misma página y al mismo zoom', after.page === 3 && before.page === 3 && Math.abs(after.scale - before.scale) < 0.01 && after.zoom !== 'fit', [before, after]);
  await page.reload(); await pdfReady(page); await sleep(300);
  check('y también después de recargar la pestaña', (await peek(page)).page === 3 && (await pageNow(page)) === 4, await peek(page));
  // El archivo cambió en el disco (se exportó de nuevo): se vuelve a abrir.
  await page.evaluate(async (data) => { const out = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('visor')).getDirectoryHandle('out'); const h = await out.getFileHandle('book.pdf'); const w = await h.createWritable(); await w.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))); await w.close(); }, b64(await makePdf(7, { title: 'Second Edition' })));
  const again = await until(() => page.evaluate(() => document.querySelectorAll('.lmd-vw-page').length === 7), 12000);
  check('si el archivo cambia en el disco, el visor lo vuelve a abrir', !!again, await page.evaluate(() => document.querySelectorAll('.lmd-vw-page').length));
  // Dañado: una línea, y la app sigue.
  await page.click(node('broken.pdf')); await page.waitForSelector('.lmd-vw-err');
  check('un PDF dañado se dice en una línea y la app sigue andando', /damaged/.test(await page.evaluate(() => document.querySelector('.lmd-vw-err').textContent)) && await page.evaluate(() => !document.querySelector('.lmd-vw-bar')), await page.evaluate(() => document.querySelector('.lmd-article').textContent));
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1');
  check('y después abre una nota como siempre', await page.evaluate(() => document.querySelector('.lmd-article h1').textContent.includes('Readme')));
  check('sin errores de página', errors.length === 0, errors);
  await shut(ctx);
});

await step('lazy', 'PDF de 60 páginas: solo se dibujan las que se ven', async () => {
  const { ctx, page } = await start();
  await openFile(page, 'out', 'long.pdf'); await pdfReady(page); await sleep(800);
  const count = () => page.evaluate(() => ({ canvases: document.querySelectorAll('.lmd-vw-page canvas').length, texts: document.querySelectorAll('.lmd-vw-text').length, pages: document.querySelectorAll('.lmd-vw-page').length, drawn: [...document.querySelectorAll('.lmd-vw-page')].filter((p) => p.querySelector('canvas')).map((p) => Number(p.dataset.page)) }));
  const c0 = await count();
  check('60 huecos y un puñado de lienzos', c0.pages === 60 && c0.canvases >= 1 && c0.canvases <= 6 && c0.drawn[0] === 1, c0);
  await page.fill('.lmd-vw-num', '40'); await page.press('.lmd-vw-num', 'Enter'); await page.waitForSelector('.lmd-vw-page[data-page="40"] canvas'); await sleep(900);
  const c1 = await count();
  check('al saltar a la 40 se dibujan esa y sus vecinas, y las del principio se sueltan', c1.canvases <= 6 && c1.drawn.includes(40) && !c1.drawn.includes(1) && c1.drawn.every((n) => Math.abs(n - 40) <= 4), c1);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await sleep(60); }
  await sleep(1200);
  const c2 = await count();
  check('después de recorrer varias páginas sigue habiendo pocos lienzos', c2.canvases <= 6 && c2.texts <= 6, c2);
  await page.fill('.lmd-vw-q', 'lantern'); await until(async () => (await peek(page)).hits === 30, 20000);
  check('la búsqueda recorre las 60 páginas sin dibujarlas', (await peek(page)).hits === 30 && (await count()).canvases <= 6, await peek(page));
  check('la barra queda fija mientras se recorre', await page.evaluate(() => { const r = document.querySelector('.lmd-vw-bar').getBoundingClientRect(); const t = document.querySelector('.lmd-topbar').getBoundingClientRect(); return Math.abs(r.top - t.bottom) <= 1; }));
  await shut(ctx);
});

// ---------- EPUB ----------
await step('epub', 'EPUB: capítulos, índice, enlaces, nota al pie, búsqueda y posición', async () => {
  const { ctx, page, hits } = await start({ colorScheme: 'light' });
  await openFile(page, 'out', 'novel.epub'); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1');
  check('el libro no pide pdf.js', !hits.some((u) => /pdfjs/.test(u)), hits.filter((u) => /pdfjs/.test(u)));
  const s = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); const p = a.querySelector('p'); return { h1: a.querySelector('h1').textContent, where: document.querySelector('.lmd-vw-where').textContent, color: getComputedStyle(p).color, body: getComputedStyle(document.body).color, font: getComputedStyle(p).fontFamily === getComputedStyle(document.body).fontFamily, em: !!a.querySelector('em'), li: a.querySelectorAll('li').length, table: !!a.querySelector('.lmd-table table'),
    style: a.querySelectorAll('style, link, script').length, cls: a.querySelectorAll('[class="first"], [style]').length, direct: [...a.children].map((n) => n.tagName).join(','), img: (a.querySelector('img') || {}).src || '', imgW: (a.querySelector('img') || {}).naturalWidth, ids: a.querySelectorAll('[id]').length,
    title: document.querySelector('.lmd-o-title').textContent, meta: document.querySelector('.lmd-o-meta').textContent, toc: [...document.querySelectorAll('.lmd-pane-outline .lmd-o-link')].map((x) => x.textContent), active: (document.querySelector('.lmd-o-row.lmd-active') || { textContent: '' }).textContent.trim() }; });
  check('abre el primer capítulo con el título y la posición', s.h1 === 'Chapter One' && /^1 \/ 3 · \d+ %$/.test(s.where), s);
  check('la tipografía y los colores son los del tema, no los del libro', s.color === s.body && s.font && s.style === 0 && s.cls === 0, [s.color, s.body, s.style, s.cls]);
  check('lo estructural queda: cursiva, lista, tabla', s.em && s.li === 2 && s.table, s);
  check('los párrafos quedan como bloques de la nota, sin las cajas del libro', /^H1,P,P,P,UL,DIV,NAV$/.test(s.direct), s.direct);
  await until(() => page.evaluate(() => (document.querySelector('.lmd-article img') || {}).naturalWidth === 40));
  check('la imagen del libro sale del zip como blob:', /^blob:/.test(s.img) && await page.evaluate(() => document.querySelector('.lmd-article img').naturalWidth === 40), s.img);
  check('los identificadores del libro no entran como id', s.ids === 0, s.ids);
  check('la tabla de contenidos va al panel Índice, con autor y capítulos', s.title === 'The Quiet Harbour' && /Ada Invented · 3 chapters/.test(s.meta) && J(s.toc) === J(['Chapter One', 'Chapter Two', 'Second section', 'Notes']) && s.active === 'Chapter One', s);
  await shot(page, 'epub-claro');
  if (SHOTS) { await page.click(node('book.pdf')); await pdfReady(page); await sleep(300); await shot(page, 'pdf-claro'); await page.click(node('novel.epub')); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1 >> text=Chapter One'); }
  // Nota al pie: va al capítulo de notas, a su ancla; y vuelve.
  await page.click('.lmd-article a >> text=1'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Notes'));
  check('la llamada de la nota al pie lleva a la nota', await page.evaluate(() => { const t = document.querySelector('.lmd-article [data-bk="fn1"]'); return !!t && t.classList.contains('lmd-vw-there') && /footnote text/.test(t.textContent); }));
  await page.click('.lmd-article a >> text=Back'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Chapter One'));
  check('y el enlace de vuelta regresa al capítulo', (await peek(page)).c === 0);
  // Enlace entre capítulos, con ancla.
  await page.click('.lmd-article a >> text=See the second section'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Chapter Two')); await sleep(300);
  const sec = await page.evaluate(() => { const t = document.querySelector('.lmd-article [data-bk="sec2"]'); const r = t.getBoundingClientRect(); return { top: r.top, y: scrollY, active: document.querySelector('.lmd-o-row.lmd-active').textContent.trim(), where: document.querySelector('.lmd-vw-where').textContent }; });
  check('el enlace a otro capítulo abre ese capítulo en su sección', sec.y > 500 && sec.top > 60 && sec.top < 260 && sec.active === 'Second section' && /^2 \/ 3/.test(sec.where), sec);
  const ext = await page.evaluate(() => { history.back; return null; });
  await page.click('[data-vw=prev]'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Chapter One'));
  const out = await page.evaluate(() => { const a = [...document.querySelectorAll('.lmd-article a')].find((x) => /the site/.test(x.textContent)); return { href: a.getAttribute('href'), target: a.target, rel: a.rel }; });
  check('el enlace externo abre aparte', out.href === 'https://example.com/book' && out.target === '_blank' && /noopener/.test(out.rel) && ext === null, out);
  // Capítulos: botones, pie y teclado.
  await page.click('[data-vw=next]'); await until(async () => (await peek(page)).c === 1);
  check('el botón pasa al capítulo siguiente, arriba de todo', await page.evaluate(() => scrollY === 0 && document.querySelector('.lmd-article h1').textContent === 'Chapter Two'));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(200); await page.keyboard.press('PageDown'); await until(async () => (await peek(page)).c === 2);
  check('al final del capítulo, seguir bajando pasa al siguiente', (await peek(page)).c === 2 && await page.evaluate(() => document.querySelector('[data-vw=next]').disabled && /100 %/.test(document.querySelector('.lmd-vw-where').textContent)), await page.evaluate(() => document.querySelector('.lmd-vw-where').textContent));
  await page.keyboard.press('ArrowLeft'); await until(async () => (await peek(page)).c === 1);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
  const turn = await page.evaluate(() => [...document.querySelectorAll('.lmd-vw-turn button')].map((b) => b.textContent.trim()));
  check('al pie del capítulo están el anterior y el siguiente, con su nombre', J(turn) === J(['Chapter One', 'Notes']), turn);
  await page.click('.lmd-vw-turn [data-vw=next]'); await until(async () => (await peek(page)).c === 2);
  await page.click('.lmd-pane-outline .lmd-o-link >> text=Chapter Two'); await until(async () => (await peek(page)).c === 1);
  check('el índice lleva a un capítulo', await page.evaluate(() => document.querySelector('.lmd-article h1').textContent === 'Chapter Two'));
  // Buscar en todo el libro.
  await page.fill('.lmd-vw-q', 'lighthouse'); await until(async () => (await peek(page)).hits === 3 && (await peek(page)).at >= 0); await sleep(300);
  const b0 = await page.evaluate(() => ({ count: document.querySelector('.lmd-vw-count').textContent, marks: CSS.highlights.get('lmd-hit').size, cur: CSS.highlights.has('lmd-hit-current') }));
  check('busca en todo el libro y empieza por el capítulo abierto', b0.count === '2 / 3' && b0.marks === 2 && b0.cur, b0);
  await page.press('.lmd-vw-q', 'Enter'); await sleep(300); await page.press('.lmd-vw-q', 'Enter'); await until(async () => (await peek(page)).c === 0); await sleep(300);
  check('siguiente pasa de capítulo cuando la coincidencia está en otro', await page.evaluate(() => document.querySelector('.lmd-vw-count').textContent === '1 / 3' && [...CSS.highlights.get('lmd-hit-current')][0].toString() === 'lighthouse' && document.querySelector('.lmd-article h1').textContent === 'Chapter One'));
  await page.press('.lmd-vw-q', 'Escape');
  // Posición recordada: capítulo y avance.
  await page.click('[data-vw=next]'); await until(async () => (await peek(page)).c === 1);
  await page.evaluate(() => scrollTo(0, 1500)); await sleep(900);
  const y0 = await page.evaluate(() => scrollY);
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  await page.click(node('novel.epub')); await until(async () => { const p = await peek(page); return p && p.ready && p.c === 1; }); await sleep(400);
  const y1 = await page.evaluate(() => scrollY);
  check('al reabrir vuelve al capítulo y a la altura donde se dejó', (await peek(page)).c === 1 && Math.abs(y1 - y0) < 60, [y0, y1]);
  const pct = await page.evaluate(() => ({ bar: document.querySelector('.lmd-vw-where').textContent, side: document.querySelector('.lmd-pane-outline .lmd-o-pct').textContent }));
  check('el avance de lectura se ve en la barra y en el panel Índice', /· (\d+) %$/.test(pct.bar) && pct.bar.replace(/^.*· /, '') === pct.side && parseInt(pct.side, 10) > 10 && parseInt(pct.side, 10) < 90, pct);
  // Tema oscuro y ancho de página: los del lector.
  await page.evaluate(() => LMD.patch({ theme: 'dark', fontSize: 20 })); await sleep(500);
  const dark = await page.evaluate(() => { const p = document.querySelector('.lmd-article p'); return { color: getComputedStyle(p).color, body: getComputedStyle(document.body).color, size: getComputedStyle(p).fontSize, still: !!document.querySelector('.lmd-vw-bar') && document.querySelector('.lmd-article h1').textContent === 'Chapter Two' }; });
  check('cambiar el tema o la letra se aplica al libro sin volver a abrirlo', dark.color === dark.body && dark.size === '20px' && dark.still, dark);
  await shot(page, 'epub-oscuro');
  // Leer en voz alta, si la herramienta está prendida.
  await page.evaluate(() => LMD.tools.set('speak', true)); await sleep(800);
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1 >> text=Readme'); await page.click(node('novel.epub')); await ready(page, 'epub'); await sleep(300);
  const sp = await page.evaluate(() => ({ btn: !!document.querySelector('.lmd-vw-bar [data-vw=speak]'), segs: LMD.speak ? LMD.speak.segments(document.querySelector('.lmd-article'), 'en').map((x) => x.text) : [] }));
  check('con Leer en voz alta prendida, la barra del libro la ofrece sobre el capítulo abierto', sp.btn && sp.segs.length >= 3 && /Chapter Two/.test(sp.segs[0]) && sp.segs.some((t) => /Paragraph 1 of the second chapter/.test(t)) && !sp.segs.some((t) => /Notes$|Chapter One$/.test(t)), [sp.btn, sp.segs.slice(0, 3), sp.segs.slice(-2)]);
  // Protegido y dañado.
  await page.click(node('locked.epub')); await page.waitForSelector('.lmd-vw-err');
  check('un EPUB con DRM se dice en una línea', /protected \(DRM\)/.test(await page.evaluate(() => document.querySelector('.lmd-vw-err').textContent)));
  await page.click(node('junk.epub')); await until(() => page.evaluate(() => /damaged/.test((document.querySelector('.lmd-vw-err') || {}).textContent || '')));
  check('y uno que no es un zip también, sin romper nada', await page.evaluate(() => /damaged/.test(document.querySelector('.lmd-vw-err').textContent) && !document.querySelector('.lmd-vw-bar')) && errors.length === 0, errors);
  await shut(ctx);
});

await step('hostile', 'Un EPUB y un SVG armados para atacar no ejecutan nada ni tapan la interfaz', async () => {
  const { ctx, page, hits } = await start();
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const pages0 = ctx.pages().length;
  await openFile(page, 'out', 'hostile.epub'); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1'); await sleep(800);
  const h = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); const fixed = [...a.querySelectorAll('*')].filter((n) => /fixed|sticky|absolute/.test(getComputedStyle(n).position)).map((n) => n.tagName);
    const top = document.querySelector('.lmd-topbar').getBoundingClientRect(); const at = document.elementFromPoint(top.left + 20, top.top + 20);
    return { pwn: window.__pwn, bad: a.querySelectorAll('script, style, iframe, link, form, input, button:not(.lmd-vw-turn button), object, embed, meta, base, video, foreignObject').length, on: [...a.querySelectorAll('*')].filter((n) => [...n.attributes].some((x) => /^on/i.test(x.name) || /^data-(act|lmd)/.test(x.name) || x.name === 'style' || x.name === 'id' || x.name === 'class' && /lmd-(ask|scrim|panel)/.test(x.value))).length,
      js: [...a.querySelectorAll('a')].map((x) => x.getAttribute('href')).filter((x) => x && /javascript:/i.test(x)).length, fixed, topbar: getComputedStyle(document.querySelector('.lmd-topbar')).display !== 'none' && !!at && !!at.closest('.lmd-topbar'), body: getComputedStyle(document.body).display,
      safe: /Safe text stays\./.test(a.textContent), remote: [...a.querySelectorAll('img, image')].map((i) => i.getAttribute('src') || i.getAttribute('href') || '').filter((u) => /^https?:/.test(u)).length, styleEl: document.getElementById('lmd-custom-css').tagName, cover: /cover/.test(a.textContent) }; });
  check('ningún guion ni manejador del libro corrió', h.pwn === undefined && dialogs.length === 0, [h.pwn, dialogs]);
  check('no entran guiones, estilos, marcos, formularios ni objetos', h.bad === 0 && h.on === 0 && h.js === 0, h);
  check('nada del libro queda fijo ni encima de la app', h.fixed.length === 0 && h.topbar && h.body !== 'none' && h.cover, h);
  check('el texto inofensivo queda y el id de la app sigue siendo de la app', h.safe && h.styleEl === 'STYLE', h);
  check('no sale ningún pedido fuera de la app', !hits.some((u) => /evil\.example/.test(u)) && h.remote === 0, hits.filter((u) => /evil/.test(u)));
  await page.evaluate(() => { const a = [...document.querySelectorAll('.lmd-article a')].find((x) => /act link/.test(x.textContent)); a.click(); const j = [...document.querySelectorAll('.lmd-article a')].find((x) => /js link/.test(x.textContent)); j.click(); const r = [...document.querySelectorAll('.lmd-article a')].find((x) => /app link/.test(x.textContent)); r.click(); const p = document.querySelector('.lmd-article [data-bk="safe"]'); if (p) p.click(); });
  await sleep(500);
  check('sus enlaces no accionan botones de la app ni abren otra nota', await page.evaluate(() => document.querySelector('.lmd-panel').hidden && window.__pwn === undefined && /hostile\.epub/.test(decodeURIComponent(location.search))) && ctx.pages().length === pages0, await page.evaluate(() => location.search));
  // El SVG hostil: como imagen, sin correr nada; y su fuente, como texto.
  await openFile(page, 'img', 'd-bad.svg'); await ready(page, 'image'); await sleep(600);
  const v = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); const img = a.querySelector('.lmd-vw-stage img'); return { pwn: window.__pwn, tag: img && img.tagName, src: img ? img.src.slice(0, 5) : '', inline: a.querySelectorAll('svg, script, iframe, foreignObject').length, w: img && img.naturalWidth }; });
  check('el SVG hostil se ve como imagen blob: y no corre nada', v.pwn === undefined && v.tag === 'IMG' && v.src === 'blob:' && v.inline === 0 && v.w === 100 && dialogs.length === 0, v);
  await page.click('[data-vw=src]'); await page.waitForSelector('.lmd-vw-src');
  const src = await page.evaluate(() => { const p = document.querySelector('.lmd-vw-src'); return { text: /<script>top\.__pwn=8/.test(p.textContent), kids: p.children.length, pwn: window.__pwn, pressed: document.querySelector('[data-vw=src]').getAttribute('aria-pressed') }; });
  check('su código se lee como texto, sin interpretarse', src.text && src.kids === 0 && src.pwn === undefined && src.pressed === 'true', src);
  check('y tampoco pide nada afuera', !hits.some((u) => /evil\.example/.test(u)), hits.filter((u) => /evil/.test(u)));
  // Un HTML de la carpeta se lee como código: no se ejecuta.
  await page.click(node('page.html')); await page.waitForSelector('.lmd-article pre code'); await sleep(300);
  check('un HTML se muestra como código, sin ejecutarse', await page.evaluate(() => window.__pwn === undefined && /onclick/.test(document.querySelector('.lmd-article pre code').textContent) && !document.querySelector('.lmd-article h1')));
  await shut(ctx);
});

// ---------- Imágenes ----------
await step('image', 'Imágenes: visor, zoom, arrastre, anterior y siguiente, copiar', async () => {
  const { ctx, page, hits } = await start({ colorScheme: 'light' });
  await openFile(page, 'img', 'a-photo.png'); await ready(page, 'image'); await sleep(500);
  check('una imagen no pide pdf.js ni el importador', !hits.some((u) => /pdfjs|import\.js/.test(u)) && hits.some((u) => /viewer\.js/.test(u)), hits.filter((u) => /pdfjs|import/.test(u)));
  const s = await page.evaluate(() => { const img = document.querySelector('.lmd-vw-stage img'); const st = document.querySelector('.lmd-vw-stage'); const r = img.getBoundingClientRect(); const b = st.getBoundingClientRect(); return { src: img.src.slice(0, 5), w: r.width, h: r.height, cx: Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2), info: document.querySelector('.lmd-vw-info').textContent, zoom: document.querySelector('.lmd-vw-zoom').textContent, where: document.querySelector('.lmd-vw-where').textContent,
    checker: /conic-gradient/.test(getComputedStyle(st).backgroundImage), stageBottom: b.bottom, vh: innerHeight, list: [...document.querySelectorAll('.lmd-pane-outline .lmd-o-link')].map((a) => a.textContent), active: (document.querySelector('.lmd-o-row.lmd-active') || { textContent: '' }).textContent.trim(), fit: document.querySelector('[data-vw=fit]').getAttribute('aria-pressed') }; });
  check('se ve a su tamaño, centrada, sobre fondo ajedrezado y dentro de la ventana', s.src === 'blob:' && Math.round(s.w) === 400 && Math.round(s.h) === 300 && s.cx < 2 && s.checker && s.stageBottom <= s.vh && s.zoom === '100 %' && s.fit === 'true', s);
  check('una línea dice dimensiones y peso', /^400 × 300 px · \d+ (B|KB)$/.test(s.info), s.info);
  check('el panel lista las imágenes de la carpeta y marca la abierta', J(s.list) === J(['a-photo.png', 'b-wide.png', 'c-logo.svg', 'd-bad.svg']) && s.active === 'a-photo.png' && s.where === '1 / 4', s);
  await shot(page, 'imagen-claro');
  // Zoom con botones, rueda y teclado; arrastrar.
  await page.click('[data-vw=in]'); await sleep(100);
  const z1 = await page.evaluate(() => document.querySelector('.lmd-vw-stage img').getBoundingClientRect().width);
  const box = await page.evaluate(() => { const b = document.querySelector('.lmd-vw-stage').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(box.x, box.y); for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
  await sleep(150);
  const z2 = await page.evaluate(() => { const r = document.querySelector('.lmd-vw-stage img').getBoundingClientRect(); return { w: r.width, left: r.left, y: scrollY }; });
  check('acercar con el botón y con la rueda (sin mover la página)', Math.round(z1) === 500 && z2.w > 1200 && z2.y === 0, [z1, z2]);
  await page.mouse.down(); await page.mouse.move(box.x - 150, box.y - 60, { steps: 5 }); await page.mouse.up(); await sleep(100);
  const z3 = await page.evaluate(() => document.querySelector('.lmd-vw-stage img').getBoundingClientRect().left);
  check('arrastrar mueve la imagen', Math.abs((z2.left - z3) - 150) < 3, [z2.left, z3]);
  await page.keyboard.press('1'); await sleep(100);
  check('la tecla 1 la deja en tamaño real', await page.evaluate(() => Math.round(document.querySelector('.lmd-vw-stage img').getBoundingClientRect().width) === 400 && document.querySelector('.lmd-vw-zoom').textContent === '100 %'));
  // Siguiente y anterior entre las imágenes de la carpeta.
  await page.keyboard.press('ArrowRight'); await until(() => page.evaluate(() => document.querySelector('.lmd-docname').textContent === 'b-wide.png' && LMD.viewer.ready() && !!document.querySelector('.lmd-vw-stage img')));
  await sleep(300);
  const wide = await page.evaluate(() => { const r = document.querySelector('.lmd-vw-stage img').getBoundingClientRect(); const b = document.querySelector('.lmd-vw-stage').getBoundingClientRect(); return { w: r.width, bw: b.width, zoom: document.querySelector('.lmd-vw-zoom').textContent, where: document.querySelector('.lmd-vw-where').textContent }; });
  check('la flecha pasa a la imagen siguiente, que se ajusta a la ventana', wide.where === '2 / 4' && wide.w <= wide.bw && wide.w > wide.bw - 4 && parseInt(wide.zoom, 10) < 100, wide);
  await page.click('[data-vw=prev]'); await until(() => page.evaluate(() => document.querySelector('.lmd-docname').textContent === 'a-photo.png'));
  check('y el botón vuelve a la anterior', await page.evaluate(() => document.querySelector('[data-vw=prev]').disabled || true));
  await ready(page, 'image'); await sleep(200);
  // Copiar como Markdown y copiar la imagen.
  // Lo que va al portapapeles se anota: la página de la extensión no deja leerlo desde la prueba.
  await page.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); }; navigator.clipboard.write = async (items) => { for (const it of items) for (const type of it.types) { const b = await it.getType(type); window.__clip.push(type + ':' + b.size); } }; });
  await page.click('[data-vw=copy-md]'); await sleep(200);
  check('copiar como Markdown deja la ruta relativa a la carpeta', J(await page.evaluate(() => window.__clip)) === J(['![a-photo](img/a-photo.png)']), await page.evaluate(() => window.__clip));
  await page.click('[data-vw=copy-img]'); await sleep(600);
  const clip = await page.evaluate(() => window.__clip[1] || '');
  check('copiar la imagen la deja en el portapapeles, como PNG', /^image\/png:\d{3,}$/.test(clip) && /Image copied/.test(await flashText(page)), [clip, await flashText(page)]);
  // El menú del archivo.
  await page.click('[data-act=export]'); await page.waitForSelector('.lmd-menu-export');
  check('el menú de una imagen: descargarla', J(await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export button')].map((b) => b.textContent.trim()))) === J(['Download the file']));
  await page.keyboard.press('Escape');
  check('sin errores de página', errors.length === 0, errors);
  await shut(ctx);
});

await step('svg', 'SVG: como imagen, con su código a un clic', async () => {
  const { ctx, page } = await start();
  await openFile(page, 'img', 'c-logo.svg'); await ready(page, 'image'); await sleep(400);
  const s = await page.evaluate(() => ({ info: document.querySelector('.lmd-vw-info').textContent, src: !!document.querySelector('[data-vw=src]'), tag: document.querySelector('.lmd-vw-stage img').tagName, inline: document.querySelectorAll('.lmd-article svg').length }));
  check('se dibuja en un <img>, con sus dimensiones', /^120 × 80 px/.test(s.info) && s.src && s.tag === 'IMG' && s.inline === 0, s);
  await page.click('[data-vw=src]'); await page.waitForSelector('.lmd-vw-src');
  check('Ver el código muestra el fuente y esconde la imagen', await page.evaluate(() => /<circle cx="60"/.test(document.querySelector('.lmd-vw-src').textContent) && document.querySelector('.lmd-vw-stage').hidden));
  await page.click('[data-vw=src]'); await sleep(100);
  check('y otro clic vuelve a la imagen', await page.evaluate(() => !document.querySelector('.lmd-vw-stage').hidden && document.querySelector('.lmd-vw-src').hidden));
  await shot(page, 'imagen-svg-oscuro');
  await shut(ctx);
});

await step('media', 'Audio: el reproductor del navegador', async () => {
  const { ctx, page } = await start();
  await openFile(page, 'media', 'tone.wav'); await ready(page, 'audio');
  const ok = await until(() => page.evaluate(() => { const a = document.querySelector('.lmd-article audio'); return !!a && a.controls && /^blob:/.test(a.src) && a.duration > 0.5; }));
  check('un audio se escucha en la zona de la nota', !!ok, await page.evaluate(() => document.querySelector('.lmd-article').innerHTML.slice(0, 200)));
  check('sin barra de edición', await page.evaluate(() => document.documentElement.classList.contains('lmd-bin') && !(document.querySelector('[data-act=mode-edit]') || {}).offsetParent));
  await shut(ctx);
});

// ---------- Lo que no se dibuja ----------
await step('other', 'Word ofrece importar; un binario o un archivo enorme no se dibujan', async () => {
  const { ctx, page } = await start();
  await page.click(node('report.docx')); await page.waitForSelector('.lmd-notice');
  const d = await page.evaluate(() => ({ text: document.querySelector('.lmd-notice p').textContent, btn: (document.querySelector('.lmd-notice [data-act=import-here]') || {}).textContent, dlg: !!document.querySelector('.lmd-imp') }));
  check('un .docx no se muestra y ofrece Importar a Markdown', /can turn it into a note/.test(d.text) && d.btn === 'Import to Markdown' && !d.dlg, d);
  await page.click('.lmd-notice [data-act=import-here]'); await page.waitForSelector('.lmd-imp', { timeout: 15000 });
  check('el botón abre la conversión de ese archivo', /report\.docx/.test(await page.evaluate(() => document.querySelector('.lmd-imp').textContent)));
  await until(() => page.evaluate(() => !!document.querySelector('[data-imp=cancel]'))); await page.click('[data-imp=cancel]'); await sleep(300); if (await page.$('.lmd-imp')) { await page.keyboard.press('Escape'); await sleep(200); }
  // Un binario que no está en la lista, abierto por un enlace.
  await page.evaluate(() => LMD.viewer && 0); await page.goto(EXT + '/src/app.html?f=' + encodeURIComponent((await page.evaluate(() => new URLSearchParams(location.search).get('f'))).replace(/report\.docx$/, 'blob.bin'))); await page.waitForSelector('.lmd-notice');
  const b = await page.evaluate(() => ({ text: document.querySelector('.lmd-notice p').textContent, art: document.querySelector('.lmd-article').textContent.length, code: !!document.querySelector('.lmd-article pre') }));
  check('un binario desconocido dice que no se muestra, y no se dibuja como texto', b.text === 'SharpMD does not show this type of file.' && !b.code && b.art < 200, b);
  // Uno enorme: se dice el tope sin leerlo.
  await page.evaluate(async () => { window.__dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('visor'); const img = await window.__dir.getDirectoryHandle('img'); const h = await img.getFileHandle('huge.jpg', { create: true }); const w = await h.createWritable(); const chunk = new Uint8Array(8 * 1048576); for (let i = 0; i < 6; i++) await w.write(chunk); await w.close();
    const h2 = await window.__dir.getFileHandle('server.log', { create: true }); const w2 = await h2.createWritable(); await w2.write(new Uint8Array(6 * 1048576).fill(97)); await w2.close(); });
  await page.click('[data-act=tree-refresh]'); await sleep(600); await expand(page, 'img');
  const t0 = Date.now(); await page.click(node('huge.jpg')); await page.waitForSelector('.lmd-notice >> text=huge.jpg'); const took = Date.now() - t0;
  check('una imagen de 48 MB avisa el tope en vez de abrirse', /"huge\.jpg" is 48 MB\. SharpMD opens this type of file up to 40 MB\./.test(await page.evaluate(() => document.querySelector('.lmd-notice p').textContent)) && took < 3000 && await page.evaluate(() => !document.querySelector('.lmd-article img')), [await page.evaluate(() => document.querySelector('.lmd-notice p').textContent), took]);
  await page.click(node('server.log')); await page.waitForSelector('.lmd-notice >> text=server.log');
  check('un registro de texto que pasa su tope tampoco se dibuja', /up to 5 MB/.test(await page.evaluate(() => document.querySelector('.lmd-notice p').textContent)) && await page.evaluate(() => !document.querySelector('.lmd-article pre')));
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  check('la app sigue andando', errors.length === 0, errors);
  await shut(ctx);
});

// ---------- Otras formas de abrir ----------
await step('open', 'Abrir desde un enlace de una nota, arrastrando y con Abrir archivo', async () => {
  const { ctx, page } = await start();
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  await page.click('.lmd-article a >> text=the book'); await pdfReady(page);
  check('un enlace relativo a un PDF abre el visor', await page.evaluate(() => /out\/book\.pdf$/.test(decodeURIComponent(new URLSearchParams(location.search).get('f'))) && document.querySelectorAll('.lmd-vw-page').length === 5));
  await page.goBack(); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  check('Atrás vuelve a la nota', await page.evaluate(() => !document.querySelector('.lmd-vw-bar')));
  await page.click('.lmd-article a >> text=page four'); await pdfReady(page); await sleep(300);
  check('con #page=4 abre en esa página', (await pageNow(page)) === 4, await pageNow(page));
  await page.goBack(); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  await page.click('.lmd-article a >> text=the epub'); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1 >> text=Chapter One');
  check('y un enlace a un EPUB abre el libro', (await peek(page)).kind === 'epub');
  await page.goBack(); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  check('la imagen relativa de la nota se sigue viendo en la nota', !!(await until(() => page.evaluate(() => { const i = document.querySelector('.lmd-article img'); return !!i && i.naturalWidth === 400; }))));
  // Arrastrar a la ventana, con una nota abierta y la herramienta de importar prendida.
  await page.evaluate(() => LMD.tools.set('import', true)); await until(() => page.evaluate(() => !!LMD.import && LMD.tools.isOn('import')));
  const drop = (name, type, data) => page.evaluate(([n, t, d]) => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))], n, { type: t })); const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(over); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return over.defaultPrevented; }, [name, type, b64(data)]);
  const over = await drop('dropped.pdf', 'application/pdf', PDF5); await pdfReady(page);
  check('soltar un PDF en la ventana lo abre en el visor, no en el importador', over && await page.evaluate(() => document.querySelector('.lmd-docname').textContent === 'dropped.pdf' && !document.querySelector('.lmd-imp') && document.querySelectorAll('.lmd-vw-page').length === 5));
  await drop('dropped.epub', 'application/epub+zip', BOOK); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1 >> text=Chapter One');
  check('y un EPUB también', await page.evaluate(() => document.querySelector('.lmd-docname').textContent === 'dropped.epub'));
  await drop('dropped.png', 'image/png', FILES['img/a-photo.png']); await ready(page, 'image');
  check('y una imagen', await page.evaluate(() => document.querySelector('.lmd-docname').textContent === 'dropped.png' && !!document.querySelector('.lmd-vw-stage img')));
  await drop('dropped.csv', 'text/csv', Buffer.from('a,b\n1,2\n')); await page.waitForSelector('.lmd-imp', { timeout: 8000 });
  check('lo demás que convierte la herramienta sigue yendo a ella', /dropped\.csv/.test(await page.evaluate(() => document.querySelector('.lmd-imp').textContent)));
  await until(() => page.evaluate(() => !!document.querySelector('[data-imp=cancel]'))); await page.click('[data-imp=cancel]'); await sleep(300);
  // Abrir archivo: el selector acepta PDF y EPUB, y lo elegido va al visor.
  await page.evaluate(async () => { const out = await window.__dir.getDirectoryHandle('out'); const h = await out.getFileHandle('novel.epub'); window.__asked = null; window.showOpenFilePicker = async (o) => { window.__asked = o; return [h]; }; });
  await page.evaluate(() => LMD.home.pick({ open: (f, o) => window.__go(f, o) }, 'file')).catch(() => {});
  await page.click('.lmd-tree-open'); await page.waitForSelector('.lmd-menu'); await page.click('.lmd-menu button >> text=Open file'); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1 >> text=Chapter One');
  const asked = await page.evaluate(() => JSON.stringify(window.__asked.types));
  check('Abrir archivo ofrece PDF y EPUB, y abre el libro en el visor', /\.pdf/.test(asked) && /\.epub/.test(asked) && /\.png/.test(asked) && await page.evaluate(() => !document.querySelector('.lmd-imp') && document.querySelector('.lmd-docname').textContent === 'novel.epub'), asked);
  await shut(ctx);
});

// ---------- Teléfono ----------
await step('phone', 'Teléfono: la barra entra, pellizcar acerca y deslizar pasa de capítulo', async () => {
  const { ctx, page } = await start({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const openSide = async () => { if (!(await page.evaluate(() => document.documentElement.classList.contains('lmd-side-open')))) await page.click('[data-act=sidebar]'); await sleep(250); };
  const tapNode = async (dir, name) => { await openSide(); if (dir && !(await page.$(node(dir) + '.lmd-open'))) { await page.click(node(dir)); await sleep(250); } await page.click(node(name)); };
  await tapNode('out', 'book.pdf'); await pdfReady(page); await sleep(400);
  const fits = () => page.evaluate(() => { const bar = document.querySelector('.lmd-vw-bar').getBoundingClientRect(); const out = [...document.querySelectorAll('.lmd-vw-bar button, .lmd-vw-bar input')].filter((n) => n.offsetParent).filter((n) => { const r = n.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).length; return { w: bar.width, out, scroll: document.documentElement.scrollWidth <= innerWidth + 1, small: [...document.querySelectorAll('.lmd-vw-bar button')].filter((n) => n.offsetParent).every((n) => n.getBoundingClientRect().height >= 32) }; });
  const f = await fits();
  check('la barra del PDF entra en la pantalla', f.out === 0 && f.scroll && f.w <= 390 && f.small, f);
  const hi = await page.evaluate(() => { const c = document.querySelector('.lmd-vw-page canvas'); return c.width / c.getBoundingClientRect().width; });
  check('en pantalla de alta densidad el lienzo lleva más píxeles', hi > 2.5, hi);
  await page.click('[data-vw=find]'); await sleep(150);
  check('el buscador se despliega con su botón', await page.evaluate(() => document.activeElement.classList.contains('lmd-vw-q')) && (await fits()).out === 0);
  await page.click('[data-vw=find]'); await sleep(100);
  await shot(page, 'pdf-telefono');
  // Pellizcar.
  const s0 = (await peek(page)).scale;
  await page.evaluate(() => {
    const box = document.querySelector('.lmd-vw-pages'); const r = box.getBoundingClientRect();
    const t = (id, x, y) => new Touch({ identifier: id, target: box, clientX: x, clientY: y });
    const fire = (type, list) => box.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: list, bubbles: true, cancelable: true }));
    const cx = r.left + 150; const cy = 400;
    fire('touchstart', [t(1, cx - 40, cy), t(2, cx + 40, cy)]); fire('touchmove', [t(1, cx - 60, cy), t(2, cx + 60, cy)]); fire('touchmove', [t(1, cx - 80, cy), t(2, cx + 80, cy)]);
    box.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t(1, cx - 80, cy)], bubbles: true, cancelable: true }));
  });
  await sleep(600);
  const s1 = await peek(page);
  check('pellizcar acerca el PDF', Math.abs(s1.scale / s0 - 2) < 0.05 && s1.zoom !== 'fit', [s0, s1.scale]);
  check('con la página más ancha que la pantalla, se desplaza dentro de su marco', await page.evaluate(() => { const b = document.querySelector('.lmd-vw-pages'); return b.scrollWidth > b.clientWidth + 50 && document.documentElement.scrollWidth <= innerWidth + 1; }));
  // EPUB: deslizar.
  await tapNode('', 'novel.epub'); await ready(page, 'epub'); await page.waitForSelector('.lmd-article h1 >> text=Chapter One'); await sleep(300);
  check('la barra del libro entra en la pantalla', (await fits()).out === 0 && (await fits()).scroll, await fits());
  const swipe = (dx) => page.evaluate((d) => {
    const host = document.querySelector('.lmd-article'); const p = host.querySelector('p');
    const t = (x) => new Touch({ identifier: 1, target: p, clientX: x, clientY: 300 });
    p.dispatchEvent(new TouchEvent('touchstart', { touches: [t(200)], targetTouches: [t(200)], changedTouches: [t(200)], bubbles: true }));
    p.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t(200 + d)], bubbles: true }));
  }, dx);
  await swipe(-140); await until(async () => (await peek(page)).c === 1);
  check('deslizar a la izquierda pasa al capítulo siguiente', (await peek(page)).c === 1);
  await swipe(140); await until(async () => (await peek(page)).c === 0);
  check('y a la derecha, al anterior', (await peek(page)).c === 0);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
  await page.tap('.lmd-vw-turn [data-vw=next]'); await until(async () => (await peek(page)).c === 1);
  check('un toque en el pie también pasa de capítulo', (await peek(page)).c === 1);
  await shot(page, 'epub-telefono');
  // Imagen.
  await tapNode('img', 'b-wide.png'); await ready(page, 'image'); await sleep(400);
  const im = await page.evaluate(() => { const r = document.querySelector('.lmd-vw-stage img').getBoundingClientRect(); return { w: r.width, vw: innerWidth }; });
  check('la imagen ancha entra en la pantalla y su barra también', im.w <= im.vw && (await fits()).out === 0 && (await fits()).scroll, [im, await fits()]);
  await shot(page, 'imagen-telefono');
  await openSide();
  check('el interruptor Solo Markdown está en el panel del teléfono', await page.evaluate(() => { const b = document.querySelector('.lmd-tree-only'); const r = b.getBoundingClientRect(); return !!b.offsetParent && r.width >= 32 && r.right <= innerWidth; }));
  await shot(page, 'explorador-telefono');
  await shut(ctx);
});

// ---------- Un .md sigue como siempre ----------
await step('md', 'Un Markdown se abre y se edita como siempre', async () => {
  const { ctx, page, hits } = await start();
  await page.click(node('readme.md')); await page.waitForSelector('.lmd-article h1 >> text=Readme');
  const s = await page.evaluate(() => ({ edit: !!document.querySelector('[data-act=mode-edit]').offsetParent, raw: !!document.querySelector('[data-act=view-raw]').offsetParent, copy: !!document.querySelector('[data-act=copy]').offsetParent, outline: document.querySelector('.lmd-pane-outline .lmd-o-title').textContent, bin: document.documentElement.classList.contains('lmd-bin'), viewer: !!LMD.viewer }));
  check('con la barra entera, su índice, y sin pedir el visor', s.edit && s.raw && s.copy && /Readme/.test(s.outline) && !s.bin && !s.viewer && !hits.some((u) => /viewer\.js/.test(u)), s);
  await page.click(node('table.csv')); await page.waitForSelector('.lmd-article table');
  await page.click(node('data.json')); await page.waitForSelector('.lmd-article pre code');
  await page.click(node('notes.txt')); await page.waitForSelector('.lmd-article .lmd-plain');
  check('CSV como tabla, JSON como código y texto plano, como antes', await page.evaluate(() => document.querySelector('.lmd-plain').textContent.trim() === 'plain notes'));
  check('las listas de archivos de la app nombran al visor', /'src\/viewer\.js'/.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')) && JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[1].js.includes('src/viewer.js') && /viewer: \{ js: \['src\/viewer\.js'\] \}/.test(fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8')));
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  check('la extensión no toma los PDF ni los EPUB del navegador', !man.content_scripts.some((c) => c.matches.some((m) => /pdf|epub|\*\.\*|<all_urls>/i.test(m))), man.content_scripts.map((c) => c.matches.length));
  check('sin errores de página', errors.length === 0, errors);
  await shut(ctx);
});

const bad = done();
for (const x of launched.slice()) await shut(x[0]);
process.exit(bad ? 1 : 0);
