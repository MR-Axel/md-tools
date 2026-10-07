// Las herramientas de Ajustes > Herramientas que vienen apagadas: cada una se prende y se apaga, apagada no deja
// nada en la interfaz ni carga su archivo, y su recorrido de punta a punta. También en pantalla chica.
//   BROWSER=firefox node tools.mjs      BROWSER=webkit node tools.mjs      (sin BROWSER: chromium)
//   ONLY=present node tools.mjs         (una sola herramienta)
import { rig, tally, sleep } from './rig.mjs';
import zlib from 'zlib';

const ENGINE = process.env.BROWSER || 'chromium';
const ONLY = process.env.ONLY || '';
const R = await rig({}, ENGINE);
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };
const suite = async (id, fn) => { if (!ONLY || ONLY === id) await fn(); };

// Una ventana con el idioma de la app y qué herramientas arrancan prendidas (con sus opciones).
async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(o.who || null, o.ctx);
  await page.addInitScript(([base, lang, tools]) => { try { if (localStorage.getItem('tools:listo')) return; localStorage.setItem('tools:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}]);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: ENGINE !== 'firefox' };
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
const goHome = async (page) => { await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250); };
const put = (page, name, text) => page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
// Abre una nota del navegador con ese texto.
async function note(page, name, text, edit) {
  await goHome(page); await put(page, name, text);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
const stored = (page, key) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem('mdtools:' + k)); } catch (e) { return null; } }, key);
const scripts = (page, file) => page.evaluate((f) => [...document.scripts].filter((s) => s.src.split('/').pop() === f).length, file);
const flashText = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const toolsTab = async (page) => { await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); };
const closePanel = async (page) => { await page.click('[data-act=close-panel]'); await sleep(200); };
const flip = async (page, id) => { await page.click('.lmd-tl-card[data-tool=' + id + '] .lmd-switch'); await sleep(350); };
const menuItems = async (page, act) => { await page.click('.lmd-topbar [data-act=' + act + ']'); await page.waitForSelector('.lmd-menu [data-more]'); const ids = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-more]')].map((b) => b.dataset.more)); await page.keyboard.press('Escape'); await page.evaluate(() => document.body.click()); await sleep(120); return ids; };
const texts = (page) => page.evaluate(() => { const bad = []; document.querySelectorAll('.lmd-pres, .lmd-tl-card, .lmd-ask, .lmd-map, .lmd-menu, .lmd-daily-nav, .lmd-back').forEach((n) => { const t = n.textContent + ' ' + [...n.querySelectorAll('[title]')].map((x) => x.title).join(' '); if (/[!¡—–]/.test(t.replace(/\[!NOTE\]/g, ''))) bad.push(t.slice(0, 80)); }); return bad; });

// ---------- Modo presentación ----------
const DECK = ['# Charla de prueba', '', 'Una línea de entrada.', '', '## Uno', '', '- primero', '- segundo', '', '> [!NOTE]', '> Recordar saludar.', '', '## Dos', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '---', '', 'Texto suelto tras el corte.', '', '```js', 'const x = 1;', '```', '',
  '## Largo', '', ...Array.from({ length: 40 }, (_, k) => 'Renglón ' + (k + 1) + ' de una diapositiva que no entra sin achicarse.\n'), '### Un subtítulo no corta', '', 'Fin.'].join('\n');
const pres = (page) => page.evaluate(() => (window.LMD && LMD.present ? LMD.present.state() : null));
const inView = (page) => page.evaluate(() => { const r = document.querySelector('.lmd-pres-stage .lmd-pres-slide').getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 100; });

await suite('present', async () => {
  await step('Presentación: apagada no deja nada', async () => {
    const { ctx, page } = await open();
    await note(page, 'charla.md', DECK);
    check('apagada: sin botón, sin archivo cargado', await page.evaluate(() => !document.querySelector('.lmd-pres-btn') && !LMD.present) && await scripts(page, 'present.js') === 0);
    check('y el menú Exportar no la ofrece', !(await menuItems(page, 'export')).includes('present-pdf'));
    await page.keyboard.press('Alt+Shift+P'); await sleep(200);
    check('ni responde su atajo', await page.evaluate(() => !document.querySelector('.lmd-pres')));
    await toolsTab(page);
    const card = await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=present]'); return c ? { name: c.querySelector('b').textContent, on: c.querySelector('input').checked, icon: !!c.querySelector('.lmd-tl-ico svg') } : null; });
    check('su tarjeta está en Herramientas, apagada', J(card) === J({ name: 'Presentation mode', on: false, icon: true }), card);
    await flip(page, 'present'); await until(() => page.evaluate(() => !!LMD.present));
    check('prenderla pide su archivo y queda guardado', await scripts(page, 'present.js') === 1 && (await stored(page, 'settings')).tools.present === true);
    await page.click('.lmd-tl-card[data-tool=present] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=present] [data-pres=go]');
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await closePanel(page);
    check('prendida: el botón en la barra y la opción en Exportar', await page.evaluate(() => !!document.querySelector('.lmd-top-right .lmd-pres-btn')) && (await menuItems(page, 'export')).includes('present-pdf'));
    await toolsTab(page); await flip(page, 'present'); await closePanel(page);
    check('apagarla saca el botón y la opción', await page.evaluate(() => !document.querySelector('.lmd-pres-btn')) && !(await menuItems(page, 'export')).includes('present-pdf'));
    await page.keyboard.press('Alt+Shift+P'); await sleep(200);
    check('y su atajo deja de responder', await page.evaluate(() => !document.querySelector('.lmd-pres')));
    await ctx.close();
  });

  await step('Presentación: cortes, teclas y salida', async () => {
    const { ctx, page } = await open({ tools: { present: true } });
    await note(page, 'charla.md', DECK);
    await page.waitForSelector('.lmd-pres-btn');
    await page.click('.lmd-pres-btn'); await page.waitForSelector('.lmd-pres .lmd-pres-slide');
    let s = await pres(page);
    check('una diapositiva por título de nivel 1 o 2, y el separador corta', s.total === 5 && J(s.titles.slice(0, 3)) === J(['Charla de prueba', 'Uno', 'Dos']) && s.titles[3].startsWith('Texto suelto') && s.titles[4] === 'Largo', s);
    check('arranca en la primera, con su contenido', s.i === 0 && await page.evaluate(() => { const t = document.querySelector('.lmd-pres-stage').textContent; return t.includes('Charla de prueba') && t.includes('Una línea de entrada') && !t.includes('primero'); }));
    check('la diapositiva entra entera en la pantalla', await inView(page));
    check('el indicador dice por dónde va', await page.evaluate(() => document.querySelector('.lmd-pres-count').textContent === '1 / 5' && Math.round(parseFloat(document.querySelector('.lmd-pres-progress i').style.width)) === 20));
    await page.keyboard.press('ArrowRight'); s = await pres(page);
    check('flecha derecha avanza', s.i === 1 && await page.evaluate(() => document.querySelectorAll('.lmd-pres-stage li').length === 2));
    check('la nota del orador no se proyecta', await page.evaluate(() => !document.querySelector('.lmd-pres-stage').textContent.includes('Recordar saludar') && document.querySelector('.lmd-pres-notes').hidden));
    await page.keyboard.press('n');
    check('N muestra la nota del orador', await page.evaluate(() => { const n = document.querySelector('.lmd-pres-notes'); return !n.hidden && n.textContent.trim() === 'Recordar saludar.'; }));
    await page.keyboard.press('n');
    await page.keyboard.press('Space'); s = await pres(page);
    check('espacio avanza, y la tabla se ve como tabla', s.i === 2 && await page.evaluate(() => document.querySelectorAll('.lmd-pres-stage table td').length === 2));
    await page.keyboard.press('ArrowDown'); s = await pres(page);
    check('lo que sigue al separador es otra diapositiva, con su código', s.i === 3 && await page.evaluate(() => { const t = document.querySelector('.lmd-pres-stage'); return !!t.querySelector('pre code') && !t.querySelector('hr') && !t.querySelector('.lmd-code-copy'); }));
    await page.keyboard.press('End'); s = await pres(page);
    check('Fin va a la última, que se achica para entrar', s.i === 4 && await inView(page) && await page.evaluate(() => { const t = document.querySelector('.lmd-pres-stage').textContent; return t.includes('Renglón 40') && t.includes('Un subtítulo no corta') && t.includes('Fin.'); }), s);
    await page.keyboard.press('ArrowRight'); check('en la última no pasa de largo', (await pres(page)).i === 4);
    await page.keyboard.press('ArrowLeft'); check('flecha izquierda vuelve', (await pres(page)).i === 3);
    await page.keyboard.press('Home'); check('Inicio va a la primera', (await pres(page)).i === 0);
    await page.keyboard.press('o'); await page.waitForSelector('.lmd-pres-thumb');
    check('O abre la vista general, una miniatura por diapositiva', await page.evaluate(() => document.querySelectorAll('.lmd-pres-thumb').length === 5 && document.querySelector('.lmd-pres-thumb.lmd-on').dataset.slide === '0') && (await pres(page)).over);
    await page.click('.lmd-pres-thumb[data-slide="2"]'); s = await pres(page);
    check('tocar una miniatura va a esa diapositiva', s.i === 2 && !s.over);
    await page.keyboard.press('o'); await page.keyboard.press('Escape'); s = await pres(page);
    check('Escape en la vista general solo cierra la vista', s.open && !s.over);
    await page.keyboard.press('l'); await page.mouse.move(300, 300); await sleep(60);
    check('L prende el puntero, que sigue al cursor', await page.evaluate(() => { const d = document.querySelector('.lmd-pres-laser'); return !d.hidden && /translate\(300px, 300px\)/.test(d.style.transform); }) && (await pres(page)).laser);
    await page.keyboard.press('l');
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    // El PDF: una página apaisada por diapositiva.
    await page.evaluate(() => { window.__print = null; window.print = () => { window.__print = { pages: document.querySelectorAll('.lmd-pres-print .lmd-pres-page').length, cls: document.documentElement.classList.contains('lmd-pres-printing'), rule: (document.querySelector('style[data-lmd-pres]') || {}).textContent || '', fits: [...document.querySelectorAll('.lmd-pres-print .lmd-pres-slide')].every((n) => { const r = n.getBoundingClientRect(); const p = n.parentNode.getBoundingClientRect(); return r.height <= p.height + 1 && r.width <= p.width + 1; }), notes: document.querySelector('.lmd-pres-print').textContent.includes('Recordar saludar') }; }; });
    await page.keyboard.press('p'); await until(() => page.evaluate(() => !!window.__print));
    const pr = await page.evaluate(() => window.__print);
    check('P manda a imprimir una página por diapositiva, apaisada y sin las notas', pr && pr.pages === 5 && pr.cls && /size:\s*1280px 720px/.test(pr.rule) && pr.fits && !pr.notes, pr);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await sleep(100);
    check('al terminar de imprimir no queda nada de la copia', await page.evaluate(() => !document.querySelector('.lmd-pres-print') && !document.querySelector('style[data-lmd-pres]') && !document.documentElement.classList.contains('lmd-pres-printing')));
    await page.keyboard.press('Escape'); await sleep(150);
    check('Escape sale y la nota queda como estaba', await page.evaluate(() => !document.querySelector('.lmd-pres') && !document.documentElement.classList.contains('lmd-presenting') && document.querySelectorAll('.lmd-article h2').length === 3));
    await page.keyboard.press('Alt+Shift+P'); await page.waitForSelector('.lmd-pres');
    check('el atajo la abre', (await pres(page)).open);
    await page.keyboard.press('Alt+Shift+P'); await sleep(150);
    check('y la cierra', !(await pres(page)).open);
    // Desde Exportar, sin abrir la presentación.
    await page.evaluate(() => { window.__print = null; });
    await page.click('.lmd-topbar [data-act=export]'); await page.click('.lmd-menu [data-more=present-pdf]'); await until(() => page.evaluate(() => !!window.__print));
    check('Exportar > Diapositivas en PDF imprime sin abrir la presentación', await page.evaluate(() => window.__print.pages === 5 && !document.querySelector('.lmd-pres')));
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    // En edición, lo de editar no pasa a las diapositivas.
    await page.goto(noteUrl('charla.md', true)); await page.waitForSelector('.lmd-editing .lmd-article'); await sleep(350);
    await page.keyboard.press('Alt+Shift+P'); await page.waitForSelector('.lmd-pres .lmd-pres-slide');
    check('en edición, la diapositiva no trae nada editable', await page.evaluate(() => !document.querySelector('.lmd-pres [contenteditable], .lmd-pres .lmd-add, .lmd-pres [data-l]')) && (await pres(page)).total === 5);
    await page.keyboard.press('Escape');
    check('y la nota no cambió', (await saved(page, 'charla.md')) === DECK);
    await ctx.close();
  });

  await step('Presentación: pantalla chica', async () => {
    const { ctx, page } = await open({ tools: { present: true }, ctx: SMALL });
    await note(page, 'charla.md', DECK);
    await page.click('.lmd-topbar [data-act=more]'); await page.waitForSelector('.lmd-menu [data-more=present]');
    await page.click('.lmd-menu [data-more=present]'); await page.waitForSelector('.lmd-pres .lmd-pres-slide');
    check('se abre desde el menú "más" y la diapositiva entra', (await pres(page)).total === 5 && await inView(page));
    const swipe = (dx) => page.evaluate((d) => { const b = document.querySelector('.lmd-pres'); const ev = (t, x) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: 300, pointerType: 'touch', pointerId: 1 })); ev('pointerdown', 200); ev('pointerup', 200 + d); }, dx);
    await swipe(-120); check('deslizar a la izquierda avanza', (await pres(page)).i === 1);
    await swipe(120); check('deslizar a la derecha vuelve', (await pres(page)).i === 0);
    await page.click('.lmd-pres [data-pres=next]'); check('el botón de la barra avanza', (await pres(page)).i === 1);
    check('la barra entra en la pantalla', await page.evaluate(() => { const r = document.querySelector('.lmd-pres-bar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
    await page.click('.lmd-pres [data-pres=over]'); await page.waitForSelector('.lmd-pres-thumb');
    check('la vista general no se sale de la pantalla', await page.evaluate(() => document.querySelector('.lmd-pres-grid').scrollWidth <= innerWidth + 1));
    await page.click('.lmd-pres-thumb[data-slide="4"]'); check('y lleva a la diapositiva tocada', (await pres(page)).i === 4 && await inView(page));
    await page.click('.lmd-pres [data-pres=close]'); await sleep(150);
    check('el botón de salir cierra', await page.evaluate(() => !document.querySelector('.lmd-pres')));
    await ctx.close();
  });
});

check('ninguna página tiró errores', R.errors.length === 0, R.errors.slice(0, 5));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
