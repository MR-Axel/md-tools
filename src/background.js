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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
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
