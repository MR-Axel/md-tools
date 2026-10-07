// Tareas que se tachan, cuentas en tablas y tableros.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(() => { window.confirm = () => true; });
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('datos', { create: true });
  const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable();
  await s.write('# Doc\n\n- [ ] Comprar pan\n- [x] Pagar la luz\n\n| Item | Precio | Cantidad |\n| --- | --- | --- |\n| Pan | $ 1.200,50 | 2 |\n| Leche | $ 900,00 | 3 |\n| Yerba | $ 3.400,00 | 1 |\n\n```kanban\n## Por hacer\n- [ ] Diseñar\n- [ ] Probar\n\n## Hecho\n- [x] Planear\n```\n'); await s.close();
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.lmd-board');
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const o = {};

// tareas: tildar leyendo
o.tachadoInicial = await app.evaluate(() => [...document.querySelectorAll('li.lmd-task-item')].map((li) => getComputedStyle(li).textDecorationLine));
await app.locator('li.lmd-task-item', { hasText: 'Comprar pan' }).locator('input').check(); await app.waitForTimeout(300);
o.tarea = (await src()).split('\n')[2];
o.tachado = await app.evaluate(() => getComputedStyle(document.querySelector('li.lmd-task-item')).textDecorationLine);

// tablero: tildar, arrastrar, agregar
o.columnas = await app.evaluate(() => [...document.querySelectorAll('.lmd-col')].map((c) => c.querySelector('.lmd-col-title').textContent + ':' + c.querySelectorAll('.lmd-card').length));
await app.dragAndDrop('.lmd-col[data-c="0"] .lmd-card[data-k="1"]', '.lmd-col[data-c="1"] .lmd-cards'); await app.waitForTimeout(500);
o.arrastre = (await src()).split('\n').slice(11, 19);
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
await app.click('.lmd-col[data-c="0"] .lmd-card-add'); await app.waitForTimeout(300);
await app.keyboard.press('Control+a'); await app.keyboard.type('Publicar'); await app.keyboard.press('Enter'); await app.waitForTimeout(400);
await app.click('.lmd-col-add'); await app.waitForTimeout(400);
o.tablero = (await src()).split('\n').slice(11, 23);

o.tachadoEditando = await app.evaluate(() => getComputedStyle(document.querySelector('li.lmd-task-item .lmd-li-text')).textDecorationLine);
// tabla: totales y cambio de fórmula
await app.locator('td.lmd-cell', { hasText: 'Leche' }).click(); await app.waitForSelector('.lmd-tablebar:not([hidden])');
await app.click('[data-top=total]'); await app.waitForTimeout(600);
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(500);
o.totalFuente = (await src()).split('\n').filter((l) => /Total/.test(l))[0];
o.totalVista = await app.evaluate(() => [...document.querySelectorAll('.markdown-body table tbody tr:last-child td')].map((c) => c.textContent));
await app.locator('td.lmd-calc').last().click(); await app.waitForTimeout(200);
o.alEditar = await app.evaluate(() => document.activeElement.textContent);
await app.keyboard.press('Control+a'); await app.keyboard.type('=avg'); await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.promedio = await app.evaluate(() => [...document.querySelectorAll('.markdown-body table tbody tr:last-child td')].map((c) => c.textContent));
o.promedioFuente = (await src()).split('\n').filter((l) => /Total/.test(l))[0];
await app.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'mdtools-datos.png') });

const J = (v) => JSON.stringify(v);
const checks = [
  ['una tarea hecha se ve tachada', J(o.tachadoInicial) === J(['none', 'line-through']), o.tachadoInicial],
  ['tildar una tarea leyendo cambia el archivo y la tacha', o.tarea === '- [x] Comprar pan' && o.tachado === 'line-through', [o.tarea, o.tachado]],
  ['también se ve tachada en modo edición', o.tachadoEditando === 'line-through', o.tachadoEditando],
  ['el tablero arma columnas y tarjetas', J(o.columnas) === J(['Por hacer:2', 'Hecho:1']), o.columnas],
  ['arrastrar una tarjeta la cambia de columna', J(o.arrastre) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '', '## Hecho', '- [x] Planear', '- [ ] Probar', '```']), o.arrastre],
  ['agregar tarjeta y columna', J(o.tablero) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '- [ ] Publicar', '', '## Hecho', '- [x] Planear', '- [ ] Probar', '', '## Columna 3', '```', '']), o.tablero],
  ['la fila de totales guarda fórmulas', o.totalFuente === '| **Total** | =sum | =sum |', o.totalFuente],
  ['y muestra las sumas con el formato de la columna', J(o.totalVista) === J(['Total', '$ 5.500,50', '6']), o.totalVista],
  ['al entrar a la celda se ve la fórmula', o.alEditar === '=sum', o.alEditar],
  ['cambiar a promedio recalcula', J(o.promedio) === J(['Total', '$ 5.500,50', '2']) && o.promedioFuente === '| **Total** | =sum | =avg |', [o.promedio, o.promedioFuente]],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Tareas, tableros y cuentas');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
