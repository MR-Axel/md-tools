// La gramática del dictado: de lo que se dijo a lo que se escribe. Sin micrófono y sin interfaz: funciones puras
// sobre texto, con una tabla de frases por idioma. Tres modos: texto (puntuación y estructura), fórmula (LaTeX)
// y diagrama (un flowchart de Mermaid). Sumar una frase es sumar un renglón a la tabla de su idioma.
(function (root) {
  'use strict';
  const LMD = root.LMD || (root.LMD = {});

  // Para comparar: minúsculas, sin acentos y sin la puntuación que el reconocedor pega a la palabra.
  const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const key = (w) => fold(w).replace(/^[.,;:!?¿¡"'()]+|[.,;:!?"'()]+$/g, '');
  const words = (text) => String(text || '').replace(/([a-záéíóúñ])-([a-záéíóúñ])/gi, '$1 $2').split(/\s+/).filter(Boolean);
  const cap = (s) => s.replace(/^(\s*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());

  // ---------- Tablas ----------
  // Palabras después de las cuales una orden de una sola palabra es texto común: "el punto", "la cita", "the period".
  const DET = {
    es: 'el la los las un una unos unas del al de este esta ese esa mi tu su nuestro cada otro otra primer primera ultimo ultima siguiente proximo'.split(' '),
    en: 'the a an this that my your his her our their of each another first last next'.split(' '),
  };

  // Modo texto. Cada renglón: frases separadas por "|" y lo que hacen.
  //   guard: después de un artículo queda como texto.   lead: solo al empezar la frase o detrás de otra orden.
  //   solo: solo si es todo lo que se dijo.   list: como lead, y además en cualquier lugar si se está en una lista.
  const TEXT = {
    es: [
      ['punto y aparte', [{ op: 'punct', text: '.' }, { op: 'break' }]],
      ['punto y coma', { op: 'punct', text: ';' }],
      ['puntos suspensivos', { op: 'punct', text: '…' }],
      ['dos puntos', { op: 'punct', text: ':' }],
      ['punto', { op: 'punct', text: '.' }, 'guard'],
      ['coma', { op: 'punct', text: ',' }, 'guard'],
      ['signo de pregunta|signo de interrogacion|cierra interrogacion|cierra pregunta', { op: 'punct', text: '?' }],
      ['abre interrogacion|abre pregunta', { op: 'punct', text: '¿', open: true }],
      ['signo de exclamacion|signo de admiracion|cierra exclamacion|cierra admiracion', { op: 'punct', text: '!' }],
      ['abre exclamacion|abre admiracion', { op: 'punct', text: '¡', open: true }],
      ['abre parentesis|abrir parentesis', { op: 'punct', text: '(', open: true }],
      ['cierra parentesis|cerrar parentesis', { op: 'punct', text: ')' }],
      ['abre comillas|abrir comillas', { op: 'punct', text: '“', open: true }],
      ['cierra comillas|cerrar comillas', { op: 'punct', text: '”' }],
      ['guion', { op: 'punct', text: '-', open: true }, 'guard'],
      ['nueva linea|nuevo parrafo|salto de linea|nuevo renglon', { op: 'break' }],
      ['subtitulo', { op: 'block', kind: 'h2' }, 'lead'],
      ['titulo', { op: 'block', kind: 'h1' }, 'lead'],
      ['nueva lista|lista nueva|lista con vinetas', { op: 'block', kind: 'ul' }],
      ['siguiente item|siguiente punto|siguiente elemento', { op: 'next' }],
      ['siguiente', { op: 'next' }, 'list'],
      ['tarea hecha|tarea lista|tarea terminada', { op: 'block', kind: 'task', done: true }, 'list'],
      ['nueva tarea', { op: 'block', kind: 'task' }],
      ['tarea', { op: 'block', kind: 'task' }, 'list'],
      ['nueva cita', { op: 'block', kind: 'quote' }],
      ['cita', { op: 'block', kind: 'quote' }, 'lead'],
      ['fin negrita|fin de negrita|cierra negrita', { op: 'fmt', kind: 'bold', on: false }],
      ['negrita', { op: 'fmt', kind: 'bold', on: true }, 'guard'],
      ['fin cursiva|fin de cursiva|cierra cursiva', { op: 'fmt', kind: 'italic', on: false }],
      ['cursiva', { op: 'fmt', kind: 'italic', on: true }, 'guard'],
      ['fin codigo|fin de codigo|cierra codigo', { op: 'fmt', kind: 'code', on: false }],
      ['codigo', { op: 'fmt', kind: 'code', on: true }, 'guard'],
      ['deshacer', { op: 'undo' }, 'solo'],
      ['borrar eso|borra eso|tachar eso', { op: 'scratch' }],
      ['terminar dictado|termina el dictado|terminar el dictado|fin del dictado|parar dictado|detener dictado', { op: 'stop' }],
      ['insertar ecuacion|insertar formula|nueva formula|nueva ecuacion', { op: 'mode', mode: 'formula' }],
      ['formula|ecuacion', { op: 'mode', mode: 'formula' }, 'guard'],
      ['diagrama de flujo|insertar diagrama|nuevo diagrama', { op: 'mode', mode: 'diagram' }],
      ['literal', { op: 'literal' }],
    ],
    en: [
      ['new paragraph|new line|line break', { op: 'break' }],
      ['full stop', { op: 'punct', text: '.' }],
      ['period', { op: 'punct', text: '.' }, 'guard'],
      ['semicolon|semi colon', { op: 'punct', text: ';' }],
      ['comma', { op: 'punct', text: ',' }, 'guard'],
      ['colon', { op: 'punct', text: ':' }, 'guard'],
      ['ellipsis|dot dot dot', { op: 'punct', text: '…' }],
      ['question mark', { op: 'punct', text: '?' }],
      ['exclamation mark|exclamation point', { op: 'punct', text: '!' }],
      ['open parenthesis|open paren|open parentheses|left parenthesis', { op: 'punct', text: '(', open: true }],
      ['close parenthesis|close paren|close parentheses|right parenthesis', { op: 'punct', text: ')' }],
      ['open quote|open quotes', { op: 'punct', text: '“', open: true }],
      ['close quote|close quotes|unquote|end quote', { op: 'punct', text: '”' }],
      ['hyphen', { op: 'punct', text: '-', open: true }, 'guard'],
      ['subtitle|subheading|sub heading', { op: 'block', kind: 'h2' }, 'lead'],
      ['title|heading', { op: 'block', kind: 'h1' }, 'lead'],
      ['new list|bullet list|bulleted list', { op: 'block', kind: 'ul' }],
      ['next item|next bullet|next point', { op: 'next' }],
      ['next', { op: 'next' }, 'list'],
      ['task done|done task|completed task|finished task', { op: 'block', kind: 'task', done: true }, 'list'],
      ['new task|to do item', { op: 'block', kind: 'task' }],
      ['task', { op: 'block', kind: 'task' }, 'list'],
      ['block quote|new quote', { op: 'block', kind: 'quote' }],
      ['quote', { op: 'block', kind: 'quote' }, 'lead'],
      ['end bold|close bold', { op: 'fmt', kind: 'bold', on: false }],
      ['bold', { op: 'fmt', kind: 'bold', on: true }, 'guard'],
      ['end italic|end italics|close italic|close italics', { op: 'fmt', kind: 'italic', on: false }],
      ['italic|italics', { op: 'fmt', kind: 'italic', on: true }, 'guard'],
      ['end code|close code', { op: 'fmt', kind: 'code', on: false }],
      ['code', { op: 'fmt', kind: 'code', on: true }, 'guard'],
      ['undo', { op: 'undo' }, 'solo'],
      ['scratch that|delete that|erase that', { op: 'scratch' }],
      ['stop dictation|end dictation|stop listening|finish dictation', { op: 'stop' }],
      ['insert equation|insert formula|new formula|new equation', { op: 'mode', mode: 'formula' }],
      ['formula|equation', { op: 'mode', mode: 'formula' }, 'guard'],
      ['flowchart|flow chart|insert diagram|new diagram', { op: 'mode', mode: 'diagram' }],
      ['literal', { op: 'literal' }],
    ],
  };

  // Letras griegas: nombre dicho -> comando. Las que tienen mayúscula propia en LaTeX la toman con "mayúscula".
  const GREEK = 'alpha beta gamma delta epsilon eta theta iota kappa lambda mu nu xi rho sigma tau phi chi psi omega'.split(' ');
  const GREEK_CAP = 'Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
  const GREEK_ES = { alfa: 'alpha', teta: 'theta', tita: 'theta', kapa: 'kappa', ro: 'rho', fi: 'phi', ji: 'chi', 'zeta griega': 'zeta', mi: 'mu', ni: 'nu' };

  // Modo fórmula. Cada renglón: frases y la pieza que producen (tipo y valor).
  const FORMULA = {
    es: [
      ['fin formula|fin de formula|fin de la formula|fin ecuacion|fin de ecuacion|fin de la ecuacion|cerrar formula|terminar formula', 'END'],
      ['terminar dictado|terminar el dictado|fin del dictado|parar dictado|detener dictado', 'STOP'],
      ['mas menos|mas o menos', 'BIN', '\\pm'], ['mas', 'BIN', '+'], ['menos', 'BIN', '-'],
      ['multiplicado por|por', 'BIN', '\\cdot'],
      ['por ciento', 'POST', '\\%'],
      ['no es igual a|distinto de|distinto a|distinto|diferente de|diferente a', 'BIN', '\\neq'],
      ['mayor o igual que|mayor o igual a|mayor o igual', 'BIN', '\\geq'], ['menor o igual que|menor o igual a|menor o igual', 'BIN', '\\leq'],
      ['mayor que|mayor a|mayor', 'BIN', '>'], ['menor que|menor a|menor', 'BIN', '<'],
      ['aproximadamente igual a|aproximadamente', 'BIN', '\\approx'],
      ['es igual a|igual a|igual', 'BIN', '='], ['implica', 'BIN', '\\Rightarrow'], ['pertenece a', 'BIN', '\\in'],
      ['dividido por|dividido entre|dividido|partido por|sobre', 'OVER'],
      ['entre', 'BETWEEN'], ['y', 'AND'], ['desde', 'FROM'], ['hasta', 'TO'],
      ['tiende a|tendiendo a', 'TENDS'],
      ['al cuadrado|cuadrado', 'POST', '^{2}'], ['al cubo|cubo', 'POST', '^{3}'], ['factorial', 'POST', '!'], ['prima', 'POST', "'"],
      ['elevado a la potencia|elevado a la|elevado a|a la potencia|a la', 'POW'],
      ['subindice|sub', 'SUB'],
      ['raiz cubica de|raiz cubica', 'SQRT', '3'], ['raiz cuarta de|raiz cuarta', 'SQRT', '4'], ['raiz cuadrada de|raiz cuadrada|raiz de|raiz', 'SQRT', ''],
      ['abre parentesis|abrir parentesis', 'LP'], ['cierra parentesis|cerrar parentesis', 'RP'],
      ['fin fraccion|fin de fraccion|fin de la fraccion', 'ENDFRAC'], ['fraccion', 'FRAC'],
      ['sumatoria de|sumatoria|suma de', 'BIG', '\\sum'], ['productoria de|productoria|producto de', 'BIG', '\\prod'], ['integral de|integral', 'BIG', '\\int'],
      ['limite cuando|limite de|limite', 'LIM'],
      ['diferencial de|diferencial', 'DIFF'],
      ['infinito', 'CONST', '\\infty'], ['pi', 'CONST', '\\pi'],
      ['logaritmo natural de|logaritmo natural', 'FUNC', '\\ln'], ['logaritmo de|logaritmo', 'FUNC', '\\log'],
      ['seno de|seno', 'FUNC', '\\sin'], ['coseno de|coseno', 'FUNC', '\\cos'], ['tangente de|tangente', 'FUNC', '\\tan'],
      ['mayuscula', 'CAPPREV'],
      ['de|del|la|el', 'FILLER'],
      ['equis', 'VAR', 'x'], ['i griega|ye', 'VAR', 'y'], ['zeta', 'VAR', 'z'], ['hache', 'VAR', 'h'], ['jota', 'VAR', 'j'], ['ka', 'VAR', 'k'], ['ele', 'VAR', 'l'],
      ['eme', 'VAR', 'm'], ['ene', 'VAR', 'n'], ['pe', 'VAR', 'p'], ['cu', 'VAR', 'q'], ['erre', 'VAR', 'r'], ['ese', 'VAR', 's'], ['te', 'VAR', 't'],
      ['uve doble|doble ve|doble uve', 'VAR', 'w'], ['uve|ve corta', 'VAR', 'v'], ['efe', 'VAR', 'f'], ['ge', 'VAR', 'g'], ['be', 'VAR', 'b'], ['ce', 'VAR', 'c'],
    ],
    en: [
      ['end formula|end equation|end of formula|end of equation|close formula|finish formula', 'END'],
      ['stop dictation|end dictation|stop listening|finish dictation', 'STOP'],
      ['plus or minus|plus minus', 'BIN', '\\pm'], ['plus', 'BIN', '+'], ['minus', 'BIN', '-'],
      ['multiplied by|times', 'BIN', '\\cdot'],
      ['percent|per cent', 'POST', '\\%'],
      ['is not equal to|not equal to|does not equal|not equal', 'BIN', '\\neq'],
      ['is greater than or equal to|greater than or equal to|greater or equal', 'BIN', '\\geq'], ['is less than or equal to|less than or equal to|less or equal', 'BIN', '\\leq'],
      ['is greater than|greater than', 'BIN', '>'], ['is less than|less than', 'BIN', '<'],
      ['approximately equal to|approximately', 'BIN', '\\approx'],
      ['is equal to|equal to|equals|equal', 'BIN', '='], ['implies', 'BIN', '\\Rightarrow'],
      ['divided by|over', 'OVER'],
      ['between', 'BETWEEN'], ['and', 'AND'], ['from', 'FROM'], ['to', 'TO'],
      ['approaches|goes to|tends to', 'TENDS'],
      ['squared', 'POST', '^{2}'], ['cubed', 'POST', '^{3}'], ['factorial', 'POST', '!'], ['prime', 'POST', "'"],
      ['raised to the power of|to the power of|raised to the power|to the power|raised to the|raised to|to the', 'POW'],
      ['subscript|sub', 'SUB'],
      ['the cube root of|cube root of|cubic root of|cube root', 'SQRT', '3'], ['the fourth root of|fourth root of', 'SQRT', '4'], ['the square root of|square root of|square root|root of', 'SQRT', ''],
      ['open parenthesis|open paren|open parentheses|left parenthesis', 'LP'], ['close parenthesis|close paren|close parentheses|right parenthesis', 'RP'],
      ['end fraction|end of fraction', 'ENDFRAC'], ['fraction', 'FRAC'],
      ['the sum of|sum of|summation of|summation|sum', 'BIG', '\\sum'], ['the product of|product of', 'BIG', '\\prod'], ['the integral of|integral of|integral', 'BIG', '\\int'],
      ['the limit as|limit as|limit when|limit of|limit', 'LIM'],
      ['differential of|differential', 'DIFF'],
      ['infinity', 'CONST', '\\infty'], ['pi', 'CONST', '\\pi'],
      ['natural logarithm of|natural log of|natural logarithm|natural log', 'FUNC', '\\ln'], ['logarithm of|log of|logarithm|log', 'FUNC', '\\log'],
      ['sine of|sine|sin', 'FUNC', '\\sin'], ['cosine of|cosine|cos', 'FUNC', '\\cos'], ['tangent of|tangent|tan', 'FUNC', '\\tan'],
      ['capital|uppercase|upper case', 'CAPNEXT'],
      ['of|the', 'FILLER'],
    ],
  };
  // Símbolos que el reconocedor a veces escribe en vez de la palabra.
  const SYMBOLS = { '+': ['BIN', '+'], '-': ['BIN', '-'], '−': ['BIN', '-'], '=': ['BIN', '='], '<': ['BIN', '<'], '>': ['BIN', '>'], '≠': ['BIN', '\\neq'], '≤': ['BIN', '\\leq'], '≥': ['BIN', '\\geq'],
    '*': ['BIN', '\\cdot'], '×': ['BIN', '\\cdot'], '·': ['BIN', '\\cdot'], '/': ['OVER'], '÷': ['OVER'], '(': ['LP'], ')': ['RP'], '²': ['POST', '^{2}'], '³': ['POST', '^{3}'], '%': ['POST', '\\%'], 'π': ['CONST', '\\pi'], '∞': ['CONST', '\\infty'], '±': ['BIN', '\\pm'] };

  // Modo diagrama. Las órdenes abren una frase que sigue hasta la orden siguiente.
  //   guard: después de un artículo es texto.   lead: solo al empezar lo dicho.   not: si sigue esa palabra, es texto.
  const DIAGRAM = {
    es: {
      yes: 'Sí', no: 'No', start: 'Inicio', end: 'Fin', ask: (t) => (/[?]$/.test(t) ? t : '¿' + t.replace(/^¿/, '') + '?'),
      to: ['a', 'hasta', 'al'], as: ['como', 'por'], then: ['entonces'], els: ['si no', 'sino', 'de lo contrario', 'en caso contrario'],
      rows: [
        ['fin diagrama|fin del diagrama|fin de diagrama|terminar diagrama|cerrar diagrama', 'END'],
        ['terminar dictado|terminar el dictado|fin del dictado|parar dictado|detener dictado', 'STOP'],
        ['borrar ultimo paso|borrar el ultimo paso|eliminar ultimo paso|eliminar el ultimo paso|quitar ultimo paso', 'DELETE'],
        ['volver a|volver al|vuelve a|vuelve al|regresar a|regresar al', 'BACK'],
        ['renombrar', 'RENAME', 'guard'],
        ['desde', 'LINK', 'guard'],
        ['si no|sino|de lo contrario|en caso contrario', 'ELSE', 'lead'],
        ['si', 'IF', 'lead'],
        ['decision', 'DECISION', 'guard'],
        ['inicio', 'START', 'guard'],
        ['fin', 'FINISH', 'guard', ['de', 'del']],
        ['paso', 'STEP', 'guard'],
        ['y despues|y luego|despues|luego', 'STEP', '', ['de', 'del', 'que']],
        ['horizontal', 'DIR', 'solo', null, 'LR'], ['vertical', 'DIR', 'solo', null, 'TD'],
      ],
    },
    en: {
      yes: 'Yes', no: 'No', start: 'Start', end: 'End', ask: (t) => (/[?]$/.test(t) ? t : t + '?'),
      to: ['to'], as: ['to', 'as'], then: ['then'], els: ['else', 'otherwise', 'if not'],
      rows: [
        ['end diagram|end flowchart|end of diagram|end the diagram|finish diagram|close diagram', 'END'],
        ['stop dictation|end dictation|stop listening|finish dictation', 'STOP'],
        ['delete last step|delete the last step|remove last step|remove the last step|undo last step', 'DELETE'],
        ['go back to|back to|return to|loop back to', 'BACK'],
        ['rename', 'RENAME', 'guard'],
        ['from', 'LINK', 'lead'],
        ['else|otherwise|if not', 'ELSE', 'lead'],
        ['if', 'IF', 'lead'],
        ['decision', 'DECISION', 'guard'],
        ['start', 'START', 'guard'],
        ['end', 'FINISH', 'guard', ['of']],
        ['step', 'STEP', 'guard'],
        ['and then|after that|then|next', 'STEP', 'guard'],
        ['horizontal', 'DIR', 'solo', null, 'LR'], ['vertical', 'DIR', 'solo', null, 'TD'],
      ],
    },
  };

  // ---------- Búsqueda de frases ----------
  // De la tabla a un índice por primera palabra, con las frases más largas primero.
  function index(rows, make) {
    const out = new Map();
    rows.forEach((row) => row[0].split('|').forEach((phrase) => {
      const w = phrase.split(' '); const entry = Object.assign({ w }, make(row));
      if (!out.has(w[0])) out.set(w[0], []);
      out.get(w[0]).push(entry);
    }));
    out.forEach((list) => list.sort((a, b) => b.w.length - a.w.length));
    return out;
  }
  const match = (idx, keys, i) => (idx.get(keys[i]) || []).find((e) => e.w.every((w, k) => keys[i + k] === w)) || null;
  const langOf = (lang) => (/^es/i.test(lang || '') ? 'es' : 'en');
  const cache = {};
  const table = (name, lang, build) => cache[name + lang] || (cache[name + lang] = build());

  // ---------- Números dichos con palabras ----------
  const NUM = {
    es: { units: { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
      dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 },
      tens: { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 },
      hundreds: { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 },
      thousand: ['mil'], million: ['millon', 'millones'], and: 'y', point: { coma: '{,}', punto: '.' } },
    en: { units: { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 },
      tens: { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
      hundreds: {}, hundred: 'hundred', thousand: ['thousand'], million: ['million'], and: 'and', point: { point: '.' } },
  };
  // Un entero dicho con palabras desde la posición i: { n, len } o nada.
  function wholeAt(keys, i, lang) {
    const N = NUM[lang]; let total = 0; let cur = 0; let k = i; let any = false;
    for (; k < keys.length; k++) {
      const w = keys[k];
      if (Object.prototype.hasOwnProperty.call(N.units, w)) { if (any && cur % 100 !== 0 && !(cur % 10 === 0 && cur % 100 >= 20 && N.units[w] < 10)) break; cur += N.units[w]; any = true; }
      else if (Object.prototype.hasOwnProperty.call(N.tens, w)) {
        if (any && cur % 100 !== 0) break;
        cur += N.tens[w]; any = true;
        // "treinta y cinco": la "y" es parte del número solo entre una decena y una unidad.
        const u = N.units[keys[k + 2]];
        if (lang === 'es' && keys[k + 1] === N.and && u > 0 && u < 10) { cur += u; k += 2; }
      }
      else if (Object.prototype.hasOwnProperty.call(N.hundreds, w)) { if (any && cur !== 0) break; cur += N.hundreds[w]; any = true; }
      else if (N.hundred && w === N.hundred && any && cur > 0 && cur < 10) { cur *= 100; if (keys[k + 1] === N.and && (N.units[keys[k + 2]] != null || N.tens[keys[k + 2]] != null)) k++; }
      else if (N.thousand.includes(w) && (any || lang === 'es')) { total += (cur || 1) * 1000; cur = 0; any = true; }
      else if (N.million.includes(w) && any) { total += (cur || 1) * 1e6; cur = 0; }
      else break;
    }
    return any ? { n: total + cur, len: k - i } : null;
  }
  // Un número con decimales: "uno coma cinco", "three point one four". Los decimales se dicen de a uno o como número.
  function numberAt(keys, i, lang) {
    const whole = wholeAt(keys, i, lang); if (!whole) return null;
    let out = String(whole.n); let len = whole.len;
    const sep = NUM[lang].point[keys[i + len]];
    if (sep && wholeAt(keys, i + len + 1, lang)) {
      let k = i + len + 1; let dec = '';
      for (let part = wholeAt(keys, k, lang); part; part = wholeAt(keys, k, lang)) { dec += String(part.n); k += part.len; }
      out += sep + dec; len = k - i;
    }
    return { v: out, len };
  }

  // ---------- Modo texto ----------
  // Cómo se pega un pedazo a lo que ya estaba escrito: con o sin espacio, y con mayúscula al empezar una oración.
  //   kind: 'text' | 'punct' | 'open' (puntuación que abre: no deja espacio después).   glue: lo anterior abrió algo.
  function join(before, piece, kind, glue) {
    const b = String(before || '').replace(/\u200b/g, '');
    if (kind === 'punct') return piece;
    const space = b !== '' && !/\s$/.test(b) && !glue ? ' ' : '';
    if (kind === 'open') return space + piece;
    const fresh = b.trim() === '' || /[.!?…]["”)\]]?\s*$/.test(b) || /[¿¡]$/.test(b);
    return space + (fresh ? cap(piece) : piece);
  }

  function parseText(text, lang, ctx) {
    const raw = words(text); const keys = raw.map(key); const idx = table('text', lang, () => index(TEXT[lang], (r) => ({ ops: [].concat(r[1]), flag: r[2] || '' })));
    const ops = []; let pend = []; let heading = false; let titled = false; let afterCmd = true; let list = !!(ctx && ctx.list);
    const flush = () => { if (pend.length) { ops.push({ op: 'text', text: pend.join(' ') }); if (heading) titled = true; pend = []; } };
    // Un título es un solo renglón: lo que sigue va en un bloque nuevo.
    const endHeading = (next) => { if (heading && titled && next !== 'break' && next !== 'next') ops.push({ op: 'break' }); heading = false; titled = false; };
    for (let i = 0; i < raw.length; i++) {
      const hit = match(idx, keys, i);
      const guarded = hit && ((hit.flag === 'guard' && i > 0 && pend.length && DET[lang].includes(keys[i - 1])) || (hit.flag === 'lead' && !afterCmd) || (hit.flag === 'list' && !afterCmd && (!list || DET[lang].includes(keys[i - 1]))) || (hit.flag === 'solo' && raw.length !== hit.w.length));
      if (!hit || guarded) { pend.push(raw[i]); afterCmd = false; continue; }
      const first = hit.ops[0];
      if (first.op === 'literal') { if (i + 1 < raw.length) { pend.push(raw[i + 1]); i++; afterCmd = false; } continue; }
      flush();
      i += hit.w.length - 1; afterCmd = true;
      if (first.op === 'mode') { endHeading('mode'); ops.push({ op: 'mode', mode: first.mode, rest: raw.slice(i + 1).join(' ') }); return { mode: 'text', ops, text: plain(ops) }; }
      if (first.op === 'block' || first.op === 'break' || first.op === 'next' || first.op === 'stop' || first.op === 'undo' || first.op === 'scratch') endHeading(first.op);
      hit.ops.forEach((o) => ops.push(Object.assign({}, o)));
      if (first.op === 'block') { heading = first.kind === 'h1' || first.kind === 'h2'; titled = false; list = first.kind === 'ul' || first.kind === 'task'; }
      if (first.op === 'break' || first.op === 'next') heading = false;
    }
    flush(); endHeading('end');
    return { mode: 'text', ops, text: plain(ops) };
  }

  // Lo que esas órdenes escriben, como Markdown. Sirve para probar la gramática sin un documento.
  const PREFIX = { p: '', h1: '# ', h2: '## ', ul: '- ', task: '- [ ] ', quote: '> ' };
  const MARK = { bold: '**', italic: '*', code: '`' };
  function plain(ops) {
    const blocks = []; let cur = null; let glue = false;
    const open = (kind, done) => { cur = { kind, done: !!done, text: '' }; blocks.push(cur); glue = false; };
    const need = () => { if (!cur) open('p'); };
    ops.forEach((o) => {
      if (o.op === 'text') { need(); cur.text += join(cur.text, o.text, 'text', glue); glue = false; }
      else if (o.op === 'punct') { need(); cur.text += join(cur.text, o.text, o.open ? 'open' : 'punct', glue); glue = !!o.open; }
      else if (o.op === 'fmt') { need(); cur.text += o.on ? join(cur.text, MARK[o.kind], 'open', glue) : MARK[o.kind]; glue = o.on; }
      else if (o.op === 'break' || o.op === 'next') { const k = cur && (cur.kind === 'ul' || cur.kind === 'task') ? cur.kind : 'p'; open(k); }
      else if (o.op === 'block') { if (cur && !cur.text) blocks.pop(); open(o.kind, o.done); }
    });
    const live = blocks.filter((b) => b.text);
    return live.map((b, i) => (i ? (live[i - 1].kind === b.kind && (b.kind === 'ul' || b.kind === 'task') ? '\n' : '\n\n') : '') + (b.kind === 'task' && b.done ? '- [x] ' : PREFIX[b.kind]) + b.text).join('');
  }

  // ---------- Modo fórmula ----------
  const texText = (s) => s.replace(/[\\^~]/g, '').replace(/([#$%&_{}])/g, '\\$1');
  function formulaTokens(text, lang) {
    const raw = words(text); const keys = raw.map(key);
    const idx = table('formula', lang, () => {
      const rows = FORMULA[lang].slice();
      GREEK.concat(['zeta']).forEach((g) => { if (g !== 'zeta' || lang === 'en') rows.push([g, 'CONST', '\\' + g]); });
      if (lang === 'es') Object.keys(GREEK_ES).forEach((g) => rows.push([g, 'CONST', '\\' + GREEK_ES[g]]));
      return index(rows, (r) => ({ type: r[1], v: r[2] }));
    });
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const hit = match(idx, keys, i);
      // Un número dicho con palabras gana, salvo ante una frase más larga ("uno" no es parte de ninguna).
      const num = numberAt(keys, i, lang);
      if (num && (!hit || hit.w.length <= num.len)) { out.push({ type: 'NUM', v: num.v, w: raw.slice(i, i + num.len).join(' ') }); i += num.len - 1; continue; }
      if (hit) { out.push({ type: hit.type, v: hit.v, w: raw.slice(i, i + hit.w.length).join(' '), at: i, len: hit.w.length }); i += hit.w.length - 1; continue; }
      const k = keys[i]; let m;
      if (SYMBOLS[raw[i]]) out.push({ type: SYMBOLS[raw[i]][0], v: SYMBOLS[raw[i]][1], w: raw[i] });
      else if ((m = /^(\d+)(?:([.,])(\d+))?([a-z]*)$/.exec(k))) {
        out.push({ type: 'NUM', v: m[1] + (m[2] ? (m[2] === ',' ? '{,}' : '.') + m[3] : ''), w: raw[i] });
        m[4].split('').forEach((c) => out.push({ type: 'VAR', v: c, w: c }));
      }
      else if (/^[a-z]$/.test(k)) out.push({ type: 'VAR', v: /^[A-Z]$/.test(raw[i]) && raw.length > 1 && i > 0 ? raw[i] : k, w: raw[i] });
      else if (k) out.push({ type: 'TEXT', v: raw[i].replace(/^[.,;:!?¿¡"'()]+|[.,;:!?"'()]+$/g, ''), w: raw[i] });
    }
    return { tokens: out, raw };
  }

  const atom = (s, more) => Object.assign({ kind: 'atom', s }, more || {});
  const inner = (a) => (a ? (a.inner != null ? a.inner : a.s) : '');
  function joinItems(items) {
    let out = '';
    items.forEach((it, i) => {
      const prev = items[i - 1];
      if (!prev) { out += it.s; return; }
      if (it.kind === 'bin' || prev.kind === 'bin') { out += ' ' + it.s; return; }
      const gap = it.text || prev.text || (/\\[a-zA-Z]+$/.test(prev.s) && /^[a-zA-Z]/.test(it.s)) || (/\d$/.test(prev.s) && /^\d/.test(it.s)) || it.big || prev.big;
      out += (gap ? ' ' : '') + it.s;
    });
    return out;
  }
  function capital(a) {
    if (!a) return a;
    const g = /^\\([a-z]+)$/.exec(a.s);
    if (g) { const up = g[1][0].toUpperCase() + g[1].slice(1); return GREEK_CAP.includes(up) ? atom('\\' + up) : a; }
    return /^[a-z]$/.test(a.s) ? atom(a.s.toUpperCase()) : a;
  }

  function buildFormula(tokens, lang) {
    let i = 0;
    const at = () => tokens[i];
    const is = (type) => !!tokens[i] && tokens[i].type === type;
    const skipFiller = () => { while (is('FILLER')) i++; };
    const SIGN = /^(\+|-|\\pm)$/;

    function expr(stops) {
      const items = []; let sign = '';
      const push = (a) => { if (!a) return; if (sign) { a = Object.assign({}, a, { s: sign + a.s, inner: null }); sign = ''; } items.push(a); };
      while (i < tokens.length) {
        const t = at();
        if (stops.includes(t.type)) break;
        if (t.type === 'RP' || t.type === 'ENDFRAC' || t.type === 'FILLER') { i++; continue; } // sueltos: no cierran nada
        if (t.type === 'BIN') {
          i++;
          const last = items[items.length - 1];
          if (SIGN.test(t.v) && (!last || last.kind === 'bin') && !sign) sign = t.v === '\\pm' ? '\\pm ' : t.v;
          else items.push({ kind: 'bin', s: t.v });
          continue;
        }
        if (t.type === 'OVER' || t.type === 'BETWEEN') {
          i++;
          const last = items[items.length - 1]; const den = signed(stops);
          if (last && last.kind === 'atom' && den) items[items.length - 1] = atom('\\frac{' + inner(last) + '}{' + inner(den) + '}', { frac: true });
          else { items.push({ kind: 'bin', s: '/' }); if (den) items.push(den); }
          continue;
        }
        if (t.type === 'TENDS') { i++; items.push({ kind: 'bin', s: '\\to' }); continue; }
        if (t.type === 'AND') { i++; if (lang === 'es') push(postfix(atom('y'), stops)); continue; }
        if (t.type === 'FROM' || t.type === 'TO') { i++; push(atom('\\text{' + texText(t.w) + '}', { text: true })); continue; }
        push(withPost(stops));
      }
      if (sign) items.push(atom(sign.trim()));
      return joinItems(items);
    }

    // Una pieza con su signo: "menos uno", "más infinito".
    function signed(stops) {
      let sign = '';
      while (is('BIN') && SIGN.test(at().v)) { sign += at().v === '\\pm' ? '\\pm ' : at().v; i++; }
      const a = withPost(stops);
      if (!a) return sign ? atom(sign.trim()) : null;
      return sign ? atom(sign + a.s) : a;
    }

    // Lo que va pegado detrás de una pieza: potencias, subíndices, factorial, por ciento.
    function postfix(a, stops) {
      while (a && i < tokens.length) {
        const t = at();
        if (stops.includes(t.type)) break;
        const base = () => (a.pow || a.frac ? '{' + a.s + '}' : a.s);
        if (t.type === 'POST') { i++; a = /^\^/.test(t.v) ? atom(base() + t.v, { pow: true }) : atom(a.s + t.v, { pow: a.pow }); }
        else if (t.type === 'POW') { i++; skipFiller(); const e = signedBare(stops); a = atom(base() + '^{' + inner(e) + '}', { pow: true }); }
        else if (t.type === 'SUB') { i++; skipFiller(); const e = bare(stops); a = atom(a.s + '_{' + inner(e) + '}', { pow: a.pow }); }
        else if (t.type === 'CAPPREV') { i++; a = capital(a); }
        else break;
      }
      return a;
    }
    const withPost = (stops) => postfix(bare(stops), stops);
    function signedBare(stops) {
      let sign = '';
      while (is('BIN') && SIGN.test(at().v)) { sign += at().v; i++; }
      let a = bare(stops);
      if (is('CAPPREV')) { i++; a = capital(a); }
      return a ? (sign ? atom(sign + a.s) : a) : (sign ? atom(sign) : null);
    }

    // Una pieza sola: un número, una letra, un paréntesis, una raíz, una fracción, una suma…
    function bare(stops) {
      const t = at();
      if (!t || stops.includes(t.type)) return null;
      i++;
      if (t.type === 'NUM' || t.type === 'VAR' || t.type === 'CONST') return atom(t.v);
      if (t.type === 'FILLER') return bare(stops);
      if (t.type === 'CAPNEXT') return capital(bare(stops));
      if (t.type === 'LP') { const body = expr(['RP']); if (is('RP')) i++; return atom('\\left(' + body + '\\right)', { inner: body }); }
      if (t.type === 'SQRT') { skipFiller(); const a = signed(stops); return atom('\\sqrt' + (t.v ? '[' + t.v + ']' : '') + '{' + inner(a) + '}'); }
      if (t.type === 'FRAC') {
        const num = expr(['OVER', 'BETWEEN', 'ENDFRAC']); let den = '';
        if (is('OVER') || is('BETWEEN')) { i++; den = expr(['ENDFRAC']); }
        if (is('ENDFRAC')) i++;
        return atom('\\frac{' + num + '}{' + den + '}', { frac: true });
      }
      if (t.type === 'BIG') {
        // "suma de … desde … hasta …", "integral de … entre … y …", o los límites antes que el cuerpo.
        const body = expr(['FROM', 'BETWEEN'].concat(stops)); let lo = ''; let hi = '';
        if (is('FROM') || is('BETWEEN')) { i++; lo = expr(['TO', 'AND'].concat(stops)); if (is('TO') || is('AND')) { i++; hi = inner(signed(stops)); } }
        return atom(t.v + (lo ? '_{' + lo + '}' : '') + (hi ? '^{' + hi + '}' : '') + (body ? ' ' + body : ''), { big: true });
      }
      if (t.type === 'LIM') {
        const v = expr(['TENDS'].concat(stops)); let to = '';
        if (is('TENDS')) { i++; to = inner(signed(stops)); }
        return atom('\\lim' + (v || to ? '_{' + v + (to ? ' \\to ' + to : '') + '}' : ''), { big: true });
      }
      if (t.type === 'FUNC') { skipFiller(); const a = withPost(stops); return atom(t.v + (a ? (a.inner != null ? a.s : ' ' + a.s) : '')); }
      if (t.type === 'DIFF') { skipFiller(); const a = bare(stops); return atom('\\,d' + (a ? a.s : '')); }
      if (t.type === 'BIN') { const a = bare(stops); return atom(t.v + (a ? a.s : '')); }
      // Lo que no se entiende queda como texto dentro de la fórmula, con las palabras seguidas juntas.
      const said = [t.type === 'TEXT' ? t.v : t.w];
      while (is('TEXT')) { said.push(at().v); i++; }
      return atom('\\text{' + texText(said.join(' ')) + '}', { text: true });
    }
    return expr([]);
  }

  function parseFormula(text, lang) {
    const { tokens, raw } = formulaTokens(text, lang);
    const cut = tokens.findIndex((t) => t.type === 'END' || t.type === 'STOP');
    const end = cut < 0 ? null : tokens[cut];
    return { mode: 'formula', latex: buildFormula(cut < 0 ? tokens : tokens.slice(0, cut), lang), done: !!end, stop: !!end && end.type === 'STOP', rest: end ? raw.slice(end.at + end.len).join(' ') : '' };
  }

  // ---------- Modo diagrama ----------
  const mmText = (s) => s.replace(/#/g, '#35;').replace(/&/g, '#amp;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/`/g, "'").replace(/[\r\n]+/g, ' ');
  const tidy = (s) => cap(s.replace(/^[\s.,;:]+|[\s.,;:]+$/g, ''));
  // Parte una frase en dos por la primera de esas palabras: "revisar a enviar" -> ["revisar", "enviar"].
  function splitBy(raw, seps, pick) {
    const keys = raw.map(key); const cuts = [];
    for (let i = 1; i < raw.length - 1; i++) {
      const sep = seps.find((s) => { const w = s.split(' '); return w.every((x, k) => keys[i + k] === x) && i + w.length < raw.length; });
      if (sep) cuts.push([i, sep.split(' ').length]);
    }
    if (!cuts.length) return null;
    const best = (pick && cuts.find((c) => pick(raw.slice(0, c[0]).join(' ')))) || cuts[0];
    return [raw.slice(0, best[0]).join(' '), raw.slice(best[0] + best[1]).join(' ')];
  }

  function parseDiagram(text, lang) {
    const L = DIAGRAM[lang]; const idx = table('diagram', lang, () => index(L.rows, (r) => ({ type: r[1], flag: r[2] || '', not: r[3] || null, v: r[4] })));
    // Cada renglón es algo que se dijo de corrido: las órdenes "lead" solo valen al empezarlo.
    const clauses = []; let done = false; let stop = false; let rest = '';
    const said = String(text || '').split(/\n+/).map(words).filter((w) => w.length);
    said.some((raw, u) => {
      const keys = raw.map(key); let cur = { type: 'STEP', words: [] };
      const close = () => { if (cur.type !== 'STEP' || cur.words.length) clauses.push(cur); };
      for (let i = 0; i < raw.length; i++) {
        const hit = match(idx, keys, i);
        const lead = i === 0 || (cur.words.length === 0 && cur.type !== 'STEP') || (cur.type === 'IF' && hit && hit.type === 'ELSE');
        if (cur.type === 'IF' && !cur.then && L.then.includes(keys[i])) { cur.then = true; cur.words.push(raw[i]); continue; }
        const skip = hit && ((hit.flag === 'guard' && cur.words.length && DET[lang].includes(keys[i - 1]) && !/^[A-Z]$/.test(raw[i - 1])) || (hit.flag === 'lead' && !lead) || (hit.flag === 'solo' && raw.length !== hit.w.length) || (hit.not && hit.not.includes(keys[i + hit.w.length])));
        if (!hit || skip) { cur.words.push(raw[i]); continue; }
        if (hit.type === 'END' || hit.type === 'STOP') { close(); done = true; stop = hit.type === 'STOP'; rest = raw.slice(i + hit.w.length).concat(...said.slice(u + 1)).join(' '); cur = null; return true; }
        // "si … entonces … si no …" es una sola frase: el "si no" de adentro no la corta.
        if (hit.type === 'ELSE' && cur.type === 'IF') { cur.words.push(raw[i]); if (hit.w.length > 1) cur.words.push(...raw.slice(i + 1, i + hit.w.length)); i += hit.w.length - 1; continue; }
        close(); cur = { type: hit.type, v: hit.v, words: [] }; i += hit.w.length - 1;
      }
      close();
      return false;
    });

    const nodes = []; const edges = []; let dir = 'TD'; let last = null; let decision = null; let pending = null; let seq = 0;
    const find = (name) => { const q = fold(tidy(name)); if (!q) return null; return nodes.slice().reverse().find((n) => fold(n.text) === q || fold(n.text).replace(/[¿?]/g, '') === q) || nodes.slice().reverse().find((n) => fold(n.text).includes(q) || q.includes(fold(n.text).replace(/[¿?]/g, ''))) || null; };
    const add = (label, shape) => { const n = { id: 'n' + (++seq), text: label, shape }; nodes.push(n); return n; };
    // De dónde sale la flecha al paso nuevo: del anterior o, tras una decisión, de ella, con su sí o su no.
    const link = (to) => {
      let from = last; let label = '';
      if (pending) { from = pending.from; label = pending.label; pending = null; }
      else if (from && from.shape === 'ask') { const outs = edges.filter((e) => e.from === from.id); label = !outs.some((e) => e.label === L.yes) ? L.yes : !outs.some((e) => e.label === L.no) ? L.no : ''; }
      if (from && to && !edges.some((e) => e.from === from.id && e.to === to.id && e.label === label)) edges.push({ from: from.id, to: to.id, label });
    };
    const step = (label, shape) => { const n = add(label, shape); link(n); last = n; if (shape === 'ask') decision = n; return n; };

    clauses.forEach((c) => {
      const txt = tidy(c.words.join(' '));
      if (c.type === 'DIR') dir = c.v;
      else if (c.type === 'START') { const n = add(txt || L.start, 'round'); last = n; }
      else if (c.type === 'FINISH') step(txt || L.end, 'round');
      else if (c.type === 'STEP') { if (txt) step(txt, 'box'); }
      else if (c.type === 'DECISION') { if (txt) step(L.ask(txt), 'ask'); }
      else if (c.type === 'IF') {
        const a = splitBy(c.words, L.then); const cond = tidy(a ? a[0] : c.words.join(' ')); if (!cond) return;
        const b = a ? splitBy(words(a[1]), L.els) : null; const yes = tidy(a ? (b ? b[0] : a[1]) : ''); const no = tidy(b ? b[1] : '');
        const d = step(L.ask(cond), 'ask'); let keep = d;
        if (yes) { const n = add(yes, 'box'); edges.push({ from: d.id, to: n.id, label: L.yes }); keep = n; }
        if (no) { const n = add(no, 'box'); edges.push({ from: d.id, to: n.id, label: L.no }); }
        last = keep; decision = d;
      }
      else if (c.type === 'ELSE') { if (!decision) { if (txt) step(txt, 'box'); return; } pending = { from: decision, label: L.no }; if (txt) step(txt, 'box'); }
      else if (c.type === 'BACK') { const to = find(txt); if (to) link(to); else pending = null; }
      else if (c.type === 'LINK') {
        const p = splitBy(c.words, L.to, (left) => !!find(left)); if (!p) return;
        const from = find(p[0]) || add(tidy(p[0]), 'box'); const to = find(p[1]) || add(tidy(p[1]), 'box');
        if (!edges.some((e) => e.from === from.id && e.to === to.id)) edges.push({ from: from.id, to: to.id, label: '' });
      }
      else if (c.type === 'RENAME') { const p = splitBy(c.words, L.as, (left) => !!find(left)); const n = p && find(p[0]); if (n && tidy(p[1])) n.text = n.shape === 'ask' ? L.ask(tidy(p[1])) : tidy(p[1]); }
      else if (c.type === 'DELETE') {
        const n = nodes.pop(); if (!n) return;
        const came = edges.filter((e) => e.to === n.id).map((e) => e.from);
        for (let k = edges.length - 1; k >= 0; k--) if (edges[k].from === n.id || edges[k].to === n.id) edges.splice(k, 1);
        last = nodes.find((x) => x.id === came[came.length - 1]) || nodes[nodes.length - 1] || null;
        decision = nodes.slice().reverse().find((x) => x.shape === 'ask') || null; pending = null;
      }
    });

    const SHAPE = { box: ['[', ']'], round: ['([', '])'], ask: ['{', '}'] };
    const lines = ['flowchart ' + dir]
      .concat(nodes.map((n) => '  ' + n.id + SHAPE[n.shape][0] + '"' + mmText(n.text) + '"' + SHAPE[n.shape][1]))
      .concat(edges.map((e) => '  ' + e.from + ' -->' + (e.label ? '|"' + mmText(e.label) + '"|' : '') + ' ' + e.to));
    return { mode: 'diagram', mermaid: lines.join('\n'), nodes: nodes.length, edges: edges.length, done, stop, rest };
  }

  // ---------- Entrada única ----------
  // parse(texto, modo, idioma, ctx): modo 'text' | 'formula' | 'diagram'; idioma 'es' | 'en'; ctx.list: el cursor está en una lista.
  //   texto    -> { ops, text }: las órdenes en orden y el Markdown que escriben. Si se pasa a otro modo, la última
  //               orden es { op: 'mode', mode, rest } con lo que quedó por interpretar en ese modo.
  //   fórmula  -> { latex, done, stop, rest }: recibe todo lo dicho desde que empezó la fórmula.
  //   diagrama -> { mermaid, nodes, edges, done, stop, rest }: recibe todo lo dicho, un renglón por cada tramo.
  function parse(text, mode, lang, ctx) {
    const l = langOf(lang);
    if (mode === 'formula') return parseFormula(text, l);
    if (mode === 'diagram') return parseDiagram(text, l);
    return parseText(text, l, ctx);
  }

  // Las frases de cada modo, para la hoja de ayuda: [lo que se dice, lo que hace].
  const HELP = {
    es: {
      text: [['punto · coma · dos puntos · signo de pregunta', '. , : ?'], ['punto y aparte · nueva línea', 'Bloque nuevo'], ['título … · subtítulo …', 'Título 1 y 2'], ['nueva lista · siguiente', 'Lista y su ítem siguiente'],
        ['tarea … · tarea hecha …', 'Casilla, vacía o tildada'], ['cita', 'Cita'], ['negrita … fin negrita', 'Negrita'], ['cursiva … fin cursiva', 'Cursiva'], ['código … fin código', 'Código en línea'],
        ['literal punto', 'Escribe la palabra'], ['borrar eso · deshacer', 'Saca lo último'], ['terminar dictado', 'Apaga el micrófono']],
      formula: [['fórmula … fin fórmula', 'Abre y cierra'], ['más · menos · por · sobre · igual', '+ − · fracción ='], ['distinto · mayor o igual · menor que', '≠ ≥ <'], ['al cuadrado · al cubo · elevado a', 'Potencias'],
        ['raíz de · raíz cúbica de', 'Raíces'], ['subíndice', 'x₁'], ['abre paréntesis · cierra paréntesis', '( )'], ['fracción … sobre … fin fracción', 'Fracción larga'],
        ['suma de … desde … hasta …', 'Sumatoria'], ['integral de … entre … y …', 'Integral'], ['límite cuando … tiende a …', 'Límite'], ['pi · infinito · alfa · beta · por ciento', 'π ∞ α β %']],
      diagram: [['diagrama de flujo … fin diagrama', 'Abre y cierra'], ['inicio … · fin …', 'Extremos'], ['paso … · después …', 'Paso unido al anterior'], ['decisión …', 'Rombo'],
        ['si … entonces … si no …', 'Rombo con sí y no'], ['volver a …', 'Flecha a un paso anterior'], ['desde … a …', 'Flecha entre dos pasos'], ['renombrar … como …', 'Cambia un texto'], ['borrar último paso', 'Saca el último']],
    },
    en: {
      text: [['period · comma · colon · question mark', '. , : ?'], ['new paragraph · new line', 'New block'], ['title … · subtitle …', 'Heading 1 and 2'], ['new list · next', 'List and its next item'],
        ['task … · task done …', 'Checkbox, empty or ticked'], ['quote', 'Quote'], ['bold … end bold', 'Bold'], ['italic … end italic', 'Italic'], ['code … end code', 'Inline code'],
        ['literal period', 'Writes the word'], ['scratch that · undo', 'Removes the last bit'], ['stop dictation', 'Turns the microphone off']],
      formula: [['formula … end formula', 'Opens and closes'], ['plus · minus · times · over · equals', '+ − · fraction ='], ['not equal to · greater than or equal to · less than', '≠ ≥ <'], ['squared · cubed · to the power of', 'Powers'],
        ['square root of · cube root of', 'Roots'], ['sub', 'x₁'], ['open parenthesis · close parenthesis', '( )'], ['fraction … over … end fraction', 'Long fraction'],
        ['sum of … from … to …', 'Summation'], ['integral of … from … to …', 'Integral'], ['limit as … approaches …', 'Limit'], ['pi · infinity · alpha · beta · percent', 'π ∞ α β %']],
      diagram: [['flowchart … end diagram', 'Opens and closes'], ['start … · end …', 'Ends'], ['step … · then …', 'Step joined to the previous one'], ['decision …', 'Diamond'],
        ['if … then … else …', 'Diamond with yes and no'], ['go back to …', 'Arrow to an earlier step'], ['from … to …', 'Arrow between two steps'], ['rename … to …', 'Changes a label'], ['delete last step', 'Removes the last one']],
    },
  };

  LMD.voice = { parse, join, plain, fold, HELP, TABLES: { TEXT, FORMULA, DIAGRAM } };
})(typeof self !== 'undefined' ? self : this);
