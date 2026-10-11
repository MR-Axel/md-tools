// Los archivos de código y, entre ellos, el HTML. Se pide al abrir el primero (ver LAZY_APP en content.js).
//  - Leer: el bloque único del archivo gana números de línea y un botón para ajustar o no las líneas largas. El color
//    llega después y de a tramos, así un archivo de medio mega se ve enseguida y no traba nada.
//  - Editar: el mismo cuadro de código fuente de siempre (ui.rawEdit, con su guardado, su Ctrl+S y su deshacer), vestido
//    con números de línea y con el resaltado por detrás. Tab sangra y Enter conserva la sangría.
//  - Un HTML suma un índice (el título, los h1 a h6 y las secciones con id, que llevan a su línea) y una vista previa.
//
// La vista previa dibuja un archivo que puede ser de cualquiera. Lo que la contiene, de afuera hacia adentro:
//  1. Va en un <iframe sandbox> sin allow-same-origin: su origen es opaco. No lee el almacenamiento de la app, ni la
//     sesión de la nube, ni las notas, y no le habla a la extensión. Sin allow-top-navigation, allow-popups,
//     allow-forms, allow-modals ni allow-downloads: no mueve la pestaña, no abre otra, no envía formularios.
//  2. Sin scripts de fábrica: el marco no lleva allow-scripts y el HTML entra por srcdoc. Correrlos lo decide la
//     persona, por archivo y hasta cerrar la pestaña (runOk vive en memoria, nunca se guarda). Ahí el marco carga
//     htmlrun.html, que recibe el HTML por mensaje y sigue con el origen opaco.
//  3. Sin red: el documento lleva adelante de todo una política (policy) con default-src 'none'. Solo valen los estilos
//     en línea y lo que viaja adentro como data:. Si el HTML trae su propia política, las dos se suman: la de acá no
//     se puede aflojar desde el archivo. Las imágenes, estilos y scripts de su carpeta los lee la app y los mete
//     adentro como data: o como texto; nada que apunte fuera de la carpeta abierta se resuelve (resolveRel).
//     Estática, no sale nada de nada (tests/htmlview.mjs cuenta pedidos, conexiones y paquetes). Con scripts, la
//     página sigue sin poder pedir ni recibir nada, pero el navegador tiene caminos que una política no cierra: un
//     script puede abrir una conexión (un <link rel=preconnect>, un marco que intenta navegar) o mandar paquetes de
//     WebRTC a un servidor que elija. Con eso puede avisar que la abrieron y sacar lo que ella misma sabe; de la app
//     no sabe nada. Por eso correr scripts es una decisión de la persona, y el cartel lo dice.
//  4. Los enlaces no navegan: quedan apuntando a una página en blanco, en una pestaña nueva que el marco no puede
//     abrir, y los marcos de adentro quedan sin dirección. Lo que se reescribe del HTML (enlaces, marcos, <base>,
//     <meta refresh>) no es lo que protege a la app: eso lo hacen el marco y la política, que valen aunque a la
//     reescritura se le escape algo. Sirve para que ni siquiera se abra una conexión: ante un marco o un enlace
//     que apunta a otro sitio, el navegador empieza a conectarse antes de consultar la política.
(function () {
  'use strict';
  const CHUNK = 100; // líneas por tramo: lo que queda fuera de la pantalla no se mide ni se pinta
  const LONG = 3000; // una línea más larga (un CSS o un JS en un solo renglón) queda sin color
  const HL_MAX = 600000; // caracteres: un archivo más grande se lee sin color
  const ED_HL_MAX = 120000; const ED_HL_NOW = 30000; // editando: hasta dónde hay color, y hasta dónde se pinta en cada tecla
  const OUT_MAX = 1500; // entradas del índice
  const ONE_MAX = 5 * 1048576; const ALL_MAX = 24 * 1048576; const RES_MAX = 400; const CSS_DEPTH = 3; // lo que la vista previa trae de la carpeta

  // ================= Lo que no toca la página (se prueba con node) =================
  // El HTML que devuelve highlight.js, partido por líneas: una marca que queda abierta al final de una se cierra ahí y
  // se vuelve a abrir en la siguiente. De esa librería salen solo texto escapado y <span class="…">.
  function splitLines(html) {
    const out = []; const open = []; const re = /<span class="[^"]*">|<\/span>|\n/g;
    let from = 0; let head = ''; let m;
    while ((m = re.exec(html))) {
      const t = m[0];
      if (t === '\n') { out.push(head + html.slice(from, m.index) + '</span>'.repeat(open.length)); from = re.lastIndex; head = open.join(''); }
      else if (t.charCodeAt(1) === 47) open.pop();
      else open.push(t);
    }
    out.push(head + html.slice(from) + '</span>'.repeat(open.length));
    return out;
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === '#') { const n = /^#x/i.test(k) ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m; }
    const v = ENT[k.toLowerCase()]; return v == null ? m : v;
  });
  const idOf = (attrs) => { const m = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || ''); return m ? decode(m[1] || m[2] || m[3] || '').trim() : ''; };

  // La estructura de un HTML, leída del texto sin interpretarlo: el <title>, los h1 a h6 y las secciones con id, cada
  // uno con su línea. Lo de adentro de un comentario, un <script> o un <style> no cuenta. El nivel sale del anidado:
  // un título dentro de una sección con id cuelga de ella.
  function outlineOf(text) {
    const items = []; let title = ''; let titleLine = 0; let more = false;
    let line = 1; let at = 0;
    const lineAt = (i) => { let k = text.indexOf('\n', at); while (k !== -1 && k < i) { line++; k = text.indexOf('\n', k + 1); } at = i; return line; };
    const stack = [{ tag: '', listed: false, base: 0 }]; let depth = 0;
    const re = /<!--[\s\S]*?-->|<(script|style|textarea|title|xmp)\b[^>]*>|<(\/?)(h[1-6]|section|article|main|nav|header|footer|aside)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        // Texto crudo hasta su cierre: nada de adentro es una etiqueta.
        const name = m[1].toLowerCase(); const close = new RegExp('</' + name + '\\s*>', 'gi'); close.lastIndex = re.lastIndex;
        const c = close.exec(text); const end = c ? c.index : text.length;
        if (name === 'title' && !title) { title = decode(text.slice(re.lastIndex, Math.min(end, re.lastIndex + 400))).replace(/\s+/g, ' ').trim(); titleLine = lineAt(m.index); }
        re.lastIndex = c ? close.lastIndex : text.length;
        continue;
      }
      if (!m[3]) continue;
      const tag = m[3].toLowerCase();
      if (tag[0] === 'h' && tag.length === 2) {
        if (m[2]) continue;
        const n = +tag[1]; const top = stack[stack.length - 1];
        if (!top.base || n < top.base) top.base = n;
        const close = /<\/h[1-6]\s*>/gi; close.lastIndex = re.lastIndex; const c = close.exec(text);
        const inner = text.slice(re.lastIndex, Math.min(c ? c.index : text.length, re.lastIndex + 600));
        const label = decode(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() || idOf(m[4]);
        if (label) items.push({ level: depth + 1 + (n - top.base), text: label, line: lineAt(m.index), h: n });
      } else if (m[2]) {
        let k = stack.length - 1; while (k > 0 && stack[k].tag !== tag) k--;
        if (k > 0) while (stack.length > k) { if (stack.pop().listed) depth--; }
      } else {
        const id = idOf(m[4]);
        if (id) items.push({ level: depth + 1, text: '#' + id, line: lineAt(m.index), sec: tag });
        stack.push({ tag, listed: !!id, base: 0 }); if (id) depth++;
      }
      if (items.length >= OUT_MAX) { more = true; break; }
    }
    return { title, titleLine, items, more };
  }

  // Una dirección escrita en el HTML o en su CSS, como archivo de la carpeta abierta: la dirección virtual, o '' si no
  // es de ahí. base es el archivo que la nombra y rootBase la raíz abierta (las dos, direcciones virtuales de la app).
  // Fuera queda todo lo que tiene esquema (https:, data:, javascript:), lo que nombra otro servidor (//host), un ancla
  // suelta y cualquier camino que, resuelto, caiga fuera de la raíz: con ".." no se sube más allá de la carpeta abierta.
  // Lo que empieza con "/" se toma desde esa raíz, como en un sitio.
  function resolveRel(rel, base, rootBase) {
    const v = String(rel == null ? '' : rel).trim();
    if (!v || !rootBase || v[0] === '#' || /^[a-z][a-z0-9+.\-]*:/i.test(v) || /^[\/\\]{2}/.test(v)) return '';
    let u;
    try { u = /^[\/\\]/.test(v) ? new URL(rootBase + v.replace(/^[\/\\]+/, '')) : new URL(v, base); } catch (e) { return ''; }
    u.search = ''; u.hash = '';
    const href = u.href;
    if (href.length <= rootBase.length || href.slice(0, rootBase.length) !== rootBase) return '';
    let parts;
    try { parts = href.slice(rootBase.length).split('/').map(decodeURIComponent); } catch (e) { return ''; }
    return parts.some((p) => !p || p === '.' || p === '..' || /[\/\\\u0000]/.test(p)) ? '' : href;
  }

  // La política del documento de la vista previa. Nada sale a la red: ni imágenes, ni tipografías, ni estilos, ni
  // fetch, ni marcos, ni formularios. Con scripts habilitados cambia una sola cosa: los que están escritos en la página.
  const policy = (scripts) => "default-src 'none'; " + (scripts ? "script-src 'unsafe-inline'; " : '') + "style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', vtt: 'text/vtt' };
  const mimeOf = (url) => MIME[(/\.([A-Za-z0-9]+)$/.exec(String(url).split(/[?#]/)[0]) || [0, ''])[1].toLowerCase()] || 'application/octet-stream';

  // Cuánto sangra Tab en este texto: con tabulaciones si el archivo las usa, si no con dos o cuatro espacios.
  const unitOf = (text) => (/^\t/m.test(text) ? '\t' : /^ {4}\S/m.test(text) && !/^ {2}\S/m.test(text) ? '    ' : '  ');
  // Sangra o saca la sangría de las líneas que toca la selección. Devuelve qué tramo cambiar y dónde queda la selección.
  function indentBlock(text, s, e, back) {
    const unit = unitOf(text);
    if (s === e && !back) return { from: s, to: s, text: unit, s: s + unit.length, e: s + unit.length };
    const a = text.lastIndexOf('\n', s - 1) + 1;
    let b = text.indexOf('\n', e > s && text[e - 1] === '\n' ? e - 1 : e); if (b === -1) b = text.length;
    const lines = text.slice(a, b).split('\n'); const cut = new RegExp('^(?:\\t| {1,' + (unit === '\t' ? 4 : unit.length) + '})');
    const next = lines.map((ln) => (back ? ln.replace(cut, '') : ln ? unit + ln : ln));
    const out = next.join('\n'); if (out === text.slice(a, b)) return null;
    const d0 = next[0].length - lines[0].length; const d = out.length - (b - a);
    const ns = Math.max(a, s + d0);
    return { from: a, to: b, text: out, s: ns, e: s === e ? ns : Math.max(ns, e + d) };
  }

  const pure = { splitLines, outlineOf, resolveRel, policy, mimeOf, indentBlock, decode };
  if (typeof LMD === 'undefined' || !LMD.kit) { if (typeof module !== 'undefined') module.exports = pure; return; }

  // ================= En la app =================
  const T = LMD.t; const { el, ICON, esc, debounce } = LMD.kit;
  let core = null; const ui = {};
  let mode = 'code'; // code | prev | split: lo último que eligió la persona, mientras dure la pestaña
  let wrap = null; // null: lo que dicen los Ajustes
  // Los archivos a los que la persona les permitió correr sus scripts. Vive en memoria: no pasa a otro archivo, ni a
  // otra pestaña, ni a la próxima vez.
  const runOk = new Set();
  const OWN = location.protocol === 'chrome-extension:';
  const RUN_URL = new URL('htmlrun.html', location.href).href.split(/[?#]/)[0];
  const wideQ = window.matchMedia('(min-width: 1100px)');

  const isCode = () => !!core && core.docKind === 'code';
  const isHtml = () => isCode() && /\.html?$/i.test(core.docName || '');
  // La vista previa es de la app. Sobre un archivo abierto directo (el lector inyectado en una página) no hay.
  const canPreview = () => isHtml() && !!core.APP;
  // En la página de la extensión su política no deja correr scripts escritos en la página, ni siquiera en un marco
  // aislado: ahí la vista previa es solo estática.
  const canRun = () => canPreview() && !OWN;
  const eff = () => (!canPreview() ? 'code' : mode === 'split' && !wideQ.matches ? 'code' : mode);
  const wrapOn = () => (wrap == null ? !!core.settings.wrapCode : wrap);
  const text = () => { const ta = core.ui.rawEdit; return (ta && !ta.hidden ? ta.value : String(core.raw)).replace(/\r\n?/g, '\n'); };
  const fmt = (n) => { try { return n.toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR'); } catch (e) { return String(n); } };
  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 700 }) : setTimeout(fn, 60));
  const docLang = () => { const c = core.ui.article.querySelector('.lmd-code > pre > code'); return c ? (/language-([\w+#-]+)/.exec(c.className) || [])[1] || '' : ''; };

  // ---------- Leer ----------
  let hl = null; // el último resaltado: { text, lang, per }
  function paint() {
    const art = core.ui.article; if (!isCode() || art.hidden) return;
    const code = art.querySelector(':scope > .lmd-code > pre > code');
    if (!code || code.classList.contains('lmd-cv') || art.querySelectorAll('.lmd-code').length !== 1) return;
    const src = code.textContent; const lines = src.split('\n'); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const frag = document.createDocumentFragment(); let chunk = null; const rows = [];
    for (let i = 0; i < lines.length; i++) {
      if (i % CHUNK === 0) { chunk = document.createElement('span'); chunk.className = 'lmd-cv-c'; chunk.style.containIntrinsicBlockSize = 'auto ' + (Math.min(CHUNK, lines.length - i) * 1.5) + 'em'; frag.appendChild(chunk); }
      const row = document.createElement('span'); row.className = 'lmd-cv-l'; row.setAttribute('data-n', i + 1); row.textContent = lines[i] + '\n';
      chunk.appendChild(row); rows.push(row);
    }
    code.textContent = ''; code.appendChild(frag); code.classList.add('lmd-cv');
    code.style.setProperty('--cv-g', String(lines.length).length + 'ch');
    ui.info.textContent = T(lines.length === 1 ? '1 línea' : '{n} líneas', { n: fmt(lines.length) });
    color(code, src, lines, rows);
  }
  // El color, después de que el texto ya está a la vista: se calcula una vez por texto y se reparte de a poco.
  function color(code, src, lines, rows) {
    const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1];
    if (!lang || !core.settings.plugins.highlight || src.length > HL_MAX) return;
    core.ensure('hljs').then((ok) => {
      if (!ok || !window.hljs || !code.isConnected || !window.hljs.getLanguage(lang)) return;
      const spread = (per) => {
        let i = 0; // rows es una lista fija: una colección viva se recorrería entera de nuevo tras cada cambio
        const step = () => {
          if (!code.isConnected) return;
          const until = performance.now() + 7;
          while (i < rows.length && performance.now() < until) {
            for (let k = 0; k < 40 && i < rows.length; k++, i++) {
              const h = per[i]; const r = rows[i];
              // Una línea con una marca de la búsqueda adentro queda como está.
              if (h && lines[i].length <= LONG && h.indexOf('<span') !== -1 && !r.firstElementChild) r.innerHTML = h + '\n';
            }
          }
          if (i < rows.length) setTimeout(step, 12);
        };
        step();
      };
      if (hl && hl.lang === lang && hl.text === src) { spread(hl.per); return; }
      idle(() => {
        if (!code.isConnected) return;
        let per; try { per = splitLines(window.hljs.highlight(src, { language: lang, ignoreIllegals: true }).value); } catch (e) { return; }
        hl = { text: src, lang, per }; spread(per);
      });
    });
  }

  // ---------- El índice de un HTML ----------
  let out = null;
  function outline() {
    if (!isHtml()) return;
    const src = text(); if (!out || out.text !== src) out = { text: src, data: outlineOf(src), lines: src.split('\n').length - (/\n$/.test(src) ? 1 : 0) };
    const d = out.data; const pane = core.ui.paneOutline; pane.textContent = '';
    const head = el('div', { class: 'lmd-o-head' });
    const title = el('button', { type: 'button', class: 'lmd-o-title lmd-cv-o', text: d.title || core.docName, title: d.title || core.docName });
    title.dataset.cvLine = d.titleLine || 1;
    const secs = d.items.length;
    head.append(title, el('div', { class: 'lmd-o-meta', text: T(out.lines === 1 ? '1 línea' : '{n} líneas', { n: fmt(out.lines) }) + (secs ? ' · ' + T(secs === 1 ? '{n} sección' : '{n} secciones', { n: fmt(secs) }) : '') }));
    pane.appendChild(head);
    if (!secs) { pane.appendChild(el('p', { class: 'lmd-empty', text: T('Este HTML no tiene títulos ni secciones con id.') })); return; }
    const tree = el('div', { class: 'lmd-o-tree' }); const stack = [{ level: 0, kids: tree }];
    d.items.forEach((it, i) => {
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
      const next = d.items[i + 1]; const item = el('div', { class: 'lmd-o-item' });
      const row = el('div', { class: 'lmd-o-row lmd-o-l' + Math.min(stack.length, 4) });
      const link = el('button', { type: 'button', class: 'lmd-o-link lmd-cv-o' + (it.sec ? ' lmd-cv-o-sec' : ''), text: it.text, title: (it.sec ? '<' + it.sec + '> ' : '') + T('Línea {n}', { n: it.line }) });
      link.dataset.cvLine = it.line;
      row.append(el('span', { class: 'lmd-o-dot' }), link); item.appendChild(row);
      const kids = el('div', { class: 'lmd-o-kids' }); if (next && next.level > it.level) item.appendChild(kids);
      stack[stack.length - 1].kids.appendChild(item); stack.push({ level: it.level, kids });
    });
    pane.appendChild(tree);
    if (d.more) pane.appendChild(el('p', { class: 'lmd-empty', text: T('Se muestran las primeras {n} entradas.', { n: fmt(OUT_MAX) }) }));
  }
  function goLine(n) {
    const ta = core.ui.rawEdit;
    if (eff() === 'prev') setMode('code');
    if (!ta.hidden) {
      const v = ta.value; let off = 0;
      for (let i = 1; i < n; i++) { const k = v.indexOf('\n', off); if (k === -1) break; off = k + 1; }
      try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
      ta.setSelectionRange(off, off);
      ta.scrollTop = Math.max(0, (n - 1) * (parseFloat(getComputedStyle(ta).lineHeight) || 21) - ta.clientHeight / 3);
      return;
    }
    if (core.ui.article.hidden) { const pre = core.ui.rawPre; const total = Math.max(1, out ? out.lines : 1); window.scrollTo(0, pre.getBoundingClientRect().top + window.scrollY + pre.offsetHeight * (n - 1) / total - 120); return; }
    paint();
    const row = core.ui.article.getElementsByClassName('lmd-cv-l')[n - 1]; if (!row) return;
    row.scrollIntoView({ block: 'center' }); row.classList.add('lmd-cv-hit'); setTimeout(() => row.classList.remove('lmd-cv-hit'), 1600);
  }

  // ---------- Editar ----------
  let dressed = false; let gutN = 0; let hlTimer = null; let escaped = false;
  const tooLong = (v) => { let a = 0; for (;;) { const k = v.indexOf('\n', a); if ((k === -1 ? v.length : k) - a > LONG) return true; if (k === -1) return false; a = k + 1; } };
  function place() {
    const ta = core.ui.rawEdit;
    ui.gut.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
    ui.backCode.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
  }
  function edSync(typed) {
    const ta = core.ui.rawEdit; const v = ta.value;
    let n = 1; for (let i = v.indexOf('\n'); i !== -1; i = v.indexOf('\n', i + 1)) n++;
    if (n > gutN) { let h = ''; for (let i = gutN + 1; i <= n; i++) h += '<i>' + i + '</i>'; ui.gut.insertAdjacentHTML('beforeend', h); }
    else for (let i = gutN; i > n; i--) ui.gut.lastChild.remove();
    gutN = n;
    // El color por detrás del texto. Si no se puede (sin la librería, un archivo grande, una línea larguísima), el
    // cuadro muestra su propio texto, sin color.
    const lang = docLang(); const off = () => { clearTimeout(hlTimer); ui.ed.classList.remove('lmd-cv-hl'); };
    const fits = !!lang && core.settings.plugins.highlight && v.length <= ED_HL_MAX && !tooLong(v);
    if (!fits) off();
    else if (!window.hljs) { off(); core.ensure('hljs').then((ok) => { if (ok && dressed && window.hljs) edSync(); }); }
    else if (!window.hljs.getLanguage(lang)) off();
    else {
      const run = () => {
        if (!dressed || ta.value !== v) return;
        try { ui.backCode.innerHTML = window.hljs.highlight(v, { language: lang, ignoreIllegals: true }).value + '\n'; ui.ed.classList.add('lmd-cv-hl'); place(); } catch (e) { off(); }
      };
      if (v.length <= ED_HL_NOW) { clearTimeout(hlTimer); run(); } else { if (typed) off(); clearTimeout(hlTimer); hlTimer = setTimeout(run, 180); }
    }
    place();
  }
  function dress() {
    const ta = core.ui.rawEdit; const on = isCode() && !ta.hidden;
    if (on !== dressed) {
      dressed = on; ui.ed.classList.toggle('lmd-cv-ed-on', on);
      if (on) ta.setAttribute('wrap', 'off');
      else { ta.removeAttribute('wrap'); clearTimeout(hlTimer); ui.ed.classList.remove('lmd-cv-hl'); ui.gut.textContent = ''; ui.backCode.textContent = ''; gutN = 0; }
    }
    if (on) edSync();
  }
  // Escribe en el cuadro por el camino que el navegador sabe deshacer.
  function write(ta, from, to, piece, s, e) {
    ta.focus(); ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = piece ? document.execCommand('insertText', false, piece) : from === to || document.execCommand('delete'); } catch (err) { ok = false; }
    if (!ok) { ta.setRangeText(piece, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (s != null) ta.setSelectionRange(s, e);
  }
  function onKey(e) {
    if (!dressed || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const ta = e.target;
    if (e.key === 'Tab') {
      // Escape y después Tab sale del cuadro: con el teclado solo no se queda nadie encerrado.
      if (escaped) { escaped = false; return; }
      e.preventDefault();
      const r = indentBlock(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (r) write(ta, r.from, r.to, r.text, r.s, r.e);
      return;
    }
    escaped = e.key === 'Escape';
    if (e.key === 'Enter' && !e.shiftKey) {
      const v = ta.value; const s = ta.selectionStart; const a = v.lastIndexOf('\n', s - 1) + 1;
      const ind = (/^[ \t]*/.exec(v.slice(a, s)) || [''])[0];
      if (!ind) return;
      e.preventDefault(); write(ta, s, ta.selectionEnd, '\n' + ind);
    }
  }
  // Lo que sigue a lo escrito sin apuro: el índice y la vista previa.
  const later = debounce(() => { if (!core || !isCode()) return; outline(); if (!ui.prev.hidden) preview(); }, 600);

  // ---------- Vista previa ----------
  let frame = null; let prevKey = ''; let prevSeq = 0; let onReady = null; let readyTimer = null; let noteKey = '';
  let cache = new Map(); let cacheFor = ''; let used = 0; let files = 0;
  const dataUri = (file, type) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(new Blob([file], { type })); });
  // Un archivo de la carpeta, como texto o como data:. Cada uno se lee una vez por documento, hasta "Actualizar".
  function load(url, asText) {
    const k = (asText ? 't:' : 'd:') + url; if (cache.has(k)) return cache.get(k);
    const p = (async () => {
      if (files >= RES_MAX) return null; files++;
      const f = await core.res(url); if (!f || f.size > ONE_MAX || used + f.size > ALL_MAX) return null;
      used += f.size;
      return asText ? await f.text() : await dataUri(f, mimeOf(url));
    })().catch(() => null);
    cache.set(k, p); return p;
  }
  // Reemplaza cada coincidencia por lo que devuelva fn, que puede tardar; con null queda como estaba.
  async function swap(str, re, fn) {
    const parts = []; const jobs = []; let last = 0; let m; re.lastIndex = 0;
    while ((m = re.exec(str))) {
      parts.push(str.slice(last, m.index)); const i = parts.length; parts.push(m[0]); last = re.lastIndex;
      jobs.push(Promise.resolve(fn(m)).then((v) => { if (v != null) parts[i] = v; }));
      if (!m[0]) re.lastIndex++;
    }
    parts.push(str.slice(last)); await Promise.all(jobs); return parts.join('');
  }
  // Un CSS con sus url() y sus @import de la carpeta ya adentro. Lo que apunta a otro lado queda escrito y no carga.
  async function cssIn(css, base, root, depth) {
    if (!root || (css.indexOf('url(') === -1 && css.indexOf('@import') === -1)) return css;
    const withImports = await swap(css, /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^'")\s;]+))\s*\)?([^;]*);/gi, async (m) => {
      const u = depth < CSS_DEPTH ? resolveRel(m[1] || m[2] || m[3], base, root) : ''; const t = u ? await load(u, true) : null;
      if (t == null) return null;
      const inner = await cssIn(t, u, root, depth + 1); const media = m[4].trim();
      return media ? '@media ' + media + ' {' + inner + '}' : inner;
    });
    return swap(withImports, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/gi, async (m) => {
      const u = resolveRel(m[1] || m[2] || m[3], base, root); const d = u ? await load(u, false) : null;
      return d ? 'url("' + d + '")' : null;
    });
  }
  // El HTML del archivo, listo para el marco: la política adelante de todo, lo de su carpeta ya adentro y los
  // enlaces sin destino.
  async function prepare(src, run) {
    const doc = new DOMParser().parseFromString(src, 'text/html'); // un documento inerte: no corre ni pide nada
    const here = core.HERE; const root = core.appRoot && core.appRoot.kind === 'dir' ? (/^https:\/\/[^\/]+\/[^\/]+\//.exec(here) || [''])[0] : '';
    if (cacheFor !== here) { cacheFor = here; cache = new Map(); used = 0; files = 0; }
    const all = (sel) => Array.from(doc.querySelectorAll(sel)); const jobs = [];
    const rel = (v) => (root ? resolveRel(v, here, root) : '');
    const safeCss = (t) => t.replace(/<\/style/gi, '<\\/style');
    all('base').forEach((n) => n.remove());
    all('meta[http-equiv]').forEach((n) => { if (/^\s*refresh\s*$/i.test(n.getAttribute('http-equiv'))) n.remove(); });
    // Una hoja de estilos de la carpeta pasa a ser un <style>. Cualquier otro <link> se va, con o sin scripts: los
    // preconnect, dns-prefetch, prefetch, preload y modulepreload abren conexiones sin pedir nada, y un ícono o una
    // hoja de otro servidor no cargarían igual.
    all('link').forEach((n) => {
      const u = /(^|\s)stylesheet(\s|$)/i.test(n.getAttribute('rel') || '') ? rel(n.getAttribute('href')) : '';
      if (!u) { n.remove(); return; }
      jobs.push(load(u, true).then(async (t) => {
        if (t == null) { n.remove(); return; }
        const st = doc.createElement('style'); const media = n.getAttribute('media'); if (media) st.setAttribute('media', media);
        st.textContent = safeCss(await cssIn(t, u, root, 1)); n.replaceWith(st);
      }));
    });
    all('style').forEach((n) => { const t = n.textContent; jobs.push(cssIn(t, here, root, 0).then((v) => { if (v !== t) n.textContent = safeCss(v); })); });
    all('[style]').forEach((n) => { const t = n.getAttribute('style'); if (t.indexOf('url(') !== -1) jobs.push(cssIn(t, here, root, 0).then((v) => { if (v !== t) n.setAttribute('style', v); })); });
    const attr = (sel, name) => all(sel).forEach((n) => { const u = rel(n.getAttribute(name)); if (u) jobs.push(load(u, false).then((d) => { if (d) n.setAttribute(name, d); })); });
    attr('img[src], source[src], video[src], audio[src], track[src], input[src]', 'src'); attr('video[poster]', 'poster');
    all('image, feImage').forEach((n) => ['href', 'xlink:href'].forEach((name) => { const u = n.hasAttribute(name) ? rel(n.getAttribute(name)) : ''; if (u) jobs.push(load(u, false).then((d) => { if (d) n.setAttribute(name, d); })); }));
    all('img[srcset], source[srcset]').forEach((n) => {
      const list = n.getAttribute('srcset').split(/,\s+|,$/).map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.search(/\s/); return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i)]; });
      jobs.push(Promise.all(list.map((c) => { const u = rel(c[0]); return u ? load(u, false) : null; })).then((got) => { n.setAttribute('srcset', list.map((c, i) => (got[i] || c[0]) + c[1]).join(', ')); }));
    });
    // Un marco, un <object> o un <embed> no cargan nada acá adentro (la política no deja). Se les saca la dirección
    // igual: el navegador empieza a conectarse con el sitio de un marco antes de preguntarle a la política. Y un
    // marco con su contenido escrito (srcdoc) podría traer otro marco adentro: tampoco va.
    all('iframe, frame, embed').forEach((n) => { n.removeAttribute('src'); n.removeAttribute('srcdoc'); }); all('object[data]').forEach((n) => n.removeAttribute('data'));
    // Los scripts de la carpeta entran como texto, y solo si la persona habilitó correrlos.
    if (run) all('script[src]').forEach((n) => { const u = rel(n.getAttribute('src')); if (u) jobs.push(load(u, true).then((t) => { if (t == null) return; n.removeAttribute('src'); n.textContent = t.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'); })); });
    // Los enlaces no llevan a ningún lado: quedan con su aspecto, apuntando a una página en blanco que el marco no
    // puede abrir. Así el navegador tampoco se adelanta a conectarse con el sitio al que iban cuando se les hace
    // clic. Con scripts, los que se mueven dentro de la página (#ancla, javascript:) siguen andando.
    all('a, area').forEach((n) => {
      const name = n.hasAttribute('href') ? 'href' : n.hasAttribute('xlink:href') ? 'xlink:href' : ''; if (!name) return;
      const h = (n.getAttribute(name) || '').trim();
      if (run && (h[0] === '#' || /^javascript:/i.test(h))) { n.setAttribute('target', '_self'); return; }
      if (!n.hasAttribute('title') && h && h[0] !== '#' && !/^javascript:/i.test(h)) n.setAttribute('title', h.slice(0, 300));
      n.setAttribute(name, 'about:blank'); n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer');
    });
    await Promise.all(jobs);
    const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.documentElement.firstChild);
    const base = doc.createElement('base'); base.setAttribute('target', '_blank');
    const meta = doc.createElement('meta'); meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', policy(run));
    head.insertBefore(base, head.firstChild); head.insertBefore(meta, head.firstChild);
    return (doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '') + doc.documentElement.outerHTML;
  }
  function dropFrame() {
    if (onReady) { window.removeEventListener('message', onReady); onReady = null; }
    clearTimeout(readyTimer);
    if (frame) { frame.remove(); frame = null; }
  }
  function mount(html, run) {
    dropFrame();
    const f = document.createElement('iframe'); f.className = 'lmd-cv-frame';
    // El aislamiento va puesto antes que el contenido, y el contenido de adentro no lo puede cambiar.
    f.setAttribute('sandbox', run ? 'allow-scripts' : ''); f.setAttribute('referrerpolicy', 'no-referrer'); f.setAttribute('title', T('Vista previa'));
    if (run) {
      const here = core.HERE;
      // htmlrun.html avisa que está listo y recién ahí recibe el HTML. Del marco no se lee nada más que ese aviso.
      onReady = (e) => {
        if (e.source !== f.contentWindow || e.data !== 'lmd-run-ready') return;
        window.removeEventListener('message', onReady); onReady = null; clearTimeout(readyTimer);
        f.contentWindow.postMessage({ lmdRun: html }, '*'); // el origen del marco es opaco: no hay otro destino que nombrar
      };
      window.addEventListener('message', onReady);
      readyTimer = setTimeout(() => { if (frame !== f) return; runOk.delete(here); core.flash(T('No se pudieron correr los scripts. Queda la vista estática.'), 'warn'); preview(true); }, 6000);
      f.src = RUN_URL;
    } else f.srcdoc = html;
    ui.stage.appendChild(f); frame = f;
  }
  function note(src, run) {
    const has = /<script\b|\son[a-z]+\s*=|javascript:/i.test(src);
    const folder = !!(core.appRoot && core.appRoot.kind === 'dir');
    const key = [run, has, folder, OWN].join();
    if (key === noteKey && ui.note.firstChild) return;
    noteKey = key; ui.note.textContent = '';
    const say = (t, cls) => ui.note.appendChild(el('span', { class: cls || '', text: t }));
    if (run) {
      say(T('Los scripts de esta página están corriendo, aislados de tus notas y de tu cuenta.'));
      ui.note.appendChild(el('button', { type: 'button', class: 'lmd-cv-btn', 'data-cv': 'stop', text: T('Detener los scripts') }));
    } else {
      say(T(has ? 'Vista estática: los scripts no corren y nada se pide a internet.' : 'Vista estática: nada se pide a internet.'));
      if (has && !OWN) {
        ui.note.appendChild(el('button', { type: 'button', class: 'lmd-cv-btn', 'data-cv': 'run', text: T('Ejecutar los scripts de esta página') }));
        say(T('Corren aislados de tus notas y tu cuenta, pero una página ajena podría avisar afuera que la abriste.'), 'lmd-cv-fine');
      } else if (has) say(T('En la extensión no se pueden correr. Para probarlos, abrí el archivo en sharpmd.app.'), 'lmd-cv-fine');
    }
    if (!folder) say(T('Para ver sus imágenes y estilos, abrí la carpeta del archivo.'), 'lmd-cv-fine');
  }
  function preview(force) {
    const src = text(); const run = canRun() && runOk.has(core.HERE);
    note(src, run);
    const key = core.HERE + '\n' + (run ? 1 : 0) + '\n' + src;
    if (!force && key === prevKey && frame && frame.isConnected) return;
    prevKey = key; const seq = ++prevSeq;
    prepare(src, run).then((html) => { if (seq === prevSeq && !ui.prev.hidden && canPreview()) mount(html, run); }, () => { /* queda lo que había */ });
  }

  // ---------- La barra y los modos ----------
  function setMode(m) { mode = m; sync(); }
  function sync() {
    if (!core) return;
    const code = isCode(); const html = canPreview(); const m = eff(); const main = core.ui.main;
    ui.bar.hidden = !code; main.classList.toggle('lmd-cv-on', code);
    ['code', 'prev', 'split'].forEach((k) => main.classList.toggle('lmd-cv-m-' + k, code && m === k));
    main.classList.toggle('lmd-cv-nowrap', code && !wrapOn());
    ui.seg.hidden = !html;
    ui.seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.cv === m; b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on)); });
    ui.wrap.setAttribute('aria-pressed', String(wrapOn())); ui.wrap.classList.toggle('lmd-on', wrapOn());
    ui.prev.hidden = !(html && m !== 'code'); ui.reload.hidden = ui.prev.hidden;
    if (!code) { dress(); dropFrame(); prevKey = ''; return; }
    dress(); paint(); outline();
    if (ui.prev.hidden) { dropFrame(); prevKey = ''; } else preview();
  }
  function build() {
    const seg = [['code', 'Código'], ['prev', 'Vista previa'], ['split', 'Lado a lado']].map((b) => '<button type="button" role="radio" aria-checked="false" data-cv="' + b[0] + '">' + esc(T(b[1])) + '</button>').join('');
    ui.bar = el('div', { class: 'lmd-cv-bar', hidden: '' },
      '<div class="lmd-cv-seg" role="radiogroup" aria-label="' + esc(T('Vista')) + '">' + seg + '</div><span class="lmd-cv-info"></span>' +
      '<button type="button" class="lmd-cv-btn" data-cv="wrap" aria-pressed="false">' + esc(T('Ajustar líneas')) + '</button>' +
      '<button type="button" class="lmd-icon-btn lmd-cv-reload" data-cv="reload" title="' + esc(T('Actualizar la vista previa')) + '" aria-label="' + esc(T('Actualizar la vista previa')) + '" hidden>' + ICON.reload + '</button>');
    ui.prev = el('div', { class: 'lmd-cv-prev', hidden: '' }, '<div class="lmd-cv-note" role="note"></div><div class="lmd-cv-stage"></div>');
    ui.seg = ui.bar.querySelector('.lmd-cv-seg'); ui.info = ui.bar.querySelector('.lmd-cv-info'); ui.wrap = ui.bar.querySelector('[data-cv=wrap]'); ui.reload = ui.bar.querySelector('[data-cv=reload]');
    ui.note = ui.prev.querySelector('.lmd-cv-note'); ui.stage = ui.prev.querySelector('.lmd-cv-stage');
    core.ui.article.before(ui.bar, ui.prev);
    // El cuadro de código fuente de la app, dentro de un marco que le pone los números y el color. Apagado, el marco
    // no cuenta para la página (display: contents) y el cuadro queda como siempre.
    const ta = core.ui.rawEdit;
    ui.ed = el('div', { class: 'lmd-cv-ed' }); ui.gut = el('div', { class: 'lmd-ed-gutter', 'aria-hidden': 'true' });
    ui.back = el('pre', { class: 'lmd-cv-back', 'aria-hidden': 'true' }, '<code class="hljs"></code>'); ui.backCode = ui.back.firstChild;
    ui.pane = el('div', { class: 'lmd-cv-pane' });
    ta.before(ui.ed); ui.ed.append(ui.gut, ui.pane); ui.pane.append(ui.back, ta);
    ta.addEventListener('keydown', onKey); ta.addEventListener('scroll', () => { if (dressed) place(); });
    ta.addEventListener('input', () => { if (dressed) { edSync(true); later(); } });
    const act = (e) => {
      const b = e.target.closest('[data-cv]'); if (!b) return;
      const a = b.dataset.cv;
      if (a === 'code' || a === 'prev' || a === 'split') setMode(a);
      else if (a === 'wrap') { wrap = !wrapOn(); sync(); }
      else if (a === 'reload') { cacheFor = ''; preview(true); }
      else if (a === 'run' && canRun()) { runOk.add(core.HERE); preview(true); }
      else if (a === 'stop') { runOk.delete(core.HERE); preview(true); }
    };
    ui.bar.addEventListener('click', act); ui.prev.addEventListener('click', act);
    core.ui.paneOutline.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cv-line]'); if (!b || !isCode()) return;
      if (LMD.touch.small()) core.drawer(false);
      goLine(+b.dataset.cvLine);
    });
    if (wideQ.addEventListener) wideQ.addEventListener('change', sync);
  }
  function init(c) {
    if (core) return;
    core = c; build();
    core.hooks.render.push(sync); core.hooks.patch.push(sync); core.hooks.view.push(sync); core.hooks.doc.push(sync);
    sync();
  }

  LMD.codeview = { init, pure, peek: () => ({ mode: eff(), run: !!core && runOk.has(core.HERE), dressed, frame: !!frame }) };
})();
