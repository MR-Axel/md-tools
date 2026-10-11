// Editor de diagramas: errores explicados, piezas por tipo con identificadores sin repetir, plantillas aparte,
// idioma de plantillas y piezas, y colores que quedan escritos en el bloque.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const home = `chrome-extension://${id}/src/app.html`;
const DOC = '# Doc\n\nText.\n\n```mermaid\ngraph LR\n  A[Start] --> B[End]\n```\n\n```dot\ndigraph {\n  a -> b;\n}\n```\n\n```mermaid\ngraph LR\n  A[Start] --> B[End] extra\n```\n\n```dot\ngraph {\n  a -> b;\n}\n```\n\nEnd.\n';
const checks = []; const J = (v) => JSON.stringify(v);
const add = (name, ok, detail) => checks.push([name, !!ok, detail]);
const setLang = async (lang) => {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate((s) => new Promise((resolve) => chrome.storage.local.set({ settings: s }, resolve)), { language: lang, theme: 'dark', cloudUrl: 'off', updateCheck: 'off' });
  await app.goto(home); await app.waitForSelector('.lmd-home');
};
const openDoc = async () => {
  await app.evaluate(async (t) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('de', { create: true });
    const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable(); await s.write(t); await s.close();
    window.showDirectoryPicker = async () => dir;
  }, DOC);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.lmd-diagram svg'); await app.waitForSelector('.lmd-diagram-dot svg');
};
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const ta = '.lmd-dgm textarea';
const fill = async (text, wait) => { await app.fill(ta, text); await app.waitForTimeout(wait || 1100); };
const state = () => app.evaluate(() => {
  const t = document.querySelector('.lmd-dgm textarea'); const e = document.querySelector('.lmd-dgm-err');
  return { code: t.value, sel: t.value.slice(t.selectionStart, t.selectionEnd), at: t.selectionStart, err: e.hidden ? '' : e.querySelector('.lmd-err-main').textContent.trim(), hint: e.hidden || !e.querySelector('.lmd-err-hint') ? '' : e.querySelector('.lmd-err-hint').textContent.trim(),
    detail: e.hidden ? null : { open: e.querySelector('details').open, text: e.querySelector('details pre').textContent }, line: (document.querySelector('.lmd-ed-gutter .lmd-ed-bad') || {}).textContent || '', band: !document.querySelector('.lmd-ed-band').hidden,
    stale: document.querySelector('.lmd-dgm-svg').classList.contains('lmd-dgm-stale'), svg: !!document.querySelector('.lmd-dgm-svg svg'), label: document.querySelector('.lmd-dgm h3 small').textContent,
    pieces: [...document.querySelectorAll('.lmd-dgm-add [data-piece]')].map((b) => b.textContent), addHidden: document.querySelector('.lmd-dgm-add').hidden };
});
// Las líneas de un texto que no son la directiva de colores.
const SPANISH = /[áéíóúñ¿]|\b(Inicio|Fin|Seguir|Corregir|Usuario|Servidor|Borrador|Publicado|Pedido|Cliente|CLIENTE|PEDIDO|hace|contiene|nombre|Paso|Pregunta|Mensaje|Respuesta|Nota|Estado|Clase|atributo|metodo|usa|ENTIDAD|tiene|Tarea|Hito|Idea nueva|Detalle|Evento|Nodo|texto|Cada vez|Reparto|Historia|Lanzamiento|Tema)\b/;

try {
  await setLang('en'); await openDoc();
  // ---------- En el documento: un diagrama que no se puede dibujar dice qué pasa, corto ----------
  await app.waitForFunction(() => document.querySelectorAll('.lmd-mermaid-error .lmd-err-note').length === 2);
  const fails = await app.evaluate(() => [...document.querySelectorAll('.lmd-mermaid-error')].map((n) => ({ kind: n.dataset.kind, main: n.querySelector('.lmd-err-main').textContent.trim(), hint: (n.querySelector('.lmd-err-hint') || {}).textContent || '', open: n.querySelector('details').open, raw: n.querySelector('details pre').textContent, title: n.getAttribute('title'), code: n.dataset.code })));
  add('documento: un Mermaid que falla muestra el aviso corto y la línea', fails[0] && /could not be drawn/.test(fails[0].main) && /Line 2/.test(fails[0].main) && /extra text after B\[End\]/.test(fails[0].main) && !fails[0].title, fails[0]);
  add('documento: el volcado del parser queda detrás de "Ver detalle"', fails[0] && !fails[0].open && /Parse error on line 2/.test(fails[0].raw) && !/Expecting|NODE_STRING/.test(fails[0].main + fails[0].hint), fails[0]);
  add('documento: un Graphviz que falla también', fails[1] && fails[1].kind === 'dot' && /Line 2/.test(fails[1].main) && /joined with --/.test(fails[1].main) && /syntax error/.test(fails[1].raw), fails[1]);

  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await app.click('.lmd-diagram >> nth=0'); await app.waitForSelector('.lmd-dgm-svg svg');
  let s = await state();
  add('el editor dice el tipo y muestra las piezas de flujo', s.label === 'Mermaid · Flowchart' && J(s.pieces) === J(['Step', 'Question', 'Arrow', 'Arrow with a label', 'Color one node']) && !s.addHidden, [s.label, s.pieces]);
  add('las plantillas están en un desplegable aparte, cerrado', await app.evaluate(() => document.querySelector('.lmd-dgm-tpls').hidden && !document.querySelector('.lmd-dgm-add [data-tpl]') && document.querySelectorAll('.lmd-dgm-tpls [data-tpl]').length === 11));

  // ---------- Errores ----------
  const cases = [
    ['graph LR\n  A[Start] --> B[End] extra\n  B --> C', '2', /extra text after B\[End\]/, /Delete extra/],
    ['graph LR\n  A[Start --> B', '2', /bracket is not closed/, /A\[Text\]/],
    ['graph LR\n  A --> B\n  B --> ', '3', /arrow has no target/, /B --> B/],
    ['graph LR\n  A B', '2', /needs an arrow/, /A --> B/],
    ["%%{init: {'theme':'base'}}%%\ngraph LR\n  %% note\n  A --> B\n  A B", '5', /needs an arrow/, /A --> B/],
    ['hello\n  A --> B', '1', /type is not recognized/, /graph TD/],
    ['sequenceDiagram\n  A->>B hello', '2', /message has no text/, /A->>B: Message/],
    ['sequenceDiagram\n  A->>B: hi\n  loop x\n  A->>B: y', '3', /never closed/, /end/],
    ['stateDiagram-v2\n  [*] --> A\n  A -> B', '3', /written with -->/, /A --> B/],
    ['classDiagram\n  class A {\n    +id\n', '2', /closing brace/, /\}/],
    ['erDiagram\n  A ||--o{ B', '2', /relation has no name/, /A \|\|--o\{ B : has/],
    ['gantt\n  title X\n  section A\n  Task :a1, 2026-13-45, 3d', '4', /date 2026-13-45 is not valid/, /YYYY-MM-DD/],
    ['pie title X\n  A : 10', '2', /slice could not be read/, /"Name" : 10/],
    ['xychart-beta\n  x-axis [Jan, Feb\n  bar [1, 2]', '2', /bracket is not closed/, /bar \[10, 20\]/],
    ['xychart-beta\n  x-axis [Jan, Feb]\n  bar [1, two]', '3', /series could not be read/, /bar \[10, 12\.5\]/],
    ['xychart-beta\n  x-axis Jan, Feb]\n  bar [1, 2]', '2', /axis labels could not be read/, /x-axis \["Jan", "Feb"\]/],
    ['xychart-beta\n  x-axis [Jan, Feb]\n  y-axis "Sales" 0 -> 10\n  line [1, 2]', '3', /axis could not be read/, /y-axis "Sales" 0 --> 100/],
    ['mindmap\n  root((X))\n    A\n  B', '4', /B sits at the level of the central topic/, /Indent/],
  ];
  const bad = [];
  for (const [code, line, main, hint] of cases) {
    await fill(code); s = await state();
    if (!(s.line === line && s.band && main.test(s.err) && hint.test(s.hint) && s.stale && s.detail && !s.detail.open && s.detail.text.length > 10 && !/Expecting|NODE_STRING|got '/.test(s.err + s.hint))) bad.push([code, s.line, s.err, s.hint]);
  }
  add('errores de Mermaid: línea marcada, mensaje corto y pista en ' + cases.length + ' casos', !bad.length, bad);
  await fill('graph LR\n  A[Start] --> B[End] extra'); await app.click('.lmd-dgm .lmd-err-more summary'); await app.waitForTimeout(150); s = await state();
  add('"Ver detalle" abre el volcado original', s.detail.open && /Parse error on line 2/.test(s.detail.text) && /NODE_STRING/.test(s.detail.text), s.detail);
  await fill('graph LR\n  A[Start] --> B[End]'); s = await state();
  add('al corregir se va el error y la marca', !s.err && !s.band && !s.line && !s.stale && s.svg, s);

  // ---------- Piezas: identificadores sin repetir, conectadas, con la etiqueta seleccionada ----------
  await app.click('[data-piece="0"]'); await app.waitForTimeout(150); const p1 = await state();
  await app.click('[data-piece="0"]'); await app.waitForTimeout(150); await app.click('[data-piece="0"]'); await app.waitForTimeout(150); s = await state();
  add('"Paso" tres veces deja tres nodos distintos, encadenados', s.code === 'graph LR\n  A[Start] --> B[End]\n  B --> C[New step]\n  C --> D[New step]\n  D --> E[New step]\n', s.code);
  add('la etiqueta de la pieza queda seleccionada', p1.sel === 'New step' && s.sel === 'New step', [p1.sel, s.sel]);
  await app.keyboard.type('Ship it'); await app.waitForTimeout(100); s = await state();
  add('se escribe encima de la etiqueta', /D --> E\[Ship it\]\n$/.test(s.code), s.code);
  await app.keyboard.press('Control+z'); await app.keyboard.press('Control+z'); await app.waitForTimeout(150); s = await state();
  add('Ctrl+Z deshace la pieza', !/E\[/.test(s.code) && /C --> D\[New step\]/.test(s.code), s.code);
  await fill('graph LR\n  A[Start] --> B[End]\n  B --> C[Third]', 300);
  await app.click('[data-piece="1"]'); await app.waitForTimeout(150); s = await state();
  add('"Pregunta" se conecta al último nodo', /C --> D\{Question\?\}\n$/.test(s.code) && s.sel === 'Question?', [s.code, s.sel]);
  await app.click('[data-piece="2"]'); await app.waitForTimeout(150); s = await state();
  add('"Flecha" une los dos últimos nodos sin conectar', /\n {2}B --> D\n$/.test(s.code) && s.sel === 'D', [s.code, s.sel]);
  await app.click('[data-piece="2"]'); await app.waitForTimeout(150); await app.click('[data-piece="2"]'); await app.waitForTimeout(150); await app.click('[data-piece="2"]'); await app.waitForTimeout(150); s = await state();
  const arrows = s.code.split('\n').slice(1).map((l) => l.replace(/\[[^\]]*\]|\{[^}]*\}/g, '').trim()).filter(Boolean);
  add('"Flecha" repetida no duplica flechas', new Set(arrows).size === arrows.length && /A --> D/.test(s.code) && /A --> C/.test(s.code), arrows);
  await app.click('[data-piece="2"]'); await app.waitForTimeout(1300); s = await state();
  add('con todo conectado, "Flecha" deja el cursor listo y el error lo explica', /\n {2}D --> \n$/.test(s.code) && s.at === s.code.length - 1 && /arrow has no target/.test(s.err), [s.code, s.at, s.err]);
  await fill('graph LR\n  A[Start] --> B[End]', 300);
  await app.click('[data-piece="3"]'); await app.waitForTimeout(150); s = await state();
  add('"Flecha con texto" selecciona el texto', /\n {2}B -- text --> \n$/.test(s.code) && s.sel === 'text', [s.code, s.sel]);
  await fill('graph LR\n  A[Start] --> B[End]', 300);
  await app.click('[data-piece="4"]'); await app.waitForTimeout(1300); s = await state();
  const painted = await app.evaluate(() => [...document.querySelectorAll('.lmd-dgm-svg .node')].map((n) => getComputedStyle(n.querySelector('rect, polygon, path')).fill));
  add('"Color de un nodo" agrega style con el identificador seleccionado y se ve en la vista previa', /\n {2}style B fill:#fde68a,stroke:#d97706,color:#422006\n$/.test(s.code) && s.sel === 'B' && painted.includes('rgb(253, 230, 138)') && !s.err, [s.code, s.sel, painted]);
  await fill('graph LR', 300); await app.click('[data-piece="0"]'); await app.waitForTimeout(150); s = await state();
  add('sin nodos, "Paso" queda suelto', s.code === 'graph LR\n  A[New step]\n', s.code);

  // Cada tipo tiene sus piezas; aplicadas una tras otra sobre su plantilla, el diagrama se sigue dibujando.
  const WANT = { flow: 5, seq: 5, state: 2, class: 4, er: 3, gantt: 3, pie: 1, bar: 2, line: 2, mind: 2, time: 2 };
  const run = () => app.evaluate(async () => {
    const D = LMD.diagram; const out = {}; let n = 0;
    const draw = async (kind, code) => { try { if (kind === 'dot') { (await Viz.instance()).renderSVGElement(code); } else { await mermaid.render('t' + (++n), code); } return ''; } catch (e) { return String(e.message || e).slice(0, 160); } finally { document.querySelectorAll('body > [id^=dt]').forEach((x) => x.remove()); } };
    const apply = (kind, code, i) => { const p = D.pieceEdit(kind, code, i); return p ? { code: code.slice(0, p.from) + p.text + code.slice(p.to), sel: null, p } : null; };
    const list = D.templates().map((t) => ['mermaid', t[0], t[3], t[1]]).concat([['dot', 'dot', 'digraph {\n  a -> b;\n}', 'Graphviz'], ['dot', 'dot1', 'digraph { a -> b }', 'Graphviz'], ['dot', 'dot2', 'graph {\n  a -- b;\n}', 'Graphviz']]);
    for (const [kind, type, tpl, name] of list) {
      const r = { name, tpl, tplErr: await draw(kind, tpl), pieces: 0, errs: [], codes: [], sels: [] };
      let code = tpl;
      for (let round = 0; round < 2; round++) for (let i = 0; i < 9; i++) {
        const a = apply(kind, code, i); if (!a) break;
        if (!round) r.pieces++;
        r.sels.push(a.code.slice(a.p.sel[0], a.p.sel[1]));
        // Una flecha que quedó lista para completar se termina a mano, como haría la persona.
        const open = a.p.sel[0] === a.p.sel[1];
        code = open ? code : a.code;
        const e = open ? '' : await draw(kind, code);
        if (e) r.errs.push([i, e, code]);
      }
      r.final = code;
      // Lo que se declara (nodos, participantes, clases, entidades, tareas) no puede repetir identificador; las flechas tampoco se repiten.
      const defs = { flow: /^\s*(?:\w+ --> )?(\w+)[[{]/gm, seq: /participant (\w+)/g, state: / as (\w+)/g, class: /class (\w+)/g, er: /^\s*(\w+) \{/gm, gantt: /:(?:milestone, )?(\w+),/g, pie: /"([^"]+)"/g, dot: /(\w+) \[label/g }[type.replace(/\d$/, '')];
      const ids = []; let m; if (defs) while ((m = defs.exec(code))) ids.push(m[1]);
      r.dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      if (kind === 'dot' || type === 'flow') r.dup = r.dup.concat(code.split('\n').map((l) => l.trim()).filter((l, i, all) => /->|--/.test(l) && all.indexOf(l) !== i));
      r.ids = ids;
      out[type] = r;
    }
    return out;
  });
  const en = await run();
  const types = Object.keys(WANT);
  add('cada tipo ofrece sus piezas', types.every((t) => en[t].pieces === WANT[t]) && en.dot.pieces === 2, Object.keys(en).map((t) => [t, en[t].pieces]));
  add('las once plantillas se dibujan', types.every((t) => !en[t].tplErr), types.map((t) => [t, en[t].tplErr]));
  add('las piezas de cada tipo dejan un diagrama que se dibuja', Object.keys(en).every((t) => !en[t].errs.length), Object.keys(en).map((t) => en[t].errs).filter((x) => x.length));
  add('aplicadas dos veces, no repiten identificadores ni líneas', Object.keys(en).every((t) => !en[t].dup.length), Object.keys(en).map((t) => [t, en[t].dup]).filter((x) => x[1].length));
  add('cada pieza deja algo seleccionado para completar', Object.keys(en).every((t) => en[t].sels.filter((x) => !x).length <= 2), Object.keys(en).map((t) => [t, en[t].sels]));
  add('inglés: plantillas y piezas sin palabras en español', Object.keys(en).every((t) => !SPANISH.test(en[t].final)), Object.keys(en).map((t) => (SPANISH.exec(en[t].final) || [])[0]).filter(Boolean));
  add('inglés: la plantilla de datos dice CUSTOMER, ORDER, places', /CUSTOMER \|\|--o\{ ORDER : places/.test(en.er.tpl) && /string name/.test(en.er.tpl) && /\+name/.test(en.class.tpl), en.er.tpl);
  add('Graphviz: en una sola línea, las piezas van antes de la llave', /a -> b\s*\n {2}n1 \[label="Node"\];\n {2}/.test(en.dot1.final) && /\}\s*$/.test(en.dot1.final), en.dot1.final);
  add('Graphviz: en un graph sin flechas, la arista usa --', / -- /.test(en.dot2.final) && !/->/.test(en.dot2.final), en.dot2.final);

  // ---------- Piezas en la pantalla para otros tipos ----------
  await app.click('[data-drop=tpl]'); await app.waitForTimeout(150);
  const menu = await app.evaluate(() => ({ open: !document.querySelector('.lmd-dgm-tpls').hidden, note: document.querySelector('.lmd-dgm-tpls > p').textContent, items: [...document.querySelectorAll('.lmd-dgm-tpls [data-tpl]')].map((b) => [b.querySelector('b').textContent, b.querySelector('small').textContent.length > 8, !!b.querySelector('svg')]) }));
  add('"Insertar plantilla" despliega los once tipos con nombre, descripción y miniatura, y avisa que reemplaza', menu.open && /replaces the whole diagram/.test(menu.note) && menu.items.length === 11 && menu.items[7][0] === 'Bars' && menu.items[8][0] === 'Lines' && menu.items.every((i) => i[0] && i[1] && i[2]) && menu.items[4][0] === 'Data', menu);
  await app.click('[data-tpl="1"]'); await app.waitForTimeout(1100); s = await state();
  add('elegir una plantilla reemplaza todo, cierra el desplegable y cambia las piezas', /^sequenceDiagram/.test(s.code) && s.label === 'Mermaid · Sequence' && J(s.pieces) === J(['Participant', 'Message', 'Response', 'Note', 'Loop']) && await app.evaluate(() => document.querySelector('.lmd-dgm-tpls').hidden) && !s.err, [s.label, s.pieces]);
  add('queda "Volver a lo que tenía"', await app.evaluate(() => !document.querySelector('[data-dgm-back]').hidden));
  await app.click('[data-piece="0"]'); await app.waitForTimeout(150); s = await state();
  add('secuencia: el participante nuevo no repite identificador y deja el nombre seleccionado', /\n {2}participant B as Name\n$/.test(s.code) && s.sel === 'Name', [s.code, s.sel]);
  await app.click('[data-drop=tpl]'); await app.click('[data-tpl="3"]'); await app.waitForTimeout(600); await app.click('[data-piece="1"]'); await app.waitForTimeout(1100); s = await state();
  add('clases: el atributo entra en el bloque de la última clase', /class Customer \{\n {4}\+name\n {4}\+attribute\n {2}\}/.test(s.code) && s.sel === 'attribute' && !s.err, [s.code, s.sel]);
  // Barras y líneas: plantillas de inicio con datos cortos, su nombre y sus piezas.
  await app.click('[data-drop=tpl]'); await app.click('[data-tpl="7"]'); await app.waitForTimeout(1100); s = await state();
  const kindOf = () => app.evaluate(() => { const v = document.querySelector('.lmd-dgm-svg svg'); return [v.getAttribute('aria-roledescription'), v.querySelectorAll('[class*=bar-plot] rect').length, v.querySelectorAll('[class*=line-plot] path').length]; });
  add('barras: la plantilla es un xychart corto, con su nombre y sus piezas', /^xychart-beta\n {2}title "Sales by month"\n {2}x-axis \["Jan", "Feb", "Mar", "Apr"\]\n {2}y-axis "Units" 0 --> 30\n {2}bar \[12, 18, 15, 24\]$/.test(s.code) && s.label === 'Mermaid · Bars' && J(s.pieces) === J(['Bar series', 'Line series']) && !s.err && J(await kindOf()) === J(['xychart', 4, 0]), [s.code, s.label, s.pieces, await kindOf()]);
  await app.click('[data-piece="1"]'); await app.waitForTimeout(1100); s = await state();
  add('barras: una serie nueva trae un valor por rótulo, seleccionados, y se dibuja', /\n {2}line \[10, 10, 10, 10\]\n$/.test(s.code) && s.sel === '10, 10, 10, 10' && !s.err && J(await kindOf()) === J(['xychart', 4, 1]), [s.code, s.sel, await kindOf()]);
  await app.click('[data-drop=colors]'); await app.click('[data-pal="0"]'); await app.waitForTimeout(1300); s = await state();
  const xyFill = await app.evaluate(() => document.querySelector('.lmd-dgm-svg [class*=bar-plot] rect').getAttribute('fill'));
  add('barras: una paleta pinta las series y queda escrita en el bloque', /^%%\{init: \{'theme':'base','themeVariables':\{[^\n]*'xyChart':\{'backgroundColor':'transparent'[^\n]*'plotColorPalette':'#3b82f6,#437ad3,#1e3a8a'\}\}\}\}%%\nxychart-beta\n/.test(s.code) && xyFill === '#3b82f6' && !s.err, [s.code.slice(0, 700), xyFill]);
  await app.click('[data-pal="-1"]'); await app.waitForTimeout(900); await app.keyboard.press('Escape'); await app.waitForTimeout(150);
  await app.click('[data-drop=tpl]'); await app.click('[data-tpl="8"]'); await app.waitForTimeout(1100); s = await state();
  add('líneas: la plantilla, su nombre y el dibujo', /^xychart-beta\n {2}title "Visits by month"\n[^]*\n {2}line \[120, 180, 260, 410\]$/.test(s.code) && s.label === 'Mermaid · Lines' && !s.err && J(await kindOf()) === J(['xychart', 0, 1]), [s.code, s.label, await kindOf()]);
  await fill('journey\n  title X', 300); s = await state();
  add('un tipo sin piezas no muestra la fila "Agregar"', s.addHidden, s.pieces);

  // ---------- Colores ----------
  await app.click('[data-drop=tpl]'); await app.click('[data-tpl="0"]'); await app.waitForTimeout(900);
  await app.click('[data-drop=colors]'); await app.waitForTimeout(150);
  const pals = await app.evaluate(() => [...document.querySelectorAll('.lmd-dgm-colors [data-pal]')].map((b) => b.textContent.replace('Aa', '').trim()));
  add('"Colores" ofrece el tema por defecto y ocho paletas', pals.length === 9 && pals[0] === 'Default' && pals[1] === 'Blue', pals);
  await app.click('[data-pal="4"]'); await app.waitForTimeout(1300); s = await state();
  const fillOf = () => app.evaluate(() => { const n = document.querySelector('.lmd-dgm-svg .node rect, .lmd-dgm-svg .node polygon'); return n ? getComputedStyle(n).fill : ''; });
  add('una paleta escribe la directiva init al principio', /^%%\{init: \{'theme':'base','themeVariables':\{'primaryColor':'#ede9fe'[^\n]*\}\}\}%%\ngraph TD\n/.test(s.code) && !s.err, s.code.slice(0, 120));
  add('la vista previa toma los colores en vivo', (await fillOf()) === 'rgb(237, 233, 254)', await fillOf());
  add('la paleta elegida queda marcada', await app.evaluate(() => document.querySelector('[data-pal="4"]').classList.contains('lmd-on') && !document.querySelector('[data-pal="-1"]').classList.contains('lmd-on')));
  await app.click('[data-pal="1"]'); await app.waitForTimeout(1300); s = await state();
  add('cambiar de paleta reemplaza la directiva, no la duplica', s.code.split('%%{init').length === 2 && /'primaryColor':'#dcfce7'/.test(s.code) && (await fillOf()) === 'rgb(220, 252, 231)', s.code.slice(0, 80));
  await app.click('[data-pal="-1"]'); await app.waitForTimeout(1300); s = await state();
  add('"Por defecto" quita la directiva', /^graph TD\n/.test(s.code) && !/init/.test(s.code) && await app.evaluate(() => document.querySelector('[data-pal="-1"]').classList.contains('lmd-on')), s.code.slice(0, 40));
  await app.click('[data-pal="4"]'); await app.waitForTimeout(900); await app.keyboard.press('Escape'); await app.waitForTimeout(150);
  add('Escape cierra el desplegable sin cerrar el editor', await app.evaluate(() => !!document.querySelector('.lmd-dgm') && document.querySelector('.lmd-dgm-colors').hidden));
  await app.keyboard.press('Control+Enter'); await app.waitForTimeout(1800);
  const md = await src();
  add('la paleta queda escrita en el bloque del documento', /```mermaid\n%%\{init: \{'theme':'base','themeVariables':\{'primaryColor':'#ede9fe'/.test(md), md.slice(0, 200));
  add('el dibujo del documento coincide con la vista previa', await app.evaluate(() => { const n = document.querySelector('.lmd-diagram .node rect, .lmd-diagram .node polygon'); return getComputedStyle(n).fill; }) === 'rgb(237, 233, 254)');
  // Graphviz
  await app.click('.lmd-diagram-dot'); await app.waitForSelector('.lmd-dgm-svg svg'); s = await state();
  add('Graphviz: sin plantillas, con sus piezas y colores', s.label === 'Graphviz' && J(s.pieces) === J(['Node', 'Edge']) && await app.evaluate(() => !document.querySelector('.lmd-dgm [data-drop=tpl]') && !!document.querySelector('.lmd-dgm [data-drop=colors]')), [s.label, s.pieces]);
  await app.click('[data-drop=colors]'); await app.click('[data-pal="0"]'); await app.waitForTimeout(1100); s = await state();
  const dotFill = () => app.evaluate(() => { const e = document.querySelector('.lmd-dgm-svg ellipse'); const t = document.querySelector('.lmd-dgm-svg text'); return [e.getAttribute('fill'), e.getAttribute('stroke'), getComputedStyle(t).fill]; });
  add('Graphviz: la paleta son atributos de node y edge', /^digraph \{\n {2}node \[style=filled, fillcolor="#dbeafe", color="#3b82f6", fontcolor="#1e3a8a"\];\n {2}edge \[color="#437ad3", fontcolor="#437ad3"\];\n {2}a -> b;\n\}$/.test(s.code) && !s.err, s.code);
  add('Graphviz: la vista previa toma relleno, borde y color de texto', J(await dotFill()) === J(['#dbeafe', '#3b82f6', 'rgb(30, 58, 138)']), await dotFill());
  await app.click('[data-pal="2"]'); await app.waitForTimeout(700); await app.click('[data-pal="-1"]'); await app.waitForTimeout(900); s = await state();
  add('Graphviz: "Por defecto" quita los atributos', s.code === 'digraph {\n  a -> b;\n}', s.code);
  await app.keyboard.press('Escape'); await app.waitForTimeout(100);
  await fill('graph {\n  a -> b;\n}'); s = await state();
  add('Graphviz: el error dice la línea y cómo arreglarlo', s.line === '2' && /joined with --/.test(s.err) && /digraph/.test(s.hint) && /syntax error/.test(s.detail.text), [s.line, s.err, s.hint]);
  await fill('digraph {\n  a [label="x];\n  a -> b\n}'); s = await state();
  add('Graphviz: comillas sin cerrar', s.line === '2' && /quotes are not closed/.test(s.err), [s.line, s.err]);
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);
  add('Escape cierra el editor sin cambiar el documento', await app.evaluate(() => !document.querySelector('.lmd-dgm')) && /```dot\ndigraph \{\n {2}a -> b;\n\}\n```/.test(await src()));

  // ---------- A 390 px: el código arriba y la vista previa abajo ----------
  await app.click('.lmd-diagram >> nth=0'); await app.waitForSelector('.lmd-dgm-svg svg');
  await app.setViewportSize({ width: 390, height: 800 }); await app.waitForTimeout(300);
  const narrow = await app.evaluate(() => { const c = document.querySelector('.lmd-dgm .lmd-ed-code').getBoundingClientRect(); const v = document.querySelector('.lmd-dgm-view').getBoundingClientRect(); const card = document.querySelector('.lmd-dgm-card').getBoundingClientRect(); return { stacked: v.top >= c.bottom - 1, fits: card.left >= 0 && card.right <= 390 && document.documentElement.scrollWidth <= 390, code: Math.round(c.height), view: Math.round(v.height), ok: !!document.querySelector('.lmd-dgm [data-dgm=ok]').getBoundingClientRect().width }; });
  add('a 390 px el código queda arriba y la vista previa abajo, sin desbordar', narrow.stacked && narrow.fits && narrow.code > 120 && narrow.view > 120 && narrow.ok, narrow);
  await app.click('[data-drop=tpl]'); await app.waitForTimeout(150);
  const pop = await app.evaluate(() => { const r = document.querySelector('.lmd-dgm-tpls').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; });
  add('a 390 px el desplegable entra en la pantalla', pop[0] >= 0 && pop[1] <= 390, pop);
  await app.setViewportSize({ width: 1280, height: 800 }); await app.keyboard.press('Escape'); await app.keyboard.press('Escape'); await app.waitForTimeout(300);

  // ---------- En español ----------
  await setLang('es'); await openDoc();
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await app.click('.lmd-diagram >> nth=0'); await app.waitForSelector('.lmd-dgm-svg svg');
  const es = await run();
  add('español: las plantillas y las piezas salen en español y se dibujan', /CLIENTE \|\|--o\{ PEDIDO : hace/.test(es.er.tpl) && /Paso nuevo/.test(es.flow.final) && /Mensaje/.test(es.seq.final) && /title "Ventas por mes"/.test(es.bar.tpl) && /x-axis \["Ene", "Feb", "Mar", "Abr"\]/.test(es.bar.tpl) && /y-axis "Visitas"/.test(es.line.tpl) && Object.keys(es).every((t) => !es[t].tplErr && !es[t].errs.length), Object.keys(es).map((t) => [t, es[t].tplErr, es[t].errs]).filter((x) => x[1] || x[2].length));
  await fill('graph LR\n  A[Inicio] --> B[Fin] sobra'); s = await state();
  add('español: el error se explica en español', s.line === '2' && /Sobra texto después de B\[Fin\]/.test(s.err) && /Borrá sobra/.test(s.hint) && await app.evaluate(() => document.querySelector('.lmd-dgm .lmd-err-more summary').textContent === 'Ver detalle'), [s.err, s.hint]);
  await fill('xychart-beta\n  x-axis [Ene, Feb]\n  bar [1, dos]'); s = await state();
  add('español: el error de un gráfico se explica en español', s.line === '3' && /Esta serie no se pudo leer/.test(s.err) && /con punto para los decimales/.test(s.hint), [s.line, s.err, s.hint]);
  add('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { add('la prueba llegó hasta el final', false, String(e && e.stack || e).slice(0, 700)); }

console.log('Editor de diagramas');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 700))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
