// Escribir contenido nuevo: bloques que se crean con Enter, atajos de Markdown al empezar una línea,
// y el menú de clic derecho para insertar, convertir, mover, duplicar o eliminar bloques.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const { inlineMd } = LMD.serialize;
  const T = LMD.t;
  let core = null; // lo pasa el lector al iniciar

  // Tipo de bloque -> prefijo en el Markdown.
  const KINDS = { p: '', h1: '# ', h2: '## ', h3: '### ', h4: '#### ', ul: '- ', ol: '1. ', task: '- [ ] ', quote: '> ' };
  // Lo que se escribe al empezar una línea y en qué tipo la convierte.
  const SHORTCUTS = [
    [/^#{1,4}$/, (m) => 'h' + m[0].length], [/^[-*+]$/, () => 'ul'], [/^1[.)]$/, () => 'ol'],
    [/^>$/, () => 'quote'], [/^(\[\s?\]|[-*+]\s\[\s?\])$/, () => 'task'],
  ];
  const ITEM_RE = /^((?:\s{0,3}>\s?)*\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?/;

  const fm = () => core.fmOffset;
  const lines = () => core.srcLines;
  const blank = (i) => i < 0 || i >= lines().length || lines()[i].trim() === '';

  // Hijo directo del documento que contiene al nodo.
  function topBlock(node) {
    let n = node;
    while (n && n.parentNode !== core.ui.article) n = n.parentNode;
    return n || null;
  }

  // Líneas del fuente que ocupa un bloque, sin los renglones vacíos del final.
  function span(block) {
    if (!block || block.nodeType !== 1) return null;
    const r = core.rangeOf(block) || (block.querySelector('[data-l]') && core.rangeOf(block.querySelector('[data-l]')));
    if (!r) return null;
    const s = r[0] + fm(); let e = r[1] + fm();
    while (e - 1 > s && blank(e - 1)) e--;
    return { s, e };
  }

  // Línea del fuente donde va lo que se inserta después de un bloque.
  function lineAfter(block) {
    let n = block;
    while (n) { const r = span(n); if (r) return r.e; n = n.previousElementSibling; }
    return fm();
  }

  const padded = (at, body) => (blank(at - 1) || at <= fm() ? [] : ['']).concat(body, blank(at) ? [] : ['']);

  function caretTo(node, atEnd) {
    node.focus();
    const sel = getSelection(); sel.selectAllChildren(node);
    if (atEnd) sel.collapseToEnd(); else sel.collapseToStart();
  }

  function blockAtLine(abs) {
    return core.ui.article.querySelector('[data-l^="' + (abs - fm()) + '-"]');
  }

  // ---------- Borradores ----------
  // Un bloque nuevo no existe en el archivo hasta que tiene texto: mientras tanto es un borrador en pantalla.
  function setKind(d, kind) {
    d.dataset.kind = kind;
    d.className = 'lmd-editable lmd-draft lmd-draft-' + kind;
    d.dataset.ph = kind === 'p' ? T('Escribí acá, o / para insertar') : T({ h1: 'Título 1', h2: 'Título 2', h3: 'Título 3', h4: 'Título 4', ul: 'Lista', ol: 'Lista numerada', task: 'Tarea', quote: 'Cita' }[kind]);
  }

  // Con offer, la línea nueva muestra enseguida qué se puede insertar; si se escribe, queda como texto.
  function openDraft(after, kind, offer) {
    const d = el('p', { contenteditable: 'true', spellcheck: 'true' });
    setKind(d, kind || 'p');
    d._anchor = after || null;
    if (after) after.after(d);
    else {
      const front = core.ui.article.querySelector(':scope > .lmd-front');
      if (front) front.after(d); else core.ui.article.prepend(d);
    }
    caretTo(d, true);
    if (offer) { const box = d.getBoundingClientRect(); openMenu(box.left, box.bottom + 8, d._anchor, d); }
    return d;
  }

  function openItemDraft(li) {
    const item = el('li', { class: 'lmd-draft-li' });
    if (li.querySelector(':scope > input.lmd-task, :scope > .lmd-li-text > input.lmd-task') || li.classList.contains('lmd-task-item')) {
      item.classList.add('lmd-task-item');
      item.appendChild(el('input', { type: 'checkbox', class: 'lmd-task', disabled: '' }));
    }
    const d = el('span', { class: 'lmd-li-text lmd-editable lmd-draft', contenteditable: 'true', spellcheck: 'true' });
    d.dataset.ph = T('Ítem nuevo');
    d._li = li;
    item.appendChild(d); li.after(item);
    caretTo(d, true);
    return d;
  }

  function listPrefix(kind, at) {
    const near = (dir) => { for (let i = dir < 0 ? at - 1 : at; i >= 0 && i < lines().length; i += dir) if (!blank(i)) return lines()[i]; return ''; };
    const taken = new Set();
    [near(-1), near(1)].forEach((line) => { const m = /^\s{0,3}([-*+])\s+(\[[ xX]\]\s+)?/.exec(line); if (m && !!m[2] !== (kind === 'task')) taken.add(m[1]); });
    return ['-', '*', '+'].find((c) => !taken.has(c)) + ' ' + (kind === 'task' ? '[ ] ' : '');
  }

  const draftText = (d) => inlineMd(d).replace(/\n+$/, '').trim();

  function discard(d) {
    d._done = true;
    (d._li ? d.parentNode : d).remove();
  }

  // Pasa el borrador al archivo. Con follow se redibuja y queda abierto el bloque siguiente para seguir escribiendo.
  function commitDraft(d, follow) {
    if (d._done) return;
    const text = draftText(d);
    if (!text) {
      const li = d._li; const anchor = d._anchor;
      discard(d);
      // Enter en un ítem vacío sale de la lista.
      // El párrafo va justo después de ese ítem, aunque la lista siga más abajo.
      if (follow && li) openDraft(li, 'p');
      else if (follow) openDraft(anchor, 'p');
      return;
    }
    d._done = true;
    let at; let kind = d.dataset.kind || 'p';
    if (d._li) {
      const r = core.rangeOf(d._li);
      const s = r[0] + fm(); at = r[1] + fm();
      while (at - 1 > s && blank(at - 1)) at--;
      const m = ITEM_RE.exec(lines()[s] || '') || ['', '', '-', ' ', ''];
      const marker = /\d/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].slice(-1) : m[2];
      const owners = [];
      for (let n = d._li.parentNode; n && n !== core.ui.article; n = n.parentNode) owners.push(n);
      core.insertLines(at, [m[1] + marker + m[3] + (m[4] ? '[ ] ' : '') + text.replace(/\n/g, ' ')], owners);
      kind = 'item';
    } else {
      at = lineAfter(d._anchor);
      const prefix = kind === 'ul' || kind === 'task' ? listPrefix(kind, at) : (KINDS[kind] || '');
      const parts = text.split('\n');
      let body;
      if (kind === 'p') body = parts.map((p, i) => p.trim() + (i < parts.length - 1 ? '\\' : ''));
      else if (kind === 'quote') body = parts.map((p) => '> ' + p.trim());
      else body = [prefix + parts.join(' ').trim()];
      at = lineAfter(d._anchor);
      const out = padded(at, body);
      core.insertLines(at, out, []);
      at += out[0] === '' && body[0] !== '' ? 1 : 0;
    }
    if (!follow) {
      // El foco ya está en otro lado: no se redibuja ahora para no sacárselo.
      d.contentEditable = 'false'; d.classList.add('lmd-pending');
      core.softRender();
      return;
    }
    core.render();
    const made = blockAtLine(at);
    if (!made) return;
    if (kind === 'item' || kind === 'ul' || kind === 'ol' || kind === 'task') {
      const li = made.tagName === 'LI' ? made : made.querySelector('li');
      if (li) openItemDraft(li);
    } else openDraft(topBlock(made), 'p');
  }

  // Enter dentro de un bloque: lo que queda después del cursor pasa a un bloque nuevo.
  function enter(node) {
    if (node.classList.contains('lmd-draft')) { commitDraft(node, true); return; }
    const sel = getSelection();
    let tail = null;
    if (sel.rangeCount && node.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0); r.deleteContents();
      const head = document.createRange(); head.selectNodeContents(node); head.setEnd(r.startContainer, r.startOffset);
      if (head.toString().trim()) {
        const rest = document.createRange(); rest.selectNodeContents(node); rest.setStart(r.startContainer, r.startOffset);
        if (rest.toString().trim()) tail = rest.extractContents();
      }
    }
    core.commitBlock(node);
    // En una lista con renglones en blanco el texto del ítem es un párrafo adentro del <li>.
    const li = node.classList.contains('lmd-li-text') ? node.closest('li') : (node.parentNode.tagName === 'LI' ? node.parentNode : null);
    const d = li ? openItemDraft(li) : openDraft(topBlock(node), 'p');
    if (tail) { d.appendChild(tail); caretTo(d, false); }
  }

  // Formato al escribir: al cerrar **negrita**, *cursiva*, `código`, ~~tachado~~ o ==marcado== la sintaxis
  // desaparece y queda el formato. El guion bajo solo cuenta al principio de una palabra.
  const INLINE = [
    [/(\*\*|__)([^*_\s](?:[^*_]*[^*_\s])?)\1$/, 'strong'],
    [/(?<![\w*_])(\*|_)([^*_\s](?:[^*_]*[^*_\s])?)\1$/, 'em'],
    [/(`)([^`]+)`$/, 'code'],
    [/(~~)([^~]+)~~$/, 'del'],
    [/(==)([^=]+)==$/, 'mark'],
  ];
  function inlineShortcut() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || (node.parentNode.closest && node.parentNode.closest('code'))) return;
    const before = node.nodeValue.slice(0, sel.anchorOffset);
    for (const [re, tag] of INLINE) {
      const m = re.exec(before);
      if (!m) continue;
      const range = document.createRange();
      range.setStart(node, m.index); range.setEnd(node, sel.anchorOffset);
      range.deleteContents();
      const made = document.createElement(tag); made.textContent = m[2];
      // Un carácter invisible después del formato deja el cursor afuera; no se guarda en el archivo.
      const after = document.createTextNode('\u200b');
      range.insertNode(after); range.insertNode(made);
      sel.collapse(after, 1);
      return;
    }
  }

  function onInput(d) {
    if (menu && d.textContent !== '/') closeMenu();
    if (d._li || d.dataset.kind !== 'p') return;
    const text = d.textContent;
    if (text === '/') { d.textContent = ''; const box = d.getBoundingClientRect(); openMenu(box.left, box.bottom + 6, d._anchor, d); return; }
    const m = /^(.+?)[  ]$/.exec(text);
    if (!m) return;
    for (const [re, to] of SHORTCUTS) {
      const hit = re.exec(m[1]);
      if (hit) { d.textContent = ''; setKind(d, to(hit)); return; }
    }
  }

  function onKey(e, d) {
    if (e.key === 'Backspace' && !d.textContent) {
      e.preventDefault();
      if (!d._li && d.dataset.kind !== 'p') { setKind(d, 'p'); return; }
      const all = Array.from(core.ui.article.querySelectorAll('.lmd-editable:not(.lmd-pending)'));
      const prev = all[all.indexOf(d) - 1];
      discard(d);
      if (prev) caretTo(prev, true);
      return true;
    }
    return false;
  }

  // ---------- Operaciones sobre bloques ----------
  function insertTemplate(after, body, then) {
    const at = lineAfter(after);
    const out = padded(at, body);
    core.spliceLines(at, 0, out);
    core.render();
    const made = blockAtLine(at + (out[0] === '' && body[0] !== '' ? 1 : 0));
    if (made && then) then(topBlock(made) || made, made);
  }

  const TEMPLATES = {
    table: { body: () => ['| ' + T('Columna') + ' 1 | ' + T('Columna') + ' 2 |', '| --- | --- |', '|  |  |'], then: (top) => { const c = top.querySelector('th'); if (c) { c.focus(); getSelection().selectAllChildren(c); } } },
    code: { body: () => ['```', '', '```'], then: (top) => core.editCode(top) },
    diagram: { body: () => ['```mermaid', 'graph LR', '  A[' + T('Inicio') + '] --> B[' + T('Fin') + ']', '```'], then: (top) => { if (LMD.diagram) LMD.diagram.edit(top.matches('.lmd-diagram, pre.lmd-mermaid') ? top : top.querySelector('.lmd-diagram, pre.lmd-mermaid')); } },
    math: { body: () => ['$$', 'E = mc^2', '$$'] },
    alert: { body: () => ['> [!NOTE]', '> ' + T('Texto del aviso')], then: (top) => { const p = top.querySelector('.lmd-editable'); if (p) { p.focus(); getSelection().selectAllChildren(p); } } },
    hr: { body: () => ['---'] },
    board: { body: () => ['```kanban', '## ' + T('Por hacer'), '- [ ] ' + T('Primera tarjeta'), '', '## ' + T('En curso'), '', '## ' + T('Hecho'), '```'] },
  };

  function insert(what, after, draft) {
    if (draft) discard(draft);
    if (KINDS[what] !== undefined) { openDraft(after, what); return; }
    if (what === 'image') {
      LMD.extras.imageDialog().then((img) => { if (img) insertTemplate(after, [LMD.extras.imageMd(img)]); });
      return;
    }
    const t = TEMPLATES[what];
    if (t) insertTemplate(after, t.body(), t.then);
  }

  function removeBlock(block) {
    const r = span(block); if (!r) return;
    let s = r.s; let n = r.e - r.s;
    if (blank(s - 1) && blank(r.e)) { if (r.e < lines().length) n++; else if (s > fm()) { s--; n++; } }
    core.spliceLines(s, n, []);
    core.render();
    core.flash(T('Bloque eliminado. Ctrl+Z lo deshace'));
  }

  function duplicate(block) {
    const r = span(block); if (!r) return;
    core.spliceLines(r.e, 0, [''].concat(lines().slice(r.s, r.e), blank(r.e) ? [] : ['']));
    core.render();
  }

  function move(block, dir) {
    let other = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
    while (other && !span(other)) other = dir < 0 ? other.previousElementSibling : other.nextElementSibling;
    const a = span(dir < 0 ? other : block); const b = span(dir < 0 ? block : other);
    if (!a || !b) return;
    const first = lines().slice(a.s, a.e); const gap = lines().slice(a.e, b.s); const second = lines().slice(b.s, b.e);
    core.spliceLines(a.s, b.e - a.s, second.concat(gap, first));
    core.render();
    const at = dir < 0 ? a.s : a.s + second.length + gap.length;
    const moved = blockAtLine(at);
    if (moved) (topBlock(moved) || moved).scrollIntoView({ block: 'nearest' });
  }

  function convert(block, kind) {
    const r = span(block); if (!r) return;
    const text = lines().slice(r.s, r.e).map((l) => l.replace(/\\$/, '').trim()).join(' ').replace(/^#{1,6}\s+/, '');
    core.spliceLines(r.s, r.e - r.s, [KINDS[kind] + text]);
    core.render();
  }

  // ---------- Menú ----------
  const INSERTS = [
    ['p', 'Párrafo'], ['h1', 'Título 1'], ['h2', 'Título 2'], ['h3', 'Título 3'],
    ['ul', 'Lista con viñetas'], ['ol', 'Lista numerada'], ['task', 'Lista de tareas'], ['quote', 'Cita'],
    ['table', 'Tabla'], ['code', 'Bloque de código'], ['diagram', 'Diagrama'], ['math', 'Fórmula'],
    ['board', 'Tablero'], ['alert', 'Aviso'], ['image', 'Imagen'], ['hr', 'Separador'],
  ];
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu(x, y, block, draft) {
    closeMenu();
    const plain = block && /^(P|H[1-6])$/.test(block.tagName) && span(block);
    menu = el('div', { class: 'lmd-menu', role: 'menu' });
    menu.innerHTML =
      '<p class="lmd-menu-label">' + T(block ? 'Insertar debajo' : 'Insertar') + '</p>' +
      '<div class="lmd-menu-grid">' + INSERTS.map((i) => '<button type="button" role="menuitem" data-ins="' + i[0] + '">' + (ICON['b_' + i[0]] || '') + '<span>' + T(i[1]) + '</span></button>').join('') + '</div>' +
      (block && !draft && span(block) ?
        (plain ? '<p class="lmd-menu-label">' + T('Convertir en') + '</p><div class="lmd-menu-grid">' +
          [['p', 'Párrafo'], ['h1', 'Título 1'], ['h2', 'Título 2'], ['h3', 'Título 3']].map((i) => '<button type="button" role="menuitem" data-conv="' + i[0] + '">' + ICON['b_' + i[0]] + '<span>' + T(i[1]) + '</span></button>').join('') + '</div>' : '') +
        '<p class="lmd-menu-label">' + T('Este bloque') + '</p><div class="lmd-menu-grid">' +
          '<button type="button" role="menuitem" data-op="up">' + ICON.up + '<span>' + T('Subir') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="down">' + ICON.download + '<span>' + T('Bajar') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="dup">' + ICON.copy + '<span>' + T('Duplicar') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="del" class="lmd-menu-danger">' + ICON.trash + '<span>' + T('Eliminar') + '</span></button>' +
        '</div>' : '');
    document.body.appendChild(menu);
    const w = menu.offsetWidth; const h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y)) + 'px';
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      if (b.dataset.ins) insert(b.dataset.ins, block, draft);
      else if (b.dataset.conv) convert(block, b.dataset.conv);
      else if (b.dataset.op === 'del') removeBlock(block);
      else if (b.dataset.op === 'dup') duplicate(block);
      else move(block, b.dataset.op === 'up' ? -1 : 1);
    });
  }

  // Bloque más cercano a una altura de la pantalla, para cuando el clic cae en un espacio vacío.
  function blockNear(y) {
    let best = null;
    for (const child of core.ui.article.children) {
      if (child.classList.contains('lmd-add') || child.classList.contains('lmd-draft')) continue;
      if (child.getBoundingClientRect().top <= y) best = child; else break;
    }
    return best;
  }

  function init(c) {
    core = c;
    const article = core.ui.article;
    article.addEventListener('contextmenu', async (e) => {
      // Con Shift queda el menú del navegador, que es el que corrige la ortografía.
      if (!core.blocks || e.shiftKey || e.target.closest('.lmd-src')) return;
      if (!core.editMode) {
        // Leyendo, el clic derecho pasa a edición y abre el mismo menú sobre ese bloque.
        // En una nota de solo lectura, y sobre un enlace o una imagen, queda el menú del navegador.
        if (core.readOnly || e.target.closest('a, img')) return;
        e.preventDefault();
        const x = e.clientX; const y = e.clientY;
        const at = e.target === article ? -1 : Array.prototype.indexOf.call(article.children, topBlock(e.target));
        await core.setEditMode(true);
        if (!core.editMode) return;
        const found = at < 0 ? null : article.children[at];
        openMenu(x, y, found && !found.classList.contains('lmd-add') ? found : blockNear(y));
        return;
      }
      e.preventDefault();
      const active = document.activeElement;
      if (active && active.blur && active.isContentEditable) active.blur();
      const block = e.target === article ? blockNear(e.clientY) : topBlock(e.target);
      openMenu(e.clientX, e.clientY, block && block.isConnected ? block : blockNear(e.clientY));
    });
    article.addEventListener('input', (e) => {
      if (e.inputType === 'insertText' && e.target.closest && e.target.closest('.lmd-editable')) inlineShortcut();
      const d = e.target.closest && e.target.closest('.lmd-draft'); if (d) onInput(d);
    });
    article.addEventListener('click', (e) => {
      if (e.target.closest('.lmd-add')) { const all = Array.from(article.children).filter((n) => !n.classList.contains('lmd-add')); openDraft(all[all.length - 1] || null, 'p', true); }
    });
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const mod = e.ctrlKey || e.metaKey; const key = e.key.toLowerCase();
      if (!core.editMode || typing || !mod) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        core.flash(core.undo() ? T('Cambio deshecho. Ctrl+Y lo rehace') : T('No hay más cambios para deshacer'));
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        core.flash(core.redo() ? T('Cambio rehecho') : T('No hay cambios para rehacer'));
      }
    });
    window.addEventListener('scroll', closeMenu, { passive: true });
    // Manija: al pasar el mouse por un bloque aparece a su izquierda y abre el mismo menú que el clic derecho.
    const handle = el('button', { class: 'lmd-handle', type: 'button', title: T('Opciones del bloque: mover, duplicar, eliminar'), hidden: '' }, ICON.dots);
    document.body.appendChild(handle);
    let held = null; let hideTimer = null;
    const hideHandle = () => { handle.hidden = true; held = null; };
    article.addEventListener('mousemove', (e) => {
      if (!core.editMode || !core.blocks || menu) return;
      const block = e.target === article ? null : topBlock(e.target);
      if (!block || block === held || block.classList.contains('lmd-add') || block.classList.contains('lmd-draft') || !span(block)) return;
      clearTimeout(hideTimer);
      held = block;
      const box = block.getBoundingClientRect();
      handle.style.top = Math.max(58, box.top + 1) + 'px';
      handle.style.left = Math.max(4, box.left - 34) + 'px';
      handle.hidden = false;
    });
    article.addEventListener('mouseleave', () => { hideTimer = setTimeout(() => { if (!handle.matches(':hover')) hideHandle(); }, 250); });
    handle.addEventListener('mouseleave', () => { hideTimer = setTimeout(() => { if (!article.matches(':hover')) hideHandle(); }, 250); });
    handle.addEventListener('mousedown', (e) => e.preventDefault());
    handle.addEventListener('click', () => {
      if (!held || !held.isConnected) return;
      const active = document.activeElement;
      if (active && active.blur && active.isContentEditable) active.blur();
      const box = handle.getBoundingClientRect(); const block = held;
      hideHandle();
      openMenu(box.right + 6, box.top, block);
    });
    window.addEventListener('scroll', hideHandle, { passive: true });
    core.hooks.render.push(hideHandle);

    // En edición siempre queda un lugar al final para seguir escribiendo, también con el documento vacío.
    core.hooks.render.push(() => {
      if (!core.editMode || !core.blocks) return;
      article.appendChild(el('div', { class: 'lmd-add', role: 'button', tabindex: '0', 'data-label': T('Seguir escribiendo') }));
    });
  }

  // Agrega un bloque después del último que se tocó, o al final del documento.
  function append(body) {
    const all = Array.from(core.ui.article.children).filter((n) => !n.classList.contains('lmd-add'));
    insertTemplate(core.lastBlock && core.lastBlock.isConnected ? topBlock(core.lastBlock) : all[all.length - 1] || null, body);
  }

  LMD.write = {
    init, enter, onKey, append,
    remove: (node) => { const b = topBlock(node); if (b) removeBlock(b); },
    blur: (d) => commitDraft(d, false),
    menuAt: (x, y) => openMenu(x, y, core.lastBlock && core.lastBlock.isConnected ? topBlock(core.lastBlock) : blockNear(window.innerHeight)),
  };
})();
