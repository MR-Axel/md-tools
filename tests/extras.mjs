// Archivos desde el árbol, reemplazar, pegar imágenes, exportar a HTML y otros tipos de archivo.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(autoDialogs);
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
// Estas pruebas son del explorador como lista de notas: van con "Solo Markdown" prendido (de fábrica viene apagado).
await app.evaluate(() => LMD.patch({ filesOnlyMarkdown: true }));
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
// El "+" de una raíz del explorador despliega qué crear.
const create = async (root, what) => { await app.click('.lmd-xroot[data-root=' + root + '] .lmd-tree-new'); await app.click('.lmd-menu [data-f=' + (what || 'new') + ']'); };

await app.waitForSelector('.lmd-node');
await app.evaluate(() => { window.__answer = 'nueva'; });
await Promise.all([app.waitForNavigation(), create('disk')]); await app.waitForSelector('.markdown-body h1');
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
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
await app.fill('.lmd-search input', 'zanahoria'); await app.fill('.lmd-replace input', 'papa'); await app.click('[data-rep=all]'); await app.waitForTimeout(500);
o.reemplazo = (await src()).split('\n')[2];
await app.fill('.lmd-search input', ''); await app.click('.lmd-foot .lmd-status', { force: true }); await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.deshecho = (await src()).split('\n')[2];

await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End');
await app.evaluate(() => {
  const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], 'captura.png', { type: 'image/png' }));
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await app.waitForSelector('.lmd-article img[data-lmd-src]', { state: 'attached' }); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600);
o.imagen = (await src()).split('\n')[2];
o.assets = await app.evaluate(async () => { const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('x')).getDirectoryHandle('assets'); const out = []; for await (const [n] of dir.entries()) out.push(n); return out.length; });

await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card');
await app.click('[data-ptab=read]'); await app.click('input[data-key=focusMode]'); await app.click('input[data-key=typewriter]'); await app.waitForTimeout(500);
o.foco = await app.evaluate(() => document.documentElement.classList.contains('lmd-focus') && document.documentElement.classList.contains('lmd-typewriter'));
await app.click('[data-act=close-panel]');
// Recargar es para lo que vive en el disco: acá, una carpeta del disco, está a la vista.
o.recargar = await app.evaluate(() => !!document.querySelector('[data-act=reload]').offsetParent && !document.querySelector('[data-act=copy-md], [data-act=copy-rich], [data-act=print], [data-act=export-html]'));
await app.click('[data-act=export]'); await app.waitForSelector('.lmd-menu-export');
const [dl] = await Promise.all([app.waitForEvent('download'), app.click('.lmd-menu-export [data-more=export-html]')]);
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

// ---------- Renombrar desde el título, F2 y arrastrar en el árbol ----------
const said = async (re) => { await app.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 8000 }); return app.textContent('.lmd-foot .lmd-status'); };
const tree = () => app.evaluate(() => [...document.querySelectorAll('.lmd-node')].map((n) => n.textContent.trim()));
const node = (name) => app.locator('.lmd-node', { hasText: name }).first();
// Arrastra con el mouse y devuelve qué quedó marcado como destino antes de soltar.
const drag = async (from, to) => {
  await from.hover(); await app.mouse.down(); await to.hover(); await to.hover();
  const marked = await app.evaluate(() => { const m = document.querySelector('.lmd-drop'); return !m ? '' : m.dataset.url ? decodeURIComponent(m.dataset.url.replace(/\/$/, '').split('/').pop()) : 'raíz'; });
  await app.mouse.up();
  return marked;
};
const inFolder = () => app.evaluate(async () => { const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('x')).getDirectoryHandle('carpeta'); const out = []; for await (const [n] of dir.entries()) out.push(n); return out.sort(); });
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('x');
  const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write(dir, 'abierta.md', '# Abierta\n'); await write(dir, 'suelta.md', '# Suelta\n');
  await write(await dir.getDirectoryHandle('carpeta', { create: true }), 'dentro.md', '# Dentro\n');
});
await app.goto(base + 'abierta.md'); await app.waitForSelector('.markdown-body h1');
await app.waitForSelector('.lmd-node');
// Escape cancela, un nombre repetido avisa y Enter renombra dejando la nota abierta
await app.dblclick('.lmd-docname'); await app.waitForSelector('.lmd-docname-input');
o.tituloCampo = await app.evaluate(() => { const i = document.querySelector('.lmd-docname-input'); return [i.value, i.value.slice(i.selectionStart, i.selectionEnd), document.activeElement === i]; });
await app.keyboard.type('otra'); await app.keyboard.press('Escape'); await app.waitForTimeout(200);
o.tituloEscape = [await app.textContent('.lmd-docname'), await app.locator('.lmd-docname-input').count(), (await names()).includes('abierta.md')];
await app.dblclick('.lmd-docname'); await app.fill('.lmd-docname-input', 'README'); await app.keyboard.press('Enter');
o.tituloRepetido = [await said('Ya hay'), (await names()).includes('abierta.md')];
await app.dblclick('.lmd-docname'); await app.fill('.lmd-docname-input', 'titulada');
await Promise.all([app.waitForNavigation(), app.keyboard.press('Enter')]); await app.waitForSelector('.markdown-body h1');
o.titulo = [await app.title(), await app.textContent('.markdown-body h1'), (await names()).includes('titulada.md') && !(await names()).includes('abierta.md')];
// F2: sin nada en foco edita el título; sobre un archivo del árbol, renombra ese
await app.waitForSelector('.lmd-node'); await app.click('.lmd-foot .lmd-status', { force: true });
await app.keyboard.press('F2'); await app.waitForSelector('.lmd-docname-input'); await app.keyboard.press('Escape');
await app.evaluate(() => { window.__answer = 'movible'; });
await node('suelta.md').focus(); await app.keyboard.press('F2');
await app.waitForFunction(() => [...document.querySelectorAll('.lmd-node')].some((n) => n.textContent.trim() === 'movible.md'));
o.f2 = [(await names()).includes('movible.md'), !(await names()).includes('suelta.md'), await app.title()];
// arrastrar un archivo a una carpeta lo mueve; soltarlo en su misma carpeta no hace nada
o.arrastreMismo = [await drag(node('movible.md'), app.locator('.lmd-xroot[data-root=disk] .lmd-tree-head')), (await names()).includes('movible.md')];
o.arrastreMarca = await drag(node('movible.md'), node('carpeta'));
await app.waitForFunction(() => ![...document.querySelectorAll('.lmd-tree > .lmd-node')].some((n) => n.textContent.trim() === 'movible.md'));
o.arrastre = [await inFolder(), (await names()).includes('movible.md'), await app.title()];
// arrastrar la nota abierta la deja abierta en su ruta nueva, y de vuelta a la raíz también
const [, mark1] = await Promise.all([app.waitForNavigation(), drag(node('titulada.md'), node('carpeta'))]); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node');
o.arrastreAbierta = [mark1, /carpeta%2Ftitulada\.md$/.test(app.url()), await app.title(), await inFolder()];
await app.waitForSelector('.lmd-node-dir.lmd-open'); await app.waitForSelector('.lmd-node-kids .lmd-node.lmd-active'); // el árbol sigue en la raíz, con la carpeta desplegada
const [, mark2] = await Promise.all([app.waitForNavigation(), drag(node('titulada.md'), app.locator('.lmd-xroot[data-root=disk] .lmd-tree-head'))]); await app.waitForSelector('.markdown-body h1');
o.arrastreRaiz = [mark2, /%2Ftitulada\.md$/.test(app.url()) && !/carpeta/.test(app.url()), (await names()).includes('titulada.md'), await inFolder()];

// arrastrar una carpeta del disco a otra la mueve con todo lo que tiene adentro, sea Markdown o no
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('x');
  const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write(await dir.getDirectoryHandle('destino', { create: true }), 'ya.md', '# Ya\n');
  await write(await dir.getDirectoryHandle('vacia', { create: true }), 'foto.bin', new Uint8Array([4]));
  const sub = await (await dir.getDirectoryHandle('carpeta')).getDirectoryHandle('sub', { create: true });
  await write(sub, 'hoja.md', '# Hoja\n'); await write(sub, 'dato.bin', new Uint8Array([1, 2, 3]));
});
const walk = () => app.evaluate(async () => { const out = []; const go = async (d, pre) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await go(h, pre + n + '/'); else out.push(pre + n); } }; await go(await (await navigator.storage.getDirectory()).getDirectoryHandle('x'), ''); return out.sort(); });
const dirNode = (name) => app.locator('.lmd-xroot[data-root=disk] .lmd-node-dir', { hasText: name }).first();
await app.goto(base + 'titulada.md'); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node-dir:has-text("destino")');
// Cada carpeta dice cuántos Markdown tiene, contando subcarpetas. El número lo dibuja la hoja de estilos.
const counts = () => app.evaluate(() => Object.fromEntries([...document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node-dir')].map((n) => { const c = n.querySelector('.lmd-node-n'); return [n.querySelector('.lmd-node-name').textContent, c && !c.hidden ? c.dataset.n + '|' + c.getAttribute('aria-label') : '']; })));
await app.waitForFunction(() => document.querySelectorAll('.lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node-dir > .lmd-node-n:not([hidden])').length >= 2, null, { timeout: 8000 }).catch(() => {});
o.cuenta = await counts(); const mdIn = async (dir) => (await walk()).filter((p) => p.startsWith(dir + '/') && /\.md$/.test(p)).length; const label = (n) => n + '|' + (n === 1 ? '1 nota' : n + ' notas');
o.cuentaReal = [await mdIn('carpeta'), await mdIn('destino')];
o.cuentaLugar = await app.evaluate(() => { const n = [...document.querySelectorAll('.lmd-node-dir')].find((x) => x.querySelector('.lmd-node-name').textContent === 'carpeta'); const c = n.querySelector('.lmd-node-n'); const r = c.getBoundingClientRect(); const nm = n.querySelector('.lmd-node-name').getBoundingClientRect(); const row = n.getBoundingClientRect(); const cs = getComputedStyle(c);
  return { right: r.width > 0 && r.left >= nm.right - 1 && r.right <= row.right + 0.5, small: parseFloat(cs.fontSize) <= 12, gray: cs.color !== getComputedStyle(n).color, shown: getComputedStyle(c, '::after').content, text: n.textContent.trim(), role: c.getAttribute('role'), title: c.title }; });
o.carpetaDisco = ['', await drag(dirNode('carpeta'), dirNode('destino'))];
await app.waitForFunction(() => ![...document.querySelectorAll('.lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node-dir')].some((n) => n.textContent.trim() === 'carpeta'));
o.carpetaDisco.push((await walk()).filter((p) => /carpeta|destino/.test(p)));
await app.waitForFunction(() => { const n = [...document.querySelectorAll('.lmd-xroot[data-root=disk] > .lmd-tree > .lmd-node-dir')].find((x) => x.querySelector('.lmd-node-name').textContent === 'destino'); const c = n && n.querySelector('.lmd-node-n'); return !!c && Number(c.dataset.n) > 1; }, null, { timeout: 8000 }).catch(() => {});
o.cuentaMovida = [await counts(), await mdIn('destino')];
// con la nota abierta adentro de la carpeta que se mueve, queda abierta en su ruta nueva
for (const d of ['destino', 'carpeta', 'sub']) { if (!(await dirNode(d).evaluate((n) => n.classList.contains('lmd-open')))) await dirNode(d).click(); await app.waitForSelector('.lmd-node-dir.lmd-open:has-text("' + d + '")'); }
o.carpetaEnHija = [await drag(dirNode('destino'), dirNode('sub')), await drag(dirNode('carpeta'), dirNode('destino'))]; // ni adentro de una de las suyas, ni donde ya está
await Promise.all([app.waitForNavigation(), node('hoja.md').click()]); await app.waitForSelector('.markdown-body h1:has-text("Hoja")'); await app.waitForSelector('.lmd-node-kids .lmd-node-dir:has-text("carpeta")');
const [, markDir] = await Promise.all([app.waitForNavigation(), drag(dirNode('carpeta'), app.locator('.lmd-xroot[data-root=disk] .lmd-tree-head'))]); await app.waitForSelector('.markdown-body h1');
o.carpetaDiscoAbierta = [markDir, /%2Fcarpeta%2Fsub%2Fhoja\.md$/.test(app.url()) && !/destino/.test(app.url()), await app.title(), (await walk()).filter((p) => /carpeta|destino/.test(p))];
// soltar una imagen del explorador en la nota, en edición, la inserta como imagen con su ruta relativa
await app.evaluate(() => LMD.patch({ filesOnlyMarkdown: false })); // las imágenes figuran en el explorador con "solo Markdown" apagado
await app.goto(base + 'README.md'); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node:has-text("punto.svg")');
await app.click('[data-act=mode-edit]'); await app.waitForSelector('.markdown-body p.lmd-editable');
const dropOn = async (from, to) => {
  await from.hover(); await app.mouse.down(); await to.hover(); await to.hover();
  const mark = await app.evaluate(() => { const c = document.querySelector('.lmd-drop-caret'); return c ? (c.classList.contains('lmd-drop-line') ? 'renglón' : 'cursor') : ''; });
  await app.mouse.up();
  return mark;
};
o.soltarImagen = [await dropOn(node('punto.svg'), app.locator('.markdown-body p.lmd-editable').first())];
await app.waitForFunction(() => !!document.querySelector('.markdown-body p img[data-lmd-src="punto.svg"]'));
o.soltarImagen.push(await app.evaluate(() => document.querySelector('.markdown-body p img[data-lmd-src="punto.svg"]').getAttribute('data-lmd-src')));
// y un archivo de otra carpeta, soltado fuera del texto, queda en un renglón propio debajo del último bloque
for (const d of ['carpeta', 'sub']) { await dirNode(d).click(); await app.waitForSelector('.lmd-node-dir.lmd-open:has-text("' + d + '")'); }
await app.waitForSelector('.lmd-node-kids .lmd-node:has-text("hoja.md")');
o.soltarBloque = [await dropOn(app.locator('.lmd-xroot[data-root=disk] .lmd-node-kids .lmd-node', { hasText: 'hoja.md' }).first(), app.locator('.lmd-article .lmd-add'))];
await app.click('.lmd-foot .lmd-status', { force: true }); await app.keyboard.press('Control+s'); await app.waitForTimeout(500);
o.soltarFuente = await src();
await app.click('[data-act=mode-read]'); await app.waitForTimeout(200);
await app.evaluate(() => LMD.patch({ filesOnlyMarkdown: true }));

// Notas "en este navegador": se renombran desde el árbol y desde el título; no tienen carpetas, así que arrastrar no hace nada.
const notes = () => app.evaluate(async () => (await LMD.store.notesAll()).map((n) => n.name).sort());
await app.evaluate(() => Promise.all([LMD.store.notePut('primera.md', '# Primera\n'), LMD.store.notePut('segunda.md', '# Segunda\n')]));
await app.goto(`chrome-extension://${id}/src/app.html?f=` + encodeURIComponent('local/primera.md')); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node');
await app.evaluate(() => { window.__answer = 'tercera'; });
await node('segunda.md').click({ button: 'right' }); await app.waitForSelector('.lmd-menu [data-f=ren]');
o.localMenu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f));
// El menú es compacto, cada opción lleva su ícono y eliminar va en rojo, en los dos temas.
const menuLook = () => app.evaluate(() => {
  const m = document.querySelector('.lmd-menu'); const bs = [...m.querySelectorAll('button')]; const del = m.querySelector('[data-f=del]'); const ren = m.querySelector('[data-f=ren]');
  const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number); const d = rgb(getComputedStyle(del).color);
  return [m.offsetWidth >= 168 && m.offsetWidth <= 220, bs.every((b) => b.offsetHeight <= 30), bs.every((b) => b.firstElementChild.tagName.toLowerCase() === 'svg' && b.lastElementChild.tagName === 'SPAN'),
    d[0] > 150 && d[0] > d[1] * 1.5 && d[0] > d[2] * 1.5, getComputedStyle(del.querySelector('svg')).color === getComputedStyle(del).color, getComputedStyle(ren).color !== getComputedStyle(del).color, ren.textContent];
});
o.menuCompacto = await menuLook();
const wasDark = await app.evaluate(() => document.documentElement.classList.contains('lmd-dark'));
await app.evaluate(() => { const c = document.documentElement.classList; c.toggle('lmd-dark'); c.toggle('lmd-light'); });
o.menuOtroTema = (await menuLook()).slice(3, 6);
await app.evaluate((dark) => { const c = document.documentElement.classList; c.toggle('lmd-dark', dark); c.toggle('lmd-light', !dark); }, wasDark);
await app.click('.lmd-menu [data-f=ren]');
await app.waitForFunction(() => [...document.querySelectorAll('.lmd-node')].some((n) => n.textContent.trim() === 'tercera.md'));
o.localArbol = await notes();
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(200);
await app.locator('.lmd-article h1.lmd-editable').click(); await app.keyboard.press('End'); await app.keyboard.type(' nota'); // renombrar con cambios sin guardar no los pierde
await app.dblclick('.lmd-docname'); await app.fill('.lmd-docname-input', 'principal');
await Promise.all([app.waitForNavigation(), app.keyboard.press('Enter')]); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-node');
o.localTitulo = [await app.title(), await app.textContent('.markdown-body h1'), await notes(), /f=local%2Fprincipal\.md/.test(app.url())];
const localUrl = app.url();
o.localArrastre = [await drag(node('tercera.md'), app.locator('.lmd-xroot[data-root=local] .lmd-tree-head')), await drag(node('tercera.md'), node('principal.md')), await notes(), app.url() === localUrl];

const J = (v) => JSON.stringify(v);
const checks = [
  ['cada carpeta dice cuántas notas tiene, contando subcarpetas y sin contar lo que no es Markdown; una sin notas no lleva número', o.cuenta && o.cuentaReal[0] > 1 && o.cuenta.carpeta === label(o.cuentaReal[0]) && o.cuenta.destino === '1|1 nota' && o.cuentaReal[1] === 1 && o.cuenta.vacia === '', [o.cuenta, o.cuentaReal]],
  ['el número va chico y en gris a la derecha del nombre, con su texto completo, y el renglón sigue diciendo solo el nombre', o.cuentaLugar && o.cuentaLugar.right && o.cuentaLugar.small && o.cuentaLugar.gray && o.cuentaLugar.shown === '"' + o.cuentaReal[0] + '"' && o.cuentaLugar.text === 'carpeta' && o.cuentaLugar.role === 'img' && o.cuentaLugar.title === o.cuentaReal[0] + ' notas', o.cuentaLugar],
  ['al mover una carpeta los números se vuelven a contar', o.cuentaMovida && o.cuentaMovida[1] === o.cuentaReal[0] + 1 && o.cuentaMovida[0].destino === label(o.cuentaMovida[1]), o.cuentaMovida],
  ['en una carpeta del disco la barra tiene recargar, y copiar y exportar son un botón cada uno', o.recargar === true, o.recargar],
  ['arrastrar una carpeta del disco a otra la mueve entera; no adentro de una de las suyas ni donde ya está', J(o.carpetaEnHija) === J(['', '']) && o.carpetaDisco && o.carpetaDisco[1] === 'destino' && J(o.carpetaDisco[2]) === J(['destino/carpeta/dentro.md', 'destino/carpeta/movible.md', 'destino/carpeta/sub/dato.bin', 'destino/carpeta/sub/hoja.md', 'destino/ya.md']), o.carpetaDisco],
  ['mover la carpeta de la nota abierta la deja abierta en su ruta nueva', o.carpetaDiscoAbierta && o.carpetaDiscoAbierta[0] === 'raíz' && o.carpetaDiscoAbierta[1] === true && o.carpetaDiscoAbierta[2] === 'hoja.md' && J(o.carpetaDiscoAbierta[3]) === J(['carpeta/dentro.md', 'carpeta/movible.md', 'carpeta/sub/dato.bin', 'carpeta/sub/hoja.md', 'destino/ya.md']), o.carpetaDiscoAbierta],
  ['soltar una imagen del explorador en la nota la inserta como imagen', J(o.soltarImagen) === J(['cursor', 'punto.svg']) && /!\[\]\(punto\.svg\)/.test(o.soltarFuente || ''), [o.soltarImagen, o.soltarFuente]],
  ['soltar un archivo fuera del texto deja el enlace en un renglón propio', J(o.soltarBloque) === J(['renglón']) && /\n\[hoja\]\(carpeta\/sub\/hoja\.md\)(\n|$)/.test(o.soltarFuente || ''), [o.soltarBloque, o.soltarFuente]],
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
  ['doble clic en el título lo vuelve un campo con el nombre seleccionado', J(o.tituloCampo) === J(['abierta.md', 'abierta', true]), o.tituloCampo],
  ['en el título, Escape cancela y un nombre repetido avisa', J(o.tituloEscape) === J(['abierta.md', 0, true]) && /Ya hay un archivo con ese nombre/.test(o.tituloRepetido[0]) && o.tituloRepetido[1], [o.tituloEscape, o.tituloRepetido]],
  ['Enter en el título renombra y deja la nota abierta', J(o.titulo) === J(['titulada.md', 'Abierta', true]), o.titulo],
  ['F2 renombra el archivo del árbol que tiene el foco', J(o.f2) === J([true, true, 'titulada.md']), o.f2],
  ['arrastrar a una carpeta mueve el archivo y marca el destino', o.arrastreMarca === 'carpeta' && J(o.arrastre) === J([['dentro.md', 'movible.md'], false, 'titulada.md']) && J(o.arrastreMismo) === J(['', true]), [o.arrastreMarca, o.arrastre, o.arrastreMismo]],
  ['arrastrar la nota abierta la deja abierta en su ruta nueva', J(o.arrastreAbierta) === J(['carpeta', true, 'titulada.md', ['dentro.md', 'movible.md', 'titulada.md']]), o.arrastreAbierta],
  ['soltar sobre la raíz del árbol la saca de la carpeta', J(o.arrastreRaiz) === J(['raíz', true, true, ['dentro.md', 'movible.md']]), o.arrastreRaiz],
  ['las notas del navegador se renombran desde el árbol', J(o.localMenu) === J(['ren', 'send', 'del']) && J(o.localArbol) === J(['primera.md', 'tercera.md']), [o.localMenu, o.localArbol]],
  ['y desde el título, sin perder lo que no se había guardado', J(o.localTitulo) === J(['principal.md', 'Primera nota', ['principal.md', 'tercera.md'], true]), o.localTitulo],
  ['el menú del explorador es compacto, con ícono en cada opción y eliminar en rojo en los dos temas', J(o.menuCompacto) === J([true, true, true, true, true, true, 'Renombrar']) && J(o.menuOtroTema) === J([true, true, true]), [o.menuCompacto, o.menuOtroTema]],
  ['arrastrar una nota del navegador no hace nada', J(o.localArrastre) === J(['', '', ['principal.md', 'tercera.md'], true]), o.localArrastre],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Archivos y extras');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
