// Tema claro u oscuro, color de acento y los temas incluidos.
// Un tema es una tabla de colores #rrggbb que se pasa de a una a variables CSS: nunca una hoja de estilo.
(function () {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;

  // Doce temas de fábrica, seis claros y seis oscuros, en todos los planes.
  // Lima y Noche son los de siempre: sus colores están en content.css y acá se repiten para dibujar la miniatura.
  // k s n f c t b: palabra clave, texto, número, función, comentario, etiqueta y nombre propio del lenguaje.
  const P = (id, name, dark, c) => ({ id, name, dark, c });
  const PRESETS = [
    P('lima', 'Lima', false, { bg: '#fbfaf7', side: '#f2f0ea', soft: '#f1efe9', code: '#f1efe9', fg: '#1d2026', muted: '#5c6370', faint: '#646b78', line: '#dedbd2', accent: '#3f6a0a', fill: '#3f6a0a', fillFg: '#ffffff', link: '#1a5fd0', sel: '#d5e6b4', danger: '#c62020',
      k: '#c5303f', s: '#032f62', n: '#005cc5', f: '#6f42c1', c: '#646b78', t: '#1d7a33', b: '#a84a00' }),
    P('arena', 'Arena', false, { bg: '#f6efe0', side: '#ede4d0', soft: '#efe6d3', code: '#ece2cc', fg: '#2b2419', muted: '#5f5443', faint: '#675b48', line: '#d9cdb4', accent: '#874710', fill: '#874710', fillFg: '#ffffff', link: '#1b5585', sel: '#e6d3a8', danger: '#a8231b',
      k: '#9c3526', s: '#35601a', n: '#1b5585', f: '#73429a', c: '#675b48', t: '#255f50', b: '#7d4700' }),
    P('tiza', 'Tiza', false, { bg: '#f4f4f5', side: '#e8e8ea', soft: '#eaeaec', code: '#e6e6e9', fg: '#0b0b0c', muted: '#3f3f46', faint: '#4b4b53', line: '#85858e', accent: '#1a44c2', fill: '#1a44c2', fillFg: '#ffffff', link: '#1a44c2', sel: '#c7d2fe', danger: '#b91c1c',
      k: '#a8004a', s: '#0b5d1e', n: '#0747a6', f: '#5b21b6', c: '#4b4b53', t: '#0f5e63', b: '#873a00' }),
    P('salvia', 'Salvia', false, { bg: '#f3f6ef', side: '#e6ecdf', soft: '#e9efe2', code: '#e4ebdc', fg: '#1c2a20', muted: '#4d5e50', faint: '#556557', line: '#cdd8c5', accent: '#2a6535', fill: '#2a6535', fillFg: '#ffffff', link: '#0d5f6c', sel: '#cfe5c8', danger: '#b42318',
      k: '#952856', s: '#2a6535', n: '#1c5890', f: '#673c9b', c: '#556557', t: '#0d5f6c', b: '#7f4b00' }),
    P('bruma', 'Bruma', false, { bg: '#f2f5f9', side: '#e4e9f0', soft: '#e8edf4', code: '#e3e9f1', fg: '#18222e', muted: '#4a5868', faint: '#536171', line: '#cbd5e1', accent: '#2456a6', fill: '#2456a6', fillFg: '#ffffff', link: '#0a5ba3', sel: '#c9dcf5', danger: '#b91c1c',
      k: '#a02268', s: '#0d6347', n: '#1d55a8', f: '#6a35ae', c: '#536171', t: '#0c5c6f', b: '#864500' }),
    P('tinta', 'Tinta', false, { bg: '#ffffff', side: '#f5f5f5', soft: '#f2f2f2', code: '#f2f2f2', fg: '#000000', muted: '#404040', faint: '#595959', line: '#b3b3b3', accent: '#000000', fill: '#111111', fillFg: '#ffffff', link: '#000000', sel: '#d9d9d9', danger: '#a11212',
      k: '#000000', s: '#3d3d3d', n: '#262626', f: '#000000', c: '#5c5c5c', t: '#1a1a1a', b: '#333333' }),
    P('noche', 'Noche', true, { bg: '#121418', side: '#0c0d10', soft: '#1a1d23', code: '#181b21', fg: '#e6e8ec', muted: '#a0a7b4', faint: '#828999', line: '#2a2e37', accent: '#bef264', fill: '#bef264', fillFg: '#14161a', link: '#7aa7ff', sel: '#3d4a22', danger: '#f87171',
      k: '#ff7b72', s: '#a5d6ff', n: '#79c0ff', f: '#d2a8ff', c: '#8b949e', t: '#7ee787', b: '#ffa657' }),
    P('carbon', 'Carbón', true, { bg: '#0e0e0f', side: '#050505', soft: '#1b1b1d', code: '#18181a', fg: '#f5f5f5', muted: '#bdbdc2', faint: '#9b9ba1', line: '#66666d', accent: '#ffd166', fill: '#ffd166', fillFg: '#111111', link: '#8ab4ff', sel: '#3a3a40', danger: '#ff8a80',
      k: '#ff8fa3', s: '#b5e48c', n: '#8ab4ff', f: '#d6b4fc', c: '#9b9ba1', t: '#7ee0c3', b: '#ffb86b' }),
    P('marea', 'Marea', true, { bg: '#0d1524', side: '#080e1a', soft: '#152036', code: '#121c30', fg: '#dfe7f5', muted: '#9aa9c2', faint: '#8494b0', line: '#24324d', accent: '#7cc4ff', fill: '#7cc4ff', fillFg: '#06121f', link: '#8fb8ff', sel: '#24406e', danger: '#ff8a8a',
      k: '#ff8fb1', s: '#9be3c0', n: '#7cc4ff', f: '#c9a8ff', c: '#8494b0', t: '#6fe0d6', b: '#ffc27a' }),
    P('bosque', 'Bosque', true, { bg: '#0f1712', side: '#0a100c', soft: '#17231b', code: '#142019', fg: '#e2ebe2', muted: '#9db3a2', faint: '#84998a', line: '#26372b', accent: '#8fe0a0', fill: '#8fe0a0', fillFg: '#08130b', link: '#86c8ff', sel: '#244a30', danger: '#ff8f85',
      k: '#ffa07a', s: '#b8e986', n: '#86c8ff', f: '#e0b0ff', c: '#84998a', t: '#6fe3c1', b: '#f2cf66' }),
    P('laguna', 'Laguna', true, { bg: '#0b2027', side: '#071619', soft: '#123038', code: '#0f2a32', fg: '#e6ded0', muted: '#a3b3ad', faint: '#8fa09b', line: '#21434c', accent: '#f2b84b', fill: '#f2b84b', fillFg: '#1a1204', link: '#6fd3e6', sel: '#1f5560', danger: '#ff9080',
      k: '#f59a63', s: '#a8d672', n: '#6fd3e6', f: '#f2b84b', c: '#8fa09b', t: '#7fd9b8', b: '#e59ad0' }),
    P('ciruela', 'Ciruela', true, { bg: '#1a1220', side: '#120c17', soft: '#251a2e', code: '#21172a', fg: '#efe6f2', muted: '#b5a5bd', faint: '#a191aa', line: '#3a2a45', accent: '#f0a6ca', fill: '#f0a6ca', fillFg: '#24101c', link: '#a9b8ff', sel: '#4a2f5c', danger: '#ff8d8d',
      k: '#ff8fb8', s: '#c3e88d', n: '#a9b8ff', f: '#e6b3ff', c: '#a191aa', t: '#7fdcc7', b: '#ffc27a' }),
  ];
  const BASE = { light: 'lima', dark: 'noche' };
  const byId = (id) => PRESETS.find((p) => p.id === id) || null;
  // Cada color del tema y la variable que pinta.
  const VARS = { bg: '--bg', side: '--bg-side', soft: '--bg-soft', code: '--bg-code', fg: '--fg', muted: '--fg-muted', faint: '--fg-faint', line: '--line', link: '--link', sel: '--sel', danger: '--danger',
    k: '--syn-k', s: '--syn-s', n: '--syn-n', f: '--syn-f', c: '--syn-c', t: '--syn-t', b: '--syn-b' };
  const ACCENT = ['--accent', '--accent-soft', '--accent-fg', '--accent-fill', '--accent-knob', '--accent-edge'];
  // Los colores sueltos que puede fijar un tema de la comunidad, con la clave de ajustes donde quedan.
  const CUSTOM = { surface: 'colSurface', text: 'colText', muted: 'colMuted', border: 'colBorder', link: 'colLink' };

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const paperOk = (hex, dark) => HEX.test(hex || '') && (dark ? luminance(hex) <= 0.08 : luminance(hex) >= 0.7);

  // ---------- El oscurecido forzado del navegador ----------
  // Algunos navegadores oscurecen por su cuenta las páginas claras cuando el teléfono está en modo oscuro ("Darken
  // websites" de Chrome, el modo oscuro de Samsung Internet). Encima de un tema claro de la app sale una mezcla que no
  // es ningún tema. La declaración ("only light", boot.js y content.css) lo evita donde el navegador la respeta. Donde
  // no, se detecta y la app muestra su tema oscuro, que el navegador deja como está.
  // La sonda: un color del sistema pedido en claro. Si vuelve oscuro, el navegador está oscureciendo.
  function probe(scheme) {
    try {
      if (!window.CSS || !CSS.supports('background-color', 'Canvas') || !CSS.supports('color-scheme', scheme)) return false;
      const d = document.createElement('div');
      d.style.cssText = 'display:none;background-color:Canvas;color-scheme:' + scheme;
      document.documentElement.appendChild(d);
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(getComputedStyle(d).backgroundColor);
      d.remove();
      return !!m && (m[4] === undefined || Number(m[4]) === 1) && Number(m[1]) + Number(m[2]) + Number(m[3]) < 300;
    } catch (e) { return false; }
  }
  const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  // darkens: el navegador oscurece las páginas claras. deep: lo hace aunque la página declare "only light".
  // Samsung Internet no respeta esa declaración y no deja saberlo desde la página: ahí se da por hecho.
  function forcedDark() {
    const darkens = probe('light');
    const ua = (window.navigator && navigator.userAgent) || '';
    return { darkens, deep: darkens && (probe('only light') || /SamsungBrowser/.test(ua)) };
  }
  let forced = null; // se mira una sola vez por carga
  // Hay que mostrar el tema oscuro aunque el elegido sea claro. "Seguir en claro" lo apaga para siempre.
  function forcing() {
    if (forced === null) { try { forced = !!(window.document && document.documentElement && document.documentElement.appendChild) && forcedDark().deep; } catch (e) { forced = false; } }
    return forced && stored('lmd:keeplight') !== '1';
  }
  function keepLight() { try { localStorage.setItem('lmd:keeplight', '1'); } catch (e) { forced = false; } }
  // El aviso sale una sola vez: devuelve true la primera vez que hay que darlo.
  function forcedNotice() {
    if (!forcing() || stored('lmd:forced-said') === '1') return false;
    try { localStorage.setItem('lmd:forced-said', '1'); } catch (e) { /* sin almacenamiento: sale en cada carga */ }
    return true;
  }

  function modeDark(settings) {
    if (forcing()) return true;
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // El tema incluido que hay puesto, o null si rige el de siempre. Uno claro con el modo oscuro elegido a mano
  // (o al revés) no se aplica.
  function chosen(settings) {
    let p = byId(settings.preset);
    // Con el oscurecido forzado sobre un tema claro, el último tema oscuro que se usó.
    if (forcing() && !(p && p.dark)) p = byId(settings.presetDark);
    if (!p || p.id === BASE.light || p.id === BASE.dark) return null;
    return p.dark === modeDark(settings) ? p : null;
  }
  const isDark = (settings, previewId) => { const p = byId(previewId); return p ? p.dark : modeDark(settings); };

  // Los colores a medida que valen sobre este fondo (los trae un tema de la comunidad). Entran con el plan pago y solo
  // si dejan leer. El color de acento va aparte y es de todos.
  function overrides(settings, dark, pal) {
    const out = {};
    if (!settings.supporter) return out;
    const paper = String(settings[dark ? 'paperDark' : 'paperLight'] || '');
    if (paperOk(paper, dark)) out.bg = paper;
    const bg = out.bg || pal.bg;
    const hex = (k) => (HEX.test(settings[k] || '') ? settings[k] : '');
    const text = hex('colText'); if (text && contrast(text, bg) >= 4.5) out.fg = text;
    const fg = out.fg || pal.fg;
    const muted = hex('colMuted'); if (muted && contrast(muted, bg) >= 4.5) { out.muted = muted; out.faint = muted; }
    const surface = hex('colSurface'); if (surface && contrast(fg, surface) >= 4.5 && contrast(out.muted || pal.muted, surface) >= 4.5) { out.soft = surface; out.code = surface; out.side = surface; }
    const border = hex('colBorder'); if (border && contrast(border, bg) <= contrast(fg, bg)) out.line = border;
    const link = hex('colLink'); if (link && contrast(link, bg) >= 4.5) out.link = link;
    return out;
  }
  // Los colores que se ven ahora: el tema, más lo que la persona cambió a mano.
  function palette(settings, previewId) {
    const dark = isDark(settings, previewId);
    const p = byId(previewId) || chosen(settings) || byId(dark ? BASE.dark : BASE.light);
    const pal = Object.assign({ dark }, p.c);
    if (!previewId) {
      Object.assign(pal, overrides(settings, dark, pal));
      if (HEX.test(settings.accent || '')) { pal.fill = settings.accent; pal.accent = settings.accent; }
    }
    return pal;
  }

  function accent(root, dark, hex, c) {
    const lum = luminance(hex);
    // El relleno usa el color tal cual; el texto se corrige si no contrasta con el fondo del tema.
    let text = hex;
    if (dark && lum < 0.18) text = 'color-mix(in srgb, ' + hex + ' 62%, #fff)';
    if (!dark && lum > 0.32) text = 'color-mix(in srgb, ' + hex + ' 68%, #000)';
    root.style.setProperty('--accent', text);
    root.style.setProperty('--accent-fill', hex);
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + hex + ' 17%, transparent)');
    root.style.setProperty('--accent-fg', lum > 0.36 ? '#14161a' : '#ffffff');
    // Un interruptor prendido se pinta con el acento tal cual. La perilla va en el tono que más contrasta con él, y si
    // el acento se pierde contra el panel o la tarjeta (menos de 3 a 1), el interruptor gana un borde que sí se ve.
    root.style.setProperty('--accent-knob', lum > 0.2 ? '#14161a' : '#ffffff');
    if (c && Math.min(contrast(hex, c.bg), contrast(hex, c.soft)) < 3) root.style.setProperty('--accent-edge', c.muted);
  }

  // Pinta el tema en la página. Con previewId se ve ese tema sin guardarlo: es la vista previa.
  function apply(root, settings, previewId) {
    const dark = isDark(settings, previewId);
    root.classList.toggle('lmd-dark', dark);
    root.classList.toggle('lmd-light', !dark);
    const p = byId(previewId) || chosen(settings);
    const themed = !!p && p.id !== BASE.light && p.id !== BASE.dark;
    root.classList.toggle('lmd-themed', themed);
    Object.keys(VARS).forEach((k) => { if (themed) root.style.setProperty(VARS[k], p.c[k]); else root.style.removeProperty(VARS[k]); });
    ACCENT.forEach((v) => root.style.removeProperty(v));
    if (themed) {
      root.style.setProperty('--accent', p.c.accent);
      root.style.setProperty('--accent-fill', p.c.fill);
      root.style.setProperty('--accent-fg', p.c.fillFg);
      root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + p.c.fill + ' 17%, transparent)');
    }
    let bg = (themed ? p : byId(dark ? BASE.dark : BASE.light)).c.bg;
    if (!previewId) {
      const base = (themed ? p : byId(dark ? BASE.dark : BASE.light)).c;
      const over = overrides(settings, dark, base);
      Object.keys(over).forEach((k) => root.style.setProperty(VARS[k], over[k]));
      if (over.bg) bg = over.bg;
      if (HEX.test(settings.accent || '')) accent(root, dark, settings.accent, Object.assign({}, base, over));
      // Lo lee boot.js en la próxima carga, para pintar el primer cuadro con el fondo que corresponde.
      // Con el modo anotado, boot.js sabe si lo guardado manda (claro u oscuro a mano) o si tiene que mirar el dispositivo.
      try { localStorage.setItem('lmd:dark', dark ? '1' : '0'); localStorage.setItem('lmd:bg', bg); localStorage.setItem('lmd:mode', forcing() ? 'dark' : settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'auto'); } catch (e) { /* sin almacenamiento */ }
    }
    declare(root, dark, bg);
    return { dark, bg };
  }

  // Lo que se le dice al navegador sigue siempre al tema que se ve, no al dispositivo: el esquema de color (en la
  // página y en su <meta>), el fondo de la raíz y el color de las barras del sistema. Con un tema claro va "only light".
  function declare(root, dark, bg) {
    if (!window.document || root !== document.documentElement || !root.style || !document.querySelector) return;
    root.style.colorScheme = dark ? 'dark' : 'light';
    if (!dark) root.style.colorScheme = 'only light';
    root.style.background = bg;
    const scheme = document.querySelector('meta[name=color-scheme]'); if (scheme) scheme.content = dark ? 'dark' : 'only light';
    document.querySelectorAll('meta[name=theme-color]').forEach((bar) => { bar.removeAttribute('media'); bar.content = bg; });
  }

  // Qué miniatura va marcada: el tema puesto, y si la persona cambió algún color a mano.
  function active(settings) {
    const dark = modeDark(settings);
    const p = chosen(settings);
    const paid = settings.supporter && [dark ? 'paperDark' : 'paperLight'].concat(Object.values(CUSTOM)).some((k) => HEX.test(settings[k] || ''));
    return { id: p ? p.id : dark ? BASE.dark : BASE.light, custom: paid || HEX.test(settings.accent || '') || HEX.test(settings.codeColor || '') };
  }
  // Lo que se guarda al aplicar un tema incluido: el tema, su modo, y los colores a mano en blanco.
  function patchFor(id) {
    const p = byId(id); if (!p) return null;
    if (!p.dark && forcing()) keepLight(); // un tema claro elegido a mano: se insiste en claro
    const out = { preset: p.id === BASE.light || p.id === BASE.dark ? '' : p.id, theme: p.dark ? 'dark' : 'light', accent: '', paperLight: '', paperDark: '', codeColor: '' };
    Object.values(CUSTOM).forEach((k) => { out[k] = ''; });
    out[FAMILY(p.dark)] = out.preset;
    return out;
  }
  // El último tema claro y el último oscuro que se usó se recuerdan por separado ('' es el de siempre): al pasar de
  // claro a oscuro, o al revés, vuelve el de esa familia.
  const FAMILY = (dark) => (dark ? 'presetDark' : 'presetLight');
  // Lo que se guarda al elegir Automático, Claro u Oscuro a mano. flipPatch pasa al contrario de lo que se ve.
  function modePatch(settings, mode) {
    const out = { theme: mode === 'light' || mode === 'dark' ? mode : 'auto' };
    // Claro pedido a mano con el oscurecido forzado: es insistir en el tema claro. De ahí en más vale lo elegido.
    if (out.theme === 'light' && forcing()) keepLight();
    const seen = modeDark(settings); const now = chosen(settings); const kept = byId(settings.preset);
    // Lo que se ve es la elección de esta familia, salvo que sea el de siempre por tener puesto uno de la otra.
    if (!kept || kept.dark === seen) out[FAMILY(seen)] = now ? now.id : '';
    if (out.theme === 'auto') return out;
    const dark = out.theme === 'dark';
    if (dark === seen && now) return out;
    const back = byId(FAMILY(dark) in out ? out[FAMILY(dark)] : settings[FAMILY(dark)]);
    out.preset = back && back.dark === dark && back.id !== BASE.light && back.id !== BASE.dark ? back.id : '';
    return out;
  }
  const flipPatch = (settings) => modePatch(settings, modeDark(settings) ? 'light' : 'dark');

  // Los diagramas de Mermaid con los colores del tema. Con los temas de siempre, sus dos temas propios.
  function mermaid(settings) {
    const p = chosen(settings);
    if (!p) return { theme: modeDark(settings) ? 'dark' : 'default' };
    const c = p.c;
    return { theme: 'base', themeVariables: { darkMode: p.dark, background: c.bg, primaryColor: c.soft, primaryTextColor: c.fg, primaryBorderColor: c.muted, lineColor: c.muted, secondaryColor: c.code, tertiaryColor: c.side,
      textColor: c.fg, mainBkg: c.soft, nodeBorder: c.muted, clusterBkg: c.side, clusterBorder: c.line, titleColor: c.fg, edgeLabelBackground: c.bg, noteBkgColor: c.code, noteTextColor: c.fg, noteBorderColor: c.line,
      actorBkg: c.soft, actorBorder: c.muted, actorTextColor: c.fg, signalColor: c.fg, signalTextColor: c.fg, labelBoxBkgColor: c.soft, labelBoxBorderColor: c.muted, labelTextColor: c.fg, loopTextColor: c.fg,
      activationBkgColor: c.code, activationBorderColor: c.muted, sequenceNumberColor: c.bg, pie1: c.fill, pie2: c.n, pie3: c.k, pie4: c.s, pie5: c.f, pie6: c.b, pie7: c.t, pieTitleTextColor: c.fg, pieSectionTextColor: c.bg, pieLegendTextColor: c.fg, pieStrokeColor: c.bg, pieOuterStrokeColor: c.line } };
  }

  // La miniatura: una página chica con el título, dos renglones, un bloque de código y el acento, en los colores del tema.
  // Todo sale de la tabla de arriba, así que va como estilo en línea sin pasar por nadie.
  function thumb(p) {
    const c = p.c; const bar = (color, w) => '<i style="background:' + color + ';width:' + w + '%"></i>';
    return '<span class="lmd-th-page" style="background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.line + '">' +
      '<b>' + p.name + '</b>' + bar(c.muted, 86) + bar(c.muted, 58) +
      '<span class="lmd-th-row"><span class="lmd-th-code" style="background:' + c.code + ';border-color:' + c.line + '">' + bar(c.k, 26) + bar(c.f, 22) + bar(c.s, 30) + '</span>' +
      '<u style="background:' + c.link + '"></u><em style="background:' + c.fill + '"></em></span></span>';
  }

  // El CSS que suma una exportación a HTML para salir con el tema puesto. Vacío con el tema de siempre.
  function exportCss(settings) {
    const a = active(settings);
    if ((a.id === BASE.light || a.id === BASE.dark) && !a.custom) return '';
    const c = palette(settings);
    return 'body{background:' + c.bg + ';color:' + c.fg + ';color-scheme:' + (c.dark ? 'dark' : 'only light') + '}a{color:' + c.link + '}pre,th,.lmd-box,.lmd-alert{background:' + c.soft + '}:not(pre)>code{background:' + c.code + '}' +
      'pre,th,td,h2,hr,blockquote,.lmd-col,.lmd-card{border-color:' + c.line + '}blockquote{color:' + c.muted + '}.lmd-box,.lmd-alert{border-left-color:' + c.fill + '}::selection{background:' + c.sel + ';color:' + c.fg + '}' +
      '.hljs-keyword,.hljs-type,.hljs-doctag{color:' + c.k + '}.hljs-string,.hljs-regexp{color:' + c.s + '}.hljs-number,.hljs-literal,.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-meta{color:' + c.n + '}' +
      '.hljs-title{color:' + c.f + '}.hljs-comment{color:' + c.c + '}.hljs-name,.hljs-selector-tag,.hljs-quote{color:' + c.t + '}.hljs-built_in,.hljs-symbol{color:' + c.b + '}';
  }

  function themeOnly(settings) {
    const root = document.documentElement;
    root.classList.add('lmd-root');
    apply(root, settings);
  }

  LMD.theme = { PRESETS, BASE, CUSTOM, byId, isDark, chosen, active, apply, palette, patchFor, modePatch, flipPatch, mermaid, thumb, exportCss, themeOnly, luminance, contrast, paperOk, forcedDark, forcing, keepLight, forcedNotice };
})();
