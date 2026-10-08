// Herramienta: modo presentación. La nota abierta como diapositivas: una por cada título de nivel 1 o 2, y un
// separador (---) corta a mano. Cada diapositiva es el mismo contenido ya dibujado en la nota (tablas, código,
// fórmulas, diagramas, imágenes), achicado si no entra. Una cita [!NOTE] es una nota del orador: no se proyecta.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ICON = {
    present: svg('<rect x="3.500" y="4.500" width="17" height="11.500" rx="1.500"/><path d="M12 16v3.500M8.500 19.500h7M10.500 8v4.500l3.800-2.250z"/>'),
    prev: svg('<path d="m14.500 6-6 6 6 6"/>'), next: svg('<path d="m9.500 6 6 6-6 6"/>'),
    grid: svg('<rect x="4" y="4" width="6.500" height="6.500" rx="1"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1"/>'),
    laser: svg('<circle cx="12" cy="12" r="2.500"/><path d="M12 4v2.500M12 17.500V20M4 12h2.500M17.500 12H20M6.300 6.300l1.800 1.800M15.900 15.900l1.800 1.800M17.700 6.300l-1.800 1.800M8.100 15.900l-1.800 1.800"/>'),
    notes: svg('<path d="M5 5.500h14v9.500H10l-4 3.500V15H5z"/><path d="M8.500 9h7M8.500 12h4.500"/>'),
    full: svg('<path d="M4.500 9.500v-5h5M19.500 9.500v-5h-5M4.500 14.500v5h5M19.500 14.500v5h-5"/>'),
    pdf: LMD.kit.ICON.doc, close: LMD.kit.ICON.close,
  };
  const KEY = LMD.keys('Alt+Shift+P');
  let core = null; let on = false; let wired = false;
  let st = null; // la presentación abierta: { box, slides, i, ... }

  // ---------- De la nota a las diapositivas ----------
  const DROP = '.lmd-anchor, .lmd-code-copy, .lmd-jy, .lmd-dgm-tools, .lmd-add, .lmd-draft, .lmd-draft-li, .lmd-board-edit, .lmd-cl-bar, .lmd-cl-add, .lmd-cl-grip, .lmd-front, .lmd-toc, .lmd-cm-layer, .lmd-live-layer, .lmd-voice-ghost, .lmd-handle, .lmd-daily-nav, .lmd-back, script, style';
  const isNote = (n) => n.tagName === 'BLOCKQUOTE' && (n.classList.contains('lmd-alert-note') || /^\s*\[!note\]/i.test(n.textContent));
  // [{ nodes, notes, title }]: los nodos son copias, sin nada de la edición.
  function slidesOf(article) {
    const copy = article.cloneNode(true);
    copy.querySelectorAll(DROP).forEach((n) => n.remove());
    copy.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    copy.querySelectorAll('[data-l], [data-p]').forEach((n) => { n.removeAttribute('data-l'); n.removeAttribute('data-p'); });
    copy.querySelectorAll('.lmd-speaking').forEach((n) => n.classList.remove('lmd-speaking'));
    const out = []; let cur = null;
    const open = () => { cur = { nodes: [], notes: [], title: '' }; out.push(cur); };
    Array.from(copy.children).forEach((n) => {
      if (n.tagName === 'HR') { cur = null; return; }
      if (n.tagName === 'H1' || n.tagName === 'H2') { open(); cur.title = n.textContent.trim(); }
      if (!cur) open();
      n.removeAttribute('id');
      if (isNote(n)) {
        const t = n.querySelector('.lmd-alert-title'); if (t) t.remove();
        cur.notes.push(n.textContent.replace(/^\s*\[!note\]\s*/i, '').trim());
      } else cur.nodes.push(n);
    });
    return out.filter((s) => s.nodes.length).map((s) => { if (!s.title) s.title = (s.nodes[0].textContent || '').trim().slice(0, 60); return s; });
  }
  // Una diapositiva lista para medirse. Con solo un título (y a lo sumo una línea) va centrada.
  function slideEl(s) {
    const box = el('div', { class: 'lmd-pres-slide markdown-body' });
    s.nodes.forEach((n) => box.appendChild(n.cloneNode(true)));
    const heads = s.nodes.filter((n) => /^H[12]$/.test(n.tagName)).length;
    if (heads && s.nodes.length <= 2 && s.nodes.every((n) => /^(H[1-6]|P)$/.test(n.tagName))) box.classList.add('lmd-pres-cover');
    return box;
  }
  // El ancho de trabajo y el alto mínimo para que la diapositiva tenga la forma de la pantalla.
  function frameOf(w, h) { const W = w >= h ? 1120 : 620; return { W, H: Math.round(W * h / w) }; }
  // Achica (o agranda) la diapositiva hasta que entra entera en w x h.
  function fit(node, w, h) {
    const f = frameOf(w, h);
    node.style.width = f.W + 'px'; node.style.minHeight = f.H + 'px'; node.style.setProperty('--lmd-pres-h', f.H + 'px');
    const scale = Math.min(w / f.W, h / Math.max(f.H, node.offsetHeight));
    node.style.transform = 'translate(-50%, -50%) scale(' + scale.toFixed(4) + ')';
    return scale;
  }

  // ---------- La presentación ----------
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  function toggleFull() {
    if (!st) return;
    try {
      if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const go = st.box.requestFullscreen || st.box.webkitRequestFullscreen;
      if (go) { const p = go.call(st.box); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* el navegador no deja: sigue ocupando la ventana */ }
  }
  function layout() {
    if (!st) return;
    const stage = st.box.querySelector('.lmd-pres-stage');
    st.scale = fit(st.cur, stage.clientWidth, stage.clientHeight);
  }
  function paint() {
    const s = st.slides[st.i]; const stage = st.box.querySelector('.lmd-pres-stage');
    stage.textContent = '';
    st.cur = slideEl(s); stage.appendChild(st.cur);
    layout();
    st.box.querySelector('.lmd-pres-count').textContent = (st.i + 1) + ' / ' + st.slides.length;
    st.box.querySelector('.lmd-pres-progress i').style.width = ((st.i + 1) / st.slides.length * 100) + '%';
    st.box.querySelector('[data-pres=prev]').disabled = st.i === 0;
    st.box.querySelector('[data-pres=next]').disabled = st.i === st.slides.length - 1;
    const nb = st.box.querySelector('.lmd-pres-notes');
    nb.textContent = s.notes.join('\n\n'); nb.hidden = !st.notes || !s.notes.length;
    st.box.querySelector('[data-pres=notes]').classList.toggle('lmd-pres-has', s.notes.length > 0);
    st.box.setAttribute('aria-label', T('Presentación') + ': ' + (st.i + 1) + ' / ' + st.slides.length + (s.title ? ', ' + s.title : ''));
  }
  function show(i) {
    if (!st) return;
    const to = Math.max(0, Math.min(st.slides.length - 1, i));
    if (to === st.i && st.cur) return;
    st.i = to; paint();
  }
  function overview(open) {
    if (!st) return;
    const grid = st.box.querySelector('.lmd-pres-grid');
    const want = open == null ? grid.hidden : open;
    grid.hidden = !want; st.box.classList.toggle('lmd-pres-over', want);
    if (!want) { grid.textContent = ''; st.box.focus(); return; }
    const stage = st.box.querySelector('.lmd-pres-stage'); const f = frameOf(stage.clientWidth, stage.clientHeight);
    const tw = LMD.touch.small() ? 150 : 232; const th = Math.round(tw * f.H / f.W);
    grid.textContent = '';
    st.slides.forEach((s, k) => {
      const b = el('button', { type: 'button', class: 'lmd-pres-thumb' + (k === st.i ? ' lmd-on' : ''), 'data-slide': String(k), 'aria-label': (k + 1) + '. ' + s.title });
      const win = el('span', { class: 'lmd-pres-thumb-win' }); win.style.width = tw + 'px'; win.style.height = th + 'px';
      const node = slideEl(s); win.appendChild(node); b.appendChild(win);
      b.appendChild(el('span', { class: 'lmd-pres-thumb-n', text: String(k + 1) }));
      grid.appendChild(b);
      fit(node, tw, th);
    });
    const cur = grid.querySelector('.lmd-on'); if (cur) { cur.focus(); cur.scrollIntoView({ block: 'nearest' }); }
  }
  const overOpen = () => !!st && !st.box.querySelector('.lmd-pres-grid').hidden;
  function laser(want) {
    if (!st) return;
    st.laser = want == null ? !st.laser : want;
    st.box.classList.toggle('lmd-pres-lasing', st.laser);
    st.box.querySelector('[data-pres=laser]').setAttribute('aria-pressed', String(st.laser));
    st.box.querySelector('.lmd-pres-laser').hidden = !st.laser || !st.dotAt;
  }
  function notes(want) {
    if (!st) return;
    st.notes = want == null ? !st.notes : want;
    st.box.querySelector('[data-pres=notes]').setAttribute('aria-pressed', String(st.notes));
    const nb = st.box.querySelector('.lmd-pres-notes'); nb.hidden = !st.notes || !st.slides[st.i].notes.length;
    layout();
  }
  function onKey(e) {
    if (!st) return;
    // Una ventana propia por encima (no debería haber): sus teclas son suyas.
    if (document.querySelector('.lmd-ask, .lmd-dgm')) return;
    e.stopPropagation();
    if (e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const over = overOpen();
    const move = (d) => { if (over) { show(st.i + d); st.box.querySelectorAll('.lmd-pres-thumb').forEach((b, n) => { b.classList.toggle('lmd-on', n === st.i); if (n === st.i) { b.focus(); b.scrollIntoView({ block: 'nearest' }); } }); } else show(st.i + d); };
    if (k === 'Escape') { e.preventDefault(); if (over) overview(false); else close(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey && !over)) { e.preventDefault(); move(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || (k === ' ' && e.shiftKey && !over)) { e.preventDefault(); move(-1); }
    else if (k === 'Home') { e.preventDefault(); move(-st.i); }
    else if (k === 'End') { e.preventDefault(); move(st.slides.length - 1 - st.i); }
    else if (k === 'Enter' && over) { e.preventDefault(); const b = e.target.closest && e.target.closest('.lmd-pres-thumb'); if (b) show(+b.dataset.slide); overview(false); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); }
    else if (k === 'o' || k === 'O') { e.preventDefault(); overview(); }
    else if (k === 'l' || k === 'L') { e.preventDefault(); laser(); }
    else if (k === 'n' || k === 'N') { e.preventDefault(); notes(); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); pdf(); }
    else if (k === 'Tab') { /* el foco recorre los botones de la barra */ }
  }
  function wake() {
    if (!st) return;
    st.box.classList.remove('lmd-pres-idle');
    clearTimeout(st.idle); st.idle = setTimeout(() => { if (st && !overOpen()) st.box.classList.add('lmd-pres-idle'); }, 2600);
  }

  function open(from) {
    if (!on || st || !core || core.noDoc) return false;
    const slides = slidesOf(core.ui.article);
    if (!slides.length) { core.flash(T('No hay nada para presentar.'), 'warn'); return false; }
    const btn = (id, icon, text, key) => '<button type="button" class="lmd-icon-btn" data-pres="' + id + '" title="' + esc(T(text)) + (key ? ' (' + key + ')' : '') + '" aria-label="' + esc(T(text)) + '">' + icon + '</button>';
    const box = el('div', { class: 'lmd-pres', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    box.innerHTML =
      '<div class="lmd-pres-stage"></div>' +
      '<div class="lmd-pres-notes" hidden></div>' +
      '<div class="lmd-pres-laser" hidden></div>' +
      '<div class="lmd-pres-grid" hidden></div>' +
      '<div class="lmd-pres-progress" aria-hidden="true"><i></i></div>' +
      '<div class="lmd-pres-bar" role="toolbar" aria-label="' + esc(T('Presentación')) + '">' +
        btn('prev', ICON.prev, 'Anterior', '←') + '<span class="lmd-pres-count" aria-live="polite"></span>' + btn('next', ICON.next, 'Siguiente', '→') +
        '<span class="lmd-pres-gap"></span>' +
        btn('over', ICON.grid, 'Vista general', 'O') + btn('laser', ICON.laser, 'Puntero láser', 'L') + btn('notes', ICON.notes, 'Notas del orador', 'N') +
        btn('full', ICON.full, 'Pantalla completa', 'F') + btn('pdf', ICON.pdf, 'Diapositivas en PDF', 'P') + btn('close', ICON.close, 'Salir de la presentación', 'Esc') +
      '</div>';
    document.body.appendChild(box);
    st = { box, slides, i: -1, cur: null, scale: 1, laser: false, notes: false, back: document.activeElement, idle: 0, dotAt: false, drag: null };
    document.documentElement.classList.add('lmd-presenting');
    // Arranca en la diapositiva del título que se estaba leyendo.
    let start = 0;
    if (typeof from === 'number') start = from;
    else {
      const heads = Array.from(core.ui.article.querySelectorAll(':scope > h1, :scope > h2, :scope > hr')).filter((h) => h.getBoundingClientRect().top < 40);
      const last = heads.filter((h) => h.tagName !== 'HR').pop();
      if (last) { const t = last.textContent.trim(); const k = slides.findIndex((s) => s.title === t || (t && s.title && t.indexOf(s.title) === 0)); if (k > 0) start = k; }
    }
    box.addEventListener('click', (e) => {
      const thumb = e.target.closest('.lmd-pres-thumb');
      if (thumb) { show(+thumb.dataset.slide); overview(false); return; }
      const b = e.target.closest('[data-pres]'); if (!b) return;
      const a = b.dataset.pres;
      if (a === 'prev') show(st.i - 1); else if (a === 'next') show(st.i + 1); else if (a === 'over') overview(); else if (a === 'laser') laser();
      else if (a === 'notes') notes(); else if (a === 'full') toggleFull(); else if (a === 'pdf') pdf(); else if (a === 'close') close();
    });
    // Las imágenes de la copia terminan de cargar después: la diapositiva se vuelve a medir.
    box.addEventListener('load', (e) => { if (e.target.tagName === 'IMG' && st && st.cur && st.cur.contains(e.target)) layout(); }, true);
    box.addEventListener('pointermove', (e) => {
      wake();
      if (!st.laser || e.pointerType === 'touch') return;
      const dot = box.querySelector('.lmd-pres-laser'); st.dotAt = true; dot.hidden = false;
      dot.style.transform = 'translate(' + e.clientX + 'px, ' + e.clientY + 'px)';
    });
    // Deslizar con el dedo: a la izquierda avanza, a la derecha vuelve.
    box.addEventListener('pointerdown', (e) => { wake(); if (e.target.closest('.lmd-pres-bar, .lmd-pres-grid')) return; st.drag = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    box.addEventListener('pointerup', (e) => {
      const d = st && st.drag; if (!d) return; st.drag = null;
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - d.t < 900) show(st.i + (dx < 0 ? 1 : -1));
    });
    box.addEventListener('pointercancel', () => { if (st) st.drag = null; });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);
    show(start); wake();
    box.focus({ preventScroll: true });
    return true;
  }
  function close() {
    if (!st) return;
    const s = st; st = null;
    clearTimeout(s.idle);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', layout);
    try { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ya salió */ }
    s.box.remove();
    document.documentElement.classList.remove('lmd-presenting');
    if (s.back && s.back.isConnected && s.back.focus) { try { s.back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } }
  }

  // ---------- PDF: una diapositiva por página, apaisada ----------
  const PAGE = { w: 1280, h: 720 };
  function pdf() {
    if (!on || !core || core.noDoc) return false;
    const slides = st ? st.slides : slidesOf(core.ui.article);
    if (!slides.length) { core.flash(T('No hay nada para presentar.'), 'warn'); return false; }
    document.querySelectorAll('.lmd-pres-print, style[data-lmd-pres]').forEach((n) => n.remove());
    const out = el('div', { class: 'lmd-pres-print', 'aria-hidden': 'true' });
    document.body.appendChild(out);
    slides.forEach((s) => {
      const page = el('div', { class: 'lmd-pres-page' }); const node = slideEl(s);
      page.appendChild(node); out.appendChild(page);
      fit(node, PAGE.w, PAGE.h);
    });
    const rule = el('style', { 'data-lmd-pres': '', text: '@page { size: ' + PAGE.w + 'px ' + PAGE.h + 'px; margin: 0; }' });
    document.head.appendChild(rule);
    const root = document.documentElement; root.classList.add('lmd-pres-printing');
    let done = false;
    const clean = () => { if (done) return; done = true; window.removeEventListener('afterprint', clean); root.classList.remove('lmd-pres-printing'); out.remove(); rule.remove(); };
    window.addEventListener('afterprint', clean);
    // Las imágenes de las copias: se espera un momento a que estén antes de mandar a imprimir.
    const imgs = Array.from(out.querySelectorAll('img')).filter((i) => !i.complete);
    Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))), new Promise((r) => setTimeout(r, 1500))]).then(() => {
      out.querySelectorAll('.lmd-pres-slide').forEach((n) => fit(n, PAGE.w, PAGE.h));
      try { window.print(); } catch (e) { clean(); }
      // Donde imprimir no avisa al terminar, la copia se retira sola más tarde.
      setTimeout(clean, 60000);
    });
    return true;
  }

  // ---------- Encendido ----------
  function onShortcut(e) {
    if (!on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyP') return;
    if (st || core.noDoc || document.querySelector('.lmd-ask, .lmd-dgm') || !core.ui.panel.hidden) return;
    e.preventDefault(); open();
  }
  function button() {
    const bar = core.ui.main.querySelector('.lmd-top-right'); if (!bar) return;
    let b = bar.querySelector('.lmd-pres-btn');
    if (!on) { if (b) b.remove(); return; }
    if (b) return;
    b = el('button', { class: 'lmd-icon-btn lmd-doc-only lmd-pres-btn', 'data-act': 'present', title: T('Presentar') + ' (' + KEY + ')', 'aria-label': T('Presentar') }, ICON.present);
    bar.insertBefore(b, bar.querySelector('[data-act=copy]'));
  }
  function enable(c) {
    core = c; on = true; button();
    if (wired) return;
    wired = true;
    window.addEventListener('keydown', onShortcut);
    core.actions.present = () => open();
    core.actions['present-pdf'] = () => pdf();
    // En pantalla chica el botón de la barra no está a la vista: va en el menú "más".
    core.menus.more.push(() => { const b = core.ui.main.querySelector('.lmd-pres-btn'); return on && core.blocks && !(b && b.offsetParent) ? ['present', ICON.present, 'Presentar'] : null; });
    core.menus.export.push(() => (on && core.blocks ? ['present-pdf', ICON.present, 'Diapositivas en PDF'] : null));
    core.hooks.doc.push(() => close());
  }
  function disable() { on = false; close(); if (core) button(); }
  function settings(area, api) {
    area.innerHTML =
      '<p class="lmd-tl-why">' + esc(T('Una diapositiva por cada título de nivel 1 o 2. Un separador (---) también corta. Una cita [!NOTE] es una nota del orador y no se proyecta.')) + '</p>' +
      '<p class="lmd-tl-why">' + esc(T('Teclas: flechas o espacio para avanzar, Inicio y Fin, O vista general, F pantalla completa, L puntero, N notas, P PDF, Escape para salir.')) + '</p>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('Atajo: {a}.', { a: KEY })) + '</span><button type="button" class="lmd-btn" data-pres="go">' + esc(T('Presentar esta nota')) + '</button></div>';
    const go = area.querySelector('[data-pres=go]');
    go.disabled = core.noDoc;
    go.addEventListener('click', () => { api.close(); open(); });
  }

  LMD.present = { enable, disable, settings, open, close, pdf, show, overview, laser, notes, slidesOf, state: () => (st ? { open: true, i: st.i, total: st.slides.length, scale: st.scale, laser: st.laser, notes: st.notes, over: overOpen(), titles: st.slides.map((s) => s.title) } : { open: false }) };
})();
