// Las herramientas de Ajustes > Herramientas que vienen apagadas: cada una se prende y se apaga, apagada no deja
// nada en la interfaz ni carga su archivo, y su recorrido de punta a punta. También en pantalla chica.
//   BROWSER=firefox node tools.mjs      BROWSER=webkit node tools.mjs      (sin BROWSER: chromium)
//   ONLY=present node tools.mjs         (una sola herramienta: present, daily, docx o linkmap)
//   KEEP_DOCX=C:\tmp\prueba.docx ONLY=docx node tools.mjs      (deja el .docx generado para abrirlo a mano)
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
// Un permiso de carpeta solo se puede guardar en un perfil de verdad (una ventana privada no lo deja): para las
// pruebas con una carpeta del disco, un Chromium con su perfil propio. Quien la usa borra profile al cerrar.
async function openProfile(tools) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const page = await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
  await page.addInitScript(([base, t]) => { try { if (localStorage.getItem('tools:listo')) return; localStorage.setItem('tools:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: 'en', tools: t })); } catch (e) { /* página en blanco */ } }, [R.base, tools]);
  return { ctx, page, profile };
}
const dropProfile = async (ctx, profile) => { await ctx.close(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ } };
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
    await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=present] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=present] [data-pres=go]');
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
    await page.evaluate(() => LMD.patch(LMD.theme.patchFor('arena'))); await page.waitForFunction(() => document.documentElement.classList.contains('lmd-themed'));
    const themedPres = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.lmd-pres')).backgroundColor, fg: getComputedStyle(document.querySelector('.lmd-pres-slide')).color }));
    await page.evaluate(() => LMD.patch({ preset: '', theme: 'auto' })); await page.waitForFunction(() => !document.documentElement.classList.contains('lmd-themed'));
    check('la presentación sale con el tema incluido que hay puesto', themedPres.bg === 'rgb(246, 239, 224)' && themedPres.fg === 'rgb(43, 36, 25)', themedPres);
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
const dailyOpts = async (page) => { await toolsTab(page); await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=daily] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=daily] [data-dly=go]'); };

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
    await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=daily] .lmd-tl-more'); await page.waitForSelector('[data-dly=go]');
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
      const { ctx, page, profile } = await openProfile({ daily: true });
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
      await dropProfile(ctx, profile);
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

// ---------- Exportar a Word ----------
// El zip se abre acá, a mano: firma, directorio central, cada entrada descomprimida y su CRC32.
function unzip(buf) {
  let end = buf.length - 22; while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('sin fin de directorio central');
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16); const files = []; const bad = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('entrada ' + i + ' sin firma');
    const method = buf.readUInt16LE(at + 10); const crc = buf.readUInt32LE(at + 16); const csize = buf.readUInt32LE(at + 20); const usize = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28); const elen = buf.readUInt16LE(at + 30); const clen = buf.readUInt16LE(at + 32); const off = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nlen).toString('utf8');
    if (buf.readUInt32LE(off) !== 0x04034b50) bad.push(name + ': cabecera local');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28); const raw = buf.slice(start, start + csize);
    let data = raw;
    try { if (method === 8) data = zlib.inflateRawSync(raw); else if (method !== 0) bad.push(name + ': método ' + method); } catch (e) { bad.push(name + ': no descomprime'); }
    if (data.length !== usize) bad.push(name + ': tamaño'); if ((zlib.crc32(data) >>> 0) !== crc) bad.push(name + ': crc');
    if (buf.readUInt32LE(off + 14) !== crc || buf.readUInt32LE(off + 18) !== csize) bad.push(name + ': la cabecera local no coincide');
    files.push({ name, method, data });
    at += 46 + nlen + elen + clen;
  }
  return { files, bad, get: (n) => { const f = files.find((x) => x.name === n); return f ? f.data.toString('utf8') : ''; } };
}
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WORD_MD = ['---', 'title: Informe de prueba', '---', '# Título uno', '', 'Texto **negrita** *cursiva* ~~tachado~~ `codigo()` [enlace](https://example.com/a?b=1&c=2) $x^2$ ==marcado== H~2~O y x^2^ con nota[^1] y [sección](#seccion-dos).', '',
  '- uno', '  - dos', '    1. tres', '    2. cuatro', '- [x] hecha', '- [ ] pendiente', '', '5. cinco', '6. seis', '', '> Una cita con **fuerza**.', '', '> [!WARNING]', '> Cuidado con 1 < 2 & aquello.', '',
  '```js', 'const a = 1;', '\tif (a < 2) { b(); }', '```', '', '| Nombre | Monto |', '|:--|--:|', '| Ana | 10 |', '| Luis | 20 |', '', '$$', 'E=mc^2', '$$', '',
  '```mermaid', 'graph LR; A-->B;', '```', '', '```dot', 'digraph { a -> b }', '```', '', '![un punto](' + PNG_1PX + ')', '', '![no se lee](http://127.0.0.1:9/falta.png)', '', '---', '',
  '## Sección dos', '', '### Nivel tres', '', '#### Nivel cuatro', '', '##### Nivel cinco', '', '###### Nivel seis', '', 'Término', ': Su definición', '', '```kanban', '## Por hacer', '- tarjeta uno', '## Hecho', '- tarjeta dos', '```', '',
  '[^1]: El texto de la nota al pie.', ''].join('\n');
const runsWith = (xml, text) => { const out = []; const re = /<w:r>(?:<w:rPr>(.*?)<\/w:rPr>)?((?:<w:t[^>]*>[^<]*<\/w:t>|<w:br\/>|<w:tab\/>)+)<\/w:r>/g; let m; while ((m = re.exec(xml))) if (m[2].includes('>' + text + '<')) out.push(m[1] || ''); return out; };
const paraWith = (xml, text) => { const ps = xml.split('<w:p>').slice(1).map((p) => p.split('</w:p>')[0]); const plain = (p) => p.replace(/<[^>]+>/g, '').replace(/[☐☒]/g, '').trim(); return ps.find((p) => plain(p) === text) || ps.find((p) => plain(p).includes(text)) || ''; };
const wellFormed = (page, parts) => page.evaluate((list) => list.filter((p) => { const d = new DOMParser().parseFromString(p.xml, 'application/xml'); return !!d.querySelector('parsererror') || !d.documentElement; }).map((p) => p.name), parts);
async function download(page, act) { const [d] = await Promise.all([page.waitForEvent('download'), act()]); const file = path.join(os.tmpdir(), 'docx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)); await d.saveAs(file); const buf = fs.readFileSync(file); fs.rmSync(file, { force: true }); return { name: d.suggestedFilename(), buf }; }

await suite('docx', async () => {
  await step('Word: apagada no deja nada', async () => {
    const { ctx, page } = await open();
    await note(page, 'informe.md', WORD_MD);
    check('apagada: Exportar no la ofrece y su archivo no se cargó', !(await menuItems(page, 'export')).includes('export-docx') && await page.evaluate(() => !LMD.docx) && await scripts(page, 'docx.js') === 0);
    await toolsTab(page);
    check('su tarjeta está en Herramientas, apagada', await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=docx]'); return !!c && c.querySelector('b').textContent === 'Export to Word' && !c.querySelector('input').checked; }));
    await flip(page, 'docx'); await until(() => page.evaluate(() => !!LMD.docx));
    await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=docx] .lmd-tl-more'); await page.waitForSelector('[data-docx=go]');
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await closePanel(page);
    const items = await menuItems(page, 'export');
    check('prendida: "Word (.docx)" en el menú Exportar', items.includes('export-docx') && await scripts(page, 'docx.js') === 1, items);
    await toolsTab(page); await flip(page, 'docx'); await closePanel(page);
    check('apagarla saca la opción', !(await menuItems(page, 'export')).includes('export-docx'));
    await ctx.close();
  });

  await step('Word: el archivo', async () => {
    const { ctx, page } = await open({ tools: { docx: true } });
    await note(page, 'informe.md', WORD_MD);
    await until(() => page.evaluate(() => document.querySelectorAll('.lmd-diagram svg').length === 2), 12000);
    check('el CRC32 propio da el valor conocido', await page.evaluate(() => LMD.docx.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926));
    const got = await download(page, async () => { await page.click('.lmd-topbar [data-act=export]'); await page.click('.lmd-menu [data-more=export-docx]'); });
    check('se descarga con el nombre de la nota y se avisa', got.name === 'informe.docx' && /Word document downloaded/.test(await flashText(page)), got.name);
    // KEEP_DOCX=ruta deja el archivo ahí, para abrirlo a mano en Word o LibreOffice.
    if (process.env.KEEP_DOCX) fs.writeFileSync(process.env.KEEP_DOCX, got.buf);
    const z = unzip(got.buf);
    const names = z.files.map((f) => f.name);
    check('es un zip válido: cada entrada descomprime y su CRC32 coincide', z.bad.length === 0 && got.buf.readUInt32LE(0) === 0x04034b50, z.bad);
    const need = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/footnotes.xml', 'docProps/core.xml', 'docProps/app.xml'];
    check('trae las partes de un documento de Word, con los tipos de contenido primero', names[0] === '[Content_Types].xml' && need.every((n) => names.includes(n)), names);
    const xmls = z.files.filter((f) => /\.(xml|rels)$/.test(f.name)).map((f) => ({ name: f.name, xml: f.data.toString('utf8') }));
    check('todos los XML están bien formados', xmls.length === 10 && (await wellFormed(page, xmls)).length === 0, await wellFormed(page, xmls));
    const doc = z.get('word/document.xml'); const rels = z.get('word/_rels/document.xml.rels'); const styles = z.get('word/styles.xml'); const types = z.get('[Content_Types].xml');
    check('la raíz es un documento de WordprocessingML y los tipos lo declaran', /^<\?xml[^>]*\?>\s*<w:document xmlns:w="http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main"/.test(doc) && types.includes('PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"') && z.get('_rels/.rels').includes('Target="word/document.xml"'));
    const heads = [1, 2, 3, 4, 5, 6].map((n) => (doc.match(new RegExp('<w:pStyle w:val="Heading' + n + '"/>', 'g')) || []).length);
    check('los títulos usan los estilos Heading 1 a 6, definidos con su nivel de esquema', J(heads) === J([1, 1, 1, 1, 1, 1]) && [1, 2, 3, 4, 5, 6].every((n) => styles.includes('w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/>') && styles.includes('<w:outlineLvl w:val="' + (n - 1) + '"/>')) && paraWith(doc, 'Título uno').includes('Heading1'), heads);
    check('negrita, cursiva, tachado y código en línea', runsWith(doc, 'negrita')[0] === '<w:b/><w:bCs/>' && runsWith(doc, 'cursiva')[0] === '<w:i/><w:iCs/>' && runsWith(doc, 'tachado')[0] === '<w:strike/>' && runsWith(doc, 'codigo()')[0] === '<w:rStyle w:val="CodeChar"/>' && /w:styleId="CodeChar".*?Consolas/.test(styles), [runsWith(doc, 'negrita'), runsWith(doc, 'codigo()')]);
    check('resaltado, subíndice y superíndice', runsWith(doc, 'marcado')[0] === '<w:highlight w:val="yellow"/>' && runsWith(doc, '2').some((r) => r.includes('subscript')) && runsWith(doc, '2').some((r) => r.includes('superscript')));
    const link = /<w:hyperlink r:id="(rId\d+)" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">enlace<\/w:t>/.exec(doc);
    check('el enlace es un hipervínculo con su destino en las relaciones', !!link && rels.includes('Id="' + link[1] + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"'), link && link[1]);
    const anchor = /<w:hyperlink w:anchor="(lmd_\d+)"[^>]*>.*?sección<\/w:t>/.exec(doc);
    check('el enlace a una sección salta al marcador de ese título', !!anchor && paraWith(doc, 'Sección dos').includes('w:name="' + anchor[1] + '"'), anchor && anchor[1]);
    const num = (t) => (/<w:numPr><w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/.exec(paraWith(doc, t)) || []).slice(1).join(':');
    const numbering = z.get('word/numbering.xml');
    check('listas con viñetas y numeradas, anidadas por nivel', num('uno') === '0:1' && num('dos') === '1:1' && num('tres') === '2:2' && num('cuatro') === '2:2' && num('cinco') === '0:3' && num('seis') === '0:3', [num('uno'), num('dos'), num('tres'), num('cinco')]);
    check('la numeración define viñetas y números, y una lista que arranca en 5 arranca en 5', /w:abstractNumId="0".*?w:numFmt w:val="bullet"/.test(numbering) && /w:abstractNumId="1".*?w:numFmt w:val="decimal"/.test(numbering) && numbering.includes('<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/>') && numbering.includes('<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="1"/>'));
    check('las tareas llevan una casilla, tildada o no', /<w14:checked w14:val="1"\/>/.test(paraWith(doc, 'hecha')) && /<w14:checked w14:val="0"\/>/.test(paraWith(doc, 'pendiente')) && !paraWith(doc, 'hecha').includes('<w:numPr>') && doc.includes('mc:Ignorable="w14"'));
    check('la cita y el aviso usan el estilo de cita, con lo raro escapado', paraWith(doc, 'Una cita con').includes('<w:pStyle w:val="Quote"/>') && runsWith(doc, 'fuerza')[0] === '<w:b/><w:bCs/>' && paraWith(doc, 'Cuidado con').includes('Quote') && doc.includes('Cuidado con 1 &lt; 2 &amp; aquello.') && paraWith(doc, 'Warning').includes('<w:b/>'));
    check('el bloque de código va renglón por renglón, monoespaciado y con su tabulación', paraWith(doc, 'const a = 1;').includes('<w:pStyle w:val="Code"/>') && /<w:pStyle w:val="Code"\/>.*?<w:tab\/><w:t xml:space="preserve">if \(a &lt; 2\) \{ b\(\); \}<\/w:t>/.test(doc) && /w:styleId="Code">.*?Consolas/.test(styles) && !doc.includes('hljs'));
    const tbl = (/<w:tbl>.*?<\/w:tbl>/.exec(doc) || [''])[0];
    check('la tabla: fila de encabezado que se repite, celdas y alineación', (tbl.match(/<w:tr>/g) || []).length === 3 && (tbl.match(/<w:tblHeader\/>/g) || []).length === 1 && (tbl.match(/<w:tc>/g) || []).length === 6 && (tbl.match(/<w:gridCol /g) || []).length === 2 && /<w:tblHeader\/>.*?<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">Nombre/.test(tbl) && (tbl.match(/<w:jc w:val="right"\/>/g) || []).length === 3 && tbl.includes('>Luis<') && tbl.includes('<w:tblStyle w:val="TableGrid"/>'), tbl.slice(0, 300));
    check('las fórmulas van como texto LaTeX', runsWith(doc, 'x^2').length === 1 && runsWith(doc, 'E=mc^2')[0].includes('CodeChar') && paraWith(doc, 'E=mc^2').includes('<w:jc w:val="center"/>'));
    const media = z.files.filter((f) => f.name.startsWith('word/media/'));
    const embeds = [...doc.matchAll(/<a:blip r:embed="(rId\d+)"\/>/g)].map((m) => m[1]);
    const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    check('las imágenes van incrustadas: la de la nota y los dos diagramas, como PNG', media.length === 3 && embeds.length === 3 && media.every((m) => isPng(m.data) && m.method === 0) && embeds.every((id) => new RegExp('Id="' + id + '" Type="[^"]*/image" Target="media/image\\d\\.png"').test(rels)) && types.includes('<Default Extension="png" ContentType="image/png"/>'), { media: media.map((m) => m.name), embeds });
    check('cada imagen dice su tamaño y su texto alternativo', (doc.match(/<wp:extent cx="\d+" cy="\d+"\/>/g) || []).length === 3 && doc.includes('descr="un punto"') && !/cx="0"|cy="0"/.test(doc.replace(/<a:off[^>]*>/g, '')));
    check('la imagen que no se puede leer deja su texto alternativo', runsWith(doc, '[no se lee]').length === 1);
    check('el separador es una línea', /<w:pBdr><w:bottom w:val="single"/.test(doc));
    const fn = z.get('word/footnotes.xml');
    check('la nota al pie es una nota al pie de Word', (doc.match(/<w:footnoteReference w:id="1"\/>/g) || []).length === 1 && /<w:footnote w:id="1">.*?<w:footnoteRef\/>.*?El texto de la nota al pie\.<\/w:t>/.test(fn) && fn.includes('w:type="separator" w:id="-1"') && !doc.includes('El texto de la nota al pie') && !fn.includes('↩') && rels.includes('Target="footnotes.xml"') && z.get('word/settings.xml').includes('<w:footnotePr>'));
    check('la lista de definiciones y el tablero llegan como texto', runsWith(doc, 'Término')[0] === '<w:b/><w:bCs/>' && paraWith(doc, 'Su definición').includes('<w:ind w:left="720"/>') && runsWith(doc, 'Por hacer')[0] === '<w:b/><w:bCs/>' && paraWith(doc, 'tarjeta uno').includes('w14:checkbox'));
    check('los metadatos llevan el título y nada personal', z.get('docProps/core.xml').includes('<dc:title>Informe de prueba</dc:title>') && !/creator|lastModifiedBy/.test(z.get('docProps/core.xml')) && z.get('docProps/app.xml').includes('<Application>SharpMD</Application>'));
    check('lo de la interfaz no pasa al documento', !/Copy|title: |Informe de prueba/.test(doc.replace(/<[^>]+>/g, ' ')) && doc.includes('<w:sectPr><w:pgSz'));
    const ids = [...doc.matchAll(/r:(?:id|embed)="(rId\d+)"/g)].map((m) => m[1]); const relTargets = [...rels.matchAll(/Target="([^"]+)"(?! TargetMode)/g)].map((m) => m[1]);
    check('cada relación usada existe, y cada parte relacionada está en el zip', ids.length >= 4 && ids.every((id) => rels.includes('Id="' + id + '"')) && relTargets.every((t) => names.includes('word/' + t)), relTargets);
    const pIds = [...doc.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]); const bIds = [...doc.matchAll(/<w:bookmarkStart w:id="(\d+)"/g)].map((m) => m[1]);
    check('los identificadores de imágenes y marcadores no se repiten', new Set(pIds).size === pIds.length && new Set(bIds).size === bIds.length && bIds.length === 6);
    // Sin CompressionStream el zip va sin comprimir, y sigue siendo válido.
    const plain = Buffer.from(await page.evaluate(async () => { const cs = window.CompressionStream; window.CompressionStream = undefined; try { return Array.from(await LMD.docx.bytes()); } finally { window.CompressionStream = cs; } }));
    const z2 = unzip(plain);
    check('sin compresión en el navegador el zip sale sin comprimir y válido', z2.bad.length === 0 && z2.files.every((f) => f.method === 0) && z2.get('word/document.xml') === doc && plain.length > got.buf.length, z2.bad);
    check('con compresión, los XML van comprimidos', ENGINE !== 'chromium' || z.files.filter((f) => /\.xml$/.test(f.name) && f.data.length > 400).every((f) => f.method === 8));
    // En edición no se cuela nada de lo editable.
    await page.goto(noteUrl('informe.md', true)); await page.waitForSelector('.lmd-editing .lmd-article'); await until(() => page.evaluate(() => document.querySelectorAll('.lmd-diagram svg').length === 2), 12000);
    const edit = unzip(Buffer.from(await page.evaluate(async () => Array.from(await LMD.docx.bytes())))).get('word/document.xml');
    check('en edición sale el mismo documento', edit.replace(/rId\d+/g, '') === doc.replace(/rId\d+/g, ''), [edit.length, doc.length]);
    // Una nota vacía también da un documento que abre.
    await put(page, 'vacia.md', '');
    await page.goto(noteUrl('vacia.md')); await page.waitForSelector('.lmd-article'); await sleep(400);
    const empty = unzip(Buffer.from(await page.evaluate(async () => Array.from(await LMD.docx.bytes()))));
    check('una nota vacía da un documento válido, con un párrafo', empty.bad.length === 0 && empty.get('word/document.xml').includes('<w:body><w:p/><w:sectPr>') && (await wellFormed(page, [{ name: 'd', xml: empty.get('word/document.xml') }])).length === 0);
    await ctx.close();
  });

  await step('Word: pantalla chica', async () => {
    const { ctx, page } = await open({ tools: { docx: true }, ctx: SMALL });
    await note(page, 'corta.md', '# Corta\n\nUn párrafo.\n');
    const got = await download(page, async () => { await page.click('.lmd-topbar [data-act=more]'); await page.click('.lmd-menu [data-more=export]'); await page.click('.lmd-menu [data-more=export-docx]'); });
    const z = unzip(got.buf);
    check('desde "más" > Exportar se descarga un .docx válido', got.name === 'corta.docx' && z.bad.length === 0 && z.get('word/document.xml').includes('>Un párrafo.<') && z.get('docProps/core.xml').includes('<dc:title>Corta</dc:title>'));
    await ctx.close();
  });
});

// ---------- Mapa de enlaces ----------
// a y b se enlazan entre sí, a y c también, e llega a b por una referencia; d queda suelta. Lo que está en código no cuenta.
const WEB = {
  'a.md': '# A\n\nVa a [[b]] y a [la c](c.md). En código no cuenta: `[[d]]`.\n\n```\n[[d]] y [otra](d.md)\n```\n',
  'b.md': '# B\n\nVuelve a [la a](./a.md#a) y sale a [un sitio](https://example.com/c.md).\n',
  'c.md': '# C\n\nUn wikilink con otra forma: [[A]]. Y uno que no existe: [[no-existe]].\n',
  'd.md': '# D\n\nSin enlaces.\n',
  'e.md': '# E\n\nPor referencia: [la b][ref].\n\n[ref]: b.md\n',
};
const web = async (page) => { await goHome(page); for (const [n, t] of Object.entries(WEB)) await put(page, n, t); };
const map = (page) => page.evaluate(() => (window.LMD && LMD.linkmap ? LMD.linkmap.state() : null));
const mapReady = async (page) => { await until(async () => { const s = await map(page); return s && s.open && s.ready && s.settled; }, 15000); await page.evaluate(() => LMD.linkmap.fit()); await sleep(150); return map(page); };
const back = (page) => page.evaluate(() => { const b = document.querySelector('.lmd-back'); return b ? { n: b.querySelector('.lmd-back-n').textContent, names: [...b.querySelectorAll('li a')].map((a) => a.textContent), where: [...b.querySelectorAll('li span')].map((a) => a.textContent), open: b.open } : null; });
const openNoteAt = async (page, name) => { await page.goto(noteUrl(name)); await page.waitForSelector('.lmd-article > *'); await sleep(300); };
const EDGES = ['a.md ~ b.md', 'a.md ~ c.md', 'b.md ~ e.md'];

await suite('linkmap', async () => {
  await step('Mapa: apagada no deja nada', async () => {
    const { ctx, page } = await open();
    await web(page); await openNoteAt(page, 'b.md');
    check('apagada: sin botón, sin enlaces bajo la nota, sin archivo', await page.evaluate(() => !document.querySelector('.lmd-map-btn, .lmd-back') && !LMD.linkmap) && await scripts(page, 'linkmap.js') === 0);
    await page.keyboard.press('Alt+Shift+G'); await sleep(250);
    check('ni responde su atajo', await page.evaluate(() => !document.querySelector('.lmd-map')));
    await toolsTab(page);
    check('su tarjeta está en Herramientas, apagada', await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=linkmap]'); return !!c && c.querySelector('b').textContent === 'Link map' && !c.querySelector('input').checked; }));
    await flip(page, 'linkmap'); await until(() => page.evaluate(() => !!LMD.linkmap));
    await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=linkmap] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=linkmap] [data-map=go]');
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await closePanel(page);
    await until(() => page.evaluate(() => !!document.querySelector('.lmd-back')));
    check('prendida: el botón en el explorador y los enlaces bajo la nota', await scripts(page, 'linkmap.js') === 1 && await page.evaluate(() => !!document.querySelector('.lmd-zone-files .lmd-map-btn') && !!document.querySelector('.lmd-back')));
    await toolsTab(page); await flip(page, 'linkmap'); await closePanel(page);
    check('apagarla saca las dos cosas', await page.evaluate(() => !document.querySelector('.lmd-map-btn, .lmd-back')));
    await ctx.close();
  });

  await step('Mapa: enlaces a esta nota', async () => {
    const { ctx, page } = await open({ tools: { linkmap: true } });
    await web(page); await openNoteAt(page, 'b.md');
    await until(() => page.evaluate(() => !!document.querySelector('.lmd-back')));
    let b = await back(page);
    check('bajo la nota: las que enlazan a ella, por enlace, wikilink o referencia', b && b.n === '2' && J(b.names) === J(['a', 'e']) && b.where[0] === 'In this browser' && b.open, b);
    check('el índice separa enlaces relativos de wikilinks y deja afuera el código', await page.evaluate((t) => { const l = LMD.linkmap.linksOf(t); return JSON.stringify(l) === JSON.stringify({ wiki: ['b'], rel: ['c.md'] }); }, WEB['a.md']));
    await page.click('.lmd-back li a'); await until(async () => (await here(page)) === 'local/a.md');
    await until(async () => { const x = await back(page); return x && x.names.join() === 'b,c'; });
    b = await back(page);
    check('tocar una abre esa nota, que muestra las suyas', (await here(page)) === 'local/a.md' && b && J(b.names) === J(['b', 'c']), b);
    await openNoteAt(page, 'd.md'); await sleep(500);
    check('una nota a la que nadie enlaza no muestra el panel', (await back(page)) === null);
    check('y se puede pedir por código', J(await page.evaluate(() => LMD.linkmap.backlinks())) === J([]) && J(await page.evaluate(() => LMD.linkmap.backlinks(location.href.replace(/\?.*$/, '').replace(/[^/]*\/[^/]*$/, '') && 'https://lmd.local/local/b.md'))) === J(['a.md', 'e.md']));
    // Enlazar desde otra nota y volver: el panel se pone al día.
    await put(page, 'd.md', '# D\n\nAhora sí: [[c]].\n');
    await openNoteAt(page, 'c.md'); await until(async () => { const x = await back(page); return x && x.names.length === 2; });
    check('un enlace nuevo aparece al volver a la nota', J(((await back(page)) || {}).names) === J(['a', 'd']), await back(page));
    await ctx.close();
  });

  await step('Mapa: nodos, aristas y abrir desde un nodo', async () => {
    const { ctx, page } = await open({ tools: { linkmap: true } });
    await web(page); await openNoteAt(page, 'a.md');
    await page.click('.lmd-zone-files .lmd-map-btn'); await page.waitForSelector('.lmd-map canvas');
    let s = await mapReady(page);
    check('un nodo por nota y una arista por par enlazado', s.nodes.length === 5 && J(s.nodes.map((n) => n.name).sort()) === J(Object.keys(WEB)) && J(s.edges) === J(EDGES), { n: s.nodes.map((x) => x.name), e: s.edges });
    const deg = Object.fromEntries(s.nodes.map((n) => [n.name, n.deg]).sort((x, y) => x[0].localeCompare(y[0])));
    check('cada nodo sabe cuántos enlaces tiene, y cuál es la nota abierta', J(deg) === J({ 'a.md': 2, 'b.md': 2, 'c.md': 1, 'd.md': 0, 'e.md': 1 }) && s.nodes.filter((n) => n.cur).map((n) => n.name).join() === 'a.md', deg);
    const box = await page.evaluate(() => { const r = document.querySelector('.lmd-map-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    check('todos los nodos quedan a la vista, separados', s.nodes.every((n) => n.x > box.l && n.x < box.r && n.y > box.t && n.y < box.b) && s.nodes.every((n, i) => s.nodes.every((m, k) => k === i || Math.hypot(n.x - m.x, n.y - m.y) > 14)), s.nodes);
    check('el pie dice cuántas notas y enlaces hay', await page.evaluate(() => document.querySelector('.lmd-map-count').textContent === '5 notes · 3 links'));
    check('el lienzo tiene algo dibujado', await page.evaluate(() => { const c = document.querySelector('.lmd-map-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 200; }));
    const at = (name) => s.nodes.find((n) => n.name === name);
    await page.mouse.move(at('b.md').x, at('b.md').y); await sleep(120);
    check('pasar el cursor por un nodo lo marca, con sus vecinos', (await map(page)).hover === 'b.md' && await page.evaluate(() => document.querySelector('.lmd-map-canvas').style.cursor === 'pointer'));
    // Acercar con la rueda, y arrastrar un nodo.
    const k0 = s.k; await page.mouse.move((box.l + box.r) / 2, (box.t + box.b) / 2); await page.mouse.wheel(0, -400); await sleep(150);
    check('la rueda acerca', (await map(page)).k > k0 * 1.2, [k0, (await map(page)).k]);
    await page.click('.lmd-map [data-map=out]'); await page.click('.lmd-map [data-map=fit]'); await sleep(150);
    s = await mapReady(page);
    const d0 = at('d.md'); await page.mouse.move(d0.x, d0.y); await page.mouse.down(); await page.mouse.move(d0.x + 60, d0.y + 40, { steps: 4 }); const mid = (await map(page)).nodes.find((n) => n.name === 'd.md'); await page.mouse.up(); await sleep(100);
    check('arrastrar un nodo lo mueve, sin abrir la nota', Math.hypot(mid.x - d0.x - 60, mid.y - d0.y - 40) < 6 && (await map(page)).open && (await here(page)) === 'local/a.md', [d0, mid]);
    // Buscar, filtrar las sueltas.
    await page.fill('.lmd-map-q', 'E'); await sleep(120);
    check('el buscador marca las notas que coinciden', (await map(page)).nodes.filter((n) => n.hit).map((n) => n.name).join() === 'e.md');
    await page.fill('.lmd-map-q', ''); await page.click('.lmd-map-lone input'); await sleep(200);
    s = await map(page);
    check('sin las notas sueltas quedan las enlazadas', s.nodes.length === 4 && !s.nodes.some((n) => n.name === 'd.md') && J(s.edges) === J(EDGES) && (await stored(page, 'settings')).tools.mapOrphans === false);
    await page.click('.lmd-map-lone input');
    s = await mapReady(page);
    check('y vuelven al pedirlas', s.nodes.length === 5);
    await page.mouse.click(at('c.md').x, at('c.md').y); await until(async () => (await here(page)) === 'local/c.md');
    check('tocar un nodo abre esa nota y cierra el mapa', (await here(page)) === 'local/c.md' && !(await map(page)).open && await page.evaluate(() => document.querySelector('.lmd-article h1').textContent.startsWith('C')));
    await page.keyboard.press('Alt+Shift+G'); await page.waitForSelector('.lmd-map canvas'); s = await mapReady(page);
    check('el atajo lo abre, con la nota nueva marcada', s.nodes.filter((n) => n.cur).map((n) => n.name).join() === 'c.md');
    await page.fill('.lmd-map-q', 'b'); await page.keyboard.press('Enter'); await until(async () => (await here(page)) === 'local/b.md');
    check('Enter en el buscador abre la que coincide', (await here(page)) === 'local/b.md' && !(await map(page)).open);
    await page.keyboard.press('Alt+Shift+G'); await page.waitForSelector('.lmd-map canvas'); await page.keyboard.press('Escape'); await sleep(150);
    check('Escape lo cierra', !(await map(page)).open && await page.evaluate(() => !document.querySelector('.lmd-map')));
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await ctx.close();
  });

  await step('Mapa: la nube solo con lo que ya está en el dispositivo', async () => {
    const who = await R.signup('mapa-' + Date.now() + '@prueba.test');
    for (const [p, t] of [['p/x.md', '# X\n\n[[y]]\n'], ['p/y.md', '# Y\n'], ['z.md', '# Z\n\n[x](p/x.md)\n']]) await R.api('PUT', '/notes/' + encodeURIComponent(p), { text: t }, who.s);
    const { ctx, page } = await open({ who, tools: { linkmap: true } });
    await page.goto(R.noteUrl('p/x.md')); await page.waitForSelector('.lmd-article > *'); await sleep(500);
    await page.goto(R.noteUrl('p/y.md')); await page.waitForSelector('.lmd-article > *'); await sleep(500);
    // Una copia cifrada de una carpeta protegida de la que acá no hay llave.
    await page.evaluate((mail) => LMD.store.cloudPut(mail, 'secreta/s.md', { text: 'lmd1:cifrado', base: 'lmd1:cifrado', sealed: true, pending: false, role: 'owner' }), who.email);
    const asked = []; page.on('request', (r) => { if (r.url().startsWith(R.base)) asked.push(r.method() + ' ' + r.url().slice(R.base.length)); });
    await sleep(300); asked.length = 0;
    await page.keyboard.press('Alt+Shift+G'); await page.waitForSelector('.lmd-map canvas');
    const s = await mapReady(page);
    check('entran las notas de la nube que ya se abrieron acá, con su carpeta', J(s.nodes.map((n) => n.name + '@' + n.folder).sort()) === J(['x.md@Cloud/p', 'y.md@Cloud/p']) && J(s.edges) === J(['x.md ~ y.md']), s.nodes.map((n) => n.name + '@' + n.folder));
    check('la que nunca se bajó no aparece, ni la copia cifrada', !s.nodes.some((n) => n.name === 'z.md' || n.name === 's.md'));
    // La nota abierta se sigue consultando sola, como siempre: lo que no puede haber es un pedido de otra nota ni de la lista.
    check('armar el mapa no pide ninguna nota al servidor', asked.filter((a) => /\/notes/.test(a) && !/y\.md/.test(a)).length === 0, asked);
    await page.keyboard.press('Escape');
    await until(async () => { const x = await back(page); return x && x.names.join() === 'x'; });
    check('los enlaces a esta nota también salen de las copias locales', J(((await back(page)) || {}).names) === J(['x']) && asked.filter((a) => /\/notes\//.test(a) && /z\.md/.test(a)).length === 0);
    await ctx.close();
  });

  await step('Mapa: una carpeta del disco, con subcarpetas', async () => {
    if (ENGINE !== 'chromium') return;
    const { ctx, page, profile } = await openProfile({ linkmap: true });
    await goHome(page);
    await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('wiki', { create: true });
      const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
      await write(dir, 'raiz.md', '# Raíz\n\n[[hoja]] y [la otra](sub/otra%20nota.md)\n');
      const sub = await dir.getDirectoryHandle('sub', { create: true });
      await write(sub, 'hoja.md', '# Hoja\n\n[arriba](../raiz.md)\n'); await write(sub, 'otra nota.md', '# Otra\n'); await write(sub, 'datos.csv', 'a,b\n');
      window.showDirectoryPicker = async () => dir;
    });
    await put(page, 'del-navegador.md', '# N\n\n[[raiz]]\n');
    await Promise.all([page.waitForNavigation(), page.click('[data-home=dir]')]); await page.waitForSelector('.lmd-article > *'); await sleep(500);
    await page.click('.lmd-zone-files .lmd-map-btn'); await page.waitForSelector('.lmd-map canvas');
    let s = await mapReady(page);
    check('la carpeta abierta entra con sus subcarpetas, junto a las notas del navegador', J(s.nodes.map((n) => n.name + '@' + n.folder).sort()) === J(['del-navegador.md@In this browser', 'hoja.md@wiki/sub', 'otra nota.md@wiki/sub', 'raiz.md@wiki']), s.nodes.map((n) => n.name + '@' + n.folder));
    check('los enlaces relativos suben y bajan de carpeta; un wikilink no cruza de un lugar a otro', J(s.edges) === J(['hoja.md ~ raiz.md', 'otra nota.md ~ raiz.md']), s.edges);
    const opts = await page.evaluate(() => [...document.querySelector('.lmd-map-folder').options].map((o) => o.value));
    check('el filtro ofrece cada carpeta', J(opts) === J(['', 'In this browser', 'wiki', 'wiki/sub']), opts);
    await page.selectOption('.lmd-map-folder', 'wiki/sub'); await sleep(250); s = await map(page);
    check('filtrar por carpeta deja solo sus notas', J(s.nodes.map((n) => n.name).sort()) === J(['hoja.md', 'otra nota.md']) && s.edges.length === 0);
    await page.selectOption('.lmd-map-folder', 'wiki'); s = await mapReady(page);
    check('y una carpeta incluye lo de adentro', s.nodes.length === 3 && s.edges.length === 2);
    const n = s.nodes.find((x) => x.name === 'hoja.md'); await page.mouse.click(n.x, n.y);
    await until(async () => /sub\/hoja\.md$/.test(await here(page)));
    check('abrir desde un nodo lleva a la nota del disco', /sub\/hoja\.md$/.test(await here(page)));
    await until(async () => { const x = await back(page); return x && x.names.join() === 'raiz'; });
    check('con sus enlaces entrantes', J(((await back(page)) || {}).names) === J(['raiz']) && (await back(page)).where[0] === 'wiki');
    await dropProfile(ctx, profile);
  });

  await step('Mapa: cientos de notas y pantalla chica', async () => {
    const { ctx, page } = await open({ tools: { linkmap: true }, ctx: SMALL });
    await goHome(page);
    await page.evaluate(async () => { const N = 300; for (let i = 0; i < N; i++) await LMD.store.handlesPut({ key: 'note:n' + i + '.md', note: true, name: 'n' + i + '.md', text: '# N' + i + '\n\n[[n' + ((i * 7 + 1) % N) + ']] [x](n' + ((i + 13) % N) + '.md)\n', at: Date.now() - i }); });
    await openNoteAt(page, 'n0.md');
    await page.tap('.lmd-topbar [data-act=more]'); await page.waitForSelector('.lmd-menu [data-more=linkmap]');
    const t0 = Date.now(); await page.tap('.lmd-menu [data-more=linkmap]'); await page.waitForSelector('.lmd-map canvas');
    await until(async () => { const s = await map(page); return s && s.ready; }, 10000);
    const ready = Date.now() - t0;
    const fps = await page.evaluate(() => new Promise((resolve) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else resolve(n); }; requestAnimationFrame(f); }));
    let s = await map(page);
    check('300 notas: el mapa está listo enseguida y la animación no se traba', s.nodes.length === 300 && s.edges.length > 500 && ready < 5000 && fps >= 20, { ready, fps, edges: s.edges.length });
    s = await mapReady(page);
    check('y termina de acomodarse', s.settled);
    const fill = await page.evaluate(() => { const c = document.querySelector('.lmd-map-card').getBoundingClientRect(); const cv = document.querySelector('.lmd-map-canvas').getBoundingClientRect(); const q = document.querySelector('.lmd-map-q').getBoundingClientRect(); return { full: c.left <= 0 && c.right >= innerWidth && c.bottom >= innerHeight - 1, canvas: cv.width >= innerWidth - 2 && cv.height > 400, q: q.left >= 0 && q.right <= innerWidth, x: document.documentElement.scrollWidth <= innerWidth }; });
    check('en pantalla chica ocupa toda la pantalla, sin desbordar', fill.full && fill.canvas && fill.q && fill.x, fill);
    // Dos dedos acercan; uno corre el mapa; tocar un nodo abre la nota.
    const touch = (type, id, x, y) => page.evaluate(([t, i, px, py]) => document.querySelector('.lmd-map-canvas').dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: i, pointerType: 'touch', isPrimary: i === 1, clientX: px, clientY: py, button: 0 })), [type, id, x, y]);
    const k0 = s.k;
    await touch('pointerdown', 1, 150, 400); await touch('pointerdown', 2, 240, 400); await touch('pointermove', 1, 90, 400); await touch('pointermove', 2, 300, 400); await touch('pointerup', 1, 90, 400); await touch('pointerup', 2, 300, 400);
    check('separar dos dedos acerca', (await map(page)).k > k0 * 1.5 && (await map(page)).open, [k0, (await map(page)).k]);
    const before = (await map(page)).nodes[5];
    // Desde un lugar sin notas cerca.
    const all = (await map(page)).nodes; let free = null; let far = 0;
    for (let x = 30; x <= 300; x += 15) for (let y = 220; y <= 640; y += 15) { const d = Math.min(...all.map((n) => Math.hypot(n.x - x, n.y - y))); if (d > far) { far = d; free = { x, y }; } }
    await touch('pointerdown', 1, free.x, free.y); await touch('pointermove', 1, free.x + 30, free.y - 10); await touch('pointermove', 1, free.x + 60, free.y - 20); await touch('pointerup', 1, free.x + 60, free.y - 20);
    const after = (await map(page)).nodes[5];
    check('un dedo corre el mapa', far > 20 && Math.abs((after.x - before.x) - 60) < 8 && Math.abs((after.y - before.y) + 20) < 8 && (await map(page)).open, [far, before.x, after.x]);
    await page.evaluate(() => LMD.linkmap.fit()); await sleep(100);
    await page.tap('.lmd-map [data-map=in]'); await page.tap('.lmd-map [data-map=in]'); await sleep(100);
    s = await map(page);
    const cv = await page.evaluate(() => { const r = document.querySelector('.lmd-map-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    // Un nodo a la vista, lejos de los botones y sin otro pegado.
    const pick = s.nodes.find((n) => n.x > cv.l + 30 && n.x < cv.r - 80 && n.y > cv.t + 30 && n.y < cv.b - 150 && s.nodes.every((m) => m === n || Math.hypot(m.x - n.x, m.y - n.y) > 34));
    await touch('pointerdown', 1, pick.x, pick.y); await touch('pointerup', 1, pick.x, pick.y);
    await until(async () => (await here(page)) === 'local/' + pick.name);
    check('tocar un nodo abre su nota', (await here(page)) === 'local/' + pick.name && !(await map(page)).open, pick && pick.name);
    await ctx.close();
  });
});

// ---------- La tarjeta: el interruptor, Configurar y lo que se abre al prender ----------
await suite('card', async () => {
  const optsOf = (page, id) => page.evaluate((t) => { const c = document.querySelector('.lmd-tl-card[data-tool=' + t + ']'); const b = c.querySelector('.lmd-tl-more'); const a = c.querySelector('.lmd-tl-opts'); const f = document.activeElement;
    return { shown: !b.hidden && !c.querySelector('.lmd-tl-acts').hidden, open: b.getAttribute('aria-expanded'), text: b.textContent, area: !a.hidden && a.children.length > 0, focus: !!(f && f.closest && f.closest('.lmd-tl-opts') === a), tag: f ? f.tagName : '', btn: b.classList.contains('lmd-btn') && !b.classList.contains('lmd-link'), icon: !!b.querySelector('svg') }; }, id);
  await step('Tarjeta: al prender se abren las opciones, y Configurar las abre y las cierra', async () => {
    const { ctx, page } = await open();
    await goHome(page); await toolsTab(page);
    const before = await optsOf(page, 'present');
    await flip(page, 'present'); await page.waitForSelector('.lmd-tl-card[data-tool=present] [data-pres=go]'); await sleep(150);
    const on = await optsOf(page, 'present');
    check('apagada no ofrece configurar; al prenderla sus opciones se abren solas con el foco en el primer control', !before.shown && !before.area && on.shown && on.open === 'true' && on.area && on.focus, [before, on]);
    check('el botón es un botón a la vista y dice Hide con las opciones abiertas', on.btn && on.icon && on.text === 'Hide', on);
    await page.click('.lmd-tl-card[data-tool=present] .lmd-tl-more'); await sleep(120);
    const shut = await optsOf(page, 'present');
    await page.focus('.lmd-tl-card[data-tool=present] .lmd-tl-more'); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-tl-card[data-tool=present] [data-pres=go]'); await sleep(120);
    const again = await optsOf(page, 'present');
    check('Configure las cierra y las vuelve a abrir, también con el teclado, sin mover el foco', shut.open === 'false' && !shut.area && shut.text === 'Configure' && again.open === 'true' && again.area && again.text === 'Hide' && !again.focus, [shut, again]);
    // Abrir, cerrar y volver a abrir, en una tarjeta de cada columna: abierta ocupa el ancho, y cerrada vuelve a su lugar
    await flip(page, 'daily'); await page.waitForSelector('.lmd-tl-card[data-tool=daily] [data-dly=go]'); await sleep(200);
    const place = (id) => page.evaluate((t) => { const c = document.querySelector('.lmd-tl-card[data-tool=' + t + ']'); const r = c.getBoundingClientRect(); const l = c.parentNode.getBoundingClientRect(); const b = c.querySelector('.lmd-tl-more');
      return { x: Math.round(r.left - l.left), w: Math.round(r.width), full: r.width >= l.width - 2, edge: getComputedStyle(c).borderTopColor, turn: getComputedStyle(b.querySelector('svg')).transform, open: b.getAttribute('aria-expanded'), area: !c.querySelector('.lmd-tl-opts').hidden, order: [...c.parentNode.children].indexOf(c) }; }, id);
    const tog = async (id) => { await page.click('.lmd-tl-card[data-tool=' + id + '] .lmd-tl-more'); await sleep(250); return place(id); };
    const runs = {};
    for (const id of ['present', 'daily']) {
      const was = await place(id); const steps = [was.open === 'true' ? was : await tog(id)];
      steps.push(await tog(id)); steps.push(await tog(id)); steps.push(await tog(id));
      runs[id] = steps;
    }
    const cols = new Set(Object.values(runs).map((s) => s[1].x));
    const okRun = (s) => s[0].open === 'true' && s[0].area && s[0].full && s[1].open === 'false' && !s[1].area && !s[1].full && s[2].open === 'true' && s[2].area && s[2].full && s[3].open === 'false' && !s[3].area && s[3].x === s[1].x && s[3].w === s[1].w && s[3].order === s[0].order;
    check('las opciones se abren, se cierran y se vuelven a abrir con el mismo botón; cerrada, la tarjeta vuelve a su columna', okRun(runs.present) && okRun(runs.daily) && cols.size === 2, runs);
    check('abierta, la tarjeta se distingue con el borde del acento y la flecha del botón gira', Object.values(runs).every((s) => s[0].edge !== s[1].edge && s[2].edge === s[0].edge && s[0].turn !== s[1].turn), [runs.present[0].edge, runs.present[1].edge, runs.present[0].turn, runs.present[1].turn]);
    await page.click('.lmd-tl-card[data-tool=present] .lmd-tl-more'); await page.click('.lmd-tl-card[data-tool=daily] .lmd-tl-more'); await sleep(250);
    const both = [await place('present'), await place('daily')];
    await page.click('.lmd-tl-card[data-tool=present] .lmd-tl-more'); await sleep(200);
    check('con dos abiertas, cada una se cierra por su cuenta', both[0].area && both[1].area && !(await place('present')).area && (await place('daily')).area, both);
    await flip(page, 'daily');
    await flip(page, 'present');
    const off = await optsOf(page, 'present');
    check('apagarla cierra sus opciones y saca el botón', !off.shown && off.open === 'false' && !off.area && off.text === 'Configure', off);
    // Una que no sirve sin configurar: el asistente abre con el foco en el proveedor y avisa que falta la clave
    await flip(page, 'assistant'); await page.waitForSelector('.lmd-ai-set [data-ai=prov]'); await sleep(200);
    const ai = await optsOf(page, 'assistant');
    const need = await page.evaluate(() => { const n = document.querySelector('[data-tool=assistant] .lmd-tl-need'); return { text: n.hidden ? '' : n.textContent, tag: n.tagName, others: [...document.querySelectorAll('.lmd-tl-need:not([hidden])')].length }; });
    check('el asistente se abre al prenderlo, con el foco en su primer control, y la tarjeta dice que falta la clave', ai.open === 'true' && ai.focus && ai.tag === 'SELECT' && need.text === 'Add your key' && need.tag === 'BUTTON' && need.others === 1, [ai, need]);
    check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
    await flip(page, 'assistant');
    check('apagado, el aviso se va', await page.evaluate(() => document.querySelector('[data-tool=assistant] .lmd-tl-need').hidden && document.querySelector('[data-tool=assistant] .lmd-tl-opts').hidden));
    await ctx.close();
  });

  await step('Tarjeta: el interruptor prendido toma el acento, en los doce temas y con un color propio', async () => {
    const { ctx, page } = await open({ tools: { present: true } });
    await goHome(page); await toolsTab(page);
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    const look = (set) => page.evaluate((s) => {
      LMD.theme.apply(document.documentElement, s);
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const ch = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
      const ratio = (a, b) => { const x = lum(a); const y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
      const hex = (c) => '#' + c.match(/[\d.]+/g).slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
      const card = document.querySelector('.lmd-tl-card[data-tool=present]'); const on = card.querySelector('.lmd-switch i'); const off = document.querySelector('.lmd-tl-card[data-tool=daily] .lmd-switch i');
      const cs = getComputedStyle(on); const bg = getComputedStyle(card).backgroundColor; const knob = getComputedStyle(on, '::after').backgroundColor;
      const edge = /inset/.test(cs.boxShadow) && !/rgba\(0, 0, 0, 0\)/.test(cs.boxShadow) ? cs.boxShadow.match(/rgba?\([^)]+\)/)[0] : '';
      const fill = getComputedStyle(document.documentElement).getPropertyValue('--accent-fill').trim();
      return { track: hex(cs.backgroundColor), fill, card: ratio(cs.backgroundColor, bg), edge: edge ? ratio(edge, bg) : 0, knob: ratio(knob, cs.backgroundColor), same: cs.backgroundColor === getComputedStyle(off).backgroundColor };
    }, set);
    const bad = []; const seen = [];
    for (const p of await page.evaluate(() => LMD.theme.PRESETS.map((x) => ({ id: x.id, dark: x.dark, fill: x.c.fill })))) {
      const r = await look({ preset: p.id, theme: p.dark ? 'dark' : 'light' }); seen.push(p.id + ' ' + r.card + '/' + r.knob);
      if (r.track !== p.fill || r.card < 3 || r.knob < 3 || r.same) bad.push([p.id, r]);
    }
    check('en los doce temas el interruptor prendido va con el acento del tema, a 3:1 o más contra la tarjeta y con la perilla a la vista', bad.length === 0 && seen.length === 12, bad.length ? bad : seen);
    // Con un acento propio (plan pago): colores cómodos, y los que se pierden contra la tarjeta o tapan la perilla
    const own = []; const ACC = ['#e11d48', '#7c3aed', '#0ea5e9', '#f59e0b', '#f1efe9', '#ffffff', '#fde047', '#808080', '#1a1d23', '#000000', '#3f6a0a', '#bef264'];
    for (const mode of ['light', 'dark']) for (const accent of ACC) {
      const r = await look({ preset: '', theme: mode, supporter: true, accent });
      if (r.track !== accent || Math.max(r.card, r.edge) < 3 || r.knob < 3 || r.same) own.push([mode, accent, r]);
    }
    check('con un acento propio el interruptor toma ese color tal cual, la perilla se ve y nunca se pierde contra la tarjeta', own.length === 0, own);
    const plain = await look({ preset: '', theme: 'light', supporter: true, accent: '#e11d48' });
    check('y un acento que ya contrasta no gana borde', plain.edge === 0 && plain.card >= 3, plain);
    await ctx.close();
  });

  await step('Tarjeta: en el teléfono entra y la pestaña se desliza hasta la última', async () => {
    const { ctx, page } = await open({ ctx: SMALL });
    await goHome(page);
    await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.tap('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card');
    await page.tap('.lmd-tl-card[data-tool=present] .lmd-switch'); await page.waitForSelector('.lmd-tl-card[data-tool=present] [data-pres=go]'); await sleep(250);
    const m = await page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const cards = [...document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card')]; const b = document.querySelector('.lmd-tl-card[data-tool=present] .lmd-tl-more').getBoundingClientRect();
      const wide = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 0.5; }).length;
      cards[cards.length - 1].scrollIntoView({ block: 'end' }); const moved = body.scrollTop > 0; const last = cards[cards.length - 1].getBoundingClientRect(); const box = body.getBoundingClientRect();
      const cut = cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      return { n: cards.length, wide, cut, side: body.scrollWidth <= body.clientWidth + 1, scrolls: moved && body.scrollHeight > body.clientHeight, lastIn: last.top >= box.top - 1 && last.bottom <= box.bottom + 1, btn: Math.round(b.height) }; });
    check('las diez tarjetas entran en el ancho, nada se corta de costado, y deslizando se llega a la última', m.n === 10 && m.wide === 0 && m.cut === 0 && m.side && m.scrolls && m.lastIn && m.btn >= 36, m);
    await ctx.close();
  });
});

// ---------- Claro y oscuro desde la barra, en la web ----------
await suite('theme', async () => {
  await step('Tema: el botón de la barra y su atajo, con el dispositivo en oscuro', async () => {
    const { ctx, page } = await open();
    await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const r = document.documentElement; window.__first = r.style.colorScheme + ' ' + r.style.getPropertyValue('--lmd-boot-bg'); }); });
    await note(page, 'tema.md', '# Tema\n\nUn párrafo.\n');
    const at = () => page.evaluate(() => { const b = document.querySelector('.lmd-topbar [data-act=theme-flip]'); return { dark: document.documentElement.classList.contains('lmd-dark'), title: b.title, name: b.getAttribute('aria-label'), shown: !!b.offsetParent, said: document.querySelector('.lmd-status').textContent, first: window.__first }; });
    const a = await at();
    check('con el dispositivo en oscuro arranca oscuro, y el botón está a la vista con su nombre y su atajo', a.dark && a.shown && a.name === 'Switch to light' && /^Switch to light \(Alt\+Shift\+T\)$/.test(a.title) && a.first === 'dark #121418', a);
    await page.click('.lmd-topbar [data-act=theme-flip]'); await sleep(350);
    const b = await at();
    check('un clic pasa a claro, lo avisa y queda guardado como claro', !b.dark && b.name === 'Switch to dark' && b.said === 'Light theme' && (await stored(page, 'settings')).theme === 'light', b);
    await page.reload(); await page.waitForSelector('.lmd-article > *'); await sleep(300);
    const c = await at();
    check('al recargar el primer cuadro ya sale claro, sin pasar por el oscuro del dispositivo', !c.dark && /^(only light|light only) #fbfaf7$/.test(c.first), c);
    await page.keyboard.press('Alt+Shift+T'); await sleep(350);
    const d = await at();
    check('Alt+Shift+T hace lo mismo', d.dark && d.said === 'Dark theme' && (await stored(page, 'settings')).theme === 'dark', d);
    await ctx.close();
  });
});

check('ninguna página tiró errores', R.errors.length === 0, R.errors.slice(0, 5));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
