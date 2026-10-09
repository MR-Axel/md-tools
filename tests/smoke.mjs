// Prueba de punta a punta: carga la extensión en un Chromium y recorre los dos modos,
// el .md abierto directo en el navegador y la página propia con una carpeta elegida.
// Uso: npm install && npm test   (CHROME_BIN apunta a otro Chromium si hace falta)
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = pathToFileURL(path.join(root, 'examples', 'sample.md')).href;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR',
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'],
});
try {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const errors = [];
  const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));

  // El acceso a file:// se da desde la página de extensiones, como lo haría una persona.
  const admin = await ctx.newPage();
  await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
  await admin.evaluate(async () => { for (const e of await chrome.developerPrivate.getExtensionsInfo()) await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: e.id, fileAccess: true }); });
  await admin.close();

  console.log('Archivo abierto en el navegador');
  const page = await ctx.newPage(); watch(page);
  await page.goto(sample); await page.waitForSelector('.markdown-body h1', { timeout: 15000 }); await page.waitForTimeout(4000);
  const doc = await page.evaluate(() => ({
    title: document.title, h2: document.querySelectorAll('.markdown-body h2').length, diagrams: document.querySelectorAll('.lmd-diagram > svg').length,
    katex: !!document.querySelector('.katex'), outline: document.querySelectorAll('.lmd-pane-outline a').length, xss: document.title === 'XSS',
    wiki: [...document.querySelectorAll('a.lmd-wiki')].map((a) => (a.getAttribute('href') || '').split('/').pop()),
  }));
  check('renderiza el documento', doc.title === 'sample.md' && doc.h2 >= 8, doc);
  check('matemática y diagramas', doc.katex && doc.diagrams === 2, doc);
  check('índice lateral', doc.outline >= 8, doc.outline);
  const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.lmd-article')).paddingTop));
  check('el documento tiene aire arriba (la hoja de estilos se lee entera)', pad >= 20, pad);
  check('links [[wiki]] resueltos', doc.wiki[0] === 'notes.md' && doc.wiki[2] === '', doc.wiki);
  check('el HTML del documento no ejecuta scripts', !doc.xss);

  await page.waitForSelector('.lmd-node');
  const tree = await page.evaluate(() => [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim() + (n.classList.contains('lmd-active') ? '*' : '')));
  check('árbol de la carpeta', tree.includes('sample.md*') && tree.includes('sub'), tree);
  // El ejemplo vive dentro del repositorio: el árbol arranca en su raíz (donde está .git), con examples desplegada.
  const repo = await page.evaluate(() => ({ head: document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-path').textContent, top: [...document.querySelectorAll('.lmd-xroot > .lmd-tree > .lmd-node')].map((n) => n.textContent.trim()), open: [...document.querySelectorAll('.lmd-node-dir.lmd-open')].map((n) => n.textContent.trim()), where: document.querySelector('.lmd-node.lmd-active .lmd-node-where').title }));
  check('sobre un archivo del disco el árbol sube hasta la raíz del repositorio', repo.head === path.basename(root) && repo.top.includes('examples') && repo.top.includes('README.md') && repo.open.includes('examples') && repo.where === 'En el disco', repo);
  await page.fill('.lmd-search input', 'SharpMD'); await page.waitForSelector('.lmd-results-sum');
  await page.waitForFunction(() => /\d/.test(document.querySelector('.lmd-results-sum').textContent), null, { timeout: 15000 });
  check('búsqueda en la carpeta', /coincidencia/.test(await page.textContent('.lmd-results-sum')), await page.textContent('.lmd-results-sum'));
  await page.fill('.lmd-search input', '');

  // Sobre un .md abierto directo la barra es la misma: copiar y exportar en un botón cada uno, recargar a la vista
  // (el archivo vive en el disco), y a ningún ancho se pisan dos controles.
  const barNow = () => page.evaluate(() => {
    const vis = (b) => !!b.offsetParent && b.getBoundingClientRect().width > 0;
    const box = [...document.querySelectorAll('.lmd-topbar button, .lmd-topbar .lmd-docname')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { k: b.dataset.act || 'name', l: r.left, r: r.right, t: r.top, b: r.bottom, btn: b.tagName === 'BUTTON', el: b }; });
    const bad = [];
    box.forEach((a, i) => {
      if (a.l < -0.5 || a.r > window.innerWidth + 0.5) bad.push('fuera:' + a.k);
      if (a.btn) { const hit = document.elementFromPoint((a.l + a.r) / 2, (a.t + a.b) / 2); if (!hit || !(hit === a.el || a.el.contains(hit))) bad.push('tapado:' + a.k); }
      box.slice(i + 1).forEach((c) => { if (a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5) bad.push(a.k + '/' + c.k); });
    });
    return { w: window.innerWidth, bad, acts: box.filter((x) => x.btn).map((x) => x.k) };
  });
  const full = await barNow();
  check('sobre un archivo directo la barra tiene copiar, exportar y recargar, sin los íconos sueltos de antes', ['copy', 'export', 'reload', 'settings', 'view-raw', 'mode-edit'].every((a) => full.acts.includes(a)) && !full.acts.some((a) => /^(copy-|export-|print$)/.test(a)), full);
  const widths = [];
  for (const w of [1400, 1000, 860, 760, 600, 390, 320]) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(400); widths.push(await barNow()); }
  check('y de 320 a 1400 px ningún control de la barra se pisa con otro ni queda tapado', widths.every((b) => !b.bad.length) && widths.filter((b) => b.w > 720).every((b) => ['mode-read', 'mode-edit', 'view-doc', 'view-raw'].every((a) => b.acts.includes(a))), widths.filter((b) => b.bad.length || b.w > 720).map((b) => [b.w, b.bad, b.acts.join(' ')]));
  await page.setViewportSize({ width: 1500, height: 950 }); await page.waitForTimeout(300);

  await page.click('[data-act=mode-edit]'); await page.waitForTimeout(400);
  const before = await page.evaluate(() => document.querySelectorAll('.lmd-editable').length);
  check('modo edición activa los bloques', before > 10, before);
  const para = page.locator('.lmd-article p.lmd-editable').first();
  await para.click(); await page.keyboard.press('End'); await page.keyboard.type(' Nuevo'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  await page.click('[data-act=view-raw]'); await page.waitForTimeout(300);
  const source = await page.evaluate(() => { const t = document.querySelector('.lmd-raw-edit'); return t && !t.hidden ? t.value : document.querySelector('pre.lmd-raw').textContent; });
  const changed = source.split(/\r?\n/).filter((l) => l.endsWith(' Nuevo'));
  check('la edición vuelve al Markdown sin romper el formato', changed.length === 1 && source.includes('Text **bold**, *italic*, ~~struck~~, ==marked==, ++inserted++, H~2~O, x^2^'), changed);
  await page.click('[data-act=view-doc]');

  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card');
  const sections = await page.evaluate(() => [...document.querySelectorAll('.lmd-panel h3')].map((h) => h.textContent.replace(/\s*Plan pago$/, '')));
  check('panel de ajustes', sections.join('|') === 'Apariencia|Lectura|Edición|Carpeta|Plugins de Markdown|Herramientas|Nube|Conectar una IA|API y automatizaciones|Plan|Instalar|CSS propio|Servidor|Actualizaciones', sections);
  // Cada pestaña muestra sus secciones y ninguna otra. Los títulos se leen de lo que está a la vista.
  const tabs = await page.evaluate(() => {
    const vis = () => [...document.querySelectorAll('.lmd-panel-body > section:not([hidden]) h3')].map((h) => h.firstChild.nodeValue.trim()).join('+');
    return [...document.querySelectorAll('[data-ptab]')].map((b) => { b.click(); return b.dataset.ptab + ':' + b.textContent.trim() + '=' + vis() + (b.classList.contains('lmd-on') ? '' : ' (sin marcar)'); });
  });
  check('los ajustes van en diez pestañas, cada una con lo suyo', tabs.join('|') === 'look:Apariencia=Apariencia|read:Lectura y edición=Lectura+Edición+Carpeta|plug:Plugins=Plugins de Markdown|tools:Herramientas=Herramientas|cloud:Nube=Nube|ai:IA (MCP)=Conectar una IA|auto:API y automatizaciones=API y automatizaciones|plan:Plan=Plan|inst:Instalar=Instalar|adv:Avanzado=CSS propio+Servidor+Actualizaciones', tabs);
  const marks = await page.evaluate(() => ({ plugins: document.querySelectorAll('[data-tab=plug] [data-plugin]').length, other: document.querySelectorAll('[data-tab=plug] input:not([data-plugin]), [data-tab=plug] textarea, [data-tab=plug] select, [data-tab=plug] button:not([data-plug-pick])').length, paidInPlugins: document.querySelectorAll('[data-tab=plug] .lmd-tag').length, cssTab: document.querySelector('[data-key=customCSS]').closest('section').dataset.tab, cssPaid: document.querySelector('[data-key=customCSS]').closest('section').querySelectorAll('.lmd-tag').length, reset: document.querySelector('[data-act=reset]').closest('section').dataset.tab }));
  check('Plugins trae solo los interruptores (y el botón que elige cada uno), sin marca de plan pago; el CSS propio y Restablecer van en Avanzado', marks.plugins >= 20 && marks.other === 0 && marks.paidInPlugins === 0 && marks.cssTab === 'adv' && marks.cssPaid === 1 && marks.reset === 'adv', marks);
  // Sin cuenta: el color de acento y la tipografía se cambian sin aviso de plan; el CSS propio muestra su candado.
  await page.click('[data-ptab=look]'); await page.click('[data-accent="#ec4899"]');
  const fontPick = await page.evaluate(() => document.querySelector('select[data-key=fontFamily]').options[4].value);
  await page.selectOption('select[data-key=fontFamily]', fontPick); await page.waitForTimeout(700);
  const noAcct = await page.evaluate(() => { const r = document.documentElement; const look = document.querySelector('section[data-tab=look]'); const t = document.querySelector('[data-key=customCSS]'); const adv = t.closest('section');
    return { fill: r.style.getPropertyValue('--accent-fill'), font: r.style.getPropertyValue('--lmd-font'), marks: look.querySelectorAll('.lmd-tag, .lmd-extra, .lmd-locked').length, off: look.querySelector('select[data-key=fontFamily]').disabled || look.querySelector('[data-accent-custom]').disabled,
      cssOff: t.disabled, note: adv.querySelector('.lmd-extra p').textContent, plans: adv.querySelectorAll('[data-act=see-plans]').length, clear: adv.querySelectorAll('[data-act=css-clear]').length }; });
  check('sin cuenta, el color de acento y la tipografía se eligen y se aplican, sin candado ni aviso de plan', noAcct.fill === '#ec4899' && fontPick.length > 3 && noAcct.font === fontPick && noAcct.marks === 0 && !noAcct.off, [noAcct, fontPick]);
  check('sin cuenta, el CSS propio va con su candado: el campo apagado, una línea que lo explica y el botón a los planes', noAcct.cssOff && noAcct.note === 'El CSS propio viene con el plan pago.' && noAcct.plans === 1 && noAcct.clear === 0, noAcct);
  await page.click('[data-accent=""]'); await page.selectOption('select[data-key=fontFamily]', ''); await page.waitForTimeout(500);
  await page.close();

  console.log('Página propia de SharpMD');
  const app = await ctx.newPage(); watch(app);
  await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
  check('centro sin nota: nueva nota, desde una plantilla, abrir archivo y abrir carpeta', (await app.evaluate(() => [...document.querySelectorAll('.lmd-home-actions [data-home]')].map((x) => x.dataset.home).join())) === 'new,tpl,file,dir');
  // Carpeta de prueba en el almacenamiento privado del origen; el selector de Windows no se puede automatizar.
  await app.evaluate(async () => {
    const base = await navigator.storage.getDirectory();
    const dir = await base.getDirectoryHandle('notas', { create: true });
    const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
    await write(dir, 'README.md', '# Inicio\n\nUn párrafo con **negrita**, un link a [otro](otro.md) y a [[tercero]].\n\n![logo](img/punto.svg)\n\n$E = mc^2$\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n```dot\ndigraph { a -> b }\n```\n');
    await write(dir, 'otro.md', '# Otro\n\nTexto con la palabra zanahoria.\n');
    await write(await dir.getDirectoryHandle('sub', { create: true }), 'tercero.md', '# Tercero\n\nOtra zanahoria.\n');
    await write(await dir.getDirectoryHandle('img', { create: true }), 'punto.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="red"/></svg>');
    window.showDirectoryPicker = async () => dir;
  });
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]);
  await app.waitForSelector('.markdown-body h1'); await app.waitForTimeout(4000);
  const opened = await app.evaluate(() => ({
    title: document.title, links: [...document.querySelectorAll('.markdown-body p a')].map((a) => new URL(a.href).search),
    img: document.querySelector('.markdown-body img').naturalWidth, katex: !!document.querySelector('.katex'), diagrams: document.querySelectorAll('.lmd-diagram > svg').length,
  }));
  check('abre el README de la carpeta', opened.title === 'README.md', opened.title);
  check('links relativos y [[wiki]] pasan por la app', opened.links.length === 2 && opened.links.every((l) => l.startsWith('?f=')) && /sub%2Ftercero\.md$/.test(opened.links[1]), opened.links);
  check('imágenes relativas', opened.img === 40, opened.img);
  check('matemática y diagramas en la app', opened.katex && opened.diagrams === 2, opened);

  await app.waitForSelector('.lmd-node');
  await app.fill('.lmd-search input', 'zanahoria');
  await app.waitForFunction(() => /\d/.test((document.querySelector('.lmd-results-sum') || {}).textContent || ''), null, { timeout: 15000 });
  check('búsqueda en la carpeta de la app', (await app.locator('.lmd-res-file').count()) === 2);
  await app.fill('.lmd-search input', '');

  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' Agregado.'); await app.keyboard.press('Enter'); await app.waitForTimeout(400);
  await app.keyboard.press('Control+s'); await app.waitForTimeout(1200);
  const saved = await app.evaluate(async () => { const base = await navigator.storage.getDirectory(); const dir = await base.getDirectoryHandle('notas'); return (await (await (await dir.getFileHandle('README.md')).getFile()).text()).split('\n')[2]; });
  check('guarda en el archivo', saved === 'Un párrafo con **negrita**, un link a [otro](otro.md) y a [[tercero]]. Agregado.', saved);

  await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
  await Promise.all([app.waitForNavigation(), app.click('.lmd-node:has-text("otro.md")')]); await app.waitForSelector('.markdown-body h1');
  check('navega a otro archivo', (await app.title()) === 'otro.md');
  // Al volver a la app sin nota, la carpeta que se venía usando sigue en el explorador, con sus archivos.
  await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home [data-home=new]'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node');
  const back = await app.evaluate(() => ({ head: document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-path').textContent, files: [...document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-tree > .lmd-node')].map((n) => n.textContent.trim()), where: [...document.querySelectorAll('.lmd-xroot[data-root=disk] a.lmd-node .lmd-node-where')].map((w) => w.title) }));
  check('al volver, la carpeta abierta sigue en el explorador', back.head === 'notas' && back.files.includes('otro.md') && back.files.includes('README.md'), back);
  check('cada archivo dice dónde está guardado', back.where.length >= 2 && back.where.every((t) => t === 'En el disco'), back.where);

  // El botón de la extensión ya no tiene popup: un clic abre SharpMD (tests/bridge.mjs prueba adónde).
  const action = await sw.evaluate(() => ({ popup: chrome.runtime.getManifest().action.default_popup || '', listens: chrome.action.onClicked.hasListeners() }));
  check('el botón de la extensión abre SharpMD directo, sin popup', action.popup === '' && action.listens && !fs.existsSync(path.join(root, 'src', 'popup.html')), action);

  console.log('Archivo nuevo');
  let fresh = await ctx.newPage(); watch(fresh);
  await fresh.goto(`chrome-extension://${id}/src/app.html?new=1`); await fresh.waitForSelector('.lmd-draft');
  check('arranca en edición con el cursor listo', /^nota-\d{8}-\d{4}\.md$/.test(await fresh.title()) && await fresh.evaluate(() => document.activeElement.classList.contains('lmd-draft')), await fresh.title());
  await fresh.keyboard.type('# Idea'); await fresh.keyboard.press('Enter'); await fresh.keyboard.type('Primera línea.'); await fresh.click('.lmd-foot .lmd-status', { force: true }); await fresh.waitForTimeout(600);
  await fresh.waitForTimeout(1200);
  check('la nota se guarda sola en el navegador', /navegador/.test(await fresh.textContent('.lmd-savestate')), await fresh.textContent('.lmd-savestate'));
  const noteUrl = fresh.url();
  await fresh.close();
  const again = await ctx.newPage(); watch(again);
  await again.goto(`chrome-extension://${id}/src/app.html`); await again.waitForSelector('.lmd-xroot[data-root=local] .lmd-node');
  const listed = await again.evaluate(() => { const n = document.querySelector('.lmd-xroot[data-root=local] .lmd-node'); return [n.textContent.trim(), n.title, n.querySelector('.lmd-node-where').title]; });
  check('al volver, la nota aparece en el explorador con su título', listed[0] === 'Idea' && /^nota-\d{8}-\d{4}\.md$/.test(listed[1]) && listed[2] === 'En este navegador', listed);
  await again.close();
  fresh = await ctx.newPage(); watch(fresh);
  await fresh.goto(noteUrl); await fresh.waitForSelector('.markdown-body h1');
  check('cerrar la pestaña no pierde la nota', (await fresh.textContent('.markdown-body h1')).startsWith('Idea'));
  await fresh.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('nuevas', { create: true });
    window.showSaveFilePicker = async (o) => dir.getFileHandle(o.suggestedName, { create: true });
  });
  await Promise.all([fresh.waitForNavigation(), fresh.keyboard.press('Control+s')]); await fresh.waitForSelector('.markdown-body h1');
  const kept = await fresh.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('nuevas'); for await (const [, h] of dir.entries()) return (await h.getFile()).text(); });
  check('guardar elige dónde y lo deja como archivo común', kept.trim() === '# Idea\n\nPrimera línea.' && !/f=(mem|local)/.test(fresh.url()), [kept, fresh.url().split('?')[1]]);
  await fresh.goto(`chrome-extension://${id}/src/app.html`); await fresh.waitForSelector('.lmd-home-notes button');
  await fresh.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('rapidas', { create: true }); window.showDirectoryPicker = async () => dir; });
  await fresh.click('[data-home=notes]'); await fresh.waitForSelector('.lmd-home-notes b');
  await Promise.all([fresh.waitForNavigation(), fresh.click('[data-home=new]')]); await fresh.waitForSelector('.lmd-draft');
  const inFolder = await fresh.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('rapidas'); const out = []; for await (const [n] of dir.entries()) out.push(n); return out; });
  check('con carpeta de notas, la nota nueva nace como archivo ahí', inFolder.length === 1 && /^nota-.*\.md$/.test(inFolder[0]) && !/f=mem/.test(fresh.url()), inFolder);
  await fresh.keyboard.type('Nota rápida'); await fresh.click('.lmd-foot .lmd-status', { force: true }); await fresh.waitForTimeout(500);
  check('el pie muestra el estado del guardado y el contador', /sin guardar/i.test(await fresh.textContent('.lmd-savestate')) && /2 palabras/.test(await fresh.textContent('.lmd-count')), [await fresh.textContent('.lmd-savestate'), await fresh.textContent('.lmd-count')]);
  await fresh.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'mdtools-nota.png') });
  await fresh.keyboard.press('Control+s'); await fresh.waitForTimeout(700);
  await fresh.close();

  console.log('Versión web, sin la extensión');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const web = await ctx.newPage(); watch(web);
  await web.goto(origin + '/'); await web.waitForSelector('h1');
  check('la raíz es la página de presentación y lleva a la app', (await web.locator('a.btn.fill[href="src/app.html"]').count()) >= 1 && (await web.locator('video.clip').count()) >= 4);
  // Los clips: sin sonido, en bucle, con póster y sin cargar nada hasta entrar en pantalla; cada uno con WebM y MP4 que existen.
  const clips = await web.evaluate(() => [...document.querySelectorAll('video.clip')].map((v) => ({ ok: v.muted && v.loop && v.playsInline && !v.controls && v.preload === 'none' && !!(v.getAttribute('poster') || v.getAttribute('data-poster')) && !!v.getAttribute('aria-label'), files: [v.getAttribute('poster') || v.getAttribute('data-poster'), ...[...v.querySelectorAll('source')].map((s) => s.getAttribute('src'))], types: [...v.querySelectorAll('source')].map((s) => s.type).join() })));
  const clipFiles = clips.flatMap((c) => c.files); const clipKb = clipFiles.filter((f) => /\.(webm|mp4)$/.test(f)).map((f) => (fs.existsSync(path.join(root, f)) ? fs.statSync(path.join(root, f)).size / 1024 : Infinity));
  check('portada: los clips van sin sonido, en bucle, con póster y sin precarga, en MP4 primero (el que Safari reproduce) y WebM', clips.length >= 4 && clips.every((c) => c.ok && c.types === 'video/mp4,video/webm') && clipFiles.every((f) => fs.existsSync(path.join(root, f))), clips);
  check('portada: cada clip pesa menos de 500 KB y entre todos menos de 4 MB', clipKb.every((k) => k < 500) && clipKb.reduce((a, b) => a + b, 0) < 4096, clipKb.map(Math.round));
  const hero = web.locator('video.clip').first(); await web.waitForFunction(() => !document.querySelector('video.clip').paused, null, { timeout: 8000 }).catch(() => {});
  check('portada: el clip que está a la vista se reproduce solo, y los de más abajo esperan', (await hero.evaluate((v) => !v.paused)) && (await web.evaluate(() => [...document.querySelectorAll('video.clip')].slice(1).every((v) => v.paused && v.readyState === 0))));
  const calm = await ctx.newPage(); await calm.emulateMedia({ reducedMotion: 'reduce' }); await calm.goto(origin + '/?site'); await calm.waitForSelector('video.clip'); await calm.waitForTimeout(700);
  check('portada con movimiento reducido: queda el póster y no se reproduce nada', await calm.evaluate(() => [...document.querySelectorAll('video.clip')].every((v) => v.paused && v.readyState === 0)));
  await calm.close();
  // Las listas con un visual al lado: cada ítem trae el suyo (un clip, una captura o una ilustración), descrito y con su archivo;
  // en pantalla ancha se ve el del ítem elegido, y elegir otro lo cambia. Sin JavaScript queda elegido el primero.
  const visuals = () => web.evaluate(() => [...document.querySelectorAll('.pick')].map((pk) => [...pk.querySelectorAll('.opts > li')].map((li) => { const v = li.querySelector('.vis'); const m = v && v.querySelector('video, img'); const drawn = v && v.querySelector('[role=img], pre');
    return { has: !!m || (!!drawn && drawn.textContent.trim().length > 20), file: m ? m.getAttribute('src') || m.getAttribute('poster') || m.getAttribute('data-poster') : '', said: m ? !!(m.getAttribute('alt') || m.getAttribute('aria-label')) : !!drawn && (drawn.tagName === 'PRE' || !!drawn.getAttribute('aria-label')), shown: !!v && v.getClientRects().length > 0, on: li.classList.contains('on'), button: !!li.querySelector('h3 button') }; })));
  const lists = await visuals();
  check('portada: cada ítem de las listas tiene su propio visual, con descripción y con su archivo, y se ve el del primero', lists.length >= 3 && lists.every((items) => items.length >= 4 && items.every((it, i) => it.has && it.said && it.button && (!it.file || fs.existsSync(path.join(root, it.file))) && it.shown === (i === 0) && it.on === (i === 0))), lists);
  const built = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('portada sin JavaScript: cada lista sale con un ítem elegido, y cada clip que espera su póster trae la imagen de respaldo', (built.match(/<li class="on">/g) || []).length === lists.length && (built.match(/<video[^>]+data-poster=/g) || []).length === (built.match(/<noscript><img class="clip"/g) || []).length && /<noscript><style>video\[data-poster\] \{ display: none; \}<\/style><\/noscript>/.test(built));
  const firstList = web.locator('.pick').first(); await firstList.scrollIntoViewIfNeeded(); await firstList.locator('.opts > li').nth(2).locator('h3 button').click(); await web.waitForTimeout(300);
  const picked = (await visuals())[0];
  check('portada: elegir otro ítem cambia el visual, y la lista deja de avanzar sola', picked.every((it, i) => it.shown === (i === 2) && it.on === (i === 2)) && (await firstList.evaluate((pk) => !pk.classList.contains('auto') && pk.querySelectorAll('h3 button[aria-pressed=true]').length === 1)), picked);
  // Los clips de más abajo no piden su póster en la primera carga: lo reciben al acercarse a la pantalla.
  const fresh2 = await ctx.newPage(); await fresh2.goto(origin + '/?site'); await fresh2.waitForSelector('video.clip'); await fresh2.waitForTimeout(500);
  const lateAt = await fresh2.evaluate(() => [...document.querySelectorAll('video.clip[data-poster]')].map((v) => v.getAttribute('poster')));
  await fresh2.locator('video.clip[data-poster]').first().scrollIntoViewIfNeeded(); await fresh2.waitForFunction(() => !!document.querySelector('video.clip[data-poster]').getAttribute('poster'), null, { timeout: 5000 }).catch(() => {});
  check('portada: el póster de un clip de más abajo no se pide al cargar, y llega cuando el clip se acerca a la pantalla', lateAt.length >= 3 && lateAt.every((p) => !p) && (await fresh2.evaluate(() => { const v = document.querySelector('video.clip[data-poster]'); return v.getAttribute('poster') === v.getAttribute('data-poster'); })), lateAt);
  // En un teléfono los ítems van en una fila que se desliza: cada uno con su visual debajo.
  await fresh2.setViewportSize({ width: 390, height: 800 }); await fresh2.goto(origin + '/?site'); await fresh2.waitForSelector('.pick'); await fresh2.waitForTimeout(300);
  const narrow = await fresh2.evaluate(() => ({ all: [...document.querySelectorAll('.pick .vis')].map((v) => { const r = v.getBoundingClientRect(); const t = v.parentElement.querySelector('h3').getBoundingClientRect(); return r.height > 60 && r.top >= t.bottom && r.right <= v.closest('li').getBoundingClientRect().right + 1; }), over: document.documentElement.scrollWidth - innerWidth }));
  check('portada en un teléfono: cada ítem muestra su visual debajo de su texto, en una fila que se desliza, sin desbordar la página', narrow.all.length >= 12 && narrow.all.every(Boolean) && narrow.over <= 0, narrow);
  await fresh2.close();
  // "También trae": al pasar el cursor por una función con vista previa, la caja aparece al lado del cursor con su escena.
  const row = web.locator('.more li[data-peek=table]'); await row.scrollIntoViewIfNeeded(); await row.hover(); await web.waitForTimeout(500);
  const peek = await web.evaluate(() => { const p = document.querySelector('.peek'); const r = p.getBoundingClientRect(); const li = document.querySelector('.more li[data-peek=table]').getBoundingClientRect(); return { shown: getComputedStyle(p).opacity > 0.9, scene: [...p.querySelectorAll('.pk.on')].map((k) => k.dataset.k).join(), near: Math.abs(r.left - (li.left + li.width / 2)) < 80 && r.right <= innerWidth && r.bottom <= innerHeight, n: document.querySelectorAll('.more li').length, groups: document.querySelectorAll('.more h3').length }; });
  await web.mouse.move(5, 300); await web.waitForTimeout(300);
  check('portada: la vista previa sigue al cursor con la escena de esa función, y se va al salir', peek.shown && peek.scene === 'table' && peek.near && peek.groups === 3 && (await web.evaluate(() => getComputedStyle(document.querySelector('.peek')).opacity < 0.1)), peek);
  const social = await web.evaluate(() => ({ og: (document.querySelector('meta[property="og:image"]') || {}).content, tw: (document.querySelector('meta[name="twitter:image"]') || {}).content, card: (document.querySelector('meta[name="twitter:card"]') || {}).content, w: (document.querySelector('meta[property="og:image:width"]') || {}).content, h: (document.querySelector('meta[property="og:image:height"]') || {}).content, alt: (document.querySelector('meta[property="og:image:alt"]') || {}).content }));
  const cardFile = path.join(root, new URL(social.og || 'https://sharpmd.app/nada').pathname);
  check('portada: la imagen para compartir es de 1200x630, con dirección absoluta, y el archivo existe y pesa menos de 300 KB', /^https:\/\/sharpmd\.app\/docs\/social-card/.test(social.og || '') && social.tw === social.og && social.card === 'summary_large_image' && social.w === '1200' && social.h === '630' && !!social.alt && fs.existsSync(cardFile) && fs.statSync(cardFile).size < 300 * 1024, social);
  await web.goto(origin + '/privacy.html'); check('página de privacidad', /Privac/.test(await web.textContent('h1:visible')));
  // El enlace a cómo eliminar la cuenta (lo pide la tienda) lleva a esa sección, en el idioma que se esté viendo.
  const inView = () => web.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.offsetParent && (x.id === 'delete-account' || x.dataset.same === 'delete-account')); const r = h ? h.getBoundingClientRect() : null; return h ? [h.textContent, r.top >= 0 && r.top < window.innerHeight, /hello@sharpmd\.app/.test(h.nextElementSibling.innerHTML)] : null; });
  await web.goto(origin + '/privacy.html#delete-account'); await web.waitForTimeout(300);
  const delEn = await inView();
  await web.click('.lang [data-set=es]'); await web.goto('about:blank'); await web.goto(origin + '/privacy.html#delete-account'); await web.waitForSelector('h1:visible'); await web.waitForTimeout(300);
  const delEs = await inView();
  await web.click('.lang [data-set=en]');
  check('privacy.html#delete-account lleva a cómo eliminar la cuenta, en inglés y en castellano', JSON.stringify([delEn, delEs]) === JSON.stringify([['Deleting your account', true, true], ['Eliminar tu cuenta', true, true]]) && (await web.locator('#delete-account').count()) === 1, [delEn, delEs]);
  // Las páginas legales (términos, reembolsos, uso aceptable, derechos de autor): las dos versiones en la misma página,
  // el botón cambia de idioma, sin signos de admiración ni rayas, y enlazadas desde el pie de la portada y desde el pago.
  const LEGAL = ['terms', 'refunds', 'acceptable-use', 'copyright'];
  const legalSeen = [];
  for (const p of LEGAL) {
    const look = () => web.evaluate(() => { const part = (l) => document.querySelector('main > div[lang=' + l + ']'); const vis = [...document.querySelectorAll('h1')].filter((h) => h.offsetParent);
      return { lang: document.documentElement.getAttribute('data-lang'), h1: vis.map((h) => h.textContent).join('|'), en: part('en') ? part('en').textContent.length : 0, es: part('es') ? part('es').textContent.length : 0,
        h2: [part('en'), part('es')].map((d) => (d ? d.querySelectorAll('h2').length : -1)), bad: (document.querySelector('main').textContent.match(/[!¡—–]/g) || []).join(''),
        prevails: /English version applies/.test(part('en').textContent) && /vale la versión en inglés/.test(part('es').textContent), foot: [...document.querySelectorAll('.legal a')].filter((a) => a.offsetParent).map((a) => a.getAttribute('href')).join() }; });
    await web.goto(origin + '/' + p + '.html'); await web.waitForSelector('h1:visible');
    const en = await look(); await web.click('.lang [data-set=es]'); const es = await look(); await web.click('.lang [data-set=en]');
    legalSeen.push({ p, ok: en.lang === 'en' && es.lang === 'es' && !!en.h1 && !!es.h1 && en.h1 !== es.h1 && !/\|/.test(en.h1 + es.h1) && en.en > 1500 && en.es > 1500 && en.h2[0] === en.h2[1] && en.h2[0] >= 5 && !en.bad && en.prevails
      && en.foot === 'terms.html,privacy.html,refunds.html,acceptable-use.html,copyright.html,support.html', en, es: es.h1 });
  }
  check('las cuatro páginas legales existen, traen inglés y castellano con las mismas secciones, cambian de idioma y no tienen signos de admiración ni rayas', legalSeen.every((x) => x.ok), legalSeen.filter((x) => !x.ok));
  const rawOf = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const footOf = (html) => (html.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
  const payRaw = rawOf('pay.html'); const agree = (payRaw.match(/<p class="fine agree">[\s\S]*?<\/p>/) || [''])[0];
  const linked = { home: LEGAL.every((p) => footOf(rawOf('index.html')).includes('href="' + p + '.html"')), es: LEGAL.every((p) => footOf(rawOf('es/index.html')).includes('href="../' + p + '.html"')),
    pay: ['en', 'es'].every((l) => new RegExp('<span lang="' + l + '">[^\\n]*?href="terms\\.html"[^\\n]*?href="refunds\\.html"').test(agree)), near: payRaw.indexOf('id="go"') > 0 && payRaw.indexOf('class="fine agree"') > payRaw.indexOf('id="go"') && payRaw.indexOf('class="fine agree"') < payRaw.indexOf('id="other"'),
    map: LEGAL.every((p) => rawOf('sitemap.xml').includes('https://sharpmd.app/' + p + '.html') && rawOf('llms.txt').includes('https://sharpmd.app/' + p + '.html')) };
  check('las páginas legales están enlazadas desde el pie de la portada en los dos idiomas, junto al botón de pagar, y figuran en el sitemap y en llms.txt', linked.home && linked.es && linked.pay && linked.near && linked.map, linked);
  // Las páginas que explican un uso (editor para agentes por MCP, editor WYSIWYG): una por idioma, generadas, con sus metadatos,
  // un solo h1, de 4 a 6 secciones, el botón a la app, y enlazadas entre sí, desde el pie de la portada, el sitemap y llms.txt.
  const USES = ['markdown-editor-mcp', 'wysiwyg-markdown-editor'];
  const useSeen = [];
  for (const p of USES) for (const l of ['en', 'es']) {
    const rel = (l === 'es' ? 'es/' : '') + p + '.html'; const url = 'https://sharpmd.app/' + rel; const raw = fs.existsSync(path.join(root, rel)) ? rawOf(rel) : '';
    const meta = raw.includes('<link rel="canonical" href="' + url + '">') && ['en', 'es'].every((x) => raw.includes('hreflang="' + x + '" href="https://sharpmd.app/' + (x === 'es' ? 'es/' : '') + p + '.html"')) && raw.includes('<meta property="og:url" content="' + url + '">') && /<meta name="description" content="[^"]{120,158}">/.test(raw) && /<meta property="og:image" content="https:\/\/sharpmd\.app\/docs\/social-card/.test(raw) && !/noindex/.test(raw);
    await web.goto(origin + '/' + rel); await web.waitForSelector('h1');
    const seen = await web.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('h2').length, bad: (document.querySelector('main').textContent.match(/[!¡—–]/g) || []).join(''), spaced: /Sharp MD/.test(document.documentElement.innerHTML),
      hrefs: [...document.querySelectorAll('main a[href]')].filter((a) => a.origin === location.origin).map((a) => new URL(a.href).pathname), mails: [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute('href')).filter((h) => h !== 'mailto:hello@sharpmd.app') }));
    const home = l === 'es' ? '/es/' : '/'; const other = home + USES.find((x) => x !== p) + '.html';
    const missing = []; for (const h of [...new Set(seen.hrefs)].filter((h) => !/^\/(es\/)?$/.test(h))) { if (!fs.existsSync(path.join(root, h))) missing.push(h); }
    useSeen.push({ rel, ok: meta && seen.lang === l && seen.h1 === 1 && seen.h2 >= 4 && seen.h2 <= 6 && !seen.bad && !seen.spaced && !seen.mails.length && seen.hrefs.includes('/src/app.html') && seen.hrefs.includes(home) && seen.hrefs.includes(other) && !missing.length, meta, seen, missing });
  }
  const useLinked = { home: USES.every((p) => footOf(rawOf('index.html')).includes('href="' + p + '.html"')), es: USES.every((p) => footOf(rawOf('es/index.html')).includes('href="./' + p + '.html"')),
    map: USES.every((p) => ['', 'es/'].every((d) => rawOf('sitemap.xml').includes('<loc>https://sharpmd.app/' + d + p + '.html</loc>') && rawOf('llms.txt').includes('https://sharpmd.app/' + d + p + '.html'))) };
  check('las páginas de uso (editor para agentes por MCP y editor WYSIWYG) existen en inglés y en castellano con sus metadatos, un h1, de 4 a 6 secciones, el botón a la app y enlaces que existen, sin signos de admiración ni rayas', useSeen.length === 4 && useSeen.every((x) => x.ok), useSeen.filter((x) => !x.ok));
  check('las páginas de uso están enlazadas desde el pie de la portada en los dos idiomas, y figuran en el sitemap y en llms.txt', useLinked.home && useLinked.es && useLinked.map, useLinked);
  const ld = JSON.parse((rawOf('index.html').match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"SoftwareApplication"[\s\S]*?)<\/script>/) || [0, '{}'])[1]);
  check('portada: los datos estructurados de la app llevan "Sharp MD" como nombre alternativo, y el plan gratis en USD 0', ld.name === 'SharpMD' && JSON.stringify(ld.alternateName) === JSON.stringify(['Sharp MD', 'SharpMD Markdown editor']) && ld.url === 'https://sharpmd.app/' && !!ld.applicationCategory && !!ld.operatingSystem && ld.offers[0].price === '0' && !/Sharp MD/.test(rawOf('index.html').replace(/"alternateName":\[[^\]]*\]/, '')), [ld.alternateName, ld.operatingSystem, ld.offers]);
  // La pantalla de carga: viene en el HTML (se ve desde el primer pintado) y se va cuando la app está lista.
  const rawApp = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  await web.goto(origin + '/src/app.html'); await web.waitForSelector('.lmd-home');
  check('la app web muestra el centro con sus cuatro acciones', (await web.locator('.lmd-home-actions [data-home]').count()) === 4);
  await web.waitForSelector('#lmd-splash', { state: 'detached' });
  check('app.html trae la pantalla de carga con el logo, respeta el movimiento reducido y se va al estar lista', /<body>\s*<div class="lmd-splash" id="lmd-splash"/.test(rawApp) && /prefers-reduced-motion: reduce\) \{ \.lmd-splash/.test(rawApp) && (await web.locator('#lmd-splash').count()) === 0);
  // Quien ya usó la app y entra a la portada va directo a la app, y mientras tanto la portada no se pinta.
  const ret = await ctx.newPage();
  await ret.goto(origin + '/').catch(() => {}); await ret.waitForURL(/src\/app\.html/, { timeout: 10000 }); await ret.waitForSelector('.lmd-home');
  const head = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('la portada manda a la app a quien ya la usó, y antes de irse se marca para no pintarse', /src\/app\.html/.test(ret.url()) && /c\.add\("go"\);[^<]*location\.replace\("src\/app\.html"\)/.test(head));
  await ret.goto(origin + '/?site'); await ret.waitForSelector('h1');
  check('con ?site la portada se ve entera', await ret.evaluate(() => !document.documentElement.classList.contains('go') && document.querySelector('h1').offsetWidth > 0));
  // Lo que esa marca deja a la vista: nada de la portada, y el logo con el cursor que parpadea sobre el fondo de la app.
  const landed = await ret.evaluate(() => { document.documentElement.classList.add('go'); return { seen: [...document.body.children].filter((n) => n.offsetParent || n.offsetWidth).length, bg: getComputedStyle(document.body).backgroundColor, logo: getComputedStyle(document.body, '::before').backgroundImage.slice(0, 20), blink: getComputedStyle(document.body, '::after').animationName }; });
  check('mientras redirige se ve solo el logo con el cursor, sobre el fondo de la app', landed.seen === 0 && landed.bg === 'rgb(18, 20, 24)' && /^url\("data:image\/svg/.test(landed.logo) && landed.blink === 'go-blink', landed);
  await ret.close();
  // Dos titulares a prueba. El HTML trae el B (el de siempre), para buscadores y sin JavaScript; un script en línea elige
  // A o B la primera vez, lo recuerda en este navegador y pone el A antes de pintar. La portada publicada avisa al
  // servidor qué titular mostró y si se abrió la app o se fue a los planes: la variante y el evento, y nada más.
  {
    const HERO = { en: { a: 'Edit Markdown without writing Markdown.', b: 'Markdown notes your AI writes and your team reads.', pa: /^Click a heading, a table or a diagram and change it right there/, pb: /^A Markdown editor in the cloud, with the MCP endpoint already running/ },
      es: { a: 'Editá Markdown sin escribir Markdown.', b: 'Notas en Markdown que tu IA escribe y tu equipo lee.', pa: /^Hacés clic en un título, una tabla o un diagrama y lo cambiás ahí mismo/, pb: /^Un editor de Markdown en la nube, con la conexión MCP ya andando/ } };
    const pages = { en: fs.readFileSync(path.join(root, 'index.html'), 'utf8'), es: fs.readFileSync(path.join(root, 'es', 'index.html'), 'utf8') };
    const inHtml = ['en', 'es'].map((l) => { const h = pages[l]; const h1 = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]; const pick = h.indexOf("localStorage.getItem('sharpmd:hero')");
      return { l, h1, a: h.includes('<h1 data-a="' + HERO[l].a + '">'), title: !h.match(/<title>[^<]*<\/title>/)[0].includes(HERO[l].a), early: pick > 0 && pick < h.indexOf('<style>') && pick < h.indexOf('<body'),
        safe: /try \{ v = localStorage\.getItem\('sharpmd:hero'\); \} catch/.test(h) && /try \{ localStorage\.setItem\('sharpmd:hero', v\); \} catch/.test(h), half: /Math\.random\(\) < 0\.5 \? 'a' : 'b'/.test(h), plain: !/[!¡—–]/.test(HERO[l].a + h.match(/class="lede" data-a="([^"]*)"/)[1]) }; });
    check('titulares a prueba: el HTML sale con el B en los dos idiomas, y el A viaja como dato', inHtml.every((x) => x.h1 === HERO[x.l].b && x.a && x.title && x.plain), inHtml);
    check('titulares a prueba: la elección va en un script en línea antes de los estilos, mitad y mitad, y con el almacenamiento entre try y catch', inHtml.every((x) => x.early && x.safe && x.half), inHtml);
    const ab = await ctx.newPage(); watch(ab);
    const sentOut = []; ab.on('request', (r) => { if (/sync\.sharpmd\.app/.test(r.url())) sentOut.push(r.url()); });
    const hero = () => ab.evaluate(() => { const d = document.documentElement; const h = document.querySelector('.hero h1'); const p = document.querySelector('.hero .lede'); let kept = null; try { kept = localStorage.getItem('sharpmd:hero'); } catch (e) { /* sin almacenamiento */ }
      return { v: d.getAttribute('data-ab'), kept, on: d.classList.contains('ab-on'), h1: h.textContent.trim(), p: p.textContent.trim(), seen: getComputedStyle(h).visibility === 'visible' && getComputedStyle(p).visibility === 'visible' && h.offsetHeight > 0 }; });
    const open = async (url, v) => { await ab.goto(url); await ab.waitForSelector('.hero h1'); if (v !== undefined) { await ab.evaluate((x) => { if (x) localStorage.setItem('sharpmd:hero', x); else localStorage.removeItem('sharpmd:hero'); }, v); await ab.goto(url); await ab.waitForSelector('.hero h1'); } return hero(); };
    const first = await open(origin + '/?site', ''); const again = await open(origin + '/?site'); const third = await open(origin + '/?site');
    check('titulares a prueba: la primera visita elige uno, lo guarda y las siguientes muestran el mismo', /^[ab]$/.test(first.v) && first.kept === first.v && first.on && first.seen && first.h1 === HERO.en[first.v] && again.v === first.v && third.v === first.v && again.h1 === first.h1, [first, again.v, third.v]);
    const seenA = await open(origin + '/?site', 'a'); const seenB = await open(origin + '/?site', 'b'); const esA = await open(origin + '/es/?site', 'a'); const esB = await open(origin + '/es/?site', 'b');
    check('titulares a prueba: el A cambia el titular y la bajada, y el B deja los del HTML, en inglés y en castellano', seenA.h1 === HERO.en.a && HERO.en.pa.test(seenA.p) && seenA.seen && seenB.h1 === HERO.en.b && HERO.en.pb.test(seenB.p) && seenB.seen && esA.h1 === HERO.es.a && HERO.es.pa.test(esA.p) && esB.h1 === HERO.es.b && HERO.es.pb.test(esB.p), [seenA, seenB, esA, esB]);
    await open(origin + '/?site', 'a');
    const flash = await ab.evaluate(() => { const d = document.documentElement; const h = document.querySelector('.hero h1'); const p = document.querySelector('.hero .lede'); const size = h.offsetHeight; d.classList.remove('ab-on'); const hid = getComputedStyle(h).visibility === 'hidden' && getComputedStyle(p).visibility === 'hidden' && h.offsetHeight === size;
      d.setAttribute('data-ab', 'b'); const b = getComputedStyle(h).visibility === 'visible'; d.setAttribute('data-ab', 'a'); d.classList.add('ab-on'); return { hid, b, back: getComputedStyle(h).visibility === 'visible' }; });
    check('titulares a prueba: hasta que el A está puesto su lugar queda guardado y no se ve el otro, y el B nunca se esconde', flash.hid && flash.b && flash.back, flash);
    const drawn = new Set(); for (let i = 0; i < 16 && drawn.size < 2; i++) drawn.add((await open(origin + '/?site', '')).v);
    check('titulares a prueba: de visitas nuevas salen los dos', drawn.has('a') && drawn.has('b'), [...drawn]);
    check('titulares a prueba: fuera del sitio publicado no se avisa nada al servidor', sentOut.length === 0, sentOut);
    // El sitio publicado, servido desde esta carpeta: nada sale de esta máquina.
    const beats = [];
    await ab.route('https://sharpmd.app/**', (r) => { const rel = decodeURIComponent(new URL(r.request().url()).pathname); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) }); });
    await ab.route('https://sharpmd.app/src/app.html**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title><p id="app">app</p>' }));
    await ab.route('https://sync.sharpmd.app/**', (r) => { const q = r.request(); beats.push({ url: q.url(), method: q.method(), body: q.postData(), type: q.headers()['content-type'] || '', cookie: q.headers().cookie || '', auth: q.headers().authorization || '' }); return r.fulfill({ status: 204, body: '' }); });
    const live = await open('https://sharpmd.app/?site', 'a'); await ab.waitForTimeout(300);
    beats.length = 0;
    await ab.goto('https://sharpmd.app/?site'); await ab.waitForSelector('.hero h1'); await ab.waitForTimeout(400);
    const views = beats.slice();
    check('titulares a prueba: al cargar, la portada publicada manda un aviso con la variante y el evento, y nada más', live.h1 === HERO.en.a && views.length === 1 && views[0].url === 'https://sync.sharpmd.app/stats' && views[0].method === 'POST' && views[0].body === '{"e":"view","p":"home","s":"direct","v":"a"}' && /^text\/plain/.test(views[0].type) && !views[0].cookie && !views[0].auth, views);
    // Los botones se tocan sin dejar que naveguen: lo que se mira es el aviso.
    await ab.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
    const tap = async (sel) => { await ab.evaluate((s) => document.querySelector(s).click(), sel); await ab.waitForTimeout(150); return beats.length; };
    const afterFaq = await tap('nav a[href="#share"]'); const afterOpen = await tap('.hero a.btn.fill[href="src/app.html"]'); const afterMore = (await tap('nav a[href="#plans"]'), await tap('#plans a[href^="src/app.html"]'));
    check('titulares a prueba: un botón que abre la app avisa "open" una vez por visita, ir a los planes avisa "plans", y un enlace cualquiera no avisa', afterFaq === 1 && afterOpen === 2 && afterMore === 3 && beats[1].body === '{"e":"open","p":"home","s":"direct","v":"a"}' && beats[2].body === '{"e":"plans","p":"home","s":"direct","v":"a"}', [afterFaq, afterOpen, afterMore, beats.map((b) => b.body)]);
    beats.length = 0; await open('https://sharpmd.app/?site', 'b'); await ab.waitForTimeout(300); beats.length = 0;
    await ab.goto('https://sharpmd.app/es/?site'); await ab.waitForSelector('.hero h1'); await ab.waitForTimeout(300);
    await ab.evaluate(() => document.addEventListener('click', (e) => e.preventDefault())); await tap('nav a[href="#plans"]');
    const kept = await ab.evaluate(() => ({ cookie: document.cookie, keys: Object.keys(localStorage).sort().join() }));
    check('titulares a prueba: ir a los planes también cuenta, con la variante B y en la portada en castellano', beats.map((b) => b.body).join('|') === '{"e":"view","p":"home","s":"direct","v":"b"}|{"e":"plans","p":"home","s":"direct","v":"b"}', beats.map((b) => b.body));
    check('titulares a prueba: no deja cookies, y en el navegador guarda solo la variante y el canal de la visita junto al idioma', kept.cookie === '' && kept.keys === 'mdtools:site-lang,sharpmd:hero,sharpmd:src1', kept);
    // Quien ya usó la app va directo a ella: no se le elige titular ni cuenta como visita.
    await ab.evaluate(() => { localStorage.setItem('sharpmd:app', '1'); localStorage.removeItem('sharpmd:hero'); }); beats.length = 0;
    await ab.goto('https://sharpmd.app/').catch(() => {}); await ab.waitForSelector('#app', { timeout: 10000 }).catch(() => {}); await ab.waitForTimeout(300);
    check('titulares a prueba: quien entra directo a la app no cuenta como visita ni recibe un titular', /src\/app\.html/.test(ab.url()) && beats.length === 0 && (await ab.evaluate(() => localStorage.getItem('sharpmd:hero'))) === null, [ab.url(), beats.length]);
    await ab.close();
  }
  await web.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('web', { create: true });
    const h = await dir.getFileHandle('nota.md', { create: true }); const w = await h.createWritable();
    await w.write('# Nota web\n\nTexto de prueba con $a^2$.\n\n```mermaid\ngraph LR\n  A --> B\n```\n'); await w.close();
    window.showDirectoryPicker = async () => dir;
  });
  await Promise.all([web.waitForNavigation(), web.click('[data-home=dir]')]);
  await web.waitForSelector('.markdown-body h1'); await web.waitForTimeout(3500);
  const w1 = await web.evaluate(() => ({ title: document.title, katex: !!document.querySelector('.katex'), diagrams: document.querySelectorAll('.lmd-diagram > svg').length, updates: [...document.querySelectorAll('.lmd-update')].every((n) => n.hidden) }));
  check('lee una carpeta desde la web', w1.title === 'nota.md' && w1.katex && w1.diagrams === 1, w1);
  await web.click('[data-act=mode-edit]'); await web.waitForTimeout(300);
  await web.locator('.lmd-article p.lmd-editable').first().click(); await web.keyboard.press('End'); await web.keyboard.type(' Editado.'); await web.keyboard.press('Enter'); await web.waitForTimeout(300);
  await web.keyboard.press('Control+s'); await web.waitForTimeout(1000);
  const w2 = await web.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('web'); return (await (await (await dir.getFileHandle('nota.md')).getFile()).text()).split('\n')[2]; });
  check('guarda desde la web', w2 === 'Texto de prueba con $a^2$. Editado.', w2);
  await web.click('[data-act=settings]'); await web.waitForSelector('.lmd-panel-card');
  await web.click('.lmd-seg[data-seg=theme] button[data-val=light]'); await web.waitForTimeout(500);
  check('los ajustes se guardan en la web', await web.evaluate(() => document.documentElement.classList.contains('lmd-light') && /"theme":"light"/.test(localStorage.getItem('mdtools:settings') || '')));
  await web.close();

  // Navegador sin acceso a archivos (Firefox, Safari): se abre por selector común y se guarda descargando.
  const plain = await ctx.newPage(); watch(plain);
  await plain.addInitScript(() => { delete window.showOpenFilePicker; delete window.showDirectoryPicker; Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }); Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }); Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }); });
  await plain.goto(origin + '/src/app.html'); await plain.waitForSelector('.lmd-home');
  check('sin acceso a archivos no ofrece abrir carpeta', (await plain.locator('.lmd-home-actions [data-home]').count()) === 3 && (await plain.locator('[data-home=dir]').count()) === 0);
  const [chooser] = await Promise.all([plain.waitForEvent('filechooser'), plain.click('[data-home=file]')]);
  await Promise.all([plain.waitForNavigation(), chooser.setFiles(path.join(root, 'examples', 'demo.md'))]);
  await plain.waitForSelector('.markdown-body h1');
  check('abre el archivo en memoria', (await plain.title()) === 'demo.md');
  await plain.click('[data-act=mode-edit]'); await plain.waitForTimeout(300);
  await plain.locator('.lmd-article p.lmd-editable').first().click(); await plain.keyboard.press('End'); await plain.keyboard.type(' Copia.'); await plain.keyboard.press('Enter'); await plain.waitForTimeout(300);
  const [download] = await Promise.all([plain.waitForEvent('download'), plain.keyboard.press('Control+s')]);
  const copy = fs.readFileSync(await download.path(), 'utf8');
  check('guardar descarga una copia con el cambio', download.suggestedFilename() === 'demo.md' && / Copia\.\r?\n/.test(copy), download.suggestedFilename());
  await plain.close(); server.close();
  check('sin errores de JavaScript', errors.length === 0, errors);
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
