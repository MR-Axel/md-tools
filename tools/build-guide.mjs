// Pone al día la referencia de la API dentro de la guía de la app (src/guide/en/api.md y src/guide/es/api.md).
// La lista de pedidos sale de server/openapi.json (que arma tools/build-openapi.mjs): lo que está entre las dos marcas
// de cada nota se reescribe entero, y lo de afuera (la introducción, cómo autenticarse) queda como se escribió a mano.
// Se corre después de cambiar la API:
//   node tools/build-openapi.mjs
//   node tools/build-guide.mjs
// Con --check no escribe nada: sale con 1 si alguna nota quedó atrás (lo usa tests/guide.mjs).
// Los resúmenes de cada pedido están en inglés en openapi.json, y así van también en la nota en español.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- api:start (tools/build-guide.mjs) -->'; const END = '<!-- api:end -->';
const TEXT = {
  en: { head: ['Request', 'What it does'], tags: {}, events: 'Webhook events', count: (n) => n + ' requests. The base address is `' + '{base}' + '`.' },
  es: { head: ['Pedido', 'Qué hace'], tags: { Notes: 'Notas', Boards: 'Tableros', Comments: 'Comentarios', Sharing: 'Compartir', Images: 'Imágenes', Inbound: 'Direcciones de entrada' }, events: 'Eventos de los webhooks',
    count: (n) => n + ' pedidos. La dirección base es `' + '{base}' + '`.' },
};
const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function block(lang, api) {
  const t = TEXT[lang]; const out = []; let n = 0;
  const byTag = new Map(api.tags.map((tag) => [tag.name, []]));
  for (const [route, ops] of Object.entries(api.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = (op.tags || [])[0]; if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push('| `' + method.toUpperCase() + ' ' + route + '` | ' + cell(op.summary) + ' |'); n++;
    }
  }
  out.push(t.count(n).replace('{base}', api.servers[0].url), '');
  for (const [tag, rows] of byTag) {
    if (!rows.length) continue;
    out.push('### ' + (t.tags[tag] || tag), '', '| ' + t.head[0] + ' | ' + t.head[1] + ' |', '|---|---|', ...rows, '');
  }
  const events = (((api.components || {}).schemas || {}).Event || { properties: { type: { enum: [] } } }).properties.type.enum.filter((e) => e !== 'ping');
  if (events.length) out.push('### ' + t.events, '', events.map((e) => '`' + e + '`').join(', '), '');
  return out.join('\n').trimEnd();
}

export function build(check) {
  const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'openapi.json'), 'utf8'));
  const stale = [];
  for (const lang of Object.keys(TEXT)) {
    const file = path.join(ROOT, 'src', 'guide', lang, 'api.md');
    const had = fs.readFileSync(file, 'utf8'); const nl = /\r\n/.test(had) ? '\r\n' : '\n';
    const a = had.indexOf(START); const b = had.indexOf(END);
    if (a < 0 || b < a) throw new Error('faltan las marcas en ' + file);
    const next = had.slice(0, a) + START + nl + nl + block(lang, api).split('\n').join(nl) + nl + nl + had.slice(b);
    if (next === had) continue;
    stale.push(path.relative(ROOT, file));
    if (!check) fs.writeFileSync(file, next);
  }
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = build(check);
  console.log(stale.length ? (check ? 'guía: quedó atrás ' : 'guía: se actualizó ') + stale.join(', ') : 'guía: la referencia de la API está al día');
  if (check && stale.length) process.exit(1);
}
