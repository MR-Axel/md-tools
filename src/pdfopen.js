// "Abrir los PDF del disco con SharpMD" (Ajustes > Instalar, apagado de fábrica).
//
// Este script no está en el manifest. El service worker lo registra sobre file:///*.pdf al prender ese ajuste y lo
// quita al apagarlo (bridge-sw.js, syncPdf): con el ajuste apagado no corre nada sobre un PDF, y nunca corre sobre un
// PDF de un sitio web. Acá no se lee ni se toca el documento: solo se le pide al service worker que esta pestaña
// pase al visor de SharpMD. Él vuelve a mirar el ajuste y arma la dirección con la que informa el navegador.
// No se pide:
//  - con #lmd-native en la dirección: es la salida "Abrir con el visor del navegador" del visor;
//  - si se llegó con atrás o adelante: volver desde SharpMD deja el visor del navegador, en vez de rebotar;
//  - fuera del marco principal, o si lo que cargó no es un PDF.
(function () {
  'use strict';
  if (window.top !== window || location.protocol !== 'file:' || !/\.pdf$/i.test(location.pathname)) return;
  if (/(^#|&)lmd-native(&|$)/.test(location.hash)) return;
  const type = (document.contentType || '').toLowerCase();
  if (type && type !== 'application/pdf') return;
  let how = '';
  try { how = performance.getEntriesByType('navigation')[0].type; } catch (e) { /* sin ese dato: se pide igual */ }
  if (how === 'back_forward') return;
  try { chrome.runtime.sendMessage({ type: 'diskView', hash: location.hash }, () => { void chrome.runtime.lastError; }); } catch (e) { /* extensión recargada: queda el visor del navegador */ }
})();
