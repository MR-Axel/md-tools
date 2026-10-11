// La página de una carpeta. Una carpeta también se abre: tiene su dirección (?f=<raíz>/<ruta>/) y en el lugar de la
// nota se dibuja su nombre, el camino hasta ella, su descripción y el índice de lo que tiene adentro, primero las
// subcarpetas y después las notas. Así una carpeta hace de página padre de sus notas, y su dirección se guarda en
// marcadores o se comparte como la de cualquier nota.
//  - La descripción no es un formato nuevo: es el README.md de la carpeta (o readme.md, o index.md), dibujado como
//    una nota. "Agregar una descripción" lo crea y lo abre para escribir.
//  - El índice no lee las notas. El título y la fecha salen de lo que cada raíz ya sabe (content.js: core.folder); de
//    un archivo del disco se lee solo el comienzo, y recién cuando su renglón está a la vista.
//  - Las acciones son las del menú de la carpeta en el explorador (extras.js), según la raíz.
// Vale para una carpeta del disco, las notas de este navegador, la nube, el equipo, la guía y una carpeta compartida
// por enlace (ahí y en la guía, solo se lee). Se pide recién al abrir la primera (LAZY_APP en content.js).
(function () {
  'use strict';

  const { el, esc, ICON, MD_RE, typeOf } = LMD.kit;
  const T = LMD.t;
  // De a cuántos renglones se dibuja una carpeta larga: los primeros entran ya, el resto en tandas.
  const FIRST = 150; const CHUNK = 250;
  const DESC = ['README.md', 'readme.md', 'index.md'];
  let watch = null; // quién mira qué renglones entran a la vista, para la página que está dibujada

  const stem = (name) => name.replace(/\.(md|mdx|mkd|mdown|markdown)$/i, '');
  const fileIcon = (name) => (MD_RE.test(name) ? ICON.md : ICON[typeOf(name).icon] || ICON.file);
  // El archivo que hace de descripción: README.md, readme.md o index.md, en ese orden (y después, con otras mayúsculas).
  function descOf(rows) {
    const files = rows.filter((r) => !r.dir);
    for (const name of DESC) { const hit = files.find((r) => r.name === name); if (hit) return hit; }
    return files.find((r) => /^readme\.md$/i.test(r.name)) || files.find((r) => /^index\.md$/i.test(r.name)) || null;
  }
  // La fecha de cambio, corta: el año solo si no es este.
  function when(at) {
    if (!at) return '';
    const d = new Date(at < 1e11 ? at * 1000 : at); if (isNaN(d)) return '';
    try { return d.toLocaleDateString(LMD.lang() === 'es' ? 'es' : 'en', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  }
  const notesText = (n) => T(n === 1 ? '1 nota' : '{n} notas', { n });
  const filesText = (n) => T(n === 1 ? '1 archivo' : '{n} archivos', { n });
  const countText = (c) => { const n = Math.min(c.n, 999); return c.more || c.n > 999 ? T(c.files ? 'Más de {n} archivos' : 'Más de {n} notas', { n }) : c.files ? filesText(n) : notesText(n); };
  // El ícono del título: el de la raíz si la página es de una raíz, una carpeta si no.
  function titleIcon(core, url, top) {
    const r = core.rootOf(url);
    if (!top || !r) return ICON.folder;
    if (r.kind === 'cloud') return /\/cloud\/~/.test(url) ? ICON.people : ICON.cloud;
    return r.kind === 'local' ? ICON.browser : r.kind === 'guide' ? ICON.book : ICON.folder;
  }

  // Un renglón del índice. Es un enlace: se abre con un clic (lo atiende el lector, sin recargar) y también en otra pestaña.
  function rowNode(core, row, isDesc) {
    const href = core.folder.href(row);
    const a = el('a', { class: 'lmd-fp-row' + (row.dir ? ' lmd-fp-dir' : ''), role: 'listitem', href, title: row.name });
    if (!/^file:/.test(href)) a.setAttribute('data-lmd-href', '');
    a.dataset.url = row.url;
    a.innerHTML = '<span class="lmd-fp-rico">' + (row.dir ? ICON.folder : fileIcon(row.name)) + '</span><span class="lmd-fp-rname"></span>' +
      (isDesc ? '<span class="lmd-fp-rtag">' + T('Descripción') + '</span>' : '') + '<span class="lmd-fp-rmeta"></span>';
    // La descripción va por su nombre de archivo: su título suele ser el de la carpeta, que ya está arriba.
    a.querySelector('.lmd-fp-rname').textContent = isDesc ? stem(row.name) : row.label || row.title || (row.dir ? row.name : stem(row.name));
    a.querySelector('.lmd-fp-rmeta').textContent = when(row.at);
    a._row = row;
    return a;
  }
  // Lo que falta saber de un renglón, cuando entra a la vista: cuántas notas tiene una subcarpeta, y de un archivo del
  // disco su fecha y su título.
  async function fillRow(core, a, alive) {
    const row = a._row; const meta = a.querySelector('.lmd-fp-rmeta');
    try {
      if (row.dir) { const c = await core.folder.total(row.url); if (alive() && c && c.n) meta.textContent = countText(c); return; }
      if (row.at) return;
      const got = await core.folder.peek(row);
      if (!alive() || !got) return;
      if (got.title && !row.label && !a.querySelector('.lmd-fp-rtag')) a.querySelector('.lmd-fp-rname').textContent = got.title;
      meta.textContent = when(got.at);
    } catch (e) { /* queda el nombre */ }
  }

  async function draw(core, ctx) {
    const F = core.folder; const url = ctx.url; const root = core.rootOf(url);
    const crumbs = F.crumbs(url); const here = crumbs[crumbs.length - 1] || { name: '', url };
    const [rows, can] = await Promise.all([F.rows(url), F.writable(url)]);
    if (!ctx.alive() || !root) return;
    const desc = rows ? descOf(rows) : null; let text = null;
    if (desc) { try { text = await core.readNow(desc.url); } catch (e) { text = null; } if (!ctx.alive()) return; }
    // Una carpeta de la nube protegida con contraseña y bloqueada no muestra lo que tiene.
    let locked = false;
    if (root.kind === 'cloud' && rows && !rows.length) { try { await LMD.cloud.vaults(); const path = core.pathOf(url); const v = (await LMD.vault.load()).find((x) => x.folder && (path === x.folder || path.startsWith(x.folder + '/'))); locked = !!v && !LMD.vault.isOpen(v); } catch (e) { locked = false; } if (!ctx.alive()) return; }

    const dirs = rows ? rows.filter((r) => r.dir).length : 0; const files = rows ? rows.length - dirs : 0;
    const asFiles = root.kind === 'dir' && !core.settings.filesOnlyMarkdown;
    const cloudPath = root.kind === 'cloud' ? core.pathOf(url) : '';
    const canShare = !!cloudPath && !locked && LMD.sync.canLinkFolder(cloudPath);
    const canExport = LMD.extras.canExportDir(url) && !!rows && rows.length > 0;
    const hasMenu = LMD.extras.dirHasMenu(url);
    // Una carpeta del disco abierta en solo lectura: se dice, con la forma de permitir guardar ahí mismo.
    const askWrite = root.kind === 'dir' && !can && !!root.handle && !root.ghost;

    const page = el('div', { class: 'lmd-fp' }); page.dataset.url = url;
    const head = el('header', { class: 'lmd-fp-head' });
    if (crumbs.length > 1) {
      const nav = el('nav', { class: 'lmd-fp-crumbs', 'aria-label': T('Carpetas') });
      crumbs.slice(0, -1).forEach((c, i) => {
        if (i) nav.appendChild(el('span', { class: 'lmd-fp-sep', 'aria-hidden': 'true', text: '/' }));
        nav.appendChild(el('a', { href: core.toHref(c.url), 'data-lmd-href': '', text: c.name }));
      });
      head.appendChild(nav);
    }
    const top = el('div', { class: 'lmd-fp-top' });
    const title = el('h1', { class: 'lmd-fp-title' }, '<span class="lmd-fp-ico">' + titleIcon(core, url, crumbs.length < 2) + '</span><span class="lmd-fp-name"></span>');
    title.querySelector('.lmd-fp-name').textContent = here.name;
    const acts = el('div', { class: 'lmd-fp-acts' },
      '<button type="button" class="lmd-btn" data-fp="link">' + ICON.link + '<span>' + T('Copiar el enlace') + '</span></button>' +
      (canShare ? '<button type="button" class="lmd-btn" data-fp="share">' + ICON.share + '<span>' + T('Compartir') + '</span></button>' : '') +
      (canExport ? '<button type="button" class="lmd-btn lmd-fp-icon" data-fp="export" title="' + esc(T('Exportar la carpeta…')) + '" aria-label="' + esc(T('Exportar la carpeta…')) + '">' + ICON.download + '</button>' : '') +
      (hasMenu ? '<button type="button" class="lmd-btn lmd-fp-icon" data-fp="more" aria-haspopup="menu" title="' + esc(T('Más acciones')) + '" aria-label="' + esc(T('Más acciones')) + '">' + ICON.more + '</button>' : ''));
    top.append(title, acts); head.appendChild(top);
    if (rows && rows.length) {
      const sum = [dirs ? T(dirs === 1 ? '1 carpeta' : '{n} carpetas', { n: dirs }) : '', files ? (asFiles ? filesText(files) : notesText(files)) : ''].filter(Boolean).join(' · ');
      head.appendChild(el('p', { class: 'lmd-fp-sum', text: sum }));
    }
    if (askWrite) head.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-fp-ro', 'data-fp': 'write', text: T('Solo lectura · Permitir guardar') }));
    page.appendChild(head);

    // La descripción, arriba del índice. Donde se puede escribir, cómo agregarla o editarla. Un README que ya está pero
    // no dice nada (vacío, o con el nombre de la carpeta y nada más) se trata como si faltara: el botón lo abre.
    const addBtn = (file) => el('button', { type: 'button', class: 'lmd-link lmd-fp-add', 'data-fp': file ? 'edit' : 'describe' }, ICON.plus + '<span>' + T('Agregar una descripción') + '</span>');
    let descBox = null;
    if (text != null && text.trim()) {
      const sec = el('section', { class: 'lmd-fp-desc' });
      descBox = el('div', { class: 'lmd-fp-md' });
      sec.appendChild(descBox);
      if (can) sec.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-fp-edit', 'data-fp': 'edit' }, ICON.pencil + '<span>' + T('Editar la descripción') + '</span>'));
      page.appendChild(sec);
    } else if (can && rows && !locked) page.appendChild(addBtn(desc));

    // El índice: subcarpetas primero, después las notas (así las ordena el explorador).
    const list = el('div', { class: 'lmd-fp-list', role: 'list', 'aria-label': T('Contenido de la carpeta') });
    const empty = (line, act, label) => { const box = el('div', { class: 'lmd-fp-empty' }); box.appendChild(el('p', { text: line })); if (act) box.appendChild(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-fp': act, text: label })); return box; };
    if (!rows) page.appendChild(empty(T('No se pudo leer esta carpeta.')));
    else if (locked) page.appendChild(empty(T('Carpeta protegida. Desbloqueala para ver sus notas.'), 'unlock', T('Desbloquear')));
    else if (!rows.length) page.appendChild(empty(T('Esta carpeta está vacía.'), can ? 'new' : '', T('Crear una nota')));
    else page.appendChild(list);

    if (watch) { watch.disconnect(); watch = null; }
    const io = window.IntersectionObserver ? new IntersectionObserver((entries) => entries.forEach((en) => { if (!en.isIntersecting) return; io.unobserve(en.target); fillRow(core, en.target, ctx.alive); }), { rootMargin: '400px 0px' }) : null;
    watch = io;
    const add = (from, to) => {
      const frag = document.createDocumentFragment();
      for (let i = from; i < to; i++) { const a = rowNode(core, rows[i], rows[i] === desc); frag.appendChild(a); if (io && (rows[i].dir || !rows[i].at)) io.observe(a); }
      list.appendChild(frag);
    };
    if (rows && rows.length) add(0, Math.min(rows.length, FIRST));

    page.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fp]'); if (!b) return;
      const f = b.dataset.fp; const box = b.getBoundingClientRect();
      if (f === 'link') { core.copy(F.link(url)); core.flash(T('Enlace copiado')); }
      else if (f === 'share') LMD.sync.shareFolder(cloudPath);
      else if (f === 'export') LMD.extras.folderExport(url);
      else if (f === 'more') { e.stopPropagation(); LMD.extras.dirMenu(Math.max(8, box.right - 240), box.bottom + 6, url); }
      else if (f === 'describe') LMD.extras.describe(url, here.name);
      else if (f === 'edit') core.open(desc.url, { edit: 'on' });
      else if (f === 'new') LMD.extras.newFile(url);
      else if (f === 'write') F.askWrite().then(() => F.redraw());
      else if (f === 'unlock') LMD.vault.unlockFor(core.pathOf(url) + '/x').then((ok) => { if (ok) F.redraw(); });
    });

    const y = ctx.host.querySelector('.lmd-fp[data-url="' + url.replace(/["\\]/g, '\\$&') + '"]') ? window.scrollY : 0;
    ctx.host.replaceChildren(page);
    if (descBox) {
      try {
        F.fill(descBox, text);
        // El README suele abrir con el nombre de la carpeta como título: acá ya está arriba, no se repite.
        const h = descBox.firstElementChild;
        if (h && h.tagName === 'H1' && h.textContent.trim().toLowerCase() === String(here.name).trim().toLowerCase()) h.remove();
        if (!descBox.textContent.trim() && !descBox.querySelector('img, svg, table, pre, hr')) { const sec = descBox.parentNode; if (can) sec.replaceWith(addBtn(desc)); else sec.remove(); }
      } catch (e) { console.error(e); }
    }
    window.scrollTo(0, y);
    // El resto de una carpeta larga entra de a tandas, sin frenar lo que ya se ve.
    if (rows && rows.length > FIRST) {
      let at = FIRST;
      const more = () => { if (!ctx.alive() || !page.isConnected) return; const to = Math.min(rows.length, at + CHUNK); add(at, to); at = to; if (at < rows.length) setTimeout(more, 0); else page.dataset.done = '1'; };
      setTimeout(more, 0);
    } else page.dataset.done = '1';
  }

  LMD.folderpage = { draw };
})();
