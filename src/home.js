// Estado vacío de la app: lo que se ve en el centro cuando no hay ninguna nota abierta. Desde acá se
// empieza una nota, se abre un archivo o una carpeta (también arrastrándolos) y se entra a la cuenta.
(function () {
  'use strict';

  const { ICON, el, MD_RE, SKIP_DIRS, validEmail } = LMD.kit;
  const { handlesPut, handlesDelete, rootsAll, notesAll, noteGet, notePut, noteDelete } = LMD.store;
  const T = LMD.t;
  let ctx = null; // { settings, APP_URL, box, open(f, opt), refresh(), say(texto) }, lo pasa el lector al llamar
  let sayNow = null; // cómo mostrar un aviso en el estado vacío que está a la vista

  // Qué se puede hacer sin cuenta y qué suma tenerla, en dos renglones. Lo muestran el inicio y Ajustes → Nube.
  const perks = () => '<dl class="lmd-perks">' +
    '<dt>' + T('Sin cuenta') + '</dt><dd>' + T('Todo el editor, tus archivos del disco y las notas guardadas en este navegador.') + '</dd>' +
    '<dt>' + T('Con cuenta') + '</dt><dd>' + T('Notas en la nube (10 gratis). Compartir, historial y conexión con una IA en el plan pago.') + '</dd></dl>';

  // Entrar a la cuenta: primero el correo, después el código que llega. Es el mismo formulario en el inicio y en Ajustes → Nube.
  const AUTH_ERRORS = { bad_email: 'Ese correo no parece válido.', too_soon: 'Esperá unos segundos antes de pedir otro código.', bad_code: 'Ese código no coincide.', code_expired: 'El código venció. Pedí otro.', too_many_tries: 'Demasiados intentos. Pedí un código nuevo.', offline: 'No hay conexión con el servidor.', mcp_needs_plan: 'Conectar una IA es parte del plan pago.' };
  // Antes de pedir nada al servidor: el correo bien formado y el código de seis dígitos.
  const badMail = (v) => (!v ? 'Escribí tu correo.' : /\s/.test(v) ? 'El correo no lleva espacios.' : !validEmail(v) ? 'Ese correo no parece válido. Tiene que ser como nombre@dominio.com.' : '');
  const badCode = (v) => (/^\d{6}$/.test(v) ? '' : 'El código son seis dígitos.');
  function signIn(box, done, email) {
    box.textContent = '';
    const code = !!email;
    if (code) box.appendChild(el('p', { text: T('Te mandamos un código a {a}.', { a: email }) }));
    const input = code ? el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000', 'data-field': 'code' })
      : el('input', { type: 'email', autocomplete: 'email', spellcheck: 'false', placeholder: T('tu correo'), 'data-field': 'email' });
    const go = el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-cloud': code ? 'verify' : 'start', text: T(code ? 'Entrar' : 'Enviar código') });
    const row = el('div', { class: 'lmd-home-cloud-row' }); row.append(input, go);
    // El aviso va pegado al campo y no borra lo escrito.
    const err = el('p', { class: 'lmd-home-cloud-err', role: 'alert', hidden: '' });
    box.append(row, err); input.focus();
    const fail = (text) => { err.hidden = false; err.textContent = T(text); input.setAttribute('aria-invalid', 'true'); input.focus(); };
    const send = async () => {
      const v = input.value.trim(); const bad = code ? badCode(v) : badMail(v);
      if (bad) { fail(bad); return; }
      try {
        if (code) { await LMD.cloud.verify(email, v); await done(); }
        else { await LMD.cloud.start(v.toLowerCase()); signIn(box, done, v.toLowerCase()); }
      } catch (e) { fail(AUTH_ERRORS[e && e.code] || 'No se pudo completar. Probá de nuevo.'); }
    };
    go.addEventListener('click', send);
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); err.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }

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

  async function openPicked(handle, say, opt) {
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
    return ctx.open(rec.last, opt);
  }

  // Sin File System Access (Firefox, Safari) el archivo se lee una vez y se guarda en la sesión.
  const canPick = () => !!window.showOpenFilePicker;
  async function openInMemory(file, say) {
    if (!file) return;
    try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name: file.name, text: await file.text() })); }
    catch (e) { say(T('No se pudo abrir. Probá de nuevo.')); return; }
    ctx.open('mem/' + encodeURIComponent(file.name));
  }

  // Elegir un archivo o una carpeta del disco. Lo usan el estado vacío y la cabecera del explorador.
  async function pick(what, say) {
    try {
      if (!canPick()) {
        const input = el('input', { type: 'file', accept: '.md,.markdown,.mdx,.mkd,.mdown,.txt' });
        input.addEventListener('change', () => openInMemory(input.files[0], say));
        input.click();
        return;
      }
      if (what === 'dir') await openPicked(await window.showDirectoryPicker({ id: 'lmd-abrir-carpeta', mode: 'readwrite' }), say);
      else {
        const picked = await window.showOpenFilePicker({ id: 'lmd-abrir', multiple: false,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }] });
        await openPicked(picked[0], say);
      }
    } catch (err) {
      if (!(err && err.name === 'AbortError')) say(T('No se pudo abrir. Probá de nuevo.'));
    }
  }

  let dropBound = false;
  async function home(note) {
    const box = ctx.box;
    box.innerHTML =
      '<div class="lmd-home-card">' +
        '<img class="lmd-home-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
        '<p class="lmd-home-sub">' + T('Elegí una nota de la izquierda o empezá una nueva.') + '</p>' +
        '<div class="lmd-home-actions">' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-home="new">' + ICON.plus + '<span>' + T('Nueva nota') + '</span></button>' +
          '<button type="button" class="lmd-btn" data-home="file">' + ICON.file + '<span>' + T('Abrir archivo') + '</span></button>' +
          (window.showDirectoryPicker ? '<button type="button" class="lmd-btn" data-home="dir">' + ICON.folder + '<span>' + T('Abrir carpeta') + '</span></button>' : '') +
        '</div>' +
        '<p class="lmd-home-hint">' + (canPick()
          ? T('También podés arrastrar un archivo o una carpeta a esta ventana.')
          : T('También podés arrastrar un archivo a esta ventana. Este navegador no deja escribir sobre el archivo: al guardar se descarga una copia.')) + '</p>' +
        (window.showDirectoryPicker ? '<p class="lmd-home-notes"></p>' : '') +
        '<div class="lmd-home-cloud" hidden></div>' +
        '<p class="lmd-home-msg" role="status" hidden></p>' +
      '</div>' +
      '<div class="lmd-home-foot"><button type="button" class="lmd-home-coffee" data-home="feedback">' + T('Enviar comentarios') + '</button>' +
        (window.__MDT_WEB ? '<a class="lmd-home-coffee" href="../?site">' + T('Qué es SharpMD') + '</a>' : '') + '</div>';
    const msg = box.querySelector('.lmd-home-msg');
    const say = (text) => { msg.hidden = !text; msg.textContent = text || ''; };
    sayNow = say;
    if (note) say(note);
    // Lo que los paneles de la cuenta necesitan saber del inicio: adónde vuelve el pago y qué repintar al cerrar.
    const host = {
      leave: async () => true, back: location.href.split('#')[0], appUrl: ctx.APP_URL, close: () => {}, closed: () => paintCloud(), say,
      unlocked: (a) => { if (a.plan === 'pro' && !ctx.settings.supporter) { ctx.settings.supporter = true; LMD.patch({ supporter: true }); } },
    };

    const notesLine = box.querySelector('.lmd-home-notes');
    const paintNotes = async () => {
      if (!notesLine) return;
      const folder = await notesFolder();
      notesLine.textContent = '';
      if (folder) {
        notesLine.append(T('Las notas nuevas se guardan en') + ' ', el('b', { text: folder.name }), ' · ');
        notesLine.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-home': 'notes', text: T('Cambiar') }));
      } else { notesLine.append(T('Las notas nuevas se guardan en este navegador') + ' · '); notesLine.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-home': 'notes', text: T('Guardarlas en una carpeta') })); }
    };
    paintNotes();

    // Cuenta: entrar con un código al mail, ver cuántas notas hay y conectar una IA.
    const cloudBox = box.querySelector('.lmd-home-cloud');
    const errors = AUTH_ERRORS;
    const why = (e) => T(errors[e && e.code] || 'No se pudo completar. Probá de nuevo.');
    const paintCloud = async (step, data) => {
      await LMD.cloud.ready();
      cloudBox.hidden = !LMD.cloud.enabled();
      if (cloudBox.hidden) return;
      cloudBox.textContent = '';
      const button = (label, act, fill) => el('button', { type: 'button', class: 'lmd-btn' + (fill ? ' lmd-btn-fill' : ''), 'data-cloud': act, text: label });
      const row = () => { const d = el('div', { class: 'lmd-home-cloud-row' }); cloudBox.appendChild(d); return d; };
      // El aviso va pegado al campo y no borra lo escrito.
      const errLine = () => cloudBox.appendChild(el('p', { class: 'lmd-home-cloud-err', role: 'alert', hidden: '' }));
      // Quién está conectado: el correo en un renglón que no se parte, y debajo el plan y las notas.
      const who = (sub, plans) => {
        const head = el('div', { class: 'lmd-home-acct' }, '<span class="lmd-home-acct-ico">' + ICON.cloudOk + '</span><div class="lmd-home-acct-who"><b></b><small></small></div>');
        head.querySelector('b').textContent = LMD.cloud.email(); head.querySelector('b').title = LMD.cloud.email();
        head.querySelector('small').textContent = sub;
        if (plans) head.querySelector('small').append(' · ', el('button', { type: 'button', class: 'lmd-link', 'data-cloud': 'plan', text: T('Ver planes') }));
        head.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-cloud': 'logout', text: T('Salir') }));
        cloudBox.appendChild(head);
      };
      if (!LMD.cloud.signedIn()) {
        // Sin sesión: qué anda sin cuenta y qué suma tenerla, y debajo el botón o el formulario para entrar.
        cloudBox.innerHTML = perks();
        if (step === 'email') { const form = el('div', { class: 'lmd-signin' }); cloudBox.appendChild(form); signIn(form, async () => { await paintCloud(); ctx.refresh(); }); }
        else row().append(button(T('Crear cuenta o entrar'), 'ask', true));
        return;
      }
      try {
        const a = await LMD.cloud.account();
        host.unlocked(a);
        const pro = a.plan === 'pro';
        who(T(pro ? 'Plan pago' : 'Plan gratis') + ' · ' + (a.limit ? T('{n} de {m} notas', { n: a.notes, m: a.limit }) : T(a.notes === 1 ? '1 nota, sin límite' : '{n} notas, sin límite', { n: a.notes })), !pro);
        row().append(button(T('Abrir la nube'), 'open', true), button(T('Conectar una IA'), 'ai'));
        errLine();
      } catch (e) {
        if (!LMD.cloud.signedIn()) return paintCloud();
        who(why(e));
      }
    };
    cloudBox.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cloud]'); if (!b) return;
      const field = (name) => cloudBox.querySelector('[data-field=' + name + ']');
      const fail = (text, input) => {
        const p = cloudBox.querySelector('.lmd-home-cloud-err');
        if (p) { p.hidden = false; p.textContent = T(text); }
        if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
      };
      const act = b.dataset.cloud;
      try {
        if (act === 'ask') await paintCloud('email');
        else if (act === 'start' || act === 'verify') return; // los atiende el formulario
        else if (act === 'logout') { await LMD.cloud.logout(); await paintCloud(); ctx.refresh(); }
        else if (act === 'open') LMD.sync.openCloud(Object.assign({}, host, { say: (t) => fail(t) }));
        else if (act === 'ai' || act === 'plan') LMD.sync.dialog(act, host);
      } catch (err) { fail(errors[err && err.code] || 'No se pudo completar. Probá de nuevo.', field('code') || field('email')); }
    });
    cloudBox.addEventListener('input', (e) => {
      if (!e.target.matches('[data-field]')) return;
      e.target.removeAttribute('aria-invalid');
      const p = cloudBox.querySelector('.lmd-home-cloud-err'); if (p) p.hidden = true;
    });
    // Vuelta de la página de pago hecha desde acá: el plan, en su ventana, esperando la confirmación.
    if (location.hash === '#lmd-paid') { LMD.sync.dialog('plan', host); LMD.sync.awaitPaid(); }

    // Lo escrito sin conexión en notas que ya no están abiertas se sube al entrar. Con ?login=1 (se llega
    // así desde un archivo abierto directo en el navegador) el correo ya queda pedido.
    LMD.cloud.flush().catch(() => {}).then(() => paintCloud(new URLSearchParams(location.search).has('login') ? 'email' : undefined));

    box.onclick = async (e) => {
      const b = e.target.closest('[data-home]'); if (!b) return;
      say('');
      if (b.dataset.home === 'feedback') { LMD.sync.feedback(); return; }
      if (b.dataset.home === 'new') { create(); return; }
      if (b.dataset.home === 'notes') {
        try { await chooseNotesFolder(); paintNotes(); ctx.refresh(); } catch (err) { if (!(err && err.name === 'AbortError')) say(T('No se pudo abrir. Probá de nuevo.')); }
        return;
      }
      pick(b.dataset.home, say);
    };
    // Soltar un archivo o una carpeta: se toma su permiso en vez de dejar que Chrome navegue.
    // Vale mientras el estado vacío está a la vista; con una nota abierta, arrastrar es cosa del editor.
    if (dropBound) return;
    dropBound = true;
    const shown = (e) => !box.hidden && Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    window.addEventListener('dragover', (e) => { if (!shown(e)) return; e.preventDefault(); box.classList.add('lmd-drop'); });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) box.classList.remove('lmd-drop'); });
    window.addEventListener('drop', async (e) => {
      if (!shown(e)) return;
      e.preventDefault(); box.classList.remove('lmd-drop');
      const tell = (text) => { if (sayNow) sayNow(text); };
      const item = Array.from(e.dataTransfer.items || []).find((i) => i.kind === 'file');
      if (!item) return;
      if (!canPick() || !item.getAsFileSystemHandle) { openInMemory(item.getAsFile(), tell); return; }
      try { await openPicked(await item.getAsFileSystemHandle(), tell); } catch (err) { tell(T('No se pudo abrir. Probá de nuevo.')); }
    });
  }

  // Al volver otro día Chrome pide confirmar el acceso, y eso necesita un clic.
  function gate(rec, mode) {
    return new Promise((resolve) => {
      const box = ctx.box;
      box.hidden = false; box.onclick = null; sayNow = null;
      box.innerHTML =
        '<div class="lmd-home-card">' +
          '<img class="lmd-home-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
          '<h1></h1>' +
          '<p class="lmd-home-sub">' + T('Chrome pide que confirmes el acceso antes de seguir.') + '</p>' +
          '<div class="lmd-home-actions">' +
            '<button type="button" class="lmd-btn lmd-btn-fill" data-gate="ok"><span>' + T('Continuar') + '</span></button>' +
            '<button type="button" class="lmd-btn" data-gate="no"><span>' + T('Cancelar') + '</span></button>' +
          '</div>' +
        '</div>';
      box.querySelector('h1').textContent = rec.name;
      box.onclick = async (e) => {
        const b = e.target.closest('[data-gate]'); if (!b) return;
        if (b.dataset.gate === 'no') return resolve(false);
        try { if ((await rec.handle.requestPermission({ mode })) === 'granted') resolve(true); } catch (err) { resolve(false); }
      };
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
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return T('nota') + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
  // Nota nueva en la nube, con un nombre que no pise a otra. Devuelve su ruta.
  async function cloudNote(base, text) {
    const taken = new Set((await LMD.cloud.list(true)).map((n) => n.path));
    let file = (base || stamp()) + '.md';
    for (let n = 2; n < 50 && taken.has(file); n++) file = (base || stamp()) + '-' + n + '.md';
    if (text) await LMD.cloud.write(file, text); else await LMD.cloud.create(file);
    return file;
  }

  // Nota nueva. Va a la carpeta de notas si hay una; si no, a la nube con la cuenta abierta; si no, al navegador.
  // opt: name y text (para arrancar con contenido), target 'local' (siempre al navegador) y replace.
  async function create(opt) {
    opt = opt || {};
    const how = { edit: true, replace: !!opt.replace, tree: true };
    const base = opt.name || stamp(); const text = opt.text || '';
    const folder = opt.target !== 'local' && window.showDirectoryPicker ? await notesFolder() : null;
    if (folder) {
      let ok = false;
      try { ok = (await folder.handle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* se pide abajo */ }
      if (!ok) { try { ok = (await folder.handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* hace falta un clic */ } }
      if (!ok && !ctx.box.hidden) ok = await gate(folder, 'readwrite');
      if (ok) {
        try {
          let file = base + '.md';
          for (let n = 2; n < 50; n++) {
            try { await folder.handle.getFileHandle(file); file = base + '-' + n + '.md'; } catch (e) { break; }
          }
          const h = await folder.handle.getFileHandle(file, { create: true });
          const w = await h.createWritable(); await w.write(text); await w.close();
          folder.last = folder.id + '/' + encodeURIComponent(file); folder.at = Date.now();
          await handlesPut(folder);
          return ctx.open(folder.last, how);
        } catch (e) { /* la carpeta ya no está: sigue en memoria */ }
      }
    }
    // Con la cuenta abierta, la nota nueva va a la nube.
    await LMD.cloud.ready();
    if (opt.target !== 'local' && LMD.cloud.signedIn()) {
      try {
        const file = await cloudNote(base, text);
        return ctx.open('cloud/' + encodeURIComponent(file), how);
      } catch (e) { /* sin conexión o sin lugar: sigue en el navegador */ }
    }
    // Sin carpeta de notas, la nota queda guardada en el navegador y sigue ahí al volver.
    let name = base + '.md';
    for (let n = 2; n < 50 && await noteGet(name); n++) name = base + '-' + n + '.md';
    await notePut(name, text);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* el navegador decide */ }
    return ctx.open('local/' + encodeURIComponent(name), how);
  }

  LMD.home = {
    create: (c, opt) => { ctx = c; return create(opt); },
    cloudNote: () => cloudNote(),
    // Un archivo recién guardado pasa a ser la nota abierta: reemplaza en el historial a la que era.
    adopt: (c, handle) => { ctx = c; return openPicked(handle, () => {}, { replace: true }); },
    show: (c, note) => { ctx = c; return home(note); },
    say: (text) => { if (sayNow) sayNow(text); },
    pick: (c, what) => { ctx = c; return pick(what, c.say); },
    perks, signIn,
    gate: (c, rec, mode) => { ctx = c; return gate(rec, mode); },
  };
})();
