// Diálogos propios para lo que antes pedía el navegador: un campo con su validación, o una confirmación.
// Enter confirma, Escape cancela, y el botón dice qué pasa.
(function () {
  'use strict';

  const { el } = LMD.kit;
  const T = LMD.t;

  // Arma la ventana y devuelve cómo cerrarla. El foco vuelve a donde estaba.
  function frame(o, inner, resolve) {
    const back = document.activeElement;
    const box = el('div', { class: 'lmd-ask lmd-dlg' });
    box.innerHTML = '<div class="lmd-ask-card lmd-dlg-card" role="dialog" aria-modal="true"><h3></h3>' + inner +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-dlg="no" data-esc></button>' + (o.alt ? '<button type="button" class="lmd-btn" data-dlg="alt"></button>' : '') + '<button type="button" class="lmd-btn ' + (o.danger ? 'lmd-btn-danger' : 'lmd-btn-fill') + '" data-dlg="ok"></button></div></div>';
    box.querySelector('.lmd-dlg-card').setAttribute('aria-label', o.title);
    box.querySelector('h3').textContent = o.title;
    // cancel: false deja un solo botón, para un aviso que solo se lee.
    if (o.cancel === false) box.querySelector('[data-dlg=no]').remove();
    else box.querySelector('[data-dlg=no]').textContent = o.cancel || T('Cancelar');
    box.querySelector('[data-dlg=ok]').textContent = o.ok || T('Aceptar');
    if (o.alt) box.querySelector('[data-dlg=alt]').textContent = o.alt;
    document.body.appendChild(box);
    let done = false;
    const close = (value) => {
      if (done) return; done = true;
      box.remove();
      if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } }
      resolve(value);
    };
    return { box, close };
  }

  // Pide un texto. validate(valor) devuelve el aviso a mostrar, o nada si sirve; puede ser asíncrona.
  // Con text, un párrafo arriba del campo. Devuelve el texto, o null si se canceló.
  function prompt(o) {
    return new Promise((resolve) => {
      const f = frame(o, (o.text ? '<p class="lmd-dlg-text"></p>' : '') + '<label class="lmd-dlg-field"><span></span><input type="' + (o.password ? 'password' : 'text') + '" spellcheck="false" autocomplete="off"></label><p class="lmd-dlg-err" role="alert" hidden></p>', resolve);
      const input = f.box.querySelector('input'); const err = f.box.querySelector('.lmd-dlg-err'); const label = f.box.querySelector('.lmd-dlg-field span');
      label.textContent = o.label || ''; label.hidden = !o.label;
      if (o.text) f.box.querySelector('.lmd-dlg-text').textContent = o.text;
      if (!o.label) input.setAttribute('aria-label', o.title);
      if (o.placeholder) input.placeholder = o.placeholder;
      input.value = o.value || '';
      input.focus();
      // Con un nombre de archivo queda seleccionado lo que va antes de la extensión.
      const dot = o.stem ? input.value.lastIndexOf('.') : -1;
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      const fail = (text) => { err.hidden = false; err.textContent = text; input.setAttribute('aria-invalid', 'true'); input.focus(); };
      let busy = false;
      const send = async () => {
        if (busy) return;
        const v = o.password ? input.value : input.value.trim();
        if (!v) { fail(o.empty || T('Escribí un nombre.')); return; }
        busy = true;
        let bad = '';
        try { bad = o.validate ? await o.validate(v) : ''; } catch (e) { bad = T('No se pudo completar. Probá de nuevo.'); }
        busy = false;
        if (bad) fail(bad); else f.close(v);
      };
      input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); err.hidden = true; });
      f.box.addEventListener('keydown', (e) => {
        e.stopPropagation(); // los atajos del documento no corren mientras el diálogo está abierto
        if (e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Escape') { e.preventDefault(); f.close(null); }
      });
      f.box.addEventListener('mousedown', (e) => { if (e.target === f.box) f.close(null); });
      f.box.addEventListener('click', (e) => { const b = e.target.closest('[data-dlg]'); if (b) { if (b.dataset.dlg === 'ok') send(); else f.close(null); } });
    });
  }

  // Pregunta antes de hacer algo. Con danger el botón va en rojo. Con alt hay un tercer botón, y devuelve 'alt' si
  // se elige ese. Con link ({ href, text }) suma un enlace que lleva al cobro: dentro de la app de la tienda no se ve.
  // Con more ({ text, link, go }) suma una línea con un enlace que cierra la pregunta y llama a go.
  // Con path, una ruta del disco a la vista, siempre como texto, con su botón para copiarla.
  // Con act, el botón principal no cierra la pregunta: llama a act({ note, close }) en el mismo turno del clic (lo
  // que pide un gesto, como el portapapeles o el selector de archivos, sale de ahí). note(texto) deja una línea a la
  // vista mientras tanto, y close(valor) la cierra.
  function confirm(o) {
    return new Promise((resolve) => {
      const f = frame(o, (o.text ? '<p></p>' : '') + (o.path ? '<div class="lmd-ask-path lmd-dlg-path"><code></code><button type="button" class="lmd-btn" data-dlg-copy></button></div>' : '') + (o.act ? '<p class="lmd-dlg-note" role="status" hidden></p>' : '') + (o.link ? '<p class="lmd-dlg-link" data-pay><a class="lmd-link" target="_blank" rel="noopener"></a></p>' : '') +
        (o.more ? '<p class="lmd-dlg-more"><span></span> <button type="button" class="lmd-link" data-dlg-more></button></p>' : ''), resolve);
      if (o.more) { const m = f.box.querySelector('.lmd-dlg-more'); m.querySelector('span').textContent = o.more.text || ''; m.querySelector('button').textContent = o.more.link; }
      if (o.text) f.box.querySelector('p').textContent = o.text;
      if (o.path) { f.box.querySelector('.lmd-dlg-path code').textContent = o.path; f.box.querySelector('[data-dlg-copy]').textContent = T('Copiar la ruta'); }
      if (o.link) { const a = f.box.querySelector('.lmd-dlg-link a'); a.href = o.link.href; a.textContent = o.link.text; }
      f.box.querySelector('[data-dlg=ok]').focus();
      f.box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); f.close(false); }
      });
      f.box.addEventListener('mousedown', (e) => { if (e.target === f.box) f.close(false); });
      f.box.addEventListener('click', (e) => {
        if (o.more && e.target.closest('[data-dlg-more]')) { f.close(false); o.more.go(); return; }
        const copy = e.target.closest('[data-dlg-copy]');
        if (copy) { try { navigator.clipboard.writeText(o.path).then(() => { copy.textContent = T('Copiado'); }, () => {}); } catch (err) { /* sin portapapeles: la ruta queda a la vista para seleccionarla */ } return; }
        const b = e.target.closest('[data-dlg]'); if (!b) return;
        if (o.act && b.dataset.dlg === 'ok') { o.act({ note: (text) => { const n = f.box.querySelector('.lmd-dlg-note'); n.hidden = !text; n.textContent = text || ''; }, close: f.close }); return; }
        f.close(b.dataset.dlg === 'alt' ? 'alt' : b.dataset.dlg === 'ok');
      });
    });
  }

  // ---------- Lo que vale para todas las ventanas ----------
  // Las ventanas que otros archivos arman a mano (compartir, historial, la cuenta, comentarios, plantillas, los
  // editores de diagramas y fórmulas) comparten tres cosas: Tab no se sale de la ventana de arriba, Escape la
  // cierra aunque ella no lo atienda (con su botón marcado con data-esc), y al cerrarse el foco vuelve a donde estaba.
  const MODALS = ':scope > .lmd-panel:not([hidden]), :scope > .lmd-ask, :scope > .lmd-dgm';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const topModal = () => { const all = document.body.querySelectorAll(MODALS); return all[all.length - 1] || null; };
  const focusables = (box) => Array.from(box.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
  function trap(e, box) {
    const list = focusables(box); if (!list.length) { e.preventDefault(); return; }
    const first = list[0]; const last = list[list.length - 1]; const a = document.activeElement;
    if (!box.contains(a)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  // Lo prende el lector al armar la interfaz: sobre una página que no es Markdown no se engancha nada.
  let watching = false;
  function init() {
  if (watching) return; watching = true;
  // En la fase de captura: varias ventanas frenan sus teclas antes de que lleguen al documento.
  window.addEventListener('keydown', (e) => {
    const top = topModal(); if (!top) return;
    if (e.key === 'Tab') { trap(e, top); return; }
    if (e.key !== 'Escape') return;
    // Primero atiende la ventana, si sabe; lo que siga abierto después se cierra con su botón de salida.
    setTimeout(() => { if (!top.isConnected) return; const b = top.querySelector('[data-esc]'); if (b) b.click(); }, 0);
  }, true);
  new MutationObserver((records) => {
    records.forEach((r) => {
      r.addedNodes.forEach((box) => {
        if (box.nodeType !== 1 || !box.matches('.lmd-ask, .lmd-dgm')) return;
        const a = document.activeElement; box._back = a && a !== document.body ? a : null;
        box.querySelectorAll('[role=dialog]:not([aria-modal])').forEach((n) => n.setAttribute('aria-modal', 'true'));
        // Si la ventana no puso el foco en nada suyo, queda en su primer control: el teclado arranca adentro.
        setTimeout(() => {
          if (!box.isConnected || box.contains(document.activeElement) || topModal() !== box) return;
          const list = focusables(box); const pick = list.find((n) => !LMD.touch.coarse() && n.matches('input:not([readonly]), textarea')) || list.find((n) => n.matches('button, a[href]'));
          if (pick) pick.focus({ preventScroll: true });
        }, 60);
      });
      r.removedNodes.forEach((box) => {
        if (box.nodeType !== 1 || !box._back) return;
        const back = box._back; box._back = null;
        setTimeout(() => { const a = document.activeElement; if ((!a || a === document.body) && back.isConnected && !topModal()) { try { back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } } }, 0);
      });
    });
  }).observe(document.body, { childList: true });
  }

  LMD.dialog = { prompt, confirm, init };
})();
