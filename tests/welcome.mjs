// La bienvenida de la extensión y el permiso para archivos del disco ("Permitir acceso a URL de archivo").
//
// Una extensión cargada con --load-extension arranca como una instalada desde la tienda: sin ese permiso. Acá se
// recorre lo que ve quien la instala (la bienvenida con el paso, la marca en el botón, "Ahora no" y "No uso archivos
// del disco"), y después se prende el permiso desde la página de extensiones, como lo haría una persona: el
// navegador recarga la extensión, y la bienvenida vuelve en "Listo".
// Uso: node welcome.mjs   (SHOTS=carpeta guarda capturas en claro y en oscuro)
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { tally, sleep, root } from './rig.mjs';

const { check, done } = tally();
const J = JSON.stringify;
const SHOTS = process.env.SHOTS || '';
const until = async (fn, ms) => { const t = Date.now(); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v || Date.now() - t > (ms || 10000)) return v; await sleep(150); } };

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-welcome-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1100, height: 820 }, locale: 'es-AR', colorScheme: 'light', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const errors = [];
let bad = 1;
try {
  const first = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(first.url()).host; const WELCOME = 'chrome-extension://' + id + '/src/welcome.html'; const OWN = 'chrome-extension://' + id + '/src/app.html';
  // El service worker se duerme, y al cambiar el permiso se recarga: siempre se toma el que esté vivo.
  const SW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://' + id)) || ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const bg = async (fn, arg) => (await SW()).evaluate(fn, arg);
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text()); }); return p; };
  const welcomes = () => ctx.pages().filter((p) => p.url().startsWith(WELCOME));
  const button = () => bg(async () => ({ badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
  const press = () => bg(() => LMD.bridgeHost.onAction().then(() => true));
  const setup = () => bg(async () => (await chrome.storage.local.get('fileSetup')).fileSetup || {});
  const seen = (p) => p.evaluate(() => {
    const vis = (n) => !!n && !n.hidden && !n.closest('[hidden]');
    const part = document.querySelector('[data-wel]:not([hidden])');
    return { state: document.documentElement.dataset.welState || '', lang: document.documentElement.lang, h1: part ? part.querySelector('h1').textContent : '', text: part ? part.innerText : '',
      buttons: part ? [...part.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim()) : [], label: document.querySelector('[data-wel-label]').textContent, other: document.querySelector('[data-wel-other]').textContent,
      how: vis(document.querySelector('[data-wel-how]')), logo: [...document.querySelectorAll('.lmd-wel-brand img')].every((i) => i.naturalWidth > 0), wide: document.documentElement.scrollWidth - innerWidth,
      bg: getComputedStyle(document.body).backgroundColor, dark: document.documentElement.classList.contains('lmd-dark') };
  });
  const shots = async (p, name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme }); await p.reload(); await p.waitForSelector('[data-wel]:not([hidden])'); await p.waitForTimeout(1800);
      await p.screenshot({ path: path.join(SHOTS, name + '-' + (scheme === 'light' ? 'claro' : 'oscuro') + '.png') });
    }
    await p.emulateMedia({ colorScheme: 'light' }); await p.reload(); await p.waitForSelector('[data-wel]:not([hidden])');
  };

  // ---------- Al instalar, con el permiso ya prendido ----------
  // Una extensión cargada por línea de comandos nace con el acceso a archivos: es el caso de una reinstalación o de
  // una política de empresa. La instalación es de verdad (el navegador avisa onInstalled con "install").
  console.log('Al instalar, con el permiso ya prendido');
  const access0 = await bg(() => chrome.extension.isAllowedFileSchemeAccess());
  let wel = await until(() => welcomes()[0], 10000);
  check('la bienvenida se abre sola al instalar, una sola vez', !!wel && welcomes().length === 1, ctx.pages().map((p) => p.url()));
  if (!wel) { wel = await ctx.newPage(); await wel.goto(WELCOME); }
  watch(wel); await wel.reload(); await wel.waitForSelector('[data-wel]:not([hidden])');
  const born = await seen(wel); const bornBtn = await button();
  check('con el permiso ya prendido arranca en "Listo", sin marca en el botón', access0 === true && born.state === 'done' && born.h1 === 'Listo' && J(born.buttons) === J(['Abrir SharpMD']) && bornBtn.badge === '' && bornBtn.title === 'SharpMD', [access0, born, bornBtn]);

  // ---------- Sin el permiso, como llega la de la tienda ----------
  // Se apaga desde la página de extensiones, como lo haría una persona. El navegador recarga la extensión y cierra
  // sus páginas. El modo de desarrollador va prendido para que esa recarga no deje apagada la extensión sin empaquetar.
  console.log('Al instalar, sin el permiso');
  const admin = await ctx.newPage(); await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
  const toggle = async (on) => {
    await admin.evaluate(async ([ext, v]) => { await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }); await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ext, fileAccess: v }); }, [id, on]);
    return until(async () => (await bg(() => chrome.extension.isAllowedFileSchemeAccess())) === on, 12000);
  };
  check('apagado el permiso, la extensión queda como la que llega de la tienda', !!(await toggle(false)));
  await sleep(600);
  check('una recarga no es una instalación: la bienvenida no se abre sola', !welcomes().length, ctx.pages().map((p) => p.url()));
  await bg(() => chrome.runtime.onInstalled.dispatch({ reason: 'update', previousVersion: '2.0.0' })); await sleep(500);
  check('una actualización tampoco la abre', !welcomes().length, ctx.pages().map((p) => p.url()));
  // El aviso de instalación no se puede repetir en el mismo perfil: se le entrega a la extensión el mismo aviso que manda el navegador.
  await bg(() => chrome.runtime.onInstalled.dispatch({ reason: 'install' }));
  wel = await until(() => welcomes()[0], 10000);
  check('al instalar sin el permiso, la bienvenida se abre', !!wel && welcomes().length === 1, ctx.pages().map((p) => p.url()));
  if (!wel) { wel = await ctx.newPage(); await wel.goto(WELCOME); }
  watch(wel); await wel.waitForSelector('[data-wel]:not([hidden])');
  const need = await seen(wel);
  check('muestra el paso, en el idioma del navegador', need.state === 'need' && need.lang === 'es' && need.h1 === 'Para abrir archivos de tu disco falta un permiso' && J(need.buttons) === J(['Abrir los ajustes de la extensión', 'Ahora no', 'No uso archivos del disco']), need);
  check('el interruptor lleva el rótulo del navegador y dice cómo se llama en el otro idioma', need.label === 'Permitir acceso a URL de archivo' && need.other === 'En un navegador en inglés dice "Allow access to file URLs".', [need.label, need.other]);
  check('con el logo, el tema claro del dispositivo, sin desbordar ni signos de admiración', need.logo && !need.dark && need.bg === 'rgb(251, 250, 247)' && need.wide <= 0 && !/[!¡—–]/.test(need.text), need);
  check('en un navegador que no se reconoce queda además el camino en texto', need.how && /buscá SharpMD, Detalles\./.test(need.text), need.text);
  const b0 = await button();
  check('el botón de la barra lleva una marca y dice qué falta', b0.badge === '1' && b0.title === 'SharpMD: falta un permiso para abrir archivos del disco', b0);
  await shots(wel, 'bienvenida-sin-permiso');
  await wel.emulateMedia({ colorScheme: 'dark' }); await wel.reload(); await wel.waitForSelector('[data-wel]:not([hidden])');
  const dark = await seen(wel);
  check('con el dispositivo en oscuro, el tema oscuro de la app', dark.dark && dark.bg === 'rgb(18, 20, 24)', dark.bg);
  await wel.emulateMedia({ colorScheme: 'light' }); await wel.reload(); await wel.waitForSelector('[data-wel]:not([hidden])');

  // Uno de los doce temas, y la app en inglés con el navegador en español.
  await bg(() => LMD.patch({ preset: 'arena', language: 'en' }));
  await wel.reload(); await wel.waitForSelector('[data-wel]:not([hidden])');
  const en = await seen(wel);
  check('con la app en inglés, los textos en inglés y el rótulo como lo muestra el navegador', en.lang === 'en' && en.h1 === 'One permission is missing to open files from your disk' && J(en.buttons) === J(['Open the extension settings', 'Not now', 'I do not use files from my disk']) && en.label === 'Permitir acceso a URL de archivo' && en.other === 'In a browser in English it reads "Allow access to file URLs".' && !/[!¡—–]/.test(en.text), en);
  check('y toma el tema elegido en la app (Arena)', en.bg === 'rgb(246, 239, 224)', en.bg);
  await bg(() => chrome.storage.local.remove('settings'));
  await wel.reload(); await wel.waitForSelector('[data-wel]:not([hidden])');

  // El botón abre los ajustes de esta extensión en el navegador.
  let tabs = ctx.pages().length;
  await wel.click('[data-wel-act=open]');
  const details = await until(() => ctx.pages().find((p) => p !== admin && p.url().startsWith('chrome://extensions')), 6000);
  check('el botón abre los ajustes de esta extensión en una pestaña', !!details && details.url() === 'chrome://extensions/?id=' + id && ctx.pages().length === tabs + 1 && (await setup()).asked > 0, ctx.pages().map((p) => p.url()));

  // El clic en el botón de la barra, mientras falte.
  await wel.bringToFront(); tabs = ctx.pages().length;
  await press(); await sleep(400);
  check('el botón de la barra trae la bienvenida al frente en vez de abrir la app', welcomes().length === 1 && ctx.pages().length === tabs && !ctx.pages().some((p) => p.url().startsWith(OWN)), ctx.pages().map((p) => p.url()));
  await wel.close(); await press();
  wel = await until(() => welcomes()[0], 6000);
  check('y si estaba cerrada, la abre', !!wel && !ctx.pages().some((p) => p.url().startsWith(OWN)), ctx.pages().map((p) => p.url()));
  watch(wel); await wel.waitForSelector('[data-wel=need]:not([hidden])');

  // "Ahora no": la extensión sigue sirviendo, y el botón vuelve a abrir la app.
  await bg(() => LMD.patch({ openIn: 'ext' }));
  await wel.click('[data-wel-act=later]');
  const app1 = await until(() => ctx.pages().find((p) => p.url().startsWith(OWN)), 8000);
  check('"Ahora no" cierra la bienvenida y abre SharpMD', !!app1 && !!(await until(() => !welcomes().length, 4000)), ctx.pages().map((p) => p.url()));
  await press(); await sleep(400);
  const b1 = await button();
  check('desde ahí el botón abre la app como siempre, y la marca sigue', !welcomes().length && b1.badge === '1' && (await setup()).later > 0, [b1, ctx.pages().map((p) => p.url())]);
  await bg(async () => { const s = (await chrome.storage.local.get('fileSetup')).fileSetup; await chrome.storage.local.set({ fileSetup: Object.assign({}, s, { later: Date.now() - 8 * 864e5 }) }); });
  await press();
  wel = await until(() => welcomes()[0], 6000);
  check('pasados unos días, el botón lo vuelve a recordar', !!wel);
  watch(wel); await wel.waitForSelector('[data-wel=need]:not([hidden])');

  // Ajustes > Instalar, en la página de la extensión: el estado y el mismo botón.
  if (app1) {
    watch(app1); await app1.bringToFront(); await app1.waitForSelector('.lmd-home');
    await app1.click('[data-act=settings]'); await app1.waitForSelector('.lmd-panel-card'); await app1.click('[data-ptab=inst]'); await app1.waitForSelector('[data-inst-pane] h4'); await app1.waitForTimeout(200);
    const pane = await app1.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); return { text: box.innerText, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
    check('Ajustes > Instalar dice que falta el acceso, con el botón y el camino en texto', pane.text.includes('Instalada, versión ' + manifest.version + ' · Acceso a archivos: no') && J(pane.buttons) === J(['Abrir los ajustes de la extensión', 'No uso archivos del disco']) && /buscá SharpMD, Detalles\./.test(pane.text) && !/[!¡—–]/.test(pane.text), pane);
    await app1.click('[data-act=close-panel]');
  }

  // "No uso archivos del disco": no se recuerda más.
  await wel.click('[data-wel-act=never]');
  await until(() => !welcomes().length, 4000);
  const b2 = await until(async () => { const b = await button(); return b.badge === '' ? b : null; }, 4000);
  check('"No uso archivos del disco" saca la marca y cierra la bienvenida', !!b2 && b2.title === 'SharpMD' && !welcomes().length && (await setup()).never === true, [b2, await setup()]);
  await press(); await sleep(400);
  check('y el botón abre la app, sin volver a la bienvenida', !welcomes().length, ctx.pages().map((p) => p.url()));
  // Abierta a mano sigue mostrando el paso: descartar el recordatorio no esconde cómo se hace.
  wel = watch(await ctx.newPage()); await wel.goto(WELCOME); await wel.waitForSelector('[data-wel]:not([hidden])');
  check('abierta a mano, la página sigue mostrando el paso', (await seen(wel)).state === 'need');
  await bg(async () => { const s = (await chrome.storage.local.get('fileSetup')).fileSetup; await chrome.storage.local.set({ fileSetup: { asked: s.asked } }); });

  // ---------- Se prende el permiso ----------
  console.log('Con el permiso');
  // Primero, la página sola: el API contesta que sí y ella pasa a "Listo" sin recargar (para el navegador que no recargue la extensión).
  const probe = watch(await ctx.newPage()); await probe.goto(WELCOME); await probe.waitForSelector('[data-wel=need]:not([hidden])');
  await probe.evaluate(() => { chrome.extension.isAllowedFileSchemeAccess = async () => true; });
  const turned = await until(async () => (await seen(probe)).state === 'done', 5000);
  check('la página detecta sola que el permiso quedó prendido y pasa a "Listo"', !!turned && await probe.evaluate(() => document.activeElement && document.activeElement.dataset.welAct === 'app'));
  await probe.close();
  await bg(async () => { const s = (await chrome.storage.local.get('fileSetup')).fileSetup || {}; await chrome.storage.local.set({ fileSetup: Object.assign({}, s, { asked: Date.now() }) }); });

  // Ahora de verdad, desde la página de extensiones. El navegador recarga la extensión y cierra sus páginas.
  const before = welcomes();
  check('el permiso queda prendido', !!(await toggle(true)));
  wel = await until(() => welcomes().find((p) => !p.isClosed() && !before.includes(p)), 10000);
  check('el navegador cerró la bienvenida al recargar la extensión, y ella vuelve sola', !!wel && welcomes().length === 1 && before.every((p) => p.isClosed()), ctx.pages().map((p) => p.url()));
  if (!wel) { wel = await ctx.newPage(); await wel.goto(WELCOME); }
  watch(wel); await wel.waitForSelector('[data-wel=done]:not([hidden])', { timeout: 8000 }).catch(() => {});
  const ok = await seen(wel);
  check('y arranca en "Listo": qué hacer ahora y el botón que abre SharpMD', ok.state === 'done' && ok.h1 === 'Listo' && /Arrastrá un \.md a una pestaña del navegador\./.test(ok.text) && /doble clic\./.test(ok.text) && J(ok.buttons) === J(['Abrir SharpMD']) && !/[!¡—–]/.test(ok.text) && ok.wide <= 0, ok);
  const b3 = await until(async () => { const b = await button(); return b.badge === '' ? b : null; }, 6000);
  check('sin marca en el botón', !!b3 && b3.title === 'SharpMD', b3);
  check('lo anotado para la vuelta se limpia: no se abre de nuevo en cada arranque', !((await setup()).asked > 0), await setup());
  await shots(wel, 'bienvenida-con-permiso');
  await press(); await sleep(600);
  check('el botón de la barra abre la app', welcomes().length === 1 && ctx.pages().some((p) => p.url().startsWith(OWN) || /sharpmd\.app/.test(p.url())), ctx.pages().map((p) => p.url()));
  await bg(() => LMD.patch({ openIn: 'ext' }));
  await wel.bringToFront(); await wel.click('[data-wel-act=app]');
  const app2 = await until(() => (welcomes().length ? null : ctx.pages().find((p) => p.url().startsWith(OWN))), 8000);
  check('"Abrir SharpMD" abre la app y cierra la bienvenida', !!app2, ctx.pages().map((p) => p.url()));
  if (app2) {
    watch(app2); await app2.bringToFront(); await app2.waitForSelector('.lmd-home');
    await app2.click('[data-act=settings]'); await app2.waitForSelector('.lmd-panel-card'); await app2.click('[data-ptab=inst]'); await app2.waitForSelector('[data-inst-pane] h4'); await app2.waitForTimeout(200);
    const pane = await app2.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); return { text: box.innerText, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
    check('Ajustes > Instalar dice que el acceso está, sin botón', pane.text.includes('Instalada, versión ' + manifest.version + ' · Acceso a archivos: sí') && !pane.buttons.includes('Abrir los ajustes de la extensión') && !pane.buttons.includes('No uso archivos del disco'), pane);
  }
  // Y un .md del disco se abre formateado.
  const md = watch(await ctx.newPage());
  await md.goto('file:///' + path.join(root, 'examples', 'sample.md').replace(/\\/g, '/'));
  check('un .md del disco se abre con SharpMD', !!(await md.waitForSelector('.markdown-body h1', { timeout: 15000 }).catch(() => null)));

  check('sin errores de página ni de política de contenido', !errors.length, errors.slice(0, 5));
  bad = done();
} finally {
  await ctx.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ }
}
process.exit(bad ? 1 : 0);
