// Tableros (kanban) y cuentas en tablas.
// Un tablero es un bloque ```kanban con títulos como columnas y tareas como tarjetas: en cualquier otro
// programa se lee como una lista común. Una celda con =sum, =avg, =min, =max, =count o =median se
// muestra con el resultado de su columna.
//
// Cada tarjeta puede llevar al final un grupo entre llaves con sus atributos:
//   - [ ] Fix checkout {due=2026-10-20 owner="Ana Paz" id=c8k2m9xq created=2026-10-07T14:03:11Z updated=2026-10-07T15:10:02Z}
// id, created y updated los pone la app (el id no cambia nunca; updated, al mover o editar la tarjeta). El resto son
// atributos de la persona: clave=valor, con comillas si el valor tiene espacios. Antes de la primera columna, un
// renglón solo con llaves configura el tablero: qué atributos se ven en las tarjetas y de qué tipo es cada uno.
//   {show=due,owner priority=low|medium|high estimate=number due=date}
// Un tablero sin nada de esto se abre igual, y recibe id y fechas la primera vez que se edita. Lo que no se
// entiende queda como texto de la tarjeta. El servidor lee el mismo formato (server/server.mjs, kbParse).
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // ---------- Tablero: el formato ----------
  const KEY = /^[\p{L}_][\p{L}\p{N}_.-]{0,39}$/u;
  const RESERVED = ['id', 'created', 'updated', 'show'];
  const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
  const newId = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); let s = ''; b.forEach((x) => { s += ALPHA[x % 32]; }); return s; };
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  function pairsOf(inner) {
    const re = /\s*([\p{L}_][\p{L}\p{N}_.-]{0,39})=(?:"((?:[^"\\]|\\.)*)"|([^\s"]*))(?=\s|$)/uy; const out = []; let at = 0; let m;
    while ((m = re.exec(inner))) { out.push([m[1], m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]]); at = re.lastIndex; }
    return out.length && !inner.slice(at).trim() ? out : null;
  }
  function splitCard(raw) {
    const m = /^(.*\S)\s*\{([^{}]*)\}\s*$/.exec(raw); const pairs = m && pairsOf(m[2]);
    return pairs ? { text: m[1].trim(), pairs } : { text: raw, pairs: [] };
  }
  const val = (v) => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return /^[^\s"{}=\\]+$/.test(v) ? v : '"' + v.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; };
  const typeOf = (v) => (/^(text|date|number)$/.test(v) ? { type: v } : { type: 'select', options: v.split('|').map((s) => s.trim()).filter(Boolean) });

  // { show: [claves a la vista], fields: { clave: { type, options } }, columns: [{ title, cards: [{ id, text, done, created, updated, attrs }] }] }
  function parse(text) {
    const board = { show: [], fields: {}, columns: [] }; let cur = null;
    String(text).split(/\r?\n/).forEach((line) => {
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (h) { cur = { title: h[1].trim(), cards: [] }; board.columns.push(cur); return; }
      const c = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
      if (!c) {
        const cfg = !cur && /^\s*\{([^{}]*)\}\s*$/.exec(line); const pairs = cfg && pairsOf(cfg[1]);
        if (pairs) pairs.forEach(([k, v]) => { if (k === 'show') board.show = v.split(',').map((s) => s.trim()).filter(Boolean); else if (!RESERVED.includes(k)) board.fields[k] = typeOf(v); });
        return;
      }
      if (!c[2].trim()) return;
      if (!cur) { cur = { title: T('Por hacer'), cards: [] }; board.columns.push(cur); }
      const s = splitCard(c[2].trim()); const card = { id: '', text: s.text, done: !!c[1] && c[1] !== ' ', created: '', updated: '', attrs: {} };
      s.pairs.forEach(([k, v]) => { if (k === 'id') card.id = v; else if (k === 'created') card.created = v; else if (k === 'updated') card.updated = v; else if (k !== 'show') card.attrs[k] = v; });
      cur.cards.push(card);
    });
    return board;
  }

  function cardLine(card) {
    const pairs = Object.keys(card.attrs).map((k) => k + '=' + val(card.attrs[k]));
    if (card.id) pairs.push('id=' + val(card.id)); if (card.created) pairs.push('created=' + val(card.created)); if (card.updated) pairs.push('updated=' + val(card.updated));
    return '- [' + (card.done ? 'x' : ' ') + '] ' + card.text.replace(/\s*\n\s*/g, ' ').trim() + (pairs.length ? ' {' + pairs.join(' ') + '}' : '');
  }
  function serialize(board) {
    const out = []; const cfg = [];
    if (board.show.length) cfg.push('show=' + val(board.show.join(',')));
    Object.keys(board.fields).forEach((k) => { const f = board.fields[k]; cfg.push(k + '=' + val(f.type === 'select' ? f.options.join('|') : f.type)); });
    if (cfg.length) out.push('{' + cfg.join(' ') + '}');
    board.columns.forEach((col, i) => {
      if (i) out.push('');
      out.push('## ' + (col.title.trim() || T('Columna')));
      col.cards.forEach((card) => { if (card.text.trim()) out.push(cardLine(card)); });
    });
    return out;
  }
  // Las tarjetas que todavía no tienen id lo reciben, con su fecha de creación.
  function stamp(board, at) { board.columns.forEach((col) => col.cards.forEach((c) => { if (!c.id) { c.id = newId(); if (!c.created) c.created = at || nowIso(); } })); }
  const freshCard = (text) => { const at = nowIso(); return { id: newId(), text, done: false, created: at, updated: at, attrs: {} }; };
  const touch = (card) => { card.updated = nowIso(); };

  // De qué tipo es un atributo: el que declara el tablero o, si no, el que sugiere su valor.
  const fieldOf = (model, k, v) => model.fields[k] || (/^\d{4}-\d\d-\d\d$/.test(v || '') ? { type: 'date' } : { type: 'text' });
  const locale = () => (LMD.lang() === 'en' ? 'en-US' : 'es-AR');
  const dayText = (v) => { const d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }); };
  const stampText = (v) => { const d = new Date(v); return isNaN(d) ? v : d.toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const label = (k) => k.charAt(0).toUpperCase() + k.slice(1).replace(/[-_.]+/g, ' ');

  // Reescribe el bloque en el archivo y redibuja. focus: [columna, tarjeta] a dejar en edición.
  function write(board, focus) {
    const r = core.rangeOf(board); if (!r) return;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset;
    const start = r[0];
    stamp(board._model);
    core.spliceLines(s + 1, e - s - 2, serialize(board._model));
    core.render();
    if (!focus) return;
    const again = core.ui.article.querySelector('.lmd-board[data-l^="' + start + '-"]');
    const target = again && again.querySelector('.lmd-col[data-c="' + focus[0] + '"] .lmd-card[data-k="' + focus[1] + '"] .lmd-card-text');
    if (target) startEdit(target);
  }

  function startEdit(span) {
    span.textContent = span.dataset.raw || '';
    span.contentEditable = 'plaintext-only';
    span.focus();
    const sel = getSelection(); sel.selectAllChildren(span); sel.collapseToEnd();
  }

  // Lo que la tarjeta muestra en chico: los atributos que el tablero eligió, si la tarjeta los tiene.
  function chips(model, card) {
    const box = el('div', { class: 'lmd-card-meta' });
    model.show.forEach((k) => {
      const v = card.attrs[k]; if (v == null || v === '') return;
      const f = fieldOf(model, k, v); const date = f.type === 'date' && /^\d{4}-\d\d-\d\d$/.test(v);
      box.appendChild(el('span', { class: 'lmd-chip' + (date && !card.done && v < today() ? ' lmd-chip-late' : ''), 'data-attr': k, title: label(k), text: date ? dayText(v) : v }));
    });
    return box.childNodes.length ? box : null;
  }

  function build(pre) {
    const board = el('div', { class: 'lmd-board' });
    if (pre.hasAttribute('data-l')) board.setAttribute('data-l', pre.getAttribute('data-l'));
    const model = parse(pre.textContent); const cols = model.columns;
    board._model = model; board._cols = cols;
    cols.forEach((col, ci) => {
      const box = el('div', { class: 'lmd-col', 'data-c': ci });
      const head = el('div', { class: 'lmd-col-head' });
      const title = el('span', { class: 'lmd-col-title', text: col.title });
      head.append(title, el('span', { class: 'lmd-col-n', text: String(col.cards.length) }),
        el('button', { type: 'button', class: 'lmd-col-del lmd-board-edit', title: T('Eliminar la columna') }, ICON.close));
      const list = el('div', { class: 'lmd-cards' });
      col.cards.forEach((card, ki) => {
        const item = el('div', { class: 'lmd-card' + (card.done ? ' lmd-card-done' : ''), draggable: 'true', 'data-k': ki });
        if (card.id) item.dataset.id = card.id;
        const check = el('input', { type: 'checkbox', class: 'lmd-card-check' }); check.checked = card.done;
        const text = el('span', { class: 'lmd-card-text' }); text.dataset.raw = card.text; text.innerHTML = core.inline(card.text);
        const main = el('div', { class: 'lmd-card-main' }); main.appendChild(text);
        const meta = chips(model, card); if (meta) main.appendChild(meta);
        item.append(check, main, el('button', { type: 'button', class: 'lmd-card-open', title: T('Abrir la tarjeta'), 'aria-label': T('Abrir la tarjeta') }, ICON.dots),
          el('button', { type: 'button', class: 'lmd-card-del lmd-board-edit', title: T('Eliminar la tarjeta') }, ICON.close));
        list.appendChild(item);
      });
      box.append(head, list, el('button', { type: 'button', class: 'lmd-card-add lmd-board-edit', text: '+ ' + T('Tarjeta') }));
      board.appendChild(box);
    });
    const end = el('div', { class: 'lmd-board-end' });
    end.append(el('button', { type: 'button', class: 'lmd-col-add lmd-board-edit', text: '+ ' + T('Columna') }),
      el('button', { type: 'button', class: 'lmd-board-menu', title: T('Opciones del tablero'), 'aria-label': T('Opciones del tablero'), 'aria-haspopup': 'menu' }, ICON.dots));
    board.appendChild(end);
    pre.replaceWith(board);
  }

  const where = (node) => {
    const board = node.closest('.lmd-board'); const col = node.closest('.lmd-col'); const card = node.closest('.lmd-card');
    return { board, ci: col ? +col.dataset.c : -1, ki: card ? +card.dataset.k : -1 };
  };

  // ---------- El tablero entra en la página ----------
  // Un tablero con varias columnas es más ancho que el texto: se sale de la columna de lectura y usa el ancho que
  // tenga el área de la nota, sin mover el resto. Si aun así no entra, se desliza de costado, y los bordes se
  // desvanecen del lado donde hay más.
  function edges(board) {
    const more = board.scrollWidth - board.clientWidth;
    board.classList.toggle('lmd-more-l', more > 1 && board.scrollLeft > 2);
    board.classList.toggle('lmd-more-r', more > 1 && board.scrollLeft < more - 2);
  }
  function fit(board) {
    board.style.width = ''; board.style.marginLeft = '';
    const host = core.ui.article.parentElement; const own = board.getBoundingClientRect();
    const extra = board.scrollWidth - board.clientWidth;
    if (host && extra > 1 && own.width > 0) {
      const box = host.getBoundingClientRect(); const gutter = LMD.touch.small() ? 12 : 20;
      const left = Math.max(0, own.left - box.left - gutter); const right = Math.max(0, box.right - own.right - gutter);
      const grow = Math.min(extra, left + right);
      if (grow > 1) { const l = Math.min(left, Math.max(grow / 2, grow - right)); board.style.width = Math.floor(own.width + grow) + 'px'; board.style.marginLeft = -Math.floor(l) + 'px'; }
    }
    edges(board);
  }
  const fitAll = () => { if (core) core.ui.article.querySelectorAll('.lmd-board').forEach(fit); };

  // ---------- El detalle de una tarjeta ----------
  // Sugerencias para el primer atributo: la clave queda escrita en la nota, en el idioma de quien la crea.
  const SUGGEST = [['vence', 'date'], ['responsable', 'text'], ['prioridad', 'select'], ['etiqueta', 'text'], ['enlace', 'text']];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyFrom = (name) => String(name || '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '').replace(/^[^\p{L}_]+/u, '').slice(0, 40);
  function openCard(board, ci, ki) {
    const model = board._model; const card = model.columns[ci].cards[ki]; if (!card) return;
    const ro = !!core.readOnly;
    // Se trabaja sobre una copia: Cancelar no deja nada cambiado.
    const draft = { attrs: Object.assign({}, card.attrs), show: model.show.slice(), fields: JSON.parse(JSON.stringify(model.fields)) };
    const box = el('div', { class: 'lmd-ask lmd-cd' });
    const dis = ro ? ' disabled' : '';
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card lmd-cd-card" role="dialog" aria-modal="true" aria-label="' + T('Tarjeta') + '"><h3>' + T('Tarjeta') + '</h3>' +
      '<label class="lmd-dlg-field"><span>' + T('Título') + '</span><input type="text" data-cd="title" spellcheck="false" autocomplete="off"' + dis + '></label>' +
      '<div class="lmd-cd-row"><label class="lmd-dlg-field"><span>' + T('Estado (columna)') + '</span><select data-cd="col"' + dis + '>' + model.columns.map((c, i) => '<option value="' + i + '"' + (i === ci ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('') + '</select></label>' +
      '<label class="lmd-check lmd-cd-done"><input type="checkbox" data-cd="done"' + (card.done ? ' checked' : '') + dis + '><span>' + T('Hecha') + '</span></label></div>' +
      '<div class="lmd-cd-attrs"></div>' +
      (ro ? '' : '<div class="lmd-cd-sug"></div><div class="lmd-cd-new" hidden><input type="text" data-cd="name" placeholder="' + T('Nombre del atributo') + '" aria-label="' + T('Nombre del atributo') + '" spellcheck="false" autocomplete="off">' +
        '<select data-cd="type" aria-label="' + T('Tipo') + '"><option value="text">' + T('Texto') + '</option><option value="date">' + T('Fecha') + '</option><option value="number">' + T('Número') + '</option><option value="select">' + T('Lista de opciones') + '</option></select>' +
        '<input type="text" data-cd="opts" placeholder="' + T('Opciones, separadas por coma') + '" aria-label="' + T('Opciones, separadas por coma') + '" hidden><button type="button" class="lmd-btn" data-cd="add">' + T('Agregar') + '</button></div>') +
      '<p class="lmd-dlg-err" role="alert" hidden></p><p class="lmd-cd-dates"></p>' +
      '<div class="lmd-ask-actions">' + (ro ? '' : '<button type="button" class="lmd-btn lmd-cd-del" data-cd="del">' + T('Eliminar') + '</button>') +
      '<button type="button" class="lmd-btn" data-cd="no" data-esc>' + T(ro ? 'Cerrar' : 'Cancelar') + '</button>' + (ro ? '' : '<button type="button" class="lmd-btn lmd-btn-fill" data-cd="ok">' + T('Guardar') + '</button>') + '</div></div>';
    const $ = (name) => box.querySelector('[data-cd=' + name + ']');
    $('title').value = card.text;
    const dates = [card.created && T('Creada el {a}', { a: stampText(card.created) }), (card.updated || card.created) && T('Editada el {a}', { a: stampText(card.updated || card.created) })].filter(Boolean);
    box.querySelector('.lmd-cd-dates').textContent = dates.join(' · '); box.querySelector('.lmd-cd-dates').hidden = !dates.length;
    const err = box.querySelector('.lmd-dlg-err'); const fail = (text) => { err.hidden = !text; err.textContent = text || ''; };
    const drawAttrs = () => {
      const list = box.querySelector('.lmd-cd-attrs'); list.textContent = '';
      Object.keys(draft.attrs).forEach((k) => {
        const f = draft.fields[k] || fieldOf(model, k, draft.attrs[k]); const row = el('div', { class: 'lmd-cd-attr', 'data-key': k });
        let input;
        if (f.type === 'select') { input = el('select', {}); [''].concat(f.options.includes(draft.attrs[k]) || !draft.attrs[k] ? f.options : f.options.concat(draft.attrs[k])).forEach((o) => { const opt = el('option', { value: o, text: o || '—' }); if (o === draft.attrs[k]) opt.selected = true; input.appendChild(opt); }); }
        else { input = el('input', { type: f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text', spellcheck: 'false', autocomplete: 'off' }); input.value = draft.attrs[k]; if (f.type === 'number') input.step = 'any'; }
        input.setAttribute('aria-label', label(k)); input.dataset.cdVal = k; if (ro) input.disabled = true;
        const see = el('input', { type: 'checkbox', title: T('Mostrar en las tarjetas'), 'aria-label': T('Mostrar en las tarjetas') }); see.checked = draft.show.includes(k); see.dataset.cdShow = k; if (ro) see.disabled = true;
        const seeBox = el('label', { class: 'lmd-cd-see', title: T('Mostrar en las tarjetas') }); seeBox.append(see, el('span', {}, ICON.eye));
        row.append(el('span', { class: 'lmd-cd-key', text: label(k), title: k }), input, seeBox);
        if (!ro) row.appendChild(el('button', { type: 'button', class: 'lmd-cd-rm', title: T('Quitar el atributo'), 'aria-label': T('Quitar el atributo') + ': ' + label(k), 'data-cd-rm': k }, ICON.close));
        list.appendChild(row);
      });
      const sug = box.querySelector('.lmd-cd-sug'); if (!sug) return;
      const have = Object.keys(draft.attrs); const known = Object.keys(draft.fields).filter((k) => !have.includes(k));
      sug.innerHTML = '<span>' + T('Agregar') + '</span>' + known.map((k) => [k, k]).concat(SUGGEST.map((s) => [T(s[0]), s[0]]).filter((s) => !have.includes(s[0]) && !known.includes(s[0])))
        .map((s) => '<button type="button" class="lmd-chip lmd-chip-add" data-cd-sug="' + esc(s[1]) + '" data-cd-key="' + esc(s[0]) + '">' + esc(label(s[0])) + '</button>').join('') +
        '<button type="button" class="lmd-chip lmd-chip-add" data-cd="other">' + T('Otro…') + '</button>';
    };
    const addAttr = (key, type, options) => {
      if (!KEY.test(key) || RESERVED.includes(key)) { fail(T('Ese nombre no sirve: empezá con una letra, sin espacios.')); return false; }
      if (key in draft.attrs) { fail(T('La tarjeta ya tiene ese atributo.')); return false; }
      if (Object.keys(draft.attrs).length >= 30) { fail(T('Una tarjeta tiene hasta 30 atributos.')); return false; }
      fail('');
      if (!draft.fields[key] && type && type !== 'text') draft.fields[key] = type === 'select' ? { type, options: options && options.length ? options : [T('baja'), T('media'), T('alta')] } : { type };
      draft.attrs[key] = ''; if (!draft.show.includes(key)) draft.show.push(key);
      drawAttrs();
      const input = box.querySelector('[data-cd-val="' + CSS.escape(key) + '"]'); if (input) input.focus();
      return true;
    };
    drawAttrs();
    document.body.appendChild(box);
    const close = () => { box.remove(); };
    const save = () => {
      const title = $('title').value.replace(/\s+/g, ' ').trim();
      if (!title) { fail(T('Escribí un título.')); $('title').focus(); return; }
      const before = JSON.stringify([card.text, card.done, card.attrs, ci]);
      const attrs = {}; Object.keys(draft.attrs).forEach((k) => { const v = String(draft.attrs[k]).replace(/\s+/g, ' ').trim().slice(0, 500); if (v) attrs[k] = v; });
      card.text = title; card.done = $('done').checked; card.attrs = attrs;
      const to = +$('col').value;
      if (to !== ci && model.columns[to]) { model.columns[ci].cards.splice(ki, 1); model.columns[to].cards.push(card); }
      // Lo que el tablero muestra y los tipos son del tablero: quedan aunque esta tarjeta no tenga el atributo.
      model.show = draft.show.filter((k) => KEY.test(k)); model.fields = draft.fields;
      if (JSON.stringify([card.text, card.done, card.attrs, to]) !== before) touch(card);
      close(); write(board);
    };
    box.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cdVal) draft.attrs[t.dataset.cdVal] = t.value;
      else if (t.dataset.cdShow) { const k = t.dataset.cdShow; draft.show = draft.show.filter((x) => x !== k); if (t.checked) draft.show.push(k); }
      else if (t.dataset.cd === 'type') $('opts').hidden = t.value !== 'select';
    });
    box.addEventListener('click', (e) => {
      const t = e.target; const b = t.closest('[data-cd]'); const rm = t.closest('[data-cd-rm]'); const sug = t.closest('[data-cd-sug]');
      if (rm) { delete draft.attrs[rm.dataset.cdRm]; draft.show = draft.show.filter((x) => x !== rm.dataset.cdRm); drawAttrs(); return; }
      if (sug) { const s = SUGGEST.find((x) => x[0] === sug.dataset.cdSug); addAttr(sug.dataset.cdKey, s ? s[1] : (draft.fields[sug.dataset.cdKey] || {}).type); return; }
      if (!b || b.tagName !== 'BUTTON') return;
      if (b.dataset.cd === 'no') close();
      else if (b.dataset.cd === 'ok') save();
      else if (b.dataset.cd === 'other') { box.querySelector('.lmd-cd-new').hidden = false; $('name').focus(); }
      else if (b.dataset.cd === 'add') { if (addAttr(keyFrom($('name').value), $('type').value, $('opts').value.split(',').map((s) => s.trim()).filter(Boolean))) { $('name').value = ''; box.querySelector('.lmd-cd-new').hidden = true; } }
      else if (b.dataset.cd === 'del') { close(); model.columns[ci].cards.splice(ki, 1); write(board); }
    });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); if (e.target.dataset.cd === 'name' || e.target.dataset.cd === 'opts') $('add').click(); else if (!ro) save(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    if (!ro && !LMD.touch.coarse()) { $('title').focus(); $('title').select(); }
  }

  // Qué atributos se ven en las tarjetas de este tablero.
  function openShow(board) {
    const model = board._model; const keys = Array.from(new Set(model.show.concat(Object.keys(model.fields), ...model.columns.map((c) => [].concat(...c.cards.map((k) => Object.keys(k.attrs)))))));
    const box = el('div', { class: 'lmd-ask lmd-cd' });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true" aria-label="' + T('Atributos en las tarjetas') + '"><h3>' + T('Atributos en las tarjetas') + '</h3>' +
      (keys.length ? '<div class="lmd-cd-pick">' + keys.map((k) => '<label class="lmd-check"><input type="checkbox" value="' + esc(k) + '"' + (model.show.includes(k) ? ' checked' : '') + '><span>' + esc(label(k)) + '</span></label>').join('') + '</div>'
        : '<p>' + T('Todavía no hay atributos. Abrí una tarjeta para agregar el primero.') + '</p>') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-cd="no" data-esc>' + T('Cancelar') + '</button>' + (keys.length ? '<button type="button" class="lmd-btn lmd-btn-fill" data-cd="ok">' + T('Guardar') + '</button>' : '') + '</div></div>';
    document.body.appendChild(box);
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') box.remove(); });
    box.addEventListener('mousedown', (e) => { if (e.target === box) box.remove(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cd]'); if (!b) return;
      if (b.dataset.cd === 'ok') { model.show = Array.from(box.querySelectorAll('input:checked')).map((i) => i.value); box.remove(); write(board); } else box.remove();
    });
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function boardMenu(btn, board) {
    closeMenu();
    const cloud = !!core.appRoot && core.appRoot.kind === 'cloud' && core.APP;
    const items = [!core.readOnly && ['show', ICON.eye, 'Atributos en las tarjetas…'], cloud && !core.readOnly && ['notify', ICON.spark, 'Avisar cuando cambie una tarjeta…']].filter(Boolean);
    if (!items.length) return;
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow lmd-menu-board', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' + items.map((i) => '<button type="button" role="menuitem" data-bm="' + i[0] + '">' + i[1] + '<span>' + T(i[2]) + '</span></button>').join('') + '</div>';
    document.body.appendChild(menu);
    const box = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.right - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, box.bottom + 6)) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bm]'); if (!b) return;
      closeMenu();
      if (b.dataset.bm === 'show') openShow(board);
      else core.ensure('automate').then((ok) => { if (ok) LMD.automate.wizard(core, { kind: 'note', path: core.cloudPath, cards: true }); });
    });
    menu.querySelector('button').focus();
  }

  function bind(article) {
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.lmd-board-menu')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (menu && e.key === 'Escape') closeMenu(); });
    article.addEventListener('click', (e) => {
      const t = e.target; if (!t.closest || !t.closest('.lmd-board')) return;
      const w = where(t); const cols = w.board._cols;
      if (t.closest('.lmd-board-menu')) { if (menu) closeMenu(); else boardMenu(t.closest('.lmd-board-menu'), w.board); }
      else if (t.closest('.lmd-card-add')) { cols[w.ci].cards.push(freshCard(T('Tarjeta nueva'))); write(w.board, [w.ci, cols[w.ci].cards.length - 1]); }
      else if (t.closest('.lmd-col-add')) { cols.push({ title: T('Columna') + ' ' + (cols.length + 1), cards: [] }); write(w.board); }
      else if (t.closest('.lmd-card-del')) { cols[w.ci].cards.splice(w.ki, 1); write(w.board); }
      else if (t.closest('.lmd-col-del')) {
        // Una columna con tarjetas se confirma antes: se van con ella.
        const drop = () => { cols.splice(w.ci, 1); write(w.board); };
        if (!cols[w.ci].cards.length) drop();
        else LMD.dialog.confirm({ title: T('¿Eliminar la columna "{a}"?', { a: cols[w.ci].title }), text: T('Se eliminan también sus tarjetas.'), ok: T('Eliminar'), danger: true }).then((yes) => { if (yes) drop(); });
      } else if (t.closest('.lmd-card-open')) openCard(w.board, w.ci, w.ki);
      else if (core.editMode && t.closest('.lmd-card-text') && t.closest('.lmd-card-text').contentEditable !== 'plaintext-only') startEdit(t.closest('.lmd-card-text'));
      else if (core.editMode && t.closest('.lmd-col-title') && t.closest('.lmd-col-title').contentEditable !== 'plaintext-only') { const s = t.closest('.lmd-col-title'); s.contentEditable = 'plaintext-only'; s.focus(); getSelection().selectAllChildren(s); }
      // Clic en la tarjeta (fuera del casillero, de un enlace y del texto que se está escribiendo): su detalle.
      else if (t.closest('.lmd-card') && !t.closest('.lmd-card-check, a, [contenteditable="plaintext-only"]')) openCard(w.board, w.ci, w.ki);
    });
    article.addEventListener('change', (e) => {
      if (!e.target.matches || !e.target.matches('.lmd-card-check')) return;
      const w = where(e.target); const card = w.board._cols[w.ci].cards[w.ki]; card.done = e.target.checked; touch(card); write(w.board);
    });
    article.addEventListener('keydown', (e) => {
      const span = e.target.closest && e.target.closest('.lmd-card-text, .lmd-col-title');
      if (!span || span.contentEditable !== 'plaintext-only') return;
      if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); span._cancel = true; span.blur(); }
    });
    article.addEventListener('focusout', (e) => {
      const span = e.target.closest && e.target.closest('.lmd-card-text, .lmd-col-title');
      if (!span || span.contentEditable !== 'plaintext-only') return;
      const w = where(span); const cols = w.board._cols; const value = span.textContent.trim();
      if (span._cancel) { core.render(); return; }
      if (span.classList.contains('lmd-col-title')) { if (value === cols[w.ci].title) { span.contentEditable = 'false'; return; } cols[w.ci].title = value || cols[w.ci].title; }
      else if (!value) cols[w.ci].cards.splice(w.ki, 1);
      else if (value === cols[w.ci].cards[w.ki].text) { span.contentEditable = 'false'; span.innerHTML = core.inline(value); return; }
      else { cols[w.ci].cards[w.ki].text = value; touch(cols[w.ci].cards[w.ki]); }
      write(w.board);
    });

    // Arrastrar una tarjeta a otra columna o a otra posición.
    let drag = null;
    article.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.lmd-card'); if (!card) return;
      drag = where(card); card.classList.add('lmd-dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.querySelector('.lmd-card-text').textContent);
    });
    article.addEventListener('dragend', () => { drag = null; article.querySelectorAll('.lmd-dragging, .lmd-drop-here').forEach((n) => n.classList.remove('lmd-dragging', 'lmd-drop-here')); });
    article.addEventListener('dragover', (e) => {
      const col = drag && e.target.closest && e.target.closest('.lmd-col');
      if (!col || col.closest('.lmd-board') !== drag.board) return;
      e.preventDefault();
      article.querySelectorAll('.lmd-drop-here').forEach((n) => n.classList.remove('lmd-drop-here'));
      col.classList.add('lmd-drop-here');
    });
    article.addEventListener('drop', (e) => {
      const col = drag && e.target.closest && e.target.closest('.lmd-col');
      if (!col || col.closest('.lmd-board') !== drag.board) return;
      e.preventDefault();
      const cols = drag.board._cols; const to = +col.dataset.c;
      let at = cols[to].cards.length;
      for (const card of col.querySelectorAll('.lmd-card')) {
        const box = card.getBoundingClientRect();
        if (e.clientY < box.top + box.height / 2) { at = +card.dataset.k; break; }
      }
      const moved = cols[drag.ci].cards.splice(drag.ki, 1)[0];
      if (to === drag.ci && at > drag.ki) at--;
      cols[to].cards.splice(at, 0, moved);
      // Cambiar de columna es cambiar de estado: la tarjeta queda editada ahora.
      if (to !== drag.ci) touch(moved);
      const board = drag.board; drag = null;
      write(board);
    });

    // Con el mouse, el fondo del tablero se arrastra para deslizarlo de costado.
    let pan = null;
    article.addEventListener('pointerdown', (e) => {
      const board = e.pointerType === 'mouse' && e.button === 0 && e.target.closest && e.target.closest('.lmd-board');
      if (!board || e.target.closest('.lmd-card, button, input, select, a, .lmd-col-title') || board.scrollWidth <= board.clientWidth + 1) return;
      pan = { board, x: e.clientX, left: board.scrollLeft };
    });
    window.addEventListener('pointermove', (e) => { if (!pan) return; pan.board.scrollLeft = pan.left - (e.clientX - pan.x); if (Math.abs(e.clientX - pan.x) > 3) pan.board.classList.add('lmd-panning'); });
    window.addEventListener('pointerup', () => { if (pan) { pan.board.classList.remove('lmd-panning'); pan = null; } });
    article.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('lmd-board')) edges(e.target); }, true);
    let again = 0;
    window.addEventListener('resize', () => { clearTimeout(again); again = setTimeout(fitAll, 120); });
    if (window.ResizeObserver && article.parentElement) { let last = 0; new ResizeObserver(() => { const w = article.parentElement.clientWidth; if (w !== last) { last = w; clearTimeout(again); again = setTimeout(fitAll, 60); } }).observe(article.parentElement); }
  }

  // ---------- Cuentas en tablas ----------
  const FORMULAS = { sum: 'sum', suma: 'sum', total: 'sum', avg: 'avg', average: 'avg', mean: 'avg', promedio: 'avg', prom: 'avg', min: 'min', max: 'max', count: 'count', cuenta: 'count', contar: 'count', median: 'median', mediana: 'median' };
  const formulaOf = (text) => { const m = /^=\s*([a-záé]+)\s*(?:\(\s*\))?$/i.exec(String(text).trim()); return m ? FORMULAS[m[1].toLowerCase()] || null : null; };

  // "1.234,56", "1,234.56", "$ 1200", "35%" -> número. Devuelve también cómo estaba escrito.
  function parseNumber(text) {
    const raw = String(text).replace(/[*_~`]/g, '').trim();
    const m = /^([^\d\-+.,]*)([-+]?[\d.,\s]*\d)([^\d]*)$/.exec(raw);
    if (!m) return null;
    let body = m[2].replace(/\s/g, ''); let comma = false;
    const lastDot = body.lastIndexOf('.'); const lastComma = body.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) { comma = lastComma > lastDot; body = comma ? body.replace(/\./g, '').replace(',', '.') : body.replace(/,/g, ''); }
    else if (lastComma !== -1) { if (/^[-+]?\d{1,3}(,\d{3})+$/.test(body)) body = body.replace(/,/g, ''); else { comma = true; body = body.replace(',', '.'); } }
    else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(body)) { comma = true; body = body.replace(/\./g, ''); }
    const value = parseFloat(body);
    if (!isFinite(value)) return null;
    return { value, comma, prefix: m[1], suffix: m[3], decimals: (body.split('.')[1] || '').length };
  }

  function compute(kind, nums) {
    const v = nums.map((n) => n.value);
    if (kind === 'count') return v.length;
    if (!v.length) return null;
    if (kind === 'sum') return v.reduce((a, b) => a + b, 0);
    if (kind === 'avg') return v.reduce((a, b) => a + b, 0) / v.length;
    if (kind === 'min') return Math.min.apply(null, v);
    if (kind === 'max') return Math.max.apply(null, v);
    const s = v.slice().sort((a, b) => a - b); const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function format(kind, result, nums) {
    if (result == null) return '';
    if (kind === 'count') return String(result);
    const comma = nums.some((n) => n.comma);
    const most = nums.reduce((m, n) => Math.max(m, n.decimals), 0);
    const decimals = kind === 'avg' || kind === 'median' ? Math.max(most, Number.isInteger(result) ? 0 : 2) : most;
    const text = result.toLocaleString(comma ? 'es-AR' : 'en-US', { minimumFractionDigits: Math.min(decimals, 4), maximumFractionDigits: Math.min(decimals, 4) });
    const same = (key) => nums.length && nums.every((n) => n[key] === nums[0][key]) ? nums[0][key] : '';
    return same('prefix') + text + same('suffix');
  }

  // Calcula las celdas con fórmula de las tablas de un nodo. La fórmula queda en data-formula.
  function calcTables(rootNode) {
    rootNode.querySelectorAll('table').forEach((table) => {
      const body = Array.from(table.tBodies[0] ? table.tBodies[0].rows : []);
      body.forEach((tr, ri) => Array.from(tr.cells).forEach((cell, ci) => {
        const source = cell.dataset.formula || cell.textContent;
        const kind = formulaOf(source);
        if (!kind) { if (cell.dataset.formula) { delete cell.dataset.formula; cell.classList.remove('lmd-calc'); } return; }
        const nums = [];
        for (let k = 0; k < ri; k++) {
          const other = body[k].cells[ci];
          if (!other || other.dataset.formula || formulaOf(other.textContent)) continue;
          const n = parseNumber(other.textContent); if (n) nums.push(n);
        }
        cell.dataset.formula = String(source).trim();
        cell.classList.add('lmd-calc');
        cell.title = cell.dataset.formula;
        cell.textContent = format(kind, compute(kind, nums), nums);
      }));
    });
  }

  // Fila de totales para una tabla dada como grilla de textos (la primera fila es el encabezado).
  function totalsRow(grid) {
    const body = grid.slice(1);
    if (body.some((row) => row.some((c) => formulaOf(c)))) return { error: T('Esta tabla ya tiene una fila de totales') };
    const numeric = grid[0].map((_, ci) => { const vals = body.map((row) => row[ci]).filter((c) => String(c).trim()); return vals.length > 0 && vals.filter((c) => parseNumber(c)).length >= vals.length / 2; });
    if (!numeric.some(Boolean)) return { error: T('No hay columnas con números para sumar') };
    return { row: grid[0].map((_, ci) => (numeric[ci] ? '=sum' : (ci === 0 ? '**Total**' : ''))) };
  }

  function init(c) {
    core = c;
    bind(core.ui.article);
    core.hooks.render.push(() => {
      core.ui.article.querySelectorAll('pre.lmd-kanban').forEach(build);
      fitAll();
      // Con la herramienta apagada el bloque queda como código, con una línea que lleva a prenderla.
      if (LMD.tools && !LMD.tools.isOn('kanban')) core.ui.article.querySelectorAll('pre > code.language-kanban, pre > code.language-tablero, pre > code.language-board').forEach((code) => {
        const box = code.closest('.lmd-code') || code.parentNode; if (box.querySelector('.lmd-kanban-off')) return;
        const b = el('button', { type: 'button', class: 'lmd-link lmd-kanban-off', contenteditable: 'false', text: T('Prendé el Tablero kanban en Ajustes > Herramientas para verlo como tablero') });
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); core.openPanel('tools'); });
        box.appendChild(b);
      });
    });
  }

  LMD.board = { init, calcTables, totalsRow, formulaOf, fit: fitAll, model: { parse, serialize, stamp } };
})();
