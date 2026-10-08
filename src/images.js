// Imágenes: achicarlas antes de guardarlas, subirlas como adjuntos a la nube, mostrar las de carpetas protegidas
// y la lista de adjuntos con su uso.
//   - Toda imagen que se pega, se arrastra o se elige pasa por reduce(): si es más grande o más pesada que lo que
//     pide el ajuste "Calidad de las imágenes", se reescala y se recomprime acá, en el navegador. Aunque no haga
//     falta achicarla se le quitan los metadatos (fecha, cámara, ubicación). Con "Original" no se toca.
//   - Dónde queda: en una carpeta del disco, en assets/ al lado del documento; en una nota del navegador, dentro
//     del documento; en una nota de la nube, como adjunto (el Markdown guarda su dirección).
//   - En una carpeta protegida la imagen se cifra acá con la llave de la carpeta antes de subir, y para mostrarla
//     se baja con la sesión y se descifra en memoria.
(function () {
  'use strict';

  const { el, ICON } = LMD.kit;
  const T = LMD.t;
  let core = null;

  const KB = 1024; const MB = 1024 * 1024;
  // Lado máximo en píxeles, peso al que se apunta y calidad con la que se empieza.
  const PRESETS = { normal: { side: 2000, weight: 400 * KB, q: 0.82 }, high: { side: 3200, weight: 1500 * KB, q: 0.92 } };
  const EMBED_MAX = 600 * KB; // una imagen dentro del documento: más que esto no entra en una nota
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
  const CODES = { 'image/png': 1, 'image/jpeg': 2, 'image/gif': 3, 'image/webp': 4, 'image/avif': 5 };
  const fail = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
  const mode = () => { const m = core && core.settings ? core.settings.imageQuality : ''; return m === 'high' || m === 'original' ? m : 'normal'; };
  const sizeText = (n) => (n >= 1024 * MB ? (Math.round(n / (102.4 * MB)) / 10) + ' GB' : n >= MB ? (Math.round(n / (MB / 10)) / 10) + ' MB' : Math.max(1, Math.round(n / KB)) + ' KB');

  // ---------- Qué es, por sus bytes ----------
  const ascii = (b, from, to) => { let s = ''; for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
  function sniff(b) {
    if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (/^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'image/gif';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
    if (ascii(b, 4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(b, 8, 12))) return 'image/avif';
    const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048));
    if (/<svg[\s>]/i.test(head)) return 'image/svg+xml';
    return '';
  }
  // Un GIF con más de un cuadro: se cuentan los bloques de imagen recorriendo su estructura.
  function animatedGif(b) {
    try {
      let p = 13; if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
      let frames = 0;
      while (p < b.length) {
        const k = b[p];
        if (k === 0x3b) break;
        if (k === 0x21) { p += 2; while (p < b.length && b[p]) p += b[p] + 1; p++; continue; }
        if (k !== 0x2c) break;
        if (++frames > 1) return true;
        const flags = b[p + 9]; p += 10; if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
        p++; while (p < b.length && b[p]) p += b[p] + 1; p++;
      }
    } catch (e) { /* un GIF raro: se trata como uno fijo */ }
    return false;
  }
  const animatedWebp = (b) => ascii(b, 12, 16) === 'VP8X' && !!(b[20] & 0x02);

  // ---------- Quitar metadatos sin recomprimir ----------
  // Orientación EXIF de un JPEG (1 a 8), o 0 si no la trae.
  function jpegTurn(b) {
    try {
      let p = 2;
      while (p + 4 < b.length && b[p] === 0xff) {
        const k = b[p + 1]; if (k === 0xda || k === 0xd9) break;
        const len = (b[p + 2] << 8) | b[p + 3];
        if (k === 0xe1 && ascii(b, p + 4, p + 8) === 'Exif') {
          const t = p + 10; const le = ascii(b, t, t + 2) === 'II';
          const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
          const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
          const ifd = t + u32(t + 4); const n = u16(ifd);
          for (let i = 0; i < n && i < 200; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) return u16(e + 8); }
        }
        p += 2 + len;
      }
    } catch (e) { /* sin EXIF legible */ }
    return 0;
  }
  // El JPEG sin EXIF, XMP, comentarios ni datos de otras aplicaciones. Quedan la imagen y su perfil de color.
  function jpegClean(b) {
    const parts = [b.subarray(0, 2)]; let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) return null;
      const k = b[p + 1];
      if (k === 0xda) { parts.push(b.subarray(p)); return new Blob(parts, { type: 'image/jpeg' }); }
      const len = (b[p + 2] << 8) | b[p + 3]; if (len < 2 || p + 2 + len > b.length) return null;
      const app = k >= 0xe0 && k <= 0xef;
      const keep = !(app || k === 0xfe) || k === 0xe0 || k === 0xee || (k === 0xe2 && ascii(b, p + 4, p + 15) === 'ICC_PROFILE');
      if (keep) parts.push(b.subarray(p, p + 2 + len));
      p += 2 + len;
    }
    return null;
  }
  // El PNG sin sus bloques de texto, de fecha ni de EXIF.
  function pngClean(b) {
    const parts = [b.subarray(0, 8)]; let p = 8;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    while (p + 12 <= b.length) {
      const len = view.getUint32(p); const kind = ascii(b, p + 4, p + 8); const end = p + 12 + len;
      if (end > b.length) return null;
      if (!/^(tEXt|zTXt|iTXt|eXIf|tIME)$/.test(kind)) parts.push(b.subarray(p, end));
      p = end;
      if (kind === 'IEND') return new Blob(parts, { type: 'image/png' });
    }
    return null;
  }
  // Un WebP lleva metadatos solo en su forma extendida, y lo dice en sus banderas.
  const webpPlain = (b) => ascii(b, 12, 16) !== 'VP8X' || !(b[20] & 0x0c);

  // ---------- Achicar ----------
  const toBlob = (canvas, type, q) => new Promise((resolve) => { try { canvas.toBlob((x) => resolve(x), type, q); } catch (e) { resolve(null); } });
  let webpOk = null;
  // ¿Este navegador codifica WebP? Si no, toBlob devuelve un PNG aunque se le pida otra cosa.
  async function canWebp() {
    if (webpOk == null) { const c = document.createElement('canvas'); c.width = c.height = 2; const b = await toBlob(c, 'image/webp', 0.8); webpOk = !!b && b.type === 'image/webp'; }
    return webpOk;
  }
  // La imagen decodificada, ya girada como dice su EXIF.
  async function decode(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* se prueba con una etiqueta de imagen */ } }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(fail('bad_image')); };
      img.src = url;
    });
  }
  function draw(src, w, h, white) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d');
    if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function hasAlpha(src, w, h) {
    try {
      const k = Math.min(1, 200 / Math.max(w, h)); const c = draw(src, w * k, h * k);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) { /* sin acceso a los píxeles: se la trata como opaca */ }
    return false;
  }
  // Devuelve { blob, type, width, height, changed, from }. quality: 'normal', 'high' u 'original' (el ajuste, si no se pasa).
  // Errores con code: bad_image (no es una imagen que se pueda leer), svg (un SVG: lo decide quien llama).
  async function reduce(file, quality) {
    const q = quality || mode();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) throw fail('bad_image');
    const same = () => ({ blob: new Blob([bytes], { type }), type, width: 0, height: 0, changed: false, from: bytes.length });
    if (type === 'image/svg+xml') return Object.assign(same(), { svg: true });
    if (q === 'original') return same();
    // Lo animado no se recomprime: perdería el movimiento.
    if ((type === 'image/gif' && animatedGif(bytes)) || (type === 'image/webp' && animatedWebp(bytes))) return Object.assign(same(), { animated: true });
    const p = PRESETS[q] || PRESETS.normal;
    let src;
    try { src = await decode(new Blob([bytes], { type })); } catch (e) { throw fail('bad_image'); }
    const w = src.width; const h = src.height;
    if (!w || !h) throw fail('bad_image');
    const done = (blob, k, changed) => { if (src.close) src.close(); return { blob, type: blob.type, width: Math.round(w * k), height: Math.round(h * k), changed, from: bytes.length }; };
    const fits = Math.max(w, h) <= p.side && bytes.length <= p.weight;
    if (fits) {
      // Ya es chica: alcanza con sacarle los metadatos, sin tocar la imagen. Un JPEG que el EXIF manda girar se
      // vuelve a dibujar, porque sin su EXIF quedaría acostado.
      let clean = null;
      if (type === 'image/jpeg' && jpegTurn(bytes) <= 1) clean = jpegClean(bytes);
      else if (type === 'image/png') clean = pngClean(bytes);
      else if (type === 'image/webp' && webpPlain(bytes)) clean = new Blob([bytes], { type });
      else if (type === 'image/gif') clean = new Blob([bytes], { type });
      if (clean) return done(clean, 1, clean.size !== bytes.length);
    }
    const alpha = type !== 'image/jpeg' && hasAlpha(src, w, h);
    const webp = await canWebp();
    const out = webp ? 'image/webp' : alpha ? 'image/png' : 'image/jpeg';
    let k = Math.min(1, p.side / Math.max(w, h)); let best = null;
    for (let turn = 0; turn < 7; turn++) {
      const canvas = draw(src, w * k, h * k, out === 'image/jpeg');
      for (const step of out === 'image/png' ? [1] : [p.q, p.q - 0.12, p.q - 0.24]) {
        const b = await toBlob(canvas, out, step);
        if (b && (!best || b.size < best.blob.size)) best = { blob: b, k };
        if (b && b.size <= p.weight) break;
      }
      if (best && best.blob.size <= p.weight) break;
      k *= 0.8;
    }
    if (!best) throw fail('bad_image');
    // Un PNG que al recomprimirlo no mejora (un dibujo de pocos colores, una captura) se queda como PNG.
    if (type === 'image/png' && best.k === 1 && Math.max(w, h) <= p.side && best.blob.size >= bytes.length) { const clean = pngClean(bytes); if (clean) return done(clean, 1, clean.size !== bytes.length); }
    return done(best.blob, best.k, true);
  }

  // Un SVG sin nada que se ejecute: sin scripts, sin manejadores, sin contenido ajeno ni direcciones de código.
  // Devuelve el texto saneado, o null si no es un SVG.
  function cleanSvg(text) {
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (e) { return null; }
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || doc.querySelector('parsererror')) return null;
    const BAD = /^(script|foreignobject|iframe|object|embed|audio|video|handler|listener|set|animate|animatetransform|animatemotion)$/i;
    const all = [root].concat(Array.from(root.querySelectorAll('*')));
    for (const node of all) {
      if (BAD.test(node.localName)) { if (node !== root) node.remove(); else return null; continue; }
      for (const a of Array.from(node.attributes)) {
        const name = a.name.toLowerCase(); const v = a.value.replace(/[\u0000- ]/g, '').toLowerCase();
        if (name.startsWith('on')) node.removeAttribute(a.name);
        else if ((name === 'href' || name.endsWith(':href') || name === 'src') && !(v.startsWith('#') || v.startsWith('data:image/png') || v.startsWith('data:image/jpeg') || v.startsWith('data:image/gif') || v.startsWith('data:image/webp'))) node.removeAttribute(a.name);
        else if (/javascript:|data:text|expression\(|@import/.test(v)) node.removeAttribute(a.name);
      }
      if (node.localName === 'style' && /@import|javascript:|expression\(|url\(\s*['"]?\s*(?!#|data:image\/(png|jpeg|gif|webp))/i.test(node.textContent)) node.remove();
    }
    return new XMLSerializer().serializeToString(root);
  }

  // ---------- Dónde va ----------
  const kindHere = () => { try { const r = core.APP && core.HERE ? core.rootOf(core.HERE) : null; return r ? r.kind : ''; } catch (e) { return ''; } };
  const inCloud = () => kindHere() === 'cloud' && LMD.cloud.signedIn() && !LMD.cloud.guest();
  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const dataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(fail('bad_image')); r.readAsDataURL(blob); });
  const spaceOf = (path) => (LMD.cloud.isTeam(path) ? String(LMD.cloud.teamNow().space) : '');
  const withSpace = (at, space, more) => { const q = [space ? 'o=' + space : '', more || ''].filter(Boolean).join('&'); return at + (q ? '?' + q : ''); };

  // El uso y los topes de un espacio, como los dice el servidor. Se recuerdan un rato para no pedirlos por imagen.
  const usage = new Map();
  async function limitsOf(space, fresh) {
    const hit = usage.get(space);
    if (!fresh && hit && Date.now() - hit.at < 60000) return hit.data;
    const data = await LMD.cloud.binary('GET', withSpace('/files', space));
    usage.set(space, { at: Date.now(), data });
    return data;
  }
  const forgetUsage = () => usage.clear();

  // Cifra una imagen con la llave de su carpeta: nonce de 12 bytes y AES-256-GCM, como las notas. Adentro, antes
  // de la imagen, va un byte que dice de qué tipo es.
  const AAD = new TextEncoder().encode('sharpmd image v1');
  async function sealBytes(key, bytes, type) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new Uint8Array(bytes.length + 1); plain[0] = CODES[type] || 0; plain.set(bytes, 1);
    const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plain));
    const out = new Uint8Array(12 + body.length); out.set(iv, 0); out.set(body, 12);
    return out;
  }
  async function openBytes(key, raw) {
    const body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: AAD }, key, raw.subarray(12)));
    const type = Object.keys(CODES).find((t) => CODES[t] === body[0]);
    if (!type) throw fail('bad_image');
    return new Blob([body.subarray(1)], { type });
  }

  // Sube una imagen ya reducida al espacio de esa nota. Devuelve { src, view }: lo que va en el Markdown y lo que
  // se muestra ahora. Errores con code: file_too_large, storage_full, bad_image, vault_locked, offline, too_many.
  async function upload(r, path) {
    if (r.svg) throw fail('svg_cloud');
    const space = spaceOf(path);
    let vk = null;
    try { vk = await LMD.cloud.vaultKey(path); } catch (e) { throw fail('vault_locked'); }
    // Lo que el servidor va a rechazar se avisa antes de mandarlo.
    let lim = null;
    try { lim = await limitsOf(space); } catch (e) { if (e.code === 'offline') throw e; }
    if (lim && lim.plan === 'free' && !lim.max) throw fail('files_need_plan', { plan: 'free' });
    if (lim) {
      const max = lim.max_file;
      if (r.blob.size > max) throw fail('file_too_large', { max, size: r.blob.size, plan: lim.plan });
      if (lim.used + r.blob.size > lim.max) throw fail('storage_full', { used: lim.used, max: lim.max, plan: lim.plan });
    }
    let out;
    try {
      const body = vk ? await sealBytes(vk.key, await bytesOf(r.blob), r.type) : r.blob;
      out = await LMD.cloud.binary('POST', withSpace('/files', space, vk ? 'enc=1' : ''), body, vk ? 'application/octet-stream' : r.type);
    } catch (e) { throw fail(e.code || 'failed', Object.assign({ size: r.blob.size }, e.body || {})); }
    if (lim && typeof out.used === 'number') lim.used = out.used;
    if (!vk) return { src: out.url, view: out.url };
    const view = URL.createObjectURL(r.blob); opened.set(out.id, view); remember(out.id, r.blob);
    return { src: out.url, view };
  }

  // Guarda una imagen donde corresponde a la nota abierta. Devuelve { src, view, where }.
  async function put(file) {
    const r = await reduce(file);
    const kind = kindHere();
    if (kind === 'dir') {
      let blob = r.blob;
      if (r.svg) { const text = cleanSvg(await blob.text()); if (text == null) throw fail('bad_image'); blob = new Blob([text], { type: 'image/svg+xml' }); }
      const rel = await LMD.extras.saveImage(blob);
      return { src: rel, view: URL.createObjectURL(blob), where: 'dir' };
    }
    if (inCloud()) return Object.assign(await upload(r, core.cloudPath), { where: 'cloud' });
    if (r.svg) throw fail('svg_embed');
    if (r.blob.size > EMBED_MAX) throw fail('embed_big', { size: r.blob.size });
    const src = await dataUrl(r.blob);
    return { src, view: src, where: 'embed' };
  }

  // Por qué no se pudo, dicho para quien lo lee.
  function why(e) {
    const c = e && e.code; const free = e && e.plan === 'free' && !LMD.storeApp;
    if (c === 'file_too_large') return T('La imagen pesa {a} y el tope es {b} por imagen.', { a: sizeText(e.size || 0), b: sizeText(e.max || 0) }) + ' ' + T(mode() === 'original' ? 'Elegí otra calidad de imagen en Ajustes.' : 'Probá con una más chica.') + (free ? ' ' + T('El plan pago admite imágenes más pesadas.') : '');
    if (c === 'storage_full') return T('El almacenamiento de imágenes está lleno. Borrá adjuntos en Ajustes, en Nube.') + (free ? ' ' + T('El plan pago tiene más lugar.') : '');
    if (c === 'files_need_plan') return T(LMD.storeApp ? 'En esta cuenta las imágenes se insertan por su dirección.' : 'Subir imágenes a la nube es del plan pago. Podés insertar una imagen por su dirección.');
    if (c === 'bad_image') return T('Ese archivo no es una imagen que se pueda insertar.');
    if (c === 'svg_cloud' || c === 'svg_embed') return T('Un SVG no se guarda dentro de una nota. Usá un PNG, o una dirección web.');
    if (c === 'embed_big') return T('La imagen es muy pesada para ir dentro del documento. Subí la nota a la nube o abrí una carpeta.');
    if (c === 'vault_locked') return T('La carpeta está bloqueada. Desbloqueala para guardar.');
    if (c === 'offline') return T('No hay conexión con el servidor.');
    if (c === 'too_many') return T('Demasiadas imágenes seguidas. Probá más tarde.');
    if (c === 'read_only' || c === 'no_access') return T('En este espacio solo podés leer.');
    return T('No se pudo guardar la imagen');
  }
  // Avisa el error. Con el almacenamiento lleno ofrece ir a la lista de adjuntos.
  function tell(e) {
    if (e && e.code === 'storage_full' && inCloud()) {
      LMD.dialog.confirm({ title: T('No hay lugar para esta imagen'), text: why(e), ok: T('Ver adjuntos') }).then((go) => { if (go) manage(spaceOf(core.cloudPath)); });
      return;
    }
    core.flash(why(e), 'error');
  }

  // ---------- Imágenes de carpetas protegidas ----------
  const ENC_RE = /\/f\/([0-9a-f]{40})\.enc(?:$|[?#])/;
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const opened = new Map(); // identificador → dirección en memoria de la imagen ya descifrada
  const opening = new Map();
  function openEnc(id) {
    if (opened.has(id)) return Promise.resolve(opened.get(id));
    if (!opening.has(id)) opening.set(id, (async () => {
      try {
        const here = inCloud() ? spaceOf(core.cloudPath) : ''; const team = LMD.cloud.teamNow();
        const spaces = [here].concat(here ? [''] : team ? [String(team.space)] : []);
        let raw = null;
        for (const s of spaces) { try { raw = await LMD.cloud.binary('GET', withSpace('/files/' + id + '/raw', s), undefined, '', true); break; } catch (e) { if (e.code === 'offline') throw e; } }
        if (!raw) throw fail('not_found');
        // La llave de la carpeta de esta nota primero; si la nota vino de otra carpeta protegida, las demás abiertas.
        const keys = [];
        try { const vk = inCloud() ? await LMD.cloud.vaultKey(core.cloudPath) : null; if (vk) keys.push(vk.key); } catch (e) { /* bloqueada */ }
        for (const k of await LMD.cloud.vaultKeys()) if (!keys.includes(k)) keys.push(k);
        for (const key of keys) { try { const blob = await openBytes(key, raw); const url = URL.createObjectURL(blob); opened.set(id, url); remember(id, blob); return url; } catch (e) { /* no es esa llave */ } }
        throw fail('vault_locked');
      } finally { opening.delete(id); }
    })());
    return opening.get(id);
  }
  // Tras cada dibujo: las imágenes cifradas no se piden por su dirección (ahí no existen), se abren acá.
  function paintEnc(scope) {
    const box = scope && scope.querySelectorAll ? scope : core.ui.article;
    box.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('data-lmd-src') || img.getAttribute('src') || ''; const m = ENC_RE.exec(src);
      if (!m) return;
      if (img.dataset.lmdEnc === m[1] && (img.getAttribute('src') || '').startsWith('blob:')) return;
      img.setAttribute('data-lmd-src', src); img.dataset.lmdEnc = m[1];
      if (opened.has(m[1])) { img.src = opened.get(m[1]); if (!openedData.has(m[1])) fetch(opened.get(m[1])).then((x) => x.blob()).then((b) => remember(m[1], b)).catch(() => {}); return; }
      img.src = BLANK; img.classList.add('lmd-img-wait');
      if (!LMD.cloud.signedIn() || LMD.cloud.guest()) { img.classList.add('lmd-img-locked'); img.title = T('Imagen de una carpeta protegida'); return; }
      openEnc(m[1]).then((url) => { if (img.isConnected) { img.src = url; img.classList.remove('lmd-img-wait', 'lmd-img-locked'); img.removeAttribute('title'); } })
        .catch(() => { img.classList.add('lmd-img-locked'); img.title = T('Imagen de una carpeta protegida'); });
    });
  }

  // ---------- Pasar las imágenes incrustadas a adjuntos ----------
  const EMBED_RE = /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/g;
  const embedded = (text) => Array.from(new Set(String(text || '').match(EMBED_RE) || []));
  const fromDataUrl = (url) => { const i = url.indexOf(','); const bin = atob(url.slice(i + 1)); const b = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) b[k] = bin.charCodeAt(k); return new Blob([b], { type: url.slice(5, url.indexOf(';')) }); };
  // Sube cada imagen incrustada de ese texto como adjunto de la nota de esa ruta y devuelve el texto con sus
  // direcciones. Lo que no se pudo subir queda como estaba. { text, moved, left, error }.
  async function lift(text, path) {
    let out = String(text || ''); let moved = 0; let left = 0; let error = null; const map = [];
    for (const url of embedded(out)) {
      try { const r = await upload(await reduce(fromDataUrl(url)), path); out = out.split(url).join(r.src); map.push([url, r.src]); moved++; }
      catch (e) { left++; error = error || e; if (e.code === 'offline' || e.code === 'storage_full' || e.code === 'files_need_plan' || e.code === 'vault_locked') break; }
    }
    return { text: out, moved, left, error, map };
  }
  // Para cloud.js, al mandar una nota a la nube: si algo falla, la nota va como estaba.
  async function liftQuiet(text, path) {
    try { if (!LMD.cloud.signedIn() || LMD.cloud.guest() || !embedded(text).length) return text; return (await lift(text, path)).text; }
    catch (e) { return text; }
  }
  const canLift = () => !!core && inCloud() && !core.readOnly && core.blocks && embedded(core.raw).length > 0;
  let lifting = false;
  async function liftHere() {
    if (lifting || !canLift()) return;
    lifting = true;
    try {
      const path = core.cloudPath;
      const r = await lift(core.raw, path);
      if (core.cloudPath !== path) return;
      // Lo que se escribió mientras subían las imágenes no se pisa: se reemplaza sobre el texto de ahora.
      if (r.moved) { let now = core.raw; for (const [from, to] of r.map) now = now.split(from).join(to); core.setRaw(now); core.save(false); forgetUsage(); }
      if (r.left) tell(r.error);
      else core.flash(T(r.moved === 1 ? 'Se pasó 1 imagen a adjuntos' : 'Se pasaron {n} imágenes a adjuntos', { n: r.moved }));
    } finally { lifting = false; }
  }

  // ---------- Convertir las imágenes de una nota cuando cambia cómo se guarda ----------
  // Una nota que entra a una carpeta protegida, sale de ella, cambia de llave o de espacio lleva sus imágenes al
  // mismo estado: en claro (un adjunto con dirección) o cifradas con la llave de su carpeta. Lo usa cloud.js en
  // los mismos pasos en que cifra o descifra el texto, nota por nota, así que se retoma donde quedó si se corta.
  // Un adjunto se reconoce por la ruta /f/<id>, con cualquier origen delante, y por ser de un espacio de la cuenta.
  const REF_RE = /https?:\/\/[^\s()<>"'\]\\]*?\/f\/([0-9a-f]{40})\.(png|jpg|gif|webp|avif|enc)(?![0-9a-z])/g;
  const refsIn = (text) => { const out = []; const seen = new Set(); for (const m of String(text || '').matchAll(REF_RE)) { if (seen.has(m[0])) continue; seen.add(m[0]); out.push({ url: m[0], id: m[1], enc: m[2] === 'enc' }); } return out; };
  const encIdsIn = (text) => Array.from(new Set(refsIn(text).filter((x) => x.enc).map((x) => x.id)));
  // Qué adjuntos hay en cada espacio de la cuenta. Se pide una vez cada tanto y se pone al día con lo que se sube.
  const known = new Map();
  async function ownedIn(space) {
    const hit = known.get(space);
    if (hit && Date.now() - hit.at < 120000) return hit.ids;
    const data = await LMD.cloud.binary('GET', withSpace('/files', space));
    const ids = new Map(data.files.map((f) => [f.id, !!f.encrypted]));
    known.set(space, { at: Date.now(), ids });
    return ids;
  }
  // Lo que queda por borrar del servidor (copias que una nota dejó de usar al convertirse), guardado en este
  // navegador para terminarlo aunque se corte en el medio. Cada borrado pide "solo si ninguna nota la usa".
  const PURGE = 'imagePurge';
  const purgeGet = () => new Promise((resolve) => { try { chrome.storage.local.get(PURGE, (r) => resolve(Array.isArray(r && r[PURGE]) ? r[PURGE] : [])); } catch (e) { resolve([]); } });
  const purgeSet = (list) => new Promise((resolve) => { try { chrome.storage.local.set({ [PURGE]: list.slice(-500) }, resolve); } catch (e) { resolve(); } });
  let purging = Promise.resolve();
  const purgeEdit = (fn) => { purging = purging.then(async () => purgeSet(fn(await purgeGet()))).catch(() => {}); return purging; };
  async function purgeNow(drops) {
    for (const d of drops) {
      let gone = true;
      try { await LMD.cloud.binary('DELETE', withSpace('/files/' + d.id, d.space, 'unused=1')); const k = known.get(d.space); if (k) k.ids.delete(d.id); }
      catch (e) { gone = e.code !== 'offline'; } // en uso por otra nota, o ya no está: no se insiste. Sin conexión, queda para después
      if (gone) await purgeEdit((list) => list.filter((x) => !(x.id === d.id && x.space === d.space)));
    }
    forgetUsage();
  }
  async function purgeFlush() { try { if (!LMD.cloud.signedIn() || LMD.cloud.guest()) return; const list = await purgeGet(); if (list.length) await purgeNow(list); } catch (e) { /* queda para la próxima */ } }
  // La app le dice al servidor qué imágenes cifradas usa una nota protegida: solo sus identificadores.
  const declared = new Map();
  async function declare(space, path, ids) {
    const key = space + '|' + path; const sig = ids.slice().sort().join(',');
    if (declared.get(key) === sig) return;
    try { await LMD.cloud.api('PUT', withSpace('/files/refs', space), { path, ids }); declared.set(key, sig); }
    catch (e) { /* solo lectura, sin conexión o un servidor sin actualizar: se vuelve a intentar al próximo guardado */ }
  }
  const inner = (path) => String(path).replace(/^~\d+\//, '');
  // o: { fromSpace, toSpace, fromKeys, toKey, fromPath, toPath }. Las rutas son las de adentro del espacio.
  // Devuelve { text, finish }: text es la nota con sus imágenes ya convertidas, y finish() se llama cuando esa nota
  // quedó guardada: declara lo que usa y borra del servidor las copias que nadie más usa.
  // Si una imagen no se puede convertir (sin conexión, sin lugar) sale el error y la nota no se toca.
  async function convert(text, o) {
    const refs = refsIn(text); const drops = []; let out = String(text == null ? '' : text);
    const fromKeys = (o.fromKeys || []).filter(Boolean); const sameSpace = o.fromSpace === o.toSpace;
    const up = async (bytes, type) => {
      const body = o.toKey ? await sealBytes(o.toKey, bytes, type) : new Blob([bytes], { type });
      const made = await LMD.cloud.binary('POST', withSpace('/files', o.toSpace, o.toKey ? 'enc=1' : ''), body, o.toKey ? 'application/octet-stream' : type);
      const k = known.get(o.toSpace); if (k) k.ids.set(made.id, !!o.toKey);
      return made;
    };
    for (const ref of refs) {
      if (!ref.enc && !o.toKey) continue; // en claro y sigue en claro: su dirección sirve en cualquier espacio
      if (ref.enc && o.toKey && sameSpace && fromKeys.length === 1 && fromKeys[0] === o.toKey) continue;
      if (!ref.enc) {
        // Solo lo propio: una imagen de otro servidor, o de otra cuenta, es una dirección web como cualquiera.
        let home = null;
        for (const s of Array.from(new Set([o.fromSpace, o.toSpace, '']))) { if ((await ownedIn(s)).get(ref.id) === false) { home = s; break; } }
        if (home == null) continue;
        let res; try { res = await fetch(LMD.cloud.base() + '/f/' + ref.id); } catch (e) { throw fail('offline'); }
        if (res.status === 404) continue;
        if (!res.ok) throw fail('failed');
        const bytes = new Uint8Array(await res.arrayBuffer()); const type = sniff(bytes);
        if (!CODES[type]) continue;
        const made = await up(bytes, type);
        opened.set(made.id, URL.createObjectURL(new Blob([bytes], { type })));
        out = out.split(ref.url).join(made.url); drops.push({ space: home, id: ref.id });
        continue;
      }
      // Cifrada: se baja, se abre con la llave que corresponda y se guarda como va en el destino.
      let raw = null;
      try { raw = await LMD.cloud.binary('GET', withSpace('/files/' + ref.id + '/raw', o.fromSpace), undefined, '', true); }
      catch (e) { if (e.code === 'offline') throw e; continue; } // ya no está, o no es de este espacio: queda como estaba
      let blob = null; let with_ = null;
      for (const key of fromKeys) { try { blob = await openBytes(key, raw); with_ = key; break; } catch (e) { /* no es esa llave */ } }
      if (!blob) continue;
      if (o.toKey && with_ === o.toKey && sameSpace) continue; // ya está con la llave nueva
      const made = await up(new Uint8Array(await blob.arrayBuffer()), blob.type);
      if (o.toKey) opened.set(made.id, URL.createObjectURL(blob));
      out = out.split(ref.url).join(made.url); drops.push({ space: o.fromSpace, id: ref.id });
    }
    if (drops.length) await purgeEdit((list) => list.concat(drops));
    const finish = async () => {
      if (o.toKey && o.toPath) await declare(o.toSpace, o.toPath, encIdsIn(out));
      if (fromKeys.length && o.fromPath && (!o.toKey || !sameSpace || o.fromPath !== o.toPath)) { declared.delete(o.fromSpace + '|' + o.fromPath); await declare(o.fromSpace, o.fromPath, []); }
      if (drops.length) await purgeNow(drops);
    };
    return { text: out, finish, changed: out !== String(text == null ? '' : text) };
  }
  // Para lo exportado: las imágenes cifradas que están abiertas van incrustadas, ya descifradas.
  const openedData = new Map();
  const remember = (id, blob) => { const r = new FileReader(); r.onload = () => openedData.set(id, r.result); r.readAsDataURL(blob); };
  function inline(root) {
    root.querySelectorAll('img').forEach((img) => {
      const m = ENC_RE.exec(img.getAttribute('data-lmd-src') || img.getAttribute('src') || ''); if (!m) return;
      img.removeAttribute('data-lmd-enc'); img.classList.remove('lmd-img-wait', 'lmd-img-locked');
      if (openedData.has(m[1])) { img.setAttribute('src', openedData.get(m[1])); img.removeAttribute('data-lmd-src'); }
    });
  }

  // ---------- Una nota protegida con imágenes en claro ----------
  // Lo normal es que las imágenes se conviertan al proteger la carpeta o al mover la nota. Queda este repaso al
  // abrir una nota protegida, por si trae la dirección de un adjunto en claro (pegada como texto, o escrita por una
  // versión anterior de la app). También declara al servidor qué imágenes cifradas usa la nota.
  let sealingNow = false;
  async function sealHere() {
    if (sealingNow || !core || !inCloud() || !core.blocks) return;
    const path = core.cloudPath; let vk = null;
    try { vk = await LMD.cloud.vaultKey(path); } catch (e) { return; }
    if (!vk) return;
    const space = spaceOf(path); const at = inner(path);
    if (core.readOnly || !refsIn(core.raw).some((x) => !x.enc)) { if (!core.readOnly && !core.dirty) declare(space, at, encIdsIn(core.raw)); return; }
    sealingNow = true;
    try {
      const before = core.raw;
      const c = await convert(before, { fromSpace: space, toSpace: space, fromKeys: [vk.key], toKey: vk.key, fromPath: at, toPath: at });
      if (!c.changed || core.cloudPath !== path) return;
      let now = core.raw; const made = refsIn(c.text).filter((x) => x.enc);
      if (now === before) now = c.text;
      else for (const ref of refsIn(before).filter((x) => !x.enc)) { const i = before.split(ref.url)[0].length; const to = made.find((x) => c.text.indexOf(x.url) === i); if (to) now = now.split(ref.url).join(to.url); }
      core.setRaw(now);
      if (await core.save(false)) await c.finish();
      core.flash(T('Las imágenes de esta nota ahora están cifradas'));
    } catch (e) { /* queda para la próxima vez que se abra */ } finally { sealingNow = false; }
  }

  // ---------- Ajustes > Nube: almacenamiento ----------
  // Un renglón en la cabecera de Nube: el nombre, la barra, cuánto se usa y el acceso a la lista. El detalle (el
  // aviso de tope pasado, el espacio del equipo, pasar las incrustadas) está en la lista.
  const meter = (data) => { const p = el('progress', { class: 'lmd-st-bar', max: '100' }); p.value = data.max ? Math.min(100, Math.round((data.used / data.max) * 100)) : 0; p.setAttribute('aria-label', T('Almacenamiento')); return p; };
  async function paintPane(pane) {
    // Sobre un archivo abierto directo la cuenta se maneja desde la app: acá no se le pide nada al servidor.
    const on = !!core && !!core.APP && LMD.cloud.enabled() && LMD.cloud.signedIn() && !LMD.cloud.guest();
    if (!on) { pane.textContent = ''; pane.hidden = true; return; }
    try {
      const data = await limitsOf('', true);
      if (!pane.isConnected) return;
      // El plan gratis no sube imágenes: sin adjuntos guardados no hay nada que mostrar.
      if (!data.max && !data.count) { pane.textContent = ''; pane.hidden = true; return; }
      pane.textContent = ''; pane.hidden = false; pane.classList.toggle('lmd-st-over', data.used > data.max);
      const name = el('span', { class: 'lmd-st-name' }); name.textContent = T('Almacenamiento');
      const num = el('span', { class: 'lmd-st-num' }); num.textContent = T('{a} de {b}', { a: sizeText(data.used), b: sizeText(data.max) });
      const see = el('button', { type: 'button', class: 'lmd-st-see', 'data-st': 'list' }); see.textContent = T('Ver adjuntos');
      see.addEventListener('click', () => manage(''));
      pane.appendChild(name); pane.appendChild(meter(data)); pane.appendChild(num); pane.appendChild(see);
    } catch (e) {
      // Sin conexión, o con un servidor propio que todavía no tiene adjuntos: el renglón no aparece.
      if (pane.isConnected) { pane.textContent = ''; pane.hidden = true; }
    }
  }

  // La lista de adjuntos de un espacio: ordenable por tamaño o por fecha, con borrar.
  async function manage(first) {
    let space = first || ''; const team = LMD.cloud.teamNow(); const both = !!team && team.role === 'admin';
    const box = el('div', { class: 'lmd-ask lmd-dlg lmd-st-dlg' });
    box.innerHTML = '<div class="lmd-ask-card lmd-st-card" role="dialog" aria-modal="true"><h3></h3>' +
      '<div class="lmd-seg lmd-st-spaces" role="radiogroup" hidden><button type="button" role="radio" data-space=""></button><button type="button" role="radio" data-space="team"></button></div>' +
      '<progress class="lmd-st-bar" max="100"></progress><p class="lmd-hint lmd-st-warn" hidden></p>' +
      '<div class="lmd-st-head"><span class="lmd-st-sum"></span><div class="lmd-seg" role="radiogroup"><button type="button" role="radio" data-sort="size" class="lmd-on" aria-checked="true"></button><button type="button" role="radio" data-sort="date" aria-checked="false"></button></div></div>' +
      '<div class="lmd-st-list" role="list"></div><p class="lmd-hint lmd-st-note"></p>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-st="lift" hidden></button><button type="button" class="lmd-btn lmd-btn-fill" data-st="close"></button></div></div>';
    const card = box.querySelector('.lmd-st-card'); card.setAttribute('aria-label', T('Adjuntos'));
    box.querySelector('h3').textContent = T('Adjuntos');
    box.querySelector('[data-sort=size]').textContent = T('Tamaño'); box.querySelector('[data-sort=date]').textContent = T('Fecha');
    box.querySelector('[data-st=close]').textContent = T('Cerrar');
    const spaces = box.querySelector('.lmd-st-spaces'); const bar = box.querySelector('.lmd-st-card > .lmd-st-bar'); const warn = box.querySelector('.lmd-st-warn'); const liftBtn = box.querySelector('[data-st=lift]');
    bar.setAttribute('aria-label', T('Almacenamiento')); warn.textContent = T('Pasaste el tope. Nada se borra, pero no se pueden subir imágenes hasta liberar lugar.'); liftBtn.textContent = T('Pasar las imágenes incrustadas a adjuntos');
    if (both) { spaces.hidden = false; spaces.querySelector('[data-space=""]').textContent = T('Mis notas'); spaces.querySelector('[data-space=team]').textContent = team.name || T('Equipo'); }
    const markSpace = () => spaces.querySelectorAll('[data-space]').forEach((b) => { const on = (b.dataset.space === 'team') === !!space; b.classList.toggle('lmd-on', on); b.setAttribute('aria-checked', String(on)); });
    markSpace();
    const list = box.querySelector('.lmd-st-list'); const sum = box.querySelector('.lmd-st-sum'); const note = box.querySelector('.lmd-st-note');
    const back = document.activeElement;
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ya no recibe foco */ } } const pane = document.querySelector('[data-files-pane]'); if (pane && pane.isConnected && !pane.closest('[hidden]')) paintPane(pane); };
    const onKey = (e) => { if (e.key === 'Escape' && document.body.contains(box) && !document.querySelector('.lmd-dlg:not(.lmd-st-dlg)')) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    let data = null; let sort = 'size';
    const draw = () => {
      list.textContent = '';
      bar.value = data.max ? Math.min(100, Math.round((data.used / data.max) * 100)) : 0; card.classList.toggle('lmd-st-over', data.used > data.max); warn.hidden = !(data.used > data.max); liftBtn.hidden = !!space || !canLift();
      sum.textContent = T(data.count === 1 ? '1 imagen' : '{n} imágenes', { n: data.count }) + ' · ' + T('{a} de {b}', { a: sizeText(data.used), b: sizeText(data.max) });
      note.textContent = T('Cada imagen pesa hasta {a}. Lo que ninguna nota usa se borra a los {n} días.', { a: sizeText(data.max_file), n: data.grace_days }) + ' ' + T('Quien tiene la dirección de una imagen puede verla, salvo en carpetas protegidas.');
      const rows = data.files.slice().sort((a, b) => (sort === 'size' ? b.size - a.size : b.created - a.created));
      if (!rows.length) { const p = el('p', { class: 'lmd-st-empty' }); p.textContent = T('Todavía no hay imágenes.'); list.appendChild(p); return; }
      for (const f of rows) {
        if (!/^[0-9a-f]{40}$/.test(f.id)) continue;
        const row = el('div', { class: 'lmd-st-row', role: 'listitem' });
        const thumb = el('span', { class: 'lmd-st-thumb' });
        if (f.encrypted) thumb.innerHTML = ICON.lock;
        else { const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' }); img.src = LMD.cloud.base() + '/f/' + f.id; thumb.appendChild(img); }
        const info = el('span', { class: 'lmd-st-info' });
        const top = el('b'); top.textContent = sizeText(f.size) + (f.encrypted ? '' : ' · ' + (EXT[f.type] || '').toUpperCase());
        const sub = el('span'); sub.textContent = new Date(f.created).toLocaleDateString(LMD.lang()) + ' · ' + (f.encrypted ? T('Cifrada') + ' · ' : '') + T(f.in_use ? 'En uso' : 'Sin uso');
        info.appendChild(top); info.appendChild(sub);
        const del = el('button', { type: 'button', class: 'lmd-btn lmd-st-del', 'data-del': f.id, 'aria-label': T('Eliminar') }); del.innerHTML = ICON.trash;
        row.appendChild(thumb); row.appendChild(info); row.appendChild(del); list.appendChild(row);
      }
    };
    const load = async () => {
      try { data = await limitsOf(space, true); draw(); }
      catch (e) { list.textContent = ''; const p = el('p', { class: 'lmd-st-empty' }); p.textContent = T(e.code === 'offline' ? 'No hay conexión con el servidor.' : 'No se pudo leer el almacenamiento.'); list.appendChild(p); }
    };
    box.addEventListener('click', async (e) => {
      if (e.target === box || e.target.closest('[data-st=close]')) return close();
      const sp = e.target.closest('[data-space]');
      if (sp && both) { space = sp.dataset.space === 'team' ? String(team.space) : ''; markSpace(); await load(); return; }
      if (e.target.closest('[data-st=lift]')) { close(); liftHere(); return; }
      const s = e.target.closest('[data-sort]');
      if (s) { sort = s.dataset.sort; box.querySelectorAll('[data-sort]').forEach((b) => { b.classList.toggle('lmd-on', b === s); b.setAttribute('aria-checked', String(b === s)); }); if (data) draw(); return; }
      const d = e.target.closest('[data-del]'); if (!d || !data) return;
      const f = data.files.find((x) => x.id === d.dataset.del); if (!f) return;
      const ok = await LMD.dialog.confirm({ title: T('¿Eliminar esta imagen?'), text: T(f.in_use ? 'Una nota la usa: va a quedar sin imagen. No se puede deshacer.' : 'No se puede deshacer.'), ok: T('Eliminar'), danger: true });
      if (!ok) return;
      try { await LMD.cloud.binary('DELETE', withSpace('/files/' + f.id, space)); forgetUsage(); await load(); }
      catch (ex) { core.flash(why(ex), 'error'); }
    });
    await load();
  }

  // ---------- Arrastrar una imagen desde el sistema ----------
  const filesIn = (e) => { const t = e.dataTransfer; return !!t && Array.from(t.types || []).includes('Files'); };
  const canEdit = () => core.editMode && !core.readOnly && core.blocks;
  async function insertMany(files) {
    for (const file of files) {
      try { const r = await put(file); LMD.write.append([LMD.extras.imageMd({ src: r.src, alt: '' })]); if (r.where === 'dir') core.flash(T('Imagen guardada en {a}', { a: r.src })); }
      catch (e) { tell(e); break; }
    }
  }
  function bindDrop(article) {
    article.addEventListener('dragover', (e) => { if (filesIn(e) && canEdit()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    article.addEventListener('drop', (e) => {
      if (!filesIn(e) || !canEdit()) return;
      const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      insertMany(files);
    });
  }

  function init(c) {
    core = c;
    core.hooks.render.push(() => paintEnc());
    core.hooks.patch.push(() => paintEnc());
    core.actions['img-lift'] = () => liftHere();
    core.menus.more.push(() => (canLift() ? ['img-lift', ICON.b_image, 'Pasar las imágenes incrustadas a adjuntos'] : null));
    bindDrop(core.ui.article);
    core.hooks.doc.push(() => setTimeout(sealHere, 1200));
    // Al guardar una nota protegida, el servidor se entera de qué imágenes cifradas usa.
    core.hooks.saved.push((at) => { if (!refsIn(core.raw).length && !declared.has(spaceOf(at) + '|' + inner(at))) return; LMD.cloud.vaultKey(at).then((vk) => { if (vk && core.cloudPath === at) declare(spaceOf(at), inner(at), encIdsIn(core.raw)); }).catch(() => {}); });
    setTimeout(purgeFlush, 4000);
  }

  LMD.images = { init, reduce, put, upload, why, tell, lift, liftQuiet, liftHere, pane: paintPane, manage, cleanSvg, paintEnc, sizeText, sniff, forgetUsage, mode, sealHere, convert, inline, purgeFlush, refsIn };
})();
