// Ajustes de la página: lo que vale para una nota y no para la persona.
// Viven en el encabezado de la nota (el bloque entre --- del principio), con claves simples:
//   ---
//   width: wide
//   numbered: true
//   ---
// Así viajan con el archivo: sirven en el disco, en el navegador y en la nube, y los respeta quien la abra
// (también por un enlace público o en una sesión en vivo). La lista de claves es cerrada y cada valor se
// comprueba: una clave que no está acá, o un valor que no se entiende, no hace nada. Nunca entra CSS de la nota.
(function () {
  'use strict';

  const { el } = LMD.kit;
  const T = LMD.t;
  let core = null;

  // clave → valores que acepta. El primero es el de siempre, y no se escribe en la nota.
  // toc quedó de una versión anterior (ocultaba el índice lateral, que ya tiene su botón): la app no lo aplica ni lo
  // ofrece, pero se sigue reconociendo para no listarlo entre los datos de la nota ni tocarlo al escribir otro ajuste.
  const KEYS = { width: ['normal', 'wide', 'full'], numbered: ['no', 'yes'], toc: ['yes', 'no'] };
  const BOOL = ['numbered', 'toc']; // en la nota se escriben true o false
  const WORDS = { true: 'yes', yes: 'yes', on: 'yes', si: 'yes', 'sí': 'yes', false: 'no', no: 'no', off: 'no' };
  const HEAD = /^(﻿?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
  const clean = (key, v) => {
    v = String(v == null ? '' : v).trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase();
    if (BOOL.includes(key)) v = WORDS[v] || '';
    return KEYS[key] && KEYS[key].includes(v) ? v : null;
  };
  const rowOf = (line) => { const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); return kv ? [kv[1].toLowerCase(), kv[2]] : null; };

  // Los ajustes de un texto, cada uno con su valor (el de siempre si la nota no dice otra cosa).
  function read(raw) {
    const out = {}; Object.keys(KEYS).forEach((k) => { out[k] = KEYS[k][0]; });
    const m = HEAD.exec(String(raw || '')); if (!m) return out;
    m[2].split(/\r?\n/).forEach((line) => { const r = rowOf(line); if (!r || !KEYS[r[0]]) return; const v = clean(r[0], r[1]); if (v) out[r[0]] = v; });
    return out;
  }
  // El texto con ese ajuste puesto. El valor de siempre saca el renglón; si el encabezado queda vacío, se va entero.
  function write(raw, key, value) {
    raw = String(raw || ''); const v = clean(key, value); if (!KEYS[key] || v == null) return raw;
    const eol = /\r\n/.test(raw) ? '\r\n' : '\n'; const m = HEAD.exec(raw); const usual = v === KEYS[key][0];
    const line = key + ': ' + (BOOL.includes(key) ? String(v === 'yes') : v);
    if (!m) return usual ? raw : '---' + eol + line + eol + '---' + eol + (raw && !/^\r?\n/.test(raw) ? eol : '') + raw;
    const rows = m[2].split(/\r?\n/); const at = rows.findIndex((r) => { const x = rowOf(r); return x && x[0] === key; });
    if (usual) { if (at < 0) return raw; rows.splice(at, 1); } else if (at < 0) rows.push(line); else rows[at] = line;
    const rest = raw.slice(m[0].length);
    if (!rows.some((r) => r.trim())) return m[1] + rest.replace(/^\r?\n/, '');
    return m[1] + '---' + eol + rows.join(eol) + eol + '---' + eol + rest;
  }
  // Un renglón del encabezado que es un ajuste de la página: no se muestra entre los datos de la nota.
  const owns = (key, value) => clean(String(key || '').toLowerCase(), value) != null;

  const isMd = () => !!core && !core.noDoc && /\.(md|markdown|mdown|mkd)$/i.test(core.docName || '');
  const now = () => (isMd() ? read(core.raw) : read(''));
  function apply() {
    const s = now(); const root = document.documentElement;
    root.classList.toggle('lmd-pw-wide', s.width === 'wide');
    root.classList.toggle('lmd-pw-full', s.width === 'full');
    root.classList.toggle('lmd-page-numbered', s.numbered === 'yes');
    // La página ancha es más ancha que la de siempre también para quien ya eligió un ancho grande en sus ajustes.
    const mine = core && core.settings ? +core.settings.contentWidth || 0 : 0;
    root.style.setProperty('--lmd-page-wide', Math.max(1500, Math.round(mine * 1.3)) + 'px');
  }

  // ---------- Títulos numerados ----------
  // El número va como texto de verdad delante del título (un span que no se edita): así entra en lo que se elige y
  // se copia. No se escribe en el archivo. Un título que ya trae su número escrito ("4.", "4)", "4.2", "IV.", "A.")
  // lo conserva, y los que siguen sin número continúan desde ahí.
  const ROMAN = [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
  const toRoman = (n) => { let out = ''; ROMAN.forEach((r) => { while (n >= r[1]) { out += r[0]; n -= r[1]; } }); return out; };
  const fromRoman = (t) => { let n = 0; let rest = t; ROMAN.forEach((r) => { while (rest.startsWith(r[0])) { n += r[1]; rest = rest.slice(r[0].length); } }); return !rest && n > 0 && toRoman(n) === t ? n : 0; };
  const toAlpha = (n) => { let out = ''; while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); } return out; };
  const fmtNum = (kind, n) => (kind === 'roman' ? toRoman(n) : kind === 'alpha' ? toAlpha(n) : String(n));
  // El número con el que empieza un texto, si trae uno. was: cómo venían numerados los hermanos (decide si "C." es
  // una letra o un número romano).
  function ownNumber(text, was) {
    let m = /^(\d{1,4}(?:\.\d{1,4})*)([.)]?)\s/.exec(text);
    if (m) {
      const parts = m[1].split('.');
      if (parts.length === 1 && !m[2]) return null; // "2024 en números" no es una numeración
      return { kind: 'dec', n: +parts[parts.length - 1], head: parts.slice(0, -1).join('.'), label: m[1], end: m[2] };
    }
    m = /^([A-Z]{1,7})([.)])\s/.exec(text); if (!m) return null;
    const roman = fromRoman(m[1]); const letter = m[1].length === 1;
    if (letter && (was === 'alpha' || !roman || (was !== 'roman' && !/[IVX]/.test(m[1])))) return { kind: 'alpha', n: m[1].charCodeAt(0) - 64, head: '', label: m[1], end: m[2] };
    return roman ? { kind: 'roman', n: roman, head: '', label: m[1], end: m[2] } : null;
  }
  // Los números de una serie de títulos: [{ level, text }] → el texto que va delante de cada uno ('' si ya trae el
  // suyo). Se numeran los de nivel 2 ("5. ") y los de nivel 3 ("5.1 ").
  function numbers(list) {
    let a = { n: 0, kind: 'dec', label: '', end: '.' }; let b = { n: 0, kind: 'dec', head: '' };
    return list.map((h) => {
      if (h.level === 2) {
        const o = ownNumber(h.text, a.n ? a.kind : '');
        if (o) a = { n: o.n, kind: o.kind, label: o.label, head: o.head, end: o.end || '.' };
        else { a.n++; a.label = (a.head ? a.head + '.' : '') + fmtNum(a.kind, a.n); }
        b = { n: 0, kind: 'dec', head: a.label };
        return o ? '' : a.label + a.end + ' ';
      }
      if (h.level !== 3) return '';
      const o = ownNumber(h.text, b.n ? b.kind : '');
      // "4.2" deja el "4" como cabeza de los que siguen; "2." o "b)" solos, no llevan cabeza.
      if (o) { b = { n: o.n, kind: o.kind, head: o.head, bare: !o.head, end: o.end || '.' }; return ''; }
      b.n++;
      return b.bare ? fmtNum(b.kind, b.n) + b.end + ' ' : (b.head ? b.head + '.' : '') + fmtNum(b.kind, b.n) + (b.head ? ' ' : '. ');
    });
  }
  // Pone, cambia o saca el número de delante de un nodo, sin tocar el resto de lo que tiene.
  function stamp(node, text) {
    let s = node.querySelector(':scope > .lmd-hnum');
    if (!text) { if (s) s.remove(); return; }
    if (!s) s = el('span', { class: 'lmd-hnum', contenteditable: 'false' });
    if (s !== node.firstChild) node.insertBefore(s, node.firstChild);
    if (s.textContent !== text) s.textContent = text;
  }
  const plain = (h) => { const c = h.cloneNode(true); c.querySelectorAll('.lmd-anchor, .lmd-hnum').forEach((n) => n.remove()); return c.textContent.trim(); };
  // Los títulos de la nota con su número puesto, en el documento y en el índice del texto. El índice lateral lo
  // copia de cada título al armarse (buildOutline, que es quien llama acá).
  function number(headings) {
    if (!core) return;
    const art = core.ui.article; const on = now().numbered === 'yes';
    const hs = (headings || Array.from(art.querySelectorAll('h1, h2, h3, h4, h5, h6'))).filter((h) => h.parentNode === art);
    const nums = on ? numbers(hs.map((h) => ({ level: +h.tagName[1], text: plain(h) + ' ' }))) : [];
    const byId = {};
    hs.forEach((h, i) => { stamp(h, nums[i] || ''); if (h.id) byId[h.id] = nums[i] || ''; });
    art.querySelectorAll('.lmd-toc a').forEach((a) => stamp(a, byId[(a.getAttribute('href') || '').slice(1)] || ''));
  }
  // El Markdown de la nota con los números que se ven escritos en sus títulos: para copiarlo, o para dejarlos escritos.
  function md() {
    const lines = core.srcLines.slice(); const eol = /\r\n/.test(core.raw) ? '\r\n' : '\n';
    core.ui.article.querySelectorAll(':scope > h2, :scope > h3').forEach((h) => {
      const s = h.querySelector(':scope > .lmd-hnum'); const r = core.rangeOf(h); if (!s || !s.textContent || !r) return;
      const at = r[0] + core.fmOffset; if (lines[at] == null) return;
      lines[at] = lines[at].replace(/^(\s{0,3}(?:#{1,6}[ \t]+)?)/, (m) => m + s.textContent);
    });
    return lines.join(eol);
  }
  const get = (key) => now()[key];
  function set(key, value) {
    if (!isMd() || core.readOnly || clean(key, value) == null) return false;
    const next = write(core.raw, key, value); if (next === core.raw) return false;
    core.setRaw(next);
    return true;
  }

  // ---------- La ventana ----------
  const WIDTHS = [['normal', 'Normal'], ['wide', 'Ancha'], ['full', 'Completa']];
  function open() {
    if (!isMd()) return;
    const ro = !!core.readOnly; const s = now();
    const box = el('div', { class: 'lmd-ask lmd-pg' });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true" aria-label="' + T('Ajustes de la página') + '"><h3>' + T('Ajustes de la página') + '</h3>' +
      '<p class="lmd-pg-lead">' + T(ro ? 'Esta nota es de solo lectura.' : 'Se guardan en la nota y valen para quien la abra.') + '</p>' +
      '<div class="lmd-pg-row"><span id="lmd-pg-w">' + T('Ancho de la página') + '</span><div class="lmd-pg-seg" role="radiogroup" aria-labelledby="lmd-pg-w">' +
      WIDTHS.map((w) => '<button type="button" role="radio" data-pg-width="' + w[0] + '" aria-checked="' + (s.width === w[0]) + '"' + (ro ? ' disabled' : '') + '>' + T(w[1]) + '</button>').join('') + '</div></div>' +
      '<label class="lmd-check lmd-pg-row"><span>' + T('Numerar los títulos') + '</span><input type="checkbox" data-pg="numbered"' + (s.numbered === 'yes' ? ' checked' : '') + (ro ? ' disabled' : '') + '></label>' +
      '<p class="lmd-pg-note" data-pg-note="write"' + (s.numbered === 'yes' && !ro ? '' : ' hidden') + '><button type="button" class="lmd-link" data-pg="write">' + T('Escribir los números en la nota') + '</button></p>' +
      (core.settings && core.settings.centered === false ? '<p class="lmd-pg-note">' + T('Para cambiar el ancho, activá Centrar el contenido en Ajustes.') + '</p>' : '') +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-pg="ok" data-esc>' + T('Listo') + '</button></div></div>';
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && e.target.dataset.pg === 'ok')) { e.preventDefault(); close(); } });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    box.addEventListener('click', (e) => {
      const w = e.target.closest('[data-pg-width]');
      if (w && !ro) { set('width', w.dataset.pgWidth); box.querySelectorAll('[data-pg-width]').forEach((b) => b.setAttribute('aria-checked', String(b === w))); return; }
      // Los números pasan a estar escritos en cada título: de ahí en más son texto de la nota, como cualquier otro.
      if (e.target.closest('[data-pg=write]') && !ro) { const next = md(); if (next !== core.raw) core.setRaw(next); return; }
      if (e.target.closest('[data-pg=ok]')) close();
    });
    box.addEventListener('change', (e) => {
      if (e.target.dataset.pg !== 'numbered' || ro) return;
      set('numbered', e.target.checked ? 'yes' : 'no'); box.querySelector('[data-pg-note=write]').hidden = !e.target.checked;
    });
    box.querySelector('[data-pg=ok]').focus();
  }

  // ---------- Una sola vez por nota: ofrecer la página ancha ----------
  // Cuando un tablero o una tabla no entran en una nota de ancho normal, una línea ofrece pasarla a ancha.
  let bar = null;
  const seen = () => { try { return JSON.parse(localStorage.getItem('lmd-page-nudged') || '[]'); } catch (e) { return []; } };
  const dropBar = () => { if (bar) { bar.remove(); bar = null; } };
  function nudge() {
    if (bar && bar._for !== core.HERE) dropBar();
    if (bar || !isMd() || core.readOnly || now().width !== 'normal') { if (bar && (core.readOnly || now().width !== 'normal')) dropBar(); return; }
    const wide = Array.from(core.ui.article.querySelectorAll('.lmd-board, .lmd-table')).find((n) => n.scrollWidth > n.clientWidth + 8);
    if (!wide) return;
    const list = seen(); if (list.includes(core.HERE)) return;
    try { localStorage.setItem('lmd-page-nudged', JSON.stringify(list.concat(core.HERE).slice(-300))); } catch (e) { /* sin almacenamiento, se ofrece de nuevo la próxima */ }
    bar = el('div', { class: 'lmd-page-nudge', role: 'status' }); bar._for = core.HERE;
    bar.append(el('span', { text: T(wide.classList.contains('lmd-board') ? 'Este tablero es más ancho que la página.' : 'Esta tabla es más ancha que la página.') }),
      el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-nudge': 'wide', text: T('Usar página ancha') }), el('button', { type: 'button', class: 'lmd-link', 'data-nudge': 'no', text: T('Ahora no') }));
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-nudge]'); if (!b) return; const go = b.dataset.nudge === 'wide'; dropBar(); if (go) set('width', 'wide'); });
    document.body.appendChild(bar);
  }

  function init(c) {
    core = c;
    core.hooks.render.push(() => { apply(); if (LMD.board && LMD.board.fit) LMD.board.fit(); nudge(); });
    core.hooks.doc.push(() => { dropBar(); apply(); });
    // Mientras se escribe un título numerado la cuenta sigue al día: si se le tipea un número propio el automático se
    // va, y si Backspace se llevó el número (es un nodo que no se edita), vuelve.
    core.ui.article.addEventListener('input', (e) => {
      const h = e.target.closest && e.target.closest('h2, h3');
      if (h && h.parentNode === core.ui.article && isMd() && now().numbered === 'yes') number();
    });
  }

  LMD.page = { KEYS, read, write, owns, get, set, open, apply, init, number, numbers, md };
})();
