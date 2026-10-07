// Equipo: el plan que paga una persona para varias. Acá vive lo que se ve en Ajustes → Plan (la columna del plan,
// y la gestión: miembros, invitaciones, lugares) y el aviso de una invitación pendiente al entrar a la app.
// Las notas del equipo son una raíz más del explorador: las dibuja content.js y viajan por cloud.js.
(function () {
  'use strict';

  const { el, esc } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // Lo que se muestra del precio, en centavos de dólar por mes: el base cubre a las personas incluidas.
  const PRICE = { base: 798, seat: 300 };
  const cost = (seats, included) => ((PRICE.base + PRICE.seat * Math.max(0, seats - included)) / 100).toFixed(2);
  const WHY = {
    offline: 'No hay conexión con el servidor.', bad_email: 'Ese correo no parece válido.', own_email: 'Ese es tu propio correo.',
    team_full: 'No quedan lugares. Sumá uno para invitar.', already_member: 'Esa persona ya está en el equipo.',
    invite_day: 'Llegaste al tope de invitaciones por hoy.', invite_mail_day: 'Esa dirección ya recibió varias invitaciones hoy. Probá mañana.',
    in_team: 'Para aceptar, salí primero de tu equipo.', seats_in_use: 'Hay más personas e invitaciones que esos lugares.',
    billing_failed: 'No se pudo cambiar el cobro. Probá de nuevo.', team_ended: 'El plan del equipo venció.',
    team_busy: 'Se están cambiando los lugares. Probá en un momento.', mail_failed: 'No se pudo mandar el correo. Probá de nuevo.',
    too_many: 'Demasiados cambios seguidos. Probá más tarde.', not_found: 'Esa invitación ya no está.',
  };
  const why = (e) => T(WHY[e && e.code] || 'No se pudo completar. Probá de nuevo.');
  const invited = (i) => (i.name ? T('{a} te invitó al equipo {b}', { a: i.by, b: i.name }) : T('{a} te invitó a su equipo', { a: i.by }));

  // La tercera columna de Plan. btn arma el botón de pago como los del plan individual.
  function column(a, btn) {
    const t = a && a.team; const mine = t && t.mine;
    if (!t || !(t.enabled || mine)) return '';
    return '<div class="lmd-plan lmd-plan-team' + (mine && mine.active ? ' lmd-plan-on' : '') + '"><h4>' + T('Equipo') + ' <small>USD ' + cost(t.included, t.included) + ' / ' + T('mes') + '</small></h4><ul><li>' + T('Todo lo del plan pago para cada persona') + '</li><li>' +
      T('{n} personas incluidas, USD {a} por cada una más', { n: t.included, a: PRICE.seat / 100 }) + '</li><li>' + T('Un espacio compartido para las notas del equipo') + '</li></ul>' +
      (mine ? '<p class="lmd-hint">' + T(mine.active ? 'Es tu plan actual.' : 'El plan del equipo venció. Las notas siguen ahí.') + '</p>'
        : '<div class="lmd-plan-buy">' + btn(t.checkout, 'USD ' + cost(t.included, t.included) + ' / ' + T('mes'), 'team') + '</div>') + '</div>';
  }

  // La protección del espacio: una sola contraseña para todas las notas del equipo, que pone quien administra.
  // Las ventanas (proteger, cambiar la contraseña, rotar la llave) son las de las carpetas protegidas, en vault.js.
  function vaultBlock(mine, admin) {
    if (!LMD.vault.can() || !('vault' in mine)) return '';
    const v = mine.vault; const head = '<h4>' + T('Protección del espacio') + '</h4>';
    const btn = (kind, label, cls) => '<button type="button" class="lmd-btn' + (cls ? ' ' + cls : '') + '" data-t="' + kind + '">' + T(label) + '</button>';
    if (!v) return admin ? head + '<p class="lmd-hint">' + T('Con una contraseña, las notas del equipo se cifran en el navegador y el servidor no las puede leer.') + '</p><div class="lmd-acct-actions">' + btn('v-protect', 'Proteger con contraseña') + '</div>' : '';
    if (!admin) return head + '<p class="lmd-hint" data-team="vault">' + T('Las notas del equipo están protegidas con contraseña. Pedile la contraseña a quien administra el equipo.') + '</p>';
    let out = head;
    // Alguien que conocía la contraseña ya no está: se dice en el momento, con lo que se puede hacer.
    if (v.gone && v.state === 'on') out += '<div class="lmd-team-gone" role="status"><p><b>' + T('Alguien salió del equipo y conocía la contraseña.') + '</b></p>' +
      '<p class="lmd-hint">' + T('Lo que ya leyó o copió no se puede retirar. Rotar la llave conviene si pudo guardarla en su dispositivo: vuelve a cifrar todas las notas.') + '</p>' +
      '<div class="lmd-acct-actions">' + btn('v-pass', 'Cambiar la contraseña del equipo', 'lmd-btn-fill') + btn('v-rotate', 'Rotar la llave') + '<button type="button" class="lmd-link" data-t="v-seen">' + T('Descartar') + '</button></div></div>';
    if (v.state === 'rotating') return out + '<p class="lmd-hint">' + T('La rotación de la llave quedó a medias. Hasta terminarla, los demás miembros no pueden guardar.') + '</p><div class="lmd-acct-actions">' + btn('v-rotate', 'Terminar de rotar la llave', 'lmd-btn-fill') + '</div>';
    if (v.state === 'opening') return out + '<p class="lmd-hint">' + T('Quitar la protección quedó a medias.') + '</p><div class="lmd-acct-actions">' + btn('v-off', 'Terminar de quitar la protección', 'lmd-btn-fill') + '</div>';
    return out + '<p class="lmd-hint" data-team="vault">' + T('Las notas del equipo se cifran en el navegador con una sola contraseña. Los nombres de notas y carpetas siguen visibles.') + '</p>' +
      '<p class="lmd-hint">' + T('El historial y la papelera quedan cifrados. No hay búsqueda en el servidor ni sesiones en vivo.') + '</p>' +
      '<label class="lmd-check lmd-team-ai"><input type="checkbox" data-t="v-ai"' + (v.ai_members ? ' checked' : '') + '><span>' + T('Los miembros pueden desbloquear para su IA') + '</span></label>' +
      '<div class="lmd-acct-actions lmd-team-vault">' + btn('v-pass', 'Cambiar la contraseña') + btn('v-backup', 'Ver la clave de respaldo') + btn('v-rotate', 'Rotar la llave') + btn('v-off', 'Quitar la protección', 'lmd-btn-danger') + '</div>' +
      '<button type="button" class="lmd-link lmd-team-lost" data-t="v-destroy">' + T('Perdí la contraseña y la clave de respaldo') + '</button>';
  }

  // Lo que queda dicho después de un cambio: se muestra una vez, en el próximo dibujo.
  let said = ''; let want = 0; let wantFor = 0;
  // Debajo de los planes: las invitaciones que esperan a esta cuenta y, si está en un equipo, el equipo.
  function section(a) {
    const t = a && a.team; if (!t) return '';
    const mine = t.mine; let out = '';
    const msg = '<p class="lmd-hint lmd-team-msg" role="status"' + (said ? '' : ' hidden') + '>' + esc(said) + '</p>'; said = '';
    if (t.invites.length) {
      out += '<ul class="lmd-tokens lmd-team-list" data-team="invites">' + t.invites.map((i) => '<li><span>' + esc(invited(i)) + '</span><span class="lmd-team-acts">' +
        (mine ? '' : '<button type="button" data-t="yes" data-id="' + i.id + '">' + T('Unirme') + '</button>') + '<button type="button" data-t="no" data-id="' + i.id + '">' + T('Rechazar') + '</button></span></li>').join('') + '</ul>' +
        (mine ? '<p class="lmd-hint">' + T('Para aceptar, salí primero de tu equipo.') + '</p>' : '');
    }
    if (!mine) return out ? '<div class="lmd-team"><h4>' + T('Invitaciones') + '</h4>' + out + msg + '</div>' : '';
    const admin = mine.role === 'admin'; const boss = (mine.members.find((m) => m.admin) || {}).email || '';
    out = '<h4>' + T('Tu equipo') + (mine.name ? ' <small>' + esc(mine.name) + '</small>' : '') + '</h4>' +
      (mine.active ? '' : '<p class="lmd-hint">' + T('El plan del equipo venció. Las notas siguen ahí.') + '</p>') +
      // Quien ya pagaba por su cuenta: su suscripción no se toca. Se le dice que sigue activa y dónde darla de baja.
      (mine.solo && !admin ? '<p class="lmd-plan-why lmd-team-solo" role="status">' + T('Tu suscripción individual sigue activa.') + (a.manage ? ' <a href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Darla de baja') + '</a>' : '') + '</p>' : '') +
      (admin ? '' : '<p class="lmd-hint">' + esc(T('Administra {a}', { a: boss })) + '</p>') +
      '<ul class="lmd-tokens lmd-team-list" data-team="members">' + mine.members.map((m) => '<li><span>' + esc(m.email) + (m.admin ? ' · ' + T('administra') : '') + '</span>' +
        (admin && !m.admin ? '<button type="button" data-t="remove" data-id="' + m.id + '" data-mail="' + esc(m.email) + '">' + T('Sacar') + '</button>' : '') + '</li>').join('') + '</ul>' + out;
    if (admin) {
      if (wantFor !== mine.seats) { want = mine.seats; wantFor = mine.seats; }
      out += (mine.pending.length ? '<h4>' + T('Invitaciones pendientes') + '</h4><ul class="lmd-tokens lmd-team-list" data-team="pending">' + mine.pending.map((i) => '<li><span>' + esc(i.email) + '</span><button type="button" data-t="uninvite" data-id="' + i.id + '">' + T('Quitar') + '</button></li>').join('') + '</ul>' : '') +
        (mine.active ? '<div class="lmd-share-row lmd-team-invite"><input type="email" data-t="email" autocomplete="off" placeholder="' + T('correo de la persona') + '" aria-label="' + T('correo de la persona') + '"><button type="button" class="lmd-btn lmd-btn-fill" data-t="invite">' + T('Invitar') + '</button></div>' : '') +
        '<div class="lmd-acct-row"><span>' + T('Lugares') + '</span><b>' + T('{n} de {m} ocupados', { n: mine.used, m: mine.seats }) + '</b></div>' +
        // Cambiar los lugares cambia el cobro: el costo que queda está a la vista antes de confirmar.
        (mine.billing && mine.active ? '<div class="lmd-team-seats" data-min="' + Math.max(t.included, mine.used) + '" data-max="' + t.max + '" data-inc="' + t.included + '" data-now="' + mine.seats + '">' +
          '<button type="button" class="lmd-btn" data-t="less" aria-label="' + T('Menos lugares') + '">-</button><b data-t="n" aria-live="polite">' + want + '</b><button type="button" class="lmd-btn" data-t="more" aria-label="' + T('Más lugares') + '">+</button>' +
          '<span class="lmd-team-cost">' + T('{n} lugares: USD {a} por mes', { n: want, a: cost(want, t.included) }) + '</span>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-t="seats"' + (want === mine.seats ? ' disabled' : '') + '>' + T('Cambiar lugares') + '</button></div>' : '');
    }
    out += vaultBlock(mine, admin);
    out += msg + '<div class="lmd-acct-actions">' + (admin ? '<button type="button" class="lmd-btn" data-t="name">' + T('Cambiar el nombre') + '</button>' +
      (a.manage ? '<a class="lmd-btn" href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Administrar la suscripción') + '</a>' : '')
      : '<button type="button" class="lmd-btn" data-t="leave">' + T('Salir del equipo') + '</button>') + '</div>';
    return '<div class="lmd-team">' + out + '</div>';
  }

  // Después de aceptar, salir o que lo saquen cambia lo que la cuenta puede hacer: se vuelve a pedir y se redibuja.
  const refresh = async () => { try { await LMD.sync.reload(); } catch (e) { /* sin conexión: queda lo que había */ } };

  // Si un clic dentro de Plan es de la gestión del equipo.
  const owns = (e, box) => { const b = e.target.closest && e.target.closest('[data-t]'); return !!b && box.contains(b) && !!b.closest('.lmd-team'); };
  // Los clics de la gestión dentro de Plan. redraw vuelve a dibujar el panel.
  async function click(e, box, a, redraw) {
    if (!owns(e, box)) return false;
    const b = e.target.closest('[data-t]');
    const mine = a && a.team && a.team.mine; const C = LMD.cloud.team; const kind = b.dataset.t;
    const say = (text) => { const m = box.querySelector('.lmd-team-msg'); if (m) { m.hidden = false; m.textContent = text; } };
    const seats = box.querySelector('.lmd-team-seats');
    if (kind === 'less' || kind === 'more') {
      // El número y su costo cambian en el lugar; nada viaja hasta confirmar.
      want = Math.max(+seats.dataset.min, Math.min(+seats.dataset.max, want + (kind === 'more' ? 1 : -1)));
      seats.querySelector('[data-t=n]').textContent = want;
      seats.querySelector('.lmd-team-cost').textContent = T('{n} lugares: USD {a} por mes', { n: want, a: cost(want, +seats.dataset.inc) });
      seats.querySelector('[data-t=seats]').disabled = want === +seats.dataset.now;
      return true;
    }
    if (kind === 'n' || kind === 'email') return true;
    if (/^v-/.test(kind)) {
      // Las ventanas son de vault.js: cuando algo cambia, avisa (onTeam) y la gestión se vuelve a dibujar.
      again = async () => { await refresh(); if (box.isConnected) redraw(); };
      try { await LMD.vault.teamDo(kind.slice(2), b.checked); } catch (err) { say(why(err)); }
      return true;
    }
    try {
      if (kind === 'invite') {
        const input = box.querySelector('[data-t=email]'); const mail = input.value.trim().toLowerCase();
        if (!LMD.kit.validEmail(mail)) { say(T('Ese correo no parece válido.')); input.focus(); return true; }
        b.disabled = true;
        await C.invite(mail); said = T('Invitación enviada.');
      } else if (kind === 'uninvite') await C.uninvite(b.dataset.id);
      else if (kind === 'remove') {
        if (!(await LMD.dialog.confirm({ title: T('¿Sacar a {a} del equipo?', { a: b.dataset.mail }), text: T('Conserva sus notas. Las del equipo quedan en el equipo.'), ok: T('Sacar'), danger: true }))) return true;
        await C.remove(+b.dataset.id);
      } else if (kind === 'seats') {
        if (!(await LMD.dialog.confirm({ title: T('¿Pasar a {n} lugares?', { n: want }), text: T('Quedan USD {a} por mes. La diferencia se cobra o se acredita ahora.', { a: cost(want, +seats.dataset.inc) }), ok: T('Cambiar lugares') }))) return true;
        b.disabled = true;
        await C.seats(want); said = T('Lugares cambiados.');
      } else if (kind === 'name') {
        const name = await LMD.dialog.prompt({ title: T('Nombre del equipo'), value: mine.name || '', ok: T('Guardar'), validate: (v) => (v.length > 40 ? T('Hasta 40 caracteres.') : '') });
        if (name == null) return true;
        await C.rename(name);
      } else if (kind === 'leave') {
        if (!(await LMD.dialog.confirm({ title: T('¿Salir del equipo?'), text: T('Volvés a tu plan y conservás tus notas. Las del equipo quedan en el equipo.'), ok: T('Salir del equipo'), danger: true }))) return true;
        await leave();
      } else if (kind === 'yes') { await C.accept(+b.dataset.id); said = T('Ya estás en el equipo.'); }
      else if (kind === 'no') await C.decline(+b.dataset.id);
      else return true;
    } catch (err) { b.disabled = false; say(why(err)); return true; }
    await refresh(); redraw();
    return true;
  }
  // Al salir, una nota del equipo que estuviera abierta se cierra: ya no se puede leer ni guardar.
  async function leave() {
    const open = core && core.APP && LMD.cloud.isTeam(core.cloudPath || '') && core.appRoot && core.appRoot.kind === 'cloud';
    if (open && core.dirty) { try { await core.save(false); } catch (e) { /* lo que no subió queda aparte al cerrar */ } }
    await LMD.cloud.team.leave();
    if (open) await core.close({ discard: true, tree: true });
  }

  // Al entrar a la app con una invitación esperando: un aviso con aceptar o rechazar. "Ahora no" lo deja para
  // después: la invitación sigue en Ajustes → Plan. Cada invitación se avisa una vez por carga.
  const told = new Set();
  function notice(a) {
    const t = a && a.team;
    if (!t || t.mine || !t.invites.length || !core || !core.APP || document.querySelector('.lmd-team-ask')) return;
    const inv = t.invites.find((i) => !told.has(i.id)); if (!inv) return;
    told.add(inv.id);
    const box = el('div', { class: 'lmd-ask lmd-team-ask' });
    box.innerHTML = '<div class="lmd-ask-card" role="dialog"><h3></h3><p>' + T('Con el equipo tenés el plan pago y las notas compartidas.') + '</p>' +
      (a.own_plan === 'pro' ? '<p class="lmd-hint">' + T('Tu suscripción individual sigue activa. La podés dar de baja desde Ajustes, Plan.') + '</p>' : '') +
      '<p class="lmd-img-err" role="alert" hidden></p><div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-t="later" data-esc>' + T('Ahora no') + '</button>' +
      '<button type="button" class="lmd-btn" data-t="no">' + T('Rechazar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-t="yes">' + T('Unirme') + '</button></div></div>';
    box.querySelector('h3').textContent = invited(inv);
    box.querySelector('[role=dialog]').setAttribute('aria-label', invited(inv));
    document.body.appendChild(box);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]');
      if (e.target === box || (b && b.dataset.t === 'later')) { box.remove(); return; }
      if (!b) return;
      const err = box.querySelector('.lmd-img-err'); err.hidden = true;
      box.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        if (b.dataset.t === 'yes') await LMD.cloud.team.accept(inv.id); else await LMD.cloud.team.decline(inv.id);
        box.remove();
        if (b.dataset.t === 'yes') core.flash(T('Ya estás en el equipo.'));
        await refresh();
      } catch (ex) { box.querySelectorAll('button').forEach((x) => { x.disabled = false; }); err.hidden = false; err.textContent = why(ex); }
    });
  }

  let again = null;
  function init(c) { core = c; LMD.vault.onTeam(() => { if (again) again(); }); }

  LMD.team = { init, column, section, owns, click, notice, cost };
})();
