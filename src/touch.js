// Pantalla chica y táctil: lo que no se resuelve con CSS. Saber si la pantalla es chica o se usa con el dedo,
// seguir al teclado en pantalla (visualViewport), dejar las barras de formato pegadas arriba del teclado,
// y que mantener apretado abra el menú que con mouse sale con clic derecho.
(function () {
  'use strict';

  // Pantalla chica: hasta 720 px de ancho, o un teléfono acostado. Es la misma condición que usa content.css.
  const small = () => window.matchMedia('(max-width: 720px), (max-height: 500px) and (pointer: coarse)').matches;
  const coarse = () => window.matchMedia('(pointer: coarse)').matches;

  // El último toque con el dedo: lo que llega enseguida después (un menú contextual, un clic) vino de ahí.
  let lastTouch = 0;
  const touched = () => Date.now() - lastTouch < 1500;
  document.addEventListener('pointerdown', (e) => { lastTouch = e.pointerType === 'touch' ? Date.now() : 0; }, true);

  // ---------- Teclado en pantalla ----------
  // El teclado achica la zona visible sin achicar la página: lo que tapa queda en --lmd-kb, y la clase
  // lmd-kb dice que está abierto. Con zoom de pellizco la zona visible también se achica, y eso no es el teclado.
  const vv = () => window.visualViewport || null;
  let kb = 0;
  function measure() {
    const v = vv(); const root = document.documentElement;
    const gap = v && v.scale < 1.02 ? Math.round(window.innerHeight - v.height - v.offsetTop) : 0;
    kb = gap > 120 ? gap : 0;
    root.style.setProperty('--lmd-kb', kb + 'px');
    root.classList.toggle('lmd-kb', kb > 0);
  }
  // Hasta dónde se ve la página, en coordenadas de la ventana.
  const visible = () => { const v = vv(); return v ? { top: v.offsetTop, bottom: v.offsetTop + v.height, left: v.offsetLeft, width: v.width } : { top: 0, bottom: window.innerHeight, left: 0, width: window.innerWidth }; };

  // Las barras flotantes (formato, tabla, imagen) van juntas contra el borde de abajo de la zona visible:
  // arriba del teclado cuando está abierto, y arriba del pie cuando no. Ahí no chocan con el menú de selección del sistema.
  const BARS = '.lmd-format, .lmd-tablebar';
  function dock() {
    if (!coarse()) return false;
    const foot = document.querySelector('.lmd-foot'); // con el área segura del teléfono el pie es más alto
    const box = visible(); let y = box.bottom - 8 - (kb || !foot ? 0 : foot.getBoundingClientRect().height + (foot.offsetParent ? 4 : 0));
    document.querySelectorAll(BARS).forEach((bar) => {
      bar.classList.add('lmd-docked');
      if (bar.hidden) return;
      y -= bar.offsetHeight;
      bar.style.top = y + 'px';
      bar.style.left = Math.max(8, box.left + (box.width - bar.offsetWidth) / 2) + 'px';
      y -= 6;
    });
    return true;
  }
  const docked = () => (coarse() ? Array.from(document.querySelectorAll(BARS)).reduce((sum, bar) => sum + (bar.hidden ? 0 : bar.offsetHeight + 6), 0) : 0);

  // El renglón que se escribe queda a la vista: ni detrás del teclado ni detrás de las barras de arriba y de abajo.
  function caretIntoView() {
    const a = document.activeElement;
    if (!a || !a.isContentEditable || !a.closest('.lmd-article')) return;
    const sel = getSelection(); if (!sel.rangeCount || !a.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    let r = range.getClientRects()[0] || range.getBoundingClientRect();
    if (!r || (!r.height && !r.top)) r = a.getBoundingClientRect(); // un bloque vacío no tiene renglón que medir
    const box = visible(); const top = box.top + 58; const bottom = box.bottom - docked() - 14;
    if (r.bottom > bottom) window.scrollBy(0, Math.min(r.bottom - bottom, r.top - top));
    else if (r.top < top) window.scrollBy(0, r.top - top);
  }

  // ---------- Menús ----------
  // Un menú nunca queda detrás del teclado: se mide contra la zona visible, no contra la ventana. En teléfono, los
  // menús de insertar, del bloque y los contextuales son una hoja pegada abajo de la zona visible (arriba del teclado
  // si está abierto), de la mitad del alto como mucho y con scroll adentro: lo que se edita queda a la vista arriba.
  // Los que salen de un botón de la barra (más, copiar, exportar) quedan donde están, recortados a lo que se ve.
  const SHEET = '.lmd-menu-ins, .lmd-menu-read, .lmd-menu-board';
  const sheets = () => small() && coarse();
  const sheetRoom = () => { const box = visible(); return Math.max(200, Math.round((box.bottom - box.top) * 0.5)); };
  function fitMenu(m) {
    if (!m || !m.isConnected || m.parentNode !== document.body || !small()) return;
    const box = visible(); const room = Math.max(160, box.bottom - box.top - 16);
    if (sheets() && m.matches(SHEET)) {
      m.classList.add('lmd-sheet');
      m.style.maxHeight = Math.min(room, sheetRoom()) + 'px';
      m.style.top = Math.round(box.bottom - m.offsetHeight - 8) + 'px';
      return;
    }
    m.style.maxHeight = room + 'px';
    const r = m.getBoundingClientRect();
    if (r.bottom > box.bottom - 8 || r.top < box.top + 8) m.style.top = Math.round(Math.max(box.top + 8, Math.min(r.top, box.bottom - 8 - r.height))) + 'px';
  }
  const fitMenus = () => document.querySelectorAll('body > .lmd-menu').forEach(fitMenu);
  // Antes de abrir una hoja: el bloque sobre el que se abre sube hasta quedar a la vista arriba de ella. El scroll que
  // hace eso no es de la persona: quien cierra sus menús al deslizar la página lo pregunta con nudged().
  let nudge = 0;
  const nudged = () => Date.now() - nudge < 400;
  function reveal(node) {
    if (!node || !node.getBoundingClientRect || !sheets()) return;
    const box = visible(); const top = box.bottom - 8 - Math.min(Math.max(160, box.bottom - box.top - 16), sheetRoom()) - 10;
    const r = node.getBoundingClientRect(); const over = Math.min(r.bottom - top, r.top - (box.top + 62));
    if (over > 0) { nudge = Date.now(); window.scrollBy({ top: over, behavior: 'instant' }); }
  }

  // ---------- Filas que se deslizan de costado ----------
  // Las pestañas de Ajustes y las piezas de los editores van en una fila que se desliza. Para que se note que sigue,
  // se desvanece del lado donde queda algo por ver (lmd-more-l, lmd-more-r).
  const ROWS = '.lmd-ptabs, .lmd-dgm-add > div, .lmd-fx-tabs, .lmd-fx .lmd-fx-keys';
  function edge(n) {
    const more = n.scrollWidth - n.clientWidth;
    n.classList.toggle('lmd-more-r', more > 4 && n.scrollLeft < more - 4);
    n.classList.toggle('lmd-more-l', more > 4 && n.scrollLeft > 4);
  }
  let edging = 0;
  const edges = () => { clearTimeout(edging); edging = setTimeout(() => document.querySelectorAll(ROWS).forEach(edge), 60); };
  function watchRows() {
    document.addEventListener('scroll', (e) => { const n = e.target; if (n && n.nodeType === 1 && n.matches(ROWS)) edge(n); }, { capture: true, passive: true });
    window.addEventListener('resize', edges);
    // Al elegir una pestaña queda entera a la vista, y la fila vuelve a medirse (cambió lo que hay abierto).
    document.addEventListener('click', (e) => {
      const tab = e.target.closest && e.target.closest('.lmd-ptabs button');
      if (tab && small()) tab.scrollIntoView({ block: 'nearest', inline: 'center' });
      edges();
    }, true);
    new MutationObserver(edges).observe(document.body, { childList: true });
    const panel = document.querySelector('body > .lmd-panel'); if (panel) new MutationObserver(edges).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    edges();
  }

  // ---------- Mantener apretado ----------
  // Medio segundo con el dedo quieto sobre node equivale al clic derecho: sale el mismo evento, en el mismo punto.
  // Si el navegador manda el suyo (Chrome en Android lo hace), queda uno solo. when() dice si corresponde.
  function longPress(node, when) {
    let timer = null; let x = 0; let y = 0; let fired = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    node.addEventListener('touchstart', (e) => {
      cancel(); fired = 0;
      if (e.touches.length !== 1 || (when && !when(e))) return;
      const target = e.target; x = e.touches[0].clientX; y = e.touches[0].clientY;
      timer = setTimeout(() => {
        timer = null; fired = Date.now();
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      }, 500);
    }, { passive: true });
    node.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (timer && t && (Math.abs(t.clientX - x) > 10 || Math.abs(t.clientY - y) > 10)) cancel(); }, { passive: true });
    // Al levantar el dedo no sale un clic sobre lo que quedó debajo: el menú recién abierto.
    node.addEventListener('touchend', (e) => { cancel(); if (fired && e.cancelable) e.preventDefault(); });
    node.addEventListener('touchcancel', cancel);
    node.addEventListener('contextmenu', (e) => {
      if (!e.isTrusted) return;
      if (Date.now() - fired < 1500) { e.preventDefault(); e.stopImmediatePropagation(); } else cancel();
    }, true);
  }

  // ---------- Atrás del sistema ----------
  // En pantalla chica, atrás cierra lo que está abierto encima de la nota (la barra lateral, Ajustes, un diálogo,
  // una imagen ampliada) en vez de irse de la nota. Al abrirse algo se suma al historial una entrada con la misma
  // dirección; atrás la consume y acá se cierra lo de arriba, con el mismo Escape que usa el teclado. Si lo abierto
  // se cerró de otra forma, la entrada queda: la próxima nota que se abre la reemplaza (backMark) y, si antes llega
  // un atrás, se lo deja seguir de largo. Nunca se retrocede el historial por cuenta propia mientras hay algo abierto.
  const LAYERS = ':scope > .lmd-ask, :scope > .lmd-dgm, :scope > .lmd-viewer:not([hidden]), :scope > .lmd-panel:not([hidden]), :scope > .lmd-menu.lmd-sheet:not(.lmd-menu-auto)';
  const layers = () => Array.from(document.body.querySelectorAll(LAYERS));
  const drawer = () => document.documentElement.classList.contains('lmd-side-open');
  const marked = () => { try { return !!(history.state && history.state.lmdLayer); } catch (e) { return false; } };
  let armed = false; // hay una entrada de más en el historial, arriba de todo
  function track() {
    if (!small() || marked() || !(layers().length || drawer())) return;
    try { history.pushState({ lmdLayer: 1 }, ''); armed = true; } catch (e) { /* sin historial, atrás hace lo de siempre */ }
  }
  function closeTop() {
    const all = layers();
    // Lo que se arma al abrirse (un diálogo) está encima de lo que ya estaba en la página (Ajustes, la imagen).
    // Y una hoja de menú está encima de todo.
    const top = all.filter((n) => n.matches('.lmd-sheet')).pop() || all.filter((n) => n.matches('.lmd-ask, .lmd-dgm')).pop() || all.pop();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    if (top) (top.contains(document.activeElement) ? document.activeElement : top).dispatchEvent(esc); else window.dispatchEvent(esc);
  }
  function watchBack() {
    const mo = new MutationObserver(track);
    mo.observe(document.body, { childList: true });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.body.querySelectorAll(':scope > .lmd-panel, :scope > .lmd-viewer').forEach((n) => mo.observe(n, { attributes: true, attributeFilter: ['hidden'] }));
    window.addEventListener('popstate', (e) => {
      // Adelante hasta la entrada de más: queda anotada, y no hay nada que abrir.
      if (e.state && e.state.lmdLayer) { armed = true; e.stopImmediatePropagation(); return; }
      if (!armed) return;
      armed = false;
      e.stopImmediatePropagation(); // la dirección no cambió: el lector no tiene nada que traer
      if (layers().length || drawer()) { closeTop(); setTimeout(track, 0); }
      else history.back(); // lo abierto ya se había cerrado: este atrás era para irse de la nota
    }, true);
  }
  // Se va a abrir otra nota. Si arriba del historial está la entrada de más, la nota la reemplaza en vez de sumarse.
  const backMark = () => { if (!marked()) return false; armed = false; return true; };

  // Dónde corre, para lo que el CSS resuelve distinto en Safari: lmd-ios, lmd-mac y lmd-standalone (la app instalada).
  const standalone = () => navigator.standalone === true || ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => window.matchMedia && window.matchMedia('(display-mode: ' + m + ')').matches);
  function mark() {
    const root = document.documentElement; const d = LMD.device || {};
    root.classList.toggle('lmd-ios', !!d.ios); root.classList.toggle('lmd-mac', !!d.mac); root.classList.toggle('lmd-standalone', standalone());
  }
  mark();

  function init() {
    const v = vv();
    mark();
    measure();
    watchBack();
    watchRows();
    // Cada menú que se abre se acomoda a la zona visible; una hoja cuenta para el atrás del sistema.
    new MutationObserver((list) => {
      list.forEach((rec) => rec.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains('lmd-menu')) { fitMenu(n); if (n.matches('.lmd-sheet:not(.lmd-menu-auto)')) track(); } }));
    }).observe(document.body, { childList: true });
    if (!v) return;
    const follow = () => { measure(); dock(); fitMenus(); if (kb) caretIntoView(); };
    v.addEventListener('resize', follow);
    v.addEventListener('scroll', () => { measure(); dock(); fitMenus(); });
    // Mientras se escribe con el teclado abierto, el renglón sigue a la vista.
    document.addEventListener('input', () => { if (kb) caretIntoView(); });
  }

  // Lo que ocupan arriba del teclado las barras flotantes y el pie: ahí arriba va el botón del dictado (dictate.js).
  const above = () => { const foot = document.querySelector('.lmd-foot'); return docked() + (kb || !foot ? 0 : foot.getBoundingClientRect().height + (foot.offsetParent ? 4 : 0)); };

  LMD.touch = { small, coarse, touched, dock, longPress, init, caretIntoView, visible, backMark, above, standalone, fitMenu, reveal, nudged };
})();
