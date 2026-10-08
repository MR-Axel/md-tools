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

const files = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.css')).map((f) => 'src/' + f);
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

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
