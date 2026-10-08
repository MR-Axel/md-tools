// Ítems de lista como unidad de selección (src/blocks.js y src/lists.js): marcarlos desde la viñeta, con Mayúsculas o
// Ctrl + clic y con el teclado; copiar, cortar, eliminar, duplicar, mover, sangrar, convertir, tildar y pasar a una
// nota nueva. Y lo que cierra la selección de bloques: listas vecinas que siguen siendo dos, lo marcado que sobrevive
// a un redibujado, el costo del arrastre en una nota larga, pegar entre pestañas, y Escape con Retroceso.
// (Mover a una nota nueva sin dónde guardarla y el aviso del disco en una nota sin archivo están en blocks.mjs.)
import { rig, tally, sleep } from './rig.mjs';

const R = await rig({ SHARE_FREE: '1' });
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const enc = encodeURIComponent;
const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const ONLY = process.env.ONLY || '';
const step = async (name, fn) => { if (ONLY && !name.includes(ONLY)) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

async function open() {
  const { ctx, page } = await R.open(null);
  await page.addInitScript(([base]) => {
    try {
      if (localStorage.getItem('itm:listo')) return; localStorage.setItem('itm:listo', '1');
      localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: 'en' }));
    } catch (e) { /* página en blanco */ }
  }, [R.base]);
  return { ctx, page };
}
const noteUrl = (name, edit) => R.home + '?f=' + enc('local/' + name) + (edit ? '&edit=1' : '');
async function note(page, name, text, edit) {
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
  await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text, name);
const md = async (page) => (await page.evaluate(() => LMD.page.md())).replace(/\r/g, '');
const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
const text = (page, has) => page.locator('.lmd-article .lmd-editable', { hasText: has }).last();
const flash = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const toast = (page) => page.evaluate(() => { const t = document.querySelector('.lmd-cl-toast'); return t ? t.querySelector('span').textContent + ' | ' + t.querySelector('button').textContent : ''; });
// Los bloques marcados y los ítems marcados, por su texto (el de un ítem, sin sus subítems).
const sel = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article > .lmd-bsel')].map((n) => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)));
const isel = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article li.lmd-bsel')].map((n) => { const c = n.cloneNode(true); c.querySelectorAll('ul, ol, button').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); }));
const bar = (page) => page.evaluate(() => {
  const b = document.querySelector('.lmd-bsel-bar'); if (!b || b.hidden) return null;
  return { label: b.getAttribute('aria-label'), n: b.querySelector('.lmd-bsel-n').textContent, btns: [...b.querySelectorAll('button')].filter((x) => !x.hidden).map((x) => x.dataset.bs) };
});
// La viñeta de un ítem: un punto en el margen de su lista, a la izquierda de su texto o de su casilla.
const dot = (page, has) => page.evaluate((t) => {
  const li = [...document.querySelectorAll('.lmd-article li')].filter((x) => { const c = x.cloneNode(true); c.querySelectorAll('ul, ol').forEach((n) => n.remove()); return c.textContent.includes(t); }).pop();
  const first = [...li.childNodes].find((n) => (n.nodeType === 1 ? !n.classList.contains('lmd-cl-grip') : n.nodeType === 3 && !!n.nodeValue.trim()));
  const range = document.createRange(); range.selectNode(first); const r = first.nodeType === 1 ? first.getBoundingClientRect() : range.getClientRects()[0];
  const x = r.left - 7; const y = r.top + Math.min(r.height, 24) / 2; const at = document.elementFromPoint(x, y);
  return { x, y, tag: at ? at.tagName : '' };
}, has);
const dotClick = async (page, has, mod) => { const d = await dot(page, has); if (mod) await page.keyboard.down(mod); await page.mouse.click(d.x, d.y); if (mod) await page.keyboard.up(mod); await sleep(120); return d; };
async function dotDrag(page, from, to, dy) {
  const a = await dot(page, from); const b = typeof to === 'string' ? await dot(page, to) : to;
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x, a.y + 7, { steps: 2 }); await page.mouse.move(a.x, b.y + (dy || 0), { steps: 8 });
  await page.mouse.up(); await sleep(250);
}
const box = (page, has) => page.evaluate((t) => { const art = document.querySelector('.lmd-article'); const n = [...art.children].find((x) => !x.matches('.lmd-add') && x.textContent.includes(t)); const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height, mid: r.top + r.height / 2, margin: art.getBoundingClientRect().left + 22 }; }, has);
const marginClick = async (page, has, mod) => { const b = await box(page, has); if (mod) await page.keyboard.down(mod); await page.mouse.click(b.margin, b.mid); if (mod) await page.keyboard.up(mod); await sleep(120); };
const clip = (page) => page.evaluate(async () => {
  const out = { text: '', html: '' };
  for (const it of await navigator.clipboard.read()) { for (const t of it.types) { const v = await (await it.getType(t)).text(); if (t === 'text/plain') out.text = v.split(String.fromCharCode(13)).join(''); if (t === 'text/html') out.html = v; } }
  return out;
});
const wipe = (page) => page.evaluate(() => navigator.clipboard.writeText('nada'));
const undo = async (page) => { await page.keyboard.press('Control+z'); await sleep(300); };
const more = async (page, id) => { await page.click('.lmd-bsel-bar [data-bs=more]'); await page.waitForSelector('.lmd-bsel-menu'); if (id) { await page.click('.lmd-bsel-menu [data-bs="' + id + '"]'); await sleep(350); } };
const menuIds = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-bsel-menu [data-bs]')].map((b) => b.dataset.bs));
const lists = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article > ul, .lmd-article > ol')].map((l) => l.tagName.toLowerCase() + ':' + [...l.children].filter((x) => x.tagName === 'LI').length));
// Pega como lo haría el navegador, con el portapapeles que se le pase (tipo -> contenido).
const paste = async (page, data) => { await page.evaluate((d) => { const dt = new DataTransfer(); Object.keys(d).forEach((k) => dt.setData(k, d[k])); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, data); await sleep(400); };

const LIST = ['# Doc', '', 'Intro.', '', '1. one', '2. two', '   - sub a', '   - sub b', '3. three', '4. four', '', 'Outro.', ''].join('\n');
const swap = (from, to) => LIST.replace(from, to);
const ALL = '1. one\n2. two\n   - sub a\n   - sub b\n3. three\n4. four';

await step('Marcar ítems: desde la viñeta, con Mayúsculas y Ctrl + clic', async () => {
  const { ctx, page } = await open();
  await note(page, 'a.md', LIST, true);
  const d = await dot(page, 'two');
  check('la viñeta de un ítem es margen de su lista, no texto', /^(LI|OL|UL)$/.test(d.tag), d);
  await dotDrag(page, 'two', 'three');
  check('arrastrar desde la viñeta marca un rango de ítems de esa lista', J(await isel(page)) === J(['two', 'three']) && (await sel(page)).length === 0, [await isel(page), await sel(page)]);
  const b = await bar(page);
  check('la barra dice que son ítems, con las mismas acciones', !!b && b.label === 'Selected items' && b.n === '2 items' && J(b.btns) === J(['grip', 'copy', 'cut', 'dup', 'up', 'down', 'del', 'more']), b);
  const look = await page.evaluate(() => { const n = document.querySelector('.lmd-article li.lmd-bsel'); const s = getComputedStyle(n); return { bg: s.backgroundColor, outline: s.outlineStyle, list: getComputedStyle(n.parentNode).backgroundColor }; });
  check('se ve resaltado el ítem, no la lista entera', look.bg !== 'rgba(0, 0, 0, 0)' && look.outline === 'solid' && look.list === 'rgba(0, 0, 0, 0)', look);
  check('el Markdown no cambió y no queda cursor en un bloque', (await md(page)) === LIST && await page.evaluate(() => document.activeElement === document.body));
  await dotClick(page, 'four', 'Shift');
  check('Mayúsculas + clic extiende hasta ese ítem', J(await isel(page)) === J(['two', 'three', 'four']), await isel(page));
  await dotClick(page, 'three', 'Control');
  check('Ctrl + clic quita uno', J(await isel(page)) === J(['two', 'four']) && (await bar(page)).n === '2 items', await isel(page));
  await text(page, 'one').click({ modifiers: ['Control'] }); await sleep(120);
  check('y suma otro, también sobre su texto', J(await isel(page)) === J(['one', 'two', 'four']), await isel(page));
  await page.keyboard.press('Escape'); await sleep(100);
  check('Escape suelta', (await isel(page)).length === 0 && (await bar(page)) === null);
  await text(page, 'three').click({ modifiers: ['Control'] }); await sleep(120);
  check('sin nada marcado, Ctrl + clic sobre un ítem marca ese ítem', J(await isel(page)) === J(['three']) && (await bar(page)).n === '1 item', await isel(page));
  await page.keyboard.press('Escape');
  // Con el cursor en un ítem, Mayúsculas + clic en otro de la lista marca el rango de ítems.
  await text(page, 'one').click(); await text(page, 'three').click({ modifiers: ['Shift'] }); await sleep(150);
  check('Mayúsculas + clic desde el ítem del cursor a otro marca ese rango', J(await isel(page)) === J(['one', 'two', 'three']), await isel(page));
  await page.keyboard.press('Escape');
  // Un subítem y su nivel.
  await dotDrag(page, 'sub a', 'sub b');
  check('los subítems se marcan entre sí', J(await isel(page)) === J(['sub a', 'sub b']), await isel(page));
  await dotClick(page, 'four', 'Shift');
  check('extender desde un subítem a uno de más afuera sube al nivel que comparten', J(await isel(page)) === J(['two', 'three', 'four']), await isel(page));
  await page.keyboard.press('Escape');
  // El margen del documento sigue marcando el bloque (la lista entera).
  await marginClick(page, 'one');
  check('el margen del documento marca la lista entera como bloque', (await sel(page)).length === 1 && (await isel(page)).length === 0 && (await bar(page)).n === '1 block', [await sel(page), await bar(page)]);
  await text(page, 'two').click({ modifiers: ['Control'] }); await sleep(120);
  check('con bloques marcados, Ctrl + clic en un ítem cuenta la lista entera', (await sel(page)).length === 0 && (await isel(page)).length === 0, [await sel(page), await isel(page)]);
  // Un clic sobre el texto sigue siendo para escribir.
  await dotClick(page, 'two'); await text(page, 'three').click(); await sleep(150);
  check('un clic en el texto de un ítem suelta lo marcado y deja el cursor ahí', (await isel(page)).length === 0 && await page.evaluate(() => document.activeElement.textContent === 'three'));
  await ctx.close();
});

await step('Mezcla: de ítems a bloques enteros al salir de la lista', async () => {
  const { ctx, page } = await open();
  await note(page, 'b.md', LIST, true);
  await dotClick(page, 'three');
  await page.locator('.lmd-article p', { hasText: 'Outro.' }).click({ modifiers: ['Shift'] }); await sleep(200);
  check('Mayúsculas + clic fuera de la lista pasa a bloques enteros, con la lista completa', (await isel(page)).length === 0 && (await sel(page)).length === 2 && (await bar(page)).n === '2 blocks' && (await bar(page)).label === 'Selected blocks', [await sel(page), await bar(page)]);
  check('y se avisa', /The selection is now whole blocks/.test(await flash(page)), await flash(page));
  await page.keyboard.press('Escape');
  await dotClick(page, 'two');
  await page.locator('.lmd-article p', { hasText: 'Intro.' }).click({ modifiers: ['Control'] }); await sleep(200);
  check('Ctrl + clic fuera de la lista también: la lista y ese bloque', (await sel(page)).length === 2 && (await sel(page))[0] === 'Intro.' && (await bar(page)).n === '2 blocks' && /whole blocks/.test(await flash(page)), await sel(page));
  check('nunca quedan ítems y bloques marcados a la vez', (await isel(page)).length === 0);
  await page.keyboard.press('Escape');
  // Arrastrando desde una viñeta hasta fuera de la lista.
  const o = await box(page, 'Outro.');
  await dotDrag(page, 'three', { y: o.mid });
  check('arrastrar desde una viñeta hasta otro bloque marca bloques enteros', (await isel(page)).length === 0 && (await sel(page)).length === 2 && (await bar(page)).n === '2 blocks', [await sel(page), await isel(page)]);
  await page.keyboard.press('Escape');
  // Con el teclado: Escape marca el ítem, Mayúsculas + flechas extiende entre hermanos y, en el borde, sale.
  await text(page, 'three').click(); await page.keyboard.press('Escape'); await sleep(250);
  check('Escape sobre un ítem lo deja marcado', J(await isel(page)) === J(['three']) && (await sel(page)).length === 0, [await isel(page), await sel(page)]);
  await page.keyboard.press('Shift+ArrowUp'); await sleep(100);
  check('Mayúsculas + ↑ extiende al hermano de arriba, con sus subítems', J(await isel(page)) === J(['two', 'three']), await isel(page));
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await sleep(100);
  check('Mayúsculas + ↓ achica y pasa para el otro lado', J(await isel(page)) === J(['three', 'four']), await isel(page));
  await page.keyboard.press('Shift+ArrowDown'); await sleep(150);
  check('en el borde de la lista, extender pasa a bloques enteros', (await isel(page)).length === 0 && (await sel(page)).length === 2 && /whole blocks/.test(await flash(page)), [await sel(page), await flash(page)]);
  await page.keyboard.press('Escape');
  await text(page, 'sub b').click(); await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Shift+ArrowDown'); await sleep(100);
  check('en el borde de una sublista, extender sube al ítem que la contiene', J(await isel(page)) === J(['two']), await isel(page));
  await page.keyboard.press('ArrowDown'); await sleep(100);
  check('↓ sola pasa al ítem siguiente', J(await isel(page)) === J(['sub a']), await isel(page));
  await page.keyboard.press('Enter'); await sleep(150);
  check('Enter entra a escribir en el ítem', (await isel(page)).length === 0 && await page.evaluate(() => document.activeElement.isContentEditable && document.activeElement.textContent === 'sub a'));
  check('nada de esto cambió el Markdown', (await md(page)) === LIST);
  await ctx.close();
});

await step('Acciones sobre ítems: cada una es un paso de deshacer y renumera', async () => {
  const { ctx, page } = await open();
  await note(page, 'c.md', LIST, true);
  const back = async (name) => { await page.keyboard.press('Escape'); await undo(page); check(name + ': un solo deshacer', (await md(page)) === LIST, await md(page)); };
  // Copiar: una lista suelta con esos ítems, contando desde 1, con sus subítems.
  await dotDrag(page, 'two', 'three');
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  let c = await clip(page);
  check('copiar lleva los ítems como una lista, con sus subítems', c.text === '1. two\n   - sub a\n   - sub b\n2. three' && /Items copied: 2/.test(await flash(page)), [c.text, await flash(page)]);
  check('y el HTML es una lista con formato, sin nada de la interfaz', /<ol[^>]*>\s*<li/.test(c.html) && /sub a/.test(c.html) && !/lmd-(editable|bsel|li-text)|contenteditable|<button/.test(c.html), c.html.slice(0, 400));
  // Cortar.
  await wipe(page); await page.keyboard.press('Control+x'); await sleep(350);
  check('cortar saca los ítems y renumera lo que queda', (await md(page)) === swap(ALL, '1. one\n2. four') && (await clip(page)).text === '1. two\n   - sub a\n   - sub b\n2. three' && /Items cut: 2/.test(await flash(page)), [await md(page), await flash(page)]);
  await back('cortar');
  // Eliminar, con el aviso y su botón.
  await dotClick(page, 'one'); await dotClick(page, 'three', 'Control');
  await page.keyboard.press('Delete'); await sleep(350);
  check('Supr elimina los ítems marcados, también salteados; la lista sigue desde 1', (await md(page)) === swap(ALL, '1. two\n   - sub a\n   - sub b\n2. four'), await md(page));
  check('se avisa con un botón para deshacer', (await toast(page)) === 'Items deleted: 2 | Undo', await toast(page));
  await page.click('.lmd-cl-toast button'); await sleep(300);
  check('que devuelve todo de una vez', (await md(page)) === LIST, await md(page));
  // Duplicar.
  await dotDrag(page, 'two', 'three'); await page.keyboard.press('Control+d'); await sleep(350);
  check('Ctrl+D pone la copia debajo y renumera', (await md(page)) === swap(ALL, '1. one\n2. two\n   - sub a\n   - sub b\n3. three\n4. two\n   - sub a\n   - sub b\n5. three\n6. four'), await md(page));
  check('y quedan marcadas las copias', J(await isel(page)) === J(['two', 'three']) && await page.evaluate(() => { const all = [...document.querySelectorAll('.lmd-article > ol > li')]; return all[3].classList.contains('lmd-bsel') && !all[1].classList.contains('lmd-bsel'); }), await isel(page));
  await back('duplicar');
  // Mover con el teclado.
  await dotDrag(page, 'two', 'three'); await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  check('Alt+↓ baja el grupo un lugar entre sus hermanos y renumera', (await md(page)) === swap(ALL, '1. one\n2. four\n3. two\n   - sub a\n   - sub b\n4. three') && J(await isel(page)) === J(['two', 'three']), [await md(page), await isel(page)]);
  await page.keyboard.press('Alt+ArrowDown'); await sleep(250);
  check('en el borde no pasa nada', (await md(page)) === swap(ALL, '1. one\n2. four\n3. two\n   - sub a\n   - sub b\n4. three'));
  await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  check('Alt+↑ lo sube', (await md(page)) === LIST && J(await isel(page)) === J(['two', 'three']), await md(page));
  await page.keyboard.press('Escape'); await undo(page); await undo(page);
  check('mover: cada movimiento fue un paso de deshacer', (await md(page)) === LIST, await md(page));
  // Mover arrastrando, con el indicador de destino.
  await dotClick(page, 'four');
  const a = await dot(page, 'four'); const one = await dot(page, 'one');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, a.y - 8, { steps: 2 }); await page.mouse.move(a.x, one.y - 14, { steps: 8 }); await sleep(120);
  const seen = await page.evaluate(() => { const l = document.querySelector('.lmd-bsel-drop'); return !!l && !l.hidden && document.documentElement.classList.contains('lmd-bsel-moving'); });
  await page.mouse.up(); await sleep(350);
  check('arrastrar un ítem marcado desde su viñeta muestra dónde cae', seen);
  check('y lo deja ahí, renumerado', (await md(page)) === swap(ALL, '1. four\n2. one\n3. two\n   - sub a\n   - sub b\n4. three') && J(await isel(page)) === J(['four']), [await md(page), await isel(page)]);
  await back('arrastrar');
  // Los botones de la barra.
  await dotClick(page, 'one'); await page.click('.lmd-bsel-bar [data-bs=down]'); await sleep(350);
  check('los botones de la barra mueven igual', (await md(page)) === swap(ALL, '1. two\n   - sub a\n   - sub b\n2. one\n3. three\n4. four'), await md(page));
  await back('bajar desde la barra');
  // Sangrar y sacar un nivel.
  await dotDrag(page, 'three', 'four'); await page.keyboard.press('Tab'); await sleep(350);
  check('Tab sangra el grupo: pasan a ser subítems del de arriba', (await md(page)) === swap(ALL, '1. one\n2. two\n   - sub a\n   - sub b\n   - three\n   - four') && J(await isel(page)) === J(['three', 'four']), [await md(page), await isel(page)]);
  await page.keyboard.press('Shift+Tab'); await sleep(350);
  check('Mayúsculas + Tab los saca un nivel y renumera', (await md(page)) === LIST && J(await isel(page)) === J(['three', 'four']), [await md(page), await isel(page)]);
  await page.keyboard.press('Shift+Tab'); await sleep(250);
  check('en el primer nivel, sacar un nivel no hace nada', (await md(page)) === LIST);
  await page.keyboard.press('Escape'); await undo(page);
  check('sangrar: un paso de deshacer por tecla', (await md(page)) === swap(ALL, '1. one\n2. two\n   - sub a\n   - sub b\n   - three\n   - four'), await md(page));
  await undo(page);
  await dotClick(page, 'sub b'); await more(page, 'outdent');
  check('desde el menú: sacar un nivel un subítem', (await md(page)) === swap(ALL, '1. one\n2. two\n   - sub a\n3. sub b\n4. three\n5. four'), await md(page));
  await back('sacar un nivel');
  // Convertir.
  await dotDrag(page, 'one', 'four'); await more(page);
  const ids = await menuIds(page);
  check('el menú de ítems ofrece sangrar, convertir y pasar a una nota nueva', ['indent', 'outdent', 'to-ul', 'to-ol', 'to-task', 'doc-copy', 'doc-move'].every((i) => ids.includes(i)) && !ids.includes('wrap') && !ids.includes('to-quote') && !ids.includes('check'), ids);
  await page.click('.lmd-bsel-menu [data-bs=to-task]'); await sleep(350);
  check('convertir toda la lista numerada en tareas', (await md(page)) === swap(ALL, '- [ ] one\n- [ ] two\n  - sub a\n  - sub b\n- [ ] three\n- [ ] four') && (await isel(page)).length === 4, [await md(page), await isel(page)]);
  await more(page);
  check('con tareas marcadas se ofrece tildarlas', await page.evaluate(() => document.querySelector('.lmd-bsel-menu [data-bs=check]').textContent === 'Check the tasks'));
  await page.click('.lmd-bsel-menu [data-bs=check]'); await sleep(350);
  check('tildar todas las tareas marcadas', (await md(page)) === swap(ALL, '- [x] one\n- [x] two\n  - sub a\n  - sub b\n- [x] three\n- [x] four') && (await isel(page)).length === 4, await md(page));
  await more(page);
  check('y después, destildarlas', await page.evaluate(() => document.querySelector('.lmd-bsel-menu [data-bs=check]').textContent === 'Uncheck the tasks'));
  await page.click('.lmd-bsel-menu [data-bs=check]'); await sleep(350);
  check('destildar todas', (await md(page)) === swap(ALL, '- [ ] one\n- [ ] two\n  - sub a\n  - sub b\n- [ ] three\n- [ ] four'), await md(page));
  await more(page, 'to-ol');
  check('de tareas a numerada: sin casillas y contando desde 1', (await md(page)) === LIST, await md(page));
  await more(page, 'to-ul');
  check('y a viñetas', (await md(page)) === swap(ALL, '- one\n- two\n  - sub a\n  - sub b\n- three\n- four'), await md(page));
  await page.keyboard.press('Escape'); await undo(page); await undo(page); await undo(page); await undo(page); await undo(page);
  check('convertir y tildar: un paso de deshacer cada uno', (await md(page)) === LIST, await md(page));
  // Solo algunos ítems: el resto queda como estaba.
  await dotDrag(page, 'two', 'three'); await more(page, 'to-ul');
  check('convertir solo algunos deja el resto como estaba', (await md(page)) === swap(ALL, '1. one\n- two\n  - sub a\n  - sub b\n- three\n4. four'), await md(page));
  await back('convertir algunos');
  // Mayúsculas + F10 abre las acciones con el teclado.
  await dotClick(page, 'three'); await page.keyboard.press('Shift+F10'); await sleep(200);
  const m = await page.evaluate(() => { const x = document.querySelector('.lmd-bsel-menu'); return x ? { label: x.getAttribute('aria-label'), focus: document.activeElement.dataset.bs } : null; });
  check('Mayúsculas + F10 abre las acciones con el foco adentro', !!m && m.label === 'Selected items' && m.focus === 'copy', m);
  await page.keyboard.press('Escape'); await sleep(100);
  check('y Escape las cierra, con lo marcado en su lugar', await page.evaluate(() => !document.querySelector('.lmd-bsel-menu')) && J(await isel(page)) === J(['three']));
  await ctx.close();
});

await step('Ítems a una nota nueva', async () => {
  const { ctx, page } = await open();
  await note(page, 'd.md', LIST, true);
  await dotDrag(page, 'two', 'three'); await more(page, 'doc-copy');
  check('copiar a una nota nueva: recibe una lista con esos ítems', await until(async () => (await saved(page, 'two.md')) === '1. two\n   - sub a\n   - sub b\n2. three\n'), await saved(page, 'two.md'));
  check('el original queda igual', (await md(page)) === LIST && /New note: two\.md/.test(await flash(page)), await flash(page));
  await page.keyboard.press('Escape');
  await dotDrag(page, 'two', 'three'); await more(page, 'doc-move');
  await until(async () => !!(await saved(page, 'two-2.md')));
  check('mover crea la nota sin pisar la otra', (await saved(page, 'two-2.md')) === '1. two\n   - sub a\n   - sub b\n2. three\n', await saved(page, 'two-2.md'));
  check('y deja en la lista un ítem con el enlace, renumerada', (await md(page)) === swap(ALL, '1. one\n2. [two](two-2.md)\n3. four'), await md(page));
  await page.keyboard.press('Escape'); await undo(page);
  check('un solo deshacer devuelve los ítems', (await md(page)) === LIST, await md(page));
  await ctx.close();
});

await step('Pegar ítems: dentro de una lista son ítems; fuera, una lista', async () => {
  const { ctx, page } = await open();
  const P = ['# Doc', '', '- alpha', '- beta', '', 'Middle.', '', '1. one', '2. two', '', 'End.', ''].join('\n');
  await note(page, 'e.md', P, true);
  await dotDrag(page, 'alpha', 'beta'); await page.keyboard.press('Control+c'); await sleep(200); await page.keyboard.press('Escape');
  await dotClick(page, 'one'); await page.keyboard.press('Control+v'); await sleep(400);
  check('pegar con un ítem marcado los inserta como ítems, con la marca de esa lista', (await md(page)) === P.replace('1. one\n2. two', '1. one\n2. alpha\n3. beta\n4. two'), await md(page));
  check('y quedan marcados los pegados', J(await isel(page)) === J(['alpha', 'beta']), await isel(page));
  await page.keyboard.press('Escape'); await undo(page);
  check('un solo deshacer', (await md(page)) === P);
  await marginClick(page, 'Middle.'); await page.keyboard.press('Control+v'); await sleep(400);
  check('pegar con un bloque marcado crea una lista debajo', (await md(page)) === P.replace('Middle.\n', 'Middle.\n\n- alpha\n- beta\n'), await md(page));
  await page.keyboard.press('Escape'); await undo(page);
  // Debajo de una lista del mismo tipo: una lista aparte, no más ítems de esa.
  await marginClick(page, 'alpha'); await page.keyboard.press('Control+v'); await sleep(400);
  check('con una lista marcada como bloque, lo pegado es otra lista (cambia de marca para no juntarse)', (await md(page)) === P.replace('- alpha\n- beta\n', '- alpha\n- beta\n\n* alpha\n* beta\n') && J(await lists(page)) === J(['ul:2', 'ul:2', 'ol:2']), [await md(page), await lists(page)]);
  await page.keyboard.press('Escape'); await undo(page);
  // Bloques copiados (no una lista) con un ítem marcado: van debajo de la lista, como bloques.
  await marginClick(page, 'Middle.'); await page.keyboard.press('Control+c'); await sleep(200); await page.keyboard.press('Escape');
  await dotClick(page, 'alpha'); await page.keyboard.press('Control+v'); await sleep(400);
  check('un párrafo copiado, con un ítem marcado, va debajo de la lista como bloque', (await md(page)) === P.replace('- alpha\n- beta\n', '- alpha\n- beta\n\nMiddle.\n'), await md(page));
  await ctx.close();
});

await step('Tareas, sublistas, una sección desplegable y una cita', async () => {
  const { ctx, page } = await open();
  const T = ['# Doc', '', '- [ ] buy milk', '- [x] call home', '  - [ ] ask dad', '- plain one', '', '::: details More', 'Before.', '', '1. first', '2. second', '3. third', '', 'After.', ':::', '', '> Quote says:', '>', '> - red', '> - green', '> - blue', '', 'End.', ''].join('\n');
  await note(page, 'f.md', T, true);
  await page.evaluate(() => { document.querySelector('.lmd-article details.lmd-box').open = true; }); await sleep(150);
  // Tareas (la lista mezcla tareas con un ítem común, y tiene una subtarea).
  await text(page, 'call home').click({ modifiers: ['Control'] }); await sleep(120);
  check('en una lista de tareas, Ctrl + clic marca la tarea', J(await isel(page)) === J(['call home']), await isel(page));
  await more(page);
  check('se ofrece tildar: una de las dos tareas marcadas (con la subtarea) está sin hacer', await page.evaluate(() => document.querySelector('.lmd-bsel-menu [data-bs=check]').textContent === 'Check the tasks'));
  await page.click('.lmd-bsel-menu [data-bs=check]'); await sleep(350);
  check('tildar incluye las subtareas del ítem marcado', (await md(page)) === T.replace('  - [ ] ask dad', '  - [x] ask dad'), await md(page));
  await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  check('mover una tarea lleva su subtarea', (await md(page)).includes('- [x] call home\n  - [x] ask dad\n- [ ] buy milk\n- plain one'), await md(page));
  await page.keyboard.press('Escape'); await undo(page); await undo(page);
  check('y se deshace', (await md(page)) === T, await md(page));
  await text(page, 'ask dad').click(); await page.keyboard.press('Escape'); await sleep(250);
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  check('una subtarea se copia desde la columna 0', (await clip(page)).text === '- [ ] ask dad', (await clip(page)).text);
  await page.keyboard.press('Shift+Tab'); await sleep(350);
  check('y Mayúsculas + Tab la saca un nivel', (await md(page)).includes('- [x] call home\n- [ ] ask dad\n- plain one'), await md(page));
  await page.keyboard.press('Escape'); await undo(page);
  // Dentro de una sección desplegable.
  await dotDrag(page, 'second', 'third');
  check('dentro de una sección desplegable se marcan ítems', J(await isel(page)) === J(['second', 'third']), await isel(page));
  await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  let t = await md(page);
  check('y se mueven sin salir de la sección, renumerados', t.includes('Before.\n\n1. second\n2. third\n3. first\n\nAfter.\n:::'), t);
  check('la sección sigue abierta y los ítems marcados', await page.evaluate(() => document.querySelector('.lmd-article details.lmd-box').open) && J(await isel(page)) === J(['second', 'third']), await isel(page));
  await page.keyboard.press('Delete'); await sleep(350);
  t = await md(page);
  check('eliminar deja los ::: en su lugar', t.includes('::: details More\nBefore.\n\n1. first\n\nAfter.\n:::\n'), t);
  await undo(page); await undo(page);
  check('y vuelve con deshacer', (await md(page)) === T, await md(page));
  await page.evaluate(() => { document.querySelector('.lmd-article details.lmd-box').open = true; }); await sleep(150);
  await text(page, 'third').click(); await page.keyboard.press('Escape'); await sleep(250); await page.keyboard.press('Shift+ArrowDown'); await sleep(150);
  check('al extender fuera de una lista que está en una sección, el bloque entero es la sección', (await sel(page)).length === 2 && (await isel(page)).length === 0 && await page.evaluate(() => document.querySelector('.lmd-article > details').classList.contains('lmd-bsel')), await sel(page));
  await page.keyboard.press('Escape');
  // Dentro de una cita.
  await dotDrag(page, 'red', 'green');
  check('dentro de una cita se marcan ítems', J(await isel(page)) === J(['red', 'green']), await isel(page));
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  check('se copian sin el > de la cita', (await clip(page)).text === '- red\n- green', (await clip(page)).text);
  await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  check('se mueven dentro de la cita, con su >', (await md(page)).includes('> Quote says:\n>\n> - blue\n> - red\n> - green\n'), await md(page));
  await more(page, 'to-ol');
  check('y se convierten dentro de la cita', (await md(page)).includes('> - blue\n> 1. red\n> 2. green\n'), await md(page));
  await page.keyboard.press('Escape'); await undo(page); await undo(page);
  await dotClick(page, 'blue'); await page.keyboard.press('Control+v'); await sleep(400);
  check('pegar ítems dentro de una cita los deja con su >', (await md(page)).includes('> - red\n> - green\n> - blue\n> - red\n> - green\n'), await md(page));
  await ctx.close();
});

await step('Leyendo: se marcan y se copian ítems, nada más', async () => {
  const { ctx, page } = await open();
  await note(page, 'g.md', LIST, false);
  await dotDrag(page, 'two', 'three');
  const b = await bar(page);
  check('leyendo se pueden marcar ítems', J(await isel(page)) === J(['two', 'three']) && !!b && b.n === '2 items', [await isel(page), b]);
  check('la barra ofrece copiar, y copiar a una nota nueva', !!b && J(b.btns) === J(['copy', 'more']) && await (async () => { await more(page); const ids = await menuIds(page); await page.keyboard.press('Escape'); return J(ids) === J(['doc-copy']); })(), b);
  await wipe(page); await page.keyboard.press('Control+c'); await sleep(250);
  check('copia', (await clip(page)).text === '1. two\n   - sub a\n   - sub b\n2. three', (await clip(page)).text);
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); await page.keyboard.press('Control+x'); await page.keyboard.press('Control+d'); await page.keyboard.press('Alt+ArrowDown'); await page.keyboard.press('Tab'); await page.keyboard.press('Control+v'); await sleep(300);
  check('ni eliminar, cortar, duplicar, mover, sangrar ni pegar cambian nada', (await md(page)) === LIST && (await saved(page, 'g.md')) === LIST, await md(page));
  const a = await dot(page, 'two'); const o = await dot(page, 'four');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, a.y + 8, { steps: 2 }); await page.mouse.move(a.x, o.y + 20, { steps: 8 }); await page.mouse.up(); await sleep(300);
  check('arrastrar tampoco mueve', (await md(page)) === LIST);
  await ctx.close();
});

await step('Listas vecinas: siguen siendo dos', async () => {
  const { ctx, page } = await open();
  const N = ['# Doc', '', '- a one', '- a two', '', 'Between.', '', '- b one', '- b two', '', 'Tail.', ''].join('\n');
  await note(page, 'h.md', N, true);
  check('de entrada hay dos listas', J(await lists(page)) === J(['ul:2', 'ul:2']), await lists(page));
  // Mover el bloque que las separaba (con bloques marcados).
  await marginClick(page, 'Between.'); await page.keyboard.press('Alt+ArrowDown'); await sleep(350);
  let t = await md(page);
  check('mover el párrafo que las separaba no las junta: la segunda cambia de marca', t === ['# Doc', '', '- a one', '- a two', '', '* b one', '* b two', '', 'Between.', '', 'Tail.', ''].join('\n') && J(await lists(page)) === J(['ul:2', 'ul:2']), [t, await lists(page)]);
  check('sin comentarios ni líneas de más', !/<!--/.test(t) && t.split('\n').length === N.split('\n').length);
  await page.keyboard.press('Escape'); await undo(page);
  check('un solo deshacer', (await md(page)) === N);
  // Lo mismo con el menú de un solo bloque (write.js), que ya tenía el problema.
  await page.locator('.lmd-article p', { hasText: 'Between.' }).click({ button: 'right' }); await page.click('.lmd-menu [data-op=down]'); await sleep(350);
  check('mover un solo bloque desde su menú tampoco las junta', J(await lists(page)) === J(['ul:2', 'ul:2']) && /\* b one\n\* b two\n\nBetween\./.test(await md(page)), [await md(page), await lists(page)]);
  await blur(page); await undo(page);
  check('y es un solo paso de deshacer', (await md(page)) === N, await md(page));
  await page.locator('.lmd-article p', { hasText: 'Between.' }).click({ button: 'right' }); await page.click('.lmd-menu [data-op=del]'); await sleep(350);
  check('eliminar el bloque que las separaba tampoco', J(await lists(page)) === J(['ul:2', 'ul:2']) && /- a two\n\n\* b one/.test(await md(page)), [await md(page), await lists(page)]);
  await blur(page); await undo(page);
  await marginClick(page, 'Between.'); await page.keyboard.press('Delete'); await sleep(350);
  check('ni eliminarlo con Supr', J(await lists(page)) === J(['ul:2', 'ul:2']), [await md(page), await lists(page)]);
  await undo(page);
  // Duplicar una lista: la copia es otra lista.
  await marginClick(page, 'a one'); await page.keyboard.press('Control+d'); await sleep(350);
  t = await md(page);
  check('duplicar una lista deja dos listas, no una con el doble de ítems', J(await lists(page)) === J(['ul:2', 'ul:2', 'ul:2']) && /- a one\n- a two\n\n\* a one\n\* a two\n\nBetween\./.test(t), [t, await lists(page)]);
  await page.keyboard.press('Escape'); await undo(page);
  await page.locator('.lmd-article li', { hasText: 'a one' }).first().click({ button: 'right', position: { x: 60, y: 8 } }); await page.click('.lmd-menu [data-op=dup]'); await sleep(350);
  check('y desde el menú de un solo bloque también', J(await lists(page)) === J(['ul:2', 'ul:2', 'ul:2']), [await md(page), await lists(page)]);
  await blur(page); await undo(page);
  // Una lista movida entre otras dos: usa la marca que no tiene ninguna de las de al lado.
  const M = ['- a one', '', 'Gap.', '', '* b one', '', 'Other.', '', '- c one', ''].join('\n');
  await note(page, 'h2.md', M, true);
  await marginClick(page, 'c one'); await page.keyboard.press('Alt+ArrowUp'); await sleep(350); await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  check('al lado de una lista con otra marca no hace falta cambiar nada', (await md(page)) === ['- a one', '', 'Gap.', '', '- c one', '', '* b one', '', 'Other.', ''].join('\n'), await md(page));
  await page.keyboard.press('Alt+ArrowUp'); await sleep(350);
  t = await md(page);
  check('una lista que queda entre dos toma una marca distinta a las dos', t === ['- a one', '', '* c one', '', 'Gap.', '', '* b one', '', 'Other.', ''].join('\n'), [t, await lists(page)]);
  check('y siguen siendo tres listas', J(await lists(page)) === J(['ul:1', 'ul:1', 'ul:1']), await lists(page));
  // Numeradas: cambia el punto por el paréntesis.
  const O = ['1. uno', '2. dos', '', 'Medio.', '', '1. tres', '2. cuatro', ''].join('\n');
  await note(page, 'h3.md', O, true);
  await marginClick(page, 'Medio.'); await page.keyboard.press('Delete'); await sleep(350);
  t = await md(page);
  check('dos listas numeradas que quedan pegadas: una pasa a "1)" y cada una sigue contando desde 1', t === '1. uno\n2. dos\n\n1) tres\n2) cuatro\n' && J(await lists(page)) === J(['ol:2', 'ol:2']), [t, await lists(page)]);
  // Convertir un párrafo al lado de una lista sí lo suma a ella: eso es a propósito.
  await ctx.close();
});

await step('Lo marcado sobrevive a un redibujado completo por un cambio ajeno', async () => {
  const { ctx, page } = await open();
  const S = ['# Doc', '', 'Alpha one.', '', 'Beta two.', '', 'Gamma three.', '', '- item a', '- item b', '- item c', '', 'Omega end.', ''].join('\n');
  await note(page, 'i.md', S, true);
  const outside = async (next) => { await page.evaluate(([n, t]) => LMD.store.notePut(n, t), ['i.md', next]); return until(async () => (await md(page)) === next, 6000); };
  await marginClick(page, 'Beta two.'); await marginClick(page, 'Gamma three.', 'Control');
  check('dos bloques marcados', J(await sel(page)) === J(['Beta two.', 'Gamma three.']));
  // Otra pestaña cambia la nota: entra un párrafo arriba y cambia otro. La nota se redibuja entera.
  const S2 = S.replace('Alpha one.', 'New on top.\n\nAlpha changed.');
  check('el cambio de afuera entra', await outside(S2));
  await sleep(200);
  check('lo marcado sigue marcado, aunque cambió de línea', J(await sel(page)) === J(['Beta two.', 'Gamma three.']) && (await bar(page)).n === '2 blocks', [await sel(page), await bar(page)]);
  const S3 = S2.replace('Gamma three.\n\n', '');
  check('otro cambio saca uno de los marcados', await outside(S3));
  await sleep(200);
  check('queda marcado el que sigue existiendo', J(await sel(page)) === J(['Beta two.']) && (await bar(page)).n === '1 block', [await sel(page), await bar(page)]);
  const S4 = S3.replace('Beta two.\n\n', '');
  check('y otro saca el último', await outside(S4));
  await sleep(200);
  check('recién ahí se suelta', (await sel(page)).length === 0 && (await bar(page)) === null, await sel(page));
  // Con ítems.
  await dotDrag(page, 'item b', 'item c');
  const S5 = S4.replace('- item a', '- item zero\n- item a');
  check('con ítems marcados, entra un ítem nuevo arriba', await outside(S5));
  await sleep(200);
  check('los ítems siguen marcados', J(await isel(page)) === J(['item b', 'item c']) && (await bar(page)).n === '2 items', [await isel(page), await bar(page)]);
  check('si desaparecen, se sueltan', await outside(S5.replace('- item b\n- item c\n', '')) && (await sleep(200), (await isel(page)).length === 0 && (await bar(page)) === null));
  await ctx.close();
});

await step('Arrastrar en una nota de 3.000 bloques', async () => {
  const { ctx, page } = await open();
  const BIG = '# Long\n\n' + Array.from({ length: 3000 }, (_, i) => 'Paragraph number ' + (i + 1) + '.').join('\n\n') + '\n';
  await note(page, 'j.md', BIG, false);
  check('la nota tiene 3.000 párrafos', await page.evaluate(() => document.querySelectorAll('.lmd-article > p').length === 3000));
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  const p = await box(page, 'Paragraph number 2.');
  await page.mouse.move(p.margin, p.mid); await page.mouse.down(); await page.mouse.move(p.margin, p.mid + 10, { steps: 2 }); await page.mouse.move(p.margin, 400, { steps: 3 }); await sleep(100);
  // Con el arrastre en curso: el rango llega al final de la nota, y de ahí cada movimiento lo cambia.
  const cost = await page.evaluate(async (x) => {
    window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const move = (y) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    move(500);
    const times = []; const n0 = document.querySelectorAll('.lmd-article > .lmd-bsel').length;
    for (let i = 0; i < 40; i++) { const t = performance.now(); move(200 + (i % 8) * 60); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    return { n0, median: times[20], worst: times[39], total: times.reduce((a, b) => a + b, 0), n: document.querySelectorAll('.lmd-article > .lmd-bsel').length };
  }, p.margin);
  await page.mouse.up(); await sleep(200);
  console.log('     arrastre con ' + cost.n0 + ' bloques marcados: mediana ' + cost.median.toFixed(1) + ' ms, peor ' + cost.worst.toFixed(1) + ' ms por movimiento');
  check('el rango cubre casi toda la nota', cost.n0 > 2900 && cost.n > 2900, cost);
  // Sin guardar las posiciones, cada movimiento recorría los 3.000 bloques varias veces: 25 ms de mediana y 46 el
  // peor, medido con esta misma prueba. Guardándolas mientras dura el arrastre, 3,4 y 6,5. El tope queda en el
  // medio: deja margen para una máquina más lenta y falla si vuelve el recorrido completo.
  check('cada movimiento del arrastre cuesta poco (mediana bajo 12 ms)', cost.median < 12, cost);
  check('lo marcado queda bien al soltar', (await bar(page)).n === cost.n + ' blocks', await bar(page));
  await ctx.close();
});

await step('Pegar bloques entre pestañas, cuando el HTML pierde el Markdown', async () => {
  const { ctx, page } = await open();
  const C = ['# Doc', '', 'Alpha one.', '', '## Section', '', 'Gamma three.', '', 'Omega end.', ''].join('\n');
  await note(page, 'k.md', C, true);
  await page.evaluate(() => { document.addEventListener('copy', (e) => { window.__types = [...e.clipboardData.types]; window.__own = e.clipboardData.getData('application/x-sharpmd-blocks'); }); });
  await marginClick(page, 'Section'); await marginClick(page, 'Gamma three.', 'Shift');
  await page.keyboard.press('Control+c'); await sleep(250);
  const got = await page.evaluate(() => ({ types: window.__types, own: window.__own }));
  check('al copiar, el portapapeles lleva también un tipo propio con el Markdown crudo', got.types.includes('application/x-sharpmd-blocks') && got.own === '## Section\n\nGamma three.' && got.types.includes('text/html') && got.types.includes('text/plain'), got);
  const plain = '## Section\n\nGamma three.'; const bare = '<h2>Section</h2><p>Gamma three.</p>';
  const want = C.replace('Omega end.\n', 'Omega end.\n\n## Section\n\nGamma three.\n');
  // Otra pestaña del mismo navegador: se pega de verdad, con el portapapeles del sistema.
  const two = await ctx.newPage();
  await two.goto(noteUrl('k.md', true)); await two.waitForSelector('.lmd-editing .lmd-article .lmd-editable'); await sleep(400);
  await marginClick(two, 'Omega end.'); await two.keyboard.press('Control+v'); await sleep(500);
  check('en otra pestaña, pegar inserta los bloques', (await md(two)) === want, await md(two));
  await undo(two);
  // El HTML llegó sin el atributo, pero el tipo propio sí.
  await marginClick(two, 'Omega end.');
  await paste(two, { 'text/html': bare, 'text/plain': 'otra cosa', 'application/x-sharpmd-blocks': plain });
  check('sin el atributo en el HTML, el tipo propio alcanza', (await md(two)) === want, await md(two));
  await undo(two);
  // Ni atributo ni tipo propio: queda el texto, que es Markdown, y la huella de lo último copiado en la app.
  await marginClick(two, 'Omega end.');
  await paste(two, { 'text/html': bare, 'text/plain': plain });
  check('sin atributo ni tipo propio, el texto copiado en la app se reconoce y entra como bloques', (await md(two)) === want, await md(two));
  await undo(two);
  await marginClick(two, 'Omega end.');
  await paste(two, { 'text/plain': plain.replace(/\n/g, '\r\n') });
  check('también si llega solo el texto, con saltos de línea de Windows', (await md(two)) === want, await md(two));
  await undo(two);
  // Un texto de otra aplicación no pasa por bloques.
  await marginClick(two, 'Omega end.');
  await paste(two, { 'text/html': '<p>Some words</p>', 'text/plain': 'Some words from elsewhere' });
  check('un texto de otra aplicación no se inserta como bloques', (await md(two)) === C, await md(two));
  await paste(two, { 'text/plain': '## Section\n\nGamma three. But edited elsewhere' });
  check('ni uno parecido a lo copiado', (await md(two)) === C, await md(two));
  await two.keyboard.press('Escape');
  // Y escribiendo, pegar sigue siendo pegar texto en el bloque.
  await two.evaluate(() => navigator.clipboard.writeText('just some words'));
  await text(two, 'Alpha one').click(); await two.keyboard.press('Control+End'); await two.keyboard.press('Control+v'); await sleep(300); await blur(two); await sleep(200);
  check('con el cursor en un bloque, pegar texto común sigue igual', /Alpha one\.just some words/.test(await md(two)), await md(two));
  await ctx.close();
});

await step('Escape y borrar', async () => {
  const { ctx, page } = await open();
  const E = ['# Doc', '', 'Alpha one.', '', 'Beta two.', '', '- item a', '- item b', '', 'Omega end.', ''].join('\n');
  await note(page, 'l.md', E, true);
  await text(page, 'Beta two').click(); await page.keyboard.press('End'); await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape'); await sleep(250);
  check('Escape deja marcado el bloque', J(await sel(page)) === J(['Beta two.']), await sel(page));
  await page.keyboard.press('Backspace'); await sleep(250);
  check('Retroceso no lo elimina: se venía de escribir', (await md(page)) === E && J(await sel(page)) === J(['Beta two.']), await md(page));
  check('y dice con qué tecla sí', /To delete the selection: /.test(await flash(page)) && (await toast(page)) === '', await flash(page));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Backspace'); await sleep(250);
  check('pasar al bloque de al lado con la flecha no lo cambia', (await md(page)) === E && (await sel(page)).length === 1, [await md(page), await sel(page)]);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Delete'); await sleep(350);
  check('Supr sí lo elimina', (await md(page)) === E.replace('Beta two.\n\n', ''), await md(page));
  check('con el aviso y su botón de deshacer', (await toast(page)) === 'Block deleted | Undo', await toast(page));
  check('que es un botón de verdad, a la vista', await page.evaluate(() => { const b = document.querySelector('.lmd-cl-toast button'); const r = b.getBoundingClientRect(); return b.tagName === 'BUTTON' && r.width > 20 && r.bottom <= innerHeight && r.top >= 0; }));
  await sleep(2500);
  check('sigue a la vista unos segundos', (await toast(page)) === 'Block deleted | Undo');
  await page.click('.lmd-cl-toast button'); await sleep(300);
  check('y deshace', (await md(page)) === E && (await toast(page)) === '', await md(page));
  // Extender con Mayúsculas ya es armar la selección a propósito.
  await text(page, 'Alpha one').click(); await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Backspace'); await sleep(350);
  check('tras extender con Mayúsculas + flecha, Retroceso sí elimina', (await md(page)) === E.replace('Alpha one.\n\nBeta two.\n\n', '') && /Blocks deleted: 2/.test(await toast(page)), [await md(page), await toast(page)]);
  await undo(page);
  // Con ítems, igual.
  await text(page, 'item a').click(); await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Backspace'); await sleep(250);
  check('con un ítem marcado con Escape, Retroceso tampoco elimina', (await md(page)) === E && J(await isel(page)) === J(['item a']), [await md(page), await isel(page)]);
  await page.keyboard.press('Delete'); await sleep(350);
  check('y Supr sí', (await md(page)) === E.replace('- item a\n', '') && (await toast(page)) === 'Item deleted | Undo', [await md(page), await toast(page)]);
  await undo(page);
  await dotClick(page, 'item a'); await page.keyboard.press('Backspace'); await sleep(350);
  check('marcado con el mouse, Retroceso elimina', (await md(page)) === E.replace('- item a\n', ''), await md(page));
  await ctx.close();
});

check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 3));
check('sin errores de página', R.errors.length === 0, R.errors.slice(0, 3));
await R.close();
process.exit(done() ? 1 : 0);
