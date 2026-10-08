// Comentarios para la IA: sobre una nota propia de la nube, la persona marca un bloque y escribe qué quiere cambiar.
// El servidor no despierta a la IA: la IA conectada por MCP los lee cuando consulta (list_comments) y los cierra
// con una respuesta corta (resolve_comment). Acá se dejan, se ven al margen y se sigue qué pasó con cada uno.
// Todo lo que es de una nota (la lista, las marcas, los cuadros abiertos) cuelga de attach(ruta) y se suelta con
// detach(): al pasar a otra nota sin recargar alcanza con detach() y attach(rutaNueva). Los eventos en vivo no se
// escuchan acá, para no abrir otra conexión: quien escucha la nota le pasa cada evento a onEvent(ev).
(function () {
  'use strict';

  const { el, ICON, esc } = LMD.kit;
  const T = LMD.t;
  let core = null;
  let cur = null; // la nota en curso: { path, items }
  let layer = null; let pop = null; let dlg = null;
  // El asistente de IA con clave propia (assistant.js), cuando está prendido, atiende un comentario acá mismo.
  const SOLVERS = [];
  const solver = () => { for (const fn of SOLVERS) { const s = fn(); if (s) return s; } return null; };

  // '' no se ofrece (no es una nota propia de la nube, o no hay cuenta), 'on' anda.
  function mode() {
    if (!cur || !core.blocks) return '';
    if (cur.vault) return 'vault'; // carpeta protegida: el servidor no puede leer la nota, así que no hay comentarios
    const a = LMD.sync.account();
    return a ? 'on' : '';
  }
  // Solo lo pide un servidor propio sin actualizar: en los demás, conectar una IA es de todos los planes.
  const needsPlan = () => core.openPanel('plan', T('Los comentarios para la IA son parte del plan pago.'));
  const opened = () => (cur ? cur.items.filter((c) => c.status === 'open') : []);
  const when = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const say = (e) => T({ offline: 'No hay conexión con el servidor.', unsaved: 'La nota no se pudo guardar. El comentario no se envió.', too_many: 'Hay demasiados comentarios abiertos. Borrá alguno o esperá a que la IA los resuelva.', mcp_needs_plan: 'Los comentarios para la IA son parte del plan pago.' }[e && e.code] || 'No se pudo completar. Probá de nuevo.');

  // ---------- La cita ----------
  // El texto de un bloque como se lee, sin lo que agrega el lector (botones, anclas) y con las celdas separadas.
  const BREAK = /^(P|DIV|LI|TR|TD|TH|BR|H[1-6]|PRE|BLOCKQUOTE|DT|DD|SUMMARY)$/;
  function textOf(node) {
    let out = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1 && !c.matches('button, input, select, textarea, style, annotation, .lmd-anchor')) { walk(c); if (BREAK.test(c.tagName)) out += ' '; }
      }
    })(node);
    return out.replace(/\s+/g, ' ').trim();
  }
  // Para ubicar la cita no cuentan los espacios: una selección y el bloque los traen distintos.
  const key = (s) => String(s || '').replace(/\s+/g, '');
  const blocks = () => Array.from(core.ui.article.children).filter((n) => !n.matches('.lmd-add, .lmd-draft, .lmd-front'));

  // ---------- Marcas al margen ----------
  // Cada bloque con comentarios abiertos lleva una marca. Si el texto citado ya no está, el comentario queda
  // solo en la lista.
  function draw() {
    if (!layer) return;
    layer.textContent = '';
    if (pop && pop._kind === 'view') closePop();
    const open = opened();
    if (cur) cur.items.forEach((c) => { c.block = null; });
    // En pantalla chica el texto llega al borde: el bloque marcado le deja lugar a su marca (lmd-cm-has).
    core.ui.article.querySelectorAll('.lmd-cm-has').forEach((n) => n.classList.remove('lmd-cm-has'));
    if (!open.length || mode() !== 'on') return;
    const keys = blocks().map((b) => [b, key(textOf(b))]);
    const by = new Map();
    open.forEach((c) => {
      const k = key(c.quote); const hit = k && keys.find((p) => p[1].includes(k));
      if (!hit) return;
      c.block = hit[0];
      by.set(hit[0], (by.get(hit[0]) || []).concat(c));
    });
    by.forEach((list, block) => {
      const b = el('button', { type: 'button', class: 'lmd-cm-mark', title: list.length > 1 ? T('{n} comentarios para la IA', { n: list.length }) : T('Comentario para la IA') }, ICON.comment + (list.length > 1 ? '<b>' + list.length + '</b>' : ''));
      b._block = block; b._list = list; block.classList.add('lmd-cm-has');
      layer.appendChild(b);
    });
    place();
  }
  function place() {
    if (!layer || !layer.children.length) return;
    const main = core.ui.main.getBoundingClientRect(); const art = core.ui.article.getBoundingClientRect();
    layer.hidden = !art.height; // en la vista de código no hay bloques que marcar
    for (const b of layer.children) {
      const r = b._block.getBoundingClientRect();
      b.style.top = (r.top - main.top + 1) + 'px'; b.style.left = (art.right - main.left - 40) + 'px';
    }
  }

  // ---------- Cuadro anclado ----------
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  // Debajo de lo que lo abrió; si no entra, arriba. Queda pegado a la página: al desplazar se va con el bloque.
  function openPop(anchor, kind, label, html, right) {
    closePop();
    pop = el('div', { class: 'lmd-cm-pop', role: 'dialog', 'aria-label': label }, html);
    pop._kind = kind;
    document.body.appendChild(pop);
    const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2 - 170, right: window.innerWidth / 2 + 170, top: 120, bottom: 120 };
    const w = pop.offsetWidth; const h = pop.offsetHeight; const low = window.innerHeight - 38;
    let top = r.bottom + 6;
    if (top + h > low) top = r.top - h - 6 >= 56 ? r.top - h - 6 : Math.max(56, low - h);
    pop.style.left = (Math.max(8, Math.min(window.innerWidth - w - 8, right ? r.right - w : r.left)) + window.scrollX) + 'px';
    pop.style.top = (top + window.scrollY) + 'px';
    return pop;
  }

  // ---------- Dejar un comentario ----------
  function compose(block, picked) {
    const m = mode(); if (!m) return;
    if (m === 'vault') { LMD.vault.explain(); return; }
    const mine = cur;
    // Se cita lo elegido; sin nada elegido, el bloque, recortado.
    const quote = picked ? picked.replace(/\s+/g, ' ').trim().slice(0, 1000) : textOf(block).slice(0, 400).trim();
    const box = openPop(block, 'compose', T('Comentar para la IA'),
      '<h4>' + ICON.comment + '<span>' + T('Comentar para la IA') + '</span></h4>' +
      (quote ? '<blockquote>' + esc(quote) + '</blockquote>' : '') +
      '<textarea maxlength="2000" placeholder="' + T('Qué querés que cambie') + '"></textarea>' +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-cm-actions"><button type="button" class="lmd-btn" data-cm="close">' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-cm="send">' + T('Enviar') + '</button></div>');
    const area = box.querySelector('textarea'); const err = box.querySelector('.lmd-img-err'); const ok = box.querySelector('[data-cm=send]');
    const fail = (t) => { err.hidden = false; err.textContent = t; ok.disabled = false; };
    const send = async () => {
      const text = area.value.trim();
      if (!text) { fail(T('Escribí qué querés que cambie.')); area.focus(); return; }
      ok.disabled = true; err.hidden = true;
      try {
        // La IA tiene que leer lo mismo que se ve acá: lo que falta guardar se guarda antes de enviar.
        if (core.dirty && !(await core.save(false))) throw Object.assign(new Error('unsaved'), { code: core.cloudState === 'error' ? 'offline' : 'unsaved' });
        const c = await LMD.cloud.comment(mine.path, quote, text);
        if (pop === box) closePop();
        if (cur !== mine) return;
        if (!mine.items.some((x) => x.id === c.id)) mine.items.push(c);
        draw(); if (dlg) drawList();
        core.flash(T('Comentario enviado'));
      } catch (e) {
        if (e && e.code === 'mcp_needs_plan') { closePop(); needsPlan(); } else fail(say(e));
      }
    };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-cm]'); if (!b) return; if (b.dataset.cm === 'send') send(); else closePop(); });
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    area.focus({ preventScroll: true });
  }

  async function remove(id) {
    const mine = cur;
    try { await LMD.cloud.uncomment(id); } catch (e) { core.flash(say(e), 'error'); return; }
    if (cur !== mine) return;
    mine.items = mine.items.filter((c) => c.id !== id);
    draw(); if (dlg) drawList();
    core.flash(T('Comentario borrado'));
  }

  // Al tocar una marca: el o los comentarios de ese bloque.
  function view(mark) {
    const box = openPop(mark, 'view', T('Comentarios para la IA'),
      mark._list.map((c) => '<div class="lmd-cm-item"><p class="lmd-cm-text">' + esc(c.text) + '</p>' +
        '<div class="lmd-cm-meta"><small>' + esc(when(c.created)) + '</small>' + (solver() ? '<button type="button" class="lmd-link" data-cm="ai" data-id="' + c.id + '">' + T('Resolver con mi IA') + '</button>' : '') + '<button type="button" class="lmd-link" data-cm="rm" data-id="' + c.id + '">' + T('Borrar') + '</button></div></div>').join('') +
      '<div class="lmd-cm-foot"><button type="button" class="lmd-link" data-cm="all">' + T('Ver todos') + '</button></div>', true);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cm]'); if (!b) return;
      if (b.dataset.cm === 'rm') remove(+b.dataset.id);
      else if (b.dataset.cm === 'ai') {
        const c = mark._list.find((x) => x.id === +b.dataset.id); const fn = solver(); const block = mark._block;
        closePop();
        // Si la propuesta reemplaza al bloque, el comentario ya está atendido y se borra.
        if (c && fn) fn({ block, text: c.text, quote: c.quote, done: () => remove(c.id) });
      } else list();
    });
  }

  // ---------- La lista de la nota ----------
  function drawList() {
    const body = dlg.querySelector('.lmd-cm-list');
    const open = opened(); const done = cur.items.filter((c) => c.status !== 'open').sort((a, b) => (b.done || 0) - (a.done || 0));
    const item = (c) => '<li class="lmd-cm-item' + (c.status === 'open' ? '' : ' lmd-cm-done') + '">' +
      (!c.quote ? '' : c.block ? '<button type="button" class="lmd-cm-quote" data-cm="go" data-id="' + c.id + '" title="' + T('Ir a esa parte de la nota') + '">' + esc(c.quote) + '</button>' : '<blockquote class="lmd-cm-quote">' + esc(c.quote) + '</blockquote>') +
      '<p class="lmd-cm-text">' + esc(c.text) + '</p>' +
      (c.status === 'open' ? '' : '<p class="lmd-cm-reply"><b>' + T('Respuesta de la IA') + '</b>' + esc(c.reply || '') + '</p>') +
      '<div class="lmd-cm-meta"><small>' + (c.status === 'open' ? esc(when(c.created)) + (c.quote && !c.block ? ' · ' + T('Ese texto ya no está en la nota') : '') : T('Resuelto el {a}', { a: esc(when(c.done || c.created)) })) + '</small>' +
        '<button type="button" class="lmd-link" data-cm="rm" data-id="' + c.id + '">' + T('Borrar') + '</button></div></li>';
    const group = (name, rows) => (rows.length ? '<h4>' + T(name) + ' <small>' + rows.length + '</small></h4><ul>' + rows.map(item).join('') + '</ul>' : '');
    body.innerHTML = cur.items.length ? group('Abiertos', open) + group('Resueltos', done) : '<p class="lmd-cm-none">' + T('Todavía no hay comentarios en esta nota.') + '</p>';
  }
  function closeList() { if (dlg) { dlg.remove(); dlg = null; } }
  function list() {
    const m = mode(); if (!m) return;
    if (m === 'vault') { LMD.vault.explain(); return; }
    closePop(); closeList();
    const title = T('Comentarios para la IA');
    dlg = el('div', { class: 'lmd-ask' });
    dlg.innerHTML = '<div class="lmd-ask-card lmd-cm-card" role="dialog" aria-label="' + title + '"><h3>' + title + '</h3>' +
      '<p class="lmd-hint">' + T('La IA conectada los lee cuando le pedís que revise los comentarios.') + '</p>' +
      '<div class="lmd-cm-list"></div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-cm="close">' + T('Cerrar') + '</button></div></div>';
    document.body.appendChild(dlg);
    drawList();
    load();
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cm]');
      if (e.target === dlg || (b && b.dataset.cm === 'close')) { closeList(); return; }
      if (!b) return;
      if (b.dataset.cm === 'rm') { remove(+b.dataset.id); return; }
      const c = cur.items.find((x) => x.id === +b.dataset.id); const block = c && c.block;
      closeList();
      if (!block || !block.isConnected) return;
      block.scrollIntoView({ block: 'center', behavior: 'smooth' });
      block.classList.add('lmd-cm-here'); setTimeout(() => block.classList.remove('lmd-cm-here'), 1600);
    });
  }

  // ---------- Carga y eventos en vivo ----------
  // Trae abiertos y resueltos. Si uno que estaba abierto vuelve resuelto, lo dice.
  async function load() {
    const mine = cur; if (!mine || mode() !== 'on') return;
    let rows;
    try { rows = await LMD.cloud.comments(mine.path, true); } catch (e) { return; }
    if (cur !== mine) return;
    const was = new Set(mine.items.filter((c) => c.status === 'open').map((c) => c.id));
    const solved = rows.filter((c) => c.status !== 'open' && was.has(c.id)).length;
    mine.items = rows;
    draw(); if (dlg) drawList();
    if (solved) core.flash(solved > 1 ? T('La IA resolvió {n} comentarios', { n: solved }) : T('La IA resolvió un comentario'));
  }
  const onEvent = (ev) => (ev && ev.type === 'comments' ? load() : Promise.resolve());

  // Empieza a seguir los comentarios de una nota. Solo en notas propias de la nube; en cualquier otra no hace nada.
  function attach(path) {
    detach();
    const root = core.appRoot;
    if (!root || root.kind !== 'cloud' || !path || LMD.cloud.split(path).owner) return Promise.resolve();
    const mine = cur = { path, items: [], vault: !!LMD.vault.of(path) };
    return LMD.sync.me().then(() => (cur === mine ? load() : null));
  }
  // Suelta todo lo de la nota en curso: marcas, cuadros abiertos y la lista en memoria.
  function detach() {
    closePop(); closeList();
    cur = null;
    if (layer) layer.textContent = '';
  }

  function init(c) {
    core = c;
    layer = el('div', { class: 'lmd-cm-layer' });
    core.ui.main.appendChild(layer);
    layer.addEventListener('click', (e) => { const b = e.target.closest('.lmd-cm-mark'); if (b) view(b); });
    core.hooks.render.push(draw);
    // Las marcas siguen a su bloque cuando cambia el alto de la página (imágenes, diagramas, ancho de la barra).
    if (window.ResizeObserver) new ResizeObserver(place).observe(core.ui.article);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', (e) => {
      if (!pop || pop.contains(e.target) || e.target.closest('.lmd-cm-mark')) return;
      // Con algo escrito no se cierra por un clic afuera: se cierra con Cancelar o Escape.
      const area = pop.querySelector('textarea');
      if (!area || !area.value.trim()) closePop();
    });
    window.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (pop) closePop(); else if (dlg) closeList(); });
  }

  LMD.comments = { init, attach, detach, onEvent, mode, compose, list, count: () => (mode() === 'on' ? opened().length : 0), textOf, solvers: SOLVERS };
})();
