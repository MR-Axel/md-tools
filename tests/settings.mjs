// Ajustes en diez pestañas, la cuenta en el inicio, la vuelta del pago, el cambio de idioma y los comentarios.
// Todo contra un servidor local. sharpmd.app (la página de pago) se sirve desde esta carpeta y Paddle es un doble:
// nada sale a la red, y si algo intentara llegar al servidor de producción la prueba lo cuenta como falla.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 20000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const SITE = 'https://sharpmd.app';
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', FEEDBACK_TO: 'duenio@ejemplo.test', PUBLIC_URL: base, PORTAL_URL: 'https://portal.ejemplo.test/',
  CHECKOUT_MONTHLY: SITE + '/pay.html?plan=monthly', CHECKOUT_YEARLY: SITE + '/pay.html?plan=yearly', ALLOW_ORIGINS: SITE }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const outside = [];
await ctx.route(SITE + '/**', (r) => {
  const rel = decodeURIComponent(new URL(r.request().url()).pathname); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: '' });
  return r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
});
await ctx.route('https://cdn.paddle.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Paddle = { Initialize: function (o) { window.__paddleInit = o; }, Checkout: { open: function (o) { window.__paddle = o; } } };' }));
await ctx.route((url) => /(^|\.)(sync\.sharpmd\.app|evil\.example|ejemplo\.test)$/.test(url.hostname), (r) => { outside.push(r.request().url()); return r.abort(); });

const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(autoDialogs);
const sent = []; app.on('request', (r) => { if (r.url().startsWith(base)) sent.push(r.method() + ' ' + new URL(r.url()).pathname); });
const home = `chrome-extension://${id}/src/app.html`;
const mail = 'maria.fernandez.lopez.de.la.torre@estudio-ejemplo.com';
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const api = (method, p, body, s, extra) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const setPlan = (plan) => api('POST', '/admin/plan', { email: mail, plan }, undefined, { 'x-admin-key': 'clave-de-prueba' });
const stored = (key) => app.evaluate((k) => new Promise((resolve) => chrome.storage.local.get(k, (r) => resolve(r[k]))), key);
const cloudUrl = (p) => home + '?f=' + encodeURIComponent('cloud/' + p.split('/').map(encodeURIComponent).join('/'));
const tab = async (t) => { await app.click('[data-ptab=' + t + ']'); await app.waitForTimeout(450); };
const openSettings = async (t) => { await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); if (t) await tab(t); };
const TABS = ['look', 'read', 'plug', 'tools', 'cloud', 'ai', 'plan', 'inst', 'adv'];
// Ninguna pestaña puede necesitar scroll con la ventana a 800 px de alto.
const overflow = async () => { const out = []; for (const t of TABS) { await tab(t); const m = await app.evaluate(() => { const b = document.querySelector('.lmd-panel-body'); return b.scrollHeight - b.clientHeight; }); if (m > 0) out.push(t + ' +' + m); } return out; };
// Los dos renglones que dicen qué anda sin cuenta y qué suma tenerla: sin signos de admiración ni rayas largas. Van en Ajustes → Nube.
// En el inicio, la cuenta vive al pie de la barra lateral: sin sesión, la invitación a entrar con una línea de qué suma.
const perks = () => app.evaluate(() => [...document.querySelectorAll('.lmd-perks dt, .lmd-perks dd')].filter((n) => n.offsetWidth > 0).map((n) => n.textContent));
const claro = (p) => p.length === 4 && p[0] === 'Sin cuenta' && /editor/.test(p[1]) && /disco/.test(p[1]) && /navegador/.test(p[1]) && p[2] === 'Con cuenta' && /nube \(10 gratis\)/.test(p[3]) && /Compartir, historial/.test(p[3]) && /IA en el plan pago/.test(p[3]) && !/[!¡—]/.test(p.join(''));
const text = (sel) => app.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent.trim() : null; }, sel);

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
  await app.goto(home); await app.waitForSelector('.lmd-home');

  console.log('Comentarios con la nube apagada');
  await app.click('[data-home=feedback]'); await app.waitForSelector('.lmd-fb');
  const offFb = await app.evaluate(() => ({ link: (document.querySelector('.lmd-fb a') || {}).href, form: document.querySelectorAll('.lmd-fb textarea, .lmd-fb [data-fb=send]').length }));
  check('con la nube apagada ofrece el correo en vez del formulario', /^mailto:hello@sharpmd\.app/.test(offFb.link || '') && offFb.form === 0, offFb);
  await app.click('[data-fb=close]');
  await app.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url } }, resolve)), base);
  await app.goto(home); await app.waitForSelector('[data-cloud=ask]');

  console.log('Inicio: entrar');
  const err = () => app.evaluate(() => { const p = document.querySelector('.lmd-login .lmd-home-cloud-err'); const i = document.querySelector('.lmd-login [data-field]'); return [p && !p.hidden ? p.textContent : '', i.getAttribute('aria-invalid'), p && p.previousElementSibling === i.parentNode]; });
  const invita = await app.evaluate(() => { const foot = document.querySelector('.lmd-sidebar > .lmd-side-acct'); const b = foot && foot.querySelector('[data-cloud=ask]'); const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); const r = b && b.getBoundingClientRect();
    return { title: b && b.querySelector('b').textContent, line: b && b.querySelector('small').textContent, asks: document.querySelectorAll('[data-cloud=ask]').length, inCard: document.querySelectorAll('.lmd-home [data-cloud], .lmd-home .lmd-perks').length, atFoot: !!r && Math.abs(side.bottom - r.bottom) < 16 && r.left >= side.left && r.right <= side.right }; });
  check('inicio sin sesión: al pie de la barra lateral, una fila "Sin sesión" con una línea de qué da entrar', invita.title === 'Sin sesión' && invita.line === 'Entrá para sincronizar tus notas' && !/[!¡—–]/.test(invita.line) && invita.asks === 1 && invita.atFoot, invita);
  check('la tarjeta del inicio queda solo para empezar a escribir: sin cuenta ni planes', invita.inCard === 0 && (await perks()).length === 0, invita);
  await app.click('[data-cloud=ask]'); await app.waitForSelector('.lmd-home .lmd-login [data-field=email]');
  const form = await app.evaluate(() => { const box = document.querySelector('.lmd-home-card .lmd-login'); const acts = document.querySelector('.lmd-home-actions').getBoundingClientRect(); const r = box.getBoundingClientRect(); const card = document.querySelector('.lmd-home-card').getBoundingClientRect();
    return { below: r.top >= acts.bottom && r.left >= card.left - 1 && r.right <= card.right + 1, after: box.previousElementSibling === document.querySelector('.lmd-home-actions'), title: box.querySelector('h3').textContent, focus: document.activeElement.dataset.field,
      foot: document.querySelectorAll('.lmd-sidebar [data-field], .lmd-sidebar [data-cloud=start]').length, row: document.querySelectorAll('.lmd-sidebar [data-cloud=ask]').length, cancel: (box.querySelector('[data-cloud=cancel]') || {}).textContent, send: box.querySelector('[data-cloud=start]').textContent, dialogs: document.querySelectorAll('.lmd-ask').length }; });
  check('tocar la fila muestra el formulario en el centro, dentro de la tarjeta del inicio y debajo de los botones de empezar', form.below && form.after && form.title === 'Entrar a tu cuenta' && form.focus === 'email' && form.send === 'Enviar código' && form.dialogs === 0, form);
  check('el pie de la barra lateral no despliega nada: la fila sigue ahí, sin campos', form.foot === 0 && form.row === 1, form);
  await app.click('.lmd-login [data-cloud=cancel]');
  const cancelled = await app.evaluate(() => document.querySelectorAll('.lmd-login').length);
  await app.click('[data-cloud=ask]'); await app.waitForSelector('.lmd-home .lmd-login [data-field=email]'); await app.keyboard.press('Escape');
  check('"Cancelar" y Escape lo cierran', form.cancel === 'Cancelar' && cancelled === 0 && (await app.locator('.lmd-login').count()) === 0, [form.cancel, cancelled]);
  await app.click('[data-cloud=ask]'); await app.waitForSelector('.lmd-home .lmd-login [data-field=email]');
  const bad = {};
  for (const v of ['', 'ana', 'ana@ejemplo', 'ana@ejemplo..test', 'ana.@ejemplo.test', 'ana garcia@ejemplo.test']) { await app.fill('[data-field=email]', v); await app.click('[data-cloud=start]'); await app.waitForTimeout(120); bad[v] = await err(); }
  check('un correo mal escrito se avisa al lado del campo', Object.values(bad).every((b) => b[0] && b[1] === 'true' && b[2]) && bad[''][0] === 'Escribí tu correo.' && /no lleva espacios/.test(bad['ana garcia@ejemplo.test'][0]) && /no parece válido/.test(bad['ana@ejemplo'][0]), bad);
  check('y no se le pide nada al servidor', !sent.some((x) => /auth/.test(x)), sent);
  await app.fill('[data-field=email]', 'ana@ejemplo..tes'); await app.keyboard.press('Enter'); await app.waitForTimeout(120);
  const viaEnter = (await err())[0]; await app.keyboard.type('t');
  check('con Enter vale la misma regla, y el aviso se va al corregir', !!viaEnter && (await err())[0] === '' && !sent.some((x) => /auth/.test(x)), [viaEnter, await err()]);
  await app.fill('[data-field=email]', '  ' + mail.toUpperCase() + ' ');
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  const code = (await started.json()).dev_code;
  check('un correo bien escrito pide el código', started.status() === 200 && /^\d{6}$/.test(code), started.status());
  await app.waitForSelector('[data-field=code]');
  const codes = {};
  for (const v of ['', '12345', 'abcdef', '12 456']) { await app.fill('[data-field=code]', v); await app.click('[data-cloud=verify]'); await app.waitForTimeout(120); codes[v] = (await err())[0]; }
  check('el código tiene que ser de seis dígitos', Object.values(codes).every((c) => /seis dígitos/.test(c)) && !sent.some((x) => /verify/.test(x)), [codes, sent]);
  await app.fill('[data-field=code]', '');
  const pasted = await app.evaluate(() => { const i = document.querySelector('.lmd-home-card .lmd-login [data-field=code]'); const dt = new DataTransfer(); dt.setData('text', 'Your code: 123 456.'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { value: i.value, auto: i.getAttribute('autocomplete'), mode: i.getAttribute('inputmode'), focus: document.activeElement === i, where: !!i.closest('.lmd-home-card'), back: !!document.querySelector('.lmd-login [data-cloud=back]'), cancel: !!document.querySelector('.lmd-login [data-cloud=cancel]') }; });
  check('el código se escribe ahí mismo: campo de un solo uso con el foco puesto, y pegarlo entero deja los seis dígitos', pasted.value === '123456' && pasted.auto === 'one-time-code' && pasted.mode === 'numeric' && pasted.focus && pasted.where && pasted.back && pasted.cancel, pasted);

  // Sin sesión, los comentarios piden el correo como opcional y lo validan.
  await app.click('[data-home=feedback]'); await app.waitForSelector('.lmd-fb [data-fb=email]');
  await app.fill('[data-fb=text]', 'Probando desde el inicio, sin cuenta.'); await app.fill('[data-fb=email]', 'lectora@ejemplo'); await app.click('[data-fb=send]'); await app.waitForTimeout(150);
  const fbBadMail = await text('.lmd-fb .lmd-img-err');
  await app.fill('[data-fb=email]', 'lectora@correo-ejemplo.com');
  const [anon] = await Promise.all([app.waitForRequest((r) => r.url().endsWith('/feedback')), app.click('[data-fb=send]')]);
  await app.waitForSelector('.lmd-fb-ok'); const anonBody = anon.postDataJSON();
  check('comentarios sin sesión: el correo es opcional y se valida', /no parece válido/.test(fbBadMail || '') && anonBody.email === 'lectora@correo-ejemplo.com' && anonBody.text === 'Probando desde el inicio, sin cuenta.', [fbBadMail, anonBody]);
  await app.waitForSelector('.lmd-fb', { state: 'detached' });

  await app.fill('[data-field=code]', code); await app.click('[data-cloud=verify]'); await app.waitForSelector('[data-cloud=menu]');
  const session = (await stored('cloud')).session;
  const box = await app.evaluate(() => {
    const q = (s) => document.querySelector('.lmd-sidebar > .lmd-home-cloud ' + s); const b = q('.lmd-home-acct-who b'); const side = document.querySelector('.lmd-sidebar').getBoundingClientRect(); const row = q('.lmd-home-acct').getBoundingClientRect();
    return { email: b.textContent, sub: q('.lmd-home-acct-who small').textContent, oneLine: b.getBoundingClientRect().height < 26 && row.height < 52, cut: b.scrollWidth > b.clientWidth, title: b.title,
      inside: row.right <= side.right && row.left >= side.left, atFoot: Math.abs(side.bottom - row.bottom) < 16, shut: q('[data-cloud=menu]').getAttribute('aria-expanded'), early: document.querySelectorAll('[data-cloud=settings], [data-cloud=logout]').length };
  });
  await app.click('[data-cloud=menu]');
  const menu = await app.evaluate(() => { const m = document.querySelector('.lmd-side-acct .lmd-menu'); const r = m.getBoundingClientRect(); const row = document.querySelector('.lmd-home-acct').getBoundingClientRect();
    return { acts: [...m.querySelectorAll('[data-cloud]')].map((x) => x.dataset.cloud), labels: [...m.querySelectorAll('[data-cloud]')].map((x) => x.textContent.trim()),
      order: [...m.querySelector('.lmd-menu-list').children].map((x) => (x.tagName === 'HR' ? '-' : x.dataset.cloud + (x.classList.contains('lmd-menu-sub') ? '>' : ''))).join(' '), icons: Object.fromEntries([...m.querySelectorAll('[data-cloud]')].map((x) => [x.dataset.cloud, x.querySelector('svg').outerHTML])),
      inset: m.querySelector('[data-cloud=plan] svg').getBoundingClientRect().left - m.querySelector('[data-cloud=settings] svg').getBoundingClientRect().left, rowH: Math.round(m.querySelector('[data-cloud=plan]').getBoundingClientRect().height), above: r.bottom <= row.top && r.top >= 0, open: document.querySelector('[data-cloud=menu]').getAttribute('aria-expanded') }; });
  await app.keyboard.press('Escape');
  const shutAgain = await app.evaluate(() => [document.querySelectorAll('.lmd-side-acct .lmd-menu').length, document.querySelector('[data-cloud=menu]').getAttribute('aria-expanded'), document.activeElement.dataset.cloud]);
  check('conectado: correo, plan y notas', box.email === mail && /^Plan gratis · 0 de 10 notas/.test(box.sub), box);
  check('la cuenta es una fila fija al pie de la barra lateral, y un correo largo no la parte en dos renglones', box.oneLine && box.inside && box.atFoot && box.title === mail, box);
  check('las acciones de la cuenta están en un menú que abre hacia arriba: Ajustes, sus pestañas Plan e IA como atajos, y Salir aparte', box.shut === 'false' && box.early === 0 && menu.acts.join() === 'settings,plan,ai,logout' && menu.labels.join() === 'Ajustes,Plan,IA (MCP),Salir' && menu.order === 'settings plan> ai> - logout' && menu.above && menu.open === 'true', [box, menu.acts, menu.labels, menu.order]);
  check('el menú es compacto, con un ícono por renglón, y los atajos van un paso adentro', Object.values(menu.icons).every((s) => /^<svg/.test(s)) && menu.inset >= 16 && menu.rowH <= 32, [menu.inset, menu.rowH]);
  check('Escape cierra el menú de la cuenta y deja el foco en la fila', shutAgain[0] === 0 && shutAgain[1] === 'false' && shutAgain[2] === 'menu', shutAgain);
  await app.click('[data-cloud=menu]');

  // "Ajustes" abre Ajustes en la pestaña de la nube; los atajos llevan el nombre y el ícono de su pestaña.
  await app.click('[data-cloud=settings]'); await app.waitForSelector('.lmd-panel-card [data-acct=cloud] [data-c=open]');
  const tabs = await app.evaluate(() => ({ on: document.querySelector('.lmd-panel-card [data-ptab].lmd-on').dataset.ptab, menu: document.querySelectorAll('.lmd-side-acct .lmd-menu').length,
    plan: [document.querySelector('[data-ptab=plan] svg').outerHTML, document.querySelector('[data-ptab=plan]').textContent.trim()], ai: [document.querySelector('[data-ptab=ai] svg').outerHTML, document.querySelector('[data-ptab=ai]').textContent.trim()], gear: document.querySelector('[data-act=settings] svg').outerHTML }));
  check('"Ajustes" del menú de la cuenta abre Ajustes en la pestaña Nube y cierra el menú', tabs.on === 'cloud' && tabs.menu === 0, tabs.on);
  check('cada atajo lleva el mismo nombre y el mismo ícono que su pestaña, y Ajustes el del botón de arriba', tabs.plan[0] === menu.icons.plan && tabs.plan[1] === 'Plan' && tabs.ai[0] === menu.icons.ai && tabs.ai[1] === 'IA (MCP)' && menu.labels[2] === tabs.ai[1] && tabs.gear === menu.icons.settings, [tabs.plan[1], tabs.ai[1]]);
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-panel-card', { state: 'hidden' });
  await app.click('[data-cloud=menu]'); await app.click('[data-cloud=plan]'); await app.waitForSelector('.lmd-acct-card, .lmd-panel-card [data-ptab=plan].lmd-on');
  check('el atajo Plan abre los planes', await app.waitForSelector('.lmd-acct-card .lmd-plans', { timeout: 8000 }).then(() => true, () => false));
  await app.keyboard.press('Escape'); await app.waitForSelector('.lmd-acct-card', { state: 'detached' });
  await app.click('[data-cloud=menu]'); await app.click('[data-cloud=settings]'); await app.waitForSelector('.lmd-panel-card [data-acct=cloud] [data-c=open]');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-panel-card [data-acct=cloud] [data-c=open]')]); await app.waitForSelector('.lmd-draft'); await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node.lmd-active');
  const firstNote = (await api('GET', '/notes', undefined, session)).json.map((n) => n.path);
  const empty = await app.evaluate(() => ({ url: location.search, tree: [...document.querySelectorAll('.lmd-xroot[data-root=cloud] .lmd-node')].map((n) => n.textContent.trim() + (n.classList.contains('lmd-active') ? '*' : '')), shown: !document.querySelector('.lmd-pane-files').hidden && document.querySelector('.lmd-pane-files').getBoundingClientRect().width > 100 }));
  check('sin notas, "Abrir la carpeta Nube" de Ajustes abre la carpeta con la primera lista para escribir', firstNote.length === 1 && /^nota-.*\.md$/.test(firstNote[0]) && /f=cloud%2Fnota-/.test(empty.url) && empty.shown && empty.tree.length === 1 && empty.tree[0] === firstNote[0] + '*', [firstNote, empty]);

  console.log('Idioma: Ajustes sin el menú de insertar encima');
  await app.waitForSelector('.lmd-menu');
  await app.evaluate(() => document.querySelector('[data-act=settings]').click()); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=look]'); // Ajustes recuerda la última pestaña, que fue la de la nube
  check('abrir Ajustes cierra el menú de bloques', (await app.locator('.lmd-menu').count()) === 0);
  await Promise.all([app.waitForNavigation(), app.click('.lmd-seg[data-seg=language] button[data-val=en]')]);
  await app.waitForSelector('.lmd-panel-card'); await app.waitForSelector('html.lmd-editing'); await app.waitForTimeout(900);
  const en = await app.evaluate(() => ({ title: document.querySelector('.lmd-panel-card h2').textContent, menus: document.querySelectorAll('.lmd-menu').length, tab: document.querySelector('[data-ptab].lmd-on').dataset.ptab, tabs: [...document.querySelectorAll('[data-ptab]')].map((b) => b.textContent.trim()).join('|'), foot: document.querySelector('[data-act=feedback]').textContent.trim() }));
  check('al cambiar de idioma en una nota vacía, Ajustes vuelve solo, sin menú encima', en.title === 'Settings' && en.menus === 0 && en.tab === 'look', en);
  check('las pestañas y el pie están traducidos', en.tabs === 'Appearance|Reading and editing|Plugins|Tools|Cloud|AI (MCP)|Automations|Plan|Install|Advanced' && en.foot === 'Send feedback', en);
  await Promise.all([app.waitForNavigation(), app.click('.lmd-seg[data-seg=language] button[data-val=es]')]);
  await app.waitForSelector('.lmd-panel-card'); await app.waitForSelector('html.lmd-editing'); await app.waitForTimeout(600);
  await app.click('[data-act=close-panel]'); await app.click('.lmd-add');
  check('cerrados los Ajustes, el menú de insertar sigue disponible', (await app.locator('.lmd-menu').count()) === 1);
  await app.keyboard.press('Escape'); await app.click('[data-act=mode-read]');

  console.log('Ajustes, plan gratis');
  await openSettings();
  check('diez pestañas en orden', (await app.evaluate(() => [...document.querySelectorAll('[data-ptab]')].map((b) => b.dataset.ptab + ':' + b.textContent.trim()).join('|'))) === 'look:Apariencia|read:Lectura y edición|plug:Plugins|tools:Herramientas|cloud:Nube|ai:IA (MCP)|auto:Automatizaciones|plan:Plan|inst:Instalar|adv:Avanzado');
  // Pie de la barra: comentarios, apoyar el proyecto y la versión, que tiene que ser la del manifiesto.
  const foot = await app.evaluate(() => { const nav = document.querySelector('.lmd-ptabs'); const a = nav.querySelector('a.lmd-ptabs-link'); const v = nav.querySelector('.lmd-ptabs-ver'); const box = (n) => n.getBoundingClientRect();
    return { last: [...nav.children].slice(-3).map((k) => k.textContent.trim()), href: a.href, target: a.target, rel: a.rel, ver: v.textContent, lmd: LMD.VERSION, sponsor: LMD.SPONSOR_URL,
      stacked: box(a).top >= box(nav.querySelector('[data-act=feedback]')).bottom - 1 && box(v).top >= box(a).bottom - 1 && box(v).bottom <= box(nav).bottom }; });
  const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
  const constVersion = (/const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src', 'defaults.js'), 'utf8')) || [])[1];
  check('LMD.VERSION es el mismo número que manifest.json', /^\d+\.\d+\.\d+$/.test(manifestVersion) && constVersion === manifestVersion && foot.lmd === manifestVersion, [manifestVersion, constVersion, foot.lmd]);
  check('al pie de las pestañas: enviar comentarios, apoyar el proyecto y la versión', JSON.stringify(foot.last) === JSON.stringify(['Enviar comentarios', 'Apoyar el proyecto', 'SharpMD ' + manifestVersion]) && foot.stacked, foot);
  check('apoyar el proyecto abre el enlace en una pestaña nueva', foot.href.replace(/\/$/, '') === foot.sponsor.replace(/\/$/, '') && foot.target === '_blank' && /noopener/.test(foot.rel), foot);
  let over = await overflow();
  check('ninguna pestaña necesita scroll a 800 px de alto (plan gratis)', over.length === 0, over);
  await tab('cloud');
  const freeCloud = await app.evaluate(() => [...document.querySelectorAll('[data-acct=cloud] .lmd-acct-row')].map((r) => r.children[0].textContent + '=' + r.children[1].textContent).join('|') + ' / ' + [...document.querySelectorAll('[data-acct=cloud] button')].map((b) => b.textContent).join('|'));
  check('Nube: la cuenta, el plan y cuántas notas, con abrir la carpeta, salir y eliminar la cuenta', freeCloud === 'Cuenta=' + mail + '|Nombre visible=' + mail.split('@')[0] + '|Plan=Gratis|Notas en la nube=1 de 10 / Cambiar|Abrir la carpeta Nube|Salir|Proteger una carpeta|Eliminar la cuenta', freeCloud);
  // el nombre visible se cambia en el lugar, y se muestra siempre como texto
  const nameHint = await text('[data-acct=cloud] .lmd-acct-name-hint');
  await app.click('[data-acct=cloud] [data-c=name]'); await app.waitForSelector('[data-acct=cloud] [data-name-in]');
  const nameEdit = await app.evaluate(() => ({ foco: document.activeElement.matches('[data-name-in]'), valor: document.activeElement.value, max: document.activeElement.maxLength, nombre: document.activeElement.getAttribute('aria-label') }));
  await app.fill('[data-acct=cloud] [data-name-in]', 'm@l'); await app.keyboard.press('Enter'); await app.waitForTimeout(200);
  const nameBad = await app.evaluate(() => ({ aviso: document.querySelector('[data-acct=cloud] .lmd-acct-name-hint').textContent, mal: document.querySelector('[data-acct=cloud] [data-name-in]').getAttribute('aria-invalid') }));
  await app.fill('[data-acct=cloud] [data-name-in]', '<b id=pwn>María</b>'); await app.keyboard.press('Enter'); await app.waitForSelector('[data-acct=cloud] [data-name]');
  const nameNow = await app.evaluate(() => ({ fila: document.querySelector('[data-acct=cloud] [data-name]').textContent, html: !!document.querySelector('#pwn'), cuenta: LMD.sync.account().name, defecto: LMD.sync.account().name_default }));
  check('Nube: el nombre visible, con su línea, se cambia en el lugar', nameHint === 'Los demás ven este nombre en notas compartidas y equipos' && nameEdit.foco && nameEdit.valor === mail.split('@')[0] && nameEdit.max === 40 && nameEdit.nombre === 'Nombre visible' && nameNow.cuenta === '<b id=pwn>María</b>' && nameNow.defecto === false, [nameHint, nameEdit, nameNow]);
  check('un nombre con arroba se avisa ahí mismo', nameBad.aviso === 'De 2 a 40 caracteres, sin arroba.' && nameBad.mal === 'true', nameBad);
  check('y se muestra siempre como texto, nunca como HTML', nameNow.fila === '<b id=pwn>María</b>' && nameNow.html === false, nameNow);
  await app.click('[data-acct=cloud] [data-c=name]'); await app.fill('[data-acct=cloud] [data-name-in]', ''); await app.click('[data-acct=cloud] [data-c=name-ok]'); await app.waitForSelector('[data-acct=cloud] [data-name]');
  check('vacío vuelve a lo que va antes de la arroba', (await text('[data-acct=cloud] [data-name]')) === mail.split('@')[0], await text('[data-acct=cloud] [data-name]'));
  await tab('ai');
  const freeAi = await text('[data-acct=ai]');
  await app.click('[data-acct=ai] [data-c=plans]'); await app.waitForTimeout(450);
  check('IA en el plan gratis: una línea que lo explica y lleva a Plan', /Conectar una IA es parte del plan pago\./.test(freeAi) && !/[!¡—]/.test(freeAi) && (await app.evaluate(() => document.querySelector('[data-ptab].lmd-on').dataset.ptab)) === 'plan' && (await app.locator('[data-acct=ai] .lmd-field').count()) === 0, freeAi);
  const here = app.url();
  const freePlan = await app.evaluate(() => ({ cards: [...document.querySelectorAll('[data-acct=plan] .lmd-plan')].map((c) => c.querySelector('h4').firstChild.nodeValue.trim() + (c.classList.contains('lmd-plan-on') ? '*' : '') + (/Es tu plan actual/.test(c.textContent) ? '!' : '')).join('|'),
    pay: [...document.querySelectorAll('[data-acct=plan] [data-pay]')].map((a) => ({ label: a.textContent, href: a.href, target: a.getAttribute('target') })), manage: /Administrar/.test(document.querySelector('[data-acct=plan]').textContent) }));
  const backOf = (href) => new URL(href).searchParams.get('back');
  check('Plan: las dos tarjetas, con la gratis marcada como actual', freePlan.cards === 'Gratis*!|Pago' && !freePlan.manage, freePlan);
  check('los botones de pago abren en la misma pestaña y llevan a dónde volver', freePlan.pay.length === 2 && freePlan.pay.every((p) => p.target === null && backOf(p.href) === here && new URL(p.href).searchParams.get('email') === mail) && /plan=monthly/.test(freePlan.pay[0].href) && /plan=yearly/.test(freePlan.pay[1].href), [here, freePlan.pay]);
  await tab('look'); await app.click('[data-act=see-plans]'); await app.waitForTimeout(450);
  check('"Ver planes" abre Ajustes directo en Plan', (await app.evaluate(() => document.querySelector('[data-ptab].lmd-on').dataset.ptab + ':' + [...document.querySelectorAll('.lmd-panel-body > section:not([hidden]) h3')].map((h) => h.textContent).join())) === 'plan:Plan');
  await tab('adv');
  const freeAdv = await app.evaluate(() => { const t = document.querySelector('[data-key=customCSS]'); return { off: t.disabled, tag: t.closest('section').querySelector('.lmd-tag').textContent, own: document.querySelector('[data-server=own]').checked, url: document.querySelector('[data-server=url]').value, shown: !document.querySelector('.lmd-server-url').hidden }; });
  check('Avanzado: el CSS propio sigue siendo del plan pago, y el servidor propio muestra su dirección', freeAdv.off && freeAdv.tag === 'Plan pago' && freeAdv.own && freeAdv.url === base && freeAdv.shown, freeAdv);
  await app.click('[data-act=close-panel]');
  await app.click('.lmd-sync'); await app.click('.lmd-menu [data-s=ai]'); await app.waitForSelector('.lmd-panel-card'); await app.waitForTimeout(450);
  check('"Conectar una IA" del menú de la nube abre Ajustes en IA', (await app.evaluate(() => document.querySelector('[data-ptab].lmd-on').dataset.ptab)) === 'ai');

  console.log('Comentarios desde Ajustes');
  await app.click('[data-act=feedback]'); await app.waitForSelector('.lmd-fb');
  const before = sent.filter((x) => /feedback/.test(x)).length;
  await app.fill('[data-fb=text]', ' abc '); await app.click('[data-fb=send]'); await app.waitForTimeout(150);
  check('un comentario de menos de cinco letras no se manda', /unas palabras/.test(await text('.lmd-fb .lmd-img-err') || '') && sent.filter((x) => /feedback/.test(x)).length === before && (await app.locator('.lmd-fb [data-fb=email]').count()) === 0);
  await app.fill('[data-fb=text]', 'El menú de insertar tapa los Ajustes.');
  const [fbReq] = await Promise.all([app.waitForRequest((r) => r.url().endsWith('/feedback')), app.click('[data-fb=send]')]);
  await app.waitForSelector('.lmd-fb-ok'); const fbBody = fbReq.postDataJSON(); const okText = await text('.lmd-fb-ok');
  check('se manda con sesión y confirma con "Enviado"', okText === 'Enviado' && fbBody.text === 'El menú de insertar tapa los Ajustes.' && !!fbReq.headers().authorization, [okText, fbBody]);
  check('el contexto lleva versión, extensión o web, navegador e idioma, y nada de la nota', Object.keys(fbBody.context).sort().join() === 'browser,lang,version,where' && /^\d+\.\d+\.\d+$/.test(fbBody.context.version) && fbBody.context.where === 'extension' && fbBody.context.lang === 'es' && /Chrome/.test(fbBody.context.browser) && !JSON.stringify(fbBody).includes(firstNote[0]) && !/app\.html|cloud\//.test(JSON.stringify(fbBody)), fbBody);
  await app.waitForSelector('.lmd-fb', { state: 'detached' });
  check('y la ventana se cierra sola', (await app.locator('.lmd-ask').count()) === 0);
  // Un servidor que no recibe comentarios (uno propio sin actualizar, o sin FEEDBACK_TO): queda el correo.
  const noRoute = (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_route"}' });
  await ctx.route(base + '/feedback', noRoute);
  await app.click('[data-act=feedback]'); await app.waitForSelector('.lmd-fb'); await app.fill('[data-fb=text]', 'Esto no tiene adónde ir.'); await app.click('[data-fb=send]'); await app.waitForSelector('.lmd-fb a');
  const fallback = await app.evaluate(() => document.querySelector('.lmd-fb a').href);
  check('si el servidor no recibe comentarios, ofrece el correo con lo escrito', /^mailto:hello@sharpmd\.app\?subject=SharpMD%20feedback&body=Esto%20no%20tiene/.test(fallback), fallback);
  await app.click('[data-fb=close]'); await ctx.unroute(base + '/feedback', noRoute);
  await app.click('[data-act=close-panel]');

  console.log('Un archivo abierto directo en el navegador');
  // Ahí el lector corre dentro de la página del archivo y el servidor no le responde: la cuenta se maneja en la app.
  const admin = await ctx.newPage(); await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
  await admin.evaluate(async () => { for (const e of await chrome.developerPrivate.getExtensionsInfo()) await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: e.id, fileAccess: true }); });
  await admin.close();
  const file = await ctx.newPage(); file.on('pageerror', (e) => errors.push('archivo: ' + e.message));
  const asked = []; file.on('request', (r) => { if (r.url().startsWith(base)) asked.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await file.goto(pathToFileURL(path.join(root, 'examples', 'sample.md')).href); await file.waitForSelector('.markdown-body h1');
  await file.click('[data-act=settings]'); await file.waitForSelector('.lmd-panel-card');
  const direct = {};
  for (const t of ['cloud', 'ai', 'plan']) { await file.click('[data-ptab=' + t + ']'); await file.waitForTimeout(500); direct[t] = await file.evaluate((k) => document.querySelector('[data-acct=' + k + ']').textContent, t); }
  await file.waitForTimeout(800);
  check('sobre un archivo directo, Nube, IA y Plan mandan a la app en vez de fallar', Object.values(direct).every((d) => /La cuenta se maneja desde la app de SharpMD\./.test(d) && /Abrir SharpMD/.test(d) && !/No hay conexión/.test(d)) && /Gratis/.test(direct.plan), direct);
  check('y no le piden nada al servidor', asked.length === 0, asked.slice(0, 5));
  const buy = await file.evaluate(() => ({ paid: [...document.querySelectorAll('[data-acct=plan] .lmd-plan + .lmd-plan .lmd-plan-buy [data-c=app]')].map((b) => b.textContent + ' ' + b.dataset.at + (b.classList.contains('lmd-btn-fill') ? ' fill' : '')),
    open: [...document.querySelectorAll('[data-acct=plan] .lmd-acct-actions [data-c=app]')].map((b) => b.textContent + (b.classList.contains('lmd-btn-fill') ? ' fill' : '')), price: document.querySelector('[data-acct=plan] .lmd-plan + .lmd-plan h4').textContent }));
  check('Plan sobre un archivo directo: la tarjeta del plan pago trae suscribirse por mes y por año, con los precios de la app, y "Abrir SharpMD" queda de secundario',
    buy.paid.join('|') === 'USD 3.99 / mes #lmd-plans fill|USD 39 / año #lmd-plans fill' && buy.open.join('|') === 'Abrir SharpMD' && /USD 3\.99 \/ mes/.test(buy.price), buy);
  await file.evaluate(() => document.documentElement.classList.add('lmd-store-app'));
  check('dentro de la app de Android los botones de compra no se ven', await file.evaluate(() => getComputedStyle(document.querySelector('[data-acct=plan] .lmd-plan-buy')).display === 'none'));
  await file.evaluate(() => document.documentElement.classList.remove('lmd-store-app'));
  // Por defecto SharpMD se abre en la web: una pestaña nueva, ya en la pestaña de Ajustes que toca.
  const goes = async (tab, sel) => { await file.bringToFront(); await file.click('[data-ptab=' + tab + ']'); const [p] = await Promise.all([ctx.waitForEvent('page'), file.click('[data-acct=' + tab + '] ' + sel)]); const first = p.url(); await p.waitForSelector('.lmd-home'); return { p, first }; };
  const onTab = async (p) => { await p.waitForTimeout(600); for (let i = 0; i < 3; i++) { try { return await p.evaluate(() => { const t = document.querySelector('[data-ptab].lmd-on'); return !document.querySelector('.lmd-panel').hidden && t ? t.dataset.ptab : ''; }); } catch (e) { await p.waitForTimeout(500); } } return 'sin página'; };
  const webPlan = await goes('plan', '.lmd-plan-buy [data-c=app]'); await webPlan.p.waitForSelector('.lmd-panel .lmd-plans');
  check('suscribirse abre la app web en una pestaña nueva, directo en los planes', webPlan.first === SITE + '/src/app.html#lmd-plans' && (await onTab(webPlan.p)) === 'plan', webPlan.first);
  await webPlan.p.close();
  const webAi = await goes('ai', '[data-c=app]'); await webAi.p.waitForSelector('.lmd-panel [data-acct=ai]');
  check('en IA, "Abrir SharpMD" abre la app web en Ajustes > IA', webAi.first === SITE + '/src/app.html#lmd-ai' && (await onTab(webAi.p)) === 'ai' && !/#/.test(webAi.p.url()), [webAi.first, webAi.p.url()]);
  await webAi.p.close();
  const webCloud = await goes('cloud', '[data-c=app]'); await webCloud.p.waitForSelector('.lmd-home .lmd-login [data-field=email]');
  check('en Nube, abre la app web lista para entrar', webCloud.first === SITE + '/src/app.html?login=1', webCloud.first);
  await webCloud.p.close();
  // Con "Abrir SharpMD en: esta extensión", los mismos botones abren la página de la extensión con la misma ancla.
  const openWas = await stored('settings');
  await app.evaluate((v) => new Promise((resolve) => chrome.storage.local.set({ settings: v }, resolve)), Object.assign({}, openWas, { openIn: 'ext' }));
  const extPlan = await goes('plan', '.lmd-plan-buy [data-c=app]'); await extPlan.p.waitForSelector('.lmd-panel .lmd-plans');
  check('con "esta extensión" elegida, suscribirse abre la página de la extensión en los planes', extPlan.first === home + '#lmd-plans' && (await onTab(extPlan.p)) === 'plan', extPlan.first);
  await extPlan.p.close();
  const opened = (await goes('plan', '.lmd-acct-actions [data-c=app]')).p;
  check('"Abrir SharpMD" de Plan también lleva a los planes', opened.url().split('#')[0] === home, opened.url());
  await opened.close();
  const extCloud = await goes('cloud', '[data-c=app]'); // en esta página la cuenta ya está abierta: no hay nada que pedir
  check('"Abrir SharpMD" de Nube abre la app, lista para entrar', extCloud.first === home + '?login=1', extCloud.first);
  await extCloud.p.close();
  await app.evaluate((v) => new Promise((resolve) => chrome.storage.local.set({ settings: v }, resolve)), openWas);
  await file.bringToFront();
  await file.click('[data-act=feedback]'); await file.waitForSelector('.lmd-fb a');
  check('los comentarios ofrecen el correo', /^mailto:hello@sharpmd\.app/.test(await file.evaluate(() => document.querySelector('.lmd-fb a').href)) && (await file.locator('.lmd-fb textarea').count()) === 0);
  await file.close(); await app.bringToFront();

  console.log('Pago: ida y vuelta en la misma pestaña');
  // Una carpeta con un cambio sin guardar: al salir a pagar tiene que quedar escrito en el archivo.
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pago', { create: true });
    const h = await dir.getFileHandle('README.md', { create: true }); const w = await h.createWritable(); await w.write('# Carpeta\n\nUn párrafo.\n'); await w.close();
    window.showDirectoryPicker = async () => dir;
  });
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
  const docUrl = app.url();
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(300);
  await app.locator('.lmd-article p.lmd-editable').first().click(); await app.keyboard.press('End'); await app.keyboard.type(' Sin guardar.'); await app.keyboard.press('Enter'); await app.waitForTimeout(300);
  const unsaved = await text('.lmd-savestate');
  await openSettings('plan');
  const tabsBefore = ctx.pages().length;
  await Promise.all([app.waitForURL(/sharpmd\.app\/pay\.html/), app.click('[data-acct=plan] [data-pay]')]); await app.waitForSelector('#buy:not([hidden])');
  const pay = await app.evaluate(() => ({ email: document.getElementById('email').textContent, back: document.querySelector('#buy [data-back]').href, backShown: document.querySelector('#buy [data-back]').getBoundingClientRect().height > 0, other: document.getElementById('other').href, query: location.search }));
  check('pagar sale en la misma pestaña, para la cuenta abierta', ctx.pages().length === tabsBefore && pay.email === mail && /plan=monthly/.test(pay.query), [ctx.pages().length, tabsBefore, pay]);
  check('la página de pago deja volver sin pagar, y el otro plan conserva la vuelta', pay.back === docUrl && pay.backShown && backOf(pay.other) === docUrl && /plan=yearly/.test(pay.other), pay);
  await app.click('#go');
  const paddle = await app.evaluate(() => window.__paddle);
  check('Paddle recibe la cuenta y una vuelta que conserva back', paddle.customData.sharpmd_email === mail && /pay\.html\?done=1&back=/.test(paddle.settings.successUrl) && backOf(paddle.settings.successUrl) === docUrl, paddle);
  await app.goto(paddle.settings.successUrl);
  await app.waitForURL((u) => u.href.startsWith(docUrl), { timeout: 15000 }); await app.waitForSelector('.lmd-paywait');
  const back = await app.evaluate(() => ({ hash: location.hash, tab: document.querySelector('[data-ptab].lmd-on').dataset.ptab, wait: document.querySelector('.lmd-paywait').textContent, cls: document.querySelector('.lmd-paywait').className, panel: !document.querySelector('.lmd-panel').hidden, menus: document.querySelectorAll('.lmd-menu').length }));
  check('al terminar vuelve sola a la nota, con Ajustes en Plan esperando la confirmación', back.hash === '#lmd-paid' && back.tab === 'plan' && back.panel && back.wait === 'Esperando la confirmación del pago…' && /lmd-paywait-wait/.test(back.cls) && back.menus === 0, back);
  const onDisk = await app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pago'); return (await (await (await dir.getFileHandle('README.md')).getFile()).text()).split('\n')[2]; });
  check('lo que estaba sin guardar quedó escrito antes de salir', /sin guardar/i.test(unsaved || '') && onDisk === 'Un párrafo. Sin guardar.', [unsaved, onDisk]);
  const pace = await app.evaluate(() => LMD.sync.PAY);
  check('consulta la cuenta cada pocos segundos, con tope de un par de minutos', pace.every >= 2000 && pace.every <= 5000 && pace.max >= 90000 && pace.max <= 180000 && sent.filter((x) => x === 'GET /account').length > 0, pace);
  await app.waitForTimeout(pace.every + 600);
  check('mientras el plan no cambia, sigue esperando', /lmd-paywait-wait/.test(await app.evaluate(() => document.querySelector('.lmd-paywait').className)) && (await stored('settings')).supporter !== true);
  await setPlan('pro');
  await app.waitForSelector('.lmd-paywait-done', { timeout: 15000 }); await app.waitForTimeout(700);
  const done = await app.evaluate(() => ({ hash: location.hash, url: location.href, msg: document.querySelector('.lmd-paywait').textContent, cards: [...document.querySelectorAll('[data-acct=plan] .lmd-plan')].map((c) => c.querySelector('h4').firstChild.nodeValue.trim() + (c.classList.contains('lmd-plan-on') ? '*' : '')).join('|'),
    manage: (document.querySelector('[data-acct=plan] .lmd-plan-on a') || {}).href, manageText: (document.querySelector('[data-acct=plan] .lmd-plan-on a') || {}).textContent, buy: document.querySelectorAll('[data-acct=plan] [data-pay]').length, current: /Es tu plan actual\./.test(document.querySelector('[data-acct=plan] .lmd-plan-on').textContent) }));
  check('cuando el servidor confirma, la pestaña Plan se refresca sola', done.msg === 'Pago confirmado. Ya tenés el plan pago.' && done.cards === 'Gratis|Pago*' && done.current && done.buy === 0, done);
  check('con plan pago aparece "Administrar la suscripción"', done.manage === 'https://portal.ejemplo.test/' && done.manageText === 'Administrar la suscripción', done);
  check('y la marca sale de la dirección', done.hash === '' && done.url === docUrl, done);
  await tab('look');
  const unlocked = await app.evaluate(() => ({ font: !document.querySelector('select[data-key=fontFamily]').disabled, swatches: !document.querySelector('.lmd-swatches').classList.contains('lmd-locked'), tags: document.querySelectorAll('.lmd-panel .lmd-tag').length, css: !document.querySelector('[data-key=customCSS]').disabled }));
  check('las personalizaciones quedan desbloqueadas', (await stored('settings')).supporter === true && unlocked.font && unlocked.swatches && unlocked.css && unlocked.tags === 0, unlocked);

  // Si la confirmación no llega: se dice, sin signos de admiración, y se puede volver a revisar.
  await setPlan('free'); await tab('plan');
  await app.evaluate(() => { LMD.sync.PAY.max = 900; LMD.sync.PAY.every = 250; LMD.sync.awaitPaid(); });
  await app.waitForSelector('.lmd-paywait-wait'); await app.waitForSelector('.lmd-paywait-late', { timeout: 8000 });
  const late = await app.evaluate(() => ({ msg: document.querySelector('.lmd-paywait span').textContent, again: document.querySelector('.lmd-paywait [data-c=recheck]').textContent }));
  check('pasado el tope lo dice y sugiere reintentar, sin signos de admiración', /todavía no llegó/.test(late.msg) && /unos minutos/.test(late.msg) && !/[!¡—]/.test(late.msg) && late.again === 'Revisar ahora', late);
  await app.click('.lmd-paywait [data-c=recheck]'); await app.waitForSelector('.lmd-paywait-wait');
  await setPlan('pro'); await app.waitForSelector('.lmd-paywait-done', { timeout: 8000 });
  check('"Revisar ahora" vuelve a consultar y encuentra el pago', true);
  await app.evaluate(() => { LMD.sync.PAY.max = 120000; LMD.sync.PAY.every = 3000; });

  console.log('Página de pago: solo vuelve a la app');
  const payPage = await ctx.newPage(); payPage.on('pageerror', (e) => errors.push('pay: ' + e.message));
  const backLink = async (b) => { await payPage.goto(SITE + '/pay.html?plan=monthly&email=' + encodeURIComponent(mail) + (b == null ? '' : '&back=' + encodeURIComponent(b))); await payPage.waitForSelector('#buy:not([hidden])'); return payPage.evaluate(() => document.querySelector('#buy [data-back]').href); };
  const fallbackUrl = SITE + '/src/app.html';
  const refused = {};
  for (const b of [null, 'https://evil.example/robo', '//evil.example/robo', 'javascript:alert(1)', 'https://sharpmd.app.evil.example/', 'http://sharpmd.app/src/app.html', 'data:text/html,hola', '\\\\evil.example\\robo']) refused[String(b)] = await backLink(b);
  check('back hacia otro sitio se ignora y queda la app', Object.values(refused).every((h) => h === fallbackUrl), refused);
  const sameOrigin = SITE + '/src/app.html?f=' + encodeURIComponent('local/nota.md');
  check('back del mismo sitio o de la extensión se acepta', (await backLink(sameOrigin)) === sameOrigin && (await backLink(docUrl + '#algo')) === docUrl, [await backLink(sameOrigin)]);
  await payPage.goto(SITE + '/pay.html?done=1&back=' + encodeURIComponent('https://evil.example/robo')); await payPage.waitForSelector('#done:not([hidden])'); await payPage.waitForTimeout(1800);
  const stay = await payPage.evaluate(() => ({ url: location.href, stay: !document.getElementById('stay').hidden, returning: !document.getElementById('returning').hidden, link: document.querySelector('[data-paid]').href, bang: /[!¡]/.test(document.getElementById('done').textContent) }));
  check('con un back ajeno, al terminar no redirige a ningún lado', /pay\.html\?done=1/.test(stay.url) && stay.stay && !stay.returning && stay.link === fallbackUrl + '#lmd-paid' && !stay.bang, stay);
  // La app web, servida desde el mismo sitio: vuelve sola y, sin sesión, limpia la marca.
  await payPage.goto(SITE + '/pay.html?done=1&back=' + encodeURIComponent(SITE + '/src/app.html'));
  await payPage.waitForURL((u) => u.pathname === '/src/app.html', { timeout: 15000 }); await payPage.waitForSelector('.lmd-home'); await payPage.waitForSelector('.lmd-acct-card');
  await payPage.waitForFunction(() => location.hash === '', null, { timeout: 8000 });
  check('en la web vuelve a la app del mismo sitio y abre el plan', (await payPage.evaluate(() => document.querySelector('.lmd-acct-card').getAttribute('aria-label'))) === 'Plan');
  check('nada intentó salir a otro sitio', outside.length === 0, outside);
  await payPage.close(); await app.bringToFront();

  console.log('Ajustes, plan pago');
  for (const p of ['archivo/vieja.md', 'proyectos/plan.md', 'proyectos/nueva.md']) { await api('PUT', '/notes/' + encodeURIComponent(p), { text: '# ' + p + '\n' }, session); await new Promise((r) => setTimeout(r, 15)); }
  await app.goto(cloudUrl('proyectos/plan.md')); await app.waitForSelector('.markdown-body h1'); await openSettings();
  over = await overflow();
  check('ninguna pestaña necesita scroll a 800 px de alto (plan pago)', over.length === 0, over);
  await tab('cloud');
  const paidCloud = await app.evaluate(() => [...document.querySelectorAll('[data-acct=cloud] .lmd-acct-row')].map((r) => r.children[0].textContent + '=' + r.children[1].textContent).join('|'));
  check('Nube con plan pago: el número de notas y "sin límite"', paidCloud === 'Cuenta=' + mail + '|Nombre visible=' + mail.split('@')[0] + '|Plan=Pago|Notas en la nube=4, sin límite', paidCloud);
  await tab('ai'); await app.waitForSelector('[data-acct=ai] [data-c=token]');
  const aiBefore = await app.evaluate(() => ({ url: document.querySelector('[data-acct=ai] .lmd-field input').value, fields: document.querySelectorAll('[data-acct=ai] .lmd-field').length, none: /Todavía no hay tokens/.test(document.querySelector('[data-acct=ai]').textContent) }));
  await app.click('[data-acct=ai] [data-c=token]'); await app.waitForSelector('.lmd-ai-new');
  const ai = await app.evaluate(() => ({ fields: [...document.querySelectorAll('[data-acct=ai] .lmd-field')].map((f) => [f.querySelector('span').textContent, f.querySelector('input, textarea').value]), list: [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent), body: (() => { const b = document.querySelector('.lmd-panel-body'); return b.scrollHeight - b.clientHeight; })() }));
  const token = ai.fields[1][1];
  const mcp = (t) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.status);
  check('IA: la dirección del MCP, y al crear un token, el token y el comando listo', aiBefore.url === base + '/mcp' && aiBefore.fields === 1 && aiBefore.none && ai.fields.map((f) => f[0]).join() === 'URL,Token,Claude Code' && token.startsWith('mdt_') && ai.fields[2][1] === 'claude mcp add --transport http sharpmd ' + base + '/mcp --header "Authorization: Bearer ' + token + '"' && ai.body <= 0, [aiBefore, ai]);
  check('el token creado sirve para entrar por MCP y figura en la lista', (await mcp(token)) === 200 && ai.list.length === 1 && /sin usar/.test(ai.list[0]), ai.list);
  await app.click('.lmd-tokens [data-rm]'); await app.waitForFunction(() => /Todavía no hay tokens/.test(document.querySelector('[data-acct=ai]').textContent));
  check('revocarlo lo saca de la lista y deja de entrar', (await mcp(token)) === 401 && (await app.locator('.lmd-tokens li').count()) === 0);
  await app.click('[data-act=close-panel]');

  console.log('Inicio con notas');
  for (let i = 0; i < 10; i++) await api('PUT', '/notes/' + encodeURIComponent('relleno/nota-' + i + '.md'), { text: 'x' }, session);
  await api('PUT', '/notes/' + encodeURIComponent('proyectos/nueva.md'), { text: '# La última que toqué\n' }, session);
  await app.goto(home); await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node-dir'); await app.waitForSelector('.lmd-home-acct-who small');
  const recent = await app.evaluate(() => ({ sub: document.querySelector('.lmd-home-acct-who small').textContent, plans: document.querySelector('[data-cloud=menu]').dataset.plans ? 1 : 0, old: document.querySelectorAll('.lmd-home-recent, .lmd-home-item').length,
    top: [...document.querySelectorAll('.lmd-xroot[data-root=cloud] > .lmd-tree > .lmd-node')].map((n) => n.textContent.trim() + (n.classList.contains('lmd-node-dir') ? '/' : '')) }));
  check('con plan pago el inicio dice cuántas notas y "sin límite"', recent.sub === 'Plan pago · 14 notas, sin límite' && recent.plans === 0, recent.sub);
  check('las notas de la nube están en el explorador, con sus carpetas primero', recent.top.slice(0, 3).join() === 'archivo/,proyectos/,relleno/' && recent.top.length > 3, recent.top);
  check('el centro ya no repite la lista de recientes', recent.old === 0, recent.old);
  await app.locator('.lmd-xroot[data-root=cloud] .lmd-node-dir', { hasText: 'relleno' }).click(); await app.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node-kids .lmd-node');
  check('una carpeta de la nube se despliega con todas sus notas', (await app.locator('.lmd-xroot[data-root=cloud] .lmd-node-kids a.lmd-node').count()) === 10);
  await app.click('[data-cloud=menu]'); const proMenu = await app.evaluate(() => [...document.querySelectorAll('.lmd-side-acct .lmd-menu [data-cloud]')].map((x) => x.dataset.cloud));
  check('con plan pago el menú de la cuenta es el mismo: Ajustes, Plan, IA y Salir', proMenu.join() === 'settings,plan,ai,logout', proMenu);
  await app.click('[data-cloud=settings]'); await app.waitForSelector('.lmd-panel-card [data-acct=cloud] [data-c=open]');
  await Promise.all([app.waitForNavigation(), app.click('.lmd-panel-card [data-acct=cloud] [data-c=open]')]); await app.waitForSelector('.markdown-body h1'); await app.waitForSelector('.lmd-pane-files .lmd-node.lmd-active');
  const footOpen = await app.evaluate(() => { const b = document.querySelector('.lmd-sidebar > .lmd-side-acct [data-cloud=menu]'); return !!b && b.offsetWidth > 0 && document.querySelector('.lmd-home').hidden; });
  check('con una nota abierta la cuenta sigue al pie de la barra lateral', footOpen);
  const tree = await app.evaluate(() => ({ url: location.search, active: document.querySelector('.lmd-node.lmd-active').textContent.trim(), files: document.querySelector('.lmd-pane-files').getBoundingClientRect().height > 60 }));
  check('"Abrir la nube" lleva a la nota más nueva con el árbol a la vista', /f=cloud%2Fproyectos%2Fnueva\.md/.test(tree.url) && tree.active === 'nueva.md' && tree.files, tree);
  const folders = await app.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=cloud] > .lmd-tree > .lmd-node-dir')].map((n) => n.textContent.trim()));
  check('desde ahí se ven todas las carpetas', folders.join() === 'archivo,proyectos,relleno', folders);
  // Con la raíz Nube plegada, "Abrir la carpeta Nube" la vuelve a desplegar.
  await app.click('.lmd-xroot[data-root=cloud] .lmd-root-tog'); await app.waitForSelector('.lmd-xroot[data-root=cloud].lmd-shut');
  await openSettings('cloud'); await app.waitForSelector('[data-acct=cloud] [data-c=open]'); await app.click('[data-acct=cloud] [data-c=open]'); await app.waitForFunction(() => document.querySelector('.lmd-panel').hidden);
  await app.waitForSelector('.lmd-xroot[data-root=cloud]:not(.lmd-shut) .lmd-node.lmd-active');
  check('en una nota de la nube, "Abrir la carpeta Nube" cierra Ajustes y deja el árbol', !((await stored('side')).shut || {}).cloud);
  await app.goto(home); await app.waitForSelector('[data-cloud=menu]'); await app.click('[data-cloud=menu]'); await app.click('[data-cloud=ai]'); await app.waitForSelector('.lmd-acct-card [data-c=token]');
  check('"Conectar una IA" del inicio abre el mismo panel', (await app.evaluate(() => document.querySelector('.lmd-acct-card').getAttribute('aria-label') + '|' + document.querySelector('.lmd-acct-card .lmd-field input').value)) === 'Conectar una IA|' + base + '/mcp');
  await app.click('[data-d=close]');
  await app.click('[data-home=feedback]'); await app.waitForSelector('.lmd-fb');
  check('con sesión, los comentarios no piden el correo', (await app.locator('.lmd-fb [data-fb=email]').count()) === 0 && (await app.locator('.lmd-fb textarea').count()) === 1);
  await app.click('[data-fb=close]');

  console.log('Servidor propio y nube apagada');
  // Apagar la nube con una nota de la nube abierta: la nota se cierra, en vez de quedar diciendo "guardado en la nube".
  await app.goto(cloudUrl('proyectos/plan.md')); await app.waitForSelector('.markdown-body h1');
  const setCloud = (v) => app.evaluate((u) => new Promise((r) => chrome.storage.local.get('settings', (x) => chrome.storage.local.set({ settings: Object.assign({}, x.settings, { cloudUrl: u }) }, r))), v);
  await setCloud('off'); await app.waitForFunction(() => document.title === 'SharpMD', null, { timeout: 5000 }).catch(() => {});
  check('apagar la nube con una nota de la nube abierta la cierra', (await app.title()) === 'SharpMD' && !/[?&]f=/.test(app.url()), [await app.title(), app.url()]);
  await setCloud(base); await app.waitForTimeout(600);
  await app.goto(cloudUrl('proyectos/plan.md')); await app.waitForSelector('.markdown-body h1'); await openSettings('cloud');
  await app.waitForSelector('[data-acct=cloud] [data-c=out]'); await app.click('[data-acct=cloud] [data-c=out]'); await app.waitForSelector('[data-acct=cloud] [data-c=login]');
  check('Nube: salir deja la invitación a entrar', /Crear cuenta o entrar/.test(await text('[data-acct=cloud]')) && !(await stored('cloud')).session);
  check('salir con la nota de la nube abierta la cierra: detrás queda el inicio', (await app.title()) === 'SharpMD' && !/[?&]f=/.test(app.url()) && !(await app.evaluate(() => document.querySelector('.lmd-home').hidden)), [await app.title(), app.url()]);
  const perksNube = await app.evaluate(() => [...document.querySelectorAll('[data-acct=cloud] .lmd-perks dt, [data-acct=cloud] .lmd-perks dd')].map((n) => n.textContent));
  check('Nube sin sesión: dos renglones dicen qué anda sin cuenta y qué suma tenerla', claro(perksNube) && (await app.locator('[data-acct=cloud] > p').count()) === 0, perksNube);
  await tab('plan');
  check('Plan sin sesión: las tarjetas, sin botones de pago', (await app.locator('[data-acct=plan] .lmd-plan').count()) === 2 && (await app.locator('[data-acct=plan] [data-pay]').count()) === 0 && /Entrá a tu cuenta/.test(await text('[data-acct=plan]')));
  // El botón de entrar no saca de la nota: lleva a Nube y pide ahí el correo y el código.
  const notaAbierta = app.url();
  await app.click('[data-acct=plan] [data-c=login]'); await app.waitForSelector('[data-acct=cloud] [data-field=email]');
  const pide = await app.evaluate(() => ({ tab: document.querySelector('[data-ptab].lmd-on').dataset.ptab, foco: document.activeElement.dataset.field, perks: document.querySelectorAll('[data-acct=cloud] .lmd-perks').length }));
  check('desde Plan, "Crear cuenta o entrar" lleva a Nube con el correo ya pedido, sin salir de la nota', pide.tab === 'cloud' && pide.foco === 'email' && pide.perks === 1 && app.url() === notaAbierta, pide);
  await app.fill('[data-acct=cloud] [data-field=email]', 'sin arroba'); await app.keyboard.press('Enter'); await app.waitForSelector('[data-acct=cloud] .lmd-home-cloud-err:not([hidden])');
  const malCorreo = await text('[data-acct=cloud] .lmd-home-cloud-err');
  await app.fill('[data-acct=cloud] [data-field=email]', 'nueva@ejemplo.test');
  const [pedido] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-acct=cloud] [data-cloud=start]')]);
  await app.waitForSelector('[data-acct=cloud] [data-field=code]'); await app.fill('[data-acct=cloud] [data-field=code]', (await pedido.json()).dev_code); await app.keyboard.press('Enter');
  await app.waitForSelector('[data-acct=cloud] [data-c=out]');
  const adentro = await text('[data-acct=cloud]');
  check('en Ajustes → Nube se entra ahí mismo, con el correo y el código', /no lleva espacios/.test(malCorreo || '') && /nueva@ejemplo\.test/.test(adentro) && (await stored('cloud')).session && app.url() === notaAbierta && !(await app.evaluate(() => document.querySelector('.lmd-panel').hidden)), [malCorreo, adentro]);
  await app.click('[data-acct=cloud] [data-c=out]'); await app.waitForSelector('[data-acct=cloud] [data-c=login]');
  await app.click('[data-acct=cloud] [data-c=login]'); await app.waitForSelector('[data-acct=cloud] [data-field=email]');
  check('el botón de Nube pide el correo en el lugar', (await app.evaluate(() => document.activeElement.dataset.field)) === 'email' && app.url() === notaAbierta);
  await tab('plan'); await tab('cloud'); await app.waitForSelector('[data-acct=cloud] [data-c=login]');
  console.log('Seguridad de la nube');
  // El bloque de Ajustes → Nube: qué se cifra, dónde y quién tiene la llave. Se ve igual sin sesión y con ella.
  const secOf = () => app.evaluate(() => {
    const s = document.querySelector('[data-acct=cloud] .lmd-sec'); if (!s) return null;
    const above = document.querySelector('[data-acct=cloud] .lmd-acct-actions, [data-acct=cloud] .lmd-signin');
    return { title: s.querySelector('h4').textContent, rows: [...s.querySelectorAll('[data-sec-row]')].map((li) => li.dataset.secRow + ':' + li.querySelector('b').textContent).join('|'), icons: s.querySelectorAll('.lmd-sec-ico svg').length,
      text: s.textContent, act: (s.querySelector('[data-c=protect]') || {}).textContent || '', href: s.querySelector('.lmd-sec-foot a').href, link: s.querySelector('.lmd-sec-foot a').textContent,
      below: !!above && s.getBoundingClientRect().top >= above.getBoundingClientRect().bottom, count: (s.querySelector('.lmd-sec-count') || {}).textContent || '',
      pick: [...s.querySelectorAll('[data-c=protect-at]')].map((b) => b.dataset.f), msg: (s.querySelector('p.lmd-sec-pick') || {}).textContent || '', wide: s.scrollWidth - s.clientWidth };
  });
  const limpio = (t) => !!t && !/[!¡—–]/.test(t) && !/end-to-end|extremo a extremo|militar|inviolable|100%/i.test(t);
  const ROWS = 'notes:Notas en la nube|vaults:Carpetas protegidas|signin:Entrar sin contraseña|open:Sin analítica y con código abierto';
  const fuera = await secOf();
  check('sin sesión, Nube muestra el bloque de seguridad debajo del botón de entrar: cuatro renglones con ícono', !!fuera && fuera.title === 'Seguridad' && fuera.rows === ROWS && fuera.icons === 4 && fuera.below && fuera.wide <= 0, fuera);
  check('dice qué lee el servidor y qué no, cada cosa en su renglón, sin signos de admiración ni rayas', limpio(fuera.text) && /Ni el servidor puede leerlas\./.test(fuera.text) && /para compartirlas y atender a tu IA\./.test(fuera.text) && /En el plan gratis y en el pago/.test(fuera.text) && /AES-256-GCM · PBKDF2/.test(fuera.text) && /no se pueden recuperar\./.test(fuera.text), fuera.text);
  check('con un servidor propio no promete un cifrado que depende de quien lo instaló', /En un servidor propio/.test(fuera.text) && !/Viajan cifradas/.test(fuera.text), fuera.text);
  check('"Cómo funciona" lleva a las notas en la nube de la página de privacidad', fuera.link === 'Cómo funciona' && fuera.href === SITE + '/privacy.html#cloud-notes' && /<h2 id="cloud-notes">/.test(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8')), [fuera.link, fuera.href]);
  // Con el servidor de SharpMD, y en los dos idiomas.
  const lit = await app.evaluate(() => {
    const plain = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
    const es = plain(LMD.sync.security({ can: true, count: 2 })); LMD.setLang('en');
    const en = plain(LMD.sync.security({ can: true, count: 2 })); const en1 = plain(LMD.sync.security({ count: 1 })); const enOwn = plain(LMD.sync.security({ own: true })); LMD.setLang('es');
    return { es, en, en1, enOwn };
  });
  check('en español: las notas comunes viajan y se guardan cifradas, y el servidor tiene la llave', limpio(lit.es) && /Viajan cifradas y se guardan cifradas en el servidor\. El servidor tiene la llave, para poder compartirlas y atender a tu IA\./.test(lit.es) && /HTTPS · AES-256-GCM/.test(lit.es) && /Tenés 2 carpetas protegidas\./.test(lit.es) && /Proteger una carpeta/.test(lit.es), lit.es);
  check('en inglés dice lo mismo, sin español suelto', limpio(lit.en) && !/[áéíóúñ]/i.test(lit.en + lit.en1 + lit.enOwn) && /^Security/.test(lit.en) && /Cloud notes|Notes in the cloud/.test(lit.en) && /Encrypted in transit and on the server\. The server holds the key, so it can share them and serve your AI\./.test(lit.en) &&
    /Protected folders/.test(lit.en) && /Encrypted on your device with your password\. Not even the server can read them\./.test(lit.en) && /On the free and paid plans/.test(lit.en) && /You have 2 protected folders\./.test(lit.en) && /Protect a folder/.test(lit.en) && /How it works/.test(lit.en) && /one-time code/.test(lit.en) && /App MIT · Server AGPL/.test(lit.en), lit.en);
  check('una sola carpeta va en singular, y sin poder proteger no se ofrece la acción', /You have 1 protected folder\./.test(lit.en1) && !/Protect a folder/.test(lit.en1) && /On your own server/.test(lit.enOwn) && limpio(lit.enOwn), [lit.en1, lit.enOwn]);
  check('sin sesión no hay cantidad de carpetas, y la acción está', fuera.count === '' && fuera.act === 'Proteger una carpeta', fuera);
  await app.click('[data-acct=cloud] [data-c=protect]'); await app.waitForSelector('[data-acct=cloud] [data-field=email]');
  const pideEntrar = await secOf();
  check('sin sesión, "Proteger una carpeta" pide entrar ahí mismo, con el bloque a la vista debajo del formulario', !!pideEntrar && pideEntrar.rows === ROWS && pideEntrar.below, pideEntrar);
  await app.fill('[data-acct=cloud] [data-field=email]', 'segura@ejemplo.test');
  const [pedidoSeg] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-acct=cloud] [data-cloud=start]')]);
  await app.waitForSelector('[data-acct=cloud] [data-field=code]'); await app.fill('[data-acct=cloud] [data-field=code]', (await pedidoSeg.json()).dev_code); await app.keyboard.press('Enter');
  await app.waitForSelector('[data-acct=cloud] [data-c=out]'); await app.waitForSelector('[data-acct=cloud] .lmd-sec [data-c=protect]');
  const dentro = await secOf();
  const orden = await app.evaluate(() => { const q = (s) => document.querySelector('[data-acct=cloud] ' + s).getBoundingClientRect(); return q('.lmd-sec').top >= q('.lmd-acct-actions').bottom && q('.lmd-acct-del').top >= q('.lmd-sec').bottom; });
  check('con sesión, el mismo bloque va debajo de los datos de la cuenta y antes de eliminarla', !!dentro && dentro.rows === ROWS && dentro.count === '' && orden && limpio(dentro.text), dentro);
  const segSession = (await stored('cloud')).session;

  // La primera nota que va a la nube: la pregunta suma una línea que lleva a este bloque.
  await app.evaluate(() => LMD.store.notePut('primera.md', '# Primera\n\nNota del navegador.'));
  await app.goto(home + '?f=' + encodeURIComponent('local/primera.md')); await app.waitForSelector('.lmd-sync:not([hidden])');
  await app.evaluate(() => { window.__manual = true; });
  const antes = sent.length;
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-dlg .lmd-dlg-more');
  const aviso = await app.evaluate(() => ({ link: document.querySelector('.lmd-dlg-more button').textContent, text: document.querySelector('.lmd-dlg').textContent }));
  await app.click('.lmd-dlg-more [data-dlg-more]'); await app.waitForSelector('.lmd-panel-card [data-acct=cloud] .lmd-sec');
  check('al mandar la primera nota a la nube, la pregunta enlaza a la seguridad de la nube y no sube nada por ir a mirarla', aviso.link === 'Seguridad de la nube' && limpio(aviso.text) && (await app.locator('.lmd-dlg').count()) === 0 && (await app.evaluate(() => document.querySelector('[data-ptab].lmd-on').dataset.ptab)) === 'cloud' && !sent.slice(antes).some((x) => /^PUT \/notes/.test(x)), [aviso, sent.slice(antes)]);
  check('con el servidor de SharpMD esa línea dice cómo queda guardada', (await app.evaluate(() => LMD.t('Viaja cifrada y se guarda cifrada en el servidor.'))) === 'Viaja cifrada y se guarda cifrada en el servidor.' && (await app.evaluate(() => { LMD.setLang('en'); const t = LMD.t('Viaja cifrada y se guarda cifrada en el servidor.') + '|' + LMD.t('Seguridad de la nube'); LMD.setLang('es'); return t; })) === 'It is encrypted in transit and on the server.|Cloud security');

  // Proteger una carpeta desde el bloque: sin carpetas lo explica, con varias se elige, con una sola va directo.
  await app.waitForSelector('[data-acct=cloud] .lmd-sec [data-c=protect]'); await app.click('[data-acct=cloud] [data-c=protect]'); await app.waitForSelector('[data-acct=cloud] p.lmd-sec-pick');
  const sinCarpetas = await secOf();
  check('sin carpetas en la nube, "Proteger una carpeta" dice en una línea cómo se hace', /Primero creá una carpeta en la Nube\./.test(sinCarpetas.msg) && limpio(sinCarpetas.msg) && (await app.locator('.lmd-vault-card').count()) === 0, sinCarpetas.msg);
  await api('PUT', '/notes/' + encodeURIComponent('alfa/uno.md'), { text: '# Uno' }, segSession); await api('PUT', '/notes/' + encodeURIComponent('beta/dos.md'), { text: '# Dos' }, segSession);
  await tab('plan'); await tab('cloud'); await app.waitForSelector('[data-acct=cloud] .lmd-sec [data-c=protect]'); await app.waitForTimeout(500);
  await app.click('[data-acct=cloud] [data-c=protect]'); await app.waitForSelector('[data-acct=cloud] [data-c=protect-at]');
  const elige = await secOf();
  check('con varias carpetas se elige cuál', elige.pick.join() === 'alfa,beta' && /Elegí la carpeta/.test(elige.text), elige.pick);
  await app.click('[data-acct=cloud] [data-c=protect-at][data-f=alfa]'); await app.waitForSelector('.lmd-vault-card [data-v=p1]');
  const hoja = await app.textContent('.lmd-vault-card h3');
  await app.fill('[data-v=p1]', 'caballo correcto batería grapa'); await app.fill('[data-v=p2]', 'caballo correcto batería grapa'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-vault-key');
  await Promise.all([app.waitForEvent('download'), app.click('[data-v=down]')]);
  await app.click('[data-v=ok]'); await app.waitForSelector('.lmd-vault-card', { state: 'detached', timeout: 30000 });
  await app.waitForSelector('[data-acct=cloud] .lmd-sec-count');
  const conUna = await secOf();
  const guardado = await api('GET', '/notes/' + encodeURIComponent('alfa/uno.md'), undefined, segSession);
  check('la acción abre el mismo flujo que el menú de la carpeta y la deja protegida', /Proteger "alfa" con contraseña/.test(hoja) && /^vault1:/.test((guardado.json || {}).text || ''), [hoja, guardado.status]);
  check('con carpetas protegidas, el bloque dice cuántas', conUna.count === 'Tenés 1 carpeta protegida.' && conUna.pick.length === 0, conUna.count);
  await app.click('[data-acct=cloud] [data-c=protect]'); await app.waitForSelector('.lmd-vault-card [data-v=p1]');
  const directo = await app.textContent('.lmd-vault-card h3');
  await app.click('.lmd-vault-card [data-v=no]'); await app.waitForSelector('.lmd-vault-card', { state: 'detached' });
  check('con una sola carpeta sin proteger va directo a ella', /Proteger "beta" con contraseña/.test(directo), directo);
  await tab('plan'); await app.waitForSelector('[data-acct=plan] .lmd-plan');
  const planes = await app.evaluate(() => [...document.querySelectorAll('[data-acct=plan] .lmd-plans > .lmd-plan')].slice(0, 2).map((p) => [...p.querySelectorAll('li')].filter((li) => li.textContent === 'Carpetas protegidas').length));
  check('Plan: las carpetas protegidas figuran en el gratis y en el pago, con el nombre del resto de la app', planes.join() === '1,1', planes);
  // Ya con notas en la nube, la pregunta de subir no repite la línea.
  await app.click('[data-act=close-panel]'); await app.waitForFunction(() => document.querySelector('.lmd-panel').hidden);
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-dlg');
  const segunda = await app.locator('.lmd-dlg .lmd-dlg-more').count();
  await app.click('.lmd-dlg [data-dlg=no]'); await app.waitForSelector('.lmd-dlg', { state: 'detached' });
  check('con notas ya en la nube, la pregunta no repite la línea', segunda === 0, segunda);
  await app.evaluate(() => { window.__manual = false; });
  await openSettings('cloud'); await app.waitForSelector('[data-acct=cloud] [data-c=out]'); await app.click('[data-acct=cloud] [data-c=out]'); await app.waitForSelector('[data-acct=cloud] [data-c=login]');
  // Desde la portada, el botón del plan pago abre la app con Ajustes en Plan.
  const dePortada = await ctx.newPage(); await dePortada.goto(home + '#lmd-plans'); await dePortada.waitForSelector('.lmd-panel .lmd-plans');
  check('app.html#lmd-plans abre Ajustes en Plan y limpia la dirección', (await dePortada.evaluate(() => document.querySelector('[data-ptab].lmd-on').dataset.ptab)) === 'plan' && !/#/.test(dePortada.url()) && !(await dePortada.evaluate(() => document.querySelector('.lmd-home').hidden)), dePortada.url());
  await dePortada.close();
  const conLogin = await ctx.newPage(); await conLogin.goto(home + '?login=1'); await conLogin.waitForSelector('.lmd-home-card .lmd-login [data-field=email]');
  check('el inicio abierto con ?login=1 ya pide el correo, en la tarjeta del inicio', (await conLogin.evaluate(() => document.activeElement.dataset.field)) === 'email' && (await conLogin.locator('.lmd-sidebar [data-field]').count()) === 0);
  await conLogin.close();
  await tab('adv');
  const sw1 = () => app.evaluate(() => ({ own: document.querySelector('[data-server=own]').checked, off: document.querySelector('[data-server=off]').checked, shown: !document.querySelector('.lmd-server-url').hidden && document.querySelector('.lmd-server-url').getBoundingClientRect().height > 0, url: document.querySelector('[data-server=url]').value }));
  const toggle = async (name) => { await app.locator('label.lmd-check', { has: app.locator('[data-server=' + name + ']') }).click(); await app.waitForTimeout(500); };
  const s0 = await sw1();
  await toggle('own'); const s1 = await sw1(); const u1 = (await stored('settings')).cloudUrl;
  check('apagar "Uso mi propio servidor" esconde la dirección y vuelve al servidor de SharpMD', s0.own && s0.shown && s0.url === base && !s1.own && !s1.shown && u1 === '', [s0, s1, u1]);
  await toggle('own'); const s2 = await sw1();
  await app.fill('[data-server=url]', '  ' + base + ' '); await app.keyboard.press('Tab'); await app.waitForTimeout(500);
  const u2 = (await stored('settings')).cloudUrl; const s2b = await sw1();
  check('prenderlo muestra el campo, y la dirección escrita queda guardada', s2.own && s2.shown && s2.url === '' && u2 === base && s2b.own && s2b.shown && s2b.url === base, [s2, u2, s2b]);
  await toggle('off'); const s3 = await sw1(); const u3 = (await stored('settings')).cloudUrl;
  check('"Usar SharpMD sin nube" conserva el valor off y apaga el otro interruptor', u3 === 'off' && s3.off && !s3.own && !s3.shown, [s3, u3]);
  await toggle('own'); const s4 = await sw1(); const u4 = (await stored('settings')).cloudUrl;
  check('de sin nube a servidor propio: el campo aparece aunque todavía no haya dirección', s4.own && !s4.off && s4.shown && u4 === '', [s4, u4]);
  await toggle('off');
  over = await overflow();
  check('ninguna pestaña necesita scroll con la nube apagada', over.length === 0, over);
  await tab('cloud');
  const offCloud = await text('[data-acct=cloud]');
  check('Nube apagada: lo dice y ofrece prenderla', /La nube está apagada/.test(offCloud) && /Prender la nube/.test(offCloud) && await app.evaluate(() => document.querySelector('.lmd-sync').hidden), offCloud);
  await tab('ai'); const offAi = await text('[data-acct=ai]');
  await app.click('[data-act=feedback]'); await app.waitForSelector('.lmd-fb a');
  check('apagada, ni IA ni comentarios hablan con un servidor', /La nube está apagada/.test(offAi) && (await app.locator('.lmd-fb textarea').count()) === 0 && /^mailto:hello@sharpmd\.app/.test(await app.evaluate(() => document.querySelector('.lmd-fb a').href)), offAi);
  await app.click('[data-fb=close]');
  await tab('cloud'); await app.click('[data-acct=cloud] [data-c=on]'); await app.waitForSelector('[data-acct=cloud] [data-c=login]');
  check('"Prender la nube" la deja andando con el servidor de SharpMD', (await stored('settings')).cloudUrl === '' && !(await app.evaluate(() => document.querySelector('.lmd-sync').hidden)));
  check('ninguna prueba tocó el servidor de producción ni otro sitio', outside.length === 0, outside);
  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e).slice(0, 900)); }

const failed = results.filter((r) => !r).length;
console.log('\n' + (results.length - failed) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
