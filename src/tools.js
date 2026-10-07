// Herramientas: funciones enteras que se prenden y se apagan desde Ajustes > Herramientas. Son nuestras y vienen con
// la app. Sumar una es un archivo con su código y un renglón de register() acá abajo; su archivo se pide recién
// cuando la herramienta está prendida.
(function () {
  'use strict';
  const T = LMD.t;
  const { el, esc } = LMD.kit;
  const svg = (d) => '<svg viewBox="0 0 24 24">' + d + '</svg>';
  const ICON = {
    tools: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 4v7M13 7.500h7M4.500 16.500h6.500"/>'),
    speak: svg('<path d="M4 9.500v5h3.500l4.500 3.500V6L7.500 9.500z"/><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11"/>'),
    mic: svg('<rect x="9" y="3.500" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v2.500M8.500 20.500h7"/>'),
    play: svg('<path d="M8 5.500v13l10.500-6.500z"/>'),
    pause: svg('<path d="M8.500 5.500v13M15.500 5.500v13"/>'),
    stop: svg('<rect x="6.500" y="6.500" width="11" height="11" rx="1.500"/>'),
    help: svg('<circle cx="12" cy="12" r="8.500"/><path d="M9.700 9.500a2.400 2.400 0 1 1 3.300 2.200c-.700.300-1 .800-1 1.600M12 16.300v.200"/>'),
  };

  const tools = [];
  // Lugar para una lista futura de herramientas hechas por la comunidad: hoy no hay ninguna y no se muestra nada.
  const community = [];
  const running = new Set();
  let core = null;

  // register({ id, name, about, icon, defaultOn, enable(core), disable(core), settings?(caja) })
  //   lazy + module: el archivo se pide con core.ensure(lazy) y module() devuelve { enable, disable, settings }.
  //   available(): '' si se puede usar acá, o la línea que dice por qué no.
  function register(tool) {
    if (!tool || !tool.id || tools.some((t) => t.id === tool.id)) return;
    tools.push(tool);
    if (core) apply();
  }

  const state = () => (core && core.settings && core.settings.tools) || {};
  const reason = (tool) => (tool.available ? tool.available() || '' : '');
  const isOn = (id) => {
    const tool = tools.find((t) => t.id === id); if (!tool) return false;
    const saved = state()[id];
    return (typeof saved === 'boolean' ? saved : !!tool.defaultOn) && !reason(tool);
  };
  // Las opciones de cada herramienta viven junto a su interruptor, en las mismas preferencias.
  const opt = (key, fallback) => { const v = state()[key]; return v == null ? fallback : v; };
  const setOpt = (partial) => LMD.patch({ tools: partial });

  // El código de una herramienta: ya está, o se pide ahora.
  async function load(tool) {
    if (!tool.lazy) return tool;
    if (!(await core.ensure(tool.lazy))) return null;
    return tool.module() || null;
  }
  async function start(tool) {
    if (running.has(tool.id)) return;
    running.add(tool.id);
    const mod = await load(tool);
    if (!mod || !running.has(tool.id)) { if (!mod) running.delete(tool.id); return; }
    if (mod.enable) mod.enable(core);
  }
  async function stop(tool) {
    if (!running.has(tool.id)) return;
    running.delete(tool.id);
    const mod = await load(tool);
    if (mod && mod.disable) mod.disable(core);
  }
  // Deja andando lo que está prendido y apaga lo que no.
  function apply() {
    tools.forEach((tool) => { if (isOn(tool.id)) start(tool); else stop(tool); });
  }
  function set(id, on) {
    const partial = {}; partial[id] = !!on;
    // El cambio vale ya, sin esperar a que vuelva del almacenamiento.
    if (core && core.settings) core.settings.tools = Object.assign({}, core.settings.tools, partial);
    apply();
    return setOpt(partial);
  }

  function init(c) {
    core = c;
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) setTimeout(apply, 0); });
    apply();
    // Una herramienta que ya viene cargada y está apagada deshace lo que se haya dibujado antes de saberlo.
    tools.forEach((tool) => { if (!tool.lazy && tool.disable && !isOn(tool.id)) tool.disable(core); });
  }

  // ---------- La pestaña de Ajustes ----------
  function card(tool) {
    const why = reason(tool); const on = isOn(tool.id);
    return '<div class="lmd-tl-card' + (why ? ' lmd-tl-off' : '') + '" data-tool="' + esc(tool.id) + '">' +
      '<span class="lmd-tl-ico" aria-hidden="true">' + (tool.icon || ICON.tools) + '</span>' +
      '<div class="lmd-tl-main"><b>' + esc(T(tool.name)) + '</b><p>' + esc(T(tool.about)) + '</p>' + (why ? '<p class="lmd-tl-why">' + esc(why) + '</p>' : '') + '</div>' +
      ('<label class="lmd-switch"><input type="checkbox" data-tool-on="' + esc(tool.id) + '" aria-label="' + esc(T(tool.name)) + '"' + (on ? ' checked' : '') + (why ? ' disabled' : '') + '><i></i></label>') +
      (tool.settings || tool.lazy ? '<button type="button" class="lmd-link lmd-tl-more" data-tool-opts="' + esc(tool.id) + '" aria-expanded="false"' + (on ? '' : ' hidden') + '>' + esc(T('Opciones')) + '</button><div class="lmd-tl-opts" hidden></div>' : '') +
    '</div>';
  }

  function pane(box) {
    box.innerHTML = '<p class="lmd-hint lmd-tl-lead">' + esc(T('Funciones que se suman a la app. Cada una se prende acá.')) + '</p>' +
      '<div class="lmd-tl-list">' + tools.map(card).join('') + '</div>' +
      '<div class="lmd-tl-list" data-tools-community hidden>' + community.map(card).join('') + '</div>' +
      '<div class="lmd-gal" data-gallery></div>';
    // La galería de la comunidad (gallery.js): contenido que comparte la gente, nunca código. Se pide recién acá.
    const gal = box.querySelector('[data-gallery]');
    Promise.all([core.ensure('tools'), core.ensure('gallery')]).then((ok) => { if (ok[0] && ok[1] && gal.isConnected) LMD.gallery.pane(gal, core); });
    box.querySelectorAll('[data-tool-on]').forEach((input) => input.addEventListener('change', () => {
      set(input.dataset.toolOn, input.checked);
      const more = input.closest('.lmd-tl-card').querySelector('.lmd-tl-more');
      if (more) { more.hidden = !input.checked; if (!input.checked) { more.setAttribute('aria-expanded', 'false'); more.nextElementSibling.hidden = true; } }
    }));
    box.querySelectorAll('[data-tool-opts]').forEach((b) => b.addEventListener('click', async () => {
      const tool = tools.find((t) => t.id === b.dataset.toolOpts); const area = b.nextElementSibling;
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); area.hidden = !open;
      if (!open) return;
      const mod = await load(tool);
      if (mod && mod.settings) mod.settings(area, { close: () => core.ui.panel.querySelector('[data-act=close-panel]').click() }); else area.hidden = true;
    }));
  }

  LMD.tools = { register, init, pane, isOn, set, opt, setOpt, ICON, list: () => tools.slice(), community };

  // ---------- Las que vienen con la app ----------
  const APP_STORE = () => !!LMD.storeApp;
  register({
    id: 'speak', name: 'Leer en voz alta', about: 'Lee la nota con la voz del dispositivo y marca por dónde va.', icon: ICON.speak, defaultOn: false,
    lazy: 'speak', module: () => LMD.speak,
    available: () => (window.speechSynthesis && window.SpeechSynthesisUtterance ? '' : T('Este navegador no tiene voces para leer.')),
  });
  register({
    id: 'dictate', name: 'Dictado', about: 'Escribí hablando, con órdenes para puntuar, dar formato y armar fórmulas y diagramas.', icon: ICON.mic, defaultOn: false,
    lazy: 'dictate', module: () => LMD.dictate,
    available: () => {
      if (window.SpeechRecognition || window.webkitSpeechRecognition) return '';
      if (APP_STORE()) return T('El micrófono no está disponible dentro de esta app. Usá el dictado del teclado.');
      return T('Este navegador no reconoce voz. Funciona en Chrome, Edge y Safari.');
    },
  });
  // El tablero ya viene con la app (board.js) y arranca prendido. Apagado, un bloque kanban se ve como código y no
  // se ofrece insertar uno; el bloque de la nota no cambia. Al cambiar el interruptor la nota abierta se redibuja.
  const redraw = (c, sel) => { if (c && c.ui && c.ui.article && c.ui.article.querySelector(sel) && c.render) c.render(); };
  register({ id: 'kanban', name: 'Tablero kanban', about: 'Un bloque kanban se ve como un tablero con columnas y tarjetas que se arrastran.', icon: LMD.kit.ICON.b_board, defaultOn: true,
    enable: (c) => redraw(c, '.lmd-kanban-off'), disable: (c) => redraw(c, '.lmd-board') });
})();
