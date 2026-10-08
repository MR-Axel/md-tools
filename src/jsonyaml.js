// Herramienta: JSON y YAML. Un bloque de código json, jsonc, yaml o yml (y un archivo .json, .yaml o .yml suelto)
// se ve como un árbol plegable que también se edita. Lo editado reescribe solo ese bloque en el archivo, por el
// mismo camino que las tablas y los tableros: deshacer, guardado, sincronización y sesiones en vivo siguen andando.
// El lector y el escritor de YAML son propios y acotados: mapas, listas, escalares, comillas, bloques | y >, y
// comentarios. Ante lo que no se puede reescribir igual (anclas, alias, etiquetas, varios documentos, comentarios
// en un lugar que se perdería) el árbol queda en solo lectura. El contenido se dibuja siempre como texto, nodo por nodo.
(function () {
  'use strict';
  const LIMIT_BYTES = 1e6; const LIMIT_NODES = 20000; const HARD_BYTES = 8e6; const MAX_DEPTH = 200; const PAGE = 200;

  // ================= El modelo =================
  // Un nodo: { t: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'alias', v, raw, entries, items }.
  // raw es el texto con el que estaba escrito un escalar: mientras no se lo edite se reescribe tal cual, así un
  // 1.0 o un número largo no cambian. Las claves de un objeto van en una lista (entries), nunca como propiedades.
  function Bad(line, why) { this.line = line || 0; this.why = why || 'invalid'; }
  const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  const kidsOf = (n) => (n.t === 'object' ? n.entries : n.t === 'array' ? n.items : null);
  const childAt = (n, i) => (n.t === 'object' ? n.entries[i].v : n.items[i]);

  // ---------- JSON y JSONC ----------
  // loose: acepta comentarios // y /* */ y una coma de más al final. Los comentarios se saltean con este mismo
  // lector, que sabe cuándo está dentro de una cadena.
  function parseJson(text, loose) {
    let i = 0; let line = 1; let nodes = 0; const n = text.length;
    const flags = { comments: [], dup: false };
    const fail = (why) => { throw new Bad(line, why); };
    function ws() {
      for (;;) {
        const ch = text[i];
        if (ch === '\n') { line++; i++; }
        else if (ch === ' ' || ch === '\t' || ch === '\r') i++;
        else if (loose && ch === '/' && text[i + 1] === '/') { const s = i; while (i < n && text[i] !== '\n') i++; flags.comments.push(text.slice(s, i)); }
        else if (loose && ch === '/' && text[i + 1] === '*') {
          const s = i; const at = line; i += 2;
          for (;;) {
            if (i >= n) { line = at; fail(); }
            if (text[i] === '*' && text[i + 1] === '/') { i += 2; break; }
            if (text[i] === '\n') line++;
            i++;
          }
          flags.comments.push(text.slice(s, i));
        } else return;
      }
    }
    function str() {
      const s = i; i++;
      for (;;) {
        if (i >= n) fail();
        const c = text.charCodeAt(i);
        if (c === 34) { i++; break; }
        if (c === 92) { i += 2; continue; }
        if (c < 32) fail();
        i++;
      }
      try { return JSON.parse(text.slice(s, i)); } catch (e) { return fail(); }
    }
    const NUM = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    function value(depth) {
      if (depth > MAX_DEPTH) fail('deep');
      ws(); nodes++;
      const ch = text[i];
      if (ch === '{') {
        i++; const entries = []; const seen = new Set();
        for (;;) {
          ws();
          if (text[i] === '}') { if (entries.length && !loose) fail(); i++; break; }
          if (text[i] !== '"') fail();
          const k = str(); if (seen.has(k)) flags.dup = true; seen.add(k);
          ws(); if (text[i] !== ':') fail(); i++;
          entries.push({ k, v: value(depth + 1) });
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; break; }
          fail();
        }
        return { t: 'object', entries };
      }
      if (ch === '[') {
        i++; const items = [];
        for (;;) {
          ws();
          if (text[i] === ']') { if (items.length && !loose) fail(); i++; break; }
          items.push(value(depth + 1));
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; break; }
          fail();
        }
        return { t: 'array', items };
      }
      if (ch === '"') return { t: 'string', v: str() };
      for (const [word, node] of [['true', { t: 'boolean', v: true }], ['false', { t: 'boolean', v: false }], ['null', { t: 'null', v: null }]]) {
        if (text.startsWith(word, i) && !/[\w$]/.test(text[i + word.length] || '')) { i += word.length; return node; }
      }
      NUM.lastIndex = i; const m = NUM.exec(text);
      if (!m || !m[0] || /[\w$.+-]/.test(text[i + m[0].length] || '')) fail();
      i += m[0].length;
      return { t: 'number', v: Number(m[0]), raw: m[0] };
    }
    const root = value(0); ws(); if (i < n) fail();
    return { kind: 'json', root, flags, nodes };
  }
  // Sangría de 2 espacios, en el orden de las claves que hay.
  function writeJson(node, pad) {
    pad = pad || ''; const inner = pad + '  ';
    if (node.t === 'object') return node.entries.length ? '{\n' + node.entries.map((e) => inner + JSON.stringify(e.k) + ': ' + writeJson(e.v, inner)).join(',\n') + '\n' + pad + '}' : '{}';
    if (node.t === 'array') return node.items.length ? '[\n' + node.items.map((v) => inner + writeJson(v, inner)).join(',\n') + '\n' + pad + ']' : '[]';
    if (node.t === 'string') return JSON.stringify(node.v);
    if (node.t === 'number') return node.raw !== undefined ? node.raw : (Number.isFinite(node.v) ? String(node.v) : 'null');
    return node.t === 'boolean' ? String(node.v) : 'null';
  }

  // ---------- YAML ----------
  const ESC = new Map([['0', '\0'], ['a', '\x07'], ['b', '\b'], ['t', '\t'], ['\t', '\t'], ['n', '\n'], ['v', '\v'], ['f', '\f'], ['r', '\r'], ['e', '\x1b'], [' ', ' '], ['"', '"'], ['/', '/'], ['\\', '\\'], ['N', '\x85'], ['_', '\xa0'], ['L', '\u2028'], ['P', '\u2029']]);
  // Qué es un escalar sin comillas (esquema central de YAML 1.2).
  function resolve(text) {
    if (text === '' || text === '~' || /^(null|Null|NULL)$/.test(text)) return { t: 'null', v: null };
    if (/^(true|True|TRUE)$/.test(text)) return { t: 'boolean', v: true };
    if (/^(false|False|FALSE)$/.test(text)) return { t: 'boolean', v: false };
    if (/^[-+]?[0-9]+$/.test(text)) return { t: 'number', v: Number(text) };
    if (/^0o[0-7]+$/.test(text)) return { t: 'number', v: parseInt(text.slice(2), 8) };
    if (/^0x[0-9a-fA-F]+$/.test(text)) return { t: 'number', v: parseInt(text.slice(2), 16) };
    if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)) return { t: 'number', v: Number(text) };
    if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return { t: 'number', v: text[0] === '-' ? -Infinity : Infinity };
    if (/^\.(nan|NaN|NAN)$/.test(text)) return { t: 'number', v: NaN };
    return { t: 'string', v: text };
  }
  // Un texto entre comillas que empieza en S[a]; S puede traer varias líneas. Devuelve el valor y dónde termina.
  function quoted(S, a, ln) {
    const q = S[a]; let out = ''; let j = a + 1; let keep = 0; // keep: hasta dónde out no se recorta al plegar
    for (;;) {
      if (j >= S.length) throw new Bad(ln);
      const ch = S[j];
      if (ch === q) {
        if (q === "'" && S[j + 1] === "'") { out += "'"; j += 2; keep = out.length; continue; }
        return { value: out, end: j + 1 };
      }
      if (ch === '\n') {
        let blanks = 0; j++;
        for (;;) { let e = j; while (S[e] === ' ' || S[e] === '\t') e++; if (S[e] === '\n') { blanks++; j = e + 1; } else { j = e; break; } }
        out = out.slice(0, keep) + (blanks ? '\n'.repeat(blanks) : ' '); keep = out.length;
        continue;
      }
      if (ch === '\\' && q === '"') {
        const nx = S[j + 1];
        if (nx === '\n') { j += 2; while (S[j] === ' ' || S[j] === '\t') j++; keep = out.length; continue; }
        if (ESC.has(nx)) { out += ESC.get(nx); j += 2; }
        else if (nx === 'x' || nx === 'u' || nx === 'U') {
          const len = nx === 'x' ? 2 : nx === 'u' ? 4 : 8; const hex = S.substr(j + 2, len);
          if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff) throw new Bad(ln);
          out += String.fromCodePoint(parseInt(hex, 16)); j += 2 + len;
        } else throw new Bad(ln);
        keep = out.length; continue;
      }
      out += ch; j++;
      if (ch !== ' ' && ch !== '\t') keep = out.length;
    }
  }
  const blank = (s) => /^[ \t]*$/.test(s);
  const indentOf = (s) => { let k = 0; while (s[k] === ' ') k++; return k; };
  const isItem = (c) => c[0] === '-' && (c.length === 1 || c[1] === ' ' || c[1] === '\t');

  function parseYaml(text) {
    const L = text.split(/\r?\n/); if (L.length && L[L.length - 1] === '') L.pop();
    const flags = { comments: [], lost: false, anchors: false, tags: false, multi: false, dup: false };
    const doc = { kind: 'yaml', root: null, flags, nodes: 0, lead: [], marker: false, tail: [], step: 0, indentless: false };
    const note = (c) => { flags.comments.push(c); return c; };
    let i = 0; let end = 0; let pend = [];

    // La próxima línea con contenido: su sangría, o -1. Los comentarios y los blancos del camino quedan en pend.
    function peek() {
      while (i < end) {
        const s = L[i];
        if (blank(s)) { pend.push(''); i++; continue; }
        const k = indentOf(s);
        if (s[k] === '#') { pend.push(note(s.slice(k))); i++; continue; }
        if (s[k] === '\t') throw new Bad(i + 1);
        return k;
      }
      return -1;
    }
    const take = () => { const p = pend; pend = []; return p; };
    // Un texto sin comillas y el comentario que le sigue.
    function cut(s) {
      const m = /(^|[ \t])#/.exec(s); if (!m) return [s.replace(/[ \t]+$/, ''), ''];
      const at = m.index + m[1].length; return [s.slice(0, at).replace(/[ \t]+$/, ''), s.slice(at)];
    }
    // Lo que queda en la línea después de un valor cerrado: nada, o un comentario.
    function rest(s, ln) {
      if (blank(s)) return '';
      const t = s.replace(/^[ \t]+/, ''); if (t[0] !== '#' || t.length === s.length) throw new Bad(ln);
      return note(t);
    }
    // &ancla y !etiqueta delante de un valor: se sacan, y el documento queda en solo lectura.
    function props(r) {
      for (;;) {
        const m = /^([&!])[^\s,[\]{}]*[ \t]*/.exec(r); if (!m) return r;
        if (m[1] === '&') flags.anchors = true; else flags.tags = true;
        r = r.slice(m[0].length);
      }
    }
    // La clave con la que empieza una línea de mapa, o null si la línea no es una entrada.
    function keyOf(c, ln) {
      if (c[0] === '"' || c[0] === "'") {
        let q; try { q = quoted(c, 0, ln); } catch (e) { return null; }
        let j = q.end; while (c[j] === ' ' || c[j] === '\t') j++;
        if (c[j] !== ':' || !(j + 1 >= c.length || c[j + 1] === ' ' || c[j + 1] === '\t')) return null;
        return { k: q.value, kraw: c.slice(0, q.end), rest: c.slice(j + 1) };
      }
      if (c[0] === '[' || c[0] === '{') return null;
      if (c[0] === '?' && (c.length === 1 || c[1] === ' ')) throw new Bad(ln, 'unsupported');
      for (let j = 0; j < c.length; j++) {
        const ch = c[j];
        if (ch === '#' && (j === 0 || c[j - 1] === ' ' || c[j - 1] === '\t')) return null;
        if (ch === ':' && (j + 1 === c.length || c[j + 1] === ' ' || c[j + 1] === '\t')) {
          const kraw = c.slice(0, j).replace(/[ \t]+$/, '');
          if (!kraw) throw new Bad(ln, 'unsupported');
          if (kraw[0] === '&' || kraw[0] === '*') flags.anchors = true;
          if (kraw[0] === '!') flags.tags = true;
          return { k: kraw, kraw, rest: c.slice(j + 1) };
        }
      }
      return null;
    }
    // Hasta qué línea puede seguir un valor que empezó en la línea i: las vacías y las que están más adentro.
    function span(parent) { let j = i + 1; while (j < end && (blank(L[j]) || indentOf(L[j]) > parent)) j++; return j; }

    // ---- Colecciones de flujo: [a, b] y {a: 1} ----
    function flow(S, a, ln, depth) {
      let j = a;
      const lineAt = () => ln + (S.slice(0, j).match(/\n/g) || []).length;
      const fail = (why) => { throw new Bad(lineAt(), why); };
      function skip() {
        for (;;) {
          const ch = S[j];
          if (ch === ' ' || ch === '\t' || ch === '\n') j++;
          else if (ch === '#' && (j === 0 || /\s/.test(S[j - 1]))) { const s = j; while (j < S.length && S[j] !== '\n') j++; note(S.slice(s, j)); flags.lost = true; }
          else return;
        }
      }
      function strip() {
        for (;;) {
          const m = /^([&!])[^\s,[\]{}]*/.exec(S.slice(j, j + 200)); if (!m) return;
          if (m[1] === '&') flags.anchors = true; else flags.tags = true;
          j += m[0].length; skip();
        }
      }
      // Un texto sin comillas dentro de un flujo: termina en una coma, un cierre, ": " o un comentario.
      function plain(asKey) {
        const s = j;
        for (;;) {
          const ch = S[j];
          if (ch === undefined || ch === ',' || ch === ']' || ch === '}' || ch === '\n') break;
          if (ch === '[' || ch === '{') fail('unsupported');
          if (ch === ':' && (S[j + 1] === undefined || /[\s,\]}]/.test(S[j + 1]))) break;
          if (ch === '#' && j > s && /\s/.test(S[j - 1])) break;
          j++;
        }
        const t = S.slice(s, j).trim();
        if (S[j] === '\n') { skip(); if (!(S[j] === ',' || S[j] === ']' || S[j] === '}' || (asKey && S[j] === ':'))) fail('unsupported'); }
        return t;
      }
      function node(d) {
        if (d > MAX_DEPTH) fail('deep');
        skip(); strip(); doc.nodes++;
        const ch = S[j];
        if (ch === '[') {
          j++; const items = [];
          for (;;) {
            skip(); if (S[j] === ']') { j++; break; }
            if (S[j] === undefined) fail();
            items.push(node(d + 1)); skip();
            if (S[j] === ',') { j++; continue; }
            if (S[j] === ']') { j++; break; }
            fail(S[j] === ':' ? 'unsupported' : 'invalid');
          }
          return { t: 'array', items, flow: true };
        }
        if (ch === '{') {
          j++; const entries = []; const seen = new Set();
          for (;;) {
            skip(); if (S[j] === '}') { j++; break; }
            if (S[j] === undefined) fail();
            strip();
            let k; let kraw;
            if (S[j] === '"' || S[j] === "'") { const s = j; const q = quoted(S, j, lineAt()); k = q.value; j = q.end; kraw = S.slice(s, j); if (kraw.indexOf('\n') !== -1) kraw = undefined; }
            else { k = plain(true); kraw = k; if (!k) fail(); if (k[0] === '*') flags.anchors = true; }
            if (seen.has(k)) flags.dup = true; seen.add(k);
            skip();
            let v;
            if (S[j] === ':') { j++; skip(); if (S[j] === ',' || S[j] === '}') { v = { t: 'null', v: null, raw: '' }; doc.nodes++; } else v = node(d + 1); }
            else { v = { t: 'null', v: null, raw: '' }; doc.nodes++; }
            entries.push({ k, kraw, v }); skip();
            if (S[j] === ',') { j++; continue; }
            if (S[j] === '}') { j++; break; }
            fail();
          }
          return { t: 'object', entries, flow: true };
        }
        if (ch === '"' || ch === "'") { const s = j; const q = quoted(S, j, lineAt()); j = q.end; const raw = S.slice(s, j); return raw.indexOf('\n') === -1 ? { t: 'string', v: q.value, raw } : { t: 'string', v: q.value }; }
        if (ch === '*') { const m = /^\*[^\s,[\]{}]+/.exec(S.slice(j, j + 200)); if (!m) fail(); j += m[0].length; flags.anchors = true; return { t: 'alias', raw: m[0] }; }
        if (ch === undefined) fail();
        const t = plain(false); if (!t) fail();
        const r = resolve(t); r.raw = t; return r;
      }
      const made = node(depth);
      return { node: made, end: j };
    }

    // Un bloque | o >: r es su cabecera.
    function blockScalar(r, parent, ln) {
      const m = /^([|>])([+-]?)([1-9]?)([+-]?)(?:[ \t]+(#.*))?[ \t]*$/.exec(r); if (!m || (m[2] && m[4])) throw new Bad(ln);
      const chomp = m[2] || m[4]; const until = span(parent); i++;
      let bi = m[3] ? Math.max(parent, 0) + Number(m[3]) : -1;
      if (bi < 0) { for (let j = i; j < until; j++) if (!blank(L[j])) { bi = indentOf(L[j]); break; } }
      const rows = [];
      if (bi >= 0) { while (i < until && (blank(L[i]) || indentOf(L[i]) >= bi)) { rows.push(L[i].length > bi ? L[i].slice(bi) : ''); i++; } }
      else { while (i < until) { rows.push(''); i++; } }
      const node = { t: 'string', v: blockValue(m[1], chomp, rows), block: { style: m[1], chomp, rows } };
      if (m[5]) node.cm = note(m[5]);
      return node;
    }

    // Lo que sigue a "clave:" o a "- " en la línea i. Al salir, i queda después del valor.
    function valueAfter(after, parent, depth, loose) {
      if (depth > MAX_DEPTH) throw new Bad(i + 1, 'deep');
      const ln = i + 1; const r = props(after.replace(/^[ \t]+/, ''));
      if (!r || r[0] === '#') {
        const cm = r ? note(r) : ''; i++;
        const k = peek(); let node = null;
        if (k > parent) { if (parent >= 0 && !doc.step && loose) doc.step = k - parent; node = block(parent, depth); }
        else if (loose && k === parent && k >= 0 && isItem(L[i].slice(k))) { doc.indentless = true; node = seq(k, depth); }
        if (!node) { node = { t: 'null', v: null, raw: '' }; doc.nodes++; }
        if (cm) node.cm = cm;
        return node;
      }
      doc.nodes++;
      if (r[0] === '|' || r[0] === '>') return blockScalar(r, parent, ln);
      if (r[0] === '"' || r[0] === "'" || r[0] === '[' || r[0] === '{') {
        // Primero en su línea; si no cierra ahí, con las líneas que pueden seguirle.
        let S = r; let got = null; const until = span(parent);
        const scan = () => (r[0] === '"' || r[0] === "'" ? quoted(S, 0, ln) : flow(S, 0, ln, depth));
        try { got = scan(); } catch (e) { if (!(e instanceof Bad) || until === i + 1) throw e; S = [r].concat(L.slice(i + 1, until)).join('\n'); got = scan(); }
        const used = (S.slice(0, got.end).match(/\n/g) || []).length;
        const eol = S.indexOf('\n', got.end); const cm = rest(S.slice(got.end, eol === -1 ? S.length : eol), ln + used);
        i += used + 1;
        let node;
        if (got.node) { node = got.node; doc.nodes--; }
        else if (used) node = { t: 'string', v: got.value, rawLines: S.slice(0, got.end).split('\n').map((x, n) => (n ? x.trim() : x)) };
        else node = { t: 'string', v: got.value, raw: S.slice(0, got.end) };
        if (cm) node.cm = cm;
        return node;
      }
      if (r[0] === '*') {
        const m = /^(\*[^\s,[\]{}]+)(.*)$/.exec(r); if (!m) throw new Bad(ln);
        const cm = rest(m[2], ln); i++; flags.anchors = true;
        const node = { t: 'alias', raw: m[1] }; if (cm) node.cm = cm;
        return node;
      }
      // Sin comillas, quizás en varias líneas.
      const first = cut(r); const lines = [first[0]]; let cm = first[1];
      const odd = (t) => /:[ \t]|:$/.test(t);
      if (odd(first[0]) || !first[0] || isItem(first[0])) throw new Bad(ln);
      const until = span(parent); let j = i + 1; let gap = 0; let last = i;
      while (j < until) {
        const s = L[j];
        if (blank(s)) { gap++; j++; continue; }
        const t = s.trim();
        if (t[0] === '#') break;
        const c = cut(t);
        if (cm || isItem(t) || odd(c[0])) throw new Bad(j + 1, 'unsupported');
        for (let g = 0; g < gap; g++) lines.push('');
        lines.push(c[0]); cm = c[1]; gap = 0; last = j; j++;
      }
      i = last + 1; if (cm) note(cm);
      let node;
      if (lines.length === 1) { node = resolve(lines[0]); node.raw = lines[0]; }
      else { let v = lines[0]; let nl = 0; for (let x = 1; x < lines.length; x++) { if (lines[x] === '') { nl++; continue; } v += (nl ? '\n'.repeat(nl) : ' ') + lines[x]; nl = 0; } node = { t: 'string', v, rawLines: lines }; }
      if (cm) node.cm = cm;
      return node;
    }

    function map(n, depth) {
      const node = { t: 'object', entries: [] }; const seen = new Set(); doc.nodes++;
      for (;;) {
        const k = peek();
        if (k !== n) { if (k > n) throw new Bad(i + 1); break; }
        const key = keyOf(L[i].slice(k), i + 1);
        if (!key) throw new Bad(i + 1);
        const before = take();
        if (seen.has(key.k)) flags.dup = true; seen.add(key.k);
        const v = valueAfter(key.rest, n, depth + 1, true);
        if (before.length) v.before = before;
        node.entries.push({ k: key.k, kraw: key.kraw, v });
      }
      return node;
    }
    function seq(n, depth) {
      const node = { t: 'array', items: [] }; doc.nodes++;
      for (;;) {
        const k = peek();
        if (k !== n) { if (k > n) throw new Bad(i + 1); break; }
        const c = L[i].slice(k);
        if (!isItem(c)) break;
        const before = take();
        const after = c.slice(1); const r = after.replace(/^[ \t]+/, '');
        let v;
        // Un mapa o una lista que empiezan en la misma línea del guion: el guion pasa a ser sangría.
        if (r && r[0] !== '#' && (isItem(r) || keyOf(r, i + 1))) {
          L[i] = ' '.repeat(n + 1 + (after.length - r.length)) + r; v = block(n, depth + 1);
        } else v = valueAfter(after, n, depth + 1, false);
        if (before.length) v.before = before;
        node.items.push(v);
      }
      return node;
    }
    // El nodo que empieza en la próxima línea con contenido, si está más adentro que parent.
    function block(parent, depth) {
      if (depth > MAX_DEPTH) throw new Bad(i + 1, 'deep');
      const k = peek(); if (k < 0 || k <= parent) return null;
      const c = L[i].slice(k);
      if (isItem(c)) return seq(k, depth);
      if (keyOf(c, i + 1)) return map(k, depth);
      // Un escalar o un flujo solo en su línea: un comentario que venía antes no tiene de dónde colgarse.
      if (pend.some((x) => x)) flags.lost = true;
      pend = [];
      return valueAfter(c, parent, depth, false);
    }

    // ---- Los documentos ----
    const chunks = []; let cur = { from: 0, marker: false, content: false, lead: [] };
    const close = (to) => {
      if (cur.content || cur.marker) { cur.to = to; chunks.push(cur); }
      else if (cur.lead.some((x) => x)) flags.lost = true;
    };
    for (let j = 0; j < L.length; j++) {
      const s = L[j];
      if (/^---([ \t]|$)/.test(s)) {
        if (cur.content || cur.marker) { close(j); cur = { from: j, marker: true, content: false, lead: [] }; }
        else { cur.marker = true; cur.from = j; }
        const after = s.slice(3);
        if (blank(after)) { L[j] = ''; cur.from = j + 1; }
        else if (/^[ \t]+#/.test(after)) { flags.lost = true; note(after.trim()); L[j] = ''; cur.from = j + 1; }
        else { flags.multi = true; L[j] = '   ' + after; cur.content = true; }
      } else if (/^\.\.\.([ \t]|$)/.test(s)) {
        flags.multi = true; L[j] = ''; close(j); cur = { from: j + 1, marker: false, content: false, lead: [] };
      } else if (s[0] === '%' && !cur.content && !cur.marker) { flags.multi = true; L[j] = ''; }
      else if (!cur.content && !cur.marker) { if (blank(s)) cur.lead.push(''); else if (/^[ \t]*#/.test(s)) cur.lead.push(s.trim()); else cur.content = true; }
      else if (!blank(s) && !/^[ \t]*#/.test(s)) cur.content = true;
    }
    close(L.length);
    if (chunks.length > 1) flags.multi = true;
    const roots = [];
    for (const ch of chunks) {
      i = ch.from; end = ch.to; pend = [];
      let root = block(-1, 0);
      if (peek() >= 0) throw new Bad(i + 1);
      if (!root) { root = { t: 'null', v: null, raw: '' }; doc.nodes++; }
      roots.push(root);
      if (chunks.length === 1) {
        doc.marker = ch.marker;
        if (ch.marker) { doc.lead = ch.lead; ch.lead.forEach((x) => { if (x) note(x); }); }
        doc.tail = pend.slice(); while (doc.tail.length && doc.tail[doc.tail.length - 1] === '') doc.tail.pop();
      } else if (pend.some((x) => x)) flags.lost = true;
    }
    if (!roots.length) { doc.root = { t: 'null', v: null, raw: '' }; doc.nodes++; }
    else if (roots.length === 1) doc.root = roots[0];
    else { doc.root = { t: 'array', items: roots }; doc.nodes++; }
    if (!doc.step) doc.step = 2;
    return doc;
  }
  // El valor de un bloque | o > a partir de sus líneas ya sin sangría.
  function blockValue(style, chomp, rows) {
    const body = rows.slice(); let trail = 0;
    while (body.length && body[body.length - 1] === '') { body.pop(); trail++; }
    let text = '';
    if (style === '|') text = body.join('\n');
    else {
      let nl = 0; let prevMore = false; let first = true;
      for (const line of body) {
        if (line === '') { nl++; continue; }
        const more = line[0] === ' ' || line[0] === '\t';
        if (first) text += '\n'.repeat(nl) + line;
        else if (!nl) text += (more || prevMore ? '\n' : ' ') + line;
        else text += '\n'.repeat(nl + (more || prevMore ? 1 : 0)) + line;
        first = false; nl = 0; prevMore = more;
      }
    }
    if (!body.length) return chomp === '+' ? '\n'.repeat(trail) : '';
    return chomp === '-' ? text : chomp === '+' ? text + '\n'.repeat(1 + trail) : text + '\n';
  }
  // Un texto que puede ir sin comillas sin que se lea como otra cosa.
  function plainOk(s, inFlow) {
    if (s === '' || s !== s.trim() || resolve(s).t !== 'string') return false;
    if (/^(y|n|yes|no|on|off)$/i.test(s) || /^[-?:,[\]{}#&*!|>'"%@`=<~\d.+]/.test(s)) return false;
    if (/:[ \t]|:$|[ \t]#|[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff]/.test(s) || /\p{Cs}/u.test(s)) return false;
    return !(inFlow && /[,[\]{}:]/.test(s));
  }
  const dq = (s) => JSON.stringify(s).replace(/[\x7f-\x9f\u2028\u2029\ufeff]/g, (c) => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
  // Un texto de varias líneas editado: como bloque literal, si se puede escribir así sin cambiarlo.
  function literal(v) {
    if (v.indexOf('\n') === -1 || /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\ufeff]/.test(v) || /\p{Cs}/u.test(v)) return null;
    const m = /\n*$/.exec(v); const trail = m[0].length; const body = v.slice(0, v.length - trail);
    if (!body || /^\n/.test(body)) return null;
    const rows = body.split('\n'); if (rows.some((r) => r !== '' && blank(r)) || /[ \t]$/.test(body)) return null;
    for (let x = 1; x < trail; x++) rows.push('');
    return { style: '|', chomp: trail === 0 ? '-' : trail === 1 ? '' : '+', rows };
  }
  function yamlScalar(node, inFlow) {
    if (node.t === 'alias') return node.raw;
    if (node.raw !== undefined) return node.raw;
    if (node.t === 'null') return 'null';
    if (node.t === 'boolean') return String(node.v);
    if (node.t === 'number') return Number.isNaN(node.v) ? '.nan' : node.v === Infinity ? '.inf' : node.v === -Infinity ? '-.inf' : String(node.v);
    return plainOk(node.v, inFlow) ? node.v : dq(node.v);
  }
  function yamlFlow(node, inArray) {
    if (node.t === 'object') return '{' + node.entries.map((e) => { const v = yamlFlow(e.v, false); return (e.kraw !== undefined ? e.kraw : plainOk(e.k, true) ? e.k : dq(e.k)) + (v === '' ? ':' : ': ' + v); }).join(', ') + '}';
    if (node.t === 'array') return '[' + node.items.map((v) => yamlFlow(v, true)).join(', ') + ']';
    if (node.block || node.rawLines) return dq(node.v);
    const t = yamlScalar(node, true);
    return t === '' && inArray ? 'null' : t;
  }
  function writeYamlNode(root, doc) {
    const step = Math.min(8, Math.max(1, (doc && doc.step) || 2)); const indentless = !!(doc && doc.indentless);
    const sp = (n) => ' '.repeat(n);
    const comments = (out, node, n) => { (node.before || []).forEach((b) => out.push(b === '' ? '' : sp(n) + b)); };
    // prefix: lo que ya está escrito en la línea ("clave:" o "-"), con su sangría n.
    function put(out, prefix, node, n, item) {
      const gap = prefix ? ' ' : ''; const cm = node.cm ? ' ' + node.cm : '';
      const kids = kidsOf(node);
      if (kids && kids.length && !node.flow) {
        const at = item ? n + 2 : !prefix ? n : node.t === 'array' && indentless ? n : n + step;
        const body = [];
        if (node.t === 'object') putMap(body, node, at); else putSeq(body, node, at);
        if (item && !node.cm) {
          const f = (childAt(node, 0).before || []).length;
          for (let x = 0; x < f; x++) out.push(body[x] === '' ? '' : sp(n) + body[x].slice(at));
          out.push(prefix + ' ' + body[f].slice(at));
          for (let x = f + 1; x < body.length; x++) out.push(body[x]);
        } else { if (prefix) out.push(prefix + (node.cm ? ' ' + node.cm : '')); body.forEach((b) => out.push(b)); }
        return;
      }
      if (kids) { out.push(prefix + gap + (kids.length ? yamlFlow(node, false) : node.t === 'object' ? '{}' : '[]') + cm); return; }
      const inner = (prefix ? n : 0) + step;
      let blk = node.block;
      if (!blk && node.t === 'string' && node.raw === undefined && !node.rawLines) blk = literal(node.v);
      if (blk) {
        const firstRow = blk.rows.find((r) => r !== '');
        out.push(prefix + gap + blk.style + (firstRow && (firstRow[0] === ' ' || firstRow[0] === '\t') ? String(step) : '') + blk.chomp + cm);
        blk.rows.forEach((r) => out.push(r === '' ? '' : sp(inner) + r));
        return;
      }
      if (node.rawLines) {
        const rl = node.rawLines; out.push(prefix + gap + rl[0]);
        for (let x = 1; x < rl.length; x++) out.push(rl[x] === '' ? '' : sp(prefix ? n + step : n) + rl[x]);
        if (cm) out[out.length - 1] += cm;
        return;
      }
      const t = yamlScalar(node, false);
      out.push(prefix + (t === '' ? '' : gap + t) + (prefix || t ? cm : cm.slice(1)));
    }
    function putMap(out, node, n) {
      node.entries.forEach((e) => { comments(out, e.v, n); put(out, sp(n) + (e.kraw !== undefined ? e.kraw : plainOk(e.k, false) ? e.k : dq(e.k)) + ':', e.v, n, false); });
    }
    function putSeq(out, node, n) {
      node.items.forEach((v) => { comments(out, v, n); put(out, sp(n) + '-', v, n, true); });
    }
    const out = [];
    comments(out, root, 0);
    put(out, '', root, 0, false);
    return out;
  }
  function writeYaml(doc) {
    const out = (doc.lead || []).slice(); if (doc.marker) out.push('---');
    writeYamlNode(doc.root, doc).forEach((l) => out.push(l));
    (doc.tail || []).forEach((l) => out.push(l));
    return out.join('\n');
  }

  // ---------- Lo común ----------
  function same(a, b) {
    if (a.t !== b.t) return false;
    if (a.t === 'object') return a.entries.length === b.entries.length && a.entries.every((e, i) => e.k === b.entries[i].k && same(e.v, b.entries[i].v));
    if (a.t === 'array') return a.items.length === b.items.length && a.items.every((v, i) => same(v, b.items[i]));
    if (a.t === 'alias') return a.raw === b.raw;
    return Object.is(a.v, b.v);
  }
  const write = (doc) => (doc.kind === 'yaml' ? writeYaml(doc) : writeJson(doc.root, ''));
  // Lee un texto. { ok, doc, ro, big } o { ok: false, line, why }. ro dice por qué no se puede reescribir.
  function read(lang, source) {
    const text = String(source || '').replace(/^\ufeff/, '');
    if (!text.trim()) return { ok: false, why: 'empty' };
    if (text.length > HARD_BYTES) return { ok: false, why: 'huge' };
    let doc;
    try {
      if (lang === 'yaml') doc = parseYaml(text);
      else {
        doc = parseJson(text, lang === 'jsonc'); doc.kind = lang;
        if (lang === 'json') { try { JSON.parse(text); } catch (e) { return { ok: false, line: 0, why: 'invalid' }; } }
      }
    } catch (e) {
      if (e instanceof Bad) return { ok: false, line: e.line, why: e.why };
      if (e instanceof RangeError) return { ok: false, line: 0, why: 'deep' };
      throw e;
    }
    const f = doc.flags; let ro = '';
    if (f.multi) ro = 'multi'; else if (f.anchors) ro = 'anchors'; else if (f.tags) ro = 'tags'; else if (f.dup) ro = 'dup';
    else if (f.lost || (lang === 'jsonc' && f.comments.length)) ro = 'comments';
    const big = text.length > LIMIT_BYTES || doc.nodes > LIMIT_NODES;
    // La prueba de fondo: lo que se escribiría tiene que leerse igual, con los mismos comentarios.
    if (!ro && !big && !faithful(doc, lang)) ro = 'shape';
    return { ok: true, doc, ro, big };
  }
  function faithful(doc, lang) {
    try {
      const again = lang === 'yaml' ? parseYaml(write(doc) + '\n') : parseJson(write(doc), false);
      const f = again.flags;
      if (f.multi || f.anchors || f.tags || f.dup || f.lost) return false;
      if (lang === 'yaml' && f.comments.slice().sort().join('\n') !== doc.flags.comments.slice().sort().join('\n')) return false;
      return same(doc.root, again.root);
    } catch (e) { return false; }
  }
  const pathText = (parts) => '$' + parts.map((p) => (typeof p === 'number' ? '[' + p + ']' : /^[A-Za-z_$][\w$]*$/.test(p) ? '.' + p : '[' + JSON.stringify(p) + ']')).join('');
  const blankNode = (t) => (t === 'object' ? { t, entries: [] } : t === 'array' ? { t, items: [] } : t === 'string' ? { t, v: '' } : t === 'number' ? { t, v: 0, raw: '0' } : t === 'boolean' ? { t, v: false } : { t: 'null', v: null });
  const shown = (node) => (node.t === 'string' ? node.v : node.t === 'alias' ? node.raw : node.t === 'null' ? 'null' : node.raw !== undefined && node.raw !== '' ? node.raw : String(node.v));
  // Cambia el tipo de un nodo en su lugar. Lo que se puede pasar se pasa: un texto "12" queda como 12.
  function retype(node, t) {
    const text = kidsOf(node) ? '' : shown(node); const was = node.t; const kids = kidsOf(node) ? (was === 'object' ? node.entries.map((e) => e.v) : node.items) : null;
    ['v', 'raw', 'rawLines', 'block', 'entries', 'items', 'flow'].forEach((k) => { delete node[k]; });
    node.t = t;
    if (t === 'object') node.entries = (kids || []).map((v, i) => ({ k: String(i), v }));
    else if (t === 'array') node.items = kids || [];
    else if (t === 'string') node.v = was === 'null' ? '' : text;
    else if (t === 'number') { const s = text.trim(); const ok = NUM_RE.test(s); node.v = ok ? Number(s) : 0; node.raw = ok ? s : '0'; }
    else if (t === 'boolean') node.v = text.trim().toLowerCase() === 'true';
    else node.v = null;
  }
  const model = { read, write, writeJson, writeYaml, parseJson, parseYaml, same, retype, pathText, LIMIT_BYTES, LIMIT_NODES };

  if (typeof LMD === 'undefined' || !LMD.kit) { if (typeof module !== 'undefined') module.exports = model; return; }

  // ================= La interfaz =================
  const T = LMD.t; const { el, ICON } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const I = { open: svg('<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>'), shut: svg('<path d="m7 4 5 5 5-5M7 20l5-5 5 5"/>') };
  const LANGS = new Map([['json', 'json'], ['jsonc', 'jsonc'], ['yaml', 'yaml'], ['yml', 'yaml']]);
  const TYPES = [['string', 'Texto'], ['number', 'Número'], ['boolean', 'Booleano'], ['null', 'Null'], ['object', 'Objeto'], ['array', 'Lista']];
  const WHY = { multi: 'Solo lectura: usa varios documentos o directivas.', anchors: 'Solo lectura: usa anclas o alias.', tags: 'Solo lectura: usa etiquetas.', dup: 'Solo lectura: tiene claves repetidas.',
    comments: 'Solo lectura: tiene comentarios que se perderían.', shape: 'Solo lectura: el árbol no puede reescribirlo igual.', big: 'Solo lectura: es muy grande.', place: 'Solo lectura: el bloque está dentro de una lista o una cita.' };
  let core = null; let on = false; let wired = false; let menuEl = null;
  const states = new Map();
  const langOf = (code) => { const m = /(?:^|\s)language-([\w+#-]+)/.exec(code.className || ''); return (m && LANGS.get(m[1].toLowerCase())) || ''; };
  const startShut = () => !!LMD.tools.opt('jsonyamlCollapsed', false);

  // Dónde está el bloque en el archivo, si se lo puede reescribir sin tocar nada más.
  function target(code, src) {
    if (!core.blocks) {
      if (core.ui.article.querySelectorAll('.lmd-code').length !== 1) return null;
      return String(core.raw).replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n' === src ? { file: true } : null;
    }
    const r = core.rangeOf(code); if (!r) return null;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset; const L = core.srcLines;
    const open = /^(`{3,}|~{3,})/.exec(L[s] || ''); if (!open || e - s < 2) return null;
    const mark = (open[1][0] === '`' ? '`' : '~') + '{' + open[1].length + ',}[ \\t]*$';
    if (!new RegExp('^' + mark).test(L[e - 1] || '')) return null;
    if (L.slice(s + 1, e - 1).join('\n') !== src.replace(/\n$/, '')) return null;
    return { s: s + 1, n: e - s - 2, fence: new RegExp('^ {0,3}' + mark) };
  }

  function badText(lang, res) {
    const name = lang === 'yaml' ? 'YAML' : 'JSON';
    if (res.why === 'huge') return T('Es demasiado grande para verlo como árbol.');
    if (res.why === 'deep') return T('Tiene demasiados niveles para verlo como árbol.');
    if (res.why === 'unsupported') return T('El árbol no lee este YAML (línea {n}).', { n: res.line });
    return res.line ? T('{a} inválido en la línea {n}.', { a: name, n: res.line }) : T('{a} inválido.', { a: name });
  }

  // ---------- Dibujo ----------
  function build(wrap, code, lang, src, key) {
    if (states.size > 300) states.clear();
    const st = states.get(key) || { open: new Map(), all: '', view: 'tree', then: null }; states.set(key, st);
    const box = el('div', { class: 'lmd-jy', contenteditable: 'false' });
    box._src = src; box._ro = !!core.readOnly; box._key = key;
    const res = read(lang, src);
    if (!res.ok) {
      box.classList.add('lmd-jy-text', 'lmd-jy-bad'); box._bad = true;
      if (res.why === 'empty') box.hidden = true;
      else box.appendChild(el('p', { class: 'lmd-jy-note', role: 'status', text: badText(lang, res) }));
      return box;
    }
    const tg = core.readOnly ? null : target(code, src);
    const why = res.ro || (res.big ? 'big' : '') || (!core.readOnly && !tg ? 'place' : '');
    const ctx = { box, wrap, code, lang, src, st, doc: res.doc, big: res.big, canEdit: !core.readOnly && !why };
    box._ctx = ctx;
    const bar = el('div', { class: 'lmd-jy-bar' });
    const btn = (act, label, html, text) => { const b = el('button', { type: 'button', class: 'lmd-jy-btn', 'data-jy': act, title: label, 'aria-label': label }, html || ''); if (text) b.textContent = text; return b; };
    bar.appendChild(el('span', { class: 'lmd-jy-lang', text: lang.toUpperCase() }));
    ctx.bOpen = btn('open', T('Desplegar todo'), I.open); ctx.bShut = btn('shut', T('Plegar todo'), I.shut);
    ctx.bOpen.disabled = res.big;
    ctx.bView = btn('view', '', '', ' ');
    bar.append(ctx.bOpen, ctx.bShut, btn('copy', T('Copiar'), ICON.copy), ctx.bView);
    if (why) bar.appendChild(el('span', { class: 'lmd-jy-note', role: 'note', text: T(WHY[why]) + (why === 'big' || core.readOnly ? '' : ' ' + T('Editá en la vista de texto.')) }));
    const tree = el('ul', { class: 'lmd-jy-tree', role: 'tree', 'aria-label': T('Árbol de {a}', { a: lang === 'yaml' ? 'YAML' : 'JSON' }) });
    ctx.tree = tree;
    box.append(bar, tree);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jy]'); if (!b || b.disabled) return;
      e.preventDefault(); e.stopPropagation();
      const act = b.dataset.jy;
      if (act === 'copy') core.copy(src.replace(/\n$/, ''));
      else if (act === 'view') { st.view = st.view === 'tree' ? 'text' : 'tree'; view(ctx); }
      else { st.all = act === 'open' ? 'open' : 'shut'; st.open.clear(); draw(ctx); focusRow(ctx, tree.querySelector('li')); }
    });
    wire(ctx);
    view(ctx); draw(ctx);
    return box;
  }
  function view(ctx) {
    const text = ctx.st.view === 'text';
    ctx.box.classList.toggle('lmd-jy-text', text);
    ctx.tree.hidden = text; ctx.bOpen.hidden = text; ctx.bShut.hidden = text;
    ctx.bView.textContent = T(text ? 'Árbol' : 'Texto');
    ctx.bView.title = T(text ? 'Ver como árbol' : 'Ver como texto'); ctx.bView.setAttribute('aria-label', ctx.bView.title);
  }
  const isOpen = (ctx, path, depth) => (ctx.st.open.has(path) ? ctx.st.open.get(path) : ctx.st.all ? ctx.st.all === 'open' : !(ctx.big || startShut()) && depth < 1);
  function draw(ctx) {
    ctx.tree.textContent = '';
    const root = row(ctx, ctx.doc.root, null, 0, 'r', 0);
    root.tabIndex = 0; ctx.tree.appendChild(root);
  }
  function row(ctx, node, parent, idx, path, depth) {
    const kids = kidsOf(node);
    const li = el('li', { class: 'lmd-jy-item', role: 'treeitem', tabindex: '-1', 'aria-level': String(depth + 1), 'aria-selected': 'false', 'data-path': path });
    li._n = node; li._p = parent; li._i = idx; li._d = depth;
    const line = el('div', { class: 'lmd-jy-row' }); line.style.setProperty('--jy-d', String(depth));
    const tw = el('span', { class: 'lmd-jy-tw', 'aria-hidden': 'true' }, kids ? ICON.chevron : '');
    line.appendChild(tw);
    if (parent) {
      line.appendChild(parent.t === 'object' ? el('span', { class: 'lmd-jy-k', text: parent.entries[idx].k }) : el('span', { class: 'lmd-jy-i', text: String(idx) }));
      line.appendChild(el('span', { class: 'lmd-jy-sep', text: ':' }));
    }
    if (kids) line.appendChild(el('span', { class: 'lmd-jy-n', text: node.t === 'object' ? '{' + kids.length + '}' : '[' + kids.length + ']' }));
    else {
      const text = shown(node);
      line.appendChild(el('span', { class: 'lmd-jy-v lmd-jy-' + node.t, text: node.t === 'string' ? '"' + (text.length > 2000 ? text.slice(0, 2000) + '…' : text) + '"' : text }));
    }
    line.appendChild(el('button', { type: 'button', class: 'lmd-jy-more', tabindex: '-1', title: T('Acciones'), 'aria-label': T('Acciones'), 'aria-haspopup': 'menu' }, ICON.more));
    li.appendChild(line);
    if (kids) {
      const open = isOpen(ctx, path, depth);
      li.setAttribute('aria-expanded', String(open));
      if (open) li.appendChild(group(ctx, li));
    }
    return li;
  }
  function group(ctx, li) {
    const node = li._n; const kids = kidsOf(node); const ul = el('ul', { role: 'group' });
    let done = 0;
    const more = () => {
      const stop = Math.min(kids.length, done + PAGE);
      const last = ul.querySelector(':scope > .lmd-jy-rest'); if (last) last.remove();
      for (; done < stop; done++) ul.appendChild(row(ctx, childAt(node, done), node, done, li.dataset.path + '.' + done, li._d + 1));
      if (done < kids.length) {
        const rest = el('li', { class: 'lmd-jy-rest', role: 'none' }); rest.style.setProperty('--jy-d', String(li._d + 1));
        const b = el('button', { type: 'button', class: 'lmd-jy-btn', text: T('Mostrar {n} más', { n: Math.min(PAGE, kids.length - done) }) });
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); more(); });
        rest.appendChild(b); ul.appendChild(rest);
      }
    };
    ul._more = more; more();
    return ul;
  }
  function toggle(ctx, li, open) {
    if (!kidsOf(li._n)) return;
    if (open === undefined) open = li.getAttribute('aria-expanded') !== 'true';
    ctx.st.open.set(li.dataset.path, open);
    li.setAttribute('aria-expanded', String(open));
    const ul = li.querySelector(':scope > ul');
    if (open && !ul) li.appendChild(group(ctx, li)); else if (!open && ul) ul.remove();
  }
  function focusRow(ctx, li) {
    if (!li) return;
    ctx.tree.querySelectorAll('li[tabindex="0"]').forEach((n) => { n.tabIndex = -1; n.setAttribute('aria-selected', 'false'); });
    li.tabIndex = 0; li.setAttribute('aria-selected', 'true');
    try { li.focus({ preventScroll: false }); } catch (e) { /* ya no recibe foco */ }
  }
  // El renglón de una ruta ("r.2.0"): abre lo que haga falta para que exista.
  function find(ctx, path) {
    const parts = path.split('.'); let li = ctx.tree.querySelector(':scope > li'); let at = 'r';
    for (let x = 1; x < parts.length && li; x++) {
      if (!kidsOf(li._n)) return null;
      toggle(ctx, li, true);
      const ul = li.querySelector(':scope > ul'); const want = Number(parts[x]); at += '.' + parts[x];
      let next = null; let guard = 0;
      while (!(next = Array.from(ul.children).find((c) => c.dataset.path === at)) && ul.querySelector(':scope > .lmd-jy-rest') && want < kidsOf(li._n).length && guard++ < 5000) ul._more();
      li = next;
    }
    return li || null;
  }
  const partsOf = (li) => { const out = []; for (let n = li; n && n._p; n = n.parentNode.closest('li[role=treeitem]')) out.unshift(n._p.t === 'object' ? n._p.entries[n._i].k : n._i); return out; };

  // ---------- Escribir ----------
  const refuse = (ctx) => { core.flash(T('No se pudo reescribir sin riesgo. Editá en la vista de texto.'), 'warn'); ctx.box.remove(); paint(); };
  // El modelo ya cambió: se escribe el bloque y se redibuja. then: { focus, edit } para después.
  function commit(ctx, then) {
    let text = null;
    try {
      text = write(ctx.doc);
      const again = read(ctx.lang, text + '\n');
      if (!again.ok || again.ro || !same(ctx.doc.root, again.doc.root)) text = null;
      else if (ctx.lang === 'yaml' && again.doc.flags.comments.slice().sort().join('\n') !== collect(ctx.doc).sort().join('\n')) text = null;
    } catch (e) { text = null; }
    const tg = text === null || !ctx.code.isConnected ? null : target(ctx.code, ctx.src);
    if (!tg) { refuse(ctx); return; }
    ctx.st.then = then || null; hold(ctx, then && then.focus);
    if (tg.file) {
      // Lo que se muestra de un archivo no trae sus blancos del final: un texto que termina en ellos no volvería igual.
      if (/\s$/.test(text)) { ctx.st.then = null; refuse(ctx); return; }
      const raw = String(core.raw); const eol = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
      core.setRaw((raw[0] === '\ufeff' ? '\ufeff' : '') + text.split('\n').join(eol) + /\s*$/.exec(raw)[0]);
      return;
    }
    const lines = text.split('\n');
    if (lines.some((l) => tg.fence.test(l))) { ctx.st.then = null; refuse(ctx); return; }
    core.spliceLines(tg.s, tg.n, lines);
    core.render();
  }
  // Los comentarios que el modelo todavía tiene (los de un nodo borrado se van con él).
  function collect(doc) {
    const out = (doc.lead || []).filter((x) => x).concat((doc.tail || []).filter((x) => x));
    const walk = (n) => { (n.before || []).forEach((b) => { if (b) out.push(b); }); if (n.cm) out.push(n.cm); const k = kidsOf(n); if (k) for (let x = 0; x < k.length; x++) walk(childAt(n, x)); };
    walk(doc.root);
    return out;
  }
  // El renglón que tenía el foco lo recupera si un redibujo se lo saca (deshacer, o el guardado que llega después).
  function hold(ctx, path) { ctx.st.keep = path || ''; ctx.st.keepAt = Date.now(); }
  function busy(ctx) {
    const holder = LMD.live && LMD.live.heldBy ? LMD.live.heldBy(ctx.wrap) : '';
    if (holder) { core.flash(T('{a} está escribiendo en este bloque', { a: holder }), 'warn'); return true; }
    return false;
  }

  // ---------- Editar ----------
  // Un campo en el lugar del valor o de la clave. save(texto) devuelve false para seguir editando.
  function field(ctx, li, host, value, save, kind) {
    if (li.querySelector(':scope > .lmd-jy-row .lmd-jy-in')) return;
    let input;
    if (kind === 'bool') { input = el('select', { class: 'lmd-jy-in' }); ['true', 'false'].forEach((v) => input.appendChild(el('option', { value: v, text: v }))); input.value = value; }
    else if (kind === 'area') { input = el('textarea', { class: 'lmd-jy-in', spellcheck: 'false', rows: String(Math.min(12, value.split('\n').length + 1)) }); input.value = value; }
    else { input = el('input', { class: 'lmd-jy-in', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' }); input.value = value; input.size = Math.max(6, Math.min(60, value.length + 2)); }
    input.setAttribute('aria-label', T(host.classList.contains('lmd-jy-k') ? 'Nombre de la clave' : 'Valor'));
    let done = false;
    // key: se terminó con una tecla (el foco vuelve al renglón); si no, fue por salir del campo.
    const end = (keep, key) => {
      if (done) return;
      // Cerrado antes de guardar: al redibujar, el campo se va y su blur no tiene que guardar otra vez.
      done = true;
      if (keep && save(input.value) === false && key) { done = false; input.focus(); return; }
      if (input.isConnected) { input.remove(); host.hidden = false; if (key) focusRow(ctx, li); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false, true); }
      else if (e.key === 'Enter' && (kind !== 'area' || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); end(true, true); }
      else if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
    });
    input.addEventListener('blur', () => { if (!done && input.isConnected && ctx.box.isConnected) end(true, false); });
    if (kind === 'bool') input.addEventListener('change', () => end(true, true));
    host.hidden = true; host.after(input); input.focus(); if (input.select) input.select();
  }
  function editValue(ctx, li) {
    const node = li._n; const path = li.dataset.path;
    if (kidsOf(node)) { toggle(ctx, li); return; }
    if (!ctx.canEdit || node.t === 'alias' || busy(ctx)) return;
    const host = li.querySelector(':scope > .lmd-jy-row > .lmd-jy-v');
    if (node.t === 'null') { menu(ctx, li, li.querySelector(':scope > .lmd-jy-row > .lmd-jy-more')); return; }
    const before = shown(node);
    field(ctx, li, host, node.t === 'boolean' ? String(node.v) : before, (text) => {
      if (node.t === 'number') {
        const s = text.trim();
        if (!NUM_RE.test(s)) { core.flash(T('No es un número'), 'warn'); return false; }
        if (s === before) return true;
        node.v = Number(s); node.raw = s;
      } else if (node.t === 'boolean') {
        if ((text === 'true') === node.v) return true;
        node.v = text === 'true'; delete node.raw;
      } else {
        if (text === before) return true;
        node.v = text; delete node.raw; delete node.rawLines; delete node.block;
      }
      commit(ctx, { focus: path });
      return true;
    }, node.t === 'boolean' ? 'bool' : node.t === 'string' && before.indexOf('\n') !== -1 ? 'area' : 'line');
  }
  function rename(ctx, li) {
    const parent = li._p; if (!ctx.canEdit || !parent || parent.t !== 'object' || busy(ctx)) return;
    const entry = parent.entries[li._i]; const host = li.querySelector(':scope > .lmd-jy-row > .lmd-jy-k');
    field(ctx, li, host, entry.k, (text) => {
      if (text === entry.k) return true;
      if (/[\r\n]/.test(text)) { core.flash(T('La clave va en una sola línea'), 'warn'); return false; }
      if (parent.entries.some((e) => e !== entry && e.k === text)) { core.flash(T('Ya existe esa clave'), 'warn'); return false; }
      entry.k = text; delete entry.kraw;
      commit(ctx, { focus: li.dataset.path });
      return true;
    }, 'line');
  }
  function add(ctx, li) {
    if (!ctx.canEdit || busy(ctx)) return;
    if (!kidsOf(li._n)) { li = li.parentNode.closest('li[role=treeitem]'); if (!li) return; }
    const node = li._n; const path = li.dataset.path;
    if (node.t === 'object') {
      let k = T('clave'); for (let x = 2; node.entries.some((e) => e.k === k); x++) k = T('clave') + x;
      node.entries.push({ k, v: blankNode('string') });
    } else node.items.push(blankNode('string'));
    ctx.st.open.set(path, true);
    commit(ctx, { focus: path + '.' + (kidsOf(node).length - 1), edit: node.t === 'object' ? 'key' : 'value' });
  }
  function remove(ctx, li) {
    const parent = li._p; if (!ctx.canEdit || !parent || busy(ctx)) return;
    kidsOf(parent).splice(li._i, 1);
    const up = li.dataset.path.replace(/\.\d+$/, ''); const left = kidsOf(parent).length;
    commit(ctx, { focus: left ? up + '.' + Math.min(li._i, left - 1) : up });
  }
  async function setType(ctx, li, t) {
    const node = li._n; if (!ctx.canEdit || node.t === t || busy(ctx)) return;
    const kids = kidsOf(node);
    if (kids && kids.length && !(await LMD.dialog.confirm({ title: T('Cambiar el tipo'), text: T('Se pierde lo que hay adentro. Se puede deshacer.'), ok: T('Cambiar') }))) return;
    if (!ctx.box.isConnected) return;
    retype(node, t);
    commit(ctx, { focus: li.dataset.path, edit: t === 'string' || t === 'number' ? 'value' : '' });
  }
  function copyValue(ctx, li) {
    const node = li._n;
    core.copy(kidsOf(node) ? (ctx.doc.kind === 'yaml' ? writeYamlNode(node, ctx.doc).join('\n') : writeJson(node, '')) : shown(node));
  }

  // ---------- El menú de un renglón ----------
  function closeMenu() { if (!menuEl) return; const m = menuEl; menuEl = null; m.remove(); document.removeEventListener('pointerdown', m._out, true); window.removeEventListener('scroll', m._gone, true); window.removeEventListener('resize', m._gone); }
  function menu(ctx, li, anchor) {
    closeMenu(); focusRow(ctx, li);
    const node = li._n; const kids = kidsOf(node); const m = el('div', { class: 'lmd-jy-menu', role: 'menu', 'aria-label': T('Acciones') });
    const item = (label, run, cls, radio) => {
      const b = el('button', { type: 'button', role: radio === undefined ? 'menuitem' : 'menuitemradio', tabindex: '-1', class: cls || '', text: label });
      if (radio !== undefined) b.setAttribute('aria-checked', String(radio));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); run(); });
      m.appendChild(b);
    };
    item(T('Copiar valor'), () => copyValue(ctx, li));
    item(T('Copiar ruta'), () => core.copy(pathText(partsOf(li))));
    if (ctx.canEdit) {
      if (!kids && node.t !== 'null') item(T('Editar valor'), () => editValue(ctx, li));
      if (li._p && li._p.t === 'object') item(T('Cambiar nombre de la clave'), () => rename(ctx, li));
      if (kids) item(T(node.t === 'object' ? 'Agregar clave' : 'Agregar elemento'), () => add(ctx, li));
      m.appendChild(el('div', { class: 'lmd-jy-menu-label', role: 'presentation', text: T('Tipo') }));
      TYPES.forEach((ty) => item(T(ty[1]), () => setType(ctx, li, ty[0]), 'lmd-jy-type', node.t === ty[0]));
      if (li._p) item(T('Borrar'), () => remove(ctx, li), 'lmd-jy-danger');
    }
    (ctx.box.closest('.lmd-root') || document.body).appendChild(m);
    const r = (anchor || li.firstChild).getBoundingClientRect(); const w = m.offsetWidth; const h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
    const back = () => { closeMenu(); focusRow(ctx, li); };
    m.addEventListener('keydown', (e) => {
      const all = Array.from(m.querySelectorAll('button')); const at = all.indexOf(document.activeElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); back(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); all[e.key === 'Home' ? 0 : all.length - 1].focus(); }
    });
    m._out = (e) => { if (!m.contains(e.target)) closeMenu(); };
    m._gone = (e) => { if (!e || !e.target || !m.contains(e.target)) closeMenu(); };
    menuEl = m;
    document.addEventListener('pointerdown', m._out, true); window.addEventListener('scroll', m._gone, true); window.addEventListener('resize', m._gone);
    m.querySelector('button').focus();
  }

  // ---------- Ratón y teclado ----------
  function wire(ctx) {
    const tree = ctx.tree; const rowOf = (t) => (t && t.closest ? t.closest('li[role=treeitem]') : null);
    const inField = (t) => !!(t && t.closest && t.closest('.lmd-jy-in'));
    tree.addEventListener('click', (e) => {
      const li = rowOf(e.target); if (!li || inField(e.target)) return;
      e.stopPropagation();
      const more = e.target.closest('.lmd-jy-more');
      if (more) { e.preventDefault(); menu(ctx, li, more); return; }
      focusRow(ctx, li);
      if (kidsOf(li._n)) { if (e.target.closest('.lmd-jy-tw, .lmd-jy-k, .lmd-jy-i, .lmd-jy-n, .lmd-jy-sep')) toggle(ctx, li); }
      else if (e.target.closest('.lmd-jy-v') && ctx.canEdit && !String(window.getSelection()).length) editValue(ctx, li);
    });
    tree.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const li = rowOf(e.target); if (li && e.target.closest('.lmd-jy-k') && !inField(e.target)) { e.preventDefault(); rename(ctx, li); }
    });
    ctx.box.addEventListener('dblclick', (e) => e.stopPropagation());
    tree.addEventListener('focusin', (e) => { const li = rowOf(e.target); if (li && e.target === li && li.tabIndex !== 0) { tree.querySelectorAll('li[tabindex="0"]').forEach((n) => { n.tabIndex = -1; n.setAttribute('aria-selected', 'false'); }); li.tabIndex = 0; li.setAttribute('aria-selected', 'true'); } });
    tree.addEventListener('keydown', (e) => {
      const li = e.target; if (!li.matches || !li.matches('li[role=treeitem]') || e.altKey) return;
      if (e.ctrlKey || e.metaKey) {
        // Deshacer y rehacer también leyendo: fuera del modo edición la app no atiende esas teclas.
        const key = e.key.toLowerCase(); const redo = key === 'y' || (key === 'z' && e.shiftKey);
        if (core.editMode || core.readOnly || !(redo || key === 'z')) return;
        e.preventDefault(); e.stopPropagation(); hold(ctx, li.dataset.path);
        if (redo) core.flash(core.redo() ? T('Cambio rehecho') : T('No hay cambios para rehacer'));
        else core.flash(core.undo() ? T('Cambio deshecho. Ctrl+Y lo rehace') : T('No hay más cambios para deshacer'));
        return;
      }
      const all = () => Array.from(tree.querySelectorAll('li[role=treeitem]'));
      const kids = kidsOf(li._n); const open = li.getAttribute('aria-expanded') === 'true';
      let used = true;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const a = all(); focusRow(ctx, a[a.indexOf(li) + (e.key === 'ArrowDown' ? 1 : -1)]); }
      else if (e.key === 'ArrowRight') { if (kids && !open) toggle(ctx, li, true); else if (kids && kids.length) focusRow(ctx, li.querySelector(':scope > ul > li[role=treeitem]')); }
      else if (e.key === 'ArrowLeft') { if (kids && open) toggle(ctx, li, false); else focusRow(ctx, li.parentNode.closest('li[role=treeitem]')); }
      else if (e.key === 'Home') focusRow(ctx, all()[0]);
      else if (e.key === 'End') { const a = all(); focusRow(ctx, a[a.length - 1]); }
      else if (e.key === 'Enter') editValue(ctx, li);
      else if (e.key === ' ') toggle(ctx, li);
      else if (e.key === 'F2') rename(ctx, li);
      else if (e.key === 'Delete') remove(ctx, li);
      else if (e.key === 'Insert' || e.key === '+') add(ctx, li);
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) menu(ctx, li, li.querySelector(':scope > .lmd-jy-row > .lmd-jy-more'));
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  // ---------- Qué bloques hay ----------
  function paint() {
    if (!core || !core.ui || !core.ui.article) return;
    const art = core.ui.article;
    if (!on) { closeMenu(); art.querySelectorAll('.lmd-jy').forEach((n) => n.remove()); return; }
    let ord = 0;
    art.querySelectorAll('.lmd-code').forEach((wrap) => {
      const code = wrap.querySelector('pre > code'); const lang = code ? langOf(code) : ''; if (!lang) return;
      const key = core.HERE + '|' + (ord++); const src = code.textContent;
      const old = wrap.querySelector(':scope > .lmd-jy');
      if (old) { if (old._src === src && old._ro === !!core.readOnly && old._key === key) return; old.remove(); }
      const box = build(wrap, code, lang, src, key);
      if (box._bad) wrap.appendChild(box); else wrap.insertBefore(box, wrap.firstChild);
      const ctx = box._ctx; const then = ctx && ctx.st.then;
      if (then) {
        ctx.st.then = null;
        const li = find(ctx, then.focus);
        if (li) { focusRow(ctx, li); if (then.edit === 'key') rename(ctx, li); else if (then.edit === 'value') editValue(ctx, li); }
      } else if (ctx && ctx.st.keep && Date.now() - ctx.st.keepAt < 2500 && (!document.activeElement || document.activeElement === document.body)) focusRow(ctx, find(ctx, ctx.st.keep));
    });
  }
  function repaint() { if (core && core.ui && core.ui.article) core.ui.article.querySelectorAll('.lmd-jy').forEach((n) => n.remove()); paint(); }

  function enable(c) {
    core = c; on = true;
    if (!wired) { wired = true; core.hooks.render.push(paint); core.hooks.patch.push(paint); }
    paint();
  }
  function disable() { on = false; paint(); }
  function settings(area) {
    area.textContent = '';
    area.appendChild(el('p', { class: 'lmd-tl-why', text: T('Los bloques json, jsonc, yaml y yml, y los archivos .json, .yaml y .yml, se ven como un árbol que se edita. Teclas: flechas para moverse y plegar, Enter para editar, F2 para la clave, Supr para borrar, + para agregar.') }));
    const input = el('input', { type: 'checkbox' }); input.checked = startShut();
    const label = el('label', { class: 'lmd-check' }); label.append(input, el('span', { text: T('Arrancar con todo plegado') }));
    input.addEventListener('change', () => {
      const partial = { jsonyamlCollapsed: input.checked };
      core.settings.tools = Object.assign({}, core.settings.tools, partial); LMD.tools.setOpt(partial);
      states.clear(); repaint();
    });
    area.appendChild(label);
  }

  LMD.jsonyaml = { enable, disable, settings, model };
})();
