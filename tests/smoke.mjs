// Prueba de punta a punta: carga la extensión en un Chromium y recorre los dos modos,
// el .md abierto directo en el navegador y la página propia con una carpeta elegida.
// Uso: npm install && npm test   (CHROME_BIN apunta a otro Chromium si hace falta)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sample = pathToFileURL(path.join(root, 'ejemplo', 'ejemplo.md')).href;
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
    title: document.title, h2: document.querySelectorAll('.markdown-body h2').length, diagrams: document.querySelectorAll('.lmd-diagram svg').length,
    katex: !!document.querySelector('.katex'), outline: document.querySelectorAll('.lmd-pane-outline a').length, xss: document.title === 'XSS',
    wiki: [...document.querySelectorAll('a.lmd-wiki')].map((a) => (a.getAttribute('href') || '').split('/').pop()),
  }));
  check('renderiza el documento', doc.title === 'ejemplo.md' && doc.h2 >= 8, doc);
  check('matemática y diagramas', doc.katex && doc.diagrams === 2, doc);
  check('índice lateral', doc.outline >= 8, doc.outline);
  check('links [[wiki]] resueltos', doc.wiki[0] === 'notas.md' && doc.wiki[2] === '', doc.wiki);
  check('el HTML del documento no ejecuta scripts', !doc.xss);

  await page.click('.lmd-tab[data-tab=files]'); await page.waitForSelector('.lmd-node');
  const tree = await page.evaluate(() => [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim() + (n.classList.contains('lmd-active') ? '*' : '')));
  check('árbol de la carpeta', tree.includes('ejemplo.md*') && tree.includes('sub'), tree);
  await page.fill('.lmd-search input', 'MD Tools'); await page.waitForSelector('.lmd-results-sum');
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
  check('la edición vuelve al Markdown sin romper el formato', changed.length === 1 && source.includes('Texto **negrita**, *cursiva*, ~~tachado~~, ==marcado==, ++insertado++, H~2~O, x^2^'), changed);
  await page.click('[data-act=view-doc]');

  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card');
  const sections = await page.evaluate(() => [...document.querySelectorAll('.lmd-panel h3')].map((h) => h.textContent.replace(/\s*Extra$/, '')));
  check('panel de ajustes', sections.join('|') === 'Apariencia|Lectura|Edición|Carpeta|Plugins de Markdown|CSS propio|Actualizaciones', sections);
  await page.close();

  console.log('Página propia de MD Tools');
  const app = await ctx.newPage(); watch(app);
  await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
  check('pantalla de inicio', (await app.locator('[data-home]').count()) === 2);
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
    img: document.querySelector('.markdown-body img').naturalWidth, katex: !!document.querySelector('.katex'), diagrams: document.querySelectorAll('.lmd-diagram svg').length,
  }));
  check('abre el README de la carpeta', opened.title === 'README.md', opened.title);
  check('links relativos y [[wiki]] pasan por la app', opened.links.length === 2 && opened.links.every((l) => l.startsWith('?f=')) && /sub%2Ftercero\.md$/.test(opened.links[1]), opened.links);
  check('imágenes relativas', opened.img === 40, opened.img);
  check('matemática y diagramas en la app', opened.katex && opened.diagrams === 2, opened);

  await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node');
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
  await Promise.all([app.waitForNavigation(), app.click('.lmd-tree-open')]); await app.waitForSelector('.lmd-home-item');
  check('recientes', /notas/.test(await app.textContent('.lmd-home-item')));

  const popup = await ctx.newPage(); watch(popup);
  await popup.goto(`chrome-extension://${id}/src/popup.html`); await popup.waitForTimeout(600);
  check('popup', (await popup.locator('#open-app').count()) === 1 && (await popup.locator('[data-key]').count()) === 1);
  check('sin errores de JavaScript', errors.length === 0, errors);
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
