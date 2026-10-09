// Herramienta: diagramas explorables. Un diagrama de flujo de Mermaid dentro de la nota se recorre en vez de solo
// mirarse: acercar y arrastrar, elegir un nodo para ver de dónde recibe y a dónde envía, leer su detalle, plegar
// los grupos, buscar un nodo por nombre y pasar a pantalla completa. El diagrama sigue siendo el bloque mermaid de
// siempre. El detalle de cada nodo va en comentarios del mismo bloque, que Mermaid no dibuja:
//   %% @id: texto en Markdown, con [enlaces](otra-nota.md), [secciones](#titulo), [[notas]] o direcciones
// Varias líneas para un mismo nodo se suman. Apagada, la nota se ve igual que siempre.
// La idea sale de Archify (github.com/tt-a1i/archify): acá no hay código suyo.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const icon = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    find: icon('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>'),
    plus: icon('<path d="M12 6v12M6 12h12"/>'), minus: icon('<path d="M6 12h12"/>'),
    fit: icon('<path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5"/>'),
    fold: icon('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8.5 12h7"/>'),
    unfold: icon('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8.5 12h7M12 8.5v7"/>'),
    full: icon('<path d="M9.5 4.5h-5v5M14.5 4.5h5v5M9.5 19.5h-5v-5M14.5 19.5h5v-5"/>'),
    small: icon('<path d="M4.5 9.5h5v-5M19.5 9.5h-5v-5M4.5 14.5h5v5M19.5 14.5h-5v5"/>'),
    close: icon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  };
  const NS = 'http://www.w3.org/2000/svg';
  const MIN = 0.4; const MAX = 6; const STEP = 1.3;
  let core = null; let on = false; let wired = false; let seq = 0;
  const live = new Set(); // los diagramas armados en la nota abierta
  const mem = new Map(); // por nota y lugar en ella: qué grupos quedaron plegados y qué nodo estaba elegido
  let fullNow = null;
  const opt = (k, d) => LMD.tools.opt(k, d);
  const still = () => !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => plain(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k])); return n; };

  // ---------- Leer el bloque ----------
  // El detalle de cada nodo: { id: [líneas] }.
  const NOTE = /^\s*%%\s*@([^\s:]+)\s*:\s*(.*\S)\s*$/;
  function notesOf(code) {
    const out = new Map();
    String(code || '').split('\n').forEach((l) => { const m = NOTE.exec(l); if (!m) return; if (!out.has(m[1])) out.set(m[1], []); out.get(m[1]).push(m[2]); });
    return out;
  }
  // Los grupos (subgraph … end) con la línea donde abren y cierran. Uno sin nombre propio (solo título) recibe el
  // que le pone Mermaid, subGraphN, contando en el orden en que cierran.
  function blocks(lines) {
    const out = []; const stack = []; let closed = 0;
    lines.forEach((raw, i) => {
      const l = raw.trim().replace(/;$/, ''); let m;
      if (/^%%/.test(l)) return;
      if ((m = /^subgraph\b\s*(.*)$/.exec(l))) { stack.push({ open: i, head: m[1].trim() }); return; }
      if (l !== 'end' || !stack.length) return;
      const b = stack.pop(); b.close = i;
      const named = /^([^\s[\]"]+)\s*(?:\[.*\])?$/.exec(b.head);
      b.id = named ? named[1] : 'subGraph' + closed; b.auto = !named; closed++;
      out.push(b);
    });
    return out;
  }
  // El mismo diagrama con el nombre de cada grupo escrito: así no cambia cuando se pliega otro.
  function canon(code) {
    const lines = String(code || '').split('\n');
    blocks(lines).forEach((b) => {
      if (!b.auto) return;
      const title = b.head.replace(/^"(.*)"$/, '$1').replace(/"/g, '#quot;');
      lines[b.open] = /^[ \t]*/.exec(lines[b.open])[0] + 'subgraph ' + b.id + ' ["' + title + '"]';
    });
    return lines.join('\n');
  }
  // Los textos de una línea (comillas, formas, textos de flecha) fuera del camino, para tocar solo los nombres.
  function mask(line) {
    const keep = []; const put = (s) => { keep.push(s); return '\u0000' + (keep.length - 1) + '\u0000'; };
    let l = line.replace(/"[^"]*"/g, put).replace(/\|[^|]*\|/g, put);
    for (let before = ''; before !== l;) { before = l; l = l.replace(/\[[^[\]]*\]|\{[^{}]*\}|\([^()]*\)/g, put); }
    l = l.replace(/(?<![-=.])(--|==|-\.)(\s+[^|>]*?\s+)(-->|==>|\.->|---|===|-\.-)/g, (m, a, t, z) => a + put(t) + z);
    return { l, keep };
  }
  function unmask(l, keep) { for (let before = ''; before !== l;) { before = l; l = l.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[+n]); } return l; }
  const ARROW = /\s*(?:(?<=\s)[<ox])?<?(?:-{2,}|={2,}|-\.+-?|~{3,})[>ox]?\s*/;
  const IDC = '\\w\\u00C0-\\uFFFF';
  // El diagrama con un grupo plegado: el grupo pasa a ser un nodo con su nombre, y las flechas que entraban o salían
  // de lo de adentro ahora llegan a él. inner: los nodos y grupos de adentro. Devuelve null si no encuentra el grupo.
  function foldCode(code, id, inner, title) {
    const lines = String(code || '').split('\n'); const b = blocks(lines).find((x) => x.id === id); if (!b) return null;
    const ids = Array.from(inner).filter((x) => x && x !== id).sort((p, q) => q.length - p.length).map(reEsc);
    const re = ids.length ? new RegExp('(?<![' + IDC + ']-?)(?:' + ids.join('|') + ')(?![' + IDC + ']|-[' + IDC + '])(?:\\u0000\\d+\\u0000)?(?::::[\\w-]+)?', 'g') : null;
    const out = []; const seen = new Set();
    lines.forEach((raw, i) => {
      const t = raw.trim(); const inside = i >= b.open && i <= b.close; let m;
      if (/^%%/.test(t)) { out.push(raw); return; }
      if (!t) { if (!inside) out.push(raw); return; }
      if (inside && (i === b.open || i === b.close || /^(subgraph|end|direction)\b/.test(t))) return;
      // Los estilos por número de flecha dejan de coincidir: no van.
      if (/^linkStyle\b/.test(t)) return;
      if ((m = /^(?:style|click)\s+(\S+)/.exec(t))) { if (!inner.has(m[1])) out.push(raw); return; }
      if ((m = /^class\s+(\S+)\s/.exec(t))) { if (!m[1].split(',').some((x) => inner.has(x))) out.push(raw); return; }
      if (/^classDef\b/.test(t) || !re) { out.push(raw); return; }
      const k = mask(raw); let hit = false;
      const next = k.l.replace(re, () => { hit = true; return id; });
      if (!hit) { out.push(raw); return; }
      // Lo que queda: una flecha con una punta afuera. Una declaración sola o una flecha interna desaparecen.
      const ends = next.trim().replace(/;$/, '').split(ARROW).map((p) => p.split('&').map((x) => x.replace(/\u0000\d+\u0000|:::[\w-]+/g, '').trim()).filter(Boolean)).filter((p) => p.length);
      if (ends.length < 2 || ends.every((p) => p.every((x) => x === id))) return;
      const text = unmask(next, k.keep); if (seen.has(text.trim())) return;
      seen.add(text.trim()); out.push(text);
    });
    out.push('  ' + id + '["' + String(title || id).replace(/"/g, '#quot;') + '"]');
    return out.join('\n');
  }

  // ---------- Dibujar ----------
  async function draw(code) {
    await core.ensure('mermaid');
    window.mermaid.initialize(Object.assign({ startOnLoad: false, securityLevel: 'strict', flowchart: { curve: core.shape === 'square' ? 'linear' : 'basis' } }, LMD.theme.mermaid(core.settings)));
    const id = 'lmd-xp-' + (++seq);
    try { return (await window.mermaid.render(id, code)).svg; } finally { document.querySelectorAll('body > [id^="dlmd-xp-"], body > #' + id).forEach((n) => n.remove()); }
  }

  // Qué hay en el dibujo: nodos, flechas y grupos, leídos de lo que Mermaid dejó en el SVG.
  function index(ctx) {
    const svg = ctx.svg; const pre = svg.id + '-';
    const nodes = new Map(); const groups = new Map(); const edges = [];
    svg.querySelectorAll('g.node').forEach((g) => {
      if (g.id.indexOf(pre + 'flowchart-') !== 0) return;
      const id = g.id.slice(pre.length + 10).replace(/-\d+$/, ''); if (!id || nodes.has(id)) return;
      nodes.set(id, { id, el: g, label: plain(g.textContent) || id, inn: [], out: [] });
    });
    svg.querySelectorAll('g.cluster').forEach((g) => {
      if (g.id.indexOf(pre) !== 0) return;
      const id = g.id.slice(pre.length); const lab = g.querySelector('.cluster-label');
      groups.set(id, { id, el: g, lab, title: plain((lab || g).textContent) || id, members: new Set(), kids: [] });
    });
    const known = (id) => nodes.has(id) || groups.has(id);
    svg.querySelectorAll('path[data-edge][data-id]').forEach((p) => {
      // L_desde_hasta_N: los nombres pueden llevar guion bajo, así que se prueba cada corte contra lo que existe.
      const did = p.getAttribute('data-id'); const mid = did.replace(/^L_/, '').replace(/_\d+$/, ''); let a = ''; let b = '';
      for (let i = mid.indexOf('_'); i !== -1 && !a; i = mid.indexOf('_', i + 1)) { if (known(mid.slice(0, i)) && known(mid.slice(i + 1))) { a = mid.slice(0, i); b = mid.slice(i + 1); } }
      if (!a) return;
      const lab = Array.from(svg.querySelectorAll('g.edgeLabel g.label[data-id]')).find((n) => n.getAttribute('data-id') === did);
      const e = { a, b, el: p, lab: lab ? lab.closest('g.edgeLabel') : null, text: lab ? plain(lab.textContent) : '' };
      edges.push(e);
      if (nodes.has(a)) nodes.get(a).out.push(e);
      if (nodes.has(b)) nodes.get(b).inn.push(e);
    });
    // Quién está dentro de cada grupo se mira en el dibujo: el centro del nodo cae dentro de su recuadro.
    const rectOf = (g) => (g.querySelector('rect') || g).getBoundingClientRect();
    const within = (r, box) => { const x = r.left + r.width / 2; const y = r.top + r.height / 2; return x > box.left && x < box.right && y > box.top && y < box.bottom; };
    groups.forEach((g) => { g.r = rectOf(g.el); });
    nodes.forEach((n) => { const r = n.el.getBoundingClientRect(); groups.forEach((g) => { if (within(r, g.r)) g.members.add(n.id); }); });
    groups.forEach((g) => { groups.forEach((h) => { if (h !== g && h.r.width * h.r.height < g.r.width * g.r.height && within(h.r, g.r)) g.kids.push(h.id); }); });
    ctx.nodes = nodes; ctx.groups = groups; ctx.edges = edges;
    if (svg === ctx.svg0 && !ctx.groups0) { const have = new Set(blocks(ctx.code.split('\n')).map((b) => b.id)); ctx.groups0 = new Map(Array.from(groups).filter((x) => have.has(x[0]))); }
    decorate(ctx);
  }
  // Lo que se le suma al SVG para poder elegir con el cursor, con el dedo y con el teclado.
  function decorate(ctx) {
    ctx.nodes.forEach((n) => {
      const g = n.el; const folded = ctx.folded.has(n.id);
      g.setAttribute('data-xp-id', n.id); g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.classList.add('lmd-xp-node');
      g.classList.toggle('lmd-xp-folded', folded);
      g.setAttribute('aria-label', folded ? T('{a}, grupo plegado', { a: n.label }) : n.label);
      if (folded) g.setAttribute('aria-expanded', 'false');
      if (g.querySelector(':scope > .lmd-xp-ring')) return;
      let bb = null; try { bb = g.getBBox(); } catch (e) { bb = null; }
      if (!bb || !bb.width) return;
      // El aro y el punto nacen sin color, con el estilo puesto en el elemento: así no los pinta la hoja de Mermaid (que
      // colorea todo rect y circle de un nodo) ni se ven en un SVG que se baja o se copia. Los muestra content.css.
      g.insertBefore(svgEl('rect', { class: 'lmd-xp-ring', x: bb.x - 5, y: bb.y - 5, width: bb.width + 10, height: bb.height + 10, rx: 9, style: 'fill:none;stroke:none', 'pointer-events': 'none' }), g.firstChild);
      if (ctx.notes.has(n.id)) g.appendChild(svgEl('circle', { class: 'lmd-xp-dot', cx: bb.x + bb.width - 2, cy: bb.y + 2, r: 4.5, style: 'fill:none;stroke:none', 'pointer-events': 'none' }));
    });
    ctx.groups.forEach((g) => {
      if (!g.lab || !ctx.groups0 || !ctx.groups0.has(g.id)) return;
      g.lab.setAttribute('data-xp-group', g.id); g.lab.setAttribute('tabindex', '0'); g.lab.setAttribute('role', 'button'); g.lab.setAttribute('aria-expanded', 'true');
      g.lab.setAttribute('aria-label', T('Plegar {a}', { a: g.title })); g.lab.classList.add('lmd-xp-glabel');
    });
  }
  // El SVG como lo dejó Mermaid.
  function strip(svg) {
    svg.querySelectorAll('.lmd-xp-ring, .lmd-xp-dot').forEach((n) => n.remove());
    svg.querySelectorAll('[data-xp-id], [data-xp-group]').forEach((n) => { ['data-xp-id', 'data-xp-group', 'tabindex', 'role', 'aria-label', 'aria-expanded'].forEach((a) => n.removeAttribute(a)); });
    [svg].concat(Array.from(svg.querySelectorAll('[class*="lmd-xp-"]'))).forEach((n) => { Array.from(n.classList).filter((c) => c.indexOf('lmd-xp-') === 0).forEach((c) => n.classList.remove(c)); });
  }

  // ---------- Vista: acercar, alejar y mover ----------
  function apply(ctx, ease) {
    const moved = ctx.k !== 1 || !!ctx.x || !!ctx.y;
    ctx.pan.classList.toggle('lmd-xp-ease', !!ease && !still());
    ctx.pan.style.transform = moved ? 'translate(' + ctx.x.toFixed(2) + 'px,' + ctx.y.toFixed(2) + 'px) scale(' + ctx.k.toFixed(4) + ')' : '';
    ctx.stage.classList.toggle('lmd-xp-zoomed', moved);
  }
  // Acerca o aleja dejando quieto el punto (cx, cy) de la vista.
  function zoomAt(ctx, f, cx, cy, ease) {
    const k = clamp(ctx.k * f, ctx.min, MAX); const r = k / ctx.k;
    ctx.x = cx - (cx - ctx.x) * r; ctx.y = cy - (cy - ctx.y) * r; ctx.k = k;
    apply(ctx, ease);
  }
  const zoomBy = (ctx, f) => zoomAt(ctx, f, ctx.view.clientWidth / 2, ctx.view.clientHeight / 2, true);
  // El tamaño propio del dibujo. A pantalla completa la hoja mide eso y se acomoda con la escala.
  function size(ctx) {
    const vb = ctx.svg.viewBox && ctx.svg.viewBox.baseVal;
    ctx.W = vb && vb.width ? vb.width : ctx.svg.getBoundingClientRect().width || 1; ctx.H = vb && vb.height ? vb.height : ctx.svg.getBoundingClientRect().height || 1;
    ctx.pan.style.width = ctx.full ? ctx.W + 'px' : '';
  }
  // La vista entera: en la nota, el dibujo como estaba; a pantalla completa, entero y centrado.
  function fit(ctx, ease) {
    if (ctx.full) {
      let vw = ctx.view.clientWidth; let vh = ctx.view.clientHeight;
      // Con el detalle abierto el dibujo se acomoda en lo que queda libre: a su izquierda, o arriba en un teléfono.
      if (!ctx.card.hidden) {
        const c = ctx.card.getBoundingClientRect(); const v = ctx.view.getBoundingClientRect();
        if (c.width < v.width - 40) vw = Math.max(200, c.left - v.left - 12); else vh = Math.max(160, c.top - v.top - 8);
      }
      // Un dibujo muy ancho entra igual, por chico que quede; alejar llega un poco más allá de eso.
      ctx.k = Math.min(Math.min(vw / ctx.W, vh / ctx.H) * 0.92, 2.5); ctx.min = Math.min(MIN, ctx.k * 0.6); ctx.x = (vw - ctx.W * ctx.k) / 2; ctx.y = (vh - ctx.H * ctx.k) / 2;
      ctx.pan.classList.toggle('lmd-xp-ease', !!ease && !still());
      ctx.pan.style.transform = 'translate(' + ctx.x.toFixed(2) + 'px,' + ctx.y.toFixed(2) + 'px) scale(' + ctx.k.toFixed(4) + ')';
      ctx.stage.classList.remove('lmd-xp-zoomed');
      return;
    }
    ctx.k = 1; ctx.x = 0; ctx.y = 0; ctx.min = MIN; apply(ctx, ease);
  }
  // Deja un nodo a la vista: al medio si el dibujo está movido o a pantalla completa.
  function center(ctx, id) {
    const n = ctx.nodes.get(id); if (!n) return;
    if (!ctx.full && ctx.k === 1 && !ctx.x && !ctx.y) { n.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    const v = ctx.view.getBoundingClientRect(); const r = n.el.getBoundingClientRect();
    ctx.x += v.left + v.width / 2 - (r.left + r.width / 2); ctx.y += v.top + v.height / 2 - (r.top + r.height / 2);
    apply(ctx, true);
  }

  // ---------- Elegir un nodo ----------
  const keep = (ctx) => mem.set(ctx.key, { folded: Array.from(ctx.folded), sel: ctx.sel });
  function paint(ctx) {
    const svg = ctx.svg; const sel = ctx.sel && ctx.nodes.get(ctx.sel);
    svg.querySelectorAll('.lmd-xp-on, .lmd-xp-me').forEach((n) => n.classList.remove('lmd-xp-on', 'lmd-xp-me'));
    svg.classList.toggle('lmd-xp-sel', !!sel);
    ctx.lit = { nodes: [], edges: 0 };
    if (!sel) return;
    // Los vecinos directos o, siguiendo el recorrido, todo lo que llega al nodo y todo lo que sale de él.
    const ids = new Set([sel.id]); const lines = new Set();
    const walk = (key, end) => {
      const queue = [sel.id]; const done = new Set(queue);
      while (queue.length) {
        const n = ctx.nodes.get(queue.shift()); if (!n) continue;
        n[key].forEach((e) => { lines.add(e); ids.add(e[end]); if (ctx.reach && !done.has(e[end])) { done.add(e[end]); queue.push(e[end]); } });
      }
    };
    walk('out', 'b'); walk('inn', 'a');
    ids.forEach((id) => { const n = ctx.nodes.get(id); if (n) n.el.classList.add('lmd-xp-on'); });
    lines.forEach((e) => { e.el.classList.add('lmd-xp-on'); if (e.lab) e.lab.classList.add('lmd-xp-on'); });
    sel.el.classList.add('lmd-xp-me');
    ctx.lit = { nodes: Array.from(ids).filter((id) => ctx.nodes.has(id)), edges: lines.size };
  }
  function card(ctx) {
    const c = ctx.card; const n = ctx.sel && ctx.nodes.get(ctx.sel);
    ctx.stage.classList.toggle('lmd-xp-open', !!n);
    if (!n) { c.hidden = true; c.textContent = ''; return; }
    const notes = ctx.notes.get(n.id) || [];
    const chips = (list, end) => {
      const ids = []; list.forEach((e) => { if (ids.indexOf(e[end]) === -1) ids.push(e[end]); });
      return ids.map((id) => (ctx.nodes.has(id) ? '<button type="button" data-xp-go="' + esc(id) + '">' + esc(ctx.nodes.get(id).label) + '</button>' : '<i>' + esc((ctx.groups.get(id) || {}).title || id) + '</i>')).join('');
    };
    c.setAttribute('aria-label', T('Detalle de {a}', { a: n.label }));
    c.innerHTML = '<div class="lmd-xp-card-head"><b>' + esc(n.label) + '</b><button type="button" class="lmd-icon-btn" data-xp="close" title="' + esc(T('Cerrar')) + '" aria-label="' + esc(T('Cerrar')) + '">' + ICON.close + '</button></div>' +
      (notes.length ? '<div class="lmd-xp-note">' + notes.map((t) => '<p>' + core.inline(t) + '</p>').join('') + '</div>' : '') +
      (n.inn.length ? '<div class="lmd-xp-rel"><span>' + esc(T('Recibe de')) + '</span>' + chips(n.inn, 'a') + '</div>' : '') +
      (n.out.length ? '<div class="lmd-xp-rel"><span>' + esc(T('Envía a')) + '</span>' + chips(n.out, 'b') + '</div>' : '') +
      (n.inn.length || n.out.length ? '<button type="button" class="lmd-xp-reach" data-xp="reach" aria-pressed="' + (ctx.reach ? 'true' : 'false') + '">' + esc(T('Seguir el recorrido')) + '</button>' : '<p class="lmd-xp-lone">' + esc(T('Sin conexiones')) + '</p>');
    c.hidden = false;
    const box = c.querySelector('.lmd-xp-note'); if (!box) return;
    // Lo que apunta afuera se abre aparte; lo demás (otra nota, una sección) se sigue sin recargar.
    box.querySelectorAll('a[href]').forEach((a) => { if (/^[a-z][a-z0-9+.-]*:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } });
    box.querySelectorAll('p').forEach((p) => { const a = p.firstElementChild; if (a && a.tagName === 'A' && p.children.length === 1 && plain(p.textContent) === plain(a.textContent)) p.classList.add('lmd-xp-link'); });
    if (core.links && core.links.prep) core.links.prep(box);
  }
  // A pantalla completa el detalle flota sobre el dibujo: si tapa al nodo elegido o a un vecino, el dibujo se corre.
  function clear(ctx) {
    if (!ctx.full || ctx.card.hidden) return;
    const c = ctx.card.getBoundingClientRect(); const v = ctx.view.getBoundingClientRect();
    const lit = ctx.lit.nodes.map((id) => ctx.nodes.get(id).el.getBoundingClientRect()).filter((r) => r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom);
    if (!lit.length) return;
    // Al costado se corre hacia la izquierda; con el detalle abajo (teléfono), hacia arriba.
    if (c.width < v.width - 40) ctx.x -= Math.max.apply(null, lit.map((r) => r.right)) - c.left + 16; else ctx.y -= Math.max.apply(null, lit.map((r) => r.bottom)) - c.top + 16;
    apply(ctx, true);
  }
  function select(ctx, id, o) {
    o = o || {};
    const next = id && ctx.nodes.has(id) ? id : null;
    if (next !== ctx.sel) ctx.reach = false;
    ctx.sel = next; keep(ctx); paint(ctx); card(ctx);
    if (next && o.center) center(ctx, next);
    if (next) clear(ctx);
    if (next && o.focus) ctx.card.focus({ preventScroll: true });
  }

  // ---------- Buscar un nodo ----------
  function find(ctx, text) {
    ctx.q = norm(text);
    ctx.svg.querySelectorAll('.lmd-xp-hit').forEach((n) => n.classList.remove('lmd-xp-hit'));
    ctx.hits = ctx.q ? Array.from(ctx.nodes.values()).filter((n) => norm(n.label).indexOf(ctx.q) !== -1 || norm(n.id).indexOf(ctx.q) !== -1).map((n) => n.id) : [];
    ctx.svg.classList.toggle('lmd-xp-find', !!ctx.q);
    ctx.hits.forEach((id) => ctx.nodes.get(id).el.classList.add('lmd-xp-hit'));
    ctx.at = -1; count(ctx);
  }
  const count = (ctx) => { ctx.count.textContent = !ctx.q ? '' : ctx.at >= 0 ? (ctx.at + 1) + ' / ' + ctx.hits.length : String(ctx.hits.length); };
  function step(ctx, dir) {
    if (!ctx.hits.length) return;
    ctx.at = (ctx.at + dir + ctx.hits.length) % ctx.hits.length; count(ctx);
    select(ctx, ctx.hits[ctx.at], { center: true });
  }
  function finding(ctx, open) {
    ctx.finding = open; ctx.qIn.hidden = !open; ctx.box.classList.toggle('lmd-xp-finding', open); ctx.btn.find.setAttribute('aria-pressed', String(open));
    if (open) { ctx.qIn.focus({ preventScroll: true }); ctx.qIn.select(); find(ctx, ctx.qIn.value); } else { ctx.qIn.value = ''; find(ctx, ''); ctx.btn.find.focus({ preventScroll: true }); }
  }

  // ---------- Plegar grupos ----------
  // Los grupos de más afuera, que son los que se pliegan con el botón de la barra.
  const tops = (ctx) => Array.from(ctx.groups0 || []).map((x) => x[1]).filter((g) => !Array.from(ctx.groups0.values()).some((o) => o.kids.indexOf(g.id) !== -1));
  async function refold(ctx, focus) {
    const mine = ++ctx.turn; let svg = ctx.svg0;
    if (ctx.folded.size) {
      const g0 = ctx.groups0; const all = Array.from(ctx.folded).filter((id) => g0.has(id)); let code = ctx.code;
      // Uno que quedó dentro de otro plegado ya no está: se pliega el de afuera.
      all.filter((id) => !all.some((o) => o !== id && g0.get(o).kids.indexOf(id) !== -1)).forEach((id) => {
        const g = g0.get(id); const next = foldCode(code, id, new Set(Array.from(g.members).concat(g.kids)), g.title + ' (' + g.members.size + ')');
        if (next) code = next;
      });
      try { const holder = el('div'); holder.innerHTML = await draw(code); svg = holder.querySelector('svg'); } catch (e) { svg = null; }
      if (mine !== ctx.turn || !live.has(ctx)) return;
      if (!svg) { ctx.folded.clear(); svg = ctx.svg0; core.flash(T('No se pudo plegar ese grupo.'), 'warn'); }
    }
    if (ctx.svg !== svg) { ctx.pan.textContent = ''; ctx.pan.appendChild(svg); ctx.svg = svg; }
    index(ctx);
    if (ctx.sel && !ctx.nodes.has(ctx.sel)) ctx.sel = null;
    keep(ctx); paint(ctx); card(ctx); find(ctx, ctx.qIn.value); size(ctx); fit(ctx); foldBtn(ctx);
    const to = focus && (ctx.nodes.has(focus) ? ctx.nodes.get(focus).el : ctx.groups.has(focus) ? ctx.groups.get(focus).lab : null);
    if (to) to.focus({ preventScroll: true });
  }
  function fold(ctx, id, shut, focus) {
    if (!ctx.groups0 || !ctx.groups0.has(id)) return;
    if (shut) ctx.folded.add(id); else ctx.folded.delete(id);
    return refold(ctx, focus ? id : '');
  }
  function foldAll(ctx) {
    const list = tops(ctx); if (!list.length) return;
    if (ctx.folded.size) ctx.folded.clear(); else list.forEach((g) => ctx.folded.add(g.id));
    return refold(ctx, '');
  }
  function foldBtn(ctx) {
    const b = ctx.btn.fold; const any = ctx.folded.size > 0; const say = T(any ? 'Desplegar los grupos' : 'Plegar los grupos');
    b.hidden = !tops(ctx).length; b.innerHTML = any ? ICON.unfold : ICON.fold; b.title = say; b.setAttribute('aria-label', say); b.setAttribute('aria-pressed', String(any));
  }

  // ---------- Pantalla completa ----------
  // El diagrama pasa a un cuadro que tapa todo y vuelve a su lugar al salir. No usa la pantalla completa del
  // navegador, que en un iPhone no existe para una parte de la página.
  function full(ctx, want) {
    if (want === ctx.full) return;
    const b = ctx.btn.full; const say = T(want ? 'Salir de pantalla completa' : 'Pantalla completa');
    b.innerHTML = want ? ICON.small : ICON.full; b.title = say; b.setAttribute('aria-label', say); b.setAttribute('aria-pressed', String(want));
    if (want) {
      if (fullNow) full(fullNow, false);
      const dlg = el('dialog', { class: 'lmd-xp-full lmd-diagram', 'aria-label': T('Diagrama a pantalla completa') });
      const hole = el('div', { class: 'lmd-xp-hole' }); hole.style.height = ctx.stage.offsetHeight + 'px';
      ctx.box.insertBefore(hole, ctx.stage); dlg.appendChild(ctx.stage); document.body.appendChild(dlg);
      ctx.dlg = dlg; ctx.hole = hole; ctx.full = true; fullNow = ctx;
      dlg.addEventListener('close', () => full(ctx, false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); escape(ctx, document.activeElement); });
      dlg.addEventListener('keydown', (e) => { if (e.target === dlg) onKey(ctx, e); });
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      size(ctx); fit(ctx); clear(ctx);
      b.focus({ preventScroll: true });
      return;
    }
    const dlg = ctx.dlg; const hole = ctx.hole;
    ctx.full = false; ctx.dlg = null; ctx.hole = null; if (fullNow === ctx) fullNow = null;
    // Si la nota se redibujó mientras tanto, el lugar ya no existe: no hay a dónde volver.
    if (hole && hole.isConnected) hole.replaceWith(ctx.stage); else { ctx.stage.remove(); live.delete(ctx); }
    if (dlg) { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); }
    if (!live.has(ctx)) return;
    size(ctx); fit(ctx);
    b.focus({ preventScroll: true });
  }

  // ---------- Lo que se hace con el cursor, el dedo y el teclado ----------
  function act(ctx, what) {
    if (what === 'find') finding(ctx, !ctx.finding);
    else if (what === 'in') zoomBy(ctx, STEP);
    else if (what === 'out') zoomBy(ctx, 1 / STEP);
    else if (what === 'fit') { fit(ctx, true); clear(ctx); }
    else if (what === 'fold') foldAll(ctx);
    else if (what === 'full') full(ctx, !ctx.full);
    else if (what === 'close') { const n = ctx.nodes.get(ctx.sel); select(ctx, null); if (n) n.el.focus({ preventScroll: true }); }
    else if (what === 'reach') { ctx.reach = !ctx.reach; paint(ctx); card(ctx); clear(ctx); const r = ctx.card.querySelector('[data-xp=reach]'); if (r) r.focus({ preventScroll: true }); }
  }
  // Escape cierra de a una cosa: la búsqueda, el detalle, la pantalla completa. Devuelve si había algo que cerrar.
  function escape(ctx, from) {
    if (ctx.finding && (from === ctx.qIn || !ctx.sel)) { finding(ctx, false); return true; }
    if (ctx.sel) { act(ctx, 'close'); return true; }
    if (ctx.full) { full(ctx, false); return true; }
    return false;
  }
  function onKey(ctx, e) {
    if (core.editMode) return;
    const t = e.target; const used = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape') { if (escape(ctx, t)) used(); return; }
    if (t === ctx.qIn) { if (e.key === 'Enter') { used(); step(ctx, e.shiftKey ? -1 : 1); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const node = t.closest && t.closest('g.lmd-xp-node'); const lab = t.closest && t.closest('.lmd-xp-glabel');
    if (e.key === 'Enter' || e.key === ' ') {
      if (node) { used(); const id = node.getAttribute('data-xp-id'); if (ctx.folded.has(id)) fold(ctx, id, false, true); else select(ctx, id, { focus: true }); }
      else if (lab) { used(); fold(ctx, lab.getAttribute('data-xp-group'), true, true); }
      return;
    }
    if (t.closest && t.closest('a, input, textarea, select')) return;
    const moved = ctx.full || ctx.k !== 1 || !!ctx.x || !!ctx.y;
    const pan = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] }[e.key];
    if (e.key === '+' || e.key === '=') { used(); zoomBy(ctx, STEP); }
    else if (e.key === '-') { used(); zoomBy(ctx, 1 / STEP); }
    else if (e.key === '0') { used(); fit(ctx, true); }
    else if (e.key === '/') { used(); finding(ctx, true); }
    else if (pan && moved) { used(); ctx.x += pan[0]; ctx.y += pan[1]; apply(ctx, true); }
  }
  function onClick(ctx, e) {
    if (core.editMode) return;
    // El clic que cierra un arrastre no elige nada.
    if (Date.now() - ctx.dragAt < 350 && ctx.view.contains(e.target)) { ctx.dragAt = 0; e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    const b = t.closest('[data-xp]'); if (b) { e.preventDefault(); e.stopPropagation(); act(ctx, b.dataset.xp); return; }
    const go = t.closest('[data-xp-go]'); if (go) { e.preventDefault(); e.stopPropagation(); select(ctx, go.dataset.xpGo, { center: true }); const r = ctx.card.querySelector('[data-xp=close]'); if (r) r.focus({ preventScroll: true }); return; }
    const a = t.closest('a');
    if (a && ctx.card.contains(a)) {
      // Con Ctrl o Shift, y lo que apunta afuera, lo abre el navegador como cualquier enlace.
      if (!a.getAttribute('href')) { e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') { e.stopPropagation(); return; }
      e.stopPropagation();
      if (ctx.full) full(ctx, false);
      if (core.links.follow(a)) e.preventDefault();
      return;
    }
    if (ctx.card.contains(t) || ctx.bar.contains(t)) return;
    const lab = t.closest('.lmd-xp-glabel'); if (lab) { fold(ctx, lab.getAttribute('data-xp-group'), true); return; }
    const g = t.closest('g.lmd-xp-node');
    if (g) { const id = g.getAttribute('data-xp-id'); if (ctx.folded.has(id)) fold(ctx, id, false); else select(ctx, ctx.sel === id ? null : id); return; }
    if (ctx.sel && ctx.view.contains(t)) select(ctx, null);
  }
  // Arrastrar mueve el dibujo cuando está acercado o a pantalla completa; con dos dedos se acerca y se aleja.
  function pointers(ctx) {
    const view = ctx.view; const pts = new Map(); let drag = null; let pinch = null;
    const pair = () => { const p = Array.from(pts.values()); return { d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1, x: (p[0][0] + p[1][0]) / 2, y: (p[0][1] + p[1][1]) / 2 }; };
    view.addEventListener('pointerdown', (e) => {
      if (core.editMode || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: ctx.x, py: ctx.y, moved: false, can: ctx.full || ctx.k !== 1 || !!ctx.x || !!ctx.y };
      else if (pts.size === 2) { drag = null; pinch = pair(); ctx.dragAt = Date.now(); ctx.pan.classList.remove('lmd-xp-ease'); }
    });
    view.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size >= 2) {
        const now = pair(); const r = view.getBoundingClientRect();
        ctx.x += now.x - pinch.x; ctx.y += now.y - pinch.y;
        zoomAt(ctx, now.d / pinch.d, now.x - r.left, now.y - r.top);
        pinch = now; ctx.dragAt = Date.now(); e.preventDefault(); return;
      }
      if (!drag || drag.id !== e.pointerId || !drag.can) return;
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        drag.moved = true; view.classList.add('lmd-xp-grab');
        try { view.setPointerCapture(e.pointerId); } catch (err) { /* el puntero ya no está */ }
      }
      ctx.x = drag.px + dx; ctx.y = drag.py + dy; apply(ctx);
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) { if (drag.moved) ctx.dragAt = Date.now(); drag = null; view.classList.remove('lmd-xp-grab'); }
    };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
    // La rueda acerca a pantalla completa; en la nota, con Ctrl (o siempre, si así se eligió), para no trabar la lectura.
    view.addEventListener('wheel', (e) => {
      if (core.editMode || !(ctx.full || e.ctrlKey || e.metaKey || opt('exploreWheel', false))) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      zoomAt(ctx, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  // ---------- Armar y desarmar ----------
  function enhance(box) {
    if (!on || !core || core.editMode || !box || !box.isConnected || !core.ui.article.contains(box) || box.dataset.kind !== 'mermaid') return;
    const svg = box.querySelector(':scope > svg'); if (!svg || !svg.id) return;
    // Solo los diagramas de flujo: los demás tipos quedan como siempre.
    if (!/^flowchart/.test(svg.getAttribute('aria-roledescription') || '') || !svg.querySelector('g.node')) return;
    const all = Array.from(core.ui.article.querySelectorAll('.lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz'));
    const b = (what, say, pic) => '<button type="button" data-xp="' + what + '" title="' + esc(T(say)) + '" aria-label="' + esc(T(say)) + '">' + pic + '</button>';
    const stage = el('div', { class: 'lmd-xp-stage' });
    const bar = el('div', { class: 'lmd-xp-bar', role: 'toolbar', 'aria-label': T('Explorar el diagrama') },
      b('find', 'Buscar un nodo', ICON.find) + '<input type="search" class="lmd-xp-q" hidden placeholder="' + esc(T('Buscar un nodo')) + '" aria-label="' + esc(T('Buscar un nodo')) + '"><span class="lmd-xp-count" aria-live="polite"></span>' +
      b('out', 'Alejar', ICON.minus) + b('in', 'Acercar', ICON.plus) + b('fit', 'Ver todo el diagrama', ICON.fit) + b('fold', 'Plegar los grupos', ICON.fold) + b('full', 'Pantalla completa', ICON.full));
    const view = el('div', { class: 'lmd-xp-view' }); const pan = el('div', { class: 'lmd-xp-pan' });
    const cardBox = el('div', { class: 'lmd-xp-card', role: 'region', tabindex: '-1', hidden: '' });
    bar.contentEditable = 'false';
    // El dibujo va primero en el documento (la barra se ve arriba por CSS): lo que busca el SVG del diagrama dentro
    // del bloque (bajarlo, ampliarlo, exportar a Word) encuentra ese y no un ícono de la barra.
    view.appendChild(pan); stage.append(view, bar, cardBox);
    box.insertBefore(stage, svg); pan.appendChild(svg); box.classList.add('lmd-xp');
    const code = canon(box.dataset.code || '');
    const ctx = { box, stage, bar, view, pan, card: cardBox, svg, svg0: svg, code, notes: notesOf(code), key: core.HERE + '|' + all.indexOf(box),
      qIn: bar.querySelector('.lmd-xp-q'), count: bar.querySelector('.lmd-xp-count'), btn: {}, nodes: new Map(), groups: new Map(), groups0: null, edges: [],
      folded: new Set(), sel: null, reach: false, k: 1, x: 0, y: 0, min: MIN, W: 1, H: 1, full: false, finding: false, q: '', hits: [], at: -1, turn: 0, dragAt: 0, lit: { nodes: [], edges: 0 } };
    bar.querySelectorAll('[data-xp]').forEach((n) => { ctx.btn[n.dataset.xp] = n; });
    live.add(ctx); box._lmdXp = ctx;
    index(ctx); size(ctx); foldBtn(ctx);
    stage.addEventListener('click', (e) => onClick(ctx, e));
    stage.addEventListener('keydown', (e) => onKey(ctx, e));
    ctx.qIn.addEventListener('input', () => find(ctx, ctx.qIn.value));
    pointers(ctx);
    // Lo que había antes de que la nota se redibujara: los grupos plegados y el nodo elegido.
    const was = mem.get(ctx.key);
    if (was) {
      (was.folded || []).forEach((id) => { if (ctx.groups0.has(id)) ctx.folded.add(id); });
      const again = () => { if (was.sel && ctx.nodes.has(was.sel)) select(ctx, was.sel); };
      if (ctx.folded.size) refold(ctx, '').then(again); else again();
    }
  }
  function restore(ctx) {
    if (ctx.full) full(ctx, false);
    live.delete(ctx);
    if (!ctx.box.isConnected) return;
    strip(ctx.svg0); ctx.box.insertBefore(ctx.svg0, ctx.stage); ctx.stage.remove();
    ctx.box.classList.remove('lmd-xp', 'lmd-xp-finding'); delete ctx.box._lmdXp;
  }
  // Arma los que falten y suelta los que ya no están en la nota.
  function scan() {
    if (!core || !core.ui || !core.ui.article) return;
    Array.from(live).forEach((ctx) => { if (ctx.box.isConnected && on && !core.editMode) return; if (ctx.box.isConnected) restore(ctx); else { if (ctx.full) full(ctx, false); live.delete(ctx); } });
    if (on && !core.editMode) core.ui.article.querySelectorAll('.lmd-diagram').forEach(enhance);
  }

  function enable(c) {
    core = c; on = true;
    if (!wired) {
      wired = true;
      core.hooks.render.push(scan); core.hooks.patch.push(scan);
      if (core.hooks.diagram) core.hooks.diagram.push(enhance);
      // Al pasar a otra nota, lo plegado se recuerda y lo elegido no: al volver no hay un detalle abierto de antes.
      core.hooks.doc.push(() => mem.forEach((m) => { m.sel = null; }));
      window.addEventListener('resize', () => { if (fullNow) fit(fullNow); });
    }
    scan();
  }
  function disable() { on = false; scan(); }
  function settings(area) {
    area.textContent = '';
    area.appendChild(el('p', { class: 'lmd-tl-why', text: T('Vale para los diagramas de flujo de Mermaid, leyendo la nota. El detalle de un nodo se escribe dentro del bloque, una línea por dato:') }));
    area.appendChild(el('pre', { class: 'lmd-xp-how', text: '%% @api: ' + T('Recibe los pedidos de la web.') + '\n%% @api: [[' + T('Notas de la API') + ']]' }));
    const input = el('input', { type: 'checkbox' }); input.checked = !!opt('exploreWheel', false);
    const label = el('label', { class: 'lmd-check' }); label.append(input, el('span', { text: T('Acercar con la rueda sin apretar Ctrl') }));
    input.addEventListener('change', () => {
      const partial = { exploreWheel: input.checked };
      core.settings.tools = Object.assign({}, core.settings.tools, partial); LMD.tools.setOpt(partial);
    });
    area.appendChild(label);
    area.appendChild(el('p', { class: 'lmd-tl-why', text: T('Teclas: Tab pasa de nodo en nodo, Enter abre el detalle, Escape lo cierra, + y - acercan y alejan, 0 vuelve a la vista entera.') }));
  }
  // Para mirar desde afuera (las pruebas): el diagrama número i de la nota.
  const at = (i) => Array.from(live).sort((a, b) => (a.box.compareDocumentPosition(b.box) & 4 ? -1 : 1))[i || 0] || null;
  function state(i) {
    const ctx = at(i); if (!ctx) return null;
    return { count: live.size, nodes: Array.from(ctx.nodes.keys()), groups: Array.from(ctx.groups.keys()), foldable: Array.from(ctx.groups0 || []).map((x) => x[0]), folded: Array.from(ctx.folded),
      notes: Array.from(ctx.notes.keys()), sel: ctx.sel, reach: ctx.reach, lit: ctx.lit, k: +ctx.k.toFixed(3), x: Math.round(ctx.x), y: Math.round(ctx.y), full: ctx.full, finding: ctx.finding, hits: ctx.hits.slice(), edges: ctx.edges.map((e) => e.a + '>' + e.b) };
  }

  LMD.explore = { enable, disable, settings, state, notesOf, foldCode, canon,
    select: (id, i) => { const ctx = at(i); if (ctx) select(ctx, id); }, fold: (id, shut, i) => { const ctx = at(i); return ctx ? fold(ctx, id, shut !== false) : null; } };
})();
