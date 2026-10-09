// El teléfono con el teclado en pantalla abierto (390x844 y 360x780, táctil): el teclado achica la zona visible sin
// achicar la página (window.visualViewport), y nada de lo que se abre puede quedar detrás. El menú de insertar, el del
// bloque y los contextuales son una hoja pegada arriba del teclado, de la mitad de lo visible como mucho y con scroll
// adentro; lo escrito después de "/" la filtra; atrás y un toque afuera la cierran. También: la manija del bloque en
// su lugar, los avisos a la vista cuando el pie está tapado, y las filas que se deslizan avisan que siguen.
import { rig, tally, sleep } from './rig.mjs';
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const KB = 320;
const NOTE = '# Launch plan\n\nWhat is left before we ship on Monday, in a paragraph long enough to wrap on a phone screen.\n\nSecond paragraph.\n\n```mermaid\ngraph LR\n  A[Start] --> B[End]\n```\n\n' + 'We track bookings per day.\n\n'.repeat(14);
const PHONE = { deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'light' };

const r = await rig();
try {
  const who = await r.signup('ana@ejemplo.test', true);
  await r.api('PUT', '/notes/' + encodeURIComponent('work/launch.md'), { text: NOTE }, who.s);
  const phone = async (w, h, tools) => {
    const { ctx, page } = await r.open(null, Object.assign({ viewport: { width: w, height: h } }, PHONE));
    await ctx.addInitScript(([url, u, t]) => {
      try {
        if (!localStorage.getItem('test:set')) {
          localStorage.setItem('test:set', '1');
          localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: url, theme: 'light', tools: t || {} }));
          localStorage.setItem('mdtools:cloud', JSON.stringify({ session: u.s, email: u.email, at: url }));
          localStorage.setItem('mdtools:dictation', JSON.stringify({ consent: 1 }));
        }
      } catch (e) { /* una página en blanco no tiene almacenamiento */ }
      // Un reconocedor de voz que no consigue permiso: lo que pasa en un navegador que no deja dictar.
      window.SpeechRecognition = window.webkitSpeechRecognition = function () { this.start = () => { setTimeout(() => { if (this.onerror) this.onerror({ error: 'not-allowed' }); if (this.onend) this.onend({}); }, 20); }; this.stop = () => {}; this.abort = () => {}; };
    }, [r.base, who, tools]);
    return { ctx, page };
  };
  // El teclado: la zona visible pierde alto desde abajo, como en Chrome y Samsung Internet en Android.
  const kbOpen = (page) => page.evaluate(async (h) => { const vv = window.visualViewport; const tall = window.innerHeight; Object.defineProperty(vv, 'height', { configurable: true, get: () => tall - h }); vv.dispatchEvent(new Event('resize')); await new Promise((res) => setTimeout(res, 200)); }, KB);
  const kbClose = (page) => page.evaluate(async () => { const vv = window.visualViewport; delete vv.height; vv.dispatchEvent(new Event('resize')); await new Promise((res) => setTimeout(res, 150)); });
  const menu = (page) => page.evaluate(() => {
    const m = document.querySelector('body > .lmd-menu'); if (!m) return null;
    const b = m.getBoundingClientRect(); const v = window.visualViewport; const a = document.querySelector('.lmd-draft') || document.activeElement; const d = a && a.getBoundingClientRect ? a.getBoundingClientRect() : null;
    // En el orden en que se ven, de arriba abajo (la hoja reordena sus secciones).
    const at = (x) => { const q = x.getBoundingClientRect(); return q.top * 10000 + q.left; };
    const shown = [...m.querySelectorAll('button')].filter((x) => x.offsetParent).sort((x, y) => at(x) - at(y));
    const labels = [...m.querySelectorAll('.lmd-menu-label')].filter((x) => x.offsetParent).sort((x, y) => at(x) - at(y));
    return { sheet: m.classList.contains('lmd-sheet'), top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), visible: Math.round(v.height), scrolls: m.scrollHeight > m.clientHeight + 1, items: shown.map((x) => x.textContent), low: Math.min(...shown.map((x) => x.getBoundingClientRect().height)),
      draft: d ? Math.round(d.bottom) : null, label: labels.length ? labels[0].textContent : '' };
  });
  // Cada opción se puede traer a la vista deslizando la hoja, y queda arriba del teclado.
  const reach = (page) => page.evaluate(() => {
    const m = document.querySelector('body > .lmd-menu'); const v = window.visualViewport; const out = [];
    [...m.querySelectorAll('button')].filter((x) => x.offsetParent).forEach((b) => { b.scrollIntoView({ block: 'nearest' }); const q = b.getBoundingClientRect(); if (q.bottom > v.height + 0.5 || q.top < 0) out.push(b.textContent + ' ' + Math.round(q.bottom)); });
    m.scrollTop = 0; return out;
  });

  for (const [W, H] of [[390, 844], [360, 780]]) {
    console.log('Teléfono de ' + W + 'x' + H + ' con el teclado abierto');
    const tag = W + ': '; const seen = H - KB;
    const { ctx, page } = await phone(W, H, { dictate: true });
    await page.goto(r.home); await page.waitForSelector('.lmd-home [data-home=new]');
    await page.tap('[data-home=new]'); await page.waitForSelector('.lmd-draft');
    await page.evaluate(() => LMD.write.closeMenu()); await page.evaluate(() => document.querySelector('.lmd-draft').focus());
    await kbOpen(page);

    // ---------- "/" abre la hoja ----------
    await page.keyboard.type('/'); await sleep(300);
    const m1 = await menu(page);
    check(tag + 'el menú de insertar es una hoja a lo ancho, pegada arriba del teclado', m1 && m1.sheet && m1.bottom <= seen && m1.bottom >= seen - 12 && m1.left === 8 && m1.right === W - 8, m1);
    check(tag + 'ocupa la mitad de lo visible como mucho y el resto se desliza adentro', m1.bottom - m1.top <= Math.max(200, Math.round(seen / 2)) + 1 && m1.scrolls && m1.items.length >= 17, m1);
    check(tag + 'ninguna opción queda detrás del teclado: todas se alcanzan deslizando', J(await reach(page)) === '[]', await reach(page));
    check(tag + 'el renglón que se escribe queda a la vista arriba de la hoja, con la barra escrita', m1.draft <= m1.top && await page.evaluate(() => document.querySelector('.lmd-draft').textContent) === '/', m1);
    check(tag + 'cada opción tiene alto para el dedo', m1.low >= 42, m1.low);
    // ---------- Lo escrito filtra ----------
    await page.keyboard.type('ta'); await sleep(250);
    const m2 = await menu(page);
    check(tag + 'lo escrito después de la barra filtra, se ve en el renglón, y la hoja sigue pegada al teclado', J(m2.items) === J(['Task list', 'Table']) && m2.bottom <= seen && m2.bottom >= seen - 12 && await page.evaluate(() => document.querySelector('.lmd-draft').textContent) === '/ta', m2);
    await page.keyboard.type('b'); await sleep(200);
    check(tag + 'y se va achicando', J((await menu(page)).items) === J(['Table']), await menu(page));
    await page.keyboard.type('zz'); await sleep(200);
    check(tag + 'sin coincidencias la hoja se cierra y lo escrito queda', (await menu(page)) === null && await page.evaluate(() => document.querySelector('.lmd-draft').textContent) === '/tabzz');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace'); await sleep(250);
    check(tag + 'al borrar vuelve a abrirse con lo que coincide', J(((await menu(page)) || {}).items) === J(['Table']), await menu(page));
    await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-article table'); await sleep(300);
    check(tag + 'Enter elige la primera: queda la tabla y no queda la barra escrita', await page.evaluate(() => !document.querySelector('body > .lmd-menu') && !/\/tab/.test(document.querySelector('.lmd-article').textContent)));

    // ---------- Cerrar: afuera, Escape y atrás ----------
    await page.evaluate(() => document.querySelector('.lmd-add').click()); await sleep(300);
    const m3 = await menu(page);
    check(tag + '"Keep writing" abre la misma hoja', m3 && m3.sheet && m3.bottom <= seen, m3);
    await page.evaluate(() => document.querySelector('.lmd-topbar').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))); await sleep(300);
    check(tag + 'un toque afuera la cierra', (await menu(page)) === null, await page.evaluate(() => { const e = document.elementFromPoint(3, 100); return e.tagName + '.' + e.className; }));
    await page.evaluate(() => document.querySelector('.lmd-add').click()); await sleep(300);
    await page.keyboard.type('/'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
    check(tag + 'Escape la cierra y se lleva la barra', (await menu(page)) === null && await page.evaluate(() => { const d = document.querySelector('.lmd-draft'); return !d || d.textContent === ''; }));
    const url = page.url();
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more'); await page.evaluate(() => document.querySelector('.lmd-menu [data-more=insert]').click()); await sleep(350);
    check(tag + '"Insert a block" del menú "más" abre la hoja', ((await menu(page)) || {}).sheet === true, await menu(page));
    await page.goBack(); await sleep(400);
    check(tag + 'atrás del sistema la cierra sin salir de la nota', (await menu(page)) === null && page.url() === url, page.url());
    await kbClose(page);
    await ctx.close();

    // ---------- Una nota con contenido ----------
    const b = await phone(W, H, { dictate: true }); const p = b.page;
    await p.goto(r.noteUrl('work/launch.md', true)); await p.waitForSelector('.lmd-diagram svg'); await sleep(400);
    await p.tap('.lmd-article > p'); await sleep(350); await kbOpen(p);
    const hand = await p.evaluate(() => {
      const h = document.querySelector('.lmd-handle'); const a = document.activeElement; if (!h || h.hidden) return null;
      const q = h.getBoundingClientRect(); const k = a.getBoundingClientRect(); const cs = getComputedStyle(a); const lh = parseFloat(cs.lineHeight); const hit = getComputedStyle(h, '::before');
      return { mid: Math.round(q.top + q.height / 2), line: Math.round(k.top + lh / 2), right: Math.round(q.right), field: Math.round(k.left - 5), left: Math.round(q.left), hit: [parseFloat(hit.width), parseFloat(hit.height)] };
    });
    check(tag + 'la manija del bloque queda centrada en su primer renglón', hand && Math.abs(hand.mid - hand.line) <= 3, hand);
    check(tag + 'dentro del margen, sin tocar el borde del campo, con 44 px para el dedo', hand && hand.left >= 0 && hand.right <= hand.field - 3 && hand.hit[0] >= 44 && hand.hit[1] >= 44, hand);
    const hint = await p.evaluate(() => { const h = document.querySelector('.lmd-dct-hint'); return h && !h.hidden ? h.textContent : ''; });
    if (W === 390) check(tag + 'la primera vez que aparece el micrófono, una etiqueta dice para qué es', hint === 'Tap to dictate', hint);
    await p.evaluate(() => window.scrollTo(0, 0));
    // El último párrafo a la vista: abrir su menú no lo puede dejar tapado por la hoja.
    await p.evaluate(() => { const ps = [...document.querySelectorAll('.lmd-article > p.lmd-editable')]; const v = window.visualViewport.height; const low = ps.filter((x) => x.getBoundingClientRect().bottom < v - 20).pop(); low.focus(); low.click(); }); await sleep(350);
    await p.tap('.lmd-handle'); await sleep(450);
    const m4 = await menu(p);
    const blockBottom = await p.evaluate(() => { const h = document.querySelector('.lmd-menu'); const ps = [...document.querySelectorAll('.lmd-article > p')]; const top = h.getBoundingClientRect().top; return ps.filter((x) => x.getBoundingClientRect().bottom <= top + 1 && x.getBoundingClientRect().top >= 58).length; });
    check(tag + 'el menú del bloque también es una hoja arriba del teclado, y sigue abierta', m4 && m4.sheet && m4.bottom <= seen && m4.bottom - m4.top <= Math.max(200, Math.round(seen / 2)) + 1, m4);
    check(tag + 'en la hoja, lo del bloque (subir, duplicar, eliminar) va primero', m4 && m4.label === 'This block' && J(m4.items.slice(0, 4)) === J(['Move up', 'Move down', 'Duplicate', 'Delete']), m4 && [m4.label, m4.items.slice(0, 5)]);
    check(tag + 'y arriba de la hoja queda texto de la nota a la vista', blockBottom >= 1, blockBottom);
    await p.evaluate(() => document.querySelector('.lmd-topbar').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))); await sleep(250);

    // ---------- El menú "más", con el teclado abierto ----------
    await p.tap('.lmd-article > p'); await sleep(300);
    await p.tap('[data-act=more]'); await sleep(300);
    const more = await p.evaluate(() => { const m = document.querySelector('.lmd-menu-more'); const q = m.getBoundingClientRect(); return { top: Math.round(q.top), bottom: Math.round(q.bottom), scrolls: m.scrollHeight > m.clientHeight + 1, sheet: m.classList.contains('lmd-sheet'), items: [...m.querySelectorAll('button')].map((x) => x.textContent) }; });
    check(tag + 'el menú "más" entra en lo visible y lo que no entra se desliza', more.bottom <= seen - 8 + 1 && more.top >= 8 && !more.sheet && J(await reach(p)) === '[]', [more, await reach(p)]);
    check(tag + 'y suma dictar', more.items.includes('Dictate'), more.items);
    await p.touchscreen.tap(20, 200); await sleep(250);

    // ---------- Un diálogo con el teclado abierto ----------
    await p.evaluate(() => { const ps = [...document.querySelectorAll('.lmd-article > p.lmd-editable')]; ps[0].focus(); });
    await p.evaluate(() => document.querySelector('.lmd-add').scrollIntoView({ block: 'center' })); await sleep(300);
    await p.evaluate(() => document.querySelector('.lmd-add').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('.lmd-menu [data-ins=link]').click()); await p.waitForSelector('.lmd-ask'); await sleep(300);
    const dlg = await p.evaluate(() => { const c = document.querySelector('.lmd-ask > *').getBoundingClientRect(); return [Math.round(c.top), Math.round(c.bottom)]; });
    check(tag + 'un diálogo queda entero arriba del teclado', dlg[0] >= 0 && dlg[1] <= seen, dlg);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.lmd-ask button')].find((x) => /Cancel/.test(x.textContent)); if (b) b.click(); }); await sleep(250); if (await p.locator('.lmd-ask').count()) { await p.keyboard.press('Escape'); await sleep(250); }

    // ---------- Avisos con el pie tapado, y el micrófono ----------
    await p.tap('.lmd-article > p'); await sleep(400);
    const mic = await p.evaluate(() => { const m = document.querySelector('.lmd-dct-mic'); const h = document.querySelector('.lmd-dct-hint'); const q = m.getBoundingClientRect(); return { shown: !m.hidden, bottom: Math.round(q.bottom), size: [q.width, q.height], hint: h && !h.hidden ? h.textContent : '', foot: getComputedStyle(document.querySelector('.lmd-foot')).display }; });
    check(tag + 'el micrófono queda arriba del teclado, con 44 px', mic.shown && mic.bottom <= seen && mic.size[0] >= 44 && mic.size[1] >= 44 && mic.foot === 'none', mic);
    await p.tap('.lmd-dct-mic'); await p.waitForSelector('.lmd-flash-top', { timeout: 5000 }).catch(() => null);
    const said = await p.evaluate(() => { const t = document.querySelector('.lmd-flash-top'); const q = t ? t.getBoundingClientRect() : null; return t ? { text: t.textContent, top: Math.round(q.top), bottom: Math.round(q.bottom), busy: document.querySelector('.lmd-dct-mic').classList.contains('lmd-busy') } : null; });
    check(tag + 'si el navegador no deja dictar, tocar el micrófono lo dice a la vista (el pie está tapado) y el botón no queda trabado', said && said.text === 'The browser did not allow the microphone.' && said.top >= 56 && said.bottom <= seen && !said.busy, said);
    await kbClose(p);

    // ---------- Filas que se deslizan ----------
    await p.tap('[data-act=more]'); await sleep(250); await p.evaluate(() => document.querySelector('.lmd-menu [data-more=settings]').click()); await p.waitForSelector('.lmd-panel:not([hidden])'); await sleep(400);
    const tabs = () => p.evaluate(() => { const t = document.querySelector('.lmd-ptabs'); const on = t.querySelector('button.lmd-on').getBoundingClientRect(); return { r: t.classList.contains('lmd-more-r'), l: t.classList.contains('lmd-more-l'), mask: getComputedStyle(t).maskImage || getComputedStyle(t).webkitMaskImage, on: [Math.round(on.left), Math.round(on.right)], low: Math.min(...[...t.querySelectorAll('button')].map((x) => x.getBoundingClientRect().height)) }; });
    const t1 = await tabs();
    check(tag + 'las pestañas de Ajustes se desvanecen a la derecha: se nota que hay más', t1.r && !t1.l && /gradient/.test(t1.mask) && t1.low >= 40, t1);
    await p.evaluate(() => document.querySelector('.lmd-ptabs [data-ptab=adv]').click()); await sleep(500);
    const t2 = await tabs();
    check(tag + 'al elegir la última queda entera a la vista y el desvanecido pasa a la izquierda', t2.l && t2.on[0] >= 0 && t2.on[1] <= W, t2);
    await p.evaluate(() => document.querySelector('.lmd-ptabs [data-ptab=tools]').click()); await sleep(400);
    const sub = await p.evaluate(() => [...document.querySelectorAll('.lmd-subtabs button')].map((x) => Math.round(x.getBoundingClientRect().height)));
    check(tag + 'las sub-pestañas Tools y Community tienen 44 px', sub.length === 2 && sub.every((h) => h >= 44), sub);
    await p.evaluate(() => document.querySelector('[data-act=close-panel]').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('.lmd-diagram').click()); await p.waitForSelector('.lmd-dgm-svg svg'); await sleep(700);
    const add = await p.evaluate(() => { const row = document.querySelector('.lmd-dgm-add > div'); return { r: row.classList.contains('lmd-more-r'), over: row.scrollWidth > row.clientWidth, low: Math.min(...[...row.querySelectorAll('button')].map((x) => x.getBoundingClientRect().height)) }; });
    check(tag + 'en el editor de diagramas, la fila de piezas avisa que sigue', add.over ? add.r && add.low >= 40 : add.low >= 40, add);
    await b.ctx.close();
  }
  check('ninguna página dio error', r.errors.length === 0, r.errors.slice(0, 3));
  check('nada salió a la nube de verdad', r.outside.length === 0, r.outside.slice(0, 3));
} finally { await r.close(); }
process.exit(done() ? 1 : 0);
