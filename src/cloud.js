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

  const notePath = (p) => '/notes/' + p.split('/').map(encodeURIComponent).join('%2F');

  async function list(fresh) {
    if (!fresh && listCache && Date.now() - listAt < 5000) return listCache;
    listCache = await api('GET', '/notes'); listAt = Date.now();
    return listCache;
  }

  // Se comporta como un archivo del disco, igual que las notas del navegador.
  function handle(path) {
    return {
      kind: 'file', name: path.split('/').pop(),
      queryPermission: async () => 'granted',
      getFile: async () => { const n = await api('GET', notePath(path)); return { text: async () => n.text, lastModified: n.updated, size: n.text.length }; },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await api('PUT', notePath(path), { text: data }); listCache = null; } }; },
    };
  }

  LMD.cloud = {
    ready, api, list, handle,
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
  };
})();
