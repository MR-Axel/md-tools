// La app de Android de la tienda (la web empaquetada): LMD.storeApp se prende con ?src=android o cuando la página
// de origen es android-app://…, se recuerda mientras dure la pestaña y no pasa a otras. En la web común queda apagado.
// También: assetlinks.json está bien formado y no va en el paquete de la extensión.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { rig } from './rig.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
const results = []; const errors = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  await ctx.route((url) => /(^|\.)sync\.sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
};
const state = (page) => page.evaluate(() => ({ on: LMD.storeApp, cls: document.documentElement.classList.contains('lmd-store-app'), kept: sessionStorage.getItem('sharpmd:store') }));
const ready = (page) => page.waitForSelector('.lmd-home [data-home=new], .lmd-draft');

try {
  // ---------- La web común ----------
  const web = await open();
  await web.page.goto(home); await ready(web.page);
  let s = await state(web.page);
  check('en la web común LMD.storeApp es false y no queda nada anotado', s.on === false && !s.cls && s.kept === null, s);
  await web.page.goto(home + '?src=other'); await ready(web.page);
  s = await state(web.page);
  check('otro valor de src no lo prende', s.on === false && !s.cls, s);
  await web.ctx.close();

  // ---------- Dentro de la app: el parámetro ----------
  const app = await open();
  await app.page.goto(home + '?src=android'); await ready(app.page);
  s = await state(app.page);
  check('con ?src=android LMD.storeApp es true y <html> lleva lmd-store-app', s.on === true && s.cls && s.kept === '1', s);
  await app.page.click('[data-act=settings]'); await app.page.waitForSelector('.lmd-panel:not([hidden])');
  check('adentro de la app no se ve el enlace de donación', await app.page.evaluate(() => { const l = document.querySelector('.lmd-ptabs-link'); return !!l && getComputedStyle(l).display === 'none'; }));
  await app.page.evaluate(() => { const d = document.createElement('div'); d.className = 'lmd-plan'; d.innerHTML = '<h4>Paid <small>USD 40</small></h4><p class="lmd-price">USD 5 per person a month, minimum 2</p><div class="lmd-plan-buy"><a data-pay="" href="#">x</a></div><a target="_blank" href="#">portal</a>'; d.id = 'probe'; document.body.appendChild(d); });
  check('ni precios, botones de compra o el enlace al cobro', await app.page.evaluate(() => [...document.querySelectorAll('#probe small, #probe .lmd-price, #probe .lmd-plan-buy, #probe [data-pay], #probe > a')].every((n) => getComputedStyle(n).display === 'none')));
  await app.page.evaluate(() => document.getElementById('probe').remove()); await app.page.click('[data-act=close-panel]');
  await app.page.goto(home.replace(/src\/app\.html.*$/, 'pay.html?plan=monthly&email=a%40b.test')); await app.page.waitForURL(/app\.html/);
  check('pay.html devuelve a la app sin abrir el cobro', /app\.html/.test(app.page.url()));
  await app.page.goto(home); await ready(app.page);
  await app.page.goto(home); await ready(app.page);
  s = await state(app.page);
  check('al navegar sin el parámetro se sigue sabiendo', s.on === true && s.cls, s);
  await app.page.reload(); await ready(app.page);
  check('y después de recargar también', (await state(app.page)).on === true);
  const other = await app.ctx.newPage(); await other.goto(home); await ready(other);
  s = await state(other);
  check('otra pestaña del mismo navegador no lo hereda', s.on === false && s.kept === null, s);
  await app.ctx.close();

  // ---------- El atajo de nota nueva ----------
  const quick = await open();
  await quick.page.goto(home + '?new=1&src=android'); await quick.page.waitForSelector('.lmd-draft');
  check('el atajo "New note" de la app crea la nota y se detecta', (await state(quick.page)).on === true);
  await quick.ctx.close();

  // ---------- El aviso de la primera nota en la nube, dentro de la app ----------
  // Con una cuenta y un servidor de pruebas: en el teléfono de la app sale igual que en la web, entra en la
  // pantalla, y lleva a Ajustes y a proteger toda la nube.
  const R = await rig({ AUTH_PER_IP: '300' });
  try {
    const U = await R.signup('tienda@ejemplo.test');
    await R.api('PUT', '/notes/primera.md', { text: '# First\n\nA note.\n' }, U.s);
    const tel = await R.open(U, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    await tel.page.goto(R.noteUrl('primera.md') + '&src=android'); await tel.page.waitForSelector('.markdown-body h1');
    const inApp = (await state(tel.page)).on;
    await tel.page.evaluate(() => LMD.cloud.save('primera.md', '# First\n\nSaved from the store app.\n')); await tel.page.waitForSelector('.lmd-protect-hint');
    const hint = await tel.page.evaluate(() => { const h = document.querySelector('.lmd-protect-hint'); const r = h.getBoundingClientRect(); const bs = [...h.querySelectorAll('button')];
      return { title: h.querySelector('b').textContent, text: h.querySelector('p').textContent, buttons: bs.map((b) => b.textContent), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, tall: bs.every((b) => b.getBoundingClientRect().height >= 40), noScroll: document.documentElement.scrollWidth <= innerWidth, modal: !!document.querySelector('.lmd-ask') }; });
    check('en la app de la tienda el aviso de la primera nota en la nube sale igual, en inglés', inApp === true && hint.title === 'Your note is in the cloud' && hint.buttons.join('|') === 'Protect with a password|Not now|How it works' &&
      hint.text === 'The cloud is encrypted, and the server keeps that key so it can share your notes and hand them to your AI. To keep even the server from reading them, protect them with a password: they become end-to-end encrypted.' && !/[!¡—–]/.test(hint.title + hint.text), [inApp, hint]);
    check('en el teléfono entra en la pantalla, sus botones se tocan y no tapa con una ventana', hint.inside && hint.tall && hint.noScroll && hint.modal === false, hint);
    await tel.page.tap('.lmd-protect-hint [data-ph=how]'); await tel.page.waitForSelector('.lmd-panel-card .lmd-e2e');
    const line = await tel.page.evaluate(() => { const l = document.querySelector('.lmd-panel-card .lmd-e2e'); const b = l.querySelector('button'); const r = b.getBoundingClientRect(); return { text: l.querySelector('p').textContent, button: b.textContent, fits: r.height >= 40 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth, card: [...document.querySelectorAll('[data-sec-row=vaults] [data-c]')].map((x) => x.textContent) }; });
    check('"How it works" abre Ajustes en Cloud, con "End-to-end protection: off" y su botón', line.text === 'End-to-end protection: off' && line.button === 'Protect with a password' && line.fits && line.card.join('|') === 'Protect my whole cloud|Protect a folder', line);
    await tel.page.tap('.lmd-panel-card .lmd-e2e [data-c=protect-all]'); await tel.page.waitForSelector('.lmd-vault-card [data-v=p1]');
    const card = await tel.page.evaluate(() => { const c = document.querySelector('.lmd-vault-card'); const r = c.getBoundingClientRect(); return { title: c.querySelector('h3').textContent, changes: [...c.querySelectorAll('.lmd-vault-changes li')].length, fits: r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth, text: c.innerText }; });
    check('el botón lleva a "Protect my cloud with a password", con lo que cambia y sin signos de admiración ni rayas', card.title === 'Protect my cloud with a password' && card.changes === 4 && card.fits && !/[!¡—–]/.test(card.text), card);
    check('el aviso no mandó nada fuera del servidor de pruebas ni dio errores', R.outside.length === 0 && R.errors.length === 0, [R.outside, R.errors]);
  } finally { await R.close(); }

  // ---------- Dentro de la app: la página de origen ----------
  const ref = await open();
  await ref.page.addInitScript(() => Object.defineProperty(Document.prototype, 'referrer', { get: () => 'android-app://app.sharpmd/' }));
  await ref.page.goto(home); await ready(ref.page);
  s = await state(ref.page);
  check('una página de origen android-app:// lo prende sin el parámetro', s.on === true && s.cls && s.kept === '1', s);
  await ref.ctx.close();

  // ---------- Los archivos que acompañan ----------
  const links = JSON.parse(fs.readFileSync(path.join(root, '.well-known', 'assetlinks.json'), 'utf8'));
  const t = (links[0] || {}).target || {}; const prints = t.sha256_cert_fingerprints || [];
  check('assetlinks.json nombra el paquete app.sharpmd con huellas SHA-256 bien escritas', links.length === 1 && (links[0].relation || []).includes('delegate_permission/common.handle_all_urls') && t.namespace === 'android_app' && t.package_name === 'app.sharpmd' &&
    prints.length >= 1 && prints.every((p) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(p)), t);
  check('GitHub Pages sirve las carpetas con punto: está .nojekyll', fs.existsSync(path.join(root, '.nojekyll')));
  const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  check('.well-known no va en el paquete de la extensión', /^\/\.well-known\/ export-ignore\r?$/m.test(attrs));
  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) {
  check('la prueba corrió hasta el final', false, String(e && e.stack || e).split('\n').slice(0, 4));
} finally {
  await browser.close(); site.close();
}
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
