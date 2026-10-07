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
// clic derecho leyendo: con Shift queda el menú del navegador; sin Shift pasa a edición y abre el menú del bloque
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.locator('.markdown-body h1').click({ button: 'right', modifiers: ['Shift'] }); await app.waitForTimeout(300);
o.derechoShift = [await editing(), await app.locator('.lmd-menu').count()];
await app.locator('.markdown-body a[href^="https"]').click({ button: 'right' }); await app.waitForTimeout(300);
o.derechoEnlace = [await editing(), await app.locator('.lmd-menu').count()];
await app.locator('.markdown-body h1').click({ button: 'right' }); await app.waitForSelector('.lmd-menu');
o.derecho = [await editing(), await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-label')].map((n) => n.textContent))];
await app.click('.lmd-menu [data-ins=hr]'); await app.waitForTimeout(400);
o.derechoInserta = (await src()).split('\n').slice(0, 4);
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
// una nota vacía abre lista para escribir, y el clic derecho inserta el primer bloque
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.goto(docUrl.replace('doc.md', 'vacia.md')); await app.waitForSelector('.lmd-draft');
o.vacia = [await editing(), await app.evaluate(() => document.activeElement.classList.contains('lmd-draft'))];
await app.keyboard.press('Escape'); await app.waitForTimeout(200);
await app.locator('.lmd-article').click({ button: 'right', position: { x: 200, y: 8 } }); await app.waitForSelector('.lmd-menu');
o.vaciaMenu = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-label')].map((n) => n.textContent));
await app.click('.lmd-menu [data-ins=h1]'); await app.keyboard.type('Primero'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.vaciaEscrita = await src();
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);

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
  ['clic derecho leyendo pasa a edición y abre el menú del bloque', o.derecho[0] === true && J(o.derecho[1]) === J(['Insertar debajo', 'Convertir en', 'Este bloque']) && J(o.derechoInserta) === J(['# Lee', '', '---', '']), [o.derecho, o.derechoInserta]],
  ['una nota vacía abre en edición con el cursor listo', J(o.vacia) === J([true, true]), o.vacia],
  ['en la nota vacía el clic derecho inserta el primer bloque', J(o.vaciaMenu) === J(['Insertar']) && o.vaciaEscrita.trim() === '# Primero', [o.vaciaMenu, o.vaciaEscrita]],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Escritura');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
