// Las hojas de estilo cierran todas sus llaves. Un bloque @media sin cerrar deja todo lo que sigue valiendo solo
// para ese ancho, y no rompe nada a la vista hasta que alguien mira en otra pantalla.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };

// Sin comentarios ni cadenas, para que una llave escrita dentro de ellos no cuente.
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
function balance(css) {
  let depth = 0; let max = 0; let line = 1; let firstNegative = 0; const open = [];
  for (const ch of strip(css)) {
    if (ch === '\n') line++;
    else if (ch === '{') { depth++; max = Math.max(max, depth); open.push(line); }
    else if (ch === '}') { depth--; open.pop(); if (depth < 0 && !firstNegative) firstNegative = line; }
  }
  return { depth, max, firstNegative, left: open.slice(0, 3) };
}

// src/ es la app; site/site.css es la hoja que comparten las páginas del sitio (la portada y las de búsqueda la llevan adentro).
const files = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.css')).map((f) => 'src/' + f).concat('site/site.css');
for (const f of files) {
  const b = balance(fs.readFileSync(path.join(root, f), 'utf8'));
  check(f + ': todas las llaves cierran', b.depth === 0 && !b.firstNegative, b);
  check(f + ': ninguna regla queda a más de tres niveles', b.max <= 3, b.max);
}
// Los estilos que van dentro de una página (portada, pago, ayuda, privacidad, API).
for (const f of ['tools/landing.src.html', 'pay.html', 'support.html', 'privacy.html', 'api.html', 'terms.html', 'refunds.html', 'acceptable-use.html', 'copyright.html', 'tools/markdown-editor-mcp.src.html', 'tools/wysiwyg-markdown-editor.src.html', 'src/app.html']) {
  if (!fs.existsSync(path.join(root, f))) continue;
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  if (!css) continue;
  const b = balance(css);
  check(f + ': las llaves de su <style> cierran', b.depth === 0 && !b.firstNegative, b);
}
// Marcas de un merge sin resolver, en cualquier archivo que se publica.
const published = ['src', 'server', 'tools'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => /\.(js|mjs|css|html|json)$/.test(f)).map((f) => d + '/' + f)).concat(fs.readdirSync(root).filter((f) => /\.(html|js|json|webmanifest|txt|xml)$/.test(f)));
const marked = published.filter((f) => /^(<<<<<<< |>>>>>>> |=======$)/m.test(fs.readFileSync(path.join(root, f), 'utf8')));
check('ningún archivo publicado tiene marcas de un merge sin resolver', !marked.length, marked);

// El sitio no pide nada a otros: las tipografías salen de site/fonts, con su licencia al lado, y ninguna página nombra un
// servicio de fuentes. Las páginas generadas llevan la hoja adentro; las escritas a mano la enlazan.
const sitePages = ['index.html', 'es/index.html', 'markdown-editor-mcp.html', 'es/markdown-editor-mcp.html', 'wysiwyg-markdown-editor.html', 'es/wysiwyg-markdown-editor.html', 'pay.html', 'support.html', 'privacy.html', 'api.html', 'terms.html', 'refunds.html', 'acceptable-use.html', 'copyright.html'];
const sheet = fs.readFileSync(path.join(root, 'site', 'site.css'), 'utf8');
const fontFiles = [...sheet.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map((m) => m[1]);
check('site/site.css: sus tipografías están en site/fonts, en woff2, con font-display: swap y su licencia', fontFiles.length === 2 && fontFiles.every((f) => /\.woff2$/.test(f) && fs.existsSync(path.join(root, 'site', f))) && (sheet.match(/font-display: swap/g) || []).length === 2 && ['OFL-Figtree.txt', 'OFL-JetBrainsMono.txt'].every((f) => /SIL Open Font License/.test(fs.readFileSync(path.join(root, 'site', 'fonts', f), 'utf8'))), fontFiles);
const kb = fontFiles.reduce((n, f) => n + fs.statSync(path.join(root, 'site', f)).size, 0) / 1024;
check('las tipografías de la primera pantalla pesan menos de 120 KB entre todas', kb < 120, Math.round(kb));
const lost = sitePages.filter((f) => { const h = fs.readFileSync(path.join(root, f), 'utf8'); const up = f.startsWith('es/') ? '../' : ''; return /fonts\.(googleapis|gstatic)|MDT Inter|vendor\/fonts/.test(h) || !(h.includes('url("' + up + 'site/fonts/figtree.woff2")') || h.includes('<link rel="stylesheet" href="site/site.css">')) || !h.includes('<link rel="preload" href="' + up + 'site/fonts/figtree.woff2" as="font" type="font/woff2" crossorigin>'); });
check('cada página del sitio usa la hoja compartida y precarga su tipografía desde el propio sitio', !lost.length, lost);
// La tira de temas de la portada muestra los colores de cada tema de la app (los de src/theme.js): esos no cuentan.
check('el lima es uno solo en todo el sitio: el del logo', !sitePages.concat('site/site.css').some((f) => /#bef264/i.test(fs.readFileSync(path.join(root, f), 'utf8').replace(/<li data-theme="[^"]*" style="[^"]*">/g, ''))) && /--fill: #c5f467/.test(sheet));
check('site/ no va en el paquete de la extensión', /^\/site\/ export-ignore\r?$/m.test(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')));

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
