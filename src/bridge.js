// Un solo depósito entre la app web y la extensión.
//
// Con la extensión instalada, las notas "En este navegador", la lista de archivos y carpetas abiertos y las
// preferencias son las mismas de los dos lados. La dueña es la extensión; la web guarda su copia (para abrir al
// instante, sin conexión y sin la extensión) y la mantiene igual a través de src/bridge-cs.js y src/bridge-sw.js.
// Sin extensión, la web usa su depósito como siempre.
//
// Cómo se igualan: de cada nota se recuerda la huella de la última vez que los dos lados coincidieron. Lo que cambió
// de un solo lado pasa al otro; lo que cambió de los dos se conserva dos veces, una con sufijo. La primera vez no hay
// nada recordado, así que se unen los dos depósitos sin perder nada.
//
// El permiso sobre una carpeta del disco no se puede pasar de un lado al otro: del lado que todavía no lo tiene la
// carpeta figura en la lista y se reconecta eligiéndola una vez (reconnect).
(function () {
  'use strict';
  const S = LMD.store;
  const APP = /\/app\.html$/.test(location.pathname);
  const WEB = APP && window.__MDT_WEB === true;
  const OWN = APP && location.protocol === 'chrome-extension:';
  const me = Math.random().toString(36).slice(2, 10);
  const STATE = 'sharpmd:bridge';
  const o = { handlesAll: S.handlesAll, handlesPut: S.handlesPut, handlesDelete: S.handlesDelete, notesAll: S.notesAll, noteGet: S.noteGet, notePut: S.notePut, noteDelete: S.noteDelete, rootsAll: S.rootsAll };

  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return text.length.toString(36) + '.' + (h >>> 0).toString(36);
  }
  const rootKey = (r) => r.kind + ':' + r.name;
  const tail = (last) => String(last || '').split('/').slice(1).join('/');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changed = () => window.dispatchEvent(new CustomEvent('lmd-store-changed'));

  // Una carpeta recién conectada de este lado reemplaza al renglón que la mostraba sin permiso.
  async function dropGhosts(rec) {
    for (const r of await o.rootsAll()) if (r.ghost && r.key !== rec.key && rootKey(r) === rootKey(rec)) await o.handlesDelete(r.key);
  }

  // ---------- Reconectar una carpeta o un archivo que se abrió del otro lado ----------
  async function reconnect(key, ctx) {
    const rec = (await o.rootsAll()).find((r) => r.key === key && r.ghost);
    if (!rec || !window.showOpenFilePicker) return null;
    const T = LMD.t; const dir = rec.kind === 'dir';
    const go = await LMD.dialog.confirm({
      title: T('Reconectar "{a}"', { a: rec.name }),
      text: T(dir ? 'Esta carpeta se abrió desde el otro lado. Elegila una vez acá y queda.' : 'Este archivo se abrió desde el otro lado. Elegilo una vez acá y queda.'),
      ok: T(dir ? 'Elegir carpeta' : 'Elegir archivo'),
    });
    if (!go) return null;
    // El selector recuerda dónde quedó la última vez para cada id; la primera arranca en Documentos.
    const pid = 'lmd-r-' + hash(rootKey(rec)).replace(/[^a-z0-9]/gi, '').slice(0, 20);
    let handle = null;
    try {
      handle = dir ? await window.showDirectoryPicker({ id: pid, startIn: 'documents', mode: 'readwrite' })
        : (await window.showOpenFilePicker({ id: pid, startIn: 'documents', multiple: false, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }] }))[0];
    } catch (e) { return null; }
    // Si es la misma carpeta, abre la nota en la que había quedado del otro lado; si no, como cualquier carpeta recién elegida.
    let rest = dir && handle.name === rec.name ? tail(rec.last) : '';
    if (rest) { try { await S.walk(handle, rest.split('/').map(decodeURIComponent)); } catch (e) { rest = ''; } }
    if (!rest) return LMD.home.adopt(ctx, handle);
    const real = await adopt(rec, handle);
    return ctx.open(real.last);
  }
  // Con el permiso ya dado: el renglón pasa a ser una carpeta de este lado, y abre donde había quedado.
  async function adopt(rec, handle) {
    let real = null;
    for (const r of await o.rootsAll()) { if (r.ghost || !r.handle) continue; try { if (await r.handle.isSameEntry(handle)) { real = r; break; } } catch (e) { /* permiso vencido */ } }
    if (!real) { const id = Math.random().toString(36).slice(2, 10); real = { key: 'root:' + id, root: true, id }; }
    real.kind = handle.kind === 'directory' ? 'dir' : 'file'; real.name = handle.name; real.handle = handle; real.at = Date.now();
    const rest = handle.name === rec.name && real.kind === rec.kind ? tail(rec.last) : '';
    if (real.kind === 'file') real.last = real.id + '/' + encodeURIComponent(handle.name);
    else if (rest || !real.last) real.last = real.id + '/' + rest;
    await S.handlesPut(real);
    return real;
  }

  const api = { present: () => false, info: () => null, reconnect, adopt, settle: () => Promise.resolve(), sync: () => Promise.resolve(), hash };
  LMD.bridge = api;
  if (!APP) return;

  // Lo que se guarda a través del "archivo" de una nota también pasa por acá.
  const touched = { note: () => {}, root: () => {} };
  S.notePut = async (name, text) => { const r = await o.notePut(name, text); touched.note(); return r; };
  S.noteDelete = async (name) => { const r = await o.noteDelete(name); touched.note(); return r; };
  S.handlesPut = async (rec) => {
    const r = await o.handlesPut(rec);
    if (rec && rec.root) { if (rec.handle && !rec.ghost) await dropGhosts(rec); touched.root(); }
    return r;
  };
  S.handlesDelete = async (key) => { const r = await o.handlesDelete(key); if (/^(root|note):/.test(String(key))) touched.root(); return r; };

  // ---------- Dentro de la extensión: avisar que algo cambió ----------
  if (OWN) {
    let timer = 0;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => { try { chrome.storage.local.set({ bridgeRev: { at: Date.now(), by: me } }); } catch (e) { /* extensión recargada */ } }, 150); };
    touched.note = bump; touched.root = bump;
    try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.bridgeRev && (changes.bridgeRev.newValue || {}).by !== me) changed(); }); } catch (e) { /* sin extensión */ }
    api.present = () => true;
    return;
  }
  if (!WEB) return;

  // ---------- En la web: el cliente del puente ----------
  const present = () => !!document.documentElement.dataset.lmdExt;
  let info = null;
  api.present = () => present() && !!info;
  api.info = () => info;

  let seq = 0; const waits = new Map();
  const call = (op, args) => new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { waits.delete(id); resolve({ ok: false, error: 'timeout' }); }, 8000);
    waits.set(id, (res) => { clearTimeout(timer); waits.delete(id); resolve(res && typeof res === 'object' ? res : { ok: false, error: 'shape' }); });
    window.postMessage({ lmdBridge: 1, dir: 'req', id, op, args: args || {}, by: me }, location.origin);
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.lmdBridge !== 1) return;
    if (d.dir === 'res' && waits.has(d.id)) waits.get(d.id)(d.res);
    else if (d.dir === 'event' && d.by !== me) kick(0);
  });

  const readState = () => { try { return JSON.parse(localStorage.getItem(STATE)) || {}; } catch (e) { return {}; } };
  const writeState = (st) => { try { localStorage.setItem(STATE, JSON.stringify(st)); } catch (e) { /* sin espacio: la próxima vez se compara todo de nuevo */ } };
  const must = (r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'bridge'); return r; };

  // store.js devuelve una lista vacía cuando la base del navegador falla. Antes de comparar se confirma que se puede leer.
  const healthy = () => new Promise((resolve) => {
    try {
      const req = indexedDB.open('lmd-permisos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h', { keyPath: 'key' });
      req.onerror = () => resolve(false); req.onblocked = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try { const q = db.transaction('h').objectStore('h').count(); q.onsuccess = () => { db.close(); resolve(true); }; q.onerror = () => { db.close(); resolve(false); }; }
        catch (e) { db.close(); resolve(false); }
      };
    } catch (e) { resolve(false); }
  });
  // Un lado vacío de golpe, cuando antes había varias cosas, no se toma como "se borró todo": puede ser un depósito
  // que se perdió. Se vuelve a unir como la primera vez, y lo que queda de un lado pasa al otro.
  const lost = (mine, theirs, known) => known >= 2 && (mine === 0 || theirs === 0);

  async function syncNotes(st) {
    let moved = false;
    const remote = new Map(must(await call('notes.list')).list.map((n) => [n.name, n]));
    const local = new Map((await o.notesAll()).map((n) => [n.name, { h: hash(n.text || ''), at: n.at || 0 }]));
    const base = lost(local.size, remote.size, Object.keys(st.notes || {}).length) ? {} : st.notes || {};
    const agreed = {};
    // Antes de pisar o borrar una nota de este lado se vuelve a mirar: si se escribió mientras tanto, queda para la próxima vuelta.
    const still = async (name, h) => { const n = await o.noteGet(name); return (n ? hash(n.text || '') : null) === (h || null); };
    for (const name of new Set([...remote.keys(), ...local.keys()])) {
      const L = local.has(name) ? local.get(name).h : null; const R = remote.has(name) ? remote.get(name).h : null; const B = base[name] || null;
      if (L === R) { if (L) agreed[name] = L; continue; }
      if (L === B || (L === null && R !== B)) {
        // Este lado no cambió (o la borró y del otro siguió cambiando): vale lo de la extensión.
        if (R === null) { if (await still(name, L)) { await o.noteDelete(name); moved = true; } else agreed[name] = B; continue; }
        const got = must(await call('notes.get', { name })).note;
        if (!got) continue;
        if (!(await still(name, L))) { if (B) agreed[name] = B; continue; }
        await o.handlesPut({ key: 'note:' + name, note: true, name, text: got.text, at: got.at || Date.now() });
        agreed[name] = hash(got.text); moved = true; continue;
      }
      if (L === null) {
        // Se borró de este lado y la extensión la tiene como estaba.
        const r = must(await call('notes.del', { name, base: B }));
        if (!r.gone) agreed[name] = B;
        continue;
      }
      // Cambió de este lado. Si también cambió del otro, la extensión guarda su versión en una copia con sufijo.
      const mine = await o.noteGet(name);
      if (!mine) continue;
      const sent = await call('notes.put', { name, text: mine.text || '', base: B });
      // Una nota que el puente no acepta (un nombre raro, un texto enorme) queda de este lado y no frena a las demás.
      if (!sent.ok && sent.error === 'shape') { if (B) agreed[name] = B; continue; }
      const r = must(sent);
      if (r.failed) { if (B) agreed[name] = B; continue; }
      agreed[name] = r.h;
      if (r.kept) {
        const copy = must(await call('notes.get', { name: r.kept })).note;
        if (copy) { await o.handlesPut({ key: 'note:' + copy.name, note: true, name: copy.name, text: copy.text, at: copy.at || Date.now() }); agreed[copy.name] = hash(copy.text); moved = true; }
      }
    }
    st.notes = agreed;
    return moved;
  }

  async function syncRoots(st) {
    let moved = false;
    const remote = new Map(must(await call('roots.list')).list.map((r) => [rootKey(r), r]));
    const all = await o.rootsAll();
    const real = new Map(); const ghost = new Map();
    all.forEach((r) => { if (!r.kind || typeof r.name !== 'string') return; (r.ghost ? ghost : real).set(rootKey(r), r); });
    const base = new Set(lost(real.size + ghost.size, remote.size, (st.roots || []).length) ? [] : st.roots || []);
    for (const [key, r] of real) {
      const there = remote.get(key);
      if (!there && base.has(key)) { await o.handlesDelete(r.key); moved = true; continue; } // se quitó de la lista del otro lado
      if (!there || (!there.here && (r.at || 0) > (there.at || 0) + 1000)) {
        must(await call('roots.put', { kind: r.kind, name: r.name, at: r.at || 0, last: tail(r.last) }));
        remote.set(key, { kind: r.kind, name: r.name });
      }
      if (ghost.has(key)) { await o.handlesDelete(ghost.get(key).key); ghost.delete(key); moved = true; }
    }
    for (const [key, there] of remote) {
      if (real.has(key)) continue;
      const g = ghost.get(key);
      if (!g && base.has(key)) { must(await call('roots.del', { kind: there.kind, name: there.name })); remote.delete(key); continue; } // se quitó de la lista de este lado
      if (g && g.at === there.at) continue;
      const rec = g || { root: true, ghost: true, id: 'g' + Math.random().toString(36).slice(2, 10), kind: there.kind, name: there.name };
      rec.key = 'root:' + rec.id; rec.at = there.at || 0; rec.last = rec.id + '/' + (there.last || '');
      await o.handlesPut(rec); moved = true;
    }
    for (const [key, g] of ghost) if (!remote.has(key)) { await o.handlesDelete(g.key); moved = true; }
    st.roots = [...remote.keys()];
    return moved;
  }

  async function syncPrefs(st) {
    const theirs = must(await call('prefs.get')).prefs; const keys = Object.keys(theirs); const mine = await LMD.load();
    const base = st.prefs || null; const take = {}; const give = {}; const agreed = {};
    keys.forEach((k) => {
      const L = mine[k]; const R = theirs[k]; const D = LMD.DEFAULTS[k];
      agreed[k] = R;
      if (same(L, R)) return;
      // La primera vez gana lo que se haya cambiado; si se cambió de los dos lados, lo de la extensión.
      const B = base && Object.prototype.hasOwnProperty.call(base, k) ? base[k] : (same(R, D) ? R : L);
      if (same(R, B) && !same(L, B)) { give[k] = L; agreed[k] = L; } else take[k] = R;
    });
    if (Object.keys(give).length) must(await call('prefs.set', { patch: give }));
    st.prefs = agreed;
    if (Object.keys(take).length) await LMD.patch(take);
  }

  async function once() {
    if (!present()) { info = null; return; }
    const hi = await call('hello');
    if (!hi.ok) { info = null; return; }
    info = hi;
    if (!(await healthy())) return;
    let st = readState();
    if (st.depot !== hi.depot) st = { depot: hi.depot };
    let moved = false;
    try {
      moved = await syncNotes(st);
      moved = (await syncRoots(st)) || moved;
      await syncPrefs(st);
    } finally { writeState(st); if (moved) changed(); }
  }

  let running = null; let again = false; let timer = 0;
  const locked = (fn) => (navigator.locks && navigator.locks.request ? navigator.locks.request('sharpmd-bridge', fn) : fn());
  function run() {
    if (running) { again = true; return running; }
    running = locked(once).catch(() => { /* la próxima vuelta lo retoma */ }).then(() => { running = null; if (again) { again = false; return run(); } return undefined; });
    return running;
  }
  function kick(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? 250 : ms); }
  touched.note = () => kick(); touched.root = () => kick();
  api.sync = () => run();

  // Lo primero: igualar. Quien abre una nota que todavía no llegó puede esperar a que termine (settle).
  const first = present() ? Promise.race([run(), new Promise((resolve) => setTimeout(resolve, 4000))]) : Promise.resolve();
  api.settle = () => first;
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings && info) kick(); }); } catch (e) { /* sin ajustes */ }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && present()) kick(0); });

  // Cuando el service worker de la web ya tiene la app guardada, la extensión se entera: desde ahí su botón abre la
  // web también sin conexión.
  if (present() && 'serviceWorker' in navigator && window.caches) {
    navigator.serviceWorker.ready.then(async () => {
      const hit = await caches.match(location.origin + location.pathname);
      if (hit) call('web.ready');
    }).catch(() => { /* sin service worker */ });
  }
})();
