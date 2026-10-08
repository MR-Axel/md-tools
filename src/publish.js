// Publicar: una carpeta de notas de la nube como sitio web público, con menú, buscador y tema.
// Las páginas se dibujan acá, en el navegador de quien publica, por el mismo camino que exportar a HTML (el
// servidor no tiene con qué convertir Markdown): fórmulas y diagramas ya van dibujados, y de cada nota viaja solo
// el cuerpo. Los diagramas salen como imagen, así la página publicada no necesita estilos ni scripts propios de la
// nota. El servidor vuelve a filtrar lo que recibe y es quien decide qué entra: solo notas de la carpeta elegida,
// nunca las de una carpeta con contraseña ni las que llevan publish: false en su encabezado.
// Se carga recién cuando hace falta (core.ensure('publish')).
(function () {
  'use strict';

  const { el, esc, ICON } = LMD.kit;
  const T = LMD.t;
  const api = (m, p, b) => LMD.cloud.api(m, p, b);

  // Las mismas tipografías de Ajustes, por el nombre que conoce el servidor. La primera es la del sitio.
  const FONTS = [['', 'Del sistema'], ['Arial', 'Arial'], ['Calibri', 'Calibri'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Georgia', 'Georgia'], ['Cambria', 'Cambria'], ['Palatino', 'Palatino'],
    ['Times New Roman', 'Times New Roman'], ['Consolas', 'Consolas'], ['Courier New', 'Courier New']];
  const WHY = {
    offline: 'No hay conexión con el servidor.', site_needs_plan: 'Publicar un sitio es parte del plan pago.', site_limit: 'Tu plan incluye un sitio. Para publicar otra carpeta, eliminá el que tenés.',
    bad_slug: 'La dirección lleva minúsculas, números y guiones, de 3 a 40.', slug_reserved: 'Esa dirección está reservada. Probá con otra.', slug_taken: 'Esa dirección ya está en uso. Probá con otra.',
    bad_title: 'Escribí un título.', bad_author: 'El nombre de autor no puede ser un correo.', vault: 'Una carpeta protegida no se publica.', no_notes: 'Esa carpeta no tiene notas para publicar.',
    team_policy: 'Lo administra quien administra el equipo', read_only: 'En este equipo solo podés leer.', site_suspended: 'Este sitio está suspendido.', site_empty: 'Todavía no hay páginas para publicar.',
    site_full: 'El sitio llegó al tope de páginas.', site_too_big: 'El sitio llegó al tope de tamaño.', too_large: 'Una página es demasiado grande para publicarla.', too_many: 'Demasiados cambios seguidos. Probá más tarde.',
    not_found: 'Ese sitio ya no está.', no_route: 'Este servidor no publica sitios.',
  };
  const why = (e) => T(WHY[e && e.code] || 'No se pudo completar. Probá de nuevo.');
  const pre = (site) => (site.o ? '~' + site.o + '/' : '');
  const where = (full) => { const m = /^~(\d+)\/(.+)$/.exec(full); return m ? { o: +m[1], folder: m[2] } : { o: 0, folder: full }; };
  const day = (ms) => new Date(ms).toLocaleDateString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { day: 'numeric', month: 'long' });
  const bare = (url) => String(url).replace(/^https?:\/\//, '');
  // Una dirección que sirva a partir del nombre de la carpeta.
  const slugOf = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

  // ---------- Una nota como página ----------
  // Un diagrama pasa a ser una imagen: su SVG, con sus medidas, incrustado. Dibujado como imagen no puede traer
  // nada que corra, y la página publicada no necesita los estilos que el diagrama lleva adentro.
  function diagramsToImages(box) {
    box.querySelectorAll('.lmd-diagram').forEach((d) => {
      d.removeAttribute('data-code'); d.removeAttribute('data-kind');
      const svg = d.querySelector('svg'); if (!svg) return;
      const vb = svg.viewBox && svg.viewBox.baseVal; const num = (v) => { const n = parseFloat(v); return /%$/.test(String(v || '')) || !Number.isFinite(n) ? 0 : n; };
      let w = (vb && vb.width) || num(svg.getAttribute('width')) || 600; let h = (vb && vb.height) || num(svg.getAttribute('height')) || 400;
      if (w > 1600) { h = h * 1600 / w; w = 1600; }
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.style.removeProperty('max-width');
      const xml = new XMLSerializer().serializeToString(svg);
      const bytes = new TextEncoder().encode(xml); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const img = el('img', { src: 'data:image/svg+xml;base64,' + btoa(bin), alt: T('Diagrama'), width: w, height: h });
      svg.replaceWith(img);
    });
  }
  // La página de una nota: título, descripción, orden (del encabezado, si lo tiene) y el cuerpo. null si la nota dice
  // publish: false.
  async function pageOf(core, site, note) {
    const n = await LMD.cloud.read(pre(site) + note);
    const d = await core.drawOff(n.text);
    const fm = {}; d.rows.forEach(([k, v]) => { fm[String(k).toLowerCase()] = String(v).replace(/^(["'])(.*)\1$/, '$2').trim(); });
    if (/^(false|no|off|0)$/i.test(fm.publish || '')) return null;
    const h1 = d.box.querySelector('h1');
    diagramsToImages(d.box);
    const name = note.slice(note.lastIndexOf('/') + 1).replace(/\.(md|mdx|mkd|mdown|markdown|txt)$/i, '');
    const page = { note, rev: n.rev, title: (fm.title || (h1 && h1.textContent.trim()) || name).slice(0, 120), descr: (fm.description || fm.summary || '').slice(0, 300), html: LMD.extras.htmlOf(d.box) };
    if (fm.order !== undefined && fm.order !== '' && Number.isFinite(+fm.order)) page.order = +fm.order;
    // Ajustes de la página: sin índice, la página publicada no lleva la lista "En esta página".
    if (LMD.page && LMD.page.read(n.text).toc === 'no') page.toc = false;
    return page;
  }
  // Dibuja y sube esas notas, de a una. step(hechas, total) avisa el avance. Devuelve cuántas imágenes quedaron afuera.
  async function upload(core, site, notes, step) {
    let skipped = 0; let i = 0;
    for (const note of notes) {
      if (step) step(i, notes.length);
      const page = await pageOf(core, site, note);
      if (page) { const r = await api('PUT', '/sites/' + site.id + '/pages', { pages: [page] }); (r.pages || []).forEach((p) => { skipped += p.images_skipped || 0; }); }
      i++;
    }
    if (step) step(notes.length, notes.length);
    return skipped;
  }

  // ---------- Al guardar ----------
  // Con "publicar al guardar", la nota que se acaba de guardar desde la app vuelve a subir su página. Espera a que se
  // deje de escribir. Si falla no se insiste: el cambio queda como pendiente y se publica desde la ventana del sitio.
  const waiting = new Map();
  function saved(core, site, path) {
    const note = path.slice(pre(site).length); const key = site.id + ':' + note;
    clearTimeout(waiting.get(key));
    waiting.set(key, setTimeout(async () => {
      waiting.delete(key);
      try { await upload(core, site, [note]); } catch (e) { /* queda como cambio sin publicar */ }
    }, 2500));
  }

  // ---------- La ventana ----------
  const field = (label, inner, cls) => '<label class="lmd-site-field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + inner + '</label>';
  const options = (list, now) => list.map(([v, name]) => '<option value="' + esc(v) + '"' + (v === now ? ' selected' : '') + '>' + esc(name) + '</option>').join('');
  // Los ajustes del sitio, para crearlo (s vacío) o para cambiarlos.
  function form(o, s, notes) {
    const root = notes.filter((p) => p.startsWith(s.folder + '/')).map((p) => p.slice(s.folder.length + 1));
    return field(T('Dirección'), '<div class="lmd-site-addr"><small>' + esc(bare(o.pages.url)) + '/</small><input type="text" data-f="slug" spellcheck="false" autocomplete="off" autocapitalize="none" maxlength="40" value="' + esc(s.slug || '') + '"></div>') +
      '<p class="lmd-site-err" data-f="slug-msg" role="status" hidden></p>' +
      field(T('Título del sitio'), '<input type="text" data-f="title" maxlength="80" value="' + esc(s.title || '') + '">') +
      field(T('Descripción'), '<input type="text" data-f="descr" maxlength="200" placeholder="' + T('opcional') + '" value="' + esc(s.descr || '') + '">') +
      field(T('Página de inicio'), '<select data-f="home">' + options([['', T('Automática')]].concat(root.map((r) => [s.folder + '/' + r, r])), s.home || '') + '</select>') +
      '<div class="lmd-site-two">' +
        field(T('Idioma del sitio'), '<select data-f="lang">' + options([['en', 'English'], ['es', 'Español']], s.lang || LMD.lang()) + '</select>') +
        field(T('Tipografía'), '<select data-f="font">' + options(FONTS.map((f) => [f[0], f[0] ? f[1] : T(f[1])]), s.font || '') + '</select>') +
        field(T('Color'), '<select data-f="accent">' + options(LMD.ACCENTS.map((a) => [a.value, T(a.name)]), s.accent || '') + '</select>') +
        field(T('Logo en texto'), '<input type="text" data-f="logo" maxlength="30" placeholder="' + T('opcional') + '" value="' + esc(s.logo || '') + '">') +
      '</div>' +
      field(T('Autor'), '<input type="text" data-f="author" maxlength="60" placeholder="' + T('opcional') + '" value="' + esc(s.author || '') + '">') +
      '<p class="lmd-hint">' + T('Tu correo no aparece en el sitio. El nombre de autor es el que escribas acá.') + '</p>' +
      '<label class="lmd-check"><input type="checkbox" data-f="auto"' + (s.auto ? ' checked' : '') + '><span>' + T('Publicar cada nota al guardarla desde la app') + '</span></label>' +
      '<label class="lmd-check"><input type="checkbox" data-f="noindex"' + (s.noindex ? ' checked' : '') + '><span>' + T('Pedir a los buscadores que no lo indexen') + '</span></label>';
  }
  const read = (box) => {
    const v = (k) => box.querySelector('[data-f=' + k + ']');
    return { slug: v('slug').value.trim().toLowerCase(), title: v('title').value.trim(), descr: v('descr').value.trim(), home: v('home').value, lang: v('lang').value, font: v('font').value, accent: v('accent').value,
      logo: v('logo').value.trim(), author: v('author').value.trim(), auto: v('auto').checked, noindex: v('noindex').checked };
  };
  // El estado de un sitio en una línea, con lo que falta publicar si se sabe.
  function stateLine(s) {
    const st = LMD.sync.siteState(s); const p = s.pending; const n = p ? p.changed.length + p.added.length + p.removed.length : 0;
    if (st.kind === 'ok' && n) return { kind: 'warn', text: T(n === 1 ? 'Publicado, con 1 cambio sin publicar' : 'Publicado, con {n} cambios sin publicar', { n }) };
    return st;
  }

  // o: { folder (ruta de la carpeta como la lleva la app), id (un sitio que ya existe), done() }.
  async function open(core, o) {
    o = o || {};
    const box = el('div', { class: 'lmd-ask' });
    const frame = (inner, actions) => {
      box.innerHTML = '<div class="lmd-ask-card lmd-site" role="dialog" aria-modal="true" aria-label="' + T('Publicar como sitio') + '"><h3>' + T('Publicar como sitio') + '</h3><div class="lmd-site-body">' + inner + '</div>' +
        '<p class="lmd-img-err" role="alert" hidden></p><p class="lmd-site-step" role="status" hidden></p>' +
        '<div class="lmd-ask-actions">' + (actions || '') + '<button type="button" class="lmd-btn" data-st="close" data-esc>' + T('Cerrar') + '</button></div></div>';
    };
    frame('<p class="lmd-hint">' + T('Cargando…') + '</p>');
    document.body.appendChild(box);
    const shut = () => { box.remove(); if (o.done) o.done(); };
    const fail = (e) => { const err = box.querySelector('.lmd-img-err'); if (err) { err.hidden = false; err.textContent = typeof e === 'string' ? e : why(e); } };
    const step = (text) => { const s = box.querySelector('.lmd-site-step'); if (s) { s.hidden = !text; s.textContent = text || ''; } };
    const busy = (on) => box.querySelectorAll('.lmd-ask-actions button, .lmd-site-body button').forEach((b) => { if (!b.matches('[data-st=close]')) b.disabled = on; });
    const progress = (i, n) => step(i < n ? T('Preparando {a} de {b}', { a: i + 1, b: n }) : T('Publicando…'));

    let state = null; let site = null; let notes = []; let editing = false; let at = null;
    const load = async () => {
      state = await api('GET', '/sites');
      const acct = await LMD.sync.reload();
      state.paid = !!(acct && acct.plan === 'pro'); state.teamCan = !!(acct && acct.pages && acct.pages.team); state.pages = { url: state.url };
      at = o.folder ? where(o.folder) : null;
      site = o.id ? state.sites.find((s) => s.id === o.id) : at ? state.sites.find((s) => s.o === at.o && s.folder === at.folder) : null;
      // Sin lugar para otro sitio de esa cuenta (o de ese equipo), se muestra el que hay.
      const o_ = at ? at.o : 0; const mine = state.sites.filter((s) => s.o === o_);
      if (!site && mine.length >= state.max && mine.length) { site = mine[0]; state.other = true; }
      const ownerOf = site ? site.o : o_;
      try { notes = (await LMD.cloud.list(true, ownerOf ? String(ownerOf) : '')).map((n) => n.path).filter((p) => /\.(md|mdx|mkd|mdown|markdown|txt)$/i.test(p) || !p.slice(p.lastIndexOf('/') + 1).includes('.')).sort((a, b) => a.localeCompare(b)); } catch (e) { notes = []; }
    };
    const draw = () => {
      const p = state;
      if (!site && !p.paid) {
        frame('<p>' + T('Una carpeta de notas se convierte en un sitio web público, con menú, buscador y tema.') + '</p><p class="lmd-hint">' + T('Publicar un sitio es parte del plan pago.') + '</p>',
          '<button type="button" class="lmd-btn lmd-btn-fill" data-st="plan" data-pay>' + T('Ver los planes') + '</button>');
        return;
      }
      if (!site && !at) {
        // Desde Ajustes no hay carpeta elegida: se elige acá. Las protegidas no figuran.
        const folders = LMD.sync.foldersOf(notes.map((path) => ({ path }))).filter((f) => LMD.sync.canPublish(f));
        frame(folders.length ? '<p class="lmd-hint">' + T('Elegí la carpeta que querés publicar.') + '</p><div class="lmd-site-pick">' + folders.map((f) => '<button type="button" class="lmd-btn" data-st="pick" data-folder="' + esc(f) + '">' + ICON.folder + '<span>' + esc(f) + '</span></button>').join('') + '</div>'
          : '<p class="lmd-hint">' + T('Primero creá una carpeta en la Nube con las notas del sitio.') + '</p>');
        return;
      }
      if (!site || editing) {
        const s = site || { folder: at.folder, slug: slugOf(at.folder.split('/').pop()), title: at.folder.split('/').pop(), lang: LMD.lang(), auto: true };
        frame('<p class="lmd-site-folder">' + ICON.folder + '<span>' + esc(s.folder) + '/</span></p>' + form(p, s, notes) +
          '<p class="lmd-hint">' + T('Se publican solo las notas de esta carpeta. Una nota con publish: false en su encabezado queda afuera.') + '</p>',
          site ? '<button type="button" class="lmd-btn lmd-btn-fill" data-st="save">' + T('Guardar') + '</button>'
            : '<button type="button" class="lmd-btn" data-st="preview">' + T('Vista previa') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-st="create">' + T('Publicar') + '</button>');
        return;
      }
      const s = site; const st = stateLine(s); const pend = s.pending || { changed: [], added: [], removed: [] }; const n = pend.changed.length + pend.added.length + pend.removed.length;
      const list = (title, rows) => (rows.length ? '<li><b>' + title + '</b> ' + rows.slice(0, 6).map((r) => esc(r.slice(s.folder.length + 1))).join(', ') + (rows.length > 6 ? '…' : '') + '</li>' : '');
      frame((state.other ? '<p class="lmd-hint">' + T('Tu plan incluye un sitio. Para publicar otra carpeta, eliminá el que tenés.') + '</p>' : '') +
        '<p class="lmd-site-folder">' + ICON.folder + '<span>' + esc(s.folder) + '/</span></p>' +
        '<p class="lmd-site-url"><a class="lmd-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(bare(s.url)) + '</a><button type="button" class="lmd-link" data-st="copy">' + T('Copiar') + '</button></p>' +
        '<p class="lmd-site-state lmd-site-' + st.kind + '" data-site-state="' + st.kind + '">' + esc(st.text) + '</p>' +
        (s.suspended ? '<p class="lmd-hint">' + T('Quien opera el servidor lo suspendió y dejó de verse.') + (s.reason ? ' ' + esc(s.reason) : '') + ' ' + T('Si es un error, escribinos desde Enviar comentarios.') + '</p>' : '') +
        (s.lapsed && s.live ? '<p class="lmd-hint">' + T('La cuenta ya no tiene el plan pago. Con el plan pago el sitio sigue publicado.') + '</p>' : '') +
        (n && !s.suspended ? '<ul class="lmd-site-pend">' + list(T('Cambiaron:'), pend.changed) + list(T('Nuevas:'), pend.added) + list(T('Se quitan:'), pend.removed) + '</ul>' : '') +
        '<p class="lmd-hint">' + T(s.auto ? 'Cada nota se publica al guardarla desde la app.' : 'Los cambios se publican desde acá.') + ' ' + T('Lo que cambie una IA o la API queda sin publicar hasta que lo publiques desde la app.') + '</p>' +
        (s.can ? '<div class="lmd-site-more"><button type="button" class="lmd-link" data-st="edit">' + T('Cambiar los ajustes') + '</button>' + (s.live || s.pages ? '<button type="button" class="lmd-link" data-st="down">' + T('Despublicar') + '</button>' : '') +
          (s.suspended ? '' : '<button type="button" class="lmd-link lmd-site-rm" data-st="remove">' + T('Eliminar el sitio') + '</button>') + '</div>' : '<p class="lmd-hint lmd-managed">' + T('Lo administra quien administra el equipo') + '</p>'),
        !s.can || s.suspended ? '' : (s.live ? '' : '<button type="button" class="lmd-btn" data-st="preview">' + T('Vista previa') + '</button>') +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-st="publish"' + (s.live && !n ? ' disabled' : '') + '>' + T(s.live ? 'Publicar cambios' : 'Publicar') + '</button>');
    };
    const refresh = async () => { site = await api('GET', '/sites/' + site.id); const i = state.sites.findIndex((s) => s.id === site.id); if (i === -1) state.sites.push(site); else state.sites[i] = site; };
    // Sube lo que falta. Con all, todas las notas de la carpeta (la primera vez, o después de cambiar los ajustes).
    const push = async () => {
      await refresh();
      const p = site.pending || { changed: [], added: [] };
      const skipped = await upload(core, site, p.changed.concat(p.added), progress);
      return skipped;
    };
    const create = async () => {
      const b = read(box);
      if (!b.title) { fail(T('Escribí un título.')); return false; }
      site = await api('POST', '/sites', Object.assign({ folder: at.folder }, at.o ? { o: at.o } : {}, b));
      state.sites.push(site);
      return true;
    };
    const told = (skipped) => { if (skipped) core.flash(T(skipped === 1 ? 'Una imagen del disco no se publicó: queda su texto.' : '{n} imágenes del disco no se publicaron: queda su texto.', { n: skipped }), 'warn'); };

    try { await load(); draw(); } catch (e) { frame('<p class="lmd-hint">' + why(e) + '</p>'); }

    // La dirección se comprueba mientras se escribe.
    let slugTimer = null;
    box.addEventListener('input', (e) => {
      if (!e.target.matches('[data-f=slug]')) return;
      const msg = box.querySelector('[data-f=slug-msg]'); clearTimeout(slugTimer);
      const v = e.target.value.trim().toLowerCase();
      slugTimer = setTimeout(async () => {
        if (!msg.isConnected) return;
        if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v)) { msg.hidden = false; msg.textContent = T(WHY.bad_slug); return; }
        try { const r = await api('GET', '/sites/slug?slug=' + encodeURIComponent(v) + (site ? '&id=' + site.id : '')); if (!msg.isConnected || box.querySelector('[data-f=slug]').value.trim().toLowerCase() !== v) return; msg.hidden = r.ok; if (!r.ok) msg.textContent = T(WHY[r.why] || WHY.bad_slug); } catch (ex) { /* se comprueba al publicar */ }
      }, 350);
    });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); shut(); } });
    box.addEventListener('mousedown', (e) => { if (e.target === box) shut(); });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-st]'); if (!b || b.disabled) return;
      const act = b.dataset.st; const err = box.querySelector('.lmd-img-err'); if (err) err.hidden = true;
      if (act === 'close') { shut(); return; }
      if (act === 'plan') { shut(); core.openPanel('plan'); return; }
      if (act === 'pick') { at = where(b.dataset.folder); draw(); return; }
      if (act === 'edit') { editing = true; draw(); return; }
      if (act === 'copy') { try { await navigator.clipboard.writeText(site.url); } catch (ex) { core.copy(site.url); return; } b.textContent = T('Copiado'); setTimeout(() => { if (b.isConnected) b.textContent = T('Copiar'); }, 1500); return; }
      busy(true);
      try {
        if (act === 'create' || (act === 'preview' && !site)) {
          // La pestaña de la vista previa se abre con el clic; su dirección llega cuando las páginas ya subieron.
          const tab = act === 'preview' ? window.open('about:blank', '_blank') : null;
          let ok = false;
          try { ok = await create(); if (ok) { const sk = await push(); if (act === 'create') site = await api('POST', '/sites/' + site.id + '/publish', {}); else await refresh(); told(sk); } }
          catch (ex) { if (tab) tab.close(); throw ex; }
          if (tab) { if (ok) tab.location.href = site.preview; else tab.close(); }
          if (ok) { editing = false; if (act === 'create') core.flash(T('Sitio publicado')); }
        } else if (act === 'preview') {
          const tab = window.open('about:blank', '_blank');
          try { told(await push()); await refresh(); } catch (ex) { if (tab) tab.close(); throw ex; }
          if (tab) tab.location.href = site.preview;
        } else if (act === 'publish') {
          const sk = await push(); site = await api('POST', '/sites/' + site.id + '/publish', {}); told(sk);
          core.flash(T('Sitio publicado'));
        } else if (act === 'save') {
          const prev = site; const b2 = read(box);
          if (!b2.title) { fail(T('Escribí un título.')); busy(false); return; }
          site = await api('PUT', '/sites/' + prev.id, b2); editing = false;
        } else if (act === 'down') {
          step(''); busy(false);
          if (!(await LMD.dialog.confirm({ title: T('Despublicar el sitio'), text: T('El sitio deja de verse ahora mismo. Tus notas no cambian y los ajustes quedan guardados.'), ok: T('Despublicar'), danger: true }))) return;
          busy(true); site = await api('POST', '/sites/' + site.id + '/unpublish', {});
        } else if (act === 'remove') {
          step(''); busy(false);
          if (!(await LMD.dialog.confirm({ title: T('Eliminar el sitio'), text: T('Se borra todo lo publicado y la dirección queda libre. Tus notas no cambian.'), ok: T('Eliminar'), danger: true }))) return;
          busy(true); await api('DELETE', '/sites/' + site.id); state.sites = state.sites.filter((s) => s.id !== site.id); site = null; state.other = false;
          if (!at) { shut(); return; }
        }
        step(''); if (box.isConnected) draw();
      } catch (ex) {
        step(''); busy(false);
        // Lo que ya se creó queda a la vista con su estado, y el aviso arriba de los botones.
        if (site && box.isConnected && (act === 'create' || act === 'preview')) { try { await refresh(); } catch (e2) { /* se muestra lo que había */ } editing = false; draw(); }
        fail(ex);
      }
    });
  }

  LMD.publish = { open, saved, pageOf, upload };
})();
