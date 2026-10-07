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
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-dlg="no"></button><button type="button" class="lmd-btn ' + (o.danger ? 'lmd-btn-danger' : 'lmd-btn-fill') + '" data-dlg="ok"></button></div></div>';
    box.querySelector('.lmd-dlg-card').setAttribute('aria-label', o.title);
    box.querySelector('h3').textContent = o.title;
    box.querySelector('[data-dlg=no]').textContent = o.cancel || T('Cancelar');
    box.querySelector('[data-dlg=ok]').textContent = o.ok || T('Aceptar');
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
  // Devuelve el texto, o null si se canceló.
  function prompt(o) {
    return new Promise((resolve) => {
      const f = frame(o, '<label class="lmd-dlg-field"><span></span><input type="' + (o.password ? 'password' : 'text') + '" spellcheck="false" autocomplete="off"></label><p class="lmd-dlg-err" role="alert" hidden></p>', resolve);
      const input = f.box.querySelector('input'); const err = f.box.querySelector('.lmd-dlg-err'); const label = f.box.querySelector('.lmd-dlg-field span');
      label.textContent = o.label || ''; label.hidden = !o.label;
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

  // Pregunta antes de hacer algo. Con danger el botón va en rojo.
  function confirm(o) {
    return new Promise((resolve) => {
      const f = frame(o, o.text ? '<p></p>' : '', resolve);
      if (o.text) f.box.querySelector('p').textContent = o.text;
      f.box.querySelector('[data-dlg=ok]').focus();
      f.box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); f.close(false); }
      });
      f.box.addEventListener('mousedown', (e) => { if (e.target === f.box) f.close(false); });
      f.box.addEventListener('click', (e) => { const b = e.target.closest('[data-dlg]'); if (b) f.close(b.dataset.dlg === 'ok'); });
    });
  }

  LMD.dialog = { prompt, confirm };
})();
