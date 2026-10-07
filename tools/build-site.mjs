// Genera la portada en inglés (/index.html) y en castellano (/es/index.html) desde tools/landing.src.html,
// que tiene los dos idiomas juntos. Cada página sale con un solo idioma en el HTML: es lo que leen los
// buscadores, que no ejecutan el cambio de idioma. También escribe sitemap.xml.
// Uso: node tools/build-site.mjs      (y se commitea lo generado junto con el fuente)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sharpmd.app';
const src = fs.readFileSync(path.join(root, 'tools', 'landing.src.html'), 'utf8').replace(/\r\n/g, '\n');

const META = {
  en: { title: 'SharpMD: Markdown editor and reader in the browser',
    desc: 'Free, open source Markdown editor that runs in the browser. Open a file or a folder, edit on the formatted text, draw diagrams. Optional cloud notes and MCP.',
    og: 'Read and edit Markdown in the browser. Free and open source. Your files stay on your machine.', locale: 'en_US', url: SITE + '/' },
  es: { title: 'SharpMD: editor y lector de Markdown en el navegador',
    desc: 'Editor de Markdown gratis y de código abierto en el navegador. Abrís un archivo o una carpeta y editás sobre el texto ya formateado. Nube y MCP opcionales.',
    og: 'Leé y editá Markdown en el navegador. Gratis y de código abierto. Tus archivos quedan en tu máquina.', locale: 'es_AR', url: SITE + '/es/' },
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
    description: m.desc, inLanguage: lang, image: SITE + '/docs/store/1-reader.png', screenshot: SITE + '/docs/store/2-editing.png', isAccessibleForFree: true,
    offers: [{ '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Paid', price: '3.99', priceCurrency: 'USD' }],
    license: 'https://opensource.org/licenses/MIT', codeRepository: 'https://github.com/MR-Axel/sharpmd' };
  const head = [
    '<title>' + esc(m.title) + '</title>',
    '<meta name="description" content="' + esc(m.desc) + '">',
    '<link rel="canonical" href="' + m.url + '">',
    '<link rel="alternate" hreflang="en" href="' + META.en.url + '">',
    '<link rel="alternate" hreflang="es" href="' + META.es.url + '">',
    '<link rel="alternate" hreflang="x-default" href="' + META.en.url + '">',
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="SharpMD">', '<meta property="og:title" content="' + esc(m.title) + '">',
    '<meta property="og:description" content="' + esc(m.og) + '">', '<meta property="og:url" content="' + m.url + '">', '<meta property="og:locale" content="' + m.locale + '">',
    '<meta property="og:image" content="' + SITE + '/docs/store/1-reader.png">', '<meta property="og:image:width" content="1280">', '<meta property="og:image:height" content="800">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="theme-color" content="#121418" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">',
    '<link rel="preload" href="' + up + 'vendor/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="icon" href="' + up + 'icons/icon32.png">',
    '<script type="application/ld+json">' + JSON.stringify(app) + '</script>',
    '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }) + '</script>',
    // quien ya usó la app entra directo; y la app, en "automático", sigue el idioma de la portada que se vio
    '<script>try{localStorage.setItem("mdtools:site-lang","' + lang + '");if(localStorage.getItem("sharpmd:app")&&location.search.indexOf("site")<0&&!location.hash&&document.referrer.indexOf(location.origin)!==0)location.replace("' + up + 'src/app.html")}catch(e){}</script>',
  ].join('\n');
  html = html.replace(/<!--HEAD-->/, head).replace(/<html[^>]*>/, '<html lang="' + lang + '">');
  html = html.replace(/<!--LANG-->/, '<div class="lang"><a href="' + (lang === 'en' ? './' : '../') + '?site"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="en">EN</a><a href="' + (lang === 'en' ? 'es/' : './') + '?site"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="es">ES</a></div>');
  if (/<!--(HEAD|LANG)-->/.test(html)) throw new Error('faltó reemplazar una marca');
  // en /es/ las rutas relativas suben un nivel
  if (up) html = html.replace(/\b(href|src)="(?!https?:|mailto:|#|\/|\.\.?\/)([^"]+)"/g, '$1="' + up + '$2"').replace(/url\("(?!https?:|\/|\.\.\/)([^"]+)"\)/g, 'url("' + up + '$1")');
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
