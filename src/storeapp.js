// La app de Android de la tienda es esta misma web empaquetada (Trusted Web Activity). Acá solo se detecta:
// LMD.storeApp vale true cuando la página corre dentro de esa app, y <html> lleva la clase lmd-store-app.
// La app abre con ?src=android y Chrome manda android-app://… como página de origen. Las dos señales se pierden
// al navegar, así que se anota en sessionStorage: dura lo que dura la pestaña de la app y no llega al navegador
// del mismo teléfono (que comparte localStorage con la app, por eso no se usa).
// La extensión nunca es la app de la tienda.
(function () {
  'use strict';
  const KEY = 'sharpmd:store';
  let on = false;
  if (window.__MDT_WEB) {
    try { on = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* sin almacenamiento */ }
    if (!on) {
      let src = '';
      try { src = new URLSearchParams(location.search).get('src') || ''; } catch (e) { /* dirección rara */ }
      on = src === 'android' || /^android-app:\/\//.test(document.referrer || '');
      if (on) { try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* queda para esta página */ } }
    }
  }
  window.LMD.storeApp = on;
  if (on) document.documentElement.classList.add('lmd-store-app');
})();
