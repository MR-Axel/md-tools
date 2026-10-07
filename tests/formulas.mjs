// Editor de fórmulas: insertar abre el editor, las piezas escriben el LaTeX dejando el hueco seleccionado, los
// errores de KaTeX se explican, una fórmula en línea se edita en su lugar, y con el plugin apagado no se ofrece.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const home = `chrome-extension://${id}/src/app.html`;
const B = String.fromCharCode(92); // la barra de LaTeX
const DOC = '# Doc\n\nThe **energy** is $E = mc^2$ for a body at rest, and $' + B + 'frac{a}{b$ is broken.\n\n$$\n' + B + 'int_{0}^{1} x^2 ' + B + ', dx\n$$\n\n$$a^2 + b^2 = c^2$$\n\n$$\n' + B + 'foo{x} + 1\n$$\n\n- item with $x_1$ inside\n\nEnd.\n';
const checks = []; const J = (v) => JSON.stringify(v);
const add = (name, ok, detail) => checks.push([name, !!ok, detail]);
const boot = async (settings, dirName) => {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate((s) => new Promise((resolve) => chrome.storage.local.set({ settings: s }, resolve)), Object.assign({ theme: 'dark', cloudUrl: 'off', updateCheck: 'off' }, settings));
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(async ([t, d]) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(d, { create: true });
    const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable(); await s.write(t); await s.close();
    window.showDirectoryPicker = async () => dir;
  }, [DOC, dirName]);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
};
const src = () => app.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const p = document.querySelector('pre.lmd-raw'); const v = t.hidden ? p.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
const ed = () => app.evaluate(() => {
  const t = document.querySelector('.lmd-fx textarea'); const e = document.querySelector('.lmd-fx .lmd-dgm-err'); const v = document.querySelector('.lmd-fx-view');
  return { code: t.value, sel: t.value.slice(t.selectionStart, t.selectionEnd), at: t.selectionStart, title: document.querySelector('.lmd-fx h3').textContent.trim(), drawn: !!v.querySelector('.katex'), text: v.textContent, stale: v.classList.contains('lmd-dgm-stale'),
    err: e.hidden ? '' : e.querySelector('.lmd-err-main').textContent.trim(), hint: e.hidden || !e.querySelector('.lmd-err-hint') ? '' : e.querySelector('.lmd-err-hint').textContent.trim(), detail: e.hidden ? null : { open: e.querySelector('details').open, text: e.querySelector('details pre').textContent },
    line: (document.querySelector('.lmd-fx .lmd-ed-bad') || {}).textContent || '', del: !!document.querySelector('.lmd-fx [data-fx-act=del]') };
});
const fill = async (text) => { await app.fill('.lmd-fx textarea', text); await app.waitForTimeout(450); };
const inl = () => app.evaluate(() => { const b = document.querySelector('.lmd-fxi'); if (!b) return null; const i = b.querySelector('input'); const e = b.querySelector('.lmd-fxi-err'); const r = b.getBoundingClientRect(); return { code: i.value, sel: i.value.slice(i.selectionStart, i.selectionEnd), drawn: !!b.querySelector('.lmd-fxi-view .katex'), err: e.hidden ? '' : e.querySelector('.lmd-err-main').textContent.trim(), in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, focus: document.activeElement === i }; });

try {
  await boot({ language: 'en' }, 'fx');
  await app.waitForSelector('.lmd-math-block .katex');
  // ---------- En el documento: una fórmula con error no muestra el mensaje crudo ----------
  const bad = await app.evaluate(() => { const b = document.querySelector('.lmd-math-block.lmd-math-bad'); const i = document.querySelector('p .lmd-math-bad'); return { block: b && { main: b.querySelector('.lmd-err-main').textContent.trim(), hint: b.querySelector('.lmd-err-hint').textContent.trim(), open: b.querySelector('details').open, raw: b.querySelector('details pre').textContent, code: b.querySelector(':scope > code').textContent }, inline: i && { text: i.textContent, title: i.title }, good: document.querySelectorAll('.lmd-math:not(.lmd-math-bad) .katex').length }; });
  add('documento: una fórmula en bloque con error muestra el aviso corto y el código', bad.block && /could not be drawn/.test(bad.block.main) && /command \\foo does not exist/.test(bad.block.main) && bad.block.code === B + 'foo{x} + 1' && !bad.block.open && /KaTeX parse error/.test(bad.block.raw), bad.block);
  add('documento: una fórmula en línea con error queda como código, con el aviso al pasar el mouse', bad.inline && bad.inline.text === B + 'frac{a}{b' && /brace is not closed/.test(bad.inline.title) && !/KaTeX/.test(bad.inline.title), bad.inline);
  add('documento: las fórmulas sanas se siguen dibujando', bad.good === 4, bad.good);

  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  const before = await src();
  // ---------- Insertar una fórmula abre el editor ----------
  await app.locator('.lmd-article h1').click({ button: 'right' }); await app.click('.lmd-menu [data-ins=math]'); await app.waitForSelector('.lmd-fx .lmd-fx-keys .katex');
  let s = await ed();
  add('insertar una fórmula abre el editor vacío, con el cursor en el código', s.title === 'New formula LaTeX' && s.code === '' && !s.del && await app.evaluate(() => document.activeElement === document.querySelector('.lmd-fx textarea')), s);
  add('nada se escribe en el documento hasta aplicar', (await src()) === before);
  const keys = await app.evaluate(() => ({ tabs: [...document.querySelectorAll('.lmd-fx [data-fx-tab]')].map((t) => t.textContent), first: [...document.querySelectorAll('.lmd-fx [data-fx-group="0"] [data-fx]')].map((b) => [b.title, !!b.querySelector('.katex'), /\\/.test(b.querySelector('.katex-html') ? b.querySelector('.katex-html').textContent : '\\')]), total: document.querySelectorAll('.lmd-fx [data-fx]').length, hidden: [...document.querySelectorAll('.lmd-fx [data-fx-group]')].map((g) => g.hidden) }));
  add('las piezas van agrupadas: estructuras, griegas, relaciones, operaciones y flechas', J(keys.tabs) === J(['Structures', 'Greek letters', 'Relations', 'Operations', 'Arrows']) && J(keys.hidden) === J([false, true, true, true, true]) && keys.total > 60, keys.tabs);
  const names = keys.first.map((k) => k[0]);
  add('están fracción, potencia, subíndice, raíz, sumatoria, integral, límite, matriz y sistema', ['Fraction', 'Power', 'Subscript', 'Root', 'Sum', 'Integral', 'Limit', 'Matrix', 'System of equations'].every((n) => names.includes(n)), names);
  add('cada pieza muestra su símbolo dibujado, no el código', keys.first.every((k) => k[1] && !k[2]), keys.first);
  // ---------- Piezas ----------
  await app.click('[data-fx="0:0"]'); await app.waitForTimeout(250); s = await ed();
  add('"Fracción" escribe el LaTeX y deja seleccionado el primer hueco', s.code === B + 'frac{a}{b}' && s.sel === 'a' && s.drawn, s);
  await app.keyboard.type('x + 1'); await app.keyboard.press('Tab'); await app.waitForTimeout(100); s = await ed();
  add('Tab pasa al hueco siguiente', s.code === B + 'frac{x + 1}{b}' && s.sel === 'b', s);
  await app.keyboard.type('2'); await app.keyboard.press('Control+z'); await app.waitForTimeout(100); s = await ed();
  add('Ctrl+Z deshace dentro del cuadro', s.code === B + 'frac{x + 1}{b}', s.code);
  await fill('x + 1'); await app.evaluate(() => document.querySelector('.lmd-fx textarea').setSelectionRange(0, 5));
  await app.click('[data-fx="0:0"]'); await app.waitForTimeout(200); s = await ed();
  add('con texto seleccionado, "Fracción" lo pone en el numerador y deja el denominador listo', s.code === B + 'frac{x + 1}{b}' && s.sel === 'b', s);
  await fill('x + 1'); await app.evaluate(() => document.querySelector('.lmd-fx textarea').setSelectionRange(0, 5));
  await app.click('[data-fx="0:1"]'); await app.waitForTimeout(200); s = await ed();
  add('"Potencia" agrupa lo seleccionado con llaves', s.code === '{x + 1}^{n}' && s.sel === 'n', s);
  await fill(''); await app.click('[data-fx="0:8"]'); await app.waitForTimeout(250); s = await ed();
  add('"Matriz" escribe el entorno completo, en varias líneas', s.code === B + 'begin{pmatrix}\n  a & b ' + B + B + '\n  c & d\n' + B + 'end{pmatrix}' && s.sel === 'a' && s.drawn && !s.err, s);
  await fill('x '); await app.keyboard.press('Control+End');
  await app.click('[data-fx-tab="1"]'); await app.click('[data-fx="1:0"]'); await app.keyboard.type('+ 1'); await app.waitForTimeout(350); s = await ed();
  add('una letra griega se inserta en el cursor, sin pegarse a lo que sigue', s.code === 'x ' + B + 'alpha + 1' && s.drawn && !s.err && await app.evaluate(() => !document.querySelector('.lmd-fx [data-fx-group="1"]').hidden && document.querySelector('.lmd-fx [data-fx-group="0"]').hidden), s);
  // ---------- Errores ----------
  const cases = [
    [B + 'frac{a}{b', '', /brace is not closed/, /Every \{ needs its \}/],
    [B + 'frac{a}', '', /\\frac is missing a part/, /\\frac\{1\}\{2\}/],
    ['x = ' + B + 'summ_{i=1}^{n}', '', /command \\summ does not exist/, /Did you mean \\sum\?/],
    ['a^b^c', '', /two powers in a row/, /a\^\{b\^c\}/],
    ['x_', '', /missing after _/, /x_\{i\}/],
    [B + 'left( x', '', /\\left is missing its \\right/, /pairs/],
    ['a = ' + B + 'begin{pmatrix}\n  1 & 2\n', '1', /\\begin\{pmatrix\} is never closed/, /\\end\{pmatrix\}/],
    ['a = 1\nb = ' + B + 'foo\nc = 3', '2', /command \\foo does not exist/, /spelling|Did you mean/],
    ['a & b', '', /& only goes inside a matrix/, /\\&/],
    ['x + 1}', '', /one \} too many/, /closes/],
  ];
  await fill(B + 'frac{a}{b}'); const wrong = [];
  for (const [code, line, main, hint] of cases) {
    await fill(code); s = await ed();
    if (!(main.test(s.err) && hint.test(s.hint) && s.line === line && s.stale && s.drawn && s.detail && !s.detail.open && /KaTeX parse error/.test(s.detail.text) && !/KaTeX|parse error|EOF/.test(s.err + s.hint))) wrong.push([code, s.line, s.err, s.hint]);
  }
  add('errores de KaTeX: mensaje corto, pista y la última vista buena atenuada en ' + cases.length + ' casos', !wrong.length, wrong);
  // ---------- Aplicar ----------
  await fill(B + 'frac{x + 1}{2}'); s = await ed();
  add('al corregir se va el error', !s.err && !s.stale && !s.line && s.drawn, s);
  await app.keyboard.press('Control+Enter'); await app.waitForTimeout(900);
  let md = await src();
  add('Ctrl+Enter escribe la fórmula con $$ en líneas propias, debajo del bloque', md.startsWith('# Doc\n\n$$\n' + B + 'frac{x + 1}{2}\n$$\n\nThe **energy**'), md.slice(0, 80));
  add('y queda dibujada en el documento', await app.evaluate(() => { const m = document.querySelector('.lmd-math-block'); return m.getAttribute('data-tex') + '|' + !!m.querySelector('.katex'); }) === B + 'frac{x + 1}{2}|true');
  // cancelar una fórmula nueva no deja nada
  await app.locator('.lmd-article h1').click({ button: 'right' }); await app.click('.lmd-menu [data-ins=math]'); await app.waitForSelector('.lmd-fx');
  await app.keyboard.type('y = 2'); await app.keyboard.press('Escape'); await app.waitForTimeout(300);
  add('cancelar una fórmula nueva no escribe nada', (await src()) === md && await app.evaluate(() => !document.querySelector('.lmd-fx')));
  // ---------- Editar una fórmula en bloque existente ----------
  await app.click('.lmd-math-block >> nth=1'); await app.waitForSelector('.lmd-fx'); s = await ed();
  add('clic en una fórmula en bloque abre el editor con su contenido', s.title === 'Edit formula LaTeX' && s.code === B + 'int_{0}^{1} x^2 ' + B + ', dx' && s.del && s.drawn, s);
  await app.keyboard.press('Control+End'); await app.keyboard.type(' = ' + B + 'frac{1}{3}'); await app.click('.lmd-fx [data-fx-act=ok]'); await app.waitForTimeout(800);
  md = await src();
  add('aplicar reescribe solo ese bloque', md.includes('$$\n' + B + 'int_{0}^{1} x^2 ' + B + ', dx = ' + B + 'frac{1}{3}\n$$\n\n$$a^2 + b^2 = c^2$$') && md.includes('$E = mc^2$'), md);
  await app.click('.lmd-math-block >> nth=2'); await app.waitForSelector('.lmd-fx'); await app.keyboard.press('Control+End'); await app.keyboard.type(' + 0'); await app.keyboard.press('Control+Enter'); await app.waitForTimeout(800);
  md = await src();
  add('una fórmula escrita en una sola línea queda en el formato estándar al editarla', md.includes('\n\n$$\na^2 + b^2 = c^2 + 0\n$$\n\n'), md);
  await app.click('.lmd-math-block.lmd-math-bad'); await app.waitForSelector('.lmd-fx'); s = await ed();
  add('una fórmula con error se abre igual, con el error explicado', s.code === B + 'foo{x} + 1' && /command \\foo does not exist/.test(s.err), s);
  await app.click('.lmd-fx [data-fx-act=del]'); await app.waitForTimeout(700);
  md = await src();
  add('"Eliminar la fórmula" la saca del documento', !md.includes(B + 'foo') && md.includes('c^2 + 0\n$$\n\n- item with'), md);

  // ---------- Fórmula en línea ----------
  await app.click('.lmd-article p .lmd-math >> nth=0'); await app.waitForSelector('.lmd-fxi .lmd-fx-keys .katex'); await app.waitForTimeout(200);
  let i = await inl();
  add('tocar una fórmula en línea abre un cuadro chico anclado, con su LaTeX', i && i.code === 'E = mc^2' && i.drawn && i.in && i.focus && await app.evaluate(() => { const b = document.querySelector('.lmd-fxi').getBoundingClientRect(); const m = document.querySelector('.lmd-article p .lmd-math').getBoundingClientRect(); return b.width < 480 && Math.abs(b.top - m.bottom) < 30; }), i);
  await app.keyboard.press('End'); await app.keyboard.type(' + ' + B + 'frac{p^2'); await app.waitForTimeout(400); i = await inl();
  add('el error en línea también se explica', /brace is not closed/.test(i.err) && i.drawn, i);
  await app.keyboard.type('}{2m}'); await app.waitForTimeout(350); i = await inl();
  await app.keyboard.press('Enter'); await app.waitForTimeout(900);
  md = await src();
  add('Enter aplica: cambia solo la fórmula y el resto del párrafo queda igual', !i.err && md.includes('The **energy** is $E = mc^2 + ' + B + 'frac{p^2}{2m}$ for a body at rest, and $' + B + 'frac{a}{b$ is broken.') && await app.evaluate(() => !document.querySelector('.lmd-fxi')), md.split('\n')[6]);
  add('el párrafo sigue dibujado, con la negrita y la fórmula nueva', await app.evaluate(() => { const p = document.querySelector('.lmd-article p'); return !!p.querySelector('strong') && p.querySelector('.lmd-math').getAttribute('data-tex').includes('frac{p^2}{2m}') && !!p.querySelector('.lmd-math .katex'); }));
  await app.click('.lmd-article p .lmd-math >> nth=0'); await app.waitForSelector('.lmd-fxi'); await app.keyboard.type('zzz'); await app.keyboard.press('Escape'); await app.waitForTimeout(600);
  add('Escape cancela la edición en línea', (await src()) === md && await app.evaluate(() => !document.querySelector('.lmd-fxi')));
  await app.click('.lmd-article li .lmd-math'); await app.waitForSelector('.lmd-fxi'); await app.waitForTimeout(150);
  await app.click('.lmd-fxi [data-fx="0:3"]'); await app.waitForTimeout(250); i = await inl();
  add('las piezas también andan en línea, envolviendo lo seleccionado', i.code === B + 'sqrt{x_1}', i);
  await app.click('.lmd-fxi [data-fx-act=ok]'); await app.waitForTimeout(900); md = await src();
  add('una fórmula en un ítem de lista se edita igual', md.includes('- item with $' + B + 'sqrt{x_1}$ inside'), md);
  await app.click('.lmd-article p .lmd-math-bad'); await app.waitForSelector('.lmd-fxi'); await app.click('.lmd-fxi [data-fx-act=del]'); await app.waitForTimeout(900); md = await src();
  add('"Eliminar la fórmula" en línea saca solo la fórmula', md.includes('for a body at rest, and  is broken.') || md.includes('for a body at rest, and is broken.'), md.split('\n')[6]);
  await app.click('.lmd-article p .lmd-math >> nth=0'); await app.waitForSelector('.lmd-fxi'); await app.keyboard.press('End'); await app.keyboard.type(' + 1');
  await app.locator('.lmd-article h1').click(); await app.waitForTimeout(900); md = await src();
  add('hacer clic afuera aplica lo escrito', /2m\} \+ 1\$ for a body/.test(md) && await app.evaluate(() => !document.querySelector('.lmd-fxi')), md.split('\n')[6]);
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(500);

  // ---------- A 390 px ----------
  await app.click('.lmd-math-block >> nth=0'); await app.waitForSelector('.lmd-fx');
  await app.setViewportSize({ width: 390, height: 800 }); await app.waitForTimeout(300);
  const narrow = await app.evaluate(() => { const c = document.querySelector('.lmd-fx .lmd-ed-code').getBoundingClientRect(); const v = document.querySelector('.lmd-fx .lmd-dgm-view').getBoundingClientRect(); const card = document.querySelector('.lmd-fx .lmd-dgm-card').getBoundingClientRect(); return { stacked: v.top >= c.bottom - 1, fits: card.left >= 0 && card.right <= 390 && document.documentElement.scrollWidth <= 390, code: Math.round(c.height), view: Math.round(v.height) }; });
  add('a 390 px el código queda arriba y la vista previa abajo', narrow.stacked && narrow.fits && narrow.code > 100 && narrow.view > 100, narrow);
  await app.keyboard.press('Escape'); await app.setViewportSize({ width: 1280, height: 800 }); await app.waitForTimeout(300);

  // ---------- En español ----------
  await boot({ language: 'es' }, 'fx2');
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await app.locator('.lmd-article h1').click({ button: 'right' }); await app.click('.lmd-menu [data-ins=math]'); await app.waitForSelector('.lmd-fx .lmd-fx-keys .katex');
  await fill(B + 'frac{a}{b'); s = await ed();
  add('español: títulos, piezas y errores en español', s.title === 'Fórmula nueva LaTeX' && /Falta cerrar una llave/.test(s.err) && await app.evaluate(() => document.querySelector('.lmd-fx [data-fx="0:0"]').title === 'Fracción' && document.querySelector('.lmd-fx [data-fx-tab="1"]').textContent === 'Letras griegas'), [s.title, s.err]);
  await fill(''); await app.click('[data-fx="0:11"]'); await app.waitForTimeout(200); s = await ed();
  add('español: la pieza de texto sale en español', s.code === B + 'text{texto}' && s.sel === 'texto', s);
  await app.keyboard.press('Escape');

  // ---------- Fórmula en línea nueva, desde la barra de formato ----------
  const pick = async (word) => {
    const ok = await app.evaluate((w) => {
      const p = [...document.querySelectorAll('.lmd-article p.lmd-editable')].find((x) => x.textContent.includes(w)); if (!p) return false;
      p.focus(); const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) { const i = n.nodeValue.indexOf(w); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; } }
      return false;
    }, word);
    await app.waitForTimeout(350); return ok;
  };
  await boot({ language: 'en' }, 'fx4');
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await pick('body');
  const bar = await app.evaluate(() => { const b = document.querySelector('.lmd-format'); const m = b.querySelector('[data-fmt=math]'); const r = b.getBoundingClientRect(); return { shown: !b.hidden && !m.hidden, title: m.title, inside: r.left >= 0 && r.right <= innerWidth, order: [...b.querySelectorAll('button')].map((x) => x.dataset.fmt) }; });
  add('la barra de formato ofrece "Fórmula en línea"', bar.shown && bar.title === 'Inline formula' && bar.inside && bar.order.indexOf('math') === bar.order.indexOf('link') - 1, bar);
  await app.dispatchEvent('.lmd-format [data-fmt=math]', 'mousedown'); await app.waitForSelector('.lmd-fxi');
  const fresh = await app.evaluate(() => { const b = document.querySelector('.lmd-fxi'); return { label: b.getAttribute('aria-label'), value: b.querySelector('input').value, del: !!b.querySelector('[data-fx-act=del]'), focus: document.activeElement === b.querySelector('input'), text: document.querySelector('.lmd-article p').textContent.includes('a body at rest') }; });
  add('abre el cuadro chico con lo elegido, sin tocar el párrafo', fresh.label === 'Inline formula' && fresh.value === 'body' && !fresh.del && fresh.focus && fresh.text, fresh);
  await app.keyboard.press('Escape'); await app.waitForTimeout(600);
  const kept = await src();
  add('cancelar deja el texto como estaba', kept === DOC, kept.slice(0, 120));
  await pick('body');
  await app.dispatchEvent('.lmd-format [data-fmt=math]', 'mousedown'); await app.waitForSelector('.lmd-fxi');
  await app.fill('.lmd-fxi input', 'x_1'); await app.waitForTimeout(300);
  const drawn = await app.evaluate(() => !!document.querySelector('.lmd-fxi-view .katex'));
  await app.keyboard.press('Enter'); await app.waitForTimeout(900);
  const made = await src();
  add('aplicar cambia lo elegido por la fórmula, y nada más', drawn && made === DOC.replace('a body at rest', 'a $x_1$ at rest'), made.slice(0, 140));
  const shown = await app.evaluate(() => { const m = [...document.querySelectorAll('.lmd-article p .lmd-math')].find((x) => x.getAttribute('data-tex') === 'x_1'); return !!(m && m.querySelector('.katex')); });
  add('y queda dibujada en el párrafo', shown);
  await pick('energy'); // adentro de una negrita se puede; adentro de un enlace o de otra fórmula, no
  await app.keyboard.press('Escape'); await app.waitForTimeout(300);

  // ---------- Con el plugin de matemática apagado ----------
  await boot({ language: 'en', plugins: { katex: false } }, 'fx3');
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  await pick('body');
  const noMath = await app.evaluate(() => { const b = document.querySelector('.lmd-format'); return !b.hidden && b.querySelector('[data-fmt=math]').hidden; });
  add('con la matemática apagada, la barra de formato no ofrece la fórmula en línea', noMath);
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(300);
  await app.locator('.lmd-article h1').click({ button: 'right' }); await app.waitForSelector('.lmd-menu');
  const off = await app.evaluate(() => ({ math: !!document.querySelector('.lmd-menu [data-ins=math]'), table: !!document.querySelector('.lmd-menu [data-ins=table]'), nodes: document.querySelectorAll('.lmd-math').length, text: document.querySelector('.lmd-article p').textContent }));
  add('con la matemática apagada, "Fórmula" no se ofrece y el resto del menú sigue', !off.math && off.table && off.nodes === 0 && off.text.includes('$E = mc^2$'), off);
  await app.keyboard.press('Escape');
  add('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { add('la prueba llegó hasta el final', false, String(e && e.stack || e).slice(0, 700)); }

console.log('Editor de fórmulas');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 700))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
