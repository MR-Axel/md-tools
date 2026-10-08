// La herramienta Importar a Markdown (Ajustes > Herramientas, apagada de entrada): un Word, un Excel, un PowerPoint,
// un EPUB, un PDF, un HTML o un CSV se convierte en el navegador y queda como nota nueva sin guardar o al final de la
// nota abierta. Los archivos de prueba se arman acá mismo: zips mínimos, un PDF escrito a mano, HTML y CSV como texto.
//   ONLY=pdf node import.mjs      (una parte: off, html, xss, csv, docx, xlsx, pptx, epub, pdf, ui, cancel, bad, limits, zip, entry, ext, phone, themes, tab)
import { rig, tally, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import zlib from 'zlib';

const ONLY = process.env.ONLY || '';
const R = await rig({}, 'chromium');
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (id, name, fn) => { if (ONLY && ONLY !== id) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

// ---------- Archivos de prueba ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// files: { nombre: texto o Buffer }. opt.lie: { nombre: tamaño } para un índice que miente sobre lo que hay adentro.
function zip(files, opt) {
  opt = opt || {}; const parts = []; const central = []; let offset = 0; const names = Object.keys(files);
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name], 'utf8'); const body = zlib.deflateRawSync(data); const nm = Buffer.from(name, 'utf8');
    const usize = opt.lie && opt.lie[name] != null ? opt.lie[name] : data.length;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(usize, 22); head.writeUInt16LE(nm.length, 26);
    parts.push(head, nm, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(data), 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(usize, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nm); offset += 30 + nm.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat(central, [end]));
}
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relsXml = (list) => X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map((r, i) => '<Relationship Id="' + (r[2] || 'rId' + (i + 1)) + '" Type="' + REL + '/' + r[0] + '" Target="' + r[1] + '"' + (r[3] ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';

// Word: título, formato, enlace, listas con niveles, tabla, código y cita.
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + REL + '"';
const wr = (t, pr) => '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + t + '</w:t></w:r>';
const wp = (runs, ppr) => '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + runs + '</w:p>';
const wli = (t, num, lvl) => wp(wr(t), '<w:numPr><w:ilvl w:val="' + (lvl || 0) + '"/><w:numId w:val="' + num + '"/></w:numPr>');
const wtc = (t) => '<w:tc>' + wp(wr(t)) + '</w:tc>';
function docxFile(body) {
  return zip({
    '[Content_Types].xml': X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    '_rels/.rels': relsXml([['officeDocument', 'word/document.xml']]),
    'word/document.xml': X + '<w:document ' + W + '><w:body>' + body + '</w:body></w:document>',
    'word/_rels/document.xml.rels': relsXml([['styles', 'styles.xml'], ['numbering', 'numbering.xml'], ['hyperlink', 'https://example.com/docs', 'rId9', true], ['hyperlink', 'javascript:alert(1)', 'rId10', true]]),
    'word/styles.xml': X + '<w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="Subtitulo propio"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>',
    'word/numbering.xml': X + '<w:numbering ' + W + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
  });
}
const DOCX = docxFile(
  wp(wr('Quarterly Plan'), '<w:pStyle w:val="Heading1"/>') +
  wp(wr('Some ') + wr('bold', '<w:b/>') + wr(' and ') + wr('italic', '<w:i/>') + wr(' text, a ') + '<w:hyperlink r:id="rId9">' + wr('link') + '</w:hyperlink>' + wr(' and a ') + '<w:hyperlink r:id="rId10">' + wr('bad one') + '</w:hyperlink>' + wr('.')) +
  wp(wr('Goals'), '<w:pStyle w:val="Titulo2"/>') +
  wli('First', 1) + wli('Nested', 1, 1) + wli('Second', 1) +
  wp(wr('After the list.')) +
  wli('Step one', 2) + wli('Step two', 2) +
  '<w:tbl><w:tr>' + wtc('Name') + wtc('Qty') + '</w:tr><w:tr>' + wtc('Pipe | here') + wtc('2') + '</w:tr></w:tbl>' +
  wp(wr('const a = 1;'), '<w:pStyle w:val="Code"/>') + wp(wr('  return a * 2;'), '<w:pStyle w:val="Code"/>') +
  wp(wr('Wise words.'), '<w:pStyle w:val="Quote"/>') +
  wp(wr('# not a title, &lt;b&gt;not bold&lt;/b&gt;')));
const DOCX_MD = ['# Quarterly Plan', '', 'Some **bold** and *italic* text, a [link](https://example.com/docs) and a bad one.', '', '## Goals', '', '- First', '    - Nested', '- Second', '', 'After the list.', '', '1. Step one', '2. Step two', '',
  '| Name | Qty |', '| --- | --- |', '| Pipe \\| here | 2 |', '', '```', 'const a = 1;', '  return a * 2;', '```', '', '> Wise words.', '', '\\# not a title, \\<b>not bold\\</b>', ''].join('\n');

// Excel: textos compartidos, un número con fórmula, fechas por formato, porcentaje, una hoja vacía y una oculta.
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '"';
const XLSX = zip({
  '_rels/.rels': relsXml([['officeDocument', 'xl/workbook.xml']]),
  'xl/workbook.xml': X + '<workbook ' + S + '><sheets><sheet name="Sales 2023" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/><sheet name="Secret" sheetId="3" state="hidden" r:id="rId3"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': relsXml([['worksheet', 'worksheets/sheet1.xml'], ['worksheet', 'worksheets/sheet2.xml'], ['worksheet', 'worksheets/sheet3.xml'], ['sharedStrings', 'sharedStrings.xml'], ['styles', 'styles.xml']]),
  'xl/sharedStrings.xml': X + '<sst ' + S + '>' + ['Name', 'Qty', 'When', 'Share', 'Note', 'Widget | big', 'Gadget'].map((t) => '<si><t>' + t + '</t></si>').join('') + '</sst>',
  'xl/styles.xml': X + '<styleSheet ' + S + '><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': X + '<worksheet ' + S + '><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2"><f>SUM(1,2)</f><v>3</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2" s="3"><v>0.25</v></c><c r="E2" t="inlineStr"><is><t>inline *text*</t></is></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3"><v>1.5</v></c><c r="C3" s="2"><v>45000.5</v></c><c r="D3" t="b"><v>1</v></c><c r="E3" t="str"><f>CONCAT("ca","lc")</f><v>calc</v></c></row>' +
    '</sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': X + '<worksheet ' + S + '><sheetData/></worksheet>',
  'xl/worksheets/sheet3.xml': X + '<worksheet ' + S + '><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden value</t></is></c></row></sheetData></worksheet>',
});
const XLSX_MD = ['# book', '', '## Sales 2023', '', '| Name | Qty | When | Share | Note |', '| --- | --- | --- | --- | --- |', '| Widget \\| big | 3 | 2023-03-15 | 25% | inline \\*text\\* |', '| Gadget | 1.5 | 2023-03-15 12:00 | TRUE | calc |', '', '## Empty', '', '*Empty sheet*', ''].join('\n');

// PowerPoint: una diapositiva con título, viñetas con niveles y notas; otra sin título, con un cuadro de texto, una tabla y una imagen.
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '"';
const ap = (t, lvl, pr) => '<a:p>' + (lvl ? '<a:pPr lvl="' + lvl + '"/>' : '') + (pr || '') + t + '</a:p>';
const ar = (t, b) => '<a:r>' + (b ? '<a:rPr b="1"/>' : '') + '<a:t>' + t + '</a:t></a:r>';
const sp = (ph, paras) => '<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>' + (ph ? '<p:ph type="' + ph + '"/>' : '') + '</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>' + paras + '</p:txBody></p:sp>';
const slide = (inner) => X + '<p:sld ' + P + '><p:cSld><p:spTree>' + inner + '</p:spTree></p:cSld></p:sld>';
const atc = (t) => '<a:tc><a:txBody><a:bodyPr/>' + ap(ar(t)) + '</a:txBody></a:tc>';
const PPTX = zip({
  '_rels/.rels': relsXml([['officeDocument', 'ppt/presentation.xml']]),
  'ppt/presentation.xml': X + '<p:presentation ' + P + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': relsXml([['slide', 'slides/slide1.xml'], ['slide', 'slides/slide2.xml']]),
  'ppt/slides/slide1.xml': slide(sp('title', ap(ar('Roadmap'))) + sp('body', ap(ar('First point')) + ap(ar('Sub ') + ar('point', true), 1) + ap(ar('Third')))),
  'ppt/slides/_rels/slide1.xml.rels': relsXml([['notesSlide', '../notesSlides/notesSlide1.xml']]),
  'ppt/notesSlides/notesSlide1.xml': X + '<p:notes ' + P + '><p:cSld><p:spTree>' + sp('sldImg', '') + sp('body', ap(ar('Remember to smile'))) + '</p:spTree></p:cSld></p:notes>',
  'ppt/slides/slide2.xml': slide(sp('', ap(ar('Just a box'))) + '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr>' + atc('A') + atc('B') + '</a:tr><a:tr>' + atc('1') + atc('2') + '</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:pic><p:blipFill/></p:pic>'),
});
const PPTX_MD = ['# deck', '', '## Roadmap', '', '- First point', '    - Sub **point**', '- Third', '', '> Remember to smile', '', '## Slide 2', '', 'Just a box', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', ''].join('\n');

// EPUB: dos capítulos; el primero trae un script y una imagen de adentro del libro, el segundo un enlace a otro capítulo.
const xhtml = (title, body) => '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + title + '</title></head><body>' + body + '</body></html>';
const EPUB = zip({
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': X + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'OEBPS/content.opf': X + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Book</dc:title></metadata>' +
    '<manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="s.css" media-type="text/css"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
  'OEBPS/text/ch1.xhtml': xhtml('One', '<h1>Chapter One</h1><p>Hello <em>there</em>.</p><p><img src="../img/a.png" alt="x"/></p><script>window.__pwn = 1;</script>'),
  'OEBPS/text/ch2.xhtml': xhtml('Two', '<h1>Chapter Two</h1><ul><li>a</li><li>b</li></ul><p><a href="ch1.xhtml">back</a> <a href="https://example.com/x">out</a></p>'),
  'OEBPS/s.css': 'p { color: red }',
});
const EPUB_MD = ['# The Book', '', '## Chapter One', '', 'Hello *there*.', '', '## Chapter Two', '', '- a', '- b', '', 'back [out](https://example.com/x)', ''].join('\n');

// Un PDF de texto escrito a mano. pages: [[tamaño, x, y, texto], ...] por página; draw: una página con solo un dibujo.
function pdfFile(pages) {
  const objs = []; const e = (t) => t.replace(/[\\()]/g, '\\$&');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + pages.map((p, i) => (4 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((p, i) => {
    const content = p === 'draw' ? '72 72 m 300 300 l S' : p.map((l) => 'BT /F1 ' + l[0] + ' Tf ' + l[1] + ' ' + l[2] + ' Td (' + e(l[3]) + ') Tj ET').join('\n');
    objs[4 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>';
    objs[5 + i * 2] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
  });
  let out = '%PDF-1.4\n'; const at = [];
  for (let n = 1; n < objs.length; n++) { at[n] = out.length; out += n + ' 0 obj\n' + objs[n] + '\nendobj\n'; }
  const xref = out.length;
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + at.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
const PDF = pdfFile([
  [[24, 72, 720, 'Annual Report'],
    [12, 72, 680, 'This is the first line of a paragraph that'], [12, 72, 666, 'wraps onto a second line.'],
    [12, 72, 636, 'A second paragraph shows that conver-'], [12, 72, 622, 'sion joins a word cut at the end.'],
    [12, 72, 592, '\x95 First item'], [12, 72, 578, '\x95 Second item'], [12, 72, 548, '1. Step one'], [12, 72, 534, '2. Step two'],
    [12, 72, 504, '# not a title, <b>not bold</b>'], [12, 300, 40, '1']],
  [[18, 72, 720, 'Details'], [12, 72, 690, 'Text on page two.'], [12, 300, 40, '2']],
]);
const PDF_MD = ['# Annual Report', '', 'This is the first line of a paragraph that wraps onto a second line.', '', 'A second paragraph shows that conversion joins a word cut at the end.', '', '- First item', '- Second item', '1. Step one', '2. Step two', '',
  '\\# not a title, \\<b>not bold\\</b>', '', '---', '', '## Details', '', 'Text on page two.', ''].join('\n');
const PDF6 = pdfFile(Array.from({ length: 6 }, (x, i) => [[12, 72, 700, 'Page number ' + (i + 1) + ' has some text.']]));
const SCAN = pdfFile(['draw', 'draw']);

const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Sample Page</title><style>p{color:red}</style><script>window.__pwn = 1;</script></head><body>\n' +
  '<nav><a href="/home">Home</a> <a href="/about">About</a></nav>\n<main>\n' +
  '<h1 class="x" onclick="window.__pwn = 1">Main <b>Title</b></h1>\n' +
  '<p style="margin:0">Some <strong>bold</strong>, <em>italic</em>, <del>gone</del> and <code>inline()</code> text with a <a href="https://example.com/a(b)" onclick="x()">link</a>.</p>\n' +
  '<p>Line one<br>line two</p>\n' +
  '<ul><li>One</li><li>Two<ul><li>Deep</li></ul></li><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Todo</li></ul>\n' +
  '<ol start="3"><li>Three</li><li>Four</li></ol>\n' +
  '<blockquote><p>Quoted <b>text</b></p></blockquote>\n' +
  '<pre><code class="language-js">const a = 1 &lt; 2;\nconsole.log(`x`);</code></pre>\n<hr>\n' +
  '<table><thead><tr><th>Name</th><th align="right">Qty</th></tr></thead><tbody><tr><td>Pipe | here</td><td>2</td></tr></tbody></table>\n' +
  '<p><img src="https://example.com/pic.png" alt="A pic"><img src="data:image/png;base64,iVBORw0KGgo=" alt="tiny"><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="svg"></p>\n' +
  '<p>Literal *stars* and &lt;tags&gt; and 1. not a list</p>\n</main>\n<footer>Footer text</footer></body></html>';
const HTML_MD = ['# Main Title', '', 'Some **bold**, *italic*, ~~gone~~ and `inline()` text with a [link](https://example.com/a%28b%29).', '', 'Line one\\', 'line two', '', '- One', '- Two', '  - Deep', '- [x] Done', '- [ ] Todo', '', '3. Three', '4. Four', '',
  '> Quoted **text**', '', '```js', 'const a = 1 < 2;', 'console.log(`x`);', '```', '', '---', '', '| Name | Qty |', '| --- | --: |', '| Pipe \\| here | 2 |', '', '![A pic](https://example.com/pic.png)![tiny](data:image/png;base64,iVBORw0KGgo=)', '',
  'Literal \\*stars\\* and \\<tags> and 1. not a list', ''].join('\n');
// Todo lo que un HTML hostil puede traer. Nada de esto tiene que correr ni quedar como enlace.
const EVIL = '<html><body><h1>Evil</h1><script>window.__pwn = 1;</script><img src="x" onerror="window.__pwn = 1"><svg onload="window.__pwn = 1"><script>window.__pwn = 1</script></svg>' +
  '<p><a href="javascript:window.__pwn=1">js</a> <a href="JaVa\tScRiPt:window.__pwn=1">tab</a> <a href="  javascript:window.__pwn=1">space</a> <a href="data:text/html,<script>window.__pwn=1</script>">data</a> <a href="vbscript:x">vb</a> <a href="https://ok.example/">fine</a></p>' +
  '<p>&lt;img src=x onerror="window.__pwn = 1"&gt; &lt;script&gt;window.__pwn = 1&lt;/script&gt; [md](javascript:window.__pwn=1) ![i](javascript:window.__pwn=1)</p>' +
  '<iframe src="javascript:window.__pwn=1"></iframe><object data="javascript:window.__pwn=1"></object><p><img src="javascript:window.__pwn=1" alt="bad"></p>' +
  '<table><tr><th>a</th><th>b</th></tr><tr><td>&lt;img src=x onerror="window.__pwn = 1"&gt;</td><td><a href="javascript:window.__pwn=1">cell</a></td></tr></table></body></html>';
const CSV = 'Name,Qty,Note\r\n"Smith, John",3,"He said ""hi"""\r\nPipe | here,4,"two\nlines"\r\n<b>x</b>,5,*star*\r\n';
const CSV_MD = ['| Name | Qty | Note |', '| --- | --- | --- |', '| Smith, John | 3 | He said "hi" |', '| Pipe \\| here | 4 | two lines |', '| \\<b>x\\</b> | 5 | \\*star\\* |', ''].join('\n');

// ---------- El navegador ----------
async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, tools]) => { try { if (localStorage.getItem('imp:listo')) return; localStorage.setItem('imp:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: 'en', tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.tools || {}]);
  const pdfHits = []; page.on('request', (r) => { if (/\/vendor\/pdfjs\//.test(r.url())) pdfHits.push(r.url().split('/').pop()); });
  return { ctx, page, pdfHits };
}
const ON = { tools: { import: true } };
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const goHome = async (page) => { await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250); };
const ready = (page) => page.waitForFunction(() => !!(window.LMD && LMD.import && LMD.tools.isOn('import')), null, { timeout: 15000 });
const home = async (page) => { await goHome(page); await ready(page); await page.waitForSelector('[data-import]'); };
async function note(page, name, text) {
  await goHome(page); await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(R.home + '?f=' + encodeURIComponent('local/' + name)); await page.waitForSelector('.lmd-article > *'); await sleep(350);
}
const scripts = (page, file) => page.evaluate((f) => [...document.scripts].filter((s) => s.src.split('/').pop() === f).length, file);
const flashText = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const toolsTab = async (page) => { await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); };
// Convierte sin interfaz: lo que devuelve la herramienta, o el código del error.
const conv = (page, name, buf, opt) => page.evaluate(async ([n, b64, o]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  try { return await LMD.import.convert(new File([u], n), o || {}); } catch (e) { return { error: e.code || String(e) }; }
}, [name, Buffer.from(buf).toString('base64'), opt || null]);
const limits = (page, patch) => page.evaluate((p) => { Object.assign(LMD.import.limits, p); }, patch);
// Elegir un archivo con el botón del inicio (o con el que se indique).
async function choose(page, file, button) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(button || '[data-import]')]);
  await fc.setFiles(file);
  await page.waitForSelector('.lmd-imp');
}
const dlg = (page) => page.evaluate(() => {
  const box = document.querySelector('.lmd-imp'); if (!box) return null;
  const vis = (n) => !!n && !n.hidden && n.getClientRects().length > 0;
  const bars = [...box.querySelectorAll('.lmd-imp-bar')].map((b) => ({ role: b.getAttribute('role'), min: b.getAttribute('aria-valuemin'), max: b.getAttribute('aria-valuemax'), now: Number(b.getAttribute('aria-valuenow')), label: b.getAttribute('aria-label'), text: b.getAttribute('aria-valuetext') }));
  return { name: box.querySelector('.lmd-imp-name').textContent, bars, sum: vis(box.querySelector('.lmd-imp-out')) ? box.querySelector('.lmd-imp-sum').textContent : '', warn: [...box.querySelectorAll('.lmd-imp-warn li')].map((l) => l.textContent),
    err: vis(box.querySelector('.lmd-imp-err')) ? box.querySelector('.lmd-imp-err').textContent : '', buttons: [...box.querySelectorAll('.lmd-ask-actions button')].filter(vis).map((b) => b.textContent), focus: document.activeElement && box.contains(document.activeElement) ? document.activeElement.textContent : '',
    live: box.querySelector('.lmd-imp-live').textContent, modal: box.querySelector('[role=dialog]').getAttribute('aria-modal'), title: (document.getElementById(box.querySelector('[role=dialog]').getAttribute('aria-labelledby')) || {}).textContent };
});
const finished = (page) => page.waitForFunction(() => { const b = document.querySelector('.lmd-imp'); return b && (!b.querySelector('.lmd-imp-out').hidden || !b.querySelector('.lmd-imp-err').hidden); }, null, { timeout: 30000 });
const article = (page) => page.evaluate(() => document.querySelector('.lmd-article').innerText);
const texts = (page) => page.evaluate(() => { const bad = []; document.querySelectorAll('.lmd-tl-card[data-tool=import], .lmd-ask, .lmd-menu, [data-import], .lmd-import-btn').forEach((n) => { const t = n.textContent + ' ' + (n.title || ''); if (/[!¡—–]/.test(t)) bad.push(t.slice(0, 80)); }); return bad; });
const file = (name, buf, type) => ({ name, mimeType: type || 'application/octet-stream', buffer: Buffer.from(buf) });

// ---------- Apagada no cambia nada ----------
await step('off', 'Apagada: nada cambia', async () => {
  const { ctx, page, pdfHits } = await open();
  await goHome(page);
  check('apagada: sin su archivo, sin botón en el inicio ni en el explorador', await page.evaluate(() => !LMD.import && !document.querySelector('[data-import], .lmd-import-btn')) && await scripts(page, 'import.js') === 0);
  const before = await page.evaluate(() => document.querySelector('.lmd-home-actions').innerHTML);
  // Soltar un CSV con la herramienta apagada no abre ningún diálogo de importar.
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['a,b\n1,2\n'], 't.csv', { type: 'text/csv' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await sleep(400);
  check('soltar un CSV no ofrece convertirlo', await page.evaluate(() => !document.querySelector('.lmd-imp')));
  await toolsTab(page);
  const card = await page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=import]'); return c ? { name: c.querySelector('b').textContent, about: c.querySelector('p').textContent, on: c.querySelector('input').checked, icon: !!c.querySelector('.lmd-tl-ico svg') } : null; });
  check('su tarjeta está en Herramientas, apagada', !!card && card.name === 'Import to Markdown' && card.on === false && card.icon && /without uploading/.test(card.about), card);
  check('las diez tarjetas, cada una con su interruptor', await page.evaluate(() => document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card').length === 10 && document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card input[data-tool-on]').length === 10));
  await page.click('.lmd-tl-card[data-tool=import] .lmd-switch'); await until(() => page.evaluate(() => !!LMD.import));
  check('prenderla pide su archivo, una vez, y queda guardado', await scripts(page, 'import.js') === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('mdtools:settings')).tools.import)) === true);
  await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=import] .lmd-tl-more'); await page.waitForSelector('[data-imp-go=pick]');
  const opts = await page.evaluate(() => document.querySelector('.lmd-tl-card[data-tool=import] .lmd-tl-opts').textContent);
  check('sus opciones dicen qué convierte y que no se sube', /Word, Excel, PowerPoint, EPUB, PDF, HTML, CSV and TSV/.test(opts) && /not uploaded/.test(opts) && /Choose a file/.test(opts), opts);
  check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
  await page.click('[data-act=close-panel]'); await sleep(250);
  check('prendida: el botón aparece en el inicio y en el explorador', await page.evaluate(() => !!document.querySelector('.lmd-home-actions [data-import]') && !!document.querySelector('.lmd-zone-head .lmd-import-btn')));
  check('el botón del explorador tiene nombre', (await page.evaluate(() => document.querySelector('.lmd-import-btn').getAttribute('aria-label'))) === 'Import to Markdown');
  await toolsTab(page); await page.click('.lmd-tl-card[data-tool=import] .lmd-switch'); await sleep(300); await page.click('[data-act=close-panel]'); await sleep(250);
  check('apagarla saca los botones y el inicio queda como estaba', await page.evaluate(() => !document.querySelector('[data-import], .lmd-import-btn')) && (await page.evaluate(() => document.querySelector('.lmd-home-actions').innerHTML)) === before);
  check('pdf.js no se pidió en ningún momento', pdfHits.length === 0, pdfHits);
  await ctx.close();
});

// ---------- HTML ----------
await step('html', 'HTML a Markdown', async () => {
  const { ctx, page, pdfHits } = await open(ON);
  await home(page);
  const r = await conv(page, 'sample.html', HTML);
  check('títulos, formato, listas anidadas y de tareas, cita, código con su lenguaje, línea, tabla e imágenes', r.md === HTML_MD, r.md || r);
  check('sin navegación, estilos, scripts ni atributos', !!r.md && !/Home|About|color:red|__pwn|onclick|class=|Footer text|margin/.test(r.md.replace('Footer text', '')) && !/<script|<style|<nav/i.test(r.md), r.md);
  check('la imagen que no es de un tipo común se omite, con aviso', J(r.warnings) === J(['1 image left out.']), r.warnings);
  check('el nombre sale del archivo y el resumen cuenta palabras', r.name === 'sample' && r.units[0] === 'words' && r.units[1] > 30, [r.name, r.units]);
  const g = await conv(page, 'g.htm', '<meta charset="utf-8"><b style="font-weight:normal"><p><span style="font-weight:700">Heavy</span> <span style="font-style:italic">slanted</span> <span style="text-decoration:line-through">old</span> plain</p></b>');
  check('lo pegado desde un editor: el formato que va por estilo también cuenta', g.md === '**Heavy** *slanted* ~~old~~ plain\n', g.md || g);
  const lay = await conv(page, 'l.html', '<table><tr><td><table><tr><td><h2>Inside</h2><p>Text</p></td></tr></table></td></tr></table><div><div><p>Tail</p></div></div>');
  check('una tabla que arma la página no sale como tabla', lay.md === '## Inside\n\nText\n\nTail\n', lay.md || lay);
  const latin = await conv(page, 'latin.html', Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>caf', 'latin1'), Buffer.from([0xE9]), Buffer.from('</p>', 'latin1')]));
  check('respeta el juego de caracteres que declara la página', latin.md === 'café\n', latin.md || latin);
  const pasted = await page.evaluate(async () => { try { return await LMD.import.convert(new File([''], 'x.html'), { kind: 'html', html: '<title>From the web</title><h2>Hi</h2><p>There</p>' }); } catch (e) { return { error: e.code }; } });
  check('HTML que no viene de un archivo: se convierte y toma el título como nombre', pasted.md === '## Hi\n\nThere\n' && pasted.name === 'From the web', pasted);
  check('convertir HTML no pide pdf.js', pdfHits.length === 0, pdfHits);
  await ctx.close();
});

// ---------- XSS ----------
await step('xss', 'Un HTML hostil no corre nada', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const r = await conv(page, 'evil.html', EVIL);
  check('los enlaces javascript:, data: y vbscript: se descartan; el bueno queda', !!r.md && !/\]\((javascript|data|vbscript)/i.test(r.md.replace(/\\\]\(/g, '')) && /\[fine\]\(https:\/\/ok\.example\/\)/.test(r.md) && /js tab space data vb/.test(r.md), r.md || r);
  check('el texto que parece HTML o Markdown queda escapado', /\\<img src=x onerror=/.test(r.md) && /\\<script>/.test(r.md) && /\\\[md\\\]\(javascript/.test(r.md) && !/(^|[^\\])<(script|iframe|svg|object|img)/i.test(r.md), r.md);
  check('avisa los enlaces descartados y la imagen omitida', r.warnings.some((w) => /links dropped/.test(w)) && r.warnings.some((w) => /left out/.test(w)), r.warnings);
  // Por la interfaz, hasta la nota abierta: nada del archivo llega a la página como HTML.
  await choose(page, file('evil.html', EVIL, 'text/html')); await finished(page);
  check('durante la conversión no corrió nada del archivo', await page.evaluate(() => window.__pwn === undefined && !document.querySelector('.lmd-imp script, .lmd-imp img, .lmd-imp a')));
  await page.click('[data-imp=new]'); await page.waitForSelector('.lmd-article h1'); await sleep(500);
  const dom = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); return { pwn: window.__pwn, scripts: a.querySelectorAll('script, iframe, object, svg').length, js: [...a.querySelectorAll('a')].filter((x) => /^(javascript|data|vbscript):/i.test(x.getAttribute('href') || '')).length,
    on: [...a.querySelectorAll('*')].filter((n) => [...n.attributes].some((t) => /^on/i.test(t.name))).length, imgs: [...a.querySelectorAll('img')].map((i) => i.getAttribute('src')), links: [...a.querySelectorAll('a[href^=http]')].map((x) => x.getAttribute('href')), text: a.innerText }; });
  check('abierta como nota: sin scripts, sin enlaces peligrosos, sin atributos de eventos, y nada corrió', dom.pwn === undefined && dom.scripts === 0 && dom.js === 0 && dom.on === 0 && J(dom.imgs) === J(['x']) && J(dom.links) === J(['https://ok.example/']), dom);
  check('lo que era texto se lee como texto', /<img src=x onerror=/.test(dom.text) && /<script>window\.__pwn = 1<\/script>/.test(dom.text) && /\[md\]\(javascript:window\.__pwn=1\)/.test(dom.text), dom.text);
  const c = await conv(page, 'x.csv', 'a,b\n<img src=x onerror="window.__pwn=1">,[k](javascript:window.__pwn=1)\n');
  check('un CSV con HTML en una celda sale escapado', /\\<img src=x/.test(c.md) && /\\\[k\\\]\(javascript/.test(c.md), c.md || c);
  await ctx.close();
});

// ---------- CSV y TSV ----------
await step('csv', 'CSV y TSV a una tabla', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const r = await conv(page, 'data.csv', CSV);
  check('comas, comillas, comillas dobladas, saltos dentro de una celda y la barra escapada', r.md === CSV_MD && J(r.units) === J(['rows', 3]), r.md || r);
  const semi = await conv(page, 's.csv', 'a;b;c\n1,5;2;3\n');
  check('detecta el punto y coma', semi.md === '| a | b | c |\n| --- | --- | --- |\n| 1,5 | 2 | 3 |\n', semi.md || semi);
  const tsv = await conv(page, 't.tsv', 'a\tb\n1, 2\t3\n');
  check('un .tsv va por tabulaciones', tsv.md === '| a | b |\n| --- | --- |\n| 1, 2 | 3 |\n', tsv.md || tsv);
  const tab = await conv(page, 'tab.csv', 'a\tb\tc\n1\t2\t3\n');
  check('y un .csv con tabulaciones también', tab.md === '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n', tab.md || tab);
  const bom = await conv(page, 'b.csv', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('año,ok\n1,2\n', 'utf8')]));
  check('con marca de orden y acentos', bom.md === '| año | ok |\n| --- | --- |\n| 1 | 2 |\n', bom.md || bom);
  await limits(page, { rows: 5, cols: 3 });
  const big = await conv(page, 'big.csv', 'a,b,c,d,e\n' + Array.from({ length: 20 }, (x, i) => i + ',x,y,z,w').join('\n') + '\n');
  check('por encima del tope corta y dice cuántas filas y columnas quedaron afuera', !!big.md && big.md.split('\n').length === 8 && J(big.warnings) === J(['Tables cut: 15 rows were left out.', 'Tables cut: 2 columns were left out.']) && J(big.units) === J(['rows', 5]), [big.md, big.warnings, big.units]);
  const none = await conv(page, 'e.csv', '\n\n');
  check('un CSV vacío se dice', none.error === 'empty', none);
  await ctx.close();
});

// ---------- Word ----------
await step('docx', 'Word a Markdown', async () => {
  const { ctx, page } = await open({ tools: { import: true, docx: true } });
  await home(page);
  const r = await conv(page, 'plan.docx', DOCX);
  check('títulos por estilo y por nivel, formato, enlace, listas con niveles, tabla, código y cita', r.md === DOCX_MD, r.md || r);
  check('el enlace javascript: del documento se descarta, con aviso', J(r.warnings) === J(['1 link dropped.']), r.warnings);
  // Ida y vuelta con el Word que exporta la app: lo que sale de docx.js vuelve a ser la misma nota.
  const SRC = ['# Round trip', '', 'A paragraph with **bold**, *italic* and `code`, and a [link](https://example.com/).', '', '## List', '', '- One', '- Two', '', '1. First', '2. Second', '', '- [x] Done', '- [ ] Todo', '', '> A quote', '', '```js', 'let a = 1;', '```', '', '| H1 | H2 |', '| --- | --- |', '| a | b |', ''].join('\n');
  await note(page, 'rt.md', SRC); await ready(page); await page.waitForFunction(() => !!LMD.docx);
  const back = await page.evaluate(async () => { try { const bytes = await LMD.docx.bytes(); return await LMD.import.convert(new File([bytes], 'rt.docx')); } catch (e) { return { error: e.code || String(e) }; } });
  const want = SRC.replace('```js', '```'); // el Word no guarda el lenguaje del bloque
  check('ida y vuelta con el Word que exporta la app', back.md === want, back.md || back);
  await ctx.close();
});

// ---------- Excel ----------
await step('xlsx', 'Excel a Markdown', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const r = await conv(page, 'book.xlsx', XLSX);
  check('una sección por hoja: valores calculados, fechas legibles, porcentaje, sin fórmulas ni hojas ocultas', r.md === XLSX_MD && J(r.units) === J(['sheets', 2]), r.md || r);
  check('ni fórmulas ni la hoja oculta', !!r.md && !/SUM|CONCAT|hidden value|Secret/.test(r.md));
  await ctx.close();
});

// ---------- PowerPoint ----------
await step('pptx', 'PowerPoint a Markdown', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const r = await conv(page, 'deck.pptx', PPTX);
  check('una sección por diapositiva con su título, viñetas con niveles, tabla y las notas como cita', r.md === PPTX_MD && J(r.units) === J(['slides', 2]), r.md || r);
  check('la imagen de la diapositiva se cuenta como omitida', J(r.warnings) === J(['1 image left out.']), r.warnings);
  await ctx.close();
});

// ---------- EPUB ----------
await step('epub', 'EPUB a Markdown', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const r = await conv(page, 'book.epub', EPUB);
  check('el título del libro y cada capítulo como sección, por el conversor de HTML', r.md === EPUB_MD && J(r.units) === J(['chapters', 2]), r.md || r);
  check('el script del capítulo no corre, y la imagen y el enlace de adentro del libro no quedan', (await page.evaluate(() => window.__pwn)) === undefined && J(r.warnings) === J(['1 image left out.']), r.warnings);
  await ctx.close();
});

// ---------- PDF ----------
await step('pdf', 'PDF a Markdown, con pdf.js pedido recién ahí', async () => {
  const { ctx, page, pdfHits } = await open(ON);
  const csp = []; page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await home(page);
  await conv(page, 'a.csv', 'a,b\n1,2\n'); await conv(page, 'a.docx', DOCX);
  check('pdf.js no se pide al cargar la app ni al convertir otros formatos', pdfHits.length === 0 && await page.evaluate(() => !LMD.import.pdfLoaded()), pdfHits);
  const r = await conv(page, 'report.pdf', PDF);
  check('texto por página: títulos por tamaño, párrafos, palabra cortada, listas y la línea entre páginas', r.md === PDF_MD && J(r.units) === J(['pages', 2]), r.md || r);
  check('el número de página suelto no entra', !!r.md && !/^\d$/m.test(r.md));
  check('recién ahí se pidió pdf.js: su código y su trabajador, de la propia app', pdfHits.includes('pdf.min.js') && pdfHits.includes('pdf.worker.min.js') && pdfHits.every((h) => /^pdf\.(worker\.)?min\.js$/.test(h)), pdfHits);
  check('el trabajador de pdf.js corre de verdad, sin romper la política de contenido', r.worker === true && csp.length === 0, [r.worker, csp]);
  const scan = await conv(page, 'scan.pdf', SCAN);
  check('un PDF sin texto se dice, sin OCR', scan.error === 'pdf_empty', scan);
  await limits(page, { pages: 2 });
  const cut = await conv(page, 'six.pdf', PDF6);
  check('por encima del tope de páginas convierte el principio y avisa', !!cut.md && /Page number 2/.test(cut.md) && !/Page number 3/.test(cut.md) && J(cut.warnings) === J(['Only the beginning was converted: 2 of 6.']), [cut.md, cut.warnings]);
  await limits(page, { pages: 300 });
  const bad = await conv(page, 'bad.pdf', Buffer.from('%PDF-1.4\nthis is not really a pdf at all\n'));
  check('un PDF dañado se dice', bad.error === 'bad', bad);
  const fake = await conv(page, 'fake.pdf', Buffer.from('hello'));
  check('y uno que no es PDF ni llega a pdf.js', fake.error === 'bad', fake);
  // Por la interfaz: el aviso corto de un PDF escaneado.
  await choose(page, file('scan.pdf', SCAN, 'application/pdf')); await finished(page);
  const d = await dlg(page);
  check('el diálogo dice que el PDF no tiene texto', d.err === 'This PDF has no text. It looks scanned.' && J(d.buttons) === J(['Close']) && d.focus === 'Close', d);
  await page.keyboard.press('Escape'); await sleep(300);
  check('Escape lo cierra', await page.evaluate(() => !document.querySelector('.lmd-imp')));
  await ctx.close();
});

// ---------- La interfaz: avance, resumen, nota nueva y agregar ----------
await step('ui', 'El diálogo: avance, resumen y qué hacer con el resultado', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  await limits(page, { pace: 60 });
  // Se anota cada cambio de las barras mientras dura.
  await page.evaluate(() => { window.__seen = []; new MutationObserver(() => { const box = document.querySelector('.lmd-imp'); if (!box) return; const b = [...box.querySelectorAll('.lmd-imp-bar')].map((x) => Number(x.getAttribute('aria-valuenow'))); const n = box.querySelector('[data-stage=convert] .lmd-imp-n').textContent; const last = window.__seen[window.__seen.length - 1]; const row = [b[0], b[1], n]; if (!last || last.join() !== row.join()) window.__seen.push(row); }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
  await choose(page, file('six.pdf', PDF6, 'application/pdf'));
  const start = await dlg(page);
  check('el diálogo: con nombre, modal, dos barras con su papel y el foco en Cancelar', start.title === 'Import to Markdown' && start.modal === 'true' && start.name === 'six.pdf' && J(start.bars.map((b) => [b.role, b.min, b.max, b.label])) === J([['progressbar', '0', '100', 'Loading'], ['progressbar', '0', '100', 'Converting']]) && start.focus === 'Cancel', start);
  await finished(page);
  const seen = await page.evaluate(() => window.__seen);
  const load = seen.map((s) => s[0]); const convert = seen.map((s) => s[1]); const counts = seen.map((s) => s[2]).filter((t) => /of 6/.test(t));
  check('primero avanza Cargando, después Convirtiendo, y ninguna vuelve atrás', load.some((v) => v > 0 && v < 100) && load.every((v, i) => !i || v >= load[i - 1]) && convert.every((v, i) => !i || v >= convert[i - 1]) && seen.findIndex((s) => s[1] > 0) > seen.findIndex((s) => s[0] > 0), seen.slice(0, 14));
  check('Convirtiendo cuenta las páginas de a una', J([...new Set(counts)]) === J(['0 of 6', '1 of 6', '2 of 6', '3 of 6', '4 of 6', '5 of 6', '6 of 6']), counts);
  const end = await dlg(page);
  check('al final: las barras llenas, el resumen, y el foco en abrir la nota', J(end.bars.map((b) => b.now)) === J([100, 100]) && end.sum === '6 pages converted' && end.focus === 'Open as a new note' && J(end.buttons) === J(['Close', 'Open as a new note']), end);
  check('el avance se anuncia con moderación y el resumen también', /6 pages converted/.test(end.live) && end.bars[1].text === '6 of 6', [end.live, end.bars[1]]);
  check('los textos no llevan signos de admiración ni rayas', (await texts(page)).length === 0, await texts(page));
  await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-article p'); await sleep(400);
  const opened = await page.evaluate(async () => ({ gone: !document.querySelector('.lmd-imp'), url: decodeURIComponent(location.search), name: document.querySelector('.lmd-docname').textContent, saved: (await LMD.store.noteList ? (await LMD.store.noteList()).length : -1), text: document.querySelector('.lmd-article').innerText }));
  check('abre como nota nueva, con el nombre del archivo', opened.gone && /mem\/six\.md/.test(opened.url) && opened.name === 'six.md' && /Page number 1 has some text\./.test(opened.text) && /Page number 6/.test(opened.text), opened);
  const state = await page.evaluate(async () => ({ stored: !!(await LMD.store.noteGet('six.md')), status: (document.querySelector('.lmd-status') || {}).textContent, save: (document.querySelector('[data-act=save]') || {}).title || '' }));
  check('sin guardar: no está en las notas del navegador y la app la marca con cambios', state.stored === false && /unsaved|Save as/i.test(state.status + ' ' + state.save), state);
  await limits(page, { pace: 0 });
  // Con una nota abierta: el botón del explorador, y agregar al final.
  await note(page, 'n.md', '# Hello\n\nText.\n'); await ready(page); await page.waitForSelector('.lmd-import-btn');
  await choose(page, file('data.csv', CSV, 'text/csv'), '.lmd-import-btn'); await finished(page);
  const d2 = await dlg(page);
  check('con una nota abierta ofrece agregar a ella', d2.sum === '3 rows converted' && J(d2.buttons) === J(['Close', 'Add to the open note', 'Open as a new note']), d2);
  await page.click('[data-imp=insert]'); await page.waitForSelector('.lmd-article table'); await sleep(300);
  const ins = await page.evaluate(() => { const a = document.querySelector('.lmd-article'); return { h1: a.querySelector('h1').textContent.replace('#', '').trim(), order: [...a.children].map((n) => n.tagName === 'DIV' && n.querySelector('table') ? 'TABLE' : n.tagName).join(','), cells: a.querySelectorAll('td').length, name: document.querySelector('.lmd-docname').textContent }; });
  check('la tabla queda al final de la misma nota', ins.h1 === 'Hello' && /^H1,P,TABLE(,DIV)?$/.test(ins.order) && ins.cells === 9 && ins.name === 'n.md', ins);
  check('y avisa dónde quedó', /Added at the end of the note/.test(await flashText(page)), await flashText(page));
  // Cerrar sin elegir no toca nada.
  await choose(page, file('data.csv', CSV, 'text/csv'), '.lmd-import-btn'); await finished(page);
  await page.click('[data-imp=cancel]'); await sleep(300);
  check('Cerrar no agrega nada', await page.evaluate(() => !document.querySelector('.lmd-imp') && document.querySelectorAll('.lmd-article table').length === 1));
  // Soltar, abrir y pegar.
  await home(page);
  await page.evaluate((csv) => { const dt = new DataTransfer(); dt.items.add(new File([csv], 'dropped.csv', { type: 'text/csv' })); const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(over); window.__over = over.defaultPrevented; document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, CSV);
  await page.waitForSelector('.lmd-imp'); await finished(page);
  check('soltar un archivo de los que convierte ofrece convertirlo', (await dlg(page)).name === 'dropped.csv' && (await dlg(page)).sum === '3 rows converted' && await page.evaluate(() => window.__over === true), await dlg(page));
  await page.click('[data-imp=cancel]'); await sleep(250);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['# hi\n'], 'plain.md', { type: 'text/markdown' })); const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); window.__mine = true; window.addEventListener('drop', () => { window.__reached = true; }, { once: true }); document.body.dispatchEvent(e); });
  await sleep(300);
  check('soltar un Markdown sigue su camino de siempre', await page.evaluate(() => !document.querySelector('.lmd-imp') && window.__reached === true));
  await home(page);
  await page.evaluate((csv) => { window.showOpenFilePicker = async () => [{ kind: 'file', name: 'picked.csv', getFile: async () => new File([csv], 'picked.csv', { type: 'text/csv' }) }]; }, CSV);
  await page.click('[data-home=file]'); await page.waitForSelector('.lmd-imp'); await finished(page);
  check('abrir uno de esos archivos con "Abrir archivo" también', (await dlg(page)).name === 'picked.csv', await dlg(page));
  await page.click('[data-imp=cancel]'); await sleep(250);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/html', '<title>Clip</title><h2>Pasted title</h2><p>Pasted <b>text</b></p>'); dt.setData('text/plain', 'Pasted title'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await page.waitForSelector('.lmd-imp'); await finished(page);
  await page.click('[data-imp=new]'); await page.waitForSelector('.lmd-article h2'); await sleep(300);
  check('pegar HTML en el inicio lo convierte', await page.evaluate(() => document.querySelector('.lmd-article h2').textContent.replace('#', '').trim() === 'Pasted title' && !!document.querySelector('.lmd-article strong') && document.querySelector('.lmd-docname').textContent === 'Clip.md'), await article(page));
  await ctx.close();
});

// ---------- Cancelar ----------
await step('cancel', 'Cancelar corta el trabajo', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  await limits(page, { pace: 250 });
  await page.evaluate(() => { window.__steps = []; new MutationObserver(() => { const n = document.querySelector('.lmd-imp [data-stage=convert] .lmd-imp-n'); if (n && n.textContent && window.__steps[window.__steps.length - 1] !== n.textContent) window.__steps.push(n.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  await choose(page, file('six.pdf', PDF6, 'application/pdf'));
  await page.waitForFunction(() => /^[12] of 6$/.test(document.querySelector('.lmd-imp [data-stage=convert] .lmd-imp-n').textContent), null, { timeout: 20000 });
  await page.click('[data-imp=cancel]');
  check('el diálogo se cierra enseguida', await page.evaluate(() => !document.querySelector('.lmd-imp')));
  const freed = await until(() => page.evaluate(() => !LMD.import.busy()), 3000);
  await sleep(1200);
  const after = await page.evaluate(() => ({ steps: window.__steps, home: !!document.querySelector('.lmd-home:not([hidden])'), dlg: !!document.querySelector('.lmd-imp'), focus: (document.activeElement && document.activeElement.tagName) || '' }));
  check('el trabajo se corta: no siguen las páginas ni se abre nada', freed === true && !after.steps.includes('4 of 6') && !after.steps.includes('6 of 6') && after.home && !after.dlg, after);
  check('sin avisos de error: cancelar no es una falla', await page.evaluate(() => { const m = document.querySelector('.lmd-home-msg'); return !m || m.hidden || !m.textContent; }));
  // Escape hace lo mismo, y después se puede volver a importar.
  await choose(page, file('six.pdf', PDF6, 'application/pdf'));
  await page.waitForFunction(() => /^[12] of 6$/.test(document.querySelector('.lmd-imp [data-stage=convert] .lmd-imp-n').textContent), null, { timeout: 20000 });
  await page.keyboard.press('Escape');
  const gone = await until(() => page.evaluate(() => !document.querySelector('.lmd-imp') && !LMD.import.busy()), 3000);
  check('Escape cancela', gone === true);
  await limits(page, { pace: 0 });
  await choose(page, file('six.pdf', PDF6, 'application/pdf')); await finished(page);
  check('después de cancelar se puede importar de nuevo', (await dlg(page)).sum === '6 pages converted', await dlg(page));
  await page.click('[data-imp=cancel]'); await sleep(200);
  // Con una nota abierta, cancelar se dice en el pie.
  await note(page, 'n.md', '# Hello\n'); await ready(page); await page.waitForSelector('.lmd-import-btn');
  await limits(page, { pace: 250 });
  await choose(page, file('six.pdf', PDF6, 'application/pdf'), '.lmd-import-btn');
  await page.waitForFunction(() => /^[12] of 6$/.test(document.querySelector('.lmd-imp [data-stage=convert] .lmd-imp-n').textContent), null, { timeout: 20000 });
  await page.click('[data-imp=cancel]');
  const said = await until(async () => /Import cancelled/.test(await flashText(page)), 3000);
  check('con una nota abierta lo dice en el pie, y la nota no cambia', said === true && await page.evaluate(() => document.querySelectorAll('.lmd-article p').length === 0 && document.querySelector('.lmd-article h1').textContent.replace('#', '').trim() === 'Hello'));
  await ctx.close();
});

// ---------- Archivos que no sirven ----------
await step('bad', 'Archivo inválido', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const junk = Buffer.from('this is not a zip file at all, just some text that says so');
  for (const name of ['x.docx', 'x.xlsx', 'x.pptx', 'x.epub']) check(name + ' que no es un zip: se dice', (await conv(page, name, junk)).error === 'bad');
  check('un zip que no es Word', (await conv(page, 'x.docx', zip({ 'hello.txt': 'hi' }))).error === 'bad');
  check('un Word con el XML roto', (await conv(page, 'x.docx', zip({ 'word/document.xml': '<w:document><w:body><w:p>' }))).error === 'bad');
  check('un zip cortado por la mitad', (await conv(page, 'x.docx', DOCX.subarray(0, DOCX.length - 40))).error === 'bad');
  check('un tipo que no se convierte', (await conv(page, 'x.zip', junk)).error === 'type' && (await conv(page, 'notes.txt', junk)).error === 'type' && (await conv(page, 'data.json', junk)).error === 'type');
  check('un HTML sin texto', (await conv(page, 'e.html', '<html><body><script>1</script></body></html>')).error === 'empty');
  check('lo que la herramienta acepta: ni .txt ni .json ni .yaml', await page.evaluate(() => LMD.import.accept === '.docx,.xlsx,.pptx,.epub,.pdf,.html,.htm,.csv,.tsv' && !LMD.import.takes('a.txt') && !LMD.import.takes('a.json') && !LMD.import.takes('a.yaml') && !LMD.import.takes('a.md') && LMD.import.takes('A.PDF')));
  await choose(page, file('broken.docx', junk)); await finished(page);
  const d = await dlg(page);
  check('el diálogo lo dice y deja solo Cerrar, con el foco ahí', d.err === 'The file is damaged or is not what its name says.' && J(d.buttons) === J(['Close']) && d.focus === 'Close' && d.sum === '', d);
  check('el aviso es una alerta para lectores de pantalla', await page.evaluate(() => document.querySelector('.lmd-imp-err').getAttribute('role') === 'alert'));
  await page.click('[data-imp=cancel]'); await sleep(250);
  check('y al cerrarlo todo sigue igual', await page.evaluate(() => !document.querySelector('.lmd-imp') && !!document.querySelector('.lmd-home:not([hidden])') && !LMD.import.busy()));
  await ctx.close();
});

// ---------- Topes ----------
await step('limits', 'Topes de tamaño', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const def = await page.evaluate(() => LMD.import.limits);
  check('los topes de fábrica: 50 MB por archivo, 300 páginas, 2000 filas', def.file === 50 * 1024 * 1024 && def.pages === 300 && def.rows === 2000 && def.entries === 5000 && def.pace === 0, def);
  await limits(page, { file: 2000, text: 1000 });
  check('un archivo más pesado que el tope no se lee', (await conv(page, 'big.docx', Buffer.alloc(2001))).error === 'big' && (await conv(page, 'big.csv', Buffer.alloc(1001, 97))).error === 'big');
  await choose(page, file('big.pdf', Buffer.alloc(4000, 32), 'application/pdf')); await finished(page);
  check('y el diálogo dice cuánto es el tope', /The file is larger than \d+ MB\./.test((await dlg(page)).err), await dlg(page));
  await page.click('[data-imp=cancel]');
  await limits(page, { file: 50 * 1024 * 1024, text: 20 * 1024 * 1024, out: 200 });
  const long = await conv(page, 'long.csv', 'a,b\n' + Array.from({ length: 60 }, (x, i) => 'row' + i + ',value').join('\n') + '\n');
  check('un resultado enorme se corta en un renglón entero y se avisa', !!long.md && long.md.length <= 201 && /\|\n$/.test(long.md) && long.warnings.includes('The text was cut because of its size.'), [long.md && long.md.length, long.warnings]);
  await ctx.close();
});

await step('zip', 'Un zip malicioso no cuelga', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  const docWith = (inner) => X + '<w:document ' + W + '><w:body>' + inner + '</w:body></w:document>';
  await limits(page, { entry: 1024 * 1024, unzip: 3 * 1024 * 1024 });
  // Una bomba: 6 MB de espacios que comprimidos son unos pocos KB.
  const bomb = docWith(wp(wr('x'.repeat(10))) + ' '.repeat(6 * 1024 * 1024));
  const t0 = Date.now();
  const honest = await conv(page, 'bomb.docx', zip({ 'word/document.xml': bomb }));
  check('una bomba que dice su tamaño: se rechaza sin descomprimir', honest.error === 'zip_big', honest);
  const liar = await conv(page, 'liar.docx', zip({ 'word/document.xml': bomb }, { lie: { 'word/document.xml': 500 } }));
  check('una que miente en el índice: se corta al pasarse', liar.error === 'zip_big', liar);
  const many = {}; for (let i = 0; i < 12; i++) many['word/part' + i + '.xml'] = ' '.repeat(400 * 1024);
  many['word/document.xml'] = docWith(wp(wr('ok')));
  check('muchas partes que juntas pasan el tope', (await conv(page, 'sum.docx', zip(many))).error === 'zip_big');
  check('y todo eso en poco tiempo', Date.now() - t0 < 8000, Date.now() - t0);
  await limits(page, { entry: 64 * 1024 * 1024, unzip: 256 * 1024 * 1024, entries: 20 });
  const lots = {}; for (let i = 0; i < 30; i++) lots['f' + i + '.xml'] = 'x';
  check('demasiadas entradas', (await conv(page, 'lots.docx', zip(lots))).error === 'zip_big');
  await limits(page, { entries: 5000 });
  // Rutas raras: no se leen, así que un documento que solo existe ahí no existe.
  for (const name of ['../word/document.xml', '/word/document.xml', 'word\\document.xml', 'C:/word/document.xml', 'word/../../document.xml']) {
    const files = {}; files[name] = docWith(wp(wr('escaped')));
    const r = await conv(page, 'path.docx', zip(files));
    check('la ruta ' + name + ' no se lee', r.error === 'bad', r);
  }
  const ent = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><w:document ' + W + '><w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>';
  check('un XML con entidades propias se rechaza', (await conv(page, 'ent.docx', zip({ 'word/document.xml': ent }))).error === 'bad');
  check('la pestaña sigue viva y la herramienta libre', await page.evaluate(() => 1 + 1 === 2 && !LMD.import.busy()) && (await conv(page, 'ok.docx', DOCX)).md === DOCX_MD);
  await ctx.close();
});

// ---------- En la página de la extensión ----------
await step('ext', 'En la extensión: bajo su política de contenido', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdimp-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=en-US'] });
  try {
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host; const app = 'chrome-extension://' + id + '/src/app.html';
    const page = await ctx.newPage(); const errors = []; const csp = []; const hits = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
    page.on('request', (r) => { if (/\/vendor\/pdfjs\//.test(r.url())) hits.push(r.url()); });
    await page.goto(app); await page.waitForSelector('.lmd-home');
    await page.evaluate(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    const policy = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_security_policy.extension_pages;
    check('la política de la extensión no cambió: sin eval ni código remoto', policy === "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'", policy);
    await page.evaluate(() => LMD.tools.set('import', true)); await page.waitForFunction(() => !!LMD.import && LMD.tools.isOn('import')); await page.waitForSelector('[data-import]');
    check('prendida en la extensión, pdf.js todavía no se pidió', hits.length === 0, hits);
    const h = await conv(page, 'sample.html', HTML);
    check('convierte HTML', h.md === HTML_MD, h.md || h);
    const z = await conv(page, 'book.xlsx', XLSX);
    check('abre un zip (Excel)', z.md === XLSX_MD, z.md || z);
    const p = await conv(page, 'report.pdf', PDF);
    check('convierte un PDF', p.md === PDF_MD, p.md || p);
    check('pdf.js y su trabajador salen de la propia extensión', hits.length >= 2 && hits.every((u) => u.startsWith('chrome-extension://' + id + '/vendor/pdfjs/')), hits);
    check('el trabajador corre de verdad', p.worker === true, p.worker);
    const viol = await page.evaluate(() => window.__csp);
    check('sin violaciones de la política de contenido ni errores', viol.length === 0 && csp.length === 0 && errors.length === 0, [viol, csp, errors]);
    // Por la interfaz, de punta a punta.
    await choose(page, file('report.pdf', PDF, 'application/pdf')); await finished(page);
    check('el diálogo termina con su resumen', (await dlg(page)).sum === '2 pages converted', await dlg(page));
    await page.click('[data-imp=new]'); await page.waitForSelector('.lmd-article h1'); await sleep(300);
    check('y la nota se abre en la extensión', await page.evaluate(() => document.querySelector('.lmd-article h1').textContent.replace('#', '').trim() === 'Annual Report' && document.querySelectorAll('.lmd-article li').length === 4), await article(page));
    check('el paquete de la extensión lleva pdf.js con su licencia', ['pdf.min.js', 'pdf.worker.min.js', 'LICENSE'].every((f) => fs.existsSync(path.join(root, 'vendor', 'pdfjs', f))) && !/^\/vendor/m.test(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')));
  } finally { await ctx.close(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ } }
});

// ---------- En un teléfono ----------
await step('phone', 'En un teléfono', async () => {
  const { ctx, page } = await open({ tools: { import: true }, ctx: SMALL });
  await note(page, 'n.md', '# Hello\n\nText.\n'); await ready(page);
  await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
  const inMore = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-more [data-more]')].map((b) => b.dataset.more + ':' + b.textContent));
  check('en pantalla chica, importar está en el menú de más', inMore.includes('import-md:Import to Markdown'), inMore);
  await limits(page, { pace: 80 });
  await choose(page, file('a-very-long-file-name-that-keeps-going-and-going-until-it-needs-to-wrap-on-a-narrow-screen.pdf', PDF6, 'application/pdf'), '.lmd-menu-more [data-more=import-md]');
  const fit = () => page.evaluate(() => { const c = document.querySelector('.lmd-imp-card').getBoundingClientRect(); const bs = [...document.querySelectorAll('.lmd-imp .lmd-ask-actions button')].filter((b) => !b.hidden).map((b) => b.getBoundingClientRect()); return { card: c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight, page: document.documentElement.scrollWidth <= innerWidth, tap: bs.every((b) => b.height >= 36 && b.right <= innerWidth), bar: document.querySelector('.lmd-imp-bar').getBoundingClientRect().width > 200 }; });
  check('mientras trabaja: entra en la pantalla, el nombre largo baja de renglón y Cancelar se puede tocar', J(await fit()) === J({ card: true, page: true, tap: true, bar: true }), await fit());
  await finished(page);
  check('con el resumen y sus botones también entra', J(await fit()) === J({ card: true, page: true, tap: true, bar: true }), await fit());
  await page.tap('[data-imp=new]'); await page.waitForSelector('.lmd-article p');
  check('y la nota se abre', /Page number 1/.test(await article(page)));
  await ctx.close();
});

// ---------- Los doce temas ----------
await step('themes', 'El diálogo se lee en los doce temas', async () => {
  const { ctx, page } = await open(ON);
  await home(page);
  await limits(page, { rows: 2 });
  await choose(page, file('data.csv', CSV, 'text/csv')); await finished(page);
  const ids = await page.evaluate(() => LMD.theme.PRESETS.map((p) => p.id));
  const bad = [];
  for (const id of ids) {
    await page.evaluate((i) => LMD.patch(LMD.theme.patchFor(i)), id); await sleep(220);
    const c = await page.evaluate(() => {
      const probe = document.createElement('canvas').getContext('2d');
      const rgb = (v) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = v; probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(rgb(a)); const y = lum(rgb(b)); return Math.round(10 * (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) / 10; };
      const css = (s, p) => getComputedStyle(document.querySelector(s))[p || 'color']; const bg = css('.lmd-imp-card', 'backgroundColor');
      return { title: ratio(css('.lmd-imp-card h3'), bg), name: ratio(css('.lmd-imp-name'), bg), count: ratio(css('.lmd-imp-n'), bg), sum: ratio(css('.lmd-imp-sum'), bg), warn: ratio(css('.lmd-imp-warn li'), bg), fill: ratio(css('.lmd-imp-bar i', 'backgroundColor'), bg), dialog: !!document.querySelector('.lmd-imp') };
    });
    ['title', 'name', 'count', 'sum', 'warn'].forEach((k) => { if (c[k] < 4.5) bad.push(id + ':' + k + '=' + c[k]); });
    if (c.fill < 3 || !c.dialog) bad.push(id + ':fill=' + c.fill);
  }
  check('hay doce temas y en todos el texto, los avisos y la barra contrastan con el fondo', ids.length >= 12 && bad.length === 0, [ids.length, bad]);
  await ctx.close();
});

// ---------- La pestaña Herramientas, con diez tarjetas ----------
await step('tab', 'Ajustes > Herramientas desliza bien con diez tarjetas', async () => {
  for (const small of [false, true]) {
    const { ctx, page } = await open(small ? { ctx: SMALL } : {});
    await note(page, 'n.md', '# Hello\n\nText.\n');
    if (small) { await page.tap('[data-act=more]'); await page.tap('.lmd-menu-more [data-more=settings]'); } else await page.click('[data-act=settings]');
    await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card'); await sleep(300);
    const where = small ? 'en un teléfono' : 'en escritorio';
    const m = await page.evaluate(async () => {
      const body = document.querySelector('.lmd-panel-body'); const cards = [...document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card')];
      const box = () => body.getBoundingClientRect(); const inside = (n) => { const r = n.getBoundingClientRect(); const b = box(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1 && r.height > 30; };
      const out = { cards: cards.length, scrolls: body.scrollHeight > body.clientHeight, over: getComputedStyle(body).overflowY, pageFixed: document.documentElement.scrollHeight <= innerHeight + 1, reach: [], focus: [], cut: [] };
      // Cada tarjeta se puede traer a la vista entera con el scroll del propio diálogo.
      for (const c of cards) { c.scrollIntoView({ block: 'nearest' }); await new Promise((r) => requestAnimationFrame(r)); if (!inside(c)) out.reach.push(c.dataset.tool); if (c.scrollWidth > c.clientWidth + 1) out.cut.push(c.dataset.tool); }
      // Y con el teclado: el foco en su interruptor la trae sola.
      body.scrollTop = 0;
      for (const c of cards) { const i = c.querySelector('input[data-tool-on]'); if (i.disabled) continue; i.focus(); await new Promise((r) => requestAnimationFrame(r)); const r = i.getBoundingClientRect(); const b = box(); if (r.top < b.top - 1 || r.bottom > b.bottom + 1) out.focus.push(c.dataset.tool); }
      body.scrollTop = body.scrollHeight; await new Promise((r) => requestAnimationFrame(r));
      const last = [...body.querySelectorAll('.lmd-tl-card, .lmd-gal')].filter((n) => n.offsetParent).pop(); const lr = last.getBoundingClientRect();
      out.end = lr.bottom <= box().bottom + 1; out.width = body.scrollWidth <= body.clientWidth + 1;
      return out;
    });
    check(where + ': las diez tarjetas, y la pestaña desliza con el scroll del diálogo, no con el de la página', m.cards === 10 && m.scrolls && /auto|scroll/.test(m.over) && m.pageFixed, m);
    check(where + ': cada tarjeta se puede ver entera, sin cortes a lo ancho', m.reach.length === 0 && m.cut.length === 0 && m.width, [m.reach, m.cut, m.width]);
    check(where + ': con el teclado, el foco trae cada interruptor a la vista', m.focus.length === 0, m.focus);
    check(where + ': al final del scroll se ve el final de la lista', m.end === true, m);
    // Con las opciones de la herramienta abiertas, al fondo de la lista, también se llega.
    await page.evaluate(() => LMD.tools.set('import', true)); await page.waitForFunction(() => !!LMD.import);
    await page.click('[data-ptab=look]'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card[data-tool=import] .lmd-tl-more:not([hidden])');
    await page.evaluate(() => document.querySelector('.lmd-tl-card[data-tool=import] .lmd-tl-more').scrollIntoView({ block: 'nearest' }));
    await page.evaluate((q) => { const b = document.querySelector(q); if (b.getAttribute('aria-expanded') !== 'true') b.click(); }, '.lmd-tl-card[data-tool=import] .lmd-tl-more'); await page.waitForSelector('[data-imp-go=pick]');
    const o = await page.evaluate(() => { const b = document.querySelector('[data-imp-go=pick]'); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); const box = document.querySelector('.lmd-panel-body').getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.right <= box.right + 1 && r.height >= 28; });
    check(where + ': las opciones de la tarjeta nueva se ven y su botón se alcanza', o === true);
    await ctx.close();
  }
});

const relevant = R.errors.filter((e) => !/ResizeObserver/.test(e));
if (!ONLY) check('ninguna página tiró errores', relevant.length === 0, relevant.slice(0, 4));
const bad = done();
await R.close();
process.exit(bad ? 1 : 0);
