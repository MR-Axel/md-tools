// Plegar y desplegar. Son dos cosas que se parecen y no son lo mismo:
//   - Las secciones desplegables (::: details Título … :::) son parte de la nota. Acá se les cambia el título
//     tocándolo, se envuelven bloques en una y se la saca dejando lo de adentro.
//   - El plegado por títulos (Ajustes > Lectura y edición) es de quien lee: esconde lo que cuelga de un título.
// Qué quedó abierto o plegado se recuerda por nota mientras dure la pestaña (sessionStorage). Nunca se escribe
// en el Markdown, y al imprimir o exportar sale todo a la vista.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null; let article = null;

  const BOX = 'details.lmd-box[data-l]';
  // La línea que abre una sección desplegable: sangría, los dos puntos (tres o más) y el título.
  const OPEN_RE = /^(\s*)(:{3,})\s*details(?=\s|$)\s*(.*)$/;
  const CLOSE_RE = /^\s*:{3,}\s*$/;
  const FENCE_RE = /^(\s*)(:{3,})(.*)$/;
  const isHead = (n) => !!n && n.nodeType === 1 && /^H[1-6]$/.test(n.tagName);
  const topOf = (node) => { let n = node && node.nodeType !== 1 ? node.parentNode : node; while (n && n.parentNode !== article) n = n.parentNode; return n || null; };
  const fm = () => core.fmOffset;
  const lines = () => core.srcLines;
  // Las líneas de un recuadro, con la que lo cierra (write.js la suma: el rango del parser no la trae).
  const abs = (node) => LMD.write.span(node);

  // ---------- Lo que se recuerda ----------
  // Por nota: los desplegables abiertos (por título y orden entre los de igual título) y los títulos plegados (por ancla).
  const KEY = 'lmd-fold'; const MAX_DOCS = 40; const MAX_IDS = 400;
  let mem = { open: [], shut: [] }; let memFor = null;
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_IDS) : []);
  const readAll = () => { try { const all = JSON.parse(sessionStorage.getItem(KEY) || '{}'); return all && typeof all === 'object' && !Array.isArray(all) ? all : {}; } catch (e) { return {}; } };
  function load() {
    if (memFor === core.HERE) return mem;
    memFor = core.HERE; const all = readAll(); const m = (Object.prototype.hasOwnProperty.call(all, memFor) && all[memFor]) || {};
    mem = { open: strings(m.open), shut: strings(m.shut) };
    return mem;
  }
  function store() {
    try {
      const all = readAll(); delete all[memFor];
      if (mem.open.length || mem.shut.length) all[memFor] = { open: mem.open.slice(0, MAX_IDS), shut: mem.shut.slice(0, MAX_IDS) };
      const keys = Object.keys(all); while (keys.length > MAX_DOCS) delete all[keys.shift()];
      sessionStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) { /* sin sesión: vale mientras no se recargue la página */ }
  }

  // ---------- Secciones desplegables ----------
  const titleOf = (d) => { const s = d.querySelector(':scope > summary'); return ((s && s.textContent) || '').trim() || T('Detalles'); };
  function boxes() {
    const seen = new Map();
    return Array.from(article.querySelectorAll(BOX)).map((d) => { const t = titleOf(d); const n = (seen.get(t) || 0) + 1; seen.set(t, n); return { d, key: t + '#' + n }; });
  }
  let quiet = false; // se abrieron para imprimir: eso no es lo que dejó la persona
  function dress() {
    if (quiet || !core.blocks || core.noDoc) return;
    const m = load();
    boxes().forEach((b) => { const want = m.open.includes(b.key); if (b.d.open !== want) b.d.open = want; });
  }
  function snapshot() {
    if (quiet || !core.blocks || core.noDoc) return;
    load(); mem.open = boxes().filter((b) => b.d.open).map((b) => b.key); store();
  }
  const boxAt = (line) => article.querySelector('details.lmd-box[data-l^="' + (line - fm()) + '-"]');
  // Una recién hecha queda abierta. Con title, lista para ponerle nombre; si no, con el cursor en lo de adentro.
  function opened(d, title) {
    d.open = true; snapshot();
    if (!core.editMode) return;
    const node = title ? d.querySelector(':scope > summary .lmd-sum-title') : Array.from(d.querySelectorAll('.lmd-editable')).find((n) => !n.classList.contains('lmd-sum-title'));
    if (node) { node.focus(); getSelection().selectAllChildren(node); }
  }

  // En edición el título es un texto más: se toca y se escribe. Lleva las líneas de la que abre la sección, así
  // pasa por el mismo camino que cualquier bloque (pausa, deshacer, guardado, sesión en vivo).
  function editable(root, make) {
    root.querySelectorAll(BOX).forEach((d) => {
      const s = d.querySelector(':scope > summary'); const r = core.rangeOf(d);
      if (!s || !r || s.querySelector('.lmd-sum-title') || !OPEN_RE.test(lines()[r[0] + fm()] || '')) return;
      const span = el('span', { class: 'lmd-sum-title', 'data-l': r[0] + '-' + (r[0] + 1) });
      while (s.firstChild) span.appendChild(s.firstChild);
      s.appendChild(span); make(span);
      span.dataset.ph = T('Detalles');
      // Vacía: un lugar donde empezar a escribir adentro.
      if (!Array.from(d.children).some((k) => k !== s)) d.appendChild(el('p', { class: 'lmd-box-empty', role: 'button', tabindex: '0', 'data-label': T('Escribí acá') }));
    });
  }
  // El título como queda en el archivo: solo cambia esa línea. Vacío, vuelve al de siempre.
  function titleLines(node, first) {
    const m = OPEN_RE.exec(first || ''); if (!m) return null;
    const t = node.textContent.replace(/[​\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return [m[1] + m[2] + ' details' + (t ? ' ' + t : '')];
  }

  // Los bloques que abarca lo elegido; sin nada elegido, ese bloque.
  function pickedBlocks(block) {
    const W = LMD.write; const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed && article.contains(sel.anchorNode) && article.contains(sel.focusNode)) {
      const r = sel.getRangeAt(0); const a = topOf(r.startContainer); let b = topOf(r.endContainer);
      // Una selección que termina justo al empezar el bloque siguiente (triple clic) no lo incluye.
      if (a && b && a !== b) { const head = document.createRange(); head.selectNodeContents(b); head.setEnd(r.endContainer, r.endOffset); if (!head.toString().trim()) b = b.previousElementSibling; }
      const out = [];
      for (let n = a; n && b; n = n.nextElementSibling) { out.push(n); if (n === b) break; }
      const ok = out.filter((n) => W.span(n));
      if (ok.length && out[out.length - 1] === b && (!block || out.includes(block))) return ok;
    }
    return block && W.span(block) ? [block] : [];
  }
  // Envuelve esas líneas. Si adentro ya hay un recuadro, la de afuera lleva más dos puntos que él.
  function wrapLines(s, e) {
    const inner = lines().slice(s, e); let n = 3;
    inner.forEach((l) => { const m = FENCE_RE.exec(l); if (m) n = Math.max(n, m[2].length + 1); });
    const fence = ':'.repeat(n);
    const moved = LMD.write.splice(s, e - s, [fence + ' details ' + T('Detalles')].concat(inner, [fence]));
    const d = boxAt(moved ? moved(s) : s); if (d) opened(d, true);
  }
  function wrap(list) {
    const W = LMD.write; if (!list.length) return;
    const a = W.span(list[0]); const b = W.span(list[list.length - 1]);
    if (a && b && b.e > a.s) wrapLines(a.s, b.e);
  }
  // Saca la línea que abre y la que cierra. Lo de adentro queda donde estaba.
  function unwrapLines(s, e) {
    const all = lines(); if (!OPEN_RE.test(all[s] || '')) return;
    const end = e - 1 > s && CLOSE_RE.test(all[e - 1]) ? e - 1 : e;
    const inner = all.slice(s + 1, end);
    while (inner.length && !inner[0].trim()) inner.shift();
    while (inner.length && !inner[inner.length - 1].trim()) inner.pop();
    LMD.write.splice(s, e - s, inner);
  }
  const canUnwrap = (d) => { const r = abs(d); return !!r && OPEN_RE.test(lines()[r.s] || ''); };

  // Antes de insertar un recuadro dentro de otros: cada uno de afuera necesita más dos puntos que el de adentro,
  // o la línea que cierra al nuevo cerraría también al que lo contiene.
  function widen(after) {
    let need = 4;
    for (let b = after && after.parentElement ? after.parentElement.closest('.lmd-box[data-l]') : null; b; b = b.parentElement.closest('.lmd-box[data-l]')) {
      const r = abs(b); const m = r && FENCE_RE.exec(lines()[r.s] || ''); if (!m) break;
      if (m[2].length < need) {
        core.replaceLines(r.s, r.s + 1, [m[1] + ':'.repeat(need) + m[3]], null);
        const c = r.e - 1; const cm = c > r.s && CLOSE_RE.test(lines()[c]) ? FENCE_RE.exec(lines()[c]) : null;
        if (cm) core.replaceLines(c, c + 1, [cm[1] + ':'.repeat(need)], null);
      }
      need = Math.max(need, m[2].length) + 1;
    }
  }

  // ---------- Plegado por títulos ----------
  const on = () => !!core && core.blocks && !core.noDoc && !!core.settings.foldHeadings;
  const heads = () => Array.from(article.children).filter(isHead);
  // Lo que nunca se esconde: donde se está escribiendo y las capas que la app dibuja encima.
  const KEEP = '.lmd-add, .lmd-draft, .lmd-cm-layer, .lmd-live-layer';
  // Lo que cuelga de un título: todo hasta el próximo de igual o mayor jerarquía. Los subtítulos quedan adentro.
  function sectionOf(h) {
    const out = []; const lv = +h.tagName[1];
    for (let n = h.nextElementSibling; n; n = n.nextElementSibling) { if (isHead(n) && +n.tagName[1] <= lv) break; if (!n.matches(KEEP)) out.push(n); }
    return out;
  }
  // El control va dentro del título con la clase de las anclas: así no cuenta como texto al guardar, copiar ni exportar.
  function toggleOf(h) {
    let a = h.querySelector(':scope > .lmd-fold-tog');
    if (!a) { a = el('a', { class: 'lmd-anchor lmd-fold-tog', role: 'button', tabindex: '0', contenteditable: 'false' }, ICON.chevron); h.insertBefore(a, h.firstChild); }
    return a;
  }
  function apply() {
    const active = on();
    document.documentElement.classList.toggle('lmd-foldable', active);
    article.querySelectorAll(':scope > .lmd-fold-away').forEach((n) => n.classList.remove('lmd-fold-away'));
    const hs = heads();
    if (!active) {
      article.querySelectorAll('.lmd-fold-tog').forEach((n) => n.remove());
      hs.forEach((h) => { h.classList.remove('lmd-fold-shut'); h.removeAttribute('data-fold-n'); });
      return;
    }
    const m = load(); const key = LMD.keys('Alt+Shift+F');
    hs.forEach((h) => {
      const sec = sectionOf(h); const shut = sec.length > 0 && m.shut.includes(h.id); const tog = toggleOf(h);
      const label = T(shut ? 'Desplegar la sección' : 'Plegar la sección');
      tog.hidden = !sec.length; tog.setAttribute('aria-expanded', String(!shut)); tog.setAttribute('aria-label', label); tog.title = label + ' (' + key + ')';
      h.classList.toggle('lmd-fold-shut', shut);
      if (!shut) { h.removeAttribute('data-fold-n'); return; }
      sec.forEach((n) => n.classList.add('lmd-fold-away'));
      h.dataset.foldN = String(sec.filter((n) => n.hasAttribute('data-l') || n.querySelector('[data-l]')).length);
    });
    syncOutline();
  }
  function setShut(h, shut) {
    load(); const i = mem.shut.indexOf(h.id);
    if (shut === (i >= 0)) return;
    if (shut) {
      // Lo que se estaba escribiendo ahí adentro pasa al Markdown antes de quedar escondido.
      const a = document.activeElement;
      if (a && a !== document.body && a.blur && sectionOf(h).some((n) => n.contains(a))) a.blur();
      mem.shut.push(h.id);
    } else mem.shut.splice(i, 1);
    store(); apply();
  }
  const flip = (h) => { if (isHead(h) && h.parentNode === article) setShut(h, !h.classList.contains('lmd-fold-shut')); };
  // El título solo de la nota no entra en "plegar todo": dejaría la página en blanco.
  function setAll(shut) {
    load();
    const hs = heads(); const h1 = hs.filter((h) => h.tagName === 'H1');
    const lone = h1.length === 1 && hs[0] === h1[0] ? h1[0] : null;
    if (shut) { const a = document.activeElement; if (a && a.blur && article.contains(a)) a.blur(); }
    mem.shut = shut ? hs.filter((h) => h !== lone && sectionOf(h).length).map((h) => h.id) : [];
    store(); apply();
  }
  // El índice lateral pliega las mismas secciones que el documento, y al revés.
  function syncOutline() {
    const set = core.outlineShut; if (!set) return;
    core.ui.paneOutline.querySelectorAll('.lmd-o-row[data-id]').forEach((row) => {
      if (!row.querySelector('.lmd-o-tog')) return;
      const h = document.getElementById(row.dataset.id); if (!h || h.parentNode !== article) return;
      const shut = mem.shut.includes(h.id);
      row.parentNode.classList.toggle('lmd-o-shut', shut);
      if (shut) set.add(h.id); else set.delete(h.id);
    });
  }
  function fromOutline(h, shut) { if (on() && isHead(h) && h.parentNode === article) setShut(h, shut); }

  // El título de la sección donde está el cursor; sin cursor, la que se está leyendo.
  function headingHere() {
    const a = document.activeElement; const sel = getSelection();
    let n = a && a !== article && article.contains(a) ? a : (sel.rangeCount && article.contains(sel.anchorNode) ? sel.anchorNode : null);
    if (!n) n = article.querySelector(':scope > :hover');
    let top = n ? topOf(n) : null;
    if (!top) {
      const row = core.ui.paneOutline.querySelector('.lmd-o-row.lmd-active'); const h = row && document.getElementById(row.dataset.id);
      top = h && article.contains(h) ? topOf(h) : null;
    }
    if (!top) { const hs = heads().filter((h) => !h.classList.contains('lmd-fold-away')); top = hs.filter((h) => h.getBoundingClientRect().top < window.innerHeight * 0.4).pop() || hs[0] || null; }
    for (let k = top; k; k = k.previousElementSibling) if (isHead(k) && sectionOf(k).length) return k;
    return null;
  }

  // Deja a la vista ese lugar del documento: abre los desplegables que lo contienen y despliega las secciones
  // plegadas en las que está. Lo usan el buscador, el índice, los enlaces a una sección y lo que inserta bloques.
  function reveal(node) {
    let n = node && node.nodeType !== 1 ? node.parentNode : node;
    if (!n || !article || !article.contains(n) || n === article) return false;
    let changed = false;
    for (let d = n.closest('details'); d && article.contains(d); d = d.parentElement ? d.parentElement.closest('details') : null) {
      const s = d.querySelector(':scope > summary');
      if (!d.open && !(s && s.contains(n))) { d.open = true; changed = true; }
    }
    const top = topOf(n);
    if (top && top.classList.contains('lmd-fold-away') && on()) {
      load(); const before = mem.shut.length;
      heads().forEach((h) => { const i = mem.shut.indexOf(h.id); if (i >= 0 && sectionOf(h).includes(top)) mem.shut.splice(i, 1); });
      if (mem.shut.length !== before) { store(); apply(); changed = true; }
    }
    return changed;
  }

  // Lo que se copia o se exporta: sin lo que es de la interfaz. Con open, los desplegables van abiertos.
  function clean(copy, open) {
    copy.querySelectorAll('.lmd-box-empty, .lmd-fold-tog').forEach((n) => n.remove());
    copy.querySelectorAll('.lmd-sum-title').forEach((n) => n.replaceWith(...n.childNodes));
    copy.querySelectorAll('.lmd-fold-away, .lmd-fold-shut').forEach((n) => {
      n.classList.remove('lmd-fold-away', 'lmd-fold-shut'); n.removeAttribute('data-fold-n');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    if (open) copy.querySelectorAll('details.lmd-box').forEach((d) => d.setAttribute('open', ''));
  }

  function bind() {
    // toggle no burbujea: se escucha en la bajada.
    article.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches(BOX)) snapshot(); }, true);
    article.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.lmd-fold-tog')) e.preventDefault(); }, true);
    article.addEventListener('click', (e) => {
      const t = e.target; if (!t.closest) return;
      // Tocar el título es para escribirlo: no pliega. El triángulo y el resto del renglón, sí.
      if (core.editMode && t.closest('.lmd-sum-title')) { e.preventDefault(); return; }
      const empty = t.closest('.lmd-box-empty');
      if (empty) { e.preventDefault(); e.stopPropagation(); if (core.editMode) LMD.write.open(empty.parentNode.querySelector(':scope > summary'), 'p'); return; }
      const tog = t.closest('.lmd-fold-tog');
      if (tog) { e.preventDefault(); e.stopPropagation(); flip(tog.parentNode); }
    }, true);
    article.addEventListener('keydown', (e) => {
      const t = e.target; if (!t.classList) return;
      // Enter en el título lo confirma, como en una celda.
      if (t.classList.contains('lmd-sum-title')) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); t.blur(); } return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (t.classList.contains('lmd-fold-tog')) { e.preventDefault(); e.stopPropagation(); flip(t.parentNode); }
      else if (t.classList.contains('lmd-box-empty')) { e.preventDefault(); e.stopPropagation(); t.click(); }
    }, true);
    // El espacio escrito en el título es un espacio: el resumen no lo toma como un clic.
    article.addEventListener('keyup', (e) => { if (e.key === ' ' && e.target.classList && e.target.classList.contains('lmd-sum-title')) e.preventDefault(); }, true);
    article.addEventListener('input', (e) => {
      const t = e.target; if (!t.classList) return;
      // El título cambió: lo recordado sigue siendo de esta sección.
      if (t.classList.contains('lmd-sum-title')) snapshot();
      // Si al escribir se llevó puesto el control del título, vuelve.
      else if (isHead(t) && t.parentNode === article && on() && !t.querySelector(':scope > .lmd-fold-tog')) apply();
    });
    article.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('lmd-sum-title')) snapshot(); });
    article.addEventListener('focusin', (e) => {
      const t = e.target; if (!t.classList || !on()) return;
      const top = topOf(t); if (!top) return;
      if (top.classList.contains('lmd-fold-away')) { reveal(t); return; }
      // Un bloque nuevo justo debajo de un título plegado quedaría escondido al escribirlo: la sección se abre.
      if (top.classList.contains('lmd-draft') && isHead(top.previousElementSibling) && top.previousElementSibling.classList.contains('lmd-fold-shut')) setShut(top.previousElementSibling, false);
    });
    window.addEventListener('keydown', (e) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const what = { KeyF: 'here', KeyM: 'all', KeyU: 'none' }[e.code];
      if (!what || !on() || document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres')) return;
      e.preventDefault();
      if (what === 'here') { const h = headingHere(); if (h) { flip(h); h.scrollIntoView({ block: 'nearest' }); } return; }
      setAll(what === 'all');
      core.flash(T(what === 'all' ? 'Secciones plegadas' : 'Secciones desplegadas'));
    });
    // Al imprimir (o guardar como PDF) los desplegables salen abiertos, y después vuelven a como estaban.
    let shut = null;
    window.addEventListener('beforeprint', () => { quiet = true; shut = Array.from(article.querySelectorAll('details')).filter((d) => !d.open); shut.forEach((d) => { d.open = true; }); });
    window.addEventListener('afterprint', () => { (shut || []).forEach((d) => { d.open = false; }); shut = null; quiet = false; });
  }

  function init(c) {
    core = c; article = core.ui.article;
    bind();
    core.hooks.render.push(() => { dress(); apply(); });
    // Un cambio de otra persona dibujado en el lugar: las secciones quedan como están en pantalla (otro puede
    // haberles cambiado el título), y eso es lo que se recuerda.
    core.hooks.patch.push(() => { snapshot(); apply(); });
    const W = LMD.write; const can = () => !core.readOnly && core.blocks && !!core.settings.plugins.containers;
    W.editMenu.push(({ block, draft, x, y }) => {
      if (!block || draft || !can()) return [];
      // Lo que se le haga a un título plegado se hace viendo lo que tiene debajo.
      if (block.classList.contains('lmd-fold-shut')) setShut(block, false);
      const out = [];
      if (W.span(block)) out.push(['block', 'fold-wrap', ICON.b_details, 'Envolver en una sección desplegable', () => wrap(pickedBlocks(block))]);
      const at = document.elementFromPoint(x, y); let d = at && at.closest ? at.closest(BOX) : null;
      if (!d || !block.contains(d)) d = block.matches(BOX) ? block : null;
      if (d && canUnwrap(d)) out.push(['block', 'fold-unwrap', ICON.b_details, 'Desenvolver la sección desplegable', () => { const r = abs(d); if (r) unwrapLines(r.s, r.e); }]);
      return out;
    });
    // Leyendo: con texto elegido se ofrece envolver esos bloques, y sobre un desplegable, desenvolverlo.
    const editing = async () => { if (!core.editMode) await core.setEditMode(true); return core.editMode; };
    W.readMenu.push(({ block, picked }) => {
      if (!picked || !can()) return null;
      const list = pickedBlocks(block); if (!list.length) return null;
      const a = W.span(list[0]); const b = W.span(list[list.length - 1]);
      return ['fold-wrap', ICON.b_details, 'Envolver en una sección desplegable', async () => { if (await editing()) wrapLines(a.s, b.e); }];
    });
    W.readMenu.push(({ picked, target }) => {
      const d = !picked && can() && target && target.closest ? target.closest(BOX) : null;
      const r = d && canUnwrap(d) ? abs(d) : null; if (!r) return null;
      return ['fold-unwrap', ICON.b_details, 'Desenvolver la sección desplegable', async () => { if (await editing()) unwrapLines(r.s, r.e); }];
    });
  }

  LMD.fold = { init, editable, titleLines, widen, inserted: (d) => { if (d && d.matches && d.matches(BOX)) opened(d, false); }, reveal, clean, outline: fromOutline, on, section: sectionOf, wrap: wrapLines };
})();
