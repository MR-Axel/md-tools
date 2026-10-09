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
const published = { mark: '', version: '', cut: '', gone: '' }; // una publicación nueva de la app: la página y un script cambian a la vez
// version: la app publicada dice otro número. cut: ese archivo no llega (se corta la conexión). gone: ese archivo ya no está.
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  hits.push(rel);
  if (published.cut === rel) { req.socket.destroy(); return; }
  if (published.gone === rel) { res.writeHead(404); res.end(); return; }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  if (published.mark && rel === '/src/app.html') { res.end(fs.readFileSync(file, 'utf8').replace('<body>', '<body data-published="' + published.mark + '">')); return; }
  if (published.version && rel === '/src/defaults.js') { res.end(fs.readFileSync(file, 'utf8').replace(/const VERSION = '[^']+'/, "const VERSION = '" + published.version + "'")); return; }
  if (published.mark && rel === '/src/kit.js') { res.end(fs.readFileSync(file, 'utf8') + '\nwindow.__published = "' + published.mark + '";\n'); return; }
  fs.createReadStream(file).pipe(res);
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
    check(tag + 'sin nota, arriba quedan la barra lateral, claro u oscuro y los ajustes', J(empty.bar) === J(['sidebar', 'theme-flip', 'settings']), empty.bar);
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

    // Entrar a la cuenta: la fila "Not signed in" vive en el panel deslizable; al tocarla el panel se cierra y el
    // formulario queda a la vista, en la tarjeta del inicio.
    if (W === 390) {
      await page.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url } }, resolve)), base);
      await page.goto(home); await page.waitForSelector('[data-cloud=ask]', { state: 'attached' });
      await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
      const row = await page.evaluate(() => { const b = document.querySelector('.lmd-sidebar [data-cloud=ask]'); const r = b.getBoundingClientRect();
        return { title: b.querySelector('b').textContent, sub: b.querySelector('small').textContent, h: r.height, in: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, open: document.documentElement.classList.contains('lmd-side-open') }; });
      await page.tap('[data-cloud=ask]'); await page.waitForSelector('.lmd-home-card .lmd-login [data-field=email]'); await page.waitForTimeout(350);
      const shown = await page.evaluate(() => { const f = document.querySelector('.lmd-home-card .lmd-login'); const r = f.getBoundingClientRect(); const input = f.querySelector('input'); const i = input.getBoundingClientRect(); const go = f.querySelector('[data-cloud=start]').getBoundingClientRect();
        return { drawer: document.documentElement.classList.contains('lmd-side-open'), in: r.left >= 0 && r.right <= window.innerWidth, input: i.height, go: go.height, font: parseFloat(getComputedStyle(input).fontSize), top: document.elementFromPoint((i.left + i.right) / 2, (i.top + i.bottom) / 2) === input, fields: document.querySelectorAll('.lmd-sidebar [data-field]').length }; });
      check('sin sesión, el panel lateral trae la fila "Not signed in" con qué da entrar', row.title === 'Not signed in' && row.sub === 'Sign in to sync your notes' && row.h >= 44 && row.in && row.open, row);
      check('al tocarla el panel se cierra y el formulario de entrar queda a la vista, con campos cómodos para el dedo', !shown.drawer && shown.in && shown.input >= 40 && shown.go >= 40 && shown.font >= 16 && shown.top && shown.fields === 0, shown);
      await fits(page, 'formulario de entrar');
      await page.tap('.lmd-login [data-cloud=cancel]');
      check('"Cancel" lo cierra', (await page.locator('.lmd-login').count()) === 0);
    }


    // Cuenta y notas: una en el navegador y una en la nube
    await page.evaluate(async ([url, s, m, text]) => {
      await LMD.store.notePut('groceries.md', '# Groceries\n\n- [ ] Coffee\n- [x] Bread\n');
      await LMD.store.notePut('launch.md', text);
      await new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: s, email: m } }, resolve));
    }, [base, session, mail, NOTE]);
    await page.goto(home); await page.waitForSelector('.lmd-home-acct', { state: 'attached' });
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
    // La cuenta vive al pie del panel lateral: una fila alta para el dedo, con su menú adentro del panel.
    const acct = await page.evaluate(() => { const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); const b = document.querySelector('.lmd-sidebar [data-cloud=menu]'); const r = b.getBoundingClientRect();
      return { h: Math.round(r.height), inside: r.left >= side.left && r.right <= side.right && r.bottom <= window.innerHeight, low: window.innerHeight - r.bottom < 40, text: b.innerText, inCard: document.querySelectorAll('.lmd-home [data-cloud]').length }; });
    check(tag + 'la cuenta está al pie del panel lateral, en una fila alta para el dedo', acct.h >= 44 && acct.inside && acct.low && /@/.test(acct.text) && /note/.test(acct.text) && acct.inCard === 0, acct);
    await page.tap('.lmd-sidebar [data-cloud=menu]'); await page.waitForSelector('.lmd-side-acct .lmd-menu');
    const acctMenu = await page.evaluate(() => { const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); const m = document.querySelector('.lmd-side-acct .lmd-menu').getBoundingClientRect();
      return { inside: m.left >= side.left && m.right <= side.right && m.top >= 0, acts: [...document.querySelectorAll('.lmd-side-acct .lmd-menu [data-cloud]')].map((x) => x.dataset.cloud), low: Math.min(...[...document.querySelectorAll('.lmd-side-acct .lmd-menu button')].map((x) => x.getBoundingClientRect().height)) }; });
    check(tag + 'su menú abre dentro del panel, con renglones de 44 px', acctMenu.inside && acctMenu.acts.join() === 'plan,ai,name,logout' && acctMenu.low >= 44, acctMenu);
    await fits(page, tag + 'barra lateral abierta, con el menú de la cuenta');
    await page.tap('.lmd-sidebar [data-cloud=menu]'); await page.waitForSelector('.lmd-side-acct .lmd-menu', { state: 'detached' });
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
    check(tag + 'el menú "más" trae la nube, insertar, la vista de código, copiar, exportar, compartir, los ajustes de la página, claro u oscuro, ajustes y los atajos, sin recargar (la nota es del navegador)', J(more.acts) === J(['sync', 'insert', 'view-raw', 'copy', 'export', 'share-out', 'page', 'theme-flip', 'settings', 'shortcuts']), more.acts);
    check(tag + 'cada renglón del menú lleva ícono y texto, mide 40 px o más y queda a la derecha', more.icons && more.low >= 40 && more.in && more.right <= 12, more);
    await fits(page, tag + 'editando con el menú "más" abierto');
    // Copiar y exportar abren, desde "más", el mismo menú que en escritorio cuelga de su botón: sub es la opción de ese menú.
    const pick = async (act, sub) => { if (!(await page.locator('.lmd-menu-more').count())) { await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more'); } await page.tap('.lmd-menu-more [data-more=' + act + ']');
      if (sub) { await page.waitForSelector('.lmd-menu-top'); await page.tap('.lmd-menu-top [data-more=' + sub + ']'); } await page.waitForTimeout(250); };
    if (W === 390) {
      await pick('view-raw');
      check('"más": ver el código fuente', await page.evaluate(() => !document.querySelector('.lmd-raw-edit').hidden && document.querySelector('.lmd-article').hidden && !document.querySelector('.lmd-menu-more')));
      await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
      check('"más": con el código a la vista ofrece volver al documento', (await page.locator('.lmd-menu-more [data-more=view-doc]').count()) === 1 && (await page.locator('.lmd-menu-more [data-more=insert]').count()) === 0);
      await pick('view-doc');
      check('"más": volver al documento', await page.evaluate(() => !document.querySelector('.lmd-article').hidden));
      // Claro u oscuro: en el teléfono el botón de la barra va acá, pasa al contrario de lo que se ve y lo deja fijo
      const mode = () => page.evaluate(() => ({ dark: document.documentElement.classList.contains('lmd-dark'), saved: JSON.parse(localStorage.getItem('mdtools:settings') || '{}').theme, said: document.querySelector('.lmd-status').textContent, boot: localStorage.getItem('lmd:mode') + localStorage.getItem('lmd:dark') }));
      const m0 = await mode();
      await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
      const label = await page.textContent('.lmd-menu-more [data-more=theme-flip]');
      await pick('theme-flip'); await page.waitForTimeout(350); const m1 = await mode();
      await pick('theme-flip'); await page.waitForTimeout(350); const m2 = await mode();
      check('"más": claro u oscuro pasa al contrario de lo que se ve, lo guarda fijo, lo avisa, y vuelve', label.trim() === (m0.dark ? 'Switch to light' : 'Switch to dark') && m1.dark === !m0.dark && m1.saved === (m1.dark ? 'dark' : 'light') && m1.said === (m1.dark ? 'Dark theme' : 'Light theme') && m1.boot === (m1.dark ? 'dark1' : 'light0') && m2.dark === m0.dark && m2.saved === (m0.dark ? 'dark' : 'light'), [label, m0, m1, m2]);
      await pick('copy'); await page.waitForSelector('.lmd-menu-copy');
      const copyMenu = await page.evaluate(() => { const m = document.querySelector('.lmd-menu-copy'); const r = m.getBoundingClientRect(); const bs = [...m.querySelectorAll('button')];
        return { acts: bs.map((b) => b.dataset.more), low: Math.min(...bs.map((b) => b.getBoundingClientRect().height)), in: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, more: !!document.querySelector('.lmd-menu-more'), open: document.querySelector('[data-act=more]').getAttribute('aria-expanded') }; });
      check('"más" > copiar: Markdown, texto con formato y HTML, en renglones de 40 px o más, sin el menú "más" detrás', J(copyMenu.acts) === J(['copy-md', 'copy-rich', 'copy-html']) && copyMenu.low >= 40 && copyMenu.in && !copyMenu.more && copyMenu.open === 'true', copyMenu);
      await fits(page, 'menú de copiar');
      await away(page);
      await pick('copy', 'copy-md');
      check('"más": copiar Markdown', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('# Booking app launch'));
      await pick('copy', 'copy-rich'); await page.waitForTimeout(300);
      check('"más": copiar con formato', /Booking app launch/.test(await page.evaluate(() => navigator.clipboard.readText())) && /Copied with formatting/.test(await page.textContent('.lmd-status')));
      await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
      await pick('copy', 'copy-html'); await page.waitForTimeout(300);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      check('"más": copiar el HTML, sin nada de la interfaz', /^<h1[^>]*>Booking app launch/.test(copied) && !/contenteditable|data-l=|lmd-add|lmd-anchor/.test(copied) && /HTML copied/.test(await page.textContent('.lmd-status')), copied.slice(0, 200));
      await pick('export'); await page.waitForSelector('.lmd-menu-export');
      const exportMenu = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export button')].map((b) => b.dataset.more + ':' + b.querySelector('span').textContent + (b.querySelector('kbd') ? ':' + b.querySelector('kbd').textContent : '')));
      check('"más" > exportar: PDF, archivo HTML, el .md e imprimir con su atajo', J(exportMenu) === J(['export-pdf:PDF', 'export-html:HTML file', 'export-md:Markdown file (.md)', 'print:Print:Ctrl+P', 'export-folder:The whole folder…']), exportMenu);
      await fits(page, 'menú de exportar');
      await away(page);
      await pick('export', 'print');
      check('"más": imprimir', (await page.evaluate(() => window.__printed)) === 1);
      await pick('export', 'export-pdf');
      check('"más": PDF sale por la impresión', (await page.evaluate(() => window.__printed)) === 2);
      const [download] = await Promise.all([page.waitForEvent('download'), pick('export', 'export-html')]);
      check('"más": descargar como HTML', /\.html$/.test(download.suggestedFilename()), download.suggestedFilename());
      const [plain] = await Promise.all([page.waitForEvent('download'), pick('export', 'export-md')]);
      check('"más": descargar el .md, con el Markdown de la nota', /\.md$/.test(plain.suggestedFilename()) && fs.readFileSync(await plain.path(), 'utf8').startsWith('# Booking app launch'), plain.suggestedFilename());
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
    const handle = await page.evaluate(() => { const h = document.querySelector('.lmd-handle'); const r = h.getBoundingClientRect(); const p = document.querySelector('.lmd-article > p.lmd-editable').getBoundingClientRect(); return { seen: !h.hidden, left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), text: Math.round(p.left), dy: Math.abs(r.top - p.top), hit: Math.min(parseFloat(getComputedStyle(h, '::before').width), parseFloat(getComputedStyle(h, '::before').height)) }; });
    // La manija se ve chica para entrar en el margen sin tocar el campo; la zona de toque sobresale hasta 44 px.
    check(tag + 'al tocar un bloque su manija queda a la vista, al costado del texto, con 44 px para el dedo', handle.seen && handle.left >= 0 && handle.right <= handle.text - 8 && handle.dy < 12 && handle.h >= 30 && handle.hit >= 44, handle);
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
      // Compartir hacia otra app, con una nota de la nube y el plan que deja crear enlaces: el enlace se pide con un
      // toque y se manda con otro, para que la hoja del sistema abra dentro de un gesto.
      await page.evaluate(() => { window.__shared = []; Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push({ url: d.url || '', text: d.text || '', active: !!(navigator.userActivation && navigator.userActivation.isActive) }); return Promise.resolve(); } }); });
      const outSheet = async () => { await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=share-out]'); await page.waitForSelector('.lmd-so-card'); };
      await outSheet();
      check('en una nota de la nube, compartir hacia otra app ofrece también un enlace', await page.evaluate(() => [...document.querySelectorAll('.lmd-so-list [data-so]')].map((b) => b.dataset.so).includes('link')));
      await page.tap('.lmd-so-list [data-so=link]'); await page.waitForSelector('.lmd-so-link input', { timeout: 8000 }).catch(() => {});
      let made = await page.evaluate(() => { const p = document.querySelector('.lmd-so-link'); return { url: (p.querySelector('input') || {}).value || '', note: (p.querySelector('.lmd-hint') || {}).textContent || '', acts: [...p.querySelectorAll('[data-so]')].map((b) => b.dataset.so), sent: window.__shared.length }; });
      check('el enlace público se crea y queda a la vista, con el aviso de copiarlo, sin compartir nada todavía', /\?f=pub%2F[\w-]+$/.test(made.url) && /not shown again/.test(made.note) && J(made.acts) === J(['send-link', 'copy-link']) && made.sent === 0, made);
      await fits(page, 'compartir un enlace hacia otra app');
      await page.tap('[data-so=send-link]'); await page.waitForTimeout(300);
      const sent = await page.evaluate(() => ({ open: !!document.querySelector('.lmd-so-card'), shared: window.__shared }));
      check('y mandarlo es un segundo toque: sale la dirección, dentro del gesto', !sent.open && sent.shared.length === 1 && sent.shared[0].url === made.url && sent.shared[0].active, sent);
      await outSheet(); await page.tap('.lmd-so-list [data-so=link]'); await page.waitForSelector('.lmd-so-link input', { timeout: 8000 }).catch(() => {});
      const again = await page.evaluate(() => { const p = document.querySelector('.lmd-so-link'); return { url: p.querySelector('input').value, note: !!p.querySelector('.lmd-hint') }; });
      check('al volver a pedirlo se reutiliza el mismo enlace, sin crear otro', again.url === made.url && !again.note && (await page.evaluate(async () => (await LMD.cloud.shares('work/launch.md')).links.length)) === 1, again);
      await page.tap('[data-so=close]');
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
    for (const tab of ['look', 'read', 'plug', 'cloud', 'ai', 'auto', 'plan', 'inst', 'adv']) {
      await page.tap('[data-ptab=' + tab + ']'); await page.waitForTimeout(tab === 'auto' ? 1200 : tab === 'cloud' || tab === 'ai' || tab === 'plan' ? 700 : 200);
      const t = await page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const on = document.querySelector('[data-ptab].lmd-on').getBoundingClientRect();
        const cols = [...body.querySelectorAll('section:not([hidden]).lmd-two, section:not([hidden]) .lmd-plug, section:not([hidden]) .lmd-plans, section:not([hidden]) .lmd-sec ul')].map((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
        return { wide: body.scrollWidth - body.clientWidth, cols, tab: on.left >= 0 && on.right <= window.innerWidth, cut: [...body.querySelectorAll('section:not([hidden]) *')].filter((n) => n.offsetParent && n.getBoundingClientRect().right > window.innerWidth + 1).length }; });
      check(tag + 'ajustes, pestaña ' + tab + ': una columna, sin cortes y con la pestaña a la vista', t.wide <= 0 && t.cols.every((n) => n === 1) && t.tab && !t.cut, t);
      if (tab === 'cloud') { const sec = await page.evaluate(() => { const s = document.querySelector('[data-acct=cloud] .lmd-sec'); return s ? { rows: s.querySelectorAll('[data-sec-row]').length, wide: s.scrollWidth - s.clientWidth, right: Math.round(s.getBoundingClientRect().right), screen: window.innerWidth } : null; });
        check(tag + 'el bloque de seguridad de la nube entra en la pantalla, sin scroll horizontal', !!sec && sec.rows === 5 && sec.wide <= 0 && sec.right <= sec.screen, sec); }
      await fits(page, tag + 'ajustes, pestaña ' + tab);
    }
    if (W === 390) {
      await page.tap('[data-ptab=ai]'); await page.waitForSelector('[data-acct=ai] [data-c=token]'); await page.tap('[data-acct=ai] [data-c=token]'); await page.waitForSelector('[data-acct=ai] .lmd-tokform');
      // El formulario del token nuevo: a una columna, con todo adentro de la pantalla y botones que se pueden tocar.
      const form = await page.evaluate(() => { const f = document.querySelector('[data-acct=ai] .lmd-tokform'); const box = (n) => { const r = n.getBoundingClientRect(); return { in: r.left >= 0 && r.right <= window.innerWidth + 1, h: Math.round(r.height) }; };
        return { self: box(f), name: box(f.querySelector('[data-c=tok-name]')), share: box(f.querySelector('[data-c=share]').closest('label')), buttons: [...f.querySelectorAll('button')].map(box), wide: document.querySelector('.lmd-panel-body').scrollWidth - document.querySelector('.lmd-panel-body').clientWidth }; });
      check(tag + 'el formulario de un token nuevo entra en la pantalla: el nombre, el permiso de compartir y sus dos botones se pueden tocar', form.self.in && form.name.in && form.name.h >= 40 && form.share.in && form.share.h >= 40 && form.buttons.length === 2 && form.buttons.every((b) => b.in && b.h >= 40) && form.wide <= 0, form);
      await page.tap('[data-acct=ai] [data-c=token-ok]'); await page.waitForSelector('.lmd-ai-new');
      const cmd = await page.evaluate(() => { const t = document.querySelector('[data-acct=ai] .lmd-field-long textarea'); const r = t.getBoundingClientRect(); return { cut: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 2, inside: r.left >= 0 && r.right <= window.innerWidth, whole: /--header "Authorization: Bearer mdt_\S+"$/.test(t.value), name: document.querySelector('.lmd-tokens li span').textContent.split(' · ')[0] }; });
      check(tag + 'el comando para conectar la IA se ve entero, y el token se llama "AI"', !cmd.cut && cmd.inside && cmd.whole && cmd.name === 'AI', cmd);
      const tk = await page.evaluate(() => { const box = (n) => { const r = n.getBoundingClientRect(); return { in: r.left >= 0 && r.right <= window.innerWidth + 1, h: Math.round(r.height) }; }; return { brief: box(document.querySelector('[data-acct=ai] [data-c=brief]')), row: [...document.querySelector('.lmd-tokens li').querySelectorAll('button')].map(box), card: box(document.querySelector('[data-acct=ai] .lmd-blk')), fresh: box(document.querySelector('[data-acct=ai] .lmd-fresh')), url: box(document.querySelector('[data-acct=ai] .lmd-kv.lmd-field')) }; });
      check(tag + 'copiar las instrucciones, las acciones de cada token, la tarjeta y el bloque del token nuevo entran en la pantalla y se pueden tocar', tk.brief.in && tk.brief.h >= 40 && tk.row.length === 3 && tk.row.every((b) => b.in && b.h >= 40) && tk.card.in && tk.fresh.in && tk.url.in, tk);
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

    // Listas de tareas y tablero, con el dedo
    await page.evaluate(() => LMD.store.notePut('lists.md', '# Lists\n\n- [ ] Coffee\n- [x] Bread\n\n```kanban\n{show=due,tags}\n## To do\n- [ ] Call the venue {due=2026-10-20 tags=bug}\n\n## Done\n- [x] Book flights\n```\n'));
    await page.goto(home + '?f=' + encodeURIComponent('local/lists.md')); await page.waitForSelector('.lmd-cl-add', { state: 'attached' }); await page.waitForTimeout(500);
    // Leyendo, en el teléfono no hay ni contador (son dos tareas), ni renglón de agregar, ni menú: nada para tocar sin querer
    const quiet = await page.evaluate(() => ({ count: !!document.querySelector('.lmd-cl-count'), add: getComputedStyle(document.querySelector('.lmd-cl-add')).visibility, more: getComputedStyle(document.querySelector('.lmd-cl-more')).visibility, bar: Math.round(document.querySelector('.lmd-cl-bar').getBoundingClientRect().height) }));
    await page.locator('.lmd-cl li.lmd-task-item input.lmd-task').first().tap(); await page.waitForTimeout(600);
    const tapped = await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-cl-add')).visibility + ' ' + getComputedStyle(document.querySelector('.lmd-cl-more')).visibility);
    await page.locator('.lmd-cl li.lmd-task-item input.lmd-task').first().tap(); await page.waitForTimeout(400);
    check(tag + 'lista de tareas leyendo: sin contador, sin agregar y sin menú, también después de tildar con el dedo', !quiet.count && quiet.add === 'hidden' && quiet.more === 'hidden' && quiet.bar === 0 && tapped === 'hidden hidden', [quiet, tapped]);
    await page.tap('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editing .lmd-cl-add'); await page.waitForTimeout(300);
    const cl = await page.evaluate(() => { const box = (s) => document.querySelector(s).getBoundingClientRect(); return { count: (document.querySelector('.lmd-cl-count') || {}).textContent || '', add: Math.round(box('.lmd-cl-add').height), grip: [Math.round(box('.lmd-cl-grip').width), Math.round(box('.lmd-cl-grip').height)], clear: document.querySelector('.lmd-cl-bar [data-cl=clear]') ? 'a la vista' : getComputedStyle(document.querySelector('.lmd-cl-bar .lmd-cl-more')).opacity, more: [Math.round(box('.lmd-cl-more').width), Math.round(box('.lmd-cl-more').height)], inside: box('.lmd-cl-grip').right <= innerWidth && box('.lmd-cl-grip').left >= 0 }; });
    check(tag + 'lista de tareas editando: agregar, mover y el menú con alto para el dedo', cl.count === '' && cl.add >= 40 && cl.grip[0] >= 32 && cl.grip[1] >= 32 && cl.clear === '1' && cl.more[0] >= 36 && cl.more[1] >= 32 && cl.inside, cl);
    // quitar los hechos con el dedo: el menú entra en la pantalla y pregunta antes de borrar
    await page.tap('.lmd-cl-bar .lmd-cl-more'); await page.waitForSelector('.lmd-cl-menu');
    const clm = await page.evaluate(() => { const m = document.querySelector('.lmd-cl-menu').getBoundingClientRect(); return { in: m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight, low: Math.min(...[...document.querySelectorAll('.lmd-cl-menu button')].map((b) => Math.round(b.getBoundingClientRect().height))), items: [...document.querySelectorAll('.lmd-cl-menu button')].map((b) => b.textContent) }; });
    await page.tap('.lmd-cl-menu [data-cl=clear]'); await page.waitForSelector('.lmd-dlg');
    const clq = await page.evaluate(() => document.querySelector('.lmd-dlg h3').textContent + ' | ' + document.querySelector('.lmd-dlg [data-dlg=ok]').textContent);
    await fits(page, tag + 'pregunta antes de quitar los hechos');
    await page.tap('.lmd-dlg [data-dlg=no]'); await page.waitForSelector('.lmd-dlg', { state: 'detached' });
    check(tag + 'lista de tareas: quitar los hechos va en un menú que entra en la pantalla y pregunta antes', clm.in && clm.low >= 32 && clm.items.join('|') === 'Move done to the bottom|Remove completed items…' && clq === 'Remove 1 completed item? | Remove' && (await page.locator('.lmd-cl li.lmd-task-item').count()) === 2, [clm, clq]);
    await page.tap('.lmd-cl-add'); await page.waitForSelector('.lmd-draft-li .lmd-draft');
    await page.keyboard.type('Milk'); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-draft-li .lmd-draft');
    await page.keyboard.type('Eggs'); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-draft-li .lmd-draft'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
    const listText = () => page.evaluate(async () => ((await LMD.store.notesAll()).find((n) => n.name === 'lists.md') || {}).text || '');
    check(tag + 'lista de tareas: se escribe, Enter agrega y sigue en el próximo, y Enter en uno vacío termina', /- \[ \] Coffee\n- \[x\] Bread\n- \[ \] Milk\n- \[ \] Eggs\n/.test(await listText()) && (await page.locator('.lmd-draft-li').count()) === 0, await listText());
    await fits(page, tag + 'lista de tareas en edición');
    // arrastrar la manija con el dedo
    try {
      const cdp = await ctx.newCDPSession(page); await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await page.waitForTimeout(700);
      const g = await page.locator('.lmd-cl li.lmd-task-item', { hasText: 'Eggs' }).locator('.lmd-cl-grip').boundingBox(); const top = await page.locator('.lmd-cl li.lmd-task-item').first().boundingBox();
      const x = g.x + g.width / 2; let y = g.y + g.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 0; i < 8; i++) { y -= (g.y + g.height / 2 - top.y - 2) / 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(1300);
      check(tag + 'lista de tareas: la manija se arrastra con el dedo', /- \[ \] Eggs\n- \[ \] Coffee\n- \[x\] Bread\n- \[ \] Milk\n/.test(await listText()), await listText());
    } catch (e) { check(tag + 'lista de tareas: la manija se arrastra con el dedo', false, String(e.message || e).slice(0, 200)); }
    await page.locator('.lmd-card').first().scrollIntoViewIfNeeded(); await page.locator('.lmd-card').first().tap(); await page.waitForSelector('.lmd-cd');
    await page.tap('.lmd-cd [data-cd=add-open]'); await page.tap('.lmd-cd [data-cd-type=person]'); await page.waitForSelector('.lmd-cd [data-cd=newval]');
    const cd = await page.evaluate(() => { const c = document.querySelector('.lmd-cd-card').getBoundingClientRect(); const hs = [...document.querySelectorAll('.lmd-cd-card button, .lmd-cd-card select, .lmd-cd-card input:not([type=checkbox])')].filter((n) => n.offsetParent).map((n) => Math.round(n.getBoundingClientRect().height));
      return { wide: c.left <= 16 && c.right >= innerWidth - 16 && c.right <= innerWidth, min: Math.min(...hs), cards: document.querySelectorAll('.lmd-card input, .lmd-card button').length, font: parseFloat(getComputedStyle(document.querySelector('.lmd-cd [data-cd=newval]')).fontSize), chips: [...document.querySelectorAll('.lmd-card .lmd-chip')].map((x) => x.textContent) }; });
    check(tag + 'tablero: un toque abre la tarjeta, el detalle ocupa el ancho y los controles tienen alto para el dedo', cd.wide && cd.min >= 32 && cd.cards === 0 && cd.font >= 16 && cd.chips.join('|') === 'Oct 20|bug', cd);
    await fits(page, tag + 'detalle de una tarjeta');
    await page.tap('.lmd-cd [data-cd=add-cancel]'); await page.tap('.lmd-cd [data-cd=no]'); await page.waitForSelector('.lmd-cd', { state: 'detached' });
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
    check('acostado, el menú "más" queda entero dentro de la pantalla', m.in && m.rows === 9, m);
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
    // Lo que la app pide después (LAZY_APP en content.js) se guarda aparte, ya con el service worker activo.
    const late = eval(/const LATE = (\[[\s\S]*?\]);/.exec(sw)[1]);
    const lazySrc = /const LAZY_APP = \{([\s\S]*?)\n\s*\};/.exec(fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8'))[1];
    const lazy = [...lazySrc.matchAll(/'((?:src|vendor)\/[^']+)'/g)].map((m) => m[1]).filter((u) => !/mermaid|viz-global/.test(u));
    check('lo que se carga después del primer pintado no está en la página y sí en la lista de después', lazy.length >= 9 && lazy.every((u) => late.includes(u) && !shell.includes(u) && !used.includes(u)), lazy.filter((u) => !late.includes(u) || used.includes(u)));
    check('los scripts de la página no frenan al analizador: todos llevan defer menos el del primer cuadro', [...html.matchAll(/<script([^>]*)src="([^"]+)"/g)].every((m) => /\bdefer\b/.test(m[1]) || m[2] === 'boot.js'));
    const ext0 = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[1].js;
    check('la extensión sigue llevando todo en su lista de scripts', lazy.filter((u) => /\.js$/.test(u) && !/katex/.test(u)).every((u) => ext0.includes(u)), lazy.filter((u) => !ext0.includes(u)));
    check('y cada archivo de esas listas existe', shell.concat(late).every((u) => fs.existsSync(path.join(root, u))), shell.concat(late).filter((u) => !fs.existsSync(path.join(root, u))));
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
    // Con red de nuevo y una publicación en el medio: esta visita abre al instante con lo guardado y por detrás se
    // trae la versión nueva entera; la visita siguiente ya es la nueva. Nadie queda con la vieja más de una visita.
    const mark = hits.length; published.mark = 'v2';
    await page.goto(home); await page.waitForSelector('.lmd-home');
    const stale = await page.evaluate(() => ({ page: document.body.dataset.published || '', script: window.__published || '' }));
    check('con una publicación nueva, la visita abre con lo guardado, sin esperar a la red', stale.page === '' && stale.script === '', stale);
    let renewed = false;
    for (let i = 0; i < 50 && !renewed; i++) {
      await page.waitForTimeout(300);
      renewed = await page.evaluate(async () => { for (const k of await caches.keys()) { const c = await caches.open(k); const a = await c.match('/src/app.html'); const b = await c.match('/src/kit.js'); if (a && b && /data-published="v2"/.test(await a.text()) && /__published = "v2"/.test(await b.text())) return true; } return false; });
    }
    check('por detrás se pide todo de nuevo al servidor y se guarda junto', renewed && hits.slice(mark).includes('/src/app.html') && hits.slice(mark).includes('/src/kit.js') && hits.slice(mark).includes('/vendor/highlight.min.js'), hits.slice(mark).slice(0, 5));
    await page.goto(home); await page.waitForSelector('.lmd-home');
    const fresh = await page.evaluate(() => ({ page: document.body.dataset.published || '', script: window.__published || '' }));
    check('y la visita siguiente ya abre la versión nueva, página y scripts', fresh.page === 'v2' && fresh.script === 'v2', fresh);
    published.mark = '';
    // Una versión nueva de verdad (cambia el número): la página abierta sigue con la suya, y cuando la nueva terminó de
    // bajar lo dice, con un botón para recargar. Recargar guarda primero lo que se estaba escribiendo.
    const fresh0 = () => page.evaluate(() => { const b = document.querySelector('.lmd-fresh'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.querySelector('span').textContent, go: b.querySelector('[data-fresh=go]').textContent, later: b.querySelector('[data-fresh=later]').getAttribute('aria-label'), role: b.getAttribute('role'), n: document.querySelectorAll('.lmd-fresh, .lmd-orphan').length, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
    const keptVersion = () => page.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const d = await (await caches.open(k)).match('/src/defaults.js'); if (d) out.push((/VERSION = '([^']+)'/.exec(await d.text()) || [])[1]); } return out.join(','); });
    // La página recién recargada registra el service worker de su versión, que arma su caché: se espera a que termine.
    const settled = async (v) => { for (let i = 0; i < 80; i++) { if (await page.evaluate(async (ver) => { const c = navigator.serviceWorker.controller; const keys = await caches.keys(); if (!c || !c.scriptURL.endsWith('?v=' + ver) || keys.join() !== 'sharpmd-' + ver) return false; return !!(await (await caches.open(keys[0])).match('/icons/icon512.png')); }, v).catch(() => false)) return; await page.waitForTimeout(250); } };
    published.version = '9.8.7';
    await page.goto(home + '?f=' + encodeURIComponent('local/offline.md')); await page.waitForSelector('.markdown-body h1');
    const quiet = await page.evaluate(() => ({ v: LMD.VERSION, bar: !!document.querySelector('.lmd-fresh') }));
    check('con una versión nueva publicada, la visita abre con la guardada y todavía sin aviso', quiet.v === reg.v && !quiet.bar, quiet);
    await page.waitForSelector('.lmd-fresh', { timeout: 15000 }).catch(() => {});
    const bar = await fresh0();
    check('cuando la nueva terminó de bajar, la página lo dice: un aviso solo, con Recargar y una forma de dejarlo para después', !!bar && bar.text === 'There is a new version.' && bar.go === 'Reload' && bar.later === 'Not now' && bar.role === 'status' && bar.n === 1 && bar.inside, bar);
    check('y la caché ya tiene la versión nueva', (await keptVersion()) === '9.8.7', await keptVersion());
    await fits(page, 'el aviso de versión nueva');
    await page.evaluate(() => { window.__MDT_FRESH.show({ version: '9.8.7', stored: true }); window.__MDT_FRESH.show({ version: '9.8.7', stored: true }); });
    check('otro aviso de lo mismo no suma un cartel', (await fresh0()).n === 1);
    await page.tap('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editable');
    await page.locator('.lmd-article > p.lmd-editable').first().tap(); await page.keyboard.press('End'); await page.keyboard.type(' Typed before reloading.');
    await page.tap('.lmd-fresh [data-fresh=go]');
    await page.waitForFunction(() => window.LMD && LMD.VERSION === '9.8.7' && !!document.querySelector('.markdown-body'), null, { timeout: 15000 }).catch(() => {});
    const went = await page.evaluate(async () => ({ v: window.LMD && LMD.VERSION, bar: !!document.querySelector('.lmd-fresh'), text: (await LMD.store.noteGet('offline.md')).text }));
    check('Recargar deja la página en la versión nueva, sin el aviso', went.v === '9.8.7' && !went.bar, [went.v, went.bar]);
    check('y lo que se estaba escribiendo quedó guardado antes de recargar', /Typed before reloading\./.test(went.text), went.text);
    await settled('9.8.7');
    // Un archivo de la lista que no llega (la conexión se corta): la vuelta no guarda nada, pero ya vio que hay versión
    // nueva y lo dice igual. Recargar pasa por alto la caché: nadie queda clavado en una versión vieja.
    published.version = '9.8.8'; published.cut = '/vendor/highlight.min.js';
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.waitForSelector('.lmd-fresh', { timeout: 15000 }).catch(() => {});
    const stuck = { bar: await fresh0(), kept: await keptVersion(), v: await page.evaluate(() => LMD.VERSION), keys: await page.evaluate(async () => { const o = []; for (const k of await caches.keys()) o.push(k + ':' + (await (await caches.open(k)).keys()).length); return o; }) };
    check('si un archivo no llega, la caché queda como estaba, entera, y la página avisa igual', !!stuck.bar && stuck.kept === '9.8.7' && stuck.v === '9.8.7', stuck);
    await page.tap('.lmd-fresh [data-fresh=go]');
    await page.waitForFunction(() => window.LMD && LMD.VERSION === '9.8.8' && !!document.querySelector('.lmd-home'), null, { timeout: 15000 }).catch(() => {});
    check('y Recargar abre la versión nueva igual, derecho de la red', (await page.evaluate(() => window.LMD && LMD.VERSION)) === '9.8.8');
    published.cut = '';
    await settled('9.8.8');
    // Una pestaña que queda abierta: sin navegar, la página pregunta cada tanto y al volver a ella. Mirar es un solo pedido.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(4500); // la vuelta de esta visita ya terminó
    let from = hits.length;
    await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'lmd-check' })); await page.waitForTimeout(900);
    check('sin versión nueva, mirar pide un solo archivo y no avisa nada', J(hits.slice(from)) === J(['/src/defaults.js']) && !(await fresh0()), hits.slice(from).slice(0, 4));
    published.version = '9.8.9'; from = hits.length;
    await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'lmd-check' }));
    await page.waitForSelector('.lmd-fresh', { timeout: 15000 }).catch(() => {});
    check('con una versión nueva, la pestaña abierta se entera sin navegar: baja todo y avisa', !!(await fresh0()) && (await keptVersion()) === '9.8.9' && hits.slice(from).length > 40 && (await page.evaluate(() => LMD.VERSION)) === '9.8.8', [await keptVersion(), hits.slice(from).length]);
    await page.tap('.lmd-fresh [data-fresh=later]'); await page.waitForTimeout(150);
    await page.evaluate(() => window.__MDT_FRESH.show({ version: '9.8.9', stored: true }));
    check('dejarlo para después lo saca, y esa versión no vuelve a avisar', !(await fresh0()));
    // Un archivo de la lista que el servidor ya no tiene no frena la vuelta: se saca de la caché.
    published.version = '9.9.0'; published.gone = '/vendor/highlight.min.js';
    await page.goto(home); await page.waitForSelector('.lmd-home');
    let moved = '';
    for (let i = 0; i < 50 && moved !== '9.9.0'; i++) { await page.waitForTimeout(300); moved = await keptVersion(); }
    check('un archivo que ya no existe no frena la actualización, y deja de estar guardado', moved === '9.9.0' && !(await page.evaluate(async () => { for (const k of await caches.keys()) if (await (await caches.open(k)).match('/vendor/highlight.min.js')) return true; return false; })), moved);
    published.gone = '';
    // Sin conexión no pasa nada: ni se pregunta ni se avisa.
    published.version = '9.9.1';
    await ctx.setOffline(true);
    await page.goto(home, { timeout: 15000 }).catch(() => {}); await page.waitForSelector('.lmd-home', { timeout: 8000 }).catch(() => {});
    from = hits.length; await page.waitForTimeout(4200);
    check('sin conexión la app abre y no avisa nada', (await page.evaluate(() => !!window.LMD && !document.querySelector('.lmd-fresh')).catch(() => false)) && hits.slice(from).every((h) => h === '/sw.js'), hits.slice(from).slice(0, 3)); // el navegador mira por su cuenta si cambió sw.js
    await ctx.setOffline(false);
    published.version = '';
    // Una versión nueva arma su caché y borra la anterior. La app registra la suya en reposo tras cargar (hasta 3 s): se espera, o pisa la de la prueba.
    await page.waitForTimeout(3800);
    const next = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.register('../sw.js?v=9.9.9', { scope: '../' });
      await new Promise((resolve) => { const watch = (w) => { if (w.state === 'activated') return resolve(); w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(); }); }; const w = r.installing || r.waiting; if (w) watch(w); else r.addEventListener('updatefound', () => watch(r.installing)); setTimeout(resolve, 20000); });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return caches.keys();
    });
    check('una versión nueva arma su caché y borra la anterior', J(next) === J(['sharpmd-9.9.9']), next);
    await ctx.close();
  }

  // ---------- Compartir a SharpMD ----------
  console.log('Compartir: lo que manda otra app');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    const st = manifest.share_target || {}; const sp = st.params || {}; const sf = (sp.files || [])[0] || {}; const accept = sf.accept || [];
    const action = new URL(st.action || 'none', origin + '/'); const scope = new URL(manifest.scope, origin + '/');
    check('el manifiesto declara el destino de compartir: POST multipart a una ruta dentro del alcance de la app', st.method === 'POST' && st.enctype === 'multipart/form-data' && action.href === origin + '/src/share' && action.pathname.startsWith(scope.pathname), st);
    check('con título, texto, enlace y archivos Markdown, de texto, JSON y YAML', sp.title === 'title' && sp.text === 'text' && sp.url === 'url' && (sp.files || []).length === 1 && sf.name === 'files' &&
      ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', 'text/markdown', 'text/plain'].every((a) => accept.includes(a)) && accept.every((a) => /^\.[a-z]+$|^[a-z]+\/[a-z.+-]+$/.test(a)), sf);
    check('el service worker atiende esa misma ruta', new RegExp("SHARE_PATH = '" + action.pathname.slice(1) + "'").test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')));

    const { ctx, page } = await open(390, 844);
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
    const mark = hits.length;
    // El envío, como lo arma el sistema: un formulario multipart a la dirección del manifiesto. Sale de otra página
    // del sitio, porque la app no deja mandar formularios (form-action 'none').
    const send = async (fields, files, offline) => {
      await page.goto(origin + '/privacy.html');
      await page.evaluate(({ to, fields, withFiles }) => {
        const form = document.createElement('form'); form.id = 'share-test'; form.method = 'POST'; form.enctype = 'multipart/form-data'; form.action = to;
        for (const k of Object.keys(fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = fields[k]; form.appendChild(i); }
        if (withFiles) { const f = document.createElement('input'); f.type = 'file'; f.name = 'files'; f.multiple = true; form.appendChild(f); }
        document.body.appendChild(form);
      }, { to: action.href, fields, withFiles: !!files });
      if (files) await page.setInputFiles('#share-test input[type=file]', files.map(([name, mimeType, text]) => ({ name, mimeType, buffer: Buffer.from(text) })));
      if (offline) await ctx.setOffline(true);
      const gone = page.waitForNavigation({ timeout: 15000 }).catch((e) => errors.push('compartir: ' + e.message.split('\n')[0]));
      await page.evaluate(() => document.getElementById('share-test').submit()).catch(() => {});
      await gone;
    };
    const state = () => page.evaluate(async () => ({ path: location.pathname, f: decodeURIComponent(new URLSearchParams(location.search).get('f') || ''), share: new URLSearchParams(location.search).has('share'),
      h1: (document.querySelector('.markdown-body h1') || {}).textContent || '', caches: await caches.keys(), nodoc: document.documentElement.classList.contains('lmd-nodoc'),
      msg: (document.querySelector('.lmd-home-msg') || {}).textContent || '', mem: (JSON.parse(sessionStorage.getItem('mdt-mem') || 'null') || {}).name || '', notes: (await LMD.store.notesAll()).map((n) => n.text) }));

    await send({ title: 'ignored with a file' }, [['shared.md', 'text/markdown', '# Shared file\n\nSent from another app.\n']]);
    await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    let s = await state();
    check('un .md compartido se abre como documento sin guardar, por el mismo camino que un archivo elegido a mano', s.path === '/src/app.html' && s.f === 'mem/shared.md' && s.h1.startsWith('Shared file') && s.mem === 'shared.md' && !s.notes.length, s);
    check('la dirección queda limpia y lo recibido no queda guardado', !s.share && !s.caches.includes('lmd-share'), s);
    await page.reload(); await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    check('al recargar sigue abierto y no se vuelve a recoger', (await state()).f === 'mem/shared.md');

    await send({}, [['first.txt', 'text/plain', 'plain first\n'], ['second.md', 'text/markdown', '# Second\n']]);
    await page.waitForFunction(() => /first\.txt/.test(location.search), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400); s = await state();
    check('de varios archivos se abre el primero y se avisa cuántos llegaron', s.f === 'mem/first.txt' && /2 files arrived/.test(await page.evaluate(() => document.body.textContent)), s);

    await send({}, [['photo.png', 'image/png', 'not a note']]);
    await page.waitForSelector('.lmd-home-msg:not([hidden])', { timeout: 8000 }).catch(() => {});
    s = await state();
    check('un archivo de otro tipo no se abre: el inicio dice por qué', s.nodoc && !s.f && /Only Markdown, text, JSON or YAML/.test(s.msg) && !s.caches.includes('lmd-share'), s);

    await send({}, [['notes', 'text/markdown', '# No extension\n']]);
    await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    check('un Markdown que llega sin extensión la toma de su tipo', (await state()).f === 'mem/notes.md');

    await send({}, [['big.md', 'text/markdown', '# Big\n\n' + 'x'.repeat(5 * 1024 * 1024 + 10)]]);
    await page.waitForSelector('.lmd-home-msg:not([hidden])', { timeout: 15000 }).catch(() => {});
    s = await state();
    check('uno más grande que el tope tampoco: se dice y no queda guardado', s.nodoc && /too large/.test(s.msg) && !s.caches.includes('lmd-share'), [s.msg, s.caches]);

    // Texto y enlace, sin red: el service worker recibe el envío y la app abre desde lo guardado.
    await send({ title: 'Reading   list', text: 'An article worth keeping', url: 'https://example.com/post' }, null, true);
    await page.waitForSelector('.lmd-editing .lmd-article', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400); s = await state();
    check('sin red, un texto con enlace compartido abre una nota nueva con eso adentro', /^local\/note-\d{8}-\d{4}\.md$/.test(s.f) && J(s.notes) === J(['# Reading list\n\nAn article worth keeping\n\n<https://example.com/post>\n']) && !s.share, s);
    await ctx.setOffline(false);

    await send({ title: '<img src=x onerror="window.__pwned=1">', text: '<script>window.__pwned=1</script>plain', url: 'javascript:window.__pwned=1' });
    await page.waitForSelector('.lmd-editing .lmd-article', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const safe = await page.evaluate(async () => ({ pwned: window.__pwned, text: (await LMD.store.notesAll()).map((n) => n.text).find((t) => /onerror/.test(t)) || '', img: !!document.querySelector('.lmd-article img[onerror], .lmd-article script') }));
    check('lo compartido es texto: no corre nada y un enlace que no es http no entra', safe.pwned === undefined && !safe.img && /onerror/.test(safe.text) && !/javascript:/.test(safe.text), safe);

    // Muchos gestores de archivos mandan un .md como application/octet-stream y sin extensión: decide el contenido.
    check('el manifiesto también recibe application/octet-stream', accept.includes('application/octet-stream'), accept);
    await send({}, [['README', 'application/octet-stream', '# Read me\n\nSent as a binary type.\n']]);
    await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300); s = await state();
    check('un Markdown que llega como application/octet-stream y sin extensión se abre igual, y se avisa que es una copia', s.f === 'mem/README.md' && s.h1.startsWith('Read me') && /Opened as a copy/.test(await page.evaluate(() => document.body.textContent)), s);
    await send({}, [['notes.log', '', 'plain log line\n']]);
    await page.waitForFunction(() => /notes\.log/.test(location.search), null, { timeout: 8000 }).catch(() => {});
    check('un texto con una extensión que la app no conoce y sin tipo se abre como texto', (await state()).f === 'mem/notes.log.txt');
    await send({}, [['blob', 'application/octet-stream', 'PK\u0003\u0004\u0000\u0000binary\u0000\u0000']]);
    await page.waitForSelector('.lmd-home-msg:not([hidden])', { timeout: 8000 }).catch(() => {});
    s = await state();
    check('un binario que llega como application/octet-stream no se abre: el inicio dice por qué', s.nodoc && !s.f && /Only Markdown, text, JSON or YAML/.test(s.msg), s);
    // Un envío vacío (pasa cuando el navegador descarta el archivo por su tipo): el inicio lo dice, con el botón de abrir.
    await send({});
    await page.waitForSelector('.lmd-open-miss', { timeout: 8000 }).catch(() => {});
    const empty = await page.evaluate(() => { const n = document.querySelector('.lmd-open-miss'); return { text: n ? n.querySelector('p').textContent : '', btn: n ? (n.querySelector('button[data-home=file]') || {}).textContent : '', share: new URLSearchParams(location.search).has('share'), nodoc: document.documentElement.classList.contains('lmd-nodoc') }; });
    check('un envío que llega vacío no deja el inicio mudo: dice que no llegó y ofrece abrir el archivo', empty.nodoc && /did not arrive/.test(empty.text) && empty.btn === 'Open file' && !empty.share, empty);

    await page.goto(origin + '/src/share'); await page.waitForSelector('.lmd-home', { timeout: 8000 }).catch(() => {});
    s = await state();
    check('entrar a esa dirección sin un envío abre la app, sin más', s.path === '/src/app.html' && s.nodoc && !s.share && !s.msg && !(await page.locator('.lmd-open-miss').count()), s);
    check('ningún envío fue a la red', !hits.slice(mark).includes('/src/share'), hits.slice(mark).filter((h) => /share/.test(h)));
    await ctx.close();

    // Sin el service worker (la primera vez, antes de abrir la app) el envío va a la red, y un alojamiento estático
    // no recibe un POST. Lo que hay en esa ruta es una página que explica y lleva a la app.
    const back = fs.readFileSync(path.join(root, 'src', 'share', 'index.html'), 'utf8');
    check('la ruta de compartir tiene una página de respaldo, sin indexar y sin más código que el del sitio', /<meta name="robots" content="noindex">/.test(back) && /href="\.\.\/app\.html"/.test(back) && J((back.match(/<script[^>]*>/g) || [])) === J(['<script src="../../site.js">']), back.match(/<script[^>]*>/g));
    const bare = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, PHONE));
    const bp = await bare.newPage(); bp.on('pageerror', (e) => errors.push(e.message));
    await bp.goto(origin + '/src/share/?src=android');
    const told = await bp.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].filter((n) => n.offsetParent).map((n) => n.textContent), link: [...document.querySelectorAll('a.btn')].filter((n) => n.offsetParent).map((n) => n.textContent + ' ' + n.getAttribute('href')) }));
    check('sin service worker, esa ruta explica qué pasó y ofrece abrir la app', J(told.h1) === J(['Nothing was shared']) && J(told.link) === J(['Open SharpMD ../app.html']), told);
    await bp.tap('a.btn:visible'); await bp.waitForSelector('.lmd-home', { timeout: 8000 }).catch(() => {});
    check('y su botón lleva a la app', new URL(bp.url()).pathname === '/src/app.html', bp.url());
    await bare.close();
  }

  // ---------- Compartir hacia otra app ----------
  console.log('Compartir: la nota hacia otra app');
  {
    const { ctx, page } = await open(390, 844);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    const RAW = '# Share me\n\nA note for another app.\n';
    await page.evaluate(async (text) => { await LMD.store.notePut('share-me.md', text); await LMD.store.notePut('long.md', '# Long\n\n' + 'word '.repeat(12100) + '\n'); }, RAW);
    // La hoja de compartir del sistema, simulada: qué acepta y cómo contesta.
    const fresh = async (mode, note) => {
      await page.goto(home + '?f=' + encodeURIComponent('local/' + (note || 'share-me.md'))); await page.waitForSelector('.markdown-body h1');
      await page.evaluate((mode) => {
        window.__shared = [];
        const def = (k, v) => Object.defineProperty(navigator, k, { configurable: true, value: v });
        if (mode === 'none') { def('share', undefined); def('canShare', undefined); return; }
        def('canShare', (d) => !(d && d.files) || (mode === 'text-only' ? false : mode === 'no-md' ? d.files.every((f) => f.type !== 'text/markdown') : true));
        def('share', (d) => {
          window.__shared.push({ text: d.text || '', url: d.url || '', files: (d.files || []).map((f) => f.name + ' ' + f.type), active: !!(navigator.userActivation && navigator.userActivation.isActive) });
          const no = (name) => Promise.reject(new DOMException('refused', name));
          if (mode === 'cancel') return no('AbortError');
          if (mode === 'denied' || (mode === 'files-denied' && d.files)) return no('NotAllowedError');
          return Promise.resolve();
        });
      }, mode);
    };
    const sheet = async () => { await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=share-out]'); await page.waitForSelector('.lmd-so-card'); };
    const look = () => page.evaluate(() => {
      const c = document.querySelector('.lmd-so-card'); if (!c) return { open: false, shared: window.__shared };
      const err = c.querySelector('.lmd-img-err');
      return { open: true, opts: [...c.querySelectorAll('.lmd-so-list [data-so]')].map((b) => b.dataset.so), err: err.hidden ? '' : err.textContent, alts: [...c.querySelectorAll('.lmd-so-card > .lmd-so-alt:not([hidden]) [data-so]')].map((b) => b.dataset.so),
        long: !c.querySelector('.lmd-so-long').hidden, labels: [...c.querySelectorAll('.lmd-so-list b')].map((b) => b.textContent), shared: window.__shared };
    });
    const pick = async (act, where) => { await page.tap((where || '.lmd-so-list') + ' [data-so=' + act + ']'); await page.waitForTimeout(250); return look(); };

    await fresh('ok'); await sheet();
    let v = await look();
    check('en el teléfono, "más" trae Compartir y abre una hoja propia: como texto, como archivo .md, como .txt y copiar', J(v.opts) === J(['text', 'file', 'txt', 'copy']) && J(v.labels) === J(['Share as text', 'Share as a file (.md)', 'Share as a file (.txt)', 'Copy']) && !v.long && !v.err, v);
    const box = await page.evaluate(() => { const r = document.querySelector('.lmd-so-card').getBoundingClientRect(); return { in: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, low: Math.min(...[...document.querySelectorAll('.lmd-so-opt')].map((b) => b.getBoundingClientRect().height)) }; });
    check('la hoja entra en la pantalla y sus opciones se tocan con el dedo', box.in && box.low >= 44, box);
    await fits(page, 'compartir hacia otra app');
    v = await pick('text');
    check('como texto: sale el Markdown por la hoja del sistema, dentro del mismo toque, y la hoja propia se cierra', !v.open && v.shared.length === 1 && v.shared[0].text === RAW && !v.shared[0].files.length && v.shared[0].active, v);
    await sheet(); v = await pick('file');
    check('como archivo: sale el .md con su tipo', !v.open && J(v.shared[1].files) === J(['share-me.md text/markdown']) && v.shared[1].active, v.shared);
    await sheet(); v = await pick('txt');
    check('como .txt: el mismo contenido con otro nombre y como texto plano', !v.open && J(v.shared[2].files) === J(['share-me.txt text/plain']), v.shared);

    await fresh('no-md'); await sheet(); v = await pick('file');
    check('si el navegador no toma text/markdown, el .md sale como texto plano con su mismo nombre', !v.open && J(v.shared[0].files) === J(['share-me.md text/plain']), v);

    await fresh('text-only'); await sheet(); v = await look();
    check('si el navegador comparte texto y no archivos, se ofrece descargar en vez de compartir el archivo', J(v.opts) === J(['text', 'save', 'copy']), v.opts);
    v = await pick('text');
    check('y el texto sale igual', !v.open && v.shared.length === 1 && v.shared[0].text === RAW, v);

    await fresh('none'); await sheet(); v = await look();
    check('sin hoja de compartir en el navegador: texto, descargar y copiar', J(v.opts) === J(['text', 'save', 'copy']), v.opts);
    v = await pick('text');
    check('y compartir como texto lo dice, con copiar a un toque', v.open && /does not share from the app/.test(v.err) && J(v.alts) === J(['copy']), v);
    v = await pick('copy', '.lmd-so-card > .lmd-so-alt');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'no: ' + e.message));
    check('esa copia deja el Markdown en el portapapeles y cierra la hoja', !v.open && clip.replace(/\r\n/g, '\n') === RAW, [v.open, clip]);
    await sheet();
    const [down] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.tap('.lmd-so-list [data-so=save]')]);
    check('y descargar baja el archivo con su nombre', !!down && down.suggestedFilename() === 'share-me.md', down && down.suggestedFilename());

    await fresh('files-denied'); await sheet(); v = await pick('file');
    check('si la hoja del sistema rechaza el archivo (NotAllowedError), se dice y se ofrece como texto, como .txt o descargar', v.open && /Could not share the file\. Share it as text instead\?/.test(v.err) && J(v.alts) === J(['text', 'txt', 'save']) && J(v.opts) === J(['text', 'txt', 'copy']), v);
    v = await pick('text', '.lmd-so-card > .lmd-so-alt');
    check('la alternativa es un toque nuevo, con su gesto, y sale', !v.open && v.shared.length === 2 && v.shared[1].text === RAW && v.shared[1].active, v.shared);
    await sheet(); v = await look();
    check('lo que el navegador ya rechazó no se vuelve a ofrecer', J(v.opts) === J(['text', 'txt', 'copy']), v.opts);
    await page.tap('[data-so=close]');

    await fresh('cancel'); await sheet(); v = await pick('text');
    const afterText = v; v = await pick('file');
    check('cancelar la hoja del sistema no es un error: sin aviso, y la hoja propia sigue abierta', afterText.open && !afterText.err && v.open && !v.err && !v.alts.length && v.shared.length === 2 && J(v.opts) === J(['text', 'file', 'txt', 'copy']), [afterText, v]);

    await fresh('denied'); await sheet(); v = await pick('text');
    check('si falla compartir el texto, se dice y queda copiar a un toque: nunca un fallo mudo', v.open && /Could not share\. Copy the text/.test(v.err) && J(v.alts) === J(['copy']), v);

    await fresh('ok', 'long.md'); await sheet(); v = await look();
    check('una nota de más de 60.000 caracteres sugiere mandarla como archivo o como enlace', v.long && /long/.test(await page.textContent('.lmd-so-long')), v.long);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    check('Escape cierra la hoja', !(await look()).open);
    await ctx.close();
  }

  // ---------- "Abrir con" en el teléfono ----------
  console.log('Abrir con: el archivo que manda otra app');
  {
    // La fila de archivos del sistema, simulada. Con ?lq=1 entrega un archivo en cuanto la app registra su consumidor,
    // que es lo que hace el navegador con un lanzamiento que estaba esperando.
    const queue = () => {
      const handle = (name, type, text, perm) => ({ kind: 'file', name, queryPermission: async () => perm || 'denied', getFile: async () => new File([text], name, { type }) });
      window.__handle = handle;
      Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) {
        window.__launch = fn; window.__early = !(window.LMD && LMD.install) && !document.querySelector('.lmd-home-card');
        if (/[?&]lq=1/.test(location.search)) fn({ files: [handle('from-files.md', 'text/markdown', '# From the file manager\n\nread only\n')] });
      } } });
    };
    const seen = (page) => page.evaluate(() => ({ f: decodeURIComponent(new URLSearchParams(location.search).get('f') || ''), open: new URLSearchParams(location.search).has('open'), h1: (document.querySelector('.markdown-body h1') || {}).textContent || '',
      body: document.body.textContent, miss: (document.querySelector('.lmd-open-miss p') || {}).textContent || '', btn: (document.querySelector('.lmd-open-miss button[data-home=file]') || {}).textContent || '', store: LMD.storeApp === true }));
    let { ctx, page } = await open(390, 844);
    await ctx.addInitScript(queue);
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    await page.goto(home + '?src=android&open=1&lq=1'); await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    check('el consumidor de la fila se registra apenas carga la app, antes de que arranque el lector', await page.evaluate(() => window.__early === true && typeof window.__launch === 'function'));
    await page.waitForTimeout(300); let o = await seen(page);
    check('con la app recién abierta, el archivo que ya esperaba se abre y se ve', o.f === 'mem/from-files.md' && o.h1.startsWith('From the file manager') && o.store, o.f + ' ' + o.h1);
    check('con permiso de solo lectura se abre una copia, y se avisa', /Opened as a copy\. Changes are not saved to the original file\./.test(o.body));
    await page.waitForTimeout(3200); o = await seen(page);
    check('y como el archivo llegó, no sale el aviso de que no llegó', !o.miss && !o.open, o.miss);
    // Con la app ya abierta y una nota a la vista, llega otro: sin extensión y como application/octet-stream.
    await page.evaluate(() => window.__launch({ files: [window.__handle('LEEME', 'application/octet-stream', '# Sin extension\n\nllego con la app abierta\n')] }));
    await page.waitForFunction(() => /LEEME/.test(location.search), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300); o = await seen(page);
    check('con la app ya abierta, otro archivo también se abre: sin extensión y como application/octet-stream, por su contenido', o.f === 'mem/LEEME.md' && o.h1.startsWith('Sin extension'), o.f + ' ' + o.h1);
    await page.evaluate(() => window.__launch({ files: [window.__handle('thing', 'application/octet-stream', 'PK\u0003\u0004\u0000\u0000\u0000binary')] }));
    await page.waitForFunction(() => /Only Markdown, text, JSON or YAML/.test(document.body.textContent), null, { timeout: 8000 }).catch(() => {});
    o = await seen(page);
    check('un binario no se abre: se dice, y la nota que estaba sigue a la vista', /Only Markdown, text, JSON or YAML/.test(o.body) && o.f === 'mem/LEEME.md', o.f);
    await page.evaluate(() => window.__launch({ files: [] }));
    await page.waitForTimeout(300);
    check('una fila vacía no cambia nada', (await seen(page)).f === 'mem/LEEME.md');

    // La fila existe pero no trae nada: la app se abrió para un archivo (?open=1) y el navegador no lo entregó.
    await page.goto(home + '?src=android&open=1'); await page.waitForSelector('.lmd-home-card');
    check('mientras se espera el archivo, el inicio no dice nada todavía', !(await seen(page)).miss);
    await page.waitForSelector('.lmd-open-miss', { timeout: 8000 }).catch(() => {});
    o = await seen(page);
    check('si la app se abrió para un archivo y no llegó ninguno, el inicio lo dice, con el botón de abrir a un toque', /This browser did not hand over the file\. Open it with the button below./.test(o.miss) && o.btn === 'Open file' && !o.open && o.store, o);
    await fits(page, 'aviso de archivo que no llegó');
    await page.evaluate(() => { window.showOpenFilePicker = async () => { window.__asked = true; throw new DOMException('closed', 'AbortError'); }; });
    await page.tap('.lmd-open-miss button'); await page.waitForTimeout(300);
    check('ese botón abre el selector de archivos, y el aviso se va', await page.evaluate(() => window.__asked === true && !document.querySelector('.lmd-open-miss')));
    await ctx.close();

    // Un navegador sin fila de archivos (lo que se espera de Samsung Internet): el mismo aviso.
    ({ ctx, page } = await open(360, 740));
    await ctx.addInitScript(() => { Object.defineProperty(window, 'launchQueue', { configurable: true, value: undefined }); });
    await page.goto(home); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    await page.goto(home + '?src=android&open=1'); await page.waitForSelector('.lmd-open-miss', { timeout: 8000 }).catch(() => {});
    o = await seen(page);
    check('sin fila de archivos en el navegador, el inicio también lo dice en vez de quedar mudo', /did not hand over the file/.test(o.miss) && o.btn === 'Open file', o.miss);
    await fits(page, 'aviso de archivo que no llegó, 360');
    await page.goto(home + '?src=android'); await page.waitForSelector('.lmd-home-card'); await page.waitForTimeout(3200);
    check('un arranque común de la app no muestra ese aviso', !(await seen(page)).miss);
    await ctx.close();
  }

  // ---------- La portada va guardando la app ----------
  console.log('Portada: la app se guarda mientras se lee');
  {
    const src = fs.readFileSync(path.join(root, 'tools', 'landing.src.html'), 'utf8'); const built = [fs.readFileSync(path.join(root, 'index.html'), 'utf8'), fs.readFileSync(path.join(root, 'es', 'index.html'), 'utf8')];
    const part = /<script>\s*\/\/ Mientras se lee la portada[\s\S]*?<\/script>/.exec(src);
    check('el registro va en la fuente de la portada y en las dos páginas generadas, después del load y en reposo', !!part && /addEventListener\('load', idle\)/.test(part[0]) && /requestIdleCallback/.test(part[0]) && /saveData/.test(part[0]) && built.every((h) => /serviceWorker\.register\(root \+ 'sw\.js\?v='/.test(h)));
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    for (const rel of ['/index.html?site', '/es/index.html?site']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'allow' });
      await ctx.route((url) => /(^|\.)sync\.sharpmd\.app$/.test(url.hostname), (r) => { outside.push(r.request().url()); return r.abort(); });
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      // Hasta el load no hay nada registrado: la portada carga sin competir con eso.
      await page.addInitScript(() => { window.addEventListener('load', () => { navigator.serviceWorker.getRegistration().then((r) => { window.__atLoad = !!r; }); }); });
      await page.goto(origin + rel); await page.waitForSelector('#plans .plan');
      const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { url: r.active.scriptURL, scope: r.scope, atLoad: window.__atLoad }; });
      check(rel + ': la portada registra el service worker de la app, con la versión en la dirección, recién después del load', reg.url === origin + '/sw.js?v=' + version && reg.scope === origin + '/' && reg.atLoad === false, reg);
      const kept = await page.evaluate(async () => { for (let i = 0; i < 80; i++) { for (const k of await caches.keys()) { const c = await caches.open(k); if ((await c.match('/src/app.html')) && (await c.match('/src/content.js')) && (await c.match('/src/content.css'))) return { key: k, landing: !!((await c.match('/index.html')) || (await c.match('/')) || (await c.match('/es/index.html'))) }; } await new Promise((r) => setTimeout(r, 250)); } return null; });
      check(rel + ': mientras se lee queda guardado el esqueleto de la app, y la portada misma no', !!kept && kept.key === 'sharpmd-' + version && kept.landing === false, kept);
      if (rel === '/index.html?site') {
        // La primera apertura de la app sale de lo guardado: anda hasta sin red, y no vuelve a instalar otro service worker.
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(async () => { for (let i = 0; i < 80; i++) { const c = await caches.open((await caches.keys())[0]); if (await c.match('/icons/icon512.png')) return; await new Promise((r) => setTimeout(r, 250)); } }); // lo que se guarda después, ya activo
        await ctx.setOffline(true);
        await page.click('a[href$="src/app.html"]'); await page.waitForSelector('.lmd-home [data-home=new]', { timeout: 10000 }).catch(() => {});
        check('la primera apertura de la app sale de lo guardado, sin esperar a la red', (await page.locator('.lmd-home [data-home=new]').count()) === 1 && /\/src\/app\.html/.test(page.url()), page.url());
        await ctx.setOffline(false); await page.waitForTimeout(1500);
        const after = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).map((r) => (r.active || r.installing || r.waiting).scriptURL), keys: await caches.keys() }));
        check('y la app encuentra ese mismo service worker: no instala otro', J(after.regs) === J([origin + '/sw.js?v=' + version]) && J(after.keys) === J(['sharpmd-' + version]), after);
        // La portada sigue llegando de la red: el service worker no la sirve.
        const mark = hits.length; await page.goto(origin + '/index.html?site'); await page.waitForSelector('#plans .plan');
        check('la portada se sigue pidiendo a la red', hits.slice(mark).includes('/index.html'), hits.slice(mark).slice(0, 4));
      }
      await ctx.close();
    }
    // Con ahorro de datos, o una red muy lenta, la portada no guarda nada.
    for (const net of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: 'slow-2g' }]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'allow' });
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript((n) => { Object.defineProperty(Navigator.prototype, 'connection', { get: () => n, configurable: true }); }, net);
      const mark = hits.length; await page.goto(origin + '/index.html?site'); await page.waitForSelector('#plans .plan'); await page.waitForLoadState('load'); await page.waitForTimeout(5500);
      const none = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, keys: await caches.keys() }));
      check('con ' + (net.saveData ? 'ahorro de datos' : 'una red muy lenta') + ' la portada no registra nada ni baja la app', none.regs === 0 && none.keys.length === 0 && !hits.slice(mark).some((h) => /^\/(sw\.js|manifest\.json|src\/content\.js)/.test(h)), [none, hits.slice(mark).filter((h) => /sw|manifest\.json|src\//.test(h))]);
      await ctx.close();
    }
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
    check('la barra de arriba conserva sus botones y sus medidas, sin el menú "más"', desk.more === 'none' && desk.bar === '49px' && J(desk.barPad) === J(['12px', '16px', '0px']) && desk.btn === '32px' && !desk.acts.includes('more') && ['view-doc', 'view-raw', 'copy', 'export', 'settings'].every((a) => desk.acts.includes(a)) && !desk.acts.some((a) => /^(copy-|export-|print|reload)/.test(a)), desk);
    check('el pie, el documento y el árbol miden lo de siempre', J(desk.foot) === J(['30px', '300px', '16px']) && desk.pad === '48px' && desk.table === '100%' && desk.node < 34, desk);
    // ---------- Los menús de copiar y exportar ----------
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.focus('[data-act=copy]'); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-menu-copy');
    const km = await page.evaluate(() => { const m = document.querySelector('.lmd-menu-copy'); const b = document.querySelector('[data-act=copy]'); const r = m.getBoundingClientRect(); const br = b.getBoundingClientRect();
      return { cls: m.className, role: m.getAttribute('role'), has: b.getAttribute('aria-haspopup'), open: b.getAttribute('aria-expanded'), below: r.top >= br.bottom && r.top - br.bottom < 12 && Math.abs(r.right - br.right) < 2, focus: document.activeElement.dataset.more,
        acts: [...m.querySelectorAll('[role=menuitem]')].map((x) => x.dataset.more + ':' + x.querySelector('span').textContent), icons: [...m.querySelectorAll('[role=menuitem]')].every((x) => x.querySelector('svg')) }; });
    check('copiar es un solo botón con su menú: Markdown, texto con formato y HTML', J(km.acts) === J(['copy-md:Markdown', 'copy-rich:Formatted text', 'copy-html:HTML']) && km.icons, km);
    check('el menú es el compacto de los menús contextuales, sale debajo de su botón y lo anuncia', /lmd-menu-narrow/.test(km.cls) && km.role === 'menu' && km.has === 'menu' && km.open === 'true' && km.below, km);
    await page.keyboard.press('ArrowDown'); const k1 = await page.evaluate(() => document.activeElement.dataset.more);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); const k2 = await page.evaluate(() => document.activeElement.dataset.more);
    await page.keyboard.press('Home'); const k3 = await page.evaluate(() => document.activeElement.dataset.more);
    check('con el teclado: el foco entra al menú y las flechas lo recorren, dando la vuelta', km.focus === 'copy-md' && k1 === 'copy-rich' && k2 === 'copy-html' && k3 === 'copy-md', [km.focus, k1, k2, k3]);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape lo cierra y devuelve el foco al botón', await page.evaluate(() => !document.querySelector('.lmd-menu-copy') && document.activeElement.dataset.act === 'copy' && document.activeElement.getAttribute('aria-expanded') === 'false'));
    await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-menu-copy'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    check('Enter elige: copiar con formato, como el ícono de antes', /Booking app launch/.test(await page.evaluate(() => navigator.clipboard.readText())) && /Copied with formatting/.test(await page.textContent('.lmd-status')) && !(await page.locator('.lmd-menu-copy').count()));
    await page.click('[data-act=copy]'); await page.click('.lmd-menu-copy [data-more=copy-md]'); await page.waitForTimeout(200);
    check('copiar el Markdown, como el ícono de antes', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('# Booking app launch'));
    await page.click('[data-act=copy]'); await page.click('.lmd-menu-copy [data-more=copy-html]'); await page.waitForTimeout(200);
    check('copiar el HTML', /^<h1[^>]*>Booking app launch/.test(await page.evaluate(() => navigator.clipboard.readText())));
    await page.click('[data-act=export]'); await page.waitForSelector('.lmd-menu-export');
    const em = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-export [role=menuitem]')].map((b) => b.dataset.more + ':' + b.querySelector('span').textContent + (b.querySelector('kbd') ? ':' + b.querySelector('kbd').textContent : '')));
    check('exportar es un solo botón con su menú: PDF, HTML, el .md e imprimir con su atajo', J(em) === J(['export-pdf:PDF', 'export-html:HTML file', 'export-md:Markdown file (.md)', 'print:Print:Ctrl+P', 'export-folder:The whole folder…']), em);
    await page.click('[data-act=copy]'); await page.waitForSelector('.lmd-menu-copy');
    check('un solo menú abierto a la vez', await page.evaluate(() => document.querySelectorAll('.lmd-menu').length === 1 && document.querySelector('[data-act=export]').getAttribute('aria-expanded') === 'false'));
    await page.mouse.click(640, 500); await page.waitForTimeout(150);
    check('un clic afuera lo cierra', (await page.locator('.lmd-menu').count()) === 0);
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click('[data-act=export]'); await page.click('.lmd-menu-export [data-more=export-pdf]');
    await page.click('[data-act=export]'); await page.click('.lmd-menu-export [data-more=print]');
    check('PDF e imprimir salen por la impresión del navegador', (await page.evaluate(() => window.__printed)) === 2);
    const [asHtml] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]').then(() => page.click('.lmd-menu-export [data-more=export-html]'))]);
    const [asMd] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]').then(() => page.click('.lmd-menu-export [data-more=export-md]'))]);
    check('el HTML y el .md se descargan con el nombre de la nota', asHtml.suggestedFilename() === 'desk.html' && asMd.suggestedFilename() === 'desk.md' && fs.readFileSync(await asMd.path(), 'utf8').startsWith('# Booking app launch'), [asHtml.suggestedFilename(), asMd.suggestedFilename()]);
    check('recargar no aparece en una nota del navegador', await page.evaluate(() => getComputedStyle(document.querySelector('[data-act=reload]')).display === 'none'));
    await page.fill('.lmd-search input', 'bookings'); await page.waitForSelector('.lmd-results-sum');
    const sum = await page.textContent('.lmd-results-sum');
    check('la cuenta de la búsqueda, que se arma por partes, sale en inglés', /^\d+ match(es)? in \d+ files? \(of \d+\)$/.test(sum.trim()), sum);
    await page.fill('.lmd-search input', '');
    await page.click('[data-act=sidebar]'); await page.waitForTimeout(400);
    check('y el botón de la barra lateral sigue guardando la preferencia', await page.evaluate(() => new Promise((resolve) => chrome.storage.local.get('settings', (r) => resolve(r.settings.sidebarHidden === true && document.documentElement.classList.contains('lmd-side-hidden') && !document.documentElement.classList.contains('lmd-side-open'))))));
    // ---------- La barra de arriba a cualquier ancho ----------
    console.log('Barra de arriba: de 320 a 1400 px');
    const LONG = 'quarterly-planning-notes-for-the-booking-app-launch-2026-final-draft.md';
    await page.evaluate(async ([name, text]) => { await LMD.store.notePut(name, text); }, [LONG, NOTE]);
    await page.goto(home + '?f=' + encodeURIComponent('local/' + LONG)); await page.waitForSelector('.markdown-body h1');
    await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-editable');
    // Cada control visible de la barra: su rectángulo no pisa el de ningún otro, queda dentro de la ventana y recibe el clic.
    const barAt = () => page.evaluate(() => {
      const vis = (b) => !!b.offsetParent && b.getBoundingClientRect().width > 0;
      const box = [...document.querySelectorAll('.lmd-topbar button, .lmd-topbar .lmd-docname')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { k: b.dataset.act || 'name', l: r.left, r: r.right, t: r.top, b: r.bottom, btn: b.tagName === 'BUTTON', el: b }; });
      const clash = []; const out = []; const dead = [];
      box.forEach((a, i) => {
        if (a.l < -0.5 || a.r > window.innerWidth + 0.5) out.push(a.k);
        if (a.btn) { const hit = document.elementFromPoint((a.l + a.r) / 2, (a.t + a.b) / 2); if (!hit || !(hit === a.el || a.el.contains(hit))) dead.push(a.k); }
        box.slice(i + 1).forEach((c) => { if (a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5) clash.push(a.k + '/' + c.k); });
      });
      const name = document.querySelector('.lmd-docname'); const root = document.documentElement.classList;
      return { clash, out, dead, acts: box.filter((x) => x.btn).map((x) => x.k), tight: root.contains('lmd-bar-tight'), min: root.contains('lmd-bar-min'), cut: vis(name) && name.scrollWidth > name.clientWidth, scroll: document.documentElement.scrollWidth - window.innerWidth };
    });
    const bars = [];
    for (const side of [true, false]) {
      for (const w of [1400, 1200, 1050, 960, 900, 840, 780, 740, 721, 720, 600, 480, 390, 320]) {
        if (w <= 720 && !side) continue; // en pantalla chica la barra lateral es un panel, cerrado
        await page.setViewportSize({ width: w, height: 800 });
        if (w > 720 && (await page.evaluate(() => document.documentElement.classList.contains('lmd-side-hidden'))) === side) await page.click('[data-act=sidebar]');
        await page.waitForTimeout(400);
        bars.push(Object.assign({ w, side }, await barAt()));
      }
    }
    const wide = bars.filter((b) => b.w > 720); const brief = (list) => list.map((b) => ({ w: b.w, side: b.side, clash: b.clash, out: b.out, dead: b.dead, tight: b.tight, min: b.min, acts: b.acts.join(' ') }));
    check('a ningún ancho se pisan dos controles de la barra', bars.every((b) => !b.clash.length), brief(bars.filter((b) => b.clash.length)));
    check('todos quedan dentro de la ventana y reciben el clic, sin scroll horizontal', bars.every((b) => !b.out.length && !b.dead.length && b.scroll <= 0), brief(bars.filter((b) => b.out.length || b.dead.length || b.scroll > 0)));
    check('los dos selectores están siempre enteros en la barra de escritorio', wide.every((b) => ['mode-read', 'mode-edit', 'view-doc', 'view-raw'].every((a) => b.acts.includes(a)) && !b.min), brief(wide.filter((b) => b.min || !b.acts.includes('view-raw'))));
    const roomy = bars.find((b) => b.w === 1400 && b.side); const narrow = bars.find((b) => b.w === 740 && b.side);
    check('con lugar están copiar, exportar y ajustes a la vista, sin "más"', !roomy.tight && ['copy', 'export', 'settings', 'insert'].every((a) => roomy.acts.includes(a)) && !roomy.acts.includes('more'), brief([roomy]));
    check('cuando no entra, los íconos de la derecha pasan a "más"', narrow.tight && narrow.acts.includes('more') && !['copy', 'export', 'settings', 'insert'].some((a) => narrow.acts.includes(a)), brief([narrow]));
    check('antes de eso se acorta el nombre, con puntos suspensivos', wide.some((b) => b.cut && !b.tight) && [true, false].every((side) => { const row = wide.filter((b) => b.side === side); const first = row.findIndex((b) => b.tight); return first < 0 || row.slice(first).every((b) => b.tight); }), brief(wide));
    await page.setViewportSize({ width: 740, height: 800 }); await page.waitForTimeout(400);
    if (await page.evaluate(() => document.documentElement.classList.contains('lmd-side-hidden'))) { await page.click('[data-act=sidebar]'); await page.waitForTimeout(400); }
    await page.click('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const tightMore = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-more button')].map((b) => b.dataset.more));
    check('ese "más" trae lo que salió de la barra, sin repetir el selector de vista que sigue a la vista', ['insert', 'copy', 'export', 'settings'].every((a) => tightMore.includes(a)) && !tightMore.includes('view-raw') && !tightMore.includes('view-doc'), tightMore);
    await page.click('.lmd-menu-more [data-more=copy]'); await page.waitForSelector('.lmd-menu-copy'); await page.click('.lmd-menu-copy [data-more=copy-md]'); await page.waitForTimeout(200);
    check('y desde ahí copiar sigue andando', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('# Booking app launch'));
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);
    check('al volver a ensanchar la ventana vuelven los íconos', await page.evaluate(() => !document.documentElement.classList.contains('lmd-bar-tight') && !!document.querySelector('[data-act=copy]').offsetParent));
    await ctx.close();
  }

  // ---------- Mover archivos del explorador con el dedo ----------
  // Mantener apretado levanta el renglón; arrastrarlo lo mueve con las reglas del mouse, y sin arrastrar sale el menú,
  // que trae "Move to…". Los toques son de verdad (CDP). Con MOVER_SHOTS se guardan capturas en esa carpeta.
  {
    console.log('Explorador: mover con el dedo');
    const SHOTS = process.env.MOVER_SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
    const who = 'dedo@ejemplo.test';
    const s2 = (await api('POST', '/auth/verify', { email: who, code: (await api('POST', '/auth/start', { email: who })).json.dev_code })).json.session;
    await api('POST', '/admin/plan', { email: who, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
    const names = ['proyectos/plan.md', 'archivo/viejo.md', 'aaa-suelta.md', 'otra.md', 'queda.md', 'tirar.md', 'zzz-lejos.md'].concat(Array.from({ length: 16 }, (x, i) => 'n' + String(i + 1).padStart(2, '0') + '.md'));
    for (const n of names) await api('PUT', '/notes/' + encodeURIComponent(n), { text: '# ' + n + '\n' }, s2);
    const { ctx, page } = await open(390, 844, { serviceWorkers: 'block' });
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]');
    await page.evaluate(async ([url, s, m]) => {
      await LMD.store.notePut('del-navegador.md', '# Local\n');
      await new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: s, email: m } }, resolve));
    }, [base, s2, who]);
    await page.goto(home); await page.waitForSelector('.lmd-home-acct', { state: 'attached' });
    await page.evaluate(() => { window.__vib = 0; try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { window.__vib++; return true; } }); } catch (e) { /* sin vibración que espiar */ } });
    await page.tap('[data-act=sidebar]'); await page.waitForTimeout(350);
    const CL = '.lmd-xroot[data-root=cloud] ';
    await page.waitForSelector(CL + '.lmd-node >> text=zzz-lejos.md');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const row = (name, root) => page.locator((root || CL) + '.lmd-node', { hasText: name }).first();
    const at = async (loc) => { const b = await loc.boundingBox(); return [b.x + Math.min(60, b.width / 2), b.y + b.height / 2]; };
    const glide = async (from, to, steps, pause) => { for (let i = 1; i <= steps; i++) { await touch('touchMove', from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await page.waitForTimeout(pause); } };
    const show = async (loc) => { await loc.evaluate((n) => n.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); };
    const toTop = async () => { await page.evaluate(() => { document.querySelector('.lmd-pane-files').scrollTop = 0; }); await page.waitForTimeout(200); };
    const paths = () => page.evaluate(async () => (await LMD.cloud.list(true)).map((n) => n.path).sort());
    const state = () => page.evaluate(() => ({ lifted: document.querySelectorAll('.lmd-lifted').length, dragging: document.querySelectorAll('.lmd-dragging').length, ghost: (document.querySelector('.lmd-drag-ghost') || {}).textContent || '', menu: document.querySelectorAll('.lmd-menu').length, ask: document.querySelectorAll('.lmd-ask').length,
      drop: [...document.querySelectorAll('.lmd-drop')].map((n) => (n.matches('.lmd-trash-link') ? 'papelera' : n.matches('.lmd-xroot') ? 'raíz ' + n.dataset.root : n.querySelector('.lmd-node-name').textContent)), scroll: Math.round(document.querySelector('.lmd-pane-files').scrollTop), drawer: document.documentElement.classList.contains('lmd-side-open'), doc: document.title }));
    // Mantener apretado y llevarlo hasta "to" (un punto); devuelve cómo se veía levantado y arrastrando.
    const drag = async (loc, to, opt) => {
      const from = await at(loc); await touch('touchStart', from[0], from[1]); await page.waitForTimeout(650);
      const up = await state(); if (opt && opt.shots) await shot(page, 'mover-01-levantado.png');
      await glide(from, to, 12, 25); await page.waitForTimeout(120);
      const mid = await state(); if (opt && opt.shots) await shot(page, 'mover-02-arrastrando.png');
      await touch('touchEnd'); await page.waitForTimeout(250);
      return { up, mid, end: await state() };
    };
    const start = await paths(); const title0 = await page.title();
    await shot(page, 'mover-00-antes.png');

    // Arrastrar un archivo a una carpeta
    let g = await drag(row('aaa-suelta.md'), await at(row('proyectos')), { shots: true });
    await page.waitForFunction(() => LMD.cloud.list(true).then((l) => l.some((n) => n.path === 'proyectos/aaa-suelta.md'))).catch(() => {});
    let now = await paths();
    check('mantener apretado un archivo lo levanta, con vibración y sin abrir el menú', g.up.lifted === 1 && g.up.menu === 0 && g.up.ghost === '' && (await page.evaluate(() => window.__vib)) === 1, g.up);
    check('al arrastrarlo viaja una etiqueta con su nombre y la carpeta de destino queda marcada', g.mid.ghost === 'aaa-suelta.md' && g.mid.dragging === 1 && J(g.mid.drop) === J(['proyectos']), g.mid);
    check('soltarlo sobre la carpeta lo mueve ahí, sin abrir la nota ni el menú', now.includes('proyectos/aaa-suelta.md') && !now.includes('aaa-suelta.md') && now.length === start.length && g.end.menu === 0 && g.end.lifted === 0 && g.end.ghost === '' && g.end.drawer && g.end.doc === title0, [now.filter((p) => /suelta/.test(p)), g.end]);
    await page.waitForSelector(CL + '.lmd-node >> text=zzz-lejos.md'); await page.waitForTimeout(300);

    // Un deslizamiento corto y rápido desliza el panel y no mueve nada
    const can = await page.evaluate(() => { const p = document.querySelector('.lmd-pane-files'); p.scrollTop = 0; return p.scrollHeight - p.clientHeight; });
    const sw = await at(row('n06.md'));
    await touch('touchStart', sw[0], sw[1]); await glide(sw, [sw[0], sw[1] - 220], 8, 16); await touch('touchEnd'); await page.waitForTimeout(500);
    const swiped = await state();
    check('un deslizamiento rápido desliza el panel, sin levantar nada ni abrir menú o nota', can > 100 && swiped.scroll > 60 && swiped.lifted === 0 && swiped.menu === 0 && swiped.ghost === '' && swiped.drawer && swiped.doc === title0 && J(await paths()) === J(now), [can, swiped]);

    // Mantener apretado sin mover: el menú de siempre, con "Move to…"
    await show(row('otra.md'));
    await press(page, row('otra.md')); await page.waitForSelector('.lmd-menu [data-f]', { timeout: 4000 }).catch(() => {});
    const menu = await page.evaluate(() => { const m = document.querySelector('.lmd-menu'); if (!m) return null; const r = m.getBoundingClientRect(); const b = m.querySelector('[data-f=mov]');
      return { items: [...m.querySelectorAll('[data-f]')].map((x) => x.dataset.f), mov: b ? b.textContent : '', h: b ? Math.round(b.getBoundingClientRect().height) : 0, in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, lifted: document.querySelectorAll('.lmd-lifted').length }; });
    check('mantener apretado sin mover abre el menú del archivo, con "Move to…" antes de eliminar', menu && menu.in && menu.lifted === 0 && menu.mov === 'Move to…' && menu.h >= 44 && menu.items.indexOf('mov') === menu.items.indexOf('ren') + 1 && menu.items.indexOf('del') > menu.items.indexOf('mov'), menu);
    await page.tap('.lmd-menu [data-f=mov]'); await page.waitForSelector('.lmd-mv-card'); await page.waitForTimeout(200);
    const pick = await page.evaluate(() => { const c = document.querySelector('.lmd-mv-card').getBoundingClientRect(); const bs = [...document.querySelectorAll('.lmd-mv button')];
      return { title: document.querySelector('.lmd-mv h3').textContent, rows: [...document.querySelectorAll('.lmd-mv-list button')].map((b) => b.querySelector('.lmd-mv-name').textContent + (b.disabled ? ' (' + b.querySelector('small').textContent + ')' : '')), low: Math.min(...bs.map((b) => Math.round(b.getBoundingClientRect().height))), in: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, menu: document.querySelectorAll('.lmd-menu').length }; });
    check('"Move to…" abre el selector: la nube (donde ya está, sin poder elegirla), sus carpetas y una carpeta nueva, con renglones de 44 px', pick.title === 'Move "otra.md" to…' && J(pick.rows) === J(['Cloud (It is here)', 'archivo', 'proyectos', 'New folder…']) && pick.low >= 44 && pick.in && pick.menu === 0, pick);
    await fits(page, 'selector de "Move to…"');
    await shot(page, 'mover-03-mover-a.png');
    await page.locator('.lmd-mv-list button', { hasText: 'archivo' }).tap();
    await page.waitForFunction(() => LMD.cloud.list(true).then((l) => l.some((n) => n.path === 'archivo/otra.md'))).catch(() => {});
    now = await paths();
    check('elegir una carpeta mueve el archivo ahí y cierra el selector', now.includes('archivo/otra.md') && !now.includes('otra.md') && now.length === start.length && (await page.locator('.lmd-mv').count()) === 0, now.filter((p) => /otra/.test(p)));
    await page.waitForSelector(CL + '.lmd-node >> text=zzz-lejos.md'); await page.waitForTimeout(300);
    // Cancelar no mueve nada
    await show(row('queda.md'));
    await press(page, row('queda.md')); await page.waitForSelector('.lmd-menu [data-f=mov]'); await page.tap('.lmd-menu [data-f=mov]'); await page.waitForSelector('.lmd-mv-card');
    await page.tap('.lmd-mv [data-mv=no]'); await page.waitForTimeout(300);
    check('"Cancel" cierra el selector sin mover nada', (await page.locator('.lmd-mv').count()) === 0 && J(await paths()) === J(now));
    // Sin carpeta adonde ir, se crea una desde el mismo selector
    await show(row('n16.md'));
    await press(page, row('n16.md')); await page.waitForSelector('.lmd-menu [data-f=mov]'); await page.tap('.lmd-menu [data-f=mov]'); await page.waitForSelector('.lmd-mv-card');
    await page.tap('.lmd-mv [data-mv=new]'); await page.waitForSelector('.lmd-dlg-card input'); await page.fill('.lmd-dlg-card input', 'nuevas'); await page.tap('.lmd-dlg-card [data-dlg=ok]');
    await page.waitForFunction(() => LMD.cloud.list(true).then((l) => l.some((n) => n.path === 'nuevas/n16.md'))).catch(() => {});
    now = await paths();
    check('"New folder…" pide el nombre y mueve la nota a la carpeta nueva', now.includes('nuevas/n16.md') && !now.includes('n16.md') && now.length === start.length, now.filter((p) => /n16/.test(p)));
    await page.waitForSelector(CL + '.lmd-node >> text=zzz-lejos.md'); await page.waitForTimeout(300);

    // Destinos que no valen: otro archivo de la misma carpeta, fuera del panel, y una nota del navegador sobre la nube
    await show(row('queda.md'));
    g = await drag(row('queda.md'), await at(row('tirar.md')));
    const bad1 = [g.mid.drop, g.end.menu, g.end.ask, g.end.lifted, g.end.ghost];
    const out = await page.evaluate(() => { const r = document.querySelector('.lmd-zone-outline, .lmd-pane-outline, .lmd-search').getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(20, r.height / 2)]; });
    g = await drag(row('queda.md'), out);
    const bad2 = [g.mid.drop, g.end.menu, g.end.ask, g.end.lifted, g.end.ghost];
    await toTop();
    g = await drag(row('del-navegador.md', '.lmd-xroot[data-root=local] '), await at(row('proyectos')));
    const bad3 = [g.mid.drop, g.end.menu, g.end.ask, g.end.lifted, g.end.ghost, g.up.lifted];
    await page.waitForTimeout(400);
    check('soltar en un destino que no vale no hace nada: ni mueve, ni pregunta, ni deja nada levantado', J(bad1) === J([[], 0, 0, 0, '']) && J(bad2) === J([[], 0, 0, 0, '']) && J(bad3) === J([[], 0, 0, 0, '', 1]) && J(await paths()) === J(now) && (await page.evaluate(async () => (await LMD.store.notesAll()).some((n) => n.name === 'del-navegador.md'))) && (await page.title()) === title0, [bad1, bad2, bad3]);

    // La papelera es un destino: pregunta lo mismo que "Eliminar"
    const bin =await page.evaluate(() => { const b = document.querySelector('.lmd-trash-link'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.left + 60, r.top + r.height / 2]; });
    await page.waitForTimeout(200);
    g = await drag(row('tirar.md'), bin); await page.waitForSelector('.lmd-dlg-card', { timeout: 3000 }).catch(() => {});
    const asked = await page.evaluate(() => { const h = document.querySelector('.lmd-dlg-card h3'); return h ? h.textContent : ''; });
    check('soltarlo en la papelera la marca y pregunta antes de eliminar, como con el mouse', J(g.mid.drop) === J(['papelera']) && asked === 'Delete "tirar.md"?', [g.mid.drop, asked]);
    await page.tap('[data-dlg=no]'); await page.waitForTimeout(200);
    check('y al cancelar la nota sigue en su lugar', J(await paths()) === J(now));

    // Cerca del borde de arriba el panel se desliza solo hasta llegar a la carpeta
    await page.evaluate(() => { const p = document.querySelector('.lmd-pane-files'); p.scrollTop = p.scrollHeight; }); await page.waitForTimeout(200);
    const far = await at(row('zzz-lejos.md')); const edge = await page.evaluate(() => { const r = document.querySelector('.lmd-pane-files').getBoundingClientRect(); return r.top + 12; });
    const s0 = (await state()).scroll;
    await touch('touchStart', far[0], far[1]); await page.waitForTimeout(650); await glide(far, [far[0], edge], 10, 25);
    await page.waitForFunction(() => document.querySelector('.lmd-pane-files').scrollTop === 0, null, { timeout: 8000 }).catch(() => {});
    const s1 = (await state()).scroll; const dir = await at(row('archivo'));
    await glide([far[0], edge], dir, 6, 25); await page.waitForTimeout(120); const over = await state();
    await touch('touchEnd');
    await page.waitForFunction(() => LMD.cloud.list(true).then((l) => l.some((n) => n.path === 'archivo/zzz-lejos.md'))).catch(() => {});
    now = await paths();
    check('con el dedo cerca del borde el panel se desliza solo, y se suelta en una carpeta que no estaba a la vista', s0 > 100 && s1 === 0 && J(over.drop) === J(['archivo']) && now.includes('archivo/zzz-lejos.md') && !now.includes('zzz-lejos.md'), [s0, s1, over.drop, now.filter((p) => /lejos/.test(p))]);
    await cdp.detach(); await ctx.close();
  }

  // Un enlace a un archivo del disco, en el teléfono: no hay extensión ni acceso a carpetas, así que no se ofrece
  // nada de "editar el archivo del disco" ni "abrir esta carpeta". Queda elegir el archivo, que se abre como copia.
  {
    const { ctx, page } = await open(390, 844);
    await page.addInitScript(() => { window.showOpenFilePicker = undefined; window.showDirectoryPicker = undefined; });
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]');
    await page.goto(home + '#open=' + encodeURIComponent('file:///C:/Users/me/notes/plan.md')); await page.waitForSelector('.lmd-dlg-card');
    const d = await page.evaluate(() => { const c = document.querySelector('.lmd-dlg-card'); return { buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((b) => b.textContent), text: c.querySelector('p').textContent, fs: document.querySelectorAll('[data-fs]').length, more: !!c.querySelector('.lmd-dlg-more') }; });
    check('teléfono: un enlace a un archivo del disco ofrece elegirlo, sin nada de carpetas ni de la extensión', J(d.buttons) === J(['Cancel', 'Choose the file']) && d.fs === 0 && !d.more, d);
    await fits(page, 'la pregunta de un enlace a un archivo del disco');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null), page.click('.lmd-dlg-card [data-dlg=ok]')]);
    if (chooser) await chooser.setFiles({ name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from('# Plan\n\nfrom the phone\n') });
    await page.waitForSelector('.markdown-body h1', { timeout: 8000 }).catch(() => {});
    const got = await page.evaluate(() => ({ h1: (document.querySelector('.markdown-body h1') || {}).textContent || '', f: new URLSearchParams(location.search).get('f'), copy: /Opened as a copy\. The file on your disk is not changed\./.test(document.body.textContent), fs: document.querySelectorAll('[data-fs]').length, bar: !document.querySelector('.lmd-copybar') || document.querySelector('.lmd-copybar').hidden }));
    check('teléfono: el archivo elegido queda como copia, con su aviso y sin botones para pasar al archivo', !!chooser && got.h1 === 'Plan' && /^mem\//.test(got.f || '') && got.copy && got.fs === 0 && got.bar, got);
    await page.evaluate(() => LMD.store.notePut('phone-note.md', '# Phone note\n'));
    await page.goto(home + '?f=' + encodeURIComponent('local/phone-note.md')); await page.waitForSelector('.markdown-body h1');
    const items = await page.evaluate(() => { const n = document.querySelector('.lmd-docname'); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 })); return [...document.querySelectorAll('.lmd-menu-narrow button')].map((b) => b.textContent.trim()); });
    check('teléfono: el menú del nombre solo ofrece renombrar', J(items) === J(['Rename']), items);
    await away(page);
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
