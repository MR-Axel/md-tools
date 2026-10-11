// Novedades: lo que se fue sumando a SharpMD, agrupado por semana. Una sola fuente por idioma, escrita a mano:
//   tools/updates.en.md   y   tools/updates.es.md
// De ahí salen, sin copiar nada a mano:
//   /updates.html y /es/updates.html         la página del sitio, con las imágenes de site/updates/<idioma>/
//   src/guide/en/updates.md y .../es/...     la nota "Novedades" de la guía de la app, sin imágenes (la guía viaja
//                                            con la extensión y site/ no)
// Uso: node tools/build-updates.mjs          (y se commitea lo generado junto con la fuente)
//      node tools/build-updates.mjs --check  no escribe: sale con 1 si lo generado quedó atrás (tests/guide.mjs)
//
// La forma de la fuente (las dos tienen las mismas semanas, en el mismo orden, con las mismas imágenes):
//   # Título
//   Un párrafo de entrada.
//   ## Del 5 al 11 de octubre de 2026 {#2026-10-05}     una semana: su lunes como identificador. Lo nuevo va arriba.
//   ### Título corto de la novedad
//   Una o dos frases.
//   ![Texto alternativo](archivo.webp)                  opcional; el archivo está en site/updates/en/ y en site/updates/es/
//   - Una lista, para lo chico
//   *Hasta la versión 2.85*                             un renglón entero en cursiva: la nota chica al pie de la semana
//   ## Antes {#earlier}                                 el bloque de lo anterior, al final
// Las imágenes las arma tests/updates-shots.mjs.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sharpmd.app';
export const LANGS = ['en', 'es'];
export const IMG_DIR = 'site/updates';
export const IMG_MAX_BYTES = 150 * 1024; export const IMG_MAX_WIDTH = 1200;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const TEXT = {
  en: { title: 'What is new in SharpMD, week by week', desc: 'What was added to SharpMD each week, with pictures: the viewer for PDF and books, folders sent to the cloud, folder templates and more.',
    locale: 'en_US', open: 'Open the app', home: 'Everything else is on the <a href="./">SharpMD home page</a>.',
    note: 'The same list with pictures is on [sharpmd.app/updates.html](https://sharpmd.app/updates.html). The rest of the guide starts at [[start|Start here]].' },
  es: { title: 'Novedades de SharpMD, semana por semana', desc: 'Lo que se fue sumando a SharpMD cada semana, con imágenes: el visor de PDF y libros, carpetas enviadas a la nube, plantillas y más.',
    locale: 'es_AR', open: 'Abrir la app', home: 'Todo lo demás está en la <a href="./">portada de SharpMD</a>.',
    note: 'La misma lista con imágenes está en [sharpmd.app/es/updates.html](https://sharpmd.app/es/updates.html). El resto de la guía empieza en [[start|Empezar]].' },
};
const pageUrl = (lang) => SITE + (lang === 'es' ? '/es/' : '/') + 'updates.html';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Lo poco de Markdown que lleva un renglón: `código` y [enlaces](https://…).
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

// El ancho y el alto de un WebP o un PNG, leídos de su cabecera.
export function imageSize(buf) {
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  return null;
}

// La fuente de un idioma, ya separada: título, entrada y semanas, cada una con sus partes en orden.
export function parse(lang) {
  const file = 'tools/updates.' + lang + '.md'; const md = read(file);
  const fail = (msg) => { throw new Error(file + ': ' + msg); };
  if (/[!¡—–]/.test(md.replace(/^!\[/gm, '['))) fail('no lleva signos de admiración ni rayas');
  if (/\*\*/.test(md)) fail('no lleva negrita: en la guía la negrita es el nombre de algo de la app');
  const out = { title: '', lede: [], weeks: [] }; let week = null; let item = null;
  for (const block of md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) {
    let m;
    if ((m = /^# (.+)$/.exec(block))) { if (out.title) fail('tiene más de un título'); out.title = m[1]; continue; }
    if ((m = /^## (.+?) \{#([a-z0-9-]+)\}$/.exec(block))) {
      if (!/^(\d{4}-\d{2}-\d{2}|earlier)$/.test(m[2])) fail('la semana "' + m[1] + '" lleva el lunes como identificador, {#2026-10-05}, o {#earlier}');
      week = { id: m[2], title: m[1], parts: [] }; item = null; out.weeks.push(week); continue;
    }
    if (/^## /.test(block)) fail('a la semana "' + block.slice(3) + '" le falta su identificador, {#2026-10-05}');
    if (!out.title) fail('empieza por el título, # …');
    if (!week) { out.lede.push(block); continue; }
    if ((m = /^### (.+)$/.exec(block))) { item = { kind: 'item', title: m[1], parts: [] }; week.parts.push(item); continue; }
    const to = item ? item.parts : week.parts;
    if ((m = /^!\[([^\]]+)\]\(([a-z0-9-]+\.(?:webp|png))\)$/.exec(block))) { if (!item) fail('la imagen ' + m[2] + ' va dentro de una novedad'); to.push({ kind: 'img', alt: m[1], file: m[2] }); continue; }
    if (/^!\[/.test(block)) fail('una imagen va sola en su renglón, con texto alternativo y un nombre de archivo en minúsculas: ' + block.slice(0, 60));
    if (/^- /.test(block)) { const rows = block.split('\n'); if (!rows.every((r) => /^- /.test(r))) fail('una lista lleva un renglón por ítem'); to.push({ kind: 'list', rows: rows.map((r) => r.slice(2)) }); continue; }
    if ((m = /^\*([^*\n]+)\*$/.exec(block))) { item = null; week.parts.push({ kind: 'small', text: m[1] }); continue; }
    if (/\n/.test(block) || /^[#>|`]/.test(block)) fail('no se entiende este bloque: ' + block.slice(0, 60));
    to.push({ kind: 'p', text: block });
  }
  if (!out.title || !out.lede.length || !out.weeks.length) fail('hace falta un título, un párrafo de entrada y al menos una semana');
  const ids = out.weeks.map((w) => w.id); const dated = ids.filter((i) => i !== 'earlier');
  if (new Set(ids).size !== ids.length) fail('hay una semana repetida');
  if (dated.join() !== dated.slice().sort().reverse().join()) fail('las semanas van de la más nueva a la más vieja');
  if (ids.includes('earlier') && ids[ids.length - 1] !== 'earlier') fail('el bloque de lo anterior va al final');
  for (const w of out.weeks) {
    const n = w.parts.filter((p) => p.kind === 'item').length;
    if (w.id !== 'earlier' && (n < 3 || n > 7)) fail('la semana "' + w.title + '" tiene ' + n + ' novedades: van de 3 a 7');
    for (const it of w.parts.filter((p) => p.kind === 'item')) if (!it.parts.length) fail('la novedad "' + it.title + '" no dice nada');
  }
  return out;
}
const images = (doc) => doc.weeks.flatMap((w) => w.parts.filter((p) => p.kind === 'item').flatMap((it) => it.parts.filter((p) => p.kind === 'img').map((p) => w.id + ':' + p.file)));
const shape = (doc) => doc.weeks.map((w) => w.id + '[' + w.parts.map((p) => (p.kind === 'item' ? 'i(' + p.parts.map((x) => x.kind[0] + (x.rows ? x.rows.length : '')).join('') + ')' : p.kind[0] + (p.rows ? p.rows.length : ''))).join(' ') + ']').join(' ');

// La hoja del sitio, como la mete tools/build-site.mjs en sus páginas de texto: las dos primeras partes, sin comentarios.
function sheet() {
  const parts = read('site/site.css').split(/\/\* ==== [a-z ]+ ==== \*\/\n/);
  if (parts.length !== 3) throw new Error('site/site.css has to keep its three parts, and has ' + parts.length);
  return (parts[0] + parts[1]).replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("fonts\//g, 'url("site/fonts/').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
// Lo propio de esta página: la semana como rótulo, la novedad con su imagen debajo.
const OWN = [
  '.doc .week { margin-top: 64px; padding-top: 30px; border-top: 1px solid var(--line); }',
  '.doc .week:first-of-type { margin-top: 44px; }',
  '.doc .week h2 { position: relative; margin: 0 0 4px; padding-left: 16px; color: var(--muted); font: 400 13px/1.5 var(--mono); letter-spacing: .02em; }',
  '.doc .week h2::before { content: ""; position: absolute; left: 0; top: 2px; width: 7px; height: 14px; border-radius: 2px; background: var(--fill); }',
  '.doc .week h3 { margin: 34px 0 8px; font-size: 21px; color: var(--fg); }',
  '.doc .week h2 + h3 { margin-top: 18px; }',
  '.doc .shot { margin: 18px 0 8px; }',
  '.doc .shot a { display: block; }',
  '.doc .shot img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--soft); }',
  '.doc .week .under { margin: 28px 0 0; font: 400 12.5px/1.5 var(--mono); letter-spacing: .02em; }',
].join('\n');

function page(lang, doc) {
  const t = TEXT[lang]; const up = lang === 'es' ? '../' : ''; const url = pageUrl(lang);
  if (t.title.length > 62) throw new Error('título de la página (' + lang + ') de ' + t.title.length + ' caracteres: hasta 62');
  if (t.desc.length < 120 || t.desc.length > 158) throw new Error('descripción de la página (' + lang + ') de ' + t.desc.length + ' caracteres: va entre 120 y 158');
  const card = SITE + (/const CARD = SITE \+ '([^']+)'/.exec(read('tools/build-site.mjs')) || [])[1];
  const cardAlt = (new RegExp("const CARD_ALT = \\{ en: '([^']+)', es: '([^']+)' \\}").exec(read('tools/build-site.mjs')) || [])[lang === 'en' ? 1 : 2];
  if (/undefined$/.test(card) || !cardAlt) throw new Error('no se encontró la imagen para compartir en tools/build-site.mjs');
  const part = (p, pad) => {
    if (p.kind === 'p') return pad + '<p>' + inline(p.text) + '</p>';
    if (p.kind === 'small') return pad + '<p class="under">' + inline(p.text) + '</p>';
    if (p.kind === 'list') return pad + '<ul>\n' + p.rows.map((r) => pad + '  <li>' + inline(r) + '</li>').join('\n') + '\n' + pad + '</ul>';
    if (p.kind === 'img') { const s = imageSize(fs.readFileSync(path.join(ROOT, IMG_DIR, lang, p.file))); const src = up + IMG_DIR + '/' + lang + '/' + p.file; return pad + '<figure class="shot"><a href="' + src + '"><img src="' + src + '" alt="' + esc(p.alt) + '" width="' + s.w + '" height="' + s.h + '" loading="lazy" decoding="async"></a></figure>'; }
    return [pad + '<h3>' + inline(p.title) + '</h3>'].concat(p.parts.map((x) => part(x, pad))).join('\n');
  };
  const weeks = doc.weeks.map((w) => '  <section class="week" id="' + (w.id === 'earlier' ? 'earlier' : 'week-' + w.id) + '">\n    <h2>' + inline(w.title) + '</h2>\n' + w.parts.map((p) => part(p, '    ')).join('\n') + '\n  </section>').join('\n\n');
  const a = (href, en, es, here) => '<a href="' + href + '"' + (here ? ' aria-current="page"' : '') + '>' + (lang === 'en' ? en : es) + '</a>';
  const own = lang === 'en' ? '' : './'; // en /es/, las páginas que tienen su versión en castellano
  const legal = [a('./', 'Home', 'Portada'), a(own + 'updates.html', 'What\'s new', 'Novedades', true), a(own + 'markdown-editor-mcp.html', 'Markdown editor for AI agents', 'Editor de Markdown para agentes de IA'),
    a(own + 'wysiwyg-markdown-editor.html', 'WYSIWYG Markdown editor', 'Editor de Markdown WYSIWYG'), a(up + 'privacy.html', 'Privacy', 'Privacidad'), a(up + 'terms.html', 'Terms', 'Términos'), a(up + 'support.html', 'Support', 'Ayuda')].join('');
  const lede = doc.lede.map((p, i) => '  <p' + (i ? '' : ' class="lede"') + '>' + inline(p) + '</p>').join('\n');
  const head = [
    '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<!-- Generada por tools/build-updates.mjs desde tools/updates.' + lang + '.md. No se edita a mano. -->',
    // la app, en "automático", sigue el idioma de la página que se vio
    '<script>try{localStorage.setItem("mdtools:site-lang","' + lang + '")}catch(e){}</script>',
    '<title>' + esc(t.title) + '</title>', '<meta name="description" content="' + esc(t.desc) + '">', '<link rel="canonical" href="' + url + '">',
    '<link rel="alternate" hreflang="en" href="' + pageUrl('en') + '">', '<link rel="alternate" hreflang="es" href="' + pageUrl('es') + '">', '<link rel="alternate" hreflang="x-default" href="' + pageUrl('en') + '">',
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="SharpMD">', '<meta property="og:title" content="' + esc(t.title) + '">',
    '<meta property="og:description" content="' + esc(t.desc) + '">', '<meta property="og:url" content="' + url + '">', '<meta property="og:locale" content="' + t.locale + '">',
    '<meta property="og:image" content="' + card + '">', '<meta property="og:image:type" content="image/png">', '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:alt" content="' + esc(cardAlt) + '">',
    '<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:title" content="' + esc(t.title) + '">', '<meta name="twitter:description" content="' + esc(t.desc) + '">', '<meta name="twitter:image" content="' + card + '">', '<meta name="twitter:image:alt" content="' + esc(cardAlt) + '">',
    '<meta name="theme-color" content="#121418" media="(prefers-color-scheme: dark)">', '<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">',
    '<link rel="preload" href="' + up + 'site/fonts/figtree.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="icon" type="image/png" sizes="32x32" href="' + up + 'icons/icon32.png">', '<link rel="icon" type="image/png" sizes="16x16" href="' + up + 'icons/icon16.png">',
    '<style>', sheet().replace(/url\("site\//g, 'url("' + up + 'site/'), OWN, '</style>',
  ].join('\n');
  const lang2 = '<div class="lang"><a href="' + (lang === 'en' ? '' : '../') + 'updates.html"' + (lang === 'en' ? ' class="on" aria-current="true"' : '') + ' hreflang="en">EN</a><a href="' + (lang === 'es' ? '' : 'es/') + 'updates.html"' + (lang === 'es' ? ' class="on" aria-current="true"' : '') + ' hreflang="es">ES</a></div>';
  return ['<!doctype html>', '<html lang="' + lang + '">', '<head>', head, '</head>', '<body class="doc">', '<main>',
    '  <div class="top"><a class="brand" href="./"><img src="' + up + 'icons/logo.svg" alt="" width="26" height="26"><span><b>Sharp</b>MD</span></a>' + lang2 + '</div>',
    '', '  <h1>' + inline(doc.title) + '</h1>', lede, '', weeks, '',
    '  <p class="next"><a class="btn fill" href="' + up + 'src/app.html">' + t.open + '</a></p>', '  <p>' + t.home + '</p>',
    '  <p class="legal">' + legal + '</p>', '</main>', '</body>', '</html>', ''].join('\n');
}

// La nota de la guía: el mismo texto, sin las imágenes ni los identificadores, y con un cierre que la une a la guía.
function note(lang, doc) {
  const out = ['# ' + doc.title, '', ...doc.lede.flatMap((p) => [p, ''])];
  const part = (p) => {
    if (p.kind === 'p') return [p.text, ''];
    if (p.kind === 'small') return ['*' + p.text + '*', ''];
    if (p.kind === 'list') return [...p.rows.map((r) => '- ' + r), ''];
    if (p.kind === 'img') return [];
    return ['### ' + p.title, '', ...p.parts.flatMap(part)];
  };
  for (const w of doc.weeks) out.push('## ' + w.title, '', ...w.parts.flatMap(part));
  out.push(TEXT[lang].note, '', '<!-- Generada por tools/build-updates.mjs desde tools/updates.' + lang + '.md. No se edita a mano. -->', '');
  return out.join('\n');
}

// Lo que tiene que haber en cada archivo generado. Antes revisa que las dos fuentes digan lo mismo y que cada imagen
// exista, mida y pese lo que corresponde: si algo no cierra, falla con el motivo.
export function render() {
  const docs = Object.fromEntries(LANGS.map((l) => [l, parse(l)]));
  if (shape(docs.en) !== shape(docs.es)) throw new Error('las dos fuentes no tienen la misma forma (semanas, novedades y bloques en el mismo orden):\n  en: ' + shape(docs.en) + '\n  es: ' + shape(docs.es));
  if (images(docs.en).join() !== images(docs.es).join()) throw new Error('las dos fuentes no nombran las mismas imágenes');
  for (const l of LANGS) for (const ref of images(docs[l])) {
    const rel = IMG_DIR + '/' + l + '/' + ref.split(':')[1]; const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) throw new Error('falta la imagen ' + rel + ' (las arma tests/updates-shots.mjs)');
    const size = imageSize(fs.readFileSync(file));
    if (!size) throw new Error(rel + ' no es un WebP ni un PNG');
    if (size.w > IMG_MAX_WIDTH) throw new Error(rel + ' mide ' + size.w + ' px de ancho: hasta ' + IMG_MAX_WIDTH);
    if (fs.statSync(file).size > IMG_MAX_BYTES) throw new Error(rel + ' pesa ' + Math.round(fs.statSync(file).size / 1024) + ' KB: hasta ' + IMG_MAX_BYTES / 1024);
  }
  const want = {};
  for (const l of LANGS) { want[(l === 'es' ? 'es/' : '') + 'updates.html'] = page(l, docs[l]); want['src/guide/' + l + '/updates.md'] = note(l, docs[l]); }
  return { want, docs };
}
// Los archivos que no dicen lo que tienen que decir. had(rel) devuelve lo que hay hoy en ese archivo, o null si no existe.
export const staleOf = (want, had) => Object.keys(want).filter((rel) => had(rel) !== want[rel]);
const onDisk = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? read(rel) : null);

export function build(check) {
  const { want, docs } = render();
  const stale = staleOf(want, onDisk);
  if (!check) for (const rel of stale) { const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, want[rel]); }
  return { stale, docs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { stale } = build(check);
  console.log(stale.length ? (check ? 'novedades: quedó atrás ' : 'novedades: se escribió ') + stale.join(', ') : 'novedades: la página y la nota de la guía están al día');
  if (check && stale.length) process.exit(1);
}
