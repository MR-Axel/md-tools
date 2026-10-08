// Publicar: una carpeta de notas servida como sitio web público, por un segundo nombre de host.
// Se prueba de punta a punta: publicar desde la app (menú de la carpeta y Ajustes), el sitio como lo ve un
// visitante (navegación, buscador, sin JavaScript, en teléfono), los cambios sin publicar y volver a publicar,
// despublicar, el plan y la baja de plan, el equipo con su política, la suspensión por administración y la denuncia.
// El host de sitios es el mismo servidor local pedido con otro nombre: pages.localhost, que resuelve a 127.0.0.1.
// El correo es un servidor falso local: nada sale de esta máquina.
import { rig, tally, sleep, root } from './rig.mjs';
import { spawn } from 'child_process';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';

const mails = [];
const fakeMail = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { try { mails.push(JSON.parse(raw)); } catch (e) { /* no era un correo */ } res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));

let PORT = 0;
const R = await rig((port) => { PORT = port; return { PAGES_URL: 'http://pages.localhost:' + port, PAGES_GRACE_MS: '2500', PAGES_MAX_PAGES: '8', AUTH_PER_IP: '300', FEEDBACK_TO: 'avisos@ejemplo.test', MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port }; });
const { check, done } = tally();
const enc = encodeURIComponent;
const PH = 'pages.localhost:' + PORT; const PAGES = 'http://' + PH;
// Un pedido con la cabecera Host que se quiera: así se llega al host de sitios sin depender de cómo resuelve nombres esta máquina.
const raw = (host, p, opt) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: (opt && opt.method) || 'GET', headers: Object.assign({ host }, (opt && opt.headers) || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  r.on('error', reject); if (opt && opt.body) r.write(opt.body); r.end();
});
const site = (p, opt) => raw(PH, p, opt);
const admin = (method, body, q) => R.api(method, '/admin/sites' + (q || ''), body, undefined, { 'x-admin-key': R.ADMIN });
const put = (who, p, text, o) => R.api('PUT', '/notes/' + enc(p) + (o ? '?o=' + o : ''), { text }, who.s);
const plan = (who, p) => R.api('POST', '/admin/plan', { email: who.email, plan: p }, undefined, { 'x-admin-key': R.ADMIN });
const page = (note, rev, html, extra) => Object.assign({ note, rev, html }, extra || {});
// Con SITES_SHOTS=carpeta quedan capturas del sitio y de la ventana, para mirarlas.
const shot = async (pg, name) => { if (process.env.SITES_SHOTS) await pg.screenshot({ path: path.join(process.env.SITES_SHOTS, name + '.png') }); };

const NOTES = {
  'manual/index.md': '---\ntitle: Manual de la cafetera\ndescription: Todo lo que hace falta para usarla.\n---\n# Manual de la cafetera\n\nEmpezá por la [guía de uso](guia.md) o mirá [[Limpieza]].\n\nTambién hay un [apunte privado](privado.md) y una [página que no existe](nada.md).\n\n![Foto del frente](fotos/frente.png)\n\nUn sitio de afuera: [ejemplo](https://example.com/a).\n',
  'manual/guia.md': '# Guía de uso\n\nCalentá el agua a 93 grados.\n\n## Proporción\n\n$$\nr = \\frac{cafe}{agua}\n$$\n\n## Pasos\n\n```mermaid\ngraph TD\n  A[Moler] --> B[Infusionar]\n  B --> C[Servir]\n```\n\n| Taza | Gramos |\n|---|---:|\n| Chica | 12 |\n| Grande | 18 |\n\n```js\nconst gramos = 18;\n```\n\nVolvé al [inicio](index.md#manual-de-la-cafetera).\n',
  'manual/cuidado/limpieza.md': '---\norder: 1\n---\n# Limpieza\n\nDescalcificá una vez por mes con vinagre.\n\n- [x] Enjuagar\n- [ ] Secar\n',
  'manual/privado.md': '---\npublish: false\n---\n# Privado\n\nEsto no se publica nunca.\n',
  'otra/afuera.md': '# Afuera\n\nNota de otra carpeta.\n',
};

try {
  const { api } = R;
  const A = await R.signup('ana@ejemplo.test', true); const F = await R.signup('fede@ejemplo.test'); const X = await R.signup('xime@ejemplo.test', true);
  for (const p of Object.keys(NOTES)) await put(A, p, NOTES[p]);

  // ---------- Apagado sin PAGES_URL ----------
  console.log('Sin el host de sitios');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsites-')); const port = PORT + 1; const base = 'http://127.0.0.1:' + port;
    const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', PUBLIC_URL: base, PAGES_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 80 && !/puerto/.test(log); i++) await sleep(100);
    const call = (m, p, b, s) => fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}), body: b === undefined ? undefined : JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    const code = (await call('POST', '/auth/start', { email: 'sola@ejemplo.test' })).json.dev_code; const v = (await call('POST', '/auth/verify', { email: 'sola@ejemplo.test', code })).json;
    const acct = (await call('GET', '/account', undefined, v.session)).json; const list = await call('GET', '/sites', undefined, v.session); const make = await call('POST', '/sites', { folder: 'a', slug: 'algo', title: 'Algo' }, v.session);
    const viaHost = await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port, path: '/algo/', headers: { host: 'pages.localhost:' + port } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); r.end(); });
    check('sin PAGES_URL la cuenta dice que el servidor no publica sitios, y las rutas no existen', acct.pages && acct.pages.enabled === false && list.status === 404 && make.status === 404, [acct.pages, list.status, make.status]);
    check('y ningún nombre de host sirve un sitio: responde la API de siempre', viaHost === 401, viaHost);
    proc.kill(); await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ }
  }

  // ---------- Quién puede crear un sitio, y con qué dirección ----------
  console.log('Crear un sitio');
  const acct0 = (await api('GET', '/account', undefined, A.s)).json;
  check('con PAGES_URL la cuenta sabe que puede publicar: un sitio por cuenta paga', acct0.pages.enabled === true && acct0.pages.url === PAGES && acct0.pages.max === 1 && acct0.pages.paid === true && acct0.pages.sites.length === 0, acct0.pages);
  await put(F, 'manual/index.md', '# Gratis');
  const free = await api('POST', '/sites', { folder: 'manual', slug: 'gratis', title: 'Gratis' }, F.s);
  check('el plan gratis no publica: 402', free.status === 402 && free.json.error === 'site_needs_plan', free);
  const noAuth = await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: 'x' });
  check('sin sesión no hay nada que hacer en /sites', noAuth.status === 401 && (await api('GET', '/sites')).status === 401, noAuth.status);
  const badSlugs = [];
  for (const s of ['Ab', 'ab', 'con espacio', '../arriba', 'a/b', '-guion', 'guion-', 'ñandú', 'a'.repeat(41), '%2e%2e', 'x_y', '']) badSlugs.push((await api('POST', '/sites', { folder: 'manual', slug: s, title: 'x' }, A.s)).json.error);
  check('la dirección lleva minúsculas, números y guiones, de 3 a 40: lo demás no pasa', badSlugs.every((e) => e === 'bad_slug'), badSlugs);
  const reserved = []; for (const s of ['admin', 'api', 'www', 'sharpmd', 'login']) reserved.push((await api('POST', '/sites', { folder: 'manual', slug: s, title: 'x' }, A.s)).json.error);
  check('y hay nombres reservados', reserved.every((e) => e === 'slug_reserved'), reserved);
  const noTitle = await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: '  ' }, A.s);
  const noFolder = await api('POST', '/sites', { folder: 'no-existe', slug: 'cafetera', title: 'x' }, A.s);
  const badTheme = [(await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: 'x', accent: 'red; background:url(https://xss.invalid/a)' }, A.s)).json.error, (await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: 'x', font: 'Comic Sans' }, A.s)).json.error,
    (await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: 'x', lang: 'fr' }, A.s)).json.error, (await api('POST', '/sites', { folder: 'manual', slug: 'cafetera', title: 'x', author: 'ana@ejemplo.test' }, A.s)).json.error];
  check('sin título, sin notas en la carpeta, o con un tema fuera de las listas, no se crea', noTitle.json.error === 'bad_title' && noFolder.json.error === 'no_notes' && badTheme.join() === 'bad_theme,bad_theme,bad_lang,bad_author', [noTitle.json, noFolder.json, badTheme]);
  await api('POST', '/vaults', { folder: 'cofre', salt: Buffer.alloc(16, 3).toString('base64'), iters: 200000, wrapped: Buffer.alloc(60, 3).toString('base64'), check: Buffer.alloc(32, 3).toString('base64') }, A.s);
  const vaulted = [await api('POST', '/sites', { folder: 'cofre', slug: 'cofre-abierto', title: 'x' }, A.s), await api('POST', '/sites', { folder: 'cofre/adentro', slug: 'cofre-abierto', title: 'x' }, A.s)];
  check('una carpeta con contraseña no se publica, ni lo de adentro', vaulted.every((r) => r.status === 409 && r.json.error === 'vault'), vaulted.map((r) => [r.status, r.json]));

  // ---------- Publicar desde la app ----------
  console.log('Publicar desde la app');
  const ana = await R.open(A);
  const popups = []; ana.ctx.on('page', (p) => popups.push(p));
  await ana.page.goto(R.noteUrl('manual/guia.md')); await ana.page.waitForSelector('.markdown-body h1');
  const CLOUD = '.lmd-xroot[data-root=cloud]';
  await ana.page.waitForSelector(CLOUD + ' .lmd-node-dir');
  const offered = async (name) => { await ana.page.locator(CLOUD + ' .lmd-node-dir', { hasText: name }).first().click({ button: 'right' }); await ana.page.waitForSelector('.lmd-menu'); const has = await ana.page.evaluate(() => !!document.querySelector('.lmd-menu [data-f=site]')); if (!has) await ana.page.keyboard.press('Escape'); return has; };
  const inVault = await offered('cofre');
  const inMenu = await offered('manual');
  check('el menú de una carpeta de la nube ofrece "Publish as a site…", y el de una protegida no', inMenu === true && inVault === false, [inMenu, inVault]);
  const label = await ana.page.textContent('.lmd-menu [data-f=site]');
  await ana.page.click('.lmd-menu [data-f=site]'); await ana.page.waitForSelector('.lmd-site [data-f=slug]');
  const formNow = await ana.page.evaluate(() => { const g = (k) => document.querySelector('.lmd-site [data-f=' + k + ']'); return { slug: g('slug').value, title: g('title').value, homes: [...g('home').options].map((o) => o.textContent), host: document.querySelector('.lmd-site-addr small').textContent, auto: g('auto').checked, folder: document.querySelector('.lmd-site-folder').textContent.trim(), text: document.querySelector('.lmd-site').innerText }; });
  check('la ventana propone la dirección y el título con el nombre de la carpeta, y dice qué carpeta es', label.trim() === 'Publish as a site…' && formNow.slug === 'manual' && formNow.title === 'manual' && formNow.folder === 'manual/' && formNow.host === PH + '/', formNow);
  check('la página de inicio se elige entre las notas de la carpeta, y avisa de lo que cambia una IA', formNow.homes.includes('index.md') && formNow.homes.includes('cuidado/limpieza.md') && !formNow.homes.some((h) => /afuera/.test(h)) && /Only the notes in this folder are published/.test(formNow.text), formNow.homes);
  await ana.page.fill('.lmd-site [data-f=slug]', 'Admin'); await ana.page.waitForFunction(() => { const m = document.querySelector('.lmd-site [data-f=slug-msg]'); return m && !m.hidden; });
  const slugMsg1 = await ana.page.textContent('.lmd-site [data-f=slug-msg]');
  await ana.page.fill('.lmd-site [data-f=slug]', 'cafetera'); await ana.page.waitForFunction(() => document.querySelector('.lmd-site [data-f=slug-msg]').hidden);
  check('la dirección se comprueba mientras se escribe', /reserved/.test(slugMsg1), slugMsg1);
  await ana.page.fill('.lmd-site [data-f=title]', 'Manual de la cafetera');
  await ana.page.selectOption('.lmd-site [data-f=accent]', '#3b82f6'); await ana.page.selectOption('.lmd-site [data-f=font]', 'Georgia'); await ana.page.selectOption('.lmd-site [data-f=lang]', 'es');
  await ana.page.fill('.lmd-site [data-f=author]', 'Ana P.');
  await shot(ana.page, 'ventana-crear');
  // Vista previa: se suben las páginas sin publicar y se abre en otra pestaña, con una dirección que solo tiene quien publica.
  await ana.page.click('.lmd-site [data-st=preview]');
  await ana.page.waitForSelector('.lmd-site [data-site-state]', { timeout: 60000 });
  for (let i = 0; i < 50 && !(popups[0] && /~/.test(popups[0].url())); i++) await sleep(100);
  const prev = popups[0]; await prev.waitForSelector('.sp-body h1');
  const preview = await prev.evaluate(() => ({ url: location.href, banner: (document.querySelector('.sp-preview') || {}).textContent || '', robots: (document.querySelector('meta[name=robots]') || {}).content || '', canonical: !!document.querySelector('link[rel=canonical]'), h1: document.querySelector('.sp-body h1').textContent, nav: [...document.querySelectorAll('.sp-nav a')].map((a) => a.getAttribute('href')) }));
  const s0 = (await api('GET', '/sites', undefined, A.s)).json.sites[0];
  const notLive = await site('/cafetera/');
  check('la vista previa muestra el sitio antes de publicarlo, sin indexar y con enlaces dentro de la vista previa', /\/~[\w-]{16,}\/$/.test(preview.url) && /Vista previa/.test(preview.banner) && preview.robots === 'noindex' && !preview.canonical && preview.h1 === 'Manual de la cafetera' && preview.nav.every((h) => h.startsWith('/~')), preview);
  check('y mientras tanto la dirección pública no sirve nada (410)', notLive.status === 410 && s0.live === false && s0.pages === 3 && await ana.page.getAttribute('.lmd-site [data-site-state]', 'data-site-state') === 'off', [notLive.status, s0.live, s0.pages]);
  await prev.close();
  await ana.page.click('.lmd-site [data-st=publish]');
  await ana.page.waitForSelector('.lmd-site [data-site-state=ok]', { timeout: 60000 });
  const shown = await ana.page.evaluate(() => ({ url: document.querySelector('.lmd-site-url a').href, state: document.querySelector('.lmd-site .lmd-site-state').textContent, text: document.querySelector('.lmd-site').innerText, publish: document.querySelector('.lmd-site [data-st=publish]').disabled }));
  check('publicar deja el sitio a la vista: la ventana muestra su dirección y que está publicado', shown.url === PAGES + '/cafetera/' && shown.state === 'Published' && shown.publish === true && /What an AI or the API changes stays unpublished/.test(shown.text), shown);
  const S = (await api('GET', '/sites', undefined, A.s)).json.sites[0];
  check('el servidor guardó tres páginas: la nota con publish: false y la de otra carpeta quedaron afuera', S.live === true && S.pages === 3 && S.pending.changed.length + S.pending.added.length + S.pending.removed.length === 0 && S.lang === 'es' && S.accent === '#3b82f6' && S.font === 'Georgia' && S.auto === true, S);
  await shot(ana.page, 'ventana-publicado');
  await ana.page.click('.lmd-site [data-st=close]');

  // ---------- El sitio, como lo ve un visitante ----------
  console.log('El sitio publicado');
  const home = await site('/cafetera/');
  const CSP = "default-src 'none'; script-src " + PAGES + "/_/site.js; style-src " + PAGES + "/_/site.css; img-src https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  check('la portada sale con la política de contenido estricta y las cabeceras de siempre', home.status === 200 && home.headers['content-security-policy'] === CSP && home.headers['x-content-type-options'] === 'nosniff' && !!home.headers['referrer-policy'] && home.headers['x-frame-options'] === 'DENY' && !('access-control-allow-origin' in home.headers), home.headers);
  check('sin estilos ni scripts en línea: una hoja y un script, los dos del mismo host', !/<style|\sstyle=|\son[a-z]+=/i.test(home.body) && (home.body.match(/<script/g) || []).length === 1 && /<script src="\/_\/site\.js\?v=\w+"><\/script>/.test(home.body) && /<link rel="stylesheet" href="\/_\/site\.css\?v=\w+">/.test(home.body), home.body.slice(0, 900));
  check('SEO: título, descripción del encabezado de la nota, canónica, Open Graph e idioma', /<html lang="es" data-accent="blue" data-font="georgia">/.test(home.body) && /<title>Manual de la cafetera<\/title>/.test(home.body) && /<meta name="description" content="Todo lo que hace falta para usarla\.">/.test(home.body) &&
    home.body.includes('<link rel="canonical" href="' + PAGES + '/cafetera/">') && /property="og:title" content="Manual de la cafetera"/.test(home.body) && /property="og:type" content="website"/.test(home.body) && !/name="robots"/.test(home.body), home.body.slice(0, 1200));
  check('en la página no aparece el correo de quien publica, y sí el nombre de autor que eligió', !home.body.includes('ana@ejemplo.test') && /Por Ana P\./.test(home.body) && /<meta name="author" content="Ana P\.">/.test(home.body));
  check('el pie dice "Publicado con SharpMD" con el enlace, y tiene cómo denunciar', /<a class="sp-made" href="https:\/\/sharpmd\.app">Publicado con SharpMD<\/a>/.test(home.body) && /<a href="\/_\/report\?s=cafetera&#38;p=" rel="nofollow">Denunciar<\/a>/.test(home.body), home.body.slice(-700));
  const body = home.body.slice(home.body.indexOf('<article'), home.body.indexOf('</article>'));
  check('los enlaces entre notas llevan a las páginas del sitio: el relativo y el [[enlace]]', /<a href="\/cafetera\/guia">guía de uso<\/a>/.test(body) && /<a href="\/cafetera\/cuidado\/limpieza"[^>]*>Limpieza<\/a>/.test(body), body);
  check('un enlace a una nota sin publicar, o que no existe, queda como texto sin enlace', /<a>apunte privado<\/a>/.test(body) && /<a>página que no existe<\/a>/.test(body) && !/privado\.md|nada\.md/.test(body), body);
  check('un enlace de afuera sale con rel="nofollow ugc noopener"', /<a href="https:\/\/example\.com\/a" rel="nofollow ugc noopener">ejemplo<\/a>/.test(body), body);
  check('una imagen del disco no existe en la nube: queda su texto', /<span class="sp-noimg">Foto del frente<\/span>/.test(body) && !/<img/.test(body), body);
  const hidden = [await site('/cafetera/privado'), await site('/cafetera/afuera'), await site('/cafetera/otra/afuera'), await site('/cafetera/nada')];
  check('lo que no se publicó no tiene dirección: 404', hidden.every((r) => r.status === 404) && !hidden.some((r) => /no se publica nunca|Nota de otra carpeta/.test(r.body)), hidden.map((r) => r.status));
  const guide = await site('/cafetera/guia');
  check('la guía trae su título en la pestaña, el diagrama como imagen, la fórmula en MathML, la tabla y el código', /<title>Guía de uso · Manual de la cafetera<\/title>/.test(guide.body) && /<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="[^"]*" width="\d+" height="\d+"/.test(guide.body) && /<math[^>]*display="block"/.test(guide.body) && /<mfrac>/.test(guide.body) &&
    /<table>/.test(guide.body) && /class="sp-al-right"/.test(guide.body) && /<pre><code class="[^"]*language-js[^"]*">/.test(guide.body) && !/<svg|<foreignObject|class="katex/.test(guide.body), guide.body.slice(guide.body.indexOf('<article'), guide.body.indexOf('<article') + 700));
  check('y el enlace de vuelta lleva a la portada, con su sección', /<a href="\/cafetera\/#manual-de-la-cafetera">inicio<\/a>/.test(guide.body), guide.body.match(/<a href="[^"]*">inicio<\/a>/));
  const etag = home.headers.etag; const again = await site('/cafetera/', { headers: { 'if-none-match': etag } });
  check('caché: cada página trae ETag, se revalida siempre y responde 304 si no cambió', !!etag && again.status === 304 && /must-revalidate/.test(home.headers['cache-control']), [etag, again.status, home.headers['cache-control']]);
  const map = await site('/cafetera/sitemap.xml'); const robots = await site('/cafetera/robots.txt'); const rootRobots = await site('/robots.txt'); const rootMap = await site('/sitemap.xml'); const idx = await site('/cafetera/search.json');
  check('sitemap.xml y robots.txt del sitio, y los del host', map.status === 200 && map.body.includes('<loc>' + PAGES + '/cafetera/guia</loc>') && map.body.includes('<loc>' + PAGES + '/cafetera/</loc>') && !/privado/.test(map.body) && /Allow: \/cafetera\//.test(robots.body) && robots.body.includes('Sitemap: ' + PAGES + '/cafetera/sitemap.xml') &&
    /Disallow: \/_\//.test(rootRobots.body) && rootMap.body.includes(PAGES + '/cafetera/sitemap.xml'), [map.body, robots.body, rootRobots.body]);
  const docs = JSON.parse(idx.body);
  check('el índice del buscador trae las tres páginas, con su texto y sin la nota excluida', docs.length === 3 && docs.some((d) => d.r === 'guia' && /93 grados/.test(d.x)) && !/no se publica nunca/.test(idx.body), docs.map((d) => [d.r, d.t]));

  const visit = await R.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR', colorScheme: 'light' });
  const v = await visit.newPage(); const cspErrors = []; const pageErrors = []; const beyond = [];
  v.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text().slice(0, 200)); });
  v.on('pageerror', (e) => pageErrors.push(e.message)); v.on('request', (r) => { if (!r.url().startsWith(PAGES) && !r.url().startsWith('data:')) beyond.push(r.url()); });
  await v.goto(PAGES + '/cafetera/'); await v.waitForSelector('.sp-search:not([hidden])');
  const look = await v.evaluate(() => ({ brand: document.querySelector('.sp-brand').textContent.trim(), nav: [...document.querySelectorAll('.sp-nav a')].map((a) => a.textContent), current: document.querySelector('.sp-nav a[aria-current]').textContent, folder: (document.querySelector('.sp-nav summary') || {}).textContent,
    font: getComputedStyle(document.body).fontFamily, link: getComputedStyle(document.querySelector('.sp-body a[href]')).color, bg: getComputedStyle(document.body).backgroundColor, next: (document.querySelector('.sp-next b') || {}).textContent, themeBtn: !document.querySelector('.sp-theme').hidden }));
  check('en el navegador: marca con el título, menú con el árbol de páginas y la portada marcada', /Manual de la cafetera/.test(look.brand) && look.nav.join('|') === 'Manual de la cafetera|Guía de uso|Limpieza' && look.current === 'Manual de la cafetera' && look.folder === 'cuidado' && look.next === 'Guía de uso', look);
  check('el tema elegido se aplica desde la hoja propia: tipografía y color de acento', /Georgia/.test(look.font) && look.link !== 'rgb(0, 0, 238)' && look.bg === 'rgb(251, 250, 247)', look);
  await shot(v, 'sitio-portada');
  await v.click('.sp-theme'); const dark = await v.evaluate(() => [document.documentElement.getAttribute('data-theme'), getComputedStyle(document.body).backgroundColor]);
  await shot(v, 'sitio-oscuro');
  await v.reload(); await v.waitForSelector('.sp-search:not([hidden])'); const kept = await v.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await v.click('.sp-theme'); const light = await v.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('el conmutador pasa de claro a oscuro, y se recuerda', dark[0] === 'dark' && dark[1] === 'rgb(18, 20, 24)' && kept === 'dark' && light === 'rgb(251, 250, 247)', [dark, kept, light]);
  await v.click('.sp-nav a[href="/cafetera/guia"]'); await v.waitForSelector('.sp-body img');
  const drawn = await v.evaluate(async () => { const img = document.querySelector('.sp-body .lmd-diagram img'); if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; }); const m = document.querySelector('.sp-body math'); return { w: img ? img.naturalWidth : 0, box: img ? Math.round(img.getBoundingClientRect().width) : 0, math: m ? Math.round(m.getBoundingClientRect().width) : 0, toc: [...document.querySelectorAll('.sp-toc a')].map((a) => a.textContent), prev: document.querySelector('.sp-prev b').textContent, code: !!document.querySelector('.sp-body pre code'), right: getComputedStyle(document.querySelector('.sp-body td.sp-al-right')).textAlign }; });
  check('navegación: la guía dibuja el diagrama y la fórmula, trae el índice de la página y anterior/siguiente', drawn.w > 50 && drawn.box > 50 && drawn.math > 10 && drawn.toc.join('|') === 'Proporción|Pasos' && drawn.prev === 'Manual de la cafetera' && drawn.code && drawn.right === 'right', drawn);
  await shot(v, 'sitio-guia');
  await v.fill('.sp-search input', 'vinagre'); await v.waitForSelector('.sp-hit');
  await shot(v, 'sitio-buscador');
  const hits = await v.evaluate(() => [...document.querySelectorAll('.sp-hit')].map((a) => [a.getAttribute('href'), a.querySelector('b').textContent, (a.querySelector('span') || {}).textContent]));
  await v.fill('.sp-search input', 'zzzzqqq'); await v.waitForSelector('.sp-empty'); const none = await v.textContent('.sp-empty');
  await v.fill('.sp-search input', 'descalcifica'); await v.waitForSelector('.sp-hit'); await v.keyboard.press('Enter'); await v.waitForURL(PAGES + '/cafetera/cuidado/limpieza');
  const landed = await v.evaluate(() => ({ h1: document.querySelector('.sp-body h1').textContent, checks: document.querySelectorAll('.sp-check').length, on: document.querySelectorAll('.sp-check.sp-on').length, inputs: document.querySelectorAll('.sp-body input, .sp-body form, .sp-body button').length }));
  check('buscador: encuentra por el texto, sin acentos, y lleva a la página', hits.length === 1 && hits[0][0] === '/cafetera/cuidado/limpieza' && hits[0][1] === 'Limpieza' && /vinagre/.test(hits[0][2]) && none === 'Sin resultados' && landed.h1 === 'Limpieza', [hits, none, landed]);
  check('las tareas quedan dibujadas, sin controles de formulario en el contenido', landed.checks === 2 && landed.on === 1 && landed.inputs === 0, landed);
  check('nada choca con la política de contenido, no hay errores y no sale ningún pedido a otro lado', cspErrors.length === 0 && pageErrors.length === 0 && beyond.length === 0, [cspErrors, pageErrors, beyond]);
  await visit.close();

  // Sin JavaScript: el contenido, el menú y los enlaces están en el HTML.
  const plain = await R.browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
  const np = await plain.newPage(); await np.goto(PAGES + '/cafetera/guia');
  const noJs = { h1: await np.locator('.sp-body h1').textContent(), nav: await np.locator('.sp-nav a').count(), search: await np.locator('.sp-search').isVisible(), theme: await np.locator('.sp-theme').isVisible(), img: await np.locator('.sp-body .lmd-diagram img').isVisible(), foot: await np.locator('.sp-made').isVisible() };
  await np.click('.sp-next'); await np.waitForURL(PAGES + '/cafetera/cuidado/limpieza');
  check('sin JavaScript se lee y se navega igual; el buscador y el conmutador no se muestran', noJs.h1 === 'Guía de uso' && noJs.nav === 3 && noJs.search === false && noJs.theme === false && noJs.img === true && noJs.foot === true, noJs);
  await plain.close();

  // En teléfono: nada se sale del ancho, y el menú se abre y se cierra con su botón.
  const phoneCtx = await R.browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await phoneCtx.newPage(); await ph.goto(PAGES + '/cafetera/guia'); await ph.waitForSelector('.sp-search:not([hidden])');
  const phone = await ph.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: innerWidth, nav: getComputedStyle(document.querySelector('.sp-nav')).display, btn: getComputedStyle(document.querySelector('.sp-navb')).display, toc: document.querySelector('.sp-toc') ? getComputedStyle(document.querySelector('.sp-toc')).display : 'none', font: parseFloat(getComputedStyle(document.body).fontSize) }));
  await shot(ph, 'sitio-telefono');
  await ph.tap('.sp-navb'); await shot(ph, 'sitio-telefono-menu'); const opened = await ph.evaluate(() => getComputedStyle(document.querySelector('.sp-nav')).display);
  await ph.tap('.sp-nav a[href="/cafetera/"]'); await ph.waitForURL(PAGES + '/cafetera/');
  const phoneHome = await ph.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: innerWidth, nav: getComputedStyle(document.querySelector('.sp-nav')).display }));
  check('en teléfono no hay desplazamiento horizontal y la letra se lee', phone.wide <= phone.view && phoneHome.wide <= phoneHome.view && phone.font >= 16, [phone, phoneHome]);
  check('el menú está plegado, se abre con su botón y lleva a la página', phone.nav === 'none' && phone.btn !== 'none' && opened === 'block' && phoneHome.nav === 'none' && phone.toc === 'none', [phone, opened, phoneHome]);
  await phoneCtx.close();

  // ---------- Cambios sin publicar, y publicar de nuevo ----------
  console.log('Cambios sin publicar');
  await put(A, 'manual/guia.md', NOTES['manual/guia.md'].replace('93 grados', '96 grados'));
  await put(A, 'manual/recetas.md', '# Recetas\n\nUn cortado.\n');
  const pend1 = (await api('GET', '/sites/' + S.id, undefined, A.s)).json;
  const stale = await site('/cafetera/guia');
  check('lo que cambia por la API queda como cambio sin publicar: el sitio sigue con lo anterior', pend1.pending.changed.join() === 'manual/guia.md' && pend1.pending.added.join() === 'manual/recetas.md' && pend1.pending.removed.length === 0 && /93 grados/.test(stale.body) && (await site('/cafetera/recetas')).status === 404, pend1.pending);
  await put(A, 'manual/cuidado/limpieza.md', '---\npublish: false\n---\n# Limpieza\n\nYa no va.\n');
  const pend2 = (await api('GET', '/sites/' + S.id, undefined, A.s)).json;
  check('una nota que pasa a publish: false figura como página a quitar', pend2.pending.removed.join() === 'manual/cuidado/limpieza.md', pend2.pending);
  // Desde Ajustes > Nube: el sitio figura con su estado, y "Publish changes" sube solo lo que cambió.
  await ana.page.evaluate(() => document.querySelector('[data-act=settings]').click()); await ana.page.waitForSelector('.lmd-panel-card'); await ana.page.click('[data-ptab=cloud]');
  await ana.page.waitForSelector('.lmd-site-row [data-c=site]');
  const row = await ana.page.evaluate(() => { const r = document.querySelector('.lmd-site-row'); return { text: r.innerText, more: !!document.querySelector('[data-c=site-new]') }; });
  check('Ajustes > Nube muestra el sitio con su dirección y su estado; con un sitio por cuenta no ofrece otro', /Manual de la cafetera/.test(row.text) && row.text.includes(PH + '/cafetera/') && /Published/.test(row.text) && row.more === false, row);
  await ana.page.click('.lmd-site-row [data-c=site]'); await ana.page.waitForSelector('.lmd-site [data-site-state=warn]');
  const pendUi = await ana.page.evaluate(() => ({ state: document.querySelector('.lmd-site .lmd-site-state').textContent, list: document.querySelector('.lmd-site-pend').innerText, btn: document.querySelector('.lmd-site [data-st=publish]').textContent }));
  check('la ventana dice cuántos cambios faltan y cuáles', /3 unpublished changes/.test(pendUi.state) && /guia\.md/.test(pendUi.list) && /recetas\.md/.test(pendUi.list) && /cuidado\/limpieza\.md/.test(pendUi.list) && pendUi.btn === 'Publish changes', pendUi);
  const puts = []; ana.page.on('request', (r) => { if (/\/sites\/\d+\/pages$/.test(r.url()) && r.method() === 'PUT') puts.push(JSON.parse(r.postData()).pages.map((p) => p.note).join()); });
  await ana.page.click('.lmd-site [data-st=publish]'); await ana.page.waitForSelector('.lmd-site [data-site-state=ok]', { timeout: 60000 });
  const fresh = await site('/cafetera/guia'); const newPage = await site('/cafetera/recetas'); const gone = await site('/cafetera/cuidado/limpieza');
  check('"Publish changes" vuelve a dibujar solo lo que cambió y saca lo que ya no va', puts.sort().join('|') === 'manual/guia.md|manual/recetas.md' && /96 grados/.test(fresh.body) && newPage.status === 200 && gone.status === 404, [puts, newPage.status, gone.status]);
  check('y el menú del sitio queda al día', /<a href="\/cafetera\/recetas">Recetas<\/a>/.test(fresh.body) && !/limpieza/.test(fresh.body.slice(fresh.body.indexOf('<nav class="sp-nav"'), fresh.body.indexOf('</nav>'))), null);
  await ana.page.click('.lmd-site [data-st=close]'); await ana.page.keyboard.press('Escape');
  // Publicar al guardar: se edita la nota en la app y su página cambia sola.
  await ana.page.goto(R.noteUrl('manual/recetas.md', true)); await ana.page.waitForSelector('.lmd-article .lmd-editable');
  await ana.page.locator('.lmd-article .lmd-editable', { hasText: 'Un cortado' }).first().click(); await ana.page.keyboard.press('Control+End'); await ana.page.keyboard.type(' Y una lágrima.', { delay: 10 });
  await ana.page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  let auto = ''; for (let i = 0; i < 80 && !/lágrima/.test(auto); i++) { await sleep(250); auto = (await site('/cafetera/recetas')).body; }
  check('con "publicar al guardar", lo que se guarda desde la app llega solo a su página', /Un cortado\. Y una lágrima\./.test(auto), auto.slice(auto.indexOf('<article'), auto.indexOf('<article') + 300));
  // En un teléfono: la ventana del sitio entra en la pantalla, y sus campos se pueden tocar.
  const tel = await R.open(A, { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await tel.page.goto(R.noteUrl('manual/guia.md')); await tel.page.waitForSelector('.markdown-body h1');
  await tel.page.evaluate(() => document.querySelector('[data-act=settings]').click()); await tel.page.waitForSelector('.lmd-panel-card'); await tel.page.click('[data-ptab=cloud]');
  await tel.page.waitForSelector('.lmd-site-row [data-c=site]'); await tel.page.click('.lmd-site-row [data-c=site]'); await tel.page.waitForSelector('.lmd-site [data-site-state]');
  const fit = () => tel.page.evaluate(() => { const c = document.querySelector('.lmd-site'); const r = c.getBoundingClientRect(); const body = c.querySelector('.lmd-site-body'); const out = [...c.querySelectorAll('input, select, button, a, p, label')].filter((n) => n.offsetParent && (n.getBoundingClientRect().right > r.right + 1 || n.getBoundingClientRect().left < r.left - 1)).map((n) => n.tagName + ' ' + (n.textContent || n.value || '').slice(0, 30));
    return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), w: innerWidth, h: innerHeight, sideways: body.scrollWidth - body.clientWidth, out, fields: [...c.querySelectorAll('.lmd-site-field input, .lmd-site-field select')].map((n) => Math.round(n.getBoundingClientRect().height)), links: [...c.querySelectorAll('.lmd-site-more .lmd-link')].map((n) => Math.round(n.getBoundingClientRect().height)) }; });
  const telState = await fit(); await shot(tel.page, 'ventana-telefono');
  await tel.page.tap('.lmd-site [data-st=edit]'); await tel.page.waitForSelector('.lmd-site [data-f=slug]');
  const telForm = await fit(); await shot(tel.page, 'ventana-telefono-ajustes');
  check('en un teléfono la ventana del sitio entra en la pantalla, sin desbordar de costado', [telState, telForm].every((x) => x.left >= 0 && x.right <= x.w && x.bottom <= x.h && x.sideways <= 0 && !x.out.length), [telState, telForm]);
  check('y sus campos y enlaces tienen alto para el dedo', telForm.fields.length >= 8 && telForm.fields.every((h) => h >= 40) && telState.links.every((h) => h >= 40), [telForm.fields, telState.links]);
  await tel.ctx.close();
  // Una nota eliminada (queda en la papelera) deja de servirse en el acto, sin esperar a nadie.
  await api('DELETE', '/notes/' + enc('manual/recetas.md'), undefined, A.s);
  const trashed = await site('/cafetera/recetas'); const pend3 = (await api('GET', '/sites/' + S.id, undefined, A.s)).json;
  check('una nota eliminada sale del sitio en el acto: lo de la papelera no se publica', trashed.status === 404 && !/recetas/.test((await site('/cafetera/')).body) && (pend3.pending.removed.includes('manual/recetas.md') || pend3.pages === 2), [trashed.status, pend3.pending, pend3.pages]);

  // ---------- Topes y permisos de las rutas ----------
  console.log('Topes y permisos');
  const second = await api('POST', '/sites', { folder: 'otra', slug: 'segundo', title: 'Segundo' }, A.s);
  check('un sitio por cuenta: el segundo no se crea', second.status === 409 && second.json.error === 'site_limit', second.json);
  await put(X, 'notas/a.md', '# A');
  const taken = await api('POST', '/sites', { folder: 'notas', slug: 'cafetera', title: 'Copia' }, X.s);
  const xs = (await api('POST', '/sites', { folder: 'notas', slug: 'de-xime', title: 'De Xime' }, X.s)).json;
  check('una dirección en uso no se repite', taken.status === 409 && taken.json.error === 'slug_taken' && xs.slug === 'de-xime', [taken.json, xs]);
  const others = [await api('GET', '/sites/' + S.id, undefined, X.s), await api('PUT', '/sites/' + S.id, { title: 'Tomado' }, X.s), await api('PUT', '/sites/' + S.id + '/pages', { pages: [page('manual/index.md', 1, '<p>tomado</p>')] }, X.s),
    await api('POST', '/sites/' + S.id + '/publish', {}, X.s), await api('POST', '/sites/' + S.id + '/unpublish', {}, X.s), await api('DELETE', '/sites/' + S.id, undefined, X.s)];
  check('otra cuenta no ve ni toca un sitio ajeno: 404 en cada ruta', others.every((r) => r.status === 404) && /Manual de la cafetera/.test((await site('/cafetera/')).body), others.map((r) => r.status));
  const foreign = [await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('otra/afuera.md', 1, '<p>x</p>')] }, X.s), await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/../../manual/index.md', 1, '<p>x</p>')] }, X.s),
    await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/no-esta.md', 1, '<p>x</p>')] }, X.s), await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/a.md', 99, '<p>x</p>')] }, X.s), await api('PUT', '/sites/' + xs.id + '/pages', { pages: [] }, X.s)];
  check('solo se publican notas que existen dentro de la carpeta del sitio, con una revisión que existe', foreign.map((r) => r.status).join() === '400,400,404,400,400', foreign.map((r) => [r.status, r.json && r.json.error]));
  await put(X, 'notas/no.md', '---\npublish: false\n---\n# No');
  const excl = await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/no.md', 1, '<p>secreto del encabezado</p>')] }, X.s);
  check('el servidor no acepta la página de una nota con publish: false aunque se la manden', excl.status === 200 && excl.json.pages[0].excluded === true && (await api('GET', '/sites/' + xs.id, undefined, X.s)).json.pages === 0, excl.json);
  const empty = await api('POST', '/sites/' + xs.id + '/publish', {}, X.s);
  check('un sitio sin páginas no se publica', empty.status === 409 && empty.json.error === 'site_empty', empty.json);
  for (let i = 0; i < 9; i++) await put(X, 'notas/p' + i + '.md', '# P' + i);
  const fill = []; for (let i = 0; i < 9; i++) fill.push((await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/p' + i + '.md', 1, '<p>p' + i + '</p>')] }, X.s)).status);
  check('tope de páginas por sitio (8 en esta prueba): la novena no entra', fill.slice(0, 8).every((x) => x === 200) && fill[8] === 409, fill);
  const big = await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/p0.md', 1, '<p>' + 'x'.repeat(1600 * 1024) + '</p>')] }, X.s);
  check('tope de tamaño por página', big.status === 413, big.status);
  const tok = (await api('POST', '/tokens', { name: 'ia' }, A.s)).json.token;
  const viaToken = [await api('GET', '/sites', undefined, tok), await api('POST', '/sites/' + S.id + '/publish', {}, tok)];
  check('un token de IA no publica: las rutas de sitios piden la sesión de la cuenta', viaToken.every((r) => r.status === 401), viaToken.map((r) => r.status));
  const xPub = await api('POST', '/sites/' + xs.id + '/publish', {}, X.s);
  const noIdx = await api('PUT', '/sites/' + xs.id, { noindex: true, slug: 'xime-notas' }, X.s);
  const moved = [await site('/de-xime/'), await site('/xime-notas/')]; const nmap = await site('/xime-notas/sitemap.xml'); const nrob = await site('/xime-notas/robots.txt');
  check('"no indexar" pone noindex en la página y en la cabecera, y saca el sitemap; cambiar la dirección muda el sitio', xPub.status === 200 && noIdx.json.noindex === true && moved[0].status === 404 && moved[1].status === 302 && /p0$/.test(moved[1].headers.location) &&
    /<meta name="robots" content="noindex">/.test((await site('/xime-notas/p0')).body) && (await site('/xime-notas/p0')).headers['x-robots-tag'] === 'noindex' && nmap.status === 404 && /Disallow: \/xime-notas\//.test(nrob.body) && !(await site('/sitemap.xml')).body.includes('xime-notas'), [moved.map((m) => m.status), nmap.status, nrob.body]);

  // Ajustes de la página: una nota con toc: false se publica sin su lista de secciones.
  const HS = '<h2 id="uno">Uno</h2><p>a</p><h2 id="dos">Dos</h2><p>b</p>';
  const tocPut = await api('PUT', '/sites/' + xs.id + '/pages', { pages: [page('notas/p1.md', 1, HS), page('notas/p2.md', 1, HS, { toc: false })] }, X.s);
  await api('POST', '/sites/' + xs.id + '/publish', {}, X.s);
  const withToc = (await site('/xime-notas/p1')).body; const noToc = (await site('/xime-notas/p2')).body;
  check('una página con toc: false sale sin la lista "En esta página", con sus títulos en el cuerpo', tocPut.status === 200 && /<aside class="sp-toc"/.test(withToc) && !/<aside class="sp-toc"/.test(noToc) && /Uno/.test(noToc) && /Dos/.test(noToc) && /id="uno"/.test(noToc), [tocPut.status, /sp-toc"/.test(withToc), /sp-toc"/.test(noToc)]);

  // ---------- Denuncia ----------
  console.log('Denuncia');
  const rc = await R.browser.newContext({ viewport: { width: 1280, height: 800 } }); const rp = await rc.newPage(); const repErrors = [];
  rp.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) repErrors.push(m.text().slice(0, 200)); });
  await rp.goto(PAGES + '/cafetera/guia'); await rp.click('.sp-foot a[rel=nofollow]'); await rp.waitForSelector('.sp-report .sp-form:not([hidden])');
  const repPage = await rp.evaluate(() => ({ url: location.pathname + location.search, h1: document.querySelector('h1').textContent, which: document.querySelector('.sp-report code').textContent, forms: document.querySelectorAll('form').length, scripts: [...document.scripts].map((s) => s.getAttribute('src').split('?')[0]) }));
  await rp.click('.sp-btn'); const short = await rp.textContent('.sp-msg');
  await rp.fill('.sp-report textarea', 'Esta página copia mi manual entero.'); await rp.fill('.sp-report input', 'quien@ejemplo.test'); await rp.click('.sp-btn');
  await rp.waitForFunction(() => /Enviado/.test(document.querySelector('.sp-msg').textContent));
  for (let i = 0; i < 40 && !mails.some((m) => /report/.test(m.subject)); i++) await sleep(100);
  const mail = mails.find((m) => /report/.test(m.subject)) || {};
  check('el pie lleva a un formulario del propio host, sin <form> que salga y con el único script del host', repPage.url === '/_/report?s=cafetera&p=guia' && repPage.h1 === 'Denunciar este sitio' && repPage.which === PAGES + '/cafetera/guia' && repPage.forms === 0 && repPage.scripts.join() === '/_/site.js' && /pocas palabras/.test(short) && repErrors.length === 0, [repPage, short, repErrors]);
  check('la denuncia llega por el mismo correo que los comentarios, con kind "site", la dirección y el motivo', mail.to === 'avisos@ejemplo.test' && mail.subject === 'SharpMD report' && /Kind: site/.test(mail.text) && mail.text.includes('Reported note: ' + PAGES + '/cafetera/guia') && /copia mi manual/.test(mail.text) && mail.reply_to === 'quien@ejemplo.test' && /From: quien@ejemplo\.test\n/.test(mail.text), mail);
  await rc.close();
  const post = (body, headers) => site('/_/report', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
  const withSession = await post({ s: 'cafetera', p: '', text: 'con una sesión pegada' }, { authorization: 'Bearer ' + A.s, 'x-forwarded-for': '10.9.9.1' });
  for (let i = 0; i < 40 && !mails.some((m) => /sesión pegada/.test(m.text)); i++) await sleep(100);
  const anon = mails.find((m) => /sesión pegada/.test(m.text)) || { text: '' };
  check('el host de sitios no lee credenciales: una denuncia con una sesión llega como anónima', withSession.status === 200 && /From: anonymous\n/.test(anon.text) && !anon.text.includes('ana@ejemplo.test'), [withSession.status, anon.text]);
  const badRep = [await post({ s: 'no-existe', p: '', text: 'motivo largo' }, { 'x-forwarded-for': '10.9.9.2' }), await post({ s: 'cafetera', p: '', text: 'x' }, { 'x-forwarded-for': '10.9.9.2' }), await post({ s: 'cafetera', p: '../../x', text: 'motivo largo' }, { 'x-forwarded-for': '10.9.9.2' }),
    await post('s=cafetera&text=motivo+largo', { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.9.9.2' }), await post('{mal', { 'x-forwarded-for': '10.9.9.2' }), await post({ s: 'cafetera', p: '', text: 'y'.repeat(9000) }, { 'x-forwarded-for': '10.9.9.2' })];
  check('una denuncia mal armada, de un sitio que no existe o que no es JSON no entra', badRep.map((r) => r.status).join() === '404,400,404,415,400,413', badRep.map((r) => r.status));
  const flood = []; for (let i = 0; i < 7; i++) flood.push((await post({ s: 'cafetera', p: '', text: 'denuncia número ' + i }, { 'x-forwarded-for': '10.9.9.3' })).status);
  check('tope de denuncias por IP: cinco por hora', flood.slice(0, 5).every((x) => x === 200) && flood[5] === 429 && flood[6] === 429, flood);

  // ---------- Administración: suspender, restaurar, eliminar ----------
  console.log('Administración');
  const noKey = [await api('GET', '/admin/sites'), await api('GET', '/admin/sites', undefined, A.s), await api('POST', '/admin/sites', { slug: 'cafetera', action: 'suspend' }, A.s), await api('POST', '/admin/sites', { slug: 'cafetera', action: 'suspend' }, undefined, { 'x-admin-key': 'otra' })];
  check('sin la clave de administración no se listan ni se suspenden sitios', noKey.every((r) => r.status === 403) && (await site('/cafetera/')).status === 200, noKey.map((r) => r.status));
  const listed = (await admin('GET', undefined, '?status=reported')).json;
  const mine = listed.sites.find((s) => s.slug === 'cafetera');
  check('la lista de administración trae cada sitio con su cuenta, sus páginas y cuántas denuncias tiene', !!mine && mine.account === 'ana@ejemplo.test' && mine.reports >= 6 && mine.pages >= 2 && mine.live === true && mine.url === PAGES + '/cafetera/', listed);
  const held = await admin('POST', { slug: 'cafetera', action: 'suspend', reason: 'Copia un manual ajeno' });
  const down = [await site('/cafetera/'), await site('/cafetera/guia'), await site('/cafetera/search.json'), await site('/cafetera/sitemap.xml'), await site('/~' + S.preview.split('~')[1])];
  check('suspender baja el sitio en el acto: 451 con una página neutra, también en la vista previa', held.status === 200 && down.every((r) => r.status === 451) && !down.some((r) => /cafetera|Ana|93|96/.test(r.body)) && /Este sitio no está disponible/.test(down[0].body) && down[0].headers['x-robots-tag'] === 'noindex' && !(await site('/sitemap.xml')).body.includes('/cafetera/'), down.map((r) => r.status));
  const heldAcct = (await api('GET', '/account', undefined, A.s)).json.pages.sites[0];
  const heldOps = [await api('POST', '/sites/' + S.id + '/publish', {}, A.s), await api('PUT', '/sites/' + S.id + '/pages', { pages: [page('manual/index.md', 1, '<p>x</p>')] }, A.s), await api('DELETE', '/sites/' + S.id, undefined, A.s), await api('PUT', '/sites/' + S.id, { slug: 'cafetera-2' }, A.s)];
  check('quien lo publicó ve que está suspendido y por qué, y no puede publicarlo, eliminarlo ni cambiarle la dirección', heldAcct.suspended === true && heldAcct.reason === 'Copia un manual ajeno' && heldOps.every((r) => r.status === 403 && r.json.error === 'site_suspended'), [heldAcct, heldOps.map((r) => r.status)]);
  await ana.page.goto(R.noteUrl('manual/guia.md')); await ana.page.waitForSelector('.markdown-body h1');
  await ana.page.waitForFunction(() => /suspended/.test(document.querySelector('.lmd-foot .lmd-status').textContent), null, { timeout: 8000 }).catch(() => {});
  const toast = await ana.page.evaluate(() => /Your published site is suspended/.test(document.querySelector('.lmd-foot .lmd-status').textContent));
  await ana.page.evaluate(() => document.querySelector('[data-act=settings]').click()); await ana.page.waitForSelector('.lmd-panel-card'); await ana.page.click('[data-ptab=cloud]'); await ana.page.waitForSelector('.lmd-site-row');
  const heldRow = await ana.page.textContent('.lmd-site-row .lmd-site-state');
  check('la app avisa que el sitio está suspendido', toast === true && heldRow === 'Suspended', [toast, heldRow]);
  await ana.page.keyboard.press('Escape');
  const back = await admin('POST', { slug: 'cafetera', action: 'restore' });
  check('restaurar lo vuelve a servir como estaba', back.status === 200 && (await site('/cafetera/guia')).status === 200 && (await api('GET', '/account', undefined, A.s)).json.pages.sites[0].suspended === false, back.json);
  const gonex = await admin('POST', { slug: 'xime-notas', action: 'delete' });
  check('eliminar por administración borra el sitio y sus páginas', gonex.status === 200 && (await site('/xime-notas/p0')).status === 404 && (await api('GET', '/sites', undefined, X.s)).json.sites.length === 0, gonex.json);

  // ---------- Despublicar ----------
  console.log('Despublicar');
  const unp = await api('POST', '/sites/' + S.id + '/unpublish', {}, A.s);
  const after = [await site('/cafetera/'), await site('/cafetera/guia'), await site('/cafetera/search.json')];
  check('despublicar borra todo lo servido en el acto y deja la configuración', unp.status === 200 && unp.json.live === false && unp.json.pages === 0 && unp.json.title === 'Manual de la cafetera' && after.every((r) => r.status === 410) && /Este sitio ya no está publicado/.test(after[0].body) && !after.some((r) => /grados/.test(r.body)), [unp.json, after.map((r) => r.status)]);
  // Se vuelve a publicar a mano, para lo que sigue.
  const reput = await api('PUT', '/sites/' + S.id + '/pages', { pages: [page('manual/index.md', 1, '<h1>Manual</h1><p>De vuelta.</p>')] }, A.s); await api('POST', '/sites/' + S.id + '/publish', {}, A.s);
  check('y se puede volver a publicar', reput.status === 200 && (await site('/cafetera/')).status === 200, reput.json);

  // ---------- El plan ----------
  console.log('Baja de plan');
  await plan(A, 'free');
  const low = (await api('GET', '/account', undefined, A.s)).json.pages;
  const still = await site('/cafetera/');
  const lowOps = [await api('PUT', '/sites/' + S.id + '/pages', { pages: [page('manual/index.md', 1, '<p>x</p>')] }, A.s), await api('POST', '/sites/' + S.id + '/publish', {}, A.s)];
  check('al bajar al plan gratis el sitio sigue un tiempo, con la fecha en que se despublica a la vista', low.paid === false && low.sites[0].live === true && low.sites[0].lapsed > 0 && low.sites[0].ends > low.sites[0].lapsed && still.status === 200, low);
  check('pero ya no se puede publicar nada nuevo: 402', lowOps.every((r) => r.status === 402 && r.json.error === 'site_needs_plan'), lowOps.map((r) => r.status));
  await sleep(2700);
  const lapsedServe = await site('/cafetera/');
  const lapsed = (await api('GET', '/account', undefined, A.s)).json.pages.sites[0];
  check('pasado el margen se despublica solo: deja de servirse, se borran las páginas y queda la configuración', lapsedServe.status === 410 && lapsed.live === false && lapsed.pages === 0 && lapsed.title === 'Manual de la cafetera' && lapsed.slug === 'cafetera', [lapsedServe.status, lapsed]);
  await plan(A, 'pro');
  const paidAgain = (await api('GET', '/account', undefined, A.s)).json.pages.sites[0];
  await api('PUT', '/sites/' + S.id + '/pages', { pages: [page('manual/index.md', 1, '<h1>Manual</h1><p>Otra vez.</p>')] }, A.s); const repub = await api('POST', '/sites/' + S.id + '/publish', {}, A.s);
  check('con el plan pago de nuevo, el sitio se vuelve a publicar con la misma dirección', paidAgain.lapsed === 0 && repub.status === 200 && /Otra vez/.test((await site('/cafetera/')).body), [paidAgain, repub.status]);
  const delSite = await api('DELETE', '/sites/' + S.id, undefined, A.s);
  check('eliminar el sitio libera la dirección', delSite.status === 200 && (await site('/cafetera/')).status === 404 && (await api('GET', '/sites/slug?slug=cafetera', undefined, X.s)).json.ok === true, delSite.json);

  // Sin sitio, Ajustes > Nube ofrece publicar una carpeta: se elige entre las que no tienen contraseña.
  await ana.page.goto(R.noteUrl('manual/guia.md')); await ana.page.waitForSelector('.markdown-body h1');
  await ana.page.evaluate(() => document.querySelector('[data-act=settings]').click()); await ana.page.waitForSelector('.lmd-panel-card'); await ana.page.click('[data-ptab=cloud]');
  await ana.page.waitForSelector('[data-c=site-new]'); await ana.page.click('[data-c=site-new]'); await ana.page.waitForSelector('.lmd-site-pick [data-st=pick]');
  const picks = await ana.page.evaluate(() => [...document.querySelectorAll('.lmd-site-pick [data-st=pick]')].map((b) => b.dataset.folder));
  await ana.page.click('.lmd-site-pick [data-folder=otra]'); await ana.page.waitForSelector('.lmd-site [data-f=slug]');
  const picked = await ana.page.evaluate(() => ({ folder: document.querySelector('.lmd-site-folder').textContent.trim(), slug: document.querySelector('.lmd-site [data-f=slug]').value }));
  check('desde Ajustes se elige la carpeta a publicar, y las protegidas no figuran', picks.includes('manual') && picks.includes('otra') && picks.includes('manual/cuidado') && !picks.some((p) => /cofre/.test(p)) && picked.folder === 'otra/' && picked.slug === 'otra', [picks, picked]);
  await ana.page.click('.lmd-site [data-st=close]'); await ana.page.keyboard.press('Escape');
  // Con el plan gratis el menú lo ofrece igual, y la ventana dice que es del plan pago.
  const fede = await R.open(F); await fede.page.goto(R.noteUrl('manual/index.md')); await fede.page.waitForSelector('.markdown-body h1'); await fede.page.waitForSelector(CLOUD + ' .lmd-node-dir');
  await fede.page.locator(CLOUD + ' .lmd-node-dir', { hasText: 'manual' }).first().click({ button: 'right' }); await fede.page.waitForSelector('.lmd-menu [data-f=site]'); await fede.page.click('.lmd-menu [data-f=site]');
  await fede.page.waitForSelector('.lmd-site [data-st=plan]');
  const wall = await fede.page.evaluate(() => ({ text: document.querySelector('.lmd-site-body').innerText, pay: document.querySelector('.lmd-site [data-st=plan]').hasAttribute('data-pay'), form: !!document.querySelector('.lmd-site [data-f=slug]') }));
  check('con el plan gratis la ventana dice que publicar es del plan pago, sin formulario, y el botón a los planes se oculta en la app de la tienda', /Publishing a site is part of the paid plan\./.test(wall.text) && wall.pay === true && wall.form === false, wall);
  await fede.ctx.close();

  // ---------- Equipo ----------
  console.log('Equipo');
  const O = await R.signup('olga@ejemplo.test'); const M = await R.signup('mario@ejemplo.test'); const L = await R.signup('lola@ejemplo.test'); const N = await R.signup('nico@ejemplo.test');
  const team = (await api('POST', '/admin/team', { email: O.email, seats: 4 }, undefined, { 'x-admin-key': R.ADMIN })).json;
  await api('POST', '/team/invite', { email: M.email }, O.s); await api('POST', '/team/invite', { email: L.email, role: 'reader' }, O.s);
  for (const who of [M, L]) { const inv = (await api('GET', '/account', undefined, who.s)).json.team.invites[0]; await api('POST', '/team/accept', { id: inv.id }, who.s); }
  const space = (await api('GET', '/account', undefined, O.s)).json.team.mine.space;
  await put(O, 'wiki/index.md', '# Wiki del equipo\n\nBienvenida.', space); await put(O, 'wiki/reglas.md', '# Reglas\n\nUna sola.', space);
  const pol0 = (await api('GET', '/team/policies', undefined, M.s)).json;
  const mAcct0 = (await api('GET', '/account', undefined, M.s)).json;
  check('la política "publish" del equipo nace apagada: un miembro no publica carpetas del espacio', pol0.policies.publish === false && pol0.can.publish === false && mAcct0.pages.team === false && team.team > 0, [pol0, mAcct0.pages]);
  const mTry = await api('POST', '/sites', { o: space, folder: 'wiki', slug: 'wiki-equipo', title: 'Wiki' }, M.s);
  const outsider = await api('POST', '/sites', { o: space, folder: 'wiki', slug: 'wiki-equipo', title: 'Wiki' }, N.s);
  const reader0 = await api('POST', '/sites', { o: space, folder: 'wiki', slug: 'wiki-equipo', title: 'Wiki' }, L.s);
  check('sin la política: 403 team_policy para un miembro, read_only para quien solo lee, y no_access para alguien de afuera', mTry.status === 403 && mTry.json.error === 'team_policy' && reader0.status === 403 && reader0.json.error === 'read_only' && outsider.status === 403 && outsider.json.error === 'no_access', [mTry.json, reader0.json, outsider.json]);
  const oSite = (await api('POST', '/sites', { o: space, folder: 'wiki', slug: 'wiki-equipo', title: 'Wiki del equipo' }, O.s));
  check('quien administra el equipo puede siempre', oSite.status === 200 && oSite.json.team === true && oSite.json.o === space && oSite.json.can === true, oSite.json);
  const T1 = oSite.json;
  const mBlocked = [await api('PUT', '/sites/' + T1.id + '/pages', { pages: [page('wiki/index.md', 1, '<h1>Wiki</h1>')] }, M.s), await api('POST', '/sites/' + T1.id + '/publish', {}, M.s), await api('POST', '/sites/' + T1.id + '/unpublish', {}, M.s), await api('DELETE', '/sites/' + T1.id, undefined, M.s), await api('PUT', '/sites/' + T1.id, { title: 'x' }, M.s)];
  const mSees = await api('GET', '/sites/' + T1.id, undefined, M.s);
  check('un miembro sin la política ve el sitio del equipo pero no lo toca', mBlocked.every((r) => r.status === 403 && r.json.error === 'team_policy') && mSees.status === 200 && mSees.json.can === false, [mBlocked.map((r) => r.status), mSees.json.can]);
  await api('PUT', '/team/policies', { publish: true }, O.s);
  const mPut = await api('PUT', '/sites/' + T1.id + '/pages', { pages: [page('wiki/index.md', 1, '<h1>Wiki del equipo</h1><p>Bienvenida. <a href="reglas.md">Reglas</a></p>'), page('wiki/reglas.md', 1, '<h1>Reglas</h1><p>Una sola.</p>')] }, M.s);
  const mPub = await api('POST', '/sites/' + T1.id + '/publish', {}, M.s);
  const lStill = [await api('PUT', '/sites/' + T1.id + '/pages', { pages: [page('wiki/index.md', 1, '<p>x</p>')] }, L.s), await api('POST', '/sites/' + T1.id + '/unpublish', {}, L.s)];
  const tHome = await site('/wiki-equipo/');
  check('con la política prendida un miembro publica el sitio del equipo; quien solo lee sigue sin poder', mPut.status === 200 && mPub.status === 200 && (await api('GET', '/account', undefined, M.s)).json.pages.team === true && lStill.every((r) => r.status === 403 && r.json.error === 'read_only') && tHome.status === 200 && /<a href="\/wiki-equipo\/reglas">Reglas<\/a>/.test(tHome.body), [mPut.status, mPub.json, lStill.map((r) => r.status)]);
  check('en el sitio del equipo no figura el correo de nadie del equipo', ![O, M, L].some((w) => tHome.body.includes(w.email)) && !/team:/.test(tHome.body), null);
  const log = (await api('GET', '/team/log', undefined, O.s)).json.entries;
  const acts = log.filter((e) => ['site', 'publish', 'policy'].includes(e.action)).map((e) => [e.action, e.who, e.path, e.detail]);
  check('queda en el registro de actividad quién preparó y quién publicó el sitio, y el cambio de política', acts.some((a) => a[0] === 'publish' && a[1] === M.email && a[2] === 'wiki' && /wiki-equipo/.test(a[3])) && acts.some((a) => a[0] === 'site' && a[1] === O.email) && acts.some((a) => a[0] === 'policy' && /publish/.test(a[3])), acts);
  await api('PUT', '/team/policies', { publish: false }, O.s);
  const mAfter = await api('POST', '/sites/' + T1.id + '/unpublish', {}, M.s);
  check('apagar la política le saca el permiso en el acto', mAfter.status === 403 && mAfter.json.error === 'team_policy' && (await site('/wiki-equipo/')).status === 200, mAfter.json);
  // El espacio pasa a tener contraseña: deja de servirse, se borra lo publicado y no se puede volver a publicar.
  const b64 = (n) => Buffer.alloc(n, 5).toString('base64');
  const prot = await api('POST', '/team/vault', { salt: b64(16), iters: 200000, wrapped: b64(60), check: b64(32) }, O.s);
  const tGone = await site('/wiki-equipo/');
  const tOps = [await api('POST', '/sites/' + T1.id + '/publish', {}, O.s), await api('PUT', '/sites/' + T1.id + '/pages', { pages: [page('wiki/index.md', 1, '<p>x</p>')] }, O.s)];
  const tLeft = (await api('GET', '/sites/' + T1.id, undefined, O.s)).json;
  check('un espacio protegido con contraseña no se publica: lo publicado se borra y publicar responde 409', prot.status === 200 && tGone.status === 410 && tOps.every((r) => r.status === 409 && r.json.error === 'vault') && tLeft.pages === 0 && tLeft.live === false && (await api('GET', '/account', undefined, O.s)).json.pages.team === false, [prot.status, tGone.status, tOps.map((r) => [r.status, r.json]), tLeft.pages]);

  check('el servidor no anotó ningún error', !/error 500|error no capturado|promesa sin atender|sitios: error/.test(R.log()), (R.log().match(/error[^\n]*/g) || []).slice(0, 4));
  check('la app no tiró errores y nada salió hacia la nube de verdad', R.errors.length === 0 && R.outside.length === 0, [R.errors.slice(0, 3), R.outside.slice(0, 3)]);
} catch (e) { check('la prueba corrió hasta el final', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }

const bad = done();
await R.close(); fakeMail.close();
process.exit(bad ? 1 : 0);
