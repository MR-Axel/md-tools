// Plegar y desplegar (src/fold.js): las secciones desplegables (::: details) hechas y editadas desde la interfaz,
// y el plegado por títulos, que es de quien lee y no toca la nota.
import { rig, tally, sleep } from './rig.mjs';

const R = await rig({});
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(o.who || null, o.ctx);
  await page.addInitScript(([base, lang, fold, tools]) => { try { if (localStorage.getItem('fold:listo')) return; localStorage.setItem('fold:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, foldHeadings: fold, tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', !!o.fold, o.tools || {}]);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
async function note(page, name, text, edit) {
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
  await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
// El archivo guardado, cuando ya cumple lo que se espera (las notas del navegador se guardan solas).
const file = async (page, name, want) => { let t = ''; await until(async () => { t = await saved(page, name); return want(t); }, 4000); return t; };
const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
const para = (page, has) => page.locator('.lmd-article .lmd-editable', { hasText: has }).first();
const boxes = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article details.lmd-box')].map((d) => ({ title: d.querySelector(':scope > summary').textContent, open: d.open, depth: (function up(n, k) { const p = n.parentElement.closest('details'); return p ? up(p, k + 1) : k; })(d, 0) })));
const active = (page) => page.evaluate(() => { const a = document.activeElement; return { cls: a.className || '', text: a.textContent, inBox: !!(a.closest && a.closest('details.lmd-box')), parent: a.parentNode && a.parentNode.tagName, picked: String(getSelection()) }; });
const mem = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('lmd-fold') || '{}'));
const setFold = (page, on) => page.evaluate((v) => new Promise((r) => { LMD.patch({ foldHeadings: v }); setTimeout(r, 400); }), on);
// Lo que se ve del documento: el texto de cada bloque de arriba que no está escondido.
const seen = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article > *')].filter((n) => n.offsetParent && !n.matches('.lmd-add, .lmd-cl-bar, .lmd-cl-add')).map((n) => { const c = n.cloneNode(true); c.querySelectorAll('.lmd-anchor').forEach((a) => a.remove()); return c.textContent.trim(); }));
const tog = (page, title) => page.evaluate((t) => { const h = [...document.querySelectorAll('.lmd-article > :is(h1,h2,h3,h4,h5,h6)')].find((x) => { const c = x.cloneNode(true); c.querySelectorAll('.lmd-anchor').forEach((a) => a.remove()); return c.textContent.trim() === t; }); h.querySelector('.lmd-fold-tog').click(); }, title);

const DOC = ['# Doc', '', 'First paragraph.', '', 'Last paragraph.', ''].join('\n');

await step('Insertar una sección desplegable desde el menú y con /', async () => {
  const { ctx, page } = await open();
  await note(page, 'a.md', DOC, true);
  await para(page, 'First paragraph').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-ins=details]');
  const item = await page.evaluate(() => { const b = document.querySelector('.lmd-menu [data-ins=details]'); return { text: b.textContent, icon: !!b.querySelector('svg') }; });
  check('el menú de insertar la ofrece, con su ícono', item.text === 'Collapsible section' && item.icon, item);
  await page.click('.lmd-menu [data-ins=details]'); await sleep(300);
  let b = await boxes(page); let a = await active(page);
  check('queda abierta, con el título de siempre', b.length === 1 && b[0].open && b[0].title === 'Details', b);
  check('y el cursor en lo de adentro, listo para reemplazarlo', a.inBox && /lmd-editable/.test(a.cls) && !/lmd-sum-title/.test(a.cls) && a.picked === 'Section text', a);
  await page.keyboard.type('Inside one'); await page.keyboard.press('Enter'); await sleep(250);
  a = await active(page);
  check('Enter abre el bloque siguiente dentro de la sección', /lmd-draft/.test(a.cls) && a.parent === 'DETAILS', a);
  await page.keyboard.type('Inside two'); await page.keyboard.press('Enter'); await sleep(250);
  await page.keyboard.press('Enter'); await sleep(250);
  a = await active(page);
  check('y Enter en un renglón vacío sale de ella', /lmd-draft/.test(a.cls) && !a.inBox && a.parent !== 'DETAILS', a);
  await page.keyboard.type('After the box'); await blur(page); await sleep(500);
  let t = await file(page, 'a.md', (x) => /After the box/.test(x));
  check('el archivo lleva la sintaxis, sin haberla escrito', t === ['# Doc', '', 'First paragraph.', '', '::: details Details', 'Inside one', '', 'Inside two', '', ':::', '', 'After the box', '', 'Last paragraph.', ''].join('\n'), t);
  check('y la sección sigue abierta tras redibujar', (await boxes(page))[0].open);
  // Con "/" en un renglón nuevo.
  await para(page, 'Last paragraph').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('/'); await page.waitForSelector('.lmd-menu [data-ins=details]'); await page.click('.lmd-menu [data-ins=details]'); await sleep(300);
  b = await boxes(page); a = await active(page);
  check('el menú de "/" la inserta igual', b.length === 2 && b[1].open && a.inBox && a.picked === 'Section text', [b, a]);
  await blur(page);
  t = await file(page, 'a.md', (x) => (x.match(/::: details Details/g) || []).length === 2);
  check('debajo del último bloque', /Last paragraph\.\n\n::: details Details\nSection text\n:::\n$/.test(t), t);
  // Deshacer saca la sección entera de una vez.
  await page.keyboard.press('Control+Z'); await sleep(300);
  check('un solo deshacer la quita', (await boxes(page)).length === 1);
  await ctx.close();
});

await step('El título se cambia tocándolo', async () => {
  const { ctx, page } = await open();
  await note(page, 'b.md', ['# Doc', '', 'Before.', '', '::: details Old title', 'Body text.', ':::', '', 'After.', ''].join('\n'), true);
  // Un clic en el renglón del resumen, fuera del título, despliega.
  const sum = page.locator('.lmd-article details.lmd-box > summary');
  await sum.click({ position: { x: 4, y: 8 } }); await sleep(200);
  check('un clic en el triángulo la abre', (await boxes(page))[0].open);
  const title = page.locator('.lmd-article .lmd-sum-title');
  await title.click(); await sleep(150);
  let a = await active(page);
  check('tocar el título pone el cursor ahí y no la pliega', /lmd-sum-title/.test(a.cls) && (await boxes(page))[0].open, a);
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1; });
  check('con el foco a la vista', ring);
  await page.keyboard.press('Control+A'); await page.keyboard.type('Steps to follow', { delay: 10 }); await sleep(1500);
  let t = await file(page, 'b.md', (x) => /Steps to follow/.test(x));
  check('tras la pausa cambia solo la línea que abre la sección', t === ['# Doc', '', 'Before.', '', '::: details Steps to follow', 'Body text.', ':::', '', 'After.', ''].join('\n'), t);
  check('el espacio escrito en el título no la pliega, y el foco sigue ahí', (await boxes(page))[0].open && /lmd-sum-title/.test((await active(page)).cls));
  check('la barra de formato no aparece sobre el título', await page.evaluate(() => { getSelection().selectAllChildren(document.activeElement); return new Promise((r) => setTimeout(() => r(document.querySelector('.lmd-format').hidden), 200)); }));
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await sleep(500);
  a = await active(page);
  check('Enter confirma el título y no parte el bloque', !/lmd-sum-title/.test(a.cls) && (await boxes(page)).length === 1 && (await boxes(page))[0].open && (await boxes(page))[0].title === 'Steps to follow', [a, await boxes(page)]);
  const m = await mem(page);
  check('y lo abierto se sigue recordando con el título nuevo', J(Object.values(m)[0].open) === J(['Steps to follow#1']), m);
  await page.keyboard.press('Control+Z'); await sleep(300);
  check('deshacer devuelve el título anterior', (await boxes(page))[0].title === 'Old title');
  await page.keyboard.press('Control+Y'); await sleep(300);
  check('y rehacer el nuevo', (await boxes(page))[0].title === 'Steps to follow');
  // Escape descarta lo escrito.
  await page.locator('.lmd-article .lmd-sum-title').click(); await page.keyboard.press('Control+A'); await page.keyboard.type('Discarded'); await page.keyboard.press('Escape'); await sleep(300);
  check('Escape descarta lo escrito en el título', (await boxes(page))[0].title === 'Steps to follow');
  // Vacío vuelve al de siempre.
  await page.locator('.lmd-article .lmd-sum-title').click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await sleep(100);
  const ph = await page.evaluate(() => getComputedStyle(document.activeElement, '::before').content);
  check('vacío muestra el título de siempre como guía', /Details/.test(ph), ph);
  await page.keyboard.press('Enter'); await sleep(600);
  t = await file(page, 'b.md', (x) => /::: details\n/.test(x));
  check('un título vacío vuelve al de siempre', /\n::: details\nBody text\.\n:::\n/.test(t) && (await boxes(page))[0].title === 'Details', [t, await boxes(page)]);
  // Con teclado: Enter y Espacio en el resumen pliegan.
  await blur(page); await page.evaluate(() => document.querySelector('.lmd-article details.lmd-box > summary').focus());
  const o1 = (await boxes(page))[0].open; await page.keyboard.press('Enter'); await sleep(150); const o2 = (await boxes(page))[0].open; await page.keyboard.press(' '); await sleep(150); const o3 = (await boxes(page))[0].open;
  check('Enter y Espacio en el resumen pliegan y despliegan', o1 !== o2 && o2 !== o3, [o1, o2, o3]);
  await ctx.close();
});

await step('Editar lo de adentro: una tarea, una lista y una tabla', async () => {
  const { ctx, page } = await open();
  const TEXT = ['# Doc', '', '- [ ] outside', '', '::: details Steps', '- [ ] one', '- [ ] two', '', '| a | b |', '| --- | --- |', '| x | y |', '', 'A paragraph.', ':::', '', 'End.', ''].join('\n');
  await note(page, 'c.md', TEXT);
  await page.locator('.lmd-article details.lmd-box > summary').click(); await sleep(150);
  await page.locator('.lmd-article details.lmd-box input.lmd-task').nth(1).check(); await sleep(300);
  let t = await file(page, 'c.md', (x) => /\[x\]/.test(x));
  check('tildar una tarea de adentro reescribe su línea y ninguna otra', t === TEXT.replace('- [ ] two', '- [x] two'), t);
  await page.goto(noteUrl('c.md', true)); await page.waitForSelector('.lmd-editing .lmd-article'); await sleep(350);
  check('la sección sigue abierta al pasar a edición', (await boxes(page))[0].open);
  await para(page, 'A paragraph').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' More.'); await blur(page);
  await page.locator('.lmd-article details.lmd-box .lmd-cell', { hasText: 'x' }).click(); await page.keyboard.press('Control+A'); await page.keyboard.type('X2'); await blur(page);
  await page.locator('.lmd-article details.lmd-box .lmd-li-text', { hasText: 'one' }).click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await sleep(200); await page.keyboard.type('three'); await blur(page); await sleep(500);
  t = await file(page, 'c.md', (x) => /three/.test(x) && /X2/.test(x));
  check('párrafo, celda y elemento nuevo se guardan dentro de la sección', t === ['# Doc', '', '- [ ] outside', '', '::: details Steps', '- [ ] one', '- [ ] three', '- [x] two', '', '| a | b |', '| --- | --- |', '| X2 | y |', '', 'A paragraph. More.', ':::', '', 'End.', ''].join('\n'), t);
  await ctx.close();
});

await step('Envolver y desenvolver', async () => {
  const { ctx, page } = await open();
  const TEXT = ['# Doc', '', 'One.', '', 'Two.', '', 'Three.', ''].join('\n');
  await note(page, 'd.md', TEXT, true);
  await para(page, 'Two.').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-extra=fold-wrap]');
  check('el menú del bloque ofrece envolverlo', await page.evaluate(() => document.querySelector('.lmd-menu [data-extra=fold-wrap]').textContent) === 'Wrap in a collapsible section');
  check('y sobre un bloque suelto no ofrece desenvolver', await page.evaluate(() => !document.querySelector('.lmd-menu [data-extra=fold-unwrap]')));
  await page.click('.lmd-menu [data-extra=fold-wrap]'); await sleep(300);
  let t = await file(page, 'd.md', (x) => /details/.test(x));
  check('envuelve el bloque con las dos líneas', t === ['# Doc', '', 'One.', '', '::: details Details', 'Two.', ':::', '', 'Three.', ''].join('\n'), t);
  let a = await active(page);
  check('queda abierta y con el título listo para nombrarla', (await boxes(page))[0].open && /lmd-sum-title/.test(a.cls) && a.picked === 'Details', a);
  await blur(page);
  await page.locator('.lmd-article details.lmd-box p').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-extra=fold-unwrap]');
  check('sobre la sección ofrece desenvolverla', await page.evaluate(() => document.querySelector('.lmd-menu [data-extra=fold-unwrap]').textContent) === 'Unwrap the collapsible section');
  await page.click('.lmd-menu [data-extra=fold-unwrap]'); await sleep(300);
  t = await file(page, 'd.md', (x) => !/details/.test(x));
  check('desenvolver quita las dos líneas y deja lo de adentro', t === TEXT && (await boxes(page)).length === 0, t);
  // Leyendo, con varios bloques elegidos.
  await page.click('[data-act=mode-read]'); await sleep(400);
  await page.evaluate(() => { const ps = [...document.querySelectorAll('.lmd-article > p')]; const r = document.createRange(); r.setStart(ps[0].firstChild, 0); r.setEnd(ps[1].firstChild, 3); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator('.lmd-article > p', { hasText: 'One.' }).click({ button: 'right', position: { x: 12, y: 8 } }); await page.waitForSelector('.lmd-menu-read');
  const items = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-read button')].map((x) => x.textContent));
  check('leyendo, con texto elegido el menú ofrece envolver', items.includes('Wrap in a collapsible section'), items);
  await page.click('.lmd-menu-read [data-read=fold-wrap]'); await sleep(500);
  t = await file(page, 'd.md', (x) => /details/.test(x));
  check('envuelve todos los bloques elegidos y pasa a edición', t === ['# Doc', '', '::: details Details', 'One.', '', 'Two.', ':::', '', 'Three.', ''].join('\n') && await page.evaluate(() => document.documentElement.classList.contains('lmd-editing')), t);
  await blur(page);
  await page.click('[data-act=mode-read]'); await sleep(400);
  await page.locator('.lmd-article details.lmd-box > summary').click({ button: 'right' }); await page.waitForSelector('.lmd-menu-read');
  check('leyendo, sobre la sección ofrece desenvolverla', await page.evaluate(() => !!document.querySelector('.lmd-menu-read [data-read=fold-unwrap]')));
  await page.click('.lmd-menu-read [data-read=fold-unwrap]'); await sleep(500);
  t = await file(page, 'd.md', (x) => !/details/.test(x));
  check('y la desenvuelve', t === TEXT, t);
  await ctx.close();
});

await step('Anidadas: la de afuera lleva más dos puntos', async () => {
  const { ctx, page } = await open();
  await note(page, 'e.md', ['# Doc', '', '::: details Outer', 'Outer text.', ':::', '', 'End.', ''].join('\n'), true);
  await page.locator('.lmd-article details.lmd-box > summary').click({ position: { x: 4, y: 8 } }); await sleep(150);
  await para(page, 'Outer text').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('/'); await page.waitForSelector('.lmd-menu [data-ins=details]'); await page.click('.lmd-menu [data-ins=details]'); await sleep(300);
  await page.keyboard.type('Inner text'); await blur(page); await sleep(400);
  let t = await file(page, 'e.md', (x) => /Inner text/.test(x));
  check('insertar dentro de otra alarga la de afuera', t === ['# Doc', '', ':::: details Outer', 'Outer text.', '', '::: details Details', 'Inner text', ':::', '', '::::', '', 'End.', ''].join('\n'), t);
  let b = await boxes(page);
  check('y se dibujan una dentro de la otra, las dos abiertas', b.length === 2 && b[0].depth === 0 && b[1].depth === 1 && b[0].open && b[1].open, b);
  check('lo que sigue queda afuera', await page.evaluate(() => document.querySelector('.lmd-article > p:last-of-type').textContent) === 'End.');
  // Un tercer nivel: las dos de afuera se alargan, y un solo deshacer lo vuelve todo atrás.
  await para(page, 'Inner text').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('/'); await page.waitForSelector('.lmd-menu [data-ins=details]'); await page.click('.lmd-menu [data-ins=details]'); await sleep(300);
  await blur(page); await sleep(300);
  t = await file(page, 'e.md', (x) => /Section text/.test(x));
  check('tres niveles: cinco, cuatro y tres dos puntos', /^::::: details Outer$/m.test(t) && /^:::: details Details$/m.test(t) && /^::: details Details\nSection text\n:::$/m.test(t) && /^::::$/m.test(t) && /^:::::$/m.test(t), t);
  b = await boxes(page);
  check('y los tres quedan anidados', b.length === 3 && J(b.map((x) => x.depth)) === '[0,1,2]', b);
  await page.keyboard.press('Control+Z'); await sleep(300);
  t = await file(page, 'e.md', (x) => !/Section text/.test(x));
  check('un solo deshacer quita la nueva y devuelve los dos puntos de antes', /^:::: details Outer$/m.test(t) && !/:::::/.test(t) && (await boxes(page)).length === 2, t);
  // Envolver una sección que ya tiene otra adentro.
  await page.locator('.lmd-article > details.lmd-box > summary').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-extra=fold-wrap]'); await page.click('.lmd-menu [data-extra=fold-wrap]'); await sleep(300); await blur(page);
  t = await file(page, 'e.md', (x) => /^::::: details Details$/m.test(x));
  check('envolver una sección anidada usa más dos puntos que ella', /^::::: details Details\n:::: details Outer$/m.test(t) && (await boxes(page)).length === 3 && J((await boxes(page)).map((x) => x.depth)) === '[0,1,2]', t);
  // Desenvolver la de adentro deja a las de afuera como estaban.
  await page.evaluate(() => { document.querySelectorAll('.lmd-article details').forEach((d) => { d.open = true; }); }); await sleep(150);
  await para(page, 'Inner text').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-extra=fold-unwrap]'); await page.click('.lmd-menu [data-extra=fold-unwrap]'); await sleep(300);
  t = await file(page, 'e.md', (x) => !/^::: details/m.test(x));
  check('desenvolver la de más adentro saca solo sus dos líneas', /^::::: details Details\n:::: details Outer\nOuter text\.\n\nInner text\n\n::::\n:::::$/m.test(t), t);
  await ctx.close();
});

await step('Lo abierto se recuerda por nota, y al exportar sale todo abierto', async () => {
  const { ctx, page } = await open({ tools: { docx: true, import: true } });
  const TEXT = ['# Doc', '', '::: details First', 'One.', ':::', '', '::: details Second', 'Two.', ':::', '', '::: details First', 'Three.', ':::', ''].join('\n');
  await note(page, 'f.md', TEXT);
  check('al abrir están cerradas', J((await boxes(page)).map((b) => b.open)) === '[false,false,false]');
  await page.locator('.lmd-article details.lmd-box > summary').nth(2).click(); await sleep(200);
  await page.reload(); await page.waitForSelector('.lmd-article > *'); await sleep(400);
  check('al recargar sigue abierta la misma, aunque haya otra con igual título', J((await boxes(page)).map((b) => b.open)) === '[false,false,true]', await boxes(page));
  check('nada de eso se escribe en la nota', await saved(page, 'f.md') === TEXT && await page.evaluate(() => !document.documentElement.classList.contains('lmd-dirty')));
  await note(page, 'g.md', TEXT);
  check('otra nota tiene su propio estado', J((await boxes(page)).map((b) => b.open)) === '[false,false,false]');
  await page.goto(noteUrl('f.md')); await page.waitForSelector('.lmd-article > *'); await sleep(400);
  check('y al volver a la primera está como se dejó', J((await boxes(page)).map((b) => b.open)) === '[false,false,true]');
  const html = await page.evaluate(() => LMD.extras.htmlOf());
  check('el HTML exportado lleva todas abiertas y nada de la interfaz', (html.match(/<details class="lmd-box" open="">/g) || []).length === 3 && !/lmd-sum-title|lmd-fold|data-l=/.test(html), html.slice(0, 300));
  const printed = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); const during = [...document.querySelectorAll('.lmd-article details')].map((d) => d.open); window.dispatchEvent(new Event('afterprint')); return { during, after: [...document.querySelectorAll('.lmd-article details')].map((d) => d.open) }; });
  await sleep(200);
  check('al imprimir se abren todas y después vuelven a como estaban', J(printed.during) === '[true,true,true]' && J(printed.after) === '[false,false,true]', printed);
  check('e imprimir no cambia lo recordado', J(Object.values(await mem(page)).map((m) => m.open)) === J([['First#2']]), await mem(page));
  await page.emulateMedia({ media: 'print' });
  const shut = await page.evaluate(() => { const p = document.querySelector('.lmd-article details:not([open]) p'); const r = p.getBoundingClientRect(); return r.height > 0; });
  check('una cerrada también muestra lo de adentro en la hoja impresa', shut);
  await page.emulateMedia({ media: 'screen' });
  // Word: el archivo lleva el texto de las secciones cerradas.
  // Word: lo exportado vuelve a Markdown con lo de adentro de las cerradas.
  await page.waitForFunction(() => !!(LMD.docx && LMD.import), null, { timeout: 15000 });
  const back = await page.evaluate(async () => { try { const bytes = await LMD.docx.bytes(); return (await LMD.import.convert(new File([bytes], 'f.docx'))).md; } catch (e) { return 'error: ' + (e.code || e); } });
  check('el Word exportado lleva el título y lo de adentro de cada sección, abierta o cerrada', ['First', 'One.', 'Second', 'Two.', 'Three.'].every((x) => back.includes(x)), back);
  await ctx.close();
});

await step('Solo lectura: se pliegan y despliegan, no se editan', async () => {
  const A = await R.signup('fold-a@ejemplo.test', true); const B = await R.signup('fold-b@ejemplo.test');
  await R.api('PUT', '/notes/ro.md', { text: ['# Shared', '', '::: details Read me', 'Hidden text.', ':::', '', '## Part', '', 'Body.', ''].join('\n') }, A.s);
  const made = await R.api('POST', '/shares', { path: 'ro.md', email: B.email, role: 'view', kind: 'note' }, A.s); if (made.status >= 300) console.log('     /shares: ' + made.status + ' ' + JSON.stringify(made.json));
  const shared = (await R.api('GET', '/shared', undefined, B.s)).json; const owner = ((Array.isArray(shared) ? shared : shared.notes || shared.shared || [])[0] || {}).owner; if (!owner) console.log('     /shared: ' + JSON.stringify(shared).slice(0, 300));
  const { ctx, page } = await R.open(B);
  await page.goto(R.noteUrl('~' + owner + '/ro.md')); await page.waitForSelector('.lmd-article details.lmd-box'); await sleep(400);
  check('la nota es de solo lectura', await page.evaluate(() => document.documentElement.classList.contains('lmd-readonly')));
  await page.locator('.lmd-article details.lmd-box > summary').click(); await sleep(200);
  check('se despliega', (await boxes(page))[0].open);
  await page.locator('.lmd-article details.lmd-box > summary').dblclick(); await sleep(400);
  check('no pasa a edición ni ofrece escribir el título', await page.evaluate(() => !document.documentElement.classList.contains('lmd-editing') && !document.querySelector('.lmd-sum-title, .lmd-box-empty')));
  await page.locator('.lmd-article details.lmd-box > summary').click({ button: 'right' }); await sleep(300);
  const items = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-read button')].map((x) => x.textContent));
  check('el menú no ofrece envolver ni desenvolver', !items.some((x) => /collapsible/i.test(x)), items);
  await page.keyboard.press('Escape');
  await setFold(page, true);
  await tog(page, 'Part'); await sleep(150);
  check('y con el plegado por títulos se pliega igual', !(await seen(page)).includes('Body.') && (await seen(page)).includes('Part'), await seen(page));
  await ctx.close();
});

const LONG = ['# Title', '', 'Intro.', '', '## Alpha', '', 'Alpha one.', '', '### Alpha sub', '', 'Sub text with needle.', '', '## Beta', '', 'Beta one.', '', '- [ ] a task', '', '## Gamma', '', 'See [the sub](#alpha-sub).', ''].join('\n');

await step('Plegado por títulos apagado: nada cambia', async () => {
  const { ctx, page } = await open();
  await note(page, 'h.md', LONG);
  const off = await page.evaluate(() => ({ togs: document.querySelectorAll('.lmd-fold-tog').length, cls: document.documentElement.classList.contains('lmd-foldable'), pad: getComputedStyle(document.querySelector('.lmd-article > h2')).paddingRight, html: document.querySelector('.lmd-article').innerHTML }));
  check('sin controles en los títulos ni estilos nuevos', off.togs === 0 && !off.cls && off.pad === '0px', [off.togs, off.cls, off.pad]);
  await page.keyboard.press('Alt+Shift+M'); await page.keyboard.press('Alt+Shift+F'); await sleep(200);
  check('los atajos no hacen nada', (await seen(page)).length === 11 && await page.evaluate(() => !document.querySelector('.lmd-fold-away, .lmd-fold-shut')), await seen(page));
  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=read]'); await sleep(200);
  const opt = await page.evaluate(() => { const i = document.querySelector('.lmd-panel [data-key=foldHeadings]'); return i ? { checked: i.checked, text: i.closest('label').textContent, section: i.closest('section').querySelector('h3').textContent } : null; });
  check('la opción está en Ajustes, en Lectura, apagada', !!opt && !opt.checked && opt.text === 'Fold sections by heading' && opt.section === 'Reading', opt);
  await page.check('.lmd-panel [data-key=foldHeadings]'); await sleep(500); await page.keyboard.press('Escape'); await sleep(200);
  check('prenderla pone un control en cada título', await page.evaluate(() => document.querySelectorAll('.lmd-article > :is(h1,h2,h3) > .lmd-fold-tog').length) === 5);
  await tog(page, 'Alpha'); await sleep(150);
  await setFold(page, false);
  const back = await page.evaluate(() => ({ togs: document.querySelectorAll('.lmd-fold-tog').length, cls: document.documentElement.classList.contains('lmd-foldable'), html: document.querySelector('.lmd-article').innerHTML }));
  check('apagarla deja el documento como estaba, con todo a la vista', back.togs === 0 && !back.cls && back.html === off.html && (await seen(page)).length === 11, [back.togs, back.cls, back.html === off.html]);
  await ctx.close();
});

await step('Plegado por títulos: jerarquía, marca, índice y memoria', async () => {
  const { ctx, page } = await open({ fold: true });
  await note(page, 'i.md', LONG);
  const t0 = await page.evaluate(() => { const a = document.querySelector('.lmd-article > h2 > .lmd-fold-tog'); const r = a.getBoundingClientRect(); return { role: a.getAttribute('role'), tab: a.tabIndex, exp: a.getAttribute('aria-expanded'), label: a.getAttribute('aria-label'), title: a.title, op: getComputedStyle(a).opacity, w: r.width, text: a.textContent }; });
  check('el control es un botón con nombre, escondido hasta pasar por el título', t0.role === 'button' && t0.tab === 0 && t0.exp === 'true' && t0.label === 'Fold the section' && t0.title === 'Fold the section (Alt+Shift+F)' && t0.op === '0' && t0.w > 20 && t0.text === '', t0);
  await page.hover('.lmd-article > h2'); await sleep(200);
  check('aparece al pasar el mouse', await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-article > h2 > .lmd-fold-tog')).opacity) === '1');
  await page.click('.lmd-article > h2 > .lmd-fold-tog'); await sleep(200);
  let s = await seen(page);
  check('plegar un título esconde todo hasta el próximo de igual jerarquía, con sus subtítulos', J(s) === J(['Title', 'Intro.', 'Alpha', 'Beta', 'Beta one.', 'a task', 'Gamma', 'See the sub.']), s);
  const mark = await page.evaluate(() => { const h = document.querySelector('.lmd-article > h2'); const a = h.querySelector('.lmd-fold-tog'); return { n: h.dataset.foldN, after: getComputedStyle(h, '::after').content, exp: a.getAttribute('aria-expanded'), label: a.getAttribute('aria-label'), op: getComputedStyle(a).opacity }; });
  check('plegado, el título dice cuántos bloques esconde y el control queda a la vista', mark.n === '3' && /…/.test(mark.after) && mark.exp === 'false' && mark.label === 'Unfold the section' && mark.op === '1', mark);
  check('la nota no cambió', await saved(page, 'i.md') === LONG && await page.evaluate(() => !document.documentElement.classList.contains('lmd-dirty')));
  check('el índice pliega la misma sección', await page.evaluate(() => { const row = document.querySelector('.lmd-o-row[data-id="alpha"]'); return row.parentNode.classList.contains('lmd-o-shut'); }));
  await page.reload(); await page.waitForSelector('.lmd-article > *'); await sleep(500);
  check('al recargar sigue plegada, en el documento y en el índice', !(await seen(page)).includes('Alpha one.') && await page.evaluate(() => document.querySelector('.lmd-o-row[data-id="alpha"]').parentNode.classList.contains('lmd-o-shut')), await seen(page));
  await page.click('.lmd-o-row[data-id="alpha"] .lmd-o-tog'); await sleep(200);
  check('desplegar desde el índice despliega el documento', (await seen(page)).includes('Alpha one.') && (await seen(page)).includes('Sub text with needle.'));
  await page.click('.lmd-o-row[data-id="alpha"] .lmd-o-tog'); await sleep(200);
  check('y plegar desde el índice lo pliega', !(await seen(page)).includes('Alpha one.'));
  await tog(page, 'Alpha'); await tog(page, 'Alpha sub'); await sleep(200);
  s = await seen(page);
  check('un subtítulo pliega solo lo suyo', s.includes('Alpha one.') && s.includes('Alpha sub') && !s.includes('Sub text with needle.') && s.includes('Beta one.'), s);
  // Con teclado.
  await page.evaluate(() => document.querySelector('.lmd-article > h3 > .lmd-fold-tog').focus()); await page.keyboard.press('Enter'); await sleep(150);
  const k1 = (await seen(page)).includes('Sub text with needle.'); await page.keyboard.press(' '); await sleep(150); const k2 = (await seen(page)).includes('Sub text with needle.');
  check('Enter y Espacio en el control pliegan y despliegan', k1 && !k2, [k1, k2]);
  await page.emulateMedia({ media: 'print' });
  check('al imprimir sale todo desplegado y sin controles', (await seen(page)).includes('Sub text with needle.') && await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-fold-tog')).display === 'none' && getComputedStyle(document.querySelector('.lmd-fold-shut'), '::after').content === 'none'));
  await page.emulateMedia({ media: 'screen' });
  const html = await page.evaluate(() => LMD.extras.htmlOf());
  check('y lo exportado no lleva nada del plegado', !/lmd-fold|data-fold/.test(html) && /Sub text with needle/.test(html));
  await ctx.close();
});

await step('Plegado por títulos: buscar, el índice y un enlace despliegan el destino', async () => {
  const { ctx, page } = await open({ fold: true });
  await note(page, 'j.md', LONG);
  await tog(page, 'Alpha'); await sleep(150);
  await page.fill('.lmd-search input, input.lmd-search-input', 'needle'); await sleep(700);
  check('buscar despliega la sección donde está lo encontrado', (await seen(page)).includes('Sub text with needle.'), await seen(page));
  await page.keyboard.press('Escape'); await sleep(200);
  await tog(page, 'Alpha'); await sleep(150);
  check('se vuelve a plegar', !(await seen(page)).includes('Sub text with needle.'));
  await page.click('.lmd-pane-outline a[href="#alpha-sub"]', { force: true }).catch(() => page.evaluate(() => document.querySelector('.lmd-pane-outline a[href="#alpha-sub"]').click())); await sleep(400);
  check('ir a un subtítulo desde el índice despliega al que lo contiene', (await seen(page)).includes('Alpha sub'), await seen(page));
  await tog(page, 'Alpha'); await sleep(150);
  await page.click('.lmd-article p a[href="#alpha-sub"]'); await sleep(400);
  check('seguir un enlace a un ancla también', (await seen(page)).includes('Alpha sub') && /#alpha-sub$/.test(page.url()), [await seen(page), page.url()]);
  await tog(page, 'Alpha'); await sleep(150);
  await page.goto(noteUrl('j.md') + '#alpha-sub'); await page.waitForSelector('.lmd-article > *'); await sleep(500);
  check('y abrir la nota con el ancla en la dirección', (await seen(page)).includes('Alpha sub'), await seen(page));
  // Una sección desplegable cerrada también se abre al encontrar algo adentro.
  await note(page, 'k.md', ['# Doc', '', '::: details Closed', 'A hidden gem.', ':::', ''].join('\n'));
  await page.fill('.lmd-search input, input.lmd-search-input', 'gem'); await sleep(700);
  check('buscar abre la sección desplegable que guarda lo encontrado', (await boxes(page))[0].open);
  await ctx.close();
});

await step('Plegado por títulos: atajos', async () => {
  const { ctx, page } = await open({ fold: true });
  await note(page, 'l.md', LONG);
  await page.keyboard.press('Alt+Shift+M'); await sleep(250);
  let s = await seen(page);
  check('plegar todo deja los títulos de arriba, sin esconder la nota entera', J(s) === J(['Title', 'Intro.', 'Alpha', 'Beta', 'Gamma']), s);
  await page.keyboard.press('Alt+Shift+U'); await sleep(250);
  check('desplegar todo muestra todo', (await seen(page)).length === 11 && await page.evaluate(() => !document.querySelector('.lmd-fold-shut')), await seen(page));
  await page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article > p')].find((x) => x.textContent === 'Beta one.'); const r = document.createRange(); r.setStart(p.firstChild, 2); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
  await page.keyboard.press('Alt+Shift+F'); await sleep(250);
  s = await seen(page);
  check('el atajo pliega la sección donde está el cursor', !s.includes('Beta one.') && !s.includes('a task') && s.includes('Beta') && s.includes('Alpha one.') && s.includes('Gamma'), s);
  await page.keyboard.press('Alt+Shift+F'); await sleep(250);
  check('y la despliega', (await seen(page)).includes('Beta one.'));
  await page.keyboard.press('?'); await page.waitForSelector('.lmd-keys');
  const rows = await page.evaluate(() => ['fold', 'fold-all', 'unfold-all'].map((id) => { const r = document.querySelector('.lmd-keys-row[data-id="' + id + '"]'); return r ? r.querySelector('.lmd-keys-set').getAttribute('aria-label') + ' ' + r.querySelector('.lmd-keys-what span').textContent : ''; }));
  check('la hoja de atajos los lista', J(rows) === J(['Alt+Shift+F Fold or unfold the section at the cursor', 'Alt+Shift+M Fold all sections', 'Alt+Shift+U Unfold all sections']), rows);
  check('y ninguna tecla de la tabla se repite entre los que usan Alt+Shift', await page.evaluate(() => { const all = LMD.shortcuts.LIST.flatMap((x) => x.keys.split(' / ')).filter((k) => /^Alt\+Shift\+/.test(k)); return new Set(all).size === all.length; }));
  await ctx.close();
});

await step('Plegado por títulos: editar alrededor no pierde lo plegado', async () => {
  const { ctx, page } = await open({ fold: true });
  await note(page, 'm.md', LONG, true);
  await page.hover('.lmd-article > h2'); await page.click('.lmd-article > h2 > .lmd-fold-tog'); await sleep(200);
  check('en edición se pliega igual', !(await seen(page)).includes('Alpha one.'));
  check('y el título se sigue pudiendo editar', await page.evaluate(() => { const h = document.querySelector('.lmd-article > h2'); return h.isContentEditable && !h.classList.contains('lmd-noedit'); }));
  await para(page, 'Beta one').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Edited.'); await blur(page); await sleep(500);
  let t = await file(page, 'm.md', (x) => /Edited/.test(x));
  check('editar otro bloque cambia solo ese bloque', t === LONG.replace('Beta one.', 'Beta one. Edited.'), t);
  check('y la sección sigue plegada tras redibujar', !(await seen(page)).includes('Alpha one.'));
  // Editar el título plegado: lo que cuelga de él sigue en el archivo.
  await page.locator('.lmd-article > h2').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.type('X'); await blur(page); await sleep(500);
  t = await file(page, 'm.md', (x) => /## AlphaX/.test(x));
  check('cambiar el texto de un título plegado no pierde lo de abajo ni mete el control en el texto', t === LONG.replace('Beta one.', 'Beta one. Edited.').replace('## Alpha\n', '## AlphaX\n'), t);
  // Un bloque nuevo debajo de un título plegado: la sección se abre para que no quede escondido.
  await tog(page, 'Beta'); await sleep(200);
  check('Beta queda plegada', !(await seen(page)).some((x) => /Beta one/.test(x)));
  await page.locator('.lmd-article > h2', { hasText: 'Beta' }).click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await sleep(250);
  check('al abrir un bloque nuevo bajo un título plegado, la sección se despliega', (await seen(page)).some((x) => /Beta one/.test(x)));
  await page.keyboard.type('Fresh line'); await blur(page); await sleep(500);
  t = await file(page, 'm.md', (x) => /Fresh line/.test(x));
  check('y lo escrito queda a la vista, en su lugar', /## Beta\n\nFresh line\n\nBeta one\. Edited\./.test(t) && (await seen(page)).includes('Fresh line'), t);
  // Insertar desde el menú debajo de un título plegado.
  await tog(page, 'Gamma'); await sleep(200);
  await page.locator('.lmd-article > h2', { hasText: 'Gamma' }).click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-ins=hr]');
  check('abrir el menú de un título plegado lo despliega', (await seen(page)).some((x) => /See the sub/.test(x)));
  await page.keyboard.press('Escape');
  await ctx.close();
});

await step('El título no ejecuta nada', async () => {
  const { ctx, page } = await open();
  const P = 'window.__pwn=(window.__pwn||0)+1';
  await note(page, 'x.md', ['# Doc', '', '::: details <img src=x onerror="' + P + '">', 'Body.', ':::', ''].join('\n'), true);
  let x = await page.evaluate(() => { const s = document.querySelector('.lmd-article details.lmd-box > summary'); return { img: s.querySelectorAll('img, script, [onerror]').length, text: s.textContent, pwn: window.__pwn || 0 }; });
  check('un título con HTML se muestra como texto', x.img === 0 && /<img src=x/.test(x.text) && x.pwn === 0, x);
  await page.locator('.lmd-article .lmd-sum-title').click(); await page.keyboard.press('Control+A');
  await page.keyboard.insertText('<img src=x onerror="' + P + '"><script>' + P + '</script> **b**'); await sleep(1500);
  await page.keyboard.press('Enter'); await sleep(600);
  const t = await file(page, 'x.md', (v) => /script/.test(v));
  x = await page.evaluate(() => { const s = document.querySelector('.lmd-article details.lmd-box > summary'); return { img: s.querySelectorAll('img, script, [onerror], strong, code').length, text: s.textContent, pwn: window.__pwn || 0 }; });
  check('escribir HTML en el título lo deja como texto, también tras redibujar', x.img === 0 && x.pwn === 0 && /<script>/.test(x.text) && /^::: details <img src=x onerror=".*"><script>.*<\/script> \*\*b\*\*$/m.test(t), [x, t]);
  // Lo recordado en la sesión no se interpreta: un valor roto no rompe nada.
  await page.evaluate(() => sessionStorage.setItem('lmd-fold', '{"__proto__":{"open":["x"]},"a":5,"b":{"open":"no","shut":[1,{}]}}'));
  await page.reload(); await page.waitForSelector('.lmd-article > *'); await sleep(400);
  check('un estado guardado roto se ignora', (await boxes(page)).length === 1 && !(await boxes(page))[0].open);
  await ctx.close();
});

await step('Una sección vacía ofrece dónde escribir', async () => {
  const { ctx, page } = await open();
  await note(page, 'v.md', ['# Doc', '', '::: details Empty', ':::', '', 'End.', ''].join('\n'), true);
  await page.locator('.lmd-article details.lmd-box > summary').click({ position: { x: 4, y: 8 } }); await sleep(150);
  const ph = await page.evaluate(() => { const p = document.querySelector('.lmd-article details.lmd-box > .lmd-box-empty'); return p ? { label: getComputedStyle(p, '::before').content, text: p.textContent, role: p.getAttribute('role'), tab: p.tabIndex } : null; });
  check('en edición, una sección sin nada adentro muestra un renglón para empezar', !!ph && /Write here/.test(ph.label) && ph.text === '' && ph.role === 'button' && ph.tab === 0, ph);
  await page.click('.lmd-article details.lmd-box > .lmd-box-empty'); await sleep(200);
  const a = await active(page);
  check('tocarlo abre un bloque nuevo adentro', /lmd-draft/.test(a.cls) && a.parent === 'DETAILS', a);
  await page.keyboard.type('Now it has text'); await blur(page); await sleep(500);
  const t = await file(page, 'v.md', (x) => /Now it has text/.test(x));
  check('y lo escrito queda dentro de la sección', t === ['# Doc', '', '::: details Empty', '', 'Now it has text', '', ':::', '', 'End.', ''].join('\n') && await page.evaluate(() => !document.querySelector('.lmd-box-empty')), t);
  check('el renglón de guía no sale en lo exportado', !/lmd-box-empty|Write here/.test(await page.evaluate(() => LMD.extras.htmlOf())));
  await ctx.close();
});

await step('La lista de pendientes que enseña la guía de la IA', async () => {
  const A = await R.signup('fold-guide@ejemplo.test', true);
  const tok = (await R.api('POST', '/tokens', { name: 'IA' }, A.s)).json.token;
  const res = await R.api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_guide', arguments: {} } }, tok);
  const guide = res.json.result.content[0].text;
  const sample = (new RegExp('\x60\x60\x60markdown\\n(# Pending\\n[\\s\\S]*?)\\n\x60\x60\x60').exec(guide) || [])[1] || '';
  check('la guía trae el ejemplo de pending.md', /^# Pending\n/.test(sample) && /::: details Steps/.test(sample), guide.slice(0, 200));
  const { ctx, page } = await open();
  await note(page, 'pending.md', sample + '\n');
  const seenList = await page.evaluate(() => { const ul = document.querySelector('.lmd-article > ul.lmd-task-list'); const d = ul.querySelector('li > details.lmd-box'); return { lists: document.querySelectorAll('.lmd-article > ul.lmd-task-list').length, items: ul.children.length, title: d.querySelector('summary').textContent, open: d.open, steps: d.querySelectorAll(':scope > ol > li').length, links: [...d.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')), count: (document.querySelector('.lmd-cl-count') || {}).textContent, raw: /:::/.test(document.querySelector('.lmd-article').textContent) }; });
  check('se ve como una sola lista de tareas, con los pasos numerados dentro de una sección cerrada', seenList.lists === 2 && seenList.items === 2 && seenList.title === 'Steps' && !seenList.open && seenList.steps === 3 && seenList.links.length === 2 && seenList.links.every((h) => /^https:\/\/dashboard\.example\.com\//.test(h)) && seenList.count === '0 of 2' && !seenList.raw, seenList);
  await page.locator('.lmd-article > ul.lmd-task-list > li > input.lmd-task').first().check(); await sleep(300);
  let t = await file(page, 'pending.md', (x) => /\[x\] Create/.test(x));
  check('tildar el punto reescribe solo su línea', t === (sample + '\n').replace('- [ ] Create the payment account', '- [x] Create the payment account'), t);
  await page.goto(noteUrl('pending.md', true)); await page.waitForSelector('.lmd-editing .lmd-article'); await sleep(350);
  const ed = await page.evaluate(() => { const li = document.querySelector('.lmd-article > ul.lmd-task-list > li'); const text = li.querySelector(':scope > .lmd-li-text'); return { text: text && text.textContent, editable: !!text && text.isContentEditable, noedit: !!li.querySelector('.lmd-noedit'), title: !!li.querySelector('details .lmd-sum-title'), inside: li.querySelector(':scope > details') !== null }; });
  check('y editando, el punto y el título de sus pasos se escriben en el lugar', ed.text === 'Create the payment account' && ed.editable && !ed.noedit && ed.title && ed.inside, ed);
  await page.locator('.lmd-article > ul.lmd-task-list > li > .lmd-li-text').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' today'); await blur(page); await sleep(500);
  t = await file(page, 'pending.md', (x) => /account today/.test(x));
  check('cambiar el texto del punto no toca sus pasos', t === (sample + '\n').replace('- [ ] Create the payment account', '- [x] Create the payment account today'), t);
  await ctx.close();
});

await step('En una sesión en vivo, el título y lo de adentro llegan a los demás', async () => {
  const A = await R.signup('fold-live@ejemplo.test', true);
  await R.api('PUT', '/notes/live.md', { text: ['# Live', '', '::: details Shared', 'Inside.', ':::', '', 'End.', ''].join('\n') }, A.s);
  const own = await R.open(A); await own.page.goto(R.noteUrl('live.md', true)); await own.page.waitForSelector('.lmd-article .lmd-editable');
  await own.page.click('[data-act=sync]'); await own.page.click('.lmd-menu [data-s=live]'); await own.page.waitForSelector('.lmd-live-card [data-lv=name]');
  await own.page.fill('[data-lv=name]', 'Ana'); await own.page.click('[data-lv=start]'); await own.page.waitForSelector('.lmd-live-link input');
  const link = await own.page.inputValue('.lmd-live-link input'); await own.page.click('.lmd-live-card [data-lv=close]');
  const g = await R.open(null); await g.page.goto(link); await g.page.waitForSelector('.lmd-live-card input');
  await g.page.fill('.lmd-live-card input', 'Beto'); await g.page.click('.lmd-live-card [data-lv=join]'); await g.page.waitForSelector('.lmd-live-bar'); await g.page.waitForSelector('.lmd-article .lmd-editable');
  const sum = '.lmd-article details.lmd-box > summary';
  await g.page.locator(sum).click({ position: { x: 4, y: 8 } }); await sleep(200);
  await g.page.locator('.lmd-article details.lmd-box p.lmd-editable').click(); await sleep(200);
  await own.page.locator(sum).click({ position: { x: 4, y: 8 } }); await sleep(200);
  await own.page.locator('.lmd-article .lmd-sum-title').click(); await own.page.keyboard.press('Control+A'); await own.page.keyboard.type('Renamed live', { delay: 15 });
  const got = await until(() => g.page.evaluate(() => document.querySelector('.lmd-article details.lmd-box > summary').textContent === 'Renamed live'), 8000);
  const there = await g.page.evaluate(() => ({ open: document.querySelector('.lmd-article details.lmd-box').open, focus: !!document.activeElement && document.activeElement.tagName === 'P' && !!document.activeElement.closest('details'), title: document.querySelector('.lmd-article details.lmd-box > summary').textContent }));
  check('el título que escribe uno le llega al otro, sin cerrarle la sección ni sacarle el cursor', !!got && there.open && there.focus, there);
  await g.page.keyboard.press('Control+End'); await g.page.keyboard.type(' From Beto.', { delay: 15 });
  const back = await until(() => own.page.evaluate(() => /Inside\. From Beto\./.test(document.querySelector('.lmd-article details.lmd-box').textContent)), 8000);
  const mine = await own.page.evaluate(() => ({ open: document.querySelector('.lmd-article details.lmd-box').open, title: document.querySelector('.lmd-article .lmd-sum-title').textContent, focus: document.activeElement.className }));
  check('y lo que el otro escribe adentro llega con la sección abierta y el título en su lugar', !!back && mine.open && mine.title === 'Renamed live' && /lmd-sum-title/.test(mine.focus), mine);
  await own.page.evaluate(() => document.activeElement.blur()); await g.page.evaluate(() => document.activeElement.blur());
  const text = await until(async () => { const t = (await R.api('GET', '/notes/live.md', undefined, A.s)).json.text; return /Renamed live/.test(t) && /From Beto/.test(t) ? t : ''; }, 8000);
  check('la nota guardada tiene las dos cosas, cada una en su línea', text === ['# Live', '', '::: details Renamed live', 'Inside. From Beto.', ':::', '', 'End.', ''].join('\n'), text);
  await own.ctx.close(); await g.ctx.close();
});

await step('Teléfono', async () => {
  const { ctx, page } = await open({ ctx: SMALL, fold: true });
  await note(page, 'p.md', LONG + '\n::: details On the phone\nBody.\n:::\n');
  const t = await page.evaluate(() => { const a = document.querySelector('.lmd-article > h2 > .lmd-fold-tog'); const r = a.getBoundingClientRect(); return { op: +getComputedStyle(a).opacity, w: r.width, h: r.height, in: r.right <= innerWidth + 1 && r.left >= 0, side: document.documentElement.scrollWidth <= innerWidth + 1 }; });
  check('el control se ve sin pasar el mouse, entra en la pantalla y se puede tocar', t.op > 0.5 && t.w >= 30 && t.h >= 30 && t.in && t.side, t);
  await page.tap('.lmd-article > h2 > .lmd-fold-tog'); await sleep(200);
  check('tocarlo pliega', !(await seen(page)).includes('Alpha one.'));
  await page.tap('.lmd-article details.lmd-box > summary'); await sleep(200);
  check('y la sección desplegable se abre con el dedo', (await boxes(page))[0].open);
  await ctx.close();
});

await step('Español', async () => {
  const { ctx, page } = await open({ lang: 'es', fold: true });
  await note(page, 'q.md', DOC, true);
  await para(page, 'First paragraph').click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-ins=details]');
  const item = await page.evaluate(() => document.querySelector('.lmd-menu [data-ins=details]').textContent);
  const wrapText = await page.evaluate(() => document.querySelector('.lmd-menu [data-extra=fold-wrap]').textContent);
  await page.click('.lmd-menu [data-ins=details]'); await sleep(300); await blur(page);
  const t = await file(page, 'q.md', (x) => /details/.test(x));
  check('en español: "Sección desplegable", con título "Detalles"', item === 'Sección desplegable' && wrapText === 'Envolver en una sección desplegable' && /::: details Detalles\nTexto de la sección\n:::/.test(t), [item, wrapText, t]);
  const texts = await page.evaluate(() => ['Sección desplegable', 'Texto de la sección', 'Escribí acá', 'Envolver en una sección desplegable', 'Desenvolver la sección desplegable', 'Plegar secciones por título', 'Plegar la sección', 'Desplegar la sección', 'Secciones plegadas', 'Secciones desplegadas']);
  await ctx.close();
  const en = await open();
  await note(en.page, 'r.md', DOC);
  const missing = await en.page.evaluate((list) => list.filter((k) => LMD.t(k) === k || /[!¡—–]/.test(LMD.t(k))), texts);
  check('cada texto nuevo tiene su inglés, sin signos de admiración ni rayas largas', missing.length === 0, missing);
  await en.ctx.close();
});

check('sin errores de página', R.errors.length === 0, R.errors.slice(0, 3));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 3));
await R.close();
process.exit(done() ? 1 : 0);
