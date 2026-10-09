// Carpetas con contraseña de la nube: la interfaz. Proteger una carpeta, desbloquearla en esta pestaña, entrar con
// la clave de respaldo, cambiar la contraseña, quitar la protección y desbloquearla para la IA por un tiempo.
// El espacio de un equipo se protege entero, con una sola contraseña que pone quien lo administra: acá es una
// carpeta protegida más (v.team), cuya "carpeta" es la raíz ~espacio. Cambia quién puede qué, y eso lo mira el servidor.
// El cifrado está en seal.js, y lo que hace que el resto de la app lea y guarde sin enterarse, en cloud.js.
// La contraseña y la llave nunca salen de este navegador, con una sola excepción que la persona pide y confirma:
// desbloquear para la IA manda la llave de datos al servidor, que la guarda en memoria hasta que vence.
(function () {
  'use strict';

  const { el, ICON, esc } = LMD.kit;
  const T = LMD.t; const Z = LMD.seal;
  let core = null;
  const who = () => LMD.cloud.email();
  const all = () => LMD.cloud.vaultsNow();
  // La carpeta protegida que contiene a una nota de la nube (propia, o del equipo si su espacio está protegido), o nada.
  const has = (v, path) => LMD.cloud.vaultHas(v, path);
  const of = (path) => (!path ? null : all().find((v) => has(v, path)) || null);
  // El espacio del equipo, si está protegido. Su nombre es el del equipo.
  const teamV = () => all().find((v) => v.team) || null;
  // Toda la nube de la cuenta protegida con una sola contraseña: una carpeta protegida sin carpeta (la raíz).
  const isRoot = (v) => !!v && !v.team && !v.folder;
  const rootV = () => all().find(isRoot) || null;
  const teamName = () => { const t = LMD.cloud.teamNow(); return (t && t.name) || T('Equipo'); };
  const nameOf = (v) => (v.team ? teamName() : v.folder || T('Tu nube'));
  // Lo que escribe quien administra para confirmar algo que no tiene vuelta: el nombre del equipo o, si no tiene, su correo.
  const confirmWord = () => { const t = LMD.cloud.teamNow(); return (t && t.name) || who(); };
  const byId = (id) => all().find((v) => v.id === +id) || null;
  const isOpen = (vault) => Z.held(vault);
  const can = () => Z.supported() && LMD.cloud.vaultOk();

  const say = (e, fallback) => T({ offline: 'No hay conexión con el servidor.', bad_password: 'Esa contraseña no coincide.', too_many: 'Demasiados intentos. Probá de nuevo más tarde.',
    vault_nested: 'Una carpeta protegida no puede estar dentro de otra.', bad_confirm: 'Eso no coincide con lo que hay que escribir.', mcp_needs_plan: 'Desbloquear una carpeta para la IA es parte del plan pago.',
    not_admin: 'Eso lo hace quien administra el equipo.', ai_not_allowed: 'Quien administra el equipo no habilitó desbloquear para la IA.',
    vault_rotating: 'El equipo está cambiando su llave. Probá en un momento.', vault_exists: 'El espacio del equipo ya está protegido.' }[e && e.code] || fallback || 'No se pudo completar. Probá de nuevo.');
  const hour = (ms) => new Date(ms).toLocaleTimeString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { hour: '2-digit', minute: '2-digit' });
  // Cómo se dice el estado de una carpeta frente a la IA.
  const aiText = (v) => (!v.ai ? T('Bloqueada para la IA') : v.ai.until ? T('Abierta para la IA hasta las {a}', { a: hour(v.ai.until) }) : T('Abierta para la IA hasta que la bloquees'));

  // ---------- Ventanas ----------
  // Una ventana con título, cuerpo y botones. Enter confirma con el botón principal y Escape la cierra (data-esc).
  function sheet(title, body, buttons) {
    const box = el('div', { class: 'lmd-ask lmd-vault' });
    box.innerHTML = '<div class="lmd-ask-card lmd-vault-card" role="dialog" aria-modal="true"><h3></h3><div class="lmd-vault-body">' + body + '</div>' +
      '<p class="lmd-dlg-err" role="alert" hidden></p><div class="lmd-ask-actions">' + buttons + '</div></div>';
    box.querySelector('h3').textContent = title; box.querySelector('.lmd-vault-card').setAttribute('aria-label', title);
    document.body.appendChild(box);
    const err = box.querySelector('.lmd-dlg-err');
    const o = {
      box, q: (name) => box.querySelector('[data-v=' + name + ']'),
      fail: (text, input) => { err.hidden = !text; err.textContent = text || ''; if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); } },
      // Mientras trabaja (derivar la llave tarda un momento) los botones no responden dos veces.
      busy: (on) => box.querySelectorAll('.lmd-ask-actions button').forEach((b) => { b.disabled = on; }),
      close: () => box.remove(),
    };
    box.addEventListener('input', (e) => { if (e.target.matches('input, textarea')) { e.target.removeAttribute('aria-invalid'); err.hidden = true; } });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con la ventana abierta
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); const b = box.querySelector('[data-v=ok]'); if (b && !b.disabled) b.click(); }
    });
    const first = box.querySelector('input:not([type=checkbox]), textarea');
    if (first && !LMD.touch.coarse()) first.focus();
    return o;
  }
  const field = (name, label, auto) => '<label class="lmd-dlg-field"><span>' + T(label) + '</span><input type="password" data-v="' + name + '" autocomplete="' + (auto || 'off') + '" spellcheck="false"></label>';
  const cancel = (label) => '<button type="button" class="lmd-btn" data-v="no" data-esc>' + T(label || 'Cancelar') + '</button>';
  const okBtn = (label, danger) => '<button type="button" class="lmd-btn ' + (danger ? 'lmd-btn-danger' : 'lmd-btn-fill') + '" data-v="ok">' + T(label) + '</button>';
  const meter = '<div class="lmd-vault-meter" data-v="meter" data-s="0"><i></i><i></i><i></i><span></span></div>';
  const STRENGTH = ['Al menos 8 caracteres', 'Débil', 'Aceptable', 'Fuerte'];
  // El indicador sigue a lo que se escribe en el campo de la contraseña nueva.
  function watch(o, name) {
    const input = o.q(name); const m = o.q('meter');
    const paint = () => { const s = Z.strength(input.value); m.dataset.s = input.value ? String(s) : ''; m.querySelector('span').textContent = input.value ? T(STRENGTH[s]) : ''; };
    input.addEventListener('input', paint); paint();
  }
  // Una contraseña nueva escrita dos veces. Devuelve la contraseña, o nada después de avisar qué falta.
  function fresh(o, one, two) {
    const a = o.q(one); const b = o.q(two);
    if (Z.strength(a.value) < 1) { o.fail(T('La contraseña tiene que tener al menos 8 caracteres.'), a); return ''; }
    if (a.value !== b.value) { o.fail(T('Las dos contraseñas no coinciden.'), b); return ''; }
    return a.value;
  }
  const bar = (label) => '<p class="lmd-vault-step" role="status" data-v="step">' + T(label, { n: 0, m: 0 }) + '</p><div class="lmd-vault-bar"><i data-v="fill"></i></div>';
  const stepper = (o, label) => (n, m) => { const p = o.q('step'); if (p) p.textContent = T(label, { n, m }); const f = o.q('fill'); if (f) f.style.width = (m ? Math.round((n / m) * 100) : 100) + '%'; };

  // De la contraseña a la llave abierta en esta pestaña. Devuelve K (para quien la necesita) o tira bad_password.
  async function openWith(vault, password) {
    const K = await Z.unwrap(vault, password);
    const d = await Z.derive(K);
    if (d.check !== vault.check) throw Object.assign(new Error('bad_password'), { code: 'bad_password' });
    Z.hold(vault, d.key);
    return K;
  }
  // La nota abierta, si está dentro de esa carpeta.
  const openIn = (vault) => (core.appRoot && core.appRoot.kind === 'cloud' && !core.noDoc && has(vault, core.cloudPath) ? core.cloudPath : '');
  const reopen = (path) => core.open(core.urlOf(path), { replace: true, discard: true, tree: true });
  // Después de un cambio: la lista de carpetas, el explorador y Ajustes → IA quedan al día.
  async function refresh() {
    try { await LMD.cloud.vaults(true); } catch (e) { /* sin conexión: queda lo que había */ }
    await warm(); arm();
    if (core && core.APP) { try { await core.reloadTree(); } catch (e) { /* el explorador se redibuja en la próxima */ } }
    LMD.sync.repaintAi();
    teamFns.forEach((fn) => { try { fn(); } catch (e) { /* quien escucha se arregla */ } });
  }
  // Quien dibuja la gestión del equipo (Ajustes, Plan) se entera cuando cambia algo de una carpeta protegida.
  const teamFns = [];
  // Las llaves recordadas en este dispositivo quedan abiertas desde el arranque.
  const keptSet = new Set();
  async function warm() {
    keptSet.clear();
    for (const v of all()) { try { if (await Z.keyFor(who(), v)) { if (await Z.remembered(who(), v)) keptSet.add(v.check); } } catch (e) { /* sin IndexedDB */ } }
  }
  // Al vencer el plazo de una carpeta abierta para la IA, el estado se vuelve a pintar aunque no llegue el aviso.
  let timer = null;
  function arm() {
    clearTimeout(timer);
    const next = all().filter((v) => v.ai && v.ai.until).map((v) => v.ai.until).sort((a, b) => a - b)[0];
    if (next) timer = setTimeout(() => { LMD.cloud.vaultStale(); refresh(); }, Math.min(Math.max(next - Date.now(), 0) + 800, 2147000000));
  }

  // ---------- Proteger una carpeta ----------
  function backupFile(folder, key) {
    // folder vacío: toda la nube de la cuenta.
    const team = folder == null; const root = folder === ''; if (team) folder = teamName(); if (root) folder = T('nube');
    const text = 'SharpMD\n' + T(team ? 'Clave de respaldo del espacio de un equipo' : root ? 'Clave de respaldo de la nube protegida' : 'Clave de respaldo de una carpeta protegida') + '\n\n' + (team ? T('Equipo') + ': ' + folder + '\n' : root ? '' : T('Carpeta') + ': ' + folder + '/\n') + T('Cuenta') + ': ' + who() + '\n' + T('Fecha') + ': ' + new Date().toISOString().slice(0, 10) + '\n\n' + key + '\n\n' +
      T(team ? 'Con esta clave quien administra el equipo pone una contraseña nueva si la contraseña se olvida. Quien la tenga puede leer las notas del equipo: guardala en un lugar seguro, fuera de este dispositivo.'
        : root ? 'Con esta clave se entra a la nube y se pone una contraseña nueva si la contraseña se olvida. Quien la tenga puede leer esas notas: guardala en un lugar seguro, fuera de este dispositivo.'
        : 'Con esta clave se entra a la carpeta y se pone una contraseña nueva si la contraseña se olvida. Quien la tenga puede leer esas notas: guardala en un lugar seguro, fuera de este dispositivo.') + '\n';
    const a = el('a', { download: 'sharpmd-' + T('clave-de-respaldo') + '-' + folder.replace(/[^\p{L}\p{N}_-]+/gu, '-') + '.txt' });
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ } t.remove(); }
  }

  // folder null: el espacio del equipo entero, que protege quien lo administra.
  async function protect(folder) {
    const team = folder == null; const root = folder === '';
    // Toda la nube con una contraseña no convive con carpetas que ya tienen la suya: no va una dentro de otra.
    if (root && all().some((v) => !v.team)) { core.flash(T(rootV() ? 'Tu nube ya está protegida.' : 'Ya tenés carpetas protegidas. Para proteger toda la nube, primero quitales la protección.'), 'warn'); return; }
    if (!root && (team ? !!teamV() : all().some((v) => !v.team && (!v.folder || v.folder === folder || folder.startsWith(v.folder + '/') || v.folder.startsWith(folder + '/'))))) { core.flash(T(team ? 'El espacio del equipo ya está protegido.' : 'Una carpeta protegida no puede estar dentro de otra.'), 'warn'); return; }
    if (core.dirty && !(await core.save(false))) return;
    const title = team ? T('Proteger el espacio de "{a}"', { a: teamName() }) : root ? T('Proteger tu nube con contraseña') : T('Proteger "{a}" con contraseña', { a: folder });
    // Primer paso: la contraseña y lo que hay que saber antes de crearla.
    const o = sheet(title,
      '<p>' + T(team ? 'Las notas del equipo se cifran en el navegador de cada miembro antes de subir. El servidor guarda el texto cifrado y no lo puede leer.'
        : root ? 'Tus notas y sus imágenes se cifran en este navegador antes de subir, las que ya tenés y las nuevas. Quedan cifradas de extremo a extremo.'
        : 'Las notas de esta carpeta se cifran en este navegador antes de subir. El servidor guarda el texto cifrado y no lo puede leer.') + '</p>' +
      (team ? '<p>' + T('Es una sola contraseña para todo el equipo. Pasásela a cada miembro por fuera de SharpMD.') + '</p>' : '') +
      // Toda la nube: qué cambia, en una lista corta, antes de la contraseña.
      (root ? '<ul class="lmd-vault-notes lmd-vault-changes"><li>' + T('El servidor ya no puede leer tus notas. Los nombres de las notas y de las carpetas no se cifran.') + '</li>' +
        '<li>' + T('Compartir, los enlaces públicos, publicar un sitio y las automatizaciones dejan de estar disponibles. Lo que ya estaba compartido o publicado deja de estarlo.') + '</li>' +
        '<li>' + T('Tu IA por MCP lee tus notas solo si las desbloqueás para ella por un rato.') + '</li>' +
        '<li>' + T('El historial anterior, la papelera y los comentarios para la IA se eliminan del servidor.') + '</li></ul>' : '') +
      '<p class="lmd-vault-warn">' + T(root ? 'Si perdés la contraseña y la clave de respaldo, tus notas no se pueden recuperar. Tampoco desde SharpMD.' : 'Sin la contraseña y sin la clave de respaldo, estas notas no se pueden recuperar. Tampoco desde SharpMD.') + '</p>' +
      field('p1', 'Contraseña', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password') +
      (root ? '' : '<ul class="lmd-vault-notes"><li>' + T('Los nombres de las notas y de las carpetas no se cifran.') + '</li>' +
        '<li>' + T(team ? 'El historial anterior y la papelera del equipo se eliminan del servidor.' : 'El historial anterior de estas notas se elimina del servidor.') + '</li>' +
        '<li>' + T(team ? 'La IA lee las notas del equipo solo mientras alguien las desbloquee para ella.'
          : 'En esta carpeta no hay compartir, enlaces públicos ni comentarios para la IA. Lo que ya estaba compartido deja de estarlo.') + '</li></ul>'),
      cancel() + okBtn('Continuar'));
    watch(o, 'p1');
    const password = await new Promise((resolve) => {
      o.box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); resolve(''); return; }
        if (b && b.dataset.v === 'ok') { const p = fresh(o, 'p1', 'p2'); if (p) { o.close(); resolve(p); } }
      });
    });
    if (!password) return;
    // Segundo paso: la clave de respaldo. No se sigue sin descargarla o copiarla.
    const K = Z.newKey(); const key = Z.backupText(K);
    const s = sheet(T('Guardá la clave de respaldo'),
      '<p>' + T(team ? 'Con esta clave ponés una contraseña nueva si la del equipo se olvida. Guardala fuera de este dispositivo.'
        : root ? 'Con esta clave se entra a tu nube si te olvidás la contraseña. Guardala fuera de este dispositivo: no se vuelve a mostrar.'
        : 'Con esta clave se entra a la carpeta si te olvidás la contraseña. Guardala fuera de este dispositivo: no se vuelve a mostrar.') + '</p>' +
      '<div class="lmd-vault-key" data-v="key"></div>' +
      '<div class="lmd-vault-keyacts"><button type="button" class="lmd-btn" data-v="down">' + ICON.download + '<span>' + T('Descargar') + '</span></button><button type="button" class="lmd-btn" data-v="copy">' + ICON.copy + '<span>' + T('Copiar') + '</span></button></div>' +
      '<p class="lmd-hint" data-v="need">' + T('Descargala o copiala para seguir.') + '</p>' +
      '<div data-v="work" hidden>' + bar('Cifrando notas: {n} de {m}') + '</div>',
      cancel() + okBtn(team ? 'Proteger el espacio' : root ? 'Proteger mi nube' : 'Proteger la carpeta'));
    // Cada grupo en su casilla: bajan de renglón enteros. Al copiar o descargar van unidos con guiones.
    s.q('key').innerHTML = key.split('-').map((g) => '<span>' + g + '</span>').join(''); s.q('ok').disabled = true;
    const saved = () => { s.q('ok').disabled = false; s.q('need').textContent = T(team ? 'Clave guardada. Ya podés proteger el espacio.' : root ? 'Clave guardada. Ya podés proteger tu nube.' : 'Clave guardada. Ya podés proteger la carpeta.'); };
    let working = false;
    s.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]'); if (working) return;
      if (e.target === s.box || (b && b.dataset.v === 'no')) { K.fill(0); s.close(); return; }
      if (!b) return;
      if (b.dataset.v === 'down') { backupFile(folder, key); saved(); return; }
      if (b.dataset.v === 'copy') { await copyText(key); b.querySelector('span').textContent = T('Copiado'); saved(); return; }
      if (b.dataset.v !== 'ok') return;
      working = true; s.busy(true); s.fail('');
      let vault = null;
      try {
        const d = await Z.derive(K);
        const body = Object.assign(team ? { check: d.check } : root ? { root: true, check: d.check } : { folder, check: d.check }, await Z.wrap(K, password));
        // La llave queda abierta acá antes de crear la carpeta: desde ese momento lo que se guarde ahí sale cifrado.
        Z.hold({ check: d.check }, d.key);
        vault = team ? await LMD.cloud.teamVaultCreate(body) : await LMD.cloud.vaultCreate(body);
        K.fill(0);
        s.q('key').hidden = true; s.box.querySelector('.lmd-vault-keyacts').hidden = true; s.q('need').hidden = true; s.q('work').hidden = false;
        await LMD.cloud.sealFolder(vault, stepper(s, 'Cifrando notas: {n} de {m}'));
        s.close();
        const here = openIn(vault);
        await refresh();
        // La nota abierta se vuelve a abrir antes de avisar: si no, al terminar de abrirse pisa el aviso.
        if (here) { try { await reopen(here); } catch (e) { /* se abre en la próxima */ } }
        core.flash(T(team ? 'Espacio del equipo protegido' : root ? 'Tu nube quedó protegida' : 'Carpeta protegida'));
      } catch (err) {
        working = false; s.busy(false);
        // Creada pero a medias: lo que falta se cifra al volver a abrir la carpeta, con la contraseña.
        if (vault) { s.box.querySelector('[data-v=ok]').hidden = true; s.box.querySelector('[data-v=no]').textContent = T('Cerrar'); s.fail(T(team ? 'Se cortó antes de terminar. Las notas que faltan se cifran al desbloquear el espacio.' : root ? 'Se cortó antes de terminar. Las notas que faltan se cifran al desbloquear tu nube.' : 'Se cortó antes de terminar. Las notas que faltan se cifran al desbloquear la carpeta.')); refresh(); }
        else { await Z.forget(who(), { check: (await Z.derive(K)).check }); s.fail(say(err)); }
      }
    });
  }

  // ---------- Desbloquear en esta pestaña ----------
  const asking = new Map();
  // Pide la contraseña una vez. Devuelve true si la carpeta quedó abierta.
  function unlock(vault) {
    if (!vault) return Promise.resolve(false);
    // A mitad de una rotación de la llave del equipo: quien administra la termina; los demás esperan.
    if (vault.team && vault.state === 'rotating') {
      if (vault.admin) return rotate(vault).then(() => { const now = teamV(); return !!now && isOpen(now); });
      core.flash(T('El equipo está cambiando su llave. Probá en un momento.'), 'warn');
      return Promise.resolve(false);
    }
    if (isOpen(vault)) return Promise.resolve(true);
    if (asking.has(vault.id)) return asking.get(vault.id);
    // En el equipo, la contraseña la tiene quien administra: un miembro no la recupera ni la cambia.
    const member = vault.team && !vault.admin;
    const p = new Promise((resolve) => {
      const o = sheet(T('Desbloquear "{a}"', { a: nameOf(vault) }),
        '<p>' + T(vault.team ? 'Las notas del equipo están protegidas con contraseña.' : isRoot(vault) ? 'Tu nube está protegida con contraseña.' : 'Esta carpeta está protegida con contraseña.') + '</p>' +
        (member ? '<p class="lmd-hint" data-v="ask">' + T('Pedile la contraseña a quien administra el equipo.') + '</p>' : '') + field('p', 'Contraseña', 'current-password') +
        '<label class="lmd-check"><input type="checkbox" data-v="keep"><span>' + T('Recordar en este dispositivo') + '</span></label>' +
        (member ? '' : '<button type="button" class="lmd-link" data-v="forgot">' + T('¿Olvidaste la contraseña?') + '</button>'),
        cancel() + okBtn('Desbloquear'));
      const done = (ok) => { o.close(); resolve(ok); };
      o.box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]');
        if (e.target === o.box || (b && b.dataset.v === 'no')) return done(false);
        if (b && b.dataset.v === 'forgot') { o.close(); resolve(await recover(vault)); return; }
        if (!b || b.dataset.v !== 'ok') return;
        if (!o.q('p').value) { o.fail(T('Escribí la contraseña.'), o.q('p')); return; }
        o.busy(true);
        try {
          (await openWith(vault, o.q('p').value)).fill(0);
          if (o.q('keep').checked) { try { await Z.remember(who(), vault); } catch (err) { /* sin IndexedDB: queda para esta pestaña */ } }
          done(true);
          settle(vault);
        } catch (err) { o.busy(false); o.fail(say(err), o.q('p')); }
      });
    });
    asking.set(vault.id, p); p.then(() => asking.delete(vault.id));
    return p;
  }
  // Con la carpeta recién abierta: se cifra lo que hubiera quedado en claro, sube lo pendiente y se redibuja.
  async function settle(vault) {
    try { if (vault.state === 'on' && (await LMD.cloud.sealFolder(vault))) core.flash(T('Se cifraron las notas que faltaban')); } catch (e) { /* queda para la próxima */ }
    LMD.cloud.flush();
    await refresh();
  }
  // Para una nota: si su carpeta está bloqueada, pide la contraseña. true si se puede seguir.
  const unlockFor = async (path) => { await LMD.cloud.vaults(); const v = of(path); return !v || unlock(v); };

  // Con la clave de respaldo se pone una contraseña nueva. Devuelve true si la carpeta quedó abierta.
  function recover(vault) {
    return new Promise((resolve) => {
      const o = sheet(T('Entrar con la clave de respaldo'),
        '<p>' + T('Escribí la clave de respaldo de "{a}" y elegí una contraseña nueva.', { a: esc(nameOf(vault)) }) + '</p>' +
        '<label class="lmd-dlg-field"><span>' + T('Clave de respaldo') + '</span><textarea data-v="bk" rows="3" spellcheck="false" autocapitalize="characters" autocomplete="off"></textarea></label>' +
        field('p1', 'Contraseña nueva', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password') +
        '<button type="button" class="lmd-link" data-v="lost">' + T('No tengo la clave de respaldo') + '</button>',
        cancel() + okBtn('Cambiar la contraseña'));
      watch(o, 'p1');
      o.box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]');
        if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); resolve(false); return; }
        if (b && b.dataset.v === 'lost') { o.close(); resolve(false); destroy(vault); return; }
        if (!b || b.dataset.v !== 'ok') return;
        const K = Z.backupKey(o.q('bk').value);
        if (!K) { o.fail(T('Esa clave de respaldo no tiene la forma correcta. Son 13 grupos de 4 caracteres.'), o.q('bk')); return; }
        const password = fresh(o, 'p1', 'p2'); if (!password) return;
        o.busy(true);
        try {
          const d = await Z.derive(K);
          if (d.check !== vault.check) { o.busy(false); o.fail(T(vault.team ? 'Esa clave de respaldo no es la de este equipo.' : isRoot(vault) ? 'Esa clave de respaldo no es la de tu nube.' : 'Esa clave de respaldo no es la de esta carpeta.'), o.q('bk')); return; }
          await LMD.cloud.vaultRewrap(vault.id, await Z.wrap(K, password));
          K.fill(0); Z.hold(vault, d.key);
          o.close(); resolve(true);
          core.flash(T('Contraseña cambiada'));
          settle(vault);
        } catch (err) { o.busy(false); o.fail(say(err)); }
      });
    });
  }

  // Bloquear: la llave se olvida en esta pestaña y en este dispositivo. Una nota de la carpeta que esté abierta se cierra.
  async function lock(vault) {
    if (openIn(vault)) { if (core.dirty && !(await core.save(false))) return; await core.close({ tree: true }); }
    await Z.forget(who(), vault);
    await refresh();
    core.flash(T(vault.team ? 'Espacio del equipo bloqueado' : isRoot(vault) ? 'Nube bloqueada' : 'Carpeta bloqueada'));
  }

  function changePassword(vault) {
    const o = sheet(T('Cambiar la contraseña de "{a}"', { a: nameOf(vault) }),
      field('p0', 'Contraseña actual', 'current-password') + field('p1', 'Contraseña nueva', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password') +
      '<p class="lmd-hint">' + T('La clave de respaldo sigue siendo la misma.') + '</p>' +
      (vault.team ? '<p class="lmd-hint">' + T('Las notas no se vuelven a cifrar. Pasales la contraseña nueva a los miembros: con la anterior ya no se entra.') + '</p>' : ''),
      cancel() + okBtn('Cambiar la contraseña'));
    watch(o, 'p1');
    o.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); return; }
      if (!b || b.dataset.v !== 'ok') return;
      if (!o.q('p0').value) { o.fail(T('Escribí la contraseña.'), o.q('p0')); return; }
      const password = fresh(o, 'p1', 'p2'); if (!password) return;
      o.busy(true);
      try {
        const K = await openWith(vault, o.q('p0').value);
        await LMD.cloud.vaultRewrap(vault.id, await Z.wrap(K, password));
        K.fill(0);
        o.close(); core.flash(T('Contraseña cambiada')); refresh();
      } catch (err) { o.busy(false); o.fail(say(err), err.code === 'bad_password' ? o.q('p0') : null); }
    });
  }

  // Quitar la protección: pide la contraseña, descifra todo acá y lo vuelve a guardar en claro.
  function unprotect(vault) {
    const o = sheet(T('Quitar la protección de "{a}"', { a: nameOf(vault) }),
      '<p>' + T('Las notas se descifran en este navegador y vuelven a guardarse como cualquier otra nota: el servidor las va a poder leer.') + '</p>' +
      '<p>' + T(vault.team ? 'El historial y la papelera cifrados del equipo se eliminan.' : 'El historial cifrado de estas notas se elimina.') + '</p>' + field('p', 'Contraseña', 'current-password') +
      // En el equipo la decisión alcanza a todos: se confirma además escribiendo su nombre.
      (vault.team ? '<label class="lmd-dlg-field"><span>' + T('Para confirmar, escribí el nombre del equipo: {a}', { a: esc(confirmWord()) }) + '</span><input type="text" data-v="name" autocomplete="off" spellcheck="false"></label>' : '') +
      '<div data-v="work" hidden>' + bar('Descifrando notas: {n} de {m}') + '</div>',
      cancel() + okBtn('Quitar la protección', true));
    o.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); return; }
      if (!b || b.dataset.v !== 'ok') return;
      if (!o.q('p').value) { o.fail(T('Escribí la contraseña.'), o.q('p')); return; }
      if (vault.team && o.q('name').value.trim() !== confirmWord()) { o.fail(T('Ese no es el nombre del equipo.'), o.q('name')); return; }
      o.busy(true);
      try {
        (await openWith(vault, o.q('p').value)).fill(0);
        if (openIn(vault) && core.dirty && !(await core.save(false))) throw new Error('unsaved');
        const here = openIn(vault);
        o.q('work').hidden = false;
        await LMD.cloud.openFolder(vault, stepper(o, 'Descifrando notas: {n} de {m}'));
        o.close();
        await refresh();
        if (here) reopen(here);
        core.flash(T(vault.team ? 'El espacio del equipo ya no está protegido' : isRoot(vault) ? 'Tu nube ya no está protegida' : 'La carpeta ya no está protegida'));
      } catch (err) {
        o.busy(false); o.q('work').hidden = true;
        o.fail(err.code === 'bad_password' ? say(err) : T('Se cortó antes de terminar. Volvé a intentarlo para descifrar las notas que faltan.'), err.code === 'bad_password' ? o.q('p') : null);
        if (err.code !== 'bad_password') refresh();
      }
    });
  }

  // Sin la contraseña y sin la clave de respaldo no hay forma de leer esas notas: lo que queda es eliminar la carpeta
  // con todo lo que tiene. No hace falta desbloquearla. Se confirma escribiendo su nombre, y no pasa por la papelera.
  function destroy(vault) {
    // Toda la nube: se confirma con el correo de la cuenta.
    const team = !!vault.team; const root = isRoot(vault); const word = team ? confirmWord() : root ? who() : vault.folder;
    const o = sheet(team ? T('Eliminar las notas de "{a}"', { a: teamName() }) : root ? T('Eliminar todas las notas de tu nube') : T('Eliminar "{a}" y sus notas', { a: vault.folder }),
      '<p class="lmd-vault-warn">' + T(team ? 'Se eliminan todas las notas del equipo, con su historial y su papelera. No se pueden recuperar. El espacio queda vacío y sin contraseña.'
        : root ? 'Se eliminan todas las notas de tu nube, con su historial y su papelera. No se pueden recuperar. La nube queda vacía y sin contraseña.'
        : 'Se eliminan la carpeta y todas sus notas. No van a la papelera y no se pueden recuperar.') + '</p>' +
      '<label class="lmd-dlg-field"><span>' + T(team ? 'Para confirmar, escribí el nombre del equipo: {a}' : root ? 'Para confirmar, escribí el correo de tu cuenta: {a}' : 'Para confirmar, escribí el nombre de la carpeta: {a}', { a: esc(word) }) + '</span><input type="text" data-v="name" autocomplete="off" spellcheck="false"></label>',
      cancel() + okBtn(team || root ? 'Eliminar las notas' : 'Eliminar la carpeta', true));
    o.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); return; }
      if (!b || b.dataset.v !== 'ok') return;
      if (o.q('name').value.trim() !== word) { o.fail(T(team ? 'Ese no es el nombre del equipo.' : root ? 'Ese no es el correo de tu cuenta.' : 'Ese no es el nombre de la carpeta.'), o.q('name')); return; }
      o.busy(true);
      try {
        const here = openIn(vault);
        await LMD.cloud.vaultDestroy(team || root ? Object.assign({}, vault, { confirm: word }) : vault);
        o.close();
        if (here) await core.close({ replace: true, discard: true, tree: true });
        await refresh();
        core.flash(T(team ? 'Notas del equipo eliminadas' : root ? 'Notas eliminadas' : 'Carpeta eliminada'));
      } catch (err) { o.busy(false); o.fail(say(err)); }
    });
  }

  // ---------- Solo en el equipo, y solo quien administra ----------
  // La clave de respaldo es la llave de datos escrita para una persona: se vuelve a mostrar con la contraseña.
  function showBackup(vault) {
    const o = sheet(T('Clave de respaldo de "{a}"', { a: nameOf(vault) }),
      '<div data-v="ask">' + field('p', 'Contraseña', 'current-password') + '</div>' +
      '<div data-v="show" hidden><p>' + T('Con esta clave ponés una contraseña nueva si la del equipo se olvida. Guardala fuera de este dispositivo.') + '</p><div class="lmd-vault-key" data-v="key"></div>' +
      '<div class="lmd-vault-keyacts"><button type="button" class="lmd-btn" data-v="down">' + ICON.download + '<span>' + T('Descargar') + '</span></button><button type="button" class="lmd-btn" data-v="copy">' + ICON.copy + '<span>' + T('Copiar') + '</span></button></div>' +
      '<p class="lmd-hint">' + T('Para cambiarla hay que rotar la llave.') + '</p></div>',
      cancel('Cerrar') + okBtn('Ver la clave'));
    let key = '';
    o.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { key = ''; o.close(); return; }
      if (!b) return;
      if (b.dataset.v === 'down' && key) { backupFile(vault.team ? null : vault.folder, key); return; }
      if (b.dataset.v === 'copy' && key) { await copyText(key); b.querySelector('span').textContent = T('Copiado'); return; }
      if (b.dataset.v !== 'ok') return;
      if (!o.q('p').value) { o.fail(T('Escribí la contraseña.'), o.q('p')); return; }
      o.busy(true);
      try {
        const K = await openWith(vault, o.q('p').value); key = Z.backupText(K); K.fill(0);
        o.busy(false);
        o.q('key').innerHTML = key.split('-').map((g) => '<span>' + g + '</span>').join('');
        o.q('ask').hidden = true; o.q('show').hidden = false; o.q('ok').hidden = true;
      } catch (err) { o.busy(false); o.fail(say(err), o.q('p')); }
    });
  }

  // Rotar la llave: una llave de datos nueva, con contraseña y clave de respaldo nuevas, y todas las notas vueltas a
  // cifrar acá. Sirve cuando alguien que salió pudo quedarse con la llave: con la anterior ya no se lee lo nuevo.
  // Si quedó a medias (vault.state rotating), se retoma con las dos contraseñas. Devuelve una promesa que se cumple
  // al cerrar la ventana.
  function rotate(vault) {
    const resume = vault.state === 'rotating';
    return new Promise((resolve) => {
      const o = sheet(T(resume ? 'Terminar de rotar la llave de "{a}"' : 'Rotar la llave de "{a}"', { a: nameOf(vault) }),
        (resume ? '<p>' + T('La rotación quedó a medias. Con las dos contraseñas se termina de cifrar lo que falta.') + '</p>' + field('p0', 'Contraseña anterior', 'current-password') + field('p1', 'Contraseña nueva', 'current-password')
          : '<p>' + T('Se crea una llave nueva y todas las notas del equipo se vuelven a cifrar en este navegador. Con la llave anterior ya no se lee lo que se guarde desde ahora.') + '</p>' +
            '<ul class="lmd-vault-notes"><li>' + T('El historial y la papelera del equipo se eliminan.') + '</li><li>' + T('Mientras dura, los demás miembros no pueden guardar.') + '</li>' +
            '<li>' + T('Hay contraseña y clave de respaldo nuevas. Lo que alguien ya leyó o copió no se puede retirar.') + '</li></ul>' +
            field('p0', 'Contraseña actual', 'current-password') + field('p1', 'Contraseña nueva', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password')) +
        '<div data-v="keybox" hidden><p>' + T('Esta es la clave de respaldo nueva. La anterior deja de servir.') + '</p><div class="lmd-vault-key" data-v="key"></div>' +
        '<div class="lmd-vault-keyacts"><button type="button" class="lmd-btn" data-v="down">' + ICON.download + '<span>' + T('Descargar') + '</span></button><button type="button" class="lmd-btn" data-v="copy">' + ICON.copy + '<span>' + T('Copiar') + '</span></button></div>' +
        '<p class="lmd-hint" data-v="need">' + T('Descargala o copiala para seguir.') + '</p></div>' +
        '<div data-v="work" hidden>' + bar('Cifrando notas: {n} de {m}') + '</div>',
        cancel() + okBtn(resume ? 'Terminar' : 'Continuar'));
      if (!resume) watch(o, 'p1');
      let step = 'ask'; let K2 = null; let key = ''; let body = null; let working = false;
      const done = () => { if (K2) K2.fill(0); o.close(); resolve(); };
      // Con las dos llaves abiertas: el servidor pasa a rotar (si no estaba) y se vuelve a cifrar todo.
      const run = async (target) => {
        working = true; o.busy(true); o.fail('');
        o.box.querySelectorAll('.lmd-dlg-field, .lmd-vault-meter, .lmd-vault-notes, [data-v=keybox]').forEach((x) => { x.hidden = true; });
        o.q('work').hidden = false;
        try {
          const now = target || (await LMD.cloud.teamVaultRotate(body));
          const bad = await LMD.cloud.rotateSpace(now, stepper(o, 'Cifrando notas: {n} de {m}'));
          const here = openIn(vault);
          done();
          await refresh();
          if (here) reopen(here);
          core.flash(bad ? T('Llave rotada. {n} notas no se pudieron abrir y quedaron como estaban.', { n: bad }) : T('Llave rotada. Pasales la contraseña nueva a los miembros.'), bad ? 'warn' : undefined);
        } catch (err) {
          working = false; o.busy(false); o.q('work').hidden = true;
          o.q('ok').hidden = true; o.q('no').textContent = T('Cerrar');
          o.fail(['not_admin', 'too_many', 'offline'].includes(err.code) ? say(err) : T('Se cortó antes de terminar. Volvé a "Rotar la llave" para cifrar lo que falta.'));
          refresh();
        }
      };
      o.box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]'); if (working) return;
        if (e.target === o.box || (b && b.dataset.v === 'no')) { if (step === 'key' && body) await Z.forget(who(), { check: body.check }); done(); return; }
        if (!b) return;
        const saved = () => { o.q('ok').disabled = false; o.q('need').textContent = T('Clave guardada. Ya podés rotar la llave.'); };
        if (b.dataset.v === 'down') { backupFile(null, key); saved(); return; }
        if (b.dataset.v === 'copy') { await copyText(key); b.querySelector('span').textContent = T('Copiado'); saved(); return; }
        if (b.dataset.v !== 'ok') return;
        if (step === 'key') return run(null);
        if (!o.q('p0').value) { o.fail(T('Escribí la contraseña.'), o.q('p0')); return; }
        if (resume) {
          if (!o.q('p1').value) { o.fail(T('Escribí la contraseña.'), o.q('p1')); return; }
          o.busy(true);
          let at = 'p0';
          try {
            (await openWith(vault, o.q('p0').value)).fill(0);
            at = 'p1'; (await openWith(vault.next, o.q('p1').value)).fill(0);
          } catch (err) { o.busy(false); o.fail(say(err), o.q(at)); return; }
          return run(vault);
        }
        const password = fresh(o, 'p1', 'p2'); if (!password) return;
        o.busy(true);
        try {
          (await openWith(vault, o.q('p0').value)).fill(0);
          K2 = Z.newKey(); key = Z.backupText(K2);
          const d = await Z.derive(K2);
          body = Object.assign({ check: d.check }, await Z.wrap(K2, password));
          Z.hold({ check: d.check }, d.key);
        } catch (err) { o.busy(false); o.fail(say(err), err.code === 'bad_password' ? o.q('p0') : null); return; }
        // Segundo paso: la clave de respaldo nueva. No se sigue sin descargarla o copiarla.
        step = 'key'; o.busy(false);
        o.box.querySelectorAll('.lmd-vault-body > p, .lmd-dlg-field, .lmd-vault-meter, .lmd-vault-notes').forEach((x) => { x.hidden = true; });
        o.q('key').innerHTML = key.split('-').map((g) => '<span>' + g + '</span>').join('');
        o.q('keybox').hidden = false; o.q('ok').textContent = T('Rotar la llave'); o.q('ok').disabled = true;
      });
    });
  }
  // Los miembros pueden, o no, desbloquear el espacio para su IA. Apagado por defecto.
  async function teamAi(on) {
    try { await LMD.cloud.teamVaultAi(on); } catch (e) { core.flash(say(e), 'error'); }
    await refresh();
  }
  // El aviso de que alguien salió del equipo ya se leyó.
  async function teamSeen() { try { await LMD.cloud.teamVaultSeen(); } catch (e) { /* queda a la vista */ } await refresh(); }
  // Lo que pide la gestión del equipo (Ajustes, Plan): con la lista al día, abre la ventana que corresponde.
  async function teamDo(what, arg) {
    await LMD.cloud.vaults(true);
    const v = teamV();
    if (what === 'protect') return protect(null);
    if (!v) return refresh();
    if (what === 'pass') return changePassword(v);
    if (what === 'backup') return showBackup(v);
    if (what === 'rotate') return rotate(v);
    if (what === 'off') return unprotect(v);
    if (what === 'destroy') return destroy(v);
    if (what === 'ai') return teamAi(!!arg);
    if (what === 'seen') return teamSeen();
    return null;
  }

  // ---------- Desbloquear para la IA ----------
  const TIMES = [[15, '15 minutos'], [60, '1 hora'], [480, '8 horas'], [0, 'Hasta que la bloquee']];
  async function aiUnlock(vault) {
    const o = sheet(T('Desbloquear "{a}" para la IA', { a: nameOf(vault) }),
      '<p>' + T(vault.team ? 'Mientras esté desbloqueado, el servidor puede leer y escribir las notas del equipo para tu IA. Para la IA de los demás sigue bloqueado.'
        : isRoot(vault) ? 'Mientras esté desbloqueada, el servidor puede leer y escribir las notas de tu nube para tu IA.'
        : 'Mientras esté desbloqueada, el servidor puede leer y escribir las notas de esta carpeta para tu IA.') + '</p>' +
      '<p>' + T('La llave se guarda solo en la memoria del servidor y se olvida al vencer el plazo, al bloquear o si el servidor se reinicia.') + '</p>' +
      '<div class="lmd-vault-time"><span>' + T('Durante') + '</span><div class="lmd-seg" data-v="time">' + TIMES.map((t) => '<button type="button" data-min="' + t[0] + '"' + (t[0] === 60 ? ' class="lmd-on"' : '') + '>' + T(t[1]) + '</button>').join('') + '</div></div>' +
      field('p', 'Contraseña', 'current-password'),
      cancel() + okBtn('Desbloquear para la IA'));
    let minutes = 60;
    o.box.addEventListener('click', async (e) => {
      const seg = e.target.closest('[data-min]');
      if (seg) { minutes = +seg.dataset.min; seg.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('lmd-on', x === seg)); return; }
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); return; }
      if (!b || b.dataset.v !== 'ok') return;
      if (!o.q('p').value) { o.fail(T('Escribí la contraseña.'), o.q('p')); return; }
      o.busy(true);
      try {
        const K = await openWith(vault, o.q('p').value);
        try { await LMD.cloud.vaultAi(vault.id, Z.b64(K), minutes); } finally { K.fill(0); }
        o.close();
        const now = byId(vault.id);
        core.flash(now && now.ai ? aiText(now) : T('Carpeta desbloqueada para la IA'));
        refresh();
      } catch (err) {
        o.busy(false);
        if (err.code === 'mcp_needs_plan') { o.close(); core.openPanel('plan', say(err)); } else o.fail(say(err), err.code === 'bad_password' ? o.q('p') : null);
      }
    });
  }
  async function aiLock(vault) {
    try { await LMD.cloud.vaultAiLock(vault.id); core.flash(T('Carpeta bloqueada para la IA')); } catch (e) { core.flash(say(e), 'error'); }
    refresh();
  }

  // ---------- En el explorador ----------
  // El espacio del equipo protegido: su renglón en el explorador, con el estado y las acciones. Un miembro
  // desbloquea, bloquea y olvida; lo demás es de quien administra.
  function teamItems() {
    const v = teamV(); if (!v || !can()) return [];
    if (v.state === 'rotating') return v.admin ? [['v-rotate', 'Terminar de rotar la llave…']] : [];
    if (v.state === 'opening') return v.admin ? [['v-off', 'Terminar de quitar la protección…', true]] : [];
    return [isOpen(v) ? ['v-lock', 'Bloquear'] : ['v-unlock', 'Desbloquear…'],
      (v.admin || v.ai_members) && (v.ai ? ['v-ailock', 'Bloquear para la IA ahora'] : ['v-ai', 'Desbloquear para la IA…']),
      keptSet.has(v.check) && ['v-drop', 'Olvidar en este dispositivo'], v.admin && ['v-pass', 'Cambiar la contraseña…'], v.admin && ['v-backup', 'Ver la clave de respaldo…'],
      v.admin && ['v-rotate', 'Rotar la llave…'], v.admin && ['v-off', 'Quitar la protección…', true]].filter(Boolean);
  }
  const teamState = (v) => (v.state === 'rotating' ? 'Cambiando la llave' : v.state === 'opening' ? 'Quitando la protección' : isOpen(v) ? 'Protegido, abierto en esta pestaña' : 'Protegido, bloqueado');
  // Bloqueado en esta pestaña: el explorador no lista lo que tiene.
  const teamShut = () => { const v = teamV(); return !!v && v.state !== 'opening' && !isOpen(v); };
  function teamLine() {
    const v = teamV(); if (!v || !can()) return null;
    const shut = !isOpen(v);
    const line = el('div', { class: 'lmd-vault-line lmd-team-lock' + (shut ? ' lmd-team-shut' : '') });
    line.append(el('span', { class: 'lmd-vault-ico' }, shut ? ICON.lock : ICON.unlock), el('span', { class: 'lmd-vault-state', text: T(teamState(v)) }));
    if (v.state === 'on') line.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-team-vault': shut ? 'v-unlock' : 'v-lock', text: T(shut ? 'Desbloquear' : 'Bloquear') }));
    if (teamItems().length) line.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-team-more', 'data-team-vault': 'menu', title: T('Más acciones'), 'aria-label': T('Más acciones') }, ICON.more));
    if (v.ai) line.append(el('span', { class: 'lmd-team-ai' }, ICON.spark + '<span></span>'), el('button', { type: 'button', class: 'lmd-link', 'data-vault-ailock': String(v.id), text: T('Bloquear ahora') }));
    if (v.ai) line.querySelector('.lmd-team-ai span').textContent = aiText(v);
    return line;
  }
  // Toda la nube protegida: su renglón arriba de las notas de la Nube, con el estado y las acciones. Los nombres de
  // las notas se siguen viendo (no se cifran): al abrir una se pide la contraseña.
  function rootItems() {
    const v = rootV(); if (!v || !can()) return [];
    if (v.state === 'opening') return [['v-off', 'Terminar de quitar la protección…', true], ['v-destroy', 'Eliminar todas las notas…', true]];
    return [isOpen(v) ? ['v-lock', 'Bloquear'] : ['v-unlock', 'Desbloquear…'], v.ai ? ['v-ailock', 'Bloquear para la IA ahora'] : ['v-ai', 'Desbloquear para la IA…'],
      keptSet.has(v.check) && ['v-drop', 'Olvidar en este dispositivo'], ['v-pass', 'Cambiar la contraseña…'], ['v-off', 'Quitar la protección…', true], ['v-destroy', 'Eliminar todas las notas…', true]].filter(Boolean);
  }
  const rootState = (v) => (v.state === 'opening' ? 'Quitando la protección' : isOpen(v) ? 'Protegida, abierta en esta pestaña' : 'Protegida, bloqueada');
  function rootLine() {
    const v = rootV(); if (!v || !can()) return null;
    const shut = !isOpen(v);
    const line = el('div', { class: 'lmd-vault-line lmd-team-lock lmd-root-lock' + (shut ? ' lmd-team-shut' : '') });
    line.append(el('span', { class: 'lmd-vault-ico' }, shut ? ICON.lock : ICON.unlock), el('span', { class: 'lmd-vault-state', text: T(rootState(v)) }));
    if (v.state === 'on') line.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-root-vault': shut ? 'v-unlock' : 'v-lock', text: T(shut ? 'Desbloquear' : 'Bloquear') }));
    line.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-team-more', 'data-root-vault': 'menu', title: T('Más acciones'), 'aria-label': T('Más acciones') }, ICON.more));
    if (v.ai) line.append(el('span', { class: 'lmd-team-ai' }, ICON.spark + '<span></span>'), el('button', { type: 'button', class: 'lmd-link', 'data-vault-ailock': String(v.id), text: T('Bloquear ahora') }));
    if (v.ai) line.querySelector('.lmd-team-ai span').textContent = aiText(v);
    return line;
  }
  // Lo que suma el menú de una carpeta propia de la nube. [id, texto, peligroso].
  function menu(path) {
    if (!can() || !path || path[0] === '~' || rootV()) return [];
    const v = all().find((x) => x.folder === path);
    if (!v) return all().some((x) => path.startsWith(x.folder + '/') || x.folder.startsWith(path + '/')) ? [] : [['v-protect', 'Proteger con contraseña…']];
    if (v.state === 'opening') return [['v-off', 'Terminar de quitar la protección…', true], ['v-destroy', 'Eliminar la carpeta y sus notas…', true]];
    return [isOpen(v) ? ['v-lock', 'Bloquear'] : ['v-unlock', 'Desbloquear…'], v.ai ? ['v-ailock', 'Bloquear para la IA ahora'] : ['v-ai', 'Desbloquear para la IA…'],
      keptSet.has(v.check) && ['v-drop', 'Olvidar en este dispositivo'], ['v-pass', 'Cambiar la contraseña…'], ['v-off', 'Quitar la protección…', true], ['v-destroy', 'Eliminar la carpeta y sus notas…', true]].filter(Boolean);
  }
  function pick(id, path) {
    const v = all().find((x) => !x.team && x.folder === path) || all().find((x) => x.folder === path);
    if (id === 'v-protect') return protect(path);
    if (!v) return null;
    if (id === 'v-unlock') return unlock(v);
    if (id === 'v-lock') return lock(v);
    if (id === 'v-ai') return aiUnlock(v);
    if (id === 'v-ailock') return aiLock(v);
    if (id === 'v-pass') return changePassword(v);
    if (id === 'v-off') return unprotect(v);
    if (id === 'v-destroy') return destroy(v);
    if (id === 'v-backup') return showBackup(v);
    if (id === 'v-rotate') return rotate(v);
    if (id === 'v-drop') return Z.unremember(who(), v).then(() => { core.flash(T('Este dispositivo ya no recuerda la contraseña')); return refresh(); });
    return null;
  }
  // Una nota que entra o sale de una carpeta protegida al moverla. Pide la contraseña de las carpetas que hagan falta
  // y, si la nota deja de estar protegida, lo confirma. Devuelve false si no se sigue.
  async function beforeMove(moves) {
    await LMD.cloud.vaults();
    const need = new Map(); const leaving = [];
    for (const [from, to] of moves) {
      const a = of(from); const b = of(to);
      if (a) need.set(a.id, a);
      if (b) need.set(b.id, b);
      if (a && (!b || b.id !== a.id)) leaving.push([from, b]);
    }
    for (const v of need.values()) if (!(await unlock(v))) return false;
    if (!leaving.length) return true;
    const one = leaving.length === 1; const other = leaving[0][1];
    return LMD.dialog.confirm({
      title: one ? T('¿Sacar "{a}" de la carpeta protegida?', { a: leaving[0][0].split('/').pop() }) : T('¿Sacar {n} notas de la carpeta protegida?', { n: leaving.length }),
      text: T(other ? (one ? 'Pasa a estar protegida con la contraseña de la otra carpeta.' : 'Pasan a estar protegidas con la contraseña de la otra carpeta.')
        : (one ? 'Deja de estar protegida: se guarda sin cifrar y el servidor la va a poder leer.' : 'Dejan de estar protegidas: se guardan sin cifrar y el servidor las va a poder leer.')),
      ok: T('Mover'),
    });
  }
  // Una carpeta protegida no se renombra ni se mueve entera: habría que volver a cifrar todo con las rutas nuevas.
  const pinned = (folder) => all().some((v) => !!v.folder && (v.folder === folder || v.folder.startsWith(folder + '/')));

  // ---------- En Ajustes → IA ----------
  function aiSection() {
    // El espacio del equipo figura para quien lo puede desbloquear para su IA: quien administra, o un miembro si se habilitó.
    const list = all().filter((v) => v.state === 'on' && (!v.team || v.admin || v.ai_members || v.ai));
    if (!list.length) return '';
    return '<h4>' + T('Carpetas protegidas') + '</h4>' +
      '<ul class="lmd-tokens lmd-vault-list">' + list.map((v) => '<li' + (v.ai ? ' class="lmd-vault-on"' : '') + '><span>' + ICON.lock + '<b>' + (v.team ? esc(teamName()) + ' (@team/)' : isRoot(v) ? esc(T('Toda tu nube')) : esc(v.folder) + '/') + '</b> · ' + esc(aiText(v)) + '</span>' +
        (v.ai ? '<button type="button" data-vault-ailock="' + v.id + '">' + T('Bloquear ahora') + '</button>' : '<button type="button" data-vault-ai="' + v.id + '">' + T('Desbloquear para la IA') + '</button>') + '</li>').join('') + '</ul>';
  }
  // Al lado de "Crear un token": qué no alcanza un token, tenga el alcance que tenga.
  const tokenNote = () => (all().length ? '<p class="lmd-hint lmd-vault-tokens">' + T('Las carpetas protegidas no entran en ningún token, salvo mientras estén desbloqueadas para la IA.') + '</p>' : '');
  // Devuelve true si el clic era de esta sección.
  function aiClick(e) {
    const tv = e.target.closest('[data-team-vault]');
    if (tv) {
      const v = teamV(); if (!v) return true;
      if (tv.dataset.teamVault === 'menu') { const r = tv.getBoundingClientRect(); LMD.extras.menu(r.left, r.bottom + 4, teamItems(), (f) => pick(f, v.folder)); }
      else pick(tv.dataset.teamVault, v.folder);
      return true;
    }
    const rv = e.target.closest('[data-root-vault]');
    if (rv) {
      const v = rootV(); if (!v) return true;
      if (rv.dataset.rootVault === 'menu') { const r = rv.getBoundingClientRect(); LMD.extras.menu(r.left, r.bottom + 4, rootItems(), (f) => pick(f, '')); }
      else pick(rv.dataset.rootVault, '');
      return true;
    }
    const on = e.target.closest('[data-vault-ai]'); const off = e.target.closest('[data-vault-ailock]');
    if (on) { const v = byId(on.dataset.vaultAi); if (v) aiUnlock(v); return true; }
    if (off) { const v = byId(off.dataset.vaultAilock); if (v) aiLock(v); return true; }
    return false;
  }

  // Por qué una nota de una carpeta protegida no se comparte ni se comenta, y qué hacer.
  const WHY = 'Esta nota está en una carpeta protegida: el servidor no puede leerla, así que no se comparte ni lleva comentarios para la IA. Para eso, movela a otra carpeta.';
  // Con toda la nube protegida no hay otra carpeta a la que moverla: se dice de dónde se quita la protección.
  const WHY_ALL = 'Tu nube está protegida con contraseña: el servidor no puede leer esta nota, así que no se comparte, no se publica ni lleva comentarios para la IA. La protección se quita desde Ajustes, en Nube.';
  const explain = () => core.flash(T(rootV() && isRoot(of(core.cloudPath)) ? WHY_ALL : WHY), 'warn');

  // ---------- Protección de extremo a extremo: el estado y el aviso de la primera vez ----------
  // off: nada propio protegido. folders: n carpetas. all: toda la nube, con una sola contraseña.
  function status() {
    const mine = all().filter((v) => !v.team); const r = mine.find(isRoot);
    return r ? { kind: 'all', open: isOpen(r), state: r.state, ai: !!r.ai } : { kind: mine.length ? 'folders' : 'off', n: mine.length };
  }
  // Proteger toda la nube: el mismo camino desde el aviso, desde Ajustes y desde el bloque de seguridad.
  const protectAll = async () => { try { await LMD.cloud.vaults(true); } catch (e) { /* sin conexión se intenta igual: el servidor decide */ } return protect(''); };
  // La primera vez que una cuenta guarda una nota propia en la nube se le dice, una sola vez, que puede protegerla
  // con una contraseña. Que ya se vio queda anotado en la cuenta (el servidor), así que no vuelve en otro dispositivo.
  // No sale para un invitado, en el espacio de un equipo (no es una nota propia) ni si ya hay algo protegido.
  let hinted = ''; let hintBox = null;
  const hintClose = () => { if (hintBox) { hintBox.remove(); hintBox = null; } };
  async function hint() {
    const me = who();
    if (!core || !me || hinted === me || hintBox || LMD.cloud.guest() || !Z.supported()) return;
    hinted = me;
    let a = null;
    try { a = await LMD.cloud.account(); await LMD.cloud.vaults(); } catch (e) { hinted = ''; return; }
    // protect_seen falta en un servidor propio sin actualizar: ahí no se avisa, porque no habría dónde anotarlo.
    if (who() !== me || !a || a.protect_seen !== false || !can() || all().some((v) => !v.team)) return;
    try { await LMD.cloud.protectSeen(); } catch (e) { hinted = ''; return; }
    hintClose();
    const box = hintBox = el('div', { class: 'lmd-protect-hint', role: 'region', 'aria-label': T('Tu nota está en la nube') });
    const acts = el('div', { class: 'lmd-protect-acts' });
    acts.append(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-ph': 'go', text: T('Proteger con contraseña') }),
      el('button', { type: 'button', class: 'lmd-btn', 'data-ph': 'no', text: T('Ahora no') }),
      el('button', { type: 'button', class: 'lmd-link', 'data-ph': 'how', text: T('Cómo funciona') }));
    box.append(el('b', { text: T('Tu nota está en la nube') }),
      el('p', { text: T('La nube está cifrada, y el servidor guarda esa llave para poder compartir tus notas y dárselas a tu IA. Para que ni el servidor pueda leerlas, protegelas con una contraseña: quedan cifradas de extremo a extremo.') }), acts);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ph]'); if (!b) return;
      hintClose();
      if (b.dataset.ph === 'go') protectAll();
      // Cómo funciona: el bloque de seguridad, en Ajustes → Nube.
      else if (b.dataset.ph === 'how') { core.openPanel('cloud'); setTimeout(() => { const s = document.querySelector('.lmd-e2e, .lmd-sec'); if (s) s.scrollIntoView({ block: 'start' }); }, 400); }
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hintClose(); } });
    document.body.appendChild(box);
  }

  // La lista de carpetas protegidas, con las llaves recordadas ya abiertas. La pide el explorador al dibujarse.
  let loaded = '';
  async function load() {
    const list = await LMD.cloud.vaults();
    const sig = who() + '|' + list.map((v) => v.id + ':' + v.check).join(',');
    if (sig !== loaded) { loaded = sig; await warm(); }
    arm();
    return list;
  }
  // Llegó el aviso de que cambió el estado de una carpeta (otra pestaña, o el servidor al vencer un plazo).
  const changed = () => { LMD.cloud.vaultStale(); return refresh(); };

  // El aviso espera un momento: la nota recién guardada ya está en pantalla y no tapa lo que se estaba haciendo.
  function init(c) { core = c; LMD.cloud.onPut(() => { setTimeout(() => { hint().catch(() => { /* queda para el próximo guardado */ }); }, 700); }); }

  LMD.vault = { init, load, changed, of, isOpen, unlock, unlockFor, menu, pick, beforeMove, pinned, aiSection, tokenNote, aiClick, aiText, explain, WHY, can, status, protectAll, rootLine,
    teamLine, teamShut, teamDo, onTeam: (fn) => { teamFns.push(fn); } };
})();
