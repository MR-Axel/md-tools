// Atajos de teclado: la tabla con todos los que la app atiende, y la hoja que los muestra.
// Es la única lista: un atajo nuevo se suma acá, con su grupo, y tests/shortcuts.mjs comprueba que dispare algo.
// Las órdenes de voz no van acá: tienen su propia hoja en el dictado.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;

  // Los grupos, en el orden en que se ven.
  const GROUPS = [
    ['write', 'Escribir y formato'], ['nav', 'Navegar'], ['files', 'Archivos'], ['view', 'Vista'], ['tools', 'Herramientas'],
    ['board', 'Tablero'], ['editors', 'Editores de diagramas y fórmulas'], ['ai', 'IA'], ['general', 'General'],
  ];

  // Cada atajo: [id, grupo, teclas, qué hace, condición].
  //   teclas: las teclas unidas con "+"; con " / " entre dos formas de lo mismo.
  //   condición (opcional): tool, la herramienta que tiene que estar prendida; on, 'app' (solo en la app) o
  //   'ext' (solo con la extensión, que es la que atiende esas teclas); ctx, dónde vale, dicho en pocas palabras.
  const LIST = [
    ['bold', 'write', 'Ctrl+B', 'Negrita', { ctx: 'Editando' }],
    ['italic', 'write', 'Ctrl+I', 'Cursiva', { ctx: 'Editando' }],
    ['link', 'write', 'Ctrl+K', 'Insertar o editar un enlace', { ctx: 'Editando' }],
    ['enter', 'write', 'Enter', 'Cerrar el bloque y abrir otro debajo', { ctx: 'Editando' }],
    ['break', 'write', 'Shift+Enter', 'Salto de línea', { ctx: 'Editando' }],
    ['revert', 'write', 'Esc', 'Descartar lo escrito en el bloque', { ctx: 'Editando' }],
    ['undo', 'write', 'Ctrl+Z', 'Deshacer', { ctx: 'Editando' }],
    ['redo', 'write', 'Ctrl+Y / Ctrl+Shift+Z', 'Rehacer', { ctx: 'Editando' }],
    ['cell', 'write', 'Tab / Shift+Tab', 'Celda siguiente o anterior', { ctx: 'En una tabla' }],
    ['list-level', 'write', 'Tab / Shift+Tab', 'Sangrar un ítem o sacarlo un nivel, con sus hijos', { ctx: 'En una lista' }],
    ['list-move', 'write', 'Alt+Up / Alt+Down', 'Mover un ítem entre sus hermanos', { ctx: 'En una lista' }],
    ['md-title', 'write', '#+Space', 'Título, de # a ####', { ctx: 'En un bloque nuevo' }],
    ['md-list', 'write', '-+Space', 'Lista', { ctx: 'En un bloque nuevo' }],
    ['md-num', 'write', '1.+Space', 'Lista numerada', { ctx: 'En un bloque nuevo' }],
    ['md-quote', 'write', '>+Space', 'Cita', { ctx: 'En un bloque nuevo' }],
    ['md-task', 'write', '[]+Space', 'Tarea', { ctx: 'En un bloque nuevo' }],
    ['md-bold', 'write', '**…**', 'Negrita al escribir. También *…*, `…`, ~~…~~ y ==…==', { ctx: 'Editando' }],
    ['wiki', 'write', '[[', 'Enlazar otra nota', { ctx: 'Editando', on: 'app' }],
    ['task-move', 'write', 'Up / Down', 'Mover una tarea, con el foco en su manija', { ctx: 'Editando' }],

    ['search', 'nav', 'Ctrl+Shift+F', 'Buscar en la nota o en la carpeta'],
    ['search-step', 'nav', 'Enter / Shift+Enter', 'Resultado siguiente o anterior', { ctx: 'En el buscador' }],
    ['replace', 'nav', 'Enter', 'Reemplazar', { ctx: 'En Reemplazar' }],
    ['replace-all', 'nav', 'Ctrl+Enter', 'Reemplazar todo', { ctx: 'En Reemplazar' }],
    ['follow', 'nav', 'Ctrl+Click', 'Seguir un enlace', { ctx: 'Editando' }],
    ['menu', 'nav', 'Up / Down', 'Recorrer un menú o una lista'],
    ['menu-ends', 'nav', 'Home / End', 'Primera o última opción de un menú'],

    ['save', 'files', 'Ctrl+S', 'Guardar'],
    ['rename', 'files', 'F2', 'Cambiar el nombre de la nota, o del archivo elegido en el árbol'],
    ['print', 'files', 'Ctrl+P', 'Imprimir o guardar como PDF'],

    ['sidebar', 'view', 'Alt+Shift+B', 'Mostrar u ocultar la barra lateral', { on: 'ext' }],
    ['centered', 'view', 'Alt+Shift+C', 'Centrar o no el contenido', { on: 'ext' }],
    ['refresh', 'view', 'Alt+Shift+R', 'Activar o desactivar la recarga automática', { on: 'ext' }],
    ['theme', 'view', 'Alt+Shift+T', 'Cambiar el tema', { on: 'ext' }],

    ['speak', 'tools', 'Alt+Shift+S', 'Leer en voz alta, o cortar la lectura', { tool: 'speak' }],
    ['dictate', 'tools', 'Alt+Shift+D', 'Dictar, o cortar el dictado', { tool: 'dictate', ctx: 'Editando' }],
    ['daily', 'tools', 'Alt+Shift+H', 'Nota de hoy', { tool: 'daily', on: 'app' }],
    ['daily-month', 'tools', 'PageUp / PageDown', 'Mes anterior o siguiente', { tool: 'daily', on: 'app', ctx: 'En el calendario' }],
    ['linkmap', 'tools', 'Alt+Shift+G', 'Mapa de enlaces', { tool: 'linkmap' }],
    ['present', 'tools', 'Alt+Shift+P', 'Presentar, o salir', { tool: 'present' }],
    ['pres-next', 'tools', 'Right / Space', 'Diapositiva siguiente', { tool: 'present', ctx: 'Presentando' }],
    ['pres-prev', 'tools', 'Left / Backspace', 'Diapositiva anterior', { tool: 'present', ctx: 'Presentando' }],
    ['pres-ends', 'tools', 'Home / End', 'Primera o última diapositiva', { tool: 'present', ctx: 'Presentando' }],
    ['pres-over', 'tools', 'O', 'Vista general', { tool: 'present', ctx: 'Presentando' }],
    ['pres-full', 'tools', 'F', 'Pantalla completa', { tool: 'present', ctx: 'Presentando' }],
    ['pres-laser', 'tools', 'L', 'Puntero láser', { tool: 'present', ctx: 'Presentando' }],
    ['pres-notes', 'tools', 'N', 'Notas del orador', { tool: 'present', ctx: 'Presentando' }],
    ['pres-pdf', 'tools', 'P', 'Diapositivas en PDF', { tool: 'present', ctx: 'Presentando' }],

    ['card-open', 'board', 'Enter / Space', 'Abrir la tarjeta elegida', { tool: 'kanban' }],
    ['card-save', 'board', 'Ctrl+Enter', 'Guardar la tarjeta', { tool: 'kanban' }],
    ['card-tag', 'board', ', / Enter', 'Sumar una etiqueta o una persona', { tool: 'kanban', ctx: 'En la tarjeta' }],
    ['col-name', 'board', 'Enter / Esc', 'Confirmar o descartar el nombre de la columna', { tool: 'kanban' }],

    ['ed-apply', 'editors', 'Ctrl+Enter', 'Aplicar los cambios'],
    ['ed-cancel', 'editors', 'Esc', 'Cerrar sin aplicar'],
    ['ed-indent', 'editors', 'Tab', 'Sangría', { ctx: 'En un diagrama' }],
    ['ed-hole', 'editors', 'Tab / Shift+Tab', 'Hueco siguiente o anterior', { ctx: 'En una fórmula' }],
    ['code-done', 'editors', 'Ctrl+Enter', 'Terminar de editar un bloque de código', { ctx: 'Editando' }],

    ['ai-here', 'ai', 'Alt+Shift+A', 'Asistente sobre la selección o el bloque', { tool: 'assistant' }],
    ['ai-ask', 'ai', 'Alt+Shift+Q', 'Preguntar sobre la nota', { tool: 'assistant' }],
    ['ai-send', 'ai', 'Enter', 'Enviar la pregunta', { tool: 'assistant', ctx: 'En el asistente' }],
    ['ai-gen', 'ai', 'Ctrl+Enter', 'Generar', { tool: 'assistant', ctx: 'En el asistente' }],

    ['sheet', 'general', '?', 'Ver esta hoja'],
    ['sheet-any', 'general', 'Ctrl+/', 'Ver esta hoja, también mientras escribís'],
    ['close', 'general', 'Esc', 'Cerrar un menú, un cuadro o el buscador'],
    ['comment', 'general', 'Ctrl+Enter', 'Enviar un comentario', { on: 'app' }],
  ].map((r) => ({ id: r[0], group: r[1], keys: r[2], text: r[3], when: r[4] || {} }));

  // ---------- Cómo se escribe cada tecla ----------
  const APPLE = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Backspace: '⌫' };
  const ARROWS = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
  const NAMES = {
    es: { Space: 'Espacio', Home: 'Inicio', End: 'Fin', PageUp: 'Re Pág', PageDown: 'Av Pág', Backspace: 'Retroceso', Click: 'clic' },
    en: { Space: 'Space', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Backspace: 'Backspace', Click: 'click' },
  };
  const ORDER = ['Ctrl', 'Alt', 'Shift'];
  const label = (key) => {
    if (LMD.device.apple && APPLE[key]) return APPLE[key];
    return ARROWS[key] || (NAMES[LMD.lang()] || NAMES.en)[key] || key;
  };
  // Las formas de un atajo, cada una como lista de teclas ya con su nombre. En Mac rehacer es una sola (⇧⌘Z) y los
  // modificadores van en su orden: ⌥ ⇧ ⌘.
  function combos(keys) {
    const apple = LMD.device.apple; const seen = new Set(); const out = [];
    keys.split(' / ').forEach((one) => {
      if (apple && one === 'Ctrl+Y') one = 'Ctrl+Shift+Z';
      let parts = one === '+' ? ['+'] : one.split('+');
      if (apple) { const mods = ['Alt', 'Shift', 'Ctrl'].filter((m) => parts.includes(m)); parts = mods.concat(parts.filter((p) => !ORDER.includes(p))); }
      const plain = parts.map(label).join(apple ? '' : '+');
      if (seen.has(plain)) return;
      seen.add(plain); out.push({ parts: parts.map(label), plain });
    });
    return out;
  }
  // El atajo como texto, para un título o un lector de pantalla: "Ctrl+S", o "⌘S" en Mac.
  const plain = (keys) => combos(keys).map((c) => c.plain).join(' / ');
  const byId = (id) => LIST.find((s) => s.id === id) || null;
  const keysOf = (id) => { const s = byId(id); return s ? plain(s.keys) : ''; };

  // ---------- Qué se muestra acá ----------
  // Un atajo que acá no existe no se lista: los de la app sobre un archivo abierto directo, los de la extensión en
  // la web, y los de una herramienta que este navegador no puede usar.
  const tool = (id) => LMD.tools.list().find((t) => t.id === id) || null;
  function state(s, core) {
    const w = s.when;
    if (w.on === 'app' && !(core && core.APP)) return 'none';
    if (w.on === 'ext' && window.__MDT_WEB) return 'none';
    if (w.tool) {
      const t = tool(w.tool);
      if (!t || (t.available && t.available())) return 'none';
      if (!LMD.tools.isOn(w.tool)) return 'off';
    }
    return 'on';
  }
  const visible = (core) => LIST.map((s) => Object.assign({ state: state(s, core) }, s)).filter((s) => s.state !== 'none');

  // ---------- La hoja ----------
  const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tight = (t) => fold(t).replace(/[\s+]/g, '');
  let box = null; let back = null;
  const isOpen = () => !!box;


  function row(s) {
    const list = combos(s.keys);
    const keys = list.map((c) => '<span class="lmd-keys-combo">' + c.parts.map((p) => '<kbd>' + esc(p) + '</kbd>').join('') + '</span>').join('<i aria-hidden="true">/</i>');
    const said = list.map((c) => c.plain).join(' / ');
    const off = s.state === 'off';
    return '<li class="lmd-keys-row' + (off ? ' lmd-keys-off' : '') + '" data-id="' + esc(s.id) + '" data-find="' + esc(fold(T(s.text) + ' ' + (s.when.ctx ? T(s.when.ctx) : '') + ' ' + said) + ' ' + tight(said)) + '">' +
      '<span class="lmd-keys-what"><span>' + esc(T(s.text)) + '</span>' +
        (off ? '<button type="button" class="lmd-link" data-keys="tools" data-tool="' + esc(s.when.tool) + '">' + esc(T('Prendela en Ajustes > Herramientas')) + '</button>' : '') + (s.when.ctx ? '<small>' + esc(T(s.when.ctx)) + '</small>' : '') +
      '</span>' +
      '<span class="lmd-keys-set" role="img" aria-label="' + esc(said) + '">' + keys + '</span></li>';
  }

  function close() {
    if (!box) return;
    const b = back; box.remove(); box = null; back = null;
    if (b && b.isConnected && b !== document.body && b.focus) { try { b.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } }
  }

  // from: quién la abrió, para devolverle el foco donde un clic no se lo da al botón (Safari).
  function open(core, from) {
    if (box) { close(); return; }
    const shown = visible(core);
    const a = document.activeElement; back = a && a !== document.body ? a : from || null;
    box = el('div', { class: 'lmd-ask lmd-keys' });
    box.innerHTML = '<div class="lmd-ask-card lmd-keys-card" role="dialog" aria-modal="true" aria-label="' + esc(T('Atajos de teclado')) + '">' +
      '<header class="lmd-keys-head"><h3>' + esc(T('Atajos de teclado')) + '</h3>' +
        '<button type="button" class="lmd-icon-btn" data-keys="close" data-esc aria-label="' + esc(T('Cerrar')) + '" title="' + esc(T('Cerrar')) + '">' + LMD.kit.ICON.close + '</button></header>' +
      '<input type="search" class="lmd-keys-q" spellcheck="false" autocomplete="off" placeholder="' + esc(T('Buscar una acción o una tecla')) + '" aria-label="' + esc(T('Buscar una acción o una tecla')) + '">' +
      '<div class="lmd-keys-body" tabindex="-1"><div class="lmd-keys-cols">' +
        GROUPS.map((g) => {
          const rows = shown.filter((s) => s.group === g[0]);
          return rows.length ? '<section class="lmd-keys-group" data-group="' + g[0] + '"><h4>' + esc(T(g[1])) + '</h4><ul>' + rows.map(row).join('') + '</ul></section>' : '';
        }).join('') +
      '</div><p class="lmd-keys-none" role="status" hidden>' + esc(T('Ningún atajo coincide.')) + '</p></div>' +
      '<p class="lmd-keys-foot">' + esc(T('Esta hoja se abre con {a}, o con {b} mientras escribís.', { a: keysOf('sheet'), b: keysOf('sheet-any') })) + '</p>' +
    '</div>';
    document.body.appendChild(box);
    const q = box.querySelector('.lmd-keys-q'); const none = box.querySelector('.lmd-keys-none');
    const filter = () => {
      const want = fold(q.value.trim()); const wantTight = tight(q.value); let any = false;
      box.querySelectorAll('.lmd-keys-group').forEach((sec) => {
        const title = fold(sec.querySelector('h4').textContent); let n = 0;
        sec.querySelectorAll('.lmd-keys-row').forEach((li) => {
          const hit = !want || title.includes(want) || li.dataset.find.includes(want) || (wantTight && li.dataset.find.includes(wantTight));
          li.hidden = !hit; if (hit) n++;
        });
        sec.hidden = !n; if (n) any = true;
      });
      none.hidden = any;
      // El enlace para prender una herramienta va una vez por herramienta, en su primer renglón a la vista.
      const told = new Set();
      box.querySelectorAll('.lmd-keys-off:not([hidden]) [data-tool]').forEach((b) => { const dup = told.has(b.dataset.tool); told.add(b.dataset.tool); b.hidden = dup; const ctx = b.nextElementSibling; if (ctx) ctx.hidden = !dup; });
    };
    q.addEventListener('input', filter); filter();
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // los atajos del documento no corren con la hoja abierta
      if (e.key === 'Escape' || (e.key === '/' && LMD.mod(e))) { e.preventDefault(); close(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-keys]'); if (!b) return;
      close();
      if (b.dataset.keys === 'tools' && core && core.openPanel) core.openPanel('tools');
    });
    // Con teclado el foco va al buscador; con el dedo, al botón de cerrar, para no levantar el teclado en pantalla.
    (LMD.touch.coarse() ? box.querySelector('[data-keys=close]') : q).focus({ preventScroll: true });
  }

  LMD.shortcuts = { GROUPS, LIST, open, close, isOpen, visible, combos, plain, keysOf };
})();
