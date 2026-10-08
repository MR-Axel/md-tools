// Edición en el lugar: del HTML de un bloque editado al Markdown en línea.
(function () {
  'use strict';

  const INLINE_OK = new Set(['STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'STRIKE', 'MARK', 'INS', 'SUB', 'SUP', 'CODE', 'BR', 'A', 'IMG', 'ABBR', 'INPUT', 'SPAN', 'U', 'FONT']);
  const escText = (t) => t.replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/([\\`*])/g, '\\$1').replace(/</g, '\\<');

  // Un destino interno (otro archivo, una sección) se escribe con sus acentos, no con %C3%B3: así se lee en cualquier lado.
  const niceHref = (href) => (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href) ? href
    : href.replace(/(?:%[89A-F][0-9A-F])+/gi, (m) => { try { const t = decodeURIComponent(m); return /[\s\u0000-\u001f]/.test(t) ? m : t; } catch (e) { return m; } }));

  // HTML de un bloque editado -> Markdown en línea.
  function inlineMd(rootNode) {
    let out = '';
    rootNode.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += escText(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === 'INPUT' || n.classList.contains('lmd-anchor') || n.classList.contains('lmd-hnum')) return;
      if (n.classList.contains('lmd-math')) { out += '$' + n.getAttribute('data-tex') + '$'; return; }
      if (n.classList.contains('lmd-wiki')) {
        const target = n.getAttribute('data-wiki'); const label = n.textContent;
        out += '[[' + (label && label !== target ? target + '|' + label : target) + ']]'; return;
      }
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'CODE') { out += '`' + n.textContent + '`'; return; }
      if (tag === 'IMG') { out += '![' + (n.getAttribute('alt') || '') + (n.dataset.lmdW ? '|' + n.dataset.lmdW : '') + '](' + (n.getAttribute('data-lmd-src') || n.getAttribute('src') || '') + ')'; return; }
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
        const href = niceHref(n.getAttribute('data-lmd-href') || n.getAttribute('href') || ''); const text = n.textContent;
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
      if (child.tagName === 'SPAN' && !child.classList.contains('lmd-math') && !child.classList.contains('lmd-hnum') && child.attributes.length) return false;
    }
    return true;
  }

  LMD.serialize = { inlineMd, roundTrips, escText, niceHref };
})();
