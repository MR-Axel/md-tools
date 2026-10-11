// Listas que se portan como en un procesador de textos, al editar sobre el elemento y en la vista de código:
// los números de una lista se ponen al día cuando se le agrega, saca o mueve un ítem; Tab y Shift+Tab sangran un
// ítem o lo sacan un nivel, con sus hijos; Enter en un ítem vacío sale un nivel, y Alt+flechas lo mueven.
// Todo trabaja sobre las líneas del Markdown. La estructura (qué es una lista, qué ítem cuelga de cuál) la da el
// mismo analizador que dibuja la nota (markdown-it): así un "1." dentro de un bloque de código nunca es un ítem.
(function () {
  'use strict';

  let core = null;
  let parser = null;
  const md = () => parser || (parser = window.markdownit());

  // Una línea que abre un ítem: 1 las citas, 2 la sangría, 3 la viñeta, 4 el número, 5 su punto o paréntesis,
  // 6 el espacio que sigue, 7 la casilla de una tarea.
  const ITEM = /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)(\[[ xX]\](?=[ \t]|$))?/;
  const QUOTE = /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)/;
  const markOf = (m) => m[3] || m[4] + m[5];
  // La columna donde empieza el texto del ítem, contada desde el fin de las citas: ahí va lo que cuelga de él.
  const textCol = (m) => m[2].length + markOf(m).length + (m[6].length >= 1 && m[6].length <= 4 ? m[6].length : 1);
  const blankLine = (l) => l == null || !l.trim();

  // ---------- La estructura ----------
  // Las listas de un texto, de afuera hacia adentro: { ordered, s, e, items, parent (el ítem del que cuelga), root }.
  // Cada ítem: { s, e, list, kids (sus sublistas), m (su línea, partida con ITEM) }. Las líneas son las del archivo.
  function parse(lines, from) {
    from = from || 0;
    let tokens; try { tokens = md().parse(lines.slice(from).join('\n'), {}); } catch (e) { return []; }
    const lists = []; const stack = [];
    tokens.forEach((t) => {
      if (t.type === 'ordered_list_open' || t.type === 'bullet_list_open') {
        let parent = null; for (let i = stack.length - 1; i >= 0 && !parent; i--) if (stack[i].kids) parent = stack[i];
        const list = { ordered: t.type === 'ordered_list_open', s: t.map[0] + from, e: t.map[1] + from, items: [], parent };
        list.root = parent ? parent.list.root : list;
        if (parent) parent.kids.push(list);
        lists.push(list); stack.push(list);
      } else if (t.type === 'list_item_open') {
        const list = stack[stack.length - 1]; if (!list || !list.items) return;
        const it = { s: t.map[0] + from, e: t.map[1] + from, list, kids: [] };
        it.m = ITEM.exec(lines[it.s] || '');
        // Un ítem que nace en la misma línea que su padre ("- 1. texto") no tiene una línea propia: no se toca.
        if (!it.m || !markOf(it.m) || (list.parent && list.parent.s === it.s) || !!it.m[4] !== list.ordered) it.m = null;
        list.items.push(it); stack.push(it);
      } else if (t.type === 'list_item_close' || t.type === 'ordered_list_close' || t.type === 'bullet_list_close') stack.pop();
    });
    return lists;
  }
  // El ítem más de adentro que ocupa esa línea.
  function itemAt(lists, line) {
    let best = null;
    lists.forEach((l) => l.items.forEach((it) => { if (it.s <= line && line < it.e && (!best || it.s >= best.s)) best = it; }));
    return best;
  }
  const rootAt = (lists, line) => { const tops = lists.filter((l) => !l.parent); return tops.find((l) => l.s <= line && line < l.e) || tops.find((l) => l.s <= line && line <= l.e) || null; };

  // ---------- Cambios sobre las líneas ----------
  // Corre la sangría de unas líneas (después de sus citas), sin tocar las que están en blanco.
  function shift(lines, s, e, delta) {
    if (!delta) return;
    for (let i = s; i < e; i++) {
      if (blankLine(lines[i])) continue;
      const m = QUOTE.exec(lines[i]); const lead = m[2].replace(/\t/g, '    ');
      const next = delta > 0 ? lead + ' '.repeat(delta) : lead.slice(0, Math.max(0, lead.length + delta));
      lines[i] = m[1] + next + lines[i].slice(m[0].length);
    }
  }
  // Cambia la sangría y la marca de un ítem. Lo que cuelga de él lo acompaña: se corre lo mismo que su texto.
  function restyle(lines, it, indent, mark) {
    const m = ITEM.exec(lines[it.s]); if (!m) return;
    const lead = m[2].replace(/\t/g, '    '); const to = indent == null ? lead.length : indent; const tag = mark || markOf(m);
    const gap = m[6] || ' ';
    const before = textCol(m) - m[2].length + lead.length;
    lines[it.s] = m[1] + ' '.repeat(to) + tag + gap + lines[it.s].slice(m[1].length + m[2].length + markOf(m).length + m[6].length);
    const after = to + tag.length + (gap.length <= 4 ? gap.length : 1);
    shift(lines, it.s + 1, it.e, after - before);
  }
  const numberOf = (lines, it) => { const m = ITEM.exec(lines[it.s] || ''); return m && m[4] ? parseInt(m[4], 10) : null; };

  // Los números de las listas numeradas, seguidos desde el primero de cada una (que es el que manda).
  // Con at, solo la lista que ocupa esa línea, con sus sublistas. Devuelve las líneas nuevas, o null si no cambia nada.
  function renumber(lines, from, at) {
    const out = lines.slice(); let lists = parse(out, from);
    let root = null; if (at != null) { root = rootAt(lists, at); if (!root) return null; }
    const todo = lists.filter((l) => l.ordered && (!root || l.root === root)).length;
    // Cambiar el ancho de un número ("9." a "10.") corre lo que cuelga del ítem: tras cada lista se vuelve a leer.
    for (let k = 0; k < todo; k++) {
      const list = lists.filter((l) => l.ordered && (!root || l.root === root))[k]; if (!list) break;
      const first = list.items[0] && list.items[0].m ? numberOf(out, list.items[0]) : null; if (first == null) continue;
      let wide = false;
      list.items.forEach((it, i) => {
        if (!it.m) return; const now = ITEM.exec(out[it.s]); if (!now || !now[4]) return;
        const want = String(first + i); if (now[4] === want) return;
        if (want.length !== now[4].length) wide = true;
        restyle(out, it, null, want + now[5]);
      });
      if (wide) { lists = parse(out, from); if (root) root = rootAt(lists, at); }
    }
    return out.some((l, i) => l !== lines[i]) ? out : null;
  }
  const settle = (out, from, at) => renumber(out, from, at) || out;

  // Sangra un ítem: pasa a colgar del de arriba (al final de su sublista, si ya tiene una), con todo lo suyo.
  function indent(lines, from, at) {
    const out = lines.slice(); const it = itemAt(parse(out, from), at); if (!it || !it.m) return null;
    const i = it.list.items.indexOf(it); const prev = it.list.items[i - 1]; if (!prev || !prev.m) return null;
    const sub = prev.kids[prev.kids.length - 1]; const like = sub && sub.items[sub.items.length - 1];
    let to; let mark;
    if (like && like.m) {
      // Se suma a la sublista que ya está: con su sangría y su tipo de marca.
      to = like.m[2].replace(/\t/g, '    ').length;
      mark = like.m[3] || ((numberOf(out, like) || 0) + 1) + like.m[5];
    } else {
      to = textCol(prev.m) - prev.m[2].length + prev.m[2].replace(/\t/g, '    ').length;
      mark = it.m[3] || '1' + it.m[5];
    }
    restyle(out, it, to, mark);
    return { lines: settle(out, from, at), at: it.s };
  }

  // Saca un ítem un nivel: pasa a ser hermano del que lo contenía. Los que venían después de él en la sublista
  // quedan colgando de él, como en un procesador de textos.
  function outdent(lines, from, at) {
    const out = lines.slice(); const it = itemAt(parse(out, from), at); if (!it || !it.m) return null;
    const up = it.list.parent; if (!up || !up.m) return null;
    const i = it.list.items.indexOf(it); const rest = it.list.items.slice(i + 1);
    const lead = it.m[2].replace(/\t/g, '    ').length; const to = up.m[2].replace(/\t/g, '    ').length;
    const mark = up.m[3] || ((numberOf(out, up) || 0) + 1) + up.m[5];
    // Los hermanos que siguen pasan a ser sus hijos: van a la columna de su texto, y arrancan de 1 si son los primeros.
    const mine = to + mark.length + (it.m[6].length >= 1 && it.m[6].length <= 4 ? it.m[6].length : 1);
    if (rest.length) {
      if (!it.kids.length && rest[0].m && rest[0].m[4]) restyle(out, rest[0], null, '1' + rest[0].m[5]);
      shift(out, rest[0].s, it.list.e, mine - lead);
    }
    restyle(out, it, to, mark);
    return { lines: settle(out, from, at), at: it.s };
  }

  // Saca un ítem de la lista: queda como un párrafo, separado de lo que tenga arriba y abajo.
  function unlist(lines, from, at) {
    const out = lines.slice(); const it = itemAt(parse(out, from), at); if (!it || !it.m || it.kids.length || it.list.parent) return null;
    let e = it.e; while (e - 1 > it.s && blankLine(out[e - 1])) e--;
    const m = it.m; const col = textCol(m);
    const body = out.slice(it.s, e);
    body[0] = m[1] + body[0].slice(m[0].length).replace(/^[ \t]+/, '');
    for (let k = 1; k < body.length; k++) { const q = QUOTE.exec(body[k]); const lead = q[2].replace(/\t/g, '    '); body[k] = q[1] + lead.slice(Math.min(col, lead.length)) + body[k].slice(q[0].length); }
    const i = it.list.items.indexOf(it); const next = it.list.items[i + 1];
    // Los que siguen quedan como una lista aparte, que continúa la cuenta desde el número que tenía este.
    if (next && next.m && next.m[4]) restyle(out, next, null, m[4] + next.m[5]);
    const pre = i > 0 && !blankLine(out[it.s - 1]) ? [m[1].trimEnd()] : [];
    const post = next && !blankLine(out[e]) ? [m[1].trimEnd()] : [];
    out.splice(it.s, e - it.s, ...pre, ...body, ...post);
    const to = it.s + pre.length;
    return { lines: next ? settle(out, from, to + body.length + post.length) : out, at: to };
  }

  // Borra un ítem sin hijos. back: la línea del ítem que queda arriba (para dejar ahí el cursor), o -1.
  function remove(lines, from, at) {
    const out = lines.slice(); const lists = parse(out, from); const it = itemAt(lists, at); if (!it || !it.m || it.kids.length) return null;
    const i = it.list.items.indexOf(it); const last = i === it.list.items.length - 1;
    let e = it.e; if (last) while (e - 1 > it.s && blankLine(out[e - 1])) e--;
    let s = it.s; if (last && i > 0) while (s - 1 >= 0 && blankLine(out[s - 1])) s--; // el renglón en blanco que lo separaba
    const prev = i > 0 ? it.list.items[i - 1] : it.list.parent; const next = it.list.items[i + 1];
    // Sin el primero, la lista sigue arrancando en el mismo número.
    if (i === 0 && next && next.m && next.m[4]) restyle(out, next, null, it.m[4] + next.m[5]);
    out.splice(s, e - s);
    let back = -1;
    if (prev) { back = prev.s; if (i > 0) { let p = prev; while (p.kids.length) { const k = p.kids[p.kids.length - 1]; p = k.items[k.items.length - 1]; } back = p.s; } }
    return { lines: renumber(out, from, s) || renumber(out, from, Math.max(from, s - 1)) || out, back, prev: i > 0 ? prev.s : -1, at: s };
  }

  // Mueve un ítem (con sus hijos) un lugar arriba o abajo entre sus hermanos. El número con que arranca la lista queda.
  function move(lines, from, at, dir) {
    const out = lines.slice(); const it = itemAt(parse(out, from), at); if (!it || !it.m) return null;
    const i = it.list.items.indexOf(it); const other = it.list.items[i + dir]; if (!other || !other.m) return null;
    const a = dir < 0 ? other : it; const b = dir < 0 ? it : other;
    if (it.list.ordered) { const na = ITEM.exec(out[a.s]); const nb = ITEM.exec(out[b.s]); if (na[4] !== nb[4]) { restyle(out, a, null, nb[4] + na[5]); restyle(out, b, null, na[4] + nb[5]); } }
    const cut = (x) => { const c = out.slice(x.s, x.e); const tail = []; while (c.length > 1 && blankLine(c[c.length - 1])) tail.unshift(c.pop()); return [c, tail]; };
    const [ca, ta] = cut(a); const [cb, tb] = cut(b);
    out.splice(a.s, b.e - a.s, ...cb, ...ta, ...ca, ...tb);
    const to = dir < 0 ? a.s : a.s + cb.length + ta.length;
    return { lines: settle(out, from, to), at: to };
  }

  // La marca del ítem que sigue a uno: misma sangría y mismo tipo, con el número siguiente y la casilla sin tildar.
  function nextMark(line) {
    const m = ITEM.exec(line); if (!m || !markOf(m)) return '';
    return m[1] + m[2] + (m[3] || (parseInt(m[4], 10) + 1) + m[5]) + (m[6] || ' ') + (m[7] ? '[ ] ' : '');
  }
  // La marca del primer hijo de un ítem: en la columna de su texto, del mismo tipo, arrancando de 1.
  function childMark(line) {
    const m = ITEM.exec(line); if (!m || !markOf(m)) return '';
    return m[1] + ' '.repeat(textCol(m) - m[2].length + m[2].replace(/\t/g, '    ').length) + (m[3] || '1' + m[5]) + ' ' + (m[7] ? '[ ] ' : '');
  }
  const isEmptyItem = (line) => { const m = ITEM.exec(line); return !!m && !!markOf(m) && !line.slice(m[0].length).trim(); };

  // ---------- Varios ítems a la vez (blocks.js) ----------
  // Cada operación recibe las líneas donde empiezan los ítems marcados, que son hermanos (cuelgan de la misma
  // lista), y devuelve { lines, at }: las líneas nuevas y dónde quedó cada ítem. Un ítem va con lo que cuelga de él.
  // Dentro de una cita, un renglón que solo tiene el ">" cuenta como en blanco.
  const hollow = (l) => l == null || /^(?:[ \t]{0,3}>[ \t]?)*[ \t]*$/.test(l);
  const wide = (s) => s.replace(/\t/g, '    ').length;
  function pick(lines, from, starts) {
    const lists = parse(lines, from); const set = new Set(starts); let list = null; const items = [];
    for (const l of lists) for (const it of l.items) if (set.has(it.s) && it.m) { if (!list) list = l; if (it.list === list) items.push(it); }
    return list ? { list, items, lists } : null;
  }
  // Los renglones de cada ítem de una lista. En una lista con renglones en blanco entre ítems (loose), esos
  // renglones no son de ningún ítem: se vuelven a poner al escribirla.
  function chunks(lines, list) {
    const last = list.items[list.items.length - 1]; let end = list.e;
    while (end - 1 > last.s && hollow(lines[end - 1])) end--;
    let loose = false;
    const parts = list.items.map((it, i) => { const c = lines.slice(it.s, i + 1 < list.items.length ? list.items[i + 1].s : end); while (c.length > 1 && hollow(c[c.length - 1])) { c.pop(); loose = true; } return c; });
    return { s: list.items[0].s, e: end, parts, loose, gap: list.items[0].m ? list.items[0].m[1].replace(/[ \t]+$/, '') : '' };
  }
  // Escribe la lista con esos renglones por ítem (parts). La cuenta sigue arrancando en el número que tenía.
  // Sin ítems, la lista se va entera. Devuelve las líneas y dónde empieza cada parte.
  function relist(lines, from, list, c, parts) {
    const out = lines.slice(); const at = []; const body = [];
    const first = list.ordered && list.items[0].m ? numberOf(lines, list.items[0]) : null;
    parts.forEach((p, n) => { if (n && c.loose) body.push(c.gap); at.push(c.s + body.length); p.forEach((l) => body.push(l)); });
    if (!parts.length) {
      let s = c.s; let n = c.e - c.s; const edge = (i) => i < from || i >= out.length || hollow(out[i]);
      if (list.parent) while (s - 1 > list.parent.s && hollow(out[s - 1])) { s--; n++; }
      else if (edge(s - 1) && edge(c.e)) { if (c.e < out.length) n++; else if (s > from) { s--; n++; } }
      out.splice(s, n);
      return { lines: list.parent ? settle(out, from, list.parent.s) : out, at, gone: list.parent ? null : { s, n } };
    }
    out.splice(c.s, c.e - c.s, ...body);
    const m = ITEM.exec(out[c.s]);
    if (first != null && m && m[4] && parseInt(m[4], 10) !== first) restyle(out, { s: c.s, e: c.s + parts[0].length }, null, first + m[5]);
    return { lines: settle(out, from, c.s), at };
  }
  // order: qué ítem va en cada lugar (un índice repetido es una copia). keep: los lugares que quedan marcados.
  function reorder(lines, from, p, order, keep) {
    const c = chunks(lines, p.list); const r = relist(lines, from, p.list, c, order.map((i) => c.parts[i]));
    return { lines: r.lines, at: keep.map((k) => r.at[k]), gone: r.gone || null };
  }
  const flags = (p) => { const on = new Set(p.items); return p.list.items.map((it) => on.has(it)); };
  function removeItems(lines, from, starts) {
    const p = pick(lines, from, starts); if (!p) return null; const sel = flags(p);
    return reorder(lines, from, p, sel.map((x, i) => i).filter((i) => !sel[i]), []);
  }
  // La copia va debajo de cada tramo de ítems seguidos, y es la que queda marcada.
  function copyItems(lines, from, starts) {
    const p = pick(lines, from, starts); if (!p) return null; const sel = flags(p); const order = []; const keep = []; let run = [];
    sel.forEach((x, i) => { order.push(i); if (x) run.push(i); if (run.length && (!x || !sel[i + 1])) { run.forEach((k) => { keep.push(order.length); order.push(k); }); run = []; } });
    return reorder(lines, from, p, order, keep);
  }
  // Un lugar arriba o abajo: cada tramo cambia de lugar con el ítem que tiene al lado.
  function moveItems(lines, from, starts, dir) {
    const p = pick(lines, from, starts); if (!p) return null; const sel = flags(p); const n = sel.length;
    const order = sel.map((x, i) => i); let moved = false;
    for (let k = dir < 0 ? 1 : n - 2; k >= 0 && k < n; k -= dir) {
      const o = k + dir;
      if (sel[order[k]] && !sel[order[o]]) { const t = order[k]; order[k] = order[o]; order[o] = t; moved = true; }
    }
    if (!moved) return null;
    return reorder(lines, from, p, order, order.map((i, k) => (sel[i] ? k : -1)).filter((k) => k >= 0));
  }
  // Arrastrando: los marcados van juntos antes del ítem que está en ese lugar de la lista (o al final).
  function placeItems(lines, from, starts, before) {
    const p = pick(lines, from, starts); if (!p) return null; const sel = flags(p);
    const order = []; const keep = []; const mine = sel.map((x, i) => i).filter((i) => sel[i]);
    const put = () => mine.forEach((i) => { keep.push(order.length); order.push(i); });
    sel.forEach((x, i) => { if (i === before) put(); if (!x) order.push(i); });
    if (before >= sel.length || before < 0) put();
    if (order.every((i, k) => i === k)) return null;
    return reorder(lines, from, p, order, keep);
  }
  // Tab y Mayúsculas + Tab sobre el grupo: de arriba hacia abajo, cada uno como si tuviera el cursor.
  function shiftItems(lines, from, starts, dir) {
    const p = pick(lines, from, starts); if (!p) return null;
    if (dir > 0 ? p.list.items.indexOf(p.items[0]) === 0 : !p.list.parent || !p.list.parent.m) return null;
    let cur = lines; let any = false;
    p.items.map((it) => it.s).forEach((s) => { const r = (dir > 0 ? indent : outdent)(cur, from, s); if (r) { cur = r.lines; any = true; } });
    return any ? { lines: cur, at: p.items.map((it) => it.s) } : null;
  }
  // Pasa los ítems marcados a viñetas (ul), números (ol) o tareas (task). Los que no están marcados quedan como
  // estaban: si cambia el tipo de lista, Markdown los lee como listas aparte.
  function convertItems(lines, from, starts, kind) {
    const p = pick(lines, from, starts); if (!p) return null; const out = lines.slice();
    // De abajo hacia arriba: cambiar el ancho de una marca corre lo que cuelga de ese ítem y nada más.
    p.items.slice().reverse().forEach((it) => {
      const m = ITEM.exec(out[it.s]); if (!m) return;
      const text = out[it.s].slice(m[0].length).replace(m[7] ? /^[ \t]+/ : /^/, '');
      const box = kind === 'task' ? (m[7] || '[ ]') + (text ? ' ' : '') : '';
      out[it.s] = m[1] + m[2] + markOf(m) + (m[6] || ' ') + box + text;
      const mark = kind === 'ol' ? (m[4] ? m[4] + m[5] : '1.') : (m[3] || '-');
      if (mark !== markOf(m)) restyle(out, it, null, mark);
    });
    let cur = out; p.items.forEach((it) => { cur = settle(cur, from, it.s); });
    return cur.some((l, i) => l !== lines[i]) ? { lines: cur, at: p.items.map((it) => it.s) } : null;
  }
  // Las tareas que hay en los ítems marcados y en lo que cuelga de ellos.
  function tasksIn(lines, from, starts) {
    const p = pick(lines, from, starts); if (!p) return [];
    const out = [];
    p.lists.forEach((l) => l.items.forEach((it) => { const m = it.m && ITEM.exec(lines[it.s]); if (m && m[7] && p.items.some((x) => it.s >= x.s && it.s < x.e)) out.push({ s: it.s, done: /x/i.test(m[7]) }); }));
    return out;
  }
  function checkItems(lines, from, starts, on) {
    const todo = tasksIn(lines, from, starts).filter((t) => t.done !== on); if (!todo.length) return null;
    const out = lines.slice();
    todo.forEach((t) => { const m = ITEM.exec(out[t.s]); const head = m[0].length - m[7].length; out[t.s] = out[t.s].slice(0, head) + (on ? '[x]' : '[ ]') + out[t.s].slice(m[0].length); });
    return { lines: out, at: starts.slice() };
  }
  // Los ítems marcados como una lista suelta: desde la columna 0, sin las citas, contando desde 1.
  function liftItems(lines, from, starts) {
    const p = pick(lines, from, starts); if (!p) return null; const c = chunks(lines, p.list); const sel = flags(p);
    const first = p.items[0].m; const depth = (first[1].match(/>/g) || []).length; const base = wide(first[2]);
    const body = [];
    sel.forEach((x, i) => {
      if (!x) return; if (body.length && c.loose) body.push('');
      c.parts[i].forEach((l) => {
        let t = l; for (let k = 0; k < depth; k++) t = t.replace(/^[ \t]{0,3}>[ \t]?/, '');
        const lead = /^[ \t]*/.exec(t)[0]; const w = wide(lead);
        body.push(t.trim() ? ' '.repeat(Math.max(0, w - base)) + t.slice(lead.length) : '');
      });
    });
    const m = ITEM.exec(body[0] || ''); const made = parse(body, 0)[0];
    if (m && m[4] && m[4] !== '1' && made && made.items[0]) restyle(body, made.items[0], null, '1' + m[5]);
    return settle(body, 0);
  }
  // El texto es una sola lista y nada más: se puede pegar como ítems.
  function single(body) {
    const tops = parse(body, 0).filter((l) => !l.parent); if (tops.length !== 1 || tops[0].items.some((it) => !it.m)) return null;
    const a = body.findIndex((l) => l.trim()); let b = body.length; while (b > 0 && !body[b - 1].trim()) b--;
    return tops[0].s === a && tops[0].e >= b ? tops[0] : null;
  }
  // Pone una lista suelta (body) como ítems hermanos, debajo del ítem que empieza en at: con su sangría, sus citas
  // y su tipo de marca. Las casillas de las tareas quedan como venían.
  function insertItems(lines, from, at, body) {
    const p = pick(lines, from, [at]); const src = single(body); if (!p || !src) return null;
    const it = p.items[0]; const b = body.slice();
    src.items.forEach((x) => restyle(b, x, null, p.list.ordered ? '1' + it.m[5] : it.m[3]));
    const again = single(b); if (!again) return null;
    const pad = ' '.repeat(wide(it.m[2])); const q = it.m[1]; const bare = q.replace(/[ \t]+$/, '');
    const fresh = chunks(b, again).parts.map((part) => part.map((l) => (l.trim() ? q + pad + l : bare)));
    const c = chunks(lines, p.list); const i = p.list.items.indexOf(it);
    const parts = c.parts.slice(0, i + 1).concat(fresh, c.parts.slice(i + 1));
    const r = relist(lines, from, p.list, c, parts);
    return { lines: r.lines, at: fresh.map((x, k) => r.at[i + 1 + k]) };
  }

  // ---------- Listas vecinas ----------
  // Dos listas del mismo tipo, con la misma marca y solo renglones en blanco en el medio, son una sola para
  // Markdown. Cuando un cambio (mover, duplicar, pegar o sacar el bloque que las separaba) deja pegadas dos que
  // eran listas distintas, una cambia de marca: "-" por "*" o "+", y "1." por "1)". Es lo que CommonMark define
  // como el comienzo de otra lista; no agrega líneas y se lee igual en GitHub. Un comentario "<!-- -->" en el
  // medio también las separa, pero queda como una línea suelta cuando las listas vuelven a alejarse, y sin HTML
  // habilitado se lee como texto.
  // origins: de qué lista de primer nivel es cada línea (0: de ninguna).
  function origins(lines, from) {
    const out = new Array(lines.length).fill(0);
    parse(lines, from).filter((l) => !l.parent).forEach((l, k) => { for (let i = l.s; i < l.e && i < out.length; i++) out[i] = k + 1; });
    return out;
  }
  // tags: el origen de cada línea de ahora (las que no estaban, uno que no sea de ninguna lista de antes).
  // fresh(i): esa línea es de lo que se movió o se creó; entre dos listas, cambia la marca de esa.
  function apart(lines, from, tags, fresh) {
    let out = null;
    for (let pass = 0; pass < 6; pass++) {
      const cur = out || lines; const next = cur.slice(); let hit = false;
      const tops = parse(cur, from).filter((l) => !l.parent);
      const charOf = (it) => { const m = ITEM.exec(next[it.s] || ''); return m ? (m[3] || m[5] || '') : ''; };
      // La lista de al lado, si entre las dos solo hay renglones en blanco.
      const beside = (a, b) => { if (!a || !b || a.ordered !== b.ordered) return false; for (let i = a.e; i < b.s; i++) if (!hollow(cur[i])) return false; return true; };
      tops.forEach((list, k) => {
        const segs = [];
        list.items.forEach((it) => { const g = tags[it.s]; const last = segs[segs.length - 1]; if (last && last.g === g) last.items.push(it); else segs.push({ g, items: [it], fresh: !!fresh && fresh(it.s) }); });
        if (segs.length < 2 || list.items.some((it) => !it.m)) return;
        const pool = list.ordered ? ['.', ')'] : ['-', '*', '+'];
        const marks = segs.map((s) => charOf(s.items[0]));
        const before = beside(tops[k - 1], list) ? charOf(tops[k - 1].items[tops[k - 1].items.length - 1]) : '';
        const after = beside(list, tops[k + 1]) ? charOf(tops[k + 1].items[0]) : '';
        for (let i = 1; i < segs.length; i++) {
          if (marks[i] !== marks[i - 1]) continue;
          const j = i === 1 && segs[0].fresh && !segs[1].fresh ? 0 : i;
          const left = j > 0 ? marks[j - 1] : before; const right = j + 1 < segs.length ? marks[j + 1] : after;
          const to = pool.find((c) => c !== left && c !== right) || pool.find((c) => c !== (j === i ? left : right));
          if (!to || to === marks[j]) continue;
          marks[j] = to; hit = true;
          segs[j].items.forEach((it) => { const m = ITEM.exec(next[it.s]); if (m) restyle(next, it, null, m[3] ? to : m[4] + to); });
        }
      });
      if (!hit) break;
      out = next;
    }
    return out;
  }

  // ---------- Sobre el elemento ----------
  const fm = () => core.fmOffset;
  const itemText = (node) => {
    if (!node || !node.classList || !node.classList.contains('lmd-editable')) return null;
    if (node.classList.contains('lmd-li-text')) return node.closest('li');
    // En una lista con renglones en blanco el texto del ítem es su primer párrafo.
    const li = node.parentNode && node.parentNode.tagName === 'LI' ? node.parentNode : null;
    return li && li.querySelector(':scope > p') === node ? li : null;
  };
  const caretOf = (node) => { const sel = getSelection(); if (!sel.rangeCount || !node.contains(sel.focusNode)) return -1; const r = document.createRange(); r.selectNodeContents(node); r.setEnd(sel.focusNode, sel.focusOffset); return r.toString().length; };
  function caretAt(node, offset) {
    node.focus(); const sel = getSelection();
    if (offset >= 0) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let n; let left = offset;
      while ((n = walker.nextNode())) { if (left <= n.nodeValue.length) { sel.collapse(n, left); return; } left -= n.nodeValue.length; }
    }
    sel.selectAllChildren(node); sel.collapseToEnd();
  }
  // El texto editable del bloque que empieza en esa línea del archivo.
  function editableAt(abs) {
    const made = core.ui.article.querySelector('li[data-l^="' + (abs - fm()) + '-"]') || core.ui.article.querySelector('[data-l^="' + (abs - fm()) + '-"]');
    if (!made) return null;
    return made.matches('.lmd-editable') ? made : made.querySelector(':scope > .lmd-editable') || made.querySelector('.lmd-editable');
  }
  // Escribe el resultado en el archivo como un solo cambio (un solo Ctrl+Z) y redibuja.
  function commit(next) {
    const old = core.srcLines; let a = 0; while (a < old.length && a < next.length && old[a] === next[a]) a++;
    let b = 0; while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    if (a === old.length && a === next.length) return false;
    core.spliceLines(a, old.length - a - b, next.slice(a, next.length - b));
    core.render();
    return true;
  }
  // Hace un cambio sobre el ítem que tiene el cursor y lo deja en el mismo lugar del texto.
  function act(node, what, dir) {
    const li = itemText(node); const r = li && core.rangeOf(li); if (!r) return false;
    core.commitBlock(node);
    const at = r[0] + fm(); const offset = caretOf(node);
    const fn = { indent, outdent, unlist, remove, move }[what];
    const res = fn(core.srcLines, fm(), at, dir); if (!res) return false;
    node._md = null; node._typed = false; node.blur();
    if (!commit(res.lines)) return false;
    if (what === 'remove') {
      const prev = res.back >= 0 ? editableAt(res.back) : null;
      if (prev) caretAt(prev, -1);
      return true;
    }
    const again = editableAt(res.at);
    if (again) caretAt(again, offset);
    return true;
  }
  const atStart = (node) => { const sel = getSelection(); return sel.rangeCount && sel.isCollapsed && caretOf(node) === 0; };
  const nested = (li) => !!li && !!li.parentNode && !!li.parentNode.parentNode && li.parentNode.parentNode.tagName === 'LI';

  function onKey(e) {
    if (!core.editMode || !core.blocks || e.isComposing) return;
    const node = e.target.closest && e.target.closest('.lmd-editable'); if (!node) return;
    const mods = e.ctrlKey || e.metaKey;
    const draft = node.classList.contains('lmd-draft');
    const li = draft ? (node.classList.contains('lmd-li-text') ? node.closest('li') : null) : itemText(node);
    if (!li) return;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    const empty = !node.textContent.replace(/​/g, '').trim();
    if (e.key === 'Tab' && !mods && !e.altKey) {
      done();
      if (!draft) { act(node, e.shiftKey ? 'outdent' : 'indent'); return; }
      // Un ítem nuevo que todavía no tiene texto no está en el archivo: se acomoda en pantalla y nace ya en su nivel.
      if (empty) { LMD.write.nest(node, e.shiftKey ? -1 : 1); return; }
      const made = LMD.write.settle(node); if (made) act(made, e.shiftKey ? 'outdent' : 'indent');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mods && !e.altKey && empty) {
      // Enter en un ítem vacío: si está sangrado sube un nivel; si no, sale de la lista.
      if (draft) { if (nested(li)) { done(); LMD.write.nest(node, -1); } return; }
      done();
      if (nested(li)) { act(node, 'outdent'); return; }
      leave(node, li);
      return;
    }
    if (e.key === 'Backspace' && !mods && !e.altKey) {
      if (draft) { if (empty && nested(li)) { done(); LMD.write.nest(node, -1); } return; }
      if (!empty && !atStart(node)) return;
      done();
      if (nested(li)) act(node, 'outdent');
      else if (empty) act(node, 'remove');
      else act(node, 'unlist');
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !mods && !e.shiftKey && !draft) { done(); act(node, 'move', e.key === 'ArrowUp' ? -1 : 1); }
  }
  // Un ítem vacío de primer nivel se va de la lista: se borra y queda abierto un párrafo en su lugar.
  function leave(node, li) {
    const list = li.parentNode; const i = Array.prototype.indexOf.call(list.children, li); const count = list.children.length;
    const r = core.rangeOf(li); if (!r) return;
    const res = remove(core.srcLines, fm(), r[0] + fm()); if (!res) return;
    node._md = null; node._typed = false; node.blur();
    if (!commit(res.lines)) return;
    if (count === 1) { LMD.write.open(editableTop(res.at - 1), 'p'); return; }
    const prev = res.prev >= 0 ? core.ui.article.querySelector('li[data-l^="' + (res.prev - fm()) + '-"]') : null;
    if (i === 0 || !prev) {
      const first = core.ui.article.querySelector('[data-l^="' + (res.at - fm()) + '-"]'); const top = first ? LMD.write.top(first) : null;
      LMD.write.open(top ? top.previousElementSibling : null, 'p');
      return;
    }
    // Como al salir de un ítem nuevo: si era el último, el párrafo se abre ya afuera de la lista.
    const here = prev.parentNode;
    LMD.write.open(i === count - 1 && here.parentNode === core.ui.article ? here : prev, 'p');
  }
  // El bloque de primer nivel que termina antes de esa línea.
  function editableTop(abs) {
    let best = null;
    for (const child of core.ui.article.children) { const r = core.rangeOf(child); if (r && r[0] + fm() <= abs) best = child; }
    return best;
  }

  // ---------- En la vista de código ----------
  // El cambio entra como si se lo hubiera tecleado (insertText), para que el deshacer del navegador lo tome de una vez.
  let busy = false;
  const headLines = (text) => { const m = /^﻿?---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(text); return m ? m[0].split('\n').length - 1 : 0; };
  function setArea(ta, next, line, col) {
    const old = ta.value; const text = next.join('\n'); if (old === text) return false;
    let a = 0; while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0; while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    const y = window.scrollY; const top = ta.scrollTop;
    busy = true;
    try {
      ta.focus(); ta.setSelectionRange(a, old.length - b);
      const piece = text.slice(a, text.length - b); let ok = false;
      try { ok = piece ? document.execCommand('insertText', false, piece) : document.execCommand('delete'); } catch (e) { ok = false; }
      if (!ok || ta.value !== text) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    } finally { busy = false; }
    let pos = 0; for (let i = 0; i < line && i < next.length; i++) pos += next[i].length + 1;
    pos += Math.max(0, Math.min(col, (next[Math.min(line, next.length - 1)] || '').length));
    ta.setSelectionRange(pos, pos); ta.scrollTop = top; window.scrollTo(window.scrollX, y);
    return true;
  }
  const where = (ta) => { const before = ta.value.slice(0, ta.selectionStart).split('\n'); return { line: before.length - 1, col: before[before.length - 1].length, endLine: ta.value.slice(0, ta.selectionEnd).split('\n').length - 1 }; };
  function onAreaKey(e) {
    const ta = e.target; if (ta.readOnly || ta.disabled || e.isComposing || e.ctrlKey || e.metaKey) return;
    if (core && (!core.editMode || core.readOnly)) return;
    if (core && !core.blocks) return; // un archivo de código o de datos no es Markdown: sus renglones no son listas
    const lines = ta.value.split('\n'); const from = headLines(ta.value); const w = where(ta);
    const lists = () => parse(lines, from);
    if (e.key === 'Tab' && !e.altKey) {
      // Cada ítem que empieza en lo elegido; sin lista ahí, Tab sigue siendo del navegador.
      const starts = []; lists().forEach((l) => l.items.forEach((it) => { if (it.m && it.s >= w.line && it.s <= w.endLine) starts.push(it.s); }));
      if (!starts.length) { const it = itemAt(lists(), w.line); if (!it || !it.m) return; starts.push(it.s); }
      e.preventDefault();
      let cur = lines;
      Array.from(new Set(starts)).sort((x, y) => x - y).forEach((s) => { const res = (e.shiftKey ? outdent : indent)(cur, from, s); if (res) cur = res.lines; });
      // El cursor queda en el mismo lugar del texto: se corre lo que se corrió su línea.
      setArea(ta, cur, w.line, w.col + cur[w.line].length - lines[w.line].length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && ta.selectionStart === ta.selectionEnd) {
      const it = itemAt(lists(), w.line); if (!it || !it.m || it.s !== w.line) return;
      const line = lines[w.line];
      if (isEmptyItem(line)) {
        // Un ítem vacío: sangrado, sube un nivel; en el primer nivel, se queda sin marca.
        e.preventDefault();
        const up = outdent(lines, from, w.line);
        if (up) { setArea(ta, up.lines, w.line, up.lines[w.line].length); return; }
        const next = lines.slice(); next[w.line] = it.m[1];
        setArea(ta, settle(next, from, Math.max(from, w.line - 1)), w.line, next[w.line].length);
        return;
      }
      if (w.col < it.m[0].length) return;
      e.preventDefault();
      const mark = nextMark(line); const next = lines.slice();
      next.splice(w.line, 1, line.slice(0, w.col).replace(/[ \t]+$/, ''), mark + line.slice(w.col).replace(/^[ \t]+/, ''));
      setArea(ta, settle(next, from, w.line), w.line + 1, mark.length);
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !e.shiftKey) {
      const it = itemAt(lists(), w.line); if (!it || !it.m) return;
      e.preventDefault();
      const res = move(lines, from, it.s, e.key === 'ArrowUp' ? -1 : 1); if (!res) return;
      setArea(ta, res.lines, res.at + (w.line - it.s), w.col);
    }
  }
  // Borrar, cortar o pegar renglones en una lista numerada: sus números se ponen al día.
  let count = -1;
  function onAreaInput(e) {
    const ta = e.target; const n = ta.value.split('\n').length; const was = count; count = n;
    if (busy || was < 0 || n === was || !/^(delete|insertFromPaste|insertFromDrop)/.test(e.inputType || '')) return;
    if (core && (!core.editMode || core.readOnly || !core.blocks)) return;
    const lines = ta.value.split('\n'); const w = where(ta); const from = headLines(ta.value);
    const next = renumber(lines, from, w.line) || (w.line > 0 ? renumber(lines, from, w.line - 1) : null);
    if (next) setArea(ta, next, w.line, w.col);
  }

  function init(c) {
    core = c;
    // Antes que las demás teclas del bloque (Enter abre un bloque nuevo, Backspace descarta un borrador).
    core.ui.article.addEventListener('keydown', onKey, true);
    const ta = core.ui.rawEdit;
    if (ta) {
      ta.addEventListener('keydown', onAreaKey);
      ta.addEventListener('focus', () => { count = ta.value.split('\n').length; });
      ta.addEventListener('input', onAreaInput);
    }
  }

  LMD.lists = { init, parse, renumber, indent, outdent, unlist, remove, move, nextMark, childMark, isEmptyItem, ITEM,
    items: { pick, remove: removeItems, copy: copyItems, move: moveItems, place: placeItems, shift: shiftItems, convert: convertItems, tasks: tasksIn, check: checkItems, lift: liftItems, single, insert: insertItems },
    origins, apart };
})();
