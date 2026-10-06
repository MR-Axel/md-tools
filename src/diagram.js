// Diagramas (Mermaid y Graphviz): editor con vista previa en vivo y plantillas, y las acciones
// que aparecen al pasar el mouse por un diagrama: copiar el código, bajar el SVG y ampliarlo.
(function () {
  'use strict';

  const { el, ICON, debounce } = LMD.kit;
  const T = LMD.t;
  let core = null;
  let viz = null;
  let seq = 0;

  const templates = () => [
    [T('Flujo'), 'graph TD\n  A[' + T('Inicio') + '] --> B{' + T('¿Sirve?') + '}\n  B -- ' + T('Sí') + ' --> C[' + T('Seguir') + ']\n  B -- No --> D[' + T('Corregir') + ']\n  D --> B'],
    [T('Secuencia'), 'sequenceDiagram\n  participant U as ' + T('Usuario') + '\n  participant A as App\n  participant S as ' + T('Servidor') + '\n  U->>A: ' + T('Pide algo') + '\n  A->>S: ' + T('Consulta') + '\n  S-->>A: ' + T('Respuesta') + '\n  A-->>U: ' + T('Resultado')],
    [T('Estados'), 'stateDiagram-v2\n  [*] --> ' + T('Borrador') + '\n  ' + T('Borrador') + ' --> ' + T('Revisión') + '\n  ' + T('Revisión') + ' --> ' + T('Publicado') + '\n  ' + T('Revisión') + ' --> ' + T('Borrador') + '\n  ' + T('Publicado') + ' --> [*]'],
    [T('Clases'), 'classDiagram\n  class ' + T('Pedido') + ' {\n    +id\n    +total()\n  }\n  class ' + T('Cliente') + ' {\n    +nombre\n  }\n  ' + T('Cliente') + ' "1" --> "*" ' + T('Pedido')],
    [T('Datos'), 'erDiagram\n  CLIENTE ||--o{ PEDIDO : hace\n  PEDIDO ||--|{ ITEM : contiene\n  CLIENTE {\n    string nombre\n    string email\n  }'],
    ['Gantt', 'gantt\n  title ' + T('Plan') + '\n  dateFormat YYYY-MM-DD\n  section ' + T('Diseño') + '\n  ' + T('Prototipo') + ' :a1, 2026-01-05, 7d\n  section ' + T('Desarrollo') + '\n  ' + T('Primera versión') + ' :after a1, 14d'],
    [T('Torta'), 'pie title ' + T('Reparto') + '\n  "A" : 45\n  "B" : 30\n  "C" : 25'],
    [T('Mapa mental'), 'mindmap\n  root((' + T('Tema') + '))\n    ' + T('Idea') + ' 1\n      ' + T('Detalle') + '\n    ' + T('Idea') + ' 2\n    ' + T('Idea') + ' 3'],
    [T('Línea de tiempo'), 'timeline\n  title ' + T('Historia') + '\n  2024 : ' + T('Idea') + '\n  2025 : ' + T('Primera versión') + '\n  2026 : ' + T('Lanzamiento')],
  ];

  const kindOf = (box) => box.dataset.kind || (box.classList.contains('lmd-graphviz') ? 'dot' : 'mermaid');
  const codeOf = (box) => (box.dataset.code != null ? box.dataset.code : box.textContent);

  async function draw(kind, code, target) {
    if (kind === 'dot') {
      await core.ensure('graphviz');
      viz = viz || await window.Viz.instance();
      const svg = viz.renderSVGElement(code);
      target.textContent = ''; target.appendChild(svg);
      return;
    }
    await core.ensure('mermaid');
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: core.isDark() ? 'dark' : 'default' });
    const id = 'lmd-dgm-' + (++seq);
    try {
      const out = await window.mermaid.render(id, code);
      target.innerHTML = out.svg;
    } finally {
      document.querySelectorAll('body > [id^="dlmd-dgm-"], body > #' + id).forEach((n) => n.remove());
    }
  }

  function edit(box) {
    if (!box || document.querySelector('.lmd-dgm')) return;
    const r = core.rangeOf(box); if (!r) return;
    const s = r[0] + core.fmOffset; const e = r[1] + core.fmOffset;
    const kind = kindOf(box);
    const original = core.srcLines.slice(s + 1, e - 1).join('\n');

    const modal = el('div', { class: 'lmd-dgm' });
    modal.innerHTML =
      '<div class="lmd-dgm-card" role="dialog" aria-label="' + T('Editar diagrama') + '">' +
        '<header><h3>' + T('Editar diagrama') + ' <small>' + (kind === 'dot' ? 'Graphviz' : 'Mermaid') + '</small></h3>' +
          (kind === 'dot' ? '' : '<div class="lmd-dgm-tpl"><span>' + T('Plantillas') + '</span>' + templates().map((t, i) => '<button type="button" data-tpl="' + i + '">' + t[0] + '</button>').join('') + '</div>') +
        '</header>' +
        '<div class="lmd-dgm-body"><textarea spellcheck="false"></textarea><div class="lmd-dgm-view"><div class="lmd-dgm-svg lmd-diagram' + (kind === 'dot' ? ' lmd-diagram-dot' : '') + '"></div><p class="lmd-dgm-err" hidden></p></div></div>' +
        '<footer><a href="' + (kind === 'dot' ? 'https://graphviz.org/doc/info/lang.html' : 'https://mermaid.js.org/intro/') + '" target="_blank" rel="noopener noreferrer">' + T('Ver la sintaxis') + '</a><span></span>' +
          '<button type="button" class="lmd-btn" data-dgm="no">' + T('Cancelar') + '</button>' +
          '<button type="button" class="lmd-btn lmd-btn-fill" data-dgm="ok">' + T('Aplicar') + ' <kbd>Ctrl+Enter</kbd></button></footer>' +
      '</div>';
    document.body.appendChild(modal);
    const ta = modal.querySelector('textarea'); const view = modal.querySelector('.lmd-dgm-svg'); const err = modal.querySelector('.lmd-dgm-err');
    ta.value = original;

    let turn = 0;
    const refresh = async () => {
      const mine = ++turn;
      const holder = el('div');
      try {
        await draw(kind, ta.value, holder);
        if (mine !== turn) return;
        view.textContent = ''; while (holder.firstChild) view.appendChild(holder.firstChild);
        err.hidden = true; view.classList.remove('lmd-dgm-stale');
      } catch (ex) {
        if (mine !== turn) return;
        // Se deja a la vista el último dibujo que salió bien, atenuado, y el error debajo.
        err.hidden = false; err.textContent = String(ex && ex.message || ex).split('\n').slice(0, 4).join('\n');
        view.classList.add('lmd-dgm-stale');
      }
    };
    refresh();
    ta.addEventListener('input', debounce(refresh, 300));
    ta.focus();

    const close = (apply) => {
      modal.remove();
      if (!apply || ta.value === original) return;
      core.spliceLines(s + 1, e - s - 2, ta.value.replace(/\s+$/, '').split('\n'));
      core.render();
    };
    modal.addEventListener('click', (ev) => {
      const tpl = ev.target.closest('[data-tpl]');
      if (tpl) { ta.value = templates()[+tpl.dataset.tpl][1]; refresh(); ta.focus(); return; }
      const b = ev.target.closest('[data-dgm]');
      if (b) close(b.dataset.dgm === 'ok');
    });
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); close(true); }
      if (ev.key === 'Tab' && ev.target === ta) { ev.preventDefault(); document.execCommand('insertText', false, '  '); }
    });
  }

  function tools(box) {
    if (box.querySelector('.lmd-dgm-tools') || !box.querySelector('svg')) return;
    const bar = el('div', { class: 'lmd-dgm-tools' },
      '<button type="button" data-dt="copy" title="' + T('Copiar el código del diagrama') + '">' + ICON.copy + '</button>' +
      '<button type="button" data-dt="svg" title="' + T('Descargar como SVG') + '">' + ICON.save + '</button>' +
      '<button type="button" data-dt="zoom" title="' + T('Ampliar') + '">' + ICON.eye + '</button>');
    bar.contentEditable = 'false';
    box.appendChild(bar);
  }

  function act(what, box) {
    const svg = box.querySelector('svg'); if (!svg) return;
    if (what === 'copy') { navigator.clipboard.writeText(codeOf(box)).then(() => core.flash(T('Código del diagrama copiado'))); return; }
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (what === 'zoom') {
      core.ui.viewer.textContent = '';
      const wrap = el('div', { class: 'lmd-viewer-svg lmd-diagram' + (kindOf(box) === 'dot' ? ' lmd-diagram-dot' : '') });
      copy.removeAttribute('style'); copy.removeAttribute('width'); copy.removeAttribute('height');
      wrap.appendChild(copy); core.ui.viewer.appendChild(wrap); core.ui.viewer.hidden = false;
      return;
    }
    const a = el('a', { download: (core.docName || 'diagrama').replace(/\.[^.]+$/, '') + '-' + T('diagrama') + '.svg' });
    a.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function init(c) {
    core = c;
    const article = core.ui.article;
    article.addEventListener('mouseover', (e) => { const box = e.target.closest && e.target.closest('.lmd-diagram'); if (box) tools(box); });
    article.addEventListener('click', (e) => {
      const t = e.target.closest('[data-dt]');
      if (t) { e.preventDefault(); e.stopPropagation(); act(t.dataset.dt, t.closest('.lmd-diagram')); return; }
      if (!core.editMode) return;
      const box = e.target.closest('.lmd-diagram, pre.lmd-mermaid, pre.lmd-graphviz');
      if (box) edit(box);
    });
  }

  LMD.diagram = { init, edit };
})();
