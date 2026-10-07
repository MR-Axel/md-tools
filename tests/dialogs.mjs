// Para las pruebas que no son sobre los diálogos: los diálogos propios de la app se contestan solos, como antes
// se pisaban confirm y prompt del navegador. Un campo recibe window.__answer (sin respuesta, se cancela) y una
// confirmación se acepta. Con window.__manual en true no se tocan, y la prueba los maneja a mano.
// Si la app llegara a abrir un cuadro nativo del navegador, queda anotado en window.__native.
// Se pasa a addInitScript: corre dentro de la página, antes que la app.
export function autoDialogs() {
  window.__native = [];
  ['prompt', 'alert', 'confirm'].forEach((k) => { window[k] = () => { window.__native.push(k); return null; }; });
  const answer = () => {
    if (window.__manual) return;
    document.querySelectorAll('.lmd-dlg:not([data-seen])').forEach((d) => {
      d.dataset.seen = '1';
      const input = d.querySelector('input');
      if (input) {
        if (window.__answer == null) { d.querySelector('[data-dlg=no]').click(); return; }
        input.value = window.__answer;
      }
      d.querySelector('[data-dlg=ok]').click();
    });
  };
  new MutationObserver(answer).observe(document, { childList: true, subtree: true });
}
