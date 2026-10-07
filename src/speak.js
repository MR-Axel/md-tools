// Herramienta: leer en voz alta. Usa las voces del dispositivo (speechSynthesis): no sale nada a ningún servicio.
// Lee la nota entera, desde un bloque o lo elegido; marca el bloque que va leyendo y lo mantiene a la vista.
// Lee el texto y no la sintaxis: el código y los diagramas se anuncian, las tablas van fila por fila.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const ICON = LMD.tools.ICON;
  let core = null; let on = false; let wired = false;

  // Lo que se anuncia en vez de leerse, en el idioma en que se está leyendo.
  const SAY = {
    es: { code: 'Bloque de código.', diagram: 'Diagrama.', formula: 'Fórmula.', board: 'Tablero.', image: 'Imagen' },
    en: { code: 'Code block.', diagram: 'Diagram.', formula: 'Formula.', board: 'Board.', image: 'Image' },
  };
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  const PAUSE_HEADING = 450;

  // ---------- De la nota a lo que se lee ----------
  const SKIP = '.lmd-front, .lmd-add, .lmd-toc, hr, .lmd-anchor, .footnotes-sep, script, style, .lmd-cm-layer, .lmd-live-layer';
  const NOTE = { '.lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz, .lmd-graphviz': 'diagram', '.lmd-board, pre.lmd-kanban': 'board', '.lmd-math-block': 'formula', '.lmd-code, pre': 'code' };
  const BLOCKS = ':scope > p, :scope > ul, :scope > ol, :scope > div, :scope > blockquote, :scope > pre, :scope > table, :scope > dl, :scope > details, :scope > section, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6';
  // Una fórmula corta y simple se lee tal cual; lo demás se anuncia.
  const simpleTex = (tex) => (/^[\w\s=+\-.,()<>]{1,24}$/.test(tex || '') ? tex : '');

  // El texto de un nodo como se dice: sin anclas ni botones, con las fórmulas y las imágenes en palabras.
  function spoken(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, input, button, script, style, ul, ol, .footnote-backref, .lmd-voice-ghost, .lmd-err-note').forEach((n) => n.remove());
    c.querySelectorAll('.lmd-math').forEach((m) => m.replaceWith(' ' + (simpleTex(m.getAttribute('data-tex')) || '\u0001formula\u0001') + ' '));
    c.querySelectorAll('img').forEach((img) => img.replaceWith(img.getAttribute('alt') ? ' \u0001image\u0001: ' + img.getAttribute('alt') + '. ' : ' '));
    c.querySelectorAll('br').forEach((b) => b.replaceWith(' '));
    return c.textContent.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  }

  // Lo que hay para leer, en orden: [{ node, text, say?, pause? }]. say es un anuncio (código, diagrama…).
  function segments(rootNode) {
    const out = [];
    const push = (node, text, more) => { if (text) out.push(Object.assign({ node, text }, more || {})); };
    const walk = (node) => {
      if (node.nodeType !== 1 || node.hidden || node.matches(SKIP)) return;
      for (const sel in NOTE) {
        if (!node.matches(sel)) continue;
        const tex = NOTE[sel] === 'formula' ? simpleTex(node.getAttribute('data-tex')) : '';
        if (tex) push(node, tex); else out.push({ node, text: '', say: NOTE[sel] });
        return;
      }
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) { push(node, spoken(node), { pause: PAUSE_HEADING }); return; }
      if (tag === 'UL' || tag === 'OL') {
        Array.from(node.children).forEach((li) => {
          if (li.tagName !== 'LI') return;
          push(li, spoken(li));
          li.querySelectorAll(':scope > ul, :scope > ol').forEach(walk);
        });
        return;
      }
      if (node.matches('.lmd-table, table')) {
        // Fila por fila, con las celdas separadas por una coma.
        node.querySelectorAll('tr').forEach((tr) => push(tr, Array.from(tr.cells).map(spoken).filter(Boolean).join(', ')));
        return;
      }
      if (node.querySelector(BLOCKS)) { Array.from(node.children).forEach(walk); return; }
      push(node, spoken(node));
    };
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

  // En Chrome una lectura larga se corta sola: se lee de a oraciones, y las muy largas se parten en las comas.
  function sentences(text) {
    const out = [];
    (text.match(/[^.!?…]+[.!?…]+["”’)\]]*|[^.!?…]+$/g) || [text]).forEach((s) => {
      s = s.trim(); if (!s) return;
      while (s.length > 220) {
        let cut = s.lastIndexOf(', ', 220); if (cut < 60) cut = s.lastIndexOf(' ', 220); if (cut < 60) cut = 220;
        out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
      }
      if (s) out.push(s);
    });
    return out;
  }

  // ---------- Voces ----------
  const synth = () => window.speechSynthesis || null;
  const langTag = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  // Algunas voces llegan tarde (Chrome, Safari): se las espera un momento la primera vez.
  let voicesAsked = null;
  function voices() {
    const s = synth(); if (!s) return Promise.resolve([]);
    const now = s.getVoices();
    if (now.length) return Promise.resolve(now);
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
    const saved = LMD.tools.opt(lang === 'es' ? 'speakVoiceEs' : 'speakVoiceEn', '');
    const here = String(navigator.language || '').toLowerCase();
    return mine.find((v) => v.voiceURI === saved) || mine.find((v) => langTag(v) === here) || mine.find((v) => v.default) || mine.find((v) => v.localService) || mine[0];
  }

  // ---------- La lectura ----------
  const st = { segs: [], i: 0, parts: [], p: 0, active: false, paused: false, token: 0, lang: 'en', voice: null, timer: null, utter: null, marked: null, note: '' };
  let bar = null;

  function mark(node) {
    if (st.marked && st.marked !== node) st.marked.classList.remove('lmd-speaking');
    st.marked = node && node.isConnected ? node : null;
    if (!st.marked) return;
    st.marked.classList.add('lmd-speaking');
    // A la vista, sin tirones: solo se mueve la página si el bloque quedó fuera de la zona cómoda.
    const r = st.marked.getBoundingClientRect(); const top = 70; const bottom = window.innerHeight - (bar ? bar.offsetHeight + 60 : 60);
    if (r.top < top || r.bottom > bottom) st.marked.scrollIntoView({ block: r.height > bottom - top ? 'start' : 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function say(text, then) {
    const s = synth(); const mine = st.token;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = st.voice ? st.voice.lang.replace('_', '-') : (st.lang === 'es' ? 'es-ES' : 'en-US');
    if (st.voice) u.voice = st.voice;
    u.rate = +LMD.tools.opt('speakRate', 1) || 1;
    let ended = false;
    const end = (e) => { if (ended) return; ended = true; if (mine !== st.token) return; st.utter = null; then(e && e.type === 'error' ? e.error : ''); };
    u.onend = end; u.onerror = end;
    st.utter = u; // con la referencia guardada el navegador no la descarta a mitad de camino
    s.speak(u);
  }
  function nextPart() {
    if (!st.active || st.paused) return;
    if (st.p >= st.parts.length) {
      const seg = st.segs[st.i]; const mine = st.token;
      // Tras un título, una pausa corta antes de seguir.
      st.timer = setTimeout(() => { if (mine !== st.token) return; st.i++; nextSeg(); }, (seg && seg.pause) || 0);
      return;
    }
    say(st.parts[st.p], (err) => {
      if (err && !/interrupted|canceled|cancelled/.test(err)) { stop(); core.flash(T('El navegador no pudo leer en voz alta.'), 'warn'); return; }
      st.p++; nextPart();
    });
  }
  function nextSeg() {
    if (!st.active) return;
    const seg = st.segs[st.i];
    if (!seg) { stop(); return; }
    mark(seg.node);
    const text = (seg.say ? SAY[st.lang][seg.say] : seg.text).replace(/\u0001(\w+)\u0001/g, (m, k) => SAY[st.lang][k].replace(/\.$/, ''));
    st.parts = sentences(text); st.p = 0;
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

  // start({ from: nodo desde el que se lee, text: lo elegido }): sin nada, la nota entera.
  async function start(o) {
    o = o || {};
    const s = synth();
    if (!s || !on || core.noDoc) return false;
    halt();
    const article = core.ui.article;
    const segs = o.text ? [{ node: o.from || null, text: o.text.replace(/\s+/g, ' ').trim() }] : segments(article);
    if (!segs.some((x) => x.text || x.say)) { core.flash(T('No hay texto para leer.'), 'warn'); return false; }
    const pref = LMD.tools.opt('speakLang', 'auto');
    st.lang = pref === 'es' || pref === 'en' ? pref : detect(segs.map((x) => x.text).join(' '));
    const all = await voices();
    if (!all.length) { core.flash(T('Este navegador no tiene voces instaladas para leer.'), 'warn'); return false; }
    st.voice = pickVoice(all, st.lang);
    st.segs = segs; st.i = o.text ? 0 : indexOf(segs, o.from); st.active = true; st.paused = false; st.token++; st.note = core.HERE;
    showBar(all);
    // Un cancel pendiente se come lo que se pide enseguida después: se arranca en la vuelta siguiente.
    const mine = st.token;
    setTimeout(() => { if (mine === st.token) nextSeg(); }, 60);
    return true;
  }
  function halt() {
    st.token++; clearTimeout(st.timer);
    const s = synth(); if (s) { try { s.cancel(); } catch (e) { /* sin voz en curso */ } }
    st.utter = null;
  }
  function pause() { if (!st.active || st.paused) return; st.paused = true; halt(); paint(); }
  // Sigue desde la oración que se cortó: pausar con el navegador no anda igual en todos.
  function resume() { if (!st.active || !st.paused) return; st.paused = false; paint(); const mine = st.token; setTimeout(() => { if (mine === st.token) nextPart(); }, 60); }
  function stop() {
    halt(); st.active = false; st.paused = false; st.segs = []; st.parts = [];
    mark(null);
    if (bar) { bar.remove(); bar = null; }
  }
  const toggle = () => { if (!st.active) return startHere(); if (st.paused) resume(); else pause(); return true; };

  // Lo que pide el atajo: lo elegido, o desde el bloque del cursor, o la nota entera.
  function startHere() {
    const article = core.ui.article; const sel = getSelection();
    const inside = sel.rangeCount && sel.anchorNode && article.contains(sel.anchorNode);
    const block = (n) => { while (n && n.parentNode !== article) n = n.parentNode; return n || null; };
    if (inside && !sel.isCollapsed && sel.toString().trim()) return start({ text: sel.toString(), from: block(sel.anchorNode) });
    const a = document.activeElement;
    if (core.editMode && a && a.isContentEditable && article.contains(a)) return start({ from: a.closest('li') || block(a) });
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
  const rateOptions = () => { const cur = +LMD.tools.opt('speakRate', 1) || 1; return RATES.map((r) => '<option value="' + r + '"' + (r === cur ? ' selected' : '') + '>' + String(r).replace('.', LMD.lang() === 'es' ? ',' : '.') + '×</option>').join(''); };
  const langOptions = (cur) => [['auto', 'Idioma automático'], ['es', 'Español'], ['en', 'English']].map((o) => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[0] === 'auto' ? T(o[1]) : o[1]) + '</option>').join('');
  const voiceKey = (lang) => (lang === 'es' ? 'speakVoiceEs' : 'speakVoiceEn');
  // Cambiar la voz, el idioma o la velocidad vale desde la oración que se está leyendo.
  function retune(all) {
    if (!st.active) return;
    const pref = LMD.tools.opt('speakLang', 'auto');
    st.lang = pref === 'es' || pref === 'en' ? pref : detect(st.segs.map((x) => x.text).join(' '));
    st.voice = pickVoice(all, st.lang);
    if (bar) bar.querySelector('[data-spk=voice]').innerHTML = voiceOptions(all, st.lang, LMD.tools.opt(voiceKey(st.lang), ''));
    if (st.paused) return;
    halt(); const mine = st.token; setTimeout(() => { if (mine === st.token) nextPart(); }, 60);
  }
  // Las opciones se guardan y valen ya, sin esperar a que vuelvan del almacenamiento.
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }

  function showBar(all) {
    if (bar) bar.remove();
    bar = el('div', { class: 'lmd-spk', role: 'toolbar', 'aria-label': T('Leer en voz alta') });
    bar.innerHTML =
      '<button type="button" class="lmd-icon-btn" data-spk="play"></button>' +
      '<button type="button" class="lmd-icon-btn" data-spk="stop" title="' + esc(T('Detener')) + '" aria-label="' + esc(T('Detener')) + '">' + ICON.stop + '</button>' +
      '<select data-spk="rate" aria-label="' + esc(T('Velocidad')) + '" title="' + esc(T('Velocidad')) + '">' + rateOptions() + '</select>' +
      '<select data-spk="lang" aria-label="' + esc(T('Idioma de la lectura')) + '" title="' + esc(T('Idioma de la lectura')) + '">' + langOptions(LMD.tools.opt('speakLang', 'auto')) + '</select>' +
      '<select data-spk="voice" aria-label="' + esc(T('Voz')) + '" title="' + esc(T('Voz')) + '">' + voiceOptions(all, st.lang, LMD.tools.opt(voiceKey(st.lang), '')) + '</select>';
    document.body.appendChild(bar);
    bar.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); }); // lo elegido en la nota sigue elegido
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-spk]'); if (!b) return;
      if (b.dataset.spk === 'stop') stop(); else if (st.paused) resume(); else pause();
    });
    bar.addEventListener('change', (e) => {
      const k = e.target.dataset.spk; const v = e.target.value;
      const done = k === 'rate' ? keep({ speakRate: +v }) : k === 'lang' ? keep({ speakLang: v }) : keep((() => { const p = {}; p[voiceKey(st.lang)] = v; return p; })());
      Promise.resolve(done).then(() => retune(all));
    });
    paint();
  }

  // ---------- Opciones en Ajustes > Herramientas ----------
  async function settings(area, api) {
    const all = await voices(); const lang = LMD.tools.opt('speakLang', 'auto'); const shown = lang === 'auto' ? (LMD.lang() === 'es' ? 'es' : 'en') : lang;
    area.innerHTML =
      (all.length ? '' : '<p class="lmd-tl-why">' + esc(T('Este navegador no tiene voces instaladas para leer.')) + '</p>') +
      '<label class="lmd-row"><span>' + esc(T('Velocidad')) + '</span><select data-spk="rate">' + rateOptions() + '</select></label>' +
      '<label class="lmd-row"><span>' + esc(T('Idioma de la lectura')) + '</span><select data-spk="lang">' + langOptions(lang) + '</select></label>' +
      '<label class="lmd-row"><span>' + esc(T('Voz')) + '</span><select data-spk="voice">' + voiceOptions(all, shown, LMD.tools.opt(voiceKey(shown), '')) + '</select></label>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('Atajo: Alt+Shift+S. También con clic derecho, Leer desde acá.')) + '</span><button type="button" class="lmd-btn" data-spk="go">' + esc(T('Leer esta nota')) + '</button></div>';
    area.querySelector('[data-spk=rate]').addEventListener('change', (e) => keep({ speakRate: +e.target.value }));
    area.querySelector('[data-spk=lang]').addEventListener('change', (e) => { keep({ speakLang: e.target.value }); settings(area, api); });
    area.querySelector('[data-spk=voice]').addEventListener('change', (e) => { const p = {}; p[voiceKey(shown)] = e.target.value; keep(p); });
    const go = area.querySelector('[data-spk=go]');
    go.disabled = !all.length || core.noDoc;
    go.addEventListener('click', () => { api.close(); start({}); });
  }

  // ---------- Encendido ----------
  function onKey(e) {
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
  function enable(c) {
    core = c; on = true;
    if (wired) return;
    wired = true;
    window.addEventListener('keydown', onKey);
    LMD.write.readMenu.push(menuItem);
    // Otra nota: lo que se estaba leyendo ya no está.
    core.hooks.doc.push(() => { if (st.active && st.note !== core.HERE) stop(); });
    // La nota se volvió a dibujar: los bloques son otros. Si es el mismo texto, la marca sigue en su lugar.
    core.hooks.render.push(() => {
      if (!st.active) return;
      const fresh = segments(core.ui.article);
      if (fresh.length === st.segs.length) { fresh.forEach((f, k) => { st.segs[k].node = f.node; }); mark(st.segs[st.i] && st.segs[st.i].node); }
    });
    window.addEventListener('pagehide', halt);
  }
  function disable() { on = false; stop(); }

  LMD.speak = { enable, disable, settings, start, stop, pause, resume, toggle, segments, sentences, detect, state: () => ({ active: st.active, paused: st.paused, lang: st.lang, i: st.i, total: st.segs.length, voice: st.voice ? st.voice.name : '' }) };
})();
