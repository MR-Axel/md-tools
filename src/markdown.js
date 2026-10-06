// Markdown -> HTML: el parser con sus plugins, los links [[wiki]], la matemática y la cabecera YAML.
(function () {
  'use strict';

  const { esc } = LMD.kit;
  const T = LMD.t;

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
    md.renderer.rules.lmd_math_block = (tokens, i) => '<div class="lmd-math lmd-math-block"' + (tokens[i].attrGet('data-l') ? ' data-l="' + tokens[i].attrGet('data-l') + '"' : '') + ' data-tex="' + esc(tokens[i].content) + '"></div>\n';
  }

  const CONTAINERS = { tip: 'Consejo', info: 'Información', note: 'Nota', warning: 'Advertencia', danger: 'Peligro', details: 'Detalles' };
  const ALERTS = { NOTE: 'Nota', TIP: 'Consejo', IMPORTANT: 'Importante', WARNING: 'Advertencia', CAUTION: 'Precaución' };

  function buildParser(p) {
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
            const at = t.nesting === 1 && t.attrGet('data-l') ? ' data-l="' + t.attrGet('data-l') + '"' : '';
            if (name === 'details') return t.nesting === 1 ? '<details class="lmd-box"' + at + '><summary>' + title + '</summary>\n' : '</details>\n';
            return t.nesting === 1 ? '<div class="lmd-box lmd-box-' + name + '"' + at + '><p class="lmd-box-title">' + title + '</p>\n' : '</div>\n';
          },
        });
      });
    }
    if (p.wikilinks) md.use(wikiPlugin);
    if (p.katex) md.use(mathPlugin);

    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const info = (tokens[idx].info || '').trim().split(/\s+/)[0].toLowerCase();
      const at = tokens[idx].attrGet('data-l') ? ' data-l="' + tokens[idx].attrGet('data-l') + '"' : '';
      if (p.mermaid && info === 'mermaid') return '<pre class="lmd-mermaid"' + at + '>' + esc(tokens[idx].content) + '</pre>\n';
      if (p.graphviz && (info === 'dot' || info === 'graphviz')) return '<pre class="lmd-graphviz"' + at + '>' + esc(tokens[idx].content) + '</pre>\n';
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
        if (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block' || t.type === 'hr' || t.type === 'lmd_math_block') t.attrSet('data-l', t.map[0] + '-' + t.map[1]);
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

  LMD.md = { buildParser, slugify, splitFrontmatter, CONTAINERS, ALERTS };
})();
