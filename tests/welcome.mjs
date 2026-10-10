// La bienvenida de la extensión y el permiso para archivos del disco ("Permitir acceso a URL de archivo").
//
// Una extensión cargada con --load-extension nace con ese permiso prendido (el caso de una reinstalación). Lo que ve
// quien la instala desde la tienda, sin el permiso, se recorre con el API simulado: la extensión y sus páginas
// reciben "no" de isAllowedFileSchemeAccess. Así no depende de nada del navegador de pruebas.
// Al final, y solo si este navegador lo deja, se apaga y se prende el permiso de verdad desde chrome://extensions,
// como lo haría una persona: el navegador recarga la extensión y la bienvenida vuelve en "Listo". Esa página interna
// cambia entre versiones de Chromium: si no se puede, el tramo se anota como omitido y no cuenta como falla.
//
// Esta suite no se cuelga: cada paso tiene un tope de tiempo y hay uno global. Al vencer, el paso queda en FALLA con
// el motivo, se cierra el navegador y el proceso termina con su línea final de siempre.
// Uso: node welcome.mjs   (SHOTS=carpeta guarda capturas en claro y en oscuro)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { tally, sleep, root } from './rig.mjs';

const { check, done } = tally();
const J = JSON.stringify;
const SHOTS = process.env.SHOTS || '';
const STEP = 60000; const GLOBAL = 300000; const CALL = 10000;
// Una promesa con tope: playwright no le pone tiempo a evaluate ni a close, y un service worker que se está
// recargando puede no contestar nunca.
const cap = (p, ms, what) => { let timer = 0; return Promise.race([Promise.resolve(p), new Promise((_, no) => { timer = setTimeout(() => no(new Error('tope de ' + Math.round(ms / 1000) + ' s: ' + what)), ms); })]).finally(() => clearTimeout(timer)); };
const until = async (fn, ms) => { const t = Date.now(); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v || Date.now() - t > (ms || 10000)) return v; await sleep(150); } };

let ctx = null; let profile = ''; let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  if (ctx) await cap(ctx.close(), 15000, 'cerrar el navegador').catch(() => {});
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ }
  process.exit(done() ? 1 : 0); // la salida mata al navegador si no llegó a cerrarse
}
setTimeout(() => { check('la suite termina dentro del tope global', false, 'pasaron ' + GLOBAL / 1000 + ' s'); finish(); setTimeout(() => process.exit(1), 20000); }, GLOBAL);
// Un paso: si se rompe o vence su tope queda en FALLA con el motivo, y los que siguen no corren (ya no se sabe en qué quedó el navegador).
let broken = false;
async function step(title, fn, ms) {
  if (broken) return;
  console.log(title);
  try { await cap(fn(), ms || STEP, 'el paso "' + title + '"'); }
  catch (e) { broken = true; check(title + ': el paso termina, sin colgarse ni romperse', false, String((e && e.message) || e).split('\n')[0].slice(0, 300)); }
}
const skipped = (what) => console.log('  omitida ' + what);

// ---------- Lo que se ve sin abrir un navegador ----------
console.log('Paquete');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'src', 'welcome.html'), 'utf8');
check('sin permisos nuevos: los de la última versión aprobada', J(manifest.permissions) === J(['storage', 'scripting']) && J(manifest.host_permissions) === J(['file:///*', '*://*/*']) && !manifest.optional_permissions, [manifest.permissions, manifest.host_permissions]);
check('la bienvenida no se expone a ningún sitio', !J(manifest.web_accessible_resources).includes('welcome'));
const ignored = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
check('la página y lo que carga van en el paquete de la extensión', ['welcome.html', 'welcome.js', 'welcome.css', 'boot.js', 'defaults.js', 'theme.js', 'content.css'].every((f) => fs.existsSync(path.join(root, 'src', f))) && !/^\/src\/|^\/icons\//m.test(ignored));
check('sin scripts ni estilos en línea, y con su política de contenido', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/<style|\sstyle=|\son[a-z]+=/.test(html) && /script-src 'self';/.test(html) && /style-src 'self';/.test(html) && /default-src 'none'/.test(html));
const texts = [...html.matchAll(/data-t>([^<]+)</g)].map((m) => m[1].trim());
const defaults = fs.readFileSync(path.join(root, 'src', 'defaults.js'), 'utf8');
check('cada texto de la página tiene su traducción al inglés', texts.length >= 12 && texts.every((t) => defaults.includes(J(t) + ': "')), texts.filter((t) => !defaults.includes(J(t) + ': "')));
check('textos cortos, sin signos de admiración ni rayas', texts.every((t) => !/[!¡—–]/.test(t) && t.length <= 70), texts.filter((t) => /[!¡—–]/.test(t) || t.length > 70));

const errors = [];
let id = ''; let WELCOME = ''; let OWN = ''; let wel = null; let app1 = null;
// El permiso simulado: null es el de verdad; false y true, lo que contestan la extensión y sus páginas.
let sim = null;
// El service worker se duerme, y al cambiar el permiso se recarga: siempre se toma el que esté vivo. Cada pedido
// lleva su tope, y antes deja puesto el permiso simulado (un service worker recién despertado no lo recuerda).
const SW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://' + id)) || ctx.waitForEvent('serviceworker', { timeout: CALL });
const bg = async (fn, arg) => {
  const sw = await cap(SW(), CALL + 2000, 'encontrar el service worker');
  await cap(sw.evaluate((v) => {
    if (!self.__faReal) { self.__faReal = chrome.extension.isAllowedFileSchemeAccess.bind(chrome.extension); chrome.extension.isAllowedFileSchemeAccess = async () => (typeof self.__fa === 'boolean' ? self.__fa : self.__faReal()); }
    self.__fa = v;
  }, sim), CALL, 'el service worker no contesta');
  return cap(sw.evaluate(fn, arg), CALL, 'el service worker no contesta');
};
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text()); }); return p; };
const urls = () => ctx.pages().map((p) => p.url());
const welcomes = () => ctx.pages().filter((p) => p.url().startsWith(WELCOME));
const button = () => bg(async () => ({ badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
const press = () => bg(() => LMD.bridgeHost.onAction().then(() => true));
const setup = () => bg(async () => (await chrome.storage.local.get('fileSetup')).fileSetup || {});
const shown = (p, which) => p.waitForSelector('[data-wel' + (which ? '=' + which : '') + ']:not([hidden])', { timeout: 15000 });
const seen = (p) => cap(p.evaluate(() => {
  const vis = (n) => !!n && !n.hidden && !n.closest('[hidden]');
  const part = document.querySelector('[data-wel]:not([hidden])');
  return { state: document.documentElement.dataset.welState || '', lang: document.documentElement.lang, h1: part ? part.querySelector('h1').textContent : '', text: part ? part.innerText : '',
    buttons: part ? [...part.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim()) : [], label: document.querySelector('[data-wel-label]').textContent, other: document.querySelector('[data-wel-other]').textContent,
    how: vis(document.querySelector('[data-wel-how]')), logo: [...document.querySelectorAll('.lmd-wel-brand img')].every((i) => i.naturalWidth > 0), wide: document.documentElement.scrollWidth - innerWidth,
    bg: getComputedStyle(document.body).backgroundColor, dark: document.documentElement.classList.contains('lmd-dark') };
}), CALL, 'la bienvenida no contesta');
const shots = async (p, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: scheme }); await p.reload(); await shown(p); await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(SHOTS, name + '-' + (scheme === 'light' ? 'claro' : 'oscuro') + '.png') });
  }
  await p.emulateMedia({ colorScheme: 'light' }); await p.reload(); await shown(p);
};
// Ajustes > Instalar, en la página de la extensión.
const instPane = async (p) => {
  await p.bringToFront(); await p.waitForSelector('.lmd-home');
  await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=inst]'); await p.waitForSelector('[data-inst-pane] h4'); await p.waitForTimeout(200);
  const pane = await p.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); return { text: box.innerText, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
  await p.click('[data-act=close-panel]');
  return pane;
};
// Las páginas de la extensión toman el permiso simulado de su almacenamiento, así lo ven también al recargarse.
const simulate = async (v) => {
  sim = v;
  const p = ctx.pages().find((x) => x.url().startsWith('chrome-extension://' + id + '/')) || await (async () => { const n = await ctx.newPage(); await n.goto(WELCOME); return n; })();
  await cap(p.evaluate((x) => { if (x === null) localStorage.removeItem('lmd-test-fa'); else localStorage.setItem('lmd-test-fa', x ? '1' : '0'); }, v), CALL, 'guardar el permiso simulado');
  await bg(() => LMD.bridgeHost.mark());
};

await step('Navegador', async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-welcome-'));
  ctx = await chromium.launchPersistentContext(profile, { headless: false, timeout: 45000, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1100, height: 820 }, locale: 'es-AR', colorScheme: 'light', ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
  const first = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  id = new URL(first.url()).host; WELCOME = 'chrome-extension://' + id + '/src/welcome.html'; OWN = 'chrome-extension://' + id + '/src/app.html';
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  await ctx.addInitScript(() => {
    try {
      if (location.protocol !== 'chrome-extension:' || !window.chrome || !chrome.extension || !chrome.extension.isAllowedFileSchemeAccess) return;
      const real = chrome.extension.isAllowedFileSchemeAccess.bind(chrome.extension);
      chrome.extension.isAllowedFileSchemeAccess = async () => { const v = localStorage.getItem('lmd-test-fa'); return v === '0' ? false : v === '1' ? true : real(); };
    } catch (e) { /* otra página */ }
  });
});

// ---------- Al instalar, con el permiso ya prendido ----------
// La instalación es de verdad: el navegador avisa onInstalled con "install".
await step('Al instalar, con el permiso ya prendido', async () => {
  const access0 = await bg(() => chrome.extension.isAllowedFileSchemeAccess());
  wel = await until(() => welcomes()[0], 10000);
  check('la bienvenida se abre sola al instalar, una sola vez', !!wel && welcomes().length === 1, urls());
  if (!wel) { wel = await ctx.newPage(); await wel.goto(WELCOME); }
  watch(wel); await wel.reload(); await shown(wel);
  const born = await seen(wel); const bornBtn = await button();
  check('con el permiso ya prendido arranca en "Listo", sin marca en el botón', access0 === true && born.state === 'done' && born.h1 === 'Listo' && J(born.buttons) === J(['Abrir SharpMD']) && bornBtn.badge === '' && bornBtn.title === 'SharpMD', [access0, born, bornBtn]);
});

// ---------- Sin el permiso, como llega la de la tienda (API simulado) ----------
await step('Al instalar, sin el permiso', async () => {
  await simulate(false);
  for (const p of welcomes()) await p.close();
  await bg(() => chrome.runtime.onInstalled.dispatch({ reason: 'update', previousVersion: '2.0.0' })); await sleep(500);
  check('una actualización no abre la bienvenida', !welcomes().length, urls());
  // El aviso de instalación no se repite en el mismo perfil: se le entrega a la extensión el mismo aviso que manda el navegador.
  await bg(() => chrome.runtime.onInstalled.dispatch({ reason: 'install' }));
  wel = await until(() => welcomes()[0], 10000);
  check('al instalar sin el permiso, la bienvenida se abre', !!wel && welcomes().length === 1, urls());
  if (!wel) { wel = await ctx.newPage(); await wel.goto(WELCOME); }
  watch(wel); await shown(wel);
  const need = await seen(wel);
  check('muestra el paso, en el idioma del navegador', need.state === 'need' && need.lang === 'es' && need.h1 === 'Para abrir archivos de tu disco falta un permiso' && J(need.buttons) === J(['Abrir los ajustes de la extensión', 'Ahora no', 'No uso archivos del disco']), need);
  check('el interruptor lleva el rótulo del navegador y dice cómo se llama en el otro idioma', need.label === 'Permitir acceso a URL de archivo' && need.other === 'En un navegador en inglés dice "Allow access to file URLs".', [need.label, need.other]);
  check('con el logo, el tema claro del dispositivo, sin desbordar ni signos de admiración', need.logo && !need.dark && need.bg === 'rgb(251, 250, 247)' && need.wide <= 0 && !/[!¡—–]/.test(need.text), need);
  check('en un navegador que no se reconoce queda además el camino en texto', need.how && /buscá SharpMD, Detalles\./.test(need.text), need.text);
  const b0 = await button();
  check('el botón de la barra lleva una marca y dice qué falta', b0.badge === '1' && b0.title === 'SharpMD: falta un permiso para abrir archivos del disco', b0);
});

await step('La bienvenida: temas e idiomas', async () => {
  await shots(wel, 'bienvenida-sin-permiso');
  await wel.emulateMedia({ colorScheme: 'dark' }); await wel.reload(); await shown(wel);
  const dark = await seen(wel);
  check('con el dispositivo en oscuro, el tema oscuro de la app', dark.dark && dark.bg === 'rgb(18, 20, 24)', dark.bg);
  await wel.emulateMedia({ colorScheme: 'light' });
  // Uno de los doce temas, y la app en inglés con el navegador en español.
  await bg(() => LMD.patch({ preset: 'arena', language: 'en' }));
  await wel.reload(); await shown(wel);
  const en = await seen(wel);
  check('con la app en inglés, los textos en inglés y el rótulo como lo muestra el navegador', en.lang === 'en' && en.h1 === 'One permission is missing to open files from your disk' && J(en.buttons) === J(['Open the extension settings', 'Not now', 'I do not use files from my disk']) && en.label === 'Permitir acceso a URL de archivo' && en.other === 'In a browser in English it reads "Allow access to file URLs".' && !/[!¡—–]/.test(en.text), en);
  check('y toma el tema elegido en la app (Arena)', en.bg === 'rgb(246, 239, 224)', en.bg);
  await bg(() => chrome.storage.local.remove('settings'));
  await wel.reload(); await shown(wel);
}, SHOTS ? 120000 : STEP);

await step('El botón de la barra y los dos descartes', async () => {
  let tabs = ctx.pages().length;
  await wel.click('[data-wel-act=open]');
  const details = await until(() => ctx.pages().find((p) => p.url().startsWith('chrome://extensions')), 6000);
  check('el botón abre los ajustes de esta extensión en una pestaña', !!details && details.url() === 'chrome://extensions/?id=' + id && ctx.pages().length === tabs + 1 && (await setup()).asked > 0, urls());
  if (details) await details.close();

  await wel.bringToFront(); tabs = ctx.pages().length;
  await press(); await sleep(400);
  check('el botón de la barra trae la bienvenida al frente en vez de abrir la app', welcomes().length === 1 && ctx.pages().length === tabs && !ctx.pages().some((p) => p.url().startsWith(OWN)), urls());
  await wel.close(); await press();
  wel = await until(() => welcomes()[0], 6000);
  check('y si estaba cerrada, la abre', !!wel && !ctx.pages().some((p) => p.url().startsWith(OWN)), urls());
  watch(wel); await shown(wel, 'need');

  // "Ahora no": la extensión sigue sirviendo, y el botón vuelve a abrir la app.
  await bg(() => LMD.patch({ openIn: 'ext' }));
  await wel.click('[data-wel-act=later]');
  app1 = await until(() => ctx.pages().find((p) => p.url().startsWith(OWN)), 8000);
  check('"Ahora no" cierra la bienvenida y abre SharpMD', !!app1 && !!(await until(() => !welcomes().length, 4000)), urls());
  await press(); await sleep(400);
  const b1 = await button();
  check('desde ahí el botón abre la app como siempre, y la marca sigue', !welcomes().length && b1.badge === '1' && (await setup()).later > 0, [b1, urls()]);
  await bg(async () => { const s = (await chrome.storage.local.get('fileSetup')).fileSetup; await chrome.storage.local.set({ fileSetup: Object.assign({}, s, { later: Date.now() - 8 * 864e5 }) }); });
  await press();
  wel = await until(() => welcomes()[0], 6000);
  check('pasados unos días, el botón lo vuelve a recordar', !!wel);
  watch(wel); await shown(wel, 'need');

  if (app1) {
    watch(app1);
    const pane = await instPane(app1);
    check('Ajustes > Instalar dice que falta el acceso, con el botón y el camino en texto', pane.text.includes('Instalada, versión ' + manifest.version + ' · Acceso a archivos: no') && J(pane.buttons) === J(['Abrir los ajustes de la extensión', 'No uso archivos del disco']) && /buscá SharpMD, Detalles\./.test(pane.text) && !/[!¡—–]/.test(pane.text), pane);
  }

  // "No uso archivos del disco": no se recuerda más.
  await wel.bringToFront(); await wel.click('[data-wel-act=never]');
  await until(() => !welcomes().length, 4000);
  const b2 = await until(async () => { const b = await button(); return b.badge === '' ? b : null; }, 4000);
  check('"No uso archivos del disco" saca la marca y cierra la bienvenida', !!b2 && b2.title === 'SharpMD' && !welcomes().length && (await setup()).never === true, [b2, await setup()]);
  await press(); await sleep(400);
  check('y el botón abre la app, sin volver a la bienvenida', !welcomes().length, urls());
  // Abierta a mano sigue mostrando el paso: descartar el recordatorio no esconde cómo se hace.
  wel = watch(await ctx.newPage()); await wel.goto(WELCOME); await shown(wel);
  check('abierta a mano, la página sigue mostrando el paso', (await seen(wel)).state === 'need');
});

// ---------- Se prende el permiso (API simulado): la página lo ve sola ----------
await step('Con el permiso', async () => {
  await bg(() => chrome.storage.local.set({ fileSetup: { asked: Date.now() } }));
  await simulate(false); // sin "never": la marca vuelve
  check('con el recordatorio de nuevo en pie, la marca está', (await button()).badge === '1');
  await wel.bringToFront();
  await simulate(true);
  const turned = await until(async () => (await seen(wel)).state === 'done', 6000);
  check('la página detecta sola que el permiso quedó prendido y pasa a "Listo"', !!turned && await wel.evaluate(() => document.activeElement && document.activeElement.dataset.welAct === 'app'));
  const ok = await seen(wel);
  check('"Listo": qué hacer ahora y el botón que abre SharpMD', ok.state === 'done' && ok.h1 === 'Listo' && /Arrastrá un \.md a una pestaña del navegador\./.test(ok.text) && /doble clic\./.test(ok.text) && J(ok.buttons) === J(['Abrir SharpMD']) && !/[!¡—–]/.test(ok.text) && ok.wide <= 0, ok);
  const b3 = await until(async () => { const b = await button(); return b.badge === '' ? b : null; }, 6000);
  check('sin marca en el botón', !!b3 && b3.title === 'SharpMD', b3);
  check('lo anotado para la vuelta se limpia: no se abre de nuevo en cada arranque', !((await setup()).asked > 0), await setup());
  await shots(wel, 'bienvenida-con-permiso');
  await press(); await sleep(600);
  check('el botón de la barra abre la app', welcomes().length === 1 && ctx.pages().some((p) => p.url().startsWith(OWN) || /sharpmd\.app/.test(p.url())), urls());
  await bg(() => LMD.patch({ openIn: 'ext' }));
  await wel.bringToFront(); await wel.click('[data-wel-act=app]');
  const app2 = await until(() => (welcomes().length ? null : ctx.pages().find((p) => p.url().startsWith(OWN))), 8000);
  check('"Abrir SharpMD" abre la app y cierra la bienvenida', !!app2, urls());
  if (app2) {
    watch(app2);
    const pane = await instPane(app2);
    check('Ajustes > Instalar dice que el acceso está, sin botón', pane.text.includes('Instalada, versión ' + manifest.version + ' · Acceso a archivos: sí') && !pane.buttons.includes('Abrir los ajustes de la extensión') && !pane.buttons.includes('No uso archivos del disco'), pane);
  }
  await simulate(null);
}, SHOTS ? 120000 : STEP);

// ---------- De verdad, desde la página de extensiones (si este navegador lo deja) ----------
// El modo de desarrollador va prendido para que la recarga no deje apagada la extensión sin empaquetar.
await step('El permiso de verdad, desde chrome://extensions', async () => {
  const toggle = async (admin, on) => {
    try {
      await cap(admin.evaluate(async ([ext, v]) => { await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }); await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ext, fileAccess: v }); }, [id, on]), CALL, 'chrome://extensions no contesta');
    } catch (e) { return false; }
    return !!(await until(async () => (await bg(() => chrome.extension.isAllowedFileSchemeAccess())) === on, 12000));
  };
  let admin = null;
  try { admin = await ctx.newPage(); await admin.goto('chrome://extensions', { timeout: 10000 }); await admin.waitForTimeout(800); } catch (e) { admin = null; }
  const off = !!admin && await toggle(admin, false);
  if (!off) {
    skipped('no se pudo apagar el permiso en este navegador (el caso sin permiso ya quedó cubierto con el API simulado)');
    // Por si quedó a medias: se intenta dejarlo prendido, y la extensión tiene que seguir viva.
    if (admin) await toggle(admin, true);
    check('la extensión sigue andando, con el permiso prendido', (await bg(() => chrome.extension.isAllowedFileSchemeAccess())) === true);
    return;
  }
  await sleep(600);
  check('apagado de verdad: el navegador recarga la extensión, que deja la marca sin abrir nada', !welcomes().length && (await button()).badge === '1', [urls(), await button()]);
  wel = watch(await ctx.newPage()); await wel.goto(WELCOME); await shown(wel);
  check('y la bienvenida muestra el paso', (await seen(wel)).state === 'need');
  await wel.click('[data-wel-act=open]');
  const details = await until(() => ctx.pages().find((p) => p !== admin && p.url().startsWith('chrome://extensions')), 6000);
  check('el botón abre los ajustes de esta extensión', !!details && details.url() === 'chrome://extensions/?id=' + id && (await setup()).asked > 0, urls());
  const before = welcomes();
  check('el permiso queda prendido', await toggle(admin, true));
  wel = await until(() => welcomes().find((p) => !p.isClosed() && !before.includes(p)), 10000);
  check('el navegador cerró la bienvenida al recargar la extensión, y ella vuelve sola', !!wel && welcomes().length === 1 && before.every((p) => p.isClosed()), urls());
  if (wel) { watch(wel); await shown(wel, 'done').catch(() => {}); check('ya en "Listo"', (await seen(wel)).state === 'done'); }
  const b = await until(async () => { const x = await button(); return x.badge === '' ? x : null; }, 6000);
  check('sin marca, y lo anotado para la vuelta se limpia', !!b && !((await setup()).asked > 0), [b, await setup()]);
});

await step('Un archivo del disco', async () => {
  const md = watch(await ctx.newPage());
  await md.goto('file:///' + path.join(root, 'examples', 'sample.md').replace(/\\/g, '/'));
  check('un .md del disco se abre con SharpMD', !!(await md.waitForSelector('.markdown-body h1', { timeout: 15000 }).catch(() => null)));
  check('sin errores de página ni de política de contenido', !errors.length, errors.slice(0, 5));
});

await finish();
