// Tableros (kanban) y cuentas en tablas.
// Un tablero es un bloque ```kanban con títulos como columnas y tareas como tarjetas: en cualquier otro
// programa se lee como una lista común. Una celda con =sum, =avg, =min, =max, =count o =median se
// muestra con el resultado de su columna.
//
// Cada tarjeta puede llevar al final un grupo entre llaves con sus campos:
//   - [ ] Fix checkout {due=2026-10-20 assignee="Ana Paz, Lia" tags="bug,idea" id=c8k2m9xq created=2026-10-07T14:03:11Z by=Ana updated=2026-10-07T15:10:02Z}
// id, created, by y updated los pone la app (el id no cambia nunca; by es quien la creó, y no se edita; updated, al
// mover o editar la tarjeta). El resto son campos de la persona: clave=valor, con comillas si el valor tiene
// espacios. Varias personas o varias etiquetas van separadas por coma. Antes de la primera columna, un renglón solo
// con llaves configura el tablero: qué campos se ven en las tarjetas, de qué tipo es cada uno, cuál es la columna
// de hechas y de qué color es cada etiqueta.
//   {show=due,assignee priority=low|medium|high estimate=number done=Done tags=bug:red,idea:blue}
// "Hecha" es un estado: la tarjeta que entra a la columna de hechas queda [x], y la que sale vuelve a [ ]. Sin
// done=, la columna de hechas es la que se llama Done, Hecho, Listo o parecido; done="" dice que no hay ninguna.
// Un tablero sin nada de esto se abre igual, y recibe id y fechas la primera vez que se edita. Lo que no se
// entiende queda como texto de la tarjeta. El servidor lee el mismo formato (server/server.mjs, kbParse).
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // ---------- Tablero: el formato ----------
  const KEY = /^[\p{L}_][\p{L}\p{N}_.-]{0,39}$/u;
  const RESERVED = ['id', 'created', 'updated', 'show', 'by'];
  const COLORS = [['gray', 'Gris'], ['red', 'Rojo'], ['orange', 'Naranja'], ['yellow', 'Amarillo'], ['green', 'Verde'], ['teal', 'Turquesa'], ['blue', 'Azul'], ['purple', 'Violeta'], ['pink', 'Rosa']];
  const TAGCFG = /^[^:,]+:(?:gray|red|orange|yellow|green|teal|blue|purple|pink)(?:,[^:,]+:(?:gray|red|orange|yellow|green|teal|blue|purple|pink))*$/;
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

  // { show: [claves a la vista], fields: { clave: { type, options } }, done: columna de hechas (sin definir: por el nombre),
  //   tags: { etiqueta: color }, columns: [{ title, cards: [{ id, text, done, created, updated, by, attrs }] }] }
  function parse(text) {
    const board = { show: [], fields: {}, tags: {}, columns: [] }; let cur = null;
    String(text).split(/\r?\n/).forEach((line) => {
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (h) { cur = { title: h[1].trim(), cards: [] }; board.columns.push(cur); return; }
      const c = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
      if (!c) {
        const cfg = !cur && /^\s*\{([^{}]*)\}\s*$/.exec(line); const pairs = cfg && pairsOf(cfg[1]);
        if (pairs) pairs.forEach(([k, v]) => {
          if (k === 'show') board.show = v.split(',').map((s) => s.trim()).filter(Boolean);
          else if (k === 'done') board.done = v;
          else if (k === 'tags' && TAGCFG.test(v)) v.split(',').forEach((p) => { const i = p.lastIndexOf(':'); board.tags[p.slice(0, i)] = p.slice(i + 1); });
          else if (!RESERVED.includes(k)) board.fields[k] = typeOf(v);
        });
        return;
      }
      if (!c[2].trim()) return;
      if (!cur) { cur = { title: T('Por hacer'), cards: [] }; board.columns.push(cur); }
      const s = splitCard(c[2].trim()); const card = { id: '', text: s.text, done: !!c[1] && c[1] !== ' ', created: '', updated: '', by: '', attrs: {} };
      s.pairs.forEach(([k, v]) => { if (k === 'id') card.id = v; else if (k === 'created') card.created = v; else if (k === 'updated') card.updated = v; else if (k === 'by') card.by = v; else if (k !== 'show') card.attrs[k] = v; });
      cur.cards.push(card);
    });
    return board;
  }

  function cardLine(card) {
    const pairs = Object.keys(card.attrs).map((k) => k + '=' + val(card.attrs[k]));
    if (card.id) pairs.push('id=' + val(card.id)); if (card.created) pairs.push('created=' + val(card.created)); if (card.by) pairs.push('by=' + val(card.by)); if (card.updated) pairs.push('updated=' + val(card.updated));
    return '- [' + (card.done ? 'x' : ' ') + '] ' + card.text.replace(/\s*\n\s*/g, ' ').trim() + (pairs.length ? ' {' + pairs.join(' ') + '}' : '');
  }
  function serialize(board) {
    const out = []; const cfg = [];
    if (board.show.length) cfg.push('show=' + val(board.show.join(',')));
    Object.keys(board.fields).forEach((k) => { const f = board.fields[k]; cfg.push(k + '=' + val(f.type === 'select' ? f.options.join('|') : f.type)); });
    if (board.done != null) cfg.push('done=' + val(board.done));
    const tags = Object.keys(board.tags || {}).map((k) => k + ':' + board.tags[k]).join(',');
    if (tags && TAGCFG.test(tags)) cfg.push('tags=' + val(tags));
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
  const touch = (card) => { card.updated = nowIso(); };

  // La columna de hechas: la que dice el tablero o, si no dice nada, la primera que se llama como una de hechas.
  const DONE_NAMES = /^(done|complete|completed|finished|closed|shipped|hecho|hecha|hechos|hechas|listo|lista|listos|listas|terminado|terminada|terminados|terminadas|completado|completada|completados|completadas|finalizado|finalizada|finalizados|finalizadas|cerrado|cerrada|cerrados|cerradas)$/i;
  function doneIndex(model) {
    const cols = model.columns;
    if (model.done === '') return -1;
    if (model.done != null) {
      const want = model.done.toLowerCase(); let i = cols.findIndex((c) => c.title === model.done);
      if (i < 0) i = cols.findIndex((c) => c.title.toLowerCase() === want);
      if (i >= 0) return i;
    }
    return cols.findIndex((c) => DONE_NAMES.test(c.title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()));
  }
  // Cambiar de columna es cambiar de estado: entrar a la de hechas tilda la tarjeta, y salir la destilda.
  const settle = (model, card, to) => { const d = doneIndex(model); if (d >= 0) card.done = to === d; };

  // ---------- Los tipos de campo ----------
  // En el archivo un campo es texto, fecha, número o lista. Persona, etiquetas, enlace y prioridad se reconocen por
  // el nombre de la clave (en inglés o en español), así el formato no cambia para quien lo lee desde afuera.
  const NAMED = {
    due: /^(due|vence|deadline|fecha-limite)$/i, person: /^(owners?|assignees?|responsables?|asignad[oa]s?|persona|person)$/i,
    priority: /^(priority|prioridad)$/i, tags: /^(tags?|etiquetas?|labels?)$/i, link: /^(link|enlace|url)$/i,
  };
  const isUrl = (v) => /^https?:\/\/[^\s<>"'`]+$/i.test(String(v || ''));
  function kindOf(fields, k, v) {
    if (k === 'by') return 'person';
    const f = fields[k];
    if (NAMED.priority.test(k) && (!f || f.type === 'select')) return 'priority';
    if (f && f.type !== 'text') return f.type;
    if (NAMED.person.test(k)) return 'person';
    if (NAMED.tags.test(k)) return 'tags';
    if (NAMED.link.test(k) || isUrl(v)) return 'link';
    return /^\d{4}-\d\d-\d\d$/.test(v || '') ? 'date' : 'text';
  }
  const SVG = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const KIND_ICON = {
    date: ICON.clock, person: ICON.people, priority: ICON.flag, link: ICON.link,
    tags: SVG('<path d="M4 4.500h7.500l8 8-7.500 7.500-8-8z"/><circle cx="8.500" cy="9" r="1.200"/>'),
    number: SVG('<path d="M9.500 4 7.500 20M16.500 4l-2 16M4.500 9h16M3.500 15h16"/>'),
    text: SVG('<path d="M5 6h14M12 6v13M9.500 19h5"/>'),
    select: SVG('<path d="M9 7h11M9 12h11M9 17h11M4.500 7h.01M4.500 12h.01M4.500 17h.01"/>'),
  };
  const listOf = (v) => String(v == null ? '' : v).split(',').map((s) => s.trim()).filter(Boolean);
  const hash = (s) => { let h = 5381; for (const c of String(s).toLowerCase()) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h; };
  // El color de una etiqueta: el que eligió el tablero o, si no, siempre el mismo para el mismo nombre.
  const tagColor = (tags, name) => (tags && tags[name]) || COLORS[1 + hash(name) % (COLORS.length - 1)][0];
  const initials = (name) => { const w = String(name).split('@')[0].split(/[\s._-]+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase(); };
  const shortUrl = (v) => { try { const u = new URL(v); const s = u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); return s.length > 42 ? s.slice(0, 41) + '…' : s; } catch (e) { return String(v); } };
  const rank = (v, options) => {
    if (/^(high|alta|alto|urgent|urgente|critical|crítica|critica)$/i.test(v)) return 'high';
    if (/^(low|baja|bajo)$/i.test(v)) return 'low';
    if (/^(medium|media|medio|normal)$/i.test(v)) return 'mid';
    const i = (options || []).indexOf(v); return i < 0 || options.length < 2 ? 'mid' : i === options.length - 1 ? 'high' : i === 0 ? 'low' : 'mid';
  };
  const optionsOf = (fields, k, kind) => (fields[k] && fields[k].type === 'select' ? fields[k].options : kind === 'priority' ? [T('baja'), T('media'), T('alta')] : []);

  // Quién usa la app: su nombre visible o, si no hay, lo que va antes de la arroba. Sin sesión, nadie.
  const account = () => { try { return (LMD.sync && LMD.sync.account && LMD.sync.account()) || null; } catch (e) { return null; } };
  const myName = () => { const a = account(); return a ? String(a.name || String(a.email || '').split('@')[0] || '').trim() : ''; };
  const inTeam = () => { try { const a = account(); return !!(a && a.team && a.team.mine && core.appRoot && core.appRoot.kind === 'cloud' && LMD.cloud.isTeam(core.cloudPath)); } catch (e) { return false; } };
  const uniq = (list) => { const seen = new Set(); return list.filter((s) => { const k = String(s).toLowerCase(); if (!s || seen.has(k)) return false; seen.add(k); return true; }); };
  // A quién se le puede asignar una tarjeta: en una nota del equipo, sus miembros; siempre, las personas ya usadas.
  function people(model) {
    const out = []; const a = account();
    if (inTeam()) (a.team.mine.members || []).forEach((m) => out.push(m.name || m.email));
    model.columns.forEach((c) => c.cards.forEach((k) => Object.keys(k.attrs).forEach((x) => { if (kindOf(model.fields, x, k.attrs[x]) === 'person') out.push(...listOf(k.attrs[x])); })));
    return uniq(out);
  }
  function tagsUsed(model, extra) {
    const out = Object.keys(extra || {});
    model.columns.forEach((c) => c.cards.forEach((k) => Object.keys(k.attrs).forEach((x) => { if (kindOf(model.fields, x, k.attrs[x]) === 'tags') out.push(...listOf(k.attrs[x])); })));
    return uniq(out);
  }

  const locale = () => (LMD.lang() === 'en' ? 'en-US' : 'es-AR');
  const dayText = (v) => { const d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }); };
  const stampText = (v) => { const d = new Date(v); return isNaN(d) ? v : d.toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const label = (k) => (k === 'by' ? T('Autor') : k.charAt(0).toUpperCase() + k.slice(1).replace(/[-_.]+/g, ' '));

  // Reescribe el bloque en el archivo y redibuja. id: la tarjeta que queda con el foco.
  function write(board, id) {
    const r = core.rangeOf(board); if (!r) return;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset;
    const start = r[0];
    stamp(board._model);
    core.spliceLines(s + 1, e - s - 2, serialize(board._model));
    core.render();
    if (!id) return;
    const again = core.ui.article.querySelector('.lmd-board[data-l^="' + start + '-"]');
    const target = again && Array.from(again.querySelectorAll('.lmd-card')).find((c) => c.dataset.id === id);
    if (target) { try { target.focus({ preventScroll: true }); } catch (e2) { /* ya no recibe foco */ } }
  }

  // Lo que la tarjeta muestra en chico: los campos que el tablero eligió, si la tarjeta los tiene.
  function chips(model, card, done) {
    const box = el('div', { class: 'lmd-card-meta' });
    model.show.forEach((k) => {
      const v = k === 'by' ? card.by : card.attrs[k]; if (v == null || v === '') return;
      const kind = kindOf(model.fields, k, v); const name = label(k);
      if (kind === 'person') {
        const group = el('span', { class: 'lmd-chip lmd-chip-people', 'data-attr': k });
        listOf(v).forEach((p) => group.appendChild(el('span', { class: 'lmd-avatar', title: name + ': ' + p, 'aria-label': name + ': ' + p, role: 'img', text: initials(p) })));
        box.appendChild(group);
      } else if (kind === 'tags') listOf(v).forEach((t) => box.appendChild(el('span', { class: 'lmd-chip lmd-ktag lmd-ktag-' + tagColor(model.tags, t), 'data-attr': k, title: name, text: t })));
      else if (kind === 'link' && isUrl(v)) box.appendChild(el('a', { class: 'lmd-chip lmd-chip-link', 'data-attr': k, href: v, target: '_blank', rel: 'noopener noreferrer', draggable: 'false', title: shortUrl(v), 'aria-label': name + ': ' + shortUrl(v) }, ICON.link));
      else if (kind === 'priority') {
        const chip = el('span', { class: 'lmd-chip lmd-chip-prio', 'data-attr': k, title: name });
        chip.append(el('i', { class: 'lmd-dot lmd-prio-' + rank(v, optionsOf(model.fields, k, kind)), 'aria-hidden': 'true' }), el('span', { text: v }));
        box.appendChild(chip);
      } else {
        const date = kind === 'date' && /^\d{4}-\d\d-\d\d$/.test(v); const late = date && !done && v < today();
        box.appendChild(el('span', { class: 'lmd-chip' + (date ? ' lmd-chip-date' : '') + (late ? ' lmd-chip-late' : ''), 'data-attr': k, title: name + (late ? ' · ' + T('Vencida') : ''), text: date ? dayText(v) : v }));
      }
    });
    return box.childNodes.length ? box : null;
  }

  function build(pre) {
    const board = el('div', { class: 'lmd-board' });
    if (pre.hasAttribute('data-l')) board.setAttribute('data-l', pre.getAttribute('data-l'));
    const model = parse(pre.textContent); const cols = model.columns; const dcol = doneIndex(model);
    board._model = model; board._cols = cols;
    cols.forEach((col, ci) => {
      const box = el('div', { class: 'lmd-col' + (ci === dcol ? ' lmd-col-done' : ''), 'data-c': ci });
      const head = el('div', { class: 'lmd-col-head' });
      const title = el('span', { class: 'lmd-col-title', text: col.title });
      head.appendChild(title);
      if (ci === dcol) head.appendChild(el('span', { class: 'lmd-col-mark', title: T('Columna de hechas'), 'aria-label': T('Columna de hechas'), role: 'img' }, ICON.check));
      head.append(el('span', { class: 'lmd-col-n', text: String(col.cards.length) }),
        el('button', { type: 'button', class: 'lmd-col-menu', title: T('Opciones de la columna'), 'aria-label': T('Opciones de la columna') + ': ' + col.title, 'aria-haspopup': 'menu' }, ICON.dots));
      const list = el('div', { class: 'lmd-cards' });
      col.cards.forEach((card, ki) => {
        const done = card.done || ci === dcol;
        const item = el('div', { class: 'lmd-card' + (done ? ' lmd-card-done' : ''), draggable: core.readOnly ? 'false' : 'true', tabindex: '0', role: 'button', 'aria-label': T('Abrir la tarjeta') + ': ' + card.text, 'data-k': ki });
        if (card.id) item.dataset.id = card.id;
        const text = el('span', { class: 'lmd-card-text' }); text.innerHTML = core.inline(card.text);
        const main = el('div', { class: 'lmd-card-main' }); main.appendChild(text);
        const meta = chips(model, card, done); if (meta) main.appendChild(meta);
        item.appendChild(main);
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
  // Los tipos que se ofrecen al agregar un campo. Los cinco primeros ya traen nombre: la clave queda escrita en la
  // nota, en el idioma de quien la crea. Los otros tres piden un nombre.
  const TYPES = [['due', 'date', 'Fecha límite', 'vence'], ['person', 'person', 'Responsable', 'responsable'], ['priority', 'priority', 'Prioridad', 'prioridad'], ['tags', 'tags', 'Etiquetas', 'etiquetas'], ['link', 'link', 'Enlace', 'enlace'],
    ['number', 'number', 'Número'], ['text', 'text', 'Texto'], ['select', 'select', 'Lista de opciones']];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyFrom = (name) => String(name || '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '').replace(/^[^\p{L}_]+/u, '').slice(0, 40);
  const splitOpts = (v) => uniq(String(v || '').split(',').map((s) => s.replace(/\|/g, ' ').trim()));
  let seq = 0;

  // Varias personas o varias etiquetas: pastillas que se quitan con su x, y un campo que sugiere lo ya usado.
  function multi(kind, value, set, x) {
    const tags = kind === 'tags'; let items = listOf(value); let open = '';
    const wrap = el('div', { class: 'lmd-cd-multi', 'data-kind': kind });
    const input = el('input', { type: 'text', class: 'lmd-cd-multi-in', spellcheck: 'false', autocomplete: 'off', placeholder: T(tags ? 'Agregar etiqueta' : 'Agregar persona'), 'aria-label': x.name });
    const dl = el('datalist', { id: 'lmd-cd-dl-' + (++seq) }); input.setAttribute('list', dl.id);
    x.mark(input);
    const has = (s) => items.some((i) => i.toLowerCase() === String(s).toLowerCase());
    const emit = () => set(items.join(tags ? ',' : ', '));
    const draw = () => {
      wrap.textContent = '';
      items.forEach((name) => {
        const pill = el('span', { class: 'lmd-cd-pill' + (tags ? ' lmd-ktag lmd-ktag-' + tagColor(x.tags, name) : '') });
        if (tags && !x.ro) pill.appendChild(el('button', { type: 'button', class: 'lmd-cd-pill-name', 'data-cd-tag': name, title: T('Cambiar el color'), 'aria-label': T('Cambiar el color') + ': ' + name, 'aria-expanded': String(open === name), text: name }));
        else { if (!tags) pill.appendChild(el('span', { class: 'lmd-avatar', 'aria-hidden': 'true', text: initials(name) })); pill.appendChild(el('span', { class: 'lmd-cd-pill-name', text: name })); }
        if (!x.ro) pill.appendChild(el('button', { type: 'button', class: 'lmd-cd-pop', 'data-cd-pop': name, title: T('Quitar'), 'aria-label': T('Quitar') + ': ' + name }, ICON.close));
        wrap.appendChild(pill);
      });
      if (x.ro) return;
      wrap.appendChild(input);
      const me = myName() || T('Yo');
      if (!tags && !has(me)) wrap.appendChild(el('button', { type: 'button', class: 'lmd-cd-me', 'data-cd-me': '', text: '+ ' + T('Yo') }));
      dl.textContent = ''; x.suggest(kind).filter((s) => !has(s)).forEach((s) => dl.appendChild(el('option', { value: s })));
      wrap.appendChild(dl);
      if (tags && open && has(open)) {
        const row = el('div', { class: 'lmd-cd-swatches', role: 'radiogroup', 'aria-label': T('Color') + ': ' + open }); const now = tagColor(x.tags, open);
        COLORS.forEach((c) => row.appendChild(el('button', { type: 'button', class: 'lmd-cd-swatch lmd-ktag lmd-ktag-' + c[0], role: 'radio', 'aria-checked': String(c[0] === now), 'data-cd-color': c[0], title: T(c[1]), 'aria-label': T(c[1]) })));
        wrap.appendChild(row);
      }
    };
    const commit = () => {
      const typed = input.value; input.value = ''; let n = 0;
      typed.split(',').forEach((s) => {
        s = s.replace(/\s+/g, ' ').trim(); s = tags ? s.replace(/:/g, '').trim().slice(0, 40) : s.slice(0, 80);
        if (!tags && s.toLowerCase() === T('Yo').toLowerCase() && myName()) s = myName();
        if (s && !has(s) && items.length < 20) { items.push(s); n++; }
      });
      if (n) { emit(); draw(); }
      return n;
    };
    input._commit = commit;
    input.addEventListener('keydown', (e) => {
      const add = e.key === ',' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && input.value.trim() && !input.closest('.lmd-cd-new'));
      if (add) { e.preventDefault(); e.lmdDone = true; commit(); input.focus(); }
      else if (e.key === 'Backspace' && !input.value && items.length) { items.pop(); emit(); draw(); input.focus(); }
    });
    // Elegir una sugerencia de la lista la agrega enseguida. Lo que queda escrito al salir del campo no se convierte
    // en pastilla ahí mismo: eso corre los botones de lugar justo cuando se los está tocando, y el clic se pierde.
    // Entra al agregar el campo o al guardar la tarjeta.
    input.addEventListener('input', (e) => { if (e.inputType === 'insertReplacementText' && input.value.trim()) { commit(); input.focus(); } });
    wrap.addEventListener('click', (e) => {
      const t = e.target; const pop = t.closest('[data-cd-pop]'); const tag = t.closest('[data-cd-tag]'); const color = t.closest('[data-cd-color]');
      if (pop) { items = items.filter((i) => i !== pop.dataset.cdPop); if (open === pop.dataset.cdPop) open = ''; emit(); draw(); input.focus(); }
      else if (tag) { open = open === tag.dataset.cdTag ? '' : tag.dataset.cdTag; draw(); const again = Array.from(wrap.querySelectorAll('[data-cd-tag]')).find((b) => b.dataset.cdTag === (open || tag.dataset.cdTag)); if (again) again.focus(); }
      else if (color) { x.tags[open] = color.dataset.cdColor; const name = open; open = ''; draw(); const again = Array.from(wrap.querySelectorAll('[data-cd-tag]')).find((b) => b.dataset.cdTag === name); if (again) again.focus(); }
      else if (t.closest('[data-cd-me]')) { input.value = myName() || T('Yo'); commit(); input.focus(); }
    });
    draw();
    return wrap;
  }

  // Un enlace: se ve como enlace, con un lápiz para cambiarlo. Solo http y https.
  function linkBox(value, set, x) {
    const wrap = el('div', { class: 'lmd-cd-link' });
    const input = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://', spellcheck: 'false', autocomplete: 'off', 'aria-label': x.name });
    input.value = value; input.disabled = !!x.ro; x.mark(input);
    const fix = () => { const v = input.value.trim(); const n = !v || isUrl(v) ? v : (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? 'https://' + v : v); if (n !== input.value) input.value = n; set(n); return n; };
    const draw = (edit) => {
      wrap.textContent = ''; const v = input.value;
      if (isUrl(v) && !edit) {
        input.hidden = true;
        wrap.append(el('a', { class: 'lmd-link lmd-cd-url', href: v, target: '_blank', rel: 'noopener noreferrer', title: v, text: shortUrl(v) }), input);
        if (!x.ro) wrap.appendChild(el('button', { type: 'button', class: 'lmd-cd-edit', 'data-cd-edit': '', title: T('Editar el enlace'), 'aria-label': T('Editar el enlace') }, ICON.pencil));
      } else { input.hidden = false; wrap.appendChild(input); }
    };
    input._commit = fix;
    input.addEventListener('input', () => set(input.value.trim()));
    // En el renglón de alta no se redibuja al salir del campo: correría el botón Agregar justo cuando se lo toca.
    input.addEventListener('change', () => { fix(); if (isUrl(input.value) && !input.closest('.lmd-cd-new')) draw(false); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-cd-edit]')) { draw(true); input.focus(); input.select(); } });
    draw(false);
    return wrap;
  }

  // El control que corresponde a cada tipo de campo. x: { ro, fields, tags, name, mark(nodo), suggest(tipo), options }
  function control(kind, key, value, set, x) {
    if (kind === 'person' || kind === 'tags') return multi(kind, value, set, x);
    if (kind === 'link') return linkBox(value, set, x);
    let input;
    if (kind === 'select' || kind === 'priority') {
      const opts = x.options || optionsOf(x.fields, key, kind);
      input = el('select', {});
      [''].concat(opts.includes(value) || !value ? opts : opts.concat(value)).forEach((o) => { const opt = el('option', { value: o, text: o || T('Sin elegir') }); if (o === value) opt.selected = true; input.appendChild(opt); });
    } else {
      input = el('input', { type: kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text', spellcheck: 'false', autocomplete: 'off' });
      input.value = value; if (kind === 'number') input.step = 'any';
    }
    input.setAttribute('aria-label', x.name); input.disabled = !!x.ro; x.mark(input);
    const on = () => set(input.value); input.addEventListener('input', on); input.addEventListener('change', on);
    return input;
  }

  // ki < 0: una tarjeta nueva en esa columna, que recién existe al guardarla.
  function openCard(board, ci, ki) {
    const model = board._model; const fresh = ki < 0; const ro = !!core.readOnly;
    if (fresh && ro) return;
    const at = nowIso();
    const card = fresh ? { id: newId(), text: '', done: false, created: at, updated: at, by: myName(), attrs: {} } : model.columns[ci].cards[ki];
    if (!card) return;
    // Se trabaja sobre una copia: Cancelar no deja nada cambiado.
    const draft = { attrs: Object.assign({}, card.attrs), show: model.show.slice(), fields: JSON.parse(JSON.stringify(model.fields)), tags: Object.assign({}, model.tags) };
    const box = el('div', { class: 'lmd-ask lmd-cd' });
    const dlg = el('div', { class: 'lmd-ask-card lmd-dlg-card lmd-cd-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Tarjeta') });
    const title = el('input', { type: 'text', class: 'lmd-cd-title', 'data-cd': 'title', 'aria-label': T('Título'), placeholder: T('Título'), spellcheck: 'false', autocomplete: 'off', maxlength: '500' });
    title.value = card.text; title.disabled = ro;
    const col = el('select', { 'data-cd': 'col' }); col.disabled = ro;
    model.columns.forEach((c, i) => { const o = el('option', { value: i, text: c.title }); if (i === ci) o.selected = true; col.appendChild(o); });
    const state = el('label', { class: 'lmd-cd-state' }); state.append(el('span', { text: T('Estado (columna)') }), col);
    const list = el('div', { class: 'lmd-cd-attrs', role: 'list' });
    const undoBar = el('div', { class: 'lmd-cd-undo', role: 'status' }); undoBar.hidden = true;
    const adder = el('div', { class: 'lmd-cd-add' });
    const err = el('p', { class: 'lmd-dlg-err', role: 'alert' }); err.hidden = true;
    const dates = el('p', { class: 'lmd-cd-dates' });
    const actions = el('div', { class: 'lmd-ask-actions lmd-cd-actions' });
    if (!ro && !fresh) actions.appendChild(el('button', { type: 'button', class: 'lmd-cd-del', 'data-cd': 'del', text: T('Eliminar') }));
    actions.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-cd': 'no', 'data-esc': '', text: T(ro ? 'Cerrar' : 'Cancelar') }));
    if (!ro) actions.appendChild(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-cd': 'ok', text: T('Guardar') }));
    dlg.append(title, state, list, undoBar, adder, err, dates, actions); box.appendChild(dlg);
    const $ = (name) => box.querySelector('[data-cd=' + name + ']');
    if (!fresh) {
      const made = card.created && (card.by ? T('Creada por {a} el {b}', { a: card.by, b: stampText(card.created) }) : T('Creada el {a}', { a: stampText(card.created) }));
      const parts = [made, (card.updated || card.created) && T('Editada el {a}', { a: stampText(card.updated || card.created) })].filter(Boolean);
      dates.textContent = parts.join(' · ');
    }
    dates.hidden = !dates.textContent;
    const fail = (text) => { err.hidden = !text; err.textContent = text || ''; };
    const X = { ro, fields: draft.fields, tags: draft.tags, suggest: (kind) => (kind === 'tags' ? tagsUsed(model, draft.tags) : people(model)) };
    let undo = null; let step = null;

    const drawAttrs = () => {
      list.textContent = '';
      Object.keys(draft.attrs).forEach((k) => {
        const kind = kindOf(draft.fields, k, draft.attrs[k]); const name = label(k);
        const row = el('div', { class: 'lmd-cd-attr', 'data-key': k, 'data-kind': kind, role: 'listitem' });
        row.append(el('span', { class: 'lmd-cd-ico', 'aria-hidden': 'true' }, KIND_ICON[kind] || KIND_ICON.text), el('span', { class: 'lmd-cd-key', text: name, title: k }),
          control(kind, k, draft.attrs[k], (v) => { draft.attrs[k] = v; }, Object.assign({ name, mark: (n) => { n.dataset.cdVal = k; } }, X)));
        const see = el('input', { type: 'checkbox', role: 'switch', class: 'lmd-cd-switch', title: T('Mostrar en las tarjetas'), 'aria-label': T('Mostrar en las tarjetas') + ': ' + name });
        see.checked = draft.show.includes(k); see.dataset.cdShow = k; see.disabled = ro;
        see.addEventListener('change', () => { draft.show = draft.show.filter((s) => s !== k); if (see.checked) draft.show.push(k); });
        row.appendChild(see);
        if (!ro) row.appendChild(el('button', { type: 'button', class: 'lmd-cd-rm', title: T('Quitar el campo'), 'aria-label': T('Quitar el campo') + ': ' + name, 'data-cd-rm': k }, ICON.close));
        list.appendChild(row);
      });
      list.hidden = !list.childNodes.length;
    };
    const drawUndo = (focus) => {
      undoBar.textContent = ''; undoBar.hidden = !undo; if (!undo) return;
      undoBar.append(el('span', { text: T('Campo quitado: {a}', { a: label(undo.k) }) }), el('button', { type: 'button', class: 'lmd-link', 'data-cd': 'undo', text: T('Deshacer') }));
      if (focus) $('undo').focus();
    };
    const remove = (k) => {
      undo = { k, v: draft.attrs[k], at: Object.keys(draft.attrs).indexOf(k) };
      delete draft.attrs[k]; drawAttrs(); drawUndo(true);
    };
    const restore = () => {
      const keys = Object.keys(draft.attrs); const next = {}; keys.splice(Math.min(undo.at, keys.length), 0, undo.k);
      keys.forEach((k) => { next[k] = k === undo.k ? undo.v : draft.attrs[k]; });
      const k = undo.k; draft.attrs = next; undo = null; drawAttrs(); drawUndo();
      const back = list.querySelector('[data-cd-rm="' + CSS.escape(k) + '"]'); if (back) back.focus();
    };

    // Agregar un campo, en el lugar: primero el tipo, después el nombre si hace falta, y enseguida el valor.
    const boardKeys = () => {
      const all = new Set(model.show.concat(Object.keys(draft.fields)));
      model.columns.forEach((c) => c.cards.forEach((k) => Object.keys(k.attrs).forEach((a) => all.add(a))));
      return Array.from(all).filter((k) => KEY.test(k) && !RESERVED.includes(k) && !(k in draft.attrs));
    };
    const sample = (k) => { for (const c of model.columns) for (const k2 of c.cards) if (k2.attrs[k]) return k2.attrs[k]; return ''; };
    const typeBtn = (attr, value, kind, text) => { const b = el('button', { type: 'button', class: 'lmd-cd-type' }, KIND_ICON[kind] || KIND_ICON.text); b.setAttribute(attr, value); b.appendChild(el('span', { text })); return b; };
    const drawAdd = (focus) => {
      adder.textContent = ''; if (ro) return;
      if (!step) {
        const b = el('button', { type: 'button', class: 'lmd-cd-add-open', 'data-cd': 'add-open', text: '+ ' + T('Agregar campo') });
        adder.appendChild(b); if (focus) b.focus();
        return;
      }
      if (step.stage === 'type') {
        const pick = el('div', { class: 'lmd-cd-chooser', role: 'group', 'aria-label': T('Agregar campo') });
        const known = boardKeys(); const all = known.concat(Object.keys(draft.attrs));
        if (known.length) {
          const g = el('div', { class: 'lmd-cd-types' });
          known.forEach((k) => g.appendChild(typeBtn('data-cd-use', k, kindOf(draft.fields, k, sample(k)), label(k))));
          pick.append(el('p', { class: 'lmd-cd-sub', text: T('Usar un campo de este tablero') }), g, el('p', { class: 'lmd-cd-sub', text: T('Campo nuevo') }));
        }
        const g = el('div', { class: 'lmd-cd-types' });
        TYPES.filter((t) => !NAMED[t[0]] || !all.some((k) => NAMED[t[0]].test(k))).forEach((t) => g.appendChild(typeBtn('data-cd-type', t[0], t[1], T(t[2]))));
        pick.append(g, el('button', { type: 'button', class: 'lmd-link lmd-cd-back', 'data-cd': 'add-cancel', text: T('Cancelar') }));
        adder.appendChild(pick); pick.scrollIntoView({ block: 'nearest' });
        pick.querySelector('button').focus();
        return;
      }
      const row = el('div', { class: 'lmd-cd-new', 'data-kind': step.kind });
      row.appendChild(el('span', { class: 'lmd-cd-ico', 'aria-hidden': 'true' }, KIND_ICON[step.kind] || KIND_ICON.text));
      let nameIn = null; let optsIn = null;
      if (step.key) row.appendChild(el('span', { class: 'lmd-cd-key', text: label(step.key), title: step.key }));
      else {
        nameIn = el('input', { type: 'text', 'data-cd': 'name', placeholder: T('Nombre del campo'), 'aria-label': T('Nombre del campo'), spellcheck: 'false', autocomplete: 'off', maxlength: '40' }); row.appendChild(nameIn);
        if (step.kind === 'select') { optsIn = el('input', { type: 'text', 'data-cd': 'opts', placeholder: T('Opciones, separadas por coma'), 'aria-label': T('Opciones, separadas por coma'), spellcheck: 'false', autocomplete: 'off' }); row.appendChild(optsIn); }
      }
      const holder = el('div', { class: 'lmd-cd-newval' }); row.appendChild(holder);
      const make = () => {
        holder.textContent = '';
        holder.appendChild(control(step.kind, step.key || '', step.value || '', (v) => { if (step) step.value = v; }, Object.assign({}, X, { name: step.key ? label(step.key) : T('Valor'), mark: (n) => { n.dataset.cd = 'newval'; }, options: optsIn ? splitOpts(optsIn.value) : null })));
      };
      make(); if (optsIn) optsIn.addEventListener('input', () => { step.value = ''; make(); });
      row.append(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-cd': 'add', text: T('Agregar') }), el('button', { type: 'button', class: 'lmd-cd-rm', 'data-cd': 'add-cancel', title: T('Cancelar'), 'aria-label': T('Cancelar') }, ICON.close));
      adder.appendChild(row); row.scrollIntoView({ block: 'nearest' });
      (nameIn || $('newval')).focus();
    };
    const commitAdd = () => {
      const row = adder.querySelector('.lmd-cd-new'); if (!row || !step) return;
      row.querySelectorAll('input').forEach((i) => { if (i._commit) i._commit(); });
      const nameIn = $('name'); const key = step.key || keyFrom(nameIn.value);
      if (!KEY.test(key) || RESERVED.includes(key)) { fail(T('Ese nombre no sirve: empezá con una letra.')); if (nameIn) nameIn.focus(); return; }
      if (key in draft.attrs) { fail(T('La tarjeta ya tiene ese campo.')); return; }
      if (Object.keys(draft.attrs).length >= 30) { fail(T('Una tarjeta tiene hasta 30 campos.')); return; }
      const v = String(step.value || '').trim();
      if (step.kind === 'link' && v && !isUrl(v)) { fail(T('El enlace empieza con http:// o https://')); $('newval').focus(); return; }
      fail('');
      if (!draft.fields[key]) {
        if (step.kind === 'date' || step.kind === 'number') draft.fields[key] = { type: step.kind };
        else if (step.kind === 'select' || step.kind === 'priority') { const o = step.kind === 'select' ? splitOpts($('opts').value) : []; draft.fields[key] = { type: 'select', options: o.length ? o : [T('baja'), T('media'), T('alta')] }; }
      }
      draft.attrs[key] = v; if (!draft.show.includes(key)) draft.show.push(key);
      step = null; undo = null; drawAttrs(); drawUndo(); drawAdd(true);
    };

    drawAttrs(); drawAdd();
    document.body.appendChild(box);
    const snap = () => JSON.stringify([title.value.trim(), col.value, draft.attrs, draft.show, draft.fields, draft.tags, Array.from(list.querySelectorAll('.lmd-cd-multi-in')).map((i) => i.value.trim()).join('|')]);
    const first = snap(); let asking = false; let escAt = 0;
    const close = () => { box.remove(); };
    // Con cambios sin guardar, Escape pregunta antes de perderlos.
    const tryClose = () => {
      if (asking) return;
      if (ro || snap() === first) { close(); return; }
      asking = true;
      LMD.dialog.confirm({ title: T('Hay cambios sin guardar'), ok: T('Descartarlos'), cancel: T('Seguir editando'), danger: true }).then((yes) => { asking = false; if (yes) close(); });
    };
    const save = () => {
      box.querySelectorAll('input').forEach((i) => { if (i._commit && !i.closest('.lmd-cd-new')) i._commit(); });
      const text = title.value.replace(/\s+/g, ' ').trim();
      if (!text) { fail(T('Escribí un título.')); title.focus(); return; }
      const bad = Object.keys(draft.attrs).find((k) => NAMED.link.test(k) && String(draft.attrs[k]).trim() && !isUrl(String(draft.attrs[k]).trim()));
      if (bad) { fail(T('El enlace empieza con http:// o https://')); const i = list.querySelector('[data-cd-val="' + CSS.escape(bad) + '"]'); if (i) { i.hidden = false; i.focus(); } return; }
      const to = model.columns[+col.value] ? +col.value : ci;
      const before = JSON.stringify([card.text, card.done, card.attrs, ci]);
      const attrs = {}; Object.keys(draft.attrs).forEach((k) => { const v = String(draft.attrs[k]).replace(/\s+/g, ' ').trim().slice(0, 500); if (v) attrs[k] = v; });
      card.text = text; card.attrs = attrs;
      if (fresh) { model.columns[to].cards.push(card); settle(model, card, to); }
      else if (to !== ci) { const from = model.columns[ci].cards; const i = from.indexOf(card); if (i >= 0) from.splice(i, 1); model.columns[to].cards.push(card); settle(model, card, to); }
      // Lo que el tablero muestra, los tipos y los colores son del tablero: quedan aunque esta tarjeta no tenga el campo.
      model.show = draft.show.filter((k) => KEY.test(k)); model.fields = draft.fields; model.tags = draft.tags;
      if (!fresh && JSON.stringify([card.text, card.done, card.attrs, to]) !== before) touch(card);
      close(); write(board, card.id);
    };
    box.addEventListener('click', (e) => {
      const t = e.target; const rm = t.closest('[data-cd-rm]'); const use = t.closest('[data-cd-use]'); const type = t.closest('[data-cd-type]'); const b = t.closest('button[data-cd]');
      if (rm) { remove(rm.dataset.cdRm); return; }
      if (use) { const k = use.dataset.cdUse; step = { stage: 'value', key: k, kind: kindOf(draft.fields, k, sample(k)) }; drawAdd(); return; }
      if (type) { const def = TYPES.find((x) => x[0] === type.dataset.cdType); step = { stage: 'value', key: def[3] ? T(def[3]) : '', kind: def[1] }; drawAdd(); return; }
      if (!b) return;
      const d = b.dataset.cd;
      // El botón cierra sin preguntar. El clic que llega solo, por Escape con el foco afuera, pregunta si hay cambios.
      if (d === 'no') { if (e.isTrusted) close(); else if (Date.now() - escAt > 400) tryClose(); }
      else if (d === 'ok') save();
      else if (d === 'add-open') { fail(''); step = { stage: 'type' }; drawAdd(); }
      else if (d === 'add-cancel') { fail(''); step = null; drawAdd(true); }
      else if (d === 'add') commitAdd();
      else if (d === 'undo') restore();
      else if (d === 'del') {
        const name = card.text.length > 60 ? card.text.slice(0, 59) + '…' : card.text;
        LMD.dialog.confirm({ title: T('¿Eliminar la tarjeta "{a}"?', { a: name }), ok: T('Eliminar'), danger: true }).then((yes) => {
          if (!yes) return;
          close(); const from = model.columns[ci].cards; const i = from.indexOf(card); if (i >= 0) from.splice(i, 1); write(board);
        });
      }
    });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.lmdDone) return;
      const t = e.target;
      if (e.key === 'Escape') { e.preventDefault(); escAt = Date.now(); if (step) { fail(''); step = null; drawAdd(true); } else tryClose(); }
      else if (e.key !== 'Enter' || ro) return;
      else if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); }
      else if (t.tagName !== 'INPUT' || t.type === 'checkbox') return;
      else if (t.closest('.lmd-cd-new')) {
        e.preventDefault();
        const next = t.dataset.cd === 'name' ? ($('opts') || $('newval')) : t.dataset.cd === 'opts' ? $('newval') : null;
        if (next && (t.dataset.cd !== 'name' || keyFrom(t.value))) next.focus(); else commitAdd();
      } else { e.preventDefault(); save(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) tryClose(); });
    if (fresh || (!ro && !LMD.touch.coarse())) title.focus();
  }

  // Qué campos se ven en las tarjetas de este tablero.
  function openShow(board) {
    const model = board._model; const by = model.columns.some((c) => c.cards.some((k) => k.by));
    const keys = Array.from(new Set(model.show.concat(Object.keys(model.fields), ...model.columns.map((c) => [].concat(...c.cards.map((k) => Object.keys(k.attrs)))), by ? ['by'] : [])));
    const box = el('div', { class: 'lmd-ask lmd-cd' });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true" aria-label="' + T('Campos en las tarjetas') + '"><h3>' + T('Campos en las tarjetas') + '</h3>' +
      (keys.length ? '<div class="lmd-cd-pick">' + keys.map((k) => '<label class="lmd-check"><input type="checkbox" value="' + esc(k) + '"' + (model.show.includes(k) ? ' checked' : '') + '><span>' + esc(label(k)) + '</span></label>').join('') + '</div>'
        : '<p>' + T('Todavía no hay campos. Abrí una tarjeta para agregar el primero.') + '</p>') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-cd="no" data-esc>' + T('Cancelar') + '</button>' + (keys.length ? '<button type="button" class="lmd-btn lmd-btn-fill" data-cd="ok">' + T('Guardar') + '</button>' : '') + '</div></div>';
    document.body.appendChild(box);
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') box.remove(); });
    box.addEventListener('mousedown', (e) => { if (e.target === box) box.remove(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cd]'); if (!b) return;
      if (b.dataset.cd === 'ok') { model.show = Array.from(box.querySelectorAll('input:checked')).map((i) => i.value); box.remove(); write(board); } else box.remove();
    });
  }

  // ---------- Los menús del tablero y de una columna ----------
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function popMenu(btn, kind, items, pick) {
    closeMenu();
    if (!items.length) return;
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow lmd-menu-board lmd-menu-' + kind, role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' + items.map((i) => '<button type="button" role="menuitem" data-bm="' + i[0] + '">' + i[1] + '<span>' + T(i[2]) + '</span></button>').join('') + '</div>';
    menu._for = btn;
    document.body.appendChild(menu);
    const box = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.right - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, box.bottom + 6)) + 'px';
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-bm]'); if (!b) return; closeMenu(); pick(b.dataset.bm); });
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); const all = Array.from(menu.querySelectorAll('button')); const i = all.indexOf(document.activeElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    });
    menu.querySelector('button').focus();
  }
  function boardMenu(btn, board) {
    const cloud = !!core.appRoot && core.appRoot.kind === 'cloud' && core.APP;
    const items = [!core.readOnly && ['show', ICON.eye, 'Campos en las tarjetas…'], cloud && !core.readOnly && ['notify', ICON.spark, 'Avisar cuando cambie una tarjeta…']].filter(Boolean);
    popMenu(btn, 'all', items, (what) => {
      if (what === 'show') openShow(board);
      else core.ensure('automate').then((ok) => { if (ok) LMD.automate.wizard(core, { kind: 'note', path: core.cloudPath, cards: true }); });
    });
  }
  // Renombrar una columna: si era la de hechas, lo sigue siendo con su nombre nuevo.
  function renameCol(model, ci, value) {
    const was = doneIndex(model) === ci; model.columns[ci].title = value;
    if (was && doneIndex(model) !== ci) model.done = value;
  }
  function colMenu(btn, board, ci) {
    if (core.readOnly) return;
    const model = board._model; const cols = model.columns; const isDone = doneIndex(model) === ci;
    popMenu(btn, 'col', [['rename', ICON.pencil, 'Cambiar el nombre'], ['done', ICON.check, isDone ? 'Quitar como columna de hechas' : 'Marcar como columna de hechas'], ['del', ICON.trash, 'Eliminar la columna']], (what) => {
      if (what === 'rename') {
        LMD.dialog.prompt({ title: T('Cambiar el nombre'), value: cols[ci].title, ok: T('Guardar'), validate: (v) => (v.length > 120 ? T('Hasta 120 caracteres.') : '') }).then((v) => { if (v && v !== cols[ci].title) { renameCol(model, ci, v.replace(/\s+/g, ' ')); write(board); } });
      } else if (what === 'done') {
        // Marcarla tilda sus tarjetas; quitarle la marca las destilda. El resto del tablero no cambia.
        model.done = isDone ? '' : cols[ci].title;
        cols[ci].cards.forEach((c) => { if (c.done === isDone) { c.done = !isDone; touch(c); } });
        write(board);
      } else {
        // Una columna con tarjetas se confirma antes: se van con ella.
        const drop = () => { if (model.done != null && model.done !== '' && isDone) delete model.done; cols.splice(ci, 1); write(board); };
        if (!cols[ci].cards.length) drop();
        else LMD.dialog.confirm({ title: T('¿Eliminar la columna "{a}"?', { a: cols[ci].title }), text: T('Se eliminan también sus tarjetas.'), ok: T('Eliminar'), danger: true }).then((yes) => { if (yes) drop(); });
      }
    });
  }

  function bind(article) {
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.lmd-board-menu, .lmd-col-menu')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (menu && e.key === 'Escape') { const back = menu._for; closeMenu(); if (back && back.isConnected) back.focus(); } });
    // Un clic abre la tarjeta; arrastrarla, no. Si el puntero se movió más que un temblor, no fue un clic.
    let press = null;
    article.addEventListener('pointerdown', (e) => { press = e.target.closest && e.target.closest('.lmd-card') ? { x: e.clientX, y: e.clientY, moved: false } : null; }, true);
    window.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press.moved = true; }, true);
    article.addEventListener('click', (e) => {
      const t = e.target; if (!t.closest || !t.closest('.lmd-board')) return;
      const w = where(t); const cols = w.board._cols;
      if (t.closest('.lmd-board-menu')) { if (menu) closeMenu(); else boardMenu(t.closest('.lmd-board-menu'), w.board); }
      else if (t.closest('.lmd-col-menu')) { if (menu) closeMenu(); else colMenu(t.closest('.lmd-col-menu'), w.board, w.ci); }
      else if (t.closest('.lmd-card-add')) openCard(w.board, w.ci, -1);
      else if (t.closest('.lmd-col-add')) { cols.push({ title: T('Columna') + ' ' + (cols.length + 1), cards: [] }); write(w.board); }
      else if (core.editMode && t.closest('.lmd-col-title') && t.closest('.lmd-col-title').contentEditable !== 'plaintext-only') { const s = t.closest('.lmd-col-title'); s.contentEditable = 'plaintext-only'; s.focus(); getSelection().selectAllChildren(s); }
      // Clic en la tarjeta (fuera de un enlace): su detalle.
      else if (t.closest('.lmd-card') && !t.closest('a')) { const moved = press && press.moved; press = null; if (!moved) openCard(w.board, w.ci, w.ki); }
    });
    article.addEventListener('keydown', (e) => {
      if (e.target.classList && e.target.classList.contains('lmd-card') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const w = where(e.target); openCard(w.board, w.ci, w.ki); return; }
      const span = e.target.closest && e.target.closest('.lmd-col-title');
      if (!span || span.contentEditable !== 'plaintext-only') return;
      if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); span._cancel = true; span.blur(); }
    });
    article.addEventListener('focusout', (e) => {
      const span = e.target.closest && e.target.closest('.lmd-col-title');
      if (!span || span.contentEditable !== 'plaintext-only') return;
      const w = where(span); const cols = w.board._cols; const value = span.textContent.replace(/\s+/g, ' ').trim();
      if (span._cancel) { core.render(); return; }
      if (!value || value === cols[w.ci].title) { span.contentEditable = 'false'; span.textContent = cols[w.ci].title; return; }
      renameCol(w.board._model, w.ci, value);
      write(w.board);
    });

    // Arrastrar una tarjeta a otra columna o a otra posición.
    let drag = null;
    article.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.lmd-card'); if (!card) return;
      if (core.readOnly) { e.preventDefault(); return; }
      if (press) press.moved = true;
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
      // Cambiar de columna es cambiar de estado: la tarjeta queda editada ahora, y hecha si entró a la de hechas.
      if (to !== drag.ci) { settle(drag.board._model, moved, to); touch(moved); }
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

  LMD.board = { init, calcTables, totalsRow, formulaOf, fit: fitAll, model: { parse, serialize, stamp, doneIndex } };
})();
