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
  // El esquema declarado sigue al tema de la app, no al dispositivo. Con un tema claro va "only light": así el
  // navegador no oscurece la página por su cuenta (el modo oscuro forzado de Chrome) con el teléfono en oscuro.
  // "light" primero, por si el navegador no entiende "only".
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (!dark) root.style.colorScheme = 'only light';
  var scheme = document.querySelector('meta[name=color-scheme]');
  if (scheme) scheme.content = dark ? 'dark' : 'only light';
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

// Un error que nadie atajó (una excepción o una promesa rechazada sin atender) no pasa en silencio: un aviso chico
// abajo, con "Recargar" y "Copiar el detalle". Solo en la app (app.html), no donde el lector corre sobre otra página.
//  - Lo que la app ya ataja y muestra con sus propios avisos no llega acá. Tampoco se avisa de una red que no
//    contesta, un pedido cancelado ni un permiso negado, ni de errores de otro origen (otra extensión).
//  - Un mismo error avisa una sola vez, y hay un solo aviso a la vez.
//  - El detalle no lleva nada de las notas: nombre y mensaje del error sin lo que venga entre comillas, archivo, línea
//    y versión. La dirección de la página (que nombra la nota) no va. Nada se manda a ningún servidor.
(function () {
  if (!/\/src\/app\.html$/.test(location.pathname)) return;
  var seen = {}; var count = 0; var bar = null; var details = [];
  // src/content.js, sin el origen ni lo que venga después del "?".
  function fileOf(u) { var m = /^[a-z-]+:\/\/[^/]*\/([^?#]*)/i.exec(String(u || '')); return m ? m[1].slice(0, 80) : ''; }
  function ours(u) { return !u || String(u).indexOf(location.origin + '/') === 0; }
  // Un mensaje puede citar el texto que no se pudo leer (Unexpected token… "lo que decía la nota"…): lo citado se va.
  // Queda entre comillas simples solo lo que parece un nombre del código (reading 'length').
  function clean(name, msg) {
    var s = String(msg == null ? '' : msg).replace(/"[^"]*"?|`[^`]*`?|“[^”]*”?/g, '"…"');
    s = s.replace(/'([^']*)'?/g, function (all, w) { return name !== 'SyntaxError' && /^[\w$.#-]{2,40}$/.test(w) ? all : "'…'"; });
    return s.replace(/\s+/g, ' ').slice(0, 160);
  }
  function frames(stack) {
    var out = []; var re = /([a-z-]+:\/\/[^\s()]+?):(\d+):(\d+)/gi; var m;
    while ((m = re.exec(String(stack || ''))) && out.length < 5) out.push(fileOf(m[1]) + ':' + m[2] + ':' + m[3]);
    return out;
  }
  function quiet(name, msg) {
    if (/^(AbortError|NotAllowedError|NetworkError|TimeoutError)$/.test(name)) return true;
    if (/ResizeObserver loop/.test(msg)) return true;
    return name === 'TypeError' && /fetch|network|load failed/i.test(msg);
  }
  function es() { try { if (window.LMD && LMD.lang) return LMD.lang() === 'es'; } catch (e) { /* abajo */ } return /^es\b/i.test(navigator.language || ''); }
  function copy(text) {
    var old = function () { var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* sin portapapeles */ } t.remove(); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(old); } catch (e) { /* abajo */ }
    old(); return Promise.resolve();
  }
  function text() {
    var v = ''; try { v = (window.LMD && LMD.VERSION) || ''; } catch (e) { /* sin versión */ }
    return 'SharpMD ' + (v || '?') + (/-extension:$/.test(location.protocol) ? ' (extension)' : ' (web)') + '\n' + details.join('\n') + '\n';
  }
  function show() {
    if (bar || !document.body) return;
    var t = es() ? ['Algo falló de forma inesperada. Recargar suele arreglarlo.', 'Recargar', 'Copiar el detalle', 'Copiado', 'Cerrar'] : ['Something unexpected failed. Reloading usually fixes it.', 'Reload', 'Copy details', 'Copied', 'Close'];
    var btn = 'flex:none;height:34px;padding:0 14px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;';
    var make = function (tag, css, label) { var n = document.createElement(tag); n.style.cssText = css; if (label) n.textContent = label; return n; };
    bar = make('div', 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:90;display:flex;flex-wrap:wrap;align-items:center;gap:10px;box-sizing:border-box;width:max-content;max-width:min(720px,calc(100vw - 32px));padding:12px 12px 12px 18px;border:1px solid var(--line,#8a909c);border-radius:12px;background:var(--bg,#fbfaf7);color:var(--fg,#1d2026);box-shadow:0 18px 44px rgba(0,0,0,.22);font:13.5px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;');
    bar.className = 'lmd-oops'; bar.setAttribute('role', 'alert');
    var go = make('button', btn + 'border:0;background:var(--accent-fill,#4d7c0f);color:var(--accent-fg,#fff);', t[1]);
    var cp = make('button', btn + 'border:1px solid var(--line,#8a909c);background:transparent;color:inherit;', t[2]);
    var x = make('button', btn + 'width:34px;padding:0;border:0;background:transparent;color:inherit;font-size:18px;line-height:1;', '×');
    go.type = cp.type = x.type = 'button'; go.setAttribute('data-oops', 'reload'); cp.setAttribute('data-oops', 'copy'); x.setAttribute('data-oops', 'close'); x.setAttribute('aria-label', t[4]); x.title = t[4];
    go.addEventListener('click', function () { location.reload(); });
    cp.addEventListener('click', function () { copy(text()).then(function () { cp.textContent = t[3]; setTimeout(function () { cp.textContent = t[2]; }, 1500); }); });
    x.addEventListener('click', function () { bar.remove(); bar = null; });
    bar.appendChild(make('span', 'flex:1 1 220px;', t[0])); bar.appendChild(go); bar.appendChild(cp); bar.appendChild(x);
    document.body.appendChild(bar);
  }
  function report(err, msg, file, line, col) {
    var name = (err && err.name) || 'Error';
    var raw = String((err && err.message) || msg || '');
    if (quiet(name, raw)) return;
    var where = file ? fileOf(file) + ':' + (line || 0) + ':' + (col || 0) : (frames(err && err.stack)[0] || '');
    var key = name + '|' + raw.slice(0, 120) + '|' + where;
    if (seen[key] || count >= 20) return; // el mismo error, una vez; y un tope por si algo falla en cadena
    seen[key] = 1; count++;
    var rest = frames(err && err.stack).filter(function (f) { return f !== where; }).slice(0, 4);
    if (details.length >= 5) details.shift();
    details.push(name + ': ' + clean(name, raw) + (where ? '\n  ' + where : '') + rest.map(function (f) { return '\n  ' + f; }).join(''));
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
  window.addEventListener('error', function (e) {
    if (!e || (e.target && e.target !== window)) return; // una imagen o un script que no cargó no es esto
    if (!e.error && (!e.filename || /^Script error\.?$/.test(e.message || ''))) return; // de otro origen: sin datos
    if (!ours(e.filename)) return;
    report(e.error, e.message, e.filename, e.lineno, e.colno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (!r || typeof r.message !== 'string' || typeof r.name !== 'string') return; // un rechazo sin error adentro no dice nada
    var first = /([a-z-]+:\/\/[^\s()]+?):\d+:\d+/i.exec(String(r.stack || ''));
    if (first && !ours(first[1])) return;
    report(r, '', '', 0, 0);
  });
})();
