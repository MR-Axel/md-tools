// Service worker: lee archivos y carpetas por la página (que no puede hacer fetch de file://),
// inyecta las librerías pesadas solo cuando el documento las usa, y reparte los atajos.
importScripts('defaults.js');

const LAZY = {
  katex: { js: ['vendor/katex/katex.min.js'], css: 'vendor/katex/katex.min.css' },
  mermaid: { js: ['vendor/mermaid.min.js'] },
  graphviz: { js: ['vendor/viz-global.js'] },
};

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok && res.status !== 0) throw new Error('HTTP ' + res.status);
  return await res.text();
}

async function lazyLoad(tabId, what) {
  const spec = LAZY[what];
  if (!spec) throw new Error('desconocido: ' + what);
  if (spec.css) {
    const raw = await (await fetch(chrome.runtime.getURL(spec.css))).text();
    const css = raw.split('__LMD_BASE__').join(chrome.runtime.getURL(''));
    await chrome.scripting.insertCSS({ target: { tabId }, css });
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: spec.js });
}

// Versión nueva: se compara la del manifest instalado con la del manifest publicado en GitHub.
// Si la extensión viene de la tienda (tiene update_url) no hace falta: Chrome la actualiza solo.
const REPO_MANIFEST = 'https://raw.githubusercontent.com/MR-Axel/md-tools/main/manifest.json';
const EVERY = { daily: 864e5, weekly: 6048e5 };

function isNewer(a, b) {
  const pa = String(a || '').split('.').map(Number); const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function checkUpdate(force) {
  const manifest = chrome.runtime.getManifest();
  const current = manifest.version;
  if (manifest.update_url) return { current, store: true };
  const s = await LMD.load();
  const st = (await chrome.storage.local.get('update')).update || {};
  const every = EVERY[s.updateCheck];
  let error = '';
  if (force || (every && Date.now() - (st.checkedAt || 0) > every)) {
    try {
      st.latest = JSON.parse(await fetchText(REPO_MANIFEST)).version;
      st.checkedAt = Date.now();
    } catch (e) {
      error = String(e && e.message || e);
      if (every) st.checkedAt = Date.now() - every + 36e5; // sin red: se reintenta en una hora
    }
    await chrome.storage.local.set({ update: st });
  }
  const newer = isNewer(st.latest, current);
  return { current, latest: st.latest || '', newer, dismissed: newer && st.dismissed === st.latest, error };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'checkUpdate') {
    checkUpdate(!!msg.force)
      .then((r) => sendResponse(Object.assign({ ok: true }, r)))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'dismissUpdate') {
    chrome.storage.local.get('update').then((r) => chrome.storage.local.set({ update: Object.assign({}, r.update, { dismissed: msg.version }) })).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'openApp') { chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html') }); sendResponse({ ok: true }); return; }
  if (msg.type === 'reloadExtension') { sendResponse({ ok: true }); setTimeout(() => chrome.runtime.reload(), 150); return; }
  if (msg.type === 'fetchText') {
    fetchText(msg.url)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'lazyLoad') {
    lazyLoad(sender.tab.id, msg.what)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});

const THEMES = ['auto', 'light', 'dark'];

chrome.commands.onCommand.addListener(async (command) => {
  const s = await LMD.load();
  if (command === 'toggleSidebar') await LMD.patch({ sidebarHidden: !s.sidebarHidden });
  if (command === 'toggleCentered') await LMD.patch({ centered: !s.centered });
  if (command === 'toggleRefresh') await LMD.patch({ autoRefresh: !s.autoRefresh });
  if (command === 'toggleTheme') {
    await LMD.patch({ theme: THEMES[(THEMES.indexOf(s.theme) + 1) % THEMES.length] });
  }
});
