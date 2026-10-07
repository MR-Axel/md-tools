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
const dlg = async (tag) => { const t = await app.evaluate(() => { const d = document.querySelector('.lmd-dlg'); return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 160) : ''; }); if (t) { console.log('  (diálogo en ' + tag + ': ' + t + ')'); await app.keyboard.press('Escape'); await app.waitForTimeout(300); } };
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
await app.waitForTimeout(500); o.tocar = await scan(); for (let i = 0; i < 4; i++) await dlg('tocar');
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
  ['ninguna carga abre un diálogo del navegador', dialogs.length === 0, dialogs],
  ['no sale ningún pedido a otro servidor que no sea una imagen', odd.length === 0, odd],
  ['no navega fuera de la app', new URL(o.url1).protocol === 'chrome-extension:' && new URL(app.url()).protocol === 'chrome-extension:', [o.url1, app.url()]],
];
console.log('Markdown hostil');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 500))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
