// Herramienta: mapa de enlaces. Un gráfico de qué notas enlazan con cuáles (enlaces Markdown relativos y
// [[wikilinks]]) y, bajo la nota abierta, las notas que enlazan a ella. Lee solo lo que ya está en el dispositivo:
// la carpeta abierta, las notas del navegador y las copias locales de la nube. No baja ni envía nada.
// Una carpeta protegida bloqueada no aparece: sus copias están cifradas y acá no se abren.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ICON = {
    map: svg('<circle cx="6" cy="7" r="2.300"/><circle cx="18" cy="6" r="2.300"/><circle cx="12" cy="17.500" r="2.300"/><path d="M8.200 6.800l7.500-.600M7.100 9l3.800 6.500M16.900 8l-3.800 7.500"/>'),
    plus: svg('<path d="M12 6v12M6 12h12"/>'), minus: svg('<path d="M6 12h12"/>'),
    fit: svg('<path d="M4.500 9.500v-5h5M19.500 9.500v-5h-5M4.500 14.500v5h5M19.500 14.500v5h-5"/>'),
  };
  const KEY = LMD.keys('Alt+Shift+G');
  const MAX_NOTES = 1500;
  const MD_RE = /\.(md|mdx|mkd|mdown|markdown)$/i;
  let core = null; let on = false; let wired = false;
  const opt = (k, d) => LMD.tools.opt(k, d);
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }
  const vbase = () => core.urlOf('').slice(0, -'cloud/'.length);
  const unesc = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const keyOf = (url) => unesc(url.split('#')[0].split('?')[0]);

  // ---------- Las notas que hay en el dispositivo ----------
  // [{ url, name, folder, src, text }]. folder es para mostrar y filtrar: el lugar y, adentro, la carpeta.
  async function gather() {
    const out = []; const push = (n) => { if (out.length < MAX_NOTES) out.push(n); };
    const dirOf = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
    if (core.APP) {
      try { (await LMD.store.notesAll()).forEach((n) => { if (MD_RE.test(n.name)) push({ url: vbase() + 'local/' + encodeURIComponent(n.name), name: n.name, folder: T('En este navegador'), src: 'local', text: n.text || '' }); }); } catch (e) { /* sin notas del navegador */ }
      // De la nube, solo las copias que ya están acá (las notas que se abrieron o se guardaron en este dispositivo).
      try {
        if (LMD.cloud.signedIn() && !LMD.cloud.guest()) {
          const who = LMD.cloud.email(); const vaults = (LMD.cloud.vaultsNow && LMD.cloud.vaultsNow()) || [];
          for (const c of await LMD.store.cloudAll(who)) {
            if (!c.path || c.path[0] === '~' || !MD_RE.test(c.path)) continue;
            const vault = vaults.find((v) => c.path.startsWith(v.folder + '/')) || null;
            let text = c.text;
            // Carpeta protegida: bloqueada no aparece; desbloqueada, su copia se descifra con la llave ya abierta.
            if (vault && !LMD.vault.isOpen(vault)) continue;
            if (c.sealed) {
              if (!vault) continue;
              try { const key = await LMD.seal.keyFor(who, vault); if (!key) continue; text = await LMD.seal.open(key, c.path, c.text); } catch (e) { continue; }
            }
            const dir = dirOf(c.path);
            push({ url: core.urlOf(c.path), name: c.path.split('/').pop(), folder: T('Nube') + (dir ? '/' + dir : ''), src: 'cloud', text: String(text || '') });
          }
        }
      } catch (e) { /* sin copias de la nube */ }
    }
    // La carpeta del disco que está abierta. Sobre un archivo suelto (la extensión), solo si es del disco.
    try {
      const root = core.APP ? (core.appRoot && core.appRoot.kind === 'dir' ? vbase() + core.appRoot.id + '/' : core.diskDir()) : (location.protocol === 'file:' ? core.treeRoot : '');
      if (root) {
        const label = core.APP ? ((core.rootOf(root) || {}).name || T('Carpeta')) : unesc(root.replace(/\/$/, '').split('/').pop() || T('Carpeta'));
        const files = (await core.collect(root)) || [];
        for (const f of files) {
          if (out.length >= MAX_NOTES) break;
          const dir = dirOf(f.rel);
          push({ url: f.url, name: f.rel.split('/').pop(), folder: label + (dir ? '/' + dir : ''), src: 'disk', text: (await core.readFile(f.url)) || '' });
        }
      }
    } catch (e) { /* la carpeta no se dejó leer */ }
    return out;
  }

  // ---------- Los enlaces de un texto ----------
  // { wiki: [nombres], rel: [rutas] }. Lo que está dentro de código no cuenta.
  function linksOf(text) {
    const body = String(text).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
    const wiki = []; const rel = []; let m;
    const W = /\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g;
    while ((m = W.exec(body))) wiki.push(m[1].trim());
    const L = /\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+[^)]*)?\)/g;
    while ((m = L.exec(body))) rel.push(m[1]);
    const R = /^ {0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s|$)/gm;
    while ((m = R.exec(body))) rel.push(m[1]);
    return { wiki, rel: rel.filter((h) => !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(h)) };
  }
  // El índice: las notas, quién enlaza a quién y al revés. out e inn van por posición en notes.
  function build(notes) {
    const byUrl = new Map(); notes.forEach((n, i) => byUrl.set(keyOf(n.url), i));
    const byName = new Map(); // nombre de wikilink -> posiciones, por lugar
    notes.forEach((n, i) => { const k = n.src + '|' + core.wikiKey(n.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); });
    const out = notes.map(() => new Set()); const inn = notes.map(() => new Set());
    const dirUrl = (u) => u.slice(0, u.lastIndexOf('/') + 1);
    notes.forEach((n, i) => {
      const found = linksOf(n.text); const add = (j) => { if (j != null && j !== i) { out[i].add(j); inn[j].add(i); } };
      found.rel.forEach((href) => {
        try {
          const u = keyOf(new URL(href, n.url).href);
          add(byUrl.has(u) ? byUrl.get(u) : byUrl.get(u + '.md'));
        } catch (e) { /* no es una ruta */ }
      });
      found.wiki.forEach((name) => {
        const hits = byName.get(n.src + '|' + core.wikiKey(name.split('/').pop())) || [];
        if (!hits.length) return;
        // Como en la nota: primero lo que está en su carpeta o más adentro; si no, cualquiera del mismo lugar.
        const here = dirUrl(n.url); add(hits.find((j) => notes[j].url.startsWith(here)) != null ? hits.find((j) => notes[j].url.startsWith(here)) : hits[0]);
      });
    });
    const edges = []; out.forEach((set, i) => set.forEach((j) => { if (!(out[j].has(i) && j < i)) edges.push([i, j]); }));
    return { notes, out, inn, edges, at: Date.now() };
  }
  let cache = null; let pending = null;
  // fresh: releer todo. Si no, vale lo leído hace poco.
  function index(fresh) {
    if (!fresh && cache && Date.now() - cache.at < 15000) return Promise.resolve(cache);
    if (pending) return pending;
    pending = gather().then((notes) => { cache = build(notes); pending = null; return cache; }, (e) => { pending = null; throw e; });
    return pending;
  }
  const openNote = (url) => (core.APP ? core.open(url) : core.openFile(url));

  // ---------- "Enlaces a esta nota", bajo la nota abierta ----------
  let backSeq = 0;
  async function paintBack(fresh) {
    const mine = ++backSeq;
    const old = () => core.ui.main.querySelector('.lmd-back');
    if (!on || core.noDoc) { if (old()) old().remove(); return; }
    let ix = null;
    try { ix = await index(fresh); } catch (e) { ix = null; }
    if (mine !== backSeq) return;
    const here = keyOf(core.HERE); const i = ix ? ix.notes.findIndex((n) => keyOf(n.url) === here) : -1;
    const from = i < 0 ? [] : Array.from(ix.inn[i]).map((j) => ix.notes[j]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (!from.length) { if (old()) old().remove(); return; }
    const box = old() || el('details', { class: 'lmd-back' });
    const wasOpen = old() ? box.open : !!opt('mapBackOpen', true);
    box.innerHTML = '<summary>' + esc(T('Enlaces a esta nota')) + ' <span class="lmd-back-n">' + from.length + '</span></summary><ul>' +
      from.map((n) => '<li><a href="' + esc(core.APP ? core.toHref(n.url) : n.url) + '" data-url="' + esc(n.url) + '">' + esc(n.name.replace(MD_RE, '')) + '</a><span>' + esc(n.folder) + '</span></li>').join('') + '</ul>';
    box.open = wasOpen;
    if (!old()) {
      core.ui.article.parentNode.insertBefore(box, core.ui.article.nextSibling);
      box.addEventListener('click', (e) => { const a = e.target.closest('a[data-url]'); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); openNote(a.dataset.url); });
      box.addEventListener('toggle', () => keep({ mapBackOpen: box.open }));
    }
  }
  async function backlinks(url) {
    const ix = await index(false); const k = keyOf(url || core.HERE); const i = ix.notes.findIndex((n) => keyOf(n.url) === k);
    return i < 0 ? [] : Array.from(ix.inn[i]).map((j) => ix.notes[j].name).sort();
  }

  // ---------- El mapa ----------
  let st = null; // el mapa abierto
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  // Un paso de la simulación: las notas se repelen, los enlaces tiran como resortes y todo cae hacia el centro.
  function tick(nodes, edges, alpha) {
    const n = nodes.length; const REP = 2600; const LEN = 70;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]; let dx = a.x - b.x; let dy = a.y - b.y; let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (i % 7) - 3 + 0.1; dy = (j % 5) - 2 + 0.1; d2 = dx * dx + dy * dy; }
        if (d2 > 160000) continue;
        const f = REP * alpha / d2; const fx = dx * f; const fy = dy * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (let e = 0; e < edges.length; e++) {
      const a = edges[e][0]; const b = edges[e][1]; const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - LEN) / d * 0.09 * alpha; const fx = dx * f; const fy = dy * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      a.vx -= a.x * 0.012 * alpha; a.vy -= a.y * 0.012 * alpha;
      if (a.fixed) { a.vx = 0; a.vy = 0; continue; }
      a.vx *= 0.82; a.vy *= 0.82;
      const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy); if (sp > 40) { a.vx *= 40 / sp; a.vy *= 40 / sp; }
      a.x += a.vx; a.y += a.vy;
    }
  }
  const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function draw() {
    if (!st) return;
    const c = st.canvas; const g = st.g; const w = c.clientWidth; const h = c.clientHeight; const dpr = st.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const col = st.col; const k = st.view.k; const ox = st.view.x + w / 2; const oy = st.view.y + h / 2;
    const focus = st.hover || st.drag; const near = focus ? focus.near : null;
    const hits = st.hits;
    g.lineWidth = 1;
    for (const e of st.edges) {
      const a = e[0]; const b = e[1]; const lit = focus && (a === focus || b === focus);
      g.globalAlpha = focus ? (lit ? 0.9 : 0.08) : 0.32; g.strokeStyle = lit ? col.accent : col.line;
      g.beginPath(); g.moveTo(a.x * k + ox, a.y * k + oy); g.lineTo(b.x * k + ox, b.y * k + oy); g.stroke();
    }
    const labelAll = st.nodes.length <= 40 || k >= 1.5;
    g.font = '12px ' + col.font; g.textAlign = 'center'; g.textBaseline = 'top';
    for (const nd of st.nodes) {
      const x = nd.x * k + ox; const y = nd.y * k + oy; const r = nd.r * Math.max(0.7, Math.min(1.6, k));
      const lit = !focus || nd === focus || (near && near.has(nd)); const hit = hits && hits.has(nd);
      g.globalAlpha = (lit ? 1 : 0.18) * (hits && !hit ? 0.3 : 1);
      g.fillStyle = nd.cur ? col.accent : (nd.deg ? col.fg : col.muted);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (nd === focus || hit || nd.cur) { g.lineWidth = 2; g.strokeStyle = col.accent; g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; }
      if (labelAll || nd === focus || (focus && near.has(nd)) || hit || nd.cur) {
        g.fillStyle = col.fg; g.globalAlpha = lit ? (hits && !hit ? 0.35 : 1) : 0.25;
        g.fillText(nd.label, x, y + r + 4);
      }
    }
    g.globalAlpha = 1;
  }
  function loop() {
    if (!st) return;
    st.raf = 0;
    if (st.alpha > 0.004) { const steps = st.nodes.length > 500 ? 1 : 2; for (let s = 0; s < steps; s++) { tick(st.nodes, st.edges, st.alpha); st.alpha *= 0.985; } st.dirty = true; }
    if (st.dirty) { st.dirty = false; draw(); }
    if (st.alpha > 0.004) st.raf = requestAnimationFrame(loop);
  }
  const kick = (alpha) => { if (!st) return; if (alpha) st.alpha = Math.max(st.alpha, alpha); st.dirty = true; if (!st.raf) st.raf = requestAnimationFrame(loop); };
  // Encuadra lo que se ve.
  function fit() {
    if (!st || !st.nodes.length) return;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    st.nodes.forEach((n) => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
    const w = st.canvas.clientWidth; const h = st.canvas.clientHeight; const pad = 46;
    const k = Math.max(0.15, Math.min(2.2, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
    st.view = { k, x: -(x0 + x1) / 2 * k, y: -(y0 + y1) / 2 * k };
    kick();
  }
  function zoomAt(px, py, factor) {
    const w = st.canvas.clientWidth; const h = st.canvas.clientHeight; const v = st.view;
    const k = Math.max(0.1, Math.min(6, v.k * factor)); const cx = px - w / 2; const cy = py - h / 2;
    v.x = cx - (cx - v.x) * (k / v.k); v.y = cy - (cy - v.y) * (k / v.k); v.k = k;
    kick();
  }
  const toWorld = (px, py) => ({ x: (px - st.canvas.clientWidth / 2 - st.view.x) / st.view.k, y: (py - st.canvas.clientHeight / 2 - st.view.y) / st.view.k });
  const toScreen = (n) => ({ x: n.x * st.view.k + st.view.x + st.canvas.clientWidth / 2, y: n.y * st.view.k + st.view.y + st.canvas.clientHeight / 2 });
  function nodeAt(px, py, slack) {
    let best = null; let bd = Infinity;
    for (const n of st.nodes) { const s = toScreen(n); const d = Math.hypot(s.x - px, s.y - py); const reach = n.r * Math.max(0.7, Math.min(1.6, st.view.k)) + (slack || 6); if (d <= reach && d < bd) { best = n; bd = d; } }
    return best;
  }
  // Arma los nodos de lo que se eligió ver (carpeta y notas sueltas). Los que ya estaban conservan su lugar.
  function populate() {
    const ix = st.ix; const folder = st.folder; const lone = st.lone; const here = keyOf(core.HERE || '');
    const was = new Map(st.nodes.map((n) => [n.i, n]));
    const deg = ix.notes.map((_, i) => ix.out[i].size + ix.inn[i].size);
    const inFolder = (n) => !folder || n.folder === folder || n.folder.startsWith(folder + '/');
    const keepIdx = []; ix.notes.forEach((n, i) => { if (inFolder(n)) keepIdx.push(i); });
    const set = new Set(keepIdx);
    // Los enlaces cuentan solo entre lo que se ve.
    const pairs = ix.edges.filter((e) => set.has(e[0]) && set.has(e[1]));
    const linked = new Set(); pairs.forEach((e) => { linked.add(e[0]); linked.add(e[1]); });
    const nodes = []; const byI = new Map();
    keepIdx.forEach((i, k) => {
      if (!lone && !linked.has(i)) return;
      const n = ix.notes[i]; const old = was.get(i);
      const ang = k * 2.39996; const rad = 14 * Math.sqrt(k + 1);
      const nd = old || { i, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0, fixed: false };
      nd.url = n.url; nd.name = n.name; nd.folder = n.folder; nd.label = n.name.replace(MD_RE, ''); nd.plain = plain(nd.label);
      nd.deg = 0; nd.near = new Set(); nd.cur = !core.noDoc && keyOf(n.url) === here; nd.all = deg[i];
      nodes.push(nd); byI.set(i, nd);
    });
    const edges = [];
    pairs.forEach((e) => { const a = byI.get(e[0]); const b = byI.get(e[1]); if (!a || !b) return; edges.push([a, b]); a.deg++; b.deg++; a.near.add(b); b.near.add(a); });
    nodes.forEach((n) => { n.r = 4 + Math.min(9, Math.sqrt(n.deg) * 2.2); });
    st.nodes = nodes; st.edges = edges; st.hover = null;
    search(st.query, true);
    st.box.querySelector('.lmd-map-count').textContent = T(nodes.length === 1 ? '1 nota' : '{n} notas', { n: nodes.length }) + ' · ' + T(edges.length === 1 ? '1 enlace' : '{n} enlaces', { n: edges.length });
    st.box.querySelector('.lmd-map-empty').hidden = nodes.length > 0;
    st.box.querySelector('.lmd-map-empty').textContent = ix.notes.length ? T('Ninguna nota para mostrar con este filtro.') : T('No hay notas en este dispositivo para armar el mapa.');
    if (reduced() || nodes.length > 700) { let a = 1; for (let s = 0; s < 260; s++) { tick(nodes, edges, a); a *= 0.985; } st.alpha = 0; fit(); } else { st.alpha = 1; kick(1); }
  }
  function search(q, quiet) {
    st.query = q || ''; const p = plain(st.query.trim());
    st.hits = p ? new Set(st.nodes.filter((n) => n.plain.includes(p))) : null;
    if (!quiet) kick();
    return st.hits ? st.hits.size : 0;
  }
  function resize() {
    if (!st) return;
    const c = st.canvas; st.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    c.width = Math.max(1, Math.round(c.clientWidth * st.dpr)); c.height = Math.max(1, Math.round(c.clientHeight * st.dpr));
    kick();
  }
  function close() {
    if (!st) return;
    const s = st; st = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    window.removeEventListener('resize', resize);
    s.box.remove();
  }

  async function open() {
    if (!on || !core || st) return false;
    const box = el('div', { class: 'lmd-ask lmd-map' });
    const title = T('Mapa de enlaces');
    box.innerHTML = '<div class="lmd-ask-card lmd-map-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="lmd-map-head"><h3>' + esc(title) + '</h3>' +
        '<input type="search" class="lmd-lk-q lmd-map-q" spellcheck="false" placeholder="' + esc(T('Buscar una nota')) + '" aria-label="' + esc(T('Buscar una nota')) + '">' +
        '<select class="lmd-map-folder" aria-label="' + esc(T('Carpeta')) + '"></select>' +
        '<label class="lmd-map-lone"><input type="checkbox"> <span>' + esc(T('Notas sin enlaces')) + '</span></label>' +
        '<button type="button" class="lmd-icon-btn" data-map="close" data-esc title="' + esc(T('Cerrar')) + '" aria-label="' + esc(T('Cerrar')) + '">' + LMD.kit.ICON.close + '</button></div>' +
      '<div class="lmd-map-body"><canvas class="lmd-map-canvas" role="img" aria-label="' + esc(title) + '"></canvas><p class="lmd-map-empty" hidden></p>' +
        '<div class="lmd-map-zoom"><button type="button" class="lmd-icon-btn" data-map="in" title="' + esc(T('Acercar')) + '" aria-label="' + esc(T('Acercar')) + '">' + ICON.plus + '</button>' +
          '<button type="button" class="lmd-icon-btn" data-map="out" title="' + esc(T('Alejar')) + '" aria-label="' + esc(T('Alejar')) + '">' + ICON.minus + '</button>' +
          '<button type="button" class="lmd-icon-btn" data-map="fit" title="' + esc(T('Encuadrar')) + '" aria-label="' + esc(T('Encuadrar')) + '">' + ICON.fit + '</button></div></div>' +
      '<div class="lmd-map-foot"><span class="lmd-map-count" role="status"></span><span class="lmd-map-tip"></span></div></div>';
    document.body.appendChild(box);
    const canvas = box.querySelector('canvas');
    st = { box, canvas, g: canvas.getContext('2d'), dpr: 1, nodes: [], edges: [], view: { x: 0, y: 0, k: 1 }, alpha: 0, raf: 0, dirty: true, hover: null, drag: null, hits: null, query: '',
      folder: '', lone: !!opt('mapOrphans', true), ix: null, ptrs: new Map(), pinch: null,
      col: { fg: css('--fg', '#222'), muted: css('--fg-faint', '#888'), line: css('--fg-muted', '#999'), accent: css('--accent', '#3f6a0a'), font: css('--lmd-font', 'sans-serif') } };
    const mine = st;
    box.querySelector('.lmd-map-lone input').checked = st.lone;
    box.querySelector('.lmd-map-count').textContent = T('Leyendo las notas…');
    const tip = box.querySelector('.lmd-map-tip');
    tip.textContent = T(LMD.touch.coarse() ? 'Tocá una nota para abrirla. Dos dedos para acercar.' : 'Clic en una nota para abrirla. La rueda acerca y aleja.');
    resize(); window.addEventListener('resize', resize);

    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con el mapa abierto
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target.matches('.lmd-map-q') && st.hits && st.hits.size) { e.preventDefault(); const n = Array.from(st.hits).sort((a, b) => b.deg - a.deg || a.label.localeCompare(b.label))[0]; close(); openNote(n.url); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-map]'); if (!b) return;
      const w = canvas.clientWidth / 2; const h = canvas.clientHeight / 2;
      if (b.dataset.map === 'close') close(); else if (b.dataset.map === 'in') zoomAt(w, h, 1.35); else if (b.dataset.map === 'out') zoomAt(w, h, 1 / 1.35); else fit();
    });
    box.querySelector('.lmd-map-q').addEventListener('input', (e) => search(e.target.value));
    box.querySelector('.lmd-map-folder').addEventListener('change', (e) => { st.folder = e.target.value; populate(); setTimeout(fit, 30); });
    box.querySelector('.lmd-map-lone input').addEventListener('change', (e) => { st.lone = e.target.checked; keep({ mapOrphans: st.lone }); populate(); });

    // Un puntero: arrastra una nota o corre el mapa. Dos: acercan y alejan. Sin moverse, sobre una nota: la abre.
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      if (!st) return;
      if (e.button) return;
      const p = pos(e); st.ptrs.set(e.pointerId, p);
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* puntero de prueba */ }
      if (st.ptrs.size === 2) {
        const a = Array.from(st.ptrs.values()); st.pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 };
        if (st.drag) { st.drag.fixed = false; st.drag = null; } st.pan = null; return;
      }
      const n = nodeAt(p.x, p.y, e.pointerType === 'touch' ? 14 : 6);
      st.down = { x: p.x, y: p.y, moved: false, node: n };
      if (n) { st.drag = n; n.fixed = true; } else st.pan = { x: p.x - st.view.x, y: p.y - st.view.y };
      kick();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st) return;
      const p = pos(e);
      if (st.ptrs.has(e.pointerId)) st.ptrs.set(e.pointerId, p);
      if (st.pinch && st.ptrs.size === 2) {
        const a = Array.from(st.ptrs.values()); const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
        zoomAt((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, d / st.pinch.d); st.pinch.d = d; return;
      }
      if (st.down && Math.hypot(p.x - st.down.x, p.y - st.down.y) > 5) st.down.moved = true;
      if (st.drag && st.down) { if (st.down.moved) { const wpt = toWorld(p.x, p.y); st.drag.x = wpt.x; st.drag.y = wpt.y; kick(0.25); } return; }
      if (st.pan) { st.view.x = p.x - st.pan.x; st.view.y = p.y - st.pan.y; kick(); return; }
      if (e.pointerType === 'touch') return;
      const n = nodeAt(p.x, p.y, 6);
      if (n !== st.hover) { st.hover = n; canvas.style.cursor = n ? 'pointer' : ''; canvas.title = n ? n.label + ' · ' + n.folder : ''; kick(); }
    });
    const up = (e) => {
      if (!st) return;
      st.ptrs.delete(e.pointerId);
      if (st.pinch) { if (st.ptrs.size < 2) st.pinch = null; st.down = null; return; }
      const d = st.down; st.down = null; st.pan = null;
      const n = st.drag; if (n) { n.fixed = false; st.drag = null; kick(0.1); }
      if (d && !d.moved && d.node && e.type === 'pointerup') { const url = d.node.url; close(); openNote(url); }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (st && st.hover && !st.drag) { st.hover = null; kick(); } });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015))); }, { passive: false });
    canvas.addEventListener('dblclick', (e) => { const p = pos(e); if (!nodeAt(p.x, p.y, 6)) fit(); });

    let ix = null;
    try { ix = await index(true); } catch (e) { ix = build([]); }
    if (st !== mine) return false;
    st.ix = ix;
    const folders = Array.from(new Set(ix.notes.map((n) => n.folder).reduce((all, f) => { const parts = f.split('/'); for (let k = 1; k <= parts.length; k++) all.push(parts.slice(0, k).join('/')); return all; }, []))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const sel = box.querySelector('.lmd-map-folder');
    sel.innerHTML = '<option value="">' + esc(T('Todas las carpetas')) + '</option>' + folders.map((f) => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('');
    sel.hidden = folders.length < 2;
    populate(); setTimeout(() => { if (st === mine) fit(); }, reduced() ? 0 : 700);
    if (!LMD.touch.coarse()) box.querySelector('.lmd-map-q').focus();
    return true;
  }

  // ---------- Encendido ----------
  function sideButton() {
    const head = core.ui.sidebar.querySelector('.lmd-zone-files .lmd-zone-head'); if (!head) return;
    const old = head.querySelector('.lmd-map-btn');
    if (!on) { if (old) old.remove(); return; }
    if (old) return;
    const b = el('button', { type: 'button', class: 'lmd-zone-btn lmd-map-btn', title: T('Mapa de enlaces') + ' (' + KEY + ')', 'aria-label': T('Mapa de enlaces') }, ICON.map);
    b.addEventListener('click', () => open());
    head.insertBefore(b, head.querySelector('.lmd-tree-add, .lmd-tree-open'));
  }
  function onShortcut(e) {
    if (!on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyG') return;
    if (st) { e.preventDefault(); close(); return; }
    if (document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres') || !core.ui.panel.hidden) return;
    e.preventDefault(); open();
  }
  function enable(c) {
    core = c; on = true; sideButton(); paintBack(false);
    if (wired) return;
    wired = true;
    window.addEventListener('keydown', onShortcut);
    core.actions.linkmap = () => open();
    core.menus.more.push(() => (on && LMD.touch.small() ? ['linkmap', ICON.map, 'Mapa de enlaces'] : null));
    // Otra nota, o se guardó: lo que se sabía de los enlaces puede haber cambiado.
    core.hooks.doc.push(() => { close(); cache = null; paintBack(false); });
    core.hooks.tree.push(() => { cache = null; });
  }
  function disable() { on = false; close(); if (core) { sideButton(); paintBack(false); } }
  function settings(area, api) {
    area.innerHTML = '<p class="lmd-tl-why">' + esc(T('Lee la carpeta abierta, las notas del navegador y las de la nube que ya están en este dispositivo. No baja ni envía nada.')) + '</p>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('Atajo: {a}.', { a: KEY })) + '</span><button type="button" class="lmd-btn" data-map="go">' + esc(T('Abrir el mapa')) + '</button></div>';
    area.querySelector('[data-map=go]').addEventListener('click', () => { api.close(); open(); });
  }

  LMD.linkmap = { enable, disable, settings, open, close, fit, index, backlinks, linksOf, build, search: (q) => (st ? search(q) : 0),
    // Para las pruebas y para quien quiera el gráfico sin dibujarlo: los nodos con su lugar en la pantalla.
    state: () => (st ? { open: true, ready: !!st.ix, settled: st.alpha <= 0.004, k: st.view.k, folder: st.folder, lone: st.lone, hover: st.hover ? st.hover.name : '',
      nodes: st.nodes.map((n) => { const s = toScreen(n); const r = st.canvas.getBoundingClientRect(); return { name: n.name, folder: n.folder, deg: n.deg, cur: n.cur, x: s.x + r.left, y: s.y + r.top, hit: !!(st.hits && st.hits.has(n)) }; }),
      edges: st.edges.map((e) => [e[0].name, e[1].name].sort().join(' ~ ')).sort() } : { open: false }) };
})();
