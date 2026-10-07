// Lo que rodea a la escritura: archivos desde el árbol (nuevo, renombrar, eliminar), pegar imágenes,
// buscar y reemplazar, modo máquina de escribir y exportar a HTML.
(function () {
  'use strict';

  const { el, ICON, MD_RE, esc } = LMD.kit;
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
  const cloudWhy = (e, fallback) => T({ offline: 'No hay conexión con el servidor.', note_limit: 'Llegaste al límite de notas del plan gratis. El plan pago no tiene límite.', team_ended: 'El plan del equipo venció. No se pueden sumar notas nuevas.',
    no_access: 'Esta carpeta es de solo lectura', exists: 'Ya hay un archivo con ese nombre', bad_path: 'Ese nombre tiene caracteres que no se pueden usar' }[e && e.code] || fallback);
  // Al querer crear una nota de más en el plan gratis se abre Plan con el motivo, como con todo lo que es del plan pago.
  const cloudFail = (e, fallback) => { if (e && e.code === 'note_limit') core.openPanel('plan', cloudWhy(e)); else core.flash(cloudWhy(e, fallback), 'error'); };
  // Renombrar y eliminar son de quien creó la nota: lo compartido se puede leer o editar, no mover.
  // Las del equipo son de todos sus miembros: cualquiera las mueve y las elimina.
  const notMine = (path) => { if (!LMD.cloud.split(path).owner || LMD.cloud.isTeam(path)) return false; core.flash(T('Solo quien creó la nota puede hacer eso.'), 'warn'); return true; };
  // Una nota del equipo lleva adelante de su ruta de qué espacio es (~12/): eso no se muestra ni se escribe.
  const ownerPre = (path) => { const o = LMD.cloud.split(path).owner; return o ? '~' + o + '/' : ''; };

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
      // Dentro de una carpeta protegida la nota nace cifrada: hace falta tenerla desbloqueada.
      if (!(await LMD.vault.unlockFor(path))) return;
      const all = await LMD.cloud.list(true, s.owner);
      if (folder && all.some((n) => n.path.startsWith(s.path.slice(0, s.path.lastIndexOf('/') + 1)))) { core.flash(T('Ya hay una carpeta con ese nombre'), 'error'); return; }
      if (all.some((n) => n.path === s.path || n.path.startsWith(s.path + '/'))) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      const file = name.split('/').pop();
      await LMD.cloud.write(path, MD_RE.test(file) ? '# ' + file.replace(/\.[^.]+$/, '') + '\n' : '');
      openNew(core.urlOf(path));
    } catch (e) { cloudFail(e, 'No se pudo crear el archivo'); }
  }

  // given es el nombre ya escrito en el título de arriba: vale dentro de la carpeta donde está la nota.
  async function cloudRename(url, isDir, given) {
    const old = core.pathOf(url);
    if (notMine(old)) return;
    const pre = ownerPre(old); const inner = old.slice(pre.length);
    const typed = given != null ? inner.slice(0, inner.lastIndexOf('/') + 1) + given : await askName('Renombrar', inner, badPath, 'Renombrar', 'Con "/" se mueve a una carpeta');
    if (!typed || !typed.trim()) return;
    let to = cloudName(typed);
    if (!to) { core.flash(T('Ese nombre tiene caracteres que no se pueden usar'), 'error'); return; }
    to = pre + to;
    if (!isDir && !/\.[A-Za-z0-9]+$/.test(to)) to += (/\.[^./]+$/.exec(old) || ['.md'])[0];
    if (to === old) return;
    return cloudMove(old, to, isDir, 'No se pudo renombrar');
  }

  async function cloudMove(old, to, isDir, fallback) {
    try {
      // Lo que hay en cada lado del movimiento: lo propio, el espacio del equipo, o los dos.
      let all = [];
      for (const o of new Set([LMD.cloud.split(old).owner, LMD.cloud.split(to).owner])) all = all.concat((await LMD.cloud.list(true, o)).map((n) => (o ? '~' + o + '/' : '') + n.path));
      const moves = isDir ? all.filter((p) => p.startsWith(old + '/')).map((p) => [p, to + p.slice(old.length)]) : [[old, to]];
      if (moves.some((m) => all.includes(m[1]) && !moves.some((x) => x[0] === m[1]))) { core.flash(T('Ya hay un archivo con ese nombre'), 'error'); return; }
      // Una carpeta protegida no cambia de nombre ni de lugar: sus notas están cifradas con la ruta que tienen.
      if (isDir && LMD.vault.pinned(old)) { core.flash(T('Una carpeta protegida no se renombra ni se mueve. Quitale la protección primero.'), 'warn'); return; }
      // Lo que entra o sale de una carpeta protegida se cifra o se descifra al moverlo, con la carpeta desbloqueada.
      if (!(await LMD.vault.beforeMove(moves))) return;
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
    if (!(await LMD.dialog.confirm({ title: T('¿Eliminar "{a}"?', { a: path.slice(ownerPre(path).length) }), text: T('Queda 30 días en la papelera de la nube.'), ok: T('Eliminar'), danger: true }))) return;
    try {
      await LMD.cloud.remove(path);
      if (url === core.HERE) await closeGone();
      else core.reloadTree();
    } catch (e) { core.flash(cloudWhy(e, 'No se pudo eliminar'), 'error'); }
  }

  // ---------- Papelera de la nube ----------
  // Lo que se elimina de la nube queda acá hasta que vence: se restaura o se borra del todo. owner es el espacio
  // del equipo (su papelera es de todos sus miembros), o nada para la propia.
  async function trash(owner) {
    const C = LMD.cloud; let rows = [];
    try { rows = await C.trash(owner); } catch (e) { core.flash(cloudWhy(e, 'No se pudo abrir la papelera'), 'error'); return; }
    const title = T(owner ? 'Papelera del equipo' : 'Papelera');
    const left = (r) => { const d = Math.max(1, Math.ceil((r.expires - Date.now()) / 86400000)); return d === 1 ? T('Se borra en 1 día') : T('Se borra en {n} días', { n: d }); };
    const box = el('div', { class: 'lmd-ask' });
    const draw = (msg) => {
      box.innerHTML = '<div class="lmd-ask-card lmd-trash" role="dialog" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3>' +
        (rows.length ? '<ul class="lmd-trash-list">' + rows.map((r) => '<li data-id="' + r.id + '"><span class="lmd-trash-name">' + (r.protected ? ICON.lock : '') + '<b>' + esc(r.path) + '</b><small>' + esc(left(r)) + '</small></span>' +
          '<span class="lmd-trash-acts"><button type="button" class="lmd-link" data-tr="back">' + T('Restaurar') + '</button><button type="button" class="lmd-link lmd-trash-del" data-tr="del">' + T('Eliminar') + '</button></span></li>').join('') + '</ul>'
          : '<p class="lmd-trash-none">' + T('La papelera está vacía.') + '</p>') +
        '<p class="lmd-dlg-err" role="alert"' + (msg ? '' : ' hidden') + '>' + esc(msg || '') + '</p>' +
        '<div class="lmd-ask-actions">' + (rows.length ? '<button type="button" class="lmd-btn" data-tr="empty">' + T('Vaciar la papelera') + '</button>' : '') + '<button type="button" class="lmd-btn lmd-btn-fill" data-tr="no" data-esc>' + T('Cerrar') + '</button></div></div>';
    };
    draw(); document.body.appendChild(box);
    let busy = false;
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tr]');
      if (e.target === box || (b && b.dataset.tr === 'no')) { box.remove(); return; }
      if (!b || busy) return;
      const li = b.closest('li'); const row = li ? rows.find((r) => r.id === +li.dataset.id) : null;
      busy = true;
      try {
        if (b.dataset.tr === 'back' && row) {
          let r;
          try { r = await C.trashRestore(row.id, owner); }
          catch (err) {
            // Una nota protegida que vuelve con otro nombre se cifra de nuevo: hace falta su carpeta desbloqueada.
            if (err.code !== 'vault_locked' || !err.vault || !(await LMD.vault.unlock(err.vault))) throw err;
            r = await C.trashRestore(row.id, owner);
          }
          rows = rows.filter((x) => x !== row); draw();
          core.flash(r.path === r.from ? T('Nota restaurada') : T('Restaurada como "{a}"', { a: r.path.split('/').pop() }));
          core.reloadTree();
        } else if (b.dataset.tr === 'del' && row) {
          if (await LMD.dialog.confirm({ title: T('¿Eliminar "{a}" del todo?', { a: row.path.split('/').pop() }), text: T('No se puede deshacer.'), ok: T('Eliminar'), danger: true })) { await C.trashDelete(row.id, owner); rows = rows.filter((x) => x !== row); draw(); }
        } else if (b.dataset.tr === 'empty') {
          if (await LMD.dialog.confirm({ title: T('¿Vaciar la papelera?'), text: T('No se puede deshacer.'), ok: T('Vaciar'), danger: true })) { await C.trashEmpty(owner); rows = []; draw(); }
        }
      } catch (err) {
        // La lista se vuelve a pedir: pudo cambiar desde otra pestaña, o vencer algo mientras estaba abierta.
        try { rows = await C.trash(owner); } catch (x) { /* queda la que había */ }
        draw(err.code === 'not_found' ? T('Esa nota ya no está en la papelera.') : err.code === 'vault_locked' ? T('Desbloqueá la carpeta para restaurar esta nota.') : cloudWhy(err, 'No se pudo completar. Probá de nuevo.'));
      }
      busy = false;
    });
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
        if (!(await LMD.vault.unlockFor(pre + 'x'))) return false;
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
    } catch (e) { cloudFail(e, 'No se pudo crear el archivo'); }
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

  // Una carpeta del disco se muda copiándola entera al destino; la original se quita recién con la copia completa.
  async function copyDir(from, to) {
    for await (const [name, h] of from.entries()) {
      if (h.kind === 'directory') { await copyDir(h, await to.getDirectoryHandle(name, { create: true })); continue; }
      const w = await (await to.getFileHandle(name, { create: true })).createWritable();
      await w.write(await h.getFile()); await w.close();
    }
  }
  // Mueve una carpeta entera adentro de otra del mismo árbol, con el mismo nombre. En la nube valen las reglas de
  // siempre: una carpeta protegida no se mueve, y lo que entra a una se cifra con la carpeta desbloqueada.
  async function moveDir(url, dirUrl) {
    const name = nameOf(url);
    if (inCloud(url)) {
      const old = core.pathOf(url); const dir = core.pathOf(dirUrl);
      if (!notMine(old)) await cloudMove(old, (dir ? dir + '/' : '') + name, true, 'No se pudo mover');
      return;
    }
    try {
      const to = await core.dirHandle(dirUrl); const from = await core.dirHandle(parentOf(url));
      if (await exists(to, name)) { core.flash(T('Ya hay una carpeta con ese nombre'), 'error'); return; }
      const inside = !core.noDoc && core.HERE.startsWith(url);
      if (inside && core.dirty && !(await core.save(false))) return;
      const made = await to.getDirectoryHandle(name, { create: true });
      try { await copyDir(await from.getDirectoryHandle(name), made); }
      catch (e) { try { await to.removeEntry(name, { recursive: true }); } catch (x) { /* queda la copia a medias, y la original entera */ } throw e; }
      await from.removeEntry(name, { recursive: true });
      if (inside) openMoved(dirUrl + encodeURIComponent(name) + '/' + core.HERE.slice(url.length)); else core.reloadTree();
    } catch (e) { core.flash(T('No se pudo mover'), 'error'); core.reloadTree(); }
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

  // Una carpeta soltada en la papelera. En la nube cada nota va a la papelera de 30 días; una protegida se elimina
  // por su propio camino, con su confirmación. En el disco no hay papelera: se confirma y se borra.
  async function removeDir(url) {
    const name = nameOf(url);
    if (!inCloud(url)) {
      if (!(await askDelete(name))) return;
      try {
        await (await core.dirHandle(parentOf(url))).removeEntry(name, { recursive: true });
        if (!core.noDoc && core.HERE.startsWith(url)) closeGone(); else core.reloadTree();
      } catch (e) { core.flash(T('No se pudo eliminar'), 'error'); core.reloadTree(); }
      return;
    }
    const path = core.pathOf(url).replace(/\/$/, '');
    if (notMine(path)) return;
    if (LMD.vault.menu(path).some((i) => i[0] === 'v-destroy')) return LMD.vault.pick('v-destroy', path);
    if (LMD.vault.pinned(path)) { core.flash(T('Adentro hay una carpeta protegida. Eliminala primero desde su menú.'), 'warn'); return; }
    if (!(await LMD.dialog.confirm({ title: T('¿Eliminar la carpeta "{a}" y sus notas?', { a: name }), text: T('Quedan 30 días en la papelera de la nube.'), ok: T('Eliminar'), danger: true }))) return;
    try {
      const owner = LMD.cloud.split(path).owner;
      const inside = (await LMD.cloud.list(true, owner)).map((n) => (owner ? '~' + owner + '/' : '') + n.path).filter((p) => p.startsWith(path + '/'));
      const here = !core.noDoc && inside.includes(core.cloudPath);
      for (const p of inside) await LMD.cloud.remove(p);
      if (here) await closeGone(); else core.reloadTree();
    } catch (e) { core.flash(cloudWhy(e, 'No se pudo eliminar'), 'error'); core.reloadTree(); }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  // El ícono de cada acción de los menús del explorador, por id.
  const MENU_ICON = { new: 'file', tpl: 'doc', dir: 'folder', ren: 'pencil', del: 'trash', file: 'file', 'v-protect': 'lock', 'v-lock': 'lock', 'v-unlock': 'unlock', 'v-ai': 'spark', 'v-ailock': 'lock', 'v-drop': 'close', 'v-pass': 'pencil', 'v-off': 'unlock', 'v-destroy': 'trash', 'v-backup': 'copy', 'v-rotate': 'lock' };
  // Un menú corto en un punto de la pantalla. items: [id, texto, peligroso, ícono]. onPick recibe el id elegido.
  function showMenu(x, y, items, onPick) {
    closeMenu();
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' + items.map((i) => '<button type="button" role="menuitem" data-f="' + i[0] + '"' + (i[2] ? ' class="lmd-menu-danger"' : '') + '>' + (ICON[i[3] || MENU_ICON[i[0]]] || '') + '<span>' + T(i[1]) + '</span></button>').join('') + '</div>';
    document.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, x)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, y)) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      onPick(b.dataset.f);
    });
  }
  function treeMenu(x, y, node) {
    const url = node.dataset.url; const isDir = node.classList.contains('lmd-node-dir'); const cloud = inCloud(url); const local = inLocal(url);
    const at = isDir ? url : parentOf(url);
    // Una carpeta propia de la nube suma lo de las carpetas con contraseña: proteger, desbloquear, abrir para la IA.
    const folder = isDir && cloud ? core.pathOf(url) : '';
    showMenu(x, y, [
      !local && ['new', isDir ? 'Nuevo archivo acá' : 'Nuevo archivo'],
      !local && ['tpl', 'Desde una plantilla…'],
      !local && ['dir', 'Nueva carpeta'],
      (!isDir || cloud) && ['ren', 'Renombrar'],
      !isDir && ['del', 'Eliminar', true],
    ].concat(folder ? LMD.vault.menu(folder) : []).filter(Boolean), (f) => {
      if (/^v-/.test(f)) LMD.vault.pick(f, folder);
      else if (f === 'new') newFile(at);
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
    showMenu(x, y, [['dir', 'Abrir carpeta', false, 'open'], ['file', 'Abrir archivo']], (f) => core.pick(f));
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
  // Un archivo o una carpeta soltados sobre una carpeta, o sobre el fondo del árbol (la raíz), se mueven ahí.
  // Un archivo soltado adentro de la nota abierta, en edición, deja un enlace a ese archivo (noteTarget, más abajo).
  let dragged = ''; let dropMark = null; let caret = null;
  const isDirUrl = (url) => url.endsWith('/');
  const markDrop = (node) => { if (dropMark === node) return; if (dropMark) dropMark.classList.remove('lmd-drop'); dropMark = node; if (node) node.classList.add('lmd-drop'); };
  const markCaret = (box) => {
    if (!box) { if (caret) { caret.remove(); caret = null; } return; }
    if (!caret) { caret = el('div', { class: 'lmd-drop-caret' }); document.body.appendChild(caret); }
    caret.classList.toggle('lmd-drop-line', !!box.width);
    caret.style.left = box.left + 'px'; caret.style.top = box.top + 'px'; caret.style.width = box.width ? box.width + 'px' : ''; caret.style.height = box.height ? box.height + 'px' : '';
  };
  const endDrag = () => { markDrop(null); markCaret(null); dragged = ''; const n = core.ui.treeBox.querySelector('.lmd-dragging'); if (n) n.classList.remove('lmd-dragging'); };
  // El lugar de una carpeta que no sirve de destino: ella misma, lo que tiene adentro, o donde ya está.
  const badDrop = (url) => url === parentOf(dragged) || (isDirUrl(dragged) && url.startsWith(dragged));

  // ---------- Soltar un archivo del explorador adentro de la nota ----------
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y); if (!p || !p.offsetNode) return null;
      const r = document.createRange();
      try { r.setStart(p.offsetNode, p.offset); } catch (e) { return null; }
      r.collapse(true); return r;
    }
    return document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  }
  // Dónde caería lo que se arrastra: en el punto del texto donde está el puntero ({ host, range }), en un renglón
  // propio debajo de un bloque ({ after }) o en el código fuente ({ raw }). box es dónde dibujar la marca.
  // Nada si no hay nota en edición, si lo arrastrado es una carpeta o la nota misma, o si es de otro lugar: una
  // ruta relativa entre el disco, el navegador y la nube no llevaría a ningún lado.
  function noteTarget(e) {
    if (!dragged || isDirUrl(dragged) || inLocal(dragged) || !core.APP || core.noDoc || !core.editMode || core.readOnly || dragged === core.HERE || core.rootOf(dragged) !== core.rootOf(core.HERE)) return null;
    const t = e.target; const article = core.ui.article; const rawEdit = core.ui.rawEdit;
    if (t === rawEdit) { const b = rawEdit.getBoundingClientRect(); return { raw: true, box: { left: b.left + 8, top: Math.max(b.top, e.clientY - 9), height: 18 } }; }
    if (!core.blocks || !t.closest || !article.contains(t)) return null;
    const r = caretAt(e.clientX, e.clientY);
    const n = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode);
    const host = n && n.closest && n.closest('.lmd-editable');
    if (host && article.contains(host) && !host.dataset.formula) {
      const c = r.getClientRects()[0] || r.getBoundingClientRect(); const h = host.getBoundingClientRect();
      return { host, range: r, box: c && c.height ? { left: c.left, top: c.top, height: c.height } : { left: h.left, top: h.top, height: Math.min(h.height, 24) } };
    }
    let after = null;
    for (const child of article.children) {
      if (child.matches('.lmd-add, .lmd-draft')) continue;
      if (child.getBoundingClientRect().top <= e.clientY) after = child; else break;
    }
    const a = article.getBoundingClientRect(); const b = after ? after.getBoundingClientRect() : null;
    return { after, box: { left: a.left, top: (b ? b.bottom : a.top) + 2, width: a.width } };
  }
  function dropInNote(t, url) {
    const name = nameOf(url); const rel = core.links.rel(url); const img = IMG_RE.test(name);
    const label = name.replace(/\.[^.]+$/, '') || name;
    const md = img ? '![](' + rel + ')' : LMD.links.md({ href: rel, label });
    if (t.raw) {
      const ta = core.ui.rawEdit; ta.focus();
      ta.setRangeText(md, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (!t.host || !t.host.isConnected) { LMD.write.put(t.after && t.after.isConnected ? t.after : null, [md]); return; }
    const host = t.host; const holder = LMD.live ? LMD.live.heldBy(host) : '';
    if (holder) { core.flash(T('{a} está escribiendo en este bloque', { a: holder }), 'warn'); return; }
    host.focus();
    if (host._md == null) host._md = LMD.serialize.inlineMd(host);
    let node;
    if (img) {
      node = el('img', { alt: '' }); node.setAttribute('data-lmd-src', rel); node.src = url;
      // La imagen se muestra desde la carpeta abierta; si no se puede leer, queda su ruta y se ve al redibujar.
      (async () => { try { const h = await core.vFile(url); if (h && node.isConnected) node.src = URL.createObjectURL(await h.getFile()); } catch (e) { /* queda la ruta */ } })();
    } else {
      node = document.createElement('a'); node.textContent = label;
      node.setAttribute('data-lmd-href', rel); node.href = core.toHref(url);
    }
    const after = document.createTextNode('\u200b'); // deja el cursor afuera del enlace; no se guarda en el archivo
    let range = t.range;
    if (!host.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(host); range.collapse(false); }
    range.insertNode(after); range.insertNode(node);
    getSelection().collapse(after, 1);
    host.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function bindNoteDrop(main) {
    main.addEventListener('dragover', (e) => {
      const t = noteTarget(e);
      if (!t) { markCaret(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'link'; markCaret(t.box);
    });
    main.addEventListener('dragleave', (e) => { if (!main.contains(e.relatedTarget)) markCaret(null); });
    main.addEventListener('drop', (e) => {
      const t = noteTarget(e); const url = dragged;
      if (!t) return;
      e.preventDefault(); endDrag();
      try { dropInNote(t, url); } catch (err) { core.flash(T('No se pudo insertar el enlace'), 'error'); }
    });
  }
  // Carpeta de destino según dónde está el puntero: la carpeta misma, la que contiene al archivo de abajo, o la
  // raíz. Solo dentro de la raíz de donde salió el archivo: entre el disco, el navegador y la nube no se arrastra.
  function dropTarget(e) {
    // Una nota del navegador no tiene carpetas adonde ir: solo se suelta en la papelera.
    if (inLocal(dragged)) return null;
    const sec = e.target.closest && e.target.closest('.lmd-xroot'); const top = sec ? rootUrl(sec) : '';
    if (!top || core.rootOf(top) !== core.rootOf(dragged)) return null;
    const node = e.target.closest('.lmd-node-dir');
    if (node) return { url: node.dataset.url, mark: node };
    const kids = e.target.closest('.lmd-node-kids');
    // La carpeta de esos hijos: el nodo de más arriba (entre los dos puede haber el renglón de estado de una carpeta protegida).
    let dir = kids && kids.previousElementSibling;
    while (dir && !dir.classList.contains('lmd-node-dir')) dir = dir.previousElementSibling;
    if (dir) return { url: dir.dataset.url, mark: dir };
    return { url: top, mark: sec };
  }
  // La Papelera del explorador como destino: lo que se suelta ahí se elimina, igual que con "Eliminar".
  const binOf = (e) => (e.target.closest && e.target.closest('.lmd-trash-link')) || null;
  function bindDrag(box) {
    box.addEventListener('dragstart', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-node');
      if (!node || !node.dataset.url || !(canTree(node.dataset.url) || inLocal(node.dataset.url))) return;
      dragged = node.dataset.url; node.classList.add('lmd-dragging');
      // Mover adentro del árbol, o dejar un enlace en la nota.
      e.dataTransfer.effectAllowed = 'linkMove';
      // Una carpeta es un botón: sin datos propios el navegador no la arrastra.
      if (isDirUrl(dragged)) { try { e.dataTransfer.setData('text/plain', nameOf(dragged)); } catch (err) { /* arrastra igual */ } }
    });
    box.addEventListener('dragover', (e) => {
      if (!dragged) return;
      const bin = binOf(e);
      if (bin) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; markDrop(bin); return; }
      const t = dropTarget(e);
      // Soltarlo en la carpeta donde ya está no es un destino; una carpeta tampoco va adentro de sí misma.
      if (!t || badDrop(t.url)) { markDrop(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; markDrop(t.mark);
    });
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) markDrop(null); });
    box.addEventListener('drop', (e) => {
      if (!dragged) return;
      e.preventDefault();
      const url = dragged; const bin = binOf(e); const t = bin ? null : dropTarget(e);
      const ok = t && !badDrop(t.url);
      endDrag();
      if (bin) { if (isDirUrl(url)) removeDir(url); else remove(url); return; }
      if (ok) { if (isDirUrl(url)) moveDir(url, t.url); else moveTo(url, t.url); }
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
    if (LMD.touch.dock()) return;
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
    // La mitad de lo que se ve: con el teclado en pantalla, la zona visible es más baja que la ventana.
    const seen = LMD.touch.visible();
    const delta = box.top + box.height / 2 - (seen.top + seen.bottom) / 2;
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

  // El documento como HTML limpio, sin lo que es de la interfaz: para exportarlo o copiarlo.
  function htmlOf() {
    const copy = core.ui.article.cloneNode(true);
    copy.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-dgm-tools, .lmd-add, .lmd-draft, .lmd-draft-li, .lmd-board-edit').forEach((n) => n.remove());
    copy.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    copy.querySelectorAll('[data-l], [data-p]').forEach((n) => { n.removeAttribute('data-l'); n.removeAttribute('data-p'); });
    // La matemática viaja como MathML, que el navegador dibuja solo, sin la hoja de estilos de KaTeX.
    copy.querySelectorAll('.katex').forEach((k) => { const m = k.querySelector('math'); if (m) k.replaceWith(m); });
    copy.querySelectorAll('img[data-lmd-src]').forEach((i) => i.setAttribute('src', i.getAttribute('data-lmd-src')));
    copy.querySelectorAll('a[data-lmd-href]').forEach((a) => a.setAttribute('href', a.getAttribute('data-lmd-href')));
    return copy.innerHTML.trim();
  }
  function exportHtml() {
    const title = (core.docName || 'documento').replace(/\.[^.]+$/, '');
    const html = '<!doctype html>\n<html lang="' + LMD.lang() + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</title>\n<style>' + EXPORT_CSS + '</style>\n</head>\n<body>\n<main>\n' + htmlOf() + '\n</main>\n</body>\n</html>\n';
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
    bindNoteDrop(core.ui.main);
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

  LMD.extras = { init, pasteImage, exportHtml, htmlOf, imageDialog, imageMd, fromTemplate, trash, menu: showMenu };
})();
