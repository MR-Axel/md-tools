// Exportar una carpeta entera como un solo documento: todas sus notas, una detrás de otra, en los mismos formatos
// que una nota sola (PDF por impresión, un archivo HTML, Word si la herramienta está prendida, o un Markdown único).
// Pensado para un libro con un archivo por capítulo.
//
// Cada nota se lee y se dibuja de a una, fuera de la página (core.drawOff, el mismo camino que publicar un sitio).
// Al juntarlas, los ids de cada una llevan un prefijo (d1-, d2-…) para que títulos y notas al pie no choquen, y un
// enlace a otra nota de la carpeta pasa a ser un enlace interno del documento combinado.
//
// El salto de página entre documentos: el motor de impresión no avisa dónde cortó, así que se calcula antes. El
// documento combinado se maqueta escondido en columnas del tamaño útil de la hoja: el navegador las parte con las
// mismas reglas con que parte las páginas (renglones huérfanos, títulos que no quedan al pie, bloques que no se
// cortan), y de ahí sale hasta dónde quedó llena la última página de cada documento. Si quedó por debajo del umbral
// elegido, el documento siguiente sigue en esa misma página; si no, salta. Ante la duda, no salta.
//
// Se pide recién al elegir "Exportar la carpeta…" (ver LAZY_APP en content.js).
(function () {
  'use strict';

  const { el, esc, ICON, MD_RE, SKIP_DIRS } = LMD.kit;
  const T = LMD.t;
  const TXT_RE = /\.txt$/i;
  const MAX_FILES = 600; const MAX_DEPTH = 8;
  const STORE = 'lmd:fx'; const KEPT = 40;
  // La hoja, en milímetros, y sus márgenes: arriba, a los lados y abajo (ahí va el número de página).
  const PAPER = { a4: { w: 210, h: 297, css: 'A4' }, letter: { w: 215.9, h: 279.4, css: 'letter' } };
  const MARGIN = { top: 18, side: 17, bottom: 20 };
  const THRESHOLD = { half: 0.5, three: 0.75 };
  // Lo que el cálculo puede errar frente al PDF real: pegado al umbral, se decide no saltar.
  const DOUBT = 0.02;
  const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const unesc = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const pause = () => new Promise((r) => setTimeout(r, 0));
  const stem = (name) => name.replace(/\.(md|mdx|mkd|mdown|markdown|txt)$/i, '');
  const relative = (v) => !!v && !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(v);
  const CANCEL = { cancelled: true };
  let core = null;

  // ---------- Opciones ----------
  // Carta donde se usa Carta; en el resto, A4.
  const paperHere = () => (/-(US|CA|MX|CO|CL|VE|PH|PR|GT|CR|PA|DO)\b/i.test((typeof navigator !== 'undefined' && navigator.language) || '') ? 'letter' : 'a4');
  const defaults = () => ({ format: 'pdf', deep: true, cover: true, title: '', toc: true, numbers: true, breaks: 'half', paper: paperHere(), off: [], order: null });
  function clean(o) {
    const d = defaults(); o = o && typeof o === 'object' ? o : {};
    const pick = (k, list) => (list.includes(o[k]) ? o[k] : d[k]);
    return {
      format: pick('format', ['pdf', 'html', 'docx', 'md']), breaks: pick('breaks', ['half', 'three', 'always', 'never']), paper: pick('paper', ['a4', 'letter']),
      deep: o.deep !== false, cover: o.cover !== false, toc: o.toc !== false, numbers: o.numbers !== false,
      title: typeof o.title === 'string' ? o.title.slice(0, 200) : '',
      off: Array.isArray(o.off) ? o.off.filter((x) => typeof x === 'string').slice(0, MAX_FILES) : [],
      order: Array.isArray(o.order) ? o.order.filter((x) => typeof x === 'string').slice(0, MAX_FILES) : null,
    };
  }
  // Las últimas opciones de cada carpeta, en este navegador.
  function recall(dirUrl) {
    try { const all = JSON.parse(localStorage.getItem(STORE) || '{}'); return clean(all[dirUrl] && all[dirUrl].o); } catch (e) { return defaults(); }
  }
  function remember(dirUrl, o) {
    try {
      const all = JSON.parse(localStorage.getItem(STORE) || '{}'); all[dirUrl] = { o, at: Date.now() };
      const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
      keys.slice(KEPT).forEach((k) => { delete all[k]; });
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch (e) { /* sin almacenamiento: la próxima vez arranca con las de siempre */ }
  }
  // Donde no hay páginas calculables de antemano, el umbral se reduce a siempre o nunca.
  const breaksFor = (o) => (o.breaks === 'never' ? 'never' : 'always');

  // ---------- La carpeta ----------
  const kindOf = (url) => { const r = core.APP ? core.rootOf(url) : null; return r ? r.kind : ''; };
  function folderName(dirUrl) {
    const parts = dirUrl.replace(/\/$/, '').split('/');
    if (core.APP) {
      const r = core.rootOf(dirUrl); const inside = core.pathOf(dirUrl);
      if (!inside) return r && r.kind === 'local' ? T('Notas') : r && r.kind === 'cloud' ? T('Nube') : (r && r.name) || T('Carpeta');
      const last = unesc(parts.pop()); return last[0] === '~' ? T('Compartidas') : last;
    }
    return unesc(parts.pop() || '') || T('Carpeta');
  }
  // Una carpeta de la nube protegida con contraseña y bloqueada: se pide desbloquearla. Nunca se exporta texto cifrado.
  async function unlocked(dirUrl) {
    if (kindOf(dirUrl) !== 'cloud' || !LMD.vault) return true;
    const path = core.pathOf(dirUrl);
    try { return !!(await LMD.vault.unlockFor((path ? path + '/' : '') + 'x')); } catch (e) { return false; }
  }
  // Las notas de la carpeta, en el orden del explorador (carpetas primero, nombres con orden natural: 2- antes de 10-).
  // Solo Markdown y texto. locked: subcarpetas protegidas que siguen bloqueadas y quedan afuera.
  async function scan(dirUrl) {
    const out = { files: [], locked: [], more: false };
    const hidden = !!core.settings.filesShowHidden;
    async function walk(url, rel, depth) {
      const rows = await core.listDir(url, true);
      if (!rows) { if (!depth) throw new Error('list'); return; }
      rows.sort((a, b) => (b.dir - a.dir) || nat(a.name, b.name));
      for (const r of rows) {
        if (out.more) return;
        if (!hidden && r.name[0] === '.') continue;
        if (r.dir) {
          if (r.vault && LMD.vault && !LMD.vault.isOpen(r.vault)) { out.locked.push(rel + r.name); continue; }
          if (depth < MAX_DEPTH && !SKIP_DIRS.test(r.name)) await walk(r.url, rel + r.name + '/', depth + 1);
        } else if (MD_RE.test(r.name) || TXT_RE.test(r.name)) {
          if (out.files.length >= MAX_FILES) { out.more = true; return; }
          out.files.push({ rel: rel + r.name, name: r.name, label: r.label || '', url: r.url });
        }
      }
    }
    await walk(dirUrl, '', 0);
    return out;
  }
  // Lo que entra y en qué orden: sin subcarpetas si se pidió, con el orden guardado si se reordenó a mano.
  function chosen(files, o) {
    let list = o.deep ? files.slice() : files.filter((f) => f.rel.indexOf('/') < 0);
    if (o.order && o.order.length) {
      const at = new Map(o.order.map((rel, i) => [rel, i]));
      list = list.map((f, i) => ({ f, i })).sort((a, b) => {
        const x = at.has(a.f.rel) ? at.get(a.f.rel) : Infinity; const y = at.has(b.f.rel) ? at.get(b.f.rel) : Infinity;
        return x === y ? a.i - b.i : x - y;
      }).map((x) => x.f);
    }
    return list;
  }

  // ---------- Leer y dibujar cada nota ----------
  // El título de una nota: el del encabezado (title:), su primer título de nivel 1, o el nombre del archivo.
  function titleOf(file, box, rows) {
    const fm = (rows || []).find((r) => String(r[0]).toLowerCase() === 'title');
    const given = fm ? String(fm[1]).replace(/^(["'])(.*)\1$/, '$2').trim() : '';
    if (given) return given;
    const h = box.querySelector('h1');
    return (h && h.textContent.trim()) || file.label || stem(file.name);
  }
  // Un separador (---) al principio o al final de una nota no suma nada: el corte entre documentos ya está.
  function trimRules(box) {
    const edge = (first) => {
      for (;;) {
        const n = first ? box.firstElementChild : box.lastElementChild;
        if (!n || n.tagName !== 'HR') return;
        n.remove();
      }
    };
    edge(true); edge(false);
  }
  const empty = (box) => !box.textContent.trim() && !box.querySelector('img, svg, table, hr, input, math');
  // Lee las notas de a una y las deja dibujadas. step(hechas, total, nombre) avisa el avance; job.cancelled corta.
  // Devuelve { docs, failed, blank }: lo que no se pudo leer y lo que estaba vacío se informa al final.
  async function draw(files, job, step) {
    const docs = []; const failed = []; const blank = [];
    const frontOn = !core.settings.plugins || core.settings.plugins.frontmatter !== false;
    for (let i = 0; i < files.length; i++) {
      if (job && job.cancelled) throw CANCEL;
      const f = files[i];
      if (step) step(i, files.length, f.rel);
      let text = null;
      try { text = await core.links.read(f.url); } catch (e) { text = null; }
      // Lo que no es texto o sigue cifrado no entra.
      if (typeof text !== 'string' || text.indexOf('\u0000') !== -1 || (LMD.seal && LMD.seal.sealed(text))) { failed.push(f.rel); continue; }
      let box; let rows = [];
      try {
        if (TXT_RE.test(f.name)) { box = el('div'); if (text.trim()) box.appendChild(el('div', { class: 'lmd-plain', text: text.replace(/\r\n?/g, '\n') })); }
        else { const d = await core.drawOff(text); box = d.box; rows = d.rows || []; }
      } catch (e) { failed.push(f.rel); continue; }
      trimRules(box);
      if (empty(box)) { blank.push(f.rel); continue; }
      const title = titleOf(f, box, rows);
      // La cabecera de la nota se muestra como al exportarla sola; los ajustes de la página no son datos de la nota.
      const shown = frontOn ? rows.filter((r) => !LMD.page || !LMD.page.owns(r[0], r[1])) : [];
      if (shown.length) {
        const dl = el('dl', { class: 'lmd-front' });
        shown.forEach(([k, v]) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: String(v).replace(/^(["'])(.*)\1$/, '$2') })); });
        box.insertBefore(dl, box.firstChild);
      }
      docs.push({ rel: f.rel, name: f.name, url: f.url, title, box });
      await pause(); // la pestaña sigue atendiendo entre nota y nota
    }
    if (step) step(files.length, files.length, '');
    return { docs, failed, blank };
  }

  // ---------- Juntar: ids únicos, enlaces internos, imágenes ----------
  // Las anclas de una nota: su id y la que arma GitHub con el texto del título, que es la que se escribe en los enlaces.
  function anchorsOf(doc) {
    const used = new Set(); const ids = new Set(); const gh = new Map();
    doc.box.querySelectorAll('[id]').forEach((n) => ids.add(n.id));
    doc.box.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => { const g = LMD.md.ghSlug(h.textContent.trim(), used); if (g && !gh.has(g)) gh.set(g, h.id); });
    return { ids, gh };
  }
  const anchorIn = (doc, frag) => {
    if (!frag) return '';
    const a = doc.anchors; const low = frag.toLowerCase();
    return a.ids.has(frag) ? frag : a.gh.has(low) ? a.gh.get(low) : a.ids.has(low) ? low : '';
  };
  const unwrap = (a) => { const s = el('span'); while (a.firstChild) s.appendChild(a.firstChild); a.replaceWith(s); };
  // target: 'print' (la hoja de impresión), 'html' (un archivo) o 'docx'. dirUrl es la carpeta que se exporta.
  // blobs junta las direcciones temporales de las imágenes leídas de la carpeta, para soltarlas al terminar.
  async function join(docs, dirUrl, target, blobs) {
    docs.forEach((d, i) => { d.n = i + 1; d.pre = 'd' + (i + 1) + '-'; d.anchors = anchorsOf(d); });
    const byUrl = new Map(docs.map((d) => [unesc(d.url.split('#')[0]), d]));
    const byWiki = new Map(); docs.forEach((d) => { const k = core.wikiKey(d.name); if (!byWiki.has(k)) byWiki.set(k, d); });
    const root = unesc(dirUrl);
    for (const d of docs) {
      // Enlaces: primero se resuelven contra los ids de antes; los ids cambian después.
      d.box.querySelectorAll('a').forEach((a) => {
        if (a.classList.contains('lmd-wiki')) {
          const parts = (a.getAttribute('data-wiki') || '').split('#'); const to = byWiki.get(core.wikiKey(parts[0].split('/').pop()));
          if (to) { const frag = parts[1] ? anchorIn(to, LMD.md.slugify(parts[1], new Set())) || anchorIn(to, parts[1]) : ''; a.setAttribute('href', '#' + (frag ? to.pre + frag : 'd' + to.n)); a.classList.remove('lmd-wiki'); a.removeAttribute('data-wiki'); }
          else unwrap(a);
          return;
        }
        const href = a.getAttribute('href'); if (!href) return;
        if (href[0] === '#') { const frag = anchorIn(d, unesc(href.slice(1))); if (frag) a.setAttribute('href', '#' + d.pre + frag); return; }
        if (!relative(href)) return;
        let abs = null; try { abs = new URL(href, d.url); } catch (e) { return; }
        const to = byUrl.get(unesc(abs.href.split('#')[0].split('?')[0]));
        // Otra nota de lo exportado: un enlace interno, a su comienzo o a la sección pedida.
        if (to) { const frag = anchorIn(to, unesc(abs.hash.slice(1))); a.setAttribute('href', '#' + (frag ? to.pre + frag : 'd' + to.n)); a.removeAttribute('target'); a.removeAttribute('rel'); return; }
        // Apunta afuera de lo exportado: en un archivo HTML queda, con la ruta desde la carpeta; en papel, como texto.
        if (target === 'html') { const p = unesc(abs.href); if (p.startsWith(root)) a.setAttribute('href', abs.href.slice(dirUrl.length) || './'); }
        else unwrap(a);
      });
      // Imágenes con ruta relativa: se resuelven desde la carpeta de cada documento.
      for (const img of Array.from(d.box.querySelectorAll('img[src]'))) {
        const src = img.getAttribute('src'); if (!relative(src)) continue;
        let abs = null; try { abs = new URL(src, d.url).href; } catch (e) { continue; }
        if (target === 'html') { if (unesc(abs).startsWith(root)) img.setAttribute('src', abs.slice(dirUrl.length)); continue; }
        if (!core.APP) { img.src = abs; continue; }
        try { const h = await core.vFile(abs); if (h) { const u = URL.createObjectURL(await h.getFile()); blobs.push(u); img.src = u; } } catch (e) { /* no está en la carpeta: queda su texto alternativo */ }
      }
      // Ids únicos por documento. Lo de adentro de un diagrama o una fórmula tiene sus propias referencias y no se toca.
      d.box.querySelectorAll('[id]').forEach((n) => { if (!n.closest('svg, math, .katex') || n.matches('.lmd-diagram')) n.id = d.pre + n.id; });
    }
  }
  // El documento combinado: portada, índice y una sección por nota. Devuelve la caja y las secciones.
  function assemble(docs, o, mode) {
    const out = el('div', { class: 'lmd-fx-print' });
    const title = (o.title || '').trim();
    if (o.cover && title) out.appendChild(el('header', { class: 'lmd-fx-cover markdown-body' }, '<h1 class="lmd-fx-title">' + esc(title) + '</h1>'));
    if (o.toc && docs.length > 1) {
      // "Índice" ya tiene otra traducción en la app (el de la barra lateral): acá es el de un libro.
      const nav = el('nav', { class: 'lmd-fx-toc markdown-body' }, '<h2>' + (LMD.lang() === 'en' ? 'Contents' : 'Índice') + '</h2>');
      const ol = el('ol');
      docs.forEach((d) => { const li = el('li'); li.appendChild(el('a', { href: '#d' + d.n, text: d.title })); ol.appendChild(li); });
      nav.appendChild(ol); out.appendChild(nav);
    }
    const secs = docs.map((d) => {
      const s = el('section', { class: 'lmd-fx-doc markdown-body', id: 'd' + d.n, 'data-rel': d.rel });
      while (d.box.firstChild) s.appendChild(d.box.firstChild);
      out.appendChild(s);
      return s;
    });
    // La portada y el índice siempre terminan en salto; entre documentos, según lo elegido (el umbral se decide después).
    Array.from(out.children).forEach((n, i) => {
      if (!i) return;
      const lead = !n.previousElementSibling.classList.contains('lmd-fx-doc');
      n.classList.add(lead || mode === 'always' ? 'lmd-fx-break' : 'lmd-fx-join');
    });
    return { out, secs };
  }

  // ---------- La hoja escondida y el cálculo de los saltos ----------
  let staged = null;
  function unstage() {
    if (!staged) return;
    const s = staged; staged = null;
    window.removeEventListener('afterprint', s.done);
    document.documentElement.classList.remove('lmd-fx-printing');
    s.stage.remove(); if (s.rule) s.rule.remove();
    s.blobs.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* ya no está */ } });
  }
  // Pone el documento combinado en la página, escondido, con el ancho y el alto útiles de la hoja y la letra de la nota.
  function stageUp(out, o, blobs) {
    unstage();
    const p = PAPER[o.paper] || PAPER.a4;
    const stage = el('div', { class: 'lmd-fx-stage', 'aria-hidden': 'true' });
    const cs = getComputedStyle(core.ui.article);
    out.style.setProperty('--fx-w', (p.w - 2 * MARGIN.side) + 'mm'); out.style.setProperty('--fx-h', (p.h - MARGIN.top - MARGIN.bottom) + 'mm');
    out.style.fontFamily = cs.fontFamily; out.style.fontSize = cs.fontSize; out.style.lineHeight = cs.lineHeight;
    stage.appendChild(out); document.body.appendChild(stage);
    const st = { stage, out, blobs, rule: null };
    // Quien retira la hoja al terminar de imprimir retira la suya: una exportación posterior no se toca.
    st.done = () => { if (staged === st) unstage(); };
    staged = st;
    return st;
  }
  // Espera a que las imágenes y las tipografías estén: sin eso las medidas no valen.
  async function settle(box) {
    const imgs = Array.from(box.querySelectorAll('img')).filter((i) => !i.complete);
    const all = Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })));
    await Promise.race([all, new Promise((r) => setTimeout(r, 8000))]);
    try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* sin esa API */ }
    // Las imágenes cifradas de una carpeta protegida se abren acá (images.js).
    try { if (LMD.images && LMD.images.paintEnc && box.querySelector('img[src*=".enc"]')) LMD.images.paintEnc(box); } catch (e) { /* quedan con su texto alternativo */ }
  }
  // Dónde cae cada documento en la hoja escondida: página (desde 0) y fracción de la página donde empieza y termina.
  function measure(out, secs) {
    const base = out.getBoundingClientRect(); const W = out.clientWidth || 1; const H = out.clientHeight || 1;
    const at = (r) => ({ page: Math.max(0, Math.round((r.left - base.left) / W)), top: (r.top - base.top) / H, bottom: (r.bottom - base.top) / H });
    return secs.map((s) => {
      const rects = Array.from(s.getClientRects()).filter((r) => r.height > 0.5);
      if (!rects.length) return null;
      const a = at(rects[0]); const b = at(rects[rects.length - 1]);
      return { page: a.page, top: a.top, endPage: b.page, fill: b.bottom };
    });
  }
  // Decide, de a un documento, si el siguiente salta de página. Cada decisión cambia dónde cae lo que sigue, así
  // que se vuelve a medir después de cada una. Devuelve el plan: una fila por documento, y el total de páginas.
  async function paginate(st, secs, o, job) {
    const out = st.out; const mode = o.breaks; const t = THRESHOLD[mode];
    out.classList.add('lmd-fx-measure');
    try {
      if (t) {
        for (let i = 1; i < secs.length; i++) {
          if (job && job.cancelled) throw CANCEL;
          const m = measure(out, [secs[i - 1]])[0];
          const jump = !!m && m.fill >= t + DOUBT;
          secs[i].classList.toggle('lmd-fx-break', jump); secs[i].classList.toggle('lmd-fx-join', !jump);
          if (i % 6 === 0) await pause();
        }
      }
      const rows = measure(out, secs);
      const all = Array.from(out.children).map((n) => Array.from(n.getClientRects()).pop()).filter(Boolean);
      const base = out.getBoundingClientRect(); const W = out.clientWidth || 1;
      const pages = all.reduce((n, r) => Math.max(n, Math.round((r.left - base.left) / W) + 1), 1);
      return { pages, docs: secs.map((s, i) => Object.assign({ rel: s.dataset.rel, jump: s.classList.contains('lmd-fx-break') }, rows[i] || {})) };
    } finally { out.classList.remove('lmd-fx-measure'); }
  }
  // Las reglas de la hoja: tamaño, márgenes y, si se pidió y el navegador lo permite, el número de página abajo.
  function pageRule(o, cover) {
    const p = PAPER[o.paper] || PAPER.a4;
    const num = o.numbers ? ' @bottom-center { content: counter(page); font: 9.5pt/1 system-ui, sans-serif; color: #6b7280; }' : '';
    return '@page { size: ' + p.css + '; margin: ' + MARGIN.top + 'mm ' + MARGIN.side + 'mm ' + MARGIN.bottom + 'mm;' + num + ' }' +
      (num && cover ? ' @page :first { @bottom-center { content: none; } }' : '');
  }

  // ---------- Los formatos ----------
  // Arma lo común a todos: lee, dibuja y junta. Devuelve lo dibujado y lo que quedó afuera.
  async function gather(dirUrl, o, job, step, target) {
    if (!(await unlocked(dirUrl))) throw Object.assign(new Error('locked'), { code: 'locked' });
    const found = await scan(dirUrl);
    const off = new Set(o.off || []);
    const files = chosen(found.files, o).filter((f) => !off.has(f.rel));
    if (!files.length) throw Object.assign(new Error('empty'), { code: 'empty' });
    const drawn = await draw(files, job, step);
    if (!drawn.docs.length) throw Object.assign(new Error('empty'), { code: 'empty', failed: drawn.failed });
    const blobs = [];
    await join(drawn.docs, dirUrl, target, blobs);
    return { docs: drawn.docs, failed: drawn.failed, blank: drawn.blank, locked: found.locked, blobs };
  }
  const withTitle = (o, dirUrl) => Object.assign({}, o, { title: (o.title || '').trim() || folderName(dirUrl) });
  const fileBase = (o) => (o.title || T('documento')).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || T('documento');
  const report = (g, extra) => Object.assign({ count: g.docs.length, failed: g.failed, blank: g.blank, locked: g.locked }, extra);

  // PDF: deja el documento listo en la hoja de impresión, con los saltos ya decididos. Lo imprime quien llama.
  async function stagePdf(dirUrl, opt, job, step) {
    const o = withTitle(clean(opt), dirUrl);
    const g = await gather(dirUrl, o, job, step, 'print');
    const a = assemble(g.docs, o, o.breaks);
    if (job && job.cancelled) throw CANCEL;
    const st = stageUp(a.out, o, g.blobs);
    try {
      await settle(a.out);
      if (job && job.cancelled) throw CANCEL;
      // Ya con el ancho de la hoja: lo que es muy corto para partirse bien pasa entero de página (extras.js).
      LMD.extras.keepShort(a.out);
      if (step) step(-1, 0, '');
      const plan = await paginate(st, a.secs, o, job);
      if ((job && job.cancelled) || staged !== st) throw CANCEL;
      st.rule = el('style', { 'data-lmd-fx': '', text: pageRule(o, !!a.out.querySelector('.lmd-fx-cover')) });
      document.head.appendChild(st.rule);
      return report(g, { plan, title: o.title });
    } catch (e) { st.done(); throw e; }
  }
  function print() {
    if (!staged) return false;
    const st = staged;
    document.documentElement.classList.add('lmd-fx-printing');
    window.addEventListener('afterprint', st.done);
    try { window.print(); } catch (e) { st.done(); }
    // Donde imprimir no avisa al terminar, la copia se retira sola más tarde (o al exportar de nuevo).
    setTimeout(st.done, 600000);
    return true;
  }

  // Lo que suma la hoja de una carpeta al HTML de una nota: la portada, el índice, la separación y el paginado.
  const HTML_CSS = '.lmd-fx-cover{padding:16vh 0 12vh;text-align:center}.lmd-fx-cover h1{margin:0;font-size:2.6em;border:0}' +
    '.lmd-fx-toc ol{list-style:none;padding:0}.lmd-fx-toc li{margin:.45em 0}.lmd-fx-toc a{text-decoration:none}' +
    '.lmd-fx-break,.lmd-fx-join{margin-top:3.2em;padding-top:2.6em;border-top:1px solid #dedbd2}section>:first-child{margin-top:0}' +
    '@media print{.lmd-fx-break{break-before:page;page-break-before:always;margin-top:0;padding-top:0;border-top:0}.lmd-fx-cover{padding:30vh 0 0}}';
  async function html(dirUrl, opt, job, step) {
    const o = withTitle(clean(opt), dirUrl);
    const g = await gather(dirUrl, o, job, step, 'html');
    const a = assemble(g.docs, o, breaksFor(o));
    const body = LMD.extras.htmlOf(a.out);
    return report(g, { name: fileBase(o) + '.html', type: 'text/html', data: LMD.extras.htmlPage(o.title, body, HTML_CSS) });
  }

  async function docx(dirUrl, opt, job, step) {
    const o = withTitle(clean(opt), dirUrl);
    if (!(await core.ensure('docx')) || !LMD.docx) throw Object.assign(new Error('docx'), { code: 'docx' });
    const g = await gather(dirUrl, o, job, step, 'docx');
    const a = assemble(g.docs, o, breaksFor(o));
    // Word marca solo los títulos: el índice y los enlaces a una nota apuntan a su primer título.
    const first = new Map(a.secs.map((s) => { const h = s.querySelector('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]'); return [s.id, h ? h.id : '']; }));
    a.out.querySelectorAll('a[href^="#d"]').forEach((link) => { const id = link.getAttribute('href').slice(1); if (!first.has(id)) return; if (first.get(id)) link.setAttribute('href', '#' + first.get(id)); else unwrap(link); });
    if (job && job.cancelled) throw CANCEL;
    const st = stageUp(a.out, o, g.blobs);
    try {
      await settle(a.out);
      if ((job && job.cancelled) || staged !== st) throw CANCEL;
      const data = await LMD.docx.build(a.out, { title: o.title });
      return report(g, { name: fileBase(o) + '.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data });
    } finally { st.done(); }
  }

  // Un solo Markdown: los textos como están, uno detrás de otro. La cabecera de cada nota no viaja (en el medio de un
  // archivo se leería como un separador), las etiquetas de las notas al pie llevan el prefijo del documento y las
  // imágenes de una subcarpeta, su ruta desde la carpeta. Los enlaces entre notas quedan como se escribieron.
  function mdOf(doc, n) {
    // Un separador suelto al final de la nota se saca: el corte entre documentos ya está.
    const body = LMD.md.splitFrontmatter(doc.text).body.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '').replace(/\n[ \t]*\n[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/, '');
    const dir = doc.rel.indexOf('/') < 0 ? '' : doc.rel.slice(0, doc.rel.lastIndexOf('/') + 1).split('/').map(encodeURIComponent).join('/');
    let fence = '';
    return body.split('\n').map((line) => {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = ''; return line; }
      if (fence) return line;
      let s = line.replace(/\[\^([^\]\s]+)\]/g, '[^d' + n + '-$1]');
      if (dir) s = s.replace(/(!\[[^\]]*\]\()(<?)([^)\s>]+)/g, (m, a, b, p) => (relative(p) && p[0] !== '/' ? a + b + dir + p : m));
      return s;
    }).join('\n');
  }
  async function markdown(dirUrl, opt, job, step) {
    const o = withTitle(clean(opt), dirUrl);
    if (!(await unlocked(dirUrl))) throw Object.assign(new Error('locked'), { code: 'locked' });
    const found = await scan(dirUrl); const off = new Set(o.off || []);
    const files = chosen(found.files, o).filter((f) => !off.has(f.rel));
    if (!files.length) throw Object.assign(new Error('empty'), { code: 'empty' });
    const parts = []; const failed = []; const blank = [];
    for (let i = 0; i < files.length; i++) {
      if (job && job.cancelled) throw CANCEL;
      if (step) step(i, files.length, files[i].rel);
      let text = null; try { text = await core.links.read(files[i].url); } catch (e) { text = null; }
      if (typeof text !== 'string' || text.indexOf('\u0000') !== -1 || (LMD.seal && LMD.seal.sealed(text))) { failed.push(files[i].rel); continue; }
      const body = mdOf({ text, rel: files[i].rel }, parts.length + 1);
      if (!body.trim()) { blank.push(files[i].rel); continue; }
      parts.push(body);
      if (i % 10 === 9) await pause();
    }
    if (!parts.length) throw Object.assign(new Error('empty'), { code: 'empty', failed });
    const head = o.cover && o.title ? '# ' + o.title + '\n\n' : '';
    const data = head + parts.join(breaksFor(o) === 'never' ? '\n\n' : '\n\n---\n\n') + '\n';
    return { count: parts.length, failed, blank, locked: found.locked, name: fileBase(o) + '.md', type: 'text/markdown', data };
  }

  // ---------- El diálogo ----------
  // El número de página va en el margen de la hoja, por CSS (@page con @bottom-center). Donde el navegador no lo
  // entiende, la casilla no se ofrece.
  const canNumber = (() => { try { const s = new CSSStyleSheet(); s.replaceSync('@page { @bottom-center { content: "1"; } }'); return /bottom-center/.test(s.cssRules[0].cssText); } catch (e) { return false; } })();
  const docxOn = () => !!(LMD.tools && LMD.tools.isOn('docx'));
  const GRIP = '<svg viewBox="0 0 24 24"><path d="M9 6.500v.010M15 6.500v.010M9 12v.010M15 12v.010M9 17.500v.010M15 17.500v.010"/></svg>';
  const UP = '<svg viewBox="0 0 24 24"><path d="m6.500 14.500 5.500-5.500 5.500 5.500"/></svg>';
  const DOWN = '<svg viewBox="0 0 24 24"><path d="m6.500 9.500 5.500 5.500 5.500-5.500"/></svg>';
  let dialog = null;
  async function open(c, dirUrl) {
    core = c;
    if (dialog) return false;
    dirUrl = dirUrl.endsWith('/') ? dirUrl : dirUrl + '/';
    if (!(await unlocked(dirUrl))) { core.flash(T('La carpeta sigue bloqueada: no se exporta.'), 'warn'); return false; }
    let found = null;
    try { found = await scan(dirUrl); } catch (e) { core.flash(T('No se pudo leer la carpeta.'), 'error'); return false; }
    if (!found.files.length) { core.flash(T('En esta carpeta no hay notas para exportar.'), 'warn'); return false; }
    if (dialog) return false;
    const o = recall(dirUrl);
    if (o.format === 'docx' && !docxOn()) o.format = 'pdf';
    const nested = found.files.some((f) => f.rel.indexOf('/') >= 0);
    const opt = (v, text, on) => '<option value="' + v + '"' + (on ? ' selected' : '') + '>' + esc(T(text)) + '</option>';
    const check = (k, text, on) => '<label class="lmd-check" data-fx-row="' + k + '"><input type="checkbox" data-fx="' + k + '"' + (on ? ' checked' : '') + '><span>' + esc(T(text)) + '</span></label>';
    const box = el('div', { class: 'lmd-ask lmd-fx' });
    box.innerHTML = '<div class="lmd-ask-card lmd-fx-card" role="dialog" aria-modal="true"><h3></h3><div class="lmd-fx-body">' +
      '<div class="lmd-fx-grid">' +
      '<label class="lmd-dlg-field"><span>' + esc(T('Formato')) + '</span><select data-fx="format">' + opt('pdf', 'PDF', o.format === 'pdf') + opt('html', 'Archivo HTML', o.format === 'html') +
      (docxOn() ? opt('docx', 'Word (.docx)', o.format === 'docx') : '') + opt('md', 'Un solo Markdown (.md)', o.format === 'md') + '</select></label>' +
      '<label class="lmd-dlg-field" data-fx-row="paper"><span>' + esc(T('Hoja')) + '</span><select data-fx="paper">' + opt('a4', 'A4', o.paper === 'a4') + opt('letter', 'Carta', o.paper === 'letter') + '</select></label>' +
      '<label class="lmd-dlg-field lmd-fx-wide"><span>' + esc(T('Título')) + '</span><input type="text" data-fx="title" spellcheck="false" autocomplete="off"></label>' +
      '<label class="lmd-dlg-field lmd-fx-wide" data-fx-row="breaks"><span>' + esc(T('Cada documento en página nueva')) + '</span><select data-fx="breaks"></select></label>' +
      '</div><div class="lmd-fx-checks">' + check('cover', 'Portada con el título', o.cover) + check('toc', 'Índice con los títulos', o.toc) + check('numbers', 'Numerar las páginas', o.numbers) + (nested ? check('deep', 'Incluir subcarpetas', o.deep) : '') + '</div>' +
      '<p class="lmd-fx-count" data-fx-count></p><ul class="lmd-fx-list" data-fx-list></ul>' +
      (found.locked.length ? '<p class="lmd-hint lmd-fx-note">' + esc(T('Quedan afuera por estar bloqueadas: {a}.', { a: found.locked.join(', ') })) + '</p>' : '') +
      (found.more ? '<p class="lmd-hint lmd-fx-note">' + esc(T('Se muestran las primeras {n} notas.', { n: MAX_FILES })) + '</p>' : '') +
      '</div><p class="lmd-fx-status" role="status" data-fx-status hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-fx-do="no" data-esc>' + esc(T('Cancelar')) + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-fx-do="go">' + esc(T('Exportar')) + '</button></div></div>';
    const q = (s) => box.querySelector(s);
    const card = q('.lmd-fx-card'); const title = T('Exportar la carpeta');
    card.setAttribute('aria-label', title); q('h3').textContent = title;
    const input = q('[data-fx=title]'); input.value = o.title || folderName(dirUrl); input.placeholder = folderName(dirUrl);
    const list = q('[data-fx-list]'); const status = q('[data-fx-status]'); const go = q('[data-fx-do=go]'); const no = q('[data-fx-do=no]');
    let order = chosen(found.files, Object.assign({}, o, { deep: true })).map((f) => f.rel);
    const off = new Set(o.off.filter((rel) => found.files.some((f) => f.rel === rel)));
    let moved = !!(o.order && o.order.length); let job = null; let ready = null;
    const byRel = new Map(found.files.map((f) => [f.rel, f]));
    const read = () => ({
      format: q('[data-fx=format]').value, title: input.value.trim(), breaks: breaksKept, paper: q('[data-fx=paper]').value,
      cover: q('[data-fx=cover]').checked, toc: q('[data-fx=toc]').checked, numbers: q('[data-fx=numbers]').checked,
      deep: nested ? q('[data-fx=deep]').checked : true, off: Array.from(off), order: moved ? order.slice() : null,
    });
    let breaksKept = o.breaks;
    // Lo que cada formato permite: el umbral solo vale con páginas (PDF); en HTML y Word es siempre o nunca.
    function fit() {
      const f = q('[data-fx=format]').value; const sel = q('[data-fx=breaks]');
      const pdf = f === 'pdf'; const want = pdf ? breaksKept : breaksKept === 'never' ? 'never' : 'always';
      sel.innerHTML = (pdf ? opt('half', 'Solo si la página quedó llena al menos hasta la mitad', want === 'half') + opt('three', 'Solo si quedó llena hasta tres cuartos', want === 'three') : '') +
        opt('always', 'Siempre', want === 'always') + opt('never', 'Nunca', want === 'never');
      q('[data-fx-row=breaks] span').textContent = T(f === 'md' ? 'Separador entre documentos' : 'Cada documento en página nueva');
      q('[data-fx-row=paper]').hidden = !pdf; q('[data-fx-row=numbers]').hidden = !pdf || !canNumber; q('[data-fx-row=toc]').hidden = f === 'md';
    }
    function paint() {
      const deep = nested ? q('[data-fx=deep]').checked : true;
      const rows = order.filter((rel) => deep || rel.indexOf('/') < 0);
      list.textContent = '';
      rows.forEach((rel) => {
        const f = byRel.get(rel);
        const li = el('li', { class: 'lmd-fx-item', draggable: 'true', 'data-rel': rel });
        li.innerHTML = '<span class="lmd-fx-grip" aria-hidden="true">' + GRIP + '</span><label class="lmd-check"><input type="checkbox"' + (off.has(rel) ? '' : ' checked') + '><span></span></label>' +
          '<button type="button" class="lmd-fx-move" data-fx-move="-1" title="' + esc(T('Subir')) + '" aria-label="' + esc(T('Subir')) + '">' + UP + '</button><button type="button" class="lmd-fx-move" data-fx-move="1" title="' + esc(T('Bajar')) + '" aria-label="' + esc(T('Bajar')) + '">' + DOWN + '</button>';
        li.querySelector('label span').textContent = f.label ? f.label + ' · ' + rel : rel;
        list.appendChild(li);
      });
      const n = rows.filter((rel) => !off.has(rel)).length;
      q('[data-fx-count]').textContent = T(n === 1 ? '{n} documento, en este orden:' : '{n} documentos, en este orden:', { n });
      go.disabled = !n;
    }
    // Mueve una nota en el orden: delante de otra (arrastrando) o un lugar arriba o abajo entre las que se ven.
    function move(rel, to, after) {
      const from = order.indexOf(rel); if (from < 0 || rel === to) return;
      order.splice(from, 1);
      const at = order.indexOf(to); order.splice(at < 0 ? order.length : at + (after ? 1 : 0), 0, rel);
      moved = true; paint();
    }
    function nudge(rel, by) {
      const shown = Array.from(list.children).map((li) => li.dataset.rel); const i = shown.indexOf(rel); const j = i + by;
      if (i < 0 || j < 0 || j >= shown.length) return;
      move(rel, shown[j], by > 0);
      const b = list.querySelector('[data-rel="' + CSS.escape(rel) + '"] [data-fx-move="' + by + '"]'); if (b) b.focus();
    }
    const say = (text) => { status.hidden = !text; status.textContent = text || ''; };
    const idle = () => { job = null; ready = null; card.classList.remove('lmd-fx-busy'); go.textContent = T('Exportar'); go.disabled = false; no.textContent = T('Cancelar'); paint(); };
    const close = () => { if (job) job.cancelled = true; dialog = null; box.remove(); };
    const step = (i, n, name) => say(i < 0 ? T('Calculando las páginas…') : i >= n ? T('Armando el documento…') : T('Preparando {a} de {n}…', { a: i + 1, n }) + (name ? ' ' + name : ''));
    // Lo que quedó afuera se dice al final, sin frenar el resto.
    function tell(r) {
      const lines = [];
      if (r.failed && r.failed.length) lines.push(T('No se pudieron leer: {a}.', { a: r.failed.join(', ') }));
      if (r.blank && r.blank.length) lines.push(T('Vacías, no suman página: {a}.', { a: r.blank.join(', ') }));
      if (lines.length) LMD.dialog.confirm({ title: T('Algunas notas quedaron afuera'), text: lines.join(' '), cancel: false, ok: T('Entendido') });
    }
    const WHY = { empty: 'No hay notas para exportar.', locked: 'La carpeta sigue bloqueada: no se exporta.', docx: 'No se pudo armar el documento de Word.' };
    async function run() {
      // Con el archivo ya armado (iPhone y iPad): guardarlo tiene que salir de este clic.
      if (ready) { const r = ready; close(); deliver(r); return; }
      if (job) return;
      const now = read(); remember(dirUrl, now);
      job = { cancelled: false }; const mine = job;
      card.classList.add('lmd-fx-busy'); go.disabled = true; say(T('Preparando…'));
      try {
        const make = { pdf: stagePdf, html, docx, md: markdown }[now.format];
        const r = await make(dirUrl, now, mine, step);
        if (mine.cancelled) return;
        if (now.format === 'pdf') { close(); print(); tell(r); return; }
        r.blob = new Blob([r.data], { type: r.type });
        if (LMD.device && LMD.device.ios) { ready = r; job = null; card.classList.remove('lmd-fx-busy'); go.disabled = false; go.textContent = T('Guardar'); say(T('Listo: {n} documentos.', { n: r.count })); go.focus(); return; }
        close(); deliver(r);
      } catch (e) {
        // Cancelado: el formulario ya volvió a como estaba al tocar Cancelar.
        if (mine.cancelled || e === CANCEL || dialog !== box) return;
        idle(); say(T(WHY[e && e.code] || 'No se pudo exportar. Probá de nuevo.'));
      }
    }
    function deliver(r) {
      if (LMD.kit.saveFile(r.blob, r.name) === 'download') core.flash(T('Carpeta exportada: {n} documentos', { n: r.count }));
      tell(r);
    }
    box.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-fx-move]');
      if (mv) { nudge(mv.closest('li').dataset.rel, +mv.dataset.fxMove); return; }
      const b = e.target.closest('[data-fx-do]'); if (!b) return;
      if (b.dataset.fxDo === 'go') { run(); return; }
      // Mientras prepara, Cancelar corta el trabajo y deja el formulario como estaba.
      if (job) { job.cancelled = true; unstage(); idle(); say(T('Cancelado.')); return; }
      close();
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-fx=format]')) fit();
      else if (t.matches('[data-fx=breaks]')) { if (q('[data-fx=format]').value === 'pdf' || t.value === 'never') breaksKept = t.value; else if (breaksKept === 'never') breaksKept = 'always'; }
      else if (t.matches('[data-fx=deep]')) paint();
      else if (t.closest('.lmd-fx-item')) { const rel = t.closest('.lmd-fx-item').dataset.rel; if (t.checked) off.delete(rel); else off.add(rel); paint(); }
    });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con el diálogo abierto
      const li = e.target.closest && e.target.closest('.lmd-fx-item');
      if (li && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); const rel = li.dataset.rel; nudge(rel, e.key === 'ArrowUp' ? -1 : 1);
        const again = list.querySelector('[data-rel="' + CSS.escape(rel) + '"] input'); if (again) again.focus();
      } else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); run(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box && !job) close(); });
    // Arrastrar para reordenar (con el mouse); con el dedo o el teclado, las flechas de cada renglón o Alt+flecha.
    let dragging = '';
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('.lmd-fx-item'); if (!li) return; dragging = li.dataset.rel; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragging); } catch (err) { /* sin datos: alcanza con la variable */ } li.classList.add('lmd-fx-drag'); });
    list.addEventListener('dragover', (e) => {
      const li = e.target.closest('.lmd-fx-item'); if (!dragging || !li) return;
      e.preventDefault(); const r = li.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
      list.querySelectorAll('.lmd-fx-over, .lmd-fx-under').forEach((n) => n.classList.remove('lmd-fx-over', 'lmd-fx-under'));
      if (li.dataset.rel !== dragging) li.classList.add(after ? 'lmd-fx-under' : 'lmd-fx-over');
    });
    list.addEventListener('drop', (e) => {
      const li = e.target.closest('.lmd-fx-item'); if (!dragging || !li) return;
      e.preventDefault(); const r = li.getBoundingClientRect(); const rel = dragging; dragging = '';
      move(rel, li.dataset.rel, e.clientY > r.top + r.height / 2);
    });
    list.addEventListener('dragend', () => { dragging = ''; list.querySelectorAll('.lmd-fx-drag, .lmd-fx-over, .lmd-fx-under').forEach((n) => n.classList.remove('lmd-fx-drag', 'lmd-fx-over', 'lmd-fx-under')); });
    fit(); paint();
    document.body.appendChild(box); dialog = box;
    go.focus();
    return true;
  }

  const bind = (c) => { core = c; };
  LMD.folderexport = { open, bind, scan: (c, dirUrl) => { core = c; return scan(dirUrl); }, stagePdf, print, unstage, html, docx, markdown, defaults, PAPER, MARGIN };
})();
