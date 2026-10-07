// Carpetas con contraseña de la nube: la interfaz. Proteger una carpeta, desbloquearla en esta pestaña, entrar con
// la clave de respaldo, cambiar la contraseña, quitar la protección y desbloquearla para la IA por un tiempo.
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
  // La carpeta protegida que contiene a una nota propia de la nube, o nada.
  const of = (path) => (!path || path[0] === '~' ? null : all().find((v) => path.startsWith(v.folder + '/')) || null);
  const byId = (id) => all().find((v) => v.id === +id) || null;
  const isOpen = (vault) => Z.held(vault);
  const can = () => Z.supported() && LMD.cloud.vaultOk();

  const say = (e, fallback) => T({ offline: 'No hay conexión con el servidor.', bad_password: 'Esa contraseña no coincide.', too_many: 'Demasiados intentos. Probá de nuevo más tarde.',
    vault_nested: 'Una carpeta protegida no puede estar dentro de otra.', mcp_needs_plan: 'Desbloquear una carpeta para la IA es parte del plan pago.' }[e && e.code] || fallback || 'No se pudo completar. Probá de nuevo.');
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
  const openIn = (vault) => (core.appRoot && core.appRoot.kind === 'cloud' && !core.noDoc && core.cloudPath.startsWith(vault.folder + '/') ? core.cloudPath : '');
  const reopen = (path) => core.open(core.urlOf(path), { replace: true, discard: true, tree: true });
  // Después de un cambio: la lista de carpetas, el explorador y Ajustes → IA quedan al día.
  async function refresh() {
    try { await LMD.cloud.vaults(true); } catch (e) { /* sin conexión: queda lo que había */ }
    await warm(); arm();
    if (core && core.APP) { try { await core.reloadTree(); } catch (e) { /* el explorador se redibuja en la próxima */ } }
    LMD.sync.repaintAi();
  }
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
    const text = 'SharpMD\n' + T('Clave de respaldo de una carpeta protegida') + '\n\n' + T('Carpeta') + ': ' + folder + '/\n' + T('Cuenta') + ': ' + who() + '\n' + T('Fecha') + ': ' + new Date().toISOString().slice(0, 10) + '\n\n' + key + '\n\n' +
      T('Con esta clave se entra a la carpeta y se pone una contraseña nueva si la contraseña se olvida. Quien la tenga puede leer esas notas: guardala en un lugar seguro, fuera de este dispositivo.') + '\n';
    const a = el('a', { download: 'sharpmd-' + T('clave-de-respaldo') + '-' + folder.replace(/[^\p{L}\p{N}_-]+/gu, '-') + '.txt' });
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* sin portapapeles */ } t.remove(); }
  }

  async function protect(folder) {
    if (all().some((v) => v.folder === folder || folder.startsWith(v.folder + '/') || v.folder.startsWith(folder + '/'))) { core.flash(T('Una carpeta protegida no puede estar dentro de otra.'), 'warn'); return; }
    if (core.dirty && !(await core.save(false))) return;
    const title = T('Proteger "{a}" con contraseña', { a: folder });
    // Primer paso: la contraseña y lo que hay que saber antes de crearla.
    const o = sheet(title,
      '<p>' + T('Las notas de esta carpeta se cifran en este navegador antes de subir. El servidor guarda el texto cifrado y no lo puede leer.') + '</p>' +
      '<p class="lmd-vault-warn">' + T('Sin la contraseña y sin la clave de respaldo, estas notas no se pueden recuperar. Tampoco desde SharpMD.') + '</p>' +
      field('p1', 'Contraseña', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password') +
      '<ul class="lmd-vault-notes"><li>' + T('Los nombres de las notas y de las carpetas no se cifran.') + '</li>' +
        '<li>' + T('El historial anterior de estas notas se elimina del servidor.') + '</li>' +
        '<li>' + T('En esta carpeta no hay compartir, enlaces públicos ni comentarios para la IA. Lo que ya estaba compartido deja de estarlo.') + '</li></ul>',
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
      '<p>' + T('Con esta clave se entra a la carpeta si te olvidás la contraseña. Guardala fuera de este dispositivo: no se vuelve a mostrar.') + '</p>' +
      '<div class="lmd-vault-key" data-v="key"></div>' +
      '<div class="lmd-vault-keyacts"><button type="button" class="lmd-btn" data-v="down">' + ICON.download + '<span>' + T('Descargar') + '</span></button><button type="button" class="lmd-btn" data-v="copy">' + ICON.copy + '<span>' + T('Copiar') + '</span></button></div>' +
      '<p class="lmd-hint" data-v="need">' + T('Descargala o copiala para seguir.') + '</p>' +
      '<div data-v="work" hidden>' + bar('Cifrando notas: {n} de {m}') + '</div>',
      cancel() + okBtn('Proteger la carpeta'));
    // Cada grupo en su casilla: bajan de renglón enteros. Al copiar o descargar van unidos con guiones.
    s.q('key').innerHTML = key.split('-').map((g) => '<span>' + g + '</span>').join(''); s.q('ok').disabled = true;
    const saved = () => { s.q('ok').disabled = false; s.q('need').textContent = T('Clave guardada. Ya podés proteger la carpeta.'); };
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
        const body = Object.assign({ folder, check: d.check }, await Z.wrap(K, password));
        // La llave queda abierta acá antes de crear la carpeta: desde ese momento lo que se guarde ahí sale cifrado.
        Z.hold({ check: d.check }, d.key);
        vault = await LMD.cloud.vaultCreate(body);
        K.fill(0);
        s.q('key').hidden = true; s.box.querySelector('.lmd-vault-keyacts').hidden = true; s.q('need').hidden = true; s.q('work').hidden = false;
        await LMD.cloud.sealFolder(vault, stepper(s, 'Cifrando notas: {n} de {m}'));
        s.close();
        const here = openIn(vault);
        await refresh();
        if (here) reopen(here);
        core.flash(T('Carpeta protegida'));
      } catch (err) {
        working = false; s.busy(false);
        // Creada pero a medias: lo que falta se cifra al volver a abrir la carpeta, con la contraseña.
        if (vault) { s.box.querySelector('[data-v=ok]').hidden = true; s.box.querySelector('[data-v=no]').textContent = T('Cerrar'); s.fail(T('Se cortó antes de terminar. Las notas que faltan se cifran al desbloquear la carpeta.')); refresh(); }
        else { await Z.forget(who(), { check: (await Z.derive(K)).check }); s.fail(say(err)); }
      }
    });
  }

  // ---------- Desbloquear en esta pestaña ----------
  const asking = new Map();
  // Pide la contraseña una vez. Devuelve true si la carpeta quedó abierta.
  function unlock(vault) {
    if (!vault) return Promise.resolve(false);
    if (isOpen(vault)) return Promise.resolve(true);
    if (asking.has(vault.id)) return asking.get(vault.id);
    const p = new Promise((resolve) => {
      const o = sheet(T('Desbloquear "{a}"', { a: vault.folder }),
        '<p>' + T('Esta carpeta está protegida con contraseña.') + '</p>' + field('p', 'Contraseña', 'current-password') +
        '<label class="lmd-check"><input type="checkbox" data-v="keep"><span>' + T('Recordar en este dispositivo') + '</span></label>' +
        '<button type="button" class="lmd-link" data-v="forgot">' + T('¿Olvidaste la contraseña?') + '</button>',
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
        '<p>' + T('Escribí la clave de respaldo de "{a}" y elegí una contraseña nueva.', { a: esc(vault.folder) }) + '</p>' +
        '<label class="lmd-dlg-field"><span>' + T('Clave de respaldo') + '</span><textarea data-v="bk" rows="3" spellcheck="false" autocapitalize="characters" autocomplete="off"></textarea></label>' +
        field('p1', 'Contraseña nueva', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password'),
        cancel() + okBtn('Cambiar la contraseña'));
      watch(o, 'p1');
      o.box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]');
        if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); resolve(false); return; }
        if (!b || b.dataset.v !== 'ok') return;
        const K = Z.backupKey(o.q('bk').value);
        if (!K) { o.fail(T('Esa clave de respaldo no tiene la forma correcta. Son 13 grupos de 4 caracteres.'), o.q('bk')); return; }
        const password = fresh(o, 'p1', 'p2'); if (!password) return;
        o.busy(true);
        try {
          const d = await Z.derive(K);
          if (d.check !== vault.check) { o.busy(false); o.fail(T('Esa clave de respaldo no es la de esta carpeta.'), o.q('bk')); return; }
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
    core.flash(T('Carpeta bloqueada'));
  }

  function changePassword(vault) {
    const o = sheet(T('Cambiar la contraseña de "{a}"', { a: vault.folder }),
      field('p0', 'Contraseña actual', 'current-password') + field('p1', 'Contraseña nueva', 'new-password') + meter + field('p2', 'Repetir la contraseña', 'new-password') +
      '<p class="lmd-hint">' + T('La clave de respaldo sigue siendo la misma.') + '</p>',
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
    const o = sheet(T('Quitar la protección de "{a}"', { a: vault.folder }),
      '<p>' + T('Las notas se descifran en este navegador y vuelven a guardarse como cualquier otra nota: el servidor las va a poder leer.') + '</p>' +
      '<p>' + T('El historial cifrado de estas notas se elimina.') + '</p>' + field('p', 'Contraseña', 'current-password') +
      '<div data-v="work" hidden>' + bar('Descifrando notas: {n} de {m}') + '</div>',
      cancel() + okBtn('Quitar la protección', true));
    o.box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (e.target === o.box || (b && b.dataset.v === 'no')) { o.close(); return; }
      if (!b || b.dataset.v !== 'ok') return;
      if (!o.q('p').value) { o.fail(T('Escribí la contraseña.'), o.q('p')); return; }
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
        core.flash(T('La carpeta ya no está protegida'));
      } catch (err) {
        o.busy(false); o.q('work').hidden = true;
        o.fail(err.code === 'bad_password' ? say(err) : T('Se cortó antes de terminar. Volvé a intentarlo para descifrar las notas que faltan.'), err.code === 'bad_password' ? o.q('p') : null);
        if (err.code !== 'bad_password') refresh();
      }
    });
  }

  // ---------- Desbloquear para la IA ----------
  const TIMES = [[15, '15 minutos'], [60, '1 hora'], [480, '8 horas'], [0, 'Hasta que la bloquee']];
  async function aiUnlock(vault) {
    // Sin la cuenta a mano (sin conexión) se sigue: si hace falta el plan pago, lo dice el servidor.
    const a = await LMD.sync.me();
    if (a && !a.mcp) { core.openPanel('plan', T('Desbloquear una carpeta para la IA es parte del plan pago.')); return; }
    const o = sheet(T('Desbloquear "{a}" para la IA', { a: vault.folder }),
      '<p>' + T('Mientras esté desbloqueada, el servidor puede leer y escribir las notas de esta carpeta para tu IA.') + '</p>' +
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
  // Lo que suma el menú de una carpeta propia de la nube. [id, texto, peligroso].
  function menu(path) {
    if (!can() || !path || path[0] === '~') return [];
    const v = all().find((x) => x.folder === path);
    if (!v) return all().some((x) => path.startsWith(x.folder + '/') || x.folder.startsWith(path + '/')) ? [] : [['v-protect', 'Proteger con contraseña…']];
    if (v.state === 'opening') return [['v-off', 'Terminar de quitar la protección…', true]];
    return [isOpen(v) ? ['v-lock', 'Bloquear'] : ['v-unlock', 'Desbloquear…'], v.ai ? ['v-ailock', 'Bloquear para la IA ahora'] : ['v-ai', 'Desbloquear para la IA…'],
      keptSet.has(v.check) && ['v-drop', 'Olvidar en este dispositivo'], ['v-pass', 'Cambiar la contraseña…'], ['v-off', 'Quitar la protección…', true]].filter(Boolean);
  }
  function pick(id, path) {
    const v = all().find((x) => x.folder === path);
    if (id === 'v-protect') return protect(path);
    if (!v) return null;
    if (id === 'v-unlock') return unlock(v);
    if (id === 'v-lock') return lock(v);
    if (id === 'v-ai') return aiUnlock(v);
    if (id === 'v-ailock') return aiLock(v);
    if (id === 'v-pass') return changePassword(v);
    if (id === 'v-off') return unprotect(v);
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
  const pinned = (folder) => all().some((v) => v.folder === folder || v.folder.startsWith(folder + '/'));

  // ---------- En Ajustes → IA ----------
  function aiSection() {
    const list = all().filter((v) => v.state === 'on');
    if (!list.length) return '';
    return '<h4>' + T('Carpetas protegidas') + '</h4>' +
      '<ul class="lmd-tokens lmd-vault-list">' + list.map((v) => '<li' + (v.ai ? ' class="lmd-vault-on"' : '') + '><span>' + ICON.lock + '<b>' + esc(v.folder) + '/</b> · ' + esc(aiText(v)) + '</span>' +
        (v.ai ? '<button type="button" data-vault-ailock="' + v.id + '">' + T('Bloquear ahora') + '</button>' : '<button type="button" data-vault-ai="' + v.id + '">' + T('Desbloquear para la IA') + '</button>') + '</li>').join('') + '</ul>';
  }
  // Al lado de "Crear un token": qué no alcanza un token, tenga el alcance que tenga.
  const tokenNote = () => (all().length ? '<p class="lmd-hint lmd-vault-tokens">' + T('Las carpetas protegidas no entran en ningún token, salvo mientras estén desbloqueadas para la IA.') + '</p>' : '');
  // Devuelve true si el clic era de esta sección.
  function aiClick(e) {
    const on = e.target.closest('[data-vault-ai]'); const off = e.target.closest('[data-vault-ailock]');
    if (on) { const v = byId(on.dataset.vaultAi); if (v) aiUnlock(v); return true; }
    if (off) { const v = byId(off.dataset.vaultAilock); if (v) aiLock(v); return true; }
    return false;
  }

  // Por qué una nota de una carpeta protegida no se comparte ni se comenta, y qué hacer.
  const WHY = 'Esta nota está en una carpeta protegida: el servidor no puede leerla, así que no se comparte ni lleva comentarios para la IA. Para eso, movela a otra carpeta.';
  const explain = () => core.flash(T(WHY), 'warn');

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

  function init(c) { core = c; }

  LMD.vault = { init, load, changed, of, isOpen, unlock, unlockFor, menu, pick, beforeMove, pinned, aiSection, tokenNote, aiClick, aiText, explain, WHY, can };
})();
