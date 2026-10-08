// Varios bloques a la vez (src/blocks.js): marcarlos arrastrando desde el margen, con Mayúsculas o Ctrl + clic, con el
// teclado y con el dedo; copiar, cortar, eliminar, duplicar, mover, pasar a una nota nueva, envolver, convertir y pegar.
// Cada acción es un solo paso de deshacer. Y el cruce de listas dentro de una sección desplegable.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { rig, tally, sleep, root } from './rig.mjs';

const R = await rig({ SHARE_FREE: '1', LIVE_PEOPLE: '4' });
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const enc = encodeURIComponent;
const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(o.who || null, o.ctx);
  await page.addInitScript(([base, lang, fold, who]) => {
    try {
      if (localStorage.getItem('blk:listo')) return; localStorage.setItem('blk:listo', '1');
      localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, foldHeadings: fold }));
      if (who) localStorage.setItem('mdtools:cloud', JSON.stringify({ session: who.s, email: who.email, at: base }));
    } catch (e) { /* página en blanco */ }
  }, [R.base, o.lang || 'en', !!o.fold, o.who || null]);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const noteUrl = (name, edit) => R.home + '?f=' + enc('local/' + name) + (edit ? '&edit=1' : '');
async function note(page, name, text, edit) {
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
  await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text, name);
const notes = (page) => page.evaluate(async () => (await LMD.store.notesAll()).map((n) => n.name).sort());
// El Markdown de ahora (sin títulos numerados es el texto tal cual).
const md = async (page) => (await page.evaluate(() => LMD.page.md())).replace(/\r/g, '');
const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
const para = (page, has) => page.locator('.lmd-article .lmd-editable', { hasText: has }).first();
const flash = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
// El aviso de lo eliminado, con su botón de deshacer.
const toast = (page) => page.evaluate(() => { const t = document.querySelector('.lmd-cl-toast'); return t ? t.querySelector('span').textContent + ' | ' + t.querySelector('button').textContent : ''; });
// Los bloques marcados, por su texto.
const sel = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article > .lmd-bsel')].map((n) => { const c = n.cloneNode(true); c.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang').forEach((a) => a.remove()); return c.textContent.replace(/\s+/g, ' ').trim().slice(0, 24); }));
const bar = (page) => page.evaluate(() => {
  const b = document.querySelector('.lmd-bsel-bar'); if (!b || b.hidden) return null;
  return { role: b.getAttribute('role'), label: b.getAttribute('aria-label'), n: b.querySelector('.lmd-bsel-n').textContent, live: b.querySelector('.lmd-bsel-n').getAttribute('aria-live'),
    btns: [...b.querySelectorAll('button')].filter((x) => !x.hidden).map((x) => x.dataset.bs), names: [...b.querySelectorAll('button')].filter((x) => !x.hidden).every((x) => !!(x.getAttribute('aria-label') || x.textContent.trim())) };
});
// La caja del bloque de primer nivel que contiene ese texto, y el margen izquierdo del artículo.
const box = (page, has) => page.evaluate((t) => { const art = document.querySelector('.lmd-article'); const n = [...art.children].find((x) => !x.matches('.lmd-add') && x.textContent.includes(t)); const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, mid: r.top + r.height / 2, margin: art.getBoundingClientRect().left + 22 }; }, has);
// mod: 'Shift' o 'Control', apretada durante el clic.
const marginClick = async (page, has, mod) => { const b = await box(page, has); if (mod) await page.keyboard.down(mod); await page.mouse.click(b.margin, b.mid); if (mod) await page.keyboard.up(mod); await sleep(120); };
async function marginDrag(page, from, to, hold) {
  const a = await box(page, from); const b = await box(page, to);
  await page.mouse.move(a.margin, a.mid); await page.mouse.down();
  await page.mouse.move(a.margin, a.mid + 8, { steps: 2 }); await page.mouse.move(b.margin, b.mid, { steps: 8 });
  if (hold) await hold();
  await page.mouse.up(); await sleep(200);
}
const clip = (page) => page.evaluate(async () => {
  const out = { text: '', html: '' };
  for (const it of await navigator.clipboard.read()) { for (const t of it.types) { const v = await (await it.getType(t)).text(); if (t === 'text/plain') out.text = v.split(String.fromCharCode(13)).join(''); if (t === 'text/html') out.html = v; } }
  return out;
});
const wipe = (page) => page.evaluate(() => navigator.clipboard.writeText('nada'));
const undo = async (page) => { await page.keyboard.press('Control+z'); await sleep(300); };
const more = async (page, id) => { await page.click('.lmd-bsel-bar [data-bs=more]'); await page.waitForSelector('.lmd-bsel-menu'); if (id) { await page.click('.lmd-bsel-menu [data-bs="' + id + '"]'); await sleep(350); } };
const menuIds = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-bsel-menu [data-bs]')].map((b) => b.dataset.bs));

const DOC = ['# Doc', '', 'Alpha one.', '', 'Beta two.', '', '## Section', '', 'Gamma three.', '', '- item a', '- item b', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '```js', 'code();', '```', '', '::: details More', 'Inside.', ':::', '', 'Omega end.', ''].join('\n');

await step('Arrastrar desde el margen marca un rango de bloques', async () => {
  const { ctx, page } = await open();
  await note(page, 'a.md', DOC, true);
  await marginDrag(page, 'Alpha one', 'Gamma three');
  check('quedan marcados los bloques del rango, en orden', J(await sel(page)) === J(['Alpha one.', 'Beta two.', 'Section', 'Gamma three.']), await sel(page));
  const b = await bar(page);
  check('aparece la barra, con rol, nombre y la cuenta', !!b && b.role === 'toolbar' && b.label === 'Selected blocks' && b.n === '4 blocks' && b.live === 'polite' && b.names, b);
  check('con las acciones de edición', !!b && J(b.btns) === J(['grip', 'copy', 'cut', 'dup', 'up', 'down', 'del', 'more']), b && b.btns);
  const look = await page.evaluate(() => { const n = document.querySelector('.lmd-article > .lmd-bsel'); const s = getComputedStyle(n); const r = document.querySelector('.lmd-bsel-bar').getBoundingClientRect(); return { bg: s.backgroundColor, outline: s.outlineStyle, in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, above: r.bottom <= n.getBoundingClientRect().top }; });
  check('lo marcado se ve resaltado y la barra queda arriba, dentro de la pantalla', look.bg !== 'rgba(0, 0, 0, 0)' && look.outline === 'solid' && look.in && look.above, look);
  check('sin texto elegido ni cursor en un bloque', await page.evaluate(() => String(getSelection()) === '' && document.activeElement === document.body));
  check('el Markdown no cambió', (await md(page)) === DOC);
  // Una lista, una tabla, un bloque de código y una sección desplegable son un bloque cada una.
  await marginDrag(page, 'item a', 'Inside.');
  check('una lista, una tabla, el código y una sección desplegable cuentan de a una', (await sel(page)).length === 4 && (await bar(page)).n === '4 blocks', await sel(page));
  await page.mouse.click(700, 760); await sleep(150);
  check('un clic afuera suelta lo marcado', (await sel(page)).length === 0 && (await bar(page)) === null);
  await marginClick(page, 'Beta two');
  check('un clic en el margen marca ese bloque', J(await sel(page)) === J(['Beta two.']) && (await bar(page)).n === '1 block', await sel(page));
  await page.keyboard.type('x'); await sleep(120);
  check('empezar a escribir suelta lo marcado, sin escribir en la nota', (await sel(page)).length === 0 && (await md(page)) === DOC);
  // Hacia arriba también.
  await marginDrag(page, 'Gamma three', 'Beta two');
  check('arrastrando hacia arriba marca igual', J(await sel(page)) === J(['Beta two.', 'Section', 'Gamma three.']), await sel(page));
  await page.keyboard.press('Escape'); await sleep(100);
  check('Escape suelta', (await sel(page)).length === 0);
  // Elegir texto dentro de un bloque sigue igual.
  const a = await box(page, 'Alpha one');
  await page.mouse.move(a.x + 2, a.mid); await page.mouse.down(); await page.mouse.move(a.x + 60, a.mid, { steps: 6 }); await page.mouse.up(); await sleep(250);
  const t = await page.evaluate(() => ({ text: String(getSelection()), n: document.querySelectorAll('.lmd-bsel').length, active: document.activeElement.textContent, bar: document.querySelector('.lmd-bsel-bar').hidden, fmt: document.querySelector('.lmd-format').hidden }));
  check('arrastrar sobre el texto de un bloque elige texto, como siempre', t.text.length > 2 && 'Alpha one.'.includes(t.text) && t.n === 0 && t.active === 'Alpha one.' && t.bar && !t.fmt, t);
  const g = await box(page, 'Gamma three');
  await page.mouse.move(a.x + 2, a.mid); await page.mouse.down(); await page.mouse.move(g.x + 40, g.mid, { steps: 8 }); await page.mouse.up(); await sleep(200);
  check('y un arrastre que empieza en el texto no marca bloques aunque cruce varios', (await sel(page)).length === 0);
  await ctx.close();
});

await step('Mayúsculas + clic y Ctrl + clic', async () => {
  const { ctx, page } = await open();
  await note(page, 'b.md', DOC, true);
  await para(page, 'Alpha one').click(); await sleep(100);
  await para(page, 'Gamma three').click({ modifiers: ['Shift'] }); await sleep(150);
  check('Mayúsculas + clic extiende desde el bloque donde estaba el cursor', J(await sel(page)) === J(['Alpha one.', 'Beta two.', 'Section', 'Gamma three.']), await sel(page));
  check('y el cursor sale del bloque', await page.evaluate(() => document.activeElement === document.body));
  await para(page, 'Beta two').click({ modifiers: ['Shift'] }); await sleep(150);
  check('otra vez, desde el mismo extremo', J(await sel(page)) === J(['Alpha one.', 'Beta two.']), await sel(page));
  await para(page, 'Omega end').click({ modifiers: ['Control'] }); await sleep(150);
  check('Ctrl + clic suma un bloque salteado', J(await sel(page)) === J(['Alpha one.', 'Beta two.', 'Omega end.']) && (await bar(page)).n === '3 blocks', await sel(page));
  await para(page, 'Beta two').click({ modifiers: ['Control'] }); await sleep(150);
  check('y lo quita', J(await sel(page)) === J(['Alpha one.', 'Omega end.']), await sel(page));
  check('con bloques salteados no se ofrece envolver', await (async () => { await more(page); const ids = await menuIds(page); await page.keyboard.press('Escape'); return !ids.includes('wrap') && ids.includes('doc-copy'); })());
  await para(page, 'Gamma three').click(); await sleep(150);
  check('un clic sin teclas sobre un bloque suelta lo marcado y deja el cursor ahí', (await sel(page)).length === 0 && await page.evaluate(() => document.activeElement.textContent === 'Gamma three.'));
  // Dentro del mismo bloque, Mayúsculas + clic sigue eligiendo texto.
  const g = await box(page, 'Gamma three');
  await page.mouse.click(g.x + 2, g.mid); await page.keyboard.down('Shift'); await page.mouse.click(g.x + 50, g.mid); await page.keyboard.up('Shift'); await sleep(150);
  check('dentro del mismo bloque, Mayúsculas + clic elige texto', (await sel(page)).length === 0 && (await page.evaluate(() => String(getSelection()))).length > 2);
  await ctx.close();
});

await step('Teclado: Escape marca el bloque, Mayúsculas + flechas extiende, Ctrl+A dos veces', async () => {
  const { ctx, page } = await open();
  await note(page, 'c.md', DOC, true);
  await para(page, 'Beta two').click(); await page.keyboard.press('Escape'); await sleep(250);
  check('Escape en un bloque lo deja marcado', J(await sel(page)) === J(['Beta two.']), await sel(page));
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await sleep(120);
  check('Mayúsculas + ↓ extiende', J(await sel(page)) === J(['Beta two.', 'Section', 'Gamma three.']), await sel(page));
  await page.keyboard.press('Shift+ArrowUp'); await sleep(120);
  check('Mayúsculas + ↑ achica', J(await sel(page)) === J(['Beta two.', 'Section']), await sel(page));
  await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowUp'); await sleep(120);
  check('y pasa para el otro lado del primero', J(await sel(page)) === J(['Alpha one.', 'Beta two.']), await sel(page));
  await page.keyboard.press('ArrowDown'); await sleep(120);
  check('↓ sola pasa al bloque siguiente', J(await sel(page)) === J(['Beta two.']), await sel(page));
  // Tab lleva el foco a la barra y las flechas la recorren.
  await page.keyboard.press('Tab'); await sleep(100);
  const f1 = await page.evaluate(() => document.activeElement.dataset.bs);
  await page.keyboard.press('ArrowRight'); const f2 = await page.evaluate(() => document.activeElement.dataset.bs);
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1; });
  check('Tab lleva el foco a la barra y las flechas la recorren, con el foco a la vista', f1 === 'copy' && f2 === 'cut' && ring, [f1, f2, ring]);
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await sleep(200);
  const m = await page.evaluate(() => { const x = document.querySelector('.lmd-bsel-menu'); return x ? { role: x.getAttribute('role'), items: [...x.querySelectorAll('button')].every((b) => b.getAttribute('role') === 'menuitem'), focus: document.activeElement.dataset.bs } : null; });
  check('Enter en "más" abre el menú con el foco adentro', !!m && m.role === 'menu' && m.items && m.focus === 'doc-copy', m);
  await page.keyboard.press('ArrowDown'); const f3 = await page.evaluate(() => document.activeElement.dataset.bs);
  await page.keyboard.press('Escape'); await sleep(100);
  check('las flechas recorren el menú y Escape lo cierra y devuelve el foco', f3 === 'doc-move' && await page.evaluate(() => !document.querySelector('.lmd-bsel-menu') && document.activeElement.dataset.bs === 'more'), f3);
  await page.keyboard.press('Tab'); await sleep(80);
  check('Tab desde la barra vuelve al documento, con lo marcado en su lugar', await page.evaluate(() => document.activeElement === document.body) && (await sel(page)).length === 1);
  await page.keyboard.press('Enter'); await sleep(150);
  check('Enter entra a escribir en el bloque', (await sel(page)).length === 0 && await page.evaluate(() => document.activeElement.textContent === 'Beta two.' && document.activeElement.isContentEditable));
  await page.keyboard.press('Control+a'); await sleep(80);
  check('Ctrl+A una vez elige el texto del bloque', (await sel(page)).length === 0 && await page.evaluate(() => String(getSelection()) === 'Beta two.'));
  await page.keyboard.press('Control+a'); await sleep(150);
  check('y la segunda marca todos los bloques', (await sel(page)).length === 10 && (await bar(page)).n === '10 blocks', await sel(page));
  await page.keyboard.press('Escape'); await sleep(100);
  check('Escape suelta todo', (await sel(page)).length === 0 && (await md(page)) === DOC);
  // En un título y en una celda también.
  await page.locator('.lmd-article h2', { hasText: 'Section' }).click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+a'); await sleep(150);
  check('Ctrl+A dos veces en un título marca todos', (await sel(page)).length === 10, await sel(page));
  await page.keyboard.press('Escape');
  await page.locator('.lmd-article .lmd-cell', { hasText: '1' }).click(); await page.keyboard.press('Escape'); await sleep(250);
  check('Escape en una celda marca la tabla', (await sel(page)).length === 1 && /a b 1 2/.test((await sel(page))[0]), await sel(page));
  await page.keyboard.press('Escape'); await sleep(100);
  // Un bloque nuevo que se descarta con Escape no deja nada marcado.
  await para(page, 'Omega end').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('borrador'); await page.keyboard.press('Escape'); await sleep(300);
  check('Escape en un bloque nuevo lo descarta y no marca nada', (await sel(page)).length === 0 && (await md(page)) === DOC, [await sel(page), await md(page)]);
  // Alt + flechas dentro de una lista sigue siendo de la lista.
  await para(page, 'item b').click(); await page.keyboard.press('Alt+ArrowUp'); await sleep(300);
  check('sin bloques marcados, Alt+↑ en un ítem sigue moviendo el ítem', /- item b\n- item a/.test(await md(page)) && (await sel(page)).length === 0, await md(page));
  await ctx.close();
});

await step('Copiar: Markdown en texto y HTML con formato', async () => {
  const { ctx, page } = await open();
  await note(page, 'd.md', DOC, true);
  await marginDrag(page, 'Section', 'item a');
  await wipe(page);
  await page.keyboard.press('Control+c'); await sleep(250);
  let c = await clip(page);
  check('el texto es el Markdown de esos bloques', c.text === '## Section\n\nGamma three.\n\n- item a\n- item b', c.text);
  check('el HTML lleva el formato, sin nada de la interfaz', /<h2[^>]*>\s*Section\s*<\/h2>/.test(c.html) && /<p[^>]*>Gamma three\.<\/p>/.test(c.html) && /<li[^>]*>/.test(c.html) && !/lmd-(editable|bsel|anchor|li-text|fold)|contenteditable|<button/.test(c.html), c.html.slice(0, 600));
  check('lo marcado sigue marcado y la nota igual', (await sel(page)).length === 3 && (await md(page)) === DOC && /Blocks copied: 3/.test(await flash(page)), await flash(page));
  // Desde la barra y con bloques salteados.
  await page.keyboard.press('Escape');
  await marginClick(page, 'Alpha one'); await para(page, 'Omega end').click({ modifiers: ['Control'] }); await sleep(120);
  await wipe(page);
  await page.click('.lmd-bsel-bar [data-bs=copy]'); await sleep(250);
  c = await clip(page);
  check('el botón de la barra copia lo mismo, con los salteados separados por un renglón', c.text === 'Alpha one.\n\nOmega end.' && /Alpha one\./.test(c.html) && /Omega end\./.test(c.html) && !/Beta/.test(c.html), c);
  // Una tabla, el código y una sección desplegable.
  await page.keyboard.press('Escape');
  await marginDrag(page, 'code();', 'Inside.');
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  c = await clip(page);
  check('las cercas y los ::: van enteros', c.text === '```js\ncode();\n```\n\n::: details More\nInside.\n:::', c.text);
  await ctx.close();
  // Con títulos numerados, el número que se ve va en lo copiado.
  const two = await open();
  await note(two.page, 'd2.md', ['---', 'numbered: true', '---', '# Doc', '', '## First', '', 'One.', '', '## Second', '', 'Two.', ''].join('\n'), true);
  await marginDrag(two.page, 'Second', 'Two.');
  await wipe(two.page); await two.page.keyboard.press('Control+c'); await sleep(250);
  c = await clip(two.page);
  check('con títulos numerados, lo copiado lleva el número visible', c.text === '## 2. Second\n\nTwo.' && /2\.\s*Second/.test(c.html.replace(/<[^>]+>/g, '')), c);
  await two.ctx.close();
});

await step('Cortar, eliminar y duplicar: un paso de deshacer cada uno', async () => {
  const { ctx, page } = await open();
  await note(page, 'e.md', DOC, true);
  await marginDrag(page, 'Beta two', 'Gamma three');
  await wipe(page); await page.keyboard.press('Control+x'); await sleep(350);
  let t = await md(page);
  check('cortar saca los bloques y deja bien los renglones en blanco', t === DOC.replace('Beta two.\n\n## Section\n\nGamma three.\n\n', ''), t);
  check('y los deja en el portapapeles', (await clip(page)).text === 'Beta two.\n\n## Section\n\nGamma three.' && /Blocks cut: 3/.test(await flash(page)), await flash(page));
  check('nada queda marcado', (await sel(page)).length === 0 && (await bar(page)) === null);
  await undo(page);
  check('un solo deshacer los devuelve', (await md(page)) === DOC);
  // Eliminar con Supr, con salteados.
  await marginClick(page, 'Alpha one'); await marginClick(page, 'item a', 'Control'); await para(page, 'Omega end').click({ modifiers: ['Control'] }); await sleep(120);
  await page.keyboard.press('Delete'); await sleep(350);
  t = await md(page);
  check('Supr elimina los marcados, también salteados y el último', t === ['# Doc', '', 'Beta two.', '', '## Section', '', 'Gamma three.', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '```js', 'code();', '```', '', '::: details More', 'Inside.', ':::', ''].join('\n'), t);
  check('y lo dice, con un botón para deshacer a la vista', (await toast(page)) === 'Blocks deleted: 3 | Undo', await toast(page));
  await page.click('.lmd-cl-toast button'); await sleep(300);
  check('ese botón devuelve los tres de una vez', (await md(page)) === DOC && (await toast(page)) === '', await md(page));
  await marginClick(page, 'Alpha one'); await marginClick(page, 'item a', 'Control'); await para(page, 'Omega end').click({ modifiers: ['Control'] }); await sleep(120);
  await page.keyboard.press('Delete'); await sleep(350);
  await undo(page);
  check('y un solo Ctrl+Z también', (await md(page)) === DOC);
  await page.keyboard.press('Control+y'); await sleep(300); await undo(page);
  check('rehacer y deshacer de nuevo dejan todo igual', (await md(page)) === DOC);
  await marginClick(page, 'Beta two'); await page.keyboard.press('Backspace'); await sleep(300);
  check('Retroceso también elimina', (await md(page)) === DOC.replace('Beta two.\n\n', '') && /^Block deleted \| Undo$/.test(await toast(page)), await toast(page));
  await undo(page);
  // Duplicar: un tramo y salteados.
  await marginDrag(page, 'Alpha one', 'Beta two'); await marginClick(page, 'Inside.', 'Control');
  check('Ctrl + clic en el margen suma un bloque (una sección desplegable cerrada)', (await sel(page)).length === 3, await sel(page));
  await page.keyboard.press('Control+d'); await sleep(350);
  t = await md(page);
  const want = DOC.replace('Alpha one.\n\nBeta two.\n\n', 'Alpha one.\n\nBeta two.\n\nAlpha one.\n\nBeta two.\n\n').replace('::: details More\nInside.\n:::\n\n', '::: details More\nInside.\n:::\n\n::: details More\nInside.\n:::\n\n');
  check('Ctrl+D pone la copia debajo de cada tramo de bloques seguidos', t === want, t);
  check('y deja marcadas las copias', (await sel(page)).length === 3 && (await bar(page)).n === '3 blocks', await sel(page));
  check('las copias son las de abajo', await page.evaluate(() => { const all = [...document.querySelectorAll('.lmd-article > p')].filter((p) => p.textContent === 'Alpha one.'); return all.length === 2 && !all[0].classList.contains('lmd-bsel') && all[1].classList.contains('lmd-bsel'); }));
  await undo(page);
  check('un solo deshacer quita todas las copias', (await md(page)) === DOC);
  await marginClick(page, 'Omega end'); await page.click('.lmd-bsel-bar [data-bs=dup]'); await sleep(350);
  check('duplicar el último bloque desde la barra', (await md(page)) === DOC.replace(/Omega end\.\n$/, 'Omega end.\n\nOmega end.\n'), await md(page));
  await undo(page);
  // Dos tablas no quedan pegadas con un solo renglón.
  await marginClick(page, '1');
  await page.keyboard.press('Control+d'); await sleep(350);
  t = await md(page);
  check('duplicar una tabla deja dos renglones entre las dos, para que no se lean como una', /\| 1 \| 2 \|\n\n\n\| a \| b \|/.test(t) && await page.evaluate(() => document.querySelectorAll('.lmd-article table').length === 2), t);
  await ctx.close();
});

await step('Mover con el teclado y arrastrando', async () => {
  const { ctx, page } = await open();
  await note(page, 'f.md', DOC, true);
  await marginDrag(page, 'Alpha one', 'Beta two');
  await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  let t = await md(page);
  check('Alt+↓ baja el grupo un bloque', t === DOC.replace('Alpha one.\n\nBeta two.\n\n## Section\n\n', '## Section\n\nAlpha one.\n\nBeta two.\n\n'), t);
  check('y sigue marcado', J(await sel(page)) === J(['Alpha one.', 'Beta two.']), await sel(page));
  await page.keyboard.press('Alt+ArrowDown'); await sleep(300); await page.keyboard.press('Alt+ArrowUp'); await sleep(300);
  check('Alt+↑ lo sube', (await md(page)) === t && J(await sel(page)) === J(['Alpha one.', 'Beta two.']), await md(page));
  await page.keyboard.press('Escape'); await undo(page); await undo(page); await undo(page);
  check('cada movimiento es un paso de deshacer', (await md(page)) === DOC, await md(page));
  // Desde la barra.
  await marginClick(page, 'Omega end'); await page.click('.lmd-bsel-bar [data-bs=up]'); await sleep(350);
  check('los botones de la barra mueven igual', /Omega end\.\n\n::: details More\nInside\.\n:::\n$/.test(await md(page)), await md(page));
  await page.click('.lmd-bsel-bar [data-bs=down]'); await sleep(350);
  check('y de vuelta', (await md(page)) === DOC);
  await page.keyboard.press('Alt+ArrowDown'); await sleep(250);
  check('en el borde no pasa nada', (await md(page)) === DOC && J(await sel(page)) === J(['Omega end.']));
  await page.keyboard.press('Escape');
  // Arrastrando el grupo: indicador de destino, y un solo paso.
  await marginDrag(page, 'Alpha one', 'Beta two');
  let seen = null;
  const a = await box(page, 'Alpha one'); const g = await box(page, 'item a');
  await page.mouse.move(a.margin, a.mid); await page.mouse.down();
  await page.mouse.move(a.margin, a.mid + 10, { steps: 2 }); await page.mouse.move(g.margin, g.y - 6, { steps: 10 }); await sleep(120);
  seen = await page.evaluate(() => { const l = document.querySelector('.lmd-bsel-drop'); if (!l || l.hidden) return null; const r = l.getBoundingClientRect(); const s = getComputedStyle(l); return { y: r.top, w: r.width, bg: s.backgroundColor, moving: document.documentElement.classList.contains('lmd-bsel-moving') }; });
  await page.mouse.up(); await sleep(350);
  check('mientras se arrastra se ve dónde va a caer', !!seen && seen.w > 200 && seen.bg !== 'rgba(0, 0, 0, 0)' && seen.moving && Math.abs(seen.y - (g.y - 10)) < 30, [seen, g.y]);
  t = await md(page);
  check('al soltar, el grupo queda ahí', t === DOC.replace('Alpha one.\n\nBeta two.\n\n', '').replace('Gamma three.\n\n', 'Gamma three.\n\nAlpha one.\n\nBeta two.\n\n'), t);
  check('sin el indicador, y con el grupo marcado', await page.evaluate(() => { const l = document.querySelector('.lmd-bsel-drop'); return (!l || l.hidden) && !document.documentElement.classList.contains('lmd-bsel-moving'); }) && J(await sel(page)) === J(['Alpha one.', 'Beta two.']), await sel(page));
  await undo(page);
  check('un solo deshacer lo devuelve', (await md(page)) === DOC);
  // Salteados: van juntos al destino. Y al final del documento.
  await marginClick(page, 'Alpha one'); await para(page, 'Gamma three').click({ modifiers: ['Control'] }); await sleep(120);
  const a2 = await box(page, 'Alpha one'); const o = await box(page, 'Omega end');
  await page.mouse.move(a2.margin, a2.mid); await page.mouse.down(); await page.mouse.move(a2.margin, a2.mid + 10, { steps: 2 }); await page.mouse.move(o.margin, o.y + o.h + 14, { steps: 10 }); await page.mouse.up(); await sleep(350);
  t = await md(page);
  check('los salteados van juntos, al final', t === DOC.replace('Alpha one.\n\n', '').replace('Gamma three.\n\n', '').replace(/Omega end\.\n$/, 'Omega end.\n\nAlpha one.\n\nGamma three.\n'), t);
  await undo(page);
  check('y vuelven con un deshacer', (await md(page)) === DOC);
  // Con la manija de la barra.
  await marginClick(page, 'Omega end');
  const grip = await page.evaluate(() => { const r = document.querySelector('.lmd-bsel-bar [data-bs=grip]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const b2 = await box(page, 'Beta two');
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x, grip.y - 12, { steps: 2 }); await page.mouse.move(b2.x + 80, b2.y - 6, { steps: 10 }); await page.mouse.up(); await sleep(350);
  check('la manija de la barra arrastra el grupo', /Alpha one\.\n\nOmega end\.\n\nBeta two\./.test(await md(page)), await md(page));
  await undo(page);
  await ctx.close();
  // El arrastre desplaza la página al acercarse al borde.
  const long = await open();
  await note(long.page, 'f2.md', '# Long\n\n' + Array.from({ length: 60 }, (_, i) => 'Paragraph number ' + (i + 1) + '.').join('\n\n') + '\n', true);
  await blur(long.page); await long.page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  const p1 = await box(long.page, 'Paragraph number 2.');
  await long.page.mouse.move(p1.margin, p1.mid); await long.page.mouse.down(); await long.page.mouse.move(p1.margin, p1.mid + 10, { steps: 2 }); await long.page.mouse.move(p1.margin, 792, { steps: 6 });
  await sleep(1200);
  const y = await long.page.evaluate(() => window.scrollY); const n = (await sel(long.page)).length;
  await long.page.mouse.up(); await sleep(200);
  check('cerca del borde de abajo la página se desplaza sola y el rango sigue creciendo', y > 300 && n > 20, { y, n });
  await long.ctx.close();
});

await step('Pasar los bloques a una nota nueva (notas del navegador)', async () => {
  const { ctx, page } = await open();
  await note(page, 'g.md', DOC, true);
  await marginDrag(page, 'Section', 'Gamma three');
  await more(page);
  const ids = await menuIds(page);
  check('el menú ofrece copiar y mover a una nota nueva, envolver, y no convertir (hay un título)', ids.includes('doc-copy') && ids.includes('doc-move') && ids.includes('wrap') && !ids.includes('to-ul'), ids);
  check('con sus nombres', await page.evaluate(() => document.querySelector('.lmd-bsel-menu [data-bs=doc-copy]').textContent === 'Copy to a new document' && document.querySelector('.lmd-bsel-menu [data-bs=doc-move]').textContent === 'Move to a new document'));
  await page.click('.lmd-bsel-menu [data-bs=doc-copy]');
  check('copiar crea la nota con el nombre del primer título', await until(async () => (await saved(page, 'Section.md')) === '## Section\n\nGamma three.\n'), await notes(page));
  check('el original queda igual y se dice cómo se llama', (await md(page)) === DOC && /New note: Section\.md/.test(await flash(page)), await flash(page));
  check('y la nota nueva aparece en la lista', await until(() => page.evaluate(() => [...document.querySelectorAll('.lmd-sidebar .lmd-node')].some((n) => /Section/.test(n.textContent)))), await page.evaluate(() => [...document.querySelectorAll('.lmd-sidebar .lmd-node')].map((n) => n.textContent)));
  // Otra vez: no pisa la que ya existe.
  check('tras copiar, lo marcado sigue marcado', (await sel(page)).length === 2);
  await page.keyboard.press('Escape');
  await marginDrag(page, 'Section', 'Gamma three'); await more(page, 'doc-copy');
  check('otra copia no pisa la anterior', await until(async () => (await saved(page, 'Section-2.md')) === '## Section\n\nGamma three.\n') && (await saved(page, 'Section.md')) === '## Section\n\nGamma three.\n', await notes(page));
  // Mover: quita los bloques y deja un enlace.
  await page.keyboard.press('Escape');
  await marginDrag(page, 'Section', 'item a'); await more(page, 'doc-move');
  await until(async () => !!(await saved(page, 'Section-3.md')));
  check('mover crea la nota con los bloques', (await saved(page, 'Section-3.md')) === '## Section\n\nGamma three.\n\n- item a\n- item b\n', await saved(page, 'Section-3.md'));
  let t = await md(page);
  check('y deja en su lugar un enlace relativo, en una línea', t === DOC.replace('## Section\n\nGamma three.\n\n- item a\n- item b\n', '[Section](Section-3.md)\n'), t);
  check('que lleva a la nota nueva', await page.evaluate(() => { const a = document.querySelector('.lmd-article a[href*="Section-3"]'); return !!a && a.textContent === 'Section'; }));
  await undo(page);
  check('un solo deshacer devuelve los bloques al original', (await md(page)) === DOC);
  // Sin título: las primeras palabras. Salteados van separados por un renglón.
  await marginClick(page, 'Omega end'); await para(page, 'Alpha one').click({ modifiers: ['Control'] }); await sleep(120);
  await more(page, 'doc-move');
  await until(async () => !!(await saved(page, 'Alpha one.md')));
  check('sin título, el nombre sale de las primeras palabras', (await saved(page, 'Alpha one.md')) === 'Alpha one.\n\nOmega end.\n', await notes(page));
  t = await md(page);
  check('y el enlace queda donde estaba el primero', t === DOC.replace('Alpha one.\n', '[Alpha one.](Alpha%20one.md)\n').replace(/\n\nOmega end\.\n$/, '\n'), t);
  await page.locator('.lmd-article a', { hasText: 'Alpha one.' }).click({ modifiers: ['Control'] });
  check('el enlace abre la nota nueva', await until(() => page.evaluate(() => /Alpha%20one|Alpha one/.test(decodeURIComponent(location.href)) && /Omega end/.test(document.querySelector('.lmd-article').textContent))), await page.evaluate(() => location.href));
  await ctx.close();
});

await step('El nombre de la nota nueva no deja pasar HTML ni rutas', async () => {
  const { ctx, page } = await open();
  await page.addInitScript(() => { window.__x = 0; });
  const evil = '## <img src=x onerror="window.__x=1"> ../a/b:c*?"<>| `x`';
  await note(page, 'x.md', ['# Doc', '', evil, '', 'Body under it.', '', 'Last.', ''].join('\n'), true);
  await marginDrag(page, 'Body under it', 'Body under it'); await page.keyboard.press('Shift+ArrowUp'); await sleep(120);
  check('quedan marcados el título y su párrafo', (await sel(page)).length === 2, await sel(page));
  await more(page, 'doc-move'); await sleep(600);
  const all = await notes(page); const made = all.find((n) => n !== 'x.md');
  check('el nombre no lleva barras, dos puntos ni signos de HTML', !!made && !/[\\/:*?"<>|`]/.test(made.replace(/\.md$/, '')) && /\.md$/.test(made) && !/^\./.test(made), all);
  const t = await md(page);
  check('la nota nueva tiene el Markdown tal cual', (await saved(page, made)) === evil + '\n\nBody under it.\n', await saved(page, made));
  check('el enlace que queda es texto, sin HTML activo', /^\[.*\]\([^()\s]+\)$/m.test(t) && await page.evaluate(() => window.__x === 0 && !document.querySelector('.lmd-article img') && !document.querySelector('.lmd-sidebar img[src=x]')), t);
  check('en la lista se lee como texto', await page.evaluate(() => window.__x === 0 && !document.querySelector('.lmd-sidebar [onerror]')));
  await ctx.close();
});

await step('Envolver y convertir', async () => {
  const { ctx, page } = await open();
  await note(page, 'h.md', DOC, true);
  await marginDrag(page, 'Alpha one', 'Beta two');
  await more(page);
  const ids = await menuIds(page);
  check('para párrafos el menú ofrece las cuatro conversiones', ['to-ul', 'to-ol', 'to-task', 'to-quote'].every((i) => ids.includes(i)), ids);
  await page.click('.lmd-bsel-menu [data-bs=wrap]'); await sleep(350);
  let t = await md(page);
  check('envolver los deja dentro de una sección desplegable', t === DOC.replace('Alpha one.\n\nBeta two.\n', '::: details Details\nAlpha one.\n\nBeta two.\n:::\n'), t);
  check('abierta y con el foco en el título', await page.evaluate(() => { const d = document.querySelector('.lmd-article details.lmd-box'); return d.open && document.activeElement.classList.contains('lmd-sum-title'); }));
  await blur(page); await undo(page);
  check('un solo deshacer la saca', (await md(page)) === DOC);
  // Envolver una sección desplegable: la de afuera lleva más dos puntos.
  await marginDrag(page, 'Inside.', 'Omega end'); await more(page, 'wrap');
  t = await md(page);
  check('envolver una sección desplegable deja los ::: balanceados', /:::: details Details\n::: details More\nInside\.\n:::\n\nOmega end\.\n::::\n$/.test(t), t);
  await blur(page); await undo(page);
  const conv = async (id, want) => {
    await marginDrag(page, 'Alpha one', 'Beta two'); await more(page, id);
    const got = await md(page);
    check(id + ': los párrafos pasan a ' + J(want), got === DOC.replace('Alpha one.\n\nBeta two.\n', want), got);
    check(id + ': y quedan marcados como un bloque', (await sel(page)).length === 1, await sel(page));
    await undo(page);
    check(id + ': un solo deshacer', (await md(page)) === DOC);
  };
  await conv('to-ul', '- Alpha one.\n- Beta two.\n');
  await conv('to-ol', '1. Alpha one.\n2. Beta two.\n');
  await conv('to-task', '- [ ] Alpha one.\n- [ ] Beta two.\n');
  await conv('to-quote', '> Alpha one.\n>\n> Beta two.\n');
  // Al lado de otra lista: otra marca, para que no se junten.
  await marginClick(page, 'Gamma three'); await more(page, 'to-task');
  t = await md(page);
  check('una lista de tareas al lado de una de viñetas usa otra marca y no se juntan', /\* \[ \] Gamma three\.\n\n- item a/.test(t) && await page.evaluate(() => document.querySelectorAll('.lmd-article > ul').length === 2), t);
  await undo(page);
  await marginClick(page, 'item a'); await more(page);
  check('una lista no se convierte', !(await menuIds(page)).some((i) => /^to-/.test(i)), await menuIds(page));
  await page.keyboard.press('Escape');
  await ctx.close();
});

await step('Pegar bloques copiados', async () => {
  const { ctx, page } = await open();
  await note(page, 'i.md', DOC, true);
  await marginDrag(page, 'Section', 'Gamma three');
  await page.keyboard.press('Control+c'); await sleep(200);
  await page.keyboard.press('Escape');
  await marginClick(page, 'Omega end');
  await page.keyboard.press('Control+v'); await sleep(400);
  let t = await md(page);
  check('pegar con un bloque marcado inserta los bloques debajo', t === DOC.replace(/Omega end\.\n$/, 'Omega end.\n\n## Section\n\nGamma three.\n'), t);
  check('y quedan marcados', J(await sel(page)) === J(['Section', 'Gamma three.']), await sel(page));
  await undo(page);
  check('un solo deshacer', (await md(page)) === DOC);
  // En el medio, y tras recargar (lo copiado viaja en el portapapeles).
  await page.reload(); await page.waitForSelector('.lmd-editing .lmd-article .lmd-editable'); await sleep(400);
  await marginClick(page, 'Alpha one');
  await page.keyboard.press('Control+v'); await sleep(400);
  t = await md(page);
  check('tras recargar, lo copiado como bloques se sigue pegando como bloques', t === DOC.replace('Alpha one.\n', 'Alpha one.\n\n## Section\n\nGamma three.\n'), t);
  await undo(page);
  // Otro texto cualquiera no se pega como bloques.
  await page.evaluate(() => navigator.clipboard.writeText('just some words'));
  await marginClick(page, 'Alpha one'); await page.keyboard.press('Control+v'); await sleep(300);
  check('un texto cualquiera no se inserta como bloque', (await md(page)) === DOC, await md(page));
  // Escribiendo, pegar sigue pegando texto en el bloque.
  await para(page, 'Beta two').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Control+v'); await sleep(300); await blur(page); await sleep(200);
  check('con el cursor en un bloque, pegar sigue siendo pegar texto ahí', /Beta two\.just some words/.test(await md(page)), await md(page));
  await ctx.close();
});

await step('Título plegado: lleva lo que esconde', async () => {
  const { ctx, page } = await open({ fold: true });
  const F = ['# Doc', '', 'Intro.', '', '## First', '', 'One a.', '', 'One b.', '', '### Sub', '', 'One c.', '', '## Second', '', 'Two.', ''].join('\n');
  await note(page, 'j.md', F, true);
  await page.evaluate(() => { const h = [...document.querySelectorAll('.lmd-article > h2')].find((x) => /First/.test(x.textContent)); h.querySelector('.lmd-fold-tog').click(); }); await sleep(250);
  check('la sección queda plegada', await page.evaluate(() => document.querySelectorAll('.lmd-article > .lmd-fold-away').length === 4));
  await marginClick(page, 'First');
  check('marcar el título plegado cuenta lo que esconde, y la barra lo dice', J(await sel(page)) === J(['First']) && (await bar(page)).n === '5 blocks', [await sel(page), await bar(page)]);
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  check('copiarlo lleva todo', (await clip(page)).text === '## First\n\nOne a.\n\nOne b.\n\n### Sub\n\nOne c.', (await clip(page)).text);
  await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  let t = await md(page);
  check('moverlo lleva su contenido', t === ['# Doc', '', 'Intro.', '', '## Second', '', '## First', '', 'One a.', '', 'One b.', '', '### Sub', '', 'One c.', '', 'Two.', ''].join('\n') || t === ['# Doc', '', 'Intro.', '', '## Second', '', 'Two.', '', '## First', '', 'One a.', '', 'One b.', '', '### Sub', '', 'One c.', ''].join('\n'), t);
  await undo(page);
  check('deshacer lo devuelve', (await md(page)) === F);
  await marginClick(page, 'First'); await page.keyboard.press('Delete'); await sleep(350);
  t = await md(page);
  check('eliminarlo se lleva la sección entera y lo dice', t === ['# Doc', '', 'Intro.', '', '## Second', '', 'Two.', ''].join('\n') && /Blocks deleted: 5/.test(await toast(page)), [t, await toast(page)]);
  await undo(page);
  check('y un deshacer la devuelve entera', (await md(page)) === F);
  // Un título que sube pasa por arriba de toda la sección plegada, no se mete adentro.
  await marginClick(page, 'Second'); await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  t = await md(page);
  check('un bloque que sube salta la sección plegada entera', t === ['# Doc', '', 'Intro.', '', '## Second', '', '## First', '', 'One a.', '', 'One b.', '', '### Sub', '', 'One c.', '', 'Two.', ''].join('\n'), t);
  check('que sigue plegada', await page.evaluate(() => document.querySelectorAll('.lmd-article > .lmd-fold-shut').length === 1));
  await undo(page);
  // Uno que baja queda al final de esa sección: se despliega para que no desaparezca.
  await marginClick(page, 'Intro.'); await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  t = await md(page);
  check('un bloque que baja pasa toda la sección plegada', t === ['# Doc', '', '## First', '', 'One a.', '', 'One b.', '', '### Sub', '', 'One c.', '', 'Intro.', '', '## Second', '', 'Two.', ''].join('\n'), t);
  check('y como quedó dentro de ella, la sección se despliega y el bloque sigue marcado y a la vista', J(await sel(page)) === J(['Intro.']) && await page.evaluate(() => !document.querySelector('.lmd-article > .lmd-fold-away') && !document.querySelector('.lmd-article > .lmd-fold-shut')), await sel(page));
  await ctx.close();
});

await step('Solo lectura: se marca y se copia, nada más', async () => {
  const A = await R.signup('blk-a@ejemplo.test', true); const B = await R.signup('blk-b@ejemplo.test');
  const RO = ['# Shared', '', 'Read one.', '', 'Read two.', '', 'Read three.', ''].join('\n');
  await R.api('PUT', '/notes/ro.md', { text: RO }, A.s);
  await R.api('POST', '/shares', { path: 'ro.md', email: B.email, role: 'view', kind: 'note' }, A.s);
  const shared = (await R.api('GET', '/shared', undefined, B.s)).json; const owner = ((Array.isArray(shared) ? shared : shared.notes || shared.shared || [])[0] || {}).owner;
  const { ctx, page } = await open({ who: B });
  await page.goto(R.noteUrl('~' + owner + '/ro.md')); await page.waitForSelector('.lmd-article p'); await sleep(500);
  check('la nota es de solo lectura', await page.evaluate(() => document.documentElement.classList.contains('lmd-readonly')));
  await marginDrag(page, 'Read one', 'Read two');
  const b = await bar(page);
  check('se pueden marcar bloques', J(await sel(page)) === J(['Read one.', 'Read two.']), await sel(page));
  check('la barra ofrece solo copiar', !!b && J(b.btns) === J(['copy']), b);
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  check('y copia', (await clip(page)).text === 'Read one.\n\nRead two.', await clip(page));
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await page.keyboard.press('Control+x'); await page.keyboard.press('Control+d'); await page.keyboard.press('Alt+ArrowDown'); await page.keyboard.press('Control+v'); await sleep(300);
  check('ni eliminar, ni cortar, ni duplicar, ni mover, ni pegar cambian nada', (await md(page)) === RO && (await R.api('GET', '/notes/ro.md', undefined, A.s)).json.text === RO, await md(page));
  const a = await box(page, 'Read one'); const c = await box(page, 'Read three');
  await page.mouse.move(a.margin, a.mid); await page.mouse.down(); await page.mouse.move(a.margin, a.mid + 10, { steps: 2 }); await page.mouse.move(c.margin, c.y + c.h + 10, { steps: 8 }); await page.mouse.up(); await sleep(300);
  check('arrastrar tampoco mueve', (await md(page)) === RO);
  await marginDrag(page, 'Read one', 'Read two');
  await page.locator('.lmd-article p', { hasText: 'Read two' }).click({ button: 'right' }); await sleep(200);
  check('el menú de lo marcado tampoco ofrece cambiar nada ni pasar a otra nota', J(await menuIds(page)) === J(['copy']), await menuIds(page));
  await ctx.close();
  // Leyendo una nota propia: marcar y copiar, y copiar a una nota nueva; para lo demás hay que estar editando.
  const own = await open();
  await note(own.page, 'k.md', DOC, false);
  await marginDrag(own.page, 'Alpha one', 'Beta two');
  const ob = await bar(own.page);
  check('leyendo una nota propia: copiar, y copiar a una nota nueva', !!ob && J(ob.btns) === J(['copy', 'more']) && await (async () => { await more(own.page); const ids = await menuIds(own.page); await own.page.keyboard.press('Escape'); return J(ids) === J(['doc-copy']); })(), ob);
  await own.page.keyboard.press('Delete'); await sleep(200);
  check('y Supr no borra', (await md(own.page)) === DOC);
  await own.ctx.close();
});

await step('Menú contextual y manija sobre lo marcado', async () => {
  const { ctx, page } = await open();
  await note(page, 'l.md', DOC, true);
  await marginDrag(page, 'Alpha one', 'Beta two');
  await para(page, 'Beta two').click({ button: 'right' }); await sleep(200);
  const ids = await menuIds(page);
  check('clic derecho sobre lo marcado abre las mismas acciones', J(ids) === J(['copy', 'cut', 'dup', 'up', 'down', 'doc-copy', 'doc-move', 'wrap', 'to-ul', 'to-ol', 'to-task', 'to-quote', 'del']) && await page.evaluate(() => document.querySelectorAll('.lmd-menu').length === 1), ids);
  await page.click('.lmd-bsel-menu [data-bs=dup]'); await sleep(350);
  check('y actúan sobre todos', /Alpha one\.\n\nBeta two\.\n\nAlpha one\.\n\nBeta two\./.test(await md(page)), await md(page));
  await undo(page);
  // Clic derecho fuera de lo marcado: el menú del bloque de siempre.
  await marginDrag(page, 'Alpha one', 'Beta two');
  await para(page, 'Omega end').click({ button: 'right' }); await sleep(200);
  check('clic derecho en otro bloque abre el menú de ese bloque, y suelta lo marcado', await page.evaluate(() => !document.querySelector('.lmd-bsel-menu') && !!document.querySelector('.lmd-menu [data-op=dup]')) && (await sel(page)).length === 0, await sel(page));
  check('con mouse ese menú queda como estaba', await page.evaluate(() => !document.querySelector('.lmd-menu [data-extra=bsel-pick]')));
  await page.keyboard.press('Escape');
  // La manija de un bloque marcado entre varios abre las acciones de todos; arrastrarla marca un rango.
  await marginDrag(page, 'Alpha one', 'Beta two');
  await para(page, 'Beta two').hover(); await sleep(150);
  await page.click('.lmd-handle'); await sleep(200);
  check('la manija de un bloque marcado abre las acciones del grupo', (await menuIds(page)).includes('doc-move') && (await sel(page)).length === 2, await menuIds(page));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(100);
  await para(page, 'Gamma three').hover(); await sleep(150);
  const h = await page.evaluate(() => { const r = document.querySelector('.lmd-handle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const o = await box(page, 'Omega end');
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x, h.y + 10, { steps: 2 }); await page.mouse.move(h.x, o.mid, { steps: 8 }); await page.mouse.up(); await sleep(250);
  check('arrastrar desde la manija marca un rango', (await sel(page)).length === 6 && (await sel(page))[0] === 'Gamma three.' && !(await page.evaluate(() => !!document.querySelector('.lmd-menu'))), await sel(page));
  await page.keyboard.press('Escape');
  await para(page, 'Gamma three').hover(); await sleep(150); await page.click('.lmd-handle'); await sleep(200);
  check('y un clic en la manija sin nada marcado abre el menú del bloque, como siempre', await page.evaluate(() => !!document.querySelector('.lmd-menu [data-op=del]') && !document.querySelector('.lmd-bsel-menu')));
  await ctx.close();
});

await step('Los doce temas: lo marcado se distingue', async () => {
  const { ctx, page } = await open();
  await note(page, 'm.md', DOC, true);
  const themes = await page.evaluate(() => LMD.theme.PRESETS.map((p) => ({ id: p.id, dark: p.dark })));
  const bad = [];
  for (const th of themes) {
    await page.evaluate((t) => new Promise((r) => { LMD.patch({ preset: t.id, theme: t.dark ? 'dark' : 'light' }); setTimeout(r, 250); }), th);
    await marginDrag(page, 'Alpha one', 'Beta two');
    const got = await page.evaluate(() => {
      const rgb = (c) => { const v = (c.replace(/^color\(srgb/, '').match(/-?[\d.]+(e-?\d+)?/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => (i < 3 ? x * 255 : x)) : v; };
      const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const over = (top, under) => { const a = top.length > 3 ? top[3] : 1; return top.slice(0, 3).map((v, i) => v * a + under[i] * (1 - a)); };
      const n = document.querySelector('.lmd-article > .lmd-bsel'); if (!n) return null;
      const s = getComputedStyle(n); const page = rgb(getComputedStyle(document.body).backgroundColor);
      // El contorno, como se ve sobre el fondo de la página.
      const probe = document.createElement('div'); probe.style.color = s.outlineColor; document.body.appendChild(probe); const oc = rgb(getComputedStyle(probe).color); probe.remove();
      const line = over(oc, page); const a = lum(line); const b = lum(page);
      const fill = over(rgb(s.backgroundColor), page);
      return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fill: fill.some((v, i) => Math.abs(v - page[i]) > 3), n: document.querySelectorAll('.lmd-article > .lmd-bsel').length };
    });
    if (!got || got.n !== 2 || got.ratio < 2 || !got.fill) bad.push([th.id, got]);
    await page.keyboard.press('Escape');
  }
  check('doce temas', themes.length === 12, themes.length);
  check('en cada uno el contorno contrasta con la página (2:1 o más) y el fondo cambia', bad.length === 0, bad);
  await ctx.close();
});

await step('Con el dedo: mantener apretado entra en modo selección', async () => {
  const { ctx, page } = await open({ ctx: SMALL });
  await note(page, 'n.md', DOC, true);
  const cdp = await ctx.newCDPSession(page);
  const press = async (has) => {
    const b = await box(page, has); const x = b.x + Math.min(60, b.w / 2); const y = b.mid;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(750);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
  };
  const tap = async (has) => { const b = await box(page, has); await page.touchscreen.tap(b.x + Math.min(60, b.w / 2), b.mid); await sleep(300); };
  await press('Beta two');
  let b = await bar(page);
  check('mantener apretado un bloque lo marca y abre la barra con "Listo"', J(await sel(page)) === J(['Beta two.']) && !!b && b.btns.includes('done') && await page.evaluate(() => document.querySelector('.lmd-bsel-bar [data-bs=done]').textContent === 'Done'), [await sel(page), b]);
  check('sin teclado ni cursor en el bloque', await page.evaluate(() => document.activeElement === document.body && String(getSelection()) === ''));
  await tap('Gamma three'); await tap('Alpha one');
  check('tocar otros bloques los suma', J(await sel(page)) === J(['Alpha one.', 'Beta two.', 'Gamma three.']) && (await bar(page)).n === '3 blocks', await sel(page));
  check('y no entra a escribir en ellos', await page.evaluate(() => document.activeElement === document.body));
  await tap('Beta two');
  check('tocar uno marcado lo quita', J(await sel(page)) === J(['Alpha one.', 'Gamma three.']), await sel(page));
  const fit = await page.evaluate(() => { const r = document.querySelector('.lmd-bsel-bar').getBoundingClientRect(); const t = [...document.querySelectorAll('.lmd-bsel-bar button')].filter((x) => !x.hidden).map((x) => x.getBoundingClientRect()); return { in: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight, low: r.top > innerHeight / 2, big: t.every((x) => x.height >= 40 && x.width >= 40), page: document.documentElement.scrollWidth <= innerWidth }; });
  check('la barra va abajo, entra en la pantalla y sus botones se pueden tocar', fit.in && fit.low && fit.big && fit.page, fit);
  await page.tap('.lmd-bsel-bar [data-bs=dup]'); await sleep(400);
  check('las acciones andan con el dedo', /Alpha one\.\n\nAlpha one\./.test(await md(page)) && /Gamma three\.\n\nGamma three\./.test(await md(page)), await md(page));
  await page.tap('.lmd-bsel-bar [data-bs=done]'); await sleep(200);
  check('"Listo" sale del modo', (await sel(page)).length === 0 && (await bar(page)) === null);
  await tap('Beta two');
  check('y tocar un bloque vuelve a ser para escribir', await page.evaluate(() => document.activeElement.isContentEditable && document.activeElement.textContent === 'Beta two.') && (await sel(page)).length === 0);
  // En el bloque donde ya está el cursor, mantener apretado sigue siendo del texto.
  await press('Beta two');
  check('mantener apretado el bloque donde está el cursor no entra en modo selección', (await sel(page)).length === 0);
  // La manija del bloque también ofrece entrar a seleccionar.
  await page.tap('.lmd-handle'); await sleep(250);
  check('el menú de la manija ofrece seleccionar el bloque', await page.evaluate(() => { const x = document.querySelector('.lmd-menu [data-extra=bsel-pick]'); return !!x && x.textContent === 'Select the block'; }));
  await page.tap('.lmd-menu [data-extra=bsel-pick]'); await sleep(250);
  check('y lo marca, en modo selección', J(await sel(page)) === J(['Beta two.']) && (await bar(page)).btns.includes('done'), await sel(page));
  await ctx.close();
  // Leyendo: el menú de mantener apretado ofrece seleccionar.
  const read = await open({ ctx: SMALL });
  await note(read.page, 'n2.md', DOC, false);
  const cdp2 = await read.ctx.newCDPSession(read.page);
  const b2 = await box(read.page, 'Beta two');
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b2.x + 60, y: b2.mid }] }); await sleep(750);
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
  check('leyendo, el menú de mantener apretado ofrece seleccionar el bloque', await read.page.evaluate(() => { const x = document.querySelector('.lmd-menu-read [data-read=bsel-pick]'); return !!x && x.textContent === 'Select the block'; }), await read.page.evaluate(() => [...document.querySelectorAll('.lmd-menu button')].map((x) => x.textContent)));
  await read.page.tap('.lmd-menu-read [data-read=bsel-pick]'); await sleep(250);
  const g2 = await box(read.page, 'Gamma three'); await read.page.touchscreen.tap(g2.x + 60, g2.mid); await sleep(300);
  const rb = await bar(read.page);
  check('y desde ahí se suman otros tocándolos, con copiar y "Listo"', J(await sel(read.page)) === J(['Beta two.', 'Gamma three.']) && !!rb && rb.btns.includes('copy') && rb.btns.includes('done') && !rb.btns.includes('del'), [await sel(read.page), rb]);
  await read.ctx.close();
});

await step('En la nube: la nota nueva va a la misma carpeta', async () => {
  const A = await R.signup('blk-nube@ejemplo.test', true);
  await R.api('PUT', '/notes/' + enc('proj/plan.md'), { text: DOC }, A.s);
  await R.api('PUT', '/notes/' + enc('proj/Section.md'), { text: 'ya estaba\n' }, A.s);
  const { ctx, page } = await open({ who: A });
  await page.goto(R.noteUrl('proj/plan.md', true)); await page.waitForSelector('.lmd-editing .lmd-article .lmd-editable'); await sleep(500);
  const paths = async () => (await R.api('GET', '/notes', undefined, A.s)).json.map((n) => n.path).sort();
  const text = async (p) => ((await R.api('GET', '/notes/' + enc(p), undefined, A.s)).json || {}).text;
  await marginDrag(page, 'Section', 'Gamma three'); await more(page, 'doc-move');
  check('la nota nueva queda en la misma carpeta, sin pisar la que ya había', await until(async () => (await paths()).includes('proj/Section-2.md'), 6000) && (await text('proj/Section.md')) === 'ya estaba\n', await paths());
  check('con los bloques', (await text('proj/Section-2.md')) === '## Section\n\nGamma three.\n', await text('proj/Section-2.md'));
  const t = await md(page);
  check('y el original queda con el enlace relativo', t === DOC.replace('## Section\n\nGamma three.\n', '[Section](Section-2.md)\n'), t);
  check('que se guarda en la nube', await until(async () => (await text('proj/plan.md')) === t, 8000), await text('proj/plan.md'));
  await blur(page); await undo(page);
  check('deshacer devuelve los bloques', (await md(page)) === DOC);
  await ctx.close();
});

// Con archivos del disco hace falta un perfil de verdad (ahí se guardan los permisos): la app dentro de la extensión,
// como en lists.mjs. Ese navegador arranca en castellano.
await step('En una carpeta del disco, y con un archivo suelto', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
    const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
    const home = 'chrome-extension://' + id + '/src/app.html';
    const seed = () => page.evaluate(async (doc) => {
      const top = await navigator.storage.getDirectory();
      const dir = await top.getDirectoryHandle('bloques', { create: true });
      const put = async (d, name, text) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(text); await s.close(); return h; };
      if (!(await dir.getFileHandle('doc.md').catch(() => null))) { await put(dir, 'doc.md', doc); await put(dir, 'Section.md', 'ya estaba\n'); await put(top, 'suelto.md', doc); }
      const lone = await top.getFileHandle('suelto.md');
      window.showDirectoryPicker = async () => dir; window.showOpenFilePicker = async () => [lone];
      window.__read = async (d, name) => { try { return await (await (await (d ? await top.getDirectoryHandle(d) : top).getFileHandle(name)).getFile()).text(); } catch (e) { return null; } };
    }, DOC);
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=dir]'); await seed();
    await Promise.all([page.waitForNavigation(), page.click('[data-home=dir]')]); await page.waitForSelector('.lmd-article h1'); await sleep(400);
    await page.click('[data-act=mode-edit]'); await sleep(400); await blur(page); await seed();
    await marginDrag(page, 'Section', 'Gamma three'); await more(page, 'doc-move');
    check('en una carpeta del disco, la nota nueva queda en esa carpeta sin pisar la que había', await until(() => page.evaluate(async () => (await window.__read('bloques', 'Section-2.md')) === '## Section\n\nGamma three.\n' && (await window.__read('bloques', 'Section.md')) === 'ya estaba\n')), await page.evaluate(() => window.__read('bloques', 'Section-2.md')));
    check('y el original queda con el enlace', (await md(page)) === DOC.replace('## Section\n\nGamma three.\n', '[Section](Section-2.md)\n'), await md(page));
    check('la carpeta la muestra', await until(() => page.evaluate(() => [...document.querySelectorAll('.lmd-sidebar .lmd-node')].some((n) => /Section-2/.test(n.textContent)))));
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+s');
    check('y al guardar, el archivo original lleva el enlace', await until(() => page.evaluate(async () => /\[Section\]\(Section-2\.md\)/.test(await window.__read('bloques', 'doc.md') || '')), 6000), await page.evaluate(() => window.__read('bloques', 'doc.md')));
    // Un archivo abierto suelto: no hay carpeta ni cuenta donde dejar la nota nueva.
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=file]'); await seed();
    await Promise.all([page.waitForNavigation(), page.click('[data-home=file]')]); await page.waitForSelector('.lmd-article h1'); await sleep(400);
    await page.click('[data-act=mode-edit]'); await sleep(400); await blur(page); await seed();
    await marginDrag(page, 'Section', 'Gamma three'); await more(page);
    const loose = await menuIds(page);
    check('con un archivo suelto no hay dónde guardar la nota nueva: se ofrece copiar, no mover', loose.includes('doc-copy') && !loose.includes('doc-move'), loose);
    await page.click('.lmd-bsel-menu [data-bs=doc-copy]');
    check('con un archivo suelto, la nota nueva se abre sin guardar', await until(() => page.evaluate(() => /mem\/Section\.md/.test(decodeURIComponent(location.href)) && document.querySelector('.lmd-article').textContent.includes('Gamma three.') && !document.querySelector('.lmd-article').textContent.includes('Alpha one.'))), await page.evaluate(() => location.href));
    check('y se avisa que fue una copia', /Se copió: todavía no hay dónde guardar la nota nueva/.test(await flash(page)), await flash(page));
    // Una nota sin archivo no tiene nada en el disco que releer: ese aviso no lo pisa otro a los segundos.
    await sleep(3500);
    check('a los segundos no aparece un aviso de cambio en el disco', !/cambió en el disco/.test(await flash(page)) && await page.evaluate(() => !/cambió en el disco/.test(document.body.innerText)), await flash(page));
    await seed();
    check('el original no cambió', (await page.evaluate(() => window.__read('', 'suelto.md'))) === DOC);
    // Y desde una nota que todavía no se guardó, no se abre otra encima.
    await blur(page); await marginClick(page, 'Gamma three'); await more(page); await page.click('.lmd-bsel-menu [data-bs=doc-copy]');
    check('desde una nota sin guardar no se abre otra encima: se pide guardarla primero', await until(async () => /Guardá esta nota antes/.test(await flash(page)), 3000) && await page.evaluate(() => /mem\/Section\.md/.test(decodeURIComponent(location.href)) && document.querySelector('.lmd-article').textContent.includes('Section')), await flash(page));
  } finally { await ctx.close(); }
});

await step('Sesión en vivo: un bloque que otro tiene tomado no se corta, no se mueve ni se elimina', async () => {
  const A = await R.signup('blk-live@ejemplo.test', true);
  const LIVE = '# Live\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';
  await R.api('PUT', '/notes/live.md', { text: LIVE }, A.s);
  const own = await open({ who: A });
  await own.page.goto(R.noteUrl('live.md', true)); await own.page.waitForSelector('.lmd-article .lmd-editable'); await sleep(400);
  await own.page.click('[data-act=sync]'); await own.page.click('.lmd-menu [data-s=live]');
  await own.page.waitForSelector('.lmd-live-card [data-lv=name]');
  await own.page.fill('[data-lv=name]', 'Ana'); await own.page.click('[data-lv=start]');
  await own.page.waitForSelector('.lmd-live-link input');
  const link = await own.page.inputValue('.lmd-live-link input');
  await own.page.click('.lmd-live-card [data-lv=close]');
  const ben = await R.open(null);
  await ben.page.goto(link); await ben.page.waitForSelector('.lmd-live-card input');
  await ben.page.fill('.lmd-live-card input', 'Ben'); await ben.page.click('.lmd-live-card [data-lv=join]');
  await ben.page.waitForSelector('.lmd-live-bar'); await ben.page.waitForSelector('.lmd-article .lmd-editable');
  await ben.page.locator('.lmd-article .lmd-editable', { hasText: 'Second paragraph' }).click();
  await ben.page.keyboard.press('End'); await ben.page.keyboard.type(' Ben.', { delay: 25 });
  const held = await own.page.waitForFunction(() => !!document.querySelector('.lmd-article .lmd-live-held'), null, { timeout: 8000 }).then(() => true, () => false);
  check('el bloque del otro queda tomado', held);
  await own.page.waitForFunction(() => /Second paragraph\. Ben\./.test(document.querySelector('.lmd-article').innerText), null, { timeout: 8000 }).catch(() => {});
  await ben.page.keyboard.type(' More', { delay: 60 });
  await marginDrag(own.page, 'First paragraph', 'Third paragraph');
  check('se puede marcar el rango', (await sel(own.page)).length === 3, await sel(own.page));
  await own.page.keyboard.press('Delete'); await sleep(250);
  const said = await flash(own.page);
  check('eliminar el rango no se puede, y se avisa corto', /Third paragraph/.test(await md(own.page)) && /First paragraph/.test(await md(own.page)) && /Ben is typing in those blocks/.test(said), said);
  await own.page.keyboard.press('Control+x'); await own.page.keyboard.press('Alt+ArrowUp'); await sleep(250);
  check('ni cortarlo ni moverlo', /^# Live\n\nFirst paragraph\.\n\nSecond paragraph\..*\n\nThird paragraph\.\n$/.test(await md(own.page)) && (await sel(own.page)).length === 3, [await md(own.page), await sel(own.page)]);
  await wipe(own.page); await own.page.keyboard.press('Control+c'); await sleep(250);
  check('copiarlo sí', /^First paragraph\.\n\nSecond paragraph\..*\n\nThird paragraph\.$/.test((await clip(own.page)).text), await clip(own.page));
  // Un rango que no toca el bloque tomado sí se elimina, y le llega al otro.
  await own.page.keyboard.press('Escape'); await marginClick(own.page, 'Third paragraph');
  await own.page.keyboard.press('Delete'); await sleep(300);
  check('fuera de ese bloque, eliminar anda', !/Third paragraph/.test(await md(own.page)));
  check('y el cambio le llega al invitado', await ben.page.waitForFunction(() => !/Third paragraph/.test(document.querySelector('.lmd-article').innerText), null, { timeout: 8000 }).then(() => true, () => false));
  check('que sigue con el cursor en su bloque', await ben.page.evaluate(() => /Second paragraph/.test(document.activeElement.textContent)));
  await own.ctx.close(); await ben.ctx.close();
});

await step('Listas dentro de una sección desplegable', async () => {
  const { ctx, page } = await open();
  const L = ['# Doc', '', '::: details Steps', 'Before.', '', '1. uno', '2. dos', '3. tres', '', 'After inside.', ':::', '', 'Outside.', ''].join('\n');
  await note(page, 'o.md', L, true);
  await page.evaluate(() => { document.querySelector('.lmd-article details.lmd-box').open = true; }); await sleep(150);
  const item = (t) => page.locator('.lmd-article details li .lmd-editable', { hasText: t }).first();
  await item('uno').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('nuevo', { delay: 15 }); await sleep(1500);
  let t = await md(page);
  check('un ítem nuevo en el medio renumera los que siguen, dentro de la sección', t === L.replace('1. uno\n2. dos\n3. tres', '1. uno\n2. nuevo\n3. dos\n4. tres'), t);
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await blur(page);
  await undo(page);
  check('y un solo deshacer lo vuelve atrás', (await md(page)) === L, await md(page));
  await page.evaluate(() => { document.querySelector('.lmd-article details.lmd-box').open = true; }); await sleep(100);
  await item('dos').click(); await page.keyboard.press('Tab'); await sleep(400);
  t = await md(page);
  check('Tab sangra el ítem y renumera, sin salir de la sección', t === L.replace('1. uno\n2. dos\n3. tres', '1. uno\n   1. dos\n2. tres'), t);
  check('la sección sigue abierta, con el cursor en el ítem', await page.evaluate(() => document.querySelector('.lmd-article details.lmd-box').open && document.activeElement.textContent === 'dos' && !!document.activeElement.closest('details')));
  await page.keyboard.press('Shift+Tab'); await sleep(400);
  check('Mayúsculas + Tab lo devuelve', (await md(page)) === L, await md(page));
  await item('tres').click(); await page.keyboard.press('Alt+ArrowUp'); await sleep(400);
  t = await md(page);
  check('Alt+↑ mueve el ítem y renumera', t === L.replace('1. uno\n2. dos\n3. tres', '1. uno\n2. tres\n3. dos'), t);
  await blur(page); await undo(page);
  await page.evaluate(() => { document.querySelector('.lmd-article details.lmd-box').open = true; }); await sleep(100);
  await item('dos').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await sleep(400);
  t = await md(page);
  check('borrar un ítem renumera', t === L.replace('1. uno\n2. dos\n3. tres', '1. uno\n2. tres'), t);
  check('los ::: siguen en su lugar y lo de afuera, afuera', /\nAfter inside\.\n:::\n\nOutside\.\n$/.test(t) && await page.evaluate(() => { const d = document.querySelector('.lmd-article details.lmd-box'); return !!d && !d.textContent.includes('Outside.') && d.textContent.includes('After inside.'); }), t);
  // Y la sección entera, como bloque.
  await blur(page); await marginClick(page, 'After inside');
  check('la sección con su lista es un solo bloque', (await sel(page)).length === 1 && (await bar(page)).n === '1 block', await sel(page));
  await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  check('y se mueve entera', /Outside\.\n\n::: details Steps\nBefore\.\n\n1\. uno\n2\. tres\n\nAfter inside\.\n:::\n$/.test(await md(page)), await md(page));
  await ctx.close();
});

check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 3));
check('sin errores de página', R.errors.length === 0, R.errors.slice(0, 3));
await R.close();
process.exit(done() ? 1 : 0);
