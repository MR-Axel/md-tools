// Enlaces internos: el selector (una sección de este documento, otro archivo o una dirección web),
// el modo de marcar el destino con un clic sobre un título, y la lista que completa [[archivo]] y
// [[archivo#Sección]] al escribir.
(function () {
  'use strict';

  const { el, esc, ICON, MD_RE } = LMD.kit;
  const T = LMD.t;
  let core = null; // lo pasa el lector al iniciar

  const HEADS = 'h1, h2, h3, h4, h5, h6';
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const baseName = (rel) => rel.split('/').pop().replace(MD_RE, '');
  const dirName = (rel) => rel.split('/').slice(0, -1).join('/');
  const wikiKey = (s) => s.toLowerCase().replace(MD_RE, '').replace(/[\s_-]+/g, '');
  const isInner = (href) => !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
  const unesc = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  // El enlace como Markdown, para cuando va en un renglón propio.
  const md = (link) => '[' + (link.label || link.href).replace(/([\\[\]*`])/g, '\\$1') + '](' + link.href + ')';

  function setHref(a, href) {
    if (core.APP && isInner(href) && href[0] !== '#') { a.setAttribute('data-lmd-href', href); a.href = core.toHref(new URL(href, core.HERE).href); }
    else { a.removeAttribute('data-lmd-href'); a.setAttribute('href', href); }
    if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }

  // Una dirección escrita a mano: se acepta web, correo, teléfono o una ruta; lo demás se rechaza.
  function webHref(value) {
    let v = value.trim(); if (!v) return null;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
    if (scheme && !/^(https?|mailto|tel)$/i.test(scheme[1])) return null;
    if (!scheme && !/^[#./]/.test(v) && !MD_RE.test(v.split('#')[0]) && /^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(v)) v = 'https://' + v;
    return v.replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  // ---------- Dónde va el enlace ----------
  // Se guarda el bloque y la selección contada en caracteres: así se la reencuentra aunque el documento se redibuje.
  function capture() {
    const sel = getSelection(); if (!sel.rangeCount) return null;
    const node = sel.anchorNode; const host = node && (node.nodeType === 1 ? node : node.parentElement).closest('.lmd-editable');
    if (!host || !core.ui.article.contains(host)) return null;
    const range = sel.getRangeAt(0);
    const upto = (c, o) => { const r = document.createRange(); r.selectNodeContents(host); if (host.contains(c)) r.setEnd(c, o); return r.toString().length; };
    const inLink = (n) => { const a = n && (n.nodeType === 1 ? n : n.parentElement).closest('a'); return a && host.contains(a) && !a.classList.contains('lmd-wiki') ? a : null; };
    const link = inLink(range.startContainer) || inLink(range.endContainer);
    return { host, start: upto(range.startContainer, range.startOffset), end: upto(range.endContainer, range.endOffset), text: sel.toString().trim(), link, linkAt: link ? Array.from(host.querySelectorAll('a')).indexOf(link) : -1 };
  }

  function locate(ctx) {
    const host = ctx.host;
    if (host.isConnected) return host;
    const article = core.ui.article;
    if (host.classList.contains('lmd-cell')) {
      const old = host.closest('table'); const table = old && article.querySelector('table[data-l="' + old.getAttribute('data-l') + '"]');
      return (table && table.rows[+host.dataset.r] && table.rows[+host.dataset.r].cells[+host.dataset.c]) || null;
    }
    const key = host.getAttribute('data-l');
    return key ? article.querySelector('.lmd-editable[data-l="' + key + '"]') : null;
  }

  function rangeIn(host, start, end) {
    const r = document.createRange(); r.selectNodeContents(host); r.collapse(false);
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n; let pos = 0; let began = false;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (!began && start <= pos + len) { r.setStart(n, start - pos); began = true; }
      if (began && end <= pos + len) { r.setEnd(n, end - pos); return r; }
      pos += len;
    }
    return r;
  }

  // Pone, cambia o quita el enlace. El bloque se guarda al salir de él, como cualquier otro cambio.
  function apply(ctx, res) {
    const host = ctx && locate(ctx);
    if (!host) { if (res.href) LMD.write.append([md(res)]); return; }
    host.focus();
    if (host._md == null) host._md = LMD.serialize.inlineMd(host);
    const sel = getSelection();
    let a = ctx.linkAt >= 0 ? host.querySelectorAll('a')[ctx.linkAt] : null;
    const after = document.createTextNode('​'); // deja el cursor afuera del enlace; no se guarda en el archivo
    if (res.remove) {
      if (!a) return;
      a.after(after); a.replaceWith(...a.childNodes);
    } else {
      if (!a) {
        const range = rangeIn(host, ctx.start, ctx.end);
        a = document.createElement('a');
        if (range.collapsed) a.textContent = res.label || res.href;
        else { a.appendChild(range.extractContents()); a.querySelectorAll('a').forEach((x) => x.replaceWith(...x.childNodes)); }
        range.insertNode(a);
      }
      setHref(a, res.href);
      a.after(after);
    }
    sel.collapse(after, 1);
  }

  function restore(ctx) {
    const host = ctx && locate(ctx); if (!host) return;
    host.focus();
    const r = rangeIn(host, ctx.start, ctx.end); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }

  // ---------- Marcar en el documento ----------
  let picking = false;
  function pickHeading(done) {
    picking = true;
    const root = document.documentElement; root.classList.add('lmd-picking');
    const bar = el('div', { class: 'lmd-pickbar', role: 'status' });
    bar.append(el('span', { text: T('Hacé clic en el título al que va el enlace') }), el('button', { type: 'button', class: 'lmd-btn', text: T('Cancelar') }));
    document.body.appendChild(bar);
    const end = (res) => {
      picking = false; root.classList.remove('lmd-picking'); bar.remove();
      document.removeEventListener('mousedown', onDown, true); document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey, true);
      done(res);
    };
    // El clic elige: no tiene que mover el cursor ni abrir nada de lo que hay en el documento.
    const onDown = (e) => { if (e.target.closest('.lmd-article')) e.preventDefault(); };
    const onClick = (e) => {
      if (e.target.closest('.lmd-pickbar button')) { end(null); return; }
      if (!e.target.closest('.lmd-article')) return;
      e.preventDefault(); e.stopPropagation();
      const h = e.target.closest(HEADS); const hit = h && core.links.headings().find((x) => x.el === h);
      if (hit) end({ href: '#' + hit.gh, label: hit.text });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(null); } };
    document.addEventListener('mousedown', onDown, true); document.addEventListener('click', onClick, true); window.addEventListener('keydown', onKey, true);
  }

  // ---------- Selector ----------
  const TABS = [['here', 'Este documento', 'Filtrar títulos'], ['file', 'Otro archivo', 'Filtrar archivos'], ['web', 'Dirección web', 'https://']];
  let dlg = null;

  // Devuelve { href, label } con lo elegido, { remove: true } para quitar el enlace, o null si se canceló.
  // opt: { tabs: ['file', 'web'], cur } para elegir un destino fuera del texto (el campo Enlace de una tarjeta).
  function dialog(ctx, opt) {
    return new Promise((resolve) => {
      if (dlg || picking) { resolve(null); return; }
      LMD.write.closeMenu();
      core.hold = true;
      const cur = opt && opt.cur != null ? String(opt.cur) : ctx && ctx.link ? LMD.serialize.niceHref(ctx.link.getAttribute('data-lmd-href') || ctx.link.getAttribute('href') || '') : '';
      const tabs = opt && opt.tabs ? TABS.filter((t) => opt.tabs.includes(t[0])) : TABS;
      let tab = !cur || cur[0] === '#' ? 'here' : isInner(cur) ? 'file' : 'web';
      if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
      const heads = core.links.headings();
      let files; // sin pedir todavía; null mientras se lee; false si no se pudo
      const opened = new Map(); // archivo desplegado -> sus títulos, o null mientras se lee
      let items = []; let at = 0; let sel = null;

      const box = el('div', { class: 'lmd-ask lmd-lk' });
      box.innerHTML =
        '<div class="lmd-ask-card lmd-lk-card" role="dialog" aria-label="' + T(cur ? 'Editar el enlace' : 'Enlace') + '">' +
          '<h3>' + T(cur ? 'Editar el enlace' : 'Enlace') + '</h3>' +
          (cur ? '<p class="lmd-lk-now">' + T('Ahora lleva a') + ' <code>' + esc(cur) + '</code></p>' : '') +
          '<div class="lmd-seg" role="radiogroup" aria-label="' + T('Destino') + '">' + tabs.map((t) => '<button type="button" role="radio" data-val="' + t[0] + '">' + T(t[1]) + '</button>').join('') + '</div>' +
          '<input type="text" class="lmd-lk-q" spellcheck="false" autocomplete="off">' +
          '<div class="lmd-lk-list" role="listbox"></div>' +
          '<p class="lmd-img-err" hidden></p>' +
          '<div class="lmd-ask-actions lmd-lk-actions">' +
            '<button type="button" class="lmd-btn lmd-lk-mark" data-lk="mark">' + ICON.pencil + '<span>' + T('Marcar en el documento') + '</span></button>' +
            (cur ? '<button type="button" class="lmd-link lmd-lk-remove" data-lk="remove">' + T('Quitar el enlace') + '</button>' : '') +
            '<span class="lmd-lk-gap"></span>' +
            '<button type="button" class="lmd-btn" data-lk="no">' + T('Cancelar') + '</button>' +
            '<button type="button" class="lmd-btn lmd-btn-fill" data-lk="ok">' + T(cur ? 'Cambiar' : 'Insertar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(box); dlg = box;
      const input = box.querySelector('.lmd-lk-q'); const list = box.querySelector('.lmd-lk-list'); const err = box.querySelector('.lmd-img-err');
      const mark = box.querySelector('[data-lk=mark]');

      const close = () => { box.remove(); dlg = null; };
      const finish = (res) => { close(); core.hold = false; resolve(res); };
      // Con texto elegido, el texto del enlace es ese; sin texto, el del título o el nombre del archivo.
      const choose = (item) => { if (item) finish({ href: item.href, label: item.label }); };
      const fail = (text) => { err.hidden = false; err.textContent = text; };

      const paint = () => {
        list.querySelectorAll('.lmd-lk-row').forEach((b) => { const on = +b.dataset.i === at; b.classList.toggle('lmd-on', on); b.setAttribute('aria-selected', String(on)); });
        const on = list.querySelector('.lmd-lk-row.lmd-on'); if (on) on.scrollIntoView({ block: 'nearest' });
      };
      const row = (cls, item, html) => {
        const b = el('button', { type: 'button', class: 'lmd-lk-row ' + cls, role: 'option', title: item.label }, html);
        b.dataset.i = items.length; items.push(item);
        return b;
      };
      const headRow = (h, min, item) => { const b = row('lmd-lk-l' + Math.min(h.level - min + 1, 4), item, '<i></i><span></span>'); b.lastChild.textContent = h.text; return b; };
      const empty = (text) => list.appendChild(el('p', { class: 'lmd-empty', text }));
      const draw = () => {
        const q = fold(input.value.trim()); list.textContent = ''; items = [];
        list.hidden = tab === 'web';
        if (tab === 'here') {
          const show = heads.filter((h) => !q || fold(h.text).includes(q));
          const min = heads.length ? Math.min.apply(null, heads.map((h) => h.level)) : 1;
          if (!heads.length) empty(T('Este documento no tiene títulos.')); else if (!show.length) empty(T('Ningún título coincide.'));
          show.forEach((h) => list.appendChild(headRow(h, min, { ref: h, href: '#' + h.gh, label: h.text })));
        } else if (tab === 'file') {
          if (files == null) empty(T('Leyendo carpeta…'));
          else if (files === false) empty(T('No se pudo leer la carpeta.'));
          else {
            const show = files.filter((f) => !q || fold(f.rel).includes(q));
            if (!files.length) empty(T('No hay otros archivos Markdown en esta carpeta.')); else if (!show.length) empty(T('Ningún archivo coincide.'));
            show.forEach((f) => {
              const open = opened.has(f.url); const kids = opened.get(f.url);
              const line = el('div', { class: 'lmd-lk-file' + (open ? ' lmd-open' : '') });
              const tog = el('button', { type: 'button', class: 'lmd-lk-tog', title: T('Ver sus títulos'), 'aria-expanded': String(open) }, ICON.chevron);
              tog.addEventListener('click', () => toggle(f));
              const b = row('', { ref: f, file: f, href: core.links.rel(f.url), label: baseName(f.rel) }, ICON.md + '<span></span><small></small>');
              b.children[1].textContent = f.rel.split('/').pop(); b.children[2].textContent = dirName(f.rel);
              line.append(tog, b); list.appendChild(line);
              if (!open) return;
              if (!kids) { list.appendChild(el('p', { class: 'lmd-empty lmd-lk-sub', text: T('Leyendo…') })); return; }
              if (!kids.length) { list.appendChild(el('p', { class: 'lmd-empty lmd-lk-sub', text: T('Este archivo no tiene títulos.') })); return; }
              const min = Math.min.apply(null, kids.map((h) => h.level));
              kids.forEach((h) => { const s = headRow(h, min, { ref: h, href: core.links.rel(f.url) + '#' + h.gh, label: h.text }); s.classList.add('lmd-lk-sub'); list.appendChild(s); });
            });
          }
        }
        at = Math.max(0, items.findIndex((x) => x.ref === sel));
        paint();
      };
      const move = (i) => { at = i; sel = items[at] ? items[at].ref : null; paint(); };

      async function toggle(f) {
        if (opened.has(f.url)) { opened.delete(f.url); sel = f; draw(); return; }
        // El archivo se lee recién ahora, cuando se piden sus títulos.
        opened.set(f.url, null); sel = f; draw();
        const text = await core.links.read(f.url);
        if (!dlg || !opened.has(f.url)) return;
        opened.set(f.url, text == null ? [] : core.links.headingsIn(text));
        draw();
      }
      async function loadFiles() {
        if (files !== undefined) return;
        files = null; draw();
        const got = await core.links.files();
        if (dlg !== box) return;
        files = got || false;
        // Al editar un enlace a otro archivo queda marcado ese archivo, y si iba a una sección, esa sección.
        if (files && cur && isInner(cur) && cur[0] !== '#') {
          const target = new URL(cur, core.HERE).href; const f = files.find((x) => core.links.same(x.url, target)); const frag = unesc((cur.split('#')[1] || ''));
          if (f) { sel = f; if (frag) { await toggle(f); const kids = opened.get(f.url) || []; sel = kids.find((h) => h.gh === frag.toLowerCase() || h.id === frag) || f; } }
        }
        if (dlg === box) draw();
      }
      const show = (name) => {
        tab = name; err.hidden = true;
        box.querySelectorAll('.lmd-seg button').forEach((b) => { const on = b.dataset.val === tab; b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on)); });
        input.placeholder = T(TABS.find((t) => t[0] === tab)[2]);
        input.value = tab === 'web' && cur && !isInner(cur) ? cur : '';
        mark.hidden = tab !== 'here' || !heads.length;
        if (tab === 'file') loadFiles();
        draw(); input.focus(); input.select();
      };
      const ok = () => {
        if (tab !== 'web') { choose(items[at]); return; }
        const href = webHref(input.value);
        if (!input.value.trim()) fail(T('Falta la dirección.'));
        else if (!href) fail(T('Esa dirección no sirve para un enlace.'));
        else finish({ href, label: href.replace(/^https:\/\//i, '').replace(/\/$/, '') });
      };

      box.addEventListener('mousedown', (e) => { if (e.target === box) finish(null); });
      box.addEventListener('click', (e) => {
        const seg = e.target.closest('.lmd-seg button'); if (seg) { show(seg.dataset.val); return; }
        const r = e.target.closest('.lmd-lk-row'); if (r) { choose(items[+r.dataset.i]); return; }
        const b = e.target.closest('[data-lk]'); if (!b) return;
        if (b.dataset.lk === 'no') finish(null);
        else if (b.dataset.lk === 'ok') ok();
        else if (b.dataset.lk === 'remove') finish({ remove: true });
        else if (b.dataset.lk === 'mark') { close(); pickHeading((res) => { core.hold = false; resolve(res); }); }
      });
      input.addEventListener('input', () => { err.hidden = true; sel = null; draw(); });
      // Flechas, Enter y Escape, como en la lista de emojis.
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); ok(); return; }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) { e.preventDefault(); move((at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); }
      });

      if (cur && cur[0] === '#') { const hit = core.links.find(unesc(cur.slice(1))); const h = heads.find((x) => x.el === hit); sel = h || null; }
      show(tab);
    });
  }

  // Desde la barra de formato o Ctrl+K: el enlace va sobre la selección, o donde está el cursor.
  function open() {
    if (dlg || picking) return;
    let ctx = capture();
    if (ctx && ctx.host.classList.contains('lmd-draft')) {
      // Un bloque recién escrito todavía no está en el archivo: se lo pasa antes, para que el enlace tenga dónde ir.
      const made = ctx.host.textContent.trim() ? LMD.write.settle(ctx.host) : null;
      ctx = made ? Object.assign(ctx, { host: made, link: ctx.linkAt >= 0 ? made.querySelectorAll('a')[ctx.linkAt] : null }) : null;
    }
    core.ui.format.hidden = true;
    dialog(ctx).then((res) => {
      if (res) apply(ctx, res); else restore(ctx);
      core.softRender();
    });
  }

  // ---------- [[ al escribir ----------
  // Después de "[[" aparece la lista de archivos; después de "[[archivo#", la de sus títulos.
  const MAX = 8;
  let wbox = null; let witems = []; let wat = 0; let wfound = null; let wseq = 0;
  const wheads = new Map();

  function wquery() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return null;
    const host = node.parentElement && node.parentElement.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    if (!host || !host.closest('.lmd-article') || node.parentElement.closest('code, pre, .lmd-src')) return null;
    const m = /\[\[([^[\]|#\n]{0,80})(?:#([^[\]|\n]{0,80}))?$/.exec(node.nodeValue.slice(0, sel.anchorOffset));
    return m ? { node, start: sel.anchorOffset - m[0].length, end: sel.anchorOffset, name: m[1], sec: m[2] } : null;
  }
  function wclose() { wseq++; if (wbox) wbox.hidden = true; wfound = null; witems = []; }
  function wpaint() { wbox.querySelectorAll('button').forEach((b, i) => b.classList.toggle('lmd-on', i === wat)); }

  function wpick(i) {
    const e = witems[i]; const f = wfound;
    if (!e || !f || !f.node.isConnected) { wclose(); return; }
    const range = document.createRange(); range.setStart(f.node, f.start); range.setEnd(f.node, f.end);
    wclose();
    range.deleteContents();
    const a = el('a', { class: 'lmd-wiki', 'data-wiki': e.wiki, contenteditable: 'false', href: core.toHref(e.url), text: e.wiki });
    const after = document.createTextNode('​');
    range.insertNode(after); range.insertNode(a);
    getSelection().collapse(after, 1);
  }

  async function wupdate() {
    const emoji = document.querySelector('.lmd-emoji:not(.lmd-wikibox):not([hidden])');
    const f = core && core.editMode && core.settings.plugins.wikilinks && !emoji ? wquery() : null;
    if (!f) { wclose(); return; }
    const seq = ++wseq;
    const files = ((await core.links.files(true)) || []).filter((x) => !/[|#[\]]/.test(baseName(x.rel)));
    if (seq !== wseq) return;
    let res = [];
    if (f.sec === undefined) {
      const q = fold(f.name.trim());
      const hit = files.filter((x) => !q || fold(x.rel).includes(q));
      const first = hit.filter((x) => fold(baseName(x.rel)).indexOf(q) === 0);
      res = first.concat(hit.filter((x) => first.indexOf(x) === -1)).slice(0, MAX).map((x) => ({ icon: ICON.md, text: baseName(x.rel), hint: dirName(x.rel), wiki: baseName(x.rel), url: x.url }));
    } else {
      const file = files.find((x) => wikiKey(baseName(x.rel)) === wikiKey(f.name.trim()));
      if (file) {
        if (!wheads.has(file.url)) { const text = await core.links.read(file.url); wheads.set(file.url, text == null ? [] : core.links.headingsIn(text)); setTimeout(() => wheads.delete(file.url), 20000); }
        if (seq !== wseq) return;
        const q = fold(f.sec.trim());
        res = wheads.get(file.url).filter((h) => !/[|[\]]/.test(h.text) && (!q || fold(h.text).includes(q))).slice(0, MAX).map((h) => ({ icon: '<b>#</b>', text: h.text, hint: '', wiki: baseName(file.rel) + '#' + h.text, url: file.url + '#' + h.id }));
      }
    }
    if (!res.length) { wclose(); return; }
    if (!wbox) {
      wbox = el('div', { class: 'lmd-emoji lmd-wikibox', role: 'listbox' });
      wbox.addEventListener('mousedown', (ev) => { ev.preventDefault(); const b = ev.target.closest('button'); if (b) wpick(+b.dataset.i); });
      document.body.appendChild(wbox);
    }
    wfound = f; witems = res; wat = 0;
    wbox.textContent = '';
    res.forEach((e, i) => {
      const b = el('button', { type: 'button', role: 'option' }, '<span>' + e.icon + '</span><em></em><small></small>');
      b.dataset.i = i; b.children[1].textContent = e.text; b.children[2].textContent = e.hint;
      wbox.appendChild(b);
    });
    wpaint();
    const range = document.createRange(); range.setStart(f.node, f.start); range.setEnd(f.node, f.end);
    const r = range.getBoundingClientRect();
    wbox.hidden = false;
    const h = wbox.offsetHeight; const w = wbox.offsetWidth;
    const below = r.bottom + 6 + h <= window.innerHeight;
    wbox.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
    wbox.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  }

  function init(c) {
    core = c;
    document.addEventListener('input', (e) => { if (e.target && e.target.isContentEditable) wupdate(); else wclose(); });
    // En captura: Enter y las flechas tienen que llegar acá antes que al editor, que con Enter abre un bloque nuevo.
    document.addEventListener('keydown', (e) => {
      if (!wbox || wbox.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { wat = (wat + (e.key === 'ArrowDown' ? 1 : witems.length - 1)) % witems.length; wpaint(); }
      else if (e.key === 'Enter' || e.key === 'Tab') wpick(wat);
      else if (e.key === 'Escape') wclose();
      else { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') wclose(); return; }
      e.preventDefault(); e.stopPropagation();
    }, true);
    document.addEventListener('mousedown', (e) => { if (wbox && !wbox.hidden && !wbox.contains(e.target)) wclose(); });
    document.addEventListener('focusout', () => setTimeout(() => { if (wbox && !wbox.hidden && !wquery()) wclose(); }, 0));
    window.addEventListener('scroll', () => { if (wbox && !wbox.hidden) wclose(); }, { passive: true });
  }

  LMD.links = { init, open, dialog, md };
})();
