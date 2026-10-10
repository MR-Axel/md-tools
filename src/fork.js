// Usar una plantilla. Quien abre una carpeta compartida como plantilla (por su enlace, o por sharpmd.app/t/<nombre>)
// la ve sin poder cambiarla, y se lleva una copia propia para editar. Lo que haga con la copia no toca el original
// ni lo ve nadie más. Tres salidas:
//  - Copiar a este navegador: sin cuenta. La carpeta entera, con sus subcarpetas, queda en "En este navegador".
//  - Copiar a mi nube: si no hay sesión, se entra acá mismo con el código que llega al correo (el alta de siempre,
//    con sus topes) y la copia sigue sola. La revisión previa es la de "Enviar a la nube" (send.js): cuánto lugar
//    queda en el plan y qué ya existe.
//  - Descargar: un ZIP con los .md y las mismas carpetas.
// Si la plantilla pide una cuenta, ninguna de las tres está sin sesión (leerla sí). Al terminar una copia completa se
// le avisa al servidor, que la cuenta sin anotar de quién es.
// Las imágenes que las notas nombran por su dirección (los adjuntos de la nube son direcciones públicas) siguen
// apuntando al mismo lugar: no se duplican.
// Se pide recién al abrir una plantilla (LAZY_APP en content.js).
(function () {
  'use strict';

  const { el, esc, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null; let box = null; let waiting = 0; let busy = false;

  const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const folderOf = (k) => LMD.send.cleanName(k.info.name) || T('plantilla');
  const needsLogin = (k) => !!k.info.template.login && !LMD.cloud.signedIn();
  function close() { clearInterval(waiting); if (box) { box.remove(); box = null; } }
  const WHY = { offline: 'No hay conexión con el servidor.', need_account: 'Esta plantilla pide una cuenta. Entrá para usarla.', too_many: 'Demasiados intentos desde esta red. Probá de nuevo en un rato.',
    too_large: 'Esta plantilla pesa demasiado para copiarla de una vez.', template_gone: 'Esta plantilla ya no está disponible.', not_found: 'Esta plantilla ya no está disponible.', not_template: 'Esta plantilla ya no está disponible.',
    store: 'No se pudo guardar la copia en este navegador.', zip: 'No se pudo armar el archivo. Probá de nuevo.' };
  // Lo que salió mal se dice en la ventana si está abierta; si no, en la tira del pie.
  function say(e) {
    const text = T(WHY[e && e.code] || 'No se pudo completar. Probá de nuevo.');
    const err = box && box.querySelector('.lmd-img-err');
    if (err) { err.hidden = false; err.textContent = text; } else LMD.send.notice(text, null, true);
  }
  // Una ruta adentro de la carpeta, como las guarda la nube: tramos con nombre, sin "..", sin barras invertidas.
  // Lo que no sea eso no se copia ni entra al ZIP, venga del servidor que venga.
  const okPath = (p) => typeof p === 'string' && !!p && p.length <= 300 && !/[\\\u0000-\u001f]/.test(p) && p.split('/').every((s) => s && s !== '.' && s !== '..' && s === s.trim());
  // Todas las notas, con su texto. Una plantilla que pide cuenta las entrega solo con sesión.
  async function fetchAll(k) {
    try { return (await LMD.cloud.pubFolder(k.ref, '?all=1')).notes.filter((n) => n && okPath(n.path) && typeof n.text === 'string'); } catch (e) { say(e); return null; }
  }
  // Una copia completa más: lo cuenta el servidor. Si no llega, la copia ya está hecha igual.
  const counted = (k) => LMD.cloud.pubFolder(k.ref, '', 'copied').catch(() => null);
  // La cuenta recién abierta se pone a la vista: el pie, el explorador y lo que sabe la app del plan.
  async function signedIn() {
    try { await LMD.sync.reload(); } catch (e) { /* se vuelve a leer al copiar */ }
    try { LMD.home.account(); core.reloadTree(); } catch (e) { /* se redibuja en la próxima */ }
  }

  // ---------- A este navegador ----------
  async function toBrowser(k, given) {
    if (busy) return; busy = true;
    try {
      const list = given || await fetchAll(k); if (!list) return;
      const names = new Set((await LMD.store.notesAll()).map((n) => n.name));
      const has = (f) => Array.from(names).filter((n) => n.startsWith(f + '/'));
      let folder = folderOf(k); const there = has(folder);
      if (there.length) {
        // Ya hay una carpeta con ese nombre: puede ser la copia de otra vez. Se abre esa, o se hace otra.
        close();
        const pick = await LMD.send.again(folder, true);
        if (!pick) return;
        if (pick === 'open') { await core.open(core.localUrl(there.includes(folder + '/' + k.first) ? folder + '/' + k.first : there.sort(nat)[0]), { tree: true, edit: 'on' }); return; }
        const base = folder; let n = 2; while (has(base + '-' + n).length) n++;
        folder = base + '-' + n;
      }
      const put = [];
      for (const n of list) {
        if (await LMD.store.notePut(folder + '/' + n.path, n.text)) { put.push(folder + '/' + n.path); continue; }
        // Sin lugar en el navegador: no queda una copia a medias.
        for (const name of put) { try { await LMD.store.noteDelete(name); } catch (e) { /* queda para borrarla a mano */ } }
        say({ code: 'store' }); return;
      }
      close();
      counted(k);
      const first = put.includes(folder + '/' + k.first) ? folder + '/' + k.first : put.slice().sort(nat)[0];
      await core.open(core.localUrl(first), { tree: true, edit: 'on' });
      LMD.send.notice(T('La copia quedó en este navegador, en "{a}". El original no cambia.', { a: folder }));
    } finally { busy = false; }
  }

  // ---------- A la nube ----------
  async function toCloud(k) {
    if (!LMD.cloud.signedIn()) return signIn(k, () => toCloud(k));
    if (busy) return; busy = true;
    // Si no entra en el plan, la revisión ofrece las otras dos salidas: la elegida sale cuando esta termina.
    let other = null;
    try {
      const list = await fetchAll(k); if (!list) return;
      close();
      const out = await LMD.send.template({ name: k.info.name, notes: list, first: k.first, browser: () => { other = () => toBrowser(k, list); }, download: () => { other = () => toZip(k, list); } });
      if (!out) return;
      if (out.open) { await core.open(core.urlOf(out.open), { tree: true, edit: 'on' }); return; }
      counted(k);
      await core.open(core.urlOf(out.first), { tree: true, edit: 'on' });
      LMD.send.notice(out.n === 1 ? T('Se copió 1 nota a tu nube, en "{a}". El original no cambia.', { a: out.folder }) : T('Se copiaron {n} notas a tu nube, en "{a}". El original no cambia.', { n: out.n, a: out.folder }));
    } finally { busy = false; if (other) other(); }
  }

  // ---------- Un ZIP ----------
  async function toZip(k, given) {
    const list = given || await fetchAll(k); if (!list) return;
    if (!(await core.ensure('docx')) || !LMD.docx) { say({ code: 'zip' }); return; }
    const folder = folderOf(k); const enc = new TextEncoder();
    let bytes = null;
    try { bytes = await LMD.docx.zip(list.slice().sort((a, b) => nat(a.path, b.path)).map((n) => ({ name: folder + '/' + n.path, data: enc.encode(n.text) }))); } catch (e) { say({ code: 'zip' }); return; }
    const how = LMD.kit.saveFile(new Blob([bytes], { type: 'application/zip' }), folder + '.zip');
    counted(k); close();
    if (how === 'download') LMD.send.notice(T('Se descargó "{a}". El original no cambia.', { a: folder + '.zip' }));
  }

  // ---------- Entrar, acá mismo ----------
  // El formulario de siempre (home.js): el correo, y el código que llega. Con el código la cuenta queda creada si no
  // existía, y lo que la persona pidió (then) sigue solo. También si entró desde el botón del correo, en otra pestaña.
  function signIn(k, then) {
    close();
    const title = T('Entrar para usar la plantilla');
    box = el('div', { class: 'lmd-ask lmd-fork lmd-fork-login' });
    box.innerHTML = '<div class="lmd-ask-card lmd-login lmd-fork-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3>' +
      '<p class="lmd-login-sub">' + T('Escribí tu correo y te mandamos un código, sin contraseña. Si no tenés cuenta, se crea al entrar.') + '</p>' +
      '<div class="lmd-signin"></div>' +
      '<p class="lmd-hint lmd-fork-next">' + T('Al entrar, la copia sigue sola.') + '</p>' +
      '<button type="button" class="lmd-link lmd-login-cancel" data-fk="back" data-esc>' + T('Volver') + '</button></div>';
    document.body.appendChild(box);
    const mine = box; let went = false;
    const go = async () => { if (went) return; went = true; clearInterval(waiting); await signedIn(); if (box === mine) close(); then(); };
    box.addEventListener('click', (e) => { if (e.target.closest('[data-fk=back]')) { close(); open(core, ''); } });
    box.addEventListener('mousedown', (e) => { if (e.target === mine) close(); });
    LMD.home.signIn(box.querySelector('.lmd-signin'), go);
    waiting = setInterval(() => { if (!mine.isConnected) { clearInterval(waiting); return; } if (LMD.cloud.signedIn()) go(); }, 700);
  }

  // ---------- La ventana ----------
  // why 'edit': la persona quiso editar el original (doble clic, una tecla, una tarea).
  function open(c, why) {
    core = c;
    const k = core.pub();
    if (!k || !k.info.template || (box && box.isConnected) || document.querySelector('.lmd-send')) return;
    const title = T('Usar esta plantilla');
    const cloud = LMD.cloud.enabled(); const signed = LMD.cloud.signedIn(); const need = needsLogin(k);
    const way = (key, icon, name, sub, off) => '<button type="button" class="lmd-fork-way" data-fk="' + key + '"' + (off ? ' disabled' : '') + '>' + ICON[icon] + '<span><b>' + T(name) + '</b><small>' + sub + '</small></span></button>';
    box = el('div', { class: 'lmd-ask lmd-fork' });
    box.innerHTML = '<div class="lmd-ask-card lmd-fork-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3>' +
      '<p class="lmd-fork-lead">' + T(why === 'edit' ? 'El original no se edita. Llevate una copia y editala.' : 'Te queda una copia para editar. El original no cambia.') + '</p>' +
      '<div class="lmd-fork-ways">' +
        way('browser', 'browser', 'Copiar a este navegador', T(need ? 'Pide una cuenta.' : 'Sin cuenta. Queda guardada en este dispositivo.'), need) +
        (cloud ? way('cloud', 'cloud', 'Copiar a mi nube', signed ? esc(T('En tu cuenta, {a}.', { a: LMD.cloud.email() })) : T('Te pedimos el correo y te mandamos un código.')) : '') +
        way('zip', 'download', 'Descargar', T(need ? 'Pide una cuenta.' : 'Un ZIP con las notas en Markdown.'), need) +
      '</div>' +
      (need ? '<p class="lmd-hint lmd-fork-need">' + T('Esta plantilla pide una cuenta para copiarla o descargarla.') + (cloud ? ' <button type="button" class="lmd-link" data-fk="signin">' + T('Entrar') + '</button>' : '') + '</p>' : '') +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-fk="no" data-esc>' + T('Cancelar') + '</button></div></div>';
    document.body.appendChild(box);
    const mine = box;
    box.addEventListener('mousedown', (e) => { if (e.target === mine) close(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fk]'); if (!b || b.disabled) return;
      const err = mine.querySelector('.lmd-img-err'); if (err) err.hidden = true;
      const f = b.dataset.fk;
      if (f === 'no') close();
      else if (f === 'signin') signIn(k, () => open(core, ''));
      else if (f === 'browser') toBrowser(k);
      else if (f === 'cloud') toCloud(k);
      else if (f === 'zip') toZip(k);
    });
    setTimeout(() => { const b = mine.querySelector('.lmd-fork-way:not([disabled])'); if (b && mine.isConnected && !mine.contains(document.activeElement)) b.focus(); }, 0);
  }

  LMD.fork = { open, close };
})();
