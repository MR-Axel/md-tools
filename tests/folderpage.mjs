// La página de una carpeta. Una carpeta también se abre: tiene su dirección (app.html?f=<raíz>/<ruta>/) y muestra
// su nombre, el camino hasta ella, su descripción (el README.md de adentro) y el índice de lo que tiene.
// Se prueba en cada raíz: la nube (servidor local), una carpeta del disco (OPFS, con el selector reemplazado), las
// notas de este navegador, la guía y una carpeta compartida por enlace o como plantilla. Abrir por clic, por
// dirección y con atrás y adelante; las migas; el README como descripción, agregarla y editarla; una carpeta vacía;
// 500 notas sin trabarse (se mide); el triángulo no abre la página; el teléfono; las acciones de cada raíz, y lo que
// solo se lee. Capturas en C:\tmp\agcarpeta\ (o SHOTS).
// Uso: node folderpage.mjs
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { rig, tally, sleep } from './rig.mjs';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(60); } };
const SHOTS = process.env.SHOTS || 'C:\\tmp\\agcarpeta';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* sin carpeta de capturas, se sigue */ }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { /* una captura que falla no frena la prueba */ } };
const noShout = (s) => !/[!¡—]/.test(s);
const VB = 'https://lmd.local/';

const FREE = 6;
const R = await rig({ FREE_NOTES: String(FREE), ALLOW_ORIGINS: '*' });
const CLOUD = {
  'Proyecto/README.md': '# Proyecto\n\nLa descripción del **proyecto**. Mirá [el plan](plan.md).\n\n- [ ] Una tarea\n',
  'Proyecto/plan.md': '# El plan maestro\n\nPaso a paso.\n',
  'Proyecto/sub/uno.md': '# Uno\n', 'Proyecto/sub/dos.md': '# Dos\n',
  'Suelta/nota.md': '# Nota suelta\n', 'raiz.md': '# En la raíz\n',
};

// Una carpeta del disco se prueba en un perfil de verdad, con la app servida por el mismo sitio: en el contexto de paso
// del rig, guardar el permiso de una carpeta (aunque sea de OPFS) cierra el navegador. Con who, ya con su sesión.
const profiles = [];
const persistent = async (who, init) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-fp-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', serviceWorkers: 'block' });
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => { R.outside.push(r.request().url()); return r.abort(); });
  await ctx.addInitScript(([url, w]) => {
    try {
      if (localStorage.getItem('mdtools:settings')) return;
      localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: url }));
      if (w) localStorage.setItem('mdtools:cloud', JSON.stringify({ session: w.s, email: w.email, at: url }));
    } catch (e) { /* una página en blanco no tiene almacenamiento */ }
  }, [R.base, who || null]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
  profiles.push({ ctx, dir });
  return { ctx, page };
};

// Lo que hay a la vista: la dirección, la página de carpeta y lo que marca el explorador.
const st = (page) => page.evaluate(() => {
  const fp = document.querySelector('.lmd-article .lmd-fp'); const q = (s) => (fp ? fp.querySelector(s) : null);
  return {
    f: new URLSearchParams(location.search).get('f') || '', title: document.title, docname: document.querySelector('.lmd-docname').textContent,
    dir: document.documentElement.classList.contains('lmd-dir'), editing: document.documentElement.classList.contains('lmd-editing'),
    h1: q('.lmd-fp-title') ? q('.lmd-fp-title').textContent.trim() : '', h1s: fp ? fp.querySelectorAll('h1').length : 0,
    crumbs: fp ? [...fp.querySelectorAll('.lmd-fp-crumbs a')].map((a) => a.textContent) : [],
    sum: q('.lmd-fp-sum') ? q('.lmd-fp-sum').textContent : '',
    desc: q('.lmd-fp-md') ? q('.lmd-fp-md').textContent.trim() : null,
    rows: fp ? [...fp.querySelectorAll('.lmd-fp-row')].map((a) => (a.classList.contains('lmd-fp-dir') ? 'd' : 'f') + ':' + a.querySelector('.lmd-fp-rname').textContent + (a.querySelector('.lmd-fp-rtag') ? ':' + a.querySelector('.lmd-fp-rtag').textContent : '')) : [],
    metas: fp ? [...fp.querySelectorAll('.lmd-fp-row')].map((a) => a.querySelector('.lmd-fp-rmeta').textContent) : [],
    acts: fp ? [...fp.querySelectorAll('[data-fp]')].filter((b) => b.offsetParent).map((b) => b.dataset.fp) : [],
    empty: q('.lmd-fp-empty p') ? q('.lmd-fp-empty p').textContent : '',
    active: [...document.querySelectorAll('.lmd-tree-box .lmd-active')].map((n) => (n.querySelector('.lmd-node-name, .lmd-tree-path') || n).textContent),
    open: [...document.querySelectorAll('.lmd-tree-box .lmd-node-dir.lmd-open')].map((n) => n.querySelector('.lmd-node-name').textContent),
    done: !!fp && fp.dataset.done === '1', url: fp ? fp.dataset.url : '', text: fp ? fp.innerText : '',
    tpl: !!document.querySelector('.lmd-tplbar') && !!document.querySelector('.lmd-tplbar').offsetParent, pub: document.documentElement.classList.contains('lmd-public'),
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
// Espera a que la página de esa carpeta esté dibujada entera.
const at = (page, f, ms) => until(async () => { const s = await st(page); return s.f === f && s.dir && s.done && s.url === VB + f ? s : null; }, ms || 10000);
const dirNode = (f) => '.lmd-tree-box .lmd-node-dir[data-url="' + VB + f + '"]';
const fileNode = (f) => '.lmd-tree-box a.lmd-node[data-url="' + VB + f + '"]';
const rowSel = (name) => '.lmd-fp-row:has(.lmd-fp-rname:text-is("' + name + '"))';
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-menu [role=menuitem]')].map((b) => b.textContent.trim()));
const closeMenu = async (page) => { await page.keyboard.press('Escape'); await sleep(80); };
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const setTheme = async (page, theme) => { await page.evaluate((t) => LMD.patch({ theme: t }), theme); await sleep(350); };

let bad = 1;
try {
  const api = R.api;
  const duena = await R.signup('duena@example.test', true); const gratis = await R.signup('gratis@example.test');
  const put = (who, p, text) => api('PUT', '/notes/' + encodeURIComponent(p), { text }, who.s);
  const paths = async (who) => (await api('GET', '/notes', undefined, who.s)).json.map((n) => n.path).sort();
  const textOf = async (who, p) => ((await api('GET', '/notes/' + encodeURIComponent(p), undefined, who.s)).json || {}).text;
  for (const [p, t] of Object.entries(CLOUD)) await put(duena, p, t);
  for (let i = 1; i <= FREE; i++) await put(gratis, 'Llena/n' + i + '.md', '# N' + i + '\n');

  // ---------- La nube ----------
  console.log('La nube: por clic');
  const a = await R.open(duena); const p = a.page;
  await p.goto(R.home); await p.waitForSelector(dirNode('cloud/Proyecto/'));
  await p.click(dirNode('cloud/Proyecto/') + ' .lmd-node-name');
  const c1 = await at(p, 'cloud/Proyecto/');
  check('tocar el nombre de una carpeta abre su página, con dirección propia', !!c1 && c1.title === 'Proyecto' && c1.docname === 'Proyecto' && c1.h1 === 'Proyecto', c1 || await st(p));
  check('y además la despliega y queda marcada como abierta en el explorador', !!c1 && c1.open.includes('Proyecto') && J(c1.active) === J(['Proyecto']), c1 && [c1.open, c1.active]);
  check('las migas llevan a las carpetas de arriba', !!c1 && J(c1.crumbs) === J(['Cloud']), c1 && c1.crumbs);
  check('el README de la carpeta se dibuja arriba como descripción, sin repetir el título', !!c1 && /^La descripción del proyecto\. Mirá el plan\./.test(c1.desc || '') && c1.h1s === 1 && await p.evaluate(() => !!document.querySelector('.lmd-fp-md strong') && !!document.querySelector('.lmd-fp-md input.lmd-task')), c1 && [c1.desc, c1.h1s]);
  check('el índice: primero la subcarpeta, después las notas, y el README marcado como descripción', !!c1 && J(c1.rows) === J(['d:sub', 'f:plan', 'f:README:Description']) && c1.sum === '1 folder · 2 notes', c1 && [c1.rows, c1.sum]);
  const m1 = await until(async () => { const s = await st(p); return s.metas[0] === '2 notes' ? s.metas : null; });
  check('cada subcarpeta dice cuántas notas tiene, y cada nota su fecha de cambio', !!m1 && m1.slice(1).every((m) => /\d/.test(m)), m1 || (await st(p)).metas);
  check('arriba a la derecha: copiar el enlace, compartir, exportar y el menú; y editar la descripción', !!c1 && J(c1.acts) === J(['link', 'share', 'export', 'more', 'edit']), c1 && c1.acts);
  check('sin signos de admiración ni rayas largas', !!c1 && noShout(c1.text), c1 && c1.text);
  await shot(p, '01-escritorio-oscuro-con-descripcion');

  console.log('El triángulo no abre la página');
  await p.click(dirNode('cloud/Suelta/') + ' .lmd-node-chev');
  await p.waitForSelector(fileNode('cloud/Suelta/nota.md'));
  const c2 = await st(p);
  check('el triángulo despliega la carpeta sin abrir nada', c2.f === 'cloud/Proyecto/' && c2.open.includes('Suelta') && J(c2.active) === J(['Proyecto']), [c2.f, c2.open, c2.active]);
  await p.click(dirNode('cloud/Suelta/') + ' .lmd-node-chev'); await sleep(150);
  check('y la vuelve a plegar', !(await st(p)).open.includes('Suelta') && (await st(p)).f === 'cloud/Proyecto/');
  await p.focus(dirNode('cloud/Suelta/')); await p.keyboard.press('ArrowRight'); await p.waitForSelector(fileNode('cloud/Suelta/nota.md'));
  check('con el teclado, la flecha derecha también despliega sin abrir', (await st(p)).f === 'cloud/Proyecto/' && (await st(p)).open.includes('Suelta'));
  await p.keyboard.press('ArrowLeft'); await sleep(120);

  console.log('Adentro, atrás y adelante, recargar y otra pestaña');
  await p.click(rowSel('sub'));
  const c3 = await at(p, 'cloud/Proyecto/sub/');
  check('tocar una subcarpeta del índice abre su página', !!c3 && c3.h1 === 'sub' && J(c3.crumbs) === J(['Cloud', 'Proyecto']) && J(c3.rows) === J(['f:dos', 'f:uno']) && c3.desc === null, c3 || await st(p));
  check('sin README y con permiso para escribir, ofrece agregar una descripción', !!c3 && c3.acts.includes('describe') && !c3.acts.includes('edit'), c3 && c3.acts);
  await shot(p, '02-escritorio-oscuro-sin-descripcion');
  await p.click('.lmd-fp-crumbs a:text-is("Proyecto")');
  check('una miga lleva a la página de esa carpeta', !!(await at(p, 'cloud/Proyecto/')));
  await p.goBack();
  check('atrás vuelve a la subcarpeta', !!(await at(p, 'cloud/Proyecto/sub/')));
  await p.goBack(); await at(p, 'cloud/Proyecto/');
  await p.goForward();
  check('y adelante también', !!(await at(p, 'cloud/Proyecto/sub/')));
  await p.reload();
  const c4 = await at(p, 'cloud/Proyecto/sub/');
  check('recargar deja la misma carpeta', !!c4 && c4.h1 === 'sub' && J(c4.active) === J(['sub']), c4 || await st(p));
  const p2 = await a.ctx.newPage();
  await p2.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/'));
  const c5 = await at(p2, 'cloud/Proyecto/');
  check('pegar la dirección en otra pestaña abre la misma carpeta', !!c5 && c5.h1 === 'Proyecto' && J(c5.rows) === J(['d:sub', 'f:plan', 'f:README:Description']), c5 || await st(p2));
  await p2.goto(R.home + '?f=' + encodeURIComponent('cloud/No%20existe/'));
  const none = await until(() => p2.evaluate(() => { const h = document.querySelector('.lmd-home'); return h && !h.hidden && /was not found/.test(h.textContent) ? h.textContent : null; }));
  check('una carpeta que no existe lo dice en el inicio', !!none, await p2.evaluate(() => document.body.innerText.slice(0, 200)));
  await p2.close();

  console.log('Los enlaces y las notas del índice');
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/')); await at(p, 'cloud/Proyecto/');
  await p.click('.lmd-fp-md a');
  const n1 = await until(async () => { const s = await st(p); return s.f === 'cloud/Proyecto/plan.md' && !s.dir ? s : null; });
  check('un enlace de la descripción se resuelve contra la carpeta', !!n1 && await p.evaluate(() => document.querySelector('.lmd-article h1').textContent) === 'El plan maestro', n1 || await st(p));
  await p.goBack(); await at(p, 'cloud/Proyecto/');
  await p.click(rowSel('plan'));
  check('tocar una nota del índice la abre', !!(await until(async () => (await st(p)).f === 'cloud/Proyecto/plan.md' && !(await st(p)).dir)));
  await p.goBack(); await at(p, 'cloud/Proyecto/');
  await p.click('.lmd-fp-md input.lmd-task'); await sleep(250);
  check('la descripción no se edita desde la página: una tarea no se tilda', !(await p.evaluate(() => document.querySelector('.lmd-fp-md input.lmd-task').checked)) && (await textOf(duena, 'Proyecto/README.md')) === CLOUD['Proyecto/README.md']);

  console.log('La raíz también es una página');
  await p.click('.lmd-xroot[data-root=cloud] .lmd-root-tog .lmd-tree-path');
  const r1 = await at(p, 'cloud/');
  check('tocar "Nube" abre el índice de la nube, y queda marcada', !!r1 && r1.h1 === 'Cloud' && J(r1.rows) === J(['d:Proyecto', 'd:Suelta', 'f:raiz']) && !r1.crumbs.length && J(r1.active) === J(['Cloud']), r1 || await st(p));
  check('y sigue desplegada', await p.evaluate(() => !document.querySelector('.lmd-xroot[data-root=cloud]').classList.contains('lmd-shut')));
  await p.click('.lmd-xroot[data-root=cloud] .lmd-root-tog .lmd-node-chev'); await sleep(120);
  check('su triángulo la pliega sin cambiar de página', await p.evaluate(() => document.querySelector('.lmd-xroot[data-root=cloud]').classList.contains('lmd-shut')) && (await st(p)).f === 'cloud/');
  await p.click('.lmd-xroot[data-root=cloud] .lmd-root-tog .lmd-node-chev'); await sleep(120);
  await shot(p, '03-escritorio-oscuro-raiz-nube');

  console.log('Las acciones de una carpeta de la nube');
  await p.click(rowSel('Proyecto')); await at(p, 'cloud/Proyecto/');
  await p.click('.lmd-fp [data-fp=link]');
  const link = await clip(p);
  check('"Copiar el enlace" copia la dirección privada de la carpeta', link === R.home + '?f=' + encodeURIComponent('cloud/Proyecto/'), link);
  await p.click('.lmd-fp [data-fp=more]'); await p.waitForSelector('.lmd-menu');
  const mm = await menu(p);
  check('el menú de la página es el de la carpeta, sin "Abrir"', mm.includes('Rename') && mm.includes('Share the folder…') && mm.includes('Export the folder…') && mm.includes('New file here') && !mm.includes('Open'), mm);
  await closeMenu(p);
  await p.click(dirNode('cloud/Proyecto/'), { button: 'right' }); await p.waitForSelector('.lmd-menu');
  const tm = await menu(p);
  check('en el explorador, el menú de la carpeta empieza con "Abrir"', tm[0] === 'Open' && tm.includes('Share the folder…'), tm);
  await closeMenu(p);
  await p.click('.lmd-fp [data-fp=share]'); await p.waitForSelector('.lmd-share-folder');
  check('"Compartir" abre la ventana de siempre, la del enlace público', /Proyecto/.test(await p.textContent('.lmd-share-folder h3')));
  await p.keyboard.press('Escape'); await sleep(150);
  await p.evaluate(() => document.querySelectorAll('.lmd-ask').forEach((n) => n.remove()));
  await p.click('.lmd-fp [data-fp=export]');
  check('"Exportar" abre la exportación de la carpeta', !!(await until(() => p.evaluate(() => !!document.querySelector('.lmd-ask')))));
  await p.keyboard.press('Escape'); await sleep(150); await p.evaluate(() => document.querySelectorAll('.lmd-ask').forEach((n) => n.remove()));

  console.log('Agregar y editar la descripción');
  await p.click(dirNode('cloud/Suelta/') + ' .lmd-node-name');
  const d0 = await at(p, 'cloud/Suelta/');
  check('una carpeta sin README no tiene descripción y ofrece agregarla', !!d0 && d0.desc === null && d0.acts.includes('describe') && J(d0.rows) === J(['f:nota']), d0 || await st(p));
  await p.click('.lmd-fp [data-fp=describe]');
  const d1 = await until(async () => { const s = await st(p); return s.f === 'cloud/Suelta/README.md' && s.editing ? s : null; });
  check('"Agregar una descripción" crea el README.md de la carpeta y lo abre para editar', !!d1 && (await textOf(duena, 'Suelta/README.md')) === '# Suelta\n\n', [await st(p), await textOf(duena, 'Suelta/README.md')]);
  await p.evaluate(() => LMD.cloud.write('Suelta/README.md', '# Suelta\n\nNotas sueltas, sin orden.\n'));
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Suelta/'));
  const d2 = await at(p, 'cloud/Suelta/');
  check('lo que se escribe ahí es la descripción de la carpeta', !!d2 && d2.desc === 'Notas sueltas, sin orden.' && J(d2.rows) === J(['f:nota', 'f:README:Description']) && d2.acts.includes('edit'), d2 || await st(p));
  await p.click('.lmd-fp [data-fp=edit]');
  check('"Editar la descripción" abre ese README en edición', !!(await until(async () => { const s = await st(p); return s.f === 'cloud/Suelta/README.md' && s.editing; })), await st(p));
  await p.evaluate(() => LMD.cloud.write('Suelta/README.md', '# Suelta\n'));
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Suelta/'));
  const d3 = await at(p, 'cloud/Suelta/');
  check('un README que solo tiene el nombre de la carpeta no dibuja una descripción vacía', !!d3 && d3.desc === null && d3.acts.includes('edit') && (await p.textContent('.lmd-fp-add')) === 'Add a description', d3 || await st(p));

  console.log('El plan gratis: el README cuenta como una nota');
  const g = await R.open(gratis);
  await g.page.goto(R.home + '?f=' + encodeURIComponent('cloud/Llena/'));
  const g0 = await at(g.page, 'cloud/Llena/');
  check('la carpeta de una cuenta gratis se ve igual, sin compartir (es del plan pago)', !!g0 && g0.rows.length === FREE && g0.acts.includes('describe') && !g0.acts.includes('share'), g0 || await st(g.page));
  await g.page.click('.lmd-fp [data-fp=describe]');
  const full = await until(() => g.page.evaluate(() => { const pn = document.querySelector('.lmd-panel'); return pn && !pn.hidden && /free plan is full/.test(pn.innerText) ? pn.innerText : null; }));
  check('sin lugar en el plan, agregar la descripción lo dice con el aviso de siempre y no crea nada', !!full && /The free plan is full/.test(full) && (await paths(gratis)).length === FREE, [full && full.slice(0, 300), await paths(gratis)]);
  await g.ctx.close();

  // ---------- En este navegador ----------
  console.log('En este navegador');
  await p.goto(R.home); await p.waitForSelector('.lmd-xroot[data-root=local]');
  await p.evaluate(async () => {
    await LMD.store.notePut('Carpeta/README.md', '# Carpeta\n\nLo que hay en esta carpeta.\n');
    await LMD.store.notePut('Carpeta/uno.md', '---\ntags: a\n---\n\n# Título uno\n\nTexto.\n');
    await LMD.store.notePut('Carpeta/sub/dos.md', '# Dos\n');
    await LMD.store.notePut('suelta.md', 'Sin título, solo texto.\n');
  });
  await p.goto(R.home); await p.waitForSelector(dirNode('local/Carpeta/'));
  await p.click('.lmd-xroot[data-root=local] .lmd-root-tog .lmd-tree-path');
  const l0 = await at(p, 'local/');
  check('tocar "En este navegador" abre su índice', !!l0 && l0.h1 === 'In this browser' && J(l0.rows) === J(['d:Carpeta', 'f:suelta']) && J(l0.active) === J(['In this browser']), l0 || await st(p));
  check('una carpeta del navegador dice cuántas notas tiene', !!(await until(async () => (await st(p)).metas[0] === '3 notes')), (await st(p)).metas);
  await p.click(rowSel('Carpeta'));
  const l1 = await at(p, 'local/Carpeta/');
  check('la página de una carpeta del navegador: descripción, subcarpeta y notas por su título', !!l1 && l1.desc === 'Lo que hay en esta carpeta.' && J(l1.rows) === J(['d:sub', 'f:README:Description', 'f:Título uno']) && l1.open.includes('Carpeta') && J(l1.crumbs) === J(['In this browser']), l1 || await st(p));
  check('sus acciones: copiar el enlace, exportar, el menú y editar la descripción (no hay enlace público)', !!l1 && J(l1.acts) === J(['link', 'export', 'more', 'edit']), l1 && l1.acts);
  await p.click('.lmd-fp [data-fp=more]'); await p.waitForSelector('.lmd-menu');
  const lm = await menu(p);
  check('el menú de la página: enviar a la nube, exportar y eliminar', lm.includes('Send the folder to the cloud') && lm.includes('Export the folder…') && lm.includes('Delete') && !lm.includes('Open'), lm);
  await closeMenu(p);
  await p.reload();
  check('recargar deja la misma carpeta del navegador', !!(await at(p, 'local/Carpeta/')));
  await p.click(rowSel('sub')); const l2 = await at(p, 'local/Carpeta/sub/');
  await p.click('.lmd-fp [data-fp=describe]');
  const l3 = await until(async () => { const s = await st(p); return s.f === 'local/Carpeta/sub/README.md' && s.editing ? s : null; });
  check('agregar una descripción en el navegador crea el README en esa carpeta', !!l2 && !!l3 && (await p.evaluate(async () => ((await LMD.store.noteGet('Carpeta/sub/README.md')) || {}).text)) === '# sub\n\n', await st(p));
  await p.evaluate(async () => { for (const n of await LMD.store.notesAll()) await LMD.store.noteDelete(n.name); });
  await p.goto(R.home + '?f=' + encodeURIComponent('local/'));
  const l4 = await at(p, 'local/');
  check('sin notas, la raíz lo dice y ofrece crear una', !!l4 && l4.empty === 'This folder is empty.' && l4.acts.includes('new') && !l4.rows.length, l4 || await st(p));
  check('abierta por su dirección, el explorador igual se dibuja y marca la raíz', !!(await until(async () => J((await st(p)).active) === J(['In this browser']))), (await st(p)).active);
  await shot(p, '04-escritorio-oscuro-carpeta-vacia');
  await p.click('.lmd-fp [data-fp=new]');
  check('"Crear una nota" la crea ahí y la abre', !!(await until(async () => { const s = await st(p); return /^local\//.test(s.f) && !s.dir && s.editing; })) && (await p.evaluate(async () => (await LMD.store.notesAll()).length)) === 1, await st(p));

  // ---------- Una carpeta del disco ----------
  console.log('Una carpeta del disco');
  const k = await persistent(duena); const q = k.page;
  await q.goto(R.home); await q.waitForSelector('[data-home=dir]');
  await q.evaluate(async () => {
    const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('carp', { create: true });
    const putIn = async (d, n, t) => { const h = await d.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(t); await w.close(); };
    await putIn(top, 'README.md', '# carp\n\nLa carpeta del disco.\n'); await putIn(top, 'a.md', '# Alpha uno\n\nTexto.\n'); await putIn(top, 'sin-titulo.md', 'Solo texto.\n');
    const docs = await top.getDirectoryHandle('docs', { create: true }); await putIn(docs, 'readme.md', 'En minúsculas también vale.\n'); await putIn(docs, 'x.md', '# Equis\n');
    await top.getDirectoryHandle('vacia', { create: true });
    const many = await top.getDirectoryHandle('muchas', { create: true });
    for (let i = 1; i <= 500; i++) await putIn(many, 'n' + String(i).padStart(3, '0') + '.md', '# Nota ' + i + '\n\n' + 'Cuerpo de la nota. '.repeat(40) + '\n');
    window.showDirectoryPicker = async () => top;
  });
  await q.click('[data-home=dir]');
  const id = await until(async () => { const f = (await st(q)).f; return /^[a-z0-9]+\/.+\.md$/.test(f) ? f.split('/')[0] : null; });
  await q.waitForSelector(dirNode(id + '/docs/'));
  await q.click('.lmd-xroot[data-root=disk] .lmd-root-tog .lmd-tree-path');
  const k0 = await at(q, id + '/');
  check('tocar el nombre de la carpeta abierta muestra su índice', !!k0 && k0.h1 === 'carp' && k0.desc === 'La carpeta del disco.' && J(k0.rows.slice(0, 3)) === J(['d:docs', 'd:muchas', 'd:vacia']) && J(k0.active) === J(['carp']), k0 || await st(q));
  const k1 = await until(async () => { const s = await st(q); return s.rows.includes('f:Alpha uno') && /\d/.test(s.metas[3]) ? s : null; });
  check('de cada archivo del disco se lee solo el comienzo: su título y su fecha', !!k1 && J(k1.rows.slice(3)) === J(['f:Alpha uno', 'f:README:Description', 'f:sin-titulo']) && k1.metas.slice(3).every((m) => /\d/.test(m)), k1 || await st(q));
  check('y cada subcarpeta dice cuántas notas tiene', !!(await until(async () => { const m = (await st(q)).metas; return m[0] === '2 files' && m[1] === '500 files' && m[2] === ''; })), (await st(q)).metas);
  check('con permiso para guardar, sus acciones: el enlace, exportar, el menú y editar la descripción', !!k0 && J(k0.acts) === J(['link', 'export', 'more', 'edit']), k0 && k0.acts);
  await q.click('.lmd-fp [data-fp=more]'); await q.waitForSelector('.lmd-menu');
  const km = await menu(q);
  check('el menú de la raíz del disco: crear, exportar y enviar a la nube', km.includes('Blank note') && km.includes('Folder') && km.includes('Export the folder…') && km.includes('Send the folder to the cloud') && !km.includes('Open'), km);
  await closeMenu(q);
  await q.click(rowSel('docs'));
  const k2 = await at(q, id + '/docs/');
  check('readme.md en minúsculas también es la descripción', !!k2 && k2.desc === 'En minúsculas también vale.' && J(k2.crumbs) === J(['carp']) && J(k2.rows) === J(['f:readme:Description', 'f:Equis']), k2 || await st(q));
  await q.reload();
  check('recargar deja la misma carpeta del disco', !!(await at(q, id + '/docs/')), await st(q));
  await q.goBack();
  check('y atrás vuelve a su carpeta de arriba', !!(await at(q, id + '/')), await st(q));

  console.log('Una carpeta vacía');
  await q.click(rowSel('vacia'));
  const v0 = await at(q, id + '/vacia/');
  check('una carpeta vacía lo dice y ofrece crear una nota y agregar una descripción', !!v0 && v0.empty === 'This folder is empty.' && J(v0.acts) === J(['link', 'more', 'describe', 'new']), v0 || await st(q));
  await q.click('.lmd-fp [data-fp=new]'); await q.waitForSelector('.lmd-dlg input');
  await q.fill('.lmd-dlg input', 'primera'); await q.click('.lmd-dlg [data-dlg=ok]');
  check('"Crear una nota" la crea en esa carpeta', !!(await until(async () => (await st(q)).f === id + '/vacia/primera.md')), await st(q));
  await q.goBack();
  const v1 = await at(q, id + '/vacia/');
  check('y al volver la carpeta ya la lista', !!v1 && J(v1.rows) === J(['f:primera']), v1 || await st(q));

  console.log('500 notas');
  await q.goto(R.home + '?f=' + encodeURIComponent(id + '/')); await at(q, id + '/');
  await q.evaluate(() => {
    window.__texts = 0; const t = Blob.prototype.text; Blob.prototype.text = function () { window.__texts++; return t.call(this); };
    window.__gap = 0; let last = performance.now(); const tick = () => { const now = performance.now(); window.__gap = Math.max(window.__gap, now - last); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await q.click(rowSel('muchas'));
  await until(() => q.evaluate((u) => { const fp = document.querySelector('.lmd-fp'); return !!fp && fp.dataset.url === u && fp.querySelectorAll('.lmd-fp-row').length > 0; }, VB + id + '/muchas/'), 15000);
  const tFirst = Date.now() - t0;
  const big = await at(q, id + '/muchas/', 15000);
  const tAll = Date.now() - t0; await sleep(700);
  const cost = await q.evaluate(() => ({ texts: window.__texts, gap: Math.round(window.__gap) }));
  console.log('  500 notas: primeros renglones en ' + tFirst + ' ms, todos en ' + tAll + ' ms, ' + cost.texts + ' lecturas de comienzo de archivo, cuadro más largo ' + cost.gap + ' ms');
  check('una carpeta con 500 notas lista las 500', !!big && big.rows.length === 500 && big.sum === '500 files', big && [big.rows.length, big.sum]);
  check('aparece enseguida y termina sin trabar la página', tFirst < 2500 && tAll < 5000 && cost.gap < 700, [tFirst, tAll, cost.gap]);
  check('sin leer las 500: solo el comienzo de las que están a la vista', cost.texts > 0 && cost.texts < 90, cost.texts);
  const t500 = await st(q);
  check('las que están a la vista ya muestran su título', t500.rows[0] === 'f:Nota 1' && t500.rows[499] === 'f:n500', [t500.rows[0], t500.rows[499]]);
  await q.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  check('y al bajar se completan las del final', !!(await until(async () => (await st(q)).rows[499] === 'f:Nota 500')), (await st(q)).rows[499]);
  await k.ctx.close();
  await p.evaluate(async () => { for (let i = 1; i <= 500; i++) await LMD.store.notePut('Muchas/n' + String(i).padStart(3, '0') + '.md', '# Local ' + i + '\n'); });
  const tl = Date.now();
  await p.goto(R.home + '?f=' + encodeURIComponent('local/Muchas/'));
  const lbig = await at(p, 'local/Muchas/', 15000);
  console.log('  500 notas del navegador: de la dirección a la página entera en ' + (Date.now() - tl) + ' ms');
  check('500 notas del navegador también, con sus títulos', !!lbig && lbig.rows.length === 500 && lbig.rows[0] === 'f:Local 1' && Date.now() - tl < 8000, lbig && [lbig.rows.length, lbig.rows[0]]);
  await p.evaluate(async () => { for (const n of await LMD.store.notesAll()) await LMD.store.noteDelete(n.name); });

  console.log('Una carpeta del disco en solo lectura');
  // El permiso de escritura, como lo da el navegador: no está hasta que la persona lo acepta.
  const ro = await persistent(duena, () => {
    const proto = window.FileSystemHandle && window.FileSystemHandle.prototype; if (!proto) return;
    proto.queryPermission = async function (o) { return o && o.mode === 'readwrite' && !sessionStorage.getItem('rw') ? 'prompt' : 'granted'; };
    proto.requestPermission = async function (o) { if (o && o.mode === 'readwrite') sessionStorage.setItem('rw', '1'); return 'granted'; };
  });
  await ro.page.goto(R.home); await ro.page.waitForSelector('[data-home=dir]');
  await ro.page.evaluate(async () => {
    const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('lectura', { create: true });
    const w = await (await top.getFileHandle('a.md', { create: true })).createWritable(); await w.write('# A\n'); await w.close();
    await top.getDirectoryHandle('vacia', { create: true });
    window.showDirectoryPicker = async () => top;
  });
  await ro.page.click('[data-home=dir]');
  const rid = await until(async () => { const f = (await st(ro.page)).f; return /^[a-z0-9]+\/a\.md$/.test(f) ? f.split('/')[0] : null; });
  await ro.page.goto(R.home + '?f=' + encodeURIComponent(rid + '/vacia/'));
  const ro0 = await at(ro.page, rid + '/vacia/');
  check('sin permiso para guardar no ofrece crear ni describir, y dice cómo permitirlo', !!ro0 && ro0.empty === 'This folder is empty.' && J(ro0.acts) === J(['link', 'more', 'write']) && /Read-only/.test(await ro.page.textContent('.lmd-fp-ro')), ro0 || await st(ro.page));
  await ro.page.click('.lmd-fp [data-fp=write]'); await ro.page.waitForSelector('.lmd-dlg [data-dlg=ok]'); await ro.page.click('.lmd-dlg [data-dlg=ok]');
  const ro1 = await until(async () => { const s = await st(ro.page); return s.acts.includes('new') ? s : null; });
  check('al permitir guardar, la página ofrece crear una nota y agregar una descripción', !!ro1 && J(ro1.acts) === J(['link', 'more', 'describe', 'new']), ro1 || await st(ro.page));
  await ro.ctx.close();

  // ---------- Claro, y en español ----------
  console.log('Claro y en español');
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/')); await at(p, 'cloud/Proyecto/');
  await setTheme(p, 'light'); await shot(p, '05-escritorio-claro-con-descripcion');
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/sub/')); await at(p, 'cloud/Proyecto/sub/');
  await shot(p, '06-escritorio-claro-sin-descripcion');
  await p.evaluate(() => LMD.patch({ language: 'es' }));
  const es = await until(async () => { const s = await st(p); return s.done && s.acts.includes('describe') && /Agregar una descripción/.test(s.text) ? s : null; }, 12000);
  check('en español: los textos de la página', !!es && J(es.crumbs) === J(['Nube', 'Proyecto']) && es.sum === '2 notas' && /Copiar el enlace/.test(es.text) && noShout(es.text), es || await st(p));
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/'));
  const es2 = await at(p, 'cloud/Proyecto/');
  check('y los de una carpeta con descripción', !!es2 && es2.sum === '1 carpeta · 2 notas' && /Editar la descripción/.test(es2.text) && es2.rows[2] === 'f:README:Descripción' && noShout(es2.text), es2 || await st(p));
  await shot(p, '07-escritorio-claro-espanol');
  await p.evaluate(() => LMD.patch({ language: 'en', theme: 'dark' })); await sleep(900);

  // ---------- Una carpeta protegida con contraseña ----------
  console.log('Una carpeta protegida y bloqueada');
  const PASS = 'caballo correcto batería grapa'; const CARD = '.lmd-vault-card';
  const pick = async (f, act) => { await p.click(dirNode(f), { button: 'right' }); await p.waitForSelector('.lmd-menu [data-f=' + act + ']'); await p.click('.lmd-menu [data-f=' + act + ']'); };
  await p.goto(R.home); await p.waitForSelector(dirNode('cloud/Suelta/'));
  await pick('cloud/Suelta/', 'v-protect'); await p.waitForSelector(CARD);
  await p.fill('[data-v=p1]', PASS); await p.fill('[data-v=p2]', PASS); await p.keyboard.press('Enter'); await p.waitForSelector('.lmd-vault-key');
  await Promise.all([p.waitForEvent('download'), p.click('[data-v=down]')]);
  await p.click('[data-v=ok]'); await p.waitForSelector(CARD, { state: 'detached', timeout: 30000 });
  await p.waitForSelector(dirNode('cloud/Suelta/') + '.lmd-node-vault');
  await p.click(dirNode('cloud/Suelta/') + ' .lmd-node-name');
  const vo = await at(p, 'cloud/Suelta/');
  check('una carpeta protegida y desbloqueada se abre como cualquier otra', !!vo && J(vo.rows) === J(['f:nota', 'f:README:Description']), vo || await st(p));
  await pick('cloud/Suelta/', 'v-lock'); await p.waitForSelector(dirNode('cloud/Suelta/') + '.lmd-vault-shut');
  await p.goto(R.home + '?f=' + encodeURIComponent('cloud/Suelta/'));
  const vl = await at(p, 'cloud/Suelta/');
  check('bloqueada, su página no muestra lo que tiene y ofrece desbloquearla', !!vl && vl.empty === 'Protected folder. Unlock it to see its notes.' && !vl.rows.length && J(vl.acts) === J(['link', 'more', 'unlock']), vl || await st(p));
  await p.click('.lmd-fp [data-fp=unlock]'); await p.waitForSelector(CARD + ' [data-v=p]'); await p.fill('[data-v=p]', PASS); await p.click('[data-v=ok]');
  const vu = await until(async () => { const s = await st(p); return s.rows.length === 2 ? s : null; }, 20000);
  check('al desbloquearla ahí mismo, la página lista sus notas', !!vu && J(vu.rows) === J(['f:nota', 'f:README:Description']) && vu.f === 'cloud/Suelta/', vu || await st(p));

  // ---------- La guía ----------
  console.log('La guía, de solo lectura');
  await p.goto(R.home + '?f=' + encodeURIComponent('guide/'));
  const gd = await at(p, 'guide/');
  check('la guía también tiene su página, con sus notas por título', !!gd && gd.h1 === 'Guide' && gd.rows.length === 17 && gd.rows[0] === 'f:Start here' && gd.sum === '17 notes', gd || await st(p));
  check('solo se lee: copiar el enlace y nada más', !!gd && J(gd.acts) === J(['link']), gd && gd.acts);
  await p.click(rowSel('Start here'));
  check('y sus notas se abren desde ahí', !!(await until(async () => (await st(p)).f === 'guide/start.md')), await st(p));

  // ---------- Una carpeta compartida por enlace, y una plantilla ----------
  console.log('Enlace público de carpeta y plantilla');
  const made = (await api('POST', '/links', { path: 'Proyecto', kind: 'folder' }, duena.s)).json;
  const v = await R.open(null);
  await v.page.goto(R.home + '?f=' + encodeURIComponent('pub/' + made.token));
  const pb = await at(v.page, 'pub/' + made.token + '/');
  check('quien abre el enlace público de una carpeta ve primero su página', !!pb && pb.h1 === 'Proyecto' && pb.pub && !pb.tpl && /^La descripción del proyecto/.test(pb.desc || '') && J(pb.rows) === J(['d:sub', 'f:plan', 'f:README:Description']), pb || await st(v.page));
  check('solo se lee: copiar el enlace, sin editar, crear ni compartir', !!pb && J(pb.acts) === J(['link']), pb && pb.acts);
  check('el explorador muestra la carpeta compartida, marcada como abierta', !!pb && J(pb.active) === J(['Proyecto']) && await v.page.evaluate(() => !!document.querySelector('.lmd-xroot[data-root=pub]')), pb && pb.active);
  await v.page.click(rowSel('sub'));
  const pb2 = await at(v.page, 'pub/' + made.token + '/sub/');
  check('sus subcarpetas también tienen página', !!pb2 && J(pb2.crumbs) === J(['Proyecto']) && J(pb2.rows) === J(['f:dos', 'f:uno']) && J(pb2.acts) === J(['link']), pb2 || await st(v.page));
  await v.page.click(rowSel('uno'));
  check('y sus notas se abren', !!(await until(async () => (await st(v.page)).f === 'pub/' + made.token + '/sub/uno.md')), await st(v.page));
  await api('PUT', '/links/' + made.id, { template: true, name: 'proyecto-base' }, duena.s);
  await v.page.goto(R.home + '?t=proyecto-base');
  const tp = await at(v.page, 't/proyecto-base/');
  check('una plantilla abre en su página, con la tira de plantilla arriba', !!tp && tp.tpl && tp.h1 === 'Proyecto' && J(tp.rows) === J(['d:sub', 'f:plan', 'f:README:Description']) && J(tp.acts) === J(['link']), tp || await st(v.page));
  await shot(v.page, '08-escritorio-oscuro-plantilla');
  await v.page.click(rowSel('plan'));
  check('y de ahí se pasa a sus notas, con la tira a la vista', !!(await until(async () => { const s = await st(v.page); return s.f === 't/proyecto-base/plan.md' && s.tpl; })), await st(v.page));
  await v.ctx.close();

  // ---------- Teléfono ----------
  console.log('Teléfono (390 px)');
  const ph = await R.open(duena, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = ph.page;
  await m.goto(R.home); await m.waitForSelector('.lmd-home');
  await m.click('[data-act=sidebar]'); await m.waitForSelector(dirNode('cloud/Proyecto/'));
  await m.click(dirNode('cloud/Proyecto/') + ' .lmd-node-name');
  await m.waitForSelector(fileNode('cloud/Proyecto/plan.md'));
  const ph0 = await st(m);
  check('en el teléfono, tocar el nombre solo despliega: el cajón no se cierra', ph0.f === '' && !ph0.dir && ph0.open.includes('Proyecto') && await m.evaluate(() => document.documentElement.classList.contains('lmd-side-open')), ph0);
  await m.evaluate((sel) => { const n = document.querySelector(sel); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 })); }, dirNode('cloud/Proyecto/'));
  await m.waitForSelector('.lmd-menu');
  const pm = await menu(m);
  check('la página se abre desde el menú de la carpeta, con "Abrir"', pm[0] === 'Open', pm);
  await m.click('.lmd-menu [data-f=page]');
  const ph1 = await at(m, 'cloud/Proyecto/');
  check('y se abre, con el cajón cerrado', !!ph1 && ph1.h1 === 'Proyecto' && !(await m.evaluate(() => document.documentElement.classList.contains('lmd-side-open'))), ph1 || await st(m));
  const fit = await m.evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1, small: [...document.querySelectorAll('.lmd-fp [data-fp], .lmd-fp-row')].filter((b) => b.getBoundingClientRect().height < 40).length,
    out: [...document.querySelectorAll('.lmd-fp *')].filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1).length }));
  check('entra en 390 px, sin desbordar, y todo lo que se toca mide 40 px o más', !fit.wide && !fit.small && !fit.out, fit);
  await sleep(450); // el cajón termina de cerrarse
  await shot(m, '09-telefono-oscuro-con-descripcion');
  await m.click(rowSel('sub')); await at(m, 'cloud/Proyecto/sub/');
  await shot(m, '10-telefono-oscuro-sin-descripcion');
  await m.click('[data-act=more]'); await m.waitForSelector('.lmd-menu-more');
  const more = await m.evaluate(() => [...document.querySelectorAll('.lmd-menu-more [role=menuitem]')].map((b) => b.textContent.trim()));
  check('el menú de arriba, en el teléfono, trae lo de la carpeta y no lo de una nota', more.includes('Copy the link') && more.includes('Folder actions') && !more.includes('Export') && !more.includes('Copy'), more);
  await m.keyboard.press('Escape'); await sleep(120);
  await setTheme(m, 'light');
  await shot(m, '11-telefono-claro-sin-descripcion');
  await m.goto(R.home + '?f=' + encodeURIComponent('cloud/Proyecto/')); await at(m, 'cloud/Proyecto/');
  await shot(m, '12-telefono-claro-con-descripcion');
  await m.goto(R.home + '?f=' + encodeURIComponent('cloud/')); const phr = await at(m, 'cloud/');
  check('la raíz por su dirección, en el teléfono', !!phr && phr.h1 === 'Cloud' && !phr.wide, phr || await st(m));
  await ph.ctx.close();

  check('las notas de la nube quedaron como estaban, salvo la descripción agregada', J(await paths(duena)) === J(Object.keys(CLOUD).concat('Suelta/README.md').sort()) && (await textOf(duena, 'Proyecto/README.md')) === CLOUD['Proyecto/README.md'], await paths(duena));
  check('nada apuntó a la nube de verdad', !R.outside.length, R.outside.slice(0, 3));
  check('sin errores de JavaScript', !R.errors.length, R.errors.slice(0, 3));
  bad = done();
} catch (e) {
  console.log('\nLa prueba se cortó: ' + (e && e.stack || e));
  done();
} finally {
  for (const pr of profiles) { try { await pr.ctx.close(); } catch (e) { /* ya estaba cerrado */ } try { fs.rmSync(pr.dir, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ } }
  await R.close();
}
process.exit(bad ? 1 : 0);
