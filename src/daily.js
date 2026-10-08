// Herramienta: nota diaria. Un botón y un atajo abren la nota de hoy; si no existe, nace de una plantilla en el
// lugar elegido (este navegador, la nube o una carpeta del disco). Un calendario del mes marca los días con nota
// y lleva a cualquiera; la nota diaria abierta trae arriba los enlaces a ayer y a mañana. Todo pasa en el
// dispositivo: en la nube, sin conexión se abre la copia guardada.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ICON = {
    day: svg('<rect x="4" y="5.500" width="16" height="14.500" rx="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4M9 14.500l2.200 2.200 4-4.400"/>'),
    cal: svg('<rect x="4" y="5.500" width="16" height="14.500" rx="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4M8 13.500h.01M12 13.500h.01M16 13.500h.01M8 16.800h.01M12 16.800h.01"/>'),
    prev: svg('<path d="m14.500 6-6 6 6 6"/>'), next: svg('<path d="m9.500 6 6 6-6 6"/>'),
  };
  const KEY = LMD.keys('Alt+Shift+H');
  const MD = '.md';
  let core = null; let on = false; let wired = false;
  const opt = (k, d) => LMD.tools.opt(k, d);
  // Las opciones valen ya, sin esperar a que vuelvan del almacenamiento.
  function keep(partial) { core.settings.tools = Object.assign({}, core.settings.tools, partial); return LMD.tools.setOpt(partial); }
  const vbase = () => core.urlOf('').slice(0, -'cloud/'.length);
  const enc = (parts) => parts.map(encodeURIComponent).join('/');

  // ---------- Fechas y nombres ----------
  const p2 = (n) => String(n).padStart(2, '0');
  const day = (y, m, d) => new Date(y, m, d, 12);
  const today = () => { const n = new Date(); return day(n.getFullYear(), n.getMonth(), n.getDate()); };
  const shift = (d, n) => day(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const iso = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const same = (a, b) => !!a && !!b && iso(a) === iso(b);
  // El patrón del nombre: año, mes y día, en el orden y con los separadores que la persona quiera.
  const DEF_NAME = 'YYYY-MM-DD';
  const okPattern = (s) => /(YYYY|AAAA)/.test(s) && /MM/.test(s) && /DD/.test(s) && !/[\\/:*?"<>|]/.test(s) && s.trim() === s && s.length <= 60;
  const pattern = () => { const s = String(opt('dailyName', DEF_NAME)); return okPattern(s) ? s : DEF_NAME; };
  const nameOf = (d) => pattern().replace(/YYYY|AAAA/, d.getFullYear()).replace(/MM/, p2(d.getMonth() + 1)).replace(/DD/, p2(d.getDate())) + MD;
  // La fecha de un nombre de archivo, o null si no es el de una nota diaria.
  function dateOf(file) {
    const order = []; const src = pattern().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/YYYY|AAAA|MM|DD/g, (t) => { order.push(t[0]); return t.length === 4 ? '(\\d{4})' : '(\\d{2})'; });
    const m = new RegExp('^' + src + '\\.md$', 'i').exec(file); if (!m) return null;
    const got = {}; order.forEach((k, i) => { if (!(k in got)) got[k] = +m[i + 1]; });
    const y = got.Y != null ? got.Y : got.A; const d = day(y, got.M - 1, got.D);
    return d.getMonth() === got.M - 1 && d.getDate() === got.D ? d : null;
  }
  const loc = () => (LMD.lang() === 'es' ? 'es' : 'en');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const longDate = (d) => cap(d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const monthName = (d) => cap(d.toLocaleDateString(loc(), { month: 'long', year: 'numeric' }));

  // ---------- Dónde viven ----------
  const folderParts = () => String(opt('dailyFolder', '')).split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..');
  // El lugar elegido, si se puede usar acá; si no, este navegador.
  function place() {
    const w = opt('dailyWhere', 'local');
    if (w === 'cloud' && LMD.cloud.signedIn()) return 'cloud';
    if (w === 'disk' && window.showDirectoryPicker && opt('dailyRoot', '')) return 'disk';
    return 'local';
  }
  const diskRoot = async () => (await LMD.store.rootsAll()).find((r) => r.id === opt('dailyRoot', '') && r.kind === 'dir') || null;
  async function diskDir(create, ask) {
    const root = await diskRoot(); if (!root) return null;
    let ok = false;
    try { ok = (await root.handle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* se pide abajo */ }
    if (!ok && ask) { try { ok = (await root.handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { /* hace falta un clic */ } }
    if (!ok) return null;
    let dir = root.handle;
    try { for (const p of folderParts()) dir = await dir.getDirectoryHandle(p, { create: !!create }); } catch (e) { return create ? null : undefined; }
    return dir;
  }
  // La dirección de la nota de un día dentro de la app (lo que va después de ?f=).
  function pathOf(d, where) {
    const w = where || place(); const file = nameOf(d);
    if (w === 'local') return 'local/' + encodeURIComponent(file);
    if (w === 'cloud') return 'cloud/' + enc(folderParts().concat(file));
    return opt('dailyRoot', '') + '/' + enc(folderParts().concat(file));
  }
  // Los nombres de archivo que ya existen en el lugar de las notas diarias.
  async function names(where) {
    const w = where || place();
    try {
      if (w === 'local') return new Set((await LMD.store.notesAll()).map((n) => n.name));
      if (w === 'cloud') {
        const pre = folderParts().map((s) => s + '/').join('');
        return new Set((await LMD.cloud.list(false)).filter((n) => n.path.startsWith(pre) && n.path.indexOf('/', pre.length) < 0).map((n) => n.path.slice(pre.length)));
      }
      const dir = await diskDir(false, false); const out = new Set();
      if (dir) for await (const [name, h] of dir.entries()) if (h.kind === 'file') out.add(name);
      return out;
    } catch (e) { return new Set(); }
  }

  // ---------- La plantilla ----------
  function minimal(d) {
    return '# ' + longDate(d) + '\n\n## ' + T('Tareas') + '\n\n- [ ] \n\n## ' + T('Notas') + '\n\n';
  }
  async function textFor(d) {
    const id = opt('dailyTemplate', ''); let text = '';
    if (id === 'own') text = String(opt('dailyTemplateText', ''));
    else if (id) { try { await core.tools(); const t = LMD.templates.get(id); text = t ? t.text : ''; } catch (e) { text = ''; } }
    if (!text.trim()) return minimal(d);
    return text.replace(/\{\{\s*(fecha|date)\s*\}\}/gi, longDate(d)).replace(/\{\{\s*(dia|día|day)\s*\}\}/gi, iso(d));
  }

  // ---------- Abrir y crear ----------
  let busy = false;
  async function openDay(d) {
    if (!on || !core || !core.APP || busy) return false;
    busy = true;
    try {
      let w = place(); const file = nameOf(d);
      if ((await names(w)).has(file)) return await core.open(vbase() + pathOf(d, w));
      const text = await textFor(d); let note = '';
      if (w === 'cloud') {
        try { await LMD.cloud.write(folderParts().concat(file).join('/'), text); }
        catch (e) {
          // Sin conexión, o en el límite del plan: la nota nace igual, en este navegador, y se dice dónde quedó.
          w = 'local';
          note = e && e.code === 'note_limit' ? T('El plan gratis llega a 10 notas en la nube. Esta quedó guardada en este navegador.') : T('Sin conexión. La nota del día quedó en este navegador.');
          if ((await names(w)).has(file)) { const done = await core.open(vbase() + pathOf(d, w)); core.flash(note, 'warn'); return done; }
        }
      } else if (w === 'disk') {
        const dir = await diskDir(true, true);
        if (!dir) { say(T('Falta el permiso para escribir en la carpeta de las notas diarias.')); return false; }
        const h = await dir.getFileHandle(file, { create: true });
        const wr = await h.createWritable(); await wr.write(text); await wr.close();
      }
      if (w === 'local') {
        await LMD.store.notePut(file, text);
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* el navegador decide */ }
      }
      const done = await core.open(vbase() + pathOf(d, w), { edit: 'doc', tree: true });
      if (note) core.flash(note, 'warn');
      return done;
    } catch (e) { say(T('No se pudo abrir la nota del día. Probá de nuevo.')); return false; }
    finally { busy = false; }
  }
  // Un aviso que se ve con o sin nota abierta.
  function say(text) { if (core.noDoc) LMD.home.say(text); else core.flash(text, 'error'); }
  const openToday = () => openDay(today());
  // El día de la nota abierta, si es una nota diaria de las de acá.
  function current() {
    if (!core || core.noDoc || !core.APP) return null;
    const f = core.HERE.slice(vbase().length); const d = dateOf(decodeURIComponent(f.split('/').pop() || ''));
    if (!d) return null;
    const unesc = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    return ['local', 'cloud', 'disk'].some((w) => (w !== 'disk' || opt('dailyRoot', '')) && unesc(pathOf(d, w)) === unesc(f)) ? d : null;
  }

  // ---------- Ayer y mañana, arriba de la nota diaria ----------
  function paintNav() {
    const old = core.ui.main.querySelector('.lmd-daily-nav');
    const d = on ? current() : null;
    if (!d) { if (old) old.remove(); return; }
    const nav = old || el('nav', { class: 'lmd-daily-nav' });
    nav.setAttribute('aria-label', T('Nota diaria'));
    const t = today(); const label = same(d, t) ? T('Hoy') : same(d, shift(t, -1)) ? T('Ayer') : same(d, shift(t, 1)) ? T('Mañana') : iso(d);
    nav.innerHTML =
      '<button type="button" class="lmd-link" data-daily="prev">' + ICON.prev + '<span>' + esc(same(d, t) ? T('Ayer') : T('Día anterior')) + '</span></button>' +
      '<button type="button" class="lmd-link lmd-daily-now" data-daily="cal" title="' + esc(T('Calendario')) + '">' + ICON.cal + '<span>' + esc(label) + '</span></button>' +
      '<button type="button" class="lmd-link" data-daily="next"><span>' + esc(same(d, t) ? T('Mañana') : T('Día siguiente')) + '</span>' + ICON.next + '</button>';
    nav._day = d;
    if (!old) {
      core.ui.main.insertBefore(nav, core.ui.article);
      nav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-daily]'); if (!b) return;
        if (b.dataset.daily === 'cal') calendar(nav._day); else openDay(shift(nav._day, b.dataset.daily === 'prev' ? -1 : 1));
      });
    }
  }

  // ---------- El calendario del mes ----------
  let calBox = null;
  function closeCal() { if (calBox) { calBox.remove(); calBox = null; } }
  async function calendar(at) {
    if (!on || !core || !core.APP) return;
    closeCal();
    const cur = current(); const t = today();
    let view = at || cur || t; view = day(view.getFullYear(), view.getMonth(), 1);
    const box = el('div', { class: 'lmd-ask lmd-daily-cal' }); calBox = box;
    box.innerHTML = '<div class="lmd-ask-card" role="dialog" aria-modal="true" aria-label="' + esc(T('Notas diarias')) + '">' +
      '<div class="lmd-daily-head"><button type="button" class="lmd-icon-btn" data-cal="prev" title="' + esc(T('Mes anterior')) + '" aria-label="' + esc(T('Mes anterior')) + '">' + ICON.prev + '</button>' +
        '<h3 aria-live="polite"></h3>' +
        '<button type="button" class="lmd-icon-btn" data-cal="next" title="' + esc(T('Mes siguiente')) + '" aria-label="' + esc(T('Mes siguiente')) + '">' + ICON.next + '</button></div>' +
      '<div class="lmd-daily-grid" role="grid"></div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-cal="close" data-esc>' + esc(T('Cerrar')) + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-cal="today">' + esc(T('Nota de hoy')) + '</button></div></div>';
    document.body.appendChild(box);
    const grid = box.querySelector('.lmd-daily-grid'); const title = box.querySelector('h3');
    // En español la semana arranca el lunes; en inglés, el domingo.
    const first = loc() === 'es' ? 1 : 0;
    let seq = 0;
    const draw = async (focusDay) => {
      const mine = ++seq; const have = await names();
      if (mine !== seq || calBox !== box) return;
      title.textContent = monthName(view);
      grid.textContent = '';
      for (let k = 0; k < 7; k++) { const wd = day(2024, 0, 7 + first + k); grid.appendChild(el('span', { class: 'lmd-daily-wd', 'aria-hidden': 'true', text: wd.toLocaleDateString(loc(), { weekday: 'narrow' }).toUpperCase() })); }
      const lead = (view.getDay() - first + 7) % 7; const count = day(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      for (let k = 0; k < lead; k++) grid.appendChild(el('span', { class: 'lmd-daily-pad' }));
      for (let n = 1; n <= count; n++) {
        const d = day(view.getFullYear(), view.getMonth(), n); const has = have.has(nameOf(d));
        const b = el('button', { type: 'button', class: 'lmd-daily-day' + (has ? ' lmd-has' : '') + (same(d, t) ? ' lmd-today' : '') + (same(d, cur) ? ' lmd-on' : ''), 'data-day': iso(d), text: String(n) });
        b.setAttribute('aria-label', longDate(d) + (has ? ', ' + T('con nota') : ''));
        if (same(d, t)) b.setAttribute('aria-current', 'date');
        grid.appendChild(b);
      }
      const want = grid.querySelector('[data-day="' + (focusDay || '') + '"]') || grid.querySelector('.lmd-on') || grid.querySelector('.lmd-today') || grid.querySelector('.lmd-daily-day');
      if (want && !LMD.touch.coarse()) want.focus();
    };
    const month = (n, focusDay) => { view = day(view.getFullYear(), view.getMonth() + n, 1); return draw(focusDay); };
    const pick = (text) => { const m = text.split('-').map(Number); closeCal(); openDay(day(m[0], m[1] - 1, m[2])); };
    box.addEventListener('click', (e) => {
      const dbtn = e.target.closest('[data-day]'); if (dbtn) { pick(dbtn.dataset.day); return; }
      const b = e.target.closest('[data-cal]'); if (!b) return;
      if (b.dataset.cal === 'prev') month(-1); else if (b.dataset.cal === 'next') month(1); else if (b.dataset.cal === 'today') { closeCal(); openToday(); } else closeCal();
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) closeCal(); });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con el calendario abierto
      if (e.key === 'Escape') { e.preventDefault(); closeCal(); return; }
      if (e.key === 'PageUp') { e.preventDefault(); month(-1); return; }
      if (e.key === 'PageDown') { e.preventDefault(); month(1); return; }
      const cell = e.target.closest && e.target.closest('[data-day]'); if (!cell) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
      e.preventDefault();
      const m = cell.dataset.day.split('-').map(Number); const to = day(m[0], m[1] - 1, m[2] + step);
      if (to.getMonth() !== view.getMonth()) { view = day(to.getFullYear(), to.getMonth(), 1); draw(iso(to)); }
      else { const b = grid.querySelector('[data-day="' + iso(to) + '"]'); if (b) b.focus(); }
    });
    // Deslizar cambia de mes.
    let sx = null;
    grid.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    grid.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 60) month(dx < 0 ? 1 : -1); });
    await draw();
  }

  // ---------- Los botones: en el inicio y en el explorador ----------
  function homeButton(box) {
    const row = box && box.querySelector('.lmd-home-actions'); if (!row) return;
    const old = row.querySelector('[data-daily]');
    if (!on || !core.APP) { if (old) old.remove(); return; }
    if (old) return;
    const b = el('button', { type: 'button', class: 'lmd-btn', 'data-daily': 'today', title: T('Nota de hoy') + ' (' + KEY + ')' }, ICON.day + '<span>' + esc(T('Nota de hoy')) + '</span>');
    b.addEventListener('click', (e) => { e.stopPropagation(); openToday(); });
    row.appendChild(b);
  }
  function sideButton() {
    const head = core.ui.sidebar.querySelector('.lmd-zone-files .lmd-zone-head'); if (!head) return;
    const old = head.querySelector('.lmd-daily-btn');
    if (!on || !core.APP) { if (old) old.remove(); return; }
    if (old) return;
    const b = el('button', { type: 'button', class: 'lmd-zone-btn lmd-daily-btn', title: T('Nota de hoy') + ' (' + KEY + ')', 'aria-label': T('Nota de hoy') }, ICON.day);
    b.addEventListener('click', () => openToday());
    // Clic derecho, o mantener apretado: el calendario.
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); calendar(); });
    head.insertBefore(b, head.querySelector('.lmd-zone-btn'));
  }
  function paint() { if (!core) return; sideButton(); homeButton(core.ui.home); paintNav(); }
  function onShortcut(e) {
    if (!on || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyH') return;
    if (!core.APP || document.querySelector('.lmd-ask, .lmd-dgm, .lmd-pres') || !core.ui.panel.hidden) return;
    e.preventDefault(); openToday();
  }
  function enable(c) {
    core = c; on = true; paint();
    if (wired) return;
    wired = true;
    window.addEventListener('keydown', onShortcut);
    core.hooks.home.push((box) => homeButton(box));
    core.hooks.doc.push(() => { closeCal(); paintNav(); });
    core.actions.daily = () => openToday();
    core.actions['daily-cal'] = () => calendar();
    // En pantalla chica el explorador está detrás de un botón: la nota de hoy y el calendario también van en "más".
    core.menus.more.push(() => (on && core.APP && LMD.touch.small() ? ['daily', ICON.day, 'Nota de hoy'] : null));
    core.menus.more.push(() => (on && core.APP && LMD.touch.small() ? ['daily-cal', ICON.cal, 'Calendario'] : null));
  }
  function disable() { on = false; closeCal(); paint(); }

  // ---------- Opciones en Ajustes > Herramientas ----------
  async function chooseDisk() {
    const handle = await window.showDirectoryPicker({ id: 'lmd-diario', mode: 'readwrite' });
    let mine = null;
    for (const r of await LMD.store.rootsAll()) { let eq = false; try { eq = await r.handle.isSameEntry(handle); } catch (e) { /* permiso vencido */ } if (eq) mine = r; }
    if (!mine) { const id = Math.random().toString(36).slice(2, 10); mine = { key: 'root:' + id, root: true, id, kind: 'dir', at: Date.now() }; }
    mine.kind = 'dir'; mine.name = handle.name; mine.handle = handle;
    await LMD.store.handlesPut(mine);
    return mine;
  }
  async function settings(area, api) {
    if (!core.APP) { area.innerHTML = '<p class="lmd-tl-why">' + esc(T('La nota diaria se usa desde la app.')) + '</p>'; return; }
    try { await core.tools(); } catch (e) { /* sin las plantillas, queda la mínima */ }
    const where = opt('dailyWhere', 'local'); const canDisk = !!window.showDirectoryPicker; const signed = LMD.cloud.signedIn();
    const root = canDisk ? await diskRoot() : null;
    const tid = opt('dailyTemplate', ''); const own = String(opt('dailyTemplateText', ''));
    const list = LMD.templates ? LMD.templates.list() : []; const groups = LMD.templates ? LMD.templates.groups() : [];
    const o = (v, text, sel, dis) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + esc(text) + '</option>';
    const shown = (s) => (LMD.lang() === 'es' ? s.replace('YYYY', 'AAAA') : s.replace('AAAA', 'YYYY'));
    area.innerHTML =
      '<label class="lmd-row"><span>' + esc(T('Dónde se guardan')) + '</span><select data-dly="where">' +
        o('local', T('Este navegador'), where === 'local' || (where === 'cloud' && !signed) || (where === 'disk' && !canDisk)) +
        o('cloud', T('Nube'), where === 'cloud' && signed, !signed) +
        (canDisk ? o('disk', T('Una carpeta del disco'), where === 'disk') : '') + '</select></label>' +
      '<div class="lmd-row lmd-row-line" data-dly-row="disk"' + (where === 'disk' && canDisk ? '' : ' hidden') + '><span data-dly="diskname"></span><button type="button" class="lmd-btn" data-dly="pick">' + esc(T('Elegir carpeta')) + '</button></div>' +
      '<label class="lmd-row" data-dly-row="folder"' + (where === 'local' || (where === 'cloud' && !signed) ? ' hidden' : '') + '><span>' + esc(T('Subcarpeta (opcional)')) + '</span><input type="text" data-dly="folder" spellcheck="false" autocomplete="off" placeholder="' + esc(T('diario')) + '"></label>' +
      '<label class="lmd-row"><span>' + esc(T('Nombre del archivo')) + '</span><input type="text" data-dly="name" spellcheck="false" autocomplete="off"></label>' +
      '<p class="lmd-tl-why" data-dly="err" role="alert" hidden>' + esc(T('El nombre lleva el año, el mes y el día: AAAA, MM y DD.')) + '</p>' +
      '<label class="lmd-row"><span>' + esc(T('Plantilla')) + '</span><select data-dly="tpl">' + o('', T('Mínima: fecha, tareas y notas'), !tid) + (own ? o('own', T('La nota que guardaste como plantilla'), tid === 'own') : '') +
        groups.map((g) => { const rows = list.filter((t) => t.group === g.id); return rows.length ? '<optgroup label="' + esc(g.name) + '">' + rows.map((t) => o(t.id, t.name, t.id === tid)).join('') + '</optgroup>' : ''; }).join('') + '</select></label>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('En una plantilla propia, {{fecha}} se cambia por la fecha del día.')) + '</span><button type="button" class="lmd-btn" data-dly="own">' + esc(T('Usar la nota abierta')) + '</button></div>' +
      '<div class="lmd-row lmd-row-line"><span>' + esc(T('Atajo: {a}.', { a: KEY })) + '</span><button type="button" class="lmd-btn" data-dly="go">' + esc(T('Abrir la nota de hoy')) + '</button></div>';
    const q = (k) => area.querySelector('[data-dly=' + k + ']');
    q('folder').value = String(opt('dailyFolder', '')); q('name').value = shown(pattern());
    q('diskname').textContent = root ? root.name : T('Todavía no elegiste una carpeta.');
    q('own').disabled = core.noDoc || !core.raw.trim();
    q('where').addEventListener('change', async (e) => { await keep({ dailyWhere: e.target.value }); paint(); settings(area, api); });
    q('pick').addEventListener('click', async () => {
      try { const r = await chooseDisk(); await keep({ dailyRoot: r.id, dailyWhere: 'disk' }); core.reloadTree(); paint(); settings(area, api); }
      catch (e) { if (!(e && e.name === 'AbortError')) core.flash(T('No se pudo abrir. Probá de nuevo.'), 'error'); }
    });
    q('folder').addEventListener('change', (e) => { e.target.value = e.target.value.split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/'); keep({ dailyFolder: e.target.value }); paint(); });
    q('name').addEventListener('change', (e) => {
      const v = e.target.value.trim().replace(/\.md$/i, ''); const ok = okPattern(v);
      q('err').hidden = ok; e.target.toggleAttribute('aria-invalid', !ok);
      if (ok) { keep({ dailyName: v.replace('AAAA', 'YYYY') }); paint(); }
    });
    q('tpl').addEventListener('change', (e) => keep({ dailyTemplate: e.target.value }));
    q('own').addEventListener('click', async () => { await keep({ dailyTemplateText: core.raw, dailyTemplate: 'own' }); settings(area, api); });
    q('go').addEventListener('click', () => { api.close(); openToday(); });
  }

  LMD.daily = { enable, disable, settings, openToday, openDay, calendar, closeCal, nameOf, dateOf, pathOf, place, current, names, textFor, iso, today };
})();
