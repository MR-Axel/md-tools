// Exportar una carpeta entera como un solo documento (src/folderexport.js): todas las notas, una detrás de otra,
// en PDF, HTML, Word o un Markdown único. Acá se comprueba el documento combinado (orden natural, portada, índice,
// ids únicos, enlaces internos, notas al pie, imágenes), el diálogo, las tres clases de carpeta (disco, navegador y
// nube) y, sobre todo, el paginado: el PDF se genera de verdad con Chromium (page.pdf usa el motor de impresión) y
// se lee página por página con pdf.js para medir renglones sueltos, títulos al pie, páginas en blanco y saltos.
//   node folderexport.mjs
//   ONLY=pdf node folderexport.mjs        (una parte: ui, html, formats, pdf, breaks, places, phone)
//   KEEP_PDF=C:\tmp\agexport node folderexport.mjs   (deja ahí los PDF generados y uno de ejemplo de diez documentos)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
import { rig, tally, sleep, root } from './rig.mjs';

// pdf.js avisa por la consola que en Node no tiene canvas: acá solo se le pide el texto.
const warn = console.warn; const log = console.log; const mute = (fn) => (...a) => { if (!/canvas|polyfill|Require stack|pdf\.min\.js/i.test(String(a[0]))) fn(...a); };
console.warn = mute(warn); console.log = mute(log);
const pdfjs = await import(pathToFileURL(path.join(root, 'vendor', 'pdfjs', 'pdf.min.js')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'vendor', 'pdfjs', 'pdf.worker.min.js')).href;

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const ONLY = process.env.ONLY || ''; const KEEP = process.env.KEEP_PDF || '';
const part = (name) => !ONLY || ONLY === name;
const R = await rig();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---------- Texto de relleno con marcas ----------
// Cada palabra de un párrafo empieza con la marca de su párrafo (q12, li7…): así, al leer el PDF, se sabe a qué
// bloque pertenece cada renglón de cada página, también el último, que puede ser una sola palabra.
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'eiusmod', 'tempor', 'incididunt', 'labore', 'magna', 'aliqua'];
let seq = 0;
const text = (tag, words) => Array.from({ length: Math.round(words * 0.62) }, (_, i) => tag + WORDS[(i * 7 + tag.length + seq) % WORDS.length]).join(' ');
const para = (words) => text('q' + (++seq), words);
const paras = (n, words) => Array.from({ length: n }, (_, i) => para(typeof words === 'function' ? words(i) : words)).join('\n\n');
// Párrafos de un solo renglón: su alto no depende de dónde corte el texto.
const one = (n) => Array.from({ length: n }, () => 'q' + (++seq) + 'uno renglón').join('\n\n');

// La carpeta "libro": lo que tiene que quedar bien al juntar.
const LIBRO = {
  '1-intro.md': '---\ntitle: La introducción\nauthor: Ema Ruiz\nwidth: wide\n---\n# Intro\n\nVa al [capítulo dos](2-uno.md), a [una sección](10-diez.md#la-sección-final), a [otra por su id](10-diez.md#repetido), a [la misma nota](#cierre), ' +
    'a [afuera](../otro.md), a [un sitio](https://example.com/x) y a [[10-diez]] y [[no-existe]].\n\nUna nota al pie[^1] y otra[^b].\n\n![punto](img/dot.png)\n\n## Repetido\n\nTexto.\n\n## Cierre\n\nFin.\n\n[^1]: Nota uno de la intro.\n[^b]: Nota b de la intro.\n',
  '2-uno.md': '# Capítulo dos\n\nOtra nota al pie[^1].\n\n## Repetido\n\nMismo título que en la intro.\n\n```js\nconst a = 1;\n```\n\n[^1]: Nota uno del capítulo dos.\n',
  '10-diez.md': '# Capítulo diez\n\n## Repetido\n\nTercero con ese título.\n\n## La sección final\n\nLlegaste.\n\n---\n',
  'vacio.md': '\n\n',
  'notas.txt': 'texto plano\n<b>no es html</b>\n# no es un título\n',
  'data.json': '{ "a": 1 }\n',
  'partes/3-sub.md': '# Parte tres\n\n![otro punto](dot.png)\n\nVuelve a la [intro](../1-intro.md#cierre).\n',
};

// ---------- Leer el PDF ----------
const MM = 72 / 25.4;
// Las páginas con sus renglones de arriba abajo. El número de página (abajo, solo) va aparte.
async function readPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise; const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent(); const rows = [];
    tc.items.forEach((it) => {
      if (!it.str) return; const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.5); if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    const lines = rows.map((r) => ({ y: r.y, size: Math.max(...r.items.map((i) => i.height || 0)), text: r.items.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('').replace(/\s+/g, ' ').trim() })).filter((l) => l.text).sort((a, b) => b.y - a.y);
    const foot = lines.length && lines[lines.length - 1].y < 20 * MM && /^\d+$/.test(lines[lines.length - 1].text) ? lines.pop() : null;
    out.push({ w: vp.width, h: vp.height, lines, number: foot ? +foot.text : null });
  }
  return out;
}
// Lo que el paginado tiene que cumplir, medido sobre el texto de cada página.
function audit(pages) {
  const v = { blank: [], thin: [], orphans: [], foot: [], split: [], tableHead: [] };
  pages.forEach((p, i) => { if (!p.lines.length) v.blank.push(i + 1); else if (p.lines.length < 3) v.thin.push(i + 1); });
  const tagOf = (t) => (/(?:^|[\s"])((?:q|li|bq|al|ca|cb)\d+)/.exec(t) || [])[1];
  const frags = new Map();
  pages.forEach((p, i) => p.lines.forEach((l) => {
    const t = tagOf(l.text); if (!t) return;
    const a = frags.get(t) || []; const last = a[a.length - 1];
    if (last && last.page === i) last.n++; else a.push({ page: i, n: 1 });
    frags.set(t, a);
  }));
  frags.forEach((a, t) => {
    if (a.length < 2) return;
    // Citas, avisos y código corto no se parten; de lo demás, cada pedazo lleva al menos tres renglones.
    if (/^(bq|al|ca)/.test(t)) v.split.push(t + ':' + a.map((f) => f.n).join('+'));
    else if (a.some((f) => f.n < 3)) v.orphans.push(t + ':' + a.map((f) => f.n).join('+'));
  });
  pages.forEach((p, i) => {
    const last = p.lines[p.lines.length - 1];
    if (last && /\b(HEAD\d+|DOCTITLE\d+)\b/.test(last.text)) v.foot.push((i + 1) + ':' + last.text.slice(0, 24));
    const rows = p.lines.findIndex((l) => /\bfila\d+\b/.test(l.text));
    if (rows >= 0 && !p.lines.slice(0, rows).some((l) => /COLA/.test(l.text))) v.tableHead.push(i + 1);
  });
  return v;
}
const clean = (v) => Object.values(v).every((a) => !a.length);

// ---------- El navegador con una carpeta del disco ----------
// El disco de prueba es OPFS, que pide un navegador con perfil propio.
async function disk(files, opt) {
  opt = opt || {};
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfx-'));
  const ctx = await chromium.launchPersistentContext(profile, Object.assign({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'es-AR', colorScheme: 'light', serviceWorkers: 'block', acceptDownloads: true }, opt.ctx || {}));
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (route) => { R.outside.push(route.request().url()); return route.abort(); });
  await ctx.addInitScript((tools) => { try { if (!localStorage.getItem('mdtools:settings')) localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: 'off', language: 'es', tools })); } catch (e) { /* una página en blanco no tiene almacenamiento */ } }, opt.tools || {});
  const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
  await page.goto(R.home); await page.waitForSelector('.lmd-home');
  await page.evaluate(async ([list, png]) => {
    const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true });
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    for (const [rel, body] of list) {
      const parts = rel.split('/'); let dir = top;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const h = await dir.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable();
      await w.write(body === null ? bytes : body); await w.close();
    }
    window.showDirectoryPicker = async () => top;
  }, [Object.entries(Object.assign({ 'inicio.md': '# Inicio\n\nLa nota que queda abierta.\n' }, files)), PNG]);
  await Promise.all([page.waitForNavigation(), page.click('[data-home=dir]')]);
  await page.waitForSelector('.lmd-tree .lmd-node-dir', { state: 'attached' }); await sleep(400); // en el teléfono la barra lateral arranca cerrada
  const base = await page.evaluate(() => /^https:\/\/lmd\.local\/[^/]+\//.exec(document.querySelector('.lmd-tree').dataset.url)[0]);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.evaluate(() => LMD.extras.folderExport(''));
  return { ctx, page, base, close: async () => { await ctx.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ } } };
}
const under = (prefix, files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [prefix + '/' + k, v]));
// Deja la carpeta lista en la hoja de impresión y devuelve el plan y el PDF que saca Chromium.
async function pdfOf(page, dirUrl, opt, extraCss) {
  const r = await page.evaluate(async ([dir, o]) => { try { const x = await LMD.folderexport.stagePdf(dir, o); LMD.folderexport.print(); return x; } catch (e) { return { error: String((e && e.code) || e), stack: e && e.stack }; } }, [dirUrl, opt]);
  if (r.error) return { r, pages: [] };
  if (extraCss) await page.addStyleTag({ content: extraCss });
  // Chromium avisa "afterprint" al terminar el PDF y la app retira la hoja: lo que se mira del DOM se toma antes.
  const dom = await page.evaluate(() => ({ printing: document.documentElement.classList.contains('lmd-fx-printing'), rule: (document.querySelector('style[data-lmd-fx]') || {}).textContent || '', hr: document.querySelectorAll('.lmd-fx-print hr').length, keep: document.querySelectorAll('.lmd-fx-print .lmd-keep').length, secs: [...document.querySelectorAll('.lmd-fx-doc')].map((s) => s.dataset.rel + (s.classList.contains('lmd-fx-break') ? ':salta' : s.classList.contains('lmd-fx-join') ? ':sigue' : '')) }));
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  const gone = await page.evaluate(() => !document.querySelector('.lmd-fx-stage, style[data-lmd-fx]') && !document.documentElement.classList.contains('lmd-fx-printing'));
  if (extraCss) await page.evaluate(() => { const all = document.querySelectorAll('style'); all[all.length - 1].remove(); });
  await page.evaluate(() => LMD.folderexport.unstage());
  dom.gone = gone;
  return { r, buf, dom, pages: await readPdf(buf) };
}
const keep = (name, buf) => { if (KEEP && buf) { fs.mkdirSync(KEEP, { recursive: true }); fs.writeFileSync(path.join(KEEP, name), buf); } };
const openDialog = async (page, dir) => { await page.click('.lmd-node-dir[data-url="' + dir + '"]', { button: 'right' }); await page.click('.lmd-menu [data-f=fexp]'); await page.waitForSelector('.lmd-fx'); };
const listed = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-fx-item')].map((li) => (li.querySelector('input').checked ? '' : '-') + li.dataset.rel));

// ====================================================================================================
// El diálogo, el documento combinado y los formatos
// ====================================================================================================
if (part('ui') || part('html') || part('formats')) {
  const D = await disk(Object.assign(under('libro', LIBRO), { 'libro/img/dot.png': null, 'libro/partes/dot.png': null, 'otro.md': '# Afuera\n' }), { tools: { docx: true } });
  const { page, base } = D; const dir = base + 'libro/';
  const html = (o) => page.evaluate(async ([d, opt]) => { try { return await LMD.folderexport.html(d, opt); } catch (e) { return { error: String((e && e.code) || e) }; } }, [dir, o || {}]);
  const dom = (r, fn, arg) => page.evaluate(([h, f, a]) => { const doc = new DOMParser().parseFromString(h, 'text/html'); return (0, eval)('(' + f + ')')(doc, a); }, [r.data, String(fn), arg === undefined ? null : arg]);

  if (part('ui')) {
    // ---- Dónde está ----
    const scripts = () => page.evaluate(() => [...document.scripts].filter((s) => /folderexport\.js/.test(s.src)).length);
    check('el código de exportar una carpeta se pide aparte y una sola vez', (await scripts()) === 1 && /'src\/folderexport\.js'/.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').split('const LATE')[1]) && !/folderexport/.test(fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8')));
    await page.click('.lmd-node-dir[data-url="' + dir + '"]', { button: 'right' });
    const menu = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f + ':' + b.textContent.trim()));
    check('el menú de una carpeta del explorador ofrece "Exportar la carpeta…"', menu.includes('fexp:Exportar la carpeta…'), menu);
    await page.keyboard.press('Escape');
    await page.click('.lmd-node-dir[data-url="' + dir + '"]'); await page.waitForSelector('.lmd-node[data-url="' + dir + '1-intro.md"]');
    await page.click('.lmd-node[data-url="' + dir + '1-intro.md"]'); await page.waitForFunction(() => /Intro/.test((document.querySelector('.markdown-body h1') || {}).textContent || ''));
    await page.click('[data-act=export]'); await page.waitForSelector('.lmd-menu-export');
    const em = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export [role=menuitem]')].map((b) => b.dataset.more + ':' + b.querySelector('span').textContent));
    check('con una nota de la carpeta abierta, Exportar suma "Toda la carpeta…"', em.includes('export-folder:Toda la carpeta…') && em.includes('export-docx:Word (.docx)'), em);
    await page.click('.lmd-menu-export [data-more=export-folder]'); await page.waitForSelector('.lmd-fx');

    // ---- Qué pide ----
    const st = () => page.evaluate(() => {
      const q = (s) => document.querySelector('.lmd-fx ' + s); const vis = (n) => !!n && n.offsetParent !== null;
      return { title: q('[data-fx=title]').value, format: q('[data-fx=format]').value, formats: [...q('[data-fx=format]').options].map((o) => o.value), breaks: [...q('[data-fx=breaks]').options].map((o) => o.value), breakNow: q('[data-fx=breaks]').value,
        label: q('[data-fx-row=breaks] span').textContent, paper: vis(q('[data-fx-row=paper]')), numbers: vis(q('[data-fx-row=numbers]')), cover: q('[data-fx=cover]').checked, toc: q('[data-fx=toc]').checked, deep: q('[data-fx=deep]').checked,
        count: q('[data-fx-count]').textContent, go: q('[data-fx-do=go]').disabled, pages: document.querySelectorAll('.lmd-fx [data-step], .lmd-fx .lmd-steps').length, role: q('.lmd-fx-card').getAttribute('role') };
    });
    let s = await st(); let list = await listed(page);
    check('el diálogo es una sola pantalla: formato, título, saltos, hoja, portada, índice, números y subcarpetas', s.role === 'dialog' && s.pages === 0 && J(s.formats) === J(['pdf', 'html', 'docx', 'md']) && s.format === 'pdf' && s.cover && s.toc && s.deep && s.paper && s.numbers, s);
    check('el título de la portada es el nombre de la carpeta, y se puede cambiar', s.title === 'libro', s.title);
    check('con PDF, el salto entre documentos tiene los cuatro modos y arranca en "hasta la mitad"', J(s.breaks) === J(['half', 'three', 'always', 'never']) && s.breakNow === 'half', s);
    check('la lista muestra lo que entra, en orden natural (2 antes de 10) y con las subcarpetas en orden de árbol', J(list) === J(['partes/3-sub.md', '1-intro.md', '2-uno.md', '10-diez.md', 'notas.txt', 'vacio.md']), list);
    check('solo entran notas Markdown y texto: ni el JSON ni las imágenes', !list.some((x) => /json|png/.test(x)) && /^6 documentos/.test(s.count), s.count);
    await page.selectOption('.lmd-fx [data-fx=format]', 'html'); s = await st();
    check('en HTML no hay páginas que calcular: el salto queda en siempre o nunca, sin hoja ni números', J(s.breaks) === J(['always', 'never']) && s.breakNow === 'always' && !s.paper && !s.numbers, s);
    await page.selectOption('.lmd-fx [data-fx=format]', 'docx'); s = await st();
    check('en Word también: siempre o nunca', J(s.breaks) === J(['always', 'never']) && !s.paper, s);
    await page.selectOption('.lmd-fx [data-fx=format]', 'md'); s = await st();
    check('en Markdown esa opción pasa a ser el separador entre documentos', s.label === 'Separador entre documentos' && J(s.breaks) === J(['always', 'never']), s);
    await page.selectOption('.lmd-fx [data-fx=format]', 'pdf'); s = await st();
    check('al volver a PDF el umbral elegido sigue ahí', s.breakNow === 'half' && s.breaks.length === 4, s);

    // ---- Excluir, subcarpetas y reordenar ----
    await page.uncheck('.lmd-fx-item[data-rel="notas.txt"] input'); list = await listed(page); s = await st();
    check('destildar un archivo lo deja afuera y la cuenta baja', list.includes('-notas.txt') && /^5 documentos/.test(s.count), [list, s.count]);
    await page.uncheck('.lmd-fx [data-fx=deep]'); list = await listed(page);
    check('sin subcarpetas quedan solo las notas de la carpeta', J(list) === J(['1-intro.md', '2-uno.md', '10-diez.md', '-notas.txt', 'vacio.md']), list);
    await page.check('.lmd-fx [data-fx=deep]');
    await page.hover('.lmd-fx-item[data-rel="10-diez.md"]'); await page.click('.lmd-fx-item[data-rel="10-diez.md"] [data-fx-move="-1"]'); list = await listed(page);
    check('la flecha de un renglón lo sube un lugar', J(list.slice(0, 4)) === J(['partes/3-sub.md', '1-intro.md', '10-diez.md', '2-uno.md']), list);
    await page.focus('.lmd-fx-item[data-rel="10-diez.md"] input'); await page.keyboard.press('Alt+ArrowDown'); list = await listed(page);
    check('Alt+flecha lo mueve con el teclado', J(list.slice(0, 4)) === J(['partes/3-sub.md', '1-intro.md', '2-uno.md', '10-diez.md']), list);
    await page.dragAndDrop('.lmd-fx-item[data-rel="partes/3-sub.md"]', '.lmd-fx-item[data-rel="vacio.md"]', { targetPosition: { x: 80, y: 26 } }); list = await listed(page);
    check('arrastrar un renglón lo deja donde se suelta', list[list.length - 1] === 'partes/3-sub.md' && list[0] === '1-intro.md', list);
    for (const rel of ['1-intro.md', '2-uno.md', '10-diez.md', 'vacio.md', 'partes/3-sub.md']) await page.uncheck('.lmd-fx-item[data-rel="' + rel + '"] input');
    check('sin ningún documento elegido no hay nada que exportar', (await st()).go === true);
    await page.check('.lmd-fx-item[data-rel="1-intro.md"] input'); await page.check('.lmd-fx-item[data-rel="10-diez.md"] input');

    // ---- Exportar desde el diálogo, y lo que recuerda ----
    await page.fill('.lmd-fx [data-fx=title]', 'Mi libro: tomo 1'); await page.selectOption('.lmd-fx [data-fx=format]', 'html'); await page.uncheck('.lmd-fx [data-fx=toc]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lmd-fx [data-fx-do=go]')]);
    const file = path.join(os.tmpdir(), 'fx-' + Date.now() + '.html'); await dl.saveAs(file); const saved = fs.readFileSync(file, 'utf8'); fs.rmSync(file, { force: true });
    check('Exportar descarga un solo HTML con el título como nombre', dl.suggestedFilename() === 'Mi libro tomo 1.html' && /<title>Mi libro: tomo 1<\/title>/.test(saved) && (saved.match(/class="lmd-fx-doc/g) || []).length === 2 && !/<nav class="lmd-fx-toc/.test(saved), dl.suggestedFilename());
    check('el diálogo se cierra al terminar y avisa', (await page.locator('.lmd-fx').count()) === 0 && /Carpeta exportada: 2 documentos/.test(await page.evaluate(() => document.body.textContent)));
    await openDialog(page, dir); s = await st(); list = await listed(page);
    check('la próxima vez la carpeta recuerda formato, título, orden, lo excluido y las casillas', s.format === 'html' && s.title === 'Mi libro: tomo 1' && !s.toc && J(list) === J(['1-intro.md', '-2-uno.md', '10-diez.md', '-notas.txt', '-vacio.md', '-partes/3-sub.md']), [s, list]);
    await page.keyboard.press('Escape'); await sleep(150);
    check('Escape cierra el diálogo', (await page.locator('.lmd-fx').count()) === 0);
    await page.evaluate(() => localStorage.removeItem('lmd:fx'));

    // ---- PDF desde el diálogo: avance y cancelar ----
    await openDialog(page, dir);
    // Las lecturas se frenan para poder cancelar a mitad de camino.
    await page.evaluate(() => { const fs0 = FileSystemFileHandle.prototype.getFile; window.__gf = fs0; FileSystemFileHandle.prototype.getFile = async function () { await new Promise((r) => setTimeout(r, 350)); return fs0.call(this); }; });
    await page.click('.lmd-fx [data-fx-do=go]');
    await page.waitForFunction(() => /Preparando \d+ de \d+/.test((document.querySelector('.lmd-fx [data-fx-status]') || {}).textContent || ''), null, { timeout: 8000 });
    const during = await page.evaluate(() => ({ status: document.querySelector('.lmd-fx [data-fx-status]').textContent, busy: document.querySelector('.lmd-fx-card').classList.contains('lmd-fx-busy'), go: document.querySelector('.lmd-fx [data-fx-do=go]').disabled }));
    check('mientras prepara dice por cuál va ("Preparando 2 de 6…") y no deja exportar dos veces', /^Preparando \d de 6…/.test(during.status) && during.busy && during.go, during);
    await page.click('.lmd-fx [data-fx-do=no]'); await sleep(900);
    const after = await page.evaluate(() => ({ open: !!document.querySelector('.lmd-fx'), status: (document.querySelector('.lmd-fx [data-fx-status]') || {}).textContent, stage: document.querySelectorAll('.lmd-fx-stage').length, printed: window.__printed, go: document.querySelector('.lmd-fx [data-fx-do=go]').disabled }));
    check('Cancelar corta el trabajo: no imprime, no deja nada armado y el formulario queda como estaba', after.open && after.status === 'Cancelado.' && after.stage === 0 && after.printed === 0 && !after.go, after);
    await page.evaluate(() => { FileSystemFileHandle.prototype.getFile = window.__gf; });
    await page.click('.lmd-fx [data-fx-do=go]'); await page.waitForFunction(() => window.__printed === 1, null, { timeout: 15000 });
    const printed = await page.evaluate(() => ({ open: !!document.querySelector('.lmd-fx'), cls: document.documentElement.classList.contains('lmd-fx-printing'), docs: document.querySelectorAll('.lmd-fx-stage .lmd-fx-doc').length, cover: (document.querySelector('.lmd-fx-cover') || {}).textContent, told: (document.querySelector('.lmd-dlg-card') || {}).textContent || '' }));
    check('PDF: arma el documento y lo manda a imprimir, con la portada y los cinco documentos con texto', !printed.open && printed.cls && printed.docs === 5 && printed.cover === 'libro', printed);
    check('la nota vacía no suma página y se dice al final', /vacio\.md/.test(printed.told), printed.told);
    await page.evaluate(() => { const b = document.querySelector('.lmd-dlg [data-dlg=ok]'); if (b) b.click(); window.dispatchEvent(new Event('afterprint')); });
    check('al terminar de imprimir no queda nada del documento en la página', await page.evaluate(() => !document.querySelector('.lmd-fx-stage, style[data-lmd-fx]') && !document.documentElement.classList.contains('lmd-fx-printing')));
  }

  if (part('html')) {
    const r = await html({ title: 'El libro', off: [] });
    check('HTML: un solo archivo con todo lo que tiene texto; lo vacío se informa aparte', !r.error && r.count === 5 && J(r.blank) === J(['vacio.md']) && r.name === 'El libro.html' && !r.failed.length, [r.error, r.count, r.blank, r.name]);
    const shape = await dom(r, (doc) => ({
      order: [...doc.querySelectorAll('.lmd-fx-doc')].map((s) => s.dataset.rel), ids: [...doc.querySelectorAll('.lmd-fx-doc')].map((s) => s.id),
      cls: [...doc.querySelectorAll('main > *')].map((n) => n.tagName.toLowerCase() + '.' + [...n.classList].filter((c) => /^lmd-fx/.test(c)).join('.')),
      cover: (doc.querySelector('.lmd-fx-cover h1') || {}).textContent, toc: [...doc.querySelectorAll('.lmd-fx-toc a')].map((a) => a.getAttribute('href') + ' ' + a.textContent),
      dup: (() => { const all = [...doc.querySelectorAll('[id]')].map((n) => n.id); return all.filter((id, i) => all.indexOf(id) !== i); })(),
      heads: [...doc.querySelectorAll('h2')].filter((h) => h.textContent === 'Repetido').map((h) => h.id),
      broken: [...doc.querySelectorAll('a[href^="#"]')].filter((a) => !doc.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))).map((a) => a.getAttribute('href')),
    }));
    check('los documentos van en orden natural, cada uno en su sección', J(shape.order) === J(['partes/3-sub.md', '1-intro.md', '2-uno.md', '10-diez.md', 'notas.txt']) && J(shape.ids) === J(['d1', 'd2', 'd3', 'd4', 'd5']), shape.order);
    check('portada, índice y un corte de página antes de cada documento', J(shape.cls) === J(['header.lmd-fx-cover', 'nav.lmd-fx-toc.lmd-fx-break', 'section.lmd-fx-doc.lmd-fx-break', 'section.lmd-fx-doc.lmd-fx-break', 'section.lmd-fx-doc.lmd-fx-break', 'section.lmd-fx-doc.lmd-fx-break', 'section.lmd-fx-doc.lmd-fx-break']) && /break-before:page/.test(r.data), shape.cls);
    check('la portada lleva el título y el índice, el título de cada documento con su enlace', shape.cover === 'El libro' && J(shape.toc) === J(['#d1 Parte tres', '#d2 La introducción', '#d3 Capítulo dos', '#d4 Capítulo diez', '#d5 notas']), [shape.cover, shape.toc]);
    check('ningún id se repite: los títulos iguales de tres notas quedan con su prefijo', !shape.dup.length && J(shape.heads) === J(['d2-repetido', 'd3-repetido', 'd4-repetido']), [shape.dup, shape.heads]);
    check('todos los enlaces internos llegan a algo', !shape.broken.length, shape.broken);
    const links = await dom(r, (doc) => {
      const sec = doc.getElementById('d2'); const by = (t) => [...sec.querySelectorAll('a')].find((a) => a.textContent === t);
      const href = (t) => { const a = by(t); return a ? a.getAttribute('href') : null; };
      return { cap: href('capítulo dos'), sec: href('una sección'), id: href('otra por su id'), own: href('la misma nota'), out: href('afuera'), web: href('un sitio'), wiki: href('10-diez'), ghost: [...sec.querySelectorAll('span')].some((s) => s.textContent === 'no-existe'),
        up: doc.querySelector('#d1 a').getAttribute('href') };
    });
    check('un enlace a otra nota de la carpeta pasa a ser interno', links.cap === '#d3' && links.wiki === '#d4', links);
    check('otro.md#sección va a esa sección del documento combinado, por su texto o por su id', links.sec === '#d4-la-seccion-final' && links.id === '#d4-repetido' && links.up === '#d2-cierre', links);
    check('un enlace dentro de la misma nota sigue apuntando a ella', links.own === '#d2-cierre', links.own);
    check('lo que apunta afuera de lo exportado queda como estaba, y un [[nombre]] sin archivo, como texto', links.out === '../otro.md' && links.web === 'https://example.com/x' && links.ghost, links);
    const notes = await dom(r, (doc) => ({
      lists: [...doc.querySelectorAll('.lmd-fx-doc')].map((s) => [...s.querySelectorAll('section.footnotes li')].map((li) => li.id + '=' + li.textContent.replace(/\s*↩.*/, '').trim())),
      refs: [...doc.querySelectorAll('sup.footnote-ref a')].map((a) => a.closest('.lmd-fx-doc').id + ' ' + a.textContent + ' ' + a.getAttribute('href') + ' ' + a.id),
      back: [...doc.querySelectorAll('.footnote-backref')].map((a) => a.getAttribute('href')),
    }));
    check('las notas al pie no chocan: cada documento conserva las suyas y su propia numeración', J(notes.lists[1]) === J(['d2-fn1=Nota uno de la intro.', 'd2-fn2=Nota b de la intro.']) && J(notes.lists[2]) === J(['d3-fn1=Nota uno del capítulo dos.']) &&
      J(notes.refs) === J(['d2 [1] #d2-fn1 d2-fnref1', 'd2 [2] #d2-fn2 d2-fnref2', 'd3 [1] #d3-fn1 d3-fnref1']) && J(notes.back) === J(['#d2-fnref1', '#d2-fnref2', '#d3-fnref1']), notes);
    const rest = await dom(r, (doc) => ({ imgs: [...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')), front: [...doc.querySelectorAll('#d2 .lmd-front dt')].map((d) => d.textContent), hr: doc.querySelectorAll('#d4 hr').length, plain: (doc.querySelector('#d5 .lmd-plain') || {}).textContent, code: !!doc.querySelector('#d3 pre code'), ui: doc.querySelectorAll('.lmd-code-copy, .lmd-anchor, [contenteditable]').length }));
    check('las imágenes con ruta relativa quedan con su ruta desde la carpeta exportada', J(rest.imgs) === J(['partes/dot.png', 'img/dot.png']), rest.imgs);
    check('la cabecera de la nota viaja como al exportarla sola, sin los ajustes de la página', J(rest.front) === J(['title', 'author']) && /\.lmd-front\{display:none\}/.test(r.data), rest.front);
    check('un --- al final de una nota no suma un corte más', rest.hr === 0, rest.hr);
    check('un .txt va como texto plano, sin leerlo como Markdown', rest.plain === 'texto plano\n<b>no es html</b>\n# no es un título\n' && rest.code && rest.ui === 0, rest.plain);
    const bare = await html({ cover: false, toc: false, deep: false, breaks: 'never', off: ['notas.txt'] });
    const b2 = await dom(bare, (doc) => [...doc.querySelectorAll('main > *')].map((n) => n.tagName.toLowerCase() + '#' + n.id + '.' + [...n.classList].filter((c) => /^lmd-fx-(break|join|cover|toc)/.test(c)).join('.')));
    check('sin portada, sin índice, sin subcarpetas, sin saltos y con un archivo excluido', bare.count === 3 && J(b2) === J(['section#d1.', 'section#d2.lmd-fx-join', 'section#d3.lmd-fx-join']), b2);
    const order = await html({ order: ['10-diez.md', '1-intro.md'], deep: false, off: ['notas.txt'] });
    check('con el orden cambiado a mano, ese orden manda y lo demás va detrás', J(await dom(order, (doc) => [...doc.querySelectorAll('.lmd-fx-doc')].map((s) => s.dataset.rel))) === J(['10-diez.md', '1-intro.md', '2-uno.md']));
    const none = await html({ off: Object.keys(LIBRO), deep: true });
    check('sin nada que exportar lo dice en vez de armar un archivo vacío', none.error === 'empty', none);
  }

  if (part('formats')) {
    // ---- Un solo Markdown ----
    const md = await page.evaluate(async (d) => LMD.folderexport.markdown(d, { title: 'El libro', deep: true }), dir);
    check('Markdown único: los textos uno detrás de otro, con el título arriba y un separador entre documentos', md.name === 'El libro.md' && md.count === 5 && md.data.startsWith('# El libro\n\n# Parte tres') && md.data.split('\n---\n').length === 5 && !/^title: /m.test(md.data), md.data.slice(0, 120));
    check('ahí las notas al pie llevan el prefijo de su documento y las imágenes, su ruta desde la carpeta', /otra\[\^d2-b\]/.test(md.data) && /^\[\^d2-1\]: Nota uno de la intro\.$/m.test(md.data) && /^\[\^d3-1\]: Nota uno del capítulo dos\.$/m.test(md.data) && /!\[otro punto\]\(partes\/dot\.png\)/.test(md.data) && /!\[punto\]\(img\/dot\.png\)/.test(md.data), md.data.match(/\[\^[^\]]+\]/g));
    // ---- Word ----
    const dx = await page.evaluate(async (d) => {
      try {
        const r = await LMD.folderexport.docx(d, { title: 'El libro' }); const u8 = r.data;
        return { name: r.name, count: r.count, size: u8.length, zip: u8[0] === 80 && u8[1] === 75, bytes: Array.from(u8), staged: document.querySelectorAll('.lmd-fx-stage').length };
      } catch (e) { return { error: String((e && e.code) || e) }; }
    }, dir);
    let xml = '';
    if (!dx.error) {
      // El .docx es un zip: se abre acá para leer word/document.xml.
      const zlib = await import('zlib'); const buf = Buffer.from(dx.bytes); let at = 0;
      while (at < buf.length - 30 && buf.readUInt32LE(at) === 0x04034b50) {
        const method = buf.readUInt16LE(at + 8); const csize = buf.readUInt32LE(at + 18); const nlen = buf.readUInt16LE(at + 26); const xlen = buf.readUInt16LE(at + 28);
        const name = buf.slice(at + 30, at + 30 + nlen).toString('utf8'); const data = buf.slice(at + 30 + nlen + xlen, at + 30 + nlen + xlen + csize);
        if (name === 'word/document.xml') xml = (method ? zlib.inflateRawSync(data) : data).toString('utf8');
        at += 30 + nlen + xlen + csize;
      }
    }
    const breaks = (xml.match(/<w:br w:type="page"\/>/g) || []).length;
    check('Word: un solo .docx, con un salto de página real antes del índice y de cada documento', !dx.error && dx.zip && dx.name === 'El libro.docx' && dx.count === 5 && breaks === 6 && dx.staged === 0, [dx.error, dx.name, dx.count, breaks]);
    check('en Word los enlaces entre notas van a su título, y las imágenes de cada carpeta entran', /<w:hyperlink w:anchor="lmd_\d+"/.test(xml) && (xml.match(/<w:drawing>/g) || []).length === 2 && /El libro/.test(xml) && /Capítulo diez/.test(xml), (xml.match(/<w:drawing>/g) || []).length);
    const dn = await page.evaluate(async (d) => { const r = await LMD.folderexport.docx(d, { breaks: 'never', cover: false, toc: false }); return Array.from(r.data).length; }, dir);
    check('con "Nunca", el Word sale sin saltos entre documentos', dn > 1000 && dn < dx.size + 200);
  }
  await D.close();
}

// ====================================================================================================
// El paginado, medido sobre el PDF de verdad
// ====================================================================================================
if (part('pdf')) {
  seq = 0;
  const head = (n) => '## HEAD' + n + ' título';
  // Un documento largo con de todo, para que los cortes de página caigan en todos lados.
  const mix = (from, blocks) => Array.from({ length: blocks }, (_, i) => {
    const k = from + i; const out = [head(k), para(55 + (k * 37) % 90), para(28)];
    if (k % 2 === 0) out.push(Array.from({ length: 5 }, (_, j) => '- ' + text('li' + (++seq), 9 + ((k + j) * 13) % 38)).join('\n'));
    if (k % 3 === 0) out.push('> ' + text('bq' + (++seq), 62));
    if (k % 4 === 1) out.push('> [!NOTE]\n> ' + text('al' + (++seq), 58));
    if (k % 5 === 2) out.push('```js\n' + Array.from({ length: 11 }, (_, j) => 'const v' + j + ' = "ca' + (seq + 1) + '";').join('\n') + '\n```'), seq++;
    out.push(head(k + 500), para(40 + (k * 53) % 70));
    return out.join('\n\n');
  }).join('\n\n');
  const table = '| COLA | COLB | COLC |\n| --- | --- | --- |\n' + Array.from({ length: 95 }, (_, i) => '| fila' + (i + 1) + ' | dato ' + i + ' | más ' + i + ' |').join('\n');
  const longCode = '```\n' + Array.from({ length: 88 }, (_, j) => 'linea ' + j + ' cb9001 de un bloque largo').join('\n') + '\n```';
  const FEOS = {
    '01-largo.md': '# DOCTITLE1 largo\n\n' + mix(1, 14),
    '02-una-linea.md': 'Una sola línea suelta, sin título.\n',
    '03-vacio.md': '',
    '04-tabla.md': '# DOCTITLE4 tabla\n\n' + para(30) + '\n\n' + table + '\n\n' + para(40),
    '05-codigo.md': '# DOCTITLE5 código\n\n' + para(90) + '\n\n' + longCode + '\n\n' + para(60),
    '06-final.md': '# DOCTITLE6 final\n\n' + mix(40, 5) + '\n\nÚltimo renglón.\n\n---\n',
    '07-otro.md': '# DOCTITLE7 otro\n\n' + mix(60, 6),
  };
  const D = await disk(under('feos', FEOS));
  const { page, base } = D; const dir = base + 'feos/';
  // Sin las reglas de paginado, la misma carpeta sí sale mal: así se sabe que la prueba mira algo.
  const OFF = '.lmd-fx-print, .lmd-fx-print * { orphans: 1 !important; widows: 1 !important; break-after: auto !important; break-inside: auto !important; } .lmd-fx-print :not(.lmd-fx-break) { break-before: auto !important; }';
  const ctl = await pdfOf(page, dir, { breaks: 'always', cover: false, toc: false, paper: 'a4' }, OFF);
  const bad = audit(ctl.pages);
  keep('feos-sin-reglas.pdf', ctl.buf);
  check('control: sin las reglas, esta carpeta deja renglones sueltos, títulos al pie y bloques partidos', bad.orphans.length > 0 && bad.foot.length > 0 && bad.split.length > 0, { orphans: bad.orphans.length, foot: bad.foot.length, split: bad.split.length, pages: ctl.pages.length });
  console.log('    sin reglas: ' + ctl.pages.length + ' páginas, ' + bad.orphans.length + ' párrafos con renglones sueltos, ' + bad.foot.length + ' títulos al pie, ' + bad.split.length + ' bloques partidos');

  for (const mode of ['always', 'half', 'three', 'never']) {
    const x = await pdfOf(page, dir, { breaks: mode, cover: mode === 'half', toc: mode === 'half', paper: 'a4', title: 'Casos feos' });
    keep('feos-' + mode + '.pdf', x.buf);
    if (x.r.error) { check('PDF (' + mode + '): se arma', false, x.r); continue; }
    const lead = mode === 'half' ? 2 : 0; // la portada y el índice no son texto de los documentos
    const v = audit(x.pages.slice(lead)); const n = x.pages.length;
    console.log('    ' + mode + ': ' + n + ' páginas · renglones sueltos ' + v.orphans.length + ' · títulos al pie ' + v.foot.length + ' · bloques partidos ' + v.split.length + ' · páginas en blanco ' + v.blank.length + ' · con menos de tres renglones ' + v.thin.length);
    check('PDF (' + mode + '): ninguna página empieza o termina con uno o dos renglones sueltos de un párrafo, una lista o un código largo', !v.orphans.length, v.orphans);
    check('PDF (' + mode + '): ningún título queda al pie de una página', !v.foot.length, v.foot);
    check('PDF (' + mode + '): citas, avisos y código corto no se parten', !v.split.length && x.dom.keep >= 3, [v.split, x.dom.keep]);
    check('PDF (' + mode + '): la tabla larga repite su encabezado en cada página', !v.tableHead.length && x.pages.filter((p) => p.lines.some((l) => /\bfila\d+\b/.test(l.text))).length >= 3, v.tableHead);
    check('PDF (' + mode + '): no hay páginas en blanco', !v.blank.length, v.blank);
    check('PDF (' + mode + '): la cantidad de páginas es la que se calculó', n === x.r.plan.pages, [n, x.r.plan.pages]);
    check('PDF (' + mode + '): la nota vacía no genera página, y el --- del final de un documento se saca', J(x.r.blank) === J(['03-vacio.md']) && x.dom.secs.length === 6 && !x.dom.secs.some((s) => /vacio/.test(s)), [x.r.blank, x.dom.secs]);
    if (mode === 'half' || mode === 'three' || mode === 'never') check('PDF (' + mode + '): ninguna página queda con menos de tres renglones', !v.thin.length, v.thin);
    if (mode === 'always') {
      const starts = x.pages.map((p, i) => (/DOCTITLE(\d)/.exec((p.lines[0] || {}).text || '') || [])[1]).filter(Boolean);
      check('PDF (siempre): cada documento con título empieza arriba de una página nueva', J(starts) === J(['1', '4', '5', '6', '7']) && x.dom.secs.slice(1).every((s) => /:salta$/.test(s)), [starts, x.dom.secs]);
      check('los números de página van abajo, por CSS, en hoja A4', x.pages.every((p, i) => p.number === i + 1) && Math.abs(x.pages[0].w - 595.3) < 1 && Math.abs(x.pages[0].h - 841.9) < 1 && /size: A4; margin: 18mm 17mm 20mm/.test(x.dom.rule), [x.pages.map((p) => p.number).slice(0, 4), x.pages[0].w, x.pages[0].h, x.dom.rule]);
    }
    if (mode === 'half') {
      check('PDF (mitad): la portada va sola en la primera página, sin número, y el índice en la segunda', x.pages[0].lines.length === 1 && x.pages[0].lines[0].text === 'Casos feos' && x.pages[0].number === null && /Índice/.test(x.pages[1].lines[0].text) && x.pages[1].number === 2 && /DOCTITLE1/.test(x.pages[2].lines[0].text), [x.pages[0].lines, x.pages[1].lines.slice(0, 3)]);
      const joined = x.dom.secs.filter((s) => /:sigue$/.test(s));
      check('PDF (mitad): hay documentos que siguen en la misma página y otros que saltan', joined.length >= 1 && x.dom.secs.filter((s) => /:salta$/.test(s)).length >= 2, x.dom.secs);
    }
  }
  const letter = await pdfOf(page, dir, { breaks: 'never', cover: false, toc: false, paper: 'letter', numbers: false, off: ['01-largo.md', '06-final.md', '07-otro.md'] });
  check('hoja Carta y sin números: el PDF sale de ese tamaño y sin pie', Math.abs(letter.pages[0].w - 612) < 1 && Math.abs(letter.pages[0].h - 792) < 1 && letter.pages.every((p) => p.number === null) && !/bottom-center/.test(letter.dom.rule), [letter.pages[0].w, letter.pages[0].h]);

  // ---- La impresión de una nota sola usa la misma hoja ----
  await page.click('.lmd-node-dir[data-url="' + dir + '"]'); await page.waitForSelector('.lmd-node[data-url="' + dir + '01-largo.md"]');
  await page.click('.lmd-node[data-url="' + dir + '01-largo.md"]'); await page.waitForFunction(() => /DOCTITLE1/.test((document.querySelector('.lmd-article h1') || {}).textContent || '')); await sleep(400);
  const solo = await readPdf(await page.pdf({ format: 'A4', margin: { top: '18mm', bottom: '20mm', left: '17mm', right: '17mm' } }));
  const sv = audit(solo);
  console.log('    una nota sola: ' + solo.length + ' páginas · renglones sueltos ' + sv.orphans.length + ' · títulos al pie ' + sv.foot.length + ' · bloques partidos ' + sv.split.length);
  check('una nota sola, impresa: sin renglones sueltos, sin títulos al pie y sin partir citas, avisos ni código corto', solo.length > 5 && !sv.orphans.length && !sv.foot.length && !sv.split.length && !sv.blank.length, sv);
  await D.close();
}

// ====================================================================================================
// El salto entre documentos por umbral, contra el PDF de verdad
// ====================================================================================================
if (part('breaks')) {
  seq = 0;
  // Documentos armados para terminar al 10 %, al 45 %, al 60 % y al 90 % de la página (hoja A4).
  const A = '# DOCTITLE1 a\n\n' + one(1);
  const B = '# DOCTITLE2 b\n\n' + one(5);
  const C = '# DOCTITLE3 c\n\n' + one(23);
  const E = '# DOCTITLE5 e\n\n' + one(3);
  const D = await disk(Object.assign(
    under('mitad', { '1-a.md': A, '2-b.md': B, '3-c.md': C, '4-d.md': '# DOCTITLE4 d\n\n' + one(20), '5-e.md': E }),
    under('trescuartos', { '1-a.md': A, '2-b.md': B, '3-c.md': C, '4-d.md': '# DOCTITLE4 d\n\n' + one(4), '5-e.md': E }),
    under('diez', Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1).padStart(2, '0') + '-capitulo.md', '# Capítulo ' + (i + 1) + ': ' + ['El taller', 'Las cuentas', 'La feria', 'El depósito', 'Los turnos', 'La caja', 'El reparto', 'Las compras', 'El cierre', 'Lo que sigue'][i] + '\n\n' +
      paras(3 + (i * 5) % 9, (j) => 45 + ((i + j) * 31) % 110).replace(/\bq\d+/g, '') + '\n\n## Para llevar\n\n- ' + ['Anotar cada pedido', 'Revisar el stock los lunes', 'Cerrar la caja antes de las siete'].join('\n- ') + '\n\n' + paras(1 + (i * 3) % 4, 70).replace(/\bq\d+/g, '') + '\n'])))));
  const { page, base } = D;
  // Dónde cae cada documento en el PDF: la página de su título y hasta dónde quedó llena la página donde termina.
  const H = 259 * MM; const TOP = 18 * MM;
  const where = (pages, re) => {
    const out = {}; re = re || /DOCTITLE(\d)/;
    pages.forEach((p, i) => p.lines.forEach((l, j) => { const m = re.exec(l.text); if (m) out[m[1]] = { page: i, at: (p.h - l.y - TOP) / H }; }));
    // El final de un documento: el último renglón antes del título siguiente (o el último de todo).
    const flat = pages.flatMap((p, i) => p.lines.map((l) => ({ page: i, at: (p.h - l.y - TOP) / H, title: (re.exec(l.text) || [])[1] || '' })));
    let cur = '';
    flat.forEach((l, k) => { if (l.title) cur = l.title; const next = flat[k + 1]; if (cur && (!next || next.title)) { out[cur].endPage = l.page; out[cur].end = l.at; } });
    return out;
  };
  const run = async (folder, mode) => {
    const x = await pdfOf(page, base + folder + '/', { breaks: mode, cover: false, toc: false, paper: 'a4' });
    keep('umbral-' + folder + '-' + mode + '.pdf', x.buf);
    return Object.assign(x, { at: where(x.pages), v: audit(x.pages) });
  };
  // El cálculo de la app (hoja escondida) contra lo que imprimió Chromium, en píxeles de la hoja.
  const PX = 259 * 96 / 25.4;
  const drift = (x) => {
    const base0 = x.at['1'].at - x.r.plan.docs[0].top; const end0 = x.r.plan.docs[0].fill - x.at['1'].end; // de la caja al renglón: lo fija el primer documento
    return x.r.plan.docs.map((d, i) => {
      // Un documento que sigue en la misma página empieza con su línea fina y 2,6 em de aire antes del título.
      const a = x.at[String(i + 1)]; const sep = d.jump || !i ? 0 : 42.6 / PX;
      return { page: d.page === a.page && d.endPage === a.endPage, top: Math.round(Math.abs((d.top + sep + base0) - a.at) * PX * 10) / 10, end: Math.round(Math.abs((d.fill - end0) - a.end) * PX * 10) / 10 };
    });
  };
  const pct = (x) => x.r.plan.docs.map((d) => Math.round(d.fill * 100));

  const half = await run('mitad', 'half');
  const fills = pct(half);
  console.log('    mitad: páginas ' + half.pages.length + ' · llenado calculado ' + J(fills) + ' % · en el PDF ' + J(Object.values(half.at).map((a) => Math.round((a.end + 0.012) * 100))) + ' % · saltos ' + J(half.dom.secs));
  check('la carpeta de prueba termina sus documentos cerca del 10 %, 45 %, 60 % y 90 % de la página', Math.abs(fills[0] - 10) <= 4 && Math.abs(fills[1] - 45) <= 4 && Math.abs(fills[2] - 60) <= 5 && Math.abs(fills[3] - 90) <= 5, fills);
  check('umbral en la mitad: saltan solo los dos últimos (los que siguen a una página llena al 60 % y al 90 %)', J(half.dom.secs) === J(['1-a.md', '2-b.md:sigue', '3-c.md:sigue', '4-d.md:salta', '5-e.md:salta']), half.dom.secs);
  check('y el PDF lo confirma: a, b y c comparten página, d y e empiezan arriba de una nueva', half.at['1'].page === 0 && half.at['2'].page === 0 && half.at['3'].page === 0 && half.at['4'].page === 2 && half.at['4'].at < 0.06 && half.at['5'].page === 3 && half.at['5'].at < 0.06 && half.pages.length === 4, half.at);
  const three = await run('trescuartos', 'three');
  const f3 = pct(three);
  console.log('    tres cuartos: páginas ' + three.pages.length + ' · llenado calculado ' + J(f3) + ' % · saltos ' + J(three.dom.secs));
  check('umbral en tres cuartos: salta solo el último (el que sigue a una página llena al 90 %)', Math.abs(f3[2] - 60) <= 5 && Math.abs(f3[3] - 90) <= 5 && J(three.dom.secs) === J(['1-a.md', '2-b.md:sigue', '3-c.md:sigue', '4-d.md:sigue', '5-e.md:salta']), [f3, three.dom.secs]);
  check('y el PDF lo confirma: d sigue en la página de c y e empieza arriba de una nueva', three.at['4'].page === three.at['3'].endPage && three.at['4'].at > 0.6 && three.at['5'].page === 2 && three.at['5'].at < 0.06 && three.pages.length === 3, three.at);
  const cross = await run('mitad', 'three');
  check('la misma carpeta con el otro umbral: lo que quedó al 60 % ya no hace saltar', cross.dom.secs[3] === '4-d.md:sigue', cross.dom.secs);
  const always = await run('mitad', 'always'); const never = await run('mitad', 'never');
  check('"Siempre" salta en todos y "Nunca" en ninguno', always.pages.length === 6 && always.dom.secs.slice(1).every((s) => /:salta$/.test(s)) && never.dom.secs.slice(1).every((s) => /:sigue$/.test(s)) && never.pages.length === 3, [always.pages.length, never.pages.length]);
  const sepOk = await page.evaluate(async (d) => { await LMD.folderexport.stagePdf(d, { breaks: 'never', cover: false, toc: false, paper: 'a4' }); const s = getComputedStyle(document.querySelector('.lmd-fx-join')); const o = { top: parseFloat(s.borderTopWidth), style: s.borderTopStyle, gap: parseFloat(s.marginTop) + parseFloat(s.paddingTop) }; LMD.folderexport.unstage(); return o; }, base + 'mitad/');
  check('el documento que no salta queda separado por aire y una línea fina', sepOk.top === 1 && sepOk.style === 'solid' && sepOk.gap > 60, sepOk);
  for (const [name, x] of [['mitad', half], ['tres cuartos', three], ['otro umbral', cross], ['nunca', never]]) {
    check('umbral (' + name + '): ninguna página con menos de tres renglones, ni en blanco, ni con un título al pie', !x.v.thin.length && !x.v.blank.length && !x.v.foot.length, x.v);
  }
  const all = [half, three, cross, always, never].map(drift);
  const worst = all.flat().reduce((m, d) => ({ top: Math.max(m.top, d.top), end: Math.max(m.end, d.end) }), { top: 0, end: 0 });
  console.log('    desvío del cálculo contra el PDF: hasta ' + worst.top + ' px donde empieza un documento y ' + worst.end + ' px donde termina (la hoja útil mide ' + Math.round(PX) + ' px de alto)');
  check('el cálculo de la app coincide con el PDF: misma página para cada documento y menos de 1 % de la hoja de diferencia', all.flat().every((d) => d.page) && worst.top < PX * 0.01 && worst.end < PX * 0.01, [worst, all[0]]);

  // ---- Diez documentos inventados, de ejemplo ----
  const ten = await pdfOf(page, base + 'diez/', { breaks: 'half', title: 'Manual del taller', paper: 'a4' });
  const tv = audit(ten.pages);
  keep('ejemplo-diez-documentos.pdf', ten.buf);
  ten.at = where(ten.pages.map((p, i) => (i < 2 ? Object.assign({}, p, { lines: [] }) : p)), /^Capítulo (\d+):/);
  const td = drift(ten); const tw = td.reduce((m, d) => ({ top: Math.max(m.top, d.top), end: Math.max(m.end, d.end) }), { top: 0, end: 0 });
  console.log('    diez documentos, cálculo contra PDF: hasta ' + tw.top + ' px al empezar y ' + tw.end + ' px al terminar · en el PDF terminan al ' + J(Object.keys(ten.at).map((k) => Math.round((ten.at[k].end + 0.012) * 100))) + ' %');
  check('con párrafos de varios renglones el cálculo también coincide con el PDF: misma página y menos de 1 % de la hoja', td.every((d) => d.page) && tw.top < PX * 0.01 && tw.end < PX * 0.01, [tw, td]);
  console.log('    diez documentos: ' + ten.pages.length + ' páginas · saltan ' + ten.dom.secs.filter((s) => /:salta$/.test(s)).length + ' de 10 · llenado ' + J(pct(ten)) + ' %');
  check('diez documentos: portada, índice con los diez títulos, y un paginado sin páginas casi vacías', ten.r.count === 10 && ten.pages[0].lines[0].text === 'Manual del taller' && ten.pages[1].lines.filter((l) => /^Capítulo \d+:/.test(l.text)).length === 10 && !tv.blank.length && !tv.foot.length && ten.pages.length === ten.r.plan.pages &&
    ten.pages.slice(2, -1).every((p) => p.lines.length >= 3), [ten.pages.length, ten.r.plan.pages, tv]);
  check('en ese libro ningún documento arranca en página nueva dejando la anterior por debajo de la mitad', ten.r.plan.docs.every((d, i) => !i || !d.jump || ten.r.plan.docs[i - 1].fill >= 0.5), pct(ten));
  await D.close();
}

// ====================================================================================================
// "En este navegador" y la nube
// ====================================================================================================
if (part('places')) {
  const who = await R.signup('ema@ejemplo.test', true);
  const put = (p, t) => R.api('PUT', '/notes/' + encodeURIComponent(p), { text: t }, who.s);
  await put('manual/1-uno.md', '# Uno\n\nVa al [dos](2-dos.md#final) y al [diez](10-diez.md).\n');
  await put('manual/2-dos.md', '# Dos\n\n## Final\n\nListo.\n');
  await put('manual/10-diez.md', '# Diez\n\nÚltimo.\n');
  await put('manual/anexos/a.md', '# Anexo\n\nAparte.\n');
  await put('suelta.md', '# Suelta\n\nFuera de la carpeta.\n');
  const { ctx, page } = await R.open(who, { locale: 'es-AR', colorScheme: 'light' });
  await page.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('mdtools:settings') || '{}'); if (!s.language) { s.language = 'es'; localStorage.setItem('mdtools:settings', JSON.stringify(s)); } } catch (e) { /* sin almacenamiento */ } });
  await page.goto(R.noteUrl('manual/1-uno.md')); await page.waitForSelector('.markdown-body h1'); await sleep(500);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.waitForSelector('.lmd-node-dir');
  const cdir = await page.evaluate(() => LMD.extras.folderExport('').then(() => [...document.querySelectorAll('.lmd-node-dir')].map((n) => n.dataset.url).find((u) => /cloud\/manual\/$/.test(u))));
  check('la nube: la carpeta está en el explorador', !!cdir, cdir);
  await page.click('.lmd-node-dir[data-url="' + cdir + '"]', { button: 'right' });
  check('la carpeta de la nube ofrece exportarla', (await page.locator('.lmd-menu [data-f=fexp]').count()) === 1);
  await page.click('.lmd-menu [data-f=fexp]'); await page.waitForSelector('.lmd-fx');
  check('la lista de la nube: orden natural, con su subcarpeta', J(await listed(page)) === J(['anexos/a.md', '1-uno.md', '2-dos.md', '10-diez.md']), await listed(page));
  await page.click('.lmd-fx [data-fx-do=no]');
  const cr = await page.evaluate(async (d) => { try { const r = await LMD.folderexport.html(d, { toc: false, cover: false }); const doc = new DOMParser().parseFromString(r.data, 'text/html'); return { count: r.count, failed: r.failed, order: [...doc.querySelectorAll('.lmd-fx-doc')].map((s) => s.dataset.rel), links: [...doc.querySelectorAll('#d2 a')].map((a) => a.getAttribute('href')), sealed: /vault1:/.test(r.data), out: /Suelta/.test(r.data) }; } catch (e) { return { error: String((e && e.code) || e) }; } }, cdir);
  check('la nube: un solo documento con sus notas en orden y los enlaces entre ellas hechos internos', !cr.error && cr.count === 4 && J(cr.order) === J(['anexos/a.md', '1-uno.md', '2-dos.md', '10-diez.md']) && J(cr.links) === J(['#d3-final', '#d4']) && !cr.out, cr);
  const cp = await pdfOf(page, cdir, { paper: 'a4', breaks: 'half', cover: false, toc: false });
  if (process.env.DEBUG_FX) console.log(J(cp.pages.map((p) => p.lines.map((l) => l.text))), J(cp.r.plan));
  check('la nube también sale en PDF: tres notas comparten la primera página y, pasada la mitad, la cuarta salta', !cp.r.error && cp.pages.length === 2 && J(cp.pages[0].lines.map((l) => l.text).filter((t) => /^(Anexo|Uno|Dos)$/.test(t))) === J(['Anexo', 'Uno', 'Dos']) && cp.pages[1].lines[0].text === 'Diez', [cp.r.error, cp.pages.map((p) => p.lines.map((l) => l.text))]);
  // Una carpeta protegida y bloqueada: se pide desbloquear, y si no, no sale nada.
  const locked = await page.evaluate(async (d) => {
    const real = LMD.vault.unlockFor; let asked = '';
    LMD.vault.unlockFor = async (p) => { asked = p; return false; };
    try { const opened = await LMD.folderexport.open; let err = ''; try { await LMD.folderexport.html(d, {}); } catch (e) { err = e.code; } const ui = await LMD.extras.folderExport(d); await new Promise((r) => setTimeout(r, 200)); return { asked, err, ui, dlg: !!document.querySelector('.lmd-fx'), said: document.body.textContent.includes('La carpeta sigue bloqueada: no se exporta.'), opened: !!opened }; }
    finally { LMD.vault.unlockFor = real; }
  }, cdir);
  check('una carpeta protegida que sigue bloqueada: pide desbloquear y, si no, avisa y no exporta', locked.asked === 'manual/x' && locked.err === 'locked' && locked.ui === false && !locked.dlg && locked.said, locked);

  // ---- En este navegador ----
  await page.evaluate(async () => { await LMD.store.notePut('2-segunda.md', '# Segunda\n\nVa a la [primera](1-primera.md).\n'); await LMD.store.notePut('1-primera.md', '# Primera\n\nTexto.\n'); await LMD.store.notePut('10-decima.md', '# Décima\n\nFin.\n'); });
  await page.goto(R.home + '?f=' + encodeURIComponent('local/1-primera.md')); await page.waitForSelector('.markdown-body h1'); await sleep(300);
  await page.click('[data-act=export]'); await page.waitForSelector('.lmd-menu-export');
  check('con una nota de "En este navegador" abierta, Exportar ofrece toda la carpeta', (await page.locator('.lmd-menu-export [data-more=export-folder]').count()) === 1);
  await page.click('.lmd-menu-export [data-more=export-folder]'); await page.waitForSelector('.lmd-fx');
  const ll = await listed(page); const lt = await page.inputValue('.lmd-fx [data-fx=title]');
  check('ahí entran las notas del navegador, en orden natural', J(ll) === J(['1-primera.md', '2-segunda.md', '10-decima.md']) && lt === 'Notes' || lt === 'Notas', [ll, lt]);
  await page.selectOption('.lmd-fx [data-fx=format]', 'md');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lmd-fx [data-fx-do=go]')]);
  const file = path.join(os.tmpdir(), 'fxl-' + Date.now() + '.md'); await dl.saveAs(file); const got = fs.readFileSync(file, 'utf8'); fs.rmSync(file, { force: true });
  check('y salen en un solo archivo', /\.md$/.test(dl.suggestedFilename()) && got.indexOf('# Primera') < got.indexOf('# Segunda') && got.indexOf('# Segunda') < got.indexOf('# Décima'), got.slice(0, 80));
  const lr = await page.evaluate(async () => { const r = await LMD.folderexport.html('https://lmd.local/local/', { cover: false, toc: false }); return new DOMParser().parseFromString(r.data, 'text/html').querySelector('#d2 a').getAttribute('href'); });
  check('con sus enlaces internos', lr === '#d1', lr);
  // Un texto que quedó cifrado (el de una carpeta protegida que no se abrió) nunca viaja a lo exportado.
  const sealed = await page.evaluate(async () => { await LMD.store.notePut('3-cifrada.md', 'vault1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'); const r = await LMD.folderexport.html('https://lmd.local/local/', {}); const m = await LMD.folderexport.markdown('https://lmd.local/local/', {}); return { failed: r.failed, count: r.count, leak: /vault1:/.test(r.data) || /vault1:/.test(m.data), md: m.failed }; });
  check('un texto que sigue cifrado no se exporta: se informa como no leído y el resto sale igual', J(sealed.failed) === J(['3-cifrada.md']) && J(sealed.md) === J(['3-cifrada.md']) && sealed.count === 3 && !sealed.leak, sealed);
  await ctx.close();
}

// ====================================================================================================
// Teléfono
// ====================================================================================================
if (part('phone')) {
  const D = await disk(under('libro', LIBRO), { ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } });
  const { page, base } = D;
  await page.evaluate(() => LMD.store.notePut('1-primera.md', '# Primera\n\nTexto.\n'));
  await page.goto(R.home + '?f=' + encodeURIComponent('local/1-primera.md')); await page.waitForSelector('.markdown-body h1'); await sleep(300);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('.lmd-more'); await page.click('.lmd-menu-more [data-more=export]'); await page.waitForSelector('.lmd-menu-export');
  const em = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export button')].map((b) => b.dataset.more));
  check('teléfono: donde se exporta una nota, también está "Toda la carpeta…"', em.includes('export-pdf') && em.includes('export-folder'), em);
  await page.click('.lmd-menu-export [data-more=export-folder]'); await page.waitForSelector('.lmd-fx');
  const fit = await page.evaluate(() => {
    const c = document.querySelector('.lmd-fx-card').getBoundingClientRect(); const go = document.querySelector('.lmd-fx [data-fx-do=go]').getBoundingClientRect(); const mv = document.querySelector('.lmd-fx-move');
    return { w: innerWidth, h: innerHeight, left: c.left, right: c.right, top: c.top, bottom: c.bottom, go: go.bottom, scroll: document.documentElement.scrollWidth, move: mv ? getComputedStyle(mv).opacity + ':' + mv.getBoundingClientRect().width : '', cols: getComputedStyle(document.querySelector('.lmd-fx-grid')).gridTemplateColumns.split(' ').length };
  });
  check('teléfono: el diálogo entra en la pantalla, con el botón de exportar a la vista y los campos en una columna', fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h && fit.go <= fit.h && fit.scroll <= fit.w && fit.cols === 1, fit);
  await page.click('.lmd-fx [data-fx-do=no]');
  // Con muchas notas la lista se desliza dentro del diálogo.
  await page.evaluate(async () => { for (let i = 2; i <= 40; i++) await LMD.store.notePut(i + '-nota.md', '# Nota ' + i + '\n\nTexto.\n'); });
  await page.evaluate(() => LMD.extras.folderExport('https://lmd.local/local/')); await page.waitForSelector('.lmd-fx');
  const many = await page.evaluate(() => { const c = document.querySelector('.lmd-fx-card').getBoundingClientRect(); const l = document.querySelector('.lmd-fx-list'); const mv = document.querySelector('.lmd-fx-move'); return { bottom: c.bottom, top: c.top, h: innerHeight, n: l.children.length, scrolls: l.scrollHeight > l.clientHeight, move: getComputedStyle(mv).opacity, size: mv.getBoundingClientRect().width }; });
  check('teléfono: con cuarenta notas el diálogo sigue entrando y la lista se desliza adentro', many.n === 40 && many.top >= 0 && many.bottom <= many.h && many.scrolls, many);
  check('teléfono: las flechas para reordenar están a la vista y se pueden tocar', many.move === '1' && many.size >= 32, many);
  await page.click('.lmd-fx [data-fx-do=go]'); await page.waitForFunction(() => window.__printed === 1, null, { timeout: 30000 });
  check('teléfono: el PDF de las cuarenta notas se arma y sale por la impresión', await page.evaluate(() => document.querySelectorAll('.lmd-fx-stage .lmd-fx-doc').length === 40 && document.documentElement.classList.contains('lmd-fx-printing')));
  await D.close();
}

check('sin errores de página y sin pedidos a la nube de verdad', !R.errors.length && !R.outside.length, [R.errors.slice(0, 3), R.outside.slice(0, 3)]);
await R.close();
process.exit(done() ? 1 : 0);
