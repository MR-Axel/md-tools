// Contraste de los doce temas incluidos. Sin navegador: lee la tabla de src/theme.js y calcula las razones de
// contraste de WCAG 2 para cada par de colores que la app pone uno sobre otro. AA: 4.5 en texto, 3 en controles.
// También mira que los dos temas de siempre coincidan con content.css y que la tira de la portada use los mismos colores.
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const box = { LMD: {}, window: { matchMedia: () => ({ matches: false }) }, localStorage: { setItem() {} }, document: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'theme.js'), 'utf8'), box);
const TH = box.LMD.theme; const P = TH.PRESETS;
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const HEX = /^#[0-9a-f]{6}$/;
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (top, under, a) => '#' + rgb(top).map((v, i) => Math.round(v * a + rgb(under)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
const VERBOSE = process.argv.includes('-v');

console.log('La tabla');
check('doce temas: seis claros y seis oscuros', P.length === 12 && P.filter((p) => p.dark).length === 6, P.map((p) => p.id));
check('los doce son de todos los planes: ninguno pide el plan pago, y sin el plan se aplican igual', P.every((p) => !('free' in p)) && typeof TH.locked === 'undefined' && P.every((p) => { const got = TH.chosen({ preset: p.id, theme: p.dark ? 'dark' : 'light', supporter: false }); return p.id === 'lima' || p.id === 'noche' ? got === null : got === p; }));
check('ids y nombres únicos y cortos', new Set(P.map((p) => p.id)).size === 12 && new Set(P.map((p) => p.name)).size === 12 && P.every((p) => /^[a-z]{3,10}$/.test(p.id) && p.name.length <= 10));
const KEYS = 'bg side soft code fg muted faint line accent fill fillFg link sel danger k s n f c t b'.split(' ');
check('cada tema trae los mismos colores, todos #rrggbb', P.every((p) => Object.keys(p.c).join() === KEYS.join() && KEYS.every((k) => HEX.test(p.c[k]))), P.filter((p) => !KEYS.every((k) => HEX.test(p.c[k] || ''))).map((p) => p.id));
check('el fondo va con el modo', P.every((p) => TH.paperOk(p.c.bg, p.dark)), P.filter((p) => !TH.paperOk(p.c.bg, p.dark)).map((p) => p.id));
const near = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (P[i].c.bg === P[j].c.bg || (P[i].dark === P[j].dark && P[i].c.fill === P[j].c.fill)) near.push(P[i].id + '=' + P[j].id);
check('ningún par repite el fondo ni el acento', near.length === 0, near);

console.log('Contraste AA');
for (const p of P) {
  const c = p.c; const bad = []; const all = [];
  const tint = p.id === 'lima' ? ['#65a30d', 0.16] : p.id === 'noche' ? ['#bef264', 0.14] : [c.fill, 0.17]; // los dos de siempre traen su tinte en content.css
  const need = (label, a, b, min) => { const r = TH.contrast(a, b); all.push(label + ' ' + r.toFixed(2)); if (r < min) bad.push(label + ' ' + r.toFixed(2) + ' < ' + min); };
  const papers = { fondo: c.bg, panel: c.soft, lateral: c.side, código: c.code };
  for (const [name, bg] of Object.entries(papers)) {
    need('texto/' + name, c.fg, bg, 7); // el texto principal llega a AAA
    need('secundario/' + name, c.muted, bg, 4.5);
    need('tenue/' + name, c.faint, bg, 4.5);
    need('acento/' + name, c.accent, bg, 4.5);
    need('enlace/' + name, c.link, bg, 4.5);
  }
  need('peligro/fondo', c.danger, c.bg, 4.5); need('peligro/panel', c.danger, c.soft, 4.5);
  need('texto del botón/botón', c.fillFg, c.fill, 4.5);
  need('botón/fondo', c.fill, c.bg, 3); need('botón/panel', c.fill, c.soft, 3);
  need('texto/selección', c.fg, c.sel, 4.5);
  need('selección/fondo', c.sel, c.bg, 1.15);
  // La pestaña y la opción elegidas: el acento sobre su propio tinte al 17 %.
  need('acento/tinte sobre fondo', c.accent, mix(tint[0], c.bg, tint[1]), 4.5); need('acento/tinte sobre panel', c.accent, mix(tint[0], c.soft, tint[1]), 4.5);
  need('texto/tinte', c.fg, mix(tint[0], c.bg, tint[1]), 4.5);
  // Citas y tablas: el texto secundario de la cita sobre el fondo, y el encabezado de la tabla sobre el panel (ya medidos arriba).
  for (const k of 'ksnfctb') { need('sintaxis ' + k + '/código', c[k], c.code, 4.5); need('sintaxis ' + k + '/panel', c[k], c.soft, 4.5); }
  // El tinte de los bloques de código (9 %) no baja el contraste por debajo de AA con ninguno de los colores de la lista.
  for (const tint of ['#3b82f6', '#a855f7', '#22c55e', '#eab308', '#f97316', '#ec4899']) need('texto/código teñido ' + tint, c.fg, mix(tint, c.code, 0.13), 7);
  // Diagramas: el texto del nodo sobre su relleno, y el trazo sobre el fondo, como lo arma LMD.theme.mermaid.
  need('diagrama: texto/nodo', c.fg, c.soft, 7); need('diagrama: trazo/fondo', c.muted, c.bg, 3); need('diagrama: borde del nodo/nodo', c.muted, c.soft, 3);
  // Los dos de alto contraste: los bordes de los controles se distinguen del fondo.
  if (p.id === 'tiza' || p.id === 'carbon') { need('borde/fondo', c.line, c.bg, 3); need('borde/panel', c.line, c.soft, 3); }
  check(p.name + (p.dark ? ' (oscuro)' : ' (claro)') + ': ' + all.length + ' pares', bad.length === 0, bad);
  if (VERBOSE) console.log('       ' + all.join(' · '));
}

console.log('Coherencia con el resto');
const css = fs.readFileSync(path.join(root, 'src', 'content.css'), 'utf8');
const block = (cls) => { const m = new RegExp('\\.lmd-root\\.' + cls + ' \\{([^}]*)\\}').exec(css); const o = {}; (m ? m[1] : '').replace(/(--[a-z-]+):\s*(#[0-9a-f]{6})/g, (x, k, v) => { o[k] = v; }); return o; };
const MAP = { bg: '--bg', side: '--bg-side', soft: '--bg-soft', code: '--bg-code', fg: '--fg', muted: '--fg-muted', faint: '--fg-faint', line: '--line', accent: '--accent', fillFg: '--accent-fg', link: '--link' };
for (const [id, cls] of [['lima', 'lmd-light'], ['noche', 'lmd-dark']]) {
  const b = block(cls); const p = TH.byId(id); const off = Object.keys(MAP).filter((k) => b[MAP[k]] !== p.c[k]).map((k) => k + ' ' + p.c[k] + ' != ' + b[MAP[k]]);
  check(p.name + ' es el tema de siempre: mismos colores que content.css', off.length === 0, off);
}
const mer = TH.mermaid({ preset: 'marea', theme: 'dark', supporter: true });
check('un tema incluido arma los diagramas con sus colores, y el de siempre deja los de Mermaid', mer.theme === 'base' && mer.themeVariables.primaryTextColor === TH.byId('marea').c.fg && TH.mermaid({ preset: '', theme: 'dark' }).theme === 'dark' && TH.mermaid({ preset: 'marea', theme: 'dark', supporter: false }).theme === 'base');
const landing = fs.readFileSync(path.join(root, 'tools', 'landing.src.html'), 'utf8');
const strip = P.filter((p) => !new RegExp('data-theme="' + p.id + '"[^>]*--b:' + p.c.bg + ';--f:' + p.c.fg + ';--m:' + p.c.muted + ';--c:' + p.c.code + ';--l:' + p.c.line + ';--a:' + p.c.fill).test(landing)).map((p) => p.id);
check('la tira de la portada dibuja los doce con los mismos colores', strip.length === 0, strip);

const bad = results.filter((r) => !r).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
process.exit(bad ? 1 : 0);
