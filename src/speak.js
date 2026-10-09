// Herramienta: leer en voz alta. Usa las voces del dispositivo (speechSynthesis): no sale nada a ningún servicio.
// Lee la nota entera, desde un bloque o lo elegido; marca el bloque y la oración que va leyendo y los mantiene a la vista.
// Lee el texto de la nota y nada de la interfaz: el código y los diagramas se anuncian, las tablas van fila por fila,
// y una sección cerrada se abre mientras se la lee y vuelve a como estaba.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const ICON = LMD.tools.ICON;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const PREV = svg('<path d="M18 6v12l-8.500-6z"/><path d="M6.500 6v12"/>');
  const NEXT = svg('<path d="M6 6v12l8.500-6z"/><path d="M17.500 6v12"/>');
  let core = null; let on = false; let wired = false;
  const opt = (k, d) => LMD.tools.opt(k, d);

  // Lo que se anuncia en vez de leerse, en el idioma en que se está leyendo.
  const SAY = {
    es: { code: 'Bloque de código.', diagram: 'Diagrama.', formula: 'Fórmula.', board: 'Tablero.', image: 'Imagen', done: 'Hecho:', link: 'enlace a' },
    en: { code: 'Code block.', diagram: 'Diagram.', formula: 'Formula.', board: 'Board.', image: 'Image', done: 'Done:', link: 'link to' },
  };
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  const PAUSE_HEADING = 450; const PAUSE_TITLE = 250;
  // Los tiempos del motor de voz. Están a la vista (LMD.speak.limits) para que las pruebas no tengan que esperarlos.
  const LIM = {
    chars: 150, // largo de un fragmento a velocidad normal: unos 10 segundos. Chrome corta solo una locución cerca de los 15
    quiet: 90, // ms entre un cancel y el speak siguiente: si se pide antes, el navegador se lo come
    start: 5000, // ms sin que el fragmento arranque: la cola está trabada, se la vacía y se lo pide de nuevo
    endMin: 6000, endPad: 3500, endBy: 2.5, // cuánto se espera el final de un fragmento: lo estimado por endBy, más endPad
    cps: 11, // letras por segundo de una voz lenta a velocidad normal (para estimar)
    hands: 4000, // ms sin arrastrar la página después de que la persona la desplazó a mano
  };
  const now = () => Date.now();

  // ---------- Qué es de la nota y qué es de la interfaz ----------
  // No hay una lista de clases a mantener: lo que la app agrega al artículo se reconoce por lo que es. Un control
  // (botón, campo, role=button), algo que no se ve o no se anuncia (hidden, aria-hidden), lo que se marque con
  // data-ui, y lo que la app pone como "no editable" sin ser un bloque de la nota (los bloques traen data-l, sus
  // líneas en el Markdown). tests/voice.mjs falla si aparece texto de interfaz que esto no reconoce.
  const UI = '[data-ui], [aria-hidden="true"], [hidden], button, input, select, textarea, [role="button"], [role="toolbar"], [role="menu"], script, style, template';
  // Partes de la nota que no se editan en el lugar (una fórmula, un enlace a otra nota, el número de un título).
  const PART = '.lmd-math, .lmd-wiki, .lmd-hnum';
  function isUi(n) {
    if (n.matches(UI)) return true;
    return n.getAttribute('contenteditable') === 'false' && !n.matches(PART) && !n.hasAttribute('data-l') && !n.querySelector('[data-l]');
  }
  // Lo que sale de la nota pero no se lee (la ficha del principio, el índice, las llamadas de las notas al pie), y lo
  // poco de la interfaz que todavía no trae ninguna de las marcas de arriba.
  const NOT_READ = '.lmd-front, .lmd-toc, hr, .footnotes-sep, .footnote-ref, .footnote-backref, .lmd-anchor, .lmd-code-lang, .lmd-add, .lmd-draft, .lmd-draft-li, .lmd-cm-layer, .lmd-live-layer';
  const NOTE = { '.lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz, .lmd-graphviz': 'diagram', '.lmd-board, pre.lmd-kanban': 'board', '.lmd-math-block': 'formula', '.lmd-code, pre': 'code' };
  const BLOCKS = ':scope > p, :scope > ul, :scope > ol, :scope > div, :scope > blockquote, :scope > pre, :scope > table, :scope > dl, :scope > details, :scope > section, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6';
  const BREAK = /^(P|DIV|LI|DT|DD|TD|TH|TR|H[1-6]|BLOCKQUOTE|SUMMARY|SECTION|FIGCAPTION)$/;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const URLISH = /^(https?:\/\/|www\.)\S+$/i;
  // Una fórmula corta y simple se lee tal cual; lo demás se anuncia.
  const simpleTex = (tex) => (/^[\w\s=+\-.,()<>]{1,24}$/.test(tex || '') ? tex : '');
  const host = (url) => { try { return new URL(/^www\./i.test(url) ? 'https://' + url : url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };
  const words = (lang) => SAY[lang === 'es' ? 'es' : lang === 'en' ? 'en' : (LMD.lang() === 'es' ? 'es' : 'en')];

  // El texto de un nodo como se dice, y de dónde sale cada letra: at[k] es [nodo de texto, posición] o null si esa
  // letra no está en la página (un anuncio). Con eso se resalta la oración que se lee sin tocar el documento.
  // o.flat: sin las listas de adentro (van aparte). o.skip: un hijo que no se cuenta.
  function collect(node, L, o) {
    o = o || {};
    let text = ''; const at = []; let gap = false;
    const put = (ch, n, i) => {
      if (ch === '​' || ch === '﻿') return;
      const space = /\s/.test(ch);
      // Tras un anuncio va un espacio, salvo que lo que sigue sea un signo de puntuación.
      if (gap) { gap = false; if (!space && !/[.,;:!?)\]]/.test(ch)) put(' '); }
      if (space) { if (!text || text.charCodeAt(text.length - 1) === 32) return; ch = ' '; }
      text += ch; at.push(n ? [n, i] : null);
    };
    const word = (s) => { put(' '); for (let i = 0; i < s.length; i++) put(s[i]); gap = true; };
    const walk = (n) => {
      if (n.nodeType === 3) { const v = n.nodeValue; for (let i = 0; i < v.length; i++) put(v[i], n, i); return; }
      if (n.nodeType !== 1 || n === o.skip || n.namespaceURI !== HTML_NS) return;
      if (n !== node && (isUi(n) || n.matches(NOT_READ))) return;
      const tag = n.tagName;
      if (o.flat && n !== node && (tag === 'UL' || tag === 'OL')) return;
      if (n.classList.contains('lmd-math')) { word(simpleTex(n.getAttribute('data-tex')) || L.formula.replace(/\.$/, '')); return; }
      if (tag === 'IMG') { const alt = (n.getAttribute('alt') || '').trim(); if (alt) word(L.image + ': ' + alt + '.'); else put(' '); return; }
      if (tag === 'BR') { put(' '); return; }
      // Un enlace se lee por su texto. Si el texto es la dirección, alcanza con decir a dónde va.
      if (tag === 'A') { const t = n.textContent.trim(); if (URLISH.test(t)) { word(L.link + ' ' + host(t)); return; } }
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (BREAK.test(tag)) put(' ');
    };
    walk(node);
    while (text && text.charCodeAt(text.length - 1) === 32) { text = text.slice(0, -1); at.pop(); }
    return { text, at };
  }

  // Lo que hay para leer, en orden: [{ node, text, at, say?, pause?, whole?, lines? }]. say es un anuncio (código,
  // diagrama…), whole un título (va de corrido) y lines el texto de un bloque de código (va renglón por renglón).
  function segments(rootNode, lang, o) {
    o = o || {};
    const L = words(lang);
    const readCode = o.code != null ? !!o.code : !!opt('speakCode', false);
    const skipDone = o.skipDone != null ? !!o.skipDone : !!opt('speakSkipDone', false);
    const out = [];
    const push = (node, c, more) => { if (c.text) out.push(Object.assign({ node, text: c.text, at: c.at || null }, more || {})); };
    const out_ = (n) => n.nodeType !== 1 || isUi(n) || n.matches(NOT_READ);
    const item = (li) => {
      if (li.tagName !== 'LI' || out_(li)) return;
      // Una tarea tildada se anuncia como hecha, o se saltea si así se pidió.
      const box = Array.from(li.querySelectorAll('input[type=checkbox]')).find((i) => i.closest('li') === li);
      const done = !!box && box.checked;
      if (!(done && skipDone)) {
        const c = collect(li, L, { flat: true });
        if (c.text && done) { const pre = L.done + ' '; c.text = pre + c.text; c.at = new Array(pre.length).fill(null).concat(c.at); }
        push(li, c);
      }
      li.querySelectorAll(':scope > ul, :scope > ol').forEach(walk);
    };
    // Una sección desplegable: su título y después lo de adentro. Si está cerrada se decide al llegar (nextSeg).
    const box = (d) => {
      const s = d.querySelector(':scope > summary');
      if (s) push(s, collect(s, L), { pause: PAUSE_TITLE, whole: true });
      const loose = Array.from(d.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (loose) { push(d, collect(d, L, { skip: s })); return; }
      Array.from(d.children).forEach((k) => { if (k !== s) walk(k); });
    };
    function walk(node) {
      if (out_(node)) return;
      for (const sel in NOTE) {
        if (!node.matches(sel)) continue;
        const kind = NOTE[sel];
        const tex = kind === 'formula' ? simpleTex(node.getAttribute('data-tex')) : '';
        if (tex) { out.push({ node, text: tex, at: null }); return; }
        out.push({ node, text: L[kind], at: null, say: kind });
        if (kind === 'code' && readCode) {
          const src = ((node.querySelector('code') || node).textContent || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
          if (src) out.push({ node, text: src, at: null, lines: true });
        }
        return;
      }
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) { push(node, collect(node, L), { pause: PAUSE_HEADING, whole: true }); return; }
      if (tag === 'UL' || tag === 'OL') { Array.from(node.children).forEach(item); return; }
      if (node.matches('.lmd-table, table')) {
        // Fila por fila, con las celdas separadas por una coma.
        node.querySelectorAll('tr').forEach((tr) => push(tr, { text: Array.from(tr.cells).map((c) => collect(c, L).text).filter(Boolean).join(', ') }));
        return;
      }
      if (tag === 'DETAILS') { box(node); return; }
      if (node.querySelector(BLOCKS)) { Array.from(node.children).forEach(walk); return; }
      push(node, collect(node, L));
    }
    Array.from(rootNode.children).forEach(walk);
    return out;
  }

  // Español o inglés, mirando las palabras más comunes de cada uno. Sin diferencia clara, el idioma de la app.
  const WORDS = { es: ' el la los las de del que y en un una por con para es no se lo su al como más pero ', en: ' the and of to in is that for with on it this are be as at by from or not you ' };
  function detect(text) {
    const low = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
    const score = { es: (String(text || '').match(/[áéíóúñ¿¡]/gi) || []).length * 2, en: 0 };
    low.trim().split(' ').forEach((w) => { if (WORDS.es.includes(' ' + w + ' ')) score.es++; if (WORDS.en.includes(' ' + w + ' ')) score.en++; });
    return score.es === score.en ? (LMD.lang() === 'es' ? 'es' : 'en') : score.es > score.en ? 'es' : 'en';
  }

  // En Chrome una locución larga se corta sola, y una voz remota todavía antes: se lee de a fragmentos cortos. Cada
  // uno es una oración; las muy largas se parten en las comas y las muy cortas van con la anterior, que entre un
  // fragmento y otro la voz hace un silencio. Devuelve [desde, hasta) sobre el texto, para saber qué resaltar.
  const limit = (rate) => Math.max(90, Math.min(220, Math.round(LIM.chars * (rate || 1))));
  function pieces(text, max, mode) {
    max = max || LIM.chars;
    const found = []; const out = [];
    const add = (a, b) => { while (a < b && /\s/.test(text[a])) a++; while (b > a && /\s/.test(text[b - 1])) b--; if (b > a) found.push([a, b]); };
    let from = 0;
    if (mode !== 'whole') {
      // Una oración termina en un punto seguido de espacio (no en "3.5" ni en "v2.1"), o en un renglón de código.
      const re = /[.!?…]+["”’»)\]]*(?=\s|$)|\n+/g; let m;
      while ((m = re.exec(text))) { add(from, m[0][0] === '\n' ? m.index : m.index + m[0].length); from = m.index + m[0].length; }
    }
    add(from, text.length);
    const push = (a, b, join) => {
      const last = out[out.length - 1];
      if (join && last && b - last[0] <= max) last[1] = b; else out.push([a, b]);
    };
    found.forEach((f) => {
      let a = f[0]; const b = f[1]; let first = true;
      while (b - a > max) {
        const win = text.slice(a, a + max);
        let cut = win.lastIndexOf(', '); if (cut < max * 0.3) cut = win.lastIndexOf(' '); if (cut < max * 0.3) cut = max - 1;
        let e = a + cut + 1; while (e > a && text[e - 1] === ' ') e--;
        push(a, e, first && mode !== 'lines'); first = false;
        a += cut + 1; while (a < b && text[a] === ' ') a++;
      }
      if (b > a) push(a, b, first && mode !== 'lines');
    });
    return out;
  }
  const sentences = (text, max) => pieces(text, max).map((p) => text.slice(p[0], p[1]));

  // ---------- Voces ----------
  const synth = () => window.speechSynthesis || null;
  const langTag = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  // Algunas voces llegan tarde (Chrome, Safari): se las espera un momento la primera vez.
  let voicesAsked = null;
  function voices() {
    const s = synth(); if (!s) return Promise.resolve([]);
    const have = s.getVoices();
    if (have.length) return Promise.resolve(have);
    if (!voicesAsked) voicesAsked = new Promise((resolve) => {
      let done = false; const end = () => { if (done) return; done = true; voicesAsked = null; resolve(s.getVoices()); };
      if (s.addEventListener) s.addEventListener('voiceschanged', end, { once: true }); else s.onvoiceschanged = end;
      setTimeout(end, 1800);
    });
    return voicesAsked;
  }
  const voicesFor = (all, lang) => all.filter((v) => langTag(v).startsWith(lang));
  function pickVoice(all, lang) {
    const mine = voicesFor(all, lang); if (!mine.length) return null;
    const saved = opt(lang === 'es' ? 'speakVoiceEs' : 'speakVoiceEn', '');
    const here = String(navigator.language || '').toLowerCase();
    return mine.find((v) => v.voiceURI === saved) || mine.find((v) => langTag(v) === here) || mine.find((v) => v.default) || mine.find((v) => v.localService) || mine[0];
  }

  // ---------- La lectura ----------
  const st = {
    segs: [], i: 0, parts: [], p: 0, dir: 1, active: false, paused: false, token: 0, lang: 'en', voice: null, all: [], timer: null, job: null, marked: null, note: '', picked: false,
    cancelAt: 0, spoke: false, mute: false, handsOff: 0, autoUntil: 0,
    opened: new Map(), // secciones desplegables que abrió la lectura: nodo -> { n: su orden en la nota, title }
    unfolded: new Map(), // títulos plegados que desplegó la lectura: nodo -> id
    mine: new WeakMap(), // hasta cuándo un cambio de abierto/cerrado es de la lectura y no de la persona
  };
  let bar = null;
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  const article = () => core.ui.article;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Lo que la lectura mueve en la página no cuenta como un desplazamiento de la persona.
  const ours = (ms) => { st.autoUntil = Math.max(st.autoUntil, now() + ms); };

  // --- Secciones cerradas: se abren para leerlas y vuelven a como estaban ---
  const topOf = (node) => { let n = node; const a = article(); while (n && n.parentNode !== a) n = n.parentNode; return n || null; };
  const titleOf = (d) => { const s = d.querySelector(':scope > summary'); return ((s && s.textContent) || '').trim(); };
  // Las secciones desplegables cerradas que esconden ese nodo (el título de una sección se ve aunque esté cerrada).
  function shutBoxes(node) {
    const out = []; const a = article();
    for (let d = node.closest('details'); d && a.contains(d); d = d.parentElement ? d.parentElement.closest('details') : null) {
      const s = d.querySelector(':scope > summary');
      if (!d.open && !(s && s.contains(node))) out.push(d);
    }
    return out;
  }
  // Los títulos plegados (fold.js) que tienen ese nodo en su sección.
  function shutHeads(node) {
    const F = LMD.fold; const top = topOf(node);
    if (!F || !F.on() || !top || !top.classList.contains('lmd-fold-away')) return [];
    return Array.from(article().querySelectorAll(':scope > .lmd-fold-shut')).filter((h) => F.section(h).includes(top));
  }
  function setBox(d, open) { st.mine.set(d, now() + 400); ours(400); d.open = open; }
  function openBox(d) {
    if (!st.opened.has(d)) st.opened.set(d, { n: Array.prototype.indexOf.call(article().querySelectorAll('details'), d), title: titleOf(d) });
    setBox(d, true);
  }
  // Al pasar de largo: lo que abrió la lectura y ya no contiene lo que se lee, se cierra. Con node en null, todo.
  function restore(node) {
    st.opened.forEach((info, d) => {
      if (node && d.contains(node)) return;
      st.opened.delete(d);
      if (d.isConnected && d.open) setBox(d, false);
    });
    st.unfolded.forEach((id, h) => {
      if (node && (h === node || h.contains(node))) return;
      const F = LMD.fold; const top = node ? topOf(node) : null;
      if (top && F && h.isConnected && F.section(h).includes(top)) return;
      st.unfolded.delete(h);
      if (F && h.isConnected && !h.classList.contains('lmd-fold-shut')) { ours(400); F.outline(h, true); }
    });
  }
  // Deja a la vista lo que se va a leer. Devuelve false si está en una sección cerrada y se pidió no leerlas.
  function reveal(seg) {
    const node = seg.node; if (!node || !node.isConnected || !article().contains(node)) return true;
    const boxes = shutBoxes(node); const heads = shutHeads(node);
    const read = opt('speakCollapsed', true) !== false;
    if ((boxes.length || heads.length) && !read) return false;
    // El título de una sección cerrada: se abre ahí mismo, así se ve lo que viene.
    const own = node.tagName === 'SUMMARY' && node.parentNode && node.parentNode.tagName === 'DETAILS' ? node.parentNode : null;
    if (own && !own.open && read) boxes.push(own);
    boxes.forEach(openBox);
    heads.forEach((h) => { st.unfolded.set(h, h.id); ours(400); LMD.fold.outline(h, false); });
    return true;
  }

  // --- La marca y el desplazamiento ---
  function clearHl() { if (HL) { try { CSS.highlights.delete('lmd-speaking'); } catch (e) { /* sin resaltes */ } } }
  function mark(node) {
    if (st.marked && st.marked !== node) st.marked.classList.remove('lmd-speaking');
    st.marked = node && node.isConnected ? node : null;
    if (st.marked) st.marked.classList.add('lmd-speaking');
  }
  // La parte del bloque que se está diciendo, como un rango sobre el texto de la página.
  function rangeOf(seg, part) {
    if (!seg || !seg.at || !part) return null;
    let a = part.a; let b = part.b - 1;
    while (a <= b && !seg.at[a]) a++;
    while (b >= a && !seg.at[b]) b--;
    if (a > b) return null;
    const x = seg.at[a]; const y = seg.at[b];
    if (!x[0].isConnected || !y[0].isConnected || x[1] >= x[0].nodeValue.length || y[1] >= y[0].nodeValue.length) return null;
    try { const r = document.createRange(); r.setStart(x[0], x[1]); r.setEnd(y[0], y[1] + 1); return r; } catch (e) { return null; }
  }
  const scrollerOf = (node) => {
    for (let p = node && node.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  };
  // A la vista, sin tirones: solo se mueve la página si lo que se lee quedó fuera de la zona cómoda, y nunca justo
  // después de que la persona la desplazó a mano.
  function follow(rect) {
    if (!rect || !st.marked || now() < st.handsOff) return;
    const top = 70; const bottom = window.innerHeight - (bar ? bar.offsetHeight + 60 : 60); const room = bottom - top;
    if (rect.top >= top && rect.bottom <= bottom) return;
    const delta = rect.height > room ? rect.top - top : rect.top + rect.height / 2 - (top + room / 2);
    if (Math.abs(delta) < 2) return;
    ours(1500);
    const how = { top: delta, behavior: calm() ? 'auto' : 'smooth' };
    const sc = scrollerOf(st.marked);
    if (sc) sc.scrollBy(how); else window.scrollBy(how);
  }
  // Marca el bloque y, si el bloque se lee en varios fragmentos, también el que suena ahora.
  function show() {
    const seg = st.segs[st.i]; if (!seg) return;
    mark(seg.node);
    clearHl();
    let rect = null;
    if (HL && st.parts.length > 1) {
      const r = rangeOf(seg, st.parts[st.p]);
      if (r) { try { CSS.highlights.set('lmd-speaking', new Highlight(r)); const box = r.getBoundingClientRect(); if (box.height) rect = box; } catch (e) { /* sin resaltes */ } }
    }
    if (st.marked) follow(rect || st.marked.getBoundingClientRect());
  }
  const hands = () => { if (st.active) st.handsOff = now() + LIM.hands; };

  // --- El motor de voz ---
  const later = (fn, ms) => { const mine = st.token; clearTimeout(st.timer); st.timer = setTimeout(() => { if (mine === st.token) fn(); }, ms); };
  function drop(job) { if (!job) return; job.dead = true; clearTimeout(job.t1); clearTimeout(job.t2); if (st.job === job) st.job = null; }
  // Vacía la cola del navegador. Lo que se pida después espera un momento: un speak pegado a un cancel se pierde.
  function flush() { const s = synth(); if (s) { try { s.cancel(); } catch (e) { /* sin voz en curso */ } } st.cancelAt = now(); }
  // Cuánto tarda en decirse un texto, tirando a largo: los números se dicen en muchas más sílabas que letras tienen.
  const estimate = (text, rate) => ((text.length + 3 * (text.match(/\d/g) || []).length) / (LIM.cps * (rate || 1))) * 1000;

  // Dice un fragmento y avisa cómo terminó: then('') si se dijo, then(error) si el navegador no pudo.
  function utter(text, then, tries) {
    const s = synth(); const mine = st.token; tries = tries || 0;
    let waited = 0;
    const go = () => {
      if (mine !== st.token) return;
      // Con algo sonando o en espera, lo nuevo queda en la cola y no sale nunca: primero se la vacía.
      if ((s.speaking || s.pending) && waited < 600) { flush(); waited += LIM.quiet; later(go, LIM.quiet); return; }
      const wait = LIM.quiet - (now() - st.cancelAt);
      if (wait > 0) { later(go, wait); return; }
      // Un navegador que quedó en pausa (al volver de otra pestaña) no dice nada hasta que se lo reanuda.
      try { if (s.paused) s.resume(); } catch (e) { /* no estaba en pausa */ }
      const u = new SpeechSynthesisUtterance(text);
      const rate = +opt('speakRate', 1) || 1;
      u.lang = st.voice ? st.voice.lang.replace('_', '-') : (st.lang === 'es' ? 'es-ES' : 'en-US');
      if (st.voice) u.voice = st.voice;
      u.rate = rate;
      const job = { u, dead: false, started: false, beat: 0, t1: 0, t2: 0 }; // con la referencia guardada el navegador no la descarta a mitad de camino
      const end = (err) => {
        if (job.dead) return;
        // Un motor que termina las frases sin haber avisado nunca que arrancaban: ahí no se puede esperar ese aviso.
        if (!err) { st.spoke = true; if (!job.started) st.mute = true; }
        drop(job); if (mine !== st.token) return; then(err || '');
      };
      // No arrancó, o pasó de sobra su tiempo sin avisar que terminó: se vacía la cola y se sigue.
      const again = () => { drop(job); flush(); if (mine !== st.token) return; if (tries < 2) utter(text, then, tries + 1); else then(st.spoke ? '' : 'stuck'); };
      u.onstart = () => { job.started = true; st.spoke = true; st.mute = false; };
      u.onboundary = () => { job.started = true; job.beat = now(); };
      u.onend = () => end('');
      u.onerror = (e) => end((e && e.error) || 'error');
      st.job = job;
      try { s.speak(u); } catch (e) { end('synthesis-failed'); return; }
      job.t1 = setTimeout(() => { if (!job.dead && !job.started && !st.mute) again(); }, LIM.start);
      const over = () => {
        if (job.dead) return;
        // Una voz del dispositivo va avisando palabra por palabra: si avisó recién, sigue hablando de verdad.
        if (job.beat && now() - job.beat < 2500) { job.t2 = setTimeout(over, 2500); return; }
        drop(job); flush(); if (mine === st.token) then('');
      };
      job.t2 = setTimeout(over, Math.max(LIM.endMin, estimate(text, rate) * LIM.endBy + LIM.endPad));
    };
    go();
  }
  // Una voz remota que falla (sin conexión, sin cupo): se prueba con una del dispositivo.
  function localVoice() {
    const mine = voicesFor(st.all, st.lang).filter((v) => v.localService);
    return mine.find((v) => v.default) || mine[0] || null;
  }
  function nextPart(tries) {
    if (!st.active || st.paused) return;
    if (st.p >= st.parts.length) {
      const seg = st.segs[st.i];
      // Tras un título, una pausa corta antes de seguir.
      later(() => { st.i++; nextSeg(); }, (seg && seg.pause) || 0);
      return;
    }
    show();
    utter(st.parts[st.p].text, (err) => {
      if (err && !/interrupted|cancel/.test(err)) {
        const local = st.voice && st.voice.localService === false ? localVoice() : null;
        if (!tries && err !== 'stuck') { if (local) st.voice = local; nextPart(1); return; }
        stop(); core.flash(T('El navegador no pudo leer en voz alta.'), 'warn'); return;
      }
      // Algo de afuera cortó la frase (otra página que habla, el sistema): se la dice de nuevo, una vez.
      if (err && !tries) { nextPart(1); return; }
      st.p++; nextPart();
    });
  }
  function nextSeg() {
    if (!st.active) return;
    let seg = null;
    for (;;) {
      if (st.i < 0) { st.i = 0; st.dir = 1; }
      seg = st.segs[st.i];
      if (!seg) { stop(); return; }
      // Una sección cerrada se abre para leerla, o se saltea (queda su título) si así se pidió.
      if (st.picked || reveal(seg)) break;
      st.i += st.dir;
    }
    st.dir = 1;
    if (!st.picked) restore(seg.node);
    const max = limit(+opt('speakRate', 1) || 1);
    st.parts = pieces(seg.text, max, seg.whole ? 'whole' : seg.lines ? 'lines' : '').map((x) => ({ a: x[0], b: x[1], text: seg.text.slice(x[0], x[1]) }));
    st.p = 0;
    paint();
    nextPart();
  }

  // Dónde empezar: el bloque pedido, lo que lo contiene, o lo primero que viene después de él.
  function indexOf(segs, from) {
    if (!from) return 0;
    let i = segs.findIndex((s) => s.node === from || from.contains(s.node) || s.node.contains(from));
    if (i < 0) i = segs.findIndex((s) => from.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING);
    return i < 0 ? 0 : i;
  }
  // La nota como se lee en ese idioma; con el idioma en automático, el que tenga el texto.
  function build(text, from) {
    const pref = opt('speakLang', 'auto');
    const make = (lang) => (text ? [{ node: from || null, text: text.replace(/\s+/g, ' ').trim(), at: null }] : segments(article(), lang));
    if (pref === 'es' || pref === 'en') return { lang: pref, segs: make(pref) };
    let segs = make('en');
    const lang = detect(segs.filter((x) => !x.say && !x.lines).map((x) => x.text).join(' '));
    if (lang !== 'en' && !text) segs = make(lang);
    return { lang, segs };
  }

  // start({ from: nodo desde el que se lee, text: lo elegido }): sin nada, la nota entera.
  // Safari en iPhone solo deja hablar si la primera frase sale dentro del toque. Lo que sigue (esperar las voces,
  // armar la barra) ya queda fuera: por eso, la primera vez, sale ahí mismo una frase vacía y sin volumen.
  let primed = false;
  function prime(s) {
    if (primed || !LMD.device.ios) return;
    primed = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } catch (e) { /* sin voz */ }
  }
  async function start(o) {
    o = o || {};
    const s = synth();
    if (!s || !on || core.noDoc) return false;
    halt(); restore(null);
    prime(s);
    const made = build(o.text, o.from);
    if (!made.segs.some((x) => x.text)) { core.flash(T('No hay texto para leer.'), 'warn'); return false; }
    let all = []; try { all = Array.from((await voices()) || []); } catch (e) { all = []; }
    if (!all.length) { core.flash(T('Este navegador no tiene voces instaladas para leer.'), 'warn'); return false; }
    st.lang = made.lang; st.all = all; st.voice = pickVoice(all, st.lang);
    st.segs = made.segs; st.picked = !!o.text; st.i = o.text ? 0 : indexOf(made.segs, o.from); st.dir = 1;
    st.active = true; st.paused = false; st.spoke = false; st.handsOff = 0; st.token++; st.note = core.HERE;
    showBar(all);
    nextSeg();
    return true;
  }
  // Corta la voz ya mismo. Lo que estaba en camino (una frase, una pausa, un reintento) queda sin efecto.
  function halt() {
    st.token++; clearTimeout(st.timer);
    drop(st.job);
    flush();
  }
  function pause() { if (!st.active || st.paused) return; st.paused = true; halt(); paint(); }
  // Sigue desde el fragmento que se cortó: pausar con el navegador no anda igual en todos.
  function resume() { if (!st.active || !st.paused) return; st.paused = false; paint(); nextPart(); }
  function stop() {
    halt(); st.active = false; st.paused = false; st.segs = []; st.parts = [];
    mark(null); clearHl();
    restore(null);
    if (bar) { bar.remove(); bar = null; }
  }
  // Al bloque siguiente o al anterior. Hacia atrás, con el bloque ya empezado, primero vuelve a su principio.
  function step(dir) {
    if (!st.active) return;
    const back = dir < 0;
    halt(); st.handsOff = 0;
    if (back && st.p > 0) st.dir = 1; else { st.i += back ? -1 : 1; st.dir = back ? -1 : 1; }
    if (!back && st.i >= st.segs.length) { stop(); return; }
    st.paused = false;
    nextSeg();
  }
  const toggle = () => { if (!st.active) return startHere(); if (st.paused) resume(); else pause(); return true; };

  // Lo que pide el atajo: lo elegido, o desde el bloque del cursor, o la nota entera.
  function startHere() {
    const a0 = article(); const sel = getSelection();
    const inside = sel.rangeCount && sel.anchorNode && a0.contains(sel.anchorNode);
    const block = (n) => { while (n && n.parentNode !== a0) n = n.parentNode; return n || null; };
    if (inside && !sel.isCollapsed && sel.toString().trim()) return start({ text: sel.toString(), from: block(sel.anchorNode) });
    const a = document.activeElement;
    if (core.editMode && a && a.isContentEditable && a0.contains(a)) return start({ from: a.closest('li') || block(a) });
    if (inside) { const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode; return start({ from: (n.closest && n.closest('li, tr')) || block(n) }); }
    return start({});
  }

  // ---------- Los controles ----------
  function paint() {
    if (!bar) return;
    const b = bar.querySelector('[data-spk=play]');
    b.innerHTML = st.paused ? ICON.play : ICON.pause;
    b.title = T(st.paused ? 'Seguir leyendo' : 'Pausar'); b.setAttribute('aria-label', b.title);
    bar.classList.toggle('lmd-spk-paused', st.paused);
  }
  const voiceOptions = (all, lang, saved) => '<option value="">' + esc(T('Voz automática')) + '</option>' + voicesFor(all, lang).map((v) => '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === saved ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('');
  const rateOptions = () => { const cur = +opt('speakRate', 1) || 1; return RATES.map((r) => '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + String(r).replace('.', LMD.lang() === 'es' ? ',' : '.') + '×</option>').join(''); };
  const langOptions = (cur) => [['auto', 'Idioma automático'], ['es', 'Español'], ['en', 'English']].map((o) => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[0] === 'auto' ? T(o[1]) : o[1]) + '</option>').join('');
  const voiceKey = (lang) => (lang === 'es' ? 'speakVoiceEs' : 'speakVoiceEn');
  // Cambiar la voz, el idioma o la velocidad vale desde el fragmento que se está leyendo.
  function retune(all) {
    if (!st.active) return;
    if (!st.picked) {
      // Los anuncios van en el idioma de la lectura: la nota se arma de nuevo, y se sigue en el mismo bloque.
      const made = build('', null);
      st.lang = made.lang;
      if (made.segs.length === st.segs.length) st.segs = made.segs;
    } else { const pref = opt('speakLang', 'auto'); st.lang = pref === 'es' || pref === 'en' ? pref : detect(st.segs.map((x) => x.text).join(' ')); }
    st.voice = pickVoice(all, st.lang);
    if (bar) bar.querySelector('[data-spk=voice]').innerHTML = voiceOptions(all, st.lang, opt(voiceKey(st.lang), ''));
    if (st.paused) return;
    halt(); nextPart();
  }
  // Las opciones se guardan y valen ya, sin esperar a que vuelvan del almacenamiento.
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }

  function showBar(all) {
    if (bar) bar.remove();
    bar = el('div', { class: 'lmd-spk', role: 'toolbar', 'aria-label': T('Leer en voz alta') });
    const btn = (k, label, icon) => '<button type="button" class="lmd-icon-btn" data-spk="' + k + '"' + (label ? ' title="' + esc(T(label)) + '" aria-label="' + esc(T(label)) + '"' : '') + '>' + (icon || '') + '</button>';
    bar.innerHTML =
      btn('prev', 'Bloque anterior', PREV) + btn('play') + btn('next', 'Bloque siguiente', NEXT) + btn('stop', 'Detener', ICON.stop) +
      '<select data-spk="rate" aria-label="' + esc(T('Velocidad')) + '" title="' + esc(T('Velocidad')) + '">' + rateOptions() + '</select>' +
      '<select data-spk="lang" aria-label="' + esc(T('Idioma de la lectura')) + '" title="' + esc(T('Idioma de la lectura')) + '">' + langOptions(opt('speakLang', 'auto')) + '</select>' +
      '<select data-spk="voice" aria-label="' + esc(T('Voz')) + '" title="' + esc(T('Voz')) + '">' + voiceOptions(all, st.lang, opt(voiceKey(st.lang), '')) + '</select>';
    document.body.appendChild(bar);
    bar.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); }); // lo elegido en la nota sigue elegido
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-spk]'); if (!b) return;
      const k = b.dataset.spk;
      if (k === 'stop') stop(); else if (k === 'prev') step(-1); else if (k === 'next') step(1); else if (st.paused) resume(); else pause();
    });
    bar.addEventListener('change', (e) => {
      const k = e.target.dataset.spk; const v = e.target.value;
      const done = k === 'rate' ? keep({ speakRate: +v }) : k === 'lang' ? keep({ speakLang: v }) : keep((() => { const p = {}; p[voiceKey(st.lang)] = v; return p; })());
      Promise.resolve(done).then(() => retune(all));
    });
    paint();
  }

  // ---------- Opciones en Ajustes > Herramientas ----------
  const CHECKS = [['speakCollapsed', 'Leer las secciones cerradas', true], ['speakSkipDone', 'Saltear las tareas hechas', false], ['speakCode', 'Leer los bloques de código', false]];
  // Dibujar las opciones no toca el motor de voz: la lista de voces se le pide al navegador recién con "Elegir voz"
  // (o al empezar a leer). got son las voces, cuando ya se pidieron.
  async function settings(area, api, got) {
    const loaded = Array.isArray(got); const all = loaded ? got : [];
    const lang = opt('speakLang', 'auto'); const shown = lang === 'auto' ? (LMD.lang() === 'es' ? 'es' : 'en') : lang;
    area.innerHTML =
      (!loaded || all.length ? '' : '<p class="lmd-tl-why">' + esc(T('Este navegador no tiene voces instaladas para leer.')) + '</p>') +
      '<label class="lmd-row"><span>' + esc(T('Velocidad')) + '</span><select data-spk="rate">' + rateOptions() + '</select></label>' +
      '<label class="lmd-row"><span>' + esc(T('Idioma de la lectura')) + '</span><select data-spk="lang">' + langOptions(lang) + '</select></label>' +
      (loaded ? '<label class="lmd-row"><span>' + esc(T('Voz')) + '</span><select data-spk="voice">' + voiceOptions(all, shown, opt(voiceKey(shown), '')) + '</select></label>' :
        '<div class="lmd-row"><span>' + esc(T('Voz')) + '</span><button type="button" class="lmd-btn" data-spk="voices">' + esc(T('Elegir voz')) + '</button></div>') +
      CHECKS.map((c) => '<label class="lmd-check"><input type="checkbox" data-spk-opt="' + c[0] + '"' + (opt(c[0], c[2]) ? ' checked' : '') + '><span>' + esc(T(c[1])) + '</span></label>').join('') +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T(LMD.touch.coarse() ? 'Desde el menú de los tres puntos, o manteniendo apretado un párrafo: Leer desde acá.' : 'Atajo: Alt+Shift+S. También con clic derecho, Leer desde acá.')) + '</span><button type="button" class="lmd-btn" data-spk="go">' + esc(T('Leer esta nota')) + '</button></div>';
    area.querySelector('[data-spk=rate]').addEventListener('change', (e) => keep({ speakRate: +e.target.value }));
    area.querySelector('[data-spk=lang]').addEventListener('change', (e) => { keep({ speakLang: e.target.value }); settings(area, api, got); });
    const pick = area.querySelector('[data-spk=voice]');
    if (pick) pick.addEventListener('change', (e) => { const p = {}; p[voiceKey(shown)] = e.target.value; keep(p); });
    const ask = area.querySelector('[data-spk=voices]');
    if (ask) ask.addEventListener('click', async () => {
      ask.disabled = true;
      let list = []; try { list = (await voices()) || []; } catch (e) { list = []; }
      if (!area.isConnected) return;
      await settings(area, api, Array.from(list));
      const sel = area.querySelector('[data-spk=voice]'); if (sel) sel.focus({ preventScroll: true });
    });
    area.querySelectorAll('[data-spk-opt]').forEach((box) => box.addEventListener('change', () => { const p = {}; p[box.dataset.spkOpt] = box.checked; keep(p); }));
    const go = area.querySelector('[data-spk=go]');
    go.disabled = (loaded && !all.length) || core.noDoc;
    go.addEventListener('click', () => { api.close(); start({}); });
  }

  // ---------- Encendido ----------
  function onKey(e) {
    // Las teclas que mueven la página cuentan como un desplazamiento a mano.
    if (st.active && /^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown)$/.test(e.key)) hands();
    if (!on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyS') return;
    if (core.noDoc || document.querySelector('.lmd-ask, .lmd-dgm') || !core.ui.panel.hidden) return;
    e.preventDefault(); toggle();
  }
  // En el menú de lectura (clic derecho): leer lo elegido, o desde ese bloque.
  function menuItem(ctx) {
    if (!on || !synth()) return null;
    if (ctx.picked) return ['speak', ICON.speak, 'Leer la selección', () => start({ text: ctx.picked, from: ctx.block })];
    if (!ctx.block) return null;
    return ['speak', ICON.speak, 'Leer desde acá', () => start({ from: (ctx.target && ctx.target.closest && ctx.target.closest('li, tr')) || ctx.block })];
  }
  // La nota se volvió a dibujar: los bloques son otros. La lectura sigue en el que tiene el mismo texto.
  function redrawn() {
    if (!st.active || st.picked) return;
    const cur = st.segs[st.i]; const fresh = segments(article(), st.lang);
    if (cur && !(fresh[st.i] && fresh[st.i].text === cur.text)) {
      let best = -1;
      fresh.forEach((f, k) => { if (f.text === cur.text && (best < 0 || Math.abs(k - st.i) < Math.abs(best - st.i))) best = k; });
      st.i = best >= 0 ? best : Math.min(st.i, Math.max(0, fresh.length - 1));
    }
    st.segs = fresh;
    // Lo que la lectura abrió sigue anotado en los nodos nuevos, para cerrarlo al pasar.
    const boxes = article().querySelectorAll('details');
    Array.from(st.opened).forEach(([d, info]) => { if (d.isConnected) return; st.opened.delete(d); const n = boxes[info.n]; if (n && titleOf(n) === info.title) st.opened.set(n, info); });
    Array.from(st.unfolded).forEach(([h, id]) => { if (h.isConnected) return; st.unfolded.delete(h); const n = id && document.getElementById(id); if (n && article().contains(n)) st.unfolded.set(n, id); });
    const seg = st.segs[st.i];
    if (seg) { if (!cur || seg.text !== cur.text) seg.at = null; show(); }
  }
  function enable(c) {
    core = c; on = true;
    if (wired) return;
    wired = true;
    window.addEventListener('keydown', onKey);
    LMD.write.readMenu.push(menuItem);
    // En pantalla chica no hay atajo ni clic derecho a mano: la lectura también arranca y se detiene desde el menú "más".
    core.actions.speak = () => { if (st.active) stop(); else startHere(); };
    core.menus.more.push(() => (on && synth() && core.blocks && LMD.touch.small() ? ['speak', ICON.speak, st.active ? 'Detener la lectura' : 'Leer en voz alta'] : null));
    // Otra nota: lo que se estaba leyendo ya no está.
    core.hooks.doc.push(() => { if (st.active && st.note !== core.HERE) stop(); });
    core.hooks.render.push(redrawn);
    core.hooks.patch.push(redrawn);
    window.addEventListener('pagehide', () => { if (st.active) stop(); else halt(); });
    // Otra pestaña o la ventana minimizada: la voz se calla. Queda en pausa, en su lugar, para seguir al volver.
    document.addEventListener('visibilitychange', () => { if (document.hidden && st.active && !st.paused) pause(); });
    // La persona movió la página: por unos segundos la lectura no la arrastra de vuelta.
    window.addEventListener('wheel', hands, { passive: true, capture: true });
    window.addEventListener('touchmove', hands, { passive: true, capture: true });
    document.addEventListener('scroll', () => { if (st.active && now() > st.autoUntil) hands(); }, { passive: true, capture: true });
    document.addEventListener('scrollend', () => { if (st.autoUntil > now()) st.autoUntil = now() + 150; }, { passive: true, capture: true });
    // Abrir o cerrar a mano una sección que había abierto la lectura: queda como la dejó la persona.
    const a = article();
    a.addEventListener('toggle', (e) => { const d = e.target; if (st.opened.has(d) && !((st.mine.get(d) || 0) > now())) st.opened.delete(d); }, true);
    a.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.lmd-fold-tog'); if (t && st.unfolded.has(t.parentNode)) st.unfolded.delete(t.parentNode); }, true);
  }
  function disable() { on = false; stop(); }

  LMD.speak = {
    enable, disable, settings, start, stop, pause, resume, toggle, next: () => step(1), prev: () => step(-1), segments, sentences, pieces, detect, isUi, limits: LIM,
    state: () => ({ active: st.active, paused: st.paused, lang: st.lang, i: st.i, total: st.segs.length, part: st.p, parts: st.parts.length, voice: st.voice ? st.voice.name : '' }),
  };
})();
