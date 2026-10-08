// Genera la portada en inglés (/index.html) y en castellano (/es/index.html) desde tools/landing.src.html,
// que tiene los dos idiomas juntos. Cada página sale con un solo idioma en el HTML: es lo que leen los
// buscadores, que no ejecutan el cambio de idioma. También escribe sitemap.xml.
// Uso: node tools/build-site.mjs      (y se commitea lo generado junto con el fuente)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sharpmd.app';
// The team plan shows on the landing page once its checkout is open (the two price ids in pay.html).
const TEAM_OPEN = /var TEAM = \{ base: '[^']+', seat: '[^']+'/.test(fs.readFileSync(path.join(root, 'pay.html'), 'utf8'));
const src = fs.readFileSync(path.join(root, 'tools', 'landing.src.html'), 'utf8').replace(/\r\n/g, '\n')
  // Lo del plan de equipo (su columna y sus filas en las otras dos) va entre marcas, y sale solo con el cobro abierto.
  .replace(/ *<!--TEAM-->\n([\s\S]*?)\n *<!--\/TEAM-->\n?/g, (all, inner) => (TEAM_OPEN ? inner + '\n' : ''))
  .replace('<div class="plans">', TEAM_OPEN ? '<div class="plans three">' : '<div class="plans">');
if (/<!--\/?TEAM-->/.test(src)) throw new Error('quedó una marca del plan de equipo sin resolver');
// La imagen que se ve al compartir el enlace: la arma tests/social.mjs. Si cambia, cambia de nombre, para que las redes no usen la anterior.
const CARD = SITE + '/docs/social-card-3.png';
const CARD_ALT = { en: 'SharpMD: Markdown notes your AI writes and your team reads', es: 'SharpMD: notas en Markdown que tu IA escribe y tu equipo lee' };

// Los precios que muestra la portada, en un solo lugar. Hay dos juegos: el vigente y el nuevo, que ya está decidido pero
// todavía no se puede cobrar. NEW_PRICING elige cuál sale en todos lados: las tarjetas de los planes, la pregunta frecuente
// y los datos estructurados. El día que el cobro nuevo esté abierto se pasa a true y se vuelve a generar. La columna del
// plan de equipo sigue dependiendo de TEAM_OPEN, que mira pay.html.
// llms.txt se escribe a mano: ese día su sección "Plans" pasa a decir
//   - Paid: USD 40 a year or USD 4 a month. (lo demás, igual)
//   - Team: USD 5 per person a month, from 2 people, free for 14 days with no card. (más lo que trae el plan de equipo)
// y también cambian los precios de README.md y README.es.md ("Cloud notes and the sync server").
const NEW_PRICING = false;
const PRICES = {
  current: {
    offers: { paid: '3.99', team: '7.98' },
    en: { PAID_BIG: 'USD 3.99', PAID_PER: 'a month', PAID_ALT: 'or USD 39 a year', PAID_LINE: 'USD 3.99 a month or USD 39 a year',
      TEAM_BIG: 'USD 7.98', TEAM_PER: 'a month', TEAM_ALT: '2 people included, USD 3 for each extra one', TEAM_HOW: 'You sign in and pay inside the app.' },
    es: { PAID_BIG: 'USD 3.99', PAID_PER: 'por mes', PAID_ALT: 'o USD 39 por año', PAID_LINE: 'USD 3.99 por mes o USD 39 por año',
      TEAM_BIG: 'USD 7.98', TEAM_PER: 'por mes', TEAM_ALT: '2 personas incluidas, USD 3 por cada una más', TEAM_HOW: 'Entrás a tu cuenta y pagás dentro de la app.' },
  },
  // El anual va primero, como opción principal, y el mensual debajo.
  next: {
    offers: { paid: '4', team: '5' },
    en: { PAID_BIG: 'USD 40', PAID_PER: 'a year', PAID_ALT: 'or USD 4 a month', PAID_LINE: 'USD 40 a year or USD 4 a month',
      TEAM_BIG: 'USD 5', TEAM_PER: 'per person a month', TEAM_ALT: 'From 2 people', TEAM_HOW: 'Free for 14 days, no card needed' },
    es: { PAID_BIG: 'USD 40', PAID_PER: 'por año', PAID_ALT: 'o USD 4 por mes', PAID_LINE: 'USD 40 por año o USD 4 por mes',
      TEAM_BIG: 'USD 5', TEAM_PER: 'por persona por mes', TEAM_ALT: 'Desde 2 personas', TEAM_HOW: 'Gratis por 14 días, sin tarjeta' },
  },
};
const PRICE = PRICES[NEW_PRICING ? 'next' : 'current'];

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
  en: ['Edit Markdown on the formatted page, with no syntax to type', 'MCP endpoint so an AI reads and writes the notes', 'Comments on a block that the AI resolves', 'Tokens limited to one folder', 'Sharing, public links and live sessions by link', 'REST API, signed webhooks and inbound addresses', 'Kanban boards with fields per card', 'Folders with a password, encrypted in the browser', 'Open source, with a server you can host yourself'],
  es: ['Editar Markdown sobre la página ya formateada, sin escribir sintaxis', 'Conexión MCP para que una IA lea y escriba las notas', 'Comentarios sobre un bloque que la IA resuelve', 'Tokens limitados a una carpeta', 'Compartir, enlaces públicos y sesiones en vivo por enlace', 'API REST, webhooks firmados y direcciones de entrada', 'Tableros kanban con campos por tarjeta', 'Carpetas con contraseña, cifradas en el navegador', 'Código abierto, con un servidor que se puede alojar por cuenta propia'],
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
  // preguntas frecuentes, también como datos estructurados
  const faq = [...html.matchAll(/<details class="faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((x) => ({ '@type': 'Question', name: plain(x[1]), acceptedAnswer: { '@type': 'Answer', text: plain(x[2]) } }));
  if (faq.length < 3) throw new Error('no se encontraron las preguntas frecuentes');
  const app = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'SharpMD', url: m.url, applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Chrome, Edge, Brave',
    description: m.desc, featureList: FEATURES[lang], inLanguage: lang, image: CARD, screenshot: SITE + '/docs/store/2-editing.png', isAccessibleForFree: true,
    offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Paid', price: PRICE.offers.paid, priceCurrency: 'USD' }].concat(TEAM_OPEN ? [{ '@type': 'Offer', name: 'Team', price: PRICE.offers.team, priceCurrency: 'USD' }] : []),
    license: 'https://opensource.org/licenses/MIT', codeRepository: 'https://github.com/MR-Axel/sharpmd' };
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
    '<link rel="preload" href="' + up + 'vendor/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="' + up + 'docs/clips/hero.jpg" as="image" fetchpriority="high">',
    '<link rel="icon" href="' + up + 'icons/icon32.png">',
    '<script type="application/ld+json">' + JSON.stringify(app) + '</script>',
    '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }) + '</script>',
  ].join('\n');
  html = html.replace(/<!--HEAD-->/, head).replace(/<html[^>]*>/, '<html lang="' + lang + '">');
  html = html.replace(/<!--LANG-->/, '<div class="lang"><a href="' + (lang === 'en' ? './' : '../') + '?site"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="en">EN</a><a href="' + (lang === 'en' ? 'es/' : './') + '?site"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="es">ES</a></div>');
  if (/<!--(HEAD|LANG)-->/.test(html) || /%%|\[\[[^\]]*\|\|/.test(html)) throw new Error('faltó reemplazar una marca');
  // en /es/ las rutas relativas suben un nivel
  if (up) html = html.replace(/\b(href|src|poster|data-poster)="(?!https?:|mailto:|#|\/|\.\.?\/)([^"]+)"/g, '$1="' + up + '$2"').replace(/url\("(?!https?:|data:|\/|\.\.\/)([^"]+)"\)/g, 'url("' + up + '$1")');
  if (new RegExp('<span lang="' + other + '"').test(html)) throw new Error('quedó texto en ' + other);
  return html;
}

fs.writeFileSync(path.join(root, 'index.html'), build('en'));
fs.mkdirSync(path.join(root, 'es'), { recursive: true });
fs.writeFileSync(path.join(root, 'es', 'index.html'), build('es'));
const today = new Date().toISOString().slice(0, 10);
const alt = '<xhtml:link rel="alternate" hreflang="en" href="' + META.en.url + '"/><xhtml:link rel="alternate" hreflang="es" href="' + META.es.url + '"/>';
fs.writeFileSync(path.join(root, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  '  <url><loc>' + META.en.url + '</loc><lastmod>' + today + '</lastmod>' + alt + '</url>\n' +
  '  <url><loc>' + META.es.url + '</loc><lastmod>' + today + '</lastmod>' + alt + '</url>\n' +
  '  <url><loc>' + SITE + '/privacy.html</loc><lastmod>' + today + '</lastmod></url>\n' +
  '  <url><loc>' + SITE + '/api.html</loc><lastmod>' + today + '</lastmod></url>\n' +
  '  <url><loc>' + SITE + '/support.html</loc><lastmod>' + today + '</lastmod></url>\n</urlset>\n');
console.log('escrito: index.html (en), es/index.html, sitemap.xml');
