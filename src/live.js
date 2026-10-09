// Sesión en vivo: varias personas editando la misma nota de la nube a la vez, por bloques. Quien tiene la nota (y
// el plan pago) abre la sesión y pasa un enlace; quien tiene el enlace entra desde la web, sin cuenta y sin la
// extensión, con el nombre que elija. En una nota del equipo la abre un miembro que puede editar, si quien
// administra lo permite: los demás miembros que tienen la nota abierta quedan adentro sin pasar por el enlace.
// Acá vive lo que se ve de la sesión: el cuadro para abrirla y manejarla, la entrada del invitado, quiénes están
// (arriba, y con una marca de color al margen del bloque donde está cada uno), el bloque que otro está escribiendo
// y el aviso cuando dos tocaron lo mismo. Los cambios en sí los aplica el lector (content.js: applyRemote), y de
// hablar con el servidor se ocupa cloud.js. Los nombres de los demás se ponen siempre como texto, nunca como HTML.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null;
  // La sesión de la nota abierta, o null: { role: 'owner' | 'guest', path, me, by, people, max, up, ended, team, can }.
  // role 'owner' es quien está con su cuenta: quien la abrió o, en una nota del equipo, cualquier miembro (me dice
  // cuál: 'o' o 'm2'). can: la maneja (cambia el enlace, saca a un invitado, la termina).
  // people viene del servidor: [{ id, name, color, block, editing, here }]. El color es un número que asigna él.
  let S = null;
  let turn = 0;
  let layer = null; let chip = null; let bar = null; let dlg = null; let notice = null; let strip = null;
  // Doce colores que se leen con letra blanca encima, en tema claro y oscuro.
  const COLORS = ['#d93d42', '#0b7fd6', '#2b9a66', '#d9620f', '#8347b9', '#c8388f', '#0e958a', '#a67c00', '#3a5bc7', '#b54a6f', '#0b8fb0', '#7d6b55'];
  const tint = (p) => COLORS[(p.color | 0) % COLORS.length];
  const person = (pid) => (S && S.people.find((x) => x.id === pid)) || null;
  const initials = (name) => { const parts = String(name).trim().split(/\s+/); const first = (s) => Array.from(s)[0] || ''; return (first(parts[0]) + (parts.length > 1 ? first(parts[parts.length - 1]) : '')).toUpperCase(); };
  const here = () => (S ? S.people.filter((p) => p.here || p.id === S.me) : []);
  const others = () => (S ? S.people.filter((p) => p.id !== S.me && p.here) : []);
  const active = () => !!S && !S.ended;
  // El color de una persona fuera de una sesión en vivo: siempre el mismo para el mismo correo.
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h % COLORS.length; };
  // Una IA que está en la nota: "IA · Claude Code (token "work")", o "IA · work" si el cliente no dijo quién es.
  const aiName = (a) => T('IA') + ' · ' + (a.client ? a.client + ' (token "' + (a.token || '') + '")' : a.token || '');
  const who = (by) => (!by ? '' : by.kind === 'ai' ? T('IA') + (by.name ? ' · ' + by.name : '') : by.kind === 'guest' ? (by.name ? by.name + ' · ' : '') + T('invitado') : by.name || '');
  // "Última edición: 8 oct, 22:35, por Ana". Las notas guardadas antes de que se anotara el autor dicen solo cuándo.
  function lastText() {
    const e = core && core.lastEdit; if (!e || !e.at) return '';
    const d = new Date(e.at).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const a = who(e.by);
    return a ? T('Última edición: {d}, por {a}', { d, a }) : T('Última edición: {d}', { d });
  }
  // Un miembro del equipo que no eligió un nombre visible llega sin nombre: nunca viaja su correo.
  const named = (list) => (Array.isArray(list) ? list : []).map((p) => (p.name ? p : Object.assign({}, p, { name: T('Miembro del equipo') })));
  const say = (e) => T({ offline: 'No hay conexión con el servidor.', live_gone: 'Esa sesión en vivo ya terminó.', live_ended: 'Esa sesión en vivo ya terminó.', live_full: 'La sesión está completa. Probá de nuevo en un rato.',
    too_many: 'Demasiados intentos. Probá de nuevo más tarde.', bad_name: 'Escribí un nombre.', not_found: 'Esta nota ya no está en la nube.', no_route: 'Este servidor todavía no tiene sesiones en vivo.',
    live_vault: 'Las notas de una carpeta protegida no se abren en vivo.', team_policy: 'Quien administra el equipo no habilitó las sesiones en vivo con invitados.', read_only: 'Tu papel en el equipo es de lectura.',
    not_opener: 'La maneja quien la abrió o quien administra el equipo.', live_team_max: 'El equipo ya tiene varias sesiones en vivo abiertas. Terminá alguna.', no_server: 'La nube está apagada: sin ella no hay sesiones en vivo.' }[e && e.code] || 'No se pudo completar. Probá de nuevo.');

  // Lo que se recuerda en este navegador: el nombre elegido y, de las sesiones abiertas acá, su enlace (el servidor
  // guarda solo una huella del secreto, así que no lo puede volver a dar).
  const kept = () => new Promise((resolve) => chrome.storage.local.get('live', (r) => resolve((r && r.live) || {})));
  const keep = async (patch) => { const now = Object.assign(await kept(), patch); await new Promise((resolve) => chrome.storage.local.set({ live: now }, resolve)); };
  const linkKey = (path) => LMD.cloud.email() + '|' + path;
  // El enlace abre la app web. Desde la extensión es la de sharpmd.app; desde una web propia, esa misma.
  const linkOf = (secret) => (window.__MDT_WEB ? location.origin + location.pathname : LMD.WEB_APP_URL) + '#live=' + encodeURIComponent(secret); // tras el #: el navegador no se lo manda al sitio que sirve la app
  async function linkPut(path, secret) {
    const links = Object.assign({}, (await kept()).links); const keys = Object.keys(links);
    if (keys.length > 40) delete links[keys[0]];
    if (secret) links[linkKey(path)] = linkOf(secret); else delete links[linkKey(path)];
    await keep({ links });
    return secret ? links[linkKey(path)] : '';
  }
  const linkGet = async (path) => ((await kept()).links || {})[linkKey(path)] || '';

  // ---------- Entrar por el enlace ----------
  async function enter(secret) {
    await LMD.cloud.ready();
    if (!LMD.cloud.enabled()) { core.live.home(say({ code: 'no_server' })); return; }
    // Desde ya se ve como lo va a ver un invitado: la nota y nada más. Si no entra, queda la app de siempre.
    const root = document.documentElement; root.classList.add('lmd-guest');
    const back = (note) => { root.classList.remove('lmd-guest'); core.live.home(note); };
    let g = null;
    // Al recargar la pestaña sigue valiendo el pase que ya tenía: no vuelve a pedir el nombre.
    try { g = await LMD.cloud.live.resume(secret); } catch (e) { back(say(e)); return; }
    if (!g) {
      let look = null;
      try { look = await LMD.cloud.live.look(secret); } catch (e) { back(say(e)); return; }
      g = await askName(secret, look);
      if (!g) { back(''); return; }
    }
    await core.live.open(g.note);
  }
  // Pide el nombre y entra. Devuelve los datos del invitado, o null si prefirió no entrar.
  function askName(secret, look) {
    return new Promise((resolve) => {
      const box = el('div', { class: 'lmd-ask' });
      box.innerHTML = '<div class="lmd-ask-card lmd-live-card" role="dialog" aria-label="' + T('Sesión en vivo') + '"><h3>' + T('Sesión en vivo') + '</h3>' +
        '<p class="lmd-live-lead"></p>' +
        '<label class="lmd-dlg-field"><span>' + T('Tu nombre') + '</span><input type="text" maxlength="40" autocomplete="nickname" spellcheck="false"></label>' +
        '<p class="lmd-hint">' + T('Los demás ven este nombre mientras dure la sesión. No hace falta cuenta.') + '</p>' +
        '<p class="lmd-dlg-err" role="alert" hidden></p>' +
        '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-lv="no" data-esc>' + T('Ahora no') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-lv="join">' + T('Entrar a la sesión') + '</button></div></div>';
      box.querySelector('.lmd-live-lead').textContent = T('{a} te invitó a editar "{b}".', { a: look.by, b: look.note });
      const input = box.querySelector('input'); const err = box.querySelector('.lmd-dlg-err');
      const fail = (text) => { err.hidden = false; err.textContent = text; };
      document.body.appendChild(box);
      kept().then((k) => { const a = LMD.sync && LMD.sync.account && LMD.sync.account(); const name = (a && a.name) || k.name; if (name && !input.value) { input.value = name; input.select(); } });
      if (look.full) fail(say({ code: 'live_full' }));
      input.focus();
      let busy = false;
      const done = (value) => { box.remove(); resolve(value); };
      const join = async () => {
        const name = input.value.trim();
        if (!name) { fail(say({ code: 'bad_name' })); input.focus(); return; }
        if (busy) return; busy = true; err.hidden = true;
        try { const g = await LMD.cloud.live.join(secret, name); await keep({ name }); done(g); }
        catch (e) { busy = false; fail(say(e)); }
      };
      box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); join(); } else if (e.key === 'Escape') { e.preventDefault(); done(null); } });
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b) { if (b.dataset.lv === 'join') join(); else done(null); } });
    });
  }

  // ---------- La sesión de la nota abierta ----------
  function start(path, st, role) {
    const g = LMD.cloud.guest();
    S = { role, path, me: role === 'owner' ? st.you || 'o' : g.id, by: role === 'owner' ? st.name || '' : g.by, people: named(st.people), max: st.max || 0, up: true, ended: '',
      team: role === 'owner' && !!st.team, can: role === 'owner' && (!st.team || !!st.can) };
    document.documentElement.classList.add('lmd-live');
    paint();
    // Si ya había un bloque con el cursor, los demás lo ven desde ahora.
    const a = core.live.typing(); if (a) at(a, false);
  }
  function stop() {
    S = null; clearTimeout(sendTimer); clearTimeout(idleTimer); clearTimeout(awayTimer); spot = { block: null, editing: false };
    document.documentElement.classList.remove('lmd-live');
    if (dlg) { dlg.remove(); dlg = null; }
    paint();
  }
  // Al abrir una nota de la nube: un invitado ya está en su sesión; quien es dueño de la nota, o miembro del equipo
  // al que pertenece, pregunta si tiene una abierta.
  async function attach(path) {
    if (!core || !core.APP) return;
    const mine = ++turn;
    const g = LMD.cloud.guest();
    if (g) { if (!g.ended) start(path, { people: g.people, max: g.max }, 'guest'); return; }
    if (LMD.cloud.split(path).owner && !LMD.cloud.isTeam(path)) return;
    try { const st = await LMD.cloud.live.status(path); if (mine === turn && core.cloudPath === path && st.open && !S) start(path, st, 'owner'); }
    catch (e) { /* sin conexión, o un servidor sin sesiones en vivo: la nota se usa como siempre */ }
  }
  function detach() { turn++; if (S || bar) stop(); }
  // La sesión terminó. Para quien la abrió, la nota sigue como cualquier otra. Para un invitado, lo escrito queda a
  // la vista sin poder seguir, y la barra le ofrece descargarlo.
  function end(why) {
    if (!S || S.ended) return;
    if (S.role === 'owner') { stop(); if (why !== 'mine') core.flash(T('La sesión en vivo terminó.'), 'warn'); return; }
    S.ended = why || 'closed'; S.people = [];
    core.live.freeze();
    paint();
  }
  // Lo que llega por la escucha de la nota: quiénes están (live) y si la conexión está arriba (link).
  function event(ev) {
    if (ev.type === 'link') { if (S && S.up !== !!ev.up) { S.up = !!ev.up; paint(); } return; }
    if (ev.type !== 'live') return;
    // 'left': el servidor liberó el lugar de un invitado que estuvo un rato sin conexión; la escucha vuelve a entrar sola.
    if (!ev.open) { if (ev.why !== 'left') end(ev.why); return; }
    const people = named(ev.people);
    if (!S) { if (LMD.cloud.guest() || !core.cloudPath) return; start(core.cloudPath, { people, name: (people.find((p) => p.id === 'o') || {}).name, team: ev.team, you: ev.you, can: ev.can }, 'owner'); }
    S.people = people;
    if (S.role === 'owner' && ev.team) { S.team = true; S.me = ev.you || S.me; S.can = !!ev.can; }
    if (S.role === 'owner') S.by = (people.find((p) => p.id === 'o') || {}).name || S.by;
    paint();
    if (dlg && dlg._draw) dlg._draw();
  }

  // ---------- En qué bloque estoy ----------
  // Se avisa al entrar a un bloque, al empezar a escribir (ahí se lo pide para uno) y al salir. Sin teclear unos
  // segundos el bloque se suelta, aunque el cursor siga adentro. El ritmo está acotado: como mucho un aviso cada 400 ms.
  let spot = { block: null, editing: false };
  let sendTimer = null; let idleTimer = null; let awayTimer = null; let sentAt = 0; let sentWhat = '';
  function at(node, typing) {
    if (!active()) return;
    clearTimeout(awayTimer);
    if (!node) {
      // Salió del bloque: lo suelta ya, y si no entra a otro en un rato deja de figurar en ese lugar.
      clearTimeout(idleTimer); put(spot.block, false);
      awayTimer = setTimeout(() => put(null, false), 4000);
      return;
    }
    const block = core.live.blockId(node);
    // Un bloque nuevo que todavía no tiene líneas en la nota figura junto al bloque de arriba, sin tomarlo.
    if (node.classList.contains('lmd-draft') && !node._syn) typing = false;
    if (typing) { clearTimeout(idleTimer); idleTimer = setTimeout(() => put(spot.block, false), 5000); }
    put(block, !!block && (typing || (spot.editing && sameSpot(block))));
  }
  // El mismo bloque aunque le haya cambiado el texto: empieza en la misma línea.
  const sameSpot = (block) => !!spot.block && !!block && spot.block.split('.')[1] === block.split('.')[1];
  function put(block, editing) {
    spot = { block, editing };
    const what = block + '|' + editing;
    // Lo mismo que ya se avisó se repite solo para renovar "está escribiendo", cada tres segundos.
    if (what === sentWhat && !(editing && Date.now() - sentAt > 3000)) return;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(send, Math.max(0, 400 - (Date.now() - sentAt)));
  }
  async function send() {
    if (!active()) return;
    const want = spot; sentAt = Date.now(); sentWhat = want.block + '|' + want.editing;
    try {
      const r = await LMD.cloud.live.at(S.path, { block: want.block, editing: want.editing });
      // Otro lo pidió antes: queda marcado como suyo y acá ya no se sigue escribiendo en él.
      if (r && r.held && S) { const p = person(r.held); if (p && !p.editing) { p.editing = true; p.block = want.block; } spot.editing = false; sentWhat = want.block + '|false'; paintMarks(); }
    } catch (e) { sentWhat = ''; /* sin conexión o demasiado seguido: el próximo aviso lo corrige */ }
  }
  // Quién tiene tomado el bloque de ese nodo, o ''.
  function heldBy(node) {
    const h = node && node.closest ? node.closest('.lmd-live-held') : null;
    return h ? h.dataset.liveBy || '' : '';
  }

  // ---------- Lo que se ve ----------
  function paint() { paintChip(); paintBar(); paintMarks(); paintStrip(); }
  const avatar = (p) => { const a = el('span', { class: 'lmd-live-av' }); a.style.setProperty('--lmd-live', tint(p)); a.textContent = initials(p.name); a.title = p.name; return a; };
  // Una IA no lleva iniciales ni el logotipo de nadie: una chispa, con su nombre al pasar el cursor.
  const aiAvatar = (a) => { const n = el('span', { class: 'lmd-live-av lmd-here-ai' + (a.writing ? ' lmd-here-busy' : ''), role: 'img', 'aria-label': aiName(a), title: aiName(a) + (a.writing ? ' · ' + T('escribiendo') : '') }, ICON.spark); return n; };
  // Quiénes tienen abierta la nota ahora, personas e IA, en una tira de avatares junto a la nube. En una sesión en
  // vivo esa tira es la de la sesión (paintChip), con las IA sumadas. En una nota propia sin compartir no hay nadie
  // más: la tira aparece solo si hay una IA.
  function paintStrip() {
    if (!strip) return;
    const ai = (core.hereAi || []).slice(0, 6); const me = LMD.cloud.email();
    const mails = core.cloudPath && !core.noDoc && !LMD.cloud.guest() ? (core.present || []) : [];
    const people = mails.some((m) => m !== me) ? mails.map((m) => ({ name: (core.presentNames && core.presentNames[m]) || m.split('@')[0], color: hue(m), me: m === me })) : [];
    const list = people.map((p) => ({ p })).concat(ai.map((a) => ({ a })));
    strip.hidden = active() || !list.length || !core.cloudPath;
    strip.classList.remove('lmd-on');
    if (strip.hidden) { strip.textContent = ''; return; }
    strip.textContent = '';
    const row = el('span', { class: 'lmd-live-avs' });
    list.slice(0, 4).forEach((x) => row.appendChild(x.a ? aiAvatar(x.a) : avatar(x.p)));
    // Dos cuentas de "y tantos más": la de siempre y la de pantalla chica, donde entran dos avatares.
    if (list.length > 4) row.appendChild(el('span', { class: 'lmd-live-av lmd-live-more lmd-here-more-w', text: '+' + (list.length - 4) }));
    if (list.length > 2) row.appendChild(el('span', { class: 'lmd-live-av lmd-live-more lmd-here-more-s', text: '+' + (list.length - 2) }));
    strip.appendChild(row);
    const names = list.map((x) => (x.a ? aiName(x.a) : x.p.name + (x.p.me ? ' · ' + T('vos') : '')));
    const last = lastText();
    const tip = el('span', { class: 'lmd-here-tip', role: 'tooltip' });
    if (last) tip.appendChild(el('b', { text: last }));
    tip.appendChild(el('span', { text: names.join(', ') }));
    strip.appendChild(tip);
    strip.setAttribute('aria-label', T('En esta nota: {a}', { a: names.join(', ') }) + (last ? '. ' + last : ''));
  }
  // Arriba: que la nota está en vivo y quiénes están. Abre el cuadro de la sesión.
  function paintChip() {
    if (!chip) return;
    chip.hidden = !active();
    if (chip.hidden) return;
    const list = here();
    chip.textContent = '';
    chip.append(el('span', { class: 'lmd-live-dot' }), el('span', { class: 'lmd-live-word', text: T('En vivo') }));
    const row = el('span', { class: 'lmd-live-avs' });
    list.slice(0, 4).forEach((p) => row.appendChild(avatar(p)));
    if (list.length > 4) row.appendChild(el('span', { class: 'lmd-live-av lmd-live-more', text: '+' + (list.length - 4) }));
    // Las IA que están en la nota van al final de la misma tira.
    const ai = (core.hereAi || []).slice(0, 3); ai.forEach((a) => row.appendChild(aiAvatar(a)));
    chip.append(row, el('span', { class: 'lmd-live-n', text: String(list.length) }));
    // La última edición de una nota en vivo está en el cuadro de la sesión, que se abre desde acá.
    chip.title = T('Colaborar en vivo') + ' · ' + list.map((p) => p.name).concat(ai.map(aiName)).join(', ');
  }
  // Para el invitado, una barra bajo la de arriba: de quién es la sesión, cuánta gente hay, si se cortó, y cómo salir.
  function paintBar() {
    if (!S || S.role !== 'guest') { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar) {
      bar = el('div', { class: 'lmd-live-bar', role: 'status' });
      core.ui.main.querySelector('.lmd-topbar').after(bar);
      bar.addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (!b) return; if (b.dataset.lv === 'copy') core.live.download(); else if (b.dataset.lv === 'people') open(); else leave(); });
    }
    const n = here().length;
    // Sin conexión: se cortó la escucha, o un guardado no pudo salir.
    const down = !S.up || core.cloudState === 'error';
    const text = S.ended ? T(S.ended === 'kicked' ? 'Quien abrió la sesión te sacó.' : 'La sesión en vivo terminó.') + ' ' + T('Lo que escribiste sigue acá.')
      : down ? T('Sin conexión. Podés seguir escribiendo: se envía al volver.')
        : T('Sesión en vivo de {a}', { a: S.by }) + ' · ' + T(n === 1 ? '1 persona' : '{n} personas', { n });
    const cls = 'lmd-live-bar' + (S.ended ? ' lmd-live-over' : down ? ' lmd-live-down' : '');
    // Se vuelve a armar solo si cambió algo: un botón no se va de abajo del dedo.
    if (bar.className === cls && bar._text === text) return;
    bar.className = cls; bar._text = text;
    bar.textContent = '';
    const msg = el('span', { class: 'lmd-live-msg' }); msg.textContent = text;
    const btn = (key, label, fill) => el('button', { type: 'button', class: 'lmd-btn' + (fill ? ' lmd-btn-fill' : ''), 'data-lv': key, text: label });
    bar.append(el('span', { class: 'lmd-live-dot' }), msg, btn('copy', T(S.ended ? 'Descargar mi copia' : 'Descargar una copia'), !!S.ended), btn('leave', T(S.ended ? 'Abrir SharpMD' : 'Salir de la sesión')));
  }
  // Al margen de cada bloque, una marca del color de quien está ahí. El bloque que otro está escribiendo queda
  // tomado: dice "editando: Ana" y no se puede entrar a escribir en él hasta que lo suelte.
  const release = (block) => {
    block.classList.remove('lmd-live-held'); delete block.dataset.liveBy; block.style.removeProperty('--lmd-live');
    if (!block.getAttribute('style')) block.removeAttribute('style');
    [block].concat(Array.from(block.querySelectorAll('[data-live-lock]'))).forEach((n) => { if (n.dataset.liveLock) { delete n.dataset.liveLock; n.contentEditable = 'true'; } });
  };
  function hold(block, p) {
    const mine = core.live.typing();
    block.classList.add('lmd-live-held'); block.dataset.liveBy = p.name; block.style.setProperty('--lmd-live', tint(p));
    // Si el cursor ya estaba ahí no se lo saca (nunca se le quita el foco a nadie): lo frena el aviso al teclear.
    [block].concat(Array.from(block.querySelectorAll('[contenteditable="true"]'))).forEach((n) => {
      if (n.getAttribute('contenteditable') !== 'true' || n === mine || (mine && n.contains(mine))) return;
      n.contentEditable = 'false'; n.dataset.liveLock = '1';
    });
  }
  function paintMarks() {
    if (!layer) return;
    layer.textContent = '';
    core.ui.article.querySelectorAll('.lmd-live-held').forEach(release);
    if (!active()) return;
    for (const p of others()) {
      const block = p.block ? core.live.locate(p.block, p.id) : null;
      if (!block) continue;
      const mark = el('button', { type: 'button', class: 'lmd-live-mark' + (p.editing ? ' lmd-live-editing' : '') });
      mark.style.setProperty('--lmd-live', tint(p));
      mark.title = p.name; mark.setAttribute('aria-label', T(p.editing ? '{a} está escribiendo en este bloque' : '{a} está en este bloque', { a: p.name }));
      const tag = el('span', { class: 'lmd-live-tag' }); tag.textContent = p.editing ? T('editando: {a}', { a: p.name }) : p.name;
      mark.appendChild(tag); mark._block = block; mark.dataset.who = p.id;
      layer.appendChild(mark);
      if (p.editing) hold(block, p);
    }
    place();
  }
  function place() {
    if (!layer || !layer.children.length) return;
    const main = core.ui.main.getBoundingClientRect(); const art = core.ui.article.getBoundingClientRect();
    layer.hidden = !art.height; // en la vista de código no hay bloques que marcar
    const seen = new Map(); // varios en el mismo bloque: una marca al lado de la otra
    for (const m of layer.children) {
      if (!m._block.isConnected) { m.hidden = true; continue; }
      const r = m._block.getBoundingClientRect(); const k = seen.get(m._block) || 0; seen.set(m._block, k + 1);
      m.style.top = (r.top - main.top) + 'px'; m.style.height = Math.max(18, r.height) + 'px';
      m.style.left = Math.max(1, r.left - main.left - 13 - k * 7) + 'px';
    }
  }

  // ---------- Dos tocaron lo mismo ----------
  // La mezcla dejó lo que ya estaba guardado y lo de acá quedó afuera: se avisa, con un botón para copiarlo.
  let mineLost = [];
  function lost(list, by) {
    mineLost = mineLost.concat(list.map((x) => x.mine)).slice(-20);
    const p = person(by);
    if (notice) notice.remove();
    notice = el('div', { class: 'lmd-live-note', role: 'alert' });
    const msg = el('p'); msg.textContent = (p ? T('{a} cambió el mismo bloque a la vez.', { a: p.name }) : T('Otra persona cambió el mismo bloque a la vez.')) + ' ' + T('Quedó su versión. La tuya no se perdió.');
    const copy = el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', text: T('Copiar lo mío') });
    const shut = el('button', { type: 'button', class: 'lmd-live-x', title: T('Cerrar'), 'aria-label': T('Cerrar') }, ICON.close);
    copy.addEventListener('click', async () => {
      const text = mineLost.join('\n\n');
      try { await navigator.clipboard.writeText(text); } catch (e) { const ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      copy.textContent = T('Copiado');
    });
    shut.addEventListener('click', () => { notice.remove(); notice = null; mineLost = []; });
    notice.append(msg, copy, shut);
    document.body.appendChild(notice);
  }

  // ---------- El cuadro de la sesión ----------
  const peopleList = (ul, kick) => {
    ul.textContent = '';
    here().concat(S ? S.people.filter((p) => !p.here && p.id !== S.me) : []).forEach((p) => {
      const li = el('li'); const name = el('span', { class: 'lmd-live-name' });
      name.textContent = p.name + (p.id === S.me ? ' · ' + T('vos') : p.id === 'o' ? ' · ' + T('abrió la sesión') : p.member ? ' · ' + T('del equipo') : !p.here ? ' · ' + T('sin conexión') : '');
      li.append(avatar(p), name);
      // Se saca a un invitado. Un miembro del equipo no entró por el enlace.
      if (kick && /^g/.test(p.id)) li.appendChild(el('button', { type: 'button', 'data-kick': p.id, text: T('Sacar') }));
      ul.appendChild(li);
    });
  };
  function explainVault(team) {
    LMD.dialog.confirm({ title: T('Colaborar en vivo'), text: T(team ? 'En un espacio protegido con contraseña no hay sesiones en vivo: los invitados no tienen la llave.'
      // Con toda la nube protegida no hay otra carpeta a la que moverla.
      : LMD.vault.status().kind === 'all' ? 'Con toda la nube protegida con contraseña no hay sesiones en vivo: las notas viajan cifradas y el servidor no puede repartir los cambios.'
      : 'Las notas de una carpeta protegida viajan cifradas y el servidor no las puede leer, así que no puede repartir los cambios. Para colaborar en vivo, movela a otra carpeta.'), ok: T('Entendido'), cancel: T('Cerrar') });
  }
  async function open() {
    if (!core || !core.APP || !core.cloudPath) return;
    if (dlg) dlg.remove();
    const path = core.cloudPath; const guest = !!LMD.cloud.guest(); const team = !guest && LMD.cloud.isTeam(path);
    // En una nota del equipo, la sesión la maneja quien la abrió o quien administra. Los demás miembros la ven.
    const watch = () => guest || (!!S && !S.can);
    if (guest && !active()) return; // la sesión terminó: lo que queda por hacer está en la barra
    const box = dlg = el('div', { class: 'lmd-ask' });
    const title = T('Colaborar en vivo');
    box.innerHTML = '<div class="lmd-ask-card lmd-live-card" role="dialog" aria-label="' + title + '"><h3>' + title + '</h3><div class="lmd-live-body"></div>' +
      '<p class="lmd-dlg-err" role="alert" hidden></p><div class="lmd-ask-actions"></div></div>';
    document.body.appendChild(box);
    const body = box.querySelector('.lmd-live-body'); const acts = box.querySelector('.lmd-ask-actions'); const err = box.querySelector('.lmd-dlg-err');
    const shut = () => { box.remove(); if (dlg === box) dlg = null; };
    const fail = (e) => {
      if (e && e.code === 'live_needs_plan') { shut(); core.openPanel('plan', T('Colaborar en vivo es parte del plan pago.')); return; }
      if (e && e.code === 'live_vault') { shut(); explainVault(team); return; }
      err.hidden = false; err.textContent = say(e);
    };
    let link = guest ? '' : await linkGet(path); let changed = false;
    const k = await kept();
    const draw = () => {
      if (!box.isConnected) return;
      const typed = (body.querySelector('[data-lv=name]') || {}).value;
      if (!active()) {
        // Todavía no hay sesión: qué es, y con qué nombre la ven los demás.
        body.innerHTML = '<p>' + T(team ? 'Esta nota es del equipo. Quien tenga el enlace entra a editarla sin crear cuenta, junto a los miembros que la tengan abierta.'
          : 'Quien tenga el enlace entra a editar esta nota con vos, sin crear cuenta. Vos ves quién está y terminás la sesión cuando quieras.') + '</p>' +
          '<label class="lmd-dlg-field"><span>' + T('Tu nombre') + '</span><input type="text" data-lv="name" maxlength="40" spellcheck="false" autocomplete="nickname"></label>' +
          '<p class="lmd-hint">' + T('Los invitados ven este nombre, no tu correo.') + '</p>';
        body.querySelector('input').value = typed != null ? typed : ((LMD.sync.account() || {}).name) || k.name || '';
        acts.innerHTML = '<button type="button" class="lmd-btn" data-lv="close" data-esc>' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-lv="start">' + T('Abrir la sesión') + '</button>';
        return;
      }
      const lead = !team ? '' : '<p class="lmd-hint lmd-live-team"></p>';
      body.innerHTML = lead + (watch() ? '' : (link
        ? '<div class="lmd-field lmd-live-link"><span>' + T('Enlace') + '</span><input type="text" readonly aria-label="' + T('Enlace') + '"><button type="button" class="lmd-link" data-lv="copy">' + T('Copiar') + '</button></div>' +
          '<p class="lmd-hint">' + T(changed ? 'El enlace cambió: el anterior ya no sirve. Los que siguen adentro no necesitan el nuevo.' : 'Quien lo abre entra a editar esta nota, sin cuenta. Pasáselo solo a quien quieras que entre.') + '</p>'
        : '<p class="lmd-hint">' + T('El enlace se ve solo en el navegador donde se abrió la sesión. Acá podés crear uno nuevo: el anterior deja de servir.') + '</p>')) +
        '<h4>' + T(here().length === 1 ? '1 persona' : '{n} personas', { n: here().length }) + '</h4><ul class="lmd-live-people"></ul><p class="lmd-hint lmd-live-last"></p>';
      const lastP = body.querySelector('.lmd-live-last'); lastP.textContent = lastText(); lastP.hidden = !lastP.textContent;
      const input = body.querySelector('.lmd-live-link input'); if (input) input.value = link;
      const told = body.querySelector('.lmd-live-team');
      if (told) told.textContent = T(S.me === 'o' ? 'Nota del equipo. Los miembros editan desde su cuenta, sin el enlace.' : 'Nota del equipo, en vivo con invitados. La abrió {a}.', { a: S.by });
      peopleList(body.querySelector('ul'), !watch());
      acts.innerHTML = guest
        ? '<button type="button" class="lmd-btn" data-lv="leave">' + T('Salir de la sesión') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-lv="close" data-esc>' + T('Cerrar') + '</button>'
        : watch() ? '<button type="button" class="lmd-btn lmd-btn-fill" data-lv="close" data-esc>' + T('Cerrar') + '</button>'
        : '<button type="button" class="lmd-btn lmd-btn-danger" data-lv="end">' + T('Terminar la sesión') + '</button><button type="button" class="lmd-btn" data-lv="newlink">' + T('Crear un enlace nuevo') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-lv="close" data-esc>' + T('Cerrar') + '</button>';
    };
    box._draw = draw;
    draw();
    const first = body.querySelector('input'); if (first && !LMD.touch.coarse()) { first.focus(); first.select(); }
    box.addEventListener('focusin', (e) => { if (e.target.matches('input[readonly]')) e.target.select(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-lv=name]')) { e.preventDefault(); box.querySelector('[data-lv=start]').click(); } });
    box.addEventListener('click', async (e) => {
      if (e.target === box) { shut(); return; }
      const kick = e.target.closest('[data-kick]'); const b = e.target.closest('[data-lv]');
      if (!kick && !b) return;
      err.hidden = true;
      try {
        if (kick) {
          const p = person(kick.dataset.kick); if (!p) return;
          if (!(await LMD.dialog.confirm({ title: T('¿Sacar a {a}?', { a: p.name }), text: T('Deja de ver y de editar la nota en el acto. El enlace cambia, para que no vuelva a entrar con el mismo.'), ok: T('Sacar'), danger: true }))) return;
          const r = await LMD.cloud.live.kick(path, p.id);
          link = await linkPut(path, r.secret); changed = true; if (S) S.people = r.people ? named(r.people) : S.people;
          paint(); draw();
        } else if (b.dataset.lv === 'close') shut();
        else if (b.dataset.lv === 'leave') { shut(); leave(); }
        else if (b.dataset.lv === 'start') {
          const name = body.querySelector('[data-lv=name]').value.trim();
          if (!name) { fail({ code: 'bad_name' }); return; }
          b.disabled = true;
          let r;
          try { r = await LMD.cloud.live.open(path, name); } finally { b.disabled = false; }
          await keep({ name }); k.name = name;
          if (r.secret) link = await linkPut(path, r.secret);
          if (!S) start(path, r, 'owner'); else { S.people = r.people ? named(r.people) : S.people; paint(); }
          draw();
        } else if (b.dataset.lv === 'copy') {
          const input = body.querySelector('.lmd-live-link input'); input.select();
          try { await navigator.clipboard.writeText(input.value); } catch (ex) { document.execCommand('copy'); }
          b.textContent = T('Copiado'); setTimeout(() => { if (b.isConnected) b.textContent = T('Copiar'); }, 1500);
        } else if (b.dataset.lv === 'newlink') {
          if (link && !(await LMD.dialog.confirm({ title: T('¿Crear un enlace nuevo?'), text: T('El enlace anterior deja de servir. Quienes ya entraron siguen adentro.'), ok: T('Crear un enlace nuevo') }))) return;
          link = await linkPut(path, (await LMD.cloud.live.rotate(path)).secret); changed = true; draw();
        } else if (b.dataset.lv === 'end') {
          if (!(await LMD.dialog.confirm({ title: T('¿Terminar la sesión?'), text: T('Los invitados dejan de ver y de editar la nota en el acto, y el enlace deja de servir. La nota queda como está.'), ok: T('Terminar la sesión'), danger: true }))) return;
          await LMD.cloud.live.close(path); await linkPut(path, '');
          shut(); end('mine'); core.flash(T('Sesión en vivo terminada'));
        }
      } catch (ex) { fail(ex); }
    });
  }
  // Salir, para un invitado: primero sale lo que falte enviar. Vuelve al inicio de la app, ya sin la sesión.
  async function leave() {
    const over = !S || !!S.ended;
    if (!over) {
      let sent = false;
      try { sent = await core.live.flush(); } catch (e) { sent = false; }
      if (!sent && !(await LMD.dialog.confirm({ title: T('Hay cambios sin enviar'), text: T('Lo último que escribiste todavía no llegó a los demás. Si salís ahora se pierde: descargá una copia antes.'), ok: T('Salir igual'), danger: true }))) return;
    }
    try { await LMD.cloud.live.leave(); } catch (e) { /* igual se sale */ }
    location.href = core.appUrl;
  }

  function init(c) {
    core = c;
    if (!c.APP) return;
    chip = el('button', { type: 'button', class: 'lmd-live-chip lmd-doc-only', 'data-act': 'live', hidden: '' });
    c.ui.sync.after(chip);
    strip = el('button', { type: 'button', class: 'lmd-here lmd-doc-only', hidden: '' });
    chip.after(strip);
    // Con el dedo no hay "pasar por encima": el cuadrito sale al tocar, y se va al tocar afuera.
    // El cuadrito cuelga del borde derecho de la tira; si así se sale de la pantalla, se corre hasta entrar.
    const placeTip = () => {
      const t = strip.querySelector('.lmd-here-tip'); if (!t) return;
      t.style.left = ''; t.style.right = '';
      if (t.getBoundingClientRect().left < 8) { t.style.right = 'auto'; t.style.left = (8 - strip.getBoundingClientRect().left) + 'px'; }
    };
    strip.addEventListener('mouseenter', placeTip); strip.addEventListener('focus', placeTip);
    strip.addEventListener('click', (e) => { e.stopPropagation(); strip.classList.toggle('lmd-on'); placeTip(); });
    document.addEventListener('click', () => { if (strip) strip.classList.remove('lmd-on'); });
    layer = el('div', { class: 'lmd-live-layer' });
    c.ui.main.appendChild(layer);
    // Tocar una marca muestra de quién es (con el dedo no hay "pasar por encima").
    layer.addEventListener('click', (e) => { const m = e.target.closest('.lmd-live-mark'); if (!m) return; const on = !m.classList.contains('lmd-live-show'); layer.querySelectorAll('.lmd-live-show').forEach((n) => n.classList.remove('lmd-live-show')); m.classList.toggle('lmd-live-show', on); });
    c.hooks.render.push(paintMarks); c.hooks.patch.push(paintMarks); c.hooks.doc.push(paintStrip);
    window.addEventListener('resize', place);
    if (window.ResizeObserver) new ResizeObserver(place).observe(c.ui.article);
    LMD.cloud.onGuest((what) => {
      const g = LMD.cloud.guest(); if (!S || !g) return;
      // Volvió a entrar tras un corte largo: puede traer otro número y otro color.
      if (what === 'rejoined') { S.me = g.id; S.by = g.by; paint(); }
      if (what === 'ended') end(g.ended === 'full' ? 'full' : 'closed');
    });
  }

  LMD.live = { init, attach, detach, event, enter, open, at, heldBy, lost, active, explainVault, who,
    // Cambió quién está en la nota (personas o IA) o su último guardado.
    strip: () => { if (!core) return; if (active()) paintChip(); paintStrip(); if (dlg && dlg._draw && active()) dlg._draw(); },
    // Cambió el estado del guardado (con conexión, sin ella): la barra del invitado lo dice.
    state: () => { if (S && S.role === 'guest') paintBar(); },
    count: () => here().length,
    colorOf: (pid) => { const p = person(pid); return p ? tint(p) : ''; } };
})();
