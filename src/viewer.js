// El visor: un PDF, un libro (EPUB), una imagen, un audio o un video se ven acá, en el lugar de la nota, sin diálogo
// aparte y sin poder editarlos. Qué archivo va a cuál lo dice la lista de tipos (FILE_TYPES, kit.js). Se pide recién al abrir el primero (ver LAZY_APP en content.js), junto con import.js, del que
// toma el cargador de pdf.js, el lector de zip con sus topes y el de XML.
//  - PDF: pdf.js (vendor/pdfjs) dibuja cada página en un lienzo. Solo existen los lienzos de las páginas a la vista
//    y de las vecinas; las demás son un hueco de su tamaño. Encima va la capa de texto (seleccionar, copiar, buscar,
//    lectores de pantalla) y, sobre ella, los enlaces. Los marcadores del PDF van al panel Índice.
//  - EPUB: un capítulo por vez, en orden de lectura, con la tipografía y los colores del tema. El libro es contenido
//    que no se controla: su HTML pasa por DOMPurify con las mismas reglas que una nota y unas cuantas más (sin
//    estilos, sin clases, sin nada que se cargue de afuera), y recién después entra a la página. Sus imágenes salen
//    del zip como blob:. La tabla de contenidos (nav o NCX) va al panel Índice.
//  - Imágenes: en un <img> con una dirección blob:, nunca dentro de la página. Un SVG es código: así no corre nada
//    de lo que traiga, y su fuente se puede leer como texto. Se acerca, se aleja y se arrastra; con las flechas se
//    pasa a la imagen anterior o siguiente de la misma carpeta.
//  - Audio y video: el reproductor del navegador, que lee del disco a medida que avanza.
// La posición (página y zoom, o capítulo y avance) la guarda content.js con la posición de lectura de cada archivo.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc, ICON, debounce } = LMD.kit;
  let core = null; let cur = null; let styled = false;

  const SVG = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const I = {
    up: SVG('<path d="m6 15 6-6 6 6"/>'), down: SVG('<path d="m6 9 6 6 6-6"/>'), left: SVG('<path d="m15 6-6 6 6 6"/>'), right: SVG('<path d="m9 6 6 6-6 6"/>'),
    minus: SVG('<path d="M5 12h14"/>'), plus: SVG('<path d="M12 5v14M5 12h14"/>'),
    fit: SVG('<path d="M4 5v14M20 5v14M8 12h8M10.5 9.5 8 12l2.5 2.500M13.500 9.500 16 12l-2.500 2.500"/>'),
    speak: SVG('<path d="M4 9.500v5h3.500l4.500 3.500V6L7.500 9.500z"/><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11"/>'),
  };

  // Los estilos van con el visor: la app no los carga hasta que hace falta.
  const CSS_TEXT = [
    '.lmd-vw-bar{position:sticky;top:49px;z-index:9;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;min-height:44px;padding:6px 16px;border-bottom:1px solid var(--line);background:var(--bg);color:var(--fg-muted);font:13px/1.2 var(--lmd-font)}',
    '.lmd-vw-grp{display:flex;align-items:center;gap:4px;min-width:0}',
    '.lmd-vw-btn{display:grid;place-items:center;flex:none;min-width:32px;height:32px;padding:0 6px;border:0;border-radius:7px;background:transparent;color:var(--fg-muted);font:600 12px/1 var(--lmd-font);cursor:pointer}',
    '.lmd-vw-btn:hover{background:var(--bg-soft);color:var(--fg)}',
    '.lmd-vw-btn[disabled]{opacity:.35;cursor:default;background:transparent}',
    '.lmd-vw-btn[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}',
    '.lmd-vw-pos{display:flex;align-items:center;gap:6px;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.lmd-vw-num{width:46px;height:28px;padding:0 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit;text-align:center}',
    '.lmd-vw-zoom{min-width:44px;text-align:center;font-variant-numeric:tabular-nums}',
    '.lmd-vw-find{flex:1 1 220px;justify-content:flex-end}',
    '.lmd-vw-q{flex:0 1 220px;min-width:90px;height:28px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}',
    '.lmd-vw-count{min-width:44px;text-align:center;font-variant-numeric:tabular-nums}',
    '.lmd-vw-findtog{display:none}',
    '@media (max-width:720px){.lmd-vw-bar{gap:4px 8px;padding:4px 8px}.lmd-vw-zoom{display:none}.lmd-vw-findtog{display:grid;margin-left:auto}.lmd-vw-find{flex:1 1 100%}.lmd-vw-find-shut .lmd-vw-find{display:none}.lmd-vw-q{flex:1 1 auto}.lmd-vw-num{width:40px}}',
    '.lmd-vw-note{margin:40px auto;max-width:520px;color:var(--fg-muted);text-align:center}',
    '.lmd-vw-err{color:var(--fg)}',
    // PDF
    '.lmd-root .lmd-article.lmd-vw-pdf{max-width:none;margin:0;padding:16px 16px 120px}',
    '.lmd-vw-pages{overflow-x:auto;touch-action:pan-x pan-y;transform-origin:0 0}',
    '.lmd-vw-page{position:relative;margin:0 auto 12px;background:#fff;box-shadow:0 0 0 1px var(--line),0 2px 10px rgba(0,0,0,.12);overflow:hidden;line-height:1;font-size:1px}',
    '.lmd-vw-page canvas{position:absolute;inset:0;display:block;width:100%;height:100%}',
    '.lmd-vw-page .lmd-vw-pn{position:absolute;inset:0;display:grid;place-items:center;color:#8a8f98;font:13px/1 var(--lmd-font)}',
    '.lmd-vw-text{position:absolute;inset:0;overflow:clip;opacity:1;line-height:1;text-align:initial;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:1;margin:0;padding:0}',
    '.lmd-vw-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;margin:0;padding:0;border:0;background:none}',
    '.lmd-vw-text span.markedContent{top:0;height:0}',
    '.lmd-vw-text ::selection{background:rgba(0,90,255,.28);color:transparent}',
    '.lmd-vw-text br::selection{background:transparent}',
    '.lmd-vw-text .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none}',
    '.lmd-vw-text ::highlight(lmd-hit){background-color:rgba(255,196,0,.45);color:transparent}',
    '.lmd-vw-text ::highlight(lmd-hit-current){background-color:rgba(255,110,0,.6);color:transparent}',
    '.lmd-vw-links{position:absolute;inset:0;z-index:2;pointer-events:none}',
    '.lmd-root .lmd-vw-links a{position:absolute;display:block;pointer-events:auto;border-radius:2px;text-decoration:none;background:none}',
    '.lmd-root .lmd-vw-links a:hover,.lmd-root .lmd-vw-links a:focus-visible{background:rgba(0,90,255,.14)}',
    // EPUB
    '.lmd-vw-epub img,.lmd-vw-epub svg{max-width:100%;height:auto}',
    '.lmd-vw-epub [data-bk].lmd-vw-there{background:var(--accent-soft);box-shadow:0 0 0 4px var(--accent-soft);border-radius:3px;transition:background-color .2s}',
    '.lmd-vw-turn{display:flex;justify-content:space-between;gap:12px;margin-top:48px;padding-top:18px;border-top:1px solid var(--line)}',
    '.lmd-vw-turn button{display:flex;align-items:center;gap:6px;max-width:48%;min-height:40px;padding:6px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font:14px/1.3 var(--lmd-font);text-align:left;cursor:pointer}',
    '.lmd-vw-turn button:hover{background:var(--bg-soft)}',
    '.lmd-vw-turn button span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.lmd-vw-turn [data-vw=next]{margin-left:auto;text-align:right}',
    '.lmd-vw-toc-none{padding:8px 14px;color:var(--fg-faint);font-size:12.5px}',
    // Imágenes, audio y video
    '.lmd-root .lmd-article.lmd-vw-image{max-width:none;margin:0;padding:12px 16px 56px}',
    '.lmd-vw-stage{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:8px;cursor:grab;touch-action:none;background-color:#fff;background-image:conic-gradient(#d4d4d4 25%,transparent 0 50%,#d4d4d4 0 75%,transparent 0);background-size:16px 16px}',
    '.lmd-vw-stage.lmd-vw-grab{cursor:grabbing}',
    '.lmd-root .lmd-vw-stage img{position:absolute;left:0;top:0;max-width:none;max-height:none;margin:0;border-radius:0;user-select:none;-webkit-user-drag:none}',
    '.lmd-vw-info{margin:8px 0 0;color:var(--fg-muted);font:12.5px/1.4 var(--lmd-font);text-align:center;font-variant-numeric:tabular-nums}',
    '.lmd-vw-src{margin:0;padding:14px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:8px;background:var(--bg-code);color:var(--fg);font:12.5px/1.5 var(--lmd-mono)}',
    '.lmd-vw-media{display:block;width:100%;max-width:960px;max-height:70vh;margin:24px auto 0}',
    'audio.lmd-vw-media{max-width:560px}',
    '@media print{.lmd-vw-bar,.lmd-vw-turn{display:none}}',
  ].join('\n');
  function style() { if (styled) return; styled = true; document.head.appendChild(el('style', { id: 'lmd-vw-css', text: CSS_TEXT })); }

  const fail = (code) => Object.assign(new Error(code), { code });
  function whyOf(e) {
    const c = e && e.code;
    if (c === 'pdf_locked') return T('Este PDF tiene contraseña y no se abrió.');
    if (c === 'pdf_lib') return T('No se pudo cargar el lector de PDF. Probá de nuevo.');
    if (c === 'drm') return T('Este EPUB está protegido (DRM) y no se puede abrir.');
    if (c === 'zip_big') return T('El archivo es demasiado grande al descomprimirlo.');
    if (c === 'no_inflate') return T('Este navegador no puede abrir ese archivo.');
    if (c === 'pdf_bad') return T('Este PDF está dañado y no se puede mostrar.');
    if (c === 'img_bad') return T('Esta imagen está dañada o el navegador no la puede mostrar.');
    return T('Este archivo está dañado y no se puede mostrar.');
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const hl = () => (window.CSS && CSS.highlights ? CSS.highlights : null);
  // Cuántas coincidencias hay y en cuál se está: en la barra del visor y en el buscador de la barra lateral.
  function tell(v) {
    const text = !v.q ? '' : v.hits.length ? (v.at >= 0 ? (v.at + 1) + ' / ' + v.hits.length : String(v.hits.length)) : (v.finding ? '…' : '0');
    if (v.count) v.count(text, v.hits.length);
    const c = v.bar && v.bar.querySelector('.lmd-vw-count'); if (c) c.textContent = text;
  }
  // La línea de lectura: justo debajo de las dos barras fijas.
  const lineY = (v) => (v.bar && v.bar.isConnected ? v.bar.getBoundingClientRect().bottom : 49) + 8;
  const modal = () => !!document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres, .lmd-menu, .lmd-imp') || !core.ui.panel.hidden || !core.ui.viewer.hidden;

  // ---------- La barra ----------
  function buildBar(v) {
    const pdf = v.kind === 'pdf'; const img = v.kind === 'image';
    const btn = (act, icon, label, key, cls) => '<button type="button" class="lmd-vw-btn' + (cls ? ' ' + cls : '') + '" data-vw="' + act + '" title="' + esc(T(label)) + (key ? ' (' + key + ')' : '') + '" aria-label="' + esc(T(label)) + '">' + icon + '</button>';
    const speak = !pdf && LMD.tools && LMD.tools.isOn('speak') && LMD.speak && window.speechSynthesis;
    const bar = el('div', { class: 'lmd-vw-bar' + (LMD.touch.small() ? ' lmd-vw-find-shut' : ''), role: 'toolbar', 'aria-label': T(pdf ? 'Barra del PDF' : img ? 'Barra de la imagen' : 'Barra del libro') });
    if (img) bar.innerHTML =
      '<div class="lmd-vw-grp">' + btn('prev', I.left, 'Imagen anterior', '←') + btn('next', I.right, 'Imagen siguiente', '→') + '<span class="lmd-vw-pos lmd-vw-where" aria-live="polite"></span></div>' +
      '<div class="lmd-vw-grp">' + btn('out', I.minus, 'Alejar', '-') + '<span class="lmd-vw-zoom" aria-live="polite"></span>' + btn('in', I.plus, 'Acercar', '+') +
        btn('fit', I.fit, 'Ajustar a la ventana', '0') + btn('real', '1:1', 'Tamaño real', '1') + '</div>' +
      '<div class="lmd-vw-grp">' + (v.svg ? btn('src', ICON.code, 'Ver el código del SVG') : '') + btn('copy-img', ICON.copy, 'Copiar la imagen') + btn('copy-md', ICON.md, 'Copiar como Markdown') + '</div>';
    else bar.innerHTML =
      '<div class="lmd-vw-grp">' +
        btn('prev', pdf ? I.up : I.left, pdf ? 'Página anterior' : 'Capítulo anterior', pdf ? 'PgUp' : '←') +
        btn('next', pdf ? I.down : I.right, pdf ? 'Página siguiente' : 'Capítulo siguiente', pdf ? 'PgDn' : '→') +
        (pdf ? '<span class="lmd-vw-pos"><input class="lmd-vw-num" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="' + esc(T('Página')) + '"><span class="lmd-vw-total"></span></span>'
          : '<span class="lmd-vw-pos lmd-vw-where" aria-live="polite"></span>') +
      '</div>' +
      (pdf ? '<div class="lmd-vw-grp">' + btn('out', I.minus, 'Alejar', '-') + '<span class="lmd-vw-zoom" aria-live="polite"></span>' + btn('in', I.plus, 'Acercar', '+') +
        btn('fit', I.fit, 'Ajustar al ancho', '0') + btn('real', '1:1', 'Tamaño real', '1') + '</div>' : '') +
      (speak ? '<div class="lmd-vw-grp">' + btn('speak', I.speak, 'Leer en voz alta') + '</div>' : '') +
      btn('find', ICON.search, 'Buscar', LMD.keys ? LMD.keys('Ctrl+F') : 'Ctrl+F', 'lmd-vw-findtog') +
      '<div class="lmd-vw-grp lmd-vw-find" role="search">' +
        '<input class="lmd-vw-q" type="search" spellcheck="false" autocomplete="off" placeholder="' + esc(T(pdf ? 'Buscar en el PDF' : 'Buscar en el libro')) + '" aria-label="' + esc(T(pdf ? 'Buscar en el PDF' : 'Buscar en el libro')) + '">' +
        '<span class="lmd-vw-count" aria-live="polite"></span>' +
        btn('find-prev', I.up, 'Resultado anterior', 'Shift+Enter') + btn('find-next', I.down, 'Resultado siguiente', 'Enter') +
      '</div>';
    // Un archivo abierto desde el disco por su ruta: la salida al visor del navegador, a un toque.
    if (v.native) (bar.querySelector('.lmd-vw-findtog') || bar).insertAdjacentHTML(bar.querySelector('.lmd-vw-findtog') ? 'beforebegin' : 'beforeend', '<div class="lmd-vw-grp">' + btn('native', ICON.browser, 'Abrir con el visor del navegador') + '</div>');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vw]'); if (!b || b.disabled || cur !== v) return;
      act(v, b.dataset.vw);
    });
    const q = bar.querySelector('.lmd-vw-q');
    if (q) q.addEventListener('input', debounce(() => { if (cur === v) search(q.value, true, true); }, 220));
    if (q) q.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); if (q.value.trim() !== v.q) search(q.value, true, true); else step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); q.value = ''; search('', false, true); q.blur(); }
    });
    const num = bar.querySelector('.lmd-vw-num');
    if (num) {
      const go = () => { const n = parseInt(num.value, 10); if (n >= 1 && n <= v.n) pdfGo(v, n - 1, 0); else num.value = String(v.page + 1); };
      num.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); num.blur(); } else if (e.key === 'Escape') { num.value = String(v.page + 1); num.blur(); } });
      num.addEventListener('change', go);
      num.addEventListener('focus', () => num.select());
    }
    // Debajo de la barra de arriba, que no mide lo mismo en todos los dispositivos.
    const top = core.ui.main.querySelector('.lmd-topbar');
    const place = () => { if (top) bar.style.top = Math.round(top.getBoundingClientRect().height) + 'px'; };
    place(); window.addEventListener('resize', place); v.off.push(() => window.removeEventListener('resize', place));
    v.host.parentNode.insertBefore(bar, v.host);
    v.bar = bar;
  }
  function act(v, what) {
    if (what === 'find') { const shut = v.bar.classList.toggle('lmd-vw-find-shut'); if (!shut) v.bar.querySelector('.lmd-vw-q').focus(); return; }
    if (what === 'find-prev') return step(-1);
    if (what === 'find-next') return step(1);
    if (what === 'speak') { if (core.actions.speak) core.actions.speak(); return; }
    if (what === 'native') { if (v.native) v.native(); return; }
    if (v.kind === 'image') return imgAct(v, what);
    if (v.kind === 'pdf') {
      if (what === 'prev') pdfGo(v, v.page - 1, 0);
      else if (what === 'next') pdfGo(v, v.page + 1, 0);
      else if (what === 'in') pdfZoom(v, v.scale * 1.2);
      else if (what === 'out') pdfZoom(v, v.scale / 1.2);
      else if (what === 'fit') pdfZoom(v, 'fit');
      else if (what === 'real') pdfZoom(v, UNIT);
    } else if (what === 'prev') bookGo(v, v.c - 1, { end: false });
    else if (what === 'next') bookGo(v, v.c + 1, {});
  }
  function focusFind() {
    const v = cur; if (!v || !v.bar) return false;
    const q = v.bar.querySelector('.lmd-vw-q');
    if (!q || document.activeElement === q) return false; // la segunda vez pasa el buscador del navegador
    v.bar.classList.remove('lmd-vw-find-shut'); q.focus(); q.select();
    return true;
  }
  function onKey(e) {
    const v = cur; if (!v || !v.ready || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (modal()) return;
    const k = e.key; let did = true;
    if (v.kind === 'image') {
      if (k === 'ArrowLeft') imgAct(v, 'prev'); else if (k === 'ArrowRight') imgAct(v, 'next');
      else if (k === '+' || k === '=') imgAct(v, 'in'); else if (k === '-') imgAct(v, 'out');
      else if (k === '0') imgAct(v, 'fit'); else if (k === '1') imgAct(v, 'real');
      else did = false;
    } else if (v.kind !== 'pdf' && v.kind !== 'epub') did = false;
    else if (v.kind === 'pdf') {
      if (k === 'ArrowLeft' || k === 'PageUp') pdfGo(v, v.page - 1, 0);
      else if (k === 'ArrowRight' || k === 'PageDown') pdfGo(v, v.page + 1, 0);
      else if (k === '+' || k === '=') pdfZoom(v, v.scale * 1.2);
      else if (k === '-') pdfZoom(v, v.scale / 1.2);
      else if (k === '0') pdfZoom(v, 'fit');
      else if (k === '1') pdfZoom(v, UNIT);
      else did = false;
    } else {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (k === 'ArrowLeft') bookGo(v, v.c - 1, {});
      else if (k === 'ArrowRight') bookGo(v, v.c + 1, {});
      // Al final del capítulo, seguir bajando pasa al siguiente; arriba de todo, subir vuelve al final del anterior.
      else if ((k === 'PageDown' || (k === ' ' && !e.shiftKey)) && window.scrollY >= max - 2 && v.c < v.spine.length - 1) bookGo(v, v.c + 1, {});
      else if ((k === 'PageUp' || (k === ' ' && e.shiftKey)) && window.scrollY <= 2 && v.c > 0) bookGo(v, v.c - 1, { end: true });
      else did = false;
    }
    if (did) e.preventDefault();
  }

  // ---------- El panel Índice ----------
  // La misma cabecera que una nota: título, un dato y el avance de lectura.
  function outlineHead(v, title, meta, plain) {
    const box = v.outline; box.textContent = '';
    const head = el('div', { class: 'lmd-o-head' });
    const a = el('a', { class: 'lmd-o-title', href: '#', 'data-vw-top': '1', text: title });
    const bar = el('div', { class: 'lmd-o-bar', title: T('Avance de lectura') }, '<span></span>');
    const pct = el('span', { class: 'lmd-o-pct', text: '0 %' });
    const row = el('div', { class: 'lmd-o-progress' }); row.append(bar, pct);
    head.append(a, el('div', { class: 'lmd-o-meta', text: meta }));
    if (!plain) head.appendChild(row); // el avance de lectura es de lo que se lee de corrido
    box.appendChild(head);
    v.pbar = bar.firstChild; v.ppct = pct;
  }
  // items: [{ label, level, kids }] ya en orden; cada renglón lleva data-vw-i con su lugar en v.rows.
  function outlineTree(v, items) {
    v.rows = [];
    if (!items.length) return;
    const tree = el('div', { class: 'lmd-o-tree' });
    const walk = (list, into, depth) => list.forEach((it) => {
      const item = el('div', { class: 'lmd-o-item' });
      const line = el('div', { class: 'lmd-o-row lmd-o-l' + Math.min(depth, 4) });
      const kids = it.kids && it.kids.length ? it.kids : null;
      if (kids) {
        const tog = el('button', { class: 'lmd-o-tog', type: 'button', 'aria-label': T('Plegar o desplegar') }, ICON.chevron);
        tog.addEventListener('click', (e) => { e.stopPropagation(); item.classList.toggle('lmd-o-shut'); });
        line.appendChild(tog);
      } else line.appendChild(el('span', { class: 'lmd-o-dot' }));
      const link = el('a', { href: '#', class: 'lmd-o-link', 'data-vw-i': String(v.rows.length), text: it.label, title: it.label });
      line.appendChild(link); item.appendChild(line);
      v.rows.push({ it, line });
      if (kids) { const sub = el('div', { class: 'lmd-o-kids' }); item.appendChild(sub); walk(kids, sub, depth + 1); }
      into.appendChild(item);
    });
    walk(items, tree, 1);
    v.outline.appendChild(tree);
  }
  function markRow(v, i) {
    if (v.rowOn === i || !v.rows) return; v.rowOn = i;
    v.rows.forEach((r, k) => {
      const on = k === i;
      r.line.classList.toggle('lmd-active', on);
      if (on && r.line.offsetParent) r.line.scrollIntoView({ block: 'nearest' });
    });
  }
  function progress(v, part) {
    const pct = Math.round(clamp(part, 0, 1) * 100);
    if (v.pbar) { v.pbar.style.width = pct + '%'; v.ppct.textContent = pct + ' %'; }
    return pct;
  }

  // ====================================================================================================
  // PDF
  // ====================================================================================================
  const UNIT = 96 / 72; // un punto del PDF, en píxeles de CSS: el "tamaño real"
  const GAP = 12; const MIN = 0.25 * UNIT; const MAX = 5 * UNIT;
  const AROUND = 1; // páginas vecinas que se dibujan además de las que están a la vista

  function askPass(v, wrong) {
    return LMD.dialog.prompt({ title: T('PDF con contraseña'), text: wrong ? T('Esa contraseña no coincide.') : T('"{a}" pide una contraseña para abrirse.', { a: v.name }), label: T('Contraseña'), password: true, ok: T('Abrir'), empty: T('Escribí la contraseña.') });
  }

  async function openPdf(v) {
    const K = LMD.import.kit;
    const job = K.newJob((p) => { if (p.stage === 'load' && cur === v && v.note) v.note.textContent = T('Cargando el lector de PDF…') + ' ' + Math.round(100 * p.done / (p.total || 1)) + ' %'; });
    v.note.textContent = T('Cargando el lector de PDF…');
    let lib = null;
    try { lib = await K.pdfjs(job, 0); } catch (e) { throw fail('pdf_lib'); }
    if (!v.live()) return;
    v.lib = lib; v.note.textContent = T('Abriendo…');
    const data = new Uint8Array(await v.file.arrayBuffer());
    let head = ''; for (let i = 0; i < Math.min(data.length, 1024); i++) head += String.fromCharCode(data[i]);
    if (head.indexOf('%PDF-') < 0) throw fail('pdf_bad');
    const task = lib.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, enableXfa: false, verbosity: 0 });
    v.off.push(() => { try { task.destroy(); } catch (e) { /* ya cerrado */ } });
    task.onPassword = (update, reason) => {
      askPass(v, reason === 2).then((pw) => {
        if (pw == null || !v.live()) { v.locked = true; try { task.destroy(); } catch (e) { /* ya cerrado */ } } else update(pw);
      });
    };
    let pdf = null;
    try { pdf = await task.promise; } catch (e) { if (!v.live()) return; throw fail(v.locked || (e && e.name === 'PasswordException') ? 'pdf_locked' : 'pdf_bad'); }
    if (!v.live()) return;
    v.pdf = pdf; v.n = pdf.numPages; v.page = 0;
    let first = null;
    try { first = await pdf.getPage(1); } catch (e) { throw fail('pdf_bad'); }
    if (!v.live()) return;
    const size = (page) => { const p = page.getViewport({ scale: 1 }); return { w: p.width, h: p.height }; };
    const one = size(first);
    v.sizes = Array.from({ length: v.n }, () => one);
    v.slots = []; v.texts = []; v.want = new Set();
    v.zoom = v.pos && (v.pos.z === 'fit' || (typeof v.pos.z === 'number' && v.pos.z > 0)) ? v.pos.z : 'fit';

    v.host.textContent = ''; v.note = null;
    buildBar(v);
    v.box = el('div', { class: 'lmd-vw-pages' });
    for (let i = 0; i < v.n; i++) {
      const page = el('div', { class: 'lmd-vw-page', 'data-page': String(i + 1), role: 'region', 'aria-label': T('Página {a}', { a: i + 1 }) });
      v.box.appendChild(page);
      v.slots.push({ el: page, key: '', task: null, page: i ? null : first, text: null, ranges: [] });
    }
    v.host.appendChild(v.box);
    v.bar.querySelector('.lmd-vw-total').textContent = '/ ' + v.n;
    pdfLayout(v);
    if (v.box.clientWidth !== v.avail) pdfLayout(v); // con las páginas puestas apareció la barra de desplazamiento

    // El panel Índice: los marcadores del PDF, si trae.
    let title = v.name; let outline = null;
    try { const meta = await pdf.getMetadata(); const t = meta && meta.info && typeof meta.info.Title === 'string' ? meta.info.Title.trim() : ''; if (t) title = t; } catch (e) { /* sin datos */ }
    try { outline = await pdf.getOutline(); } catch (e) { outline = null; }
    if (!v.live()) return;
    outlineHead(v, title, T(v.n === 1 ? '{n} página' : '{n} páginas', { n: v.n }));
    const conv = (list, level) => (list || []).filter((o) => o && typeof o.title === 'string' && o.title.trim()).slice(0, 2000).map((o) => ({ label: o.title.replace(/\s+/g, ' ').trim().slice(0, 200), dest: o.dest, url: o.url, level, page: -1, kids: level < 6 ? conv(o.items, level + 1) : [] }));
    const items = conv(outline, 1);
    if (items.length) outlineTree(v, items); else { v.rows = []; v.outline.appendChild(el('p', { class: 'lmd-vw-toc-none', text: T('Este PDF no trae índice.') })); }
    // A qué página lleva cada marcador: se averigua por detrás, para marcar en el índice por dónde va la lectura.
    (async () => { for (const r of v.rows) { if (!v.live()) return; const at = await pdfDest(v, r.it.dest); if (at) r.it.page = at.page; } if (v.live()) pdfSpy(v); })();

    // Dónde quedó la última vez, o la página que pide la dirección (#page=12).
    const asked = /[#&]page=(\d+)/.exec(v.hash || '');
    let p = 0; let f = 0;
    if (asked) p = clamp(parseInt(asked[1], 10) - 1, 0, v.n - 1);
    else if (v.pos && v.pos.p >= 1) { p = clamp(v.pos.p - 1, 0, v.n - 1); f = clamp(+v.pos.f || 0, 0, 1); }
    v.ready = true;
    pdfGo(v, p, f, true);
    pdfSpy(v);

    let queued = false;
    const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (cur === v) pdfSpy(v); }); };
    window.addEventListener('scroll', onScroll, { passive: true });
    v.off.push(() => window.removeEventListener('scroll', onScroll));
    // El ancho disponible cambió (la ventana, la barra lateral): al ancho se vuelve a ajustar, sin perder el lugar.
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(debounce(() => { if (cur !== v || !v.box.clientWidth || v.box.clientWidth === v.avail) return; if (v.zoom === 'fit') pdfZoom(v, 'fit', true); else { v.avail = v.box.clientWidth; pdfSpy(v); } }, 120));
      ro.observe(v.host); v.off.push(() => ro.disconnect());
    }
    pdfGestures(v);
    // Los tamaños de las demás páginas: casi siempre son todos iguales; si alguno difiere, se corrige su hueco.
    (async () => {
      let changed = false;
      for (let i = 1; i < v.n; i++) {
        if (!v.live()) return;
        try { const page = await pdf.getPage(i + 1); v.slots[i].page = page; const s = size(page); if (Math.abs(s.w - one.w) > 0.5 || Math.abs(s.h - one.h) > 0.5) { v.sizes[i] = s; changed = true; } } catch (e) { /* queda con el tamaño de la primera */ }
        if (i % 40 === 0) { await new Promise((r) => setTimeout(r, 0)); if (changed && v.live()) { changed = false; pdfRelayout(v); } }
      }
      if (changed && v.live()) pdfRelayout(v);
    })();
    if (v.pendingQ) { const q = v.pendingQ; v.pendingQ = ''; search(q, false); }
  }

  // El tamaño de cada hueco y dónde empieza, para saber qué página hay en cada altura sin medir el documento.
  function pdfLayout(v) {
    const avail = Math.max(120, v.box.clientWidth || v.host.clientWidth - 32); v.avail = v.box.clientWidth;
    const widest = v.sizes.reduce((m, s) => Math.max(m, s.w), 1);
    v.fit = clamp(avail / widest, MIN, 2.5 * UNIT);
    v.scale = v.zoom === 'fit' ? v.fit : clamp(v.zoom * UNIT, MIN, MAX);
    v.tops = new Array(v.n); let y = 0;
    for (let i = 0; i < v.n; i++) {
      const s = v.sizes[i]; const w = Math.floor(s.w * v.scale); const h = Math.floor(s.h * v.scale);
      const st = v.slots[i].el.style; st.width = w + 'px'; st.height = h + 'px'; st.setProperty('--scale-factor', String(v.scale));
      v.tops[i] = y; y += h + GAP;
    }
    v.heights = v.sizes.map((s) => Math.floor(s.h * v.scale));
    const z = v.bar.querySelector('.lmd-vw-zoom'); if (z) z.textContent = Math.round(v.scale / UNIT * 100) + ' %';
    const fitBtn = v.bar.querySelector('[data-vw=fit]'); if (fitBtn) fitBtn.setAttribute('aria-pressed', String(v.zoom === 'fit'));
    v.bar.querySelector('[data-vw=out]').disabled = v.scale <= MIN * 1.01;
    v.bar.querySelector('[data-vw=in]').disabled = v.scale >= MAX * 0.99;
  }
  const boxTop = (v) => v.box.getBoundingClientRect().top + window.scrollY;
  function pdfWhere(v) {
    const y = window.scrollY + lineY(v) - boxTop(v);
    let lo = 0; let hi = v.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (v.tops[mid] <= y) lo = mid; else hi = mid - 1; }
    return { p: lo, f: clamp((y - v.tops[lo]) / Math.max(1, v.heights[lo]), 0, 1) };
  }
  function pdfGo(v, p, f, instant) {
    if (!v.ready) return;
    p = clamp(p, 0, v.n - 1);
    const y = boxTop(v) + v.tops[p] + (f || 0) * v.heights[p] - lineY(v) + 1;
    window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    // Al final del documento la página pedida puede no llegar a la línea de lectura: igual es la actual.
    v.pin = !instant && pdfWhere(v).p !== p ? p : null;
    pdfSpy(v);
  }
  function pdfRelayout(v) {
    const at = pdfWhere(v);
    pdfLayout(v);
    v.slots.forEach((s) => { if (s.key) pdfStale(v, s); });
    pdfGo(v, at.p, at.f, true);
  }
  // z: 'fit', o los píxeles de CSS por punto que se quieren.
  function pdfZoom(v, z, quiet) {
    if (!v.ready) return;
    const next = z === 'fit' ? 'fit' : clamp(z, MIN, MAX) / UNIT;
    if (next === v.zoom && z !== 'fit') return;
    v.zoom = next;
    pdfRelayout(v);
    if (!quiet && core.savePos) core.savePos();
  }
  // Un lienzo que quedó con otra escala: sigue a la vista, estirado, hasta que llega el nuevo. El texto se rehace.
  function pdfStale(v, s) {
    if (s.task) { try { s.task.cancel(); } catch (e) { /* ya terminó */ } s.task = null; }
    s.el.querySelectorAll('.lmd-vw-text, .lmd-vw-links').forEach((n) => n.remove());
    s.text = null; s.ranges = []; s.key = 'stale';
  }
  function pdfDrop(v, s) {
    if (s.task) { try { s.task.cancel(); } catch (e) { /* ya terminó */ } s.task = null; }
    if (!s.key) return;
    s.el.textContent = ''; s.key = ''; s.text = null; s.ranges = [];
    if (s.page) { try { s.page.cleanup(); } catch (e) { /* en uso */ } }
  }
  // Con cada movimiento: qué página es la actual, cuáles hay que dibujar y cuáles ya no hacen falta.
  function pdfSpy(v) {
    if (!v.ready) return;
    const top = window.scrollY - boxTop(v); const bottom = top + window.innerHeight;
    let a = 0; let lo = 0; let hi = v.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (v.tops[mid] <= top) lo = mid; else hi = mid - 1; }
    a = lo; let b = a;
    while (b < v.n - 1 && v.tops[b + 1] < bottom) b++;
    const want = new Set();
    for (let i = Math.max(0, a - AROUND); i <= Math.min(v.n - 1, b + AROUND); i++) want.add(i);
    v.want = want;
    v.slots.forEach((s, i) => { if (!want.has(i)) pdfDrop(v, s); });
    // Primero las que se ven; después las vecinas.
    const order = Array.from(want).sort((x, y) => (x >= a && x <= b ? 0 : 1) - (y >= a && y <= b ? 0 : 1) || x - y);
    order.forEach((i) => pdfDraw(v, i));

    const at = pdfWhere(v);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    let page = at.p;
    if (v.pin != null) { if (v.pin >= a && v.pin <= b && v.pin >= at.p) page = v.pin; else v.pin = null; }
    else if (max > 0 && window.scrollY >= max - 2) page = b;
    v.page = page; v.frac = page === at.p ? at.f : 0;
    const num = v.bar.querySelector('.lmd-vw-num'); if (document.activeElement !== num) num.value = String(page + 1);
    v.bar.querySelector('[data-vw=prev]').disabled = page <= 0;
    v.bar.querySelector('[data-vw=next]').disabled = page >= v.n - 1;
    progress(v, max > 0 ? window.scrollY / max : 1);
    // El marcador que corresponde: el último que quedó en esta página o antes.
    let on = -1; (v.rows || []).forEach((r, k) => { if (r.it.page >= 0 && r.it.page <= page) on = k; });
    markRow(v, on);
  }
  const unpin = () => { if (cur && cur.kind === 'pdf') cur.pin = null; };
  const AREA = 4096 * 4096; // tope de píxeles de un lienzo

  async function pdfDraw(v, i) {
    const s = v.slots[i];
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const key = v.scale + '@' + dpr;
    if (s.key === key || s.doing === key) return;
    s.doing = key;
    try {
      const page = s.page || (s.page = await v.pdf.getPage(i + 1));
      if (!v.live() || s.doing !== key || !v.want.has(i)) return;
      const vp = page.getViewport({ scale: v.scale });
      let out = dpr; if (vp.width * out * vp.height * out > AREA) out = Math.sqrt(AREA / (vp.width * vp.height));
      const canvas = el('canvas', { 'aria-hidden': 'true' });
      canvas.width = Math.max(1, Math.floor(vp.width * out)); canvas.height = Math.max(1, Math.floor(vp.height * out));
      if (s.task) { try { s.task.cancel(); } catch (e) { /* ya terminó */ } }
      const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null });
      s.task = task;
      if (!s.el.firstChild) s.el.appendChild(el('span', { class: 'lmd-vw-pn', 'aria-hidden': 'true', text: String(i + 1) }));
      try { await task.promise; } catch (e) { return; } // cancelado: la página salió de la vista o cambió la escala
      if (s.task === task) s.task = null;
      if (!v.live() || s.doing !== key || !v.want.has(i)) return;
      s.el.textContent = ''; s.el.appendChild(canvas);
      s.key = key;
      // La capa de texto: transparente, encima del dibujo. De ahí salen la selección, la copia y la búsqueda.
      const tc = await page.getTextContent();
      if (!v.live() || s.key !== key) return;
      const layer = el('div', { class: 'lmd-vw-text' });
      const tl = new v.lib.TextLayer({ textContentSource: tc, container: layer, viewport: vp });
      await tl.render();
      if (!v.live() || s.key !== key) return;
      layer.appendChild(el('div', { class: 'endOfContent' }));
      s.el.appendChild(layer);
      s.text = { divs: tl.textDivs, layer };
      pdfLinks(v, s, page, vp);
      if (v.q) pdfMarks(v);
    } catch (e) {
      if (v.live() && s.doing === key) { s.el.textContent = ''; s.el.appendChild(el('span', { class: 'lmd-vw-pn', text: T('No se pudo dibujar la página {a}.', { a: i + 1 }) })); s.key = key; }
    } finally { if (s.doing === key) s.doing = ''; }
  }

  // Los enlaces del PDF, como enlaces de verdad sobre la página: se llega con Tab y los lee un lector de pantalla.
  async function pdfLinks(v, s, page, vp) {
    let list = [];
    try { list = await page.getAnnotations({ intent: 'display' }); } catch (e) { return; }
    if (!v.live() || !s.text || !s.el.isConnected) return;
    const box = el('div', { class: 'lmd-vw-links' }); let n = 0;
    list.forEach((a) => {
      if (!a || a.subtype !== 'Link' || !Array.isArray(a.rect) || n > 500) return;
      const r = vp.convertToViewportRectangle(a.rect);
      const x = Math.min(r[0], r[2]); const y = Math.min(r[1], r[3]); const w = Math.abs(r[2] - r[0]); const h = Math.abs(r[3] - r[1]);
      if (!(w > 0 && h > 0)) return;
      let link = null;
      if (a.dest) { link = el('a', { href: '#', 'aria-label': T('Enlace dentro del documento') }); link._dest = a.dest; link.dataset.vwDest = '1'; }
      else if (typeof a.url === 'string' && /^(https?:|mailto:)/i.test(a.url)) link = el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', title: a.url, 'aria-label': a.url });
      if (!link) return;
      const st = link.style; st.left = (100 * x / vp.width) + '%'; st.top = (100 * y / vp.height) + '%'; st.width = (100 * w / vp.width) + '%'; st.height = (100 * h / vp.height) + '%';
      box.appendChild(link); n++;
    });
    if (n) s.el.appendChild(box);
  }
  // Un destino del PDF (con nombre o explícito): la página y a qué altura de ella.
  async function pdfDest(v, dest) {
    try {
      let d = dest;
      if (typeof d === 'string') d = await v.pdf.getDestination(d);
      if (!Array.isArray(d) || !d.length) return null;
      const ref = d[0]; let p = -1;
      if (ref && typeof ref === 'object') p = await v.pdf.getPageIndex(ref); else if (Number.isInteger(ref)) p = ref;
      if (!(p >= 0 && p < v.n)) return null;
      let f = 0; const kind = d[1] && d[1].name; const h = v.sizes[p].h;
      const top = kind === 'XYZ' ? d[3] : (kind === 'FitH' || kind === 'FitBH') ? d[2] : null;
      if (typeof top === 'number' && h > 0) f = clamp(1 - top / h, 0, 1);
      return { page: p, f };
    } catch (e) { return null; }
  }
  async function pdfFollow(v, dest) {
    const at = await pdfDest(v, dest);
    if (!v.live()) return;
    if (at) pdfGo(v, at.page, at.f); else core.flash(T('Ese enlace no lleva a ninguna página.'), 'warn');
  }

  // El texto de una página, como lo arma la capa de texto: un tramo por trozo, y dónde empieza cada uno.
  async function pdfText(v, i) {
    if (v.texts[i]) return v.texts[i];
    let items = [];
    try { const page = v.slots[i].page || (v.slots[i].page = await v.pdf.getPage(i + 1)); items = (await page.getTextContent()).items.filter((it) => it.str !== undefined); } catch (e) { items = []; }
    const starts = []; let s = '';
    items.forEach((it) => { starts.push(s.length); s += it.str.toLowerCase().padEnd(it.str.length, ' ').slice(0, it.str.length) + (it.hasEOL ? ' ' : ''); });
    return (v.texts[i] = { s, starts, lens: items.map((it) => it.str.length) });
  }
  async function pdfFind(v, token) {
    const q = v.q.toLowerCase();
    for (let i = 0; i < v.n; i++) {
      if (cur !== v || v.token !== token) return false;
      const t = await pdfText(v, i);
      let at = 0;
      while ((at = t.s.indexOf(q, at)) !== -1) { v.hits.push({ p: i, a: at, b: at + q.length }); at += q.length; if (v.hits.length >= 5000) break; }
      if (v.hits.length >= 5000) break;
      if (i % 12 === 11) { tell(v); await new Promise((r) => setTimeout(r, 0)); }
    }
    return cur === v && v.token === token;
  }
  // Las coincidencias de las páginas que están dibujadas, marcadas sobre su capa de texto.
  function pdfMarks(v) {
    const H = hl(); if (!H) return;
    const all = []; let now = null;
    v.slots.forEach((s, i) => {
      s.ranges = [];
      if (!s.text || !v.q) return;
      const t = v.texts[i]; if (!t) return;
      const node = (k) => { const d = s.text.divs[k]; return d && d.firstChild && d.firstChild.nodeType === 3 ? d.firstChild : null; };
      const spot = (off, end) => {
        let lo = 0; let hi = t.starts.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t.starts[mid] <= off) lo = mid; else hi = mid - 1; }
        // El final de una coincidencia que cae justo en el borde de un trozo pertenece al trozo anterior.
        if (end && lo > 0 && t.starts[lo] === off) lo--;
        return [lo, Math.min(off - t.starts[lo], t.lens[lo])];
      };
      v.hits.forEach((h, k) => {
        if (h.p !== i) return;
        const a = spot(h.a, false); const b = spot(h.b, true); const na = node(a[0]); const nb = node(b[0]);
        if (!na || !nb) return;
        try { const r = new Range(); r.setStart(na, Math.min(a[1], na.length)); r.setEnd(nb, Math.min(b[1], nb.length)); all.push(r); s.ranges.push([k, r]); if (k === v.at) now = r; } catch (e) { /* un trozo que no calza */ }
      });
    });
    if (all.length) H.set('lmd-hit', new Highlight(...all)); else H.delete('lmd-hit');
    if (now) H.set('lmd-hit-current', new Highlight(now)); else H.delete('lmd-hit-current');
    // La coincidencia a la que se iba: con su página ya dibujada, se la deja a la vista.
    if (now && v.reach === v.at) { v.reach = -1; const r = now.getBoundingClientRect(); if (r.height && (r.top < lineY(v) + 4 || r.bottom > window.innerHeight - 60)) window.scrollBy({ top: r.top - Math.max(lineY(v) + 40, window.innerHeight / 3) }); }
  }
  function pdfStep(v) {
    const h = v.hits[v.at]; if (!h) return;
    v.reach = v.at;
    const s = v.slots[h.p];
    if (!(s.text && v.want.has(h.p))) pdfGo(v, h.p, 0, true);
    pdfMarks(v);
  }

  // Acercar y alejar: pellizcando en el teléfono, o con Ctrl y la rueda.
  function pdfGestures(v) {
    const box = v.box; let d0 = 0; let s0 = 0; let r = 1;
    const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    box.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e); s0 = v.scale; r = 1; } }, { passive: true });
    box.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      r = clamp(dist(e) / d0, MIN / s0, MAX / s0);
      // Mientras dura el gesto se estira lo que hay; al soltar se dibuja a la escala nueva.
      const rect = box.getBoundingClientRect(); const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left; const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      box.style.transformOrigin = cx + 'px ' + cy + 'px'; box.style.transform = 'scale(' + r + ')';
    }, { passive: false });
    const end = (e) => {
      if (!d0 || e.touches.length >= 2) return;
      d0 = 0; box.style.transform = ''; box.style.transformOrigin = '';
      if (Math.abs(r - 1) > 0.03) pdfZoom(v, s0 * r);
    };
    box.addEventListener('touchend', end, { passive: true }); box.addEventListener('touchcancel', end, { passive: true });
    box.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); pdfZoom(v, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  }

  // ====================================================================================================
  // EPUB
  // ====================================================================================================
  const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
  // Solo el cifrado de tipografías (que acá no se usan) deja abrir el libro; cualquier otro es DRM.
  const FONT_ONLY = /^http:\/\/(www\.idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC)$/;
  // Lo mismo que una nota (sin estilos ni formularios) y, además, nada que traiga cosas de afuera, que se pueda
  // escribir o apretar, ni atributos con los que el libro pueda acomodarse por encima de la app.
  const BOOK_RULES = {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'audio', 'video', 'source', 'track', 'input', 'button', 'select', 'textarea', 'dialog', 'template', 'noscript', 'canvas', 'marquee', 'foreignObject', 'animate', 'set', 'animateMotion', 'animateTransform'],
    FORBID_ATTR: ['style', 'class', 'srcset', 'background', 'poster', 'contenteditable', 'tabindex', 'autofocus', 'draggable', 'popover', 'is', 'slot', 'accesskey', 'ping', 'usemap', 'action', 'formaction'],
  };
  const fromXml = (n, name) => Array.from(n.getElementsByTagNameNS('*', name));
  const attrOf = (n, name) => { if (n && n.attributes) for (const a of n.attributes) if (a.localName === name) return a.value; return null; };
  const kidsOf = (n, name) => (n ? Array.from(n.children).filter((c) => c.localName === name) : []);
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  async function openEpub(v) {
    const K = LMD.import.kit;
    const job = K.newJob();
    v.off.push(() => job.cancel());
    const bytes = new Uint8Array(await v.file.arrayBuffer());
    if (!v.live()) return;
    const zip = K.unzip(bytes, job);
    v.zip = zip;
    if (zip.has('META-INF/rights.xml')) throw fail('drm');
    if (zip.has('META-INF/encryption.xml')) {
      let algos = null;
      try { algos = fromXml(K.xml(await zip.text('META-INF/encryption.xml')), 'EncryptionMethod').map((n) => n.getAttribute('Algorithm') || ''); } catch (e) { algos = null; }
      if (!algos || !algos.length || !algos.every((a) => FONT_ONLY.test(a))) throw fail('drm');
    }
    if (!zip.has('META-INF/container.xml')) throw fail('bad');
    const rootfile = fromXml(K.xml(await zip.text('META-INF/container.xml')), 'rootfile')[0];
    const opfPath = rootfile && rootfile.getAttribute('full-path');
    if (!opfPath || !zip.has(opfPath)) throw fail('bad');
    const opf = K.xml(await zip.text(opfPath)); const dir = K.dirOf(opfPath);
    const title = oneLine((fromXml(opf, 'title')[0] || {}).textContent) || v.name;
    const author = oneLine((fromXml(opf, 'creator')[0] || {}).textContent);
    const items = new Map();
    fromXml(opf, 'item').forEach((it) => items.set(it.getAttribute('id'), { path: K.resolve(dir, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' }));
    const seen = new Set();
    v.spine = fromXml(opf, 'itemref').map((r) => items.get(r.getAttribute('idref'))).filter((it) => it && zip.has(it.path) && /html|xml/i.test(it.type) && !seen.has(it.path) && seen.add(it.path)).slice(0, 2000);
    if (!v.spine.length) throw fail('bad');
    v.index = new Map(v.spine.map((it, i) => [it.path, i]));
    v.sizes = v.spine.map((it) => Math.max(1, zip.size(it.path))); v.total = v.sizes.reduce((a, b) => a + b, 0);
    v.fixed = fromXml(opf, 'meta').some((m) => m.getAttribute('property') === 'rendition:layout' && /pre-paginated/.test(m.textContent || ''));

    // La tabla de contenidos: el documento de navegación (EPUB 3) o el NCX (EPUB 2). Sin ninguno, los capítulos.
    let toc = [];
    const navItem = Array.from(items.values()).find((it) => /(^|\s)nav(\s|$)/.test(it.props) && zip.has(it.path));
    const spineEl = fromXml(opf, 'spine')[0];
    const ncxItem = (spineEl && items.get(spineEl.getAttribute('toc'))) || Array.from(items.values()).find((it) => /dtbncx/.test(it.type));
    try { if (navItem) toc = await tocNav(v, navItem.path); } catch (e) { toc = []; }
    if (!toc.length && ncxItem && zip.has(ncxItem.path)) { try { toc = tocNcx(v, K.xml(await zip.text(ncxItem.path)), K.dirOf(ncxItem.path)); } catch (e) { toc = []; } }
    if (!toc.length) toc = v.spine.map((it, i) => ({ label: T('Capítulo {a}', { a: i + 1 }), c: i, frag: '', kids: [] }));
    if (!v.live()) return;

    v.host.textContent = ''; v.note = null;
    buildBar(v);
    outlineHead(v, title, (author ? author + ' · ' : '') + T(v.spine.length === 1 ? '{n} capítulo' : '{n} capítulos', { n: v.spine.length }));
    outlineTree(v, toc);
    v.title = title;
    bookTouch(v);
    let queued = false;
    const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (cur === v) bookSpy(v); }); };
    window.addEventListener('scroll', onScroll, { passive: true });
    v.off.push(() => window.removeEventListener('scroll', onScroll));
    v.ready = true; v.c = -1;
    const c = v.pos && v.pos.c >= 0 ? clamp(v.pos.c | 0, 0, v.spine.length - 1) : 0;
    await bookGo(v, c, { f: v.pos && v.pos.c === c ? clamp(+v.pos.f || 0, 0, 1) : 0, quiet: true });
    if (v.fixed && v.live()) core.flash(T('Este libro es de diseño fijo: acá se lee como texto corrido.'), 'warn');
    if (v.pendingQ && v.live()) { const q = v.pendingQ; v.pendingQ = ''; search(q, false); }
  }

  // Dónde lleva una dirección de adentro del libro: { c, frag } o null si no es un capítulo.
  function bookTarget(v, dir, href) {
    const K = LMD.import.kit;
    const raw = String(href || ''); const cut = raw.indexOf('#');
    const file = cut < 0 ? raw : raw.slice(0, cut); let frag = cut < 0 ? '' : raw.slice(cut + 1);
    try { frag = decodeURIComponent(frag); } catch (e) { /* queda como vino */ }
    if (/^[a-z][a-z0-9+.-]*:/i.test(file) || /^\/\//.test(file)) return null;
    const path = K.resolve(dir, file);
    return v.index.has(path) ? { c: v.index.get(path), frag } : null;
  }
  async function parseBook(v, path) {
    const text = await v.zip.text(path);
    // Primero como XHTML, que es lo que es; si no cierra, como HTML. Sin entidades propias: por ahí se infla solo.
    if (!/<!ENTITY/i.test(text)) {
      try { const d = new DOMParser().parseFromString(text, 'application/xhtml+xml'); if (!d.getElementsByTagName('parsererror').length && d.body) return d; } catch (e) { /* se prueba como HTML */ }
    }
    return new DOMParser().parseFromString(text, 'text/html');
  }
  async function tocNav(v, path) {
    const K = LMD.import.kit;
    const doc = await parseBook(v, path); const dir = K.dirOf(path);
    const navs = fromXml(doc, 'nav');
    const nav = navs.find((n) => /(^|\s)toc(\s|$)/.test(attrOf(n, 'type') || '')) || navs[0];
    if (!nav) return [];
    let count = 0;
    const read = (list, depth) => kidsOf(list, 'li').map((li) => {
      if (++count > 3000) return null;
      const a = kidsOf(li, 'a')[0] || kidsOf(li, 'span')[0];
      const at = a && a.localName === 'a' ? bookTarget(v, dir, attrOf(a, 'href')) : null;
      const kids = depth < 6 ? [].concat(...kidsOf(li, 'ol').map((ol) => read(ol, depth + 1))) : [];
      const label = oneLine(a ? a.textContent : '').slice(0, 200);
      if (!label || (!at && !kids.length)) return null;
      return { label, c: at ? at.c : (kids[0] ? kids[0].c : 0), frag: at ? at.frag : '', kids };
    }).filter(Boolean);
    return [].concat(...kidsOf(nav, 'ol').map((ol) => read(ol, 1)));
  }
  function tocNcx(v, doc, dir) {
    const map = fromXml(doc, 'navMap')[0]; let count = 0;
    const read = (node, depth) => kidsOf(node, 'navPoint').map((np) => {
      if (++count > 3000) return null;
      const label = oneLine((fromXml(kidsOf(np, 'navLabel')[0] || np, 'text')[0] || {}).textContent).slice(0, 200);
      const at = bookTarget(v, dir, attrOf(kidsOf(np, 'content')[0], 'src'));
      const kids = depth < 6 ? read(np, depth + 1) : [];
      if (!label || (!at && !kids.length)) return null;
      return { label, c: at ? at.c : (kids[0] ? kids[0].c : 0), frag: at ? at.frag : '', kids };
    }).filter(Boolean);
    return map ? read(map, 1) : [];
  }

  // El capítulo, ya limpio y listo para entrar a la página. Todo se arma en un documento aparte, que no carga nada.
  // light: solo el texto (para buscar), sin leer las imágenes.
  async function bookChapter(v, c, light) {
    const K = LMD.import.kit;
    const path = v.spine[c].path; const dir = K.dirOf(path);
    const doc = await parseBook(v, path);
    const body = doc.body || doc.documentElement;
    const html = window.DOMPurify.sanitize(body, BOOK_RULES);
    const safe = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
    const root = safe.body; const urls = [];
    // Los identificadores del libro no entran como id: no pisan los de la app ni sus estilos. Las anclas se buscan por data-bk.
    // Tampoco queda ningún data-*: con ellos la app reconoce sus propios botones y enlaces.
    root.querySelectorAll('*').forEach((n) => {
      Array.from(n.attributes).forEach((a) => { if (/^data-/i.test(a.name)) n.removeAttribute(a.name); });
      const id = n.getAttribute('id') || (n.localName === 'a' ? n.getAttribute('name') : '');
      if (id) n.setAttribute('data-bk', id);
      n.removeAttribute('id'); n.removeAttribute('name');
    });
    root.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
      a.removeAttribute('xlink:href');
      if (!href) return;
      if (/^https?:/i.test(href) || /^mailto:/i.test(href)) { a.setAttribute('href', href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); return; }
      a.removeAttribute('target');
      const at = href[0] === '#' ? { c, frag: (() => { try { return decodeURIComponent(href.slice(1)); } catch (e) { return href.slice(1); } })() } : bookTarget(v, dir, href);
      if (at) { a.setAttribute('href', '#'); a.setAttribute('data-bk-go', at.c + '#' + at.frag); } else a.removeAttribute('href');
    });
    // Las imágenes: solo las del propio libro, servidas desde el zip. Lo que apunta afuera no se pide.
    let budget = 400;
    const blobOf = async (src) => {
      if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(src)) return src;
      if (light || /^[a-z][a-z0-9+.-]*:/i.test(src) || /^\/\//.test(src) || budget-- <= 0) return '';
      const p = K.resolve(dir, src); const type = IMG_TYPES[(/\.([a-z0-9]+)$/i.exec(p) || ['', ''])[1].toLowerCase()];
      if (!type || !v.zip.has(p)) return '';
      try { const u = URL.createObjectURL(new Blob([await v.zip.read(p)], { type })); urls.push(u); return u; } catch (e) { return ''; }
    };
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const u = await blobOf(img.getAttribute('src') || '');
      if (u) { img.setAttribute('src', u); if (!img.closest('a')) img.setAttribute('class', 'lmd-zoomable'); }
      else { img.removeAttribute('src'); if (!img.getAttribute('alt')) img.remove(); }
    }
    for (const im of Array.from(root.querySelectorAll('image'))) {
      const u = await blobOf(im.getAttribute('href') || im.getAttribute('xlink:href') || '');
      im.removeAttribute('xlink:href');
      if (u) im.setAttribute('href', u); else im.remove();
    }
    root.querySelectorAll('table').forEach((t) => { const wrap = safe.createElement('div'); wrap.setAttribute('class', 'lmd-table'); t.replaceWith(wrap); wrap.appendChild(t); });
    // El cuerpo suele venir envuelto en una o dos cajas: se sacan, para que cada párrafo quede como un bloque de la nota.
    let box = root;
    for (let k = 0; k < 4; k++) {
      const kids = Array.from(box.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.nodeValue.trim()));
      if (kids.length === 1 && kids[0].nodeType === 1 && /^(div|section|article|main)$/.test(kids[0].localName) && !kids[0].hasAttribute('data-bk')) box = kids[0]; else break;
    }
    return { nodes: Array.from(box.childNodes), urls, doc: safe };
  }

  // Abre un capítulo. o: frag (ancla), f (avance dentro del capítulo), end (al final), hit (coincidencia a mostrar).
  async function bookGo(v, c, o) {
    o = o || {};
    if (!v.ready || c < 0 || c >= v.spine.length) return false;
    const turn = ++v.turn;
    if (c !== v.c) {
      let made = null;
      try { made = await bookChapter(v, c); } catch (e) { made = null; }
      if (!v.live() || turn !== v.turn) { if (made) made.urls.forEach((u) => URL.revokeObjectURL(u)); return false; }
      if (LMD.speak && LMD.speak.state && LMD.speak.state().active) { try { LMD.speak.stop(); } catch (e) { /* sin voz */ } }
      const H = hl(); if (H) { H.delete('lmd-hit'); H.delete('lmd-hit-current'); }
      v.urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      v.host.textContent = '';
      if (!made) v.host.appendChild(el('p', { class: 'lmd-vw-note lmd-vw-err', role: 'alert', text: T('Este capítulo no se pudo mostrar.') }));
      else { v.urls = made.urls; made.nodes.forEach((n) => v.host.appendChild(document.importNode(n, true))); }
      // Al pie, el paso al capítulo anterior y al siguiente.
      const turnBox = el('nav', { class: 'lmd-vw-turn', 'aria-label': T('Capítulos') });
      const name = (i) => { const r = (v.rows || []).find((x) => x.it.c === i); return r ? r.it.label : T('Capítulo {a}', { a: i + 1 }); };
      if (c > 0) { const b = el('button', { type: 'button', 'data-vw': 'prev', 'aria-label': T('Capítulo anterior') + ': ' + name(c - 1) }, I.left + '<span></span>'); b.lastChild.textContent = name(c - 1); turnBox.appendChild(b); }
      if (c < v.spine.length - 1) { const b = el('button', { type: 'button', 'data-vw': 'next', 'aria-label': T('Capítulo siguiente') + ': ' + name(c + 1) }, '<span></span>' + I.right); b.firstChild.textContent = name(c + 1); turnBox.appendChild(b); }
      v.host.appendChild(turnBox);
      v.c = c; v.marks = null;
      v.bar.querySelector('[data-vw=prev]').disabled = c <= 0;
      v.bar.querySelector('[data-vw=next]').disabled = c >= v.spine.length - 1;
      if (v.q) bookMarks(v);
    }
    // A dónde dentro del capítulo.
    const max = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (o.frag) {
      const t = bookAnchor(v, o.frag);
      if (t) { window.scrollTo({ top: Math.max(0, window.scrollY + t.getBoundingClientRect().top - lineY(v) - 12) }); t.classList.add('lmd-vw-there'); setTimeout(() => t.classList.remove('lmd-vw-there'), 1800); }
      else window.scrollTo(0, 0);
    } else if (o.hit != null) bookShow(v, o.hit);
    else if (o.end) window.scrollTo(0, max());
    else if (o.f > 0) {
      window.scrollTo(0, o.f * max());
      // Las imágenes llegan después y corren el texto: con ellas ya puestas se vuelve al mismo avance, si nadie movió la página.
      const y0 = window.scrollY;
      const imgs = Array.from(v.host.querySelectorAll('img')).filter((i) => !i.complete).slice(0, 40);
      if (imgs.length) Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), new Promise((r) => setTimeout(r, 800))]).then(() => { if (v.live() && turn === v.turn && v.c === c && Math.abs(window.scrollY - y0) < 4) window.scrollTo(0, o.f * max()); });
    } else window.scrollTo(0, 0);
    bookSpy(v);
    if (!o.quiet && core.savePos) core.savePos();
    return true;
  }
  const bookAnchor = (v, frag) => { try { return frag ? v.host.querySelector('[data-bk="' + CSS.escape(frag) + '"]') : null; } catch (e) { return null; } };
  // Por dónde va la lectura: el avance en todo el libro y la entrada del índice que corresponde.
  function bookSpy(v) {
    if (!v.ready || v.c < 0) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    v.frac = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    const before = v.sizes.slice(0, v.c).reduce((a, b) => a + b, 0);
    const done = v.c === v.spine.length - 1 && (max <= 0 || window.scrollY >= max - 2) ? 1 : (before + v.frac * v.sizes[v.c]) / v.total;
    const pct = progress(v, done);
    v.bar.querySelector('.lmd-vw-where').textContent = (v.c + 1) + ' / ' + v.spine.length + ' · ' + pct + ' %';
    let on = -1; const line = lineY(v) + 20;
    (v.rows || []).forEach((r, k) => {
      if (r.it.c < v.c) { on = k; return; }
      if (r.it.c !== v.c) return;
      // La primera entrada del capítulo vale desde que se lo abre; las que siguen, cuando su ancla ya pasó.
      const t = r.it.frag ? bookAnchor(v, r.it.frag) : null;
      if (!t || t.getBoundingClientRect().top <= line || on < 0 || v.rows[on].it.c !== v.c) on = k;
    });
    markRow(v, on);
  }
  // Los textos de un capítulo, tal como quedan en la página: de ahí sale la cuenta de coincidencias.
  async function bookTexts(v, c) {
    if (!v.texts) v.texts = [];
    if (v.texts[c]) return v.texts[c];
    let list = [];
    try {
      const made = await bookChapter(v, c, true);
      const w = made.doc.createTreeWalker(made.doc.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) list.push(n.nodeValue.toLowerCase());
    } catch (e) { list = []; }
    return (v.texts[c] = list);
  }
  async function bookFind(v, token) {
    const q = v.q.toLowerCase();
    for (let c = 0; c < v.spine.length; c++) {
      if (cur !== v || v.token !== token) return false;
      const list = await bookTexts(v, c); let k = 0;
      for (const text of list) { let at = 0; while ((at = text.indexOf(q, at)) !== -1) { v.hits.push({ c, k: k++ }); at += q.length; if (v.hits.length >= 5000) break; } if (v.hits.length >= 5000) break; }
      if (v.hits.length >= 5000) break;
      tell(v); await new Promise((r) => setTimeout(r, 0));
    }
    return cur === v && v.token === token;
  }
  // Las coincidencias del capítulo abierto, en el mismo orden en que se contaron.
  function bookMarks(v) {
    const H = hl(); v.marks = [];
    if (!v.q) { if (H) { H.delete('lmd-hit'); H.delete('lmd-hit-current'); } return; }
    const q = v.q.toLowerCase();
    const w = document.createTreeWalker(v.host, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode.closest('.lmd-vw-turn') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) }); let n;
    while ((n = w.nextNode())) {
      const text = n.nodeValue.toLowerCase(); let at = 0;
      while ((at = text.indexOf(q, at)) !== -1) { const r = new Range(); r.setStart(n, at); r.setEnd(n, at + q.length); v.marks.push(r); at += q.length; }
    }
    if (H) { if (v.marks.length) H.set('lmd-hit', new Highlight(...v.marks)); else H.delete('lmd-hit'); H.delete('lmd-hit-current'); }
  }
  function bookShow(v, k) {
    if (!v.marks) bookMarks(v);
    const r = v.marks[Math.min(k, v.marks.length - 1)]; if (!r) return;
    const H = hl(); if (H) H.set('lmd-hit-current', new Highlight(r));
    const box = r.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + box.top - window.innerHeight / 3) });
  }
  async function bookStep(v) {
    const h = v.hits[v.at]; if (!h) return;
    if (h.c !== v.c) await bookGo(v, h.c, { hit: h.k }); else bookShow(v, h.k);
  }
  // En el teléfono, deslizar hacia un lado pasa de capítulo.
  function bookTouch(v) {
    let x0 = 0; let y0 = 0; let t0 = 0; let ok = false;
    const start = (e) => { ok = e.touches.length === 1 && !e.target.closest('.lmd-table, pre, a, button'); if (!ok) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); };
    const end = (e) => {
      if (!ok || cur !== v) return; ok = false;
      const t = e.changedTouches[0]; const dx = t.clientX - x0; const dy = t.clientY - y0;
      if (Math.abs(dx) < 80 || Math.abs(dy) > 50 || Date.now() - t0 > 700) return;
      if (String(window.getSelection && window.getSelection())) return;
      bookGo(v, v.c + (dx < 0 ? 1 : -1), {});
    };
    v.host.addEventListener('touchstart', start, { passive: true }); v.host.addEventListener('touchend', end, { passive: true });
    v.off.push(() => { v.host.removeEventListener('touchstart', start); v.host.removeEventListener('touchend', end); });
  }

  // ====================================================================================================
  // Imágenes, audio y video
  // ====================================================================================================
  const MEDIA_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm' };
  const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || ['', ''])[1].toLowerCase();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  async function openImage(v) {
    v.svg = extOf(v.name) === 'svg';
    // Con su tipo y desde una dirección blob:, en un <img>: un SVG no corre guiones ni pide nada de afuera.
    const url = URL.createObjectURL(new Blob([v.file], { type: IMG_TYPES[extOf(v.name)] || 'application/octet-stream' })); v.urls.push(url);
    const img = new Image(); img.alt = v.name; img.draggable = false;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(fail('img_bad')); img.src = url; });
    if (!v.live()) return;
    v.img = img; v.w = img.naturalWidth || 300; v.h = img.naturalHeight || 150;
    v.host.textContent = ''; v.note = null;
    buildBar(v);
    v.stage = el('div', { class: 'lmd-vw-stage', tabindex: '0', role: 'group', 'aria-label': v.name });
    v.stage.appendChild(img);
    v.host.appendChild(v.stage);
    const meta = v.w + ' × ' + v.h + ' px · ' + LMD.kit.bytes(v.file.size);
    v.host.appendChild(el('p', { class: 'lmd-vw-info', text: meta }));
    outlineHead(v, v.name, meta, true);
    v.rows = [];
    const size = () => { v.stage.style.height = Math.max(180, window.innerHeight - Math.max(0, v.stage.getBoundingClientRect().top + window.scrollY) - 96) + 'px'; };
    size();
    v.ready = true; v.fitted = true;
    imgFit(v);
    const onSize = debounce(() => { if (cur !== v) return; size(); if (v.fitted) imgFit(v); else imgDraw(v); }, 80);
    window.addEventListener('resize', onSize); v.off.push(() => window.removeEventListener('resize', onSize));
    if (window.ResizeObserver) { const ro = new ResizeObserver(onSize); ro.observe(v.stage); v.off.push(() => ro.disconnect()); }
    imgGestures(v);
    // Las demás imágenes de la carpeta: para pasar de una a otra, y como lista en el panel Índice.
    v.sibs = []; v.i = -1;
    try {
      const rows = (v.dir && core.listAll ? await core.listAll(v.dir) : null) || [];
      if (!v.live()) return;
      v.sibs = rows.filter((r) => !r.dir && LMD.kit.kindOf(r.name) === 'image').sort(byName).slice(0, 2000);
      v.i = v.sibs.findIndex((r) => r.url === v.here);
    } catch (e) { v.sibs = []; }
    if (v.sibs.length > 1 && v.i >= 0) { outlineTree(v, v.sibs.map((r) => ({ label: r.name, url: r.url }))); markRow(v, v.i); }
    v.bar.querySelector('.lmd-vw-where').textContent = v.i >= 0 && v.sibs.length > 1 ? (v.i + 1) + ' / ' + v.sibs.length : '';
    v.bar.querySelector('[data-vw=prev]').disabled = !(v.i > 0);
    v.bar.querySelector('[data-vw=next]').disabled = !(v.i >= 0 && v.i < v.sibs.length - 1);
  }
  const stageSize = (v) => ({ w: v.stage.clientWidth, h: v.stage.clientHeight });
  function imgDraw(v) {
    const s = stageSize(v); const w = v.w * v.z; const h = v.h * v.z;
    // Más chica que el marco, queda centrada; más grande, se arrastra sin dejar huecos.
    v.x = w <= s.w ? (s.w - w) / 2 : clamp(v.x, s.w - w, 0);
    v.y = h <= s.h ? (s.h - h) / 2 : clamp(v.y, s.h - h, 0);
    const st = v.img.style; st.width = w + 'px'; st.height = h + 'px'; st.transform = 'translate(' + Math.round(v.x) + 'px,' + Math.round(v.y) + 'px)';
    v.bar.querySelector('.lmd-vw-zoom').textContent = Math.round(v.z * 100) + ' %';
    v.bar.querySelector('[data-vw=fit]').setAttribute('aria-pressed', String(!!v.fitted));
  }
  function imgFit(v) { const s = stageSize(v); v.z = Math.min(1, s.w / v.w, s.h / v.h) || 1; v.x = 0; v.y = 0; v.fitted = true; imgDraw(v); }
  // Acerca o aleja dejando quieto el punto (cx, cy) del marco: el del cursor, o el centro.
  function imgZoom(v, z, cx, cy) {
    const s = stageSize(v); if (cx == null) { cx = s.w / 2; cy = s.h / 2; }
    z = clamp(z, Math.min(0.05, 16 / Math.max(v.w, v.h)), 16);
    v.x = cx - (cx - v.x) * z / v.z; v.y = cy - (cy - v.y) * z / v.z; v.z = z; v.fitted = false;
    imgDraw(v);
  }
  function imgAct(v, what) {
    if (what === 'prev' || what === 'next') { const to = v.sibs && v.sibs[v.i + (what === 'next' ? 1 : -1)]; if (to && v.i >= 0) core.open(to.url); }
    else if (what === 'in') imgZoom(v, v.z * 1.25);
    else if (what === 'out') imgZoom(v, v.z / 1.25);
    else if (what === 'fit') imgFit(v);
    else if (what === 'real') imgZoom(v, 1);
    else if (what === 'copy-md') core.copy('![' + v.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, ' ') + '](' + v.rel + ')');
    else if (what === 'copy-img') imgCopy(v);
    else if (what === 'src') imgSource(v);
  }
  // Al portapapeles va como PNG, que es lo que aceptan los navegadores.
  async function imgCopy(v) {
    try {
      const c = document.createElement('canvas'); const k = Math.min(1, Math.sqrt(AREA / (v.w * v.h)));
      c.width = Math.max(1, Math.round(v.w * k)); c.height = Math.max(1, Math.round(v.h * k));
      c.getContext('2d').drawImage(v.img, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      core.flash(T('Imagen copiada'));
    } catch (e) { core.flash(T('Este navegador no deja copiar la imagen.'), 'warn'); }
  }
  // El fuente de un SVG, como texto: se lee, no se interpreta.
  async function imgSource(v) {
    const b = v.bar.querySelector('[data-vw=src]');
    if (v.src) { v.src.hidden = !v.src.hidden; }
    else {
      let text = ''; try { text = await v.file.text(); } catch (e) { text = ''; }
      if (cur !== v) return;
      v.src = el('pre', { class: 'lmd-vw-src', tabindex: '0', 'aria-label': T('Código del SVG') }); v.src.textContent = text.slice(0, 2000000);
      v.host.appendChild(v.src);
    }
    v.stage.hidden = !v.src.hidden; b.setAttribute('aria-pressed', String(!v.src.hidden));
    if (v.src.hidden) { if (v.fitted) imgFit(v); else imgDraw(v); }
  }
  function imgGestures(v) {
    const st = v.stage; const pts = new Map(); let d0 = 0; let z0 = 1; let moved = false;
    const at = (e) => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    st.addEventListener('wheel', (e) => { e.preventDefault(); const p = at(e); imgZoom(v, v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p[0], p[1]); }, { passive: false });
    st.addEventListener('pointerdown', (e) => { if (e.button) return; pts.set(e.pointerId, [e.clientX, e.clientY]); try { st.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ } moved = false; if (pts.size === 2) { const a = Array.from(pts.values()); d0 = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); z0 = v.z; } st.classList.add('lmd-vw-grab'); });
    st.addEventListener('pointermove', (e) => {
      const was = pts.get(e.pointerId); if (!was) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && d0) {
        const a = Array.from(pts.values()); const r = st.getBoundingClientRect();
        imgZoom(v, z0 * Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) / d0, (a[0][0] + a[1][0]) / 2 - r.left, (a[0][1] + a[1][1]) / 2 - r.top);
      } else if (pts.size === 1) { v.x += e.clientX - was[0]; v.y += e.clientY - was[1]; moved = true; imgDraw(v); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; if (!pts.size) st.classList.remove('lmd-vw-grab'); };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('dblclick', (e) => { if (moved) return; if (v.fitted && v.z < 1) { const p = at(e); imgZoom(v, 1, p[0], p[1]); } else imgFit(v); });
  }

  function openMedia(v) {
    const url = URL.createObjectURL(v.file.type ? v.file : new Blob([v.file], { type: MEDIA_TYPES[extOf(v.name)] || '' })); v.urls.push(url);
    v.host.textContent = ''; v.note = null;
    const m = el(v.kind === 'video' ? 'video' : 'audio', { class: 'lmd-vw-media', controls: '', preload: 'metadata', 'aria-label': v.name });
    if (v.kind === 'video') m.setAttribute('playsinline', '');
    m.addEventListener('error', () => { if (cur !== v) return; v.host.textContent = ''; v.host.appendChild(el('p', { class: 'lmd-vw-note lmd-vw-err', role: 'alert', text: T('Este navegador no puede reproducir ese archivo.') })); });
    m.src = url;
    v.host.appendChild(m);
    v.host.appendChild(el('p', { class: 'lmd-vw-info', text: v.name + ' · ' + LMD.kit.bytes(v.file.size) }));
    outlineHead(v, v.name, LMD.kit.bytes(v.file.size), true);
    v.rows = []; v.ready = true;
  }

  // ====================================================================================================
  // Lo común
  // ====================================================================================================
  // Busca en todo el documento. jump: ir a la primera coincidencia desde donde se está. own: lo pidió la barra del visor.
  async function search(q, jump, own) {
    const v = cur; if (!v || (v.kind !== 'pdf' && v.kind !== 'epub')) return;
    q = String(q || '').trim();
    if (!v.ready) { v.pendingQ = q; return; }
    const input = v.bar.querySelector('.lmd-vw-q'); if (!own && input.value !== q) input.value = q;
    const token = ++v.token; v.q = q; v.hits = []; v.at = -1; v.reach = -1;
    if (!q) { v.finding = false; if (v.kind === 'pdf') pdfMarks(v); else bookMarks(v); tell(v); return; }
    v.finding = true; tell(v);
    const done = await (v.kind === 'pdf' ? pdfFind(v, token) : bookFind(v, token));
    if (!done) return;
    v.finding = false;
    if (v.kind === 'pdf') pdfMarks(v); else bookMarks(v);
    if (jump && v.hits.length) {
      // La primera desde donde se está leyendo, no la primera del documento.
      const from = v.kind === 'pdf' ? v.hits.findIndex((h) => h.p >= v.page) : v.hits.findIndex((h) => h.c >= v.c);
      v.at = (from < 0 ? 0 : from) - 1;
      step(1);
    } else tell(v);
  }
  function step(dir) {
    const v = cur; if (!v || !v.hits.length) return;
    v.at = (v.at + dir + v.hits.length) % v.hits.length;
    tell(v);
    if (v.kind === 'pdf') pdfStep(v); else bookStep(v);
  }

  // Un clic en el panel Índice o dentro del documento que le toca al visor. Devuelve true si lo atendió.
  function click(e) {
    const v = cur; if (!v || !v.ready) return false;
    const t = e.target;
    const row = t.closest('.lmd-pane-outline [data-vw-i]');
    if (row) {
      e.preventDefault();
      const it = (v.rows[+row.dataset.vwI] || {}).it; if (!it) return true;
      if (core.drawer) core.drawer(false);
      if (v.kind === 'pdf') { if (it.dest) pdfFollow(v, it.dest); else if (typeof it.url === 'string' && /^https?:/i.test(it.url)) window.open(it.url, '_blank', 'noopener'); }
      else if (v.kind === 'image') core.open(it.url);
      else bookGo(v, it.c, { frag: it.frag });
      return true;
    }
    if (t.closest('.lmd-pane-outline [data-vw-top]')) { e.preventDefault(); if (v.kind === 'pdf') pdfGo(v, 0, 0); else if (v.kind === 'epub') bookGo(v, 0, {}); return true; }
    if (t.closest('.lmd-pane-outline a')) { e.preventDefault(); return true; }
    if (!v.host.contains(t)) return false;
    const turn = t.closest('.lmd-vw-turn [data-vw]');
    if (turn) { e.preventDefault(); act(v, turn.dataset.vw); return true; }
    const a = t.closest('a'); if (!a) return false;
    if (a.dataset.vwDest) { e.preventDefault(); pdfFollow(v, a._dest); return true; }
    if (a.hasAttribute('data-bk-go')) {
      e.preventDefault();
      const go = a.getAttribute('data-bk-go'); const cut = go.indexOf('#');
      bookGo(v, +go.slice(0, cut), { frag: go.slice(cut + 1) });
      return true;
    }
    // Lo que queda son enlaces a la web, que ya abren aparte. Uno sin destino no hace nada.
    if (a.target === '_blank' && /^(https?:|mailto:)/i.test(a.getAttribute('href') || '')) return false;
    e.preventDefault();
    return true;
  }

  // Lo que se recuerda de este archivo: página y zoom, o capítulo y avance.
  function state() {
    const v = cur; if (!v || !v.ready) return null;
    if (v.kind === 'pdf') { const at = pdfWhere(v); return { p: (v.pin != null ? v.pin : at.p) + 1, f: v.pin != null ? 0 : Math.round(at.f * 1000) / 1000, z: v.zoom === 'fit' ? 'fit' : Math.round(v.zoom * 1000) / 1000 }; }
    return v.kind === 'epub' && v.c >= 0 ? { c: v.c, f: Math.round((v.frac || 0) * 1000) / 1000 } : null;
  }

  function close() {
    const v = cur; if (!v) return;
    cur = null;
    v.off.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ya suelto */ } });
    v.urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    if (v.bar) v.bar.remove();
    const H = hl(); if (H) { H.delete('lmd-hit'); H.delete('lmd-hit-current'); }
    v.host.classList.remove('lmd-vw', 'lmd-vw-pdf', 'lmd-vw-epub', 'lmd-vw-image', 'lmd-vw-audio', 'lmd-vw-video');
    if (v.pdf) { try { v.pdf.cleanup(); } catch (e) { /* ya cerrado */ } }
  }

  // o: { kind, file, name, host, outline, pos, hash, alive, count, query }
  async function open(c, o) {
    core = c; close(); style();
    const v = cur = Object.assign({ q: '', hits: [], at: -1, off: [], urls: [], token: 0, turn: 0, ready: false, pendingQ: o.query || '' }, o);
    v.live = () => cur === v && o.alive();
    v.host.textContent = ''; v.host.classList.add('lmd-vw', 'lmd-vw-' + v.kind);
    v.note = el('p', { class: 'lmd-vw-note', role: 'status', text: T('Abriendo…') });
    v.host.appendChild(v.note);
    try {
      if (v.kind === 'pdf') await openPdf(v); else if (v.kind === 'epub') await openEpub(v); else if (v.kind === 'image') await openImage(v); else openMedia(v);
      return v.ready;
    } catch (e) {
      if (!v.live()) return false;
      // Dañado, con contraseña o protegido: una línea que lo dice, y la app sigue como estaba.
      if (v.bar) { v.bar.remove(); v.bar = null; }
      v.ready = false;
      v.host.textContent = ''; v.outline.textContent = '';
      v.host.appendChild(el('p', { class: 'lmd-vw-note lmd-vw-err', role: 'alert', text: whyOf(e) }));
      return false;
    }
  }

  if (!LMD.viewer) { window.addEventListener('keydown', onKey); window.addEventListener('wheel', unpin, { passive: true }); window.addEventListener('touchmove', unpin, { passive: true }); }
  LMD.viewer = { open, close, search, step, click, state, find: focusFind, active: () => !!cur, ready: () => !!(cur && cur.ready), kind: () => (cur ? cur.kind : ''),
    // Para las pruebas: cuántas páginas hay dibujadas y a qué escala.
    peek: () => (cur ? { kind: cur.kind, ready: cur.ready, n: cur.n || (cur.spine ? cur.spine.length : 0), page: cur.page, c: cur.c, scale: cur.scale, zoom: cur.zoom, hits: cur.hits.length, at: cur.at, q: cur.q } : null) };
})();
