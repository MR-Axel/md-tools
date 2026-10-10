// Genera la portada en inglés (/index.html) y en castellano (/es/index.html) desde tools/landing.src.html,
// que tiene los dos idiomas juntos. Cada página sale con un solo idioma en el HTML: es lo que leen los
// buscadores, que no ejecutan el cambio de idioma. También escribe sitemap.xml.
// Las páginas de PAGES salen igual, de tools/<nombre>.src.html a /<nombre>.html y /es/<nombre>.html.
// Uso: node tools/build-site.mjs      (y se commitea lo generado junto con el fuente)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sharpmd.app';
// The team plan shows on the landing page once its checkout is open (the id of its price in pay.html).
const TEAM_OPEN = /var TEAM = \{ price: '[^']+'/.test(fs.readFileSync(path.join(root, 'pay.html'), 'utf8'));
const src = fs.readFileSync(path.join(root, 'tools', 'landing.src.html'), 'utf8').replace(/\r\n/g, '\n')
  // Lo del plan de equipo (su columna y sus filas en las otras dos) va entre marcas, y sale solo con el cobro abierto.
  .replace(/ *<!--TEAM-->\n([\s\S]*?)\n *<!--\/TEAM-->\n?/g, (all, inner) => (TEAM_OPEN ? inner + '\n' : ''))
  .replace('<div class="plans">', TEAM_OPEN ? '<div class="plans three">' : '<div class="plans">');
if (/<!--\/?TEAM-->/.test(src)) throw new Error('quedó una marca del plan de equipo sin resolver');
// La imagen que se ve al compartir el enlace: la arma tests/social.mjs. Si cambia, cambia de nombre, para que las redes no usen la anterior.
const CARD = SITE + '/docs/social-card-5.png';
const CARD_ALT = { en: 'SharpMD: Markdown notes your AI writes and your team reads', es: 'SharpMD: notas en Markdown que tu IA escribe y tu equipo lee' };

// The look every page shares lives in site/site.css. The pages written by hand link it. The ones generated here carry it
// inside their <style>, so they need no extra request: the landing page takes the first part (fonts, colors, name,
// buttons) and the search pages take the layout of a page of text too. The comments go, and the fonts get their path.
const SHEET = fs.readFileSync(path.join(root, 'site', 'site.css'), 'utf8').replace(/\r\n/g, '\n');
const PARTS = SHEET.split(/\/\* ==== [a-z ]+ ==== \*\/\n/);
if (PARTS.length !== 3) throw new Error('site/site.css has to keep its three parts, and has ' + PARTS.length);
const sheet = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("fonts\//g, 'url("site/fonts/').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => '  ' + l).join('\n');
const CSS = { core: sheet(PARTS[0]), text: sheet(PARTS[0] + PARTS[1]) };
const FONTS = (up, list) => list.map((f) => '<link rel="preload" href="' + up + 'site/fonts/' + f + '.woff2" as="font" type="font/woff2" crossorigin>');

// Los precios que muestra la portada, en un solo lugar: las tarjetas de los planes, la pregunta frecuente y los datos
// estructurados. El anual va primero, como opción principal, y el mensual debajo. El equipo se cobra por persona. La columna
// del plan de equipo depende de TEAM_OPEN, que mira pay.html.
// Los mismos precios están escritos a mano en pay.html, en la app (src/sync.js y src/team.js), en llms.txt ("Plans") y en
// README.md y README.es.md ("Cloud notes and the sync server").
const PRICE = {
  offers: { paid: '4', team: '5' },
  en: { PAID_BIG: 'USD 4', PAID_PER: 'a month', PAID_ALT: 'or USD 40 a year', PAID_LINE: 'USD 4 a month or USD 40 a year',
    TEAM_BIG: 'USD 5', TEAM_PER: 'per person a month', TEAM_ALT: 'From 2 people', TEAM_HOW: 'Free for 14 days' },
  es: { PAID_BIG: 'USD 4', PAID_PER: 'por mes', PAID_ALT: 'o USD 40 por año', PAID_LINE: 'USD 4 por mes o USD 40 por año',
    TEAM_BIG: 'USD 5', TEAM_PER: 'por persona por mes', TEAM_ALT: 'Desde 2 personas', TEAM_HOW: 'Gratis por 14 días' },
};

const META = {
  en: { title: 'SharpMD: Markdown editor with your AI connected',
    desc: 'A Markdown editor in the cloud with MCP ready: your AI reads the notes and writes down what it did. Edit with no syntax, share by link, connect an API.',
    og: 'Markdown notes your AI writes and your team reads. The MCP endpoint is already running, and you edit on the formatted page.', locale: 'en_US', url: SITE + '/' },
  es: { title: 'SharpMD: editor de Markdown con tu IA conectada',
    desc: 'Un editor de Markdown en la nube con MCP listo: tu IA lee las notas y deja escrito lo que hizo. Editás sin sintaxis, compartís por enlace, conectás una API.',
    og: 'Notas en Markdown que tu IA escribe y tu equipo lee. La conexión MCP ya está andando, y editás sobre la página ya formateada.', locale: 'es_AR', url: SITE + '/es/' },
};
for (const l of ['en', 'es']) { const m = META[l]; if (m.title.length >= 50) throw new Error('título de ' + l + ' de ' + m.title.length + ' caracteres: tiene que tener menos de 50'); if (m.desc.length < 150 || m.desc.length > 158) throw new Error('descripción de ' + l + ' de ' + m.desc.length + ' caracteres: va entre 150 y 158'); }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Lo que el producto hace, para los datos estructurados: una línea por cosa, las mismas que ordenan la portada.
const FEATURES = {
  en: ['Edit Markdown on the formatted page, with no syntax to type', 'MCP endpoint so an AI reads and writes the notes', 'Comments on a block that the AI resolves', 'An assistant inside the note with your own API key, stored encrypted on the device', 'Tokens limited to one folder', 'Sharing, public links and live sessions by link', 'REST API, signed webhooks and inbound addresses', 'Kanban boards with fields per card', 'Folders with a password, encrypted in the browser', 'Open source, with a server you can host yourself'],
  es: ['Editar Markdown sobre la página ya formateada, sin escribir sintaxis', 'Conexión MCP para que una IA lea y escriba las notas', 'Comentarios sobre un bloque que la IA resuelve', 'Un asistente dentro de la nota con tu propia clave, guardada cifrada en el dispositivo', 'Tokens limitados a una carpeta', 'Compartir, enlaces públicos y sesiones en vivo por enlace', 'API REST, webhooks firmados y direcciones de entrada', 'Tableros kanban con campos por tarjeta', 'Carpetas con contraseña, cifradas en el navegador', 'Código abierto, con un servidor que se puede alojar por cuenta propia'],
};
function build(lang) {
  const other = lang === 'en' ? 'es' : 'en'; const m = META[lang]; const up = lang === 'es' ? '../' : '';
  let html = src.replace(/<!-- Fuente de la portada[\s\S]*?-->\n/, '').replace('<meta name="robots" content="noindex">\n', '');
  if (/noindex/.test(html)) throw new Error('la página publicada quedó con noindex');
  // los precios: %%CLAVE%% sale del juego de precios elegido, en el idioma de la página
  html = html.replace(/%%([A-Z_]+)%%/g, (all, k) => { if (PRICE[lang][k] == null) throw new Error('precio sin definir: ' + k); return PRICE[lang][k]; });
  // un atributo (alt, aria-label) no puede llevar las dos marcas de idioma: va como [[inglés||castellano]]
  html = html.replace(/\[\[([^\]|]+)\|\|([^\]|]+)\]\]/g, (all, en, es) => esc(lang === 'en' ? en : es));
  // un solo idioma: se quita el otro y se desenvuelve el propio
  const spans = new RegExp('<span lang="(en|es)">([\\s\\S]*?)</span>', 'g');
  html = html.replace(spans, (all, l, inner) => { if (inner.includes('<span')) throw new Error('span anidado en: ' + inner.slice(0, 80)); return l === lang ? inner : ''; });
  if (/lang="(en|es)"/.test(html.replace(/<html[^>]*>/, ''))) throw new Error('quedó una marca de idioma sin resolver');
  html = html.replace('/*SITE-CSS-CORE*/', () => CSS.core.trimStart());
  // preguntas frecuentes, también como datos estructurados
  const faq = [...html.matchAll(/<details class="faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((x) => ({ '@type': 'Question', name: plain(x[1]), acceptedAnswer: { '@type': 'Answer', text: plain(x[2]) } }));
  if (faq.length < 3) throw new Error('no se encontraron las preguntas frecuentes');
  const app = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'SharpMD', alternateName: ['Sharp MD', 'SharpMD Markdown editor'], url: m.url, applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Android', browserRequirements: 'Chrome, Edge, Brave, Firefox or Safari',
    description: m.desc, featureList: FEATURES[lang], inLanguage: lang, image: CARD, screenshot: SITE + '/docs/store/2-editing.png', isAccessibleForFree: true,
    offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Paid', price: PRICE.offers.paid, priceCurrency: 'USD' }].concat(TEAM_OPEN ? [{ '@type': 'Offer', name: 'Team', price: PRICE.offers.team, priceCurrency: 'USD' }] : []),
    license: 'https://opensource.org/licenses/MIT', codeRepository: 'https://github.com/SharpMD/sharpmd' };
  const head = [
    // Quien ya usó la app entra directo; y la app, en "automático", sigue el idioma de la portada que se vio. Mientras se va,
    // la portada no se pinta: queda el logo con el cursor sobre el fondo de la app (la clase go), con el tema que la app tenía.
    // Va primero en el <head>: a quien se va a la app no se le empiezan a bajar la tipografía ni la imagen de la portada.
    '<script>try{localStorage.setItem("mdtools:site-lang","' + lang + '");if(localStorage.getItem("sharpmd:app")&&location.search.indexOf("site")<0&&!location.hash&&document.referrer.indexOf(location.origin)!==0){var d=localStorage.getItem("lmd:dark"),c=document.documentElement.classList;c.add("go");if(d==="0"||(d!=="1"&&window.matchMedia&&!matchMedia("(prefers-color-scheme: dark)").matches))c.add("go-light");location.replace("' + up + 'src/app.html")}}catch(e){}</script>',
    '<title>' + esc(m.title) + '</title>',
    '<meta name="description" content="' + esc(m.desc) + '">',
    '<link rel="canonical" href="' + m.url + '">',
    '<link rel="alternate" hreflang="en" href="' + META.en.url + '">',
    '<link rel="alternate" hreflang="es" href="' + META.es.url + '">',
    '<link rel="alternate" hreflang="x-default" href="' + META.en.url + '">',
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="SharpMD">', '<meta property="og:title" content="' + esc(m.title) + '">',
    '<meta property="og:description" content="' + esc(m.og) + '">', '<meta property="og:url" content="' + m.url + '">', '<meta property="og:locale" content="' + m.locale + '">',
    '<meta property="og:image" content="' + CARD + '">', '<meta property="og:image:type" content="image/png">', '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="' + esc(CARD_ALT[lang]) + '">',
    '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:title" content="' + esc(m.title) + '">', '<meta name="twitter:description" content="' + esc(m.og) + '">', '<meta name="twitter:image" content="' + CARD + '">', '<meta name="twitter:image:alt" content="' + esc(CARD_ALT[lang]) + '">',
    '<meta name="theme-color" content="#121418" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">',
    // Only the font of the text is asked for ahead. The one of the small label over the headline comes when the page is
    // drawn: asked for here too, it takes bandwidth from the HTML itself and the first paint arrives later.
    ...FONTS(up, ['figtree']),
    '<link rel="preload" href="' + up + 'docs/clips/hero.jpg" as="image" fetchpriority="high">',
    '<link rel="icon" type="image/png" sizes="32x32" href="' + up + 'icons/icon32.png">', '<link rel="icon" type="image/png" sizes="16x16" href="' + up + 'icons/icon16.png">',
    '<script type="application/ld+json">' + JSON.stringify(app) + '</script>',
    '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }) + '</script>',
  ].join('\n');
  html = html.replace(/<!--HEAD-->/, head).replace(/<html[^>]*>/, '<html lang="' + lang + '">');
  html = html.replace(/<!--LANG-->/, '<div class="lang"><a href="' + (lang === 'en' ? 'es/' : '../') + '?site"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="' + (lang === 'en' ? 'es' : 'en') + '">EN</a><a href="' + (lang === 'en' ? 'es/' : '../') + '?site"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="' + (lang === 'en' ? 'es' : 'en') + '">ES</a></div>');
  if (/<!--(HEAD|LANG)-->/.test(html) || /%%|\[\[[^\]]*\|\||SITE-CSS/.test(html)) throw new Error('faltó reemplazar una marca');
  // en /es/ las rutas relativas suben un nivel
  if (up) html = html.replace(/\b(href|src|poster|data-poster)="(?!https?:|mailto:|#|\/|\.\.?\/)([^"]+)"/g, '$1="' + up + '$2"').replace(/url\("(?!https?:|data:|\/|\.\.\/)([^"]+)"\)/g, 'url("' + up + '$1")');
  if (new RegExp('<span lang="' + other + '"').test(html)) throw new Error('quedó texto en ' + other);
  return html;
}

// Las páginas que explican un uso (para quien llega buscando eso): cada una tiene su fuente en tools/<nombre>.src.html, con
// los dos idiomas en bloques <div lang>, y sale a /<nombre>.html y /es/<nombre>.html con un solo idioma, como la portada.
const PAGES = {
  'markdown-editor-mcp': {
    en: { title: 'Markdown editor for Claude and AI agents (MCP): SharpMD',
      desc: 'A Markdown editor with the MCP endpoint already running. Claude, Codex or any MCP client reads and writes your notes. Free over 25 cloud notes.' },
    es: { title: 'Editor de Markdown para Claude y agentes de IA (MCP): SharpMD',
      desc: 'Un editor de Markdown con la conexión MCP ya andando. Claude, Codex o cualquier cliente MCP lee y escribe tus notas. Gratis sobre 25 notas en la nube.' } },
  'wysiwyg-markdown-editor': {
    en: { title: 'WYSIWYG Markdown editor online, no syntax: SharpMD',
      desc: 'Edit Markdown on the formatted page: paragraphs, tables, tasks, formulas and diagrams. The file stays plain Markdown. Free, with no account, and offline.' },
    es: { title: 'Editor de Markdown WYSIWYG online, sin sintaxis: SharpMD',
      desc: 'Editá Markdown sobre la página ya formateada: párrafos, tablas, tareas, fórmulas y diagramas. El archivo sigue siendo Markdown plano. Gratis y sin cuenta.' } },
  // El programa local (la carpeta local/): qué es, cómo se instala y cómo se empareja. La app enlaza acá.
  'local-tools': {
    en: { title: 'SharpMD Local: dev servers, worktrees and agent sessions',
      desc: 'A small open source program that shows your dev servers, git worktrees and AI agent sessions in SharpMD. It runs on your computer and listens locally.' },
    es: { title: 'SharpMD Local: servidores, worktrees y sesiones de agentes',
      desc: 'Un programa chico y abierto que muestra tus servidores de desarrollo, worktrees de git y sesiones de agentes de IA en SharpMD. Corre en tu computadora.' } },
};
const pageUrl = (slug, lang) => SITE + (lang === 'es' ? '/es/' : '/') + slug + '.html';
function buildPage(slug, lang) {
  const m = PAGES[slug][lang]; const up = lang === 'es' ? '../' : ''; const url = pageUrl(slug, lang);
  if (m.title.length > 62) throw new Error('título de ' + slug + ' (' + lang + ') de ' + m.title.length + ' caracteres: hasta 62');
  if (m.desc.length < 120 || m.desc.length > 158) throw new Error('descripción de ' + slug + ' (' + lang + ') de ' + m.desc.length + ' caracteres: va entre 120 y 158');
  let html = fs.readFileSync(path.join(root, 'tools', slug + '.src.html'), 'utf8').replace(/\r\n/g, '\n').replace(/<!-- Fuente de la página[\s\S]*?-->\n/, '').replace('<meta name="robots" content="noindex">\n', '');
  if (/noindex/.test(html)) throw new Error(slug + ': la página publicada quedó con noindex');
  // el bloque del otro idioma se va entero y el propio se desenvuelve; los dos van con dos espacios de sangría, y lo de adentro con más
  let own = 0;
  html = html.replace(/^  <div lang="(en|es)">\n([\s\S]*?)\n  <\/div>\n\n?/gm, (all, l, inner) => { if (l !== lang) return ''; own++; return inner.replace(/^  /gm, '') + '\n'; });
  if (own !== 1) throw new Error(slug + ': tiene que haber un bloque en ' + lang + ' y hay ' + own);
  html = html.replace(/\[\[([^\]|]+)\|\|([^\]|]+)\]\]/g, (all, en, es) => esc(lang === 'en' ? en : es));
  html = html.replace(/<span lang="(en|es)">([\s\S]*?)<\/span>/g, (all, l, inner) => (l === lang ? inner : ''));
  if (/lang="(en|es)"/.test(html.replace(/<html[^>]*>/, ''))) throw new Error(slug + ': quedó una marca de idioma sin resolver');
  html = html.replace('/*SITE-CSS*/', () => CSS.text.trimStart());
  const head = [
    // la app, en "automático", sigue el idioma de la página que se vio
    '<script>try{localStorage.setItem("mdtools:site-lang","' + lang + '")}catch(e){}</script>',
    '<title>' + esc(m.title) + '</title>',
    '<meta name="description" content="' + esc(m.desc) + '">',
    '<link rel="canonical" href="' + url + '">',
    '<link rel="alternate" hreflang="en" href="' + pageUrl(slug, 'en') + '">',
    '<link rel="alternate" hreflang="es" href="' + pageUrl(slug, 'es') + '">',
    '<link rel="alternate" hreflang="x-default" href="' + pageUrl(slug, 'en') + '">',
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="SharpMD">', '<meta property="og:title" content="' + esc(m.title) + '">',
    '<meta property="og:description" content="' + esc(m.desc) + '">', '<meta property="og:url" content="' + url + '">', '<meta property="og:locale" content="' + META[lang].locale + '">',
    '<meta property="og:image" content="' + CARD + '">', '<meta property="og:image:type" content="image/png">', '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="' + esc(CARD_ALT[lang]) + '">',
    '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:title" content="' + esc(m.title) + '">', '<meta name="twitter:description" content="' + esc(m.desc) + '">', '<meta name="twitter:image" content="' + CARD + '">', '<meta name="twitter:image:alt" content="' + esc(CARD_ALT[lang]) + '">',
    '<meta name="theme-color" content="#121418" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">',
    ...FONTS(up, ['figtree']),
    '<link rel="icon" type="image/png" sizes="32x32" href="' + up + 'icons/icon32.png">', '<link rel="icon" type="image/png" sizes="16x16" href="' + up + 'icons/icon16.png">',
  ].join('\n');
  html = html.replace(/<!--HEAD-->/, head).replace(/<html[^>]*>/, '<html lang="' + lang + '">');
  // en /es/ las rutas relativas suben un nivel; las que empiezan con ./ se quedan en /es/ (la portada y la otra página, en castellano)
  if (up) html = html.replace(/\b(href|src)="(?!https?:|mailto:|#|\/|\.\.?\/)([^"]+)"/g, '$1="' + up + '$2"').replace(/url\("(?!https?:|data:|\/|\.\.\/)([^"]+)"\)/g, 'url("' + up + '$1")');
  html = html.replace(/<!--LANG-->/, '<div class="lang"><a href="' + (lang === 'en' ? 'es/' : '../') + slug + '.html"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="' + (lang === 'en' ? 'es' : 'en') + '">EN</a><a href="' + (lang === 'en' ? 'es/' : '../') + slug + '.html"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="' + (lang === 'en' ? 'es' : 'en') + '">ES</a></div>');
  if (/<!--(HEAD|LANG)-->/.test(html) || /%%|\[\[[^\]]*\|\||SITE-CSS/.test(html)) throw new Error(slug + ': faltó reemplazar una marca');
  if ((html.match(/<h1[ >]/g) || []).length !== 1) throw new Error(slug + ' (' + lang + '): tiene que quedar un solo h1');
  return html;
}

fs.writeFileSync(path.join(root, 'index.html'), build('en'));
fs.mkdirSync(path.join(root, 'es'), { recursive: true });
fs.writeFileSync(path.join(root, 'es', 'index.html'), build('es'));
for (const slug of Object.keys(PAGES)) { fs.writeFileSync(path.join(root, slug + '.html'), buildPage(slug, 'en')); fs.writeFileSync(path.join(root, 'es', slug + '.html'), buildPage(slug, 'es')); }
const today = new Date().toISOString().slice(0, 10);
const alt = '<xhtml:link rel="alternate" hreflang="en" href="' + META.en.url + '"/><xhtml:link rel="alternate" hreflang="es" href="' + META.es.url + '"/>';
fs.writeFileSync(path.join(root, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  '  <url><loc>' + META.en.url + '</loc><lastmod>' + today + '</lastmod>' + alt + '</url>\n' +
  '  <url><loc>' + META.es.url + '</loc><lastmod>' + today + '</lastmod>' + alt + '</url>\n' +
  Object.keys(PAGES).map((slug) => { const a = '<xhtml:link rel="alternate" hreflang="en" href="' + pageUrl(slug, 'en') + '"/><xhtml:link rel="alternate" hreflang="es" href="' + pageUrl(slug, 'es') + '"/>'; return ['en', 'es'].map((l) => '  <url><loc>' + pageUrl(slug, l) + '</loc><lastmod>' + today + '</lastmod>' + a + '</url>\n').join(''); }).join('') +
  '  <url><loc>' + SITE + '/privacy.html</loc><lastmod>' + today + '</lastmod></url>\n' +
  '  <url><loc>' + SITE + '/api.html</loc><lastmod>' + today + '</lastmod></url>\n' +
  '  <url><loc>' + SITE + '/support.html</loc><lastmod>' + today + '</lastmod></url>\n' +
  ['terms', 'refunds', 'acceptable-use', 'copyright'].map((p) => '  <url><loc>' + SITE + '/' + p + '.html</loc><lastmod>' + today + '</lastmod></url>\n').join('') + '</urlset>\n');
console.log('escrito: index.html (en), es/index.html, ' + Object.keys(PAGES).map((s) => s + '.html (en y es)').join(', ') + ', sitemap.xml');
