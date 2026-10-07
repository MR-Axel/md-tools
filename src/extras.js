// Lo que rodea a la escritura: archivos desde el árbol (nuevo, renombrar, eliminar), pegar imágenes,
// buscar y reemplazar, modo máquina de escribir y exportar a HTML.
(function () {
  'use strict';

  const { el, ICON, MD_RE } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // De qué raíz es un archivo lo dice su dirección: carpeta del disco, navegador o nube. Sin dirección, la nota abierta.
  const kindOf = (url) => { const r = core.APP ? core.rootOf(url || core.HERE) : null; return r ? r.kind : ''; };
  const canManage = (url) => kindOf(url) === 'dir';
  const nameOf = (url) => decodeURIComponent(url.replace(/\/$/, '').split('/').pop());
  const parentOf = (url) => new URL(url.endsWith('/') ? '..' : '.', url).href;

  // ---------- Archivos ----------
  async function exists(dir, name) {
    try { await dir.getFileHandle(name); return true; } catch (e) { /* sigue */ }
    try { await dir.getDirectoryHandle(name); return true; } catch (e) { return false; }
  }

  // ---------- Archivos de la nube ----------
  // En la nube una carpeta es solo el comienzo de la ruta: "proyecto/plan.md" la crea al crear la nota,
  // y renombrar con otra ruta es mover.
  const inCloud = (url) => kindOf(url) === 'cloud';
  const canTree = (url) => canManage(url) || inCloud(url);
  // Las notas del navegador no tienen carpetas: se renombran y se eliminan, no se mueven.
  const inLocal = (url) => kindOf(url) === 'local';
  // Abrir sin recargar la página. Lo que se movió o se borró ya no vive en su dirección vieja: no se guarda al salir.
  const openNew = (url) => core.open(url, { tree: true });
  const openMoved = (url) => core.open(url, { replace: true, discard: true, tree: true });
  const closeGone = () => core.close({ replace: true, discard: true, tree: true });
  const cloudName = (v) => {
    const parts = String(v || '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean);
    return parts.length && !parts.some((s) => /[:*?"<>|\x00-\x1f]/.test(s) || /^\.\.?$/.test(s) || s[0] === '~') ? parts.join('/') : '';
  };
  const cloudWhy = (e, fallback) => T({ offline: 'No hay conexión con el servidor.', note_limit: 'Llegaste al límite de notas del plan gratis. El plan pago no tiene límite.',
    no_access: 'Esta carpeta es de solo lectura', exists: 'Ya hay un archivo con ese nombre', bad_path: 'Ese nombre tiene caracteres que no se pueden usar' }[e && e.code] || fallback);
  // Renombrar y eliminar son de quien creó la nota: lo compartido se puede leer o editar, no mover.
  const notMine = (path) => { if (!LMD.cloud.split(path).owner) return false; core.flash(T('Solo quien creó la nota puede hacer eso.'), 'warn'); return true; };

  // Los nombres se piden en un diálogo propio, que avisa ahí mismo si el nombre no sirve.
  const BAD_NAME = 'Ese nombre tiene caracteres que no se pueden usar';
  const badName = (v) => (/[\\/:*?"<>|]/.test(v) || /^\.\.?$/.test(v) ? T(BAD_NAME) : '');
  const badPath = (v) => (cloudName(v) ? '' : T(BAD_NAME));
  const askName = (title, value, validate, ok, label) => LMD.dialog.prompt({ title: T(title), value, validate, ok: T(ok), label: label ? T(label) : '', stem: true });
  const askDelete = (name) => LMD.dialog.confirm({ title: T('¿Eliminar "{a}"?', { a: name }), text: T('No se puede deshacer.'), ok: T('Eliminar'), danger: true });

  async function cloudNew(dirUrl, folder) {
    const typed = await askName(folder ? 'Nombre de la carpeta nueva' : 'Nombre del archivo nuevo', folder ? T('carpeta') : T('nota') + '.md', badPath, 'Crear');
    if (!typed) return;
    let name = cloudName(typed);
    // Una carpeta existe mientras tenga algo adentro: nace con su primera nota.
    if (folder) name += '/' + T('nota') + '.md'; else if (!/\.[A-Za-z0-9]+$/.test(name)) name += '.md';
    const dir = core.pathOf(dirUrl); const path = (dir ? dir + '/' : '') + name; const s = LMD.cloud.split(path);
    try {
      const all = await LMD.cloud.list(true, s.owner);
      if (folder && all.some((n) => n.path.startsWith(s.path.slice(0, s.path.lastIndexOf('/') + 1)))) { core.flash(T('Ya hay una carpeta con ese nombre'), 'error'); return; }
      if (all.some((n) => n.path === s.path || n.path.startsWith(s.path + '/'))) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      const file = name.split('/').pop();
      await LMD.cloud.write(path, MD_RE.test(file) ? '# ' + file.replace(/\.[^.]+$/, '') + '\n' : '');
      openNew(core.urlOf(path));
    } catch (e) { core.flash(cloudWhy(e, 'No se pudo crear el archivo'), 'error'); }
  }

  // given es el nombre ya escrito en el título de arriba: vale dentro de la carpeta donde está la nota.
  async function cloudRename(url, isDir, given) {
    const old = core.pathOf(url);
    if (notMine(old)) return;
    const typed = given != null ? old.slice(0, old.lastIndexOf('/') + 1) + given : await askName('Renombrar', old, badPath, 'Renombrar', 'Con "/" se mueve a una carpeta');
    if (!typed || !typed.trim()) return;
    let to = cloudName(typed);
    if (!to) { core.flash(T('Ese nombre tiene caracteres que no se pueden usar'), 'error'); return; }
    if (!isDir && !/\.[A-Za-z0-9]+$/.test(to)) to += (/\.[^./]+$/.exec(old) || ['.md'])[0];
    if (to === old) return;
    return cloudMove(old, to, isDir, 'No se pudo renombrar');
  }

  async function cloudMove(old, to, isDir, fallback) {
    try {
      const all = (await LMD.cloud.list(true)).map((n) => n.path);
      const moves = isDir ? all.filter((p) => p.startsWith(old + '/')).map((p) => [p, to + p.slice(old.length)]) : [[old, to]];
      if (moves.some((m) => all.includes(m[1]) && !moves.some((x) => x[0] === m[1]))) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      // La nota abierta se guarda antes de moverla, y después se reabre en su ruta nueva.
      const here = moves.find((m) => m[0] === core.cloudPath);
      if (here && core.dirty && !(await core.save(false))) return;
      for (const m of moves) await LMD.cloud.rename(m[0], m[1]);
      if (here) openMoved(core.urlOf(here[1]));
      else core.reloadTree();
    } catch (e) { core.flash(cloudWhy(e, fallback), 'error'); if (isDir) core.reloadTree(); }
  }

  async function cloudRemove(url) {
    const path = core.pathOf(url);
    if (notMine(path)) return;
    if (!(await askDelete(path))) return;
    try {
      await LMD.cloud.remove(path);
      if (url === core.HERE) closeGone();
      else core.reloadTree();
    } catch (e) { core.flash(cloudWhy(e, 'No se pudo eliminar'), 'error'); }
  }

  // Carpeta nueva: en el disco se crea vacía; en la nube nace con su primera nota.
  async function newFolder(dirUrl) {
    if (inCloud(dirUrl)) return cloudNew(dirUrl, true);
    const name = await askName('Nombre de la carpeta nueva', T('carpeta'), badName, 'Crear');
    if (!name) return;
    try {
      const dir = await core.dirHandle(dirUrl);
      if (await exists(dir, name)) { core.flash(T('Ya hay una carpeta con ese nombre'), 'error'); return; }
      await dir.getDirectoryHandle(name, { create: true });
      core.reloadTree();
    } catch (e) { core.flash(T('No se pudo crear la carpeta'), 'error'); }
  }

  // Una nota que ya trae nombre y contenido (de una plantilla), dentro de una carpeta del disco o de la nube.
  // El nombre no pisa a otro: si está tomado, suma un número.
  async function newFrom(dirUrl, given) {
    const free = async (taken) => { let name = given.name + '.md'; for (let n = 2; n < 50 && await taken(name); n++) name = given.name + '-' + n + '.md'; return name; };
    try {
      if (inCloud(dirUrl)) {
        const dir = core.pathOf(dirUrl); const pre = dir ? dir + '/' : ''; const s = LMD.cloud.split(pre + 'x');
        const all = new Set((await LMD.cloud.list(true, s.owner)).map((n) => n.path)); const inner = s.path.slice(0, -1);
        const path = pre + await free((name) => all.has(inner + name));
        await LMD.cloud.write(path, given.text);
        return core.open(core.urlOf(path), { tree: true, edit: 'doc' });
      }
      const dir = await core.dirHandle(dirUrl);
      const name = await free((n) => exists(dir, n));
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable(); await w.write(given.text); await w.close();
      return core.open(dirUrl + encodeURIComponent(name), { tree: true, edit: 'doc' });
    } catch (e) { core.flash(cloudWhy(e, 'No se pudo crear el archivo'), 'error'); }
  }
  // Elegir una plantilla y crear la nota: en dirUrl, o donde van las notas nuevas si no se dice dónde.
  async function fromTemplate(dirUrl) {
    const t = await core.pickTemplate();
    if (!t) return;
    const given = { name: t.file, text: t.text };
    if (!dirUrl) return core.newNote(Object.assign({ strict: true }, given));
    return newFile(dirUrl, given);
  }

  async function newFile(dirUrl, given) {
    // Las notas del navegador no piden nombre: nacen con la fecha y se listan por su primer renglón.
    if (inLocal(dirUrl)) return core.newNote(Object.assign({ target: 'local' }, given));
    if (given) return newFrom(dirUrl, given);
    if (inCloud(dirUrl)) return cloudNew(dirUrl, false);
    let name = await askName('Nombre del archivo nuevo', T('nota') + '.md', badName, 'Crear');
    if (!name) return;
    if (!/\.[A-Za-z0-9]+$/.test(name)) name += '.md';
    try {
      const dir = await core.dirHandle(dirUrl);
      if (await exists(dir, name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(MD_RE.test(name) ? '# ' + name.replace(/\.[^.]+$/, '') + '\n' : '');
      await w.close();
      openNew(dirUrl + encodeURIComponent(name));
    } catch (e) { core.flash(T('No se pudo crear el archivo'), 'error'); }
  }

  // Cambia un archivo de nombre, de carpeta o de las dos cosas. Si el navegador no sabe moverlo, lo copia y borra el original.
  async function moveFile(fromDir, old, toDir, name) {
    const from = await fromDir.getFileHandle(old);
    if (from.move) { try { if (fromDir === toDir) await from.move(name); else await from.move(toDir, name); return; } catch (e) { /* se copia abajo */ } }
    const to = await toDir.getFileHandle(name, { create: true });
    const w = await to.createWritable(); await w.write(await from.getFile()); await w.close();
    await fromDir.removeEntry(old);
  }
  // El archivo abierto se guarda antes de tocarlo, y después se reabre en su ruta nueva.
  const saved = async (url) => url !== core.HERE || !core.dirty || core.save(false);
  const reopen = (url, to) => { if (url === core.HERE) openMoved(to); else core.reloadTree(); };

  // typed es el nombre ya escrito en el título de arriba; sin él, se pregunta.
  async function rename(url, isDir, typed) {
    if (inCloud(url)) return cloudRename(url, isDir, typed);
    const old = nameOf(url);
    let name = (typed != null ? typed : await askName('Renombrar', old, badName, 'Renombrar') || '').trim();
    if (!name || name === old) return;
    if (/[\\/:*?"<>|]/.test(name)) { core.flash(T('Ese nombre tiene caracteres que no se pueden usar'), 'error'); return; }
    if (!/\.[A-Za-z0-9]+$/.test(name)) name += (/\.[^.]+$/.exec(old) || ['.md'])[0];
    const dirUrl = parentOf(url);
    try {
      if (inLocal(url)) {
        if (await LMD.store.noteGet(name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
        if (!(await saved(url))) return;
        await LMD.store.notePut(name, (await LMD.store.noteGet(old)).text); await LMD.store.noteDelete(old);
      } else {
        const dir = await core.dirHandle(dirUrl);
        if (await exists(dir, name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
        if (!(await saved(url))) return;
        await moveFile(dir, old, dir, name);
      }
      reopen(url, dirUrl + encodeURIComponent(name));
    } catch (e) { core.flash(T('No se pudo renombrar'), 'error'); }
  }

  // Mueve un archivo a otra carpeta del árbol, con el mismo nombre.
  async function moveTo(url, dirUrl) {
    const name = nameOf(url);
    if (inCloud(url)) {
      const old = core.pathOf(url); const dir = core.pathOf(dirUrl);
      if (!notMine(old)) await cloudMove(old, (dir ? dir + '/' : '') + name, false, 'No se pudo mover');
      return;
    }
    try {
      const to = await core.dirHandle(dirUrl);
      if (await exists(to, name)) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      if (!(await saved(url))) return;
      await moveFile(await core.dirHandle(parentOf(url)), name, to, name);
      reopen(url, dirUrl + encodeURIComponent(name));
    } catch (e) { core.flash(T('No se pudo mover'), 'error'); }
  }

  async function remove(url) {
    if (inCloud(url)) return cloudRemove(url);
    const name = nameOf(url);
    if (!(await askDelete(name))) return;
    try {
      if (inLocal(url)) await LMD.store.noteDelete(name);
      else await (await core.dirHandle(parentOf(url))).removeEntry(name);
      if (url === core.HERE) closeGone();
      else core.reloadTree();
    } catch (e) { core.flash(T('No se pudo eliminar'), 'error'); }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  // Un menú corto en un punto de la pantalla. items: [id, texto, peligroso]. onPick recibe el id elegido.
  function showMenu(x, y, items, onPick) {
    closeMenu();
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' + items.map((i) => '<button type="button" role="menuitem" data-f="' + i[0] + '"' + (i[2] ? ' class="lmd-menu-danger"' : '') + '>' + T(i[1]) + '</button>').join('') + '</div>';
    document.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, x)) + 'px';
    menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, y) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      onPick(b.dataset.f);
    });
  }
  function treeMenu(x, y, node) {
    const url = node.dataset.url; const isDir = node.classList.contains('lmd-node-dir'); const cloud = inCloud(url); const local = inLocal(url);
    const at = isDir ? url : parentOf(url);
    showMenu(x, y, [
      !local && ['new', isDir ? 'Nuevo archivo acá' : 'Nuevo archivo'],
      !local && ['tpl', 'Desde una plantilla…'],
      !local && ['dir', 'Nueva carpeta'],
      (!isDir || cloud) && ['ren', 'Renombrar'],
      !isDir && ['del', 'Eliminar', true],
    ].filter(Boolean), (f) => {
      if (f === 'new') newFile(at);
      else if (f === 'tpl') fromTemplate(at);
      else if (f === 'dir') newFolder(at);
      else if (f === 'ren') rename(url, isDir);
      else remove(url);
    });
  }
  // Crear: desde la cabecera del explorador (sin dirUrl: donde van las notas nuevas) o dentro de una raíz.
  function createMenu(x, y, dirUrl) {
    const folderAt = dirUrl ? (canTree(dirUrl) ? dirUrl : '') : (core.diskDir() || (LMD.cloud.signedIn() ? core.urlOf('') : ''));
    showMenu(x, y, [['new', 'Nota en blanco'], ['tpl', 'Desde una plantilla…'], folderAt && ['dir', 'Carpeta']].filter(Boolean), (f) => {
      if (f === 'dir') newFolder(folderAt);
      else if (f === 'tpl') fromTemplate(dirUrl);
      else if (dirUrl) newFile(dirUrl);
      else core.newNote();
    });
  }
  // Abrir otra carpeta u otro archivo del disco, sin salir de la nota. Sobre un .md abierto directo, eso es abrir la app.
  function openMenu(x, y) {
    if (!core.APP) { core.openApp(''); return; }
    if (!window.showDirectoryPicker) { core.pick('file'); return; }
    showMenu(x, y, [['dir', 'Abrir carpeta'], ['file', 'Abrir archivo']], (f) => core.pick(f));
  }
  const rootUrl = (node) => { const sec = node.closest('.lmd-xroot'); const list = sec && sec.querySelector('.lmd-tree'); return (list && list.dataset.url) || ''; };

  // ---------- Renombrar desde el título ----------
  // El nombre de la barra de arriba se vuelve un campo: Enter confirma, Escape cancela.
  const canRename = () => !core.noDoc && !core.readOnly && (canTree() || inLocal());
  function editTitle() {
    const label = core.ui.main.querySelector('.lmd-docname');
    if (!canRename() || label.querySelector('input')) return;
    const old = core.docName; const dot = old.lastIndexOf('.');
    const input = el('input', { type: 'text', class: 'lmd-docname-input', spellcheck: 'false', 'aria-label': T('Nombre del archivo') });
    input.value = old;
    label.textContent = ''; label.appendChild(input);
    input.focus(); input.setSelectionRange(0, dot > 0 ? dot : old.length);
    let done = false;
    const finish = (apply) => {
      if (done) return; done = true;
      const typed = input.value.trim();
      label.textContent = old;
      if (apply && typed && typed !== old) rename(core.HERE, false, typed);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Escape y los atajos del documento no corren mientras se escribe el nombre
      if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------- Arrastrar en el árbol ----------
  // Un archivo soltado sobre una carpeta, o sobre el fondo del árbol (la raíz), se mueve ahí.
  let dragged = ''; let dropMark = null;
  const markDrop = (node) => { if (dropMark === node) return; if (dropMark) dropMark.classList.remove('lmd-drop'); dropMark = node; if (node) node.classList.add('lmd-drop'); };
  const endDrag = () => { markDrop(null); dragged = ''; const n = core.ui.treeBox.querySelector('.lmd-dragging'); if (n) n.classList.remove('lmd-dragging'); };
  // Carpeta de destino según dónde está el puntero: la carpeta misma, la que contiene al archivo de abajo, o la
  // raíz. Solo dentro de la raíz de donde salió el archivo: entre el disco, el navegador y la nube no se arrastra.
  function dropTarget(e) {
    const sec = e.target.closest && e.target.closest('.lmd-xroot'); const top = sec ? rootUrl(sec) : '';
    if (!top || core.rootOf(top) !== core.rootOf(dragged)) return null;
    const node = e.target.closest('.lmd-node-dir');
    if (node) return { url: node.dataset.url, mark: node };
    const kids = e.target.closest('.lmd-node-kids');
    if (kids) return { url: kids.previousElementSibling.dataset.url, mark: kids.previousElementSibling };
    return { url: top, mark: sec };
  }
  function bindDrag(box) {
    box.addEventListener('dragstart', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-node');
      if (!node || !node.dataset.url || !canTree(node.dataset.url) || node.classList.contains('lmd-node-dir')) return;
      dragged = node.dataset.url; node.classList.add('lmd-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    box.addEventListener('dragover', (e) => {
      if (!dragged) return;
      const t = dropTarget(e);
      // Soltarlo en la carpeta donde ya está no es un destino.
      if (!t || t.url === parentOf(dragged)) { markDrop(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; markDrop(t.mark);
    });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) markDrop(null); });
    box.addEventListener('drop', (e) => {
      if (!dragged) return;
      e.preventDefault();
      const url = dragged; const t = dropTarget(e);
      endDrag();
      if (t && t.url !== parentOf(url)) moveTo(url, t.url);
    });
    box.addEventListener('dragend', endDrag);
  }

  // ---------- Pegar imágenes ----------
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };

  const SIZES = [['', 'Original'], ['240', 'Chica'], ['480', 'Mediana'], ['720', 'Grande']];
  // Direcciones que se aceptan para una imagen: web, ruta relativa o imagen incrustada. Nada ejecutable.
  const safeSrc = (v) => /^https?:\/\//i.test(v) || /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(v) || (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !/[\s<>"]/.test(v));
  // El ancho va en el texto alternativo, como en Obsidian: ![texto|480](ruta)
  const imageMd = (img) => '![' + String(img.alt || '').replace(/[\[\]|]/g, ' ').trim() + (img.width ? '|' + img.width : '') + '](' + img.src + ')';

  // Guarda una imagen al lado del documento, en assets/, y devuelve su ruta relativa.
  async function saveImage(file) {
    const ext = (/^image\/([a-z0-9+]+)/.exec(file.type) || [0, 'png'])[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const name = T('imagen') + '-' + stamp() + '.' + ext;
    const dir = await (await core.dirHandle(new URL('.', core.HERE).href)).getDirectoryHandle('assets', { create: true });
    const h = await dir.getFileHandle(name, { create: true });
    const w = await h.createWritable(); await w.write(file); await w.close();
    return 'assets/' + name;
  }
  const asDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

  function imageDialog() {
    return new Promise((resolve) => {
      const box = el('div', { class: 'lmd-ask' });
      box.innerHTML =
        '<div class="lmd-ask-card lmd-img-card" role="dialog" aria-label="' + T('Insertar imagen') + '">' +
          '<h3>' + T('Insertar imagen') + '</h3>' +
          '<label class="lmd-row"><span>' + T('Dirección o ruta') + '</span><input type="text" data-i="src" spellcheck="false" placeholder="https://"></label>' +
          '<div class="lmd-img-pick"><button type="button" class="lmd-btn" data-i="pick">' + ICON.b_image + '<span>' + T('Elegir un archivo') + '</span></button><span data-i="picked"></span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden></div>' +
          '<label class="lmd-row"><span>' + T('Descripción (para quien no ve la imagen)') + '</span><input type="text" data-i="alt"></label>' +
          '<div class="lmd-row"><span>' + T('Tamaño') + '</span><div class="lmd-seg" data-i="size">' + SIZES.map((s, i) => '<button type="button" data-val="' + s[0] + '"' + (i ? '' : ' class="lmd-on"') + '>' + T(s[1]) + '</button>').join('') + '</div></div>' +
          '<p class="lmd-img-err" hidden></p>' +
          '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-i="no">' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-i="ok">' + T('Insertar') + '</button></div>' +
        '</div>';
      document.body.appendChild(box);
      const q = (name) => box.querySelector('[data-i=' + name + ']');
      const fileInput = box.querySelector('input[type=file]'); const err = box.querySelector('.lmd-img-err');
      let width = ''; let file = null;
      const fail = (text) => { err.hidden = false; err.textContent = text; };
      const close = (value) => { box.remove(); resolve(value); };
      q('src').focus();
      fileInput.addEventListener('change', () => {
        file = fileInput.files[0] || null; err.hidden = true;
        if (file && !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) { file = null; fail(T('Ese archivo no es una imagen que se pueda insertar.')); }
        q('picked').textContent = file ? file.name : '';
        if (file) q('src').value = '';
      });
      box.addEventListener('click', async (e) => {
        if (e.target === box) return close(null);
        const seg = e.target.closest('.lmd-seg button');
        if (seg) { width = seg.dataset.val; seg.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('lmd-on', b === seg)); return; }
        const b = e.target.closest('[data-i]'); if (!b) return;
        if (b.dataset.i === 'pick') return fileInput.click();
        if (b.dataset.i === 'no') return close(null);
        if (b.dataset.i !== 'ok') return;
        try {
          let src = q('src').value.trim();
          if (file) {
            if (file.size > 10 * 1024 * 1024) return fail(T('La imagen pesa más de 10 MB.'));
            if (canManage()) src = await saveImage(file);
            else if (file.type !== 'image/svg+xml' && file.size <= 400 * 1024) src = await asDataUrl(file);
            else return fail(T('Sin una carpeta abierta la imagen va dentro del documento, y esta es muy grande para eso. Abrí la carpeta desde SharpMD, o usá una dirección web.'));
          }
          if (!src) return fail(T('Falta la dirección o el archivo.'));
          if (!safeSrc(src)) return fail(T('Esa dirección no sirve para una imagen.'));
          close({ src, alt: q('alt').value, width });
        } catch (ex) { fail(T('No se pudo guardar la imagen')); }
      });
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } if (e.key === 'Enter' && e.target.matches('input[type=text]')) { e.preventDefault(); q('ok').click(); } });
    });
  }

  // Barra sobre una imagen en edición: tamaño y eliminar.
  let imgBar = null; let imgNow = null;
  function hideImgBar() { if (imgBar) imgBar.hidden = true; imgNow = null; }
  function showImgBar(img) {
    if (!imgBar) {
      imgBar = el('div', { class: 'lmd-tablebar lmd-imgbar', hidden: '' }, SIZES.map((s) => '<button type="button" data-w="' + s[0] + '">' + T(s[1]) + '</button>').join('') + '<button type="button" data-w="del" class="lmd-menu-danger">' + T('Eliminar') + '</button>');
      document.body.appendChild(imgBar);
      imgBar.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const b = e.target.closest('[data-w]'); const img = imgNow; if (!b || !img) return;
        const host = img.closest('.lmd-editable');
        hideImgBar();
        if (!host) return;
        if (b.dataset.w === 'del') {
          img.remove();
          if (!host.textContent.trim() && !host.querySelector('img')) { LMD.write.remove(host); return; }
        } else if (b.dataset.w) { img.dataset.lmdW = b.dataset.w; img.setAttribute('width', b.dataset.w); }
        else { delete img.dataset.lmdW; img.removeAttribute('width'); }
        host._md = '\u0000'; core.commitBlock(host); host._md = null; core.softRender();
      });
    }
    imgNow = img;
    const box = img.getBoundingClientRect();
    imgBar.hidden = false;
    imgBar.style.left = Math.max(8, box.left) + 'px';
    imgBar.style.top = Math.max(60, box.top - 44) + 'px';
  }

  // Devuelve true si se hizo cargo del pegado.
  function pasteImage(e) {
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (!item) return false;
    e.preventDefault();
    if (!canManage()) { core.flash(T('Para pegar imágenes abrí la carpeta desde la página de SharpMD'), 'warn'); return true; }
    const file = item.getAsFile();
    const target = e.target.closest && e.target.closest('.lmd-editable');
    const range = target && getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    (async () => {
      try {
        const rel = await saveImage(file);
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
      // Sobre un archivo o una carpeta, sus acciones; sobre el resto de una raíz, crear ahí.
      const at = node ? node.dataset.url : rootUrl(e.target);
      if (!at || !(canTree(at) || inLocal(at))) return;
      e.preventDefault();
      if (node) treeMenu(e.clientX, e.clientY, node); else createMenu(e.clientX, e.clientY, at);
    });
    // Los botones de la cabecera del explorador y el "+" de cada raíz.
    core.ui.sidebar.addEventListener('click', (e) => {
      const b = e.target.closest('.lmd-tree-new, .lmd-tree-add, .lmd-tree-open'); if (!b) return;
      const box = b.getBoundingClientRect();
      if (b.classList.contains('lmd-tree-open')) openMenu(box.left, box.bottom + 6);
      else createMenu(box.left, box.bottom + 6, b.classList.contains('lmd-tree-new') ? rootUrl(b) : '');
    });
    bindDrag(core.ui.paneFiles);
    const label = core.ui.main.querySelector('.lmd-docname');
    // Si el nombre se puede cambiar depende de la nota abierta: se revisa cada vez que cambia.
    const paintLabel = () => { const can = canRename(); label.classList.toggle('lmd-docname-edit', can); label.title = can ? T('Doble clic o F2 para cambiar el nombre') : ''; };
    paintLabel(); core.hooks.doc.push(paintLabel);
    label.addEventListener('dblclick', editTitle);
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
      if (e.key !== 'F2' || e.ctrlKey || e.metaKey || e.altKey) return;
      // F2 sobre un archivo del árbol lo renombra; en cualquier otro lado, el que está abierto.
      const t = e.target; const node = t && t.closest && t.closest('.lmd-tree-box .lmd-node');
      if (node) {
        const isDir = node.classList.contains('lmd-node-dir');
        const at = node.dataset.url;
        if (at && (canTree(at) || inLocal(at)) && (!isDir || inCloud(at))) { e.preventDefault(); rename(at, isDir); }
      } else if (!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) && canRename()) { e.preventDefault(); editTitle(); }
    });

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
    // Clic en una imagen mientras se edita: barra de tamaño.
    article.addEventListener('click', (e) => { if (core.editMode && e.target.tagName === 'IMG' && e.target.closest('.lmd-editable')) { e.preventDefault(); showImgBar(e.target); } else hideImgBar(); });
    window.addEventListener('scroll', hideImgBar, { passive: true });
    core.hooks.render.push(hideImgBar);
    article.addEventListener('focusin', () => setTimeout(centerCaret, 30));
    article.addEventListener('input', centerCaret);
    article.addEventListener('keyup', (e) => { if (/^Arrow|^Page|^Home$|^End$/.test(e.key)) centerCaret(); });
  }

  LMD.extras = { init, pasteImage, exportHtml, imageDialog, imageMd, fromTemplate };
})();
