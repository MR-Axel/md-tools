// El lado de la extensión del puente con la app web, y el botón de la barra.
//
// Un solo depósito: las notas "En este navegador" y la lista de archivos y carpetas abiertos viven en el
// almacenamiento de la extensión. La app web (sharpmd.app/src/app.html) los lee y los escribe por acá, a través del
// script de contenido src/bridge-cs.js, que es el único que puede mandar estos mensajes.
//
// Lo que cruza: notas del navegador, la lista de recientes (nombre, tipo y fecha, nunca el permiso sobre la carpeta)
// y las preferencias de la lista PREFS. Lo que no cruza nunca: la sesión de la nube, las copias de las notas de la
// nube, las llaves de las carpetas protegidas y el resto de chrome.storage.
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
    'file.open': (a, by, sender) => openFile(a, sender),
    // La pantalla de la extensión donde se activa "Permitir acceso a URL de archivo".
    'file.setup': async () => { if (tooMany()) return { opened: false, why: 'limit' }; await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }); return { opened: true }; },
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
  async function openFile(a, sender) {
    const url = a && typeof a.url === 'string' && a.url.startsWith('file:///') ? LMD.fileUrl(a.url) : '';
    if (!url || !sender || !sender.tab || typeof sender.tab.id !== 'number') return null;
    if (tooMany()) return { opened: false, why: 'limit' };
    let allowed = false;
    try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch (e) { /* no se pudo saber */ }
    if (!allowed) return { opened: false, why: 'access' };
    try { const res = await fetch(url, { cache: 'no-store' }); if (res.body) res.body.cancel().catch(() => {}); if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status); }
    catch (e) { return { opened: false, why: 'missing' }; }
    try { await chrome.tabs.update(sender.tab.id, { url }); } catch (e) { return { opened: false, why: 'access' }; }
    return { opened: true };
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
    if (tab || base !== OWN) return tab || null;
    // La dirección de una página propia no siempre viene en la lista de pestañas: se busca entre las que la extensión tiene abiertas.
    try { const mine = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => isApp(c.documentUrl, OWN)); return mine ? { id: mine.tabId, windowId: mine.windowId } : null; }
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
  chrome.action.onClicked.addListener(() => { openSharp().catch(() => chrome.tabs.create({ url: OWN })); });

  LMD.bridgeHost = { onMessage, onOwn, openSharp, PREFS };
})();
