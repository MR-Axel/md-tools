// Tema claro u oscuro y color de acento.
(function () {
  'use strict';

  function isDark(settings) {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function applyAccent(root, dark, settings) {
    try { localStorage.setItem('lmd:dark', dark ? '1' : '0'); } catch (e) { /* sin almacenamiento */ } // lo lee boot.js en la próxima carga
    // Fondo de la página: uno para el tema claro y otro para el oscuro. Solo vale un color que deje leer el texto.
    const paper = settings.supporter ? String(settings[dark ? 'paperDark' : 'paperLight'] || '') : '';
    if (/^#[0-9a-f]{6}$/i.test(paper) && (dark ? luminance(paper) <= 0.08 : luminance(paper) >= 0.7)) root.style.setProperty('--bg', paper); else root.style.removeProperty('--bg');
    const hex = settings.supporter && /^#[0-9a-f]{6}$/i.test(settings.accent || '') ? settings.accent : '';
    const props = ['--accent', '--accent-soft', '--accent-fg', '--accent-fill'];
    if (!hex) { props.forEach((p) => root.style.removeProperty(p)); return; }
    const lum = luminance(hex);
    // El relleno usa el color tal cual; el texto se corrige si no contrasta con el fondo del tema.
    let text = hex;
    if (dark && lum < 0.18) text = 'color-mix(in srgb, ' + hex + ' 62%, #fff)';
    if (!dark && lum > 0.32) text = 'color-mix(in srgb, ' + hex + ' 68%, #000)';
    root.style.setProperty('--accent', text);
    root.style.setProperty('--accent-fill', hex);
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + hex + ' 17%, transparent)');
    root.style.setProperty('--accent-fg', lum > 0.36 ? '#14161a' : '#ffffff');
  }

  function themeOnly(settings) {
    const root = document.documentElement;
    const dark = isDark(settings);
    root.classList.add('lmd-root');
    root.classList.toggle('lmd-dark', dark);
    root.classList.toggle('lmd-light', !dark);
    applyAccent(root, dark, settings);
  }

  LMD.theme = { isDark, applyAccent, themeOnly };
})();
