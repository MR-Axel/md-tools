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
      handle = dir ? await window.showDirectoryPicker({ id: pid, startIn: 'documents' })
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

  // canOpen: si de este lado hay una extensión que pueda llevar la pestaña a un archivo del disco. openFile lo pide.
  const api = { present: () => false, info: () => null, reconnect, adopt, settle: () => Promise.resolve(), sync: () => Promise.resolve(), hash,
    canOpen: () => false, openFile: () => Promise.resolve({ ok: false, error: 'none' }), setup: () => Promise.resolve({ ok: false, error: 'none' }), setupNever: () => Promise.resolve({ ok: false, error: 'none' }),
    readFile: () => Promise.resolve({ ok: false, error: 'none' }), canRead: () => Promise.resolve(false), listDir: () => Promise.resolve({ ok: false, error: 'none' }), viewFolder: () => Promise.resolve({ ok: false, error: 'none' }),
    // Un texto ya leído por el puente, para que quien abre la nota enseguida no lo pida de nuevo. Sale una sola vez.
    keep: (url, text) => { kept = { url, text, at: Date.now() }; }, take: (url) => { const k = kept; if (!k || k.url !== url) return null; kept = null; return Date.now() - k.at < 15000 ? k.text : null; },
    paintSession };
  let kept = null;
  LMD.bridge = api;

  // ---------- Dos cuentas distintas, una de cada lado ----------
  // La sesión de la nube es una sola entre la web y la extensión. Si cada lado ya tenía la suya, de cuentas distintas,
  // no se pisa ninguna: Ajustes > Nube lo dice. Desde la web se puede elegir que la de ahí quede en los dos.
  let clash = null; let forceMine = false; let resync = () => Promise.resolve();
  async function paintSession(slot, redraw) {
    if (!slot) return;
    const T = LMD.t; let text = ''; let mine = '';
    if (WEB) { if (clash) { text = T('La extensión tiene otra cuenta: {a}. Cada lado sigue con la suya.', { a: clash.theirs }); mine = clash.mine; } }
    else {
      try { const o = (await chrome.storage.local.get('bridgeOther')).bridgeOther; if (o && o.email && LMD.cloud.signedIn() && o.email !== LMD.cloud.email()) text = T('La app web tiene otra cuenta: {a}. Cada lado sigue con la suya.', { a: o.email }); }
      catch (e) { /* sin almacenamiento: no se dice nada */ }
    }
    slot.textContent = '';
    if (!text) return;
    const p = document.createElement('p'); p.className = 'lmd-hint lmd-acct-two'; p.setAttribute('role', 'status'); p.textContent = text + ' ';
    if (mine) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lmd-link'; b.dataset.two = 'mine'; b.textContent = T('Usar {a} en los dos', { a: mine });
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await LMD.dialog.confirm({ title: T('¿Usar {a} en los dos?', { a: mine }), text: T('La extensión sale de la otra cuenta.'), ok: T('Usar esta cuenta') }))) return;
        forceMine = true; await resync(); if (redraw) redraw();
      });
      p.appendChild(b);
    }
    slot.appendChild(p);
  }
  // El lector de un archivo del disco avisa que se abrió: la extensión anota su carpeta entre las que la app web puede
  // leer por enlace (bridge-sw.js). No manda la ruta: el service worker usa la dirección que le informa el navegador.
  // Si a este archivo lo abrió la app web ("abrirlo una vez con la extensión"), la carpeta no entra sola: se pregunta
  // acá, en una ventana de la extensión, que la página web no puede tocar.
  if (!APP && location.protocol === 'file:') {
    const tell = (grant) => new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'fileSeen', grant }, (r) => { void chrome.runtime.lastError; resolve(r || {}); }); } catch (e) { resolve({}); } });
    tell(false).then(async (r) => {
      if (!r.ask) return;
      for (let i = 0; i < 60 && !document.querySelector('.markdown-body'); i++) await new Promise((resolve) => setTimeout(resolve, 250)); // el lector todavía se está armando
      const T = LMD.t; let folder = '';
      try { folder = LMD.filePath(new URL('.', location.href.split(/[?#]/)[0]).href); } catch (e) { /* dirección rara */ }
      const yes = await LMD.dialog.confirm({ title: T('¿Abrir con un clic los enlaces a esta carpeta?'), text: T('La app web va a poder abrir los archivos Markdown de esta carpeta cuando abras un enlace a ellos. Se cambia en Ajustes, en Instalar.'), path: folder, ok: T('Permitir'), cancel: T('Ahora no') });
      if (yes) tell(true);
    });
  }
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
    api.canOpen = () => true;
    api.openFile = (url) => new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'openFile', url }, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: 'gone' } : res)); } catch (e) { resolve({ ok: false, error: 'gone' }); } });
    // Los ajustes de la extensión en el navegador: los abre el service worker, que anota que la persona fue para allá.
    const setup = (act) => new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'fileSetup', act }, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: 'gone' } : res)); } catch (e) { resolve({ ok: false, error: 'gone' }); } });
    api.setup = () => setup('open');
    api.setupNever = () => setup('never');
    return;
  }
  if (!WEB) return;

  // ---------- En la web: el cliente del puente ----------
  const present = () => !!document.documentElement.dataset.lmdExt;
  let info = null;
  api.present = () => present() && !!info;
  api.info = () => info;
  api.canOpen = () => present() && !!info;
  // grant: en una pestaña nueva, donde el lector pregunta si los enlaces a esa carpeta se abren con un clic.
  api.openFile = (url, grant) => call('file.open', grant ? { url, grant: true } : { url });
  // Si la extensión puede entregarle ese archivo a la web: true o false (no dice si el archivo existe), o null si es una
  // extensión anterior, que no conoce el pedido.
  api.canRead = async (url) => { if (!(present() && info)) return false; const r = await Promise.race([call('file.can', { url }), new Promise((resolve) => setTimeout(() => resolve(null), 1500))]); return r && r.ok ? r.can === true : null; };
  api.readFile = (url) => call('file.read', { url });
  // Lo que hay en una carpeta habilitada: nombres de carpetas y de archivos que SharpMD abre.
  api.listDir = (url) => (present() && info ? call('file.list', { url }) : Promise.resolve({ ok: false, error: 'none' }));
  // El listado de una carpeta habilitada, en una pestaña nueva del navegador.
  api.viewFolder = (url) => (present() && info ? call('file.folder', { url }) : Promise.resolve({ ok: false, error: 'none' }));
  api.setup = () => call('file.setup');

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

  // ---------- La sesión de la nube: una sola entre la web y la extensión ----------
  // Entrar de un lado deja la sesión en el otro, y salir de uno sale del otro. De lo último que los dos tenían igual
  // se recuerda solo el correo (st.sess), para saber de qué lado se salió. No corre con la nube apagada, y la
  // extensión no contesta si su servidor es otro: en esos casos cada lado sigue con lo suyo. Con dos cuentas
  // distintas no se toca ninguna (clash), salvo que la persona elija la de acá.
  const cleanBase = (u) => { const b = String(u || '').trim().replace(/\/+$/, ''); return /^off$/i.test(b) ? '' : b; };
  async function syncSession(st) {
    const force = forceMine; forceMine = false; clash = null;
    const base = cleanBase((await LMD.load()).cloudUrl || LMD.CLOUD_URL);
    if (!base || (LMD.cloud && LMD.cloud.guest())) return;
    const c = (await chrome.storage.local.get('cloud')).cloud || {};
    const mine = c.session && c.email && (!c.at || c.at === base) ? { session: String(c.session), email: String(c.email) } : null;
    const r = await call('session.get', { base, email: mine ? mine.email : '' });
    if (!r.ok || !r.same) { delete st.sess; return; } // una extensión anterior, otro servidor o la nube apagada del otro lado
    const theirs = r.session && r.email ? { session: r.session, email: r.email } : null;
    const was = st.sess && st.sess.base === base ? st.sess.email : '';
    const agree = (email) => { st.sess = { base, email }; };
    if (mine && theirs) {
      if (mine.email === theirs.email) { agree(mine.email); return; }
      if (!force) { clash = { mine: mine.email, theirs: theirs.email }; return; }
    }
    if (mine) {
      // La extensión tenía esta misma cuenta y ya no: se salió de ese lado.
      if (!theirs && was === mine.email) { delete st.sess; if (LMD.sync && LMD.sync.dropSession) await LMD.sync.dropSession(); return; }
      const p = await call('session.put', { base, session: mine.session, email: mine.email, force: force && !!theirs });
      if (p.ok && p.same && !p.conflict) agree(mine.email);
      return;
    }
    if (theirs) {
      // Acá se salió de esa cuenta: la extensión sale también.
      if (was === theirs.email) { await call('session.clear', { base, email: theirs.email }); delete st.sess; return; }
      await chrome.storage.local.set({ cloud: { session: theirs.session, email: theirs.email, at: base } }); // cloud.js la vuelve a leer y avisa
      agree(theirs.email);
      return;
    }
    delete st.sess;
  }

  async function once() {
    if (!present()) { info = null; return; }
    const hi = await call('hello');
    if (!hi.ok) { info = null; return; }
    info = hi;
    let st = readState();
    if (st.depot !== hi.depot) st = { depot: hi.depot };
    // La sesión no depende de la base local de notas: va primero y aparte.
    try { await syncSession(st); } catch (e) { /* la próxima vuelta lo retoma */ }
    if (!(await healthy())) { writeState(st); return; }
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
  resync = () => run();
  api.clash = () => clash;

  // Lo primero: igualar. Quien abre una nota que todavía no llegó puede esperar a que termine (settle).
  const first = present() ? Promise.race([run(), new Promise((resolve) => setTimeout(resolve, 4000))]) : Promise.resolve();
  api.settle = () => first;
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.settings || changes.cloud) && info) kick(); }); } catch (e) { /* sin ajustes */ }
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
