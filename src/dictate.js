// Herramienta: dictado. Escribe en el bloque en edición lo que se dice, con órdenes habladas para puntuar, dar
// estructura y armar fórmulas y diagramas (la gramática está en voice.js).
// El micrófono solo se prende con un gesto (el botón o el atajo), se ve mientras escucha y se corta solo al cambiar
// de nota, al salir de la pestaña y tras un silencio largo. SharpMD no recibe ni guarda audio: lo transcribe el
// navegador, en el dispositivo si puede y, si no, con su proveedor (se avisa antes de la primera vez).
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc, debounce } = LMD.kit;
  const ICON = LMD.tools.ICON;
  const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let core = null; let on = false; let wired = false;

  // Lo aceptado sobre el audio se guarda aparte de los ajustes: { consent: cuándo, skip: { idioma: true } }.
  const STORE = 'dictation';
  const stored = () => new Promise((resolve) => { try { chrome.storage.local.get(STORE, (r) => resolve((r && r[STORE]) || {})); } catch (e) { resolve({}); } });
  const store = (value) => new Promise((resolve) => { const o = {}; o[STORE] = value; try { chrome.storage.local.set(o, resolve); } catch (e) { resolve(); } });

  const cfg = { silence: 30000 }; // sin oír nada durante este tiempo, se corta
  const ses = { rec: null, active: false, starting: false, closing: false, audio: false, local: false, short: 'en', tag: 'en-US', mode: 'text', chunks: [], ghost: null, fmt: null, glue: false, snaps: [], timer: null, starts: [], note: '', seq: 0 };
  let mic = null; let bar = null;

  // ---------- Idioma ----------
  const shortLang = () => { const pref = LMD.tools.opt('dictateLang', 'auto'); return pref === 'es' || pref === 'en' ? pref : (LMD.lang() === 'es' ? 'es' : 'en'); };
  const tagOf = (short) => (navigator.languages || [navigator.language || '']).find((l) => String(l).toLowerCase().startsWith(short + '-')) || (short === 'es' ? 'es-ES' : 'en-US');
  const commands = () => LMD.tools.opt('dictateCommands', true) !== false;

  // ---------- En el dispositivo o con el proveedor del navegador ----------
  // 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown' (el navegador no lo informa).
  async function localState(tag) {
    const S = SR();
    if (!S || typeof S.available !== 'function') return 'unknown';
    try { return await S.available({ langs: [tag], processLocally: true }); } catch (e) { return 'unavailable'; }
  }
  async function install(tag) {
    const S = SR();
    if (!S || typeof S.install !== 'function') return false;
    core.flash(T('Descargando el reconocimiento de voz…'));
    try { return !!(await S.install({ langs: [tag], processLocally: true })); } catch (e) { return false; }
  }
  // Antes de prender el micrófono: 'local', 'cloud' o nada si la persona no aceptó.
  async function clearance(tag) {
    const saved = await stored(); const state = await localState(tag);
    if (state === 'available') return 'local';
    if ((state === 'downloadable' || state === 'downloading') && !(saved.skip && saved.skip[tag])) {
      const yes = await LMD.dialog.confirm({ title: T('Dictar sin enviar audio'), text: T('El navegador puede descargar el reconocimiento de voz de este idioma. Con eso el audio no sale del dispositivo.'), ok: T('Descargar'), cancel: T('Ahora no') });
      if (yes) { if (await install(tag)) return 'local'; core.flash(T('No se pudo descargar. Se puede probar de nuevo desde Ajustes.'), 'warn'); }
      else { saved.skip = Object.assign({}, saved.skip); saved.skip[tag] = true; await store(saved); }
    }
    if (!saved.consent) {
      const ok = await LMD.dialog.confirm({ title: T('Dictado'), text: T('Para transcribir, el navegador puede enviar el audio a su proveedor. SharpMD no recibe ni guarda audio.'), ok: T('Aceptar y dictar') });
      if (!ok) return null;
      saved.consent = Date.now(); await store(saved);
    }
    return 'cloud';
  }

  // ---------- El bloque donde se escribe ----------
  const article = () => core.ui.article;
  const clean = (s) => s.replace(/\u200b/g, '');
  const caretEnd = (node) => { node.focus(); const sel = getSelection(); sel.selectAllChildren(node); sel.collapseToEnd(); };
  const blocks = () => Array.from(article().children).filter((n) => !n.classList.contains('lmd-add'));
  const active = () => { const a = document.activeElement; const n = a && a.isContentEditable && article().contains(a) ? a.closest('.lmd-editable') : null; return n && !n.classList.contains('lmd-pending') ? n : null; };
  // El bloque con el cursor; si el foco se fue, el último que se tocó; si no hay, uno nuevo al final.
  function target() {
    let d = active();
    if (d) { const sel = getSelection(); if (!sel.rangeCount || !d.contains(sel.anchorNode)) caretEnd(d); return d; }
    if (!core.editMode || core.readOnly || !core.blocks) return null;
    d = core.lastBlock;
    if (d && d.isConnected && d.isContentEditable && !d.classList.contains('lmd-pending')) { caretEnd(d); return d; }
    const all = blocks();
    return LMD.write.open(all[all.length - 1] || null, 'p');
  }
  const before = (d) => { const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(d); if (sel.rangeCount && d.contains(sel.anchorNode)) r.setEnd(sel.anchorNode, sel.anchorOffset); return clean(r.toString()); };
  const changed = (d) => d.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  function insert(text) {
    if (!text) return;
    // Si el navegador no lo escribe con su orden de edición, se lo pone a mano. Se mira el texto: lo que devuelve la orden no alcanza.
    const host = active(); const was = host ? host.textContent : '';
    try { document.execCommand('insertText', false, text); } catch (e) { /* sin esa orden */ }
    if (host && host.textContent !== was) return;
    const sel = getSelection(); if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0); r.deleteContents(); const n = document.createTextNode(text); r.insertNode(n); sel.collapse(n, text.length);
    const d = active(); if (d) changed(d);
  }
  // Pasa al Markdown lo escrito en el bloque, sin sacarle el foco.
  function sync() {
    const d = active(); if (!d) return;
    if (d.classList.contains('lmd-draft')) LMD.write.sync(d);
    else if (core.commitBlock(d)) d._typed = true;
  }

  // ---------- Lo provisorio ----------
  // Lo que el navegador va entendiendo se ve en el lugar, atenuado, y no se guarda: lo reemplaza el resultado final.
  function unghost() { if (ses.ghost) { ses.ghost.remove(); ses.ghost = null; } }
  function ghost(text) {
    if (!text) { unghost(); return; }
    const d = active(); if (!d) return;
    if (!ses.ghost || !ses.ghost.isConnected) {
      const sel = getSelection(); if (!sel.rangeCount || !d.contains(sel.anchorNode)) return;
      ses.ghost = el('span', { class: 'lmd-anchor lmd-voice-ghost', contenteditable: 'false', 'aria-hidden': 'true' });
      const r = sel.getRangeAt(0).cloneRange(); r.collapse(false); r.insertNode(ses.ghost);
      sel.collapse(ses.ghost.parentNode, Array.prototype.indexOf.call(ses.ghost.parentNode.childNodes, ses.ghost));
    }
    ses.ghost.textContent = ' ' + text;
  }

  // ---------- Órdenes de texto ----------
  function type(piece, kind) {
    const d = target(); if (!d) return;
    insert(LMD.voice.join(before(d), piece, kind, ses.glue));
    ses.glue = kind === 'open';
  }
  const TAGS = { bold: 'strong', italic: 'em', code: 'code' };
  function closeFmt() {
    const f = ses.fmt; ses.fmt = null;
    if (!f || !f.isConnected) return;
    const d = f.closest('.lmd-editable');
    if (!clean(f.textContent).trim()) { f.remove(); if (d) changed(d); return; }
    // El carácter invisible que sostenía el cursor no queda dentro del código.
    if (f.tagName === 'CODE') f.textContent = clean(f.textContent);
    const after = document.createTextNode('\u200b'); f.after(after);
    if (d && d === active()) getSelection().collapse(after, 1);
    if (d) changed(d);
  }
  function fmt(kind, start) {
    if (!start) { closeFmt(); ses.glue = false; return; }
    closeFmt();
    const d = target(); if (!d) return;
    const b = before(d); if (b && !/\s$/.test(b) && !ses.glue) insert(' ');
    const sel = getSelection(); if (!sel.rangeCount) return;
    const f = document.createElement(TAGS[kind]); const hold = document.createTextNode('\u200b'); f.appendChild(hold);
    const r = sel.getRangeAt(0); r.collapse(false); r.insertNode(f);
    sel.collapse(hold, 1);
    ses.fmt = f; ses.glue = true;
  }
  function newline() {
    closeFmt(); ses.glue = false;
    const d = target(); if (!d || d.classList.contains('lmd-cell')) return;
    LMD.write.enter(d);
  }
  const isTask = (d) => { const li = d.closest('li'); return !!li && li.classList.contains('lmd-task-item'); };
  // Un bloque nuevo de ese tipo. Dentro de una lista del mismo tipo es el ítem siguiente.
  function block(kind, done) {
    closeFmt(); ses.glue = false;
    let d = target(); if (!d || d.classList.contains('lmd-cell')) return;
    if (!d.classList.contains('lmd-draft')) { sync(); d = LMD.write.open(LMD.write.top(d), 'p'); }
    else if (clean(d.textContent).trim()) { LMD.write.enter(d); d = active(); }
    // Quedó un ítem vacío: sirve si es del tipo pedido; si no, se sale de la lista.
    if (d && d._li && !((kind === 'task' && isTask(d)) || (kind === 'ul' && !isTask(d)))) { LMD.write.enter(d); d = active(); }
    if (!d || !d.classList.contains('lmd-draft')) return;
    if (!d._li) LMD.write.kind(d, kind);
    if (done) { d.dataset.done = '1'; const box = d.parentNode.querySelector(':scope > input.lmd-task'); if (box) box.checked = true; } else delete d.dataset.done;
  }

  // Vuelve el cursor a donde estaba tras redibujar la nota: el bloque de esa posición, o el anterior.
  function refocus(at) {
    const all = blocks();
    for (let k = Math.min(at, all.length - 1); k >= 0; k--) {
      const list = all[k].matches('.lmd-editable') ? [all[k]] : Array.from(all[k].querySelectorAll('.lmd-editable'));
      if (list.length) { caretEnd(list[list.length - 1]); return; }
    }
    LMD.write.open(all[all.length - 1] || null, 'p');
  }
  const where = () => { const d = active(); const top = d && LMD.write.top(d); return top ? Math.max(0, blocks().indexOf(top)) : blocks().length; };
  // "borrar eso": la nota vuelve a como estaba antes de lo último que se dictó.
  function scratch() {
    closeFmt(); unghost();
    const at = where(); sync();
    const snap = ses.snaps.pop();
    if (snap == null) { core.flash(T('No hay nada dictado para borrar.'), 'warn'); return; }
    const d = active(); if (d && d.classList.contains('lmd-draft')) LMD.write.discard(d);
    if (snap !== core.raw) core.setRaw(snap); else core.render();
    refocus(at); ses.glue = false;
  }
  function undo() {
    closeFmt(); unghost();
    const at = where(); sync();
    const d = active(); if (d && d.classList.contains('lmd-draft') && !clean(d.textContent).trim()) LMD.write.discard(d);
    if (!core.undo()) core.flash(T('No hay más cambios para deshacer'), 'warn');
    ses.snaps.pop(); refocus(at); ses.glue = false;
  }
  function snapshot() { sync(); ses.snaps.push(core.raw); if (ses.snaps.length > 60) ses.snaps.shift(); }

  // ---------- Fórmula y diagrama ----------
  const BACK = { es: ['deshacer', 'borrar eso', 'borra eso'], en: ['undo', 'scratch that', 'delete that'] };
  const said = (extra) => ses.chunks.concat(extra ? [extra] : []).join(ses.mode === 'diagram' ? '\n' : ' ');
  function enterMode(mode) { closeFmt(); unghost(); ses.mode = mode; ses.chunks = []; paintBar(); preview(''); }
  let drawSeq = 0;
  async function draw(res) {
    const pane = bar && bar.querySelector('.lmd-dct-pane'); if (!pane) return;
    const mine = ++drawSeq; const view = pane.querySelector('.lmd-dct-view'); const code = pane.querySelector('code');
    const src = ses.mode === 'formula' ? res.latex : (res.nodes ? res.mermaid : '');
    code.textContent = src;
    pane.classList.toggle('lmd-dct-empty', !src);
    if (!src) { view.textContent = T(ses.mode === 'formula' ? 'Decí la fórmula. Para cerrar: fin fórmula.' : 'Decí los pasos. Para cerrar: fin diagrama.'); return; }
    try {
      if (ses.mode === 'formula') {
        if (!(await core.ensure('katex')) || !window.katex || mine !== drawSeq) return;
        const holder = el('div'); window.katex.render(src, holder, { displayMode: true, throwOnError: false });
        view.textContent = ''; view.appendChild(holder);
      } else {
        if (!(await core.ensure('mermaid')) || !window.mermaid || mine !== drawSeq) return;
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: core.isDark() ? 'dark' : 'default', flowchart: { curve: core.shape === 'square' ? 'linear' : 'basis' } });
        const out = await window.mermaid.render('lmd-dct-dgm-' + mine, src);
        if (mine !== drawSeq) return;
        view.innerHTML = out.svg; view.scrollTop = view.scrollHeight;
      }
    } catch (e) { /* queda el código a la vista */ }
  }
  const preview = (interim) => { if (ses.mode !== 'text') draw(LMD.voice.parse(said(interim), ses.mode, ses.short)); };

  // Dónde va lo armado: en línea si el cursor está en medio de un texto; si no, como bloque propio.
  function place(body, inlineTex) {
    let d = target(); let after = null;
    if (inlineTex && d && clean(d.textContent).trim() && !d.classList.contains('lmd-cell')) {
      const b = before(d); if (b && !/\s$/.test(b)) insert(' ');
      const sel = getSelection(); const span = el('span', { class: 'lmd-math', 'data-tex': inlineTex, contenteditable: 'false' });
      const r = sel.getRangeAt(0); r.collapse(false); r.insertNode(span);
      const hold = document.createTextNode('\u200b'); span.after(hold); sel.collapse(hold, 1);
      span.textContent = inlineTex;
      core.ensure('katex').then((ok) => { if (!ok || !window.katex || !span.isConnected) return; try { window.katex.render(inlineTex, span, { displayMode: false, throwOnError: true }); } catch (e) { /* queda el código */ } });
      changed(d); ses.glue = false;
      return;
    }
    if (d && d.classList.contains('lmd-cell')) { insert(inlineTex ? '$' + inlineTex + '$' : ''); return; }
    if (d && d.classList.contains('lmd-draft')) {
      if (clean(d.textContent).trim()) { const made = LMD.write.settle(d); after = made ? LMD.write.top(made) : null; }
      else { after = d._li ? LMD.write.top(d) : d._anchor; LMD.write.discard(d); }
    } else if (d) { sync(); after = LMD.write.top(d); }
    else { const all = blocks(); after = all[all.length - 1] || null; }
    LMD.write.put(after && after.isConnected ? after : null, body, (top) => { LMD.write.open(top, 'p'); });
    ses.glue = false;
  }
  function finishMode(res) {
    const mode = ses.mode; ses.mode = 'text'; ses.chunks = []; drawSeq++;
    paintBar();
    if (mode === 'formula' && res.latex) place(['$$', res.latex, '$$'], res.latex);
    else if (mode === 'diagram' && res.nodes) place(['```mermaid'].concat(res.mermaid.split('\n'), '```'), '');
  }
  function feedMode(text) {
    if (BACK[ses.short].includes(LMD.voice.fold(text.trim()).replace(/[.,!?]+$/, ''))) { ses.chunks.pop(); preview(''); return; }
    ses.chunks.push(text);
    const res = LMD.voice.parse(said(''), ses.mode, ses.short);
    if (!res.done) { draw(res); return; }
    snapshot(); finishMode(res);
    if (res.stop) stop(); else if (res.rest) feed(res.rest);
  }

  // ---------- Lo que llega del reconocedor ----------
  function run(ops) {
    for (const o of ops) {
      if (o.op === 'text') type(o.text, 'text');
      else if (o.op === 'punct') type(o.text, o.open ? 'open' : 'punct');
      else if (o.op === 'fmt') fmt(o.kind, o.on);
      else if (o.op === 'break' || o.op === 'next') newline();
      else if (o.op === 'block') block(o.kind, o.done);
      else if (o.op === 'scratch') scratch();
      else if (o.op === 'undo') undo();
      else if (o.op === 'stop') { stop(); return; }
      else if (o.op === 'mode') { enterMode(o.mode); if (o.rest) feedMode(o.rest); return; }
    }
  }
  // Un resultado definitivo: se interpreta y se escribe.
  function feed(text) {
    text = String(text || '').trim(); if (!text) return;
    unghost();
    if (ses.mode !== 'text') { feedMode(text); return; }
    if (!target()) return;
    if (!commands()) { snapshot(); type(text, 'text'); return; }
    const d = active();
    const res = LMD.voice.parse(text, 'text', ses.short, { list: !!(d && d.closest('li')) || !!(d && /^(ul|task)$/.test(d.dataset.kind || '')) });
    if (!res.ops.some((o) => o.op === 'scratch' || o.op === 'undo')) snapshot();
    run(res.ops);
  }
  function interim(text) {
    if (bar) bar.querySelector('.lmd-dct-said').textContent = text;
    if (ses.mode === 'text') ghost(text); else preview(text);
  }

  // ---------- El micrófono ----------
  function quiet() {
    clearTimeout(ses.timer);
    ses.timer = setTimeout(() => { if (ses.active) { stop(); core.flash(T('El dictado se cortó por silencio.')); } }, cfg.silence);
  }
  const ERRORS = {
    'not-allowed': 'El navegador no dio permiso para usar el micrófono.', 'service-not-allowed': 'El navegador no dio permiso para usar el micrófono.',
    'audio-capture': 'No se encontró un micrófono.', network: 'El reconocimiento de voz necesita conexión.', 'language-not-supported': 'Este idioma no está disponible para dictar.',
  };
  function listen() {
    const S = SR(); const rec = new S();
    rec.lang = ses.tag; rec.continuous = true; rec.interimResults = true;
    if (ses.local) { try { rec.processLocally = true; } catch (e) { /* el navegador no lo deja fijar */ } }
    rec.onstart = () => { if (rec !== ses.rec) return; ses.starting = false; ses.active = true; showBar(); paintMic(); quiet(); };
    rec.onaudiostart = () => { if (rec === ses.rec) ses.audio = true; };
    rec.onresult = (e) => {
      if (rec !== ses.rec) return;
      quiet();
      let soft = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const text = r[0] ? r[0].transcript : '';
        if (r.isFinal) { soft = ''; try { feed(text); } catch (err) { /* una frase que falla no corta el dictado */ } if (rec !== ses.rec) return; }
        else soft += text;
      }
      interim(soft.trim());
    };
    rec.onerror = (e) => { if (rec !== ses.rec) return; ses.error = e.error; if (ERRORS[e.error]) core.flash(T(ERRORS[e.error]), 'warn'); };
    rec.onend = () => {
      if (rec !== ses.rec) return;
      const fatal = ses.error && ses.error !== 'no-speech' && ses.error !== 'aborted'; ses.error = '';
      // El navegador corta solo cada tanto: mientras siga el dictado, se vuelve a escuchar.
      const now = Date.now(); ses.starts = ses.starts.filter((t) => now - t < 10000);
      if (ses.active && !ses.closing && !fatal && ses.starts.length < 6) { ses.starts.push(now); try { listen(); return; } catch (err) { /* no se pudo retomar */ } }
      finish();
    };
    ses.rec = rec;
    rec.start();
  }
  // Se pide con un gesto: el botón del micrófono o el atajo.
  async function begin() {
    if (!on || ses.starting) return false;
    if (ses.active) { stop(); return false; }
    if (!SR()) { core.flash(T('Este navegador no reconoce voz. Funciona en Chrome, Edge y Safari.'), 'warn'); return false; }
    if (core.noDoc || !core.blocks) return false;
    if (core.readOnly) { core.flash(T('Esta nota es de solo lectura'), 'warn'); return false; }
    ses.starting = true; paintMic();
    try {
      if (!core.editMode) await core.setEditMode(true);
      if (!core.editMode || !target()) { ses.starting = false; paintMic(); return false; }
      ses.short = shortLang(); ses.tag = tagOf(ses.short);
      const how = await clearance(ses.tag);
      if (!how || !on) { ses.starting = false; paintMic(); return false; }
      ses.local = how === 'local'; ses.mode = 'text'; ses.chunks = []; ses.snaps = []; ses.glue = false; ses.fmt = null; ses.closing = false; ses.audio = false; ses.error = ''; ses.starts = []; ses.note = core.HERE;
      target();
      listen();
      return true;
    } catch (e) { ses.starting = false; ses.rec = null; paintMic(); core.flash(T('No se pudo prender el micrófono.'), 'warn'); return false; }
  }
  function finish() {
    clearTimeout(ses.timer); clearTimeout(ses.force);
    unghost(); closeFmt();
    const was = ses.active || ses.starting;
    ses.active = false; ses.starting = false; ses.closing = false; ses.audio = false; ses.rec = null; ses.mode = 'text'; ses.chunks = [];
    if (bar) { bar.remove(); bar = null; }
    paintMic();
    if (was) sync();
  }
  // Corta. Lo que estaba a medio armar (una fórmula, un diagrama) se escribe como quedó.
  function stop() {
    if (!ses.rec) { finish(); return; }
    if (ses.closing) return;
    ses.closing = true; unghost();
    if (ses.mode !== 'text') { const res = LMD.voice.parse(said(''), ses.mode, ses.short); if (res.latex || res.nodes) snapshot(); finishMode(res); }
    const rec = ses.rec;
    try { rec.stop(); } catch (e) { /* ya estaba cortado */ }
    // Si el navegador no avisa que cortó, se corta igual.
    ses.force = setTimeout(() => { if (ses.rec === rec) { try { rec.abort(); } catch (e) { /* ya no está */ } finish(); } }, 1200);
  }

  // ---------- Lo que se ve ----------
  const MODES = { text: 'Escuchando', formula: 'Fórmula', diagram: 'Diagrama' };
  function paintBar() {
    if (!bar) return;
    bar.dataset.mode = ses.mode;
    bar.querySelector('.lmd-dct-label').textContent = T(MODES[ses.mode]);
    bar.querySelector('.lmd-dct-where').textContent = T(ses.local ? 'En este dispositivo' : '');
    const pane = bar.querySelector('.lmd-dct-pane'); pane.hidden = ses.mode === 'text';
  }
  function showBar() {
    if (bar) bar.remove();
    bar = el('div', { class: 'lmd-dct-bar', role: 'status', 'aria-live': 'polite' });
    bar.innerHTML =
      '<div class="lmd-dct-row"><span class="lmd-dct-dot" aria-hidden="true"></span><b class="lmd-dct-label"></b><small class="lmd-dct-where"></small><span class="lmd-dct-said"></span>' +
        '<button type="button" class="lmd-icon-btn" data-dct="help" title="' + esc(T('Frases que entiende')) + '" aria-label="' + esc(T('Frases que entiende')) + '">' + ICON.help + '</button>' +
        '<button type="button" class="lmd-btn lmd-dct-stop" data-dct="stop">' + ICON.stop + '<span>' + esc(T('Cortar')) + '</span></button></div>' +
      '<div class="lmd-dct-pane" hidden><div class="lmd-dct-view"></div><code></code></div>';
    document.body.appendChild(bar);
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // el cursor sigue en el bloque
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-dct]'); if (!b) return; if (b.dataset.dct === 'stop') stop(); else help(); });
    paintBar();
  }

  // El botón del micrófono: al lado del bloque con el cursor; con el dedo, pegado arriba del teclado.
  function paintMic() {
    if (!mic) return;
    const d = on && core.editMode && !core.readOnly ? active() : null;
    const show = !!d || ses.active || ses.starting;
    mic.hidden = !show || !on;
    mic.classList.toggle('lmd-on', ses.active); mic.classList.toggle('lmd-busy', ses.starting);
    mic.title = T(ses.active ? 'Cortar el dictado (Alt+Shift+D)' : 'Dictar (Alt+Shift+D)'); mic.setAttribute('aria-label', mic.title); mic.setAttribute('aria-pressed', String(ses.active));
    if (mic.hidden) return;
    const w = mic.offsetWidth || 34; const h = mic.offsetHeight || 34;
    if (LMD.touch.coarse()) {
      const v = LMD.touch.visible();
      mic.classList.add('lmd-docked');
      mic.style.left = Math.max(8, v.left + v.width - w - 10) + 'px';
      mic.style.top = Math.max(v.top + 58, v.bottom - 10 - LMD.touch.above() - h) + 'px';
      return;
    }
    mic.classList.remove('lmd-docked');
    if (!d) return;
    const box = (LMD.write.top(d) || d).getBoundingClientRect();
    mic.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, box.right + 8)) + 'px';
    mic.style.top = Math.max(58, Math.min(window.innerHeight - h - 40, box.top - 3)) + 'px';
  }

  // La hoja de ayuda: qué se puede decir, por idioma.
  function help(lang) {
    const old = document.querySelector('.lmd-dct-help'); if (old) old.remove();
    lang = lang || (ses.active ? ses.short : shortLang());
    const H = LMD.voice.HELP[lang]; const group = (title, rows) => '<h4>' + esc(T(title)) + '</h4><dl>' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>';
    const box = el('div', { class: 'lmd-ask lmd-dct-help' });
    box.innerHTML = '<div class="lmd-ask-card" role="dialog" aria-modal="true" aria-label="' + esc(T('Frases que entiende')) + '"><h3>' + esc(T('Frases que entiende')) + '</h3>' +
      '<div class="lmd-seg" role="radiogroup">' + [['es', 'Español'], ['en', 'English']].map((o) => '<button type="button" role="radio" data-help="' + o[0] + '" aria-checked="' + (o[0] === lang) + '"' + (o[0] === lang ? ' class="lmd-on"' : '') + '>' + o[1] + '</button>').join('') + '</div>' +
      '<div class="lmd-dct-sheet">' + group('Texto', H.text) + group('Fórmula', H.formula) + group('Diagrama', H.diagram) + '</div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-esc>' + esc(T('Cerrar')) + '</button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); box.remove(); } });
    box.addEventListener('mousedown', (e) => { if (e.target === box) box.remove(); });
    box.addEventListener('click', (e) => { if (e.target.closest('[data-esc]')) { box.remove(); return; } const b = e.target.closest('[data-help]'); if (b) help(b.dataset.help); });
    box.querySelector('[data-esc]').focus();
  }

  // ---------- Opciones en Ajustes > Herramientas ----------
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }
  async function settings(area, api) {
    const pref = LMD.tools.opt('dictateLang', 'auto'); const tag = tagOf(shortLang()); const state = await localState(tag);
    const WHERE = { available: 'El audio se transcribe en este dispositivo.', downloadable: 'El navegador puede enviar el audio a su proveedor para transcribirlo. SharpMD no recibe ni guarda audio.', downloading: 'El navegador está descargando el reconocimiento de voz.' };
    area.innerHTML =
      '<label class="lmd-row"><span>' + esc(T('Idioma del dictado')) + '</span><select data-dct="lang">' + [['auto', 'El de la app'], ['es', 'Español'], ['en', 'English']].map((o) => '<option value="' + o[0] + '"' + (o[0] === pref ? ' selected' : '') + '>' + esc(o[0] === 'auto' ? T(o[1]) : o[1]) + '</option>').join('') + '</select></label>' +
      '<label class="lmd-check"><input type="checkbox" data-dct="commands"' + (commands() ? ' checked' : '') + '><span>' + esc(T('Órdenes habladas. Sin esto, todo lo dicho entra como texto.')) + '</span></label>' +
      '<div class="lmd-row lmd-row-line"><span data-dct="where">' + esc(T(WHERE[state] || WHERE.downloadable)) + '</span>' + (state === 'downloadable' ? '<button type="button" class="lmd-btn" data-dct="install">' + esc(T('Descargar')) + '</button>' : '') + '</div>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('Atajo: Alt+Shift+D, o el micrófono al lado del bloque que estás escribiendo.')) + '</span><button type="button" class="lmd-btn" data-dct="help">' + esc(T('Frases que entiende')) + '</button></div>';
    area.querySelector('[data-dct=lang]').addEventListener('change', (e) => { Promise.resolve(keep({ dictateLang: e.target.value })).then(() => settings(area, api)); });
    area.querySelector('[data-dct=commands]').addEventListener('change', (e) => keep({ dictateCommands: e.target.checked }));
    area.querySelector('[data-dct=help]').addEventListener('click', () => help());
    const get = area.querySelector('[data-dct=install]');
    if (get) get.addEventListener('click', async () => {
      get.disabled = true;
      const ok = await install(tag);
      if (ok) { const saved = await stored(); if (saved.skip) { delete saved.skip[tag]; await store(saved); } }
      else core.flash(T('No se pudo descargar. Se puede probar de nuevo desde Ajustes.'), 'warn');
      if (area.isConnected) settings(area, api);
    });
  }

  // ---------- Encendido ----------
  function onKey(e) {
    if (!on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyD') return;
    if (document.querySelector('.lmd-ask, .lmd-dgm') || !core.ui.panel.hidden) return;
    e.preventDefault(); begin();
  }
  function enable(c) {
    core = c; on = true;
    if (!wired) {
      wired = true;
      mic = el('button', { type: 'button', class: 'lmd-dct-mic', hidden: '' }, ICON.mic);
      document.body.appendChild(mic);
      // El foco y el cursor se quedan en el bloque: el clic no se los lleva.
      mic.addEventListener('mousedown', (e) => e.preventDefault());
      mic.addEventListener('pointerdown', (e) => e.preventDefault());
      mic.addEventListener('click', () => begin());
      window.addEventListener('keydown', onKey);
      const later = debounce(paintMic, 40);
      article().addEventListener('focusin', later); article().addEventListener('focusout', later); article().addEventListener('input', later);
      window.addEventListener('scroll', later, { passive: true }); window.addEventListener('resize', later);
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', later); window.visualViewport.addEventListener('scroll', later); }
      core.hooks.render.push(() => { if (on && ses.active && !core.editMode) stop(); later(); });
      // Otra nota, otra pestaña u otra ventana: el micrófono no sigue prendido.
      core.hooks.doc.push(() => { if ((ses.active || ses.starting) && ses.note !== core.HERE) stop(); later(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && (ses.active || ses.rec)) stop(); });
      window.addEventListener('blur', () => { if (ses.active && ses.audio) stop(); });
      window.addEventListener('pagehide', () => { if (ses.rec) { try { ses.rec.abort(); } catch (e) { /* ya no está */ } } });
    }
    paintMic();
  }
  function disable() { on = false; if (ses.rec) stop(); finish(); if (mic) mic.hidden = true; }

  LMD.dictate = { enable, disable, settings, begin, stop, help, feed, cfg, state: () => ({ active: ses.active, starting: ses.starting, mode: ses.mode, lang: ses.tag, local: ses.local, chunks: ses.chunks.slice() }) };
})();
