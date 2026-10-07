// Primer cuadro: pinta el fondo del tema antes de que cargue el resto, para que cambiar de archivo
// no destelle en blanco. El tema elegido queda anotado por theme.js la última vez que se aplicó.
(function () {
  var dark = null;
  try { var v = localStorage.getItem('lmd:dark'); if (v === '1') dark = true; else if (v === '0') dark = false; } catch (e) { /* sin almacenamiento */ }
  if (dark === null) dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.style.background = dark ? '#121418' : '#fbfaf7';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
