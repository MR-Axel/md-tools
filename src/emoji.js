// Emojis al escribir: después de ":" aparece una lista con los que coinciden.
// Flechas para moverse, Enter o Tab para elegir, Escape para cerrar. Se inserta el carácter, no el código.
(function () {
  'use strict';

  const COMMON = ['smile', 'joy', 'heart', '+1', 'tada', 'rocket', 'fire', 'eyes', 'white_check_mark', 'warning'];
  const MAX = 8;
  let list = null; // [[nombre, carácter], ...], se arma la primera vez
  let box = null; let items = []; let at = 0; let found = null;

  const all = () => list || (list = (LMD.EMOJI || '').split('|').map((p) => { const i = p.lastIndexOf(' '); return [p.slice(0, i), p.slice(i + 1)]; }));

  function search(q) {
    const data = all();
    if (!q) return COMMON.map((n) => data.find((e) => e[0] === n)).filter(Boolean);
    const starts = []; const has = [];
    for (let i = 0; i < data.length && starts.length < MAX; i++) {
      const pos = data[i][0].indexOf(q);
      if (pos === 0) starts.push(data[i]); else if (pos > 0 && has.length < MAX) has.push(data[i]);
    }
    return starts.concat(has).slice(0, MAX);
  }

  // El ":" tiene que abrir palabra: "10:30" o "https://" no despliegan nada.
  function query() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return null;
    const host = node.parentElement && node.parentElement.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    if (!host || !host.closest('.lmd-article') || node.parentElement.closest('code, pre, .lmd-src')) return null;
    const m = /(^|[\s(¡¿])(:([a-z0-9_+-]{0,30}))$/i.exec(node.nodeValue.slice(0, sel.anchorOffset));
    return m ? { node, start: sel.anchorOffset - m[2].length, end: sel.anchorOffset, q: m[3].toLowerCase() } : null;
  }

  function close() { if (box) box.hidden = true; found = null; items = []; }

  function paint() {
    box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('lmd-on', i === at));
  }

  function pick(i) {
    const e = items[i]; const f = found;
    if (!e || !f || !f.node.isConnected) { close(); return; }
    const range = document.createRange(); range.setStart(f.node, f.start); range.setEnd(f.node, f.end);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    close();
    document.execCommand('insertText', false, e[1]);
  }

  function update() {
    const f = query();
    const res = f ? search(f.q) : [];
    if (!f || !res.length) { close(); return; }
    if (!box) {
      box = document.createElement('div'); box.className = 'lmd-emoji'; box.setAttribute('role', 'listbox');
      box.addEventListener('mousedown', (ev) => { ev.preventDefault(); const b = ev.target.closest('button'); if (b) pick(+b.dataset.i); });
      document.body.appendChild(box);
    }
    found = f; items = res; at = 0;
    box.textContent = '';
    res.forEach((e, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i; b.setAttribute('role', 'option');
      const c = document.createElement('span'); c.textContent = e[1];
      const n = document.createElement('small'); n.textContent = ':' + e[0] + ':';
      b.append(c, n); box.appendChild(b);
    });
    paint();
    const range = document.createRange(); range.setStart(f.node, f.start); range.setEnd(f.node, f.end);
    const r = range.getBoundingClientRect();
    box.hidden = false;
    const h = box.offsetHeight; const w = box.offsetWidth;
    const below = r.bottom + 6 + h <= window.innerHeight;
    box.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  }

  document.addEventListener('input', (e) => { if (e.target && e.target.isContentEditable) update(); else close(); });
  // En captura: Enter y las flechas tienen que llegar acá antes que al editor, que con Enter abre un bloque nuevo.
  document.addEventListener('keydown', (e) => {
    if (!box || box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { at = (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') pick(at);
    else if (e.key === 'Escape') close();
    else { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') close(); return; }
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('mousedown', (e) => { if (box && !box.hidden && !box.contains(e.target)) close(); });
  document.addEventListener('focusout', () => setTimeout(() => { if (box && !box.hidden && !query()) close(); }, 0));
  window.addEventListener('scroll', close, { passive: true });
})();
