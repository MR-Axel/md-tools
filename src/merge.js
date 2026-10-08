// Unir en vez de pisar. Cuando la nota abierta cambió afuera (otro programa escribió el archivo, una IA guardó la
// nota de la nube) y acá hay cambios sin guardar, se juntan las dos ediciones por líneas sobre la base común: el
// texto tal como se cargó o se guardó por última vez. Lo que tocó líneas distintas entra solo. En una tarea, la
// casilla y el texto se juntan aparte. Lo que de verdad choca no lo decide nadie más que la persona (ask).
// El servidor tiene una copia de las tres funciones del tramo marcado, para las IA que escriben por MCP.
(function () {
  'use strict';

  // merge3:begin (el mismo tramo está en server/server.mjs: tests/merge.mjs comprueba que no se separen)
  // Qué cambió x respecto de b, como tramos sobre las líneas de b: [{ s, e, lines }] (de s a e pasan a ser lines).
  // Camino más corto de Myers, con tope de trabajo: si las diferencias son demasiadas va todo el medio como un solo
  // tramo (coarse), y quien une lo trata como un choque en vez de quedarse pensando.
  function mergeDiff(b, x) {
    const nb = b.length; const nx = x.length;
    let s = 0; while (s < nb && s < nx && b[s] === x[s]) s++;
    let t = 0; while (t < nb - s && t < nx - s && b[nb - 1 - t] === x[nx - 1 - t]) t++;
    const N = nb - s - t; const M = nx - s - t;
    if (!N && !M) return [];
    const whole = [{ s, e: nb - t, lines: x.slice(s, nx - t) }];
    if (!N || !M) return whole;
    const max = Math.min(N + M, 2000, Math.max(8, Math.floor(40000000 / (N + M))));
    const off = max + 1; const V = new Int32Array(2 * max + 3); const trace = []; let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      for (let k = -d; k <= d; k += 2) {
        let i = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let j = i - k;
        while (i < N && j < M && b[s + i] === x[s + j]) { i++; j++; }
        V[off + k] = i;
        if (i >= N && j >= M) { found = d; break; }
      }
      trace.push(V.slice(off - d - 1, off + d + 2));
    }
    if (found < 0) { whole.coarse = true; return whole; }
    // De atrás para adelante: qué líneas de b se fueron y cuáles de x entraron.
    const del = new Uint8Array(N); const ins = new Uint8Array(M); let i = N; let j = M;
    for (let d = found; d > 0; d--) {
      const P = trace[d - 1]; const k = i - j; const at = (q) => P[q + d];
      const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const pi = at(pk); const pj = pi - pk;
      if (pk === k + 1) ins[pj] = 1; else del[pi] = 1;
      i = pi; j = pj;
    }
    const out = []; let cur = null; i = 0; j = 0;
    while (i < N || j < M) {
      if (i < N && j < M && !del[i] && !ins[j]) { cur = null; i++; j++; continue; }
      if (!cur) { cur = { s: s + i, e: s + i, lines: [] }; out.push(cur); }
      if (i < N && del[i]) { i++; cur.e = s + i; } else { cur.lines.push(x[s + j]); j++; }
    }
    return out;
  }
  // Una línea de tarea, partida en lo que va antes de la casilla, la casilla y lo que sigue. null si no es una tarea.
  function mergeTask(line) {
    const m = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s.*)?)$/.exec(line);
    return m ? { pre: m[1], box: m[2], post: m[3], text: m[1] + m[3], done: m[2] !== ' ' } : null;
  }
  // Unión de tres vías por líneas: base es el texto común, mine lo de acá y theirs lo de afuera.
  // Devuelve { clean, text, conflicts, ticked, coarse, resolve }:
  //   clean     no quedó nada por decidir, y text es el resultado.
  //   conflicts los tramos que los dos cambiaron distinto: [{ base, mine, theirs }], cada uno el texto de ese tramo.
  //   ticked    en cuántas tareas los dos dejaron la casilla distinta sin una base que desempate: quedó tildada.
  //   resolve   (qué) arma el texto con los choques resueltos: 'mine', 'theirs' o 'both' (lo de acá, una línea en
  //             blanco y lo de afuera, sin marcas), uno para todos o una lista con uno por tramo.
  // Reglas: lo que cambió un solo lado entra. En una tarea, la casilla y el texto se unen por separado: si uno
  // tildó y el otro cambió el texto quedan las dos cosas. El resultado sale con los saltos de línea de mine.
  function mergeThree(base, mine, theirs) {
    base = String(base == null ? '' : base); mine = String(mine == null ? '' : mine); theirs = String(theirs == null ? '' : theirs);
    const lf = (v) => (v.indexOf('\r') === -1 ? v : v.replace(/\r\n/g, '\n'));
    const done = (text) => ({ clean: true, text, conflicts: [], ticked: 0, coarse: false, resolve: () => text });
    const B = lf(base); const Mi = lf(mine); const Th = lf(theirs);
    if (Mi === B || Mi === Th) return done(theirs);
    if (Th === B) return done(mine);
    const eol = mine.indexOf('\r\n') !== -1 || (mine.indexOf('\n') === -1 && theirs.indexOf('\r\n') !== -1) ? '\r\n' : '\n';
    // El salto del final del archivo no es una línea: se une aparte, como una casilla.
    const end = (v) => v.endsWith('\n'); const body = (v) => (end(v) ? v.slice(0, -1) : v);
    const tail = end(Mi) === end(Th) || end(Th) === end(B) ? end(Mi) : end(Th);
    const b = body(B).split('\n'); const m = body(Mi).split('\n'); const t = body(Th).split('\n');
    const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
    // Un reemplazo de n líneas por n líneas se mira renglón por renglón: así dos cambios en renglones vecinos no chocan.
    const fine = (H) => { if (H.coarse) return H; const out = []; for (const h of H) { if (h.e - h.s !== h.lines.length || h.e - h.s < 2) { out.push(h); continue; } for (let k = 0; k < h.lines.length; k++) if (b[h.s + k] !== h.lines[k]) out.push({ s: h.s + k, e: h.s + k + 1, lines: [h.lines[k]] }); } return out; };
    const Am = mergeDiff(b, m); const Ct = mergeDiff(b, t); const A = fine(Am); const C = fine(Ct);
    let ticked = 0;
    const words = (v) => new Set(v.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    // Dos tareas que dicen casi lo mismo: comparten al menos la mitad de las palabras.
    const near = (x, y) => { const p = words(x); const r = words(y); let n = 0; for (const w of p) if (r.has(w)) n++; const all = p.size + r.size - n; return all > 0 && n / all >= 0.5; };
    // Una línea que los dos cambiaron. En una tarea se unen aparte el texto y la casilla; si no, null (choque).
    const line = (bl, ml, tl) => {
      if (ml === tl) return ml;
      const tm = mergeTask(ml); const tt = mergeTask(tl); const tb = bl == null ? null : mergeTask(bl);
      if (!tm || !tt) return null;
      let from = null;
      if (tm.text === tt.text) from = tm; else if (tb && tm.text === tb.text) from = tt; else if (tb && tt.text === tb.text) from = tm;
      if (!from) return null;
      let box;
      if (tm.done === tt.done) box = from.box; else if (tb && tm.done === tb.done) box = tt.box; else if (tb && tt.done === tb.done) box = tm.box;
      else { box = tm.done ? tm.box : tt.box; ticked++; }
      return from.pre + box + from.post;
    };
    // X cambió solo casillas respecto de la base (las mismas líneas, con otra casilla): esos tildes se llevan a Y,
    // que cambió otra cosa. Cada tarea se busca en Y por su lugar o por su texto. null si alguna no aparece.
    const boxOnly = (bs, xs) => bs.length === xs.length && bs.every((l, k) => { if (l === xs[k]) return true; const p = mergeTask(l); const r = mergeTask(xs[k]); return !!p && !!r && p.text === r.text; });
    // Si en el tramo no está porque Y la mudó a otra parte, vale cuando esa tarea es una sola en la base y en todo
    // el texto de Y (all): el tilde se le pone al final, donde haya quedado (moved).
    const moved = [];
    const once = (list, text) => { let n = 0; for (const l of list) { const q = mergeTask(l); if (q && q.text === text) n++; } return n === 1; };
    const carry = (bs, xs, ys, all) => {
      const H = mergeDiff(bs, ys); if (H.coarse) return null;
      const res = ys.slice(); const used = new Set(); const far = [];
      for (let k = 0; k < bs.length; k++) {
        if (bs[k] === xs[k]) continue;
        const tb = mergeTask(bs[k]); const tx = mergeTask(xs[k]); let shift = 0; let hit = -1; let inside = null;
        for (const h of H) { if (h.e <= k) shift += h.lines.length - (h.e - h.s); else if (h.s <= k) { inside = h; break; } else break; }
        if (!inside) hit = k + shift;
        else {
          const y0 = inside.s + shift; const cand = []; for (let n = 0; n < inside.lines.length; n++) { const ty = mergeTask(inside.lines[n]); if (ty) cand.push({ at: y0 + n, ty, n }); }
          const here = inside.e - inside.s === inside.lines.length ? cand.find((c) => c.n === k - inside.s) : null;
          const exact = cand.filter((c) => c.ty.text === tb.text); const close = cand.filter((c) => near(c.ty.text, tb.text));
          if (here && (here.ty.text === tb.text || near(here.ty.text, tb.text))) hit = here.at; else if (exact.length === 1) hit = exact[0].at; else if (!exact.length && close.length === 1) hit = close[0].at;
        }
        const ty = hit < 0 ? null : mergeTask(res[hit]);
        if (!ty && once(b, tb.text) && once(all, tb.text)) { far.push({ text: tb.text, was: tb.done, box: tx.box }); continue; }
        if (!ty || used.has(hit)) return null;
        used.add(hit);
        if (ty.done === tb.done) res[hit] = ty.pre + tx.box + ty.post;
      }
      for (const f of far) moved.push(f);
      return res;
    };
    // Un tramo que los dos tocaron: las líneas de la base, lo de acá y lo de afuera. Devuelve las líneas unidas, o null.
    const region = (bs, ms, ts) => {
      if (same(ms, ts)) return ms;
      if (bs.length === ms.length && bs.length === ts.length) {
        const keep = ticked; const out = [];
        for (let k = 0; k < bs.length; k++) { const l = ms[k] === bs[k] ? ts[k] : ts[k] === bs[k] ? ms[k] : line(bs[k], ms[k], ts[k]); if (l == null) { out.length = 0; break; } out.push(l); }
        if (out.length === bs.length && bs.length) return out;
        ticked = keep;
      }
      if (boxOnly(bs, ms)) { const r = carry(bs, ms, ts, t); if (r) return r; }
      if (boxOnly(bs, ts)) { const r = carry(bs, ts, ms, m); if (r) return r; }
      return null;
    };
    // Los dos agregaron en el mismo lugar: si uno contiene lo del otro al principio o al final, va una sola vez; la
    // misma tarea con la casilla distinta queda tildada; si no, primero lo de acá y después lo de afuera.
    const both = (ms, ts) => {
      const starts = (x, y) => y.length <= x.length && y.every((l, k) => l === x[k]); const ends = (x, y) => y.length <= x.length && y.every((l, k) => l === x[x.length - y.length + k]);
      if (starts(ms, ts) || ends(ms, ts)) return ms;
      if (starts(ts, ms) || ends(ts, ms)) return ts;
      if (ms.length === ts.length) { const keep = ticked; const out = ms.map((l, k) => line(null, l, ts[k])); if (out.every((l) => l != null)) return out; ticked = keep; }
      return ms.concat(ts);
    };
    const parts = []; let pos = 0; let i = 0; let j = 0;
    const put = (lines) => { const last = parts[parts.length - 1]; if (Array.isArray(last)) { for (const l of lines) last.push(l); } else parts.push(lines.slice()); };
    const take = (h, lines) => { put(b.slice(pos, h.s)); put(lines || h.lines); pos = h.e; };
    const side = (list, gs, ge) => { const o = []; let p = gs; for (const h of list) { for (let k = p; k < h.s; k++) o.push(b[k]); for (const l of h.lines) o.push(l); p = h.e; } for (let k = p; k < ge; k++) o.push(b[k]); return o; };
    while (i < A.length || j < C.length) {
      const a = A[i]; const c = C[j];
      if (!c) { take(a); i++; continue; }
      if (!a) { take(c); j++; continue; }
      if (a.s === a.e && c.s === c.e && a.s === c.s) { take(a, both(a.lines, c.lines)); i++; j++; continue; }
      if (a.e <= c.s) { take(a); i++; continue; }
      if (c.e <= a.s) { take(c); j++; continue; }
      // Se pisan: se junta todo lo que se encadena con ese tramo, de un lado y del otro.
      const gs = Math.min(a.s, c.s); let ge = Math.max(a.e, c.e); const ga = []; const gc = [];
      for (;;) {
        if (i < A.length && A[i].s < ge) { ge = Math.max(ge, A[i].e); ga.push(A[i++]); }
        else if (j < C.length && C[j].s < ge) { ge = Math.max(ge, C[j].e); gc.push(C[j++]); }
        else break;
      }
      const bs = b.slice(gs, ge); const ms = side(ga, gs, ge); const ts = side(gc, gs, ge);
      const r = region(bs, ms, ts);
      put(b.slice(pos, gs)); pos = ge;
      if (r) put(r); else parts.push({ base: bs, mine: ms, theirs: ts });
    }
    put(b.slice(pos));
    // Los tildes de las tareas mudadas, ya con todo en su lugar.
    const settle = (lines) => { for (let k = 0; k < lines.length; k++) { const q = mergeTask(lines[k]); if (!q) continue; const f = moved.find((x) => x.text === q.text && x.was === q.done); if (f) lines[k] = q.pre + f.box + q.post; } };
    if (moved.length) for (const p of parts) { if (Array.isArray(p)) settle(p); else { settle(p.mine); settle(p.theirs); } }
    const open = parts.filter((p) => !Array.isArray(p));
    const resolve = (how) => {
      const out = []; let n = 0;
      for (const p of parts) {
        if (Array.isArray(p)) { for (const l of p) out.push(l); continue; }
        const pick = (Array.isArray(how) ? how[n] : how) || 'both'; n++;
        const lines = pick === 'mine' ? p.mine : pick === 'theirs' ? p.theirs : p.mine.concat(p.mine.length && p.theirs.length ? [''] : [], p.theirs);
        for (const l of lines) out.push(l);
      }
      return out.join(eol) + (tail ? eol : '');
    };
    return { clean: !open.length, text: open.length ? null : resolve(), conflicts: open.map((p) => ({ base: p.base.join('\n'), mine: p.mine.join('\n'), theirs: p.theirs.join('\n') })), ticked, coarse: !!(Am.coarse || Ct.coarse), resolve };
  }
  // merge3:end

  // ---------- La pregunta cuando los dos cambiaron lo mismo ----------
  // Muestra cada tramo en disputa, lo de acá y lo de afuera, y devuelve 'both', 'mine', 'theirs', o null si la
  // persona lo deja para después (Escape o el botón): mientras tanto no se guarda nada encima.
  // o: { who } con el nombre de quien cambió afuera, si se sabe. Todo entra como texto: nada se interpreta.
  const SHOW = 4; const LINES = 14;
  function ask(m, o) {
    const { el } = LMD.kit; const T = LMD.t; o = o || {};
    return new Promise((resolve) => {
      const back = document.activeElement;
      const box = el('div', { class: 'lmd-ask lmd-dlg lmd-mrg' });
      const card = el('div', { class: 'lmd-ask-card lmd-dlg-card lmd-mrg-card', role: 'dialog', 'aria-modal': 'true' });
      const title = T('Cambió acá y también afuera');
      card.setAttribute('aria-label', title);
      card.appendChild(el('h3', { text: title }));
      card.appendChild(el('p', { text: T(m.conflicts.length === 1 ? 'Este tramo cambió de las dos formas. Elegí qué queda. No se guarda nada hasta que decidas.' : 'Estos tramos cambiaron de las dos formas. Elegí qué queda. No se guarda nada hasta que decidas.') }));
      const list = el('div', { class: 'lmd-mrg-list' });
      const pane = (label, text) => {
        const lines = text.split('\n'); const cut = lines.length > LINES;
        const p = el('div', { class: 'lmd-mrg-side' });
        p.appendChild(el('span', { class: 'lmd-mrg-label', text: label }));
        p.appendChild(el('pre', { class: 'lmd-mrg-text', text: text === '' ? T('(sin este tramo)') : lines.slice(0, LINES).map((l) => (l.length > 400 ? l.slice(0, 400) + '…' : l)).join('\n') + (cut ? '\n…' : '') }));
        return p;
      };
      m.conflicts.slice(0, SHOW).forEach((c) => {
        const row = el('div', { class: 'lmd-mrg-hunk' });
        row.appendChild(pane(T('Lo tuyo'), c.mine));
        row.appendChild(pane(o.who ? T('Lo de {a}', { a: o.who }) : T('Lo de afuera'), c.theirs));
        list.appendChild(row);
      });
      if (m.conflicts.length > SHOW) list.appendChild(el('p', { class: 'lmd-mrg-more', text: T('Y {n} tramos más.', { n: m.conflicts.length - SHOW }) }));
      card.appendChild(list);
      const actions = el('div', { class: 'lmd-ask-actions' });
      const btn = (how, text, fill) => { const b = el('button', { type: 'button', class: 'lmd-btn' + (fill ? ' lmd-btn-fill' : ''), text }); if (how) b.dataset.mrg = how; else { b.dataset.mrg = ''; b.setAttribute('data-esc', ''); } actions.appendChild(b); return b; };
      btn('', T('Después'));
      btn('theirs', T('Usar lo de afuera'));
      btn('mine', T('Usar lo mío'));
      const main = btn('both', T('Dejar las dos'), true);
      card.appendChild(actions); box.appendChild(card); document.body.appendChild(box);
      let closed = false;
      const close = (value) => {
        if (closed) return; closed = true; box.remove();
        if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } }
        resolve(value);
      };
      main.focus();
      box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(null); } });
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-mrg]'); if (b) close(b.dataset.mrg || null); });
    });
  }

  // Aviso corto con su botón para deshacer: vuelve a lo que había acá antes de unir.
  let toast = null;
  function say(text, undo) {
    const { el } = LMD.kit;
    if (toast) toast.remove();
    const t = el('div', { class: 'lmd-cl-toast lmd-mrg-toast', role: 'status' }); toast = t;
    const gone = () => { t.remove(); if (toast === t) toast = null; };
    t.appendChild(el('span', { text }));
    if (undo) { const b = el('button', { type: 'button', class: 'lmd-link', text: LMD.t('Deshacer') }); b.addEventListener('click', () => { gone(); undo(); }); t.appendChild(b); }
    document.body.appendChild(t);
    setTimeout(gone, 9000);
  }

  // LMD.merge ya es otra cosa (junta los ajustes con sus valores por defecto, en defaults.js): esto va aparte.
  LMD.merge3 = { three: mergeThree, diff: mergeDiff, task: mergeTask, ask, say };
})();
