// Ajustes > Plugins: los interruptores en dos columnas con el detalle angosto al costado, sin deslizar, y el ejemplo de
// cada plugin, dibujado por el motor de la app: lo que se escribe, y cómo se ve apagado y prendido. También en pantalla chica.
//   BROWSER=firefox node plugins.mjs      BROWSER=webkit node plugins.mjs      (sin BROWSER: chromium)
import { rig, tally, sleep } from './rig.mjs';

const ENGINE = process.env.BROWSER || 'chromium';
const R = await rig({}, ENGINE);
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, lang]) => { try { if (localStorage.getItem('plug:listo')) return; localStorage.setItem('plug:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en']);
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
  await page.evaluate(() => LMD.store.notePut('nota.md', '# Una nota\n\nTexto de la nota, sin nada especial.\n'));
  await page.goto(R.home + '?f=' + encodeURIComponent('local/nota.md')); await page.waitForSelector('.lmd-article > *'); await sleep(350);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: ENGINE !== 'firefox' };
const stored = (page) => page.evaluate(() => localStorage.getItem('mdtools:settings'));
const plugTab = async (page) => { await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.evaluate(() => document.querySelector('[data-ptab=plug]').click()); await page.waitForSelector('.lmd-plg-row'); await sleep(250); };
// Las librerías que se piden en diferido: cuáles están ya en la página.
const libs = (page) => page.evaluate(() => ({ katex: !!window.katex, mermaid: !!window.mermaid, graphviz: !!window.Viz, hljs: !!window.hljs, emoji: !!window.markdownitEmoji, files: [...document.scripts].map((s) => s.src.split('/').pop()).filter((f) => /katex|mermaid|viz-global|highlight|markdown-it-emoji/.test(f)).sort().join() }));
const side = (page) => page.evaluate(() => { const s = document.querySelector('.lmd-tl-side'); const body = document.querySelector('.lmd-panel-body'); const r = s.getBoundingClientRect(); const b = body.getBoundingClientRect(); const card = document.querySelector('.lmd-panel-card').getBoundingClientRect(); const sb = s.querySelector('.lmd-tl-side-body'); const ex = s.querySelector('.lmd-plg-ex'); const f = document.activeElement;
  const part = (id) => { const p = s.querySelector('[data-pg=' + id + ']'); return { label: p.querySelector('h5 span').textContent, mine: !p.querySelector('.lmd-plg-now').hidden, html: (p.querySelector('.lmd-plg-out') || p.querySelector('code')).innerHTML, text: (p.querySelector('.lmd-plg-out') || p.querySelector('code')).textContent }; };
  return { open: !s.hidden, plug: s.dataset.plug || '', role: s.getAttribute('role'), named: (document.getElementById(s.getAttribute('aria-labelledby')) || {}).textContent || '', name: s.querySelector('h4').textContent, help: s.querySelector('.lmd-tl-about').textContent, on: s.querySelector('[data-tl-side=on]').checked,
    ex: { role: ex.getAttribute('role'), label: ex.getAttribute('aria-label'), live: ex.getAttribute('aria-live') }, src: part('src'), off: part('off'), onPart: part('on'), wait: !s.querySelector('.lmd-plg-wait').hidden, back: !!s.querySelector('.lmd-tl-back').offsetParent, inside: s.contains(f),
    beside: !s.hidden && Math.abs(r.left - b.right) <= 1 && Math.abs(r.top - b.top) <= 1 && Math.abs(r.right - card.right) <= 2 && r.width >= 280 && r.width <= 320 && b.width > r.width, whole: !s.hidden && Math.abs(r.width - b.width) <= 1 && Math.abs(r.left - b.left) <= 1,
    split: document.querySelector('.lmd-panel-card').classList.contains('lmd-tl-split'), inertAll: document.querySelector('[data-tab=plug] .lmd-plug').inert,
    tabbable: [...sb.querySelectorAll('.lmd-plg-out a, .lmd-plg-out button, .lmd-plg-out input, .lmd-plg-out summary, .lmd-plg-out [tabindex]')].filter((n) => n.tabIndex >= 0).length, ids: [...sb.querySelectorAll('.lmd-plg-out [id]')].filter((n) => !n.closest('svg')).length, handlers: [...sb.querySelectorAll('.lmd-plg-out *')].filter((n) => [...n.attributes].some((a) => /^on/i.test(a.name))).length,
    wide: getComputedStyle(sb).overflowX !== 'hidden' || [...sb.querySelectorAll('.lmd-tl-about, .lmd-plg-part, .lmd-plg-part h5, .lmd-plg-out > *, .lmd-plg-src')].some((n) => n.offsetParent && n.getBoundingClientRect().right > sb.getBoundingClientRect().left + sb.clientWidth + 0.5) }; });
const grid = (page) => page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const card = document.querySelector('.lmd-panel-card').getBoundingClientRect();
  return JSON.stringify({ rows: [...document.querySelectorAll('.lmd-plg-row')].map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.plug, r.left, r.top, r.width, r.height].join(' '); }), top: body.scrollTop, tall: body.scrollHeight, dialog: [card.left, card.top, card.width, card.height].join(' ') }); });
const reach = (page) => page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const bad = [];
  [...document.querySelectorAll('.lmd-plg-row')].forEach((c) => { c.scrollIntoView({ block: 'nearest' }); const r = c.getBoundingClientRect(); const b = body.getBoundingClientRect(); const sw = c.querySelector('.lmd-switch').getBoundingClientRect();
    if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.right > b.left + body.clientWidth + 1 || !c.contains(document.elementFromPoint(r.left + 20, r.top + r.height / 2)) || !c.contains(document.elementFromPoint(sw.left + sw.width / 2, sw.top + sw.height / 2))) bad.push(c.dataset.plug); });
  const out = { bad, scrolls: body.scrollHeight > body.clientHeight, side: body.scrollWidth <= body.clientWidth + 1 }; body.scrollTop = 0; return out; });
// Sin deslizar nada: la lista no tiene scroll y cada fila, con su nombre entero, está dentro de la zona visible.
const fits = (page) => page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const b = body.getBoundingClientRect(); const rows = [...document.querySelectorAll('.lmd-plg-row')]; const heads = [...document.querySelectorAll('.lmd-plug-group h4')];
  return { n: rows.length, extra: body.scrollHeight - body.clientHeight, top: body.scrollTop, out: rows.concat(heads).filter((c) => { const r = c.getBoundingClientRect(); return r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left || r.right > b.left + body.clientWidth + 0.5; }).map((c) => c.dataset.plug || c.textContent), cut: rows.filter((c) => { const n = c.querySelector('[data-plug-pick] span'); return n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > c.querySelector('.lmd-switch').getBoundingClientRect().left; }).map((c) => c.dataset.plug), side: Math.round(document.querySelector('.lmd-tl-side').getBoundingClientRect().width), cols: new Set(rows.map((c) => Math.round(c.getBoundingClientRect().left))).size, heads: heads.length }; });
const choose = async (page, k) => { await page.evaluate((x) => { const r = document.querySelector('.lmd-plg-row[data-plug=' + x + ']'); r.scrollIntoView({ block: 'nearest' }); r.querySelector('[data-plug-pick]').click(); }, k); await until(() => page.evaluate((x) => document.querySelector('.lmd-tl-side').dataset.plug === x && document.querySelector('.lmd-plg-wait').hidden, k)); await sleep(60); };
const KEYS = ['sub', 'sup', 'ins', 'mark', 'abbr', 'emoji', 'typographer', 'tasklists', 'deflist', 'footnote', 'alerts', 'containers', 'tables', 'highlight', 'copyCode', 'katex', 'mermaid', 'graphviz', 'wikilinks', 'linkify', 'imageViewer', 'toc', 'frontmatter', 'html', 'breaks'];

await step('Plugins: dos columnas de interruptores con el detalle al costado', async () => {
  const { ctx, page } = await open();
  await plugTab(page);
  const list = await page.evaluate(() => { const box = document.querySelector('[data-tab=plug] .lmd-plug'); const rows = [...box.querySelectorAll('.lmd-plg-row')];
    return { keys: rows.map((r) => r.dataset.plug), known: Object.keys(LMD.PLUGIN_LABELS).length, samples: Object.keys(LMD.PLUGIN_LABELS).filter((k) => !LMD.PLUGIN_SAMPLES[k] || !LMD.PLUGIN_HELP[k]), groups: [...box.querySelectorAll('.lmd-plug-group')].map((g) => g.querySelector('h4').textContent + ':' + g.querySelectorAll('[data-plugin]').length).join('|'),
      cols: new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left) + ':' + Math.round(r.getBoundingClientRect().width))).size, each: rows.every((r) => r.querySelectorAll('[data-plugin]').length === 1 && r.querySelector('[data-plug-pick]').tagName === 'BUTTON' && r.querySelector('[data-plug-pick]').textContent.trim() === LMD.t(LMD.PLUGIN_LABELS[r.dataset.plug]) && r.querySelector('[data-plugin]').getAttribute('aria-label') === LMD.t(LMD.PLUGIN_LABELS[r.dataset.plug])),
      tips: box.querySelectorAll('[data-tip]').length, low: Math.min(...rows.map((r) => r.getBoundingClientRect().height)), high: Math.max(...rows.map((r) => r.getBoundingClientRect().height)) }; });
  check('los veinticinco plugins, cada uno con su interruptor, su explicación y su ejemplo, en cinco bloques y dos columnas', J(list.keys) === J(KEYS) && list.known === 25 && list.samples.length === 0 && list.groups === 'Text:7|Blocks:6|Code and math:5|Links and media:3|Behavior:4' && list.cols === 2 && list.each, list);
  check('filas cortas, sin el globo de explicación de antes', list.tips === 0 && list.low >= 28 && list.high <= 48, list);
  const s0 = await side(page);
  check('al entrar el detalle ya está al costado, con el primer plugin', s0.open && s0.beside && s0.split && s0.plug === 'sub' && s0.name === 'Subscript (H~2~O)' && s0.named === s0.name && s0.role === 'region' && !s0.back, s0);
  check('la explicación se lee en el detalle, y el ejemplo es una región con nombre que avisa sin interrumpir', s0.help === 'H~2~O shows the 2 as a subscript.' && s0.ex.role === 'region' && s0.ex.label === 'Example' && s0.ex.live === 'polite', s0);
  check('el ejemplo tiene tres piezas: lo que se escribe, apagado y prendido', s0.src.label === 'You write' && s0.src.text === 'H~2~O' && s0.off.label === 'Off' && s0.off.text.trim() === 'H~2~O' && s0.onPart.label === 'On' && /<sub>2<\/sub>/.test(s0.onPart.html) && !/<sub>/.test(s0.off.html), s0);
  check('y marca cuál de las dos es el ajuste de la persona', s0.on && s0.onPart.mine && !s0.off.mine, s0);
  // Elegir uno de los últimos: nada cambia de lugar
  await page.evaluate(() => document.querySelector('.lmd-plg-row[data-plug=breaks]').scrollIntoView({ block: 'nearest' })); await sleep(80);
  const g0 = await grid(page);
  await page.click('.lmd-plg-row[data-plug=breaks] [data-plug-pick]'); await sleep(250);
  const s1 = await side(page);
  check('elegir el último no mueve ninguna fila, ni el scroll, ni el diálogo, y el detalle pasa a él en el mismo lugar', (await grid(page)) === g0 && s1.plug === 'breaks' && s1.beside && /<br>/.test(s1.onPart.html) && !/<br>/.test(s1.off.html) && !s1.on && s1.off.mine && !s1.onPart.mine, s1);
  check('la fila elegida queda marcada, una sola, y sigue entera a la vista', await page.evaluate(() => { const now = [...document.querySelectorAll('.lmd-plg-row.lmd-tl-now')]; const cur = [...document.querySelectorAll('[data-plug-pick][aria-current=true]')]; const r = now[0].getBoundingClientRect(); const s = document.querySelector('.lmd-tl-side').getBoundingClientRect(); return now.length === 1 && cur.length === 1 && now[0].dataset.plug === 'breaks' && r.right <= s.left && now[0].contains(document.elementFromPoint(r.left + 20, r.top + r.height / 2)); }));
  // El interruptor de la fila y el del detalle
  const before = JSON.parse(await stored(page)).plugins || {};
  await page.click('.lmd-plg-row[data-plug=breaks] .lmd-switch'); await sleep(400);
  const s2 = await side(page); const mid = JSON.parse(await stored(page)).plugins;
  check('el interruptor de la fila prende el plugin, y la marca del ajuste pasa a Prendido', mid.breaks === true && before.breaks !== true && s2.on && s2.onPart.mine && !s2.off.mine && s2.plug === 'breaks', [s2, mid.breaks]);
  check('y la nota abierta se redibuja con el plugin, sin que el ejemplo la toque', await page.evaluate(() => /Texto de la nota/.test(document.querySelector('.lmd-article').textContent) && !document.querySelector('.lmd-article .lmd-plg-out')));
  await page.click('.lmd-tl-side .lmd-tl-side-head .lmd-switch'); await sleep(400);
  const s3 = await side(page);
  check('el interruptor del detalle es el mismo: lo apaga, y la fila lo muestra', JSON.parse(await stored(page)).plugins.breaks === false && !s3.on && s3.off.mine && await page.evaluate(() => !document.querySelector('.lmd-plg-row[data-plug=breaks] [data-plugin]').checked), s3);
  // Teclado
  await page.focus('.lmd-plg-row[data-plug=sub] [data-plugin]'); await sleep(150);
  check('llegar a un interruptor con el teclado muestra el ejemplo de ese plugin', (await side(page)).plug === 'sub');
  const keys = [];
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home']) { await page.keyboard.press(k); await sleep(130); keys.push(await page.evaluate(() => { const a = document.activeElement; const r = a.closest('.lmd-plg-row'); return (r ? r.dataset.plug : '?') + '>' + document.querySelector('.lmd-tl-side').dataset.plug; })); }
  check('arriba y abajo, Inicio y Fin pasan de fila en fila, de un bloque al siguiente, y el detalle las sigue', J(keys) === J(['sup>sup', 'ins>ins', 'sup>sup', 'breaks>breaks', 'sub>sub']), keys);
  const lr = [];
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); await sleep(130); lr.push(await page.evaluate(() => { const a = document.activeElement; const r = a.closest('.lmd-plg-row'); const first = document.querySelector('.lmd-plg-row[data-plug=sub]').getBoundingClientRect(); const me = r.getBoundingClientRect(); return (me.left > first.left + 20 ? 'der' : 'izq') + ':' + (Math.abs(me.top - first.top) < 30) + ':' + (document.querySelector('.lmd-tl-side').dataset.plug === r.dataset.plug) + ':' + a.matches('[data-plugin]'); })); }
  check('derecha e izquierda pasan a la fila de la otra columna que está a la misma altura', J(lr) === J(['der:true:true:true', 'der:true:true:true', 'izq:true:true:true', 'izq:true:true:true']), lr);
  const tabs = [];
  await page.focus('.lmd-plg-row[data-plug=mark] [data-plug-pick]');
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Tab'); tabs.push(await page.evaluate(() => { const a = document.activeElement; const r = a.closest('.lmd-plg-row'); return r ? r.dataset.plug + (a.matches('[data-plugin]') ? ':switch' : ':row') : a.closest('.lmd-tl-side') ? 'detail' : 'out'; })); }
  check('Tab va de la fila a su interruptor y de ahí al detalle, sin pasar por las demás filas', J(tabs) === J(['mark:switch', 'detail']), tabs);
  const r800 = await reach(page);
  await page.setViewportSize({ width: 1280, height: 720 }); await sleep(250);
  const r720 = await reach(page);
  check('a 800 y a 720 de alto de ventana todas las filas se ven sin deslizar la lista, con el detalle al costado', r800.bad.length === 0 && r800.side && !r800.scrolls && r720.bad.length === 0 && !r720.scrolls && r720.side && (await side(page)).beside, [r800, r720]);
  // Otra pestaña y volver; Escape
  await page.click('[data-ptab=look]'); await sleep(150);
  const away = await page.evaluate(() => ({ side: [...document.querySelectorAll('.lmd-tl-side')].every((s) => s.hidden), split: document.querySelector('.lmd-panel-card').classList.contains('lmd-tl-split') }));
  await page.click('[data-ptab=plug]'); await sleep(250);
  const back = await side(page);
  check('en otra pestaña el detalle no queda a la vista; al volver está, con el último plugin que se miró', away.side && !away.split && back.beside && back.plug === 'mark' && (await page.evaluate(() => document.querySelectorAll('.lmd-tl-side').length)) === 1, [away, back]);
  await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); await sleep(200);
  check('Herramientas y Plugins comparten el lugar del detalle: uno solo a la vez', await page.evaluate(() => document.querySelectorAll('.lmd-tl-side').length === 1 && !!document.querySelector('.lmd-tl-side').dataset.tool && !document.querySelector('.lmd-tl-side .lmd-plg-ex')));
  await page.click('[data-ptab=plug]'); await sleep(250);
  await page.keyboard.press('Escape'); await sleep(200);
  check('Escape cierra los ajustes de una', await page.evaluate(() => document.querySelector('.lmd-panel').hidden));
  check('y nada de esto es un error', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('Plugins: los veinticinco entran sin deslizar, en los dos idiomas', async () => {
  // El tamaño de la ventana, no el del diálogo: 1280x720 da el diálogo de 1000 por 680, y 1000x680 el de 960 por 640.
  const bad = []; const seen = [];
  for (const vp of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 1000, height: 680 }]) for (const lang of ['es', 'en']) {
    const { ctx, page } = await open({ ctx: { viewport: vp }, lang });
    await plugTab(page); await sleep(200);
    const f = await fits(page); const tag = vp.width + 'x' + vp.height + ' ' + lang; const s = await side(page);
    seen.push(tag + ': sobra ' + (-f.extra) + ', detalle ' + f.side);
    if (f.n !== 25 || f.heads !== 5 || f.extra > 0 || f.top !== 0 || f.out.length || f.cut.length || f.cols !== 2 || f.side < 280 || f.side > 320 || !s.beside || s.wide) bad.push([tag, f, s.wide]);
    await ctx.close();
  }
  check('a 1280x720, 1280x800, 1024x700 y 1000x680 de ventana, en español y en inglés, los veinticinco interruptores y sus cinco títulos se ven enteros sin deslizar, en dos columnas, con el detalle de entre 280 y 320 px', bad.length === 0 && seen.length === 8, bad.length ? bad : seen);
});

await step('Plugins: pasar el cursor no descarga nada pesado; quedarse o hacer clic, sí', async () => {
  const { ctx, page } = await open();
  await plugTab(page);
  const l0 = await libs(page); const set0 = await stored(page); const note0 = await page.evaluate(() => document.querySelector('.lmd-article').innerHTML);
  check('antes de mirar nada, las librerías pesadas no están', !l0.katex && !l0.mermaid && !l0.graphviz && !l0.hljs && !l0.emoji && l0.files === '', l0);
  // El cursor pasa por toda la lista, sin quedarse en ninguna
  const seen = [];
  for (const k of KEYS) { await page.evaluate((x) => document.querySelector('.lmd-plg-row[data-plug=' + x + ']').scrollIntoView({ block: 'nearest' }), k); await page.hover('.lmd-plg-row[data-plug=' + k + ']', { position: { x: 24 + (seen.length % 6) * 9, y: 8 + (seen.length % 4) * 5 } }); await sleep(200); seen.push(await page.evaluate(() => document.querySelector('.lmd-tl-side').dataset.plug)); }
  await page.mouse.move(4, 4); await sleep(1000);
  const l1 = await libs(page);
  check('pasar el cursor muestra el ejemplo de cada plugin', J(seen) === J(KEYS), seen);
  check('y recorrer toda la lista así no descarga ninguna librería', J(l1) === J(l0), l1);
  // Quedarse en uno pesado: primero lo escrito y un aviso discreto, después el dibujo
  await page.evaluate(() => document.querySelector('.lmd-plg-row[data-plug=katex]').scrollIntoView({ block: 'nearest' })); await page.hover('.lmd-plg-row[data-plug=katex] [data-plug-pick]'); await sleep(250);
  const k0 = await side(page);
  check('al llegar a un plugin pesado se ve lo escrito y un aviso de carga', k0.plug === 'katex' && k0.wait && /E = mc\^2/.test(k0.onPart.text) && !/class="katex"/.test(k0.onPart.html) && /\$E = mc\^2\$/.test(k0.off.text), k0);
  await until(() => page.evaluate(() => document.querySelector('.lmd-plg-wait').hidden), 15000);
  const k1 = await side(page); const l2 = await libs(page);
  check('si el cursor se queda, la fórmula se dibuja con KaTeX y el aviso se va; lo demás sigue sin descargarse', l2.katex && !l2.mermaid && !l2.graphviz && !k1.wait && /class="katex/.test(k1.onPart.html) && !/class="katex/.test(k1.off.html), [l2, k1.wait]);
  // Con un clic, ya
  await page.click('.lmd-plg-row[data-plug=mermaid] [data-plug-pick]');
  await until(() => page.evaluate(() => !!document.querySelector('[data-pg=on] .lmd-plg-out svg')), 20000);
  const m1 = await side(page);
  check('un clic en un plugin pesado lo dibuja sin esperar: el diagrama, con el código al lado como se ve apagado', (await libs(page)).mermaid && /<svg/.test(m1.onPart.html) && !/<svg/.test(m1.off.html) && /graph LR/.test(m1.off.text) && !m1.wait && !m1.wide, [m1.wait, m1.wide]);
  await page.hover('.lmd-plg-row[data-plug=katex] [data-plug-pick]'); await sleep(350);
  const k2 = await side(page);
  check('ya cargada, la librería dibuja directo al pasar el cursor', k2.plug === 'katex' && !k2.wait && /class="katex/.test(k2.onPart.html), k2.wait);
  // Con el foco dentro del detalle, el cursor no cambia de plugin: ahí manda el clic
  await page.focus('.lmd-tl-side [data-tl-side=on]');
  await page.hover('.lmd-plg-row[data-plug=sub]', { position: { x: 30, y: 10 } }); await sleep(400);
  const held = (await side(page)).plug;
  await page.click('.lmd-plg-row[data-plug=sub] [data-plug-pick]'); await sleep(250);
  const clicked = (await side(page)).plug;
  await page.hover('.lmd-plg-row[data-plug=mark]', { position: { x: 30, y: 10 } }); await sleep(400);
  check('con el foco en el detalle el cursor no cambia de plugin; un clic sí, y después el detalle vuelve a seguir al cursor', held === 'katex' && clicked === 'sub' && (await side(page)).plug === 'mark', [held, clicked, (await side(page)).plug]);
  // Cruzar filas de pasada, camino al detalle, no elige ninguna
  const pts = await page.evaluate(() => { const p = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }; return [p('.lmd-plg-row[data-plug=sub]'), p('.lmd-plg-row[data-plug=highlight]'), p('.lmd-tl-side .lmd-tl-about')]; });
  await page.mouse.move(pts[0].x - 5, pts[0].y); await page.mouse.move(pts[0].x, pts[0].y); await sleep(300);
  await page.mouse.move(pts[1].x, pts[1].y, { steps: 6 }); await page.mouse.move(pts[2].x, pts[2].y, { steps: 6 }); await sleep(350);
  check('cruzar la otra columna de pasada, camino al detalle, no cambia de plugin, y al salir de la lista queda el último', (await side(page)).plug === 'sub', (await side(page)).plug);
  // Los veinticinco, uno por uno
  await page.mouse.move(4, 4); await sleep(200);
  const bad = []; const table = [];
  for (const k of KEYS) {
    await choose(page, k); const s = await side(page);
    table.push(k + ': ' + s.src.text.replace(/\n/g, ' / '));
    if (s.plug !== k || !s.src.text || s.off.html === s.onPart.html || !s.off.html.trim() || !s.onPart.html.trim() || s.wait || s.tabbable || s.ids || s.handlers || s.wide || s.src.text !== await page.evaluate((x) => LMD.t(LMD.PLUGIN_SAMPLES[x]), k)) bad.push([k, { same: s.off.html === s.onPart.html, wait: s.wait, tabbable: s.tabbable, ids: s.ids, handlers: s.handlers, wide: s.wide, off: s.off.html.slice(0, 200), on: s.onPart.html.slice(0, 200) }]);
  }
  check('cada uno de los veinticinco tiene su ejemplo, y apagado y prendido dan un resultado distinto', bad.length === 0 && table.length === 25, bad.length ? bad : table);
  console.log('    ' + table.join('\n    '));
  await choose(page, 'highlight'); const hl = await side(page);
  await choose(page, 'copyCode'); const cc = await side(page);
  await choose(page, 'graphviz'); const gv = await side(page);
  await choose(page, 'emoji'); const em = await side(page);
  await choose(page, 'tasklists'); const tk = await side(page);
  await choose(page, 'alerts'); const al = await side(page);
  await choose(page, 'frontmatter'); const fm = await side(page);
  await choose(page, 'imageViewer'); const iv = await side(page);
  check('los dibuja el motor de la app: color en el código, botón de copiar, grafo, emoji, casillas, aviso, ficha', /hljs-keyword/.test(hl.onPart.html) && !/hljs-keyword/.test(hl.off.html) && /lmd-code-copy/.test(cc.onPart.html) && !/lmd-code-copy/.test(cc.off.html) && /<svg/.test(gv.onPart.html) && /🚀/.test(em.onPart.text) && /:rocket:/.test(em.off.text) && /lmd-task/.test(tk.onPart.html) && /\[x\]/.test(tk.off.text) && /lmd-alert/.test(al.onPart.html) && /lmd-front/.test(fm.onPart.html) && !/lmd-front/.test(fm.off.html), [hl.onPart.html.slice(0, 120), em.onPart.text]);
  check('la imagen del ejemplo se ve (el ícono de la app) y prendido queda lista para ampliar', /lmd-zoomable/.test(iv.onPart.html) && !/lmd-zoomable/.test(iv.off.html) && iv.src.text === '![The app icon](icon.png)' && await page.evaluate(async () => { const i = document.querySelector('[data-pg=on] .lmd-plg-out img'); if (!i.complete) await new Promise((r) => { i.onload = r; i.onerror = r; }); return i.naturalWidth > 0; }), iv.onPart.html);
  // Mirar ejemplos no cambia nada guardado ni la nota abierta
  check('mirar los ejemplos no cambia los ajustes guardados', (await stored(page)) === set0);
  check('ni la nota abierta', (await page.evaluate(() => document.querySelector('.lmd-article').innerHTML)) === note0);
  check('y nada de esto es un error', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('Plugins: el ejemplo de HTML pasa por el mismo saneado que la nota', async () => {
  const { ctx, page } = await open();
  await plugTab(page);
  await choose(page, 'html'); const h = await side(page);
  check('prendido respeta el HTML escrito; apagado lo deja como texto', /<kbd>Ctrl<\/kbd>/.test(h.onPart.html) && !/<kbd>/.test(h.off.html) && /<kbd>Ctrl<\/kbd>/.test(h.off.text) && h.handlers === 0, h.onPart.html);
  // Un texto hostil por el mismo camino que usa el ejemplo: ni scripts ni manejadores ni direcciones que ejecutan
  const evil = '<img src="x" onerror="window.__pwn = 1"> <script>window.__pwn = 2</script> <a href="javascript:window.__pwn=3" onclick="window.__pwn = 4">enlace</a> <svg onload="window.__pwn = 5"><circle r="4"/></svg> <iframe src="javascript:window.__pwn=6"></iframe> <form action="/x"><input name="a"></form> <style>body{display:none}</style> <kbd>bien</kbd>';
  const out = await page.evaluate(async (t) => {
    const a = LMD.plugSample.draw(t, { html: true }); const b = await LMD.plugSample.full(t, { html: true });
    document.querySelector('[data-pg=on] .lmd-plg-out').appendChild(a); document.querySelector('[data-pg=off] .lmd-plg-out').appendChild(b);
    await new Promise((r) => setTimeout(r, 400));
    const bad = (n) => [...n.querySelectorAll('*')].filter((x) => [...x.attributes].some((at) => /^on/i.test(at.name) || /^\s*javascript:/i.test(at.value))).length + n.querySelectorAll('script, iframe, form, style').length;
    const link = a.querySelector('a'); if (link) link.click();
    await new Promise((r) => setTimeout(r, 200));
    return { html: a.innerHTML, bad: bad(a) + bad(b), kbd: !!a.querySelector('kbd'), pwn: window.__pwn, shown: getComputedStyle(document.body).display };
  }, evil);
  check('un onerror, un script, un javascript:, un onclick, un iframe, un form o un style no pasan, y nada se ejecuta', out.bad === 0 && out.kbd && out.pwn === undefined && out.shown !== 'none' && !/onerror|onclick|onload|<script|javascript:/i.test(out.html), out);
  check('y nada de esto es un error', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('Plugins: en el teléfono, tocar la fila abre el ejemplo con Back', async () => {
  const { ctx, page } = await open({ ctx: SMALL });
  await plugTab(page);
  const s0 = await side(page);
  const m = await page.evaluate(() => { const rows = [...document.querySelectorAll('.lmd-plg-row')]; const body = document.querySelector('.lmd-panel-body'); return { n: rows.length, wide: rows.filter((r) => r.getBoundingClientRect().right > innerWidth + 0.5 || r.getBoundingClientRect().left < 0).length, low: Math.min(...rows.map((r) => r.getBoundingClientRect().height)), side: body.scrollWidth <= body.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, go: rows.every((r) => { const g = r.querySelector('[data-plug-pick] svg'); return !!g && getComputedStyle(g).display !== 'none'; }) }; });
  const r = await reach(page);
  check('al entrar se ve la lista sola: las veinticinco filas entran en el ancho, de 40 px o más, y cada una muestra que se puede abrir', !s0.open && !s0.split && m.n === 25 && m.wide === 0 && m.low >= 40 && m.side && m.go && r.bad.length === 0, [m, r]);
  const set0 = await stored(page);
  await page.tap('.lmd-plg-row[data-plug=mark] .lmd-switch'); await sleep(400);
  const t1 = await side(page);
  check('el interruptor de la fila anda sin abrir nada', !t1.open && JSON.parse(await stored(page)).plugins.mark === false && (await stored(page)) !== set0, t1.open);
  await page.tap('.lmd-plg-row[data-plug=mark] .lmd-switch'); await sleep(300);
  await page.evaluate(() => { document.querySelector('.lmd-panel-body').scrollTop = 60; }); await sleep(80);
  const g0 = await grid(page);
  await page.tap('.lmd-plg-row[data-plug=abbr] [data-plug-pick]'); await sleep(350);
  const t2 = await side(page);
  check('tocar la fila abre su ejemplo sobre toda la zona de contenido, con Back y las tres piezas, sin scroll de costado', t2.open && t2.whole && t2.back && t2.plug === 'abbr' && t2.inertAll && t2.inside && /<abbr/.test(t2.onPart.html) && !/<abbr/.test(t2.off.html) && !t2.wide && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), t2);
  await page.tap('.lmd-tl-side .lmd-tl-back'); await sleep(250);
  check('Back vuelve a la lista, que no se movió, con el foco en esa fila', !(await side(page)).open && (await grid(page)) === g0 && await page.evaluate(() => document.activeElement === document.querySelector('.lmd-plg-row[data-plug=abbr] [data-plug-pick]')));
  await page.tap('.lmd-plg-row[data-plug=mermaid] [data-plug-pick]');
  await until(() => page.evaluate(() => !!document.querySelector('[data-pg=on] .lmd-plg-out svg')), 20000); await sleep(200);
  const t3 = await side(page);
  check('un diagrama entra en el ancho del teléfono', t3.open && /<svg/.test(t3.onPart.html) && !t3.wide && (await page.evaluate(() => { const b = document.querySelector('.lmd-tl-side-body'); const s = document.querySelector('[data-pg=on] .lmd-plg-out svg').getBoundingClientRect(); return s.right <= b.getBoundingClientRect().right + 1 && s.width > 40; })), t3.wide);
  check('y nada de esto es un error', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('Plugins: ventana angosta, español y movimiento reducido', async () => {
  const { ctx, page } = await open({ ctx: { viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' }, lang: 'es' });
  await plugTab(page);
  await page.click('.lmd-plg-row[data-plug=alerts] [data-plug-pick]'); await sleep(300);
  const s = await side(page);
  check('a 900 de ancho el ejemplo se abre encima de la lista, con Volver y en español', s.open && s.whole && s.back && s.inertAll && s.src.label === 'Escribís' && s.off.label === 'Apagado' && s.onPart.label === 'Prendido' && /Esto conviene tenerlo en cuenta/.test(s.src.text) && s.help === '> [!NOTE] y > [!WARNING] se ven como avisos de color.' && s.ex.label === 'Ejemplo', s);
  check('sin animación', await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-tl-side')).animationName === 'none'));
  await page.keyboard.press('Escape'); await sleep(200);
  check('ahí Escape vuelve a la lista, con los ajustes abiertos', !(await side(page)).open && await page.evaluate(() => !document.querySelector('.lmd-panel').hidden));
  const texts = await page.evaluate(() => [...document.querySelectorAll('[data-tab=plug], .lmd-tl-side')].map((n) => n.textContent).join(' ').replace(/\[!NOTE\]|\[!WARNING\]/g, ''));
  check('los textos no llevan signos de admiración', !/[!¡]/.test(texts), (texts.match(/.{20}[!¡].{20}/) || [''])[0]);
  await ctx.close();
});

check('ninguna página tiró errores', R.errors.length === 0, R.errors.slice(0, 5));
check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
