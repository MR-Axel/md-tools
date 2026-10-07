// Ícono de la nube en la barra: dice si la nota está sincronizada, guardando, sin conexión o fuera de la nube.
// Desde ahí se sube una nota a la nube y se abre el historial de versiones (plan pago).
(function () {
  'use strict';

  const { el, ICON, esc } = LMD.kit;
  const T = LMD.t;
  let core = null; let account = null; let asked = false;

  async function loadAccount() {
    if (asked || !LMD.cloud.signedIn()) return;
    asked = true;
    try { account = await LMD.cloud.account(); } catch (e) { account = null; asked = false; }
    paint();
  }

  const isCloud = () => !!core.appRoot && core.appRoot.kind === 'cloud';

  function paint() {
    const btn = core && core.ui.sync; if (!btn) return;
    btn.hidden = !LMD.cloud.enabled();
    if (btn.hidden) return;
    let icon = ICON.cloudOff; let cls = 'lmd-sync-off'; let title;
    if (isCloud()) {
      const state = core.cloudState;
      if (state === 'error') { icon = ICON.cloudAlert; cls = 'lmd-sync-err'; title = T('Sin conexión: los cambios no se están guardando en la nube'); }
      else if (state === 'saving') { icon = ICON.cloud; cls = 'lmd-sync-busy'; title = T('Guardando en la nube…'); }
      else { icon = ICON.cloudOk; cls = 'lmd-sync-ok'; title = T('Sincronizado con la nube'); }
    } else title = LMD.cloud.signedIn() ? T('Esta nota no está en la nube. Clic para subirla') : T('Sincronización apagada. Clic para entrar a tu cuenta');
    btn.className = 'lmd-icon-btn lmd-sync ' + cls;
    btn.innerHTML = icon; btn.title = title;
    loadAccount();
  }

  const cloudHref = (path) => '?f=' + encodeURIComponent('cloud/' + path.split('/').map(encodeURIComponent).join('/'));
  const goApp = (query) => { if (core.APP) location.href = core.appUrl + query; else core.openApp(query); };

  async function upload() {
    if (!window.confirm(T('¿Subir "{a}" a la nube? Queda una copia sincronizada; el archivo de acá no se toca.', { a: core.docName }))) return;
    try {
      const taken = new Set((await LMD.cloud.list(true)).map((n) => n.path));
      const dot = core.docName.lastIndexOf('.'); const stem = dot > 0 ? core.docName.slice(0, dot) : core.docName; const ext = dot > 0 ? core.docName.slice(dot) : '.md';
      let path = stem + ext;
      for (let n = 2; n < 50 && taken.has(path); n++) path = stem + '-' + n + ext;
      await LMD.cloud.write(path, core.raw);
      goApp(cloudHref(path));
    } catch (e) {
      core.flash(T(e.code === 'note_limit' ? 'Llegaste al límite de notas del plan gratis.' : e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo subir la nota.'), 'error');
    }
  }

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function openMenu(btn) {
    closeMenu();
    const pro = !!account && account.plan === 'pro';
    menu = el('div', { class: 'lmd-menu lmd-menu-narrow', role: 'menu' });
    menu.innerHTML = '<div class="lmd-menu-list">' +
      '<button type="button" role="menuitem" data-s="history"' + (pro ? '' : ' class="lmd-locked"') + '>' + ICON.reload + '<span>' + T('Historial de versiones') + '</span></button>' +
      '<button type="button" role="menuitem" data-s="ai"' + (account && account.mcp ? '' : ' class="lmd-locked"') + '>' + ICON.link + '<span>' + T('Conectar una IA') + '</span></button>' +
      (account ? '<p class="lmd-menu-label">' + esc(account.email) + ' · ' + T(pro ? 'Plan pago' : 'Plan gratis') + '</p>' : '') + '</div>';
    document.body.appendChild(menu);
    const box = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, box.left)) + 'px';
    menu.style.top = (box.bottom + 8) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      closeMenu();
      if (b.classList.contains('lmd-locked')) { core.flash(T(b.dataset.s === 'history' ? 'El historial de versiones es parte del plan pago.' : 'Conectar una IA es parte del plan pago.'), 'warn'); return; }
      if (b.dataset.s === 'history') history(); else goApp('');
    });
  }

  async function history() {
    let list = [];
    try { list = await LMD.cloud.api('GET', '/versions/' + encodeURIComponent(core.cloudPath)); } catch (e) { core.flash(T('No hay conexión con el servidor.'), 'error'); return; }
    const box = el('div', { class: 'lmd-ask' });
    const fmt = (ms) => new Date(ms).toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'medium', timeStyle: 'short' });
    box.innerHTML = '<div class="lmd-ask-card lmd-hist" role="dialog" aria-label="' + T('Historial de versiones') + '"><h3>' + T('Historial de versiones') + '</h3>' +
      (list.length ? '<div class="lmd-hist-body"><ul>' + list.map((v) => '<li><button type="button" data-v="' + v.id + '">' + esc(fmt(v.saved)) + '<small>' + v.size + '</small></button></li>').join('') + '</ul><pre></pre></div>'
        : '<p>' + T('Todavía no hay versiones anteriores de esta nota.') + '</p>') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-h="no">' + T('Cerrar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-h="ok" disabled>' + T('Restaurar esta versión') + '</button></div></div>';
    document.body.appendChild(box);
    let chosen = null;
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-h=no]')) { box.remove(); return; }
      const v = e.target.closest('[data-v]');
      if (v) {
        try { const r = await LMD.cloud.api('GET', '/version/' + v.dataset.v); chosen = r.text; box.querySelector('pre').textContent = r.text; box.querySelector('[data-h=ok]').disabled = false; box.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('lmd-on', b === v)); }
        catch (err) { core.flash(T('No hay conexión con el servidor.'), 'error'); }
        return;
      }
      if (e.target.closest('[data-h=ok]') && chosen != null) { box.remove(); core.setRaw(chosen); core.flash(T('Versión restaurada. Ctrl+Z la deshace')); }
    });
  }

  function click(btn) {
    if (isCloud()) { openMenu(btn); return; }
    if (LMD.cloud.signedIn()) upload(); else goApp('');
  }

  function init(c) {
    core = c;
    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    LMD.cloud.ready().then(paint);
  }

  LMD.sync = { init, paint, click };
})();
