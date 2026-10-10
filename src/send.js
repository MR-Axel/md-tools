// Enviar a la nube: una copia de un archivo, o de una carpeta entera con sus subcarpetas, del disco o de "En este
// navegador". Sale del menú del explorador (clic derecho, o mantener apretado en el teléfono) y de arrastrar hasta la
// sección Nube o una de sus carpetas (extras.js). Siempre es una copia: lo que está en el disco no se toca ni se borra.
// Antes de mandar se mira todo: qué ya existe en el destino, cuánto lugar queda en el plan (el número sale de la
// cuenta, nunca de acá) y si el destino está protegido. Lo que no entra se dice antes de empezar, nunca a mitad.
// Anda igual en la app y en el lector de un archivo del disco, que le habla al servidor por la extensión.
// Subir a la nube es el mismo recorrido con otra fuente: archivos o una carpeta elegidos de la computadora o del
// teléfono (menú de la sección Nube y de sus carpetas), o soltados ahí desde el sistema. No hace falta haberlos
// abierto antes en el explorador.
(function () {
  'use strict';

  const { el, ICON, MD_RE, SKIP_DIRS, esc } = LMD.kit;
  const T = LMD.t;
  let core = null;

  const VB = 'https://lmd.local/';
  const MAX_FILES = 2000; const MAX_DEPTH = 12; const LIST_MAX = 60;
  // Lo que se mira como mucho de una carpeta (notas o no), y el tamaño desde el que un archivo ni se lee.
  const MAX_SEEN = 20000; const MAX_BYTES = 8 * 1024 * 1024;
  const isNote = (name) => MD_RE.test(name) || /\.txt$/i.test(name);
  const isDirUrl = (url) => url.endsWith('/');
  const fail = (code) => Object.assign(new Error(code), { code });

  // De dónde es: del disco (una carpeta o un archivo abiertos en la app, o lo que muestra el lector de file://),
  // de "En este navegador" o de la nube. Lo de un sitio web no se manda: desde ahí no se llega al servidor.
  function kindOf(url) {
    if (!url) return '';
    if (!url.startsWith(VB)) return !core.APP && /^file:\/\/\//.test(url) ? 'disk' : '';
    const r = core.rootOf(url); const k = r ? r.kind : '';
    return k === 'cloud' || k === 'local' ? k : /^(dir|file|fs)$/.test(k) ? 'disk' : '';
  }
  const leaf = (url) => { try { return decodeURIComponent(url.split('#')[0].replace(/\/$/, '').split('/').pop() || ''); } catch (e) { return ''; } };
  // El nombre de un archivo o de una carpeta. La raíz de una carpeta abierta en la app lleva el nombre de la carpeta;
  // "En este navegador" no es una carpeta: sus notas van sueltas al destino.
  function nameOf(url) {
    const r = url.startsWith(VB) ? core.rootOf(url) : null;
    if (r && url.split('#')[0] === VB + r.id + '/') return r.kind === 'local' ? '' : r.name || '';
    return leaf(url);
  }
  // Si desde ahí se puede enviar: una nota (Markdown o texto) o una carpeta, del disco o del navegador.
  function can(url) {
    if (!core || !url || !LMD.cloud.enabled() || !LMD.cloud.reach() || LMD.cloud.guest()) return false;
    const k = kindOf(url);
    if (k !== 'disk' && k !== 'local') return false;
    if (!isDirUrl(url)) return isNote(leaf(url));
    // Un archivo suelto o una copia abierta por enlace no traen su carpeta: ahí se manda el archivo.
    return k === 'local' || !core.APP || (core.rootOf(url) || {}).kind === 'dir';
  }
  const reach = () => !!core && LMD.cloud.enabled() && LMD.cloud.reach() && !LMD.cloud.guest();

  // ---------- Nombres y rutas de la nube ----------
  const BAD = /[:*?"<>|\\\u0000-\u001f]/;
  const okPart = (s) => !!s && !BAD.test(s) && !/^\.\.?$/.test(s) && s[0] !== '~' && s === s.trim();
  const okRel = (rel) => rel.split('/').every(okPart);
  const cleanName = (s) => { const v = String(s || '').replace(/[:*?"<>|\\\u0000-\u001f]/g, '-').replace(/^~+/, '').trim(); return /^\.\.?$/.test(v) ? '' : v; };
  const cloudPath = (v) => { const parts = String(v || '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean); return parts.length && parts.every(okPart) ? parts.join('/') : ''; };
  const ownerOf = (dest) => LMD.cloud.split((dest ? dest + '/' : '') + 'x').owner;
  // Un espacio ajeno solo recibe si es el del equipo y la cuenta puede escribir ahí.
  const writable = (dest) => !ownerOf(dest) || (LMD.cloud.isTeam(dest + '/') && LMD.cloud.teamCan('write'));
  const destLabel = (dest, folder) => {
    const o = ownerOf(dest); const tm = LMD.cloud.teamNow();
    const inner = (o ? dest.split('/').slice(1) : dest ? dest.split('/') : []).concat(folder ? [folder] : []);
    return [o ? (tm && tm.name) || T('Equipo') : T('Nube')].concat(inner).join(' / ');
  };
  // Un nombre libre en esa carpeta: el mismo, con un número detrás.
  function freeName(set, path) {
    const cut = path.lastIndexOf('/') + 1; const file = path.slice(cut); const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file; const ext = dot > 0 ? file.slice(dot) : '';
    for (let n = 2; n < 500; n++) { const p = path.slice(0, cut) + stem + '-' + n + ext; if (!set.has(p)) return p; }
    return path.slice(0, cut) + stem + '-' + Date.now().toString(36) + ext;
  }

  // ---------- Qué hay para mandar ----------
  // El texto como está ahora. La nota abierta va con lo que se ve, esté guardado o no.
  const textOf = async (url) => (!core.noDoc && url === core.HERE ? core.raw : core.readNow(url));
  // Venga de donde venga, lo que se manda se mira como un árbol de nodos: { name, dir, list() } una carpeta y
  // { name, dir, read(), file() } un archivo. Así el explorador (una URL), un archivo elegido, una carpeta elegida
  // (su handle, o la lista de un input webkitdirectory) y lo soltado desde el sistema siguen un solo recorrido.
  const urlNode = (url, name, dir) => (dir
    ? { name, dir, url, list: async () => { const rows = await core.listDir(url, true); return rows ? rows.map((r) => urlNode(r.url, r.name, !!r.dir)) : null; } }
    : { name, dir, url, read: () => textOf(url) });
  const leafNode = (name, file) => ({ name, dir: false, file, read: async () => { const f = await file(); if (f.size > MAX_BYTES) throw fail('too_large'); return f.text(); } });
  const fileNode = (f, name) => leafNode(name || f.name, async () => f);
  const handleNode = (h) => (h.kind === 'directory'
    ? { name: h.name, dir: true, list: async () => { const out = []; for await (const k of h.values()) out.push(handleNode(k)); return out; } }
    : leafNode(h.name, () => h.getFile()));
  // Lo que da webkitGetAsEntry al soltar: una carpeta se lee de a tandas, hasta que una viene vacía.
  const entryNode = (en) => (en.isDirectory
    ? { name: en.name, dir: true, list: () => new Promise((ok, no) => { const rd = en.createReader(); const all = []; const next = () => rd.readEntries((got) => { if (!got.length) { ok(all.map(entryNode)); return; } all.push(...got); next(); }, no); next(); }) }
    : leafNode(en.name, () => new Promise((ok, no) => en.file(ok, no))));
  // Los archivos de un input webkitdirectory traen su ruta (carpeta/sub/nota.md): con eso se rearma el árbol.
  function treeOf(files) {
    const dirOf = (name) => { const kids = new Map(); return { name, dir: true, kids, list: async () => Array.from(kids.values()) }; };
    const top = dirOf('');
    for (const f of files) {
      const parts = String(f.webkitRelativePath || f.name).split('/').filter(Boolean); const last = parts.pop(); let at = top;
      for (const p of parts) { if (!at.kids.has(p + '/')) at.kids.set(p + '/', dirOf(p)); at = at.kids.get(p + '/'); }
      at.kids.set(last, fileNode(f, last));
    }
    return Array.from(top.kids.values());
  }
  // Una fuente: qué se manda y de dónde es. rooted: una sola carpeta, que va con su nombre; si no, lo elegido va
  // suelto al destino. up: viene de la computadora o del teléfono, no del explorador.
  const fromUrl = (url) => { const dir = isDirUrl(url); const name = nameOf(url); return { url, up: false, local: kindOf(url) === 'local', dir, rooted: dir, name, tops: [urlNode(url, name, dir)], ok: () => can(url) }; };
  const fromNodes = (tops) => { const one = tops.length === 1; return { url: '', up: true, local: false, dir: !one || tops[0].dir, rooted: one && tops[0].dir, name: one ? tops[0].name : '', tops, ok: reach }; };

  // Los Markdown y los textos de una fuente, con su ruta adentro de ella. Lo oculto y las carpetas que no son de
  // notas (node_modules, .git) quedan afuera, igual que en la búsqueda y en los contadores; lo que la persona eligió
  // con su mano no se filtra por eso. other cuenta lo que no es una nota, y bins guarda las imágenes que vinieron
  // con una subida, por si una nota las nombra.
  async function gather(src) {
    const out = []; const bins = new Map(); let more = false; let other = 0; let seen = 0;
    const walk = async (rows, rel, depth, chosen) => {
      rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const r of rows) {
        if (++seen > MAX_SEEN) { more = true; return; }
        if (!chosen && r.name.startsWith('.')) continue;
        if (r.dir) {
          if (!chosen && SKIP_DIRS.test(r.name)) continue;
          if (depth >= MAX_DEPTH) { more = true; continue; }
          let kids = null;
          try { kids = await r.list(); } catch (e) { kids = null; }
          if (kids) await walk(kids, rel + r.name + '/', depth + 1, false);
        } else if (isNote(r.name)) {
          if (out.length >= MAX_FILES) { more = true; return; }
          out.push({ url: r.url || '', rel: rel + r.name, read: r.read });
        } else { other++; if (r.file && IMG_RE.test(r.name)) bins.set(rel + r.name, r); }
      }
    };
    if (src.rooted) {
      let rows = null;
      try { rows = await src.tops[0].list(); } catch (e) { rows = null; }
      if (!rows) throw fail('read');
      await walk(rows, '', 0, false);
    } else await walk(src.tops, '', 0, true);
    return { items: out, more, other, bins };
  }

  // ---------- Imágenes ----------
  // Una nota del disco puede nombrar imágenes de su carpeta. Subir imágenes es del plan pago (lo dice el servidor
  // con el cupo de adjuntos): con lugar, se ofrece subirlas y la copia de la nube pasa a nombrar los adjuntos, con el
  // mismo camino que una imagen pegada en una nota de la nube (images.js). Sin plan, o desde el lector de un archivo
  // del disco (ahí los adjuntos no viajan por la extensión), la nota va con sus rutas como están y se avisa.
  const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
  const IMG_MD = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;
  const localRef = (ref) => !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^[\/#]/.test(ref) && IMG_RE.test(ref.split(/[?#]/)[0]);
  const imagesIn = (text) => { const out = new Set(); for (const m of String(text || '').matchAll(IMG_MD)) if (localRef(m[2])) out.add(m[2]); return Array.from(out); };
  async function imageRoom(owner) {
    if (!core.APP || !LMD.images) return { ok: false, why: 'here' };
    try { const lim = await LMD.cloud.binary('GET', '/files' + (owner ? '?o=' + owner : '')); return lim && lim.max > 0 ? { ok: true, why: '' } : { ok: false, why: 'plan' }; }
    catch (e) { return { ok: false, why: 'here' }; }
  }
  // Dónde está la imagen que nombra una nota: al lado de su archivo en el explorador o, en una subida, entre lo
  // que vino con ella. Devuelve { key, get() } o nada.
  function picOf(st, item, ref) {
    if (item.url) {
      let at = '';
      try { at = new URL(ref, item.url).href.split(/[?#]/)[0]; } catch (e) { at = ''; }
      return at ? { key: at, get: async () => { const h = await core.vFile(at); if (!h) throw fail('missing'); return h.getFile(); } } : null;
    }
    const parts = item.rel.split('/').slice(0, -1); let path = '';
    try { for (const p of decodeURIComponent(ref.split(/[?#]/)[0]).split('/')) { if (p === '..') { if (!parts.length) return null; parts.pop(); } else if (p && p !== '.') parts.push(p); } path = parts.join('/'); } catch (e) { path = ''; }
    const n = path && st.bins ? st.bins.get(path) : null;
    return n ? { key: 'up ' + path, get: n.file } : null;
  }
  async function liftImages(st, item, text, full, res) {
    const map = new Map();
    for (const ref of item.imgs) {
      if (!st.withImages) break;
      const pic = picOf(st, item, ref);
      const key = ownerOf(full) + ' ' + (pic ? pic.key : '');
      if (st.imgDone.has(key)) { map.set(ref, st.imgDone.get(key)); continue; }
      try {
        if (!pic) throw fail('missing');
        const r = await LMD.images.upload(await LMD.images.reduce(await pic.get()), full);
        map.set(ref, r.src); st.imgDone.set(key, r.src); res.imgUp++;
      } catch (e) {
        res.imgLeft++;
        // Sin lugar, sin plan o sin conexión: las que faltan tampoco van a subir. Las notas siguen, con sus rutas.
        if (/^(files_need_plan|storage_full|offline|vault_locked)$/.test(e && e.code)) st.withImages = false;
      }
    }
    return map.size ? text.replace(IMG_MD, (all, a, ref, z) => (map.has(ref) ? a + map.get(ref) + z : all)) : text;
  }

  // ---------- La cuenta ----------
  // st es el envío en curso: qué se manda (items), a dónde (dest, y folder si es una carpeta), qué se hace con lo
  // que ya existe (mode) y lo que se sabe de la cuenta (lugar en el plan, qué hay en cada espacio).
  function calc(st) {
    const pre = (st.dest ? st.dest + '/' : '') + (st.folder ? st.folder + '/' : '');
    const sp = LMD.cloud.split(pre + 'x'); const owner = sp.owner; const set = st.lists[owner] || new Set();
    const inner = sp.path.slice(0, -1);
    const rows = st.items.map((it) => { const exists = set.has(inner + it.rel); return { it, full: pre + it.rel, inner: inner + it.rel, exists, bad: it.text == null ? it.why || 'read' : !okRel(it.rel) ? 'name' : '', uses: !exists || st.mode === 'rename' }; });
    const going = rows.filter((r) => !r.bad && !(r.exists && st.mode === 'skip'));
    const uses = going.filter((r) => r.uses);
    // El tope es de la nube propia del plan gratis. El espacio del equipo no lo tiene.
    const room = owner || st.limit == null ? Infinity : Math.max(0, st.limit - st.used);
    return { pre, owner, set, rows, going, uses, room, fits: uses.length <= room, exists: rows.filter((r) => r.exists && !r.bad).length };
  }
  // Lo que sale al final: lo que no ocupa lugar nuevo (reemplazar) va siempre; de lo demás, lo elegido si no entra todo.
  const jobsOf = (st, c) => c.going.filter((r) => !r.uses || c.fits || (st.picked && st.picked.has(r.it.rel)));
  const repick = (st) => { const c = calc(st); st.picked = c.fits ? null : new Set(c.uses.slice(0, c.room).map((r) => r.it.rel)); return c; };

  // Las carpetas de la nube adonde se puede enviar: la raíz propia con las suyas y, si la cuenta escribe ahí, el
  // espacio del equipo. Una carpeta protegida figura aunque esté vacía.
  function destRows(st) {
    const rows = [{ path: '', name: T('Nube'), depth: 0, icon: 'cloud' }];
    const under = (set, base, extra) => {
      const seen = new Set(extra || []);
      set.forEach((p) => { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) seen.add(parts.slice(0, i).join('/')); });
      Array.from(seen).sort((a, b) => a.split('/').join('\u0001').localeCompare(b.split('/').join('\u0001'), undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 400).forEach((f) => rows.push({ path: base + f, name: f.split('/').pop(), depth: f.split('/').length, icon: 'folder' }));
    };
    under(st.lists[''] || new Set(), '', LMD.cloud.vaultsNow().filter((v) => !v.team && v.folder).map((v) => v.folder));
    const tm = LMD.cloud.teamNow();
    if (tm && st.lists[tm.space] && LMD.cloud.teamCan('write')) { rows.push({ path: '~' + tm.space, name: tm.name || T('Equipo'), depth: 0, icon: 'people' }); under(st.lists[tm.space], '~' + tm.space + '/'); }
    return rows;
  }
  // El selector de carpeta, como el de "Mover a…": tocar una la elige. Devuelve la ruta, o null si se canceló.
  function pickDest(st) {
    const rows = destRows(st);
    return new Promise((resolve) => {
      const title = T('Enviar a…');
      const box = el('div', { class: 'lmd-ask lmd-mv lmd-send-pick' });
      box.innerHTML = '<div class="lmd-ask-card lmd-mv-card" role="dialog" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3><ul class="lmd-mv-list"></ul>' +
        '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-mv="no" data-esc>' + T('Cancelar') + '</button></div></div>';
      const list = box.querySelector('.lmd-mv-list');
      const row = (key, icon, name, depth, here) => {
        const b = el('button', { type: 'button', 'data-mv': key }, ICON[icon] || '');
        b.style.paddingLeft = (10 + depth * 16) + 'px';
        b.appendChild(el('span', { class: 'lmd-mv-name', text: name }));
        if (here) b.appendChild(el('small', { text: T('Elegida') }));
        const li = el('li'); li.appendChild(b); list.appendChild(li);
      };
      rows.forEach((r, i) => row(String(i), r.icon, r.name, r.depth, r.path === st.dest));
      row('new', 'plus', T('Nueva carpeta') + '…', 0, false);
      document.body.appendChild(box);
      const close = (value) => { box.remove(); resolve(value); };
      box.addEventListener('mousedown', (e) => { if (e.target === box) close(null); });
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-mv]'); if (!b) return;
        if (b.dataset.mv === 'no') return close(null);
        if (b.dataset.mv !== 'new') return close(rows[+b.dataset.mv].path);
        // En la nube una carpeta existe recién con una nota adentro: acá solo se elige su nombre.
        box.remove();
        const typed = await LMD.dialog.prompt({ title: T('Nombre de la carpeta nueva'), value: T('carpeta'), ok: T('Crear'), validate: (v) => (cloudPath(v) ? '' : T('Ese nombre tiene caracteres que no se pueden usar')) });
        resolve(typed ? cloudPath(typed) : null);
      });
    });
  }

  // ---------- El aviso del final ----------
  // Una tira al pie, como la de una versión nueva: lo que pasó y, si hay, el botón que abre lo enviado.
  let said = null;
  function notice(text, action, bad) {
    if (said) said.remove();
    const bar = el('div', { class: 'lmd-orphan lmd-sent' + (bad ? ' lmd-sent-bad' : ''), role: bad ? 'alert' : 'status' });
    bar.appendChild(el('span', { text }));
    if (action) { const go = el('button', { type: 'button', 'data-sent': 'open', text: action.label }); go.addEventListener('click', () => { bar.remove(); action.go(); }); bar.appendChild(go); }
    const x = el('button', { type: 'button', class: 'lmd-update-x', 'data-sent': 'close', title: T('Cerrar'), 'aria-label': T('Cerrar') }, ICON.close);
    x.addEventListener('click', () => bar.remove());
    bar.appendChild(x);
    document.body.appendChild(bar); said = bar;
    setTimeout(() => { if (bar.isConnected && !bar.matches(':hover') && !bar.contains(document.activeElement)) bar.remove(); }, action ? 20000 : 9000);
  }
  // Abre una nota de la nube: en la app, en el lugar; desde el lector de un archivo del disco, en la app.
  const openNote = (full) => (core.APP ? core.open(core.urlOf(full), { tree: true }) : core.openApp('?f=' + encodeURIComponent('cloud/' + full.split('/').map(encodeURIComponent).join('/'))));
  const plans = () => core.openPanel('plan', LMD.sync.full());
  const WHY = { too_large: 'demasiado grande', offline: 'sin conexión', note_limit: 'no entra en el plan gratis', bad_path: 'nombre que la nube no admite', name: 'nombre que la nube no admite', read: 'no se pudo leer',
    vault_locked: 'la carpeta está bloqueada', no_access: 'solo lectura', read_only: 'solo lectura', team_ended: 'el plan del equipo venció' };
  const whyText = (code) => T(WHY[code] || 'no se pudo enviar');
  const copyLine = (st) => T(st.up ? (st.dir ? 'Queda una copia en la nube. Los archivos de este dispositivo no cambian.' : 'Queda una copia en la nube. El archivo de este dispositivo no cambia.')
    : st.local ? (st.dir ? 'Queda una copia en la nube. Las notas de este navegador no cambian.' : 'Queda una copia en la nube. La nota de este navegador no cambia.')
    : st.dir ? 'Queda una copia en la nube. Los archivos del disco no cambian.' : 'Queda una copia en la nube. El archivo del disco no cambia.');
  const imageLine = (st) => T(st.imgWhy === 'plan' ? 'Subir imágenes es del plan pago: las notas van con sus rutas de imagen como están.' : 'Las imágenes no se suben desde acá: las notas van con sus rutas de imagen como están.');

  // ---------- Mandar ----------
  // De a una, sin frenar por la que falla. onStep(hechas, total); stop() dice si se pidió cancelar.
  async function run(st, onStep, stop) {
    const c = calc(st); const jobs = jobsOf(st, c);
    const res = { sent: [], skipped: [], failed: [], left: 0, cancelled: false, imgUp: 0, imgLeft: 0, total: jobs.length };
    c.rows.forEach((r) => { if (r.bad) res.failed.push({ rel: r.it.rel, why: r.bad }); else if (r.exists && st.mode === 'skip') res.skipped.push(r.it.rel); else if (!jobs.includes(r)) res.left++; });
    const taken = new Set(c.set); const no = new Set(); let full = false;
    for (let i = 0; i < jobs.length; i++) {
      const r = jobs[i];
      if (stop && stop()) { res.cancelled = true; res.left += jobs.length - i; break; }
      if (onStep) onStep(i, jobs.length, r.it.rel);
      // El plan se llenó en el medio (otra pestaña, otra persona): lo que falta no se intenta.
      if (full && r.uses) { res.failed.push({ rel: r.it.rel, why: 'note_limit' }); continue; }
      let path = r.full; let inner = r.inner;
      if (r.exists && st.mode === 'rename') { inner = freeName(taken, r.inner); path = r.full.slice(0, r.full.length - r.inner.length) + inner; }
      const send = async () => LMD.cloud.write(path, st.withImages && r.it.imgs.length ? await liftImages(st, r.it, r.it.text, path, res) : r.it.text);
      try {
        try { await send(); }
        catch (e) {
          // Una carpeta protegida y bloqueada: se pide la contraseña una vez. Si la persona no la da, sus notas no van.
          const key = e && e.vault ? String(e.vault.id || e.vault.folder || 'x') : '';
          if (!e || e.code !== 'vault_locked' || no.has(key)) throw e;
          if (!(await LMD.vault.unlockFor(path))) { no.add(key); throw e; }
          await send();
        }
        taken.add(inner); res.sent.push({ rel: r.it.rel, full: path, renamed: path !== r.full });
      } catch (e) {
        const code = (e && e.status === 413 ? 'too_large' : e && e.code) || 'failed';
        if (code === 'note_limit') full = true;
        res.failed.push({ rel: r.it.rel, why: code });
      }
    }
    if (onStep) onStep(jobs.length, jobs.length, '');
    // La cuenta y el explorador se ponen al día: cuántas notas hay ahora, y lo enviado a la vista.
    try { await LMD.sync.reload(); if (LMD.home && LMD.home.account) LMD.home.account(); } catch (e) { /* queda para la próxima consulta */ }
    if (res.sent.length && core.cloudTree) { try { await core.reloadTree(); } catch (e) { /* se redibuja en la próxima */ } }
    return res;
  }

  // ---------- La ventana ----------
  // Una sola, que pasa por tres estados: lo que se va a mandar (con lo que haya que decidir), el avance y el resumen.
  // Devuelve cuando se cierra.
  function dialog(st, title) {
    return new Promise((resolve) => {
      const box = el('div', { class: 'lmd-ask lmd-send' });
      box.innerHTML = '<div class="lmd-ask-card lmd-send-card" role="dialog" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3><div class="lmd-send-body"></div><div class="lmd-ask-actions"></div></div>';
      const body = box.querySelector('.lmd-send-body'); const acts = box.querySelector('.lmd-ask-actions');
      let state = 'ask'; let stopped = false; let result = null;
      const close = () => { if (!box.isConnected) return; box.remove(); resolve(result); };
      const btn = (key, text, cls, esc2) => { const b = el('button', { type: 'button', class: 'lmd-btn' + (cls ? ' ' + cls : ''), 'data-sd': key, text }); if (esc2) b.setAttribute('data-esc', ''); acts.appendChild(b); return b; };
      const line = (cls, text) => body.appendChild(el('p', { class: cls, text }));

      function draw() {
        const c = calc(st); const jobs = jobsOf(st, c); const n = jobs.length; const total = st.items.length;
        body.textContent = ''; acts.textContent = '';
        line('lmd-send-copy', copyLine(st));
        const where = el('div', { class: 'lmd-send-row' });
        where.append(el('span', { class: 'lmd-send-k', text: T('Destino') }), el('span', { class: 'lmd-send-dest', text: destLabel(st.dest, st.folder) }));
        if (!st.fixed) where.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-sd': 'dest', text: T('Cambiar…') }));
        body.appendChild(where);
        // Cuántas notas, cuántas ya existen y cuánto lugar queda.
        const sum = [];
        if (st.dir) sum.push(total === 1 ? T('1 nota') : T('{n} notas', { n: total }));
        if (st.dir && c.exists) sum.push(c.exists === 1 ? T('1 ya existe') : T('{n} ya existen', { n: c.exists }));
        if (c.owner) sum.push(T('Espacio del equipo: sin tope'));
        else if (st.limit == null) { if (st.dir) sum.push(T('Plan pago: sin tope')); }
        else if (st.dir || !c.fits) { const left = Math.max(0, st.limit - st.used); sum.push(left === 1 ? T('Plan gratis: queda 1 lugar de {m}', { m: st.limit }) : T('Plan gratis: quedan {a} lugares de {m}', { a: left, m: st.limit })); }
        if (sum.length) line('lmd-send-sum', sum.join(' · '));
        if (st.more) line('lmd-hint lmd-send-more', T('La carpeta es muy grande: se toman las primeras {n} notas.', { n: total }));
        // De una subida, lo que no es una nota se dice: no viaja.
        if (st.up && st.other) line('lmd-hint lmd-send-other', st.other === 1 ? T('1 archivo no es una nota y no se sube.') : T('{n} archivos no son notas y no se suben.', { n: st.other }));
        if (c.exists) {
          const row = el('div', { class: 'lmd-send-row lmd-send-clash' });
          row.appendChild(el('span', { class: 'lmd-send-k', text: T(st.dir ? 'Las que ya existen' : 'Ya hay una nota con ese nombre') }));
          const seg = el('div', { class: 'lmd-seg', role: 'group' });
          [['skip', 'Saltear'], ['replace', 'Reemplazar'], ['rename', 'Guardar con otro nombre']].forEach((m) => seg.appendChild(el('button', { type: 'button', class: st.mode === m[0] ? 'lmd-on' : '', 'data-mode': m[0], 'aria-pressed': String(st.mode === m[0]), text: T(m[1]) })));
          row.appendChild(seg); body.appendChild(row);
        }
        if (!c.fits) {
          line('lmd-send-warn', T('Entran {a} de {b}. El plan pago no tiene tope.', { a: c.room, b: c.uses.length })).setAttribute('role', 'alert');
          if (c.room > 0 && c.uses.length > 1) {
            body.appendChild(el('p', { class: 'lmd-send-k lmd-send-which', text: T('Elegí cuáles van') }));
            const ul = el('ul', { class: 'lmd-send-list' });
            c.uses.slice(0, LIST_MAX * 5).forEach((r) => {
              const on = st.picked.has(r.it.rel);
              const li = el('li'); const lab = el('label');
              const box2 = el('input', { type: 'checkbox', 'data-pick': r.it.rel }); box2.checked = on; box2.disabled = !on && st.picked.size >= c.room;
              lab.append(box2, el('span', { text: r.it.rel })); li.appendChild(lab); ul.appendChild(li);
            });
            body.appendChild(ul);
          }
        }
        if (st.images) {
          if (st.imgOk) {
            const lab = el('label', { class: 'lmd-send-img' }); const box2 = el('input', { type: 'checkbox', 'data-sd-img': '' }); box2.checked = st.withImages;
            lab.append(box2, el('span', { text: st.images === 1 ? T('Subir también 1 imagen, y que la copia apunte a ella') : T('Subir también {n} imágenes, y que las copias apunten a ellas', { n: st.images }) }));
            body.appendChild(lab);
          } else line('lmd-hint lmd-send-imgs', imageLine(st));
        }
        if (!n) line('lmd-hint lmd-send-none', T(c.fits ? 'No hay nada nuevo para enviar.' : 'El plan gratis está lleno.'));
        btn('no', T('Cancelar'), '', true);
        if (!c.fits && !LMD.storeApp) btn('plans', T('Ver planes'));
        const go = btn('go', !st.dir ? T('Enviar') : n === 1 ? T('Enviar 1 nota') : T('Enviar {n} notas', { n }), 'lmd-btn-fill');
        go.disabled = !n;
        if (n) setTimeout(() => { if (go.isConnected && !box.contains(document.activeElement)) go.focus(); }, 0);
      }

      function progress(done, total) {
        if (state !== 'run') return;
        const p = body.querySelector('.lmd-send-now'); const bar = body.querySelector('.lmd-send-bar i');
        if (p) p.textContent = stopped ? T('Cancelando…') : T('Enviando {a} de {b}…', { a: Math.min(done + 1, total), b: total });
        if (bar) bar.style.width = (total ? Math.round(done * 100 / total) : 100) + '%';
      }
      async function send() {
        state = 'run'; body.textContent = ''; acts.textContent = '';
        line('lmd-send-copy', copyLine(st));
        body.appendChild(el('p', { class: 'lmd-send-now', role: 'status', text: T('Enviando…') }));
        body.appendChild(el('div', { class: 'lmd-send-bar', 'aria-hidden': 'true' }, '<i></i>'));
        btn('stop', T('Cancelar'), '', true);
        let res;
        try { res = await run(st, progress, () => stopped); }
        catch (e) { res = { sent: [], skipped: [], failed: [{ rel: '', why: (e && e.code) || 'failed' }], left: 0, cancelled: false, imgUp: 0, imgLeft: 0, total: 0 }; }
        result = res; done(res);
      }
      function done(res) {
        state = 'done'; body.textContent = ''; acts.textContent = '';
        const sent = res.sent.length; const parts = [];
        parts.push(sent === 1 ? T('Se envió 1 nota.') : T('Se enviaron {n} notas.', { n: sent }));
        if (res.skipped.length) parts.push(res.skipped.length === 1 ? T('1 ya existía y se salteó.') : T('{n} ya existían y se saltearon.', { n: res.skipped.length }));
        if (res.cancelled) parts.push(res.left === 1 ? T('Se canceló: quedó 1 sin enviar.') : T('Se canceló: quedaron {n} sin enviar.', { n: res.left }));
        else if (res.left) parts.push(res.left === 1 ? T('1 quedó afuera porque no entra en el plan.') : T('{n} quedaron afuera porque no entran en el plan.', { n: res.left }));
        line('lmd-send-sum lmd-send-result', parts.join(' ')).setAttribute('role', 'status');
        if (res.failed.length) {
          line('lmd-send-k lmd-send-failk', res.failed.length === 1 ? T('1 no se pudo enviar') : T('{n} no se pudieron enviar', { n: res.failed.length }));
          const ul = el('ul', { class: 'lmd-send-list lmd-send-fails' });
          res.failed.slice(0, LIST_MAX).forEach((f) => { const li = el('li'); li.append(el('span', { text: f.rel || T('El envío') }), el('small', { text: whyText(f.why) })); ul.appendChild(li); });
          if (res.failed.length > LIST_MAX) ul.appendChild(el('li', { text: T('y {n} más', { n: res.failed.length - LIST_MAX }) }));
          body.appendChild(ul);
        }
        if (res.imgUp) line('lmd-hint', res.imgUp === 1 ? T('Se subió 1 imagen.') : T('Se subieron {n} imágenes.', { n: res.imgUp }));
        if (res.imgLeft) line('lmd-hint', res.imgLeft === 1 ? T('1 imagen no se pudo subir: quedó con su ruta.') : T('{n} imágenes no se pudieron subir: quedaron con su ruta.', { n: res.imgLeft }));
        else if (st.images && !st.imgOk && sent) line('lmd-hint lmd-send-imgs', imageLine(st));
        if (sent) line('lmd-hint', copyLine(st));
        btn('no', T('Cerrar'), sent ? '' : 'lmd-btn-fill', true);
        if (res.failed.some((f) => f.why === 'note_limit') && !LMD.storeApp) btn('plans', T('Ver planes'));
        if (sent) { const b = btn('open', st.dir ? T('Ver en la nube') : T('Abrir la nota de la nube'), 'lmd-btn-fill'); setTimeout(() => { if (b.isConnected) b.focus(); }, 0); }
      }

      box.addEventListener('mousedown', (e) => { if (e.target === box && state !== 'run') close(); });
      box.addEventListener('change', (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { const c = calc(st); if (pick.checked && st.picked.size < c.room) st.picked.add(pick.dataset.pick); else st.picked.delete(pick.dataset.pick); draw(); const again = body.querySelector('[data-pick="' + CSS.escape(pick.dataset.pick) + '"]'); if (again) again.focus(); return; }
        if (e.target.closest('[data-sd-img]')) st.withImages = e.target.checked;
      });
      box.addEventListener('click', async (e) => {
        const mode = e.target.closest('[data-mode]');
        if (mode && state === 'ask') { st.mode = mode.dataset.mode; repick(st); draw(); const b = body.querySelector('[data-mode=' + st.mode + ']'); if (b) b.focus(); return; }
        const b = e.target.closest('[data-sd]'); if (!b || b.disabled) return;
        const k = b.dataset.sd;
        if (k === 'stop') { stopped = true; b.disabled = true; progress(0, 0); return; }
        if (k === 'no') return close();
        if (k === 'plans') { close(); plans(); return; }
        if (k === 'open') { const res = result; close(); if (st.dir) core.reveal(core.urlOf(calc(st).pre.replace(/\/$/, '')) + (calc(st).pre ? '/' : '')); else if (res && res.sent[0]) openNote(res.sent[0].full); return; }
        if (k === 'dest') {
          const to = await pickDest(st);
          if (to == null || !box.isConnected) return;
          if (!writable(to)) return;
          st.dest = to; repick(st); draw();
          return;
        }
        if (k === 'go' && state === 'ask') {
          // Un destino protegido se desbloquea antes de empezar; si la persona no da la contraseña, no se manda nada.
          b.disabled = true;
          let ok = false;
          try { ok = await LMD.vault.unlockFor(calc(st).pre + 'x'); } catch (err) { ok = false; }
          if (!box.isConnected) return;
          if (!ok) { b.disabled = false; return; }
          if (st.dir) return send();
          // Una sola nota: la ventana se cierra y el resultado sale en el aviso del pie.
          result = { quiet: true }; close();
        }
      });
      document.body.appendChild(box);
      repick(st); draw();
    });
  }

  // ---------- El recorrido ----------
  // src: la fuente (fromUrl o fromNodes). opt.dest: el destino ya está dicho (se soltó sobre una carpeta de la nube
  // o sobre la sección, o se subió desde su menú).
  async function flow(src, opt) {
    const dir = src.dir; const url = src.url; const name = src.name;
    if (opt.dest != null && !writable(opt.dest)) { notice(T(LMD.cloud.isTeam(opt.dest + '/') ? 'En este equipo solo podés leer.' : 'Esta carpeta es de solo lectura'), null, true); return; }
    // La cuenta, como está ahora: cuántas notas tiene y cuántas entran. Sin eso no se manda nada.
    const acct = await LMD.sync.reload();
    const st = { url, dir, local: src.local, up: src.up, fixed: opt.dest != null, dest: opt.dest || '', folder: '', mode: dir ? 'skip' : 'rename', items: [], more: false, other: 0, bins: null,
      limit: acct && acct.limit ? acct.limit : null, used: (acct && acct.notes) || 0, lists: {}, picked: null, images: 0, imgOk: false, imgWhy: '', withImages: false, imgDone: new Map() };
    st.lists[''] = new Set((await LMD.cloud.list(true)).map((n) => n.path));
    const tm = LMD.cloud.teamNow();
    if (tm && LMD.cloud.teamCan('write')) { try { st.lists[tm.space] = new Set((await LMD.cloud.list(true, tm.space)).map((n) => n.path)); } catch (e) { /* sin el espacio del equipo, queda la nube propia */ } }
    try { await LMD.cloud.vaults(); } catch (e) { /* sin la lista de carpetas protegidas se sigue igual */ }
    let got = null;
    try { got = await gather(src); } catch (e) { notice(T(src.up ? 'No se pudieron leer esos archivos.' : 'No se pudo leer esta carpeta.'), null, true); return; }
    st.items = got.items; st.more = got.more; st.other = got.other; st.bins = got.bins;
    if (src.rooted) st.folder = cleanName(name);
    if (!st.items.length) { notice(T(src.up ? 'Solo se suben notas: archivos Markdown y de texto.' : 'Ahí no hay notas para enviar.'), null, true); return; }
    if (!dir && url) {
      // Por defecto va a la raíz, o a la carpeta de la nube que se llama como la carpeta de donde sale, si ya existe.
      const from = st.local ? '' : cleanName(nameOf(new URL('.', url).href));
      if (!st.fixed && from && Array.from(st.lists['']).some((p) => p.startsWith(from + '/'))) st.dest = from;
    }
    for (const it of st.items) {
      try { it.text = await it.read(); } catch (e) { it.text = null; it.why = e && e.code === 'too_large' ? 'too_large' : ''; }
      // De una subida solo cuentan las imágenes que vinieron con ella: las otras no hay de dónde sacarlas.
      it.imgs = it.text == null || st.local ? [] : imagesIn(it.text).filter((ref) => it.url || picOf(st, it, ref));
    }
    // Una sola nota que no se puede leer, o con un nombre que la nube no admite: se dice y no hay más que decidir.
    if (!dir) { const no = st.items[0].text == null ? st.items[0].why || 'read' : !okRel(st.items[0].rel) ? 'name' : ''; if (no) { notice(T('No se pudo enviar "{a}": {b}.', { a: name, b: whyText(no) }), null, true); return; } }
    st.images = st.items.reduce((n, it) => n + it.imgs.length, 0);
    // Las imágenes que una nota nombra tienen su propio renglón: no se cuentan entre lo que no se sube.
    if (st.up && st.images) { const named = new Set(); st.items.forEach((it) => it.imgs.forEach((ref) => named.add(picOf(st, it, ref).key))); st.other = Math.max(0, st.other - named.size); }
    if (st.images) { const room = await imageRoom(ownerOf(st.dest)); st.imgOk = room.ok; st.imgWhy = room.why; st.withImages = room.ok; }

    const c = repick(st);
    const folders = destRows(st).length > 1;
    const ask = dir || (!st.fixed && folders) || c.exists > 0 || !c.fits || (st.images > 0 && st.imgOk) || c.rows.some((r) => r.bad);
    const title = src.up ? (src.rooted ? T('Subir la carpeta "{a}" a la nube', { a: name }) : dir ? T('Subir notas a la nube') : T('Subir "{a}" a la nube', { a: name }))
      : dir ? (name ? T('Enviar la carpeta "{a}" a la nube', { a: name }) : T('Enviar todas las notas a la nube')) : T('Enviar "{a}" a la nube', { a: name });
    if (ask) {
      const out = await dialog(st, title);
      if (dir || !out || !out.quiet) return;
    } else if (!(await LMD.vault.unlockFor(calc(st).pre + 'x'))) return;
    // Una sola nota: sale ya, y el resultado va al pie.
    const res = await run(st);
    const one = res.sent[0];
    if (one) {
      notice((one.renamed ? T('Se guardó como "{a}".', { a: one.full.split('/').pop() }) + ' ' : '') + copyLine(st) + (res.imgLeft || (st.images && !st.imgOk) ? ' ' + imageLine(st) : ''), { label: T('Abrir la nota de la nube'), go: () => openNote(one.full) });
    } else if (res.skipped.length) notice(T('No se envió: ya hay una nota con ese nombre.'), null, true);
    else if (res.failed.some((f) => f.why === 'note_limit')) plans();
    else notice(T('No se pudo enviar "{a}": {b}.', { a: name, b: whyText((res.failed[0] || {}).why) }), null, true);
  }

  // Sin sesión: se dice en una línea, con el botón para entrar. Al entrar (acá o en la app, que comparte la sesión
  // con la extensión) el envío sigue solo, mientras esta pestaña siga abierta.
  let waiting = 0;
  async function needLogin(again) {
    const go = await LMD.dialog.confirm({ title: T('Enviar a la nube'), text: T('Para enviar a la nube hay que entrar a la cuenta. Al entrar, el envío sigue.'), ok: T('Entrar') });
    if (!go) return;
    clearInterval(waiting);
    const until = Date.now() + 10 * 60000;
    waiting = setInterval(() => {
      if (Date.now() > until) { clearInterval(waiting); return; }
      if (!LMD.cloud.signedIn()) return;
      clearInterval(waiting); again();
    }, 700);
    core.signIn();
  }

  let busy = false;
  async function begin(src, opt) {
    if (!core) return;
    try { await LMD.cloud.ready(); } catch (e) { return; }
    if (!src.ok()) return;
    if (!LMD.cloud.signedIn()) return needLogin(() => begin(src, opt));
    if (busy) return;
    busy = true;
    try { await flow(src, opt || {}); }
    catch (e) { notice(T(e && e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo enviar a la nube.'), null, true); }
    finally { busy = false; }
  }
  const start = (url, opt) => begin(fromUrl(url), opt);

  // ---------- Subir desde la computadora o el teléfono ----------
  // Una carpeta de la nube (o su raíz, o la del equipo) donde esta cuenta puede dejar notas.
  const canUp = (url) => reach() && LMD.cloud.signedIn() && !!url && url.startsWith(VB + 'cloud/') && isDirUrl(url) && writable(core.pathOf(url));
  // Una carpeta entera se elige con el selector de carpetas del navegador o, donde no existe, con un input de
  // carpeta. Donde no hay ninguno de los dos, la opción no se ofrece.
  const canDir = () => !!window.showDirectoryPicker || 'webkitdirectory' in HTMLInputElement.prototype;
  // Abre el selector: 'files' (varios archivos) o 'dir' (una carpeta). Se llama derecho desde el clic, que es lo que
  // el navegador pide para abrirlo. dirUrl es la carpeta de la nube adonde va lo elegido.
  let chooser = null;
  function pick(what, dirUrl) {
    if (!canUp(dirUrl)) return;
    const dest = core.pathOf(dirUrl);
    if (what === 'dir' && window.showDirectoryPicker) {
      let asked = null;
      try { asked = window.showDirectoryPicker({ mode: 'read' }); } catch (e) { asked = Promise.reject(e); }
      Promise.resolve(asked).then((h) => { if (h) begin(fromNodes([handleNode(h)]), { dest }); }, (e) => { if (!e || e.name !== 'AbortError') notice(T('No se pudo abrir. Probá de nuevo.'), null, true); });
      return;
    }
    if (chooser) chooser.remove();
    const input = chooser = el('input', { type: 'file', class: 'lmd-send-input', hidden: '', tabindex: '-1', 'aria-hidden': 'true' });
    if (what === 'dir') input.webkitdirectory = true; else input.multiple = true;
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []); input.remove(); if (chooser === input) chooser = null;
      if (!files.length) return;
      begin(fromNodes(what === 'dir' ? treeOf(files) : files.map((f) => fileNode(f))), { dest });
    });
    input.addEventListener('cancel', () => { input.remove(); if (chooser === input) chooser = null; });
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  }

  // ---------- Soltar sobre la nube ----------
  // Dónde caería lo arrastrado: la sección Nube (o la del equipo) es su raíz, y una carpeta de adentro, esa carpeta.
  // Devuelve { dest, mark } o nada si ahí no se puede enviar (otra sección, o un espacio donde la cuenta solo lee).
  function target(e) {
    const t = e.target; if (!t || !t.closest) return null;
    const sec = t.closest('.lmd-xroot[data-root=cloud], .lmd-xroot[data-root=team]');
    const list = sec && sec.querySelector('.lmd-tree'); const top = (list && list.dataset.url) || '';
    if (!top || !LMD.cloud.signedIn()) return null;
    let node = t.closest('.lmd-node-dir');
    if (!node) { const kids = t.closest('.lmd-node-kids'); node = kids && kids.previousElementSibling; while (node && !node.classList.contains('lmd-node-dir')) node = node.previousElementSibling; }
    const dest = core.pathOf(node ? node.dataset.url : top);
    return writable(dest) ? { dest, mark: node || sec } : null;
  }

  // ---------- Soltar desde el sistema ----------
  // Archivos o carpetas arrastrados desde afuera (el Explorador de Windows, el Finder) y soltados sobre la sección
  // Nube o una de sus carpetas: suben ahí, con sus subcarpetas. En cualquier otro lugar de la ventana, soltar un
  // archivo hace lo de siempre (abrirlo, importarlo, pegar una imagen en la nota): por eso esto escucha primero y
  // solo se queda con lo que cae sobre la nube.
  const fromOs = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const osTarget = (e) => (fromOs(e) && reach() ? target(e) : null);
  let over = null; let tag = null;
  function mark(s, e) {
    const node = s ? s.mark : null;
    if (over !== node) { if (over) over.classList.remove('lmd-drop'); over = node; if (node) node.classList.add('lmd-drop'); }
    if (!node) { if (tag) { tag.remove(); tag = null; } return; }
    if (!tag) { tag = el('div', { class: 'lmd-drop-tag', 'aria-hidden': 'true' }, ICON.cloud); tag.appendChild(el('span', { text: T('Subir notas a la nube') })); document.body.appendChild(tag); }
    tag.style.transform = 'translate(' + Math.round(Math.min(window.innerWidth - tag.offsetWidth - 8, e.clientX + 16)) + 'px,' + Math.round(Math.min(window.innerHeight - tag.offsetHeight - 8, e.clientY + 18)) + 'px)';
  }
  // Lo soltado, como nodos. Hay que pedirlo mientras dura el evento: después el navegador ya no lo entrega.
  // Una carpeta llega por webkitGetAsEntry (todos los navegadores) o por su handle (Chromium); un archivo suelto,
  // además, como File.
  function taken(dt) {
    const out = [];
    for (const it of Array.from(dt.items || [])) {
      if (it.kind !== 'file') continue;
      let en = null; let later = null; let f = null;
      try { en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch (e) { en = null; }
      if (en) { out.push(entryNode(en)); continue; }
      try { later = it.getAsFileSystemHandle ? it.getAsFileSystemHandle() : null; } catch (e) { later = null; }
      try { f = it.getAsFile(); } catch (e) { f = null; }
      const plain = f ? fileNode(f) : null;
      out.push(later ? Promise.resolve(later).then((h) => (h ? handleNode(h) : plain), () => plain) : plain);
    }
    if (!out.length) Array.from(dt.files || []).forEach((f) => out.push(fileNode(f)));
    return Promise.all(out).then((all) => all.filter(Boolean));
  }
  function bindDrop() {
    window.addEventListener('dragover', (e) => {
      const s = osTarget(e);
      if (!s) { mark(null); return; }
      e.preventDefault(); e.stopImmediatePropagation(); e.dataTransfer.dropEffect = 'copy'; mark(s, e);
    }, true);
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) mark(null); }, true);
    window.addEventListener('dragend', () => mark(null), true);
    window.addEventListener('drop', (e) => {
      const s = osTarget(e); mark(null);
      if (!s) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (core.ui.home) core.ui.home.classList.remove('lmd-drop');
      taken(e.dataTransfer).then((tops) => { if (tops.length) begin(fromNodes(tops), { dest: s.dest }); });
    }, true);
  }

  // Se engancha antes que los otros que miran lo que se suelta en la ventana (el visor, importar): va primero.
  function init(c) { core = c; bindDrop(); }

  LMD.send = { init, can, start, target, drop: (url, dest) => start(url, { dest }), canUp, canDir, pick };
})();
