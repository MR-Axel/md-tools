// Lo que rodea a la escritura: archivos desde el árbol (nuevo, renombrar, eliminar), pegar imágenes,
// buscar y reemplazar, modo máquina de escribir y exportar a HTML.
(function () {
  'use strict';

  const { el, ICON, MD_RE } = LMD.kit;
  const T = LMD.t;
  let core = null;

  const canManage = () => core.APP && core.appRoot && core.appRoot.kind === 'dir';
  const nameOf = (url) => decodeURIComponent(url.replace(/\/$/, '').split('/').pop());
  const parentOf = (url) => new URL(url.endsWith('/') ? '..' : '.', url).href;

  // ---------- Archivos ----------
  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { /* sigue */ }
    try { await dir.getDirectoryHandle(name); return true; } catch (e) { return false; }
  }

  async function newFile(dirUrl) {
    let name = (window.prompt(T('Nombre del archivo nuevo'), T('nota') + '.md') || '').trim();
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name)) { core.flash(T('Ese nombre tiene caracteres que no se pueden usar'), 'error'); return; }
    if (!/\.[A-Za-z0-9]+$/.test(name)) name += '.md';
    try {
      const dir = await core.dirHandle(dirUrl);
      if (await exists(dir, name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(MD_RE.test(name) ? '# ' + name.replace(/\.[^.]+$/, '') + '\n' : '');
      await w.close();
      location.href = core.toHref(dirUrl + encodeURIComponent(name));
    } catch (e) { core.flash(T('No se pudo crear el archivo'), 'error'); }
  }

  async function rename(url) {
    const old = nameOf(url);
    let name = (window.prompt(T('Nombre nuevo'), old) || '').trim();
    if (!name || name === old) return;
    if (/[\\/:*?"<>|]/.test(name)) { core.flash(T('Ese nombre tiene caracteres que no se pueden usar'), 'error'); return; }
    if (!/\.[A-Za-z0-9]+$/.test(name)) name += (/\.[^.]+$/.exec(old) || ['.md'])[0];
    const dirUrl = parentOf(url);
    try {
      const dir = await core.dirHandle(dirUrl);
      if (await exists(dir, name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      const from = await dir.getFileHandle(old);
      let moved = false;
      if (from.move) { try { await from.move(name); moved = true; } catch (e) { /* se copia abajo */ } }
      if (!moved) {
        const to = await dir.getFileHandle(name, { create: true });
        const w = await to.createWritable(); await w.write(await from.getFile()); await w.close();
        await dir.removeEntry(old);
      }
      if (url === core.HERE) location.href = core.toHref(dirUrl + encodeURIComponent(name));
      else core.reloadTree();
    } catch (e) { core.flash(T('No se pudo renombrar'), 'error'); }
  }

  async function remove(url) {
    const name = nameOf(url);
    if (!window.confirm(T('¿Eliminar "{a}"? No se puede deshacer.', { a: name }))) return;
    try {
      const dir = await core.dirHandle(parentOf(url));
      await dir.removeEntry(name);
      if (url === core.HERE) location.href = core.appUrl;
      else core.reloadTree();
    } catch (e) { core.flash(T('No se pudo eliminar'), 'error'); }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function treeMenu(x, y, node) {
    closeMenu();
    const url = node.dataset.url; const isDir = node.classList.contains('lmd-node-dir');
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' +
      '<button type="button" role="menuitem" data-f="new">' + T(isDir ? 'Nuevo archivo acá' : 'Nuevo archivo') + '</button>' +
      (isDir ? '' : '<button type="button" role="menuitem" data-f="ren">' + T('Renombrar') + '</button>' +
        '<button type="button" role="menuitem" data-f="del" class="lmd-menu-danger">' + T('Eliminar') + '</button>') + '</div>';
    document.body.appendChild(menu);
    menu.style.left = Math.min(window.innerWidth - menu.offsetWidth - 8, x) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, y) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      if (b.dataset.f === 'new') newFile(isDir ? url : parentOf(url));
      else if (b.dataset.f === 'ren') rename(url);
      else remove(url);
    });
  }

  // ---------- Pegar imágenes ----------
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };

  // Devuelve true si se hizo cargo del pegado.
  function pasteImage(e) {
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (!item) return false;
    e.preventDefault();
    if (!canManage()) { core.flash(T('Para pegar imágenes abrí la carpeta desde la página de MD Tools'), 'warn'); return true; }
    const file = item.getAsFile();
    const target = e.target.closest && e.target.closest('.lmd-editable');
    const range = target && getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    (async () => {
      try {
        const ext = (/^image\/([a-z0-9+]+)/.exec(file.type) || [0, 'png'])[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const name = T('imagen') + '-' + stamp() + '.' + ext;
        const dir = await (await core.dirHandle(new URL('.', core.HERE).href)).getDirectoryHandle('assets', { create: true });
        const h = await dir.getFileHandle(name, { create: true });
        const w = await h.createWritable(); await w.write(file); await w.close();
        const rel = 'assets/' + name;
        if (target && range && target.isConnected) {
          const img = el('img', { alt: '', src: URL.createObjectURL(file) });
          img.setAttribute('data-lmd-src', rel);
          range.deleteContents(); range.insertNode(img);
          getSelection().collapse(img.parentNode, Array.from(img.parentNode.childNodes).indexOf(img) + 1);
        } else LMD.write.append(['![](' + rel + ')']);
        core.flash(T('Imagen guardada en {a}', { a: rel }));
      } catch (err) { core.flash(T('No se pudo guardar la imagen'), 'error'); }
    })();
    return true;
  }

  // ---------- Buscar y reemplazar ----------
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function replace(all) {
    const q = core.ui.searchInput.value; const to = core.ui.replaceInput.value;
    if (!q) return;
    const re = new RegExp(escapeRe(q), all ? 'gi' : 'i');
    const count = (core.raw.match(new RegExp(escapeRe(q), 'gi')) || []).length;
    if (!count) { core.flash(T('Sin coincidencias')); return; }
    core.setRaw(core.raw.replace(re, () => to));
    core.flash(all ? T(count === 1 ? '{n} reemplazo. Ctrl+Z lo deshace' : '{n} reemplazos. Ctrl+Z los deshace', { n: count }) : T('Reemplazado. Quedan {n}', { n: count - 1 }));
  }

  // ---------- Máquina de escribir ----------
  function centerCaret() {
    if (!core.editMode || !core.settings.typewriter) return;
    const sel = getSelection(); if (!sel.rangeCount) return;
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
    if (!node || !node.closest || !node.closest('.lmd-editable')) return;
    let box = sel.getRangeAt(0).getBoundingClientRect();
    if (!box.height) box = node.getBoundingClientRect();
    const delta = box.top + box.height / 2 - window.innerHeight / 2;
    if (Math.abs(delta) > 8) window.scrollBy({ top: delta, behavior: 'smooth' });
  }

  // ---------- Exportar a HTML ----------
  const EXPORT_CSS = 'body{margin:0;background:#fbfaf7;color:#1d2026;font:16px/1.65 -apple-system,"Segoe UI",Roboto,sans-serif}' +
    'main{max-width:860px;margin:0 auto;padding:48px 24px 80px}h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .6em}h1{font-size:2em}h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid #dedbd2}' +
    'a{color:#3f6b0c}img,svg{max-width:100%;height:auto}pre{padding:14px 16px;border:1px solid #dedbd2;border-radius:9px;overflow:auto;background:#f4f2ec}code{font:0.88em ui-monospace,Consolas,monospace}' +
    ':not(pre)>code{padding:.15em .4em;border-radius:5px;background:#eeece5}blockquote{margin:0 0 1em;padding:.2em 1em;border-left:3px solid #dedbd2;color:#5c6370}' +
    'table{border-collapse:collapse;margin:0 0 1em}th,td{padding:7px 12px;border:1px solid #dedbd2;text-align:left}th{background:#f1efe9}hr{border:0;border-top:1px solid #dedbd2;margin:2em 0}' +
    '.lmd-diagram{text-align:center;margin:0 0 1em}.lmd-box,.lmd-alert{margin:0 0 1em;padding:.6em 1em;border-left:3px solid #7c8b99;background:#f1efe9;border-radius:0 8px 8px 0}.lmd-box-title,.lmd-alert-title{font-weight:700;margin:0 0 .3em}' +
    'li.lmd-task-item{list-style:none;margin-left:-1.3em}.lmd-front{display:none}' +
    '.lmd-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;margin:0 0 1em}.lmd-col{flex:0 0 240px;padding:10px;border:1px solid #dedbd2;border-radius:10px}.lmd-col-head{font-weight:700;margin-bottom:8px}.lmd-col-n{margin-left:6px;opacity:.55;font-weight:400}.lmd-card{padding:8px 10px;margin-bottom:6px;border:1px solid #dedbd2;border-radius:8px}.lmd-card-done{opacity:.6;text-decoration:line-through}' +
    '@media(prefers-color-scheme:dark){body{background:#121418;color:#e6e8ec}a{color:#bef264}pre,th,.lmd-box,.lmd-alert{background:#1a1d23}:not(pre)>code{background:#232730}pre,th,td,h2,hr,blockquote{border-color:#2a2e37}blockquote{color:#a0a7b4}}';

  function exportHtml() {
    const copy = core.ui.article.cloneNode(true);
    copy.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-dgm-tools, .lmd-add, .lmd-draft, .lmd-draft-li, .lmd-board-edit').forEach((n) => n.remove());
    copy.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    copy.querySelectorAll('[data-l], [data-p]').forEach((n) => { n.removeAttribute('data-l'); n.removeAttribute('data-p'); });
    // La matemática viaja como MathML, que el navegador dibuja solo, sin la hoja de estilos de KaTeX.
    copy.querySelectorAll('.katex').forEach((k) => { const m = k.querySelector('math'); if (m) k.replaceWith(m); });
    copy.querySelectorAll('img[data-lmd-src]').forEach((i) => i.setAttribute('src', i.getAttribute('data-lmd-src')));
    copy.querySelectorAll('a[data-lmd-href]').forEach((a) => a.setAttribute('href', a.getAttribute('data-lmd-href')));
    const title = (core.docName || 'documento').replace(/\.[^.]+$/, '');
    const html = '<!doctype html>\n<html lang="' + LMD.lang() + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</title>\n<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n<main>\n' + copy.innerHTML + '\n</main>\n</body>\n</html>\n';
    const a = el('a', { download: title + '.html' });
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    core.flash(T('HTML descargado'));
  }

  function init(c) {
    core = c;
    // Árbol: clic derecho sobre un archivo o carpeta, y botón de archivo nuevo en la cabecera.
    core.ui.treeBox.addEventListener('contextmenu', (e) => {
      const node = e.target.closest('.lmd-node');
      if (!node || !canManage() || !node.dataset.url) return;
      e.preventDefault(); treeMenu(e.clientX, e.clientY, node);
    });
    core.ui.treeBox.addEventListener('click', (e) => { if (e.target.closest('.lmd-tree-new')) newFile(core.treeRoot()); });
    core.hooks.tree.push((head) => {
      if (!canManage()) return;
      head.insertBefore(el('button', { class: 'lmd-tree-up lmd-tree-new', type: 'button', title: T('Archivo nuevo en esta carpeta') }, ICON.plus), head.lastChild);
    });
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    // Reemplazar: aparece debajo del buscador mientras se edita y se busca en el documento.
    const row = el('div', { class: 'lmd-replace' },
      '<input type="text" spellcheck="false" placeholder="' + T('Reemplazar con') + '">' +
      '<button type="button" data-rep="one" title="' + T('Reemplazar la primera coincidencia') + '">' + T('Uno') + '</button>' +
      '<button type="button" data-rep="all" title="' + T('Reemplazar todas') + '">' + T('Todos') + '</button>');
    core.ui.searchBox.after(row);
    core.ui.replaceInput = row.querySelector('input');
    row.addEventListener('click', (e) => { const b = e.target.closest('[data-rep]'); if (b) replace(b.dataset.rep === 'all'); });
    core.ui.replaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replace(e.ctrlKey || e.metaKey); } });

    const article = core.ui.article;
    article.addEventListener('focusin', () => setTimeout(centerCaret, 30));
    article.addEventListener('input', centerCaret);
    article.addEventListener('keyup', (e) => { if (/^Arrow|^Page|^Home$|^End$/.test(e.key)) centerCaret(); });
  }

  LMD.extras = { init, pasteImage, exportHtml };
})();
