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
        session = c.session || ''; email = c.email || '';
        LMD.load().then((s) => { base = String(s.cloudUrl || LMD.CLOUD_URL || '').replace(/\/+$/, ''); resolve(); });
      });
    });
    return loaded;
  }
  const remember = () => new Promise((resolve) => chrome.storage.local.set({ cloud: { session, email } }, resolve));

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
    return listCache;
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
      getFile: async () => { const n = await api('GET', notePath(path)); roles[path] = n.role || 'owner'; return { text: async () => n.text, lastModified: n.updated, size: n.text.length }; },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await api('PUT', notePath(path), { text: data }); listCache = null; } }; },
    };
  }

  const roles = {};

  LMD.cloud = {
    ready, api, list, handle, events, split,
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
    start: (mail) => api('POST', '/auth/start', { email: mail }),
    verify: async (mail, code) => { const r = await api('POST', '/auth/verify', { email: mail, code }); session = r.session; email = r.account.email; await remember(); return r.account; },
    logout: async () => { try { await api('POST', '/auth/logout', {}); } catch (e) { /* igual se cierra acá */ } session = ''; email = ''; listCache = null; await remember(); },
    account: () => api('GET', '/account'),
    create: (path) => api('PUT', notePath(path), { text: '' }).then((r) => { listCache = null; return r; }),
    remove: (path) => api('DELETE', notePath(path)).then((r) => { listCache = null; return r; }),
    newToken: (name) => api('POST', '/tokens', { name }),
    write: (path, text) => api('PUT', notePath(path), { text }).then((r) => { listCache = null; return r; }),
  };
})();
