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
          resolve();
        });
      });
    });
    return loaded;
  }
  let parked = null; // la sesión de otro servidor, que no se pisa mientras no se entre en este
  const remember = () => new Promise((resolve) => chrome.storage.local.set({ cloud: !session && parked ? parked : { session, email, at: base } }, resolve));

  async function api(method, path, body) {
    await ready();
    if (!base) throw Object.assign(new Error('no_server'), { code: 'no_server' });
    let res;
    try {
      res = await fetch(base + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, session ? { authorization: 'Bearer ' + session } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw Object.assign(new Error('offline'), { code: 'offline' }); }
    let json = null;
    try { json = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!res.ok) {
      if (res.status === 401 && session) { session = ''; await remember(); }
      throw Object.assign(new Error((json && json.error) || 'failed'), { code: (json && json.error) || 'failed', status: res.status });
    }
    return json;
  }

  // Una ruta que empieza con ~12/ es una nota de otra cuenta (la 12) que nos compartieron.
  const split = (p) => { const m = /^~(\d+)\/(.*)$/.exec(p); return m ? { owner: m[1], path: m[2] } : { owner: '', path: p }; };
  const notePath = (p) => { const s = split(p); return '/notes/' + s.path.split('/').map(encodeURIComponent).join('%2F') + (s.owner ? '?o=' + s.owner : ''); };

  const otherLists = {};
  async function list(fresh, owner) {
    if (owner) {
      const c = otherLists[owner];
      if (!fresh && c && Date.now() - c.at < 5000) return c.rows;
      const rows = await api('GET', '/notes?o=' + owner); otherLists[owner] = { rows, at: Date.now() };
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

  // ---------- Copia local y cola de lo que falta subir ----------
  const S = LMD.store;
  const keep = (path, text, base, pending, role) => S.cloudPut(email, path, { text, base, pending: !!pending, role: role || roles[path] || 'owner' });
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
  function merge3(base, mine, theirs) {
    const b = base.split('\n'); const m = mine.split('\n'); const t = theirs.split('\n');
    const span = (x) => {
      let s = 0; while (s < b.length && s < x.length && b[s] === x[s]) s++;
      let e = 0; while (e < b.length - s && e < x.length - s && b[b.length - 1 - e] === x[x.length - 1 - e]) e++;
      return { s, end: b.length - e, lines: x.slice(s, x.length - e) };
    };
    const a = span(m); const c = span(t);
    if (a.end <= c.s) return b.slice(0, a.s).concat(a.lines, b.slice(a.end, c.s), c.lines, b.slice(c.end)).join('\n');
    if (c.end <= a.s) return b.slice(0, c.s).concat(c.lines, b.slice(c.end, a.s), a.lines, b.slice(a.end)).join('\n');
    return null;
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
      const copy = await S.cloudGet(email, path); const unsent = !!copy && copy.pending && copy.text !== copy.base;
      let n;
      try { n = await api('GET', notePath(path)); }
      catch (e) {
        if (e.code === 'offline' && copy) { roles[path] = copy.role || 'owner'; return { text: copy.text, base: copy.base, offline: true }; }
        if (copy && (e.status === 404 || e.status === 403)) { if (unsent) await aside(path, copy.text); await S.cloudDelete(email, path); }
        throw e;
      }
      roles[path] = n.role || 'owner';
      const r = unsent ? await settle(path, copy.base, copy.text, n.text) : { text: n.text };
      await keep(path, r.text, n.text, r.text !== n.text);
      return Object.assign(r, { base: n.text });
    });
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
          const now = await S.cloudGet(email, c.path);
          if (!now || !now.pending) return false;
          try {
            const n = await api('GET', notePath(c.path));
            const r = await settle(c.path, now.base, now.text, n.text);
            if (r.text !== n.text) await api('PUT', notePath(c.path), { text: r.text });
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
  function events(p, onEvent) {
    let stop = false; let ctrl = null;
    const run = async () => {
      while (!stop) {
        try {
          await ready();
          const s = split(p); ctrl = new AbortController();
          const res = await fetch(base + '/events?path=' + encodeURIComponent(s.path) + (s.owner ? '&o=' + s.owner : ''), { headers: { authorization: 'Bearer ' + session }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error('events');
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
          for (;;) {
            const r = await reader.read(); if (r.done) break;
            buf += dec.decode(r.value, { stream: true });
            let cut;
            while ((cut = buf.indexOf('\n\n')) !== -1) {
              const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
              const line = chunk.split('\n').find((l) => l.startsWith('data: '));
              if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch (e) { /* evento ilegible */ } }
            }
          }
        } catch (e) { /* sin conexión: se reintenta */ }
        if (!stop) await new Promise((r) => setTimeout(r, 5000));
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
        const n = await api('GET', notePath(path)); roles[path] = n.role || 'owner';
        // La copia local sigue al servidor mientras no tenga cambios propios sin subir.
        const copy = await S.cloudGet(email, path);
        if (copy && !copy.pending && copy.text !== n.text) await keep(path, n.text, n.text, false);
        return { text: async () => n.text, lastModified: n.updated, size: n.text.length };
      },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await api('PUT', notePath(path), { text: data }); listCache = null; await keep(path, data, data, false); } }; },
    };
  }

  const roles = {};

  LMD.cloud = {
    ready, api, list: listOr, handle, events, split, merge3, settle, open, hold, flush, kept,
    read: (p) => api('GET', notePath(p)),
    // Antes de subir, lo escrito queda guardado acá como pendiente: si no hay conexión, espera en la cola.
    stash: (p, text, was) => keep(p, text, was, true),
    rename: async (from, to) => {
      const r = await api('POST', '/rename', { from, to }); listCache = null;
      const copy = await S.cloudGet(email, from);
      if (copy) { await S.cloudPut(email, to, { text: copy.text, base: copy.base, pending: copy.pending, role: copy.role }); await S.cloudDelete(email, from); }
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
      if (!res.ok) throw Object.assign(new Error((json && json.error) || 'failed'), { code: (json && json.error) || 'failed' });
      return json;
    },
    enabled: () => !!base,
    signedIn: () => !!session,
    email: () => email,
    start: (mail) => api('POST', '/auth/start', { email: mail, lang: LMD.lang() }),
    verify: async (mail, code) => { const r = await api('POST', '/auth/verify', { email: mail, code }); session = r.session; email = r.account.email; await remember(); return r.account; },
    // Al salir se borran las copias locales de la cuenta; lo que no llegó a subirse queda para cuando vuelva a entrar.
    logout: async () => {
      try { await api('POST', '/auth/logout', {}); } catch (e) { /* igual se cierra acá */ }
      for (const c of await S.cloudAll(email)) if (!c.pending) await S.cloudDelete(email, c.path);
      session = ''; email = ''; listCache = null; await remember();
    },
    account: () => api('GET', '/account'),
    create: (path) => api('PUT', notePath(path), { text: '' }).then((r) => { listCache = null; return r; }),
    remove: (path) => api('DELETE', notePath(path)).then(async (r) => { listCache = null; await S.cloudDelete(email, path); return r; }),
    // Con folder, el token solo alcanza esa carpeta.
    newToken: (name, folder) => api('POST', '/tokens', folder ? { name, folder } : { name }),
    // Comentarios para la IA sobre una nota propia. Con all vienen también los resueltos.
    comments: (p, all) => api('GET', '/comments?path=' + encodeURIComponent(p) + (all ? '&all=1' : '')),
    comment: (p, quote, text) => api('POST', '/comments', { path: p, quote, text }),
    uncomment: (id) => api('DELETE', '/comments/' + id),
    tokens: () => api('GET', '/tokens'),
    revoke: (id) => api('DELETE', '/tokens/' + id),
    feedback: (text, mail, context) => api('POST', '/feedback', { text, email: mail || undefined, context }),
    // Cambió la dirección del servidor en Ajustes: se vuelve a leer.
    reset: () => { loaded = null; listCache = null; },
    write: (path, text) => api('PUT', notePath(path), { text }).then((r) => { listCache = null; return r; }),
  };
})();
