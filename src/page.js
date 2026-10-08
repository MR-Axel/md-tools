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
  const KEYS = { width: ['normal', 'wide', 'full'], numbered: ['no', 'yes'] };
  const WORDS = { true: 'yes', yes: 'yes', on: 'yes', si: 'yes', 'sí': 'yes', false: 'no', no: 'no', off: 'no' };
  const HEAD = /^(﻿?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
  const clean = (key, v) => {
    v = String(v == null ? '' : v).trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase();
    if (key === 'numbered') v = WORDS[v] || '';
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
    const line = key + ': ' + (key === 'numbered' ? String(v === 'yes') : v);
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
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-pg="ok" data-esc>' + T('Listo') + '</button></div></div>';
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && e.target.dataset.pg === 'ok')) { e.preventDefault(); close(); } });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    box.addEventListener('click', (e) => {
      const w = e.target.closest('[data-pg-width]');
      if (w && !ro) { set('width', w.dataset.pgWidth); box.querySelectorAll('[data-pg-width]').forEach((b) => b.setAttribute('aria-checked', String(b === w))); return; }
      if (e.target.closest('[data-pg=ok]')) close();
    });
    box.addEventListener('change', (e) => { if (e.target.dataset.pg === 'numbered' && !ro) set('numbered', e.target.checked ? 'yes' : 'no'); });
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
  }

  LMD.page = { KEYS, read, write, owns, get, set, open, apply, init };
})();
