// Pantalla de inicio de la página propia: abrir un archivo o una carpeta, arrastrar, y los recientes.
(function () {
  'use strict';

  const { ICON, el, MD_RE, SKIP_DIRS } = LMD.kit;
  const { handlesPut, handlesDelete, rootsAll } = LMD.store;
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
    } else if (!MD_RE.test(handle.name) && !/\.txt$/i.test(handle.name)) { say(T('Ese archivo no es Markdown.')); return; }
    rec.last = rec.id + '/' + path;
    await handlesPut(rec);
    location.href = ctx.APP_URL + '?f=' + encodeURIComponent(rec.last);
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
        '<p class="lmd-home-sub">' + T('Abrí un archivo Markdown o una carpeta para leerlo y editarlo acá mismo.') + '</p>' +
        '<div class="lmd-home-actions">' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-home="file">' + ICON.file + '<span>' + T('Abrir archivo') + '</span></button>' +
          '<button type="button" class="lmd-btn" data-home="dir">' + ICON.folder + '<span>' + T('Abrir carpeta') + '</span></button>' +
        '</div>' +
        '<p class="lmd-home-hint">' + T('También podés arrastrar un archivo o una carpeta a esta ventana.') + '</p>' +
        '<p class="lmd-home-msg" role="status" hidden></p>' +
        '<div class="lmd-home-recent" hidden><h2>' + T('Recientes') + '</h2><ul></ul></div>' +
      '</div>' +
      '<a class="lmd-home-coffee" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">' + ICON.coffee + '<span>' + T(ctx.settings.supporter ? 'Gracias por apoyar' : 'Invitame un café') + '</span></a>';
    document.body.appendChild(box);
    const msg = box.querySelector('.lmd-home-msg');
    const say = (text) => { msg.hidden = !text; msg.textContent = text || ''; };
    if (note) say(note);

    const recent = box.querySelector('.lmd-home-recent');
    const paint = async () => {
      const recs = (await rootsAll()).slice(0, 8);
      recent.hidden = !recs.length;
      const ul = recent.querySelector('ul'); ul.textContent = '';
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
      try {
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
      if (!item || !item.getAsFileSystemHandle) return;
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

  LMD.home = {
    show: (c, note) => { ctx = c; return home(note); },
    gate: (c, rec, mode) => { ctx = c; return gate(rec, mode); },
  };
})();
