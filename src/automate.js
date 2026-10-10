// API y automatizaciones: la pestaña de Ajustes y el formulario de una automatización.
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
  // En la app, "Ver la documentación" abre la nota de la guía (src/guide/<idioma>/api.md), que resume la API y lleva a
  // esa página. Sobre un archivo abierto directo no hay guía a mano: va la página.
  const docsHref = (host) => (host && host.appUrl ? host.appUrl + '?f=' + encodeURIComponent('guide/api.md') : DOCS);

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
  // El día solo, como en la lista de tokens de la pestaña de IA.
  const date = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'short' });
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
  // La cuenta, como la dio el servidor la última vez: de ahí sale si quien mira administra un equipo.
  let acct = null;
  // Quién puede automatizar el espacio del equipo lo decide el servidor (el papel y la política del equipo): viene en can.automation.
  const teamAdmin = () => { const mine = acct && acct.team && acct.team.mine; return mine && mine.space && mine.can && mine.can.automation && mine.can.write ? { space: String(mine.space) } : null; };

  // ---------- Desplegable de selección múltiple ----------
  // Un campo que muestra lo elegido como fichas (o un resumen si no entran en dos renglones) y, abierto, una lista de
  // casillas por grupo, con buscador y "todas las de este grupo". La lista se cuelga del fondo del diálogo y no de la
  // tarjeta: así su borde no la corta, y se abre para arriba si abajo no hay lugar. En teléfono es una hoja pegada abajo
  // de la zona visible, arriba del teclado, como los menús (touch.js).
  // opt: { label, empty, all, groups: [[título, [[valor, texto], …]], …], value: [], count(n), onChange(valores, cerró) }
  const CARET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let seq = 0;
  function multi(host, layer, opt) {
    const id = 'lmd-ms-' + (++seq);
    const all = opt.groups.reduce((a, g) => a.concat(g[1]), []);
    const text = (v) => (all.find((o) => o[0] === v) || [v, v])[1];
    const picked = new Set(opt.value || []);
    const value = () => all.map((o) => o[0]).filter((v) => picked.has(v));
    host.classList.add('lmd-ms');
    host.innerHTML = '<span class="lmd-ms-chips"></span><button type="button" class="lmd-ms-btn" id="' + id + '" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-list"><span class="lmd-ms-text"></span>' + CARET + '</button>';
    const btn = host.querySelector('.lmd-ms-btn'); const chips = host.querySelector('.lmd-ms-chips'); const label = host.querySelector('.lmd-ms-text');
    let pop = null; let list = null; let q = null; let active = ''; let held = [];
    const paint = () => {
      const now = value();
      host.classList.remove('lmd-ms-many');
      chips.innerHTML = now.map((v) => '<span class="lmd-ms-chip"><span>' + esc(text(v)) + '</span><button type="button" data-ms-rm="' + esc(v) + '" aria-label="' + esc(T('Quitar') + ': ' + text(v)) + '">' + CROSS + '</button></span>').join('');
      // Las fichas van hasta dos renglones; si no entran, queda el resumen ("5 eventos").
      const first = chips.firstElementChild;
      const many = first && first.offsetHeight ? host.offsetHeight > first.offsetHeight * 2 + 24 : now.length > 4;
      host.classList.toggle('lmd-ms-many', !!many);
      host.classList.toggle('lmd-ms-empty', !now.length);
      label.textContent = !now.length ? opt.empty : many ? opt.count(now.length) : '';
      btn.setAttribute('aria-label', opt.label + ': ' + (now.length ? now.map(text).join(', ') : opt.empty));
    };
    const shown = () => Array.from(pop.querySelectorAll('[role=option]')).filter((o) => !o.hidden);
    // "Todas las de este grupo" vale para las que se ven: con el buscador puesto, las que coinciden.
    const inGroup = (o) => Array.from(o.parentNode.querySelectorAll('[data-v]')).filter((x) => !x.hidden).map((x) => x.dataset.v);
    const setActive = (o, scroll) => {
      pop.querySelectorAll('.lmd-ms-on').forEach((x) => x.classList.remove('lmd-ms-on'));
      active = o ? o.id : '';
      if (o) { o.classList.add('lmd-ms-on'); if (scroll) o.scrollIntoView({ block: 'nearest' }); }
      [list, q].forEach((n) => { if (!n) return; if (active) n.setAttribute('aria-activedescendant', active); else n.removeAttribute('aria-activedescendant'); });
    };
    const sync = () => {
      if (!pop) return;
      pop.querySelectorAll('[data-v]').forEach((o) => o.setAttribute('aria-selected', picked.has(o.dataset.v)));
      pop.querySelectorAll('[data-ms-all]').forEach((o) => { const g = inGroup(o); const n = g.filter((v) => picked.has(v)).length; o.setAttribute('aria-selected', !!g.length && n === g.length); o.classList.toggle('lmd-ms-some', n > 0 && n < g.length); });
    };
    const place = () => {
      if (!pop) return;
      const vis = LMD.touch.visible(); const tall = vis.bottom - vis.top; const r = host.getBoundingClientRect();
      const sheet = LMD.touch.small() && LMD.touch.coarse();
      pop.classList.toggle('lmd-ms-sheet', sheet);
      pop.style.maxHeight = '';
      if (sheet) {
        pop.style.left = ''; pop.style.width = '';
        pop.style.maxHeight = Math.round(Math.min(tall - 16, Math.max(220, tall * 0.6))) + 'px';
        pop.style.top = Math.round(vis.bottom - pop.offsetHeight - 8) + 'px';
        return;
      }
      const below = vis.bottom - r.bottom - 12; const above = r.top - vis.top - 12; const want = Math.min(360, pop.scrollHeight + 2);
      const up = below < Math.min(want, 220) && above > below;
      pop.style.maxHeight = Math.max(120, Math.min(360, up ? above : below)) + 'px';
      pop.style.left = Math.round(r.left) + 'px'; pop.style.width = Math.round(r.width) + 'px';
      pop.style.top = Math.round(up ? r.top - 4 - pop.offsetHeight : r.bottom + 4) + 'px';
    };
    // La lista se acomoda al final: lo que cambia afuera (el resumen que aparece) puede mover el campo.
    const changed = (closed) => { sync(); paint(); opt.onChange(value(), !!closed); place(); };
    const toggle = (o) => {
      if (!o) return;
      if (o.dataset.msAll != null) { const g = inGroup(o); const on = g.every((v) => picked.has(v)); g.forEach((v) => { if (on) picked.delete(v); else picked.add(v); }); }
      else if (picked.has(o.dataset.v)) picked.delete(o.dataset.v); else picked.add(o.dataset.v);
      changed();
    };
    const filter = () => {
      const needle = fold(q ? q.value.trim() : ''); let n = 0;
      pop.querySelectorAll('[role=group]').forEach((g) => {
        let mine = 0; const title = fold(g.getAttribute('aria-label'));
        g.querySelectorAll('[data-v]').forEach((o) => { o.hidden = !!needle && !(fold(o.textContent).includes(needle) || title.includes(needle)); if (!o.hidden) mine++; });
        g.hidden = !mine; g.querySelector('[data-ms-all]').hidden = !mine; n += mine;
      });
      pop.querySelector('.lmd-ms-nothing').hidden = n > 0;
      sync(); setActive(shown()[0] || null, true); place();
    };
    const outside = (e) => {
      if (!pop || pop.contains(e.target) || host.contains(e.target)) return;
      if (e.target === layer) e.stopPropagation(); // un clic en el fondo cierra la lista, no el diálogo
      close(false);
    };
    const key = (e) => {
      const inQ = e.target === q; const os = shown(); const i = os.findIndex((o) => o.id === active);
      e.stopPropagation(); // Escape cierra solo la lista: el diálogo no se entera
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(os[Math.min(os.length - 1, i + 1)], true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(os[Math.max(0, i - 1)], true); }
      else if (!inQ && e.key === 'Home') { e.preventDefault(); setActive(os[0], true); }
      else if (!inQ && e.key === 'End') { e.preventDefault(); setActive(os[os.length - 1], true); }
      else if (e.key === 'Enter' || (e.key === ' ' && !inQ)) { e.preventDefault(); toggle(os[i]); }
      else if (!inQ && q && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) q.focus(); // escribir busca
    };
    function open() {
      if (pop) return;
      pop = el('div', { class: 'lmd-ms-pop' });
      pop.innerHTML = (all.length > 8 ? '<input type="text" class="lmd-ms-q" role="combobox" aria-expanded="true" aria-controls="' + id + '-list" aria-autocomplete="list" aria-label="' + T('Buscar') + '" placeholder="' + T('Buscar') + '" spellcheck="false" autocomplete="off">' : '') +
        '<div class="lmd-ms-list" id="' + id + '-list" role="listbox" aria-multiselectable="true" aria-label="' + esc(opt.label) + '" tabindex="-1">' +
        opt.groups.map((g, gi) => '<div role="group" aria-label="' + esc(g[0]) + '"><div class="lmd-ms-opt lmd-ms-all" role="option" id="' + id + '-g' + gi + '" data-ms-all="' + gi + '" aria-selected="false"><i></i><span>' + esc(g[0]) + '</span><small>' + esc(opt.all) + '</small></div>' +
          g[1].map((o, oi) => '<div class="lmd-ms-opt" role="option" id="' + id + '-o' + gi + '-' + oi + '" data-v="' + esc(o[0]) + '" aria-selected="false"><i></i><span>' + esc(o[1]) + '</span></div>').join('') + '</div>').join('') +
        '</div><p class="lmd-ms-nothing" hidden>' + T('Sin resultados') + '</p><div class="lmd-ms-foot"><button type="button" class="lmd-btn lmd-btn-fill" data-ms-done>' + T('Listo') + '</button></div>';
      list = pop.querySelector('.lmd-ms-list'); q = pop.querySelector('.lmd-ms-q');
      layer.appendChild(pop);
      // Con Escape, dialog.js cierra la ventana de arriba por su botón de salida (data-esc) aunque la tecla ya esté atendida.
      // Mientras la lista está abierta ese botón queda sin la marca: Escape cierra la lista y nada más.
      held = Array.from(layer.querySelectorAll('[data-esc]')); held.forEach((n) => n.removeAttribute('data-esc'));
      btn.setAttribute('aria-expanded', 'true'); host.classList.add('lmd-ms-open');
      pop.addEventListener('keydown', key);
      pop.addEventListener('mousedown', (e) => { if (e.target !== q) e.preventDefault(); }); // el foco no se va de la lista
      pop.addEventListener('mousemove', (e) => { const o = e.target.closest('[role=option]'); if (o && o.id !== active) setActive(o, false); });
      pop.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) { setActive(o, false); toggle(o); } else if (e.target.closest('[data-ms-done]')) close(true); });
      if (q) q.addEventListener('input', filter);
      document.addEventListener('mousedown', outside, true);
      window.addEventListener('resize', place); layer.addEventListener('scroll', place, true);
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', place); window.visualViewport.addEventListener('scroll', place); }
      sync(); place();
      setActive(pop.querySelector('[data-v][aria-selected=true]') || shown()[0], true);
      list.focus({ preventScroll: true });
    }
    function close(refocus) {
      if (!pop) return;
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('resize', place); layer.removeEventListener('scroll', place, true);
      if (window.visualViewport) { window.visualViewport.removeEventListener('resize', place); window.visualViewport.removeEventListener('scroll', place); }
      pop.remove(); pop = list = q = null; active = '';
      const back = held; held = []; setTimeout(() => back.forEach((n) => n.setAttribute('data-esc', '')), 0);
      btn.setAttribute('aria-expanded', 'false'); host.classList.remove('lmd-ms-open');
      if (refocus) btn.focus();
      opt.onChange(value(), true);
    }
    host.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-ms-rm]');
      if (rm) { picked.delete(rm.dataset.msRm); changed(!pop); btn.focus(); }
      else if (pop) close(true); else open();
    });
    btn.addEventListener('keydown', (e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pop) { e.preventDefault(); open(); } });
    paint();
    return { btn, value, open, close, paint, set: (vals) => { picked.clear(); vals.forEach((v) => picked.add(v)); sync(); paint(); place(); } };
  }

  // ---------- Una automatización: una sola pantalla que se lee como una frase ----------
  // Cuando (qué eventos) · En (qué notas) · Avisar a (el servicio y su dirección). Sirve para crear y para editar.
  // preset: { kind: 'all' | 'folder' | 'note', path, cards } para una nueva; { hook, space } para editar una que ya está.
  // La ruta puede venir con el prefijo del equipo (~12/…).
  const TEMPLATES = [['Tarea hecha', ['card.done']], ['Cambios en tarjetas', GROUPS[0][1]], ['Nota nueva', ['note.created']], ['Comentario nuevo', ['comment.created']]];
  const okUrl = (u) => /^https:\/\/\S+\.\S+/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u);
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };
  const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // La frase que resume lo elegido: "Cuando una tarjeta queda hecha o se crea una nota, en todas mis notas, avisar a Slack."
  function sentence(st, hook) {
    const ev = st.events.map((e) => low(T(EVENT[e])));
    const when = ev.length > 3 ? T('pasa cualquiera de los {n} eventos elegidos', { n: ev.length }) : ev.length > 1 ? T('{a} o {b}', { a: ev.slice(0, -1).join(', '), b: ev[ev.length - 1] }) : ev[0];
    const where = st.kind === 'folder' ? T('la carpeta {a}', { a: st.path + '/' }) : st.kind === 'note' ? T('la nota {a}', { a: st.path }) : T(st.space ? 'todo el espacio del equipo' : 'todas mis notas');
    const host = okUrl(st.url) ? hostOf(st.url) : !st.url && hook ? hostOf(hook.destination) : '';
    const to = st.format === 'json' ? host || T('tu flujo') : fmtName(st.format) + (host ? ' (' + host + ')' : '');
    return T('Cuando {a}, en {b}, avisar a {c}.', { a: when, b: where, c: to });
  }
  async function wizard(core, preset, onDone) {
    preset = preset || {};
    const hook = preset.hook || null;
    if (!acct) { try { acct = await LMD.cloud.account(); } catch (e) { acct = null; } }
    const sp = LMD.cloud.split(preset.path || ''); const admin = teamAdmin();
    const st = hook ? { space: preset.space || '', kind: hook.scope.kind, path: hook.scope.path, format: hook.format, events: hook.events.slice(), name: hook.name || '', url: '', text: !!hook.include_text }
      : { space: sp.owner && admin && String(admin.space) === sp.owner ? sp.owner : '', kind: preset.kind || 'all', path: sp.path || '', format: 'slack', events: preset.cards ? GROUPS[0][1].slice() : [], name: '', url: '', text: false };
    if (!hook && sp.owner && !st.space) { if (core && core.flash) core.flash(T('Solo se automatizan tus notas y las del equipo que administrás.'), 'warn'); return; }
    let where = await places(st.space);
    const title = T(hook ? 'Editar automatización' : 'Nueva automatización');
    // El alcance, en un solo desplegable: todo, una carpeta o una nota.
    const scopes = () => {
      const folders = where.folders.slice(); const notes = where.notes.slice();
      if (st.kind !== 'all' && !st.path) st.kind = 'all';
      if (st.kind === 'folder' && !folders.includes(st.path)) folders.unshift(st.path);
      if (st.kind === 'note' && !notes.includes(st.path)) notes.unshift(st.path);
      const cur = st.kind === 'all' ? 'all' : st.kind + ':' + st.path;
      const o = (v, t) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>';
      return o('all', T(st.space ? 'Todo el espacio del equipo' : 'Todas mis notas')) +
        (folders.length ? '<optgroup label="' + T('Carpetas') + '">' + folders.map((p) => o('folder:' + p, p + '/')).join('') + '</optgroup>' : '') +
        (notes.length ? '<optgroup label="' + T('Notas') + '">' + notes.map((p) => o('note:' + p, p)).join('') + '</optgroup>' : '');
    };
    const m = modal('lmd-au-wiz', title, '<h3>' + title + '</h3>' +
      (hook ? '' : '<div class="lmd-au-tpl" role="group" aria-label="' + T('Plantillas') + '"><span>' + T('Plantillas') + '</span>' + TEMPLATES.map((t, i) => '<button type="button" data-au-tpl="' + i + '" aria-pressed="false">' + T(t[0]) + '</button>').join('') + '</div>') +
      '<div class="lmd-au-row"><label class="lmd-au-lab" for="lmd-au-name">' + T('Nombre') + '</label><div class="lmd-au-ctl"><input type="text" id="lmd-au-name" data-au="name" maxlength="60" autocomplete="off" placeholder="' + T('Opcional') + '"></div></div>' +
      '<div class="lmd-au-row"><span class="lmd-au-lab">' + T('Cuando') + '</span><div class="lmd-au-ctl"><div data-au-events></div><p class="lmd-au-err" id="lmd-au-err-ev" hidden></p></div></div>' +
      '<div class="lmd-au-row"><label class="lmd-au-lab" for="lmd-au-scope">' + T('En') + '</label><div class="lmd-au-ctl lmd-au-pair">' +
      (admin && !hook ? '<select data-au="space" aria-label="' + T('De quién') + '"><option value="">' + T('Mis notas') + '</option><option value="' + admin.space + '"' + (st.space ? ' selected' : '') + '>' + T('El espacio del equipo') + '</option></select>' : '') +
      '<select id="lmd-au-scope" data-au="scope">' + scopes() + '</select></div></div>' +
      '<div class="lmd-au-row"><label class="lmd-au-lab" for="lmd-au-format">' + T('Avisar a') + '</label><div class="lmd-au-ctl"><div class="lmd-au-pair"><select id="lmd-au-format" data-au="format">' + FORMATS.map((x) => '<option value="' + x[0] + '"' + (x[0] === st.format ? ' selected' : '') + '>' + T(x[1]) + '</option>').join('') + '</select>' +
      '<input type="url" data-au="url" spellcheck="false" autocomplete="off" aria-label="' + T('Dirección') + '" aria-describedby="lmd-au-tip lmd-au-err-url"></div><p class="lmd-au-tip" id="lmd-au-tip"></p><p class="lmd-au-err" id="lmd-au-err-url" hidden></p></div></div>' +
      '<details class="lmd-au-more"><summary>' + T('Más opciones') + '</summary><label class="lmd-check"><input type="checkbox" data-au="text"' + (st.text ? ' checked' : '') + '><span>' + T('Incluir el contenido de la nota') + '</span></label></details>' +
      '<p class="lmd-au-sum" aria-live="polite" hidden></p><p class="lmd-dlg-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><span class="lmd-au-miss" id="lmd-au-miss" aria-live="polite"></span><button type="button" class="lmd-btn" data-au="no" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-au="save" aria-describedby="lmd-au-miss">' + T('Guardar') + '</button></div>');
    const $ = (n) => m.$('[data-au=' + n + ']');
    const err = m.$('.lmd-dlg-err'); const fail = (t) => { err.hidden = !t; err.textContent = t || ''; };
    const put = (node, t) => { node.hidden = !t; node.textContent = t || ''; };
    // Lo que ya se tocó: un campo recién avisa que falta algo cuando la persona pasó por él.
    const seen = { events: false, url: false }; let busy = false; let named = ''; let urlFail = '';
    $('name').value = st.name;
    const refresh = () => {
      if (!$('save')) return; // ya se guardó: queda la pantalla del resultado
      const f = FORMATS.find((x) => x[0] === st.format) || FORMATS[2]; const urlBad = !!st.url && !okUrl(st.url);
      $('url').placeholder = hook ? hook.destination : f[2];
      m.$('.lmd-au-more').hidden = st.format !== 'json';
      m.box.querySelectorAll('[data-au-tpl]').forEach((b) => b.setAttribute('aria-pressed', same(TEMPLATES[+b.dataset.auTpl][1], st.events)));
      put(m.$('#lmd-au-err-ev'), !st.events.length && seen.events ? T(ERRORS.bad_events) : '');
      if (st.events.length) pick.btn.removeAttribute('aria-invalid'); else if (seen.events) pick.btn.setAttribute('aria-invalid', 'true');
      // Lo que a todas luces no es una dirección se avisa mientras se escribe; lo que puede estar a medias, al salir del campo.
      const early = urlBad && !(/^https?:\/\//.test(st.url) || 'https://'.startsWith(st.url));
      put(m.$('#lmd-au-err-url'), urlBad && (seen.url || early) ? T(ERRORS.bad_destination) : urlFail);
      if (m.$('#lmd-au-err-url').hidden) $('url').removeAttribute('aria-invalid'); else $('url').setAttribute('aria-invalid', 'true');
      put(m.$('#lmd-au-tip'), m.$('#lmd-au-err-url').hidden ? (hook && !st.url ? T('Vacío: queda la dirección de ahora.') : T(f[3])) : '');
      put(m.$('.lmd-au-sum'), st.events.length ? sentence(st, hook) : '');
      const miss = [];
      if (!st.events.length) miss.push(T('un evento'));
      if (urlBad) miss.push(T('una dirección válida')); else if (!st.url && !hook) miss.push(T('la dirección'));
      m.$('.lmd-au-miss').textContent = miss.length ? T('Para guardar falta: {a}.', { a: miss.join(', ') }) : '';
      $('save').disabled = busy || !!miss.length;
    };
    const pick = multi(m.$('[data-au-events]'), m.box, { label: T('Cuando'), empty: T('Elegí qué avisar'), all: T('Todas las de este grupo'), groups: GROUPS.map((g) => [T(g[0]), g[1].map((e) => [e, T(EVENT[e])])]), value: st.events,
      count: (n) => T(n === 1 ? '1 evento' : '{n} eventos', { n }), onChange: (v, closed) => { st.events = v; if (closed) seen.events = true; refresh(); } });
    st.events = pick.value();
    const done = (made) => {
      const secret = made.secret; const h = made.hook;
      m.$('.lmd-ask-card').innerHTML = '<h3>' + T(hook ? 'Automatización guardada' : 'Automatización creada') + '</h3>' +
        (secret && h.format === 'json' ? '<p class="lmd-au-tip">' + T('Con este secreto tu flujo comprueba la firma. No se vuelve a mostrar.') + '</p><div class="lmd-field"><span>' + T('Secreto') + '</span><input type="text" readonly value="' + esc(secret) + '"><button type="button" class="lmd-link" data-au="copy">' + T('Copiar') + '</button></div>'
          : '<p class="lmd-au-tip">' + T(h.format === 'json' ? 'Mandá una prueba para ver que llega a tu flujo.' : 'Mandá una prueba para ver el mensaje en tu canal.') + '</p>') +
        '<p class="lmd-au-result" role="status" hidden></p><div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-au="test">' + T('Enviar una prueba') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-au="no" data-esc>' + T('Listo') + '</button></div>';
      m.box.dataset.hook = h.id;
      if (!LMD.touch.coarse()) m.$('[data-au=test]').focus();
      if (onDone) onDone();
    };
    const save = async () => {
      if ($('save').disabled) return;
      busy = true; urlFail = ''; fail(''); refresh();
      const scope = { kind: st.kind, path: st.kind === 'all' ? '' : st.path };
      try {
        // Lo mismo que mandaba el alta de tres pasos. Al editar, la dirección viaja solo si se escribió una nueva.
        if (hook) done(await api('PUT', '/automations/hooks/' + hook.id, Object.assign({ o: st.space || undefined, name: st.name, scope, events: st.events, format: st.format, include_text: st.format === 'json' && st.text }, st.url ? { url: st.url } : {})));
        else done(await api('POST', '/automations/hooks', { o: st.space || undefined, name: st.name, url: st.url, scope, events: st.events, format: st.format, include_text: st.format === 'json' && st.text, lang: LMD.lang() === 'en' ? 'en' : 'es' }));
      } catch (x) {
        busy = false;
        if (x && x.code === 'bad_destination') { urlFail = why(x); refresh(); $('url').focus(); } else { refresh(); fail(why(x)); }
      }
    };
    m.box.addEventListener('input', (e) => {
      const k = e.target.dataset.au;
      if (k === 'name') { st.name = e.target.value.trim(); named = ''; }
      else if (k === 'url') { st.url = e.target.value.trim(); urlFail = ''; }
      else return;
      refresh();
    });
    m.box.addEventListener('focusout', (e) => { if (e.target.dataset.au === 'url' && st.url) { seen.url = true; refresh(); } });
    m.box.addEventListener('change', async (e) => {
      const k = e.target.dataset.au;
      if (k === 'space') { st.space = e.target.value; st.kind = 'all'; st.path = ''; where = await places(st.space); $('scope').innerHTML = scopes(); }
      else if (k === 'scope') { const v = e.target.value; const i = v.indexOf(':'); st.kind = i < 0 ? 'all' : v.slice(0, i); st.path = i < 0 ? '' : v.slice(i + 1); }
      else if (k === 'format') st.format = e.target.value;
      else if (k === 'text') st.text = e.target.checked;
      else return;
      refresh();
    });
    m.box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[type=text], input[type=url]') && $('save')) { e.preventDefault(); if (e.target.dataset.au === 'url') seen.url = true; refresh(); save(); } });
    m.box.addEventListener('click', async (e) => {
      const tpl = e.target.closest('[data-au-tpl]'); const b = e.target.closest('button[data-au]');
      if (tpl) {
        // Una plantilla llena los eventos y, si el nombre está libre, también el nombre.
        const t = TEMPLATES[+tpl.dataset.auTpl]; st.events = t[1].slice(); pick.set(st.events); st.events = pick.value();
        if (!st.name || st.name === named) { named = T(t[0]); st.name = named; $('name').value = named; }
        refresh(); return;
      }
      if (!b) return;
      const act = b.dataset.au;
      if (act === 'no') m.close();
      else if (act === 'copy') copy(b.parentNode.querySelector('input').value, b);
      else if (act === 'test') { b.disabled = true; await test(m.box.dataset.hook, st.space, m.$('.lmd-au-result')); b.disabled = false; }
      else if (act === 'save') save();
    });
    refresh();
    if (!LMD.touch.coarse()) { if (st.events.length) $('url').focus(); else pick.btn.focus(); }
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
  const INTRO = 'Conectá tus notas con Slack, Make, n8n o Zapier.';
  async function pane(box, host) {
    await LMD.cloud.ready();
    const { card, copyRow } = LMD.kit;
    const intro = hint(T(INTRO));
    let space = ''; let shownUrl = null; let data = null;
    // Los tokens de la API son los de la cuenta, los mismos que usa la IA. El recién creado queda a la vista hasta salir de acá o revocarlo.
    let tokens = []; let shownTok = null; let folders = [];
    const tokName = (n) => (/^(IA|AI)$/.test(n || '') ? T('IA') : n || 'API');
    // Cada tarjeta dice lo suyo: el aviso sale en la del último clic (o en la primera, la de las automatizaciones).
    let at = 'hooks';
    const msgOf = (id) => box.querySelector('[data-blk=' + id + '] .lmd-acct-msg') || box.querySelector('.lmd-acct-msg');
    const say = (t, ok) => { const m = msgOf(at); if (m) { m.hidden = !t; m.textContent = t || ''; m.classList.toggle('lmd-acct-done', !!ok); } };
    const MSG = '<p class="lmd-hint lmd-acct-msg" role="status" hidden></p>';
    const empty = (text) => '<p class="lmd-empty">' + T(text) + '</p>';
    const draw = async () => {
      data = await api('GET', '/automations' + (space ? '?o=' + space : ''));
      const admin = teamAdmin();
      folders = [];
      try { tokens = await LMD.cloud.tokens(); } catch (e) { tokens = []; /* sin la lista, igual se puede crear uno */ }
      try { folders = (await places('')).folders; } catch (e) { /* sin carpetas, el token alcanza todo */ }
      const tokRows = tokens.map((t) => ({ name: esc(tokName(t.name)), scope: t.scope ? T('Carpeta {a}', { a: esc(t.scope) + '/' }) : T('Todas las notas'),
        meta: [T('creado el {a}', { a: date(t.created) }), t.used ? T('usado el {a}', { a: date(t.used) }) : T('sin usar')],
        acts: '<button type="button" data-tg="' + esc(t.id) + '">' + T('Regenerar') + '</button><button type="button" data-tk="' + esc(t.id) + '">' + T('Revocar') + '</button>' }));
      const hookRow = (h) => '<li class="lmd-au-item' + (h.state !== 'on' ? ' lmd-au-off' : '') + '" data-hook="' + h.id + '"><div><b>' + esc(h.name || fmtName(h.format)) + '</b><span>' + scopeText(h.scope, !!space) + ' · ' + T(h.events.length === 1 ? '1 evento' : '{n} eventos', { n: h.events.length }) + ' · ' + esc(T(fmtName(h.format))) + '</span>' +
        '<span class="lmd-au-dest">' + esc(h.destination) + '</span>' +
        (h.state === 'failed' ? '<span class="lmd-au-warn" role="alert">' + T('Se desactivó por fallos seguidos.') + '</span>' : h.state === 'paused' ? '<span class="lmd-au-warn">' + T('En pausa') + '</span>' : h.last ? '<span>' + T(h.last.ok ? 'Último aviso entregado el {a}' : 'El último aviso falló el {a}', { a: day(h.last.at) }) + '</span>' : '') + '</div>' +
        '<div class="lmd-au-acts"><button type="button" data-ha="edit">' + T('Editar') + '</button><button type="button" data-ha="test">' + T('Probar') + '</button><button type="button" data-ha="log">' + T('Registro') + '</button><button type="button" data-ha="' + (h.state === 'on' ? 'pause' : 'resume') + '">' + T(h.state === 'on' ? 'Pausar' : h.state === 'failed' ? 'Volver a prender' : 'Reanudar') + '</button><button type="button" data-ha="rm">' + T('Eliminar') + '</button></div></li>';
      const KIND = { append: 'Agrega a {a}', create: 'Crea notas en {a}', card: 'Crea tarjetas en {a}' };
      const inRow = (r) => '<li class="lmd-au-item" data-inbox="' + r.id + '"><div><b>' + esc(r.name || T('Entrada')) + '</b><span>' + T(KIND[r.kind], { a: esc(r.path || '/') }) + (r.column ? ' · ' + esc(r.column) : '') + '</span><span>' + T('Termina en {a}', { a: esc(r.hint) }) + ' · ' + (r.count ? T(r.count === 1 ? 'usada 1 vez' : 'usada {n} veces', { n: r.count }) : T('sin usar')) + '</span></div>' +
        '<div class="lmd-au-acts"><button type="button" data-ia="new">' + T('Nueva dirección') + '</button><button type="button" data-ia="rm">' + T('Eliminar') + '</button></div></li>';
      box.innerHTML = intro +
        (admin ? '<label class="lmd-pick lmd-au-space"><span>' + T('De quién') + '</span><select data-c="space"><option value="">' + T('Mis notas') + '</option><option value="' + admin.space + '"' + (space ? ' selected' : '') + '>' + T('El espacio del equipo') + '</option></select></label>' : '') +
        // Tres tarjetas, por orden de uso: lo que se viene a hacer (las automatizaciones), las direcciones de entrada y,
        // al final, los tokens de la API con su documentación. La acción de cada una va en su cabecera.
        card({ id: 'hooks', title: T('Automatizaciones'), text: T('Un aviso a Slack, Discord o tu flujo cuando pasa algo con una nota o una tarjeta.'),
          action: '<button type="button" class="lmd-btn lmd-btn-fill" data-c="hook">' + T('Nueva automatización') + '</button>',
          body: (data.hooks.length ? '<ul class="lmd-au-list" data-list="hooks">' + data.hooks.map(hookRow).join('') + '</ul>' : empty('Todavía no hay automatizaciones.')) + MSG }) +
        card({ id: 'inboxes', title: T('Direcciones de entrada'), text: T('Una dirección secreta que agrega texto a una nota. Sirve para formularios, ventas o correo.'),
          action: '<button type="button" class="lmd-btn" data-c="inbox">' + T('Nueva dirección de entrada') + '</button>',
          body: (shownUrl ? '<div class="lmd-fresh"><p class="lmd-ai-new">' + T('Copiá la dirección ahora: no se vuelve a mostrar.') + '</p>' + copyRow('URL', shownUrl, 'data-c="copy"', { mark: 'data-in-url' }) + '</div>' : '') +
            (data.inboxes.length ? '<ul class="lmd-au-list" data-list="inboxes">' + data.inboxes.map(inRow).join('') + '</ul>' : shownUrl ? '' : empty('Todavía no hay direcciones de entrada.')) + MSG }) +
        card({ id: 'tokens', title: T('Tokens de la API'), text: T('Para leer y escribir notas y mover tarjetas desde un flujo. Son los mismos tokens que usa la IA.'),
          action: '<a class="lmd-btn lmd-au-docs" href="' + docsHref(host) + '" target="_blank" rel="noopener">' + T('Ver la documentación') + '</a>',
          body: copyRow('URL', data.api_url, 'data-c="copy"') +
            (shownTok ? '<div class="lmd-fresh"><p class="lmd-ai-new">' + T('Copiá el token ahora: no se vuelve a mostrar.') + '</p>' + copyRow('Token', shownTok.token, 'data-c="copy"', { mark: 'data-api-token' }) + '</div>' : '') +
            // Sin el token a la vista, una nota chica dice que no se vuelve a mostrar. Va una sola vez, debajo de la lista.
            (tokens.length ? LMD.kit.tokenRows(tokRows, 'data-list="tokens"') + (shownTok ? '' : '<p class="lmd-note lmd-tok-kept">' + T('Un token se muestra una sola vez. Si lo perdiste, regeneralo.') + '</p>') : empty('Todavía no hay tokens.')) +
            // Lo que alcanza el token nuevo se elige al crearlo: el formulario aparece en el lugar de este botón.
            '<div class="lmd-tok-new" data-tok-new>' + actions('<button type="button" class="lmd-btn" data-c="token">' + T(tokens.length ? 'Crear otro token' : 'Crear un token') + '</button>') + '</div>' + MSG });
    };
    const askToken = (wrap) => LMD.kit.tokenAsk(wrap, LMD.kit.tokenForm({ a: 'data-c', name: ['tok-name', 'API'], folder: ['tok-folder', folders], ok: 'token-ok', no: 'token-no' }), async (form) => {
      try {
        shownTok = await LMD.cloud.newToken(form.querySelector('[data-c=tok-name]').value.replace(/\s+/g, ' ').trim() || 'API', (form.querySelector('[data-c=tok-folder]') || {}).value || '', false);
        await draw();
        const again = box.querySelector('[data-c=token]'); if (again) again.focus({ preventScroll: true });
        const n = box.querySelector('[data-api-token]'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
        return '';
      } catch (x) { return why(x); }
    });
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
      const blk = e.target.closest('[data-blk]'); if (blk && (b || ha || ia || tk || tg)) at = blk.dataset.blk;
      try {
        if (tk) {
          if (await LMD.dialog.confirm({ title: T('¿Revocar este token?'), text: T('Lo que lo usa deja de entrar.'), ok: T('Revocar'), danger: true })) { await LMD.cloud.revoke(tk.dataset.tk); if (shownTok && String(shownTok.id) === tk.dataset.tk) shownTok = null; await draw(); }
        } else if (tg) {
          // El servidor cambia el secreto en un solo paso; el nuevo queda a la vista como uno recién creado.
          if (await LMD.dialog.confirm({ title: T('¿Regenerar este token?'), text: T('Las conexiones que usan este token dejan de andar. Vas a tener que pegar el token nuevo donde lo uses.'), ok: T('Regenerar'), danger: true })) { shownTok = await LMD.cloud.regenerate(tg.dataset.tg); await draw(); const n = box.querySelector('[data-api-token]'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' }); }
        } else if (ha) {
          const id = ha.closest('[data-hook]').dataset.hook; const hook = data.hooks.find((h) => String(h.id) === id); const o = space || undefined;
          if (ha.dataset.ha === 'test') { say(T('Enviando la prueba…'), true); await test(id, space, msgOf('hooks')); }
          else if (ha.dataset.ha === 'log') deliveries(hook, space);
          else if (ha.dataset.ha === 'edit') wizard(null, { hook, space }, redraw);
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
        else if (b.dataset.c === 'token') askToken(b.closest('[data-tok-new]'));
        else if (b.dataset.c === 'plans') host.tab('plan');
        else if (b.dataset.c === 'login') host.tab('cloud');
      } catch (x) { say(why(x)); }
    };
  }

  LMD.automate = { pane, wizard, multi, EVENT, GROUPS };
})();
