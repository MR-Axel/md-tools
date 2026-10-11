// Graficar una tabla: el botón de la barra de la tabla, el cuadro (tipo, rótulos, valores, título, vista previa), el
// bloque mermaid que queda debajo de la tabla, números en formato español, celdas que no son números, rótulos con
// caracteres raros, la fila de totales, claro y oscuro, inglés y español, teléfono, y cómo sale al exportar.
//   SHOTS=C:\tmp\carpeta node charts.mjs    (deja ahí las capturas de barras, líneas y torta en claro y oscuro)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 900 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const home = `chrome-extension://${id}/src/app.html`;
const DOC = ['# Informe', '', '## Ventas del trimestre', '',
  '| Mes | Ventas | Costo | Nota |', '| --- | --- | --- | --- |', '| Enero | $ 1.234,50 | 800 | ok |', '| Febrero | $ 2.000,00 | 1.100 | ok |', '| Marzo | $ 3.400,25 | 1.900 | ok |', '| **Total** | =sum | =sum |  |', '',
  'Texto que sigue.', '', '## Rótulos raros', '',
  '| Producto | Parte |', '| --- | --- |', '| Pan "casero" | 12 % |', '| Leche [1 L], entera | 30,5 % |', '| Yerba: 50% off; #1 | 57,5 % |', '',
  '## Con un dato malo', '', '| Sector | Saldo |', '| --- | --- |', '| Norte | 10 |', '| Sur | n/d |', '| Este | 7 |', '',
  '## Negativos', '', '| Sector | Saldo |', '| --- | --- |', '| Norte | 10 |', '| Sur | \u22124 |', '',
  '## Una sola', '', '| Puntos |', '| --- |', '| 3 |', '| 7 |', '| 5 |', '',
  '## Texto', '', '| Nombre | Rol |', '| --- | --- |', '| Ana | Diseño |', ''].join('\n');
const checks = []; const J = (v) => JSON.stringify(v);
const add = (name, ok, detail) => checks.push([name, !!ok, detail]);
// El primer arranque de la extensión a veces corta la carga: se reintenta.
const go = async () => { for (let i = 0; ; i++) { try { await app.goto(home, { timeout: 20000 }); await app.waitForSelector('.lmd-home', { timeout: 20000 }); return; } catch (e) { if (i >= 2) throw e; } } };
const setUp = async (lang, theme, more) => {
  await go();
  await app.evaluate((s) => new Promise((resolve) => chrome.storage.local.set({ settings: s }, resolve)), Object.assign({ language: lang, theme, cloudUrl: 'off', updateCheck: 'off' }, more || {}));
  await go();
};
const openDoc = async (text, wait) => {
  await app.evaluate(async (t) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ch', { create: true });
    const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable(); await s.write(t); await s.close();
    window.showDirectoryPicker = async () => dir;
  }, text);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector(wait || '.markdown-body table');
};
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const edit = async () => { await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400); };
// Abre "Graficar" desde la primera celda de la tabla n.
const chart = async (n) => {
  await app.locator('.markdown-body table').nth(n).locator('td.lmd-cell').first().click(); await app.waitForSelector('.lmd-tablebar:not([hidden])');
  await app.click('[data-top=chart]'); await app.waitForSelector('.lmd-chart'); await settled();
};
// El cuadro terminó de dibujar: hay vista previa, o hay un aviso.
const settled = async () => { await app.waitForTimeout(500); await app.waitForFunction(() => { const m = document.querySelector('.lmd-chart'); return !m || !m.querySelector('.lmd-dlg-err').hidden || !!m.querySelector('.lmd-chart-view svg'); }); await app.waitForTimeout(400); };
// La nota terminó de dibujar sus diagramas.
const ready = async () => { await app.waitForFunction(() => !document.querySelector('.markdown-body pre.lmd-mermaid:not(.lmd-mermaid-error)')); await app.waitForTimeout(300); };
const state = () => app.evaluate(() => {
  const m = document.querySelector('.lmd-chart'); if (!m) return null;
  const e = m.querySelector('.lmd-dlg-err'); const n = m.querySelector('.lmd-chart-note'); const svg = m.querySelector('.lmd-chart-view svg');
  return { title: m.querySelector('h3').textContent, role: m.querySelector('.lmd-chart-card').getAttribute('role'), modal: m.querySelector('.lmd-chart-card').getAttribute('aria-modal'),
    types: [...m.querySelectorAll('[data-ct]')].map((b) => b.textContent + (b.classList.contains('lmd-on') ? '*' : '')), label: m.querySelector('[data-cf=label]').value,
    labels: [...m.querySelectorAll('[data-cf=label] option')].map((o) => o.textContent), vals: [...m.querySelectorAll('[data-cv]')].map((b) => b.parentNode.textContent + (b.checked ? '*' : '') + (b.disabled ? '-' : '')),
    name: m.querySelector('[data-cf=title]').value, flat: m.querySelector('[data-cf=flat]').checked, flatHidden: m.querySelector('.lmd-chart-flat').hidden, hint: !m.querySelector('[data-ch=many]').hidden,
    err: e.hidden ? '' : e.textContent, note: n.hidden ? '' : n.textContent, off: m.querySelector('[data-chart=ok]').disabled, ok: m.querySelector('[data-chart=ok]').textContent,
    kind: svg ? svg.getAttribute('aria-roledescription') : '', texts: svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent) : [], stale: m.querySelector('.lmd-chart-view').classList.contains('lmd-dgm-stale') };
});
const pick = async (type) => { await app.click('.lmd-chart [data-ct=' + type + ']'); await settled(); };
const apply = async () => { await app.click('.lmd-chart [data-chart=ok]'); await app.waitForSelector('.lmd-chart', { state: 'detached' }); await app.waitForTimeout(600); await ready(); };
// Los bloques mermaid de la nota, cada uno con la línea que tiene arriba de la cerca.
const blocks = (md) => { const out = []; const l = md.split('\n'); for (let i = 0; i < l.length; i++) { if (l[i] !== '```mermaid') continue; let j = i + 1; while (j < l.length && l[j] !== '```') j++; out.push({ before: l[i - 1] === '' ? l[i - 2] : '(sin renglón en blanco) ' + l[i - 1], code: l.slice(i + 1, j).join('\n') }); i = j; } return out; };
// Lo dibujado en la nota: de qué tipo es cada diagrama, sus colores y sus textos.
const drawn = () => app.evaluate(() => [...document.querySelectorAll('.markdown-body .lmd-diagram')].map((d) => {
  const svg = d.querySelector('svg'); const bar = svg.querySelector('[class*=bar-plot] rect'); const line = svg.querySelector('[class*=line-plot] path'); const back = svg.querySelector('.background, rect.background') || svg.querySelector('g.main > rect');
  const title = svg.querySelector('.chart-title text'); const tick = svg.querySelector('.bottom-axis .label text, .left-axis .label text');
  const slice = svg.querySelector('.pieCircle');
  return { kind: svg.getAttribute('aria-roledescription'), slice: slice ? (slice.getAttribute('fill') || getComputedStyle(slice).fill) : '', bars: svg.querySelectorAll('[class*=bar-plot] rect').length, lines: svg.querySelectorAll('[class*=line-plot] path').length,
    bar: bar ? bar.getAttribute('fill') : '', line: line ? line.getAttribute('stroke') : '', back: back ? back.getAttribute('fill') : '', title: title ? title.getAttribute('fill') : '', tick: tick ? tick.getAttribute('fill') : '',
    texts: [...svg.querySelectorAll('text')].map((t) => t.textContent), inside: (() => { const r = svg.getBoundingClientRect(); return [...svg.querySelectorAll('text')].every((t) => { const b = t.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }); })(), w: Math.round(svg.getBoundingClientRect().width), vb: (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number)[2], font: tick ? parseFloat(getComputedStyle(tick).fontSize) : 0 };
}));
const shots = async (tag) => { if (!SHOTS) return; const names = ['lineas', 'barras', 'torta']; for (let i = 0; i < 3; i++) await app.locator('.markdown-body .lmd-diagram').nth(i).screenshot({ path: path.join(SHOTS, names[i] + '-' + tag + '.png') }); };
let three = '';

try {
  // ---------- Inglés, oscuro: barras desde la tabla ----------
  await setUp('en', 'dark'); await openDoc(DOC); await edit();
  const tableWas = (await src()).split('\n').slice(4, 10);
  await app.locator('.markdown-body table').nth(0).locator('td.lmd-cell').first().click(); await app.waitForSelector('.lmd-tablebar:not([hidden])');
  const bar = await app.evaluate(() => [...document.querySelectorAll('.lmd-tablebar [data-top]')].map((b) => b.dataset.top + ':' + b.textContent.trim()));
  add('la barra de la tabla suma "Graficar" después de Totales', J(bar.slice(-2)) === J(['total:Σ Totals', 'chart:Chart']) && bar.length === 6, bar);
  await app.click('[data-top=chart]'); await app.waitForSelector('.lmd-chart'); await settled();
  let s = await state();
  add('abre un cuadro de la página, con los tres tipos y barras elegido', s.role === 'dialog' && s.modal === 'true' && s.title === 'Chart this table' && J(s.types) === J(['Bars*', 'Lines', 'Pie']) && s.ok === 'Insert chart', s);
  add('propone los rótulos (la columna de texto), el primer valor y el título de la sección', s.label === '0' && J(s.labels) === J(['Mes', 'Ventas', 'Costo', 'Nota', 'Row number']) && J(s.vals) === J(['Ventas*', 'Costo']) && s.name === 'Ventas del trimestre', [s.label, s.labels, s.vals, s.name]);
  add('la vista previa se dibuja y avisa que la fila de totales queda afuera', s.kind === 'xychart' && !s.err && !s.off && /totals row is left out/.test(s.note) && s.texts.includes('Enero') && !s.texts.includes('Total'), [s.kind, s.err, s.note, s.texts]);
  if (SHOTS) await app.screenshot({ path: path.join(SHOTS, 'cuadro-oscuro.png') });
  await apply();
  let md = await src(); let b = blocks(md);
  add('inserta un bloque xychart debajo de la tabla, con los números leídos en formato español', b.length === 1 && b[0].before === '| **Total** | =sum | =sum |  |' &&
    b[0].code === 'xychart-beta\n  title "Ventas del trimestre"\n  x-axis ["Enero", "Febrero", "Marzo"]\n  y-axis "Ventas ($)" 0 --> 3400.25\n  bar [1234.5, 2000, 3400.25]', b);
  add('la tabla queda como estaba y el texto de abajo sigue separado', J(md.split('\n').slice(4, 10)) === J(tableWas) && /\n```\n\nTexto que sigue\.\n/.test(md), md.slice(0, 500));
  let d = await drawn();
  add('el gráfico se ve en la nota: tres barras, sin la de totales', d.length === 1 && d[0].kind === 'xychart' && d[0].bars === 3 && !d[0].texts.includes('Total'), d);
  add('los números del eje y los rótulos entran enteros en el dibujo, sin cortarse', d[0].inside && d[0].texts.includes('3000') && d[0].texts.includes('Ventas ($)'), d);

  // ---------- Líneas, con dos series y leyenda ----------
  await chart(0); await pick('line'); s = await state();
  add('con líneas se puede marcar más de una columna', J(s.types) === J(['Bars', 'Lines*', 'Pie']) && !s.hint, s.types);
  await app.click('.lmd-chart [data-cv="2"]'); await settled(); s = await state();
  add('dos series: cada una con su nombre en la leyenda', J(s.vals) === J(['Ventas*', 'Costo*']) && s.kind === 'xychart' && s.texts.includes('Ventas') && s.texts.includes('Costo') && !s.err, [s.vals, s.texts]);
  await pick('bar'); s = await state();
  add('al pasar a barras queda una sola serie, y lo dice', J(s.vals) === J(['Ventas*', 'Costo']) && s.hint, [s.vals, s.hint]);
  await app.click('.lmd-chart [data-cv="2"]'); await app.waitForTimeout(600); s = await state();
  add('en barras, marcar otra columna reemplaza a la anterior', J(s.vals) === J(['Ventas', 'Costo*']), s.vals);
  await pick('line'); await app.click('.lmd-chart [data-cv="1"]'); await app.waitForTimeout(300);
  await app.fill('.lmd-chart [data-cf=title]', 'Ventas y "costo" [2026]'); await app.waitForTimeout(900);
  await apply(); md = await src(); b = blocks(md);
  add('líneas: el bloque lleva una serie por columna y el título con las comillas cambiadas', b.length === 2 && b[0].before === '| **Total** | =sum | =sum |  |' && b[1].before === '```' &&
    b[0].code === 'xychart-beta\n  title "Ventas y \'costo\' [2026]"\n  x-axis ["Enero", "Febrero", "Marzo"]\n  line "Ventas" [1234.5, 2000, 3400.25]\n  line "Costo" [800, 1100, 1900]' && /^xychart-beta\n {2}title "Ventas del trimestre"/.test(b[1].code), b);
  d = await drawn();
  add('en la nota: dos líneas y la leyenda', d.length === 2 && d[0].lines === 2 && d[0].texts.includes('Costo') && d[0].texts.includes('Ventas y \'costo\' [2026]'), d);

  // ---------- Torta, con rótulos raros y porcentajes ----------
  await chart(1); s = await state();
  add('rótulos largos: propone el gráfico acostado', s.flat && !s.flatHidden && s.name === 'Rótulos raros', [s.flat, s.name]);
  const odd = await app.evaluate(() => [...document.querySelectorAll('.lmd-chart-view svg text')].map((t) => t.textContent));
  add('barras: comillas, corchetes, comas, dos puntos y numeral llegan al dibujo', odd.includes('Pan \u201ccasero\u201d') && odd.includes('Leche [1 L], entera') && odd.includes('Yerba: 50% off; #1'), odd);
  await pick('pie'); s = await state();
  add('torta: se dibuja, y lo de acostar no aplica', s.kind === 'pie' && s.flatHidden && !s.err && s.texts.some((t) => /Leche \[1 L\], entera/.test(t)), [s.kind, s.texts]);
  await apply(); md = await src(); b = blocks(md);
  const pie = b.find((x) => /^pie/.test(x.code));
  add('torta: el bloque es un pie con los porcentajes como números', !!pie && pie.before === '| Yerba: 50% off; #1 | 57,5 % |' && pie.code === 'pie title Rótulos raros\n  "Pan \u201ccasero\u201d" : 12\n  "Leche [1 L], entera" : 30.5\n  "Yerba: 50% off; #1" : 57.5', pie);
  d = await drawn();
  add('los tres gráficos se dibujan en la nota, sin errores', d.length === 3 && J(d.map((x) => x.kind)) === J(['xychart', 'xychart', 'pie']) && await app.evaluate(() => !document.querySelector('.lmd-mermaid-error')), d.map((x) => x.kind));

  // ---------- Una celda que no es un número: se dice cuál y no se inserta nada ----------
  const before = await src();
  await chart(2); s = await state();
  add('una celda que no es un número: dice la columna, la fila y lo que hay', s.err === 'In column Saldo, the row for Sur is not a number: n/d' && s.off, [s.err, s.off]);
  await app.keyboard.press('Control+Enter'); await app.waitForTimeout(300);
  add('y no deja insertar: ni con el botón ni con Ctrl+Enter', await app.evaluate(() => !!document.querySelector('.lmd-chart')) && (await src()) === before);
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);
  add('Escape cierra el cuadro sin tocar la nota', await app.evaluate(() => !document.querySelector('.lmd-chart')) && (await src()) === before);

  // ---------- Negativos ----------
  await chart(3); s = await state();
  add('barras con negativos: se dibuja, con el rango desde el negativo, y avisa cómo se ven', !s.err && /negative values/.test(s.note) && s.kind === 'xychart', [s.err, s.note]);
  await pick('pie'); s = await state();
  add('la torta no admite negativos: lo dice y no inserta', /pie cannot show negative values: Sur has \u22124/.test(s.err) && s.off, s.err);
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);

  // ---------- Una sola columna, y una tabla sin números ----------
  await chart(4); s = await state();
  add('una sola columna de números: los rótulos son el número de fila', s.label === '-1' && J(s.vals) === J(['Puntos*']) && !s.err && J(s.texts.slice(0, 4)) === J(['Una sola', '1', '2', '3']), [s.label, s.vals, s.texts]);
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);
  await app.locator('.markdown-body table').nth(5).locator('td.lmd-cell').first().click(); await app.waitForSelector('.lmd-tablebar:not([hidden])');
  await app.click('[data-top=chart]'); await app.waitForTimeout(700);
  add('una tabla sin números no abre el cuadro: avisa', await app.evaluate(() => !document.querySelector('.lmd-chart')) && (await src()) === before);

  // ---------- El código, caso por caso ----------
  const unit = await app.evaluate(() => {
    const D = LMD.diagram; const cell = (t) => ({ text: t, calc: false });
    const data = (rows) => ({ cols: [{ name: 'Rubro', numeric: false }, { name: 'Monto', numeric: true }], rows: rows.map((r, i) => ({ n: i + 1, cells: r.map(cell) })), totals: 0 });
    const code = (rows, type, more) => { const r = D.chartCode(data(rows), Object.assign({ type: type || 'bar', label: 0, values: [1], title: '', flat: false }, more || {})); return r.error || r.code; };
    return {
      nums: code([['a', '1.234,5'], ['b', '1,234.5'], ['c', '$ 1.200'], ['d', '12 %'], ['e', '\u22123'], ['f', '0,75'], ['g', 'US$ 2.500,00']], 'line'),
      dup: code([['a', '1'], ['a', '2'], ['', '3']]), zero: code([['a', '0'], ['b', '0']]), flat: code([['a', '1'], ['b', '2']], 'bar', { flat: true, title: 'T' }),
      empty: code([['a', '1'], ['b', '']]), pieZero: code([['a', '0'], ['b', '4']], 'pie'), pieNone: code([['a', '0']], 'pie'), same: code([['a', '5'], ['b', '5']], 'line'),
      weird: code([['50%% de `x` #9829; "y"', '1'], ['b', '2']], 'pie', { title: 'A %% B' }), none: code([['a', '1']], 'bar', { values: [] }),
    };
  });
  add('lee 1.234,5, 1,234.5, $ 1.200, 12 %, el menos tipográfico y 0,75', /line \[1234\.5, 1234\.5, 1200, 12, -3, 0\.75, 2500\]$/.test(unit.nums), unit.nums);
  add('rótulos repetidos o vacíos no se pisan', /x-axis \["a", "a \(2\)", "Row 3"\]/.test(unit.dup), unit.dup);
  add('todo en cero o todo igual: el rango no queda vacío', /0 --> 1\n/.test(unit.zero) && /y-axis "Monto" 0 --> 5\n/.test(unit.same), [unit.zero, unit.same]);
  add('acostado: xychart-beta horizontal', /^xychart-beta horizontal\n {2}title "T"/.test(unit.flat), unit.flat);
  add('una celda vacía también se dice', unit.empty === 'In column Monto, the row for b is empty.', unit.empty);
  add('torta: una porción en cero se saca, y sin nada mayor que cero no hay torta', unit.pieZero === 'pie\n  "b" : 4' && /at least one value above zero/.test(unit.pieNone), [unit.pieZero, unit.pieNone]);
  add('lo que Mermaid tomaría por comentario, entidad o comillas se desarma', unit.weird === 'pie title A % % B\n  "50% % de \'x\' # 9829; \'y\'" : 1\n  "b" : 2', unit.weird);
  add('sin columna de valores, lo pide', unit.none === 'Pick a column with the values.', unit.none);
  const safe = await app.evaluate(async () => { const D = LMD.diagram; const cell = (t) => ({ text: t, calc: false }); let n = 0; const out = [];
    const data = { cols: [{ name: 'R', numeric: false }, { name: 'M "x" [y]', numeric: true }], rows: [['50%% de `x` #9829; "y"', '1'], ['<b>a</b> ] , [', '2'], ['%%{init: {}}%%', '3']].map((r, i) => ({ n: i + 1, cells: r.map(cell) })), totals: 0 };
    for (const type of ['bar', 'line', 'pie']) for (const flat of [false, true]) { const r = D.chartCode(data, { type, label: 0, values: [1], title: 'T "q" [x] %% #1;', flat }); try { const o = await mermaid.render('cs' + (++n), r.code); out.push(/<svg/.test(o.svg) && !/<b>a<\/b>/.test(o.svg) ? '' : 'html'); } catch (e) { out.push(String(e.message || e).slice(0, 120)); } finally { document.querySelectorAll('body > [id^=dcs]').forEach((x) => x.remove()); } }
    return out; });
  add('rótulos y títulos con comillas, corchetes, HTML y directivas se dibujan en los tres tipos', safe.every((x) => !x), safe);

  // ---------- Deshacer ----------
  await app.locator('.markdown-body h1').click(); await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  three = await src();

  // ---------- Oscuro: colores del tema ----------
  d = await drawn();
  add('oscuro: las series van con el acento del tema, sin fondo propio, y los textos en el color del texto', d[1].bar === '#bef264' && d[0].line === '#bef264' && d[1].back === 'transparent' && d[1].title === '#e6e8ec' && d[1].tick === '#a0a7b4' && /^(#bef264|rgb\(190, 242, 100\))$/.test(d[2].slice), [d.slice(0, 2), d[2].slice]);
  await shots('oscuro');

  // ---------- Exportar ----------
  const html = await app.evaluate(() => LMD.extras.htmlPage('x', LMD.extras.htmlOf()));
  add('HTML: los tres gráficos viajan como SVG, sin botones de la app', (html.match(/aria-roledescription="xychart"/g) || []).length === 2 && /aria-roledescription="pie"/.test(html) && /bar-plot-0/.test(html) && !/lmd-dgm-tools|data-dt=/.test(html) && /<table>/.test(html), html.length);
  const png = await app.evaluate(async () => {
    const out = [];
    for (const box of document.querySelectorAll('.markdown-body .lmd-diagram')) {
      const svg = box.querySelector('svg'); const r = svg.getBoundingClientRect(); const w = Math.round(r.width); const h = Math.round(r.height);
      const copy = svg.cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', w); copy.setAttribute('height', h); copy.removeAttribute('style');
      const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy)); });
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data; let inked = 0; let accent = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 40) inked++; if (px[i] === 190 && px[i + 1] === 242 && px[i + 2] === 100) accent++; }
      out.push({ w, h, inked, accent });
    }
    return out;
  });
  add('como imagen (lo que usa Word): el gráfico se dibuja fuera de la página con sus colores', png.length === 3 && png[0].accent > 200 && png[1].accent > 5000 && png.every((p) => p.inked > 2000), png);
  await app.evaluate(() => new Promise((resolve) => chrome.storage.local.get('settings', (r) => chrome.storage.local.set({ settings: Object.assign(r.settings, { tools: { docx: true } }) }, resolve))));
  await app.waitForFunction(() => !!(window.LMD && LMD.docx), null, { timeout: 8000 }).catch(() => {});
  const word = await app.evaluate(async () => { if (!LMD.docx) return null; const bytes = await LMD.docx.bytes(); let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return { size: bytes.length, pics: new Set(text.match(/word\/media\/[\w.-]+\.png/g) || []).size }; });
  add('Word: el .docx lleva una imagen por gráfico', !!word && word.pics === 3 && word.size > 20000, word);
  await app.emulateMedia({ media: 'print' }); await app.waitForTimeout(300);
  const print = await app.evaluate(() => [...document.querySelectorAll('.markdown-body .lmd-diagram')].map((x) => { const r = x.querySelector('svg').getBoundingClientRect(); return [Math.round(r.width) > 200, getComputedStyle(x).breakInside, !x.querySelector('.lmd-dgm-tools') || getComputedStyle(x.querySelector('.lmd-dgm-tools')).display === 'none']; }));
  add('al imprimir (PDF): los gráficos van enteros, sin partirse y sin botones', print.length === 3 && print.every((p) => p[0] && p[1] === 'avoid' && p[2]), print);
  if (SHOTS) { try { await app.pdf({ path: path.join(SHOTS, 'nota.pdf'), format: 'A4', printBackground: true }); } catch (e) { /* sin impresión a PDF en este modo */ } }
  await app.emulateMedia({ media: null });

  // ---------- Claro, con y sin color de acento ----------
  await setUp('en', 'light'); await openDoc(three, '.lmd-diagram svg'); await app.waitForFunction(() => document.querySelectorAll('.markdown-body .lmd-diagram > svg').length === 3);
  d = await drawn();
  add('claro: las series van con el acento del tema claro y los textos oscuros', d[1].bar === '#3f6a0a' && d[0].line === '#3f6a0a' && d[1].back === 'transparent' && d[1].title === '#1d2026', d.slice(0, 2));
  await shots('claro');
  await setUp('en', 'light', { accent: '#c2410c' }); await openDoc(three, '.lmd-diagram svg'); await app.waitForFunction(() => document.querySelectorAll('.markdown-body .lmd-diagram > svg').length === 3);
  d = await drawn();
  add('con un color de acento elegido, las series lo toman', d[1].bar === '#c2410c' && d[0].line === '#c2410c' && /^(#c2410c|rgb\(194, 65, 12\))$/.test(d[2].slice), [d.slice(0, 2).map((x) => [x.bar, x.line]), d[2].slice]);
  await setUp('en', 'dark', { preset: 'marea', presetDark: 'marea' }); await openDoc(three, '.lmd-diagram svg'); await app.waitForFunction(() => document.querySelectorAll('.markdown-body .lmd-diagram > svg').length === 3);
  d = await drawn();
  add('con un tema incluido, toman sus colores', d[1].bar === '#7cc4ff' && d[1].title === '#dfe7f5', d.slice(0, 2).map((x) => [x.bar, x.title]));

  // ---------- Teléfono ----------
  await app.setViewportSize({ width: 390, height: 800 });
  await setUp('en', 'light'); await openDoc(three, '.lmd-diagram svg'); await app.waitForFunction(() => document.querySelectorAll('.markdown-body .lmd-diagram > svg').length === 3);
  d = await drawn();
  const fits = await app.evaluate(() => document.documentElement.scrollWidth <= 390);
  add('a 390 px el gráfico se dibuja al ancho de la pantalla: entra sin achicar la letra', fits && d[0].inside && d[1].inside && d[0].w <= 390 && d[1].w <= 390 && d[1].vb <= 390 && d[1].w / d[1].vb > 0.95 && d[1].font >= 11.5, [fits, d.map((x) => [x.w, x.vb, x.font])]);
  if (SHOTS) { await app.locator('.markdown-body .lmd-diagram').nth(1).scrollIntoViewIfNeeded(); await app.screenshot({ path: path.join(SHOTS, 'telefono-barras-claro.png') }); }
  await edit(); await chart(0); s = await state();
  const phone = await app.evaluate(() => { const c = document.querySelector('.lmd-chart-card').getBoundingClientRect(); const f = [...document.querySelectorAll('.lmd-chart-form > *')].map((n) => Math.round(n.getBoundingClientRect().left)); const v = document.querySelector('.lmd-chart-view svg').getBoundingClientRect();
    return { card: [Math.round(c.left), Math.round(c.right)], stacked: new Set(f).size === 1, svg: Math.round(v.width), wide: document.documentElement.scrollWidth, ok: document.querySelector('.lmd-chart [data-chart=ok]').getBoundingClientRect().width > 60, types: [...document.querySelectorAll('.lmd-chart [data-ct]')].every((b) => b.scrollWidth <= b.clientWidth + 1) }; });
  add('a 390 px el cuadro entra en la pantalla, con los campos uno debajo del otro y la vista previa adentro', phone.card[0] >= 0 && phone.card[1] <= 390 && phone.stacked && phone.svg > 200 && phone.svg <= 366 && phone.wide <= 390 && phone.ok && phone.types && s.kind === 'xychart', phone);
  if (SHOTS) await app.screenshot({ path: path.join(SHOTS, 'telefono-cuadro-claro.png') });
  await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  await app.setViewportSize({ width: 1280, height: 900 });

  // ---------- En español ----------
  await setUp('es', 'light'); await openDoc(DOC); await edit();
  await app.locator('.markdown-body table').nth(2).locator('td.lmd-cell').first().click(); await app.waitForSelector('.lmd-tablebar:not([hidden])');
  const barEs = await app.evaluate(() => { const b = document.querySelector('.lmd-tablebar [data-top=chart]'); return [b.textContent.trim(), b.title]; });
  await app.click('[data-top=chart]'); await app.waitForSelector('.lmd-chart'); await settled(); s = await state();
  add('español: el botón, el cuadro y el aviso de la celda salen en español', J(barEs) === J(['Graficar', 'Dibujar un gráfico con los números de esta tabla']) && s.title === 'Graficar la tabla' && J(s.types) === J(['Barras*', 'Líneas', 'Torta']) && s.ok === 'Insertar gráfico' &&
    s.err === 'En la columna Saldo, la fila de Sur no es un número: n/d' && s.labels[2] === 'Número de fila', [barEs, s.title, s.types, s.err, s.labels]);
  if (SHOTS) await app.screenshot({ path: path.join(SHOTS, 'cuadro-error-claro.png') });
  await app.keyboard.press('Escape'); await app.waitForTimeout(200);
  await chart(0); await app.keyboard.press('ArrowRight'); await app.waitForTimeout(700); s = await state();
  add('el tipo se cambia con las flechas del teclado', J(s.types) === J(['Barras', 'Líneas*', 'Torta']) && await app.evaluate(() => document.activeElement.dataset.ct === 'line'), s.types);
  if (SHOTS) await app.screenshot({ path: path.join(SHOTS, 'cuadro-claro.png') });
  await app.keyboard.press('Control+Enter'); await app.waitForSelector('.lmd-chart', { state: 'detached' }); await app.waitForTimeout(900);
  md = await src();
  add('Ctrl+Enter inserta, y Ctrl+Z lo deshace', blocks(md).length === 1 && /line \[1234\.5, 2000, 3400\.25\]/.test(md));
  await app.locator('.markdown-body h1').click(); await app.keyboard.press('Escape'); await app.keyboard.press('Control+z'); await app.waitForTimeout(900);
  add('deshacer saca el gráfico y deja la nota como estaba', (await src()) === DOC, (await src()).slice(0, 300));
  add('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) {
  const seen = await app.evaluate(() => ({ diagrams: [...document.querySelectorAll('.markdown-body .lmd-diagram svg')].map((x) => x.getAttribute('aria-roledescription')), waiting: document.querySelectorAll('.markdown-body pre.lmd-mermaid').length, errs: [...document.querySelectorAll('.lmd-err-note')].map((x) => x.textContent.slice(0, 200)) })).catch(() => null);
  add('la prueba llegó hasta el final', false, [String(e && e.stack || e).slice(0, 500), seen, errors]);
}

console.log('Graficar una tabla');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 900))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
