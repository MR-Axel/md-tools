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
const CARD = SITE + '/docs/social-card-2.png';
const CARD_ALT = { en: 'SharpMD, a Markdown editor for your files, your cloud and your AI', es: 'SharpMD, un editor de Markdown para tus archivos, tu nube y tu IA' };

const META = {
  en: { title: 'SharpMD: Markdown editor without the syntax',
    desc: 'Edit Markdown on the formatted page, with no syntax to type. Your files stay on your disk. Optional cloud, live editing and MCP for your AI. Open source.',
    og: 'Edit Markdown without writing Markdown. Your files stay on your disk, and your AI can work on the same notes.', locale: 'en_US', url: SITE + '/' },
  es: { title: 'SharpMD: editor de Markdown sin sintaxis',
    desc: 'Editás Markdown sobre la página ya formateada, sin escribir sintaxis. Tus archivos quedan en tu disco. Nube, edición en vivo y MCP para tu IA, opcionales.',
    og: 'Editá Markdown sin escribir Markdown. Tus archivos quedan en tu disco, y tu IA puede trabajar sobre las mismas notas.', locale: 'es_AR', url: SITE + '/es/' },
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function build(lang) {
  const other = lang === 'en' ? 'es' : 'en'; const m = META[lang]; const up = lang === 'es' ? '../' : '';
  let html = src.replace(/<!-- Fuente de la portada[\s\S]*?-->\n/, '').replace('<meta name="robots" content="noindex">\n', '');
  if (/noindex/.test(html)) throw new Error('la página publicada quedó con noindex');
  // un solo idioma: se quita el otro y se desenvuelve el propio
  const spans = new RegExp('<span lang="(en|es)">([\\s\\S]*?)</span>', 'g');
  html = html.replace(spans, (all, l, inner) => { if (inner.includes('<span')) throw new Error('span anidado en: ' + inner.slice(0, 80)); return l === lang ? inner : ''; });
  if (/lang="(en|es)"/.test(html.replace(/<html[^>]*>/, ''))) throw new Error('quedó una marca de idioma sin resolver');
  // preguntas frecuentes, también como datos estructurados
  const faq = [...html.matchAll(/<details class="faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((x) => ({ '@type': 'Question', name: plain(x[1]), acceptedAnswer: { '@type': 'Answer', text: plain(x[2]) } }));
  if (faq.length < 3) throw new Error('no se encontraron las preguntas frecuentes');
  const app = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'SharpMD', url: m.url, applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Chrome, Edge, Brave',
    description: m.desc, inLanguage: lang, image: CARD, screenshot: SITE + '/docs/store/2-editing.png', isAccessibleForFree: true,
    offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Paid', price: '3.99', priceCurrency: 'USD' }].concat(TEAM_OPEN ? [{ '@type': 'Offer', name: 'Team', price: '7.98', priceCurrency: 'USD' }] : []),
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
    '<link rel="preload" href="' + up + 'docs/clips/edit.jpg" as="image" fetchpriority="high">',
    '<link rel="icon" href="' + up + 'icons/icon32.png">',
    '<script type="application/ld+json">' + JSON.stringify(app) + '</script>',
    '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }) + '</script>',
  ].join('\n');
  html = html.replace(/<!--HEAD-->/, head).replace(/<html[^>]*>/, '<html lang="' + lang + '">');
  html = html.replace(/<!--LANG-->/, '<div class="lang"><a href="' + (lang === 'en' ? './' : '../') + '?site"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="en">EN</a><a href="' + (lang === 'en' ? 'es/' : './') + '?site"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="es">ES</a></div>');
  if (/<!--(HEAD|LANG)-->/.test(html)) throw new Error('faltó reemplazar una marca');
  // en /es/ las rutas relativas suben un nivel
  if (up) html = html.replace(/\b(href|src|poster)="(?!https?:|mailto:|#|\/|\.\.?\/)([^"]+)"/g, '$1="' + up + '$2"').replace(/url\("(?!https?:|data:|\/|\.\.\/)([^"]+)"\)/g, 'url("' + up + '$1")');
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
  '  <url><loc>' + SITE + '/support.html</loc><lastmod>' + today + '</lastmod></url>\n</urlset>\n');
console.log('escrito: index.html (en), es/index.html, sitemap.xml');
