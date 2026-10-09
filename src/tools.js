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
  //   note(): una línea más en la tarjeta, prendida o apagada: lo que hace falta para que muestre algo. No la apaga.
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

  // ---------- La ilustración de cada herramienta ----------
  // Una escena chica por herramienta, dibujada con CSS (content.css, .lmd-peek): cajitas, líneas y un acento del tema.
  // Va dentro del detalle de la herramienta elegida, entre su descripción y sus opciones.
  const L = '<i class="l"></i>';
  const EQ = '<span class="eq"><i></i><i></i><i></i><i></i><i></i></span>';
  const PEEK = {
    speak: '<div class="lmd-pk lmd-pk-speak"><div class="hd"><i class="pl"></i>' + EQ + '</div><div class="tx"><i class="hl"></i>' + L + L + L + '</div></div>',
    dictate: '<div class="lmd-pk lmd-pk-dictate"><div class="hd"><i class="mc"></i>' + EQ + '</div>' + L + L + L + '</div>',
    kanban: '<div class="lmd-pk lmd-pk-board"><div class="bx"><i></i><i class="cd mv"></i><i class="cd"></i></div><div class="bx"><i></i><i class="cd"></i></div><div class="bx"><i></i><i class="cd"></i><i class="cd"></i></div></div>',
    present: '<div class="lmd-pk lmd-pk-present"><div class="bx"><div class="s a">' + L + L + L + '</div><div class="s b">' + L + L + L + '</div></div><div class="dt"><i></i><i></i><i></i><i class="on"></i></div></div>',
    daily: '<div class="lmd-pk lmd-pk-daily"><div class="cal">' + '<i></i>'.repeat(17) + '<i class="t"></i>' + '<i></i>'.repeat(17) + '</div><div class="bx">' + L + L + L + L + '</div></div>',
    docx: '<div class="lmd-pk lmd-pk-conv"><div class="bx"><b>.md</b>' + L + L + L + L + '</div><i class="ar"></i><div class="bx to"><b>.docx</b>' + L + L + L + L + '</div></div>',
    linkmap: '<div class="lmd-pk lmd-pk-map"><i class="e e1"></i><i class="e e2"></i><i class="e e3"></i><i class="n n1"></i><i class="n n2"></i><i class="n n3"></i></div>',
    explore: '<div class="lmd-pk lmd-pk-xp"><i class="e e1"></i><i class="e e2"></i><i class="nd x1"></i><i class="nd x2 on"></i><i class="nd x3"></i><div class="bx">' + L + L + L + '</div></div>',
    jsonyaml: '<div class="lmd-pk lmd-pk-json"><div class="r"><i class="ct"></i><i>{ }</i></div><div class="r in"><i>id</i><i class="v">7</i></div><div class="r in"><i class="ct tg"></i><i>tags</i></div><div class="r in2 kid"><i>0</i><i class="v">"a"</i></div><div class="r in2 kid"><i>1</i><i class="v">"b"</i></div><div class="r in"><i>done</i><i class="v">true</i></div></div>',
    import: '<div class="lmd-pk lmd-pk-conv"><div class="st"><b>.docx</b><b>.pdf</b><b>.xlsx</b></div><i class="ar"></i><div class="bx to"><b>.md</b>' + L + L + L + L + '</div></div>',
    assistant: '<div class="lmd-pk lmd-pk-ai"><div class="bx"><i class="sp"></i>' + L + '</div>' + L + L + L + '</div>',
    agents: '<div class="lmd-pk lmd-pk-agents"><div class="r"><i class="d on"></i><b></b>' + L + '</div><div class="r k"><i class="d on"></i><b></b>' + L + '</div><div class="r k"><i class="d wt"></i><b></b>' + L + '</div><div class="r"><i class="d"></i><b></b>' + L + '</div></div>',
  };

  // ---------- La pestaña de Ajustes ----------
  // Una fila por herramienta: el botón (nombre y descripción) la elige para verla en el detalle, y el interruptor la
  // prende y la apaga ahí mismo. Debajo, lo que no deja usarla y el aviso de lo que le falta para andar. En pantalla
  // ancha las filas van de a dos y muestran solo el nombre: la descripción se lee en el detalle (y en el globo).
  const hasOpts = (tool) => !!(tool.settings || tool.lazy);
  function card(tool) {
    const why = reason(tool); const on = isOn(tool.id); const note = !why && tool.note ? tool.note() || '' : '';
    return '<div class="lmd-tl-card' + (why ? ' lmd-tl-off' : '') + '" role="listitem" data-tool="' + esc(tool.id) + '">' +
      '<span class="lmd-tl-ico" aria-hidden="true">' + (tool.icon || ICON.tools) + '</span>' +
      '<button type="button" class="lmd-tl-main" data-tool-pick="' + esc(tool.id) + '" aria-controls="lmd-tl-side" aria-current="false" title="' + esc(T(tool.about)) + '"><b>' + esc(T(tool.name)) + LMD.kit.ICON.chevron + '</b><p>' + esc(T(tool.about)) + '</p></button>' +
      ('<label class="lmd-switch"><input type="checkbox" data-tool-on="' + esc(tool.id) + '" aria-label="' + esc(T(tool.name)) + '"' + (on ? ' checked' : '') + (why ? ' disabled' : '') + '><i></i></label>') +
      (why || note ? '<p class="lmd-tl-why" title="' + esc(why || note) + '">' + esc(why || note) + '</p>' : '') +
      (hasOpts(tool) ? '<div class="lmd-tl-acts" hidden><button type="button" class="lmd-tl-need" data-tool-need="' + esc(tool.id) + '" hidden></button></div>' : '') +
    '</div>';
  }

  // Dos sub-pestañas: las herramientas de la app, y lo que comparte la comunidad. La última elegida vale por la sesión.
  const SUBS = [['tools', 'Herramientas'], ['community', 'Comunidad']];
  const SUB_KEY = 'lmd:tools-sub';
  let subNow = ''; let paneSub = null;
  // La herramienta elegida también vale por la sesión: al volver a la pestaña el detalle muestra la última que se miró.
  const SEL_KEY = 'lmd:tools-sel';
  let selNow = '';
  // ---------- Lista y detalle ----------
  // Lo comparten las pestañas Herramientas y Plugins de los Ajustes. En pantalla ancha la pestaña son dos zonas
  // fijas: a la izquierda la lista, en una columna y con su scroll, y a la derecha el detalle de lo elegido, siempre a
  // la vista: nada tapa nada y nada cambia de lugar. El detalle va fuera de la zona que se desliza, en su misma celda
  // de los Ajustes. Sin lugar al costado (ventana angosta, teléfono; el mismo corte que en content.css) la lista
  // ocupa todo y el detalle se abre encima, con Volver. Hay uno solo a la vez: el de la pestaña que está abierta.
  const SIDE_FULL = matchMedia('(max-width: 960px), (max-height: 500px) and (pointer: coarse)');
  const wide = () => !SIDE_FULL.matches;
  let cur = null; let sideWired = false;
  // detail(box): arma el detalle de la pestaña cuyo contenido es box, con su cabecera (Volver, ícono, nombre e
  // interruptor) y su cuerpo vacío. shown: si la pestaña lo muestra ahora (Comunidad no). enter(): en angosto, lo
  // abre encima de la lista. shut(back): lo cierra; con back, d.back() devuelve el foco a la fila.
  function detail(box) {
    const host = box.closest('.lmd-panel-card') || box;
    host.querySelectorAll(':scope > .lmd-tl-side').forEach((n) => n.remove());
    if (cur) cur.drop();
    const side = el('div', { class: 'lmd-tl-side', id: 'lmd-tl-side', role: 'region', 'aria-labelledby': 'lmd-tl-side-name', tabindex: '-1', hidden: '' });
    side.innerHTML = '<div class="lmd-tl-side-head">' +
        '<button type="button" class="lmd-btn lmd-tl-back" data-tl-side="close">' + LMD.kit.ICON.chevron + '<span>' + esc(T('Volver')) + '</span></button>' +
        '<span class="lmd-tl-ico" aria-hidden="true"></span><h4 id="lmd-tl-side-name" aria-live="polite"></h4>' +
        '<label class="lmd-switch"><input type="checkbox" data-tl-side="on"><i></i></label></div>' +
      '<div class="lmd-tl-side-body lmd-acct"></div>';
    host.appendChild(side);
    const d = {
      side, shown: true, open: false, back: null,
      // Qué se ve según el ancho: el detalle al costado y siempre presente, o encima de la lista solo si se abrió.
      fit() {
        const here = cur === d && d.shown && box.isConnected;
        host.classList.toggle('lmd-tl-split', here && wide());
        side.hidden = !(here && (wide() || d.open));
        // Abierto encima de la lista, lo de atrás queda inerte entero: Tab no llega a lo que está tapado.
        box.toggleAttribute('inert', here && !wide() && d.open);
      },
      enter() { if (wide() || d.open) return false; d.open = true; d.fit(); return true; },
      shut(back) {
        if (!d.open) return false;
        d.open = false; d.fit();
        if (wide()) return false;
        if (back && d.back) d.back();
        return true;
      },
      drop() { if (cur === d) cur = null; d.open = false; d.fit(); },
    };
    side.querySelector('[data-tl-side=close]').addEventListener('click', () => d.shut(true));
    cur = d;
    if (!sideWired) {
      sideWired = true;
      SIDE_FULL.addEventListener('change', () => { if (!cur) return; if (wide()) cur.open = false; cur.fit(); });
      // Con el teclado en pantalla la zona visible se achica: el campo que se escribe queda a la vista dentro del detalle.
      if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { const a = document.activeElement; if (cur && a && a !== cur.side && cur.side.contains(a)) requestAnimationFrame(() => a.scrollIntoView({ block: 'nearest' })); });
    }
    return d;
  }
  // El detalle sigue al cursor, con intención: pasa a la fila donde el cursor se detiene un instante, no a las que cruza
  // de pasada camino al detalle. Solo cuenta si el cursor se movió de verdad: cuando la lista se desliza debajo de un
  // cursor quieto (las flechas del teclado) no elige nada. Y con el foco dentro del detalle (se está usando uno de sus
  // controles) el cursor no cambia nada: ahí manda el clic. Al salir de la lista, queda lo último que se mostró.
  // Devuelve cómo cancelar la elección que esté en espera. opt: las opciones de los escuchas (su señal de corte).
  const HOVER_REST = 110;
  function follow(d, rows, pick, opt) {
    let timer = 0; let mx = -1; let my = -1;
    const busy = () => { const a = document.activeElement; return !!a && a !== d.side && d.side.contains(a); };
    rows.forEach((r) => {
      r.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || (e.clientX === mx && e.clientY === my)) return;
        mx = e.clientX; my = e.clientY; clearTimeout(timer);
        timer = setTimeout(() => { if (d.side.isConnected && !d.side.hidden && !busy()) pick(r); }, HOVER_REST);
      }, opt);
      r.addEventListener('pointerleave', () => clearTimeout(timer), opt);
    });
    return () => clearTimeout(timer);
  }
  const subGet = () => {
    if (!subNow) { try { subNow = sessionStorage.getItem(SUB_KEY) || ''; } catch (e) { /* sin almacenamiento vale mientras dure la página */ } }
    return SUBS.some((x) => x[0] === subNow) ? subNow : 'tools';
  };
  // Elige una sub-pestaña desde afuera: openPanel('community') llega por acá.
  function sub(id) {
    if (!SUBS.some((x) => x[0] === id)) return;
    subNow = id; try { sessionStorage.setItem(SUB_KEY, id); } catch (e) { /* sin almacenamiento */ }
    if (paneSub) paneSub(id);
  }

  function pane(box) {
    box.removeAttribute('inert');
    box.innerHTML = '<div class="lmd-subtabs" role="tablist" aria-label="' + esc(T('Herramientas')) + '">' +
        SUBS.map((x) => '<button type="button" role="tab" id="lmd-tsub-' + x[0] + '" data-tsub="' + x[0] + '" aria-controls="lmd-tsubp-' + x[0] + '">' + esc(T(x[1])) + '</button>').join('') + '</div>' +
      '<div class="lmd-subpane" role="tabpanel" id="lmd-tsubp-tools" aria-labelledby="lmd-tsub-tools" data-tsub-pane="tools">' +
        '<p class="lmd-hint lmd-tl-lead">' + esc(T('Funciones que se suman a la app. Cada una se prende acá.')) + '</p>' +
        '<div class="lmd-tl-list" role="list" aria-label="' + esc(T('Herramientas')) + '">' + tools.map(card).join('') + '</div>' +
        '<div class="lmd-tl-list" data-tools-community hidden>' + community.map(card).join('') + '</div></div>' +
      '<div class="lmd-subpane" role="tabpanel" id="lmd-tsubp-community" aria-labelledby="lmd-tsub-community" data-tsub-pane="community" hidden><div class="lmd-gal" data-gallery></div></div>';
    // La galería de la comunidad (gallery.js): contenido que comparte la gente, nunca código. Se pide al abrir su sub-pestaña.
    const gal = box.querySelector('[data-gallery]'); let galAsked = false;
    const tabs = Array.from(box.querySelectorAll('[data-tsub]'));
    let d = null;
    const showSub = (id, focus) => {
      tabs.forEach((b) => { const on = b.dataset.tsub === id; b.classList.toggle('lmd-on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      box.querySelectorAll('[data-tsub-pane]').forEach((p) => { p.hidden = p.dataset.tsubPane !== id; });
      if (d) { d.shown = id === 'tools'; d.fit(); }
      if (id === 'community' && !galAsked) {
        galAsked = true;
        // Primero lo que la galería usa (community.js viene con 'tools'), después la galería: recién abierta la app todavía no está.
        core.ensure('tools').then((ok) => ok && core.ensure('gallery')).then((ok) => { if (ok && gal.isConnected) LMD.gallery.pane(gal, core); });
      }
    };
    paneSub = (id) => { if (box.isConnected) showSub(id); };
    tabs.forEach((b) => b.addEventListener('click', () => sub(b.dataset.tsub)));
    // Con el teclado: las flechas, Inicio y Fin pasan de una a otra y la dejan elegida.
    box.querySelector('.lmd-subtabs').addEventListener('keydown', (e) => {
      const at = tabs.indexOf(document.activeElement); if (at < 0) return;
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[e.key]; if (to === undefined) return;
      e.preventDefault(); const next = tabs[(to + tabs.length) % tabs.length];
      sub(next.dataset.tsub); next.focus();
    });

    // El detalle de la herramienta elegida (ver detail): su descripción, su ilustración y sus opciones.
    const list = box.querySelector('.lmd-tl-list');
    const rows = Array.from(list.querySelectorAll('.lmd-tl-card'));
    const cardOf = (id) => rows.find((c) => c.dataset.tool === id) || null;
    const parts = (id) => { const c = cardOf(id); return c ? { pick: c.querySelector('[data-tool-pick]'), input: c.querySelector('[data-tool-on]') } : {}; };
    d = detail(box);
    const side = d.side;
    side.querySelector('.lmd-tl-side-body').innerHTML = '<p class="lmd-tl-about"></p><p class="lmd-tl-why" data-tl-side="why" hidden></p>' +
      '<div class="lmd-peek" aria-hidden="true"></div>' +
      '<p class="lmd-hint lmd-tl-turn" hidden>' + esc(T('Prendela para configurarla.')) + '</p><div class="lmd-tl-opts"></div>';
    const sideOn = side.querySelector('[data-tl-side=on]');
    let sel = ''; // la herramienta que está en el detalle
    let drawing = null; // el último dibujo de opciones, mientras dura
    d.back = () => { const to = parts(sel).pick; if (to) to.focus({ preventScroll: true }); };
    // Las opciones de la herramienta elegida, si está prendida y las tiene. Con focus, el foco va a su primer control.
    const draw = async (focus) => {
      const id = sel; const tool = tools.find((t) => t.id === id); if (!tool) return;
      const why = reason(tool); const on = isOn(id);
      sideOn.checked = on; sideOn.disabled = !!why;
      side.querySelector('.lmd-tl-turn').hidden = on || !!why || !hasOpts(tool);
      // Un área nueva cada vez: lo que la anterior dibuje tarde cae en una que ya no está.
      const area = el('div', { class: 'lmd-tl-opts' }); side.querySelector('.lmd-tl-opts').replaceWith(area);
      if (!on || !hasOpts(tool)) return;
      const mod = await load(tool);
      if (!box.isConnected || sel !== id || !isOn(id) || !area.isConnected || !mod || !mod.settings) return;
      await mod.settings(area, { close: () => core.ui.panel.querySelector('[data-act=close-panel]').click() });
      if (focus && sel === id && area.isConnected) into(area);
    };
    const into = (area) => {
      if (side.hidden) return;
      const first = Array.from(area.querySelectorAll('input, select, textarea, button')).find((n) => !n.disabled && n.type !== 'hidden' && n.offsetParent);
      // Sin un control para usar todavía (presentar pide una nota abierta), el foco queda en el detalle.
      if (first) first.focus({ preventScroll: true }); else side.focus({ preventScroll: true });
    };
    // Solo una fila queda en el orden de Tab (la última elegida con el teclado o con un clic): de la lista se pasa al
    // detalle, y las flechas recorren las filas.
    const rove = (id) => rows.forEach((c) => c.querySelectorAll('[data-tool-pick], [data-tool-on]').forEach((n) => { n.tabIndex = c.dataset.tool === id ? 0 : -1; }));
    // Elige una herramienta: su fila queda marcada y el detalle pasa a ella. enter: en angosto, además lo abre.
    // focus: el foco va a su primer control. hover: la eligió el cursor al pasar. Nada de esto prende ni carga una
    // herramienta apagada.
    const pick = (id, o) => {
      o = o || {};
      const tool = tools.find((t) => t.id === id); if (!tool || !cardOf(id)) return;
      const changed = sel !== id; sel = id; selNow = id;
      try { sessionStorage.setItem(SEL_KEY, id); } catch (e) { /* sin almacenamiento vale mientras dure la página */ }
      if (!o.hover) rove(id);
      if (changed) {
        rows.forEach((c) => {
          const on = c.dataset.tool === id; c.classList.toggle('lmd-tl-now', on);
          c.querySelector('[data-tool-pick]').setAttribute('aria-current', String(on));
        });
        const why = reason(tool) || (tool.note ? tool.note() || '' : '');
        side.dataset.tool = id;
        side.querySelector('.lmd-tl-ico').innerHTML = tool.icon || ICON.tools;
        side.querySelector('h4').textContent = T(tool.name);
        side.querySelector('.lmd-tl-about').textContent = T(tool.about);
        const w = side.querySelector('[data-tl-side=why]'); w.textContent = why; w.hidden = !why;
        const scene = side.querySelector('.lmd-peek'); scene.innerHTML = PEEK[id] || ''; scene.hidden = !PEEK[id]; // la escena arranca de nuevo
        sideOn.setAttribute('aria-label', T(tool.name));
        side.querySelector('.lmd-tl-side-body').scrollTop = 0;
      }
      const entering = !!o.enter && d.enter(); d.fit();
      if (entering && !o.focus) side.focus({ preventScroll: true });
      // Si las opciones todavía se están dibujando (la fila recién tomó el foco), el foco espera a que estén.
      if (changed || o.redraw) drawing = draw(o.focus); else if (o.focus) Promise.resolve(drawing).then(() => { if (sel === id) into(side.querySelector('.lmd-tl-opts')); });
    };
    // Prende o apaga. Al prender una que tiene opciones, el foco pasa a ellas.
    const toggle = (id, on, focus) => {
      set(id, on);
      const input = parts(id).input; if (input) input.checked = on;
      if (on) check(id); else mark(id, '');
      if (on && hasOpts(tools.find((t) => t.id === id))) pick(id, { enter: true, focus, redraw: true });
      else if (sel === id) draw(false);
    };
    sideOn.addEventListener('change', () => toggle(sel, sideOn.checked, false));
    const still = follow(d, rows, (c) => pick(c.dataset.tool, { hover: true }));
    rows.forEach((c) => {
      const id = c.dataset.tool;
      // Toda la fila elige, menos su interruptor y su aviso, que hacen lo suyo. Llegar a ella con el teclado también.
      c.addEventListener('click', (e) => { still(); if (!e.target.closest('.lmd-switch, .lmd-tl-need')) pick(id, { enter: true }); });
      c.addEventListener('focusin', () => pick(id));
      c.querySelector('[data-tool-on]').addEventListener('change', (e) => toggle(id, e.target.checked, true));
      const n = c.querySelector('[data-tool-need]'); if (n) n.addEventListener('click', () => pick(id, { enter: true, focus: true }));
    });
    // Con el teclado: las flechas recorren la grilla (en pantalla ancha, de a dos: izquierda y derecha cambian de
    // columna, arriba y abajo de fila), Inicio y Fin van a las puntas, y el detalle las sigue.
    list.addEventListener('keydown', (e) => {
      const from = e.target.closest('[data-tool-pick], [data-tool-on]'); if (!from || e.altKey || e.ctrlKey || e.metaKey) return;
      const at = rows.indexOf(from.closest('.lmd-tl-card'));
      const cols = wide() ? 2 : 1; const side2 = cols > 1 ? { ArrowRight: at % 2 ? at : at + 1, ArrowLeft: at % 2 ? at - 1 : at } : {};
      const to = Object.assign({ ArrowDown: at + cols, ArrowUp: at - cols, Home: 0, End: rows.length - 1 }, side2)[e.key]; if (to === undefined || at < 0) return;
      e.preventDefault(); const next = rows[to]; if (!next || next === rows[at]) return;
      pick(next.dataset.tool);
      const same = next.querySelector(from.matches('[data-tool-on]') ? '[data-tool-on]:not(:disabled)' : '[data-tool-pick]') || next.querySelector('[data-tool-pick]');
      same.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest' });
    });
    // Lo que le falta a una herramienta prendida para andar (el asistente sin su clave): un aviso corto que lleva a la opción.
    const mark = (id, text) => {
      const c = cardOf(id); const n = c && c.querySelector('.lmd-tl-need'); if (!n) return;
      const say = isOn(id) && text ? T(text) : '';
      n.textContent = say; n.hidden = !say; n.parentNode.hidden = !say;
    };
    const check = async (id) => {
      const tool = tools.find((t) => t.id === id); if (!tool || !isOn(id)) { mark(id, ''); return; }
      const mod = await load(tool); if (!box.isConnected) return;
      let text = ''; try { text = mod && mod.needs ? (await mod.needs()) || '' : ''; } catch (e) { text = ''; }
      mark(id, text);
    };
    paneNeed = (id, text) => { if (box.isConnected) mark(id, text); };
    paneShow = (id) => { if (!box.isConnected || !cardOf(id)) return; if (d.shown) cardOf(id).scrollIntoView({ block: 'nearest' }); pick(id, { enter: true, focus: true }); };
    tools.forEach((tool) => { if (hasOpts(tool) && isOn(tool.id)) check(tool.id); });
    // El detalle nunca está vacío: arranca en la última herramienta que se miró, o en la primera.
    if (!selNow) { try { selNow = sessionStorage.getItem(SEL_KEY) || ''; } catch (e) { /* sin almacenamiento */ } }
    showSub(subGet());
    if (rows.length) pick(cardOf(selNow) ? selNow : rows[0].dataset.tool);
  }

  // Una herramienta avisa desde sus opciones que ya tiene, o que perdió, lo que le faltaba.
  let paneNeed = null;
  const need = (id, text) => { if (paneNeed) paneNeed(id, text); };
  // Lleva al detalle de una herramienta, con el foco en sus opciones (el asistente sin clave manda acá).
  let paneShow = null;
  const show = (id) => { if (paneShow) paneShow(id); };
  // El detalle abierto encima de la lista (pantalla angosta) se cierra desde afuera con Escape: dice si había uno.
  const shutSide = (back) => !!cur && cur.shut(back);
  // Los Ajustes pasaron a otra pestaña: el detalle no sigue a la vista.
  const leave = () => { if (cur) cur.drop(); };

  LMD.tools = { register, init, pane, sub, isOn, set, opt, setOpt, need, show, detail, follow, shut: shutSide, leave, ICON, list: () => tools.slice(), community };

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
      // Samsung Internet anuncia el reconocimiento de voz pero no lo trae entero: consultarlo cuelga la pestaña.
      // Ahí la herramienta queda apagada aunque esté guardada como prendida, y su código ni se pide.
      if (/SamsungBrowser/.test(navigator.userAgent || '')) return T('El dictado no está disponible en este navegador. Funciona en Chrome.');
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
  register({ id: 'present', name: 'Modo presentación', about: 'La nota como diapositivas a pantalla completa, una por título.', defaultOn: false, lazy: 'present', module: () => LMD.present,
    icon: svg('<rect x="3.500" y="4.500" width="17" height="11.500" rx="1.500"/><path d="M12 16v3.500M8.500 19.500h7M10.500 8v4.500l3.800-2.250z"/>') });
  register({ id: 'daily', name: 'Nota diaria', about: 'Abre o crea la nota de hoy, con un calendario del mes.', defaultOn: false, lazy: 'daily', module: () => LMD.daily,
    icon: svg('<rect x="4" y="5.500" width="16" height="14.500" rx="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4M9 14.500l2.200 2.200 4-4.400"/>') });
  register({ id: 'docx', name: 'Exportar a Word', about: 'Suma Word (.docx) al menú Exportar.', defaultOn: false, lazy: 'docx', module: () => LMD.docx,
    icon: svg('<path d="M6.500 3.500h8l4 4v13h-12z"/><path d="M14.500 3.500v4h4M8.800 11.500l1.300 5.500 1.900-4.200 1.900 4.200 1.300-5.500"/>') });
  register({ id: 'linkmap', name: 'Mapa de enlaces', about: 'Qué notas enlazan con cuáles, y cuáles llegan a la nota abierta.', defaultOn: false, lazy: 'linkmap', module: () => LMD.linkmap,
    icon: svg('<circle cx="6" cy="7" r="2.300"/><circle cx="18" cy="6" r="2.300"/><circle cx="12" cy="17.500" r="2.300"/><path d="M8.200 6.800l7.500-.600M7.100 9l3.800 6.500M16.900 8l-3.800 7.500"/>') });
  // Un diagrama de flujo de la nota se recorre (explore.js). Apagada, el diagrama se ve como siempre.
  register({ id: 'explore', name: 'Diagramas explorables', about: 'Un diagrama de flujo se recorre: acercar, elegir un nodo para ver sus conexiones y su detalle, plegar grupos y buscar.', defaultOn: false, lazy: 'explore', module: () => LMD.explore,
    icon: svg('<rect x="3.5" y="4.5" width="7" height="5" rx="1.3"/><rect x="13.5" y="14.5" width="7" height="5" rx="1.3"/><path d="M7 9.5v4.5a3 3 0 0 0 3 3h3.5"/><circle cx="16.8" cy="7.2" r="2.8"/><path d="M18.9 9.300l1.800 1.800"/>') });
  register({ id: 'jsonyaml', name: 'JSON y YAML', about: 'Un bloque o un archivo JSON o YAML se ve como un árbol plegable que se edita.', defaultOn: false, lazy: 'jsonyaml', module: () => LMD.jsonyaml,
    icon: svg('<path d="M8.500 4.500c-2 0-2.500 1-2.500 2.500v2.500c0 1.300-.700 2.300-2 2.500 1.300.200 2 1.200 2 2.500V17c0 1.500.500 2.500 2.500 2.500M15.500 4.500c2 0 2.500 1 2.500 2.500v2.500c0 1.300.700 2.300 2 2.500-1.300.200-2 1.200-2 2.500V17c0 1.500-.500 2.500-2.500 2.500"/>') });
  register({ id: 'import', name: 'Importar a Markdown', about: 'Convierte Word, Excel, PowerPoint, PDF, EPUB, HTML y CSV en una nota, sin subir el archivo.', defaultOn: false, lazy: 'import', module: () => LMD.import,
    icon: svg('<path d="M6.500 3.500h8l4 4v13h-12z"/><path d="M14.500 3.500v4h4M12 10.500v6M9.500 14l2.500 2.500 2.500-2.500"/>') });
  // La IA va con la clave de cada persona: las llamadas salen de acá derecho a su proveedor (aikey.js).
  register({ id: 'assistant', name: 'Asistente de IA (con tu clave)', about: 'Mejora, traduce, genera y responde sobre la nota con tu propia clave de Claude, OpenAI, Gemini u otro proveedor.', defaultOn: false, lazy: 'assistant', module: () => LMD.assistant,
    available: () => (window.crypto && window.crypto.subtle && window.indexedDB ? '' : T('Acá no se puede guardar la clave de forma segura.')),
    icon: svg('<path d="M12 3.500l1.900 5.100 5.100 1.900-5.100 1.900L12 17.500l-1.900-5.100L5 10.500l5.100-1.900z"/><path d="M18.500 15.500l.800 2.200 2.200.800-2.200.800-.800 2.200-.800-2.200-2.200-.800 2.200-.800z"/>') });
  // Los agentes que una IA conectada por MCP pone a trabajar, en vivo (agents.js). Los datos están en la nube: sin
  // ella o sin cuenta la tarjeta lo dice. Se pregunta al dibujarla, cuando la cuenta ya se leyó.
  register({ id: 'agents', name: 'Agentes', about: 'Muestra en vivo los agentes de tu IA que trabajan en tus notas de la nube: quién, en qué y qué necesita.', defaultOn: false, lazy: 'agents', module: () => LMD.agents,
    note: () => (!LMD.cloud.enabled() ? T('La nube está apagada: sin ella no hay agentes para mostrar.') : LMD.cloud.signedIn() && !LMD.cloud.guest() ? '' : T('Necesita una cuenta de SharpMD. Sin entrar no muestra nada.')),
    icon: svg('<circle cx="12" cy="6" r="2.500"/><circle cx="6.500" cy="17.500" r="2.500"/><circle cx="17.500" cy="17.500" r="2.500"/><path d="M12 8.500v3M6.500 15v-3.500h11V15"/>') });
})();
