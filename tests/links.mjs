// Enlaces internos: el selector (sección de este documento, otro archivo, dirección web), marcar el destino con un clic,
// editar y quitar, [[ al escribir, y navegar a otro archivo y a su sección en las tres raíces: disco, navegador y nube.
// La nube va contra un servidor local: la de verdad queda apagada con cloudUrl 'off' antes de apuntar acá.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 19000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', MCP_FREE: '1', SHARE_FREE: '1', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
{ let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; }); for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100)); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
// Ningún paso de los enlaces puede abrir un cuadro del navegador: si lo abre, queda anotado.
await app.addInitScript(() => { window.__native = []; ['prompt', 'alert', 'confirm'].forEach((k) => { window[k] = () => { window.__native.push(k); return null; }; }); });
const home = `chrome-extension://${id}/src/app.html`;
const o = {}; const J = (v) => JSON.stringify(v);
const LARGO = Array.from({ length: 40 }, (_, i) => 'Renglón de relleno ' + (i + 1) + '.').join('\n\n');

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(async (largo) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('enlaces', { create: true });
    const write = async (d, name, text) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(text); await s.close(); };
    await write(dir, 'guia.md', '# Guía\n\nTexto con una palabra clave acá.\n\n## Introducción\n\nPrimer párrafo.\n\n## Cómo se usa\n\nSegundo párrafo con un [viejo](https://example.com) enlace.\n\n### Paso uno\n\nDetalle del paso.\n\nPárrafo para el menú.\n\nPárrafo para marcar.\n');
    await write(dir, 'otro archivo.md', '# Otro\n\n' + largo + '\n\n## Sección Única\n\nLlegaste.\n\n' + largo + '\n');
    await write(dir, 'rotos.md', '# Rotos\n\n[sin archivo](nada.md), [sin sección](#no-existe), [sección ajena](otro%20archivo.md#tampoco) y [buena](otro%20archivo.md#sección-única).\n');
    await write(await dir.getDirectoryHandle('sub', { create: true }), 'tercero.md', '# Tercero\n\n## Parte B\n\nTexto.\n\n[arriba](../guia.md#cómo-se-usa)\n');
    window.showDirectoryPicker = async () => dir;
  }, LARGO);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
  const docUrl = app.url();
  const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
  const blur = async () => { await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(600); };
  const line = async (re) => (await src()).split('\n').filter((l) => re.test(l))[0];
  // Selecciona un texto dentro de un bloque editable, como lo haría el mouse.
  const select = async (block, text) => { await app.locator('.lmd-article .lmd-editable', { hasText: block }).first().click(); await app.evaluate(([b, t]) => {
    const host = [...document.querySelectorAll('.lmd-article .lmd-editable')].find((n) => n.textContent.includes(b));
    const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(t); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } }
  }, [block, text]); await app.waitForTimeout(200); };
  const caretEnd = async (block) => { await app.locator('.lmd-article .lmd-editable', { hasText: block }).first().click(); await app.keyboard.press('End'); };
  const rows = () => app.evaluate(() => [...document.querySelectorAll('.lmd-lk-list .lmd-lk-row')].map((b) => b.textContent.trim()));

  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);

  // 1. Desde la barra de formato, con texto elegido: una sección de este documento
  await select('palabra clave', 'palabra clave');
  await app.waitForSelector('.lmd-format:not([hidden])');
  await app.locator('.lmd-format [data-fmt=link]').dispatchEvent('mousedown'); await app.waitForSelector('.lmd-lk-card');
  o.tabs = await app.evaluate(() => [...document.querySelectorAll('.lmd-lk-card .lmd-seg button')].map((b) => b.textContent + (b.classList.contains('lmd-on') ? '*' : '')));
  o.titulos = await app.evaluate(() => [...document.querySelectorAll('.lmd-lk-list .lmd-lk-row')].map((b) => b.className.match(/lmd-lk-l\d/)[0].slice(-1) + ' ' + b.textContent));
  o.foco = await app.evaluate(() => document.activeElement.className);
  await app.keyboard.type('intro'); o.filtrado = await rows();
  await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.seccion = await line(/palabra clave/);

  // 2. Ctrl+K sin selección: otro archivo; el texto es el nombre del archivo
  await caretEnd('Primer párrafo'); await app.keyboard.type(' Ver '); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('.lmd-lk-card .lmd-seg [data-val=file]'); await app.waitForSelector('.lmd-lk-file');
  o.archivos = await rows();
  o.sinLeer = await app.locator('.lmd-lk-sub').count();
  await app.keyboard.type('otro'); o.archivosFiltrados = await rows();
  await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.archivo = await line(/Primer párrafo/);

  // 3. Desplegar un archivo y elegir una sección suya; y uno de una subcarpeta
  await caretEnd('Detalle del paso'); await app.keyboard.type(' '); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('.lmd-lk-card .lmd-seg [data-val=file]'); await app.waitForSelector('.lmd-lk-file');
  await app.locator('.lmd-lk-file', { hasText: 'otro archivo.md' }).locator('.lmd-lk-tog').click(); await app.waitForSelector('.lmd-lk-sub.lmd-lk-row');
  o.titulosAjenos = await app.evaluate(() => [...document.querySelectorAll('.lmd-lk-sub.lmd-lk-row')].map((b) => b.textContent));
  await app.locator('.lmd-lk-sub.lmd-lk-row', { hasText: 'Sección Única' }).click(); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.seccionAjena = await line(/Detalle del paso/);

  // 4. Dirección web: se rechaza lo que no es una dirección, y sin texto elegido queda una etiqueta legible
  await select('Segundo párrafo', 'Segundo'); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('.lmd-lk-card .lmd-seg [data-val=web]');
  o.sinLista = await app.evaluate(() => document.querySelector('.lmd-lk-list').hidden);
  await app.fill('.lmd-lk-q', 'javascript:alert(1)'); await app.click('[data-lk=ok]');
  o.rechazo = await app.textContent('.lmd-lk-card .lmd-img-err');
  await app.fill('.lmd-lk-q', 'example.com/una pagina'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.web = await line(/Segundo/);

  // 5. Desde el menú de bloques: el enlace va en un renglón propio, con el título como texto
  await app.locator('.lmd-article p', { hasText: 'Párrafo para el menú' }).click({ button: 'right' }); await app.waitForSelector('.lmd-menu');
  await app.click('.lmd-menu [data-ins=link]'); await app.waitForSelector('.lmd-lk-card');
  await app.locator('.lmd-lk-row', { hasText: 'Cómo se usa' }).click(); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await app.waitForTimeout(400);
  { const l = (await src()).split('\n'); const i = l.indexOf('Párrafo para el menú.'); o.menu = l.slice(i, i + 4); }

  // 6. Marcar en el documento: Escape cancela; un clic en un título lo elige
  await caretEnd('Párrafo para marcar'); await app.keyboard.type(' Ir a '); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('[data-lk=mark]'); await app.waitForSelector('.lmd-pickbar');
  o.marcando = await app.evaluate(() => [document.documentElement.classList.contains('lmd-picking'), !!document.querySelector('.lmd-lk-card'), getComputedStyle(document.querySelector('.lmd-article h3')).cursor, getComputedStyle(document.querySelector('.lmd-article p')).opacity]);
  await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  o.cancelado = await app.evaluate(() => [document.documentElement.classList.contains('lmd-picking'), !!document.querySelector('.lmd-pickbar'), document.documentElement.classList.contains('lmd-editing'), document.activeElement.textContent]);
  await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card'); await app.click('[data-lk=mark]'); await app.waitForSelector('.lmd-pickbar');
  await app.locator('.lmd-article p', { hasText: 'Detalle del paso' }).click(); await app.waitForTimeout(150);
  o.sigueMarcando = await app.evaluate(() => document.documentElement.classList.contains('lmd-picking'));
  await app.locator('.lmd-article h3', { hasText: 'Paso uno' }).click(); await app.waitForSelector('.lmd-pickbar', { state: 'detached' }); await blur();
  o.marcado = await line(/Párrafo para marcar/);

  // 7. Editar y quitar un enlace que ya estaba: el cursor encima alcanza
  const enViejo = async () => { await app.locator('.lmd-article .lmd-editable a', { hasText: 'viejo' }).click(); await app.waitForSelector('.lmd-format.lmd-format-link:not([hidden])'); };
  await enViejo();
  o.barraEnlace = await app.evaluate(() => [...document.querySelectorAll('.lmd-format button')].filter((b) => b.offsetWidth > 0).map((b) => b.textContent));
  await app.locator('.lmd-format [data-fmt=link]').dispatchEvent('mousedown'); await app.waitForSelector('.lmd-lk-card');
  o.editar = await app.evaluate(() => [document.querySelector('.lmd-lk-card h3').textContent, document.querySelector('.lmd-lk-now code').textContent, document.querySelector('.lmd-lk-card .lmd-seg .lmd-on').dataset.val, document.querySelector('.lmd-lk-q').value, !!document.querySelector('[data-lk=remove]')]);
  await app.click('.lmd-lk-card .lmd-seg [data-val=here]'); await app.locator('.lmd-lk-row', { hasText: 'Introducción' }).click(); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.cambiado = await line(/viejo/);
  await enViejo(); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  o.editarSeccion = await app.evaluate(() => [document.querySelector('.lmd-lk-now code').textContent, (document.querySelector('.lmd-lk-row.lmd-on') || {}).textContent]);
  await app.click('[data-lk=remove]'); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.quitado = await line(/viejo/);

  // 8. [[ al escribir: la lista de archivos y, después del #, la de sus títulos
  await caretEnd('Texto con una'); await app.keyboard.type(' [[ter'); await app.waitForSelector('.lmd-wikibox:not([hidden])');
  o.wikiLista = await app.evaluate(() => [...document.querySelectorAll('.lmd-wikibox button em')].map((n) => n.textContent));
  const parrafos = await app.locator('.lmd-article p').count();
  await app.keyboard.press('Enter'); await app.waitForTimeout(200);
  o.wikiSinBloque = (await app.locator('.lmd-article p').count()) === parrafos && await app.evaluate(() => document.querySelector('.lmd-wikibox').hidden);
  await app.keyboard.type(' y [[otro archivo#Sec'); await app.waitForFunction(() => { const b = document.querySelector('.lmd-wikibox'); return !b.hidden && /Sección/.test(b.textContent); });
  o.wikiTitulos = await app.evaluate(() => [...document.querySelectorAll('.lmd-wikibox button em')].map((n) => n.textContent));
  await app.keyboard.press('Enter'); await app.waitForTimeout(200);
  await app.keyboard.type(' y [[zzz'); await app.waitForTimeout(400);
  o.wikiNada = await app.evaluate(() => document.querySelector('.lmd-wikibox').hidden);
  for (let i = 0; i < 8; i++) await app.keyboard.press('Backspace');
  await blur();
  o.wiki = await line(/Texto con una/);
  o.wikiDestinos = await app.evaluate(() => [...document.querySelectorAll('.lmd-article a.lmd-wiki')].map((a) => decodeURIComponent(decodeURIComponent(new URL(a.href).search)) + new URL(a.href).hash));
  o.nativos = await app.evaluate(() => window.__native);
  await app.keyboard.press('Control+s'); await app.waitForTimeout(900);
  o.disco = await app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('enlaces'); return (await (await (await dir.getFileHandle('guia.md')).getFile()).text()); });
  o.fuente = await src();

  // 9. Navegar. Editando, el clic pone el cursor y Ctrl+clic sigue el enlace
  const estado = () => app.evaluate(() => ({ doc: document.title, y: Math.round(window.scrollY), aviso: document.querySelector('.lmd-status').textContent, error: document.querySelector('.lmd-status').className }));
  const titulo = (t) => app.evaluate((x) => { const h = [...document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3')].find((n) => n.textContent.trim().startsWith(x)); return h ? Math.round(h.getBoundingClientRect().top) : null; }, t);
  await app.locator('.lmd-article a', { hasText: 'Sección Única' }).first().click(); await app.waitForTimeout(400);
  o.clicEditando = (await estado()).doc;
  await Promise.all([app.waitForNavigation(), app.locator('.lmd-article a', { hasText: 'Sección Única' }).first().click({ modifiers: ['Control'] })]); await app.waitForSelector('.markdown-body h2'); await app.waitForTimeout(500);
  o.ctrlClic = [await estado(), await titulo('Sección Única')];
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
  // leyendo, desde una subcarpeta hacia arriba, con el ancla escrita con acentos
  await app.goto(docUrl.replace('guia.md', encodeURIComponent('sub/tercero.md'))); await app.waitForSelector('.markdown-body h1');
  await Promise.all([app.waitForNavigation(), app.click('.markdown-body a:has-text("arriba")')]); await app.waitForSelector('.markdown-body h1'); await app.waitForTimeout(500);
  o.haciaArriba = [await estado(), await titulo('Cómo se usa')];
  // dentro del mismo documento
  await app.evaluate(() => window.scrollTo(0, 0)); await app.click('.markdown-body a:has-text("palabra clave")'); await app.waitForTimeout(900);
  o.mismoDoc = [await titulo('Introducción'), app.url().split('#')[1]];
  // el enlace wiki a una sección de otro archivo
  await Promise.all([app.waitForNavigation(), app.click('.markdown-body a.lmd-wiki:has-text("otro archivo#")')]); await app.waitForSelector('.markdown-body h2'); await app.waitForTimeout(500);
  o.wikiNavega = [await estado(), await titulo('Sección Única')];
  // lo que no existe avisa, y no saca de donde se está
  await app.goto(docUrl.replace('guia.md', 'rotos.md')); await app.waitForSelector('.markdown-body h1');
  await app.click('.markdown-body a:has-text("sin archivo")'); await app.waitForTimeout(500); o.sinArchivo = await estado();
  await app.click('.markdown-body a:has-text("sin sección")'); await app.waitForTimeout(300); o.sinSeccion = await estado();
  await Promise.all([app.waitForNavigation(), app.click('.markdown-body a:has-text("sección ajena")')]); await app.waitForSelector('.markdown-body h2'); await app.waitForTimeout(500);
  o.sinSeccionAjena = await estado();

  // 10. Notas guardadas en este navegador
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(async (largo) => { await LMD.store.notePut('uno.md', '# Uno\n\n[a dos](dos.md#la-sección-ñ) y [a ninguna](tres.md)\n'); await LMD.store.notePut('dos.md', '# Dos\n\n' + largo + '\n\n## La sección ñ\n\nAcá.\n\n' + largo + '\n'); }, LARGO);
  await app.goto(home + '?f=' + encodeURIComponent('local/uno.md')); await app.waitForSelector('.markdown-body h1');
  await app.click('.markdown-body a:has-text("a ninguna")'); await app.waitForTimeout(500); o.localRoto = await estado();
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('.lmd-lk-card .lmd-seg [data-val=file]'); await app.waitForSelector('.lmd-lk-file');
  o.localArchivos = await rows();
  await app.keyboard.press('Escape'); await app.click('[data-act=mode-read]'); await app.waitForTimeout(300);
  await Promise.all([app.waitForNavigation(), app.click('.markdown-body a:has-text("a dos")')]); await app.waitForSelector('.markdown-body h2'); await app.waitForTimeout(500);
  o.local = [await estado(), await titulo('La sección ñ')];

  // 11. Notas de la nube
  await app.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url } }, resolve)), base);
  await app.goto(home); await app.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
  await app.click('[data-cloud=ask]'); await app.fill('[data-field=email]', 'ana@ejemplo.test');
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  await app.waitForSelector('[data-field=code]'); await app.fill('[data-field=code]', (await started.json()).dev_code); await app.click('[data-cloud=verify]'); await app.waitForSelector('[data-cloud=logout]');
  await app.evaluate(async (largo) => { await LMD.cloud.write('proyecto/uno.md', '# Uno\n\n[a dos](notas/dos.md#la-sección-ñ) y [a ninguna](tres.md)\n'); await LMD.cloud.write('proyecto/notas/dos.md', '# Dos\n\n' + largo + '\n\n## La sección ñ\n\nAcá.\n\n' + largo + '\n'); }, LARGO);
  await app.goto(home + '?f=' + encodeURIComponent('cloud/proyecto/uno.md')); await app.waitForSelector('.markdown-body h1');
  await app.click('.markdown-body a:has-text("a ninguna")'); await app.waitForTimeout(700); o.nubeRoto = await estado();
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' '); await app.keyboard.press('Control+k'); await app.waitForSelector('.lmd-lk-card');
  await app.click('.lmd-lk-card .lmd-seg [data-val=file]'); await app.waitForSelector('.lmd-lk-file');
  o.nubeArchivos = await app.evaluate(() => [...document.querySelectorAll('.lmd-lk-file .lmd-lk-row')].map((b) => b.querySelector('span').textContent + '|' + b.querySelector('small').textContent));
  await app.locator('.lmd-lk-file .lmd-lk-tog').first().click(); await app.waitForSelector('.lmd-lk-sub.lmd-lk-row');
  await app.locator('.lmd-lk-sub.lmd-lk-row', { hasText: 'La sección ñ' }).click(); await app.waitForSelector('.lmd-lk-card', { state: 'detached' }); await blur();
  o.nubeEnlace = (await src()).split('\n')[2];
  await app.waitForFunction(() => /nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 8000 });
  await app.click('[data-act=mode-read]'); await app.waitForTimeout(400);
  await Promise.all([app.waitForNavigation(), app.locator('.markdown-body a', { hasText: 'La sección ñ' }).click()]); await app.waitForSelector('.markdown-body h2'); await app.waitForTimeout(600);
  o.nube = [await estado(), await titulo('La sección ñ')];
} catch (e) { o.excepcion = String(e && e.stack || e); }

const cerca = (v) => v != null && v > 40 && v < 400; // el título quedó arriba, a la vista
const checks = [
  ['el botón de enlace abre el selector de la app, con los tres destinos en orden', J(o.tabs) === J(['Este documento*', 'Otro archivo', 'Dirección web']) && o.foco === 'lmd-lk-q', [o.tabs, o.foco]],
  ['los títulos salen con su jerarquía y se filtran escribiendo, sin importar los acentos', J(o.titulos) === J(['1 Guía', '2 Introducción', '2 Cómo se usa', '3 Paso uno']) && J(o.filtrado) === J(['Introducción']), [o.titulos, o.filtrado]],
  ['elegir un título escribe [texto](#ancla) con el ancla al estilo GitHub', o.seccion === 'Texto con una [palabra clave](#introducción) acá.', o.seccion],
  ['otro archivo: lista la carpeta con subcarpetas, sin el propio, y no lee ninguno hasta que se pide', J(o.archivos) === J(['otro archivo.md', 'rotos.md', 'tercero.mdsub']) && o.sinLeer === 0 && J(o.archivosFiltrados) === J(['otro archivo.md']), [o.archivos, o.sinLeer, o.archivosFiltrados]],
  ['sin texto elegido el enlace lleva el nombre del archivo, y la ruta va con los espacios codificados', o.archivo === 'Primer párrafo. Ver [otro archivo](otro%20archivo.md)', o.archivo],
  ['desplegar un archivo muestra sus títulos y enlaza a esa sección', J(o.titulosAjenos) === J(['Otro', 'Sección Única']) && o.seccionAjena === 'Detalle del paso. [Sección Única](otro%20archivo.md#sección-única)', [o.titulosAjenos, o.seccionAjena]],
  ['dirección web: rechaza lo que no es una dirección y completa el https', o.sinLista === true && /no sirve/.test(o.rechazo || '') && /^\[Segundo\]\(https:\/\/example\.com\/una%20pagina\) párrafo/.test(o.web || ''), [o.sinLista, o.rechazo, o.web]],
  ['desde el menú de bloques el enlace va en un renglón propio', J(o.menu) === J(['Párrafo para el menú.', '', '[Cómo se usa](#cómo-se-usa)', '']), o.menu],
  ['marcar en el documento: se ve que se está eligiendo y Escape cancela sin salir de edición', o.marcando && J(o.marcando) === J([true, false, 'pointer', '0.4']) && J(o.cancelado.slice(0, 3)) === J([false, false, true]) && /Ir a/.test(o.cancelado[3]), [o.marcando, o.cancelado]],
  ['marcar en el documento: solo un título elige el destino', o.sigueMarcando === true && o.marcado === 'Párrafo para marcar. Ir a [Paso uno](#paso-uno)', [o.sigueMarcando, o.marcado]],
  ['con el cursor sobre un enlace la barra ofrece editarlo, con el destino actual cargado', J(o.barraEnlace) === J(['Editar el enlace']) && J(o.editar) === J(['Editar el enlace', 'https://example.com', 'web', 'https://example.com', true]), [o.barraEnlace, o.editar]],
  ['cambiar el destino y quitar el enlace', /\[viejo\]\(#introducción\) enlace/.test(o.cambiado || '') && J(o.editarSeccion) === J(['#introducción', 'Introducción']) && /párrafo con un viejo enlace\.$/.test(o.quitado || ''), [o.cambiado, o.editarSeccion, o.quitado]],
  ['"[[" despliega los archivos y "[[archivo#" sus títulos; Enter completa sin abrir un bloque', J(o.wikiLista) === J(['tercero']) && o.wikiSinBloque === true && J(o.wikiTitulos) === J(['Sección Única']) && o.wikiNada === true && /acá\. \[\[tercero\]\] y \[\[otro archivo#Sección Única\]\]$/.test((o.wiki || '').trim()), [o.wikiLista, o.wikiSinBloque, o.wikiTitulos, o.wikiNada, o.wiki]],
  ['los enlaces wiki recién puestos ya apuntan a su archivo y su sección', !!o.wikiDestinos && o.wikiDestinos.length === 2 && /\/sub\/tercero\.md$/.test(o.wikiDestinos[0]) && /\/otro archivo\.md#seccion-unica$/.test(o.wikiDestinos[1]), o.wikiDestinos],
  ['en todo el flujo no se abre ningún cuadro del navegador', J(o.nativos) === '[]', o.nativos],
  ['lo guardado en el disco es lo que se ve en el código', !!o.disco && o.disco === o.fuente],
  ['editando, el clic no sigue el enlace y Ctrl+clic abre el otro archivo en su sección', o.clicEditando === 'guia.md' && o.ctrlClic && o.ctrlClic[0].doc === 'otro archivo.md' && o.ctrlClic[0].y > 300 && cerca(o.ctrlClic[1]), [o.clicEditando, o.ctrlClic]],
  ['leyendo, un enlace a ../archivo.md#sección con acentos llega al título', o.haciaArriba && o.haciaArriba[0].doc === 'guia.md' && cerca(o.haciaArriba[1]), o.haciaArriba],
  ['dentro del documento el ancla con acentos baja al título', o.mismoDoc && cerca(o.mismoDoc[0]) && o.mismoDoc[1] === 'introduccion', o.mismoDoc],
  ['[[archivo#Sección]] abre el archivo en esa sección', o.wikiNavega && o.wikiNavega[0].doc === 'otro archivo.md' && cerca(o.wikiNavega[1]), o.wikiNavega],
  ['un archivo que no existe avisa y no saca del documento', o.sinArchivo && o.sinArchivo.doc === 'rotos.md' && o.sinArchivo.aviso === 'No se encontró "nada.md".' && /lmd-error/.test(o.sinArchivo.error), o.sinArchivo],
  ['una sección que no existe avisa, acá y al llegar a otro archivo', o.sinSeccion && o.sinSeccion.aviso === 'No se encontró la sección "no-existe".' && o.sinSeccionAjena && o.sinSeccionAjena.doc === 'otro archivo.md' && o.sinSeccionAjena.aviso === 'No se encontró la sección "tampoco".', [o.sinSeccion, o.sinSeccionAjena]],
  ['notas del navegador: lista las otras notas, navega a la sección y avisa si falta', J(o.localArchivos) === J(['dos.md']) && o.local && o.local[0].doc === 'dos.md' && cerca(o.local[1]) && o.localRoto.doc === 'uno.md' && o.localRoto.aviso === 'No se encontró "tres.md".', [o.localArchivos, o.local, o.localRoto]],
  ['nube: el selector lista las notas con su carpeta y escribe la ruta relativa', J(o.nubeArchivos) === J(['dos.md|proyecto/notas']) && /\[La sección ñ\]\(notas\/dos\.md#la-sección-ñ\)$/.test(o.nubeEnlace || ''), [o.nubeArchivos, o.nubeEnlace]],
  ['nube: navega a la sección de otra nota y avisa si la nota no existe', o.nube && o.nube[0].doc === 'dos.md' && cerca(o.nube[1]) && o.nubeRoto.doc === 'uno.md' && o.nubeRoto.aviso === 'No se encontró "tres.md".', [o.nube, o.nubeRoto]],
  ['sin errores', errors.length === 0 && !o.excepcion, [errors, o.excepcion]],
];
console.log('Enlaces internos');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
