// Listas como en un procesador de textos: renumerar al insertar, borrar o mover, Tab y Shift+Tab con hijos,
// el estilo de cada nivel, Enter en un ítem vacío, tareas, deshacer en un paso, y la vista de código.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('.lmd-home');
await app.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('listas', { create: true });
  const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable(); await s.write('# Doc\n\n1. uno\n2. dos\n'); await s.close();
  window.showDirectoryPicker = async () => dir;
});
await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');

const J = (v) => JSON.stringify(v);
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 900))); };
const sleep = (ms) => app.waitForTimeout(ms);
// El Markdown de ahora, sin tocar el foco (con los títulos sin numerar es el texto tal cual).
const src = async () => (await app.evaluate(() => LMD.page.md())).replace(/\r/g, '');
const body = async () => (await src()).replace(/^# Doc\n\n/, '').replace(/\n+$/, '').split('\n');
const disk = () => app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('listas'); return (await (await (await dir.getFileHandle('doc.md')).getFile()).text()); });
// Deja la nota con ese texto, en edición sobre el elemento.
const setDoc = async (lines) => {
  await app.click('[data-act=view-raw]'); await app.waitForSelector('.lmd-raw-edit:not([hidden])');
  await app.evaluate((t) => { const a = document.querySelector('.lmd-raw-edit'); a.focus(); a.value = t; a.dispatchEvent(new Event('input', { bubbles: true })); }, '# Doc\n\n' + lines.join('\n') + '\n');
  await sleep(350); await app.click('[data-act=view-doc]'); await sleep(250);
};
const item = (t) => app.locator('.lmd-article li .lmd-editable', { hasText: t }).first();
const blur = () => app.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
const focusText = () => app.evaluate(() => (document.activeElement && document.activeElement.textContent) || '');
const undo = async () => { await blur(); await sleep(80); await app.keyboard.press('Control+z'); await sleep(250); };

await app.click('[data-act=mode-edit]'); await sleep(300);

// ---------- Renumerar ----------
console.log('Listas numeradas: los números se ponen al día');
const DOC1 = ['3. uno', '4. dos', '5. tres', '', 'Medio.', '', '1. otra', '2. lista', '', '```', '1. x', '1. y', '```'];
await setDoc(DOC1);
await item('uno').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.type('nuevo', { delay: 15 }); await sleep(1500);
let b = await body();
check('un ítem nuevo en el medio renumera los que siguen, sin salir del ítem', J(b.slice(0, 4)) === J(['3. uno', '4. nuevo', '5. dos', '6. tres']) && (await focusText()) === 'nuevo', b);
check('la lista arranca en el número que tenía', b[0] === '3. uno' && (await app.evaluate(() => document.querySelector('.lmd-article ol').getAttribute('start'))) === '3', b[0]);
check('la otra lista del documento y el bloque de código quedan como estaban', J(b.slice(4)) === J(DOC1.slice(3)), b.slice(4));
await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(250);
await undo();
check('deshacer vuelve atrás el ítem y la renumeración en un solo paso', J(await body()) === J(DOC1), await body());
await app.keyboard.press('Control+y'); await sleep(250);
check('y rehacer los trae de vuelta', J((await body()).slice(0, 4)) === J(['3. uno', '4. nuevo', '5. dos', '6. tres']), await body());

await setDoc(DOC1);
await item('dos').click(); await app.keyboard.press('Control+a'); await app.keyboard.press('Delete'); await app.keyboard.press('Backspace'); await sleep(300);
b = await body();
check('borrar un ítem del medio renumera, y el cursor queda en el de arriba', J(b.slice(0, 3)) === J(['3. uno', '4. tres', '']) && (await focusText()) === 'uno' && J(b.slice(2)) === J(DOC1.slice(3)), [b, await focusText()]);
await setDoc(DOC1);
await item('uno').click(); await app.keyboard.press('Control+a'); await app.keyboard.press('Delete'); await app.keyboard.press('Backspace'); await sleep(300);
check('borrar el primero deja la lista arrancando en el mismo número', J((await body()).slice(0, 2)) === J(['3. dos', '4. tres']), await body());

await setDoc(['7. uno', '8. dos', '   - hijo', '9. tres']);
await item('dos').click(); await app.keyboard.press('Alt+ArrowUp'); await sleep(300);
check('Alt+flecha arriba mueve el ítem con sus hijos y la cuenta sigue desde el primero', J(await body()) === J(['7. dos', '   - hijo', '8. uno', '9. tres']) && (await focusText()).trim() === 'dos', [await body(), await focusText()]);
await app.keyboard.press('Alt+ArrowDown'); await app.keyboard.press('Alt+ArrowDown'); await sleep(300);
check('y Alt+flecha abajo lo baja', J(await body()) === J(['7. uno', '8. tres', '9. dos', '   - hijo']), await body());

const wide = await app.evaluate(() => (LMD.lists.renumber(['8. a', '9. b', '9. c', '   - hijo', '9. d'], 0, 0) || []).join('|'));
check('al pasar de un dígito a dos, lo que cuelga del ítem se corre con él', wide === '8. a|9. b|10. c|    - hijo|11. d', wide);
const code = await app.evaluate(() => LMD.lists.renumber(['1. a', '2. b', '', '```', '1. x', '1. y', '```', '', '    1. z', '    1. w'], 0));
check('los números dentro de un bloque de código no se tocan', code === null, code);

// ---------- Niveles ----------
console.log('Tab y Shift+Tab');
const DOC2 = ['1. alfa', '2. beta', '3. gama', '   - hijo', '4. delta'];
await setDoc(DOC2);
await item('gama').click(); await app.keyboard.press('End'); await app.keyboard.press('Tab'); await sleep(300);
check('Tab sangra el ítem con sus hijos, arranca de 1 en su nivel y renumera el de origen', J(await body()) === J(['1. alfa', '2. beta', '   1. gama', '      - hijo', '3. delta']), await body());
check('el cursor sigue en el mismo ítem', (await focusText()).trim().startsWith('gama') && await app.evaluate(() => { const s = getSelection(); return s.isCollapsed && s.focusOffset === 4; }), await focusText());
const nestedOk = await app.evaluate(() => { const li = [...document.querySelectorAll('.lmd-article li')].find((x) => /^gama/.test(x.textContent.trim())); return !!li && li.parentNode.tagName === 'OL' && li.parentNode.parentNode.tagName === 'LI' && !!li.querySelector('ul li'); });
check('el analizador lo dibuja como sublista, con su hijo adentro', nestedOk);
await undo();
check('deshacer el Tab es un solo paso', J(await body()) === J(DOC2), await body());
await item('gama').click(); await app.keyboard.press('Tab'); await sleep(250); await app.keyboard.press('Shift+Tab'); await sleep(300);
check('Shift+Tab lo saca un nivel y todo vuelve a su número', J(await body()) === J(DOC2), await body());
await item('alfa').click(); await app.keyboard.press('Tab'); await sleep(250);
check('el primero de una lista no tiene de quién colgar: Tab no cambia nada', J(await body()) === J(DOC2), await body());
await item('delta').click(); await app.keyboard.press('Shift+Tab'); await sleep(250);
check('y Shift+Tab en el primer nivel tampoco', J(await body()) === J(DOC2), await body());

await setDoc(['1. alfa', '   1. uno', '   2. dos', '   3. tres', '2. beta']);
await item('dos').click(); await app.keyboard.press('Shift+Tab'); await sleep(300);
check('al sacar un nivel a un ítem del medio, los que seguían quedan colgando de él y arrancan de 1', J(await body()) === J(['1. alfa', '   1. uno', '2. dos', '   1. tres', '3. beta']), await body());
await setDoc(['10. alfa', '11. beta', '', '- gama', '- delta', '', '* uno', '* dos']);
await item('beta').click(); await app.keyboard.press('Tab'); await sleep(250);
await item('delta').click(); await app.keyboard.press('Tab'); await sleep(250);
await item('dos').click(); await app.keyboard.press('Tab'); await sleep(250);
b = await body();
check('la sangría es la columna del texto del padre: 4 espacios bajo "10.", 2 bajo una viñeta, y la marca se conserva', J(b) === J(['10. alfa', '    1. beta', '', '- gama', '  - delta', '', '* uno', '  * dos']), b);
check('y markdown-it las toma como sublistas', await app.evaluate(() => document.querySelectorAll('.lmd-article li li').length) === 3);

// Un ítem nuevo, todavía vacío
await setDoc(['1. alfa', '2. beta']);
await item('alfa').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.press('Tab');
await app.keyboard.type('hijo', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.type('otro hijo', { delay: 15 }); await app.keyboard.press('Enter');
await app.keyboard.press('Enter'); await app.keyboard.type('tio', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(300);
check('Enter y Tab abren un sub-ítem; Enter en uno vacío y sangrado sube un nivel', J(await body()) === J(['1. alfa', '   1. hijo', '   2. otro hijo', '2. tio', '3. beta']), await body());
await item('beta').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.type('gama', { delay: 15 }); await sleep(1400);
await app.keyboard.press('Tab'); await sleep(300);
check('Tab en un ítem nuevo que ya tiene texto lo sangra igual', J((await body()).slice(-2)) === J(['3. beta', '   1. gama']) && (await focusText()).trim() === 'gama', [await body(), await focusText()]);
await blur();

// ---------- Ítem vacío y Backspace ----------
console.log('Enter en un ítem vacío y Backspace al inicio');
await setDoc(['1. alfa', '2. beta', '', 'Fin.']);
await item('beta').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.press('Enter'); await app.keyboard.type('afuera', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(300);
check('Enter en un ítem nuevo vacío sale de la lista', J(await body()) === J(['1. alfa', '2. beta', '', 'afuera', '', 'Fin.']), await body());
await setDoc(['1. alfa', '2. ', '3. gama']);
await app.locator('.lmd-article li .lmd-li-text[data-ph]').first().click(); await app.keyboard.press('Enter'); await sleep(300);
check('Enter en un ítem vacío que ya estaba lo saca y renumera', J(await body()) === J(['1. alfa', '2. gama']) && await app.evaluate(() => { const a = document.activeElement; return !!a && a.classList.contains('lmd-draft') && a.tagName === 'P'; }), await body());
await app.keyboard.press('Escape'); await sleep(200);
await setDoc(['1. alfa', '   1. hijo', '   2. ', '2. beta']);
await app.locator('.lmd-article li li .lmd-li-text[data-ph]').first().click(); await app.keyboard.press('Enter'); await sleep(300);
check('y si estaba sangrado, sube un nivel', J(await body()) === J(['1. alfa', '   1. hijo', '2. ', '3. beta']), await body());
await blur();
await setDoc(['1. alfa', '2. beta', '3. gama']);
await item('beta').click(); await app.keyboard.press('Home'); await app.keyboard.press('Backspace'); await sleep(300);
check('Backspace al inicio de un ítem lo saca de la lista: queda un párrafo y la cuenta sigue', J(await body()) === J(['1. alfa', '', 'beta', '', '2. gama']) && (await focusText()) === 'beta', [await body(), await focusText()]);
await undo();
check('y se deshace en un paso', J(await body()) === J(['1. alfa', '2. beta', '3. gama']), await body());
await setDoc(['- alfa', '  - hijo', '- beta']);
await item('hijo').click(); await app.keyboard.press('Home'); await app.keyboard.press('Backspace'); await sleep(300);
check('en un ítem sangrado, Backspace al inicio lo sube un nivel', J(await body()) === J(['- alfa', '- hijo', '- beta']), await body());
await item('beta').click(); await app.keyboard.press('End'); await app.keyboard.press('Backspace'); await sleep(200);
check('Backspace en el medio del texto sigue borrando una letra', (await focusText()) === 'bet', await focusText());
await blur(); await sleep(300);

// ---------- Tareas ----------
console.log('Listas de tareas');
await setDoc(['- [ ] t1', '- [x] t2', '- [ ] t3']);
await item('t2').click(); await app.keyboard.press('Tab'); await sleep(300);
check('Tab sangra una tarea y conserva su casilla', J(await body()) === J(['- [ ] t1', '  - [x] t2', '- [ ] t3']) && await app.evaluate(() => { const b = [...document.querySelectorAll('.lmd-article input.lmd-task')]; return b.length === 3 && b[1].checked && !!b[1].closest('li li'); }), await body());
await app.keyboard.press('Shift+Tab'); await sleep(300);
check('Shift+Tab la devuelve', J(await body()) === J(['- [ ] t1', '- [x] t2', '- [ ] t3']), await body());
await item('t3').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.type('t4', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Tab'); await app.keyboard.type('sub', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(300);
check('Enter sigue agregando tareas, y Tab en una nueva la cuelga de la de arriba con su casilla', J(await body()) === J(['- [ ] t1', '- [x] t2', '- [ ] t3', '- [ ] t4', '  - [ ] sub']), await body());

// ---------- Arrancar una lista ----------
console.log('Arrancar una lista escribiendo');
await setDoc(['Texto.']);
await app.locator('.lmd-article p.lmd-editable', { hasText: 'Texto.' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter');
await app.keyboard.type('3. ', { delay: 20 });
const kind = await app.evaluate(() => (document.activeElement.dataset || {}).kind || '');
await app.keyboard.type('tercero', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.type('cuarto', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(300);
check('"3. " en un párrafo vacío arranca una lista numerada desde 3', kind === 'ol' && J(await body()) === J(['Texto.', '', '3. tercero', '4. cuarto']), [kind, await body()]);
await app.locator('.lmd-article p.lmd-editable', { hasText: 'Texto.' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter');
await app.keyboard.type('- ', { delay: 20 }); await app.keyboard.type('viñeta', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(300);
check('y "- " arranca una de viñetas', J((await body()).slice(0, 4)) === J(['Texto.', '', '- viñeta', '']), await body());

// ---------- Estilo por nivel ----------
console.log('Estilo de cada nivel');
await setDoc(['1. a', '   1. b', '      1. c', '         1. d', '', 'Corte.', '', '- a', '  - b', '    - c', '', 'Otro corte.', '', '- a', '  1. b', '     1. c']);
const styles = () => app.evaluate(() => { const art = document.querySelector('.lmd-article'); const of = (sel) => [...art.querySelectorAll(sel)].map((n) => getComputedStyle(n).listStyleType);
  const lists = [...art.children].filter((n) => /^(OL|UL)$/.test(n.tagName)); const chain = (n) => { const out = []; while (n) { out.push(getComputedStyle(n).listStyleType); n = n.querySelector(':scope > li > ol, :scope > li > ul'); } return out; };
  return lists.map(chain); });
let st = await styles();
check('numeradas: 1, a, i y de nuevo 1', J(st[0]) === J(['decimal', 'lower-alpha', 'lower-roman', 'decimal']), st[0]);
check('viñetas: disco, círculo y cuadrado', J(st[1]) === J(['disc', 'circle', 'square']), st[1]);
check('una numerada dentro de una de viñetas es de primer nivel: números, y letras la que sigue', J(st[2]) === J(['disc', 'decimal', 'lower-alpha']), st[2]);
check('en el archivo siguen siendo números', (await body())[1] === '   1. b' && (await body())[2] === '      1. c');
await app.click('[data-act=mode-read]'); await sleep(400);
st = await styles();
check('y leyendo se ven igual', J(st[0]) === J(['decimal', 'lower-alpha', 'lower-roman', 'decimal']) && J(st[1]) === J(['disc', 'circle', 'square']), st);
await app.emulateMedia({ media: 'print' }); st = await styles(); await app.emulateMedia({ media: null });
check('al imprimir (y en el PDF) también', J(st[0]) === J(['decimal', 'lower-alpha', 'lower-roman', 'decimal']), st[0]);
const css = { html: fs.readFileSync(path.join(root, 'src', 'extras.js'), 'utf8'), site: fs.readFileSync(path.join(root, 'server', 'server.mjs'), 'utf8'), docx: fs.readFileSync(path.join(root, 'src', 'docx.js'), 'utf8') };
check('el HTML exportado y los sitios publicados llevan la misma regla', /'ol ol,ol ol ol ol ol\{list-style-type:lower-alpha\}/.test(css.html) && /\.sp-body ol ol,\.sp-body ol ol ol ol ol\{list-style-type:lower-alpha\}/.test(css.site) && /\.sp-body ol ol ol,[^{]*\{list-style-type:lower-roman\}/.test(css.site));
check('y Word numera cada nivel con el mismo estilo', /NUMFMT = \['decimal', 'lowerLetter', 'lowerRoman'\]/.test(css.docx));

// Solo lectura: nada cambia
const before = await src();

await app.locator('.lmd-article ol li').first().click(); await app.keyboard.press('Alt+ArrowDown'); await app.keyboard.press('Backspace'); await app.keyboard.press('Tab'); await sleep(250);
check('leyendo, esas teclas no cambian la nota', (await src()) === before && !(await app.evaluate(() => document.documentElement.classList.contains('lmd-editing'))));
await app.click('[data-act=mode-edit]'); await sleep(300);

// ---------- Guardado ----------
await setDoc(['1. uno', '2. dos']);
await item('uno').click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.keyboard.type('medio', { delay: 15 }); await app.keyboard.press('Enter'); await app.keyboard.press('Escape'); await sleep(200);
await app.keyboard.press('Control+s'); await sleep(900);
check('lo renumerado es lo que se guarda en el archivo', /1\. uno\r?\n2\. medio\r?\n3\. dos/.test(await disk()), await disk());

// ---------- Vista de código ----------
console.log('En la vista de código');
await app.click('[data-act=view-raw]'); await app.waitForSelector('.lmd-raw-edit:not([hidden])');
const area = (lines) => app.evaluate((t) => { const a = document.querySelector('.lmd-raw-edit'); a.focus(); a.value = t; a.dispatchEvent(new Event('input', { bubbles: true })); }, lines.join('\n'));
const val = async () => (await app.evaluate(() => document.querySelector('.lmd-raw-edit').value)).split('\n');
// El cursor al final de una línea (o, con col, en esa columna).
const caret = (line, col) => app.evaluate(([l, c]) => { const a = document.querySelector('.lmd-raw-edit'); const ls = a.value.split('\n'); let p = 0; for (let i = 0; i < l; i++) p += ls[i].length + 1; p += c == null ? ls[l].length : c; a.focus(); a.setSelectionRange(p, p); }, [line, col == null ? null : col]);
const RAW = ['5. uno', '6. dos', '7. tres', '', '```', '1. x', '1. y', '```', '', '1. otra', '1. lista'];
await area(RAW); await caret(0); await app.keyboard.press('Enter'); await sleep(150);
let v = await val();
check('Enter al final de un ítem abre el siguiente y renumera esa lista', J(v.slice(0, 4)) === J(['5. uno', '6. ', '7. dos', '8. tres']) && J(v.slice(4)) === J(RAW.slice(3)), v);
await app.keyboard.press('Control+z'); await sleep(150);
check('y un solo Ctrl+Z lo deshace', J(await val()) === J(RAW), await val());
await caret(0); await app.keyboard.press('Enter'); await app.keyboard.type('nuevo'); await app.keyboard.press('Enter'); await sleep(100); await app.keyboard.press('Enter'); await sleep(150);
v = await val();
check('Enter en un ítem vacío de primer nivel le saca la marca', J(v.slice(0, 5)) === J(['5. uno', '6. nuevo', '', '7. dos', '8. tres']), v);
await area(RAW); await caret(2); await app.keyboard.press('Tab'); await sleep(150);
check('Tab sangra el ítem bajo el de arriba, desde 1', J((await val()).slice(0, 3)) === J(['5. uno', '6. dos', '   1. tres']) && await app.evaluate(() => { const a = document.querySelector('.lmd-raw-edit'); return a.value.slice(0, a.selectionStart).split('\n').pop() === '   1. tres'; }), await val());
await app.keyboard.press('Enter'); await sleep(100); await app.keyboard.press('Enter'); await sleep(150);
check('Enter en un ítem vacío y sangrado lo sube un nivel', J((await val()).slice(0, 4)) === J(['5. uno', '6. dos', '   1. tres', '7. ']), await val());
await area(RAW); await caret(2); await app.keyboard.press('Tab'); await sleep(100); await app.keyboard.press('Shift+Tab'); await sleep(150);
check('Shift+Tab lo devuelve', J(await val()) === J(RAW), await val());
await caret(1); await app.keyboard.press('Alt+ArrowUp'); await sleep(150);
check('Alt+flecha arriba mueve el ítem', J((await val()).slice(0, 3)) === J(['5. dos', '6. uno', '7. tres']), await val());
await area(RAW); await app.evaluate(() => { const a = document.querySelector('.lmd-raw-edit'); a.focus(); a.setSelectionRange(7, 14); }); await app.keyboard.press('Delete'); await sleep(200);
v = await val();
check('borrar un renglón de la lista la renumera, sin tocar el código ni la otra lista', J(v) === J(['5. uno', '6. tres', '', '```', '1. x', '1. y', '```', '', '1. otra', '1. lista']), v);
await area(['Texto', 'común']); await caret(0);
const tabOut = await app.evaluate(() => new Promise((resolve) => { const a = document.querySelector('.lmd-raw-edit'); const on = (e) => { a.removeEventListener('keydown', on); setTimeout(() => resolve(e.defaultPrevented), 0); }; a.addEventListener('keydown', on); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); }));
check('fuera de una lista, Tab sigue siendo del navegador', tabOut === false && J(await val()) === J(['Texto', 'común']), tabOut);
await area(['- [ ] a', '- [ ] b']); await caret(1); await app.keyboard.press('Tab'); await sleep(100); await caret(1); await app.keyboard.press('Enter'); await sleep(150);
check('las tareas se sangran y siguen con su casilla', J(await val()) === J(['- [ ] a', '  - [ ] b', '  - [ ] ']), await val());
await sleep(350); await app.click('[data-act=view-doc]'); await sleep(300);
check('lo hecho en la vista de código queda en la nota', await app.evaluate(() => document.querySelectorAll('.lmd-article li li').length) >= 1);

check('sin errores de JavaScript', errors.length === 0, errors);
const bad = results.filter((r) => !r).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
