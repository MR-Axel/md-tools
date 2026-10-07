// La app de Android de la tienda (la web empaquetada): LMD.storeApp se prende con ?src=android o cuando la página
// de origen es android-app://…, se recuerda mientras dure la pestaña y no pasa a otras. En la web común queda apagado.
// También: assetlinks.json está bien formado y no va en el paquete de la extensión.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  await app.page.evaluate(() => { const d = document.createElement('div'); d.className = 'lmd-plan'; d.innerHTML = '<h4>Paid <small>USD 3.99</small></h4><div class="lmd-plan-buy"><a data-pay="" href="#">x</a></div><a target="_blank" href="#">portal</a>'; d.id = 'probe'; document.body.appendChild(d); });
  check('ni precios, botones de compra o el enlace al cobro', await app.page.evaluate(() => [...document.querySelectorAll('#probe small, #probe .lmd-plan-buy, #probe [data-pay], #probe > a')].every((n) => getComputedStyle(n).display === 'none')));
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
