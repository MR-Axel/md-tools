// Pantalla de inicio de la página propia: abrir un archivo o una carpeta, arrastrar, y los recientes.
(function () {
  'use strict';

  const { ICON, el, MD_RE, SKIP_DIRS } = LMD.kit;
  const { handlesPut, handlesDelete, rootsAll, notesAll, noteGet, notePut, noteDelete } = LMD.store;
  const T = LMD.t;
  let ctx = null; // { settings, APP_URL }, lo pasa el lector al llamar

  // Primer Markdown de una carpeta: el README o el índice si hay, si no el primero por nombre.
  async function firstMarkdown(root) {
    const queue = [{ h: root, path: '', depth: 0 }];
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    while (queue.length) {
      const d = queue.shift();
      const files = []; const dirs = [];
      for await (const [name, h] of d.h.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'file') { if (MD_RE.test(name)) files.push(name); }
        else if (d.depth < 3 && !SKIP_DIRS.test(name)) dirs.push({ name, h });
      }
      if (files.length) {
        files.sort(byName);
        return d.path + encodeURIComponent(files.find((n) => /^(readme|index|leeme)\./i.test(n)) || files[0]);
      }
      dirs.sort((a, b) => byName(a.name, b.name)).forEach((x) => queue.push({ h: x.h, path: d.path + encodeURIComponent(x.name) + '/', depth: d.depth + 1 }));
    }
    return null;
  }

  async function openPicked(handle, say) {
    let rec = null;
    for (const r of await rootsAll()) {
      try { if (await r.handle.isSameEntry(handle)) { rec = r; break; } } catch (e) { /* permiso vencido */ }
    }
    if (!rec) { const id = Math.random().toString(36).slice(2, 10); rec = { key: 'root:' + id, root: true, id }; }
    rec.kind = handle.kind === 'directory' ? 'dir' : 'file';
    rec.name = handle.name; rec.handle = handle; rec.at = Date.now();
    let path = encodeURIComponent(handle.name);
    if (rec.kind === 'dir') {
      path = await firstMarkdown(handle);
      if (!path) { say(T('Esa carpeta no tiene archivos Markdown.')); return; }
    }
    rec.last = rec.id + '/' + path;
    await handlesPut(rec);
    location.href = ctx.APP_URL + '?f=' + encodeURIComponent(rec.last);
  }

  // Sin File System Access (Firefox, Safari) el archivo se lee una vez y se guarda en la sesión.
  const canPick = () => !!window.showOpenFilePicker;
  async function openInMemory(file, say) {
    if (!file) return;
    try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name: file.name, text: await file.text() })); }
    catch (e) { say(T('No se pudo abrir. Probá de nuevo.')); return; }
    location.href = ctx.APP_URL + '?f=' + encodeURIComponent('mem/' + encodeURIComponent(file.name));
  }

  async function home(note) {
    LMD.theme.themeOnly(ctx.settings);
    document.title = 'MD Tools';
    document.body.textContent = '';
    const box = el('main', { class: 'lmd-home' });
    box.innerHTML =
      '<div class="lmd-home-card">' +
        '<img class="lmd-home-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
        '<h1>MD Tools</h1>' +
        '<p class="lmd-home-sub">' + T('Empezá una nota nueva, o abrí un archivo o una carpeta para leerlo y editarlo acá mismo.') + '</p>' +
        '<div class="lmd-home-actions">' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-home="new">' + ICON.plus + '<span>' + T('Nuevo archivo') + '</span></button>' +
          '<button type="button" class="lmd-btn" data-home="file">' + ICON.file + '<span>' + T('Abrir archivo') + '</span></button>' +
          (window.showDirectoryPicker ? '<button type="button" class="lmd-btn" data-home="dir">' + ICON.folder + '<span>' + T('Abrir carpeta') + '</span></button>' : '') +
        '</div>' +
        '<p class="lmd-home-hint">' + (canPick()
          ? T('También podés arrastrar un archivo o una carpeta a esta ventana.')
          : T('También podés arrastrar un archivo a esta ventana. Este navegador no deja escribir sobre el archivo: al guardar se descarga una copia.')) + '</p>' +
        (window.showDirectoryPicker ? '<p class="lmd-home-notes"></p>' : '') +
        '<p class="lmd-home-msg" role="status" hidden></p>' +
        '<div class="lmd-home-recent" hidden><h2>' + T('Recientes') + '</h2><ul></ul></div>' +
      '</div>' +
      '<a class="lmd-home-coffee" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">' + ICON.coffee + '<span>' + T(ctx.settings.supporter ? 'Gracias por apoyar' : 'Invitame un café') + '</span></a>';
    document.body.appendChild(box);
    const msg = box.querySelector('.lmd-home-msg');
    const say = (text) => { msg.hidden = !text; msg.textContent = text || ''; };
    if (note) say(note);

    const notesLine = box.querySelector('.lmd-home-notes');
    const paintNotes = async () => {
      if (!notesLine) return;
      const folder = await notesFolder();
      notesLine.textContent = '';
      if (folder) {
        notesLine.append(T('Las notas nuevas se guardan en') + ' ', el('b', { text: folder.name }), ' · ');
        notesLine.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-home': 'notes', text: T('Cambiar') }));
      } else notesLine.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-home': 'notes', text: T('Elegir una carpeta para las notas nuevas') }));
    };
    paintNotes();

    const recent = box.querySelector('.lmd-home-recent');
    const paint = async () => {
      const recs = (await rootsAll()).slice(0, 8);
      const notes = (await notesAll()).slice(0, 12);
      recent.hidden = !recs.length && !notes.length;
      const ul = recent.querySelector('ul'); ul.textContent = '';
      notes.forEach((n) => {
        const li = el('li');
        const go = el('a', { class: 'lmd-home-item', href: ctx.APP_URL + '?f=' + encodeURIComponent('local/' + encodeURIComponent(n.name)) });
        go.innerHTML = '<span class="lmd-node-ico">' + ICON.md + '</span><span class="lmd-home-name"></span><span class="lmd-home-path"></span>';
        const first = (n.text.split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').slice(0, 60);
        go.querySelector('.lmd-home-name').textContent = first || n.name;
        go.querySelector('.lmd-home-path').textContent = T('en este navegador');
        const del = el('button', { type: 'button', class: 'lmd-home-del', title: T('Eliminar la nota') }, ICON.close);
        del.addEventListener('click', async () => {
          if (n.text.trim() && !window.confirm(T('¿Eliminar "{a}"? No se puede deshacer.', { a: first || n.name }))) return;
          await noteDelete(n.name); paint();
        });
        li.append(go, del); ul.appendChild(li);
      });
      recs.forEach((r) => {
        const li = el('li');
        const go = el('a', { class: 'lmd-home-item', href: ctx.APP_URL + '?f=' + encodeURIComponent(r.last || r.id + '/') });
        const lastName = decodeURIComponent((r.last || '').split('/').slice(1).join('/'));
        go.innerHTML = '<span class="lmd-node-ico">' + (r.kind === 'dir' ? ICON.folder : ICON.md) + '</span><span class="lmd-home-name"></span><span class="lmd-home-path"></span>';
        go.querySelector('.lmd-home-name').textContent = r.name;
        go.querySelector('.lmd-home-path').textContent = r.kind === 'dir' ? lastName : '';
        const del = el('button', { type: 'button', class: 'lmd-home-del', title: T('Quitar de la lista') }, ICON.close);
        del.addEventListener('click', async () => {
          await handlesDelete(r.key);
          paint();
        });
        li.append(go, del); ul.appendChild(li);
      });
    };
    paint();

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-home]'); if (!b) return;
      say('');
      if (b.dataset.home === 'new') { create(); return; }
      if (b.dataset.home === 'notes') {
        try { await chooseNotesFolder(); paintNotes(); paint(); } catch (err) { if (!(err && err.name === 'AbortError')) say(T('No se pudo abrir. Probá de nuevo.')); }
        return;
      }
      try {
        if (!canPick()) {
          const input = el('input', { type: 'file', accept: '.md,.markdown,.mdx,.mkd,.mdown,.txt' });
          input.addEventListener('change', () => openInMemory(input.files[0], say));
          input.click();
          return;
        }
        if (b.dataset.home === 'dir') await openPicked(await window.showDirectoryPicker({ id: 'lmd-abrir-carpeta', mode: 'readwrite' }), say);
        else {
          const picked = await window.showOpenFilePicker({ id: 'lmd-abrir', multiple: false,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }] });
          await openPicked(picked[0], say);
        }
      } catch (err) {
        if (!(err && err.name === 'AbortError')) say(T('No se pudo abrir. Probá de nuevo.'));
      }
    });
    // Soltar un archivo o una carpeta: se toma su permiso en vez de dejar que Chrome navegue.
    window.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('lmd-drop'); });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) box.classList.remove('lmd-drop'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); box.classList.remove('lmd-drop');
      const item = Array.from(e.dataTransfer.items || []).find((i) => i.kind === 'file');
      if (!item) return;
      if (!canPick() || !item.getAsFileSystemHandle) { openInMemory(item.getAsFile(), say); return; }
      try { await openPicked(await item.getAsFileSystemHandle(), say); } catch (err) { say(T('No se pudo abrir. Probá de nuevo.')); }
    });
  }

  // Al volver otro día Chrome pide confirmar el acceso, y eso necesita un clic.
  function gate(rec, mode) {
    return new Promise((resolve) => {
      LMD.theme.themeOnly(ctx.settings);
      document.title = 'MD Tools';
      document.body.textContent = '';
      const box = el('main', { class: 'lmd-home' });
      box.innerHTML =
        '<div class="lmd-home-card">' +
          '<img class="lmd-home-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
          '<h1></h1>' +
          '<p class="lmd-home-sub">' + T('Chrome pide que confirmes el acceso antes de seguir.') + '</p>' +
          '<div class="lmd-home-actions">' +
            '<button type="button" class="lmd-btn lmd-btn-fill" data-gate="ok"><span>' + T('Continuar') + '</span></button>' +
            '<button type="button" class="lmd-btn" data-gate="no"><span>' + T('Volver al inicio') + '</span></button>' +
          '</div>' +
        '</div>';
      box.querySelector('h1').textContent = rec.name;
      document.body.appendChild(box);
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-gate]'); if (!b) return;
        if (b.dataset.gate === 'no') return resolve(false);
        try { if ((await rec.handle.requestPermission({ mode })) === 'granted') resolve(true); } catch (err) { resolve(false); }
      });
    });
  }

  // Carpeta elegida para las notas nuevas, si hay una.
  const notesFolder = async () => (await rootsAll()).find((r) => r.notes && r.kind === 'dir') || null;

  async function chooseNotesFolder() {
    const handle = await window.showDirectoryPicker({ id: 'lmd-notas', mode: 'readwrite' });
    let mine = null;
    for (const r of await rootsAll()) {
      let same = false;
      try { same = await r.handle.isSameEntry(handle); } catch (e) { /* permiso vencido */ }
      if (same) mine = r;
      else if (r.notes) { r.notes = false; await handlesPut(r); }
    }
    if (!mine) { const id = Math.random().toString(36).slice(2, 10); mine = { key: 'root:' + id, root: true, id, kind: 'dir' }; }
    mine.kind = 'dir'; mine.name = handle.name; mine.handle = handle; mine.notes = true; mine.at = mine.at || Date.now();
    await handlesPut(mine);
    return mine;
  }

  // Archivo nuevo. Con carpeta de notas se crea ahí y queda guardado desde el arranque; sin ella
  // nace en memoria y se elige dónde guardarlo al primer Ctrl+S.
  async function create() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const base = T('nota') + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    const folder = window.showDirectoryPicker ? await notesFolder() : null;
    if (folder) {
      let ok = false;
      try { ok = (await folder.handle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* se pide abajo */ }
      if (!ok) { try { ok = (await folder.handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* hace falta un clic */ } }
      if (!ok) ok = await gate(folder, 'readwrite');
      if (ok) {
        try {
          let file = base + '.md';
          for (let n = 2; n < 50; n++) {
            try { await folder.handle.getFileHandle(file); file = base + '-' + n + '.md'; } catch (e) { break; }
          }
          const h = await folder.handle.getFileHandle(file, { create: true });
          const w = await h.createWritable(); await w.write(''); await w.close();
          folder.last = folder.id + '/' + encodeURIComponent(file); folder.at = Date.now();
          await handlesPut(folder);
          location.replace(ctx.APP_URL + '?f=' + encodeURIComponent(folder.last) + '&edit=1');
          return;
        } catch (e) { /* la carpeta ya no está: sigue en memoria */ }
      }
    }
    // Sin carpeta de notas, la nota queda guardada en el navegador y sigue ahí al volver.
    let name = base + '.md';
    for (let n = 2; n < 50 && await noteGet(name); n++) name = base + '-' + n + '.md';
    await notePut(name, '');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* el navegador decide */ }
    location.replace(ctx.APP_URL + '?f=' + encodeURIComponent('local/' + encodeURIComponent(name)) + '&edit=1');
  }

  LMD.home = {
    create: (c) => { ctx = c; create(); },
    adopt: (c, handle) => { ctx = c; return openPicked(handle, () => {}); },
    show: (c, note) => { ctx = c; return home(note); },
    gate: (c, rec, mode) => { ctx = c; return gate(rec, mode); },
  };
})();
