// Una sola pantalla: la barra lateral y el centro siempre a la vista, cambiar de nota sin recargar la página,
// atrás y adelante, y quedarse en la app al eliminar la nota abierta. Y la barra lateral: el índice arriba y el
// explorador abajo, con sus raíces, lo reciente, la búsqueda en todo y el árbol que arranca en la raíz del repositorio.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const home = `chrome-extension://${id}/src/app.html`;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(autoDialogs);
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
  await app.waitForSelector('.lmd-node');
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
  await app.waitForSelector('.lmd-node');
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
  await app.waitForSelector('.lmd-node:has-text("datos.csv")');
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

  console.log('Barra lateral: índice arriba, explorador abajo');
  await app.goto(base + 'otra.md'); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  const zones = () => app.evaluate(() => { const h = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height); return { tabs: document.querySelectorAll('.lmd-tab').length, outline: h('.lmd-pane-outline'), files: h('.lmd-pane-files'), search: Math.round(document.querySelector('.lmd-search').getBoundingClientRect().top), outlineTop: Math.round(document.querySelector('.lmd-zone-outline').getBoundingClientRect().top), filesTop: Math.round(document.querySelector('.lmd-zone-files').getBoundingClientRect().top) }; });
  let z = await zones();
  check('sin pestañas: el buscador arriba, después el índice y debajo el explorador, los dos a la vista', z.tabs === 0 && z.outline > 80 && z.files > 80 && z.search < z.outlineTop && z.outlineTop < z.filesTop, z);
  const roots = await app.evaluate(() => [...document.querySelectorAll('.lmd-xroot')].map((s) => s.dataset.root + ':' + s.querySelector('.lmd-tree-path').textContent));
  check('el explorador lista las raíces en orden: la carpeta del disco y las notas del navegador', roots.join('|') === 'disk:pantalla|local:En este navegador', roots);
  const icons = await app.evaluate(() => [...document.querySelectorAll('.lmd-xroot a.lmd-node')].map((n) => n.closest('.lmd-xroot').dataset.root + ':' + n.querySelector('.lmd-node-where').title).filter((v, i, a) => a.indexOf(v) === i));
  check('cada archivo lleva el ícono de dónde está guardado', J(icons) === J(['disk:En el disco', 'local:En este navegador']), icons);
  // La división se arrastra y cada zona se pliega; las dos cosas se recuerdan.
  const split = await app.locator('.lmd-split').boundingBox();
  await app.mouse.move(split.x + 40, split.y + 3); await app.mouse.down(); await app.mouse.move(split.x + 40, split.y + 123, { steps: 4 }); await app.mouse.up();
  const z2 = await zones();
  check('arrastrar la división agranda el índice y achica el explorador', z2.outline > z.outline + 80 && z2.files < z.files - 80, [z, z2]);
  await app.click('[data-zone-tog=outline]');
  const z3 = await zones();
  check('plegar el índice le deja todo el alto al explorador', z3.outline === 0 && z3.files > z2.files + z2.outline - 10, z3);
  await app.reload(); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  check('el índice plegado se recuerda al recargar', (await zones()).outline === 0 && (await app.getAttribute('[data-zone-tog=outline]', 'aria-expanded')) === 'false');
  await app.click('[data-zone-tog=outline]');
  const z4 = await zones();
  check('y al desplegarlo vuelve con el reparto que se había dejado', Math.abs(z4.outline - z2.outline) < 12, [z2, z4]);
  await app.click('.lmd-xroot[data-root=local] .lmd-root-tog');
  check('una raíz se pliega desde su encabezado', await app.evaluate(() => document.querySelector('.lmd-xroot[data-root=local] .lmd-tree').getBoundingClientRect().height === 0));
  await app.click('.lmd-xroot[data-root=local] .lmd-root-tog');
  await app.goto(home); await app.waitForSelector('.lmd-home [data-home=new]'); await app.waitForSelector('.lmd-xroot[data-root=local] .lmd-node');
  const noDoc = await app.evaluate(() => ({ outline: document.querySelector('.lmd-zone-outline').getBoundingClientRect().height, files: document.querySelector('.lmd-pane-files').getBoundingClientRect().height, local: [...document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node')].map((n) => n.textContent.trim()), disk: document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-path').textContent }));
  check('sin nota abierta el índice no ocupa lugar y el explorador ya lista las notas del navegador', noDoc.outline === 0 && noDoc.files > 300 && noDoc.local.includes('uno.md') && noDoc.local.includes('dos.md') && noDoc.disk === 'pantalla', noDoc);

  console.log('Crear y abrir desde el explorador');
  await app.evaluate(() => { window.__mark = 'misma página'; });
  await app.click('.lmd-tree-add'); await app.waitForSelector('.lmd-menu [data-f=new]');
  const addMenu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f + ':' + b.textContent));
  await app.click('.lmd-menu [data-f=new]'); await app.waitForSelector('.lmd-draft');
  const made = await app.evaluate(() => ({ mark: window.__mark, url: location.search, active: document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node.lmd-active').length, editing: document.documentElement.classList.contains('lmd-editing') }));
  check('el "+" del explorador ofrece nota en blanco, desde una plantilla y carpeta', J(addMenu) === J(['new:Nota en blanco', 'tpl:Desde una plantilla…', 'dir:Carpeta']), addMenu);
  check('la nota en blanco nace donde van las notas nuevas y queda abierta en edición, sin recargar', made.mark === 'misma página' && /f=local%2Fnota-/.test(made.url) && made.active === 1 && made.editing, made);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
  await app.evaluate(() => { window.__answer = 'apuntes'; });
  await app.click('.lmd-xroot[data-root=disk] .lmd-tree-new'); await app.click('.lmd-menu [data-f=dir]');
  await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node-dir:has-text("apuntes")');
  await app.evaluate(() => { window.__answer = 'adentro'; });
  await app.locator('.lmd-xroot[data-root=disk] .lmd-node-dir', { hasText: 'apuntes' }).click({ button: 'right' }); await app.click('.lmd-menu [data-f=new]');
  await app.waitForFunction(() => document.title === 'adentro.md'); await app.waitForSelector('.lmd-node-kids .lmd-node.lmd-active');
  const inDir = await app.evaluate(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('pantalla')).getDirectoryHandle('apuntes'); const out = []; for await (const [n] of d.entries()) out.push(n); return { files: out, url: decodeURIComponent(location.search), open: !!document.querySelector('.lmd-node-dir.lmd-open + .lmd-node-kids .lmd-node.lmd-active') }; });
  check('"Carpeta" crea una carpeta en el disco, y crear dentro de ella crea ahí', J(inDir.files) === J(['adentro.md']) && /apuntes\/adentro\.md$/.test(inDir.url) && inDir.open, inDir);
  await app.click('.lmd-tree-open'); await app.waitForSelector('.lmd-menu [data-f=dir]');
  check('"abrir" ofrece otra carpeta u otro archivo', J(await app.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f))) === J(['dir', 'file']));
  await app.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('segunda', { create: true });
    const h = await dir.getFileHandle('LEEME.md', { create: true }); const s = await h.createWritable(); await s.write('# Segunda carpeta\n\nCon una zanahoria más.\n'); await s.close();
    window.showDirectoryPicker = async () => dir;
  });
  await app.click('.lmd-menu [data-f=dir]'); await app.waitForFunction(() => document.title === 'LEEME.md'); await app.waitForSelector('.lmd-xroot[data-root=recent] .lmd-node');
  const second = await app.evaluate(() => ({ mark: window.__mark, disk: document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-path').textContent, recent: [...document.querySelectorAll('.lmd-xroot[data-root=recent] .lmd-node-name')].map((n) => n.textContent), order: [...document.querySelectorAll('.lmd-xroot')].map((s) => s.dataset.root).join() }));
  check('abrir otra carpeta la pone en el explorador y deja la anterior en Recientes', second.mark === 'misma página' && second.disk === 'segunda' && J(second.recent) === J(['pantalla']) && second.order === 'disk,local,recent', second);

  console.log('Buscar en todo');
  await app.fill('.lmd-search input', 'zanahoria');
  await app.waitForFunction(() => /\d/.test((document.querySelector('.lmd-results-sum') || {}).textContent || ''), null, { timeout: 15000 });
  await app.evaluate(() => LMD.store.notePut('huerta.md', '# Huerta\n\nSembrar zanahoria en marzo.\n'));
  await app.fill('.lmd-search input', '');
  await app.reload(); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-xroot[data-root=local] .lmd-node:has-text("huerta.md")');
  await app.evaluate(() => { window.__mark = 'misma página'; });
  await app.fill('.lmd-search input', 'zanahoria');
  await app.waitForFunction(() => /\d/.test((document.querySelector('.lmd-results-sum') || {}).textContent || ''), null, { timeout: 15000 });
  const res = await app.evaluate(() => ({ doc: document.querySelector('.lmd-res-doc').textContent, count: document.querySelector('.lmd-search-count').textContent, roots: [...document.querySelectorAll('.lmd-res-root')].map((r) => r.dataset.root + ':' + r.textContent), files: [...document.querySelectorAll('.lmd-res-file .lmd-res-name')].map((n) => n.textContent), outline: document.querySelector('.lmd-pane-outline').getBoundingClientRect().height > 40, tree: document.querySelector('.lmd-tree-box').hidden }));
  check('con texto busca en la nota abierta y lo cuenta arriba de los resultados', /^En esta nota\s*1$/.test(res.doc) && res.count === '1 / 1' && res.outline, res);
  check('y en los archivos de cada raíz, diciendo de dónde viene cada resultado', J(res.roots) === J(['disk:segunda', 'local:En este navegador']) && J(res.files) === J(['LEEME.md', 'huerta.md']) && res.tree, res);
  await app.locator('.lmd-res-file', { hasText: 'huerta.md' }).click(); await app.waitForFunction(() => document.title === 'huerta.md'); await app.waitForTimeout(300);
  const hop = await app.evaluate(() => ({ mark: window.__mark, kept: [...document.querySelectorAll('.lmd-res-file .lmd-res-name')].map((n) => n.textContent), here: [...document.querySelectorAll('.lmd-res-here .lmd-res-name')].map((n) => n.textContent), doc: document.querySelector('.lmd-res-doc .lmd-res-count').textContent }));
  check('abrir un resultado de otra raíz deja la lista de resultados y marca la nota abierta', hop.mark === 'misma página' && J(hop.kept) === J(['LEEME.md', 'huerta.md']) && J(hop.here) === J(['huerta.md']) && hop.doc === '1', hop);
  await app.fill('.lmd-search input', ''); await app.waitForSelector('.lmd-xroot[data-root=local] .lmd-root-tog'); await app.click('.lmd-xroot[data-root=local] .lmd-root-tog');
  await app.fill('.lmd-search input', 'zanahoria');
  await app.waitForFunction(() => /\d/.test((document.querySelector('.lmd-results-sum') || {}).textContent || ''), null, { timeout: 15000 });
  const folded = await app.evaluate(() => [...document.querySelectorAll('.lmd-res-root')].map((r) => r.dataset.root));
  check('una raíz plegada no entra en la búsqueda', J(folded) === J(['disk']), folded);
  await app.fill('.lmd-search input', ''); await app.click('.lmd-xroot[data-root=local] .lmd-root-tog');

  console.log('Recientes');
  await app.locator('.lmd-xroot[data-root=recent] .lmd-node', { hasText: 'pantalla' }).click(); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-root-tog[title^="pantalla"]'); await app.waitForFunction(() => document.title === 'adentro.md');
  const again = await app.evaluate(() => ({ mark: window.__mark, title: document.title, recent: [...document.querySelectorAll('.lmd-xroot[data-root=recent] .lmd-node-name')].map((n) => n.textContent) }));
  check('un reciente vuelve a abrir esa carpeta en su última nota, sin recargar', again.mark === 'misma página' && again.title === 'adentro.md' && J(again.recent) === J(['segunda']), again);
  await app.hover('.lmd-xroot[data-root=recent] .lmd-recent'); await app.click('.lmd-xroot[data-root=recent] .lmd-node-x');
  await app.waitForFunction(() => !document.querySelector('.lmd-xroot[data-root=recent]'));
  check('la cruz lo quita de la lista', (await app.evaluate(async () => (await LMD.store.rootsAll()).map((r) => r.name))).join() === 'pantalla');

  console.log('Raíz del árbol en el disco');
  await app.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('trabajo', { create: true });
    const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
    const repo = await dir.getDirectoryHandle('repo', { create: true });
    await write(await repo.getDirectoryHandle('.git', { create: true }), 'HEAD', 'ref: refs/heads/main\n');
    await write(repo, 'README.md', '# Repo\n');
    await write(await (await repo.getDirectoryHandle('docs', { create: true })).getDirectoryHandle('guia', { create: true }), 'pasos.md', '# Pasos\n');
    await write(await (await dir.getDirectoryHandle('suelto', { create: true })).getDirectoryHandle('notas', { create: true }), 'una.md', '# Una\n');
    await write(dir, 'LEEME.md', '# Trabajo\n');
    window.showDirectoryPicker = async () => dir;
  });
  await app.click('.lmd-tree-open'); await app.click('.lmd-menu [data-f=dir]'); await app.waitForFunction(() => document.title === 'LEEME.md');
  const work = app.url().replace(/LEEME\.md$/, '');
  const treeNow = () => app.evaluate(() => ({ head: document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-path').textContent, top: [...document.querySelectorAll('.lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node')].map((n) => n.textContent.trim()), open: [...document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node-dir.lmd-open')].map((n) => n.textContent.trim()), active: [...document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node.lmd-active')].filter((n) => n.offsetParent).map((n) => n.textContent.trim()), up: !!document.querySelector('.lmd-xroot[data-root=disk] .lmd-tree-up:not(.lmd-tree-new)') }));
  await app.goto(work + encodeURIComponent('repo/docs/guia/pasos.md')); await app.waitForFunction(() => document.title === 'pasos.md'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  let t = await treeNow();
  check('un archivo dentro de un repositorio: el árbol arranca en la raíz del repo, con su rama desplegada', t.head === 'repo' && J(t.top) === J(['docs', 'README.md']) && J(t.open) === J(['docs', 'guia']) && J(t.active) === J(['pasos.md']) && t.up, t);
  await app.goto(work + encodeURIComponent('suelto/notas/una.md')); await app.waitForFunction(() => document.title === 'una.md'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  t = await treeNow();
  check('sin repositorio arranca en la carpeta del archivo', t.head === 'notas' && J(t.top) === J(['una.md']) && t.up, t);
  await app.click('.lmd-xroot[data-root=disk] .lmd-tree-up:not(.lmd-tree-new)'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-tree-path:has-text("suelto")');
  await app.click('.lmd-xroot[data-root=disk] .lmd-tree-up:not(.lmd-tree-new)'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-tree-path:has-text("trabajo")');
  t = await treeNow();
  check('la flecha sube hasta la carpeta elegida y no más', t.head === 'trabajo' && !t.up && t.top.includes('repo') && t.top.includes('suelto') && J(t.active) === J(['una.md']), t);
  await app.goto(work + encodeURIComponent('suelto/notas/una.md')); await app.waitForFunction(() => document.title === 'una.md'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  t = await treeNow();
  check('hasta dónde se subió se recuerda para esa carpeta', t.head === 'trabajo' && J(t.active) === J(['una.md']), t);
  await app.evaluate(() => { window.__mark = 'misma página'; });
  await app.locator('.lmd-xroot[data-root=disk] .lmd-node-dir', { hasText: 'repo' }).click(); await app.locator('.lmd-xroot[data-root=disk] .lmd-node', { hasText: 'README.md' }).click(); await app.waitForFunction(() => document.title === 'README.md');
  t = await treeNow();
  check('pasar a otra nota del mismo árbol no lo mueve de lugar', t.head === 'trabajo' && J(t.active) === J(['README.md']) && (await mark()) === 'misma página', t);

  console.log('Desde una plantilla');
  await app.goto(home); await app.waitForSelector('.lmd-home [data-home=tpl]');
  await app.evaluate(() => { window.__mark = 'misma página'; });
  await app.click('[data-home=tpl]'); await app.waitForSelector('.lmd-tpl-card');
  const picker = await app.evaluate(() => ({ groups: [...document.querySelectorAll('.lmd-tpl-list .lmd-menu-label')].map((n) => n.textContent), rows: document.querySelectorAll('.lmd-tpl-list [data-id]').length, on: [...document.querySelectorAll('.lmd-tpl-list .lmd-on')].map((n) => n.textContent),
    prev: [...document.querySelectorAll('.lmd-tpl-prev h1, .lmd-tpl-prev h2')].map((n) => n.tagName + ':' + n.textContent.trim()), raw: /^#\s|\{\{date\}\}/m.test(document.querySelector('.lmd-tpl-prev').textContent), focus: document.activeElement.tagName, native: 0 }));
  check('el selector trae los cinco grupos con sus 26 plantillas y la primera elegida', J(picker.groups) === J(['Día a día', 'Proyectos', 'Equipo', 'Producto y desarrollo', 'Personal']) && picker.rows === 26 && J(picker.on) === J(['Nota diaria']) && picker.focus === 'INPUT', picker);
  check('la vista previa muestra el contenido ya formateado, con la fecha puesta', picker.prev.length >= 3 && /^H1:\d{4}-\d{2}-\d{2}$/.test(picker.prev[0]) && picker.prev.includes('H2:Hoy') && !picker.raw, picker.prev);
  await app.keyboard.type('reunion');
  const filtered = await app.evaluate(() => ({ rows: [...document.querySelectorAll('.lmd-tpl-list [data-id]')].map((n) => n.textContent), groups: document.querySelectorAll('.lmd-tpl-list .lmd-menu-label').length, on: document.querySelector('.lmd-tpl-list .lmd-on').textContent, h1: document.querySelector('.lmd-tpl-prev h1').textContent.trim() }));
  check('escribir filtra, sin fijarse en los acentos, y la vista previa sigue a la elegida', filtered.rows.length >= 1 && filtered.rows.length < 6 && filtered.rows.every((t) => /reuni/i.test(t)) && filtered.on === filtered.rows[0] && filtered.h1.length > 0, filtered);
  await app.fill('.lmd-tpl-card input', 'zzzz');
  check('sin coincidencias lo dice y no deja crear', /Ninguna plantilla coincide/.test(await app.textContent('.lmd-tpl-list')) && await app.isDisabled('[data-tpl=ok]'));
  await app.fill('.lmd-tpl-card input', ''); await app.keyboard.press('ArrowDown'); await app.keyboard.press('ArrowDown'); await app.keyboard.press('ArrowUp');
  const chosen = await app.evaluate(() => ({ on: document.querySelector('.lmd-tpl-list .lmd-on').dataset.id, all: [...document.querySelectorAll('.lmd-tpl-list [data-id]')].map((n) => n.dataset.id) }));
  check('las flechas recorren la lista', chosen.on === chosen.all[1], chosen);
  const want = await app.evaluate((id) => LMD.templates.get(id), chosen.on);
  await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-tpl-card', { state: 'detached' }); await app.waitForSelector('html.lmd-editing .markdown-body h1');
  const born = await app.evaluate(async () => ({ mark: window.__mark, title: document.title, url: decodeURIComponent(location.search), note: ((await LMD.store.noteGet(document.title)) || {}).text, drafts: document.querySelectorAll('.lmd-draft').length, active: [...document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node.lmd-active')].map((n) => n.title) }));
  check('Enter crea la nota con el nombre sugerido y el contenido de la plantilla, y la abre en edición', born.mark === 'misma página' && born.title === want.file + '.md' && born.url === '?f=local/' + want.file + '.md' && born.note === want.text && born.drafts === 0 && J(born.active) === J([born.title]), [born, want.file]);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
  await app.click('.lmd-tree-add'); await app.click('.lmd-menu [data-f=tpl]'); await app.waitForSelector('.lmd-tpl-card');
  await app.click('.lmd-tpl-list [data-id=' + chosen.on + ']'); await app.click('[data-tpl=ok]'); await app.waitForFunction((t) => document.title === t, want.file + '-2.md');
  check('el nombre sugerido no pisa a una nota que ya existe', (await app.evaluate(async (n) => !!(await LMD.store.noteGet(n + '.md')) && !!(await LMD.store.noteGet(n + '-2.md')), want.file)) === true);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
  await app.locator('.lmd-xroot[data-root=disk] .lmd-node-dir', { hasText: 'suelto' }).click({ button: 'right' }); await app.click('.lmd-menu [data-f=tpl]'); await app.waitForSelector('.lmd-tpl-card');
  await app.fill('.lmd-tpl-card input', 'reunion'); const meet = await app.evaluate(() => LMD.templates.get(document.querySelector('.lmd-tpl-list .lmd-on').dataset.id));
  await app.keyboard.press('Enter'); await app.waitForFunction((t) => document.title === t, meet.file + '.md');
  const onDisk = await app.evaluate(async (n) => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('trabajo')).getDirectoryHandle('suelto'); return { text: await (await (await d.getFileHandle(n)).getFile()).text(), url: decodeURIComponent(location.search), editing: document.documentElement.classList.contains('lmd-editing') }; }, meet.file + '.md');
  check('desde una carpeta del explorador, la plantilla se crea en esa carpeta', onDisk.text === meet.text && new RegExp('/suelto/' + meet.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.md$').test(onDisk.url) && onDisk.editing, onDisk.url);
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
  await app.click('.lmd-tree-add'); await app.click('.lmd-menu [data-f=tpl]'); await app.waitForSelector('.lmd-tpl-card'); await app.keyboard.press('Escape');
  check('Escape cierra el selector sin crear nada', (await app.locator('.lmd-tpl-card').count()) === 0 && (await app.title()) === meet.file + '.md');

  console.log('Diálogos propios');
  const manual = (on) => app.evaluate((v) => { window.__manual = v; }, on);
  const inWork = () => app.evaluate(async () => { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('trabajo')).getDirectoryHandle('repo'); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); });
  await app.goto(work + encodeURIComponent('repo/README.md')); await app.waitForFunction(() => document.title === 'README.md'); await app.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  await manual(true); await app.evaluate(() => { window.__mark = 'misma página'; });
  const readme = app.locator('.lmd-xroot[data-root=disk] .lmd-node.lmd-active');
  await readme.click({ button: 'right' }); await app.click('.lmd-menu [data-f=ren]'); await app.waitForSelector('.lmd-dlg input');
  const dlg = await app.evaluate(() => { const i = document.querySelector('.lmd-dlg input'); return { title: document.querySelector('.lmd-dlg h3').textContent, value: i.value, picked: i.value.slice(i.selectionStart, i.selectionEnd), focus: document.activeElement === i, buttons: [...document.querySelectorAll('.lmd-dlg [data-dlg]')].map((b) => b.textContent), modal: document.querySelector('.lmd-dlg-card').getAttribute('aria-modal') }; });
  check('renombrar abre un diálogo propio con el nombre cargado y lo de antes de la extensión seleccionado', J(dlg) === J({ title: 'Renombrar', value: 'README.md', picked: 'README', focus: true, buttons: ['Cancelar', 'Renombrar'], modal: 'true' }), dlg);
  await app.keyboard.type('mal:nombre'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-dlg-err:not([hidden])');
  const bad = await app.evaluate(() => ({ err: document.querySelector('.lmd-dlg-err').textContent, invalid: document.querySelector('.lmd-dlg input').getAttribute('aria-invalid'), open: !!document.querySelector('.lmd-dlg'), value: document.querySelector('.lmd-dlg input').value }));
  check('un nombre que no sirve se avisa en el diálogo, sin cerrarlo ni borrar lo escrito', /caracteres que no se pueden usar/.test(bad.err) && bad.invalid === 'true' && bad.open && bad.value === 'mal:nombre.md', bad);
  await app.fill('.lmd-dlg input', ''); await app.keyboard.press('Enter');
  check('vacío también avisa', /Escribí un nombre/.test(await app.textContent('.lmd-dlg-err')) && (await inWork()).includes('README.md'));
  await app.fill('.lmd-dlg input', 'otro'); await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-dlg', { state: 'detached' });
  check('Escape cancela: no cambia nada', (await inWork()).includes('README.md') && (await app.title()) === 'README.md');
  await readme.click({ button: 'right' }); await app.click('.lmd-menu [data-f=ren]'); await app.waitForSelector('.lmd-dlg input');
  await app.keyboard.type('LEEME'); await app.keyboard.press('Enter'); await app.waitForFunction(() => document.title === 'LEEME.md');
  check('Enter confirma: el archivo abierto queda con su nombre nuevo', J(await inWork()) === J(['.git', 'LEEME.md', 'docs']) && (await mark()) === 'misma página', await inWork());
  await app.locator('.lmd-xroot[data-root=disk] .lmd-node.lmd-active').click({ button: 'right' }); await app.click('.lmd-menu [data-f=del]'); await app.waitForSelector('.lmd-dlg');
  const ask = await app.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent, ok: document.querySelector('.lmd-dlg [data-dlg=ok]').textContent, danger: document.querySelector('.lmd-dlg [data-dlg=ok]').classList.contains('lmd-btn-danger'), input: document.querySelectorAll('.lmd-dlg input').length }));
  check('eliminar pregunta en un diálogo propio, y el botón dice qué pasa', J(ask) === J({ title: '¿Eliminar "LEEME.md"?', text: 'No se puede deshacer.', ok: 'Eliminar', danger: true, input: 0 }), ask);
  await app.click('.lmd-dlg [data-dlg=no]'); await app.waitForSelector('.lmd-dlg', { state: 'detached' });
  check('Cancelar deja el archivo', (await inWork()).includes('LEEME.md') && (await app.title()) === 'LEEME.md');
  await app.locator('.lmd-xroot[data-root=disk] .lmd-node.lmd-active').click({ button: 'right' }); await app.click('.lmd-menu [data-f=del]'); await app.waitForSelector('.lmd-dlg');
  await app.click('.lmd-dlg [data-dlg=ok]'); await app.waitForSelector('.lmd-home [data-home=new]');
  check('y confirmar lo elimina, sin salir de la app', !(await inWork()).includes('LEEME.md') && (await mark()) === 'misma página');
  await manual(false);
  const natives = [];
  for (const f of fs.readdirSync(path.join(root, 'src')).filter((n) => n.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    (code.match(/(window\.|[^.\w])(prompt|alert|confirm)\(/g) || []).forEach((m) => { if (f !== 'dialog.js') natives.push(f + ': ' + m.trim()); });
  }
  check('en src no queda ningún prompt, alert ni confirm del navegador', natives.length === 0, natives);
  check('y ninguno se abrió durante la prueba', J(await app.evaluate(() => window.__native)) === '[]');

  console.log('Pulido');
  // Aviso de versión nueva: un renglón con sus acciones, y el cómo al pasar el mouse.
  await app.evaluate(() => new Promise((r) => chrome.storage.local.set({ update: { latest: '99.0.0', checkedAt: Date.now() } }, r)));
  await app.goto(home); await app.waitForSelector('.lmd-update:not([hidden])');
  const up = await app.evaluate(() => { const u = document.querySelector('.lmd-update'); return { h: Math.round(u.getBoundingClientRect().height), text: u.querySelector('.lmd-update-text').textContent, acts: [...u.querySelectorAll('a, button')].map((b) => b.dataset.act || 'zip'), blocks: u.querySelectorAll('p, strong').length, how: u.title, wide: u.scrollWidth > u.clientWidth + 1 }; });
  check('el aviso de versión nueva es un renglón con sus acciones', up.h <= 32 && up.text === 'Versión nueva: 99.0.0' && J(up.acts) === J(['zip', 'update-apply', 'update-later']) && up.blocks === 0 && /git pull/.test(up.how) && !up.wide, up);
  await app.click('[data-act=update-later]'); await app.waitForTimeout(400);
  check('"Ahora no" lo saca y queda anotado', (await app.evaluate(() => document.querySelector('.lmd-update').hidden)) && (await app.evaluate(() => new Promise((r) => chrome.storage.local.get('update', (x) => r(x.update.dismissed))))) === '99.0.0');

  // El pie nombra la recarga automática solo donde hay un archivo que otro programa puede cambiar.
  await app.click('[data-home=new]'); await app.waitForSelector('.lmd-draft'); await app.waitForTimeout(2300);
  const footLocal = await app.textContent('.lmd-status');
  await app.goto(base + 'README.md'); await app.waitForSelector('.markdown-body h1'); await app.waitForTimeout(2300);
  const footDisk = await app.textContent('.lmd-status');
  check('el pie dice "recarga automática" en un archivo del disco y no en una nota del navegador', footLocal === '' && footDisk === 'Recarga automática activa', [footLocal, footDisk]);

  // La barra de la tabla no se monta sobre el pie ni sobre la celda que se escribe.
  await app.evaluate(() => LMD.store.notePut('tabla.md', '# Tabla\n\n' + 'Relleno.\n\n'.repeat(30) + '| ' + Array.from({ length: 10 }, (_, i) => 'Columna bien larga número ' + (i + 1)).join(' | ') + ' |\n|' + ' --- |'.repeat(10) + '\n' + Array.from({ length: 6 }, (_, r) => '| ' + Array.from({ length: 10 }, (_, i) => 'f' + r + 'c' + i).join(' | ') + ' |').join('\n') + '\n\n' + 'Más relleno.\n\n'.repeat(30)));
  await app.goto(home + '?f=' + encodeURIComponent('local/tabla.md')); await app.waitForSelector('.markdown-body table');
  if (!(await app.evaluate(() => document.documentElement.classList.contains('lmd-editing')))) { await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300); }
  await app.evaluate(() => { const cell = [...document.querySelectorAll('.lmd-article td.lmd-cell')].find((c) => c.textContent === 'f5c0'); const foot = document.querySelector('.lmd-foot').getBoundingClientRect(); window.scrollBy(0, cell.getBoundingClientRect().bottom - (foot.top - 10)); });
  await app.waitForTimeout(300);
  await app.locator('.lmd-article td.lmd-cell', { hasText: 'f5c0' }).click(); await app.waitForTimeout(300);
  const measure = () => app.evaluate(() => { const b = document.querySelector('.lmd-tablebar'); const r = b.getBoundingClientRect(); const f = document.querySelector('.lmd-foot').getBoundingClientRect(); const c = document.activeElement.getBoundingClientRect(); const t = document.querySelector('.lmd-topbar').getBoundingClientRect();
    return { shown: !b.hidden, foot: r.bottom <= f.top, top: r.top >= t.bottom, cell: r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right, inside: r.left >= 0 && r.right <= innerWidth, at: [Math.round(r.top), Math.round(r.bottom), Math.round(f.top), Math.round(c.top), Math.round(c.bottom)] }; });
  const low = await measure();
  check('con la celda cerca del borde de abajo, la barra de la tabla no pisa el pie ni la celda', low.shown && low.foot && low.top && low.cell && low.inside, low);
  await app.mouse.wheel(0, -160); await app.waitForTimeout(400);
  const moved = await measure();
  check('al mover la página la barra acompaña a la tabla', moved.shown && moved.foot && moved.top && moved.cell && moved.at[0] !== low.at[0], [low.at, moved.at]);
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(500);

  // Ventanas: el foco entra, Tab no se sale, Escape cierra y el foco vuelve a donde estaba.
  await app.focus('[data-act=settings]'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-panel-card');
  const inPanel = () => app.evaluate(() => !!document.activeElement.closest('.lmd-panel'));
  const entered = await inPanel(); let stayed = true;
  for (let i = 0; i < 45; i++) { await app.keyboard.press(i % 9 === 8 ? 'Shift+Tab' : 'Tab'); if (!(await inPanel())) stayed = false; }
  await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  const back = await app.evaluate(() => [document.querySelector('.lmd-panel').hidden, document.activeElement.dataset.act, document.querySelector('.lmd-panel-card').getAttribute('aria-modal')]);
  check('Ajustes: el foco entra, Tab no se sale, y Escape cierra y lo devuelve al botón', entered && stayed && J(back) === J([true, 'settings', 'true']), [entered, stayed, back]);
  await app.goto(home); await app.waitForSelector('.lmd-home [data-home=feedback]');
  await app.focus('[data-home=feedback]'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-fb'); await app.waitForTimeout(200);
  const fb = await app.evaluate(() => [document.querySelector('.lmd-fb').getAttribute('aria-modal'), !!document.activeElement.closest('.lmd-fb')]);
  await app.keyboard.press('Tab'); await app.keyboard.press('Tab'); const fbStays = await app.evaluate(() => !!document.activeElement.closest('.lmd-fb'));
  await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  const fbGone = await app.evaluate(() => [!document.querySelector('.lmd-fb'), document.activeElement.dataset.home]);
  check('una ventana armada a mano (comentarios) cumple lo mismo', J(fb) === J(['true', true]) && fbStays && J(fbGone) === J([true, 'feedback']), [fb, fbStays, fbGone]);
  const labels = await app.evaluate(() => [document.querySelector('.lmd-o-tog, .lmd-anchor') ? 1 : 0, [...document.querySelectorAll('.lmd-top-right, .lmd-topbar .lmd-top-right')].length]);
  check('la barra de arriba lleva su clase con el prefijo de siempre', labels[1] >= 1 && !(await app.evaluate(() => document.querySelector('.lsharpmd'))), labels);

  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { check('sin excepciones en la prueba', false, String(e && e.stack || e).slice(0, 700)); }

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
