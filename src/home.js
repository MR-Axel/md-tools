// Estado vacío de la app: lo que se ve en el centro cuando no hay ninguna nota abierta. Desde acá se
// empieza una nota y se abre un archivo o una carpeta (también arrastrándolos). También dibuja la cuenta,
// que vive al pie de la barra lateral.
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
    '<dt>' + T('Con cuenta') + '</dt><dd>' + T('Notas en la nube (10 gratis), con tu IA conectada. Compartir e historial en el plan pago.') + '</dd></dl>';

  // Entrar a la cuenta: primero el correo, después el código que llega. Es el mismo formulario en el inicio y en Ajustes → Nube.
  // Lo que contesta el servidor al pedir o probar un código. Cada tope (429) llega con su código y con los segundos
  // que faltan (retry_after): al pedir, code_gap (uno cada 30 segundos), code_mail_hour y code_mail_day (5 por hora
  // y 15 por día por correo) y code_ip_hour (20 por hora por red); al probar, tries_code (6 intentos por código),
  // tries_mail_hour y tries_mail_day (10 por hora y 30 por día por correo) y tries_ip_hour (30 por hora por red).
  // Un servidor propio sin actualizar contesta con los dos códigos de antes, too_soon y too_many_tries, sin la
  // espera: para esos queda el aviso general. Ningún tope cierra las sesiones que ya están abiertas, y se dice.
  const KEEPS = 'Donde ya entraste, la sesión sigue abierta.';
  const AUTH_ERRORS = { bad_email: 'Ese correo no parece válido.', bad_code: 'Ese código no coincide.', code_expired: 'El código venció. Pedí otro.', offline: 'No hay conexión con el servidor.',
    mail_failed: 'No se pudo enviar el correo. Probá de nuevo en unos minutos.', mcp_needs_plan: 'Conectar una IA es parte del plan pago.' };
  // Cuándo se pidió el último código para cada correo desde esta pestaña: con eso se sabe si el tope es el de 30 segundos.
  const asked = {};
  const CODE_GAP = 30000;
  // La espera como se dice: segundos, minutos u horas, redondeado para arriba.
  const waitText = (s) => (s < 90 ? T(s === 1 ? '1 segundo' : '{n} segundos', { n: s }) : s < 5400 ? T('{n} minutos', { n: Math.ceil(s / 60) }) : T('{n} horas', { n: Math.ceil(s / 3600) }));
  const LIMITS = {
    code_mail_hour: 'Se pidieron demasiados códigos para este correo. Probá de nuevo en {a}.', code_mail_day: 'Se pidieron demasiados códigos para este correo. Probá de nuevo en {a}.',
    code_ip_hour: 'Se pidieron demasiados códigos desde esta red. Probá de nuevo en {a}.',
    tries_mail_hour: 'Demasiados códigos equivocados para este correo. Probá de nuevo en {a}.', tries_mail_day: 'Demasiados códigos equivocados para este correo. Probá de nuevo en {a}.',
    tries_ip_hour: 'Demasiados códigos equivocados desde esta red. Probá de nuevo en {a}.',
  };
  function authWhy(e, mail) {
    const code = e && e.code; const retry = (e && e.retry) || 0;
    if (code === 'code_gap' && retry) return T('Recién pediste un código. Esperá {n} segundos para pedir otro.', { n: retry });
    if (code === 'tries_code') return T('Ese código se probó demasiadas veces y ya no sirve. Pedí uno nuevo.') + ' ' + T(KEEPS);
    if (LIMITS[code] && retry) return T(LIMITS[code], { a: waitText(retry) }) + ' ' + T(KEEPS);
    // Lo que sigue es para un servidor que todavía no manda la espera.
    if (code === 'code_gap' || /^code_/.test(code || '')) return authWhy({ code: 'too_soon' }, mail);
    if (/^tries_/.test(code || '')) return authWhy({ code: 'too_many_tries' }, mail);
    if (code === 'too_soon') {
      const left = Math.ceil((CODE_GAP - (Date.now() - (asked[mail] || 0))) / 1000);
      if (left > 0) return T('Recién pediste un código. Esperá {n} segundos para pedir otro.', { n: left });
      return T('Se pidieron demasiados códigos. Si recién pediste uno, esperá 30 segundos; si no, probá de nuevo en una hora.') + ' ' + T(KEEPS);
    }
    if (code === 'too_many_tries') return T('Demasiados códigos equivocados. Pedí un código nuevo; si tampoco entra, probá de nuevo en una hora.') + ' ' + T(KEEPS);
    return T(AUTH_ERRORS[code] || 'No se pudo completar. Probá de nuevo.');
  }
  // Antes de pedir nada al servidor: el correo bien formado y el código de seis dígitos.
  const badMail = (v) => (!v ? 'Escribí tu correo.' : /\s/.test(v) ? 'El correo no lleva espacios.' : !validEmail(v) ? 'Ese correo no parece válido. Tiene que ser como nombre@dominio.com.' : '');
  const badCode = (v) => (/^\d{6}$/.test(v) ? '' : 'El código son seis dígitos.');
  // was: el correo que ya se había escrito, al volver del paso del código.
  function signIn(box, done, email, was) {
    box.textContent = '';
    const code = !!email;
    if (code) box.appendChild(el('p', { text: T('Te mandamos un código a {a}.', { a: email }) }));
    const input = code ? el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000', 'data-field': 'code', 'aria-label': T('Código de seis dígitos') })
      : el('input', { type: 'email', autocomplete: 'email', spellcheck: 'false', placeholder: T('tu correo'), 'data-field': 'email', 'aria-label': T('tu correo') });
    if (was) input.value = was;
    const go = el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-cloud': code ? 'verify' : 'start', text: T(code ? 'Entrar' : 'Enviar código') });
    const row = el('div', { class: 'lmd-home-cloud-row' }); row.append(input, go);
    // El aviso va pegado al campo y no borra lo escrito.
    const err = el('p', { class: 'lmd-home-cloud-err', role: 'alert', hidden: '' });
    box.append(row, err);
    // Si el código no llega (un correo mal escrito, o el tope de intentos), se vuelve al paso anterior sin recargar.
    if (code) {
      const back = el('button', { type: 'button', class: 'lmd-link lmd-signin-back', 'data-cloud': 'back', text: T('Cambiar el correo o pedir otro código') });
      back.addEventListener('click', () => signIn(box, done, '', email));
      box.appendChild(back);
    }
    input.focus();
    // Pegar el código como llega en el correo (con espacios, o con texto alrededor) deja los seis dígitos.
    if (code) input.addEventListener('paste', (e) => {
      const digits = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault(); input.value = digits; input.dispatchEvent(new Event('input'));
    });
    const fail = (text) => { err.hidden = false; err.textContent = text; input.setAttribute('aria-invalid', 'true'); input.focus(); };
    let busy = false;
    const send = async () => {
      if (busy) return;
      const v = input.value.trim(); const bad = code ? badCode(v) : badMail(v);
      if (bad) { fail(T(bad)); return; }
      const mail = code ? email : v.toLowerCase();
      busy = true; go.disabled = true;
      try {
        if (code) { await LMD.cloud.verify(email, v); await done(); }
        else { await LMD.cloud.start(mail); asked[mail] = Date.now(); signIn(box, done, mail); }
      } catch (e) { fail(authWhy(e, mail)); }
      busy = false; go.disabled = false;
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
    if (handle.kind === 'file' && imports(handle.name)) { LMD.import.run(await handle.getFile()); return; }
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
  // Con la herramienta de importar prendida, un Word, un PDF y los demás que ella convierte van a ella (import.js).
  const imports = (name) => !!LMD.import && LMD.tools.isOn('import') && LMD.import.takes(name);
  async function openInMemory(file, say) {
    if (!file) return;
    if (imports(file.name)) { LMD.import.run(file); return; }
    try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name: file.name, text: await file.text() })); }
    catch (e) { say(T('No se pudo abrir. Probá de nuevo.')); return; }
    return ctx.open('mem/' + encodeURIComponent(file.name));
  }

  // Elegir un archivo o una carpeta del disco. Lo usan el estado vacío y la cabecera del explorador.
  async function pick(what, say) {
    try {
      if (!canPick()) {
        const input = el('input', { type: 'file', accept: '.md,.markdown,.mdx,.mkd,.mdown,.txt,.json,.yaml,.yml' + (imports('x.pdf') ? ',' + LMD.import.accept : '') });
        input.addEventListener('change', () => openInMemory(input.files[0], say));
        input.click();
        return;
      }
      if (what === 'dir') await openPicked(await window.showDirectoryPicker({ id: 'lmd-abrir-carpeta', mode: 'readwrite' }), say);
      else {
        const picked = await window.showOpenFilePicker({ id: 'lmd-abrir', multiple: false,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }, { description: 'Text, JSON, YAML', accept: { 'text/plain': ['.txt'], 'application/json': ['.json'], 'application/yaml': ['.yaml', '.yml'] } }]
            .concat(imports('x.pdf') ? [{ description: 'Word, Excel, PowerPoint, EPUB, PDF, HTML, CSV', accept: { 'application/octet-stream': LMD.import.accept.split(',') } }] : []) });
        await openPicked(picked[0], say);
      }
    } catch (err) {
      if (!(err && err.name === 'AbortError')) say(T('No se pudo abrir. Probá de nuevo.'));
    }
  }

  // ---------- La cuenta, al pie de la barra lateral ----------
  // Una fila fija: quién entró, su plan y cuántas notas lleva, con las acciones en un menú (abrir la nube, ver los
  // planes, conectar una IA, salir). Sin sesión, la invitación a entrar con una línea de qué suma, y ahí mismo el
  // correo y el código. Está a la vista con una nota abierta o sin ninguna; en pantalla chica, dentro del panel lateral.
  const OUT = '<svg viewBox="0 0 24 24"><path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9"/></svg>';
  let acctSeq = 0; let acctMenu = null;
  const acctHost = () => ({
    leave: ctx.leave, back: location.href.split('#')[0], appUrl: ctx.APP_URL, close: () => {}, closed: () => paintAcct(), say: (t) => acctFail(t), unlocked: ctx.unlocked,
  });
  function acctFail(text, input) {
    const p = ctx.acct && ctx.acct.querySelector('.lmd-home-cloud-err');
    if (p) { p.hidden = false; p.textContent = text; } else if (sayNow) sayNow(text); else ctx.say(text);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  }
  function closeAcctMenu(focus) {
    if (!acctMenu) return;
    acctMenu.remove(); acctMenu = null;
    const b = ctx.acct.querySelector('[data-cloud=menu]');
    if (b) { b.setAttribute('aria-expanded', 'false'); if (focus) b.focus(); }
  }
  function openAcctMenu(btn) {
    // Ajustes primero, y debajo sus pestañas de la cuenta como atajos: el mismo ícono y el mismo nombre que llevan allá.
    // Salir va aparte. La nube se abre desde el explorador, que está justo arriba.
    const items = [['settings', ICON.sliders, 'Ajustes'], ['plan', ICON.card, 'Plan', true], ['ai', ICON.spark, 'IA (MCP)', true], null, ['logout', OUT, 'Salir']];
    acctMenu = el('div', { class: 'lmd-menu lmd-menu-acct', role: 'menu' }, '<div class="lmd-menu-list"></div>');
    items.forEach((it) => acctMenu.firstChild.appendChild(it
      ? el('button', Object.assign({ type: 'button', role: 'menuitem', 'data-cloud': it[0] }, it[3] ? { class: 'lmd-menu-sub' } : {}), it[1] + '<span>' + T(it[2]) + '</span>')
      : el('hr', { class: 'lmd-menu-sep' })));
    ctx.acct.appendChild(acctMenu); btn.setAttribute('aria-expanded', 'true');
    // Con el teclado, el foco entra al menú y las flechas lo recorren.
    acctMenu.addEventListener('keydown', (e) => {
      const all = Array.from(acctMenu.querySelectorAll('button')); const at = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus(); }
    });
  }
  // ---------- Entrar a la cuenta ----------
  // El formulario sale en el centro: en la tarjeta del inicio, debajo de los botones de empezar; con una nota abierta,
  // en una ventana propia. Ahí mismo se pide el correo, se escribe el código y se leen los errores y las esperas.
  // Lo abren la fila "Sin sesión" del pie, el enlace de la sección Nube del explorador y ?login=1.
  let loginBox = null;
  function closeLogin() { if (loginBox) { loginBox.remove(); loginBox = null; } }
  async function login(was) {
    if (!ctx) return;
    await LMD.cloud.ready();
    if (!LMD.cloud.enabled() || LMD.cloud.signedIn()) return;
    closeLogin(); closeAcctMenu();
    ctx.hideSide(); // en pantalla chica el panel lateral se cierra y queda el formulario a la vista
    const title = T('Entrar a tu cuenta');
    const inner = '<h3>' + title + '</h3><p class="lmd-login-sub">' + T('Te mandamos un código al correo, sin contraseña. Con la cuenta, tus notas se sincronizan.') + '</p>' +
      '<div class="lmd-signin"></div><button type="button" class="lmd-link lmd-login-cancel" data-cloud="cancel" data-esc>' + T('Cancelar') + '</button>';
    const start = ctx.box.hidden ? null : ctx.box.querySelector('[data-home=new]');
    let box;
    if (start) { box = el('div', { class: 'lmd-login lmd-login-home', role: 'group', 'aria-label': title }, inner); start.closest('.lmd-home-actions').after(box); }
    else { box = el('div', { class: 'lmd-ask lmd-login-ask' }, '<div class="lmd-ask-card lmd-login" role="dialog" aria-modal="true" aria-label="' + title + '">' + inner + '</div>'); document.body.appendChild(box); }
    loginBox = box;
    box.addEventListener('click', (e) => { if (e.target.closest('[data-cloud=cancel]')) closeLogin(); });
    box.addEventListener('mousedown', (e) => { if (!start && e.target === box) closeLogin(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLogin(); } });
    signIn(box.querySelector('.lmd-signin'), async () => { closeLogin(); await paintAcct(); ctx.refresh(); }, '', typeof was === 'string' ? was : '');
    if (start && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }

  // ---------- El enlace del correo con el código ----------
  // app.html#signin=<base64url de "código:correo">. El correo trae un botón que abre la app con el código ya cargado.
  // Abrir el enlace no inicia sesión: se pregunta, y recién al confirmar se llama a /auth/verify. Así quien abre los
  // enlaces para revisarlos (un antivirus, la vista previa de un cliente de correo) no gasta el código. Es el mismo
  // código de un solo uso que se puede tipear. Lo leído vive solo en memoria: nunca se guarda en ningún almacenamiento.
  function readSignin(frag) {
    try {
      const b = atob(String(frag || '').replace(/-/g, '+').replace(/_/g, '/'));
      const m = /^(\d{6}):(.+)$/.exec(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
      return m && validEmail(m[2]) && m[2] === m[2].toLowerCase() ? { code: m[1], email: m[2] } : null;
    } catch (e) { return null; }
  }
  let linking = false;
  async function signinLink(frag) {
    if (!ctx || linking) return false;
    linking = true;
    try { return await askSignin(frag); } finally { linking = false; }
  }
  async function askSignin(frag) {
    const D = LMD.dialog; const got = readSignin(frag);
    await LMD.cloud.ready();
    if (!LMD.cloud.enabled() || LMD.cloud.guest()) return false;
    const again = () => login(got ? got.email : '');
    // Con una sesión abierta no se ofrece pedir otro código desde acá: el formulario de entrar es para quien no entró.
    const dead = async (title, text) => { const ask = !LMD.cloud.signedIn(); if (await D.confirm({ title, text, ok: T(ask ? 'Pedir otro código' : 'Cerrar'), cancel: ask ? T('Cerrar') : false }) && ask) again(); return false; };
    if (!got) return dead(T('Este enlace para entrar no sirve'), T('Pedí un código nuevo y entrá con ese.'));
    const other = LMD.cloud.signedIn() && LMD.cloud.email() !== got.email;
    if (LMD.cloud.signedIn() && !other) { await D.confirm({ title: T('Ya entraste como {a}', { a: got.email }), text: T('La sesión ya está abierta en este navegador.'), ok: T('Cerrar'), cancel: false }); return false; }
    closeLogin();
    // Con otra cuenta abierta se pregunta antes de cambiar: nada se cierra hasta que el código sirvió.
    const yes = other
      ? await D.confirm({ title: T('¿Cambiar de cuenta?'), text: T('Ahora la sesión abierta es de {a}. Si seguís, se cierra y entrás como {b}.', { a: LMD.cloud.email(), b: got.email }), ok: T('Cambiar de cuenta') })
      : await D.confirm({ title: T('¿Entrar como {a}?', { a: got.email }), text: T('Abriste el enlace del correo. Vas a entrar a tu cuenta en este navegador.'), ok: T('Entrar') });
    if (!yes) return false;
    try {
      if (other && ctx.leave) { try { await ctx.leave(); } catch (e) { /* lo que no subió queda en la cola */ } }
      await LMD.cloud.verify(got.email, got.code);
    } catch (e) {
      const code = e && e.code;
      // Vencido, ya usado (quizás tipeado en otro dispositivo) o reemplazado por uno más nuevo: se ofrece pedir otro.
      if (code === 'code_expired' || code === 'bad_code' || code === 'tries_code') return dead(T('Ese enlace ya no sirve'), T('El código venció o ya se usó. Pedí otro.') + (other ? ' ' + T(KEEPS) : ''));
      await D.confirm({ title: T('No se pudo entrar'), text: authWhy(e, got.email), ok: T('Cerrar'), cancel: false });
      return false;
    }
    // Al cambiar de cuenta la app arranca de nuevo, limpia: lo que estaba a la vista era de la otra.
    if (other) { location.replace(ctx.APP_URL); return true; }
    await paintAcct(); ctx.refresh();
    return true;
  }

  async function paintAcct(step) {
    const box = ctx && ctx.acct; if (!box) return;
    const mine = ++acctSeq; // si en el medio llega otro pedido de pintar, este se retira
    await LMD.cloud.ready();
    if (mine !== acctSeq) return;
    closeAcctMenu();
    box.hidden = !LMD.cloud.enabled() || !!LMD.cloud.guest();
    if (box.hidden) return;
    // El aviso va pegado a lo que falló y no borra lo escrito.
    const errLine = () => box.appendChild(el('p', { class: 'lmd-home-cloud-err', role: 'alert', hidden: '' }));
    const row = (act, icon, title, sub) => {
      const b = el('button', { type: 'button', class: 'lmd-home-acct', 'data-cloud': act },
        '<span class="lmd-home-acct-ico">' + icon + '</span><span class="lmd-home-acct-who"><b></b><small></small></span>');
      b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub;
      return b;
    };
    if (!LMD.cloud.signedIn()) {
      box.textContent = '';
      // La misma fila que con la cuenta abierta, apagada: al tocarla el formulario sale en el centro, no acá abajo.
      const b = row('ask', ICON.cloudOff, T('Sin sesión'), T('Entrá para sincronizar tus notas'));
      b.classList.add('lmd-home-acct-ask'); b.setAttribute('aria-haspopup', 'dialog'); box.appendChild(b);
      return;
    }
    closeLogin();
    let a = null; let why = '';
    try { a = await LMD.cloud.account(); } catch (e) { why = authWhy(e, ''); }
    if (mine !== acctSeq) return;
    if (!a && !LMD.cloud.signedIn()) return paintAcct();
    box.textContent = '';
    const pro = !!a && a.plan === 'pro';
    if (a) acctHost().unlocked(a);
    // Quien tiene el plan por un equipo que paga otra persona ve su equipo y su papel, no un plan.
    const sub = a ? LMD.team.planLabel(a) + ' · ' + (a.limit ? T('{n} de {m} notas', { n: a.notes, m: a.limit }) : T(a.notes === 1 ? '1 nota, sin límite' : '{n} notas, sin límite', { n: a.notes })) : why;
    const b = row('menu', ICON.cloudOk, LMD.cloud.email(), sub);
    b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.title = LMD.cloud.email();
    b.querySelector('b').title = LMD.cloud.email();
    if (a && !pro) b.dataset.plans = '1';
    b.insertAdjacentHTML('beforeend', '<span class="lmd-home-acct-more">' + ICON.more + '</span>');
    box.appendChild(b);
    if (a && a.limit) { const m = el('span', { class: 'lmd-acct-meter' }); m.style.width = Math.min(100, Math.round((a.notes / a.limit) * 100)) + '%'; box.appendChild(m); }
    errLine();
  }
  function bindAcct() {
    const box = ctx.acct; if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cloud]'); if (!b) return;
      const act = b.dataset.cloud;
      if (act === 'start' || act === 'verify' || act === 'back') return; // los atiende el formulario
      if (act === 'menu') { if (acctMenu) closeAcctMenu(); else { openAcctMenu(b); if (!e.detail) acctMenu.querySelector('button').focus(); } return; }
      closeAcctMenu();
      const home = !ctx.box.hidden; // sin nota abierta no hay Ajustes detrás: los paneles salen en una ventana
      try {
        if (act === 'ask') await login();
        else if (act === 'logout') { await LMD.sync.signOut(acctHost()); await paintAcct(); ctx.refresh(); }
        else if (act === 'settings') { ctx.hideSide(); ctx.panel('cloud'); }
        else if (act === 'ai' || act === 'plan') { ctx.hideSide(); if (home) LMD.sync.dialog(act, acctHost()); else ctx.panel(act); } // en pantalla chica el panel lateral no queda abierto detrás
      } catch (err) { acctFail(authWhy(err, ''), box.querySelector('[data-field]')); }
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && acctMenu) { e.stopPropagation(); closeAcctMenu(true); } });
    document.addEventListener('pointerdown', (e) => { if (acctMenu && !box.contains(e.target)) closeAcctMenu(); }, true);
  }

  let dropBound = false;
  async function home(note) {
    const box = ctx.box;
    box.innerHTML =
      '<div class="lmd-home-card">' +
        '<img class="lmd-home-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
        // En pantalla chica no hay nada "a la izquierda": la lista de notas está detrás del botón de la barra.
        '<p class="lmd-home-sub">' + T(LMD.touch.small() ? 'Empezá una nota nueva o abrí una que ya tengas.' : 'Elegí una nota de la izquierda o empezá una nueva.') + '</p>' +
        '<div class="lmd-home-actions">' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-home="new">' + ICON.plus + '<span>' + T('Nueva nota') + '</span></button>' +
          '<button type="button" class="lmd-btn" data-home="tpl">' + ICON.doc + '<span>' + T('Desde una plantilla') + '</span></button>' +
          '<button type="button" class="lmd-btn" data-home="file">' + ICON.file + '<span>' + T('Abrir archivo') + '</span></button>' +
          (window.showDirectoryPicker ? '<button type="button" class="lmd-btn" data-home="dir">' + ICON.folder + '<span>' + T('Abrir carpeta') + '</span></button>' : '') +
        '</div>' +
        // Con el dedo no hay nada que arrastrar a la ventana: ese renglón solo dice lo que hace falta saber.
        '<div class="lmd-home-more">' +
        (LMD.touch.coarse()
          ? (canPick() ? '' : '<p class="lmd-home-hint">' + T('Este navegador no deja escribir sobre el archivo: al guardar se descarga una copia.') + '</p>')
          : '<p class="lmd-home-hint">' + (canPick()
            ? T('También podés arrastrar un archivo o una carpeta a esta ventana.')
            : T('También podés arrastrar un archivo a esta ventana. Este navegador no deja escribir sobre el archivo: al guardar se descarga una copia.')) + '</p>') +
        (window.showDirectoryPicker ? '<p class="lmd-home-notes"></p>' : '') +
        '</div>' +
        '<p class="lmd-home-msg" role="status" hidden></p>' +
      '</div>' +
      '<div class="lmd-home-foot"><button type="button" class="lmd-home-coffee" data-home="feedback">' + T('Enviar comentarios') + '</button>' +
        (window.__MDT_WEB ? '<a class="lmd-home-coffee" href="../?site">' + T('Qué es SharpMD') + '</a>' : '') + '</div>';
    const msg = box.querySelector('.lmd-home-msg');
    const say = (text) => { msg.hidden = !text; msg.textContent = text || ''; };
    sayNow = say;
    if (note) say(note);
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

    // La cuenta vive al pie de la barra lateral: acá solo se la pone al día.
    bindAcct();
    // Vuelta de la página de pago hecha desde acá: el plan, en su ventana, esperando la confirmación.
    if (location.hash === '#lmd-paid') { LMD.sync.dialog('plan', acctHost()); LMD.sync.awaitPaid(); }

    // Lo escrito sin conexión en notas que ya no están abiertas se sube al entrar. Con ?login=1 (se llega
    // así desde un archivo abierto directo en el navegador) el correo ya queda pedido.
    LMD.cloud.flush().catch(() => {}).then(() => paintAcct()).then(() => { if (new URLSearchParams(location.search).has('login') && box.querySelector('[data-home=new]')) login(); });

    box.onclick = async (e) => {
      const b = e.target.closest('[data-home]'); if (!b) return;
      say('');
      if (b.dataset.home === 'feedback') { LMD.sync.feedback(); return; }
      if (b.dataset.home === 'new') { create(); return; }
      if (b.dataset.home === 'tpl') { ctx.template(); return; }
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
      box.hidden = false; box.onclick = null; sayNow = null; ctx.ready();
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
    // Una nota que nace con contenido abre en edición, sin el bloque nuevo que se le ofrece a una vacía.
    const how = { edit: opt.text ? 'doc' : true, replace: !!opt.replace, tree: true };
    const base = opt.name || stamp(); const text = opt.text || ''; let full = false;
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
        paintAcct(); // el contador de notas del pie
        return ctx.open('cloud/' + encodeURIComponent(file), how);
      } catch (e) {
        // Desde una plantilla se eligió crearla ahí: en el límite del plan gratis se dice, en vez de mandarla a otro lado.
        if (opt.strict && e && e.code === 'note_limit') { ctx.plan(T('Llegaste al límite de notas del plan gratis. El plan pago no tiene límite.')); return false; }
        // En el límite del plan gratis la nota nace igual, en el navegador, y se dice dónde quedó.
        if (e && e.code === 'note_limit') full = true;
        /* sin conexión: sigue en el navegador */
      }
    }
    // Sin carpeta de notas, la nota queda guardada en el navegador y sigue ahí al volver.
    let name = base + '.md';
    for (let n = 2; n < 50 && await noteGet(name); n++) name = base + '-' + n + '.md';
    await notePut(name, text);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* el navegador decide */ }
    const done = await ctx.open('local/' + encodeURIComponent(name), how);
    if (full) ctx.warn(T('El plan gratis llega a 10 notas en la nube. Esta quedó guardada en este navegador.'));
    return done;
  }

  // ---------- Desde una plantilla ----------
  // Los grupos con sus plantillas a la izquierda y, a la derecha, cómo queda la elegida. Se filtra escribiendo,
  // las flechas recorren la lista y Enter crea. Devuelve { file, text } o null.
  const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function pickTemplate() {
    return (LMD.community ? LMD.community.ready() : Promise.resolve()).then(() => new Promise((resolve) => {
      let all = LMD.templates.list(); let groups = LMD.templates.groups();
      const title = T('Desde una plantilla');
      const box = el('div', { class: 'lmd-ask lmd-tpl' });
      box.innerHTML = '<div class="lmd-ask-card lmd-tpl-card" role="dialog" aria-modal="true" aria-label="' + title + '"><h3>' + title + '</h3>' +
        '<div class="lmd-tpl-body"><div class="lmd-tpl-side">' +
          '<input type="search" class="lmd-lk-q" spellcheck="false" placeholder="' + T('Filtrar plantillas') + '" aria-label="' + T('Filtrar plantillas') + '">' +
          '<div class="lmd-tpl-list" role="listbox" aria-label="' + title + '"></div></div>' +
        '<div class="lmd-tpl-prev markdown-body"></div></div>' +
        '<div class="lmd-ask-actions"><button type="button" class="lmd-link lmd-tpl-rm" data-tpl="rm" hidden>' + T('Quitar de mis plantillas') + '</button><button type="button" class="lmd-btn" data-tpl="no">' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-tpl="ok">' + T('Crear nota') + '</button></div></div>';
      document.body.appendChild(box);
      const input = box.querySelector('input'); const list = box.querySelector('.lmd-tpl-list'); const prev = box.querySelector('.lmd-tpl-prev'); const ok = box.querySelector('[data-tpl=ok]');
      let shown = []; let at = ''; let done = false;
      const close = (value) => { if (done) return; done = true; box.remove(); resolve(value); };
      const select = (id) => {
        at = id;
        list.querySelectorAll('[data-id]').forEach((b) => { const on = b.dataset.id === id; b.classList.toggle('lmd-on', on); b.setAttribute('aria-selected', String(on)); if (on) b.scrollIntoView({ block: 'nearest' }); });
        const t = id ? LMD.templates.get(id) : null;
        prev.innerHTML = t ? ctx.preview(t.text) : '';
        prev.scrollTop = 0; ok.disabled = !t;
        // Una plantilla de varias notas crea una carpeta: el botón lo dice.
        ok.textContent = t && t.pack ? T('Crear carpeta') : T('Crear nota');
        box.querySelector('[data-tpl=rm]').hidden = !String(id).startsWith('c:');
      };
      const draw = () => {
        const q = plain(input.value.trim());
        list.textContent = ''; shown = [];
        groups.forEach((g) => {
          const rows = all.filter((t) => t.group === g.id && (!q || plain(t.name).includes(q) || plain(g.name).includes(q)));
          if (!rows.length) return;
          list.appendChild(el('p', { class: 'lmd-menu-label', text: g.name }));
          rows.forEach((t) => { list.appendChild(el('button', { type: 'button', class: 'lmd-lk-row', role: 'option', 'data-id': t.id, text: t.name })); shown.push(t.id); });
        });
        if (!shown.length) list.appendChild(el('p', { class: 'lmd-empty', text: T('Ninguna plantilla coincide.') }));
        select(shown.includes(at) ? at : (shown[0] || ''));
      };
      // Con el dedo el filtro no toma el foco solo: el teclado taparía la lista.
      const focus = () => { if (!LMD.touch.coarse()) input.focus(); };
      draw(); focus();
      input.addEventListener('input', draw);
      box.addEventListener('keydown', (e) => {
        e.stopPropagation(); // los atajos del documento no corren con el selector abierto
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Enter') { e.preventDefault(); if (at) close(LMD.templates.get(at)); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (shown.length) select(shown[(shown.indexOf(at) + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length]);
        }
      });
      box.addEventListener('mousedown', (e) => { if (e.target === box) close(null); });
      box.addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]'); const b = e.target.closest('[data-tpl]');
        if (row) { select(row.dataset.id); focus(); }
        // Una plantilla de la comunidad se puede quitar de las propias desde acá.
        else if (b && b.dataset.tpl === 'rm') { if (at.startsWith('c:')) LMD.community.remove('template', +at.slice(2)).then(() => { all = LMD.templates.list(); groups = LMD.templates.groups(); draw(); }); }
        else if (b) close(b.dataset.tpl === 'ok' && at ? LMD.templates.get(at) : null);
      });
      list.addEventListener('dblclick', (e) => { const row = e.target.closest('[data-id]'); if (row) close(LMD.templates.get(row.dataset.id)); });
    }));
  }

  LMD.home = {
    create: (c, opt) => { ctx = c; return create(opt); },
    cloudNote: () => cloudNote(),
    // Un archivo recién guardado pasa a ser la nota abierta: reemplaza en el historial a la que era.
    adopt: (c, handle) => { ctx = c; return openPicked(handle, () => {}, { replace: true }); },
    show: (c, note) => { ctx = c; return home(note); },
    // El pie de la cuenta: con c se monta y se pinta; sin nada, se repinta si ya está (cambió la sesión o el plan).
    account: (c) => { if (c) { ctx = c; bindAcct(); } return paintAcct(); },
    say: (text) => { if (sayNow) sayNow(text); },
    pick: (c, what) => { ctx = c; return pick(what, c.say); },
    // Un archivo que llega ya leído (compartido desde otra app): el mismo camino que el selector sin acceso a archivos.
    openFile: (c, file, say) => { ctx = c; return openInMemory(file, say); },
    pickTemplate: (c) => { ctx = c; return pickTemplate(); },
    perks, signIn, waitText, login,
    // El enlace del correo con el código (app.html#signin=...): pregunta antes de entrar.
    signinLink: (c, frag) => { ctx = c; return signinLink(frag); },
    gate: (c, rec, mode) => { ctx = c; return gate(rec, mode); },
  };
})();
