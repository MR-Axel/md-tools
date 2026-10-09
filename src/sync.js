// Ícono de la nube en la barra: dice si la nota está sincronizada, guardando, sin conexión o fuera de la nube.
// Desde ahí se sube una nota a la nube y se abre el historial de versiones (plan pago).
// También viven acá los paneles de la cuenta (Nube, IA y Plan), la espera del pago y el envío de comentarios.
// Lo del plan de equipo (su columna en Plan, la gestión y el aviso de una invitación) está en team.js.
(function () {
  'use strict';

  const { el, ICON, esc } = LMD.kit;
  const T = LMD.t;
  let core = null; let account = null; let asked = false;

  // Con cada lectura de la cuenta: su equipo (que es una raíz del explorador) y, salvo que se esté en Plan, donde
  // ya figura, el aviso de una invitación que espera.
  function adopt(a, quiet) {
    if (!a) return;
    if (LMD.cloud.setTeam(a.team && a.team.mine) && core && core.APP) core.reloadTree();
    if (!quiet) LMD.team.notice(a);
  }
  let loading = null;
  function loadAccount() {
    // Sobre un .md de un sitio no se consulta: ahí el servidor no responde (CORS). Sobre uno del disco sí, por la extensión.
    if (asked || !LMD.cloud.signedIn() || !LMD.cloud.reach() || LMD.cloud.guest()) return loading || Promise.resolve();
    asked = true;
    // Si falla no se repinta: repintar volvería a consultar y quedaría pidiendo en bucle mientras no haya conexión.
    loading = (async () => { try { account = await LMD.cloud.account(); } catch (e) { account = null; asked = false; return; } adopt(account); paint(); siteNotice(account); })();
    return loading;
  }
  // La cuenta, esperando la consulta si todavía está en camino. null sin sesión o sin conexión.
  const me = async () => { await LMD.cloud.ready(); await loadAccount(); return account; };

  const isCloud = () => !!core.appRoot && core.appRoot.kind === 'cloud';

  function paint() {
    const btn = core && core.ui.sync; if (!btn) return;
    // Quien entró por el enlace de una sesión en vivo no tiene cuenta acá: su estado lo dice la barra de la sesión.
    btn.hidden = !LMD.cloud.enabled() || !!LMD.cloud.guest();
    if (btn.hidden) return;
    let icon = ICON.cloudOff; let cls = 'lmd-sync-off'; let title;
    if (isCloud()) {
      const state = core.cloudState;
      if (state === 'error') { icon = ICON.cloudAlert; cls = 'lmd-sync-err'; title = T('Sin conexión: los cambios quedan en este navegador y se suben al volver'); }
      else if (state === 'saving') { icon = ICON.cloud; cls = 'lmd-sync-busy'; title = T('Guardando en la nube…'); }
      else { icon = ICON.cloudOk; cls = 'lmd-sync-ok'; title = T('Sincronizado con la nube'); }
    } else title = LMD.cloud.signedIn() ? T('Esta nota no está en la nube. Clic para subirla') : T('Sincronización apagada. Clic para entrar a tu cuenta');
    btn.className = 'lmd-icon-btn lmd-sync ' + cls;
    const others = isCloud() ? core.present.filter((m) => m !== LMD.cloud.email()) : [];
    // Quiénes están se ve en la tira de avatares de al lado (live.js): acá queda el estado de la nube.
    btn.innerHTML = icon;
    btn.title = title + (others.length ? ' · ' + T('También acá: {a}', { a: others.map((m) => (core.presentNames && core.presentNames[m]) || m).join(', ') }) : '');
    loadAccount();
  }

  const cloudHref = (path) => '?f=' + encodeURIComponent('cloud/' + path.split('/').map(encodeURIComponent).join('/'));
  // Abre una nota de la nube: en la app, en el lugar; sobre un archivo abierto directo, en la app.
  const openNote = (path, opt) => (core.APP ? core.open(core.urlOf(path), opt) : core.openApp(cloudHref(path) + (opt && opt.edit ? '&edit=1' : '')));

  // Subir a la nube es mudar la nota: una del navegador deja de estar ahí. Con un archivo de una carpeta del disco
  // se pregunta si se muda o si queda una copia, porque mudarlo es borrarlo del disco. Lo que no se puede quitar
  // de donde está (un archivo suelto, uno abierto directo en el navegador, un enlace público) se sube como copia.
  // El original se quita con la subida ya confirmada por el servidor, nunca antes.
  async function upload() {
    const root = core.APP ? core.appRoot : null; const kind = root ? root.kind : ''; const here = core.HERE; const name = core.docName;
    let move = false;
    // La primera nota que va a la nube: una línea de cómo queda guardada, con el camino al detalle en Ajustes.
    const more = account && account.notes > 0 ? null : { text: LMD.cloud.own() ? '' : T('Viaja cifrada y se guarda cifrada en el servidor.'), link: T('Seguridad de la nube'), go: () => core.openPanel('cloud') };
    if (kind === 'local') {
      if (!(await LMD.dialog.confirm({ title: T('¿Mover "{a}" a la nube?', { a: name }), text: T('Deja de estar guardada en este navegador.'), ok: T('Mover a la nube'), more }))) return;
      move = true;
    } else if (kind === 'dir') {
      const pick = await LMD.dialog.confirm({ title: T('¿Subir "{a}" a la nube?', { a: name }), text: T('Al moverla, el archivo se elimina del disco.'), ok: T('Mover a la nube'), alt: T('Dejar una copia'), more });
      if (!pick) return;
      move = pick === true;
    } else if (!(await LMD.dialog.confirm({ title: T('¿Subir "{a}" a la nube?', { a: name }), text: T('Queda una copia sincronizada; el archivo de acá no se toca.'), ok: T('Subir a la nube'), more }))) return;
    // Lo que se muda es lo último escrito: primero se guarda donde está.
    if (move && core.dirty && !(await core.save(false))) return;
    try {
      const taken = new Set((await LMD.cloud.list(true)).map((n) => n.path));
      const dot = core.docName.lastIndexOf('.'); const stem = dot > 0 ? core.docName.slice(0, dot) : core.docName; const ext = dot > 0 ? core.docName.slice(dot) : '.md';
      let path = stem + ext;
      for (let n = 2; n < 50 && taken.has(path); n++) path = stem + '-' + n + ext;
      await LMD.cloud.write(path, core.raw);
      let left = false;
      if (move) {
        try {
          const file = decodeURIComponent(here.split('/').pop());
          if (kind === 'local') await LMD.store.noteDelete(file);
          else await (await core.dirHandle(new URL('.', here).href)).removeEntry(file);
        } catch (e) { left = true; }
      }
      await openNote(path, move && !left ? { tree: true, replace: true, discard: true } : { tree: true });
      if (left) core.flash(T('La nota se subió, pero el original no se pudo quitar.'), 'warn');
    } catch (e) {
      if (e.code === 'note_limit') core.openPanel('plan', T('Llegaste al límite de notas del plan gratis. El plan pago no tiene límite.'));
      else core.flash(T(e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo subir la nota.'), 'error');
    }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function openMenu(btn) {
    closeMenu();
    const pro = !!account && account.plan === 'pro';
    const notes = LMD.comments.mode(); // '' no se ofrece, 'on' disponible, 'vault' carpeta protegida
    // En una carpeta protegida no hay compartir ni comentarios para la IA: se dice por qué, con el camino a seguir.
    const vaulted = !mine().owner && !!LMD.vault.of(core.cloudPath);
    // Una nota del equipo ya es de todos sus miembros. Compartirla hacia afuera, o abrirle una sesión en vivo con
    // invitados, solo si el papel de la cuenta y lo que decidió quien administra lo permiten, y nunca en un espacio protegido.
    const team = LMD.cloud.isTeam(core.cloudPath);
    const teamShare = team && !LMD.vault.of(core.cloudPath) && (LMD.cloud.teamCan('share') || LMD.cloud.teamCan('links'));
    const teamVaulted = team && !!LMD.vault.of(core.cloudPath);
    const teamLive = team && (LMD.live.active() || (LMD.cloud.teamCan('write') && LMD.cloud.teamCan('live')));
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' +
      (core.readOnly || (team && !teamShare) ? '' : '<button type="button" role="menuitem" data-s="share"' + (account && account.share && (teamShare || (!mine().owner && !vaulted)) ? '' : ' class="lmd-locked"') + '>' + ICON.link + '<span>' + T('Compartir') + '</span></button>') +
      // Sesión en vivo: quien tiene el enlace entra a editar sin cuenta. La abre quien creó la nota, con el plan pago,
      // o en una nota del equipo un miembro que puede editar.
      (core.readOnly || (team && !teamLive) ? '' : '<button type="button" role="menuitem" data-s="live"' + (team || (account && account.live && !mine().owner && !vaulted) ? '' : ' class="lmd-locked"') + '>' + ICON.people + '<span>' + T('Colaborar en vivo') + '</span>' + (LMD.live.active() ? '<b class="lmd-menu-n">' + LMD.live.count() + '</b>' : '') + '</button>') +
      '<button type="button" role="menuitem" data-s="history"' + (pro ? '' : ' class="lmd-locked"') + '>' + ICON.reload + '<span>' + T('Historial de versiones') + '</span></button>' +
      '<button type="button" role="menuitem" data-s="ai">' + ICON.link + '<span>' + T('Conectar una IA') + '</span></button>' +
      (notes ? '<button type="button" role="menuitem" data-s="comments"' + (notes === 'on' ? '' : ' class="lmd-locked"') + '>' + ICON.comment + '<span>' + T('Comentarios para la IA') + '</span>' + (LMD.comments.count() ? '<b class="lmd-menu-n">' + LMD.comments.count() + '</b>' : '') + '</button>' : '') +
      (vaulted ? '<p class="lmd-menu-note">' + ICON.lock + '<span>' + T('Carpeta protegida: sin compartir, enlaces públicos ni comentarios para la IA. Para eso, movela a otra carpeta.') + '</span></p>' : '') +
      (account ? '<p class="lmd-menu-label">' + esc(account.email) + ' · ' + esc(LMD.team.planLabel(account)) + '</p>' : '') + '</div>';
    document.body.appendChild(menu);
    const box = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, box.bottom + 8)) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      closeMenu();
      // Conectar una IA vive en Ajustes: ahí se crea el token o, en el plan gratis, se ve qué hace falta.
      if (b.dataset.s === 'ai') { core.openPanel('ai'); return; }
      if (b.dataset.s === 'comments') { LMD.comments.list(); return; } // sin plan, lleva a Ajustes → Plan
      if (vaulted && b.dataset.s === 'share') { LMD.vault.explain(); return; }
      // En una carpeta protegida el servidor no puede leer la nota, así que no puede repartir los cambios.
      if ((vaulted || teamVaulted) && b.dataset.s === 'live') { LMD.live.explainVault(teamVaulted); return; }
      if (b.classList.contains('lmd-locked')) {
        if (mine().owner) core.flash(T('Solo quien creó la nota puede hacer eso.'), 'warn');
        else core.openPanel('plan', T(b.dataset.s === 'history' ? 'El historial de versiones es parte del plan pago.' : b.dataset.s === 'live' ? 'Colaborar en vivo es parte del plan pago.' : 'Compartir es parte del plan pago.'));
        return;
      }
      if (b.dataset.s === 'history') history(); else if (b.dataset.s === 'live') LMD.live.open(); else share();
    });
  }

  // ---------- Paneles de la cuenta: Nube, IA y Plan ----------
  // Se dibujan dentro de Ajustes y, desde el inicio, en una ventana propia. host dice cómo moverse desde
  // donde están: { tab(nombre), login(), leave(), close(), unlocked(cuenta), back, appUrl, direct }.
  const hint = (text) => '<p class="lmd-hint">' + text + '</p>';
  // El nombre visible: se cambia en el lugar. Vacío vuelve a lo que va antes de la arroba del correo.
  const nameRow = (a) => (a.name === undefined ? '' : '<div class="lmd-acct-row lmd-acct-name"><span>' + T('Nombre visible') + '</span><b data-name title="' + esc(a.name) + '">' + esc(a.name) + '</b>' +
    '<button type="button" class="lmd-link" data-c="name">' + T('Cambiar') + '</button></div><p class="lmd-hint lmd-acct-name-hint">' + T('Los demás ven este nombre en notas compartidas y equipos') + '</p>');
  function editName(box, host) {
    const row = box.querySelector('.lmd-acct-name'); if (!row || row.querySelector('input')) return;
    const now = (account && account.name) || '';
    row.innerHTML = '<span>' + T('Nombre visible') + '</span><input type="text" data-name-in maxlength="40" spellcheck="false" autocomplete="nickname" aria-label="' + T('Nombre visible') + '">' +
      '<button type="button" class="lmd-btn lmd-btn-fill" data-c="name-ok">' + T('Guardar') + '</button><button type="button" class="lmd-btn" data-c="name-no">' + T('Cancelar') + '</button>';
    const input = row.querySelector('input'); input.value = now; input.focus(); input.select();
    const hintLine = box.querySelector('.lmd-acct-name-hint'); const base = hintLine ? hintLine.textContent : '';
    const fail = (text) => { if (hintLine) { hintLine.textContent = text; hintLine.classList.add('lmd-acct-name-bad'); hintLine.setAttribute('role', 'alert'); } input.setAttribute('aria-invalid', 'true'); input.focus(); };
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (hintLine) { hintLine.textContent = base; hintLine.classList.remove('lmd-acct-name-bad'); hintLine.removeAttribute('role'); } });
    let busy = false;
    const save = async () => {
      if (busy) return;
      const v = input.value.replace(/\s+/g, ' ').trim();
      if (v === now) { cloudPane(box, host); return; }
      if (v && (v.length < 2 || v.length > 40 || v.includes('@'))) { fail(T('De 2 a 40 caracteres, sin arroba.')); return; }
      busy = true;
      try { account = await LMD.cloud.setName(v); adopt(account, true); paint(); cloudPane(box, host); }
      catch (e) { busy = false; fail(T(e.code === 'too_many' ? 'Demasiados cambios por ahora. Probá más tarde.' : e.code === 'bad_name' ? 'De 2 a 40 caracteres, sin arroba.' : 'No se pudo guardar. Probá de nuevo.')); }
    };
    row._save = save;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cloudPane(box, host); } });
  }
  const acctRow = (label, value) => '<div class="lmd-acct-row"><span>' + label + '</span><b title="' + value + '">' + value + '</b></div>';
  const actions = (html) => '<div class="lmd-acct-actions">' + html + '</div>';
  const loginBtn = (host) => (host.login ? actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Crear cuenta o entrar') + '</button>') : '');
  // Se entra en Ajustes → Nube, ahí mismo. Desde IA o Plan el botón lleva a esa pestaña con el correo ya pedido.
  let wantLogin = false;
  // "Nombre visible" del menú de la cuenta: Nube se abre con ese campo ya en edición.
  let wantName = false;
  const goLogin = (host) => { if (host.direct || !host.tab) host.login(); else { wantLogin = true; host.tab('cloud'); } };
  const quota = (a) => (a.limit ? T('{n} de {m}', { n: a.notes, m: a.limit }) : T('{n}, sin límite', { n: a.notes }));
  const fetchAccount = async (host) => { account = await LMD.cloud.account(); asked = true; adopt(account, true); if (host && host.unlocked) host.unlocked(account); return account; };
  const offline = () => hint(T('No hay conexión con el servidor.'));
  // Un .md de un sitio abierto en el navegador no puede hablar con el servidor (host.direct): la cuenta está en la
  // app, y lo dice una franja arriba de Ajustes (content.js). Uno del disco sí puede, por la extensión, y ahí estos
  // paneles andan como en la app. En los dos casos se paga en la app: el botón la abre ya en los planes.
  const DIRECT_AT = { plan: '#lmd-plans' };
  const goApp = (host, e) => { const b = e.target.closest('[data-c=app]'); if (b) host.openApp(b.dataset.at); return !!b; };

  // Abre la carpeta Nube con el árbol a la vista: la nota más nueva, o la primera si todavía no hay ninguna.
  async function openCloud(host) {
    try {
      if (core.APP) core.showFiles('cloud');
      if (core && core.APP && isCloud()) { host.close(); return; }
      const rows = await LMD.cloud.list(true);
      const made = rows.length ? null : await LMD.home.cloudNote();
      if (!core.APP) await host.leave();
      host.close();
      await openNote(made || rows[0].path, { edit: !!made, tree: true });
    } catch (e) { if (host.say) host.say(T(e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo completar. Probá de nuevo.')); }
  }

  // ---------- Seguridad de la nube: qué se cifra, dónde, y quién tiene la llave ----------
  // Va en Ajustes → Nube, con sesión y sin ella. Cada renglón es un hecho que se puede comprobar en el código.
  const PRIVACY = 'https://sharpmd.app/privacy.html#cloud-notes';
  const TERMS = 'https://sharpmd.app/terms.html';
  let secRedraw = null;
  // Cada hecho es una tarjeta: el ícono y el título arriba, un párrafo, y la línea técnica como etiqueta al pie.
  const secRow = (id, icon, title, text, tech, extra) => '<li data-sec-row="' + id + '"><div class="lmd-sec-head"><span class="lmd-sec-ico">' + icon + '</span><b>' + T(title) + '</b></div><p>' + T(text) + '</p>' + (extra || '') + (tech ? '<small class="lmd-sec-tech">' + tech + '</small>' : '') + '</li>';
  // own: un servidor propio. can: se ofrece proteger una carpeta. count: carpetas protegidas de la cuenta.
  // pick: se está eligiendo cuál proteger, entre folders.
  // ai: la clave del asistente de este dispositivo, si se sabe: { hasKey, provider, last4, off }. De la clave solo
  // se muestran el proveedor y los últimos cuatro caracteres, lo mismo que en la tarjeta del asistente.
  const AI_NAMES = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI' };
  // Lo que se sabe de la clave sin cargar el asistente: lo lee de donde él la guarda. off: la herramienta está
  // apagada y hay una pestaña Herramientas donde prenderla.
  async function aiKeyInfo() {
    let st = null;
    try { st = LMD.ai && LMD.ai.status ? await LMD.ai.status() : await LMD.store.aiGet(); } catch (e) { /* sin base local: se informa igual, sin el dato */ }
    return { hasKey: !!(st && (st.hasKey || st.data)), provider: (st && st.provider) || '', last4: (st && st.last4) || '', off: !(LMD.tools && LMD.tools.isOn('assistant')) && !!document.querySelector('[data-ptab=tools]') };
  }
  function security(o) {
    o = o || {};
    const n = o.count || 0; const ai = o.ai || null;
    const choose = !o.pick ? '' : !(o.folders || []).length ? '<p class="lmd-sec-pick" role="status">' + T('Primero creá una carpeta en la Nube. Después la protegés desde acá o desde el menú de la carpeta.') + '</p>'
      : '<div class="lmd-sec-pick"><span>' + T('Elegí la carpeta') + '</span>' + o.folders.map((f) => '<button type="button" class="lmd-btn" data-c="protect-at" data-f="' + esc(f) + '">' + ICON.folder + '<span>' + esc(f) + '</span></button>').join('') + '</div>';
    return '<section class="lmd-sec" aria-label="' + T('Seguridad') + '"><h4>' + T('Seguridad') + '</h4><ul>' +
      (o.own ? secRow('notes', ICON.lock, 'Notas en la nube', 'En un servidor propio, el cifrado en tránsito y en el servidor depende de cómo esté instalado. El servidor puede leerlas, para compartirlas y atender a tu IA.', 'HTTPS · DATA_KEY')
        : secRow('notes', ICON.lock, 'Notas en la nube', 'Viajan cifradas y se guardan cifradas en el servidor. El servidor tiene la llave, para poder compartirlas y atender a tu IA.', 'HTTPS · AES-256-GCM')) +
      // Dos columnas parejas: las notas junto a las carpetas protegidas, la clave de IA junto a cómo se entra, y el
      // código abierto al final, a lo ancho. Ver los estilos de .lmd-sec en content.css.
      secRow('vaults', ICON.shield, 'Carpetas protegidas', 'Se cifran en tu dispositivo con tu contraseña. Ni el servidor puede leerlas.', 'AES-256-GCM · PBKDF2 · ' + T('En el plan gratis y en el pago'),
        '<p>' + T('Los nombres de archivos y carpetas quedan visibles. Sin la contraseña y sin la clave de respaldo, esas notas no se pueden recuperar.') + '</p>' +
        (n ? '<p class="lmd-sec-count">' + T(n === 1 ? 'Tenés 1 carpeta protegida.' : 'Tenés {n} carpetas protegidas.', { n }) + '</p>' : '') +
        (o.can ? '<p class="lmd-sec-act"><button type="button" class="lmd-link" data-c="protect">' + T('Proteger una carpeta') + '</button></p>' + choose : '')) +
      // La clave del asistente (aikey.js): dónde queda y por dónde viaja. Informa aunque el asistente esté apagado.
      secRow('aikey', ICON.spark, 'Tu clave de IA', 'Se guarda cifrada solo en este dispositivo. No pasa por el servidor de SharpMD ni se sincroniza, y las llamadas van directo a tu proveedor.',
        'AES-256-GCM · ' + T('llave no exportable'),
        (ai && ai.hasKey ? '<p class="lmd-sec-key">' + esc(ai.provider === 'compat' ? T('Compatible con OpenAI') : AI_NAMES[ai.provider] || ai.provider) + ' · ••••' + esc(ai.last4 ? ' ' + ai.last4 : '') + '</p>' : '') +
        (ai && ai.off ? '<p class="lmd-sec-act"><button type="button" class="lmd-link" data-c="ai-tools">' + T('Prender en Herramientas') + '</button></p>' : '')) +
      secRow('signin', ICON.key, 'Entrar sin contraseña', 'Entrás con un código de un solo uso que llega a tu correo. No hay contraseña de cuenta que se pueda filtrar.', T('Las sesiones y los tokens se guardan como hash')) +
      secRow('open', ICON.code, 'Sin analítica y con código abierto', 'No hay analítica. El código es abierto y podés usar tu propio servidor.', T('App MIT · Servidor AGPL')) +
      '</ul><p class="lmd-sec-foot">' + T('Una nota eliminada queda 30 días en la papelera.') + ' <a href="' + PRIVACY + '" target="_blank" rel="noopener noreferrer">' + T('Cómo funciona') + '</a>' +
      // Los términos regulan el servicio alojado: con un servidor propio no se muestran.
      (o.own ? '' : ' · <a href="' + TERMS + '" target="_blank" rel="noopener noreferrer">' + T('Términos') + '</a>') + '</p></section>';
  }

  // ---------- Publicar una carpeta como sitio ----------
  // Lo pesado (dibujar las páginas, la ventana) está en publish.js, que se carga cuando hace falta. Acá queda lo
  // que tiene que estar siempre: si se ofrece, el estado en una línea, el aviso y volver a publicar al guardar.
  const pagesOf = (a) => (a && a.pages && a.pages.enabled ? a.pages : null);
  const siteDay = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'long' });
  // Se ofrece en una carpeta de la nube sin contraseña, si el servidor publica sitios. En el equipo, si su política lo permite.
  function canPublish(folder) {
    const pg = pagesOf(account); if (!pg || !folder || /^~\d+$/.test(folder)) return false;
    if (LMD.cloud.vaultsNow().some((v) => folder === v.folder || folder.startsWith(v.folder + '/'))) return false;
    return folder[0] === '~' ? !!pg.team : true;
  }
  const publish = (folder, id, done) => core.ensure('publish').then((ok) => { if (ok) LMD.publish.open(core, { folder, id, done }); });
  function siteState(s) {
    if (s.suspended) return { kind: 'bad', text: T('Suspendido') };
    if (s.live && s.lapsed) return { kind: 'warn', text: T('Se despublica el {a}', { a: siteDay(s.ends) }) };
    if (s.live) return { kind: 'ok', text: T('Publicado') };
    return { kind: 'off', text: T(s.lapsed ? 'Sin publicar: la cuenta ya no tiene el plan pago' : 'Sin publicar') };
  }
  // Un sitio suspendido o por despublicarse se avisa una vez por sesión del navegador.
  function siteNotice(a) {
    const pg = pagesOf(a); const s = pg && (pg.sites || []).find((x) => x.can && (x.suspended || (x.live && x.lapsed))); if (!s || !core || !core.APP) return;
    const stamp = s.id + (s.suspended ? 's' : 'l');
    try { if (sessionStorage.getItem('lmd:site-note') === stamp) return; } catch (e) { /* sin almacenamiento se avisa igual */ }
    // La cuenta se lee antes de que la nota esté en pantalla: el aviso espera a que haya dónde mostrarlo.
    setTimeout(() => {
      try { sessionStorage.setItem('lmd:site-note', stamp); } catch (e) { /* sin almacenamiento */ }
      core.flash(s.suspended ? T('Tu sitio publicado está suspendido. Los detalles están en Ajustes, en Nube.') : T('Tu sitio se despublica el {a}. Con el plan pago sigue publicado.', { a: siteDay(s.ends) }), 'warn');
    }, 1500);
  }
  function siteBlock(a, host) {
    const pg = pagesOf(a); if (!pg || host.direct || !core.APP) return ''; // publicar una carpeta se hace en la app, con el explorador de la nube
    const rows = (pg.sites || []).map((s) => { const st = siteState(s); return '<div class="lmd-site-row" data-site="' + s.id + '"><div><b>' + esc(s.title || s.slug) + '</b><a class="lmd-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(String(s.url).replace(/^https?:\/\//, '')) + '</a>' +
      '<span class="lmd-site-state lmd-site-' + st.kind + '">' + esc(st.text) + '</span></div><button type="button" class="lmd-btn" data-c="site" data-id="' + s.id + '">' + T('Administrar') + '</button></div>'; }).join('');
    const room = (pg.sites || []).filter((s) => !s.team).length < pg.max;
    return '<section class="lmd-site-sec" aria-label="' + T('Sitio publicado') + '"><h4>' + T('Sitio publicado') + '</h4>' + (rows || hint(T('Una carpeta de notas se convierte en un sitio web público, con menú, buscador y tema.'))) +
      (room ? actions('<button type="button" class="lmd-btn" data-c="site-new">' + T('Publicar una carpeta') + '</button>') : '') + '</section>';
  }

  async function cloudPane(box, host) {
    await LMD.cloud.ready();
    secRedraw = null;
    const nameNow = wantName; wantName = false;
    const canProtect = !host.direct && core.APP && LMD.vault.can(); let picking = false; let free = []; let ai = null;
    const secNow = (count) => security({ own: LMD.cloud.own(), can: canProtect, count, pick: picking, folders: free, ai });
    if (!LMD.cloud.enabled()) box.innerHTML = hint(T('La nube está apagada: SharpMD funciona sin cuenta y sin sincronizar.')) + actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="on">' + T('Prender la nube') + '</button>');
    else if (host.direct) box.innerHTML = '<div data-sec>' + secNow(0) + '</div>';
    else if (!LMD.cloud.signedIn()) box.innerHTML = LMD.home.perks() + actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Crear cuenta o entrar') + '</button>') + '<div data-sec>' + secNow(0) + '</div>';
    else {
      try {
        const a = await fetchAccount(host);
        box.innerHTML = acctRow(T('Cuenta'), esc(a.email)) + nameRow(a) + acctRow(T('Plan'), T(a.plan === 'pro' ? 'Pago' : 'Gratis')) + acctRow(T('Notas en la nube'), quota(a)) +
          actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="open">' + T('Abrir la carpeta Nube') + '</button><button type="button" class="lmd-btn" data-c="out">' + T('Salir') + '</button>') +
          '<div data-two></div><p class="lmd-hint lmd-acct-msg" role="status" hidden></p>' + siteBlock(a, host) + '<div data-sec>' + secNow(0) + '</div>' +
          '<p class="lmd-acct-del"><button type="button" class="lmd-link" data-c="delete">' + T('Eliminar la cuenta') + '</button></p>';
        // La web y la extensión con cuentas distintas: se dice acá (bridge.js).
        LMD.bridge.paintSession(box.querySelector('[data-two]'), () => { if (box.isConnected) cloudPane(box, host); });
        if (nameNow) editName(box, host);
      } catch (e) { if (!LMD.cloud.signedIn()) return cloudPane(box, host); box.innerHTML = offline(); }
    }
    // Con sesión, el bloque de seguridad suma cuántas carpetas protegidas hay y cuáles se pueden proteger.
    const sec = async () => {
      const slot = box.querySelector('[data-sec]'); if (!slot) return;
      let count = 0;
      ai = await aiKeyInfo();
      if (LMD.cloud.signedIn() && !host.direct && core.APP) {
        try {
          count = (await LMD.vault.load()).filter((v) => v.state === 'on').length;
          free = foldersOf(await LMD.cloud.list(true)).filter((f) => LMD.vault.menu(f).some((m) => m[0] === 'v-protect'));
        } catch (e) { /* sin conexión: el bloque queda sin la cuenta */ }
      }
      if (slot.isConnected) slot.innerHTML = secNow(count);
    };
    if (box.querySelector('[data-sec]')) { secRedraw = () => { if (box.isConnected) { picking = false; sec(); } }; sec(); }
    // El correo y el código se piden acá, con el mismo formulario del inicio: no hace falta salir de la nota.
    const askLogin = () => {
      const acts = box.querySelector('.lmd-acct-actions'); if (!acts || LMD.cloud.signedIn()) return;
      const form = el('div', { class: 'lmd-signin' }); acts.replaceWith(form);
      LMD.home.signIn(form, async () => { account = null; asked = false; paint(); LMD.home.account(); if (core.APP) core.reloadTree(); await cloudPane(box, host); });
    };
    if (wantLogin) { wantLogin = false; if (LMD.cloud.enabled() && !host.direct) askLogin(); }
    box.onclick = async (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (goApp(host, e)) return;
      if (b.dataset.c === 'on') LMD.patch({ cloudUrl: '' });
      else if (b.dataset.c === 'login') { if (host.direct) host.login(); else askLogin(); }
      else if (b.dataset.c === 'open') openCloud(Object.assign({ say: (t) => { const m = box.querySelector('.lmd-acct-msg'); if (m) { m.hidden = false; m.textContent = t; } } }, host));
      else if (b.dataset.c === 'out') { await signOut(host); cloudPane(box, host); }
      else if (b.dataset.c === 'delete') { if (await deleteAccount()) cloudPane(box, host); }
      else if (b.dataset.c === 'site' || b.dataset.c === 'site-new') publish('', b.dataset.id ? +b.dataset.id : 0, () => { if (box.isConnected) cloudPane(box, host); });
      else if (b.dataset.c === 'name') editName(box, host);
      else if (b.dataset.c === 'name-ok') { const row = box.querySelector('.lmd-acct-name'); if (row && row._save) row._save(); }
      else if (b.dataset.c === 'name-no') cloudPane(box, host);
      // Proteger una carpeta: sin sesión primero se entra; con una sola carpeta se va directo, con varias se elige.
      else if (b.dataset.c === 'ai-tools') host.tab('tools');
      else if (b.dataset.c === 'protect') { if (!LMD.cloud.signedIn()) askLogin(); else if (free.length === 1) LMD.vault.pick('v-protect', free[0]); else { picking = true; sec(); } }
      else if (b.dataset.c === 'protect-at') LMD.vault.pick('v-protect', b.dataset.f);
    };
  }

  // Eliminar la cuenta: se confirma escribiendo el correo. Con un cobro en marcha el servidor no la borra: se dice
  // qué hay que hacer antes, con el enlace para administrar la suscripción si lo hay. Devuelve true si se eliminó.
  const BLOCKED = {
    subscription_active: ['Primero cancelá la suscripción', 'La cuenta tiene una suscripción activa. Cancelala y después eliminá la cuenta.'],
    team_billing_active: ['Primero cancelá la suscripción del equipo', 'Administrás un equipo con una suscripción activa. Cancelala y después eliminá la cuenta.'],
    team_has_members: ['Tu equipo todavía tiene miembros', 'Sacalos del equipo desde Ajustes, en Plan, y después eliminá la cuenta.'],
  };
  async function deleteAccount() {
    const mail = LMD.cloud.email(); let stop = null;
    const typed = await LMD.dialog.prompt({
      title: T('Eliminar la cuenta'), danger: true, ok: T('Eliminar la cuenta'), label: T('Para confirmar, escribí tu correo'), empty: T('Escribí tu correo.'),
      text: T('Se borran tus notas de la nube, su historial, la papelera, lo compartido, los enlaces públicos y los tokens. No se puede deshacer.'),
      validate: async (v) => {
        if (v.toLowerCase() !== mail) return T('Ese no es el correo de esta cuenta.');
        try { await LMD.cloud.deleteAccount(v); return ''; }
        catch (e) {
          if (BLOCKED[e.code]) { stop = e; return ''; }
          return T(e.code === 'offline' ? 'No hay conexión con el servidor.' : e.code === 'too_many' ? 'Demasiados intentos. Probá de nuevo más tarde.' : 'No se pudo completar. Probá de nuevo.');
        }
      },
    });
    if (typed == null) return false;
    if (stop) {
      const why = BLOCKED[stop.code]; const manage = stop.code !== 'team_has_members' && stop.body && /^https:\/\//.test(stop.body.manage || '') ? stop.body.manage : '';
      await LMD.dialog.confirm({ title: T(why[0]), text: T(why[1]), ok: T('Entendido'), cancel: false, link: manage ? { href: manage, text: T('Administrar la suscripción') } : null });
      return false;
    }
    // Ya no hay cuenta: una nota de la nube que estuviera abierta se cierra, y el explorador queda sin la nube.
    const open = core && core.APP && isCloud();
    account = null; asked = false; paint(); LMD.home.account();
    if (open) await core.close({ discard: true, tree: true }); else if (core && core.APP) core.reloadTree();
    if (core) core.flash(T('Cuenta eliminada'));
    return true;
  }

  // Salir de la cuenta. Con una nota de la nube abierta, primero se sube lo pendiente y después la nota se cierra:
  // sin sesión no se puede leer ni guardar, y dejarla a la vista diría "guardado en la nube" sin que sea cierto.
  async function signOut(host) {
    const open = core && core.APP && isCloud();
    if (open && host && host.leave) { try { await host.leave(); } catch (e) { /* lo que no subió queda en la cola */ } }
    await LMD.cloud.logout(); account = null; asked = false; paint(); LMD.home.account();
    if (open) await core.close({ discard: true, tree: true }); else if (core && core.APP) core.reloadTree();
  }

  // Carpetas de la nube, con las de adentro: salen de las rutas de las notas.
  const foldersOf = (rows) => {
    const all = new Set();
    rows.forEach((n) => { const parts = n.path.split('/'); for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/')); });
    return [...all].sort((x, y) => x.localeCompare(y));
  };

  // El mensaje que la persona pega en su IA para conectarla y decirle cómo documentar acá. Va siempre en inglés,
  // en cualquier idioma de la app: lo lee una IA. Es el único lugar donde está ese texto.
  // o: { url, token, scope, share, workspace }. Sin token (uno viejo, que ya no se muestra) lleva el marcador
  // AI_TOKEN_MARK. workspace: false saca las secciones del espacio de proyecto (documentar, llevar el tablero y
  // llevar la lista de lo que le toca a la persona); el detalle de las tres está en la guía que el servidor
  // entrega con get_guide.
  const AI_TOKEN_MARK = 'PASTE_YOUR_TOKEN';
  function aiBrief(o) {
    const url = String(o.url || ''); const token = o.token || AI_TOKEN_MARK; const scope = String(o.scope || '').replace(/\/+$/, '');
    const fence = '\x60\x60\x60'; const dir = scope || '<project>';
    return [
      'You are being connected to SharpMD, a Markdown notes app. Use it to keep me informed in documents I can read in my browser.',
      '',
      '## Connect',
      '',
      'SharpMD has an MCP server (Streamable HTTP).',
      '',
      '- URL: ' + url,
      '- Header: Authorization: Bearer ' + token,
      '',
      'If you can add MCP servers yourself, do it now. If you cannot, tell me exactly what to paste and where.',
      '',
      'Claude Code:',
      '',
      fence,
      'claude mcp add --transport http sharpmd ' + url + ' --header "Authorization: Bearer ' + token + '"',
      fence,
      '',
      'Clients that read an mcpServers block (Cursor, a .mcp.json file and others):',
      '',
      fence + 'json',
      JSON.stringify({ mcpServers: { sharpmd: { type: 'http', url, headers: { Authorization: 'Bearer ' + token } } } }, null, 2),
      fence,
      '',
      'Apps where connectors are added from a settings screen (Claude Desktop, ChatGPT and others): add a custom MCP server with that URL and that header.',
      '',
      'Once it is connected, call list_notes and tell me what you see, so we both know it works.',
      'Treat the token as a secret: keep it out of notes, commits and logs.',
    ].concat(scope ? ['This token only reaches the folder ' + scope + '/. Keep every path inside it: anything outside is rejected.'] : [], [
      '',
      '## What to use it for',
      '',
      '- Keep a record of your work as you go: what changed, progress, decisions and why, open questions, what is left to do. I read it to follow along without asking.',
      '- When I ask you to explain a situation, write a document for it: context, what you found, the options and your recommendation.',
      '',
      '## Use it as project memory',
      '',
      '- Before you start a task, call search_notes and read the notes of the project, so you know the system: its architecture, the decisions already made and its conventions.',
      '- Keep one index note per project, for example ' + (scope ? scope : 'project') + '/README.md, with a link to every other note of that project.',
      '- When you build or change something, add or update a note about it and link it from the index. The next session, whether it is Claude, Codex or another agent, starts from that context.',
      '',
      '## Change notes without overwriting me',
      '',
      'I edit the same notes and files while you work, and I tick tasks in them.',
      '',
      '- Read a note right before you change it.',
      '- Prefer edit_note, set_task, append_note and the board tools over write_note. With write_note, pass base_rev from read_note.',
      '- Never untick or delete what I ticked or wrote.',
      '- If I changed something while you worked, merge it. Do not overwrite it.',
      '- The same goes for local files: read the file again right before each edit and make small edits. Never rewrite the whole file.',
    ], o.workspace === false ? [] : [
      '',
      '## Document the project',
      '',
      '- In the first session, unless it is there already, give the project a folder with README.md (what it is, how to run it, an index of links), architecture.md (with a Mermaid diagram), features/ (one note per feature, with its acceptance criteria), epics.md, decisions.md and log.md.',
      '- Search and read what already exists first. Link the notes with relative paths and keep them current as you work.',
      scope ? '- The project folder is ' + scope + '/, the one this token reaches.' : '- If the name of the project folder is not evident, ask me once.',
      '',
      '## Keep a task board',
      '',
      '- Keep a kanban board in ' + dir + '/board.md with the columns To do, In progress, Paused and Done. Use create_board, add_card, move_card and update_card. Do not rewrite its Markdown by hand.',
      '- Before you start, add each task as a card in To do, with a field agent naming the agent or subagent that does it.',
      '- Move it to In progress when you start, to Paused when you need something from me (say exactly what in a field needs, and tell me), and to Done when it is finished, with a field link to the note or the change.',
      '- One card per task, and finished cards stay. With subagents, each one moves its own card.',
      '',
      '## Keep a list of what I have to do',
      '',
      '- The board is for your tasks. What only I can do goes in ' + dir + '/pending.md: a task list (- [ ] and - [x]) grouped by topic, the most urgent first.',
      '- One short line per item. Put its steps right under it, in a collapsible section (::: details Steps), so the list stays clean.',
      '- Number the steps and make each one concrete: the direct link to the exact page where it is done (the link, not "go to the console"), what I have to bring back and where to leave it.',
      '- If it costs money, say how much and where it is paid.',
      '- If you are not sure of a menu path, say so and ask me for a screenshot. Do not invent it.',
      '- Never ask me for a secret in the chat: name the file or the screen where I enter it.',
      '- Tick an item as soon as you learn it is done, and move what got decided to a section Decided, with the date.',
      '- Your own tasks go on the board, or marked as yours. Do not mix them with mine.',
      '- Link the note from the README of the project, and at the end of every session tell me what is left for me.',
      '',
      'Do all three without being asked. Call get_guide once before you start, for the layout of each note, the full board rules and the format of pending.md. If this token cannot write, or I prefer local files, keep the same structure as local .md files, linked as "When you finish" says.',
    ], [
      '',
      '## How to write',
      '',
      'Write for a person who reads fast.',
      '',
      '- Open with a short summary, then use clear headings.',
      '- Tables to compare options. Task lists (- [ ] and - [x]) for pending and done work.',
      '- Collapsible sections for steps and long detail: a line ::: details Title, the content, and a line ::: to close. Callouts the same way, with ::: tip and ::: warning.',
      '- Mermaid diagrams for flows and architecture, in a ' + fence + 'mermaid code block.',
      '- Formulas in LaTeX: $inline$ or $$block$$.',
      '- Code blocks with the language name.',
      '- A short frontmatter (title, date, status) when it helps.',
      '- One note per topic, with tidy file and folder names, for example ' + (scope ? scope + '/decisions.md and ' + scope + '/log.md' : 'project/decisions.md and project/log.md. A top-level folder is usually a project') + '.',
      '- For a log, add dated entries with append_note. Do not rewrite the whole note.',
      '- Call read_note before you replace a note with write_note, so nothing that is there gets lost.',
      '- I can leave comments for you on a note. Call list_comments before editing, make each change, then close it with resolve_comment and a short reply.',
      '',
      '## Before you create a document',
      '',
      'If what I asked does not make it clear, ask me first:',
      '',
      '1. Should it go to my SharpMD cloud, or stay as a local .md file?',
      '2. Who should it be shared with?',
      '3. Does it need a public link, and should that link have a password?',
      '',
      o.share
        ? 'This token can share. share_note shares a note or a folder with another SharpMD account by email, to view or to edit. create_public_link returns a read-only link, with a password if I ask for one. Do either only when I ask, and tell me what you shared and with whom. unshare_note and revoke_public_link undo it.'
        : 'This token cannot share notes or create public links. If I want that, tell me to do it from the SharpMD app: open the note, then Share in its cloud menu.',
      '',
      '## When you finish',
      '',
      '- write_note, append_note and move_note return a link that opens the note in the SharpMD web app. Give me that link.',
      '- If the document stayed as a local .md file, give me a link that opens it in my browser with the SharpMD extension. Build it as ' + LMD.WEB_APP_URL + '#open= followed by the file:// address of the file, percent-encoded as a single value (what encodeURIComponent returns). On Windows: [notes.md](' + LMD.fileLink('file:///C:/Users/me/Desktop/notes.md') + '). On Mac and Linux: [notes.md](' + LMD.fileLink('file:///Users/me/Desktop/notes.md') + ').',
      '- Under that link, write the full path of the file as plain text, in case the link cannot be clicked.',
      '- Do the same every time you mention a local Markdown file: the link, then the path.',
    ]).join('\n') + '\n';
  }
  // Copia un texto largo al portapapeles; si el navegador no deja, con el método de antes.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) { /* sin permiso: se copia desde un campo */ }
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* no se pudo */ } t.remove();
  }

  let aiRedraw = null;
  async function aiPane(box, host) {
    await LMD.cloud.ready();
    const intro = hint(T('Una IA que hable MCP, como Claude, lee y escribe tus notas de la nube.'));
    const field = (label, value) => '<div class="lmd-field"><span>' + label + '</span><input type="text" readonly value="' + esc(value) + '"><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>';
    // El comando es largo: va en un cuadro de varios renglones, entero a la vista, con su botón de copiar.
    const longField = (label, value) => '<div class="lmd-field lmd-field-long"><span>' + label + '</span><textarea readonly rows="3" spellcheck="false" aria-label="' + label + '">' + esc(value) + '</textarea><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>';
    // Un token creado sin nombre lleva el de siempre ("IA" o "AI", según el idioma en que se creó): se muestra en el idioma de ahora.
    const tokenName = (n) => (/^(IA|AI)$/.test(n || '') ? T('IA') : n);
    const day = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short' });
    let a = null; let tokens = [];
    // El token recién creado sigue a la vista hasta salir de este panel o revocarlo: el servidor no lo vuelve a dar.
    let shown = null;
    // Qué hace la IA con el mensaje, y si lleva las instrucciones del espacio de proyecto. Va junto al botón que lo
    // copia: con un token recién creado, debajo de ese botón; si no, debajo de la lista, que tiene uno por token.
    let ws = true;
    const wsRow = () => hint(T('Con ese mensaje, tu IA documenta el proyecto y lleva un tablero de tareas en SharpMD.')) +
      '<label class="lmd-check lmd-ai-ws"><input type="checkbox" data-c="ws"' + (ws ? ' checked' : '') + '><span>' + T('Incluir las instrucciones del espacio de proyecto') + '</span></label>';
    const draw = async (fresh) => {
      if (fresh) shown = fresh;
      const made = shown; let list = []; let folders = [];
      try { list = await LMD.cloud.tokens(); } catch (e) { /* sin la lista, igual se puede crear uno */ }
      try { folders = foldersOf(await LMD.cloud.list(true)); } catch (e) { /* sin carpetas, el token alcanza todo */ }
      try { await LMD.vault.load(); } catch (e) { /* sin la lista de carpetas protegidas, el resto se dibuja igual */ }
      tokens = list;
      const kept = (box.querySelector('[data-c=folder]') || {}).value || '';
      // El permiso de compartir vuelve a quedar apagado después de crear un token.
      const keptShare = !fresh && !!(box.querySelector('[data-c=share]') || {}).checked;
      // En el plan gratis la IA trabaja sobre las mismas notas, con el mismo tope.
      box.innerHTML = intro + (a.limit ? hint(T('En el plan gratis tu IA trabaja con las {a} notas de tu nube.', { a: a.limit })) : '') + field('URL', a.mcp_url) +
        (made ? '<p class="lmd-ai-new">' + T('Copiá estos datos ahora: el token no se vuelve a mostrar.') + '</p>' + field('Token', made.token) +
          longField('Claude Code', 'claude mcp add --transport http sharpmd ' + made.mcp_url + ' --header "Authorization: Bearer ' + made.token + '"') +
          actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="brief">' + T('Copiar instrucciones para tu IA') + '</button>') + wsRow() : '') +
        '<h4>' + T('Tokens') + '</h4>' +
        (list.length ? '<ul class="lmd-tokens">' + list.map((t) => '<li><span>' + esc(tokenName(t.name)) + ' · ' + (t.scope ? T('Carpeta {a}', { a: esc(t.scope) + '/' }) : T('Todas las notas')) + ' · ' + T('creado el {a}', { a: day(t.created) }) + ' · ' + (t.used ? T('usado el {a}', { a: day(t.used) }) : T('sin usar')) + (t.share ? ' · ' + T('puede compartir') : '') + '</span><button type="button" class="lmd-tok-brief" data-brief="' + t.id + '" title="' + T('Copiar instrucciones para tu IA') + '">' + T('Instrucciones') + '</button><button type="button" data-rm="' + t.id + '">' + T('Revocar') + '</button></li>').join('') + '</ul>' + (made ? '' : wsRow()) : hint(T('Todavía no hay tokens.'))) +
        // Un token puede alcanzar toda la nube o una sola carpeta, que suele ser un proyecto.
        (folders.length ? '<label class="lmd-pick"><span>' + T('Carpeta') + '</span><select data-c="folder"><option value="">' + T('Todas las notas') + '</option>' +
          folders.map((d) => '<option value="' + esc(d) + '"' + (d === kept ? ' selected' : '') + '>' + esc(d) + '/</option>').join('') + '</select></label>' : '') +
        // Compartir hacia afuera es un permiso aparte, apagado si no se pide. Sin compartir en el plan, no se ofrece.
        (a.share === false ? '' : '<label class="lmd-check lmd-tok-share"><input type="checkbox" data-c="share"' + (keptShare ? ' checked' : '') + '><span>' + T('Puede compartir y crear enlaces') + '</span></label>') +
        actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="token">' + T('Crear un token') + '</button>') + LMD.vault.tokenNote() + '<p class="lmd-hint lmd-acct-msg" role="status" hidden></p>' +
        // Carpetas con contraseña: cuáles puede leer la IA ahora, hasta cuándo, y cómo abrirlas o cerrarlas.
        LMD.vault.aiSection();
    };
    // Cuando cambia el estado de una carpeta protegida, este panel se vuelve a dibujar si está a la vista.
    // No pisa un token recién creado (no se vuelve a mostrar) ni un campo que tiene el foco.
    aiRedraw = () => { const f = document.activeElement; if (a && box.isConnected && box.offsetParent && !box.querySelector('.lmd-ai-new') && !(f && box.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName))) draw(); };
    if (!LMD.cloud.enabled()) box.innerHTML = hint(T('La nube está apagada: sin ella no hay notas para conectar.'));
    else if (host.direct) box.innerHTML = intro;
    else if (!LMD.cloud.signedIn()) box.innerHTML = intro + hint(T('Entrá a tu cuenta para conectar una IA.')) + loginBtn(host);
    else {
      try {
        a = await fetchAccount(host);
        await draw();
      } catch (e) { if (!LMD.cloud.signedIn()) return aiPane(box, host); box.innerHTML = offline(); }
    }
    box.onclick = async (e) => {
      if (LMD.vault.aiClick(e) || goApp(host, e)) return;
      const rm = e.target.closest('[data-rm]'); const b = e.target.closest('[data-c]'); const brief = e.target.closest('[data-brief]');
      // done: el aviso cuenta algo que salió bien, y no va en el color de los errores.
      const say = (t, done) => { const m = box.querySelector('.lmd-acct-msg'); if (m) { m.hidden = false; m.textContent = t; m.classList.toggle('lmd-acct-done', !!done); } };
      try {
        if (rm) { if (await LMD.dialog.confirm({ title: T('¿Revocar este token?'), text: T('La IA que lo usa deja de entrar.'), ok: T('Revocar'), danger: true })) { await LMD.cloud.revoke(rm.dataset.rm); if (shown && String(shown.id) === rm.dataset.rm) shown = null; await draw(); } }
        else if (brief || (b && b.dataset.c === 'brief')) {
          // Con el token a la vista el mensaje sale listo; de uno viejo sale con el marcador, y se dice.
          const t = brief ? tokens.find((x) => String(x.id) === brief.dataset.brief) : shown; if (!t) return;
          const live = shown && String(shown.id) === String(t.id);
          await copyText(aiBrief({ url: a.mcp_url, token: live ? shown.token : '', scope: t.scope, share: t.share, workspace: ws }));
          say(live ? T('Instrucciones copiadas. Pegalas en tu IA.') : T('Instrucciones copiadas. Reemplazá {a} por tu token, que ya no se muestra.', { a: AI_TOKEN_MARK }), true);
        }
        else if (!b) return;
        else if (b.dataset.c === 'ws') ws = !!b.checked;
        else if (b.dataset.c === 'login') goLogin(host);
        else if (b.dataset.c === 'token') await draw(await LMD.cloud.newToken(T('IA'), (box.querySelector('[data-c=folder]') || {}).value || '', !!(box.querySelector('[data-c=share]') || {}).checked));
        else if (b.dataset.c === 'copy') {
          const input = b.parentNode.querySelector('input, textarea'); input.select();
          try { await navigator.clipboard.writeText(input.value); } catch (err) { document.execCommand('copy'); }
          b.textContent = T('Copiado'); setTimeout(() => { b.textContent = T('Copiar'); }, 1500);
        }
      } catch (err) { say(T(err.code === 'offline' ? 'No hay conexión con el servidor.' : err.code === 'mcp_needs_plan' ? 'Conectar una IA es parte del plan pago.' : err.code === 'too_many' ? 'Llegaste al tope de tokens. Revocá uno para crear otro.' : 'No se pudo completar. Probá de nuevo.')); }
    };
    box.onfocusin = (e) => { if (e.target.matches('input[readonly], textarea[readonly]')) e.target.select(); };
  }

  // Volver del pago: Paddle avisa al servidor por su cuenta, así que se consulta la cuenta cada pocos
  // segundos hasta que el plan cambia. Pasado el tope se dice, sin dar el pago por perdido.
  const PAY = { every: 3000, max: 120000 };
  let wait = null; let planBox = null; let planHost = null; let planTurn = 0;
  let planWhy = ''; // por qué se abrió Plan (por ejemplo, al querer comentar en el plan gratis); lo pone openPanel
  function awaitPaid() {
    if (wait) clearTimeout(wait.timer);
    // Qué se salió a pagar lo anota el enlace de pago en la pestaña: el plan individual, o el de equipo.
    let team = false; try { team = sessionStorage.getItem('lmd-pay') === 'team'; } catch (e) { /* sin sesión: se espera el plan pago */ }
    const mine = wait = { state: 'wait', until: Date.now() + PAY.max, timer: null, team };
    const paid = (a) => (team ? !!(a.team && a.team.mine && a.team.mine.active && a.team.mine.role === 'admin') : a.plan === 'pro');
    const redraw = () => { if (planBox && planBox.isConnected) planPane(planBox, planHost); };
    const clean = () => { if (location.hash === '#lmd-paid') window.history.replaceState(null, '', location.href.split('#')[0]); };
    const tick = async () => {
      if (wait !== mine) return;
      if (!LMD.cloud.signedIn()) { wait = null; clean(); redraw(); return; }
      let a = null;
      try { a = await LMD.cloud.account(); } catch (e) { /* se reintenta */ }
      if (wait !== mine) return;
      if (a && paid(a)) { account = a; asked = true; adopt(a, true); try { sessionStorage.removeItem('lmd-pay'); } catch (e) { /* sin sesión */ } mine.state = 'done'; mine.at = Date.now(); clean(); paint(); LMD.home.account(); redraw(); return; }
      if (Date.now() >= mine.until) { mine.state = 'late'; mine.at = Date.now(); clean(); redraw(); return; }
      mine.timer = setTimeout(tick, PAY.every);
    };
    redraw();
    LMD.cloud.ready().then(tick);
  }

  async function planPane(box, host) {
    planBox = box; planHost = host;
    const turn = ++planTurn;
    if (wait && wait.at && Date.now() - wait.at > 60000) wait = null; // el aviso del pago no queda para siempre
    await LMD.cloud.ready();
    let a = null; let note = '';
    if (!LMD.cloud.enabled()) note = hint(T('La nube está apagada: los planes son de la cuenta de la nube.'));
    else if (host.direct) note = ''; // acá lo principal es suscribirse: esos botones van en la tarjeta del plan pago
    else if (!LMD.cloud.signedIn()) note = hint(T('Entrá a tu cuenta para pasar al plan pago.')) + loginBtn(host);
    else { try { a = await fetchAccount(host); } catch (e) { note = offline(); } }
    if (turn !== planTurn) return;
    const pro = !!a && a.plan === 'pro'; const pay = (a && a.checkout) || {};
    // own: el plan pago lo paga esta cuenta. Un miembro de un equipo lo tiene por el equipo, sin pagarlo.
    const own = !!a && (a.own_plan || a.plan) === 'pro';
    if (planWhy && !pro) note = '<p class="lmd-plan-why" role="status">' + esc(planWhy) + '</p>' + note;
    // El pago se hace en esta misma pestaña: el enlace lleva en back la dirección a la que volver.
    const payUrl = (url) => url + (url.includes('?') ? '&' : '?') + 'back=' + encodeURIComponent(host.back);
    // plain: el botón sin relleno, para la opción que no es la principal (el pago mensual, al lado del anual).
    const btn = (url, label, kind, plain) => (url ? '<a class="lmd-btn' + (plain ? '' : ' lmd-btn-fill') + '" data-pay="' + (kind || '') + '" href="' + esc(payUrl(url)) + '">' + label + '</a>' : '<button type="button" class="lmd-btn" disabled>' + label + ' · ' + T('pronto') + '</button>');
    const YEAR = 'USD 40 / ' + T('año'); const MONTH = 'USD 4 / ' + T('mes');
    // Sobre un archivo abierto directo se paga en la app: los mismos botones la abren en una pestaña nueva, ya en los planes.
    const appBtn = (label, plain) => '<button type="button" class="lmd-btn' + (plain ? '' : ' lmd-btn-fill') + '" data-c="app" data-at="' + DIRECT_AT.plan + '">' + label + '</button>';
    const buy = core.APP ? btn : (url, label, kind, plain) => appBtn(label, plain);
    const teamCol = LMD.team.column(a, buy);
    const state = wait && (wait.state !== 'done' || pro) ? wait.state : '';
    // Quien tiene el plan por un equipo que paga otra persona no ve planes, precios ni botones de compra: ve su
    // equipo y su papel. El cobro es de quien paga.
    if (a && a.billing === false) {
      box.innerHTML = note + LMD.team.guestCard(a) + LMD.team.section(a);
      LMD.team.mount(box, a);
      box.onclick = (e) => { if (LMD.team.owns(e, box)) LMD.team.click(e, box, a, () => planPane(box, host)); };
      box.onchange = (e) => LMD.team.change(e, box, a, () => planPane(box, host));
      return;
    }
    box.onchange = (e) => LMD.team.change(e, box, a, () => planPane(box, host));
    box.innerHTML =
      (state ? '<p class="lmd-paywait lmd-paywait-' + state + '" role="status"><span>' + T({ wait: 'Esperando la confirmación del pago…', late: 'La confirmación del pago todavía no llegó. Volvé a revisar en unos minutos.', done: wait.team ? 'Pago confirmado. Tu equipo está listo.' : 'Pago confirmado. Ya tenés el plan pago.' }[state]) + '</span>' +
        (state === 'late' ? '<button type="button" class="lmd-link" data-c="recheck">' + T('Revisar ahora') + '</button>' : '') + '</p>' : '') + note +
      '<div class="lmd-plans' + (teamCol ? ' lmd-plans-3' : '') + '">' +
        '<div class="lmd-plan' + (a && !pro ? ' lmd-plan-on' : '') + '"><h4>' + T('Gratis') + '</h4><ul><li>' + T('Todo el editor') + '</li><li>' + T('Hasta 10 notas en la nube') + '</li><li>' + T('Notas en el navegador y en tu disco, sin límite') + '</li><li>' + T('Carpetas protegidas') + '</li><li>' + T('Conectar una IA por MCP') + '</li><li>' + T('Los 12 temas') + '</li></ul>' +
          (a && !pro ? '<p class="lmd-hint">' + T('Es tu plan actual.') + '</p>' : '') + '</div>' +
        '<div class="lmd-plan' + (own ? ' lmd-plan-on' : '') + '"><h4>' + T('Pago') + ' <small>' + YEAR + '</small></h4><ul><li>' + T('Notas en la nube sin límite') + '</li><li>' + T('Carpetas protegidas') + '</li><li>' + T('Compartir y editar entre varios') + '</li><li>' + T('Sesiones en vivo: quien invitás entra sin cuenta') + '</li><li>' + T('API y automatizaciones') + '</li><li>' + T('Historial de versiones de 30 días') + '</li><li>' + T('Colores, tipografía y CSS propio') + '</li></ul>' +
          (own ? '<p class="lmd-hint">' + T('Es tu plan actual.') + (a.manage ? ' <a href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Administrar la suscripción') + '</a>' : '') + '</p>'
            : pro ? '<p class="lmd-hint">' + T('Lo tenés con el equipo.') + '</p>'
            : a ? '<div class="lmd-plan-buy">' + buy(pay.yearly, YEAR) + buy(pay.monthly, MONTH, '', true) + '</div>'
            : host.direct && LMD.cloud.enabled() ? '<div class="lmd-plan-buy">' + appBtn(YEAR) + appBtn(MONTH, true) + '</div>' : '') + '</div>' + teamCol + '</div>' + LMD.team.section(a);
    LMD.team.mount(box, a);
    box.onclick = async (e) => {
      // Lo del equipo se atiende aparte. Se decide sin esperar nada: el enlace de pago, más abajo, frena su navegación en este mismo turno.
      if (LMD.team.owns(e, box)) { LMD.team.click(e, box, a, () => planPane(box, host)); return; }
      const b = e.target.closest('[data-c]'); const link = e.target.closest('[data-pay]');
      if (b && b.dataset.c === 'login') goLogin(host);
      else if (goApp(host, e)) return;
      else if (b && b.dataset.c === 'recheck') awaitPaid();
      // Antes de salir a pagar se guarda lo pendiente.
      else if (link) { e.preventDefault(); try { if (link.dataset.pay === 'team') sessionStorage.setItem('lmd-pay', 'team'); else sessionStorage.removeItem('lmd-pay'); } catch (err) { /* sin sesión */ } await host.leave(); location.href = link.href; }
    };
  }
  // shown: el último panel de la cuenta que se dibujó, para volver a dibujarlo si la sesión cambia por fuera.
  let shown = null;
  const pane = (kind, fn) => (box, host) => { shown = { kind, box, host }; return fn(box, host); };
  const panes = { cloud: pane('cloud', cloudPane), ai: pane('ai', aiPane), plan: pane('plan', planPane) };

  // Desde el inicio no hay Ajustes: el mismo panel se abre en una ventana.
  function dialog(kind, host) {
    const box = el('div', { class: 'lmd-ask' });
    const title = T(kind === 'ai' ? 'Conectar una IA' : 'Plan');
    box.innerHTML = '<div class="lmd-ask-card lmd-acct-card" role="dialog" aria-label="' + title + '"><h3>' + title + '</h3><div class="lmd-acct"></div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-d="close" data-esc>' + T('Cerrar') + '</button></div></div>';
    document.body.appendChild(box);
    const shut = () => { box.remove(); if (host.closed) host.closed(); };
    panes[kind](box.querySelector('.lmd-acct'), Object.assign({}, host, { tab: (t) => { box.remove(); dialog(t, host); }, close: shut }));
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-d=close]')) shut(); });
  }

  // ---------- Enviar comentarios ----------
  // Un texto y, sin sesión, un correo opcional para la respuesta. Del contexto viajan la versión, si es web o
  // extensión, el navegador y el idioma: nunca el contenido de una nota ni la ruta de un archivo.
  const MAILTO = 'hello@sharpmd.app';
  async function feedback() {
    await LMD.cloud.ready();
    const box = el('div', { class: 'lmd-ask' });
    const mailto = (text) => '<p>' + T('Escribinos a {a}.', { a: '<a href="mailto:' + MAILTO + '?subject=' + encodeURIComponent('SharpMD feedback') + (text ? '&body=' + encodeURIComponent(text) : '') + '">' + MAILTO + '</a>' }) + '</p>';
    const close = '<button type="button" class="lmd-btn" data-fb="close" data-esc>' + T('Cerrar') + '</button>';
    const card = (inner) => { box.innerHTML = '<div class="lmd-ask-card lmd-fb" role="dialog" aria-label="' + T('Enviar comentarios') + '"><h3>' + T('Enviar comentarios') + '</h3>' + inner + '</div>'; };
    // Con la nube apagada, o sobre un archivo abierto directo en el navegador, no hay servidor al que mandar: queda el correo.
    if (!LMD.cloud.enabled() || !LMD.cloud.reach()) card(mailto('') + '<div class="lmd-ask-actions">' + close + '</div>');
    else card('<textarea data-fb="text" maxlength="4000" placeholder="' + T('Qué pasó, o qué te gustaría que cambie') + '"></textarea>' +
      (LMD.cloud.signedIn() ? '' : '<input type="email" data-fb="email" placeholder="' + T('tu correo, si querés respuesta (opcional)') + '">') +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-fb="close" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-fb="send">' + T('Enviar') + '</button></div>');
    document.body.appendChild(box);
    const q = (n) => box.querySelector('[data-fb=' + n + ']');
    if (q('text')) q('text').focus();
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-fb=close]')) { box.remove(); return; }
      if (!e.target.closest('[data-fb=send]')) return;
      const err = box.querySelector('.lmd-img-err'); const fail = (t) => { err.hidden = false; err.textContent = t; };
      const text = q('text').value.trim(); const mail = q('email') ? q('email').value.trim() : '';
      if (text.length < 5) { fail(T('Escribí al menos unas palabras.')); q('text').focus(); return; }
      if (mail && !LMD.kit.validEmail(mail)) { fail(T('Ese correo no parece válido.')); q('email').focus(); return; }
      q('send').disabled = true; err.hidden = true;
      try {
        await LMD.cloud.feedback(text, mail, { version: LMD.VERSION, where: window.__MDT_WEB ? 'web' : 'extension', browser: navigator.userAgent, lang: LMD.lang() });
        card('<p class="lmd-fb-ok" role="status">' + ICON.check + '<span>' + T('Enviado') + '</span></p>');
        setTimeout(() => box.remove(), 1400);
      } catch (ex) {
        if (ex.code === 'too_many') { fail(T('Llegaste al tope de envíos por ahora. Probá más tarde.')); q('send').disabled = false; }
        else if (ex.code === 'bad_email') { fail(T('Ese correo no parece válido.')); q('send').disabled = false; }
        // Sin conexión, o un servidor que no recibe comentarios: queda el correo, con lo escrito ya cargado.
        else card('<p>' + T(ex.code === 'offline' ? 'No hay conexión con el servidor.' : 'Desde acá no se pudo enviar.') + '</p>' + mailto(text) + '<div class="lmd-ask-actions">' + close + '</div>');
      }
    });
  }

  // ---------- Denunciar una nota ajena ----------
  // Para lo que escribió otra persona: una nota abierta por su enlace público, una que compartió otra cuenta, o la de
  // una sesión en vivo a la que se entró como invitado. Sale por el mismo camino que los comentarios, marcado como
  // denuncia, con qué nota es y, si se escribió, el motivo. El contenido de la nota no viaja.
  function reportRef() {
    if (!core || !core.APP || core.noDoc) return null;
    const g = LMD.cloud.guest();
    if (g) return { kind: 'live', note: g.who + ' ' + (g.note || ''), owner: g.by || '' };
    const r = core.appRoot; if (!r) return null;
    if (r.kind === 'pub') return { kind: 'link', note: new URLSearchParams(location.search).get('f') || '', owner: '' };
    if (r.kind !== 'cloud') return null;
    const s = LMD.cloud.split(core.cloudPath); const t = LMD.cloud.teamNow();
    return s.owner && !(t && String(t.space) === s.owner) ? { kind: 'shared', note: s.path, owner: s.owner } : null;
  }
  // Con given se denuncia otra cosa: un aporte de la galería de la comunidad ({ kind: 'gallery', note, owner }).
  function report(given) {
    const ref = given && given.kind === 'gallery' ? given : reportRef(); if (!ref) return;
    const gal = ref.kind === 'gallery';
    const title = T(gal ? 'Denunciar este aporte' : 'Denunciar esta nota');
    const box = el('div', { class: 'lmd-ask' });
    const close = '<button type="button" class="lmd-btn" data-rp="close" data-esc>' + T('Cerrar') + '</button>';
    const mailto = (text) => '<p>' + T('Escribinos a {a}.', { a: '<a href="mailto:' + MAILTO + '?subject=' + encodeURIComponent('SharpMD report') + '&body=' + encodeURIComponent('Note: ' + ref.note + (ref.owner ? ' (' + ref.owner + ')' : '') + '\n\n' + (text || '')) + '">' + MAILTO + '</a>' }) + '</p>';
    const card = (inner) => { box.innerHTML = '<div class="lmd-ask-card lmd-fb lmd-report-card" role="dialog" aria-modal="true" aria-label="' + title + '"><h3>' + title + '</h3>' + inner + '</div>'; };
    card('<p class="lmd-hint">' + T(gal ? 'Avisanos si este aporte tiene algo que no debería estar acá.' : 'Avisanos si esta nota tiene algo que no debería estar acá. Se envía qué nota es, no su contenido.') + '</p>' +
      '<textarea data-rp="text" maxlength="2000" placeholder="' + T('Motivo (opcional)') + '" aria-label="' + T('Motivo (opcional)') + '"></textarea>' +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-rp="close" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-rp="send">' + T('Enviar denuncia') + '</button></div>');
    document.body.appendChild(box);
    const q = (n) => box.querySelector('[data-rp=' + n + ']');
    q('text').focus();
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-rp=close]')) { box.remove(); return; }
      if (!e.target.closest('[data-rp=send]')) return;
      const err = box.querySelector('.lmd-img-err'); const text = q('text').value.trim();
      q('send').disabled = true; err.hidden = true;
      try {
        await LMD.cloud.report(text, ref, { version: LMD.VERSION, where: window.__MDT_WEB ? 'web' : 'extension', browser: navigator.userAgent, lang: LMD.lang() });
        card('<p class="lmd-fb-ok" role="status">' + ICON.check + '<span>' + T('Enviado') + '</span></p>');
        setTimeout(() => box.remove(), 1400);
      } catch (ex) {
        if (ex.code === 'too_many') { err.hidden = false; err.textContent = T('Llegaste al tope de envíos por ahora. Probá más tarde.'); q('send').disabled = false; }
        // Sin conexión, o un servidor que no recibe comentarios: queda el correo, con la nota ya indicada.
        else card('<p>' + T(ex.code === 'offline' ? 'No hay conexión con el servidor.' : 'Desde acá no se pudo enviar.') + '</p>' + mailto(text) + '<div class="lmd-ask-actions">' + close + '</div>');
      }
    });
  }

  const mine = () => LMD.cloud.split(core.cloudPath);

  // Compartir: con otra cuenta (ver o editar), o con un enlace público de solo lectura, con contraseña opcional.
  async function share() {
    // full es la ruta como la lleva la app (la de una nota del equipo empieza con ~espacio/); path, la que conoce
    // el servidor dentro de esa cuenta o de ese espacio. En el equipo, cada mitad se ofrece si la política lo permite.
    const full = core.cloudPath; const tm = LMD.cloud.isTeam(full); const pre = tm ? full.slice(0, full.indexOf('/') + 1) : '';
    const path = full.slice(pre.length); const folder = path.indexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    const people = !tm || LMD.cloud.teamCan('share'); const links = !tm || LMD.cloud.teamCan('links');
    const box = el('div', { class: 'lmd-ask' });
    box.innerHTML = '<div class="lmd-ask-card lmd-share" role="dialog" aria-label="' + T('Compartir') + '"><h3>' + T('Compartir') + '</h3>' +
      (tm ? '<p class="lmd-hint lmd-share-team">' + T('Esta nota es del equipo. Acá la compartís con alguien de afuera.') + '</p>' : '') +
      (people ? '<h4>' + T('Con otra cuenta') + '</h4>' +
      '<div class="lmd-share-row"><input type="email" data-sh="email" placeholder="' + T('correo de la otra persona') + '">' +
        '<select data-sh="role"><option value="edit">' + T('Puede editar') + '</option><option value="view">' + T('Solo ver') + '</option></select>' +
        '<button type="button" class="lmd-btn lmd-btn-fill" data-sh="invite">' + T('Compartir') + '</button></div>' +
      (folder ? '<label class="lmd-check"><input type="checkbox" data-sh="folder"><span>' + T('Compartir toda la carpeta "{a}"', { a: esc(folder) }) + '</span></label>' : '') : '') +
      '<ul data-sh="people"' + (people ? '' : ' hidden') + '></ul>' +
      (links ? '<h4>' + T('Con un enlace de solo lectura') + '</h4>' +
      '<div class="lmd-share-row"><input type="text" data-sh="pass" placeholder="' + T('contraseña (opcional)') + '"><button type="button" class="lmd-btn" data-sh="link">' + T('Crear enlace') + '</button></div>' : '') +
      '<ul data-sh="links"' + (links ? '' : ' hidden') + '></ul>' +
      (tm && !(people && links) ? '<p class="lmd-hint lmd-managed">' + T('Lo administra quien administra el equipo') + '</p>' : '') +
      '<p class="lmd-hint" data-sh="linknote" hidden>' + T('Copiá el enlace ahora: no se vuelve a mostrar.') + '</p>' +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-sh="close" data-esc>' + T('Cerrar') + '</button></div></div>';
    document.body.appendChild(box);
    const q = (n) => box.querySelector('[data-sh=' + n + ']'); const err = box.querySelector('.lmd-img-err');
    const fail = (e) => { err.hidden = false; err.textContent = T({ bad_email: 'Ese correo no parece válido.', own_email: 'Ese es tu propio correo.', offline: 'No hay conexión con el servidor.', share_needs_plan: 'Compartir es parte del plan pago.', already_member: 'Esa persona ya está en el equipo.', team_policy: 'Lo administra quien administra el equipo', read_only: 'En este equipo solo podés leer.', too_many: 'Llegaste al tope de lo que se puede compartir. Quitá algo para sumar más.', not_found: 'Esta nota ya no está en la nube.' }[e && e.code] || 'No se pudo completar. Probá de nuevo.'); };
    const made = {}; // enlaces creados en esta ventana: el token solo se conoce al crearlo
    const draw = async () => {
      try {
        const all = await LMD.cloud.sharesAll(full);
        const people = all.people.filter((s) => s.path === path || (s.kind === 'folder' && path.startsWith(s.path + '/')));
        q('people').innerHTML = people.map((s) => '<li><span>' + esc(s.email) + ' · ' + T(s.role === 'edit' ? 'Puede editar' : 'Solo ver') + (s.kind === 'folder' ? ' · ' + esc(s.path) + '/' : '') + '</span><button type="button" data-rm="s' + s.id + '">' + T('Quitar') + '</button></li>').join('');
        const fresh = all.links.some((l) => l.path === path && made[l.id]);
        q('linknote').hidden = !fresh;
        q('links').innerHTML = all.links.filter((l) => l.path === path).map((l) => '<li' + (made[l.id] ? ' class="lmd-share-new"' : '') + '>' + (made[l.id] ? '<input type="text" readonly aria-label="' + T('Enlace') + '" value="' + esc(made[l.id]) + '"><button type="button" class="lmd-link" data-sh="copy">' + T('Copiar') + '</button>' : '<span>' + T(l.protected ? 'Enlace con contraseña' : 'Enlace abierto') + '</span>') + '<button type="button" data-rm="l' + l.id + '">' + T('Quitar') + '</button></li>').join('');
      } catch (e) { fail(e); }
    };
    draw();
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-sh=close]')) { box.remove(); return; }
      err.hidden = true;
      try {
        const copy = e.target.closest('[data-sh=copy]');
        if (copy) {
          const input = copy.parentNode.querySelector('input'); input.select();
          try { await navigator.clipboard.writeText(input.value); } catch (ex) { document.execCommand('copy'); }
          copy.textContent = T('Copiado'); setTimeout(() => { if (copy.isConnected) copy.textContent = T('Copiar'); }, 1500);
          return;
        }
        const rm = e.target.closest('[data-rm]');
        if (rm) { if (rm.dataset.rm[0] === 's') await LMD.cloud.unshare(rm.dataset.rm.slice(1), full); else await LMD.cloud.unlink(rm.dataset.rm.slice(1), full); return draw(); }
        if (e.target.closest('[data-sh=invite]')) {
          const whole = q('folder') && q('folder').checked;
          await LMD.cloud.share(pre + (whole ? folder : path), q('email').value.trim(), q('role').value, whole ? 'folder' : 'note');
          q('email').value = ''; return draw();
        }
        if (e.target.closest('[data-sh=link]')) {
          const r = await LMD.cloud.link(full, q('pass').value);
          const all = await LMD.cloud.shares(full);
          const newest = all.links.sort((a, b) => b.id - a.id)[0];
          if (newest) made[newest.id] = LMD.WEB_APP_URL + '?f=' + encodeURIComponent('pub/' + r.token);
          q('pass').value = ''; return draw();
        }
      } catch (ex) { fail(ex); }
    });
    box.addEventListener('focusin', (e) => { if (e.target.matches('input[readonly]')) e.target.select(); });
  }

  async function history() {
    let list = [];
    try { list = await LMD.cloud.versions(core.cloudPath); } catch (e) { core.flash(T('No hay conexión con el servidor.'), 'error'); return; }
    const box = el('div', { class: 'lmd-ask' });
    const fmt = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'medium', timeStyle: 'short' });
    const weight = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB');
    box.innerHTML = '<div class="lmd-ask-card lmd-hist" role="dialog" aria-label="' + T('Historial de versiones') + '"><h3>' + T('Historial de versiones') + '</h3>' +
      (list.length ? '<div class="lmd-hist-body"><ul>' + list.map((v) => '<li><button type="button" data-v="' + v.id + '">' + esc(fmt(v.saved)) + '<small>' + weight(v.size) + (v.edited && LMD.live.who(v.edited) ? ' · ' + esc(LMD.live.who(v.edited)) : '') + '</small></button></li>').join('') + '</ul><pre></pre></div>'
        : '<p>' + T('Todavía no hay versiones anteriores de esta nota.') + '</p>') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-h="no" data-esc>' + T('Cerrar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-h="ok" disabled>' + T('Restaurar esta versión') + '</button></div></div>';
    document.body.appendChild(box);
    let chosen = null;
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-h=no]')) { box.remove(); return; }
      const v = e.target.closest('[data-v]');
      if (v) {
        try { const r = await LMD.cloud.version(v.dataset.v, core.cloudPath); chosen = r.text; box.querySelector('pre').textContent = r.text; box.querySelector('[data-h=ok]').disabled = false; box.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('lmd-on', b === v)); }
        catch (err) { core.flash(T('No hay conexión con el servidor.'), 'error'); }
        return;
      }
      if (e.target.closest('[data-h=ok]') && chosen != null) { box.remove(); core.setRaw(chosen); core.flash(T('Versión restaurada. Ctrl+Z la deshace')); }
    });
  }

  function click(btn) {
    if (isCloud()) { openMenu(btn); return; }
    if (LMD.cloud.signedIn()) upload(); else if (LMD.cloud.reach()) core.openPanel('cloud'); else core.openApp('');
  }

  // La sesión cambió por fuera de esta página (otra pestaña, o el otro lado del puente entre la web y la extensión):
  // lo de la cuenta se vuelve a leer y a dibujar. Si se salió con una nota de la nube abierta, la nota se cierra.
  async function sessionChanged(e) {
    if (!core) return;
    const open = core.APP && isCloud(); const d = (e && e.detail) || {};
    account = null; asked = false; paint(); LMD.home.account();
    // Con cambios sin guardar la nota no se cierra sola: lo escrito sigue a la vista, y al guardar se verá que no hay sesión.
    if (open && !core.dirty && (!d.signedIn || d.was !== d.now)) await core.close({ discard: true, tree: true }); else if (core.APP) core.reloadTree();
    if (shown && shown.box.isConnected && shown.box.offsetParent) panes[shown.kind](shown.box, shown.host);
  }
  // Se salió de la cuenta del otro lado del puente: acá se sale igual, como con el botón Salir.
  // Lo pendiente de la nota abierta se sube antes, mientras la sesión todavía sirve.
  const dropSession = async () => { if (LMD.cloud.signedIn() && !LMD.cloud.guest()) { await signOut({ leave: () => (core.dirty ? core.save(false) : Promise.resolve(true)) });if (shown && shown.box.isConnected && shown.box.offsetParent) panes[shown.kind](shown.box, shown.host); } };

  function init(c) {
    core = c;
    window.addEventListener('lmd-session-changed', sessionChanged);
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    // El servidor dejó de mostrar el espacio del equipo: la cuenta se vuelve a leer y el explorador se redibuja sin él.
    LMD.cloud.onTeamLost(() => { account = null; asked = false; if (core.APP) core.reloadTree(); loadAccount(); });
    // Una nota de un sitio con "publicar al guardar" se guardó: su página se vuelve a subir (publish.js).
    core.hooks.saved.push((path) => {
      const pg = pagesOf(account); if (!pg) return;
      const s = (pg.sites || []).find((x) => x.auto && x.live && !x.suspended && !x.lapsed && x.can && path.startsWith((x.o ? '~' + x.o + '/' : '') + x.folder + '/'));
      if (s) core.ensure('publish').then((ok) => { if (ok) LMD.publish.saved(core, s, path); });
    });
    LMD.cloud.ready().then(paint);
  }

  // Entrar a la cuenta desde cualquier lado: Ajustes en Nube, con el correo ya pedido.
  const login = () => LMD.home.login(); // el formulario de entrar, en el centro

  // Vuelve a leer la cuenta después de un cambio en el equipo.
  const reload = async () => { account = await LMD.cloud.account(); asked = true; adopt(account, true); paint(); return account; };

  LMD.sync = { init, paint, click, panes, reload, dialog, feedback, report, reportRef, awaitPaid, openCloud, quota, PAY, login, me, foldersOf, signOut, dropSession, aiBrief, askName: () => { wantName = true; }, account: () => account, why: (text) => { planWhy = text || ''; },
    repaintAi: () => { if (aiRedraw) aiRedraw(); if (secRedraw) secRedraw(); }, security, canPublish, publish, siteState };
})();
