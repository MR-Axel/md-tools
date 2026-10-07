// Nube: cuenta, notas sincronizadas y token para conectar una IA por MCP.
// Habla con el servidor de server/server.mjs. Sin dirección de servidor configurada, nada de esto aparece.
(function () {
  'use strict';

  let session = ''; let email = ''; let base = ''; let loaded = null;
  let listCache = null; let listAt = 0;

  // La dirección sale de los ajustes (para quien aloja su propio servidor) o de la que trae la versión.
  function ready() {
    if (!loaded) loaded = new Promise((resolve) => {
      chrome.storage.local.get('cloud', (r) => {
        const c = (r && r.cloud) || {};
        LMD.load().then((s) => {
          base = String(s.cloudUrl || LMD.CLOUD_URL || '').trim().replace(/\/+$/, ''); if (/^off$/i.test(base)) base = '';
          // La sesión es del servidor que la dio: con otra dirección en Ajustes no se usa ni se manda. Queda guardada
          // por si se vuelve a la anterior. Una guardada antes de anotar el servidor se toma como del actual.
          const mine = !c.at || c.at === base;
          session = mine ? c.session || '' : ''; email = mine ? c.email || '' : ''; parked = mine ? null : c;
          if (session && !c.at) remember();
          team = session && mine && c.team && c.team.space ? { space: String(c.team.space), name: c.team.name || '' } : null;
          resolve();
        });
      });
    });
    return loaded;
  }
  let parked = null; // la sesión de otro servidor, que no se pisa mientras no se entre en este
  // El equipo de la cuenta: { space, name }. space es el número con el que se piden sus notas, que acá llevan rutas
  // ~space/..., como las que comparte otra cuenta. Se guarda lo último que se supo para dibujar el explorador sin
  // esperar al servidor, también sin conexión. setTeam devuelve si cambió.
  let team = null; const teamFns = [];
  function setTeam(mine) {
    const next = mine && mine.space ? { space: String(mine.space), name: mine.name || '' } : null;
    if ((team ? team.space + '|' + team.name : '') === (next ? next.space + '|' + next.name : '')) return false;
    team = next; if (team) delete otherLists[team.space];
    remember();
    return true;
  }
  const isTeam = (p) => !!team && String(p || '').startsWith('~' + team.space + '/');
  // Quien entró por el enlace de una sesión en vivo, sin cuenta: { secret, name, id, color, by, note, who, ended }.
  // Mientras dure, session es su pase y email un nombre interno para la copia local. Nada de eso se guarda como
  // cuenta: si en este navegador había una sesión propia, sigue guardada tal cual y vuelve al recargar sin el enlace.
  let guest = null;
  const remember = () => (guest ? Promise.resolve() : new Promise((resolve) => chrome.storage.local.set({ cloud: !session && parked ? parked : Object.assign({ session, email, at: base }, team ? { team } : {}) }, resolve)));
  const OPEN_LIVE = ['/live/look', '/live/join']; // se piden con el secreto del enlace, sin pase ni cuenta

  async function api(method, path, body, again) {
    await ready();
    if (!base) throw Object.assign(new Error('no_server'), { code: 'no_server' });
    // Un invitado solo habla con las rutas de su sesión: lo demás no sale de acá (y el servidor tampoco lo aceptaría).
    if (guest && !path.startsWith('/live/')) throw Object.assign(new Error('guest'), { code: 'guest', status: 403 });
    let res;
    try {
      res = await fetch(base + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, session && !OPEN_LIVE.includes(path) ? { authorization: 'Bearer ' + session } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw Object.assign(new Error('offline'), { code: 'offline' }); }
    let json = null;
    try { json = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!res.ok) {
      if (res.status === 401 && guest && !OPEN_LIVE.includes(path)) {
        // El pase dejó de servir. Si la sesión sigue abierta (el servidor se reinició, o pasó un rato largo sin
        // conexión) se vuelve a entrar con el enlace y el pedido sale de nuevo. Si no, la sesión terminó.
        if (!again && !guest.ended && await rejoin()) return api(method, path, body, true);
        throw Object.assign(new Error('live_ended'), { code: 'live_ended', status: 401 });
      }
      if (res.status === 401 && session && !guest) { session = ''; await remember(); }
      // retry: los segundos que faltan cuando el servidor frenó por un tope (del cuerpo o de la cabecera Retry-After).
      const retry = +((json && json.retry_after) || res.headers.get('retry-after') || 0) || 0;
      throw Object.assign(new Error((json && json.error) || 'failed'), { code: (json && json.error) || 'failed', status: res.status, retry, body: json });
    }
    return json;
  }

  // ---------- Invitado de una sesión en vivo ----------
  const liveTag = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const guestFns = [];
  const tellGuest = (what) => guestFns.forEach((fn) => { try { fn(what); } catch (e) { /* quien escucha se arregla */ } });
  // El pase queda en la pestaña (sessionStorage): recargar no crea otro invitado, y cerrar la pestaña lo olvida.
  // ticket es la contraseña de reingreso que da el servidor al entrar: con ella se vuelve aunque el enlace haya cambiado.
  function adopt(secret, r) {
    const ticket = r.ticket || (guest && guest.ticket) || '';
    guest = { secret, ticket, name: r.name, id: r.you, color: r.color, by: r.by, note: r.note.name, max: r.max, who: 'live:' + liveTag(secret), people: r.people || [], ended: '' };
    session = r.pass; email = guest.who; listCache = null; vaultCache = []; vaultAt = Date.now();
    try { sessionStorage.setItem('lmd-live', JSON.stringify({ secret, ticket, pass: r.pass, name: r.name, you: r.you, color: r.color, by: r.by, max: r.max, note: { name: r.note.name } })); } catch (e) { /* sin sesión: al recargar se vuelve a pedir el nombre */ }
    return guest;
  }
  let rejoining = null;
  function rejoin() {
    if (!rejoining) rejoining = (async () => {
      try { adopt(guest.secret, await api('POST', '/live/join', guest.ticket ? { ticket: guest.ticket, name: guest.name } : { secret: guest.secret, name: guest.name })); tellGuest('rejoined'); return true; }
      catch (e) {
        if (e.code === 'offline') throw e;
        guest.ended = e.code === 'live_full' ? 'full' : 'gone'; tellGuest('ended');
        return false;
      } finally { setTimeout(() => { rejoining = null; }, 0); }
    })();
    return rejoining;
  }
  // Tras recargar la pestaña: el mismo pase, si todavía sirve (si no, api() vuelve a entrar con el mismo nombre).
  async function resumeGuest(secret) {
    let kept = null;
    try { kept = JSON.parse(sessionStorage.getItem('lmd-live') || 'null'); } catch (e) { /* sin sesión */ }
    if (!kept || kept.secret !== secret || !kept.pass) return null;
    await ready();
    adopt(secret, kept);
    try { await api('GET', '/live/note'); return guest; }
    catch (e) { if (e.code === 'offline') return guest; guest = null; session = ''; email = ''; loaded = null; await ready(); throw e; }
  }
  async function leaveGuest() {
    if (!guest) return;
    try { if (!guest.ended) await api('POST', '/live/leave', {}); } catch (e) { /* igual se sale */ }
    try { sessionStorage.removeItem('lmd-live'); } catch (e) { /* sin sesión */ }
    for (const c of await S.cloudAll(guest.who)) await S.cloudDelete(guest.who, c.path);
  }

  // Una ruta que empieza con ~12/ es una nota de otra cuenta (la 12) que nos compartieron.
  const split = (p) => { const m = /^~(\d+)\/(.*)$/.exec(p); return m ? { owner: m[1], path: m[2] } : { owner: '', path: p }; };
  // Para un invitado hay una sola nota, la de la sesión: cualquier otra ruta no existe.
  const notePath = (p) => { if (guest) return p === guest.note ? '/live/note' : '/live/none'; const s = split(p); return '/notes/' + s.path.split('/').map(encodeURIComponent).join('%2F') + (s.owner ? '?o=' + s.owner : ''); };

  const otherLists = {};
  async function list(fresh, owner) {
    if (guest) return owner ? [] : [{ path: guest.note, updated: 0, size: 0 }];
    if (owner) {
      const c = otherLists[owner];
      if (!fresh && c && Date.now() - c.at < 5000) return c.rows;
      let rows;
      try { rows = await api('GET', '/notes?o=' + owner); }
      catch (e) {
        // El servidor ya no deja ver el espacio del equipo: lo sacaron, o el equipo ya no existe. Se avisa para que la cuenta se vuelva a leer.
        if (e.status === 403 && team && String(owner) === team.space) { setTeam(null); teamFns.forEach((fn) => { try { fn(); } catch (x) { /* quien escucha se arregla */ } }); }
        throw e;
      }
      otherLists[owner] = { rows, at: Date.now() };
      return rows;
    }
    if (!fresh && listCache && Date.now() - listAt < 5000) return listCache;
    listCache = await api('GET', '/notes'); listAt = Date.now();
    prune(listCache);
    return listCache;
  }
  // Sin conexión, la lista es lo que hay guardado en este navegador: lo que de verdad se puede abrir.
  async function listOr(fresh, owner) {
    try { return await list(fresh, owner); }
    catch (e) {
      if (e.code !== 'offline') throw e;
      const all = await kept(); const pre = owner ? '~' + owner + '/' : '';
      return all.filter((n) => (owner ? n.path.startsWith(pre) : n.path[0] !== '~')).map((n) => Object.assign(n, { path: n.path.slice(pre.length) }));
    }
  }

  // ---------- Carpetas con contraseña ----------
  // Lo que el servidor sabe de cada una: carpeta, con qué se envolvió su llave, el valor de comprobación y si está
  // abierta para la IA. Todo lo demás (cifrar, descifrar, las llaves abiertas) vive en seal.js. Acá se hace que el
  // resto de la app no se entere: una nota de una carpeta protegida se lee y se guarda como cualquier otra, y lo que
  // viaja y lo que queda en la copia local va cifrado. Con la carpeta bloqueada, leer o guardar sale con vault_locked.
  const S = LMD.store; const Z = LMD.seal;
  let vaultCache = null; let vaultAt = 0; let vaultOk = true;
  async function vaults(fresh) {
    await ready();
    if (!base || !session || guest) return [];
    if (!fresh && vaultCache && Date.now() - vaultAt < 30000) return vaultCache;
    try { vaultCache = await api('GET', '/vaults'); vaultAt = Date.now(); vaultOk = true; S.vaultsPut(email, vaultCache); }
    catch (e) {
      // Sin conexión vale lo último que se supo, guardado en este navegador. Un servidor propio sin actualizar no las tiene.
      if (e.code === 'offline') vaultCache = vaultCache || (await S.vaultsGet(email)) || [];
      else if (e.status === 404) { vaultCache = []; vaultAt = Date.now(); vaultOk = false; }
      else vaultCache = vaultCache || [];
    }
    return vaultCache;
  }
  const vaultFor = async (path) => (path[0] === '~' ? null : (await vaults()).find((v) => path.startsWith(v.folder + '/')) || null);
  const lockedErr = (vault) => Object.assign(new Error('vault_locked'), { code: 'vault_locked', vault });
  const keyOf = async (vault) => { const key = await Z.keyFor(email, vault); if (!key) throw lockedErr(vault); return key; };
  // Lo que llegó del servidor, en claro.
  async function plain(path, text) {
    if (!Z.sealed(text)) return text;
    const vault = (await vaultFor(path)) || (await vaults(true), await vaultFor(path));
    return Z.open(await keyOf(vault), path, text);
  }
  // Lo que sale hacia el servidor: cifrado si la ruta está en una carpeta protegida.
  async function wire(path, text) {
    const vault = await vaultFor(path);
    return vault && vault.state === 'on' ? Z.seal(await keyOf(vault), path, text) : text;
  }
  const getNote = async (path) => { const n = await api('GET', notePath(path)); n.text = await plain(path, n.text); return n; };
  // rev es la revisión sobre la que se escribió (la que vino al leer). Si la nota ya va por otra, el servidor no
  // guarda y esto sale con rev_conflict, con el texto de ahora en claro (theirs) y su revisión (rev): quien llama
  // junta y reintenta. Sin rev se guarda pisando, como antes: para una nota nueva, o un servidor sin actualizar.
  async function putNote(path, text, rev) {
    const send = async () => api('PUT', notePath(path), Object.assign({ text: await wire(path, text) }, rev == null ? {} : { rev }));
    try {
      try { return await send(); }
      catch (e) {
        // La carpeta se protegió, o dejó de estarlo, desde otra pestaña: se vuelve a mirar y se manda como corresponde.
        if (e.code !== 'vault' && e.code !== 'vault_text') throw e;
        await vaults(true);
        return await send();
      }
    } catch (e) {
      if (e.code === 'rev_conflict' && e.body) { e.theirs = await plain(path, String(e.body.text == null ? '' : e.body.text)); e.rev = e.body.rev; e.pid = e.body.pid || ''; }
      throw e;
    }
  }

  // ---------- Copia local y cola de lo que falta subir ----------
  // La copia de una nota de una carpeta protegida se guarda cifrada (sealed), con la misma llave y atada a su ruta.
  async function keep(path, text, was, pending, role) {
    const rec = { text, base: was, pending: !!pending, role: role || roles[path] || 'owner' };
    const vault = await vaultFor(path);
    if (vault && vault.state === 'on') {
      const key = await keyOf(vault);
      rec.text = await Z.seal(key, path, text); rec.base = was === text ? rec.text : await Z.seal(key, path, was == null ? '' : was); rec.sealed = true;
    }
    return S.cloudPut(email, path, rec);
  }
  async function copyOf(path) {
    const c = await S.cloudGet(email, path);
    if (!c || !c.sealed) return c;
    const key = await keyOf(await vaultFor(path));
    const text = await Z.open(key, path, c.text);
    return Object.assign({}, c, { text, base: c.base === c.text ? text : await Z.open(key, path, c.base) });
  }
  const kept = async () => (await S.cloudAll(email)).map((c) => ({ path: c.path, updated: c.at, size: c.text.length }));
  // Lo que ya no está en el servidor deja de guardarse acá, salvo que tenga cambios sin subir.
  async function prune(rows) {
    const live = new Set(rows.map((n) => n.path));
    for (const c of await S.cloudAll(email)) if (!c.pending && c.path[0] !== '~' && !live.has(c.path)) await S.cloudDelete(email, c.path);
  }
  // Una pestaña con la nota abierta sostiene 'lmd-open' mientras viva: de subir lo suyo se ocupa ella.
  const lockName = (kind, path) => 'lmd-' + kind + ':' + email + ':' + path;
  const locked = (path, fn) => (navigator.locks ? navigator.locks.request(lockName('sync', path), fn) : fn());
  // Devuelve cómo soltarla: al pasar a otra nota sin recargar la página, esta deja de estar abierta.
  const hold = (path) => {
    let release = () => {};
    if (navigator.locks) navigator.locks.request(lockName('open', path), () => new Promise((resolve) => { release = resolve; }));
    return () => release();
  };

  // Junta dos ediciones de la misma nota si tocaron partes distintas. Devuelve null si se pisan.
  // Trabaja sobre texto en claro: para una nota protegida, ya descifrado en este navegador.
  function merge3(base, mine, theirs) {
    const r = merge(base, mine, theirs);
    return r.lost.length ? null : r.text;
  }
  // Qué cambió x respecto de b, como tramos sobre las líneas de b: [{ s, e, lines }] (de s a e pasan a ser lines).
  // Fuera del principio y el final iguales se buscan las líneas en común; si el medio es enorme, va como un solo tramo.
  function hunks(b, x) {
    const nb = b.length; const nx = x.length;
    let s = 0; while (s < nb && s < nx && b[s] === x[s]) s++;
    let e = 0; while (e < nb - s && e < nx - s && b[nb - 1 - e] === x[nx - 1 - e]) e++;
    const B = b.slice(s, nb - e); const X = x.slice(s, nx - e); const n = B.length; const m = X.length;
    if (!n && !m) return [];
    if (!n || !m || n * m > 1000000) return [{ s, e: nb - e, lines: X }];
    const w = m + 1; const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = B[i] === X[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    const out = []; let cur = null; let i = 0; let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && B[i] === X[j]) { cur = null; i++; j++; continue; }
      if (!cur) { cur = { s: s + i, e: s + i, lines: [] }; out.push(cur); }
      if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) cur.lines.push(X[j++]); else cur.e = s + (++i);
    }
    return out;
  }
  // Mezcla de tres vías por líneas, tramo por tramo. Lo que cada uno cambió en partes distintas entra entero. Donde
  // los dos tocaron las mismas líneas queda lo de theirs (lo que ya está guardado), y lo de acá vuelve en lost,
  // para que quien llama no lo pierda en silencio: [{ mine, theirs }], cada uno con el texto de ese tramo.
  // Trabaja sobre texto en claro: para una nota protegida, ya descifrado en este navegador.
  function merge(base, mine, theirs) {
    if (mine === base || mine === theirs) return { text: theirs, lost: [] };
    if (theirs === base) return { text: mine, lost: [] };
    const b = base.split('\n'); const A = hunks(b, mine.split('\n')); const C = hunks(b, theirs.split('\n'));
    const out = []; const lost = []; let pos = 0; let i = 0; let j = 0;
    const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
    const take = (h) => { for (let k = pos; k < h.s; k++) out.push(b[k]); for (const l of h.lines) out.push(l); pos = h.e; };
    // Un lado de un tramo en disputa: las líneas de la base entre gs y ge con los cambios de ese lado puestos.
    const side = (list, gs, ge) => { const o = []; let p = gs; for (const h of list) { for (let k = p; k < h.s; k++) o.push(b[k]); for (const l of h.lines) o.push(l); p = h.e; } for (let k = p; k < ge; k++) o.push(b[k]); return o; };
    while (i < A.length || j < C.length) {
      const a = A[i]; const c = C[j];
      if (!c) { take(a); i++; continue; }
      if (!a) { take(c); j++; continue; }
      if (a.s === c.s && a.e === c.e && same(a.lines, c.lines)) { take(a); i++; j++; continue; } // el mismo cambio de los dos lados
      if (a.e <= c.s) { take(a); i++; continue; }
      if (c.e <= a.s) { take(c); j++; continue; }
      // Se pisan: se junta todo lo que se encadena con ese tramo, de un lado y del otro.
      let gs = Math.min(a.s, c.s); let ge = Math.max(a.e, c.e); const ga = []; const gc = [];
      for (;;) {
        if (i < A.length && A[i].s < ge) { ge = Math.max(ge, A[i].e); ga.push(A[i++]); }
        else if (j < C.length && C[j].s < ge) { ge = Math.max(ge, C[j].e); gc.push(C[j++]); }
        else break;
      }
      const m = side(ga, gs, ge); const t = side(gc, gs, ge);
      if (!same(m, t)) lost.push({ mine: m.join('\n'), theirs: t.join('\n') });
      take({ s: gs, e: ge, lines: t });
    }
    for (let k = pos; k < b.length; k++) out.push(b[k]);
    return { text: out.join('\n'), lost };
  }

  // Lo que no se pudo juntar queda aparte, como nota del navegador, para que no se pierda.
  async function aside(path, text) {
    const file = path.split('/').pop(); const dot = file.lastIndexOf('.');
    const stem = (dot > 0 ? file.slice(0, dot) : file) + ' (' + LMD.t('sin conexión') + ')'; const ext = dot > 0 ? file.slice(dot) : '.md';
    let name = stem + ext;
    for (let n = 2; n < 50 && await S.noteGet(name); n++) name = stem + '-' + n + ext;
    await S.notePut(name, text);
    return name;
  }
  // Lo escrito sin conexión (mine, hecho sobre base) contra lo que hay ahora en el servidor (theirs).
  // Si se pisan gana el servidor y lo de acá queda aparte: no se pierde ninguna de las dos.
  async function settle(path, base, mine, theirs) {
    if (theirs === base || theirs === mine) return { text: mine };
    const merged = merge3(base, mine, theirs);
    if (merged != null) return { text: merged, merged: merged !== theirs };
    return { text: theirs, aside: await aside(path, mine) };
  }

  // Abre una nota: del servidor si hay conexión, de la copia local si no. Lo que había quedado sin
  // subir se junta acá con el servidor; quien llama lo sube si text quedó distinto de base.
  function open(path) {
    return locked(path, async () => {
      const copy = await copyOf(path); const unsent = !!copy && copy.pending && copy.text !== copy.base;
      let n;
      try { n = await getNote(path); }
      catch (e) {
        if (e.code === 'offline' && copy) { roles[path] = copy.role || 'owner'; return { text: copy.text, base: copy.base, offline: true }; }
        if (copy && (e.status === 404 || e.status === 403)) { if (unsent) await aside(path, copy.text); await S.cloudDelete(email, path); }
        throw e;
      }
      roles[path] = n.role || 'owner';
      const r = unsent ? await settle(path, copy.base, copy.text, n.text) : { text: n.text };
      await keep(path, r.text, n.text, r.text !== n.text);
      return Object.assign(r, { base: n.text, rev: n.rev });
    });
  }
  // Guarda sobre la revisión leída. Si en el medio guardó otro, junta lo de acá con lo del servidor y reintenta;
  // lo que no se pueda juntar queda aparte (settle). Devuelve { text, rev } con lo que quedó en el servidor.
  async function putMerged(path, base, mine, n) {
    for (let turn = 0; ; turn++) {
      const r = await settle(path, base, mine, n.text);
      if (r.text === n.text) return { text: n.text, rev: n.rev };
      try { const saved = await putNote(path, r.text, n.rev); return { text: r.text, rev: saved.rev }; }
      catch (e) {
        if (e.code !== 'rev_conflict' || turn >= 4) throw e;
        // Lo ya juntado pasa a ser lo de acá, sobre lo que el servidor tenía cuando se juntó.
        base = n.text; mine = r.text; n = { text: e.theirs, rev: e.rev };
      }
    }
  }

  // Sube lo pendiente de las notas que no están abiertas en ninguna pestaña.
  let flushing = false; let listening = false;
  async function flush() {
    await ready();
    if (!listening) { listening = true; window.addEventListener('online', flush); }
    if (flushing || !base || !session || !navigator.locks) return;
    flushing = true;
    try {
      for (const c of (await S.cloudAll(email)).filter((r) => r.pending)) {
        const stop = await navigator.locks.request(lockName('open', c.path), { ifAvailable: true }, (lock) => lock && locked(c.path, async () => {
          let now = null;
          // Lo pendiente de una carpeta bloqueada espera a que se la desbloquee: sin la llave no se puede juntar.
          try { now = await copyOf(c.path); } catch (e) { return false; }
          if (!now || !now.pending) return false;
          try {
            const n = await getNote(c.path);
            const r = await putMerged(c.path, now.base, now.text, n);
            await keep(c.path, r.text, r.text, false, n.role);
          } catch (e) {
            if (e.code === 'offline') return true;
            if (e.status === 404 || e.status === 403) { await aside(c.path, now.text); await S.cloudDelete(email, c.path); }
          }
          return false;
        }));
        if (stop) break;
      }
      listCache = null;
    } finally { flushing = false; }
  }

  // Escucha una nota: avisa cuando otro la guarda y quién más la tiene abierta. Se reconecta sola.
  // Además de lo que manda el servidor, avisa { type: 'link', up } cuando la escucha se abre o se corta.
  // quick() dice si hay una sesión en vivo en curso: ahí se reconecta enseguida en vez de esperar cinco segundos.
  function events(p, onEvent, quick) {
    let stop = false; let ctrl = null;
    // Un error de quien escucha no corta la escucha, pero tampoco se esconde: queda en la consola.
    const tell = (ev) => { try { onEvent(ev); } catch (e) { console.error(e); } };
    const run = async () => {
      while (!stop) {
        let up = false;
        try {
          await ready();
          const s = split(p); ctrl = new AbortController();
          const res = await fetch(base + (guest ? '/live/events' : '/events?path=' + encodeURIComponent(s.path) + (s.owner ? '&o=' + s.owner : '')), { headers: { authorization: 'Bearer ' + session }, signal: ctrl.signal });
          // El pase de un invitado dejó de servir: se vuelve a entrar con el enlace, o la sesión terminó y no se insiste.
          if (res.status === 401 && guest && !(await rejoin())) { stop = true; break; }
          if (!res.ok || !res.body) throw new Error('events');
          up = true; if (!stop) tell({ type: 'link', up: true });
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
          for (;;) {
            const r = await reader.read(); if (r.done) break;
            buf += dec.decode(r.value, { stream: true });
            let cut;
            while ((cut = buf.indexOf('\n\n')) !== -1) {
              const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
              const line = chunk.split('\n').find((l) => l.startsWith('data: '));
              if (line) { try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'vault') vaultAt = 0; onEvent(ev); } catch (e) { /* evento ilegible */ } }
            }
          }
        } catch (e) { /* sin conexión: se reintenta */ }
        if (stop) break;
        tell({ type: 'link', up: false, was: up });
        await new Promise((r) => setTimeout(r, guest || (quick && quick()) ? 1500 : 5000));
      }
    };
    run();
    return () => { stop = true; if (ctrl) ctrl.abort(); };
  }

  // Se comporta como un archivo del disco, igual que las notas del navegador.
  function handle(path) {
    return {
      kind: 'file', name: path.split('/').pop(),
      queryPermission: async () => 'granted',
      getFile: async () => {
        const n = await getNote(path); roles[path] = n.role || 'owner';
        // La copia local sigue al servidor mientras no tenga cambios propios sin subir.
        const copy = await copyOf(path);
        if (copy && !copy.pending && copy.text !== n.text) await keep(path, n.text, n.text, false);
        // rev viaja con el texto: quien lo toma como base guarda después sobre esa revisión.
        return { text: async () => n.text, lastModified: n.updated, size: n.text.length, rev: n.rev };
      },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await putNote(path, data); listCache = null; await keep(path, data, data, false); } }; },
    };
  }

  const roles = {};

  // Las notas de una carpeta, tal como las lista el servidor (sin caché: se usa al cifrar y al descifrar todo).
  const under = async (folder) => (await api('GET', '/notes')).filter((n) => n.path.startsWith(folder + '/'));
  // Cifra lo que todavía está en claro dentro de una carpeta protegida: las notas que ya estaban al protegerla,
  // o las que quedaron a medias si se cortó. onStep(hechas, total). Se puede llamar las veces que haga falta.
  async function sealFolder(vault, onStep) {
    const key = await keyOf(vault);
    const rows = (await under(vault.folder)).filter((n) => !n.v);
    let done = 0;
    if (onStep) onStep(0, rows.length);
    for (const n of rows) {
      await locked(n.path, async () => {
        const got = await api('GET', notePath(n.path));
        if (!Z.sealed(got.text)) await api('PUT', notePath(n.path), Object.assign({ text: await Z.seal(key, n.path, got.text) }, got.rev == null ? {} : { rev: got.rev }));
      });
      if (onStep) onStep(++done, rows.length);
    }
    // Las copias locales que estaban en claro pasan a estar cifradas.
    for (const c of await S.cloudAll(email)) if (!c.sealed && c.path.startsWith(vault.folder + '/')) await keep(c.path, c.text, c.base, c.pending, c.role);
    listCache = null;
    return rows.length;
  }
  // Quita la protección: el servidor vuelve a aceptar texto en claro en la carpeta, cada nota se descifra acá y
  // se guarda de nuevo, y al final se borra la bóveda. Si se corta, queda a medias y se retoma con la misma llamada.
  async function openFolder(vault, onStep) {
    const key = await keyOf(vault);
    if (vault.state !== 'opening') await api('POST', '/vaults/' + vault.id + '/open', {});
    await vaults(true);
    const rows = (await under(vault.folder)).filter((n) => n.v);
    let done = 0;
    if (onStep) onStep(0, rows.length);
    for (const n of rows) {
      await locked(n.path, async () => {
        const got = await api('GET', notePath(n.path));
        if (Z.sealed(got.text)) await api('PUT', notePath(n.path), Object.assign({ text: await Z.open(key, n.path, got.text) }, got.rev == null ? {} : { rev: got.rev }));
      });
      if (onStep) onStep(++done, rows.length);
    }
    for (const c of await S.cloudAll(email)) {
      if (!c.sealed || !c.path.startsWith(vault.folder + '/')) continue;
      const text = await Z.open(key, c.path, c.text);
      await S.cloudPut(email, c.path, { text, base: c.base === c.text ? text : await Z.open(key, c.path, c.base), pending: c.pending, role: c.role });
    }
    await api('DELETE', '/vaults/' + vault.id);
    await Z.forget(email, vault); await vaults(true); listCache = null;
  }

  LMD.cloud = {
    ready, api, list: listOr, handle, events, split, merge3, merge, hunks, settle, open, hold, flush, kept,
    read: (p) => getNote(p),
    // Sesión en vivo. De un lado, quien entra por el enlace (mirar, entrar, retomar tras recargar, salir); del otro,
    // quien la abre sobre una nota propia (abrir, ver quiénes están, cambiar el enlace, sacar a alguien, terminarla).
    // at() dice en qué bloque se está, para los dos.
    guest: () => guest,
    onGuest: (fn) => { guestFns.push(fn); },
    live: {
      look: (secret) => api('POST', '/live/look', { secret }),
      join: async (secret, name) => adopt(secret, await api('POST', '/live/join', { secret, name })),
      resume: resumeGuest, leave: leaveGuest,
      status: (p) => api('GET', '/live?path=' + encodeURIComponent(p)),
      open: (p, name) => api('POST', '/live', { path: p, name }),
      close: (p) => api('DELETE', '/live?path=' + encodeURIComponent(p)),
      rotate: (p) => api('POST', '/live/rotate', { path: p }),
      kick: (p, id) => api('POST', '/live/kick', { path: p, id }),
      at: (p, body) => api('POST', '/live/presence', guest ? body : Object.assign({ path: p }, body)),
    },
    // Guarda la nota abierta sobre la revisión que tiene como base. Sale con rev_conflict si otro guardó antes.
    save: async (p, text, rev) => { const r = await putNote(p, text, rev); listCache = null; await keep(p, text, text, false); return r; },
    // Lo de acá ya es lo mismo que hay en el servidor: la copia local deja de estar pendiente.
    settled: (p, text) => keep(p, text, text, false),
    // Antes de subir, lo escrito queda guardado acá como pendiente: si no hay conexión, espera en la cola.
    stash: (p, text, was) => keep(p, text, was, true),
    // Dentro, hacia o desde una carpeta protegida, mover es volver a cifrar: el texto cifrado está atado a su ruta.
    // El servidor recibe el texto que corresponde a la ruta nueva, y lo que se leyó (updated) para no pisar un cambio.
    rename: async (from, to) => {
      const a = split(from); const b = split(to);
      if (a.owner !== b.owner) {
        // De lo propio al equipo, o al revés: son notas de dueños distintos. Se guarda en el destino y se quita el original.
        const n = await getNote(from);
        await putNote(to, n.text); await keep(to, n.text, n.text, false);
        // La nota sigue existiendo, en otro lado: el original no pasa por la papelera.
        await api('DELETE', notePath(from) + (a.owner ? '&' : '?') + 'forever=1'); await S.cloudDelete(email, from);
        listCache = null; delete otherLists[a.owner]; delete otherLists[b.owner];
        return { path: to };
      }
      if (a.owner) {
        const r = await api('POST', '/rename', { from: a.path, to: b.path, o: +a.owner });
        delete otherLists[a.owner];
        const copy = await copyOf(from); await S.cloudDelete(email, from);
        if (copy) await keep(to, copy.text, copy.base, copy.pending, copy.role);
        return r;
      }
      const crossing = (await vaultFor(from)) || (await vaultFor(to));
      let r;
      if (!crossing) r = await api('POST', '/rename', { from, to });
      else { const n = await getNote(from); r = await api('POST', '/rename', { from, to, text: await wire(to, n.text), updated: n.updated }); }
      listCache = null;
      let copy = null;
      try { copy = await copyOf(from); } catch (e) { /* sin la llave la copia no se puede llevar: se vuelve a bajar */ }
      await S.cloudDelete(email, from);
      if (copy) await keep(to, copy.text, copy.base, copy.pending, copy.role);
      return r;
    },
    roleOf: (p) => roles[p] || 'owner',
    shared: () => api('GET', '/shared'),
    shares: (p) => api('GET', '/shares?path=' + encodeURIComponent(p)),
    share: (p, mail, role, kind) => api('POST', '/shares', { path: p, email: mail, role, kind }),
    unshare: (id) => api('DELETE', '/shares/' + id),
    link: (p, password) => api('POST', '/links', { path: p, password }),
    unlink: (id) => api('DELETE', '/links/' + id),
    publicNote: async (token, password) => {
      await ready();
      let res;
      try { res = await fetch(base + '/public/' + encodeURIComponent(token), { headers: password ? { 'x-password': password } : {} }); }
      catch (e) { throw Object.assign(new Error('offline'), { code: 'offline' }); }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error((json && json.error) || 'failed'), { code: (json && json.error) || 'failed', retry: +((json && json.retry_after) || 0) || 0 });
      return json;
    },
    enabled: () => !!base,
    signedIn: () => !!session,
    email: () => email,
    start: (mail) => api('POST', '/auth/start', { email: mail, lang: LMD.lang() }),
    verify: async (mail, code) => { const r = await api('POST', '/auth/verify', { email: mail, code }); session = r.session; email = r.account.email; vaultCache = null; await remember(); return r.account; },
    // Al salir se borran las copias locales de la cuenta; lo que no llegó a subirse queda para cuando vuelva a entrar.
    // Las llaves de las carpetas protegidas se olvidan, también las recordadas en este dispositivo.
    logout: async () => {
      try { await api('POST', '/auth/logout', {}); } catch (e) { /* igual se cierra acá */ }
      for (const c of await S.cloudAll(email)) if (!c.pending) await S.cloudDelete(email, c.path);
      await Z.forgetAll(email);
      session = ''; email = ''; listCache = null; vaultCache = null; setTeam(null); await remember();
    },
    account: () => api('GET', '/account'),
    create: (path) => putNote(path, '').then((r) => { listCache = null; delete otherLists[split(path).owner]; return r; }),
    remove: (path) => api('DELETE', notePath(path)).then(async (r) => { listCache = null; delete otherLists[split(path).owner]; await S.cloudDelete(email, path); return r; }),
    // Papelera: lo eliminado de la nube, hasta que vence. owner es el espacio del equipo, o nada para lo propio.
    trash: (owner) => api('GET', '/trash' + (owner ? '?o=' + owner : '')),
    trashRestore: async (id, owner) => {
      const at = '/trash/' + id + '/restore' + (owner ? '?o=' + owner : ''); let r;
      try { r = await api('POST', at, {}); }
      catch (e) {
        // Una nota protegida que vuelve con otro nombre (el suyo está ocupado): el texto cifrado está atado a su
        // ruta, así que se descifra con la de antes y se cifra para la nueva, acá, con la carpeta desbloqueada.
        if (e.code !== 'trash_rekey' || !e.body) throw e;
        const vault = (await vaultFor(e.body.path)) || (await vaults(true), await vaultFor(e.body.path));
        const key = await keyOf(vault);
        r = await api('POST', at, { to: e.body.to, text: await Z.seal(key, e.body.to, await Z.open(key, e.body.path, e.body.text)) });
      }
      listCache = null; delete otherLists[owner || ''];
      return r;
    },
    trashDelete: (id, owner) => api('DELETE', '/trash/' + id + (owner ? '?o=' + owner : '')),
    trashEmpty: (owner) => api('DELETE', '/trash' + (owner ? '?o=' + owner : '')),
    // Elimina la cuenta en el servidor y, acá, todo lo que este navegador guardaba de ella.
    deleteAccount: async (mail) => {
      await api('DELETE', '/account', { email: mail });
      for (const c of await S.cloudAll(email)) await S.cloudDelete(email, c.path);
      try { await Z.forgetAll(email); } catch (e) { /* sin IndexedDB no había nada guardado */ }
      session = ''; email = ''; listCache = null; vaultCache = null; setTeam(null); await remember();
    },
    // Con folder, el token solo alcanza esa carpeta. Con share, puede compartir notas y crear enlaces públicos.
    newToken: (name, folder, share) => api('POST', '/tokens', Object.assign({ name }, folder ? { folder } : {}, share ? { share: true } : {})),
    // Comentarios para la IA sobre una nota propia. Con all vienen también los resueltos.
    comments: (p, all) => api('GET', '/comments?path=' + encodeURIComponent(p) + (all ? '&all=1' : '')),
    comment: (p, quote, text) => api('POST', '/comments', { path: p, quote, text }),
    uncomment: (id) => api('DELETE', '/comments/' + id),
    tokens: () => api('GET', '/tokens'),
    revoke: (id) => api('DELETE', '/tokens/' + id),
    feedback: (text, mail, context) => api('POST', '/feedback', { text, email: mail || undefined, context }),
    // Cambió la dirección del servidor en Ajustes: se vuelve a leer.
    reset: () => { loaded = null; listCache = null; vaultCache = null; },
    write: (path, text) => putNote(path, text).then((r) => { listCache = null; delete otherLists[split(path).owner]; return r; }),
    // Una versión del historial, en claro. Las de una nota protegida están cifradas con la ruta que tenía entonces.
    version: async (id, path) => {
      const v = await api('GET', '/version/' + id + (isTeam(path) ? '?o=' + team.space : ''));
      if (Z.sealed(v.text)) v.text = await Z.open(await keyOf(await vaultFor(path)), v.aad || v.path, v.text);
      return v;
    },
    // El historial de una nota. El de una nota del equipo se pide al espacio del equipo.
    versions: (path) => (isTeam(path) ? api('GET', '/versions/' + encodeURIComponent(split(path).path) + '?o=' + team.space) : api('GET', '/versions/' + encodeURIComponent(path))),
    // Equipo. team() es lo último que se supo ({ space, name } o null); las llamadas devuelven el equipo como quedó.
    setTeam, isTeam, teamNow: () => team, onTeamLost: (fn) => { teamFns.push(fn); },
    team: {
      get: () => api('GET', '/team'),
      invite: (mail) => api('POST', '/team/invite', { email: mail, lang: LMD.lang() }),
      uninvite: (id) => api('DELETE', '/team/invites/' + id),
      accept: (id) => api('POST', '/team/accept', { id }),
      decline: (id) => api('POST', '/team/decline', { id }),
      remove: (id) => api('POST', '/team/remove', { id }),
      leave: () => api('POST', '/team/leave', {}),
      seats: (n) => api('POST', '/team/seats', { seats: n }),
      rename: (name) => api('PUT', '/team', { name }),
    },
    // Carpetas con contraseña.
    vaults, vaultFor, sealFolder, openFolder,
    vaultStale: () => { vaultAt = 0; },
    // Lo último que se supo, sin esperar: para dibujar. vaultOk dice si el servidor las tiene (uno propio sin actualizar, no).
    vaultsNow: () => vaultCache || [],
    vaultOk: () => vaultOk,
    vaultCreate: async (body) => { const v = await api('POST', '/vaults', body); await vaults(true); listCache = null; return v; },
    vaultRewrap: async (id, body) => { const v = await api('PUT', '/vaults/' + id, body); await vaults(true); return v; },
    // Desbloquear para la IA: la única vez que la llave de datos sale de este navegador.
    vaultAi: async (id, key, minutes) => { const v = await api('POST', '/vaults/' + id + '/unlock', { key, minutes }); await vaults(true); return v; },
    // Elimina la carpeta protegida con sus notas, sin su llave. Las copias de este navegador se van con ella.
    vaultDestroy: async (vault) => {
      const r = await api('POST', '/vaults/' + vault.id + '/destroy', { folder: vault.folder });
      for (const c of await S.cloudAll(email)) if (c.path.startsWith(vault.folder + '/')) await S.cloudDelete(email, c.path);
      try { await Z.forget(email, vault); } catch (e) { /* no había llave guardada */ }
      await vaults(true); listCache = null;
      return r;
    },
    vaultAiLock: async (id) => { const v = await api('POST', '/vaults/' + id + '/lock', {}); await vaults(true); return v; },
  };
})();
