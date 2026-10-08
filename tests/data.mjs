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
  const g = await dir.getFileHandle('guia.md', { create: true }); const gs = await g.createWritable(); await gs.write('# Guía\n\nLa otra nota.\n'); await gs.close();
  const pg = await dir.getFileHandle('pagina.md', { create: true }); const ps = await pg.createWritable();
  await ps.write('# Página\n\n[toc]\n\n' + 'Un renglón largo para llenar el ancho de la página. '.repeat(12) + '\n\n## Uno\n\nTexto.\n\n### Sub\n\n## 4. Tienda de Chrome\n\n### Detalle\n\n### 4.5 Propio\n\n### Sigue\n\n## Otra\n\n## IV) Romano\n\n## Sin número\n'); await ps.close();
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
  const t = P.write('# Hola\n', 'toc', 'no');
  return { a, b, c, d, read: P.read(b), toc: t, tocRead: P.read(t).toc, tocBack: P.write(t, 'toc', 'yes'), tocWords: ['false', 'off', 'true', 'quizas'].map((w) => P.read('---\ntoc: ' + w + '\n---\n').toc).join(), malo: P.read('---\nwidth: 9000px\nnumbered: quizas\ntoc: nunca\nfont: evil\n---\n'), noToca: P.write('# Hola\n', 'width', 'url(x)') === '# Hola\n' && P.write('# Hola\n', 'css', 'x') === '# Hola\n' };
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
// "Mostrar el índice" ya no está en esa ventana: el índice lateral se muestra u oculta con su propio botón.
// (esta nota no tiene secciones: para ver si el árbol se oculta se pone uno de prueba en el panel y se lo saca)
const arbol = () => app.evaluate(() => { const pane = document.querySelector('.lmd-pane-outline'); const had = pane.querySelector('.lmd-o-tree'); const t = had || pane.appendChild(Object.assign(document.createElement('div'), { className: 'lmd-o-tree' })); const on = getComputedStyle(t).display !== 'none'; if (!had) t.remove(); return on; });
await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg');
o.sinToc = await app.evaluate(() => ({ casilla: !!document.querySelector('.lmd-pg [data-pg=toc]'), texto: document.querySelector('.lmd-pg').textContent, casillas: document.querySelectorAll('.lmd-pg input[type=checkbox]').length }));
await app.click('.lmd-pg [data-pg=ok]');
// Una nota que ya traía toc: false de antes: no se aplica, no se lista entre sus datos y no se reescribe.
await app.click('[data-act=mode-edit]'); await app.click('[data-act=view-raw]'); await app.waitForSelector('.lmd-raw-edit:not([hidden])');
await app.evaluate(() => { const t = document.querySelector('.lmd-raw-edit'); t.focus(); t.value = t.value.replace('numbered: true', 'numbered: true\ntoc: false'); t.dispatchEvent(new Event('input', { bubbles: true })); });
await app.waitForTimeout(400); await app.click('[data-act=view-doc]'); await app.click('[data-act=mode-read]'); await app.waitForTimeout(700);
o.tocViejo = { clase: await app.evaluate(() => document.documentElement.classList.contains('lmd-page-notoc')), arbol: await arbol(), front: await app.evaluate(() => !!document.querySelector('.lmd-front')), fuente: (await src()).split('\n').slice(0, 4) };
await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg'); await app.click('.lmd-pg [data-pg-width=wide]'); await app.click('.lmd-pg [data-pg-width=normal]'); await app.click('.lmd-pg [data-pg=ok]'); await app.waitForTimeout(400);
o.tocViejo.despues = (await src()).split('\n').slice(0, 4);

// listas de tareas: contador, renglón de agregar con Enter encadenado, reordenar y quitar los hechos
const lista = async () => { const l = (await src()).split('\n'); return l.slice(0, l.indexOf('```kanban')).filter((x) => /^[-*+] \[/.test(x)); };
const clBar = () => app.evaluate(() => ({ cuenta: (document.querySelector('.lmd-cl-bar .lmd-cl-count') || {}).textContent || '', acciones: [...document.querySelectorAll('.lmd-cl-bar button')].map((b) => b.textContent), agregar: (document.querySelector('.lmd-cl-add') || {}).textContent, manijas: document.querySelectorAll('.lmd-cl .lmd-cl-grip').length, otras: document.querySelectorAll('.lmd-cl-bar').length }));
o.cl0 = await clBar();
// leyendo, ni el renglón de agregar ni el menú están a la vista ni ocupan lugar: aparecen al pasar el mouse por la lista
const clVe = () => app.evaluate(() => { const add = document.querySelector('.lmd-cl-add'); const more = document.querySelector('.lmd-cl-more'); const list = document.querySelector('ul.lmd-cl'); const bar = document.querySelector('.lmd-cl-bar');
  const next = add.nextElementSibling; return { agregar: getComputedStyle(add).visibility, menu: getComputedStyle(more).visibility, barra: Math.round(bar.getBoundingClientRect().height), hueco: Math.round(next.getBoundingClientRect().top - list.getBoundingClientRect().bottom), em: Math.round(parseFloat(getComputedStyle(list).fontSize)), leyendo: !document.documentElement.classList.contains('lmd-editing') }; });
await app.mouse.move(5, 5); await app.waitForTimeout(600);
o.clQuieto = await clVe();
await app.hover('ul.lmd-cl'); await app.waitForTimeout(250);
o.clEncima = await clVe();
await app.click('.lmd-cl-add'); await app.waitForSelector('.lmd-draft-li .lmd-draft');
o.clAbre = await app.evaluate(() => ({ editando: document.documentElement.classList.contains('lmd-editing'), foco: document.activeElement.classList.contains('lmd-draft'), casilla: !!document.querySelector('.lmd-draft-li input.lmd-task') }));
await app.keyboard.type('Leche'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-draft-li .lmd-draft');
await app.keyboard.type('Huevos'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-draft-li .lmd-draft');
o.clSigue = await app.evaluate(() => document.activeElement.classList.contains('lmd-draft') && !!document.activeElement.closest('.lmd-draft-li'));
await app.keyboard.press('Enter'); await app.waitForTimeout(300);
o.clTermina = await app.evaluate(() => !document.querySelector('.lmd-draft-li'));
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600);
o.cl1 = await lista();
// Backspace en un elemento vacío lo borra y sube
await app.click('.lmd-cl-add'); await app.waitForSelector('.lmd-draft-li .lmd-draft'); await app.keyboard.type('x'); await app.keyboard.press('Backspace'); await app.keyboard.press('Backspace'); await app.waitForTimeout(200);
o.clBorra = await app.evaluate(() => ({ borrador: !!document.querySelector('.lmd-draft-li'), foco: (document.activeElement.textContent || '').trim() }));
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600);
o.cl2 = [await lista(), await clBar()];
// editando están siempre a la vista, sin pasar el mouse
await app.click('[data-act=mode-edit]').catch(() => {}); await app.mouse.move(5, 5); await app.waitForTimeout(600);
o.clEditando = await app.evaluate(() => ({ agregar: getComputedStyle(document.querySelector('.lmd-cl-add')).visibility, menu: getComputedStyle(document.querySelector('.lmd-cl-more')).visibility, editando: document.documentElement.classList.contains('lmd-editing') }));
// tildar pone al día el contador, y los hechos se pueden pasar abajo
await app.locator('.lmd-cl li.lmd-task-item', { hasText: 'Leche' }).locator('input.lmd-task').check(); await app.waitForTimeout(300);
o.clTilde = (await clBar()).cuenta;
await app.locator('.lmd-cl li.lmd-task-item', { hasText: 'Pagar la luz' }).locator('input.lmd-task').uncheck(); await app.waitForTimeout(300);
o.clSinMover = await app.evaluate(() => !document.querySelector('.lmd-cl-bar [data-cl=sink]'));
await app.click('.lmd-cl-bar .lmd-cl-more'); await app.click('.lmd-cl-menu [data-cl=sink]'); await app.waitForTimeout(400);
o.clAbajo = [await lista(), (await clBar()).acciones];
// reordenar: con las flechas sobre la manija, y arrastrándola
await app.locator('.lmd-cl li.lmd-task-item', { hasText: 'Huevos' }).locator('.lmd-cl-grip').focus(); await app.keyboard.press('ArrowUp'); await app.waitForTimeout(300);
o.clFlecha = [await lista(), await app.evaluate(() => document.activeElement.classList.contains('lmd-cl-grip') && /Huevos/.test(document.activeElement.closest('li').textContent))];
const gripBox = await app.locator('.lmd-cl li.lmd-task-item', { hasText: 'Leche' }).locator('.lmd-cl-grip').boundingBox(); const firstBox = await app.locator('.lmd-cl li.lmd-task-item').first().boundingBox();
await app.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2); await app.mouse.down(); await app.mouse.move(gripBox.x + 4, gripBox.y - 20, { steps: 4 }); await app.mouse.move(firstBox.x + 10, firstBox.y + 2, { steps: 6 });
o.clMarca = await app.evaluate(() => !!document.querySelector('.lmd-cl li.lmd-cl-before') && !!document.querySelector('.lmd-cl li.lmd-cl-moving'));
await app.mouse.up(); await app.waitForTimeout(400);
o.clArrastre = await lista();
// ocultar las hechas: cambia la vista y nada más; el archivo queda igual, se recuerda al redibujar, y lo copiado va entero
const clVista = () => app.evaluate(() => { const bar = document.querySelector('.lmd-cl-bar'); const b = bar.querySelector('[data-cl=hide]');
  return { cuenta: bar.querySelector('.lmd-cl-count').textContent, boton: b.textContent, apretado: b.getAttribute('aria-pressed'), visibles: [...document.querySelectorAll('ul.lmd-cl > li')].filter((li) => li.offsetParent).length, foco: document.activeElement === b }; });
const clAntes = await lista(); o.clVer0 = await clVista();
await app.click('.lmd-cl-bar [data-cl=hide]'); await app.waitForTimeout(250);
o.clVer1 = await clVista(); o.clVerArchivo = JSON.stringify(await lista()) === JSON.stringify(clAntes);
o.clVerCopia = await app.evaluate(() => (LMD.extras.htmlOf().match(/<li/g) || []).length >= 4);
await app.click('[data-act=mode-read]'); await app.waitForTimeout(400); await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
o.clVer2 = await clVista();
// una tarea oculta a la que lleva el buscador o un ancla se muestra
await app.evaluate(() => { const li = [...document.querySelectorAll('ul.lmd-cl > li')].find((x) => !x.offsetParent); LMD.write.reveal(li.querySelector('input').nextSibling || li); }); await app.waitForTimeout(250);
o.clVer3 = await clVista();
await app.click('.lmd-cl-bar [data-cl=hide]'); await app.waitForTimeout(200); await app.click('.lmd-cl-bar [data-cl=hide]'); await app.waitForTimeout(200);
o.clVer4 = await clVista();
// quitar los hechos: no está a la vista, va en el menú de la lista y pide confirmar; con deshacer
await app.evaluate(() => { window.__manual = true; });
o.clSinBoton = await app.evaluate(() => !document.querySelector('.lmd-cl-bar [data-cl=clear]') && !/Quitar/.test(document.querySelector('.lmd-cl-bar').textContent));
await app.click('.lmd-cl-bar .lmd-cl-more'); await app.waitForSelector('.lmd-cl-menu');
o.clMenu = await app.evaluate(() => { const m = document.querySelector('.lmd-cl-menu'); const b = document.querySelector('.lmd-cl-more');
  return { rol: m.getAttribute('role'), items: [...m.querySelectorAll('[role=menuitem]')].map((x) => x.textContent + (x.disabled ? ' (no)' : '')), abierto: b.getAttribute('aria-expanded'), nombre: b.getAttribute('aria-label'), foco: document.activeElement.dataset.cl }; });
await app.click('.lmd-cl-menu [data-cl=clear]'); await app.waitForSelector('.lmd-dlg');
o.clPregunta = await app.evaluate(() => { const d = document.querySelector('.lmd-dlg'); return [d.querySelector('h3').textContent, d.querySelector('p').textContent, d.querySelector('[data-dlg=ok]').textContent, !document.querySelector('.lmd-cl-menu')]; });
await app.click('.lmd-dlg [data-dlg=no]'); await app.waitForSelector('.lmd-dlg', { state: 'detached' }); await app.waitForTimeout(300);
o.clCancela = [await lista(), await app.evaluate(() => !document.querySelector('.lmd-cl-toast'))];
// el menú con el teclado: Enter lo abre, las flechas lo recorren, Escape lo cierra y devuelve el foco
await app.focus('.lmd-cl-bar .lmd-cl-more'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-cl-menu');
const clFoco = () => app.evaluate(() => (document.activeElement.dataset || {}).cl || document.activeElement.className);
o.clTeclas = [await clFoco()]; await app.keyboard.press('ArrowDown'); o.clTeclas.push(await clFoco()); await app.keyboard.press('ArrowDown'); o.clTeclas.push(await clFoco());
await app.keyboard.press('Escape'); await app.waitForTimeout(150);
o.clTeclas.push(await app.evaluate(() => !document.querySelector('.lmd-cl-menu') && document.activeElement.classList.contains('lmd-cl-more') && document.activeElement.getAttribute('aria-expanded') === 'false'));
await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-cl-menu'); await app.keyboard.press('ArrowUp'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-dlg');
await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-cl-toast');
o.clQuita = [await lista(), await app.evaluate(() => document.querySelector('.lmd-cl-toast').textContent), (await clBar()).cuenta];
await app.click('.lmd-cl-toast button'); await app.waitForTimeout(400);
o.clDeshace = [await lista(), await app.evaluate(() => !document.querySelector('.lmd-cl-toast'))];
// Ctrl+Z también leyendo: se quitan los hechos sin entrar a editar, y el teclado los devuelve; Ctrl+Y los vuelve a quitar
await app.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await app.waitForTimeout(500);
if (await app.evaluate(() => document.body.classList.contains('lmd-editing') || !!document.querySelector('.lmd-editing'))) { await app.click('[data-act=mode-read]'); await app.waitForTimeout(400); }
o.clLeyendo = await app.evaluate(() => !document.querySelector('.lmd-editing'));
await app.hover('ul.lmd-cl'); await app.waitForTimeout(200);
await app.click('.lmd-cl-bar .lmd-cl-more'); await app.click('.lmd-cl-menu [data-cl=clear]'); await app.waitForSelector('.lmd-dlg'); await app.click('.lmd-dlg [data-dlg=ok]'); await app.waitForSelector('.lmd-cl-toast');
o.clLeeQuita = await lista();
await app.keyboard.press('Control+z'); await app.waitForTimeout(400);
o.clLeeDeshace = [await lista(), await app.evaluate(() => !document.querySelector('.lmd-editing'))];
await app.keyboard.press('Control+y'); await app.waitForTimeout(400); o.clLeeRehace = await lista();
await app.keyboard.press('Control+Shift+z'); await app.waitForTimeout(300); await app.keyboard.press('Control+z'); await app.waitForTimeout(400); o.clLeeVuelve = await lista();
// en un campo de texto Ctrl+Z es el del campo: la nota no se toca
await app.evaluate(() => { const i = document.createElement('input'); i.id = 'clz'; document.body.appendChild(i); i.focus(); });
await app.keyboard.type('ab'); await app.keyboard.press('Control+z'); await app.waitForTimeout(300);
o.clCampo = await lista(); await app.evaluate(() => document.getElementById('clz').remove());
await app.evaluate(() => { window.__manual = false; const t = document.querySelector('.lmd-cl-toast'); if (t) t.remove(); });
// el tablero es otra cosa: solo la lista de tareas suelta gana el renglón de agregar
o.clSolo = await app.evaluate(() => document.querySelectorAll('.lmd-cl-add').length);

// campo Enlace de una tarjeta hacia otra nota: se elige con el selector de enlaces, queda la ruta relativa y abre dentro de la app
await app.evaluate(() => { const b = document.querySelector('[data-act=mode-read]'); if (b) b.click(); }); await app.waitForTimeout(300);
await app.locator('.lmd-card', { hasText: 'Planear' }).first().click(); await app.waitForSelector('.lmd-cd');
await app.click('.lmd-cd [data-cd=add-open]'); await app.locator('.lmd-cd [data-cd-use=enlace], .lmd-cd [data-cd-type=link]').first().click(); await app.waitForSelector('.lmd-cd .lmd-cd-new [data-cd-note]');
o.notaBoton = (await app.textContent('.lmd-cd .lmd-cd-new [data-cd-note]')).trim();
await app.click('.lmd-cd .lmd-cd-new [data-cd-note]'); await app.waitForSelector('.lmd-lk .lmd-lk-row');
o.notaSelector = await app.evaluate(() => ({ tabs: [...document.querySelectorAll('.lmd-lk .lmd-seg button')].map((b) => b.dataset.val), filas: [...document.querySelectorAll('.lmd-lk .lmd-lk-row')].map((r) => r.textContent.trim()), tarjeta: !!document.querySelector('.lmd-cd') }));
await app.locator('.lmd-lk .lmd-lk-row', { hasText: 'guia' }).first().click(); await app.waitForSelector('.lmd-lk', { state: 'detached' });
o.notaValor = await app.inputValue('.lmd-cd [data-cd=newval]');
await app.click('.lmd-cd [data-cd=add]'); await app.waitForSelector('.lmd-cd-attr[data-key=enlace] a');
o.notaDetalle = await app.evaluate(() => { const a = document.querySelector('.lmd-cd-attr[data-key=enlace] a'); return { rel: a.getAttribute('data-lmd-href'), texto: a.textContent, target: a.target, lapiz: !!document.querySelector('.lmd-cd-attr[data-key=enlace] [data-cd-edit]') }; });
await app.click('.lmd-cd [data-cd=ok]'); await saved();
o.notaLinea = await cardLine('Planear');
o.notaChip = await app.evaluate(() => { const c = [...document.querySelectorAll('.lmd-card')].find((x) => /Planear/.test(x.textContent)); const a = c.querySelector('a.lmd-chip-link'); return a ? { rel: a.getAttribute('data-lmd-href'), target: a.target, titulo: a.title, app: a.href.includes('?f=') } : null; });
await app.evaluate(() => { window.__sigue = 1; });
await app.locator('.lmd-card', { hasText: 'Planear' }).first().locator('a.lmd-chip-link').click();
await app.waitForFunction(() => /La otra nota/.test((document.querySelector('.lmd-article') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
o.notaAbre = await app.evaluate(() => ({ titulo: (document.querySelector('.lmd-article h1') || {}).textContent || '', sinRecargar: window.__sigue === 1, detalle: !!document.querySelector('.lmd-cd') }));

// ---------- Ajustes de la página en una nota con títulos (pagina.md) ----------
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
await app.evaluate(() => { const n = [...document.querySelectorAll('.lmd-node')].find((x) => /pagina/.test(x.textContent)); n.click(); });
await app.waitForFunction(() => /Tienda de Chrome/.test((document.querySelector('.lmd-article') || {}).innerText || ''), null, { timeout: 8000 });
if (await app.evaluate(() => document.documentElement.classList.contains('lmd-editing'))) { await app.click('[data-act=mode-read]'); await app.waitForTimeout(400); }
const anchoDe = () => app.evaluate(() => Math.round(document.querySelector('.lmd-article').getBoundingClientRect().width));
// Elige un ancho en la ventana y mide el artículo ahí mismo, con la ventana todavía abierta.
const pone = async (w) => { await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg'); await app.click('.lmd-pg [data-pg-width=' + w + ']'); const now = await anchoDe(); await app.click('.lmd-pg [data-pg=ok]'); await app.waitForTimeout(150); return now; };
const tres = async () => [await pone('normal'), await pone('wide'), await pone('full')];
const lateral = (on) => app.evaluate((want) => { const r = document.documentElement; if (r.classList.contains('lmd-side-hidden') === want) document.querySelector('[data-act=sidebar]').click(); }, on);
o.anchos = {};
for (const w of [1500, 1280]) {
  await app.setViewportSize({ width: w, height: 950 }); await lateral(true); await app.waitForTimeout(350);
  o.anchos['abierto' + w] = await tres();
  await lateral(false); await app.waitForTimeout(350);
  o.anchos['cerrado' + w] = await tres();
}
await app.setViewportSize({ width: 1500, height: 950 }); await lateral(true); await app.waitForTimeout(300);
await pone('wide'); await app.waitForTimeout(300);
o.anchoGuardado = { fuente: (await src()).split('\n').slice(0, 3), clase: await app.evaluate(() => document.documentElement.classList.contains('lmd-pw-wide')) };
await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
o.anchoGuardado.disco = (await app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('datos'); return (await (await dir.getFileHandle('pagina.md')).getFile()).text(); })).split(/\r?\n/).slice(0, 3);
await pone('normal');
// títulos numerados: los que ya traen su número lo conservan, y los demás siguen la cuenta
await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg'); await app.check('.lmd-pg [data-pg=numbered]'); await app.click('.lmd-pg [data-pg=ok]'); await app.waitForTimeout(400);
const titulos = () => app.evaluate(() => { const txt = (n) => { const c = n.cloneNode(true); c.querySelectorAll('.lmd-anchor').forEach((a) => a.remove()); return c.textContent; };
  return { doc: [...document.querySelectorAll('.lmd-article > h2, .lmd-article > h3')].map(txt), indice: [...document.querySelectorAll('.lmd-pane-outline .lmd-o-link')].map(txt), toc: [...document.querySelectorAll('.lmd-article .lmd-toc a')].map(txt).slice(1),
    css: getComputedStyle(document.querySelector('.lmd-article > h2'), '::before').content, spans: document.querySelectorAll('.lmd-article .lmd-hnum').length }; });
o.numeros = await titulos();
o.numerosFuente = (await src()).split('\n').filter((l) => /^#{2,3} /.test(l));
// copiar: lo elegido con Ctrl+C y las tres acciones de la barra llevan los números que se ven
const clip = async () => (await app.evaluate(() => navigator.clipboard.readText())).replace(/\r/g, '');
await app.evaluate(() => { const hs = [...document.querySelectorAll('.lmd-article > h2')]; const a = hs.find((h) => /Otra/.test(h.textContent)); const r = document.createRange(); r.setStartBefore(a.firstChild); r.setEndAfter(hs[hs.length - 1].lastChild); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await app.keyboard.press('Control+c'); await app.waitForTimeout(200);
o.copia = { seleccion: await clip() };
await app.evaluate(() => getSelection().removeAllRanges());
const copiar = async (what) => { await app.click('[data-act=copy]'); await app.waitForSelector('.lmd-menu-copy'); await app.click('.lmd-menu-copy [data-more=' + what + ']'); await app.waitForTimeout(350); return clip(); };
o.copia.md = await copiar('copy-md'); o.copia.rico = await copiar('copy-rich'); o.copia.html = await copiar('copy-html');
o.copia.fuenteIgual = JSON.stringify((await src()).split('\n').filter((l) => /^#{2,3} /.test(l))) === JSON.stringify(o.numerosFuente);
// editando: el número no entra en lo que se guarda del título
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
await app.locator('.lmd-article > h2', { hasText: 'Otra' }).click(); await app.keyboard.press('End'); await app.keyboard.type(' más', { delay: 15 });
await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
o.editado = { fuente: (await src()).split('\n').filter((l) => /Otra/.test(l)), doc: (await titulos()).doc.filter((t) => /Otra/.test(t)), editable: await app.evaluate(() => [...document.querySelectorAll('.lmd-article > h2, .lmd-article > h3')].every((h) => h.classList.contains('lmd-editable'))) };
await app.click('[data-act=mode-read]'); await app.waitForTimeout(500);
// y si se pide, quedan escritos en la nota
await app.click('[data-act=page]'); await app.waitForSelector('.lmd-pg'); await app.click('.lmd-pg [data-pg=write]'); await app.click('.lmd-pg [data-pg=ok]'); await app.waitForTimeout(400);
o.escritos = { fuente: (await src()).split('\n').filter((l) => /^#{2,3} /.test(l)), doc: (await titulos()).doc, spans: (await titulos()).spans };

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
  ['un enlace solo acepta http, https u otra nota: javascript: no entra', o.enlaceMalo === true, o.enlaceMalo],
  ['el campo Enlace ofrece elegir una nota, con el selector de enlaces sobre la tarjeta (otro archivo o una dirección)', o.notaBoton === 'Elegir una nota' && J(o.notaSelector.tabs) === J(['file', 'web']) && o.notaSelector.filas.some((f) => /guia/.test(f)) && o.notaSelector.tarjeta, [o.notaBoton, o.notaSelector]],
  ['elegida, queda la ruta relativa como en un enlace Markdown, y se ve con el nombre de la nota', o.notaValor === 'guia.md' && o.notaDetalle.rel === 'guia.md' && o.notaDetalle.texto === 'guia' && o.notaDetalle.target === '' && o.notaDetalle.lapiz && /[{ ]enlace=guia\.md[ }]/.test(o.notaLinea), [o.notaValor, o.notaDetalle, o.notaLinea]],
  ['en la tarjeta el enlace a la nota no abre otra pestaña, y al tocarlo abre esa nota dentro de la app, sin recargar', !!o.notaChip && o.notaChip.rel === 'guia.md' && o.notaChip.target === '' && o.notaChip.titulo === 'guia' && o.notaChip.app && /^Guía/.test(o.notaAbre.titulo) && o.notaAbre.sinRecargar && !o.notaAbre.detalle, [o.notaChip, o.notaAbre]],
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
  ['ajustes de la página: se escriben en el encabezado con claves simples', o.pagina.a === '---\nwidth: wide\n---\n\n# Hola\n' && o.pagina.b === '---\nwidth: wide\nnumbered: true\n---\n\n# Hola\n' && o.pagina.c === '# Hola\n' && o.pagina.d === '---\ntitle: Plan\nwidth: full\n---\n\n# Hola\n' && J(o.pagina.read) === J({ width: 'wide', numbered: 'yes', toc: 'yes' }), o.pagina],
  ['toc sigue siendo una clave conocida de versiones anteriores: se lee y se escribe igual', o.pagina.toc === '---\ntoc: false\n---\n\n# Hola\n' && o.pagina.tocRead === 'no' && o.pagina.tocBack === '# Hola\n' && o.pagina.tocWords === 'no,no,yes,yes', o.pagina],
  ['"Mostrar el índice" ya no está entre los ajustes de la página', !o.sinToc.casilla && !/índice/i.test(o.sinToc.texto) && o.sinToc.casillas === 1, o.sinToc],
  ['una nota que ya traía toc: false se abre igual: el índice se ve, el renglón no se lista y no se reescribe', !o.tocViejo.clase && o.tocViejo.arbol && !o.tocViejo.front && o.tocViejo.fuente.includes('toc: false') && o.tocViejo.despues.includes('toc: false'), o.tocViejo],
  ['el ancho de la página cambia de verdad y en el momento: normal, ancha y completa miden distinto, con el panel abierto y cerrado', Object.values(o.anchos).every((a) => a[0] + 40 < a[1] && a[1] + 40 < a[2]), o.anchos],
  ['el ancho elegido queda en la nota, y en el archivo al guardar', o.anchoGuardado.clase && J(o.anchoGuardado.fuente) === J(['---', 'width: wide', '---']) && J(o.anchoGuardado.disco) === J(['---', 'width: wide', '---']), o.anchoGuardado],
  ['numerar los títulos respeta el número que ya traen: "4. Tienda de Chrome" no se duplica', J(o.numeros.doc) === J(['1. Uno', '1.1 Sub', '4. Tienda de Chrome', '4.1 Detalle', '4.5 Propio', '4.6 Sigue', '5. Otra', 'IV) Romano', 'V) Sin número']), o.numeros.doc],
  ['el índice lateral y el índice del texto muestran lo mismo que el documento', J(o.numeros.indice) === J(o.numeros.doc) && J(o.numeros.toc) === J(o.numeros.doc), [o.numeros.indice, o.numeros.toc]],
  ['el número es texto de verdad (no contenido de CSS) y no se escribe en el archivo', o.numeros.css === 'none' && o.numeros.spans >= 6 && J(o.numerosFuente) === J(['## Uno', '### Sub', '## 4. Tienda de Chrome', '### Detalle', '### 4.5 Propio', '### Sigue', '## Otra', '## IV) Romano', '## Sin número']), [o.numeros.css, o.numeros.spans, o.numerosFuente]],
  ['el número va en lo que se copia con Ctrl+C', /^5\. Otra#?\s+IV\) Romano#?\s+V\) Sin número#?\s*$/.test(o.copia.seleccion), o.copia.seleccion],
  ['y en las acciones de copiar: Markdown, texto con formato y HTML', /^## 1\. Uno$/m.test(o.copia.md) && /^### 4\.6 Sigue$/m.test(o.copia.md) && /^## 4\. Tienda de Chrome$/m.test(o.copia.md) && /^## V\) Sin número$/m.test(o.copia.md) && /5\. Otra/.test(o.copia.rico) && /4\.1 Detalle/.test(o.copia.rico) && /5\. <\/span>Otra/.test(o.copia.html) && !/4\. (<[^>]+>)*4\. /.test(o.copia.html + o.copia.md + o.copia.rico) && o.copia.fuenteIgual, [o.copia.md.slice(0, 400), o.copia.rico.slice(0, 200), o.copia.html.slice(0, 300), o.copia.fuenteIgual]],
  ['editando un título numerado, el número no entra en lo que se guarda', J(o.editado.fuente) === J(['## Otra más']) && J(o.editado.doc) === J(['5. Otra más']) && o.editado.editable, o.editado],
  ['"Escribir los números en la nota" los deja escritos, y no se duplican', J(o.escritos.fuente) === J(['## 1. Uno', '### 1.1 Sub', '## 4. Tienda de Chrome', '### 4.1 Detalle', '### 4.5 Propio', '### 4.6 Sigue', '## 5. Otra más', '## IV) Romano', '## V) Sin número']) && J(o.escritos.doc) === J(o.escritos.fuente.map((l) => l.replace(/^#+ /, ''))) && o.escritos.spans === 0, o.escritos],
  ['un valor que no está en la lista no hace nada', J(o.pagina.malo) === J({ width: 'normal', numbered: 'no', toc: 'yes' }) && o.pagina.noToca === true, o.pagina.malo],
  ['un tablero ancho se sale de la columna de texto sin salirse del área de la nota', o.ancho.sale && o.ancho.adentro && o.ancho.pagina, o.ancho],
  ['si aun así no entra, se desliza con una barra fina y el borde se desvanece', o.ancho.desliza && o.ancho.sombra && o.ancho.fina === 'thin', o.ancho],
  ['una línea ofrece la página ancha', /Este tablero es más ancho que la página\./.test(o.ancho.aviso), o.ancho.aviso],
  ['aceptarla escribe width: wide en la nota y no se lista entre sus datos', o.ancha.clase && !o.ancha.aviso && !o.ancha.front && o.ancha.get === 'wide' && J(o.anchaFuente) === J(['---', 'width: wide', '---', '']), [o.ancha, o.anchaFuente]],
  ['la ventana de ajustes de la página muestra el ancho de ahora', o.dialogoPagina.marcado === 'wide' && J(o.dialogoPagina.opciones) === J(['Normal', 'Ancha', 'Completa']), o.dialogoPagina],
  ['numerar los títulos, y el aviso no vuelve a salir en esa nota', o.numerada.clase && !o.numerada.otraVez && J(o.numeradaFuente) === J(['---', 'numbered: true', '---']), [o.numerada, o.numeradaFuente]],
  ['una lista de dos tareas no lleva contador, y tiene su renglón para agregar y una manija por elemento', o.cl0.cuenta === '' && J(o.cl0.acciones) === J(['']) && o.cl0.agregar === '+ Agregar elemento' && o.cl0.manijas === 2 && o.cl0.otras === 1, o.cl0],
  ['el renglón de agregar abre un elemento con casilla, listo para escribir', o.clAbre.editando && o.clAbre.foco && o.clAbre.casilla, o.clAbre],
  ['leyendo, agregar y el menú no se ven ni ocupan lugar, y aparecen al pasar el mouse por la lista', o.clQuieto.leyendo && o.clQuieto.agregar === 'hidden' && o.clQuieto.menu === 'hidden' && o.clQuieto.barra === 0 && Math.abs(o.clQuieto.hueco - o.clQuieto.em) <= 6 && o.clEncima.agregar === 'visible' && o.clEncima.menu === 'visible' && o.clEncima.hueco === o.clQuieto.hueco, [o.clQuieto, o.clEncima]],
  ['Enter agrega y deja el cursor en el siguiente; Enter en uno vacío termina', o.clSigue === true && o.clTermina === true && J(o.cl1) === J(['- [x] Comprar pan', '- [x] Pagar la luz', '- [ ] Leche', '- [ ] Huevos']), [o.clSigue, o.clTermina, o.cl1]],
  ['con tres tareas o más aparece el contador, y editando las acciones están a la vista sin pasar el mouse', o.cl2[1].cuenta === '2 de 4 hechas' && o.clEditando.editando === true, [o.cl2[1], o.clEditando]],
  ['Backspace en un elemento vacío lo borra y sube al anterior', o.clBorra.borrador === false && o.clBorra.foco === 'Huevos' && o.cl2[0].length === 4 && o.cl2[1].cuenta === '2 de 4 hechas' && o.clEditando.agregar === 'visible' && o.clEditando.menu === 'visible', [o.clBorra, o.cl2]],
  ['tildar pone al día el contador sin redibujar', o.clTilde === '3 de 4 hechas', o.clTilde],
  ['los hechos se pasan abajo desde el menú: en el renglón solo queda ocultar las hechas', J(o.cl2[1].acciones) === J(['Ocultar hechas', '']) && o.clSinMover === true && J(o.clAbajo[0]) === J(['- [ ] Pagar la luz', '- [ ] Huevos', '- [x] Comprar pan', '- [x] Leche']) && J(o.clAbajo[1]) === J(['Ocultar hechas', '']), [o.cl2[1], o.clAbajo]],
  ['con el foco en la manija, las flechas mueven el elemento y el foco lo sigue', J(o.clFlecha[0]) === J(['- [ ] Huevos', '- [ ] Pagar la luz', '- [x] Comprar pan', '- [x] Leche']) && o.clFlecha[1] === true, o.clFlecha],
  ['arrastrar la manija reordena, marcando dónde cae', o.clMarca === true && J(o.clArrastre) === J(['- [x] Leche', '- [ ] Huevos', '- [ ] Pagar la luz', '- [x] Comprar pan']), [o.clMarca, o.clArrastre]],
  ['quitar los hechos avisa cuántos fueron y deja deshacer', J(o.clQuita[0]) === J(['- [ ] Huevos', '- [ ] Pagar la luz']) && o.clQuita[1] === 'Hechos quitados: 2Deshacer' && o.clQuita[2] === '' && J(o.clDeshace[0]) === J(['- [x] Leche', '- [ ] Huevos', '- [ ] Pagar la luz', '- [x] Comprar pan']) && o.clDeshace[1] === true, [o.clQuita, o.clDeshace]],
  ['el contador dice qué cuenta, y Ocultar hechas las saca de la vista sin tocar el archivo ni lo que se copia', o.clVer0.cuenta === '2 de 4 hechas' && o.clVer0.boton === 'Ocultar hechas' && o.clVer0.apretado === 'false' && o.clVer0.visibles === 4 && o.clVer1.cuenta === 'Quedan 2 · 2 ocultas' && o.clVer1.boton === 'Mostrar hechas' && o.clVer1.apretado === 'true' && o.clVer1.visibles === 2 && o.clVer1.foco && o.clVerArchivo === true && o.clVerCopia === true, [o.clVer0, o.clVer1, o.clVerArchivo, o.clVerCopia]],
  ['lo oculto se recuerda al redibujar la nota, una tarea oculta a la que se llega se muestra, y el mismo control las devuelve', o.clVer2.visibles === 2 && o.clVer2.apretado === 'true' && o.clVer3.visibles === 4 && o.clVer3.apretado === 'false' && o.clVer4.visibles === 4 && o.clVer4.cuenta === '2 de 4 hechas', [o.clVer2, o.clVer3, o.clVer4]],
  ['quitar los hechos no está a la vista: va en el menú de la lista, con las dos acciones', o.clSinBoton === true && o.clMenu.rol === 'menu' && J(o.clMenu.items) === J(['Mover los hechos abajo', 'Quitar los hechos…']) && o.clMenu.abierto === 'true' && o.clMenu.nombre === 'Más acciones' && o.clMenu.foco === 'sink', [o.clSinBoton, o.clMenu]],
  ['antes de quitar pregunta cuántos son, y cancelar no toca la nota', J(o.clPregunta) === J(['¿Quitar 2 elementos hechos?', 'Se borran de la nota. Se puede deshacer.', 'Quitar', true]) && J(o.clCancela[0]) === J(['- [x] Leche', '- [ ] Huevos', '- [ ] Pagar la luz', '- [x] Comprar pan']) && o.clCancela[1] === true, [o.clPregunta, o.clCancela]],
  ['el menú de la lista se usa con el teclado: Enter abre, las flechas recorren y Escape devuelve el foco', J(o.clTeclas) === J(['sink', 'clear', 'sink', true]), o.clTeclas],
  ['Ctrl+Z deshace también leyendo, y Ctrl+Y y Ctrl+Shift+Z rehacen', o.clLeyendo === true && J(o.clLeeQuita) === J(['- [ ] Huevos', '- [ ] Pagar la luz']) && J(o.clLeeDeshace[0]) === J(['- [x] Leche', '- [ ] Huevos', '- [ ] Pagar la luz', '- [x] Comprar pan']) && o.clLeeDeshace[1] === true && J(o.clLeeRehace) === J(o.clLeeQuita) && J(o.clLeeVuelve) === J(o.clLeeDeshace[0]), [o.clLeyendo, o.clLeeQuita, o.clLeeDeshace, o.clLeeRehace, o.clLeeVuelve]],
  ['en un campo de texto Ctrl+Z es el del campo y la nota no cambia', J(o.clCampo) === J(o.clLeeVuelve), o.clCampo],
  ['los tableros no ganan renglón de agregar: solo las listas de tareas sueltas', o.clSolo === 1, o.clSolo],
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
