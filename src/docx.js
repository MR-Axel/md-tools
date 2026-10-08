// Herramienta: exportar a Word (.docx). El archivo se arma acá, en el navegador, sin librerías: las partes de
// OOXML se escriben a mano y se empaquetan en un zip propio (con su CRC32; comprimido donde el navegador sabe).
// Se parte de la nota ya dibujada: así los diagramas van como imagen y las imágenes, incrustadas.
(function () {
  'use strict';
  const T = LMD.t;
  const { el } = LMD.kit;
  const svgIcon = '<svg viewBox="0 0 24 24"><path d="M6.500 3.500h8l4 4v13h-12z"/><path d="M14.500 3.500v4h4M8.800 11.500l1.300 5.500 1.900-4.200 1.900 4.200 1.300-5.500"/></svg>';
  let core = null; let on = false; let wired = false;

  // ---------- Zip ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = (s) => new TextEncoder().encode(s);
  // Comprime con deflate si el navegador lo trae; si no, o si no achica, el archivo va sin comprimir.
  async function deflate(bytes) {
    if (typeof CompressionStream !== 'function' || bytes.length < 64) return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const out = new Uint8Array(await new Response(stream).arrayBuffer());
      return out.length < bytes.length ? out : null;
    } catch (e) { return null; }
  }
  // files: [{ name, data: Uint8Array, store }]. Devuelve el zip como Uint8Array.
  async function zip(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = []; const central = []; let offset = 0;
    for (const f of files) {
      const name = utf8(f.name); const packed = f.store ? null : await deflate(f.data); const body = packed || f.data;
      const crc = crc32(f.data); const method = packed ? 8 : 0;
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, method, true);
      head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true); head.setUint32(22, f.data.length, true); head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
      parts.push(new Uint8Array(head.buffer), name, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, method, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let at = 0;
    all.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }

  // ---------- XML ----------
  // Lo que XML no admite (caracteres de control) se saca; lo demás se escapa.
  const x = (s) => String(s == null ? '' : s).replace(/[^\x09\x0A\x0D\x20-퟿-�\uD800-\uDFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const EMU = 9525; // por píxel a 96 ppp
  const MAX_W = 5731200; // el ancho del texto en una hoja A4 con 2,54 cm de margen
  const MONO = 'Consolas';

  // ---------- Estilos y numeración ----------
  function stylesXml(lang) {
    const font = (name) => '<w:rFonts w:ascii="' + name + '" w:hAnsi="' + name + '" w:cs="' + name + '" w:eastAsia="' + name + '"/>';
    const HEAD = [[32, '1F2937'], [26, '1F2937'], [24, '1F2937'], [22, '1F2937'], [22, '374151'], [22, '4B5563']];
    return XML + '<w:styles ' + NS + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + font('Calibri') + '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="' + lang + '"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      HEAD.map((h, i) => '<w:style w:type="paragraph" w:styleId="Heading' + (i + 1) + '"><w:name w:val="heading ' + (i + 1) + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + (i ? 200 : 320) + '" w:after="' + (i ? 80 : 120) + '"/><w:outlineLvl w:val="' + i + '"/></w:pPr>' +
        '<w:rPr>' + font('Calibri Light') + '<w:b/><w:bCs/>' + (i > 3 ? '<w:i/><w:iCs/>' : '') + '<w:color w:val="' + h[1] + '"/><w:sz w:val="' + h[0] + '"/><w:szCs w:val="' + h[0] + '"/></w:rPr></w:style>').join('') +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr>' + font('Calibri Light') + '<w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="BFC5CE"/></w:pBdr><w:spacing w:after="100"/><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="40"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr>' + font(MONO) + '<w:noProof/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:uiPriority w:val="40"/><w:qFormat/><w:rPr>' + font(MONO) + '<w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="1A5FD0"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
        '<w:tblPr><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="BFC5CE"/>').join('') + '</w:tblBorders></w:tblPr></w:style>' +
      '</w:styles>';
  }
  const BULLETS = ['•', '◦', '▪'];
  const NUMFMT = ['decimal', 'decimal', 'decimal']; // como en la nota: números en todos los niveles
  function numberingXml(nums) {
    const lvl = (i, fmt, text, extra) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr>' + (extra || '') + '</w:lvl>';
    let bullets = ''; let numbers = '';
    for (let i = 0; i < 9; i++) { bullets += lvl(i, 'bullet', BULLETS[i % 3]); numbers += lvl(i, NUMFMT[i % 3], '%' + (i + 1) + '.'); }
    return XML + '<w:numbering ' + NS + '>' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + bullets + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + numbers + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      // Cada lista numerada es una numeración propia, que arranca en su número.
      nums.map((n) => '<w:num w:numId="' + n.id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="' + n.lvl + '"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride></w:num>').join('') +
      '</w:numbering>';
  }

  // ---------- Imágenes ----------
  const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const canvasPng = (canvas) => new Promise((resolve, reject) => { try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'); } catch (e) { reject(e); } });
  const KINDS = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };
  // De qué tipo son esos bytes, por cómo empiezan.
  function sniff(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    return '';
  }
  async function drawn(source, w, h, bg) {
    const scale = Math.max(1, Math.min(2, 2400 / Math.max(w, 1)));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(source, 0, 0, c.width, c.height);
    return { bytes: await blobBytes(await canvasPng(c)), ext: 'png' };
  }
  // Una imagen de la nota: sus bytes si se pueden leer; si no, se dibuja en un canvas. null si no se puede.
  async function imageOf(img) {
    if (!img.complete || !img.naturalWidth) return null;
    const src = img.currentSrc || img.src || '';
    const size = { w: img.width || img.naturalWidth, h: img.height || img.naturalHeight };
    if (!img.width || !img.height) { size.w = img.naturalWidth; size.h = img.naturalHeight; }
    try {
      let bytes = null;
      const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(src);
      if (m) { if (m[2]) { const bin = atob(m[3]); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } }
      else if (/^https?:/i.test(src)) { const r = await fetch(src); if (r.ok) { const blob = await r.blob(); if (KINDS[blob.type] || !blob.type) bytes = await blobBytes(blob); } }
      const ext = bytes ? sniff(bytes) : '';
      if (ext) return Object.assign({ bytes, ext }, size);
    } catch (e) { /* no se dejó leer: queda el canvas */ }
    try { return Object.assign(await drawn(img, img.naturalWidth, img.naturalHeight), size); } catch (e) { return null; }
  }
  // Un diagrama (SVG) como PNG, sobre el fondo de la nota para que se lea igual que en pantalla.
  async function svgOf(svg, bg) {
    const box = svg.getBoundingClientRect(); const w = Math.round(box.width); const h = Math.round(box.height);
    if (!w || !h) return null;
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', w); copy.setAttribute('height', h); copy.removeAttribute('style');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      return Object.assign(await drawn(img, w, h, bg), { w, h });
    } catch (e) { return null; }
  }

  // ---------- De la nota al documento ----------
  const SKIP = '.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-dgm-tools, .lmd-add, .lmd-draft, .lmd-draft-li, .lmd-board-edit, .lmd-cl-bar, .lmd-cl-add, .lmd-cl-grip, .lmd-front, .lmd-cm-layer, .lmd-live-layer, .lmd-voice-ghost, .lmd-handle, .footnote-backref, .lmd-col-n, .lmd-err-note, .footnotes-sep, script, style, button, select, textarea';
  const BLOCK = /^(P|DIV|UL|OL|DL|PRE|TABLE|BLOCKQUOTE|H[1-6]|HR|SECTION|DETAILS|FIGURE|ARTICLE|ASIDE|HEADER|FOOTER|NAV|MAIN)$/;
  const isBlock = (n) => n.nodeType === 1 && (BLOCK.test(n.tagName) || n.matches('.lmd-code, .lmd-table, .lmd-diagram, .lmd-math-block, .lmd-board'));

  async function build(article, info) {
    info = info || {};
    const lang = LMD.lang() === 'es' ? 'es-ES' : 'en-US';
    const rels = []; const media = []; const nums = []; const notes = []; const marks = new Map();
    let relId = 0; let drawId = 0; let markId = 0;
    const rel = (type, target, external) => { const id = 'rId' + (++relId); rels.push({ id, type, target, external }); return id; };
    rel('styles', 'styles.xml'); rel('numbering', 'numbering.xml'); rel('settings', 'settings.xml');
    rel('footnotes', 'footnotes.xml');

    // Antes de recorrer: lo que hay que leer o dibujar (imágenes y diagramas), de a uno.
    const pics = new Map();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
    for (const img of Array.from(article.querySelectorAll('img'))) { if (!img.closest(SKIP)) pics.set(img, await imageOf(img)); }
    for (const d of Array.from(article.querySelectorAll('.lmd-diagram'))) { const svg = d.querySelector('svg'); pics.set(d, svg ? await svgOf(svg, bg) : null); }
    // Los títulos llevan un marcador: un enlace a una sección de la nota salta ahí.
    article.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]').forEach((h) => { marks.set(h.id, { name: 'lmd_' + (marks.size + 1), id: ++markId }); });
    // Las notas al pie, por el id de su renglón.
    const fnItems = new Map(); article.querySelectorAll('section.footnotes li[id]').forEach((li) => fnItems.set(li.id, li));
    const fnUsed = new Map();

    function picture(p, alt) {
      const n = ++drawId; const file = 'image' + n + '.' + p.ext;
      media.push({ name: 'word/media/' + file, data: p.bytes });
      const rid = rel('image', 'media/' + file);
      let cx = Math.round(p.w * EMU); let cy = Math.round(p.h * EMU);
      if (cx > MAX_W) { cy = Math.round(cy * MAX_W / cx); cx = MAX_W; }
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="' + x(T('Imagen')) + ' ' + n + '" descr="' + x(alt || '') + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="' + file + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    // ---- Lo que va dentro de un párrafo ----
    const rPr = (f) => {
      const s = (f.code ? '<w:rStyle w:val="CodeChar"/>' : f.link ? '<w:rStyle w:val="Hyperlink"/>' : '') + (f.b ? '<w:b/><w:bCs/>' : '') + (f.i ? '<w:i/><w:iCs/>' : '') + (f.s ? '<w:strike/>' : '') +
        (f.mark ? '<w:highlight w:val="yellow"/>' : '') + (f.u ? '<w:u w:val="single"/>' : '') + (f.sup ? '<w:vertAlign w:val="superscript"/>' : f.sub ? '<w:vertAlign w:val="subscript"/>' : '');
      return s ? '<w:rPr>' + s + '</w:rPr>' : '';
    };
    const textRun = (text, f) => {
      if (!text) return '';
      // Dentro de un bloque de código cada tabulación y cada salto se conservan.
      const body = text.split(/(\n|\t)/).map((t) => (t === '\n' ? '<w:br/>' : t === '\t' ? '<w:tab/>' : t ? '<w:t xml:space="preserve">' + x(t) + '</w:t>' : '')).join('');
      return '<w:r>' + rPr(f) + body + '</w:r>';
    };
    // out: lista de piezas { text, f } o { xml }. inFn: dentro de una nota al pie (sin enlaces ni imágenes propias).
    function inline(node, f, out, inFn) { node.childNodes.forEach((n) => one(n, f, out, inFn)); }
    function one(n, f, out, inFn) {
      {
        if (n.nodeType === 3) { out.push({ text: f.pre ? n.nodeValue : n.nodeValue.replace(/[ \t\r\n]+/g, ' '), f }); return; }
        if (n.nodeType !== 1 || n.matches(SKIP) || n.hidden) return;
        const tag = n.tagName; const g = Object.assign({}, f);
        if (tag === 'BR') { out.push({ xml: '<w:r><w:br/></w:r>' }); return; }
        if (tag === 'IMG') {
          const p = inFn ? null : pics.get(n); const alt = n.getAttribute('alt') || '';
          if (p) out.push({ xml: picture(p, alt) }); else if (alt) out.push({ text: '[' + alt + ']', f: Object.assign(g, { i: true }) });
          return;
        }
        if (tag === 'INPUT') { if (n.type === 'checkbox') out.push({ xml: checkbox(n.checked) }, { text: ' ', f }); return; }
        if (n.classList.contains('lmd-math')) { out.push({ text: n.getAttribute('data-tex') || n.textContent, f: Object.assign(g, { code: true }) }); return; }
        if (tag === 'SUP' && n.classList.contains('footnote-ref')) {
          const a = n.querySelector('a'); const key = a ? (a.getAttribute('href') || '').slice(1) : '';
          if (!inFn && fnItems.has(key) && !fnUsed.has(key)) { const id = notes.length + 1; fnUsed.set(key, id); notes.push({ id, li: fnItems.get(key) }); out.push({ xml: '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="' + id + '"/></w:r>' }); }
          else out.push({ text: n.textContent.trim(), f: Object.assign(g, { sup: true }) });
          return;
        }
        if (tag === 'A') {
          const href = n.getAttribute('data-lmd-href') || n.getAttribute('href') || '';
          const inner = []; inline(n, Object.assign(g, { link: true }), inner, inFn);
          const body = pieces(inner, false);
          if (!body) return;
          if (!inFn && href[0] === '#' && marks.has(decodeURIComponent(href.slice(1)))) out.push({ xml: '<w:hyperlink w:anchor="' + marks.get(decodeURIComponent(href.slice(1))).name + '" w:history="1">' + body + '</w:hyperlink>' });
          else if (!inFn && /^(https?:|mailto:)/i.test(href) && !(core && core.appUrl && href.indexOf(core.appUrl) === 0)) out.push({ xml: '<w:hyperlink r:id="' + rel('hyperlink', href, true) + '" w:history="1">' + body + '</w:hyperlink>' });
          else { const plain = []; inline(n, f, plain, inFn); plain.forEach((p) => out.push(p)); if (inFn && /^https?:/i.test(href) && n.textContent.trim() !== href) out.push({ text: ' (' + href + ')', f }); }
          return;
        }
        if (tag === 'STRONG' || tag === 'B') g.b = true;
        else if (tag === 'EM' || tag === 'I') g.i = true;
        else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') g.s = true;
        else if (tag === 'U' || tag === 'INS') g.u = true;
        else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') g.code = true;
        else if (tag === 'MARK') g.mark = true;
        else if (tag === 'SUP') g.sup = true;
        else if (tag === 'SUB') g.sub = true;
        inline(n, g, out, inFn);
      }
    }
    // Las piezas como texto de Word. Con trim, sin espacios al principio ni al final del párrafo.
    function pieces(list, trim) {
      if (trim) {
        while (list.length && list[0].text != null && !list[0].text.trim()) list.shift();
        while (list.length && list[list.length - 1].text != null && !list[list.length - 1].text.trim()) list.pop();
        if (list.length && list[0].text != null) list[0] = { text: list[0].text.replace(/^\s+/, ''), f: list[0].f };
        const z = list.length - 1; if (z >= 0 && list[z].text != null) list[z] = { text: list[z].text.replace(/\s+$/, ''), f: list[z].f };
      }
      return list.map((p) => (p.xml != null ? p.xml : textRun(p.text, p.f))).join('');
    }
    const checkbox = (checked) => '<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="' + (checked ? 1 : 0) + '"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>' +
      '<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>' + (checked ? '☒' : '☐') + '</w:t></w:r></w:sdtContent></w:sdt>';
    const para = (pPr, runs) => '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + runs + '</w:p>';
    const JC = { center: 'center', right: 'right', justify: 'both' };

    // ---- Los bloques ----
    // c: { quote, list: { depth, numId }, cell }
    function pPrOf(c, more) {
      more = more || {};
      const style = more.style || (c.quote ? 'Quote' : c.list ? 'ListParagraph' : '');
      const left = (c.quote ? 360 * c.quote : 0) + (more.left || 0);
      return (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (more.num || '') + (more.pBdr || '') + (more.spacing || '') +
        (left || more.hanging ? '<w:ind w:left="' + left + '"' + (more.hanging ? ' w:hanging="' + more.hanging + '"' : '') + '/>' : '') + (more.jc ? '<w:jc w:val="' + more.jc + '"/>' : '');
    }
    function inlinePara(node, c, more, f) {
      const list = []; if (Array.isArray(node)) node.forEach((k) => one(k, f || {}, list, false)); else inline(node, f || {}, list, false);
      const runs = pieces(list, true);
      return runs || (more && more.keep) ? para(pPrOf(c, more), ((more && more.before) || '') + runs) : '';
    }
    function codeLines(text, c) {
      const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      return lines.map((ln, i) => para(pPrOf(c, { style: 'Code', spacing: i === lines.length - 1 ? '<w:spacing w:after="160" w:line="240" w:lineRule="auto"/>' : '' }), textRun(ln, { pre: true }))).join('');
    }
    function table(tb, c) {
      const rows = Array.from(tb.rows); if (!rows.length) return '';
      const cols = Math.max.apply(null, rows.map((r) => Array.from(r.cells).reduce((n, cell) => n + (cell.colSpan || 1), 0)));
      const colW = Math.floor(9026 / Math.max(1, cols));
      const body = rows.map((r) => {
        const head = r.parentNode.tagName === 'THEAD' || Array.from(r.cells).every((cell) => cell.tagName === 'TH');
        return '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + Array.from(r.cells).map((cell) => {
          const span = cell.colSpan > 1 ? cell.colSpan : 0; const align = JC[(cell.style.textAlign || cell.getAttribute('align') || '').toLowerCase()] || '';
          let inner = '';
          if (Array.from(cell.children).some(isBlock)) inner = blocks(cell, { cell: true }); else inner = inlinePara(cell, { cell: true }, { keep: true, jc: align }, head ? { b: true } : {});
          if (!/<\/w:p>$/.test(inner)) inner += '<w:p/>';
          return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>' + (span ? '<w:gridSpan w:val="' + span + '"/>' : '') + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>' : '') + '</w:tcPr>' + inner + '</w:tc>';
        }).join('') + '</w:tr>';
      }).join('');
      return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
        '<w:tblGrid>' + ('<w:gridCol w:w="' + colW + '"/>').repeat(cols) + '</w:tblGrid>' + body + '</w:tbl>' + (c.cell ? '' : '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>');
    }
    function listOf(listEl, c) {
      const depth = c.list ? c.list.depth + 1 : 0; const lvl = Math.min(depth, 8); const ordered = listEl.tagName === 'OL';
      let numId = 1;
      if (ordered) { numId = nums.length + 2; nums.push({ id: numId, lvl, start: Math.max(1, parseInt(listEl.getAttribute('start'), 10) || 1) }); }
      const cc = Object.assign({}, c, { list: { depth, numId } });
      const num = '<w:numPr><w:ilvl w:val="' + lvl + '"/><w:numId w:val="' + numId + '"/></w:numPr>';
      const left = 720 * (lvl + 1);
      let out = '';
      Array.from(listEl.children).forEach((li) => {
        if (li.tagName !== 'LI' || li.matches(SKIP)) return;
        const task = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
        // Lo que va en línea se junta en un párrafo; un bloque adentro (otra lista, código, cita) corta y sigue.
        let first = true; let run = [];
        const flush = () => {
          const runs = pieces(run, true); run = [];
          if (!runs && !first) return;
          if (!runs && first && !li.textContent.trim() && !task) { first = false; out += para(pPrOf(cc, { num }), ''); return; }
          if (!runs) return;
          out += para(pPrOf(cc, first ? (task ? { left, hanging: 360 } : { num }) : { left }), runs); first = false;
        };
        const walk = (holder) => holder.childNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { flush(); first = false; out += listOf(n, cc); }
          else if (n.nodeType === 1 && n.tagName === 'P') { flush(); walk(n); flush(); }
          else if (isBlock(n)) { flush(); first = false; out += block(n, cc); }
          else one(n, {}, run, false);
        });
        walk(li); flush();
      });
      return out;
    }
    function block(n, c) {
      if (n.nodeType === 3) { return n.nodeValue.trim() ? para(pPrOf(c), textRun(n.nodeValue.replace(/\s+/g, ' ').trim(), {})) : ''; }
      if (n.nodeType !== 1 || n.matches(SKIP) || n.hidden) return '';
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const m = n.id && marks.get(n.id);
        const mark = m ? '<w:bookmarkStart w:id="' + m.id + '" w:name="' + m.name + '"/><w:bookmarkEnd w:id="' + m.id + '"/>' : '';
        return inlinePara(n, {}, { style: 'Heading' + tag[1], before: mark, left: c.quote ? 360 * c.quote : 0 });
      }
      if (n.matches('.lmd-diagram')) {
        const p = pics.get(n);
        if (p) return para(pPrOf(c, { jc: 'center' }), picture(p, T('Diagrama')));
        return codeLines(n.getAttribute('data-code') || n.textContent, c);
      }
      if (n.matches('.lmd-math-block')) return para(pPrOf(c, { jc: 'center' }), textRun(n.getAttribute('data-tex') || n.textContent, { code: true }));
      if (n.matches('.lmd-code')) { const code = n.querySelector('pre'); return code ? codeLines(code.textContent, c) : ''; }
      if (tag === 'PRE') return codeLines(n.textContent, c);
      if (n.matches('.lmd-board')) {
        return Array.from(n.querySelectorAll('.lmd-col')).map((col) => {
          const title = col.querySelector('.lmd-col-title');
          return para(pPrOf(c), textRun(title ? title.textContent.trim() : '', { b: true })) +
            Array.from(col.querySelectorAll('.lmd-card')).map((card) => { const t = card.querySelector('.lmd-card-text'); return para(pPrOf(Object.assign({}, c, { list: { depth: 0 } }), { left: 720, hanging: 360 }), checkbox(card.classList.contains('lmd-card-done')) + textRun(' ' + (t ? t.textContent : card.textContent).trim(), {})); }).join('');
        }).join('');
      }
      if (tag === 'TABLE') return table(n, c);
      if (n.matches('.lmd-table')) { const t = n.querySelector('table'); return t ? table(t, c) : ''; }
      if (tag === 'UL' || tag === 'OL') return listOf(n, c);
      if (tag === 'BLOCKQUOTE') return blocks(n, Object.assign({}, c, { quote: (c.quote || 0) + 1 }));
      if (tag === 'HR') return para('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFC5CE"/></w:pBdr><w:spacing w:before="120" w:after="240"/>', '');
      if (tag === 'DL') return Array.from(n.children).map((d) => (d.tagName === 'DT' ? inlinePara(d, c, {}, { b: true }) : inlinePara(d, c, { left: 720 }))).join('');
      if (tag === 'SECTION' && n.classList.contains('footnotes')) return '';
      if (tag === 'DETAILS') { const s = n.querySelector(':scope > summary'); return (s ? inlinePara(s, c, {}, { b: true }) : '') + Array.from(n.childNodes).filter((k) => k !== s).map((k) => block(k, c)).join(''); }
      if (tag === 'P') {
        if (n.classList.contains('lmd-alert-title')) return inlinePara(n, c, {}, { b: true });
        // Un párrafo que es solo una imagen va centrado.
        const only = n.children.length === 1 && n.firstElementChild.tagName === 'IMG' && !n.textContent.trim();
        return inlinePara(n, c, only ? { jc: 'center' } : {});
      }
      if (Array.from(n.children).some(isBlock)) return blocks(n, c);
      return inlinePara(n, c, {});
    }
    // Los hijos de un contenedor: lo suelto en línea se junta en párrafos entre bloque y bloque.
    function blocks(holder, c) {
      let out = ''; let loose = [];
      const flush = () => { if (loose.length) { out += inlinePara(loose, c, {}); loose = []; } };
      holder.childNodes.forEach((n) => {
        if (isBlock(n)) { flush(); out += block(n, c); }
        else loose.push(n);
      });
      flush();
      return out;
    }

    const body = blocks(article, {}) || '<w:p/>';
    // Las notas al pie se arman después: recién ahora se sabe cuáles se citaron.
    const fnXml = notes.map((fn) => {
      const src = fn.li.cloneNode(true); src.querySelectorAll('.footnote-backref').forEach((b) => b.remove());
      const paras = Array.from(src.children).filter((k) => k.tagName === 'P'); const from = paras.length ? paras : [src];
      return '<w:footnote w:id="' + fn.id + '">' + from.map((p, i) => {
        const list = []; inline(p, {}, list, true);
        return para('<w:pStyle w:val="FootnoteText"/>', (i ? '' : '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>') + pieces(list, true));
      }).join('') + '</w:footnote>';
    }).join('');

    const title = info.title || '';
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const document_ = XML + '<w:document ' + NS + '><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const footnotes = XML + '<w:footnotes ' + NS + '>' +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' + fnXml + '</w:footnotes>';
    const settings = XML + '<w:settings ' + NS + '><w:defaultTabStop w:val="708"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
    const exts = Array.from(new Set(media.map((m) => m.name.split('.').pop())));
    const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };
    const types = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      exts.map((e) => '<Default Extension="' + e + '" ContentType="' + MIME[e] + '"/>').join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
    const rootRels = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/></Relationships>';
    const docRels = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map((r) => '<Relationship Id="' + r.id + '" Type="' + REL + r.type + '" Target="' + x(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';
    const coreXml = XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + x(title) + '</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:modified></cp:coreProperties>';
    const appXml = XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SharpMD</Application></Properties>';
    const files = [
      { name: '[Content_Types].xml', data: utf8(types) }, { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'word/document.xml', data: utf8(document_) }, { name: 'word/_rels/document.xml.rels', data: utf8(docRels) },
      { name: 'word/styles.xml', data: utf8(stylesXml(lang)) }, { name: 'word/numbering.xml', data: utf8(numberingXml(nums)) },
      { name: 'word/settings.xml', data: utf8(settings) }, { name: 'word/footnotes.xml', data: utf8(footnotes) },
      { name: 'docProps/core.xml', data: utf8(coreXml) }, { name: 'docProps/app.xml', data: utf8(appXml) },
    ].concat(media.map((m) => ({ name: m.name, data: m.data, store: true }))); // las imágenes ya vienen comprimidas
    return zip(files);
  }

  // ---------- Exportar la nota abierta ----------
  const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function titleOf() {
    const front = core.ui.article.querySelector('.lmd-front');
    if (front) { const dt = Array.from(front.querySelectorAll('dt')).find((d) => d.textContent.trim().toLowerCase() === 'title'); if (dt && dt.nextElementSibling && dt.nextElementSibling.textContent.trim()) return dt.nextElementSibling.textContent.trim(); }
    const h = core.ui.article.querySelector('h1');
    if (h) { const c = h.cloneNode(true); c.querySelectorAll('.lmd-anchor').forEach((a) => a.remove()); if (c.textContent.trim()) return c.textContent.trim(); }
    return (core.docName || '').replace(/\.[^.]+$/, '');
  }
  let busy = false;
  // Devuelve los bytes del .docx de la nota abierta (para las pruebas y para quien lo quiera sin descargar).
  const bytes = () => build(core.ui.article, { title: titleOf() });
  async function exportDoc() {
    if (!on || !core || core.noDoc || busy) return false;
    busy = true;
    try {
      const data = await bytes();
      const name = (core.docName || T('documento')).replace(/\.[^.]+$/, '') + '.docx';
      if (LMD.kit.saveFile(new Blob([data], { type: MIME_DOCX }), name) === 'download') core.flash(T('Documento de Word descargado'));
      return true;
    } catch (e) { core.flash(T('No se pudo armar el documento de Word.'), 'error'); return false; }
    finally { busy = false; }
  }

  function enable(c) {
    core = c; on = true;
    if (wired) return;
    wired = true;
    core.actions['export-docx'] = () => exportDoc();
    core.menus.export.push(() => (on && core.blocks ? ['export-docx', svgIcon, 'Word (.docx)'] : null));
  }
  function disable() { on = false; }
  function settings(area, api) {
    area.innerHTML = '<p class="lmd-tl-why">' + T('Está en el menú Exportar de la barra de arriba. Las fórmulas van como texto LaTeX y los diagramas como imagen.').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</p>' +
      '<div class="lmd-row lmd-row-line"><span></span><button type="button" class="lmd-btn" data-docx="go">' + T('Exportar esta nota') + '</button></div>';
    const go = area.querySelector('[data-docx=go]');
    go.disabled = core.noDoc || !core.blocks;
    go.addEventListener('click', () => { api.close(); exportDoc(); });
  }

  LMD.docx = { enable, disable, settings, export: exportDoc, bytes, build, zip, crc32 };
})();
