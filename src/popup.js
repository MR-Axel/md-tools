document.getElementById('sponsor').href = LMD.SPONSOR_URL;

LMD.load().then((s) => {
  LMD.setLang(s.language);
  document.documentElement.lang = LMD.lang();
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = LMD.t(n.textContent.trim()); });
  if (s.supporter) document.querySelector('#sponsor span').textContent = LMD.t('Gracias por apoyar');
  if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) document.documentElement.style.setProperty('--accent', s.accent);
  document.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    input.checked = !!s[key];
    input.addEventListener('change', () => LMD.patch({ [key]: input.checked }));
  });
});

chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  document.getElementById('file-note').hidden = allowed;
});

document.getElementById('open-details').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
});

document.getElementById('open-app').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html') });
  window.close();
});
