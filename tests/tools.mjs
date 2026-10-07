// Las herramientas de Ajustes > Herramientas que vienen apagadas: cada una se prende y se apaga, apagada no deja
// nada en la interfaz ni carga su archivo, y su recorrido de punta a punta. También en pantalla chica.
//   BROWSER=firefox node tools.mjs      BROWSER=webkit node tools.mjs      (sin BROWSER: chromium)
//   ONLY=present node tools.mjs         (una sola herramienta)
import { rig, tally, sleep } from './rig.mjs';
import { chromium } from 'playwright-core';
import zlib from 'zlib'; import fs from 'fs'; import os from 'os'; import path from 'path';

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

// ---------- Nota diaria ----------
// El reloj queda fijo: hoy es miércoles 7 de octubre de 2026.
const NOW = new Date(2026, 9, 7, 10, 30);
const fixClock = (page) => page.clock.setFixedTime(NOW);
const here = (page) => page.evaluate(() => decodeURIComponent(new URLSearchParams(location.search).get('f') || ''));
const nav = (page) => page.evaluate(() => { const n = document.querySelector('.lmd-daily-nav'); return n ? [...n.querySelectorAll('button')].map((b) => b.textContent.trim()) : null; });
const localNames = (page) => page.evaluate(async () => (await LMD.store.notesAll()).map((n) => n.name).sort());
const opened = (page, name) => until(async () => (await here(page)).endsWith(name) && await page.evaluate(() => !!document.querySelector('.lmd-article > *')), 6000);
const dailyOpts = async (page) => { await toolsTab(page); await page.click('.lmd-tl-card[data-tool=daily] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=daily] [data-dly=go]'); };

await suite('daily', async () => {
  await step('Nota diaria: apagada no deja nada', async () => {
    const { ctx, page } = await open(); await fixClock(page);
    await goHome(page);
    check('apagada: sin botón en el inicio ni en el explorador, sin archivo', await page.evaluate(() => !document.querySelector('[data-daily], .lmd-daily-btn') && !LMD.daily) && await scripts(page, 'daily.js') === 0);
    await page.keyboard.press('Alt+Shift+H'); await sleep(300);
    check('ni responde su atajo', (await localNames(page)).length === 0 && (await here(page)) === '');
    await toolsTab(page);
    check('su tarjeta está en Herramientas, apagada', await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=daily]'); return !!c && c.querySelector('b').textContent === 'Daily note' && !c.querySelector('input').checked; }));
    await flip(page, 'daily'); await until(() => page.evaluate(() => !!LMD.daily));
    check('prenderla pide su archivo', await scripts(page, 'daily.js') === 1 && (await stored(page, 'settings')).tools.daily === true);
    await page.click('.lmd-tl-card[data-tool=daily] .lmd-tl-more'); await page.waitForSelector('[data-dly=go]');
    const o = await page.evaluate(() => { const q = (k) => document.querySelector('[data-dly=' + k + ']'); return { where: [...q('where').options].map((x) => x.value + (x.disabled ? ':no' : '')).join(), name: q('name').value, tpl: q('tpl').value, many: q('tpl').options.length > 5, folderHidden: q('folder').closest('[data-dly-row]').hidden }; });
    check('sus opciones: dónde, el nombre y la plantilla', o.where.startsWith('local,cloud:no') && o.name === 'YYYY-MM-DD' && o.tpl === '' && o.many && o.folderHidden, o);
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await closePanel(page);
    check('prendida: el botón en el inicio y en el explorador', await page.evaluate(() => !!document.querySelector('.lmd-home-actions [data-daily=today]') && !!document.querySelector('.lmd-zone-files .lmd-daily-btn')));
    await toolsTab(page); await flip(page, 'daily'); await closePanel(page);
    check('apagarla saca los dos botones', await page.evaluate(() => !document.querySelector('[data-daily], .lmd-daily-btn')));
    await ctx.close();
  });

  await step('Nota diaria: crear, ayer y mañana, calendario', async () => {
    const { ctx, page } = await open({ tools: { daily: true } }); await fixClock(page);
    await goHome(page); await page.waitForSelector('.lmd-home-actions [data-daily=today]');
    await page.click('.lmd-home-actions [data-daily=today]'); await opened(page, '2026-10-07.md');
    const text = await saved(page, '2026-10-07.md');
    check('el botón del inicio crea la nota de hoy con la plantilla mínima', (await here(page)) === 'local/2026-10-07.md' && text === '# Wednesday, October 7, 2026\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n', text);
    check('abre en edición, con los enlaces a ayer y a mañana', await page.evaluate(() => document.documentElement.classList.contains('lmd-editing')) && J(await nav(page)) === J(['Yesterday', 'Today', 'Tomorrow']), await nav(page));
    await page.evaluate(() => LMD.store.notePut('2026-10-07.md', '# Hoy\n\nYa escribí algo.\n'));
    await goHome(page);
    await page.click('.lmd-zone-files .lmd-daily-btn'); await opened(page, '2026-10-07.md');
    check('el botón del explorador abre la misma, sin pisarla ni duplicarla', (await saved(page, '2026-10-07.md')) === '# Hoy\n\nYa escribí algo.\n' && J(await localNames(page)) === J(['2026-10-07.md']));
    await page.click('.lmd-daily-nav [data-daily=prev]'); await opened(page, '2026-10-06.md');
    check('Ayer crea y abre la nota de ayer', (await saved(page, '2026-10-06.md')).startsWith('# Tuesday, October 6, 2026') && J(await nav(page)) === J(['Previous day', 'Yesterday', 'Next day']), await nav(page));
    await page.click('.lmd-daily-nav [data-daily=next]'); await opened(page, '2026-10-07.md');
    check('Día siguiente vuelve a hoy', J(await nav(page)) === J(['Yesterday', 'Today', 'Tomorrow']));
    await page.goto(R.home); await page.waitForSelector('.lmd-home'); await sleep(200);
    await page.keyboard.press('Alt+Shift+H'); await opened(page, '2026-10-07.md');
    check('el atajo abre la nota de hoy', (await here(page)) === 'local/2026-10-07.md');
    // El calendario.
    await page.click('.lmd-daily-nav [data-daily=cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day');
    const cal = () => page.evaluate(() => ({ title: document.querySelector('.lmd-daily-cal h3').textContent, days: document.querySelectorAll('.lmd-daily-day').length, has: [...document.querySelectorAll('.lmd-daily-day.lmd-has')].map((b) => b.textContent).join(), today: (document.querySelector('.lmd-daily-day.lmd-today') || {}).textContent, on: (document.querySelector('.lmd-daily-day.lmd-on') || {}).textContent, first: document.querySelector('.lmd-daily-wd').textContent, pad: document.querySelectorAll('.lmd-daily-pad').length }));
    let c = await cal();
    check('el calendario muestra el mes, marca los días con nota y el de hoy', c.title === 'October 2026' && c.days === 31 && c.has === '6,7' && c.today === '7' && c.on === '7' && c.first === 'S' && c.pad === 4, c);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
    check('las flechas recorren los días', await page.evaluate(() => document.activeElement.dataset.day === '2026-10-15'));
    await page.keyboard.press('Enter'); await opened(page, '2026-10-15.md');
    check('elegir un día sin nota la crea', (await saved(page, '2026-10-15.md')).startsWith('# Thursday, October 15, 2026') && J(await nav(page)) === J(['Previous day', '2026-10-15', 'Next day']), await nav(page));
    await page.click('.lmd-daily-nav [data-daily=cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day');
    await page.click('.lmd-daily-cal [data-cal=prev]'); await until(async () => (await cal()).title === 'September 2026');
    c = await cal();
    check('navega al mes anterior', c.title === 'September 2026' && c.days === 30 && c.has === '' && !c.today, c);
    await page.click('.lmd-daily-day[data-day="2026-09-30"]'); await opened(page, '2026-09-30.md');
    check('y crea una nota en ese mes', (await localNames(page)).includes('2026-09-30.md'));
    await page.click('.lmd-daily-nav [data-daily=next]'); await opened(page, '2026-10-01.md');
    check('Día siguiente cruza de mes', (await here(page)) === 'local/2026-10-01.md');
    await page.click('.lmd-daily-nav [data-daily=cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day');
    c = await cal();
    check('el calendario abre en el mes de la nota y marca todo lo creado', c.title === 'October 2026' && c.has === '1,6,7,15' && c.on === '1', c);
    await page.keyboard.press('Escape'); await sleep(120);
    check('Escape lo cierra', await page.evaluate(() => !document.querySelector('.lmd-daily-cal')));
    await ctx.close();
  });

  await step('Nota diaria: sin conexión, nombre y plantilla', async () => {
    const { ctx, page } = await open({ tools: { daily: true } }); await fixClock(page);
    await goHome(page); await page.waitForSelector('[data-daily=today]');
    await ctx.setOffline(true);
    await page.click('[data-daily=today]'); await opened(page, '2026-10-07.md');
    check('sin conexión crea y abre la nota de hoy', (await saved(page, '2026-10-07.md')).includes('## Tasks'));
    await page.click('.lmd-daily-nav [data-daily=next]'); await opened(page, '2026-10-08.md');
    await page.click('.lmd-daily-nav [data-daily=cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day.lmd-has');
    check('y el calendario sigue andando', await page.evaluate(() => [...document.querySelectorAll('.lmd-daily-day.lmd-has')].map((b) => b.textContent).join() === '7,8'));
    await page.keyboard.press('Escape');
    await ctx.setOffline(false);
    // Una nota propia como plantilla, y otro nombre de archivo.
    await put(page, 'molde.md', '# Diario del {{fecha}}\n\nTres cosas de hoy:\n\n1. \n');
    await page.goto(noteUrl('molde.md')); await page.waitForSelector('.lmd-article > *'); await sleep(300);
    await dailyOpts(page);
    await page.click('[data-dly=own]'); await until(() => page.evaluate(() => document.querySelector('[data-dly=tpl]').value === 'own'));
    await page.fill('[data-dly=name]', 'DD.MM'); await page.dispatchEvent('[data-dly=name]', 'change'); await sleep(150);
    check('un nombre sin el año no se acepta', await page.evaluate(() => !document.querySelector('[data-dly=err]').hidden) && !(await stored(page, 'settings')).tools.dailyName);
    await page.fill('[data-dly=name]', 'diario DD-MM-YYYY'); await page.dispatchEvent('[data-dly=name]', 'change'); await sleep(250);
    check('uno con año, mes y día queda guardado', (await stored(page, 'settings')).tools.dailyName === 'diario DD-MM-YYYY' && await page.evaluate(() => document.querySelector('[data-dly=err]').hidden));
    await page.click('[data-dly=go]'); await opened(page, 'diario 07-10-2026.md');
    check('la nota de hoy usa el nombre nuevo y la plantilla propia, con la fecha puesta', (await saved(page, 'diario 07-10-2026.md')) === '# Diario del Wednesday, October 7, 2026\n\nTres cosas de hoy:\n\n1. \n', await saved(page, 'diario 07-10-2026.md'));
    check('y lleva sus enlaces de ayer y mañana', J(await nav(page)) === J(['Yesterday', 'Today', 'Tomorrow']));
    check('la nota de plantilla no se toma por una nota diaria', await page.evaluate(() => LMD.daily.dateOf('molde.md') === null && LMD.daily.dateOf('diario 31-02-2026.md') === null && LMD.daily.iso(LMD.daily.dateOf('diario 01-03-2026.md')) === '2026-03-01'));
    // Una plantilla de las que vienen con la app.
    await dailyOpts(page);
    const tid = await page.evaluate(() => { const s = document.querySelector('[data-dly=tpl]'); const o = s.querySelector('optgroup option'); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.value; });
    await sleep(250); await closePanel(page);
    await page.click('.lmd-daily-nav [data-daily=next]'); await opened(page, 'diario 08-10-2026.md');
    const want = await page.evaluate((id) => LMD.templates.get(id).text, tid);
    check('con una plantilla de la app, la nota nace con ese texto', want.length > 20 && (await saved(page, 'diario 08-10-2026.md')) === want);
    await ctx.close();
  });

  await step('Nota diaria: en una carpeta del disco y en la nube', async () => {
    if (ENGINE === 'chromium') {
      // Un permiso de carpeta solo se puede guardar en un perfil de verdad: una ventana privada no lo deja.
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
      const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'block' });
      await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
      const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
      await page.addInitScript(([base]) => { try { if (localStorage.getItem('tools:listo')) return; localStorage.setItem('tools:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: 'en', tools: { daily: true } })); } catch (e) { /* página en blanco */ } }, [R.base]);
      await fixClock(page);
      await goHome(page);
      await page.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mis-dias', { create: true }); window.showDirectoryPicker = async () => dir; });
      await dailyOpts(page);
      await page.selectOption('[data-dly=where]', 'disk'); await page.waitForSelector('[data-dly=pick]:visible');
      await page.click('[data-dly=pick]'); await until(() => page.evaluate(() => (document.querySelector('[data-dly=diskname]') || {}).textContent === 'mis-dias'));
      await page.fill('[data-dly=folder]', 'diario/2026'); await page.dispatchEvent('[data-dly=folder]', 'change'); await sleep(250);
      await page.click('[data-dly=go]'); await opened(page, '2026-10-07.md');
      const disk = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await (await (await root.getDirectoryHandle('mis-dias')).getDirectoryHandle('diario')).getDirectoryHandle('2026'); return (await (await d.getFileHandle('2026-10-07.md')).getFile()).text(); });
      check('en el disco, la nota se crea en la subcarpeta elegida', disk.includes('## Tasks') && /\/diario\/2026\/2026-10-07\.md$/.test(await here(page)), await here(page));
      check('y es una nota diaria, con sus enlaces', J(await nav(page)) === J(['Yesterday', 'Today', 'Tomorrow']) && (await localNames(page)).length === 0);
      await page.click('.lmd-daily-nav [data-daily=cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day.lmd-has');
      check('el calendario lee los días del disco', await page.evaluate(() => [...document.querySelectorAll('.lmd-daily-day.lmd-has')].map((b) => b.textContent).join() === '7'));
      await ctx.close(); await sleep(300);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ }
    }
    const who = await R.signup('diario-' + Date.now() + '@prueba.test');
    const { ctx, page } = await open({ who, tools: { daily: true, dailyWhere: 'cloud', dailyFolder: 'diario' } }); await fixClock(page);
    await goHome(page); await page.waitForSelector('[data-daily=today]');
    await page.click('[data-daily=today]'); await opened(page, '2026-10-07.md');
    const list = (await R.api('GET', '/notes', undefined, who.s)).json.map((n) => n.path);
    check('en la nube, la nota de hoy se crea en su carpeta', J(list) === J(['diario/2026-10-07.md']) && (await here(page)) === 'cloud/diario/2026-10-07.md', list);
    check('y lleva sus enlaces', J(await nav(page)) === J(['Yesterday', 'Today', 'Tomorrow']));
    await sleep(500); await ctx.setOffline(true);
    await page.click('.lmd-daily-nav [data-daily=next]'); await opened(page, '2026-10-08.md');
    check('sin conexión, la del día nuevo queda en este navegador y se avisa', (await here(page)) === 'local/2026-10-08.md' && /saved in this browser/.test(await flashText(page)), await flashText(page));
    await ctx.setOffline(false);
    await ctx.close();
  });

  await step('Nota diaria: pantalla chica y en español', async () => {
    const { ctx, page } = await open({ tools: { daily: true }, lang: 'es', ctx: SMALL }); await fixClock(page);
    await goHome(page); await page.waitForSelector('.lmd-home-actions [data-daily=today]');
    check('el botón del inicio entra en la pantalla', await page.evaluate(() => { const r = document.querySelector('[data-daily=today]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 80; }));
    await page.tap('.lmd-home-actions [data-daily=today]'); await opened(page, '2026-10-07.md');
    check('en español: la fecha larga, tareas y notas', (await saved(page, '2026-10-07.md')) === '# Miércoles, 7 de octubre de 2026\n\n## Tareas\n\n- [ ] \n\n## Notas\n\n', await saved(page, '2026-10-07.md'));
    check('los enlaces de ayer y mañana entran en la pantalla', J(await nav(page)) === J(['Ayer', 'Hoy', 'Mañana']) && await page.evaluate(() => { const r = document.querySelector('.lmd-daily-nav').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    await page.tap('.lmd-topbar [data-act=more]'); await page.waitForSelector('.lmd-menu [data-more=daily-cal]');
    check('el menú "más" ofrece la nota de hoy y el calendario', await page.evaluate(() => !!document.querySelector('.lmd-menu [data-more=daily]')));
    await page.tap('.lmd-menu [data-more=daily-cal]'); await page.waitForSelector('.lmd-daily-cal .lmd-daily-day');
    const c = await page.evaluate(() => { const r = document.querySelector('.lmd-daily-cal .lmd-ask-card').getBoundingClientRect(); const d = document.querySelector('.lmd-daily-day').getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tap: d.width >= 36 && d.height >= 36, first: document.querySelector('.lmd-daily-wd').textContent, title: document.querySelector('.lmd-daily-cal h3').textContent }; });
    check('el calendario entra, con días cómodos para el dedo y la semana desde el lunes', c.fits && c.tap && c.first === 'L' && c.title === 'Octubre de 2026', c);
    const swipe = (dx) => page.evaluate((d) => { const g = document.querySelector('.lmd-daily-grid'); const ev = (t, x) => g.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: 300, pointerType: 'touch', pointerId: 1 })); ev('pointerdown', 250); ev('pointerup', 250 + d); }, dx);
    await swipe(-120); await until(() => page.evaluate(() => document.querySelector('.lmd-daily-cal h3').textContent === 'Noviembre de 2026'));
    check('deslizar cambia de mes', await page.evaluate(() => document.querySelector('.lmd-daily-cal h3').textContent === 'Noviembre de 2026'));
    await page.tap('.lmd-daily-day[data-day="2026-11-02"]'); await opened(page, '2026-11-02.md');
    check('tocar un día crea su nota', (await saved(page, '2026-11-02.md')).startsWith('# Lunes, 2 de noviembre de 2026'));
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await ctx.close();
  });
});

check('ninguna página tiró errores', R.errors.length === 0, R.errors.slice(0, 5));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
