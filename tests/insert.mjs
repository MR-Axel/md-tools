// Menú con íconos, viñetas separadas de tareas, diálogo de imagen con tamaños, color del código y forma de los diagramas.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ins', { create: true });
  const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable();
  await s.write('# Doc\n\n- [ ] Tarea uno\n\nTexto final.\n\n```js\nconst a = 1;\n```\n\n```mermaid\ngraph LR\n  A --> B\n```\n'); await s.close();
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.lmd-diagram svg');
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const blur = async () => { await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600); };
const o = {};
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);

// íconos y viñetas al lado de una lista de tareas
await app.locator('.lmd-article ul').first().click({ button: 'right', position: { x: 300, y: 8 } }); await app.waitForSelector('.lmd-menu');
o.iconos = await app.evaluate(() => [document.querySelectorAll('.lmd-menu [data-ins]').length, document.querySelectorAll('.lmd-menu [data-ins] svg').length]);
await app.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'mdtools-menu.png') });
await app.click('.lmd-menu [data-ins=ul]'); await app.keyboard.type('Una viñeta'); await blur();
o.vinetas = (await src()).split('\n').slice(2, 6);
o.estilos = await app.evaluate(() => [...document.querySelectorAll('.lmd-article > ul > li')].map((li) => getComputedStyle(li).listStyleType));

// imagen por dirección, con tamaño
await app.locator('.lmd-article p', { hasText: 'Texto final' }).click({ button: 'right' }); await app.click('.lmd-menu [data-ins=image]'); await app.waitForSelector('.lmd-img-card');
await app.fill('[data-i=src]', 'javascript:alert(1)'); await app.click('[data-i=ok]');
o.rechazo = await app.textContent('.lmd-img-err');
await app.fill('[data-i=src]', 'https://example.com/logo.png'); await app.fill('[data-i=alt]', 'Logo'); await app.click('.lmd-img-card .lmd-seg button[data-val="480"]'); await app.click('[data-i=ok]'); await app.waitForTimeout(600);
o.imagen = (await src()).split('\n').filter((l) => l.includes('logo.png'))[0];
o.atributos = await app.evaluate(() => { const i = document.querySelector('.lmd-article img'); return [i.getAttribute('alt'), i.getAttribute('width')]; });
await app.locator('.lmd-article img').click({ force: true }); await app.waitForSelector('.lmd-imgbar:not([hidden])');
await app.click('.lmd-imgbar [data-w="240"]'); await app.waitForTimeout(700);
o.achicada = (await src()).split('\n').filter((l) => l.includes('logo.png'))[0];

// imagen subida: queda en assets/
await app.locator('.lmd-article p', { hasText: 'Texto final' }).click({ button: 'right' }); await app.click('.lmd-menu [data-ins=image]'); await app.waitForSelector('.lmd-img-card');
await app.setInputFiles('.lmd-img-card input[type=file]', { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
await app.click('[data-i=ok]'); await app.waitForTimeout(700);
o.subida = (await src()).split('\n').filter((l) => l.includes('assets/'))[0];

// dos tablas seguidas: cada una queda como una tabla aparte, se inserte arriba o abajo, se duplique o se mueva
const tables = () => app.evaluate(() => ({ n: document.querySelectorAll('.lmd-article table').length, rows: [...document.querySelectorAll('.lmd-article table')].map((t) => t.rows.length), rules: [...document.querySelectorAll('.lmd-article td, .lmd-article th')].filter((c) => /^[-—–\s]+$/.test(c.textContent) && /[-—–]/.test(c.textContent)).length }));
const glued = async () => /\|[ \t]*\n[ \t]*\n[ \t]*\|/.test(await src()); // dos filas de tabla con un solo renglón en blanco en el medio
const onTable = async (i, pick) => { await blur(); await app.locator('.lmd-article table').nth(i).click({ button: 'right', position: { x: 30, y: 8 } }); await app.waitForSelector('.lmd-menu'); await app.click('.lmd-menu ' + pick); await app.waitForTimeout(500); };
await app.locator('.lmd-article p', { hasText: 'Texto final' }).click({ button: 'right' }); await app.click('.lmd-menu [data-ins=table]'); await app.waitForTimeout(500);
o.unaTabla = await tables();
await onTable(0, '[data-ins=table]'); // justo debajo de la primera
o.debajo = [await tables(), await glued()];
o.fuente = (await src()).split('\n').filter((l, i, all) => /^\|/.test(l) || (l === '' && (/^\|/.test(all[i - 1] || '') || /^\|/.test(all[i + 1] || '') || all[i - 1] === ''))).slice(0, 8);
await blur(); await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.deshecha = (await tables()).n;
await app.keyboard.press('Control+y'); await app.waitForTimeout(400); await blur();
await app.locator('.lmd-article p', { hasText: 'Texto final' }).click({ button: 'right' }); await app.click('.lmd-menu [data-ins=table]'); await app.waitForTimeout(500); // justo arriba de las otras dos
o.arriba = [await tables(), await glued()];
await onTable(0, '[data-op=dup]');
o.duplicada = [await tables(), await glued()];
// Un separador entre dos tablas, y se lo sube: las dos tablas quedan una al lado de la otra.
await onTable(2, '[data-ins=hr]');
await app.locator('.lmd-article > hr').first().click({ button: 'right', force: true }); await app.waitForSelector('.lmd-menu [data-op=up]'); await app.click('.lmd-menu [data-op=up]'); await app.waitForTimeout(500);
o.movida = [await tables(), await glued(), await app.evaluate(() => { const hr = document.querySelector('.lmd-article > hr'); const t = (n) => (n.matches('table') || n.querySelector('table') ? 'TABLE' : n.tagName); return [t(hr.nextElementSibling), t(hr.nextElementSibling.nextElementSibling)]; })];
// Al eliminar el separador que quedó entre otras dos pasa lo mismo.
await app.locator('.lmd-article > hr').first().click({ button: 'right', force: true }); await app.waitForSelector('.lmd-menu [data-op=del]'); await app.click('.lmd-menu [data-op=del]'); await app.waitForTimeout(500);
o.sinSeparador = [await tables(), await glued()];

// color del código y forma de los diagramas
await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card');
await app.click('[data-code-color="#3b82f6"]'); await app.waitForTimeout(400);
o.tinte = await app.evaluate(() => document.documentElement.style.getPropertyValue('--code-tint'));
o.redondo = await app.evaluate(() => document.documentElement.classList.contains('lmd-dgm-round'));
await app.click('.lmd-seg[data-seg=diagramShape] button[data-val=square]'); await app.waitForTimeout(1500);
o.recto = await app.evaluate(() => !document.documentElement.classList.contains('lmd-dgm-round') && !!document.querySelector('.lmd-diagram svg'));

const J = (v) => JSON.stringify(v);
const checks = [
  ['cada opción del menú tiene su ícono', o.iconos[0] === 18 && o.iconos[1] === 18, o.iconos],
  ['una lista con viñetas al lado de una de tareas queda aparte', J(o.vinetas) === J(['- [ ] Tarea uno', '', '* Una viñeta', '']), o.vinetas],
  ['y conserva sus viñetas', J(o.estilos) === J(['none', 'disc']), o.estilos],
  ['rechaza una dirección que no es de imagen', /no sirve/.test(o.rechazo || ''), o.rechazo],
  ['inserta la imagen con descripción y tamaño', o.imagen === '![Logo|480](https://example.com/logo.png)' && J(o.atributos) === J(['Logo', '480']), [o.imagen, o.atributos]],
  ['el tamaño se cambia desde la barra de la imagen', o.achicada === '![Logo|240](https://example.com/logo.png)', o.achicada],
  ['una imagen subida se guarda al lado del documento', /^!\[\]\(assets\/imagen-\d{8}-\d{6}\.png\)$/.test(o.subida || ''), o.subida],
  ['una tabla insertada justo debajo de otra queda como tabla aparte', o.unaTabla.n === 1 && o.debajo[0].n === 2 && J(o.debajo[0].rows) === J([2, 2]) && o.debajo[0].rules === 0 && o.debajo[1] === false, [o.unaTabla, o.debajo]],
  ['en el Markdown las separan dos renglones en blanco', J(o.fuente.slice(3, 7)) === J(['|  |  |', '', '', '| Columna 1 | Columna 2 |']), o.fuente],
  ['un solo Ctrl+Z deshace esa inserción', o.deshecha === 1, o.deshecha],
  ['insertada justo arriba de otra, también', o.arriba[0].n === 3 && o.arriba[0].rules === 0 && o.arriba[1] === false, o.arriba],
  ['duplicar una tabla no la pega a la de al lado', o.duplicada[0].n === 4 && o.duplicada[0].rules === 0 && o.duplicada[1] === false, o.duplicada],
  ['mover un bloque que estaba entre dos tablas no las pega', o.movida[0].n === 4 && o.movida[0].rules === 0 && o.movida[1] === false && J(o.movida[2]) === J(['TABLE', 'TABLE']), o.movida],
  ['eliminar un bloque que estaba entre dos tablas tampoco', o.sinSeparador[0].n === 4 && o.sinSeparador[0].rules === 0 && o.sinSeparador[1] === false, o.sinSeparador],
  ['el color de los bloques de código se aplica', o.tinte === '#3b82f6', o.tinte],
  ['los diagramas pasan de redondeados a rectos', o.redondo === true && o.recto === true, [o.redondo, o.recto]],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Insertar, imágenes y estilos');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
