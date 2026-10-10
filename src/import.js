// Herramienta: importar a Markdown. Un archivo de Word, Excel, PowerPoint, EPUB, PDF, HTML, CSV o TSV se convierte
// acá, en el navegador, y queda como una nota nueva sin guardar o al final de la nota abierta. Nada se sube.
//  - Word, Excel, PowerPoint y EPUB son un zip con XML adentro: se abren con un lector de zip propio, con topes
//    (cantidad de entradas, tamaño descomprimido, rutas raras), y el XML se lee con DOMParser.
//  - El HTML se analiza en un documento inerte (DOMParser) y de ahí sale Markdown: nunca se inserta en la página.
//  - El PDF usa pdf.js (vendor/pdfjs), que se pide recién al convertir el primer PDF. Solo texto, sin OCR.
// El trabajo va en tandas, con una pausa entre unidad y unidad: la ventana no se cuelga y Cancelar corta de verdad.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const ICON = '<svg viewBox="0 0 24 24"><path d="M6.500 3.500h8l4 4v13h-12z"/><path d="M14.500 3.500v4h4M12 10.500v6M9.500 14l2.500 2.500 2.500-2.500"/></svg>';
  let core = null; let on = false; let wired = false;

  // ---------- Topes ----------
  const MB = 1024 * 1024;
  const LIMITS = {
    file: 50 * MB, // el archivo elegido
    text: 20 * MB, // un HTML o un CSV, que se analizan de una vez
    entries: 5000, entry: 64 * MB, unzip: 256 * MB, // lo de adentro de un zip
    pages: 300, sheets: 50, slides: 500, chapters: 500, rows: 2000, cols: 50,
    dataImage: 300000, dataTotal: 2 * MB, // imágenes que ya vienen dentro del archivo
    out: 12 * MB, // el Markdown que sale
    pace: 0, // pausa extra entre unidades (la usan las pruebas)
  };
  const KINDS = { docx: 'docx', html: 'html', htm: 'html', xhtml: 'html', csv: 'csv', tsv: 'csv', xlsx: 'xlsx', pptx: 'pptx', epub: 'epub', pdf: 'pdf' };
  const ACCEPT = '.docx,.xlsx,.pptx,.epub,.pdf,.html,.htm,.csv,.tsv';
  const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || '')) || ['', ''])[1].toLowerCase();
  const takes = (name) => !!KINDS[extOf(name)];
  const fail = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

  function why(e) {
    const c = e && e.code;
    if (c === 'big') return T('El archivo pesa más de {a} MB.', { a: Math.round((e.max || LIMITS.file) / MB) });
    if (c === 'type') return T('Ese tipo de archivo no se puede convertir.');
    if (c === 'zip_big') return T('El archivo es demasiado grande al descomprimirlo.');
    if (c === 'pdf_empty') return T('Este PDF no tiene texto. Parece escaneado.');
    if (c === 'pdf_password') return T('El PDF pide contraseña.');
    if (c === 'pdf_lib') return T('No se pudo cargar el lector de PDF. Probá de nuevo.');
    if (c === 'empty') return T('El archivo no tiene texto para convertir.');
    if (c === 'no_inflate') return T('Este navegador no puede abrir ese archivo.');
    return T('El archivo está dañado o no es lo que dice su nombre.');
  }

  // Un trabajo: lo que se cuenta, los avisos y cómo cortarlo.
  function newJob(onProgress) {
    const job = { cancelled: false, warn: {}, cut: null, last: 0, unzipped: 0, embedded: 0, stop: [], abort: typeof AbortController === 'function' ? new AbortController() : null };
    job.note = (key, n) => { job.warn[key] = (job.warn[key] || 0) + (n == null ? 1 : n); };
    job.progress = (stage, done, total, unit) => { if (onProgress) onProgress({ stage, done, total, unit: !!unit }); };
    // Entre unidad y unidad: deja pintar a la ventana y mira si se canceló.
    job.breathe = async (always) => {
      if (job.cancelled) throw fail('cancel');
      const now = Date.now();
      if (LIMITS.pace) await new Promise((resolve) => setTimeout(resolve, LIMITS.pace));
      else if (always || now - job.last > 24) { await pause(); job.last = Date.now(); }
      if (job.cancelled) throw fail('cancel');
    };
    job.cancel = () => {
      if (job.cancelled) return; job.cancelled = true;
      if (job.abort) job.abort.abort();
      job.stop.forEach((fn) => { try { fn(); } catch (e) { /* ya terminó */ } });
    };
    return job;
  }

  // ---------- Texto y Markdown ----------
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const BR = '\u0001'; // un salto de línea dentro de un párrafo, hasta que se arma el bloque
  // Texto suelto: lo que Markdown leería como formato o como HTML se escapa.
  function mdText(s) {
    return String(s == null ? '' : s).replace(CTRL, '').replace(/[\\`*[\]<]/g, '\\$&').replace(/~~/g, '\\~\\~')
      .replace(/_/g, (m, i, all) => (/[A-Za-z0-9]/.test(all[i - 1] || '') && /[A-Za-z0-9]/.test(all[i + 1] || '') ? '_' : '\\_'))
      .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
  }
  // El principio de un renglón que Markdown tomaría por título, cita, lista o línea.
  function lead(s) {
    if (/^(#{1,6}|[+-]|>)(\s|$)/.test(s) || /^([-=_]\s*){3,}$/.test(s)) return '\\' + s;
    return s.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
  }
  const oneLine = (s) => String(s).split(BR).join(' ').replace(/\s+/g, ' ').trim();
  // Un párrafo ya armado. Dos saltos seguidos lo parten en dos.
  function paras(s) {
    return String(s).replace(/[ \t\n]+/g, ' ').replace(new RegExp(' ?' + BR + ' ?', 'g'), BR).split(new RegExp(BR + '{2,}'))
      .map((p) => p.replace(new RegExp('^[ ' + BR + ']+|[ ' + BR + ']+$', 'g'), '')).filter(Boolean)
      .map((p) => p.split(BR).map(lead).join('\\\n'));
  }
  // Pone la marca pegada al texto y deja afuera los espacios de las puntas.
  function wrap(s, mark) {
    const m = /^([\s\u0001]*)([\s\S]*?)([\s\u0001]*)$/.exec(s);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  }
  const longest = (text, ch) => { let best = 0; let run = 0; for (const c of text) { run = c === ch ? run + 1 : 0; if (run > best) best = run; } return best; };
  function codeSpan(text) {
    text = String(text).replace(CTRL, '').replace(/\s*\n\s*/g, ' ');
    if (!text.trim()) return '';
    const tick = '`'.repeat(longest(text, '`') + 1); const pad = /^`|`$|^ .* $/.test(text) ? ' ' : '';
    return tick + pad + text + pad + tick;
  }
  function fenced(text, lang) {
    text = String(text).replace(/\r\n?/g, '\n').replace(CTRL, '').replace(/^\n+|\s+$/g, '');
    const tick = '`'.repeat(Math.max(3, longest(text, '`') + 1));
    return tick + (lang || '') + '\n' + text + '\n' + tick;
  }
  const cell = (s) => oneLine(s).replace(/\|/g, '\\|');
  // rows: filas de celdas ya escapadas; la primera es el encabezado.
  function mdTable(rows, aligns) {
    const cols = Math.max.apply(null, rows.map((r) => r.length).concat(1));
    const line = (r) => '| ' + Array.from({ length: cols }, (x, i) => r[i] || ' ').join(' | ') + ' |';
    const rule = '| ' + Array.from({ length: cols }, (x, i) => ({ left: ':--', center: ':-:', right: '--:' }[(aligns || [])[i]] || '---')).join(' | ') + ' |';
    return [line(rows[0] || []), rule].concat(rows.slice(1).map(line)).join('\n');
  }
  // Una tabla con sus topes: lo que queda afuera se cuenta para avisarlo.
  function capTable(rows, job) {
    if (rows.length > LIMITS.rows + 1) { job.note('rows', rows.length - LIMITS.rows - 1); rows = rows.slice(0, LIMITS.rows + 1); }
    const cols = Math.max.apply(null, rows.map((r) => r.length).concat(0));
    if (cols > LIMITS.cols) { job.note('cols', cols - LIMITS.cols); rows = rows.map((r) => r.slice(0, LIMITS.cols)); }
    return rows;
  }

  // Bytes a texto: por su marca de orden si la trae; si no UTF-8, y si no lo es, el juego de Windows.
  function decodeText(bytes, label) {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (label && !/^utf-?8$/i.test(label)) { try { return new TextDecoder(label).decode(bytes); } catch (e) { /* un nombre que no existe: sigue */ } }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }

  // ---------- Direcciones ----------
  // Como las lee un navegador: sin espacios en las puntas ni caracteres de control en el medio.
  const cleanUrl = (raw) => String(raw == null ? '' : raw).trim().replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, '').replace(/ /g, '%20');
  const urlSafe = (u) => u.replace(/[()<>"\\`]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  // Un enlace: http, https, correo y teléfono, o relativo. Lo demás (javascript:, data:, file:) se descarta.
  function linkUrl(raw, job, o) {
    let u = cleanUrl(raw); if (!u) return '';
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
    if (m) { if (!/^(https?|mailto|tel)$/i.test(m[1])) { job.note('links'); return ''; } }
    else if (u.indexOf('//') === 0) u = 'https:' + u;
    else if (o && o.noRel) return '';
    return urlSafe(u);
  }
  // Una imagen: por su dirección. Las que vienen adentro (data:) pasan si son chicas y de un tipo de imagen común.
  function imageUrl(raw, job, o) {
    const u = cleanUrl(raw); if (!u) return '';
    if (/^data:/i.test(u)) {
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(u) || u.length > LIMITS.dataImage || job.embedded + u.length > LIMITS.dataTotal) { job.note('images'); return ''; }
      job.embedded += u.length; return u;
    }
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
    if (m ? !/^https?$/i.test(m[1]) : !!(o && o.noRel) && u.indexOf('//') !== 0) { job.note('images'); return ''; }
    return urlSafe(u.indexOf('//') === 0 ? 'https:' + u : u);
  }

  // ---------- HTML a Markdown ----------
  const tagOf = (n) => n.localName.toUpperCase();
  const DROP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|FRAME|FRAMESET|OBJECT|EMBED|APPLET|SVG|MATH|CANVAS|AUDIO|VIDEO|MAP|AREA|NAV|HEAD|TITLE|LINK|META|BASE|BUTTON|SELECT|TEXTAREA|DATALIST|DIALOG|PROGRESS|METER|SLOT|PORTAL)$/;
  const BLOCK = /^(P|DIV|UL|OL|DL|PRE|TABLE|BLOCKQUOTE|H[1-6]|HR|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|FIGURE|FIGCAPTION|DETAILS|SUMMARY|FORM|FIELDSET|ADDRESS|CENTER|LI|DT|DD|BODY|HTML|TBODY|THEAD|TFOOT|TR|TD|TH|CAPTION|HGROUP)$/;
  const INLINE = /^(A|ABBR|B|BDI|BDO|BIG|BR|CITE|CODE|DEL|DFN|EM|FONT|I|IMG|INPUT|INS|KBD|LABEL|MARK|Q|S|SAMP|SMALL|SPAN|STRIKE|STRONG|SUB|SUP|TIME|TT|U|VAR|WBR)$/;
  function dropped(n) {
    if (DROP.test(tagOf(n)) || n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return true;
    if (/^(navigation|search)$/i.test(n.getAttribute('role') || '')) return true;
    return /(^|;)\s*display\s*:\s*none/i.test(n.getAttribute('style') || '');
  }
  // Un elemento que no es de bloque pero trae bloques adentro (un enlace que envuelve un párrafo) se trata como caja.
  const isBlock = (n) => { const t = tagOf(n); return BLOCK.test(t) || (!INLINE.test(t) && Array.prototype.some.call(n.children, (c) => BLOCK.test(tagOf(c)))); };

  function htmlImage(n, job, o) {
    const raw = n.getAttribute('src') || n.getAttribute('data-src') || '';
    if (!raw.trim()) return '';
    const u = imageUrl(raw, job, o);
    return u ? '![' + mdText((n.getAttribute('alt') || '').replace(/\s+/g, ' ').trim()) + '](' + u + ')' : '';
  }
  function inlineKids(node, job, f, depth) { let s = ''; node.childNodes.forEach((k) => { s += inlineOf(k, job, f, depth + 1); }); return s; }
  // f: lo que ya está puesto por fuera (b, i, s, link) para no repetir la marca, y o con las opciones del archivo.
  function inlineOf(n, job, f, depth) {
    if (n.nodeType === 3) return mdText(n.nodeValue.replace(/[ \t\r\n\f]+/g, ' '));
    if (n.nodeType !== 1 || dropped(n)) return '';
    if (depth > 300) return mdText(n.textContent.replace(/\s+/g, ' '));
    const t = tagOf(n);
    if (t === 'BR') return BR;
    if (t === 'IMG') return htmlImage(n, job, f.o);
    if (t === 'INPUT') return '';
    if (t === 'CODE' || t === 'KBD' || t === 'SAMP' || t === 'TT') return codeSpan(n.textContent);
    if (t === 'A') {
      const href = f.link ? '' : linkUrl(n.getAttribute('href'), job, f.o);
      const inner = inlineKids(n, job, href ? Object.assign({}, f, { link: true }) : f, depth).split(BR).join(' ');
      return href && inner.trim() ? wrap(inner, '\u0002').replace('\u0002', '[').replace('\u0002', '](' + href + ')') : inner;
    }
    const style = n.getAttribute('style') || '';
    const weight = /font-weight\s*:\s*(bold|bolder|[6-9]00|normal|[1-4]00)/i.exec(style);
    const heavy = weight ? /bold|[6-9]00/i.test(weight[1]) : (t === 'B' || t === 'STRONG');
    const slant = /font-style\s*:\s*(italic|oblique)/i.test(style) || ((t === 'EM' || t === 'I' || t === 'CITE' || t === 'DFN' || t === 'VAR') && !/font-style\s*:\s*normal/i.test(style));
    const struck = t === 'S' || t === 'DEL' || t === 'STRIKE' || /text-decoration[^;]*line-through/i.test(style);
    const g = Object.assign({}, f); const marks = [];
    if (heavy && !f.b) { g.b = true; marks.push('**'); }
    if (slant && !f.i) { g.i = true; marks.push('*'); }
    if (struck && !f.s) { g.s = true; marks.push('~~'); }
    let s = inlineKids(n, job, g, depth);
    if (t === 'Q') s = wrap(s, '"');
    marks.forEach((m) => { s = wrap(s, m); });
    return s;
  }
  // El texto de un bloque de código, con sus saltos.
  function preText(n) {
    let s = '';
    n.childNodes.forEach((k) => {
      if (k.nodeType === 3) s += k.nodeValue;
      else if (k.nodeType === 1 && !/^(SCRIPT|STYLE|BUTTON)$/.test(tagOf(k))) {
        if (tagOf(k) === 'BR') s += '\n';
        else { s += preText(k); if (/^(DIV|P|LI|TR)$/.test(tagOf(k)) && !/\n$/.test(s)) s += '\n'; }
      }
    });
    return s;
  }
  // El lenguaje de un bloque de código: de sus clases (language-js, lang-js, highlight-source-js) o de data-lang.
  function langOf(pre) {
    for (const n of [pre.querySelector('code'), pre, pre.parentElement]) {
      if (!n || n.nodeType !== 1) continue;
      const m = /(?:^|\s)(?:language-|lang-|highlight-source-|highlight-text-|brush:\s*)([A-Za-z0-9_+#.-]+)/.exec(n.getAttribute('class') || '');
      const lang = n.getAttribute('data-lang') || n.getAttribute('data-language') || (m && m[1]) || '';
      if (/^[A-Za-z0-9_+#.-]{1,30}$/.test(lang) && !/^(none|plain|plaintext|text)$/i.test(lang)) return lang.toLowerCase();
    }
    return '';
  }
  function htmlList(n, job, f, depth) {
    const ordered = tagOf(n) === 'OL'; let num = parseInt(n.getAttribute('start'), 10); if (!isFinite(num)) num = 1;
    const items = [];
    Array.from(n.children).forEach((li) => {
      const t = tagOf(li);
      // Una lista suelta dentro de otra, sin su renglón: cuelga del anterior.
      if ((t === 'UL' || t === 'OL') && items.length) { const sub = htmlList(li, job, f, depth + 1); if (sub) items[items.length - 1] += '\n' + sub.split('\n').map((l) => (l ? '    ' + l : l)).join('\n'); return; }
      if (t !== 'LI' || dropped(li)) return;
      const box = li.querySelector('input[type=checkbox]'); const task = !!box && box.closest('li') === li;
      const marker = (ordered ? (num++) + '. ' : '- ');
      const pad = ' '.repeat(marker.length);
      const parts = htmlBlocks(li, job, f, depth + 1);
      let body = '';
      // Una lista que sigue al texto del renglón queda pegada; lo demás, con su línea en blanco.
      parts.forEach((b, i) => { body += (i ? (i === 1 && /^(- |\d+\. )/.test(b) ? '\n' : '\n\n') : '') + b; });
      body = body.split('\n').map((l, i) => (i && l ? pad + l : l)).join('\n');
      items.push(marker + (task ? '[' + (box.hasAttribute('checked') ? 'x' : ' ') + '] ' : '') + body);
    });
    return items.join(items.some((i) => /\n\n/.test(i)) ? '\n\n' : '\n');
  }
  function htmlTable(n, job, f, depth) {
    const rows = Array.from(n.rows || []);
    const out = [];
    if (n.caption) { const c = oneLine(inlineKids(n.caption, job, f, depth)); if (c) out.push(lead(c)); }
    if (!rows.length) return out;
    // Una tabla que arma la página (con otra tabla adentro, o de una sola columna) no es una tabla de datos.
    if (n.querySelector('table') || rows.every((r) => r.cells.length < 2)) {
      rows.forEach((r) => Array.from(r.cells).forEach((c) => { htmlBlocks(c, job, f, depth + 1).forEach((b) => out.push(b)); }));
      return out;
    }
    const aligns = [];
    let grid = rows.map((r, ri) => {
      const cells = [];
      Array.from(r.cells).forEach((c) => {
        if (!ri) aligns[cells.length] = ((/text-align\s*:\s*(left|center|right)/i.exec(c.getAttribute('style') || '') || [])[1] || c.getAttribute('align') || '').toLowerCase();
        cells.push(cell(htmlBlocks(c, job, f, depth + 1).join(' ').replace(/\\\n/g, ' ')));
        for (let k = 1; k < Math.min(c.colSpan || 1, LIMITS.cols); k++) cells.push('');
      });
      return cells;
    });
    grid = capTable(grid, job);
    out.push(mdTable(grid, aligns));
    return out;
  }
  // Los hijos de una caja, en grupos: lo suelto en línea se junta en párrafos entre bloque y bloque.
  function groupsOf(node) {
    const groups = []; let run = null;
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { if (!run) groups.push(run = { run: [] }); run.run.push(n); return; }
      if (n.nodeType !== 1 || dropped(n)) return;
      if (isBlock(n)) { run = null; groups.push({ block: n }); } else { if (!run) groups.push(run = { run: [] }); run.run.push(n); }
    });
    return groups;
  }
  function groupBlocks(g, job, f, depth) {
    if (g.block) return blockOf(g.block, job, f, depth);
    return paras(g.run.map((n) => inlineOf(n, job, f, depth)).join(''));
  }
  function htmlBlocks(node, job, f, depth) {
    const out = [];
    groupsOf(node).forEach((g) => { groupBlocks(g, job, f, depth).forEach((b) => out.push(b)); });
    return out;
  }
  function blockOf(n, job, f, depth) {
    if (depth > 300) { const t = mdText(n.textContent.replace(/\s+/g, ' ').trim()); return t ? [lead(t)] : []; }
    const t = tagOf(n);
    if (/^H[1-6]$/.test(t)) {
      const s = oneLine(inlineKids(n, job, Object.assign({}, f, { b: true }), depth));
      return s ? ['#'.repeat(Math.min(6, Number(t[1]) + ((f.o && f.o.shift) || 0))) + ' ' + s] : [];
    }
    if (t === 'P') return paras(inlineKids(n, job, f, depth));
    if (t === 'HR') return ['---'];
    if (t === 'PRE') { const text = preText(n); return text.trim() ? [fenced(text, langOf(n))] : []; }
    if (t === 'BLOCKQUOTE') { const inner = htmlBlocks(n, job, f, depth + 1).join('\n\n'); return inner ? [inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')] : []; }
    if (t === 'UL' || t === 'OL') { const l = htmlList(n, job, f, depth + 1); return l ? [l] : []; }
    if (t === 'TABLE') return htmlTable(n, job, f, depth + 1);
    if (t === 'DL') {
      const out = []; let cur = null;
      Array.from(n.children).forEach((d) => {
        const s = tagOf(d) === 'DT' ? oneLine(inlineKids(d, job, f, depth)) : oneLine(htmlBlocks(d, job, f, depth + 1).join(' '));
        if (!s) return;
        if (tagOf(d) === 'DT' || !cur) { cur = [lead(s)]; out.push(cur); } else cur.push(': ' + s);
      });
      return out.map((x) => x.join('\n'));
    }
    if (t === 'SUMMARY') { const s = oneLine(inlineKids(n, job, Object.assign({}, f, { b: true }), depth)); return s ? ['**' + s + '**'] : []; }
    if (t === 'FIGCAPTION') { const s = oneLine(inlineKids(n, job, Object.assign({}, f, { i: true }), depth)); return s ? ['*' + s + '*'] : []; }
    return htmlBlocks(n, job, f, depth + 1);
  }
  const joinBlocks = (blocks) => blocks.filter(Boolean).join('\n\n');
  // Un documento ya analizado. Sin espera: lo usan los capítulos de un EPUB.
  const htmlNow = (root, job, o) => joinBlocks(htmlBlocks(root, job, { o: o || {} }, 0));
  // El HTML de un archivo, de a tandas.
  async function htmlToMd(text, job, o) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    let root = doc.body || doc.documentElement; if (!root) return { md: '', title: '' };
    const mains = root.querySelectorAll('main, [role=main]'); if (mains.length === 1) root = mains[0];
    // Los envoltorios (una caja con una sola caja adentro) se bajan: así el avance cuenta bloques de verdad.
    for (let i = 0; i < 30; i++) {
      const g = groupsOf(root).filter((x) => x.block || x.run.some((n) => n.nodeType !== 3 || n.nodeValue.trim()));
      if (g.length === 1 && g[0].block && /^(DIV|SECTION|ARTICLE|MAIN|CENTER|FORM|BODY)$/.test(tagOf(g[0].block))) root = g[0].block; else break;
    }
    const groups = groupsOf(root); const out = []; const f = { o: o || {} };
    for (let i = 0; i < groups.length; i++) {
      job.progress('convert', i, groups.length); await job.breathe();
      groupBlocks(groups[i], job, f, 0).forEach((b) => out.push(b));
    }
    job.progress('convert', 1, 1);
    return { md: joinBlocks(out), title: (doc.title || '').replace(/\s+/g, ' ').trim() };
  }
  // El juego de caracteres que declara la página, si lo dice al principio.
  function htmlCharset(bytes) {
    let head = ''; const n = Math.min(bytes.length, 2048); for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(head);
    return m ? m[1] : '';
  }

  // ---------- CSV y TSV ----------
  // El separador: el que aparece la misma cantidad de veces en más renglones del principio.
  function separator(text, ext) {
    if (ext === 'tsv') return '\t';
    const lines = text.slice(0, 20000).split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
    let best = ','; let score = 0;
    [',', ';', '\t', '|'].forEach((sep) => {
      const counts = lines.map((l) => { let c = 0; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) c++; } return c; });
      const first = counts[0] || 0; if (!first) return;
      const s = counts.filter((c) => c === first).length * 1000 + first;
      if (s > score) { score = s; best = sep; }
    });
    return best;
  }
  async function csvToMd(text, ext, job) {
    const sep = separator(text, ext); const n = text.length;
    const rows = []; let row = []; let val = ''; let quoted = false; let wasQuoted = false; let total = 0;
    const keep = () => rows.length <= LIMITS.rows;
    const endCell = () => { row.push(wasQuoted ? val : val.trim()); val = ''; wasQuoted = false; };
    const endRow = () => { endCell(); if (row.length > 1 || row[0]) { total++; if (keep()) rows.push(row); } row = []; };
    for (let i = 0; i < n; i++) {
      if (!(i & 0xFFFF)) { job.progress('convert', i, n); await job.breathe(); }
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else quoted = false; } else val += ch;
      } else if (ch === '"' && !val.trim()) { quoted = true; wasQuoted = true; val = ''; }
      else if (ch === sep) endCell();
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
      else val += ch;
    }
    if (val || row.length) endRow();
    job.progress('convert', 1, 1);
    if (!rows.length) return { md: '', units: ['rows', 0] };
    if (total > rows.length) job.note('rows', total - rows.length);
    // Las columnas vacías del final (una coma de más en cada renglón) no cuentan.
    let cols = 0; rows.forEach((r) => { for (let i = r.length - 1; i >= cols; i--) { if (r[i]) { cols = i + 1; break; } } });
    let grid = rows.map((r) => r.slice(0, Math.max(cols, 1)).map((v) => cell(mdText(v))));
    if (cols > LIMITS.cols) { job.note('cols', cols - LIMITS.cols); grid = grid.map((r) => r.slice(0, LIMITS.cols)); }
    return { md: mdTable(grid), units: ['rows', rows.length - 1] };
  }

  // ---------- Zip ----------
  async function inflate(comp, cap, job) {
    if (typeof DecompressionStream !== 'function') throw fail('no_inflate');
    const reader = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = []; let total = 0;
    try {
      for (;;) {
        const r = await reader.read(); if (r.done) break;
        total += r.value.length;
        // Lo que dice el índice del zip no se cree: se corta al pasarse, no al terminar.
        if (total > cap) throw fail('zip_big');
        if (job.cancelled) throw fail('cancel');
        parts.push(r.value);
      }
    } catch (e) { try { reader.cancel().catch(() => {}); } catch (err) { /* ya cerrado */ } throw (e && e.code ? e : fail('bad')); }
    const out = new Uint8Array(total); let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }
  // Abre un zip: lee su índice y devuelve cómo pedir cada archivo. Sin zip64 ni cifrado.
  function unzip(bytes, job) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const n = bytes.length;
    if (n < 22 || dv.getUint32(0, true) !== 0x04034b50) throw fail('bad');
    let end = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) { if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; } }
    if (end < 0) throw fail('bad');
    const count = dv.getUint16(end + 10, true); const size = dv.getUint32(end + 12, true); let p = dv.getUint32(end + 16, true);
    if (count === 0xFFFF || p === 0xFFFFFFFF || count > LIMITS.entries) throw fail('zip_big');
    if (p + size > n) throw fail('bad');
    const files = new Map(); let sum = 0; const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) throw fail('bad');
      const flags = dv.getUint16(p + 8, true); const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true); const usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true); const xl = dv.getUint16(p + 30, true); const cl = dv.getUint16(p + 32, true); const off = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (flags & 1) throw fail('bad');
      sum += usize; if (sum > LIMITS.unzip) throw fail('zip_big');
      // Carpetas y rutas raras (absolutas, con "..", con barra invertida, de otra unidad) no se leen.
      if (!name || /\/$/.test(name) || /^\/|\\|\u0000|(^|\/)\.\.(\/|$)|^[A-Za-z]:/.test(name)) continue;
      files.set(name, { method, csize, usize, off });
    }
    async function read(name) {
      const f = files.get(name); if (!f) throw fail('bad');
      if (f.usize > LIMITS.entry) throw fail('zip_big');
      if (f.off + 30 > n || dv.getUint32(f.off, true) !== 0x04034b50) throw fail('bad');
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      if (start + f.csize > n) throw fail('bad');
      const comp = bytes.subarray(start, start + f.csize);
      let out = null;
      if (f.method === 0) { if (comp.length > LIMITS.entry) throw fail('zip_big'); out = comp; }
      else if (f.method === 8) out = await inflate(comp, LIMITS.entry, job);
      else throw fail('bad');
      job.unzipped += out.length; if (job.unzipped > LIMITS.unzip) throw fail('zip_big');
      return out;
    }
    return { has: (name) => files.has(name), names: () => Array.from(files.keys()), size: (name) => (files.get(name) || {}).usize || 0, read, text: async (name) => decodeText(await read(name)) };
  }

  // ---------- XML ----------
  function xml(text) {
    // Sin entidades propias: es por donde un XML se infla solo.
    if (/<!ENTITY/i.test(text)) throw fail('bad');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw fail('bad');
    return doc;
  }
  const kids = (n, name) => (n ? Array.from(n.children).filter((c) => c.localName === name) : []);
  const kid = (n, name) => { if (n) for (const c of n.children) if (c.localName === name) return c; return null; };
  const all = (n, name) => (n ? Array.from(n.getElementsByTagNameNS('*', name)) : []);
  const at = (n, name) => { if (n) for (const a of n.attributes) if (a.localName === name && (!a.prefix || a.prefix !== 'r')) return a.value; return null; };
  // Un atributo de relación (r:id, r:embed), que comparte nombre con otros del mismo elemento.
  const rid = (n, name) => { if (n) for (const a of n.attributes) if (a.localName === (name || 'id') && (a.prefix === 'r' || /relationships$/.test(a.namespaceURI || ''))) return a.value; return null; };
  const flag = (n) => !!n && !/^(0|false|off|none)$/i.test(at(n, 'val') || '');
  const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);
  // Una ruta de adentro del zip, a partir de la carpeta de quien la nombra.
  function resolve(dir, target) {
    let t = String(target || '').split('#')[0]; try { t = decodeURIComponent(t); } catch (e) { /* queda como vino */ }
    const parts = (t[0] === '/' ? t.slice(1) : dir + t).split('/'); const out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }
  // Las relaciones de una parte de Office: identificador -> { path, url, type }.
  async function relsOf(zip, part) {
    const dir = dirOf(part); const file = dir + '_rels/' + part.slice(dir.length) + '.rels'; const map = new Map();
    if (!zip.has(file)) return map;
    all(xml(await zip.text(file)), 'Relationship').forEach((r) => {
      const ext = /external/i.test(r.getAttribute('TargetMode') || ''); const target = r.getAttribute('Target') || '';
      map.set(r.getAttribute('Id'), { type: (r.getAttribute('Type') || '').split('/').pop(), path: ext ? '' : resolve(dir, target), url: ext ? target : '' });
    });
    return map;
  }
  // La parte principal de un archivo de Office, por lo que dice su raíz.
  async function mainPart(zip, fallback) {
    const rels = await relsOf(zip, '');
    for (const r of rels.values()) if (r.type === 'officeDocument' && zip.has(r.path)) return r.path;
    if (zip.has(fallback)) return fallback;
    throw fail('bad');
  }

  // ---------- Tramos de texto con formato (Word y PowerPoint) ----------
  // segs: [{ text, b, i, s, code, link }] y también { br }, { md } ya armado. Devuelve Markdown en línea.
  function segsToMd(segs, o) {
    o = o || {};
    const same = (a, b) => a.text != null && b.text != null && !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.code === !!b.code && (a.link || '') === (b.link || '');
    let list = [];
    const merge = (from) => { const out = []; from.forEach((s) => { const last = out[out.length - 1]; if (last && same(last, s)) last.text += s.text; else out.push(Object.assign({}, s)); }); return out; };
    list = merge(segs.filter((s) => s.text == null || s.text));
    // Un espacio en negrita no es negrita: se suelta, y los vecinos iguales se vuelven a juntar.
    list.forEach((s, i) => { if (s.text != null && !s.code && !s.text.trim()) { const near = list[i - 1] && list[i - 1].text != null ? list[i - 1] : {}; s.b = near.b; s.i = near.i; s.s = near.s; s.link = s.link && near.link === s.link ? s.link : (list[i + 1] && list[i + 1].link === s.link ? s.link : ''); } });
    list = merge(list);
    const piece = (s) => {
      if (s.br) return BR;
      if (s.md != null) return s.md;
      if (s.code) return codeSpan(s.text);
      let t = mdText(s.text);
      if (s.b && !o.plain && !o.head) t = wrap(t, '**');
      if (s.i && !o.plain) t = wrap(t, '*');
      if (s.s && !o.plain) t = wrap(t, '~~');
      return t;
    };
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const link = list[i].link;
      if (!link) { out += piece(list[i]); continue; }
      let inner = ''; while (i < list.length && list[i].link === link) { inner += piece(list[i]); i++; } i--;
      out += inner.trim() ? wrap(inner.split(BR).join(' '), '\u0002').replace('\u0002', '[').replace('\u0002', '](' + link + ')') : inner;
    }
    return out;
  }
  const rawOf = (segs) => segs.map((s) => (s.br ? '\n' : s.text != null ? s.text : '')).join('');

  // Una lista por niveles. items: [{ lvl, ord, text, task }]. Cuatro espacios por nivel sirven a viñetas y a números.
  function listMd(items) {
    const counters = [];
    return items.map((it) => {
      const lvl = Math.max(0, Math.min(8, it.lvl || 0)); counters.length = lvl + 1;
      counters[lvl] = (counters[lvl] || 0) + 1;
      return '    '.repeat(lvl) + (it.ord ? counters[lvl] + '. ' : '- ') + (it.task != null ? '[' + (it.task ? 'x' : ' ') + '] ' : '') + it.text;
    }).join('\n');
  }

  // ---------- Word ----------
  const MONO = /consolas|courier|mono|menlo|monaco|source code|fira code|cascadia|lucida console/i;
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  async function docxToMd(zip, job) {
    const part = await mainPart(zip, 'word/document.xml'); const dir = dirOf(part);
    const doc = xml(await zip.text(part)); const rels = await relsOf(zip, part);
    const body = all(doc, 'body')[0]; if (!body) throw fail('bad');
    const byType = (type, fallback) => { for (const r of rels.values()) if (r.type === type && zip.has(r.path)) return r.path; return zip.has(dir + fallback) ? dir + fallback : ''; };

    // Estilos: qué nivel de título, si es código o cita, y si trae numeración.
    const styles = new Map(); const stylePath = byType('styles', 'styles.xml');
    if (stylePath) all(xml(await zip.text(stylePath)), 'style').forEach((s) => {
      const pPr = kid(s, 'pPr'); const rPr = kid(s, 'rPr'); const np = kid(pPr, 'numPr'); const out = kid(pPr, 'outlineLvl');
      styles.set(at(s, 'styleId'), { name: (at(kid(s, 'name'), 'val') || '').toLowerCase(), based: at(kid(s, 'basedOn'), 'val'), out: out ? Number(at(out, 'val')) : -1,
        num: np && at(kid(np, 'numId'), 'val') ? { id: at(kid(np, 'numId'), 'val'), lvl: Number(at(kid(np, 'ilvl'), 'val') || 0) } : null, mono: MONO.test(at(kid(rPr, 'rFonts'), 'ascii') || '') });
    });
    const known = new Map();
    function styleOf(id) {
      if (known.has(id)) return known.get(id);
      const info = { h: 0, code: false, quote: false, num: null, list: '' }; let s = styles.get(id); let id0 = id;
      for (let i = 0; s && i < 12; i++) {
        const m = /^heading ([1-9])$/.exec(s.name) || /^heading([1-9])$/i.exec(id0 || '');
        if (!info.h) info.h = m ? Number(m[1]) : s.name === 'title' ? 1 : s.out >= 0 && s.out < 9 ? s.out + 1 : 0;
        if (/code|source|preformatted|verbatim/.test(s.name) || s.mono) info.code = true;
        if (/quote|cita/.test(s.name)) info.quote = true;
        if (!info.num && s.num) info.num = s.num;
        if (!info.list) info.list = /^list bullet/.test(s.name) ? 'ul' : /^list number/.test(s.name) ? 'ol' : '';
        id0 = s.based; s = styles.get(s.based);
      }
      known.set(id, info); return info;
    }
    // Numeración: si un nivel es de viñetas o de números.
    const numFmt = new Map(); const numPath = byType('numbering', 'numbering.xml');
    if (numPath) {
      const nd = xml(await zip.text(numPath)); const abs = new Map();
      all(nd, 'abstractNum').forEach((a) => { const lv = {}; kids(a, 'lvl').forEach((l) => { lv[at(l, 'ilvl')] = at(kid(l, 'numFmt'), 'val') || 'decimal'; }); abs.set(at(a, 'abstractNumId'), lv); });
      all(nd, 'num').forEach((x) => { numFmt.set(at(x, 'numId'), abs.get(at(kid(x, 'abstractNumId'), 'val')) || {}); });
    }
    const ordered = (num) => ((numFmt.get(num.id) || {})[num.lvl] || 'bullet') !== 'bullet';
    // Notas al pie: se citan como [^n] y van al final.
    const notePath = byType('footnotes', 'footnotes.xml'); const noteDoc = notePath ? xml(await zip.text(notePath)) : null;
    const noteIds = [];

    // Una imagen de adentro del documento: va si es chica y de un tipo común; si no, se cuenta como omitida.
    async function picture(holder) {
      const blip = all(holder, 'blip')[0]; const rel = blip && rels.get(rid(blip, 'embed'));
      const ext = rel ? extOf(rel.path) : ''; const type = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif' }[ext];
      if (!rel || !type || !zip.has(rel.path) || zip.size(rel.path) > LIMITS.dataImage * 0.7) { job.note('images'); return ''; }
      const url = imageUrl('data:image/' + type + ';base64,' + b64(await zip.read(rel.path)), job);
      const pr = all(holder, 'docPr')[0];
      return url ? '![' + mdText((at(pr, 'descr') || '').replace(/\s+/g, ' ').trim()) + '](' + url + ')' : '';
    }
    // Lo que va dentro de un párrafo. pics: las imágenes que hay que leer después (leer un zip espera).
    function runs(node, link, segs, pics) {
      for (const c of node.children) {
        const k = c.localName;
        if (k === 'r') {
          const rPr = kid(c, 'rPr'); const st = styleOf(at(kid(rPr, 'rStyle'), 'val'));
          const f = { b: flag(kid(rPr, 'b')), i: flag(kid(rPr, 'i')), s: flag(kid(rPr, 'strike')) || flag(kid(rPr, 'dstrike')), code: st.code || MONO.test(at(kid(rPr, 'rFonts'), 'ascii') || ''), link };
          for (const x of c.children) {
            const t = x.localName;
            if (t === 't') segs.push(Object.assign({ text: x.textContent }, f));
            else if (t === 'tab') segs.push(Object.assign({ text: f.code ? '\t' : ' ' }, f));
            else if (t === 'br' || t === 'cr') { if (!/page|column/.test(at(x, 'type') || '')) segs.push({ br: true }); }
            else if (t === 'noBreakHyphen') segs.push(Object.assign({ text: '-' }, f));
            else if (t === 'footnoteReference') { const id = at(x, 'id'); if (noteDoc && id) { if (noteIds.indexOf(id) < 0) noteIds.push(id); segs.push({ md: '[^' + (noteIds.indexOf(id) + 1) + ']' }); } }
            else if (t === 'drawing' || t === 'pict' || t === 'object' || t === 'AlternateContent') { const s = { md: '' }; segs.push(s); pics.push({ seg: s, node: x }); }
          }
        } else if (k === 'hyperlink') {
          const rel = rels.get(rid(c)); runs(c, rel && rel.url ? linkUrl(rel.url, job) : link, segs, pics);
        } else if (k === 'sdt') {
          const box = all(kid(c, 'sdtPr'), 'checkbox')[0];
          if (box) segs.push({ task: flag(all(box, 'checked')[0]) }); else { const inner = kid(c, 'sdtContent'); if (inner) runs(inner, link, segs, pics); }
        } else if (k === 'ins' || k === 'smartTag' || k === 'fldSimple' || k === 'customXml' || k === 'moveTo' || k === 'sdtContent') runs(c, link, segs, pics);
      }
    }
    async function segsOf(p) {
      const segs = []; const pics = []; runs(p, '', segs, pics);
      for (const pic of pics) pic.seg.md = await picture(pic.node);
      return segs;
    }
    async function paragraph(p) {
      const pPr = kid(p, 'pPr'); const st = styleOf(at(kid(pPr, 'pStyle'), 'val'));
      let segs = await segsOf(p);
      const taskAt = segs.findIndex((s) => s.task != null); const task = taskAt >= 0 ? segs[taskAt].task : null;
      segs = segs.filter((s) => s.task == null);
      if (st.code) return { t: 'code', text: rawOf(segs) };
      let h = st.h; const out = kid(pPr, 'outlineLvl'); if (out) { const v = Number(at(out, 'val')); if (v >= 0 && v < 9) h = v + 1; }
      let num = st.num; const np = kid(pPr, 'numPr');
      if (np) { const id = at(kid(np, 'numId'), 'val'); num = id && id !== '0' ? { id, lvl: Number(at(kid(np, 'ilvl'), 'val') || 0) } : null; }
      if (h) { const text = oneLine(segsToMd(segs, { plain: true })); return text ? { t: 'h', lvl: Math.min(6, h), text } : null; }
      const text = segsToMd(segs).replace(new RegExp('^[ ' + BR + ']+|[ ' + BR + ']+$', 'g'), '');
      if (num || st.list || task != null) {
        if (!text && task == null) return null;
        const left = Number(at(kid(pPr, 'ind'), 'left') || at(kid(pPr, 'ind'), 'start') || 0);
        return { t: 'li', lvl: num ? num.lvl : Math.max(0, Math.round(left / 720) - 1), ord: num ? ordered(num) : st.list === 'ol', key: num ? num.id : task != null ? 'task' : st.list, task: task == null ? undefined : task, text: text.split(BR).join(' ') };
      }
      if (!text) return null;
      return { t: st.quote ? 'quote' : 'p', text };
    }
    async function table(tbl) {
      let rows = [];
      for (const tr of kids(tbl, 'tr')) {
        const cells = [];
        for (const tc of kids(tr, 'tc')) {
          // La negrita del encabezado ya la pone la tabla.
          const parts = []; for (const p of all(tc, 'p')) { const s = oneLine(segsToMd(await segsOf(p), { head: !rows.length })); if (s) parts.push(s); }
          cells.push(cell(parts.join(' ')));
          const span = Number(at(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') || 1); for (let k = 1; k < Math.min(span, LIMITS.cols); k++) cells.push('');
        }
        if (cells.length) rows.push(cells);
      }
      rows = capTable(rows, job);
      return rows.length ? { t: 'table', text: mdTable(rows) } : null;
    }
    // El cuerpo, aplanado: lo que viene dentro de un control de contenido cuenta como suelto.
    const nodes = [];
    (function flat(holder) { for (const c of holder.children) { if (c.localName === 'p' || c.localName === 'tbl') nodes.push(c); else if (c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'customXml' || c.localName === 'ins') flat(c); } })(body);
    const items = [];
    for (let i = 0; i < nodes.length; i++) {
      job.progress('convert', i, nodes.length); await job.breathe();
      const it = nodes[i].localName === 'tbl' ? await table(nodes[i]) : await paragraph(nodes[i]);
      if (it) items.push(it); else if (items.length && items[items.length - 1].t === 'code') items.push({ t: 'gap' });
    }
    job.progress('convert', 1, 1);
    // Los vecinos del mismo tipo se juntan: renglones de código en un bloque, citas en una cita, una lista.
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; const run = [it];
      // Otra numeración en el primer nivel es otra lista.
      if (it.t === 'code' || it.t === 'quote' || it.t === 'li') { while (items[i + 1] && items[i + 1].t === it.t && !(it.t === 'li' && !items[i + 1].lvl && items[i + 1].key !== it.key)) run.push(items[++i]); }
      if (it.t === 'code') out.push(fenced(run.map((x) => x.text).join('\n'), ''));
      else if (it.t === 'quote') out.push(run.map((x) => paras(x.text).join('\n').split('\n').map((l) => '> ' + l).join('\n')).join('\n>\n'));
      else if (it.t === 'li') out.push(listMd(run));
      else if (it.t === 'h') out.push('#'.repeat(it.lvl) + ' ' + it.text);
      else if (it.t === 'table') out.push(it.text);
      else if (it.t === 'p') paras(it.text).forEach((p) => out.push(p));
    }
    if (noteDoc && noteIds.length) {
      const byId = new Map(); all(noteDoc, 'footnote').forEach((fn) => byId.set(at(fn, 'id'), fn));
      const lines = [];
      for (let i = 0; i < noteIds.length; i++) {
        const fn = byId.get(noteIds[i]); const parts = [];
        if (fn) for (const p of all(fn, 'p')) { const s = oneLine(segsToMd(await segsOf(p))); if (s) parts.push(s); }
        lines.push('[^' + (i + 1) + ']: ' + parts.join(' '));
      }
      out.push(lines.join('\n'));
    }
    return { md: joinBlocks(out), units: null };
  }

  // ---------- Excel ----------
  // Qué muestra un formato de número: fecha, hora, las dos, porcentaje, o nada especial.
  function formatKind(code) {
    const c = String(code || '').replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '').replace(/[_*]./g, '');
    if (!c || /general/i.test(c)) return '';
    const date = /[yd]/i.test(c); const time = /[hs]/i.test(c) || /am\/pm|a\/p/i.test(c);
    if (!date && !time) return /m/i.test(c) && !/[0#?]/.test(c) ? 'date' : /%/.test(c) ? 'pct' : '';
    return date && time ? 'datetime' : date ? 'date' : 'time';
  }
  const BUILTIN = (id) => ((id >= 14 && id <= 17) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58) ? 'date' : (id >= 18 && id <= 21) || (id >= 45 && id <= 47) ? 'time' : id === 22 ? 'datetime' : id === 9 || id === 10 ? 'pct' : '');
  // Un número de serie de Excel como fecha legible.
  function serialDate(v, kind, d1904) {
    const serial = Number(v); if (!isFinite(serial)) return String(v);
    const d = new Date(Math.round((serial - (d1904 ? 24107 : 25569)) * 86400000)); if (isNaN(d.getTime())) return String(v);
    const p = (x) => String(x).padStart(2, '0'); const sec = d.getUTCSeconds();
    const date = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    const time = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + (sec ? ':' + p(sec) : '');
    if (kind === 'time' || (kind === 'datetime' && serial < 1)) return time;
    if (kind === 'date' || (!d.getUTCHours() && !d.getUTCMinutes() && !sec)) return date;
    return date + ' ' + time;
  }
  const plainNumber = (v) => { const x = Number(v); return v === '' || !isFinite(x) ? String(v) : String(Number(x.toPrecision(15))); };
  const colOf = (ref) => { let c = 0; for (const ch of String(ref || '')) { const k = ch.charCodeAt(0); if (k >= 65 && k <= 90) c = c * 26 + (k - 64); else if (k >= 97 && k <= 122) c = c * 26 + (k - 96); else break; } return c - 1; };
  async function xlsxToMd(zip, job) {
    const part = await mainPart(zip, 'xl/workbook.xml'); const dir = dirOf(part);
    const wb = xml(await zip.text(part)); const rels = await relsOf(zip, part);
    const d1904 = flag(all(wb, 'workbookPr')[0]) && /^(1|true)$/i.test(all(wb, 'workbookPr')[0].getAttribute('date1904') || '');
    const byType = (type, fallback) => { for (const r of rels.values()) if (r.type === type && zip.has(r.path)) return r.path; return zip.has(dir + fallback) ? dir + fallback : ''; };
    // Textos compartidos.
    const shared = []; const sharedPath = byType('sharedStrings', 'sharedStrings.xml');
    const siText = (si) => all(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent).join('');
    if (sharedPath) all(xml(await zip.text(sharedPath)), 'si').forEach((si) => shared.push(siText(si)));
    // Formatos: de cada estilo de celda, si muestra una fecha.
    const kinds = []; const stylePath = byType('styles', 'styles.xml');
    if (stylePath) {
      const sd = xml(await zip.text(stylePath)); const custom = new Map();
      all(sd, 'numFmt').forEach((f) => custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode')));
      kids(all(sd, 'cellXfs')[0], 'xf').forEach((xf) => { const id = Number(xf.getAttribute('numFmtId') || 0); kinds.push(custom.has(id) ? formatKind(custom.get(id)) : BUILTIN(id)); });
    }
    function value(c) {
      const t = c.getAttribute('t') || 'n'; const v = kid(c, 'v'); const raw = v ? v.textContent : '';
      if (t === 's') return shared[Number(raw)] || '';
      if (t === 'inlineStr') return siText(kid(c, 'is') || c);
      if (t === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
      if (t === 'str' || t === 'e') return raw;
      if (t === 'd') return raw.replace('T', ' ').replace(/(:00)?(\.0+)?Z?$/, '');
      if (raw === '') return '';
      const kind = kinds[Number(c.getAttribute('s') || 0)] || '';
      if (kind === 'pct') return plainNumber(Number(raw) * 100) + '%';
      return kind ? serialDate(raw, kind, d1904) : plainNumber(raw);
    }
    const sheets = all(wb, 'sheet').filter((s) => !/hidden/i.test(s.getAttribute('state') || '')).map((s) => ({ name: s.getAttribute('name') || '', rel: rels.get(rid(s)) })).filter((s) => s.rel && zip.has(s.rel.path));
    if (!sheets.length) throw fail('bad');
    const n = Math.min(sheets.length, LIMITS.sheets); if (n < sheets.length) job.cut = [n, sheets.length];
    const out = [];
    for (let i = 0; i < n; i++) {
      job.progress('convert', i, n, true); await job.breathe(true);
      const sd = all(xml(await zip.text(sheets[i].rel.path)), 'sheetData')[0];
      const rows = []; let min = Infinity; let max = -1; let more = 0; let seq = 0;
      for (const row of kids(sd, 'row')) {
        const cells = []; let col = -1; let any = false;
        for (const c of kids(row, 'c')) {
          const ref = c.getAttribute('r'); col = ref ? colOf(ref) : col + 1;
          if (col < 0 || col > 16383) continue;
          const text = value(c); if (text === '') continue;
          any = true; cells.push([col, text]);
        }
        if (!any) continue;
        if (rows.length > LIMITS.rows) { more++; continue; }
        cells.forEach((x) => { if (x[0] < min) min = x[0]; if (x[0] > max) max = x[0]; });
        rows.push(cells);
        if (!(++seq & 255)) await job.breathe();
      }
      out.push('## ' + (oneLine(mdText(sheets[i].name)) || T('Hoja {a}', { a: i + 1 })));
      if (!rows.length) { out.push('*' + T('Hoja vacía') + '*'); continue; }
      if (more) job.note('rows', more);
      let width = max - min + 1; if (width > LIMITS.cols) { job.note('cols', width - LIMITS.cols); width = LIMITS.cols; }
      out.push(mdTable(rows.map((cells) => { const r = new Array(width).fill(''); cells.forEach((x) => { const k = x[0] - min; if (k < width) r[k] = cell(mdText(x[1])); }); return r; })));
    }
    job.progress('convert', n, n, true);
    return { md: joinBlocks(out), units: ['sheets', n] };
  }

  // ---------- PowerPoint ----------
  // Los párrafos de un cuadro de texto: [{ text, lvl, bullet }]; bullet es true, 'ol', false o null (lo que diga la plantilla).
  function slideParas(txBody) {
    return kids(txBody, 'p').map((p) => {
      const pPr = kid(p, 'pPr'); const segs = [];
      for (const c of p.children) {
        if (c.localName === 'r' || c.localName === 'fld') { const rPr = kid(c, 'rPr'); segs.push({ text: (kid(c, 't') || {}).textContent || '', b: /^(1|true)$/.test(at(rPr, 'b') || ''), i: /^(1|true)$/.test(at(rPr, 'i') || '') }); }
        else if (c.localName === 'br') segs.push({ text: ' ' });
      }
      return { text: oneLine(segsToMd(segs)), plain: oneLine(segsToMd(segs, { plain: true })), lvl: Number(at(pPr, 'lvl') || 0), bullet: kid(pPr, 'buNone') ? false : kid(pPr, 'buAutoNum') ? 'ol' : kid(pPr, 'buChar') ? true : null };
    }).filter((p) => p.text);
  }
  function shapes(tree, fn) {
    for (const c of (tree ? tree.children : [])) {
      const k = c.localName;
      if (k === 'sp' || k === 'graphicFrame' || k === 'pic') fn(c, k);
      else if (k === 'grpSp') shapes(c, fn);
      else if (k === 'AlternateContent') shapes(kid(c, 'Choice') || kid(c, 'Fallback'), fn);
    }
  }
  function slideMd(doc, index, job) {
    let title = ''; const out = [];
    shapes(all(doc, 'spTree')[0], (sp, k) => {
      if (k === 'pic') { job.note('images'); return; }
      if (k === 'graphicFrame') {
        const tbl = all(sp, 'tbl')[0]; if (!tbl) return;
        const rows = capTable(kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => cell(slideParas(kid(tc, 'txBody')).map((p) => p.text).join(' ')))).filter((r) => r.length), job);
        if (rows.length) out.push(mdTable(rows));
        return;
      }
      const ph = all(kid(sp, 'nvSpPr'), 'ph')[0]; const type = ph ? (at(ph, 'type') || 'body') : '';
      if (/^(dt|ftr|sldNum|hdr)$/.test(type)) return;
      const list = slideParas(kid(sp, 'txBody')); if (!list.length) return;
      if ((type === 'title' || type === 'ctrTitle') && !title) { title = list.map((p) => p.plain).join(' '); return; }
      const bullets = /^(body|obj|half|tbl)$/.test(type);
      let run = [];
      const flush = () => { if (run.length) { out.push(listMd(run)); run = []; } };
      list.forEach((p) => {
        const b = p.bullet == null ? bullets : p.bullet;
        if (b) run.push({ lvl: p.lvl, ord: b === 'ol', text: p.text }); else { flush(); out.push(lead(p.text)); }
      });
      flush();
    });
    return ['## ' + (title || T('Diapositiva {a}', { a: index }))].concat(out);
  }
  async function pptxToMd(zip, job) {
    const part = await mainPart(zip, 'ppt/presentation.xml');
    const pres = xml(await zip.text(part)); const rels = await relsOf(zip, part);
    const slides = all(pres, 'sldId').map((s) => rels.get(rid(s))).filter((r) => r && zip.has(r.path));
    if (!slides.length) throw fail('bad');
    const n = Math.min(slides.length, LIMITS.slides); if (n < slides.length) job.cut = [n, slides.length];
    const out = [];
    for (let i = 0; i < n; i++) {
      job.progress('convert', i, n, true); await job.breathe(true);
      const path = slides[i].path;
      slideMd(xml(await zip.text(path)), i + 1, job).forEach((b) => out.push(b));
      // Las notas del orador, como cita.
      const srels = await relsOf(zip, path); let notes = null;
      for (const r of srels.values()) if (r.type === 'notesSlide' && zip.has(r.path)) notes = r.path;
      if (notes) {
        const lines = [];
        shapes(all(xml(await zip.text(notes)), 'spTree')[0], (sp, k) => { if (k === 'sp' && at(all(kid(sp, 'nvSpPr'), 'ph')[0], 'type') === 'body') slideParas(kid(sp, 'txBody')).forEach((p) => lines.push('> ' + p.text)); });
        if (lines.length) out.push(lines.join('\n>\n'));
      }
    }
    job.progress('convert', n, n, true);
    return { md: joinBlocks(out), units: ['slides', n] };
  }

  // ---------- EPUB ----------
  async function epubToMd(zip, job) {
    if (!zip.has('META-INF/container.xml')) throw fail('bad');
    const root = all(xml(await zip.text('META-INF/container.xml')), 'rootfile')[0]; const opfPath = root && root.getAttribute('full-path');
    if (!opfPath || !zip.has(opfPath)) throw fail('bad');
    const opf = xml(await zip.text(opfPath)); const dir = dirOf(opfPath);
    const title = oneLine((all(opf, 'title')[0] || {}).textContent || '');
    const items = new Map(); all(opf, 'item').forEach((it) => items.set(it.getAttribute('id'), { path: resolve(dir, it.getAttribute('href')), type: it.getAttribute('media-type') || '' }));
    const spine = all(opf, 'itemref').map((r) => items.get(r.getAttribute('idref'))).filter((it) => it && zip.has(it.path) && /html|xml/i.test(it.type));
    if (!spine.length) throw fail('bad');
    const n = Math.min(spine.length, LIMITS.chapters); if (n < spine.length) job.cut = [n, spine.length];
    const out = title ? ['# ' + mdText(title)] : []; let done = 0;
    for (let i = 0; i < n; i++) {
      job.progress('convert', i, n, true); await job.breathe(true);
      const doc = new DOMParser().parseFromString(await zip.text(spine[i].path), 'text/html');
      // Los títulos bajan un nivel: el del libro va arriba y cada capítulo queda como una sección.
      const md = doc.body ? htmlNow(doc.body, job, { shift: 1, noRel: true }) : '';
      if (!md.trim()) continue;
      done++;
      const name = oneLine(doc.title || '');
      if (!/^#{1,6} /m.test(md) && name && name !== title) out.push('## ' + mdText(name));
      out.push(md);
    }
    job.progress('convert', n, n, true);
    return { md: joinBlocks(out), units: ['chapters', done], title };
  }

  // ---------- PDF ----------
  const PDF_MAIN = 'vendor/pdfjs/pdf.min.js'; const PDF_WORKER = 'vendor/pdfjs/pdf.worker.min.js';
  const PDF_SIZE = { [PDF_MAIN]: 398237, [PDF_WORKER]: 1417586 };
  let pdfLib = null;
  // En vendor/pdfjs va pdf.js 4.10.38 (pdfjs-dist, build legacy) tal cual, con los dos archivos renombrados de .mjs
  // a .js para que cualquier servidor los entregue como JavaScript. No está en LAZY_APP ni en las listas de sw.js.
  // pdf.js se pide acá, la primera vez que hace falta. Sus dos archivos se bajan contando los bytes, para mostrar el
  // avance; después se cargan desde la caché. El trabajador es un archivo de la app: ni eval ni código de otro origen.
  async function pdfjs(job, from) {
    if (!pdfLib) {
      const total = PDF_SIZE[PDF_MAIN] + PDF_SIZE[PDF_WORKER]; let got = 0;
      pdfLib = (async () => {
        for (const path of [PDF_WORKER, PDF_MAIN]) {
          const res = await fetch(chrome.runtime.getURL(path), job.abort ? { signal: job.abort.signal } : undefined);
          if (!res.ok) throw fail('pdf_lib');
          if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            for (;;) { const r = await reader.read(); if (r.done) break; got += r.value.length; job.progress('load', from + (1 - from) * Math.min(1, got / total), 1); }
          } else { got += (await res.arrayBuffer()).byteLength; }
        }
        const lib = await import(chrome.runtime.getURL(PDF_MAIN));
        lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER);
        return lib;
      })();
      pdfLib.catch(() => { pdfLib = null; });
    }
    try { return await pdfLib; } catch (e) { throw (job.cancelled ? fail('cancel') : fail('pdf_lib')); }
  }
  // Los trozos de texto de una página, en renglones: { text, x, y, size }.
  function pdfLines(items) {
    const lines = []; let cur = null;
    const close = () => { if (cur) { cur.text = cur.text.replace(CTRL, '').replace(/\s+/g, ' ').trim(); if (cur.text) { let best = 0; Object.keys(cur.w).forEach((k) => { if (cur.w[k] > best) { best = cur.w[k]; cur.size = Number(k); } }); lines.push(cur); } } cur = null; };
    items.forEach((it) => {
      if (typeof it.str !== 'string') return;
      const tr = it.transform || [1, 0, 0, 1, 0, 0]; const size = Math.round((Math.hypot(tr[2], tr[3]) || it.height || 0) * 2) / 2; const x = tr[4]; const y = tr[5];
      if (!it.str) { if (it.hasEOL && cur) cur.eol = true; return; }
      if (cur && !cur.eol && Math.abs(y - cur.y) <= Math.max(2, 0.45 * Math.max(size, cur.size))) {
        if (x - cur.end > 0.18 * (size || cur.size || 10) && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str; cur.end = x + (it.width || 0);
      } else { close(); cur = { text: it.str, x, y, end: x + (it.width || 0), size, w: {}, eol: false }; }
      cur.w[size] = (cur.w[size] || 0) + it.str.trim().length;
      if (it.hasEOL) cur.eol = true;
    });
    close();
    return lines;
  }
  const BULLET = /^([\u2022\u2023\u25E6\u2043\u2219\u25AA\u25A0\u25CF\u25CB\u00B7\uF0B7\uF0A7*\u2013-])\s+(\S.*)$/;
  const NUMBER = /^(\d{1,3})[.)]\s+(\S.*)$/;
  // Una página: párrafos por el espacio entre renglones, títulos por el tamaño de letra y listas por su marca.
  function pdfPage(lines, body, levels) {
    lines = lines.slice();
    // El número de página suelto, arriba o abajo, no es texto de la página.
    const folio = (l) => /^(page |p[aá]gina |p\. ?)?\d{1,4}( ?(\/|of|de) ?\d{1,4})?$/i.test(l.text);
    if (lines.length > 1 && folio(lines[lines.length - 1])) lines.pop();
    if (lines.length > 1 && folio(lines[0])) lines.shift();
    const gaps = []; for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0 && g < 3 * body) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    // El interlineado es el salto más común entre los chicos: el cuartil de abajo, para que los saltos de párrafo no lo corran.
    const leading = gaps.length > 2 ? gaps[Math.floor(gaps.length / 4)] : body * 1.25;
    const blocks = []; let cur = null; let prev = null;
    lines.forEach((l) => {
      const big = l.size >= body * 1.15 && l.text.length <= 150 && levels.has(l.size);
      const bullet = big ? null : BULLET.exec(l.text); const number = big || bullet ? null : NUMBER.exec(l.text);
      const gap = prev ? prev.y - l.y : 0;
      const fresh = !cur || !prev || bullet || number || gap > leading * 1.35 || gap < -1 || big !== (cur.t === 'h') || Math.abs(l.size - prev.size) > 0.6;
      if (fresh) {
        cur = big ? { t: 'h', lvl: levels.get(l.size), text: l.text } : bullet ? { t: 'li', mark: '- ', text: bullet[2] } : number ? { t: 'li', mark: number[1] + '. ', text: number[2] } : { t: 'p', text: l.text };
        blocks.push(cur);
      } else if (/[A-Za-z\u00C0-\u024F]-$/.test(cur.text) && /^[a-z\u00DF-\u00FF]/.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text; // una palabra cortada al final del renglón
      else cur.text += ' ' + l.text;
      prev = l;
    });
    let out = '';
    blocks.forEach((b, i) => {
      const text = b.t === 'h' ? '#'.repeat(b.lvl) + ' ' + mdText(b.text) : b.t === 'li' ? b.mark + mdText(b.text) : lead(mdText(b.text));
      out += (i ? (b.t === 'li' && blocks[i - 1].t === 'li' ? '\n' : '\n\n') : '') + text;
    });
    return out;
  }
  async function pdfToMd(bytes, job) {
    const lib = await pdfjs(job, 0.2);
    job.progress('load', 1, 1);
    const task = lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, enableXfa: false, verbosity: 0 });
    job.stop.push(() => task.destroy());
    let pdf = null;
    try { pdf = await task.promise; } catch (e) { if (job.cancelled) throw fail('cancel'); throw fail(e && e.name === 'PasswordException' ? 'pdf_password' : 'bad'); }
    try {
      job.worker = !!(task._worker && task._worker._webWorker);
      const n = Math.min(pdf.numPages, LIMITS.pages); if (n < pdf.numPages) job.cut = [n, pdf.numPages];
      const pages = []; const weight = {}; let chars = 0;
      for (let i = 1; i <= n; i++) {
        job.progress('convert', i - 1, n, true); await job.breathe(true);
        let lines = [];
        try { const page = await pdf.getPage(i); lines = pdfLines((await page.getTextContent()).items); page.cleanup(); }
        catch (e) { if (job.cancelled) throw fail('cancel'); /* una página que no se pudo leer queda vacía */ }
        lines.forEach((l) => { weight[l.size] = (weight[l.size] || 0) + l.text.length; chars += l.text.length; });
        pages.push(lines);
      }
      job.progress('convert', n, n, true);
      if (!chars) throw fail('pdf_empty');
      // El tamaño del texto corrido es el que más letras tiene; los más grandes, de mayor a menor, son los títulos.
      let body = 0; let most = 0; Object.keys(weight).forEach((k) => { if (weight[k] > most) { most = weight[k]; body = Number(k); } });
      const levels = new Map(); Object.keys(weight).map(Number).filter((s) => s >= body * 1.15).sort((a, b) => b - a).forEach((s, i) => levels.set(s, Math.min(3, i + 1)));
      const out = []; let empty = 0;
      pages.forEach((lines) => { const md = pdfPage(lines, body || 10, levels); if (md) out.push(md); else empty++; });
      if (empty) job.note('emptyPages', empty);
      return { md: out.join('\n\n---\n\n'), units: ['pages', n - empty] };
    } finally { try { task.destroy(); } catch (e) { /* ya cerrado */ } }
  }

  // ---------- Convertir un archivo ----------
  function readBytes(file, job, share) {
    if (typeof FileReader !== 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = (e) => { if (e.lengthComputable) job.progress('load', share * e.loaded / Math.max(1, e.total), 1); };
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => reject(fail('bad')); r.onabort = () => reject(fail('cancel'));
      job.stop.push(() => r.abort());
      r.readAsArrayBuffer(file);
    });
  }
  const cleanName = (name) => String(name || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const baseName = (name) => cleanName(String(name || '').replace(/\.[^.]+$/, ''));
  // file: un File. opt: { job, onProgress, kind, html }. Devuelve { md, name, kind, units, warnings }.
  async function convert(file, opt) {
    opt = opt || {};
    const job = opt.job || newJob(opt.onProgress);
    const ext = extOf(file.name); const kind = opt.kind || KINDS[ext];
    if (!kind) throw fail('type');
    const max = kind === 'html' || kind === 'csv' ? LIMITS.text : LIMITS.file;
    if (file.size > max) throw fail('big', { max });
    job.progress('load', 0, 1);
    await job.breathe(true);
    const bytes = opt.html != null ? null : await readBytes(file, job, kind === 'pdf' ? 0.2 : 1);
    if (kind !== 'pdf') job.progress('load', 1, 1);
    await job.breathe(true);
    let res = null;
    if (kind === 'html') res = await htmlToMd(opt.html != null ? String(opt.html) : decodeText(bytes, htmlCharset(bytes)), job);
    else if (kind === 'csv') res = await csvToMd(decodeText(bytes), ext, job);
    else if (kind === 'pdf') {
      let head = ''; for (let i = 0; i < Math.min(bytes.length, 1024); i++) head += String.fromCharCode(bytes[i]);
      if (head.indexOf('%PDF-') < 0) throw fail('bad');
      res = await pdfToMd(bytes, job);
    } else {
      const zip = unzip(bytes, job);
      res = await (kind === 'docx' ? docxToMd : kind === 'xlsx' ? xlsxToMd : kind === 'pptx' ? pptxToMd : epubToMd)(zip, job);
    }
    let md = (res.md || '').trim();
    if (!md) throw fail('empty');
    const name = (opt.html != null ? cleanName(res.title) : baseName(file.name)) || cleanName(res.title) || T('importado');
    // Excel y PowerPoint arrancan con el nombre del archivo como título; el EPUB ya trae el suyo.
    if (kind === 'xlsx' || kind === 'pptx') md = '# ' + mdText(name) + '\n\n' + md;
    if (md.length > LIMITS.out) { md = md.slice(0, md.lastIndexOf('\n', LIMITS.out) > 0 ? md.lastIndexOf('\n', LIMITS.out) : LIMITS.out); job.note('out'); }
    const units = res.units || ['words', md.split(/\s+/).filter(Boolean).length];
    return { md: md + '\n', name, kind, units, warnings: warningsOf(job), worker: job.worker };
  }
  const UNIT = {
    pages: ['1 página convertida', '{a} páginas convertidas'], sheets: ['1 hoja convertida', '{a} hojas convertidas'], slides: ['1 diapositiva convertida', '{a} diapositivas convertidas'],
    chapters: ['1 capítulo convertido', '{a} capítulos convertidos'], rows: ['1 fila convertida', '{a} filas convertidas'], words: ['1 palabra convertida', '{a} palabras convertidas'],
  };
  const summaryOf = (units) => T(UNIT[units[0]][units[1] === 1 ? 0 : 1], { a: units[1] });
  function warningsOf(job) {
    const w = job.warn; const out = [];
    if (job.cut) out.push(T('Se convirtió solo el principio: {a} de {b}.', { a: job.cut[0], b: job.cut[1] }));
    if (w.images) out.push(T(w.images === 1 ? '1 imagen omitida.' : '{a} imágenes omitidas.', { a: w.images }));
    if (w.rows) out.push(T('Tablas cortadas: {a} filas quedaron afuera.', { a: w.rows }));
    if (w.cols) out.push(T('Tablas cortadas: {a} columnas quedaron afuera.', { a: w.cols }));
    if (w.links) out.push(T(w.links === 1 ? '1 enlace descartado.' : '{a} enlaces descartados.', { a: w.links }));
    if (w.emptyPages) out.push(T(w.emptyPages === 1 ? '1 página sin texto.' : '{a} páginas sin texto.', { a: w.emptyPages }));
    if (w.out) out.push(T('El texto se cortó por su tamaño.'));
    return out;
  }

  // ---------- El diálogo ----------
  const STAGES = [['load', 'Cargando'], ['convert', 'Convirtiendo']];
  function dialog(name) {
    const box = el('div', { class: 'lmd-ask lmd-imp' });
    box.innerHTML = '<div class="lmd-ask-card lmd-imp-card" role="dialog" aria-modal="true" aria-labelledby="lmd-imp-title">' +
      '<h3 id="lmd-imp-title">' + esc(T('Importar a Markdown')) + '</h3><p class="lmd-imp-name"></p>' +
      STAGES.map((s) => '<div class="lmd-imp-stage" data-stage="' + s[0] + '"><div class="lmd-imp-row"><span>' + esc(T(s[1])) + '</span><span class="lmd-imp-n"></span></div>' +
        '<div class="lmd-imp-bar" role="progressbar" aria-label="' + esc(T(s[1])) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>').join('') +
      '<p class="lmd-imp-live" role="status" aria-live="polite"></p>' +
      '<div class="lmd-imp-out" hidden><p class="lmd-imp-sum"></p><ul class="lmd-imp-warn"></ul></div>' +
      '<p class="lmd-dlg-err lmd-imp-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-imp="cancel" data-esc>' + esc(T('Cancelar')) + '</button>' +
        '<button type="button" class="lmd-btn" data-imp="insert" hidden>' + esc(T('Agregar a la nota abierta')) + '</button>' +
        '<button type="button" class="lmd-btn lmd-btn-fill" data-imp="new" hidden>' + esc(T('Abrir como nota nueva')) + '</button></div></div>';
    // El nombre del archivo es texto, nunca HTML.
    box.querySelector('.lmd-imp-name').textContent = name;
    const live = box.querySelector('.lmd-imp-live'); const q = (s) => box.querySelector(s);
    let said = 0; let stageNow = ''; let choose = null; let onCancel = null; let closed = false;
    const paint = (id, pct, text) => {
      const st = q('[data-stage=' + id + ']'); const bar = st.querySelector('.lmd-imp-bar');
      bar.setAttribute('aria-valuenow', String(pct)); bar.setAttribute('aria-valuetext', text); bar.firstChild.style.width = pct + '%';
      st.querySelector('.lmd-imp-n').textContent = text;
    };
    function progress(p) {
      if (closed) return;
      const pct = Math.max(0, Math.min(100, Math.round(100 * (p.total ? p.done / p.total : 0))));
      const text = p.unit ? T('{a} de {b}', { a: p.done, b: p.total }) : pct + '%';
      if (p.stage === 'convert' && stageNow !== 'convert') paint('load', 100, '100%');
      paint(p.stage, pct, text);
      // A quien usa lector de pantalla se le dice cada tanto, no en cada paso.
      const now = Date.now(); const label = T(p.stage === 'load' ? 'Cargando' : 'Convirtiendo');
      if (p.stage !== stageNow || now - said > 4000) { said = now; live.textContent = label + ' ' + text; }
      stageNow = p.stage;
    }
    const close = () => { if (closed) return; closed = true; box.remove(); };
    box.addEventListener('keydown', (e) => { e.stopPropagation(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-imp]'); if (!b) return;
      if (choose) { const done = choose; choose = null; close(); done(b.dataset.imp === 'cancel' ? '' : b.dataset.imp); } else if (b.dataset.imp === 'cancel') { close(); if (onCancel) onCancel(); }
    });
    document.body.appendChild(box);
    q('[data-imp=cancel]').focus();
    return {
      box, progress, close,
      set onCancel(fn) { onCancel = fn; },
      // Terminó: el resumen, los avisos y qué hacer con el resultado. Devuelve 'new', 'insert' o ''.
      done(res, canInsert) {
        if (closed) return Promise.resolve('');
        paint('load', 100, '100%'); paint('convert', 100, res.units[0] === 'words' || res.units[0] === 'rows' ? '100%' : q('[data-stage=convert] .lmd-imp-n').textContent || '100%');
        q('.lmd-imp-out').hidden = false; q('.lmd-imp-sum').textContent = summaryOf(res.units);
        const ul = q('.lmd-imp-warn'); res.warnings.forEach((w) => ul.appendChild(el('li', { text: w }))); ul.hidden = !res.warnings.length;
        live.textContent = summaryOf(res.units) + (res.warnings.length ? ' ' + res.warnings.join(' ') : '');
        q('[data-imp=cancel]').textContent = T('Cerrar');
        const fresh = q('[data-imp=new]'); fresh.hidden = false; q('[data-imp=insert]').hidden = !canInsert;
        fresh.focus();
        return new Promise((resolve) => { choose = resolve; });
      },
      // No se pudo: el motivo, y un solo botón.
      error(text) {
        if (closed) return Promise.resolve('');
        box.querySelectorAll('.lmd-imp-stage').forEach((s) => { s.hidden = true; }); live.textContent = '';
        const err = q('.lmd-imp-err'); err.hidden = false; err.textContent = text;
        const b = q('[data-imp=cancel]'); b.textContent = T('Cerrar'); b.focus();
        return new Promise((resolve) => { choose = resolve; });
      },
    };
  }

  // ---------- Qué se hace con el resultado ----------
  const canInsert = () => !!core && !core.noDoc && core.blocks && !core.readOnly && !(core.appRoot && core.appRoot.kind === 'pub');
  function insert(md) {
    const lines = md.replace(/\n+$/, '').split('\n'); const src = core.srcLines;
    // Una línea en blanco entre lo que había y lo nuevo; una nota vacía queda solo con lo nuevo.
    if (!core.raw.trim()) core.spliceLines(0, src.length, lines.concat(['']));
    else core.spliceLines(src.length, 0, (src[src.length - 1].trim() !== '' ? [''] : []).concat(lines, ['']));
    core.render();
    core.flash(T('Agregado al final de la nota'));
  }
  async function openNew(res) {
    // Sin guardar: la nota nace en la sesión y se elige dónde guardarla con Ctrl+S.
    let name = res.name + '.md';
    if (core.docName === name) name = res.name + '-2.md';
    if (await core.openText(name, res.md)) return true;
    // No entró en la sesión (pesa mucho): queda guardada en este navegador.
    const ok = await core.newNote({ name: res.name, text: res.md, target: 'local' });
    if (ok !== false) core.flash(T('La nota es grande: quedó guardada en este navegador.'));
    return ok !== false;
  }

  let busy = false;
  // Convierte un archivo mostrando el avance. opt: { html } para HTML que no viene de un archivo.
  async function run(file, opt) {
    // force: lo pidió el menú de un PDF o un EPUB abierto en el visor, que no depende del interruptor de la herramienta.
    if (opt && opt.core && !core) core = opt.core;
    if ((!on && !(opt && opt.force)) || !core || !core.APP || busy || !file) return false;
    busy = true;
    const dlg = dialog(file.name || '');
    const job = newJob(dlg.progress); dlg.onCancel = () => job.cancel();
    try {
      const res = await convert(file, Object.assign({}, opt, { job }));
      const what = await dlg.done(res, canInsert());
      if (what === 'insert') insert(res.md); else if (what === 'new') await openNew(res);
      return !!what;
    } catch (e) {
      if (e && e.code === 'cancel') { dlg.close(); core.flash(T('Importación cancelada')); return false; }
      await dlg.error(why(e));
      return false;
    } finally { busy = false; }
  }
  const htmlFile = (html) => new File([html], T('pegado') + '.html', { type: 'text/html' });
  const runHtml = (html) => run(htmlFile(html), { kind: 'html', html });

  function pick() {
    if (!on || !core || !core.APP || busy) return;
    const input = el('input', { type: 'file', accept: ACCEPT, class: 'lmd-imp-file', hidden: '' });
    input.addEventListener('change', () => { const f = input.files[0]; input.remove(); if (f) run(f); });
    input.addEventListener('cancel', () => input.remove());
    document.body.appendChild(input);
    input.click();
  }
  async function pasteHtml() {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.indexOf('text/html') >= 0) { const html = await (await item.getType('text/html')).text(); if (html.trim()) return runHtml(html); }
      }
    } catch (e) { /* sin permiso: se dice abajo */ }
    core.flash(T('No hay HTML en el portapapeles.'), 'warn');
    return false;
  }

  // ---------- Los botones, y soltar o pegar ----------
  const active = () => on && !!core && core.APP;
  const modalOpen = () => !!document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres') || !core.ui.panel.hidden;
  function homeButton(box) {
    const row = box && box.querySelector('.lmd-home-actions'); if (!row) return;
    const old = row.querySelector('[data-import]');
    if (!active()) { if (old) old.remove(); return; }
    if (old) return;
    const b = el('button', { type: 'button', class: 'lmd-btn', 'data-import': 'pick' }, ICON + '<span>' + esc(T('Importar a Markdown')) + '</span>');
    b.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
    row.appendChild(b);
  }
  function sideButton() {
    const head = core.ui.sidebar.querySelector('.lmd-zone-files .lmd-zone-head'); if (!head) return;
    const old = head.querySelector('.lmd-import-btn');
    if (!active()) { if (old) old.remove(); return; }
    if (old) return;
    const b = el('button', { type: 'button', class: 'lmd-zone-btn lmd-import-btn', title: T('Importar a Markdown'), 'aria-label': T('Importar a Markdown') }, ICON);
    b.addEventListener('click', () => pick());
    head.insertBefore(b, head.querySelector('.lmd-zone-btn'));
  }
  function paint() { if (!core) return; sideButton(); homeButton(core.ui.home); }
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('Files') >= 0;
  const hasHtml = (e) => !hasFiles(e) && Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('text/html') >= 0;
  function onDragOver(e) {
    if (!active() || busy) return;
    // Con archivos, o con HTML arrastrado desde otra página mientras no hay nota abierta: se deja soltar.
    if (hasFiles(e) || (core.noDoc && hasHtml(e))) e.preventDefault();
  }
  function onDrop(e) {
    if (!active() || busy || modalOpen()) return;
    const file = Array.from((e.dataTransfer && e.dataTransfer.files) || []).find((f) => takes(f.name));
    const html = !file && core.noDoc && hasHtml(e) ? e.dataTransfer.getData('text/html') : '';
    if (!file && !html.trim()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    core.ui.home.classList.remove('lmd-drop');
    if (file) run(file); else runHtml(html);
  }
  function onPaste(e) {
    if (!active() || busy || !core.noDoc || modalOpen()) return;
    const t = e.target; if (t && t.closest && t.closest('input, textarea, [contenteditable=true]')) return;
    const cd = e.clipboardData; if (!cd) return;
    const file = Array.from(cd.files || []).find((f) => takes(f.name)); const html = file ? '' : cd.getData('text/html');
    if (!file && !html.trim()) return;
    e.preventDefault();
    if (file) run(file); else runHtml(html);
  }

  function enable(c) {
    core = c; on = true; paint();
    if (wired) return;
    wired = true;
    core.actions['import-md'] = () => pick();
    core.hooks.home.push((box) => homeButton(box));
    // En pantalla chica el explorador está detrás de un botón: importar también va en "más".
    core.menus.more.push(() => (active() && LMD.touch.small() ? ['import-md', ICON, 'Importar a Markdown'] : null));
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('paste', onPaste);
  }
  function disable() { on = false; paint(); }
  function settings(area, api) {
    area.textContent = '';
    if (!core.APP) { area.appendChild(el('p', { class: 'lmd-tl-why', text: T('Importar a Markdown se usa desde la app.') })); return; }
    area.appendChild(el('p', { class: 'lmd-tl-why', text: T('Word, Excel, PowerPoint, EPUB, PDF, HTML, CSV y TSV. El archivo se convierte en este dispositivo y no se sube. También podés soltarlo en la ventana. Del PDF sale solo el texto.') }));
    const row = el('div', { class: 'lmd-row lmd-row-line' }); row.appendChild(el('span'));
    const paste = el('button', { type: 'button', class: 'lmd-btn', 'data-imp-go': 'paste', text: T('Pegar HTML') });
    const go = el('button', { type: 'button', class: 'lmd-btn', 'data-imp-go': 'pick', text: T('Elegir un archivo') });
    paste.addEventListener('click', () => { api.close(); pasteHtml(); });
    go.addEventListener('click', () => { api.close(); pick(); });
    if (navigator.clipboard && navigator.clipboard.read) row.appendChild(paste);
    row.appendChild(go);
    area.appendChild(row);
  }

  LMD.import = { enable, disable, settings, convert, run, runHtml, pick, takes, accept: ACCEPT, limits: LIMITS, busy: () => busy, pdfLoaded: () => !!pdfLib,
    // Lo que el visor de PDF y EPUB (viewer.js) toma de acá: el cargador de pdf.js, el lector de zip y el de XML.
    kit: { newJob, unzip, pdfjs, xml, all, resolve, dirOf, why } };
})();
