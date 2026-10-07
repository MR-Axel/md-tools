// Primer cuadro: pinta el fondo del tema antes de que cargue el resto, para que cambiar de archivo
// no destelle en blanco. El tema elegido queda anotado por theme.js la última vez que se aplicó.
// La pantalla de carga de app.html (el logo con el cursor) toma de acá sus colores.
(function () {
  var dark = null;
  try { var v = localStorage.getItem('lmd:dark'); if (v === '1') dark = true; else if (v === '0') dark = false; } catch (e) { /* sin almacenamiento */ }
  if (dark === null) dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  var bg = dark ? '#121418' : '#fbfaf7';
  root.style.background = bg;
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.setProperty('--lmd-boot-bg', bg);
  root.style.setProperty('--lmd-boot-hash', dark ? '#bef264' : '#4d7c0f');
  root.style.setProperty('--lmd-boot-bar', dark ? '#e8eaee' : '#1d2026');
  // La barra del sistema (en el teléfono y en la app instalada) toma el mismo color.
  var meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = bg;
})();
