// Enviar a la nube: una copia de un archivo, o de una carpeta entera con sus subcarpetas, del disco o de "En este
// navegador". Sale del menú del explorador (clic derecho, o mantener apretado en el teléfono) y de arrastrar hasta la
// sección Nube o una de sus carpetas (extras.js). Siempre es una copia: lo que está en el disco no se toca ni se borra.
// Antes de mandar se mira todo: qué ya existe en el destino, cuánto lugar queda en el plan (el número sale de la
// cuenta, nunca de acá) y si el destino está protegido. Lo que no entra se dice antes de empezar, nunca a mitad.
// Anda igual en la app y en el lector de un archivo del disco, que le habla al servidor por la extensión.
(function () {
  'use strict';

  const { el, ICON, MD_RE, SKIP_DIRS, esc } = LMD.kit;
  const T = LMD.t;
  let core = null;

  const VB = 'https://lmd.local/';
  const MAX_FILES = 2000; const MAX_DEPTH = 12; const LIST_MAX = 60;
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
  // Los Markdown y los textos de una carpeta y sus subcarpetas, con su ruta adentro de ella. Lo oculto y las carpetas
  // que no son de notas (node_modules, .git) quedan afuera, igual que en la búsqueda y en los contadores.
  async function collect(dirUrl) {
    const out = []; let more = false;
    const walk = async (url, rel, depth) => {
      let rows = null;
      try { rows = await core.listDir(url, true); } catch (e) { rows = null; }
      if (!rows) { if (!depth) throw fail('read'); return; }
      rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const r of rows) {
        if (r.name.startsWith('.')) continue;
        if (r.dir) {
          if (SKIP_DIRS.test(r.name)) continue;
          if (depth >= MAX_DEPTH) { more = true; continue; }
          await walk(r.url, rel + r.name + '/', depth + 1);
        } else if (isNote(r.name)) {
          if (out.length >= MAX_FILES) { more = true; return; }
          out.push({ url: r.url, rel: rel + r.name });
        }
      }
    };
    await walk(dirUrl, '', 0);
    return { items: out, more };
  }
  // El texto como está ahora. La nota abierta va con lo que se ve, esté guardado o no.
  const textOf = async (url) => (!core.noDoc && url === core.HERE ? core.raw : core.readNow(url));

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
  async function liftImages(st, item, text, full, res) {
    const map = new Map();
    for (const ref of item.imgs) {
      if (!st.withImages) break;
      let at = '';
      try { at = new URL(ref, item.url).href.split(/[?#]/)[0]; } catch (e) { at = ''; }
      const key = ownerOf(full) + ' ' + at;
      if (st.imgDone.has(key)) { map.set(ref, st.imgDone.get(key)); continue; }
      try {
        const h = at ? await core.vFile(at) : null;
        if (!h) throw fail('missing');
        const r = await LMD.images.upload(await LMD.images.reduce(await h.getFile()), full);
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
    const rows = st.items.map((it) => { const exists = set.has(inner + it.rel); return { it, full: pre + it.rel, inner: inner + it.rel, exists, bad: it.text == null ? 'read' : !okRel(it.rel) ? 'name' : '', uses: !exists || st.mode === 'rename' }; });
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
  const copyLine = (st) => T(st.local ? (st.dir ? 'Queda una copia en la nube. Las notas de este navegador no cambian.' : 'Queda una copia en la nube. La nota de este navegador no cambia.')
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
  // opt.dest: el destino ya está dicho (se soltó sobre una carpeta de la nube o sobre la sección).
  async function flow(url, opt) {
    const dir = isDirUrl(url); const k = kindOf(url);
    if (opt.dest != null && !writable(opt.dest)) { notice(T(LMD.cloud.isTeam(opt.dest + '/') ? 'En este equipo solo podés leer.' : 'Esta carpeta es de solo lectura'), null, true); return; }
    // La cuenta, como está ahora: cuántas notas tiene y cuántas entran. Sin eso no se manda nada.
    const acct = await LMD.sync.reload();
    const st = { url, dir, local: k === 'local', fixed: opt.dest != null, dest: opt.dest || '', folder: '', mode: dir ? 'skip' : 'rename', items: [], more: false,
      limit: acct && acct.limit ? acct.limit : null, used: (acct && acct.notes) || 0, lists: {}, picked: null, images: 0, imgOk: false, imgWhy: '', withImages: false, imgDone: new Map() };
    st.lists[''] = new Set((await LMD.cloud.list(true)).map((n) => n.path));
    const tm = LMD.cloud.teamNow();
    if (tm && LMD.cloud.teamCan('write')) { try { st.lists[tm.space] = new Set((await LMD.cloud.list(true, tm.space)).map((n) => n.path)); } catch (e) { /* sin el espacio del equipo, queda la nube propia */ } }
    try { await LMD.cloud.vaults(); } catch (e) { /* sin la lista de carpetas protegidas se sigue igual */ }
    const name = nameOf(url);
    if (dir) {
      let got = null;
      try { got = await collect(url); } catch (e) { notice(T('No se pudo leer esta carpeta.'), null, true); return; }
      st.items = got.items; st.more = got.more; st.folder = cleanName(name);
      if (!st.items.length) { notice(T('Ahí no hay notas para enviar.'), null, true); return; }
    } else {
      st.items = [{ url, rel: name }];
      // Por defecto va a la raíz, o a la carpeta de la nube que se llama como la carpeta de donde sale, si ya existe.
      const from = st.local ? '' : cleanName(nameOf(new URL('.', url).href));
      if (!st.fixed && from && Array.from(st.lists['']).some((p) => p.startsWith(from + '/'))) st.dest = from;
    }
    for (const it of st.items) { try { it.text = await textOf(it.url); } catch (e) { it.text = null; } it.imgs = it.text == null || st.local ? [] : imagesIn(it.text); }
    // Una sola nota que no se puede leer, o con un nombre que la nube no admite: se dice y no hay más que decidir.
    if (!dir) { const no = st.items[0].text == null ? 'read' : !okRel(st.items[0].rel) ? 'name' : ''; if (no) { notice(T('No se pudo enviar "{a}": {b}.', { a: name, b: whyText(no) }), null, true); return; } }
    st.images = st.items.reduce((n, it) => n + it.imgs.length, 0);
    if (st.images) { const room = await imageRoom(ownerOf(st.dest)); st.imgOk = room.ok; st.imgWhy = room.why; st.withImages = room.ok; }

    const c = repick(st);
    const folders = destRows(st).length > 1;
    const ask = dir || (!st.fixed && folders) || c.exists > 0 || !c.fits || (st.images > 0 && st.imgOk) || c.rows.some((r) => r.bad);
    const title = dir ? (name ? T('Enviar la carpeta "{a}" a la nube', { a: name }) : T('Enviar todas las notas a la nube')) : T('Enviar "{a}" a la nube', { a: name });
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
  async function start(url, opt) {
    if (!core) return;
    try { await LMD.cloud.ready(); } catch (e) { return; }
    if (!can(url)) return;
    if (!LMD.cloud.signedIn()) return needLogin(() => start(url, opt));
    if (busy) return;
    busy = true;
    try { await flow(url, opt || {}); }
    catch (e) { notice(T(e && e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo enviar a la nube.'), null, true); }
    finally { busy = false; }
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

  function init(c) { core = c; }

  LMD.send = { init, can, start, target, drop: (url, dest) => start(url, { dest }) };
})();
