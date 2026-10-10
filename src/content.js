// SharpMD: reemplaza la vista de texto plano de un archivo Markdown por un lector completo.
(function () {
  'use strict';

  // ---------- ¿Es un documento de texto plano? ----------
  // El lector corre en dos lugares: como script de contenido sobre un .md abierto en el navegador,
  // y en la página propia de la extensión (app.html), donde el archivo llega por un permiso de carpeta.
  // La página propia también se puede servir desde un sitio, sin la extensión (ver web.js).
  const APP = /\/app\.html$/.test(location.pathname) && (location.protocol === 'chrome-extension:' || window.__MDT_WEB === true); // true y nada más: un elemento de la página con ese id no cuenta
  // La página de pago de sharpmd.app puede volver a la app de la extensión (manifest: web_accessible_resources),
  // pero nadie la puede meter dentro de un marco: ahí no arranca.
  if (APP && window.top !== window.self) return;
  let pre = null;
  if (!APP) {
    // El manifest también engancha direcciones que solo terminan en .md en la consulta: acá cuenta la ruta.
    if (!/\.(md|mdx|mkd|mdown|markdown)$/i.test(location.pathname)) return;
    const type = (document.contentType || '').toLowerCase();
    if (type && !/^text\/(plain|markdown|x-markdown)/.test(type)) return;
    pre = document.body && document.body.querySelector('pre');
    if (!pre || document.body.children.length > 2) return;
  }
  // En la app los archivos no tienen URL real: se les da una virtual para poder resolver rutas relativas.
  const VBASE = 'https://lmd.local/';
  const APP_URL = APP ? location.origin + location.pathname : '';
  // En la app el documento cambia sin recargar la página: HERE y DOC_NAME siguen a la nota abierta.
  // Sin nota abierta (noDoc) el centro muestra el estado vacío y HERE queda en la base.
  let HERE = APP ? VBASE : location.href.split('#')[0].split('?')[0];
  let DOC_NAME = APP ? '' : decodeURIComponent(HERE.split('/').pop() || '');
  let noDoc = APP;
  // Una dirección virtual, como consulta de la app: lo que abre esa nota desde el lector de un archivo del disco.
  const appQuery = (url) => '?f=' + encodeURIComponent(url.slice(VBASE.length).split('#')[0]);
  const appHref = (url) => { try { return chrome.runtime.getURL('src/app.html') + appQuery(url); } catch (e) { return '#'; } };
  const toHref = (url) => {
    if (!APP || !url.startsWith(VBASE)) return url;
    const i = url.indexOf('#');
    return APP_URL + '?f=' + encodeURIComponent((i < 0 ? url : url.slice(0, i)).slice(VBASE.length)) + (i < 0 ? '' : url.slice(i));
  };
  let appRoot = null; // la raíz de la nota abierta en la app: { id, kind: 'dir' | 'file' | 'local' | 'cloud' | 'pub', name, handle }
  // Las raíces que se conocen, por id: el primer tramo de la ruta virtual dice de cuál es cada archivo.
  const roots = {};
  const rootOf = (url) => (String(url || '').startsWith(VBASE) ? roots[url.slice(VBASE.length).split('#')[0].split('/')[0]] || null : null);

  let raw = APP ? '' : pre.textContent;
  let settings = null;
  let rawMode = false;
  let refreshTimer = null;
  let spyHeadings = [];
  let searchHits = [];
  let searchIndex = -1;
  const lazyLoaded = {};
  const isFile = location.protocol === 'file:';

  const T = (text, vars) => LMD.t(text, vars);
  const { ICON, el, esc, debounce, MD_RE, SKIP_DIRS } = LMD.kit;
  const { slugify, ghSlug, splitFrontmatter, ALERTS } = LMD.md;
  const { inlineMd, roundTrips } = LMD.serialize;
  const { handlesAll, handlesPut, canWrite, walk } = LMD.store;
  LMD.md.harden(window.DOMPurify);
  // El parser se arma una vez y se reutiliza mientras no cambien los plugins ni el idioma.
  let parser = null; let parserKey = '';
  const buildParser = () => {
    const key = JSON.stringify(settings.plugins) + LMD.lang();
    if (key !== parserKey) { parserKey = key; parser = LMD.md.buildParser(settings.plugins); }
    return parser;
  };
  const isDark = () => LMD.theme.isDark(settings);
  let themePreview = ''; // el tema que se está mirando en Ajustes sin haberlo aplicado
  // Lo que el estado vacío (home.js) necesita del lector: dónde dibujarse y cómo abrir una nota sin recargar.
  const homeCtx = () => ({ settings, APP_URL, box: ui.home, open: (f, opt) => go(f, opt), refresh: () => core.reloadTree(), say: (text) => flash(text, 'error'), warn: (text) => flash(text, 'warn'), plan: (why) => openPanel('plan', why),
    // El pie de la barra lateral, donde vive la cuenta: dónde dibujarse, cómo quedar a la vista y cómo guardar antes de salir.
    // Un archivo del disco abierto por enlace: su dirección en la app, y si la web ya tiene su carpeta con permiso.
    disk: { doc: fsDoc, real: async (fileUrl) => { const k = await fsKnown(fileUrl); return !!(k && k.granted); } },
    acct: ui.acct, showSide: () => { if (LMD.touch.small()) setDrawer(true); else if (settings.sidebarHidden) LMD.patch({ sidebarHidden: false }); }, hideSide: () => setDrawer(false),
    leave: () => (dirty ? save(false) : Promise.resolve(true)), ready: unsplash, panel: (tab) => openPanel(tab),
    // El CSS propio viene con el plan pago: si Ajustes está abierto, se redibuja con el campo ya habilitado.
    unlocked: (a) => { if (a.plan === 'pro' && !settings.supporter) { panelStale = true; LMD.patch({ supporter: true }); } },
    template: () => LMD.extras.fromTemplate(''), preview: (text) => DOMPurify.sanitize(buildParser().render(settings.plugins.frontmatter ? splitFrontmatter(text).body : text), { FORBID_TAGS: ['style', 'form'] }) });
  // La pantalla de carga de app.html se va cuando hay algo que mostrar: el inicio, la nota o un pedido de permiso.
  function unsplash() {
    const s = document.getElementById('lmd-splash'); if (!s || s.classList.contains('lmd-splash-out')) return;
    s.classList.add('lmd-splash-out'); setTimeout(() => s.remove(), 200);
  }
  // Si la extensión se recargó o se actualizó, esta pestaña queda desconectada de ella: no puede
  // releer el archivo ni la carpeta. Se detecta y se avisa, en vez de fallar en silencio.
  let orphan = false;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  function markOrphan() {
    if (orphan) return;
    orphan = true;
    clearInterval(refreshTimer);
    const bar = el('div', { class: 'lmd-orphan', role: 'alert' });
    // El idioma ya está en memoria: sin la extensión no se puede volver a leer, y el diccionario tampoco hace falta.
    let es = false; try { es = LMD.lang() === 'es'; } catch (e) { /* queda en inglés */ }
    bar.appendChild(el('span', { text: es ? 'SharpMD se actualizó. Recargá esta pestaña para seguir.' : 'SharpMD was updated. Reload this tab to continue.' }));
    const b = el('button', { type: 'button', text: es ? 'Recargar' : 'Reload' });
    b.addEventListener('click', () => location.reload());
    bar.appendChild(b);
    document.body.appendChild(bar);
  }
  // Versión web: el service worker bajó (o llegó a ver) una versión distinta de la que corre esta página (sw.js lo
  // manda, web.js lo recibe). Un aviso solo, con el aspecto del de arriba y una forma de cerrarlo. Recargar guarda
  // primero; si algo queda sin guardar, no recarga. stored: false = la caché no se pudo renovar entera: se la borra
  // antes de recargar, y la página nueva llega derecho de la red.
  let freshNow = null; let freshSkip = '';
  function freshNotice(d) {
    if (!d || !d.version || d.version === LMD.VERSION || d.version === freshSkip || orphan) return;
    freshNow = d;
    if (document.querySelector('.lmd-fresh')) return;
    const bar = el('div', { class: 'lmd-orphan lmd-fresh', role: 'status' });
    bar.appendChild(el('span', { text: T('Hay una versión nueva.') }));
    const go = el('button', { type: 'button', 'data-fresh': 'go', text: T('Recargar') });
    const later = el('button', { type: 'button', class: 'lmd-update-x', 'data-fresh': 'later', title: T('Ahora no'), 'aria-label': T('Ahora no') }, ICON.close);
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { await save(false); } catch (e) { /* se mira abajo si quedó algo sin guardar */ }
      // En la cola de la nube o en la sesión (una nota en memoria) lo escrito ya está a salvo. Si no, se espera.
      if (dirty && stashed !== raw && !(appRoot && appRoot.id === 'mem')) { go.disabled = false; flash(T('Guardá los cambios antes de recargar'), 'warn'); return; }
      if (!freshNow.stored && navigator.onLine !== false && window.caches) {
        try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => /^sharpmd-/.test(k)).map((k) => caches.delete(k))); } catch (e) { /* queda la caché: se renueva en la visita siguiente */ }
      }
      location.reload();
    });
    later.addEventListener('click', () => { freshSkip = freshNow.version; bar.remove(); });
    bar.appendChild(go); bar.appendChild(later);
    document.body.appendChild(bar);
  }
  const bg = (msg) => new Promise((resolve) => {
    if (!alive()) { markOrphan(); resolve({ ok: false, error: 'orphan' }); return; }
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err && /context invalidated|receiving end does not exist/i.test(err.message || '') && !alive()) markOrphan();
        resolve(err ? { ok: false, error: err.message } : r);
      });
    } catch (e) { if (!alive()) markOrphan(); resolve({ ok: false, error: String(e) }); }
  });
  // ---------- Archivos de la app ----------
  const vParts = (url) => url.slice(VBASE.length).split('#')[0].split('/').filter(Boolean).map(decodeURIComponent).slice(1);
  async function vFile(url) {
    const parts = vParts(url); const root = rootOf(url);
    if (!root || !parts.length) return null;
    if (root.kind === 'local') return parts.length === 1 ? LMD.store.noteHandle(parts[0]) : null;
    if (root.kind === 'cloud') return LMD.cloud.handle(parts.join('/'));
    if (root.kind === 'pub') return { kind: 'file', name: root.title, getFile: async () => ({ text: async () => root.text, lastModified: 0, size: root.text.length }) };
    if (root.kind === 'file') return parts.length === 1 && parts[0] === root.handle.name ? root.handle : null;
    // Un archivo del disco abierto por enlace: lo lee la extensión, y solo texto (una imagen de la nota no llega por acá).
    if (root.kind === 'fs') { const name = parts[parts.length - 1]; return { kind: 'file', name, getFile: async () => { const text = await fsRead(fsFile(url)); return { text: async () => text, lastModified: 0, size: text.length }; } }; }
    let cur = root.handle;
    for (let k = 0; k < parts.length - 1; k++) cur = await cur.getDirectoryHandle(parts[k]);
    return cur.getFileHandle(parts[parts.length - 1]);
  }
  async function vText(url) {
    try { const h = await vFile(url); return h ? await (await h.getFile()).text() : null; } catch (e) { return null; }
  }
  async function vList(dirUrl) {
    try {
      const root = rootOf(dirUrl);
      if (!root || root.kind === 'pub') return [];
      if (root.kind === 'cloud') {
        // La nube guarda rutas completas: las carpetas se deducen de ellas.
        const parts = vParts(dirUrl); const other = parts.length && parts[0][0] === '~' ? parts.shift().slice(1) : '';
        const prefix = parts.map((p) => p + '/').join(''); const rows = []; const seen = new Set();
        // Carpetas con contraseña: una bloqueada no muestra lo que tiene adentro, ni al explorador ni a la búsqueda.
        let vaults = [];
        try { vaults = await LMD.vault.load(); } catch (e) { /* sin la lista, se dibuja como siempre */ }
        // El espacio del equipo protegido se bloquea entero: es una sola "carpeta", la raíz.
        if (other) { if (vaults.some((v) => v.team && v.folder === '~' + other) && LMD.vault.teamShut()) return []; vaults = []; }
        const at = prefix.slice(0, -1);
        // Toda la nube protegida (v.folder vacío) no esconde los nombres: al abrir una nota se pide la contraseña.
        if (vaults.some((v) => v.folder && (at === v.folder || at.startsWith(v.folder + '/')) && !LMD.vault.isOpen(v))) return [];
        (await LMD.cloud.list(false, other)).forEach((n) => {
          if (!n.path.startsWith(prefix)) return;
          const rest = n.path.slice(prefix.length); const cut = rest.indexOf('/');
          const name = cut < 0 ? rest : rest.slice(0, cut);
          if (seen.has(name)) return; seen.add(name);
          rows.push({ name, url: dirUrl + encodeURIComponent(name) + (cut < 0 ? '' : '/'), dir: cut >= 0 });
        });
        // Una carpeta protegida figura aunque esté vacía, y lleva su estado para dibujar el candado.
        vaults.forEach((v) => {
          if (!(v.folder + '/').startsWith(prefix)) return;
          const name = v.folder.slice(prefix.length).split('/')[0];
          if (name && !seen.has(name)) { seen.add(name); rows.push({ name, url: dirUrl + encodeURIComponent(name) + '/', dir: true }); }
        });
        rows.forEach((r) => { if (r.dir) r.vault = vaults.find((v) => v.folder === prefix + r.name) || null; });
        // Arriba de todo, una carpeta por cada persona que compartió notas con esta cuenta.
        if (!parts.length && !other) {
          try { (await LMD.cloud.shared()).forEach((n) => { if (seen.has('~' + n.owner)) return; seen.add('~' + n.owner); rows.push({ name: '~' + n.owner, label: n.by, url: dirUrl + '~' + n.owner + '/', dir: true }); }); } catch (e) { /* sin compartidas */ }
        }
        return rows;
      }
      if (root.kind === 'local') return (await LMD.store.notesAll()).map((n) => {
        const first = STAMP_RE.test(n.name) ? (n.text.split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').slice(0, 60) : '';
        return { name: n.name, label: first, url: dirUrl + encodeURIComponent(n.name), dir: false };
      });
      if (root.kind === 'file') return [{ name: root.handle.name, url: dirUrl + encodeURIComponent(root.handle.name), dir: false }];
      if (root.kind === 'fs') {
        // Lo que la extensión deja listar (carpetas habilitadas). Si no, queda solo el camino hasta la nota abierta.
        const rows = await fsList(dirUrl);
        if (rows) return rows;
        if (noDoc || !HERE.startsWith(dirUrl)) return [];
        const rest = HERE.slice(dirUrl.length).split('#')[0]; const seg = rest.split('/')[0]; const more = rest.includes('/');
        return seg ? [{ name: decodeURIComponent(seg), url: dirUrl + seg + (more ? '/' : ''), dir: more }] : [];
      }
      let dir = root.handle;
      for (const p of vParts(dirUrl)) dir = await dir.getDirectoryHandle(p);
      const rows = [];
      for await (const [name, h] of dir.entries()) rows.push({ name, url: dirUrl + encodeURIComponent(name) + (h.kind === 'directory' ? '/' : ''), dir: h.kind === 'directory' });
      return rows;
    } catch (e) { return null; }
  }
  // ---------- Un archivo del disco abierto por enlace ----------
  // Su dirección en la app es ?f=fs/<la ruta real, carpeta por carpeta>. Así un enlace relativo de la nota se resuelve
  // solo contra la ruta de verdad, y atrás, adelante y las anclas andan como en cualquier otra nota. De dónde sale el
  // texto: si la web ya tiene el permiso de una carpeta que lo contiene (la persona la eligió una vez, y de ahí se
  // anotó su ruta en rec.fs), es el archivo real y se guarda en él. Si no, lo lee la extensión, solo de carpetas
  // habilitadas, y queda como copia hasta que la persona dé acceso a la carpeta.
  const FS = VBASE + 'fs/'; const FS_UP = 2;
  const fsFile = (url) => { const p = vParts(url); const win = p.length && /^[a-z]:$/i.test(p[0]); return p.length ? 'file:///' + p.map((s, i) => (win && !i ? s : encodeURIComponent(s))).join('/') + (/\/$/.test(url.split('#')[0]) ? '/' : '') : ''; };
  const fsDoc = (fileUrl) => { try { return 'fs/' + decodeURIComponent(new URL(fileUrl).pathname).split('/').filter(Boolean).map(encodeURIComponent).join('/'); } catch (e) { return ''; } };
  const fsKey = (fileUrl) => { try { const p = decodeURIComponent(new URL(fileUrl).pathname); return /^\/[a-z]:\//i.test(p) ? p.toLowerCase() : p; } catch (e) { return ''; } };
  const fsLists = new Map();
  async function fsRead(fileUrl) {
    const kept = LMD.bridge.take(fileUrl);
    if (kept != null) return kept;
    const r = await LMD.bridge.readFile(fileUrl);
    if (r && r.ok && r.opened && typeof r.text === 'string') return r.text;
    throw Object.assign(new Error('fs'), { why: r && r.ok ? r.why || 'failed' : r && r.error === 'refused' ? 'old' : 'none' });
  }
  async function fsList(dirUrl) {
    const file = fsFile(dirUrl); const hit = fsLists.get(file);
    if (hit && Date.now() - hit.at < 60000) return hit.rows;
    let rows = null;
    if (file) { const r = await LMD.bridge.listDir(file); if (r && r.ok && r.listed && Array.isArray(r.rows)) rows = r.rows.filter((x) => x && typeof x.name === 'string' && x.name && !/[\/\\]/.test(x.name) && (x.dir || MD_RE.test(x.name))).map((x) => ({ name: x.name, url: dirUrl + encodeURIComponent(x.name) + (x.dir ? '/' : ''), dir: !!x.dir })); }
    fsLists.set(file, { at: Date.now(), rows });
    return rows;
  }
  // La carpeta ya abierta en la web que contiene ese archivo, con lo que queda de la ruta y si el permiso sigue dado.
  async function fsKnown(fileUrl) {
    const key = fsKey(fileUrl); let best = null;
    if (!key) return null;
    for (const r of await LMD.store.rootsAll()) {
      if (r.kind !== 'dir' || !r.handle || r.ghost || !r.fs) continue;
      const k = fsKey(r.fs);
      if (k && k.endsWith('/') && key.startsWith(k) && (!best || k.length > best.k.length)) best = { rec: r, k };
    }
    if (!best) return null;
    const rest = decodeURIComponent(new URL(fileUrl).pathname).slice(best.k.length).split('/').filter(Boolean);
    let granted = false;
    try { granted = (await best.rec.handle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* permiso vencido */ }
    return { rec: best.rec, rest, granted };
  }
  // El cartel de la copia, arriba de la nota: dice que es una copia y ofrece pasar al archivo real.
  let fsSaid = '';
  async function paintCopy() {
    const bar = ui.copyBar; if (!bar) return;
    const on = APP && !noDoc && !!appRoot && appRoot.kind === 'fs';
    bar.hidden = !on; if (!on) { fsSaid = ''; return; }
    const seq = docSeq; const known = await fsKnown(fsFile(HERE));
    if (seq !== docSeq) return;
    bar.textContent = '';
    bar.appendChild(el('span', { class: 'lmd-copybar-text', text: fsSaid || T('Se abrió una copia. El archivo del disco no cambia.') }));
    // Sin acceso a archivos (teléfono, Firefox, Safari) no hay cómo pasar al archivo: queda la copia.
    if (known) bar.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-fs': 'grant', text: T('Permitir guardar') }));
    else if (window.showDirectoryPicker) bar.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-fs': 'grant', text: T('Editar el archivo del disco') }));
  }
  const fsSay = (text) => { fsSaid = text; return paintCopy(); };
  const sameText = (a, b) => String(a).replace(/\r\n?/g, '\n') === String(b).replace(/\r\n?/g, '\n');
  // ---------- Permiso para guardar en una carpeta o un archivo del disco ----------
  // Abrir (con el selector, arrastrando o desde los recientes) pide solo lectura: no aparece ningún cuadro del
  // navegador. El permiso de escritura se pide recién cuando hace falta (editar, guardar, crear, renombrar, mover,
  // borrar) y siempre después de un aviso propio, corto y en el idioma de la app: el cuadro que sigue es del
  // navegador, sale en su idioma y no se puede cambiar. Si la persona dice que no, todo sigue abierto en solo lectura.
  const diskRec = (url) => { if (!APP) return null; const r = url ? rootOf(url) : appRoot; return r && r.root && r.handle && (r.kind === 'dir' || r.kind === 'file') ? r : null; };
  async function askWrite(rec) {
    const ok = await LMD.dialog.confirm({ title: T('Guardar en "{a}"', { a: rec.name }), ok: T('Permitir guardar'), cancel: T('Seguir en solo lectura'),
      text: T(rec.kind === 'dir' ? 'Para guardar en esta carpeta, el navegador te va a pedir permiso. El cuadro es del navegador y sale en su idioma: elegí la opción de guardar los cambios.' : 'Para guardar en este archivo, el navegador te va a pedir permiso. El cuadro es del navegador y sale en su idioma: elegí la opción de guardar los cambios.'),
      // El pedido sale del clic sobre el botón: el navegador lo exige.
      act: (d) => { let p = null; try { p = rec.handle.requestPermission({ mode: 'readwrite' }); } catch (e) { p = Promise.resolve('denied'); } Promise.resolve(p).then((s) => d.close(s === 'granted'), () => d.close(false)); } });
    paintWrite(); if (ui.paneFiles && ui.paneFiles.dataset.loaded) loadTree();
    return ok === true;
  }
  // Si se puede escribir ahí; si no, lo pide (quiet: solo contesta, sin preguntar). Lo que no es del disco no pregunta.
  async function allowWrite(url, quiet) {
    const rec = diskRec(url);
    if (!rec || await canWrite(rec.handle, false)) return true;
    return quiet ? false : askWrite(rec);
  }
  // El botón de editar no promete guardar si todavía no hay permiso.
  async function paintWrite() {
    const seq = docSeq; const rec = noDoc ? null : diskRec();
    const ro = !!rec && !(await canWrite(rec.handle, false));
    if (seq !== docSeq) return;
    document.documentElement.classList.toggle('lmd-nowrite', ro);
    const b = ui.main.querySelector('[data-act=mode-edit]');
    if (b) { if (b.dataset.t0 == null) b.dataset.t0 = b.title || ''; b.title = ro ? T('Editar: el navegador va a pedir permiso para guardar') : b.dataset.t0; }
  }

  // De copia a archivo real. Con una carpeta ya conocida alcanza con el permiso (un clic, sin selector). Si no, se
  // elige la carpeta: el navegador no dice su ruta, así que se la reconoce por el nombre y porque adentro, por el
  // mismo camino, está este mismo archivo con este mismo texto. Recién ahí se anota a qué ruta corresponde.
  // write false: solo abrir la carpeta (la fila del explorador). Ahí se pide lectura, y guardar se pide al editar.
  async function fsGrant(write) {
    if (noDoc || !appRoot || appRoot.kind !== 'fs') return false;
    const seq = docSeq; const parts = vParts(HERE); const name = parts[parts.length - 1]; const folder = parts[parts.length - 2] || '';
    const known = await fsKnown(fsFile(HERE));
    if (known && write === false) { let ok = false; try { ok = (await known.rec.handle.requestPermission({ mode: 'read' })) === 'granted'; } catch (e) { /* hace falta un clic */ } return ok && seq === docSeq ? fsSwap(known.rec, known.rest) : false; }
    if (known) {
      // El mismo aviso que al editar en una carpeta abierta en solo lectura: prepara para el cuadro del navegador.
      const ok = await askWrite(known.rec);
      if (seq !== docSeq) return false;
      if (!ok) { fsSay(T('Falta el permiso para guardar en "{a}".', { a: known.rec.name })); return false; }
      return fsSwap(known.rec, known.rest);
    }
    if (!window.showDirectoryPicker) return false;
    const low = (t) => String(t).toLowerCase();
    // Dónde arranca el selector: recuerda por id dónde quedó para esta carpeta; la primera vez, lo más cercano ya abierto.
    let startIn = null; let score = -1;
    for (const r of await LMD.store.rootsAll()) { if (!r.handle || r.ghost) continue; const at = r.kind === 'dir' ? parts.map(low).lastIndexOf(low(r.name)) : -1; if (at > score) { startIn = r.handle; score = at; } }
    fsSay(T('Buscá la carpeta "{a}" y elegila.', { a: folder }));
    let dir = null;
    const opt = { id: 'lmd-d-' + LMD.bridge.hash(low(parts.slice(0, -1).join('/'))).replace(/[^a-z0-9]/gi, '').slice(0, 24) };
    if (write !== false) opt.mode = 'readwrite';
    try { dir = await window.showDirectoryPicker(startIn ? Object.assign({ startIn }, opt) : opt); }
    catch (e) { if (startIn && !(e && e.name === 'AbortError')) { try { dir = await window.showDirectoryPicker(opt); } catch (err) { /* se canceló */ } } }
    if (seq !== docSeq) return false;
    if (!dir) { fsSay(''); return false; }
    // La carpeta elegida puede ser la del archivo o una de más arriba: se prueba cada lugar de la ruta donde calza su nombre.
    let hit = null; let other = false;
    for (let i = parts.length - 2; i >= 0 && !hit; i--) {
      if (low(parts[i]) !== low(dir.name)) continue;
      try { const text = await (await (await walk(dir, parts.slice(i + 1))).getFile()).text(); if (sameText(text, diskText)) hit = { i, rest: parts.slice(i + 1) }; else other = true; } catch (e) { /* ahí no está */ }
    }
    if (seq !== docSeq) return false;
    if (!hit) { fsSay(T(other ? 'En "{a}" hay otro "{b}", distinto del que está abierto. Buscá la carpeta del enlace.' : 'La carpeta "{a}" no contiene "{b}". Buscá "{c}".', { a: dir.name, b: name, c: folder })); return false; }
    let rec = null;
    for (const r of await LMD.store.rootsAll()) { try { if (r.handle && await r.handle.isSameEntry(dir)) { rec = r; break; } } catch (e) { /* permiso vencido */ } }
    if (!rec) { const id = Math.random().toString(36).slice(2, 10); rec = { key: 'root:' + id, root: true, id }; }
    rec.kind = 'dir'; rec.name = dir.name; rec.handle = dir; rec.at = Date.now(); delete rec.ghost;
    rec.fs = fsFile(FS + parts.slice(0, hit.i + 1).map(encodeURIComponent).join('/') + '/');
    await handlesPut(rec);
    return fsSwap(rec, hit.rest);
  }
  // La copia pasa a ser el archivo, en el lugar: misma posición, mismo modo, y lo que se cambió en la copia sigue
  // puesto, sin guardar, hasta que la persona guarde.
  async function fsSwap(rec, rest) {
    flushTyping();
    if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); }
    const text = raw; const was = diskText; const y = window.scrollY;
    roots[rec.id] = rec; fsSaid = '';
    if (!(await go(rec.id + '/' + rest.map(encodeURIComponent).join('/'), { replace: true, discard: true, tree: true }))) return false;
    if (text !== was && text !== raw) { core.setRaw(text); flash(T('Lo que cambiaste en la copia sigue sin guardar. Guardá para escribirlo en el archivo.'), 'warn'); }
    else if (await canWrite(rec.handle, false)) flash(T('Ya es el archivo del disco: guardar escribe en él.'));
    window.scrollTo(0, y);
    return true;
  }

  // En la página de la extensión no se puede inyectar con chrome.scripting: las librerías pesadas se cargan con <script>.
  const LAZY_APP = {
    katex: { js: ['vendor/katex/katex.min.js'], css: 'vendor/katex/katex.min.css' },
    mermaid: { js: ['vendor/mermaid.min.js'] },
    graphviz: { js: ['vendor/viz-global.js'] },
    // Lo que el primer pintado no necesita. En la app se pide aparte; sobre un .md (script de contenido) ya viene con el resto.
    hljs: { js: ['vendor/highlight.min.js'] },
    emoji: { js: ['vendor/markdown-it-emoji.min.js'] },
    tools: { js: ['src/emoji-data.js', 'src/emoji.js', 'src/community.js', 'src/templates.js', 'src/diagram.js', 'src/formula.js'] },
    // Las herramientas de Ajustes > Herramientas (tools.js): cada una se pide recién cuando está prendida.
    speak: { js: ['src/speak.js'] },
    dictate: { js: ['src/voice.js', 'src/dictate.js'] },
    present: { js: ['src/present.js'] },
    daily: { js: ['src/daily.js'] },
    docx: { js: ['src/docx.js'] },
    // Exportar una carpeta entera como un solo documento: se pide al elegirla en un menú.
    folderexport: { js: ['src/folderexport.js'] },
    linkmap: { js: ['src/linkmap.js'] },
    explore: { js: ['src/explore.js'] },
    jsonyaml: { js: ['src/jsonyaml.js'] },
    import: { js: ['src/import.js'] },
    assistant: { js: ['src/aikey.js', 'src/assistant.js'] },
    agents: { js: ['src/agents.js'] },
    // Las tres que leen del programa local comparten archivo.
    localtools: { js: ['src/localtools.js'] },
    // La galería de la comunidad, en Ajustes > Herramientas: se pide al abrir esa pestaña.
    gallery: { js: ['src/gallery.js'] },
    // Ajustes > API y automatizaciones y el alta guiada: se piden al abrir esa pestaña o al elegir "Automatizar…".
    automate: { js: ['src/automate.js'] },
    publish: { js: ['src/publish.js'] },
    // La hoja de atajos de teclado: se pide al abrirla.
    shortcuts: { js: ['src/shortcuts.js'] },
  };
  const LAZY_HAVE = { hljs: () => !!window.hljs, emoji: () => !!window.markdownitEmoji, tools: () => !!(LMD.diagram && LMD.formula && LMD.templates && LMD.community) };
  LAZY_HAVE.gallery = () => !!LMD.gallery; LAZY_HAVE.automate = () => !!LMD.automate; LAZY_HAVE.publish = () => !!LMD.publish;
  LAZY_HAVE.speak = () => !!LMD.speak; LAZY_HAVE.dictate = () => !!(LMD.voice && LMD.dictate);
  ['present', 'daily', 'docx', 'linkmap', 'explore', 'jsonyaml', 'import', 'agents', 'localtools'].forEach((k) => { LAZY_HAVE[k] = () => !!LMD[k]; });
  LAZY_HAVE.assistant = () => !!(LMD.ai && LMD.assistant);
  LAZY_HAVE.shortcuts = () => !!LMD.shortcuts; LAZY_HAVE.folderexport = () => !!LMD.folderexport;
  async function appLazy(what) {
    const spec = LAZY_APP[what];
    try {
      if (spec.css) {
        const css = await (await fetch(chrome.runtime.getURL(spec.css))).text();
        document.head.appendChild(el('style', { text: css.split('__LMD_BASE__').join(chrome.runtime.getURL('')) }));
      }
      for (const src of spec.js) {
        await new Promise((resolve, reject) => {
          const s = el('script', { src: chrome.runtime.getURL(src) });
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      return true;
    } catch (e) { return false; }
  }

  // ---------- Markdown ----------

  // off: fuera de la página (drawOff). 'sample': un ejemplo de Ajustes > Plugins, con su propia lista de plugins (plug).
  function postProcess(article, off, plug) {
    const p = plug || settings.plugins;

    // Títulos: id. El enlace a la sección se copia desde el menú del título (clic derecho o la manija del bloque).
    const used = new Set();
    const headings = Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    headings.forEach((h) => {
      h.id = slugify(h.textContent, used);
    });

    // Índice en el texto
    if (p.toc) {
      article.querySelectorAll('p').forEach((par) => {
        if (/^\s*(\[\[toc\]\]|\[toc\])\s*$/i.test(par.textContent)) {
          const nav = el('nav', { class: 'lmd-toc' });
          headings.forEach((h) => {
            const a = el('a', { href: '#' + h.id, class: 'lmd-toc-l' + h.tagName[1], text: headingText(h) });
            nav.appendChild(a);
          });
          par.replaceWith(nav);
        }
      });
    }

    // Listas de tareas
    if (p.tasklists) {
      article.querySelectorAll('li').forEach((li) => {
        // En una lista con renglones en blanco el elemento arranca con un salto de línea y el texto va dentro de un párrafo.
        const first = (n) => { while (n && n.nodeType === 3 && !n.nodeValue.trim() && n.nextSibling) n = n.nextSibling; return n; };
        let target = first(li.firstChild);
        if (target && target.nodeType === 1 && target.tagName === 'P') target = first(target.firstChild);
        if (!target || target.nodeType !== 3) return;
        const m = /^\[([ xX])\](\s+|$)/.exec(target.nodeValue);
        if (!m) return;
        target.nodeValue = target.nodeValue.slice(m[0].length);
        const box = el('input', { type: 'checkbox', class: 'lmd-task' });
        if (m[1] !== ' ') box.setAttribute('checked', '');
        target.parentNode.insertBefore(box, target);
        if (!target.nodeValue) target.remove(); // una tarea sin texto: queda la casilla sola
        li.classList.add('lmd-task-item');
        if (li.parentNode) li.parentNode.classList.add('lmd-task-list');
      });
    }

    // Alertas estilo GitHub
    if (p.alerts) {
      article.querySelectorAll('blockquote').forEach((bq) => {
        const first = bq.querySelector('p');
        if (!first || !first.firstChild || first.firstChild.nodeType !== 3) return;
        const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.firstChild.nodeValue);
        if (!m) return;
        const kind = m[1].toUpperCase();
        first.firstChild.nodeValue = first.firstChild.nodeValue.slice(m[0].length);
        if (first.firstChild.nodeValue === '' && first.childNodes[1] && first.childNodes[1].tagName === 'BR') first.childNodes[1].remove();
        if (!first.textContent.trim() && !first.children.length) first.remove();
        bq.classList.add('lmd-alert', 'lmd-alert-' + kind.toLowerCase());
        bq.insertBefore(el('p', { class: 'lmd-alert-title', text: T(ALERTS[kind]) }), bq.firstChild);
      });
    }

    // Tablas con scroll propio
    article.querySelectorAll('table').forEach((t) => {
      const wrap = el('div', { class: 'lmd-table' });
      t.replaceWith(wrap); wrap.appendChild(t);
    });

    // Bloques de código: etiqueta de lenguaje y botón de copiar
    const plainCode = [];
    article.querySelectorAll('pre > code').forEach((code) => {
      const preEl = code.parentNode;
      const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1];
      code.classList.add('hljs');
      if (p.highlight && lang && !window.hljs) plainCode.push([code, lang]);
      const wrap = el('div', { class: 'lmd-code' });
      preEl.replaceWith(wrap); wrap.appendChild(preEl);
      if (lang) wrap.appendChild(el('span', { class: 'lmd-code-lang', text: lang }));
      if (p.copyCode && (!off || off === 'sample')) {
        const btn = el('button', { class: 'lmd-code-copy', type: 'button', title: T('Copiar') }, ICON.copy);
        btn.addEventListener('click', () => copyText(code.textContent, btn));
        wrap.appendChild(btn);
      }
    });
    if (plainCode.length && off !== 'sample') paintCode(plainCode); // un ejemplo no pide la librería por su cuenta

    // Links externos en pestaña nueva
    article.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^https?:/i.test(href) && a.host !== location.host) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });

    if (APP && !off) {
      // Rutas relativas: los links pasan por la app y las imágenes se leen de la carpeta abierta.
      const relative = (v) => v && !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(v);
      article.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!relative(href) || a.classList.contains('lmd-wiki')) return;
        try { a.setAttribute('data-lmd-href', href); a.href = toHref(new URL(href, HERE).href); } catch (e) { /* queda como está */ }
      });
      article.querySelectorAll('img[src]').forEach(async (img) => {
        const src = img.getAttribute('src');
        if (!relative(src)) return;
        img.setAttribute('data-lmd-src', src);
        try { const h = await vFile(new URL(src, HERE).href); if (h) { const blob = URL.createObjectURL(await h.getFile()); blobUrls.push(blob); img.src = blob; } } catch (e) { /* no está en la carpeta */ }
      });
    }
    // Sobre un archivo abierto directo, lo relativo lo resuelve el navegador contra el archivo que cargó. Si el que
    // está a la vista es de otra carpeta (ver goFile), los enlaces y las imágenes se resuelven acá contra ese.
    if (!APP && !off && new URL('.', HERE).href !== new URL('.', hostFile()).href) {
      const relative = (v) => v && !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(v);
      article.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!relative(href) || a.classList.contains('lmd-wiki')) return;
        try { a.setAttribute('data-lmd-href', href); a.href = new URL(href, HERE).href; } catch (e) { /* queda como está */ }
      });
      article.querySelectorAll('img[src]').forEach((img) => {
        const src = img.getAttribute('src');
        if (!relative(src)) return;
        try { img.setAttribute('data-lmd-src', src); img.src = new URL(src, HERE).href; } catch (e) { /* queda como está */ }
      });
    }

    LMD.board.calcTables(article);

    // ![texto|480](ruta): el número después de la barra es el ancho en píxeles.
    article.querySelectorAll('img[alt]').forEach((img) => {
      const m = /^(.*)\|(\d{2,4})$/.exec(img.getAttribute('alt'));
      if (!m) return;
      img.setAttribute('alt', m[1]); img.setAttribute('width', m[2]); img.dataset.lmdW = m[2];
    });

    if (p.imageViewer) article.querySelectorAll('img').forEach((img) => img.classList.add('lmd-zoomable'));

    // Fuera de la página (drawOff), las fórmulas y los diagramas los espera quien llama.
    if (off) return headings;
    renderMath(article);
    renderMermaid(article);
    renderGraphviz(article);
    resolveWiki(article);
    return headings;
  }

  function headingText(h) {
    const c = h.cloneNode(true);
    c.querySelectorAll('.lmd-anchor, .lmd-hnum').forEach((a) => a.remove());
    return c.textContent.trim();
  }

  // ---------- Enlaces internos ----------
  // Cada título tiene dos anclas: la propia (sin acentos) y la que arma GitHub (con acentos), que es la que se
  // escribe en los enlaces. Al navegar valen las dos.
  function anchorsOf(headings) {
    const used = new Set();
    return headings.map((h) => { const text = headingText(h); return { el: h, id: h.id, level: +h.tagName[1], text, gh: ghSlug(text, used) || h.id }; });
  }
  const unesc = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  // Antes de llevar la página a un lugar del documento: si está dentro de algo plegado, se despliega (fold.js).
  const shown = (node) => { if (LMD.fold) LMD.fold.reveal(node); if (LMD.write && LMD.write.reveal) LMD.write.reveal(node); };
  function findAnchor(frag) {
    const direct = frag && document.getElementById(frag);
    if (direct || !frag) return direct || null;
    const list = anchorsOf(spyHeadings); const low = frag.toLowerCase(); const plain = slugify(frag.replace(/-/g, ' '), new Set());
    const hit = list.find((x) => x.gh === low) || list.find((x) => x.id === plain);
    return hit ? hit.el : null;
  }
  // Los títulos de otro archivo, con las mismas anclas que tendría abierto. El documento se arma aparte: no carga imágenes.
  function headingsIn(text) {
    const body = settings.plugins.frontmatter ? splitFrontmatter(text).body : text;
    const doc = new DOMParser().parseFromString(DOMPurify.sanitize(buildParser().render(body), { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] }), 'text/html');
    const used = new Set(); const hs = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    hs.forEach((h) => { h.id = slugify(h.textContent, used); });
    return anchorsOf(hs).map((x) => ({ id: x.id, level: x.level, text: x.text, gh: x.gh }));
  }
  const sameUrl = (a, b) => unesc(a.split('#')[0]) === unesc(b.split('#')[0]);
  // Los Markdown que se pueden enlazar: en la app, todo lo abierto; sobre un archivo suelto, la carpeta del árbol.
  let linkIndex = null;
  async function linkFiles(cached) {
    const root = APP && appRoot ? VBASE + appRoot.id + '/' : treeRoot;
    if (!cached || !linkIndex || linkIndex.root !== root || Date.now() - linkIndex.at > 20000) {
      const files = await collectFiles(root);
      if (files == null) return null;
      linkIndex = { root, at: Date.now(), files };
    }
    // La lista sirve para varias notas de la misma raíz: la abierta se saca al devolverla.
    return linkIndex.files.filter((f) => !sameUrl(f.url, HERE));
  }
  const readDoc = async (url) => { if (APP) return vText(url); const r = await bg({ type: 'fetchText', url }); return r && r.ok ? r.text : null; };
  // Ruta de un archivo relativa a este documento, lista para un enlace: los espacios y los paréntesis van codificados.
  const linkSeg = (s) => s.replace(/[\s()<>[\]#?%"\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  function relLink(url) {
    const a = HERE.split('/').map(unesc); const b = url.split('#')[0].split('/').map(unesc); a.pop();
    let i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const out = '../'.repeat(a.length - i) + b.slice(i).map(linkSeg).join('/');
    return /^[^/]*:/.test(out) ? './' + out : out;
  }
  const noSection = (frag) => flash(T('No se encontró la sección "{a}".', { a: frag }), 'warn');
  // Un enlace de la app (app.html?f=...) lleva a otra nota sin recargar la página.
  const inApp = (a) => APP && !!a.href && a.href.split('#')[0].split('?')[0] === APP_URL && a.target !== '_blank';
  // Abre otro archivo de la app. Si no existe, go() avisa y se queda donde está.
  function openDoc(href, opt) {
    const u = new URL(href); const f = u.searchParams.get('f') || ''; const target = VBASE + f; const frag = unesc(u.hash.slice(1));
    if (!noDoc && sameUrl(target, HERE)) { const t = findAnchor(frag); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); else if (frag) noSection(frag); return Promise.resolve(true); }
    return go(f, Object.assign({ hash: u.hash }, opt));
  }

  // Enlaces dibujados fuera del texto de la nota (el detalle de un nodo, explore.js): quedan como los de la nota,
  // con las rutas relativas y los [[nombres]] resueltos contra el archivo abierto.
  async function prepLinks(box) {
    box.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || /^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || a.classList.contains('lmd-wiki')) return;
      try { const url = new URL(href, HERE).href; a.setAttribute('data-lmd-href', href); a.href = APP ? toHref(url) : url; } catch (e) { /* queda como está */ }
    });
    await resolveWiki(box);
  }
  // Sigue uno de esos enlaces sin recargar la página. Devuelve false si le toca al navegador.
  function followLink(a) {
    const href = a.getAttribute('href') || '';
    if (href[0] === '#') {
      const frag = unesc(href.slice(1)); const target = findAnchor(frag);
      if (target) { shown(target); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else if (frag) noSection(frag);
      return true;
    }
    if (APP && (a.hasAttribute('data-lmd-href') || a.classList.contains('lmd-wiki')) && inApp(a)) { openDoc(a.href); return true; }
    if (!APP && a.target !== '_blank' && opensHere(a.href)) { goFile(a.href); return true; }
    return false;
  }

  // ---------- Otro archivo de la carpeta, sobre un archivo abierto directo ----------
  // El lector sobre un .md del disco cambia de archivo sin recargar la página: lee el otro por el service worker y
  // lo dibuja en el lugar. Chrome no deja que una página file:// lleve su dirección a otra ruta (pushState falla),
  // así que el archivo a la vista viaja en el fragmento, #lmd-file=<ruta relativa al archivo que cargó el navegador>:
  // recargar, atrás y adelante lo vuelven a mostrar. En un sitio web, un Markdown sí toma su dirección real.
  const hostUrl = () => location.href.split('#')[0];
  const hostFile = () => hostUrl().split('?')[0];
  const cleanUrl = (url) => url.split('#')[0].split('?')[0];
  const FILE_FRAG = /^#lmd-file=(.+)$/;
  const OPENS_RE = /\.(md|mdx|mkd|mdown|markdown|txt|json|ya?ml)$/i;
  // Lo que el lector abre en el lugar: Markdown, texto, JSON y YAML del mismo disco o del mismo sitio.
  function opensHere(url) {
    if (APP) return false;
    try { const u = new URL(url); return OPENS_RE.test(u.pathname) && u.protocol === location.protocol && u.host === location.host; } catch (e) { return false; }
  }
  function relTo(from, to) {
    const a = from.split('/'); const b = to.split('/'); a.pop();
    let i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return '../'.repeat(a.length - i) + b.slice(i).join('/');
  }
  // La dirección con la que queda la pestaña al mostrar ese archivo.
  function readerHref(url) {
    url = cleanUrl(url);
    if (sameUrl(url, hostFile())) return hostUrl();
    if (!isFile && MD_RE.test(url)) return url;
    const rel = relTo(hostFile(), url); let ok = false;
    try { ok = new URL(rel, hostFile()).href === url; } catch (e) { ok = false; }
    return hostUrl() + '#lmd-file=' + (ok ? rel : url); // otra unidad de disco: va la dirección entera
  }
  // El archivo que dice la dirección: el del fragmento, si se puede abrir acá, o el que cargó el navegador.
  function addressed() {
    const m = FILE_FRAG.exec(location.hash);
    if (m) { try { const u = new URL(m[1], hostFile()); u.hash = ''; u.search = ''; if (opensHere(u.href)) return u.href; } catch (e) { /* fragmento ilegible */ } }
    return hostFile();
  }
  // De dónde se relee el archivo a la vista: el que cargó el navegador conserva su consulta.
  const docUrl = () => (APP ? HERE : sameUrl(HERE, hostFile()) ? hostUrl() : HERE);
  // Lo que no es texto (un binario con nombre de texto, la página de error de un sitio) no se dibuja acá.
  const readable = (r) => !!r && r.ok && typeof r.text === 'string' && r.text.indexOf('\u0000') === -1 && (isFile || !/html/i.test(r.ctype || ''));

  // Abre otro archivo en el lugar. opt: pop (viene de atrás o adelante), replace (no suma al historial), hash.
  async function goFile(href, opt) {
    opt = opt || {};
    const cut = href.indexOf('#'); const url = cleanUrl(href); const hash = opt.hash != null ? opt.hash : (cut < 0 ? '' : href.slice(cut));
    if (sameUrl(url, HERE)) {
      const frag = /^#lmd-/.test(hash) ? '' : unesc(hash.slice(1)); const t = frag ? findAnchor(frag) : null;
      if (t) { shown(t); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else if (frag) noSection(frag);
      return true;
    }
    const seq = ++navSeq;
    // Si no se pudo salir o abrir viniendo de atrás o adelante, la dirección vuelve a la del archivo que sigue a la vista.
    const stay = () => { if (opt.pop) { try { history.pushState(null, '', readerHref(HERE)); } catch (e) { /* queda como está */ } } return false; };
    try {
      if (!(await leaveDoc())) return stay();
      if (seq !== navSeq) return false;
      const r = await bg({ type: 'fetchText', url });
      if (seq !== navSeq) return false;
      if (!r || !r.ok) { if (!orphan) flash(T('No se encontró "{a}".', { a: unesc(url.split('/').pop() || '') }), 'error'); return stay(); }
      if (!readable(r)) { if (opt.pop) return stay(); location.href = url; return false; }
      setFile(url, r.text, Object.assign({}, opt, { hash }));
      return true;
    } catch (e) {
      // Algo inesperado: queda el camino de siempre, la página entera.
      if (!opt.pop) location.href = href;
      return false;
    }
  }
  function setFile(url, text, opt) {
    const wasEditing = editMode;
    dropDoc();
    HERE = url; DOC_NAME = unesc(HERE.split('/').pop() || '');
    raw = text; diskText = text; dirty = false; rawMode = false; editMode = false;
    if (!opt.pop) {
      const to = readerHref(HERE);
      try { if (opt.replace) history.replaceState(null, '', to); else if (to !== location.href) history.pushState(null, '', to); } catch (e) { /* la dirección queda como estaba */ }
    }
    paintDoc();
    syncTree();
    afterOpen({ editing: wasEditing, hash: opt.hash });
    core.hooks.doc.forEach((fn) => fn());
  }
  // Atrás y adelante sobre un archivo abierto directo: la dirección ya cambió, falta traer el archivo que le toca.
  let popWant = '';
  function onReaderPop() {
    const want = addressed();
    if (sameUrl(want, HERE) || want === popWant) return;
    popWant = want;
    goFile(want, { pop: true, hash: '' }).then(() => { popWant = ''; }, () => { popWant = ''; });
  }
  // Un archivo del explorador que SharpMD no dibuja pero la herramienta de importar convierte: se ofrece convertirlo.
  const IMPORT_RE = /\.(docx|xlsx|pptx|epub|pdf)$/i;
  function offerImport(url) {
    if (!APP || !url || !IMPORT_RE.test(cleanUrl(url)) || !LMD.tools || !LMD.tools.isOn('import')) return false;
    const root = rootOf(url); if (!root || root.kind !== 'dir') return false;
    ensure('import').then(async (ok) => { const h = ok && LMD.import ? await vFile(url) : null; if (h) LMD.import.run(await h.getFile()); }).catch(() => flash(T('No se pudo abrir. Probá de nuevo.'), 'error'));
    return true;
  }

  async function ensure(what) {
    if (lazyLoaded[what]) return lazyLoaded[what];
    if (LAZY_HAVE[what] && LAZY_HAVE[what]()) return (lazyLoaded[what] = Promise.resolve(true));
    lazyLoaded[what] = APP ? appLazy(what) : bg({ type: 'lazyLoad', what }).then((r) => !!(r && r.ok));
    return lazyLoaded[what];
  }

  // Los editores de diagramas y fórmulas, las plantillas y la lista de emojis: llegan después del primer pintado,
  // o antes si el documento o la persona los piden. Quien los usa espera esta promesa.
  let toolsReady = null;
  const tools = () => toolsReady || (toolsReady = ensure('tools').then((ok) => { if (ok) { LMD.diagram.init(core); LMD.formula.init(core); } return ok; }));
  // El resaltado llega después que el código: el bloque ya está a la vista como texto y solo toma color.
  function paintCode(pending) {
    ensure('hljs').then((ok) => {
      if (!ok || !window.hljs) return;
      pending.forEach(([code, lang]) => {
        if (!code.isConnected || code.children.length || !hljs.getLanguage(lang)) return;
        try { code.innerHTML = hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value; } catch (e) { /* queda como texto */ }
      });
    });
  }
  // Los emojis por nombre (:smile:) y las caritas (:-)) los convierte un plugin que solo se pide si el texto los trae.
  const EMOJI_RE = /:[a-z0-9_+-]+:|(^|\s)(>?[:;=8B][-'",]?[)(\/\\*DOoPpsSzZ|@$]|[\]oO0,>]:-?[)(]|<[\/\\]?3)/im;
  let emojiAsked = false;
  function wantEmoji(text) {
    if (emojiAsked || !settings.plugins.emoji || window.markdownitEmoji || !EMOJI_RE.test(text)) return;
    emojiAsked = true;
    ensure('emoji').then((ok) => {
      if (!ok || !window.markdownitEmoji) return;
      parserKey = '';
      // Con el cursor en un bloque el dibujo espera a que se lo suelte, como cualquier otro redibujo.
      if (ui.article.contains(document.activeElement)) needsRender = true; else render();
    });
  }

  async function renderMath(article) {
    const nodes = article.querySelectorAll('.lmd-math');
    if (!nodes.length) return;
    if (!(await ensure('katex')) || !window.katex) return;
    await tools();
    nodes.forEach((n) => {
      // Una fórmula con error no muestra el mensaje crudo de KaTeX: queda el código, con un aviso corto.
      try {
        katex.render(n.getAttribute('data-tex'), n, { displayMode: n.classList.contains('lmd-math-block'), throwOnError: true });
      } catch (e) { LMD.formula.fail(n, e); }
    });
  }

  let mermaidSeq = 0;
  async function renderMermaid(article, light, quiet) {
    const nodes = Array.from(article.querySelectorAll('pre.lmd-mermaid'));
    if (!nodes.length) return;
    if (!(await ensure('mermaid')) || !window.mermaid) return;
    await tools();
    // Para un sitio publicado el diagrama sale siempre en claro; en la app, con los colores del tema.
    mermaid.initialize(Object.assign({ startOnLoad: false, securityLevel: 'strict', flowchart: { curve: settings.diagramShape === 'square' ? 'linear' : 'basis' } }, light ? { theme: 'default' } : LMD.theme.mermaid(settings)));
    for (const n of nodes) {
      const code = n.textContent;
      try {
        const out = await mermaid.render('lmd-mermaid-' + (++mermaidSeq), code);
        const box = el('div', { class: 'lmd-diagram' });
        box.innerHTML = out.svg;
        box.dataset.code = code; box.dataset.kind = 'mermaid';
        if (n.hasAttribute('data-l')) box.setAttribute('data-l', n.getAttribute('data-l'));
        n.replaceWith(box);
        // Dibujado en la nota: lo sabe quien le suma algo encima (explore.js).
        if (!light && !quiet) core.hooks.diagram.forEach((fn) => fn(box));
      } catch (e) {
        // El aviso corto arriba del código, y el volcado del parser detrás de "Ver detalle".
        LMD.diagram.fail(n, 'mermaid', e);
        document.querySelectorAll('body > [id^="dlmd-mermaid-"]').forEach((x) => x.remove());
      }
    }
  }

  // [[nombre]] apunta al Markdown de la carpeta cuyo nombre coincide, sin distinguir guiones, guiones bajos ni mayúsculas.
  const wikiKey = (s) => s.toLowerCase().replace(/\.(md|mdx|mkd|mdown|markdown)$/i, '').replace(/[\s_-]+/g, '');
  let wikiIndex = null;
  async function resolveWiki(article) {
    const links = Array.from(article.querySelectorAll('a.lmd-wiki'));
    if (!links.length) return;
    const dir = new URL('.', HERE).href;
    if (!wikiIndex || wikiIndex.dir !== dir) {
      const files = await collectFiles(dir);
      const map = new Map();
      (files || []).forEach((f) => { const k = wikiKey(f.rel.split('/').pop()); if (!map.has(k)) map.set(k, f.url); });
      wikiIndex = { dir, map };
    }
    links.forEach((a) => {
      const parts = a.getAttribute('data-wiki').split('#');
      const url = wikiIndex.map.get(wikiKey(parts[0].split('/').pop()));
      if (url) { a.href = toHref(url + (parts[1] ? '#' + slugify(parts[1], new Set()) : '')); a.title = decodeURIComponent(url.split('/').pop()); }
      else { a.classList.add('lmd-wiki-missing'); a.title = T('No hay un archivo con ese nombre en la carpeta'); }
    });
  }

  let vizInstance = null;
  async function renderGraphviz(article) {
    const nodes = Array.from(article.querySelectorAll('pre.lmd-graphviz'));
    if (!nodes.length) return;
    if (!(await ensure('graphviz')) || !window.Viz) return;
    await tools();
    try { vizInstance = vizInstance || await Viz.instance(); } catch (e) { return; }
    for (const n of nodes) {
      try {
        const svg = LMD.md.safeSvg(vizInstance.renderSVGElement(n.textContent));
        const box = el('div', { class: 'lmd-diagram lmd-diagram-dot' });
        box.dataset.code = n.textContent; box.dataset.kind = 'dot';
        if (n.hasAttribute('data-l')) box.setAttribute('data-l', n.getAttribute('data-l'));
        LMD.diagram.keepColors(svg);
        box.appendChild(svg);
        n.replaceWith(box);
      } catch (e) { LMD.diagram.fail(n, 'dot', e); }
    }
  }

  // Una nota cualquiera dibujada fuera de la página, con sus fórmulas y diagramas ya resueltos: lo que se publica
  // como página de un sitio (publish.js). Los diagramas salen en el tema claro, que se lee sobre los dos fondos.
  // Devuelve el bloque y las filas del encabezado de la nota. Los enlaces quedan como se escribieron.
  async function drawOff(text) {
    const fm = splitFrontmatter(String(text == null ? '' : text));
    if (settings.plugins.highlight && /^\s*(```|~~~)\s*\w/m.test(fm.body)) await ensure('hljs');
    if (settings.plugins.emoji && !window.markdownitEmoji && EMOJI_RE.test(fm.body)) { if (await ensure('emoji')) parserKey = ''; }
    const box = el('div');
    box.innerHTML = DOMPurify.sanitize(buildParser().render(fm.body), { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    postProcess(box, true);
    await renderMath(box); await renderMermaid(box, true); await renderGraphviz(box);
    return { box, rows: fm.rows || [] };
  }

  // ---------- Ajustes > Plugins: la lista y el ejemplo de cada uno ----------
  // Un fragmento suelto dibujado con otra lista de plugins, por el mismo camino que la nota: el parser, el saneado y
  // los retoques. No toca la nota abierta ni los ajustes guardados. Las fórmulas y los diagramas quedan como se
  // escribieron: los resuelve sampleFull, que es quien pide las librerías pesadas.
  function sample(text, plugins) {
    const p = Object.assign({}, plugins);
    const fm = p.frontmatter ? splitFrontmatter(text) : { body: text, rows: null };
    const box = el('div');
    box.innerHTML = DOMPurify.sanitize(LMD.md.buildParser(p).render(fm.body), { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    postProcess(box, 'sample', p);
    if (fm.rows && fm.rows.length) box.insertBefore(frontmatterNode(fm.rows), box.firstChild);
    return box;
  }
  // Lo que cada plugin pide en diferido, y si ya está acá.
  const SAMPLE_LAZY = { highlight: 'hljs', emoji: 'emoji', katex: 'katex', mermaid: 'mermaid', graphviz: 'graphviz' };
  const SAMPLE_HAVE = { hljs: () => !!window.hljs, emoji: () => !!window.markdownitEmoji, katex: () => !!window.katex, mermaid: () => !!window.mermaid, graphviz: () => !!window.Viz };
  async function sampleFull(text, plugins) {
    for (const k of ['highlight', 'emoji']) {
      if (plugins[k] && !SAMPLE_HAVE[SAMPLE_LAZY[k]]() && (await ensure(SAMPLE_LAZY[k])) && k === 'emoji') parserKey = ''; // la nota abierta también los gana
    }
    const box = sample(text, plugins);
    await renderMath(box); await renderMermaid(box, false, true); await renderGraphviz(box);
    return box;
  }
  LMD.plugSample = { draw: sample, full: sampleFull, lazy: SAMPLE_LAZY, have: (k) => !SAMPLE_LAZY[k] || SAMPLE_HAVE[SAMPLE_LAZY[k]]() };

  const PLUG_SEL = 'lmd:plug-sel'; const PLUG_STAY = 700;
  let plugSel = '';
  // Lista y detalle, como en Herramientas (tools.js): a la izquierda los interruptores en sus cinco bloques, a la
  // derecha el plugin elegido con lo que hace y un ejemplo: lo que se escribe, y cómo se ve apagado y prendido.
  // En pantalla ancha los interruptores van en dos columnas. El detalle sigue al cursor (LMD.tools.follow) y al foco.
  // El ejemplo de un plugin que pide una librería pesada se dibuja cuando el cursor se queda en él o con un clic:
  // pasar por toda la lista no descarga nada.
  function plugPane(box) {
    if (box._lmdPlug) box._lmdPlug.abort();
    const off = new AbortController(); box._lmdPlug = off; const live = { signal: off.signal };
    const d = LMD.tools.detail(box);
    const side = d.side; const body = side.querySelector('.lmd-tl-side-body'); const sideOn = side.querySelector('[data-tl-side=on]');
    const part = (id, label) => '<div class="lmd-plg-part" data-pg="' + id + '"><h5><span>' + T(label) + '</span><em class="lmd-plg-now" hidden>' + T('Tu ajuste') + '</em></h5>' + (id === 'src' ? '<pre class="lmd-plg-src"><code></code></pre>' : '<div class="lmd-plg-out markdown-body"></div>') + '</div>';
    body.innerHTML = '<p class="lmd-tl-about"></p><div class="lmd-plg-ex" role="region" aria-label="' + T('Ejemplo') + '" aria-live="polite">' + part('src', 'Escribís') + part('off', 'Apagado') + part('on', 'Prendido') +
      '<p class="lmd-hint lmd-plg-wait" hidden>' + T('Cargando…') + '</p></div>';
    const rows = Array.from(box.querySelectorAll('.lmd-plg-row'));
    const rowOf = (k) => rows.find((r) => r.dataset.plug === k) || null;
    const inputOf = (k) => rowOf(k).querySelector('[data-plugin]');
    let sel = ''; let seq = 0; let stay = 0;
    // Solo la fila que tuvo el foco queda en el orden de Tab: de ahí se pasa al detalle, y las flechas recorren la lista.
    const rove = (row) => rows.forEach((r) => r.querySelectorAll('[data-plug-pick], [data-plugin]').forEach((n) => { n.tabIndex = r === row ? 0 : -1; }));
    // Lo dibujado es para mirar: no entra en el orden de Tab, no repite ids de la nota y sus enlaces no llevan a ningún lado.
    const tame = (out) => {
      out.querySelectorAll('a, button, input, summary, select, textarea, [tabindex]').forEach((n) => { n.tabIndex = -1; });
      out.querySelectorAll(':not(svg):not(svg *)[id]').forEach((n) => n.removeAttribute('id'));
    };
    const put = (id, node) => { const out = body.querySelector('[data-pg=' + id + '] .lmd-plg-out'); out.textContent = ''; while (node.firstChild) out.appendChild(node.firstChild); tame(out); };
    const mine = () => { const on = !!inputOf(sel).checked; sideOn.checked = on; body.querySelector('[data-pg=off] .lmd-plg-now').hidden = on; body.querySelector('[data-pg=on] .lmd-plg-now').hidden = !on; };
    // El texto que se muestra y el que se dibuja son el mismo, salvo la imagen: se ve un nombre corto y se dibuja el ícono de la app.
    const source = (k) => T(LMD.PLUGIN_SAMPLES[k] || '');
    const drawn = (k) => (k === 'imageViewer' ? source(k).replace(/\(([^)]*)\)$/, '(' + chrome.runtime.getURL('icons/icon128.png') + ')') : source(k));
    const full = async (k) => {
      clearTimeout(stay); const my = seq;
      let node = null; try { node = await sampleFull(drawn(k), { [k]: true }); } catch (e) { node = null; }
      if (my !== seq || sel !== k || !side.isConnected) return;
      if (node) put('on', node);
      body.querySelector('.lmd-plg-wait').hidden = true;
    };
    // Elige un plugin: el detalle pasa a él. now: el ejemplo pesado se dibuja ya (un clic), sin esperar a que el cursor se quede.
    const pick = (k, now) => {
      if (!rowOf(k)) return;
      if (sel === k) { if (now && !body.querySelector('.lmd-plg-wait').hidden) full(k); return; }
      sel = k; plugSel = k; seq++; clearTimeout(stay);
      try { sessionStorage.setItem(PLUG_SEL, k); } catch (e) { /* sin almacenamiento vale mientras dure la página */ }
      rows.forEach((r) => { const on = r.dataset.plug === k; r.classList.toggle('lmd-tl-now', on); r.querySelector('[data-plug-pick]').setAttribute('aria-current', String(on)); });
      side.dataset.plug = k;
      side.querySelector('h4').textContent = T(LMD.PLUGIN_LABELS[k]);
      sideOn.setAttribute('aria-label', T(LMD.PLUGIN_LABELS[k]));
      body.querySelector('.lmd-tl-about').textContent = T(LMD.PLUGIN_HELP[k] || '');
      body.querySelector('.lmd-plg-src code').textContent = source(k);
      put('off', sample(drawn(k), { [k]: false })); put('on', sample(drawn(k), { [k]: true }));
      mine(); body.scrollTop = 0;
      const wait = !LMD.plugSample.have(k);
      // Mientras la librería no está, la fórmula se ve como se escribió.
      if (wait) body.querySelectorAll('[data-pg=on] .lmd-math:empty').forEach((n) => { n.textContent = n.getAttribute('data-tex') || ''; });
      body.querySelector('.lmd-plg-wait').hidden = !wait;
      if (SAMPLE_LAZY[k] && !wait) full(k); // ya está cargada: directo
      else if (wait) { if (now) full(k); else stay = setTimeout(() => { if (sel === k && side.isConnected && !side.hidden) full(k); }, PLUG_STAY); }
    };
    const still = LMD.tools.follow(d, rows, (r) => pick(r.dataset.plug), live);
    rows.forEach((r) => {
      const k = r.dataset.plug;
      r.addEventListener('focusin', () => { rove(r); pick(k); }, live);
      // Toda la fila elige, menos su interruptor, que prende y apaga. En pantalla angosta, además abre el detalle encima.
      r.addEventListener('click', (e) => { still(); if (e.target.closest('.lmd-switch')) return; rove(r); pick(k, true); if (d.enter()) side.focus({ preventScroll: true }); }, live);
      inputOf(k).addEventListener('change', () => { if (sel === k) mine(); }, live);
    });
    sideOn.addEventListener('change', () => { const input = inputOf(sel); input.checked = sideOn.checked; input.dispatchEvent(new Event('change', { bubbles: true })); });
    // Con el teclado: arriba y abajo pasan de fila en fila, de un bloque al siguiente; izquierda y derecha, a la fila
    // de la otra columna que queda a la misma altura; Inicio y Fin, a las puntas.
    box.addEventListener('keydown', (e) => {
      const from = e.target.closest('[data-plug-pick], [data-plugin]'); if (!from || e.altKey || e.ctrlKey || e.metaKey) return;
      const at = rows.indexOf(from.closest('.lmd-plg-row'));
      if (at < 0) return;
      let next = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const me = rows[at].getBoundingClientRect(); let best = Infinity;
        rows.forEach((r) => { const b = r.getBoundingClientRect(); if (e.key === 'ArrowRight' ? b.left <= me.left + 4 : b.left >= me.left - 4) return; const far = Math.abs(b.top - me.top); if (far < best) { best = far; next = r; } });
        if (!next) return;
      } else {
        const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key]; if (to === undefined) return;
        next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      }
      e.preventDefault(); if (!next || next === rows[at]) return;
      next.querySelector(from.matches('[data-plugin]') ? '[data-plugin]' : '[data-plug-pick]').focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest' });
    }, live);
    d.back = () => { const b = rowOf(sel) && rowOf(sel).querySelector('[data-plug-pick]'); if (b) b.focus({ preventScroll: true }); };
    // Lo de mirar no se toca: un enlace del ejemplo no navega.
    body.addEventListener('click', (e) => { if (e.target.closest('.lmd-plg-out a')) e.preventDefault(); });
    if (!plugSel) { try { plugSel = sessionStorage.getItem(PLUG_SEL) || ''; } catch (e) { /* sin almacenamiento */ } }
    const first = rowOf(plugSel) || rows[0];
    if (first) { rove(first); pick(first.dataset.plug); }
    d.fit();
  }

  function frontmatterNode(rows) {
    const box = el('dl', { class: 'lmd-front' });
    rows.forEach(([k, v]) => {
      box.appendChild(el('dt', { text: k }));
      box.appendChild(el('dd', { text: v.replace(/^(["'])(.*)\1$/, '$2') }));
    });
    return box;
  }

  // Copia con formato: lo seleccionado dentro del documento o, si no hay selección, el documento entero.
  function copyRich(btn) {
    const sel = window.getSelection();
    const box = el('div');
    if (sel && !sel.isCollapsed && ui.article.contains(sel.anchorNode)) box.appendChild(sel.getRangeAt(0).cloneContents());
    else box.innerHTML = ui.article.innerHTML;
    box.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-kanban-off, .lmd-jy, .lmd-front, .lmd-cl-bar, .lmd-cl-add, .lmd-cl-grip').forEach((n) => n.remove());
    box.querySelectorAll('table').forEach((t) => { t.setAttribute('style', 'border-collapse:collapse'); });
    box.querySelectorAll('th, td').forEach((c) => c.setAttribute('style', 'border:1px solid #c9c9c9;padding:6px 10px;vertical-align:top'));
    box.querySelectorAll('pre').forEach((p) => p.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:10px;white-space:pre-wrap'));
    box.querySelectorAll('code').forEach((c) => { if (!c.closest('pre')) c.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:1px 4px'); });
    box.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'));
    const html = box.innerHTML;
    document.body.appendChild(box); box.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
    const plain = box.innerText;
    box.remove();
    const done = () => {
      flash(T('Copiado con formato'));
      if (!btn) return;
      const old = btn.innerHTML; btn.innerHTML = ICON.check; btn.classList.add('lmd-ok');
      setTimeout(() => { btn.innerHTML = old; btn.classList.remove('lmd-ok'); }, 1400);
    };
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]).then(done, () => copyText(plain, btn));
    } catch (e) { copyText(plain, btn); }
  }

  const countWords = (t) => (t.trim().match(/\S+/g) || []).length;
  const fmt = (n) => n.toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR');
  function updateCount() {
    const sel = window.getSelection();
    const scope = rawMode ? ui.rawPre : ui.article;
    if (sel && !sel.isCollapsed && scope.contains(sel.anchorNode)) {
      const t = sel.toString();
      const w = countWords(t);
      ui.count.textContent = T(w === 1 ? 'Selección: {w} palabra · {c} caracteres' : 'Selección: {w} palabras · {c} caracteres', { w: fmt(w), c: fmt(t.length) });
      ui.count.classList.add('lmd-count-sel');
    } else {
      const t = scope.innerText || '';
      ui.count.textContent = T('{w} palabras', { w: fmt(countWords(t)) });
      ui.count.classList.remove('lmd-count-sel');
    }
  }

  // Posición de lectura por archivo
  const posKey = () => HERE;
  const savePosition = debounce(() => {
    if (!settings.rememberPosition) return;
    chrome.storage.local.get('positions', (r) => {
      const all = (r && r.positions) || {};
      all[posKey()] = { y: Math.round(window.scrollY), t: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > 300) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - 300).forEach((k) => delete all[k]);
      chrome.storage.local.set({ positions: all });
    });
  }, 400);
  function restorePosition() {
    if (!settings.rememberPosition) return;
    chrome.storage.local.get('positions', (r) => {
      const p = r && r.positions && r.positions[posKey()];
      if (p && p.y > 0) window.scrollTo(0, p.y);
    });
  }

  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      const old = btn.innerHTML; btn.innerHTML = ICON.check; btn.classList.add('lmd-ok');
      setTimeout(() => { btn.innerHTML = old; btn.classList.remove('lmd-ok'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* sin portapapeles */ }
    ta.remove();
  }

  // ---------- Interfaz ----------
  const ui = {};

  function buildUI() {
    document.documentElement.classList.add('lmd-root');
    document.body.textContent = '';
    document.body.classList.add('lmd-body');
    if (!document.querySelector('meta[name=viewport]')) {
      document.head.appendChild(el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }));
    }
    ui.customStyle = el('style', { id: 'lmd-custom-css' });
    // Ícono de la pestaña: el de SharpMD, para que no quede el genérico ni el de otra extensión.
    document.querySelectorAll('link[rel~="icon"]').forEach((n) => n.remove());
    // El logo en su grilla de 16 px (la de icons/icon16.png, ver tools/build-icons.mjs): en la pestaña cada trazo cae en píxeles enteros.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3.75" fill="#14161a"/><path fill="#f3f5f8" d="M3 4h2v8H3zM7 4h2v8H7zM2 5h8v2H2zM2 9h8v2H2z"/><rect x="11" y="3" width="3" height="10" rx=".5" fill="#c5f467"/></svg>';
    document.head.appendChild(el('link', { rel: 'icon', type: 'image/svg+xml', href: 'data:image/svg+xml,' + encodeURIComponent(svg) }));
    document.head.appendChild(ui.customStyle);

    ui.sidebar = el('aside', { class: 'lmd-sidebar' });
    ui.sidebar.innerHTML =
      // El buscador va arriba de todo. Debajo, las dos zonas a la vez: el índice de la nota y el explorador.
      '<div class="lmd-search">' +
        '<span class="lmd-search-ico">' + ICON.search + '</span>' +
        '<input type="search" spellcheck="false">' +
        '<span class="lmd-search-count"></span>' +
      '</div>' +
      '<div class="lmd-zones">' +
        '<section class="lmd-zone lmd-zone-outline" data-zone="outline">' +
          '<div class="lmd-zone-head"><button type="button" class="lmd-zone-tog" data-zone-tog="outline"><span class="lmd-node-chev">' + ICON.chevron + '</span><span>' + T('Índice') + '</span></button></div>' +
          '<div class="lmd-pane lmd-pane-outline" data-pane="outline"></div>' +
        '</section>' +
        '<div class="lmd-split" title="' + T('Arrastrar para cambiar el alto') + '"></div>' +
        '<section class="lmd-zone lmd-zone-files" data-zone="files">' +
          '<div class="lmd-zone-head"><button type="button" class="lmd-zone-tog" data-zone-tog="files"><span class="lmd-node-chev">' + ICON.chevron + '</span><span>' + T('Archivos') + '</span></button>' +
            '<button type="button" class="lmd-zone-btn lmd-tree-refresh" data-act="tree-refresh" title="' + T('Actualizar la lista de archivos') + '" aria-label="' + T('Actualizar la lista de archivos') + '">' + ICON.reload + '</button>' +
            (APP ? '<button type="button" class="lmd-zone-btn lmd-tree-add" title="' + T('Crear') + '">' + ICON.plus + '</button>' : '') +
            '<button type="button" class="lmd-zone-btn lmd-tree-open" title="' + T(APP ? 'Abrir otra carpeta o archivo' : 'Abrir otro archivo o carpeta') + '">' + ICON.open + '</button></div>' +
          '<div class="lmd-pane lmd-pane-files" data-pane="files"><div class="lmd-tree-box"></div><div class="lmd-results" hidden></div></div>' +
        '</section>' +
      '</div>' +
      '<div class="lmd-update" role="status" hidden></div>' +
      // La cuenta, fija al pie: quién entró y su plan, o la invitación a entrar. La dibuja home.js.
      (APP ? '<div class="lmd-home-cloud lmd-side-acct" hidden></div>' : '') +
      '<div class="lmd-resizer" title="' + T('Arrastrar para cambiar el ancho') + '"></div>';

    ui.main = el('main', { class: 'lmd-main' });
    ui.main.innerHTML =
      '<div class="lmd-topbar">' +
        '<div class="lmd-top-left">' +
          '<button class="lmd-icon-btn" data-act="sidebar" title="' + T(window.__MDT_WEB ? 'Barra lateral' : 'Barra lateral (Alt+Shift+B)') + '">' + ICON.side + '</button>' +
          '<span class="lmd-docname lmd-doc-only"></span>' +
          '<button class="lmd-icon-btn lmd-sync lmd-doc-only" data-act="sync" hidden></button>' +
        '</div>' +
        // Al centro, lo que cambia el modo de trabajo: ver o editar, insertar y guardar.
        '<div class="lmd-top-mid lmd-doc-only">' +
          '<div class="lmd-modeseg" role="radiogroup" aria-label="' + T('Modo') + '">' +
            '<button type="button" role="radio" data-act="mode-read" aria-checked="true" class="lmd-on" aria-label="' + T('Ver') + '">' + ICON.eye + '</button>' +
            '<button type="button" role="radio" data-act="mode-edit" aria-checked="false" aria-label="' + T('Editar') + '">' + ICON.pencil + '</button>' +
          '</div>' +
          '<button class="lmd-icon-btn lmd-insert" data-act="insert" title="' + T('Insertar un bloque (también con clic derecho)') + '">' + ICON.plus + '</button>' +
          '<button class="lmd-icon-btn lmd-save" data-act="save" title="' + T('Guardar (Ctrl+S)') + '" hidden>' + ICON.save + '</button>' +
        '</div>' +
        '<div class="lmd-top-right">' +
          '<div class="lmd-view lmd-doc-only" role="radiogroup" aria-label="' + T('Vista') + '">' +
            '<button type="button" role="radio" data-act="view-doc" class="lmd-on" aria-checked="true" title="' + T('Ver documento') + '">' + ICON.doc + '</button>' +
            '<button type="button" role="radio" data-act="view-raw" aria-checked="false" title="' + T('Ver código fuente') + '">' + ICON.code + '</button>' +
          '</div>' +
          '<span class="lmd-sep lmd-doc-only"></span>' +
          // Copiar y exportar: un botón cada uno, y adentro qué copiar o a qué formato.
          '<button class="lmd-icon-btn lmd-doc-only" data-act="copy" aria-haspopup="menu" aria-expanded="false" title="' + T('Copiar') + '">' + ICON.copy + '</button>' +
          '<button class="lmd-icon-btn lmd-doc-only" data-act="export" aria-haspopup="menu" aria-expanded="false" title="' + T('Exportar') + '">' + ICON.download + '</button>' +
          // Recargar solo sirve para lo que vive en el disco: lo demás se actualiza solo.
          '<button class="lmd-icon-btn lmd-doc-only lmd-reload" data-act="reload" title="' + T('Recargar ahora') + '">' + ICON.reload + '</button>' +
          // Lo que vale para esta nota y no para la persona: el ancho de la página y lo que siga (page.js).
          '<button class="lmd-icon-btn lmd-doc-only lmd-page-btn" data-act="page" aria-haspopup="dialog" title="' + T('Ajustes de la página') + '"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 12h8M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/></svg></button>' +
          '<span class="lmd-sep lmd-doc-only"></span>' +
          // Claro u oscuro, a mano y sin depender del dispositivo. El dibujo y el nombre los pone paintTheme.
          '<button class="lmd-icon-btn lmd-flip" data-act="theme-flip"></button>' +
          '<button class="lmd-icon-btn" data-act="settings" title="' + T('Ajustes') + '">' + ICON.sliders + '</button>' +
          // En pantalla chica todo lo de este grupo, y la nube, se abre desde acá.
          '<button class="lmd-icon-btn lmd-more lmd-doc-only" data-act="more" aria-haspopup="menu" aria-expanded="false" title="' + T('Más acciones') + '">' + ICON.more + '</button>' +
        '</div>' +
      '</div>' +
      // Sin nota abierta, acá va el estado vacío: lo dibuja home.js.
      '<section class="lmd-home" hidden></section>' +
      '<article class="lmd-article markdown-body"></article>' +
      '<pre class="lmd-raw lmd-doc-only" hidden></pre>' +
      '<textarea class="lmd-raw lmd-raw-edit" spellcheck="false" hidden></textarea>' +
      // Pie: avisos a la izquierda; estado del guardado y contador a la derecha.
      '<footer class="lmd-foot lmd-doc-only"><span class="lmd-status"></span><span class="lmd-savestate"></span><span class="lmd-count" title="' + T('Palabras y caracteres') + '"></span>' +
        // Solo sobre una nota de otra persona (enlace público, compartida, sesión en vivo como invitado).
        '<button type="button" class="lmd-link lmd-report" data-act="report" hidden>' + T('Denunciar esta nota') + '</button></footer>';

    ui.toTop = el('button', { class: 'lmd-to-top', title: T('Volver arriba'), hidden: '' }, ICON.up);
    ui.panel = el('div', { class: 'lmd-panel', hidden: '' });
    ui.viewer = el('div', { class: 'lmd-viewer', hidden: '' });
    ui.format = el('div', { class: 'lmd-format', hidden: '' },
      '<button type="button" data-fmt="bold" title="' + T('Negrita (Ctrl+B)') + '"><b>B</b></button>' +
      '<button type="button" data-fmt="italic" title="' + T('Cursiva (Ctrl+I)') + '"><i>I</i></button>' +
      '<button type="button" data-fmt="strike" title="' + T('Tachado') + '"><s>S</s></button>' +
      '<button type="button" data-fmt="code" title="' + T('Código') + '">' + ICON.code + '</button>' +
      '<button type="button" data-fmt="math" title="' + T('Fórmula en línea') + '">' + ICON.b_math + '</button>' +
      '<button type="button" data-fmt="link" title="' + T('Enlace (Ctrl+K)') + '">' + ICON.link + '<span class="lmd-format-label">' + T('Editar el enlace') + '</span></button>' +
      '<button type="button" data-fmt="clear" title="' + T('Quitar formato') + '">' + ICON.close + '</button>');
    ui.tableBar = el('div', { class: 'lmd-tablebar', hidden: '' },
      '<button type="button" data-top="row+">+ ' + T('Fila') + '</button>' +
      '<button type="button" data-top="col+">+ ' + T('Columna') + '</button>' +
      '<button type="button" data-top="row-">− ' + T('Fila') + '</button>' +
      '<button type="button" data-top="col-">− ' + T('Columna') + '</button>' +
      '<button type="button" data-top="total" title="' + T('Agregar una fila que suma cada columna') + '">Σ ' + T('Totales') + '</button>');

    // En pantalla chica la barra lateral se abre encima del contenido; esto oscurece lo que queda detrás.
    ui.scrim = el('div', { class: 'lmd-scrim' });
    // Los atajos de teclado, a mano y sin ocupar la barra de arriba: solo donde hay teclado físico (lo decide el CSS).
    ui.keysBtn = el('button', { class: 'lmd-keys-btn', type: 'button', 'data-act': 'shortcuts', title: T('Atajos de teclado') + ' (?)', 'aria-label': T('Atajos de teclado') }, ICON.keyboard);
    document.body.append(ui.sidebar, ui.scrim, ui.main, ui.toTop, ui.keysBtn, ui.panel, ui.viewer, ui.format, ui.tableBar);

    ui.article = ui.main.querySelector('.lmd-article');
    // El cartel de una copia de un archivo del disco (paintCopy), arriba de la nota.
    ui.copyBar = el('div', { class: 'lmd-copybar', role: 'status', hidden: '' });
    ui.article.parentNode.insertBefore(ui.copyBar, ui.article);
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-fs=grant]'); if (b) { e.preventDefault(); fsGrant(!!b.closest('.lmd-copybar')); } const w = e.target.closest('[data-write]'); if (w && diskRoot) { e.preventDefault(); askWrite(diskRoot); } });
    ui.rawPre = ui.main.querySelector('pre.lmd-raw');
    ui.rawEdit = ui.main.querySelector('.lmd-raw-edit');
    ui.status = ui.main.querySelector('.lmd-status');
    ui.count = ui.main.querySelector('.lmd-count');
    ui.treeBox = ui.sidebar.querySelector('.lmd-tree-box');
    ui.results = ui.sidebar.querySelector('.lmd-results');
    ui.paneFiles = ui.sidebar.querySelector('.lmd-pane-files');
    ui.paneOutline = ui.sidebar.querySelector('.lmd-pane-outline');
    ui.zones = ui.sidebar.querySelector('.lmd-zones');
    ui.searchBox = ui.sidebar.querySelector('.lmd-search');
    ui.update = ui.sidebar.querySelector('.lmd-update');
    ui.acct = ui.sidebar.querySelector('.lmd-side-acct');
    ui.searchInput = ui.searchBox.querySelector('input');
    ui.searchCount = ui.searchBox.querySelector('.lmd-search-count');

    ui.home = ui.main.querySelector('.lmd-home');
    ui.more = ui.main.querySelector('.lmd-more');
    watchBar();
    paintDoc();
    bindEvents();
    bindEditing();
    LMD.touch.init();
    LMD.dialog.init();
    // Mantener apretado: leyendo abre el menú de lectura; editando, el dedo quieto elige texto, como en cualquier editor.
    LMD.touch.longPress(ui.article, () => !editMode);
    LMD.touch.longPress(ui.treeBox);
    LMD.write.init(core);
    // lists.js es un archivo aparte: si una copia guardada de la app todavía no lo trae, el resto arranca igual.
    if (LMD.lists) LMD.lists.init(core);
    LMD.links.init(core);
    if (LAZY_HAVE.tools()) { LMD.diagram.init(core); LMD.formula.init(core); toolsReady = Promise.resolve(true); }
    else { const later = () => (window.requestIdleCallback ? requestIdleCallback(tools, { timeout: 2500 }) : setTimeout(tools, 300)); if (document.readyState === 'complete') later(); else window.addEventListener('load', later); }
    LMD.send.init(core);
    LMD.extras.init(core);
    if (LMD.images) LMD.images.init(core);
    LMD.board.init(core);
    // page.js es un archivo aparte: si una copia guardada de la app todavía no lo trae, el resto arranca igual.
    if (LMD.page) LMD.page.init(core);
    if (LMD.fold) LMD.fold.init(core);
    if (LMD.blocks) LMD.blocks.init(core);
    ui.sync =ui.main.querySelector('.lmd-sync');
    LMD.sync.init(core);
    LMD.comments.init(core);
    LMD.vault.init(core);
    LMD.live.init(core);
    LMD.team.init(core);
    LMD.install.init(core, homeCtx);
    LMD.tools.init(core);
    forcedSay();
    document.documentElement.dataset.lmdFs = String(!!window.showOpenFilePicker && window.isSecureContext);
  }

  function bindEvents() {
    document.body.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (actEl) { onAction(actEl.dataset.act, actEl, !e.detail); return; }
      if (e.target === ui.scrim) { setDrawer(false); return; }
      if (sideClick(e)) return;
      const img = e.target.closest('img.lmd-zoomable');
      if (img && !img.closest('a') && !editMode) { openViewer(img); return; }
      const plain = !(e.ctrlKey || e.metaKey || e.shiftKey);
      if (e.target.closest('.lmd-res-doc')) { stepSearch(1); setDrawer(false); return; }
      const res = e.target.closest('.lmd-results a');
      if (res && (APP ? res.href.split('#')[0] === location.href.split('#')[0] : sameUrl(res.href, HERE))) { e.preventDefault(); stepSearch(1); setDrawer(false); return; }
      // Un archivo del árbol, un resultado de búsqueda o un reciente: se abre sin recargar la página.
      const nav = e.target.closest('a.lmd-node, .lmd-results a');
      if (nav && APP && plain && offerImport(nav.dataset.url)) { e.preventDefault(); return; }
      if (nav && inApp(nav)) { if (plain) { e.preventDefault(); if (e.detail) nav.blur(); openDoc(nav.href); } return; }
      // Sobre un archivo abierto directo también, si es algo que SharpMD dibuja; el resto lo abre el navegador.
      if (nav && !APP) {
        const to = nav.classList.contains('lmd-node') ? nav.dataset.url : nav.href;
        // Una nota de la nube: la abre la app, en otra pestaña, igual que al subir una nota desde acá.
        if (to && to.startsWith(VBASE)) { e.preventDefault(); if (e.detail) nav.blur(); bg({ type: 'openApp', query: appQuery(to) }); return; }
        if (plain && to && opensHere(to)) { e.preventDefault(); if (e.detail) nav.blur(); goFile(to); }
        return;
      }
      const a = e.target.closest('.lmd-article a[href], .lmd-pane-outline a');
      if (!a) return;
      // Editando, el clic sobre un enlace pone el cursor; para seguirlo va con Ctrl.
      const editing = editMode && !!a.closest('.lmd-editable');
      if (editing && !(e.ctrlKey || e.metaKey)) return;
      const href = a.getAttribute('href');
      // Elegir una sección en el índice deja ver a dónde se fue.
      if (a.closest('.lmd-pane-outline')) setDrawer(false);
      if (href[0] === '#') {
        // Un enlace escrito como en GitHub (con acentos o mayúsculas) llega igual al título, que acá lleva el ancla sin acentos.
        const frag = unesc(href.slice(1));
        const target = findAnchor(frag);
        e.preventDefault();
        // Con otro archivo a la vista, el fragmento dice cuál es: la sección no lo reemplaza.
        if (target) { spyPin = a.closest('.lmd-pane-outline') ? target.id : null; shown(target); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!FILE_FRAG.test(location.hash)) history.replaceState(null, '', '#' + target.id); }
        else if (frag) noSection(frag); else window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (APP && (a.hasAttribute('data-lmd-href') || a.classList.contains('lmd-wiki'))) {
        // Otro archivo de la carpeta. Leyendo, Ctrl o Shift lo abren aparte, como cualquier enlace.
        if (!editing && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault(); openDoc(a.href);
      } else if (!APP && a.target !== '_blank' && opensHere(a.href)) {
        // Sobre un archivo abierto directo, un enlace a otro Markdown, texto, JSON o YAML de la carpeta se abre acá.
        if (!editing && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault(); goFile(a.href);
      } else if (editing) {
        e.preventDefault();
        if (/^https?:/i.test(href) && a.host !== location.host) window.open(a.href, '_blank', 'noopener'); else if (inApp(a)) openDoc(a.href); else location.href = a.href;
      }
    });

    ui.toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.addEventListener('mousedown', (e) => { if (moreMenu && !moreMenu.contains(e.target) && !moreBtn.contains(e.target)) closeMore(); });
    window.addEventListener('scroll', closeMore, { passive: true });
    ui.viewer.addEventListener('click', () => { ui.viewer.hidden = true; ui.viewer.textContent = ''; });

    // El índice se recalcula a lo sumo una vez por cuadro, no en cada evento de scroll.
    let scrollQueued = false;
    window.addEventListener('scroll', () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => { scrollQueued = false; onScroll(); });
    }, { passive: true });
    window.addEventListener('scroll', savePosition, { passive: true });
    document.addEventListener('selectionchange', debounce(updateCount, 80));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (moreMenu) closeMore(true);
        else if (!ui.viewer.hidden) ui.viewer.click();
        // En pantalla angosta, con el detalle de una herramienta abierto encima de la lista, Escape vuelve a la lista.
        else if (!ui.panel.hidden) { if (!LMD.tools.shut(true)) closePanel(); }
        else if (drawerOpen()) setDrawer(false);
        else if (ui.searchInput.value || document.activeElement === ui.searchInput) toggleSearch(false);
      }
      if (LMD.mod(e) && !e.shiftKey && e.key.toLowerCase() === 's' && (editMode || dirty || (appRoot && appRoot.kind === 'local'))) { e.preventDefault(); save(true); }
      if (LMD.mod(e) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleSearch(true); }
      if (window.__MDT_WEB && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') { e.preventDefault(); flipTheme(); }
      if (LMD.mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && editMode && !rawMode && docKind() === 'md') { e.preventDefault(); LMD.links.open(); }
      // La hoja de atajos: "?" fuera de un campo de texto, o Ctrl+/ en cualquier lado. Por la letra y no por la tecla:
      // en un teclado en español la barra va con Shift, y su tecla sola con Ctrl es el zoom del navegador.
      const t = e.target; const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (!e.altKey && ((e.key === '?' && !e.ctrlKey && !e.metaKey && !typing) || (e.key === '/' && LMD.mod(e))) && !document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres')) { e.preventDefault(); openKeys(); }
    });

    ui.searchInput.addEventListener('input', debounce(() => runSearch(ui.searchInput.value, true), 180));
    ui.searchInput.addEventListener('input', () => document.documentElement.classList.toggle('lmd-searching', !!ui.searchInput.value.trim()));
    ui.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
    });

    // Ancho de la barra lateral
    const resizer = ui.sidebar.querySelector('.lmd-resizer');
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('lmd-resizing');
      const move = (ev) => {
        const w = Math.min(560, Math.max(200, ev.clientX));
        document.documentElement.style.setProperty('--lmd-side-w', w + 'px');
        settings.sidebarWidth = w;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('lmd-resizing');
        LMD.patch({ sidebarWidth: settings.sidebarWidth });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // Alto de las dos zonas: se arrastra la división y se recuerda.
    ui.sidebar.querySelector('.lmd-split').addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('lmd-resizing', 'lmd-splitting');
      const move = (ev) => { const box = ui.zones.getBoundingClientRect(); side.split = Math.round(Math.min(85, Math.max(15, (ev.clientY - box.top) / box.height * 100))); applySide(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('lmd-resizing', 'lmd-splitting'); saveSide(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'auto') { applySettings(); render(); }
    });
    // Atrás y adelante del navegador: la dirección ya cambió, falta traer la nota que le toca.
    if (APP) window.addEventListener('hashchange', () => { const open = takeOpen(); if (open) LMD.install.openLink(open, homeCtx()); const sign = takeSignin(); if (sign) LMD.home.signinLink(homeCtx(), sign); });
    if (APP) window.addEventListener('popstate', () => {
      if (/^#(open|signin)=/.test(location.hash)) return; // lo atiende hashchange
      const f = new URLSearchParams(location.search).get('f') || '';
      if (noDoc ? !f : VBASE + f === HERE) { const frag = unesc(location.hash.slice(1)); const t = frag && !/^lmd-/.test(frag) ? findAnchor(frag) : null; if (t) { shown(t); t.scrollIntoView(); } return; }
      go(f, { pop: true, hash: location.hash });
    });
    if (!APP) { window.addEventListener('popstate', onReaderPop); window.addEventListener('hashchange', onReaderPop); }

    // El explorador con el teclado: las flechas recorren lo que está a la vista, derecha e izquierda despliegan y
    // pliegan una carpeta (o van a la que contiene al archivo), Inicio y Fin van a las puntas. Enter abre, como siempre.
    ui.treeBox.addEventListener('keydown', (e) => {
      const cur = e.target.closest && e.target.closest('.lmd-node');
      if (!cur || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      const all = Array.from(ui.treeBox.querySelectorAll('.lmd-node')).filter((n) => n.offsetParent);
      const at = all.indexOf(cur); const dir = cur.classList.contains('lmd-node-dir'); const open = cur.classList.contains('lmd-open');
      let to = null;
      if (e.key === 'ArrowDown') to = all[at + 1];
      else if (e.key === 'ArrowUp') to = all[at - 1];
      else if (e.key === 'Home') to = all[0];
      else if (e.key === 'End') to = all[all.length - 1];
      else if (e.key === 'ArrowRight') { if (dir && !open) cur.click(); else if (dir) to = all[at + 1]; }
      else if (dir && open) cur.click();
      else { const kids = cur.closest('.lmd-node-kids'); let up = kids && kids.previousElementSibling; while (up && !up.classList.contains('lmd-node-dir')) up = up.previousElementSibling; to = up; }
      e.preventDefault();
      if (to) { to.focus(); to.scrollIntoView({ block: 'nearest' }); }
    });
  }

  // ---------- Pantalla chica: la barra lateral como panel y el menú "más" ----------
  // En pantalla chica la barra lateral arranca cerrada y se abre encima del contenido, sin correrlo. Que esté
  // abierta o cerrada ahí no se guarda: lo recordado (sidebarHidden) es lo del escritorio.
  const drawerOpen = () => document.documentElement.classList.contains('lmd-side-open');
  function setDrawer(open) {
    open = !!open && LMD.touch.small();
    document.documentElement.classList.toggle('lmd-side-open', open);
    ui.main.querySelector('[data-act=sidebar]').setAttribute('aria-expanded', String(open));
    if (!open && ui.sidebar.contains(document.activeElement)) document.activeElement.blur(); // el teclado no queda abierto sobre un panel cerrado
  }

  // La barra de arriba cuando la ventana se achica (o la barra lateral se ensancha): sus tres grupos nunca se pisan.
  // La grilla ya garantiza eso (ver .lmd-topbar al final de content.css); acá se decide qué se guarda cuando no
  // entra todo. Primero se acorta el nombre, con puntos suspensivos. Si no alcanza, los íconos de la derecha, la
  // nube e insertar pasan al menú "más" (lmd-bar-tight). Y si ni así entra, se van el nombre y el selector de
  // vista, que también queda en "más" (lmd-bar-min). El selector de ver o editar está siempre entero.
  function fitBar() {
    const root = document.documentElement; const bar = ui.main.querySelector('.lmd-topbar');
    const was = root.classList.contains('lmd-bar-tight');
    root.classList.remove('lmd-bar-tight', 'lmd-bar-min');
    if (LMD.touch.small() || !bar.offsetParent) { if (was) closeMore(); return; }
    const name = bar.querySelector('.lmd-docname');
    const over = () => bar.scrollWidth > bar.clientWidth + 1;
    if (over() || (name.offsetParent && name.textContent && name.clientWidth < Math.min(72, name.scrollWidth))) root.classList.add('lmd-bar-tight');
    if (over()) root.classList.add('lmd-bar-min');
    if (was !== root.classList.contains('lmd-bar-tight')) closeMore();
  }
  function watchBar() {
    const bar = ui.main.querySelector('.lmd-topbar'); let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitBar(); }); };
    if (window.ResizeObserver) new ResizeObserver(later).observe(bar);
    // Lo que aparece o se va de la barra (guardar, la nube, quién está en vivo) y el nombre de la nota.
    new MutationObserver(later).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', later);
    later();
  }

  // Los menús de la barra de arriba: "copiar", "exportar" y, en pantalla chica, "más". Uno solo abierto a la vez,
  // debajo de su botón, con el mismo aspecto que los menús contextuales. items: [id, ícono, texto, atajo].
  let moreMenu = null; let moreBtn = null;
  function closeMore(focus) {
    if (!moreMenu) return;
    moreMenu.remove(); moreMenu = null; moreBtn.setAttribute('aria-expanded', 'false');
    if (focus === true) moreBtn.focus();
  }
  function barMenu(btn, cls, items, keys) {
    const again = moreMenu && moreBtn === btn && moreMenu.classList.contains(cls.split(' ').pop());
    closeMore(); if (again) return;
    LMD.write.closeMenu();
    moreBtn = btn;
    moreMenu = el('div', { class: 'lmd-menu ' + cls, role: 'menu' });
    moreMenu.innerHTML = '<div class="lmd-menu-list">' + items.filter(Boolean).map((i) => '<button type="button" role="menuitem" data-more="' + i[0] + '">' + i[1] + '<span>' + T(i[2]) + '</span>' + (i[3] ? '<kbd>' + i[3] + '</kbd>' : '') + '</button>').join('') + '</div>';
    document.body.appendChild(moreMenu);
    const box = btn.getBoundingClientRect();
    moreMenu.style.left = Math.max(8, Math.min(window.innerWidth - moreMenu.offsetWidth - 8, box.right - moreMenu.offsetWidth)) + 'px';
    moreMenu.style.top = Math.max(8, Math.min(window.innerHeight - moreMenu.offsetHeight - 8, box.bottom + 6)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    moreMenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]'); if (!b) return;
      const byKeys = !e.detail;
      closeMore();
      onAction(b.dataset.more, btn, byKeys);
    });
    // Flechas, Inicio y Fin recorren las opciones; Enter y la barra las eligen solos por ser botones.
    moreMenu.addEventListener('keydown', (e) => {
      const all = Array.from(moreMenu.querySelectorAll('button')); const at = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); all[e.key === 'Home' ? 0 : all.length - 1].focus(); }
      else if (e.key === 'Tab') closeMore();
    });
    if (keys) moreMenu.querySelector('button').focus();
  }
  const PRINT_KEY = LMD.keys('Ctrl+P');
  const hasLink = () => !!appRoot && (appRoot.kind === 'cloud' || appRoot.kind === 'pub');
  // Lo que suman las herramientas prendidas (tools.js) a un menú de la barra: cada una devuelve su renglón o nada.
  const toolItems = (menu) => core.menus[menu].map((fn) => fn()).filter(Boolean);
  // Un archivo del disco abierto por su dirección: el enlace https que lo abre desde un chat o un documento.
  const fileHere = () => (!APP && location.protocol === 'file:' ? LMD.fileUrl(HERE) : '');
  // La ruta local de un archivo o una carpeta, como la escribe el sistema, solo cuando se la conoce de verdad: un
  // archivo abierto en el lector (file://), uno abierto por enlace, o lo de una carpeta cuya ruta se supo por esos
  // caminos (rec.fs). De una carpeta elegida con el selector el navegador no dice la ruta: ahí devuelve ''.
  const diskUrl = (url) => {
    const u = String(url || (noDoc ? '' : HERE));
    if (!u) return '';
    if (!APP) return isFile && /^file:\/\/\//.test(u) ? u.split(/[?#]/)[0] : '';
    const r = rootOf(u);
    if (r && r.kind === 'fs') return fsFile(u);
    if (r && r.kind === 'dir' && r.fs) return r.fs + vParts(u).map(encodeURIComponent).join('/') + (/\/$/.test(u.split('#')[0]) && vParts(u).length ? '/' : '');
    return '';
  };
  const diskPath = (url) => { const f = diskUrl(url); return f ? LMD.filePath(f) : ''; };
  // "Ver la carpeta en el navegador": el listado de esa carpeta, en una pestaña nueva. En la web lo abre la extensión,
  // y solo para carpetas habilitadas. No es el explorador del sistema: una página web no puede abrirlo.
  const canViewFolder = () => (APP ? window.__MDT_WEB === true && LMD.bridge.canOpen() : isFile);
  async function viewFolder(url) {
    const f = diskUrl(url); if (!f) return false;
    const dir = /\/$/.test(f) ? f : new URL('.', f).href;
    if (!APP) { window.open(dir, '_blank', 'noopener'); return true; }
    const r = await LMD.bridge.viewFolder(dir);
    if (r && r.ok && r.opened) return true;
    flash(T(r && r.ok && r.why === 'refused' ? 'La extensión solo muestra carpetas que ya abriste con ella.' : 'No se pudo abrir la carpeta.'), 'warn');
    return false;
  }
  // Sobre un archivo del disco la cuenta anda acá mismo: el lector le habla al servidor por la extensión (cloud.js).
  // Sobre un .md de un sitio no hay cuenta: las pestañas de Ajustes que la piden llevan una franja que lo dice.
  const NO_ACCT = !APP && !LMD.cloud.reach();
  const DIRECT_TABS = ['cloud', 'ai', 'auto', 'plan'];
  // La app (la web o la página de la extensión, según "Abrir SharpMD en"): ahí sí hay cuenta.
  const openInApp = () => bg({ type: 'openApp', pref: true, query: '' });
  function openCopy(btn, keys) {
    const md = docKind() === 'md';
    barMenu(btn, 'lmd-menu-narrow lmd-menu-top lmd-menu-copy', [
      ['copy-md', ICON.file, 'Markdown'],
      md && ['copy-rich', ICON.rich, 'Texto con formato'],
      md && ['copy-html', ICON.code, 'HTML'],
      hasLink() && ['copy-link', ICON.link, 'Enlace a la nota'],
      fileHere() && ['copy-flink', ICON.link, 'Copiar enlace a este archivo'],
      diskPath() && ['copy-path', ICON.folder, 'Copiar la ruta'],
    ], keys);
  }
  function openExport(btn, keys) {
    const md = docKind() === 'md';
    barMenu(btn, 'lmd-menu-narrow lmd-menu-top lmd-menu-export', [
      ['export-pdf', ICON.doc, 'PDF'],
      md && ['export-html', ICON.code, 'Archivo HTML'],
      ['export-md', ICON.file, md ? 'Archivo Markdown (.md)' : 'Descargar el archivo'],
      ['print', ICON.print, 'Imprimir', PRINT_KEY],
    ].concat(toolItems('export')), keys);
  }
  // En pantalla chica, lo que en escritorio está a la vista en la barra de arriba, acá en una lista.
  function openMore() {
    const md = docKind() === 'md'; const cloud = !!appRoot && appRoot.kind === 'cloud';
    // Lo que la barra todavía muestra no se repite acá: en una ventana angosta el selector de vista sigue en su lugar.
    const shown = (q) => !!ui.main.querySelector('.lmd-topbar ' + q).offsetParent;
    barMenu(ui.more, 'lmd-menu-more', [
      !ui.sync.hidden && !shown('.lmd-sync') && ['sync', (ui.sync.querySelector('svg') || { outerHTML: ICON.cloud }).outerHTML, cloud ? 'Nube: compartir, historial y más' : LMD.cloud.signedIn() ? 'Subir esta nota a la nube' : 'Entrar a la cuenta'],
      // Con una sesión en vivo, quiénes están y cómo salir o terminarla (en pantalla chica la barra de arriba no los muestra).
      cloud && LMD.live.active() && ['live', ICON.people, 'Colaborar en vivo'],
      editMode && md && !rawMode && !shown('.lmd-insert') && ['insert', ICON.plus, 'Insertar un bloque'],
      !shown('.lmd-view') && (rawMode ? ['view-doc', ICON.doc, 'Ver documento'] : ['view-raw', ICON.code, 'Ver código fuente']),
      // Copiar y exportar abren acá mismo el menú que en escritorio cuelga de su botón.
      ['copy', ICON.copy, 'Copiar'],
      ['export', ICON.download, 'Exportar'],
      // En el teléfono, mandar la nota a otra app (install.js): como texto, como archivo, con un enlace o copiando.
      LMD.install.canShareOut() && ['share-out', ICON.share, 'Compartir'],
      diskDoc() && ['reload', ICON.reload, 'Recargar ahora'],
      md && !shown('[data-act=page]') && ['page', ICON.doc, 'Ajustes de la página'],
      !shown('[data-act=theme-flip]') && ['theme-flip', LMD.theme.isDark(settings) ? SUN : MOON, LMD.theme.isDark(settings) ? 'Pasar a claro' : 'Pasar a oscuro'],
      ['settings', ICON.sliders, 'Ajustes'],
      ['shortcuts', ICON.keyboard, 'Atajos de teclado'],
      // En pantalla chica el pie no tiene lugar para el enlace: denunciar una nota ajena va acá, al final.
      LMD.touch.small() && APP && LMD.sync.reportRef() && ['report', ICON.flag, 'Denunciar esta nota'],
    ].concat(toolItems('more')));
  }
  // Una nota del disco puede cambiar por fuera; las del navegador y las de la nube no se recargan a mano.
  const diskDoc = () => !APP || !appRoot || appRoot.kind === 'dir' || appRoot.kind === 'file';
  function downloadDoc() {
    flushTyping();
    if (LMD.kit.saveFile(new Blob([raw], { type: 'text/markdown' }), DOC_NAME || 'nota.md') === 'download') flash(T('Archivo descargado'));
  }

  // La hoja de atajos de teclado (shortcuts.js) se pide recién al abrirla.
  const openKeys = (from) => ensure('shortcuts').then((ok) => { if (ok) LMD.shortcuts.open(core, from); });
  function onAction(act, source, keys) {
    if (act === 'shortcuts') openKeys(source);
    else if (act === 'sidebar') { if (LMD.touch.small()) setDrawer(!drawerOpen()); else LMD.patch({ sidebarHidden: !settings.sidebarHidden }); }
    else if (act === 'more') openMore();
    else if (act === 'page') { if (LMD.page) LMD.page.open(); }
    else if (act === 'copy') openCopy(source, keys);
    else if (act === 'export') openExport(source, keys);
    else if (act === 'copy-html') { copyText(LMD.extras.htmlOf(), source); flash(T('HTML copiado')); }
    else if (act === 'copy-link') { copyText(location.href.split('#')[0], source); flash(T('Enlace copiado')); }
    else if (act === 'copy-flink') { copyText(LMD.fileLink(fileHere()), source); flash(T('Enlace copiado')); }
    else if (act === 'copy-path') { copyText(diskPath(), source); flash(T('Ruta copiada')); }
    else if (act === 'export-pdf') window.print();
    else if (act === 'export-md') downloadDoc();
    else if (act === 'share-out') { flushTyping(); LMD.install.shareOut({ text: raw, name: DOC_NAME || 'nota.md', cloud: !!appRoot && appRoot.kind === 'cloud' }); }
    else if (act === 'mode-read') { if (editMode) setEditMode(false); }
    else if (act === 'mode-edit') { if (!editMode) setEditMode(true); }
    else if (act === 'save') save(true);
    else if (act === 'sync') LMD.sync.click(source);
    else if (act === 'live') LMD.live.open();
    else if (act === 'insert') { const box = source.getBoundingClientRect(); LMD.write.menuAt(box.left - 120, box.bottom + 8); }
    else if (act === 'view-doc') { rawMode = false; applyRawMode(); }
    else if (act === 'view-raw') { rawMode = true; applyRawMode(); }
    else if (act === 'settings') openPanel();
    else if (act === 'theme-flip') flipTheme();
    // Con los títulos numerados, lo copiado lleva los números que se ven (page.js); el archivo no cambia.
    else if (act === 'copy-md') { if (needsRender && !typingNode() && !core.hold) render(); copyText(LMD.page && LMD.page.md && !needsRender && docKind() === 'md' ? LMD.page.md() : raw, source); }
    else if (act === 'copy-rich') copyRich(source);
    else if (act === 'tree-refresh') { goneDoc = ''; core.reloadTree().then(() => { checkGone(); flash(T('Lista de archivos actualizada')); }); }
    else if (act === 'reload') { if (orphan || !alive()) location.reload(); else checkForChanges(true); }
    else if (act === 'print') window.print();
    else if (act === 'export-html') LMD.extras.exportHtml();
    else if (core.actions[act]) core.actions[act](source, keys);
    else if (act === 'close-panel') closePanel();
    else if (act === 'reset') { panelStale = true; LMD.save(LMD.merge({ supporter: settings.supporter })); }
    else if (act === 'check-update') checkUpdate(true);
    else if (act === 'update-apply') {
      // Primero se guarda lo pendiente; el fondo se ocupa de reabrir o recargar las pestañas.
      (dirty ? save(true) : Promise.resolve(true)).then((ok) => { if (ok || !dirty) bg({ type: 'reloadExtension' }); });
    }
    else if (act === 'update-later') { ui.update.hidden = true; if (ui.update.dataset.v) bg({ type: 'dismissUpdate', version: ui.update.dataset.v }); }
    else if (act === 'go-home') { if (APP) go(''); else bg({ type: 'openApp' }); }
    else if (act === 'see-plans') openPanel('plan');
    else if (act === 'css-clear') { panelStale = true; LMD.patch({ customCSS: '' }); }
    else if (act === 'feedback') LMD.sync.feedback();
    else if (act === 'report') LMD.sync.report();
  }

  // Aviso de versión nueva. El service worker decide si toca consultar GitHub según el ajuste.
  const ZIP_URL = 'https://github.com/SharpMD/sharpmd/archive/refs/heads/main.zip';
  async function checkUpdate(force) {
    const say = (html, kind) => {
      const box = ui.panel.hidden ? null : ui.panel.querySelector('.lmd-update-msg');
      if (!box) { flash(html.replace(/<[^>]+>/g, ''), kind); return; }
      box.hidden = false; box.className = 'lmd-update-msg' + (kind ? ' lmd-' + kind : ''); box.innerHTML = html;
    };
    if (force) say(esc(T('Buscando…')));
    // En la web y en la versión de la tienda no hay nada que avisar: se actualizan solas.
    if (window.__MDT_WEB || chrome.runtime.getManifest().update_url) { ui.update.hidden = true; return; }
    const r = await bg({ type: 'checkUpdate', force: !!force });
    if (!r || !r.ok || r.store) { ui.update.hidden = true; return; }
    const show = r.newer && (force || !r.dismissed);
    ui.update.hidden = !show;
    if (show) {
      ui.update.dataset.v = r.latest;
      // Un renglón: qué hay, y las dos cosas que se pueden hacer. El cómo queda al pasar el mouse.
      const how = T('Tenés la {v}.', { v: r.current }) + ' ' + T('Descargá el ZIP, reemplazá con su contenido la carpeta de la extensión y tocá Aplicar. Si la clonaste con git, alcanza con git pull y Aplicar.');
      ui.update.title = how;
      ui.update.innerHTML =
        '<span class="lmd-update-text">' + T('Versión nueva: {v}', { v: esc(r.latest) }) + '</span>' +
        '<a class="lmd-link" href="' + ZIP_URL + '" target="_blank" rel="noopener noreferrer">' + T('Descargar') + '</a>' +
        '<button type="button" class="lmd-link" data-act="update-apply">' + T('Aplicar') + '</button>' +
        '<button type="button" class="lmd-update-x" data-act="update-later" title="' + T('Ahora no') + '" aria-label="' + T('Ahora no') + '">' + ICON.close + '</button>';
    }
    if (force) {
      if (r.error) say(esc(T('No se pudo consultar GitHub')), 'error');
      else if (r.newer) say('<strong>' + T('Hay una versión nueva: {v}', { v: esc(r.latest) }) + '</strong> <a href="' + ZIP_URL + '" target="_blank" rel="noopener noreferrer">' + T('Descargar') + '</a> · <button type="button" class="lmd-link" data-act="update-apply">' + T('Aplicar') + '</button>', 'new');
      else say('✓ ' + esc(T('Ya tenés la última versión ({v})', { v: r.current })), 'ok');
    }
  }

  function applyRawMode() {
    const editingSource = rawMode && editMode;
    if (!rawMode && needsRender) render();
    ui.article.hidden = rawMode;
    ui.rawPre.hidden = !rawMode || editingSource;
    ui.rawEdit.hidden = !editingSource;
    if (rawMode) { ui.rawPre.textContent = raw; ui.rawEdit.value = raw; }
    ui.main.querySelectorAll('.lmd-view [data-act^="view-"]').forEach((b) => {
      const on = (b.dataset.act === 'view-raw') === rawMode;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on));
    });
    if (ui.searchInput.value) runSearch(ui.searchInput.value, false, true);
    updateCount();
  }

  // El tema solo: los colores, el modo y la barra del sistema. Con una vista previa abierta en Ajustes, ese tema.
  function paintTheme() {
    const painted = LMD.theme.apply(document.documentElement, settings, themePreview);
    document.querySelectorAll('meta[name=theme-color]').forEach((bar) => { bar.removeAttribute('media'); bar.content = painted.bg; });
    const status = document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]'); if (status) status.content = painted.dark ? 'black-translucent' : 'default';
    // El botón de la barra muestra a dónde lleva: la luna con un tema claro puesto, el sol con uno oscuro.
    const flip = ui.main && ui.main.querySelector('[data-act=theme-flip]');
    if (flip && flip.dataset.dark !== String(painted.dark)) { flip.dataset.dark = String(painted.dark); flip.innerHTML = painted.dark ? SUN : MOON; flip.title = T(painted.dark ? 'Pasar a claro' : 'Pasar a oscuro') + (window.__MDT_WEB ? ' (' + LMD.keys('Alt+Shift+T') + ')' : ''); flip.setAttribute('aria-label', T(painted.dark ? 'Pasar a claro' : 'Pasar a oscuro')); }
  }
  const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12h2.500M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z"/></svg>';
  // Pasa a claro u oscuro, lo contrario de lo que se ve, y lo deja elegido a mano: ya no sigue al dispositivo.
  function flipTheme() {
    const p = LMD.theme.flipPatch(settings);
    // El aviso sale cuando el cambio ya se aplicó: aplicar los ajustes limpia el pie.
    flipSaid = T(p.theme === 'dark' ? 'Tema oscuro' : 'Tema claro');
    LMD.patch(p);
  }
  let flipSaid = '';
  // El navegador oscurece por su cuenta las páginas claras y la app pasó a su tema oscuro (theme.js): se avisa una
  // sola vez, con la forma de volver al claro.
  function forcedSay() {
    if (!LMD.theme.forcedNotice()) return;
    const { el } = LMD.kit;
    const t = el('div', { class: 'lmd-cl-toast lmd-forced-toast', role: 'status' });
    t.appendChild(el('span', { text: T('Tu navegador oscurece las páginas claras. SharpMD pasó a su tema oscuro para que los colores se vean bien.') }));
    const keep = el('button', { type: 'button', class: 'lmd-link', text: T('Seguir en claro') });
    keep.addEventListener('click', () => { LMD.theme.keepLight(); location.reload(); });
    const ok = el('button', { type: 'button', class: 'lmd-link', text: T('Entendido') });
    ok.addEventListener('click', () => t.remove());
    t.appendChild(keep); t.appendChild(ok);
    document.body.appendChild(t);
  }

  function applySettings() {
    const root = document.documentElement;
    paintTheme();
    root.classList.toggle('lmd-centered', !!settings.centered);
    root.classList.toggle('lmd-wrap', !!settings.wrapCode);
    root.classList.toggle('lmd-focus', !!settings.focusMode);
    root.classList.toggle('lmd-typewriter', !!settings.typewriter);
    root.classList.toggle('lmd-side-hidden', !!settings.sidebarHidden);
    root.style.setProperty('--lmd-content-w', settings.contentWidth + 'px');
    root.style.setProperty('--lmd-font-size', settings.fontSize + 'px');
    root.style.setProperty('--lmd-line-height', String(settings.lineHeight));
    root.style.setProperty('--lmd-side-w', settings.sidebarWidth + 'px');
    if (settings.fontFamily && settings.fontFamily.trim()) root.style.setProperty('--lmd-font', settings.fontFamily);
    else root.style.removeProperty('--lmd-font');
    root.classList.toggle('lmd-dgm-round', settings.diagramShape !== 'square');
    if (/^#[0-9a-f]{6}$/i.test(settings.codeColor || '')) root.style.setProperty('--code-tint', settings.codeColor); else root.style.removeProperty('--code-tint');
    // Editar el CSS propio es del plan pago. El que ya estaba guardado se sigue aplicando, con o sin plan.
    ui.customStyle.textContent = settings.customCSS || '';

    ui.searchInput.placeholder = T('Buscar en la nota y en los archivos');
    applySide();

    ui.status.textContent = idleStatus();
    if (flipSaid) { const said = flipSaid; flipSaid = ''; flash(said); }
    setupRefresh();
    markThemes();
  }

  // ---------- Render ----------
  // La página propia también abre lo que no es Markdown: código resaltado, CSV como tabla e imágenes.
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
  // Un .txt es texto plano: se muestra y se guarda tal cual. En el explorador va junto a los Markdown.
  const TXT_RE = /\.txt$/i; const JY_RE = /\.(json|ya?ml)$/i;
  // El tipo que ofrece la ventana de guardar: el del archivo, para que un .txt no termine como .md.
  const pickTypes = (name) => {
    const ext = (/\.([A-Za-z0-9]+)$/.exec(name || '') || [0, ''])[1].toLowerCase();
    if (ext === 'txt') return [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }];
    if (ext === 'json') return [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];
    if (ext === 'yaml' || ext === 'yml') return [{ description: 'YAML', accept: { 'application/yaml': ['.yaml', '.yml'] } }];
    return [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }];
  };
  const LANGS = { yml: 'yaml', mjs: 'javascript', cjs: 'javascript', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', ps1: 'powershell', htm: 'html', kt: 'kotlin', cs: 'csharp', h: 'c' };
  function docKind() {
    if (TXT_RE.test(DOC_NAME)) return 'text';
    if (MD_RE.test(DOC_NAME) || DOC_NAME.indexOf('.') === -1) return 'md';
    if (IMG_RE.test(DOC_NAME)) return 'image';
    return /\.(csv|tsv)$/i.test(DOC_NAME) ? 'table' : 'code';
  }
  function csvRows(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = /\.tsv$/i.test(DOC_NAME) || first.split('\t').length > first.split(',').length ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function asMarkdown(kind) {
    if (kind === 'image') return '![' + DOC_NAME + '](' + encodeURIComponent(DOC_NAME) + ')';
    if (raw.indexOf('\u0000') !== -1) return '> ' + T('Este tipo de archivo no se puede mostrar.');
    if (kind === 'table') {
      const MAX = 1000;
      const rows = csvRows(raw); if (!rows.length) return '';
      const width = Math.max.apply(null, rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: width }, (_, i) => String(r[i] == null ? '' : r[i]).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()).join(' | ') + ' |';
      return [line(rows[0]), '|' + ' --- |'.repeat(width)].concat(rows.slice(1, MAX + 1).map(line)).join('\n') +
        (rows.length > MAX + 1 ? '\n\n' + T('Se muestran las primeras {n} filas.', { n: MAX }) : '');
    }
    const ext = (/\.([A-Za-z0-9]+)$/.exec(DOC_NAME) || [0, ''])[1].toLowerCase();
    const fence = '`'.repeat(Math.max(3, ((raw.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0)) + 1));
    return fence + (LANGS[ext] || ext) + '\n' + raw.replace(/\s+$/, '') + '\n' + fence;
  }

  function render() {
    if (noDoc) { ui.article.textContent = ''; spyHeadings = []; ui.paneOutline.textContent = ''; ui.progress = null; needsRender = false; if (ui.searchInput.value) runSearch(ui.searchInput.value, false, true); return; }
    const md = buildParser();
    const kind = docKind();
    const fm = kind === 'text' ? { body: '', rows: null } : kind !== 'md' ? { body: asMarkdown(kind), rows: null } : (settings.plugins.frontmatter ? splitFrontmatter(raw) : { body: raw, rows: null });
    syncSource();
    fmOffset = kind !== 'md' ? 0 : raw.slice(0, raw.length - fm.body.length).split('\n').length - 1;
    needsRender = false;
    let html = kind === 'text' ? '' : md.render(fm.body);
    wantEmoji(fm.body);
    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    const y = window.scrollY;
    ui.article.innerHTML = html;
    // Un .txt es texto plano: se muestra tal cual, sin interpretar Markdown ni HTML.
    if (kind === 'text') ui.article.appendChild(el('div', { class: 'lmd-plain', text: raw.replace(/\r\n?/g, '\n') }));
    spyHeadings = postProcess(ui.article);
    if (editMode && kind === 'md') enableEditing(ui.article);
    // Los ajustes de la página (page.js) viven en el encabezado, pero no son datos de la nota: no se listan.
    const fmRows = fm.rows ? fm.rows.filter((r) => !LMD.page || !LMD.page.owns(r[0], r[1])) : [];
    if (fmRows.length) ui.article.insertBefore(frontmatterNode(fmRows), ui.article.firstChild);
    buildOutline(spyHeadings);
    if (rawMode) { ui.rawPre.textContent = raw; if (document.activeElement !== ui.rawEdit) ui.rawEdit.value = raw; }
    window.scrollTo(0, y);
    onScroll();
    updateCount();
    if (ui.searchInput.value) runSearch(ui.searchInput.value, false, true);
    core.hooks.render.forEach((fn) => fn());
  }

  // Índice: el título del documento va arriba como cabecera, con datos de lectura y avance;
  // debajo, las secciones como árbol plegable con guías por nivel.
  const collapsed = new Set();

  function buildOutline(headings) {
    // Los títulos numerados de la nota (page.js): el índice muestra el mismo número que el documento.
    if (LMD.page && LMD.page.number) LMD.page.number(headings);
    const numOf = (h) => { const n = h.querySelector(':scope > .lmd-hnum'); return n ? el('span', { class: 'lmd-hnum', text: n.textContent }) : null; };
    ui.paneOutline.textContent = '';
    if (!headings.length) {
      ui.paneOutline.appendChild(el('p', { class: 'lmd-empty', text: T('Este documento no tiene títulos.') }));
      return;
    }
    let items = headings.slice();
    const h1s = items.filter((h) => h.tagName === 'H1');
    const titleH = h1s.length === 1 && items[0] === h1s[0] ? items.shift() : null;

    const words = (ui.article.innerText.trim().match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / 200));
    const head = el('div', { class: 'lmd-o-head' });
    const title = el('a', { class: 'lmd-o-title', href: '#' + (titleH ? titleH.id : ''), text: titleH ? headingText(titleH) : document.title });
    if (titleH) title.dataset.id = titleH.id;
    const meta = el('div', { class: 'lmd-o-meta', text: T(items.length === 1 ? '{w} palabras · {m} min · {n} sección' : '{w} palabras · {m} min · {n} secciones', { w: fmt(words), m: minutes, n: items.length }) });
    const bar = el('div', { class: 'lmd-o-bar', title: T('Avance de lectura') }, '<span></span>');
    ui.progress = bar.firstChild;
    ui.progressLabel = el('span', { class: 'lmd-o-pct', text: '0 %' });
    const row = el('div', { class: 'lmd-o-progress' });
    row.append(bar, ui.progressLabel);
    head.append(title, meta, row);
    ui.paneOutline.appendChild(head);

    if (!items.length) return;
    const min = Math.min.apply(null, items.map((h) => +h.tagName[1]));
    const tree = el('div', { class: 'lmd-o-tree' });
    const stack = [{ level: 0, kids: tree }];
    items.forEach((h, i) => {
      const level = +h.tagName[1] - min + 1;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const next = items[i + 1];
      const hasKids = !!next && (+next.tagName[1] - min + 1) > level;
      const item = el('div', { class: 'lmd-o-item' });
      const line = el('div', { class: 'lmd-o-row lmd-o-l' + Math.min(stack.length, 4) });
      line.dataset.id = h.id;
      if (hasKids) {
        const tog = el('button', { class: 'lmd-o-tog', type: 'button', 'aria-label': T('Plegar o desplegar') }, ICON.chevron);
        tog.addEventListener('click', (e) => {
          e.stopPropagation();
          const shut = item.classList.toggle('lmd-o-shut');
          if (shut) collapsed.add(h.id); else collapsed.delete(h.id);
          // Con el plegado por títulos prendido, el documento pliega la misma sección.
          if (LMD.fold) LMD.fold.outline(h, shut);
        });
        line.appendChild(tog);
      } else line.appendChild(el('span', { class: 'lmd-o-dot' }));
      const link = el('a', { href: '#' + h.id, class: 'lmd-o-link', text: headingText(h), title: headingText(h) });
      const num = numOf(h); if (num) link.insertBefore(num, link.firstChild);
      line.appendChild(link);
      item.appendChild(line);
      const kids = el('div', { class: 'lmd-o-kids' });
      if (hasKids) item.appendChild(kids);
      if (collapsed.has(h.id)) item.classList.add('lmd-o-shut');
      stack[stack.length - 1].kids.appendChild(item);
      stack.push({ level, kids });
    });
    ui.paneOutline.appendChild(tree);
  }

  function onScroll() {
    ui.toTop.hidden = window.scrollY < 500;
    if (ui.progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.round(window.scrollY / max * 100)) : 100;
      ui.progress.style.width = pct + '%';
      ui.progressLabel.textContent = pct + ' %';
    }
    if (!spyHeadings.length) return;
    // La sección activa es la última cuyo título ya pasó la línea de lectura. Esa línea está arriba
    // mientras se lee y baja hacia el final del documento: las últimas secciones nunca llegan al
    // tope de la pantalla, y sin eso quedaría marcada una anterior.
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const avance = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 1;
    const linea = Math.max(96, window.innerHeight * (0.28 + 0.72 * Math.pow(avance, 6)));
    let current = spyHeadings[0];
    for (const h of spyHeadings) {
      if (h.getBoundingClientRect().top <= linea) current = h; else break;
    }
    // Si se eligió un título del índice y está a la vista, ese es el activo: cerca del final la página no
    // llega a subirlo hasta la línea de lectura y quedaba marcado el último.
    if (spyPin) { const p = spyHeadings.find((h) => h.id === spyPin); const t = p ? p.getBoundingClientRect().top : -1; if (p && t >= -8 && t < window.innerHeight) current = p; }
    const rows = ui.paneOutline.querySelectorAll('.lmd-o-row');
    let activeRow = null;
    rows.forEach((r) => {
      const on = r.dataset.id === current.id;
      if (on) activeRow = r;
      if (on && !r.classList.contains('lmd-active') && !ui.paneOutline.hidden && r.offsetParent) r.scrollIntoView({ block: 'nearest' });
      r.classList.toggle('lmd-active', on);
      r.classList.remove('lmd-o-path');
    });
    // Las secciones que contienen a la actual quedan marcadas, también si están plegadas.
    let up = activeRow && activeRow.parentNode.parentNode.closest('.lmd-o-item');
    while (up) { up.firstChild.classList.add('lmd-o-path'); up = up.parentNode.closest('.lmd-o-item'); }
  }

  // ---------- Recarga automática ----------
  function setupRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = null;
    if (!settings.autoRefresh) return;
    refreshTimer = setInterval(() => { if (!document.hidden) checkForChanges(false); }, Math.max(300, settings.refreshInterval | 0));
  }

  let diskStamp = ''; let cloudPoll = 0; let cloudState = 'ok'; let readOnly = false; let present = []; const presentNames = {};
  let hereAi = []; let lastEdit = null; // las IA que están en la nota abierta, y su último guardado: { at, by }
  let polled = true; // false cuando la nube no se consultó de verdad porque todavía no tocaba
  // La revisión de la nube que corresponde a diskText: sobre esa se guarda. Cambia solo junto con diskText, cuando
  // lo leído ya entró al documento; así un guardado nunca pasa por encima de un cambio que todavía no se juntó.
  let diskRev = null; let readRev = null; let readBy = null; let readFresh = false;
  const isCloud = () => !!appRoot && appRoot.kind === 'cloud';

  async function readCurrent() {
    // La nube se consulta cada diez segundos: alcanza para ver lo que escribió una IA sin martillar el servidor.
    polled = true; readRev = null; readBy = null; readFresh = false; const seq = docSeq;
    if (APP && appRoot && appRoot.kind === 'cloud') { if (Date.now() - cloudPoll < (cloudState === 'error' ? 5000 : 10000)) { polled = false; return diskText; } cloudPoll = Date.now(); }
    if (APP) {
      // Con el permiso de la carpeta alcanza con mirar fecha y tamaño: el archivo se lee solo si cambió.
      try {
        const file = await (await vFile(HERE)).getFile();
        const stamp = file.lastModified + ':' + file.size;
        if (stamp === diskStamp) return diskText;
        const text = await file.text();
        if (seq === docSeq) { diskStamp = stamp; readFresh = true; if (file.rev != null) readRev = file.rev; readBy = file.edited || null; }
        return text;
      } catch (e) { return null; }
    }
    const url = docUrl();
    const r = await bg({ type: 'fetchText', url });
    if (r && r.ok) return r.text;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.text();
    } catch (e) { /* sin acceso */ }
    return null;
  }

  let checking = false;
  async function checkForChanges(manual) {
    if (checking || noDoc || saving) return;
    // Una nota que todavía no tiene archivo (vive en la sesión) no tiene nada afuera que releer. Su "archivo" es
    // lo que hay en memoria: compararlo con lo guardado (nada, en una nota nueva) daba un cambio en el disco falso.
    if (appRoot && (appRoot.id === 'mem' || appRoot.kind === 'fs')) { if (manual) flash(T('Sin cambios')); return; }
    checking = true;
    const seq = docSeq;
    try {
      const text = await readCurrent();
      if (seq !== docSeq || saving) return; // mientras se leía, se pasó a otra nota o salió un guardado propio
      // En una nota de la nube, no poder leer es estar sin conexión; volver a leer es haberla recuperado.
      if (appRoot && appRoot.kind === 'cloud') { const was = cloudState; if (text == null) cloudState = 'error'; else if (polled && cloudState === 'error' && !dirty) cloudState = 'ok'; if (was !== cloudState) updateSaveState(); }
      if (text == null) {
        if (manual) flash(T('No se pudo releer el archivo. Recargá la pestaña con F5'), 'error');
      } else if (text !== diskText) {
        // Una lectura que llega tarde, cuando ya entró algo más nuevo, no vuelve el documento atrás.
        if (isCloud() && readRev != null && diskRev != null && readRev <= diskRev) return;
        // En una sesión en vivo entra enseguida, alrededor del bloque que se esté escribiendo.
        if (liveOn() && readRev != null && cloudState !== 'error') { applyRemote(text, readRev, ''); return; }
        // Con cambios hechos sin conexión, de juntarlos con los del servidor se ocupa save() al subirlos.
        if (appRoot && appRoot.kind === 'cloud' && dirty && cloudState === 'error') { clearTimeout(autosaveTimer); save(false); return; }
        // Con el cursor en un bloque no se toca nada: ni el texto ni el dibujo. Lo de afuera queda esperando
        // (y el guardado automático también, para no pisarlo) hasta que la persona sale del bloque.
        if (typingNode()) { outside = true; diskStamp = ''; return; }
        await takeOutside(text, readRev, whoIs(readBy));
      } else {
        if (polled) { outside = false; if (readRev != null) diskRev = readRev; }
        // Lo de afuera volvió a ser la base: el choque que esperaba una decisión ya no existe.
        if (held && readFresh) { held = null; markDirty(); }
        if (manual) flash(T('Sin cambios'));
      }
    } finally { checking = false; }
  }

  // Lo que cambió afuera (el archivo del disco, la nota de la nube) entra al documento. Sin cambios propios se toma
  // tal cual: la página, lo plegado y la selección quedan donde estaban. Con cambios
  // propios sin guardar se unen las dos ediciones (joinOutside). Quien llama ya comprobó que no hay un bloque con
  // el cursor. who: el nombre de quien cambió afuera, si se sabe. Devuelve false si quedó un choque sin decidir.
  async function takeOutside(text, rev, who) {
    outside = false;
    if (dirty) return joinOutside(text, rev, who);
    held = null;
    diskText = text; if (rev != null) diskRev = rev;
    if (raw !== text) drawDoc(text);
    dirty = false; updateSaveState();
    flash(who ? T('Documento actualizado por {a}', { a: who }) : T('Documento actualizado'));
    return true;
  }

  // ---------- Unir en vez de pisar (merge.js) ----------
  // diskText es la base: el texto tal como se cargó o se guardó por última vez. Cuando lo de afuera cambió y acá hay
  // cambios sin guardar, se unen las tres versiones por líneas. Lo que no choca entra solo, con un aviso y un paso
  // de deshacer que vuelve a lo de acá. Lo que choca lo decide la persona: mientras no decida queda en held y no se
  // guarda nada encima, ni a mano ni solo. En una sesión en vivo no pasa por acá: ahí une applyRemote.
  let held = null; // un choque sin decidir: { text, rev, who, later }
  // Lo que quien lee tenía seleccionado sobrevive a un redibujo entero: se anota en qué bloque está (por su texto y
  // su orden entre los que dicen lo mismo) y a qué altura, y se repone si ese bloque sigue estando.
  function keepSelection(draw) {
    const sel = getSelection(); let mark = null;
    const blocks = (text) => Array.from(ui.article.querySelectorAll('[data-l]')).filter((x) => x.textContent === text);
    if (sel.rangeCount && !sel.isCollapsed && !typingNode() && ui.article.contains(sel.anchorNode) && ui.article.contains(sel.focusNode)) {
      const at = (node, off) => {
        const host = (node.nodeType === 1 ? node : node.parentElement).closest('[data-l]'); if (!host || !ui.article.contains(host)) return null;
        const r = document.createRange(); r.selectNodeContents(host); r.setEnd(node, off);
        return { text: host.textContent, n: blocks(host.textContent).indexOf(host), off: r.toString().length };
      };
      const a = at(sel.anchorNode, sel.anchorOffset); const f = at(sel.focusNode, sel.focusOffset);
      if (a && f) mark = { a, f };
    }
    draw();
    if (!mark || (sel.rangeCount && !sel.isCollapsed)) return; // no había nada, o el dibujo no la tocó
    const point = (m) => {
      const host = blocks(m.text)[m.n]; if (!host) return null;
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let left = m.off; let last = null;
      for (let t = walk.nextNode(); t; t = walk.nextNode()) { last = t; if (left <= t.nodeValue.length) return [t, left]; left -= t.nodeValue.length; }
      return last ? [last, last.nodeValue.length] : [host, 0];
    };
    const a = point(mark.a); const f = point(mark.f);
    if (a && f) { try { sel.setBaseAndExtent(a[0], a[1], f[0], f[1]); } catch (e) { /* ese lugar ya no existe */ } }
  }
  let asking = false;
  // Pone next como texto del documento. Con el cursor en un bloque, o en la vista de código, lo hace patchDoc, que
  // no saca a nadie de donde está. Si no, se redibuja entero, para que corra todo lo que cuelga del dibujo (las
  // marcas de comentarios, los tableros, las listas): la página no se mueve y la selección se repone.
  function drawDoc(next) {
    if (rawMode || typingNode()) { patchDoc(next, ''); return; }
    rebaseUndo(raw, next); raw = next; syncSource();
    keepSelection(render);
  }
  // Quién guardó, en palabras: el nombre de la persona, o el del token de la IA.
  const whoIs = (by) => (by && typeof by === 'object' ? String(by.name || '') || (by.kind === 'ai' ? T('la IA') : '') : '');
  // Lo unido pasa al documento. theirs queda como base: lo próximo que se guarde va sobre eso.
  function landMerge(next, theirs, rev, note) {
    const mine = raw;
    diskText = theirs; if (rev != null) diskRev = rev; outside = false; held = null;
    if (next !== mine) {
      drawDoc(next);
      // Un paso de deshacer vuelve a lo de acá, tal como estaba antes de unir.
      undoStack.push(mine); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0;
      if (note) LMD.merge3.say(note, () => { if (undoStack[undoStack.length - 1] === mine) undo(); });
    }
    dirty = raw !== diskText;
    if (dirty) markDirty(); else { clearTimeout(autosaveTimer); if (cloudState === 'saving') cloudState = 'ok'; updateSaveState(); }
  }
  // ask: la persona pidió guardar, así que la pregunta vuelve a salir aunque antes la haya dejado para después.
  // Devuelve true si lo de afuera ya quedó unido, false si falta que la persona decida.
  async function joinOutside(text, rev, who, ask) {
    const seq = docSeq;
    const m = LMD.merge3.three(diskText, raw, text);
    if (m.clean) {
      landMerge(m.text, text, rev, who ? T('Se unieron los cambios de {a}', { a: who }) : T('Se unieron cambios hechos afuera'));
      if (m.ticked) flash(T('Una tarea quedó tildada: la casilla cambió de los dos lados'), 'warn');
      return true;
    }
    const later = !!held && held.later && held.text === text;
    held = { text, rev, who, later };
    updateSaveState();
    if (asking || (later && !ask)) return false;
    asking = true;
    let pick = null;
    try { pick = await LMD.merge3.ask(m, { who }); } finally { asking = false; }
    if (seq !== docSeq) return false;
    if (!held) return true; // mientras se preguntaba, lo de afuera volvió atrás o se unió solo
    if (!pick) { held.later = true; updateSaveState(); return false; }
    // Mientras la pregunta estuvo abierta pudo llegar algo más: se une sobre lo último que se supo.
    const h = held; const last = h.text === text ? m : LMD.merge3.three(diskText, raw, h.text);
    landMerge(last.resolve(pick), h.text, h.rev, '');
    flash(T(pick === 'mine' ? 'Quedó lo tuyo' : pick === 'theirs' ? 'Quedó lo de afuera' : 'Quedaron las dos versiones'));
    return true;
  }

  // ---------- Sesión en vivo: lo que escriben los demás entra en el lugar ----------
  // Con una sesión en vivo, un cambio ajeno no espera a que se suelte el bloque: se junta con lo escrito acá (mezcla
  // por líneas) y se dibuja solo donde cambió, ALREDEDOR del bloque que tiene el cursor. Ese nodo no se reemplaza
  // ni pierde el foco (la regla de typingNode). Si el cambio cae en ese mismo bloque y ahí no hay nada tecleado sin
  // pasar al Markdown, se le pone adentro el texto nuevo, con el cursor a la misma altura; si no se puede, el dibujo
  // de ese bloque espera a que se lo suelte, con el Markdown ya al día.
  const liveOn = () => !!LMD.live && LMD.live.active();
  let inbox = null; // lo último que se supo del servidor y todavía no entró al documento: { text, rev, by }
  // Llegó el aviso de un guardado con el cambio adentro: el texto entero, o las líneas que cambiaron sobre base.
  function liveSaved(ev) {
    const top = inbox || { text: diskText, rev: diskRev };
    if (ev.rev == null || (top.rev != null && ev.rev <= top.rev)) return;
    let text = typeof ev.text === 'string' ? ev.text : null;
    const p = ev.patch;
    if (text == null && p && ev.base === top.rev && Array.isArray(p.lines) && p.at >= 0 && p.del >= 0) { const lines = top.text.split('\n'); text = lines.slice(0, p.at).concat(p.lines, lines.slice(p.at + p.del)).join('\n'); }
    // Faltó un aviso en el medio: se relee la nota.
    if (text == null) { cloudPoll = 0; checkForChanges(false); return; }
    inbox = { text, rev: ev.rev, by: ev.pid || '' };
    drainInbox();
  }
  // Mientras sale un guardado propio, lo que llega espera: se aplica sobre lo que ese guardado deje como base.
  function drainInbox() {
    if (!inbox || saving) return;
    const x = inbox; inbox = null;
    applyRemote(x.text, x.rev, x.by);
  }
  // El servidor tiene text en la revisión rev. Se junta con lo de acá y se dibuja lo que cambió. Lo que los dos
  // tocaron a la vez queda como en el servidor, y lo de acá vuelve en un aviso para copiarlo: no se pierde en silencio.
  function applyRemote(text, rev, by) {
    if (noDoc || (rev != null && diskRev != null && rev <= diskRev)) return;
    // Lo tecleado hasta ahora pasa al Markdown sin tocar el bloque: así entra en la mezcla como lo de acá.
    flushTyping();
    if (ui.rawEdit && !ui.rawEdit.hidden && document.activeElement === ui.rawEdit) { const typed = ui.rawEdit.value.replace(/\r?\n/g, eol); if (typed !== raw) { raw = typed; syncSource(); } }
    const m = raw === diskText ? { text, lost: [] } : LMD.cloud.merge(diskText, raw, text);
    diskText = text; if (rev != null) diskRev = rev; outside = false;
    if (m.text !== raw) patchDoc(m.text, by);
    dirty = raw !== diskText;
    if (dirty) markDirty(); else { clearTimeout(autosaveTimer); if (cloudState === 'saving') cloudState = 'ok'; updateSaveState(); }
    if (m.lost.length && LMD.live) LMD.live.lost(m.lost, by);
  }
  // Lo que se podía deshacer se corre junto con el documento: deshacer vuelve atrás lo de acá, no lo de los demás.
  function rebaseUndo(from, to) {
    for (const stack of [undoStack, redoStack]) {
      const keep = to.length > 300000 ? [] : stack.slice(-30);
      stack.length = 0;
      for (const snap of keep) { const r = LMD.cloud.merge(from, snap, to); if (r.lost.length) stack.length = 0; else stack.push(r.text); }
    }
  }
  let composing = false; // hay un texto a medio componer (acentos, teclado en pantalla): ese nodo no se toca
  const keepCaret = (ta, value) => {
    const old = ta.value; const a = ta.selectionStart; const b = ta.selectionEnd; const max = Math.min(old.length, value.length);
    let p = 0; while (p < max && old.charCodeAt(p) === value.charCodeAt(p)) p++;
    const d = value.length - old.length; const move = (x) => (x <= p ? x : Math.max(p, x + d)); const top = ta.scrollTop;
    ta.value = value; ta.setSelectionRange(move(a), move(b)); ta.scrollTop = top;
  };
  // Cambia el Markdown por next y pone el dibujo al día sin sacar a nadie de donde está.
  function patchDoc(next, by) {
    const oldLines = srcLines; const oldFm = fmOffset;
    rebaseUndo(raw, next);
    raw = next; syncSource();
    if (docKind() === 'md' && settings.plugins.frontmatter) fmOffset = raw.slice(0, raw.length - splitFrontmatter(raw).body.length).split('\n').length - 1;
    if (rawMode) {
      // En la vista de código el documento no está a la vista: se redibuja al volver a él.
      ui.rawPre.textContent = raw; needsRender = true;
      if (document.activeElement !== ui.rawEdit) ui.rawEdit.value = raw; else keepCaret(ui.rawEdit, raw);
      return;
    }
    const focus = typingNode(); let done = false;
    // Qué cambió, tramo por tramo (de la línea s a la e de lo que había pasan a ser lines). Pueden ser varios y
    // separados: lo de dos personas que llegó junto, o lo que cambió mientras no había conexión.
    const H = LMD.cloud.hunks(oldLines, srcLines);
    const grow = (h) => h.lines.length - (h.e - h.s);
    // Cuánto se corre una línea que queda después de los tramos que terminan antes de ella, y cuánto el final de
    // un bloque (ahí no cuenta lo agregado justo después de su última línea, que no es suyo).
    const d = { H, was: new Map(),
      start: (line) => { let n = 0; for (const h of H) if (h.e <= line) n += grow(h); return n; },
      end: (line) => { let n = 0; for (const h of H) if (h.e <= line && h.s < line) n += grow(h); return n; },
      // Algún tramo toca las líneas de s a e.
      hit: (s, e) => H.some((h) => (h.s < e && h.e > s) || (h.s === h.e && h.s > s && h.s < e)) };
    if (docKind() === 'md' && fmOffset === oldFm && H.length && H[0].s >= oldFm) {
      // Las líneas que ocupaba cada bloque antes del cambio, y después los números corridos.
      const moved = H.some((h) => grow(h));
      ui.article.querySelectorAll('[data-l], [data-p]').forEach((n) => {
        if (n.hasAttribute('data-l')) d.was.set(n, rangeOf(n));
        if (moved) ['data-l', 'data-p'].forEach((a) => {
          const r = rangeOf(n, a); if (!r) return;
          const s = r[0] + d.start(r[0] + oldFm); const e = Math.max(s, r[1] + d.end(r[1] + oldFm));
          if (s !== r[0] || e !== r[1]) n.setAttribute(a, s + '-' + e);
        });
      });
      ui.article.querySelectorAll('.lmd-draft').forEach((n) => { if (n._syn) d.was.set(n, [n._syn.at - oldFm, n._syn.at - oldFm + n._syn.n]); });
      // Lo que guarda líneas por su cuenta: los bloques nuevos a medio escribir y el cuadro de un bloque de código.
      if (moved) { LMD.write.shift(d.start); ui.article.querySelectorAll('.lmd-src').forEach((ta) => { const g = ta._range; if (g) { g.from += d.start(g.from); g.to += d.end(g.to); } }); }
      try { done = patchArticle(oldLines, d, focus, LMD.live ? LMD.live.colorOf(by) : '', by); } catch (e) { done = false; console.error(e); }
      LMD.write.reanchor();
    } else if (!H.length) done = true;
    // No se pudo dibujar solo lo que cambió. Sin un bloque con el cursor se redibuja entero (la página no se mueve);
    // con uno, el dibujo espera a que se lo suelte: los números de línea ya quedaron corridos.
    if (!done) { if (focus) needsRender = true; else render(); }
    core.hooks.patch.forEach((fn) => fn());
  }

  const HEADS = 'h1,h2,h3,h4,h5,h6';
  const ownRange = (n) => (n.hasAttribute('data-l') ? n : n.querySelector('[data-l]'));
  // Dibuja en el lugar la diferencia entre lo que hay en pantalla y el Markdown de ahora. Devuelve false si no pudo
  // (o pudo solo en parte): quien llama redibuja entero cuando se puede.
  function patchArticle(oldLines, d, focus, color, by) {
    const fm = fmOffset; const art = ui.article;
    const touched = []; for (const h of d.H) { for (let k = h.s; k < h.e; k++) touched.push(oldLines[k]); for (const l of h.lines) touched.push(l); }
    // Lo que cambia el dibujo de otros bloques no se aplica de a un bloque: definiciones de enlaces, notas al pie,
    // y los títulos cuando hay un índice en el texto.
    if (touched.some((l) => /^\s{0,3}\[[^\]]+\]:/.test(l) || /\[\^[^\]]+\]/.test(l))) return false;
    if (art.querySelector('.lmd-toc') && touched.some((l) => /^\s{0,3}(#{1,6}(\s|$)|=+\s*$|-+\s*$)/.test(l))) return false;
    // Los bloques de un contenedor con las líneas que ocupan: para lo que ya estaba en pantalla, las de antes del
    // cambio. null si adentro hay texto suelto, que no se sabe comparar.
    const kidsOf = (box, old) => {
      const out = [];
      for (const n of box.childNodes) {
        if (n.nodeType === 3) { if (n.nodeValue.trim()) return null; continue; }
        if (n.nodeType !== 1 || n.classList.contains('lmd-add') || n.classList.contains('lmd-front')) continue;
        const draft = n.classList.contains('lmd-draft') ? n : (n.classList.contains('lmd-draft-li') ? n.querySelector('.lmd-draft') : null);
        if (draft) { if (old && d.was.has(draft)) out.push({ node: n, el: null, r: d.was.get(draft), draft: true }); continue; }
        const own = ownRange(n);
        out.push({ node: n, el: own, r: own ? (old ? d.was.get(own) || null : rangeOf(own)) : null });
      }
      return out;
    };
    // El mismo bloque de un lado y del otro: ningún tramo lo tocó, quedó donde le corresponde tras correrse, y dice lo mismo.
    const same = (o, n) => {
      if (!o.r || !n.r) return !o.r && !n.r && o.node.tagName === n.node.tagName;
      if (o.r[0] + d.start(o.r[0] + fm) !== n.r[0] || o.r[1] - o.r[0] !== n.r[1] - n.r[0] || d.hit(o.r[0] + fm, o.r[1] + fm)) return false;
      if (o.el && n.el && o.el.hasAttribute('data-p') !== n.el.hasAttribute('data-p')) return false;
      for (let k = o.r[0], j = n.r[0]; k < o.r[1]; k++, j++) if (oldLines[k + fm] !== srcLines[j + fm]) return false;
      return true;
    };
    // Con quién se queda cada bloque de los que había: el índice de su par en lo nuevo, o -1 si cambió o ya no está.
    // Lo que no ocupa líneas (la casilla de una tarea, el título de un aviso, las notas al pie) va con su vecino.
    const match = (O, N) => {
      const at = new Map(); N.forEach((k, j) => { if (k.r && !at.has(k.r[0])) at.set(k.r[0], j); });
      let last = -1;
      return O.map((o) => {
        let j = -1;
        if (o.r) { const c = at.get(o.r[0] + d.start(o.r[0] + fm)); if (c !== undefined && c > last && same(o, N[c])) j = c; }
        else if (N[last + 1] && same(o, N[last + 1])) j = last + 1;
        if (j >= 0) last = j;
        return j;
      });
    };
    const body = settings.plugins.frontmatter ? splitFrontmatter(raw).body : raw;
    const tmp = el('div');
    tmp.innerHTML = DOMPurify.sanitize(buildParser().render(body), { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    const O = kidsOf(art, true); const N = kidsOf(tmp, false);
    if (!O || !N) return false;
    const pairs = match(O, N); const kept = new Set(pairs.filter((j) => j >= 0));
    const fresh = N.filter((k, j) => !kept.has(j));
    // Solo lo nuevo pasa por lo que se le hace a un bloque al dibujarlo (código, tablas, tareas, fórmulas, edición).
    const box = el('div'); fresh.forEach((k) => box.appendChild(k.node));
    postProcess(box);
    if (box.querySelector('.lmd-toc')) return false;
    if (editMode) enableEditing(box);
    if (box.children.length !== fresh.length) return false;
    fresh.forEach((k, i) => { k.node = box.children[i]; k.el = ownRange(k.node); });
    Array.from(box.children).forEach((n) => n.remove());

    let heads = false; const many = fresh.length > 30;
    const glow = (n) => {
      // Quién hizo el último cambio que se dibujó en ese bloque (lo usa locate, mientras llega su marca nueva).
      if (by) n.dataset.liveByLast = by;
      if (!color || many) return;
      n.style.setProperty('--lmd-live', color); n.classList.add('lmd-live-flash');
      setTimeout(() => { n.classList.remove('lmd-live-flash'); n.style.removeProperty('--lmd-live'); if (!n.getAttribute('style')) n.removeAttribute('style'); }, 1400);
    };
    const hasHead = (n) => n.matches(HEADS) || !!n.querySelector(HEADS);
    const put = (parent, olds, news, ref) => {
      const at = olds.length ? olds[0].node : ref;
      news.forEach((k) => { parent.insertBefore(k.node, at && at.parentNode === parent ? at : null); if (hasHead(k.node)) heads = true; glow(k.node); });
      // Una sección desplegable que se vuelve a dibujar queda como estaba: abierta o cerrada.
      if (olds.length === news.length) olds.forEach((k, i) => { if (k.node.tagName === 'DETAILS' && news[i].node.tagName === 'DETAILS') news[i].node.open = k.node.open; });
      olds.forEach((k) => { if (hasHead(k.node)) heads = true; k.node.remove(); });
    };
    // El texto nuevo de un bloque, dentro del mismo nodo que tiene el cursor.
    const caretOf = (node) => { const sel = getSelection(); if (!sel.rangeCount || !node.contains(sel.focusNode)) return -1; const r = document.createRange(); r.selectNodeContents(node); r.setEnd(sel.focusNode, sel.focusOffset); return r.toString().length; };
    const clean = (node) => !composing && node._md != null && inlineMd(node) === node._md;
    const refresh = (node, fresh) => {
      if (node.tagName !== fresh.tagName || !node.classList.contains('lmd-editable') || !fresh.classList.contains('lmd-editable') || !clean(node)) return false;
      const offset = caretOf(node);
      node.replaceChildren(...fresh.childNodes);
      node._md = inlineMd(node);
      const at = sourceOf(node); node._was = at ? srcLines.slice(at.s, at.s + at.n) : null;
      if (offset >= 0) caretAt(node, Math.min(offset, node.textContent.length));
      if (node.matches(HEADS)) heads = true;
      glow(node);
      return true;
    };
    // Una tabla con el cursor en una celda: las demás celdas se cambian una por una.
    const patchTable = (a, b) => {
      const ot = a.querySelector('table'); const nt = b.querySelector('table');
      if (!ot || !nt || ot.rows.length !== nt.rows.length || ot.classList.contains('lmd-noedit') !== nt.classList.contains('lmd-noedit')) return false;
      for (let i = 0; i < ot.rows.length; i++) if (ot.rows[i].cells.length !== nt.rows[i].cells.length) return false;
      let ok = true;
      for (let i = 0; i < ot.rows.length; i++) for (let j = ot.rows[i].cells.length - 1; j >= 0; j--) {
        const oc = ot.rows[i].cells[j]; const nc = nt.rows[i].cells[j];
        if (oc === focus) {
          const now = nc.dataset.formula || inlineMd(nc);
          if (now === inlineMd(oc)) continue;
          if (!clean(oc)) { ok = false; continue; }
          const offset = caretOf(oc);
          if (nc.dataset.formula) { oc.textContent = nc.dataset.formula; oc.dataset.formula = nc.dataset.formula; } else { oc.replaceChildren(...nc.childNodes); delete oc.dataset.formula; }
          oc._md = inlineMd(oc); oc._was = [srcLines[sourceOf(oc).s]];
          if (offset >= 0) caretAt(oc, Math.min(offset, oc.textContent.length));
          glow(oc);
        } else if (oc.innerHTML !== nc.innerHTML || oc.dataset.formula !== nc.dataset.formula) { oc.replaceWith(nc); glow(nc); }
      }
      // Los totales de las otras celdas se vuelven a calcular al salir de la tabla.
      if (ot.querySelector('[data-formula]')) needsRender = true;
      return ok;
    };
    // Recorre un contenedor: lo que tiene par queda como está, y entre par y par se cambia lo viejo por lo nuevo.
    function apply(parent, O, N, pairs, depth) {
      const front = parent.querySelector(':scope > .lmd-front');
      const tail = O.length ? O[O.length - 1].node.nextSibling : (front ? front.nextSibling : parent.firstChild);
      let ok = true; let i = 0; let j = 0;
      for (let k = 0; k <= O.length; k++) {
        if (k < O.length && pairs[k] < 0) continue;
        const nj = k < O.length ? pairs[k] : N.length;
        const olds = O.slice(i, k); const news = N.slice(j, nj);
        if (olds.length || news.length) ok = swap(parent, olds, news, k < O.length ? O[k].node : tail, depth) && ok;
        i = k + 1; j = nj + 1;
      }
      return ok;
    }
    // Un tramo: olds deja su lugar a news, antes de ref.
    function swap(parent, olds, news, ref, depth) {
      if (olds.some((k) => !k.r) || news.some((k) => !k.r)) return false;
      const hit = focus ? olds.findIndex((k) => k.node === focus || k.node.contains(focus)) : -1;
      if (hit < 0) { put(parent, olds, news, ref); return true; }
      // El bloque con el cursor queda donde está. Su par en lo nuevo es el que empieza en la línea que le toca.
      const keep = olds[hit];
      const start = keep.r[0] + d.start(keep.r[0] + fm);
      const j = news.findIndex((k) => k.r[0] === start);
      if (j < 0) return false;
      const after = keep.node.nextSibling;
      put(parent, olds.slice(0, hit), news.slice(0, j), keep.node);
      put(parent, olds.slice(hit + 1), news.slice(j + 1), after);
      return join(keep, news[j], depth);
    }
    function join(keep, pair, depth) {
      if (same(keep, pair)) return true;
      if (keep.draft) return false;
      // Las líneas que ocupa ahora, exactas.
      if (keep.el && pair.el) ['data-l', 'data-p'].forEach((a) => { if (pair.el.hasAttribute(a) && keep.el.hasAttribute(a)) keep.el.setAttribute(a, pair.el.getAttribute(a)); });
      const node = keep.node;
      if (node === focus) return refresh(node, pair.node);
      if (depth > 8 || node.tagName !== pair.node.tagName) return false;
      if (node.classList.contains('lmd-table')) return patchTable(node, pair.node);
      const inO = kidsOf(node, true); const inN = kidsOf(pair.node, false);
      if (!inO || !inN) return false;
      // La casilla de una tarea es del ítem, no de su texto.
      const ob = node.querySelector(':scope > input.lmd-task'); const nb = pair.node.querySelector(':scope > input.lmd-task');
      if (!!ob !== !!nb) return false;
      if (ob) ob.checked = nb.checked;
      return apply(node, inO, inN, match(inO, inN), depth + 1);
    }
    // La página no se mueve: lo que estaba a la vista (o el bloque con el cursor) queda a la misma altura.
    const pin = focus || (O.find((k, i) => pairs[i] >= 0 && k.node.getBoundingClientRect().bottom > 60) || {}).node || null;
    const pinTop = pin ? pin.getBoundingClientRect().top : 0;
    const ok = apply(art, O, N, pairs, 0);
    if (heads) {
      const used = new Set(); const hs = Array.from(art.querySelectorAll(HEADS)).filter((h) => !h.closest('.lmd-front'));
      hs.forEach((h) => { h.id = slugify(headingText(h), used); const a = h.querySelector(':scope > .lmd-anchor[href]'); if (a) a.setAttribute('href', '#' + h.id); });
      spyHeadings = hs; buildOutline(hs);
    }
    if (pin && pin.isConnected) { const dy = pin.getBoundingClientRect().top - pinTop; if (Math.abs(dy) >= 1) window.scrollBy(0, dy); }
    onScroll(); updateCount();
    if (!ok) needsRender = true;
    return ok;
  }

  // En qué bloque está alguien, para decírselo a los demás: una huella del texto de sus líneas, dónde empieza y
  // cuántas son. La huella lo encuentra aunque a quien mira se le hayan corrido las líneas. El texto no viaja.
  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  function blockId(node) {
    let at = null;
    // Una celda cuenta como su tabla entera, y el cuadro de un bloque de código como ese bloque.
    const table = node.classList.contains('lmd-cell') && node.closest('table[data-l]');
    const code = node.classList.contains('lmd-src') && node.closest('.lmd-code') && node.closest('.lmd-code').querySelector('code[data-l]');
    const whole = table || code;
    if (whole) { const r = rangeOf(whole); at = r && { s: r[0] + fmOffset, n: r[1] - r[0] }; }
    // Un bloque nuevo: sus líneas si ya las tiene; si no, el bloque después del cual se está escribiendo.
    else if (node.classList.contains('lmd-draft')) { const y = node._syn; const near = node._li || node._anchor; const r = !y && near && near.isConnected ? rangeOf(ownRange(near) || near) : null; at = y ? { s: y.at, n: y.n } : r && { s: r[0] + fmOffset, n: r[1] - r[0] }; }
    else at = sourceOf(node);
    if (!at || at.n < 1) return null;
    return fnv(srcLines.slice(at.s, at.s + at.n).join('\n')) + '.' + at.s + '.' + at.n;
  }
  // El bloque de acá que corresponde a esa marca: el de la misma huella (el más cercano, si hay varios iguales).
  // Mientras esa persona escribe, su texto cambia antes de que llegue su marca nueva: ahí vale el bloque de esa
  // línea solo si lo último que se dibujó en él fue un cambio suyo (pid). Por el número de línea a secas no se
  // marca nada: a quien mira se le pueden haber corrido las líneas, y quedaría tomado un bloque que no es.
  // Devuelve lo que se ve del bloque (la tabla entera, la caja del código).
  function locate(id, pid) {
    const m = /^([a-z0-9]+)\.(\d+)\.(\d+)$/.exec(id || ''); if (!m || noDoc || rawMode) return null;
    const s = +m[2] - fmOffset; const n = +m[3]; let best = null; let score = Infinity; let last = null; let span = Infinity;
    ui.article.querySelectorAll('[data-l]').forEach((e) => {
      const r = rangeOf(e); if (!r) return;
      if (r[1] - r[0] === n) {
        const sc = Math.abs(r[0] - s) * 2 + (e.classList.contains('lmd-editable') ? 0 : 1);
        if (sc < score && fnv(srcLines.slice(r[0] + fmOffset, r[1] + fmOffset).join('\n')) === m[1]) { best = e; score = sc; }
      }
      if (pid && r[0] <= s && r[1] > s && r[1] - r[0] <= span) { const by = e.closest('[data-live-by-last]'); if (by && by.dataset.liveByLast === pid) { last = e; span = r[1] - r[0]; } }
    });
    const hit = best || last;
    return hit ? hit.closest('.lmd-table') || hit.closest('.lmd-code') || hit : null;
  }

  // Lo que dice el pie cuando no hay nada que avisar. La recarga automática se nombra solo donde hay un archivo
  // que otro programa puede cambiar: en una nota del navegador o de la nube no le dice nada a nadie.
  const idleStatus = () => (settings.autoRefresh && !noDoc && (!APP || (appRoot && appRoot.root)) ? T('Recarga automática activa') : '');
  let flashTimer = null;
  // Aviso corto en la barra. Los errores van en rojo y duran más.
  function flash(msg, kind) {
    // Sin nota abierta no hay pie donde mostrarlo: los avisos que importan van al estado vacío.
    if (noDoc) { if (kind && !ui.home.hidden) LMD.home.say(msg); return; }
    // Un aviso común no pisa una advertencia o un error que todavía están a la vista.
    if (!kind && (ui.status.classList.contains('lmd-error') || ui.status.classList.contains('lmd-warn'))) return;
    ui.status.textContent = msg;
    ui.status.classList.add('lmd-flash');
    ui.status.classList.toggle('lmd-error', kind === 'error');
    ui.status.classList.toggle('lmd-warn', kind === 'warn');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      ui.status.classList.remove('lmd-flash', 'lmd-error', 'lmd-warn');
      ui.status.textContent = idleStatus();
    }, kind ? 5000 : 1800);
    // Con el teclado en pantalla abierto el pie no se ve: una advertencia o un error salen además arriba, a la vista.
    if (kind && document.documentElement.classList.contains('lmd-kb')) {
      if (flashTop) flashTop.remove();
      const t = el('div', { class: 'lmd-flash-top' + (kind === 'error' ? ' lmd-error' : ''), role: 'status', text: msg }); flashTop = t;
      document.body.appendChild(t);
      setTimeout(() => { t.remove(); if (flashTop === t) flashTop = null; }, 5000);
    }
  }
  let flashTop = null;

  // ---------- Árbol de carpetas ----------

  const visibleRows = (rows) => rows
    .filter((x) => settings.filesShowHidden || !x.name.startsWith('.'))
    .filter((x) => x.dir || !settings.filesOnlyMarkdown || MD_RE.test(x.name) || TXT_RE.test(x.name) || (JY_RE.test(x.name) && !!LMD.tools && LMD.tools.isOn('jsonyaml')))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  async function listDir(dirUrl, all) {
    // Las direcciones virtuales (la nube, también en el lector de un archivo del disco) no se piden al navegador.
    if (APP || dirUrl.startsWith(VBASE)) { const found = await vList(dirUrl); return found && (all ? found : visibleRows(found)); }
    const r = await bg({ type: 'fetchText', url: dirUrl });
    if (!r || !r.ok) return null;
    const rows = [];
    const re = /addRow\((.*)\);/g; let m;
    while ((m = re.exec(r.text))) {
      try {
        const a = JSON.parse('[' + m[1] + ']');
        if (a[0] === '..' || a[0] === '.') continue;
        const url = new URL(a[1] + (a[2] ? '/' : ''), dirUrl).href;
        if (url.startsWith(dirUrl)) rows.push({ name: a[0], url, dir: !!a[2] }); // una fila nunca apunta fuera de su carpeta
      } catch (e) { /* fila ilegible */ }
    }
    if (!rows.length && !/addRow|<title>Index of/i.test(r.text)) {
      // Listado de un servidor web (autoindex): se leen los links
      const doc = new DOMParser().parseFromString(r.text, 'text/html');
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href || /^(\?|#|\/|\.\.|[a-z]+:)/i.test(href)) return;
        const url = new URL(href, dirUrl).href;
        if (url.startsWith(dirUrl)) rows.push({ name: decodeURIComponent(href.replace(/\/$/, '')), url, dir: /\/$/.test(href) });
      });
    }
    return all ? rows : visibleRows(rows);
  }

  // Qué es cada archivo del explorador, para su ícono: Markdown, texto plano, datos (JSON o YAML) o cualquier otra cosa.
  const fileKind = (name) => (MD_RE.test(name) ? 'md' : TXT_RE.test(name) ? 'txt' : JY_RE.test(name) ? 'data' : 'file');
  const FILE_ICON = { md: ICON.md, txt: ICON.txt, data: ICON.data, file: ICON.file };

  // ---------- Explorador ----------
  // Raíces desplegables, en este orden y solo las que apliquen: la carpeta del disco, las notas de este
  // navegador y la nube. Sobre un .md abierto directo en el navegador hay una sola: la carpeta del archivo.
  let treeRoot = APP ? '' : new URL('.', HERE).href; // hasta dónde llega el árbol del disco
  let diskRoot = null; // la carpeta o el archivo del disco que muestra el explorador de la app
  let diskTried = false;
  const lastTree = {}; // dónde quedó el árbol de cada carpeta del disco, mientras dure la pestaña
  const openDirs = new Set(); // carpetas desplegadas: siguen así al redibujar
  // Cómo quedó la barra: el reparto entre las dos zonas, y qué está plegado.
  let side = { split: 40, outlineShut: false, filesShut: false, shut: {} };
  const saveSide = () => { try { chrome.storage.local.set({ side }); } catch (e) { /* queda para esta sesión */ } };
  const loadSide = () => new Promise((resolve) => { try { chrome.storage.local.get('side', (r) => resolve(r && r.side)); } catch (e) { resolve(null); } });
  function applySide() {
    const o = ui.sidebar.querySelector('.lmd-zone-outline'); const f = ui.sidebar.querySelector('.lmd-zone-files');
    o.classList.toggle('lmd-shut', !!side.outlineShut); f.classList.toggle('lmd-shut', !!side.filesShut);
    o.style.flexGrow = side.outlineShut ? '' : String(side.split); f.style.flexGrow = side.filesShut ? '' : String(100 - side.split);
    ui.zones.classList.toggle('lmd-one', !!side.outlineShut || !!side.filesShut);
    ui.sidebar.querySelectorAll('[data-zone-tog]').forEach((b) => b.setAttribute('aria-expanded', String(!side[b.dataset.zoneTog + 'Shut'])));
  }
  // Dónde está guardado cada archivo: el ícono chico al lado del nombre.
  const WHERE = { disk: ['disk', 'En el disco'], local: ['browser', 'En este navegador'], cloud: ['cloud', 'En la nube'], team: ['people', 'En el equipo'] };
  // Las notas del equipo viven en la nube, bajo el espacio del equipo: en el explorador son una raíz aparte.
  // El lector de un archivo del disco también muestra la nube (CLOUDY): le habla al servidor por la extensión.
  const CLOUDY = APP || isFile;
  const teamUrl = () => { const t = CLOUDY ? LMD.cloud.teamNow() : null; return t ? VBASE + 'cloud/~' + t.space + '/' : ''; };
  const sectionOf = (url) => { if (!APP && !url.startsWith(VBASE)) return isFile ? 'disk' : ''; const r = rootOf(url); if (!r) return ''; if (r.kind === 'cloud') return teamUrl() && url.startsWith(teamUrl()) ? 'team' : 'cloud'; return r.kind === 'local' ? 'local' : r.kind === 'fs' ? 'fs' : 'disk'; };
  // Las notas que nacen con la fecha por nombre se listan por su primer renglón.
  const STAMP_RE = /^(nota|note)-\d{8}-\d{4}(-\d+)?\.md$/i;

  // Hasta dónde subió la persona con la flecha, por carpeta: la próxima vez el árbol arranca ahí.
  const TROOT_MAX = 200;
  const treeMemo = () => new Promise((resolve) => { try { chrome.storage.local.get('treeRoots', (r) => resolve((r && r.treeRoots) || {})); } catch (e) { resolve({}); } });
  async function rememberRoot(dir, top) {
    const all = await treeMemo(); all[dir] = { u: top, t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > TROOT_MAX) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - TROOT_MAX).forEach((k) => delete all[k]);
    try { chrome.storage.local.set({ treeRoots: all }); } catch (e) { /* queda para esta sesión */ }
  }
  // Dónde arranca el árbol para un archivo: donde lo dejó la persona, la raíz del repositorio si hay un .git
  // más arriba, o la carpeta del archivo. limit es lo más arriba que se puede llegar: en la app, la carpeta
  // que la persona eligió; sobre file:// se mira hasta GIT_UP carpetas hacia arriba.
  const GIT_UP = 8;
  async function startRoot(fileUrl, limit) {
    const dir = new URL('.', fileUrl).href;
    const inside = (u) => !!u && dir.startsWith(u) && (!limit || u.startsWith(limit));
    const memo = (await treeMemo())[dir];
    if (memo && inside(memo.u)) return memo.u;
    if (!APP && !isFile) return dir;
    let u = dir;
    for (let k = 0; k <= (APP ? 40 : GIT_UP); k++) {
      const rows = await listDir(u, true);
      if (!rows) break;
      if (rows.some((r) => r.name === '.git')) return u;
      const up = new URL('..', u).href;
      if (up === u || (limit && !up.startsWith(limit))) break;
      u = up;
    }
    return dir;
  }
  // La carpeta del disco más reciente que todavía tiene permiso: es la que se muestra al entrar.
  async function recentDisk() {
    for (const r of await LMD.store.rootsAll()) {
      try { if ((await r.handle.queryPermission({ mode: 'read' })) === 'granted') return r; } catch (e) { /* permiso vencido */ }
    }
    return null;
  }

  function rootSection(key, o) {
    const sec = el('section', { class: 'lmd-xroot' + (side.shut[key] ? ' lmd-shut' : ''), 'data-root': key });
    const head = el('div', { class: 'lmd-tree-head' });
    const tog = el('button', { type: 'button', class: 'lmd-root-tog', 'aria-expanded': String(!side.shut[key]), title: o.title || o.name },
      '<span class="lmd-node-chev">' + ICON.chevron + '</span><span class="lmd-root-ico">' + o.icon + '</span><span class="lmd-tree-path"></span>');
    tog.querySelector('.lmd-tree-path').textContent = o.name;
    head.appendChild(tog);
    if (o.up) head.appendChild(el('button', { class: 'lmd-tree-up', type: 'button', title: T('Subir a la carpeta superior') }, ICON.up));
    if (o.add) head.appendChild(el('button', { class: 'lmd-tree-up lmd-tree-new', type: 'button', title: T('Crear acá') }, ICON.plus));
    const list = el('div', { class: 'lmd-tree' });
    if (o.url) list.dataset.url = o.url;
    sec.append(head, list);
    return sec;
  }

  // Al pie de la nube (y del equipo), la entrada a su papelera.
  const trashLink = (owner) => el('button', { type: 'button', class: 'lmd-link lmd-trash-link', 'data-trash': owner || '' }, ICON.trash + '<span>' + T('Papelera') + '</span>');
  // Las raíces de la nube: la propia y la del equipo, cada una con su papelera al pie. En la app y, con la sesión que
  // comparte la extensión, en el lector de un archivo del disco: ahí se mira y recibe copias, sin el botón de crear.
  function cloudRoots(add, fills) {
    if (!LMD.cloud.enabled()) return;
    if (LMD.cloud.signedIn()) {
      const mine = add('cloud', { name: T('Nube'), icon: ICON.cloud, url: VBASE + 'cloud/', add: APP }); mine.after(trashLink(''));
      // Toda la nube protegida con contraseña: el candado, el estado y sus acciones van arriba de las notas.
      fills.push(LMD.vault.load().then(() => { const line = LMD.vault.rootLine(); if (line) mine.before(line); }).catch(() => { /* sin la lista, se dibuja como siempre */ }));
    }
    // Sin sesión, un renglón que invita a entrar.
    else add('cloud', { name: T('Nube'), icon: ICON.cloud }).appendChild(el('button', { type: 'button', class: 'lmd-link lmd-root-hint', text: T('Entrar para ver tus notas') }));
    // El espacio del equipo: lo que hay ahí lo leen y lo editan todos sus miembros.
    if (LMD.cloud.signedIn() && teamUrl()) {
      const list = add('team', { name: LMD.cloud.teamNow().name || T('Equipo'), title: T('Notas del equipo'), icon: ICON.people, url: teamUrl(), add: APP && LMD.cloud.teamCan('write') });
      list.after(trashLink(LMD.cloud.teamNow().space));
      // Protegido con contraseña: el candado, el estado y sus acciones van arriba de las notas.
      fills.push(LMD.vault.load().then(() => { const line = LMD.vault.teamLine(); if (line) list.before(line); }).catch(() => { /* sin la lista, se dibuja como siempre */ }));
    }
  }
  let treeTurn = 0;
  async function loadTree() {
    const turn = ++treeTurn;
    ui.paneFiles.dataset.loaded = '1';
    // Quien entró por el enlace de una sesión en vivo ve solo esa nota: no hay explorador que mostrarle.
    if (APP && LMD.cloud.guest()) { ui.treeBox.replaceChildren(); return; }
    const secs = []; const fills = [];
    const add = (key, o) => { const sec = rootSection(key, o); secs.push(sec); const list = sec.querySelector('.lmd-tree'); if (o.url) fills.push(fillDir(list, o.url, 0)); return list; };
    const leaf = (u) => decodeURIComponent(u.replace(/\/$/, '').split('/').pop() || u);
    if (!APP) {
      add('disk', { name: leaf(treeRoot), title: decodeURIComponent(treeRoot), icon: ICON.folder, url: treeRoot, up: new URL('..', treeRoot).href !== treeRoot });
      // Un archivo del disco: debajo de su carpeta, la nube de la cuenta, para ver a dónde va lo que se envía.
      if (isFile) {
        try { await LMD.cloud.ready(); } catch (e) { /* sin almacenamiento de la extensión: queda la carpeta sola */ }
        if (turn !== treeTurn) return;
        cloudRoots(add, fills);
      }
    } else {
      if (!diskRoot && !diskTried) {
        diskTried = true;
        const r = await recentDisk();
        if (turn !== treeTurn) return;
        if (r && !diskRoot) { diskRoot = roots[r.id] || r; roots[r.id] = diskRoot; }
      }
      await LMD.cloud.ready();
      const others = (await LMD.store.rootsAll()).filter((r) => !diskRoot || r.id !== diskRoot.id).slice(0, 8);
      if (turn !== treeTurn) return;
      if (diskRoot) {
        const top = VBASE + diskRoot.id + '/';
        if (!treeRoot || !treeRoot.startsWith(top)) treeRoot = top;
        const atTop = treeRoot === top;
        const diskList = add('disk', { name: atTop ? diskRoot.name : leaf(treeRoot), title: diskRoot.name + (atTop ? '' : '/' + vParts(treeRoot).join('/')), icon: diskRoot.kind === 'dir' ? ICON.folder : ICON.file, url: treeRoot, up: !atTop, add: diskRoot.kind === 'dir' });
        // De un vistazo: abierta en solo lectura, con la forma de permitir guardar ahí mismo.
        if (diskRoot.handle && !diskRoot.ghost && !(await canWrite(diskRoot.handle, false))) diskList.before(el('button', { type: 'button', class: 'lmd-link lmd-root-hint lmd-root-ro', 'data-write': '', text: T('Solo lectura · Permitir guardar') }));
        if (turn !== treeTurn) return;
      }
      // Un archivo del disco abierto por enlace: su rama, desde un par de carpetas más arriba, con el camino completo
      // en el título. Debajo, cómo abrir la carpeta de verdad (para ver todo y poder guardar).
      if (!noDoc && appRoot && appRoot.kind === 'fs') {
        const parts = vParts(HERE); const up = Math.max(1, parts.length - 1 - FS_UP);
        const top = FS + parts.slice(0, up).map(encodeURIComponent).join('/') + '/';
        const list = add('fs', { name: T('Del disco') + ' · ' + parts[up - 1], title: LMD.filePath(fsFile(top)), icon: ICON.folder, url: top });
        if (window.showDirectoryPicker) list.after(el('button', { type: 'button', class: 'lmd-link lmd-root-hint', 'data-fs': 'grant', text: T('Abrir esta carpeta') }));
      }
      add('local', { name: T('En este navegador'), icon: ICON.browser, url: VBASE + 'local/', add: true });
      cloudRoots(add, fills);
      // Las otras carpetas y archivos del disco que se abrieron antes: un clic los trae de vuelta.
      if (others.length) {
        const list = add('recent', { name: T('Recientes'), icon: ICON.clock });
        others.forEach((r) => {
          const row = el('div', { class: 'lmd-recent' });
          const go = el('a', { class: 'lmd-node', href: APP_URL + '?f=' + encodeURIComponent(r.last || r.id + '/'), title: r.name });
          go.innerHTML = '<span class="lmd-node-ico">' + (r.kind === 'dir' ? ICON.folder : FILE_ICON[fileKind(r.name)]) + '</span><span class="lmd-node-name"></span><span class="lmd-node-sub"></span>';
          go.querySelector('.lmd-node-name').textContent = r.name;
          go.querySelector('.lmd-node-sub').textContent = r.ghost ? T('Reconectar') : r.kind === 'dir' ? decodeURIComponent((r.last || '').split('/').slice(1).join('/')) : '';
          // Se abrió del otro lado (la web o la extensión): acá todavía falta elegirla una vez.
          if (r.ghost) { go.dataset.ghost = r.key; go.classList.add('lmd-node-ghost'); }
          const del = el('button', { type: 'button', class: 'lmd-node-x', title: T('Quitar de la lista'), 'data-key': r.key }, ICON.close);
          row.append(go, del); list.appendChild(row);
        });
      }
    }
    // Lo que se lista rápido entra ya dibujado, sin parpadeo; lo lento (la nube) se completa después.
    await Promise.race([Promise.all(fills), new Promise((resolve) => setTimeout(resolve, 200))]);
    if (turn !== treeTurn) return;
    const y = ui.paneFiles.scrollTop;
    ui.treeBox.replaceChildren(...secs);
    ui.paneFiles.scrollTop = y;
    markActive();
  }
  // Marca en el árbol la nota abierta. Devuelve false si no está a la vista.
  function markActive() {
    let hit = null;
    ui.treeBox.querySelectorAll('.lmd-node').forEach((n) => { const on = !noDoc && n.dataset.url === HERE; n.classList.toggle('lmd-active', on); if (on) hit = n; });
    if (hit && hit.offsetParent) hit.scrollIntoView({ block: 'nearest' });
    return !!hit;
  }
  // Al cambiar de nota el explorador la deja marcada y a la vista. Si es del disco y quedó fuera del árbol,
  // el árbol se vuelve a ubicar: en la raíz del repositorio si la hay, o en la carpeta del archivo.
  let rootTurn = 0;
  async function syncTree(fresh) {
    const turn = ++rootTurn;
    if (APP && !noDoc && appRoot.root) {
      const top = VBASE + appRoot.id + '/';
      if (!diskRoot || diskRoot.id !== appRoot.id) {
        // Al volver a una carpeta que ya se usó en esta sesión, el árbol queda donde estaba.
        if (diskRoot && treeRoot) lastTree[diskRoot.id] = treeRoot;
        treeRoot = lastTree[appRoot.id] || ''; fresh = true;
      }
      diskRoot = appRoot;
      if (!treeRoot || !treeRoot.startsWith(top) || !HERE.startsWith(treeRoot)) {
        const next = await startRoot(HERE, top);
        if (turn !== rootTurn) return;
        treeRoot = next; fresh = true;
      }
    }
    // Sobre un archivo abierto directo, si el que se abrió quedó fuera del árbol, el árbol se vuelve a ubicar.
    if (!APP && treeRoot && !HERE.startsWith(treeRoot)) {
      const next = await startRoot(HERE);
      if (turn !== rootTurn) return;
      treeRoot = next; fresh = true;
    }
    // La raíz de la nota abierta se despliega sola.
    const key = noDoc ? '' : sectionOf(HERE);
    if (key && side.shut[key]) { delete side.shut[key]; saveSide(); fresh = true; }
    // La rama de un archivo abierto por enlace se arma con cada nota, y se va al pasar a otra cosa.
    if (key === 'fs' || ui.treeBox.querySelector('.lmd-xroot[data-root=fs]')) fresh = true;
    if (fresh || !markActive()) loadTree();
  }
  // Sube el árbol del disco una carpeta, y lo recuerda para la carpeta de la nota abierta.
  function treeUp() {
    const top = APP && diskRoot ? VBASE + diskRoot.id + '/' : '';
    const parent = new URL('..', treeRoot).href;
    if ((top && treeRoot === top) || parent === treeRoot) return;
    treeRoot = parent;
    if (!noDoc && HERE.startsWith(treeRoot)) rememberRoot(new URL('.', HERE).href, treeRoot);
    loadTree();
    if (ui.searchInput.value.trim()) runSearch(ui.searchInput.value);
  }
  // Entrar a la cuenta: en la app, el formulario; sobre un archivo abierto directo se entra en la app, y la sesión
  // (que la extensión comparte) llega sola a esta pestaña.
  const signIn = () => { if (APP) LMD.sync.login(); else bg({ type: 'openApp', query: '?login=1' }); };
  // Clics en la barra que no abren nada: plegar una zona o una raíz, subir, quitar un reciente, entrar.
  function sideClick(e) {
    const zone = e.target.closest('[data-zone-tog]');
    if (zone) { const k = zone.dataset.zoneTog + 'Shut'; side[k] = !side[k]; applySide(); saveSide(); return true; }
    const tog = e.target.closest('.lmd-root-tog');
    if (tog) {
      const sec = tog.closest('.lmd-xroot'); const shut = sec.classList.toggle('lmd-shut');
      if (shut) side.shut[sec.dataset.root] = true; else delete side.shut[sec.dataset.root];
      tog.setAttribute('aria-expanded', String(!shut)); saveSide();
      return true;
    }
    if (e.target.closest('.lmd-tree-up:not(.lmd-tree-new)')) { treeUp(); return true; }
    const ghost = e.target.closest('a[data-ghost]');
    if (ghost && !e.target.closest('.lmd-node-x')) { e.preventDefault(); LMD.bridge.reconnect(ghost.dataset.ghost, homeCtx()).then(() => loadTree()); return true; }
    const x = e.target.closest('.lmd-node-x');
    if (x) { LMD.store.handlesDelete(x.dataset.key).then(() => loadTree()); return true; }
    if (e.target.closest('.lmd-root-hint:not([data-write]):not([data-fs])')) { signIn(); return true; }
    const bin = e.target.closest('[data-trash]');
    if (bin) { setDrawer(false); LMD.extras.trash(bin.dataset.trash); return true; }
    // "Bloquear ahora" de una carpeta abierta para la IA.
    if (LMD.vault.aiClick(e)) return true;
    return false;
  }

  async function fillDir(container, dirUrl, depth) {
    container.textContent = '';
    container.appendChild(el('p', { class: 'lmd-empty', text: T('Leyendo carpeta…') }));
    const rows = await listDir(dirUrl);
    container.textContent = '';
    // Lo que se listó, para notar después si la carpeta cambió afuera (pollTree).
    container._dir = dirUrl; container._depth = depth; container._sig = rows == null ? null : rowSig(rows);
    const where = WHERE[sectionOf(dirUrl)];
    if (rows == null) {
      const msg = APP || dirUrl.startsWith(VBASE) ? T('No se pudo leer esta carpeta.') : isFile
        ? T('No se pudo leer la carpeta. Activá "Permitir acceso a URL de archivo" en los detalles de la extensión.')
        : T('Este servidor no expone el listado de la carpeta.');
      container.appendChild(el('p', { class: 'lmd-empty', text: msg }));
      return;
    }
    if (!rows.length) {
      // Una raíz sin nada dice cómo empezar; una carpeta del disco, que no tiene Markdown.
      const fresh = APP && depth === 0 && sectionOf(dirUrl) !== 'disk';
      const shut = APP && depth === 0 && dirUrl === teamUrl() && LMD.vault.teamShut();
      const shutTeam = shut || (!APP && depth === 0 && dirUrl === teamUrl() && LMD.vault.teamShut());
      // En el lector de un archivo del disco la nube se mira y recibe copias: no hay botón + ahí.
      const none = el('p', { class: 'lmd-empty', text: T(shutTeam ? 'Desbloqueá el espacio para ver sus notas.' : fresh ? 'Creá una nota con el botón +.' : !APP && dirUrl.startsWith(VBASE) ? 'Todavía no hay notas acá.' : 'Carpeta sin archivos Markdown.') });
      // Dentro de una carpeta, el aviso va con la sangría de lo que habría adentro: si no, parece hermano de la carpeta.
      if (depth > 0) none.style.paddingLeft = (32 + depth * 14) + 'px';
      container.appendChild(none);
      return;
    }
    const here = noDoc ? '' : HERE;
    rows.forEach((row) => rowNodes(row, depth, where, here).forEach((n) => container.appendChild(n)));
  }
  // Los nodos de un renglón del árbol: el archivo o la carpeta, y lo que cuelga de una carpeta.
  function rowNodes(row, depth, where, here) {
    const out = [];
    {
      // Carpeta con contraseña: candado cerrado si está bloqueada en esta pestaña, abierto si no.
      const vault = row.vault || null; const shut = !!vault && !LMD.vault.isOpen(vault);
      const item = el(row.dir ? 'button' : 'a', { class: 'lmd-node' + (row.dir ? ' lmd-node-dir' : '') + (vault ? ' lmd-node-vault' + (shut ? ' lmd-vault-shut' : '') : ''), title: row.label && row.dir ? row.label : row.name });
      item.style.paddingLeft = (10 + depth * 14) + 'px';
      item.dataset.url = row.url;
      const kind = row.dir ? 'dir' : fileKind(row.name);
      item.dataset.kind = kind;
      item.innerHTML = (row.dir ? '<span class="lmd-node-chev">' + ICON.chevron + '</span>' + (vault ? '<span class="lmd-node-lock" title="' + T(shut ? 'Carpeta protegida, bloqueada' : 'Carpeta protegida, desbloqueada en esta pestaña') + '">' + (shut ? ICON.lock : ICON.unlock) + '</span>' : '')
        : '<span class="lmd-node-ico">' + FILE_ICON[kind] + '</span>') +
        '<span class="lmd-node-name"></span>' + (!row.dir && where ? '<span class="lmd-node-where" title="' + T(where[1]) + '">' + ICON[where[0]] + '</span>' : '');
      item.querySelector('.lmd-node-name').textContent = row.label || row.name;
      out.push(item);
      // Abierta para la IA: se dice hasta cuándo, con el botón para bloquearla ya.
      if (vault && vault.ai) {
        const line = el('div', { class: 'lmd-vault-line' });
        line.style.paddingLeft = (32 + depth * 14) + 'px';
        line.append(el('span', { class: 'lmd-vault-ico' }, ICON.spark), el('span', { class: 'lmd-vault-state', text: LMD.vault.aiText(vault) }), el('button', { type: 'button', class: 'lmd-link', 'data-vault-ailock': String(vault.id), text: T('Bloquear ahora') }));
        out.push(line);
      }
      if (row.dir) {
        item.type = 'button';
        // Una carpeta se arrastra a otra, como un archivo. En pantalla táctil se mueve desde el menú.
        // Sobre un archivo del disco, una carpeta se arrastra a la nube para enviar una copia.
        if ((APP || (isFile && !row.url.startsWith(VBASE))) && !LMD.touch.coarse()) item.draggable = true;
        const kids = el('div', { class: 'lmd-node-kids', hidden: '' });
        out.push(kids);
        const open = async () => {
          // Bloqueada: al abrirla pide la contraseña una vez. Al desbloquearse el explorador se redibuja con ella desplegada.
          if (shut) { openDirs.add(row.url); if (!(await LMD.vault.unlock(vault))) openDirs.delete(row.url); return; }
          kids.hidden = !kids.hidden;
          item.classList.toggle('lmd-open', !kids.hidden);
          if (kids.hidden) openDirs.delete(row.url); else openDirs.add(row.url);
          if (!kids.hidden && !kids.dataset.loaded) { kids.dataset.loaded = '1'; await fillDir(kids, row.url, depth + 1); }
        };
        item.addEventListener('click', open);
        showCount(item, row.url);
        if (!shut && ((here && here.startsWith(row.url)) || openDirs.has(row.url))) open();
      } else {
        // Sobre un archivo abierto directo, lo que no es Markdown lleva la dirección que lo abre dentro de SharpMD
        // (también en otra pestaña); el Markdown y lo que SharpMD no dibuja, la suya.
        // Una nota de la nube vista desde el lector de un archivo del disco se abre en la app (ver el clic, más arriba).
        item.href = APP ? toHref(row.url) : row.url.startsWith(VBASE) ? appHref(row.url) : kind !== 'md' && opensHere(row.url) ? readerHref(row.url) : row.url;
        if (row.url === here) { item.classList.add('lmd-active'); setTimeout(() => { if (item.offsetParent) item.scrollIntoView({ block: 'nearest' }); }, 0); }
      }
    }
    return out;
  }

  // ---------- El explorador se entera solo de lo que cambia en la carpeta ----------
  // Cada pocos segundos, y solo con la pestaña a la vista, se vuelve a listar cada carpeta del disco que está
  // desplegada (una lectura por carpeta, con tope) y se compara con lo que hay dibujado. Si cambió, se suman los
  // renglones nuevos y se sacan los que ya no están, sin redibujar el resto: carpetas desplegadas, posición, foco y
  // búsqueda quedan como estaban. Donde el navegador lo ofrece, FileSystemObserver avisa enseguida y el sondeo queda
  // de respaldo. Lo plegado no se lee: se pone al día al desplegarlo.
  const TREE_POLL = 4000; const TREE_POLL_DIRS = 40; const NEW_MARK = 8000;
  const rowSig = (rows) => rows.map((r) => (r.dir ? 'd' : 'f') + r.url).join('\n');
  const watchable = (url) => (APP ? (rootOf(url) || {}).kind === 'dir' : isFile && !url.startsWith(VBASE));
  let treePolling = false; let goneDoc = ''; let fsObs = null; let fsObsRoot = null;
  function watchDisk() {
    if (!APP || !window.FileSystemObserver || !diskRoot || diskRoot.kind !== 'dir' || fsObsRoot === diskRoot.handle) return;
    try {
      if (fsObs) fsObs.disconnect();
      fsObsRoot = diskRoot.handle;
      fsObs = new window.FileSystemObserver(debounce(() => pollTree(), 400));
      Promise.resolve(fsObs.observe(diskRoot.handle, { recursive: true })).catch(() => { /* queda el sondeo */ });
    } catch (e) { /* queda el sondeo */ }
  }
  // Pone un renglón de carpeta al día con el listado nuevo. Lo que sigue estando no se toca.
  function patchDir(box, rows) {
    const key = (dir, url) => (dir ? 'd' : 'f') + url;
    const old = new Map(); let cur = null;
    Array.from(box.children).forEach((n) => {
      if (n.classList.contains('lmd-node')) { cur = [n]; old.set(key(n.classList.contains('lmd-node-dir'), n.dataset.url), cur); } else if (cur) cur.push(n);
    });
    // De vacía a con archivos, o al revés: cambia el aviso, se dibuja entera.
    if (!old.size || !rows.length) { fillDir(box, box._dir, box._depth); return; }
    const keep = new Set(rows.map((r) => key(r.dir, r.url)));
    old.forEach((group, k) => { if (keep.has(k)) return; openDirs.delete(group[0].dataset.url); group.forEach((n) => n.remove()); });
    const where = WHERE[sectionOf(box._dir)]; const here = noDoc ? '' : HERE;
    let at = box.firstElementChild;
    rows.forEach((row) => {
      const group = old.get(key(row.dir, row.url));
      if (group) { if (at === group[0]) at = group[group.length - 1].nextElementSibling; else group.forEach((n) => box.insertBefore(n, at)); return; }
      const fresh = rowNodes(row, box._depth, where, here);
      // Lo que apareció queda marcado unos segundos.
      fresh[0].classList.add('lmd-node-new'); setTimeout(() => fresh[0].classList.remove('lmd-node-new'), NEW_MARK);
      fresh.forEach((n) => box.insertBefore(n, at));
    });
    box._sig = rowSig(rows);
  }
  async function pollTree(force) {
    if (treePolling || (!force && document.hidden) || !ui.paneFiles || !ui.paneFiles.dataset.loaded) return;
    treePolling = true; const turn = treeTurn; let changed = false;
    const root = document.documentElement; root.dataset.lmdTreePolls = String((+root.dataset.lmdTreePolls || 0) + 1);
    try {
      watchDisk();
      const boxes = Array.from(ui.treeBox.querySelectorAll('.lmd-tree, .lmd-node-kids')).filter((b) => b._dir && b._sig != null && !b.hidden && watchable(b._dir)).slice(0, TREE_POLL_DIRS);
      for (const box of boxes) {
        const rows = await listDir(box._dir);
        if (turn !== treeTurn) return;
        // Una carpeta que no se pudo leer (o que ya no está) la saca su carpeta de arriba al ponerse al día.
        if (!box.isConnected || rows == null || rowSig(rows) === box._sig) continue;
        changed = true; patchDir(box, rows);
      }
      if (changed) {
        // Lo que se sabía de la carpeta ya no vale: la búsqueda y los enlaces la vuelven a leer, y los contadores se rehacen.
        clearCounts(); folderIndex.clear(); wikiIndex = null; linkIndex = null;
        ui.treeBox.querySelectorAll('.lmd-node-dir').forEach((item) => { if (!watchable(item.dataset.url || '')) return; const n = item.querySelector(':scope > .lmd-node-n'); if (n) n.remove(); showCount(item, item.dataset.url); });
      }
      await checkGone();
    } catch (e) { /* una vuelta que falla no rompe nada: se reintenta en la próxima */ } finally { treePolling = false; }
  }
  // El archivo abierto se borró o se renombró afuera: se avisa una vez. Lo que hay a la vista, guardado o no, sigue acá.
  async function checkGone() {
    if (noDoc || !watchable(HERE)) return;
    const at = HERE; const rows = await listDir(new URL('.', HERE).href, true);
    if (at !== HERE || rows == null) return;
    const there = rows.some((r) => !r.dir && sameUrl(r.url, HERE));
    document.documentElement.classList.toggle('lmd-doc-gone', !there);
    if (there) { goneDoc = ''; return; }
    if (goneDoc === HERE) return;
    goneDoc = HERE;
    flash(T('"{a}" ya no está en la carpeta. Lo que ves sigue acá.', { a: DOC_NAME }), 'warn');
  }

  // ---------- Cuántas notas hay en cada carpeta ----------
  // El número chico a la derecha de cada carpeta: sus Markdown, contando subcarpetas. En la nube sale de la lista
  // de rutas que ya está en memoria. En el disco se recorre en segundo plano y de a una carpeta, sin frenar el
  // dibujo del árbol: cada carpeta se lee una sola vez (lo contado se guarda hasta que el árbol cambia) y hay un
  // tope de profundidad y de carpetas leídas. Pasado el tope el número lleva un "+". Leer una carpeta que está
  // bajo la raíz ya permitida no pide permiso; si no se puede leer, no se muestra nada.
  const COUNT_MAX_DEPTH = 8;
  const COUNT_MAX_DIRS = APP ? 1500 : 300; // sobre file:// cada carpeta es un pedido al navegador
  const dirCount = new Map(); let countReads = 0; let countQueue = Promise.resolve();
  const clearCounts = () => { dirCount.clear(); countReads = 0; };
  function diskCount(url, depth) {
    if (dirCount.has(url)) return dirCount.get(url);
    if (depth > COUNT_MAX_DEPTH || countReads >= COUNT_MAX_DIRS) return Promise.resolve({ n: 0, more: true });
    countReads++;
    const job = (async () => {
      const rows = await listDir(url, true);
      if (!rows) return { n: 0, more: false, fail: true };
      let n = 0; let more = false;
      for (const r of rows) {
        if (!settings.filesShowHidden && r.name.startsWith('.')) continue;
        if (!r.dir) { if (MD_RE.test(r.name) || TXT_RE.test(r.name)) n++; continue; }
        if (SKIP_DIRS.test(r.name)) continue;
        const sub = await diskCount(r.url, depth + 1);
        n += sub.n; more = more || sub.more;
      }
      return { n, more };
    })();
    dirCount.set(url, job);
    return job;
  }
  async function cloudCount(url) {
    const parts = vParts(url); const other = parts.length && parts[0][0] === '~' ? parts.shift().slice(1) : '';
    const prefix = parts.map((p) => p + '/').join('');
    return { n: (await LMD.cloud.list(false, other)).filter((x) => x.path.startsWith(prefix) && (MD_RE.test(x.path) || TXT_RE.test(x.path))).length, more: false };
  }
  function showCount(item, url) {
    if (!APP && !isFile) return; // el listado de un servidor web no se recorre
    const tag = el('span', { class: 'lmd-node-n', role: 'img', hidden: '' });
    item.appendChild(tag);
    const paint = (c) => {
      if (!c || c.fail || !c.n) return; // una carpeta sin notas queda sin número
      const more = c.more || c.n > 999;
      // El número lo dibuja la hoja de estilos: el texto del renglón sigue siendo el nombre de la carpeta.
      tag.dataset.n = c.n > 999 ? '999+' : c.n + (c.more ? '+' : '');
      const full = T(more ? 'Más de {n} notas' : c.n === 1 ? '1 nota' : '{n} notas', { n: Math.min(c.n, 999) });
      tag.setAttribute('aria-label', full); tag.title = full; tag.hidden = false;
    };
    if ((rootOf(url) || {}).kind === 'cloud') cloudCount(url).then(paint, () => {});
    else countQueue = countQueue.then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(() => diskCount(url, 0)).then(paint, () => {});
  }

  // ---------- Búsqueda ----------
  // Con texto en el buscador se marca lo encontrado en la nota abierta y se busca en los Markdown de las
  // raíces desplegadas del explorador. Los resultados dicen de dónde viene cada uno.
  const FOLDER_MAX_FILES = 600;
  const FOLDER_MAX_DEPTH = 6;
  const fileCache = new Map();
  const folderIndex = new Map(); // los Markdown de cada raíz ya recorrida
  let folderToken = 0;
  let resultsFor = ''; // el texto de los resultados que están a la vista

  // El buscador está siempre a la vista: "abrir" es darle foco y "cerrar" es vaciarlo.
  function toggleSearch(show) {
    if (show) {
      if (LMD.touch.small()) setDrawer(true); else if (settings.sidebarHidden) LMD.patch({ sidebarHidden: false });
      ui.searchInput.focus(); ui.searchInput.select();
      if (ui.searchInput.value) runSearch(ui.searchInput.value);
    } else { ui.searchInput.value = ''; ui.searchInput.blur(); runSearch(''); }
  }

  function showResults(on) {
    ui.results.hidden = !on;
    ui.treeBox.hidden = on;
    if (!on) { resultsFor = ''; ui.results.textContent = ''; }
  }

  function clearSearch() {
    searchHits = []; searchIndex = -1; ui.searchCount.textContent = '';
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('lmd-hit'); CSS.highlights.delete('lmd-hit-current'); }
  }

  // jump lleva la nota a la primera coincidencia. keep deja los resultados de archivos que ya están a la
  // vista (al redibujar la nota, o al abrir uno de esos resultados) y solo vuelve a marcar la nota.
  function runSearch(q, jump, keep) {
    clearSearch();
    q = (q || '').trim();
    document.documentElement.classList.toggle('lmd-searching', !!q);
    if (!q) { showResults(false); folderToken++; return; }
    if (!noDoc) highlightInDoc(q.toLowerCase(), jump);
    if (keep && resultsFor === q && !ui.results.hidden) docRow(); else searchFiles(q);
  }

  function highlightInDoc(q, scroll) {
    if (!(window.CSS && CSS.highlights)) return;
    const scope = rawMode ? ui.rawPre : ui.article;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.toLowerCase();
      let i = 0;
      while ((i = text.indexOf(q, i)) !== -1) {
        const r = new Range(); r.setStart(node, i); r.setEnd(node, i + q.length);
        searchHits.push(r); i += q.length;
        if (searchHits.length > 5000) break;
      }
    }
    if (searchHits.length) {
      CSS.highlights.set('lmd-hit', new Highlight(...searchHits));
      if (scroll) stepSearch(1); else ui.searchCount.textContent = String(searchHits.length);
    } else ui.searchCount.textContent = '0';
  }

  function stepSearch(dir) {
    if (!searchHits.length) return;
    searchIndex = (searchIndex + dir + searchHits.length) % searchHits.length;
    const r = searchHits[searchIndex];
    shown(r.startContainer);
    CSS.highlights.set('lmd-hit-current', new Highlight(r));
    const rect = r.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: 'smooth' });
    ui.searchCount.textContent = (searchIndex + 1) + ' / ' + searchHits.length;
  }

  async function collectFiles(root) {
    const out = [];
    const queue = [{ url: root, rel: '', depth: 0 }];
    while (queue.length && out.length < FOLDER_MAX_FILES) {
      const d = queue.shift();
      const rows = await listDir(d.url, true);
      if (!rows) { if (d.depth === 0) return null; continue; }
      rows.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const r of rows) {
        if (!settings.filesShowHidden && r.name.startsWith('.')) continue;
        if (r.dir) {
          if (d.depth < FOLDER_MAX_DEPTH && !SKIP_DIRS.test(r.name)) queue.push({ url: r.url, rel: d.rel + r.name + '/', depth: d.depth + 1 });
        } else if (MD_RE.test(r.name)) out.push({ rel: d.rel + r.name, url: r.url });
      }
    }
    return out;
  }

  async function readFile(url) {
    if (fileCache.has(url)) return fileCache.get(url);
    let text = '';
    if (APP) text = (await vText(url)) || '';
    else { const r = await bg({ type: 'fetchText', url }); text = r && r.ok ? r.text : ''; }
    fileCache.set(url, text);
    return text;
  }

  // Dónde se busca: las raíces del explorador que están desplegadas.
  function searchRoots() {
    const leaf = (u) => decodeURIComponent(u.replace(/\/$/, '').split('/').pop() || u);
    if (!APP) return [{ key: 'disk', name: leaf(treeRoot), icon: ICON.folder, url: treeRoot }];
    const out = [];
    if (diskRoot && treeRoot && !side.shut.disk) out.push({ key: 'disk', name: treeRoot === VBASE + diskRoot.id + '/' ? diskRoot.name : leaf(treeRoot), icon: ICON.folder, url: treeRoot });
    if (!side.shut.local) out.push({ key: 'local', name: T('En este navegador'), icon: ICON.browser, url: VBASE + 'local/' });
    if (LMD.cloud.enabled() && LMD.cloud.signedIn() && !side.shut.cloud) out.push({ key: 'cloud', name: T('Nube'), icon: ICON.cloud, url: VBASE + 'cloud/' });
    if (LMD.cloud.enabled() && LMD.cloud.signedIn() && teamUrl() && !side.shut.team) out.push({ key: 'team', name: LMD.cloud.teamNow().name || T('Equipo'), icon: ICON.people, url: teamUrl() });
    return out;
  }

  // El renglón de arriba de los resultados: cuántas veces aparece en la nota abierta. Un clic va a la siguiente.
  function docRow() {
    let row = ui.results.querySelector('.lmd-res-doc');
    if (noDoc) { if (row) row.remove(); return; }
    if (!row) {
      row = el('button', { type: 'button', class: 'lmd-res-doc' }, '<span class="lmd-node-ico">' + ICON.doc + '</span><span class="lmd-res-name"></span><span class="lmd-res-count"></span>');
      ui.results.insertBefore(row, ui.results.firstChild);
    }
    row.querySelector('.lmd-res-name').textContent = T('En esta nota');
    row.querySelector('.lmd-res-count').textContent = searchHits.length;
    row.title = DOC_NAME;
    ui.results.querySelectorAll('.lmd-res').forEach((g) => g.classList.toggle('lmd-res-here', g.dataset.url === HERE));
  }

  async function searchFiles(q) {
    const token = ++folderToken;
    const needle = q.toLowerCase();
    showResults(true); resultsFor = q;
    ui.results.textContent = '';
    docRow();
    const wait = el('p', { class: 'lmd-empty', text: T('Buscando en los archivos…') });
    ui.results.appendChild(wait);
    const where = searchRoots(); const files = [];
    for (const r of where) {
      if (!folderIndex.has(r.url)) {
        const got = await collectFiles(r.url);
        if (token !== folderToken) return;
        if (got == null) {
          // Sobre un archivo abierto directo, la carpeta puede no dejarse leer: se dice por qué.
          if (!APP) { wait.textContent = isFile ? T('No se pudo leer la carpeta. Activá "Permitir acceso a URL de archivo" en los detalles de la extensión.') : T('Este servidor no expone el listado de la carpeta.'); return; }
          continue;
        }
        folderIndex.set(r.url, got);
      }
      folderIndex.get(r.url).forEach((f) => files.push({ rel: f.rel, url: f.url, root: r }));
    }
    const found = [];
    let next = 0; let total = 0;
    const worker = async () => {
      while (next < files.length && token === folderToken) {
        const f = files[next++];
        const text = await readFile(f.url);
        if (!text) continue;
        if (text.toLowerCase().indexOf(needle) === -1) continue;
        const lines = text.split(/\r?\n/); const hits = []; let count = 0;
        for (let i = 0; i < lines.length; i++) {
          const low = lines[i].toLowerCase(); let pos = low.indexOf(needle);
          if (pos === -1) continue;
          let n = 0; let p2 = pos;
          while (p2 !== -1) { n++; p2 = low.indexOf(needle, p2 + needle.length); }
          count += n;
          if (hits.length < 4) hits.push({ line: i + 1, text: lines[i], pos });
        }
        total += count;
        found.push({ file: f, hits, count });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (token !== folderToken) return;

    found.sort((x, y) => x.file.rel.localeCompare(y.file.rel, undefined, { numeric: true, sensitivity: 'base' }));
    wait.remove();
    if (!where.length) return; // con todo plegado solo se busca en la nota
    const summary = found.length
      ? T((total === 1 ? '{t} coincidencia' : '{t} coincidencias') + (found.length === 1 ? ' en {f} archivo (de {n})' : ' en {f} archivos (de {n})'), { t: total, f: found.length, n: files.length })
      : T(files.length === 1 ? 'Sin coincidencias en {n} archivo' : 'Sin coincidencias en {n} archivos', { n: files.length });
    ui.results.appendChild(el('p', { class: 'lmd-results-sum', text: summary + (files.length >= FOLDER_MAX_FILES ? T('. Se revisaron los primeros {n}.', { n: FOLDER_MAX_FILES }) : '') }));
    if (noDoc) ui.searchCount.textContent = String(total);
    // Sobre un archivo abierto directo cada resultado es otra página: la búsqueda viaja en la dirección.
    const frag = '#lmd-q=' + encodeURIComponent(q) + (APP ? '' : '&r=' + encodeURIComponent(treeRoot));
    where.forEach((root) => {
      const mine = found.filter((r) => r.file.root === root);
      if (!mine.length) return;
      const head = el('p', { class: 'lmd-res-root', 'data-root': root.key }, '<span class="lmd-root-ico">' + root.icon + '</span><span></span>');
      head.lastChild.textContent = root.name;
      ui.results.appendChild(head);
      mine.forEach((r) => {
        const group = el('div', { class: 'lmd-res' + (!noDoc && r.file.url === HERE ? ' lmd-res-here' : '') });
        group.dataset.url = r.file.url;
        const file = el('a', { class: 'lmd-res-file', href: toHref(r.file.url + frag), title: r.file.rel });
        file.innerHTML = '<span class="lmd-node-ico">' + ICON.md + '</span><span class="lmd-res-name"></span><span class="lmd-res-count"></span>';
        file.querySelector('.lmd-res-name').textContent = r.file.rel;
        file.querySelector('.lmd-res-count').textContent = r.count;
        group.appendChild(file);
        r.hits.forEach((h) => {
          const start = Math.max(0, h.pos - 34);
          const cut = h.text.slice(start, h.pos + needle.length + 70);
          const rel = h.pos - start;
          const a = el('a', { class: 'lmd-res-hit', href: toHref(r.file.url + frag), title: T('Línea {n}', { n: h.line }) });
          a.append((start > 0 ? '…' : '') + cut.slice(0, rel), el('mark', { text: cut.slice(rel, rel + needle.length) }), cut.slice(rel + needle.length));
          group.appendChild(a);
        });
        if (r.count > r.hits.length && r.hits.length === 4) group.appendChild(el('span', { class: 'lmd-res-more', text: T('y más en este archivo') }));
        ui.results.appendChild(group);
      });
    });
  }

  // Busca un texto en la nota y en los archivos, con el buscador de siempre.
  function searchFor(q) {
    ui.searchInput.value = q;
    if (settings.sidebarHidden) LMD.patch({ sidebarHidden: false });
    if (side.filesShut) { side.filesShut = false; applySide(); saveSide(); }
    runSearch(q);
  }
  // Deja el explorador a la vista, con una raíz desplegada.
  function showFiles(key) {
    if (settings.sidebarHidden) LMD.patch({ sidebarHidden: false });
    if (side.filesShut) { side.filesShut = false; applySide(); }
    if (key && side.shut[key]) { delete side.shut[key]; loadTree(); }
    saveSide();
  }
  // Enlace a una sección para pegar en otro lado: la dirección completa si el documento tiene una pública
  // (un .md abierto desde la web, o una nota compartida por enlace); si no, solo el ancla.
  function sectionLink(anchor) {
    if (!APP) return /^https?:$/.test(location.protocol) ? location.href.split('#')[0] + '#' + anchor : '#' + anchor;
    if (appRoot && appRoot.kind === 'pub') return LMD.WEB_APP_URL + '?f=' + encodeURIComponent(HERE.slice(VBASE.length)) + '#' + anchor;
    return '#' + anchor;
  }

  // ---------- Visor de imágenes ----------
  function openViewer(img) {
    ui.viewer.textContent = '';
    ui.viewer.appendChild(el('img', { src: img.currentSrc || img.src, alt: img.alt || '' }));
    ui.viewer.hidden = false;
  }

  // El título elegido en el índice manda hasta que la persona vuelve a mover la página por su cuenta.
  let spyPin = null;
  ['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { spyPin = null; }, { passive: true }));
  window.addEventListener('keydown', (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) spyPin = null; }, true);

  // ---------- Panel de ajustes ----------
  let panelStale = false;
  let panelTab = 'look';
  let serverDraft = false; // "Uso mi propio servidor" prendido y la dirección todavía sin escribir
  const PANEL_TABS = [['look', 'Apariencia', ICON.eye], ['read', 'Lectura y edición', ICON.pencil], ['plug', 'Plugins', ICON.b_code], ['cloud', 'Nube', ICON.cloud], ['ai', 'IA (MCP)', ICON.spark], ['plan', 'Plan', ICON.card], ['inst', 'Instalar', ICON.download], ['adv', 'Avanzado', ICON.gear]];
  // Herramientas (tools.js) va después de Plugins. El invitado de una sesión en vivo no la ve.
  PANEL_TABS.splice(3, 0, ['tools', 'Herramientas', LMD.tools.ICON.tools]);
  // API y automatizaciones (automate.js) va después de IA: los tokens de la API, los webhooks y las direcciones de entrada.
  // El cuarto dato es su rótulo corto para el menú en español: el nombre entero no entra en un renglón de esa columna.
  PANEL_TABS.splice(PANEL_TABS.findIndex((t) => t[0] === 'ai') + 1, 0, ['auto', 'API y automatizaciones', '<svg viewBox="0 0 24 24"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>', 'Automatizaciones']);
  // Al cerrar Ajustes el foco vuelve a donde estaba al abrirlos.
  let panelBack = null;
  // La grilla de temas de Apariencia: cuál está puesto, cuál se eligió para mirar y qué botón le toca.
  let themePicked = '';
  function markThemes() {
    const box = ui.panel && !ui.panel.hidden ? ui.panel.querySelector('[data-themes]') : null; if (!box) return;
    const now = LMD.theme.active(settings);
    box.querySelectorAll('[data-th]').forEach((b) => {
      const on = b.dataset.th === now.id;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on)); b.classList.toggle('lmd-th-picked', b.dataset.th === themePicked);
    });
    const p = LMD.theme.byId(themePicked);
    box.querySelector('.lmd-th-custom').hidden = !now.custom || !!p;
    box.querySelector('.lmd-th-note').textContent = p ? T(p.name) : now.custom ? '' : T(LMD.theme.byId(now.id).name);
    box.querySelector('[data-th-apply]').hidden = !p;
  }
  function closePanel() {
    ui.panel.hidden = true;
    if (themePreview) { themePreview = ''; themePicked = ''; paintTheme(); }
    const back = panelBack; panelBack = null;
    if (back && back.isConnected && back !== document.body) { try { back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } }
  }
  // Con tab abre directo en esa pestaña: openPanel('plan'). why es una línea que dice por qué se llegó a Plan.
  function openPanel(tab, why) {
    // 'community' es la sub-pestaña Comunidad de Herramientas.
    if (tab === 'community') { tab = 'tools'; LMD.tools.sub('community'); }
    if (tab) panelTab = tab;
    LMD.sync.why(why);
    // Un invitado de una sesión en vivo no tiene cuenta que manejar acá, ni cambia de servidor a mitad de la sesión.
    const guestTabs = APP && LMD.cloud.guest() ? ['look', 'read', 'plug'] : null;
    if (!PANEL_TABS.some((t) => t[0] === panelTab) || (guestTabs && !guestTabs.includes(panelTab))) panelTab = 'look';
    LMD.write.closeMenu(); // un menú de bloques abierto quedaría encima de los ajustes
    const s = settings;
    const wasHidden = ui.panel.hidden; const hadFocus = !wasHidden && ui.panel.contains(document.activeElement);
    if (wasHidden) panelBack = document.activeElement;
    if (ui.panel.hidden) serverDraft = false;
    const noCloud = /^off$/i.test(s.cloudUrl || ''); const own = serverDraft || (!!s.cloudUrl && !noCloud);
    const EXTRA = ' <em class="lmd-tag">' + T('Plan pago') + '</em>';
    // Los plugins van en bloques con subtítulo (PLUGIN_GROUPS), en una columna. Cada fila: el botón que lo elige para ver
    // su ejemplo en el detalle (plugPane) y su interruptor. Uno que no esté en ningún bloque va al final del último.
    const plugRow = (k) => '<div class="lmd-plg-row" role="listitem" data-plug="' + k + '"><button type="button" class="lmd-plg-pick" data-plug-pick="' + k + '" aria-controls="lmd-tl-side" aria-current="false"><span>' + esc(T(LMD.PLUGIN_LABELS[k])) + '</span>' + ICON.chevron + '</button>' +
      '<label class="lmd-switch"><input type="checkbox" data-plugin="' + k + '" aria-label="' + esc(T(LMD.PLUGIN_LABELS[k])) + '"' + (s.plugins[k] ? ' checked' : '') + '><i></i></label></div>';
    const plugKeys = Object.keys(LMD.PLUGIN_LABELS);
    const plugGroups = LMD.PLUGIN_GROUPS.map((g) => [g[0], g[1].filter((k) => plugKeys.includes(k))]);
    plugGroups[plugGroups.length - 1][1].push(...plugKeys.filter((k) => !plugGroups.some((g) => g[1].includes(k))));
    const plugins = plugGroups.filter((g) => g[1].length).map((g) => '<div class="lmd-plug-group" role="list" aria-label="' + esc(T(g[0])) + '"><h4>' + esc(T(g[0])) + '</h4>' + g[1].map(plugRow).join('') + '</div>').join('');
    const fonts = LMD.FONTS.slice();
    if (s.fontFamily && !fonts.some((f) => f.value === s.fontFamily)) fonts.push({ name: s.fontFamily, value: s.fontFamily });
    const fontOptions = fonts.map((f) => '<option value="' + esc(f.value) + '"' + (f.value === (s.fontFamily || '') ? ' selected' : '') + '>' + esc(f.value ? f.name : T(f.name)) + '</option>').join('');
    const PREVIEW = '<div class="lmd-preview" aria-hidden="true"><small>' + T('Vista previa') + '</small>' +
      '<div class="lmd-prev-text"><b>' + T('Notas de lanzamiento') + '</b><p>' + T('Así se ve el texto de tus documentos con esta letra, este tamaño y este interlineado.') + '</p></div>' +
      '<pre class="lmd-prev-code"><code><span class="k">const</span> items = [<span class="n">12</span>, <span class="n">30</span>, <span class="n">8</span>];\n<span class="k">const</span> total = <span class="f">sum</span>(items);\nconsole.<span class="f">log</span>(total);</code></pre>' +
      '<svg class="lmd-prev-dgm" viewBox="0 0 150 132"><rect class="node" x="6" y="4" width="84" height="36"/><rect class="node" x="60" y="92" width="84" height="36"/><path class="curve" d="M48 40 C 48 70, 102 58, 102 85"/><path class="line" d="M48 40 V 64 H 102 V 85"/><path class="tip" d="M97 84 h10 l-5 8z"/><text x="48" y="27">A</text><text x="102" y="115">B</text></svg>' +
    '</div>';
    ui.panel.innerHTML =
      '<div class="lmd-panel-card" role="dialog" aria-modal="true" aria-label="' + T('Ajustes') + '">' +
        '<header><h2>' + T('Ajustes') + '</h2><button class="lmd-icon-btn" data-act="close-panel" title="' + T('Cerrar') + '" aria-label="' + T('Cerrar') + '">' + ICON.close + '</button></header>' +
        '<nav class="lmd-ptabs" role="tablist">' +
          PANEL_TABS.filter((t) => !guestTabs || guestTabs.includes(t[0])).map((t) => '<button type="button" role="tab" data-ptab="' + t[0] + '">' + t[2] + '<span>' + (t[3] && LMD.lang() === 'es' ? t[3] : T(t[1])) + '</span></button>').join('') +
          '<button type="button" class="lmd-ptabs-foot" data-act="feedback">' + ICON.mail + '<span>' + T('Enviar comentarios') + '</span></button>' +
          '<a class="lmd-ptabs-link" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">' + ICON.coffee + '<span>' + T('Apoyar el proyecto') + '</span></a>' +
          '<small class="lmd-ptabs-ver">SharpMD ' + LMD.VERSION + '</small>' +
        '</nav>' +
        // Sobre un .md de un sitio no hay cuenta: lo dice una sola franja, igual en las pestañas que la piden.
        '<div class="lmd-panel-body">' +
        (NO_ACCT ? '<div class="lmd-direct" data-direct hidden><p>' + T('Tu cuenta, la nube y tu IA están en la app.') + ' <span data-direct-who></span></p>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-direct-go>' + T('Abrir la app') + '</button></div>' : '') +
          // Tres niveles: esto es personal. Lo del equipo lo decide quien lo administra y está en Plan; las opciones
          // de una nota sola, en el menú de esa nota.
          '<section class="lmd-two" data-tab="look"><h3>' + T('Apariencia') + '</h3>' +
            '<p class="lmd-hint lmd-scope">' + T('Estos ajustes son tuyos. Nadie más los ve ni los cambia.') + '</p>' +
            '<div class="lmd-row lmd-row-mode"><span>' + T('Tema') + ' <em class="lmd-mode-hint">' + T('Automático sigue al dispositivo') + '</em></span><div class="lmd-seg" data-seg="theme" role="radiogroup" aria-label="' + T('Tema') + '">' +
              ['auto', 'light', 'dark'].map((t) => '<button type="button" role="radio" data-val="' + t + '" aria-checked="' + (s.theme === t) + '"' + (s.theme === t ? ' class="lmd-on"' : '') + '>' + T({ auto: 'Automático', light: 'Claro', dark: 'Oscuro' }[t]) + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Idioma') + '</span><div class="lmd-seg" data-seg="language" role="radiogroup">' +
              ['auto', 'es', 'en'].map((l) => '<button type="button" role="radio" data-val="' + l + '" aria-checked="' + (s.language === l) + '"' + (s.language === l ? ' class="lmd-on"' : '') + '>' + { auto: T('Automático'), es: 'Español', en: 'English' }[l] + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-pcol"><div class="lmd-row"><span>' + T('Color de acento') + '</span><div class="lmd-swatches">' +
              LMD.ACCENTS.map((a) => '<button type="button" class="lmd-swatch' + ((s.accent || '') === a.value ? ' lmd-on' : '') + (a.value ? '' : ' lmd-swatch-auto') + '" data-accent="' + a.value + '" title="' + esc(T(a.name)) + '" aria-label="' + esc(T(a.name)) + '"' + (a.value ? ' style="--sw:' + a.value + '"' : '') + '></button>').join('') +
              '<label class="lmd-swatch lmd-swatch-custom' + (s.accent && !LMD.ACCENTS.some((a) => a.value === s.accent) ? ' lmd-on' : '') + '" title="' + T('Otro color') + '"><input type="color" data-accent-custom value="' + (/^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6c7ee1') + '"></label>' +
            '</div>' +
            '</div>' +
            '<label class="lmd-row"><span>' + T('Tipografía') + '</span><select data-key="fontFamily">' + fontOptions + '</select></label>' +
            '<label class="lmd-row"><span>' + T('Tamaño de letra') + ' <output>' + s.fontSize + ' px</output></span><input type="range" min="12" max="24" step="1" data-key="fontSize" data-unit=" px" value="' + s.fontSize + '"></label>' +
            '<label class="lmd-row"><span>' + T('Interlineado') + ' <output>' + s.lineHeight + '</output></span><input type="range" min="1.2" max="2.2" step="0.05" data-key="lineHeight" data-unit="" value="' + s.lineHeight + '"></label>' +
            '<div class="lmd-row"><span>' + T('Color de los bloques de código') + '</span><div class="lmd-swatches">' +
              LMD.CODE_COLORS.map((c) => '<button type="button" class="lmd-swatch' + ((s.codeColor || '') === c.value ? ' lmd-on' : '') + (c.value ? '' : ' lmd-swatch-auto') + '" data-code-color="' + c.value + '" title="' + T(c.name) + '"' + (c.value ? ' style="--sw:' + c.value + '"' : '') + '></button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Forma de los diagramas') + '</span><div class="lmd-seg" data-seg="diagramShape" role="radiogroup">' +
              [['round', 'Redondeados'], ['square', 'Rectos']].map((o) => '<button type="button" role="radio" data-val="' + o[0] + '" aria-checked="' + ((s.diagramShape || 'round') === o[0]) + '"' + ((s.diagramShape || 'round') === o[0] ? ' class="lmd-on"' : '') + '>' + T(o[1]) + '</button>').join('') +
            '</div></div>' +
            '</div>' +
            '<div class="lmd-pcol lmd-look-side"><div class="lmd-themes" data-themes>' +
              '<div class="lmd-themes-head"><span>' + T('Temas') + '</span><em class="lmd-th-custom" hidden>' + T('Personalizado') + '</em><small class="lmd-th-note"></small>' +
                '<button type="button" class="lmd-btn lmd-btn-fill" data-th-apply hidden>' + T('Aplicar') + '</button></div>' +
              '<div class="lmd-th-grid" role="radiogroup" aria-label="' + T('Temas') + '">' +
                LMD.theme.PRESETS.map((p) => '<button type="button" role="radio" class="lmd-th" data-th="' + p.id + '" aria-checked="false" aria-label="' + esc(T(p.name)) + '" title="' + esc(T(p.name) + ' · ' + T(p.dark ? 'Oscuro' : 'Claro')) + '">' +
                  LMD.theme.thumb(Object.assign({}, p, { name: esc(T(p.name)) })) + '</button>').join('') +
              '</div></div>' + PREVIEW + '</div>' +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Lectura') + '</h3>' +
            '<p class="lmd-hint lmd-scope">' + T('Estos ajustes son tuyos. Nadie más los ve ni los cambia.') + ' ' + T('El ancho y otras opciones de una nota se cambian desde el menú de la nota.') +
              (APP && LMD.cloud.teamNow() ? ' ' + T('Lo que vale para todo el equipo está en Plan, en Ajustes del equipo.') : '') + '</p>' +
            '<label class="lmd-check"><input type="checkbox" data-key="centered"' + (s.centered ? ' checked' : '') + '><span>' + T('Centrar el contenido') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Ancho del contenido') + ' <output>' + s.contentWidth + ' px</output></span><input type="range" min="560" max="1800" step="20" data-key="contentWidth" data-unit=" px" value="' + s.contentWidth + '"></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="wrapCode"' + (s.wrapCode ? ' checked' : '') + '><span>' + T('Ajustar las líneas largas del código') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="rememberPosition"' + (s.rememberPosition ? ' checked' : '') + '><span>' + T('Recordar por dónde iba en cada archivo') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="foldHeadings"' + (s.foldHeadings ? ' checked' : '') + '><span>' + T('Plegar secciones por título') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autoRefresh"' + (s.autoRefresh ? ' checked' : '') + '><span>' + T('Recargar solo cuando el archivo cambia') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Revisar cada') + ' <output>' + s.refreshInterval + ' ms</output></span><input type="range" min="300" max="5000" step="100" data-key="refreshInterval" data-unit=" ms" value="' + s.refreshInterval + '"></label>' +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Edición') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autosave"' + (s.autosave ? ' checked' : '') + '><span>' + T('Guardar solo mientras edito') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Guardar a los') + ' <output>' + s.autosaveDelay + ' ms</output></span><input type="range" min="1000" max="30000" step="500" data-key="autosaveDelay" data-unit=" ms" value="' + s.autosaveDelay + '"></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="focusMode"' + (s.focusMode ? ' checked' : '') + '><span>' + T('Modo foco: atenuar lo que no estoy escribiendo') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="typewriter"' + (s.typewriter ? ' checked' : '') + '><span>' + T('Máquina de escribir: mantener el renglón a media altura') + '</span></label>' +
            '<div class="lmd-row"><span>' + T('Calidad de las imágenes') + '</span><div class="lmd-seg" data-seg="imageQuality" role="radiogroup">' +
              [['normal', 'Normal'], ['high', 'Alta'], ['original', 'Original']].map((o) => '<button type="button" role="radio" data-val="' + o[0] + '" aria-checked="' + ((s.imageQuality || 'normal') === o[0]) + '"' + ((s.imageQuality || 'normal') === o[0] ? ' class="lmd-on"' : '') + '>' + T(o[1]) + '</button>').join('') +
            '</div></div>' +
            '<p class="lmd-hint">' + T('Al insertar una imagen se achica y se le quitan los metadatos, como la ubicación. Con Original queda como es.') + '</p>' +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Carpeta') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesOnlyMarkdown"' + (s.filesOnlyMarkdown ? ' checked' : '') + '><span>' + T('Mostrar solo archivos Markdown') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesShowHidden"' + (s.filesShowHidden ? ' checked' : '') + '><span>' + T('Mostrar archivos y carpetas ocultos') + '</span></label>' +
          '</section>' +
          '<section data-tab="plug"><h3>' + T('Plugins de Markdown') + '</h3><div class="lmd-plug">' + plugins + '</div></section>' +
          '<section data-tab="tools"><h3>' + T('Herramientas') + '</h3><div class="lmd-acct lmd-tl" data-tools-pane></div></section>' +
          // Nube, IA y Plan los dibuja sync.js al entrar a cada pestaña, con la cuenta recién consultada.
          // El renglón de almacenamiento de imágenes, arriba a la derecha, lo dibuja images.js.
          '<section data-tab="cloud"><h3>' + T('Nube') + '</h3><div class="lmd-acct" data-acct="cloud"></div></section>' +
          '<section data-tab="ai"><h3>' + T('IA (MCP)') + '</h3><div class="lmd-acct" data-acct="ai"></div></section>' +
          '<section data-tab="auto"><h3>' + T('API y automatizaciones') + '</h3><div class="lmd-acct lmd-au-pane" data-auto-pane></div></section>' +
          '<section data-tab="plan"><h3>' + T('Plan') + '</h3><div class="lmd-acct" data-acct="plan"></div></section>' +
          '<section data-tab="inst"><h3>' + T('Instalar') + '</h3><div class="lmd-acct lmd-inst" data-inst-pane></div></section>' +
          '<section data-tab="adv"><h3>' + T('CSS propio') + (s.supporter ? '' : EXTRA) + '</h3>' +
            // Sin el plan pago el campo no se edita. Si ya había CSS guardado se deja leer, se sigue aplicando y se puede quitar.
            '<textarea data-key="customCSS"' + (s.supporter ? '' : s.customCSS ? ' readonly' : ' disabled') + ' spellcheck="false" placeholder=".markdown-body h1 { color: tomato; }">' + esc(s.customCSS) + '</textarea>' +
            '<p class="lmd-hint">' + T('Se aplica encima del tema. El documento vive dentro de .markdown-body.') + '</p>' +
            (s.supporter ? '' : '<div class="lmd-extra"><p>' + T(s.customCSS ? 'Editar el CSS propio viene con el plan pago. El que ya tenías se sigue aplicando.' : 'El CSS propio viene con el plan pago.') + '</p>' +
                '<div class="lmd-extra-actions">' + (s.customCSS ? '<button type="button" class="lmd-btn" data-act="css-clear">' + T('Quitar el CSS') + '</button>' : '') +
                '<button type="button" class="lmd-btn lmd-btn-fill" data-act="see-plans">' + T('Ver planes') + '</button></div></div>') +
          '</section>' +
          // Vacío usa el servidor de SharpMD; una dirección, el propio; "off" deja la app sin nube.
          '<section class="lmd-two" data-tab="adv"><h3>' + T('Servidor') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-server="own"' + (own ? ' checked' : '') + '><span>' + T('Uso mi propio servidor') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-server="off"' + (noCloud ? ' checked' : '') + '><span>' + T('Usar SharpMD sin nube') + '</span></label>' +
            '<label class="lmd-row lmd-server-url"' + (own ? '' : ' hidden') + '><span>' + T('Dirección del servidor') + '</span><input type="text" data-server="url" spellcheck="false" placeholder="https://" value="' + (own ? esc(s.cloudUrl) : '') + '"></label>' +
          '</section>' +
          // Los conteos anónimos salen solo de la app web (count.js): en la extensión no hay nada que apagar.
          (window.__MDT_WEB === true ? '<section data-tab="adv"><h3>' + T('Conteos de uso') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="usageCounts"' + (s.usageCounts !== false ? ' checked' : '') + '><span>' + T('Mandar conteos de uso anónimos') + '</span></label>' +
            '<p class="lmd-hint">' + T('Se manda el nombre de un evento (la app se abrió, una primera nota, una primera edición) y el canal por el que llegaste, como "reddit". Sin cookie ni identificador, y nada de tus notas. Los archivos abiertos desde tu disco con la extensión no mandan nada.') + '</p>' +
          '</section>' : '') +
          (chrome.runtime.getManifest().update_url ? '' :
          '<section class="lmd-two" data-tab="adv"><h3>' + T('Actualizaciones') + '</h3>' +
            '<div class="lmd-row"><span>' + T('Buscar versiones nuevas') + '</span><div class="lmd-seg" data-seg="updateCheck" role="radiogroup">' +
              [['daily', 'Por día'], ['weekly', 'Por semana'], ['off', 'Nunca']].map((o) => '<button type="button" role="radio" data-val="' + o[0] + '" aria-checked="' + (s.updateCheck === o[0]) + '"' + (s.updateCheck === o[0] ? ' class="lmd-on"' : '') + '>' + T(o[1]) + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row lmd-row-line"><span>' + T('Versión instalada: {v}', { v: LMD.VERSION }) + '</span><button type="button" class="lmd-btn" data-act="check-update">' + T('Buscar ahora') + '</button></div>' +
            '<p class="lmd-update-msg" role="status" hidden></p>' +
            '<p class="lmd-hint">' + T('Lo único que se consulta es el número de versión publicado en GitHub. No se manda ningún dato.') + '</p>' +
          '</section>') +
          // Al pie de Avanzado, junto a restablecer: la hoja de atajos de teclado, sin sumar una sección.
          '<section class="lmd-panel-foot" data-tab="adv"><button type="button" class="lmd-btn" data-act="reset">' + T('Restablecer todo') + '</button> <button type="button" class="lmd-btn" data-act="shortcuts">' + ICON.keyboard + '<span>' + T('Atajos de teclado') + '</span></button></section>' +
        '</div>' +
      '</div>';
    ui.panel.hidden = false;
    // Desde los paneles de la cuenta: cómo cambiar de pestaña, ir a entrar, y salir a pagar sin perder lo escrito.
    const host = {
      tab: (t) => showTab(t), close: () => closePanel(),
      // En la app, y sobre un archivo del disco, se entra en Ajustes → Nube. Sobre un .md de un sitio se abre la app con el correo ya pedido.
      login: () => { if (APP) location.href = APP_URL + '?login=1'; else bg({ type: 'openApp', query: '?login=1' }); },
      leave: () => (dirty ? save(false) : Promise.resolve(true)),
      back: location.href.split('#')[0], appUrl: APP_URL, direct: NO_ACCT,
      // Sobre un archivo abierto directo: la app en una pestaña nueva, la web o la página de la extensión según "Abrir SharpMD en".
      openApp: (at) => bg({ type: 'openApp', pref: true, query: at }),
      // Las personalizaciones vienen con el plan pago y se conservan.
      unlocked: (a) => { if (a.plan === 'pro' && !settings.supporter) { panelStale = true; LMD.patch({ supporter: true }); } },
    };
    const showTab = (tab) => {
      panelTab = tab;
      LMD.tools.leave(); // el detalle de una herramienta no sigue a la vista sobre otra pestaña
      ui.panel.querySelectorAll('[data-ptab]').forEach((b) => { b.classList.toggle('lmd-on', b.dataset.ptab === tab); b.setAttribute('aria-selected', String(b.dataset.ptab === tab)); });
      // En pantalla chica las pestañas son una fila que se desliza: la elegida queda a la vista.
      const on = ui.panel.querySelector('[data-ptab].lmd-on'); if (on && LMD.touch.small()) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      ui.panel.querySelectorAll('.lmd-panel-body > section').forEach((sec) => { sec.hidden = sec.dataset.tab !== tab; });
      const strip = ui.panel.querySelector('[data-direct]'); if (strip) strip.hidden = !DIRECT_TABS.includes(tab);
      if (tab !== 'look' && (themePreview || themePicked)) { themePreview = ''; themePicked = ''; paintTheme(); markThemes(); }
      ui.panel.querySelector('.lmd-panel-body').scrollTop = 0;
      const acct = ui.panel.querySelector('[data-acct=' + tab + ']');
      if (acct) LMD.sync.panes[tab](acct, host);
      if (tab === 'inst') LMD.install.pane(ui.panel.querySelector('[data-inst-pane]'));
      if (tab === 'tools') LMD.tools.pane(ui.panel.querySelector('[data-tools-pane]'));
      if (tab === 'plug') plugPane(ui.panel.querySelector('[data-tab=plug] .lmd-plug'));
      if (tab === 'auto') { const pane = ui.panel.querySelector('[data-auto-pane]'); ensure('automate').then((ok) => { if (ok && pane.isConnected) LMD.automate.pane(pane, host); }); }
    };
    ui.panel.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ptab)));
    const strip = ui.panel.querySelector('[data-direct]');
    if (strip) {
      strip.querySelector('[data-direct-go]').addEventListener('click', openInApp);
      // La página de la extensión guarda su sesión donde este lector la puede ver: si la app se abre ahí y hay una,
      // se dice de quién es. La sesión de la web es otra y desde acá no se ve.
      LMD.cloud.ready().then(() => { const who = settings.openIn === 'ext' && LMD.cloud.signedIn() && !LMD.cloud.guest() ? LMD.cloud.email() : ''; if (who && strip.isConnected) strip.querySelector('[data-direct-who]').textContent = T('Sesión iniciada como {a} en la app.', { a: who }); }, () => {});
    }
    showTab(panelTab);

    let pending = {};
    const flush = debounce(() => { const p = pending; pending = {}; LMD.patch(p); }, 150);
    const commit = (partial) => { Object.assign(pending, partial); flush(); };

    ui.panel.querySelectorAll('.lmd-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        const seg = b.parentNode;
        seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('lmd-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        // El tema: con claro u oscuro a mano vuelve el último tema de esa familia.
        LMD.patch(seg.dataset.seg === 'theme' ? LMD.theme.modePatch(settings, b.dataset.val) : { [seg.dataset.seg]: b.dataset.val });
      });
    });
    // Temas: pasar por encima o enfocar muestra el tema en toda la app; tocar lo deja elegido, y Aplicar lo guarda.
    const thGrid = ui.panel.querySelector('.lmd-th-grid');
    const lookAt = (id) => { const next = id || themePicked; if (next === themePreview) return; themePreview = next; paintTheme(); };
    thGrid.querySelectorAll('[data-th]').forEach((b) => {
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') lookAt(b.dataset.th); });
      b.addEventListener('focus', () => { if (b.matches(':focus-visible')) lookAt(b.dataset.th); });
      b.addEventListener('blur', () => lookAt(''));
      b.addEventListener('click', () => {
        const now = LMD.theme.active(settings);
        themePicked = b.dataset.th === now.id && !now.custom ? '' : b.dataset.th;
        themePreview = themePicked; paintTheme(); markThemes();
      });
    });
    thGrid.addEventListener('pointerleave', () => lookAt(''));
    thGrid.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      const all = Array.from(thGrid.querySelectorAll('[data-th]')); const i = all.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); all[(i + d + all.length) % all.length].focus();
    });
    ui.panel.querySelector('[data-th-apply]').addEventListener('click', () => {
      const id = themePicked; if (!id) return;
      themePicked = ''; themePreview = ''; panelStale = true;
      if (LMD.community) LMD.community.setTheme(null); // un tema de la comunidad que estuviera puesto deja de estarlo
      LMD.patch(LMD.theme.patchFor(id)).then(() => flash(T('Tema aplicado')));
    });
    markThemes();
    const markSwatch = (node) => ui.panel.querySelectorAll('.lmd-swatch:not([data-code-color])').forEach((x) => x.classList.toggle('lmd-on', x === node));
    ui.panel.querySelectorAll('[data-code-color]').forEach((b) => {
      b.addEventListener('click', () => {
        ui.panel.querySelectorAll('[data-code-color]').forEach((x) => x.classList.toggle('lmd-on', x === b));
        LMD.patch({ codeColor: b.dataset.codeColor });
      });
    });
    ui.panel.querySelectorAll('[data-accent]').forEach((b) => {
      b.addEventListener('click', () => { markSwatch(b); LMD.patch({ accent: b.dataset.accent }); });
    });
    const custom = ui.panel.querySelector('[data-accent-custom]');
    custom.addEventListener('input', () => {
      markSwatch(custom.parentNode);
      settings.accent = custom.value; applySettings();
      commit({ accent: custom.value });
    });
    ui.panel.querySelectorAll('[data-key]').forEach((input) => {
      const key = input.dataset.key;
      const read = () => input.type === 'checkbox' ? input.checked : (input.type === 'range' ? parseFloat(input.value) : input.value);
      input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => {
        const v = read();
        if (input.type === 'range') {
          const out = input.closest('label').querySelector('output');
          if (out) out.textContent = v + (input.dataset.unit || '');
          settings[key] = v; applySettings(); // respuesta inmediata al arrastrar
        }
        if (key === 'fontFamily') { settings[key] = v; applySettings(); }
        commit({ [key]: v });
      });
    });
    ui.panel.querySelectorAll('[data-plugin]').forEach((input) => {
      input.addEventListener('change', () => LMD.patch({ plugins: { [input.dataset.plugin]: input.checked } }));
    });
    // Servidor: los dos interruptores se excluyen. La dirección se guarda al terminar de escribirla.
    const server = (name) => ui.panel.querySelector('[data-server=' + name + ']');
    const urlRow = ui.panel.querySelector('.lmd-server-url');
    server('own').addEventListener('change', () => {
      serverDraft = server('own').checked; urlRow.hidden = !serverDraft;
      if (serverDraft) { server('off').checked = false; server('url').focus(); }
      LMD.patch({ cloudUrl: serverDraft ? server('url').value.trim() : '' });
    });
    server('off').addEventListener('change', () => {
      if (server('off').checked) { serverDraft = false; server('own').checked = false; urlRow.hidden = true; }
      LMD.patch({ cloudUrl: server('off').checked ? 'off' : '' });
    });
    server('url').addEventListener('change', () => { if (server('own').checked) LMD.patch({ cloudUrl: server('url').value.trim() }); });
    if (serverDraft && panelTab === 'adv' && !server('url').value) server('url').focus();
    ui.panel.onclick = (e) => { if (e.target === ui.panel) closePanel(); };
    // El teclado arranca adentro: al abrir (o al redibujar con el foco adentro) queda en la pestaña elegida.
    if (wasHidden || hadFocus) { const on = ui.panel.querySelector('[data-ptab].lmd-on'); if (on) on.focus({ preventScroll: true }); }
  }

  // ---------- Modo edición ----------
  // Se edita sobre el texto ya formateado: cada bloque (párrafo, título, ítem, celda) es editable
  // en el lugar y, al salir, se reescribe solo el Markdown de ese bloque. La sintaxis nunca se ve.
  let editMode = false;
  let dirty = false;
  let diskText = raw;
  let fileHandle = null;
  let srcLines = [];
  let fmOffset = 0;
  let eol = '\n';
  let needsRender = false;
  let autosaveTimer = null;
  let softTimer = null;
  let pendingCell = null;

  const BLOCKS_INSIDE = 'UL,OL,P,PRE,BLOCKQUOTE,DIV,TABLE,DL,DETAILS,H1,H2,H3,H4,H5,H6';

  // REGLA: mientras hay un elemento editable con foco dentro del artículo (un bloque, una celda, un bloque nuevo
  // o el cuadro de un bloque de código), nada lo reemplaza ni le saca el foco: ni un guardado, ni el sondeo de
  // cambios, ni un evento en vivo de la nube. Lo escrito se lleva al Markdown sin tocar ese nodo (flushTyping), y
  // lo que haya que redibujar o traer de afuera espera a que la persona salga. Quien agregue algo que corre solo
  // (un temporizador, un evento) pregunta primero por typingNode().
  // En una sesión en vivo lo de afuera no espera: se aplica ALREDEDOR de ese nodo (applyRemote, patchArticle). El
  // nodo sigue siendo el mismo y conserva el foco. Lo único que se le toca es el contenido, y solo si el cambio
  // ajeno cayó en ese mismo bloque y ahí no hay nada tecleado sin pasar al Markdown: entra el texto nuevo con el
  // cursor a la misma altura. Con algo a medio escribir, o a medio componer, tampoco eso.
  const typingNode = () => {
    const a = document.activeElement;
    return a && a !== ui.rawEdit && ui.article.contains(a) && (a.isContentEditable || a.classList.contains('lmd-src')) ? a : null;
  };
  let outside = false; // hay un cambio de afuera (disco o nube) esperando a que se suelte el bloque
  let saving = false; // hay una escritura propia en curso: lo que se relea en el medio no es un cambio de otro
  // Pasa al Markdown lo escrito en el elemento con foco, sin tocarlo.
  function flushTyping() {
    const a = typingNode();
    if (!a || !editMode || core.hold) return;
    if (a.classList.contains('lmd-src')) { if (a._flush) a._flush(); }
    else if (a.classList.contains('lmd-draft')) LMD.write.sync(a);
    else if (a.classList.contains('lmd-editable') && commitBlock(a)) a._typed = true;
  }

  function syncSource() {
    eol = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    srcLines = raw.split(/\r?\n/);
  }

  const rangeOf = (node, attr) => {
    const m = /^(\d+)-(\d+)$/.exec(node.getAttribute(attr || 'data-l') || '');
    return m ? [+m[1], +m[2]] : null;
  };

  // Lo que va antes del texto de un bloque: las citas, la sangría, la marca de lista y la casilla de una tarea.
  // Un ítem que estaba vacío ("-", "1." o "- [ ]") no trae el espacio que separa la marca del texto: se lo pone.
  // La casilla cuenta solo si el ítem se dibujó como tarea; si no, "[ ]" es parte del texto.
  const PREFIX_RE = /^((?:\s{0,3}>\s?)*\s*)(?:([-*+]|\d{1,9}[.)])(\s+|$)(?:(\[[ xX]\])(\s+|$))?)?/;
  function prefixOf(line, task) {
    const m = PREFIX_RE.exec(line);
    let out = m[1];
    if (m[2]) { out += m[2] + (m[3] || ' '); if (m[4] && task) out += m[4] + (m[5] || ' '); }
    return out;
  }

  function blockSource(elm) {
    const r = rangeOf(elm); if (!r) return null;
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const md = inlineMd(elm).replace(/\n+$/, '');
    const first = srcLines[s] || '';
    // El título de una sección desplegable: cambia solo la línea que la abre (fold.js).
    if (elm.classList.contains('lmd-sum-title')) { const out = LMD.fold ? LMD.fold.titleLines(elm, first) : null; return out ? { s, e, lines: out } : null; }
    if (/^H[1-6]$/.test(elm.tagName)) {
      const quote = /^((?:\s{0,3}>\s?)*)/.exec(first)[1];
      return { s, e, lines: [quote + '#'.repeat(+elm.tagName[1]) + ' ' + md.replace(/\n/g, ' ').trim()] };
    }
    const prefix = prefixOf(first, !!elm.closest('li.lmd-task-item'));
    const cont = prefix.replace(/[-*+]|\d{1,9}[.)]|\[[ xX]\]/g, (m) => ' '.repeat(m.length));
    const parts = md.split('\n');
    const out = parts.map((part, i) => (i === 0 ? prefix : cont) + part.trim() + (i < parts.length - 1 ? '\\' : ''));
    // El primer párrafo de un aviso ("> [!NOTE]") no muestra su marca: al guardar lo escrito, la marca se queda.
    // Sin esto, editar el texto de un aviso lo dejaba como una cita común.
    const mark = elm.closest('.lmd-alert') ? /^(?:\s{0,3}>\s?)+\s*(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])\s*(.*)$/i.exec(first) : null;
    if (mark) { if (mark[2].trim()) out[0] = prefix + mark[1] + ' ' + parts[0].trim() + (parts.length > 1 ? '\\' : ''); else out.unshift(first); }
    return { s, e, lines: out };
  }

  // Reemplaza líneas del fuente y corre los rangos de los bloques que vienen después, sin redibujar:
  // así el foco puede pasar a otro bloque sin perder el cursor.
  // Deshacer trabaja sobre el fuente completo: alcanza para volver atrás cualquier operación de bloques.
  const undoStack = [];
  const redoStack = [];
  function pushUndo() {
    if (undoStack[undoStack.length - 1] === raw) return;
    undoStack.push(raw);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0; // un cambio nuevo descarta lo que se podía rehacer
  }
  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(raw);
    raw = undoStack.pop(); syncSource(); markDirty(); render();
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(raw);
    raw = redoStack.pop(); syncSource(); markDirty(); render();
    return true;
  }

  // Inserta líneas sin redibujar: corre los bloques que vienen después y agranda los contenedores indicados.
  function insertLines(at, newLines, owners) {
    pushUndo();
    srcLines.splice(at, 0, ...newLines);
    raw = srcLines.join(eol);
    const rel = at - fmOffset; const n = newLines.length;
    ui.article.querySelectorAll('[data-l], [data-p]').forEach((node) => {
      ['data-l', 'data-p'].forEach((a) => {
        const r = rangeOf(node, a); if (!r) return;
        if (r[0] >= rel) node.setAttribute(a, (r[0] + n) + '-' + (r[1] + n));
        else if (r[1] > rel || (r[1] === rel && owners && owners.indexOf(node) !== -1)) node.setAttribute(a, r[0] + '-' + (r[1] + n));
      });
    });
    markDirty();
  }

  // Los números de la lista que ocupa esa línea, puestos al día dentro del cambio que se acaba de hacer (no suma
  // un paso de deshacer). No cambia la cantidad de líneas: lo dibujado sigue apuntando a las suyas.
  function tidyList(at) {
    const next = LMD.lists ? LMD.lists.renumber(srcLines, fmOffset, at) : null; if (!next) return false;
    srcLines = next; raw = srcLines.join(eol); markDirty();
    return true;
  }

  // Cambia líneas del fuente. Quien lo llama redibuja.
  function spliceLines(s, count, newLines) {
    pushUndo();
    srcLines.splice(s, count, ...newLines);
    raw = srcLines.join(eol);
    markDirty();
  }

  // Pasa al fuente lo editado en un bloque, si cambió.
  function commitBlock(node) {
    if (node._md == null || inlineMd(node) === node._md) return false;
    if (node.classList.contains('lmd-cell')) commitCell(node);
    else { const b = blockSource(node); if (b) replaceLines(b.s, b.e, b.lines, node, 'data-l'); }
    node._md = inlineMd(node);
    return true;
  }

  function replaceLines(s, e, newLines, owner, attr) {
    pushUndo();
    srcLines.splice(s, e - s, ...newLines);
    raw = srcLines.join(eol);
    const delta = newLines.length - (e - s);
    const rs = s - fmOffset; const re = e - fmOffset;
    if (delta) {
      ui.article.querySelectorAll('[data-l], [data-p]').forEach((n) => {
        ['data-l', 'data-p'].forEach((a) => {
          const r = rangeOf(n, a); if (!r || (n === owner && a === attr)) return;
          if (r[0] >= re) n.setAttribute(a, (r[0] + delta) + '-' + (r[1] + delta));
          else if (r[0] <= rs && r[1] >= re) n.setAttribute(a, r[0] + '-' + (r[1] + delta));
        });
      });
    }
    if (owner) owner.setAttribute(attr || 'data-l', rs + '-' + (rs + newLines.length));
    markDirty();
  }

  function markDirty() {
    dirty = raw !== diskText;
    // Un documento en memoria se va guardando en la sesión, para que recargar la pestaña no lo pierda.
    if (appRoot && appRoot.id === 'mem') { try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name: DOC_NAME, text: raw, disk: diskText })); } catch (e) { /* demasiado grande */ } }
    needsRender = true;
    if (editMode) rememberEdit(true);
    updateSaveState();
    clearTimeout(autosaveTimer);
    // Las notas del navegador se guardan solas, siempre.
    if (dirty && appRoot && appRoot.kind === 'local') { autosaveTimer = setTimeout(() => save(false), 600); return; }
    // En una sesión en vivo lo escrito sale enseguida: la pausa ya la puso el tecleo.
    if (dirty && appRoot && appRoot.kind === 'cloud') { if (cloudState !== 'error') cloudState = 'saving'; autosaveTimer = setTimeout(() => save(false), liveOn() ? 120 : 1500); return; }
    if (dirty && settings.autosave) {
      if (fileHandle) autosaveTimer = setTimeout(() => save(false), Math.max(500, settings.autosaveDelay | 0));
      else flash(T('Guardá una vez con Ctrl+S para activar el guardado automático'), 'warn');
    }
  }

  function updateSaveState() {
    if (LMD.sync) LMD.sync.paint();
    if (LMD.live) LMD.live.state();
    const root = document.documentElement;
    root.classList.toggle('lmd-dirty', dirty);
    root.classList.toggle('lmd-held', !!held);
    root.classList.toggle('lmd-editing', editMode);
    ui.main.querySelectorAll('.lmd-modeseg button').forEach((b) => {
      const on = (b.dataset.act === 'mode-edit') === editMode;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on));
    });
    ui.main.querySelector('[data-act=mode-read]').title = T('Ver') + ' · ' + T(editMode ? 'Guardar y volver a solo lectura' : 'Estás viendo el documento');
    ui.main.querySelector('[data-act=mode-edit]').title = T('Editar') + ' · ' + T(editMode ? 'Estás editando el documento' : 'Editar el documento');
    const state = ui.main.querySelector('.lmd-savestate');
    const local = !!appRoot && appRoot.kind === 'local';
    const cloud = !!appRoot && appRoot.kind === 'cloud';
    state.textContent = held ? T('Guardado en pausa: falta decidir un choque') : cloud ? T(cloudState === 'error' ? 'Sin conexión' : dirty ? 'Guardando…' : 'Guardado en la nube') : local ? T(dirty ? 'Guardando…' : 'Guardado en este navegador')
      : (dirty ? T('Cambios sin guardar') : (editMode ? T(settings.autosave ? 'Guardado · autoguardado activo' : 'Todo guardado') : ''));
    const save = ui.main.querySelector('[data-act=save]');
    save.hidden = !local && !editMode && !dirty;
    save.title = held ? T('Decidir qué queda y guardar (Ctrl+S)') : local ? T('Guardar como archivo en el disco (Ctrl+S)') : (dirty ? T('Guardar (Ctrl+S). Hay cambios sin guardar') : T('Guardar (Ctrl+S)'));
  }

  // El modo edición se recuerda por pestaña: recargar o pasar a otra nota no lo saca mientras se siga
  // editando. La marca vence sola a la media hora del último cambio.
  const EDIT_KEY = 'lmd-edit'; const EDIT_TTL = 30 * 60 * 1000;
  function rememberEdit(on) {
    try { if (on) sessionStorage.setItem(EDIT_KEY, String(Date.now())); else sessionStorage.removeItem(EDIT_KEY); } catch (e) { /* sin sesión */ }
  }
  const editRemembered = () => { try { const t = +sessionStorage.getItem(EDIT_KEY); return t > 0 && Date.now() - t < EDIT_TTL; } catch (e) { return false; } };

  function softRender() {
    clearTimeout(softTimer);
    softTimer = setTimeout(() => {
      const a = document.activeElement;
      // Con el selector de enlaces abierto tampoco: el bloque donde va el enlace tiene que seguir ahí.
      if (!needsRender || core.hold || typingNode() || (a && (a.isContentEditable || a.classList.contains('lmd-src')))) return;
      render();
    }, 350);
  }

  // auto: la app entra sola en edición (se venía editando, o la nota está vacía). Ahí, sin permiso para guardar en
  // la carpeta, no se pregunta nada: la nota queda leyendo. Con el clic de la persona, primero va el aviso.
  async function setEditMode(on, auto) {
    if (on && readOnly) { flash(T('Esta nota es de solo lectura'), 'warn'); return; }
    if (on && !editMode && !(await allowWrite('', !!auto))) return;
    // Salir de edición guarda lo pendiente. Si se cancela el guardado, los cambios quedan sin guardar.
    if (!on && editMode) {
      const a = document.activeElement;
      if (a && a.blur && (a.isContentEditable || a.classList.contains('lmd-src'))) a.blur();
      if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.split('\r\n').join('\n').split('\n').join(eol); syncSource(); dirty = raw !== diskText; }
      if (dirty) await save(true);
    }
    // Lo que no es Markdown se edita como texto, desde la vista de código.
    if (on && docKind() === 'image') { flash(T('Las imágenes no se editan acá'), 'warn'); return; }
    if (on && docKind() !== 'md') rawMode = true;
    editMode = on;
    if (!on) { ui.format.hidden = true; ui.tableBar.hidden = true; } // sin edición no hay nada que formatear
    rememberEdit(on);
    updateSaveState();
    render();
    applyRawMode();
    if (on) flash(T(LMD.touch.coarse() ? 'Modo edición: tocá un texto para cambiarlo' : 'Modo edición: hacé clic en un texto o una celda para cambiarlo'));
  }

  // Marca qué se puede editar después de cada render.
  function enableEditing(article) {
    const make = (node, attr) => {
      if (!roundTrips(node)) { node.classList.add('lmd-noedit'); node.title = T('Este bloque se edita desde la vista de código'); return; }
      node.contentEditable = 'true'; node.spellcheck = true; node.classList.add('lmd-editable');
      if (attr) node.dataset.attr = attr;
    };
    article.querySelectorAll('p[data-l], h1[data-l], h2[data-l], h3[data-l], h4[data-l], h5[data-l], h6[data-l]').forEach((n) => {
      if (n.closest('.lmd-alert-title, .lmd-box-title, .lmd-front, .footnotes')) return;
      make(n);
    });
    // Ítems de lista compactos: el texto vive directo en el <li>, a veces seguido de una sublista.
    article.querySelectorAll('li[data-p]').forEach((li) => {
      if (li.closest('.footnotes')) return;
      const span = el('span', { class: 'lmd-li-text' });
      span.setAttribute('data-l', li.getAttribute('data-p'));
      const nodes = [];
      for (const n of Array.from(li.childNodes)) {
        if (n.nodeType === 1 && n.matches(BLOCKS_INSIDE)) break;
        if (n.nodeType === 1 && n.tagName === 'INPUT') continue;
        nodes.push(n);
      }
      // Una tarea sin texto ("- [ ]", como las de las plantillas) queda con su casilla y un lugar donde escribir.
      if (!nodes.length) { const box = li.querySelector(':scope > input.lmd-task'); if (!box) return; box.after(span); span.dataset.ph = T('Tarea'); make(span); return; }
      li.insertBefore(span, nodes[0]);
      nodes.forEach((n) => span.appendChild(n));
      make(span);
    });
    // Un ítem vacío ("-" o "1." sin nada más) no trae párrafo adentro: se le da un lugar donde escribir.
    article.querySelectorAll('li[data-l]:not([data-p])').forEach((li) => {
      if (li.closest('.footnotes') || li.childNodes.length) return;
      const r = rangeOf(li); if (!r) return;
      const span = el('span', { class: 'lmd-li-text', 'data-l': r[0] + '-' + (r[0] + 1) });
      span.dataset.ph = T('Ítem nuevo');
      li.appendChild(span); make(span);
    });
    // El título de cada sección desplegable.
    if (LMD.fold) LMD.fold.editable(article, make);
    article.querySelectorAll('.lmd-math, .lmd-wiki').forEach((n) => { n.contentEditable = 'false'; });
    article.querySelectorAll('input.lmd-task').forEach((box) => { box.contentEditable = 'false'; });

    article.querySelectorAll('table[data-l]').forEach((table) => {
      const r = rangeOf(table); if (!r) return;
      const src = srcLines.slice(r[0] + fmOffset, r[1] + fmOffset);
      const rows = Array.from(table.rows);
      const simple = table.tHead && table.tHead.rows.length === 1 && src.length === rows.length + 1 && /^[\s|:>-]+$/.test(src[1] || '') &&
        !table.querySelector('[rowspan], [colspan]') && rows.every((tr) => tr.cells.length === rows[0].cells.length);
      if (!simple) { table.classList.add('lmd-noedit'); table.title = T('Esta tabla se edita desde la vista de código'); return; }
      rows.forEach((tr, ri) => Array.from(tr.cells).forEach((cell, ci) => {
        if (!roundTrips(cell)) return;
        cell.contentEditable = 'true'; cell.classList.add('lmd-editable', 'lmd-cell');
        cell.dataset.r = ri; cell.dataset.c = ci;
      }));
    });

    if (pendingCell) {
      const want = pendingCell; pendingCell = null;
      const table = Array.from(article.querySelectorAll('table[data-l]')).find((t) => rangeOf(t)[0] === want.line);
      const cell = table && table.rows[Math.min(want.r, table.rows.length - 1)] && table.rows[Math.min(want.r, table.rows.length - 1)].cells[Math.min(want.c, table.rows[0].cells.length - 1)];
      if (cell) { cell.focus(); const sel = getSelection(); sel.selectAllChildren(cell); sel.collapseToEnd(); }
    }
  }

  const splitRow = (line) => line.replace(/^\s*(?:>\s?)*/, '').trim().replace(/^\|/, '').replace(/(^|[^\\])\|\s*$/, '$1').split(/(?<!\\)\|/).map((c) => c.trim());
  // Una celda con fórmula muestra el resultado; al archivo va la fórmula, salvo mientras se la está editando.
  const cellMd = (cell) => (cell.dataset.formula && document.activeElement !== cell ? cell.dataset.formula : inlineMd(cell)).replace(/\n+$/, '').replace(/\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim();

  function tableContext(table) {
    const r = rangeOf(table);
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const indent = /^\s*(?:>\s?)*/.exec(srcLines[s] || '')[0];
    return { s, e, indent, row: (cells) => indent + '| ' + cells.join(' | ') + ' |' };
  }

  function commitCell(cell) {
    const table = cell.closest('table'); const ctx = tableContext(table);
    const ri = +cell.dataset.r;
    const line = ctx.s + (ri === 0 ? 0 : ri + 1);
    replaceLines(line, line + 1, [ctx.row(Array.from(cell.parentNode.cells).map(cellMd))], null);
  }

  function tableOp(op) {
    const cell = document.activeElement && document.activeElement.closest && document.activeElement.closest('td.lmd-cell, th.lmd-cell');
    if (!cell) return;
    const table = cell.closest('table'); const ctx = tableContext(table);
    const ri = +cell.dataset.r; const ci = +cell.dataset.c;
    const grid = Array.from(table.rows).map((tr) => Array.from(tr.cells).map(cellMd));
    const sep = splitRow(srcLines[ctx.s + 1]);
    let nr = ri; let nc = ci;
    if (op === 'row+') { grid.splice(Math.max(ri, 0) + 1, 0, grid[0].map(() => '')); nr = ri + 1; }
    if (op === 'row-') { if (ri === 0 || grid.length <= 2) return; grid.splice(ri, 1); nr = Math.min(ri, grid.length - 1); }
    if (op === 'col+') { grid.forEach((row) => row.splice(ci + 1, 0, '')); sep.splice(ci + 1, 0, '---'); nc = ci + 1; }
    if (op === 'total') {
      const made = LMD.board.totalsRow(grid);
      if (made.error) { flash(made.error, 'warn'); return; }
      grid.push(made.row); nr = grid.length - 1;
      flash(T('Fila de totales agregada. Cambiá =sum por =avg, =min, =max, =count o =median'));
    }
    if (op === 'col-') { if (grid[0].length <= 1) return; grid.forEach((row) => row.splice(ci, 1)); sep.splice(ci, 1); nc = Math.min(ci, grid[0].length - 1); }
    while (sep.length < grid[0].length) sep.push('---');
    sep.length = grid[0].length;
    const out = [ctx.row(grid[0]), ctx.row(sep)].concat(grid.slice(1).map(ctx.row));
    cell.blur();
    pendingCell = { line: rangeOf(table)[0], r: nr, c: nc };
    replaceLines(ctx.s, ctx.e, out, null);
    render();
  }

  function toggleTask(box) {
    const li = box.closest('li'); if (!li) return;
    const r = rangeOf(li, li.hasAttribute('data-p') ? 'data-p' : 'data-l') || rangeOf(li);
    if (!r) return;
    const i = r[0] + fmOffset;
    const next = (srcLines[i] || '').replace(/\[( |x|X)\]/, box.checked ? '[x]' : '[ ]');
    if (next !== srcLines[i]) replaceLines(i, i + 1, [next], null);
  }

  // Bloques de código: se edita el contenido, sin las cercas.
  function editCode(codeBox) {
    const code = codeBox.querySelector('code'); const r = code && rangeOf(code);
    if (!r || codeBox.querySelector('.lmd-src')) return;
    const holder = LMD.live ? LMD.live.heldBy(codeBox) : '';
    if (holder) { flash(T('{a} está escribiendo en este bloque', { a: holder }), 'warn'); return; }
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const fenced = /^\s*(`{3,}|~{3,})/.test(srcLines[s] || '');
    // Qué líneas del archivo edita el cuadro. Va en el nodo (ta._range): en una sesión en vivo, si otra persona
    // agrega o saca líneas más arriba, patchDoc las corre.
    const g = { from: fenced ? s + 1 : s, to: fenced ? e - 1 : e };
    const before = srcLines.slice(g.from, g.to);
    const ta = el('textarea', { class: 'lmd-src', spellcheck: 'false' });
    ta._range = g;
    ta.value = before.join('\n');
    ta.rows = Math.max(3, g.to - g.from + 1);
    codeBox.querySelector('pre').hidden = true;
    codeBox.appendChild(ta); ta.focus();
    let done = false;
    const finish = (apply) => {
      if (done) return; done = true;
      clearTimeout(typed);
      if (apply) put(ta.value.split('\n')); else put(before);
      needsRender = true; ta.remove(); codeBox.querySelector('pre').hidden = false; render();
    };
    // Lo escrito pasa al Markdown tras una pausa, con el cuadro abierto y sin redibujar: así el guardado
    // automático lo ve aunque no se salga del bloque. Escape vuelve a lo que había.
    const put = (lines) => { if (lines.join('\n') !== srcLines.slice(g.from, g.to).join('\n')) { replaceLines(g.from, g.to, lines, null); g.to = g.from + lines.length; } };
    let typed = null;
    ta._flush = () => { if (!done) put(ta.value.split('\n')); };
    ta.addEventListener('input', () => { clearTimeout(typed); typed = setTimeout(ta._flush, typePause()); if (LMD.live) LMD.live.at(ta, true); });
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); }
    });
  }

  // Las líneas del archivo que ocupa un bloque o la fila de una celda, ahora.
  function sourceOf(node) {
    if (node.classList.contains('lmd-draft')) return null;
    if (node.classList.contains('lmd-cell')) {
      const table = node.closest('table'); if (!table || !rangeOf(table)) return null;
      const ri = +node.dataset.r; return { s: tableContext(table).s + (ri === 0 ? 0 : ri + 1), n: 1 };
    }
    const r = rangeOf(node); return r ? { s: r[0] + fmOffset, n: r[1] - r[0] } : null;
  }
  // Escape en un bloque: si lo escrito ya pasó al Markdown (tras una pausa), se vuelve a poner lo que había al entrar.
  function revertBlock(node) {
    const at = node._was && sourceOf(node); if (!at) return;
    if (srcLines.slice(at.s, at.s + at.n).join('\n') === node._was.join('\n')) return;
    if (node.classList.contains('lmd-cell')) replaceLines(at.s, at.s + at.n, node._was, null);
    else replaceLines(at.s, at.s + at.n, node._was, node, 'data-l');
  }

  // La barra de la tabla va al costado de la tabla si hay lugar; si no, debajo. Arriba taparía el título de la
  // sección. Nunca se monta sobre el pie ni sobre la barra de arriba: si debajo no entra, queda sobre el borde
  // de abajo de la zona de lectura, y si ahí taparía la celda que se escribe, pasa arriba de esa fila.
  function placeTableBar() {
    if (ui.tableBar.hidden || LMD.touch.dock()) return;
    const cell = document.activeElement && document.activeElement.closest && document.activeElement.closest('.lmd-cell');
    const table = cell && cell.closest('table'); if (!table) return;
    const box = table.getBoundingClientRect(); const row = cell.getBoundingClientRect();
    const w = ui.tableBar.offsetWidth || 300; const h = ui.tableBar.offsetHeight || 40;
    const foot = ui.main.querySelector('.lmd-foot').getBoundingClientRect(); const footTop = foot.height ? foot.top : window.innerHeight; // el pie es fijo: no tiene offsetParent
    const min = 64; const max = Math.max(min, footTop - h - 8);
    let left; let top;
    if (box.right + 12 + w < window.innerWidth - 8) { left = box.right + 12; top = Math.min(max, Math.max(min, box.top)); }
    else {
      left = Math.max(8, Math.min(window.innerWidth - w - 8, box.left)); top = Math.min(max, box.bottom + 8);
      if (top < row.bottom + 4 && top + h > row.top - 4) top = Math.max(min, row.top - h - 8);
    }
    ui.tableBar.style.left = left + 'px'; ui.tableBar.style.top = top + 'px';
  }

  // Barra de formato sobre la selección.
  function formatBar() {
    const sel = getSelection();
    const at = sel.rangeCount && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode);
    const host = at && at.closest('.lmd-editable');
    // Con el cursor apoyado en un enlace, sin seleccionar nada, la barra ofrece solo editarlo.
    const link = host && sel.isCollapsed ? at.closest('a:not(.lmd-wiki)') : null;
    // El título de una sección desplegable es texto sin formato.
    if (!editMode || !host || host.classList.contains('lmd-sum-title') || core.hold || (sel.isCollapsed && !(link && host.contains(link)))) { ui.format.hidden = true; LMD.touch.dock(); return; }
    const rect = (link || sel.getRangeAt(0)).getBoundingClientRect();
    ui.format.classList.toggle('lmd-format-link', !!link);
    ui.format.querySelector('[data-fmt=math]').hidden = !settings.plugins.katex;
    ui.format.hidden = false;
    // Con el dedo va pegada al borde de abajo de lo que se ve: arriba quedaría tapada por el menú de selección del sistema.
    if (LMD.touch.dock()) return;
    ui.format.style.top = Math.max(8, rect.top - 42) + 'px';
    ui.format.style.left = Math.max(8, Math.min(window.innerWidth - ui.format.offsetWidth - 8, link ? rect.left : rect.left + rect.width / 2 - ui.format.offsetWidth / 2)) + 'px';
  }

  function applyFormat(kind) {
    const sel = getSelection(); if (!sel.rangeCount) return;
    if (kind === 'bold') document.execCommand('bold');
    else if (kind === 'italic') document.execCommand('italic');
    else if (kind === 'strike') document.execCommand('strikeThrough');
    else if (kind === 'code') {
      const text = sel.toString(); if (!text) return;
      const code = document.createElement('code'); code.textContent = text;
      const range = sel.getRangeAt(0); range.deleteContents(); range.insertNode(code);
      sel.selectAllChildren(code);
    } else if (kind === 'link') {
      LMD.links.open();
    } else if (kind === 'math') {
      tools().then((ok) => { if (ok) LMD.formula.createInline(); });
    } else if (kind === 'clear') { document.execCommand('removeFormat'); document.execCommand('unlink'); }
  }

  // Deja el cursor en un bloque a tantos caracteres del comienzo; sin posición, al final.
  function caretAt(node, offset) {
    node.focus();
    const sel = getSelection();
    if (offset >= 0) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let n; let left = offset;
      while ((n = walker.nextNode())) { if (left <= n.nodeValue.length) { sel.collapse(n, left); return; } left -= n.nodeValue.length; }
    }
    sel.selectAllChildren(node); sel.collapseToEnd();
  }

  // Doble clic leyendo: pasa a edición con el cursor donde se hizo. Lo que ya responde al clic queda como está.
  const NO_DBL = 'a, img, button, input, .lmd-code, .lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz, .lmd-board, .lmd-math, .lmd-toc, .lmd-front';
  async function editAt(e) {
    if (readOnly || docKind() !== 'md') return;
    const cell = e.target.closest('td, th'); const table = cell && cell.closest('table[data-l]');
    const block = e.target.closest('[data-l]');
    const host = table ? cell : block;
    // En una lista compacta el texto editable lleva el rango del párrafo, que el <li> guarda en data-p.
    const key = table ? table.getAttribute('data-l') : block && (block.tagName === 'LI' && block.getAttribute('data-p') || block.getAttribute('data-l'));
    const where = table ? [cell.parentNode.rowIndex, cell.cellIndex] : null;
    let offset = -1;
    const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (at && host && host.contains(at.startContainer)) { const r = document.createRange(); r.selectNodeContents(host); r.setEnd(at.startContainer, at.startOffset); offset = r.toString().length; }
    await setEditMode(true);
    if (!editMode) return;
    // El mismo bloque, ya editable; si no lo es, el primero editable que tenga adentro.
    let node = null; let exact = true;
    if (where) { const made = ui.article.querySelector('table[data-l="' + key + '"]'); node = made && made.rows[where[0]] && made.rows[where[0]].cells[where[1]]; }
    else if (key) {
      node = ui.article.querySelector('.lmd-editable[data-l="' + key + '"]');
      if (!node) { const made = ui.article.querySelector('[data-l="' + key + '"]'); node = made && made.querySelector('.lmd-editable'); exact = false; }
    }
    if (node && node.isContentEditable) caretAt(node, exact ? offset : -1);
    else if (!raw.trim()) { const add = ui.article.querySelector('.lmd-add'); if (add) add.click(); }
  }

  // Cuánto se espera sin teclear para pasar lo escrito al Markdown. En una sesión en vivo, menos: los demás lo
  // ven aparecer mientras se escribe.
  const typePause = () => (liveOn() ? 500 : 1200);
  function bindEditing() {
    ui.article.addEventListener('compositionstart', () => { composing = true; });
    ui.article.addEventListener('compositionend', () => { composing = false; });
    // Sesión en vivo: los demás ven en qué bloque está cada uno, y en el que otro está escribiendo no se escribe.
    ui.article.addEventListener('focusin', (e) => { const n = e.target.closest && e.target.closest('.lmd-editable, .lmd-src'); if (n && LMD.live) LMD.live.at(n, false); });
    ui.article.addEventListener('focusout', () => { if (LMD.live) LMD.live.at(null, false); });
    ui.article.addEventListener('beforeinput', (e) => {
      const n = e.target.closest && e.target.closest('.lmd-editable, .lmd-src'); const holder = n && LMD.live ? LMD.live.heldBy(n) : '';
      if (holder && e.cancelable) { e.preventDefault(); flash(T('{a} está escribiendo en este bloque', { a: holder }), 'warn'); }
    });
    ui.article.addEventListener('focusin', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (node && node.dataset.formula) node.textContent = node.dataset.formula;
      if (node) {
        node._md = inlineMd(node); core.lastBlock = node;
        // Lo que el bloque tenía en el archivo al entrar: a eso vuelve Escape, aunque lo escrito ya haya pasado al Markdown.
        const at = sourceOf(node); node._was = at ? srcLines.slice(at.s, at.s + at.n) : null;
      }
      ui.tableBar.hidden = !(node && node.classList.contains('lmd-cell'));
      placeTableBar();
    });
    // La barra de la tabla acompaña a la tabla al mover la página.
    let barQueued = false;
    window.addEventListener('scroll', () => {
      if (ui.tableBar.hidden || barQueued) return;
      barQueued = true;
      requestAnimationFrame(() => { barQueued = false; placeTableBar(); });
    }, { passive: true });
    window.addEventListener('resize', placeTableBar);
    // Lo escrito pasa al Markdown tras una pausa, sin esperar a salir del bloque: si no, el guardado automático
    // no ve nada hasta que la persona hace clic en otro lado, y cerrar la pestaña a mitad de un párrafo lo pierde.
    let typeTimer = null;
    ui.article.addEventListener('input', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node || !editMode) return;
      clearTimeout(typeTimer);
      if (LMD.live) LMD.live.at(node, true);
      // Solo se reescribe el Markdown: el nodo con foco no se toca (una celda no recalcula ni redibuja la tabla
      // hasta que se sale de ella). Vale también para un bloque nuevo y para una celda con fórmula.
      typeTimer = setTimeout(() => {
        if (!editMode || !node.isConnected || core.hold) return;
        if (node.classList.contains('lmd-draft')) LMD.write.sync(node);
        else if (commitBlock(node)) node._typed = true;
        // El bloque cambió de texto: los demás siguen viendo la marca en el mismo lugar.
        if (LMD.live && document.activeElement === node) LMD.live.at(node, true);
      }, typePause());
    });
    ui.article.addEventListener('focusout', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node || !editMode) return;
      setTimeout(() => { const a = document.activeElement; if (!(a && a.classList && a.classList.contains('lmd-cell'))) ui.tableBar.hidden = true; }, 0);
      if (node.classList.contains('lmd-draft')) { LMD.write.blur(node); return; }
      // Lo que quedó escrito en una celda de cuentas pasa a ser su fórmula, o un valor común si dejó de serlo.
      if (node.dataset.formula) { const typed = node.textContent.trim(); if (LMD.board.formulaOf(typed)) node.dataset.formula = typed; else delete node.dataset.formula; }
      const typed = node._typed; node._typed = false;
      if (!commitBlock(node) && !typed) { if (node.dataset.formula) LMD.board.calcTables(node.closest('table').parentNode); return; }
      node._md = null;
      softRender();
    });
    // Al soltar el bloque se trae lo que cambió afuera mientras se escribía.
    ui.article.addEventListener('focusout', () => {
      if (outside) setTimeout(() => { if (outside && !typingNode()) { cloudPoll = 0; checkForChanges(false); } }, 450);
    });
    ui.article.addEventListener('keydown', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node) return;
      const draft = node.classList.contains('lmd-draft');
      // Enter cierra el bloque y abre uno nuevo debajo; en una celda solo la confirma.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (node.classList.contains('lmd-cell')) node.blur(); else LMD.write.enter(node); }
      else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
      else if (e.key === 'Tab' && node.classList.contains('lmd-cell') && !(e.ctrlKey || e.metaKey || e.altKey)) {
        // Tab pasa a la celda de al lado con su contenido elegido, como en una planilla: lo que se escribe la reemplaza.
        const cells = Array.from(node.closest('table').querySelectorAll('.lmd-cell')); const next = cells[cells.indexOf(node) + (e.shiftKey ? -1 : 1)];
        if (next) { e.preventDefault(); next.focus(); getSelection().selectAllChildren(next); }
      }
      else if (e.key === 'Escape') { e.preventDefault(); node._md = null; if (draft) LMD.write.drop(node); else revertBlock(node); node._typed = false; needsRender = true; node.blur(); render(); }
      else if (draft) LMD.write.onKey(e, node);
    });
    document.addEventListener('paste', (e) => {
      if (!editMode || !e.target.closest || e.target.closest('input, textarea')) return;
      if (docKind() === 'md' && LMD.extras.pasteImage(e)) return;
      if (!e.target.closest('.lmd-editable')) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\r?\n/g, ' '));
    });
    // Las tareas se tildan también leyendo; el cambio queda sin guardar hasta Ctrl+S (o se guarda solo, si está activado).
    ui.article.addEventListener('change', (e) => { if (docKind() === 'md' && e.target.matches && e.target.matches('input.lmd-task')) toggleTask(e.target); });
    ui.article.addEventListener('dblclick', (e) => {
      if (!editMode) { if (!e.target.closest(NO_DBL)) editAt(e); return; }
      const box = e.target.closest('.lmd-code');
      if (box) editCode(box);
    });
    ui.article.addEventListener('click', (e) => {
      if (editMode && e.target.closest('.lmd-editable a') && !(e.ctrlKey || e.metaKey)) e.preventDefault();
    }, true);
    document.addEventListener('selectionchange', debounce(formatBar, 60));
    ui.format.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-fmt]'); if (b) applyFormat(b.dataset.fmt); });
    ui.tableBar.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-top]'); if (b) tableOp(b.dataset.top); });
    ui.rawEdit.addEventListener('input', debounce(() => { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); markDirty(); }, 200));
    // Lo que ya quedó en la cola de la nube no se pierde al cerrar: no hace falta frenar la salida.
    // Lo que se venía escribiendo y todavía no pasó al Markdown (la pausa no llegó) pasa ahora: así cuenta como
    // cambio sin guardar y el navegador avisa antes de cerrar, en vez de perderlo sin decir nada.
    window.addEventListener('beforeunload', (e) => { flushTyping(); if (dirty && stashed !== raw) { e.preventDefault(); e.returnValue = ''; } });
    // Al pasar a otra pestaña o a otra app (en un teléfono no hay aviso de cierre) lo escrito se guarda en el momento,
    // en las notas que se guardan solas.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || !editMode || noDoc) return;
      flushTyping();
      if (dirty && appRoot && (appRoot.kind === 'local' || appRoot.kind === 'cloud')) { clearTimeout(autosaveTimer); save(false); }
    });
    // Versión nueva ya bajada: web.js guarda el aviso del service worker hasta que haya quien lo muestre.
    if (window.__MDT_FRESH) { window.__MDT_FRESH.show = freshNotice; freshNotice(window.__MDT_FRESH.got); }
    // El depósito cambió desde el otro lado (la web o la extensión): la lista se vuelve a leer.
    window.addEventListener('lmd-store-changed', () => { if (APP && ui.paneFiles.dataset.loaded) loadTree(); });
    window.addEventListener('online', () => {
      if (!appRoot || appRoot.kind !== 'cloud') return;
      if (dirty && cloudState === 'error') { clearTimeout(autosaveTimer); save(false); } else { cloudPoll = 0; checkForChanges(false); }
    });
  }

  // Lo que los módulos de edición (write.js y los que siguen) necesitan del lector.
  const core = {
    get shape() { return settings.diagramShape; },
    get cloudState() { return cloudState; },
    get readOnly() { return readOnly; },
    get present() { return present; }, get presentNames() { return presentNames; }, get hereAi() { return hereAi; }, get lastEdit() { return lastEdit; },
    get cloudPath() { return vParts(HERE).join('/'); },
    get dirty() { return dirty; },
    save: (interactive) => save(interactive),
    setEditMode: (on) => setEditMode(on),
    pathOf: (url) => vParts(url).join('/'),
    urlOf: (path) => VBASE + 'cloud/' + path.split('/').map(encodeURIComponent).join('/'),
    rootOf,
    // Abrir otra nota (por su dirección virtual) o quedarse sin ninguna, sin recargar la página.
    open: (url, opt) => go(url.slice(VBASE.length), opt),
    close: (opt) => go('', opt),
    // Un texto como nota nueva sin guardar: vive en la sesión hasta que se elige dónde guardarla (import.js).
    openText: (name, text) => { try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name, text, disk: '' })); } catch (e) { return Promise.resolve(false); } return go('mem/' + encodeURIComponent(name), { edit: 'doc' }); },
    get HERE() { return HERE; }, get docName() { return DOC_NAME; }, get noDoc() { return noDoc; },
    openApp: (query) => bg({ type: 'openApp', query }),
    openPanel: (tab, why) => openPanel(tab, why),
    // patch: se dibujó en el lugar un cambio de otra persona (sesión en vivo), sin pasar por render.
    ui, hooks: { render: [], tree: [], doc: [], patch: [], home: [], saved: [], diagram: [], event: [] }, menus: { export: [], more: [] }, actions: {},
    get treeRoot() { return treeRoot; }, collect: (root) => collectFiles(root), readFile: (url) => readFile(url), wikiKey, lastBlock: null, appUrl: APP_URL, hold: false,
    // Lo que la sesión en vivo (live.js) necesita del lector.
    live: {
      blockId, locate,
      // Abre la nota de la sesión para un invitado: en edición, sin ofrecer un bloque nuevo.
      open: (name) => go('cloud/' + encodeURIComponent(name), { edit: 'on', replace: true, boot: true }),
      // Sin nota: el inicio de siempre, con un aviso y sin el enlace en la dirección.
      home: (note) => { history.replaceState(null, '', APP_URL); showEmpty(note); loadTree(); },
      // La sesión terminó: lo escrito queda a la vista, sin poder seguir editando ni guardando.
      freeze: () => {
        flushTyping(); const a = document.activeElement; if (a && a.blur && ui.article.contains(a)) a.blur();
        clearTimeout(autosaveTimer); if (stopEvents) { stopEvents(); stopEvents = null; }
        readOnly = true; editMode = false; rememberEdit(false); document.documentElement.classList.add('lmd-readonly');
        ui.format.hidden = true; ui.tableBar.hidden = true; updateSaveState(); render(); applyRawMode();
      },
      // La nota como está acá, con lo que no llegó a enviarse.
      download: () => {
        flushTyping();
        LMD.kit.saveFile(new Blob([raw], { type: 'text/markdown' }), DOC_NAME || 'nota.md');
      },
      flush: async () => { flushTyping(); if (dirty) { clearTimeout(autosaveTimer); await save(false); } return !dirty; },
      typing: () => typingNode(),
    },
    editAt: (e) => editAt(e), copy: (text) => { copyText(text); flash(T('Copiado')); }, searchFor, sectionLink,
    links: { headings: () => anchorsOf(spyHeadings), headingsIn, files: linkFiles, read: readDoc, rel: relLink, find: findAnchor, same: sameUrl, prep: prepLinks, follow: followLink },
    get blocks() { return docKind() === 'md'; },
    // Dónde se crea desde la cabecera del explorador cuando hace falta una carpeta: la del disco, si hay una abierta.
    diskDir: () => (APP && diskRoot && diskRoot.kind === 'dir' ? treeRoot : ''),
    newNote: (opt) => LMD.home.create(homeCtx(), opt),
    pick: (what) => LMD.home.pick(homeCtx(), what),
    diskPath, canViewFolder, viewFolder, fsGrant: () => fsGrant(), allowWrite: (url) => allowWrite(url),
    pickTemplate: () => tools().then((ok) => (ok ? LMD.home.pickTemplate(homeCtx()) : null)),
    tools,
    showFiles,
    listDir: (url, all) => listDir(url, all), // lo que hay en una carpeta, como lo muestra el explorador ("Mover a…", extras.js); con all, sin filtrar
    // Lo que "Enviar a la nube" (send.js) necesita: si el explorador muestra la nube, el texto de un archivo tal como
    // está ahora (null si no se pudo leer), cómo entrar, y dejar una carpeta de la nube desplegada y a la vista.
    cloudTree: CLOUDY, signIn,
    readNow: async (url) => { if (APP) return vText(url); const r = await bg({ type: 'fetchText', url }); return r && r.ok && typeof r.text === 'string' ? r.text : null; },
    reveal: (url) => { let u = url; while (u.startsWith(VBASE + 'cloud/') && u !== VBASE + 'cloud/') { openDirs.add(u); u = new URL('..', u).href; } showFiles(sectionOf(url)); if (LMD.touch.small()) setDrawer(true); return loadTree(); },
    reloadTree: () => { fileCache.clear(); folderIndex.clear(); clearCounts(); wikiIndex = null; linkIndex = null; if (ui.searchInput.value.trim()) runSearch(ui.searchInput.value); const done = loadTree(); resumeCloud(); return done; },
    dirHandle: async (dirUrl) => { let dir = rootOf(dirUrl).handle; for (const p of vParts(dirUrl)) dir = await dir.getDirectoryHandle(p); return dir; }, APP, ensure, isDark, openInApp,
    get srcLines() { return srcLines; }, get fmOffset() { return fmOffset; }, get editMode() { return editMode; },
    get raw() { return raw; }, get settings() { return settings; }, get appRoot() { return appRoot; },
    drawOff, rangeOf, render, softRender, flash, insertLines, spliceLines, replaceLines, tidyList, commitBlock, undo, redo, editCode, vFile, toHref, openDoc,
    // Sobre un archivo abierto directo: abre otro de la carpeta en el lugar si SharpMD lo dibuja; si no, lo abre el navegador.
    openFile: (url) => { if (opensHere(url)) return goFile(url); location.href = url; return Promise.resolve(false); },
    inline: (text) => DOMPurify.sanitize(buildParser().renderInline(text)),
    // Un Markdown cualquiera, dibujado con el mismo saneado que una nota (la vista previa de una plantilla).
    preview: (text) => homeCtx().preview(text),
    setRaw(text) { pushUndo(); raw = text; syncSource(); markDirty(); render(); },
    // Varios cambios seguidos que para la persona son uno solo: un solo Ctrl+Z los deshace.
    oneUndo(fn) { const n = undoStack.length; try { return fn(); } finally { if (undoStack.length > n + 1) undoStack.length = n + 1; } },
    // Si hay algo para deshacer o rehacer: Ctrl+Z también vale leyendo, pero solo cuando hay qué volver atrás.
    canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0, get rawMode() { return rawMode; },
    // Las secciones plegadas en el índice lateral, por ancla.
    outlineShut: collapsed,
  };

  // ---------- Permiso para escribir ----------
  // Chrome no deja que una página escriba en el disco sin que la persona elija dónde. Para no
  // pedirlo en cada archivo, se pide una vez la CARPETA: con eso se guarda cualquier archivo de
  // adentro, y el permiso queda recordado para las próximas veces.
  const hereUrl = () => HERE;

  // Busca un permiso ya dado que sirva para este archivo: el del archivo mismo o el de una carpeta que lo contenga.
  async function storedHandle(ask) {
    if (APP) {
      // En la app el archivo ya viene con su permiso: a lo sumo Chrome pide confirmar la escritura.
      let h = null;
      try { h = await vFile(HERE); } catch (e) { /* ya no está */ }
      return h && await canWrite(h, ask) ? h : null;
    }
    const url = hereUrl();
    const recs = await handlesAll();
    const exact = recs.find((r) => r.kind === 'file' && r.key === url);
    if (exact && await canWrite(exact.handle, ask)) return exact.handle;
    const dirs = recs.filter((r) => r.kind === 'dir' && url.startsWith(r.key)).sort((a, b) => b.key.length - a.key.length);
    for (const r of dirs) {
      if (!(await canWrite(r.handle, ask))) continue;
      try { return await walk(r.handle, url.slice(r.key.length).split('/').map(decodeURIComponent)); } catch (e) { /* ya no está ahí */ }
    }
    return null;
  }

  // Dada una carpeta elegida, encuentra en ella el archivo abierto probando cuántos niveles hay entre las dos.
  async function findInFolder(dir) {
    const url = hereUrl();
    const segs = url.split('/');
    let weak = null;
    for (let k = 1; k <= Math.min(14, segs.length - 3); k++) {
      const parts = segs.slice(-k).map(decodeURIComponent);
      try {
        const fh = await walk(dir, parts);
        const text = await (await fh.getFile()).text();
        const found = { handle: fh, base: segs.slice(0, -k).join('/') + '/' };
        if (text === diskText || text === raw) return found;
        if (!weak) weak = found;
      } catch (e) { /* no está a esa profundidad */ }
    }
    if (weak && await LMD.dialog.confirm({ title: T('El contenido no coincide'), text: T('En esa carpeta hay un archivo con el mismo nombre, pero su contenido no coincide con el que tenés abierto.'), ok: T('Guardar sobre ese archivo') })) return weak;
    return null;
  }

  function askForAccess() {
    return new Promise((resolve) => {
      const name = DOC_NAME;
      // La carpeta del archivo, como la escribe el sistema: Chrome no deja abrir su ventana ya parada ahí,
      // así que se muestra y se copia para pegarla en la barra de direcciones de esa ventana.
      let folder = '';
      try { if (location.protocol === 'file:') { let d = decodeURIComponent(new URL(HERE).pathname).replace(/\/[^/]*$/, ''); if (/^\/[A-Za-z]:/.test(d)) d = d.slice(1).replace(/\//g, '\\'); folder = d; } } catch (e) { /* sin ruta */ }
      const copyFolder = () => { if (!folder) return; try { navigator.clipboard.writeText(folder).catch(() => {}); } catch (e) { /* sin portapapeles */ } };
      const box = el('div', { class: 'lmd-ask' });
      box.innerHTML =
        '<div class="lmd-ask-card" role="dialog" aria-label="' + T('Permiso para guardar') + '">' +
          '<h3>' + T('Permiso para guardar') + '</h3>' +
          '<p>' + T('El navegador pide que elijas dónde puede escribir SharpMD. Elegí la carpeta de este archivo una sola vez y vas a poder guardar todo lo que haya adentro, sin que vuelva a preguntar.') + '</p>' +
          (folder ? '<div class="lmd-ask-path"><code></code><button type="button" class="lmd-btn" data-ask="copy">' + T('Copiar') + '</button></div>' +
            '<p class="lmd-hint lmd-ask-path-hint">' + T('Es la carpeta de este archivo. Queda copiada: pegala en la barra de direcciones de la ventana que abre el navegador.') + '</p>' : '') +
          '<div class="lmd-ask-actions">' +
            '<button type="button" class="lmd-btn lmd-btn-fill" data-ask="dir">' + T('Elegir la carpeta') + '</button>' +
            '<button type="button" class="lmd-btn" data-ask="file">' + T('Solo este archivo') + '</button>' +
            '<button type="button" class="lmd-btn" data-ask="no" data-esc>' + T('Cancelar') + '</button>' +
          '</div>' +
        '</div>';
      if (folder) box.querySelector('.lmd-ask-path code').textContent = folder;
      document.body.appendChild(box);
      const close = (value) => { box.remove(); resolve(value); };
      box.addEventListener('click', async (e) => {
        if (e.target === box) return close(null);
        const b = e.target.closest('[data-ask]'); if (!b) return;
        if (b.dataset.ask === 'copy') { copyFolder(); b.textContent = T('Copiado'); return; }
        if (b.dataset.ask === 'dir' || b.dataset.ask === 'file') copyFolder();
        try {
          if (b.dataset.ask === 'no') return close(null);
          if (b.dataset.ask === 'dir') {
            const dir = await window.showDirectoryPicker({ id: 'lmd-carpeta', mode: 'readwrite' });
            const found = await findInFolder(dir);
            if (!found) { box.querySelector('p').textContent = T('Esa carpeta no contiene "{a}". Elegí la carpeta donde está el archivo, o una que la contenga.', { a: name }); return; }
            await handlesPut({ key: found.base, kind: 'dir', handle: dir });
            return close(found.handle);
          }
          const picked = await window.showOpenFilePicker({
            id: 'lmd-guardar', multiple: false,
            types: MD_RE.test(name) ? [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }] : pickTypes(name),
          });
          const handle = picked[0];
          if (handle.name !== name && !(await LMD.dialog.confirm({ title: T('Elegiste otro archivo'), text: T('Elegiste "{a}" y el documento abierto es "{b}".', { a: handle.name, b: name }), ok: T('Guardar sobre el archivo elegido') }))) return;
          await handlesPut({ key: hereUrl(), kind: 'file', handle });
          return close(handle);
        } catch (err) {
          if (!(err && err.name === 'AbortError')) box.querySelector('p').textContent = T('No se pudo obtener el permiso. Probá de nuevo.');
        }
      });
    });
  }

  // Una nota del navegador pasa a ser un archivo: se elige dónde, y desde ahí se trabaja sobre el archivo.
  async function saveNoteToDisk() {
    clearTimeout(autosaveTimer);
    if (!window.showSaveFilePicker) {
      LMD.kit.saveFile(new Blob([raw], { type: 'text/markdown' }), DOC_NAME);
      flash(T('Se descargó una copia. La nota sigue guardada en este navegador'));
      return true;
    }
    try {
      const target = await window.showSaveFilePicker({ id: 'lmd-nuevo', suggestedName: DOC_NAME, types: pickTypes(DOC_NAME) });
      const w = await target.createWritable(); await w.write(raw); await w.close();
      await LMD.store.noteDelete(DOC_NAME);
      diskText = raw; dirty = false; updateSaveState();
      await LMD.home.adopt(homeCtx(), target);
      return true;
    } catch (e) {
      if (!(e && e.name === 'AbortError')) flash(T('No se pudo guardar'), 'error');
      return false;
    }
  }

  // Al volver la conexión, antes de subir se mira si la nota cambió en el servidor: se mezcla en vez de pisar.
  let stashed = null;
  async function catchUp(path) {
    let n = null;
    try { n = await LMD.cloud.read(path); } catch (e) { if (e.code !== 'not_found') throw e; }
    if (!n) { diskRev = null; return true; } // ya no está en el servidor: se guarda como nota nueva
    if (n.text === diskText) { if (n.rev != null) diskRev = n.rev; return true; }
    // Juntar cambia el texto y hay que redibujar: con el cursor en un bloque, espera.
    if (typingNode()) return false;
    const r = await LMD.cloud.settle(path, diskText, raw, n.text);
    diskText = n.text; if (n.rev != null) diskRev = n.rev;
    if (r.text !== raw) { raw = r.text; syncSource(); render(); }
    dirty = raw !== diskText;
    offlineNote(r);
    return true;
  }
  // online: el choque fue con la nota abierta y con conexión (otro guardó lo mismo a la vez), no al volver de estar sin ella.
  function offlineNote(r, online) {
    if (r.aside) flash(T(online ? 'La nota cambió en la nube. Lo tuyo quedó aparte, en "{a}"' : 'La nota cambió en la nube. Lo que escribiste sin conexión quedó en "{a}"', { a: r.aside }), 'warn');
    else if (r.merged) flash(T('Se sumaron los cambios de otra persona'));
  }

  // turn: cuántas veces seguidas ya se rechazó este guardado porque otro guardó antes.
  async function save(interactive, turn) {
    if (noDoc) return true;
    const seq = docSeq;
    const later = () => { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => save(false), 2500); return false; };
    // Guardar no saca el foco: lo escrito en el bloque abierto pasa al Markdown y la persona sigue escribiendo.
    flushTyping();
    if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); dirty = raw !== diskText; }
    // Un choque sin decidir frena el guardado. El automático espera; el pedido a mano vuelve a preguntar.
    if (held && !liveOn()) {
      if (!interactive) return false;
      if (!(await joinOutside(held.text, held.rev, held.who, true)) || seq !== docSeq) return false;
    }
    if (interactive && appRoot && appRoot.kind === 'local') return saveNoteToDisk();
    // Una copia de un archivo del disco no tiene dónde guardarse: guardar es pasar al archivo real (pide la carpeta).
    if (appRoot && appRoot.kind === 'fs') { if (interactive) { if (await fsGrant()) return save(false); if (seq === docSeq && appRoot && appRoot.kind === 'fs' && !window.showDirectoryPicker) flash(T('Es una copia: acá no se puede guardar en el archivo del disco.'), 'warn'); } return false; }
    if (!dirty && fileHandle) { if (interactive) flash(T('Sin cambios para guardar')); return true; }
    try {
      if (!fileHandle) { const found = await storedHandle(interactive); if (seq !== docSeq) return false; fileHandle = found; }
      if (!fileHandle) {
        if (!interactive) return false;
        if (appRoot && appRoot.id === 'mem' && window.showSaveFilePicker) {
          // Archivo nuevo: se elige dónde guardarlo y desde ahí pasa a ser un archivo común.
          const target = await window.showSaveFilePicker({ id: 'lmd-nuevo', suggestedName: DOC_NAME,
            types: pickTypes(DOC_NAME) });
          const w = await target.createWritable(); await w.write(raw); await w.close();
          diskText = raw; dirty = false; updateSaveState();
          try { sessionStorage.removeItem('mdt-mem'); } catch (e) { /* sin sesión */ }
          await LMD.home.adopt(homeCtx(), target);
          return true;
        }
        if (!window.showOpenFilePicker) {
          const name = DOC_NAME || 'documento.md';
          LMD.kit.saveFile(new Blob([raw], { type: 'text/markdown' }), name);
          flash(T('Este navegador no deja escribir el archivo: se descargó una copia'), 'warn');
          if (appRoot && appRoot.id === 'mem') {
            diskText = raw; dirty = false; updateSaveState();
            try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name, text: raw })); } catch (e) { /* demasiado grande para la sesión */ }
          }
          return false;
        }
        const given = await askForAccess();
        if (seq !== docSeq) return false;
        fileHandle = given;
        if (!fileHandle) return false;
      }
      if (appRoot && appRoot.kind === 'cloud') {
        const path = vParts(HERE).join('/');
        await LMD.cloud.stash(path, raw, diskText); stashed = raw;
        if (cloudState === 'error' && liveOn()) {
          // Vuelve la conexión en una sesión en vivo: lo que cambió mientras tanto se junta acá mismo, sin esperar
          // a soltar el bloque, y lo de acá sale sobre la revisión nueva.
          const n = await LMD.cloud.read(path);
          if (seq !== docSeq) return false;
          applyRemote(n.text, n.rev, '');
          await LMD.cloud.stash(path, raw, diskText); stashed = raw;
          if (raw === diskText) { cloudState = 'ok'; dirty = false; await LMD.cloud.settled(path, raw); updateSaveState(); return true; }
        } else if (cloudState === 'error') { if (!(await catchUp(path))) return later(); await LMD.cloud.stash(path, raw, diskText); stashed = raw; }
      }
      // Cambió afuera mientras se escribía: no se pisa. La copia local ya quedó; se sube al soltar el bloque.
      // Ya fuera del bloque, primero se trae y se junta lo de afuera, y recién después se guarda.
      // En la nube tampoco pasa un guardado a mano: el servidor lo rechazaría, y juntar hace falta igual.
      if (outside && (!interactive || isCloud())) { if (!typingNode()) { cloudPoll = 0; checkForChanges(false); } return later(); }
      // Mientras se escribe en el archivo la persona puede seguir tecleando: se da por guardado lo que salió,
      // no lo que haya ahora.
      // Justo antes de escribir en el disco se vuelve a leer el archivo: si otro programa lo cambió desde la base,
      // se une en vez de pisar. Si choca, no se escribe hasta que la persona decida.
      if (!isCloud() && fileHandle.getFile) {
        // null: el archivo ya no está, y se escribe de nuevo. undefined: está pero no se pudo leer.
        const fresh = async () => { try { return await (await fileHandle.getFile()).text(); } catch (e) { return e && e.name === 'NotFoundError' ? null : undefined; } };
        let now = await fresh();
        // Ilegible o vacío de golpe suele ser otro programa a medio escribir: se mira una vez más.
        if (now === undefined || (now === '' && diskText !== '')) { await new Promise((r) => setTimeout(r, 250)); now = await fresh(); }
        if (seq !== docSeq) return false;
        // Sin poder leerlo no se escribe a ciegas: se reintenta enseguida.
        if (now === undefined) { if (interactive) flash(T('No se pudo releer el archivo. Recargá la pestaña con F5'), 'error'); return later(); }
        if (now != null && now !== diskText) {
          if (!interactive && typingNode()) { outside = true; diskStamp = ''; return later(); }
          if (!(await joinOutside(now, null, '', interactive)) || seq !== docSeq) return false;
          if (!dirty) { updateSaveState(); return true; }
        }
      }
      const sent = raw; let savedRev = null;
      saving = true;
      try {
        if (isCloud()) {
          // Se guarda sobre la revisión que se tiene como base. Si otro guardó antes, el servidor no pisa: devuelve
          // lo que hay, se junta con lo de acá y se vuelve a intentar.
          try { savedRev = (await LMD.cloud.save(vParts(HERE).join('/'), sent, diskRev)).rev; }
          catch (e) {
            if (e.code !== 'rev_conflict' || seq !== docSeq) throw e;
            saving = false;
            // En una sesión en vivo se junta ya, alrededor del bloque que se está escribiendo, y se reintenta.
            if (liveOn()) {
              if (e.rev != null && diskRev != null && e.rev <= diskRev) diskRev = e.rev - 1; // la nota se volvió a crear: vale lo que hay
              applyRemote(e.theirs, e.rev, e.pid || ''); drainInbox();
              if (!dirty) return true;
              if ((turn || 0) >= 6) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => save(false), 300); return false; }
              return save(interactive, (turn || 0) + 1);
            }
            // Con el cursor en un bloque, juntar espera a que se lo suelte (lo escrito ya quedó en la copia local).
            if (typingNode() || (turn || 0) >= 4) { outside = true; diskStamp = ''; return later(); }
            if (!(await takeOutside(e.theirs, e.rev, whoIs(lastEdit && lastEdit.by))) || seq !== docSeq) return false;
            return dirty ? save(interactive, (turn || 0) + 1) : true;
          }
        } else {
          const writable = await fileHandle.createWritable();
          await writable.write(sent);
          await writable.close();
        }
      } finally { saving = false; if (inbox) setTimeout(drainInbox, 0); } // lo que llegó mientras salía este guardado entra después
      if (seq !== docSeq) return true;
      if (isCloud()) diskRev = savedRev == null ? null : savedRev;
      // Una nota de la nube quedó guardada: quien publica un sitio con esa nota se entera (sync.js).
      if (isCloud()) { const at = vParts(HERE).join('/'); core.hooks.saved.forEach((fn) => { try { fn(at, savedRev); } catch (e) { /* quien escucha se arregla */ } }); }
      fileCache.delete(HERE); // la búsqueda en la carpeta vuelve a leerlo
      cloudState = 'ok';
      diskText = sent; diskStamp = ''; dirty = raw !== diskText; updateSaveState();
      if (LMD.count && !LMD.cloud.guest()) LMD.count('edited'); // conteo anónimo: la primera edición guardada en este navegador
      if (dirty) markDirty(); // se escribió más durante el guardado: sale en el próximo
      if (interactive || !(appRoot && (appRoot.kind === 'local' || appRoot.kind === 'cloud'))) flash(T('Guardado'));
      return true;
    } catch (e) {
      if (seq !== docSeq || (e && e.name === 'AbortError')) return false;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) fileHandle = null;
      // En el tope del plan gratis: se dice acá y, si se pidió guardar, se abre Plan. Si no, queda el aviso con el botón.
      if (e && e.code === 'note_limit') {
        flash(T('El plan gratis está lleno. Esta nota no se guardó en la nube'), 'error');
        if (interactive) openPanel('plan', LMD.sync.full()); else LMD.sync.room(e.body && e.body.limit ? e.body : null);
      }
      // La carpeta se bloqueó (o se protegió desde otra pestaña) con la nota abierta: lo escrito sigue acá, y se
      // guarda cifrado apenas se desbloquea.
      else if (e && e.code === 'vault_locked') {
        flash(T('La carpeta está bloqueada. Desbloqueala para guardar.'), 'warn');
        if (interactive) LMD.vault.unlockFor(vParts(HERE).join('/')).then((ok) => { if (ok && seq === docSeq) save(false); });
      }
      // Una nota con imágenes incrustadas que pasa el tope del servidor: lo escrito sigue acá.
      else if (e && e.code === 'too_large') flash(T('La nota pesa más de 1 MB y no se guardó en la nube. Pasá sus imágenes incrustadas a adjuntos desde el menú de la nota.'), 'error');
      else if (e && e.code === 'offline') {
        // El aviso sale una vez; después se reintenta en silencio hasta que vuelva.
        if (cloudState !== 'error' || interactive) flash(T('Sin conexión. Se guarda cuando vuelva'), 'warn');
        cloudState = 'error'; updateSaveState(); clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => save(false), liveOn() ? 3000 : 8000);
      }
      // La sesión en vivo terminó con cambios sin enviar: lo escrito sigue acá y la barra de la sesión ofrece descargarlo.
      else if (e && (e.code === 'live_ended' || e.code === 'guest')) { cloudState = 'error'; updateSaveState(); }
      // Muchos guardados en un minuto (un invitado tiene tope): se espera lo que pide el servidor.
      else if (e && e.status === 429 && liveOn()) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => save(false), Math.min(60, e.retry || 5) * 1000); }
      else flash(T('No se pudo guardar'), 'error');
      return false;
    }
  }

  // ---------- Abrir una nota sin recargar la página ----------
  let opened = null; // cómo se abrió la nota de la nube: del servidor, de la copia local, o mezclada
  let navSeq = 0; // cada pedido de cambio de nota; el que queda viejo se descarta
  let docSeq = 0; // cada nota abierta; lo que llega tarde de la anterior no toca a la nueva
  let stopEvents = null; let unhold = null;
  const blobUrls = [];
  // Quien entró por el enlace de una sesión en vivo sigue en esa dirección: recargar la pestaña lo vuelve a traer.
  const hrefOf = (f, hash) => f && /^#live=/.test(location.hash) && LMD.cloud.guest() ? location.href : (f && LMD.cloud.guest() ? location.href.split('#')[0] : APP_URL + (f ? '?f=' + encodeURIComponent(f) : '')) + (hash && !/^#lmd-/.test(hash) ? hash : '');

  // Lee lo que hace falta para abrir f sin tocar la nota que está a la vista: si falla, todo sigue como estaba.
  // Devuelve { root, raw, disk, ... } o { fail: aviso }.
  // Una nota de la nube que se quiso abrir sin sesión (por ejemplo, desde el enlace que devuelve la IA): se abre
  // apenas la persona entra, si mientras tanto no abrió otra cosa.
  let wantCloud = '';
  const resumeCloud = () => { if (!wantCloud || !noDoc || !LMD.cloud.signedIn()) return; const f = wantCloud; wantCloud = ''; go(f); };
  async function loadDoc(f) {
    const url = VBASE + f; const id = f.split('/')[0]; const name = decodeURIComponent(url.split('/').pop() || '');
    const fail = (text) => ({ fail: text });
    if (id === 'cloud') {
      await LMD.cloud.ready();
      const path = vParts(url).join('/'); let got = null; let why = '';
      // Sin conexión se abre la copia guardada en este navegador, con lo que haya quedado sin subir.
      if (LMD.cloud.signedIn()) {
        try { got = await LMD.cloud.open(path); } catch (e) { why = e && e.code; }
        // En una carpeta protegida y bloqueada: se pide la contraseña y, si entra, se abre.
        if (why === 'vault_locked' && await LMD.vault.unlockFor(path)) { why = ''; try { got = await LMD.cloud.open(path); } catch (e) { why = e && e.code; } }
      }
      if (!got && (why === 'vault_locked' || why === 'vault_unreadable')) return fail(T(why === 'vault_locked' ? '"{a}" está en una carpeta protegida. Desbloqueala para abrirla.' : '"{a}" no se pudo descifrar con la llave de su carpeta.', { a: name }));
      if (!got && !LMD.cloud.signedIn()) wantCloud = f;
      if (!got) return fail(T(!LMD.cloud.signedIn() ? 'Entrá a tu cuenta para abrir las notas de la nube.' : why === 'offline' ? 'Sin conexión, y "{a}" no tiene copia en este navegador.' : 'No se encontró "{a}".', { a: name }));
      return { root: roots.cloud, raw: got.text, disk: got.base, rev: got.rev, opened: got, readOnly: LMD.cloud.roleOf(path) === 'view' };
    }
    if (id === 'pub') {
      // Enlace público de solo lectura; si tiene contraseña, se pide.
      await LMD.cloud.ready();
      const token = vParts(url).join('/');
      const why = (e) => (e.code === 'locked' && e.retry ? T('Demasiadas contraseñas equivocadas. Probá de nuevo en {a}.', { a: LMD.home.waitText(e.retry) }) : T(e.code === 'locked' ? 'Demasiadas contraseñas equivocadas. Probá de nuevo en 10 minutos.' : e.code === 'offline' ? 'No hay conexión con el servidor.' : 'Ese enlace ya no existe.'));
      let n = null; let stop = '';
      try { n = await LMD.cloud.publicNote(token, ''); }
      catch (e) {
        if (e.code !== 'need_password' && e.code !== 'bad_password') return fail(why(e));
        // La contraseña se prueba desde el diálogo: si no coincide, lo dice ahí y deja corregirla.
        const typed = await LMD.dialog.prompt({ title: T('Nota protegida'), label: T('Contraseña'), password: true, ok: T('Abrir'), empty: T('Escribí la contraseña.'),
          validate: async (v) => { try { n = await LMD.cloud.publicNote(token, v); return ''; } catch (err) { if (err.code === 'bad_password') return T('Esa contraseña no coincide.'); stop = why(err); return ''; } } });
        if (typed == null || !n) return fail(stop);
      }
      return { root: { id, kind: 'pub', name: T('Compartido'), title: n.path.split('/').pop(), text: n.text }, raw: n.text, disk: n.text, readOnly: true };
    }
    if (id === 'local') {
      // Nota guardada en el navegador.
      let note = await LMD.store.noteGet(name);
      // Con la extensión instalada, la nota puede estar llegando de su depósito.
      if (!note) { await LMD.bridge.settle(); note = await LMD.store.noteGet(name); }
      if (!note) return fail(T('No se encontró "{a}".', { a: name }));
      return { root: roots.local, raw: note.text, disk: note.text };
    }
    if (id === 'fs') {
      const file = LMD.fileUrl(fsFile(url)); const known = file ? await fsKnown(file) : null;
      if (known && known.granted) { try { await walk(known.rec.handle, known.rest); return { goto: known.rec.id + '/' + known.rest.map(encodeURIComponent).join('/') }; } catch (e) { /* ya no está en esa carpeta: queda lo que lea la extensión */ } }
      let text = null; let why = 'shape';
      if (file) { try { text = await fsRead(file); } catch (e) { why = e.why || 'failed'; } }
      // No falla en silencio: lo dice, y ofrece elegir el archivo (install.js sabe por qué no se pudo).
      if (text == null) { if (file) setTimeout(() => LMD.install.offer(file, homeCtx(), why), 0); return fail(T('No se pudo abrir "{a}".', { a: name })); }
      return { root: roots.fs, raw: text, disk: text };
    }
    if (id === 'mem') {
      // Navegador sin acceso a archivos: el documento viaja en la sesión y se guarda descargando una copia.
      let mem = null;
      try { mem = JSON.parse(sessionStorage.getItem('mdt-mem') || 'null'); } catch (e) { /* sesión vacía */ }
      if (!mem || mem.name !== name) return fail('');
      // disk es lo último que quedó guardado; un archivo nuevo todavía no tiene nada en el disco.
      return { root: { id, kind: 'file', name: mem.name, handle: { kind: 'file', name: mem.name, getFile: async () => ({ text: async () => mem.text, lastModified: 0, size: mem.text.length }) } },
        raw: mem.text, disk: mem.disk != null ? mem.disk : mem.text };
    }
    const rec = (roots[id] && roots[id].root ? roots[id] : null) || (await handlesAll()).find((r) => r.root && r.id === id);
    if (!rec) return fail(T('Ese acceso ya no está guardado. Abrí el archivo o la carpeta de nuevo.'));
    if (rec.ghost) return fail(T('Falta el permiso para abrir "{a}".', { a: rec.name }));
    const mode = 'read'; // abrir es leer: el permiso de escritura se pide al editar o guardar (askWrite)
    let ok = false;
    try { ok = (await rec.handle.queryPermission({ mode })) === 'granted'; } catch (e) { /* se pide abajo */ }
    // Con un clic de por medio Chrome deja pedirlo ahí mismo; al arrancar hace falta el botón de la tarjeta.
    if (!ok) { try { ok = (await rec.handle.requestPermission({ mode })) === 'granted'; } catch (e) { /* hace falta un clic */ } }
    if (!ok && noDoc) ok = await LMD.home.gate(homeCtx(), rec, mode);
    if (!ok) return fail(noDoc ? '' : T('Falta el permiso para abrir "{a}".', { a: rec.name }));
    roots[id] = rec;
    const text = await vText(url);
    if (text == null) return fail(T('No se encontró "{a}".', { a: name }));
    return { root: rec, raw: text, disk: text };
  }

  // Antes de salir de una nota se guarda lo pendiente. Devuelve false si la persona prefiere quedarse.
  async function leaveDoc() {
    if (noDoc) return true;
    const a = document.activeElement;
    if (a && a.blur && (a.isContentEditable || a.classList.contains('lmd-src'))) a.blur();
    if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); dirty = raw !== diskText; }
    if (!dirty) return true;
    if (await save(false) || !dirty) return true;
    // Sin conexión, lo escrito en una nota de la nube ya quedó en la cola y sube solo al volver.
    if (appRoot && appRoot.kind === 'cloud' && stashed === raw) return true;
    // Falta el permiso para escribir: se pide, que acá hay un clic de por medio.
    if (!(appRoot && appRoot.id === 'mem') && (await save(true) || !dirty)) return true;
    return LMD.dialog.confirm({ title: T('Cambios sin guardar'), text: T('No se pudieron guardar los cambios de "{a}".', { a: DOC_NAME }), ok: T('Salir sin guardar'), danger: true });
  }

  // Suelta todo lo que era de la nota anterior: temporizadores, la escucha de la nube, imágenes y menús abiertos.
  function dropDoc() {
    docSeq++;
    clearTimeout(autosaveTimer); clearTimeout(softTimer);
    if (stopEvents) { stopEvents(); stopEvents = null; }
    if (LMD.comments) LMD.comments.detach();
    if (LMD.live) LMD.live.detach();
    inbox = null;
    if (unhold) { unhold(); unhold = null; LMD.cloud.flush(); }
    blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    if (!noDoc) fileCache.delete(HERE);
    undoStack.length = 0; redoStack.length = 0; collapsed.clear(); spyPin = null; present = []; hereAi = []; lastEdit = null;
    pendingCell = null; fileHandle = null; stashed = null; opened = null; held = null; diskStamp = ''; cloudPoll = 0; cloudState = 'ok'; diskRev = null;
    needsRender = false; core.lastBlock = null; core.hold = false;
    goneDoc = '';
    LMD.write.closeMenu(); closeMore(); if (drawerOpen()) setDrawer(false); // en escritorio, quien recorre el explorador con el teclado conserva el foco
    // El aviso de una invitación a un equipo es de la cuenta, no de la nota: sigue al cambiar de nota.
    document.querySelectorAll('.lmd-menu, .lmd-ask:not(.lmd-team-ask)').forEach((n) => n.remove());
    ui.viewer.hidden = true; ui.viewer.textContent = ''; ui.format.hidden = true; ui.tableBar.hidden = true;
    clearSearch();
  }

  // Cambia la nota abierta en el lugar. f vacío deja la app sin nota, con el estado vacío en el centro.
  // opt: edit (abre en edición), replace (no suma una entrada al historial), pop (viene de atrás o adelante),
  // discard (la nota ya no existe: no se guarda al salir), hash (sección o búsqueda a la que ir), note (aviso para el estado vacío).
  async function go(f, opt) {
    opt = opt || {};
    const seq = ++navSeq;
    try {
      if (!opt.discard && !(await leaveDoc())) { if (opt.pop) history.pushState(null, '', hrefOf(HERE.slice(VBASE.length))); return false; }
      if (seq !== navSeq) return false;
      const doc = f ? await loadDoc(f) : null;
      if (seq !== navSeq) return false;
      // Un archivo del disco abierto por enlace del que la web ya tiene la carpeta: se abre el archivo real.
      if (doc && doc.goto) return go(doc.goto, Object.assign({}, opt, { discard: true }));
      if (doc && doc.fail != null) {
        // No se pudo abrir: con una nota a la vista se avisa y queda esa; si no, lo dice el estado vacío.
        if (!noDoc && !opt.pop) { if (doc.fail) flash(doc.fail, 'error'); return false; }
        setDoc('', null, Object.assign({}, opt, { note: doc.fail, replace: !opt.pop }));
        return false;
      }
      setDoc(f, doc, opt);
      return true;
    } catch (e) {
      // Algo inesperado: queda el camino de siempre, la página entera.
      if (f && !opt.boot) location.href = hrefOf(f, opt.hash); else if (noDoc) showEmpty(T('No se pudo abrir. Probá de nuevo.'));
      return false;
    }
  }

  function setDoc(f, doc, opt) {
    const wasEditing = editMode;
    dropDoc();
    // Se creó, se movió o se borró un archivo: el árbol y lo que se sabía de la carpeta se vuelven a leer.
    if (opt.tree) { fileCache.clear(); folderIndex.clear(); clearCounts(); wikiIndex = null; linkIndex = null; }
    HERE = VBASE + f; DOC_NAME = doc ? decodeURIComponent(HERE.split('/').pop() || '') : ''; noDoc = !doc;
    appRoot = doc ? doc.root : null;
    // Conteo anónimo (count.js, solo en la app web): la primera nota propia que se abre o se crea en este navegador. Va el nombre del evento y nada de la nota.
    if (doc && LMD.count && appRoot.kind !== 'pub' && !LMD.cloud.guest()) LMD.count('note_created');
    if (doc) wantCloud = '';
    if (doc) roots[appRoot.id] = appRoot;
    raw = doc ? doc.raw : ''; diskText = doc ? doc.disk : ''; dirty = raw !== diskText;
    diskRev = doc && doc.rev != null ? doc.rev : null;
    readOnly = !!(doc && doc.readOnly); opened = (doc && doc.opened) || null;
    if (opened && opened.updated) lastEdit = { at: opened.updated, by: opened.edited || null };
    rawMode = false; editMode = false;
    if (!opt.pop) {
      // La marca de la vuelta del pago se queda hasta que el servidor confirma: la limpia quien espera.
      const href = hrefOf(f, opt.hash) + (opt.boot && location.hash === '#lmd-paid' ? '#lmd-paid' : '');
      if (opt.replace || opt.boot || LMD.touch.backMark()) history.replaceState(null, '', href); else if (href !== location.href) history.pushState(null, '', href);
    }
    if (doc && appRoot.root) { appRoot.last = f; appRoot.at = Date.now(); handlesPut(appRoot); }
    paintDoc();
    paintCopy();
    paintWrite();
    syncTree(opt.tree);
    if (noDoc) { render(); applyRawMode(); updateSaveState(); window.scrollTo(0, 0); showEmpty(opt.note); }
    else {
      ui.home.hidden = true;
      if (appRoot.kind === 'cloud') {
        // Nota de la nube: se escucha en vivo quién más está y cuándo alguien guarda.
        const path = vParts(HERE).join('/'); const mine = docSeq;
        if (opened.offline) { cloudState = 'error'; flash(T('Sin conexión. Esta es la copia guardada en este navegador'), 'warn'); } else offlineNote(opened);
        if (dirty) markDirty(); // lo que quedó sin subir sale ahora, o apenas vuelva la conexión
        unhold = LMD.cloud.hold(path); LMD.cloud.flush();
        let linkUp = true;
        stopEvents = LMD.cloud.events(path, (ev) => {
          if (mine !== docSeq) return;
          if (ev.who) present = ev.who;
          if (ev.who && ev.names) ev.who.forEach((mail, i) => { if (ev.names[i]) presentNames[mail] = ev.names[i]; });
          // Las IA que están leyendo o escribiendo la nota, y quién hizo el último guardado.
          if (Array.isArray(ev.ai)) hereAi = ev.ai;
          if (ev.type === 'saved' && ev.updated) lastEdit = { at: ev.updated, by: ev.edited || null };
          // Lo que no es de esta nota sino de la cuenta (los agentes) lo atiende quien se anotó para escucharlo.
          if (ev.type === 'agents') { core.hooks.event.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } }); return; }
          if (ev.type !== 'link') LMD.live.strip();
          // La escucha se cortó o volvió. Al volver se trae lo que haya cambiado mientras tanto, y sale lo pendiente.
          if (ev.type === 'link') {
            if (ev.up && !linkUp) { if (dirty && cloudState === 'error') { clearTimeout(autosaveTimer); save(false); } else { cloudPoll = 0; checkForChanges(false); } }
            linkUp = !!ev.up; LMD.live.event(ev); return;
          }
          if (ev.type === 'live') { LMD.live.event(ev); LMD.sync.paint(); return; }
          // En una sesión en vivo el aviso trae el cambio: se aplica sin pedir la nota.
          if (ev.type === 'saved' && liveOn() && (typeof ev.text === 'string' || ev.patch)) liveSaved(ev);
          else if (ev.type === 'saved' && ev.by !== LMD.cloud.email()) { cloudPoll = 0; checkForChanges(false); }
          // Cambió el estado de una carpeta protegida (se abrió o se cerró para la IA, venció el plazo, otra pestaña).
          if (ev.type === 'vault') LMD.vault.changed();
          if (ev.type === 'comments' && LMD.comments) { cloudPoll = 0; checkForChanges(false).then(() => { if (mine === docSeq) LMD.comments.onEvent(ev); }); }
          LMD.sync.paint();
        }, liveOn);
      }
      afterOpen({ edit: opt.edit, editing: wasEditing, hash: opt.hash });
      // Los comentarios para la IA son de cada nota: con la nueva ya dibujada se traen los suyos.
      // Quien entró por el enlace de una sesión en vivo no tiene cuenta: no hay comentarios que traerle.
      if (appRoot.kind === 'cloud' && LMD.comments && !LMD.cloud.guest()) LMD.comments.attach(vParts(HERE).join('/'));
      if (appRoot.kind === 'cloud') LMD.live.attach(vParts(HERE).join('/'));
      LMD.live.strip();
    }
    core.hooks.doc.forEach((fn) => fn());
  }

  // Título, nombre y clases que dependen de la nota abierta.
  function paintDoc() {
    const title = (appRoot && appRoot.title) || DOC_NAME;
    document.title = noDoc ? 'SharpMD' : (title || 'Markdown');
    ui.main.querySelector('.lmd-docname').textContent = title;
    document.documentElement.classList.toggle('lmd-readonly', readOnly);
    // Una nota abierta por su enlace público solo se lee: ahí no se ofrece editar, insertar ni guardar.
    document.documentElement.classList.toggle('lmd-public', !noDoc && !!appRoot && appRoot.kind === 'pub');
    document.documentElement.classList.toggle('lmd-nodoc', noDoc);
    document.documentElement.classList.toggle('lmd-noreload', !diskDoc());
    ui.main.querySelector('.lmd-report').hidden = !(APP && LMD.sync.reportRef());
    if (settings && !ui.status.classList.contains('lmd-flash')) ui.status.textContent = idleStatus();
  }
  function showEmpty(note) { ui.home.hidden = false; LMD.home.show(homeCtx(), note); core.hooks.home.forEach((fn) => fn(ui.home)); unsplash(); }

  // Dibuja la nota recién abierta y la deja donde corresponde: en edición si toca, y en la sección o búsqueda pedida.
  function afterOpen(opt) {
    updateSaveState();
    render();
    applyRawMode();
    window.scrollTo(0, 0);
    // Un archivo recién creado, o uno vacío, arranca listo para escribir. Si se venía editando, sigue en
    // edición. Lo de solo lectura y lo que no es Markdown abre leyendo.
    const fresh = !!opt.edit; const blankDoc = !raw.trim(); const draft = opt.edit === true || blankDoc;
    if (fresh || (!readOnly && docKind() === 'md' && (blankDoc || opt.editing || editRemembered()))) {
      // Con Ajustes abiertos (vuelta de un cambio de idioma o de un pago) el menú de insertar no se ofrece: quedaría encima.
      setEditMode(true, !fresh).then(() => { const add = draft && editMode && ui.panel.hidden && ui.article.querySelector('.lmd-add'); if (add) add.click(); });
    }
    const hash = opt.hash || '';
    const fromSearch = /^#lmd-q=([^&]+)(?:&r=(.+))?$/.exec(hash);
    if (fromSearch) {
      // Se llegó desde un resultado de búsqueda en la carpeta: se repite la búsqueda acá.
      if (!APP) history.replaceState(null, '', readerHref(HERE));
      ui.searchInput.value = decodeURIComponent(fromSearch[1]);
      runSearch(ui.searchInput.value, true, true);
    } else if (hash && !/^#lmd-/.test(hash)) {
      // Se llegó por un enlace a una sección: si no existe, se avisa en vez de quedar arriba sin decir nada.
      const frag = unesc(hash.slice(1)); const t = findAnchor(frag);
      if (t) { shown(t); t.scrollIntoView(); } else noSection(frag);
    } else restorePosition();
  }

  // Un enlace que abre un archivo del disco (app.html#open=...): lo pedido sale de la barra de direcciones apenas se
  // lee, y antes de abrir se pregunta (install.js).
  function takeOpen() {
    const m = APP && /^#open=(.*)$/.exec(location.hash);
    if (!m) return '';
    history.replaceState(history.state, '', location.href.split('#')[0]);
    return m[1];
  }

  // El enlace del correo con el código (app.html#signin=...): sale de la barra de direcciones apenas se lee, no se
  // guarda en ningún lado, y antes de entrar se pregunta (home.js).
  function takeSignin() {
    const m = APP && /^#signin=(.*)$/.exec(location.hash);
    if (!m) return '';
    history.replaceState(history.state, '', location.href.split('#')[0]);
    return m[1];
  }

  // ---------- Arranque de la página propia ----------
  async function appBoot() {
    const params = new URLSearchParams(location.search);
    // Desde el popup: una nota nueva, sin pasar por el estado vacío.
    if (params.has('new')) { LMD.home.account(homeCtx()); LMD.home.create(homeCtx(), { replace: true }); return; }
    // Lo que otra app mandó con "Compartir" (install.js): se abre, o el inicio dice por qué no se pudo.
    if (params.has('share')) { const got = await LMD.install.takeShared(homeCtx()); if (got === true) return; showEmpty(got); loadTree(); return; }
    // El enlace de una sesión en vivo: se pide un nombre y se abre la nota de esa sesión, sin cuenta.
    // El secreto viaja tras el # (no llega al alojamiento de la web); los enlaces viejos con ?live= siguen sirviendo.
    let liveKey = decodeURIComponent((/^#live=([^&]+)/.exec(location.hash) || [])[1] || '') || params.get('live'); let kept = false;
    // Un invitado que recarga después de ir a una sección ya no tiene el secreto en la dirección: vale el de la pestaña.
    if (!liveKey && !params.get('f')) { try { liveKey = (JSON.parse(sessionStorage.getItem('lmd-live') || 'null') || {}).secret; kept = !!liveKey; } catch (e) { /* sin sesión */ } }
    if (liveKey) {
      unsplash(); // el nombre se pide en una ventana
      await LMD.live.enter(liveKey);
      if (kept && !LMD.cloud.guest()) { try { sessionStorage.removeItem('lmd-live'); } catch (e) { /* sin sesión */ } }
      return;
    }
    // La app de Android la lanzaron para abrir un archivo: si no llega, el inicio lo dice (install.js).
    if (params.has('open')) LMD.install.expect(homeCtx);
    const f = params.get('f');
    if (!f) { showEmpty(); loadTree(); return; }
    LMD.home.account(homeCtx()); // con una nota abierta el inicio no se dibuja: la cuenta del pie se pinta acá
    await go(f, { boot: true, edit: params.has('edit'), hash: location.hash });
  }

  // ---------- Arranque ----------
  const RENDER_KEYS = ['plugins', 'theme', 'diagramShape', 'preset', 'supporter', 'foldHeadings'];
  const TREE_KEYS = ['filesOnlyMarkdown', 'filesShowHidden'];

  // Sobre un archivo abierto directo, la dirección puede traer otro archivo en el fragmento (recargar con otro a la
  // vista, o un enlace copiado): se lee antes de dibujar, así lo primero que se ve ya es ese.
  const bootFile = () => {
    if (APP) return null;
    const want = addressed();
    return sameUrl(want, HERE) ? null : bg({ type: 'fetchText', url: want }).then((r) => ({ url: want, r }), () => ({ url: want, r: null }));
  };
  Promise.all([LMD.load(), loadSide(), bootFile()]).then(async ([s, saved, other]) => {
    settings = s;
    let missing = '';
    if (other && readable(other.r)) { HERE = other.url; DOC_NAME = unesc(HERE.split('/').pop() || ''); raw = other.r.text; diskText = raw; }
    else if (other) missing = unesc(other.url.split('/').pop() || '');
    if (saved) side = Object.assign(side, saved, { shut: Object.assign({}, saved.shut) });
    LMD.setLang(settings.language);
    if (APP) { roots.fs = { id: 'fs', kind: 'fs', name: T('Del disco') }; roots.local = { id: 'local', kind: 'local', name: T('En este navegador') }; roots.cloud = { id: 'cloud', kind: 'cloud', name: T('Nube') }; }
    // Sobre un archivo del disco la nube es la única raíz virtual: se lista por la extensión.
    else if (isFile) roots.cloud = { id: 'cloud', kind: 'cloud', name: T('Nube') };
    buildUI();
    applySettings();
    const withDoc = !APP || new URLSearchParams(location.search).has('f');
    try { const t = sessionStorage.getItem('lmd-panel'); if (t) { sessionStorage.removeItem('lmd-panel'); openPanel(t); } } catch (e) {}
    // Vuelta de la página de pago: Ajustes en Plan, esperando que el servidor confirme.
    if (APP && withDoc && location.hash === '#lmd-paid') { openPanel('plan'); LMD.sync.awaitPaid(); }
    // Desde la portada, el botón del plan pago llega acá: Ajustes en Plan, donde se entra a la cuenta y se paga.
    // Ajustes sobre un archivo abierto directo manda igual, y también a la pestaña de IA.
    const hashTab = APP && { '#lmd-plans': 'plan', '#lmd-ai': 'ai', '#lmd-auto': 'auto', '#lmd-community': 'community' }[location.hash];
    if (hashTab) { history.replaceState(history.state, '', location.href.split('#')[0]); openPanel(hashTab); }
    // El archivo del fragmento ya no está: queda el que cargó el navegador, con su dirección.
    if (missing) { try { history.replaceState(null, '', hostUrl()); } catch (e) { /* queda como está */ } flash(T('No se encontró "{a}".', { a: missing }), 'warn'); }
    updateSaveState();
    checkUpdate(false);
    // El explorador se pone al día solo: en pausa con la pestaña oculta, y enseguida al volver a ella.
    setInterval(() => pollTree(), TREE_POLL);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollTree(); });
    const openAt = takeOpen(); const signAt = takeSignin();
    if (APP) appBoot().finally(unsplash).then(() => { if (openAt) LMD.install.openLink(openAt, homeCtx()); else if (signAt) LMD.home.signinLink(homeCtx(), signAt); }, () => {});
    else {
      afterOpen({ hash: FILE_FRAG.test(location.hash) ? '' : location.hash });
      // El árbol arranca donde lo dejó la persona, o en la raíz del repositorio si el archivo está dentro de uno.
      // Con otro archivo en el fragmento, el árbol es el del archivo que cargó el navegador mientras lo contenga:
      // recargar deja el explorador donde estaba.
      startRoot(hostFile()).then((u) => (HERE.startsWith(u) ? u : startRoot(HERE))).then((u) => { treeRoot = u; loadTree(); });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const prev = settings;
      settings = LMD.merge(changes.settings.newValue);
      if (settings.language !== prev.language) { if (!ui.panel.hidden) { try { sessionStorage.setItem('lmd-panel', panelTab); } catch (e) {} } location.reload(); return; }
      applySettings();
      // Cambió el servidor, o se prendió o apagó la nube: la cuenta y el ícono se vuelven a leer.
      // Una nota de la nube que estaba abierta era del servidor anterior: lo sin subir queda en la cola y la nota se cierra.
      if ((settings.cloudUrl || '') !== (prev.cloudUrl || '') && APP && appRoot && appRoot.kind === 'cloud') {
        if (dirty) LMD.cloud.stash(vParts(HERE).join('/'), raw, diskText).catch(() => {});
        go('', { discard: true, tree: true });
      }
      if ((settings.cloudUrl || '') !== (prev.cloudUrl || '')) { LMD.cloud.reset(); LMD.cloud.ready().then(() => { LMD.sync.paint(); if (APP) core.reloadTree(); }); panelStale = true; }
      if (panelStale && !ui.panel.hidden) { panelStale = false; openPanel(); }
      if (RENDER_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(settings[k]))) render();
      if (TREE_KEYS.some((k) => prev[k] !== settings[k]) && ui.paneFiles.dataset.loaded) core.reloadTree();
    });
  });
})();
