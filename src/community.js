// Comunidad: lo que se sumó de la galería y vive en este dispositivo (plantillas, paletas de diagramas y el tema
// aplicado), y la regla que decide qué es un aporte válido. Un aporte es un dato, nunca código: lo que no calza con
// la lista cerrada de abajo se descarta entero, venga del servidor o del almacenamiento.
(function () {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;
  const TYPES = ['template', 'theme', 'palette'];
  const THEME = ['mode', 'accent', 'paperLight', 'paperDark', 'font', 'codeColor', 'diagramShape', 'surface', 'text', 'muted', 'border', 'link'];
  const INK = Object.keys(LMD.theme.CUSTOM); // surface, text, muted, border, link: colores de un modo solo, que tienen que dejar leer
  const PAID = ['paperLight', 'paperDark'].concat(INK); // lo que viene con el plan pago: el fondo y los colores del texto. El acento y la tipografía son de todos
  const COLORS = ['fill', 'text', 'border', 'line', 'second', 'third'];
  const MAX_TEMPLATE = 20 * 1024; const MAX_KEPT = 100;
  // Las tipografías viajan por nombre y se traducen acá a las que la app ya trae. Ninguna otra vale.
  const FONT_IDS = ['Inter', 'System'].concat(LMD.FONTS.slice(2).map((f) => f.name));
  const fontValue = (id) => { const i = FONT_IDS.indexOf(id); return i < 0 ? null : LMD.FONTS[i].value; };
  const fontId = (value) => { const i = LMD.FONTS.findIndex((f) => f.value === (value || '')); return i < 0 ? '' : FONT_IDS[i]; };

  const only = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => keys.includes(k));
  const line = (v) => (typeof v === 'string' ? v : '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  const bytes = (s) => new Blob([s]).size;
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
  const paperOk = (hex, dark) => HEX.test(hex || '') && (dark ? lum(hex) <= 0.08 : lum(hex) >= 0.7);

  function checkData(type, d) {
    const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null);
    if (type === 'template') {
      if (!only(d, ['text']) || typeof d.text !== 'string') return null;
      const text = d.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
      return text.trim() && !text.startsWith('vault1:') && bytes(text) <= MAX_TEMPLATE ? { text } : null;
    }
    if (type === 'theme') {
      if (!only(d, THEME) || !Object.keys(d).length) return null;
      const out = {};
      for (const k of Object.keys(d)) {
        let v = null;
        if (k === 'mode') v = ['auto', 'light', 'dark'].includes(d[k]) ? d[k] : null;
        else if (k === 'diagramShape') v = ['round', 'square'].includes(d[k]) ? d[k] : null;
        else if (k === 'font') v = typeof d[k] === 'string' && fontValue(d[k]) !== null ? d[k] : null;
        else { v = hex(d[k]); if (v && (k === 'paperLight' || k === 'paperDark') && !paperOk(v, k === 'paperDark')) v = null; }
        if (v === null) return null;
        out[k] = v;
      }
      // Texto, secundario y enlace a 4.5 o más sobre el fondo; el panel sin tapar el texto; el borde, más suave que el texto.
      if (INK.some((k) => k in out)) {
        if (out.mode !== 'light' && out.mode !== 'dark') return null;
        const dark = out.mode === 'dark'; const ratio = LMD.theme.contrast; const base = LMD.theme.byId(dark ? LMD.theme.BASE.dark : LMD.theme.BASE.light).c;
        const paper = (dark ? out.paperDark : out.paperLight) || base.bg; const text = out.text || base.fg; const muted = out.muted || base.muted;
        if (ratio(text, paper) < 4.5 || ratio(muted, paper) < 4.5) return null;
        if (out.surface && (ratio(text, out.surface) < 4.5 || ratio(muted, out.surface) < 4.5)) return null;
        if (out.border && ratio(out.border, paper) > ratio(text, paper)) return null;
        if (out.link && ratio(out.link, paper) < 4.5) return null;
      }
      return out;
    }
    if (!only(d, ['colors']) || !only(d.colors, COLORS) || Object.keys(d.colors).length !== COLORS.length) return null;
    const colors = {};
    for (const k of COLORS) { colors[k] = hex(d.colors[k]); if (!colors[k]) return null; }
    return { colors };
  }
  // El aporte limpio, o null. Es la misma regla que aplica el servidor; acá se repite antes de usar cualquier cosa.
  function check(raw) {
    if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null;
    const name = line(raw.name); const about = line(raw.about); const author = line(raw.author);
    if (name.length < 3 || name.length > 60 || about.length > 160 || author.length < 2 || author.length > 40 || author.includes('@')) return null;
    if (typeof raw.lang !== 'string' || !/^[a-z]{2}$/.test(raw.lang)) return null;
    const data = checkData(raw.type, raw.data); if (!data) return null;
    const id = Number.isInteger(raw.id) && raw.id > 0 ? raw.id : 0;
    return { id, type: raw.type, name, about, lang: raw.lang, author, data };
  }

  // Un tema, pasado a los ajustes de la app y al revés. Solo las claves de la lista.
  function toSettings(data) {
    const s = { preset: '' }; // un tema de la comunidad reemplaza al tema incluido que hubiera
    INK.forEach((k) => { if (k in data) s[LMD.theme.CUSTOM[k]] = data[k]; });
    if ('mode' in data) s.theme = data.mode;
    if ('accent' in data) s.accent = data.accent;
    if ('paperLight' in data) s.paperLight = data.paperLight;
    if ('paperDark' in data) s.paperDark = data.paperDark;
    if ('font' in data) s.fontFamily = fontValue(data.font) || '';
    if ('codeColor' in data) s.codeColor = data.codeColor;
    if ('diagramShape' in data) s.diagramShape = data.diagramShape;
    return s;
  }
  // El tema que hay puesto, con lo que se aparta de fábrica. Sin plan pago no entran el fondo ni los colores del texto.
  function fromSettings(s) {
    const d = {};
    if (s.theme === 'light' || s.theme === 'dark') d.mode = s.theme;
    if (HEX.test(s.codeColor || '')) d.codeColor = s.codeColor.toLowerCase();
    if (s.diagramShape === 'square') d.diagramShape = 'square';
    const f = fontId(s.fontFamily); if (f && f !== 'Inter') d.font = f;
    if (s.supporter) {
      // Con un tema incluido puesto, sale con sus colores: el fondo, los paneles, el texto, los bordes, los enlaces y el acento.
      const p = LMD.theme.chosen(s);
      if (p) { d.mode = p.dark ? 'dark' : 'light'; d[p.dark ? 'paperDark' : 'paperLight'] = p.c.bg; d.accent = p.c.fill; d.surface = p.c.soft; d.text = p.c.fg; d.muted = p.c.muted; d.border = p.c.line; d.link = p.c.link; }
      if (d.mode) INK.forEach((k) => { const v = s[LMD.theme.CUSTOM[k]]; if (HEX.test(v || '')) d[k] = v.toLowerCase(); });
      if (paperOk(s.paperLight, false)) d.paperLight = s.paperLight.toLowerCase();
      if (paperOk(s.paperDark, true)) d.paperDark = s.paperDark.toLowerCase();
    }
    if (HEX.test(s.accent || '')) d.accent = s.accent.toLowerCase();
    return d;
  }
  const needsPlan = (data) => PAID.some((k) => k in data);
  // Lo que había puesto antes de aplicar un tema, para volver: las claves de ajustes que un tema puede tocar.
  const KEPT = ['theme', 'accent', 'paperLight', 'paperDark', 'fontFamily', 'codeColor', 'diagramShape', 'preset'].concat(Object.values(LMD.theme.CUSTOM));
  // Cada valor se guarda solo si tiene la forma que le toca: un color es un #rrggbb, y una tipografía, una lista de nombres.
  const snapshot = (s) => Object.assign({ preset: LMD.theme.byId(s.preset) ? s.preset : '' }, ...Object.values(LMD.theme.CUSTOM).map((k) => ({ [k]: HEX.test(s[k] || '') ? s[k] : '' })), {
    theme: ['light', 'dark'].includes(s.theme) ? s.theme : 'auto', diagramShape: s.diagramShape === 'square' ? 'square' : 'round',
    accent: HEX.test(s.accent || '') ? s.accent : '', codeColor: HEX.test(s.codeColor || '') ? s.codeColor : '', paperLight: HEX.test(s.paperLight || '') ? s.paperLight : '', paperDark: HEX.test(s.paperDark || '') ? s.paperDark : '',
    fontFamily: typeof s.fontFamily === 'string' && /^[\w\s",.-]{0,200}$/.test(s.fontFamily) ? s.fontFamily : '',
  });
  // Los temas incluidos, con la forma de un aporte para listarlos en la galería. No pasan por el servidor.
  const ABOUT = { lima: 'Papel claro con acento verde, el de siempre.', arena: 'Papel cálido color arena.', tiza: 'Gris neutro de alto contraste.', salvia: 'Verde suave para leer mucho rato.', bruma: 'Azul frío y despejado.', tinta: 'Blanco y negro, pensado para imprimir.',
    noche: 'Oscuro con acento lima, el de siempre.', carbon: 'Negro neutro de alto contraste.', marea: 'Azul noche.', bosque: 'Verde bosque.', laguna: 'Verde azulado profundo con texto cálido.', ciruela: 'Violeta oscuro con acento rosa.' };
  const included = () => LMD.theme.PRESETS.map((p) => ({ id: p.id, type: 'theme', included: true, name: p.name, about: ABOUT[p.id] || '', dark: p.dark, preset: p }));

  // ---------- Lo guardado en el dispositivo ----------
  let state = { templates: [], palettes: [], theme: null, author: '' };
  let loaded = null;
  const fileOf = (name) => name.replace(/[\\/:*?"<>|#%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'template';
  const kept = (list, type) => (Array.isArray(list) ? list : []).map((x) => check(Object.assign({}, x, { type }))).filter((x) => x && x.id).slice(0, MAX_KEPT);
  function ready() {
    if (!loaded) loaded = new Promise((resolve) => {
      try {
        chrome.storage.local.get('community', (r) => {
          const c = (r && r.community) || {};
          // Lo guardado pasa por la misma regla que lo que llega: nada entra a la app por haber estado en el almacenamiento.
          const t = c.theme && typeof c.theme === 'object' ? c.theme : null;
          state = { templates: kept(c.templates, 'template'), palettes: kept(c.palettes, 'palette'),
            theme: t && Number.isInteger(t.id) && only(t.prev, KEPT) ? { id: t.id, name: line(t.name).slice(0, 60), prev: snapshot(t.prev) } : null, author: line(c.author).slice(0, 40) };
          resolve();
        });
      } catch (e) { resolve(); }
    });
    return loaded;
  }
  const save = () => new Promise((resolve) => { try { chrome.storage.local.set({ community: state }, resolve); } catch (e) { resolve(); } });
  const listOf = (type) => (type === 'template' ? state.templates : state.palettes);
  const has = (type, id) => (type === 'theme' ? !!state.theme && state.theme.id === id : listOf(type).some((x) => x.id === id));
  // Suma una plantilla o una paleta. Devuelve si quedó.
  async function add(raw) {
    await ready();
    const it = check(raw); if (!it || !it.id || it.type === 'theme') return false;
    const list = listOf(it.type).filter((x) => x.id !== it.id); list.unshift(it);
    state[it.type === 'template' ? 'templates' : 'palettes'] = list.slice(0, MAX_KEPT);
    await save(); return true;
  }
  async function remove(type, id) {
    await ready();
    if (type === 'theme') state.theme = null; else state[type === 'template' ? 'templates' : 'palettes'] = listOf(type).filter((x) => x.id !== id);
    await save();
  }
  async function setTheme(it, prev) { await ready(); state.theme = it ? { id: it.id, name: it.name, prev: snapshot(prev) } : null; await save(); }
  async function setAuthor(name) { await ready(); state.author = line(name).slice(0, 40); await save(); }

  LMD.community = {
    check, checkData, toSettings, fromSettings, needsPlan, snapshot, paperOk, fontValue, ready, add, remove, has, setTheme, setAuthor, included,
    TYPES, COLORS, MAX_TEMPLATE, bytes,
    templates: () => state.templates.map((t) => ({ id: t.id, name: t.name, about: t.about, author: t.author, file: fileOf(t.name), text: t.data.text })),
    palettes: () => state.palettes.map((p) => ({ id: p.id, name: p.name, author: p.author, colors: p.data.colors })),
    added: () => state.templates.concat(state.palettes),
    theme: () => state.theme, author: () => state.author,
  };
  // Otra pestaña sumó o quitó algo: se vuelve a leer, y pasa otra vez por la regla.
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.community) { loaded = null; ready(); } }); } catch (e) { /* sin almacenamiento */ }
  ready();
})();
