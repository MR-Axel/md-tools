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
  check('panel de ajustes', sections.join('|') === 'Apariencia|Lectura|Edición|Carpeta|Plugins de Markdown|Nube|Conectar una IA|Plan|Instalar|CSS propio|Servidor|Actualizaciones', sections);
  // Cada pestaña muestra sus secciones y ninguna otra. Los títulos se leen de lo que está a la vista.
  const tabs = await page.evaluate(() => {
    const vis = () => [...document.querySelectorAll('.lmd-panel-body > section:not([hidden]) h3')].map((h) => h.firstChild.nodeValue.trim()).join('+');
    return [...document.querySelectorAll('[data-ptab]')].map((b) => { b.click(); return b.dataset.ptab + ':' + b.textContent.trim() + '=' + vis() + (b.classList.contains('lmd-on') ? '' : ' (sin marcar)'); });
  });
  check('los ajustes van en ocho pestañas, cada una con lo suyo', tabs.join('|') === 'look:Apariencia=Apariencia|read:Lectura y edición=Lectura+Edición+Carpeta|plug:Plugins=Plugins de Markdown|cloud:Nube=Nube|ai:IA=Conectar una IA|plan:Plan=Plan|inst:Instalar=Instalar|adv:Avanzado=CSS propio+Servidor+Actualizaciones', tabs);
  const marks = await page.evaluate(() => ({ plugins: document.querySelectorAll('[data-tab=plug] [data-plugin]').length, other: document.querySelectorAll('[data-tab=plug] input:not([data-plugin]), [data-tab=plug] textarea, [data-tab=plug] select, [data-tab=plug] button').length, paidInPlugins: document.querySelectorAll('[data-tab=plug] .lmd-tag').length, cssTab: document.querySelector('[data-key=customCSS]').closest('section').dataset.tab, cssPaid: document.querySelector('[data-key=customCSS]').closest('section').querySelectorAll('.lmd-tag').length, reset: document.querySelector('[data-act=reset]').closest('section').dataset.tab }));
  check('Plugins trae solo los interruptores, sin marca de plan pago; el CSS propio y Restablecer van en Avanzado', marks.plugins >= 20 && marks.other === 0 && marks.paidInPlugins === 0 && marks.cssTab === 'adv' && marks.cssPaid === 1 && marks.reset === 'adv', marks);
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
  const clips = await web.evaluate(() => [...document.querySelectorAll('video.clip')].map((v) => ({ ok: v.muted && v.loop && v.playsInline && !v.controls && v.preload === 'none' && !!v.getAttribute('poster') && !!v.getAttribute('aria-label'), files: [v.getAttribute('poster'), ...[...v.querySelectorAll('source')].map((s) => s.getAttribute('src'))], types: [...v.querySelectorAll('source')].map((s) => s.type).join() })));
  const clipFiles = clips.flatMap((c) => c.files); const clipKb = clipFiles.filter((f) => /\.(webm|mp4)$/.test(f)).map((f) => (fs.existsSync(path.join(root, f)) ? fs.statSync(path.join(root, f)).size / 1024 : Infinity));
  check('portada: los clips van sin sonido, en bucle, con póster y sin precarga, en MP4 primero (el que Safari reproduce) y WebM', clips.length >= 4 && clips.every((c) => c.ok && c.types === 'video/mp4,video/webm') && clipFiles.every((f) => fs.existsSync(path.join(root, f))), clips);
  check('portada: cada clip pesa menos de 500 KB y entre todos menos de 4 MB', clipKb.every((k) => k < 500) && clipKb.reduce((a, b) => a + b, 0) < 4096, clipKb.map(Math.round));
  const hero = web.locator('video.clip').first(); await web.waitForFunction(() => !document.querySelector('video.clip').paused, null, { timeout: 8000 }).catch(() => {});
  check('portada: el clip que está a la vista se reproduce solo, y los de más abajo esperan', (await hero.evaluate((v) => !v.paused)) && (await web.evaluate(() => [...document.querySelectorAll('video.clip')].slice(1).every((v) => v.paused && v.readyState === 0))));
  const calm = await ctx.newPage(); await calm.emulateMedia({ reducedMotion: 'reduce' }); await calm.goto(origin + '/?site'); await calm.waitForSelector('video.clip'); await calm.waitForTimeout(700);
  check('portada con movimiento reducido: queda el póster y no se reproduce nada', await calm.evaluate(() => [...document.querySelectorAll('video.clip')].every((v) => v.paused && v.readyState === 0)));
  await calm.close();
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
  const inView = () => web.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.offsetParent); const r = h ? h.getBoundingClientRect() : null; return h ? [h.textContent, r.top >= 0 && r.top < window.innerHeight, /hello@sharpmd\.app/.test(h.nextElementSibling.innerHTML)] : null; });
  await web.goto(origin + '/privacy.html#delete-account'); await web.waitForTimeout(300);
  const delEn = await inView();
  await web.click('.lang [data-set=es]'); await web.goto('about:blank'); await web.goto(origin + '/privacy.html#delete-account'); await web.waitForSelector('h1:visible'); await web.waitForTimeout(300);
  const delEs = await inView();
  await web.click('.lang [data-set=en]');
  check('privacy.html#delete-account lleva a cómo eliminar la cuenta, en inglés y en castellano', JSON.stringify([delEn, delEs]) === JSON.stringify([['Deleting your account', true, true], ['Eliminar tu cuenta', true, true]]) && (await web.locator('#delete-account').count()) === 1, [delEn, delEs]);
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
