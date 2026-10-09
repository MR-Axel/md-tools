// Herramienta: agentes. Una IA conectada por MCP anota cada agente que pone a trabajar (start_agent): un nombre que
// ella elige, su tarea en una línea y, si corresponde, la nota o la tarjeta del tablero. Acá se ven en vivo, en una
// sección de la barra lateral debajo de los archivos: quién trabaja, en qué, quién espera algo de la persona y quién
// dejó de dar señales. En un tablero, la tarjeta que tiene un agente activo lleva una marca junto a su campo agent.
// Los agentes viven en el servidor (tabla agents de server.mjs) y son temporales: acá no se guarda nada.
//   - La lista se pide al prender la herramienta, al cambiar de nota, al volver a la pestaña y cuando el servidor
//     avisa por el canal de la nota abierta (evento 'agents'). Con la sección a la vista, además, cada pocos segundos.
//   - Sin nube o sin cuenta no se pide nada: la sección dice qué falta.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ICON = {
    agents: svg('<circle cx="12" cy="6" r="2.500"/><circle cx="6.500" cy="17.500" r="2.500"/><circle cx="17.500" cy="17.500" r="2.500"/><path d="M12 8.500v3M6.500 15v-3.500h11V15"/>'),
  };
  // Cada cuánto se vuelve a pedir la lista con la sección a la vista: seguido si hay agentes, espaciado si no.
  const POLL_MS = 5000; const IDLE_MS = 15000; const CLOCK_MS = 20000;
  const LIVE = ['working', 'waiting', 'silent'];
  const LABEL = { working: 'Trabajando', waiting: 'Esperando', silent: 'Sin señal', done: 'Terminado', lost: 'Se perdió' };
  let core = null; let on = false; let wired = false;
  let box = null; let data = null; let why = ''; let skew = 0;
  let busy = false; let again = false; let timer = 0; let clock = 0; let past = false;
  const opt = (k, d) => LMD.tools.opt(k, d);
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }
  const shut = () => !!opt('agentsShut', false);
  const root = () => document.documentElement;

  // ---------- Los datos ----------
  const live = () => (data ? data.agents.filter((a) => LIVE.includes(a.status)) : []);
  // Hace cuánto, en corto. El reloj es el del servidor: skew lo corrige.
  function ago(at) {
    const s = Math.max(0, (Date.now() - skew - at) / 1000);
    if (s < 60) return T('recién');
    if (s < 3600) return T('hace {n} min', { n: Math.floor(s / 60) });
    if (s < 86400) return T('hace {n} h', { n: Math.floor(s / 3600) });
    return T('hace {n} d', { n: Math.floor(s / 86400) });
  }
  const since = (a) => (a.status === 'silent' ? a.seen : a.ended || a.created);
  const sinceTitle = (a) => T(a.status === 'silent' ? 'Última señal' : a.ended ? 'Terminó' : 'Empezó') + ': ' + new Date(since(a) + skew).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Dónde se usa: en la app, con la nube prendida y una cuenta que no sea la de un invitado.
  async function refresh() {
    if (!on || !core.APP) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      await LMD.cloud.ready();
      if (!LMD.cloud.enabled()) { why = 'off'; data = null; }
      else if (!LMD.cloud.signedIn() || LMD.cloud.guest()) { why = 'out'; data = null; }
      else { const r = await LMD.cloud.api('GET', '/agents'); data = r; skew = Date.now() - r.now; why = ''; }
    } catch (e) {
      // Sin conexión queda lo último que se supo. Un servidor propio sin actualizar no tiene la ruta.
      why = e && e.code === 'offline' ? 'offline' : e && e.status === 404 ? 'old' : e && e.status === 401 ? 'out' : 'error';
      if (why === 'old' || why === 'out') data = null;
    }
    busy = false;
    if (!on) return;
    paint(); mark(); plan();
    if (again) { again = false; refresh(); }
  }
  // La sección se ve: la barra lateral está abierta, la sección desplegada y la pestaña al frente.
  function seen() {
    if (!box || !box.isConnected || shut() || document.visibilityState !== 'visible') return false;
    if (root().classList.contains('lmd-side-hidden')) return false;
    return getComputedStyle(core.ui.sidebar).visibility !== 'hidden';
  }
  function plan() {
    clearTimeout(timer); timer = 0;
    if (!on || !seen() || why === 'off' || why === 'out' || why === 'old') return;
    timer = setTimeout(refresh, live().length ? POLL_MS : IDLE_MS);
  }

  // ---------- La sección de la barra lateral ----------
  const fileOf = (p) => p.split('/').pop().replace(/\.(md|mdx|markdown|txt)$/i, '');
  function row(a, kids) {
    const st = LABEL[a.status] || a.status; const via = [a.client, a.token].filter(Boolean).join(' · ');
    return '<li class="lmd-ag-row" data-ag="' + esc(a.id) + '" data-status="' + esc(a.status) + '">' +
      '<div class="lmd-ag-item"><i class="lmd-ag-dot" aria-hidden="true"></i><div class="lmd-ag-main">' +
        '<div class="lmd-ag-top"><b class="lmd-ag-name"' + (via ? ' title="' + esc(via) + '"' : '') + '>' + esc(a.name) + '</b>' + (a.team ? '<span class="lmd-ag-tag">' + esc(T('Equipo')) + '</span>' : '') +
          '<span class="lmd-ag-when"><span class="lmd-ag-st">' + esc(T(st)) + '</span> · <time data-ag-at="' + since(a) + '" title="' + esc(sinceTitle(a)) + '">' + esc(ago(since(a))) + '</time></span></div>' +
        (a.task ? '<p class="lmd-ag-task">' + esc(a.task) + '</p>' : '') +
        (a.status === 'waiting' && a.needs ? '<p class="lmd-ag-needs"><span>' + esc(T('Necesita')) + ':</span> ' + esc(a.needs) + '</p>' : '') +
        (a.result ? '<p class="lmd-ag-result">' + esc(a.result) + '</p>' : '') +
        (a.path ? '<button type="button" class="lmd-ag-link" data-ag-open="' + esc(a.path) + '"' + (a.card ? ' data-ag-card="' + esc(a.card) + '"' : '') + ' title="' + esc(a.path.replace(/^~\d+\//, '')) + '">' + LMD.kit.ICON[a.card ? 'b_board' : 'file'] + '<span>' + esc(fileOf(a.path)) + (a.card ? ' · ' + esc(T('tarjeta')) : '') + '</span></button>' : '') +
      '</div></div>' +
      (kids && kids.length ? '<ul class="lmd-ag-kids" role="list">' + kids.join('') + '</ul>' : '') + '</li>';
  }
  // Los subagentes van debajo de su padre. Uno cuyo padre ya no está en la lista queda suelto.
  function tree(list) {
    const ids = new Set(list.map((a) => a.id)); const under = new Map();
    list.forEach((a) => { if (a.parent && ids.has(a.parent) && a.parent !== a.id) { if (!under.has(a.parent)) under.set(a.parent, []); under.get(a.parent).push(a); } });
    const draw = (a, depth) => row(a, depth < 6 ? (under.get(a.id) || []).map((k) => draw(k, depth + 1)) : []);
    return list.filter((a) => !(a.parent && ids.has(a.parent) && a.parent !== a.id)).map((a) => draw(a, 0)).join('');
  }
  const EMPTY = {
    off: ['La nube está apagada: sin ella no hay agentes para mostrar.'],
    out: ['Entrá a tu cuenta para ver tus agentes.', 'cloud', 'Entrar'],
    old: ['Este servidor todavía no muestra agentes.'],
    offline: ['Sin conexión.'],
    error: ['No se pudo leer la lista de agentes.'],
    '': ['Conectá tu IA y pedile que registre sus agentes. Aparecen acá mientras trabajan.', 'ai', 'Conectar una IA'],
  };
  function build() {
    const side = core.ui.sidebar; const before = side.querySelector('.lmd-update');
    box = el('section', { class: 'lmd-ag', 'aria-label': T('Agentes') });
    box.innerHTML = '<div class="lmd-zone-head lmd-ag-head"><button type="button" class="lmd-zone-tog" data-ag-tog aria-controls="lmd-ag-body"><span class="lmd-node-chev">' + LMD.kit.ICON.chevron + '</span><span>' + esc(T('Agentes')) + '</span><span class="lmd-ag-n" hidden></span></button>' +
      '<button type="button" class="lmd-zone-btn lmd-ag-past" data-ag-past aria-pressed="false" hidden>' + LMD.kit.ICON.clock + '</button></div>' +
      '<div class="lmd-ag-body" id="lmd-ag-body" aria-live="polite"></div>';
    if (before) side.insertBefore(box, before); else side.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-ag-tog]')) { keep({ agentsShut: !shut() }); paint(); if (!shut()) refresh(); else plan(); return; }
      if (e.target.closest('[data-ag-past]')) { past = !past; paint(); return; }
      const go = e.target.closest('[data-ag-go]'); if (go) { core.openPanel(go.dataset.agGo); return; }
      const link = e.target.closest('[data-ag-open]'); if (link) openAt(link.dataset.agOpen, link.dataset.agCard || '');
    });
  }
  function paint() {
    if (!core) return;
    if (!on || !core.APP) { if (box) { box.remove(); box = null; } return; }
    if (!box || !box.isConnected) build();
    const isShut = shut(); const list = data ? data.agents : []; const now = live();
    box.classList.toggle('lmd-shut', isShut);
    box.querySelector('[data-ag-tog]').setAttribute('aria-expanded', String(!isShut));
    const n = box.querySelector('.lmd-ag-n');
    n.hidden = !now.length; n.textContent = now.length ? String(now.length) : '';
    n.dataset.status = now.some((a) => a.status === 'waiting') ? 'waiting' : now.some((a) => a.status === 'working') ? 'working' : 'silent';
    n.title = now.length ? T(now.length === 1 ? '1 agente activo' : '{n} agentes activos', { n: now.length }) : '';
    const hist = (data && data.history) || []; const hours = (data && data.history_hours) || 24;
    const pb = box.querySelector('[data-ag-past]');
    pb.hidden = !hist.length || isShut; if (!hist.length) past = false;
    pb.title = T('Últimas {n} horas', { n: hours }); pb.setAttribute('aria-label', pb.title); pb.setAttribute('aria-pressed', String(past)); pb.classList.toggle('lmd-on', past);
    const body = box.querySelector('.lmd-ag-body'); body.hidden = isShut;
    if (isShut) return;
    let html = '';
    if (list.length) html += '<ul class="lmd-ag-list" role="list">' + tree(list) + '</ul>';
    else { const e = EMPTY[why] || EMPTY['']; html += '<p class="lmd-ag-empty">' + esc(T(e[0])) + (e[1] ? ' <button type="button" class="lmd-link" data-ag-go="' + e[1] + '">' + esc(T(e[2])) + '</button>' : '') + '</p>'; }
    if (list.length && (why === 'offline' || why === 'error')) html += '<p class="lmd-ag-note">' + esc(T(EMPTY[why][0])) + '</p>';
    // El tope del plan gratis se dice recién cuando se llegó a él.
    if (data && data.limit && now.filter((a) => a.status !== 'silent').length >= data.limit) html += '<p class="lmd-ag-note">' + esc(T('Plan gratis: hasta {n} agentes a la vez.', { n: data.limit })) + ' <button type="button" class="lmd-link" data-ag-go="plan">' + esc(T('Ver planes')) + '</button></p>';
    if (past && hist.length) html += '<h5 class="lmd-ag-h">' + esc(T('Últimas {n} horas', { n: hours })) + '</h5><ul class="lmd-ag-list lmd-ag-old" role="list">' + hist.map((a) => row(a)).join('') + '</ul>';
    // Si nada cambió no se toca: el foco y lo que se está leyendo quedan como estaban.
    if (body._html !== html) { body._html = html; body.innerHTML = html; }
  }
  // Los "hace cuánto" corren solos entre un pedido y otro.
  function tick() { if (box && seen()) box.querySelectorAll('time[data-ag-at]').forEach((t) => { const s = ago(+t.dataset.agAt); if (t.textContent !== s) t.textContent = s; }); }

  // ---------- Ir a la nota o a la tarjeta ----------
  async function openAt(path, card) {
    const url = core.urlOf(path);
    // En pantalla chica la barra lateral tapa la nota: se cierra para que se vea adónde se llegó.
    if (root().classList.contains('lmd-side-open') && core.ui.scrim) core.ui.scrim.click();
    if (core.HERE !== url) { try { await core.open(url); } catch (e) { return; } }
    if (!card) return;
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) { hit = Array.from(core.ui.article.querySelectorAll('.lmd-card')).find((c) => c.dataset.id === card) || null; if (!hit) await new Promise((r) => setTimeout(r, 75)); }
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'center' });
    hit.classList.add('lmd-ag-flash'); setTimeout(() => hit.classList.remove('lmd-ag-flash'), 1800);
    try { hit.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ }
  }
  // Abre la barra lateral si hace falta, despliega la sección y la deja a la vista.
  function reveal() {
    if (!on || !core.APP) return;
    paint();
    const hidden = root().classList.contains('lmd-side-hidden') || getComputedStyle(core.ui.sidebar).visibility === 'hidden';
    if (hidden) { const b = core.ui.main.querySelector('[data-act=sidebar]'); if (b) b.click(); }
    if (shut()) { keep({ agentsShut: false }); paint(); }
    refresh();
    setTimeout(() => { if (!box) return; box.scrollIntoView({ block: 'nearest' }); const b = box.querySelector('[data-ag-tog]'); if (b) b.focus({ preventScroll: true }); }, hidden ? 240 : 0);
  }

  // ---------- En el tablero: la tarjeta que tiene un agente activo ----------
  const names = (v) => String(v == null ? '' : v).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  function mark() {
    if (!core || !core.ui.article) return;
    core.ui.article.querySelectorAll('.lmd-ag-live').forEach((n) => { if (n.classList.contains('lmd-ag-chip')) n.remove(); else { n.classList.remove('lmd-ag-live'); n.removeAttribute('data-status'); const d = n.querySelector('.lmd-ag-pulse'); if (d) d.remove(); } });
    const now = on && core.appRoot && core.appRoot.kind === 'cloud' ? live().filter((a) => a.path === core.cloudPath) : [];
    if (!now.length) return;
    core.ui.article.querySelectorAll('.lmd-board').forEach((board) => {
      const cols = board._cols || [];
      board.querySelectorAll('.lmd-card').forEach((item) => {
        const col = item.closest('.lmd-col'); const model = col && cols[+col.dataset.c] ? cols[+col.dataset.c].cards[+item.dataset.k] : null;
        const mine = names(model && model.attrs && model.attrs.agent);
        // Por el id de la tarjeta; o, si el agente no dijo cuál es la suya, por su nombre en el campo agent.
        const a = now.find((x) => x.card && x.card === item.dataset.id) || now.find((x) => !x.card && mine.includes(x.name.toLowerCase()));
        if (!a) return;
        const title = a.name + ': ' + T(LABEL[a.status]);
        let chip = item.querySelector('.lmd-card-meta [data-attr="agent"]');
        if (!chip) {
          let meta = item.querySelector('.lmd-card-meta');
          if (!meta) { meta = el('div', { class: 'lmd-card-meta' }); (item.querySelector('.lmd-card-main') || item).appendChild(meta); }
          chip = el('span', { class: 'lmd-chip lmd-ag-chip', 'data-attr': 'agent', text: a.name }); meta.appendChild(chip);
        }
        chip.classList.add('lmd-ag-live'); chip.dataset.status = a.status; chip.title = title;
        chip.insertBefore(el('i', { class: 'lmd-ag-pulse', role: 'img', 'aria-label': T('En vivo') }), chip.firstChild);
      });
    });
  }

  // ---------- Encendido ----------
  function onBack() { if (on && document.visibilityState === 'visible') refresh(); }
  function enable(c) {
    core = c; on = true; paint(); refresh();
    clearInterval(clock); clock = setInterval(tick, CLOCK_MS);
    if (wired) return;
    wired = true;
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    window.addEventListener('lmd-session-changed', () => { if (on) refresh(); });
    // El servidor avisa por la nota abierta que algo cambió en los agentes de la cuenta.
    core.hooks.event.push((ev) => { if (on && ev && ev.type === 'agents') refresh(); });
    core.hooks.doc.push(() => { if (on) refresh(); });
    core.hooks.render.push(() => { if (on) mark(); });
    core.hooks.patch.push(() => { if (on) mark(); });
    // La barra lateral se abrió o se cerró: el sondeo arranca o para.
    let was = seen();
    new MutationObserver(() => { const now = on && seen(); if (now && !was) refresh(); else if (!now) plan(); was = now; }).observe(root(), { attributes: true, attributeFilter: ['class'] });
    core.actions.agents = () => reveal();
    // En pantalla chica la barra lateral está detrás de un botón: los agentes también van en "más".
    core.menus.more.push(() => (on && core.APP && LMD.touch.small() ? ['agents', ICON.agents, 'Agentes'] : null));
  }
  function disable() {
    on = false; clearTimeout(timer); timer = 0; clearInterval(clock); clock = 0; data = null; why = '';
    if (core) { paint(); mark(); }
  }
  // Lo que le falta para andar, dicho en la tarjeta de Ajustes > Herramientas.
  async function needs() {
    try { await LMD.cloud.ready(); } catch (e) { return ''; }
    if (!LMD.cloud.enabled()) return 'La nube está apagada';
    return LMD.cloud.signedIn() && !LMD.cloud.guest() ? '' : 'Falta entrar a tu cuenta';
  }
  async function settings(area, api) {
    if (!core.APP) { area.innerHTML = '<p class="lmd-tl-why">' + esc(T('Los agentes se ven desde la app.')) + '</p>'; return; }
    const miss = await needs(); if (!miss) await refresh();
    if (!area.isConnected) return;
    const line = miss === 'La nube está apagada' ? T(EMPTY.off[0]) : miss ? T(EMPTY.out[0]) : why === 'old' ? T(EMPTY.old[0]) : '';
    const planLine = !data ? '' : data.limit ? T('Plan gratis: hasta {n} agentes a la vez, sin historial.', { n: data.limit }) : T('Plan pago: sin tope de agentes, con el historial de las últimas {n} horas.', { n: data.history_hours });
    area.innerHTML = '<p class="lmd-tl-why">' + esc(T('Tu IA anota cada agente con un nombre y su tarea. Se ven en la barra lateral, debajo de los archivos, y se van solos al terminar.')) + '</p>' +
      (line ? '<div class="lmd-row lmd-row-line"><span data-ag-set="miss">' + esc(line) + '</span>' + (miss === 'Falta entrar a tu cuenta' ? '<button type="button" class="lmd-btn" data-ag-set="cloud">' + esc(T('Entrar')) + '</button>' : '') + '</div>' : '') +
      (planLine ? '<p class="lmd-tl-why" data-ag-set="plan">' + esc(planLine) + '</p>' : '') +
      (line ? '' : '<div class="lmd-row lmd-row-line"><span>' + esc(T('La IA se conecta por MCP, con un token de tu cuenta.')) + '</span><button type="button" class="lmd-btn" data-ag-set="ai">' + esc(T('Conectar una IA')) + '</button></div>' +
        '<div class="lmd-row lmd-row-line"><span data-ag-set="count">' + esc(live().length ? T(live().length === 1 ? '1 agente activo' : '{n} agentes activos', { n: live().length }) : T('Ahora no hay agentes trabajando.')) + '</span><button type="button" class="lmd-btn" data-ag-set="show">' + esc(T('Ver los agentes')) + '</button></div>');
    area.querySelectorAll('button[data-ag-set]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.agSet;
      if (k === 'show') { api.close(); reveal(); } else core.openPanel(k);
    }));
  }

  LMD.agents = { enable, disable, settings, needs, refresh, reveal, ICON,
    // Para las pruebas: lo último que se supo y si la sección se está sondeando.
    state: () => ({ on, why, polling: !!timer, agents: data ? data.agents : [], history: data ? data.history : null, limit: data ? data.limit : undefined }) };
})();
