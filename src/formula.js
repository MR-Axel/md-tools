// Fórmulas (KaTeX): editor con el LaTeX a la izquierda y la vista previa en vivo a la derecha, piezas para armar
// la fórmula sin saberse los comandos, y errores explicados. Una fórmula en bloque se abre en el editor; una en
// línea, en un cuadro chico anclado a ella. Por detrás queda el Markdown de siempre: $$ en líneas propias, o $…$.
(function () {
  'use strict';

  const { el, debounce } = LMD.kit;
  const { inlineMd } = LMD.serialize;
  const T = LMD.t;
  let core = null;

  // ---------- Piezas ----------
  // [nombre, lo que se dibuja en el botón, lo que se escribe]. Los huecos van entre << >>: el primero queda
  // seleccionado. Con texto seleccionado, la pieza lo envuelve: va al primer hueco y queda seleccionado el segundo.
  // Con <| |> el hueco se agrupa con llaves si lo que recibe tiene más de un carácter.
  const GROUPS = [
    ['Estructuras', [
      ['Fracción', '\\frac{a}{b}', '\\frac{<<a>>}{<<b>>}'],
      ['Potencia', 'x^{n}', '<|x|>^{<<n>>}'],
      ['Subíndice', 'x_{i}', '<|x|>_{<<i>>}'],
      ['Raíz', '\\sqrt{x}', '\\sqrt{<<x>>}'],
      ['Raíz enésima', '\\sqrt[n]{x}', '\\sqrt[<<n>>]{<<x>>}'],
      ['Sumatoria', '\\sum_{i}^{n}', '\\sum_{<<i=1>>}^{<<n>>} <<x_i>>'],
      ['Integral', '\\int_{a}^{b}', '\\int_{<<a>>}^{<<b>>} <<f(x)>> \\, dx'],
      ['Límite', '\\lim_{x \\to a}', '\\lim_{<<x \\to \\infty>>} <<f(x)>>'],
      ['Matriz', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{pmatrix}\n  <<a>> & <<b>> \\\\\n  <<c>> & <<d>>\n\\end{pmatrix}'],
      ['Sistema de ecuaciones', '\\begin{cases} x \\\\ y \\end{cases}', '\\begin{cases}\n  <<x + y = 1>> \\\\\n  <<x - y = 0>>\n\\end{cases}'],
      ['Paréntesis que crecen', '\\left( \\tfrac{a}{b} \\right)', '\\left( <<x>> \\right)'],
      ['Texto', '\\text{Aa}', '\\text{<<texto>>}'],
    ]],
    ['Letras griegas', ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Omega'].map((n) => [n, '\\' + n, '\\' + n])],
    ['Relaciones', [['Igual', '=', '='], ['Distinto', '\\neq', '\\neq'], ['Aproximado', '\\approx', '\\approx'], ['Menor o igual', '\\leq', '\\leq'], ['Mayor o igual', '\\geq', '\\geq'], ['Mucho menor', '\\ll', '\\ll'], ['Mucho mayor', '\\gg', '\\gg'], ['Equivalente', '\\equiv', '\\equiv'], ['Proporcional', '\\propto', '\\propto'], ['Parecido', '\\sim', '\\sim'], ['Pertenece', '\\in', '\\in'], ['No pertenece', '\\notin', '\\notin'], ['Subconjunto', '\\subset', '\\subset'], ['Subconjunto o igual', '\\subseteq', '\\subseteq']]],
    ['Operaciones', [['Más o menos', '\\pm', '\\pm'], ['Por', '\\times', '\\times'], ['Dividido', '\\div', '\\div'], ['Punto', '\\cdot', '\\cdot'], ['Infinito', '\\infty', '\\infty'], ['Derivada parcial', '\\partial', '\\partial'], ['Nabla', '\\nabla', '\\nabla'], ['Unión', '\\cup', '\\cup'], ['Intersección', '\\cap', '\\cap'], ['Para todo', '\\forall', '\\forall'], ['Existe', '\\exists', '\\exists'], ['Puntos suspensivos', '\\dots', '\\dots'], ['Vector', '\\vec{v}', '\\vec{<<v>>}'], ['Promedio', '\\bar{x}', '\\bar{<<x>>}']]],
    ['Flechas', [['Hacia la derecha', '\\to', '\\to'], ['Hacia la izquierda', '\\leftarrow', '\\leftarrow'], ['En los dos sentidos', '\\leftrightarrow', '\\leftrightarrow'], ['Implica', '\\Rightarrow', '\\Rightarrow'], ['Implicado por', '\\Leftarrow', '\\Leftarrow'], ['Si y solo si', '\\Leftrightarrow', '\\Leftrightarrow'], ['Corresponde a', '\\mapsto', '\\mapsto'], ['Hacia arriba', '\\uparrow', '\\uparrow'], ['Hacia abajo', '\\downarrow', '\\downarrow']]],
  ];
  // Los comandos que la app conoce, para sugerir uno cuando se escribe mal.
  const KNOWN = ['frac', 'sqrt', 'sum', 'int', 'lim', 'prod', 'left', 'right', 'begin', 'end', 'text', 'vec', 'bar', 'hat', 'dots', 'cdot', 'times', 'div', 'pm', 'infty', 'partial', 'nabla', 'to', 'neq', 'approx', 'leq', 'geq', 'equiv', 'in', 'subset', 'cup', 'cap', 'forall', 'exists', 'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'mathbb', 'mathbf', 'mathrm', 'quad', 'binom', 'overline', 'underline', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'mapsto']
    .concat(GROUPS[1][1].map((g) => g[0]));

  // Lo que hay que escribir para una pieza, dado lo seleccionado: { text, sel: [desde, hasta] } relativo al texto.
  function pieceText(tpl, picked) {
    const holes = []; let out = ''; let last = 0; let m;
    const re = /<<([\s\S]*?)>>|<\|([\s\S]*?)\|>/g;
    while ((m = re.exec(tpl))) {
      out += tpl.slice(last, m.index);
      let text = m[1] != null ? m[1] : m[2];
      if (picked && !holes.length) text = m[2] != null && picked.length > 1 ? '{' + picked + '}' : picked;
      holes.push([out.length, out.length + text.length]); out += text; last = re.lastIndex;
    }
    out += tpl.slice(last);
    // Un comando termina en letra: va con un espacio atrás para que lo que se escriba después no se le pegue.
    if (!holes.length && /\\[A-Za-z]+$/.test(out)) out += ' ';
    const hole = picked ? holes[1] : holes[0];
    return { text: out, sel: hole || [out.length, out.length] };
  }
  // Escribe en el cuadro con insertText, para que Ctrl+Z lo deshaga.
  function write(field, from, to, text) {
    field.focus(); field.setSelectionRange(from, to);
    if (!document.execCommand('insertText', false, text)) { field.setRangeText(text, from, to, 'end'); field.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function insertPiece(field, tpl) {
    const a = field.selectionStart; const b = field.selectionEnd;
    tpl = tpl.replace('<<texto>>', '<<' + T('texto') + '>>');
    // En el cuadro de una línea (fórmula en el texto) la pieza va sin saltos de renglón.
    const p = pieceText(field.tagName === 'INPUT' ? tpl.replace(/\n\s*/g, ' ') : tpl, field.value.slice(a, b));
    write(field, a, b, p.text);
    field.setSelectionRange(a + p.sel[0], a + p.sel[1]);
  }
  // Tab salta al próximo grupo entre llaves, que es donde están los huecos; Shift+Tab, al anterior.
  function jump(field, back) {
    const v = field.value; const groups = []; let m; const re = /\{([^{}]*)\}/g;
    while ((m = re.exec(v))) groups.push([m.index + 1, m.index + 1 + m[1].length]);
    const g = back ? groups.filter((x) => x[0] < field.selectionStart).pop() : groups.find((x) => x[0] > field.selectionStart);
    if (!g) return false;
    field.setSelectionRange(g[0], g[1]);
    return true;
  }
  const keysHtml = () =>
    '<div class="lmd-fx-tabs" role="tablist">' + GROUPS.map((g, i) => '<button type="button" role="tab" data-fx-tab="' + i + '" aria-selected="' + (i === 0) + '">' + T(g[0]) + '</button>').join('') + '</div>' +
    GROUPS.map((g, i) => '<div class="lmd-fx-keys" role="tabpanel" data-fx-group="' + i + '"' + (i ? ' hidden' : '') + '>' + g[1].map((k, j) => '<button type="button" data-fx="' + i + ':' + j + '" title="' + T(k[0]) + '" aria-label="' + T(k[0]) + '"></button>').join('') + '</div>').join('');
  // Cada pieza muestra su símbolo dibujado, no el código.
  function drawKeys(rootNode) {
    rootNode.querySelectorAll('[data-fx]').forEach((b) => {
      const k = b.dataset.fx.split(':'); const show = GROUPS[+k[0]][1][+k[1]][1];
      try { window.katex.render(show, b, { throwOnError: true }); } catch (e) { b.textContent = show; }
    });
  }
  function bindKeys(rootNode, field) {
    rootNode.addEventListener('mousedown', (ev) => { if (ev.target.closest('[data-fx], [data-fx-tab]')) ev.preventDefault(); }); // el cuadro no pierde lo seleccionado
    rootNode.addEventListener('click', (ev) => {
      const tab = ev.target.closest('[data-fx-tab]');
      if (tab) {
        rootNode.querySelectorAll('[data-fx-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        rootNode.querySelectorAll('[data-fx-group]').forEach((g) => { g.hidden = g.dataset.fxGroup !== tab.dataset.fxTab; });
        return;
      }
      const key = ev.target.closest('[data-fx]');
      if (key) { const k = key.dataset.fx.split(':'); insertPiece(field, GROUPS[+k[0]][1][+k[1]][2]); }
    });
  }

  // ---------- Errores explicados ----------
  // Del mensaje de KaTeX a algo corto: { line (desde 0, o null), head, hint, detail }.
  const tick = (s) => '`' + String(s).replace(/`/g, "'").trim().slice(0, 40) + '`';
  function near(word) {
    let best = ''; let cost = 3;
    KNOWN.forEach((k) => {
      if (Math.abs(k.length - word.length) > 2) return;
      const d = []; for (let i = 0; i <= word.length; i++) { d[i] = [i]; for (let j = 1; j <= k.length; j++) d[i][j] = i ? Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (word[i - 1] === k[j - 1] ? 0 : 1)) : j; }
      if (d[word.length][k.length] < cost) { cost = d[word.length][k.length]; best = k; }
    });
    return best;
  }
  function explain(tex, ex) {
    const detail = String((ex && ex.message) || ex); const msg = detail.replace(/^KaTeX parse error:\s*/, '');
    const pos = ex && typeof ex.position === 'number' ? ex.position : null;
    const lines = tex.split('\n'); let last = lines.length - 1; while (last > 0 && !lines[last].trim()) last--;
    const line = lines.length < 2 ? null : pos == null || /at end of input/.test(msg) ? last : Math.min(last, tex.slice(0, pos).split('\n').length - 1);
    const out = (head, hint, vars, at) => ({ line: at != null ? at : line, head: T(head, vars), hint: hint ? T(hint, vars) : '', detail });
    const bare = tex.replace(/\\[{}]/g, ''); const braces = bare.split('{').length - bare.split('}').length;
    let m;
    if ((m = /Undefined control sequence: (\\[A-Za-z]+|\\.)/.exec(msg))) { const guess = near(m[1].slice(1)); return out('No existe el comando {a}.', guess ? '¿Quisiste escribir {b}?' : 'Revisá cómo está escrito. Mayúsculas y minúsculas cuentan.', { a: tick(m[1]), b: tick('\\' + guess) }); }
    if (/Double superscript/.test(msg)) return out('Hay dos potencias seguidas.', 'Agrupá con llaves, por ejemplo `a^{b^c}`.');
    if (/Double subscript/.test(msg)) return out('Hay dos subíndices seguidos.', 'Agrupá con llaves, por ejemplo `a_{i_j}`.');
    if ((m = /Expected group after '(.)'/.exec(msg))) return out('Falta lo que va después de {a}.', 'Por ejemplo {b}.', { a: tick(m[1]), b: tick(m[1] === '^' ? 'x^{2}' : 'x_{i}') });
    if (/Expected '\\right'/.test(msg)) return out('A `\\left` le falta su `\\right`.', 'Van de a pares, por ejemplo `\\left( x \\right)`.');
    if ((m = /No such environment: (\S+)/.exec(msg))) return out('No existe el entorno {a}.', 'Probá con `matrix`, `pmatrix` o `cases`.', { a: tick(m[1]) });
    if ((m = /Mismatch: \\begin\{([^}]*)\} matched by \\end\{([^}]*)\}/.exec(msg))) return out('{a} termina con {b}.', 'Los dos llevan el mismo nombre.', { a: tick('\\begin{' + m[1] + '}'), b: tick('\\end{' + m[2] + '}') });
    if (/Expected & or|Expected '\\end'|\\cr or \\end/.test(msg)) { const env = (tex.match(/\\begin\{([^}]*)\}/g) || []).pop() || '\\begin{matrix}'; const at = lines.findIndex((l) => l.includes(env)); return out('Falta cerrar {a}.', 'Agregá {b} al final.', { a: tick(env), b: tick(env.replace('\\begin', '\\end')) }, lines.length < 2 ? null : at); }
    if (/Expected 'EOF', got '\}'|Extra \}/.test(msg)) return out('Sobra una llave `}`.', 'Cada `}` cierra una `{` que se abrió antes.');
    if (/Expected 'EOF', got '&'/.test(msg)) return out('`&` solo va dentro de una matriz o un sistema.', 'Para escribir el signo, usá `\\&`.');
    if (/Expected '\}'|Unexpected end of input in a macro argument|Missing \}/.test(msg)) {
      if (braces > 0) return out('Falta cerrar una llave.', 'Cada `{` lleva su `}`.');
      const cmd = (tex.slice(0, pos == null ? tex.length : pos + 1).match(/\\[A-Za-z]+/g) || []).pop() || '\\frac';
      return out('A {a} le falta una parte.', cmd === '\\frac' ? 'Lleva dos, por ejemplo `\\frac{1}{2}`.' : 'Cada parte va entre llaves.', { a: tick(cmd) });
    }
    if ((m = /Expected 'EOF', got '([^']+)'/.exec(msg))) return out('No se esperaba {a} acá.', '', { a: tick(m[1]) });
    const around = pos == null ? '' : tex.slice(Math.max(0, pos - 8), pos + 8).replace(/\s+/g, ' ').trim();
    return out('La fórmula tiene un error.', around ? 'Está cerca de {a}.' : '', { a: tick(around) });
  }
  // Una fórmula del documento que no se pudo dibujar: en bloque, el aviso corto arriba del código; en línea,
  // el código marcado y el aviso al pasar el mouse.
  function fail(node, ex) {
    const tex = node.getAttribute('data-tex') || ''; const info = explain(tex, ex);
    node.classList.add('lmd-math-bad');
    if (!node.classList.contains('lmd-math-block')) { node.textContent = tex; node.title = (info.head + ' ' + info.hint).replace(/`/g, '').trim(); return; }
    node.innerHTML = '<span class="lmd-err-note">' + LMD.diagram.errorHtml(Object.assign({}, info, { line: null }), T('No se pudo dibujar la fórmula.')) + '</span><code></code>';
    node.lastChild.textContent = tex;
  }

  // ---------- Editor de una fórmula en bloque ----------
  // node es la fórmula que se edita; sin node se crea una nueva debajo de after, que recién se escribe al aplicar.
  async function edit(node, after) {
    if (document.querySelector('.lmd-dgm, .lmd-fxi')) return;
    let s = 0; let e = 0; let prefix = ''; let original = '';
    if (node) {
      const r = core.rangeOf(node); if (!r) return;
      s = r[0] + core.fmOffset; e = r[1] + core.fmOffset;
      prefix = /^(\s*(?:>\s?)*\s*)/.exec(core.srcLines[s] || '')[1];
      if ((core.srcLines[s] || '').slice(prefix.length, prefix.length + 2) !== '$$') { core.flash(T('Este bloque se edita desde la vista de código'), 'warn'); return; }
      original = node.getAttribute('data-tex') || '';
    }
    await core.ensure('katex');
    const title = T(node ? 'Editar fórmula' : 'Fórmula nueva');
    const modal = el('div', { class: 'lmd-dgm lmd-fx' });
    modal.innerHTML =
      '<div class="lmd-dgm-card" role="dialog" aria-label="' + title + '">' +
        '<header><div class="lmd-dgm-top"><h3>' + title + ' <small>LaTeX</small></h3></div>' + keysHtml() + '</header>' +
        '<div class="lmd-dgm-body">' + LMD.diagram.PANE + '<div class="lmd-dgm-view"><div class="lmd-dgm-svg lmd-fx-view"></div><div class="lmd-dgm-err" role="alert" hidden></div></div></div>' +
        '<footer><a href="https://katex.org/docs/supported.html" target="_blank" rel="noopener noreferrer">' + T('Ver la sintaxis') + '</a><span></span>' +
          (node ? '<button type="button" class="lmd-btn lmd-dgm-remove" data-fx-act="del">' + T('Eliminar la fórmula') + '</button>' : '') +
          '<button type="button" class="lmd-btn" data-fx-act="no">' + T('Cancelar') + '</button>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-fx-act="ok">' + T('Aplicar') + ' <kbd>' + LMD.keys('Ctrl+Enter') + '</kbd></button></footer>' +
      '</div>';
    document.body.appendChild(modal);
    const code = LMD.diagram.pane(modal.querySelector('.lmd-ed-code')); const ta = code.ta;
    const view = modal.querySelector('.lmd-fx-view'); const err = modal.querySelector('.lmd-dgm-err');
    ta.placeholder = T('Escribí la fórmula, o armala con las piezas de arriba');
    ta.value = original; code.sync();
    drawKeys(modal); bindKeys(modal, ta);

    const refresh = () => {
      const tex = ta.value.trim();
      if (!tex) { view.innerHTML = '<p class="lmd-fx-empty">' + T('La fórmula se va a ver acá') + '</p>'; err.hidden = true; view.classList.remove('lmd-dgm-stale'); code.mark(null); return; }
      const holder = el('div');
      try {
        window.katex.render(tex, holder, { displayMode: true, throwOnError: true });
        view.textContent = ''; view.appendChild(holder);
        err.hidden = true; view.classList.remove('lmd-dgm-stale'); code.mark(null);
      } catch (ex) {
        // Queda a la vista la última fórmula que salió bien, atenuada, y el error explicado debajo.
        const info = explain(ta.value, ex);
        err.hidden = false; err.innerHTML = LMD.diagram.errorHtml(info);
        view.classList.add('lmd-dgm-stale'); code.mark(info.line);
      }
    };
    refresh();
    ta.addEventListener('input', debounce(refresh, 200));
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);

    const close = (apply) => {
      modal.remove();
      const tex = ta.value.replace(/\s+$/, '').replace(/^\s*\n/, '');
      if (!apply || tex === original) return;
      const lines = ['$$'].concat(tex.split('\n'), '$$').map((l) => prefix + l);
      if (!node) { if (tex.trim()) LMD.write.put(after, lines); return; }
      if (!tex.trim()) { LMD.write.remove(node); return; }
      core.spliceLines(s, e - s, lines);
      core.render();
    };
    modal.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-fx-act]'); if (!b) return;
      if (b.dataset.fxAct === 'del') { modal.remove(); LMD.write.remove(node.isConnected ? node : core.ui.article.querySelector('[data-l^="' + (s - core.fmOffset) + '-"]')); return; }
      close(b.dataset.fxAct === 'ok');
    });
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); close(true); }
      else if (ev.key === 'Tab' && ev.target === ta && jump(ta, ev.shiftKey)) ev.preventDefault();
    });
  }

  // ---------- Una fórmula en línea: un cuadro chico anclado a ella ----------
  // fresh: { host, range, text } cuando la fórmula se está creando sobre un texto elegido. El párrafo no se toca
  // hasta aplicar: cancelar no tiene nada que deshacer.
  async function editInline(span, fresh) {
    if (document.querySelector('.lmd-dgm, .lmd-fxi')) return;
    const host = fresh ? fresh.host : span.closest('.lmd-editable');
    if (!host || host.classList.contains('lmd-draft')) { core.flash(T('Este bloque se edita desde la vista de código'), 'warn'); return; }
    await core.ensure('katex');
    const original = fresh ? fresh.text : span.getAttribute('data-tex') || ''; const before = inlineMd(host);
    const box = el('div', { class: 'lmd-fxi', role: 'dialog', 'aria-label': T(fresh ? 'Fórmula en línea' : 'Editar fórmula') });
    box.innerHTML = '<input type="text" spellcheck="false" autocomplete="off" aria-label="LaTeX"><div class="lmd-fxi-view"></div><div class="lmd-fxi-err" role="alert" hidden></div>' + keysHtml() +
      '<div class="lmd-fxi-actions">' + (fresh ? '' : '<button type="button" class="lmd-btn lmd-dgm-remove" data-fx-act="del">' + T('Eliminar la fórmula') + '</button>') + '<span></span>' +
      '<button type="button" class="lmd-btn" data-fx-act="no">' + T('Cancelar') + '</button><button type="button" class="lmd-btn lmd-btn-fill" data-fx-act="ok">' + T('Aplicar') + ' <kbd>Enter</kbd></button></div>';
    document.body.appendChild(box);
    const input = box.querySelector('input'); const view = box.querySelector('.lmd-fxi-view'); const err = box.querySelector('.lmd-fxi-err');
    input.value = original;
    drawKeys(box); bindKeys(box, input);
    // Debajo de la fórmula (o del texto elegido) si entra; si no, arriba. Nunca fuera de la pantalla.
    const place = () => {
      const r = (fresh ? fresh.range : span).getBoundingClientRect(); const w = box.offsetWidth; const h = box.offsetHeight;
      box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      box.style.top = Math.max(8, r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
    };
    const refresh = () => {
      const tex = input.value.trim();
      if (!tex) { view.textContent = ''; err.hidden = true; view.classList.remove('lmd-dgm-stale'); return; }
      const holder = el('span');
      try {
        window.katex.render(tex, holder, { displayMode: false, throwOnError: true });
        view.textContent = ''; view.appendChild(holder); err.hidden = true; view.classList.remove('lmd-dgm-stale');
      } catch (ex) { const info = explain(tex, ex); err.hidden = false; err.innerHTML = LMD.diagram.errorHtml(Object.assign({}, info, { line: null })); view.classList.add('lmd-dgm-stale'); }
      place();
    };
    refresh(); place();
    input.addEventListener('input', debounce(refresh, 150));
    core.hold = true; // mientras el cuadro está abierto, el párrafo no se redibuja debajo
    input.focus(); input.select();

    let done = false;
    const close = (how) => {
      if (done) return; done = true;
      box.remove(); document.removeEventListener('mousedown', outside, true); window.removeEventListener('scroll', place, true);
      core.hold = false;
      const tex = input.value.replace(/\s+/g, ' ').replace(/\$/g, '').trim();
      if (fresh) {
        if (how !== 'ok' || !tex || !host.isConnected || !host.contains(fresh.range.startContainer)) { core.softRender(); return; }
        if (host._md == null) host._md = before;
        fresh.range.deleteContents();
        span = el('span', { class: 'lmd-math', 'data-tex': tex, contenteditable: 'false' });
        fresh.range.insertNode(span);
      } else {
        if (!host.isConnected || !span.isConnected || how === 'no' || (how === 'ok' && tex === original)) { core.softRender(); return; }
        // Solo cambia la fórmula: el resto del párrafo queda como estaba, y se reescribe ese bloque.
        if (host._md == null) host._md = before;
      }
      if (!fresh && (how === 'del' || !tex)) span.remove();
      else {
        span.setAttribute('data-tex', tex); span.classList.remove('lmd-math-bad'); span.removeAttribute('title');
        try { window.katex.render(tex, span, { displayMode: false, throwOnError: true }); } catch (ex) { fail(span, ex); }
      }
      core.commitBlock(host);
      host._md = null;
      core.softRender();
    };
    const outside = (ev) => { if (!box.contains(ev.target)) close('ok'); };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', place, true);
    box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-fx-act]'); if (b) close(b.dataset.fxAct); });
    box.addEventListener('keydown', (ev) => {
      ev.stopPropagation(); // los atajos del documento no corren mientras el cuadro está abierto
      if (ev.key === 'Escape') { ev.preventDefault(); close('no'); }
      else if (ev.key === 'Enter') { ev.preventDefault(); close('ok'); }
      else if (ev.key === 'Tab' && ev.target === input && jump(input, ev.shiftKey)) ev.preventDefault();
    });
  }

  // Fórmula en línea nueva, desde la barra de formato: el texto elegido pasa a ser la fórmula y se abre el mismo
  // cuadro chico que al editar una. Sin aplicar, el texto queda como estaba.
  function createInline() {
    if (document.querySelector('.lmd-dgm, .lmd-fxi')) return;
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const elementOf = (n) => (n && n.nodeType === 1 ? n : n && n.parentNode);
    let range = sel.getRangeAt(0);
    let host = elementOf(sel.anchorNode) && elementOf(sel.anchorNode).closest('.lmd-editable');
    if (!host || !host.contains(range.startContainer) || !host.contains(range.endContainer)) return;
    // Dentro de código, de un enlace o de otra fórmula no va.
    if (elementOf(range.commonAncestorContainer).closest('code, a, .lmd-math') || range.cloneContents().querySelector('code, a, .lmd-math, img')) { core.flash(T('Elegí solo texto para hacer una fórmula.'), 'warn'); return; }
    if (host.classList.contains('lmd-draft')) {
      // Un bloque recién escrito todavía no está en el archivo: se lo pasa antes, y se vuelve a ubicar lo elegido.
      const plain = (s) => s.replace(/\u200b/g, '');
      const pre = document.createRange(); pre.selectNodeContents(host); pre.setEnd(range.startContainer, range.startOffset);
      const start = plain(pre.toString()).length; const end = start + plain(range.toString()).length;
      const made = LMD.write.settle(host); if (!made) return;
      host = made; range = document.createRange();
      const walker = document.createTreeWalker(made, NodeFilter.SHOW_TEXT); let n; let seen = 0; let open = false;
      while ((n = walker.nextNode())) {
        const len = n.nodeValue.length;
        if (!open && start <= seen + len) { range.setStart(n, start - seen); open = true; }
        if (open && end <= seen + len) { range.setEnd(n, end - seen); break; }
        seen += len;
      }
      if (!open || range.collapsed) return;
      host.focus();
    }
    const text = range.toString().replace(/\s+/g, ' ').trim(); if (!text) return;
    editInline(null, { host, range: range.cloneRange(), text });
  }

  function init(c) {
    core = c;
    core.ui.article.addEventListener('click', (e) => {
      if (!core.editMode || !e.target.closest) return;
      // "Ver detalle" de una fórmula que no se dibujó se abre sin pasar al editor.
      const m = e.target.closest('.lmd-math'); if (!m || e.target.closest('.lmd-err-more')) return;
      e.preventDefault();
      if (m.classList.contains('lmd-math-block')) edit(m); else editInline(m);
    });
  }

  LMD.formula = { init, edit, editInline, createInline, create: (after) => edit(null, after), fail, explain, pieceText, GROUPS };
})();
