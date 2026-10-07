// Escritura: bloques nuevos con Enter, atajos de Markdown, menú de clic derecho y deshacer.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('w', { create: true });
  const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable();
  await s.write('# Doc\n\nPrimer párrafo.\n\n- alfa\n- beta\n\nÚltimo párrafo.\n'); await s.close();
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
const disk = () => app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('w'); return (await (await (await dir.getFileHandle('doc.md')).getFile()).text()); });
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const v = t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const o = {};
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
await app.locator('.lmd-article p.lmd-editable', { hasText: 'Primer' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter');
await app.keyboard.type('Segundo párrafo'); await app.keyboard.press('Enter');
await app.keyboard.type('## Sub'); await app.keyboard.press('Enter');
await app.keyboard.type('- uno'); await app.keyboard.press('Enter'); await app.keyboard.type('dos'); await app.keyboard.press('Enter'); await app.keyboard.press('Enter');
await app.keyboard.type('fin'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.escribir = (await src()).split('\n');

await app.locator('.lmd-li-text', { hasText: 'alfa' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.type('alfa bis'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
const last = app.locator('.lmd-article p.lmd-editable', { hasText: 'Último párrafo' }); await last.click(); await app.keyboard.press('Home'); for (let i = 0; i < 6; i++) await app.keyboard.press('ArrowRight');
await app.keyboard.press('Enter'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.lista = (await src()).split('\n');
// formato al escribir
await app.locator('.lmd-article p.lmd-editable', { hasText: 'Primer' }).click(); await app.keyboard.press('End');
await app.keyboard.type(' Con **negrita**, *cursiva*, `código` y snake_case_name.'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.formato = (await src()).split('\n')[2];
await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
// menú: tabla, eliminar, deshacer
await app.locator('.lmd-article h1').click({ button: 'right' }); await app.waitForSelector('.lmd-menu');
o.menu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-label')].map((n) => n.textContent));
await app.click('.lmd-menu [data-ins=table]'); await app.waitForTimeout(500);
await app.keyboard.type('Nombre'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600);
o.tabla = (await src()).split('\n').slice(0, 7);
await app.locator('.lmd-article h2').click({ button: 'right' }); await app.click('.lmd-menu [data-conv=h3]'); await app.waitForTimeout(300);
await app.locator('.lmd-article h3').click({ button: 'right' }); await app.click('.lmd-menu [data-op=up]'); await app.waitForTimeout(300);
o.mover = (await src()).split('\n').filter((l) => /Sub|Segundo/.test(l));
const before = await src();
await app.locator('.lmd-article h3').click({ button: 'right' }); await app.click('.lmd-menu [data-op=del]'); await app.waitForTimeout(300);
o.borrado = !/### Sub/.test(await src());
await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.deshecho = (await src()) === before;
await app.keyboard.press('Control+y'); await app.waitForTimeout(400);
o.rehecho = !/### Sub/.test(await src());
await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
await app.locator('.lmd-add').click(); await app.keyboard.type('/'); await app.waitForSelector('.lmd-menu'); await app.click('.lmd-menu [data-ins=hr]'); await app.waitForTimeout(400);
o.final = (await src()).split('\n').slice(-4);
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
o.guardado = (await disk()) === (await src());
const J = (v) => JSON.stringify(v);
// emojis: ":" despliega la lista y Enter inserta el carácter sin abrir un bloque nuevo
await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' :rocke'); await app.waitForTimeout(250);
o.emojiLista = await app.evaluate(() => { const b = document.querySelector('.lmd-emoji'); return !!b && !b.hidden && b.querySelector('button.lmd-on small').textContent; });
const parrafos = await app.locator('.lmd-article p').count();
await app.keyboard.press('Enter'); await app.waitForTimeout(200);
o.emoji = await app.evaluate(() => { const b = document.querySelector('.lmd-emoji'); const t = (document.activeElement || document.body).textContent; return [t.codePointAt(t.length - 2), !b || b.hidden]; });
o.emojiSinBloque = (await app.locator('.lmd-article p').count()) === parrafos;
await app.keyboard.type(' 10:30'); await app.waitForTimeout(200);
o.emojiHora = await app.evaluate(() => { const b = document.querySelector('.lmd-emoji'); return !b || b.hidden; });
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(500);

// ---------- Entrar y quedarse en edición ----------
const editing = () => app.evaluate(() => document.documentElement.classList.contains('lmd-editing'));
const ready = async () => { await app.waitForSelector('.markdown-body h1'); await app.waitForTimeout(300); };
const docUrl = app.url();
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('w');
  const write = async (name, data) => { const h = await dir.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write('lee.md', '# Lee\n\nUn [enlace](https://example.com) acá.\n\n```js\nlet a = 1;\n```\n\n- [ ] tarea\n\nPárrafo final para editar con calma.\n');
  await write('vacia.md', '');
  await write('secciones.md', '# Doc\n\n## Sección dos\n\nTexto.\n\n### Sección tres\n\n- ítem uno\n- ítem dos\n\n1. Paso con **negrita**\n\n| A | B |\n| --- | --- |\n| celda uno | celda dos |\n');
});
// recargar, o pasar a otra nota, no saca de edición
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
await app.reload(); await ready();
o.recarga = await editing();
await app.goto(docUrl.replace('doc.md', 'lee.md')); await ready();
o.otraNota = await editing();
// pasada la media hora abre leyendo, y volver a lectura a mano también se respeta
await app.evaluate(() => sessionStorage.setItem('lmd-edit', String(Date.now() - 31 * 60 * 1000)));
await app.reload(); await ready();
o.vencido = !(await editing());
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(200); await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.reload(); await ready();
o.aLectura = !(await editing());
// doble clic: no se dispara sobre un enlace, un bloque de código ni una casilla; sobre el texto entra con el cursor ahí
o.dobleNo = await app.evaluate(() => ['.markdown-body a[href^="https"]', '.markdown-body .lmd-code code', '.markdown-body input.lmd-task'].map((q) => {
  document.querySelector(q).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return document.documentElement.classList.contains('lmd-editing');
}));
await app.locator('.markdown-body p', { hasText: 'Párrafo final' }).dblclick({ position: { x: 120, y: 10 } }); await app.waitForTimeout(300);
o.doble = await app.evaluate(() => { const a = document.activeElement; const s = getSelection(); const r = document.createRange(); r.selectNodeContents(a); r.setEnd(s.anchorNode, s.anchorOffset);
  return [document.documentElement.classList.contains('lmd-editing'), a.textContent, s.isCollapsed, r.toString().length]; });
// ya editando, el doble clic selecciona la palabra como siempre
await app.locator('.markdown-body p.lmd-editable', { hasText: 'Párrafo final' }).dblclick({ position: { x: 30, y: 10 } }); await app.waitForTimeout(150);
o.doblePalabra = await app.evaluate(() => getSelection().toString().trim());
// clic derecho leyendo: con Shift y sobre un enlace queda el menú del navegador; en lo demás sale el menú de lectura, sin pasar a edición
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__clip = t; }; });
const clip = () => app.evaluate(() => window.__clip);
const opciones = () => app.evaluate(() => [...document.querySelectorAll('.lmd-menu-read button')].map((n) => n.textContent));
await app.locator('.markdown-body h1').click({ button: 'right', modifiers: ['Shift'] }); await app.waitForTimeout(300);
o.derechoShift = [await editing(), await app.locator('.lmd-menu').count()];
await app.evaluate(() => getSelection().removeAllRanges()); // el clic con Shift extiende la selección
await app.locator('.markdown-body a[href^="https"]').click({ button: 'right' }); await app.waitForTimeout(300);
o.derechoEnlace = [await editing(), await app.locator('.lmd-menu').count()];
// sobre un título: editar, copiar el bloque, copiar el enlace a la sección e insertar debajo
await app.locator('.markdown-body h1').click({ button: 'right', position: { x: 20, y: 12 } }); await app.waitForSelector('.lmd-menu-read');
o.menuTitulo = [await editing(), await opciones()];
await app.keyboard.press('Escape'); await app.waitForTimeout(150);
o.menuEscape = await app.locator('.lmd-menu').count();
await app.locator('.markdown-body h1').click({ button: 'right', position: { x: 20, y: 12 } }); await app.waitForSelector('.lmd-menu-read');
await app.mouse.click(900, 700); await app.waitForTimeout(150);
o.menuAfuera = await app.locator('.lmd-menu').count();
await app.locator('.markdown-body h1').click({ button: 'right', position: { x: 20, y: 12 } }); await app.click('.lmd-menu-read [data-read=anchor]'); await app.waitForTimeout(150);
o.copiaAncla = [await clip(), await app.textContent('.lmd-status')];
// sobre un bloque sin nada elegido: se copia su Markdown, tal como está en el archivo
await app.locator('.markdown-body p', { hasText: 'enlace' }).click({ button: 'right', position: { x: 4, y: 8 } }); await app.waitForSelector('.lmd-menu-read');
o.menuBloque = await opciones();
await app.click('.lmd-menu-read [data-read=block]'); await app.waitForTimeout(150);
o.copiaBloque = await clip();
// con texto elegido: copiar, buscar en la carpeta y editar acá
const elegir = async () => { const box = await app.evaluate(() => {
  const p = [...document.querySelectorAll('.markdown-body p')].find((n) => n.textContent.includes('Párrafo final')); const t = p.firstChild; const i = t.nodeValue.indexOf('editar con calma');
  const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 16); const s = getSelection(); s.removeAllRanges(); s.addRange(r); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2];
}); await app.mouse.click(box[0], box[1], { button: 'right' }); await app.waitForSelector('.lmd-menu-read'); };
await elegir();
o.menuSeleccion = [await opciones(), await app.evaluate(() => getSelection().toString())];
await app.click('.lmd-menu-read [data-read=copy]'); await app.waitForTimeout(150);
o.copiaSeleccion = await clip();
await elegir(); await app.click('.lmd-menu-read [data-read=find]'); await app.waitForSelector('.lmd-res-file');
o.buscar = [await app.inputValue('.lmd-search input'), await app.evaluate(() => !document.querySelector('.lmd-results').hidden && document.querySelector('.lmd-results').getBoundingClientRect().height > 20), await app.locator('.lmd-res-file').count(), await editing()];
await app.fill('.lmd-search input', ''); await app.waitForTimeout(300);
await elegir(); await app.click('.lmd-menu-read [data-read=edit]'); await app.waitForTimeout(400);
o.editarAca = [await editing(), await app.evaluate(() => document.activeElement.textContent)];
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
// "Insertar debajo" pasa a edición y abre el menú de bloques de siempre
await app.locator('.markdown-body h1').click({ button: 'right', position: { x: 20, y: 12 } }); await app.click('.lmd-menu-read [data-read=insert]'); await app.waitForSelector('.lmd-menu [data-ins]');
o.derecho = [await editing(), await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-label')].map((n) => n.textContent))];
await app.click('.lmd-menu [data-ins=hr]'); await app.waitForTimeout(400);
o.derechoInserta = (await src()).split('\n').slice(0, 4);
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
// doble clic leyendo sobre un título de sección, un ítem de lista y una celda: entra a edición con el cursor ahí
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.goto(docUrl.replace('doc.md', 'secciones.md')); await ready();
o.dobleSecciones = [];
for (const [sel, texto] of [['h2', 'Sección dos'], ['h3', 'Sección tres'], ['li', 'ítem dos'], ['ol li', 'Paso con negrita'], ['td', 'celda dos'], ['h1', 'Doc']]) {
  const antes = await editing();
  await app.locator('.markdown-body ' + sel, { hasText: texto }).dblclick({ position: { x: 14, y: 9 } }); await app.waitForTimeout(350);
  o.dobleSecciones.push(await app.evaluate(([a, s]) => { const e = document.activeElement; return a + '>' + document.documentElement.classList.contains('lmd-editing') + ':' + e.textContent + ':' + e.isContentEditable + ':' + !!e.closest(s); }, [antes, sel.split(' ').pop()]));
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
}
// una nota vacía abre lista para escribir, y el clic derecho inserta el primer bloque
await app.goto(docUrl.replace('doc.md', 'vacia.md')); await app.waitForSelector('.lmd-draft');
o.vacia = [await editing(), await app.evaluate(() => document.activeElement.classList.contains('lmd-draft'))];
await app.keyboard.press('Escape'); await app.waitForTimeout(200);
await app.locator('.lmd-article').click({ button: 'right', position: { x: 200, y: 8 } }); await app.waitForSelector('.lmd-menu');
o.vaciaMenu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-label')].map((n) => n.textContent));
await app.click('.lmd-menu [data-ins=h1]'); await app.keyboard.type('Primero'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.vaciaEscrita = await src();
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);

// lo escrito llega al Markdown tras una pausa, sin salir del bloque
if (!(await app.evaluate(() => document.documentElement.classList.contains('lmd-editing')))) { await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400); }
await app.locator('.lmd-article h1.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' sigo escribiendo'); await app.waitForTimeout(1700);
o.pausa = await app.evaluate(() => ({ enfocado: !!(document.activeElement && document.activeElement.isContentEditable), texto: document.activeElement.textContent.slice(-17) }));
await app.keyboard.type(' y más'); await app.waitForTimeout(200);
o.pausaCursor = await app.evaluate(() => document.activeElement.textContent.slice(-23));
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.pausaFinal = String(await src()).includes('sigo escribiendo y más');

// ---------- Escape vuelve a lo que había, ítems vacíos que se pueden escribir, y Tab en las tablas ----------
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('w');
  const h = await dir.getFileHandle('pulido.md', { create: true }); const s = await h.createWritable();
  await s.write('# Pulido\n\nTexto fijo del párrafo.\n\n## Tareas\n- [ ]\n- [ ]\n\n## Lista\n-\n\n## Pasos\n1.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'); await s.close();
});
await app.goto(docUrl.replace('doc.md', 'pulido.md')); await ready();
if (!(await app.evaluate(() => document.documentElement.classList.contains('lmd-editing')))) { await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300); }
const out = async () => { await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700); };
o.vacios = await app.evaluate(() => ({ casillas: document.querySelectorAll('.lmd-article li.lmd-task-item > input.lmd-task').length, crudo: /\[ \]/.test(document.querySelector('.lmd-article').textContent), lugares: [...document.querySelectorAll('.lmd-article li > .lmd-li-text')].map((s) => [s.isContentEditable, s.dataset.ph, s.getBoundingClientRect().width > 40]) }));
await app.locator('.lmd-article p.lmd-editable', { hasText: 'Texto fijo' }).click(); await app.keyboard.press('End'); await app.keyboard.type(' agregado'); await app.waitForTimeout(1700);
o.escAntes = String(await app.evaluate(() => LMD && document.querySelector('.lmd-savestate').textContent)) + '|' + (await app.evaluate(() => document.activeElement.textContent));
o.escFuenteAntes = await app.evaluate(async () => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('w')).getFileHandle('pulido.md')).getFile()).text()).then((t) => t.includes('agregado'));
await app.keyboard.press('Escape'); await app.waitForTimeout(600);
o.escDespues = [(await src()).split('\n')[2], await app.evaluate(() => !!document.activeElement.closest('.lmd-article'))];
await app.locator('.lmd-article td.lmd-cell', { hasText: '1' }).click(); await app.keyboard.type('X'); await app.waitForTimeout(1700); await app.keyboard.press('Escape'); await app.waitForTimeout(600);
o.escCelda = (await src()).split('\n').filter((l) => /^\| \w/.test(l) && !/---/.test(l));
await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.escDeshacer = (await src()).split('\n').some((l) => /X/.test(l) && /^\|/.test(l));
await app.keyboard.press('Control+y'); await app.waitForTimeout(400);
const places = app.locator('.lmd-article li > .lmd-li-text');
await places.nth(0).click(); await app.keyboard.type('comprar pan'); await app.keyboard.press('Enter'); await app.keyboard.type('y leche'); await out();
await app.locator('.lmd-article li > .lmd-li-text[data-ph]').nth(1).click(); await app.keyboard.type('uno'); await out();
await app.locator('.lmd-article ol > li > .lmd-li-text').first().click(); await app.keyboard.type('primero'); await out();
o.vaciosEscritos = (await src()).split('\n').filter((l) => /^(- |\d+\. )/.test(l));
await app.locator('.lmd-article th.lmd-cell', { hasText: 'A' }).click(); await app.keyboard.press('Tab'); await app.keyboard.type('Z'); await app.keyboard.press('Shift+Tab'); await app.keyboard.type('Y'); await out();
o.tabCeldas = (await src()).split('\n').find((l) => /^\| [A-Z] /.test(l));
await app.click('[data-act=mode-read]'); await app.waitForTimeout(500);
o.vaciosLeyendo = await app.evaluate(() => [document.querySelectorAll('.lmd-article li.lmd-task-item > input.lmd-task').length, /\[ \]/.test(document.querySelector('.lmd-article').textContent)]);

const checks = [
  ['Enter crea párrafos, títulos y listas', J(o.escribir) === J(['# Doc', '', 'Primer párrafo.', '', 'Segundo párrafo', '', '## Sub', '', '- uno', '- dos', '', 'fin', '', '- alfa', '- beta', '', 'Último párrafo.', '']), o.escribir],
  ['Enter en un ítem agrega otro y en un párrafo lo parte', J(o.lista.slice(13)) === J(['- alfa', '- alfa bis', '- beta', '', 'Último', '', 'párrafo.', '']), o.lista],
  ['formato al escribir: negrita, cursiva y código', o.formato === 'Primer párrafo. Con **negrita**, *cursiva*, `código` y snake_case_name.', o.formato],
  ['menú de clic derecho', J(o.menu) === J(['Insertar debajo', 'Convertir en', 'Este bloque'])],
  ['insertar una tabla y escribir en ella', J(o.tabla) === J(['# Doc', '', '| Nombre | Columna 2 |', '| --- | --- |', '|  |  |', '', 'Primer párrafo.']), o.tabla],
  ['convertir y mover un bloque', J(o.mover) === J(['### Sub', 'Segundo párrafo']), o.mover],
  ['eliminar un bloque, deshacer y rehacer', o.borrado && o.deshecho && o.rehecho],
  ['la barra / inserta al final', J(o.final) === J(['párrafo.', '', '---', '']), o.final],
  ['lo escrito se guarda igual que se ve', o.guardado],
  ['":" despliega emojis y Enter inserta el elegido', o.emojiLista === ':rocket:' && o.emoji[0] === 0x1F680 && o.emoji[1] && o.emojiSinBloque && o.emojiHora, [o.emojiLista, o.emoji, o.emojiSinBloque, o.emojiHora]],
  ['recargar no saca del modo edición, y pasar a otra nota tampoco', o.recarga === true && o.otraNota === true, [o.recarga, o.otraNota]],
  ['pasada la media hora, o al volver a lectura, abre leyendo', o.vencido === true && o.aLectura === true, [o.vencido, o.aLectura]],
  ['el doble clic no se dispara sobre enlaces, código ni casillas', J(o.dobleNo) === J([false, false, false]), o.dobleNo],
  ['doble clic leyendo pasa a edición con el cursor en ese bloque', o.doble[0] === true && o.doble[1] === 'Párrafo final para editar con calma.' && o.doble[2] === true && o.doble[3] > 5 && o.doble[3] < 30, o.doble],
  ['editando, el doble clic sigue seleccionando la palabra', o.doblePalabra === 'Párrafo', o.doblePalabra],
  ['clic derecho leyendo: con Shift y sobre un enlace queda el menú del navegador', J(o.derechoShift) === J([false, 0]) && J(o.derechoEnlace) === J([false, 0]), [o.derechoShift, o.derechoEnlace]],
  ['clic derecho leyendo sobre un título: menú de lectura, sin pasar a edición', J(o.menuTitulo) === J([false, ['Editar acá', 'Copiar el bloque', 'Copiar el enlace a esta sección', 'Insertar debajo']]), o.menuTitulo],
  ['el menú de lectura se cierra con Escape y con un clic afuera', o.menuEscape === 0 && o.menuAfuera === 0, [o.menuEscape, o.menuAfuera]],
  ['"Copiar el enlace a esta sección" copia el ancla y "Copiar el bloque" su Markdown', J(o.copiaAncla) === J(['#lee', 'Copiado']) && J(o.menuBloque) === J(['Editar acá', 'Copiar el bloque', 'Insertar debajo']) && o.copiaBloque === 'Un [enlace](https://example.com) acá.', [o.copiaAncla, o.menuBloque, o.copiaBloque]],
  ['con texto elegido el menú ofrece copiar, buscar en la carpeta y editar, y no suelta la selección', J(o.menuSeleccion) === J([['Copiar', 'Buscar en la carpeta', 'Editar acá'], 'editar con calma']) && o.copiaSeleccion === 'editar con calma', [o.menuSeleccion, o.copiaSeleccion]],
  ['"Buscar en la carpeta" usa el buscador con ese texto', J(o.buscar) === J(['editar con calma', true, 1, false]), o.buscar],
  ['"Editar acá" pasa a edición con el cursor en ese bloque', J(o.editarAca) === J([true, 'Párrafo final para editar con calma.']), o.editarAca],
  ['"Insertar debajo" pasa a edición y abre el menú del bloque', o.derecho[0] === true && J(o.derecho[1]) === J(['Insertar debajo', 'Convertir en', 'Este bloque']) && J(o.derechoInserta) === J(['# Lee', '', '---', '']), [o.derecho, o.derechoInserta]],
  ['doble clic leyendo sobre títulos de sección, ítems de lista y celdas entra a edición ahí', J(o.dobleSecciones) === J(['false>true:Sección dos:true:true', 'false>true:Sección tres:true:true', 'false>true:ítem dos:true:true', 'false>true:Paso con negrita:true:true', 'false>true:celda dos:true:true', 'false>true:Doc:true:true']), o.dobleSecciones],
  ['una nota vacía abre en edición con el cursor listo', J(o.vacia) === J([true, true]), o.vacia],
  ['en la nota vacía el clic derecho inserta el primer bloque', J(o.vaciaMenu) === J(['Insertar']) && o.vaciaEscrita.trim() === '# Primero', [o.vaciaMenu, o.vaciaEscrita]],
  ['escribir y hacer una pausa no saca el cursor del bloque, y el texto queda', o.pausa.enfocado && o.pausa.texto === ' sigo escribiendo' && o.pausaCursor === ' sigo escribiendo y más' && o.pausaFinal, [o.pausa, o.pausaCursor, o.pausaFinal]],
  ['una tarea vacía se ve como casilla, y los ítems vacíos tienen dónde escribir', o.vacios.casillas === 2 && !o.vacios.crudo && o.vacios.lugares.length === 4 && o.vacios.lugares.every((x) => x[0] && x[1] && x[2]), o.vacios],
  ['lo escrito en un párrafo pasa al archivo tras la pausa, con el cursor todavía ahí', /agregado$/.test(o.escAntes) && o.escFuenteAntes === false, [o.escAntes, o.escFuenteAntes]],
  ['Escape en un párrafo vuelve al texto que tenía al entrar', J(o.escDespues) === J(['Texto fijo del párrafo.', false]), o.escDespues],
  ['Escape en una celda también, y Ctrl+Z trae de vuelta lo escrito', J(o.escCelda) === J(['| A | B |', '| 1 | 2 |']) && o.escDeshacer === true, [o.escCelda, o.escDeshacer]],
  ['escribir en una tarea, una viñeta y un número vacíos deja el Markdown bien armado', J(o.vaciosEscritos) === J(['- [ ] comprar pan', '- [ ] y leche', '- [ ]', '- uno', '1. primero']), o.vaciosEscritos],
  ['Tab pasa a la celda de al lado con su contenido elegido', o.tabCeldas === '| Y | Z |', o.tabCeldas],
  ['leyendo, las tareas vacías siguen siendo casillas', J(o.vaciosLeyendo) === J([3, false]), o.vaciosLeyendo],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Escritura');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
