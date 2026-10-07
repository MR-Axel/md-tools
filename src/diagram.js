// Diagramas (Mermaid y Graphviz): editor con vista previa en vivo, plantillas, piezas para agregar según el tipo,
// colores y errores explicados, y las acciones que aparecen al pasar el mouse por un diagrama: copiar el código,
// bajar el SVG y ampliarlo.
(function () {
  'use strict';

  const { el, esc, ICON, debounce } = LMD.kit;
  const T = LMD.t;
  let core = null;
  let viz = null;
  let seq = 0;

  // ---------- Plantillas ----------
  // Reemplazan el diagrama entero. Salen en el idioma de la app: cada texto pasa por T.
  // [tipo, nombre, qué es, miniatura, código]
  const THUMB = {
    flow: '<rect x="3" y="3" width="14" height="9" rx="2"/><rect x="27" y="20" width="14" height="9" rx="2"/><path d="M10 12v9a3 3 0 0 0 3 3h14"/>',
    seq: '<path d="M10 4v24M34 4v24M10 10h24m-4-3 4 3-4 3M34 21H10m4-3-4 3 4 3"/>',
    state: '<circle cx="7" cy="16" r="3"/><rect x="17" y="10" width="14" height="12" rx="6"/><circle cx="39" cy="16" r="3"/><path d="M10 16h7M31 16h5"/>',
    class: '<rect x="4" y="4" width="15" height="24" rx="2"/><path d="M4 11h15M4 19h15"/><rect x="27" y="10" width="14" height="12" rx="2"/><path d="M19 16h8"/>',
    er: '<rect x="3" y="10" width="13" height="12" rx="2"/><rect x="28" y="10" width="13" height="12" rx="2"/><path d="M16 16h12M24 12l4 4-4 4"/>',
    gantt: '<path d="M4 4v24h37"/><rect x="8" y="7" width="13" height="4" rx="1"/><rect x="16" y="14" width="15" height="4" rx="1"/><rect x="27" y="21" width="11" height="4" rx="1"/>',
    pie: '<circle cx="22" cy="16" r="12"/><path d="M22 16V4M22 16l10 7"/>',
    mind: '<circle cx="22" cy="16" r="5"/><path d="M27 14l8-6M27 18l8 6M17 14 9 8M17 18l-8 6"/><circle cx="37" cy="7" r="2"/><circle cx="37" cy="25" r="2"/><circle cx="7" cy="7" r="2"/><circle cx="7" cy="25" r="2"/>',
    time: '<path d="M3 16h38"/><circle cx="10" cy="16" r="3"/><circle cx="22" cy="16" r="3"/><circle cx="34" cy="16" r="3"/><path d="M10 13V7M22 19v6M34 13V7"/>',
    dot: '<ellipse cx="12" cy="8" rx="8" ry="4.500"/><ellipse cx="32" cy="24" rx="8" ry="4.500"/><path d="M17 11.500 27 20.500"/>',
  };
  const templates = () => [
    ['flow', T('Flujo'), T('Pasos y decisiones unidos por flechas'), 'graph TD\n  A[' + T('Inicio') + '] --> B{' + T('¿Sirve?') + '}\n  B -- ' + T('Sí') + ' --> C[' + T('Seguir') + ']\n  B -- No --> D[' + T('Corregir') + ']\n  D --> B'],
    ['seq', T('Secuencia'), T('Mensajes entre participantes, en orden'), 'sequenceDiagram\n  participant U as ' + T('Usuario') + '\n  participant A as App\n  participant S as ' + T('Servidor') + '\n  U->>A: ' + T('Pide algo') + '\n  A->>S: ' + T('Consulta') + '\n  S-->>A: ' + T('Respuesta') + '\n  A-->>U: ' + T('Resultado')],
    ['state', T('Estados'), T('Los estados por los que pasa algo'), 'stateDiagram-v2\n  [*] --> ' + T('Borrador') + '\n  ' + T('Borrador') + ' --> ' + T('Revisión') + '\n  ' + T('Revisión') + ' --> ' + T('Publicado') + '\n  ' + T('Revisión') + ' --> ' + T('Borrador') + '\n  ' + T('Publicado') + ' --> [*]'],
    ['class', T('Clases'), T('Clases con sus atributos y relaciones'), 'classDiagram\n  class ' + T('Pedido') + ' {\n    +id\n    +total()\n  }\n  class ' + T('Cliente') + ' {\n    +' + T('nombre') + '\n  }\n  ' + T('Cliente') + ' "1" --> "*" ' + T('Pedido')],
    ['er', T('Datos'), T('Entidades de una base y cómo se relacionan'), 'erDiagram\n  ' + T('CLIENTE') + ' ||--o{ ' + T('PEDIDO') + ' : ' + T('hace') + '\n  ' + T('PEDIDO') + ' ||--|{ ITEM : ' + T('contiene') + '\n  ' + T('CLIENTE') + ' {\n    string ' + T('nombre') + '\n    string email\n  }'],
    ['gantt', 'Gantt', T('Tareas en el tiempo, por sección'), 'gantt\n  title ' + T('Plan') + '\n  dateFormat YYYY-MM-DD\n  section ' + T('Diseño') + '\n  ' + T('Prototipo') + ' :a1, 2026-01-05, 7d\n  section ' + T('Desarrollo') + '\n  ' + T('Primera versión') + ' :after a1, 14d'],
    ['pie', T('Torta'), T('Partes de un total'), 'pie title ' + T('Reparto') + '\n  "A" : 45\n  "B" : 30\n  "C" : 25'],
    ['mind', T('Mapa mental'), T('Ideas que salen de un tema central'), 'mindmap\n  root((' + T('Tema central') + '))\n    ' + T('Idea') + ' 1\n      ' + T('Detalle') + '\n    ' + T('Idea') + ' 2\n    ' + T('Idea') + ' 3'],
    ['time', T('Línea de tiempo'), T('Hechos ordenados por fecha'), 'timeline\n  title ' + T('Historia') + '\n  2024 : ' + T('Idea') + '\n  2025 : ' + T('Primera versión') + '\n  2026 : ' + T('Lanzamiento')],
  ];
  const TYPE_NAME = { flow: 'Flujo', seq: 'Secuencia', state: 'Estados', class: 'Clases', er: 'Datos', gantt: 'Gantt', pie: 'Torta', mind: 'Mapa mental', time: 'Línea de tiempo', dot: 'Graphviz' };

  const kindOf = (box) => box.dataset.kind || (box.classList.contains('lmd-graphviz') ? 'dot' : 'mermaid');
  const codeOf = (box) => (box.dataset.code != null ? box.dataset.code : box.textContent);

  // ---------- Leer el diagrama ----------
  const indentOf = (line) => /^[ \t]*/.exec(line)[0];
  // Línea donde el diagrama dice de qué tipo es: la primera que no es directiva, comentario ni cabecera.
  function headLine(lines) {
    let i = 0;
    if (lines[0] && lines[0].trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
    for (; i < lines.length; i++) { const l = lines[i].trim(); if (l && !/^%%/.test(l)) return i; }
    return -1;
  }
  function typeOf(kind, code) {
    if (kind === 'dot') return 'dot';
    const lines = code.split('\n'); const h = headLine(lines); const l = h < 0 ? '' : lines[h].trim();
    if (/^(graph|flowchart)\b/.test(l)) return 'flow';
    if (/^sequenceDiagram\b/.test(l)) return 'seq';
    if (/^stateDiagram\b/.test(l)) return 'state';
    if (/^classDiagram\b/.test(l)) return 'class';
    if (/^erDiagram\b/.test(l)) return 'er';
    if (/^gantt\b/.test(l)) return 'gantt';
    if (/^pie\b/.test(l)) return 'pie';
    if (/^mindmap\b/.test(l)) return 'mind';
    if (/^timeline\b/.test(l)) return 'time';
    return '';
  }
  const wordsIn = (code) => new Set(code.match(/[A-Za-z_\u00C0-\uFFFF][\w\u00C0-\uFFFF]*/g) || []);
  // Un identificador que no esté en el diagrama: una letra libre, o el prefijo con el primer número libre.
  const letterId = (used) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !used.has(c)) || numId(used, 'N');
  function numId(used, prefix) { let n = 1; while (used.has(prefix + n)) n++; return prefix + n; }
  // Los dos últimos nodos que todavía no tienen una línea entre sí.
  function freePair(nodes, edges) {
    for (let j = nodes.length - 1; j >= 1; j--) for (let i = j - 1; i >= 0; i--) if (!edges.has(nodes[i] + '>' + nodes[j]) && !edges.has(nodes[j] + '>' + nodes[i])) return [nodes[i], nodes[j]];
    return null;
  }
  const body = (code) => { const lines = code.split('\n'); const h = headLine(lines); return lines.map((l, i) => (i <= h || /^\s*%%/.test(l) ? '' : l)); };
  function graphOf(list) {
    const nodes = []; const edges = new Set();
    const node = (id) => { if (id && nodes.indexOf(id) === -1) nodes.push(id); };
    return { nodes, edges, node, edge: (a, b) => { node(a); node(b); edges.add(a + '>' + b); }, last: () => nodes[nodes.length - 1] || '', used: wordsIn(list) };
  }

  const FLOW_SKIP = /^(style|classDef|class|linkStyle|click|subgraph|end|direction)\b/;
  const FLOW_ARROW = /\s*(?:(?<=\s)[<ox])?<?(?:-{2,}|={2,}|-\.+-?)[>ox]?\s*/;
  function flowGraph(code) {
    const g = graphOf(code);
    body(code).forEach((line) => {
      let l = line.trim().replace(/;$/, '');
      if (!l || FLOW_SKIP.test(l)) return;
      // Fuera los textos: lo que va entre comillas, el de las flechas y el de cada forma.
      l = l.replace(/"[^"]*"/g, '').replace(/\|[^|]*\|/g, ' ').replace(/(?<![-=.])(--|==|-\.)\s+[^|>]*?\s+(-->|==>|\.->|---|===)/g, ' --> ').replace(/:::[\w-]+/g, '');
      for (let before = ''; before !== l;) { before = l; l = l.replace(/\[[^[\]]*\]|\{[^{}]*\}|\([^()]*\)/g, ''); }
      const parts = l.split(FLOW_ARROW).map((p) => p.split('&').map((x) => x.trim()).filter((x) => /^[^\s[\](){}]+$/.test(x)));
      parts.forEach((ids, i) => { ids.forEach(g.node); if (i) parts[i - 1].forEach((a) => ids.forEach((b) => g.edge(a, b))); });
    });
    return g;
  }
  function seqInfo(code) {
    const parts = []; let last = null;
    const add = (p) => { if (p && parts.indexOf(p) === -1) parts.push(p); };
    body(code).forEach((line) => {
      const l = line.trim();
      const p = /^(?:participant|actor)\s+(\S+)/.exec(l); if (p) { add(p[1]); return; }
      const m = /^([^\s:][^:]*?)\s*(?:<<)?--?(?:>>|>|x|\))\s*[+-]?([^:]+?)\s*:/.exec(l);
      if (m && !/^(note|loop|alt|opt|par|rect|critical|break|else|and)\b/i.test(l)) { add(m[1]); add(m[2]); last = [m[1], m[2]]; }
    });
    const a = last ? last[0] : parts[0] || 'A'; const b = last ? last[1] : parts[1] || (a === 'B' ? 'A' : 'B');
    return { parts, a, b, used: wordsIn(code) };
  }
  function stateGraph(code) {
    const g = graphOf(code);
    body(code).forEach((line) => {
      const l = line.trim(); let m;
      if ((m = /^(\S+)\s*-->\s*([^\s:]+)/.exec(l))) { if (m[1] !== '[*]' && m[2] !== '[*]') g.edge(m[1], m[2]); else g.node(m[1] !== '[*]' ? m[1] : m[2] !== '[*]' ? m[2] : ''); }
      else if ((m = /^state\s+"[^"]*"\s+as\s+(\S+)/.exec(l)) || (m = /^state\s+([^\s{"]+)/.exec(l)) || (m = /^([^\s:]+)\s*:/.exec(l))) g.node(m[1]);
    });
    return g;
  }
  // Clases y entidades: las que se declaran con bloque guardan dónde cierra, para agregarles un renglón adentro.
  function blockGraph(code, rel, open) {
    const g = graphOf(code); const blocks = {}; const lines = body(code);
    lines.forEach((line, i) => {
      const l = line.trim().replace(/"[^"]*"/g, ' '); let m;
      if ((m = open.exec(l))) { g.node(m[1]); if (/\{\s*$/.test(l)) { let j = i + 1; while (j < lines.length && lines[j].trim() !== '}') j++; if (j < lines.length) blocks[m[1]] = { open: i, close: j }; } }
      else if ((m = rel.exec(l))) g.edge(m[1], m[2]);
    });
    g.blocks = blocks;
    return g;
  }
  const ID = '[\\w\\u00C0-\\uFFFF-]+';
  const classGraph = (code) => blockGraph(code, new RegExp('^(' + ID + ')\\s*(?:<\\|--|--\\|>|\\*--|--\\*|o--|--o|-->|<--|--|\\.\\.>|<\\.\\.|\\.\\.\\|>|<\\|\\.\\.|\\.\\.)\\s*(' + ID + ')'), new RegExp('^class\\s+(' + ID + ')'));
  const erGraph = (code) => blockGraph(code, new RegExp('^(' + ID + ')\\s+\\S*(?:--|\\.\\.)\\S*\\s+(' + ID + ')'), new RegExp('^(' + ID + ')\\s*\\{'));
  function dotGraph(code) {
    const g = graphOf(code); const directed = !/^\s*(strict\s+)?graph\b/m.test(code);
    code.replace(/\/\/.*$/gm, '').replace(/"[^"]*"/g, (s) => s.replace(/[\s;{}[\]=>-]/g, '_')).replace(/\[[^\]]*\]/g, '').split(/[;\n{}]/).forEach((st) => {
      const s = st.trim();
      if (!s || /^(strict|digraph|graph|subgraph|node|edge)\b/.test(s) || (s.includes('=') && !/->|--/.test(s))) return;
      const ids = s.split(/\s*(?:->|--)\s*/).map((x) => x.trim()).filter((x) => /^[\w"\u00C0-\uFFFF.]+$/.test(x));
      ids.forEach((id, i) => { g.node(id); if (i) g.edge(ids[i - 1], id); });
    });
    g.op = directed ? ' -> ' : ' -- ';
    return g;
  }

  // ---------- Piezas ----------
  // Cada pieza devuelve el texto a insertar; lo que queda entre S y E sale seleccionado, para escribir encima.
  // at: antes de qué línea va (si no, al final). indent: sangría propia (si no, la del diagrama).
  const S = '\u0001'; const E = '\u0002';
  const pick = (text) => S + text + E;
  // Une los dos últimos nodos sin conectar; si ya están todos unidos, deja la flecha lista para completar.
  function link(g, op, make) {
    const pair = freePair(g.nodes, g.edges);
    if (pair) return { text: make(pair[0], pair[1]) };
    if (g.last()) return { text: make(g.last(), '') };
    const a = letterId(g.used); g.used.add(a);
    return { text: make(a, letterId(g.used)) };
  }
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ganttInfo = (code) => { const ids = []; body(code).forEach((l) => { const m = /:\s*(?:(?:crit|done|active|milestone)\s*,\s*)*([A-Za-z_]\w*)\s*,/.exec(l); if (m && m[1] !== 'after') ids.push(m[1]); }); return { used: wordsIn(code), start: ids.length ? 'after ' + ids[ids.length - 1] : today() }; };
  // Un renglón dentro del bloque de la última clase o entidad; sin bloque, lo que diga loose.
  function member(g, lines, text, loose, none) {
    const name = g.last(); if (!name) return none();
    const b = g.blocks[name];
    return b ? { at: b.close, indent: indentOf(lines[b.open]) + '  ', text } : loose(name);
  }

  const PIECES = {
    flow: [
      ['Paso', (c) => { const g = flowGraph(c); return { text: (g.last() ? g.last() + ' --> ' : '') + letterId(g.used) + '[' + pick(T('Paso nuevo')) + ']' }; }],
      ['Pregunta', (c) => { const g = flowGraph(c); return { text: (g.last() ? g.last() + ' --> ' : '') + letterId(g.used) + '{' + pick(T('¿Pregunta?')) + '}' }; }],
      ['Flecha', (c) => link(flowGraph(c), '', (a, b) => a + ' --> ' + pick(b))],
      ['Flecha con texto', (c) => link(flowGraph(c), '', (a, b) => a + ' -- ' + pick(T('texto')) + ' --> ' + b)],
      ['Color de un nodo', (c) => ({ text: 'style ' + pick(flowGraph(c).last() || 'A') + ' fill:#fde68a,stroke:#d97706,color:#422006' })],
    ],
    seq: [
      ['Participante', (c) => ({ text: 'participant ' + letterId(seqInfo(c).used) + ' as ' + pick(T('Nombre')) })],
      ['Mensaje', (c) => { const s = seqInfo(c); return { text: s.a + '->>' + s.b + ': ' + pick(T('Mensaje')) }; }],
      ['Respuesta', (c) => { const s = seqInfo(c); return { text: s.b + '-->>' + s.a + ': ' + pick(T('Respuesta')) }; }],
      ['Nota', (c) => ({ text: 'Note over ' + seqInfo(c).a + ': ' + pick(T('Nota')) })],
      ['Bucle', (c) => { const s = seqInfo(c); return { text: 'loop ' + pick(T('Cada vez')) + '\n  ' + s.a + '->>' + s.b + ': ' + T('Mensaje') + '\nend' }; }],
    ],
    state: [
      ['Estado', (c) => ({ text: 'state "' + pick(T('Estado nuevo')) + '" as ' + numId(stateGraph(c).used, 'S') })],
      ['Transición', (c) => link(stateGraph(c), '', (a, b) => a + ' --> ' + pick(b))],
    ],
    class: [
      ['Clase', (c) => ({ text: 'class ' + pick(numId(wordsIn(c), T('Clase'))) + ' {\n  +id\n}' })],
      ['Atributo', (c) => member(classGraph(c), c.split('\n'), '+' + pick(T('atributo')), (n) => ({ text: n + ' : +' + pick(T('atributo')) }), () => PIECES.class[0][1](c))],
      ['Método', (c) => member(classGraph(c), c.split('\n'), '+' + pick(T('metodo')) + '()', (n) => ({ text: n + ' : +' + pick(T('metodo')) + '()' }), () => PIECES.class[0][1](c))],
      ['Relación', (c) => link(classGraph(c), '', (a, b) => a + ' --> ' + (b ? b + ' : ' + pick(T('usa')) : pick('')))],
    ],
    er: [
      ['Entidad', (c) => ({ text: pick(numId(wordsIn(c), T('ENTIDAD'))) + ' {\n  string id\n}' })],
      ['Atributo', (c) => member(erGraph(c), c.split('\n'), 'string ' + pick(T('nombre')), (n) => ({ text: n + ' {\n  string ' + pick(T('nombre')) + '\n}' }), () => PIECES.er[0][1](c))],
      ['Relación', (c) => link(erGraph(c), '', (a, b) => a + ' ||--o{ ' + (b ? b + ' : ' + pick(T('tiene')) : pick('')))],
    ],
    gantt: [
      ['Sección', () => ({ text: 'section ' + pick(T('Sección nueva')) })],
      ['Tarea', (c) => { const g = ganttInfo(c); return { text: pick(T('Tarea nueva')) + ' :' + numId(g.used, 't') + ', ' + g.start + ', 3d' }; }],
      ['Hito', (c) => { const g = ganttInfo(c); return { text: pick(T('Hito')) + ' :milestone, ' + numId(g.used, 'm') + ', ' + g.start + ', 0d' }; }],
    ],
    pie: [
      ['Porción', (c) => { let n = (c.match(/^\s*"[^"]*"\s*:/gm) || []).length + 1; while (c.includes('"' + T('Porción') + ' ' + n + '"')) n++; return { text: '"' + pick(T('Porción') + ' ' + n) + '" : 10' }; }],
    ],
    mind: [
      ['Rama', (c) => { const l = body(c).find((x) => x.trim()); return { indent: (l ? indentOf(l) : '  ') + '  ', text: pick(T('Idea nueva')) }; }],
      ['Subrama', (c) => { const l = body(c).filter((x) => x.trim()).pop(); return { indent: (l ? indentOf(l) : '  ') + '  ', text: pick(T('Detalle')) }; }],
    ],
    time: [
      ['Período', () => ({ text: pick(T('Período')) + ' : ' + T('Evento') })],
      ['Evento', (c) => { const l = body(c).filter((x) => /^\s*[^:\s][^:]*:/.test(x) && !/^\s*title\b/.test(x)).pop(); return l ? { indent: indentOf(l) + ' '.repeat(Math.max(1, l.indexOf(':') - indentOf(l).length)), text: ': ' + pick(T('Evento')) } : PIECES.time[0][1](c); }],
    ],
    dot: [
      ['Nodo', (c) => Object.assign({ text: numId(dotGraph(c).used, 'n') + ' [label="' + pick(T('Nodo')) + '"];' }, dotEnd(c))],
      ['Arista', (c) => { const g = dotGraph(c); return Object.assign(link(g, '', (a, b) => a + g.op + (b ? pick(b) + ';' : pick(''))), dotEnd(c)); }],
    ],
  };
  // En Graphviz todo va antes de la llave que cierra.
  function dotEnd(code) { const lines = code.split('\n'); for (let i = lines.length - 1; i >= 0; i--) if (/^\s*\}\s*$/.test(lines[i])) return { at: i }; const p = code.lastIndexOf('}'); return p === -1 ? {} : { pos: p }; }

  // Arma lo que hay que escribir para una pieza: { from, to, text, sel: [inicio, fin] } sobre el texto del cuadro.
  function pieceEdit(kind, code, i) {
    const type = typeOf(kind, code); const def = (PIECES[type] || [])[i]; if (!def) return null;
    const p = def[1](code); const lines = code.split('\n'); const h = headLine(lines);
    const first = lines.find((l, n) => n > h && l.trim() && !/^\s*%%/.test(l));
    const indent = p.indent != null ? p.indent : (first ? indentOf(first) : '  ') || '  ';
    const text = p.text.split('\n').map((l) => indent + l).join('\n');
    let from; let to; let out;
    if (p.at != null) { from = to = lines.slice(0, p.at).join('\n').length + (p.at ? 1 : 0); out = text + '\n'; }
    else if (p.pos != null) { from = to = p.pos; out = '\n' + text + '\n'; }
    else { from = code.replace(/\s+$/, '').length; to = code.length; out = (from ? '\n' : '') + text + '\n'; }
    const a = out.indexOf(S); const b = out.indexOf(E);
    const clean = out.replace(S, '').replace(E, '');
    const end = from + clean.replace(/\n$/, '').length;
    if (a === -1) return { from, to, text: clean, sel: [end, end] };
    return { from, to, text: clean, sel: [from + a, from + b - 1] };
  }

  // ---------- Colores ----------
  // Una paleta pinta el diagrama entero y queda escrita en el bloque, así se ve igual en GitHub: en Mermaid es la
  // directiva init del principio; en Graphviz, los atributos por defecto de node y edge. Los rellenos son claros
  // con texto oscuro, y las líneas y los textos sueltos van en un tono medio que se lee sobre fondo claro y oscuro.
  // [nombre, relleno, texto, borde, línea, segundo relleno, tercer relleno]
  const PALETTES = [
    ['Azul', '#dbeafe', '#1e3a8a', '#3b82f6', '#437ad3', '#e0e7ff', '#cffafe'],
    ['Verde', '#dcfce7', '#14532d', '#22a55b', '#2f8c55', '#d9f99d', '#ccfbf1'],
    ['Ámbar', '#fef3c7', '#78350f', '#e08a0b', '#aa6f18', '#ffedd5', '#fef9c3'],
    ['Rosa', '#ffe4e6', '#881337', '#f43f5e', '#d34e68', '#fce7f3', '#ffedd5'],
    ['Violeta', '#ede9fe', '#4c1d95', '#8b5cf6', '#8866d9', '#fae8ff', '#e0e7ff'],
    ['Turquesa', '#ccfbf1', '#134e4a', '#14a89a', '#22897e', '#cffafe', '#dcfce7'],
    ['Gris', '#e2e8f0', '#1e293b', '#64748b', '#6d7d95', '#f1f5f9', '#e5e7eb'],
    ['Tinta', '#334155', '#f8fafc', '#94a3b8', '#6d7d95', '#475569', '#64748b'],
  ];
  // Las de la casa y, después, las que se sumaron de la comunidad (community.js): seis colores ya validados como #rrggbb.
  const pals = () => PALETTES.concat(LMD.community ? LMD.community.palettes().map((p) => [p.name, p.colors.fill, p.colors.text, p.colors.border, p.colors.line, p.colors.second, p.colors.third, true]) : []);
  const themeVars = (p) => ({
    primaryColor: p[1], primaryTextColor: p[2], primaryBorderColor: p[3], lineColor: p[4], secondaryColor: p[5], tertiaryColor: p[6],
    textColor: p[4], titleColor: p[4], classText: p[2], edgeLabelBackground: p[1], noteBkgColor: p[5], noteTextColor: p[2], noteBorderColor: p[3],
    pieSectionTextColor: p[2], pieStrokeColor: p[3], pieOuterStrokeColor: p[3], pieOpacity: '1',
  });
  const INIT = /^\s*%%\{\s*init\s*:\s*([\s\S]*?)\}%%[ \t]*\n?/;
  function readInit(code) {
    const m = INIT.exec(code); if (!m) return { len: 0, cfg: {} };
    let cfg = {}; try { cfg = JSON.parse(m[1].replace(/'/g, '"')) || {}; } catch (e) { cfg = {}; }
    return { len: m[0].length, cfg };
  }
  const DOT_NODE = /^[ \t]*node \[style=filled, fillcolor="(#\w+)", color="#\w+", fontcolor="#\w+"\];[ \t]*\n?/m;
  const DOT_EDGE = /^[ \t]*edge \[color="#\w+", fontcolor="#\w+"\];[ \t]*\n?/m;
  // Qué paleta tiene puesta el diagrama: su índice, o -1 si va con los colores por defecto.
  function paletteOf(kind, code) {
    let fill = '';
    if (kind === 'dot') { const m = DOT_NODE.exec(code); fill = m ? m[1] : ''; }
    else { const v = readInit(code).cfg.themeVariables; fill = (v && v.primaryColor) || ''; }
    return pals().findIndex((p) => p[1].toLowerCase() === String(fill).toLowerCase());
  }
  // El código con la paleta i puesta; con -1 se quita y vuelve a los colores por defecto.
  function withPalette(kind, code, i) {
    const p = pals()[i];
    if (kind === 'dot') {
      const bare = code.replace(DOT_NODE, '').replace(DOT_EDGE, '');
      const at = bare.indexOf('{'); if (!p || at === -1) return bare;
      const nl = bare.indexOf('\n', at); const head = nl === -1 ? bare.slice(0, at + 1) : bare.slice(0, nl); const rest = nl === -1 ? bare.slice(at + 1) : bare.slice(nl + 1);
      return head + '\n  node [style=filled, fillcolor="' + p[1] + '", color="' + p[3] + '", fontcolor="' + p[2] + '"];\n  edge [color="' + p[4] + '", fontcolor="' + p[4] + '"];\n' + rest;
    }
    const init = readInit(code); const cfg = init.cfg; const rest = code.slice(init.len);
    if (p) { cfg.theme = 'base'; cfg.themeVariables = themeVars(p); } else { delete cfg.theme; delete cfg.themeVariables; }
    return (Object.keys(cfg).length ? '%%{init: ' + JSON.stringify(cfg).replace(/"/g, "'") + '}%%\n' : '') + rest;
  }
  // Graphviz: el color de texto que pide el diagrama gana sobre el del tema de la página.
  function keepColors(svg) { svg.querySelectorAll('text[fill]').forEach((t) => { if (t.getAttribute('fill') !== 'black') t.style.fill = t.getAttribute('fill'); }); }

  // ---------- Errores explicados ----------
  // Del volcado del parser a algo que se entienda: en qué línea, qué se encontró y, si se puede, cómo arreglarlo.
  // Devuelve { line (desde 0, o null), head, hint, detail }. El detalle original queda para "Ver detalle".
  const tick = (s) => '`' + String(s).replace(/`/g, "'").trim().slice(0, 40) + '`';
  // Qué línea del cuadro es la línea N del parser de Mermaid, que cuenta sin la directiva, la cabecera ni los comentarios.
  function sourceLines(code) {
    const lines = code.split('\n'); const kept = []; let i = 0;
    if (lines[0] && lines[0].trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
    for (; i < lines.length; i++) { if (/^\s*%%(?!\{)/.test(lines[i])) continue; if (!kept.length && (!lines[i].trim() || /^\s*%%\{.*\}%%\s*$/.test(lines[i]))) continue; kept.push(i); }
    return kept;
  }
  function unclosed(line, blocks) {
    const l = line.replace(/\\"/g, '');
    if ((l.match(/"/g) || []).length % 2) return ['"', 'Falta cerrar las comillas.', ''];
    // Las patas de una relación de datos (||--o{) llevan llaves que no abren nada.
    const bare = l.replace(/"[^"]*"/g, '').replace(/[|}o]{1,2}(?:--|\.\.)[|{o]{1,2}/g, '');
    const n = (c) => bare.split(c).length - 1;
    if (n('[') > n(']')) return ['[', 'Falta cerrar el corchete.', 'Cada `[` lleva su `]`, por ejemplo `A[Texto]`.'];
    if (n('(') > n(')')) return ['(', 'Falta cerrar el paréntesis.', 'Cada `(` lleva su `)`, por ejemplo `A(Texto)`.'];
    if (n('{') > n('}') && !(blocks && /\{\s*$/.test(bare))) return ['{', 'Falta cerrar la llave.', 'Cada `{` lleva su `}`, por ejemplo `A{Texto}`.'];
    return null;
  }
  // Un bloque que se abre y no se cierra: devuelve la línea donde empieza.
  function openBlock(lines, opens, closes) {
    const stack = [];
    lines.forEach((l, i) => { const t = l.trim(); if (opens.test(t)) stack.push(i); else if (closes.test(t)) stack.pop(); });
    return stack.length ? stack[stack.length - 1] : -1;
  }
  function explainMermaid(code, ex) {
    const detail = String((ex && ex.message) || ex); const lines = code.split('\n'); const type = typeOf('mermaid', code);
    const out = (line, head, hint, vars) => ({ line: line == null || line < 0 ? null : line, head: T(head, vars), hint: hint ? T(hint, vars) : '', detail });
    const h = headLine(lines);
    if (!code.trim()) return out(null, 'El diagrama está vacío.', 'Escribí el código o elegí una plantilla.');
    if (/No diagram type detected|UnknownDiagramError/.test(detail + (ex && ex.name))) return out(h, 'No se reconoce el tipo de diagrama.', 'La primera línea dice cuál es, por ejemplo `graph TD` o `sequenceDiagram`.');
    let m = /Invalid date:\s*(.+)/.exec(detail);
    if (m) { const fmt = (/dateFormat\s+(\S+)/.exec(code) || [])[1] || 'YYYY-MM-DD'; return out(lines.findIndex((l) => l.includes(m[1].trim())), 'La fecha {a} no es válida.', 'Las fechas van con el formato {b}.', { a: tick(m[1]), b: tick(fmt) }); }
    m = /No parent could be found for \("?([^")]*)"?\)/.exec(detail);
    if (m) return out(lines.findIndex((l, i) => i > h && l.trim().includes(m[1])), '{a} quedó al nivel del tema central.', 'Dale más sangría para que cuelgue de una rama. Solo puede haber un tema central.', { a: tick(m[1]) });
    const kept = sourceLines(code); const lastLine = kept.length ? kept[kept.length - 1] : 0;
    let lastText = lines.length - 1; while (lastText > 0 && !lines[lastText].trim()) lastText--;
    const hash = (ex && ex.hash) || {};
    m = /(?:Parse|Lexical|Lexer) error on line (\d+)/i.exec(detail);
    let line = m ? kept[Math.min(+m[1], kept.length) - 1] : null;
    if (line == null) line = lastText;
    const got = (/got '([^']*)'/.exec(detail) || [])[1] || ''; const expected = detail.split('Expecting')[1] || '';
    const eof = /^(EOF|1|EOF_IN_STRUCT)$/.test(got) || (m && +m[1] > kept.length);
    if (eof || line > lastText) line = Math.min(line, lastText);
    // Jison marca dónde se dio cuenta, no dónde está el problema: en un final inesperado se busca qué quedó abierto.
    const blocks = type === 'class' || type === 'er' || type === 'state';
    if (eof) {
      if (type === 'seq' || type === 'flow') {
        const o = openBlock(lines, type === 'seq' ? /^(loop|alt|opt|par|critical|break|rect|box)\b/ : /^subgraph\b/, /^end\b/);
        if (o >= 0) return out(o, 'A este bloque le falta su cierre.', 'Agregá una línea que diga `end` donde termina.');
      }
      if (blocks) { const o = openBlock(lines, /\{\s*$/, /^\}/); if (o >= 0) return out(o, 'A este bloque le falta la llave que lo cierra.', 'Agregá una línea con `}` donde termina.'); }
      for (let i = lastText; i > h; i--) { const u = unclosed(lines[i], blocks); if (u) return out(i, u[1], u[2]); }
    }
    const src = (lines[line] || '').trim();
    const u = unclosed(lines[line] || '', blocks);
    if (u) return out(line, u[1], u[2]);
    const found = String(hash.text || '').trim() || (/unexpected character: ->(.+?)<-/.exec(detail) || [])[1] || '';
    const head = eof || /^(NEWLINE|NL)$/.test(got) || !found ? 'La línea quedó incompleta.' : 'No se esperaba {a} acá.';
    const vars = { a: tick(found) };
    const at = found ? src.lastIndexOf(found) : -1; const prev = at > 0 ? src.slice(0, at).trim().split(/\s+/).pop() : '';
    const arrowEnd = /(-->|---|-\.->|==>|--[ox]|\.\.>|--\|>|\*--|o--)\s*$/.test(src);
    if (type === 'flow') {
      if (/^style\b/.test(src)) return out(line, head, 'Un color se escribe así: `style A fill:#fde68a`.', vars);
      if (arrowEnd) return out(line, 'A la flecha le falta el destino.', 'Escribí hacia dónde va, por ejemplo {b}.', { b: tick(src + ' B') });
      if (found && !FLOW_ARROW.test(src.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, '')) && !FLOW_SKIP.test(src)) return out(line, 'Esta línea necesita una flecha.', 'Por ejemplo {b}.', { b: tick((prev || 'A') + ' --> ' + found) });
      if (found && prev) return out(line, 'Sobra texto después de {b}.', 'Borrá {a}, o unilo con una flecha.', { a: tick(found), b: tick(prev) });
    }
    if (type === 'seq') {
      if (/^(participant|actor)\s*$/.test(src)) return out(line, 'Al participante le falta el nombre.', 'Por ejemplo `participant A`.');
      if (/-[->)x]/.test(src) && !src.includes(':')) return out(line, 'Al mensaje le falta el texto.', 'Va después de dos puntos, por ejemplo {b}.', { b: tick(src.split(/\s+/)[0] + ': ' + T('Mensaje')) });
    }
    if (type === 'state' && /[^-<]->/.test(src)) return out(line, 'Las transiciones se escriben con `-->`.', 'Por ejemplo {b}.', { b: tick(src.replace(/([^-<])->/, '$1-->')) });
    if (type === 'class' && arrowEnd) return out(line, 'A la relación le falta la otra clase.', 'Por ejemplo {b}.', { b: tick(src + ' B') });
    if (type === 'er') {
      if (/(--|\.\.)/.test(src) && !src.includes(':')) return out(line, 'A la relación le falta el nombre.', 'Va después de dos puntos, por ejemplo {b}.', { b: tick(src + ' : ' + T('tiene')) });
      if (/ATTRIBUTE_WORD/.test(expected)) return out(Math.max(h, line - (found === '}' ? 1 : 0)), 'Al atributo le falta una parte.', 'Cada atributo lleva tipo y nombre, por ejemplo `string id`.');
    }
    if (type === 'gantt' && /taskData/.test(expected)) return out(line, 'A la tarea le faltan los datos.', 'Van después de dos puntos, por ejemplo {b}.', { b: tick(src + ' :t1, ' + today() + ', 3d') });
    if (type === 'pie') return out(line, 'Esta porción no se pudo leer.', 'Cada una va con el nombre entre comillas y un número: `"Nombre" : 10`.');
    if (type === 'time') return out(line, head, 'Cada período va así: `2024 : Evento`.', vars);
    return out(line, m || found ? head : 'No se pudo dibujar el diagrama.', '', vars);
  }
  function explainDot(code, ex) {
    const detail = String((ex && ex.message) || ex); const lines = code.split('\n');
    const out = (line, head, hint, vars) => ({ line: line == null || line < 0 ? null : Math.min(line, lines.length - 1), head: T(head, vars), hint: hint ? T(hint, vars) : '', detail });
    if (!code.trim()) return out(null, 'El diagrama está vacío.', 'Empezá con `digraph { a -> b }`.');
    const m = /in line (\d+)/.exec(detail); let line = m ? +m[1] - 1 : null;
    const near = (/near '([^']*)'/.exec(detail) || [])[1] || '';
    const first = (lines.find((l) => l.trim() && !/^\s*(\/\/|#)/.test(l)) || '').trim();
    if (!/^(strict\s+)?(di)?graph\b/.test(first)) return out(lines.findIndex((l) => l.trim()), 'No se reconoce el comienzo del diagrama.', 'La primera línea empieza con `digraph` o con `graph`.');
    const directed = /^(strict\s+)?digraph\b/.test(first);
    if (near === '->' && !directed) return out(line, 'En un `graph` las líneas se unen con `--`.', 'Para usar flechas `->`, la primera línea tiene que decir `digraph`.');
    if (near === '--' && directed) return out(line, 'En un `digraph` las flechas se escriben `->`.', 'Para unir con `--`, la primera línea tiene que decir `graph`.');
    if (/quoted string/.test(detail)) { const q = lines.findIndex((l) => (l.replace(/\\"/g, '').match(/"/g) || []).length % 2); return out(q >= 0 ? q : line, 'Falta cerrar las comillas.', ''); }
    // Un corchete sin cerrar se nota recién en la línea siguiente.
    for (let i = Math.min(line == null ? lines.length - 1 : line, lines.length - 1); i >= 0; i--) { const u = unclosed(lines[i], true); if (u && u[0] === '[') return out(i, u[1], 'Los atributos van entre corchetes, por ejemplo `a [label="Texto"]`.'); }
    const bare = code.replace(/"[^"]*"/g, '');
    if (bare.split('{').length > bare.split('}').length) return out(lines.findIndex((l) => l.includes('{')), 'Falta la llave que cierra el diagrama.', 'Agregá `}` al final.');
    if (near === '}' && line > 0 && /(->|--)\s*$/.test(lines[line - 1])) return out(line - 1, 'A la línea le falta el destino.', 'Por ejemplo {b}.', { b: tick(lines[line - 1].trim() + ' b') });
    return out(line, near ? 'No se esperaba {a} acá.' : 'No se pudo dibujar el diagrama.', '', { a: tick(near) });
  }
  const explain = (kind, code, ex) => (kind === 'dot' ? explainDot(code, ex) : explainMermaid(code, ex));

  // El aviso de un error: primero lo corto, y el volcado original detrás de "Ver detalle".
  const rich = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
  function errorHtml(info, lead) {
    return '<p class="lmd-err-main">' + (lead ? '<span>' + esc(lead) + '</span> ' : '') + (info.line != null ? '<b>' + T('Línea {n}', { n: info.line + 1 }) + '</b> ' : '') + rich(info.head) + '</p>' +
      (info.hint ? '<p class="lmd-err-hint">' + rich(info.hint) + '</p>' : '') +
      (info.detail ? '<details class="lmd-err-more"><summary>' + T('Ver detalle') + '</summary><pre>' + esc(info.detail) + '</pre></details>' : '');
  }
  // Un bloque del documento que no se pudo dibujar: queda el código, con el aviso arriba.
  function fail(pre, kind, ex) {
    const code = pre.textContent;
    pre.dataset.code = code; pre.dataset.kind = kind; pre.classList.add('lmd-mermaid-error'); pre.removeAttribute('title');
    const note = el('span', { class: 'lmd-err-note', contenteditable: 'false' }, errorHtml(explain(kind, code, ex), T('No se pudo dibujar el diagrama.')));
    pre.insertBefore(note, pre.firstChild);
  }

  // ---------- Cuadro de código ----------
  // El cuadro donde se escribe, con los números de línea y una línea marcada. No ajusta el texto al ancho,
  // así cada renglón mide lo mismo y la marca cae donde tiene que caer. Lo usa también el editor de fórmulas.
  const PANE = '<div class="lmd-ed-code"><div class="lmd-ed-gutter" aria-hidden="true"></div><div class="lmd-ed-band" hidden></div><textarea spellcheck="false" wrap="off"></textarea></div>';
  function pane(box) {
    const ta = box.querySelector('textarea'); const gutter = box.querySelector('.lmd-ed-gutter'); const band = box.querySelector('.lmd-ed-band');
    let count = 0; let marked = null;
    const place = () => {
      const cs = getComputedStyle(ta); const lh = parseFloat(cs.lineHeight) || 21; const top = parseFloat(cs.paddingTop) || 0;
      gutter.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
      band.hidden = marked == null;
      if (marked != null) band.style.transform = 'translateY(' + (top + marked * lh - ta.scrollTop) + 'px)';
    };
    const sync = () => {
      const n = ta.value.split('\n').length;
      if (n !== count) { count = n; let html = ''; for (let i = 1; i <= n; i++) html += '<i>' + i + '</i>'; gutter.innerHTML = html; }
      gutter.querySelectorAll('.lmd-ed-bad').forEach((x) => x.classList.remove('lmd-ed-bad'));
      if (marked != null && gutter.children[marked]) gutter.children[marked].classList.add('lmd-ed-bad');
      place();
    };
    ta.addEventListener('input', sync); ta.addEventListener('scroll', place);
    // Escribir desde el código (una pieza, una plantilla) pasa por insertText, para que Ctrl+Z lo deshaga.
    const write = (from, to, text) => {
      ta.focus(); ta.setSelectionRange(from, to);
      if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    // Cambia todo el texto escribiendo solo la parte que difiere.
    const patch = (next) => {
      const now = ta.value; if (next === now) return;
      let a = 0; while (a < now.length && a < next.length && now[a] === next[a]) a++;
      let b = 0; while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b]) b++;
      const top = ta.scrollTop;
      write(a, now.length - b, next.slice(a, next.length - b));
      ta.scrollTop = top;
    };
    return { ta, sync, write, patch, mark: (line) => { marked = line; sync(); } };
  }

  async function draw(kind, code, target) {
    if (kind === 'dot') {
      await core.ensure('graphviz');
      viz = viz || await window.Viz.instance();
      const svg = LMD.md.safeSvg(viz.renderSVGElement(code));
      keepColors(svg);
      target.textContent = ''; target.appendChild(svg);
      return;
    }
    await core.ensure('mermaid');
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: core.isDark() ? 'dark' : 'default', flowchart: { curve: core.shape === 'square' ? 'linear' : 'basis' } });
    const id = 'lmd-dgm-' + (++seq);
    try {
      const out = await window.mermaid.render(id, code);
      target.innerHTML = out.svg;
    } finally {
      document.querySelectorAll('body > [id^="dlmd-dgm-"], body > #' + id).forEach((n) => n.remove());
    }
  }

  function edit(box) {
    if (!box || document.querySelector('.lmd-dgm')) return;
    const r = core.rangeOf(box); if (!r) return;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset;
    const kind = kindOf(box);
    const original = core.srcLines.slice(s + 1, e - 1).join('\n');
    const tpls = templates();

    const modal = el('div', { class: 'lmd-dgm' });
    modal.innerHTML =
      '<div class="lmd-dgm-card" role="dialog" aria-label="' + T('Editar diagrama') + '">' +
        '<header><div class="lmd-dgm-top"><h3>' + T('Editar diagrama') + ' <small></small></h3>' +
          '<div class="lmd-dgm-menus">' +
            '<button type="button" class="lmd-btn lmd-dgm-back" data-dgm-back hidden>' + T('Volver a lo que tenía') + '</button>' +
            '<div class="lmd-dgm-drop"><button type="button" class="lmd-btn" data-drop="colors" aria-haspopup="true" aria-expanded="false"><span class="lmd-dgm-dot"></span>' + T('Colores') + '</button>' +
              '<div class="lmd-dgm-pop lmd-dgm-colors" hidden><p>' + T('Pinta todo el diagrama. Queda escrito en el bloque.') + '</p><div>' +
                '<button type="button" data-pal="-1"><i class="lmd-dgm-sw lmd-dgm-sw-auto">Aa</i><span>' + T('Por defecto') + '</span></button>' +
                pals().map((p, i) => '<button type="button" data-pal="' + i + '"><i class="lmd-dgm-sw" style="background:' + LMD.kit.esc(p[1]) + ';border-color:' + LMD.kit.esc(p[3]) + ';color:' + LMD.kit.esc(p[2]) + '">Aa</i><span>' + LMD.kit.esc(p[7] ? p[0] : T(p[0])) + '</span></button>').join('') +
              '</div></div></div>' +
            (kind === 'dot' ? '' : '<div class="lmd-dgm-drop"><button type="button" class="lmd-btn" data-drop="tpl" aria-haspopup="true" aria-expanded="false">' + ICON.doc + T('Insertar plantilla') + '</button>' +
              '<div class="lmd-dgm-pop lmd-dgm-tpls" hidden><p>' + T('Elegí un tipo. Reemplaza todo el diagrama.') + '</p><div>' +
                tpls.map((t, i) => '<button type="button" data-tpl="' + i + '"><svg viewBox="0 0 44 32" aria-hidden="true">' + THUMB[t[0]] + '</svg><span><b>' + t[1] + '</b><small>' + t[2] + '</small></span></button>').join('') +
              '</div></div></div>') +
          '</div></div>' +
          '<div class="lmd-dgm-add" hidden><span>' + T('Agregar') + '</span><div></div></div>' +
        '</header>' +
        '<div class="lmd-dgm-body">' + PANE + '<div class="lmd-dgm-view"><div class="lmd-dgm-svg lmd-diagram' + (kind === 'dot' ? ' lmd-diagram-dot' : '') + '"></div><div class="lmd-dgm-err" role="alert" hidden></div></div></div>' +
        '<footer><a href="' + (kind === 'dot' ? 'https://graphviz.org/doc/info/lang.html' : 'https://mermaid.js.org/intro/') + '" target="_blank" rel="noopener noreferrer">' + T('Ver la sintaxis') + '</a><span></span>' +
          '<button type="button" class="lmd-btn lmd-dgm-remove" data-dgm="del">' + T('Eliminar el diagrama') + '</button>' +
          '<button type="button" class="lmd-btn" data-dgm="no">' + T('Cancelar') + '</button>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-dgm="ok">' + T('Aplicar') + ' <kbd>Ctrl+Enter</kbd></button></footer>' +
      '</div>';
    document.body.appendChild(modal);
    const code = pane(modal.querySelector('.lmd-ed-code')); const ta = code.ta;
    const view = modal.querySelector('.lmd-dgm-svg'); const err = modal.querySelector('.lmd-dgm-err');
    const addRow = modal.querySelector('.lmd-dgm-add'); const back = modal.querySelector('[data-dgm-back]'); const label = modal.querySelector('h3 small');
    ta.value = original; code.sync();

    let turn = 0;
    const refresh = async () => {
      const mine = ++turn; const text = ta.value;
      const holder = el('div');
      try {
        await draw(kind, text, holder);
        if (mine !== turn) return;
        view.textContent = ''; while (holder.firstChild) view.appendChild(holder.firstChild);
        err.hidden = true; view.classList.remove('lmd-dgm-stale'); code.mark(null);
      } catch (ex) {
        if (mine !== turn) return;
        // Se deja a la vista el último dibujo que salió bien, atenuado, y el error explicado debajo.
        const info = explain(kind, text, ex);
        err.hidden = false; err.innerHTML = errorHtml(info);
        view.classList.add('lmd-dgm-stale'); code.mark(info.line);
      }
    };
    // Las piezas y el nombre siguen al tipo de diagrama que dice la primera línea.
    let shown = null;
    const showType = () => {
      const type = typeOf(kind, ta.value);
      const pal = paletteOf(kind, ta.value);
      modal.querySelectorAll('[data-pal]').forEach((b) => b.classList.toggle('lmd-on', +b.dataset.pal === pal));
      const dot = modal.querySelector('.lmd-dgm-dot'); const p = pals()[pal];
      dot.style.background = p ? p[1] : ''; dot.style.borderColor = p ? p[3] : '';
      if (type === shown) return;
      shown = type;
      label.textContent = (kind === 'dot' ? 'Graphviz' : 'Mermaid') + (type && type !== 'dot' ? ' · ' + T(TYPE_NAME[type]) : '');
      addRow.hidden = !PIECES[type];
      addRow.lastChild.innerHTML = (PIECES[type] || []).map((x, i) => '<button type="button" data-piece="' + i + '">' + T(x[0]) + '</button>').join('');
    };
    refresh(); showType();
    const later = debounce(refresh, 300);
    ta.addEventListener('input', () => { showType(); later(); });
    ta.focus();

    let before = null;
    const drops = () => modal.querySelectorAll('.lmd-dgm-pop');
    const closeDrops = () => { drops().forEach((p) => { p.hidden = true; }); modal.querySelectorAll('[data-drop]').forEach((b) => b.setAttribute('aria-expanded', 'false')); };
    const close = (apply) => {
      modal.remove();
      if (!apply || ta.value === original) return;
      core.spliceLines(s + 1, e - s - 2, ta.value.replace(/\s+$/, '').split('\n'));
      core.render();
    };
    modal.addEventListener('mousedown', (ev) => { if (!ev.target.closest('.lmd-dgm-drop')) closeDrops(); });
    modal.addEventListener('click', (ev) => {
      const drop = ev.target.closest('[data-drop]');
      if (drop) { const pop = drop.nextElementSibling; const open = pop.hidden; closeDrops(); pop.hidden = !open; drop.setAttribute('aria-expanded', String(open)); return; }
      const tpl = ev.target.closest('[data-tpl]');
      if (tpl) {
        const had = ta.value; const next = tpls[+tpl.dataset.tpl][3];
        if (had.trim() && had !== next && !tpls.some((t) => t[3] === had)) { before = had; back.hidden = false; }
        closeDrops(); code.write(0, ta.value.length, next); ta.setSelectionRange(next.length, next.length); refresh(); return;
      }
      if (ev.target.closest('[data-dgm-back]')) { if (before != null) { code.write(0, ta.value.length, before); refresh(); } before = null; back.hidden = true; return; }
      const pal = ev.target.closest('[data-pal]');
      if (pal) { code.patch(withPalette(kind, ta.value, +pal.dataset.pal)); showType(); refresh(); return; }
      const piece = ev.target.closest('[data-piece]');
      if (piece) {
        const p = pieceEdit(kind, ta.value, +piece.dataset.piece); if (!p) return;
        code.write(p.from, p.to, p.text); ta.setSelectionRange(p.sel[0], p.sel[1]);
        // El renglón nuevo queda a la vista.
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 21; const y = ta.value.slice(0, p.sel[0]).split('\n').length * lh;
        if (y > ta.scrollTop + ta.clientHeight - lh) ta.scrollTop = y - ta.clientHeight + 2 * lh;
        refresh(); return;
      }
      const b = ev.target.closest('[data-dgm]');
      if (b && b.dataset.dgm === 'del') { modal.remove(); LMD.write.remove(box.isConnected ? box : core.ui.article.querySelector('[data-l^="' + r[0] + '-"]')); return; }
      if (b) close(b.dataset.dgm === 'ok');
    });
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (Array.from(drops()).some((p) => !p.hidden)) { closeDrops(); ta.focus(); } else close(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); close(true); }
      if (ev.key === 'Tab' && ev.target === ta) { ev.preventDefault(); document.execCommand('insertText', false, '  '); }
    });
  }

  function tools(box) {
    if (box.querySelector('.lmd-dgm-tools') || !box.querySelector('svg')) return;
    const bar = el('div', { class: 'lmd-dgm-tools' },
      '<button type="button" data-dt="copy" title="' + T('Copiar el código del diagrama') + '">' + ICON.copy + '</button>' +
      '<button type="button" data-dt="svg" title="' + T('Descargar como SVG') + '">' + ICON.save + '</button>' +
      '<button type="button" data-dt="zoom" title="' + T('Ampliar') + '">' + ICON.eye + '</button>' +
      '<button type="button" data-dt="del" class="lmd-dgm-del" title="' + T('Eliminar el diagrama') + '">' + ICON.trash + '</button>');
    bar.contentEditable = 'false';
    box.appendChild(bar);
  }

  function act(what, box) {
    if (what === 'del') { LMD.write.remove(box); return; }
    const svg = box.querySelector('svg'); if (!svg) return;
    if (what === 'copy') { navigator.clipboard.writeText(codeOf(box)).then(() => core.flash(T('Código del diagrama copiado'))); return; }
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (what === 'zoom') {
      core.ui.viewer.textContent = '';
      const wrap = el('div', { class: 'lmd-viewer-svg lmd-diagram' + (kindOf(box) === 'dot' ? ' lmd-diagram-dot' : '') });
      copy.removeAttribute('style'); copy.removeAttribute('width'); copy.removeAttribute('height');
      wrap.appendChild(copy); core.ui.viewer.appendChild(wrap); core.ui.viewer.hidden = false;
      return;
    }
    const a = el('a', { download: (core.docName || 'diagrama').replace(/\.[^.]+$/, '') + '-' + T('diagrama') + '.svg' });
    a.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function init(c) {
    core = c;
    const article = core.ui.article;
    article.addEventListener('mouseover', (e) => { const box = e.target.closest && e.target.closest('.lmd-diagram'); if (box) tools(box); });
    article.addEventListener('click', (e) => {
      const t = e.target.closest('[data-dt]');
      if (t) { e.preventDefault(); e.stopPropagation(); act(t.dataset.dt, t.closest('.lmd-diagram')); return; }
      // "Ver detalle" de un diagrama que no se dibujó se abre sin pasar al editor.
      if (!core.editMode || e.target.closest('.lmd-err-more')) return;
      const box = e.target.closest('.lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz');
      if (box) edit(box);
    });
  }

  LMD.diagram = { init, edit, fail, keepColors, pane, PANE, errorHtml, rich, tick, typeOf, pieceEdit, withPalette, paletteOf, explain, templates, PALETTES };
})();
