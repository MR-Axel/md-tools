// Ícono de la nube en la barra: dice si la nota está sincronizada, guardando, sin conexión o fuera de la nube.
// Desde ahí se sube una nota a la nube y se abre el historial de versiones (plan pago).
// También viven acá los paneles de la cuenta (Nube, IA y Plan), la espera del pago y el envío de comentarios.
(function () {
  'use strict';

  const { el, ICON, esc } = LMD.kit;
  const T = LMD.t;
  let core = null; let account = null; let asked = false;

  async function loadAccount() {
    // Sobre un archivo abierto directo en el navegador no se consulta: ahí el servidor no responde (CORS).
    if (asked || !LMD.cloud.signedIn() || !core.APP) return;
    asked = true;
    // Si falla no se repinta: repintar volvería a consultar y quedaría pidiendo en bucle mientras no haya conexión.
    try { account = await LMD.cloud.account(); } catch (e) { account = null; asked = false; return; }
    paint();
  }

  const isCloud = () => !!core.appRoot && core.appRoot.kind === 'cloud';

  function paint() {
    const btn = core && core.ui.sync; if (!btn) return;
    btn.hidden = !LMD.cloud.enabled();
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
    btn.innerHTML = icon + (others.length ? '<b class="lmd-sync-n">' + (others.length + 1) + '</b>' : '');
    btn.title = title + (others.length ? ' · ' + T('También acá: {a}', { a: others.join(', ') }) : '');
    loadAccount();
  }

  const cloudHref = (path) => '?f=' + encodeURIComponent('cloud/' + path.split('/').map(encodeURIComponent).join('/'));
  // Abre una nota de la nube: en la app, en el lugar; sobre un archivo abierto directo, en la app.
  const openNote = (path, opt) => (core.APP ? core.open(core.urlOf(path), opt) : core.openApp(cloudHref(path) + (opt && opt.edit ? '&edit=1' : '')));

  async function upload() {
    if (!window.confirm(T('¿Subir "{a}" a la nube? Queda una copia sincronizada; el archivo de acá no se toca.', { a: core.docName }))) return;
    try {
      const taken = new Set((await LMD.cloud.list(true)).map((n) => n.path));
      const dot = core.docName.lastIndexOf('.'); const stem = dot > 0 ? core.docName.slice(0, dot) : core.docName; const ext = dot > 0 ? core.docName.slice(dot) : '.md';
      let path = stem + ext;
      for (let n = 2; n < 50 && taken.has(path); n++) path = stem + '-' + n + ext;
      await LMD.cloud.write(path, core.raw);
      openNote(path, { tree: true });
    } catch (e) {
      core.flash(T(e.code === 'note_limit' ? 'Llegaste al límite de notas del plan gratis.' : e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo subir la nota.'), 'error');
    }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function openMenu(btn) {
    closeMenu();
    const pro = !!account && account.plan === 'pro';
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' +
      (core.readOnly ? '' : '<button type="button" role="menuitem" data-s="share"' + (account && account.share && !mine().owner ? '' : ' class="lmd-locked"') + '>' + ICON.link + '<span>' + T('Compartir') + '</span></button>') +
      '<button type="button" role="menuitem" data-s="history"' + (pro ? '' : ' class="lmd-locked"') + '>' + ICON.reload + '<span>' + T('Historial de versiones') + '</span></button>' +
      '<button type="button" role="menuitem" data-s="ai"' + (account && account.mcp ? '' : ' class="lmd-locked"') + '>' + ICON.link + '<span>' + T('Conectar una IA') + '</span></button>' +
      (account ? '<p class="lmd-menu-label">' + esc(account.email) + ' · ' + T(pro ? 'Plan pago' : 'Plan gratis') + '</p>' : '') + '</div>';
    document.body.appendChild(menu);
    const box = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.left)) + 'px';
    menu.style.top = (box.bottom + 8) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      closeMenu();
      // Conectar una IA vive en Ajustes: ahí se crea el token o, en el plan gratis, se ve qué hace falta.
      if (b.dataset.s === 'ai') { core.openPanel('ai'); return; }
      if (b.classList.contains('lmd-locked')) {
        core.flash(T(mine().owner ? 'Solo quien creó la nota puede hacer eso.' : b.dataset.s === 'history' ? 'El historial de versiones es parte del plan pago.' : 'Compartir es parte del plan pago.'), 'warn');
        return;
      }
      if (b.dataset.s === 'history') history(); else share();
    });
  }

  // ---------- Paneles de la cuenta: Nube, IA y Plan ----------
  // Se dibujan dentro de Ajustes y, desde el inicio, en una ventana propia. host dice cómo moverse desde
  // donde están: { tab(nombre), login(), leave(), close(), unlocked(cuenta), back, appUrl, direct }.
  const hint = (text) => '<p class="lmd-hint">' + text + '</p>';
  const acctRow = (label, value) => '<div class="lmd-acct-row"><span>' + label + '</span><b title="' + value + '">' + value + '</b></div>';
  const actions = (html) => '<div class="lmd-acct-actions">' + html + '</div>';
  const loginBtn = (host) => (host.login ? actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Crear cuenta o entrar') + '</button>') : '');
  // Se entra en Ajustes → Nube, ahí mismo. Desde IA o Plan el botón lleva a esa pestaña con el correo ya pedido.
  let wantLogin = false;
  const goLogin = (host) => { if (host.direct || !host.tab) host.login(); else { wantLogin = true; host.tab('cloud'); } };
  const quota = (a) => (a.limit ? T('{n} de {m}', { n: a.notes, m: a.limit }) : T('{n}, sin límite', { n: a.notes }));
  const fetchAccount = async (host) => { account = await LMD.cloud.account(); asked = true; if (host && host.unlocked) host.unlocked(account); return account; };
  const offline = () => hint(T('No hay conexión con el servidor.'));
  // Un .md abierto directo en el navegador no puede hablar con el servidor: la cuenta está en la app.
  const direct = (host) => (host.direct ? hint(T('La cuenta se maneja desde la app de SharpMD.')) + actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Abrir SharpMD') + '</button>') : '');

  // Abre la carpeta Nube con el árbol a la vista: la nota más nueva, o la primera si todavía no hay ninguna.
  async function openCloud(host) {
    try {
      await LMD.patch({ sidebarTab: 'files', sidebarHidden: false });
      if (core && isCloud()) { host.close(); return; }
      const rows = await LMD.cloud.list(true);
      const made = rows.length ? null : await LMD.home.cloudNote();
      if (!core.APP) await host.leave();
      host.close();
      await openNote(made || rows[0].path, { edit: !!made, tree: true });
    } catch (e) { if (host.say) host.say(T(e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo completar. Probá de nuevo.')); }
  }

  async function cloudPane(box, host) {
    await LMD.cloud.ready();
    if (!LMD.cloud.enabled()) box.innerHTML = hint(T('La nube está apagada: SharpMD funciona sin cuenta y sin sincronizar.')) + actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="on">' + T('Prender la nube') + '</button>');
    else if (host.direct) box.innerHTML = direct(host);
    else if (!LMD.cloud.signedIn()) box.innerHTML = LMD.home.perks() + actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Crear cuenta o entrar') + '</button>');
    else {
      try {
        const a = await fetchAccount(host);
        box.innerHTML = acctRow(T('Cuenta'), esc(a.email)) + acctRow(T('Plan'), T(a.plan === 'pro' ? 'Pago' : 'Gratis')) + acctRow(T('Notas en la nube'), quota(a)) +
          actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="open">' + T('Abrir la carpeta Nube') + '</button><button type="button" class="lmd-btn" data-c="out">' + T('Salir') + '</button>') +
          '<p class="lmd-hint lmd-acct-msg" role="status" hidden></p>';
      } catch (e) { if (!LMD.cloud.signedIn()) return cloudPane(box, host); box.innerHTML = offline(); }
    }
    // El correo y el código se piden acá, con el mismo formulario del inicio: no hace falta salir de la nota.
    const askLogin = () => {
      const acts = box.querySelector('.lmd-acct-actions'); if (!acts || LMD.cloud.signedIn()) return;
      const form = el('div', { class: 'lmd-signin' }); acts.replaceWith(form);
      LMD.home.signIn(form, async () => { account = null; asked = false; paint(); await cloudPane(box, host); });
    };
    if (wantLogin) { wantLogin = false; if (LMD.cloud.enabled() && !host.direct) askLogin(); }
    box.onclick = async (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (b.dataset.c === 'on') LMD.patch({ cloudUrl: '' });
      else if (b.dataset.c === 'login') { if (host.direct) host.login(); else askLogin(); }
      else if (b.dataset.c === 'open') openCloud(Object.assign({ say: (t) => { const m = box.querySelector('.lmd-acct-msg'); if (m) { m.hidden = false; m.textContent = t; } } }, host));
      else if (b.dataset.c === 'out') { await LMD.cloud.logout(); account = null; asked = false; paint(); cloudPane(box, host); }
    };
  }

  async function aiPane(box, host) {
    await LMD.cloud.ready();
    const intro = hint(T('Una IA que hable MCP, como Claude, lee y escribe tus notas de la nube.'));
    const field = (label, value) => '<div class="lmd-field"><span>' + label + '</span><input type="text" readonly value="' + esc(value) + '"><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>';
    const day = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short' });
    let a = null;
    const draw = async (made) => {
      let list = [];
      try { list = await LMD.cloud.tokens(); } catch (e) { /* sin la lista, igual se puede crear uno */ }
      box.innerHTML = intro + field('URL', a.mcp_url) +
        (made ? '<p class="lmd-ai-new">' + T('Copiá estos datos ahora: el token no se vuelve a mostrar.') + '</p>' + field('Token', made.token) +
          field('Claude Code', 'claude mcp add --transport http sharpmd ' + made.mcp_url + ' --header "Authorization: Bearer ' + made.token + '"') : '') +
        '<h4>' + T('Tokens') + '</h4>' +
        (list.length ? '<ul class="lmd-tokens">' + list.map((t) => '<li><span>' + esc(t.name) + ' · ' + T('creado el {a}', { a: day(t.created) }) + ' · ' + (t.used ? T('usado el {a}', { a: day(t.used) }) : T('sin usar')) + '</span><button type="button" data-rm="' + t.id + '">' + T('Revocar') + '</button></li>').join('') + '</ul>' : hint(T('Todavía no hay tokens.'))) +
        actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="token">' + T('Crear un token') + '</button>') + '<p class="lmd-hint lmd-acct-msg" role="status" hidden></p>';
    };
    if (!LMD.cloud.enabled()) box.innerHTML = hint(T('La nube está apagada: sin ella no hay notas para conectar.'));
    else if (host.direct) box.innerHTML = intro + direct(host);
    else if (!LMD.cloud.signedIn()) box.innerHTML = intro + hint(T('Entrá a tu cuenta para conectar una IA.')) + loginBtn(host);
    else {
      try {
        a = await fetchAccount(host);
        if (a.mcp) await draw();
        else box.innerHTML = intro + '<div class="lmd-extra"><p>' + T('Conectar una IA es parte del plan pago.') + '</p><div class="lmd-extra-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-c="plans">' + T('Ver planes') + '</button></div></div>';
      } catch (e) { if (!LMD.cloud.signedIn()) return aiPane(box, host); box.innerHTML = offline(); }
    }
    box.onclick = async (e) => {
      const rm = e.target.closest('[data-rm]'); const b = e.target.closest('[data-c]');
      const say = (t) => { const m = box.querySelector('.lmd-acct-msg'); if (m) { m.hidden = false; m.textContent = t; } };
      try {
        if (rm) { if (window.confirm(T('¿Revocar este token? La IA que lo usa deja de entrar.'))) { await LMD.cloud.revoke(rm.dataset.rm); await draw(); } }
        else if (!b) return;
        else if (b.dataset.c === 'login') goLogin(host);
        else if (b.dataset.c === 'plans') host.tab('plan');
        else if (b.dataset.c === 'token') await draw(await LMD.cloud.newToken('IA'));
        else if (b.dataset.c === 'copy') {
          const input = b.parentNode.querySelector('input'); input.select();
          try { await navigator.clipboard.writeText(input.value); } catch (err) { document.execCommand('copy'); }
          b.textContent = T('Copiado'); setTimeout(() => { b.textContent = T('Copiar'); }, 1500);
        }
      } catch (err) { say(T(err.code === 'offline' ? 'No hay conexión con el servidor.' : err.code === 'mcp_needs_plan' ? 'Conectar una IA es parte del plan pago.' : 'No se pudo completar. Probá de nuevo.')); }
    };
    box.onfocusin = (e) => { if (e.target.matches('input[readonly]')) e.target.select(); };
  }

  // Volver del pago: Paddle avisa al servidor por su cuenta, así que se consulta la cuenta cada pocos
  // segundos hasta que el plan cambia. Pasado el tope se dice, sin dar el pago por perdido.
  const PAY = { every: 3000, max: 120000 };
  let wait = null; let planBox = null; let planHost = null; let planTurn = 0;
  function awaitPaid() {
    if (wait) clearTimeout(wait.timer);
    const mine = wait = { state: 'wait', until: Date.now() + PAY.max, timer: null };
    const redraw = () => { if (planBox && planBox.isConnected) planPane(planBox, planHost); };
    const clean = () => { if (location.hash === '#lmd-paid') window.history.replaceState(null, '', location.href.split('#')[0]); };
    const tick = async () => {
      if (wait !== mine) return;
      if (!LMD.cloud.signedIn()) { wait = null; clean(); redraw(); return; }
      let a = null;
      try { a = await LMD.cloud.account(); } catch (e) { /* se reintenta */ }
      if (wait !== mine) return;
      if (a && a.plan === 'pro') { account = a; asked = true; mine.state = 'done'; mine.at = Date.now(); clean(); paint(); redraw(); return; }
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
    else if (host.direct) note = direct(host);
    else if (!LMD.cloud.signedIn()) note = hint(T('Entrá a tu cuenta para pasar al plan pago.')) + loginBtn(host);
    else { try { a = await fetchAccount(host); } catch (e) { note = offline(); } }
    if (turn !== planTurn) return;
    const pro = !!a && a.plan === 'pro'; const pay = (a && a.checkout) || {};
    // El pago se hace en esta misma pestaña: el enlace lleva en back la dirección a la que volver.
    const payUrl = (url) => url + (url.includes('?') ? '&' : '?') + 'back=' + encodeURIComponent(host.back);
    const btn = (url, label) => (url ? '<a class="lmd-btn lmd-btn-fill" data-pay href="' + esc(payUrl(url)) + '">' + label + '</a>' : '<button type="button" class="lmd-btn" disabled>' + label + ' · ' + T('pronto') + '</button>');
    const state = wait && (wait.state !== 'done' || pro) ? wait.state : '';
    box.innerHTML =
      (state ? '<p class="lmd-paywait lmd-paywait-' + state + '" role="status"><span>' + T({ wait: 'Esperando la confirmación del pago…', late: 'La confirmación del pago todavía no llegó. Volvé a revisar en unos minutos.', done: 'Pago confirmado. Ya tenés el plan pago.' }[state]) + '</span>' +
        (state === 'late' ? '<button type="button" class="lmd-link" data-c="recheck">' + T('Revisar ahora') + '</button>' : '') + '</p>' : '') + note +
      '<div class="lmd-plans">' +
        '<div class="lmd-plan' + (a && !pro ? ' lmd-plan-on' : '') + '"><h4>' + T('Gratis') + '</h4><ul><li>' + T('Todo el editor') + '</li><li>' + T('Hasta 10 notas en la nube') + '</li><li>' + T('Notas en el navegador y en tu disco, sin límite') + '</li></ul>' +
          (a && !pro ? '<p class="lmd-hint">' + T('Es tu plan actual.') + '</p>' : '') + '</div>' +
        '<div class="lmd-plan' + (pro ? ' lmd-plan-on' : '') + '"><h4>' + T('Pago') + ' <small>USD 3.99 / ' + T('mes') + '</small></h4><ul><li>' + T('Notas en la nube sin límite') + '</li><li>' + T('Compartir y editar entre varios') + '</li><li>' + T('Conectar una IA por MCP') + '</li><li>' + T('Historial de versiones de 30 días') + '</li><li>' + T('Colores, tipografía y CSS propio') + '</li></ul>' +
          (pro ? '<p class="lmd-hint">' + T('Es tu plan actual.') + (a.manage ? ' <a href="' + esc(a.manage) + '" target="_blank" rel="noopener noreferrer">' + T('Administrar la suscripción') + '</a>' : '') + '</p>'
            : a ? '<div class="lmd-plan-buy">' + btn(pay.monthly, 'USD 3.99 / ' + T('mes')) + btn(pay.yearly, 'USD 39 / ' + T('año')) + '</div>' : '') + '</div></div>';
    box.onclick = async (e) => {
      const b = e.target.closest('[data-c]'); const link = e.target.closest('[data-pay]');
      if (b && b.dataset.c === 'login') goLogin(host);
      else if (b && b.dataset.c === 'recheck') awaitPaid();
      // Antes de salir a pagar se guarda lo pendiente.
      else if (link) { e.preventDefault(); await host.leave(); location.href = link.href; }
    };
  }
  const panes = { cloud: cloudPane, ai: aiPane, plan: planPane };

  // Desde el inicio no hay Ajustes: el mismo panel se abre en una ventana.
  function dialog(kind, host) {
    const box = el('div', { class: 'lmd-ask' });
    const title = T(kind === 'ai' ? 'Conectar una IA' : 'Plan');
    box.innerHTML = '<div class="lmd-ask-card lmd-acct-card" role="dialog" aria-label="' + title + '"><h3>' + title + '</h3><div class="lmd-acct"></div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-d="close">' + T('Cerrar') + '</button></div></div>';
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
    const close = '<button type="button" class="lmd-btn" data-fb="close">' + T('Cerrar') + '</button>';
    const card = (inner) => { box.innerHTML = '<div class="lmd-ask-card lmd-fb" role="dialog" aria-label="' + T('Enviar comentarios') + '"><h3>' + T('Enviar comentarios') + '</h3>' + inner + '</div>'; };
    // Con la nube apagada, o sobre un archivo abierto directo en el navegador, no hay servidor al que mandar: queda el correo.
    if (!LMD.cloud.enabled() || (core && !core.APP)) card(mailto('') + '<div class="lmd-ask-actions">' + close + '</div>');
    else card('<textarea data-fb="text" maxlength="4000" placeholder="' + T('Qué pasó, o qué te gustaría que cambie') + '"></textarea>' +
      (LMD.cloud.signedIn() ? '' : '<input type="email" data-fb="email" placeholder="' + T('tu correo, si querés respuesta (opcional)') + '">') +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-fb="close">' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-fb="send">' + T('Enviar') + '</button></div>');
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
        await LMD.cloud.feedback(text, mail, { version: chrome.runtime.getManifest().version, where: window.__MDT_WEB ? 'web' : 'extension', browser: navigator.userAgent, lang: LMD.lang() });
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

  const mine = () => LMD.cloud.split(core.cloudPath);

  // Compartir: con otra cuenta (ver o editar), o con un enlace público de solo lectura, con contraseña opcional.
  async function share() {
    const path = core.cloudPath; const folder = path.indexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '';
    const box = el('div', { class: 'lmd-ask' });
    box.innerHTML = '<div class="lmd-ask-card lmd-share" role="dialog" aria-label="' + T('Compartir') + '"><h3>' + T('Compartir') + '</h3>' +
      '<h4>' + T('Con otra cuenta') + '</h4>' +
      '<div class="lmd-share-row"><input type="email" data-sh="email" placeholder="' + T('correo de la otra persona') + '">' +
        '<select data-sh="role"><option value="edit">' + T('Puede editar') + '</option><option value="view">' + T('Solo ver') + '</option></select>' +
        '<button type="button" class="lmd-btn lmd-btn-fill" data-sh="invite">' + T('Compartir') + '</button></div>' +
      (folder ? '<label class="lmd-check"><input type="checkbox" data-sh="folder"><span>' + T('Compartir toda la carpeta "{a}"', { a: esc(folder) }) + '</span></label>' : '') +
      '<ul data-sh="people"></ul>' +
      '<h4>' + T('Con un enlace de solo lectura') + '</h4>' +
      '<div class="lmd-share-row"><input type="text" data-sh="pass" placeholder="' + T('contraseña (opcional)') + '"><button type="button" class="lmd-btn" data-sh="link">' + T('Crear enlace') + '</button></div>' +
      '<ul data-sh="links"></ul>' +
      '<p class="lmd-img-err" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-sh="close">' + T('Cerrar') + '</button></div></div>';
    document.body.appendChild(box);
    const q = (n) => box.querySelector('[data-sh=' + n + ']'); const err = box.querySelector('.lmd-img-err');
    const fail = (e) => { err.hidden = false; err.textContent = T({ bad_email: 'Ese correo no parece válido.', own_email: 'Ese es tu propio correo.', offline: 'No hay conexión con el servidor.', share_needs_plan: 'Compartir es parte del plan pago.' }[e && e.code] || 'No se pudo completar. Probá de nuevo.'); };
    const made = {}; // enlaces creados en esta ventana: el token solo se conoce al crearlo
    const draw = async () => {
      try {
        const all = await LMD.cloud.api('GET', '/shares');
        const people = all.people.filter((s) => s.path === path || (s.kind === 'folder' && path.startsWith(s.path + '/')));
        q('people').innerHTML = people.map((s) => '<li><span>' + esc(s.email) + ' · ' + T(s.role === 'edit' ? 'Puede editar' : 'Solo ver') + (s.kind === 'folder' ? ' · ' + esc(s.path) + '/' : '') + '</span><button type="button" data-rm="s' + s.id + '">' + T('Quitar') + '</button></li>').join('');
        q('links').innerHTML = all.links.filter((l) => l.path === path).map((l) => '<li>' + (made[l.id] ? '<input type="text" readonly value="' + esc(made[l.id]) + '">' : '<span>' + T(l.protected ? 'Enlace con contraseña' : 'Enlace abierto') + '</span>') + '<button type="button" data-rm="l' + l.id + '">' + T('Quitar') + '</button></li>').join('');
      } catch (e) { fail(e); }
    };
    draw();
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-sh=close]')) { box.remove(); return; }
      err.hidden = true;
      try {
        const rm = e.target.closest('[data-rm]');
        if (rm) { if (rm.dataset.rm[0] === 's') await LMD.cloud.unshare(rm.dataset.rm.slice(1)); else await LMD.cloud.unlink(rm.dataset.rm.slice(1)); return draw(); }
        if (e.target.closest('[data-sh=invite]')) {
          const whole = q('folder') && q('folder').checked;
          await LMD.cloud.share(whole ? folder : path, q('email').value.trim(), q('role').value, whole ? 'folder' : 'note');
          q('email').value = ''; return draw();
        }
        if (e.target.closest('[data-sh=link]')) {
          const r = await LMD.cloud.link(path, q('pass').value);
          const all = await LMD.cloud.api('GET', '/shares?path=' + encodeURIComponent(path));
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
    try { list = await LMD.cloud.api('GET', '/versions/' + encodeURIComponent(core.cloudPath)); } catch (e) { core.flash(T('No hay conexión con el servidor.'), 'error'); return; }
    const box = el('div', { class: 'lmd-ask' });
    const fmt = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'medium', timeStyle: 'short' });
    box.innerHTML = '<div class="lmd-ask-card lmd-hist" role="dialog" aria-label="' + T('Historial de versiones') + '"><h3>' + T('Historial de versiones') + '</h3>' +
      (list.length ? '<div class="lmd-hist-body"><ul>' + list.map((v) => '<li><button type="button" data-v="' + v.id + '">' + esc(fmt(v.saved)) + '<small>' + v.size + '</small></button></li>').join('') + '</ul><pre></pre></div>'
        : '<p>' + T('Todavía no hay versiones anteriores de esta nota.') + '</p>') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-h="no">' + T('Cerrar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-h="ok" disabled>' + T('Restaurar esta versión') + '</button></div></div>';
    document.body.appendChild(box);
    let chosen = null;
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-h=no]')) { box.remove(); return; }
      const v = e.target.closest('[data-v]');
      if (v) {
        try { const r = await LMD.cloud.api('GET', '/version/' + v.dataset.v); chosen = r.text; box.querySelector('pre').textContent = r.text; box.querySelector('[data-h=ok]').disabled = false; box.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('lmd-on', b === v)); }
        catch (err) { core.flash(T('No hay conexión con el servidor.'), 'error'); }
        return;
      }
      if (e.target.closest('[data-h=ok]') && chosen != null) { box.remove(); core.setRaw(chosen); core.flash(T('Versión restaurada. Ctrl+Z la deshace')); }
    });
  }

  function click(btn) {
    if (isCloud()) { openMenu(btn); return; }
    if (LMD.cloud.signedIn()) upload(); else if (core.APP) core.openPanel('cloud'); else core.openApp('');
  }

  function init(c) {
    core = c;
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    LMD.cloud.ready().then(paint);
  }

  LMD.sync = { init, paint, click, panes, dialog, feedback, awaitPaid, openCloud, quota, PAY };
})();
