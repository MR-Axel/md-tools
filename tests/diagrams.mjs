// Diagramas: acciones al pasar el mouse y editor con vista previa en vivo.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('d', { create: true });
  const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable();
  await s.write('# Doc\n\nTexto.\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nFin.\n'); await s.close();
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.lmd-diagram svg');
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const o = {};
await app.hover('.lmd-diagram'); await app.waitForSelector('.lmd-dgm-tools');
await app.click('[data-dt=zoom]'); o.zoom = await app.evaluate(() => !document.querySelector('.lmd-viewer').hidden && !!document.querySelector('.lmd-viewer svg')); await app.click('.lmd-viewer');
const [dl] = await Promise.all([app.waitForEvent('download'), app.click('[data-dt=svg]')]); o.svg = dl.suggestedFilename();
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
await app.click('.lmd-diagram'); await app.waitForSelector('.lmd-dgm-card'); await app.waitForSelector('.lmd-dgm-svg svg');
await app.click('[data-tpl="1"]'); await app.waitForTimeout(1200);
o.plantilla = await app.evaluate(() => ({ code: document.querySelector('.lmd-dgm textarea').value.split('\n')[0], svg: !!document.querySelector('.lmd-dgm-svg svg'), err: document.querySelector('.lmd-dgm-err').hidden }));
await app.fill('.lmd-dgm textarea', 'graph LR\n  A --> '); await app.waitForTimeout(1200);
o.error = await app.evaluate(() => ({ visible: !document.querySelector('.lmd-dgm-err').hidden, stale: document.querySelector('.lmd-dgm-svg').classList.contains('lmd-dgm-stale') }));
await app.fill('.lmd-dgm textarea', 'graph TD\n  X[Uno] --> Y[Dos]'); await app.waitForTimeout(900);
await app.keyboard.press('Control+Enter'); await app.waitForTimeout(1500);
o.aplicado = (await src()).split('\n').slice(4, 8);
o.dibujado = await app.evaluate(() => document.querySelector('.lmd-diagram').textContent.includes('Uno'));
await app.locator('.lmd-article h1').click({ button: 'right' }); await app.click('.lmd-menu [data-ins=diagram]'); await app.waitForSelector('.lmd-dgm-card');
o.nuevo = await app.evaluate(() => document.querySelector('.lmd-dgm textarea').value.split('\n')[0]);
// una plantilla no se lleva lo escrito: queda el botón para volver, y las piezas agregan una línea
await app.fill('.lmd-dgm textarea', 'graph LR\n  Mio[Lo que escribí] --> Otro'); await app.waitForTimeout(300);
await app.click('.lmd-dgm [data-tpl="1"]'); await app.waitForTimeout(300);
o.tplCambio = await app.evaluate(() => ({ texto: document.querySelector('.lmd-dgm textarea').value.includes('Lo que escribí'), volver: !document.querySelector('.lmd-dgm [data-dgm-back]').hidden }));
await app.click('.lmd-dgm [data-dgm-back]'); await app.waitForTimeout(300);
o.tplVolvio = await app.evaluate(() => document.querySelector('.lmd-dgm textarea').value);
await app.click('.lmd-dgm [data-piece="1"]'); await app.waitForTimeout(300);
o.pieza = await app.evaluate(() => document.querySelector('.lmd-dgm textarea').value);
await app.fill('.lmd-dgm textarea', 'sequenceDiagram\n  A->>B: hola'); await app.waitForTimeout(200);
o.piezasOcultas = await app.evaluate(() => document.querySelector('.lmd-dgm-add').hidden);
await app.click('.lmd-dgm [data-tpl="0"]'); await app.waitForTimeout(600);
await app.keyboard.press('Escape'); await app.waitForTimeout(300);
o.cerrado = await app.evaluate(() => !document.querySelector('.lmd-dgm'));
await app.hover('.lmd-diagram'); await app.waitForSelector('.lmd-handle:not([hidden])');
await app.click('.lmd-handle'); await app.waitForSelector('.lmd-menu [data-op=del]'); o.manija = true; await app.keyboard.press('Escape');
const antes = await app.locator('.lmd-diagram').count();
await app.hover('.lmd-diagram >> nth=0'); await app.click('.lmd-diagram >> nth=0 >> [data-dt=del]'); await app.waitForTimeout(500);
o.borrado = [antes, await app.locator('.lmd-diagram').count(), /mermaid/.test(await src())];
const J = (v) => JSON.stringify(v);
const checks = [
  ['una plantilla no borra lo escrito sin poder volver', o.tplCambio && !o.tplCambio.texto && o.tplCambio.volver && o.tplVolvio === 'graph LR\n  Mio[Lo que escribí] --> Otro', [o.tplCambio, o.tplVolvio]],
  ['las piezas agregan una línea al diagrama de flujo y no aparecen en otros tipos', /Otro\n  Q\{Question\?\}\n$/.test(o.pieza || '') && o.piezasOcultas === true, [o.pieza, o.piezasOcultas]],
  ['ampliar y descargar el SVG', o.zoom && o.svg === 'doc-diagrama.svg', o.svg],
  ['las plantillas se dibujan al elegirlas', o.plantilla.code === 'sequenceDiagram' && o.plantilla.svg && o.plantilla.err, o.plantilla],
  ['un error de sintaxis se muestra sin perder el último dibujo', o.error.visible && o.error.stale, o.error],
  ['aplicar reescribe solo el bloque del diagrama', J(o.aplicado) === J(['```mermaid', 'graph TD', '  X[Uno] --> Y[Dos]', '```']) && o.dibujado, o.aplicado],
  ['insertar un diagrama abre el editor', o.nuevo === 'graph LR' && o.cerrado, o.nuevo],
  ['la manija del bloque abre el menú con Eliminar', o.manija],
  ['el botón de papelera borra el diagrama', o.borrado[1] === o.borrado[0] - 1, o.borrado],
  ['sin errores de JavaScript', errors.length === 0, errors],
];
console.log('Diagramas');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
