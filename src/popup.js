document.getElementById('sponsor').href = LMD.SPONSOR_URL;

LMD.load().then((s) => {
  LMD.setLang(s.language);
  document.documentElement.lang = LMD.lang();
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = LMD.t(n.textContent.trim()); });
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.seg;
    const paint = (v) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    paint(s[key]);
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { paint(b.dataset.val); LMD.patch({ [key]: b.dataset.val }); }));
  });
  if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) document.documentElement.style.setProperty('--accent', s.accent);
  document.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    if (input.type === 'checkbox') input.checked = !!s[key];
    else input.value = s[key];
    input.addEventListener('change', () => {
      LMD.patch({ [key]: input.type === 'checkbox' ? input.checked : input.value });
    });
  });
});

chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  document.getElementById('file-note').hidden = allowed;
});

document.getElementById('open-details').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
});
