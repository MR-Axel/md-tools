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
      // retry: los segundos que faltan cuando el servidor frenó por un tope (del cuerpo o de la cabecera Retry-After).
      const retry = +((json && json.retry_after) || res.headers.get('retry-after') || 0) || 0;
      throw Object.assign(new Error((json && json.error) || 'failed'), { code: (json && json.error) || 'failed', status: res.status, retry });
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

  // ---------- Carpetas con contraseña ----------
  // Lo que el servidor sabe de cada una: carpeta, con qué se envolvió su llave, el valor de comprobación y si está
  // abierta para la IA. Todo lo demás (cifrar, descifrar, las llaves abiertas) vive en seal.js. Acá se hace que el
  // resto de la app no se entere: una nota de una carpeta protegida se lee y se guarda como cualquier otra, y lo que
  // viaja y lo que queda en la copia local va cifrado. Con la carpeta bloqueada, leer o guardar sale con vault_locked.
  const S = LMD.store; const Z = LMD.seal;
  let vaultCache = null; let vaultAt = 0; let vaultOk = true;
  async function vaults(fresh) {
    await ready();
    if (!base || !session) return [];
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
  async function putNote(path, text) {
    try { return await api('PUT', notePath(path), { text: await wire(path, text) }); }
    catch (e) {
      // La carpeta se protegió, o dejó de estarlo, desde otra pestaña: se vuelve a mirar y se manda como corresponde.
      if (e.code !== 'vault' && e.code !== 'vault_text') throw e;
      await vaults(true);
      return api('PUT', notePath(path), { text: await wire(path, text) });
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
          let now = null;
          // Lo pendiente de una carpeta bloqueada espera a que se la desbloquee: sin la llave no se puede juntar.
          try { now = await copyOf(c.path); } catch (e) { return false; }
          if (!now || !now.pending) return false;
          try {
            const n = await getNote(c.path);
            const r = await settle(c.path, now.base, now.text, n.text);
            if (r.text !== n.text) await putNote(c.path, r.text);
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
              if (line) { try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'vault') vaultAt = 0; onEvent(ev); } catch (e) { /* evento ilegible */ } }
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
        const n = await getNote(path); roles[path] = n.role || 'owner';
        // La copia local sigue al servidor mientras no tenga cambios propios sin subir.
        const copy = await copyOf(path);
        if (copy && !copy.pending && copy.text !== n.text) await keep(path, n.text, n.text, false);
        return { text: async () => n.text, lastModified: n.updated, size: n.text.length };
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
        if (!Z.sealed(got.text)) await api('PUT', notePath(n.path), { text: await Z.seal(key, n.path, got.text) });
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
        if (Z.sealed(got.text)) await api('PUT', notePath(n.path), { text: await Z.open(key, n.path, got.text) });
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
    ready, api, list: listOr, handle, events, split, merge3, settle, open, hold, flush, kept,
    read: (p) => getNote(p),
    // Antes de subir, lo escrito queda guardado acá como pendiente: si no hay conexión, espera en la cola.
    stash: (p, text, was) => keep(p, text, was, true),
    // Dentro, hacia o desde una carpeta protegida, mover es volver a cifrar: el texto cifrado está atado a su ruta.
    // El servidor recibe el texto que corresponde a la ruta nueva, y lo que se leyó (updated) para no pisar un cambio.
    rename: async (from, to) => {
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
      session = ''; email = ''; listCache = null; vaultCache = null; await remember();
    },
    account: () => api('GET', '/account'),
    create: (path) => putNote(path, '').then((r) => { listCache = null; return r; }),
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
    reset: () => { loaded = null; listCache = null; vaultCache = null; },
    write: (path, text) => putNote(path, text).then((r) => { listCache = null; return r; }),
    // Una versión del historial, en claro. Las de una nota protegida están cifradas con la ruta que tenía entonces.
    version: async (id, path) => {
      const v = await api('GET', '/version/' + id);
      if (Z.sealed(v.text)) v.text = await Z.open(await keyOf(await vaultFor(path)), v.aad || v.path, v.text);
      return v;
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
    vaultAiLock: async (id) => { const v = await api('POST', '/vaults/' + id + '/lock', {}); await vaults(true); return v; },
  };
})();
