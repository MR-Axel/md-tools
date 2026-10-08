// Primer cuadro: pinta el fondo del tema antes de que cargue el resto, para que cambiar de archivo
// no destelle en blanco. El tema elegido queda anotado por theme.js la última vez que se aplicó.
// La pantalla de carga de app.html (el logo con el cursor) toma de acá su fondo.
(function () {
  var dark = null;
  try { var v = localStorage.getItem('lmd:dark'); if (v === '1') dark = true; else if (v === '0') dark = false; } catch (e) { /* sin almacenamiento */ }
  var sys = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // Claro u oscuro elegido a mano manda sobre el dispositivo. En automático manda el dispositivo: si cambió desde la
  // última vez, lo anotado ya no sirve y se pinta el fondo de siempre de ese modo.
  var stale = false;
  try { if (dark !== null && dark !== sys && localStorage.getItem('lmd:mode') === 'auto') { dark = sys; stale = true; } } catch (e) { /* sin almacenamiento */ }
  if (dark === null) dark = sys;
  var root = document.documentElement;
  // En iPhone y iPad, Safari agranda la página al enfocar un campo de letra chica. Con este tope no lo hace, y el
  // zoom con dos dedos sigue andando: iOS no deja que una página lo bloquee.
  var ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    var vp = document.querySelector('meta[name=viewport]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1';
  }
  var bg = dark ? '#121418' : '#fbfaf7';
  // Con un tema incluido o un fondo propio, el color que dejó anotado theme.js.
  try { var kept = localStorage.getItem('lmd:bg'); if (!stale && /^#[0-9a-f]{6}$/i.test(kept || '')) bg = kept; } catch (e) { /* sin almacenamiento */ }
  root.style.background = bg;
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.setProperty('--lmd-boot-bg', bg);
  // La barra del sistema (en el teléfono y en la app instalada) toma el mismo color.
  // Vienen dos, una por esquema de color: con el tema ya sabido, las dos dicen lo mismo.
  var metas = document.querySelectorAll('meta[name=theme-color]');
  for (var i = 0; i < metas.length; i++) { metas[i].removeAttribute('media'); metas[i].content = bg; }
  // En la app instalada en iPhone, la hora y la batería van en blanco sobre un tema oscuro y en negro sobre uno claro.
  var bar = document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]');
  if (bar) bar.content = dark ? 'black-translucent' : 'default';
  // Con una sesión abierta en la web, la conexión al servidor de sincronización se va abriendo mientras carga el resto.
  try {
    if (JSON.parse(localStorage.getItem('mdtools:cloud') || '{}').session) {
      var url = (JSON.parse(localStorage.getItem('mdtools:settings') || '{}') || {}).cloudUrl || 'https://sync.sharpmd.app';
      if (/^https?:\/\//.test(url)) { var link = document.createElement('link'); link.rel = 'preconnect'; link.href = new URL(url).origin; link.crossOrigin = 'anonymous'; document.head.appendChild(link); }
    }
  } catch (e) { /* sin almacenamiento o sin sesión */ }
})();
