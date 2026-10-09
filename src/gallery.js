// Galería de la comunidad, en Ajustes > Herramientas, sub-pestaña Comunidad: plantillas, temas y paletas que comparte la gente y que quien
// administra el servidor aprobó. Lo que llega es un dato: pasa por LMD.community.check antes de tocarse, los nombres
// se escriben siempre como texto y nada de un aporte entra como HTML ni como CSS salvo el Markdown de una plantilla,
// que se dibuja con el mismo saneado que cualquier nota. Lo agregado queda en el dispositivo (community.js).
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const C = LMD.community;
  const TYPE = { template: 'Plantilla', theme: 'Tema', palette: 'Paleta' };
  const STATUS = { pending: 'En revisión', approved: 'Publicado', rejected: 'No publicado', removed: 'Retirado' };
  const COLOR_NAMES = { fill: 'Relleno', text: 'Texto', border: 'Borde', line: 'Línea', second: 'Segundo relleno', third: 'Tercer relleno' };
  const THEME_NAMES = { mode: 'Tema', accent: 'Color de acento', paperLight: 'Fondo claro', paperDark: 'Fondo oscuro', font: 'Tipografía', codeColor: 'Color de los bloques de código', diagramShape: 'Forma de los diagramas',
    surface: 'Fondo de paneles', text: 'Texto', muted: 'Texto secundario', border: 'Bordes', link: 'Enlaces' };
  const THEME_VALUES = { auto: 'Automático', light: 'Claro', dark: 'Oscuro', round: 'Redondeados', square: 'Rectos' };

  let core = null; let box = null;
  const view = { type: '', q: '', page: 1, pages: 1, items: [], off: '', mine: [], seq: 0 };
  const api = (method, path, body) => LMD.cloud.api(method, path, body);
  const settings = () => core.settings || {};

  // Lo que llegó del servidor, ya limpio. En la lista una plantilla viene sin su texto: se pide al verla o agregarla.
  function clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const partial = raw.type === 'template' && raw.data === undefined;
    const it = C.check(Object.assign({}, raw, partial ? { data: { text: '-' } } : {}));
    if (!it || !it.id) return null;
    it.adds = Number.isInteger(raw.adds) && raw.adds > 0 ? raw.adds : 0;
    if (partial) { it.partial = true; it.data = null; }
    return it;
  }
  async function fullOf(it) {
    if (!it.partial) return it;
    const kept = C.added().find((x) => x.type === it.type && x.id === it.id);
    if (kept) return Object.assign({ adds: it.adds }, kept);
    try { const full = clean(await api('GET', '/gallery/' + it.id)); return full && !full.partial ? full : null; } catch (e) { return null; }
  }

  // ---------- Muestras ----------
  // Los colores entran de a uno, por propiedad, y ya validados como #rrggbb: nunca como una hoja de estilo.
  function themeSample(data) {
    const dark = data.mode === 'dark' || (data.mode !== 'light' && core.isDark());
    const s = el('div', { class: 'lmd-gal-sample' });
    s.style.background = (dark ? data.paperDark : data.paperLight) || (dark ? '#121418' : '#fbfaf7');
    s.style.color = data.text || (dark ? '#e6e8ec' : '#1d2026');
    if (data.border) s.style.borderColor = data.border;
    if (data.font && C.fontValue(data.font)) s.style.fontFamily = C.fontValue(data.font);
    const accent = data.accent || (dark ? '#bef264' : '#3f6a0a');
    s.appendChild(el('b', { text: T('Título de ejemplo') }));
    const p = el('p'); p.appendChild(document.createTextNode(T('Un párrafo con') + ' ')); const a = el('span', { text: T('un enlace') }); a.style.color = data.link || accent; if (data.muted) p.style.color = data.muted; a.style.textDecoration = 'underline'; p.appendChild(a); s.appendChild(p);
    const row = el('div', { class: 'lmd-gal-sample-row' });
    const code = el('code', { text: 'const x = 1;' }); if (data.surface) code.style.background = data.surface; if (data.codeColor) { code.style.borderColor = data.codeColor; code.style.color = data.codeColor; } row.appendChild(code);
    const pill = el('i', { text: T('Botón') }); pill.style.background = accent; pill.style.color = dark ? '#14161a' : '#ffffff'; if (data.diagramShape === 'square') pill.style.borderRadius = '3px'; row.appendChild(pill);
    s.appendChild(row);
    const wrap = el('div');
    wrap.appendChild(s);
    const list = el('ul', { class: 'lmd-gal-vals' });
    Object.keys(data).forEach((k) => {
      const li = el('li'); const v = data[k];
      if (/^#/.test(v)) { const sw = el('i'); sw.style.background = v; li.appendChild(sw); }
      li.appendChild(document.createTextNode(T(THEME_NAMES[k]) + ': ' + (THEME_VALUES[v] ? T(THEME_VALUES[v]) : v)));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }
  function paletteSample(colors) {
    const s = el('div', { class: 'lmd-gal-pal' });
    [['fill', 'Aa'], ['second', 'Bb'], ['third', 'Cc']].forEach((pair, i) => {
      if (i) { const ln = el('span'); ln.style.background = colors.line; s.appendChild(ln); }
      const node = el('i', { text: pair[1] }); node.style.background = colors[pair[0]]; node.style.color = colors.text; node.style.borderColor = colors.border; s.appendChild(node);
    });
    return s;
  }
  function sampleOf(it) {
    if (it.type === 'template') { const d = el('div', { class: 'lmd-gal-md markdown-body' }); d.innerHTML = core.preview(it.data.text); return d; }
    return it.type === 'theme' ? themeSample(it.data) : paletteSample(it.data.colors);
  }

  // ---------- Agregar, quitar, volver ----------
  const isAdded = (it) => C.has(it.type, it.id);
  const planNeeded = (it) => it.type === 'theme' && C.needsPlan(it.data) && !settings().supporter;
  async function add(it) {
    const full = await fullOf(it);
    if (!full) { core.flash(T('No se pudo traer el aporte. Probá de nuevo.'), 'error'); return false; }
    if (planNeeded(full)) return false;
    if (full.type === 'theme') {
      // Volver deja lo que había antes del primer tema de la comunidad, aunque se prueben varios seguidos.
      const prev = C.theme() ? C.theme().prev : C.snapshot(settings());
      await C.setTheme(full, prev);
      await LMD.patch(Object.assign({}, prev, C.toSettings(full.data)));
    } else if (!(await C.add(full))) return false;
    // El contador es anónimo: solo dice qué aporte se sumó.
    api('POST', '/gallery/' + full.id + '/add').then((r) => { if (r && Number.isInteger(r.adds)) { it.adds = r.adds; draw(); } }).catch(() => { /* sin conexión no cuenta */ });
    return true;
  }
  async function back() {
    const t = C.theme(); if (!t) return;
    await C.setTheme(null);
    await LMD.patch(t.prev);
  }
  const report = (it) => LMD.sync.report({ kind: 'gallery', note: '#' + it.id + ' ' + it.type + ' ' + it.name, owner: it.author });

  // ---------- Temas incluidos ----------
  // Vienen con la app (theme.js) y se listan junto a los de la comunidad. No pasan por el servidor ni cuentan agregados.
  const includedOn = (it) => { const now = LMD.theme.active(settings()); return now.id === it.id && !now.custom; };
  async function applyIncluded(it) {
    await C.setTheme(null);
    await LMD.patch(LMD.theme.patchFor(it.id));
    core.flash(T('Tema aplicado')); setTimeout(draw, 250);
  }
  function includedCard(it) {
    const c = el('div', { class: 'lmd-gal-card', 'data-gid': it.id, 'data-gkind': 'included' });
    const h = el('div', { class: 'lmd-gal-head' }); h.appendChild(el('b', { text: T(it.name) })); h.appendChild(el('em', { class: 'lmd-tag', text: T('Incluido') })); c.appendChild(h);
    c.appendChild(el('p', { class: 'lmd-gal-about', text: T(it.about) }));
    c.appendChild(el('p', { class: 'lmd-gal-by', text: T(it.dark ? 'Oscuro' : 'Claro') }));
    const th = el('div'); th.innerHTML = LMD.theme.thumb(Object.assign({}, it.preset, { name: esc(T(it.name)) })); c.appendChild(th);
    const acts = el('div', { class: 'lmd-gal-acts' }); const on = includedOn(it);
    acts.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-gal': 'view', text: T('Vista previa') }));
    const b = el('button', { type: 'button', class: 'lmd-btn' + (on ? '' : ' lmd-btn-fill'), 'data-gal': 'add', text: T(on ? 'Aplicado' : 'Aplicar') }); b.disabled = on; acts.appendChild(b);
    c.appendChild(acts);
    return c;
  }
  function previewIncluded(it) {
    const { m, card } = modal('lmd-gal-view', T(it.name));
    const h = el('h3', { text: T(it.name) }); h.appendChild(el('em', { class: 'lmd-tag', text: T('Incluido') })); card.appendChild(h);
    card.appendChild(el('p', { class: 'lmd-gal-about', text: T(it.about) }));
    const prev = el('div', { class: 'lmd-gal-prev' }); prev.innerHTML = LMD.theme.thumb(Object.assign({}, it.preset, { name: esc(T(it.name)) })); card.appendChild(prev);
    const acts = el('div', { class: 'lmd-ask-actions' });
    acts.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-gv': 'close', 'data-esc': '', text: T('Cerrar') }));
    const b = el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-gv': 'add', text: T(includedOn(it) ? 'Aplicado' : 'Aplicar') }); b.disabled = includedOn(it); acts.appendChild(b);
    card.appendChild(acts);
    (acts.querySelector('[data-gv=add]:not(:disabled)') || acts.querySelector('[data-gv=close]')).focus();
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-gv]'); if (!b) return;
      m.remove();
      if (b.dataset.gv === 'add') applyIncluded(it);
    });
  }

  // ---------- Ventanas ----------
  function modal(cls, label) {
    const m = el('div', { class: 'lmd-ask lmd-gal-dlg' });
    const card = el('div', { class: 'lmd-ask-card lmd-fb ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    m.appendChild(card); document.body.appendChild(m);
    m.addEventListener('keydown', (e) => e.stopPropagation());
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.remove(); });
    return { m, card };
  }
  const byLine = (it) => T('por {a}', { a: it.author });
  function head(card, it) {
    const h = el('h3', { text: it.name }); h.appendChild(el('em', { class: 'lmd-tag', text: T(TYPE[it.type]) })); card.appendChild(h);
    if (it.about) card.appendChild(el('p', { class: 'lmd-gal-about', text: it.about }));
    card.appendChild(el('p', { class: 'lmd-hint lmd-gal-by', text: byLine(it) }));
  }
  async function preview(it) {
    const full = await fullOf(it);
    if (!full) { core.flash(T('No se pudo traer el aporte. Probá de nuevo.'), 'error'); return; }
    const { m, card } = modal('lmd-gal-view', full.name);
    head(card, full);
    const prev = el('div', { class: 'lmd-gal-prev' }); prev.appendChild(sampleOf(full)); card.appendChild(prev);
    const locked = planNeeded(full);
    if (locked) {
      const extra = el('div', { class: 'lmd-extra' }); extra.appendChild(el('p', { text: T('El fondo y los colores del texto de este tema vienen con el plan pago.') }));
      const pay = el('div', { class: 'lmd-extra-actions', 'data-pay': '' }); pay.appendChild(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-gv': 'plans', text: T('Ver planes') }));
      extra.appendChild(pay); card.appendChild(extra);
    }
    const acts = el('div', { class: 'lmd-ask-actions' });
    acts.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-gv': 'close', 'data-esc': '', text: T('Cerrar') }));
    if (!locked) acts.appendChild(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-gv': 'add', text: T(isAdded(full) ? 'Agregado' : 'Agregar') }));
    card.appendChild(acts);
    const addBtn = acts.querySelector('[data-gv=add]'); if (addBtn) { addBtn.disabled = isAdded(full); addBtn.focus(); }
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gv]'); if (!b) return;
      if (b.dataset.gv === 'close') m.remove();
      else if (b.dataset.gv === 'plans') { m.remove(); core.openPanel('plan'); }
      else if (b.dataset.gv === 'add') { b.disabled = true; const ok = await add(it); m.remove(); if (ok) { core.flash(T(full.type === 'theme' ? 'Tema aplicado' : 'Agregado')); draw(); } }
    });
  }

  // Compartir: la nota abierta como plantilla, el tema que hay puesto, o una paleta. Se ve lo que sale antes de mandarlo.
  function share() {
    // Sobre un .md de un sitio no hay cuenta: se comparte desde la app.
    if (!LMD.cloud.reach()) { core.openInApp(); return; }
    if (!LMD.cloud.signedIn() || LMD.cloud.guest()) {
      LMD.dialog.confirm({ title: T('Compartí el tuyo'), text: T('Entrá a tu cuenta para compartir.'), ok: T('Entrar') }).then((ok) => { if (ok) core.openPanel('cloud'); });
      return;
    }
    const title = T('Compartir con la comunidad');
    const { m, card } = modal('lmd-gal-share', title);
    const hasDoc = !core.noDoc && typeof core.raw === 'string' && !!core.raw.trim();
    const kinds = [['template', 'Esta nota, como plantilla'], ['theme', 'Mi tema actual'], ['palette', 'Una paleta de diagramas']];
    const field = (key, label, max) => '<label class="lmd-dlg-field"><span>' + esc(T(label)) + '</span><input type="text" data-gs="' + key + '" maxlength="' + max + '" spellcheck="false" autocomplete="off"></label>';
    card.innerHTML = '<h3>' + esc(title) + '</h3>' +
      '<div class="lmd-gal-kind" role="radiogroup" aria-label="' + esc(title) + '">' + kinds.map((k) => '<label class="lmd-check"><input type="radio" name="lmd-gal-kind" value="' + k[0] + '"><span>' + esc(T(k[1])) + '</span></label>').join('') + '</div>' +
      field('name', 'Nombre', 60) + field('about', 'Descripción corta', 160) +
      '<div class="lmd-gal-two">' + field('author', 'Tu nombre público', 40) +
        '<label class="lmd-dlg-field"><span>' + esc(T('Idioma')) + '</span><select data-gs="lang"><option value="en">English</option><option value="es">Español</option></select></label></div>' +
      '<div class="lmd-gal-colors" hidden>' + C.COLORS.map((k) => '<label><input type="color" data-gc="' + k + '"><span>' + esc(T(COLOR_NAMES[k])) + '</span></label>').join('') + '</div>' +
      '<p class="lmd-gal-sub">' + esc(T('Así se va a publicar')) + '</p><div class="lmd-gal-prev" data-gs="prev"></div>' +
      '<p class="lmd-hint">' + esc(T('Va a revisión. Si se aprueba, queda público con el nombre que elegiste.')) + '</p>' +
      '<p class="lmd-img-err" role="alert" hidden></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-gs="no" data-esc>' + esc(T('Cancelar')) + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-gs="send">' + esc(T('Enviar a revisión')) + '</button></div>';
    const q = (n) => card.querySelector('[data-gs=' + n + ']');
    const radios = Array.from(card.querySelectorAll('input[type=radio]'));
    const err = card.querySelector('.lmd-img-err'); const colors = card.querySelector('.lmd-gal-colors');
    radios[0].disabled = !hasDoc; (hasDoc ? radios[0] : radios[1]).checked = true;
    q('author').value = C.author(); q('lang').value = LMD.lang() === 'es' ? 'es' : 'en';
    if (hasDoc) q('name').value = String(core.docName || '').replace(/\.(md|markdown|txt)$/i, '').slice(0, 60);
    const first = (LMD.diagram && LMD.diagram.PALETTES[0]) || ['', '#dbeafe', '#1e3a8a', '#3b82f6', '#437ad3', '#e0e7ff', '#cffafe'];
    C.COLORS.forEach((k, i) => { colors.querySelector('[data-gc=' + k + ']').value = first[i + 1]; });
    const kind = () => (radios.find((r) => r.checked) || radios[1]).value;
    // Lo que sale es exactamente esto: el tipo, los cuatro datos escritos acá y el contenido. Nada más de la app.
    const item = () => {
      const type = kind(); let data;
      if (type === 'template') data = { text: core.raw };
      else if (type === 'theme') data = C.fromSettings(settings());
      else { const c = {}; C.COLORS.forEach((k) => { c[k] = colors.querySelector('[data-gc=' + k + ']').value; }); data = { colors: c }; }
      return { type, name: q('name').value.trim(), about: q('about').value.trim(), lang: q('lang').value, author: q('author').value.trim(), data };
    };
    const show = () => {
      const it = item(); const prev = q('prev'); prev.textContent = '';
      colors.hidden = it.type !== 'palette'; err.hidden = true;
      const h = el('p', { class: 'lmd-gal-prev-head' }); h.appendChild(el('b', { text: it.name || T('Nombre') })); h.appendChild(el('em', { class: 'lmd-tag', text: T(TYPE[it.type]) })); prev.appendChild(h);
      if (it.about) prev.appendChild(el('p', { class: 'lmd-gal-about', text: it.about }));
      prev.appendChild(el('p', { class: 'lmd-hint lmd-gal-by', text: T('por {a}', { a: it.author || T('Tu nombre público') }) }));
      const data = C.checkData(it.type, it.data);
      if (data) prev.appendChild(sampleOf({ type: it.type, data }));
      else prev.appendChild(el('p', { class: 'lmd-empty', text: T(it.type === 'theme' ? 'Tu tema no tiene cambios para compartir.' : it.type === 'template' && C.bytes(core.raw || '') > C.MAX_TEMPLATE ? 'La plantilla supera los 20 KB.' : 'No hay nada para compartir.') }));
    };
    show();
    card.addEventListener('input', show); card.addEventListener('change', show);
    const fail = (text) => { err.hidden = false; err.textContent = text; };
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gs]'); if (!b) return;
      if (b.dataset.gs === 'no') { m.remove(); return; }
      if (b.dataset.gs !== 'send') return;
      const it = item();
      if (it.name.length < 3) { fail(T('El nombre va de 3 a 60 caracteres.')); q('name').focus(); return; }
      if (it.author.length < 2 || it.author.includes('@')) { fail(T('Escribí un nombre público de 2 a 40 caracteres, sin arroba.')); q('author').focus(); return; }
      if (it.type === 'template' && C.bytes(it.data.text) > C.MAX_TEMPLATE) { fail(T('La plantilla supera los 20 KB.')); return; }
      if (it.type === 'theme' && !Object.keys(it.data).length) { fail(T('Tu tema no tiene cambios para compartir.')); return; }
      if (!C.check(it)) { fail(T('No se pudo enviar. Revisá los datos.')); return; }
      b.disabled = true; err.hidden = true;
      try {
        await api('POST', '/gallery', it);
        C.setAuthor(it.author);
        card.textContent = ''; const ok = el('p', { class: 'lmd-fb-ok', role: 'status' }); ok.innerHTML = LMD.kit.ICON.check; ok.appendChild(el('span', { text: T('Enviado. El estado aparece en Tus aportes.') })); card.appendChild(ok);
        setTimeout(() => m.remove(), 1800);
        loadMine();
      } catch (ex) {
        b.disabled = false;
        fail(T(ex.code === 'too_many' ? 'Llegaste al tope de envíos por hoy.' : ex.code === 'gallery_full' ? 'Llegaste al tope de aportes. Retirá alguno para enviar otro.' : ex.code === 'no_route' ? 'Este servidor no recibe aportes.'
          : ex.code === 'offline' || ex.code === 'no_server' ? 'No hay conexión con el servidor.' : ex.status === 401 ? 'Entrá a tu cuenta para compartir.' : ex.code === 'too_large' ? 'La plantilla supera los 20 KB.' : 'No se pudo enviar. Revisá los datos.'));
      }
    });
    (hasDoc ? q('about') : q('name')).focus();
  }

  // ---------- La sección ----------
  function cardOf(it) {
    const c = el('div', { class: 'lmd-gal-card', 'data-gid': String(it.id), 'data-gkind': it.type });
    const h = el('div', { class: 'lmd-gal-head' }); h.appendChild(el('b', { text: it.name })); h.appendChild(el('em', { class: 'lmd-tag', text: T(TYPE[it.type]) })); c.appendChild(h);
    if (it.about) c.appendChild(el('p', { class: 'lmd-gal-about', text: it.about }));
    c.appendChild(el('p', { class: 'lmd-gal-by', text: byLine(it) + (it.adds ? ' · ' + T('Agregado {n} veces', { n: it.adds }) : '') }));
    if (it.type === 'palette' && it.data) c.appendChild(paletteSample(it.data.colors));
    const acts = el('div', { class: 'lmd-gal-acts' });
    acts.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-gal': 'view', text: T('Vista previa') }));
    const added = isAdded(it);
    if (it.type === 'theme') acts.appendChild(el('button', { type: 'button', class: 'lmd-btn' + (added ? '' : ' lmd-btn-fill'), 'data-gal': added ? 'back' : 'add', text: T(added ? 'Volver al anterior' : 'Agregar') }));
    else acts.appendChild(el('button', { type: 'button', class: 'lmd-btn' + (added ? '' : ' lmd-btn-fill'), 'data-gal': added ? 'remove' : 'add', text: T(added ? 'Quitar' : 'Agregar') }));
    if (!view.off) acts.appendChild(el('button', { type: 'button', class: 'lmd-link lmd-gal-report', 'data-gal': 'report', text: T('Denunciar') }));
    c.appendChild(acts);
    return c;
  }
  function draw() {
    if (!box || !box.isConnected) return;
    const list = box.querySelector('.lmd-gal-list'); const note = box.querySelector('.lmd-gal-note'); list.textContent = '';
    const t = C.theme(); const strip = box.querySelector('.lmd-gal-theme');
    strip.hidden = !t; if (t) strip.querySelector('span').textContent = T('Tema de la comunidad puesto: {a}', { a: t.name });
    note.hidden = !view.off; note.textContent = view.off;
    const words = view.q.toLowerCase();
    // Sin conexión se ve lo que ya está en el dispositivo, con el mismo filtro.
    const rows = view.off ? C.added().filter((it) => (!view.type || it.type === view.type) && (!words || (it.name + '\n' + it.about + '\n' + it.author).toLowerCase().includes(words))) : view.items;
    // Los doce temas que vienen con la app son parte de la galería: en Temas van primero, y en Todo cierran la lista,
    // después del último aporte. Así ninguna de las dos arranca vacía.
    const all = !view.type; const last = !!view.off || view.page >= view.pages;
    const own = view.type === 'theme' || (all && last) ? C.included().filter((it) => !words || (T(it.name) + '\n' + T(it.about)).toLowerCase().includes(words)) : [];
    if (!all) own.forEach((it) => list.appendChild(includedCard(it)));
    rows.forEach((it) => list.appendChild(cardOf(it)));
    if (all) own.forEach((it) => list.appendChild(includedCard(it)));
    if (!rows.length && !own.length && view.seq) list.appendChild(el('p', { class: 'lmd-empty', text: T(view.off ? 'Todavía no agregaste nada.' : view.q || view.type ? 'Ningún aporte coincide.' : 'Todavía no hay aportes.') }));
    box.querySelector('[data-gal=more]').hidden = !!view.off || view.page >= view.pages;
    const mine = box.querySelector('.lmd-gal-mine'); const ml = box.querySelector('.lmd-gal-mylist'); ml.textContent = '';
    mine.hidden = !view.mine.length;
    view.mine.forEach((it) => {
      const r = el('div', { class: 'lmd-gal-my', 'data-mid': String(it.id) });
      const main = el('div'); main.appendChild(el('b', { text: it.name })); main.appendChild(el('em', { class: 'lmd-tag', text: T(TYPE[it.type] || 'Plantilla') }));
      main.appendChild(el('em', { class: 'lmd-tag lmd-gal-st lmd-gal-st-' + (STATUS[it.status] ? it.status : 'pending'), text: T(STATUS[it.status] || STATUS.pending) }));
      if (it.reason) main.appendChild(el('p', { class: 'lmd-gal-why', text: it.reason }));
      r.appendChild(main); r.appendChild(el('button', { type: 'button', class: 'lmd-link', 'data-gal': 'withdraw', text: T('Retirar') }));
      ml.appendChild(r);
    });
  }
  async function load(more) {
    const seq = ++view.seq; await C.ready();
    view.page = more ? view.page + 1 : 1;
    // Un .md de un sitio no llega al servidor. No es una falla: se ve lo incluido y lo ya agregado, y dice dónde está el resto.
    if (!LMD.cloud.reach()) { view.items = []; view.pages = 1; view.off = T('Abrí la app para ver lo que compartió la comunidad.'); draw(); return; }
    try {
      const r = await api('GET', '/gallery?' + new URLSearchParams({ type: view.type, q: view.q, page: String(view.page) }));
      if (seq !== view.seq) return;
      const items = (Array.isArray(r && r.items) ? r.items : []).map(clean).filter(Boolean);
      view.items = more ? view.items.concat(items) : items; view.pages = +(r && r.pages) || 1; view.off = '';
    } catch (e) {
      if (seq !== view.seq) return;
      view.items = []; view.pages = 1;
      view.off = T(e.code === 'no_server' ? 'No hay un servidor configurado. Acá está lo que ya agregaste.' : 'No hay conexión con la galería. Acá está lo que ya agregaste.');
    }
    draw();
  }
  async function loadMine() {
    view.mine = [];
    if (LMD.cloud.reach() && LMD.cloud.signedIn() && !LMD.cloud.guest()) {
      try { const rows = await api('GET', '/gallery/mine'); view.mine = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isInteger(r.id)).map((r) => ({ id: r.id, type: String(r.type), status: String(r.status), name: String(r.name || '').slice(0, 60), reason: String(r.reason || '').slice(0, 300) })); } catch (e) { /* sin conexión: no se listan */ }
    }
    draw();
  }

  function pane(container, c) {
    core = c; box = container;
    const types = [['', 'Todo'], ['template', 'Plantillas'], ['theme', 'Temas'], ['palette', 'Paletas']];
    box.innerHTML = '<p class="lmd-hint lmd-gal-lead">' + esc(T('Plantillas, temas y paletas que comparte la gente. Cada aporte se revisa antes de publicarse.')) + '</p>' +
      '<div class="lmd-gal-bar"><div class="lmd-seg lmd-gal-types" role="radiogroup" aria-label="' + esc(T('Comunidad')) + '">' +
        types.map((t) => '<button type="button" role="radio" data-gtype="' + t[0] + '" aria-checked="' + (view.type === t[0]) + '"' + (view.type === t[0] ? ' class="lmd-on"' : '') + '>' + esc(T(t[1])) + '</button>').join('') + '</div>' +
        '<input type="search" class="lmd-lk-q lmd-gal-q" spellcheck="false" placeholder="' + esc(T('Buscar en la comunidad')) + '" aria-label="' + esc(T('Buscar en la comunidad')) + '">' +
        '<button type="button" class="lmd-btn lmd-btn-fill" data-gal="share">' + esc(T('Compartí el tuyo')) + '</button></div>' +
      '<p class="lmd-gal-theme" hidden><span></span> <button type="button" class="lmd-link" data-gal="back">' + esc(T('Volver al anterior')) + '</button></p>' +
      '<p class="lmd-hint lmd-gal-note" role="status" hidden></p>' +
      '<div class="lmd-gal-list"></div>' +
      '<button type="button" class="lmd-link" data-gal="more" hidden>' + esc(T('Ver más')) + '</button>' +
      '<div class="lmd-gal-mine" hidden><h4>' + esc(T('Tus aportes')) + '</h4><div class="lmd-gal-mylist"></div></div>';
    const input = box.querySelector('.lmd-gal-q'); input.value = view.q;
    let timer = 0;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { view.q = input.value.trim().slice(0, 60); load(); }, 250); });
    box.addEventListener('click', async (e) => {
      const seg = e.target.closest('[data-gtype]');
      if (seg) { view.type = seg.dataset.gtype; box.querySelectorAll('[data-gtype]').forEach((b) => { const on = b === seg; b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on)); }); load(); return; }
      const b = e.target.closest('[data-gal]'); if (!b) return;
      const act = b.dataset.gal; const cardEl = b.closest('[data-gid]');
      if (cardEl && cardEl.dataset.gkind === 'included') {
        const own = C.included().find((x) => x.id === cardEl.dataset.gid); if (!own) return;
        if (act === 'view') previewIncluded(own); else if (act === 'add') applyIncluded(own);
        return;
      }
      const it = cardEl ? (view.off ? C.added() : view.items).find((x) => String(x.id) === cardEl.dataset.gid && x.type === cardEl.dataset.gkind) : null;
      if (act === 'share') share();
      else if (act === 'more') load(true);
      else if (act === 'back') { await back(); draw(); }
      else if (act === 'withdraw') {
        const id = +b.closest('[data-mid]').dataset.mid;
        if (!(await LMD.dialog.confirm({ title: T('¿Retirar este aporte?'), text: T('Deja de estar en la galería.'), ok: T('Retirar'), danger: true }))) return;
        try { await api('DELETE', '/gallery/' + id); } catch (ex) { core.flash(T('No se pudo completar. Probá de nuevo.'), 'error'); }
        loadMine(); load();
      } else if (!it) return;
      else if (act === 'view') preview(it);
      else if (act === 'report') report(it);
      else if (act === 'remove') { await C.remove(it.type, it.id); draw(); }
      else if (act === 'add') {
        if (planNeeded(it)) { preview(it); return; }
        b.disabled = true; const ok = await add(it); if (ok) core.flash(T(it.type === 'theme' ? 'Tema aplicado' : 'Agregado')); draw();
      }
    });
    draw(); load(); loadMine();
  }

  LMD.gallery = { pane, share, clean };
})();
