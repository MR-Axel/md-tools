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

// tablero: tarjetas sin casilla ni X, arrastrar, agregar
o.columnas = await app.evaluate(() => [...document.querySelectorAll('.lmd-col')].map((c) => c.querySelector('.lmd-col-title').textContent + ':' + c.querySelectorAll('.lmd-card').length));
o.limpia = await app.evaluate(() => { const cards = [...document.querySelectorAll('.lmd-card')]; const done = document.querySelector('.lmd-col[data-c="1"] .lmd-card');
  return { controles: document.querySelectorAll('.lmd-card input, .lmd-card button, .lmd-card [contenteditable]').length, rol: cards[0].getAttribute('role'), tab: cards[0].tabIndex, nombre: cards[0].getAttribute('aria-label'), hechas: cards.map((c) => c.classList.contains('lmd-card-done')), tachado: getComputedStyle(done.querySelector('.lmd-card-text')).textDecorationLine, opaca: +getComputedStyle(done).opacity < 1,
    colHecha: [...document.querySelectorAll('.lmd-col')].map((c) => c.classList.contains('lmd-col-done') && !!c.querySelector('.lmd-col-mark')) }; });
const dropEnd = async (from, col) => { const box = await app.locator('.lmd-col[data-c="' + col + '"]').boundingBox(); await app.dragAndDrop(from, '.lmd-col[data-c="' + col + '"]', { targetPosition: { x: 60, y: box.height - 4 } }); await app.waitForTimeout(500); };
await dropEnd('.lmd-col[data-c="0"] .lmd-card[data-k="1"]', 1);
o.arrastreNoAbre = await app.evaluate(() => !document.querySelector('.lmd-cd'));
o.arrastre = (await src()).split('\n').slice(11, 19);
// sacar una tarjeta de la columna de hechas la vuelve a dejar sin tildar
await dropEnd('.lmd-col[data-c="1"] .lmd-card[data-k="0"]', 0);
o.vuelve = (await src()).split('\n').find((l) => /\] Planear/.test(l)) || '';
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
// tarjeta nueva: se abre el detalle con el foco en el título, y cancelada sin título no se crea
const sinNueva = await src();
await app.click('.lmd-col[data-c="0"] .lmd-card-add'); await app.waitForSelector('.lmd-cd');
o.nuevaFoco = await app.evaluate(() => ({ foco: document.activeElement.dataset.cd, vacio: document.querySelector('.lmd-cd [data-cd=title]').value === '', eliminar: !!document.querySelector('.lmd-cd [data-cd=del]') }));
await app.keyboard.press('Enter'); o.nuevaSinTitulo = await app.evaluate(() => !!document.querySelector('.lmd-cd') && !document.querySelector('.lmd-cd .lmd-dlg-err').hidden);
await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-cd', { state: 'detached' }); await app.waitForTimeout(200);
o.nuevaCancelada = (await src()) === sinNueva;
await app.click('.lmd-col[data-c="0"] .lmd-card-add'); await app.waitForSelector('.lmd-cd');
await app.keyboard.type('Publicar'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-cd', { state: 'detached' }); await app.waitForTimeout(400);
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

// tarjetas con campos: el formato, el detalle de una tarjeta y lo que se ve en chico
const bare = (lines) => lines.map((l) => l.replace(/ \{[^{}]*\}$/, ''));
const cardLine = async (text) => (await src()).split('\n').find((l) => l.includes('] ' + text)) || '';
const cfgLine = async () => (await src()).split('\n').find((l) => /^\{.*\}$/.test(l)) || '';
const card = (text) => app.locator('.lmd-card', { hasText: text });
const saved = async () => { await app.waitForSelector('.lmd-cd', { state: 'detached' }); await app.waitForTimeout(400); };
const addType = async (type) => { await app.click('.lmd-cd [data-cd=add-open]'); await app.click('.lmd-cd [data-cd-type=' + type + ']'); await app.waitForSelector('.lmd-cd .lmd-cd-new'); };
const focusOn = () => app.evaluate(() => document.activeElement.dataset.cd || '');
o.modelo = await app.evaluate(() => {
  const M = LMD.board.model;
  const text = '{show=due,owner priority=low|medium|high estimate=number done=Shipped tags=bug:red,idea:blue}\n## To do\n- [ ] Fix checkout {due=2026-10-20 owner="Ana Paz" id=c8k2m9xq created=2026-10-07T14:03:11Z by=Ana updated=2026-10-07T15:10:02Z}\n- [x] Old card\n- [ ] Use {curly} braces\n- [ ] Quote {note="a \\"b\\" c"}\n\n## Shipped\n\n## Done';
  const b = M.parse(text); const c = b.columns[0].cards;
  const idx = (t) => M.doneIndex(M.parse(t));
  return { show: b.show, fields: b.fields, done: b.done, tags: b.tags, first: c[0], old: c[1], curly: c[2].text + '|' + Object.keys(c[2].attrs).length, quote: c[3].attrs.note, round: M.serialize(b).join('\n') === text,
    indices: [M.doneIndex(b), idx('## To do\n## Listo'), idx('## A\n## Hechas ✅\n## Done'), idx('{done=""}\n## A\n## Done'), idx('{done=A}\n## A\n## Done'), idx('## A\n## B'), idx('{done=Nope}\n## A\n## Done')],
    viejo: M.serialize(M.parse('{show=a tags=x|y}\n## A')).join('\n') };
});
await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
await card('Diseñar').click(); await app.waitForSelector('.lmd-cd');
o.detalle = await app.evaluate(() => { const q = (s) => document.querySelector('.lmd-cd ' + s); const order = [...document.querySelectorAll('.lmd-cd-card > *')].map((n) => n.className.split(' ').pop());
  return { title: q('[data-cd=title]').value, col: q('[data-cd=col]').selectedOptions[0].textContent, cols: q('[data-cd=col]').options.length, fechas: q('.lmd-cd-dates').textContent, casilla: !!q('[data-cd=done]') || !!q('input[type=checkbox]'), pastillas: !!q('.lmd-cd-sug'), agregar: q('[data-cd=add-open]').textContent, order,
    botones: [...document.querySelectorAll('.lmd-cd-actions button')].map((b) => b.dataset.cd), grande: parseFloat(getComputedStyle(q('[data-cd=title]')).fontSize) >= 18 }; });
await app.click('.lmd-cd [data-cd=add-open]');
o.tipos = await app.evaluate(() => ({ nuevos: [...document.querySelectorAll('.lmd-cd [data-cd-type]')].map((b) => b.textContent), usar: document.querySelectorAll('.lmd-cd [data-cd-use]').length, foco: document.activeElement.dataset.cdType }));
await app.keyboard.press('Escape'); o.escCierraElAgregar = await app.evaluate(() => !!document.querySelector('.lmd-cd') && !document.querySelector('.lmd-cd [data-cd-type]') && document.activeElement.dataset.cd === 'add-open');
await app.waitForTimeout(500);
// fecha límite: ya trae nombre, el foco va al valor y Enter lo agrega
await addType('due'); o.focoFecha = await focusOn();
await app.fill('.lmd-cd [data-cd=newval]', '2026-10-20'); await app.keyboard.press('Enter');
o.fecha = await app.evaluate(() => ({ fila: (document.querySelector('.lmd-cd [data-cd-val=vence]') || {}).type, tipo: document.querySelector('.lmd-cd-attr').dataset.kind, cerrado: !document.querySelector('.lmd-cd-new'), foco: document.activeElement.dataset.cd, ver: document.querySelector('.lmd-cd [data-cd-show=vence]').checked, rol: document.querySelector('.lmd-cd [data-cd-show=vence]').getAttribute('role') }));
// responsable: varias personas, con "Yo" y lo ya usado
await addType('person'); o.yo = await app.evaluate(() => (document.querySelector('.lmd-cd [data-cd-me]') || {}).textContent);
await app.fill('.lmd-cd [data-cd=newval]', 'Ana Paz'); await app.keyboard.press('Enter');
await app.click('.lmd-cd [data-cd-val=responsable]'); await app.keyboard.type('Lia'); await app.keyboard.press('Enter');
o.personas = await app.evaluate(() => ({ abierto: !!document.querySelector('.lmd-cd'), pastillas: [...document.querySelectorAll('.lmd-cd-attr[data-key=responsable] .lmd-cd-pill')].map((p) => p.textContent) }));
// prioridad, etiquetas, enlace
await addType('priority'); await app.selectOption('.lmd-cd [data-cd=newval]', 'alta'); await app.click('.lmd-cd [data-cd=add]');
await addType('tags'); await app.fill('.lmd-cd [data-cd=newval]', 'bug, idea'); await app.keyboard.press('Enter');
await addType('link'); await app.fill('.lmd-cd [data-cd=newval]', 'javascript:alert(1)'); await app.keyboard.press('Enter');
o.enlaceMalo = await app.evaluate(() => !document.querySelector('.lmd-cd .lmd-dlg-err').hidden && !document.querySelector('.lmd-cd [data-cd-val=enlace]'));
await app.fill('.lmd-cd [data-cd=newval]', 'ejemplo.com/docs'); await app.keyboard.press('Enter');
// los genéricos piden un nombre
await addType('number'); o.focoNumero = await focusOn();
await app.fill('.lmd-cd [data-cd=name]', 'id'); await app.keyboard.press('Enter'); await app.keyboard.press('Enter');
o.reservado = await app.evaluate(() => !document.querySelector('.lmd-cd .lmd-dlg-err').hidden);
await app.fill('.lmd-cd [data-cd=name]', 'Puntos de esfuerzo'); await app.keyboard.press('Enter'); o.focoTrasNombre = await focusOn();
await app.keyboard.type('3'); await app.keyboard.press('Enter');
await addType('text'); await app.fill('.lmd-cd [data-cd=name]', 'Nota'); await app.fill('.lmd-cd [data-cd=newval]', 'Ver con Ana'); await app.click('.lmd-cd [data-cd=add]');
await addType('select'); await app.fill('.lmd-cd [data-cd=name]', 'Etapa'); await app.fill('.lmd-cd [data-cd=opts]', 'idea, borrador, final'); await app.selectOption('.lmd-cd [data-cd=newval]', 'borrador'); await app.click('.lmd-cd [data-cd=add]');
o.filas = await app.evaluate(() => [...document.querySelectorAll('.lmd-cd-attr')].map((r) => r.dataset.key + ':' + r.dataset.kind + ':' + !!r.querySelector('.lmd-cd-ico svg')));
o.sinPredefinidos = await (async () => { await app.click('.lmd-cd [data-cd=add-open]'); const t = await app.evaluate(() => [...document.querySelectorAll('.lmd-cd [data-cd-type]')].map((b) => b.dataset.cdType)); await app.click('.lmd-cd [data-cd=add-cancel]'); return t; })();
await app.fill('.lmd-cd [data-cd=title]', 'Diseñar la tapa'); await app.keyboard.press('Control+Enter'); await saved();
o.conAtributos = await cardLine('Diseñar la tapa'); o.config = await cfgLine();
o.chips = await app.evaluate(() => { const c = [...document.querySelectorAll('.lmd-card')].find((x) => /Diseñar la tapa/.test(x.textContent));
  return [...c.querySelectorAll('.lmd-chip')].map((x) => x.dataset.attr + '=' + (x.matches('.lmd-chip-people') ? [...x.querySelectorAll('.lmd-avatar')].map((a) => a.textContent + '/' + a.title).join('+') : x.matches('a') ? x.getAttribute('href') + '|' + x.target + '|' + x.rel + '|' + !!x.querySelector('svg') : x.textContent) + (x.querySelector('.lmd-prio-high') ? '|punto' : '') + (x.matches('.lmd-ktag') ? '|pastilla' : '')); });
o.colores = await app.evaluate(() => { const t = [...document.querySelectorAll('.lmd-card .lmd-ktag')].map((x) => (x.className.match(/lmd-ktag-(\w+)/) || [])[1]); const again = [...document.querySelectorAll('.lmd-card .lmd-ktag')].map((x) => getComputedStyle(x).backgroundColor); return { t, distintos: again[0] !== again[1] }; });
// un clic en el enlace de la tarjeta no abre el detalle
await app.evaluate(() => { window.open = () => null; const a = document.querySelector('.lmd-card a.lmd-chip-link'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
o.enlaceNoAbre = await app.evaluate(() => !document.querySelector('.lmd-cd'));
// un campo que ya existe en el tablero se sugiere primero, y una fecha pasada se ve vencida
await card('Publicar').click(); await app.waitForSelector('.lmd-cd');
await app.click('.lmd-cd [data-cd=add-open]');
o.usar = await app.evaluate(() => ({ titulo: (document.querySelector('.lmd-cd .lmd-cd-sub') || {}).textContent, campos: [...document.querySelectorAll('.lmd-cd [data-cd-use]')].map((b) => b.textContent), nuevos: [...document.querySelectorAll('.lmd-cd [data-cd-type]')].map((b) => b.dataset.cdType) }));
await app.click('.lmd-cd [data-cd-use=vence]'); await app.fill('.lmd-cd [data-cd=newval]', '2020-01-02'); await app.keyboard.press('Enter');
await app.click('.lmd-cd [data-cd=add-open]'); await app.click('.lmd-cd [data-cd-use=responsable]');
o.sugeridas = await app.evaluate(() => [...document.querySelectorAll('.lmd-cd-new datalist option')].map((x) => x.value));
await app.click('.lmd-cd [data-cd=add-cancel]');
await app.click('.lmd-cd [data-cd=ok]'); await saved();
o.vencida = await app.evaluate(() => { const c = [...document.querySelectorAll('.lmd-card')].find((x) => /Publicar/.test(x.textContent)).querySelector('.lmd-chip'); return c.className + '|' + c.title; });
// con el teclado: Enter sobre la tarjeta la abre. Enlace clicable con lápiz, color de etiqueta, quitar con deshacer
await card('Diseñar la tapa').focus(); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-cd');
o.enlace = await app.evaluate(() => { const a = document.querySelector('.lmd-cd-attr[data-key=enlace] a'); return { href: a.getAttribute('href'), texto: a.textContent, target: a.target, rel: a.rel, lapiz: !!document.querySelector('.lmd-cd [data-cd-edit]'), campo: document.querySelector('.lmd-cd [data-cd-val=enlace]').hidden }; });
await app.click('.lmd-cd [data-cd-edit]'); await app.fill('.lmd-cd [data-cd-val=enlace]', 'https://ejemplo.com/guia'); await app.click('.lmd-cd [data-cd=title]');
o.enlaceEditado = await app.evaluate(() => document.querySelector('.lmd-cd-attr[data-key=enlace] a').getAttribute('href'));
await app.click('.lmd-cd [data-cd-tag=bug]');
o.paleta = await app.evaluate(() => [...document.querySelectorAll('.lmd-cd [data-cd-color]')].map((b) => b.dataset.cdColor));
await app.click('.lmd-cd [data-cd-color=blue]');
await app.click('.lmd-cd [data-cd-pop=idea]');
o.etiquetas = await app.evaluate(() => [...document.querySelectorAll('.lmd-cd-attr[data-key=etiquetas] .lmd-cd-pill')].map((p) => p.textContent + ':' + (p.className.match(/lmd-ktag-(\w+)/) || [])[1]));
await app.click('.lmd-cd [data-cd-rm=responsable]');
o.quitado = await app.evaluate(() => ({ fila: !!document.querySelector('.lmd-cd-attr[data-key=responsable]'), aviso: document.querySelector('.lmd-cd-undo').textContent, foco: document.activeElement.dataset.cd }));
await app.keyboard.press('Enter');
o.deshecho = await app.evaluate(() => ({ orden: [...document.querySelectorAll('.lmd-cd-attr')].map((r) => r.dataset.key).slice(0, 3), valor: [...document.querySelectorAll('.lmd-cd-attr[data-key=responsable] .lmd-cd-pill')].map((p) => p.textContent), aviso: document.querySelector('.lmd-cd-undo').hidden }));
await app.click('.lmd-cd [data-cd-rm=Nota]'); await app.uncheck('.lmd-cd [data-cd-show=Etapa]');
// el estado es la columna: pasarla a la de hechas la tilda
await app.selectOption('.lmd-cd [data-cd=col]', { label: 'Hecho' }); await app.click('.lmd-cd [data-cd=ok]'); await saved();
o.movida = await cardLine('Diseñar la tapa'); o.movidaCol = await app.evaluate(() => [...document.querySelectorAll('.lmd-col')].find((c) => /Diseñar la tapa/.test(c.textContent)).querySelector('.lmd-col-title').textContent);
o.configDespues = await cfgLine();
o.focoVuelve = await app.evaluate(() => document.activeElement.classList.contains('lmd-card') && /Diseñar la tapa/.test(document.activeElement.textContent));
// Escape: sin cambios cierra; con cambios avisa antes
const antes = await src();
await card('Publicar').click(); await app.waitForSelector('.lmd-cd'); await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-cd', { state: 'detached' });
await app.evaluate(() => { window.__manual = true; });
await card('Publicar').click(); await app.waitForSelector('.lmd-cd'); await app.fill('.lmd-cd [data-cd=title]', 'Otra cosa'); await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-dlg');
await app.waitForTimeout(250);
o.aviso = await app.evaluate(() => ({ uno: document.querySelectorAll('.lmd-dlg').length, texto: document.querySelector('.lmd-dlg h3').textContent, botones: [...document.querySelectorAll('.lmd-dlg [data-dlg]')].map((b) => b.textContent) }));
await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-dlg', { state: 'detached' }); await app.waitForTimeout(250);
o.sigue = await app.evaluate(() => !!document.querySelector('.lmd-cd') && document.querySelector('.lmd-cd [data-cd=title]').value === 'Otra cosa');
await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-dlg'); await app.click('.lmd-dlg [data-dlg=ok]'); await app.waitForSelector('.lmd-cd', { state: 'detached' });
o.cancelar = (await src()) === antes;
// eliminar vive en el detalle, y pregunta
await card('Publicar').click(); await app.waitForSelector('.lmd-cd'); await app.click('.lmd-cd [data-cd=del]'); await app.waitForSelector('.lmd-dlg');
o.eliminarPregunta = await app.evaluate(() => document.querySelector('.lmd-dlg h3').textContent);
await app.click('.lmd-dlg [data-dlg=no]'); await app.waitForTimeout(200); o.eliminarNo = (await src()) === antes && await app.evaluate(() => !!document.querySelector('.lmd-cd'));
await app.click('.lmd-cd [data-cd=del]'); await app.click('.lmd-dlg [data-dlg=ok]'); await saved();
o.eliminada = !(await cardLine('Publicar'));
await app.evaluate(() => { window.__manual = false; });
// el menú de la columna: marcarla como la de hechas tilda sus tarjetas, y quitarle la marca las destilda
await app.dragAndDrop('.lmd-col[data-c="0"] .lmd-card[data-k="0"]', '.lmd-col[data-c="2"]'); await app.waitForTimeout(500);
o.aComun = await cardLine('Planear');
await app.hover('.lmd-col[data-c="2"] .lmd-col-head'); await app.click('.lmd-col[data-c="2"] .lmd-col-menu'); await app.waitForSelector('.lmd-menu-col');
o.menuCol = await app.evaluate(() => [...document.querySelectorAll('.lmd-menu-col [data-bm]')].map((b) => b.textContent));
await app.click('.lmd-menu-col [data-bm=done]'); await app.waitForTimeout(500);
o.marcada = { cfg: await cfgLine(), linea: (await cardLine('Planear')).slice(0, 13), col: await app.evaluate(() => [...document.querySelectorAll('.lmd-col')].map((c) => c.classList.contains('lmd-col-done'))), vieja: (await cardLine('Probar')).slice(0, 12), viejaOpaca: await app.evaluate(() => [...document.querySelectorAll('.lmd-card')].find((c) => /Probar/.test(c.textContent)).classList.contains('lmd-card-done')) };
await app.hover('.lmd-col[data-c="2"] .lmd-col-head'); await app.click('.lmd-col[data-c="2"] .lmd-col-menu'); await app.waitForSelector('.lmd-menu-col');
o.menuColHecha = await app.evaluate(() => document.querySelector('.lmd-menu-col [data-bm=done]').textContent);
await app.click('.lmd-menu-col [data-bm=done]'); await app.waitForTimeout(500);
o.desmarcada = { cfg: await cfgLine(), linea: (await cardLine('Planear')).slice(0, 13), col: await app.evaluate(() => document.querySelectorAll('.lmd-col-done').length) };
await app.hover('.lmd-col[data-c="1"] .lmd-col-head'); await app.click('.lmd-col[data-c="1"] .lmd-col-menu'); await app.click('.lmd-menu-col [data-bm=done]'); await app.waitForTimeout(500);
o.remarcada = await cfgLine();

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
  ['una tarjeta no tiene casilla, ni X, ni texto que se edite en el lugar: es un botón con nombre', o.limpia.controles === 0 && o.limpia.rol === 'button' && o.limpia.tab === 0 && o.limpia.nombre === 'Abrir la tarjeta: Diseñar', o.limpia],
  ['la columna de hechas se reconoce por su nombre, y sus tarjetas se ven atenuadas, sin tachar', J(o.limpia.colHecha) === J([false, true]) && J(o.limpia.hechas) === J([false, false, true]) && o.limpia.tachado === 'none' && o.limpia.opaca === true, o.limpia],
  ['arrastrar una tarjeta a la columna de hechas la tilda en el archivo, y no abre el detalle', J(bare(o.arrastre)) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '', '## Hecho', '- [x] Planear', '- [x] Probar', '```']) && o.arrastreNoAbre === true, o.arrastre],
  ['y sacarla de ahí la deja sin tildar', /^- \[ \] Planear \{id=\S+ created=\S+ updated=\S+\}$/.test(o.vuelve), o.vuelve],
  ['un tablero viejo recibe id y fecha de creación en su primera edición', o.arrastre.filter((l) => /^- \[/.test(l)).every((l) => /^- \[[ x]\] \S+ \{id=[a-z2-9]{8} created=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ( updated=\S+)?\}$/.test(l)) && new Set(o.arrastre.join(' ').match(/id=[a-z2-9]{8}/g)).size === 3, o.arrastre],
  ['solo la tarjeta que se movió queda con fecha de edición', /updated=/.test(o.arrastre[6]) && !/updated=/.test(o.arrastre[2]) && !/updated=/.test(o.arrastre[5]), o.arrastre],
  ['"+ Tarjeta" abre el detalle con el foco en el título, sin botón de eliminar', o.nuevaFoco.foco === 'title' && o.nuevaFoco.vacio && !o.nuevaFoco.eliminar, o.nuevaFoco],
  ['sin título no se guarda, y cancelada no se crea', o.nuevaSinTitulo === true && o.nuevaCancelada === true, [o.nuevaSinTitulo, o.nuevaCancelada]],
  ['agregar tarjeta y columna', J(bare(o.tablero)) === J(['```kanban', '## Por hacer', '- [ ] Diseñar', '- [ ] Planear', '- [ ] Publicar', '', '## Hecho', '- [x] Probar', '', '## Columna 3', '```', '']), o.tablero],
  ['los ids no cambian al seguir editando', o.arrastre[2] === o.tablero[2] && o.arrastre[6] === o.tablero[7], [o.arrastre, o.tablero]],
  ['el formato: configuración del tablero, campos con comillas, id, fechas y autor', J(o.modelo.show) === J(['due', 'owner']) && J(o.modelo.fields) === J({ priority: { type: 'select', options: ['low', 'medium', 'high'] }, estimate: { type: 'number' } }) && J(o.modelo.first) === J({ id: 'c8k2m9xq', text: 'Fix checkout', done: false, created: '2026-10-07T14:03:11Z', updated: '2026-10-07T15:10:02Z', by: 'Ana', attrs: { due: '2026-10-20', owner: 'Ana Paz' } }), o.modelo],
  ['la columna de hechas y los colores de las etiquetas van en el renglón de configuración, y no son campos', o.modelo.done === 'Shipped' && J(o.modelo.tags) === J({ bug: 'red', idea: 'blue' }), o.modelo],
  ['la columna de hechas: la que dice el tablero o la que se llama como una; done="" es ninguna', J(o.modelo.indices) === J([1, 1, 1, -1, 0, -1, 1]), o.modelo.indices],
  ['un tablero viejo con un campo llamado tags sigue siendo un campo', o.modelo.viejo === '{show=a tags=x|y}\n## A', o.modelo.viejo],
  ['una tarjeta sin llaves es una tarjeta sin campos, y unas llaves que no son campos quedan como texto', o.modelo.old.id === '' && o.modelo.old.done === true && J(o.modelo.old.attrs) === '{}' && o.modelo.curly === 'Use {curly} braces|0' && o.modelo.quote === 'a "b" c', o.modelo],
  ['leer y volver a escribir deja el mismo texto', o.modelo.round === true, o.modelo],
  ['un clic abre el detalle: título grande, estado, campos, fechas al pie y botones', o.detalle.title === 'Diseñar' && o.detalle.col === 'Por hacer' && o.detalle.cols === 3 && /^Creada el .+ · Editada el /.test(o.detalle.fechas) && o.detalle.grande && J(o.detalle.order) === J(['lmd-cd-title', 'lmd-cd-state', 'lmd-cd-attrs', 'lmd-cd-undo', 'lmd-cd-add', 'lmd-dlg-err', 'lmd-cd-dates', 'lmd-cd-actions']) && J(o.detalle.botones) === J(['del', 'no', 'ok']), o.detalle],
  ['el detalle no tiene casilla de hecha ni fila de pastillas: un solo renglón para agregar', o.detalle.casilla === false && o.detalle.pastillas === false && o.detalle.agregar === '+ Agregar campo', o.detalle],
  ['agregar un campo empieza por elegir el tipo', J(o.tipos.nuevos) === J(['Fecha límite', 'Responsable', 'Prioridad', 'Etiquetas', 'Enlace', 'Número', 'Texto', 'Lista de opciones']) && o.tipos.usar === 0 && o.tipos.foco === 'due', o.tipos],
  ['Escape cierra primero el agregar, no el detalle', o.escCierraElAgregar === true, o.escCierraElAgregar],
  ['un tipo predefinido ya trae nombre: el foco va al valor y Enter lo agrega', o.focoFecha === 'newval' && o.fecha.fila === 'date' && o.fecha.tipo === 'date' && o.fecha.cerrado && o.fecha.foco === 'add-open' && o.fecha.ver === true && o.fecha.rol === 'switch', [o.focoFecha, o.fecha]],
  ['responsable: varias personas, con "Yo" a mano, sin cerrar el detalle', o.yo === '+ Yo' && o.personas.abierto && J(o.personas.pastillas) === J(['APAna Paz', 'LLia']), [o.yo, o.personas]],
  ['un enlace solo acepta http o https', o.enlaceMalo === true, o.enlaceMalo],
  ['un tipo genérico pide el nombre, y después el valor', o.focoNumero === 'name' && o.focoTrasNombre === 'newval', [o.focoNumero, o.focoTrasNombre]],
  ['un campo no puede llamarse id', o.reservado === true, o.reservado],
  ['cada campo queda en su renglón, con el ícono de su tipo', J(o.filas) === J(['vence:date:true', 'responsable:person:true', 'prioridad:priority:true', 'etiquetas:tags:true', 'enlace:link:true', 'Puntos-de-esfuerzo:number:true', 'Nota:text:true', 'Etapa:select:true']), o.filas],
  ['los predefinidos que la tarjeta ya tiene no se ofrecen de nuevo', J(o.sinPredefinidos) === J(['number', 'text', 'select']), o.sinPredefinidos],
  ['agregar campos de cada tipo sin escribir sintaxis, y guardar con Ctrl+Enter', /^- \[ \] Diseñar la tapa \{vence=2026-10-20 responsable="Ana Paz, Lia" prioridad=alta etiquetas=bug,idea enlace=https:\/\/ejemplo\.com\/docs Puntos-de-esfuerzo=3 Nota="Ver con Ana" Etapa=borrador id=[a-z2-9]{8} created=\S+ updated=\S+\}$/.test(o.conAtributos), o.conAtributos],
  ['el tablero anota qué campos se ven y de qué tipo son', o.config === '{show=vence,responsable,prioridad,etiquetas,enlace,Puntos-de-esfuerzo,Nota,Etapa vence=date prioridad=baja|media|alta Puntos-de-esfuerzo=number Etapa=idea|borrador|final}', o.config],
  ['la tarjeta muestra los campos elegidos: fecha corta, iniciales, punto de prioridad, pastillas y un ícono de enlace', J(o.chips) === J(['vence=20 oct', 'responsable=AP/Responsable: Ana Paz+L/Responsable: Lia', 'prioridad=alta|punto', 'etiquetas=bug|pastilla', 'etiquetas=idea|pastilla', 'enlace=https://ejemplo.com/docs|_blank|noopener noreferrer|true', 'Puntos-de-esfuerzo=3', 'Nota=Ver con Ana', 'Etapa=borrador']), o.chips],
  ['cada etiqueta tiene un color de la paleta', o.colores.t.length === 2 && o.colores.t.every((c) => ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].includes(c)), o.colores],
  ['el enlace de la tarjeta no abre el detalle', o.enlaceNoAbre === true, o.enlaceNoAbre],
  ['los campos que ya usa el tablero se sugieren primero', o.usar.titulo === 'Usar un campo de este tablero' && J(o.usar.campos) === J(['Vence', 'Responsable', 'Prioridad', 'Etiquetas', 'Enlace', 'Puntos de esfuerzo', 'Nota', 'Etapa']) && J(o.usar.nuevos) === J(['number', 'text', 'select']), o.usar],
  ['y al asignar se sugieren las personas ya usadas', J(o.sugeridas) === J(['Ana Paz', 'Lia']), o.sugeridas],
  ['una fecha pasada se ve vencida', o.vencida === 'lmd-chip lmd-chip-date lmd-chip-late|Vence · Vencida', o.vencida],
  ['Enter sobre la tarjeta la abre, y el enlace se ve clicable, con su lápiz', o.enlace.href === 'https://ejemplo.com/docs' && o.enlace.texto === 'ejemplo.com/docs' && o.enlace.target === '_blank' && o.enlace.rel === 'noopener noreferrer' && o.enlace.lapiz && o.enlace.campo === true && o.enlaceEditado === 'https://ejemplo.com/guia', [o.enlace, o.enlaceEditado]],
  ['el color de una etiqueta se elige de la paleta, y una etiqueta se quita con su x', J(o.paleta) === J(['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']) && J(o.etiquetas) === J(['bug:blue']), [o.paleta, o.etiquetas]],
  ['quitar un campo deja deshacerlo', o.quitado.fila === false && o.quitado.aviso === 'Campo quitado: ResponsableDeshacer' && o.quitado.foco === 'undo' && J(o.deshecho.orden) === J(['vence', 'responsable', 'prioridad']) && J(o.deshecho.valor) === J(['APAna Paz', 'LLia']) && o.deshecho.aviso === true, [o.quitado, o.deshecho]],
  ['desde el detalle: pasar a la columna de hechas la tilda, y lo quitado no vuelve', /^- \[x\] Diseñar la tapa \{vence=2026-10-20 responsable="Ana Paz, Lia" prioridad=alta etiquetas=bug enlace=https:\/\/ejemplo\.com\/guia Puntos-de-esfuerzo=3 Etapa=borrador id=/.test(o.movida) && o.movidaCol === 'Hecho' && o.movida.match(/id=(\w+)/)[1] === o.conAtributos.match(/id=(\w+)/)[1], [o.movida, o.movidaCol]],
  ['el color elegido y lo que se ve quedan en la configuración', o.configDespues === '{show=vence,responsable,prioridad,etiquetas,enlace,Puntos-de-esfuerzo,Nota vence=date prioridad=baja|media|alta Puntos-de-esfuerzo=number Etapa=idea|borrador|final tags=bug:blue}', o.configDespues],
  ['al guardar, el foco vuelve a la tarjeta', o.focoVuelve === true, o.focoVuelve],
  ['Escape con cambios sin guardar avisa una sola vez, y se puede seguir editando', o.aviso.uno === 1 && o.aviso.texto === 'Hay cambios sin guardar' && J(o.aviso.botones) === J(['Seguir editando', 'Descartarlos']) && o.sigue === true, [o.aviso, o.sigue]],
  ['descartar no cambia la nota', o.cancelar === true],
  ['eliminar vive en el detalle y pregunta antes', o.eliminarPregunta === '¿Eliminar la tarjeta "Publicar"?' && o.eliminarNo === true && o.eliminada === true, [o.eliminarPregunta, o.eliminarNo, o.eliminada]],
  ['el menú de la columna: cambiar el nombre, marcarla como la de hechas, eliminarla', J(o.menuCol) === J(['Cambiar el nombre', 'Marcar como columna de hechas', 'Eliminar la columna']) && o.menuColHecha === 'Quitar como columna de hechas' && o.aComun.startsWith('- [ ] Planear '),[o.menuCol, o.menuColHecha, o.aComun]],
  ['marcar una columna como la de hechas lo anota en el tablero y tilda sus tarjetas', / done="Columna 3"/.test(o.marcada.cfg) && o.marcada.linea === '- [x] Planear' && J(o.marcada.col) === J([false, false, true]), o.marcada],
  ['las tarjetas tildadas en una columna común se respetan, atenuadas', o.marcada.vieja === '- [x] Probar' && o.marcada.viejaOpaca === true, o.marcada],
  ['quitarle la marca deja el tablero sin columna de hechas y las destilda', / done=""/.test(o.desmarcada.cfg) && o.desmarcada.linea === '- [ ] Planear' && o.desmarcada.col === 0, o.desmarcada],
  ['y se puede volver a marcar otra', / done=Hecho /.test(o.remarcada), o.remarcada],
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
