// Varios bloques a la vez. Se marcan arrastrando desde el margen izquierdo, con Mayúsculas o Ctrl + clic, con el
// teclado (Escape deja marcado el bloque donde estaba el cursor) o, con el dedo, manteniendo apretado. Lo marcado se
// copia, se corta, se duplica, se mueve, se elimina, se envuelve, se convierte o pasa a una nota nueva.
// Un bloque es lo que el documento tiene en su primer nivel: un párrafo, un título, una lista entera, una tabla, un
// bloque de código, un recuadro o una sección desplegable con todo lo suyo. Un título plegado lleva lo que esconde.
// Cada acción cambia el Markdown una sola vez (un solo Ctrl+Z) y por el mismo camino que cualquier otra edición.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null; let article = null; let W = null;

  const CUT = '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.4 15.8 19 4.5M15.6 15.8 5 4.5"/></svg>';
  const DUP = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 0 0 2-2V9M9.5 7v5M7 9.5h5"/></svg>';
  // Lo que la app dibuja en el primer nivel y no es un bloque de la nota.
  const SKIP = '.lmd-add, .lmd-draft, .lmd-front, .lmd-cl-bar, .lmd-cl-add, .lmd-cm-layer, .lmd-live-layer';
  const OVER = '.lmd-ask, .lmd-dgm, .lmd-pres';
  const root = document.documentElement;
  const fm = () => core.fmOffset;
  const lines = () => core.srcLines;
  const usable = () => !!core && core.blocks && !core.noDoc && !article.hidden;
  const canEdit = () => core.editMode && !core.readOnly;
  const units = () => Array.from(article.children).filter((n) => !n.matches(SKIP) && W.span(n));
  const seen = (n) => !n.classList.contains('lmd-fold-away');
  const shown = () => units().filter(seen);
  const unitOf = (node) => {
    const n = node && node.nodeType !== 1 ? node.parentNode : node;
    const b = n && n !== article && article.contains(n) ? W.top(n) : null;
    return b && !b.matches(SKIP) && W.span(b) ? b : null;
  };
  const inField = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  const isPara = (b) => b.tagName === 'P';

  // ---------- Lo marcado ----------
  let picked = new Set(); let anchor = null; let head = null;
  let touchMode = false; // con el dedo: tocar un bloque lo suma o lo quita, hasta "Listo"
  // Dónde estaba lo marcado, por línea: al redibujar la misma nota vuelve a marcarse lo mismo.
  let mark = null;
  let bar = null; let menu = null; let busy = false;

  // Lo marcado más lo que esconde cada título plegado, en el orden del documento.
  function effective() {
    if (!picked.size) return [];
    const u = units(); const set = new Set();
    u.forEach((b) => {
      if (!picked.has(b)) return;
      set.add(b);
      if (b.classList.contains('lmd-fold-shut') && LMD.fold) LMD.fold.section(b).forEach((n) => set.add(n));
    });
    return u.filter((b) => set.has(b));
  }
  // Los tramos de bloques seguidos, con sus líneas. Lo que haya entre dos bloques del tramo va con él.
  function groups(list) {
    const u = units(); const out = []; let cur = null; let last = -2;
    list.forEach((b) => {
      const i = u.indexOf(b); const r = W.span(b);
      if (cur && i === last + 1) { cur.e = Math.max(cur.e, r.e); cur.blocks.push(b); } else { cur = { s: r.s, e: r.e, blocks: [b] }; out.push(cur); }
      last = i;
    });
    return out;
  }

  // Lo que se estaba escribiendo pasa al Markdown antes de marcar, y no queda texto elegido.
  function settle() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur && article.contains(a)) a.blur();
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed && article.contains(sel.anchorNode)) sel.removeAllRanges();
  }
  function remember() {
    const at = (b) => (b && W.span(b) ? W.span(b).s : -1);
    const u = units();
    mark = { raw: core.raw, at: Array.from(picked).map(at), a: at(anchor), h: at(head), n: u.length, idx: Array.from(picked).map((b) => u.indexOf(b)), ai: u.indexOf(anchor), hi: u.indexOf(head) };
  }
  function setSel(list, a, h) {
    list = (list || []).filter((b) => b && b.isConnected);
    if (!list.length) { reset(); return; }
    settle();
    picked = new Set(list);
    anchor = a && picked.has(a) ? a : list[0]; head = h && picked.has(h) ? h : list[list.length - 1];
    remember(); paint();
  }
  function reset() {
    picked = new Set(); anchor = null; head = null; mark = null; touchMode = false;
    closeMenu(); paint();
  }
  const clear = () => { if (picked.size || mark || touchMode) reset(); };
  function rangeTo(a, b) {
    const u = shown(); let i = u.indexOf(a); let j = u.indexOf(b);
    if (i < 0 || j < 0) return;
    if (i > j) { const k = i; i = j; j = k; }
    setSel(u.slice(i, j + 1), a, b);
  }
  function toggle(b) {
    const list = shown().filter((n) => (n === b ? !picked.has(n) : picked.has(n)));
    setSel(list, list.includes(b) ? b : null, list.includes(b) ? b : null);
  }
  const selectAll = () => { const u = shown(); setSel(u, u[0], u[u.length - 1]); };
  // Marca los bloques que quedaron en esas líneas, tras un cambio.
  function pickLines(ranges) {
    setSel(shown().filter((b) => { const r = W.span(b); return ranges.some((x) => r.s >= x[0] && r.s < x[1]); }));
  }
  function afterRender() {
    if (!mark) { paint(); return; }
    if (!usable() || core.raw !== mark.raw) { reset(); return; }
    const u = units(); const by = (s) => u.find((b) => W.span(b).s === s) || null;
    picked = new Set(mark.at.map(by).filter(Boolean)); anchor = by(mark.a); head = by(mark.h);
    if (picked.size) paint(); else reset();
  }
  // Otra persona cambió algo y se dibujó en el lugar: lo marcado sigue siendo lo que quedó en pantalla.
  function afterPatch() {
    if (!mark) return;
    const u = units();
    // El bloque que cambió es un nodo nuevo: si la cantidad de bloques es la misma, sigue marcado el de ese lugar.
    if (u.length === mark.n) { picked = new Set(mark.idx.map((i) => u[i]).filter(Boolean)); anchor = u[mark.ai] || null; head = u[mark.hi] || null; }
    else picked.forEach((b) => { if (!b.isConnected || !W.span(b)) picked.delete(b); });
    if (!picked.size) { reset(); return; }
    if (!picked.has(anchor)) anchor = picked.values().next().value;
    if (!picked.has(head)) head = anchor;
    remember(); paint();
  }

  function paint() {
    article.querySelectorAll(':scope > .lmd-bsel').forEach((n) => { if (!picked.has(n)) n.classList.remove('lmd-bsel'); });
    picked.forEach((n) => n.classList.add('lmd-bsel'));
    root.classList.toggle('lmd-bsel-on', picked.size > 0);
    drawBar();
  }

  // ---------- La barra ----------
  // [id, ícono, texto, atajo, solo si se puede editar]
  const BTN = [
    ['grip', ICON.dots, 'Mover los bloques', '', true], ['copy', ICON.copy, 'Copiar', 'Ctrl+C', false], ['cut', CUT, 'Cortar', 'Ctrl+X', true],
    ['dup', DUP, 'Duplicar', 'Ctrl+D', true], ['up', ICON.up, 'Subir', '', true], ['down', ICON.download, 'Bajar', '', true],
    ['del', ICON.trash, 'Eliminar', '', true], ['more', ICON.more, 'Más acciones', '', false],
  ];
  const IN_BAR = ['copy', 'cut', 'dup', 'up', 'down', 'del'];
  // Con el dedo la barra es más corta: subir y bajar van en el menú.
  const docked = () => LMD.touch.coarse();
  const inBar = (id) => IN_BAR.includes(id) && !(docked() && (id === 'up' || id === 'down'));
  function buildBar() {
    bar = el('div', { class: 'lmd-bsel-bar', role: 'toolbar', hidden: '' });
    bar.appendChild(el('span', { class: 'lmd-bsel-n', role: 'status', 'aria-live': 'polite' }));
    BTN.forEach((b) => bar.appendChild(el('button', { type: 'button', 'data-bs': b[0] }, b[1])));
    bar.appendChild(el('button', { type: 'button', class: 'lmd-bsel-done', 'data-bs': 'done' }));
    bar.querySelector('[data-bs=more]').setAttribute('aria-haspopup', 'menu');
    document.body.appendChild(bar);
    // Un clic en la barra no saca el foco de donde estaba.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bs]'); if (!b || b.hidden) return;
      const id = b.dataset.bs;
      if (id === 'done') reset();
      else if (id === 'more') { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 6, actions().filter((a) => !inBar(a.id)), b); }
      else if (id !== 'grip') run(id);
    });
    // La manija: se arrastra con el mouse o con el dedo, y con el foco puesto se mueve con las flechas.
    const grip = bar.querySelector('[data-bs=grip]');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || !canEdit() || !picked.size) return;
      e.preventDefault();
      drag = { kind: 'move', from: null, x: e.clientX, y: e.clientY, last: e.clientY, on: false, id: e.pointerId };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* el puntero ya no está */ }
    });
    grip.addEventListener('pointermove', (e) => { if (drag && drag.id === e.pointerId) dragMove(e); });
    const end = (e) => { if (drag && drag.id === e.pointerId) dragEnd(e.type === 'pointerup'); };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      const all = Array.from(bar.querySelectorAll('button')).filter((b) => !b.hidden); const at = all.indexOf(document.activeElement);
      if (at < 0) return;
      const go = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 }[e.key];
      if (go != null) { e.preventDefault(); e.stopPropagation(); all[(go + all.length) % all.length].focus(); }
    });
  }
  function drawBar() {
    if (!bar) return;
    const n = effective().length;
    if (!n || !usable()) { bar.hidden = true; return; }
    const edit = canEdit();
    bar.setAttribute('aria-label', T('Bloques seleccionados'));
    bar.querySelector('.lmd-bsel-n').textContent = n === 1 ? T('1 bloque') : T('{n} bloques', { n });
    BTN.forEach((d) => {
      const b = bar.querySelector('[data-bs=' + d[0] + ']'); const label = T(d[2]);
      b.setAttribute('aria-label', label); b.title = label + (d[3] ? ' (' + LMD.keys(d[3]) + ')' : '');
      b.hidden = (d[4] && !edit) || (docked() && (d[0] === 'up' || d[0] === 'down'));
    });
    bar.querySelector('[data-bs=more]').hidden = !actions().some((a) => !inBar(a.id));
    const done = bar.querySelector('[data-bs=done]');
    done.textContent = T('Listo'); done.hidden = !(touchMode || docked());
    bar.classList.toggle('lmd-bsel-dock', docked());
    bar.hidden = false;
    placeBar();
  }
  // Arriba del primer bloque marcado; si ese quedó fuera de la vista, pegada al borde de la zona de lectura.
  function placeBar() {
    if (!bar || bar.hidden) return;
    if (bar.classList.contains('lmd-bsel-dock')) { bar.style.top = ''; bar.style.left = ''; return; }
    const first = shown().find((b) => picked.has(b)); if (!first) return;
    const box = first.getBoundingClientRect(); const h = bar.offsetHeight; const w = bar.offsetWidth;
    bar.style.top = Math.max(64, Math.min(window.innerHeight - h - 60, box.top - h - 12)) + 'px';
    bar.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, box.left)) + 'px';
  }

  // ---------- El menú ----------
  function actions() {
    const list = effective(); const edit = canEdit(); const out = [];
    if (!list.length) return out;
    const add = (id, icon, label, cls) => out.push({ id, icon, label, cls: cls || '' });
    add('copy', ICON.copy, 'Copiar');
    if (edit) { add('cut', CUT, 'Cortar'); add('dup', DUP, 'Duplicar'); add('up', ICON.up, 'Subir'); add('down', ICON.download, 'Bajar'); }
    if (canNew()) add('doc-copy', ICON.file, 'Copiar a una nota nueva');
    if (edit && canNew()) add('doc-move', ICON.doc, 'Mover a una nota nueva');
    if (edit && core.settings.plugins.containers && LMD.fold && LMD.fold.wrap && groups(list).length === 1) add('wrap', ICON.b_details, 'Envolver en una sección desplegable');
    if (edit && list.every(isPara)) {
      add('to-ul', ICON.b_ul, 'Convertir en lista con viñetas'); add('to-ol', ICON.b_ol, 'Convertir en lista numerada');
      add('to-task', ICON.b_task, 'Convertir en lista de tareas'); add('to-quote', ICON.b_quote, 'Convertir en cita');
    }
    if (edit) add('del', ICON.trash, 'Eliminar', 'lmd-menu-danger');
    return out;
  }
  function run(id) {
    if (id === 'copy') copy();
    else if (id === 'cut') cut();
    else if (id === 'dup') duplicate();
    else if (id === 'del') remove();
    else if (id === 'up' || id === 'down') moveBy(id === 'up' ? -1 : 1);
    else if (id === 'doc-copy' || id === 'doc-move') toDoc(id === 'doc-move');
    else if (id === 'wrap') wrap();
    else if (/^to-/.test(id)) convert(id.slice(3));
  }
  // back: el foco vuelve a quien lo abrió (se cerró con Escape).
  function closeMenu(back) {
    if (!menu) return;
    const from = menu._from; menu.remove(); menu = null;
    if (from) { from.setAttribute('aria-expanded', 'false'); if (back && from.isConnected && !from.hidden) from.focus(); }
  }
  function openMenu(x, y, items, from) {
    closeMenu(); W.closeMenu();
    if (!items.length) return;
    menu = el('div', { class: 'lmd-menu lmd-menu-read lmd-bsel-menu', role: 'menu', 'aria-label': T('Bloques seleccionados') });
    const box = el('div', { class: 'lmd-menu-list' });
    items.forEach((it) => {
      const b = el('button', { type: 'button', role: 'menuitem', 'data-bs': it.id }, it.icon);
      if (it.cls) b.className = it.cls;
      b.appendChild(el('span', { text: T(it.label) })); box.appendChild(b);
    });
    menu.appendChild(box); menu._from = from || null;
    document.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, x)) + 'px';
    menu.style.top = Math.max(8, y + menu.offsetHeight + 8 > window.innerHeight ? y - menu.offsetHeight - 12 : y) + 'px';
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const id = b.dataset.bs; closeMenu(); run(id); });
    menu.addEventListener('keydown', (e) => {
      const all = Array.from(menu.querySelectorAll('button')); const at = all.indexOf(document.activeElement);
      const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
      if (go != null) { e.preventDefault(); e.stopPropagation(); all[(go + all.length) % all.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    });
    if (from) { from.setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus(); }
  }

  // ---------- El Markdown ----------
  // Las operaciones trabajan sobre una copia de las líneas, cada una en su caja: así lo que se movió o se creó se
  // reconoce al final aunque haya cambiado de lugar (m), y los renglones en blanco que quedaron de junta (j) se revisan.
  const boxed = () => lines().map((t) => ({ t }));
  const bl = (L, i) => i < fm() || i >= L.length || L[i].t.trim() === '';
  const tag = (L, i) => { if (i >= 0 && i < L.length) L[i].j = true; };
  // Saca las líneas [s, e) y no deja dos renglones en blanco donde había uno. Devuelve dónde quedó el hueco.
  function cutOut(L, s, e) {
    let n = e - s;
    if (bl(L, s - 1) && bl(L, e)) { if (e < L.length) n++; else if (s > fm()) { s--; n++; } }
    L.splice(s, n);
    tag(L, s - 1); tag(L, s);
    return s;
  }
  // Pone esas líneas en at, con un renglón en blanco antes y después si hace falta.
  function putIn(L, at, body) {
    const pre = bl(L, at - 1) ? [] : [{ t: '' }]; const post = bl(L, at) ? [] : [{ t: '' }];
    L.splice(at, 0, ...pre, ...body, ...post);
    const start = at + pre.length;
    tag(L, start - 1); tag(L, start + body.length);
    return start;
  }
  // Dos tablas con un solo renglón en blanco en el medio se leen como una (write.js): donde un cambio las dejó así,
  // va un renglón más.
  const RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  function glue(L) {
    for (let i = L.length - 3; i > fm(); i--) {
      if (L[i].j && L[i].t.trim() === '' && L[i - 1].t.includes('|') && L[i + 1].t.includes('|') && L[i + 2].t.includes('|') && RULE.test(L[i + 2].t)) L.splice(i, 0, { t: '' });
    }
  }
  // Escribe el resultado: solo las líneas que cambiaron, en un solo paso de deshacer. Después marca lo que se movió.
  function finish(L) {
    glue(L);
    const next = L.map((x) => x.t); const cur = lines(); const made = [];
    L.forEach((x, i) => { if (!x.m) return; const last = made[made.length - 1]; if (last && last[1] === i) last[1] = i + 1; else made.push([i, i + 1]); });
    let a = 0; while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
    if (a === cur.length && a === next.length) return false;
    let b = 0; while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
    reset();
    core.spliceLines(a, cur.length - a - b, next.slice(a, next.length - b));
    core.render();
    if (made.length) {
      // Lo que cayó dentro de una sección plegada no queda escondido: esa sección se despliega.
      // Lo que viajó debajo de su propio título plegado sigue plegado.
      const moved = (b) => made.some((x) => W.span(b).s >= x[0] && W.span(b).s < x[1]);
      const all = units(); const shut = all.filter((b) => b.classList.contains('lmd-fold-shut') && !moved(b));
      if (LMD.fold && shut.length) all.forEach((b) => { if (!seen(b) && moved(b) && shut.some((h) => LMD.fold.section(h).includes(b))) LMD.fold.reveal(b); });
      pickLines(made);
    }
    return true;
  }
  // En una sesión en vivo, lo que otro está escribiendo no se corta, no se mueve ni se elimina.
  function locked() {
    let who = null;
    effective().some((b) => { const h = b.matches('.lmd-live-held') ? b : b.querySelector('.lmd-live-held'); if (h) who = h.dataset.liveBy || ''; return !!h; });
    if (who == null) return false;
    core.flash(T('{a} está escribiendo en esos bloques', { a: who }), 'warn');
    return true;
  }
  const said = (one, many, n) => core.flash(n === 1 ? T(one) : T(many, { n }));

  // ---------- Copiar y pegar ----------
  // Al portapapeles va el Markdown como texto (con los números de título que se ven) y lo dibujado como HTML.
  // El HTML lleva además el Markdown tal cual está en la nota: con eso, pegar sobre un bloque marcado los inserta.
  let lastCopy = null; let pending = null; let wrote = false;
  function payload() {
    const list = effective(); if (!list.length) return null;
    const gs = groups(list); const src = lines();
    const shownMd = LMD.page && LMD.page.md ? LMD.page.md().split(/\r?\n/) : src;
    const text = (from) => gs.map((g) => from.slice(g.s, g.e).join('\n')).join('\n\n');
    const box = el('div');
    list.forEach((b) => box.appendChild(b.cloneNode(true)));
    box.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-kanban-off, .lmd-jy, .lmd-cl-bar, .lmd-cl-add, .lmd-cl-grip, .lmd-src').forEach((n) => n.remove());
    if (LMD.fold) LMD.fold.clean(box, true);
    box.querySelectorAll('table').forEach((t) => t.setAttribute('style', 'border-collapse:collapse'));
    box.querySelectorAll('th, td').forEach((c) => c.setAttribute('style', 'border:1px solid #c9c9c9;padding:6px 10px;vertical-align:top'));
    box.querySelectorAll('pre').forEach((p) => { p.hidden = false; p.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:10px;white-space:pre-wrap'); });
    box.querySelectorAll('code').forEach((c) => { if (!c.closest('pre')) c.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:1px 4px'); });
    box.querySelectorAll('.lmd-noedit, .lmd-editable').forEach((n) => n.removeAttribute('title'));
    box.querySelectorAll('*').forEach((n) => {
      Array.from(n.attributes).forEach((a) => { if (/^(class|contenteditable|spellcheck|tabindex|role|id)$/.test(a.name) || /^(data-|aria-)/.test(a.name)) n.removeAttribute(a.name); });
    });
    const raw = text(src);
    const wrap = el('div', { 'data-lmd-blocks': encodeURIComponent(raw) });
    while (box.firstChild) wrap.appendChild(box.firstChild);
    return { md: text(shownMd.length === src.length ? shownMd : src), raw, html: wrap.outerHTML, n: list.length };
  }
  const fill = (e, p) => { e.clipboardData.setData('text/plain', p.md); e.clipboardData.setData('text/html', p.html); e.preventDefault(); wrote = true; lastCopy = p; };
  // Desde un botón: se dispara la copia del navegador, que pasa por fill; si no la deja, queda la del portapapeles.
  function write(p) {
    lastCopy = p; pending = p; wrote = false;
    try { document.execCommand('copy'); } catch (e) { /* sin ese camino */ }
    pending = null;
    if (wrote) return;
    try {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([p.html], { type: 'text/html' }), 'text/plain': new Blob([p.md], { type: 'text/plain' }) })])
        .catch(() => navigator.clipboard.writeText(p.md).catch(() => {}));
    } catch (e) { try { navigator.clipboard.writeText(p.md).catch(() => {}); } catch (err) { /* sin portapapeles */ } }
  }
  function copy() {
    const p = payload(); if (!p) return;
    write(p); said('Bloque copiado', 'Bloques copiados: {n}', p.n);
  }
  function cut() {
    if (!canEdit() || locked()) return;
    const p = payload(); if (!p) return;
    write(p);
    if (remove(true)) said('Bloque cortado. Ctrl+Z lo deshace', 'Bloques cortados: {n}. Ctrl+Z los deshace', p.n);
  }
  // Ctrl+C y Ctrl+X con bloques marcados y sin texto elegido.
  function onClip(e) {
    if (pending) { fill(e, pending); return; }
    if (!picked.size || !usable() || inField(e.target) || document.querySelector(OVER)) return;
    const sel = getSelection(); if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const isCut = e.type === 'cut';
    if (isCut && (!canEdit() || locked())) { e.preventDefault(); return; }
    const p = payload(); if (!p) return;
    fill(e, p);
    if (!isCut) said('Bloque copiado', 'Bloques copiados: {n}', p.n);
    else if (remove(true)) said('Bloque cortado. Ctrl+Z lo deshace', 'Bloques cortados: {n}. Ctrl+Z los deshace', p.n);
  }
  // El Markdown de lo que se copió como bloques, si el portapapeles trae eso.
  function fromClip(html, plain) {
    if (html && html.indexOf('data-lmd-blocks') >= 0) {
      try {
        const d = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-lmd-blocks]');
        const v = d && d.getAttribute('data-lmd-blocks'); if (v) return decodeURIComponent(v);
      } catch (e) { /* no es de acá */ }
    }
    const norm = (t) => String(t || '').replace(/\r\n?/g, '\n').trim();
    return lastCopy && plain && norm(plain) === norm(lastCopy.md) ? lastCopy.raw : null;
  }
  function pasteBelow(text) {
    const list = effective(); if (!list.length || !canEdit()) return false;
    const body = String(text).replace(/\r\n?/g, '\n').split('\n');
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    if (!body.length) return false;
    const L = boxed();
    putIn(L, W.span(list[list.length - 1]).e, body.map((t) => ({ t, m: true })));
    return finish(L);
  }
  function onPaste(e) {
    if (!picked.size || !usable() || !canEdit() || inField(e.target) || document.querySelector(OVER) || !e.clipboardData) return;
    const text = fromClip(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
    if (text == null) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pasteBelow(text);
  }

  // ---------- Eliminar, duplicar, mover ----------
  function remove(quiet) {
    if (!canEdit() || locked()) return false;
    const list = effective(); const gs = groups(list); if (!gs.length) return false;
    const L = boxed();
    for (let i = gs.length - 1; i >= 0; i--) cutOut(L, gs[i].s, gs[i].e);
    if (!finish(L)) return false;
    if (!quiet) said('Bloque eliminado. Ctrl+Z lo deshace', 'Bloques eliminados: {n}. Ctrl+Z los deshace', list.length);
    return true;
  }
  // La copia va debajo de cada tramo de bloques seguidos, y queda marcada.
  function duplicate() {
    if (!canEdit()) return;
    const gs = groups(effective()); if (!gs.length) return;
    const L = boxed();
    for (let i = gs.length - 1; i >= 0; i--) putIn(L, gs[i].e, L.slice(gs[i].s, gs[i].e).map((x) => ({ t: x.t, m: true })));
    finish(L);
  }
  // De a un bloque: cada tramo cambia de lugar con el bloque que tiene al lado. Un título plegado cuenta con lo suyo.
  function moveBy(dir) {
    if (!canEdit() || locked()) return;
    const u = units(); const gs = groups(effective()); if (!gs.length) return;
    const L = boxed(); const at = (b) => W.span(b);
    (dir < 0 ? gs : gs.slice().reverse()).forEach((g) => {
      g.blocks.forEach((b) => { const r = at(b); for (let i = r.s; i < r.e; i++) L[i].m = true; });
      const i = u.indexOf(g.blocks[0]); const j = u.indexOf(g.blocks[g.blocks.length - 1]);
      let a; let b;
      if (dir < 0) {
        let k = i - 1; if (k < 0) return;
        const end = u[k]; while (k > 0 && !seen(u[k])) k--;
        a = { s: at(u[k]).s, e: at(end).e }; b = { s: g.s, e: g.e };
      } else {
        if (j + 1 >= u.length) return;
        const first = u[j + 1]; let end = first;
        if (first.classList.contains('lmd-fold-shut') && LMD.fold) { const sec = LMD.fold.section(first).filter((n) => u.includes(n)); if (sec.length) end = sec[sec.length - 1]; }
        a = { s: g.s, e: g.e }; b = { s: at(first).s, e: at(end).e };
      }
      if (a.e > b.s) return;
      const one = L.slice(a.s, a.e); const gap = L.slice(a.e, b.s); const two = L.slice(b.s, b.e);
      gap.forEach((x) => { x.j = true; });
      L.splice(a.s, b.e - a.s, ...two, ...gap, ...one);
      tag(L, a.s - 1); tag(L, b.e);
    });
    if (finish(L) && head && head.isConnected) head.scrollIntoView({ block: 'nearest' });
  }
  // Arrastrando: todo lo marcado va junto antes del bloque next (o al final).
  function moveTo(next) {
    if (!canEdit() || locked()) return;
    const gs = groups(effective()); if (!gs.length) return;
    const L = boxed(); const mine = (i) => gs.some((g) => i >= g.s && i < g.e);
    // La línea que queda justo después de donde se soltó: sirve de referencia cuando lo de arriba cambia de lugar.
    let ref = null;
    for (let i = next ? W.span(next).s : L.length; i < L.length; i++) if (L[i].t.trim() && !mine(i)) { ref = L[i]; break; }
    const body = [];
    gs.forEach((g, k) => { if (k) body.push({ t: '' }); L.slice(g.s, g.e).forEach((x) => { x.m = true; body.push(x); }); });
    for (let i = gs.length - 1; i >= 0; i--) cutOut(L, gs[i].s, gs[i].e);
    let to = ref ? L.indexOf(ref) : L.length;
    if (!ref) while (to > fm() && !L[to - 1].t.trim()) to--;
    putIn(L, to, body);
    finish(L);
  }

  // ---------- Envolver y convertir ----------
  function wrap() {
    if (!canEdit() || locked()) return;
    const gs = groups(effective()); if (gs.length !== 1) return;
    reset();
    LMD.fold.wrap(gs[0].s, gs[0].e);
  }
  // La marca de una lista nueva: si la de al lado es de otro tipo, otra marca, para que no se junten (write.js).
  function bullet(kind, L, s, e) {
    const near = (i, d) => { for (; i >= fm() && i < L.length; i += d) if (L[i].t.trim()) return L[i].t; return ''; };
    const taken = new Set();
    [near(s - 1, -1), near(e, 1)].forEach((line) => { const m = /^\s{0,3}([-*+])\s+(\[[ xX]\](?:\s+|$))?/.exec(line); if (m && !!m[2] !== (kind === 'task')) taken.add(m[1]); });
    return ['-', '*', '+'].find((c) => !taken.has(c)) + ' ' + (kind === 'task' ? '[ ] ' : '');
  }
  // Párrafos seguidos pasan a ser una lista (un ítem cada uno) o una sola cita.
  function convert(kind) {
    if (!canEdit() || locked()) return;
    const list = effective(); if (!list.length || !list.every(isPara)) return;
    const gs = groups(list); const L = boxed();
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i]; const used = new Set();
      const paras = g.blocks.map((b) => { const r = W.span(b); const out = []; for (let k = r.s; k < r.e; k++) { used.add(k); out.push(L[k].t); } return out; });
      let body = [];
      if (kind === 'quote') paras.forEach((p, k) => { if (k) body.push('>'); p.forEach((l) => body.push('> ' + l.trim())); });
      else { const lead = bullet(kind, L, g.s, g.e); body = paras.map((p, k) => (kind === 'ol' ? (k + 1) + '. ' : lead) + p.map((l) => l.replace(/\\$/, '').trim()).join(' ')); }
      // Lo que había entre dos párrafos y no se dibuja (una definición de enlace, un comentario) queda debajo.
      const rest = []; for (let k = g.s; k < g.e; k++) if (!used.has(k) && L[k].t.trim()) rest.push(L[k]);
      L.splice(g.s, g.e - g.s, ...body.map((t) => ({ t, m: true })), ...(rest.length ? [{ t: '' }].concat(rest) : []));
    }
    finish(L);
  }

  // ---------- A una nota nueva ----------
  // Dónde: en el mismo lugar que la nota abierta (su carpeta del disco o de la nube, o las notas del navegador).
  const canNew = () => {
    const r = core.appRoot;
    return !!core.APP && !!r && !core.readOnly && !(LMD.cloud && LMD.cloud.guest && LMD.cloud.guest()) && ['local', 'cloud', 'dir', 'file'].includes(r.kind);
  };
  const textOf = (b) => { const c = b.cloneNode(true); c.querySelectorAll('.lmd-anchor, .lmd-hnum, .lmd-code-copy, .lmd-code-lang, .lmd-cl-grip').forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  // El nombre sale del primer título; sin título, de las primeras palabras.
  function titleOf(list) {
    const h = list.find((b) => /^H[1-6]$/.test(b.tagName) && textOf(b));
    if (h) return textOf(h).slice(0, 80).trim();
    for (const b of list) { const t = textOf(b); if (t) return t.split(' ').slice(0, 6).join(' ').slice(0, 80).trim(); }
    return '';
  }
  // Como nombre de archivo: sin lo que un sistema de archivos o una dirección no aceptan.
  const fileName = (t) => String(t || '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|#%&{}$!'`@+=^~[\]()]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 60).trim() || T('nota');
  const linkTo = (title, url) => '[' + title.replace(/([\\[\]*`_<>&])/g, '\\$1') + '](' + core.links.rel(url) + ')';
  // Crea la nota sin pisar otra. Devuelve { url, file }, { unsaved: true } si quedó abierta sin guardar, o null.
  async function create(name, text) {
    const r = core.appRoot; const here = core.HERE; const dir = here.slice(0, here.lastIndexOf('/') + 1);
    if (r.kind === 'local') {
      let file = name + '.md';
      for (let n = 2; n < 50 && await LMD.store.noteGet(file); n++) file = name + '-' + n + '.md';
      await LMD.store.notePut(file, text);
      core.reloadTree();
      return { url: dir + encodeURIComponent(file), file };
    }
    if (r.kind === 'cloud' || r.kind === 'dir') {
      const url = await LMD.extras.newIn(dir, { name, text });
      return url ? { url, file: decodeURIComponent(url.split('/').pop()) } : null;
    }
    // Un archivo abierto suelto: no hay carpeta ni cuenta donde dejarla.
    if (r.id === 'mem') { core.flash(T('Guardá esta nota antes de pasar bloques a una nueva.'), 'warn'); return null; }
    if (!(await core.openText(name + '.md', text))) return null;
    core.flash(T('No hay dónde guardar la nota nueva: quedó abierta sin guardar y el original no cambió.'), 'warn');
    return { unsaved: true };
  }
  async function toDoc(move) {
    if (busy || !canNew() || (move && (!canEdit() || locked()))) return;
    const list = effective(); const gs = groups(list); if (!gs.length) return;
    const src = lines(); const eol = /\r\n/.test(core.raw) ? '\r\n' : '\n';
    const text = gs.map((g) => src.slice(g.s, g.e).join(eol)).join(eol + eol) + eol;
    const title = titleOf(list) || T('nota'); const was = core.raw; const here = core.HERE;
    busy = true; let made = null;
    try { made = await create(fileName(title), text); } catch (e) { core.flash(T('No se pudo crear la nota nueva.'), 'error'); }
    busy = false;
    if (!made || made.unsaved) return;
    if (move) {
      // Mientras se creaba la nota, esta no cambió: se quitan los bloques y queda un enlace en su lugar.
      if (core.HERE !== here || core.raw !== was || !canEdit()) { core.flash(T('La nota cambió mientras tanto: los bloques quedaron también acá.'), 'warn'); return; }
      const L = boxed(); let at = fm();
      for (let i = gs.length - 1; i >= 0; i--) at = cutOut(L, gs[i].s, gs[i].e);
      putIn(L, at, [{ t: linkTo(title, made.url), m: true }]);
      finish(L);
    }
    core.flash(T('Nota nueva: {a}', { a: made.file }));
  }

  // ---------- El mouse ----------
  let drag = null; let drop = null; let line = null; let eat = 0;
  const contentLeft = () => { const r = article.getBoundingClientRect(); return r.left + (parseFloat(getComputedStyle(article).paddingLeft) || 0); };
  // El bloque a esa altura de la pantalla. Entre dos bloques, el más cercano.
  function blockAt(y, loose) {
    let best = null; let gap = Infinity;
    for (const b of shown()) {
      const r = b.getBoundingClientRect(); if (!r.height && !r.width) continue;
      if (y >= r.top && y <= r.bottom) return b;
      const d = y < r.top ? r.top - y : y - r.bottom;
      if (d < gap) { gap = d; best = b; }
    }
    return loose || gap <= 28 ? best : null;
  }
  // Dónde caería lo arrastrado: antes del bloque next, o al final. Dentro de lo marcado no hay dónde.
  function dropAt(y) {
    const u = shown(); if (!u.length) return null;
    const mine = new Set(effective());
    let i = 0; while (i < u.length) { const r = u[i].getBoundingClientRect(); if (y < r.top + r.height / 2) break; i++; }
    const prev = u[i - 1] || null; const next = u[i] || null;
    if (prev && next && mine.has(prev) && mine.has(next)) return null;
    const a = prev ? prev.getBoundingClientRect().bottom : null; const b = next ? next.getBoundingClientRect().top : null;
    return { next, y: a != null && b != null ? (a + b) / 2 : b != null ? b - 8 : a + 8 };
  }
  function showDrop(spot) {
    drop = spot;
    if (!spot) { if (line) line.hidden = true; return; }
    if (!line) { line = el('div', { class: 'lmd-bsel-drop', role: 'presentation' }); document.body.appendChild(line); }
    const r = article.getBoundingClientRect(); const left = contentLeft();
    line.style.top = (spot.y - 1.5) + 'px'; line.style.left = left + 'px'; line.style.width = Math.max(40, r.right - left - (left - r.left)) + 'px';
    line.hidden = false;
  }
  function dragTrack() {
    if (!drag || !drag.on) return;
    // Si la nota se redibujó a mitad del arrastre, el bloque de partida es el que quedó en su lugar.
    if (drag.kind === 'range' && drag.from && !drag.from.isConnected && anchor) drag.from = anchor;
    if (drag.kind === 'range') { const b = blockAt(drag.last, true); if (b && (b !== head || anchor !== drag.from)) rangeTo(drag.from, b); }
    else showDrop(dropAt(drag.last));
  }
  function dragMove(e) {
    drag.last = e.clientY;
    if (!drag.on) {
      if (Math.abs(e.clientY - drag.y) < 5 && Math.abs(e.clientX - drag.x) < 5) return;
      drag.on = true; W.closeMenu(); closeMenu();
      root.classList.add(drag.kind === 'move' ? 'lmd-bsel-moving' : 'lmd-bsel-ranging');
      if (drag.kind === 'range') setSel([drag.from]);
      // Cerca del borde de arriba o de abajo, la página se desplaza sola.
      const tick = () => {
        if (!drag || !drag.on) return;
        const y = drag.last; const top = 96; const bottom = window.innerHeight - 72;
        const v = y < top ? -Math.min(26, Math.ceil((top - y) / 3)) : y > bottom ? Math.min(26, Math.ceil((y - bottom) / 3)) : 0;
        if (v) { window.scrollBy(0, v); dragTrack(); }
        drag.raf = requestAnimationFrame(tick);
      };
      drag.raf = requestAnimationFrame(tick);
    }
    if (e.cancelable) e.preventDefault();
    dragTrack();
  }
  function dragEnd(done) {
    const d = drag; drag = null; if (!d) return false;
    cancelAnimationFrame(d.raf);
    root.classList.remove('lmd-bsel-moving', 'lmd-bsel-ranging');
    const spot = drop; showDrop(null);
    if (!d.on) return false;
    if (done && d.kind === 'move' && spot) moveTo(spot.next);
    placeBar();
    return true;
  }
  const onMove = (e) => { if (drag) dragMove(e); };
  function onUp() {
    document.removeEventListener('mousemove', onMove, true); document.removeEventListener('mouseup', onUp, true);
    const d = drag;
    if (dragEnd(true)) eat = Date.now();
    // Un clic en el margen de un bloque ya marcado deja marcado solo ese.
    else if (d && d.kind === 'move' && !d.handle && d.from) setSel([d.from]);
  }
  function onDown(e) {
    eat = 0;
    if (e.button === 2 && picked.size && usable()) {
      // Clic derecho sobre lo marcado: el cursor no entra al bloque, que eso lo soltaría.
      const b = e.target === article ? blockAt(e.clientY) : unitOf(e.target);
      if (b && effective().includes(b)) e.preventDefault();
      return;
    }
    if (e.button !== 0 || !usable() || busy) return;
    const t = e.target; if (!t || !t.closest) return;
    if ((bar && bar.contains(t)) || (menu && menu.contains(t))) return;
    closeMenu();
    const handle = t.closest('.lmd-handle'); const inside = article.contains(t);
    // Un clic afuera suelta lo marcado. La barra de desplazamiento no cuenta.
    if (!handle && !inside) { if (t !== root) clear(); return; }
    if (touchMode) {
      // Con el dedo, en modo selección: tocar un bloque lo suma o lo quita.
      const b = inside ? unitOf(t) || (t === article ? blockAt(e.clientY) : null) : null;
      if (b && seen(b)) { e.preventDefault(); eat = Date.now(); toggle(b); }
      return;
    }
    if (LMD.touch.touched()) { clear(); return; }
    const margin = !!handle || (t === article && e.clientX < contentLeft() + 1);
    const b = handle ? blockAt(handle.getBoundingClientRect().top + 6, true) : margin ? blockAt(e.clientY) : unitOf(t);
    if (!b || !seen(b)) { if (!handle) clear(); return; }
    if (e.shiftKey) {
      // Extiende desde el último marcado; sin nada marcado, desde el bloque donde está el cursor.
      const a = document.activeElement;
      const from = picked.size ? anchor : (core.editMode && a && a.isContentEditable && article.contains(a) ? unitOf(a) : null);
      if (!from || (!picked.size && from === b && !margin)) return; // dentro del mismo bloque se sigue eligiendo texto
      e.preventDefault(); eat = Date.now(); rangeTo(from, b);
      return;
    }
    if (LMD.mod(e)) {
      if (t.closest('a')) return; // Ctrl + clic sobre un enlace lo sigue
      e.preventDefault(); eat = Date.now(); toggle(b);
      return;
    }
    if (!margin) { clear(); return; }
    e.preventDefault();
    const moving = picked.has(b) && canEdit();
    if (!moving && !handle) setSel([b]);
    drag = { kind: moving ? 'move' : 'range', from: b, x: e.clientX, y: e.clientY, last: e.clientY, on: false, handle: !!handle };
    document.addEventListener('mousemove', onMove, true); document.addEventListener('mouseup', onUp, true);
  }
  function onClick(e) {
    const t = e.target;
    if (eat && Date.now() - eat < 1000) { eat = 0; if (!(bar && bar.contains(t)) && !(menu && menu.contains(t))) { e.preventDefault(); e.stopPropagation(); } return; }
    // La manija de un bloque que está entre varios marcados abre las acciones de todos.
    const h = t && t.closest ? t.closest('.lmd-handle') : null;
    if (!h || effective().length < 2) return;
    const b = blockAt(h.getBoundingClientRect().top + 6, true);
    if (!b || !picked.has(b)) return;
    e.preventDefault(); e.stopPropagation();
    const r = h.getBoundingClientRect(); openMenu(r.right + 6, r.top, actions());
  }
  function onContext(e) {
    if (Date.now() - pressed < 1500) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.shiftKey || !usable() || effective().length < 2) return;
    const b = e.target === article ? blockAt(e.clientY) : unitOf(e.target);
    if (!b || !effective().includes(b)) return;
    e.preventDefault(); e.stopPropagation();
    openMenu(e.clientX, e.clientY, actions());
  }

  // ---------- Con el dedo ----------
  // Mantener apretado un bloque entra en modo selección. Dentro del bloque donde ya está el cursor, mantener
  // apretado sigue siendo elegir texto. Leyendo, el menú de siempre ofrece "Seleccionar el bloque".
  let press = null; let pressed = 0;
  function bindTouch() {
    const cancel = () => { clearTimeout(press); press = null; }; let at = null; let fired = false;
    article.addEventListener('touchstart', (e) => {
      cancel(); fired = false;
      if (!usable() || !core.editMode || touchMode || e.touches.length !== 1) return;
      const t = e.target; const a = document.activeElement;
      if (!t.closest || t.closest('button, input, textarea, a') || (a && a !== document.body && a.contains(t))) return;
      const b = unitOf(t); if (!b || !seen(b)) return;
      at = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      press = setTimeout(() => { press = null; fired = true; pressed = Date.now(); touchMode = true; setSel([b]); getSelection().removeAllRanges(); }, 500);
    }, { passive: true });
    article.addEventListener('touchmove', (e) => {
      const p = e.touches[0];
      if (press && p && at && (Math.abs(p.clientX - at.x) > 10 || Math.abs(p.clientY - at.y) > 10)) cancel();
    }, { passive: true });
    // Al levantar el dedo no sale un clic sobre el bloque recién marcado.
    article.addEventListener('touchend', (e) => { cancel(); if (fired && e.cancelable) e.preventDefault(); fired = false; });
    article.addEventListener('touchcancel', cancel);
    // El navegador elige una palabra al mantener apretado: en modo selección no queda texto elegido.
    document.addEventListener('selectionchange', () => {
      if (!touchMode || Date.now() - pressed > 1200) return;
      const sel = getSelection(); if (sel.rangeCount && !sel.isCollapsed && article.contains(sel.anchorNode)) sel.removeAllRanges();
    });
  }

  // ---------- El teclado ----------
  const allPicked = (node) => { const sel = getSelection(); const flat = (s) => String(s).replace(/\s+/g, ''); return flat(sel.toString()) === flat(node.textContent); };
  function step(dir, extend) {
    const u = shown(); const i = u.indexOf(head); if (i < 0) return;
    const to = u[Math.max(0, Math.min(u.length - 1, i + dir))];
    if (extend) rangeTo(anchor, to); else setSel([to]);
    to.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (!usable()) return;
    const t = e.target; const typing = inField(t); const mod = LMD.mod(e); const key = e.key;
    if (mod && !e.shiftKey && !e.altKey && key.toLowerCase() === 'a') {
      // Ctrl+A con bloques marcados los marca todos; escribiendo, la segunda vez (con el texto del bloque ya elegido).
      if (document.querySelector(OVER)) return;
      if ((picked.size && !typing) || (core.editMode && t && t.isContentEditable && article.contains(t) && allPicked(t))) { e.preventDefault(); e.stopPropagation(); selectAll(); }
      return;
    }
    if (!picked.size || typing) return;
    if (menu) { if (!menu.contains(t) && key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); } return; }
    if (document.querySelector(OVER)) return;
    const inBar = bar.contains(t); const edit = canEdit();
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (key === 'Escape') { take(); if (inBar) t.blur(); reset(); return; }
    if (key === 'Tab') {
      // Tab lleva el foco a la barra; desde ella, vuelve al documento.
      take();
      if (inBar) t.blur(); else { const b = Array.from(bar.querySelectorAll('button')).find((x) => !x.hidden && x.dataset.bs !== 'grip') || bar.querySelector('button:not([hidden])'); if (b) b.focus(); }
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const dir = key === 'ArrowUp' ? -1 : 1; if (mod) return;
      take();
      if (e.altKey || (inBar && t.dataset.bs === 'grip')) { if (edit) moveBy(dir); } else step(dir, e.shiftKey);
      return;
    }
    if (inBar && (key === 'Enter' || key === ' ' || /^(Arrow|Home|End)/.test(key))) return;
    if (key === 'Delete' || key === 'Backspace') { take(); if (edit) remove(); return; }
    if (mod && !e.shiftKey && !e.altKey && key.toLowerCase() === 'd') { if (edit) { take(); duplicate(); } return; }
    if (key === 'Enter' && !mod && !e.altKey) {
      // Enter entra a escribir en el bloque.
      const b = head; const node = edit && b ? (b.matches('.lmd-editable') ? b : b.querySelector('.lmd-editable')) : null;
      if (!node) return;
      take(); reset();
      if (LMD.fold) LMD.fold.reveal(node);
      node.focus(); const sel = getSelection(); sel.selectAllChildren(node); sel.collapseToEnd();
      return;
    }
    // Empezar a escribir suelta lo marcado.
    if (key.length === 1 && !mod && !e.altKey) reset();
  }

  function init(c) {
    core = c; article = core.ui.article; W = LMD.write;
    buildBar();
    core.hooks.render.push(afterRender); core.hooks.patch.push(afterPatch); core.hooks.doc.push(reset);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    article.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('copy', onClip, true); document.addEventListener('cut', onClip, true);
    document.addEventListener('paste', onPaste, true);
    bindTouch();
    // Entrar a escribir en un bloque suelta lo marcado.
    article.addEventListener('focusin', (e) => { if (picked.size && e.target.closest && e.target.closest('.lmd-editable, .lmd-src')) reset(); });
    // Escape en un bloque descarta lo escrito (content.js) y lo deja marcado: desde ahí se sigue con el teclado.
    article.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !core.editMode || !usable()) return;
      const node = e.target.closest && e.target.closest('.lmd-editable'); if (!node || node.classList.contains('lmd-draft')) return;
      const b = unitOf(node); if (!b) return;
      const at = W.span(b).s;
      // Si Escape cerró otra cosa (un menú, la lista de enlaces), el cursor sigue en el bloque y no se marca nada.
      setTimeout(() => {
        const a = document.activeElement;
        if (picked.size || !usable() || !core.editMode || (a && a !== document.body) || document.querySelector(OVER + ', .lmd-menu')) return;
        const again = units().find((x) => W.span(x).s === at);
        if (again && seen(again)) setSel([again]);
      }, 0);
    }, true);
    let queued = false;
    const follow = () => { if (menu) closeMenu(); if (queued || !bar || bar.hidden) return; queued = true; requestAnimationFrame(() => { queued = false; placeBar(); }); };
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    // Con el dedo no hay margen del que arrastrar: el menú de un bloque (el de la manija y el de mantener apretado
    // leyendo) ofrece entrar a seleccionar.
    const byTouch = () => LMD.touch.coarse() || LMD.touch.touched();
    const pick = (block) => { touchMode = true; setSel([block]); };
    W.editMenu.push(({ block, draft }) => (byTouch() && block && !draft && unitOf(block) === block ? [['block', 'bsel-pick', ICON.check, 'Seleccionar el bloque', () => pick(block)]] : []));
    W.readMenu.push(({ block, picked: text }) => (byTouch() && !text && block && unitOf(block) === block ? ['bsel-pick', ICON.check, 'Seleccionar el bloque', () => pick(block)] : null));
  }

  LMD.blocks = { init, clear, count: () => effective().length, active: () => picked.size > 0, picked: () => effective() };
})();
