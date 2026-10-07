// Tableros (kanban) y cuentas en tablas.
// Un tablero es un bloque ```kanban con títulos como columnas y tareas como tarjetas: en cualquier otro
// programa se lee como una lista común. Una celda con =sum, =avg, =min, =max, =count o =median se
// muestra con el resultado de su columna.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // ---------- Tablero ----------
  function parse(text) {
    const cols = []; let cur = null;
    text.split(/\r?\n/).forEach((line) => {
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (h) { cur = { title: h[1].trim(), cards: [] }; cols.push(cur); return; }
      const c = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
      if (!c || !c[2].trim()) return;
      if (!cur) { cur = { title: T('Por hacer'), cards: [] }; cols.push(cur); }
      cur.cards.push({ text: c[2].trim(), done: !!c[1] && c[1] !== ' ' });
    });
    return cols;
  }

  function serialize(cols) {
    const out = [];
    cols.forEach((col, i) => {
      if (i) out.push('');
      out.push('## ' + (col.title.trim() || T('Columna')));
      col.cards.forEach((card) => { if (card.text.trim()) out.push('- [' + (card.done ? 'x' : ' ') + '] ' + card.text.replace(/\s*\n\s*/g, ' ').trim()); });
    });
    return out;
  }

  // Reescribe el bloque en el archivo y redibuja. focus: [columna, tarjeta] a dejar en edición.
  function write(board, focus) {
    const r = core.rangeOf(board); if (!r) return;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset;
    const start = r[0];
    core.spliceLines(s + 1, e - s - 2, serialize(board._cols));
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

  function build(pre) {
    const board = el('div', { class: 'lmd-board' });
    if (pre.hasAttribute('data-l')) board.setAttribute('data-l', pre.getAttribute('data-l'));
    const cols = parse(pre.textContent);
    board._cols = cols;
    cols.forEach((col, ci) => {
      const box = el('div', { class: 'lmd-col', 'data-c': ci });
      const head = el('div', { class: 'lmd-col-head' });
      const title = el('span', { class: 'lmd-col-title', text: col.title });
      head.append(title, el('span', { class: 'lmd-col-n', text: String(col.cards.length) }),
        el('button', { type: 'button', class: 'lmd-col-del lmd-board-edit', title: T('Eliminar la columna') }, ICON.close));
      const list = el('div', { class: 'lmd-cards' });
      col.cards.forEach((card, ki) => {
        const item = el('div', { class: 'lmd-card' + (card.done ? ' lmd-card-done' : ''), draggable: 'true', 'data-k': ki });
        const check = el('input', { type: 'checkbox', class: 'lmd-card-check' }); check.checked = card.done;
        const text = el('span', { class: 'lmd-card-text' }); text.dataset.raw = card.text; text.innerHTML = core.inline(card.text);
        item.append(check, text, el('button', { type: 'button', class: 'lmd-card-del lmd-board-edit', title: T('Eliminar la tarjeta') }, ICON.close));
        list.appendChild(item);
      });
      box.append(head, list, el('button', { type: 'button', class: 'lmd-card-add lmd-board-edit', text: '+ ' + T('Tarjeta') }));
      board.appendChild(box);
    });
    board.appendChild(el('button', { type: 'button', class: 'lmd-col-add lmd-board-edit', text: '+ ' + T('Columna') }));
    pre.replaceWith(board);
  }

  const where = (node) => {
    const board = node.closest('.lmd-board'); const col = node.closest('.lmd-col'); const card = node.closest('.lmd-card');
    return { board, ci: col ? +col.dataset.c : -1, ki: card ? +card.dataset.k : -1 };
  };

  function bind(article) {
    article.addEventListener('click', (e) => {
      const t = e.target; if (!t.closest || !t.closest('.lmd-board')) return;
      const w = where(t); const cols = w.board._cols;
      if (t.closest('.lmd-card-add')) { cols[w.ci].cards.push({ text: T('Tarjeta nueva'), done: false }); write(w.board, [w.ci, cols[w.ci].cards.length - 1]); }
      else if (t.closest('.lmd-col-add')) { cols.push({ title: T('Columna') + ' ' + (cols.length + 1), cards: [] }); write(w.board); }
      else if (t.closest('.lmd-card-del')) { cols[w.ci].cards.splice(w.ki, 1); write(w.board); }
      else if (t.closest('.lmd-col-del')) {
        if (cols[w.ci].cards.length && !window.confirm(T('¿Eliminar la columna "{a}" con sus tarjetas?', { a: cols[w.ci].title }))) return;
        cols.splice(w.ci, 1); write(w.board);
      } else if (core.editMode && t.closest('.lmd-card-text') && t.closest('.lmd-card-text').contentEditable !== 'plaintext-only') startEdit(t.closest('.lmd-card-text'));
      else if (core.editMode && t.closest('.lmd-col-title') && t.closest('.lmd-col-title').contentEditable !== 'plaintext-only') { const s = t.closest('.lmd-col-title'); s.contentEditable = 'plaintext-only'; s.focus(); getSelection().selectAllChildren(s); }
    });
    article.addEventListener('change', (e) => {
      if (!e.target.matches || !e.target.matches('.lmd-card-check')) return;
      const w = where(e.target); w.board._cols[w.ci].cards[w.ki].done = e.target.checked; write(w.board);
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
      else cols[w.ci].cards[w.ki].text = value;
      write(w.board);
    });

    // Arrastrar una tarjeta a otra columna o a otra posición.
    let drag = null;
    article.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.lmd-card'); if (!card) return;
      drag = where(card); card.classList.add('lmd-dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.textContent);
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
      const board = drag.board; drag = null;
      write(board);
    });
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
    core.hooks.render.push(() => core.ui.article.querySelectorAll('pre.lmd-kanban').forEach(build));
  }

  LMD.board = { init, calcTables, totalsRow, formulaOf };
})();
