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

  // ---------- La vista flotante de cada tarjeta ----------
  // Una escena chica por herramienta, dibujada con CSS (content.css, .lmd-peek): cajitas, líneas y un acento del tema.
  // Sale al pasar el cursor por la tarjeta o al llegar con el teclado, debajo de ella (o arriba si no entra): nunca
  // encima de su interruptor ni de su botón. Con el dedo no hay cursor: no aparece.
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
  };
  const POINTER = !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const PEEK_W = 232; const PEEK_H = 146; const PEEK_WAIT = 320;
  let peekBox = null; let peekTimer = 0;
  function peekHide() { clearTimeout(peekTimer); if (peekBox) peekBox.classList.remove('lmd-on'); }
  function peekShow(cardEl, id) {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      // Con el panel de opciones abierto ya se está configurando una: no hace falta explicar ninguna.
      if (!cardEl.isConnected || !cardEl.offsetParent || cardEl.closest('.lmd-tl-cfg')) return;
      const r = cardEl.getBoundingClientRect();
      let y = r.bottom + 8; if (y + PEEK_H > innerHeight - 12) y = r.top - PEEK_H - 8;
      if (y < 12) return; // ni abajo ni arriba: no sale
      if (!peekBox || !peekBox.isConnected) {
        peekBox = el('div', { class: 'lmd-peek', 'aria-hidden': 'true' }); document.body.appendChild(peekBox);
        // Al mover la lista o cerrar los ajustes con Escape la tarjeta ya no está donde estaba.
        window.addEventListener('scroll', peekHide, { capture: true, passive: true });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') peekHide(); }, true);
      }
      peekBox.innerHTML = PEEK[id]; // la escena arranca de nuevo cada vez
      peekBox.style.left = Math.round(Math.max(12, Math.min(r.left + 50, innerWidth - PEEK_W - 12))) + 'px'; peekBox.style.top = Math.round(y) + 'px';
      peekBox.classList.add('lmd-on');
    }, PEEK_WAIT);
  }
  function peeks(box) {
    if (!POINTER) return;
    box.querySelectorAll('.lmd-tl-card').forEach((c) => {
      const id = c.dataset.tool; if (!PEEK[id]) return;
      c.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') peekShow(c, id); });
      c.addEventListener('pointerleave', peekHide);
      c.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) peekShow(c, id); });
      c.addEventListener('focusout', peekHide);
      c.addEventListener('click', peekHide);
    });
  }

  // ---------- La pestaña de Ajustes ----------
  function card(tool) {
    const why = reason(tool); const on = isOn(tool.id);
    return '<div class="lmd-tl-card' + (why ? ' lmd-tl-off' : '') + '" data-tool="' + esc(tool.id) + '">' +
      '<span class="lmd-tl-ico" aria-hidden="true">' + (tool.icon || ICON.tools) + '</span>' +
      '<div class="lmd-tl-main"><b>' + esc(T(tool.name)) + '</b><p>' + esc(T(tool.about)) + '</p>' + (why ? '<p class="lmd-tl-why">' + esc(why) + '</p>' : '') + '</div>' +
      ('<label class="lmd-switch"><input type="checkbox" data-tool-on="' + esc(tool.id) + '" aria-label="' + esc(T(tool.name)) + '"' + (on ? ' checked' : '') + (why ? ' disabled' : '') + '><i></i></label>') +
      // Las opciones: un botón a la vista que las abre en el panel del costado, y al lado el aviso de lo que le falta para andar.
      (tool.settings || tool.lazy ? '<div class="lmd-tl-acts"' + (on ? '' : ' hidden') + '><button type="button" class="lmd-btn lmd-tl-more" data-tool-opts="' + esc(tool.id) + '" aria-expanded="false" aria-controls="lmd-tl-side"' + (on ? '' : ' hidden') + '><span>' + esc(T('Configurar')) + '</span>' + LMD.kit.ICON.chevron + '</button>' +
        '<button type="button" class="lmd-tl-need" data-tool-need="' + esc(tool.id) + '" hidden></button></div>' : '') +
    '</div>';
  }

  // Dos sub-pestañas: las herramientas de la app, y lo que comparte la comunidad. La última elegida vale por la sesión.
  const SUBS = [['tools', 'Herramientas'], ['community', 'Comunidad']];
  const SUB_KEY = 'lmd:tools-sub';
  let subNow = ''; let paneSub = null;
  // El panel de opciones de la pestaña que está armada, y el ancho en que deja de entrar al costado y tapa toda la
  // pestaña (el mismo corte que en content.css).
  let paneSide = null; let sideWired = false;
  const SIDE_FULL = matchMedia('(max-width: 960px), (max-height: 500px) and (pointer: coarse)');
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
    paneSide = null; box.removeAttribute('inert');
    box.innerHTML = '<div class="lmd-subtabs" role="tablist" aria-label="' + esc(T('Herramientas')) + '">' +
        SUBS.map((x) => '<button type="button" role="tab" id="lmd-tsub-' + x[0] + '" data-tsub="' + x[0] + '" aria-controls="lmd-tsubp-' + x[0] + '">' + esc(T(x[1])) + '</button>').join('') + '</div>' +
      '<div class="lmd-subpane" role="tabpanel" id="lmd-tsubp-tools" aria-labelledby="lmd-tsub-tools" data-tsub-pane="tools">' +
        '<p class="lmd-hint lmd-tl-lead">' + esc(T('Funciones que se suman a la app. Cada una se prende acá.')) + '</p>' +
        '<div class="lmd-tl-list">' + tools.map(card).join('') + '</div>' +
        '<div class="lmd-tl-list" data-tools-community hidden>' + community.map(card).join('') + '</div></div>' +
      '<div class="lmd-subpane" role="tabpanel" id="lmd-tsubp-community" aria-labelledby="lmd-tsub-community" data-tsub-pane="community" hidden><div class="lmd-gal" data-gallery></div></div>';
    // La galería de la comunidad (gallery.js): contenido que comparte la gente, nunca código. Se pide al abrir su sub-pestaña.
    const gal = box.querySelector('[data-gallery]'); let galAsked = false;
    const tabs = Array.from(box.querySelectorAll('[data-tsub]'));
    const showSub = (id, focus) => {
      tabs.forEach((b) => { const on = b.dataset.tsub === id; b.classList.toggle('lmd-on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      if (paneSide) paneSide.shut(false);
      box.querySelectorAll('[data-tsub-pane]').forEach((p) => { p.hidden = p.dataset.tsubPane !== id; });
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
    showSub(subGet());
    const cardOf = (id) => box.querySelector('.lmd-tl-card[data-tool="' + id + '"]');
    const parts = (id) => { const c = cardOf(id); return c ? { more: c.querySelector('.lmd-tl-more'), acts: c.querySelector('.lmd-tl-acts'), input: c.querySelector('[data-tool-on]') } : {}; };
    // Las opciones de una herramienta se abren en un panel al costado, dentro de los mismos Ajustes y fuera de la zona
    // que se desliza: la grilla no cambia de lugar ni de alto. Mientras está abierto, las demás tarjetas quedan
    // atenuadas e inertes (Tab no entra en ellas) y la que se configura queda marcada.
    const host = box.closest('.lmd-panel-card') || box;
    host.querySelectorAll(':scope > .lmd-tl-side').forEach((n) => n.remove());
    const side = el('div', { class: 'lmd-tl-side', id: 'lmd-tl-side', role: 'region', tabindex: '-1', hidden: '' });
    side.innerHTML = '<div class="lmd-tl-side-head">' +
        '<button type="button" class="lmd-btn lmd-tl-back" data-tl-side="close">' + LMD.kit.ICON.chevron + '<span>' + esc(T('Volver')) + '</span></button>' +
        '<span class="lmd-tl-ico" aria-hidden="true"></span><h4></h4>' +
        '<label class="lmd-switch"><input type="checkbox" data-tl-side="on"><i></i></label>' +
        '<button type="button" class="lmd-icon-btn lmd-tl-x" data-tl-side="close" title="' + esc(T('Cerrar')) + '" aria-label="' + esc(T('Cerrar')) + '">' + LMD.kit.ICON.close + '</button></div>' +
      '<div class="lmd-tl-side-body lmd-acct"><div class="lmd-tl-opts"></div></div>';
    host.appendChild(side);
    const sideOn = side.querySelector('[data-tl-side=on]');
    let now = ''; // la herramienta que está en el panel
    const dim = (id) => {
      box.classList.toggle('lmd-tl-cfg', !!id);
      // Sin lugar al costado el panel tapa toda la pestaña: lo de atrás queda inerte entero.
      box.toggleAttribute('inert', !!id && SIDE_FULL.matches);
      box.querySelectorAll('.lmd-tl-card').forEach((c) => {
        const on = !!id && c.dataset.tool === id;
        c.classList.toggle('lmd-tl-now', on); c.toggleAttribute('inert', !!id && !on);
        const b = c.querySelector('.lmd-tl-more'); if (b) b.setAttribute('aria-expanded', String(on));
      });
    };
    // Cierra el panel. Con back, el foco vuelve al botón Configurar de esa tarjeta (o a su interruptor, si ya no hay botón).
    const shut = (back) => {
      if (!now) return false;
      const p = parts(now); now = '';
      side.hidden = true; dim('');
      const to = back && (p.more && !p.more.hidden ? p.more : p.input);
      if (to) to.focus({ preventScroll: true });
      return true;
    };
    // Abre las opciones de una herramienta, o pasa el panel a ella si estaba en otra. Con focus, el foco va a su primer control.
    const show = async (id, focus) => {
      const tool = tools.find((t) => t.id === id); const p = parts(id); if (!tool || !p.more) return;
      peekHide();
      let area = side.querySelector('.lmd-tl-opts');
      if (now !== id) {
        now = id;
        // Un área nueva por herramienta: lo que la anterior dibuje tarde cae en una que ya no está.
        const fresh = el('div', { class: 'lmd-tl-opts' }); area.replaceWith(fresh); area = fresh;
        side.dataset.tool = id; side.setAttribute('aria-label', T('Opciones de {a}', { a: T(tool.name) }));
        side.querySelector('.lmd-tl-ico').innerHTML = tool.icon || ICON.tools;
        side.querySelector('h4').textContent = T(tool.name);
        sideOn.setAttribute('aria-label', T(tool.name));
        side.querySelector('.lmd-tl-side-body').scrollTop = 0;
      }
      sideOn.checked = true;
      side.hidden = false; dim(id);
      if (!side.contains(document.activeElement)) side.focus({ preventScroll: true });
      const mod = await load(tool);
      if (!box.isConnected || now !== id) return;
      // Una herramienta sin opciones no ofrece configurarlas.
      if (!mod || !mod.settings) { p.more.hidden = true; shut(true); return; }
      await mod.settings(area, { close: () => core.ui.panel.querySelector('[data-act=close-panel]').click() });
      if (!focus || now !== id || !area.isConnected) return;
      const first = Array.from(area.querySelectorAll('input, select, textarea, button')).find((n) => !n.disabled && n.type !== 'hidden' && n.offsetParent);
      // Sin un control para usar todavía (presentar pide una nota abierta), el foco queda en el panel.
      if (first) first.focus({ preventScroll: true }); else side.focus({ preventScroll: true });
    };
    side.querySelectorAll('[data-tl-side=close]').forEach((b) => b.addEventListener('click', () => shut(true)));
    // El interruptor del panel es el de la tarjeta: apagarla cierra el panel y deja el foco en el de la tarjeta.
    sideOn.addEventListener('change', () => {
      const input = parts(now).input; if (!input) return;
      input.checked = sideOn.checked; input.dispatchEvent(new Event('change'));
      if (!sideOn.checked) input.focus({ preventScroll: true });
    });
    paneSide = {
      shut: (back) => box.isConnected && shut(back),
      fit: () => { if (now && box.isConnected) dim(now); },
      // Un clic en la zona atenuada. Las tarjetas atenuadas están inertes y el clic cae en lo de atrás: se busca por
      // posición. Sobre una que se puede configurar, el panel pasa a ella; en cualquier otro lado, se cierra.
      tap: (e) => {
        if (!now || !box.isConnected || e.target.closest('.lmd-tl-now')) return;
        const hit = Array.from(box.querySelectorAll('.lmd-tl-card')).find((c) => { const r = c.getBoundingClientRect(); return c.offsetParent && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
        const more = hit && hit.querySelector('.lmd-tl-more');
        if (more && !more.hidden && !more.parentNode.hidden) show(hit.dataset.tool, false); else shut(true);
      },
      // Con el teclado en pantalla la zona visible se achica: el campo que se escribe queda a la vista dentro del panel.
      reveal: () => { const a = document.activeElement; if (now && a && a !== side && side.contains(a)) requestAnimationFrame(() => a.scrollIntoView({ block: 'nearest' })); },
    };
    const zone = box.closest('.lmd-panel-body') || box;
    if (!zone._lmdTlTap) { zone._lmdTlTap = true; zone.addEventListener('click', (e) => { if (paneSide) paneSide.tap(e); }); }
    if (!sideWired) {
      sideWired = true;
      SIDE_FULL.addEventListener('change', () => { if (paneSide) paneSide.fit(); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (paneSide) paneSide.reveal(); });
    }
    // Lo que le falta a una herramienta prendida para andar (el asistente sin su clave): un aviso corto que lleva a la opción.
    const mark = (id, text) => {
      const c = cardOf(id); const n = c && c.querySelector('.lmd-tl-need'); if (!n) return;
      const say = isOn(id) && text ? T(text) : '';
      n.textContent = say; n.hidden = !say;
    };
    const check = async (id) => {
      const tool = tools.find((t) => t.id === id); if (!tool || !isOn(id)) { mark(id, ''); return; }
      const mod = await load(tool); if (!box.isConnected) return;
      let text = ''; try { text = mod && mod.needs ? (await mod.needs()) || '' : ''; } catch (e) { text = ''; }
      mark(id, text);
    };
    paneNeed = (id, text) => { if (box.isConnected) mark(id, text); };
    box.querySelectorAll('[data-tool-on]').forEach((input) => input.addEventListener('change', () => {
      const id = input.dataset.toolOn; set(id, input.checked);
      const p = parts(id); if (!p.more) return;
      p.acts.hidden = !input.checked; p.more.hidden = !input.checked;
      // Al prenderla, sus opciones se abren en el panel; al apagarla se cierra.
      if (input.checked) { show(id, true); check(id); } else { if (now === id) shut(false); mark(id, ''); }
    }));
    box.querySelectorAll('[data-tool-opts]').forEach((b) => b.addEventListener('click', () => {
      if (now === b.dataset.toolOpts) shut(true); else show(b.dataset.toolOpts, false);
    }));
    box.querySelectorAll('[data-tool-need]').forEach((b) => b.addEventListener('click', () => show(b.dataset.toolNeed, true)));
    tools.forEach((tool) => { if ((tool.settings || tool.lazy) && isOn(tool.id)) check(tool.id); });
    peeks(box);
  }

  // Una herramienta avisa desde sus opciones que ya tiene, o que perdió, lo que le faltaba.
  let paneNeed = null;
  const need = (id, text) => { if (paneNeed) paneNeed(id, text); };
  // El panel de opciones abierto se cierra desde afuera (Escape, otra pestaña de Ajustes): dice si había uno.
  const shutSide = (back) => !!paneSide && !!paneSide.shut(back);

  LMD.tools = { register, init, pane, sub, isOn, set, opt, setOpt, need, shut: shutSide, ICON, list: () => tools.slice(), community };

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
})();
