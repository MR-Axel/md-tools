// La guía que viaja con la app (src/guide/en y src/guide/es): notas de solo lectura que explican cómo se usa.
// Primero, sin navegador: las dos carpetas tienen las mismas notas, la lista de content.js coincide, cada enlace
// interno lleva a un archivo que existe, cada rótulo en negrita es un texto de la app, la referencia de la API está
// al día y nada de la guía entra en la carga inicial. Después, en la app web: la raíz "Guía" se ve cuando la persona
// no tiene nada y se va cuando ya tiene una nota, el enlace del inicio la abre siempre, en inglés y en español, no
// se edita ni se guarda encima, los enlaces navegan dentro de la guía, las tareas, el diagrama y el tablero se
// dibujan, se puede llevar una copia, y abre sin conexión después de la primera visita. Al final, en la extensión.
// ONLY=static corre solo la primera parte.
import fs from 'fs'; import http from 'http'; import os from 'os'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const J = (v) => JSON.stringify(v);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const LANGS = ['en', 'es'];

// ---------- Sin navegador ----------
console.log('La guía: las notas');
const content = read('src/content.js');
const GUIDE = [...(/const GUIDE = \[([\s\S]*?)\n {2}\];/.exec(content) || ['', ''])[1].matchAll(/\['([a-z0-9-]+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
const files = Object.fromEntries(LANGS.map((l) => [l, fs.readdirSync(path.join(root, 'src', 'guide', l)).sort()]));
const text = (lang, file) => read('src/guide/' + lang + '/' + file);
// El diccionario de la app, para saber cómo se llama cada cosa en inglés.
const self = {}; vm.runInNewContext(read('src/defaults.js'), { self, navigator: { userAgent: '', language: 'en' } });
const LMD = self.LMD; const toEn = (s) => { LMD.setLang('en'); return LMD.t(s); };
// Lo que no es texto corrido: los bloques de código y lo que va entre acentos graves.
const prose = (md) => md.replace(/<!--[\s\S]*?-->/g, '').replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');
const h1 = (md) => (/^# (.+)$/m.exec(md) || [])[1] || '';

check('entre 10 y 16 notas, las mismas en los dos idiomas, y solo Markdown', files.en.length >= 10 && files.en.length <= 16 && J(files.en) === J(files.es) && files.en.every((f) => /^[a-z0-9-]+\.md$/.test(f)), files);
check('la lista de la app (GUIDE en content.js) nombra esas notas, ni una más ni una menos', GUIDE.length === files.en.length && J(GUIDE.map((g) => g[0] + '.md').sort()) === J(files.en), GUIDE.map((g) => g[0]));
const titles = GUIDE.map((g) => ({ id: g[0], es: h1(text('es', g[0] + '.md')), en: h1(text('en', g[0] + '.md')), list: g[1], listEn: toEn(g[1]) }));
check('el título de cada nota es el que muestra el explorador, en español y en inglés', titles.every((t) => t.es === t.list && t.en === t.listEn && t.en !== t.es), titles.filter((t) => t.es !== t.list || t.en !== t.listEn || t.en === t.es));
check('la guía empieza por start.md, que enlaza a todas las demás', GUIDE[0][0] === 'start' && LANGS.every((l) => GUIDE.slice(1).every((g) => text(l, 'start.md').includes('[[' + g[0] + '|'))));

// Los enlaces internos: [texto](nota.md#seccion) y [[nota|texto]]. Lo que apunta afuera es https o un correo.
const links = (md) => {
  const p = prose(md); const out = [];
  for (const m of p.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.push({ kind: 'wiki', to: m[1].trim() + '.md' });
  for (const m of p.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) out.push(/^(https?:|mailto:)/.test(m[1]) ? { kind: 'out', to: m[1] } : { kind: 'rel', to: m[1].split('#')[0] });
  return out;
};
const broken = []; const outside = new Set(); let inner = 0;
for (const l of LANGS) for (const f of files[l]) for (const k of links(text(l, f))) {
  if (k.kind === 'out') { outside.add(k.to); continue; }
  inner++;
  if (!k.to || /[\\/]/.test(k.to) || !files[l].includes(k.to)) broken.push(l + '/' + f + ' -> ' + k.to);
}
check('cada enlace interno lleva a una nota que existe, en los dos idiomas', inner > 60 && !broken.length, broken);
check('se usan las dos formas de enlazar: [[nombre]] y la ruta relativa', LANGS.every((l) => files[l].some((f) => links(text(l, f)).some((k) => k.kind === 'wiki')) && files[l].some((f) => links(text(l, f)).some((k) => k.kind === 'rel'))));
check('cada nota es alcanzable desde otra y lleva a otra', LANGS.every((l) => files[l].every((f) => links(text(l, f)).some((k) => k.kind !== 'out') && files[l].some((g) => g !== f && links(text(l, g)).some((k) => k.to === f)))));
check('hacia afuera solo se enlaza a sharpmd.app', [...outside].every((u) => /^https:\/\/sharpmd\.app\//.test(u)), [...outside]);
check('la nota de privacidad son dos párrafos y el enlace a la página', LANGS.every((l) => { const t = text(l, 'privacy.md'); return t.includes('](https://sharpmd.app/privacy.html)') && t.split('\n\n').filter((b) => b.trim() && !/^#/.test(b)).length === 4; }));

// Las notas usan lo que explican.
const uses = (re) => LANGS.every((l) => files[l].some((f) => re.test(text(l, f))));
check('hay una nota con tareas, una con un diagrama, una con una tabla, una con una fórmula, una con avisos y una con un tablero',
  uses(/^- \[ \] /m) && uses(/^```mermaid$/m) && uses(/^\|---/m) && uses(/^\$\$$/m) && uses(/^> \[!(NOTE|TIP|WARNING|IMPORTANT)\]$/m) && uses(/^::: warning$/m) && uses(/^```kanban$/m));

// Las dos versiones de una nota tienen la misma forma: los mismos títulos, bloques, enlaces y rótulos, en el mismo orden.
const bold = (md) => [...prose(md).matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => m[1]);
const shape = (md) => ({ heads: (md.match(/^#{1,4} /gm) || []).map((h) => h.length).join(''), fences: (md.match(/^`{3,}\w*$/gm) || []).join(' '), links: links(md).map((k) => k.to).join(' '),
  rows: (md.match(/^\|/gm) || []).length, items: (md.match(/^(- |\d+\. )/gm) || []).length, bold: bold(md).length, code: (prose(md.replace(/`[^`\n]*`/g, '`x`')).match(/`x`/g) || []).length });
const uneven = files.en.filter((f) => J(shape(text('en', f))) !== J(shape(text('es', f))));
check('cada nota tiene la misma forma en los dos idiomas', !uneven.length, uneven.map((f) => [f, shape(text('en', f)), shape(text('es', f))]));

// Lo que va en negrita es el nombre de algo de la app: tiene que existir tal cual en su código, y su par en inglés
// tiene que ser el del diccionario. Así la guía no nombra un botón que no está, ni lo traduce a su manera.
const SRC = fs.readdirSync(path.join(root, 'src')).filter((f) => /\.js$/.test(f)).map((f) => read('src/' + f)).join('\n');
const inApp = (s) => SRC.includes("'" + s + "'") || SRC.includes('"' + s + '"') || SRC.includes("'" + s.replace(/'/g, "\\'") + "'");
const lost = []; const mistold = [];
for (const f of files.es) {
  const es = bold(text('es', f)); const en = bold(text('en', f));
  es.forEach((label, i) => { if (!inApp(label)) lost.push(f + ': ' + label); else if (en[i] !== toEn(label)) mistold.push(f + ': ' + label + ' -> ' + en[i] + ' (' + toEn(label) + ')'); });
}
check('cada rótulo en negrita es un texto de la app', bold(text('es', 'start.md')).length >= 4 && !lost.length, lost);
check('y en inglés se llama como lo llama la app', !mistold.length, mistold);
// Los atajos que nombra la guía están en la tabla de atajos de la app.
const KEYS = [...read('src/shortcuts.js').matchAll(/^\s+\['[a-z-]+', '[a-z]+', '([^']+)'/gm)].flatMap((m) => m[1].split(' / '));
const told = [...new Set(LANGS.flatMap((l) => files[l].flatMap((f) => [...text(l, f).matchAll(/`((?:Ctrl|Alt|Shift)\+[^`]+|F2|Esc|Enter|Tab)`/g)].map((m) => m[1].replace('↑', 'Up').replace('↓', 'Down')))))];
check('cada atajo que nombra la guía está en la hoja de atajos de la app', told.length > 20 && told.every((k) => KEYS.includes(k)), told.filter((k) => !KEYS.includes(k)));
// Las herramientas de MCP y los eventos que nombra existen en el servidor.
const server = read('server/server.mjs'); const api = JSON.parse(read('server/openapi.json'));
const mcpTold = [...new Set([...text('en', 'connect-your-ai.md').matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]))];
check('cada herramienta de MCP que nombra la guía existe en el servidor, y están todas', mcpTold.length === 30 && mcpTold.every((n) => server.includes("name: '" + n + "'")) && (server.match(/name: '[a-z_]+', description/g) || []).length === 30, mcpTold.filter((n) => !server.includes("name: '" + n + "'")));
const events = api.components.schemas.Event.properties.type.enum.filter((e) => e !== 'ping');
check('y los eventos de los webhooks son los del servidor', LANGS.every((l) => events.every((e) => text(l, 'automations.md').includes('`' + e + '`')) && (text(l, 'automations.md').match(/`(note|comment|card)\.[a-z]+`/g) || []).length === events.length), events);

// La voz: frases llanas. Sin signos de admiración, sin rayas largas, sin emojis y sin correos que no sean el de contacto.
const loud = [];
for (const l of LANGS) for (const f of files[l]) {
  const p = prose(text(l, f)).replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g, '');
  if (/[!¡]/.test(p)) loud.push(l + '/' + f + ': !');
  if (/[–—]/.test(text(l, f))) loud.push(l + '/' + f + ': raya');
  if (/\p{Extended_Pictographic}/u.test(text(l, f).replace(/[⌘⌥↑↓]/g, ''))) loud.push(l + '/' + f + ': emoji');
  if ((text(l, f).match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) || []).some((m) => m !== 'hello@sharpmd.app')) loud.push(l + '/' + f + ': correo');
}
check('sin signos de admiración, rayas largas ni emojis, y sin más correo que hello@sharpmd.app', !loud.length, loud);
const TUTEO = /\b(puedes|tienes|quieres|prefieres|haz clic|escribe tu|abre tu)\b/i;
check('el español vosea', /\bAbrís\b/.test(text('es', 'start.md')) && !files.es.some((f) => TUTEO.test(prose(text('es', f)))), files.es.filter((f) => TUTEO.test(prose(text('es', f)))));
// Los números que cambian se dicen una sola vez: el tope del plan gratis, y ningún precio.
const said = (re) => files.es.filter((f) => re.test(text('es', f))).length;
check('el tope del plan gratis se dice en una sola nota y los precios en ninguna', said(/\b25 notas\b/) === 1 && files.en.filter((f) => /\b25 notes\b/.test(text('en', f))).length === 1 && !LANGS.some((l) => files[l].some((f) => /USD|\$\s?\d|\bdólares\b/.test(prose(text(l, f).replace(/\$[^$\n]+\$/g, ''))))));

console.log('La guía: la referencia de la API y cómo viaja');
{
  const { build, block } = await import('../tools/build-guide.mjs');
  check('la referencia de la API está al día con server/openapi.json (node tools/build-guide.mjs)', J(build(true)) === '[]', build(true));
  const ops = Object.values(api.paths).reduce((n, o) => n + Object.keys(o).length, 0);
  const rows = (lang) => (block(lang, api).match(/^\| `[A-Z]+ \//gm) || []).length;
  check('lista cada pedido de la API, en los dos idiomas, y enlaza la página completa', ops > 20 && rows('en') === ops && rows('es') === ops && LANGS.every((l) => text(l, 'api.md').includes('](https://sharpmd.app/api.html)') && text(l, 'api.md').includes(block(l, api))), [ops, rows('en'), rows('es')]);
  check('la página pública de la API sigue en su lugar', fs.existsSync(path.join(root, 'api.html')) && /href="api\.html"/.test(read('tools/landing.src.html')));
  // No agranda la carga inicial: ni la página ni las listas del service worker nombran la guía; se guarda al usarla,
  // porque el service worker atiende todo lo que cuelga de src/.
  const sw = read('sw.js'); const lists = /const SHELL = \[[\s\S]*?\];[\s\S]*?const LATE = \[[\s\S]*?\];/.exec(sw)[0];
  check('la guía no está en la página ni en las listas del service worker: se pide al abrirla y se guarda al usarla', !/guide/.test(read('src/app.html')) && !/guide/.test(lists) && sw.includes("/^(src|vendor|icons)\\//.test(path)") && /const text = \(await res\.text\(\)\)/.test(content));
  // En la extensión va dentro del paquete y la lee su propia página: no hace falta abrir nada a otros sitios.
  const attrs = read('.gitattributes'); const manifest = JSON.parse(read('manifest.json'));
  check('en la extensión va dentro del paquete, sin abrir nada más a otros sitios', !/^\/src/m.test(attrs) && /^\/tools\/ export-ignore$/m.test(attrs) && manifest.web_accessible_resources.length === 2 && !J(manifest.web_accessible_resources).includes('guide'));
  const size = LANGS.map((l) => files[l].reduce((n, f) => n + fs.statSync(path.join(root, 'src', 'guide', l, f)).size, 0));
  check('las notas son cortas: cada idioma entero pesa menos de 60 KB', size.every((n) => n > 8000 && n < 60000), size);
}

if (process.env.ONLY === 'static') { const bad = results.filter((r) => !r.ok); console.log('\n' + (results.length - bad.length) + '/' + results.length + ' pruebas correctas'); process.exit(bad.length ? 1 : 0); }

// ---------- En la app web ----------
const { chromium } = await import('playwright-core');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown' };
const hits = [];
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  hits.push(rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
const errors = []; const outsideHits = [];
// Un navegador nuevo, sin nada guardado. lang: el idioma elegido en la portada (en la web, "automático" lo sigue).
const open = async (lang, opt) => {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'en-US', serviceWorkers: 'block' }, opt || {}));
  await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => { outsideHits.push(r.request().url()); return r.abort(); });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  if (lang) await ctx.addInitScript((l) => { try { localStorage.setItem('mdtools:site-lang', l); } catch (e) { /* sin almacenamiento */ } }, lang);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
};
const guideHits = (from) => hits.slice(from || 0).filter((h) => h.startsWith('/src/guide/'));
const tree = (page) => page.evaluate(() => ({
  roots: [...document.querySelectorAll('.lmd-xroot')].map((s) => s.dataset.root),
  name: (document.querySelector('.lmd-xroot[data-root=guide] .lmd-tree-path') || {}).textContent || '',
  nodes: [...document.querySelectorAll('.lmd-xroot[data-root=guide] .lmd-node .lmd-node-name')].map((n) => n.textContent),
  add: !!document.querySelector('.lmd-xroot[data-root=guide] .lmd-tree-new'),
}));
const doc = (page) => page.evaluate(() => { const root = document.documentElement; const vis = (q) => { const n = document.querySelector(q); return !!(n && n.offsetParent); }; return {
  f: new URLSearchParams(location.search).get('f'), h1: (document.querySelector('.lmd-article h1') || {}).textContent || '', name: document.querySelector('.lmd-docname').textContent, title: document.title,
  guide: root.classList.contains('lmd-guide'), ro: root.classList.contains('lmd-readonly'), editing: root.classList.contains('lmd-editing'),
  mode: vis('.lmd-modeseg'), insert: vis('.lmd-insert'), save: vis('.lmd-save'), state: document.querySelector('.lmd-savestate').textContent, copy: vis('.lmd-guide-copy'), copyText: document.querySelector('.lmd-guide-copy').textContent,
  active: (document.querySelector('.lmd-xroot[data-root=guide] .lmd-node.lmd-active .lmd-node-name') || {}).textContent || '',
}; });
const opened = (page, title) => page.waitForFunction((t) => (document.querySelector('.lmd-article h1') || {}).textContent === t, title, { timeout: 15000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// El explorador se dibuja después de la nota: se espera a que marque la nota abierta dentro de la guía.
const marked = (page) => page.waitForSelector('.lmd-xroot[data-root=guide] .lmd-node.lmd-active', { timeout: 10000 }).catch(() => {});

try {
  console.log('La primera vez, sin nada propio (inglés)');
  {
    const { ctx, page } = await open();
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]'); await page.waitForSelector('.lmd-xroot[data-root=guide] .lmd-node');
    let t = await tree(page);
    check('el explorador muestra la raíz "Guide" al final, con sus notas por título y en orden', t.roots[t.roots.length - 1] === 'guide' && t.roots.includes('local') && t.name === 'Guide' && J(t.nodes) === J(GUIDE.map((g) => toEn(g[1]))) && !t.add, t);
    const link = await page.evaluate(() => { const a = document.querySelector('.lmd-home [data-home=guide]'); return a ? { text: a.textContent, f: new URL(a.href).searchParams.get('f'), path: new URL(a.href).pathname, tag: a.tagName } : null; });
    check('el inicio tiene el enlace "See how it works", con dirección propia', link && link.text === 'See how it works' && link.f === 'guide/start.md' && link.path === '/src/app.html' && link.tag === 'A', link);
    check('hasta acá no se pidió ningún archivo de la guía', guideHits().length === 0, guideHits());
    const mark = hits.length;
    await page.click('.lmd-home [data-home=guide]'); await opened(page, 'Start here');
    let d = await doc(page);
    check('el enlace abre la primera nota sin recargar, en inglés y con su dirección', d.f === 'guide/start.md' && d.name === 'Start here' && d.title === 'Start here' && d.active === 'Start here' && guideHits(mark)[0] === '/src/guide/en/start.md' && !hits.slice(mark).includes('/src/app.html'), [d, guideHits(mark)]);
    check('es de solo lectura: sin ver/editar, sin insertar, sin guardar, y el pie lo dice y ofrece una copia', d.guide && d.ro && !d.editing && !d.mode && !d.insert && !d.save && d.state === 'Guide · read only' && d.copy && d.copyText === 'Save a copy', d);
    // Las tareas se dibujan, y marcar una no cambia nada.
    const tasks = await page.evaluate(() => [...document.querySelectorAll('.lmd-article input.lmd-task')].map((b) => b.checked));
    await page.click('.lmd-article input.lmd-task >> nth=1'); await wait(250);
    await page.dblclick('.lmd-article p >> nth=0'); await wait(250);
    await page.keyboard.press('Control+s'); await wait(250);
    const after = await page.evaluate(() => ({ tasks: [...document.querySelectorAll('.lmd-article input.lmd-task')].map((b) => b.checked), editable: !!document.querySelector('.lmd-article [contenteditable=true]') }));
    d = await doc(page);
    check('las tareas se dibujan; marcar una, hacer doble clic o Ctrl+S no la cambian ni la ponen a editar', tasks.length === 6 && tasks[0] && !tasks[1] && J(after.tasks) === J(tasks) && !after.editable && !d.editing && d.state === 'Guide · read only' && !d.save, [tasks, after, d]);
    const notes = await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.open('lmd-permisos'); r.onsuccess = () => { try { const q = r.result.transaction('h').objectStore('h').getAll(); q.onsuccess = () => resolve(q.result.length); q.onerror = () => resolve(-1); } catch (e) { resolve(0); } }; r.onerror = () => resolve(-1); }));
    check('leer la guía no guarda nada entre las notas de la persona', notes === 0, notes);
    const wiki = await page.evaluate(() => ({ all: document.querySelectorAll('.lmd-article a.lmd-wiki').length, missing: document.querySelectorAll('.lmd-article a.lmd-wiki-missing').length }));
    check('los [[enlaces]] de la primera nota encuentran su nota', wiki.all === GUIDE.length - 1 && wiki.missing === 0, wiki);
    // Con una nota abierta, las demás se van pidiendo por detrás: quedan guardadas para leer sin conexión.
    for (let i = 0; i < 60 && guideHits(mark).length < GUIDE.length; i++) await wait(100);
    check('con la primera nota abierta se piden las demás, todas del mismo idioma y una sola vez', guideHits(mark).length === GUIDE.length && guideHits(mark).every((h) => h.startsWith('/src/guide/en/')) && new Set(guideHits(mark)).size === GUIDE.length, guideHits(mark));

    console.log('Navegar dentro de la guía');
    await page.click('.lmd-article a.lmd-wiki:text-is("Diagrams and formulas")'); await opened(page, 'Diagrams and formulas');
    await page.waitForSelector('.lmd-article pre.lmd-mermaid svg, .lmd-article .lmd-diagram svg', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('.lmd-article .katex', { timeout: 30000 }).catch(() => {});
    d = await doc(page);
    const drawn = await page.evaluate(() => ({ svg: document.querySelectorAll('.lmd-article svg[id^="lmd-mermaid-"]').length, nodes: document.querySelectorAll('.lmd-article svg[id^="lmd-mermaid-"] g.node').length, katex: document.querySelectorAll('.lmd-article .katex').length, block: document.querySelectorAll('.lmd-article .katex-display').length, err: document.querySelectorAll('.lmd-article .lmd-diagram-error, .lmd-article .katex-error').length }));
    check('un [[enlace]] lleva a otra nota de la guía, que sigue de solo lectura', d.f === 'guide/diagrams-and-formulas.md' && d.guide && d.ro && d.active === 'Diagrams and formulas' && !d.mode, d);
    check('ahí el diagrama y las fórmulas se dibujan', drawn.svg === 1 && drawn.nodes === 4 && drawn.katex >= 2 && drawn.block === 1 && drawn.err === 0, drawn);
    await page.click('.lmd-article a:text-is("Tools and plugins")'); await opened(page, 'Tools and plugins');
    d = await doc(page);
    const table = await page.evaluate(() => document.querySelectorAll('.lmd-article table tbody tr').length);
    check('un enlace relativo también, y la tabla de herramientas se dibuja', d.f === 'guide/tools-and-plugins.md' && d.guide && table === 13, [d, table]);
    await page.goBack(); await opened(page, 'Diagrams and formulas');
    await page.goBack(); await opened(page, 'Start here');
    check('atrás vuelve por las notas visitadas', (await doc(page)).f === 'guide/start.md');
    await page.click('.lmd-xroot[data-root=guide] .lmd-node:has-text("Kanban board")'); await opened(page, 'Kanban board');
    await page.waitForSelector('.lmd-article .lmd-board', { timeout: 15000 }).catch(() => {});
    const board = await page.evaluate(() => ({ boards: document.querySelectorAll('.lmd-article .lmd-board').length, cards: document.querySelectorAll('.lmd-article .lmd-board .lmd-card').length, drag: [...document.querySelectorAll('.lmd-article .lmd-board .lmd-card')].some((c) => c.draggable) }));
    check('desde el explorador se abre cualquier nota; el tablero se dibuja y sus tarjetas no se arrastran', (await doc(page)).f === 'guide/boards.md' && board.boards === 1 && board.cards === 4 && !board.drag, board);
    await page.click('.lmd-xroot[data-root=guide] .lmd-node:has-text("Reading and editing")'); await opened(page, 'Reading and editing');
    const boxes = await page.evaluate(() => ({ alerts: document.querySelectorAll('.lmd-article .lmd-alert').length, box: document.querySelectorAll('.lmd-article .lmd-box-warning').length }));
    check('y los avisos de la nota de lectura y edición se dibujan', boxes.alerts === 2 && boxes.box === 1, boxes);
    // El menú del explorador no ofrece renombrar ni eliminar una nota de la guía.
    await page.click('.lmd-xroot[data-root=guide] .lmd-node:has-text("Privacy")', { button: 'right' }); await wait(300);
    check('el clic derecho sobre una nota de la guía no ofrece renombrarla ni eliminarla', !(await page.locator('.lmd-menu [data-f=ren], .lmd-menu [data-f=del], .lmd-menu [data-f=send]').count()));
    await page.keyboard.press('Escape');

    console.log('Compartir la dirección y llevarse una copia');
    await page.click('[data-act=copy]'); await page.click('.lmd-menu-copy [data-more=copy-link]');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('"Link to the note" copia la dirección de esa nota en la app', copied === home + '?f=' + encodeURIComponent('guide/reading-and-editing.md'), copied);
    const direct = await ctx.newPage(); await direct.goto(copied); await opened(direct, 'Reading and editing'); await marked(direct);
    const dd = await doc(direct); const dt = await tree(direct);
    check('esa dirección abre la nota directo, de solo lectura y con la guía en el explorador', dd.guide && dd.ro && dd.active === 'Reading and editing' && dt.roots.includes('guide'), [dd, dt.roots]);
    await direct.goto(home + '?f=' + encodeURIComponent('guide/no-existe.md')); await direct.waitForSelector('.lmd-home-msg:not([hidden])');
    check('una nota que la guía no tiene dice que no se encontró, sin romper nada', /no-existe\.md/.test(await direct.textContent('.lmd-home-msg')) && !(await doc(direct)).guide);
    await direct.close();
    await page.click('.lmd-guide-copy'); await page.waitForFunction(() => new URLSearchParams(location.search).get('f') === 'local/reading-and-editing.md');
    await page.waitForSelector('.lmd-xroot[data-root=local] .lmd-node');
    d = await doc(page); t = await tree(page);
    const mine = await page.evaluate(() => [...document.querySelectorAll('.lmd-xroot[data-root=local] .lmd-node')].map((n) => n.textContent.trim()));
    check('"Save a copy" deja la nota entre las del navegador y la abre ahí, ya editable', d.f === 'local/reading-and-editing.md' && !d.guide && !d.ro && d.mode && d.h1 === 'Reading and editing' && J(mine) === J(['reading-and-editing.md']), [d, mine]);
    check('con una nota propia, la guía ya no está en el explorador', !t.roots.includes('guide') && t.roots.includes('local'), t.roots);

    console.log('Con una nota propia');
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=new]'); await page.waitForSelector('.lmd-xroot[data-root=local] .lmd-node');
    t = await tree(page);
    check('al volver a entrar, el explorador no muestra la guía', !t.roots.includes('guide'), t.roots);
    await page.click('.lmd-home [data-home=guide]'); await opened(page, 'Start here'); await marked(page);
    d = await doc(page); t = await tree(page);
    check('pero el enlace del inicio la abre igual, y mientras se lee está en el explorador', d.guide && d.ro && t.roots.includes('guide') && d.active === 'Start here', [d, t.roots]);
    await page.click('.lmd-xroot[data-root=local] .lmd-node'); await page.waitForFunction(() => new URLSearchParams(location.search).get('f') === 'local/reading-and-editing.md');
    await page.waitForFunction(() => !document.querySelector('.lmd-xroot[data-root=guide]'));
    check('al pasar a una nota propia, la guía se va del explorador', !(await tree(page)).roots.includes('guide'));
    // Desde Ajustes, con una nota abierta.
    await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-ptabs [data-act=guide]');
    const inSettings = await page.evaluate(() => { const b = document.querySelector('.lmd-ptabs [data-act=guide]'); const f = document.querySelector('.lmd-ptabs [data-act=feedback]'); return { text: b.textContent, before: !!(b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING), gap: Math.round(f.getBoundingClientRect().top - b.getBoundingClientRect().bottom) }; });
    await page.click('.lmd-ptabs [data-act=guide]'); await opened(page, 'Start here');
    check('Ajustes también lleva a la guía, y se cierra al abrirla', inSettings.text === 'See how it works' && inSettings.before && inSettings.gap < 12 && (await doc(page)).guide && await page.evaluate(() => document.querySelector('.lmd-panel').hidden), inSettings);
    await ctx.close();
  }

  console.log('En español');
  {
    const { ctx, page } = await open('es');
    const mark = hits.length;
    await page.goto(home); await page.waitForSelector('.lmd-xroot[data-root=guide] .lmd-node');
    const t = await tree(page);
    check('la raíz se llama "Guía" y lista las notas por su título en español', t.name === 'Guía' && J(t.nodes) === J(GUIDE.map((g) => g[1])), t);
    check('el enlace del inicio dice "Ver cómo funciona"', (await page.textContent('.lmd-home [data-home=guide]')) === 'Ver cómo funciona');
    await page.click('.lmd-home [data-home=guide]'); await opened(page, 'Empezar');
    let d = await doc(page);
    check('abre en español: la nota, su nombre y el pie', d.f === 'guide/start.md' && d.name === 'Empezar' && d.state === 'Guía · solo lectura' && d.copyText === 'Guardar una copia' && guideHits(mark)[0] === '/src/guide/es/start.md', [d, guideHits(mark)]);
    await page.click('.lmd-article a.lmd-wiki:text-is("Conectar tu IA por MCP")'); await opened(page, 'Conectar tu IA por MCP');
    await page.waitForSelector('.lmd-article svg[id^="lmd-mermaid-"]', { timeout: 30000 }).catch(() => {});
    d = await doc(page);
    check('y un enlace interno lleva a la nota en español, con su diagrama', d.f === 'guide/connect-your-ai.md' && d.guide && await page.locator('.lmd-article svg[id^="lmd-mermaid-"] g.node').count() === 4, d);
    for (let i = 0; i < 60 && guideHits(mark).length < GUIDE.length; i++) await wait(100);
    check('no se pidió ninguna nota en inglés', guideHits(mark).length === GUIDE.length && guideHits(mark).every((h) => h.startsWith('/src/guide/es/')), guideHits(mark));
    // La misma dirección, en un navegador en inglés, abre la nota en inglés.
    const other = await open(); await other.page.goto(page.url()); await opened(other.page, 'Connect your AI over MCP');
    check('la misma dirección abre en el idioma de quien la recibe', (await doc(other.page)).f === 'guide/connect-your-ai.md');
    await other.ctx.close(); await ctx.close();
  }

  console.log('En un teléfono');
  {
    const { ctx, page } = await open('', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(home + '?f=' + encodeURIComponent('guide/files-and-folders.md')); await opened(page, 'Files and folders');
    const fit = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth <= window.innerWidth + 1, foot: !!(document.querySelector('.lmd-guide-copy').offsetParent) }));
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const more = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-more button')].map((b) => b.dataset.more));
    check('la nota entra en la pantalla, y "Save a copy" está en el menú "más" (en el pie no hay lugar)', fit.wide && !fit.foot && more.includes('guide-copy') && !more.includes('guide') && !more.includes('insert'), [fit, more]);
    await page.tap('.lmd-menu-more [data-more=guide-copy]'); await page.waitForFunction(() => new URLSearchParams(location.search).get('f') === 'local/files-and-folders.md');
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const more2 = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-more button')].map((b) => b.dataset.more));
    check('con una nota propia abierta, el menú "más" queda como estaba: a la guía se llega por Ajustes', !more2.includes('guide-copy') && !more2.includes('guide') && more2.includes('settings'), more2);
    await page.tap('.lmd-menu-more [data-more=settings]'); await page.waitForSelector('.lmd-ptabs [data-act=guide]');
    await page.locator('.lmd-ptabs [data-act=guide]').scrollIntoViewIfNeeded(); await page.tap('.lmd-ptabs [data-act=guide]'); await opened(page, 'Start here');
    check('que en el teléfono también la abre', (await doc(page)).guide && await page.evaluate(() => document.querySelector('.lmd-panel').hidden));
    await ctx.close();
  }

  console.log('Sin conexión, después de la primera visita');
  {
    const { ctx, page } = await open('', { serviceWorkers: 'allow' });
    await page.goto(home); await page.waitForSelector('.lmd-home [data-home=guide]');
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: 'off' } }, resolve)));
    await page.click('.lmd-home [data-home=guide]'); await opened(page, 'Start here');
    // La guía entera queda en la caché de la app, se haya abierto la nota o no.
    const kept = await page.evaluate(async (names) => { for (let i = 0; i < 100; i++) { for (const k of await caches.keys()) { const c = await caches.open(k); const got = await Promise.all(names.map((n) => c.match('/src/guide/en/' + n + '.md'))); if ((await c.match('/src/app.html')) && got.every(Boolean)) return true; } await new Promise((r) => setTimeout(r, 200)); } return false; }, GUIDE.map((g) => g[0]));
    check('en la primera visita, con abrir una nota, la guía entera queda guardada', kept);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await ctx.setOffline(true);
    const mark = hits.length;
    await page.goto(home + '?f=' + encodeURIComponent('guide/boards.md')); await opened(page, 'Kanban board');
    await page.waitForSelector('.lmd-article .lmd-board', { timeout: 15000 }).catch(() => {});
    check('sin red, una nota que no se había abierto se ve entera', (await doc(page)).guide && await page.locator('.lmd-article .lmd-board .lmd-card').count() === 4 && hits.length === mark, hits.slice(mark));
    await page.click('.lmd-article a:text-is("Connect your AI over MCP")'); await opened(page, 'Connect your AI over MCP');
    check('y los enlaces siguen navegando', (await doc(page)).f === 'guide/connect-your-ai.md');
    await ctx.setOffline(false); await ctx.close();
  }
  check('sin errores de script en la app web', !errors.length, errors);
} finally { await browser.close(); site.close(); }

// ---------- En la extensión ----------
console.log('En la extensión');
{
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-guide-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
  const extErrors = [];
  try {
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host; const app = 'chrome-extension://' + id + '/src/app.html';
    // La página de bienvenida se abre sola al instalar: no es parte de esta prueba.
    const page = await ctx.newPage(); page.on('pageerror', (e) => extErrors.push(e.message));
    const asked = []; page.on('request', (r) => { if (/\/guide\//.test(r.url())) asked.push(r.url()); });
    await page.goto(app); await page.waitForSelector('.lmd-home [data-home=guide]'); await page.waitForSelector('.lmd-xroot[data-root=guide] .lmd-node');
    const t = await tree(page);
    check('la página de la extensión muestra la guía la primera vez, en el idioma del navegador', t.name === 'Guía' && t.nodes.length === GUIDE.length && asked.length === 0, [t, asked]);
    await page.click('.lmd-home [data-home=guide]'); await opened(page, 'Empezar');
    const d = await doc(page);
    check('la abre desde su propio paquete, sin salir a la red, y es de solo lectura', d.f === 'guide/start.md' && d.guide && d.ro && !d.mode && asked.length >= 1 && asked.every((u) => u.startsWith('chrome-extension://' + id + '/src/guide/es/')), [d, asked]);
    await page.click('.lmd-article a.lmd-wiki:text-is("Diagramas y fórmulas")'); await opened(page, 'Diagramas y fórmulas');
    await page.waitForSelector('.lmd-article svg[id^="lmd-mermaid-"]', { timeout: 30000 }).catch(() => {});
    check('los enlaces navegan y el diagrama se dibuja', (await doc(page)).f === 'guide/diagrams-and-formulas.md' && await page.locator('.lmd-article svg[id^="lmd-mermaid-"] g.node').count() === 4);
    await page.click('[data-act=copy]'); await page.click('.lmd-menu-copy [data-more=copy-link]').catch(() => {});
    const shared = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('la dirección para compartir es la de la app web, no la de la extensión', shared === '' || shared === 'https://sharpmd.app/src/app.html?f=' + encodeURIComponent('guide/diagrams-and-formulas.md'), shared);
    check('sin errores de script en la extensión', !extErrors.length, extErrors);
  } finally { await ctx.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* queda en la carpeta temporal */ } }
}

const bad = results.filter((r) => !r.ok);
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' pruebas correctas');
process.exit(bad.length ? 1 : 0);
