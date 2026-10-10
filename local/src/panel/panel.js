// El panel propio del programa: para cualquier navegador, sin pasar por la web.
// Todo lo que viene de la maquina (titulos de paginas, lineas de comando,
// nombres de ramas) entra como texto, nunca como HTML.
(function () {
  'use strict';
  const ES = /^es\b/i.test(navigator.language || '');
  const STR = {
    'Servers': 'Servidores', 'Worktrees': 'Worktrees', 'Agents': 'Agentes', 'Refresh': 'Actualizar', 'Close': 'Cerrar', 'Cancel': 'Cancelar',
    'Open this panel with the link the program prints when it starts.': 'Abrí este panel con el enlace que el programa muestra al arrancar.',
    'The program is not answering.': 'El programa no responde.', 'Reading…': 'Leyendo…',
    'Development': 'Desarrollo', 'Other programs': 'Otros programas', 'System': 'Sistema',
    'Nothing from a project folder is listening.': 'No hay nada escuchando desde una carpeta de proyecto.',
    'open to the network': 'abierto a la red', 'this machine only': 'solo esta máquina', 'launched by {a}': 'lanzado por {a}',
    'Close {a} on port {n}? What it was doing is lost.': '¿Cerrar {a} en el puerto {n}? Se pierde lo que estaba haciendo.',
    'Close this {a} session? What it was doing is lost.': '¿Cerrar esta sesión de {a}? Se pierde lo que estaba haciendo.',
    'It is still running.': 'Sigue corriendo.', 'Closed.': 'Cerrado.', 'It could not be closed.': 'No se pudo cerrar.',
    'No folders chosen. Add one with: {{CMD}} folders add <folder>': 'No hay carpetas elegidas. Sumá una con: {{CMD}} folders add <carpeta>',
    'No repositories in those folders.': 'No hay repositorios en esas carpetas.',
    'main': 'principal', 'no branch': 'sin rama', 'clean': 'sin cambios', '1 change': '1 cambio', '{n} changes': '{n} cambios', 'edited {a}': 'editado {a}',
    'folder missing': 'falta la carpeta', 'locked': 'bloqueado', 'working': 'trabajando', 'idle': 'en espera',
    'No agent sessions open.': 'No hay sesiones de agentes abiertas.', 'Untitled session': 'Sesión sin título', 'since {a}': 'desde {a}', 'last activity {a}': 'última actividad {a}',
    '{a} more processes of the app, {n} MB': '{a} procesos más de la app, {n} MB', 'this program': 'este programa',
    'just now': 'recién', '{n} min ago': 'hace {n} min', '{n} h ago': 'hace {n} h', '{n} d ago': 'hace {n} d',
  };
  const T = (s, v) => { let out = ES && STR[s] ? STR[s] : s; if (v) Object.keys(v).forEach((k) => { out = out.split('{' + k + '}').join(v[k]); }); return out; };
  const el = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach((k) => { if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
  };
  const ago = (iso) => {
    const ms = Date.now() - Date.parse(iso); if (!iso || isNaN(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return T('just now'); if (min < 60) return T('{n} min ago', { n: min });
    if (min < 1440) return T('{n} h ago', { n: Math.round(min / 60) }); return T('{n} d ago', { n: Math.round(min / 1440) });
  };
  const tag = (text, cls) => el('span', { class: 'tag' + (cls ? ' ' + cls : ''), text });

  // El token llega una vez, despues del # (eso no viaja al servidor ni queda en su registro), y se saca de la barra.
  let token = '';
  try { token = sessionStorage.getItem('smd-token') || ''; } catch (e) { token = ''; }
  const m = location.hash.match(/^#t=([A-Za-z0-9_-]{20,200})$/);
  if (m) { token = m[1]; try { sessionStorage.setItem('smd-token', token); } catch (e) { /* vale mientras dure la pagina */ } history.replaceState(null, '', location.pathname); }

  async function api(path, body) {
    const res = await fetch('/v1/' + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (res.status === 401) throw new Error('token');
    return res.json();
  }

  const main = document.getElementById('main'); const note = document.getElementById('note');
  const dialog = document.getElementById('ask');
  function confirmClose(text) {
    return new Promise((resolve) => {
      document.getElementById('ask-text').textContent = text;
      dialog.returnValue = 'no'; dialog.onclose = () => resolve(dialog.returnValue === 'yes');
      dialog.showModal(); document.getElementById('ask-no').focus();
    });
  }
  async function closeIt(path, body, text) {
    if (!(await confirmClose(text))) return;
    note.textContent = T('Reading…');
    let r = null; try { r = await api(path, body); } catch (e) { r = null; }
    await show(now);
    note.textContent = r && r.ok ? T('Closed.') : (r && r.ok === false ? T('It is still running.') : T('It could not be closed.'));
  }

  const VIEWS = {
    servers: async () => {
      const d = await api('servers'); const out = [];
      const row = (s) => {
        const title = s.project || (s.http && s.http.title) || s.process;
        const bits = [s.package && s.package !== s.project ? s.package : '', s.version ? 'v' + s.version : '', s.stack, s.http && s.http.title && s.project ? '“' + s.http.title + '”' : '', s.http && s.http.server].filter(Boolean).join(' · ');
        const meta = [s.process, 'PID ' + s.pid, s.memoryMB ? s.memoryMB + ' MB' : '', s.started ? ago(s.started) : ''].filter(Boolean).join(' · ');
        return el('div', { class: 'row' }, [
          el('div', { class: 'key', text: ':' + s.port }),
          el('div', { class: 'what' }, [el('b', { text: title }), bits ? el('p', { text: bits }) : null,
            el('p', {}, [s.self ? tag(T('this program')) : null, tag(s.exposed ? T('open to the network') : T('this machine only'), s.exposed ? 'warn' : ''), s.launchedBy ? tag(T('launched by {a}', { a: s.launchedBy })) : null, meta]),
            s.command ? el('p', {}, [el('code', { text: s.command })]) : null]),
          s.closable ? el('button', { type: 'button', class: 'danger', text: T('Close') }) : null,
        ]);
      };
      const dev = d.servers.filter((s) => s.kind === 'dev');
      out.push(el('h2', { text: T('Development') }));
      if (!dev.length) out.push(el('p', { class: 'empty', text: T('Nothing from a project folder is listening.') }));
      dev.forEach((s) => { const r = row(s); const b = r.querySelector('button'); if (b) b.addEventListener('click', () => closeIt('servers/close', { pid: s.pid, port: s.port, started: s.started }, T('Close {a} on port {n}? What it was doing is lost.', { a: s.project || s.process, n: s.port }))); out.push(r); });
      [['app', 'Other programs'], ['system', 'System']].forEach(([kind, name]) => {
        const list = d.servers.filter((s) => s.kind === kind); if (!list.length) return;
        out.push(el('details', {}, [el('summary', { text: T(name) + ' (' + list.length + ')' })].concat(list.map(row))));
      });
      return out;
    },
    worktrees: async () => {
      const d = await api('worktrees');
      if (!d.folders) return [el('p', { class: 'empty', text: T('No folders chosen. Add one with: {{CMD}} folders add <folder>') })];
      if (!d.repos.length) return [el('p', { class: 'empty', text: T('No repositories in those folders.') })];
      const out = [];
      d.repos.forEach((r) => {
        out.push(el('h2', { text: r.name }));
        r.worktrees.forEach((w) => {
          const state = w.missing ? T('folder missing') : (w.changes ? T(w.changes === 1 ? '1 change' : '{n} changes', { n: w.changes }) : T('clean'));
          out.push(el('div', { class: 'row' }, [
            el('div', { class: 'key', text: w.branch || T('no branch') }),
            el('div', { class: 'what' }, [el('b', { text: w.main ? T('main') : w.name }), el('p', { text: [w.commit, w.subject].filter(Boolean).join(' ') }),
              el('p', {}, [tag(state, w.changes || w.missing ? 'warn' : ''), w.locked ? tag(T('locked')) : null].concat(w.busy.map((b) => tag(b.name + (b.count > 1 ? ' ×' + b.count : ''), b.agent ? 'on' : ''))).concat([w.lastEdit ? T('edited {a}', { a: ago(w.lastEdit) }) : ''])),
              el('p', {}, [el('code', { text: w.path })])]),
          ]));
        });
      });
      return out;
    },
    agents: async () => {
      const d = await api('agents'); const out = [];
      d.agents.forEach((g) => {
        out.push(el('h2', { text: g.name }));
        g.sessions.forEach((s) => {
          const r = el('div', { class: 'row' }, [
            el('div', { class: 'key', text: (s.memoryMB + s.childrenMB) + ' MB' }),
            el('div', { class: 'what' }, [el('b', { text: s.title || T('Untitled session') }),
              el('p', {}, [s.active === null ? null : tag(s.active ? T('working') : T('idle'), s.active ? 'on' : ''), [s.project, 'PID ' + s.pid, s.memoryMB + ' + ' + s.childrenMB + ' MB', s.started ? T('since {a}', { a: ago(s.started) }) : '', s.lastActivity ? T('last activity {a}', { a: ago(s.lastActivity) }) : ''].filter(Boolean).join(' · ')])]),
            s.closable ? el('button', { type: 'button', class: 'danger', text: T('Close') }) : null,
          ]);
          const b = r.querySelector('button'); if (b) b.addEventListener('click', () => closeIt('agents/close', { pid: s.pid, started: s.started }, T('Close this {a} session? What it was doing is lost.', { a: g.name })));
          out.push(r);
        });
        if (g.otherProcs) out.push(el('p', { class: 'empty', text: T('{a} more processes of the app, {n} MB', { a: g.otherProcs, n: g.otherMB }) }));
      });
      if (!out.length) out.push(el('p', { class: 'empty', text: T('No agent sessions open.') }));
      return out;
    },
  };

  let now = 'servers'; let seq = 0;
  async function show(id) {
    now = id; const mine = ++seq;
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    if (!token) { main.replaceChildren(el('p', { class: 'empty', text: T('Open this panel with the link the program prints when it starts.') })); return; }
    note.textContent = T('Reading…');
    try {
      const nodes = await VIEWS[id](); if (mine !== seq) return;
      main.replaceChildren(...nodes); note.textContent = '';
    } catch (e) {
      if (mine !== seq) return;
      note.textContent = '';
      main.replaceChildren(el('p', { class: 'empty', text: e.message === 'token' ? T('Open this panel with the link the program prints when it starts.') : T('The program is not answering.') }));
    }
  }

  document.documentElement.lang = ES ? 'es' : 'en';
  const tabs = document.getElementById('tabs');
  [['servers', 'Servers'], ['worktrees', 'Worktrees'], ['agents', 'Agents']].forEach(([id, name]) => {
    const b = el('button', { type: 'button', role: 'tab', 'data-id': id, text: T(name) }); b.addEventListener('click', () => show(id)); tabs.appendChild(b);
  });
  document.getElementById('refresh').textContent = T('Refresh');
  document.getElementById('refresh').addEventListener('click', () => show(now));
  document.getElementById('ask-no').textContent = T('Cancel'); document.getElementById('ask-yes').textContent = T('Close');
  show('servers');
})();
