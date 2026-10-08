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
    [/^#{1,4}$/, (m) => 'h' + m[0].length], [/^[-*+]$/, () => 'ul'], [/^\d{1,9}[.)]$/, () => 'ol'],
    [/^>$/, () => 'quote'], [/^(\[\s?\]|[-*+]\s\[\s?\])$/, () => 'task'],
  ];
  const ITEM_RE = /^((?:\s{0,3}>\s?)*\s*)([-*+]|\d{1,9}[.)])(\s+|$)(\[[ xX]\](?:\s+|$))?/;

  const fm = () => core.fmOffset;
  const lines = () => core.srcLines;
  const blank = (i) => i < 0 || i >= lines().length || lines()[i].trim() === '';

  // Hijo directo del documento que contiene al nodo.
  function topBlock(node) {
    let n = node;
    while (n && n.parentNode !== core.ui.article) n = n.parentNode;
    return n || null;
  }
  // Dónde sigue lo que se escribe: dentro de una sección desplegable, un bloque nuevo queda adentro de ella.
  const HOST = 'details.lmd-box[data-l]';
  const isHost = (n) => !!n && (n === core.ui.article || (n.nodeType === 1 && n.matches(HOST)));
  function hostBlock(node) {
    let n = node;
    while (n && !isHost(n.parentNode)) n = n.parentNode;
    return n || null;
  }
  const shown = (node) => { if (node && LMD.fold) LMD.fold.reveal(node); };

  // Líneas del fuente que ocupa un bloque, sin los renglones vacíos del final.
  function span(block) {
    if (!block || block.nodeType !== 1) return null;
    const r = core.rangeOf(block) || (block.querySelector('[data-l]') && core.rangeOf(block.querySelector('[data-l]')));
    if (!r) return null;
    const s = r[0] + fm(); let e = r[1] + fm();
    // El rango de un recuadro (::: … :::) termina antes de la línea que lo cierra: esa línea también es suya.
    if (block.matches('.lmd-box[data-l]') && /^\s*:{3,}\s*$/.test(lines()[e] || '')) e++;
    else while (e - 1 > s && blank(e - 1)) e--;
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
    d.dataset.kind = kind; delete d.dataset.mark;
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
    [near(-1), near(1)].forEach((line) => { const m = /^\s{0,3}([-*+])\s+(\[[ xX]\](?:\s+|$))?/.exec(line); if (m && !!m[2] !== (kind === 'task')) taken.add(m[1]); });
    return ['-', '*', '+'].find((c) => !taken.has(c)) + ' ' + (kind === 'task' ? '[ ] ' : '');
  }

  const draftText = (d) => inlineMd(d).replace(/\n+$/, '').trim();

  // Escribe en el archivo las líneas del borrador, o las reescribe si ya estaban (d._syn guarda dónde quedaron).
  // No toca el borrador en pantalla. Devuelve en qué línea quedó el bloque y de qué tipo es.
  function place(d, text) {
    let kind = d.dataset.kind || 'p'; let at; let body; const owners = [];
    if (d._li) {
      const r = core.rangeOf(d._li);
      const s = r[0] + fm(); at = r[1] + fm();
      while (at - 1 > s && blank(at - 1)) at--;
      const m = ITEM_RE.exec(lines()[s] || '') || ['', '', '-', ' ', ''];
      const marker = /\d/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].slice(-1) : m[2];
      // Las listas y los ítems que contienen al nuevo, que crecen con él (sangrado con Tab, cuelga del de arriba).
      const item = d.parentNode;
      for (let n = item && item.isConnected ? item.parentNode : d._li.parentNode; n && n !== core.ui.article; n = n.parentNode) owners.push(n);
      // Un ítem que se sangró antes de escribirlo nace como primer hijo del de arriba (lists.js arma su marca).
      const child = d._child && LMD.lists ? LMD.lists.childMark(lines()[s] || '') : '';
      const lead = child ? child.replace(/\[ \] $/, '') : m[1] + marker + (m[3] || ' ');
      body = [lead + (m[4] ? (d.dataset.done ? '[x] ' : '[ ] ') : '') + text.replace(/\n/g, ' ')];
      kind = 'item';
    } else {
      at = lineAfter(d._anchor);
      // Dentro de una sección desplegable, lo que se escribe justo antes de la línea que la cierra es de ella.
      for (let n = d.parentNode; n && n !== core.ui.article; n = n.parentNode) if (n.nodeType === 1 && n.matches(HOST)) owners.push(n);
      // Una tarea dictada como hecha (dictate.js) nace tildada.
      const prefix = kind === 'ul' || kind === 'task' ? listPrefix(kind, at).replace('[ ]', d.dataset.done ? '[x]' : '[ ]') : kind === 'ol' && d.dataset.mark ? d.dataset.mark + ' ' : (KINDS[kind] || '');
      const parts = text.split('\n');
      if (kind === 'p') body = parts.map((p, i) => p.trim() + (i < parts.length - 1 ? '\\' : ''));
      else if (kind === 'quote') body = parts.map((p) => '> ' + p.trim());
      else body = [prefix + parts.join(' ').trim()];
    }
    const y = d._syn;
    if (y) {
      if (y.text !== text) { core.replaceLines(y.at, y.at + y.n, y.fix(body)); y.n = body.length; y.text = text; if (d._li) core.tidyList(y.at); }
      return { at: y.at, kind };
    }
    const out = d._li ? body : padded(at, body);
    core.insertLines(at, out, owners);
    // Un ítem en el medio de una lista numerada: los que siguen se renumeran, en el mismo paso de deshacer.
    if (d._li) core.tidyList(at);
    const pre = out[0] === '' && body[0] !== '' ? 1 : 0;
    // El marcador de un ítem se decidió mirando las líneas de al lado antes de escribirlo: al reescribir se mantiene.
    const lead = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)/.exec(body[0]);
    const fix = (b) => (lead && kind !== 'p' && kind !== 'quote' ? [b[0].replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)/, lead[1])].concat(b.slice(1)) : b);
    d._syn = { s: at, at: at + pre, n: body.length, post: out.length - pre - body.length, text, fix };
    return { at: at + pre, kind };
  }

  // Saca del archivo lo que el borrador había escrito, con los renglones en blanco que sumó.
  function unplace(d) {
    const y = d._syn; if (!y) return;
    d._syn = null;
    core.replaceLines(y.s, y.at + y.n + y.post, []);
    if (d._li) core.tidyList(y.s);
  }

  // Tab o Shift+Tab en un ítem nuevo que todavía no tiene texto (no está en el archivo): cambia de nivel en pantalla
  // y, al escribirse, nace ahí. dir > 0 lo cuelga del ítem de arriba; dir < 0 lo saca un nivel.
  function nest(d, dir) {
    const item = d.parentNode; const list = item && item.parentNode;
    if (!d._li || d._syn || !list || !item.classList.contains('lmd-draft-li')) return false;
    const isList = (n) => !!n && (n.tagName === 'UL' || n.tagName === 'OL');
    let to; let child = false; let host = null;
    if (dir > 0) {
      const prev = item.previousElementSibling; if (!prev || prev.tagName !== 'LI' || !core.rangeOf(prev)) return false;
      // Si el de arriba ya tiene una sublista al final, el nuevo se suma a ella; si no, abre una.
      const sub = isList(prev.lastElementChild) ? prev.lastElementChild : null; const last = sub && sub.lastElementChild;
      if (last && core.rangeOf(last)) { to = last; host = sub; }
      else { to = prev; child = true; host = el(list.tagName.toLowerCase()); host.className = list.className.replace(/\blmd-cl\b/, '').trim(); if (!host.className) host.removeAttribute('class'); prev.appendChild(host); }
    } else {
      const up = list.parentNode; if (!up || up.tagName !== 'LI' || !core.rangeOf(up)) return false;
      to = up;
    }
    // Mover el ítem le saca el foco: mientras tanto no cuenta como un borrador que se abandona.
    d._done = true;
    if (host) host.appendChild(item); else { to.after(item); if (!list.children.length) list.remove(); }
    d._li = to; d._child = child;
    const task = to.classList.contains('lmd-task-item'); const box = item.querySelector(':scope > input.lmd-task');
    item.classList.toggle('lmd-task-item', task);
    if (task && !box) item.insertBefore(el('input', { type: 'checkbox', class: 'lmd-task', disabled: '' }), d); else if (!task && box) box.remove();
    d._done = false;
    caretTo(d, true);
    return true;
  }

  // Lo escrito en un borrador pasa al archivo tras una pausa, sin cerrarlo ni redibujar: el foco sigue ahí.
  function syncDraft(d) {
    if (d._done || !d.isConnected) return;
    const text = draftText(d);
    if (text) place(d, text); else unplace(d);
  }

  function discard(d) {
    d._done = true;
    unplace(d);
    (d._li ? d.parentNode : d).remove();
  }

  // Pasa el borrador al archivo. Con follow se redibuja y queda abierto el bloque siguiente para seguir escribiendo.
  function commitDraft(d, follow) {
    if (d._done) return;
    const text = draftText(d);
    if (!text) {
      const li = d._li; const anchor = d._anchor;
      // Enter en un renglón vacío dentro de una sección desplegable sale de ella, como de una lista.
      const box = !li && d.parentNode && d.parentNode !== core.ui.article && isHost(d.parentNode) ? d.parentNode : null;
      discard(d);
      if (follow && box) { openDraft(box, 'p'); return; }
      // Enter en un ítem vacío sale de la lista.
      // El párrafo va justo después de ese ítem, aunque la lista siga más abajo.
      // Si era el último de una lista suelta en el documento, el párrafo se abre ya afuera, donde va a quedar.
      if (follow && li) { const list = li.parentNode; openDraft(list && isHost(list.parentNode) && !li.nextElementSibling ? list : li, 'p'); }
      else if (follow) openDraft(anchor, 'p');
      return;
    }
    d._done = true;
    const { at, kind } = place(d, text);
    if (follow === 'stay') {
      // Hace falta ya el bloque definitivo (por ejemplo, para ponerle un enlace): se redibuja y se lo devuelve.
      core.render();
      const made = blockAtLine(at);
      return made && (made.matches('.lmd-editable') ? made : made.querySelector('.lmd-editable'));
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
    shown(made);
    if (kind === 'item' || kind === 'ul' || kind === 'ol' || kind === 'task') {
      const li = made.tagName === 'LI' ? made : made.querySelector('li');
      if (li) openItemDraft(li);
    } else openDraft(hostBlock(made), 'p');
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
    const d = li ? openItemDraft(li) : openDraft(hostBlock(node), 'p');
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
      // Una lista numerada arranca en el número que se escribió ("3. " empieza en 3).
      if (hit) { d.textContent = ''; setKind(d, to(hit)); if (d.dataset.kind === 'ol') d.dataset.mark = hit[0]; return; }
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
  // Dos tablas con un solo renglón en blanco en el medio se leen como una: la de abajo queda como filas de la de
  // arriba, con su línea de guiones a la vista. Con dos renglones en blanco quedan separadas, acá y en GitHub.
  // put cambia líneas como spliceLines y, si el cambio deja dos tablas pegadas, suma ese renglón en el mismo paso
  // (un solo Ctrl+Z). Devuelve cómo quedó corrida cada línea.
  const RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  // Con tag, además, dos listas que el cambio dejó pegadas siguen siendo dos (lists.js: una cambia de marca).
  // tag(was) recibe de qué lista era cada línea y devuelve lo mismo para body: { g: orígenes, m: cuáles se movieron }.
  function put(s, count, body, tag) {
    const all = lines(); let next = all.slice(0, s).concat(body, all.slice(s + count));
    if (tag && LMD.lists && LMD.lists.apart) {
      const was = LMD.lists.origins(all, fm()); const t = tag(was);
      const moved = new Set(); t.m.forEach((x, i) => { if (x) moved.add(s + i); });
      next = LMD.lists.apart(next, fm(), was.slice(0, s).concat(t.g, was.slice(s + count)), (i) => moved.has(i)) || next;
    }
    const from = Math.max(fm(), s - 3); const to = Math.min(next.length, s + body.length + 3); const added = [];
    for (let i = to - 3; i > from; i--) {
      if (next[i].trim() === '' && next[i - 1].includes('|') && next[i + 1].includes('|') && next[i + 2].includes('|') && RULE.test(next[i + 2])) { next.splice(i, 0, ''); added.push(i); }
    }
    let a = 0; while (a < all.length && a < next.length && all[a] === next[a]) a++;
    let b = 0; while (b < all.length - a && b < next.length - a && all[all.length - 1 - b] === next[next.length - 1 - b]) b++;
    core.spliceLines(a, all.length - a - b, next.slice(a, next.length - b));
    return (line) => line + added.filter((i) => i < line).length;
  }

  function insertTemplate(after, body, then) {
    const at = lineAfter(after);
    const out = padded(at, body);
    const moved = put(at, 0, out);
    core.render();
    const made = blockAtLine(moved(at + (out[0] === '' && body[0] !== '' ? 1 : 0)));
    shown(made);
    if (made && then) then(hostBlock(made) || made, made);
  }

  const TEMPLATES = {
    table: { body: () => ['| ' + T('Columna') + ' 1 | ' + T('Columna') + ' 2 |', '| --- | --- |', '|  |  |'], then: (top) => { const c = top.querySelector('th'); if (c) { c.focus(); getSelection().selectAllChildren(c); } } },
    code: { body: () => ['```', '', '```'], then: (top) => core.editCode(top) },
    diagram: { body: () => ['```mermaid', 'graph LR', '  A[' + T('Inicio') + '] --> B[' + T('Fin') + ']', '```'], then: (top) => { core.tools().then((ok) => { if (ok) LMD.diagram.edit(top.matches('.lmd-diagram, pre.lmd-mermaid') ? top : top.querySelector('.lmd-diagram, pre.lmd-mermaid')); }); } },
    alert: { body: () => ['> [!NOTE]', '> ' + T('Texto del aviso')], then: (top) => { const p = top.querySelector('.lmd-editable'); if (p) { p.focus(); getSelection().selectAllChildren(p); } } },
    // Una sección desplegable. Dentro de otra, la de afuera pasa a llevar más dos puntos (fold.js).
    details: { before: (after) => { if (LMD.fold) LMD.fold.widen(after); }, body: () => ['::: details ' + T('Detalles'), T('Texto de la sección'), ':::'], then: (top, made) => { if (LMD.fold) LMD.fold.inserted(made); } },
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
    if (what === 'link') {
      // Sin un texto elegido, el enlace va en un renglón propio debajo del bloque.
      LMD.links.dialog(null).then((link) => { if (link) insertTemplate(after, [LMD.links.md(link)]); });
      return;
    }
    // Una fórmula no se inserta con un ejemplo: abre su editor, y recién se escribe al aplicar.
    if (what === 'math') { core.tools().then((ok) => { if (ok) LMD.formula.create(after); }); return; }
    const t = TEMPLATES[what];
    // Lo que haya que acomodar antes (before) y lo insertado se deshacen juntos.
    if (t) core.oneUndo(() => { if (t.before) t.before(after); insertTemplate(after, t.body(), t.then); });
  }

  function removeBlock(block) {
    const r = span(block); if (!r) return;
    let s = r.s; let n = r.e - r.s;
    if (blank(s - 1) && blank(r.e)) { if (r.e < lines().length) n++; else if (s > fm()) { s--; n++; } }
    put(s, n, [], () => ({ g: [], m: [] }));
    core.render();
    core.flash(T('Bloque eliminado. Ctrl+Z lo deshace'));
  }

  function duplicate(block) {
    const r = span(block); if (!r) return;
    const body = [''].concat(lines().slice(r.s, r.e), blank(r.e) ? [] : ['']);
    put(r.e, 0, body, () => ({ g: body.map(() => -1), m: body.map(() => true) }));
    core.render();
  }

  function move(block, dir) {
    let other = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
    while (other && !span(other)) other = dir < 0 ? other.previousElementSibling : other.nextElementSibling;
    const a = span(dir < 0 ? other : block); const b = span(dir < 0 ? block : other);
    if (!a || !b) return;
    const first = lines().slice(a.s, a.e); const gap = lines().slice(a.e, b.s); const second = lines().slice(b.s, b.e);
    const cut = (was, x, y, on) => ({ g: was.slice(x, y), m: was.slice(x, y).map(() => on) });
    const shifted = put(a.s, b.e - a.s, second.concat(gap, first), (was) => {
      const one = cut(was, b.s, b.e, dir < 0); const mid = cut(was, a.e, b.s, false); const two = cut(was, a.s, a.e, dir > 0);
      return { g: one.g.concat(mid.g, two.g), m: one.m.concat(mid.m, two.m) };
    });
    core.render();
    const at = shifted(dir < 0 ? a.s : a.s + second.length + gap.length);
    const moved = blockAtLine(at);
    shown(moved);
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
    ['board', 'Tablero'], ['alert', 'Aviso'], ['details', 'Sección desplegable'], ['image', 'Imagen'], ['link', 'Enlace'], ['hr', 'Separador'],
  ];
  // Lo que suman las herramientas al menú de edición: cada una devuelve una lista de
  // [dónde ('insert' o 'block'), id, ícono, texto, qué hacer].
  const EDIT_MENU = [];
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu(x, y, block, draft) {
    closeMenu();
    const plain = block && /^(P|H[1-6])$/.test(block.tagName) && span(block);
    // Lo elegido dentro del bloque es lo que se cita al comentar; sin nada elegido, el bloque.
    const sel = getSelection();
    const picked = block && sel.rangeCount && !sel.isCollapsed && block.contains(sel.anchorNode) && block.contains(sel.focusNode) ? sel.toString().trim() : '';
    const extra = []; EDIT_MENU.forEach((fn) => { (fn({ block, draft, picked, x, y }) || []).forEach((it) => extra.push(it)); });
    const more = (where) => extra.filter((it) => it[0] === where).map((it) => '<button type="button" role="menuitem" class="lmd-menu-wide" data-extra="' + it[1] + '">' + it[2] + '<span>' + T(it[3]) + '</span></button>').join('');
    menu = el('div', { class: 'lmd-menu', role: 'menu' });
    menu.innerHTML =
      '<p class="lmd-menu-label">' + T(block ? 'Insertar debajo' : 'Insertar') + '</p>' +
      '<div class="lmd-menu-grid">' + INSERTS.filter((i) => (i[0] !== 'math' || core.settings.plugins.katex) && (i[0] !== 'board' || LMD.tools.isOn('kanban')) && (i[0] !== 'details' || core.settings.plugins.containers)).map((i) => '<button type="button" role="menuitem" data-ins="' + i[0] + '">' + (ICON['b_' + i[0]] || '') + '<span>' + T(i[1]) + '</span></button>').join('') + more('insert') + '</div>' +
      (block && !draft && span(block) ?
        (plain ? '<p class="lmd-menu-label">' + T('Convertir en') + '</p><div class="lmd-menu-grid">' +
          [['p', 'Párrafo'], ['h1', 'Título 1'], ['h2', 'Título 2'], ['h3', 'Título 3']].map((i) => '<button type="button" role="menuitem" data-conv="' + i[0] + '">' + ICON['b_' + i[0]] + '<span>' + T(i[1]) + '</span></button>').join('') + '</div>' : '') +
        '<p class="lmd-menu-label">' + T('Este bloque') + '</p><div class="lmd-menu-grid">' +
          '<button type="button" role="menuitem" data-op="up">' + ICON.up + '<span>' + T('Subir') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="down">' + ICON.download + '<span>' + T('Bajar') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="dup">' + ICON.copy + '<span>' + T('Duplicar') + '</span></button>' +
          '<button type="button" role="menuitem" data-op="del" class="lmd-menu-danger">' + ICON.trash + '<span>' + T('Eliminar') + '</span></button>' +
          (LMD.comments.mode() ? '<button type="button" role="menuitem" data-op="comment" class="lmd-menu-wide">' + ICON.comment + '<span>' + T('Comentar para la IA') + '</span></button>' : '') + more('block') +
        '</div>' : '');
    document.body.appendChild(menu);
    const w = menu.offsetWidth; const h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y)) + 'px';
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      const ext = b.dataset.extra && extra.find((it) => it[1] === b.dataset.extra);
      if (ext) { if (draft) discard(draft); ext[4](); return; }
      if (b.dataset.ins) insert(b.dataset.ins, block, draft);
      else if (b.dataset.conv) convert(block, b.dataset.conv);
      else if (b.dataset.op === 'del') removeBlock(block);
      else if (b.dataset.op === 'dup') duplicate(block);
      else if (b.dataset.op === 'comment') LMD.comments.compose(block, picked);
      else move(block, b.dataset.op === 'up' ? -1 : 1);
    });
  }

  // ---------- Menú de lectura ----------
  // Leyendo, el clic derecho no pasa a edición: ofrece copiar, buscar o editar según haya texto elegido o no.
  // En una nota de solo lectura no aparece lo que edita.
  const READ_MENU = [];
  function openReadMenu(e) {
    closeMenu();
    const article = core.ui.article; const x = e.clientX; const y = e.clientY;
    const sel = getSelection();
    // Lo elegido cuenta solo si el clic cayó encima: una selección que quedó en otra parte no cambia el menú.
    const over = sel.rangeCount && !sel.isCollapsed && article.contains(sel.anchorNode) &&
      Array.from(sel.getRangeAt(0).getClientRects()).some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
    const picked = over ? sel.toString().trim() : '';
    const block = e.target === article ? blockNear(y) : topBlock(e.target);
    const lines_ = block && span(block);
    const h = e.target.closest('h1, h2, h3, h4, h5, h6'); const head = h && core.links.headings().find((k) => k.el === h);
    const can = !core.readOnly; const at = { target: e.target, clientX: x, clientY: y };
    const items = [];
    if (picked) { items.push(['copy', ICON.copy, 'Copiar'], ['find', ICON.search, 'Buscar en la carpeta']); if (can) items.push(['edit', ICON.pencil, 'Editar acá']); }
    else {
      if (can) items.push(['edit', ICON.pencil, 'Editar acá']);
      if (lines_) items.push(['block', ICON.copy, 'Copiar el bloque']);
      if (head) items.push(['anchor', ICON.link, 'Copiar el enlace a esta sección']);
      if (can) items.push(['insert', ICON.plus, 'Insertar debajo']);
    }
    if (block && lines_ && LMD.comments.mode()) items.push(['comment', ICON.comment, 'Comentar para la IA']);
    // Lo que suman las herramientas: cada una devuelve [id, ícono, texto, qué hacer] o nada.
    READ_MENU.forEach((fn) => { const it = fn({ block, picked, target: e.target }); if (it) items.push(it); });
    if (!items.length) return false;
    menu = el('div', { class: 'lmd-menu lmd-menu-read', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' + items.map((i) => '<button type="button" role="menuitem" data-read="' + i[0] + '">' + i[1] + '<span>' + T(i[2]) + '</span></button>').join('') + '</div>';
    document.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, x)) + 'px';
    // Si abajo no entra, se abre hacia arriba: no tiene que tapar lo que se acaba de elegir.
    menu.style.top = Math.max(8, y + menu.offsetHeight + 8 > window.innerHeight ? y - menu.offsetHeight - 12 : y) + 'px';
    menu.addEventListener('mousedown', (ev) => ev.preventDefault()); // lo elegido tiene que seguir elegido
    menu.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      closeMenu();
      const act = b.dataset.read; const extra = items.find((i) => i[0] === act && i[3]);
      if (extra) extra[3]();
      else if (act === 'copy') core.copy(picked);
      else if (act === 'find') core.searchFor(picked.replace(/\s+/g, ' ').slice(0, 80));
      else if (act === 'block') core.copy(lines().slice(lines_.s, lines_.e).join('\n'));
      else if (act === 'anchor') core.copy(core.sectionLink(head.gh));
      else if (act === 'edit') core.editAt(at);
      else if (act === 'comment') LMD.comments.compose(block, picked);
      else {
        // Pasa a edición y abre, sobre ese mismo bloque, el menú de insertar de siempre.
        const i = block ? Array.prototype.indexOf.call(article.children, block) : -1;
        await core.setEditMode(true);
        if (!core.editMode) return;
        const found = i < 0 ? null : article.children[i];
        openMenu(x, y, found && !found.classList.contains('lmd-add') ? found : blockNear(y));
      }
    });
    return true;
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

  // ---------- Listas de tareas ----------
  // Una lista donde todos los elementos llevan casilla es una lista para tildar. En el archivo sigue siendo una
  // lista de tareas común; en la app gana un contador, un renglón para agregar siempre a mano, una manija para
  // reordenar, y dos acciones: pasar los hechos abajo y quitarlos (con deshacer).
  const clItems = (list) => Array.from(list.children).filter((li) => li.tagName === 'LI' && !li.classList.contains('lmd-draft-li'));
  const clLists = () => Array.from(core.ui.article.querySelectorAll(':scope > ul.lmd-task-list')).filter((list) => { const it = clItems(list); return it.length > 0 && it.every((li) => li.classList.contains('lmd-task-item')); });
  const clDone = (li) => { const b = li.querySelector('input.lmd-task'); return !!(b && b.checked); };
  // Ocultar las hechas es solo de la vista: el archivo no cambia, y copiar, exportar e imprimir llevan la lista entera.
  // Se recuerda por nota mientras dure la sesión, por el lugar que ocupa la lista entre las listas de tareas.
  const clKey = () => 'lmd-cl-hide:' + location.pathname + location.search;
  const clHidden = () => { try { const v = JSON.parse(sessionStorage.getItem(clKey()) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  function clHide(at, on) {
    const now = clHidden().filter((i) => i !== at); if (on) now.push(at);
    try { if (now.length) sessionStorage.setItem(clKey(), JSON.stringify(now)); else sessionStorage.removeItem(clKey()); } catch (e) { /* sin almacenamiento: vale hasta redibujar */ }
  }
  function checklists() {
    const article = core.ui.article;
    article.querySelectorAll('.lmd-cl-bar, .lmd-cl-add, .lmd-cl-grip').forEach((n) => n.remove());
    article.querySelectorAll('.lmd-cl').forEach((n) => n.classList.remove('lmd-cl'));
    if (core.readOnly || !core.blocks) return;
    const hidden = clHidden();
    clLists().forEach((list, at) => {
      const items = clItems(list); const done = items.map(clDone); const n = done.filter(Boolean).length;
      list.classList.add('lmd-cl');
      // El contador recién dice algo con tres tareas o más: en una nota llena de listas de una sola tarea es ruido.
      // Sin contador, la barra no ocupa renglón: sus acciones quedan arriba a la derecha de la lista.
      const counted = items.length >= 3; const hiding = counted && n > 0 && hidden.includes(at);
      const bar = el('div', { class: 'lmd-cl-bar' + (counted ? '' : ' lmd-cl-bare') + (hiding ? ' lmd-cl-hiding' : ''), contenteditable: 'false' });
      if (counted) bar.appendChild(el('span', { class: 'lmd-cl-count', text: hiding ? (items.length - n === 1 ? T('Queda 1') : T('Quedan {a}', { a: items.length - n })) + ' · ' + (n === 1 ? T('1 oculta') : T('{a} ocultas', { a: n })) : T('{a} de {b} hechas', { a: n, b: items.length }) }));
      // Lo único a la vista al lado del contador: ocultar las hechas, que no borra nada.
      if (counted && n) bar.appendChild(el('button', { type: 'button', class: 'lmd-cl-toggle', 'data-cl': 'hide', 'aria-pressed': String(hiding), text: T(hiding ? 'Mostrar hechas' : 'Ocultar hechas') }));
      // Mover y quitar los hechos cambian la nota: van en el menú de la lista, y quitar pide confirmar.
      if (n) bar.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-cl-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: T('Más acciones'), 'aria-label': T('Más acciones') }, ICON.more));
      if (bar.firstChild) list.before(bar);
      items.forEach((li) => li.insertBefore(el('button', { type: 'button', class: 'lmd-cl-grip', contenteditable: 'false', title: T('Mover el elemento'), 'aria-label': T('Mover el elemento') }, ICON.dots), li.firstChild));
      list.after(el('button', { type: 'button', class: 'lmd-cl-add', contenteditable: 'false', text: '+ ' + T('Agregar elemento') }));
    });
  }
  // Los renglones de cada elemento, con sus sublistas. En una lista con renglones en blanco, vuelven a separarse así.
  function clChunks(list) {
    const items = clItems(list); const starts = items.map((li) => { const r = core.rangeOf(li); return r ? r[0] + fm() : -1; });
    const whole = core.rangeOf(list);
    if (!items.length || !whole || starts.some((s, i) => s < 0 || (i && s <= starts[i - 1]))) return null;
    let end = whole[1] + fm(); const last = starts[starts.length - 1];
    while (end - 1 > last && blank(end - 1)) end--;
    let loose = false;
    const chunks = starts.map((s, i) => { const c = lines().slice(s, i + 1 < starts.length ? starts[i + 1] : end); while (c.length > 1 && !c[c.length - 1].trim()) { c.pop(); loose = true; } return c; });
    return { start: starts[0], end, chunks, loose, items };
  }
  // Reescribe la lista con sus elementos en otro orden, o sin algunos. Es un solo cambio: un solo Ctrl+Z.
  function clWrite(c, order) {
    const body = [];
    order.forEach((i, n) => { if (n && c.loose) body.push(''); c.chunks[i].forEach((l) => body.push(l)); });
    core.replaceLines(c.start, c.end, body);
    core.render();
  }
  const clSettle = () => { const a = document.activeElement; if (a && a.blur && a.isContentEditable) a.blur(); };
  let clToast = null;
  function clSay(text, then) {
    if (clToast) clToast.remove();
    const t = el('div', { class: 'lmd-cl-toast', role: 'status' }); clToast = t;
    const undo = el('button', { type: 'button', class: 'lmd-link', text: T('Deshacer') });
    undo.addEventListener('click', () => { t.remove(); if (clToast === t) clToast = null; core.undo(); if (then) then(); });
    t.append(el('span', { text }), undo);
    document.body.appendChild(t);
    setTimeout(() => { t.remove(); if (clToast === t) clToast = null; }, 12000);
  }
  async function clAct(list, what) {
    clSettle();
    if (what !== 'sink') {
      // Borra de la nota: se pregunta antes. La lista se vuelve a buscar por si la nota se redibujó mientras tanto.
      const at = clLists().indexOf(list); const n = clItems(list).filter(clDone).length; if (at < 0 || !n) return;
      const ok = await LMD.dialog.confirm({ title: n === 1 ? T('¿Quitar 1 elemento hecho?') : T('¿Quitar {n} elementos hechos?', { n }), text: T('Se borran de la nota. Se puede deshacer.'), ok: T('Quitar'), danger: true });
      list = clLists()[at]; if (!ok || !list) return;
    }
    const c = clChunks(list); if (!c) return;
    const done = c.items.map(clDone); const all = c.chunks.map((_, i) => i);
    if (what === 'sink') clWrite(c, all.filter((i) => !done[i]).concat(all.filter((i) => done[i])));
    else { const n = done.filter(Boolean).length; if (!n) return; clWrite(c, all.filter((i) => !done[i])); clSay(T('Hechos quitados: {a}', { a: n })); }
  }
  // El menú de la lista, detrás de "⋯": las dos acciones. Se recorre con las flechas, Escape lo cierra y devuelve el foco.
  let clMenu = null;
  function clMenuClose(focus) {
    if (!clMenu) return;
    const m = clMenu; clMenu = null; m.box.remove();
    if (m.btn.isConnected) { m.btn.setAttribute('aria-expanded', 'false'); if (focus) m.btn.focus(); }
  }
  function clMenuOpen(btn) {
    if (clMenu && clMenu.btn === btn) { clMenuClose(true); return; }
    clMenuClose(); closeMenu();
    const list = btn.parentNode.nextElementSibling; if (!list || !list.classList.contains('lmd-cl')) return;
    const done = clItems(list).map(clDone);
    const box = el('div', { class: 'lmd-menu lmd-menu-narrow lmd-cl-menu', role: 'menu', 'aria-label': T('Más acciones') });
    const rows = el('div', { class: 'lmd-menu-list' });
    const sink = el('button', { type: 'button', role: 'menuitem', 'data-cl': 'sink', text: T('Mover los hechos abajo') });
    sink.disabled = !(done.indexOf(true) >= 0 && done.lastIndexOf(false) > done.indexOf(true));
    rows.append(sink, el('button', { type: 'button', role: 'menuitem', class: 'lmd-menu-danger', 'data-cl': 'clear', text: T('Quitar los hechos') + '…' }));
    box.appendChild(rows); document.body.appendChild(box);
    const at = btn.getBoundingClientRect(); const w = box.offsetWidth; const h = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8)) + 'px';
    box.style.top = (at.bottom + h + 12 > window.innerHeight && at.top - h - 6 > 0 ? at.top - h - 6 : at.bottom + 6) + 'px';
    clMenu = { box, btn }; btn.setAttribute('aria-expanded', 'true');
    const items = () => Array.from(box.querySelectorAll('button:not(:disabled)'));
    items()[0].focus();
    box.addEventListener('keydown', (e) => {
      const all = items(); const i = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clMenuClose(true); }
      else if (e.key === 'Tab') { e.preventDefault(); clMenuClose(true); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); all[e.key === 'Home' ? 0 : all.length - 1].focus(); }
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cl]'); if (!b || b.disabled) return;
      clMenuClose(true); clAct(list, b.dataset.cl);
    });
  }
  // Pasa un elemento de un lugar a otro de su lista. Devuelve la lista ya redibujada.
  function clMove(list, from, to) {
    const at = clLists().indexOf(list); const c = clChunks(list);
    if (!c || from < 0 || to < 0 || to >= c.chunks.length || from === to) return null;
    const order = c.chunks.map((_, i) => i); order.splice(to, 0, order.splice(from, 1)[0]);
    clWrite(c, order);
    return clLists()[at] || null;
  }
  // El renglón de agregar: abre un elemento nuevo al final. Enter lo agrega y deja el cursor en el siguiente.
  async function clAdd(btn) {
    const at = clLists().indexOf(btn.previousElementSibling); if (at < 0) return;
    clSettle();
    if (!core.editMode) { await core.setEditMode(true); if (!core.editMode) return; }
    const list = clLists()[at]; if (!list) return;
    const items = clItems(list); const d = openItemDraft(items[items.length - 1]);
    d.dataset.ph = T('Agregar elemento');
  }
  function clBind(article) {
    article.addEventListener('click', (e) => {
      const t = e.target; if (!t.closest) return;
      const add = t.closest('.lmd-cl-add'); const act = t.closest('.lmd-cl-bar [data-cl]'); const more = t.closest('.lmd-cl-more');
      if (add) { e.preventDefault(); clAdd(add); }
      else if (more) { e.preventDefault(); clMenuOpen(more); }
      else if (act) {
        e.preventDefault(); const list = act.parentNode.nextElementSibling; if (!list || !list.classList.contains('lmd-cl')) return;
        // Ocultar o mostrar las hechas no toca la nota: se redibuja la barra y el foco queda en el mismo control.
        if (act.dataset.cl === 'hide') { const at = clLists().indexOf(list); clHide(at, act.getAttribute('aria-pressed') !== 'true'); checklists(); const again = clLists()[at]; const b = again && again.previousElementSibling && again.previousElementSibling.querySelector('[data-cl=hide]'); if (b) b.focus(); }
        else clAct(list, act.dataset.cl);
      }
    });
    // Tildar no redibuja la nota: el contador se pone al día solo.
    article.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('input.lmd-task')) setTimeout(checklists, 0); });
    // La manija: se arrastra con el mouse o con el dedo, y con el foco puesto se mueve con las flechas.
    let drag = null;
    const mark = (list, to) => { clItems(list).forEach((li, i) => li.classList.toggle('lmd-cl-before', i === to)); list.classList.toggle('lmd-cl-end', to === clItems(list).length); };
    article.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest && e.target.closest('.lmd-cl-grip'); if (!grip || e.button > 0) return;
      e.preventDefault(); clSettle();
      const li = grip.closest('li'); drag = { li, list: li.parentNode, id: e.pointerId, to: -1, y: e.clientY, grip };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* el puntero ya no está */ }
    });
    article.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.to < 0 && Math.abs(e.clientY - drag.y) < 6) return;
      const items = clItems(drag.list); let to = items.length;
      for (let i = 0; i < items.length; i++) { const b = items[i].getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { to = i; break; } }
      drag.to = to; drag.li.classList.add('lmd-cl-moving'); mark(drag.list, to);
    });
    const drop = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; d.li.classList.remove('lmd-cl-moving'); mark(d.list, -1);
      if (e.type !== 'pointerup' || d.to < 0) return;
      const from = clItems(d.list).indexOf(d.li); clMove(d.list, from, d.to > from ? d.to - 1 : d.to);
    };
    article.addEventListener('pointerup', drop); article.addEventListener('pointercancel', drop);
    article.addEventListener('keydown', (e) => {
      const grip = e.target.classList && e.target.classList.contains('lmd-cl-grip') ? e.target : null;
      if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault(); e.stopPropagation();
      const li = grip.closest('li'); const from = clItems(li.parentNode).indexOf(li); const to = from + (e.key === 'ArrowUp' ? -1 : 1);
      const list = clMove(li.parentNode, from, to); const again = list && clItems(list)[to];
      if (again) again.querySelector('.lmd-cl-grip').focus();
    });
  }

  function init(c) {
    core = c;
    const article = core.ui.article;
    clBind(article); core.hooks.render.push(checklists);
    article.addEventListener('contextmenu', (e) => {
      // Con Shift queda el menú del navegador, que es el que corrige la ortografía.
      if (!core.blocks || e.shiftKey || e.target.closest('.lmd-src')) return;
      if (!core.editMode) {
        // Leyendo sale el menú de lectura. Sobre un enlace o una imagen queda el del navegador.
        if (e.target.closest('a, img')) return;
        if (openReadMenu(e)) e.preventDefault();
        return;
      }
      // Con el dedo, mantener apretado mientras se edita es elegir texto: el menú de bloques sale de la manija.
      if (LMD.touch.touched()) return;
      e.preventDefault();
      const active = document.activeElement;
      if (active && active.blur && active.isContentEditable) active.blur();
      const block = e.target === article ? blockNear(e.clientY) : topBlock(e.target);
      openMenu(e.clientX, e.clientY, block && block.isConnected ? block : blockNear(e.clientY));
    });
    article.addEventListener('input', (e) => {
      // El título de una sección desplegable es texto sin formato: ahí los asteriscos quedan como se escriben.
      if (e.inputType === 'insertText' && e.target.closest && e.target.closest('.lmd-editable') && !e.target.closest('.lmd-sum-title')) inlineShortcut();
      const d = e.target.closest && e.target.closest('.lmd-draft'); if (d) onInput(d);
    });
    article.addEventListener('click', (e) => {
      if (e.target.closest('.lmd-add')) { const all = Array.from(article.children).filter((n) => !n.classList.contains('lmd-add')); openDraft(all[all.length - 1] || null, 'p', true); }
    });
    document.addEventListener('mousedown', (e) => {
      if (menu && !menu.contains(e.target)) closeMenu();
      if (clMenu && !clMenu.box.contains(e.target) && !clMenu.btn.contains(e.target)) clMenuClose();
    });
    // Un bloque en el que se escribió tiene su propio deshacer, el del navegador: ahí Ctrl+Z no es el de la app.
    const typed = new WeakSet();
    document.addEventListener('input', (e) => { const t = e.target; if (t && t.isContentEditable) typed.add(t); }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeMenu(); clMenuClose(); }
      const key = String(e.key || '').toLowerCase();
      const back = key === 'z' && !e.shiftKey; const again = key === 'y' || (key === 'z' && e.shiftKey);
      if (!LMD.mod(e) || e.altKey || e.defaultPrevented || !(back || again)) return;
      const t = e.target;
      // Un campo de texto y una ventana abierta deshacen lo suyo.
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t && t.closest && t.closest('[aria-modal="true"], .lmd-ask')) return;
      const has = back ? core.canUndo() : core.canRedo();
      // En un bloque sin nada escrito el navegador no tiene qué deshacer: vale el de la app, si tiene algo.
      if (t && t.isContentEditable && (typed.has(t) || !has)) return;
      // Leyendo también se deshace (tildar, mover o quitar tareas se hace sin entrar a editar), pero solo si hay qué.
      if (!core.editMode && (!has || core.readOnly || core.rawMode)) return;
      e.preventDefault();
      if (back) core.flash(core.undo() ? T('Cambio deshecho. Ctrl+Y lo rehace') : T('No hay más cambios para deshacer'));
      else core.flash(core.redo() ? T('Cambio rehecho') : T('No hay cambios para rehacer'));
    });
    window.addEventListener('scroll', () => { closeMenu(); clMenuClose(); }, { passive: true });
    // Manija: al pasar el mouse por un bloque aparece a su izquierda y abre el mismo menú que el clic derecho.
    const handle = el('button', { class: 'lmd-handle', type: 'button', title: T('Opciones del bloque: mover, duplicar, eliminar'), hidden: '' }, ICON.dots);
    document.body.appendChild(handle);
    let held = null; let hideTimer = null;
    const hideHandle = () => { handle.hidden = true; held = null; };
    const place = (block) => {
      const box = block.getBoundingClientRect();
      handle.style.top = Math.max(58, box.top + 1) + 'px';
      handle.style.left = Math.max(4, box.left - 34) + 'px';
      handle.hidden = false;
    };
    const hold = (target) => {
      if (!core.editMode || !core.blocks || menu) return;
      const block = target === article ? null : topBlock(target);
      if (!block || block === held || block.classList.contains('lmd-add') || block.classList.contains('lmd-draft') || !span(block)) return;
      clearTimeout(hideTimer);
      held = block;
      place(block);
    };
    article.addEventListener('mousemove', (e) => hold(e.target));
    // Con el dedo no hay mouse que pase por encima: la manija queda en el bloque que se tocó o en el que tiene el cursor.
    const touch = () => LMD.touch.coarse();
    article.addEventListener('click', (e) => { if (touch()) hold(e.target); });
    article.addEventListener('focusin', (e) => { if (touch()) hold(e.target); });
    article.addEventListener('mouseleave', () => { if (touch()) return; hideTimer = setTimeout(() => { if (!handle.matches(':hover')) hideHandle(); }, 250); });
    handle.addEventListener('mouseleave', () => { if (touch()) return; hideTimer = setTimeout(() => { if (!article.matches(':hover')) hideHandle(); }, 250); });
    handle.addEventListener('mousedown', (e) => e.preventDefault());
    handle.addEventListener('click', () => {
      if (!held || !held.isConnected) return;
      const active = document.activeElement;
      if (active && active.blur && active.isContentEditable) active.blur();
      const box = handle.getBoundingClientRect(); const block = held;
      hideHandle();
      openMenu(box.right + 6, box.top, block);
    });
    // Al mover la página con el dedo la manija acompaña a su bloque mientras siga a la vista; con mouse se esconde.
    window.addEventListener('scroll', () => {
      const box = held && touch() && held.isConnected ? held.getBoundingClientRect() : null;
      if (box && box.bottom > 70 && box.top < window.innerHeight - 40) place(held); else hideHandle();
    }, { passive: true });
    core.hooks.render.push(() => {
      hideHandle();
      // Tras redibujar, sigue en el bloque donde quedó el cursor.
      const a = document.activeElement;
      if (touch() && a && a.isContentEditable && article.contains(a)) hold(a);
    });

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

  // Una tarea oculta a la que lleva el buscador o un ancla se muestra: su lista deja de ocultar las hechas.
  function clReveal(node) {
    const from = node && (node.nodeType === 1 ? node : node.parentElement); const list = from && from.closest && from.closest('ul.lmd-cl');
    const bar = list && list.previousElementSibling;
    if (!bar || !bar.classList.contains('lmd-cl-hiding') || from.offsetParent) return;
    clHide(clLists().indexOf(list), false); checklists();
  }

  LMD.write = {
    init, enter, onKey, append, closeMenu, nest, say: clSay, reveal: clReveal,
    remove: (node) => { const b = topBlock(node); if (b) removeBlock(b); },
    blur: (d) => commitDraft(d, false),
    sync: syncDraft,
    put: (after, body, then) => insertTemplate(after, body, then),
    // Para las herramientas que escriben por su cuenta (el dictado): abrir un bloque nuevo, cambiarle el tipo, descartarlo.
    open: (after, kind) => openDraft(after, kind), kind: setKind, discard, top: topBlock, readMenu: READ_MENU, editMenu: EDIT_MENU,
    // Para las herramientas que proponen texto (el asistente de IA): las líneas de un bloque, dónde va lo que sigue,
    // y cambiar líneas con los renglones en blanco que hagan falta.
    span, after: (block) => (block ? lineAfter(block) : lines().length), pad: padded, near: blockNear,
    splice: (s, count, body) => { const moved = put(s, count, body); core.render(); return moved; },
    drop: (d) => { d._done = true; unplace(d); },
    settle: (d) => commitDraft(d, 'stay') || null,
    // En una sesión en vivo otra persona cambió líneas más arriba: lo que cada borrador ya escribió en el archivo
    // (d._syn) se corre con ellas. move(línea) dice cuánto se corrió esa línea.
    shift: (move) => core.ui.article.querySelectorAll('.lmd-draft').forEach((d) => { const y = d._syn; if (y) { const s = move(y.s); const at = move(y.at); y.s += s; y.at += at; } }),
    // Y si se cambió el bloque del que colgaba un borrador, pasa a colgar del que quedó en su lugar.
    reanchor: () => core.ui.article.querySelectorAll('.lmd-draft').forEach((d) => {
      const lost = (n) => n && !n.isConnected;
      if (lost(d._anchor)) { let p = d.previousElementSibling; while (p && p.matches('.lmd-draft, .lmd-add, .lmd-front')) p = p.previousElementSibling; d._anchor = p || null; }
      if (lost(d._li)) { const item = d.closest('li'); const p = item && item.previousElementSibling; if (p) d._li = p; }
    }),
    menuAt: (x, y) => openMenu(x, y, core.lastBlock && core.lastBlock.isConnected ? topBlock(core.lastBlock) : blockNear(window.innerHeight)),
  };
})();
