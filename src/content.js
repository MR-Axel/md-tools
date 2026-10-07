// SharpMD: reemplaza la vista de texto plano de un archivo Markdown por un lector completo.
(function () {
  'use strict';

  // ---------- ¿Es un documento de texto plano? ----------
  // El lector corre en dos lugares: como script de contenido sobre un .md abierto en el navegador,
  // y en la página propia de la extensión (app.html), donde el archivo llega por un permiso de carpeta.
  // La página propia también se puede servir desde un sitio, sin la extensión (ver web.js).
  const APP = /\/app\.html$/.test(location.pathname) && (location.protocol === 'chrome-extension:' || !!window.__MDT_WEB);
  // La página de pago de sharpmd.app puede volver a la app de la extensión (manifest: web_accessible_resources),
  // pero nadie la puede meter dentro de un marco: ahí no arranca.
  if (APP && window.top !== window.self) return;
  let pre = null;
  if (!APP) {
    const type = (document.contentType || '').toLowerCase();
    if (type && !/^text\/(plain|markdown|x-markdown)/.test(type)) return;
    pre = document.body && document.body.querySelector('pre');
    if (!pre || document.body.children.length > 2) return;
  }
  // En la app los archivos no tienen URL real: se les da una virtual para poder resolver rutas relativas.
  const VBASE = 'https://lmd.local/';
  const APP_URL = APP ? location.origin + location.pathname : '';
  const HERE = APP ? VBASE + (new URLSearchParams(location.search).get('f') || '') : location.href.split('#')[0].split('?')[0];
  const DOC_NAME = decodeURIComponent(HERE.split('/').pop() || '');
  const toHref = (url) => {
    if (!APP || !url.startsWith(VBASE)) return url;
    const i = url.indexOf('#');
    return APP_URL + '?f=' + encodeURIComponent((i < 0 ? url : url.slice(0, i)).slice(VBASE.length)) + (i < 0 ? '' : url.slice(i));
  };
  let appRoot = null; // lo abierto en la app: { id, kind: 'dir' | 'file', name, handle }

  let raw = APP ? '' : pre.textContent;
  let settings = null;
  let rawMode = false;
  let refreshTimer = null;
  let spyHeadings = [];
  let searchHits = [];
  let searchIndex = -1;
  const lazyLoaded = {};
  const isFile = location.protocol === 'file:';

  const T = (text, vars) => LMD.t(text, vars);
  const { ICON, el, esc, debounce, MD_RE, SKIP_DIRS } = LMD.kit;
  const { slugify, splitFrontmatter, ALERTS } = LMD.md;
  const { inlineMd, roundTrips } = LMD.serialize;
  const { handlesAll, handlesPut, canWrite, walk } = LMD.store;
  // El parser se arma una vez y se reutiliza mientras no cambien los plugins ni el idioma.
  let parser = null; let parserKey = '';
  const buildParser = () => {
    const key = JSON.stringify(settings.plugins) + LMD.lang();
    if (key !== parserKey) { parserKey = key; parser = LMD.md.buildParser(settings.plugins); }
    return parser;
  };
  const isDark = () => LMD.theme.isDark(settings);
  const applyAccent = (root, dark) => LMD.theme.applyAccent(root, dark, settings);
  const homeCtx = () => ({ settings, APP_URL });
  // Si la extensión se recargó o se actualizó, esta pestaña queda desconectada de ella: no puede
  // releer el archivo ni la carpeta. Se detecta y se avisa, en vez de fallar en silencio.
  let orphan = false;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  function markOrphan() {
    if (orphan) return;
    orphan = true;
    clearInterval(refreshTimer);
    const bar = el('div', { class: 'lmd-orphan', role: 'alert' });
    bar.appendChild(el('span', { text: 'SharpMD se actualizó. Recargá esta pestaña para seguir. · SharpMD was updated. Reload this tab to continue.' }));
    const b = el('button', { type: 'button', text: 'Recargar · Reload' });
    b.addEventListener('click', () => location.reload());
    bar.appendChild(b);
    document.body.appendChild(bar);
  }
  const bg = (msg) => new Promise((resolve) => {
    if (!alive()) { markOrphan(); resolve({ ok: false, error: 'orphan' }); return; }
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err && /context invalidated|receiving end does not exist/i.test(err.message || '') && !alive()) markOrphan();
        resolve(err ? { ok: false, error: err.message } : r);
      });
    } catch (e) { if (!alive()) markOrphan(); resolve({ ok: false, error: String(e) }); }
  });
  // ---------- Archivos de la app ----------
  const vParts = (url) => url.slice(VBASE.length).split('#')[0].split('/').filter(Boolean).map(decodeURIComponent).slice(1);
  async function vFile(url) {
    const parts = vParts(url);
    if (!appRoot || !parts.length) return null;
    if (appRoot.kind === 'local') return parts.length === 1 ? LMD.store.noteHandle(parts[0]) : null;
    if (appRoot.kind === 'cloud') return LMD.cloud.handle(parts.join('/'));
    if (appRoot.kind === 'pub') return { kind: 'file', name: appRoot.title, getFile: async () => ({ text: async () => appRoot.text, lastModified: 0, size: appRoot.text.length }) };
    if (appRoot.kind === 'file') return parts.length === 1 && parts[0] === appRoot.handle.name ? appRoot.handle : null;
    let cur = appRoot.handle;
    for (let k = 0; k < parts.length - 1; k++) cur = await cur.getDirectoryHandle(parts[k]);
    return cur.getFileHandle(parts[parts.length - 1]);
  }
  async function vText(url) {
    try { const h = await vFile(url); return h ? await (await h.getFile()).text() : null; } catch (e) { return null; }
  }
  async function vList(dirUrl) {
    try {
      if (appRoot.kind === 'pub') return [];
      if (appRoot.kind === 'cloud') {
        // La nube guarda rutas completas: las carpetas se deducen de ellas.
        const parts = vParts(dirUrl); const other = parts.length && parts[0][0] === '~' ? parts.shift().slice(1) : '';
        const prefix = parts.map((p) => p + '/').join(''); const rows = []; const seen = new Set();
        (await LMD.cloud.list(false, other)).forEach((n) => {
          if (!n.path.startsWith(prefix)) return;
          const rest = n.path.slice(prefix.length); const cut = rest.indexOf('/');
          const name = cut < 0 ? rest : rest.slice(0, cut);
          if (seen.has(name)) return; seen.add(name);
          rows.push({ name, url: dirUrl + encodeURIComponent(name) + (cut < 0 ? '' : '/'), dir: cut >= 0 });
        });
        return rows;
      }
      if (appRoot.kind === 'local') return (await LMD.store.notesAll()).map((n) => ({ name: n.name, url: dirUrl + encodeURIComponent(n.name), dir: false }));
      if (appRoot.kind === 'file') return [{ name: appRoot.handle.name, url: dirUrl + encodeURIComponent(appRoot.handle.name), dir: false }];
      let dir = appRoot.handle;
      for (const p of vParts(dirUrl)) dir = await dir.getDirectoryHandle(p);
      const rows = [];
      for await (const [name, h] of dir.entries()) rows.push({ name, url: dirUrl + encodeURIComponent(name) + (h.kind === 'directory' ? '/' : ''), dir: h.kind === 'directory' });
      return rows;
    } catch (e) { return null; }
  }
  // En la página de la extensión no se puede inyectar con chrome.scripting: las librerías pesadas se cargan con <script>.
  const LAZY_APP = {
    katex: { js: ['vendor/katex/katex.min.js'], css: 'vendor/katex/katex.min.css' },
    mermaid: { js: ['vendor/mermaid.min.js'] },
    graphviz: { js: ['vendor/viz-global.js'] },
  };
  async function appLazy(what) {
    const spec = LAZY_APP[what];
    try {
      if (spec.css) {
        const css = await (await fetch(chrome.runtime.getURL(spec.css))).text();
        document.head.appendChild(el('style', { text: css.split('__LMD_BASE__').join(chrome.runtime.getURL('')) }));
      }
      for (const src of spec.js) {
        await new Promise((resolve, reject) => {
          const s = el('script', { src: chrome.runtime.getURL(src) });
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      return true;
    } catch (e) { return false; }
  }

  // ---------- Markdown ----------

  function postProcess(article) {
    const p = settings.plugins;

    // Títulos: id y ancla
    const used = new Set();
    const headings = Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    headings.forEach((h) => {
      h.id = slugify(h.textContent, used);
      if (p.anchors && !editMode) {
        const a = el('a', { class: 'lmd-anchor', href: '#' + h.id, 'aria-label': 'Enlace a esta sección', text: '#' });
        h.appendChild(a);
      }
    });

    // Índice en el texto
    if (p.toc) {
      article.querySelectorAll('p').forEach((par) => {
        if (/^\s*(\[\[toc\]\]|\[toc\])\s*$/i.test(par.textContent)) {
          const nav = el('nav', { class: 'lmd-toc' });
          headings.forEach((h) => {
            const a = el('a', { href: '#' + h.id, class: 'lmd-toc-l' + h.tagName[1], text: headingText(h) });
            nav.appendChild(a);
          });
          par.replaceWith(nav);
        }
      });
    }

    // Listas de tareas
    if (p.tasklists) {
      article.querySelectorAll('li').forEach((li) => {
        let target = li.firstChild;
        if (target && target.nodeType === 1 && target.tagName === 'P') target = target.firstChild;
        if (!target || target.nodeType !== 3) return;
        const m = /^\[([ xX])\]\s+/.exec(target.nodeValue);
        if (!m) return;
        target.nodeValue = target.nodeValue.slice(m[0].length);
        const box = el('input', { type: 'checkbox', class: 'lmd-task' });
        if (m[1] !== ' ') box.setAttribute('checked', '');
        target.parentNode.insertBefore(box, target);
        li.classList.add('lmd-task-item');
        if (li.parentNode) li.parentNode.classList.add('lmd-task-list');
      });
    }

    // Alertas estilo GitHub
    if (p.alerts) {
      article.querySelectorAll('blockquote').forEach((bq) => {
        const first = bq.querySelector('p');
        if (!first || !first.firstChild || first.firstChild.nodeType !== 3) return;
        const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.firstChild.nodeValue);
        if (!m) return;
        const kind = m[1].toUpperCase();
        first.firstChild.nodeValue = first.firstChild.nodeValue.slice(m[0].length);
        if (first.firstChild.nodeValue === '' && first.childNodes[1] && first.childNodes[1].tagName === 'BR') first.childNodes[1].remove();
        if (!first.textContent.trim() && !first.children.length) first.remove();
        bq.classList.add('lmd-alert', 'lmd-alert-' + kind.toLowerCase());
        bq.insertBefore(el('p', { class: 'lmd-alert-title', text: T(ALERTS[kind]) }), bq.firstChild);
      });
    }

    // Tablas con scroll propio
    article.querySelectorAll('table').forEach((t) => {
      const wrap = el('div', { class: 'lmd-table' });
      t.replaceWith(wrap); wrap.appendChild(t);
    });

    // Bloques de código: etiqueta de lenguaje y botón de copiar
    article.querySelectorAll('pre > code').forEach((code) => {
      const preEl = code.parentNode;
      const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1];
      code.classList.add('hljs');
      const wrap = el('div', { class: 'lmd-code' });
      preEl.replaceWith(wrap); wrap.appendChild(preEl);
      if (lang) wrap.appendChild(el('span', { class: 'lmd-code-lang', text: lang }));
      if (p.copyCode) {
        const btn = el('button', { class: 'lmd-code-copy', type: 'button', title: T('Copiar') }, ICON.copy);
        btn.addEventListener('click', () => copyText(code.textContent, btn));
        wrap.appendChild(btn);
      }
    });

    // Links externos en pestaña nueva
    article.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^https?:/i.test(href) && a.host !== location.host) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });

    if (APP) {
      // Rutas relativas: los links pasan por la app y las imágenes se leen de la carpeta abierta.
      const relative = (v) => v && !/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(v);
      article.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!relative(href) || a.classList.contains('lmd-wiki')) return;
        try { a.setAttribute('data-lmd-href', href); a.href = toHref(new URL(href, HERE).href); } catch (e) { /* queda como está */ }
      });
      article.querySelectorAll('img[src]').forEach(async (img) => {
        const src = img.getAttribute('src');
        if (!relative(src)) return;
        img.setAttribute('data-lmd-src', src);
        try { const h = await vFile(new URL(src, HERE).href); if (h) img.src = URL.createObjectURL(await h.getFile()); } catch (e) { /* no está en la carpeta */ }
      });
    }

    LMD.board.calcTables(article);

    // ![texto|480](ruta): el número después de la barra es el ancho en píxeles.
    article.querySelectorAll('img[alt]').forEach((img) => {
      const m = /^(.*)\|(\d{2,4})$/.exec(img.getAttribute('alt'));
      if (!m) return;
      img.setAttribute('alt', m[1]); img.setAttribute('width', m[2]); img.dataset.lmdW = m[2];
    });

    if (p.imageViewer) article.querySelectorAll('img').forEach((img) => img.classList.add('lmd-zoomable'));

    renderMath(article);
    renderMermaid(article);
    renderGraphviz(article);
    resolveWiki(article);
    return headings;
  }

  function headingText(h) {
    const c = h.cloneNode(true);
    c.querySelectorAll('.lmd-anchor').forEach((a) => a.remove());
    return c.textContent.trim();
  }

  async function ensure(what) {
    if (lazyLoaded[what]) return lazyLoaded[what];
    lazyLoaded[what] = APP ? appLazy(what) : bg({ type: 'lazyLoad', what }).then((r) => !!(r && r.ok));
    return lazyLoaded[what];
  }

  async function renderMath(article) {
    const nodes = article.querySelectorAll('.lmd-math');
    if (!nodes.length) return;
    if (!(await ensure('katex')) || !window.katex) return;
    nodes.forEach((n) => {
      try {
        katex.render(n.getAttribute('data-tex'), n, { displayMode: n.classList.contains('lmd-math-block'), throwOnError: false });
      } catch (e) { n.textContent = n.getAttribute('data-tex'); }
    });
  }

  let mermaidSeq = 0;
  async function renderMermaid(article) {
    const nodes = Array.from(article.querySelectorAll('pre.lmd-mermaid'));
    if (!nodes.length) return;
    if (!(await ensure('mermaid')) || !window.mermaid) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default', flowchart: { curve: settings.diagramShape === 'square' ? 'linear' : 'basis' } });
    for (const n of nodes) {
      const code = n.textContent;
      try {
        const out = await mermaid.render('lmd-mermaid-' + (++mermaidSeq), code);
        const box = el('div', { class: 'lmd-diagram' });
        box.innerHTML = out.svg;
        box.dataset.code = code; box.dataset.kind = 'mermaid';
        if (n.hasAttribute('data-l')) box.setAttribute('data-l', n.getAttribute('data-l'));
        n.replaceWith(box);
      } catch (e) {
        n.classList.add('lmd-mermaid-error');
        n.title = String(e && e.message || e);
        document.querySelectorAll('body > [id^="dlmd-mermaid-"]').forEach((x) => x.remove());
      }
    }
  }

  // [[nombre]] apunta al Markdown de la carpeta cuyo nombre coincide, sin distinguir guiones, guiones bajos ni mayúsculas.
  const wikiKey = (s) => s.toLowerCase().replace(/\.(md|mdx|mkd|mdown|markdown)$/i, '').replace(/[\s_-]+/g, '');
  let wikiIndex = null;
  async function resolveWiki(article) {
    const links = Array.from(article.querySelectorAll('a.lmd-wiki'));
    if (!links.length) return;
    const dir = new URL('.', HERE).href;
    if (!wikiIndex || wikiIndex.dir !== dir) {
      const files = await collectFiles(dir);
      const map = new Map();
      (files || []).forEach((f) => { const k = wikiKey(f.rel.split('/').pop()); if (!map.has(k)) map.set(k, f.url); });
      wikiIndex = { dir, map };
    }
    links.forEach((a) => {
      const parts = a.getAttribute('data-wiki').split('#');
      const url = wikiIndex.map.get(wikiKey(parts[0].split('/').pop()));
      if (url) { a.href = toHref(url + (parts[1] ? '#' + slugify(parts[1], new Set()) : '')); a.title = decodeURIComponent(url.split('/').pop()); }
      else { a.classList.add('lmd-wiki-missing'); a.title = T('No hay un archivo con ese nombre en la carpeta'); }
    });
  }

  let vizInstance = null;
  async function renderGraphviz(article) {
    const nodes = Array.from(article.querySelectorAll('pre.lmd-graphviz'));
    if (!nodes.length) return;
    if (!(await ensure('graphviz')) || !window.Viz) return;
    try { vizInstance = vizInstance || await Viz.instance(); } catch (e) { return; }
    for (const n of nodes) {
      try {
        const svg = vizInstance.renderSVGElement(n.textContent);
        const box = el('div', { class: 'lmd-diagram lmd-diagram-dot' });
        box.dataset.code = n.textContent; box.dataset.kind = 'dot';
        if (n.hasAttribute('data-l')) box.setAttribute('data-l', n.getAttribute('data-l'));
        box.appendChild(svg);
        n.replaceWith(box);
      } catch (e) {
        n.classList.add('lmd-mermaid-error');
        n.title = String(e && e.message || e);
      }
    }
  }

  function frontmatterNode(rows) {
    const box = el('dl', { class: 'lmd-front' });
    rows.forEach(([k, v]) => {
      box.appendChild(el('dt', { text: k }));
      box.appendChild(el('dd', { text: v.replace(/^(["'])(.*)\1$/, '$2') }));
    });
    return box;
  }

  // Copia con formato: lo seleccionado dentro del documento o, si no hay selección, el documento entero.
  function copyRich(btn) {
    const sel = window.getSelection();
    const box = el('div');
    if (sel && !sel.isCollapsed && ui.article.contains(sel.anchorNode)) box.appendChild(sel.getRangeAt(0).cloneContents());
    else box.innerHTML = ui.article.innerHTML;
    box.querySelectorAll('.lmd-anchor, .lmd-code-copy, .lmd-code-lang, .lmd-front').forEach((n) => n.remove());
    box.querySelectorAll('table').forEach((t) => { t.setAttribute('style', 'border-collapse:collapse'); });
    box.querySelectorAll('th, td').forEach((c) => c.setAttribute('style', 'border:1px solid #c9c9c9;padding:6px 10px;vertical-align:top'));
    box.querySelectorAll('pre').forEach((p) => p.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:10px;white-space:pre-wrap'));
    box.querySelectorAll('code').forEach((c) => { if (!c.closest('pre')) c.setAttribute('style', 'font-family:Consolas,monospace;background:#f3f3f3;padding:1px 4px'); });
    box.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'));
    const html = box.innerHTML;
    document.body.appendChild(box); box.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
    const plain = box.innerText;
    box.remove();
    const done = () => {
      flash(T('Copiado con formato'));
      if (!btn) return;
      const old = btn.innerHTML; btn.innerHTML = ICON.check; btn.classList.add('lmd-ok');
      setTimeout(() => { btn.innerHTML = old; btn.classList.remove('lmd-ok'); }, 1400);
    };
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]).then(done, () => copyText(plain, btn));
    } catch (e) { copyText(plain, btn); }
  }

  const countWords = (t) => (t.trim().match(/\S+/g) || []).length;
  const fmt = (n) => n.toLocaleString(LMD.lang() === 'en' ? 'en-US' : 'es-AR');
  function updateCount() {
    const sel = window.getSelection();
    const scope = rawMode ? ui.rawPre : ui.article;
    if (sel && !sel.isCollapsed && scope.contains(sel.anchorNode)) {
      const t = sel.toString();
      const w = countWords(t);
      ui.count.textContent = T(w === 1 ? 'Selección: {w} palabra · {c} caracteres' : 'Selección: {w} palabras · {c} caracteres', { w: fmt(w), c: fmt(t.length) });
      ui.count.classList.add('lmd-count-sel');
    } else {
      const t = scope.innerText || '';
      ui.count.textContent = T('{w} palabras', { w: fmt(countWords(t)) });
      ui.count.classList.remove('lmd-count-sel');
    }
  }

  // Posición de lectura por archivo
  const posKey = () => (APP ? HERE : location.href.split('#')[0]);
  const savePosition = debounce(() => {
    if (!settings.rememberPosition) return;
    chrome.storage.local.get('positions', (r) => {
      const all = (r && r.positions) || {};
      all[posKey()] = { y: Math.round(window.scrollY), t: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > 300) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - 300).forEach((k) => delete all[k]);
      chrome.storage.local.set({ positions: all });
    });
  }, 400);
  function restorePosition() {
    if (!settings.rememberPosition) return;
    chrome.storage.local.get('positions', (r) => {
      const p = r && r.positions && r.positions[posKey()];
      if (p && p.y > 0) window.scrollTo(0, p.y);
    });
  }

  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      const old = btn.innerHTML; btn.innerHTML = ICON.check; btn.classList.add('lmd-ok');
      setTimeout(() => { btn.innerHTML = old; btn.classList.remove('lmd-ok'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* sin portapapeles */ }
    ta.remove();
  }

  // ---------- Interfaz ----------
  const ui = {};

  function buildUI() {
    document.documentElement.classList.add('lmd-root');
    document.body.textContent = '';
    document.body.classList.add('lmd-body');
    if (!document.querySelector('meta[name=viewport]')) {
      document.head.appendChild(el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }));
    }
    ui.customStyle = el('style', { id: 'lmd-custom-css' });
    // Ícono de la pestaña: el de SharpMD, para que no quede el genérico ni el de otra extensión.
    document.querySelectorAll('link[rel~="icon"]').forEach((n) => n.remove());
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a1d23"/>' +
      '<g stroke="#bef264" stroke-width="5.5" stroke-linecap="round"><path d="M27 16 22 48M41 16 36 48M13 27h30M11 38h30"/></g>' +
      '<rect x="48" y="15" width="6" height="34" rx="3" fill="#e8eaee"/></svg>';
    document.head.appendChild(el('link', { rel: 'icon', type: 'image/svg+xml', href: 'data:image/svg+xml,' + encodeURIComponent(svg) }));
    document.head.appendChild(ui.customStyle);

    ui.sidebar = el('aside', { class: 'lmd-sidebar' });
    ui.sidebar.innerHTML =
      '<div class="lmd-side-head">' +
        '<div class="lmd-tabs" role="tablist">' +
          '<button class="lmd-tab" data-tab="files" role="tab">' + ICON.folder + '<span>' + T('Archivos') + '</span></button>' +
          '<button class="lmd-tab" data-tab="outline" role="tab">' + ICON.outline + '<span>' + T('Índice') + '</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="lmd-search">' +
        '<span class="lmd-search-ico">' + ICON.search + '</span>' +
        '<input type="search" spellcheck="false">' +
        '<span class="lmd-search-count"></span>' +
      '</div>' +
      '<div class="lmd-pane lmd-pane-files" data-pane="files"><div class="lmd-tree-box"></div><div class="lmd-results" hidden></div></div>' +
      '<div class="lmd-pane lmd-pane-outline" data-pane="outline"></div>' +
      '<div class="lmd-update" hidden></div>' +
      '<div class="lmd-resizer" title="' + T('Arrastrar para cambiar el ancho') + '"></div>';

    ui.main = el('main', { class: 'lmd-main' });
    ui.main.innerHTML =
      '<div class="lmd-topbar">' +
        '<div class="lmd-top-left">' +
          '<button class="lmd-icon-btn" data-act="sidebar" title="' + T('Barra lateral (Alt+Shift+B)') + '">' + ICON.side + '</button>' +
          '<span class="lmd-docname"></span>' +
          '<button class="lmd-icon-btn lmd-sync" data-act="sync" hidden></button>' +
        '</div>' +
        // Al centro, lo que cambia el modo de trabajo: ver o editar, insertar y guardar.
        '<div class="lmd-top-mid">' +
          '<div class="lmd-modeseg" role="radiogroup" aria-label="' + T('Modo') + '">' +
            '<button type="button" role="radio" data-act="mode-read" aria-checked="true" class="lmd-on" aria-label="' + T('Ver') + '">' + ICON.eye + '</button>' +
            '<button type="button" role="radio" data-act="mode-edit" aria-checked="false" aria-label="' + T('Editar') + '">' + ICON.pencil + '</button>' +
          '</div>' +
          '<button class="lmd-icon-btn lmd-insert" data-act="insert" title="' + T('Insertar un bloque (también con clic derecho)') + '">' + ICON.plus + '</button>' +
          '<button class="lmd-icon-btn lmd-save" data-act="save" title="' + T('Guardar (Ctrl+S)') + '" hidden>' + ICON.save + '</button>' +
        '</div>' +
        '<div class="lsharpmd">' +
          '<div class="lmd-view" role="radiogroup" aria-label="' + T('Vista') + '">' +
            '<button type="button" role="radio" data-act="view-doc" class="lmd-on" aria-checked="true" title="' + T('Ver documento') + '">' + ICON.doc + '</button>' +
            '<button type="button" role="radio" data-act="view-raw" aria-checked="false" title="' + T('Ver código fuente') + '">' + ICON.code + '</button>' +
          '</div>' +
          '<span class="lmd-sep"></span>' +
          '<button class="lmd-icon-btn" data-act="copy-md" title="' + T('Copiar Markdown') + '">' + ICON.copy + '</button>' +
          '<button class="lmd-icon-btn" data-act="copy-rich" title="' + T('Copiar con formato (la selección, o todo el documento)') + '">' + ICON.rich + '</button>' +
          '<button class="lmd-icon-btn" data-act="reload" title="' + T('Recargar ahora') + '">' + ICON.reload + '</button>' +
          '<button class="lmd-icon-btn" data-act="print" title="' + T('Imprimir o guardar PDF') + '">' + ICON.print + '</button>' +
          '<button class="lmd-icon-btn" data-act="export-html" title="' + T('Exportar a HTML') + '">' + ICON.download + '</button>' +
          '<span class="lmd-sep"></span>' +
          '<button class="lmd-icon-btn" data-act="settings" title="' + T('Ajustes') + '">' + ICON.sliders + '</button>' +
        '</div>' +
      '</div>' +
      '<article class="lmd-article markdown-body"></article>' +
      '<pre class="lmd-raw" hidden></pre>' +
      '<textarea class="lmd-raw lmd-raw-edit" spellcheck="false" hidden></textarea>' +
      // Pie: avisos a la izquierda; estado del guardado y contador a la derecha.
      '<footer class="lmd-foot"><span class="lmd-status"></span><span class="lmd-savestate"></span><span class="lmd-count" title="' + T('Palabras y caracteres') + '"></span></footer>';

    ui.toTop = el('button', { class: 'lmd-to-top', title: T('Volver arriba'), hidden: '' }, ICON.up);
    ui.panel = el('div', { class: 'lmd-panel', hidden: '' });
    ui.viewer = el('div', { class: 'lmd-viewer', hidden: '' });
    ui.format = el('div', { class: 'lmd-format', hidden: '' },
      '<button type="button" data-fmt="bold" title="' + T('Negrita (Ctrl+B)') + '"><b>B</b></button>' +
      '<button type="button" data-fmt="italic" title="' + T('Cursiva (Ctrl+I)') + '"><i>I</i></button>' +
      '<button type="button" data-fmt="strike" title="' + T('Tachado') + '"><s>S</s></button>' +
      '<button type="button" data-fmt="code" title="' + T('Código') + '">' + ICON.code + '</button>' +
      '<button type="button" data-fmt="link" title="' + T('Enlace') + '">' + ICON.link + '</button>' +
      '<button type="button" data-fmt="clear" title="' + T('Quitar formato') + '">' + ICON.close + '</button>');
    ui.tableBar = el('div', { class: 'lmd-tablebar', hidden: '' },
      '<button type="button" data-top="row+">+ ' + T('Fila') + '</button>' +
      '<button type="button" data-top="col+">+ ' + T('Columna') + '</button>' +
      '<button type="button" data-top="row-">− ' + T('Fila') + '</button>' +
      '<button type="button" data-top="col-">− ' + T('Columna') + '</button>' +
      '<button type="button" data-top="total" title="' + T('Agregar una fila que suma cada columna') + '">Σ ' + T('Totales') + '</button>');

    document.body.append(ui.sidebar, ui.main, ui.toTop, ui.panel, ui.viewer, ui.format, ui.tableBar);

    ui.article = ui.main.querySelector('.lmd-article');
    ui.rawPre = ui.main.querySelector('pre.lmd-raw');
    ui.rawEdit = ui.main.querySelector('.lmd-raw-edit');
    ui.status = ui.main.querySelector('.lmd-status');
    ui.count = ui.main.querySelector('.lmd-count');
    ui.treeBox = ui.sidebar.querySelector('.lmd-tree-box');
    ui.results = ui.sidebar.querySelector('.lmd-results');
    ui.paneFiles = ui.sidebar.querySelector('.lmd-pane-files');
    ui.paneOutline = ui.sidebar.querySelector('.lmd-pane-outline');
    ui.searchBox = ui.sidebar.querySelector('.lmd-search');
    ui.update = ui.sidebar.querySelector('.lmd-update');
    ui.searchInput = ui.searchBox.querySelector('input');
    ui.searchCount = ui.searchBox.querySelector('.lmd-search-count');

    document.title = DOC_NAME || 'Markdown';
    ui.main.querySelector('.lmd-docname').textContent = (appRoot && appRoot.title) || DOC_NAME;
    if (appRoot && appRoot.title) document.title = appRoot.title;
    document.documentElement.classList.toggle('lmd-readonly', readOnly);
    bindEvents();
    bindEditing();
    LMD.write.init(core);
    LMD.diagram.init(core);
    LMD.extras.init(core);
    LMD.board.init(core);
    ui.sync = ui.main.querySelector('.lmd-sync');
    LMD.sync.init(core);
    document.documentElement.dataset.lmdFs = String(!!window.showOpenFilePicker && window.isSecureContext);
  }

  function bindEvents() {
    document.body.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (actEl) { onAction(actEl.dataset.act, actEl); return; }
      const tab = e.target.closest('.lmd-tab');
      if (tab) { LMD.patch({ sidebarTab: tab.dataset.tab }); return; }
      const img = e.target.closest('img.lmd-zoomable');
      if (img && !img.closest('a') && !editMode) { openViewer(img); return; }
      const res = e.target.closest('.lmd-results a');
      if (res && res.href.split('#')[0] === location.href.split('#')[0]) { e.preventDefault(); stepSearch(1); return; }
      const a = e.target.closest('.lmd-article a[href^="#"], .lmd-pane-outline a');
      if (a) {
        const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
        if (target) { e.preventDefault(); spyPin = a.closest('.lmd-pane-outline') ? target.id : null; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', '#' + target.id); }
      }
    });

    ui.toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    ui.viewer.addEventListener('click', () => { ui.viewer.hidden = true; ui.viewer.textContent = ''; });

    // El índice se recalcula a lo sumo una vez por cuadro, no en cada evento de scroll.
    let scrollQueued = false;
    window.addEventListener('scroll', () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => { scrollQueued = false; onScroll(); });
    }, { passive: true });
    window.addEventListener('scroll', savePosition, { passive: true });
    document.addEventListener('selectionchange', debounce(updateCount, 80));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!ui.viewer.hidden) ui.viewer.click();
        else if (!ui.panel.hidden) ui.panel.hidden = true;
        else if (ui.searchInput.value || document.activeElement === ui.searchInput) toggleSearch(false);
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's' && (editMode || dirty || (appRoot && appRoot.kind === 'local'))) { e.preventDefault(); save(true); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleSearch(true); }
    });

    ui.searchInput.addEventListener('input', debounce(() => runSearch(ui.searchInput.value), 180));
    ui.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
    });

    // Ancho de la barra lateral
    const resizer = ui.sidebar.querySelector('.lmd-resizer');
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('lmd-resizing');
      const move = (ev) => {
        const w = Math.min(560, Math.max(200, ev.clientX));
        document.documentElement.style.setProperty('--lmd-side-w', w + 'px');
        settings.sidebarWidth = w;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('lmd-resizing');
        LMD.patch({ sidebarWidth: settings.sidebarWidth });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'auto') { applySettings(); render(); }
    });
  }

  function onAction(act, source) {
    if (act === 'sidebar') LMD.patch({ sidebarHidden: !settings.sidebarHidden });
    else if (act === 'mode-read') { if (editMode) setEditMode(false); }
    else if (act === 'mode-edit') { if (!editMode) setEditMode(true); }
    else if (act === 'save') save(true);
    else if (act === 'sync') LMD.sync.click(source);
    else if (act === 'insert') { const box = source.getBoundingClientRect(); LMD.write.menuAt(box.left - 120, box.bottom + 8); }
    else if (act === 'view-doc') { rawMode = false; applyRawMode(); }
    else if (act === 'view-raw') { rawMode = true; applyRawMode(); }
    else if (act === 'settings') openPanel();
    else if (act === 'copy-md') copyText(raw, source);
    else if (act === 'copy-rich') copyRich(source);
    else if (act === 'reload') { if (orphan || !alive()) location.reload(); else checkForChanges(true); }
    else if (act === 'print') window.print();
    else if (act === 'export-html') LMD.extras.exportHtml();
    else if (act === 'close-panel') ui.panel.hidden = true;
    else if (act === 'reset') { panelStale = true; LMD.save(LMD.merge({ supporter: settings.supporter })); }
    else if (act === 'check-update') checkUpdate(true);
    else if (act === 'update-apply') {
      // Primero se guarda lo pendiente; el fondo se ocupa de reabrir o recargar las pestañas.
      (dirty ? save(true) : Promise.resolve(true)).then((ok) => { if (ok || !dirty) bg({ type: 'reloadExtension' }); });
    }
    else if (act === 'update-later') { ui.update.hidden = true; if (ui.update.dataset.v) bg({ type: 'dismissUpdate', version: ui.update.dataset.v }); }
    else if (act === 'go-home') { if (APP) location.href = APP_URL; else bg({ type: 'openApp' }); }
    else if (act === 'see-plans') openPanel('plan');
    else if (act === 'feedback') LMD.sync.feedback();
  }

  // Aviso de versión nueva. El service worker decide si toca consultar GitHub según el ajuste.
  const ZIP_URL = 'https://github.com/MR-Axel/sharpmd/archive/refs/heads/main.zip';
  async function checkUpdate(force) {
    const say = (html, kind) => {
      const box = ui.panel.hidden ? null : ui.panel.querySelector('.lmd-update-msg');
      if (!box) { flash(html.replace(/<[^>]+>/g, ''), kind); return; }
      box.hidden = false; box.className = 'lmd-update-msg' + (kind ? ' lmd-' + kind : ''); box.innerHTML = html;
    };
    if (force) say(esc(T('Buscando…')));
    const r = await bg({ type: 'checkUpdate', force: !!force });
    if (!r || !r.ok || r.store) return;
    const show = r.newer && (force || !r.dismissed);
    ui.update.hidden = !show;
    if (show) {
      ui.update.dataset.v = r.latest;
      ui.update.innerHTML =
        '<strong>' + T('Hay una versión nueva: {v}', { v: esc(r.latest) }) + '</strong>' +
        '<p>' + T('Tenés la {v}.', { v: esc(r.current) }) + ' ' + T('Descargá el ZIP, reemplazá con su contenido la carpeta de la extensión y tocá Aplicar. Si la clonaste con git, alcanza con git pull y Aplicar.') + '</p>' +
        '<div class="lmd-update-actions">' +
          '<a class="lmd-btn lmd-btn-fill" href="' + ZIP_URL + '" target="_blank" rel="noopener noreferrer">' + T('Descargar') + '</a>' +
          '<button type="button" class="lmd-btn" data-act="update-apply">' + T('Aplicar') + '</button>' +
          '<button type="button" class="lmd-link" data-act="update-later">' + T('Ahora no') + '</button>' +
        '</div>';
    }
    if (force) {
      if (r.error) say(esc(T('No se pudo consultar GitHub')), 'error');
      else if (r.newer) say('<strong>' + T('Hay una versión nueva: {v}', { v: esc(r.latest) }) + '</strong> <a href="' + ZIP_URL + '" target="_blank" rel="noopener noreferrer">' + T('Descargar') + '</a> · <button type="button" class="lmd-link" data-act="update-apply">' + T('Aplicar') + '</button>', 'new');
      else say('✓ ' + esc(T('Ya tenés la última versión ({v})', { v: r.current })), 'ok');
    }
  }

  function applyRawMode() {
    const editingSource = rawMode && editMode;
    if (!rawMode && needsRender) render();
    ui.article.hidden = rawMode;
    ui.rawPre.hidden = !rawMode || editingSource;
    ui.rawEdit.hidden = !editingSource;
    if (rawMode) { ui.rawPre.textContent = raw; ui.rawEdit.value = raw; }
    ui.main.querySelectorAll('.lmd-view [data-act^="view-"]').forEach((b) => {
      const on = (b.dataset.act === 'view-raw') === rawMode;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on));
    });
    if (!ui.searchBox.hidden && ui.searchInput.value) runSearch(ui.searchInput.value);
    updateCount();
  }

  let lastTab = null;
  function applySettings() {
    const root = document.documentElement;
    const dark = isDark();
    root.classList.toggle('lmd-dark', dark);
    root.classList.toggle('lmd-light', !dark);
    root.classList.toggle('lmd-centered', !!settings.centered);
    root.classList.toggle('lmd-wrap', !!settings.wrapCode);
    root.classList.toggle('lmd-focus', !!settings.focusMode);
    root.classList.toggle('lmd-typewriter', !!settings.typewriter);
    root.classList.toggle('lmd-tab-outline', settings.sidebarTab === 'outline');
    root.classList.toggle('lmd-side-hidden', !!settings.sidebarHidden);
    root.style.setProperty('--lmd-content-w', settings.contentWidth + 'px');
    root.style.setProperty('--lmd-font-size', settings.fontSize + 'px');
    root.style.setProperty('--lmd-line-height', String(settings.lineHeight));
    root.style.setProperty('--lmd-side-w', settings.sidebarWidth + 'px');
    if (settings.supporter && settings.fontFamily && settings.fontFamily.trim()) root.style.setProperty('--lmd-font', settings.fontFamily);
    else root.style.removeProperty('--lmd-font');
    applyAccent(root, dark);
    root.classList.toggle('lmd-dgm-round', settings.diagramShape !== 'square');
    if (/^#[0-9a-f]{6}$/i.test(settings.codeColor || '')) root.style.setProperty('--code-tint', settings.codeColor); else root.style.removeProperty('--code-tint');
    ui.customStyle.textContent = settings.supporter ? (settings.customCSS || '') : '';

    ui.sidebar.querySelectorAll('.lmd-tab').forEach((t) => t.classList.toggle('lmd-active', t.dataset.tab === settings.sidebarTab));
    ui.paneFiles.hidden = settings.sidebarTab !== 'files';
    ui.paneOutline.hidden = settings.sidebarTab !== 'outline';
    if (settings.sidebarTab === 'files' && !ui.paneFiles.dataset.loaded) loadTree();
    ui.searchInput.placeholder = settings.sidebarTab === 'files' ? T('Buscar en todos los archivos de la carpeta') : T('Buscar en este documento');
    if (lastTab !== settings.sidebarTab) {
      lastTab = settings.sidebarTab;
      if (!ui.searchBox.hidden && ui.searchInput.value) runSearch(ui.searchInput.value);
      else showResults(false);
    }

    ui.status.textContent = settings.autoRefresh ? T('Recarga automática activa') : '';
    setupRefresh();
  }

  // ---------- Render ----------
  // La página propia también abre lo que no es Markdown: código resaltado, CSV como tabla e imágenes.
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
  const LANGS = { yml: 'yaml', mjs: 'javascript', cjs: 'javascript', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', ps1: 'powershell', htm: 'html', kt: 'kotlin', cs: 'csharp', h: 'c' };
  function docKind() {
    if (!APP || MD_RE.test(DOC_NAME) || /\.txt$/i.test(DOC_NAME) || DOC_NAME.indexOf('.') === -1) return 'md';
    if (IMG_RE.test(DOC_NAME)) return 'image';
    return /\.(csv|tsv)$/i.test(DOC_NAME) ? 'table' : 'code';
  }
  function csvRows(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = /\.tsv$/i.test(DOC_NAME) || first.split('\t').length > first.split(',').length ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function asMarkdown(kind) {
    if (kind === 'image') return '![' + DOC_NAME + '](' + encodeURIComponent(DOC_NAME) + ')';
    if (raw.indexOf('\u0000') !== -1) return '> ' + T('Este tipo de archivo no se puede mostrar.');
    if (kind === 'table') {
      const MAX = 1000;
      const rows = csvRows(raw); if (!rows.length) return '';
      const width = Math.max.apply(null, rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: width }, (_, i) => String(r[i] == null ? '' : r[i]).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()).join(' | ') + ' |';
      return [line(rows[0]), '|' + ' --- |'.repeat(width)].concat(rows.slice(1, MAX + 1).map(line)).join('\n') +
        (rows.length > MAX + 1 ? '\n\n' + T('Se muestran las primeras {n} filas.', { n: MAX }) : '');
    }
    const ext = (/\.([A-Za-z0-9]+)$/.exec(DOC_NAME) || [0, ''])[1].toLowerCase();
    const fence = '`'.repeat(Math.max(3, ((raw.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0)) + 1));
    return fence + (LANGS[ext] || ext) + '\n' + raw.replace(/\s+$/, '') + '\n' + fence;
  }

  function render() {
    const md = buildParser();
    const kind = docKind();
    const fm = kind !== 'md' ? { body: asMarkdown(kind), rows: null } : (settings.plugins.frontmatter ? splitFrontmatter(raw) : { body: raw, rows: null });
    syncSource();
    fmOffset = kind !== 'md' ? 0 : raw.slice(0, raw.length - fm.body.length).split('\n').length - 1;
    needsRender = false;
    let html = md.render(fm.body);
    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    const y = window.scrollY;
    ui.article.innerHTML = html;
    spyHeadings = postProcess(ui.article);
    if (editMode && kind === 'md') enableEditing(ui.article);
    if (fm.rows && fm.rows.length) ui.article.insertBefore(frontmatterNode(fm.rows), ui.article.firstChild);
    buildOutline(spyHeadings);
    if (rawMode) { ui.rawPre.textContent = raw; if (document.activeElement !== ui.rawEdit) ui.rawEdit.value = raw; }
    window.scrollTo(0, y);
    onScroll();
    updateCount();
    if (!ui.searchBox.hidden && ui.searchInput.value) runSearch(ui.searchInput.value);
    core.hooks.render.forEach((fn) => fn());
  }

  // Índice: el título del documento va arriba como cabecera, con datos de lectura y avance;
  // debajo, las secciones como árbol plegable con guías por nivel.
  const collapsed = new Set();

  function buildOutline(headings) {
    ui.paneOutline.textContent = '';
    if (!headings.length) {
      ui.paneOutline.appendChild(el('p', { class: 'lmd-empty', text: T('Este documento no tiene títulos.') }));
      return;
    }
    let items = headings.slice();
    const h1s = items.filter((h) => h.tagName === 'H1');
    const titleH = h1s.length === 1 && items[0] === h1s[0] ? items.shift() : null;

    const words = (ui.article.innerText.trim().match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / 200));
    const head = el('div', { class: 'lmd-o-head' });
    const title = el('a', { class: 'lmd-o-title', href: '#' + (titleH ? titleH.id : ''), text: titleH ? headingText(titleH) : document.title });
    if (titleH) title.dataset.id = titleH.id;
    const meta = el('div', { class: 'lmd-o-meta', text: T(items.length === 1 ? '{w} palabras · {m} min · {n} sección' : '{w} palabras · {m} min · {n} secciones', { w: fmt(words), m: minutes, n: items.length }) });
    const bar = el('div', { class: 'lmd-o-bar', title: T('Avance de lectura') }, '<span></span>');
    ui.progress = bar.firstChild;
    ui.progressLabel = el('span', { class: 'lmd-o-pct', text: '0 %' });
    const row = el('div', { class: 'lmd-o-progress' });
    row.append(bar, ui.progressLabel);
    head.append(title, meta, row);
    ui.paneOutline.appendChild(head);

    if (!items.length) return;
    const min = Math.min.apply(null, items.map((h) => +h.tagName[1]));
    const tree = el('div', { class: 'lmd-o-tree' });
    const stack = [{ level: 0, kids: tree }];
    items.forEach((h, i) => {
      const level = +h.tagName[1] - min + 1;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const next = items[i + 1];
      const hasKids = !!next && (+next.tagName[1] - min + 1) > level;
      const item = el('div', { class: 'lmd-o-item' });
      const line = el('div', { class: 'lmd-o-row lmd-o-l' + Math.min(stack.length, 4) });
      line.dataset.id = h.id;
      if (hasKids) {
        const tog = el('button', { class: 'lmd-o-tog', type: 'button', 'aria-label': 'Plegar o desplegar' }, ICON.chevron);
        tog.addEventListener('click', (e) => {
          e.stopPropagation();
          const shut = item.classList.toggle('lmd-o-shut');
          if (shut) collapsed.add(h.id); else collapsed.delete(h.id);
        });
        line.appendChild(tog);
      } else line.appendChild(el('span', { class: 'lmd-o-dot' }));
      line.appendChild(el('a', { href: '#' + h.id, class: 'lmd-o-link', text: headingText(h), title: headingText(h) }));
      item.appendChild(line);
      const kids = el('div', { class: 'lmd-o-kids' });
      if (hasKids) item.appendChild(kids);
      if (collapsed.has(h.id)) item.classList.add('lmd-o-shut');
      stack[stack.length - 1].kids.appendChild(item);
      stack.push({ level, kids });
    });
    ui.paneOutline.appendChild(tree);
  }

  function onScroll() {
    ui.toTop.hidden = window.scrollY < 500;
    if (ui.progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.round(window.scrollY / max * 100)) : 100;
      ui.progress.style.width = pct + '%';
      ui.progressLabel.textContent = pct + ' %';
    }
    if (!spyHeadings.length) return;
    // La sección activa es la última cuyo título ya pasó la línea de lectura. Esa línea está arriba
    // mientras se lee y baja hacia el final del documento: las últimas secciones nunca llegan al
    // tope de la pantalla, y sin eso quedaría marcada una anterior.
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const avance = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 1;
    const linea = Math.max(96, window.innerHeight * (0.28 + 0.72 * Math.pow(avance, 6)));
    let current = spyHeadings[0];
    for (const h of spyHeadings) {
      if (h.getBoundingClientRect().top <= linea) current = h; else break;
    }
    // Si se eligió un título del índice y está a la vista, ese es el activo: cerca del final la página no
    // llega a subirlo hasta la línea de lectura y quedaba marcado el último.
    if (spyPin) { const p = spyHeadings.find((h) => h.id === spyPin); const t = p ? p.getBoundingClientRect().top : -1; if (p && t >= -8 && t < window.innerHeight) current = p; }
    const rows = ui.paneOutline.querySelectorAll('.lmd-o-row');
    let activeRow = null;
    rows.forEach((r) => {
      const on = r.dataset.id === current.id;
      if (on) activeRow = r;
      if (on && !r.classList.contains('lmd-active') && !ui.paneOutline.hidden && r.offsetParent) r.scrollIntoView({ block: 'nearest' });
      r.classList.toggle('lmd-active', on);
      r.classList.remove('lmd-o-path');
    });
    // Las secciones que contienen a la actual quedan marcadas, también si están plegadas.
    let up = activeRow && activeRow.parentNode.parentNode.closest('.lmd-o-item');
    while (up) { up.firstChild.classList.add('lmd-o-path'); up = up.parentNode.closest('.lmd-o-item'); }
  }

  // ---------- Recarga automática ----------
  function setupRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = null;
    if (!settings.autoRefresh) return;
    refreshTimer = setInterval(() => { if (!document.hidden) checkForChanges(false); }, Math.max(300, settings.refreshInterval | 0));
  }

  let diskStamp = ''; let cloudPoll = 0; let cloudState = 'ok'; let readOnly = false; let present = [];
  let polled = true; // false cuando la nube no se consultó de verdad porque todavía no tocaba

  // La mezcla de tres vías vive en cloud.js: también la usa la cola de lo escrito sin conexión.
  const merge3 = LMD.cloud.merge3;
  async function readCurrent() {
    // La nube se consulta cada diez segundos: alcanza para ver lo que escribió una IA sin martillar el servidor.
    polled = true;
    if (APP && appRoot && appRoot.kind === 'cloud') { if (Date.now() - cloudPoll < (cloudState === 'error' ? 5000 : 10000)) { polled = false; return diskText; } cloudPoll = Date.now(); }
    if (APP) {
      // Con el permiso de la carpeta alcanza con mirar fecha y tamaño: el archivo se lee solo si cambió.
      try {
        const file = await (await vFile(HERE)).getFile();
        const stamp = file.lastModified + ':' + file.size;
        if (stamp === diskStamp) return diskText;
        const text = await file.text();
        diskStamp = stamp;
        return text;
      } catch (e) { return null; }
    }
    const url = location.href.split('#')[0];
    const r = await bg({ type: 'fetchText', url });
    if (r && r.ok) return r.text;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.text();
    } catch (e) { /* sin acceso */ }
    return null;
  }

  let checking = false;
  async function checkForChanges(manual) {
    if (checking) return;
    checking = true;
    try {
      const text = await readCurrent();
      // En una nota de la nube, no poder leer es estar sin conexión; volver a leer es haberla recuperado.
      if (appRoot && appRoot.kind === 'cloud') { const was = cloudState; if (text == null) cloudState = 'error'; else if (polled && cloudState === 'error' && !dirty) cloudState = 'ok'; if (was !== cloudState) updateSaveState(); }
      if (text == null) {
        if (manual) flash(T('No se pudo releer el archivo. Recargá la pestaña con F5'), 'error');
      } else if (text !== diskText) {
        // Con cambios hechos sin conexión, de juntarlos con los del servidor se ocupa save() al subirlos.
        if (appRoot && appRoot.kind === 'cloud' && dirty && cloudState === 'error') { clearTimeout(autosaveTimer); save(false); return; }
        const typing = document.activeElement && document.activeElement.isContentEditable;
        const merged = dirty && appRoot && appRoot.kind === 'cloud' && !typing ? merge3(diskText, raw, text) : null;
        // Con el cursor en un bloque no se redibuja: se reintenta apenas se suelta.
        if (dirty && appRoot && appRoot.kind === 'cloud' && typing) { cloudPoll = 0; return; }
        diskText = text;
        if (merged != null) { raw = merged; syncSource(); markDirty(); render(); flash(T('Se sumaron los cambios de otra persona')); }
        else if (dirty) flash(T('El archivo cambió en el disco. Tus cambios sin guardar se mantienen'), 'warn');
        else { raw = text; render(); flash(T('Documento actualizado')); }
      } else if (manual) flash(T('Sin cambios'));
    } finally { checking = false; }
  }

  let flashTimer = null;
  // Aviso corto en la barra. Los errores van en rojo y duran más.
  function flash(msg, kind) {
    ui.status.textContent = msg;
    ui.status.classList.add('lmd-flash');
    ui.status.classList.toggle('lmd-error', kind === 'error');
    ui.status.classList.toggle('lmd-warn', kind === 'warn');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      ui.status.classList.remove('lmd-flash', 'lmd-error', 'lmd-warn');
      ui.status.textContent = settings.autoRefresh ? T('Recarga automática activa') : '';
    }, kind ? 5000 : 1800);
  }

  // ---------- Árbol de carpetas ----------

  const visibleRows = (rows) => rows
    .filter((x) => settings.filesShowHidden || !x.name.startsWith('.'))
    .filter((x) => x.dir || !settings.filesOnlyMarkdown || MD_RE.test(x.name))
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  async function listDir(dirUrl, all) {
    if (APP) { const found = await vList(dirUrl); return found && (all ? found : visibleRows(found)); }
    const r = await bg({ type: 'fetchText', url: dirUrl });
    if (!r || !r.ok) return null;
    const rows = [];
    const re = /addRow\((.*)\);/g; let m;
    while ((m = re.exec(r.text))) {
      try {
        const a = JSON.parse('[' + m[1] + ']');
        if (a[0] === '..' || a[0] === '.') continue;
        rows.push({ name: a[0], url: new URL(a[1] + (a[2] ? '/' : ''), dirUrl).href, dir: !!a[2] });
      } catch (e) { /* fila ilegible */ }
    }
    if (!rows.length && !/addRow|<title>Index of/i.test(r.text)) {
      // Listado de un servidor web (autoindex): se leen los links
      const doc = new DOMParser().parseFromString(r.text, 'text/html');
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href || /^(\?|#|\/|\.\.|[a-z]+:)/i.test(href)) return;
        rows.push({ name: decodeURIComponent(href.replace(/\/$/, '')), url: new URL(href, dirUrl).href, dir: /\/$/.test(href) });
      });
    }
    return all ? rows : visibleRows(rows);
  }

  let treeRoot = new URL('.', HERE).href;

  async function loadTree() {
    ui.paneFiles.dataset.loaded = '1';
    ui.treeBox.textContent = '';
    const head = el('div', { class: 'lmd-tree-head' });
    const upBtn = el('button', { class: 'lmd-tree-up', title: T('Subir a la carpeta superior'), type: 'button' }, ICON.up);
    const atTop = APP && appRoot && treeRoot === VBASE + appRoot.id + '/';
    const label = el('span', { class: 'lmd-tree-path', text: atTop ? appRoot.name : decodeURIComponent(treeRoot.replace(/\/$/, '').split('/').pop() || treeRoot), title: APP ? (appRoot ? appRoot.name : '') : decodeURIComponent(treeRoot) });
    const openBtn = el('button', { class: 'lmd-tree-up lmd-tree-open', title: T('Abrir otro archivo o carpeta'), type: 'button' }, ICON.open);
    openBtn.addEventListener('click', () => { if (APP) location.href = APP_URL; else bg({ type: 'openApp' }); });
    head.append(upBtn, label, openBtn);
    core.hooks.tree.forEach((fn) => fn(head));
    if (atTop) upBtn.style.display = 'none';
    upBtn.addEventListener('click', () => {
      if (atTop) return;
      const parent = new URL('..', treeRoot).href;
      if (parent !== treeRoot) { treeRoot = parent; loadTree(); if (!ui.searchBox.hidden && ui.searchInput.value) runSearch(ui.searchInput.value); }
    });
    const list = el('div', { class: 'lmd-tree' });
    ui.treeBox.append(head, list);
    await fillDir(list, treeRoot, 0);
  }

  async function fillDir(container, dirUrl, depth) {
    container.textContent = '';
    container.appendChild(el('p', { class: 'lmd-empty', text: T('Leyendo carpeta…') }));
    const rows = await listDir(dirUrl);
    container.textContent = '';
    if (rows == null) {
      const msg = isFile
        ? T('No se pudo leer la carpeta. Activá "Permitir acceso a URL de archivo" en los detalles de la extensión.')
        : T('Este servidor no expone el listado de la carpeta.');
      container.appendChild(el('p', { class: 'lmd-empty', text: msg }));
      return;
    }
    if (!rows.length) { container.appendChild(el('p', { class: 'lmd-empty', text: T('Carpeta sin archivos Markdown.') })); return; }
    const here = HERE;
    rows.forEach((row) => {
      const item = el(row.dir ? 'button' : 'a', { class: 'lmd-node' + (row.dir ? ' lmd-node-dir' : ''), title: row.name });
      item.style.paddingLeft = (10 + depth * 14) + 'px';
      item.dataset.url = row.url;
      const md = MD_RE.test(row.name);
      item.innerHTML = (row.dir ? '<span class="lmd-node-chev">' + ICON.chevron + '</span>' : '<span class="lmd-node-ico">' + (md ? ICON.md : ICON.file) + '</span>') +
        '<span class="lmd-node-name"></span>';
      item.querySelector('.lmd-node-name').textContent = row.name;
      container.appendChild(item);
      if (row.dir) {
        item.type = 'button';
        const kids = el('div', { class: 'lmd-node-kids', hidden: '' });
        container.appendChild(kids);
        const open = async () => {
          kids.hidden = !kids.hidden;
          item.classList.toggle('lmd-open', !kids.hidden);
          if (!kids.hidden && !kids.dataset.loaded) { kids.dataset.loaded = '1'; await fillDir(kids, row.url, depth + 1); }
        };
        item.addEventListener('click', open);
        if (here.startsWith(row.url)) open();
      } else {
        item.href = toHref(row.url);
        if (row.url === here) { item.classList.add('lmd-active'); setTimeout(() => item.scrollIntoView({ block: 'nearest' }), 0); }
      }
    });
  }

  // ---------- Búsqueda ----------
  // Con la pestaña Índice busca en este documento; con la pestaña Carpeta, en todos los Markdown de la carpeta.
  const FOLDER_MAX_FILES = 600;
  const FOLDER_MAX_DEPTH = 6;
  const fileCache = new Map();
  let folderIndex = null;
  let folderToken = 0;

  const folderMode = () => settings.sidebarTab === 'files';

  // El buscador está siempre a la vista: "abrir" es darle foco y "cerrar" es vaciarlo.
  function toggleSearch(show) {
    if (show) {
      if (settings.sidebarHidden) LMD.patch({ sidebarHidden: false });
      ui.searchInput.focus(); ui.searchInput.select();
      if (ui.searchInput.value) runSearch(ui.searchInput.value);
    } else { ui.searchInput.value = ''; ui.searchInput.blur(); clearSearch(); showResults(false); folderToken++; }
  }

  function showResults(on) {
    ui.results.hidden = !on;
    ui.treeBox.hidden = on;
  }

  function clearSearch() {
    searchHits = []; searchIndex = -1; ui.searchCount.textContent = '';
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('lmd-hit'); CSS.highlights.delete('lmd-hit-current'); }
  }

  function runSearch(q, jump) {
    clearSearch();
    q = (q || '').trim();
    const folder = folderMode();
    if (!q) { showResults(false); folderToken++; return; }
    highlightInDoc(q.toLowerCase(), !folder || jump);
    if (folder) searchFolder(q); else showResults(false);
  }

  function highlightInDoc(q, scroll) {
    if (!(window.CSS && CSS.highlights)) return;
    const scope = rawMode ? ui.rawPre : ui.article;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.toLowerCase();
      let i = 0;
      while ((i = text.indexOf(q, i)) !== -1) {
        const r = new Range(); r.setStart(node, i); r.setEnd(node, i + q.length);
        searchHits.push(r); i += q.length;
        if (searchHits.length > 5000) break;
      }
    }
    if (searchHits.length) {
      CSS.highlights.set('lmd-hit', new Highlight(...searchHits));
      if (scroll) stepSearch(1);
    } else if (!folderMode()) ui.searchCount.textContent = '0';
  }

  function stepSearch(dir) {
    if (!searchHits.length) return;
    searchIndex = (searchIndex + dir + searchHits.length) % searchHits.length;
    const r = searchHits[searchIndex];
    CSS.highlights.set('lmd-hit-current', new Highlight(r));
    const rect = r.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: 'smooth' });
    if (!folderMode()) ui.searchCount.textContent = (searchIndex + 1) + ' / ' + searchHits.length;
  }

  async function collectFiles(root) {
    const out = [];
    const queue = [{ url: root, rel: '', depth: 0 }];
    while (queue.length && out.length < FOLDER_MAX_FILES) {
      const d = queue.shift();
      const rows = await listDir(d.url, true);
      if (!rows) { if (d.depth === 0) return null; continue; }
      rows.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const r of rows) {
        if (!settings.filesShowHidden && r.name.startsWith('.')) continue;
        if (r.dir) {
          if (d.depth < FOLDER_MAX_DEPTH && !SKIP_DIRS.test(r.name)) queue.push({ url: r.url, rel: d.rel + r.name + '/', depth: d.depth + 1 });
        } else if (MD_RE.test(r.name)) out.push({ rel: d.rel + r.name, url: r.url });
      }
    }
    return out;
  }

  async function readFile(url) {
    if (fileCache.has(url)) return fileCache.get(url);
    let text = '';
    if (APP) text = (await vText(url)) || '';
    else { const r = await bg({ type: 'fetchText', url }); text = r && r.ok ? r.text : ''; }
    fileCache.set(url, text);
    return text;
  }

  async function searchFolder(q) {
    const token = ++folderToken;
    const needle = q.toLowerCase();
    showResults(true);
    ui.results.textContent = '';
    ui.results.appendChild(el('p', { class: 'lmd-empty', text: T('Buscando en la carpeta…') }));
    ui.searchCount.textContent = '…';

    if (!folderIndex || folderIndex.root !== treeRoot) {
      const files = await collectFiles(treeRoot);
      if (token !== folderToken) return;
      if (files == null) {
        ui.results.textContent = '';
        ui.results.appendChild(el('p', { class: 'lmd-empty', text: isFile ? T('No se pudo leer la carpeta. Activá "Permitir acceso a URL de archivo" en los detalles de la extensión.') : T('Este servidor no expone el listado de la carpeta.') }));
        ui.searchCount.textContent = '';
        return;
      }
      folderIndex = { root: treeRoot, files };
    }
    const files = folderIndex.files;
    const found = [];
    let next = 0; let total = 0;
    const worker = async () => {
      while (next < files.length && token === folderToken) {
        const f = files[next++];
        const text = await readFile(f.url);
        if (!text) continue;
        if (text.toLowerCase().indexOf(needle) === -1) continue;
        const lines = text.split(/\r?\n/); const hits = []; let count = 0;
        for (let i = 0; i < lines.length; i++) {
          const low = lines[i].toLowerCase(); let pos = low.indexOf(needle);
          if (pos === -1) continue;
          let n = 0; let p2 = pos;
          while (p2 !== -1) { n++; p2 = low.indexOf(needle, p2 + needle.length); }
          count += n;
          if (hits.length < 4) hits.push({ line: i + 1, text: lines[i], pos });
        }
        total += count;
        found.push({ file: f, hits, count });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (token !== folderToken) return;

    found.sort((x, y) => x.file.rel.localeCompare(y.file.rel, undefined, { numeric: true, sensitivity: 'base' }));
    ui.results.textContent = '';
    const here = HERE;
    const summary = found.length
      ? T((total === 1 ? '{t} coincidencia' : '{t} coincidencias') + (found.length === 1 ? ' en {f} archivo (de {n})' : ' en {f} archivos (de {n})'), { t: total, f: found.length, n: files.length })
      : T(files.length === 1 ? 'Sin coincidencias en {n} archivo' : 'Sin coincidencias en {n} archivos', { n: files.length });
    ui.results.appendChild(el('p', { class: 'lmd-results-sum', text: summary + (files.length >= FOLDER_MAX_FILES ? T('. Se revisaron los primeros {n}.', { n: FOLDER_MAX_FILES }) : '') }));
    ui.searchCount.textContent = String(total);
    const frag = '#lmd-q=' + encodeURIComponent(q) + '&r=' + encodeURIComponent(treeRoot);
    found.forEach((r) => {
      const group = el('div', { class: 'lmd-res' + (r.file.url === here ? ' lmd-res-here' : '') });
      const head = el('a', { class: 'lmd-res-file', href: toHref(r.file.url + frag), title: r.file.rel });
      head.innerHTML = '<span class="lmd-node-ico">' + ICON.md + '</span><span class="lmd-res-name"></span><span class="lmd-res-count"></span>';
      head.querySelector('.lmd-res-name').textContent = r.file.rel;
      head.querySelector('.lmd-res-count').textContent = r.count;
      group.appendChild(head);
      r.hits.forEach((h) => {
        const start = Math.max(0, h.pos - 34);
        const cut = h.text.slice(start, h.pos + needle.length + 70);
        const rel = h.pos - start;
        const a = el('a', { class: 'lmd-res-hit', href: toHref(r.file.url + frag), title: T('Línea {n}', { n: h.line }) });
        a.append((start > 0 ? '…' : '') + cut.slice(0, rel), el('mark', { text: cut.slice(rel, rel + needle.length) }), cut.slice(rel + needle.length));
        group.appendChild(a);
      });
      if (r.count > r.hits.length && r.hits.length === 4) group.appendChild(el('span', { class: 'lmd-res-more', text: T('y más en este archivo') }));
      ui.results.appendChild(group);
    });
  }

  // ---------- Visor de imágenes ----------
  function openViewer(img) {
    ui.viewer.textContent = '';
    ui.viewer.appendChild(el('img', { src: img.currentSrc || img.src, alt: img.alt || '' }));
    ui.viewer.hidden = false;
  }

  // El título elegido en el índice manda hasta que la persona vuelve a mover la página por su cuenta.
  let spyPin = null;
  ['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { spyPin = null; }, { passive: true }));
  window.addEventListener('keydown', (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) spyPin = null; }, true);

  // ---------- Panel de ajustes ----------
  let panelStale = false;
  let panelTab = 'look';
  let serverDraft = false; // "Uso mi propio servidor" prendido y la dirección todavía sin escribir
  const PANEL_TABS = [['look', 'Apariencia', ICON.eye], ['read', 'Lectura y edición', ICON.pencil], ['plug', 'Plugins', ICON.b_code], ['cloud', 'Nube', ICON.cloud], ['ai', 'IA', ICON.spark], ['plan', 'Plan', ICON.card], ['adv', 'Avanzado', ICON.gear]];
  // Con tab abre directo en esa pestaña: openPanel('plan').
  function openPanel(tab) {
    if (tab) panelTab = tab;
    if (!PANEL_TABS.some((t) => t[0] === panelTab)) panelTab = 'look';
    LMD.write.closeMenu(); // un menú de bloques abierto quedaría encima de los ajustes
    const s = settings;
    if (ui.panel.hidden) serverDraft = false;
    const noCloud = /^off$/i.test(s.cloudUrl || ''); const own = serverDraft || (!!s.cloudUrl && !noCloud);
    const EXTRA = ' <em class="lmd-tag">' + T('Plan pago') + '</em>';
    const plugins = Object.keys(LMD.PLUGIN_LABELS).map((k) =>
      '<label class="lmd-switch" data-tip="' + esc(T(LMD.PLUGIN_HELP[k] || '')) + '"><input type="checkbox" data-plugin="' + k + '"' + (s.plugins[k] ? ' checked' : '') + '><i></i><span>' + esc(T(LMD.PLUGIN_LABELS[k])) + '</span></label>').join('');
    const fonts = LMD.FONTS.slice();
    if (s.fontFamily && !fonts.some((f) => f.value === s.fontFamily)) fonts.push({ name: s.fontFamily, value: s.fontFamily });
    const fontOptions = fonts.map((f) => '<option value="' + esc(f.value) + '"' + (f.value === (s.fontFamily || '') ? ' selected' : '') + '>' + esc(f.value ? f.name : T(f.name)) + '</option>').join('');
    const PREVIEW = '<div class="lmd-preview" aria-hidden="true"><small>' + T('Vista previa') + '</small>' +
      '<div class="lmd-prev-text"><b>' + T('Notas de lanzamiento') + '</b><p>' + T('Así se ve el texto de tus documentos con esta letra, este tamaño y este interlineado.') + '</p></div>' +
      '<pre class="lmd-prev-code"><code><span class="k">const</span> items = [<span class="n">12</span>, <span class="n">30</span>, <span class="n">8</span>];\n<span class="k">const</span> total = <span class="f">sum</span>(items);\nconsole.<span class="f">log</span>(total);</code></pre>' +
      '<svg class="lmd-prev-dgm" viewBox="0 0 150 132"><rect class="node" x="6" y="4" width="84" height="36"/><rect class="node" x="60" y="92" width="84" height="36"/><path class="curve" d="M48 40 C 48 70, 102 58, 102 85"/><path class="line" d="M48 40 V 64 H 102 V 85"/><path class="tip" d="M97 84 h10 l-5 8z"/><text x="48" y="27">A</text><text x="102" y="115">B</text></svg>' +
    '</div>';
    ui.panel.innerHTML =
      '<div class="lmd-panel-card" role="dialog" aria-label="' + T('Ajustes') + '">' +
        '<header><h2>' + T('Ajustes') + '</h2><button class="lmd-icon-btn" data-act="close-panel" title="' + T('Cerrar') + '">' + ICON.close + '</button></header>' +
        '<nav class="lmd-ptabs" role="tablist">' +
          PANEL_TABS.map((t) => '<button type="button" role="tab" data-ptab="' + t[0] + '">' + t[2] + '<span>' + T(t[1]) + '</span></button>').join('') +
          '<button type="button" class="lmd-ptabs-foot" data-act="feedback">' + ICON.mail + '<span>' + T('Enviar comentarios') + '</span></button>' +
        '</nav>' +
        '<div class="lmd-panel-body">' +
          '<section class="lmd-two" data-tab="look"><h3>' + T('Apariencia') + '</h3>' +
            '<div class="lmd-row"><span>' + T('Idioma') + '</span><div class="lmd-seg" data-seg="language" role="radiogroup">' +
              ['auto', 'es', 'en'].map((l) => '<button type="button" role="radio" data-val="' + l + '" aria-checked="' + (s.language === l) + '"' + (s.language === l ? ' class="lmd-on"' : '') + '>' + { auto: T('Automático'), es: 'Español', en: 'English' }[l] + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Tema') + '</span><div class="lmd-seg" data-seg="theme" role="radiogroup">' +
              ['auto', 'light', 'dark'].map((t) => '<button type="button" role="radio" data-val="' + t + '" aria-checked="' + (s.theme === t) + '"' + (s.theme === t ? ' class="lmd-on"' : '') + '>' + T({ auto: 'Automático', light: 'Claro', dark: 'Oscuro' }[t]) + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-pcol"><div class="lmd-row"><span>' + T('Color de acento') + (s.supporter ? '' : EXTRA) + '</span><div class="lmd-swatches' + (s.supporter ? '' : ' lmd-locked') + '">' +
              LMD.ACCENTS.map((a) => '<button type="button" class="lmd-swatch' + ((s.accent || '') === a.value ? ' lmd-on' : '') + (a.value ? '' : ' lmd-swatch-auto') + '" data-accent="' + a.value + '" title="' + esc(T(a.name)) + '" aria-label="' + esc(T(a.name)) + '"' + (a.value ? ' style="--sw:' + a.value + '"' : '') + '></button>').join('') +
              '<label class="lmd-swatch lmd-swatch-custom' + (s.accent && !LMD.ACCENTS.some((a) => a.value === s.accent) ? ' lmd-on' : '') + '" title="' + T('Otro color') + '"><input type="color" data-accent-custom value="' + (/^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6c7ee1') + '"></label>' +
            '</div>' +
            '</div>' +
            '<label class="lmd-row"><span>' + T('Tipografía') + (s.supporter ? '' : EXTRA) + '</span><select data-key="fontFamily"' + (s.supporter ? '' : ' disabled') + '>' + fontOptions + '</select></label>' +
            '<label class="lmd-row"><span>' + T('Tamaño de letra') + ' <output>' + s.fontSize + ' px</output></span><input type="range" min="12" max="24" step="1" data-key="fontSize" data-unit=" px" value="' + s.fontSize + '"></label>' +
            '<label class="lmd-row"><span>' + T('Interlineado') + ' <output>' + s.lineHeight + '</output></span><input type="range" min="1.2" max="2.2" step="0.05" data-key="lineHeight" data-unit="" value="' + s.lineHeight + '"></label>' +
            '<div class="lmd-row"><span>' + T('Color de los bloques de código') + '</span><div class="lmd-swatches">' +
              LMD.CODE_COLORS.map((c) => '<button type="button" class="lmd-swatch' + ((s.codeColor || '') === c.value ? ' lmd-on' : '') + (c.value ? '' : ' lmd-swatch-auto') + '" data-code-color="' + c.value + '" title="' + T(c.name) + '"' + (c.value ? ' style="--sw:' + c.value + '"' : '') + '></button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Forma de los diagramas') + '</span><div class="lmd-seg" data-seg="diagramShape" role="radiogroup">' +
              [['round', 'Redondeados'], ['square', 'Rectos']].map((o) => '<button type="button" role="radio" data-val="' + o[0] + '" aria-checked="' + ((s.diagramShape || 'round') === o[0]) + '"' + ((s.diagramShape || 'round') === o[0] ? ' class="lmd-on"' : '') + '>' + T(o[1]) + '</button>').join('') +
            '</div></div>' +
            '</div>' + PREVIEW +
            (s.supporter ? '' : '<div class="lmd-extra"><p>' + T('Los colores, la tipografía y el CSS propio vienen con el plan pago.') + '</p>' +
                '<div class="lmd-extra-actions"><button type="button" class="lmd-btn lmd-btn-fill" data-act="see-plans">' + T('Ver planes') + '</button></div></div>') +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Lectura') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="centered"' + (s.centered ? ' checked' : '') + '><span>' + T('Centrar el contenido') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Ancho del contenido') + ' <output>' + s.contentWidth + ' px</output></span><input type="range" min="560" max="1800" step="20" data-key="contentWidth" data-unit=" px" value="' + s.contentWidth + '"></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="wrapCode"' + (s.wrapCode ? ' checked' : '') + '><span>' + T('Ajustar las líneas largas del código') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="rememberPosition"' + (s.rememberPosition ? ' checked' : '') + '><span>' + T('Recordar por dónde iba en cada archivo') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autoRefresh"' + (s.autoRefresh ? ' checked' : '') + '><span>' + T('Recargar solo cuando el archivo cambia') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Revisar cada') + ' <output>' + s.refreshInterval + ' ms</output></span><input type="range" min="300" max="5000" step="100" data-key="refreshInterval" data-unit=" ms" value="' + s.refreshInterval + '"></label>' +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Edición') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autosave"' + (s.autosave ? ' checked' : '') + '><span>' + T('Guardar solo mientras edito') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Guardar a los') + ' <output>' + s.autosaveDelay + ' ms</output></span><input type="range" min="1000" max="30000" step="500" data-key="autosaveDelay" data-unit=" ms" value="' + s.autosaveDelay + '"></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="focusMode"' + (s.focusMode ? ' checked' : '') + '><span>' + T('Modo foco: atenuar lo que no estoy escribiendo') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="typewriter"' + (s.typewriter ? ' checked' : '') + '><span>' + T('Máquina de escribir: mantener el renglón a media altura') + '</span></label>' +
          '</section>' +
          '<section class="lmd-two" data-tab="read"><h3>' + T('Carpeta') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesOnlyMarkdown"' + (s.filesOnlyMarkdown ? ' checked' : '') + '><span>' + T('Mostrar solo archivos Markdown') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesShowHidden"' + (s.filesShowHidden ? ' checked' : '') + '><span>' + T('Mostrar archivos y carpetas ocultos') + '</span></label>' +
          '</section>' +
          '<section data-tab="plug"><h3>' + T('Plugins de Markdown') + '</h3><div class="lmd-grid">' + plugins + '</div></section>' +
          // Nube, IA y Plan los dibuja sync.js al entrar a cada pestaña, con la cuenta recién consultada.
          '<section data-tab="cloud"><h3>' + T('Nube') + '</h3><div class="lmd-acct" data-acct="cloud"></div></section>' +
          '<section data-tab="ai"><h3>' + T('Conectar una IA') + '</h3><div class="lmd-acct" data-acct="ai"></div></section>' +
          '<section data-tab="plan"><h3>' + T('Plan') + '</h3><div class="lmd-acct" data-acct="plan"></div></section>' +
          '<section data-tab="adv"><h3>' + T('CSS propio') + (s.supporter ? '' : EXTRA) + '</h3>' +
            '<textarea data-key="customCSS"' + (s.supporter ? '' : ' disabled') + ' spellcheck="false" placeholder=".markdown-body h1 { color: tomato; }">' + esc(s.customCSS) + '</textarea>' +
            '<p class="lmd-hint">' + T('Se aplica encima del tema. El documento vive dentro de .markdown-body.') + '</p>' +
          '</section>' +
          // Vacío usa el servidor de SharpMD; una dirección, el propio; "off" deja la app sin nube.
          '<section class="lmd-two" data-tab="adv"><h3>' + T('Servidor') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-server="own"' + (own ? ' checked' : '') + '><span>' + T('Uso mi propio servidor') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-server="off"' + (noCloud ? ' checked' : '') + '><span>' + T('Usar SharpMD sin nube') + '</span></label>' +
            '<label class="lmd-row lmd-server-url"' + (own ? '' : ' hidden') + '><span>' + T('Dirección del servidor') + '</span><input type="text" data-server="url" spellcheck="false" placeholder="https://" value="' + (own ? esc(s.cloudUrl) : '') + '"></label>' +
          '</section>' +
          (chrome.runtime.getManifest().update_url ? '' :
          '<section class="lmd-two" data-tab="adv"><h3>' + T('Actualizaciones') + '</h3>' +
            '<div class="lmd-row"><span>' + T('Buscar versiones nuevas') + '</span><div class="lmd-seg" data-seg="updateCheck" role="radiogroup">' +
              [['daily', 'Por día'], ['weekly', 'Por semana'], ['off', 'Nunca']].map((o) => '<button type="button" role="radio" data-val="' + o[0] + '" aria-checked="' + (s.updateCheck === o[0]) + '"' + (s.updateCheck === o[0] ? ' class="lmd-on"' : '') + '>' + T(o[1]) + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row lmd-row-line"><span>' + T('Versión instalada: {v}', { v: chrome.runtime.getManifest().version }) + '</span><button type="button" class="lmd-btn" data-act="check-update">' + T('Buscar ahora') + '</button></div>' +
            '<p class="lmd-update-msg" role="status" hidden></p>' +
            '<p class="lmd-hint">' + T('Lo único que se consulta es el número de versión publicado en GitHub. No se manda ningún dato.') + '</p>' +
          '</section>') +
          '<section class="lmd-panel-foot" data-tab="adv"><button type="button" class="lmd-btn" data-act="reset">' + T('Restablecer todo') + '</button></section>' +
        '</div>' +
      '</div>';
    ui.panel.hidden = false;
    // Desde los paneles de la cuenta: cómo cambiar de pestaña, ir a entrar, y salir a pagar sin perder lo escrito.
    const host = {
      tab: (t) => showTab(t), login: () => onAction('go-home'), close: () => { ui.panel.hidden = true; },
      leave: () => (dirty ? save(false) : Promise.resolve(true)),
      back: location.href.split('#')[0], appUrl: APP_URL, direct: !APP,
      // Las personalizaciones vienen con el plan pago y se conservan.
      unlocked: (a) => { if (a.plan === 'pro' && !settings.supporter) { panelStale = true; LMD.patch({ supporter: true }); } },
    };
    const showTab = (tab) => {
      panelTab = tab;
      ui.panel.querySelectorAll('[data-ptab]').forEach((b) => { b.classList.toggle('lmd-on', b.dataset.ptab === tab); b.setAttribute('aria-selected', String(b.dataset.ptab === tab)); });
      ui.panel.querySelectorAll('.lmd-panel-body > section').forEach((sec) => { sec.hidden = sec.dataset.tab !== tab; });
      ui.panel.querySelector('.lmd-panel-body').scrollTop = 0;
      const acct = ui.panel.querySelector('[data-acct=' + tab + ']');
      if (acct) LMD.sync.panes[tab](acct, host);
    };
    ui.panel.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ptab)));
    showTab(panelTab);

    let pending = {};
    const flush = debounce(() => { const p = pending; pending = {}; LMD.patch(p); }, 150);
    const commit = (partial) => { Object.assign(pending, partial); flush(); };

    ui.panel.querySelectorAll('.lmd-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        const seg = b.parentNode;
        seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('lmd-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        LMD.patch({ [seg.dataset.seg]: b.dataset.val });
      });
    });
    const markSwatch = (node) => ui.panel.querySelectorAll('.lmd-swatch:not([data-code-color])').forEach((x) => x.classList.toggle('lmd-on', x === node));
    ui.panel.querySelectorAll('[data-code-color]').forEach((b) => {
      b.addEventListener('click', () => {
        ui.panel.querySelectorAll('[data-code-color]').forEach((x) => x.classList.toggle('lmd-on', x === b));
        LMD.patch({ codeColor: b.dataset.codeColor });
      });
    });
    ui.panel.querySelectorAll('[data-accent]').forEach((b) => {
      b.addEventListener('click', () => { if (!settings.supporter) return; markSwatch(b); LMD.patch({ accent: b.dataset.accent }); });
    });
    const custom = ui.panel.querySelector('[data-accent-custom]');
    if (!settings.supporter) custom.disabled = true;
    custom.addEventListener('input', () => {
      markSwatch(custom.parentNode);
      settings.accent = custom.value; applySettings();
      commit({ accent: custom.value });
    });
    ui.panel.querySelectorAll('[data-key]').forEach((input) => {
      const key = input.dataset.key;
      const read = () => input.type === 'checkbox' ? input.checked : (input.type === 'range' ? parseFloat(input.value) : input.value);
      input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => {
        const v = read();
        if (input.type === 'range') {
          const out = input.closest('label').querySelector('output');
          if (out) out.textContent = v + (input.dataset.unit || '');
          settings[key] = v; applySettings(); // respuesta inmediata al arrastrar
        }
        if (key === 'fontFamily') { settings[key] = v; applySettings(); }
        commit({ [key]: v });
      });
    });
    ui.panel.querySelectorAll('[data-plugin]').forEach((input) => {
      input.addEventListener('change', () => LMD.patch({ plugins: { [input.dataset.plugin]: input.checked } }));
    });
    // Servidor: los dos interruptores se excluyen. La dirección se guarda al terminar de escribirla.
    const server = (name) => ui.panel.querySelector('[data-server=' + name + ']');
    const urlRow = ui.panel.querySelector('.lmd-server-url');
    server('own').addEventListener('change', () => {
      serverDraft = server('own').checked; urlRow.hidden = !serverDraft;
      if (serverDraft) { server('off').checked = false; server('url').focus(); }
      LMD.patch({ cloudUrl: serverDraft ? server('url').value.trim() : '' });
    });
    server('off').addEventListener('change', () => {
      if (server('off').checked) { serverDraft = false; server('own').checked = false; urlRow.hidden = true; }
      LMD.patch({ cloudUrl: server('off').checked ? 'off' : '' });
    });
    server('url').addEventListener('change', () => { if (server('own').checked) LMD.patch({ cloudUrl: server('url').value.trim() }); });
    if (serverDraft && panelTab === 'adv' && !server('url').value) server('url').focus();
    ui.panel.onclick = (e) => { if (e.target === ui.panel) ui.panel.hidden = true; };
  }

  // ---------- Modo edición ----------
  // Se edita sobre el texto ya formateado: cada bloque (párrafo, título, ítem, celda) es editable
  // en el lugar y, al salir, se reescribe solo el Markdown de ese bloque. La sintaxis nunca se ve.
  let editMode = false;
  let dirty = false;
  let diskText = raw;
  let fileHandle = null;
  let srcLines = [];
  let fmOffset = 0;
  let eol = '\n';
  let needsRender = false;
  let autosaveTimer = null;
  let softTimer = null;
  let pendingCell = null;

  const BLOCKS_INSIDE = 'UL,OL,P,PRE,BLOCKQUOTE,DIV,TABLE,DL,H1,H2,H3,H4,H5,H6';

  function syncSource() {
    eol = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    srcLines = raw.split(/\r?\n/);
  }

  const rangeOf = (node, attr) => {
    const m = /^(\d+)-(\d+)$/.exec(node.getAttribute(attr || 'data-l') || '');
    return m ? [+m[1], +m[2]] : null;
  };

  const PREFIX_RE = /^((?:\s{0,3}>\s?)*\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\[[ xX]\]\s+)?)/;

  function blockSource(elm) {
    const r = rangeOf(elm); if (!r) return null;
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const md = inlineMd(elm).replace(/\n+$/, '');
    const first = srcLines[s] || '';
    if (/^H[1-6]$/.test(elm.tagName)) {
      const quote = /^((?:\s{0,3}>\s?)*)/.exec(first)[1];
      return { s, e, lines: [quote + '#'.repeat(+elm.tagName[1]) + ' ' + md.replace(/\n/g, ' ').trim()] };
    }
    const prefix = PREFIX_RE.exec(first)[1];
    const cont = prefix.replace(/[-*+]|\d{1,9}[.)]|\[[ xX]\]/g, (m) => ' '.repeat(m.length));
    const parts = md.split('\n');
    return { s, e, lines: parts.map((part, i) => (i === 0 ? prefix : cont) + part.trim() + (i < parts.length - 1 ? '\\' : '')) };
  }

  // Reemplaza líneas del fuente y corre los rangos de los bloques que vienen después, sin redibujar:
  // así el foco puede pasar a otro bloque sin perder el cursor.
  // Deshacer trabaja sobre el fuente completo: alcanza para volver atrás cualquier operación de bloques.
  const undoStack = [];
  const redoStack = [];
  function pushUndo() {
    if (undoStack[undoStack.length - 1] === raw) return;
    undoStack.push(raw);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0; // un cambio nuevo descarta lo que se podía rehacer
  }
  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(raw);
    raw = undoStack.pop(); syncSource(); markDirty(); render();
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(raw);
    raw = redoStack.pop(); syncSource(); markDirty(); render();
    return true;
  }

  // Inserta líneas sin redibujar: corre los bloques que vienen después y agranda los contenedores indicados.
  function insertLines(at, newLines, owners) {
    pushUndo();
    srcLines.splice(at, 0, ...newLines);
    raw = srcLines.join(eol);
    const rel = at - fmOffset; const n = newLines.length;
    ui.article.querySelectorAll('[data-l], [data-p]').forEach((node) => {
      ['data-l', 'data-p'].forEach((a) => {
        const r = rangeOf(node, a); if (!r) return;
        if (r[0] >= rel) node.setAttribute(a, (r[0] + n) + '-' + (r[1] + n));
        else if (r[1] > rel || (r[1] === rel && owners && owners.indexOf(node) !== -1)) node.setAttribute(a, r[0] + '-' + (r[1] + n));
      });
    });
    markDirty();
  }

  // Cambia líneas del fuente. Quien lo llama redibuja.
  function spliceLines(s, count, newLines) {
    pushUndo();
    srcLines.splice(s, count, ...newLines);
    raw = srcLines.join(eol);
    markDirty();
  }

  // Pasa al fuente lo editado en un bloque, si cambió.
  function commitBlock(node) {
    if (node._md == null || inlineMd(node) === node._md) return false;
    if (node.classList.contains('lmd-cell')) commitCell(node);
    else { const b = blockSource(node); if (b) replaceLines(b.s, b.e, b.lines, node, 'data-l'); }
    node._md = inlineMd(node);
    return true;
  }

  function replaceLines(s, e, newLines, owner, attr) {
    pushUndo();
    srcLines.splice(s, e - s, ...newLines);
    raw = srcLines.join(eol);
    const delta = newLines.length - (e - s);
    const rs = s - fmOffset; const re = e - fmOffset;
    if (delta) {
      ui.article.querySelectorAll('[data-l], [data-p]').forEach((n) => {
        ['data-l', 'data-p'].forEach((a) => {
          const r = rangeOf(n, a); if (!r || (n === owner && a === attr)) return;
          if (r[0] >= re) n.setAttribute(a, (r[0] + delta) + '-' + (r[1] + delta));
          else if (r[0] <= rs && r[1] >= re) n.setAttribute(a, r[0] + '-' + (r[1] + delta));
        });
      });
    }
    if (owner) owner.setAttribute(attr || 'data-l', rs + '-' + (rs + newLines.length));
    markDirty();
  }

  function markDirty() {
    dirty = raw !== diskText;
    // Un documento en memoria se va guardando en la sesión, para que recargar la pestaña no lo pierda.
    if (appRoot && appRoot.id === 'mem') { try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name: DOC_NAME, text: raw, disk: diskText })); } catch (e) { /* demasiado grande */ } }
    needsRender = true;
    if (editMode) rememberEdit(true);
    updateSaveState();
    clearTimeout(autosaveTimer);
    // Las notas del navegador se guardan solas, siempre.
    if (dirty && appRoot && appRoot.kind === 'local') { autosaveTimer = setTimeout(() => save(false), 600); return; }
    if (dirty && appRoot && appRoot.kind === 'cloud') { if (cloudState !== 'error') cloudState = 'saving'; autosaveTimer = setTimeout(() => save(false), 1500); return; }
    if (dirty && settings.autosave) {
      if (fileHandle) autosaveTimer = setTimeout(() => save(false), Math.max(500, settings.autosaveDelay | 0));
      else flash(T('Guardá una vez con Ctrl+S para activar el guardado automático'), 'warn');
    }
  }

  function updateSaveState() {
    if (LMD.sync) LMD.sync.paint();
    const root = document.documentElement;
    root.classList.toggle('lmd-dirty', dirty);
    root.classList.toggle('lmd-editing', editMode);
    ui.main.querySelectorAll('.lmd-modeseg button').forEach((b) => {
      const on = (b.dataset.act === 'mode-edit') === editMode;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on));
    });
    ui.main.querySelector('[data-act=mode-read]').title = T('Ver') + ' · ' + T(editMode ? 'Guardar y volver a solo lectura' : 'Estás viendo el documento');
    ui.main.querySelector('[data-act=mode-edit]').title = T('Editar') + ' · ' + T(editMode ? 'Estás editando el documento' : 'Editar el documento');
    const state = ui.main.querySelector('.lmd-savestate');
    const local = !!appRoot && appRoot.kind === 'local';
    const cloud = !!appRoot && appRoot.kind === 'cloud';
    state.textContent = cloud ? T(cloudState === 'error' ? 'Sin conexión' : dirty ? 'Guardando…' : 'Guardado en la nube') : local ? T(dirty ? 'Guardando…' : 'Guardado en este navegador')
      : (dirty ? T('Cambios sin guardar') : (editMode ? T(settings.autosave ? 'Guardado · autoguardado activo' : 'Todo guardado') : ''));
    const save = ui.main.querySelector('[data-act=save]');
    save.hidden = !local && !editMode && !dirty;
    save.title = local ? T('Guardar como archivo en el disco (Ctrl+S)') : (dirty ? T('Guardar (Ctrl+S). Hay cambios sin guardar') : T('Guardar (Ctrl+S)'));
  }

  // El modo edición se recuerda por pestaña: recargar o pasar a otra nota no lo saca mientras se siga
  // editando. La marca vence sola a la media hora del último cambio.
  const EDIT_KEY = 'lmd-edit'; const EDIT_TTL = 30 * 60 * 1000;
  function rememberEdit(on) {
    try { if (on) sessionStorage.setItem(EDIT_KEY, String(Date.now())); else sessionStorage.removeItem(EDIT_KEY); } catch (e) { /* sin sesión */ }
  }
  const editRemembered = () => { try { const t = +sessionStorage.getItem(EDIT_KEY); return t > 0 && Date.now() - t < EDIT_TTL; } catch (e) { return false; } };

  function softRender() {
    clearTimeout(softTimer);
    softTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!needsRender || (a && (a.isContentEditable || a.classList.contains('lmd-src')))) return;
      render();
    }, 350);
  }

  async function setEditMode(on) {
    if (on && readOnly) { flash(T('Esta nota es de solo lectura'), 'warn'); return; }
    // Salir de edición guarda lo pendiente. Si se cancela el guardado, los cambios quedan sin guardar.
    if (!on && editMode) {
      const a = document.activeElement;
      if (a && a.blur && (a.isContentEditable || a.classList.contains('lmd-src'))) a.blur();
      if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.split('\r\n').join('\n').split('\n').join(eol); syncSource(); dirty = raw !== diskText; }
      if (dirty) await save(true);
    }
    // Lo que no es Markdown se edita como texto, desde la vista de código.
    if (on && docKind() === 'image') { flash(T('Las imágenes no se editan acá'), 'warn'); return; }
    if (on && docKind() !== 'md') rawMode = true;
    editMode = on;
    rememberEdit(on);
    updateSaveState();
    render();
    applyRawMode();
    if (on) flash(T('Modo edición: hacé clic en un texto o una celda para cambiarlo'));
  }

  // Marca qué se puede editar después de cada render.
  function enableEditing(article) {
    const make = (node, attr) => {
      if (!roundTrips(node)) { node.classList.add('lmd-noedit'); node.title = T('Este bloque se edita desde la vista de código'); return; }
      node.contentEditable = 'true'; node.spellcheck = true; node.classList.add('lmd-editable');
      if (attr) node.dataset.attr = attr;
    };
    article.querySelectorAll('p[data-l], h1[data-l], h2[data-l], h3[data-l], h4[data-l], h5[data-l], h6[data-l]').forEach((n) => {
      if (n.closest('.lmd-alert-title, .lmd-box-title, .lmd-front, .footnotes')) return;
      make(n);
    });
    // Ítems de lista compactos: el texto vive directo en el <li>, a veces seguido de una sublista.
    article.querySelectorAll('li[data-p]').forEach((li) => {
      if (li.closest('.footnotes')) return;
      const span = el('span', { class: 'lmd-li-text' });
      span.setAttribute('data-l', li.getAttribute('data-p'));
      const nodes = [];
      for (const n of Array.from(li.childNodes)) {
        if (n.nodeType === 1 && n.matches(BLOCKS_INSIDE)) break;
        if (n.nodeType === 1 && n.tagName === 'INPUT') continue;
        nodes.push(n);
      }
      if (!nodes.length) return;
      li.insertBefore(span, nodes[0]);
      nodes.forEach((n) => span.appendChild(n));
      make(span);
    });
    article.querySelectorAll('.lmd-math, .lmd-wiki').forEach((n) => { n.contentEditable = 'false'; });
    article.querySelectorAll('input.lmd-task').forEach((box) => { box.contentEditable = 'false'; });

    article.querySelectorAll('table[data-l]').forEach((table) => {
      const r = rangeOf(table); if (!r) return;
      const src = srcLines.slice(r[0] + fmOffset, r[1] + fmOffset);
      const rows = Array.from(table.rows);
      const simple = table.tHead && table.tHead.rows.length === 1 && src.length === rows.length + 1 && /^[\s|:>-]+$/.test(src[1] || '') &&
        !table.querySelector('[rowspan], [colspan]') && rows.every((tr) => tr.cells.length === rows[0].cells.length);
      if (!simple) { table.classList.add('lmd-noedit'); table.title = T('Esta tabla se edita desde la vista de código'); return; }
      rows.forEach((tr, ri) => Array.from(tr.cells).forEach((cell, ci) => {
        if (!roundTrips(cell)) return;
        cell.contentEditable = 'true'; cell.classList.add('lmd-editable', 'lmd-cell');
        cell.dataset.r = ri; cell.dataset.c = ci;
      }));
    });

    if (pendingCell) {
      const want = pendingCell; pendingCell = null;
      const table = Array.from(article.querySelectorAll('table[data-l]')).find((t) => rangeOf(t)[0] === want.line);
      const cell = table && table.rows[Math.min(want.r, table.rows.length - 1)] && table.rows[Math.min(want.r, table.rows.length - 1)].cells[Math.min(want.c, table.rows[0].cells.length - 1)];
      if (cell) { cell.focus(); const sel = getSelection(); sel.selectAllChildren(cell); sel.collapseToEnd(); }
    }
  }

  const splitRow = (line) => line.replace(/^\s*(?:>\s?)*/, '').trim().replace(/^\|/, '').replace(/(^|[^\\])\|\s*$/, '$1').split(/(?<!\\)\|/).map((c) => c.trim());
  // Una celda con fórmula muestra el resultado; al archivo va la fórmula, salvo mientras se la está editando.
  const cellMd = (cell) => (cell.dataset.formula && document.activeElement !== cell ? cell.dataset.formula : inlineMd(cell)).replace(/\n+$/, '').replace(/\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim();

  function tableContext(table) {
    const r = rangeOf(table);
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const indent = /^\s*(?:>\s?)*/.exec(srcLines[s] || '')[0];
    return { s, e, indent, row: (cells) => indent + '| ' + cells.join(' | ') + ' |' };
  }

  function commitCell(cell) {
    const table = cell.closest('table'); const ctx = tableContext(table);
    const ri = +cell.dataset.r;
    const line = ctx.s + (ri === 0 ? 0 : ri + 1);
    replaceLines(line, line + 1, [ctx.row(Array.from(cell.parentNode.cells).map(cellMd))], null);
  }

  function tableOp(op) {
    const cell = document.activeElement && document.activeElement.closest && document.activeElement.closest('td.lmd-cell, th.lmd-cell');
    if (!cell) return;
    const table = cell.closest('table'); const ctx = tableContext(table);
    const ri = +cell.dataset.r; const ci = +cell.dataset.c;
    const grid = Array.from(table.rows).map((tr) => Array.from(tr.cells).map(cellMd));
    const sep = splitRow(srcLines[ctx.s + 1]);
    let nr = ri; let nc = ci;
    if (op === 'row+') { grid.splice(Math.max(ri, 0) + 1, 0, grid[0].map(() => '')); nr = ri + 1; }
    if (op === 'row-') { if (ri === 0 || grid.length <= 2) return; grid.splice(ri, 1); nr = Math.min(ri, grid.length - 1); }
    if (op === 'col+') { grid.forEach((row) => row.splice(ci + 1, 0, '')); sep.splice(ci + 1, 0, '---'); nc = ci + 1; }
    if (op === 'total') {
      const made = LMD.board.totalsRow(grid);
      if (made.error) { flash(made.error, 'warn'); return; }
      grid.push(made.row); nr = grid.length - 1;
      flash(T('Fila de totales agregada. Cambiá =sum por =avg, =min, =max, =count o =median'));
    }
    if (op === 'col-') { if (grid[0].length <= 1) return; grid.forEach((row) => row.splice(ci, 1)); sep.splice(ci, 1); nc = Math.min(ci, grid[0].length - 1); }
    while (sep.length < grid[0].length) sep.push('---');
    sep.length = grid[0].length;
    const out = [ctx.row(grid[0]), ctx.row(sep)].concat(grid.slice(1).map(ctx.row));
    cell.blur();
    pendingCell = { line: rangeOf(table)[0], r: nr, c: nc };
    replaceLines(ctx.s, ctx.e, out, null);
    render();
  }

  function toggleTask(box) {
    const li = box.closest('li'); if (!li) return;
    const r = rangeOf(li, li.hasAttribute('data-p') ? 'data-p' : 'data-l') || rangeOf(li);
    if (!r) return;
    const i = r[0] + fmOffset;
    const next = (srcLines[i] || '').replace(/\[( |x|X)\]/, box.checked ? '[x]' : '[ ]');
    if (next !== srcLines[i]) replaceLines(i, i + 1, [next], null);
  }

  // Bloques de código: se edita el contenido, sin las cercas.
  function editCode(codeBox) {
    const code = codeBox.querySelector('code'); const r = code && rangeOf(code);
    if (!r || codeBox.querySelector('.lmd-src')) return;
    const s = r[0] + fmOffset; const e = r[1] + fmOffset;
    const fenced = /^\s*(`{3,}|~{3,})/.test(srcLines[s] || '');
    const from = fenced ? s + 1 : s; const to = fenced ? e - 1 : e;
    const ta = el('textarea', { class: 'lmd-src', spellcheck: 'false' });
    ta.value = srcLines.slice(from, to).join('\n');
    ta.rows = Math.max(3, to - from + 1);
    codeBox.querySelector('pre').hidden = true;
    codeBox.appendChild(ta); ta.focus();
    let done = false;
    const finish = (apply) => {
      if (done) return; done = true;
      if (apply && ta.value !== srcLines.slice(from, to).join('\n')) replaceLines(from, to, ta.value.split('\n'), null);
      needsRender = true; ta.remove(); codeBox.querySelector('pre').hidden = false; render();
    };
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); }
    });
  }

  // Barra de formato sobre la selección.
  function formatBar() {
    const sel = getSelection();
    const host = sel.rangeCount && !sel.isCollapsed && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode).closest('.lmd-editable');
    if (!editMode || !host) { ui.format.hidden = true; return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    ui.format.hidden = false;
    ui.format.style.top = Math.max(8, rect.top - 42) + 'px';
    ui.format.style.left = Math.max(8, Math.min(window.innerWidth - 230, rect.left + rect.width / 2 - 105)) + 'px';
  }

  function applyFormat(kind) {
    const sel = getSelection(); if (!sel.rangeCount) return;
    if (kind === 'bold') document.execCommand('bold');
    else if (kind === 'italic') document.execCommand('italic');
    else if (kind === 'strike') document.execCommand('strikeThrough');
    else if (kind === 'code') {
      const text = sel.toString(); if (!text) return;
      const code = document.createElement('code'); code.textContent = text;
      const range = sel.getRangeAt(0); range.deleteContents(); range.insertNode(code);
      sel.selectAllChildren(code);
    } else if (kind === 'link') {
      const url = window.prompt(T('Dirección del enlace'), 'https://');
      if (url) document.execCommand('createLink', false, url);
    } else if (kind === 'clear') { document.execCommand('removeFormat'); document.execCommand('unlink'); }
  }

  // Deja el cursor en un bloque a tantos caracteres del comienzo; sin posición, al final.
  function caretAt(node, offset) {
    node.focus();
    const sel = getSelection();
    if (offset >= 0) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let n; let left = offset;
      while ((n = walker.nextNode())) { if (left <= n.nodeValue.length) { sel.collapse(n, left); return; } left -= n.nodeValue.length; }
    }
    sel.selectAllChildren(node); sel.collapseToEnd();
  }

  // Doble clic leyendo: pasa a edición con el cursor donde se hizo. Lo que ya responde al clic queda como está.
  const NO_DBL = 'a, img, button, input, .lmd-code, .lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz, .lmd-board, .lmd-math, .lmd-toc, .lmd-front';
  async function editAt(e) {
    if (readOnly || docKind() !== 'md' || e.target.closest(NO_DBL)) return;
    const cell = e.target.closest('td, th'); const table = cell && cell.closest('table[data-l]');
    const block = e.target.closest('[data-l]');
    const host = table ? cell : block;
    // En una lista compacta el texto editable lleva el rango del párrafo, que el <li> guarda en data-p.
    const key = table ? table.getAttribute('data-l') : block && (block.tagName === 'LI' && block.getAttribute('data-p') || block.getAttribute('data-l'));
    const where = table ? [cell.parentNode.rowIndex, cell.cellIndex] : null;
    let offset = -1;
    const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (at && host && host.contains(at.startContainer)) { const r = document.createRange(); r.selectNodeContents(host); r.setEnd(at.startContainer, at.startOffset); offset = r.toString().length; }
    await setEditMode(true);
    if (!editMode) return;
    // El mismo bloque, ya editable; si no lo es, el primero editable que tenga adentro.
    let node = null; let exact = true;
    if (where) { const made = ui.article.querySelector('table[data-l="' + key + '"]'); node = made && made.rows[where[0]] && made.rows[where[0]].cells[where[1]]; }
    else if (key) {
      node = ui.article.querySelector('.lmd-editable[data-l="' + key + '"]');
      if (!node) { const made = ui.article.querySelector('[data-l="' + key + '"]'); node = made && made.querySelector('.lmd-editable'); exact = false; }
    }
    if (node && node.isContentEditable) caretAt(node, exact ? offset : -1);
    else if (!raw.trim()) { const add = ui.article.querySelector('.lmd-add'); if (add) add.click(); }
  }

  function bindEditing() {
    ui.article.addEventListener('focusin', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (node && node.dataset.formula) node.textContent = node.dataset.formula;
      if (node) { node._md = inlineMd(node); core.lastBlock = node; }
      ui.tableBar.hidden = !(node && node.classList.contains('lmd-cell'));
      if (!ui.tableBar.hidden) {
        const box = node.closest('table').getBoundingClientRect();
        // Al costado de la tabla si hay lugar; si no, debajo. Arriba taparía el título de la sección.
        const ancho = ui.tableBar.offsetWidth || 300;
        if (box.right + 12 + ancho < window.innerWidth - 8) {
          ui.tableBar.style.left = (box.right + 12) + 'px';
          ui.tableBar.style.top = Math.max(64, box.top) + 'px';
        } else {
          ui.tableBar.style.left = Math.max(8, box.left) + 'px';
          ui.tableBar.style.top = Math.min(window.innerHeight - 52, box.bottom + 8) + 'px';
        }
      }
    });
    ui.article.addEventListener('focusout', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node || !editMode) return;
      setTimeout(() => { const a = document.activeElement; if (!(a && a.classList && a.classList.contains('lmd-cell'))) ui.tableBar.hidden = true; }, 0);
      if (node.classList.contains('lmd-draft')) { LMD.write.blur(node); return; }
      // Lo que quedó escrito en una celda de cuentas pasa a ser su fórmula, o un valor común si dejó de serlo.
      if (node.dataset.formula) { const typed = node.textContent.trim(); if (LMD.board.formulaOf(typed)) node.dataset.formula = typed; else delete node.dataset.formula; }
      if (!commitBlock(node)) { if (node.dataset.formula) LMD.board.calcTables(node.closest('table').parentNode); return; }
      node._md = null;
      softRender();
    });
    ui.article.addEventListener('keydown', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node) return;
      const draft = node.classList.contains('lmd-draft');
      // Enter cierra el bloque y abre uno nuevo debajo; en una celda solo la confirma.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (node.classList.contains('lmd-cell')) node.blur(); else LMD.write.enter(node); }
      else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
      else if (e.key === 'Escape') { e.preventDefault(); node._md = null; if (draft) node._done = true; needsRender = true; node.blur(); render(); }
      else if (draft) LMD.write.onKey(e, node);
    });
    document.addEventListener('paste', (e) => {
      if (!editMode || !e.target.closest || e.target.closest('input, textarea')) return;
      if (docKind() === 'md' && LMD.extras.pasteImage(e)) return;
      if (!e.target.closest('.lmd-editable')) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\r?\n/g, ' '));
    });
    // Las tareas se tildan también leyendo; el cambio queda sin guardar hasta Ctrl+S (o se guarda solo, si está activado).
    ui.article.addEventListener('change', (e) => { if (docKind() === 'md' && e.target.matches && e.target.matches('input.lmd-task')) toggleTask(e.target); });
    ui.article.addEventListener('dblclick', (e) => {
      if (!editMode) { editAt(e); return; }
      const box = e.target.closest('.lmd-code');
      if (box) editCode(box);
    });
    ui.article.addEventListener('click', (e) => {
      if (editMode && e.target.closest('.lmd-editable a') && !(e.ctrlKey || e.metaKey)) e.preventDefault();
    }, true);
    document.addEventListener('selectionchange', debounce(formatBar, 60));
    ui.format.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-fmt]'); if (b) applyFormat(b.dataset.fmt); });
    ui.tableBar.addEventListener('mousedown', (e) => { e.preventDefault(); const b = e.target.closest('[data-top]'); if (b) tableOp(b.dataset.top); });
    ui.rawEdit.addEventListener('input', debounce(() => { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); markDirty(); }, 200));
    // Lo que ya quedó en la cola de la nube no se pierde al cerrar: no hace falta frenar la salida.
    window.addEventListener('beforeunload', (e) => { if (dirty && stashed !== raw) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('online', () => {
      if (!appRoot || appRoot.kind !== 'cloud') return;
      if (dirty && cloudState === 'error') { clearTimeout(autosaveTimer); save(false); } else { cloudPoll = 0; checkForChanges(false); }
    });
  }

  // Lo que los módulos de edición (write.js y los que siguen) necesitan del lector.
  const core = {
    get shape() { return settings.diagramShape; },
    get cloudState() { return cloudState; },
    get readOnly() { return readOnly; },
    get present() { return present; },
    get cloudPath() { return vParts(HERE).join('/'); },
    get dirty() { return dirty; },
    save: (interactive) => save(interactive),
    setEditMode: (on) => setEditMode(on),
    pathOf: (url) => vParts(url).join('/'),
    urlOf: (path) => VBASE + appRoot.id + '/' + path.split('/').map(encodeURIComponent).join('/'),
    openApp: (query) => bg({ type: 'openApp', query }),
    openPanel: (tab) => openPanel(tab),
    ui, hooks: { render: [], tree: [] }, lastBlock: null, appUrl: APP_URL,
    get blocks() { return docKind() === 'md'; },
    treeRoot: () => treeRoot,
    reloadTree: () => { fileCache.clear(); folderIndex = null; wikiIndex = null; return loadTree(); },
    dirHandle: async (dirUrl) => { let dir = appRoot.handle; for (const p of vParts(dirUrl)) dir = await dir.getDirectoryHandle(p); return dir; }, APP, HERE, docName: DOC_NAME, ensure, isDark,
    get srcLines() { return srcLines; }, get fmOffset() { return fmOffset; }, get editMode() { return editMode; },
    get raw() { return raw; }, get settings() { return settings; }, get appRoot() { return appRoot; },
    rangeOf, render, softRender, flash, insertLines, spliceLines, commitBlock, undo, redo, editCode, vFile, toHref,
    inline: (text) => DOMPurify.sanitize(buildParser().renderInline(text)),
    setRaw(text) { pushUndo(); raw = text; syncSource(); markDirty(); render(); },
  };

  // ---------- Permiso para escribir ----------
  // Chrome no deja que una página escriba en el disco sin que la persona elija dónde. Para no
  // pedirlo en cada archivo, se pide una vez la CARPETA: con eso se guarda cualquier archivo de
  // adentro, y el permiso queda recordado para las próximas veces.
  const hereUrl = () => HERE;

  // Busca un permiso ya dado que sirva para este archivo: el del archivo mismo o el de una carpeta que lo contenga.
  async function storedHandle(ask) {
    if (APP) {
      // En la app el archivo ya viene con su permiso: a lo sumo Chrome pide confirmar la escritura.
      let h = null;
      try { h = await vFile(HERE); } catch (e) { /* ya no está */ }
      return h && await canWrite(h, ask) ? h : null;
    }
    const url = hereUrl();
    const recs = await handlesAll();
    const exact = recs.find((r) => r.kind === 'file' && r.key === url);
    if (exact && await canWrite(exact.handle, ask)) return exact.handle;
    const dirs = recs.filter((r) => r.kind === 'dir' && url.startsWith(r.key)).sort((a, b) => b.key.length - a.key.length);
    for (const r of dirs) {
      if (!(await canWrite(r.handle, ask))) continue;
      try { return await walk(r.handle, url.slice(r.key.length).split('/').map(decodeURIComponent)); } catch (e) { /* ya no está ahí */ }
    }
    return null;
  }

  // Dada una carpeta elegida, encuentra en ella el archivo abierto probando cuántos niveles hay entre las dos.
  async function findInFolder(dir) {
    const url = hereUrl();
    const segs = url.split('/');
    let weak = null;
    for (let k = 1; k <= Math.min(14, segs.length - 3); k++) {
      const parts = segs.slice(-k).map(decodeURIComponent);
      try {
        const fh = await walk(dir, parts);
        const text = await (await fh.getFile()).text();
        const found = { handle: fh, base: segs.slice(0, -k).join('/') + '/' };
        if (text === diskText || text === raw) return found;
        if (!weak) weak = found;
      } catch (e) { /* no está a esa profundidad */ }
    }
    if (weak && window.confirm(T('En esa carpeta hay un archivo con el mismo nombre, pero su contenido no coincide con el que tenés abierto. ¿Guardar igual sobre ese archivo?'))) return weak;
    return null;
  }

  function askForAccess() {
    return new Promise((resolve) => {
      const name = DOC_NAME;
      const box = el('div', { class: 'lmd-ask' });
      box.innerHTML =
        '<div class="lmd-ask-card" role="dialog" aria-label="' + T('Permiso para guardar') + '">' +
          '<h3>' + T('Permiso para guardar') + '</h3>' +
          '<p>' + T('Chrome pide que elijas dónde puede escribir SharpMD. Elegí la carpeta de este archivo una sola vez y vas a poder guardar todo lo que haya adentro, sin que vuelva a preguntar.') + '</p>' +
          '<div class="lmd-ask-actions">' +
            '<button type="button" class="lmd-btn lmd-btn-fill" data-ask="dir">' + T('Elegir la carpeta') + '</button>' +
            '<button type="button" class="lmd-btn" data-ask="file">' + T('Solo este archivo') + '</button>' +
            '<button type="button" class="lmd-btn" data-ask="no">' + T('Cancelar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(box);
      const close = (value) => { box.remove(); resolve(value); };
      box.addEventListener('click', async (e) => {
        if (e.target === box) return close(null);
        const b = e.target.closest('[data-ask]'); if (!b) return;
        try {
          if (b.dataset.ask === 'no') return close(null);
          if (b.dataset.ask === 'dir') {
            const dir = await window.showDirectoryPicker({ id: 'lmd-carpeta', mode: 'readwrite' });
            const found = await findInFolder(dir);
            if (!found) { box.querySelector('p').textContent = T('Esa carpeta no contiene "{a}". Elegí la carpeta donde está el archivo, o una que la contenga.', { a: name }); return; }
            await handlesPut({ key: found.base, kind: 'dir', handle: dir });
            return close(found.handle);
          }
          const picked = await window.showOpenFilePicker({
            id: 'lmd-guardar', multiple: false,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.mkd', '.mdown'] } }],
          });
          const handle = picked[0];
          if (handle.name !== name && !window.confirm(T('Elegiste "{a}" y el documento abierto es "{b}". ¿Guardar igual sobre el archivo elegido?', { a: handle.name, b: name }))) return;
          await handlesPut({ key: hereUrl(), kind: 'file', handle });
          return close(handle);
        } catch (err) {
          if (!(err && err.name === 'AbortError')) box.querySelector('p').textContent = T('No se pudo obtener el permiso. Probá de nuevo.');
        }
      });
    });
  }

  // Una nota del navegador pasa a ser un archivo: se elige dónde, y desde ahí se trabaja sobre el archivo.
  async function saveNoteToDisk() {
    clearTimeout(autosaveTimer);
    if (!window.showSaveFilePicker) {
      const a = el('a', { download: DOC_NAME });
      a.href = URL.createObjectURL(new Blob([raw], { type: 'text/markdown' }));
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash(T('Se descargó una copia. La nota sigue guardada en este navegador'));
      return true;
    }
    try {
      const target = await window.showSaveFilePicker({ id: 'lmd-nuevo', suggestedName: DOC_NAME, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] });
      const w = await target.createWritable(); await w.write(raw); await w.close();
      await LMD.store.noteDelete(DOC_NAME);
      diskText = raw; dirty = false; updateSaveState();
      await LMD.home.adopt(homeCtx(), target);
      return true;
    } catch (e) {
      if (!(e && e.name === 'AbortError')) flash(T('No se pudo guardar'), 'error');
      return false;
    }
  }

  // Al volver la conexión, antes de subir se mira si la nota cambió en el servidor: se mezcla en vez de pisar.
  let stashed = null;
  async function catchUp(path) {
    let n = null;
    try { n = await LMD.cloud.read(path); } catch (e) { if (e.code !== 'not_found') throw e; }
    if (!n || n.text === diskText) return;
    const r = await LMD.cloud.settle(path, diskText, raw, n.text);
    diskText = n.text;
    if (r.text !== raw) { raw = r.text; syncSource(); render(); }
    dirty = raw !== diskText;
    offlineNote(r);
  }
  function offlineNote(r) {
    if (r.aside) flash(T('La nota cambió en la nube. Lo que escribiste sin conexión quedó en "{a}"', { a: r.aside }), 'warn');
    else if (r.merged) flash(T('Se sumaron los cambios de otra persona'));
  }

  async function save(interactive) {
    const focused = document.activeElement;
    if (focused && focused.blur && (focused.isContentEditable || focused.classList.contains('lmd-src'))) focused.blur();
    if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); dirty = raw !== diskText; }
    if (interactive && appRoot && appRoot.kind === 'local') return saveNoteToDisk();
    if (!dirty && fileHandle) { if (interactive) flash(T('Sin cambios para guardar')); return true; }
    try {
      if (!fileHandle) fileHandle = await storedHandle(interactive);
      if (!fileHandle) {
        if (!interactive) return false;
        if (appRoot && appRoot.id === 'mem' && window.showSaveFilePicker) {
          // Archivo nuevo: se elige dónde guardarlo y desde ahí pasa a ser un archivo común.
          const target = await window.showSaveFilePicker({ id: 'lmd-nuevo', suggestedName: DOC_NAME,
            types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] });
          const w = await target.createWritable(); await w.write(raw); await w.close();
          diskText = raw; dirty = false; updateSaveState();
          try { sessionStorage.removeItem('mdt-mem'); } catch (e) { /* sin sesión */ }
          await LMD.home.adopt(homeCtx(), target);
          return true;
        }
        if (!window.showOpenFilePicker) {
          const name = DOC_NAME || 'documento.md';
          const a = el('a', { download: name });
          a.href = URL.createObjectURL(new Blob([raw], { type: 'text/markdown' }));
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          flash(T('Este navegador no deja escribir el archivo: se descargó una copia'), 'warn');
          if (appRoot && appRoot.id === 'mem') {
            diskText = raw; dirty = false; updateSaveState();
            try { sessionStorage.setItem('mdt-mem', JSON.stringify({ name, text: raw })); } catch (e) { /* demasiado grande para la sesión */ }
          }
          return false;
        }
        fileHandle = await askForAccess();
        if (!fileHandle) return false;
      }
      if (appRoot && appRoot.kind === 'cloud') {
        const path = vParts(HERE).join('/');
        await LMD.cloud.stash(path, raw, diskText); stashed = raw;
        if (cloudState === 'error') { await catchUp(path); await LMD.cloud.stash(path, raw, diskText); stashed = raw; }
      }
      const writable = await fileHandle.createWritable();
      await writable.write(raw);
      await writable.close();
      cloudState = 'ok';
      diskText = raw; dirty = false; updateSaveState();
      if (interactive || !(appRoot && (appRoot.kind === 'local' || appRoot.kind === 'cloud'))) flash(T('Guardado'));
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) fileHandle = null;
      if (e && e.code === 'note_limit') flash(T('Llegaste al límite de notas del plan gratis. Esta no se guardó en la nube'), 'error');
      else if (e && e.code === 'offline') {
        // El aviso sale una vez; después se reintenta en silencio hasta que vuelva.
        if (cloudState !== 'error' || interactive) flash(T('Sin conexión. Se guarda cuando vuelva'), 'warn');
        cloudState = 'error'; updateSaveState(); clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => save(false), 8000);
      }
      else flash(T('No se pudo guardar'), 'error');
      return false;
    }
  }

  // ---------- Arranque de la página propia ----------
  let opened = null; // cómo se abrió la nota de la nube: del servidor, de la copia local, o mezclada
  async function appBoot() {
    const params = new URLSearchParams(location.search);
    if (params.has('new')) { LMD.home.create(homeCtx()); return false; }
    const f = params.get('f');
    if (!f) { LMD.home.show(homeCtx()); return false; }
    const id = f.split('/')[0];
    if (id === 'cloud') {
      await LMD.cloud.ready();
      appRoot = { id, kind: 'cloud', name: T('Nube') };
      const path = vParts(HERE).join('/'); let why = '';
      // Sin conexión se abre la copia guardada en este navegador, con lo que haya quedado sin subir.
      if (LMD.cloud.signedIn()) { try { opened = await LMD.cloud.open(path); } catch (e) { why = e && e.code; } }
      if (!opened) {
        appRoot = null;
        LMD.home.show(homeCtx(), T(!LMD.cloud.signedIn() ? 'Entrá a tu cuenta para abrir las notas de la nube.' : why === 'offline' ? 'Sin conexión, y "{a}" no tiene copia en este navegador.' : 'No se encontró "{a}".', { a: DOC_NAME }));
        return false;
      }
      raw = opened.text; diskText = opened.base; dirty = raw !== diskText;
      if (opened.offline) cloudState = 'error';
      readOnly = LMD.cloud.roleOf(path) === 'view';
      LMD.cloud.hold(path); LMD.cloud.flush();
      return true;
    }
    if (id === 'pub') {
      // Enlace público de solo lectura; si tiene contraseña, se pide.
      await LMD.cloud.ready();
      const token = vParts(HERE).join('/'); let password = '';
      for (let tries = 0; tries < 6; tries++) {
        try {
          const n = await LMD.cloud.publicNote(token, password);
          appRoot = { id, kind: 'pub', name: T('Compartido'), title: n.path.split('/').pop(), text: n.text };
          raw = n.text; diskText = n.text; readOnly = true;
          return true;
        } catch (e) {
          if (e.code === 'need_password' || e.code === 'bad_password') {
            password = window.prompt(T(e.code === 'bad_password' ? 'Esa contraseña no coincide. Probá de nuevo:' : 'Esta nota está protegida. Contraseña:')) || '';
            if (!password) break;
          } else { LMD.home.show(homeCtx(), T(e.code === 'locked' ? 'Demasiados intentos. Probá de nuevo en unos minutos.' : 'Ese enlace ya no existe.')); return false; }
        }
      }
      LMD.home.show(homeCtx());
      return false;
    }
    if (id === 'local') {
      // Nota guardada en el navegador.
      const note = await LMD.store.noteGet(DOC_NAME);
      if (!note) { LMD.home.show(homeCtx(), T('No se encontró "{a}".', { a: DOC_NAME })); return false; }
      appRoot = { id, kind: 'local', name: T('En este navegador') };
      raw = note.text; diskText = note.text;
      return true;
    }
    if (id === 'mem') {
      // Navegador sin acceso a archivos: el documento viaja en la sesión y se guarda descargando una copia.
      let mem = null;
      try { mem = JSON.parse(sessionStorage.getItem('mdt-mem') || 'null'); } catch (e) { /* sesión vacía */ }
      if (!mem || mem.name !== DOC_NAME) { LMD.home.show(homeCtx()); return false; }
      appRoot = { id, kind: 'file', name: mem.name, handle: { kind: 'file', name: mem.name, getFile: async () => ({ text: async () => mem.text, lastModified: 0, size: mem.text.length }) } };
      // disk es lo último que quedó guardado; un archivo nuevo todavía no tiene nada en el disco.
      raw = mem.text; diskText = mem.disk != null ? mem.disk : mem.text;
      dirty = raw !== diskText;
      return true;
    }
    const rec = (await handlesAll()).find((r) => r.root && r.id === id);
    if (!rec) { LMD.home.show(homeCtx(), T('Ese acceso ya no está guardado. Abrí el archivo o la carpeta de nuevo.')); return false; }
    const mode = rec.kind === 'dir' ? 'readwrite' : 'read';
    let ok = false;
    try { ok = (await rec.handle.queryPermission({ mode })) === 'granted'; } catch (e) { /* se pide abajo */ }
    if (!ok && !(await LMD.home.gate(homeCtx(), rec, mode))) { LMD.home.show(homeCtx()); return false; }
    appRoot = rec;
    const text = await vText(HERE);
    if (text == null) { LMD.home.show(homeCtx(), T('No se encontró "{a}".', { a: DOC_NAME })); return false; }
    raw = text; diskText = text;
    rec.last = f; rec.at = Date.now(); handlesPut(rec);
    return true;
  }

  // ---------- Arranque ----------
  const RENDER_KEYS = ['plugins', 'theme', 'diagramShape'];
  const TREE_KEYS = ['filesOnlyMarkdown', 'filesShowHidden'];

  LMD.load().then(async (s) => {
    settings = s;
    LMD.setLang(settings.language);
    if (APP) { if (!(await appBoot())) return; }
    buildUI();
    applySettings();
    render();
    try { const t = sessionStorage.getItem('lmd-panel'); if (t) { sessionStorage.removeItem('lmd-panel'); openPanel(t); } } catch (e) {}
    // Vuelta de la página de pago: Ajustes en Plan, esperando que el servidor confirme.
    if (APP && location.hash === '#lmd-paid') { openPanel('plan'); LMD.sync.awaitPaid(); }
    updateSaveState();
    checkUpdate(false);
    // Nota de la nube: se escucha en vivo quién más está y cuándo alguien guarda.
    if (appRoot && appRoot.kind === 'cloud') {
      if (opened.offline) flash(T('Sin conexión. Esta es la copia guardada en este navegador'), 'warn'); else offlineNote(opened);
      if (dirty) markDirty(); // lo que quedó sin subir sale ahora, o apenas vuelva la conexión
      LMD.cloud.events(vParts(HERE).join('/'), (ev) => {
        present = ev.who || [];
        if (ev.type === 'saved' && ev.by !== LMD.cloud.email()) { cloudPoll = 0; checkForChanges(false); }
        LMD.sync.paint();
      });
    }
    // Un archivo recién creado, o uno vacío, arranca listo para escribir. Si la pestaña venía en
    // edición, vuelve en edición. Lo de solo lectura y lo que no es Markdown abre leyendo.
    const fresh = APP && new URLSearchParams(location.search).has('edit');
    if (fresh) history.replaceState(null, '', location.href.replace(/[?&]edit=1/, ''));
    const blankDoc = !raw.trim();
    if (fresh || (!readOnly && docKind() === 'md' && (blankDoc || editRemembered()))) {
      // Con Ajustes abiertos (vuelta de un cambio de idioma o de un pago) el menú de insertar no se ofrece: quedaría encima.
      setEditMode(true).then(() => { const add = (fresh || blankDoc) && ui.panel.hidden && ui.article.querySelector('.lmd-add'); if (add) add.click(); });
    }
    const fromSearch = /^#lmd-q=([^&]+)(?:&r=(.+))?$/.exec(location.hash);
    if (fromSearch) {
      // Se llegó desde un resultado de búsqueda en la carpeta: se repite la búsqueda acá.
      history.replaceState(null, '', location.href.split('#')[0]);
      if (fromSearch[2]) {
        const root = decodeURIComponent(fromSearch[2]);
        if (HERE.startsWith(root) && root !== treeRoot) {
          treeRoot = root; // se conserva la carpeta donde se buscó
          if (ui.paneFiles.dataset.loaded) loadTree();
        }
      }
      ui.searchInput.value = decodeURIComponent(fromSearch[1]);
      runSearch(ui.searchInput.value, true);
    } else if (location.hash) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) t.scrollIntoView();
    } else restorePosition();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const prev = settings;
      settings = LMD.merge(changes.settings.newValue);
      if (settings.language !== prev.language) { if (!ui.panel.hidden) { try { sessionStorage.setItem('lmd-panel', panelTab); } catch (e) {} } location.reload(); return; }
      applySettings();
      // Cambió el servidor, o se prendió o apagó la nube: la cuenta y el ícono se vuelven a leer.
      if ((settings.cloudUrl || '') !== (prev.cloudUrl || '')) { LMD.cloud.reset(); LMD.cloud.ready().then(() => LMD.sync.paint()); panelStale = true; }
      if (panelStale && !ui.panel.hidden) { panelStale = false; openPanel(); }
      if (RENDER_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(settings[k]))) render();
      if (TREE_KEYS.some((k) => prev[k] !== settings[k]) && ui.paneFiles.dataset.loaded) loadTree();
    });
  });
})();
