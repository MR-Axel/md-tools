// API y automatizaciones: la pestaña de Ajustes y el alta guiada.
// Tres cosas para conectar SharpMD con flujos de afuera (Slack, Make, n8n, Zapier, Activepieces):
//   - avisos hacia afuera: cuando pasa algo con una nota o con una tarjeta, sale un mensaje a una dirección;
//   - direcciones de entrada: una dirección secreta que agrega texto a una nota, crea una nota o una tarjeta;
//   - la API, con los mismos tokens que usa la IA: se crean y se revocan acá mismo.
// Se pide recién al abrir la pestaña o al elegir "Automatizar…" en un menú (ver LAZY_APP en content.js).
(function () {
  'use strict';

  const { el } = LMD.kit;
  const T = LMD.t;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (m, p, b) => LMD.cloud.api(m, p, b);
  const DOCS = 'https://sharpmd.app/api.html';

  const GROUPS = [
    ['Tarjetas de un tablero', ['card.moved', 'card.done', 'card.created', 'card.updated', 'card.deleted']],
    ['Notas', ['note.created', 'note.updated', 'note.moved', 'note.deleted', 'note.restored']],
    ['Comentarios', ['comment.created', 'comment.resolved']],
  ];
  const EVENT = { 'note.created': 'Se crea una nota', 'note.updated': 'Cambia una nota', 'note.deleted': 'Se elimina una nota', 'note.restored': 'Se restaura una nota', 'note.moved': 'Se mueve o se renombra una nota',
    'comment.created': 'Hay un comentario nuevo', 'comment.resolved': 'Se resuelve un comentario', 'card.created': 'Se crea una tarjeta', 'card.moved': 'Una tarjeta cambia de columna', 'card.updated': 'Cambian los datos de una tarjeta',
    'card.done': 'Una tarjeta queda hecha', 'card.deleted': 'Se elimina una tarjeta', ping: 'Prueba' };
  const FORMATS = [['slack', 'Slack', 'https://hooks.slack.com/services/…', 'Pegá la dirección del webhook entrante de tu canal.'], ['discord', 'Discord', 'https://discord.com/api/webhooks/…', 'Pegá la dirección del webhook del canal.'],
    ['json', 'Make, n8n, Zapier u otro', 'https://', 'Pegá la dirección del webhook de tu flujo. Recibe los datos en JSON.']];
  const ERRORS = { offline: 'No hay conexión con el servidor.', bad_destination: 'Esa dirección no sirve. Tiene que empezar con https:// y ser pública.', too_many: 'Llegaste al tope. Eliminá una para crear otra.', automation_needs_plan: 'Las automatizaciones son parte del plan pago.',
    vault: 'Una carpeta protegida no se puede automatizar.', bad_events: 'Elegí al menos un evento.', bad_path: 'Elegí una nota o una carpeta.', team_policy: 'Quien administra el equipo no habilitó las automatizaciones para los miembros.', read_only: 'Tu papel en el equipo es de lectura.' };
  const why = (e) => T(ERRORS[e && e.code] || 'No se pudo completar. Probá de nuevo.');
  const day = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtName = (f) => (FORMATS.find((x) => x[0] === f) || FORMATS[2])[1];
  const scopeText = (s, team) => (s.kind === 'folder' ? T('Carpeta {a}', { a: esc(s.path) + '/' }) : s.kind === 'note' ? esc(s.path) : T(team ? 'Todo el espacio del equipo' : 'Todas las notas'));
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (e) { const t = el('textarea', { readonly: '' }); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (x) { /* no se pudo */ } t.remove(); }
    if (btn) { const was = btn.textContent; btn.textContent = T('Copiado'); setTimeout(() => { btn.textContent = was; }, 1500); }
  }
  // Una ventana propia, con el mismo marco que los demás diálogos.
  function modal(cls, label, inner) {
    const box = el('div', { class: 'lmd-ask lmd-au ' + cls });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + inner + '</div>';
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    return { box, close, $: (q) => box.querySelector(q) };
  }
  // Las notas y carpetas de un dueño: lo propio, o el espacio del equipo.
  async function places(space) {
    let rows = [];
    try { rows = await LMD.cloud.list(true, space ? String(space) : undefined); } catch (e) { rows = []; }
    const paths = rows.map((r) => r.path).filter((p) => p && p[0] !== '~').sort((a, b) => a.localeCompare(b));
    return { notes: paths, folders: LMD.sync.foldersOf(rows.filter((r) => r.path && r.path[0] !== '~')) };
  }
  const options = (list, picked, tail) => list.map((p) => '<option value="' + esc(p) + '"' + (p === picked ? ' selected' : '') + '>' + esc(p) + (tail || '') + '</option>').join('');
  // La cuenta, como la dio el servidor la última vez: de ahí sale si quien mira administra un equipo.
  let acct = null;
  // Quién puede automatizar el espacio del equipo lo decide el servidor (el papel y la política del equipo): viene en can.automation.
  const teamAdmin = () => { const mine = acct && acct.team && acct.team.mine; return mine && mine.space && mine.can && mine.can.automation && mine.can.write ? { space: String(mine.space) } : null; };

  // ---------- Alta guiada de un aviso ----------
  // preset: { kind: 'all' | 'folder' | 'note', path, cards }. La ruta puede venir con el prefijo del equipo (~12/…).
  async function wizard(core, preset, onDone) {
    preset = preset || {};
    if (!acct) { try { acct = await LMD.cloud.account(); } catch (e) { acct = null; } }
    const sp = LMD.cloud.split(preset.path || ''); const admin = teamAdmin();
    const st = { step: 1, space: sp.owner && admin && String(admin.space) === sp.owner ? sp.owner : '', kind: preset.kind || 'all', path: sp.path || '', format: 'slack',
      events: new Set(preset.cards ? GROUPS[0][1] : ['card.moved', 'card.done', 'note.created']) };
    if (sp.owner && !st.space) { if (core && core.flash) core.flash(T('Solo se automatizan tus notas y las del equipo que administrás.'), 'warn'); return; }
    let where = await places(st.space);
    const m = modal('lmd-au-wiz', T('Nueva automatización'), '<h3>' + T('Nueva automatización') + '</h3><p class="lmd-au-step" aria-live="polite"></p><div class="lmd-au-body"></div><p class="lmd-dlg-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-au="no" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn" data-au="back">' + T('Atrás') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-au="next"></button></div>');
    const body = m.$('.lmd-au-body'); const err = m.$('.lmd-dlg-err'); const fail = (t) => { err.hidden = !t; err.textContent = t || ''; };
    const STEPS = ['Dónde mirar', 'Qué avisar', 'Adónde mandar'];
    const draw = () => {
      fail('');
      m.$('.lmd-au-step').textContent = T('Paso {n} de 3', { n: st.step }) + ' · ' + T(STEPS[st.step - 1]);
      m.$('[data-au=back]').hidden = st.step === 1; m.$('[data-au=next]').textContent = T(st.step === 3 ? 'Crear' : 'Siguiente');
      if (st.step === 1) {
        const radio = (k, text, extra) => '<label class="lmd-au-opt"><input type="radio" name="lmd-au-kind" value="' + k + '"' + (st.kind === k ? ' checked' : '') + '><span>' + text + '</span>' + (extra || '') + '</label>';
        body.innerHTML = (admin ? '<label class="lmd-pick lmd-au-space"><span>' + T('De quién') + '</span><select data-au="space"><option value="">' + T('Mis notas') + '</option><option value="' + admin.space + '"' + (st.space ? ' selected' : '') + '>' + T('El espacio del equipo') + '</option></select></label>' : '') +
          radio('all', T(st.space ? 'Todo el espacio del equipo' : 'Todas mis notas')) +
          (where.folders.length ? radio('folder', T('Una carpeta'), '<select data-au="folder" aria-label="' + T('Carpeta') + '">' + options(where.folders, st.kind === 'folder' ? st.path : '', '/') + '</select>') : '') +
          (where.notes.length ? radio('note', T('Una nota'), '<select data-au="note" aria-label="' + T('Nota') + '">' + options(where.notes, st.kind === 'note' ? st.path : '') + '</select>') : '');
      } else if (st.step === 2) {
        body.innerHTML = GROUPS.map((g) => '<fieldset class="lmd-au-group"><legend>' + T(g[0]) + '</legend>' + g[1].map((ev) => '<label class="lmd-check"><input type="checkbox" value="' + ev + '"' + (st.events.has(ev) ? ' checked' : '') + '><span>' + T(EVENT[ev]) + '</span></label>').join('') + '</fieldset>').join('');
      } else {
        const f = FORMATS.find((x) => x[0] === st.format);
        body.innerHTML = '<div class="lmd-au-fmt" role="radiogroup" aria-label="' + T('Adónde mandar') + '">' + FORMATS.map((x) => '<button type="button" role="radio" data-au-fmt="' + x[0] + '" aria-checked="' + (x[0] === st.format) + '">' + T(x[1]) + '</button>').join('') + '</div>' +
          '<label class="lmd-dlg-field"><span>' + T('Dirección') + '</span><input type="url" data-au="url" spellcheck="false" autocomplete="off" placeholder="' + esc(f[2]) + '"></label><p class="lmd-au-tip">' + T(f[3]) + '</p>' +
          '<label class="lmd-dlg-field"><span>' + T('Nombre') + '</span><input type="text" data-au="name" maxlength="60" autocomplete="off" placeholder="' + T('Opcional') + '"></label>' +
          (st.format === 'json' ? '<label class="lmd-check"><input type="checkbox" data-au="text"' + (st.text ? ' checked' : '') + '><span>' + T('Incluir el contenido de la nota') + '</span></label>' : '');
        m.$('[data-au=url]').value = st.url || ''; m.$('[data-au=name]').value = st.name || '';
        if (!LMD.touch.coarse()) m.$('[data-au=url]').focus();
      }
    };
    // Lo escrito en el paso que se ve pasa al estado: así Atrás y Siguiente no pierden nada.
    const take = () => {
      if (st.step === 1) { const k = m.$('input[name=lmd-au-kind]:checked'); st.kind = k ? k.value : 'all'; const s = m.$('[data-au=' + st.kind + ']'); st.path = st.kind === 'all' ? '' : s ? s.value : ''; }
      else if (st.step === 2) st.events = new Set(Array.from(body.querySelectorAll('input:checked')).map((i) => i.value));
      else { st.url = m.$('[data-au=url]').value.trim(); st.name = m.$('[data-au=name]').value.trim(); st.text = !!(m.$('[data-au=text]') || {}).checked; }
    };
    const done = (made) => {
      const secret = made.secret; const hook = made.hook;
      m.$('.lmd-ask-card').innerHTML = '<h3>' + T('Automatización creada') + '</h3>' +
        (hook.format === 'json' ? '<p class="lmd-au-tip">' + T('Con este secreto tu flujo comprueba la firma. No se vuelve a mostrar.') + '</p><div class="lmd-field"><span>' + T('Secreto') + '</span><input type="text" readonly value="' + esc(secret) + '"><button type="button" class="lmd-link" data-au="copy">' + T('Copiar') + '</button></div>'
          : '<p class="lmd-au-tip">' + T('Mandá una prueba para ver el mensaje en tu canal.') + '</p>') +
        '<p class="lmd-au-result" role="status" hidden></p><div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-au="test">' + T('Enviar una prueba') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-au="no" data-esc>' + T('Listo') + '</button></div>';
      m.box.dataset.hook = hook.id;
      if (onDone) onDone();
    };
    m.box.addEventListener('change', async (e) => {
      if (e.target.dataset.au === 'space') { st.space = e.target.value; st.kind = 'all'; st.path = ''; where = await places(st.space); draw(); }
      else if (e.target.dataset.au === 'folder' || e.target.dataset.au === 'note') { const r = m.$('input[name=lmd-au-kind][value=' + e.target.dataset.au + ']'); if (r) r.checked = true; }
    });
    m.box.addEventListener('click', async (e) => {
      const fmt = e.target.closest('[data-au-fmt]'); const b = e.target.closest('button[data-au]');
      if (fmt) { take(); st.format = fmt.dataset.auFmt; draw(); return; }
      if (!b) return;
      const act = b.dataset.au;
      if (act === 'no') m.close();
      else if (act === 'copy') copy(b.parentNode.querySelector('input').value, b);
      else if (act === 'back') { take(); st.step--; draw(); }
      else if (act === 'test') { b.disabled = true; await test(m.box.dataset.hook, st.space, m.$('.lmd-au-result')); b.disabled = false; }
      else if (act === 'next') {
        take();
        if (st.step === 1 && st.kind !== 'all' && !st.path) { fail(T(ERRORS.bad_path)); return; }
        if (st.step === 2 && !st.events.size) { fail(T(ERRORS.bad_events)); return; }
        if (st.step < 3) { st.step++; draw(); return; }
        if (!/^https:\/\/\S+\.\S+/.test(st.url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.url)) { fail(T(ERRORS.bad_destination)); m.$('[data-au=url]').focus(); return; }
        b.disabled = true;
        try {
          done(await api('POST', '/automations/hooks', { o: st.space || undefined, name: st.name, url: st.url, scope: { kind: st.kind, path: st.path }, events: Array.from(st.events), format: st.format, include_text: st.format === 'json' && st.text, lang: LMD.lang() === 'en' ? 'en' : 'es' }));
        } catch (x) { b.disabled = false; fail(why(x)); }
      }
    });
    draw();
  }
  async function test(id, space, out) {
    const say = (t, ok) => { if (out) { out.hidden = false; out.textContent = t; out.classList.toggle('lmd-acct-done', !!ok); } };
    try {
      const r = await api('POST', '/automations/hooks/' + id + '/test', { o: space || undefined });
      say(r.ok ? T('La prueba llegó ({a} ms).', { a: r.ms }) : T('La prueba no llegó: {a}.', { a: r.code ? T('respondió {a}', { a: r.code }) : T(FAILS[r.error] || FAILS.connection) }), r.ok);
    } catch (e) { say(why(e)); }
  }
  const FAILS = { timeout: 'tardó demasiado', blocked_destination: 'la dirección no es pública', dns_failed: 'ese nombre no existe', tls: 'el certificado no es válido', connection: 'no se pudo conectar', redirect: 'respondió con una redirección' };

  // El registro de entregas de un aviso.
  async function deliveries(hook, space) {
    const m = modal('lmd-au-log', T('Registro de entregas'), '<h3>' + T('Registro de entregas') + '</h3><div class="lmd-au-rows"><p class="lmd-au-tip">' + T('Cargando…') + '</p></div><div class="lmd-ask-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-au="no" data-esc>' + T('Cerrar') + '</button></div>');
    m.box.addEventListener('click', (e) => { if (e.target.closest('[data-au=no]')) m.close(); });
    let rows = [];
    try { rows = await api('GET', '/automations/hooks/' + hook.id + '/deliveries' + (space ? '?o=' + space : '')); } catch (e) { m.$('.lmd-au-rows').innerHTML = '<p class="lmd-au-tip">' + why(e) + '</p>'; return; }
    const STATE = { ok: 'Entregado', failed: 'Falló', pending: 'En espera', canceled: 'Cancelado' };
    m.$('.lmd-au-rows').innerHTML = rows.length ? '<table class="lmd-au-table"><thead><tr><th>' + T('Cuándo') + '</th><th>' + T('Evento') + '</th><th>' + T('Estado') + '</th><th>' + T('Respuesta') + '</th><th>ms</th></tr></thead><tbody>' +
      rows.map((r) => '<tr class="lmd-au-' + esc(r.status) + '"><td>' + day(r.created) + '</td><td title="' + esc(r.path) + '">' + esc(T(EVENT[r.type] || r.type)) + '</td><td>' + T(STATE[r.status] || r.status) + (r.attempts > 1 ? ' · ' + T('{n} intentos', { n: r.attempts }) : '') + '</td><td>' + (r.code || (r.error ? esc(T(FAILS[r.error] || r.error)) : '')) + '</td><td>' + (r.ms || '') + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="lmd-au-tip">' + T('Todavía no salió ningún aviso.') + '</p>';
  }

  // ---------- Alta de una dirección de entrada ----------
  async function inboxForm(space, onDone) {
    const where = await places(space);
    const KINDS = [['append', 'Agregar al final de una nota'], ['create', 'Crear una nota en una carpeta'], ['card', 'Crear una tarjeta en un tablero']];
    const m = modal('lmd-au-in', T('Nueva dirección de entrada'), '<h3>' + T('Nueva dirección de entrada') + '</h3>' +
      '<label class="lmd-dlg-field"><span>' + T('Qué hace') + '</span><select data-au="kind">' + KINDS.map((k) => '<option value="' + k[0] + '">' + T(k[1]) + '</option>').join('') + '</select></label>' +
      '<label class="lmd-dlg-field" data-for="note"><span>' + T('Nota') + '</span><input type="text" data-au="note" list="lmd-au-notes" spellcheck="false" autocomplete="off" placeholder="inbox.md"><datalist id="lmd-au-notes">' + where.notes.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist></label>' +
      '<label class="lmd-dlg-field" data-for="folder" hidden><span>' + T('Carpeta') + '</span><input type="text" data-au="folder" list="lmd-au-folders" spellcheck="false" autocomplete="off" placeholder="' + T('Vacío: la raíz') + '"><datalist id="lmd-au-folders">' + where.folders.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist></label>' +
      '<label class="lmd-dlg-field" data-for="column" hidden><span>' + T('Columna') + '</span><input type="text" data-au="column" autocomplete="off" placeholder="' + T('Por hacer') + '"></label>' +
      '<label class="lmd-dlg-field" data-for="tpl"><span>' + T('Plantilla') + '</span><input type="text" data-au="tpl" spellcheck="false" autocomplete="off" placeholder="- {{date}} {{text}}"></label>' +
      '<label class="lmd-dlg-field"><span>' + T('Nombre') + '</span><input type="text" data-au="name" maxlength="60" autocomplete="off" placeholder="' + T('Opcional') + '"></label>' +
      '<label class="lmd-check"><input type="checkbox" data-au="get"><span>' + T('Aceptar también GET con ?text=') + '</span></label>' +
      '<p class="lmd-dlg-err" role="alert" hidden></p><div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-au="no" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-au="ok">' + T('Crear') + '</button></div>');
    const $ = (n) => m.$('[data-au=' + n + ']'); const err = m.$('.lmd-dlg-err');
    const show = () => { const k = $('kind').value; m.$('[data-for=note]').hidden = k === 'create'; m.$('[data-for=folder]').hidden = k !== 'create'; m.$('[data-for=column]').hidden = k !== 'card'; m.$('[data-for=tpl]').hidden = k === 'card'; };
    $('kind').addEventListener('change', show); show();
    m.box.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-au]'); if (!b) return;
      if (b.dataset.au === 'no') { m.close(); return; }
      const kind = $('kind').value; let path = (kind === 'create' ? $('folder').value : $('note').value).trim().replace(/^\/+|\/+$/g, '');
      if (kind !== 'create' && !path) { err.hidden = false; err.textContent = T('Escribí el nombre de la nota.'); $('note').focus(); return; }
      if (kind !== 'create' && !/\.[A-Za-z0-9]+$/.test(path)) path += '.md';
      b.disabled = true;
      let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (x) { tz = ''; }
      try { const made = await api('POST', '/automations/inboxes', { o: space || undefined, name: $('name').value.trim(), kind, path, column: $('column').value.trim(), template: kind === 'card' ? '' : $('tpl').value, allow_get: $('get').checked, tz }); m.close(); onDone(made); }
      catch (x) { b.disabled = false; err.hidden = false; err.textContent = why(x); }
    });
    if (!LMD.touch.coarse()) $('note').focus();
  }

  // ---------- La pestaña de Ajustes ----------
  const hint = (text) => '<p class="lmd-hint">' + text + '</p>';
  const actions = (html) => '<div class="lmd-acct-actions">' + html + '</div>';
  const INTRO = 'La API, los webhooks y las direcciones de entrada conectan tus notas con Slack, Make, n8n o Zapier.';
  async function pane(box, host) {
    await LMD.cloud.ready();
    const intro = hint(T(INTRO));
    let space = ''; let shownUrl = null; let data = null;
    // Los tokens de la API son los de la cuenta, los mismos que usa la IA. El recién creado queda a la vista hasta salir de acá o revocarlo.
    let tokens = []; let shownTok = null;
    const tokName = (n) => (/^(IA|AI)$/.test(n || '') ? T('IA') : n || 'API');
    const say = (t, ok) => { const m = box.querySelector('.lmd-acct-msg'); if (m) { m.hidden = !t; m.textContent = t || ''; m.classList.toggle('lmd-acct-done', !!ok); } };
    const draw = async () => {
      data = await api('GET', '/automations' + (space ? '?o=' + space : ''));
      const admin = teamAdmin();
      let folders = [];
      try { tokens = await LMD.cloud.tokens(); } catch (e) { tokens = []; /* sin la lista, igual se puede crear uno */ }
      try { folders = (await places('')).folders; } catch (e) { /* sin carpetas, el token alcanza todo */ }
      const keptFolder = (box.querySelector('[data-c=tok-folder]') || {}).value || '';
      const tokRow = (t) => '<li><span>' + esc(tokName(t.name)) + ' · ' + (t.scope ? T('Carpeta {a}', { a: esc(t.scope) + '/' }) : T('Todas las notas')) + ' · ' + T('creado el {a}', { a: day(t.created) }) + ' · ' + (t.used ? T('usado el {a}', { a: day(t.used) }) : T('sin usar')) + '</span><button type="button" data-tg="' + esc(t.id) + '">' + T('Regenerar') + '</button><button type="button" data-tk="' + esc(t.id) + '">' + T('Revocar') + '</button></li>';
      const hookRow = (h) => '<li class="lmd-au-item' + (h.state !== 'on' ? ' lmd-au-off' : '') + '" data-hook="' + h.id + '"><div><b>' + esc(h.name || fmtName(h.format)) + '</b><span>' + scopeText(h.scope, !!space) + ' · ' + T(h.events.length === 1 ? '1 evento' : '{n} eventos', { n: h.events.length }) + ' · ' + esc(T(fmtName(h.format))) + '</span>' +
        '<span class="lmd-au-dest">' + esc(h.destination) + '</span>' +
        (h.state === 'failed' ? '<span class="lmd-au-warn" role="alert">' + T('Se desactivó por fallos seguidos.') + '</span>' : h.state === 'paused' ? '<span class="lmd-au-warn">' + T('En pausa') + '</span>' : h.last ? '<span>' + T(h.last.ok ? 'Último aviso entregado el {a}' : 'El último aviso falló el {a}', { a: day(h.last.at) }) + '</span>' : '') + '</div>' +
        '<div class="lmd-au-acts"><button type="button" data-ha="test">' + T('Probar') + '</button><button type="button" data-ha="log">' + T('Registro') + '</button><button type="button" data-ha="' + (h.state === 'on' ? 'pause' : 'resume') + '">' + T(h.state === 'on' ? 'Pausar' : h.state === 'failed' ? 'Volver a prender' : 'Reanudar') + '</button><button type="button" data-ha="rm">' + T('Eliminar') + '</button></div></li>';
      const KIND = { append: 'Agrega a {a}', create: 'Crea notas en {a}', card: 'Crea tarjetas en {a}' };
      const inRow = (r) => '<li class="lmd-au-item" data-inbox="' + r.id + '"><div><b>' + esc(r.name || T('Entrada')) + '</b><span>' + T(KIND[r.kind], { a: esc(r.path || '/') }) + (r.column ? ' · ' + esc(r.column) : '') + '</span><span>' + T('Termina en {a}', { a: esc(r.hint) }) + ' · ' + (r.count ? T(r.count === 1 ? 'usada 1 vez' : 'usada {n} veces', { n: r.count }) : T('sin usar')) + '</span></div>' +
        '<div class="lmd-au-acts"><button type="button" data-ia="new">' + T('Nueva dirección') + '</button><button type="button" data-ia="rm">' + T('Eliminar') + '</button></div></li>';
      box.innerHTML = intro +
        (admin ? '<label class="lmd-pick lmd-au-space"><span>' + T('De quién') + '</span><select data-c="space"><option value="">' + T('Mis notas') + '</option><option value="' + admin.space + '"' + (space ? ' selected' : '') + '>' + T('El espacio del equipo') + '</option></select></label>' : '') +
        // Tres secciones, en este orden: los tokens de la API, los webhooks y las direcciones de entrada.
        '<h4>' + T('Tokens de la API') + '</h4>' + hint(T('Para leer y escribir notas y mover tarjetas desde un flujo. Usa los mismos tokens que la IA.')) +
        '<div class="lmd-field"><span>URL</span><input type="text" readonly value="' + esc(data.api_url) + '"><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>' +
        (shownTok ? '<p class="lmd-ai-new">' + T('Copiá el token ahora: no se vuelve a mostrar.') + '</p><div class="lmd-field"><span>Token</span><input type="text" readonly data-api-token value="' + esc(shownTok.token) + '"><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>' : '') +
        // Sin el token a la vista no queda nada suelto: una línea dice que ya está y que no se vuelve a mostrar.
        (tokens.length ? '<ul class="lmd-tokens lmd-tok-rows" data-list="tokens">' + tokens.map(tokRow).join('') + '</ul>' + (shownTok ? '' : '<p class="lmd-hint lmd-tok-kept">' + T('El token ya está creado. Por seguridad no se vuelve a mostrar: si lo perdiste, regeneralo.') + '</p>') : hint(T('Todavía no hay tokens.'))) +
        (folders.length ? '<label class="lmd-pick"><span>' + T('Carpeta') + '</span><select data-c="tok-folder"><option value="">' + T('Todas las notas') + '</option>' + options(folders, keptFolder, '/') + '</select></label>' : '') +
        actions('<button type="button" class="lmd-btn' + (tokens.length ? '' : ' lmd-btn-fill') + '" data-c="token">' + T(tokens.length ? 'Crear otro token' : 'Crear un token') + '</button><a class="lmd-btn lmd-au-docs" href="' + DOCS + '" target="_blank" rel="noopener">' + T('Ver la documentación') + '</a>') +
        '<h4>' + T('Webhooks') + '</h4>' + (data.hooks.length ? '<ul class="lmd-au-list" data-list="hooks">' + data.hooks.map(hookRow).join('') + '</ul>' : hint(T('Todavía no hay avisos. Por ejemplo: un mensaje en Slack cuando una tarjeta pasa a Hecho.'))) +
        actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="hook">' + T('Nueva automatización') + '</button>') +
        '<h4>' + T('Direcciones de entrada') + '</h4>' + hint(T('Una dirección secreta que agrega texto a una nota. Sirve para formularios, ventas o correo.')) +
        (shownUrl ? '<p class="lmd-ai-new">' + T('Copiá la dirección ahora: no se vuelve a mostrar.') + '</p><div class="lmd-field"><span>URL</span><input type="text" readonly data-in-url value="' + esc(shownUrl) + '"><button type="button" class="lmd-link" data-c="copy">' + T('Copiar') + '</button></div>' : '') +
        (data.inboxes.length ? '<ul class="lmd-au-list" data-list="inboxes">' + data.inboxes.map(inRow).join('') + '</ul>' : '') +
        actions('<button type="button" class="lmd-btn" data-c="inbox">' + T('Nueva dirección de entrada') + '</button>') +
        '<p class="lmd-hint lmd-acct-msg" role="status" hidden></p>';
    };
    const redraw = async () => { try { await draw(); } catch (e) { say(why(e)); } };
    if (!LMD.cloud.enabled()) box.innerHTML = hint(T('La nube está apagada: sin ella no hay notas para automatizar.'));
    else if (host.direct) box.innerHTML = intro; // la franja de arriba ya dice que la cuenta está en la app
    else if (!LMD.cloud.signedIn()) box.innerHTML = intro + hint(T('Entrá a tu cuenta para crear automatizaciones.')) + (host.tab ? actions('<button type="button" class="lmd-btn lmd-btn-fill" data-c="login">' + T('Crear cuenta o entrar') + '</button>') : '');
    else {
      try {
        const a = await LMD.cloud.account(); acct = a;
        if (a.api != null ? a.api : a.mcp) await draw();
        else box.innerHTML = intro + '<div class="lmd-extra"><p>' + T('La API y las automatizaciones son parte del plan pago.') + '</p><div class="lmd-extra-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-c="plans">' + T('Ver planes') + '</button></div></div>';
      } catch (e) { box.innerHTML = hint(T('No hay conexión con el servidor.')); }
    }
    box.onchange = (e) => { if (e.target.dataset.c === 'space') { space = e.target.value; shownUrl = null; redraw(); } };
    box.onfocusin = (e) => { if (e.target.matches('input[readonly]')) e.target.select(); };
    box.onclick = async (e) => {
      const b = e.target.closest('[data-c]'); const ha = e.target.closest('[data-ha]'); const ia = e.target.closest('[data-ia]'); const tk = e.target.closest('[data-tk]'); const tg = e.target.closest('[data-tg]');
      try {
        if (tk) {
          if (await LMD.dialog.confirm({ title: T('¿Revocar este token?'), text: T('Lo que lo usa deja de entrar.'), ok: T('Revocar'), danger: true })) { await LMD.cloud.revoke(tk.dataset.tk); if (shownTok && String(shownTok.id) === tk.dataset.tk) shownTok = null; await draw(); }
        } else if (tg) {
          // El servidor cambia el secreto en un solo paso; el nuevo queda a la vista como uno recién creado.
          if (await LMD.dialog.confirm({ title: T('¿Regenerar este token?'), text: T('Las conexiones que usan este token dejan de andar. Vas a tener que pegar el token nuevo donde lo uses.'), ok: T('Regenerar'), danger: true })) { shownTok = await LMD.cloud.regenerate(tg.dataset.tg); await draw(); const n = box.querySelector('[data-api-token]'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' }); }
        } else if (ha) {
          const id = ha.closest('[data-hook]').dataset.hook; const hook = data.hooks.find((h) => String(h.id) === id); const o = space || undefined;
          if (ha.dataset.ha === 'test') { say(T('Enviando la prueba…'), true); await test(id, space, box.querySelector('.lmd-acct-msg')); }
          else if (ha.dataset.ha === 'log') deliveries(hook, space);
          else if (ha.dataset.ha === 'pause' || ha.dataset.ha === 'resume') { await api('PUT', '/automations/hooks/' + id, { o, on: ha.dataset.ha === 'resume' }); await draw(); }
          else if (await LMD.dialog.confirm({ title: T('¿Eliminar esta automatización?'), text: T('Deja de mandar avisos a esa dirección.'), ok: T('Eliminar'), danger: true })) { await api('DELETE', '/automations/hooks/' + id + (space ? '?o=' + space : '')); await draw(); }
        } else if (ia) {
          const id = ia.closest('[data-inbox]').dataset.inbox;
          if (ia.dataset.ia === 'new') { if (await LMD.dialog.confirm({ title: T('¿Cambiar la dirección?'), text: T('La de ahora deja de funcionar en el acto.'), ok: T('Cambiar'), danger: true })) { shownUrl = (await api('POST', '/automations/inboxes/' + id + '/secret', { o: space || undefined })).url; await draw(); } }
          else if (await LMD.dialog.confirm({ title: T('¿Eliminar esta dirección de entrada?'), text: T('Lo que se mande ahí deja de llegar.'), ok: T('Eliminar'), danger: true })) { await api('DELETE', '/automations/inboxes/' + id + (space ? '?o=' + space : '')); shownUrl = null; await draw(); }
        } else if (!b) return;
        else if (b.dataset.c === 'hook') wizard(null, { kind: 'all', path: space ? '~' + space + '/' : '' }, redraw);
        else if (b.dataset.c === 'inbox') inboxForm(space, (made) => { shownUrl = made.url; redraw(); });
        else if (b.dataset.c === 'copy') copy(b.parentNode.querySelector('input').value, b);
        else if (b.dataset.c === 'token') { shownTok = await LMD.cloud.newToken('API', (box.querySelector('[data-c=tok-folder]') || {}).value || '', false); await draw(); }
        else if (b.dataset.c === 'plans') host.tab('plan');
        else if (b.dataset.c === 'login') host.tab('cloud');
      } catch (x) { say(why(x)); }
    };
  }

  LMD.automate = { pane, wizard, EVENT, GROUPS };
})();
