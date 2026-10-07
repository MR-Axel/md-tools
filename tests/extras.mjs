// Archivos desde el árbol, reemplazar, pegar imágenes, exportar a HTML y otros tipos de archivo.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(() => { window.prompt = () => window.__answer; window.confirm = () => true; });
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('x', { create: true });
  const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write(dir, 'README.md', '# Doc\n\nUna zanahoria y otra Zanahoria.\n\n$a^2$\n');
  await write(dir, 'viejo.md', '# Viejo\n');
  await write(dir, 'datos.csv', 'nombre,cantidad\n"Pérez, Ana",3\nLuis,5\n');
  await write(dir, 'conf.json', '{ "a": 1 }\n');
  await write(dir, 'punto.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="red"/></svg>');
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
const base = app.url().replace(/README\.md$/, '');
const names = () => app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('x'); const out = []; for await (const [n] of dir.entries()) out.push(n); return out.sort(); });
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const o = {};

await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node');
await app.evaluate(() => { window.__answer = 'nueva'; });
await Promise.all([app.waitForNavigation(), app.click('.lmd-tree-new')]); await app.waitForSelector('.markdown-body h1');
o.nuevo = { title: await app.title(), h1: await app.textContent('.markdown-body h1') };
await app.waitForSelector('.lmd-node');
await app.evaluate(() => { window.__answer = 'renombrada'; });
await app.locator('.lmd-node', { hasText: 'nueva.md' }).click({ button: 'right' });
await Promise.all([app.waitForNavigation(), app.click('.lmd-menu [data-f=ren]')]); await app.waitForSelector('.markdown-body h1');
o.renombrado = await app.title();
await app.waitForSelector('.lmd-node');
await app.locator('.lmd-node', { hasText: 'viejo.md' }).click({ button: 'right' }); await app.click('.lmd-menu [data-f=del]'); await app.waitForTimeout(800);
o.archivos = await names();
o.arbol = await app.evaluate(() => [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim()));

await app.goto(base + 'README.md'); await app.waitForSelector('.markdown-body h1'); await app.waitForTimeout(1500);
await app.click('.lmd-tab[data-tab=outline]'); await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
await app.fill('.lmd-search input', 'zanahoria'); await app.fill('.lmd-replace input', 'papa'); await app.click('[data-rep=all]'); await app.waitForTimeout(500);
o.reemplazo = (await src()).split('\n')[2];
await app.fill('.lmd-search input', ''); await app.click('.lmd-foot .lmd-status', { force: true }); await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.deshecho = (await src()).split('\n')[2];

await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End');
await app.evaluate(() => {
  const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'captura.png', { type: 'image/png' }));
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await app.waitForSelector('.lmd-article img[data-lmd-src]', { state: 'attached' }); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600);
o.imagen = (await src()).split('\n')[2];
o.assets = await app.evaluate(async () => { const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('x')).getDirectoryHandle('assets'); const out = []; for await (const [n] of dir.entries()) out.push(n); return out.length; });

await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card');
await app.click('[data-ptab=read]'); await app.click('input[data-key=focusMode]'); await app.click('input[data-key=typewriter]'); await app.waitForTimeout(500);
o.foco = await app.evaluate(() => document.documentElement.classList.contains('lmd-focus') && document.documentElement.classList.contains('lmd-typewriter'));
await app.click('[data-act=close-panel]');
const [dl] = await Promise.all([app.waitForEvent('download'), app.click('[data-act=export-html]')]);
const html = fs.readFileSync(await dl.path(), 'utf8');
o.html = { name: dl.suggestedFilename(), h1: /<h1[^>]*>Doc/.test(html), limpio: !/contenteditable|data-l=|lmd-add/.test(html), math: /<math/.test(html) && !/class="katex"/.test(html), img: /src="assets\/imagen-/.test(html) };
await app.keyboard.press('Control+s'); await app.waitForTimeout(800);

await app.goto(base + 'datos.csv'); await app.waitForSelector('.markdown-body table');
o.csv = await app.evaluate(() => [...document.querySelectorAll('.markdown-body tr')].map((tr) => [...tr.cells].map((c) => c.textContent)));
await app.goto(base + 'conf.json'); await app.waitForSelector('.markdown-body pre code');
o.json = await app.evaluate(() => ({ lang: (document.querySelector('.lmd-code-lang') || {}).textContent, hl: !!document.querySelector('.markdown-body pre code span') }));
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
o.jsonEdit = await app.evaluate(() => !document.querySelector('.lmd-raw-edit').hidden && !document.querySelector('.lmd-add'));
await app.goto(base + 'punto.svg'); await app.waitForSelector('.markdown-body img'); await app.waitForTimeout(600);
o.svg = await app.evaluate(() => document.querySelector('.markdown-body img').naturalWidth);

const J = (v) => JSON.stringify(v);
const checks = [
  ['archivo nuevo desde el árbol', o.nuevo.title === 'nueva.md' && o.nuevo.h1.startsWith('nueva'), o.nuevo],
  ['renombrar el archivo abierto', o.renombrado === 'renombrada.md', o.renombrado],
  ['eliminar un archivo', J(o.archivos) === J(['README.md', 'conf.json', 'datos.csv', 'punto.svg', 'renombrada.md']) && !o.arbol.includes('viejo.md'), o.archivos],
  ['reemplazar todo y deshacer', o.reemplazo === 'Una papa y otra papa.' && o.deshecho === 'Una zanahoria y otra Zanahoria.', [o.reemplazo, o.deshecho]],
  ['pegar una imagen la guarda en assets y la inserta', /^Una zanahoria y otra Zanahoria\.!\[\]\(assets\/imagen-\d{8}-\d{6}\.png\)$/.test(o.imagen) && o.assets === 1, o.imagen],
  ['modo foco y máquina de escribir', o.foco],
  ['exportar a HTML', o.html.name === 'README.html' && o.html.h1 && o.html.limpio && o.html.math && o.html.img, o.html],
  ['un CSV se ve como tabla', J(o.csv) === J([['nombre', 'cantidad'], ['Pérez, Ana', '3'], ['Luis', '5']]), o.csv],
  ['un JSON se ve resaltado y se edita como texto', o.json.lang === 'json' && o.json.hl && o.jsonEdit, o.json],
  ['una imagen se abre', o.svg === 40, o.svg],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Archivos y extras');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
