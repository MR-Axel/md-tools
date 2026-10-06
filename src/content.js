// MD Tools: reemplaza la vista de texto plano de un archivo Markdown por un lector completo.
(function () {
  'use strict';

  // ---------- ¿Es un documento de texto plano? ----------
  const type = (document.contentType || '').toLowerCase();
  if (type && !/^text\/(plain|markdown|x-markdown)/.test(type)) return;
  const pre = document.body && document.body.querySelector('pre');
  if (!pre || document.body.children.length > 2) return;

  let raw = pre.textContent;
  let settings = null;
  let rawMode = false;
  let refreshTimer = null;
  let spyHeadings = [];
  let searchHits = [];
  let searchIndex = -1;
  const lazyLoaded = {};
  const isFile = location.protocol === 'file:';

  const ICON = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
    outline: '<svg viewBox="0 0 24 24"><path d="M5 7h14M8 12h11M11 17h8"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
    side: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>',
    md: '<svg viewBox="0 0 24 24"><path d="M4 17V7l4 5 4-5v10M16 7v9m-3-3 3 3 3-3"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17h-11z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7.5 8.5v-5h9v5"/><rect x="3.5" y="8.5" width="17" height="8" rx="1.5"/><path d="M7.5 14h9v6.5h-9z"/></svg>',
    rich: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/><path d="m11.6 17 2.4-6 2.4 6M12.4 15.2h3.2"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 8 3 3"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M5 4.5h11l3.5 3.5v11.5h-14.5z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  const el = (tag, attrs, html) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  };
  const T = (text, vars) => LMD.t(text, vars);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Si la extensión se recargó o se actualizó, esta pestaña queda desconectada de ella: no puede
  // releer el archivo ni la carpeta. Se detecta y se avisa, en vez de fallar en silencio.
  let orphan = false;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  function markOrphan() {
    if (orphan) return;
    orphan = true;
    clearInterval(refreshTimer);
    const bar = el('div', { class: 'lmd-orphan', role: 'alert' });
    bar.appendChild(el('span', { text: 'MD Tools se actualizó. Recargá esta pestaña para seguir. · MD Tools was updated. Reload this tab to continue.' }));
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
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- Markdown ----------
  function wikiPlugin(md) {
    md.inline.ruler.before('link', 'lmd_wiki', (state, silent) => {
      const src = state.src; const pos = state.pos;
      if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x5B) return false;
      const end = src.indexOf(']]', pos + 2);
      if (end === -1) return false;
      const inner = src.slice(pos + 2, end);
      if (!inner.trim() || /[\[\]\n]/.test(inner) || /^toc$/i.test(inner.trim())) return false;
      if (!silent) {
        const parts = inner.split('|');
        const t = state.push('lmd_wiki', 'a', 0);
        t.meta = { target: parts[0].trim(), label: (parts[1] || parts[0]).trim() };
      }
      state.pos = end + 2;
      return true;
    });
    md.renderer.rules.lmd_wiki = (tokens, i) =>
      '<a class="lmd-wiki" data-wiki="' + esc(tokens[i].meta.target) + '">' + esc(tokens[i].meta.label) + '</a>';
  }

  function mathPlugin(md) {
    md.inline.ruler.after('escape', 'lmd_math_inline', (state, silent) => {
      const src = state.src; const start = state.pos;
      if (src.charCodeAt(start) !== 0x24) return false;
      if (src.charCodeAt(start + 1) === 0x24) return false;
      const next = src[start + 1];
      if (!next || /\s/.test(next)) return false;
      let end = start + 1;
      while ((end = src.indexOf('$', end)) !== -1) {
        if (src[end - 1] === '\\') { end++; continue; }
        break;
      }
      if (end === -1) return false;
      if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || '')) return false;
      if (!silent) {
        const t = state.push('lmd_math_inline', 'span', 0);
        t.content = src.slice(start + 1, end);
      }
      state.pos = end + 1;
      return true;
    });
    md.block.ruler.before('fence', 'lmd_math_block', (state, startLine, endLine, silent) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (state.src.slice(pos, pos + 2) !== '$$') return false;
      if (silent) return true;
      let first = state.src.slice(pos + 2, max);
      let line = startLine; let found = false; const parts = [];
      if (first.trim().endsWith('$$')) {
        parts.push(first.trim().slice(0, -2)); found = true;
      } else {
        if (first.trim()) parts.push(first);
        for (line = startLine + 1; line < endLine; line++) {
          const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
          if (l.trim().endsWith('$$')) { const rest = l.trim().slice(0, -2); if (rest) parts.push(rest); found = true; break; }
          parts.push(l);
        }
      }
      if (!found) return false;
      state.line = line + 1;
      const t = state.push('lmd_math_block', 'div', 0);
      t.block = true; t.content = parts.join('\n'); t.map = [startLine, state.line];
      return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.lmd_math_inline = (tokens, i) => '<span class="lmd-math" data-tex="' + esc(tokens[i].content) + '"></span>';
    md.renderer.rules.lmd_math_block = (tokens, i) => '<div class="lmd-math lmd-math-block" data-tex="' + esc(tokens[i].content) + '"></div>\n';
  }

  function buildParser() {
    const p = settings.plugins;
    const md = window.markdownit({
      html: !!p.html,
      linkify: !!p.linkify,
      typographer: !!p.typographer,
      breaks: !!p.breaks,
      highlight: (str, lang) => {
        if (p.highlight && lang && window.hljs && hljs.getLanguage(lang)) {
          try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch (e) { /* cae al escape */ }
        }
        return '';
      },
    });
    const use = (flag, plugin) => { if (flag && plugin) md.use(plugin); };
    const emoji = window.markdownitEmoji;
    use(p.emoji, emoji && (emoji.full || emoji));
    use(p.sub, window.markdownitSub);
    use(p.sup, window.markdownitSup);
    use(p.ins, window.markdownitIns);
    use(p.mark, window.markdownitMark);
    use(p.abbr, window.markdownitAbbr);
    use(p.deflist, window.markdownitDeflist);
    use(p.footnote, window.markdownitFootnote);
    if (p.tables && window.markdownitMultimdTable) {
      md.use(window.markdownitMultimdTable, { multiline: true, rowspan: true, headerless: true });
    }
    if (p.containers && window.markdownitContainer) {
      Object.keys(CONTAINERS).forEach((name) => {
        md.use(window.markdownitContainer, name, {
          render: (tokens, idx) => {
            const t = tokens[idx];
            const title = md.utils.escapeHtml(t.info.trim().slice(name.length).trim() || T(CONTAINERS[name]));
            if (name === 'details') return t.nesting === 1 ? '<details class="lmd-box"><summary>' + title + '</summary>\n' : '</details>\n';
            return t.nesting === 1 ? '<div class="lmd-box lmd-box-' + name + '"><p class="lmd-box-title">' + title + '</p>\n' : '</div>\n';
          },
        });
      });
    }
    if (p.wikilinks) md.use(wikiPlugin);
    if (p.katex) md.use(mathPlugin);

    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const info = (tokens[idx].info || '').trim().split(/\s+/)[0].toLowerCase();
      if (p.mermaid && info === 'mermaid') return '<pre class="lmd-mermaid">' + esc(tokens[idx].content) + '</pre>\n';
      if (p.graphviz && (info === 'dot' || info === 'graphviz')) return '<pre class="lmd-graphviz">' + esc(tokens[idx].content) + '</pre>\n';
      return fence(tokens, idx, options, env, self);
    };
    // Cada bloque guarda de qué líneas del fuente salió (data-l). En las listas compactas el
    // párrafo no se dibuja, así que su rango va al <li> como data-p.
    md.core.ruler.push('lmd_lines', (state) => {
      const tokens = state.tokens;
      tokens.forEach((t, i) => {
        if (!t.map || !t.block) return;
        if (t.type === 'paragraph_open' && t.hidden) {
          for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].type === 'list_item_open') { tokens[j].attrSet('data-p', t.map[0] + '-' + t.map[1]); break; }
            if (tokens[j].nesting !== 0) break;
          }
          return;
        }
        if (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block') t.attrSet('data-l', t.map[0] + '-' + t.map[1]);
      });
    });
    return md;
  }

  function slugify(text, used) {
    let base = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'seccion';
    let slug = base; let n = 1;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    return slug;
  }

  const CONTAINERS = { tip: 'Consejo', info: 'Información', note: 'Nota', warning: 'Advertencia', danger: 'Peligro', details: 'Detalles' };
  const ALERTS = { NOTE: 'Nota', TIP: 'Consejo', IMPORTANT: 'Importante', WARNING: 'Advertencia', CAUTION: 'Precaución' };

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
        const box = el('input', { type: 'checkbox', disabled: '', class: 'lmd-task' });
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
    lazyLoaded[what] = bg({ type: 'lazyLoad', what }).then((r) => !!(r && r.ok));
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
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
    for (const n of nodes) {
      const code = n.textContent;
      try {
        const out = await mermaid.render('lmd-mermaid-' + (++mermaidSeq), code);
        const box = el('div', { class: 'lmd-diagram' });
        box.innerHTML = out.svg;
        box.dataset.code = code;
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
    const dir = new URL('.', location.href.split('#')[0].split('?')[0]).href;
    if (!wikiIndex || wikiIndex.dir !== dir) {
      const files = await collectFiles(dir);
      const map = new Map();
      (files || []).forEach((f) => { const k = wikiKey(f.rel.split('/').pop()); if (!map.has(k)) map.set(k, f.url); });
      wikiIndex = { dir, map };
    }
    links.forEach((a) => {
      const parts = a.getAttribute('data-wiki').split('#');
      const url = wikiIndex.map.get(wikiKey(parts[0].split('/').pop()));
      if (url) { a.href = url + (parts[1] ? '#' + slugify(parts[1], new Set()) : ''); a.title = decodeURIComponent(url.split('/').pop()); }
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
        box.appendChild(svg);
        n.replaceWith(box);
      } catch (e) {
        n.classList.add('lmd-mermaid-error');
        n.title = String(e && e.message || e);
      }
    }
  }

  // Cabecera YAML (--- ... ---) al inicio del archivo: se saca del cuerpo y se muestra como ficha.
  function splitFrontmatter(text) {
    const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    if (!m) return { body: text, rows: null };
    const rows = [];
    m[1].split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
      if (kv && !/^\s/.test(line)) rows.push([kv[1], kv[2]]);
      else if (rows.length) rows[rows.length - 1][1] += (rows[rows.length - 1][1] ? '\n' : '') + line.trim();
      else rows.push(['', line.trim()]);
    });
    return { body: text.slice(m[0].length), rows };
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
  const posKey = () => location.href.split('#')[0];
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
    // Ícono de la pestaña: el de MD Tools, para que no quede el genérico ni el de otra extensión.
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
          '<button class="lmd-tab" data-tab="files" title="' + T('Carpeta') + '" role="tab">' + ICON.folder + '</button>' +
          '<button class="lmd-tab" data-tab="outline" title="' + T('Índice') + '" role="tab">' + ICON.outline + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="lmd-search">' +
        '<span class="lmd-search-ico">' + ICON.search + '</span>' +
        '<input type="search" spellcheck="false">' +
        '<span class="lmd-search-count"></span>' +
      '</div>' +
      '<div class="lmd-pane lmd-pane-files" data-pane="files"><div class="lmd-tree-box"></div><div class="lmd-results" hidden></div></div>' +
      '<div class="lmd-pane lmd-pane-outline" data-pane="outline"></div>' +
      '<a class="lmd-side-foot" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer"><span class="lmd-heart">♥</span>' + T('Invitame un café') + '</a>' +
      '<div class="lmd-resizer" title="' + T('Arrastrar para cambiar el ancho') + '"></div>';

    ui.main = el('main', { class: 'lmd-main' });
    ui.main.innerHTML =
      '<div class="lmd-topbar">' +
        '<button class="lmd-icon-btn" data-act="sidebar" title="Barra lateral (Alt+Shift+B)">' + ICON.side + '</button>' +
        '<span class="lmd-status"></span>' +
        '<span class="lmd-count" title="' + T('Palabras y caracteres') + '"></span>' +
        '<div class="lmd-tools">' +
          '<div class="lmd-modeseg" role="radiogroup" aria-label="' + T('Modo') + '">' +
            '<button type="button" role="radio" data-act="mode-read" aria-checked="true" class="lmd-on">' + ICON.eye + '<span>' + T('Ver') + '</span></button>' +
            '<button type="button" role="radio" data-act="mode-edit" aria-checked="false">' + ICON.pencil + '<span>' + T('Editar') + '</span></button>' +
          '</div>' +
          '<button class="lmd-icon-btn lmd-save" data-act="save" title="' + T('Guardar (Ctrl+S)') + '" hidden>' + ICON.save + '</button>' +
          '<span class="lmd-sep"></span>' +
          '<div class="lmd-view" role="radiogroup" aria-label="' + T('Vista') + '">' +
            '<button type="button" role="radio" data-act="view-doc" class="lmd-on" aria-checked="true" title="' + T('Ver documento') + '">' + ICON.doc + '</button>' +
            '<button type="button" role="radio" data-act="view-raw" aria-checked="false" title="' + T('Ver código fuente') + '">' + ICON.code + '</button>' +
          '</div>' +
          '<span class="lmd-sep"></span>' +
          '<button class="lmd-icon-btn" data-act="copy-md" title="' + T('Copiar Markdown') + '">' + ICON.copy + '</button>' +
          '<button class="lmd-icon-btn" data-act="copy-rich" title="' + T('Copiar con formato (la selección, o todo el documento)') + '">' + ICON.rich + '</button>' +
          '<button class="lmd-icon-btn" data-act="reload" title="' + T('Recargar ahora') + '">' + ICON.reload + '</button>' +
          '<button class="lmd-icon-btn" data-act="print" title="' + T('Imprimir o guardar PDF') + '">' + ICON.print + '</button>' +
          '<span class="lmd-sep"></span>' +
          '<button class="lmd-icon-btn" data-act="settings" title="' + T('Ajustes') + '">' + ICON.sliders + '</button>' +
        '</div>' +
      '</div>' +
      '<article class="lmd-article markdown-body"></article>' +
      '<pre class="lmd-raw" hidden></pre>' +
      '<textarea class="lmd-raw lmd-raw-edit" spellcheck="false" hidden></textarea>';

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
      '<button type="button" data-top="col-">− ' + T('Columna') + '</button>');

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
    ui.searchInput = ui.searchBox.querySelector('input');
    ui.searchCount = ui.searchBox.querySelector('.lmd-search-count');

    document.title = decodeURIComponent(location.pathname.split('/').pop() || 'Markdown');
    bindEvents();
    bindEditing();
    document.documentElement.dataset.lmdFs = String(!!window.showOpenFilePicker && window.isSecureContext);
  }

  function bindEvents() {
    document.body.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (actEl) { onAction(actEl.dataset.act, actEl); return; }
      const tab = e.target.closest('.lmd-tab');
      if (tab) { LMD.patch({ sidebarTab: tab.dataset.tab }); return; }
      const img = e.target.closest('img.lmd-zoomable');
      if (img && !img.closest('a')) { openViewer(img); return; }
      const res = e.target.closest('.lmd-results a');
      if (res && res.href.split('#')[0] === location.href.split('#')[0]) { e.preventDefault(); stepSearch(1); return; }
      const a = e.target.closest('.lmd-article a[href^="#"], .lmd-pane-outline a');
      if (a) {
        const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', '#' + target.id); }
      }
    });

    ui.toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    ui.viewer.addEventListener('click', () => { ui.viewer.hidden = true; ui.viewer.textContent = ''; });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', savePosition, { passive: true });
    document.addEventListener('selectionchange', debounce(updateCount, 80));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!ui.viewer.hidden) ui.viewer.click();
        else if (!ui.panel.hidden) ui.panel.hidden = true;
        else if (ui.searchInput.value || document.activeElement === ui.searchInput) toggleSearch(false);
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's' && (editMode || dirty)) { e.preventDefault(); save(true); }
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
    else if (act === 'view-doc') { rawMode = false; applyRawMode(); }
    else if (act === 'view-raw') { rawMode = true; applyRawMode(); }
    else if (act === 'settings') openPanel();
    else if (act === 'copy-md') copyText(raw, source);
    else if (act === 'copy-rich') copyRich(source);
    else if (act === 'reload') { if (orphan || !alive()) location.reload(); else checkForChanges(true); }
    else if (act === 'print') window.print();
    else if (act === 'close-panel') ui.panel.hidden = true;
    else if (act === 'reset') { panelStale = true; LMD.save(LMD.merge({ supporter: settings.supporter })); }
    else if (act === 'supporter') { panelStale = true; LMD.patch({ supporter: true }); flash(T('Gracias por apoyar el proyecto.')); }
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

  function isDark() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function applyAccent(root, dark) {
    const hex = settings.supporter && /^#[0-9a-f]{6}$/i.test(settings.accent || '') ? settings.accent : '';
    const props = ['--accent', '--accent-soft', '--accent-fg', '--accent-fill'];
    if (!hex) { props.forEach((p) => root.style.removeProperty(p)); return; }
    const lum = luminance(hex);
    // El relleno usa el color tal cual; el texto se corrige si no contrasta con el fondo del tema.
    let text = hex;
    if (dark && lum < 0.18) text = 'color-mix(in srgb, ' + hex + ' 62%, #fff)';
    if (!dark && lum > 0.32) text = 'color-mix(in srgb, ' + hex + ' 68%, #000)';
    root.style.setProperty('--accent', text);
    root.style.setProperty('--accent-fill', hex);
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + hex + ' 17%, transparent)');
    root.style.setProperty('--accent-fg', lum > 0.36 ? '#14161a' : '#ffffff');
  }

  let lastTab = null;
  function applySettings() {
    const root = document.documentElement;
    const dark = isDark();
    root.classList.toggle('lmd-dark', dark);
    root.classList.toggle('lmd-light', !dark);
    root.classList.toggle('lmd-centered', !!settings.centered);
    root.classList.toggle('lmd-wrap', !!settings.wrapCode);
    root.classList.toggle('lmd-side-hidden', !!settings.sidebarHidden);
    root.style.setProperty('--lmd-content-w', settings.contentWidth + 'px');
    root.style.setProperty('--lmd-font-size', settings.fontSize + 'px');
    root.style.setProperty('--lmd-line-height', String(settings.lineHeight));
    root.style.setProperty('--lmd-side-w', settings.sidebarWidth + 'px');
    if (settings.supporter && settings.fontFamily && settings.fontFamily.trim()) root.style.setProperty('--lmd-font', settings.fontFamily);
    else root.style.removeProperty('--lmd-font');
    applyAccent(root, dark);
    ui.customStyle.textContent = settings.supporter ? (settings.customCSS || '') : '';
    const foot = ui.sidebar.querySelector('.lmd-side-foot');
    if (foot) foot.lastChild.nodeValue = T(settings.supporter ? 'Gracias por apoyar' : 'Invitame un café');

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
  function render() {
    const md = buildParser();
    const fm = settings.plugins.frontmatter ? splitFrontmatter(raw) : { body: raw, rows: null };
    syncSource();
    fmOffset = raw.slice(0, raw.length - fm.body.length).split('\n').length - 1;
    needsRender = false;
    let html = md.render(fm.body);
    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
    const y = window.scrollY;
    ui.article.innerHTML = html;
    spyHeadings = postProcess(ui.article);
    if (editMode) enableEditing(ui.article);
    if (fm.rows && fm.rows.length) ui.article.insertBefore(frontmatterNode(fm.rows), ui.article.firstChild);
    buildOutline(spyHeadings);
    if (rawMode) { ui.rawPre.textContent = raw; if (document.activeElement !== ui.rawEdit) ui.rawEdit.value = raw; }
    window.scrollTo(0, y);
    onScroll();
    updateCount();
    if (!ui.searchBox.hidden && ui.searchInput.value) runSearch(ui.searchInput.value);
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

  async function readCurrent() {
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
      if (text == null) {
        if (manual) flash(T('No se pudo releer el archivo. Recargá la pestaña con F5'), 'error');
      } else if (text !== diskText) {
        diskText = text;
        if (dirty) flash(T('El archivo cambió en el disco. Tus cambios sin guardar se mantienen'), 'warn');
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
  const MD_RE = /\.(md|mdx|mkd|mdown|markdown)$/i;

  async function listDir(dirUrl, all) {
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
    if (all) return rows;
    return rows
      .filter((x) => settings.filesShowHidden || !x.name.startsWith('.'))
      .filter((x) => x.dir || !settings.filesOnlyMarkdown || MD_RE.test(x.name))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  let treeRoot = new URL('.', location.href.split('#')[0].split('?')[0]).href;

  async function loadTree() {
    ui.paneFiles.dataset.loaded = '1';
    ui.treeBox.textContent = '';
    const head = el('div', { class: 'lmd-tree-head' });
    const upBtn = el('button', { class: 'lmd-tree-up', title: T('Subir a la carpeta superior'), type: 'button' }, ICON.up);
    const label = el('span', { class: 'lmd-tree-path', text: decodeURIComponent(treeRoot.replace(/\/$/, '').split('/').pop() || treeRoot), title: decodeURIComponent(treeRoot) });
    head.append(upBtn, label);
    upBtn.addEventListener('click', () => {
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
    const here = location.href.split('#')[0].split('?')[0];
    rows.forEach((row) => {
      const item = el(row.dir ? 'button' : 'a', { class: 'lmd-node' + (row.dir ? ' lmd-node-dir' : ''), title: row.name });
      item.style.paddingLeft = (10 + depth * 14) + 'px';
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
        item.href = row.url;
        if (row.url === here) { item.classList.add('lmd-active'); setTimeout(() => item.scrollIntoView({ block: 'nearest' }), 0); }
      }
    });
  }

  // ---------- Búsqueda ----------
  // Con la pestaña Índice busca en este documento; con la pestaña Carpeta, en todos los Markdown de la carpeta.
  const FOLDER_MAX_FILES = 600;
  const FOLDER_MAX_DEPTH = 6;
  const SKIP_DIRS = /^(node_modules|\.git|dist|build|__pycache__)$/i;
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
    const r = await bg({ type: 'fetchText', url });
    const text = r && r.ok ? r.text : '';
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
    const here = location.href.split('#')[0].split('?')[0];
    const summary = found.length
      ? T((total === 1 ? '{t} coincidencia' : '{t} coincidencias') + (found.length === 1 ? ' en {f} archivo (de {n})' : ' en {f} archivos (de {n})'), { t: total, f: found.length, n: files.length })
      : T(files.length === 1 ? 'Sin coincidencias en {n} archivo' : 'Sin coincidencias en {n} archivos', { n: files.length });
    ui.results.appendChild(el('p', { class: 'lmd-results-sum', text: summary + (files.length >= FOLDER_MAX_FILES ? T('. Se revisaron los primeros {n}.', { n: FOLDER_MAX_FILES }) : '') }));
    ui.searchCount.textContent = String(total);
    const frag = '#lmd-q=' + encodeURIComponent(q) + '&r=' + encodeURIComponent(treeRoot);
    found.forEach((r) => {
      const group = el('div', { class: 'lmd-res' + (r.file.url === here ? ' lmd-res-here' : '') });
      const head = el('a', { class: 'lmd-res-file', href: r.file.url + frag, title: r.file.rel });
      head.innerHTML = '<span class="lmd-node-ico">' + ICON.md + '</span><span class="lmd-res-name"></span><span class="lmd-res-count"></span>';
      head.querySelector('.lmd-res-name').textContent = r.file.rel;
      head.querySelector('.lmd-res-count').textContent = r.count;
      group.appendChild(head);
      r.hits.forEach((h) => {
        const start = Math.max(0, h.pos - 34);
        const cut = h.text.slice(start, h.pos + needle.length + 70);
        const rel = h.pos - start;
        const a = el('a', { class: 'lmd-res-hit', href: r.file.url + frag, title: T('Línea {n}', { n: h.line }) });
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

  // ---------- Panel de ajustes ----------
  let panelStale = false;
  function openPanel() {
    const s = settings;
    const EXTRA = ' <em class="lmd-tag">' + T('Extra') + '</em>';
    const plugins = Object.keys(LMD.PLUGIN_LABELS).map((k) =>
      '<label class="lmd-check"><input type="checkbox" data-plugin="' + k + '"' + (s.plugins[k] ? ' checked' : '') + '><span>' + esc(T(LMD.PLUGIN_LABELS[k])) + '</span></label>').join('');
    ui.panel.innerHTML =
      '<div class="lmd-panel-card" role="dialog" aria-label="' + T('Ajustes') + '">' +
        '<header><h2>' + T('Ajustes') + '</h2><button class="lmd-icon-btn" data-act="close-panel" title="' + T('Cerrar') + '">' + ICON.close + '</button></header>' +
        '<div class="lmd-panel-body">' +
          '<section><h3>' + T('Apariencia') + '</h3>' +
            '<div class="lmd-row"><span>' + T('Idioma') + '</span><div class="lmd-seg" data-seg="language" role="radiogroup">' +
              ['auto', 'es', 'en'].map((l) => '<button type="button" role="radio" data-val="' + l + '" aria-checked="' + (s.language === l) + '"' + (s.language === l ? ' class="lmd-on"' : '') + '>' + { auto: T('Automático'), es: 'Español', en: 'English' }[l] + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Tema') + '</span><div class="lmd-seg" data-seg="theme" role="radiogroup">' +
              ['auto', 'light', 'dark'].map((t) => '<button type="button" role="radio" data-val="' + t + '" aria-checked="' + (s.theme === t) + '"' + (s.theme === t ? ' class="lmd-on"' : '') + '>' + T({ auto: 'Automático', light: 'Claro', dark: 'Oscuro' }[t]) + '</button>').join('') +
            '</div></div>' +
            '<div class="lmd-row"><span>' + T('Color de acento') + (s.supporter ? '' : EXTRA) + '</span><div class="lmd-swatches' + (s.supporter ? '' : ' lmd-locked') + '">' +
              LMD.ACCENTS.map((a) => '<button type="button" class="lmd-swatch' + ((s.accent || '') === a.value ? ' lmd-on' : '') + (a.value ? '' : ' lmd-swatch-auto') + '" data-accent="' + a.value + '" title="' + esc(T(a.name)) + '" aria-label="' + esc(T(a.name)) + '"' + (a.value ? ' style="--sw:' + a.value + '"' : '') + '></button>').join('') +
              '<label class="lmd-swatch lmd-swatch-custom' + (s.accent && !LMD.ACCENTS.some((a) => a.value === s.accent) ? ' lmd-on' : '') + '" title="' + T('Otro color') + '"><input type="color" data-accent-custom value="' + (/^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6c7ee1') + '"></label>' +
            '</div>' + (s.supporter
              ? '<p class="lmd-hint">' + T('Gracias por apoyar el proyecto.') + '</p>'
              : '<div class="lmd-extra"><p>' + T('Los colores, la tipografía y el CSS propio son extras para quienes apoyan el proyecto. No se verifica: queda en tu palabra.') + '</p>' +
                '<div class="lmd-extra-actions"><a class="lmd-btn lmd-btn-fill" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">♥ ' + T('Apoyar el proyecto') + '</a>' +
                '<button type="button" class="lmd-btn" data-act="supporter">' + T('Ya aporté') + '</button></div></div>') +
            '</div>' +
            '<label class="lmd-check"><input type="checkbox" data-key="centered"' + (s.centered ? ' checked' : '') + '><span>' + T('Centrar el contenido') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="wrapCode"' + (s.wrapCode ? ' checked' : '') + '><span>' + T('Ajustar las líneas largas del código') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Ancho del contenido') + ' <output>' + s.contentWidth + ' px</output></span><input type="range" min="560" max="1800" step="20" data-key="contentWidth" data-unit=" px" value="' + s.contentWidth + '"></label>' +
            '<label class="lmd-row"><span>' + T('Tamaño de letra') + ' <output>' + s.fontSize + ' px</output></span><input type="range" min="12" max="24" step="1" data-key="fontSize" data-unit=" px" value="' + s.fontSize + '"></label>' +
            '<label class="lmd-row"><span>' + T('Interlineado') + ' <output>' + s.lineHeight + '</output></span><input type="range" min="1.2" max="2.2" step="0.05" data-key="lineHeight" data-unit="" value="' + s.lineHeight + '"></label>' +
            '<label class="lmd-row"><span>' + T('Tipografía') + (s.supporter ? '' : EXTRA) + '</span><input type="text" data-key="fontFamily"' + (s.supporter ? '' : ' disabled') + ' placeholder="' + T('Del sistema. Ej.: Georgia, serif') + '" value="' + esc(s.fontFamily) + '"></label>' +
          '</section>' +
          '<section><h3>' + T('Documento') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autoRefresh"' + (s.autoRefresh ? ' checked' : '') + '><span>' + T('Recargar solo cuando el archivo cambia') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Revisar cada') + ' <output>' + s.refreshInterval + ' ms</output></span><input type="range" min="300" max="5000" step="100" data-key="refreshInterval" data-unit=" ms" value="' + s.refreshInterval + '"></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="rememberPosition"' + (s.rememberPosition ? ' checked' : '') + '><span>' + T('Recordar por dónde iba en cada archivo') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="autosave"' + (s.autosave ? ' checked' : '') + '><span>' + T('Guardar solo mientras edito') + '</span></label>' +
            '<label class="lmd-row"><span>' + T('Guardar a los') + ' <output>' + s.autosaveDelay + ' ms</output></span><input type="range" min="1000" max="30000" step="500" data-key="autosaveDelay" data-unit=" ms" value="' + s.autosaveDelay + '"></label>' +
          '</section>' +
          '<section><h3>' + T('Carpeta') + '</h3>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesOnlyMarkdown"' + (s.filesOnlyMarkdown ? ' checked' : '') + '><span>' + T('Mostrar solo archivos Markdown') + '</span></label>' +
            '<label class="lmd-check"><input type="checkbox" data-key="filesShowHidden"' + (s.filesShowHidden ? ' checked' : '') + '><span>' + T('Mostrar archivos y carpetas ocultos') + '</span></label>' +
          '</section>' +
          '<section><h3>' + T('Plugins de Markdown') + '</h3><div class="lmd-grid">' + plugins + '</div></section>' +
          '<section><h3>' + T('CSS propio') + (s.supporter ? '' : EXTRA) + '</h3>' +
            '<textarea data-key="customCSS"' + (s.supporter ? '' : ' disabled') + ' spellcheck="false" placeholder=".markdown-body h1 { color: tomato; }">' + esc(s.customCSS) + '</textarea>' +
            '<p class="lmd-hint">' + T('Se aplica encima del tema. El documento vive dentro de .markdown-body.') + '</p>' +
          '</section>' +
          '<section class="lmd-panel-foot"><button type="button" class="lmd-btn" data-act="reset">' + T('Restablecer todo') + '</button></section>' +
          '<section class="lmd-support"><p class="lmd-hint">' + T('MD Tools es gratis y no junta datos. Si te sirve, podés apoyarlo.') + '</p>' +
            '<a class="lmd-btn lmd-btn-accent" href="' + LMD.SPONSOR_URL + '" target="_blank" rel="noopener noreferrer">♥ ' + T('Apoyar el proyecto') + '</a></section>' +
        '</div>' +
      '</div>';
    ui.panel.hidden = false;

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
    const markSwatch = (node) => ui.panel.querySelectorAll('.lmd-swatch').forEach((x) => x.classList.toggle('lmd-on', x === node));
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
        commit({ [key]: v });
      });
    });
    ui.panel.querySelectorAll('[data-plugin]').forEach((input) => {
      input.addEventListener('change', () => LMD.patch({ plugins: { [input.dataset.plugin]: input.checked } }));
    });
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
  const INLINE_OK = new Set(['STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'STRIKE', 'MARK', 'INS', 'SUB', 'SUP', 'CODE', 'BR', 'A', 'IMG', 'ABBR', 'INPUT', 'SPAN', 'U', 'FONT']);

  function syncSource() {
    eol = raw.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    srcLines = raw.split(/\r?\n/);
  }

  const rangeOf = (node, attr) => {
    const m = /^(\d+)-(\d+)$/.exec(node.getAttribute(attr || 'data-l') || '');
    return m ? [+m[1], +m[2]] : null;
  };

  const escText = (t) => t.replace(/\u00a0/g, ' ').replace(/([\\`*])/g, '\\$1').replace(/</g, '\\<');

  // HTML de un bloque editado -> Markdown en línea.
  function inlineMd(rootNode) {
    let out = '';
    rootNode.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += escText(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'INPUT' || n.classList.contains('lmd-anchor')) return;
      if (n.classList.contains('lmd-math')) { out += '$' + n.getAttribute('data-tex') + '$'; return; }
      if (n.classList.contains('lmd-wiki')) {
        const target = n.getAttribute('data-wiki'); const label = n.textContent;
        out += '[[' + (label && label !== target ? target + '|' + label : target) + ']]'; return;
      }
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'CODE') { out += '`' + n.textContent + '`'; return; }
      if (tag === 'IMG') { out += '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + ')'; return; }
      const inner = inlineMd(n);
      const wrap = (mark) => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner); return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner; };
      if (tag === 'STRONG' || tag === 'B') out += wrap('**');
      else if (tag === 'EM' || tag === 'I') out += wrap('*');
      else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') out += wrap('~~');
      else if (tag === 'MARK') out += wrap('==');
      else if (tag === 'INS' || tag === 'U') out += wrap('++');
      else if (tag === 'SUB') out += wrap('~');
      else if (tag === 'SUP') out += wrap('^');
      else if (tag === 'A') {
        const href = n.getAttribute('href') || ''; const text = n.textContent;
        out += (!href || href === text || href === 'mailto:' + text || href === 'http://' + text) ? escText(text) : '[' + inner + '](' + href + ')';
      } else out += inner;
    });
    return out;
  }

  // Un bloque se edita en el lugar solo si todo lo que tiene adentro se puede volver a escribir igual.
  function roundTrips(node) {
    for (const child of node.querySelectorAll('*')) {
      if (child.closest('.lmd-math') && !child.classList.contains('lmd-math')) continue;
      if (!INLINE_OK.has(child.tagName)) return false;
      if (child.classList.contains('footnote-ref') || child.closest('.footnote-ref')) return false;
      if (child.tagName === 'SPAN' && !child.classList.contains('lmd-math') && child.attributes.length) return false;
    }
    return true;
  }

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
  function replaceLines(s, e, newLines, owner, attr) {
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
    needsRender = true;
    updateSaveState();
    clearTimeout(autosaveTimer);
    if (dirty && settings.autosave) {
      if (fileHandle) autosaveTimer = setTimeout(() => save(false), Math.max(500, settings.autosaveDelay | 0));
      else flash(T('Guardá una vez con Ctrl+S para activar el guardado automático'), 'warn');
    }
  }

  function updateSaveState() {
    const root = document.documentElement;
    root.classList.toggle('lmd-dirty', dirty);
    root.classList.toggle('lmd-editing', editMode);
    ui.main.querySelectorAll('.lmd-modeseg button').forEach((b) => {
      const on = (b.dataset.act === 'mode-edit') === editMode;
      b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on));
    });
    ui.main.querySelector('[data-act=mode-read]').title = T(editMode ? 'Guardar y volver a solo lectura' : 'Estás viendo el documento');
    ui.main.querySelector('[data-act=mode-edit]').title = T(editMode ? 'Estás editando el documento' : 'Editar el documento');
    const save = ui.main.querySelector('[data-act=save]');
    save.hidden = !editMode && !dirty;
    save.title = dirty ? T('Guardar (Ctrl+S). Hay cambios sin guardar') : T('Guardar (Ctrl+S)');
  }

  function softRender() {
    clearTimeout(softTimer);
    softTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!needsRender || (a && (a.isContentEditable || a.classList.contains('lmd-src')))) return;
      render();
    }, 350);
  }

  async function setEditMode(on) {
    // Salir de edición guarda lo pendiente. Si se cancela el guardado, los cambios quedan sin guardar.
    if (!on && editMode) {
      const a = document.activeElement;
      if (a && a.blur && (a.isContentEditable || a.classList.contains('lmd-src'))) a.blur();
      if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.split('\r\n').join('\n').split('\n').join(eol); syncSource(); dirty = raw !== diskText; }
      if (dirty) await save(true);
    }
    editMode = on;
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
    article.querySelectorAll('input.lmd-task').forEach((box) => { box.disabled = false; box.contentEditable = 'false'; });

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
  const cellMd = (cell) => inlineMd(cell).replace(/\n+$/, '').replace(/\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim();

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

  function bindEditing() {
    ui.article.addEventListener('focusin', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (node) node._md = inlineMd(node);
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
      if (node._md == null || inlineMd(node) === node._md) return;
      if (node.classList.contains('lmd-cell')) commitCell(node);
      else { const b = blockSource(node); if (b) replaceLines(b.s, b.e, b.lines, node, 'data-l'); }
      node._md = null;
      softRender();
    });
    ui.article.addEventListener('keydown', (e) => {
      const node = e.target.closest && e.target.closest('.lmd-editable');
      if (!node) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); node.blur(); }
      else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
      else if (e.key === 'Escape') { e.preventDefault(); node._md = null; needsRender = true; node.blur(); render(); }
    });
    ui.article.addEventListener('paste', (e) => {
      if (!(e.target.closest && e.target.closest('.lmd-editable'))) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\r?\n/g, ' '));
    });
    ui.article.addEventListener('change', (e) => { if (editMode && e.target.matches && e.target.matches('input.lmd-task')) toggleTask(e.target); });
    ui.article.addEventListener('dblclick', (e) => {
      if (!editMode) return;
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
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------- Permiso para escribir ----------
  // Chrome no deja que una página escriba en el disco sin que la persona elija dónde. Para no
  // pedirlo en cada archivo, se pide una vez la CARPETA: con eso se guarda cualquier archivo de
  // adentro, y el permiso queda recordado para las próximas veces.
  const hereUrl = () => location.href.split('#')[0].split('?')[0];

  function handlesDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('lmd-permisos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function handlesAll() {
    try {
      const db = await handlesDb();
      return await new Promise((resolve, reject) => {
        const q = db.transaction('h').objectStore('h').getAll();
        q.onsuccess = () => resolve(q.result || []); q.onerror = () => reject(q.error);
      });
    } catch (e) { return []; }
  }
  async function handlesPut(rec) {
    try {
      const db = await handlesDb();
      await new Promise((resolve, reject) => {
        const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(rec);
        t.oncomplete = resolve; t.onerror = () => reject(t.error);
      });
      return true;
    } catch (e) { return false; }
  }

  async function canWrite(handle, ask) {
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      if (!ask) return false;
      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { return false; }
  }

  async function walk(dir, parts) {
    let cur = dir;
    for (let k = 0; k < parts.length - 1; k++) cur = await cur.getDirectoryHandle(parts[k]);
    return cur.getFileHandle(parts[parts.length - 1]);
  }

  // Busca un permiso ya dado que sirva para este archivo: el del archivo mismo o el de una carpeta que lo contenga.
  async function storedHandle(ask) {
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
      const name = decodeURIComponent(location.pathname.split('/').pop() || '');
      const box = el('div', { class: 'lmd-ask' });
      box.innerHTML =
        '<div class="lmd-ask-card" role="dialog" aria-label="' + T('Permiso para guardar') + '">' +
          '<h3>' + T('Permiso para guardar') + '</h3>' +
          '<p>' + T('Chrome pide que elijas dónde puede escribir MD Tools. Elegí la carpeta de este archivo una sola vez y vas a poder guardar todo lo que haya adentro, sin que vuelva a preguntar.') + '</p>' +
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

  async function save(interactive) {
    const focused = document.activeElement;
    if (focused && focused.blur && (focused.isContentEditable || focused.classList.contains('lmd-src'))) focused.blur();
    if (ui.rawEdit && !ui.rawEdit.hidden) { raw = ui.rawEdit.value.replace(/\r?\n/g, eol); syncSource(); dirty = raw !== diskText; }
    if (!dirty && fileHandle) { if (interactive) flash(T('Sin cambios para guardar')); return true; }
    try {
      if (!fileHandle) fileHandle = await storedHandle(interactive);
      if (!fileHandle) {
        if (!interactive) return false;
        if (!window.showOpenFilePicker) {
          const name = decodeURIComponent(location.pathname.split('/').pop() || 'documento.md');
          const a = el('a', { download: name });
          a.href = URL.createObjectURL(new Blob([raw], { type: 'text/markdown' }));
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          flash(T('Este navegador no deja escribir el archivo: se descargó una copia'), 'warn');
          return false;
        }
        fileHandle = await askForAccess();
        if (!fileHandle) return false;
      }
      const writable = await fileHandle.createWritable();
      await writable.write(raw);
      await writable.close();
      diskText = raw; dirty = false; updateSaveState();
      flash(T('Guardado'));
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) fileHandle = null;
      flash(T('No se pudo guardar'), 'error');
      return false;
    }
  }

  // ---------- Arranque ----------
  const RENDER_KEYS = ['plugins', 'theme'];
  const TREE_KEYS = ['filesOnlyMarkdown', 'filesShowHidden'];

  LMD.load().then((s) => {
    settings = s;
    LMD.setLang(settings.language);
    if (!settings.enabled) return;
    buildUI();
    applySettings();
    render();
    updateSaveState();
    const fromSearch = /^#lmd-q=([^&]+)(?:&r=(.+))?$/.exec(location.hash);
    if (fromSearch) {
      // Se llegó desde un resultado de búsqueda en la carpeta: se repite la búsqueda acá.
      history.replaceState(null, '', location.href.split('#')[0]);
      if (fromSearch[2]) {
        const root = decodeURIComponent(fromSearch[2]);
        if (location.href.startsWith(root) && root !== treeRoot) {
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
      if (settings.enabled !== prev.enabled || settings.language !== prev.language) { location.reload(); return; }
      applySettings();
      if (panelStale && !ui.panel.hidden) { panelStale = false; openPanel(); }
      if (RENDER_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(settings[k]))) render();
      if (TREE_KEYS.some((k) => prev[k] !== settings[k]) && ui.paneFiles.dataset.loaded) loadTree();
    });
  });
})();
