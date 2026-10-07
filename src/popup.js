const $ = (id) => document.getElementById(id);

// Estado de la versión: al abrir usa lo último que se consultó; el botón consulta GitHub en el momento.
function checkUpdate(force) {
  $('ver-check').classList.toggle('spin', !!force);
  chrome.runtime.sendMessage({ type: 'checkUpdate', force: !!force }, (r) => {
    $('ver-check').classList.remove('spin');
    if (chrome.runtime.lastError || !r || !r.ok || r.store) return; // desde la tienda la actualiza Chrome
    $('ver').hidden = false;
    $('ver-num').textContent = LMD.t('Versión {v}', { v: r.current });
    const state = $('ver-state');
    state.className = r.error && force ? 'bad' : (r.newer ? '' : 'ok');
    state.textContent = r.error && force ? LMD.t('No se pudo consultar') : (r.newer ? '' : '✓ ' + LMD.t('Al día'));
    $('upd').hidden = !r.newer;
    if (r.newer) $('upd-title').textContent = LMD.t('Hay una versión nueva: {v}', { v: r.latest });
  });
}

LMD.load().then((s) => {
  LMD.setLang(s.language);
  document.documentElement.lang = LMD.lang();
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = LMD.t(n.textContent.trim()); });
  $('ver-check').title = LMD.t('Buscar actualizaciones');
  if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) document.documentElement.style.setProperty('--accent', s.accent);
  checkUpdate(false);
});

chrome.extension.isAllowedFileSchemeAccess((allowed) => { $('file-note').hidden = allowed; });

const openApp = (query) => { chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html') + query }); window.close(); };
$('open-details').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }));
$('open-app').addEventListener('click', () => openApp(''));
$('new-file').addEventListener('click', () => openApp('?new=1'));
$('ver-check').addEventListener('click', () => checkUpdate(true));
$('upd-apply').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reloadExtension' }));
