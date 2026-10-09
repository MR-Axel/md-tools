// Diagramas explorables (Ajustes > Herramientas): apagada no cambia nada ni carga su archivo; prendida, un diagrama
// de flujo se recorre con el cursor, con el teclado y con el dedo, y los demás tipos se dibujan como siempre.
//   ONLY=fold node explore.mjs          (una parte: off, pick, links, view, fold, find, keys, full, edit, phone, look)
//   SHOTS=C:\tmp\capturas node explore.mjs      (deja capturas en esa carpeta)
import { rig, tally, sleep } from './rig.mjs';
import fs from 'fs'; import path from 'path';

const ONLY = process.env.ONLY || ''; const SHOTS = process.env.SHOTS || '';
const R = await rig({});
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, lang, tools, theme]) => { try { if (localStorage.getItem('xp:listo')) return; localStorage.setItem('xp:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify(Object.assign({ cloudUrl: base, language: lang, tools }, theme || {}))); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}, o.settings || null]);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ON = { explore: true };
const F = '```';
const MAP = ['# Map', '', 'Intro.', '', F + 'mermaid', 'flowchart LR', '  user([Person]) --> web[Web app]', '  web --> api[API]', '  subgraph back [Backend]', '    api --> db[(Database)]', '    api -- jobs --> queue[[Queue]]', '    queue --> worker[Worker]', '    worker --> db', '  end', '  worker --> mail[Email provider]',
  '  %% @web: The client. It only talks to the API.', '  %% @api: The single **entry point**.', '  %% @api: [[other]]', '  %% @api: [Notes section](#notes)', '  %% @api: [Runbook](https://example.com/runbook)', '  %% @db: See [the other note](other.md#one).', F, '',
  'Between.', '', F + 'mermaid', 'sequenceDiagram', '  A->>B: hi', F, '', ...Array.from({ length: 30 }, (_, k) => 'Line ' + (k + 1) + '.\n'), '## Notes', '', 'End.', ''].join('\n');
const OTHER = '# Other\n\n## One\n\nHello.\n';
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
const goHome = async (page) => { await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250); };
const put = (page, name, text) => page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
// Abre la nota del mapa; con la herramienta prendida espera a que el diagrama quede armado.
async function note(page, armed, text) {
  await goHome(page); await put(page, 'map.md', text || MAP); await put(page, 'other.md', OTHER);
  await page.goto(noteUrl('map.md')); await page.waitForSelector('.lmd-diagram svg');
  if (armed) await page.waitForSelector('.lmd-xp-stage g.lmd-xp-node');
  await sleep(350);
}
const st = (page, i) => page.evaluate((k) => (window.LMD && LMD.explore ? LMD.explore.state(k) : null), i || 0);
const scripts = (page, file) => page.evaluate((f) => [...document.scripts].filter((s) => s.src.split('/').pop() === f).length, file);
const stored = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('mdtools:settings')); } catch (e) { return null; } });
const toolsTab = async (page) => { await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); };
const closePanel = async (page) => { await page.click('[data-act=close-panel]'); await sleep(200); };
const node = (id) => '.lmd-xp-stage g.lmd-xp-node[data-xp-id="' + id + '"]';
const dim = (page, id) => page.evaluate((q) => +getComputedStyle(document.querySelector(q)).opacity, node(id));
const card = (page) => page.evaluate(() => {
  const c = document.querySelector('.lmd-xp-card'); if (!c || c.hidden) return null;
  const rel = [...c.querySelectorAll('.lmd-xp-rel')].map((r) => [...r.children].map((x) => x.textContent));
  return { title: c.querySelector('b').textContent, notes: [...c.querySelectorAll('.lmd-xp-note p')].map((p) => p.textContent), rel, links: [...c.querySelectorAll('.lmd-xp-note a')].map((a) => [a.textContent, a.getAttribute('href') || '', a.target]), reach: (c.querySelector('[data-xp=reach]') || {}).ariaPressed || '' };
});
const focusId = (page) => page.evaluate(() => { const a = document.activeElement; return !a ? '' : a.getAttribute('data-xp-id') || a.getAttribute('data-xp-group') || a.dataset.xp || a.className; });
// Lo que queda del diagrama cuando la herramienta no lo toca.
const bare = (page) => page.evaluate(() => { const b = document.querySelector('.lmd-diagram'); const s = b.querySelector(':scope > svg'); return { direct: !!s, xp: document.querySelectorAll('[class*="lmd-xp"]').length, tab: b.querySelectorAll('[tabindex]').length, html: s ? s.outerHTML.length : 0, nodes: b.querySelectorAll('g.node').length }; });

await step('off', 'Apagada: la nota se ve igual y su archivo no se pide', async () => {
  const { ctx, page } = await open();
  await note(page, false);
  const was = await bare(page);
  check('el diagrama es el de siempre: sin marco, sin barra, sin nada para enfocar', was.direct && was.xp === 0 && was.tab === 0 && was.nodes === 7, was);
  check('y su archivo no se bajó', await scripts(page, 'explore.js') === 0 && await page.evaluate(() => !LMD.explore));
  await page.click('.lmd-diagram g.node'); await sleep(200);
  check('un clic en un nodo no hace nada', (await bare(page)).xp === 0);
  await toolsTab(page);
  const c = await page.evaluate(() => { const x = document.querySelector('.lmd-tl-card[data-tool=explore]'); return x ? { name: x.querySelector('b').textContent, about: x.querySelector('p').textContent, on: x.querySelector('input').checked, icon: !!x.querySelector('.lmd-tl-ico svg') } : null; });
  check('su tarjeta está en Herramientas, apagada, con ícono y una línea que dice qué hace', !!c && c.name === 'Explorable diagrams' && !c.on && c.icon && /^A flowchart you can walk through/.test(c.about) && !/[!¡]/.test(c.about), c);
  await page.hover('.lmd-tl-card[data-tool=explore] .lmd-tl-main b'); await sleep(700); await shot(page, 'tarjeta');
  await page.click('.lmd-tl-card[data-tool=explore] .lmd-switch'); await until(() => page.evaluate(() => !!LMD.explore));
  await page.waitForSelector('.lmd-tl-side[data-tool=explore] .lmd-check input');
  const side = await page.evaluate(() => { const s = document.querySelector('.lmd-tl-side'); return { how: s.querySelector('.lmd-xp-how').textContent, wheel: s.querySelector('.lmd-check').textContent, on: s.querySelector('.lmd-check input').checked }; });
  check('prenderla pide su archivo, queda guardada y abre sus opciones con el ejemplo de anotación', await scripts(page, 'explore.js') === 1 && (await stored(page)).tools.explore === true && /^%% @api: /.test(side.how) && side.wheel === 'Zoom with the wheel without holding Ctrl' && !side.on, side);
  await shot(page, 'opciones');
  await page.click('.lmd-tl-side .lmd-check input'); await sleep(250);
  check('la opción de la rueda se guarda', (await stored(page)).tools.exploreWheel === true);
  await page.click('.lmd-tl-side .lmd-check input'); await sleep(200);
  await closePanel(page); await page.waitForSelector('.lmd-xp-stage g.lmd-xp-node');
  const s = await st(page);
  check('el diagrama de flujo queda armado sin recargar', !!s && s.count === 1 && s.nodes.length === 7, s);
  check('el de secuencia se dibuja como siempre', await page.evaluate(() => { const b = document.querySelectorAll('.lmd-diagram')[1]; return !!b.querySelector(':scope > svg') && !b.classList.contains('lmd-xp') && !b.querySelector('[tabindex]') && /sequence/.test(b.querySelector('svg').getAttribute('aria-roledescription')); }));
  await toolsTab(page); await page.click('.lmd-tl-card[data-tool=explore] .lmd-switch'); await sleep(300); await closePanel(page);
  const back = await bare(page);
  check('apagarla devuelve el diagrama a como estaba', J(back) === J(was), [was, back]);
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('pick', 'Elegir un nodo: sus vecinos, el resto atenuado y su detalle', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  const s0 = await st(page);
  check('lee del dibujo los nodos, las flechas y el grupo', J(s0.nodes) === J(['user', 'web', 'api', 'db', 'queue', 'worker', 'mail']) && J(s0.groups) === J(['back']) && J(s0.foldable) === J(['back']) && s0.edges.length === 7 && s0.edges.includes('api>queue'), s0);
  check('y del bloque, el detalle de cada nodo', J(s0.notes) === J(['web', 'api', 'db']) && await page.evaluate(() => document.querySelectorAll('.lmd-xp-dot').length) === 3, s0.notes);
  check('nada elegido: todo se ve entero y no hay detalle', await dim(page, 'mail') === 1 && !(await card(page)));
  await page.click(node('api')); await sleep(300);
  const s1 = await st(page); const c1 = await card(page);
  check('un clic lo elige, con lo que le llega y a lo que va', s1.sel === 'api' && J(s1.lit.nodes.slice().sort()) === J(['api', 'db', 'queue', 'web']) && s1.lit.edges === 3, s1.lit);
  check('lo demás se atenúa y lo suyo no', await dim(page, 'mail') < 0.5 && await dim(page, 'user') < 0.5 && await dim(page, 'worker') < 0.5 && await dim(page, 'web') === 1 && await dim(page, 'api') === 1);
  const lines = await page.evaluate(() => { const on = [...document.querySelectorAll('.lmd-xp-stage path.flowchart-link.lmd-xp-on')]; const i = document.createElement('i'); i.style.color = 'var(--accent-fill)'; document.body.appendChild(i); const acc = getComputedStyle(i).color; i.remove(); return { n: on.length, accent: on.every((p) => getComputedStyle(p).stroke === acc), ring: getComputedStyle(document.querySelector('.lmd-xp-me > .lmd-xp-ring')).stroke === acc, off: getComputedStyle(document.querySelector('.lmd-xp-stage path.flowchart-link:not(.lmd-xp-on)')).opacity }; });
  check('sus flechas y su aro toman el acento del tema', lines.n === 3 && lines.accent && lines.ring && +lines.off < 0.5, lines);
  check('el detalle trae su nombre, su descripción y de dónde recibe y a dónde envía', !!c1 && c1.title === 'API' && c1.notes[0] === 'The single entry point.' && J(c1.rel) === J([['Receives from', 'Web app'], ['Sends to', 'Database', 'Queue']]), c1);
  check('la descripción es Markdown saneado', await page.evaluate(() => !!document.querySelector('.lmd-xp-note p strong') && !document.querySelector('.lmd-xp-note script')));
  await shot(page, 'escritorio-oscuro');
  await page.click('.lmd-xp-card [data-xp=reach]'); await sleep(250);
  const s2 = await st(page);
  check('seguir el recorrido marca todo lo que llega y todo lo que sale', s2.reach && J(s2.lit.nodes.slice().sort()) === J(['api', 'db', 'mail', 'queue', 'user', 'web', 'worker']) && (await card(page)).reach === 'true', s2.lit);
  await page.click('.lmd-xp-card [data-xp-go=db]'); await sleep(250);
  const s3 = await st(page);
  check('un vecino del detalle pasa a ser el elegido', s3.sel === 'db' && !s3.reach && (await card(page)).title === 'Database' && J((await card(page)).rel) === J([['Receives from', 'API', 'Worker']]), s3.lit);
  await page.click(node('db')); await sleep(200);
  check('un clic en el elegido lo suelta', (await st(page)).sel === null && !(await card(page)) && await dim(page, 'mail') === 1);
  await page.click(node('user')); await sleep(200);
  check('un nodo sin anotación también muestra sus conexiones', J((await card(page)).rel) === J([['Sends to', 'Web app']]) && (await card(page)).notes.length === 0);
  await page.click('.lmd-xp-card [data-xp=close]'); await sleep(150);
  check('la cruz cierra el detalle', !(await card(page)) && (await st(page)).sel === null);
  // Las acciones de siempre siguen tomando el dibujo, no un ícono de la barra
  await page.hover('.lmd-xp-view'); await page.waitForSelector('.lmd-xp > .lmd-dgm-tools');
  const clash = await page.evaluate(() => { const t = document.querySelector('.lmd-xp > .lmd-dgm-tools').getBoundingClientRect(); return [...document.querySelectorAll('.lmd-xp-bar button:not([hidden])')].some((b) => { const r = b.getBoundingClientRect(); return r.right > t.left && r.left < t.right; }); });
  await page.click('.lmd-xp [data-dt=zoom]'); await sleep(200);
  check('ampliar y bajar el SVG siguen tomando el diagrama, y sus botones no pisan los de la barra', !clash && await page.evaluate(() => { const s = document.querySelector('.lmd-viewer svg'); return !!s && !document.querySelector('.lmd-viewer').hidden && !!s.querySelector('g.node'); }));
  await page.click('.lmd-viewer'); await sleep(150);
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('links', 'Enlaces del detalle: otra nota, una sección y una dirección', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  await page.click(node('api')); await sleep(400);
  const c = await card(page);
  check('los enlaces quedan resueltos: la nota, la sección y la dirección de afuera', c.links.length === 3 && /f=local%2Fother\.md$/.test(c.links[0][1]) && c.links[1][1] === '#notes' && c.links[2][1] === 'https://example.com/runbook' && c.links[2][2] === '_blank' && c.links[0][2] !== '_blank', c.links);
  await page.click('.lmd-xp-note a[href="#notes"]'); await sleep(900);
  check('el enlace a una sección lleva a ella', await page.evaluate(() => { const r = document.getElementById('notes').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }));
  await page.evaluate(() => { window.__same = 1; scrollTo(0, 0); }); await sleep(200);
  await page.click('.lmd-xp-note a.lmd-wiki'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Other'));
  check('el enlace a otra nota la abre sin recargar la página', await page.evaluate(() => window.__same === 1 && /other\.md/.test(decodeURIComponent(location.search)) && document.querySelector('.lmd-article h1').textContent === 'Other'));
  check('y la nota nueva no arrastra nada del diagrama', await page.evaluate(() => !document.querySelector('.lmd-xp-stage, dialog.lmd-xp-full')) && (await st(page)) === null);
  await page.goBack(); await page.waitForSelector('.lmd-xp-stage g.lmd-xp-node'); await sleep(300);
  await page.click(node('db')); await sleep(400);
  await page.click('.lmd-xp-note a'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Other'));
  check('una ruta relativa con sección también', await page.evaluate(() => window.__same === 1 && /other\.md/.test(decodeURIComponent(location.search)) && location.hash === '#one'), await page.evaluate(() => location.href));
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('view', 'Acercar, mover y volver a la vista entera', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  const box = async () => page.evaluate(() => { const r = document.querySelector('.lmd-xp-view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const v = await box(); const mid = [v.x + v.w / 2, v.y + v.h / 2];
  await page.mouse.move(mid[0], mid[1]); await page.mouse.wheel(0, -300); await sleep(200);
  check('la rueda sola no acerca: la nota se sigue leyendo', (await st(page)).k === 1);
  await page.evaluate(() => scrollTo(0, 0)); await sleep(150);
  await page.click('.lmd-xp-bar [data-xp=in]'); await sleep(350);
  const z1 = await st(page);
  check('el botón acerca', z1.k === 1.3 && await page.evaluate(() => document.querySelector('.lmd-xp-stage').classList.contains('lmd-xp-zoomed')), z1);
  const v2 = await box(); const m2 = [v2.x + v2.w / 2, v2.y + v2.h / 2];
  await page.mouse.move(m2[0], m2[1]); await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await sleep(200);
  const z2 = await st(page);
  check('Ctrl y la rueda acercan donde está el cursor', z2.k > z1.k, z2);
  await page.mouse.move(m2[0], m2[1]); await page.mouse.down(); await page.mouse.move(m2[0] + 80, m2[1] + 30, { steps: 5 }); await page.mouse.up(); await sleep(200);
  const z3 = await st(page);
  check('arrastrar mueve el dibujo', Math.abs(z3.x - z2.x - 80) <= 2 && Math.abs(z3.y - z2.y - 30) <= 2 && z3.k === z2.k, [z2, z3]);
  check('y soltar el arrastre no elige un nodo', z3.sel === null);
  await page.click('.lmd-xp-bar [data-xp=out]'); await sleep(300);
  check('el botón aleja', (await st(page)).k < z3.k);
  await page.click('.lmd-xp-bar [data-xp=fit]'); await sleep(350);
  const z4 = await st(page);
  check('volver a la vista entera lo deja como estaba', z4.k === 1 && z4.x === 0 && z4.y === 0 && await page.evaluate(() => !document.querySelector('.lmd-xp-pan').style.transform && !document.querySelector('.lmd-xp-stage').classList.contains('lmd-xp-zoomed')), z4);
  await page.focus(node('web')); await page.keyboard.press('+'); await sleep(250); const k1 = (await st(page)).k; await page.keyboard.press('-'); await page.keyboard.press('-'); await sleep(250); const k2 = (await st(page)).k; await page.keyboard.press('0'); await sleep(250);
  check('con el teclado: más, menos y cero', k1 === 1.3 && k2 < 1 && (await st(page)).k === 1, [k1, k2]);
  await page.evaluate(() => LMD.tools.setOpt({ exploreWheel: true })); await sleep(400);
  const v3 = await box(); await page.mouse.move(v3.x + v3.w / 2, v3.y + v3.h / 2); await page.mouse.wheel(0, -200); await sleep(200);
  check('con la opción de la rueda prendida, acerca sin Ctrl', (await st(page)).k > 1, await st(page));
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('fold', 'Plegar y desplegar un grupo', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  const pure = await page.evaluate(() => {
    const X = LMD.explore; const code = 'flowchart TD\n  a[Uno] --> b{api text}\n  subgraph g1 [Grupo]\n    b --> c\n    c -- usa b --> d[(D)]\n  end\n  d --> e\n  x --> c & e\n  style c fill:#fff\n  %% @c: queda\n  my-b --> e';
    const out = X.foldCode(code, 'g1', new Set(['b', 'c', 'd']), 'Grupo (3)');
    const auto = X.canon('flowchart TD\n  subgraph Mi grupo\n    a --> b\n  end\n  subgraph "Otro grupo"\n    c\n  end');
    return { out: out.split('\n'), miss: X.foldCode(code, 'nada', new Set(), ''), auto: auto.split('\n').filter((l) => /subgraph/.test(l)).map((l) => l.trim()), notes: [...X.notesOf('graph LR\n %% @a: uno\n%%@b:dos\n  %% @a: tres\n %% sin nada\n %%{init: {}}%%')] };
  });
  check('plegar reescribe solo lo que toca: el grupo pasa a ser un nodo y las flechas que cruzan llegan a él', J(pure.out) === J(['flowchart TD', '  a[Uno] --> g1', '  g1 --> e', '  x --> g1 & e', '  %% @c: queda', '  my-b --> e', '  g1["Grupo (3)"]']) && pure.miss === null, pure.out);
  check('un grupo sin nombre propio recibe el de Mermaid, y las anotaciones se leen por nodo', J(pure.auto) === J(['subgraph subGraph0 ["Mi grupo"]', 'subgraph subGraph1 ["Otro grupo"]']) && J(pure.notes) === J([['a', ['uno', 'tres']], ['b', ['dos']]]), [pure.auto, pure.notes]);
  await page.click('.lmd-xp-stage .lmd-xp-glabel'); await until(async () => (await st(page)).nodes.includes('back'));
  await sleep(300);
  const f1 = await st(page);
  check('un clic en el título del grupo lo pliega en un nodo', J(f1.folded) === J(['back']) && J(f1.nodes.slice().sort()) === J(['back', 'mail', 'user', 'web']) && J(f1.edges.slice().sort()) === J(['back>mail', 'user>web', 'web>back']) && f1.groups.length === 0, f1);
  const lab = await page.evaluate(() => { const g = document.querySelector('.lmd-xp-stage g.lmd-xp-folded'); const b = document.querySelector('.lmd-xp-bar [data-xp=fold]'); return g ? { text: g.textContent.trim(), aria: g.getAttribute('aria-label'), open: g.getAttribute('aria-expanded'), btn: b.title, pressed: b.getAttribute('aria-pressed') } : null; });
  check('el nodo dice el nombre del grupo y cuántos nodos guarda', !!lab && lab.text === 'Backend (4)' && lab.aria === 'Backend (4), folded group' && lab.open === 'false' && lab.btn === 'Unfold the groups' && lab.pressed === 'true', lab);
  await page.click(node('web')); await sleep(250);
  check('plegado, elegir un nodo marca el grupo como vecino', J((await st(page)).lit.nodes.slice().sort()) === J(['back', 'user', 'web']) && J((await card(page)).rel) === J([['Receives from', 'Person'], ['Sends to', 'Backend (4)']]));
  await shot(page, 'plegado');
  // Queda plegado aunque la nota se redibuje
  await page.evaluate(() => document.querySelector('[data-act=mode-edit]').click()); await page.waitForSelector('.lmd-editing'); await sleep(500);
  await page.evaluate(() => document.querySelector('[data-act=mode-read]').click()); await until(async () => { const s = await st(page); return s && s.nodes.includes('back'); }, 8000); await sleep(300);
  const f2 = await st(page);
  check('si la nota se redibuja, el grupo sigue plegado y el nodo elegido también', !!f2 && J(f2.folded) === J(['back']) && f2.nodes.includes('back') && f2.sel === 'web', f2);
  await page.click(node('back')); await until(async () => (await st(page)).nodes.includes('api')); await sleep(300);
  const f3 = await st(page);
  check('un clic en el grupo plegado lo abre', f3.folded.length === 0 && f3.nodes.length === 7 && J(f3.groups) === J(['back']) && f3.sel === 'web', f3);
  await page.click('.lmd-xp-bar [data-xp=fold]'); await until(async () => (await st(page)).nodes.includes('back')); await sleep(250);
  await page.click('.lmd-xp-bar [data-xp=fold]'); await until(async () => (await st(page)).nodes.includes('api')); await sleep(250);
  check('el botón de la barra pliega y despliega todos', (await st(page)).folded.length === 0 && await page.evaluate(() => document.querySelector('.lmd-xp-bar [data-xp=fold]').title === 'Fold the groups'));
  check('un diagrama sin grupos no ofrece plegar', await (async () => { await note(page, true, MAP.replace('  subgraph back [Backend]\n', '').replace('  end\n', '')); return page.evaluate(() => document.querySelector('.lmd-xp-bar [data-xp=fold]').hidden && !document.querySelector('.lmd-xp-glabel')); })());
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('find', 'Buscar un nodo por nombre', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  await page.click('.lmd-xp-bar [data-xp=find]'); await sleep(150);
  check('el botón abre el campo y le da el foco', await page.evaluate(() => { const q = document.querySelector('.lmd-xp-q'); return !q.hidden && document.activeElement === q && q.placeholder === 'Find a node'; }));
  await page.keyboard.type('E'); await sleep(150);
  const h1 = await st(page);
  check('marca los que coinciden y atenúa el resto, sin distinguir mayúsculas', J(h1.hits.slice().sort()) === J(['db', 'mail', 'queue', 'user', 'web', 'worker']) && await dim(page, 'api') < 0.5 && await dim(page, 'web') === 1 && await page.evaluate(() => document.querySelector('.lmd-xp-count').textContent) === '6', h1.hits);
  await page.keyboard.type('mail'); await sleep(150);
  check('al seguir escribiendo queda el que es', J((await st(page)).hits) === J(['mail']));
  await page.keyboard.press('Enter'); await sleep(250);
  check('Enter lo elige y abre su detalle', (await st(page)).sel === 'mail' && (await card(page)).title === 'Email provider' && await page.evaluate(() => document.querySelector('.lmd-xp-count').textContent) === '1 / 1');
  await page.fill('.lmd-xp-q', 'zzz'); await sleep(150);
  check('sin coincidencias lo dice con un cero', (await st(page)).hits.length === 0 && await page.evaluate(() => document.querySelector('.lmd-xp-count').textContent) === '0');
  await page.keyboard.press('Escape'); await sleep(150);
  check('Escape cierra la búsqueda y deja lo elegido', await page.evaluate(() => document.querySelector('.lmd-xp-q').hidden && !document.querySelector('.lmd-xp-find')) && (await st(page)).sel === 'mail' && !(await st(page)).finding);
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('keys', 'Con el teclado: Tab, Enter y Escape', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  await page.focus(node('user'));
  const seen = [await focusId(page)];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seen.push(await focusId(page)); }
  check('Tab pasa por los nodos, cada uno con su nombre para un lector de pantalla', new Set(seen).size === 7 && seen.every((x) => ['user', 'web', 'api', 'db', 'queue', 'worker', 'mail'].includes(x)) && await page.evaluate(() => [...document.querySelectorAll('.lmd-xp-stage g.lmd-xp-node')].every((g) => g.getAttribute('role') === 'button' && g.getAttribute('aria-label'))), seen);
  await page.focus(node('api')); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  check('el nodo con el foco se ve', await page.evaluate(() => { const g = document.activeElement; return g.matches('g.lmd-xp-node:focus-visible') && getComputedStyle(g.querySelector('.lmd-xp-ring')).stroke !== 'none'; }));
  await page.keyboard.press('Enter'); await sleep(250);
  check('Enter abre el detalle y le pasa el foco', (await st(page)).sel === 'api' && (await card(page)).title === 'API' && await page.evaluate(() => document.activeElement === document.querySelector('.lmd-xp-card')));
  await page.keyboard.press('Tab');
  check('desde ahí Tab entra a sus botones y enlaces', await page.evaluate(() => !!document.activeElement.closest('.lmd-xp-card') && document.activeElement !== document.querySelector('.lmd-xp-card')));
  await page.keyboard.press('Escape'); await sleep(200);
  check('Escape lo cierra y el foco vuelve al nodo', (await st(page)).sel === null && !(await card(page)) && (await focusId(page)) === 'api');
  await page.keyboard.press('/'); await sleep(150);
  check('la barra abre la búsqueda', await page.evaluate(() => document.activeElement === document.querySelector('.lmd-xp-q')));
  await page.keyboard.press('Escape'); await sleep(150);
  await page.focus('.lmd-xp-stage .lmd-xp-glabel'); await page.keyboard.press('Enter'); await until(async () => (await st(page)).nodes.includes('back')); await sleep(300);
  check('Enter en el título de un grupo lo pliega y deja el foco en él', (await focusId(page)) === 'back', await focusId(page));
  await page.keyboard.press('Enter'); await until(async () => (await st(page)).nodes.includes('api')); await sleep(300);
  check('y Enter otra vez lo abre', (await st(page)).folded.length === 0 && (await focusId(page)) === 'back');
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('full', 'Pantalla completa', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  await page.click(node('api')); await sleep(200);
  await page.click('.lmd-xp-bar [data-xp=full]'); await sleep(400);
  const f = await page.evaluate(() => { const d = document.querySelector('dialog.lmd-xp-full'); if (!d) return null; const r = d.getBoundingClientRect(); const v = d.querySelector('.lmd-xp-view').getBoundingClientRect(); const s = d.querySelector('.lmd-xp-pan svg').getBoundingClientRect(); const c = d.querySelector('.lmd-xp-card').getBoundingClientRect();
    return { open: d.open, all: r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight, inside: s.left >= v.left - 1 && s.right <= v.right + 1 && s.top >= v.top - 1 && s.bottom <= v.bottom + 1, fills: s.width > v.width * 0.6 || s.height > v.height * 0.8, hole: !!document.querySelector('.lmd-diagram .lmd-xp-hole'), card: c.right <= innerWidth && c.left > innerWidth / 2 && c.width > 200, btn: d.querySelector('[data-xp=full]').title }; });
  const s1 = await st(page);
  check('ocupa toda la ventana, con el dibujo entero y centrado', !!f && f.open && f.all && f.inside && f.fills && f.hole && s1.full, f);
  check('conserva lo elegido, con el detalle al costado', s1.sel === 'api' && f.card && f.btn === 'Exit full screen', [s1.sel, f]);
  await shot(page, 'pantalla-completa');
  const k0 = s1.k; await page.mouse.move(500, 400); await page.mouse.wheel(0, -240); await sleep(200);
  check('ahí la rueda acerca sin Ctrl', (await st(page)).k > k0);
  await page.mouse.move(300, 500); await page.mouse.down(); await page.mouse.move(360, 540, { steps: 4 }); await page.mouse.up(); await sleep(150);
  await page.click('dialog.lmd-xp-full [data-xp=fit]'); await sleep(350);
  check('y el botón vuelve a la vista entera', Math.abs((await st(page)).k - k0) < 0.01);
  await page.keyboard.press('Escape'); await sleep(250);
  check('Escape cierra primero el detalle', (await st(page)).full && (await st(page)).sel === null);
  await page.keyboard.press('Escape'); await sleep(350);
  const out = await page.evaluate(() => ({ dlg: !!document.querySelector('dialog.lmd-xp-full'), back: !!document.querySelector('.lmd-article .lmd-diagram.lmd-xp > .lmd-xp-stage'), hole: !!document.querySelector('.lmd-xp-hole'), pan: document.querySelector('.lmd-xp-pan').style.cssText }));
  check('y después sale: el diagrama vuelve a su lugar en la nota', !out.dlg && out.back && !out.hole && out.pan === '' && !(await st(page)).full && (await st(page)).k === 1, out);
  // Un enlace a otra nota desde la pantalla completa
  await page.click(node('api')); await page.click('.lmd-xp-bar [data-xp=full]'); await sleep(400);
  await page.evaluate(() => { window.__same = 1; });
  await page.click('dialog.lmd-xp-full .lmd-xp-note a.lmd-wiki'); await until(() => page.evaluate(() => (document.querySelector('.lmd-article h1') || {}).textContent === 'Other'));
  check('un enlace a otra nota sale de la pantalla completa y la abre', await page.evaluate(() => window.__same === 1 && !document.querySelector('dialog.lmd-xp-full') && document.querySelector('.lmd-article h1').textContent === 'Other'));
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('edit', 'En edición el bloque se edita como siempre', async () => {
  const { ctx, page } = await open({ tools: ON });
  await note(page, true);
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editing .lmd-diagram svg'); await sleep(500);
  check('al pasar a edición el diagrama queda sin la barra ni nada para elegir', await page.evaluate(() => !document.querySelector('[class*="lmd-xp"]') && !document.querySelector('.lmd-diagram [tabindex]') && !!document.querySelector('.lmd-diagram > svg')) && (await st(page)) === null);
  await page.click('.lmd-diagram g.node'); await page.waitForSelector('.lmd-dgm-card'); await page.waitForSelector('.lmd-dgm-svg svg');
  const pieces = await page.evaluate(() => [...document.querySelectorAll('.lmd-dgm [data-piece]')].map((b) => b.textContent));
  check('un clic abre el editor de diagramas, que suma la pieza para el detalle de un nodo', J(pieces) === J(['Step', 'Question', 'Arrow', 'Arrow with a label', 'Color one node', 'Node detail']), pieces);
  await page.click('.lmd-dgm [data-piece="5"]'); await sleep(300);
  const ta = await page.evaluate(() => { const t = document.querySelector('.lmd-dgm textarea'); return { last: t.value.trimEnd().split('\n').pop(), picked: t.value.slice(t.selectionStart, t.selectionEnd) }; });
  check('la pieza escribe la anotación del último nodo, con el texto listo para reemplazar', ta.last === '  %% @mail: What it does, with [a link](note.md)' && ta.picked === 'What it does, with [a link](note.md)', ta);
  await page.keyboard.type('Sends the mail.'); await sleep(900);
  check('y el diagrama se sigue dibujando con esa línea', await page.evaluate(() => document.querySelector('.lmd-dgm-err').hidden && !!document.querySelector('.lmd-dgm-svg svg g.node')));
  await page.keyboard.press('Control+Enter'); await sleep(900);
  check('aplicar la deja escrita en el bloque', /%% @mail: Sends the mail\./.test(await page.evaluate(async () => ((await LMD.store.noteGet('map.md')) || {}).text || document.querySelector('.lmd-diagram').dataset.code)));
  await page.click('[data-act=mode-read]'); await page.waitForSelector('.lmd-xp-stage g.lmd-xp-node'); await sleep(300);
  await page.click(node('mail')); await sleep(250);
  check('de vuelta en lectura, el nodo muestra el detalle recién cargado', J((await card(page)).notes) === J(['Sends the mail.']) && (await st(page)).notes.includes('mail'));
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('edit', 'Con la herramienta apagada el editor no cambia', async () => {
  const { ctx, page } = await open();
  await note(page, false);
  await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editing .lmd-diagram svg'); await sleep(400);
  await page.click('.lmd-diagram g.node'); await page.waitForSelector('.lmd-dgm-card');
  check('las piezas son las cinco de siempre', await page.evaluate(() => document.querySelectorAll('.lmd-dgm [data-piece]').length) === 5);
  await ctx.close();
});

await step('phone', 'En un teléfono: toque, dos dedos y pantalla completa', async () => {
  const { ctx, page } = await open({ tools: ON, ctx: SMALL });
  await note(page, true);
  const fits = () => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);
  check('el diagrama entra en el ancho de la pantalla', await fits() && await page.evaluate(() => { const r = document.querySelector('.lmd-xp-stage').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  check('los botones de la barra tienen tamaño para el dedo', await page.evaluate(() => [...document.querySelectorAll('.lmd-xp-bar button:not([hidden])')].every((b) => b.getBoundingClientRect().width >= 36 && b.getBoundingClientRect().height >= 36)));
  await page.tap(node('api')); await sleep(350);
  const c = await card(page);
  check('un toque elige el nodo y muestra su detalle debajo', (await st(page)).sel === 'api' && !!c && c.title === 'API' && await fits() && await page.evaluate(() => { const v = document.querySelector('.lmd-xp-view').getBoundingClientRect(); const k = document.querySelector('.lmd-xp-card').getBoundingClientRect(); return k.top >= v.bottom - 1 && k.right <= innerWidth; }), c);
  await page.evaluate(() => { document.querySelector('.lmd-xp-stage').scrollIntoView({ block: 'start' }); scrollBy(0, -70); }); await sleep(200);
  await shot(page, 'telefono');
  // Dos dedos que se separan sobre el dibujo
  const v = await page.evaluate(() => { const r = document.querySelector('.lmd-xp-view').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: d == null ? [] : [{ x: Math.round(v.x - d), y: Math.round(v.y), id: 0 }, { x: Math.round(v.x + d), y: Math.round(v.y), id: 1 }] });
  await touch('touchStart', 30); for (const d of [40, 55, 70, 90, 110]) { await touch('touchMove', d); await sleep(30); } await touch('touchEnd'); await sleep(450);
  const z = await st(page);
  check('separar dos dedos acerca', z.k > 1.5 && z.sel === 'api', z);
  await page.tap('.lmd-xp-bar [data-xp=fit]'); await sleep(300);
  check('y el botón vuelve a la vista entera', (await st(page)).k === 1);
  await page.tap('.lmd-xp-bar [data-xp=full]'); await sleep(450);
  const f = await page.evaluate(() => { const d = document.querySelector('dialog.lmd-xp-full'); if (!d) return null; const r = d.getBoundingClientRect(); const k = d.querySelector('.lmd-xp-card').getBoundingClientRect(); const s = d.querySelector('.lmd-xp-pan svg').getBoundingClientRect(); return { all: r.width === innerWidth && r.height === innerHeight, sheet: k.left === 0 && Math.round(k.right) === innerWidth && Math.round(k.bottom) === innerHeight && k.height <= innerHeight * 0.47, svg: s.left >= -1 && s.right <= innerWidth + 1 && s.width > innerWidth * 0.7 }; });
  check('a pantalla completa el detalle queda abajo y el dibujo entra entero', !!f && f.all && f.sheet && f.svg, f);
  await shot(page, 'telefono-pantalla-completa');
  // Con el dibujo acercado, un dedo lo mueve
  await page.tap('dialog.lmd-xp-full [data-xp=close]'); await sleep(150);
  const before = await st(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 300, id: 0 }] });
  for (const dx of [20, 40, 60]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + dx, y: 300, id: 0 }] }); await sleep(30); }
  // Chrome no da por clic un toque que llega pegado al anterior: se espera como esperaría una persona.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450);
  check('un dedo mueve el dibujo', (await st(page)).x - before.x >= 50, [before.x, (await st(page)).x]);
  await page.tap('dialog.lmd-xp-full [data-xp=full]'); await sleep(350);
  check('y se sale con el mismo botón', !(await st(page)).full && await page.evaluate(() => !document.querySelector('dialog.lmd-xp-full')) && await fits());
  check('sin errores', R.errors.length === 0, R.errors);
  await ctx.close();
});

await step('look', 'Temas, acento, sin movimiento y la plantilla', async () => {
  // Claro
  { const { ctx, page } = await open({ tools: ON, ctx: { colorScheme: 'light' } });
    await note(page, true); await page.click(node('api')); await sleep(350);
    const c = await page.evaluate(() => { const rgb = (v) => { const i = document.createElement('i'); i.style.color = 'var(' + v + ')'; document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; }; const s = getComputedStyle(document.querySelector('.lmd-xp-stage')); return { dark: document.documentElement.classList.contains('lmd-dark'), bg: s.backgroundColor === rgb('--bg'), line: s.borderTopColor === rgb('--line'), ring: getComputedStyle(document.querySelector('.lmd-xp-me > .lmd-xp-ring')).stroke === rgb('--accent-fill'), card: getComputedStyle(document.querySelector('.lmd-xp-card')).backgroundColor === rgb('--bg-soft') }; });
    check('en claro toma los colores del tema', !c.dark && c.bg && c.line && c.ring && c.card, c);
    await shot(page, 'escritorio-claro');
    await ctx.close(); }
  // Otro tema y otro acento: los colores siguen a las variables
  { const { ctx, page } = await open({ tools: ON });
    await note(page, true); await page.click(node('api')); await sleep(300);
    const ring = () => page.evaluate(() => getComputedStyle(document.querySelector('.lmd-xp-me > .lmd-xp-ring')).stroke);
    const r0 = await ring();
    await page.evaluate(() => { document.documentElement.style.setProperty('--accent-fill', 'rgb(1, 2, 3)'); document.documentElement.style.setProperty('--line', 'rgb(4, 5, 6)'); }); await sleep(100);
    check('el acento y las líneas salen de las variables del tema', r0 !== 'rgb(1, 2, 3)' && (await ring()) === 'rgb(1, 2, 3)' && await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-xp-stage')).borderTopColor === 'rgb(4, 5, 6)' && getComputedStyle(document.querySelector('.lmd-xp-stage path.flowchart-link.lmd-xp-on')).stroke === 'rgb(1, 2, 3)'));
    await ctx.close(); }
  // Sin movimiento
  { const { ctx, page } = await open({ tools: ON, ctx: { reducedMotion: 'reduce' } });
    await note(page, true); await page.click('.lmd-xp-bar [data-xp=in]'); await page.click(node('api')); await sleep(200);
    const m = await page.evaluate(() => ({ ease: document.querySelector('.lmd-xp-pan').classList.contains('lmd-xp-ease'), pan: getComputedStyle(document.querySelector('.lmd-xp-pan')).transitionDuration, node: getComputedStyle(document.querySelector('.lmd-xp-stage g.node')).transitionDuration, moving: document.querySelector('.lmd-xp-stage').getAnimations({ subtree: true }).length, k: LMD.explore.state().k }));
    check('con movimiento reducido no hay transiciones ni animaciones, y todo funciona igual', !m.ease && m.pan === '0s' && m.node === '0s' && m.moving === 0 && m.k === 1.3, m);
    await ctx.close(); }
  // Con movimiento, el botón de acercar va con una transición corta
  { const { ctx, page } = await open({ tools: ON });
    await note(page, true); await page.click('.lmd-xp-bar [data-xp=in]');
    check('con movimiento, acercar con el botón es suave', await page.evaluate(() => document.querySelector('.lmd-xp-pan').classList.contains('lmd-xp-ease') && getComputedStyle(document.querySelector('.lmd-xp-pan')).transitionDuration !== '0s'));
    // La plantilla de ejemplo, en los dos idiomas
    await until(() => page.evaluate(() => !!LMD.templates));
    const tpl = await page.evaluate(() => { const was = LMD.lang; const out = {}; for (const l of ['en', 'es']) { LMD.lang = () => l; const t = LMD.templates.get('archmap'); const item = LMD.templates.list().find((x) => x.id === 'archmap'); out[l] = { name: item && item.name, group: item && item.group, file: t && t.file, text: t ? t.text : '' }; } LMD.lang = was; return out; });
    check('la plantilla está en la lista, en los dos idiomas', tpl.en.name === 'Architecture map' && tpl.es.name === 'Mapa de arquitectura' && tpl.en.group === 'product' && tpl.en.file === 'architecture-map' && /```mermaid\nflowchart/.test(tpl.en.text) && /```mermaid\nflowchart/.test(tpl.es.text), [tpl.en.name, tpl.es.name, tpl.en.file]);
    check('y no hay ninguna otra con ese id ni se perdió ninguna', await page.evaluate(() => { const l = LMD.templates.list(); return l.length === 29 && new Set(l.map((x) => x.id)).size === 29; }));
    for (const l of ['en', 'es']) {
      await note(page, true, tpl[l].text);
      const s = await st(page);
      const ok = !!s && s.nodes.length >= 6 && s.foldable.length >= 1 && s.notes.length >= 5 && s.notes.every((id) => s.nodes.includes(id));
      check('la plantilla (' + l + ') se dibuja, tiene un grupo para plegar y cada anotación es de un nodo que existe', ok, s && { nodes: s.nodes, notes: s.notes, foldable: s.foldable });
      const first = s.notes[0]; await page.click(node(first)); await sleep(300);
      const c = await card(page);
      check('y sus enlaces a secciones de la nota existen (' + l + ')', !!c && c.notes.length > 0 && await page.evaluate(() => [...new Set((document.querySelector('.lmd-diagram').dataset.code.match(/\]\(#[^)]+\)/g) || []).map((x) => x.slice(3, -1)))].every((id) => !!document.getElementById(decodeURIComponent(id)))), c);
    }
    await shot(page, 'plantilla');
    check('sin errores', R.errors.length === 0, R.errors);
    await ctx.close(); }
});

const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
