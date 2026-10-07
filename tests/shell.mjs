// Una sola pantalla: la barra lateral y el centro siempre a la vista, cambiar de nota sin recargar la página,
// atrás y adelante, y quedarse en la app al eliminar la nota abierta.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const home = `chrome-extension://${id}/src/app.html`;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(() => { window.confirm = () => true; });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const J = (v) => JSON.stringify(v);

try {
  console.log('Una sola pantalla');
  // La nube de verdad queda apagada: acá no se prueba la cuenta.
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  await app.goto(home); await app.waitForSelector('.lmd-home [data-home=new]');
  const empty = await app.evaluate(() => ({
    side: document.querySelector('.lmd-sidebar').getBoundingClientRect().width > 100, acts: [...document.querySelectorAll('.lmd-home-actions [data-home]')].map((b) => b.dataset.home),
    article: getComputedStyle(document.querySelector('.lmd-article')).display, bar: [...document.querySelectorAll('.lmd-topbar [data-act]')].filter((b) => b.offsetParent).map((b) => b.dataset.act), title: document.title,
  }));
  check('sin nota abierta: la barra lateral y el centro con las acciones', empty.side && empty.acts.includes('new') && empty.acts.includes('file') && empty.acts.includes('dir') && empty.article === 'none' && empty.title === 'SharpMD', empty);
  check('sin nota abierta la barra de arriba deja solo lo que sirve', J(empty.bar) === J(['sidebar', 'settings']), empty.bar);

  await app.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pantalla', { create: true });
    const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
    await write(dir, 'README.md', '# Inicio\n\nUn párrafo con un link a [la otra](otra.md#destino) y la palabra zanahoria.\n');
    await write(dir, 'otra.md', '# Otra\n\nTexto de la otra nota.\n\n' + 'Relleno.\n\n'.repeat(60) + '## Destino\n\nAcá llega el enlace, con otra zanahoria.\n\n' + 'Más relleno.\n\n'.repeat(60));
    await write(dir, 'borrable.md', '# Borrable\n');
    await write(dir, 'datos.csv', 'a,b\n1,2\n');
    window.showDirectoryPicker = async () => dir;
    window.__mark = 'misma página';
  });
  await app.click('[data-home=dir]'); await app.waitForSelector('.markdown-body h1');
  const base = app.url().replace(/README\.md$/, '');
  const mark = () => app.evaluate(() => window.__mark);
  const state = async () => ({ title: await app.title(), h1: await app.textContent('.markdown-body h1'), url: decodeURIComponent(app.url().split('?f=')[1] || '').split('/').slice(1).join('/'), mark: await mark() });
  const fileText = (name) => app.evaluate(async (n) => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('pantalla')).getFileHandle(n)).getFile()).text(), name);
  const node = (name) => app.locator('.lmd-node', { hasText: name }).first();
  check('abrir una carpeta no recarga la página', (await mark()) === 'misma página' && (await app.title()) === 'README.md' && /\?f=/.test(app.url()), await state());

  console.log('Cambiar de nota sin recargar');
  await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node');
  await node('otra.md').click(); await app.waitForFunction(() => document.title === 'otra.md');
  let s = await state();
  check('un archivo del árbol reemplaza la nota en el lugar', s.h1.startsWith('Otra') && s.url === 'otra.md' && s.mark === 'misma página', s);
  const shown = await app.evaluate(() => ({ doc: document.querySelector('.lmd-docname').textContent, active: [...document.querySelectorAll('.lmd-node.lmd-active')].map((n) => n.textContent.trim()), outline: [...document.querySelectorAll('.lmd-pane-outline a')].map((a) => a.textContent), state: document.querySelector('.lmd-savestate').textContent, y: window.scrollY }));
  check('se actualizan el título, el índice y el archivo marcado en el árbol', shown.doc === 'otra.md' && J(shown.active) === J(['otra.md']) && shown.outline.includes('Destino') && shown.y === 0, shown);
  await app.goBack(); await app.waitForFunction(() => document.title === 'README.md');
  s = await state();
  check('atrás vuelve a la nota anterior, sin recargar', s.h1.startsWith('Inicio') && s.url === 'README.md' && s.mark === 'misma página', s);
  await app.goForward(); await app.waitForFunction(() => document.title === 'otra.md');
  s = await state();
  check('adelante la trae de nuevo', s.h1.startsWith('Otra') && s.url === 'otra.md' && s.mark === 'misma página', s);
  await app.goBack(); await app.waitForFunction(() => document.title === 'README.md');

  await app.click('.markdown-body a:has-text("la otra")'); await app.waitForFunction(() => document.title === 'otra.md'); await app.waitForTimeout(400);
  const linked = await app.evaluate(() => ({ mark: window.__mark, top: Math.round(document.getElementById('destino').getBoundingClientRect().top), hash: location.hash }));
  check('un enlace interno abre la otra nota en su sección, sin recargar', linked.mark === 'misma página' && linked.top < 200 && linked.hash === '#destino', linked);

  await app.fill('.lmd-search input', 'zanahoria');
  await app.waitForFunction(() => /\d/.test((document.querySelector('.lmd-results-sum') || {}).textContent || ''), null, { timeout: 15000 });
  await app.locator('.lmd-res-file', { hasText: 'README.md' }).click(); await app.waitForFunction(() => document.title === 'README.md'); await app.waitForTimeout(300);
  const found = await app.evaluate(() => ({ mark: window.__mark, q: document.querySelector('.lmd-search input').value, hits: CSS.highlights.has('lmd-hit'), url: location.href }));
  check('un resultado de búsqueda abre la nota en el lugar y marca lo buscado', found.mark === 'misma página' && found.q === 'zanahoria' && found.hits && !/#lmd-q/.test(found.url), found);
  await app.fill('.lmd-search input', '');

  await app.reload(); await app.waitForSelector('.markdown-body h1');
  check('recargar la página deja la misma nota', (await app.title()) === 'README.md' && (await mark()) === undefined);
  await app.evaluate(() => { window.__mark = 'misma página'; });

  console.log('Salir de una nota');
  // Lo escrito se guarda antes de pasar a otra nota, y el modo edición sigue.
  await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node');
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' Escrito antes de salir.');
  await node('otra.md').click(); await app.waitForFunction(() => document.title === 'otra.md'); await app.waitForTimeout(300);
  const left = { saved: (await fileText('README.md')).split('\n')[2], other: (await fileText('otra.md')).split('\n')[0], editing: await app.evaluate(() => document.documentElement.classList.contains('lmd-editing')), dirty: await app.evaluate(() => document.documentElement.classList.contains('lmd-dirty')) };
  check('al cambiar de nota se guarda lo pendiente de la anterior', /Escrito antes de salir\.$/.test(left.saved) && left.other === '# Otra' && !left.dirty, left);
  check('el modo edición sigue al pasar a otra nota', left.editing === true, left);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);

  // Las notas del navegador se guardan solas a los 600 ms: el temporizador de una no escribe en la otra.
  await app.evaluate(() => Promise.all([LMD.store.notePut('uno.md', '# Uno\n\nPrimera.\n'), LMD.store.notePut('dos.md', '# Dos\n\nSegunda.\n')]));
  await app.goto(home + '?f=' + encodeURIComponent('local/uno.md')); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node');
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(200);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' Con cambios.');
  await node('dos.md').click(); await app.waitForFunction(() => document.title === 'dos.md'); await app.waitForTimeout(1500);
  const notes = await app.evaluate(async () => [(await LMD.store.noteGet('uno.md')).text, (await LMD.store.noteGet('dos.md')).text, document.querySelector('.lmd-savestate').textContent]);
  check('el autoguardado de la nota anterior no pisa a la nueva', /Primera\. Con cambios\./.test(notes[0]) && notes[1] === '# Dos\n\nSegunda.\n' && /Guardado en este navegador/.test(notes[2]), notes);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);

  console.log('Otros tipos de archivo');
  await app.goto(base + 'README.md'); await app.waitForSelector('.markdown-body h1');
  await app.evaluate(() => { window.__mark = 'misma página'; });
  await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=read]'); await app.click('input[data-key=filesOnlyMarkdown]'); await app.click('[data-act=close-panel]');
  await app.click('.lmd-tab[data-tab=files]'); await app.waitForSelector('.lmd-node:has-text("datos.csv")');
  await node('datos.csv').click(); await app.waitForSelector('.markdown-body table');
  const csv = await app.evaluate(() => ({ mark: window.__mark, cells: [...document.querySelectorAll('.markdown-body tr')].map((tr) => [...tr.cells].map((c) => c.textContent)), title: document.title }));
  check('un CSV también abre en el lugar, como tabla', csv.mark === 'misma página' && csv.title === 'datos.csv' && J(csv.cells) === J([['a', 'b'], ['1', '2']]), csv);

  console.log('Eliminar la nota abierta');
  await node('borrable.md').click(); await app.waitForFunction(() => document.title === 'borrable.md');
  await node('borrable.md').click({ button: 'right' }); await app.click('.lmd-menu [data-f=del]');
  await app.waitForSelector('.lmd-home [data-home=new]');
  const gone = await app.evaluate(async () => {
    const names = []; for await (const [n] of (await (await navigator.storage.getDirectory()).getDirectoryHandle('pantalla')).entries()) names.push(n);
    return { mark: window.__mark, url: location.href, title: document.title, side: document.querySelector('.lmd-sidebar').getBoundingClientRect().width > 100, tree: [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim()),
      article: getComputedStyle(document.querySelector('.lmd-article')).display, exists: names.includes('borrable.md'), sub: document.querySelector('.lmd-home-sub').textContent };
  });
  check('eliminar la nota abierta deja a la persona en la app, con el centro vacío', gone.mark === 'misma página' && gone.url === home && gone.title === 'SharpMD' && gone.article === 'none' && !gone.exists, gone);
  check('y el árbol sigue a la vista, sin el archivo borrado', gone.side && gone.tree.includes('otra.md') && !gone.tree.includes('borrable.md'), gone.tree);
  await node('otra.md').click(); await app.waitForFunction(() => document.title === 'otra.md');
  check('desde ahí se abre otra nota del árbol', (await mark()) === 'misma página' && (await app.textContent('.markdown-body h1')).startsWith('Otra'));
  await app.goBack(); await app.waitForSelector('.lmd-home [data-home=new]');
  check('atrás vuelve al centro vacío, no a la nota borrada', (await app.title()) === 'SharpMD' && app.url() === home, app.url());

  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { check('sin excepciones en la prueba', false, String(e && e.stack || e).slice(0, 700)); }

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
