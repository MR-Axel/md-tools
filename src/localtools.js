// Herramientas locales: servidores, worktrees y sesiones de agentes de la computadora donde se programa, y "Mostrar en
// el Explorador". Los datos los da un programa chico que corre en esa computadora (la carpeta local/ del repositorio)
// y que escucha solo en 127.0.0.1. Desde acá se le habla directo, de la página a la máquina: nada de esto pasa por la
// nube ni se guarda.
//   - El emparejamiento (puerto y token) queda en este navegador (localStorage) y no viaja con las preferencias.
//   - Prendida y sin mirar, una herramienta no pide nada: el programa se consulta al abrir su detalle o su lista.
//   - Lo que llega de la máquina (títulos de páginas, líneas de comando, nombres de ramas) se escribe siempre escapado.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  // El nombre del programa, su comando y la clave del emparejamiento están en tools.js (LMD.tools.local).
  const { NAME, CMD, KEY } = LMD.tools.local;
  // La página que dice cómo instalarlo.
  const install = () => 'https://sharpmd.app/' + (LMD.lang() === 'es' ? 'es/' : '') + 'local-tools.html';
  const EVERY = 6000; // con la lista abierta se relee sola
  const TOOL = { servers: 'localservers', worktrees: 'localworktrees', agents: 'localagents' };
  let core = null; const on = {};

  // ---------- El emparejamiento ----------
  function pairing() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY) || 'null');
      return p && Number.isInteger(p.port) && typeof p.token === 'string' ? p : null;
    } catch (e) { return null; }
  }
  // El código que muestra el programa: "<puerto>.<token>".
  function parseCode(text) {
    const m = String(text || '').trim().match(/^(\d{4,5})\.([A-Za-z0-9_-]{20,200})$/);
    const port = m ? Number(m[1]) : 0;
    return m && port >= 1024 && port <= 65535 ? { port, token: m[2] } : null;
  }
  function keep(p) {
    try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch (e) { return false; }
    // Emparejado o no cambia qué se ofrece: "Mostrar en el Explorador" y el aviso de las tres filas.
    LMD.tools.localHook();
    Object.keys(TOOL).forEach((id) => LMD.tools.need(TOOL[id], p ? '' : 'Falta emparejar'));
    return true;
  }

  // ---------- Hablarle al programa ----------
  // Siempre a 127.0.0.1 y con el token en Authorization. Devuelve { ok, data } o { ok: false, why }:
  //   'unpaired'  falta emparejar        'token'  el código ya no vale
  //   'offline'   no contesta: no corre, el navegador no dio permiso o no deja (Safari)
  async function call(path, body, with_) {
    const p = with_ || pairing(); if (!p) return { ok: false, why: 'unpaired' };
    let res;
    try {
      res = await fetch('http://127.0.0.1:' + p.port + '/v1/' + path, {
        method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: Object.assign({ Authorization: 'Bearer ' + p.token }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { return { ok: false, why: 'offline' }; }
    if (res.status === 401) return { ok: false, why: 'token' };
    let data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data) return { ok: false, why: 'error', status: res.status, data };
    return { ok: true, data };
  }
  // Qué dijo el navegador sobre conectarse con esta computadora: 'denied', 'prompt' (todavía no preguntó), o ''.
  async function permission() {
    for (const name of ['loopback-network', 'local-network-access']) {
      try { const st = await navigator.permissions.query({ name }); return st.state === 'granted' ? '' : st.state; } catch (e) { /* este navegador no lo conoce por ese nombre */ }
    }
    return '';
  }
  const WHY = {
    denied: 'El navegador tiene bloqueada la conexión con esta computadora. Se cambia en los permisos del sitio.',
    prompt: 'El navegador va a preguntar si este sitio puede conectarse con esta computadora. Hay que permitirlo.',
    '': '{a} no contesta. Arrancalo en esta computadora.',
  };

  const ago = (iso) => {
    const ms = Date.now() - Date.parse(iso); if (!iso || isNaN(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return T('recién'); if (min < 60) return T('hace {n} min', { n: min });
    if (min < 1440) return T('hace {n} h', { n: Math.round(min / 60) }); return T('hace {n} d', { n: Math.round(min / 1440) });
  };
  const tag = (text, cls) => '<span class="lmd-lt-tag' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>';
  const join = (list) => list.filter(Boolean).join(' · ');
  const row = (key, title, lines, button) => '<div class="lmd-lt-row"><span class="lmd-lt-key">' + esc(key) + '</span><div class="lmd-lt-what"><b>' + esc(title) + '</b>' +
    lines.filter(Boolean).map((l) => '<p>' + l + '</p>').join('') + '</div>' + (button || '') + '</div>';
  const closeBtn = (data) => '<button type="button" class="lmd-btn lmd-lt-close" data-lt-close="' + esc(JSON.stringify(data)) + '">' + esc(T('Cerrar')) + '</button>';
  const count = (n, one, many) => T(n === 1 ? one : many, { n });
  const addFolder = () => '<p class="lmd-lt-empty">' + esc(T('Todavía no elegiste carpetas. Se suman desde la consola, en la computadora:')) + '</p><p><code>' + esc(CMD) + ' folders add &lt;' + esc(T('carpeta')) + '&gt;</code></p>';

  // ---------- Las tres vistas ----------
  // Cada una: qué pide, su resumen de una línea para el detalle, cómo dibuja su lista y qué pregunta antes de cerrar algo.
  const VIEWS = {
    servers: {
      path: 'servers', closePath: 'servers/close', title: 'Servidores locales', open: 'Ver los servidores',
      lead: 'Lo que está escuchando en esta computadora. Solo se puede cerrar lo que se lanzó desde una carpeta de proyecto.',
      sum: (d) => { const dev = d.servers.filter((s) => s.kind === 'dev').length; return count(dev, '1 servidor de desarrollo', '{n} servidores de desarrollo') + ' · ' + count(d.servers.length, '1 puerto en total', '{n} puertos en total'); },
      ask: (d) => ({ title: T('¿Cerrar este servidor?'), text: T('{a}, en el puerto {n}. Se pierde lo que estaba haciendo.', { a: d.name, n: d.port }) }),
      draw(d) {
        const one = (s) => row(':' + s.port, s.project || (s.http && s.http.title) || s.process, [
          esc(join([s.package && s.package !== s.project ? s.package : '', s.version ? 'v' + s.version : '', s.stack, s.http && s.http.title && s.project ? '“' + s.http.title + '”' : '', s.http && s.http.server])),
          (s.self ? tag(T('este programa')) : '') + tag(T(s.exposed ? 'abierto a la red' : 'solo esta computadora'), s.exposed ? 'lmd-lt-warn' : '') + (s.launchedBy ? tag(T('lanzado por {a}', { a: s.launchedBy })) : '') +
            esc(join([s.process, 'PID ' + s.pid, s.memoryMB ? s.memoryMB + ' MB' : '', ago(s.started)])),
          s.command ? '<code>' + esc(s.command) + '</code>' : '',
        ], s.closable ? closeBtn({ pid: s.pid, port: s.port, started: s.started, name: s.project || s.process }) : '');
        const dev = d.servers.filter((s) => s.kind === 'dev');
        const rest = [['app', 'Otros programas'], ['system', 'Sistema']].map(([kind, name]) => {
          const list = d.servers.filter((s) => s.kind === kind);
          return list.length ? '<details class="lmd-lt-more"><summary>' + esc(T(name)) + ' (' + list.length + ')</summary>' + list.map(one).join('') + '</details>' : '';
        }).join('');
        return '<h5>' + esc(T('Desarrollo')) + '</h5>' + (dev.length ? dev.map(one).join('') : '<p class="lmd-lt-empty">' + esc(T('No hay nada escuchando desde una carpeta de proyecto.')) + '</p>') +
          (d.cwd ? '' : '<p class="lmd-lt-empty">' + esc(T('El programa no pudo leer la carpeta de los procesos: no sabe de qué proyecto son.')) + '</p>') + rest;
      },
    },
    worktrees: {
      path: 'worktrees', title: 'Worktrees', open: 'Ver los worktrees',
      lead: 'Los worktrees de los repositorios que elegiste. Acá solo se miran: no se borra ni se cambia nada.',
      sum: (d) => { const n = d.repos.reduce((t, r) => t + r.worktrees.length, 0); return !d.folders ? T('Todavía no elegiste carpetas.') : count(n, '1 worktree', '{n} worktrees') + ' · ' + count(d.repos.length, '1 repositorio', '{n} repositorios'); },
      draw(d) {
        if (!d.folders) return addFolder();
        if (!d.repos.length) return '<p class="lmd-lt-empty">' + esc(T('No hay repositorios en esas carpetas.')) + '</p>';
        return d.repos.map((r) => '<h5>' + esc(r.name) + '</h5>' + r.worktrees.map((w) => row(w.branch || T('sin rama'), w.main ? T('principal') : w.name, [
          esc(join([w.commit, w.subject])),
          tag(w.missing ? T('falta la carpeta') : (w.changes ? count(w.changes, '1 cambio sin confirmar', '{n} cambios sin confirmar') : T('sin cambios')), w.changes || w.missing ? 'lmd-lt-warn' : '') +
            (w.locked ? tag(T('bloqueado')) : '') + w.busy.map((b) => tag(b.name + (b.count > 1 ? ' ×' + b.count : ''), b.agent ? 'lmd-lt-on' : '')).join('') +
            esc(w.lastEdit ? T('editado {a}', { a: ago(w.lastEdit) }) : ''),
          '<code>' + esc(w.path) + '</code>',
        ])).join('')).join('');
      },
    },
    agents: {
      path: 'agents', closePath: 'agents/close', title: 'Sesiones locales', open: 'Ver las sesiones',
      lead: 'Las sesiones de agentes de IA abiertas en esta computadora. La memoria es la de la sesión más la de lo que lanzó.',
      sum: (d) => { const all = d.agents.reduce((t, g) => t.concat(g.sessions), []); return all.length ? count(all.length, '1 sesión abierta', '{n} sesiones abiertas') + ' · ' + all.reduce((t, s) => t + s.memoryMB + s.childrenMB, 0) + ' MB' : T('No hay sesiones de agentes abiertas.'); },
      ask: (d) => ({ title: T('¿Cerrar esta sesión?'), text: T('{a}. Se pierde lo que estaba haciendo.', { a: d.name }) }),
      draw(d) {
        const html = d.agents.map((g) => '<h5>' + esc(g.name) + '</h5>' + g.sessions.map((s) => row((s.memoryMB + s.childrenMB) + ' MB', s.title || T('Sesión sin título'), [
          (s.active === null ? '' : tag(T(s.active ? 'trabajando' : 'en espera'), s.active ? 'lmd-lt-on' : '')) +
            esc(join([s.project, 'PID ' + s.pid, s.memoryMB + ' + ' + s.childrenMB + ' MB', s.started ? T('abierta {a}', { a: ago(s.started) }) : '', s.lastActivity ? T('última actividad {a}', { a: ago(s.lastActivity) }) : ''])),
        ], s.closable ? closeBtn({ pid: s.pid, started: s.started, name: s.title || g.name }) : '')).join('') +
          (g.otherProcs ? '<p class="lmd-lt-empty">' + esc(T('Otros procesos de la app: {a} · {n} MB', { a: g.otherProcs, n: g.otherMB })) + '</p>' : '')).join('');
        return html || '<p class="lmd-lt-empty">' + esc(T('No hay sesiones de agentes abiertas.')) + '</p>';
      },
    },
  };

  // ---------- La lista, en un diálogo ----------
  // Se abre desde el detalle de la herramienta. Una sola a la vez. Mientras está abierta se relee sola.
  let dlg = null;
  function shut() {
    if (!dlg) return;
    const d = dlg; dlg = null; clearTimeout(d.timer); d.box.remove();
  }
  function open(id) {
    const view = VIEWS[id]; if (!view || !on[id] || !pairing()) return false;
    shut();
    const box = el('div', { class: 'lmd-ask lmd-lt' });
    box.innerHTML = '<div class="lmd-ask-card lmd-lt-card" role="dialog" aria-modal="true" aria-label="' + esc(T(view.title)) + '" data-lt-view="' + id + '">' +
      '<div class="lmd-lt-head"><h3>' + esc(T(view.title)) + '</h3><span class="lmd-lt-note" role="status"></span>' +
        '<button type="button" class="lmd-btn" data-lt="retry">' + esc(T('Actualizar')) + '</button>' +
        '<button type="button" class="lmd-icon-btn" data-lt="x" data-esc title="' + esc(T('Cerrar')) + '" aria-label="' + esc(T('Cerrar')) + '">' + LMD.kit.ICON.close + '</button></div>' +
      '<div class="lmd-lt-body"><p class="lmd-hint">' + esc(T(view.lead)) + '</p><div class="lmd-lt-list" aria-live="polite"></div></div></div>';
    document.body.appendChild(box);
    const d = dlg = { id, box, timer: 0, seq: 0, busy: false };
    const list = box.querySelector('.lmd-lt-list'); const say = box.querySelector('.lmd-lt-note');
    const alive = () => dlg === d && box.isConnected;
    const again = () => { clearTimeout(d.timer); d.timer = setTimeout(() => { if (!alive()) return; if (document.hidden || d.busy) again(); else load(true); }, EVERY); };
    // quiet: una relectura sola, que no borra lo que se ve si falla una vez ni mueve el foco.
    async function load(quiet) {
      clearTimeout(d.timer); const mine = ++d.seq;
      if (!quiet) say.textContent = T('Leyendo…');
      const r = await call(view.path); if (!alive() || mine !== d.seq) return;
      if (!r.ok) {
        if (r.why === 'token' || r.why === 'unpaired') { if (r.why === 'token') keep(null); shut(); return; }
        const perm = r.why === 'offline' ? await permission() : ''; if (!alive()) return;
        say.textContent = T(WHY[perm] || WHY[''], { a: NAME });
        if (!quiet || !list.firstChild) list.innerHTML = '';
        again(); return;
      }
      // Lo que estaba desplegado y dónde estaba el foco se conservan entre relecturas.
      const opened = Array.from(list.querySelectorAll('details.lmd-lt-more')).map((n) => n.open);
      const focus = list.contains(document.activeElement) ? document.activeElement.getAttribute('data-lt-close') : null;
      const html = view.draw(r.data);
      if (list._html !== html) {
        list._html = html; list.innerHTML = html;
        list.querySelectorAll('details.lmd-lt-more').forEach((n, i) => { n.open = !!opened[i]; });
        if (focus) { const b = Array.from(list.querySelectorAll('[data-lt-close]')).find((n) => n.getAttribute('data-lt-close') === focus); if (b) b.focus({ preventScroll: true }); }
      }
      if (!quiet) say.textContent = '';
      again();
    }
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con la lista abierta
      if (e.key === 'Escape') { e.preventDefault(); shut(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) shut(); });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lt], [data-lt-close]'); if (!b) return;
      if (b.dataset.lt === 'x') { shut(); return; }
      if (b.dataset.lt === 'retry') { load(false); return; }
      let item; try { item = JSON.parse(b.dataset.ltClose); } catch (x) { return; }
      d.busy = true;
      const q = view.ask(item);
      const yes = await LMD.dialog.confirm({ title: q.title, text: q.text, ok: T('Cerrar'), danger: true });
      if (!yes || !alive()) { d.busy = false; return; }
      b.disabled = true; say.textContent = T('Cerrando…');
      const r = await call(view.closePath, { pid: item.pid, port: item.port, started: item.started });
      d.busy = false; if (!alive()) return;
      await load(true); if (!alive()) return;
      say.textContent = r.ok && r.data.ok ? T('Cerrado.') : (r.ok ? T('Sigue corriendo.') : T('No se pudo cerrar: ya no estaba o cambió.'));
    });
    load(false);
    box.querySelector('[data-lt=x]').focus({ preventScroll: true });
    return true;
  }

  // ---------- El detalle de cada herramienta, en Ajustes > Herramientas ----------
  // Sin emparejar: qué es, cómo se instala y el campo del código. Emparejada: un resumen y el botón que abre la lista.
  function settings(id, area, api) {
    const view = VIEWS[id]; let seq = 0;
    const alive = () => area.isConnected;

    function unpaired(note) {
      area.innerHTML = '<p class="lmd-tl-why">' + esc(T('Lee de {a}, un programa chico que corre en tu computadora. Nada pasa por nuestros servidores.', { a: NAME })) + '</p>' +
        '<p class="lmd-tl-why">' + esc(T('Instalalo, arrancalo y pegá acá el código que muestra.')) + ' <a href="' + esc(install()) + '" target="_blank" rel="noopener noreferrer">' + esc(T('Cómo instalarlo')) + '</a></p>' +
        '<div class="lmd-row"><input type="text" class="lmd-lt-code" autocomplete="off" spellcheck="false" placeholder="' + esc(T('Código de emparejamiento')) + '" aria-label="' + esc(T('Código de emparejamiento')) + '">' +
        '<button type="button" class="lmd-btn" data-lt="pair">' + esc(T('Emparejar')) + '</button></div>' +
        '<p class="lmd-tl-why lmd-lt-note" role="status">' + esc(note || '') + '</p>';
      const input = area.querySelector('.lmd-lt-code'); const say = area.querySelector('.lmd-lt-note');
      const go = async () => {
        const p = parseCode(input.value);
        if (!p) { say.textContent = T('Ese código no tiene la forma esperada. Copialo entero de la consola del programa.'); return; }
        say.textContent = T('Probando…');
        const r = await call('status', null, p); if (!alive()) return;
        if (r.ok && r.data.app === CMD) { keep(p); input.value = ''; load(); return; }
        const perm = r.why === 'offline' ? await permission() : ''; if (!alive()) return;
        say.textContent = r.why === 'token' ? T('El programa contestó, pero ese código no es el suyo.') : T(WHY[perm] || WHY[''], { a: NAME });
      };
      area.querySelector('[data-lt=pair]').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
    const unpairBtn = '<button type="button" class="lmd-btn" data-lt="unpair">' + esc(T('Desemparejar')) + '</button>';
    function wire() {
      area.querySelectorAll('[data-lt=retry]').forEach((b) => b.addEventListener('click', () => load()));
      area.querySelectorAll('[data-lt=unpair]').forEach((b) => b.addEventListener('click', () => { keep(null); unpaired(''); }));
      area.querySelectorAll('[data-lt=open]').forEach((b) => b.addEventListener('click', () => { api.close(); open(id); }));
    }
    async function load() {
      const mine = ++seq;
      const p = pairing(); if (!p) { unpaired(''); return; }
      area.innerHTML = '<p class="lmd-tl-why" role="status">' + esc(T('Leyendo…')) + '</p>';
      const r = await call(view.path); if (!alive() || mine !== seq) return;
      if (r.ok) {
        area.innerHTML = '<p class="lmd-tl-why">' + esc(T('Emparejada con {a} en esta computadora.', { a: NAME })) + '</p>' +
          '<div class="lmd-row lmd-row-line"><span data-lt="sum">' + esc(view.sum(r.data)) + '</span><button type="button" class="lmd-btn" data-lt="open">' + esc(T(view.open)) + '</button></div>' +
          (id === 'worktrees' && !r.data.folders ? '<p class="lmd-tl-why"><code>' + esc(CMD) + ' folders add &lt;' + esc(T('carpeta')) + '&gt;</code></p>' : '') +
          '<div class="lmd-row lmd-row-line"><span></span>' + unpairBtn + '</div>';
        wire(); return;
      }
      if (r.why === 'unpaired') { unpaired(''); return; }
      if (r.why === 'token') { keep(null); unpaired(T('El código ya no vale. Pegá el nuevo.')); return; }
      const perm = r.why === 'offline' ? await permission() : ''; if (!alive() || mine !== seq) return;
      area.innerHTML = '<p class="lmd-tl-why" data-lt="why">' + esc(T(WHY[perm] || WHY[''], { a: NAME })) + '</p>' +
        '<p class="lmd-tl-why">' + esc(T('En Safari esta conexión no anda: usá el panel del propio programa.')) + ' <a href="http://127.0.0.1:' + p.port + '/#t=' + esc(p.token) + '" target="_blank" rel="noopener noreferrer">' + esc(T('Abrir el panel local')) + '</a></p>' +
        '<div class="lmd-row lmd-row-line">' + unpairBtn + '<button type="button" class="lmd-btn" data-lt="retry">' + esc(T('Probar de nuevo')) + '</button></div>';
      wire();
    }
    return load();
  }

  // ---------- "Mostrar en el Explorador" ----------
  // Lo llama el menú del archivo (extras.js) a través de LMD.reveal, que tools.js define mientras haya emparejamiento.
  async function reveal(path, c) {
    core = c || core;
    const r = await call('reveal', { path: String(path || '') });
    if (r.ok) return true;
    const why = r.data && r.data.error;
    if (why === 'outside' || why === 'no-folders') {
      // El programa solo muestra lo que está dentro de las carpetas que se le sumaron.
      await LMD.dialog.confirm({ title: T('Esa carpeta no está sumada'), text: T('{a} solo muestra archivos de las carpetas que le sumaste. En la consola de la computadora: {b} folders add y la carpeta.', { a: NAME, b: CMD }), ok: T('Entendido'), cancel: false });
    } else if (core) core.flash(r.why === 'offline' ? T(WHY[''], { a: NAME }) : T('No se pudo abrir la carpeta.'), 'warn');
    return false;
  }

  // Una herramienta por vista. Prenderla no le pide nada al programa.
  const tool = (id) => ({
    enable(c) { core = c; on[id] = true; },
    disable() { on[id] = false; if (dlg && dlg.id === id) shut(); },
    settings: (area, api) => settings(id, area, api),
    needs: () => (pairing() ? '' : 'Falta emparejar'),
  });

  LMD.localtools = {
    servers: tool('servers'), worktrees: tool('worktrees'), agents: tool('agents'), reveal, open, shut,
    paired: () => !!pairing(), NAME, CMD,
    // Para las pruebas.
    parseCode, pair: (code) => { const p = parseCode(code); return !!p && keep(p); }, unpair: () => keep(null), call,
    state: () => ({ paired: !!pairing(), open: dlg ? dlg.id : '', on: Object.keys(on).filter((k) => on[k]) }),
  };
})();
