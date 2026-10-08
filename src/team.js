// Equipo: el plan que paga una persona para varias. Acá vive lo que se ve en Ajustes → Plan (la columna del plan,
// y la gestión: miembros y sus papeles, invitaciones, lugares, los ajustes del equipo, sus tokens y el registro de
// actividad) y el aviso de una invitación pendiente al entrar a la app.
// Tres niveles: lo personal (apariencia, idioma, herramientas) es de cada uno y no pasa por acá; lo del equipo lo
// decide quien administra y a los demás les aparece bloqueado; el cobro lo ve solo quien paga.
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
    not_admin: 'Lo administra quien administra el equipo', not_owner: 'Eso lo decide quien paga el equipo.', owner_stays: 'Quien paga el equipo es siempre administrador.',
    bad_name: 'Escribí un nombre.', bad_path: 'Esa carpeta no sirve.', bad_policy: 'Ese valor no sirve.', vault: 'Con el espacio protegido no hay plantilla.',
  };
  const why = (e) => T(WHY[e && e.code] || 'No se pudo completar. Probá de nuevo.');
  const ROLE = { admin: 'Administrador', editor: 'Editor', reader: 'Lector' };
  const role = (r) => T(ROLE[r] || ROLE.editor);
  const invited = (i) => (i.name ? T('{a} te invitó al equipo {b}', { a: i.by, b: i.name }) : T('{a} te invitó a su equipo', { a: i.by }));
  const MANAGED = () => '<p class="lmd-hint lmd-managed">' + T('Lo administra quien administra el equipo') + '</p>';
  const roleSelect = (attrs, now, label) => '<select ' + attrs + ' aria-label="' + esc(label) + '">' + ['admin', 'editor', 'reader'].map((r) => '<option value="' + r + '"' + (r === now ? ' selected' : '') + '>' + role(r) + '</option>').join('') + '</select>';

  // Lo que dice de su plan la cuenta, en una línea. Quien tiene el plan por un equipo que paga otra persona ve su
  // equipo y su papel: de planes y precios no se le muestra nada.
  function planLabel(a) {
    const mine = a && a.team && a.team.mine;
    if (a && a.billing === false && mine) return (mine.name || T('Equipo')) + ' · ' + role(mine.role);
    return T(a && a.plan === 'pro' ? 'Plan pago' : 'Plan gratis');
  }
  // En Plan, para esa misma cuenta: en vez de los planes, a qué equipo pertenece y con qué papel.
  function guestCard(a) {
    const mine = a.team.mine;
    return '<div class="lmd-plans lmd-plans-guest"><div class="lmd-plan lmd-plan-on"><h4>' + T('Equipo') + (mine.name ? ' <small>' + esc(mine.name) + '</small>' : '') + '</h4>' +
      '<p class="lmd-hint">' + T('Tenés todo lo del plan pago con tu equipo.') + '</p></div></div>';
  }

  // La tercera columna de Plan. btn arma el botón de pago como los del plan individual.
  function column(a, btn) {
    const t = a && a.team; const mine = t && t.mine;
    if (!t || !(t.enabled || mine) || a.billing === false) return '';
    return '<div class="lmd-plan lmd-plan-team' + (mine && mine.active ? ' lmd-plan-on' : '') + '"><h4>' + T('Equipo') + ' <small>USD ' + cost(t.included, t.included) + ' / ' + T('mes') + '</small></h4><ul><li>' + T('Todo lo del plan pago para cada persona') + '</li><li>' +
      T('{n} personas incluidas, USD {a} por cada una más', { n: t.included, a: PRICE.seat / 100 }) + '</li><li>' + T('Un espacio compartido para las notas del equipo') + '</li><li>' +
      T('Papeles, ajustes del equipo y registro de actividad') + '</li><li>' + T('Historial de versiones de un año') + '</li></ul>' +
      (mine ? '<p class="lmd-hint">' + T(mine.active ? 'Es tu plan actual.' : 'El plan del equipo venció. Las notas siguen ahí.') + '</p>'
        : '<div class="lmd-plan-buy">' + btn(t.checkout, 'USD ' + cost(t.included, t.included) + ' / ' + T('mes'), 'team') + '</div>') + '</div>';
  }

  // La protección del espacio: una sola contraseña para todas las notas del equipo, que pone quien paga el equipo.
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

  // Ajustes del equipo: lo que quien administra decide para el espacio. Quien no administra los ve, bloqueados.
  const POLICIES = [['share', 'Los miembros pueden compartir notas del equipo con otras cuentas'], ['links', 'Los miembros pueden crear enlaces públicos de notas del equipo'],
    ['live', 'Los miembros pueden abrir sesiones en vivo con invitados'],
    ['tokens', 'Los miembros pueden conectar su IA al espacio del equipo'], ['automation', 'Los miembros pueden usar automatizaciones en el espacio del equipo'],
    ['publish', 'Los miembros pueden publicar carpetas del equipo como sitio']];
  const days = (n) => (n === 365 ? T('1 año') : T('{n} días', { n }));
  function policyBlock(mine, admin) {
    const p = mine.policies; if (!p) return '';
    const off = admin ? '' : ' disabled'; const max = mine.history_max || 365;
    const choices = (mine.history_choices || []).filter((d) => d < max);
    return '<h4>' + T('Ajustes del equipo') + '</h4><div class="lmd-team-pol' + (admin ? '' : ' lmd-team-locked') + '" data-team="policies">' + (admin ? '' : MANAGED()) +
      POLICIES.map((x) => '<label class="lmd-check"><input type="checkbox" data-p="' + x[0] + '"' + (p[x[0]] ? ' checked' : '') + off + '><span>' + T(x[1]) + '</span></label>').join('') +
      '<label class="lmd-pick"><span>' + T('Historial de versiones') + '</span><select data-p="history_days"' + off + '>' + choices.map((d) => '<option value="' + d + '"' + (p.history_days === d ? ' selected' : '') + '>' + days(d) + '</option>').join('') +
        '<option value="0"' + (p.history_days && choices.includes(p.history_days) ? '' : ' selected') + '>' + days(max) + '</option></select></label>' +
      '<label class="lmd-pick"><span>' + T('Carpeta de las notas nuevas') + '</span><input type="text" data-p="folder" spellcheck="false" autocomplete="off" placeholder="' + T('sin carpeta') + '" value="' + esc(p.folder || '') + '"' + off + '></label>' +
      '<div class="lmd-pick lmd-team-tpl"><span>' + T('Plantilla de las notas nuevas') + '</span><b>' + T(p.template ? 'Con plantilla' : 'Sin plantilla') + '</b>' +
        (admin && !mine.vault ? '<button type="button" class="lmd-btn" data-t="template">' + T('Editar') + '</button>' : '') + '</div>' +
      (admin && mine.vault ? '<p class="lmd-hint">' + T('Con el espacio protegido no hay plantilla.') + '</p>' : '') + '</div>';
  }

  // Tokens del equipo: son del equipo, no de quien los crea. El recién creado queda a la vista unos minutos.
  let fresh = null;
  const day = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short' });
  const tokenRow = (k) => '<li><span>' + esc(k.name) + ' · ' + (k.scope ? T('Carpeta {a}', { a: esc(k.scope) + '/' }) : T('Todas las notas del equipo')) + ' · ' + T(k.write ? (k.share ? 'lee, escribe y comparte' : 'lee y escribe') : 'solo lee') +
    ' · ' + (k.used ? T('usado el {a}', { a: day(k.used) }) : T('sin usar')) + '</span><button type="button" data-t="tok-rm" data-id="' + k.id + '" data-name="' + esc(k.name) + '">' + T('Revocar') + '</button></li>';
  function tokenBlock(mine) {
    const made = fresh && fresh.team === mine.id && Date.now() - fresh.at < 600000 ? fresh : (fresh = null);
    const field = (label, value) => '<div class="lmd-field"><span>' + label + '</span><input type="text" readonly value="' + esc(value) + '"><button type="button" class="lmd-link" data-t="tok-copy">' + T('Copiar') + '</button></div>';
    return '<h4>' + T('Tokens del equipo') + '</h4><p class="lmd-hint">' + T('Para una IA o un servicio que trabaja para el equipo. No dependen de quien los creó.') + '</p>' +
      (made ? '<p class="lmd-ai-new">' + T('Copiá estos datos ahora: el token no se vuelve a mostrar.') + '</p>' + field('URL', made.mcp_url) + field('Token', made.token) +
        '<div class="lmd-acct-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-t="tok-brief">' + T('Copiar instrucciones para tu IA') + '</button></div>' : '') +
      '<ul class="lmd-tokens lmd-team-list" data-team="tokens"></ul>' +
      (mine.active ? '<div class="lmd-share-row lmd-team-invite lmd-team-tok"><input type="text" data-t="tok-name" maxlength="40" autocomplete="off" placeholder="' + T('nombre del token') + '" aria-label="' + T('nombre del token') + '">' +
        '<input type="text" data-t="tok-folder" spellcheck="false" autocomplete="off" placeholder="' + T('carpeta (opcional)') + '" aria-label="' + T('carpeta (opcional)') + '"></div>' +
        '<label class="lmd-check"><input type="checkbox" data-t="tok-write" checked><span>' + T('Puede escribir') + '</span></label>' +
        '<label class="lmd-check"><input type="checkbox" data-t="tok-share"><span>' + T('Puede compartir y crear enlaces') + '</span></label>' +
        '<div class="lmd-acct-actions"><button type="button" class="lmd-btn" data-t="tok-new">' + T('Crear un token del equipo') + '</button></div>' : '');
  }
  // Lo que se pide aparte después de dibujar: la lista de tokens del equipo.
  async function mount(box, a) {
    const list = box.querySelector('[data-team=tokens]'); if (!list) return;
    let rows = [];
    try { rows = await LMD.cloud.team.tokens(); } catch (e) { return; }
    if (!list.isConnected) return;
    list.innerHTML = rows.length ? rows.map(tokenRow).join('') : '<li><span>' + T('Todavía no hay tokens.') + '</span></li>';
  }

  // Lo que queda dicho después de un cambio: se muestra una vez, en el próximo dibujo.
  let said = ''; let want = 0; let wantFor = 0;
  // Debajo de los planes: las invitaciones que esperan a esta cuenta y, si está en un equipo, el equipo.
  function section(a) {
    const t = a && a.team; if (!t) return '';
    const mine = t.mine; let out = '';
    const msg = '<p class="lmd-hint lmd-team-msg" role="status"' + (said ? '' : ' hidden') + '>' + esc(said) + '</p>'; said = '';
    if (t.invites.length) {
      out += '<ul class="lmd-tokens lmd-team-list" data-team="invites">' + t.invites.map((i) => '<li><span>' + esc(invited(i)) + (i.role && i.role !== 'editor' ? ' · ' + role(i.role) : '') + '</span><span class="lmd-team-acts">' +
        (mine ? '' : '<button type="button" data-t="yes" data-id="' + i.id + '">' + T('Unirme') + '</button>') + '<button type="button" data-t="no" data-id="' + i.id + '">' + T('Rechazar') + '</button></span></li>').join('') + '</ul>' +
        (mine ? '<p class="lmd-hint">' + T('Para aceptar, salí primero de tu equipo.') + '</p>' : '');
    }
    if (!mine) return out ? '<div class="lmd-team"><h4>' + T('Invitaciones') + '</h4>' + out + msg + '</div>' : '';
    // admin: administra personas y ajustes. owner: además paga, y es quien ve el cobro y maneja la protección.
    const admin = mine.role === 'admin'; const owner = mine.owner !== undefined ? !!mine.owner : admin;
    const boss = (mine.members.find((m) => (m.owner !== undefined ? m.owner : m.admin)) || {}).email || '';
    out = '<h4>' + T('Tu equipo') + (mine.name ? ' <small>' + esc(mine.name) + '</small>' : '') + '</h4>' +
      (mine.active ? '' : '<p class="lmd-hint">' + T('El plan del equipo venció. Las notas siguen ahí.') + '</p>') +
      // Quien ya pagaba por su cuenta: su suscripción no se toca. Se le dice que sigue activa y dónde darla de baja.
      (mine.solo && !owner ? '<p class="lmd-plan-why lmd-team-solo" role="status">' + T('Tu suscripción individual sigue activa.') + (a.manage ? ' <a href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Darla de baja') + '</a>' : '') + '</p>' : '') +
      '<div class="lmd-acct-row" data-team="role"><span>' + T('Tu papel') + '</span><b>' + role(mine.role) + '</b></div>' +
      (owner ? '' : '<p class="lmd-hint">' + esc(T('Administra {a}', { a: boss })) + '</p>') +
      (mine.role === 'reader' ? '<p class="lmd-hint">' + T('Leés las notas del equipo. Para editarlas, pedile a quien administra que cambie tu papel.') + '</p>' : '') +
      '<ul class="lmd-tokens lmd-team-list" data-team="members">' + mine.members.map((m) => '<li><span>' + (m.name && m.name !== String(m.email).split('@')[0] ? '<b class="lmd-team-name">' + esc(m.name) + '</b> · ' : '') + esc(m.email) + ' · ' + role(m.role || (m.admin ? 'admin' : 'editor')) + '</span>' +
        (admin && !m.owner && m.id !== a.id ? '<span class="lmd-team-acts">' + roleSelect('data-t="role" data-id="' + m.id + '"', m.role, T('Papel de {a}', { a: m.email })) +
          '<button type="button" data-t="remove" data-id="' + m.id + '" data-mail="' + esc(m.email) + '">' + T('Sacar') + '</button></span>' : '') + '</li>').join('') + '</ul>' + out;
    if (admin) {
      out += (mine.pending.length ? '<h4>' + T('Invitaciones pendientes') + '</h4><ul class="lmd-tokens lmd-team-list" data-team="pending">' + mine.pending.map((i) => '<li><span>' + esc(i.email) + ' · ' + role(i.role) + '</span><button type="button" data-t="uninvite" data-id="' + i.id + '">' + T('Quitar') + '</button></li>').join('') + '</ul>' : '') +
        (mine.active ? '<div class="lmd-share-row lmd-team-invite"><input type="email" data-t="email" autocomplete="off" placeholder="' + T('correo de la persona') + '" aria-label="' + T('correo de la persona') + '">' +
          roleSelect('data-t="invite-role"', 'editor', T('Papel')) + '<button type="button" class="lmd-btn lmd-btn-fill" data-t="invite">' + T('Invitar') + '</button></div>' +
          '<p class="lmd-hint">' + T('Quien solo lee también ocupa un lugar.') + '</p>' : '') +
        '<div class="lmd-acct-row"><span>' + T('Lugares') + '</span><b>' + T('{n} de {m} ocupados', { n: mine.used, m: mine.seats }) + '</b></div>';
    }
    if (owner && mine.billing && mine.active) {
      // Cambiar los lugares cambia el cobro: el costo que queda está a la vista antes de confirmar. Solo para quien paga.
      if (wantFor !== mine.seats) { want = mine.seats; wantFor = mine.seats; }
      out += '<div class="lmd-team-seats" data-min="' + Math.max(t.included, mine.used) + '" data-max="' + t.max + '" data-inc="' + t.included + '" data-now="' + mine.seats + '">' +
          '<button type="button" class="lmd-btn" data-t="less" aria-label="' + T('Menos lugares') + '">-</button><b data-t="n" aria-live="polite">' + want + '</b><button type="button" class="lmd-btn" data-t="more" aria-label="' + T('Más lugares') + '">+</button>' +
          '<span class="lmd-team-cost">' + T('{n} lugares: USD {a} por mes', { n: want, a: cost(want, t.included) }) + '</span>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-t="seats"' + (want === mine.seats ? ' disabled' : '') + '>' + T('Cambiar lugares') + '</button></div>';
    }
    out += policyBlock(mine, admin);
    out += vaultBlock(mine, owner);
    if (admin) {
      out += tokenBlock(mine) +
        '<h4>' + T('Registro de actividad') + '</h4><p class="lmd-hint">' + T('Quién hizo qué en el espacio del equipo, sin el contenido de las notas. Se guarda {n} días.', { n: mine.log_days || 90 }) + '</p>' +
        '<div class="lmd-acct-actions"><button type="button" class="lmd-btn" data-t="log">' + T('Ver el registro') + '</button></div>';
    }
    out += msg + '<div class="lmd-acct-actions">' + (admin ? '<button type="button" class="lmd-btn" data-t="name">' + T('Cambiar el nombre') + '</button>' : '') +
      (owner ? (a.manage ? '<a class="lmd-btn" href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Administrar la suscripción') + '</a>' : '')
        : '<button type="button" class="lmd-btn" data-t="leave">' + T('Salir del equipo') + '</button>') + '</div>';
    return '<div class="lmd-team">' + out + '</div>';
  }

  // Después de aceptar, salir o que lo saquen cambia lo que la cuenta puede hacer: se vuelve a pedir y se redibuja.
  const refresh = async () => { try { await LMD.sync.reload(); } catch (e) { /* sin conexión: queda lo que había */ } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch (e) { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* no se pudo */ } t.remove(); } };

  // La plantilla de las notas nuevas del equipo, en su ventana.
  function templateDialog(now) {
    return new Promise((resolve) => {
      const box = el('div', { class: 'lmd-ask lmd-team-tpl-ask' });
      box.innerHTML = '<div class="lmd-ask-card" role="dialog" aria-label="' + T('Plantilla de las notas nuevas') + '"><h3>' + T('Plantilla de las notas nuevas') + '</h3>' +
        '<p>' + T('Con este texto nace cada nota nueva del equipo. Vacío, nace con su título.') + '</p>' +
        '<textarea class="lmd-team-tpl-text" rows="10" spellcheck="false" maxlength="20000" aria-label="' + T('Plantilla de las notas nuevas') + '"></textarea>' +
        '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-d="no" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-d="ok">' + T('Guardar') + '</button></div></div>';
      box.querySelector('textarea').value = now || '';
      document.body.appendChild(box); box.querySelector('textarea').focus();
      const shut = (v) => { box.remove(); resolve(v); };
      box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') shut(null); });
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (e.target === box || (b && b.dataset.d === 'no')) shut(null); else if (b) shut(box.querySelector('textarea').value); });
    });
  }

  // ---------- Registro de actividad ----------
  const ACTION = { create: 'Creó', edit: 'Editó', move: 'Movió', delete: 'Eliminó', restore: 'Restauró', purge: 'Borró de la papelera', empty_trash: 'Vació la papelera', share: 'Compartió', unshare: 'Dejó de compartir',
    link: 'Creó un enlace', unlink: 'Quitó un enlace', invite: 'Invitó', uninvite: 'Quitó una invitación', join: 'Entró al equipo', leave: 'Salió del equipo', remove: 'Sacó a alguien', role: 'Cambió un papel',
    policy: 'Cambió un ajuste', team_name: 'Cambió el nombre del equipo', protect: 'Protegió el espacio', password: 'Cambió la contraseña', rotate: 'Empezó a rotar la llave', rotate_done: 'Rotó la llave', unprotect: 'Quitó la protección',
    destroy: 'Eliminó el contenido', ai: 'Entró una IA', ai_unlock: 'Desbloqueó para su IA', token_create: 'Creó un token', token_revoke: 'Revocó un token', automation: 'Creó una automatización', automation_remove: 'Quitó una automatización',
    site: 'Preparó un sitio', publish: 'Publicó un sitio', unpublish: 'Despublicó un sitio', live_open: 'Abrió una sesión en vivo', live_end: 'Terminó una sesión en vivo', live_kick: 'Sacó a un invitado' };
  const POLICY_NAME = { share: 'Compartir', links: 'Enlaces públicos', live: 'Sesiones en vivo', tokens: 'IA de los miembros', automation: 'Automatizaciones', publish: 'Publicar sitios', history_days: 'Historial de versiones', folder: 'Carpeta de las notas nuevas', template: 'Plantilla de las notas nuevas', ai_unlock: 'Desbloqueo para la IA' };
  // El detalle de una fila, en palabras: a quién, hacia dónde, qué ajuste y a qué valor.
  function detail(e) {
    const out = [];
    if (e.path) out.push(e.path);
    if (e.action === 'move' && e.detail) out.push('→ ' + e.detail);
    else if (e.action === 'policy') { const m = /^([a-z_]+)(?:=(.*))?$/.exec(e.detail) || []; out.push(T(POLICY_NAME[m[1]] || 'Ajuste') + (m[2] ? ': ' + (m[2] === 'on' ? T('sí') : m[2] === 'off' ? T('no') : days(+m[2])) : '')); }
    else if (ROLE[e.detail]) out.push(role(e.detail));
    else if (e.detail && e.action !== 'share' && e.action !== 'link') out.push(e.detail);
    if (e.about) out.push(e.about);
    return out.join(' · ');
  }
  // guest: un invitado de una sesión en vivo, con el nombre que eligió. auto: lo hizo el servidor (la sesión venció o perdió su permiso).
  const actor = (e) => (e.via === 'guest' ? e.token + ' · ' + T('invitado') : e.via === 'auto' ? T('Automático') : e.via === 'team' ? T('Token del equipo') + ' · ' + e.token : (e.who_name || e.who || T('Cuenta eliminada')) + (e.via === 'ai' ? ' · ' + T('IA') + ' ' + e.token : ''));
  async function logDialog(mine) {
    const C = LMD.cloud.team; const when = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'medium', timeStyle: 'short' });
    const box = el('div', { class: 'lmd-ask lmd-tlog-ask' });
    const title = T('Registro de actividad');
    box.innerHTML = '<div class="lmd-ask-card lmd-tlog" role="dialog" aria-label="' + title + '"><h3>' + title + '</h3>' +
      '<div class="lmd-tlog-filters"><select data-l="who" aria-label="' + T('Persona') + '"><option value="">' + T('Todas las personas') + '</option>' + mine.members.map((m) => '<option value="' + m.id + '">' + esc(m.email) + '</option>').join('') + '</select>' +
      '<select data-l="action" aria-label="' + T('Tipo') + '"><option value="">' + T('Todo') + '</option>' + Object.keys(ACTION).map((k) => '<option value="' + k + '">' + T(ACTION[k]) + '</option>').join('') + '</select>' +
      '<label><span>' + T('Desde') + '</span><input type="date" data-l="from"></label><label><span>' + T('Hasta') + '</span><input type="date" data-l="to"></label></div>' +
      '<ul class="lmd-tlog-list" data-l="list" tabindex="0"></ul>' +
      '<p class="lmd-hint">' + T('No guarda el contenido de las notas. Se borra a los {n} días.', { n: mine.log_days || 90 }) + (mine.vault ? ' ' + T('Con el espacio protegido, los nombres de las notas siguen a la vista acá.') : '') + '</p>' +
      '<p class="lmd-dlg-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-l="more" hidden>' + T('Ver más') + '</button><button type="button" class="lmd-btn" data-l="csv">' + T('Exportar CSV') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-l="close" data-esc>' + T('Cerrar') + '</button></div></div>';
    document.body.appendChild(box);
    const q = (n) => box.querySelector('[data-l=' + n + ']'); const err = box.querySelector('.lmd-dlg-err');
    // Un día elegido va de su primer instante al último, en la hora de quien mira.
    const at = (v, end) => { const d = v ? new Date(v + (end ? 'T23:59:59.999' : 'T00:00:00')) : null; return d && !isNaN(d) ? String(d.getTime()) : ''; };
    const filters = () => { const p = new URLSearchParams(); const set = (k, v) => { if (v) p.set(k, v); }; set('who', q('who').value); set('action', q('action').value); set('from', at(q('from').value)); set('to', at(q('to').value, true)); return p; };
    let rows = []; let turn = 0;
    const draw = (more) => {
      q('list').innerHTML = rows.length ? rows.map((e) => '<li><time>' + esc(when(e.at)) + '</time><b>' + esc(actor(e)) + '</b><span>' + T(ACTION[e.action] || e.action) + '</span><small>' + esc(detail(e)) + '</small></li>').join('')
        : '<li class="lmd-tlog-none">' + T('No hay actividad con esos filtros.') + '</li>';
      q('more').hidden = !more;
    };
    const load = async (next) => {
      const mineTurn = ++turn; err.hidden = true;
      const p = filters(); if (next && rows.length) p.set('before', rows[rows.length - 1].id);
      try {
        const r = await C.log(p.toString()); if (mineTurn !== turn) return;
        rows = next ? rows.concat(r.entries) : r.entries; draw(r.more);
      } catch (e) { if (mineTurn === turn) { err.hidden = false; err.textContent = why(e); } }
    };
    box.addEventListener('change', (e) => { if (e.target.closest('.lmd-tlog-filters')) load(false); });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') box.remove(); });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-l]');
      if (e.target === box || (b && b.dataset.l === 'close')) { box.remove(); return; }
      if (!b) return;
      if (b.dataset.l === 'more') load(true);
      else if (b.dataset.l === 'csv') {
        const p = filters(); p.set('format', 'csv'); err.hidden = true;
        try {
          const r = await C.log(p.toString());
          const url = URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }));
          const a = el('a', { href: url, download: 'sharpmd-team-activity.csv' }); document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (x) { err.hidden = false; err.textContent = why(x); }
      }
    });
    await load(false);
  }

  // Si un clic dentro de Plan es de la gestión del equipo.
  const owns = (e, box) => { const b = e.target.closest && e.target.closest('[data-t]'); return !!b && box.contains(b) && !!b.closest('.lmd-team'); };
  // Lo que se cambia sin botón: el papel de alguien y los ajustes del equipo. redraw vuelve a dibujar el panel.
  async function change(e, box, a, redraw) {
    const sel = e.target.closest && e.target.closest('.lmd-team [data-t=role], .lmd-team [data-p]'); if (!sel || !box.contains(sel)) return false;
    const C = LMD.cloud.team; const say = (text) => { const m = box.querySelector('.lmd-team-msg'); if (m) { m.hidden = false; m.textContent = text; } };
    try {
      if (sel.dataset.t === 'role') { await C.role(+sel.dataset.id, sel.value); said = T('Papel cambiado.'); }
      else {
        const k = sel.dataset.p;
        await C.policies({ [k]: sel.type === 'checkbox' ? sel.checked : k === 'history_days' ? +sel.value : sel.value.trim() });
        said = T('Ajuste guardado.');
      }
    } catch (err) { said = ''; await refresh(); redraw(); setTimeout(() => say(why(err)), 0); return true; }
    await refresh(); redraw();
    return true;
  }
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
    // Campos y listas: se leen al confirmar, o los atiende change.
    if (['n', 'email', 'role', 'invite-role', 'tok-name', 'tok-folder', 'tok-write', 'tok-share'].includes(kind)) return true;
    if (/^v-/.test(kind)) {
      // Las ventanas son de vault.js: cuando algo cambia, avisa (onTeam) y la gestión se vuelve a dibujar.
      again = async () => { await refresh(); if (box.isConnected) redraw(); };
      try { await LMD.vault.teamDo(kind.slice(2), b.checked); } catch (err) { say(why(err)); }
      return true;
    }
    if (kind === 'log') { logDialog(mine); return true; }
    if (kind === 'tok-copy') {
      const input = b.parentNode.querySelector('input'); input.select(); await copy(input.value);
      b.textContent = T('Copiado'); setTimeout(() => { if (b.isConnected) b.textContent = T('Copiar'); }, 1500);
      return true;
    }
    if (kind === 'tok-brief') { if (fresh) { await copy(LMD.sync.aiBrief({ url: fresh.mcp_url, token: fresh.token, scope: fresh.scope, share: fresh.share })); say(T('Instrucciones copiadas. Pegalas en tu IA.')); } return true; }
    try {
      if (kind === 'invite') {
        const input = box.querySelector('[data-t=email]'); const mail = input.value.trim().toLowerCase();
        if (!LMD.kit.validEmail(mail)) { say(T('Ese correo no parece válido.')); input.focus(); return true; }
        b.disabled = true;
        await C.invite(mail, (box.querySelector('[data-t=invite-role]') || {}).value || 'editor'); said = T('Invitación enviada.');
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
      } else if (kind === 'template') {
        const text = await templateDialog(mine.policies.template);
        if (text == null) return true;
        await C.policies({ template: text }); said = T('Ajuste guardado.');
      } else if (kind === 'tok-new') {
        const name = box.querySelector('[data-t=tok-name]'); const write = box.querySelector('[data-t=tok-write]').checked;
        if (!name.value.trim()) { say(T('Escribí un nombre.')); name.focus(); return true; }
        b.disabled = true;
        const made = await C.newToken({ name: name.value.trim(), folder: box.querySelector('[data-t=tok-folder]').value.trim().replace(/^\/+|\/+$/g, ''), write, share: write && box.querySelector('[data-t=tok-share]').checked });
        fresh = Object.assign(made, { team: mine.id, at: Date.now() });
      } else if (kind === 'tok-rm') {
        if (!(await LMD.dialog.confirm({ title: T('¿Revocar el token "{a}"?', { a: b.dataset.name }), text: T('Lo que lo usa deja de entrar.'), ok: T('Revocar'), danger: true }))) return true;
        await C.revoke(+b.dataset.id); if (fresh && fresh.id === +b.dataset.id) fresh = null;
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
    box.innerHTML = '<div class="lmd-ask-card" role="dialog"><h3></h3><p>' + T(inv.role === 'reader' ? 'Con el equipo tenés el plan pago y leés las notas compartidas.' : 'Con el equipo tenés el plan pago y las notas compartidas.') + '</p>' +
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

  LMD.team = { init, column, section, mount, owns, click, change, notice, cost, planLabel, guestCard, role };
})();
