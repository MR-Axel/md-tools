// La app en un teléfono (versión web, 390x844 y 360x740, táctil): nada desborda a lo ancho, la barra lateral es un
// panel que no corre el contenido, el menú "más" reemplaza a la barra de arriba, los menús salen con el dedo, el
// atajo de nota nueva crea y abre una nota, y con el service worker la app vuelve a abrir sin red.
// La nube es un servidor local: la de verdad no se toca.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// El sitio, servido como en sharpmd.app
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown' };
const hits = [];
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  hits.push(rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';

// El servidor de sincronización, local
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 23000 + Math.floor(Math.random() * 900); const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base, ALLOW_ORIGINS: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const api = (method, p, body, s, extra) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
const PHONE = { deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'en-US' };
const outside = []; const errors = [];
const open = async (width, height, opt) => {
  const ctx = await browser.newContext(Object.assign({ viewport: { width, height } }, PHONE, opt || {}));
  await ctx.route((url) => /(^|\.)sync\.sharpmd\.app$/.test(url.hostname), (r) => { outside.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
};
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const J = (v) => JSON.stringify(v);

// Nada más ancho que la pantalla: ni la página, ni un bloque suelto, ni un menú o un diálogo. Lo que se desliza
// dentro de su propio bloque (tablas, código, la fila de pestañas) no cuenta.
const overflow = (page) => page.evaluate(() => {
  const w = window.innerWidth; const bad = [];
  const inside = '.lmd-table, .lmd-code, .lmd-board, .lmd-diagram, .lmd-ptabs, .lmd-math-block, pre';
  document.querySelectorAll('body *').forEach((n) => {
    const r = n.getBoundingClientRect(); if (!r.width || !r.height || n.closest(inside)) return;
    if (n.closest('.lmd-sidebar') && !document.documentElement.classList.contains('lmd-side-open')) return; // el panel cerrado espera fuera de la pantalla, a la izquierda
    if (r.right > w + 1 || r.left < -1) bad.push((typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : n.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  return { page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w, bad: bad.slice(0, 5) };
});
const fits = async (page, name) => { await page.waitForTimeout(250); const o = await overflow(page); check('sin scroll horizontal: ' + name, o.page <= 0 && !o.bad.length, o); };
// Mantener apretado: el dedo queda quieto más de medio segundo.
const press = async (page, locator) => {
  const box = await locator.boundingBox(); const x = box.x + Math.min(60, box.width / 2); const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(750);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};
const away = (page) => page.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

const NOTE = '# Booking app launch\n\nWhat is left before we ship on **Monday the 19th**. Checked items are already in production, and this sentence is long enough to wrap on a phone.\n\n' +
  '## Who does what\n\n| Task | Owner | Due | Status | Notes |\n|---|---|---|---|---|\n| Deposit payment | Sofia | Thursday 15 | In testing | One bug left in the refund flow |\n| Waiting list | Martin | Friday 16 | Started | Needs the copy from Ana |\n\n' +
  '## Code\n\n```js\nconst total = items.filter((item) => item.paid).map((item) => item.amount).reduce((sum, amount) => sum + amount, 0); // a long line\n```\n\n' +
  'A very long address: https://example.com/a/really/long/path/that/does/not/have/any/place/to/break/at/all/and/keeps/going/for/a/while\n\n## After launch\n\n' + 'We track bookings per day.\n\n'.repeat(30);

try {
  const mail = 'ana@ejemplo.test';
  const code = (await api('POST', '/auth/start', { email: mail })).json.dev_code;
  const session = (await api('POST', '/auth/verify', { email: mail, code })).json.session;
  await api('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  await api('PUT', '/notes/' + encodeURIComponent('work/launch.md'), { text: NOTE }, session);

  for (const [W, H] of [[390, 844], [360, 740]]) {
    console.log('Teléfono de ' + W + 'x' + H);
    const { ctx, page } = await open(W, H, { serviceWorkers: 'block' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const tag = W + ': ';
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]');
    if (W === 390) check('el teléfono emulado es táctil y la app arranca en inglés', await page.evaluate(() => matchMedia('(pointer: coarse)').matches && LMD.touch.small() && LMD.lang() === 'en'));

    // ---------- Estado vacío ----------
    const empty = await page.evaluate(() => {
      const acts = [...document.querySelectorAll('.lmd-home-actions [data-home]')].map((b) => b.getBoundingClientRect());
      const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); const card = document.querySelector('.lmd-home-card').getBoundingClientRect();
      return { rows: new Set(acts.map((r) => Math.round(r.top))).size, n: acts.length, low: Math.min(...acts.map((r) => r.height)), sideRight: side.right, sideSeen: getComputedStyle(document.querySelector('.lmd-sidebar')).visibility,
        bar: [...document.querySelectorAll('.lmd-topbar [data-act]')].filter((b) => b.offsetParent).map((b) => b.dataset.act), card: [Math.round(card.left), Math.round(window.innerWidth - card.right)] };
    });
    check(tag + 'la barra lateral arranca cerrada, fuera de la pantalla', empty.sideRight <= 0 && empty.sideSeen === 'hidden', empty);
    check(tag + 'estado vacío: las cuatro acciones en dos columnas, altas para el dedo', empty.n === 4 && empty.rows === 2 && empty.low >= 40, empty);
    check(tag + 'sin nota, arriba quedan la barra lateral y los ajustes', J(empty.bar) === J(['sidebar', 'settings']), empty.bar);
    await fits(page, tag + 'estado vacío');

    if (W === 390) {
      // ---------- Textos del inicio en teléfono, y el atrás del sistema ----------
      const homeText = await page.evaluate(() => document.querySelector('.lmd-home-card').innerText);
      check(tag + 'el inicio no habla de arrastrar ni de "la izquierda"', !/drag/i.test(homeText) && !/on the left/i.test(homeText) && /Start a new note or open one you already have\./.test(homeText), homeText);
      check(tag + 'en la web no aparece el aviso de versión nueva', await page.evaluate(() => document.querySelector('.lmd-update').hidden));
      const layers = () => page.evaluate(() => ({ drawer: document.documentElement.classList.contains('lmd-side-open'), panel: !document.querySelector('.lmd-panel').hidden, ask: document.querySelectorAll('.lmd-ask').length, url: location.href }));
      const at = page.url();
      await page.tap('[data-act=sidebar]'); await page.waitForTimeout(300);
      const d1 = await layers(); await page.goBack(); await page.waitForTimeout(400); const d2 = await layers();
      check(tag + 'atrás con la barra lateral abierta la cierra y no sale de la página', d1.drawer && !d2.drawer && d2.url === at, [d1, d2]);
      await page.tap('[data-act=settings]'); await page.waitForTimeout(300);
      const p1 = await layers(); await page.goBack(); await page.waitForTimeout(400); const p2 = await layers();
      check(tag + 'atrás con Ajustes abiertos los cierra', p1.panel && !p2.panel && p2.url === at, [p1, p2]);
      await page.tap('[data-home=tpl]'); await page.waitForSelector('.lmd-tpl'); await page.waitForTimeout(200);
      await page.goBack(); await page.waitForTimeout(400); const t2 = await layers();
      check(tag + 'atrás con un diálogo abierto lo cierra', t2.ask === 0 && t2.url === at, t2);
      // Lo abierto se cerró de otra forma: abrir una nota no suma una entrada de más, y un solo atrás vuelve al inicio.
      await page.tap('[data-act=sidebar]'); await page.waitForTimeout(300); await page.touchscreen.tap(W - 12, 400); await page.waitForTimeout(300);
      const before = await page.evaluate(() => history.length);
      await page.tap('[data-home=new]'); await page.waitForSelector('.lmd-draft');
      const after = await page.evaluate(() => [history.length, !!(history.state && history.state.lmdLayer)]);
      check(tag + 'abrir una nota reemplaza la entrada que dejó la barra lateral', after[0] === before && after[1] === false, [before, after]);
      const tapHint = await page.evaluate(() => document.querySelector('.lmd-status').textContent);
      check(tag + 'el aviso de edición habla de tocar, no de hacer clic', /tap/.test(tapHint) && !/click/.test(tapHint), tapHint);
      await page.goBack(); await page.waitForSelector('.lmd-home:not([hidden]) [data-home=new]'); await page.waitForTimeout(300);
      check(tag + 'y atrás vuelve al inicio de una sola vez', !/[?&]f=/.test(page.url()), page.url());
      await page.evaluate(async () => { for (const n of await LMD.store.notesAll()) await LMD.store.noteDelete(n.name); sessionStorage.removeItem('lmd-edit'); });
      await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]');
    }

    // Cuenta y notas: una en el navegador y una en la nube
    await page.evaluate(async ([url, s, m, text]) => {
      await LMD.store.notePut('groceries.md', '# Groceries\n\n- [ ] Coffee\n- [x] Bread\n');
      await LMD.store.notePut('launch.md', text);
      await new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: s, email: m } }, resolve));
    }, [base, session, mail, NOTE]);
    await page.goto(home); await page.waitForSelector('.lmd-home-acct');
    await fits(page, tag + 'estado vacío con la cuenta abierta');

    // ---------- Barra lateral ----------
    const mainBox = () => page.evaluate(() => { const r = document.querySelector('.lmd-main').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
    const drawer = () => page.evaluate(() => ({ open: document.documentElement.classList.contains('lmd-side-open'), right: Math.round(document.querySelector('.lmd-sidebar').getBoundingClientRect().right), scrim: getComputedStyle(document.querySelector('.lmd-scrim')).display }));
    const before = await mainBox();
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    let d = await drawer();
    check(tag + 'el botón abre la barra lateral encima, con el fondo oscurecido', d.open && d.right > 200 && d.right < W && d.scrim === 'block', d);
    check(tag + 'abrirla no corre ni achica el contenido', J(await mainBox()) === J(before) && before[0] === 0 && before[1] === W, [before, await mainBox()]);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lmd-sidebar .lmd-node, .lmd-sidebar .lmd-root-tog, .lmd-sidebar .lmd-zone-head')].filter((n) => n.offsetParent).map((n) => Math.round(n.getBoundingClientRect().height)));
    check(tag + 'los renglones del explorador miden 40 px o más', rows.length >= 4 && Math.min(...rows) >= 40, rows);
    await fits(page, tag + 'barra lateral abierta');
    await page.touchscreen.tap(W - 12, H / 2); await page.waitForTimeout(350);
    check(tag + 'tocar afuera la cierra', !(await drawer()).open);
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    check(tag + 'Escape la cierra', !(await drawer()).open);
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    await page.locator('.lmd-node', { hasText: 'launch.md' }).first().tap(); await page.waitForSelector('.markdown-body h1');
    await page.waitForTimeout(350); d = await drawer();
    check(tag + 'elegir una nota la abre y cierra la barra sola', !d.open && d.right <= 0 && (await page.title()) === 'launch.md', d);
    check(tag + 'el estado de pantalla chica no pisa el recordado en escritorio', await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get('settings', (r) => resolve(!((r.settings || {}).sidebarHidden))))));

    // ---------- Leyendo ----------
    const top = await page.evaluate(() => {
      const bar = document.querySelector('.lmd-topbar').getBoundingClientRect(); const name = document.querySelector('.lmd-docname');
      const seen = [...document.querySelectorAll('.lmd-topbar [data-act]')].filter((b) => b.offsetParent);
      return { acts: seen.map((b) => b.dataset.act), right: Math.max(...seen.map((b) => b.getBoundingClientRect().right)), low: Math.min(...seen.filter((b) => b.classList.contains('lmd-icon-btn')).map((b) => b.getBoundingClientRect().height)),
        bar: Math.round(bar.width), name: name.textContent, ellipsis: getComputedStyle(name).textOverflow, nameW: Math.round(name.getBoundingClientRect().width), font: parseFloat(getComputedStyle(document.querySelector('.lmd-article p')).fontSize) };
    });
    check(tag + 'arriba quedan la barra lateral, el nombre, leer o editar y el menú "más"', J(top.acts) === J(['sidebar', 'mode-read', 'mode-edit', 'save', 'more']) && top.name === 'launch.md' && top.nameW > 60 && top.ellipsis === 'ellipsis', top);
    check(tag + 'la barra de arriba entra entera y sus botones miden 40 px', top.right <= W && top.bar === W && top.low >= 40, top);
    check(tag + 'la letra del documento se lee sin zoom', top.font >= 16, top.font);
    const wide = await page.evaluate(() => {
      const t = document.querySelector('.lmd-table'); const pre = document.querySelector('.lmd-code pre');
      return { table: [t.scrollWidth, t.clientWidth, getComputedStyle(t).overflowX], pre: [pre.scrollWidth, pre.clientWidth], w: window.innerWidth };
    });
    check(tag + 'una tabla ancha se desliza dentro de su bloque', wide.table[0] > wide.table[1] && wide.table[1] <= wide.w && wide.table[2] === 'auto', wide);
    await fits(page, tag + 'una nota leyendo');
    const foot = await page.evaluate(() => { const f = document.querySelector('.lmd-foot').getBoundingClientRect(); return [Math.round(f.left), Math.round(f.width), [...document.querySelectorAll('.lmd-foot > *')].every((n) => n.getBoundingClientRect().right <= window.innerWidth)]; });
    check(tag + 'el pie ocupa el ancho y no corta su texto', foot[0] === 0 && foot[1] === W && foot[2], foot);

    // Mantener apretado un bloque abre el menú de lectura
    await press(page, page.locator('.lmd-article > p').first()); await page.waitForSelector('.lmd-menu-read', { timeout: 4000 }).catch(() => {});
    const read = await page.evaluate(() => { const m = document.querySelector('.lmd-menu-read'); if (!m) return null; const r = m.getBoundingClientRect(); return { items: [...m.querySelectorAll('[data-read]')].map((b) => b.dataset.read), in: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, low: Math.min(...[...m.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)) }; });
    check(tag + 'mantener apretado un bloque leyendo abre el menú de lectura, dentro de la pantalla', read && read.items.includes('edit') && read.items.includes('block') && read.in && read.low >= 40, read);
    await fits(page, tag + 'menú de lectura');
    await away(page);

    // ---------- Editando y el menú "más" ----------
    await page.tap('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editable');
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const more = await page.evaluate(() => { const m = document.querySelector('.lmd-menu-more'); const r = m.getBoundingClientRect(); const bs = [...m.querySelectorAll('button')];
      return { acts: bs.map((b) => b.dataset.more), icons: bs.every((b) => b.querySelector('svg') && b.querySelector('span').textContent.trim()), low: Math.min(...bs.map((b) => b.getBoundingClientRect().height)), in: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, right: Math.round(window.innerWidth - r.right) }; });
    check(tag + 'el menú "más" trae la nube, la vista de código, copiar, recargar, imprimir, descargar y ajustes', J(more.acts) === J(['sync', 'insert', 'view-raw', 'copy-md', 'copy-rich', 'reload', 'print', 'export-html', 'settings']), more.acts);
    check(tag + 'cada renglón del menú lleva ícono y texto, mide 40 px o más y queda a la derecha', more.icons && more.low >= 40 && more.in && more.right <= 12, more);
    await fits(page, tag + 'editando con el menú "más" abierto');
    const pick = async (act) => { if (!(await page.locator('.lmd-menu-more').count())) { await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more'); } await page.tap('.lmd-menu-more [data-more=' + act + ']'); await page.waitForTimeout(250); };
    if (W === 390) {
      await pick('view-raw');
      check('"más": ver el código fuente', await page.evaluate(() => !document.querySelector('.lmd-raw-edit').hidden && document.querySelector('.lmd-article').hidden && !document.querySelector('.lmd-menu-more')));
      await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
      check('"más": con el código a la vista ofrece volver al documento', (await page.locator('.lmd-menu-more [data-more=view-doc]').count()) === 1 && (await page.locator('.lmd-menu-more [data-more=insert]').count()) === 0);
      await pick('view-doc');
      check('"más": volver al documento', await page.evaluate(() => !document.querySelector('.lmd-article').hidden));
      await pick('copy-md');
      check('"más": copiar Markdown', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('# Booking app launch'));
      await pick('copy-rich'); await page.waitForTimeout(300);
      check('"más": copiar con formato', /Booking app launch/.test(await page.evaluate(() => navigator.clipboard.readText())) && /Copied with formatting/.test(await page.textContent('.lmd-status')));
      await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
      await pick('print');
      check('"más": imprimir', (await page.evaluate(() => window.__printed)) === 1);
      const [download] = await Promise.all([page.waitForEvent('download'), pick('export-html')]);
      check('"más": descargar como HTML', /\.html$/.test(download.suggestedFilename()), download.suggestedFilename());
      await pick('reload'); await page.waitForTimeout(300);
      check('"más": recargar deja la nota a la vista', (await page.locator('.markdown-body h1').count()) === 1);
      await pick('insert'); await page.waitForSelector('.lmd-menu [data-ins]');
      check('"más": insertar un bloque abre el menú de bloques', (await page.locator('.lmd-menu [data-ins]').count()) > 8);
      await away(page);
      await pick('sync'); await page.waitForSelector('.lmd-dlg-card');
      check('"más": la nube ofrece mover a la nube una nota del navegador', /^Move ".+" to the cloud\?$/.test(await page.textContent('.lmd-dlg-card h3')), await page.textContent('.lmd-dlg-card h3'));
      await page.tap('[data-dlg=no]');
    }

    // ---------- El menú de bloques con el dedo ----------
    await page.keyboard.press('Escape'); await away(page);
    const para = page.locator('.lmd-article > p.lmd-editable').first();
    await para.tap(); await page.waitForTimeout(350);
    const handle = await page.evaluate(() => { const h = document.querySelector('.lmd-handle'); const r = h.getBoundingClientRect(); const p = document.querySelector('.lmd-article > p.lmd-editable').getBoundingClientRect(); return { seen: !h.hidden, left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), text: Math.round(p.left), dy: Math.abs(r.top - p.top) }; });
    check(tag + 'al tocar un bloque su manija queda a la vista, al costado del texto', handle.seen && handle.left >= 0 && handle.right <= handle.text && handle.dy < 12 && handle.h >= 36, handle);
    await page.tap('.lmd-handle'); await page.waitForSelector('.lmd-menu [data-ins]', { timeout: 4000 }).catch(() => {});
    const block = await page.evaluate(() => { const m = document.querySelector('.lmd-menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { ops: [...m.querySelectorAll('[data-op]')].map((b) => b.dataset.op), in: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, low: Math.min(...[...m.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)) }; });
    check(tag + 'la manija abre el menú de bloques, entero dentro de la pantalla', block && block.ops.includes('dup') && block.ops.includes('del') && block.in && block.low >= 40, block);
    await fits(page, tag + 'menú de bloques');
    await page.tap('.lmd-menu [data-op=dup]'); await page.waitForTimeout(400);
    check(tag + 'y sus acciones andan: duplicar el bloque', (await page.locator('.lmd-article > p', { hasText: 'What is left before we ship' }).count()) === 2);
    await press(page, page.locator('.lmd-article > p.lmd-editable').nth(1)); await page.waitForTimeout(200);
    check(tag + 'editando, mantener apretado no abre el menú de bloques: ahí se elige texto', (await page.locator('.lmd-menu').count()) === 0);

    // La barra de formato va abajo, pegada al borde de lo que se ve
    await para.tap();
    await page.evaluate(() => { const p = document.querySelector('.lmd-article > p.lmd-editable'); const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 12); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.waitForTimeout(350);
    const fbar = await page.evaluate(() => { const b = document.querySelector('.lmd-format'); const r = b.getBoundingClientRect(); const sel = getSelection().getRangeAt(0).getBoundingClientRect(); return { seen: !b.hidden, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), sel: Math.round(sel.bottom), h: window.innerHeight, low: Math.min(...[...b.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().height)) }; });
    check(tag + 'la barra de formato queda abajo, lejos de lo elegido y dentro de la pantalla', fbar.seen && fbar.top > fbar.h * 0.7 && fbar.bottom <= fbar.h && fbar.left >= 0 && fbar.right <= W && fbar.top > fbar.sel + 60 && fbar.low >= 40, fbar);
    await page.tap('.lmd-format [data-fmt=bold]'); await page.waitForTimeout(200);
    check(tag + 'y aplica el formato a lo elegido', await page.evaluate(() => /^(B|STRONG)$/.test((document.querySelector('.lmd-article > p.lmd-editable').firstElementChild || {}).tagName || '')));

    // Teclado en pantalla: la zona visible se achica y lo de abajo sube con ella
    if (W === 390) {
      const kb = await page.evaluate(async () => {
        const vv = window.visualViewport; const tall = window.innerHeight;
        Object.defineProperty(vv, 'height', { configurable: true, get: () => tall - 320 });
        vv.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 150));
        const bar = document.querySelector('.lmd-format').getBoundingClientRect();
        const out = { kb: getComputedStyle(document.documentElement).getPropertyValue('--lmd-kb').trim(), cls: document.documentElement.classList.contains('lmd-kb'), bar: Math.round(bar.bottom), limit: tall - 320, foot: getComputedStyle(document.querySelector('.lmd-foot')).display, pad: parseFloat(getComputedStyle(document.querySelector('.lmd-article')).paddingBottom) };
        // El último renglón, con el cursor: tiene que quedar por encima del teclado y de la barra.
        const last = [...document.querySelectorAll('.lmd-article > p.lmd-editable')].pop(); last.focus(); const s = getSelection(); s.selectAllChildren(last); s.collapseToEnd();
        window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 100));
        last.scrollIntoView({ block: 'end' }); LMD.touch.caretIntoView(); await new Promise((r) => setTimeout(r, 150));
        out.caret = Math.round(last.getBoundingClientRect().bottom);
        delete vv.height; vv.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 100));
        out.after = [document.documentElement.classList.contains('lmd-kb'), getComputedStyle(document.querySelector('.lmd-foot')).display];
        return out;
      });
      check('con el teclado abierto, la barra de formato sube arriba del teclado y el pie se va', kb.kb === '320px' && kb.cls && kb.bar <= kb.limit && kb.foot === 'none' && kb.pad >= 320, kb);
      check('el renglón que se escribe queda por encima del teclado', kb.caret <= kb.limit, kb);
      check('al cerrarse el teclado todo vuelve a su lugar', J(kb.after) === J([false, 'flex']), kb.after);
    }

    // ---------- Selector de enlaces ----------
    await para.tap();
    await page.evaluate(() => { const p = document.querySelector('.lmd-article > p.lmd-editable'); const s = getSelection(); s.selectAllChildren(p.lastChild.nodeType === 3 ? p : p); const r = document.createRange(); const t = p.lastChild; r.setStart(t, 1); r.setEnd(t, 8); s.removeAllRanges(); s.addRange(r); });
    await page.waitForTimeout(350);
    await page.tap('.lmd-format [data-fmt=link]'); await page.waitForSelector('.lmd-lk-card');
    const inCard = (sel) => page.evaluate((q) => { const c = document.querySelector(q).getBoundingClientRect(); const kids = [...document.querySelectorAll(q + ' *')].filter((n) => n.offsetParent && !n.closest('.lmd-tpl-prev, .lmd-lk-list, .lmd-tpl-list, .lmd-cm-list, pre'));
      return { in: c.left >= 0 && c.right <= window.innerWidth && c.top >= 0 && c.bottom <= window.innerHeight, cut: kids.filter((n) => n.getBoundingClientRect().right > c.right + 1 || (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible' && n.tagName === 'BUTTON')).map((n) => n.className || n.tagName).slice(0, 4), lines: [...document.querySelectorAll(q + ' .lmd-seg button')].map((b) => b.getBoundingClientRect().height) }; }, sel);
    let card = await inCard('.lmd-lk-card');
    check(tag + 'el selector de enlaces entra en la pantalla, con sus tres destinos en un renglón', card.in && !card.cut.length && card.lines.length === 3 && Math.max(...card.lines) <= 40, card);
    await fits(page, tag + 'selector de enlaces');
    await page.tap('[data-lk=no]'); await page.waitForTimeout(200);

    // ---------- Comentarios para la IA (nota de la nube) ----------
    await page.tap('[data-act=mode-read]'); await page.waitForTimeout(500);
    check(tag + 'al salir de edición no queda la barra de formato', await page.evaluate(() => document.querySelector('.lmd-format').hidden));
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    if (!(await page.locator('.lmd-node', { hasText: 'launch.md' }).count() > 1)) await page.locator('.lmd-node', { hasText: 'work' }).first().tap();
    await page.locator('.lmd-xroot[data-root=cloud] .lmd-node', { hasText: 'launch.md' }).first().tap();
    await page.waitForFunction(() => /cloud/.test(decodeURIComponent(location.search)) && !!document.querySelector('.markdown-body h1'));
    await page.waitForFunction(() => !!LMD.sync.account());
    if (W === 390) {
      await page.evaluate(async () => {
        await LMD.cloud.comment('work/launch.md', 'What is left before we ship on Monday the 19th.', 'Make this opening shorter and say who the audience is.');
        await LMD.cloud.comment('work/launch.md', 'We track bookings per day.', 'Add the other two numbers.');
      });
    }
    await page.evaluate(() => LMD.comments.attach('work/launch.md')); await page.waitForSelector('.lmd-cm-mark');
    const mark = await page.evaluate(() => { const m = document.querySelector('.lmd-cm-mark').getBoundingClientRect(); const p = document.querySelector('.lmd-cm-has'); const r = document.createRange(); r.selectNodeContents(p); const text = Math.max(...[...r.getClientRects()].map((x) => x.right)); return { mark: [Math.round(m.left), Math.round(m.right)], text: Math.round(text), w: window.innerWidth }; });
    check(tag + 'la marca del comentario no tapa el texto ni se sale de la pantalla', mark.mark[0] >= mark.text && mark.mark[1] <= mark.w, mark);
    await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=sync]'); await page.waitForSelector('.lmd-menu [data-s=comments]');
    const cloudMenu = await page.evaluate(() => { const m = document.querySelector('.lmd-menu [data-s]').closest('.lmd-menu').getBoundingClientRect(); return { items: [...document.querySelectorAll('.lmd-menu [data-s]')].map((b) => b.dataset.s), in: m.left >= 0 && m.right <= window.innerWidth && m.bottom <= window.innerHeight }; });
    check(tag + '"más" lleva a las acciones de la nube: compartir, colaborar en vivo, historial, IA y comentarios', J(cloudMenu.items) === J(['share', 'live', 'history', 'ai', 'comments']) && cloudMenu.in, cloudMenu);
    await page.tap('.lmd-menu [data-s=comments]'); await page.waitForSelector('.lmd-cm-card li');
    card = await inCard('.lmd-cm-card');
    check(tag + 'la lista de comentarios para la IA entra en la pantalla', card.in && !card.cut.length && (await page.locator('.lmd-cm-card li').count()) === 2, card);
    await fits(page, tag + 'comentarios para la IA');
    await page.tap('[data-cm=close]');
    if (W === 390) {
      await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=sync]'); await page.tap('.lmd-menu [data-s=share]'); await page.waitForSelector('.lmd-share');
      card = await inCard('.lmd-share');
      check('compartir entra en la pantalla', card.in && !card.cut.length, card);
      await fits(page, 'compartir'); await page.tap('[data-sh=close]');
    }

    // ---------- Papelera de la nube ----------
    if (W === 390) {
      const OLD = 'work/an-old-note-with-a-rather-long-name-for-a-phone.md';
      await api('PUT', '/notes/' + encodeURIComponent(OLD), { text: '# Old\n' }, session); await api('DELETE', '/notes/' + encodeURIComponent(OLD), undefined, session);
      await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
      const bin = page.locator('.lmd-xroot[data-root=cloud] > .lmd-trash-link'); await bin.scrollIntoViewIfNeeded();
      const binBox = await bin.boundingBox();
      await bin.tap(); await page.waitForSelector('.lmd-trash li'); await page.waitForTimeout(350);
      card = await inCard('.lmd-trash');
      const taps = await page.evaluate(() => [...document.querySelectorAll('.lmd-trash-acts button, .lmd-trash .lmd-ask-actions button')].map((b) => Math.round(b.getBoundingClientRect().height)));
      check('la papelera se abre desde el explorador, cierra la barra y entra en la pantalla, con botones para el dedo', binBox.height >= 40 && !(await drawer()).open && card.in && !card.cut.length && taps.length === 4 && Math.min(...taps) >= 40, [binBox, card, taps]);
      await fits(page, 'papelera');
      await page.tap('.lmd-trash [data-tr=back]'); await page.waitForSelector('.lmd-trash-none');
      check('y restaura con un toque', (await api('GET', '/notes/' + encodeURIComponent(OLD), undefined, session)).status === 200);
      await page.tap('.lmd-trash [data-tr=no]');
      await api('DELETE', '/notes/' + encodeURIComponent(OLD) + '?forever=1', undefined, session);
    }

    // ---------- Ajustes ----------
    await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=settings]'); await page.waitForSelector('.lmd-panel-card');
    const panel = await page.evaluate(() => { const c = document.querySelector('.lmd-panel-card').getBoundingClientRect(); const nav = document.querySelector('.lmd-ptabs'); const tabs = [...nav.querySelectorAll('[data-ptab]')];
      return { box: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], screen: [window.innerWidth, window.innerHeight], row: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size, slides: nav.scrollWidth > nav.clientWidth && getComputedStyle(nav).overflowX === 'auto',
        text: tabs.every((t) => t.querySelector('span').offsetParent && t.querySelector('span').textContent.trim()), low: Math.min(...tabs.map((t) => t.getBoundingClientRect().height)), above: nav.getBoundingClientRect().bottom <= document.querySelector('.lmd-panel-body').getBoundingClientRect().top + 1 }; });
    check(tag + 'los ajustes ocupan toda la pantalla', J(panel.box) === J([0, 0, panel.screen[0], panel.screen[1]]), panel);
    check(tag + 'las pestañas van arriba en una fila que se desliza, con texto y 40 px de alto', panel.row === 1 && panel.slides && panel.text && panel.low >= 40 && panel.above, panel);
    for (const tab of ['look', 'read', 'plug', 'cloud', 'ai', 'plan', 'inst', 'adv']) {
      await page.tap('[data-ptab=' + tab + ']'); await page.waitForTimeout(tab === 'cloud' || tab === 'ai' || tab === 'plan' ? 700 : 200);
      const t = await page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const on = document.querySelector('[data-ptab].lmd-on').getBoundingClientRect();
        const cols = [...body.querySelectorAll('section:not([hidden]).lmd-two, section:not([hidden]) .lmd-grid, section:not([hidden]) .lmd-plans')].map((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
        return { wide: body.scrollWidth - body.clientWidth, cols, tab: on.left >= 0 && on.right <= window.innerWidth, cut: [...body.querySelectorAll('section:not([hidden]) *')].filter((n) => n.offsetParent && n.getBoundingClientRect().right > window.innerWidth + 1).length }; });
      check(tag + 'ajustes, pestaña ' + tab + ': una columna, sin cortes y con la pestaña a la vista', t.wide <= 0 && t.cols.every((n) => n === 1) && t.tab && !t.cut, t);
      await fits(page, tag + 'ajustes, pestaña ' + tab);
    }
    if (W === 390) {
      await page.tap('[data-ptab=ai]'); await page.waitForSelector('[data-acct=ai] [data-c=token]'); await page.tap('[data-acct=ai] [data-c=token]'); await page.waitForSelector('.lmd-ai-new');
      const cmd = await page.evaluate(() => { const t = document.querySelector('[data-acct=ai] .lmd-field-long textarea'); const r = t.getBoundingClientRect(); return { cut: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 2, inside: r.left >= 0 && r.right <= window.innerWidth, whole: /--header "Authorization: Bearer mdt_\S+"$/.test(t.value), name: document.querySelector('.lmd-tokens li span').textContent.split(' · ')[0] }; });
      check(tag + 'el comando para conectar la IA se ve entero, y el token se llama "AI"', !cmd.cut && cmd.inside && cmd.whole && cmd.name === 'AI', cmd);
      await fits(page, tag + 'ajustes, IA con un token recién creado');
    }
    await page.tap('[data-act=close-panel]');
    check(tag + 'la cruz cierra los ajustes', await page.evaluate(() => document.querySelector('.lmd-panel').hidden));

    // ---------- Explorador con el dedo, renombrar y plantillas ----------
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    await press(page, page.locator('.lmd-xroot[data-root=local] .lmd-node', { hasText: 'groceries.md' }).first()); await page.waitForSelector('.lmd-menu [data-f]', { timeout: 4000 }).catch(() => {});
    const tree = await page.evaluate(() => { const b = document.querySelector('.lmd-menu [data-f]'); if (!b) return null; const m = b.closest('.lmd-menu').getBoundingClientRect(); return { items: [...document.querySelectorAll('.lmd-menu [data-f]')].map((x) => x.dataset.f), in: m.left >= 0 && m.right <= window.innerWidth && m.top >= 0 && m.bottom <= window.innerHeight }; });
    check(tag + 'mantener apretado un archivo abre su menú, dentro de la pantalla', tree && tree.items.includes('ren') && tree.items.includes('del') && tree.in, tree);
    await page.tap('.lmd-menu [data-f=ren]'); await page.waitForSelector('.lmd-dlg-card');
    card = await inCard('.lmd-dlg-card');
    const dlg = await page.evaluate(() => ({ top: document.querySelector('.lmd-dlg-card').getBoundingClientRect().bottom < window.innerHeight * 0.6, font: parseFloat(getComputedStyle(document.querySelector('.lmd-dlg-card input')).fontSize), low: Math.min(...[...document.querySelectorAll('.lmd-dlg-card button')].map((b) => b.getBoundingClientRect().height)) }));
    check(tag + 'renombrar: el diálogo entra, queda arriba (lejos del teclado) y no hace zoom al escribir', card.in && !card.cut.length && dlg.top && dlg.font >= 16 && dlg.low >= 40, [card, dlg]);
    await fits(page, tag + 'diálogo de renombrar');
    await page.tap('[data-dlg=no]');
    await press(page, page.locator('.lmd-xroot[data-root=local] .lmd-node', { hasText: 'groceries.md' }).first()); await page.waitForSelector('.lmd-menu [data-f=del]');
    await page.tap('.lmd-menu [data-f=del]'); await page.waitForSelector('.lmd-dlg-card');
    card = await inCard('.lmd-dlg-card');
    check(tag + 'confirmar: el diálogo entra en la pantalla', card.in && !card.cut.length, card);
    await fits(page, tag + 'diálogo de confirmación');
    await page.tap('[data-dlg=no]');
    await page.tap('.lmd-tree-add'); await page.waitForSelector('.lmd-menu [data-f=tpl]'); await page.tap('.lmd-menu [data-f=tpl]'); await page.waitForSelector('.lmd-tpl-card');
    await page.waitForTimeout(250);
    const tpl = await page.evaluate(() => { const l = document.querySelector('.lmd-tpl-list').getBoundingClientRect(); const p = document.querySelector('.lmd-tpl-prev').getBoundingClientRect();
      return { below: p.top >= l.bottom, same: Math.abs(p.left - l.left) < 2 && Math.abs(p.width - l.width) < 2, list: Math.round(l.height), prev: Math.round(p.height), text: document.querySelector('.lmd-tpl-prev').textContent.trim().length, focus: document.activeElement.tagName, low: Math.min(...[...document.querySelectorAll('.lmd-tpl-list [data-id]')].slice(0, 3).map((b) => b.getBoundingClientRect().height)) }; });
    card = await inCard('.lmd-tpl-card');
    check(tag + 'plantillas: una columna, la lista arriba y la vista previa debajo', card.in && !card.cut.length && tpl.below && tpl.same && tpl.list >= 120 && tpl.prev >= 150 && tpl.text > 10 && tpl.low >= 40, [card, tpl]);
    check(tag + 'plantillas: el filtro no abre el teclado solo', tpl.focus !== 'INPUT', tpl.focus);
    await fits(page, tag + 'selector de plantillas');
    await page.tap('[data-tpl=no]');
    await ctx.close();
  }

  // ---------- Teléfono acostado ----------
  console.log('Teléfono acostado, 844x390');
  {
    const { ctx, page } = await open(844, 390, { serviceWorkers: 'block' });
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(async (text) => { await LMD.store.notePut('launch.md', text); await new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)); }, NOTE);
    await page.goto(home + '?f=' + encodeURIComponent('local/launch.md')); await page.waitForSelector('.markdown-body h1');
    const land = await page.evaluate(() => ({ small: LMD.touch.small(), acts: [...document.querySelectorAll('.lmd-topbar [data-act]')].filter((b) => b.offsetParent).map((b) => b.dataset.act), side: document.querySelector('.lmd-sidebar').getBoundingClientRect().right, main: Math.round(document.querySelector('.lmd-main').getBoundingClientRect().width) }));
    check('acostado también es pantalla chica: barra lateral cerrada y menú "más"', land.small && land.side <= 0 && land.main === 844 && land.acts.includes('more') && !land.acts.includes('print'), land);
    await fits(page, 'acostado, una nota leyendo');
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    const zones = await page.evaluate(() => { const z = document.querySelector('.lmd-zones'); return { scroll: z.scrollHeight > z.clientHeight && getComputedStyle(z).overflowY === 'auto', links: document.querySelectorAll('.lmd-pane-outline a.lmd-o-link').length }; });
    check('acostado, el índice y el explorador se deslizan juntos en el panel', zones.scroll && zones.links >= 3, zones);
    await page.locator('.lmd-pane-outline a.lmd-o-link', { hasText: 'After launch' }).tap(); await page.waitForTimeout(700);
    check('y tocar una sección del índice cierra el panel y lleva a ella', await page.evaluate(() => !document.documentElement.classList.contains('lmd-side-open') && window.scrollY > 200));
    await page.tap('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editable');
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const m = await page.evaluate(() => { const r = document.querySelector('.lmd-menu-more').getBoundingClientRect(); return { in: r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth, rows: document.querySelectorAll('.lmd-menu-more button').length, h: Math.round(r.height), screen: window.innerHeight }; });
    check('acostado, el menú "más" queda entero dentro de la pantalla', m.in && m.rows === 8, m);
    await fits(page, 'acostado, menú "más"');
    await ctx.close();
  }

  // ---------- Atajo "New note" ----------
  console.log('Atajo de nota nueva y manifiesto');
  {
    const { ctx, page } = await open(390, 844, { serviceWorkers: 'block' });
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    const link = await page.evaluate(() => ({ href: document.querySelector('link[rel=manifest]').href, theme: (document.querySelector('meta[name=theme-color]') || {}).content, fit: document.querySelector('meta[name=viewport]').content }));
    const shortcut = manifest.shortcuts[0]; const sizes = manifest.icons.map((i) => i.sizes);
    check('la app enlaza el manifiesto, con el color del tema y viewport-fit=cover', link.href === origin + '/manifest.webmanifest' && link.theme === '#121418' && /viewport-fit=cover/.test(link.fit), link);
    check('el manifiesto: SharpMD, pantalla completa, tema oscuro, íconos de 192 y 512 que existen', manifest.name === 'SharpMD' && manifest.display === 'standalone' && manifest.background_color === '#121418' && manifest.theme_color === '#121418' &&
      sizes.includes('192x192') && sizes.includes('512x512') && manifest.icons.every((i) => fs.existsSync(path.join(root, i.src))) && new URL(manifest.start_url, origin + '/').href === home, [manifest.start_url, sizes]);
    const pngSize = (file) => { const b = fs.readFileSync(path.join(root, file)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
    check('cada ícono mide lo que dice', manifest.icons.every((i) => pngSize(i.src) === i.sizes), manifest.icons.map((i) => [i.sizes, pngSize(i.src)]));
    const target = new URL(shortcut.url, origin + '/').href;
    check('el atajo se llama "New note" y abre la app con ?new=1', shortcut.name === 'New note' && target === home + '?new=1', shortcut);
    await page.goto(target); await page.waitForSelector('.lmd-editing .lmd-article', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const made = await page.evaluate(async () => ({ f: decodeURIComponent(new URLSearchParams(location.search).get('f') || ''), editing: document.documentElement.classList.contains('lmd-editing'), nodoc: document.documentElement.classList.contains('lmd-nodoc'),
      notes: (await LMD.store.notesAll()).map((n) => n.name), writing: !!document.activeElement && document.activeElement.isContentEditable, hasNew: new URLSearchParams(location.search).has('new') }));
    check('el atajo crea una nota vacía donde van las notas nuevas y la abre en edición', /^local\/note-\d{8}-\d{4}\.md$/.test(made.f) && made.editing && !made.nodoc && made.notes.length === 1 && made.f.endsWith(made.notes[0]) && !made.hasNew, made);
    check('y deja el cursor listo para escribir', made.writing, made);
    await page.keyboard.type('Bought milk'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
    check('lo escrito queda guardado en la nota', /Bought milk/.test(await page.evaluate(async () => (await LMD.store.notesAll())[0].text)));
    await fits(page, 'nota nueva en edición');
    await ctx.close();
  }

  // ---------- Sin conexión ----------
  console.log('Service worker: la app sin red');
  {
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const shell = eval(/const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1]);
    const html = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
    const used = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => path.posix.normalize('src/' + m[1]));
    check('el esqueleto guardado incluye la página y todo lo que ella carga', shell.includes('src/app.html') && used.length > 30 && used.every((u) => shell.includes(u)), used.filter((u) => !shell.includes(u)));
    check('y cada archivo de esa lista existe', shell.every((u) => fs.existsSync(path.join(root, u))), shell.filter((u) => !fs.existsSync(path.join(root, u))));
    const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
    check('sw.js y el manifiesto del sitio no van en el paquete de la extensión', /^\/sw\.js export-ignore\r?$/m.test(attrs) && /^\/manifest\.webmanifest export-ignore\r?$/m.test(attrs));
    const ext = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    check('la extensión no registra ese service worker', ext.background.service_worker === 'src/background.js' && !/sw\.js/.test(JSON.stringify(ext)) && /chrome\.runtime\.id\) return;/.test(fs.readFileSync(path.join(root, 'src', 'web.js'), 'utf8').split('serviceWorker')[0]));

    const { ctx, page } = await open(390, 844);
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { url: r.active.scriptURL, scope: r.scope, v: LMD.VERSION }; });
    check('la versión web registra el service worker con la versión en la dirección', reg.url === origin + '/sw.js?v=' + reg.v && reg.scope === origin + '/', reg);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => LMD.store.notePut('offline.md', '# Offline note\n\nStill here without a network.\n'));
    // Un pedido a otro origen (el servidor de sincronización) pasa de largo: ni se responde desde la caché ni se guarda.
    await page.evaluate((url) => fetch(url + '/health').catch(() => null), base);
    await page.goto(home + '?f=' + encodeURIComponent('local/offline.md')); await page.waitForSelector('.markdown-body h1');
    const cached = await page.evaluate(async () => { const keys = await caches.keys(); const urls = []; for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(r.url); return { keys, urls }; });
    check('la caché lleva la versión en el nombre', J(cached.keys) === J(['sharpmd-' + reg.v]), cached.keys);
    check('en la caché hay solo archivos de la app: nada de otro origen ni del resto del sitio', cached.urls.length >= 40 && cached.urls.every((u) => /^(src|vendor|icons)\/|^manifest\.webmanifest$/.test(u.slice(origin.length + 1)) && u.startsWith(origin + '/')) && !cached.urls.some((u) => u.includes('?')), cached.urls.filter((u) => !u.startsWith(origin + '/src/') && !u.startsWith(origin + '/vendor/')).slice(0, 6));
    await page.goto(origin + '/privacy.html'); await page.waitForSelector('h1');
    check('la portada y el resto del sitio no pasan por la caché', !(await page.evaluate(async () => { for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (/privacy/.test(r.url)) return true; return false; })));

    await ctx.setOffline(true);
    const seen = hits.length;
    await page.goto(home, { timeout: 15000 }).catch((e) => errors.push('sin red: ' + e.message.split('\n')[0]));
    await page.waitForSelector('.lmd-home [data-home=new]', { timeout: 8000 }).catch(() => {});
    const off = await page.evaluate(() => ({ app: !!window.LMD && !!document.querySelector('.lmd-home [data-home=new]'), online: navigator.onLine, font: document.fonts.check('16px "MDT Inter"'), logo: (document.querySelector('.lmd-home-logo') || {}).naturalWidth || 0 })).catch(() => ({}));
    check('sin red la app vuelve a abrir, con su letra y su ícono', off.app && off.online === false && off.font && off.logo > 0 && hits.length === seen, [off, hits.slice(seen)]);
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    await page.locator('.lmd-node', { hasText: 'offline.md' }).first().tap(); await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    check('y se abre una nota guardada en el navegador', (await page.textContent('.markdown-body h1').catch(() => '')).startsWith('Offline note'));
    await page.tap('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editable');
    await page.locator('.lmd-article > p.lmd-editable').first().tap(); await page.keyboard.press('End'); await page.keyboard.type(' Edited offline.'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
    check('que se puede editar y queda guardada', /Edited offline\./.test(await page.evaluate(async () => (await LMD.store.noteGet('offline.md')).text)));
    await page.goto(home + '?new=1', { timeout: 15000 }).catch(() => {}); await page.waitForSelector('.lmd-editing .lmd-article', { timeout: 8000 }).catch(() => {});
    check('sin red también anda el atajo de nota nueva', await page.evaluate(() => /^local\//.test(new URLSearchParams(location.search).get('f') || '')).catch(() => false));
    await ctx.setOffline(false);
    // Con red de nuevo, la página se pide al servidor: nadie queda con el HTML viejo.
    const mark = hits.length;
    await page.goto(home); await page.waitForSelector('.lmd-home');
    check('con red, el HTML de la app se pide otra vez al servidor', hits.slice(mark).includes('/src/app.html'), hits.slice(mark).slice(0, 5));
    // Una versión nueva arma su caché y borra la anterior.
    const next = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.register('../sw.js?v=9.9.9', { scope: '../' });
      await new Promise((resolve) => { const w = r.installing || r.waiting; if (!w) return resolve(); w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(); }); setTimeout(resolve, 8000); });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return caches.keys();
    });
    check('una versión nueva arma su caché y borra la anterior', J(next) === J(['sharpmd-9.9.9']), next);
    await ctx.close();
  }

  // ---------- En escritorio nada cambia ----------
  console.log('Escritorio');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', serviceWorkers: 'block' });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(async (text) => { await LMD.store.notePut('desk.md', text); await new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)); }, NOTE);
    await page.goto(home + '?f=' + encodeURIComponent('local/desk.md')); await page.waitForSelector('.markdown-body h1');
    const desk = await page.evaluate(() => { const cs = (q) => getComputedStyle(document.querySelector(q)); const side = document.querySelector('.lmd-sidebar').getBoundingClientRect();
      return { more: cs('.lmd-more').display, scrim: cs('.lmd-scrim').display, side: [Math.round(side.left), Math.round(side.width)], main: cs('.lmd-main').marginLeft, bar: cs('.lmd-topbar').height, barPad: [cs('.lmd-topbar').paddingLeft, cs('.lmd-topbar').paddingRight, cs('.lmd-topbar').paddingTop], foot: [cs('.lmd-foot').height, cs('.lmd-foot').left, cs('.lmd-foot').paddingLeft],
        btn: cs('.lmd-icon-btn').height, pad: cs('.lmd-article').paddingLeft, acts: [...document.querySelectorAll('.lmd-topbar [data-act]')].filter((b) => b.offsetParent).map((b) => b.dataset.act), table: cs('.markdown-body table').maxWidth, node: Math.round(document.querySelector('.lmd-node').getBoundingClientRect().height) }; });
    check('en escritorio la barra lateral sigue fija a la izquierda y el contenido a su lado', J(desk.side) === J([0, 300]) && desk.main === '300px' && desk.scrim === 'none', desk);
    check('la barra de arriba conserva sus botones y sus medidas, sin el menú "más"', desk.more === 'none' && desk.bar === '49px' && J(desk.barPad) === J(['12px', '16px', '0px']) && desk.btn === '32px' && !desk.acts.includes('more') && ['view-doc', 'view-raw', 'copy-md', 'copy-rich', 'reload', 'print', 'export-html', 'settings'].every((a) => desk.acts.includes(a)), desk);
    check('el pie, el documento y el árbol miden lo de siempre', J(desk.foot) === J(['30px', '300px', '16px']) && desk.pad === '48px' && desk.table === '100%' && desk.node < 34, desk);
    await page.fill('.lmd-search input', 'bookings'); await page.waitForSelector('.lmd-results-sum');
    const sum = await page.textContent('.lmd-results-sum');
    check('la cuenta de la búsqueda, que se arma por partes, sale en inglés', /^\d+ match(es)? in \d+ files? \(of \d+\)$/.test(sum.trim()), sum);
    await page.fill('.lmd-search input', '');
    await page.click('[data-act=sidebar]'); await page.waitForTimeout(400);
    check('y el botón de la barra lateral sigue guardando la preferencia', await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get('settings', (r) => resolve(r.settings.sidebarHidden === true && document.documentElement.classList.contains('lmd-side-hidden') && !document.documentElement.classList.contains('lmd-side-open'))))));
    await ctx.close();
  }

  check('ningún pedido salió a la nube de verdad', outside.length === 0, outside);
  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) {
  check('la prueba corrió hasta el final', false, String(e && e.stack || e).split('\n').slice(0, 4));
} finally {
  await browser.close(); site.close(); server.kill();
  try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* el servidor todavía lo está soltando */ }
}
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
