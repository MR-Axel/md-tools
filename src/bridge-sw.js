// El lado de la extensión del puente con la app web, y el botón de la barra.
//
// Un solo depósito: las notas "En este navegador" y la lista de archivos y carpetas abiertos viven en el
// almacenamiento de la extensión. La app web (sharpmd.app/src/app.html) los lee y los escribe por acá, a través del
// script de contenido src/bridge-cs.js, que es el único que puede mandar estos mensajes.
//
// Lo que cruza: notas del navegador, la lista de recientes (nombre, tipo y fecha, nunca el permiso sobre la carpeta),
// las preferencias de la lista PREFS y la sesión de la nube, solo si los dos lados usan el mismo servidor. Lo que no
// cruza nunca: las copias de las notas de la nube, las llaves de las carpetas protegidas y el resto de chrome.storage.
//
// También atiende al lector de un archivo del disco (file://), que no puede hablarle al servidor de sincronización
// por su origen: sus pedidos salen de acá, a una lista cerrada de rutas del servidor configurado (cloudApi).
(function () {
  'use strict';
  const S = LMD.store;
  const WEB = LMD.WEB_APP_URL;
  const WEB_AT = new URL(WEB);
  const OWN = chrome.runtime.getURL('src/app.html');

  // Preferencias que comparten los dos lados. El servidor, el plan y el CSS propio quedan de cada lado.
  const PREFS = ['language', 'theme', 'accent', 'centered', 'contentWidth', 'fontSize', 'fontFamily', 'lineHeight', 'wrapCode', 'autosave', 'autosaveDelay',
    'codeColor', 'diagramShape', 'focusMode', 'typewriter', 'filesOnlyMarkdown', 'filesShowHidden', 'plugins', 'openIn', 'imageQuality'];
  const NAME_MAX = 200; const TEXT_MAX = 8e6; const LAST_MAX = 2000;

  // La misma huella que calcula src/bridge.js: largo y FNV-1a del texto.
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return text.length.toString(36) + '.' + (h >>> 0).toString(36);
  }
  const stored = (k) => chrome.storage.local.get(k).then((r) => r[k]);
  const bump = (by) => chrome.storage.local.set({ bridgeRev: { at: Date.now(), by: typeof by === 'string' ? by.slice(0, 24) : '' } });
  async function depot() {
    let id = await stored('bridgeDepot');
    if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); await chrome.storage.local.set({ bridgeDepot: id }); }
    return id;
  }

  // ---------- Forma de lo que llega ----------
  const isName = (n) => typeof n === 'string' && n.length > 0 && n.length <= NAME_MAX && !/[\/\\\u0000-\u001f]/.test(n);
  const isText = (t) => typeof t === 'string' && t.length <= TEXT_MAX;
  const isBase = (b) => b == null || (typeof b === 'string' && b.length <= 40);
  const isKind = (k) => k === 'dir' || k === 'file';
  const isAt = (n) => typeof n === 'number' && isFinite(n) && n >= 0;
  const isLast = (l) => typeof l === 'string' && l.length <= LAST_MAX && !/[\u0000-\u001f]/.test(l);
  function cleanPrefs(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    PREFS.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) return;
      const v = patch[k]; const d = LMD.DEFAULTS[k];
      if (k === 'plugins') {
        if (!v || typeof v !== 'object') return;
        const p = {};
        Object.keys(d).forEach((name) => { if (typeof v[name] === 'boolean') p[name] = v[name]; });
        out.plugins = p; return;
      }
      if (typeof v !== typeof d) return;
      if (typeof v === 'number' && !isFinite(v)) return;
      if (typeof v === 'string' && v.length > 200) return;
      if (k === 'openIn' && v !== 'web' && v !== 'ext') return;
      if (k === 'imageQuality' && v !== 'normal' && v !== 'high' && v !== 'original') return;
      out[k] = v;
    });
    return out;
  }
  const pickPrefs = (s) => { const out = {}; PREFS.forEach((k) => { out[k] = s[k]; }); return out; };

  // ---------- Notas del navegador ----------
  async function freeName(name) {
    const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; n < 500; n++) { const cand = stem + '-' + n + ext; if (!(await S.noteGet(cand))) return cand; }
    return stem + '-' + Date.now().toString(36) + ext;
  }
  const rootKey = (r) => r.kind + ':' + r.name;
  const tail = (last) => String(last || '').split('/').slice(1).join('/');

  const OPS = {
    hello: async () => {
      let fileAccess = null;
      try { fileAccess = await chrome.extension.isAllowedFileSchemeAccess(); } catch (e) { /* no se pudo saber */ }
      return { v: chrome.runtime.getManifest().version, depot: await depot(), fileAccess };
    },
    'notes.list': async () => ({ list: (await S.notesAll()).map((n) => ({ name: n.name, at: n.at || 0, h: hash(n.text || '') })) }),
    'notes.get': async (a) => {
      if (!isName(a.name)) return null;
      const n = await S.noteGet(a.name);
      return { note: n ? { name: n.name, text: n.text || '', at: n.at || 0 } : null };
    },
    // base es la huella de lo último que los dos lados tenían igual. Si lo guardado acá cambió desde entonces y no es
    // lo mismo que llega, no se pisa: lo de acá queda en una copia con sufijo y la respuesta dice cuál.
    'notes.put': async (a, by) => {
      if (!isName(a.name) || !isText(a.text) || !isBase(a.base)) return null;
      const cur = await S.noteGet(a.name); let kept = '';
      if (cur && cur.text === a.text) return { h: hash(a.text), kept };
      if (cur && hash(cur.text || '') !== a.base) {
        kept = await freeName(a.name);
        await S.handlesPut({ key: 'note:' + kept, note: true, name: kept, text: cur.text, at: cur.at || Date.now() });
      }
      if (!(await S.notePut(a.name, a.text))) return { failed: true };
      await bump(by);
      return { h: hash(a.text), kept };
    },
    'notes.del': async (a, by) => {
      if (!isName(a.name) || !isBase(a.base)) return null;
      const cur = await S.noteGet(a.name);
      if (!cur) return { gone: true };
      if (hash(cur.text || '') !== a.base) return { gone: false }; // cambió de este lado: se conserva
      await S.noteDelete(a.name); await bump(by);
      return { gone: true };
    },

    // ---------- Recientes: solo el nombre, el tipo, la fecha y la última nota abierta adentro ----------
    'roots.list': async () => ({ list: (await S.rootsAll()).filter((r) => isKind(r.kind) && typeof r.name === 'string').map((r) => ({ kind: r.kind, name: r.name, at: r.at || 0, last: tail(r.last), here: !r.ghost })) }),
    'roots.put': async (a, by) => {
      if (!isKind(a.kind) || !isName(a.name) || !isAt(a.at) || !isLast(a.last || '')) return null;
      const same = (await S.rootsAll()).filter((r) => rootKey(r) === a.kind + ':' + a.name);
      if (same.some((r) => !r.ghost)) return {};
      const g = same[0] || { key: '', root: true, ghost: true, id: 'g' + Math.random().toString(36).slice(2, 10), kind: a.kind, name: a.name };
      if (g.key && g.at === a.at) return {};
      g.key = 'root:' + g.id; g.at = a.at; g.last = g.id + '/' + (a.last || '');
      await S.handlesPut(g); await bump(by);
      return {};
    },
    'roots.del': async (a, by) => {
      if (!isKind(a.kind) || !isName(a.name)) return null;
      const same = (await S.rootsAll()).filter((r) => rootKey(r) === a.kind + ':' + a.name);
      for (const r of same) await S.handlesDelete(r.key);
      if (same.length) await bump(by);
      return {};
    },

    'prefs.get': async () => ({ prefs: pickPrefs(await LMD.load()) }),
    'prefs.set': async (a) => {
      const patch = cleanPrefs(a.patch);
      if (Object.keys(patch).length) await LMD.patch(patch);
      return {};
    },
    // La web avisa que su service worker ya la tiene guardada: desde ahí el botón la abre también sin conexión.
    'web.ready': async () => { await chrome.storage.local.set({ webReady: { at: Date.now() } }); return {}; },
    // Un enlace https que abre un archivo del disco: la app ya preguntó, y la pestaña que pide pasa a esa dirección.
    'file.open': (a, by, sender) => openFile(a, sender, true),
    // Si la web puede leer ese archivo por acá. Lo decide la lista de carpetas, sin mirar el disco: no dice si existe.
    'file.can': async (a) => { const url = a && typeof a.url === 'string' && a.url.startsWith('file:///') ? LMD.fileUrl(a.url) : ''; return url ? { can: await readable(url) } : null; },
    // Lo mismo, pero el texto vuelve a la app web, que lo muestra adentro como copia.
    'file.read': (a) => readFile(a),
    'file.list': (a) => listDir(a),
    'file.folder': (a, by, sender) => viewDir(a, sender),
    // La sesión de la nube, una sola entre la web y la extensión (ver "La sesión de la nube", más abajo).
    'session.get': (a) => sessionGet(a),
    'session.put': (a) => sessionPut(a),
    'session.clear': (a) => sessionClear(a),
    // La pantalla de la extensión donde se activa "Permitir acceso a URL de archivo".
    'file.setup': async () => { if (tooMany()) return { opened: false, why: 'limit' }; return openSetup(); },
  };

  // ---------- Abrir un archivo del disco por enlace ----------
  // Acá se vuelve a validar todo, venga de donde venga: solo file:, sin servidor, con extensión de Markdown, sin "..",
  // sin caracteres de control y de un largo razonable (LMD.fileUrl), y con un tope de pedidos por minuto. La página
  // no recibe nada del archivo: solo si se pudo abrir, y si no, por qué.
  const OPEN_MAX = 10; const opened = [];
  function tooMany() {
    const now = Date.now();
    while (opened.length && now - opened[0] > 60000) opened.shift();
    if (opened.length >= OPEN_MAX) return true;
    opened.push(now); return false;
  }
  // web: lo pide la app web por el puente. Ahí la pregunta la dibujó la página, así que abrir el archivo en el lector
  // no habilita su carpeta para la web por sí solo (ver "Qué archivos puede leer la app web"). Con grant, además, el
  // archivo va a una pestaña nueva y el lector pregunta ahí, con una ventana de la extensión, si se habilita.
  const BY_WEB = 'byWeb'; const BY_WEB_MAX = 12 * 3600000;
  const session = chrome.storage.session || chrome.storage.local;
  async function markByWeb(tabId, url, grant) {
    const all = (await session.get(BY_WEB))[BY_WEB] || {}; const now = Date.now();
    Object.keys(all).forEach((k) => { if (now - (all[k].at || 0) > BY_WEB_MAX) delete all[k]; });
    all[tabId] = { key: pathKey(url), grant: grant === true, at: now };
    await session.set({ [BY_WEB]: all });
  }
  async function openFile(a, sender, web) {
    const url = a && typeof a.url === 'string' && a.url.startsWith('file:///') ? LMD.fileUrl(a.url) : '';
    if (!url || !sender || !sender.tab || typeof sender.tab.id !== 'number') return null;
    if (a.grant != null && a.grant !== true) return null;
    if (tooMany()) return { opened: false, why: 'limit' };
    let allowed = false;
    try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch (e) { /* no se pudo saber */ }
    if (!allowed) return { opened: false, why: 'access' };
    try { const res = await fetch(url, { cache: 'no-store' }); if (res.body) res.body.cancel().catch(() => {}); if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status); }
    catch (e) { return { opened: false, why: 'missing' }; }
    try {
      if (web && a.grant === true) { const tab = await chrome.tabs.create({ url, openerTabId: sender.tab.id }); await markByWeb(tab.id, url, true); }
      else { if (web) await markByWeb(sender.tab.id, url, false); await chrome.tabs.update(sender.tab.id, { url }); }
    } catch (e) { return { opened: false, why: 'access' }; }
    return { opened: true };
  }
  // ---------- Qué archivos puede leer la app web ----------
  // La pregunta de "¿abrir este archivo?" la dibuja la página, así que no alcanza: si el sitio fuera vulnerado, podría
  // pedir cualquier ruta. Por eso la extensión solo entrega lo que está dentro de algo que la persona ya abrió con
  // ella: la carpeta (con sus subcarpetas) de un archivo abierto en el lector de file://. Si esa carpeta está muy
  // arriba (la raíz de una unidad, la carpeta personal), vale solo ese archivo. La lista vive en el almacenamiento
  // de la extensión (webFiles), con tope, y la anota el service worker con la dirección que informa el navegador,
  // nunca con una que mande una página. Se ve, se vacía y se apaga en Ajustes > Instalar. Las carpetas abiertas con
  // el selector en la app no cuentan: de ellas el navegador no dice la ruta.
  const ROOTS_MAX = 20; const DEEP = 3;
  // La ruta para comparar: sin codificar, con "." y ".." ya resueltos por el analizador de direcciones, y en
  // minúsculas si es de una unidad de Windows (ahí C:\Notas y c:\notas son lo mismo). '' si no es un archivo local.
  function pathKey(url) {
    let u = null; let p = '';
    try { u = new URL(url); p = decodeURIComponent(u.pathname); } catch (e) { return ''; }
    if (u.protocol !== 'file:' || u.host || /[\u0000-\u001f\\]/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p) || p.includes('//')) return '';
    return /^\/[a-z]:\//i.test(p) ? p.toLowerCase() : p;
  }
  const webFiles = async () => { const w = (await stored('webFiles')) || {}; return { off: w.off === true, roots: Array.isArray(w.roots) ? w.roots.filter((r) => r && typeof r.url === 'string') : [] }; };
  const inside = (key, root) => { const k = pathKey(root.url); return !!k && (root.dir ? k.endsWith('/') && key.startsWith(k) : key === k); };
  async function readable(url) {
    const key = pathKey(url); const w = await webFiles();
    return !!key && !w.off && w.roots.some((r) => inside(key, r));
  }
  // El lector abrió un archivo del disco: su carpeta pasa a la lista (o solo el archivo, si la carpeta está muy arriba).
  // Si a ese archivo lo abrió la app web por el puente, no: ahí devuelve 'ask' cuando corresponde preguntar, y la
  // carpeta entra recién con grant, que el lector manda después del clic de la persona en la ventana de la extensión.
  async function seen(sender, grant) {
    if (!fromReader(sender)) return false;
    const url = LMD.fileUrl(String(sender.url).split(/[?#]/)[0]); const key = pathKey(url);
    if (!key) return false;
    const all = (await session.get(BY_WEB))[BY_WEB] || {}; const mark = all[sender.tab.id];
    if (mark && mark.key === key) {
      if (!mark.grant) return false;
      if (grant !== true) return (await readable(url)) ? true : 'ask';
      delete all[sender.tab.id]; await session.set({ [BY_WEB]: all });
    }
    const depth = key.split('/').length - 2 - (/^\/[a-z]:\//.test(key) ? 1 : 0); // carpetas por encima del archivo, sin contar la unidad
    const dir = depth >= DEEP;
    const rec = { url: dir ? new URL('.', url).href : url, dir, at: Date.now() };
    const w = await webFiles(); const mine = pathKey(rec.url);
    // Una carpeta ya cubierta por otra de la lista no se suma, y una nueva reemplaza a las que quedan adentro.
    const covered = w.roots.find((r) => r.dir && inside(mine, r));
    if (covered) { if (Date.now() - (covered.at || 0) < 60000) return true; covered.at = Date.now(); }
    const roots = (covered ? w.roots : [rec].concat(w.roots.filter((r) => !inside(pathKey(r.url), rec)))).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, ROOTS_MAX);
    await chrome.storage.local.set({ webFiles: { off: w.off, roots } });
    return true;
  }
  function onSeen(msg, sender, sendResponse) { seen(sender, msg && msg.grant).then((r) => sendResponse({ ok: r === true, ask: r === 'ask' }), () => sendResponse({ ok: false })); return true; }

  // Leer y listar dentro de una carpeta habilitada tiene su propio tope, más alto que el de abrir pestañas: seguir
  // los enlaces de una nota y dibujar su carpeta son varios pedidos seguidos.
  const READ_MAX = 60; const reads = [];
  function tooManyReads() {
    const now = Date.now();
    while (reads.length && now - reads[0] > 60000) reads.shift();
    if (reads.length >= READ_MAX) return true;
    reads.push(now); return false;
  }
  // Qué hay en una carpeta habilitada (o en una de adentro): nombres de carpetas y de los archivos que SharpMD abre,
  // nada más. Sale del listado que arma el navegador para file:///carpeta/, el mismo que usa el lector. Fuera de las
  // carpetas habilitadas, o con la lectura apagada, responde lo mismo exista o no la carpeta, sin mirar el disco.
  const LIST_MAX = 1000; const LISTED = /\.(md|markdown|mdx|mkd|mdown|txt|json|ya?ml)$/i;
  // "Ver la carpeta en el navegador": el listado que arma el navegador para esa carpeta, en una pestaña nueva. Mismas
  // reglas (solo carpetas habilitadas, sin decir si existe), y con el tope de las pestañas que se abren.
  async function viewDir(a, sender) {
    const raw = a && typeof a.url === 'string' ? a.url : ''; let plain = raw;
    if (!/^file:\/\/\/[^\/\\]/.test(raw) || raw.length > 2048 || !raw.endsWith('/') || /[\u0000-\u001f\u007f\\?#]/.test(raw) || !sender || !sender.tab) return null;
    try { plain = decodeURIComponent(raw); } catch (e) { return null; }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(raw) || /(^|[\\/])\.\.([\\/]|$)/.test(plain) || /[\u0000-\u001f\u007f\\]/.test(plain)) return null;
    const key = pathKey(raw);
    if (!key || !key.endsWith('/')) return null;
    const w = await webFiles();
    if (w.off || !w.roots.some((r) => r.dir && inside(key, r))) return { opened: false, why: 'refused' };
    if (tooMany()) return { opened: false, why: 'limit' };
    if ((await fileAccess()) === false) return { opened: false, why: 'access' };
    try { await chrome.tabs.create({ url: new URL(raw).href, openerTabId: sender.tab.id }); } catch (e) { return { opened: false, why: 'access' }; }
    return { opened: true };
  }
  async function listDir(a) {
    const raw = a && typeof a.url === 'string' ? a.url : ''; let plain = raw;
    if (!/^file:\/\/\/[^\/\\]/.test(raw) || raw.length > 2048 || !raw.endsWith('/') || /[\u0000-\u001f\u007f\\?#]/.test(raw)) return null;
    try { plain = decodeURIComponent(raw); } catch (e) { return null; }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(raw) || /(^|[\\/])\.\.([\\/]|$)/.test(plain) || /[\u0000-\u001f\u007f\\]/.test(plain)) return null;
    const key = pathKey(raw);
    if (!key || !key.endsWith('/')) return null;
    const w = await webFiles();
    if (w.off || !w.roots.some((r) => r.dir && inside(key, r))) return { listed: false, why: 'refused' };
    if (tooManyReads()) return { listed: false, why: 'limit' };
    // Sin el permiso para archivos del disco no hay listado: se dice eso, y no que la carpeta no está.
    if ((await fileAccess()) === false) return { listed: false, why: 'access' };
    let html = '';
    try { const res = await fetch(new URL(raw).href, { cache: 'no-store' }); if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status); html = await res.text(); }
    catch (e) { return { listed: false, why: 'missing' }; }
    const rows = []; const re = /addRow\((.*)\);/g; let m;
    while ((m = re.exec(html)) && rows.length < LIST_MAX) {
      try {
        const row = JSON.parse('[' + m[1] + ']'); const name = row[0]; const dir = !!row[2];
        if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.length > NAME_MAX || /[\/\\\u0000-\u001f]/.test(name)) continue;
        if (dir || LISTED.test(name)) rows.push({ name, dir });
      } catch (e) { /* fila ilegible */ }
    }
    return { listed: true, rows };
  }

  // El texto de ese archivo, con la misma validación y el mismo tope, y solo si está en la lista de arriba. Fuera de
  // ella (o con la lectura apagada) responde lo mismo exista o no el archivo: no sirve para averiguar qué hay en el disco.
  async function readFile(a) {
    const url = a && typeof a.url === 'string' && a.url.startsWith('file:///') ? LMD.fileUrl(a.url) : '';
    if (!url) return null;
    if (!(await readable(url))) return { opened: false, why: 'refused' }; // antes del tope: no dice nada, así que no hay qué frenar
    if (tooManyReads()) return { opened: false, why: 'limit' };
    let allowed = false;
    try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch (e) { /* no se pudo saber */ }
    if (!allowed) return { opened: false, why: 'access' };
    let text = '';
    try { const res = await fetch(url, { cache: 'no-store' }); if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status); text = await res.text(); }
    catch (e) { return { opened: false, why: 'missing' }; }
    if (text.length > TEXT_MAX) return { opened: false, why: 'size' };
    let name = 'note.md';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || name; } catch (e) { /* queda el nombre de respaldo */ }
    return { opened: true, name, text };
  }

  // ---------- La sesión de la nube ----------
  // Vive donde siempre: chrome.storage.local.cloud ({ session, email, at }), que leen la página de la extensión y el
  // lector. La app web publica la suya, lee la de acá o pide cerrarla, y solo si su servidor es el mismo que el de
  // acá: con la nube apagada o con otro servidor de un lado, cada lado sigue con lo suyo y no se contesta nada.
  // Con dos cuentas distintas no se pisa ninguna: se anota (bridgeOther) para decirlo en Ajustes, y solo se cambia
  // con force, que la app manda después de que la persona lo confirma.
  const cleanBase = (u) => { const b = String(u || '').trim().replace(/\/+$/, ''); return /^off$/i.test(b) ? '' : b; };
  const baseHere = async () => cleanBase((await LMD.load()).cloudUrl || LMD.CLOUD_URL);
  const isUrl = (u) => typeof u === 'string' && u.length <= 300 && /^https?:\/\/\S+$/.test(u);
  const isSession = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(s);
  const isMail = (m) => typeof m === 'string' && m.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(m);
  // La sesión guardada acá, si es del servidor de ahora. Una guardada antes de anotar el servidor vale como de este.
  async function sessionHere(base) {
    const c = (await stored('cloud')) || {};
    return c.session && (!c.at || c.at === base) && isMail(c.email) ? { session: String(c.session), email: c.email } : null;
  }
  async function sameServer(a) {
    if (!isUrl(a.base)) return '';
    const base = await baseHere();
    return base && base === cleanBase(a.base) ? base : '';
  }
  const other = (email) => (email ? chrome.storage.local.set({ bridgeOther: { email } }) : chrome.storage.local.remove('bridgeOther'));
  // email: la cuenta de quien pregunta, si tiene. Con otra cuenta de este lado queda anotado que son dos.
  async function sessionGet(a) {
    if (a.email != null && a.email !== '' && !isMail(a.email)) return null;
    const base = await sameServer(a);
    if (!base) return { same: false };
    const here = await sessionHere(base);
    await other(here && a.email && a.email !== here.email ? a.email : '');
    return { same: true, email: here ? here.email : '', session: here ? here.session : '' };
  }
  async function sessionPut(a) {
    if (!isSession(a.session) || !isMail(a.email) || !isUrl(a.base)) return null;
    const base = await sameServer(a);
    if (!base) return { same: false };
    const here = await sessionHere(base);
    if (here && here.email !== a.email) {
      if (a.force !== true) { await other(a.email); return { same: true, conflict: here.email }; }
      await forget(here.email);
    }
    await chrome.storage.local.set({ cloud: { session: a.session, email: a.email, at: base } });
    await other('');
    return { same: true };
  }
  async function sessionClear(a) {
    if (!isMail(a.email) || !isUrl(a.base)) return null;
    const base = await sameServer(a);
    if (!base) return { same: false };
    const here = await sessionHere(base);
    if (!here || here.email !== a.email) return { same: true, cleared: false };
    await forget(here.email);
    await chrome.storage.local.set({ cloud: { session: '', email: '', at: base } });
    await other('');
    return { same: true, cleared: true };
  }
  // Como al salir desde la app: se van las copias locales ya subidas y las llaves de las carpetas protegidas.
  async function forget(email) {
    try { for (const c of await S.cloudAll(email)) if (!c.pending) await S.cloudDelete(email, c.path); } catch (e) { /* sin base local */ }
    try { if (LMD.seal && LMD.seal.forgetAll) await LMD.seal.forgetAll(email); } catch (e) { /* no había llaves */ }
  }

  // ---------- El servidor de sincronización, para el lector de un archivo del disco ----------
  // El lector corre sobre file://, y desde ese origen el servidor no contesta. El pedido sale de acá, con la sesión
  // guardada, al servidor configurado y solo a estas rutas: las de la cuenta, los tokens, el plan y el equipo, la
  // galería, las automatizaciones y copiar una nota a la nube. No es un pase libre: ni otras rutas ni otro servidor.
  // De la papelera, lo que el explorador del lector muestra: verla y restaurar una nota. Borrar del todo y vaciarla
  // quedan en la app, igual que eliminar una nota.
  const SEG = '[^/?#]+'; const QS = '(\\?[^#]*)?';
  const ROUTES = [
    ['POST', '/auth/(start|verify|logout)'],
    ['GET|PUT|DELETE', '/account'],
    ['GET', '/notes(\\?o=\\d+)?'], ['GET|PUT', '/notes/' + SEG + '(\\?o=\\d+)?'],
    ['GET|POST', '/tokens'], ['DELETE', '/tokens/\\d+'],
    ['GET', '/vaults'], ['GET', '/team/vault'],
    ['GET', '/trash(\\?o=\\d+)?'], ['POST', '/trash/\\d+/restore(\\?o=\\d+)?'],
    ['GET|PUT', '/team'], ['GET', '/team/log' + QS], ['PUT', '/team/policies'],
    ['POST', '/team/(invite|role|accept|decline|remove|leave|seats)'],
    ['GET|POST', '/team/tokens'], ['DELETE', '/team/(tokens|invites)/\\d+'],
    ['GET', '/gallery' + QS], ['POST', '/gallery'], ['GET|POST|DELETE', '/gallery/' + SEG + '(/' + SEG + ')?'],
    ['GET', '/automations' + QS], ['POST', '/automations/(hooks|inboxes)'], ['GET|POST|PUT|DELETE', '/automations/(hooks|inboxes)/' + SEG + '(/' + SEG + ')?' + QS],
    ['POST', '/feedback'],
  ].map((r) => [r[0].split('|'), new RegExp('^' + r[1] + '$')]);
  const routed = (method, path) => typeof method === 'string' && typeof path === 'string' && path.length <= 2000 && !/[\u0000-\u0020\\]|\/\/|\/(\.|%2e){1,2}(\/|\?|$)/i.test(path) && // "." y "..", también codificados, saldrían de la ruta
    ROUTES.some((r) => r[0].includes(method) && r[1].test(path));
  // Solo el lector de esta extensión, en el marco principal de una pestaña que muestra un archivo del disco.
  const fromReader = (sender) => !!sender && sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && /^file:\/\/\//.test(sender.url || '');
  function onCloud(msg, sender, sendResponse) {
    if (!fromReader(sender) || !routed(msg.method, msg.path)) { sendResponse({ ok: false, error: 'refused' }); return false; }
    (async () => {
      const base = await baseHere();
      if (!base) return { ok: false, error: 'no_server' };
      const here = msg.auth === false ? null : await sessionHere(base);
      let body;
      if (msg.body !== undefined) { body = JSON.stringify(msg.body); if (body.length > TEXT_MAX * 2) return { ok: false, error: 'refused' }; }
      let res;
      try { res = await fetch(base + msg.path, { method: msg.method, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: Object.assign({ 'content-type': 'application/json' }, here ? { authorization: 'Bearer ' + here.session } : {}), body }); }
      catch (e) { return { ok: false, error: 'offline' }; }
      let json = null;
      try { json = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
      return { ok: true, status: res.status, json, retry: +(res.headers.get('retry-after') || 0) || 0 };
    })().then(sendResponse, () => sendResponse({ ok: false, error: 'offline' }));
    return true;
  }

  // La página de la app dentro de la extensión pide lo mismo, sin pasar por el puente.
  function onOwn(msg, sender, sendResponse) {
    const mine = !!sender && sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && isApp(sender.url, OWN);
    if (!mine) { sendResponse({ ok: false, error: 'refused' }); return false; }
    openFile(msg, sender).then((r) => sendResponse(r ? Object.assign({ ok: true }, r) : { ok: false, error: 'shape' }), () => sendResponse({ ok: false, error: 'failed' }));
    return true;
  }

  // Solo la pestaña de la app web, en su marco principal, y solo a través del script de contenido de esta extensión.
  function trusted(sender) {
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
    let at = null;
    try { at = new URL(sender.url || ''); } catch (e) { return false; }
    return at.origin === WEB_AT.origin && at.pathname === WEB_AT.pathname && (!sender.origin || sender.origin === WEB_AT.origin);
  }
  // Los pedidos van de a uno: dos escrituras seguidas no se cruzan.
  let line = Promise.resolve();
  function onMessage(msg, sender, sendResponse) {
    const op = msg && typeof msg.op === 'string' && Object.prototype.hasOwnProperty.call(OPS, msg.op) ? OPS[msg.op] : null;
    if (!op || !trusted(sender)) { sendResponse({ ok: false, error: 'refused' }); return false; }
    const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
    line = line.then(() => op(args, msg.by, sender)).then((r) => sendResponse(r ? Object.assign({ ok: true }, r) : { ok: false, error: 'shape' }), (e) => sendResponse({ ok: false, error: String(e && e.message || e).slice(0, 120) }));
    return true;
  }

  // ---------- El botón de la barra ----------
  const isApp = (url, base) => !!url && (url === base || url.startsWith(base + '?') || url.startsWith(base + '#'));
  // Sin el permiso "tabs": las direcciones de las páginas propias y de los sitios con permiso ya vienen.
  async function findTab(base) {
    const tab = (await chrome.tabs.query({})).find((x) => isApp(x.url, base));
    if (tab || !base.startsWith(chrome.runtime.getURL(''))) return tab || null;
    // La dirección de una página propia no siempre viene en la lista de pestañas: se busca entre las que la extensión tiene abiertas.
    try { const mine = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => isApp(c.documentUrl, base)); return mine ? { id: mine.tabId, windowId: mine.windowId } : null; }
    catch (e) { return null; }
  }
  // Una pestaña de SharpMD que ya está abierta se trae al frente en vez de abrir otra.
  async function show(base) {
    const tab = await findTab(base);
    if (!tab) return chrome.tabs.create({ url: base });
    await focus(tab);
    return tab;
  }
  async function focus(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) { /* la ventana ya no está */ }
  }
  // Una consulta corta: si la web no contesta en ese tiempo, se sigue como sin conexión.
  async function reachable() {
    if (self.navigator && navigator.onLine === false) return false;
    const stop = new AbortController(); const timer = setTimeout(() => stop.abort(), 2500);
    try { return (await fetch(WEB, { method: 'HEAD', cache: 'no-store', credentials: 'omit', signal: stop.signal })).ok; }
    catch (e) { return false; }
    finally { clearTimeout(timer); }
  }
  // La app web cargó en esa pestaña si contesta su script de contenido. Una página de error no lo tiene.
  async function loaded(tabId, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try { const r = await chrome.tabs.sendMessage(tabId, { type: 'bridge-ping' }); if (r && r.ok) return true; } catch (e) { /* todavía no, o no es la app */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  async function openSharp() {
    const s = await LMD.load();
    const own = s.openIn === 'ext';
    if (own) return show(OWN);
    const open = await findTab(WEB);
    if (open) { await focus(open); return open; }
    // Sin conexión y sin la web guardada en este navegador: la página de la extensión, con las mismas notas.
    if (!(await stored('webReady'))) return (await reachable()) ? chrome.tabs.create({ url: WEB }) : show(OWN);
    // La web ya quedó guardada en este navegador: se abre sin esperar. Si no hay red y resulta que no cargó
    // (se borraron los datos del sitio), la pestaña pasa a la página de la extensión.
    const tab = await chrome.tabs.create({ url: WEB });
    if (await reachable()) return tab;
    if (await loaded(tab.id, 6000)) return tab;
    await chrome.storage.local.remove('webReady');
    try { await chrome.tabs.update(tab.id, { url: OWN }); } catch (e) { /* la cerraron */ }
    return tab;
  }

  // ---------- El permiso para archivos del disco ----------
  // Una extensión instalada desde la tienda llega con "Permitir acceso a URL de archivo" apagado, y sin eso no actúa
  // sobre file://. Chrome no deja prenderlo ni pedirlo desde acá: solo la persona, en los detalles de la extensión.
  // Lo que sí se puede es saber cómo está (isAllowedFileSchemeAccess) y llevarla de la mano:
  // - al instalar se abre src/welcome.html, que muestra el paso o, si el permiso ya estaba, qué hacer ahora;
  // - mientras falte, el botón de la barra lleva una marca y abre esa página en vez de la app;
  // - "Ahora no" deja el botón como siempre por unos días (la marca sigue); "No uso archivos del disco" lo apaga
  //   para siempre. Con el permiso prendido se apaga solo.
  // Al cambiar ese permiso el navegador recarga la extensión y cierra sus páginas: por eso, si la persona fue a los
  // ajustes desde acá hace poco y al volver el permiso está, la bienvenida se abre de nuevo, ya en "Listo".
  // Lo anotado vive en chrome.storage.local.fileSetup: { never, later, asked }.
  const WELCOME = chrome.runtime.getURL('src/welcome.html');
  const SETUP = 'fileSetup'; const LATER = 7 * 864e5; const ASKED = 30 * 60000;
  // true o false, o null si no se pudo saber. Con null no se recuerda nada: no se insiste sobre una duda.
  const fileAccess = async () => { try { return (await chrome.extension.isAllowedFileSchemeAccess()) === true; } catch (e) { return null; } };
  const setupGet = async () => { const s = await stored(SETUP); return s && typeof s === 'object' ? s : {}; };
  const setupSet = async (patch) => chrome.storage.local.set({ [SETUP]: Object.assign({}, await setupGet(), patch) });
  const missing = async () => (await fileAccess()) === false && !(await setupGet()).never;
  // La marca del botón, y su texto al pasar el mouse. Devuelve si el permiso falta y todavía se recuerda.
  async function mark() {
    const on = await missing();
    try {
      await chrome.action.setBadgeText({ text: on ? '1' : '' });
      if (on) { await chrome.action.setBadgeBackgroundColor({ color: '#c5f467' }); if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#14161a' }); }
      LMD.setLang((await LMD.load()).language);
      await chrome.action.setTitle({ title: on ? LMD.t('SharpMD: falta un permiso para abrir archivos del disco') : 'SharpMD' });
    } catch (e) { /* sin botón en la barra */ }
    return on;
  }
  // Los ajustes de la extensión en el navegador, en una pestaña nueva. Queda anotado cuándo, para la vuelta.
  async function openSetup() {
    await setupSet({ asked: Date.now() });
    try { const s = await LMD.openExtSettings(); return { opened: true, sure: s.sure }; }
    catch (e) { return { opened: false, why: 'failed' }; }
  }
  async function onAction() {
    let welcome = false;
    try { welcome = (await mark()) && !(Date.now() - ((await setupGet()).later || 0) < LATER); } catch (e) { welcome = false; }
    if (welcome) return show(WELCOME);
    return openSharp();
  }
  chrome.action.onClicked.addListener(() => { onAction().catch(() => chrome.tabs.create({ url: OWN })); });
  // Solo al instalar, no en cada actualización.
  // Instalada desde la tienda, la bienvenida se abre adelante. Cargada sin empaquetar (quien desarrolla, y las pruebas)
  // se abre por detrás: adelante le sacaba el foco a la pestaña en la que se estaba trabajando.
  const unpacked = () => new Promise((done) => { try { chrome.management.getSelf((me) => done(!!me && me.installType === 'development')); } catch (e) { done(false); } });
  chrome.runtime.onInstalled.addListener(async (d) => { if (d && d.reason === 'install') chrome.tabs.create({ url: WELCOME, active: !(await unpacked()) }).catch(() => {}); });
  // Cada vez que el service worker arranca: la marca al día y, si el permiso se acaba de prender, la bienvenida en "Listo".
  (async () => {
    const st = await setupGet();
    if (st.asked && (await fileAccess()) === true) {
      await setupSet({ asked: 0 });
      if (Date.now() - st.asked < ASKED) await show(WELCOME);
    }
    await mark();
  })().catch(() => {});
  // Lo que pide la bienvenida (y Ajustes > Instalar, en la página de la extensión). Nadie más.
  function onSetup(msg, sender, sendResponse) {
    const mine = !!sender && sender.id === chrome.runtime.id && !!sender.tab && sender.frameId === 0 && (isApp(sender.url, WELCOME) || isApp(sender.url, OWN));
    if (!mine) { sendResponse({ ok: false, error: 'refused' }); return false; }
    const leave = async () => { await openSharp().catch(() => chrome.tabs.create({ url: OWN })); if (isApp(sender.url, WELCOME)) await chrome.tabs.remove(sender.tab.id).catch(() => {}); };
    (async () => {
      const act = msg.act;
      if (act === 'open') return openSetup();
      if (act === 'seen') { await setupSet({ asked: 0 }); await mark(); return {}; } // la página vio sola que el permiso ya está
      if (act === 'later') { await setupSet({ later: Date.now() }); await leave(); return {}; }
      if (act === 'never') { await setupSet({ never: true }); await mark(); if (isApp(sender.url, WELCOME)) await leave(); return {}; }
      if (act === 'app') { await leave(); return {}; }
      if (act !== 'state') return null;
      const st = await setupGet(); const s = LMD.extSettings();
      return { access: await fileAccess(), never: st.never === true, sure: s.sure };
    })().then((r) => sendResponse(r ? Object.assign({ ok: true }, r) : { ok: false, error: 'shape' }), () => sendResponse({ ok: false, error: 'failed' }));
    return true;
  }

  LMD.bridgeHost = { onMessage, onOwn, onCloud, onSeen, onSetup, onAction, mark, openSharp, PREFS };
})();
