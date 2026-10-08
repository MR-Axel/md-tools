// La herramienta JSON y YAML (Ajustes > Herramientas, apagada de entrada): un bloque json, jsonc, yaml o yml y un
// archivo .json, .yaml o .yml se ven como un árbol plegable que se edita, y lo editado reescribe solo ese bloque.
// También abrir, editar y guardar un .txt como texto plano, que no depende de la herramienta.
//   BROWSER=firefox node jsonyaml.mjs      BROWSER=webkit node jsonyaml.mjs      (sin BROWSER: chromium)
//   ONLY=yaml node jsonyaml.mjs            (una parte: off, tree, edit, yaml, bad, big, keys, xss, file, shared, phone, themes, model, txt)
import { rig, tally, sleep } from './rig.mjs';
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';

const ENGINE = process.env.BROWSER || 'chromium';
const ONLY = process.env.ONLY || '';
const R = await rig({}, ENGINE);
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(o.who || null, o.ctx);
  await page.addInitScript(([base, lang, tools]) => { try { if (localStorage.getItem('jy:listo')) return; localStorage.setItem('jy:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}]);
  return { ctx, page };
}
// Una carpeta del disco necesita un perfil de verdad: un Chromium con el suyo. Quien la usa lo borra al cerrar.
async function openProfile(tools) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdjy-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
  await page.addInitScript(([base, t]) => { try { if (localStorage.getItem('jy:listo')) return; localStorage.setItem('jy:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: 'en', tools: t })); } catch (e) { /* página en blanco */ } }, [R.base, tools]);
  return { ctx, page, profile };
}
const dropProfile = async (ctx, profile) => { await ctx.close(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ } };
const ON = { tools: { jsonyaml: true } };
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: ENGINE !== 'firefox' };
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
const goHome = async (page) => { await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250); };
const put = (page, name, text) => page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
async function note(page, name, text) {
  await goHome(page); await put(page, name, text);
  await page.goto(noteUrl(name)); await page.waitForSelector('.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
const scripts = (page, file) => page.evaluate((f) => [...document.scripts].filter((s) => s.src.split('/').pop() === f).length, file);
const flashText = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const toolsTab = async (page) => { await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); };
const closePanel = async (page) => { await page.click('[data-act=close-panel]'); await sleep(200); };
const flip = async (page, id) => { await page.click('.lmd-tl-card[data-tool=' + id + '] .lmd-switch'); await sleep(350); };
const tree = (page) => page.waitForSelector('.lmd-jy-tree li[role=treeitem]');
const li = (p) => '.lmd-jy-tree li[data-path="' + p + '"]';
// Los renglones a la vista: [ruta, nivel, abierto, clave, valor, clase del valor].
const rows = (page, n) => page.evaluate((k) => [...document.querySelectorAll('.lmd-jy')[k || 0].querySelectorAll('li[role=treeitem]')].map((l) => { const r = l.firstElementChild; const q = (s) => r.querySelector(':scope > ' + s); const v = q('.lmd-jy-v'); return [l.dataset.path, l.getAttribute('aria-level'), l.getAttribute('aria-expanded'), (q('.lmd-jy-k') || q('.lmd-jy-i') || {}).textContent || '', (v || q('.lmd-jy-n')).textContent, v ? v.className.replace('lmd-jy-v lmd-jy-', '') : '']; }), n);
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset && a.dataset.path) || a.className || a.tagName : ''; });
const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-jy-menu button')].map((b) => b.textContent));
const openMenu = async (page, p) => { await page.click(li(p) + ' > .lmd-jy-row > .lmd-jy-more'); await page.waitForSelector('.lmd-jy-menu'); };
const pick = async (page, p, label) => { await openMenu(page, p); await page.click('.lmd-jy-menu button:text-is("' + label + '")'); };
const clip = async (page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
const preShown = (page, n) => page.evaluate((k) => { const pre = document.querySelectorAll('.lmd-article .lmd-code')[k || 0].querySelector('pre'); return getComputedStyle(pre).display !== 'none'; }, n);
const fence = (lang, body) => ['# Config', '', 'Before.', '', '```' + lang, body, '```', '', 'After.', ''].join('\n');
const blockOf = (text) => { const m = /```\w+\n([\s\S]*?)\n```/.exec(text); return m ? m[1] : null; };

const RAW = '{"name":"demo","n":1.0,"on":true,"none":null,"list":[1,2,{"deep":"x"}],"obj":{"a":"b"}}';
const NOTE = fence('json', RAW);
const pretty = (name, n, on, none, list, obj) => '{\n  ' + name + ',\n  "n": ' + n + ',\n  "on": ' + on + ',\n  "none": ' + none + ',\n  "list": ' + list + ',\n  "obj": ' + obj + '\n}';
const LIST = '[\n    1,\n    2,\n    {\n      "deep": "x"\n    }\n  ]'; const OBJ = '{\n    "a": "b"\n  }';

// ---------- Apagada no cambia nada ----------
await step('off', 'Apagada: el bloque de siempre', async () => {
  const { ctx, page } = await open();
  await note(page, 'c.md', NOTE);
  check('apagada: sin árbol, sin archivo cargado, el bloque de código a la vista', await page.evaluate(() => !document.querySelector('.lmd-jy') && !LMD.jsonyaml) && await scripts(page, 'jsonyaml.js') === 0 && await preShown(page));
  const before = await page.evaluate(() => document.querySelector('.lmd-article').innerHTML);
  await toolsTab(page);
  const card = await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=jsonyaml]'); return c ? { name: c.querySelector('b').textContent, on: c.querySelector('input').checked, icon: !!c.querySelector('.lmd-tl-ico svg') } : null; });
  check('su tarjeta está en Herramientas, apagada', J(card) === J({ name: 'JSON and YAML', on: false, icon: true }), card);
  await flip(page, 'jsonyaml'); await until(() => page.evaluate(() => !!LMD.jsonyaml));
  check('prenderla pide su archivo y queda guardado', await scripts(page, 'jsonyaml.js') === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('mdtools:settings')).tools.jsonyaml)) === true);
  await page.click('.lmd-tl-card[data-tool=jsonyaml] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=jsonyaml] .lmd-tl-opts input');
  const texts = await page.evaluate(() => document.querySelector('.lmd-tl-card[data-tool=jsonyaml]').textContent);
  check('sus textos no llevan signos de admiración ni rayas', !/[!¡—–]/.test(texts) && /Start with everything collapsed/.test(texts), texts);
  await closePanel(page); await tree(page);
  check('prendida: el bloque pasa a ser un árbol y el texto queda escondido, no borrado', !(await preShown(page)) && await page.evaluate((raw) => document.querySelector('.lmd-code pre code').textContent === raw + '\n', RAW));
  check('la nota no cambió por prenderla', await saved(page, 'c.md') === NOTE);
  await toolsTab(page); await flip(page, 'jsonyaml'); await closePanel(page);
  check('apagarla deja la nota como estaba', await page.evaluate(() => !document.querySelector('.lmd-jy')) && await preShown(page) && await page.evaluate(() => document.querySelector('.lmd-article').innerHTML) === before && await saved(page, 'c.md') === NOTE);
  await ctx.close();
});

// ---------- El árbol ----------
await step('tree', 'Árbol: claves, tipos, plegado, vistas y copiar', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'c.md', NOTE); await tree(page);
  const aria = await page.evaluate(() => { const t = document.querySelector('.lmd-jy-tree'); return [t.getAttribute('role'), t.getAttribute('aria-label'), t.querySelectorAll('li[tabindex="0"]').length, [...t.querySelectorAll('ul')].every((u) => u.getAttribute('role') === 'group'), document.querySelector('.lmd-jy-lang').textContent]; });
  check('es un árbol para los lectores de pantalla, con un solo renglón en el orden de tabulación', J(aria) === J(['tree', 'JSON tree', 1, true, 'JSON']), aria);
  let r = await rows(page);
  check('la raíz y el primer nivel abiertos, con las claves en su orden', J(r.map((x) => x[3])) === J(['', 'name', 'n', 'on', 'none', 'list', 'obj']) && J(r.map((x) => x[1])) === J(['1', '2', '2', '2', '2', '2', '2']) && r[0][2] === 'true', r);
  check('cada valor con su tipo, y el número como estaba escrito', J(r.slice(1, 5).map((x) => [x[4], x[5]])) === J([['"demo"', 'string'], ['1.0', 'number'], ['true', 'boolean'], ['null', 'null']]), r.slice(1, 5));
  check('lo plegado dice cuántos elementos tiene', r[0][4] === '{6}' && J(r.slice(5).map((x) => [x[2], x[4]])) === J([['false', '[3]'], ['false', '{1}']]), r);
  const colors = await page.evaluate(() => ['string', 'number', 'boolean', 'null'].map((t) => getComputedStyle(document.querySelector('.lmd-jy-' + t)).color).concat(getComputedStyle(document.querySelector('.lmd-jy-k')).color));
  check('cada tipo tiene su color', new Set(colors).size === 5, colors);
  await page.click(li('r.4') + ' > .lmd-jy-row > .lmd-jy-tw');
  r = await rows(page);
  check('un clic en la flecha despliega ese nodo', r.find((x) => x[0] === 'r.4')[2] === 'true' && J(r.filter((x) => x[0].startsWith('r.4.')).map((x) => [x[3], x[4], x[1]])) === J([['0', '1', '3'], ['1', '2', '3'], ['2', '{1}', '3']]), r);
  await page.click(li('r.4') + ' > .lmd-jy-row > .lmd-jy-k');
  check('y otro en la clave lo pliega', (await rows(page)).length === 7);
  await page.click('.lmd-jy [data-jy=shut]');
  r = await rows(page); check('plegar todo deja solo la raíz', r.length === 1 && r[0][2] === 'false', r);
  await page.click('.lmd-jy [data-jy=open]');
  r = await rows(page); check('desplegar todo muestra los doce nodos', r.length === 12 && r.every((x) => x[2] !== 'false') && r.some((x) => x[0] === 'r.4.2.0' && x[4] === '"x"'), r.length);
  await page.click('.lmd-jy [data-jy=view]');
  check('la vista de texto muestra el bloque de código y esconde el árbol', await preShown(page) && await page.evaluate(() => document.querySelector('.lmd-jy-tree').hidden && document.querySelector('.lmd-jy [data-jy=view]').textContent === 'Tree' && document.querySelector('.lmd-jy [data-jy=open]').hidden));
  await page.click('.lmd-jy [data-jy=view]');
  check('y se vuelve al árbol como estaba', !(await preShown(page)) && (await rows(page)).length === 12);
  if (ENGINE === 'chromium') {
    await page.click('.lmd-jy [data-jy=copy]'); check('copiar copia el bloque entero', await clip(page) === RAW, await clip(page));
    await openMenu(page, 'r.4.2.0');
    check('el menú de un renglón es un menú, con el foco en su primera opción', await page.evaluate(() => { const m = document.querySelector('.lmd-jy-menu'); return m.getAttribute('role') === 'menu' && document.activeElement === m.querySelector('button') && [...m.querySelectorAll('button')].every((b) => /^menuitem/.test(b.getAttribute('role'))); }));
    await page.click('.lmd-jy-menu button:text-is("Copy path")'); check('copiar la ruta de un nodo', await clip(page) === '$.list[2].deep', await clip(page));
    await pick(page, 'r.0', 'Copy value'); check('copiar el valor de un texto, sin comillas', await clip(page) === 'demo', await clip(page));
    await pick(page, 'r.5', 'Copy value'); check('copiar el valor de un objeto', await clip(page) === '{\n  "a": "b"\n}', await clip(page));
    await openMenu(page, 'r.1'); await page.keyboard.press('Escape');
    check('Escape cierra el menú y devuelve el foco al renglón', await page.evaluate(() => !document.querySelector('.lmd-jy-menu')) && await active(page) === 'r.1', await active(page));
  }
  check('nada de esto tocó la nota', await saved(page, 'c.md') === NOTE);
  await ctx.close();
});

// ---------- Editar ----------
await step('edit', 'Edición: valor, clave, tipo, agregar y borrar', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'c.md', NOTE); await tree(page);
  const now = () => saved(page, 'c.md');
  const want = (block) => fence('json', block);
  await page.click(li('r.0') + ' .lmd-jy-v'); await page.waitForSelector('.lmd-jy-in');
  check('un clic en el valor lo deja editar en su lugar, con el texto sin comillas', await page.evaluate(() => { const i = document.querySelector('.lmd-jy-in'); return i.value === 'demo' && document.activeElement === i && !!i.getAttribute('aria-label'); }));
  await page.fill('.lmd-jy-in', 'changed "x"'); await page.keyboard.press('Enter');
  let exp = want(pretty('"name": "changed \\"x\\""', '1.0', 'true', 'null', LIST, OBJ));
  await until(async () => (await now()) === exp);
  check('Enter reescribe solo ese bloque, con sangría de 2 espacios y el orden de las claves', (await now()) === exp, await now());
  check('y el foco vuelve a ese renglón', await active(page) === 'r.0', await active(page));
  await page.focus(li('r.0')); await page.keyboard.press('Control+z');
  await until(async () => (await now()) === NOTE);
  check('deshacer devuelve el bloque como estaba', (await now()) === NOTE && (await rows(page))[1][4] === '"demo"', await now());
  await page.focus(li('r.1')); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-jy-in');
  await page.fill('.lmd-jy-in', 'abc'); await page.keyboard.press('Enter'); await sleep(150);
  check('un número no acepta otra cosa y sigue en edición', /Not a number/.test(await flashText(page)) && await page.evaluate(() => !!document.querySelector('.lmd-jy-in')) && (await now()) === NOTE, await flashText(page));
  await page.fill('.lmd-jy-in', '2.50'); await page.keyboard.press('Enter');
  exp = want(pretty('"name": "demo"', '2.50', 'true', 'null', LIST, OBJ)); await until(async () => (await now()) === exp);
  check('el número queda como se escribió', (await now()) === exp, await now());
  await page.focus(li('r.0')); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-jy-in');
  await page.keyboard.type('zzz'); await page.keyboard.press('Escape'); await sleep(150);
  check('Escape cancela sin tocar la nota y deja el foco en el renglón', (await now()) === exp && await page.evaluate(() => !document.querySelector('.lmd-jy-in')) && await active(page) === 'r.0', await active(page));
  await page.focus(li('r.2')); await page.keyboard.press('Enter'); await page.waitForSelector('select.lmd-jy-in');
  await page.selectOption('select.lmd-jy-in', 'false');
  exp = want(pretty('"name": "demo"', '2.50', 'false', 'null', LIST, OBJ)); await until(async () => (await now()) === exp);
  check('un booleano se elige de una lista', (await now()) === exp, await now());
  await page.focus(li('r.0')); await page.keyboard.press('F2'); await page.waitForSelector('.lmd-jy-in');
  await page.fill('.lmd-jy-in', 'n'); await page.keyboard.press('Enter'); await sleep(150);
  check('una clave no puede repetirse', /That key already exists/.test(await flashText(page)) && (await now()) === exp && await page.evaluate(() => !!document.querySelector('.lmd-jy-in')));
  await page.fill('.lmd-jy-in', 'title'); await page.keyboard.press('Enter');
  exp = want(pretty('"title": "demo"', '2.50', 'false', 'null', LIST, OBJ)); await until(async () => (await now()) === exp);
  check('F2 cambia el nombre de la clave y la deja en su lugar', (await now()) === exp, await now());
  await page.dblclick(li('r.1') + ' .lmd-jy-k'); await page.waitForSelector('.lmd-jy-in');
  check('doble clic en la clave también, sin abrir el editor de código', await page.evaluate(() => document.querySelector('.lmd-jy-in').value === 'n' && !document.querySelector('.lmd-src')));
  await page.keyboard.press('Escape');
  await page.focus(li('r.5')); await page.keyboard.press('+'); await page.waitForSelector(li('r.5.1') + ' .lmd-jy-in');
  check('+ agrega una clave y la deja lista para nombrarla', await page.evaluate(() => document.querySelector('.lmd-jy-in').value === 'key'));
  await page.fill('.lmd-jy-in', 'extra'); await page.keyboard.press('Enter');
  const OBJ2 = '{\n    "a": "b",\n    "extra": ""\n  }';
  exp = want(pretty('"title": "demo"', '2.50', 'false', 'null', LIST, OBJ2)); await until(async () => (await now()) === exp);
  check('la clave nueva queda al final de su objeto', (await now()) === exp, await now());
  await pick(page, 'r.4', 'Add item'); await page.waitForSelector(li('r.4.3') + ' .lmd-jy-in');
  await page.fill('.lmd-jy-in', 'four'); await page.keyboard.press('Enter');
  const LIST2 = '[\n    1,\n    2,\n    {\n      "deep": "x"\n    },\n    "four"\n  ]';
  exp = want(pretty('"title": "demo"', '2.50', 'false', 'null', LIST2, OBJ2)); await until(async () => (await now()) === exp);
  check('agregar un elemento a una lista desde el menú', (await now()) === exp, await now());
  await page.focus(li('r.4.0')); await page.keyboard.press('Delete');
  const LIST3 = '[\n    2,\n    {\n      "deep": "x"\n    },\n    "four"\n  ]';
  exp = want(pretty('"title": "demo"', '2.50', 'false', 'null', LIST3, OBJ2)); await until(async () => (await now()) === exp);
  check('Supr borra el nodo y el foco pasa al que sigue', (await now()) === exp && await active(page) === 'r.4.0', [await active(page), await now()]);
  await openMenu(page, 'r.3');
  check('el menú marca el tipo que tiene', await page.evaluate(() => { const on = [...document.querySelectorAll('.lmd-jy-menu [role=menuitemradio]')].filter((b) => b.getAttribute('aria-checked') === 'true'); return on.length === 1 && on[0].textContent === 'Null'; }));
  await page.click('.lmd-jy-menu button:text-is("Number")'); await page.waitForSelector(li('r.3') + ' .lmd-jy-in'); await page.keyboard.press('Escape');
  exp = want(pretty('"title": "demo"', '2.50', 'false', '0', LIST3, OBJ2)); await until(async () => (await now()) === exp);
  check('cambiar el tipo de null a número', (await now()) === exp, await now());
  await pick(page, 'r.0', 'Boolean');
  exp = want(pretty('"title": false', '2.50', 'false', '0', LIST3, OBJ2)); await until(async () => (await now()) === exp);
  check('y de texto a booleano', (await now()) === exp, await now());
  await pick(page, 'r.5', 'List');
  await page.waitForSelector('.lmd-ask-card [data-dlg=ok]');
  check('cambiar el tipo de algo con contenido pide confirmar', (await now()) === exp);
  await page.click('.lmd-ask-card [data-dlg=ok]');
  exp = want(pretty('"title": false', '2.50', 'false', '0', LIST3, '[\n    "b",\n    ""\n  ]')); await until(async () => (await now()) === exp);
  check('un objeto pasa a lista con sus valores', (await now()) === exp, await now());
  check('lo de afuera del bloque no cambió nunca', (await now()).startsWith('# Config\n\nBefore.\n\n```json\n') && (await now()).endsWith('\n```\n\nAfter.\n'));
  await page.reload(); await tree(page);
  check('tras recargar, la nota guardada se lee igual', (await now()) === exp && (await rows(page))[1][4] === 'false');
  await ctx.close();
});

// ---------- YAML ----------
const YAML = ['# top comment', 'name: demo # trailing', 'count: 3', '', '# before tags', 'tags:', '  - a', '  - b', 'nested:', '  key: "quoted: value"', '  text: |', '    line one', '    line two', '  empty:', "  single: 'it''s'"].join('\n');
await step('yaml', 'YAML: ida y vuelta, comentarios y solo lectura', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'y.md', fence('yaml', YAML)); await tree(page);
  const now = async () => blockOf(await saved(page, 'y.md'));
  let r = await rows(page);
  check('el YAML se ve como árbol, con sus tipos', J(r.map((x) => [x[3], x[4], x[5]])) === J([['', '{4}', ''], ['name', '"demo"', 'string'], ['count', '3', 'number'], ['tags', '[2]', ''], ['nested', '{4}', '']]) && await page.evaluate(() => document.querySelector('.lmd-jy-lang').textContent === 'YAML' && !document.querySelector('.lmd-jy-note')), r);
  await page.click(li('r.3') + ' > .lmd-jy-row > .lmd-jy-tw');
  r = await rows(page);
  check('bloques |, comillas y valores vacíos', J(r.filter((x) => x[0].startsWith('r.3.')).map((x) => [x[3], x[4], x[5]])) === J([['key', '"quoted: value"', 'string'], ['text', '"line one\nline two\n"', 'string'], ['empty', 'null', 'null'], ['single', '"it\'s"', 'string']]), r);
  await page.focus(li('r.1')); await page.keyboard.press('Enter'); await page.fill('.lmd-jy-in', '4'); await page.keyboard.press('Enter');
  await until(async () => (await now()) === YAML.replace('count: 3', 'count: 4'));
  check('editar un valor cambia solo ese renglón: comentarios, líneas vacías y comillas quedan igual', (await now()) === YAML.replace('count: 3', 'count: 4'), await now());
  await page.focus(li('r.0')); await page.keyboard.press('Enter'); await page.fill('.lmd-jy-in', 'yes'); await page.keyboard.press('Enter');
  let exp = YAML.replace('count: 3', 'count: 4').replace('name: demo # trailing', 'name: "yes" # trailing');
  await until(async () => (await now()) === exp);
  check('un texto que se leería como otra cosa sale entre comillas, con su comentario', (await now()) === exp, await now());
  await page.focus(li('r.2')); await page.keyboard.press('+'); await page.waitForSelector(li('r.2.2') + ' .lmd-jy-in'); await page.fill('.lmd-jy-in', 'c: d'); await page.keyboard.press('Enter');
  exp = exp.replace('  - b\n', '  - b\n  - "c: d"\n'); await until(async () => (await now()) === exp);
  check('agregar a una lista', (await now()) === exp, await now());
  await page.focus(li('r.3.1')); await page.keyboard.press('Enter'); await page.waitForSelector('textarea.lmd-jy-in');
  await page.fill('textarea.lmd-jy-in', 'uno\n  dos\n'); await page.keyboard.press('Control+Enter');
  exp = exp.replace('    line one\n    line two', '    uno\n      dos'); await until(async () => (await now()) === exp);
  check('un texto de varias líneas se edita en un cuadro y sigue como bloque', (await now()) === exp, await now());
  await page.focus(li('r.3.0')); await page.keyboard.press('F2'); await page.fill('.lmd-jy-in', 'on'); await page.keyboard.press('Enter');
  exp = exp.replace('  key: "quoted: value"', '  "on": "quoted: value"'); await until(async () => (await now()) === exp);
  check('una clave nueva que se leería como booleano sale entre comillas', (await now()) === exp, await now());
  await page.focus(li('r.3.2')); await page.keyboard.press('Delete');
  exp = exp.replace('  empty:\n', ''); await until(async () => (await now()) === exp);
  check('borrar una clave', (await now()) === exp, await now());
  check('y la nota de afuera sigue igual', (await saved(page, 'y.md')) === fence('yaml', exp));

  // Solo lectura: lo que la reescritura no puede devolver igual.
  const RO = [
    ['yml', 'base: &b {x: 1}\nuse: *b', 'Read only: it uses anchors or aliases. Edit in the text view.'],
    ['yaml', 'a: !!str 1', 'Read only: it uses tags. Edit in the text view.'],
    ['yaml', 'a: 1\n---\nb: 2', 'Read only: it uses several documents or directives. Edit in the text view.'],
    ['yaml', 'a: [1, # one\n  2]', 'Read only: it has comments that would be lost. Edit in the text view.'],
    ['yaml', 'a: 1\na: 2', 'Read only: it has repeated keys. Edit in the text view.'],
    ['jsonc', '{\n  // a comment\n  "a": "// not one", /* b */ "c": [1, 2,],\n}', 'Read only: it has comments that would be lost. Edit in the text view.'],
    ['json', '{"a":1,"a":2}', 'Read only: it has repeated keys. Edit in the text view.'],
  ];
  const all = ['# RO', ''].concat(RO.flatMap((x) => ['```' + x[0], x[1], '```', ''])).concat(['- item', '', '  ```json', '  {"in": "list"}', '  ```', '', '```jsonc', '{"ok": [1, 2,],}', '```', '']).join('\n');
  await note(page, 'ro.md', all); await tree(page);
  const notes = await page.evaluate(() => [...document.querySelectorAll('.lmd-jy')].map((b) => (b.querySelector('.lmd-jy-note') || {}).textContent || ''));
  check('anclas, etiquetas, varios documentos, comentarios y claves repetidas: árbol en solo lectura con su aviso', J(notes.slice(0, 7)) === J(RO.map((x) => x[2])), notes);
  check('un bloque dentro de una lista también; un jsonc simple sí se edita', notes[7] === 'Read only: the block is inside a list or a quote. Edit in the text view.' && notes[8] === '', notes.slice(7));
  r = await rows(page, 0);
  check('el alias se muestra como alias', J(r.map((x) => [x[3], x[4], x[5]])) === J([['', '{2}', ''], ['base', '{1}', ''], ['use', '*b', 'alias']]), r);
  check('los documentos de un YAML con varios se ven como una lista', J((await rows(page, 2)).map((x) => x[4])) === J(['[2]', '{1}', '{1}']), await rows(page, 2));
  check('el jsonc lee bien una cadena que parece comentario', (await rows(page, 5)).some((x) => x[3] === 'a' && x[4] === '"// not one"'), await rows(page, 5));
  await page.click('.lmd-jy ' + 'li[data-path="r.1"] .lmd-jy-v'); await sleep(150);
  await page.focus('.lmd-jy li[data-path="r.1"]'); await page.keyboard.press('Enter'); await page.keyboard.press('F2'); await page.keyboard.press('Delete'); await page.keyboard.press('+'); await sleep(200);
  check('en solo lectura ni el clic ni las teclas editan', await page.evaluate(() => !document.querySelector('.lmd-jy-in')) && (await saved(page, 'ro.md')) === all);
  await page.click('.lmd-jy li[data-path="r.1"] > .lmd-jy-row > .lmd-jy-more'); await page.waitForSelector('.lmd-jy-menu');
  check('y su menú solo ofrece copiar', J(await menuItems(page)) === J(['Copy value', 'Copy path']), await menuItems(page));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.querySelectorAll('.lmd-jy')[8]; b.querySelector('[data-jy=open]').click(); b.querySelector('li[data-path="r.0.0"] .lmd-jy-v').click(); }); await page.waitForSelector('.lmd-jy-in');
  await page.fill('.lmd-jy-in', '7'); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'ro.md')).includes('    7,'));
  check('el jsonc sin comentarios se reescribe como JSON, y los demás bloques no se tocan', (await saved(page, 'ro.md')) === all.replace('{"ok": [1, 2,],}', '{\n  "ok": [\n    7,\n    2\n  ]\n}'), await saved(page, 'ro.md'));
  await ctx.close();
});

// ---------- Texto que no se puede leer ----------
await step('bad', 'Inválido: el bloque de código con su aviso', async () => {
  const { ctx, page } = await open(ON);
  const BAD = ['# Bad', '', '```json', '{', '  "a": 1,', '  "b": ', '}', '```', '', '```yaml', 'a:', '\tb: 1', '```', '', '```yaml', '? complex', ': value', '```', '', '```json', '', '```', '', '```yaml', 'ok: true', '```', ''].join('\n');
  await note(page, 'bad.md', BAD); await tree(page);
  const got = await page.evaluate(() => [...document.querySelectorAll('.lmd-article .lmd-code')].map((w) => { const b = w.querySelector('.lmd-jy'); return [b ? (b.querySelector('.lmd-jy-note') || {}).textContent || '' : null, getComputedStyle(w.querySelector('pre')).display !== 'none', !!w.querySelector('.lmd-jy-tree'), b ? b.hidden : null]; }));
  check('JSON inválido: el bloque de código con la línea donde falla', J(got[0]) === J(['Invalid JSON on line 4.', true, false, false]), got[0]);
  check('YAML inválido, igual', J(got[1]) === J(['Invalid YAML on line 2.', true, false, false]), got[1]);
  check('un YAML que el árbol no lee lo dice', J(got[2]) === J(['The tree cannot read this YAML (line 1).', true, false, false]), got[2]);
  check('un bloque vacío queda como está, sin aviso', J(got[3]) === J(['', true, false, true]), got[3]);
  check('y el que está bien sí es un árbol', got[4][2] === true && got[4][1] === false, got[4]);
  check('el aviso se anuncia y la nota no se tocó', await page.evaluate(() => document.querySelector('.lmd-jy-bad .lmd-jy-note').getAttribute('role') === 'status') && (await saved(page, 'bad.md')) === BAD);
  await ctx.close();
});

// ---------- Tamaño ----------
await step('big', 'Grande: plegado y sin edición', async () => {
  const { ctx, page } = await open(ON);
  const body = '[' + Array.from({ length: 20500 }, (_, k) => k).join(',') + ']';
  const t0 = Date.now();
  await note(page, 'big.md', fence('json', body)); await tree(page);
  const s = await page.evaluate(() => ({ rows: document.querySelectorAll('.lmd-jy li[role=treeitem]').length, open: document.querySelector('.lmd-jy li').getAttribute('aria-expanded'), note: document.querySelector('.lmd-jy-note').textContent, all: document.querySelector('.lmd-jy [data-jy=open]').disabled, n: document.querySelector('.lmd-jy-n').textContent }));
  check('más de 20.000 nodos: arranca plegado, lo dice, y no ofrece desplegar todo', J(s) === J({ rows: 1, open: 'false', note: 'Read only: it is very large.', all: true, n: '[20500]' }) && Date.now() - t0 < 15000, [s, Date.now() - t0]);
  await page.focus(li('r')); await page.keyboard.press('ArrowRight');
  check('al abrir un nodo enorme se dibuja de a tramos', await page.evaluate(() => document.querySelectorAll('.lmd-jy li[role=treeitem]').length === 201 && document.querySelector('.lmd-jy-rest button').textContent === 'Show 200 more'));
  await page.click('.lmd-jy-rest button');
  check('y se piden más', await page.evaluate(() => document.querySelectorAll('.lmd-jy li[role=treeitem]').length === 401));
  await page.click(li('r.3') + ' .lmd-jy-v'); await page.focus(li('r.3')); await page.keyboard.press('Enter'); await page.keyboard.press('Delete'); await sleep(200);
  check('no se edita', await page.evaluate(() => !document.querySelector('.lmd-jy-in')) && (await saved(page, 'big.md')) === fence('json', body));
  const lim = await page.evaluate(() => [LMD.jsonyaml.model.LIMIT_BYTES, LMD.jsonyaml.model.LIMIT_NODES, LMD.jsonyaml.model.read('json', '"' + 'x'.repeat(1000001) + '"').big, LMD.jsonyaml.model.read('json', '"' + 'x'.repeat(1000) + '"').big]);
  check('el límite es 1 MB o 20.000 nodos', J(lim) === J([1000000, 20000, true, false]), lim);
  await ctx.close();
});

// ---------- Teclado ----------
await step('keys', 'Teclado: flechas, plegar y editar', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'c.md', NOTE); await tree(page);
  const press = async (k) => { await page.keyboard.press(k); return active(page); };
  await page.focus(li('r'));
  check('abajo y arriba recorren los renglones a la vista', await press('ArrowDown') === 'r.0' && await press('ArrowDown') === 'r.1' && await press('ArrowUp') === 'r.0');
  check('Fin e Inicio van a las puntas', await press('End') === 'r.5' && await press('Home') === 'r');
  await page.focus(li('r.4'));
  const a = await press('ArrowRight'); const open1 = await page.evaluate(() => document.querySelector('li[data-path="r.4"]').getAttribute('aria-expanded'));
  check('derecha despliega y después entra al primer hijo', a === 'r.4' && open1 === 'true' && await press('ArrowRight') === 'r.4.0');
  check('izquierda sube al padre y después lo pliega', await press('ArrowLeft') === 'r.4' && await press('ArrowLeft') === 'r.4' && await page.evaluate(() => document.querySelector('li[data-path="r.4"]').getAttribute('aria-expanded') === 'false' && !document.querySelector('li[data-path="r.4.0"]')));
  await page.keyboard.press('Space');
  check('espacio y Enter pliegan y despliegan un objeto o una lista', await page.evaluate(() => document.querySelector('li[data-path="r.4"]').getAttribute('aria-expanded')) === 'true' && (await press('Enter')) === 'r.4' && await page.evaluate(() => document.querySelector('li[data-path="r.4"]').getAttribute('aria-expanded')) === 'false');
  check('el foco es uno solo: el renglón elegido', await page.evaluate(() => { const on = document.querySelectorAll('.lmd-jy-tree li[tabindex="0"]'); return on.length === 1 && on[0].dataset.path === 'r.4' && on[0].getAttribute('aria-selected') === 'true' && document.querySelectorAll('.lmd-jy-tree li[aria-selected="true"]').length === 1; }));
  await page.focus(li('r.0')); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-jy-in');
  await page.keyboard.type('x'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('?');
  check('mientras se escribe, las teclas son del campo', await page.evaluate(() => !!document.querySelector('.lmd-jy-in') && !document.querySelector('.lmd-keys, .lmd-keys-card')));
  await page.keyboard.press('Escape');
  check('Escape cancela', await page.evaluate(() => !document.querySelector('.lmd-jy-in')) && (await saved(page, 'c.md')) === NOTE && await active(page) === 'r.0');
  await page.focus(li('r.0')); await page.keyboard.press('Shift+F10'); await page.waitForSelector('.lmd-jy-menu');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  check('Mayús+F10 abre el menú y las flechas lo recorren', await page.evaluate(() => document.activeElement.textContent) === 'Edit value');
  await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-jy-in'); await page.keyboard.press('Escape');
  check('la raíz no se borra ni se renombra', await (async () => { await page.focus(li('r')); await page.keyboard.press('Delete'); await page.keyboard.press('F2'); await sleep(150); return (await saved(page, 'c.md')) === NOTE && await page.evaluate(() => !document.querySelector('.lmd-jy-in')); })());
  await ctx.close();
});

// ---------- Contenido hostil ----------
await step('xss', 'Claves y valores maliciosos se muestran como texto', async () => {
  const { ctx, page } = await open(ON);
  const K1 = '<img src=x onerror=window.__pwn=1>'; const K2 = 'a"><svg onload=window.__pwn=3>'; const V1 = '<script>window.__pwn=2</script>';
  const data = { [K1]: V1, [K2]: ['<b>bold</b>', 'javascript:alert(1)', '<iframe srcdoc="<script>parent.__pwn=5</script>">'], constructor: { prototype: 1 } };
  const json = JSON.stringify(data).replace(/^\{/, '{"__proto__":{"polluted":true},');
  const yaml = ['"' + K1.replace(/"/g, '\\"') + '": \'' + V1 + '\'', '? no', '__proto__:', '  polluted: true', '<b onmouseover=window.__pwn=6>k</b>: <a href="javascript:window.__pwn=7">x</a>'].filter((l) => l !== '? no').join('\n');
  await note(page, 'x.md', ['# X', '', '```json', json, '```', '', '```yaml', yaml, '```', ''].join('\n')); await tree(page);
  await page.evaluate(() => document.querySelectorAll('.lmd-jy [data-jy=open]').forEach((b) => b.click()));
  const safe = () => page.evaluate(() => ({ pwn: window.__pwn, polluted: ({}).polluted, bad: document.querySelectorAll('.lmd-jy img, .lmd-jy script, .lmd-jy iframe, .lmd-jy b, .lmd-jy a, .lmd-jy [onerror], .lmd-jy [onload], .lmd-jy [onmouseover], .lmd-jy-menu img, .lmd-jy-menu script').length, svg: [...document.querySelectorAll('.lmd-jy svg')].every((s) => s.closest('.lmd-jy-tw, .lmd-jy-more, .lmd-jy-btn')) }));
  check('nada se ejecuta ni se convierte en HTML', J(await safe()) === J({ bad: 0, svg: true }), await safe());
  const r = await rows(page, 0);
  check('las claves y los valores se leen tal cual', r.some((x) => x[3] === K1 && x[4] === '"' + V1 + '"') && r.some((x) => x[3] === K2) && r.some((x) => x[3] === '__proto__') && r.some((x) => x[4] === '"<b>bold</b>"'), r);
  const ry = await rows(page, 1);
  check('en YAML también', ry.some((x) => x[3] === K1 && x[4] === '"' + V1 + '"') && ry.some((x) => x[3] === '<b onmouseover=window.__pwn=6>k</b>' && x[4] === '"<a href="javascript:window.__pwn=7">x</a>"'), ry);
  const P = '"><img src=x onerror=window.__pwn=4>';
  await page.focus(li('r.1')); await page.keyboard.press('F2'); await page.waitForSelector('.lmd-jy-in'); await page.fill('.lmd-jy-in', P); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'x.md')).includes('onerror=window.__pwn=4'));
  await tree(page);
  await page.focus(li('r.1')); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-jy-in'); await page.fill('.lmd-jy-in', '</span><img src=x onerror=window.__pwn=8>'); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'x.md')).includes('__pwn=8'));
  await tree(page); await openMenu(page, 'r.1');
  check('editar con contenido hostil lo guarda como texto y sigue sin ejecutarse', J(await safe()) === J({ bad: 0, svg: true }) && JSON.parse(blockOf(await saved(page, 'x.md')))[P] === '</span><img src=x onerror=window.__pwn=8>', await safe());
  check('el JSON guardado sigue siendo JSON, con __proto__ como una clave más', /"__proto__": \{\n    "polluted": true\n  \}/.test(await saved(page, 'x.md')));
  const src = fs.readFileSync(new URL('../src/jsonyaml.js', import.meta.url), 'utf8');
  const html = [...src.matchAll(/innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(|new Function|setTimeout\(\s*['"`]/g)].map((m) => m[0]);
  check('el código no usa innerHTML, eval ni Function', html.length === 0, html);
  await ctx.close();
});

// ---------- Archivos sueltos ----------
await step('file', 'Un .json o un .yaml suelto: mismo árbol, y se guarda en su formato', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'data.json', '{"a":1,"b":[true]}\n'); await tree(page);
  check('un .json se abre como árbol', J((await rows(page)).map((x) => [x[3], x[4]])) === J([['', '{2}'], ['a', '1'], ['b', '[1]']]) && await page.evaluate(() => !document.querySelector('.lmd-jy-note')), await rows(page));
  await page.click(li('r.0') + ' .lmd-jy-v'); await page.waitForSelector('.lmd-jy-in'); await page.fill('.lmd-jy-in', '2'); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'data.json')).includes('"a": 2'));
  check('y se guarda como JSON, no como Markdown', (await saved(page, 'data.json')) === '{\n  "a": 2,\n  "b": [\n    true\n  ]\n}\n', await saved(page, 'data.json'));
  await page.focus(li('r.0')); await page.keyboard.press('Control+z'); await until(async () => (await saved(page, 'data.json')) === '{"a":1,"b":[true]}\n');
  check('deshacer devuelve el archivo como estaba', (await saved(page, 'data.json')) === '{"a":1,"b":[true]}\n', await saved(page, 'data.json'));
  const Y = '# conf\r\na: 1\r\nb:\r\n  - x\r\n';
  await note(page, 'conf.yml', Y); await tree(page);
  await page.click(li('r.0') + ' .lmd-jy-v'); await page.waitForSelector('.lmd-jy-in'); await page.fill('.lmd-jy-in', '5'); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'conf.yml')).includes('a: 5'));
  check('un .yml conserva sus saltos de línea, su comentario y su final', (await saved(page, 'conf.yml')) === Y.replace('a: 1', 'a: 5'), await saved(page, 'conf.yml'));
  await note(page, 'roto.yaml', 'a: [1, 2\n'); await page.waitForSelector('.lmd-jy-bad');
  check('un .yaml que no se lee queda como código, con el aviso', await preShown(page) && /Invalid YAML on line/.test(await page.evaluate(() => document.querySelector('.lmd-jy-note').textContent)));
  const off = await open();
  await note(off.page, 'data.json', '{"a":1}\n');
  check('con la herramienta apagada un .json se ve como código, como siempre', await off.page.evaluate(() => !document.querySelector('.lmd-jy') && document.querySelector('.lmd-code pre code').textContent === '{"a":1}\n'));
  await off.ctx.close(); await ctx.close();
});

// ---------- Nota compartida para ver ----------
await step('shared', 'Solo lectura: se ve y no se edita', async () => {
  const ana = await R.signup('ana-jy@example.com', true); const beto = await R.signup('beto-jy@example.com');
  await R.api('PUT', '/notes/cfg.md', { text: NOTE }, ana.s);
  await R.api('POST', '/shares', { path: 'cfg.md', email: beto.email, role: 'view' }, ana.s);
  const { ctx, page } = await open({ who: beto, tools: { jsonyaml: true } });
  await page.goto(R.noteUrl('~' + ana.id + '/cfg.md')); await tree(page);
  check('quien solo puede ver la nota ve el árbol, sin aviso', (await rows(page)).length === 7 && await page.evaluate(() => document.documentElement.classList.contains('lmd-readonly') && !document.querySelector('.lmd-jy-note')), await rows(page));
  await page.click(li('r.0') + ' .lmd-jy-v'); await page.focus(li('r.0')); await page.keyboard.press('Enter'); await page.keyboard.press('F2'); await page.keyboard.press('Delete'); await sleep(200);
  await openMenu(page, 'r.0');
  check('pero no puede editar nada', await page.evaluate(() => !document.querySelector('.lmd-jy-in')) && J(await menuItems(page)) === J(['Copy value', 'Copy path']) && (await R.api('GET', '/notes/cfg.md', undefined, ana.s)).json.text === NOTE, await menuItems(page));
  await ctx.close();
  const pages = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8');
  check('los sitios publicados no cargan el script del árbol', !/jsonyaml/.test(pages));
});

// ---------- Teléfono ----------
await step('phone', 'En un teléfono', async () => {
  const { ctx, page } = await open({ tools: { jsonyaml: true }, ctx: SMALL });
  await note(page, 'c.md', fence('json', JSON.stringify({ short: 1, 'a-very-long-key-name-that-keeps-going-and-going': 'a value that is long enough to need wrapping on a narrow screen, with no spaces:' + 'x'.repeat(80), list: [1, 2] }))); await tree(page);
  const m = await page.evaluate(() => { const b = document.querySelector('.lmd-jy').getBoundingClientRect(); const row = document.querySelector('.lmd-jy-row').getBoundingClientRect(); const more = document.querySelector('.lmd-jy-more').getBoundingClientRect(); return { fits: b.right <= innerWidth + 1 && b.left >= 0, page: document.scrollingElement.scrollWidth <= innerWidth + 1, inner: document.querySelector('.lmd-jy-tree').scrollWidth <= document.querySelector('.lmd-jy-tree').clientWidth + 1, row: row.height >= 36, more: more.width >= 36 && more.height >= 36 && more.right <= innerWidth }; });
  check('el árbol entra en la pantalla, los textos largos bajan de renglón y los botones se pueden tocar', J(m) === J({ fits: true, page: true, inner: true, row: true, more: true }), m);
  await page.tap(li('r.0') + ' .lmd-jy-v'); await page.waitForSelector('.lmd-jy-in');
  check('tocar un valor lo edita, sin que la pantalla haga zoom', await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.lmd-jy-in')).fontSize) >= 16 && document.querySelector('.lmd-jy-in').getBoundingClientRect().right <= innerWidth));
  await page.fill('.lmd-jy-in', '2'); await page.keyboard.press('Enter');
  await until(async () => (await saved(page, 'c.md')).includes('"short": 2'));
  check('y se guarda', (await saved(page, 'c.md')).includes('"short": 2'));
  await tree(page); await page.tap(li('r.2') + ' > .lmd-jy-row > .lmd-jy-more'); await page.waitForSelector('.lmd-jy-menu');
  check('el menú entra en la pantalla', await page.evaluate(() => { const r = document.querySelector('.lmd-jy-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
  await ctx.close();
});

// ---------- Temas ----------
await step('themes', 'Se lee en los doce temas', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'c.md', NOTE); await tree(page);
  const ids = await page.evaluate(() => LMD.theme.PRESETS.map((p) => p.id));
  const bad = [];
  for (const id of ids) {
    await page.evaluate((i) => LMD.patch(LMD.theme.patchFor(i)), id); await sleep(220);
    const c = await page.evaluate(() => {
      const probe = document.createElement('canvas').getContext('2d');
      const rgb = (v) => { probe.fillStyle = '#000'; probe.fillStyle = v; probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(rgb(a)); const y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const bg = getComputedStyle(document.querySelector('.lmd-jy')).backgroundColor;
      return ['k', 'string', 'number', 'boolean', 'null', 'n'].map((t) => [t, Math.round(ratio(getComputedStyle(document.querySelector('.lmd-jy-' + t)).color, bg) * 10) / 10]);
    });
    c.forEach((x) => { if (x[1] < 3) bad.push(id + ':' + x[0] + '=' + x[1]); });
  }
  check('hay doce temas y en todos las claves y los tipos contrastan con el fondo', ids.length >= 12 && bad.length === 0, [ids.length, bad]);
  await ctx.close();
});

// ---------- El lector y el escritor, sin interfaz ----------
await step('model', 'El modelo: ida y vuelta sin perder nada', async () => {
  const { ctx, page } = await open(ON);
  await note(page, 'c.md', NOTE); await tree(page);
  const out = await page.evaluate(() => {
    const m = LMD.jsonyaml.model; const res = {};
    const same = [
      'a: 1\nb: two\nc: true\nd: null\ne: ~\nf:',
      'a:\n  b:\n    c: 1\n  d: [1, 2, {x: y}]\nlist:\n  - 1\n  - two\n  - k: v\n    k2: v2\n  - - a\n    - b',
      'list:\n- a\n- b\nother: 1',
      'a: "x\\ny"\nb: \'it\'\'s\'\n"k k": 1',
      'a: |\n  uno\n  dos\nb: >-\n  uno\n  dos\n\n  tres\nc: |+\n  x\n\nd: 1',
      '# arriba\na: 1 # al lado\n\n# antes de b\nb:\n  # adentro\n  c: 2\nlist: # de la lista\n  - x # uno\n  # antes de y\n  - y\n# final',
      '# c\n---\na: 1',
      'a: uno\n  dos\n\n  tres\nb: "x\n  y"',
      'a: 1.0\nb: 0x1F\nc: 1e3\nd: .inf\nf: 010\ng: 12345678901234567890\nh: "1"\ni: yes',
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\n  labels: {app: web}\nspec:\n  containers:\n    - name: a\n      image: "nginx:1.2"\n      args: ["--x", "-y"]\n      env:\n        - name: K\n          value: "1"',
      'u: http://x.y/z?a=1#frag\nt: 12:30\np: C:\\dir',
    ];
    res.same = same.filter((t) => { const r = m.read('yaml', t + '\n'); return !(r.ok && !r.ro && m.write(r.doc) === t); });
    const J1 = '{"a":1.0,"b":[1,2,{"c":null}],"d":"x\\u00e9","e":12345678901234567890,"f":{},"g":[],"h":true,"i":-0.5e-3}';
    res.json = m.write(m.read('json', J1).doc);
    res.jsonAgain = m.write(m.read('json', res.json).doc) === res.json;
    res.line = m.read('json', '{\n  "a": 1,\n  "b": \n}').line;
    res.strict = [m.read('json', '[1,2,]').ok, m.read('json', '{"a":1}// c').ok, m.read('json', '01').ok, m.read('json', "{'a':1}").ok, m.read('jsonc', '[1,2,]').ok];
    res.deep = m.read('json', '['.repeat(5000) + ']'.repeat(5000)).ok;
    const strs = ['', ' ', 'true', 'null', '~', '1', '-', '- a', 'a: b', 'a #b', '#x', 'x\ny', 'x\n', '\nx', '  x\n y', 'a\n\n\nb\n\n', 'tab\there', '"q"', "'q'", '[a]', '{a}', 'a, b', '@x', '!x', '&x', '*x', '|', '>', 'é ñ', 'yes', 'No', '0x10', '2020-01-01', 'a:', ':a', '?', '---', '...', '```', '<<', 'line1\n  indented\nline3'];
    res.strs = [];
    strs.forEach((s) => [(v) => ({ t: 'object', entries: [{ k: 'a', v }] }), (v) => ({ t: 'array', items: [v] }), (v) => ({ t: 'object', entries: [{ k: s, v }] }), (v) => ({ t: 'array', flow: true, items: [v] })].forEach((mk) => {
      const root = mk({ t: 'string', v: s }); const w = m.writeYaml({ kind: 'yaml', root, step: 2 }); const r = m.read('yaml', w + '\n');
      if (!(r.ok && !r.ro && m.same(root, r.doc.root))) res.strs.push([s, w]);
    }));
    res.bad = [m.read('yaml', 'a:\n    b: 1\n  c: 2\n').ok, m.read('yaml', 'a: "x\n').ok, m.read('yaml', 'a: [1, 2\nb: 3\n').ok, m.read('yaml', 'a: b: c\n').ok];
    return res;
  });
  check('YAML: once documentos se reescriben idénticos, carácter por carácter', out.same.length === 0, out.same);
  check('JSON: sangría de 2, orden de claves, y los números como estaban escritos', out.json === '{\n  "a": 1.0,\n  "b": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "d": "xé",\n  "e": 12345678901234567890,\n  "f": {},\n  "g": [],\n  "h": true,\n  "i": -0.5e-3\n}' && out.jsonAgain, out.json);
  check('JSON es estricto, JSONC acepta la coma de más, y el error dice la línea', J(out.strict) === J([false, false, false, false, true]) && out.line === 4 && out.deep === false, [out.strict, out.line, out.deep]);
  check('YAML: cualquier texto que se escriba vuelve igual al leerlo', out.strs.length === 0, out.strs.slice(0, 5));
  check('YAML mal formado no se acepta', J(out.bad) === J([false, false, false, false]), out.bad);
  await ctx.close();
});

// ---------- Archivos .txt ----------
await step('txt', 'Un .txt: texto plano, se edita y se guarda como .txt', async () => {
  const TXT = '# not a title\r\n*not em* _nor this_ <b>x</b>\r\n\r\n- [ ] raw\r\n    four spaces\r\n';
  const { ctx, page } = await open(); // sin la herramienta: no depende de ella
  await note(page, 'lista.txt', TXT);
  const seen = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); const p = a.querySelector('.lmd-plain'); return { text: p ? p.textContent : null, md: a.querySelectorAll('h1, em, b, li, input, pre, code').length, wrap: p ? getComputedStyle(p).whiteSpace : '' }; });
  check('se muestra tal cual, sin interpretar Markdown ni HTML', J(seen) === J({ text: TXT.replace(/\r\n/g, '\n'), md: 0, wrap: 'pre-wrap' }), seen);
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('textarea.lmd-raw-edit:not([hidden])');
  check('se edita como texto', await page.evaluate(() => document.querySelector('textarea.lmd-raw-edit').value.replace(/\r\n/g, '\n')) === TXT.replace(/\r\n/g, '\n') && await page.evaluate(() => !document.querySelector('.lmd-article .lmd-editable')));
  await page.click('textarea.lmd-raw-edit'); await page.keyboard.press('Control+End'); await page.keyboard.type('## still text\n*end*');
  const NEW = TXT + '## still text\r\n*end*';
  await until(async () => (await saved(page, 'lista.txt')) === NEW);
  check('se guarda con su nombre, su contenido exacto y sus saltos de línea', (await saved(page, 'lista.txt')) === NEW && await page.evaluate(async () => (await LMD.store.notesAll()).map((n) => n.name).join()) === 'lista.txt', await saved(page, 'lista.txt'));
  await page.reload(); await page.waitForSelector('.lmd-article .lmd-plain, textarea.lmd-raw-edit:not([hidden])');
  check('y al volver sigue siendo texto plano', await page.evaluate(() => !document.querySelector('.lmd-article h2, .lmd-article em')));
  await ctx.close();

  if (ENGINE !== 'chromium') return;
  const d = await openProfile({});
  try {
    const p = d.page;
    await goHome(p);
    await p.evaluate(async (txt) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('papeles', { create: true });
      const write = async (dd, name, data) => { const h = await dd.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
      await write(dir, 'a.md', '# A\n'); await write(dir, 'b.txt', txt); await write(dir, 'c.json', '{"a":1}\n'); await write(dir, 'd.csv', 'a,b\n');
      const sub = await dir.getDirectoryHandle('sub', { create: true });
      await write(sub, 'e.md', '# E\n'); await write(sub, 'f.txt', 'f\n'); await write(sub, 'g.yaml', 'a: 1\n');
      window.showDirectoryPicker = async () => dir;
    }, TXT);
    await Promise.all([p.waitForNavigation(), p.click('[data-home=dir]')]); await p.waitForSelector('.lmd-article > *'); await sleep(600);
    const names = () => p.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=disk] .lmd-node')].map((n) => n.querySelector('.lmd-node-name').textContent));
    check('en la carpeta del disco el .txt aparece junto a los .md; lo demás sigue filtrado', J(await names()) === J(['sub', 'a.md', 'b.txt']), await names());
    await p.waitForFunction(() => { const c = document.querySelector('.lmd-xroot[data-root=disk] .lmd-node-dir .lmd-node-n'); return c && !c.hidden; }, null, { timeout: 8000 }).catch(() => {});
    const count = await p.evaluate(() => { const c = document.querySelector('.lmd-xroot[data-root=disk] .lmd-node-dir .lmd-node-n'); return c && !c.hidden ? c.dataset.n + '|' + c.getAttribute('aria-label') : ''; });
    check('el contador de la carpeta cuenta los .txt como notas, no los .yaml', count === '2|2 notes', count);
    await p.click('.lmd-xroot[data-root=disk] .lmd-node:has-text("b.txt")'); await p.waitForSelector('.lmd-article .lmd-plain');
    await p.click('[data-act=mode-edit]'); await p.waitForSelector('textarea.lmd-raw-edit:not([hidden])');
    await p.click('textarea.lmd-raw-edit'); await p.keyboard.press('Control+End'); await p.keyboard.type('saved to disk');
    await p.keyboard.press('Control+s');
    // Mientras se escribe, el archivo puede no estar un instante: se vuelve a mirar.
    const disk = () => p.evaluate(async () => { try { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('papeles'); const out = []; for await (const [n] of dir.entries()) out.push(n); return { names: out.sort(), text: await (await (await dir.getFileHandle('b.txt')).getFile()).text() }; } catch (e) { return { names: [], text: null }; } });
    await until(async () => (await disk()).text === TXT + 'saved to disk');
    const got = await disk();
    check('Ctrl+S lo guarda en el mismo .txt, con sus saltos de línea, sin crear un .md', got.text === TXT + 'saved to disk' && J(got.names) === J(['a.md', 'b.txt', 'c.json', 'd.csv', 'sub']), got);
    await toolsTab(p); await flip(p, 'jsonyaml'); await closePanel(p);
    await p.reload(); await p.waitForSelector('.lmd-xroot[data-root=disk] .lmd-node'); await sleep(600);
    check('con la herramienta prendida el explorador también muestra los .json', (await names()).includes('c.json') && !(await names()).includes('d.csv'), await names());
    await p.click('.lmd-xroot[data-root=disk] .lmd-node:has-text("c.json")'); await tree(p);
    await p.click(li('r.0') + ' .lmd-jy-v'); await p.waitForSelector('.lmd-jy-in'); await p.fill('.lmd-jy-in', '9'); await p.keyboard.press('Enter'); await sleep(200);
    await p.keyboard.press('Control+s');
    const j = () => p.evaluate(async () => { try { return await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('papeles')).getFileHandle('c.json')).getFile()).text(); } catch (e) { return null; } });
    await until(async () => (await j()) === '{\n  "a": 9\n}\n');
    check('un .json del disco se edita en el árbol y se guarda en el mismo archivo', (await j()) === '{\n  "a": 9\n}\n', await j());
  } finally { await dropProfile(d.ctx, d.profile); }
});

const relevant = R.errors.filter((e) => !/ResizeObserver/.test(e));
if (!ONLY) check('ninguna página tiró errores', relevant.length === 0, relevant.slice(0, 4));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
