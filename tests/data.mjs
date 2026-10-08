// Tareas que se tachan, cuentas en tablas y tableros.
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

// tarjetas con atributos: el formato, el detalle de una tarjeta y lo que se ve en chico
const bare = (lines) => lines.map((l) => l.replace(/ \{[^{}]*\}$/, ''));
const cardLine = async (text) => (await src()).split('\n').find((l) => l.includes('] ' + text)) || '';
o.modelo = await app.evaluate(() => {
  const M = LMD.board.model;
  const text = '{show=due,owner priority=low|medium|high estimate=number}\n## To do\n- [ ] Fix checkout {due=2026-10-20 owner="Ana Paz" id=c8k2m9xq created=2026-10-07T14:03:11Z updated=2026-10-07T15:10:02Z}\n- [x] Old card\n- [ ] Use {curly} braces\n- [ ] Quote {note="a \\"b\\" c"}\n\n## Done';
  const b = M.parse(text); const c = b.columns[0].cards;
  return { show: b.show, fields: b.fields, first: c[0], old: c[1], curly: c[2].text + '|' + Object.keys(c[2].attrs).length, quote: c[3].attrs.note, round: M.serialize(b).join('\n') === text };
});
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await app.locator('.lmd-card', { hasText: 'Diseñar' }).locator('.lmd-card-open').click({ force: true }); await app.waitForSelector('.lmd-cd');
o.detalle = await app.evaluate(() => ({ title: document.querySelector('.lmd-cd [data-cd=title]').value, col: document.querySelector('.lmd-cd [data-cd=col]').selectedOptions[0].textContent, cols: document.querySelector('.lmd-cd [data-cd=col]').options.length, fechas: document.querySelector('.lmd-cd-dates').textContent, sug: [...document.querySelectorAll('.lmd-cd-sug [data-cd-sug]')].map((b) => b.textContent) }));
await app.click('.lmd-cd [data-cd-sug=vence]'); await app.fill('.lmd-cd [data-cd-val=vence]', '2026-10-20');
await app.click('.lmd-cd [data-cd-sug=responsable]'); await app.fill('.lmd-cd [data-cd-val=responsable]', 'Ana Paz');
await app.click('.lmd-cd [data-cd=other]'); await app.fill('.lmd-cd [data-cd=name]', 'id'); await app.click('.lmd-cd [data-cd=add]');
o.reservado = await app.evaluate(() => !document.querySelector('.lmd-cd .lmd-dlg-err').hidden);
await app.fill('.lmd-cd [data-cd=name]', 'Puntos de esfuerzo'); await app.selectOption('.lmd-cd [data-cd=type]', 'number'); await app.click('.lmd-cd [data-cd=add]'); await app.fill('.lmd-cd [data-cd-val="Puntos-de-esfuerzo"]', '3');
await app.fill('.lmd-cd [data-cd=title]', 'Diseñar la tapa'); await app.click('.lmd-cd [data-cd=ok]'); await app.waitForSelector('.lmd-cd', { state: 'detached' }); await app.waitForTimeout(400);
o.conAtributos = await cardLine('Diseñar la tapa'); o.config = (await src()).split('\n').find((l) => /^\{show=/.test(l));
o.chips = await app.evaluate(() => [...document.querySelectorAll('.lmd-card')].filter((c) => /Diseñar la tapa/.test(c.textContent)).map((c) => [...c.querySelectorAll('.lmd-chip')].map((x) => x.dataset.attr + '=' + x.textContent))[0]);
// mover de estado desde el detalle y quitar un atributo
await app.locator('.lmd-card', { hasText: 'Diseñar la tapa' }).locator('.lmd-card-text').click(); await app.waitForSelector('.lmd-cd');
await app.selectOption('.lmd-cd [data-cd=col]', { label: 'Hecho' }); await app.check('.lmd-cd [data-cd=done]'); await app.click('.lmd-cd [data-cd-rm=responsable]'); await app.click('.lmd-cd [data-cd=ok]'); await app.waitForSelector('.lmd-cd', { state: 'detached' }); await app.waitForTimeout(400);
o.movida = await cardLine('Diseñar la tapa'); o.movidaCol = await app.evaluate(() => [...document.querySelectorAll('.lmd-col')].find((c) => /Diseñar la tapa/.test(c.textContent)).querySelector('.lmd-col-title').textContent);
// cancelar no cambia nada
const antes = await src();
await app.locator('.lmd-card', { hasText: 'Publicar' }).locator('.lmd-card-text').click(); await app.waitForSelector('.lmd-cd'); await app.fill('.lmd-cd [data-cd=title]', 'Otra cosa'); await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-cd', { state: 'detached' });
o.cancelar = (await src()) === antes;

// ajustes de la página: viven en el encabezado de la nota
o.pagina = await app.evaluate(() => {
  const P = LMD.page; const a = P.write('# Hola\n', 'width', 'wide'); const b = P.write(a, 'numbered', 'yes'); const c = P.write(P.write(b, 'width', 'normal'), 'numbered', 'no');
  const d = P.write('---\ntitle: Plan\n---\n\n# Hola\n', 'width', 'full');
  return { a, b, c, d, read: P.read(b), malo: P.read('---\nwidth: 9000px\nnumbered: quizas\nfont: evil\n---\n'), noToca: P.write('# Hola\n', 'width', 'url(x)') === '# Hola\n' && P.write('# Hola\n', 'css', 'x') === '# Hola\n' };
});
await app.click('[data-act=mode-edit]'); await app.click('[data-act=view-raw]'); await app.waitForSelector('.lmd-raw-edit:not([hidden])');
await app.evaluate(() => { const lines = ['', '```kanban']; for (let i = 1; i <= 9; i++) lines.push('## Columna larga ' + i, '- [ ] Tarjeta ' + i, ''); lines.push('```', ''); const t = document.querySelector('.lmd-raw-edit'); t.value = t.value + lines.join('\n'); t.dispatchEvent(new Event('input', { bubbles: true })); });
await app.waitForTimeout(400); await app.click('[data-act=view-doc]'); await app.click('[data-act=mode-read]'); await app.waitForTimeout(700);
o.ancho = await app.evaluate(() => { const b = [...document.querySelectorAll('.lmd-board')].pop(); const art = document.querySelector('.lmd-article'); const p = art.querySelector('p, h1').getBoundingClientRect(); const r = b.getBoundingClientRect(); const host = art.parentElement.getBoundingClientRect();
  return { sale: r.width > p.width + 40, adentro: r.left >= host.left - 1 && r.right <= host.right + 1, pagina: document.documentElement.scrollWidth <= window.innerWidth, desliza: b.scrollWidth > b.clientWidth, sombra: b.classList.contains('lmd-more-r'), fina: getComputedStyle(b).scrollbarWidth, aviso: (document.querySelector('.lmd-page-nudge') || {}).textContent || '' }; });
await app.click('.lmd-page-nudge [data-nudge=wide]'); await app.waitForTimeout(500);
o.ancha = await app.evaluate(() => ({ clase: document.documentElement.classList.contains('lmd-pw-wide'), aviso: !!document.querySelector('.lmd-page-nudge'), front: !!document.querySelector('.lmd-front'), get: LMD.page.get('width') }));
o.anchaFuente = (await src()).split('\n').slice(0, 4);
await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg');
o.dialogoPagina = await app.evaluate(() => ({ marcado: document.querySelector('.lmd-pg [aria-checked=true]').dataset.pgWidth, opciones: [...document.querySelectorAll('.lmd-pg [data-pg-width]')].map((b) => b.textContent) }));
await app.click('.lmd-pg [data-pg-width=normal]'); await app.check('.lmd-pg [data-pg=numbered]'); await app.click('.lmd-pg [data-pg=ok]'); await app.waitForTimeout(400);
o.numerada = await app.evaluate(() => ({ clase: document.documentElement.classList.contains('lmd-page-numbered') && !document.documentElement.classList.contains('lmd-pw-wide'), antes: getComputedStyle(document.querySelector('.lmd-article > h2') || document.body, '::before').content, otraVez: !!document.querySelector('.lmd-page-nudge') }));
o.numeradaFuente = (await src()).split('\n').slice(0, 3);

const J = (v) => JSON.stringify(v);
const checks = [
  ['una tarea hecha se ve tachada', J(o.tachadoInicial) === J(['none', 'line-through']), o.tachadoInicial],
  ['tildar una tarea leyendo cambia el archivo y la tacha', o.tarea === '- [x] Comprar pan' && o.tachado === 'line-through', [o.tarea, o.tachado]],
  ['también se ve tachada en modo edición', o.tachadoEditando === 'line-through', o.tachadoEditando],
  ['el tablero arma columnas y tarjetas', J(o.columnas) === J(['Por hacer:2', 'Hecho:1']), o.columnas],
  ['arrastrar una tarjeta la cambia de columna', J(bare(o.arrastre)) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '', '## Hecho', '- [x] Planear', '- [ ] Probar', '```']), o.arrastre],
  ['un tablero viejo recibe id y fecha de creación en su primera edición', o.arrastre.filter((l) => /^- \[/.test(l)).every((l) => /^- \[[ x]\] \S+ \{id=[a-z2-9]{8} created=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ( updated=\S+)?\}$/.test(l)) && new Set(o.arrastre.join(' ').match(/id=[a-z2-9]{8}/g)).size === 3, o.arrastre],
  ['solo la tarjeta que se movió queda con fecha de edición', /updated=/.test(o.arrastre[6]) && !/updated=/.test(o.arrastre[2]) && !/updated=/.test(o.arrastre[5]), o.arrastre],
  ['agregar tarjeta y columna', J(bare(o.tablero)) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '- [ ] Publicar', '', '## Hecho', '- [x] Planear', '- [ ] Probar', '', '## Columna 3', '```', '']), o.tablero],
  ['los ids no cambian al seguir editando', o.arrastre[2] === o.tablero[2] && o.arrastre[5] === o.tablero[6], [o.arrastre, o.tablero]],
  ['el formato: configuración del tablero, atributos con comillas, id y fechas', J(o.modelo.show) === J(['due', 'owner']) && J(o.modelo.fields) === J({ priority: { type: 'select', options: ['low', 'medium', 'high'] }, estimate: { type: 'number' } }) && J(o.modelo.first) === J({ id: 'c8k2m9xq', text: 'Fix checkout', done: false, created: '2026-10-07T14:03:11Z', updated: '2026-10-07T15:10:02Z', attrs: { due: '2026-10-20', owner: 'Ana Paz' } }), o.modelo],
  ['una tarjeta sin llaves es una tarjeta sin atributos, y unas llaves que no son atributos quedan como texto', o.modelo.old.id === '' && o.modelo.old.done === true && J(o.modelo.old.attrs) === '{}' && o.modelo.curly === 'Use {curly} braces|0' && o.modelo.quote === 'a "b" c', o.modelo],
  ['leer y volver a escribir deja el mismo texto', o.modelo.round === true, o.modelo],
  ['el detalle de una tarjeta: título, estado, fechas y atributos sugeridos', o.detalle.title === 'Diseñar' && o.detalle.col === 'Por hacer' && o.detalle.cols === 3 && /^Creada el .+ · Editada el /.test(o.detalle.fechas) && J(o.detalle.sug) === J(['Vence', 'Responsable', 'Prioridad', 'Etiqueta', 'Enlace']), o.detalle],
  ['un atributo no puede llamarse id', o.reservado === true, o.reservado],
  ['agregar atributos sin escribir sintaxis', /^- \[ \] Diseñar la tapa \{vence=2026-10-20 responsable="Ana Paz" Puntos-de-esfuerzo=3 id=[a-z2-9]{8} created=\S+ updated=\S+\}$/.test(o.conAtributos), o.conAtributos],
  ['el tablero anota qué atributos se ven y de qué tipo son', o.config === '{show=vence,responsable,Puntos-de-esfuerzo vence=date Puntos-de-esfuerzo=number}', o.config],
  ['la tarjeta muestra en chico los atributos elegidos', J(o.chips) === J(['vence=20 oct', 'responsable=Ana Paz', 'Puntos-de-esfuerzo=3']), o.chips],
  ['desde el detalle: cambiar de estado, tildar y quitar un atributo', /^- \[x\] Diseñar la tapa \{vence=2026-10-20 Puntos-de-esfuerzo=3 id=/.test(o.movida) && o.movidaCol === 'Hecho' && o.movida.match(/id=(\w+)/)[1] === o.conAtributos.match(/id=(\w+)/)[1], [o.movida, o.movidaCol]],
  ['cancelar el detalle no cambia la nota', o.cancelar === true],
  ['ajustes de la página: se escriben en el encabezado con claves simples', o.pagina.a === '---\nwidth: wide\n---\n\n# Hola\n' && o.pagina.b === '---\nwidth: wide\nnumbered: true\n---\n\n# Hola\n' && o.pagina.c === '# Hola\n' && o.pagina.d === '---\ntitle: Plan\nwidth: full\n---\n\n# Hola\n' && J(o.pagina.read) === J({ width: 'wide', numbered: 'yes' }), o.pagina],
  ['un valor que no está en la lista no hace nada', J(o.pagina.malo) === J({ width: 'normal', numbered: 'no' }) && o.pagina.noToca === true, o.pagina.malo],
  ['un tablero ancho se sale de la columna de texto sin salirse del área de la nota', o.ancho.sale && o.ancho.adentro && o.ancho.pagina, o.ancho],
  ['si aun así no entra, se desliza con una barra fina y el borde se desvanece', o.ancho.desliza && o.ancho.sombra && o.ancho.fina === 'thin', o.ancho],
  ['una línea ofrece la página ancha', /Este tablero es más ancho que la página\./.test(o.ancho.aviso), o.ancho.aviso],
  ['aceptarla escribe width: wide en la nota y no se lista entre sus datos', o.ancha.clase && !o.ancha.aviso && !o.ancha.front && o.ancha.get === 'wide' && J(o.anchaFuente) === J(['---', 'width: wide', '---', '']), [o.ancha, o.anchaFuente]],
  ['la ventana de ajustes de la página muestra el ancho de ahora', o.dialogoPagina.marcado === 'wide' && J(o.dialogoPagina.opciones) === J(['Normal', 'Ancha', 'Completa']), o.dialogoPagina],
  ['numerar los títulos, y el aviso no vuelve a salir en esa nota', o.numerada.clase && !o.numerada.otraVez && J(o.numeradaFuente) === J(['---', 'numbered: true', '---']), [o.numerada, o.numeradaFuente]],
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
