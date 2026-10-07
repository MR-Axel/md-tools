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
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Escritura');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
