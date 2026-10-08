// Imágenes: achicarlas en el navegador (dimensiones, peso, orientación, metadatos), subirlas como adjuntos a la nube
// y verlas en la nota, compartida, por enlace público, en una sesión en vivo y en un sitio publicado; las de una
// carpeta protegida (cifradas antes de salir del navegador); topes por plan con sus avisos; limpieza de lo que
// ninguna nota usa; pasar las incrustadas a adjuntos; la API con token, y el teléfono.
import { rig, tally, sleep, root } from './rig.mjs';
import { spawn } from 'child_process';
import http from 'http'; import net from 'net'; import fs from 'fs'; import os from 'os'; import path from 'path'; import zlib from 'zlib';

const { check, done } = tally();
const enc = encodeURIComponent;
const ADMIN = 'clave-de-prueba';
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

// ---------- Imágenes de prueba, armadas a mano ----------
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, c]); };
// Un PNG de w × h, de un color por fila; fill suma bytes para darle peso (un bloque que los lectores ignoran).
function png(w, h, fill, seed) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) rows.fill((y * 7 + (seed || 0)) & 255, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  const extra = fill ? chunk('prVt', Buffer.alloc(fill, (seed || 1) & 255)) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), extra, chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
// Un GIF de dos cuadros de 1 × 1.
const gif2 = () => { const frame = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00]); return Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]), Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'latin1'), Buffer.from([3, 1, 0, 0, 0]), frame, frame, Buffer.from([0x3b])]); };

// Un servidor aparte, con las variables que pida el caso.
async function boot(env) {
  const dir = tmp('mdimg-'); const port = 28200 + Math.floor(Math.random() * 1500); const base = 'http://127.0.0.1:' + port;
  const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ADMIN_KEY: ADMIN, PUBLIC_URL: base, AUTH_PER_IP: '500', ...(typeof env === 'function' ? env(port) : env) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { log: '' }; proc.stdout.on('data', (d) => { st.log += d; }); proc.stderr.on('data', (d) => { st.log += d; });
  for (let i = 0; i < 80 && !/puerto/.test(st.log); i++) await sleep(100);
  const api = (method, p, body, s, extra) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));
  const up = (s, buf, q, type) => fetch(base + '/files' + (q || ''), { method: 'POST', headers: { authorization: 'Bearer ' + s, 'content-type': type || 'image/png' }, body: buf }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const signup = async (email, pro) => { const code = (await api('POST', '/auth/start', { email })).json.dev_code; const v = (await api('POST', '/auth/verify', { email, code })).json; if (pro) await api('POST', '/admin/plan', { email, plan: 'pro' }, undefined, { 'x-admin-key': ADMIN }); return { s: v.session, id: v.account.id, email }; };
  const onDisk = () => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(d)) { const at = path.join(d, n); if (fs.statSync(at).isDirectory()) { if (n !== 'tmp') walk(at); } else out.push(at); } }; walk(path.join(dir, 'files')); return out; };
  return { base, port, dir, api, up, signup, onDisk, log: () => st.log, stop: async () => { proc.kill(); await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ } } };
}
const status = (url, opt) => fetch(url, opt).then((r) => { r.arrayBuffer().catch(() => {}); return r.status; });

// Lo que corre dentro de la página para armar imágenes y pegarlas.
const IN_PAGE = () => {
  const blobOf = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  const paint = (w, h, alpha) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    if (!alpha) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0b3d91'); gr.addColorStop(0.5, '#f2c14e'); gr.addColorStop(1, '#d7263d'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'hsl(' + (i * 37) % 360 + ' 70% 50%)'; g.beginPath(); g.arc((i * 97) % w, (i * 61) % h, 20 + (i * 13) % Math.max(30, Math.round(w / 12)), 0, 7); g.fill(); }
    // Una marca arriba a la izquierda, para saber hacia dónde quedó girada.
    g.fillStyle = '#00ff00'; g.fillRect(0, 0, Math.round(w / 4), Math.round(h / 4));
    return c;
  };
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  // Un bloque EXIF con orientación y un dato de ubicación, y un comentario, metidos después del comienzo del JPEG.
  const withExif = (jpeg, turn) => {
    const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, turn, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 0, 0, 0x53, 0, 0, 0, 0, 0, 0, 0];
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff); const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255].concat(exif);
    const note = Array.from(new TextEncoder().encode('lugar-secreto-34.6037S')); const com = [0xff, 0xfe, (note.length + 2) >> 8, (note.length + 2) & 255].concat(note);
    const out = new Uint8Array(jpeg.length + app1.length + com.length); out.set(jpeg.subarray(0, 2), 0); out.set(app1, 2); out.set(com, 2 + app1.length); out.set(jpeg.subarray(2), 2 + app1.length + com.length);
    return out;
  };
  const has = (b, text) => { const t = new TextEncoder().encode(text); outer: for (let i = 0; i + t.length <= b.length; i++) { for (let k = 0; k < t.length; k++) if (b[i + k] !== t[k]) continue outer; return true; } return false; };
  const fileOf = (b, type, name) => new File([b], name || 'foto', { type });
  const sizeOf = async (blob) => { const bmp = await createImageBitmap(blob); return [bmp.width, bmp.height]; };
  // El color de un punto de la imagen ya decodificada (como la muestra un navegador, con su orientación).
  const pixel = async (blob, fx, fy) => { const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return Array.from(g.getImageData(Math.round(fx * (bmp.width - 1)), Math.round(fy * (bmp.height - 1)), 1, 1).data); };
  const paste = (file) => { const host = document.querySelector('.lmd-article .lmd-editable'); const dt = new DataTransfer(); dt.items.add(file); host.focus(); const r = document.createRange(); r.selectNodeContents(host); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
  const photo = async (w, h, q) => bytes(await blobOf(paint(w || 900, h || 600), 'image/jpeg', q || 0.9));
  window.__img = { blobOf, paint, bytes, withExif, has, fileOf, sizeOf, pixel, paste, photo };
};
const prep = async (page) => { await page.evaluate(IN_PAGE); };
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > (ms || 8000)) return v; await sleep(120); } };

const R = await rig((port) => ({ PAGES_URL: 'http://pages.localhost:' + port, AUTH_PER_IP: '500' }));
const { api } = R;
const PORT = +new URL(R.base).port;
const rawHost = (host, p) => new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers })); }); r.on('error', () => resolve({ status: 0, body: '' })); r.end(); });
const upload = (s, buf, q, type) => fetch(R.base + '/files' + (q || ''), { method: 'POST', headers: { authorization: 'Bearer ' + s, 'content-type': type || 'image/png' }, body: buf }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const filesOf = async (s, q) => (await api('GET', '/files' + (q || ''), undefined, s)).json;
const textOf = async (s, p, q) => (await api('GET', '/notes/' + enc(p) + (q || ''), undefined, s)).json.text;
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-article img')].map((i) => ({ src: i.getAttribute('src') || '', kept: i.getAttribute('data-lmd-src') || '', w: i.naturalWidth, ok: i.complete && i.naturalWidth > 0 })));
const seen = (page, ms) => until(async () => { const l = await shown(page); return l.length && l.every((i) => i.ok) ? l : null; }, ms || 10000);

try {
  // ---------- Achicar en el navegador ----------
  console.log('Achicar');
  const ana = await R.signup('ana@ejemplo.test', true);
  const A = await R.open(ana); await A.page.goto(R.home); await A.page.waitForSelector('.lmd-home, .lmd-article'); await prep(A.page);
  const red = await A.page.evaluate(async () => {
    const I = window.__img; const out = {};
    const run = async (b, type, mode) => { const r = await LMD.images.reduce(I.fileOf(b, type), mode); const rb = await I.bytes(r.blob); return { r, rb, type: r.type, size: rb.length, dims: r.svg ? null : await I.sizeOf(r.blob) }; };
    // Una foto grande.
    const big = await I.bytes(await I.blobOf(I.paint(4000, 3000), 'image/jpeg', 0.95));
    const a = await run(big, 'image/jpeg', 'normal'); out.grande = { from: big.length, size: a.size, dims: a.dims, type: a.type };
    const h = await run(big, 'image/jpeg', 'high'); out.alta = { size: h.size, dims: h.dims };
    const o = await run(big, 'image/jpeg', 'original'); out.original = { same: o.size === big.length && o.rb.every((v, i) => v === big[i]), type: o.type };
    // Una foto chica que el EXIF manda girar, con ubicación y un comentario.
    const small = await I.photo(300, 200);
    const turned = I.withExif(small, 6);
    const t = await run(turned, 'image/jpeg', 'normal');
    out.girada = { antes: [I.has(turned, 'Exif'), I.has(turned, 'lugar-secreto')], dims: t.dims, exif: I.has(t.rb, 'Exif'), lugar: I.has(t.rb, 'lugar-secreto'), marca: await I.pixel(t.r.blob, 0.9, 0.05), otra: await I.pixel(t.r.blob, 0.05, 0.9) };
    // La misma sin girar: se le quitan los metadatos sin volver a comprimirla.
    const plain = I.withExif(small, 1);
    const p = await run(plain, 'image/jpeg', 'normal');
    out.limpia = { type: p.type, exif: I.has(p.rb, 'Exif'), lugar: I.has(p.rb, 'lugar-secreto'), dims: p.dims, menos: p.size < plain.length, igual: p.size === small.length };
    // Un PNG transparente grande: sigue transparente.
    const tr = await I.bytes(await I.blobOf(I.paint(2600, 1800, true), 'image/png'));
    const g = await run(tr, 'image/png', 'normal'); out.transparente = { type: g.type, dims: g.dims, alfa: (await I.pixel(g.r.blob, 0.999, 0.999))[3], menos: g.size < tr.length };
    // Un archivo que dice ser imagen y no lo es.
    try { await LMD.images.reduce(I.fileOf(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'image/png')); out.html = 'pasó'; } catch (e) { out.html = e.code; }
    // Un SVG con código: lo que queda después de sanearlo.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__pwn=1"><script>window.__pwn=1</script><a xlink:href="javascript:window.__pwn=1"><rect width="10" height="10" onclick="window.__pwn=1"/></a><foreignObject><body xmlns="http://www.w3.org/1999/xhtml" onload="window.__pwn=1"></body></foreignObject><image href="https://xss.invalid/a.png"/><circle r="4"/></svg>';
    const clean = LMD.images.cleanSvg(svg); out.svg = { clean, es: (await LMD.images.reduce(I.fileOf(new TextEncoder().encode(svg), 'image/svg+xml'))).svg === true, nada: LMD.images.cleanSvg('<html><script>1</script></html>') };
    return out;
  });
  check('una foto de 4000 × 3000 queda en 2000 px de lado como mucho y pesa menos de 400 KB', Math.max(...red.grande.dims) === 2000 && red.grande.size <= 400 * 1024 && red.grande.size < red.grande.from, red.grande);
  check('y sale en WebP donde el navegador lo codifica (en JPEG si no)', /^image\/(webp|jpeg)$/.test(red.grande.type) && (R.kind !== 'chromium' || red.grande.type === 'image/webp'), red.grande.type);
  check('con "Alta" se achica menos: hasta 3200 px', Math.max(...red.alta.dims) === 3200 && red.alta.size > red.grande.size, red.alta);
  check('con "Original" la imagen no se toca: los mismos bytes', red.original.same && red.original.type === 'image/jpeg', red.original);
  check('una foto que el EXIF manda girar queda girada de verdad: 300 × 200 pasa a 200 × 300, con la marca en su esquina', red.girada.dims[0] === 200 && red.girada.dims[1] === 300 && red.girada.marca[1] > 240 && red.girada.marca[0] < 30 && red.girada.marca[2] < 30 && !(red.girada.otra[1] > 240 && red.girada.otra[0] < 30 && red.girada.otra[2] < 30), red.girada);
  check('y sale sin EXIF, sin ubicación y sin comentarios', red.girada.antes.every(Boolean) && !red.girada.exif && !red.girada.lugar, red.girada);
  check('una foto chica y derecha pierde los metadatos sin recomprimirse: el mismo JPEG, sin el bloque EXIF', red.limpia.type === 'image/jpeg' && !red.limpia.exif && !red.limpia.lugar && red.limpia.menos && red.limpia.dims[0] === 300 && red.limpia.igual, red.limpia);
  check('un PNG transparente grande se achica y sigue transparente', Math.max(...red.transparente.dims) === 2000 && red.transparente.alfa < 20 && red.transparente.menos && /webp|png/.test(red.transparente.type), red.transparente);
  check('un HTML que dice ser una imagen no pasa', red.html === 'bad_image', red.html);
  check('un SVG saneado no conserva scripts, manejadores, contenido ajeno ni direcciones de código', red.svg.es && !!red.svg.clean && !/script|onload|onclick|javascript:|foreignObject|xss\.invalid/i.test(red.svg.clean) && /<circle/.test(red.svg.clean) && red.svg.nada === null, red.svg);
  const anim = await A.page.evaluate(async (b) => { const I = window.__img; const src = new Uint8Array(b); const r = await LMD.images.reduce(I.fileOf(src, 'image/gif')); return { animated: !!r.animated, same: r.blob.size === src.length, type: r.type }; }, Array.from(gif2()));
  check('un GIF animado no se recomprime', anim.animated && anim.same && anim.type === 'image/gif', anim);

  // ---------- Ajustes ----------
  console.log('Ajustes');
  await A.page.keyboard.press('Control+,').catch(() => {});
  if (!(await A.page.$('.lmd-panel:not([hidden]) [data-ptab=read]'))) await A.page.evaluate(() => { const b = document.querySelector('[data-act=settings], .lmd-settings-btn, [data-open=panel]'); if (b) b.click(); });
  const panelOpen = await until(() => A.page.evaluate(() => !!document.querySelector('[data-ptab=read]') && !!document.querySelector('[data-seg=imageQuality]')), 4000);
  if (!panelOpen) await A.page.evaluate(() => LMD.patch({}));
  await A.page.evaluate(() => { const t = document.querySelector('[data-ptab=read]'); if (t) t.click(); });
  const seg = await A.page.evaluate(() => { const s = document.querySelector('[data-seg=imageQuality]'); if (!s) return null; return { opts: [...s.querySelectorAll('button')].map((b) => b.textContent), on: s.querySelector('.lmd-on').dataset.val, label: s.closest('.lmd-row').querySelector('span').textContent, hint: s.closest('.lmd-row').nextElementSibling.textContent, visible: !!s.offsetParent }; });
  check('Ajustes > Lectura y edición tiene "Image quality" con Normal, High y Original, y una línea que lo explica', !!seg && seg.label === 'Image quality' && seg.opts.join() === 'Normal,High,Original' && seg.on === 'normal' && /metadata/.test(seg.hint) && /location/.test(seg.hint), seg);
  await A.page.evaluate(() => document.querySelector('[data-seg=imageQuality] [data-val=original]').click());
  const picked = await until(() => A.page.evaluate(async () => (await LMD.load()).imageQuality === 'original' && LMD.images.mode() === 'original'), 3000);
  check('elegir "Original" queda guardado y es lo que usa la app', picked === true, picked);
  await A.page.evaluate(() => document.querySelector('[data-seg=imageQuality] [data-val=normal]').click()); await sleep(300);

  // ---------- Una nota de la nube ----------
  console.log('Adjuntos en la nube');
  await api('PUT', '/notes/' + enc('fotos.md'), { text: '# Fotos\n\nTexto de la nota.\n' }, ana.s);
  await A.page.goto(R.noteUrl('fotos.md', true)); await A.page.waitForSelector('.lmd-article .lmd-editable'); await prep(A.page);
  await A.page.evaluate(async () => { const I = window.__img; I.paste(I.fileOf(I.withExif(await I.photo(2400, 1600, 0.92), 1), 'image/jpeg', 'IMG_0001.JPG')); });
  const pasted = await until(async () => { const f = await filesOf(ana.s); return f.count === 1 ? f : null; });
  check('pegar una foto en una nota de la nube la sube como adjunto', !!pasted && pasted.files[0].type === 'image/webp' && pasted.files[0].size <= 400 * 1024 && /^[0-9a-f]{40}$/.test(pasted.files[0].id), pasted && pasted.files[0]);
  await A.page.keyboard.press('Control+s');
  const saved = await until(async () => { const t = await textOf(ana.s, 'fotos.md'); return /\/f\/[0-9a-f]{40}\.webp/.test(t) ? t : null; });
  const fileUrl = saved && saved.match(/https?:\/\/[^\s)]+\/f\/[0-9a-f]{40}\.webp/)[0];
  check('el Markdown guarda una dirección corta, no la imagen', !!saved && !/data:image/.test(saved) && saved.length < 400 && fileUrl.startsWith(R.base + '/f/'), saved);
  const got = await fetch(fileUrl); const gotBytes = Buffer.from(await got.arrayBuffer());
  check('la dirección sirve la imagen sin sesión, como WebP y sin los metadatos de la foto', got.status === 200 && got.headers.get('content-type') === 'image/webp' && gotBytes.subarray(8, 12).toString('latin1') === 'WEBP' && !gotBytes.includes(Buffer.from('lugar-secreto')) && !gotBytes.includes(Buffer.from('Exif')), [got.status, got.headers.get('content-type')]);
  check('con cabeceras estrictas: tipo fijo, sin adivinar, sin correr nada, caché larga y sin cookies', got.headers.get('x-content-type-options') === 'nosniff' && got.headers.get('content-security-policy') === "default-src 'none'; sandbox" && /^inline; filename="image\.webp"$/.test(got.headers.get('content-disposition')) && got.headers.get('cross-origin-resource-policy') === 'cross-origin' && /max-age=31536000, immutable/.test(got.headers.get('cache-control')) && !got.headers.get('set-cookie') && !got.headers.get('access-control-allow-credentials'), Object.fromEntries(got.headers));
  await A.page.reload(); await A.page.waitForSelector('.lmd-article img');
  const afterReload = await seen(A.page);
  check('al volver a abrir la nota la imagen se ve', !!afterReload && afterReload.length === 1 && afterReload[0].w > 0 && afterReload[0].src.includes('/f/'), afterReload || await shown(A.page));
  const used1 = await filesOf(ana.s);
  const gratisDef = await R.signup('gratis-def@ejemplo.test', false); const freeDefaults = await filesOf(gratisDef.s);
  { const r = await fetch(R.base + '/files', { method: 'POST', headers: { authorization: 'Bearer ' + gratisDef.s, 'content-type': 'image/png' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }); freeDefaults.gratisSube = r.status; }
  check('por defecto: el plan gratis no sube imágenes; pago, 10 MB y 1 GB', freeDefaults.max === 0 && freeDefaults.gratisSube === 402 && freeDefaults.max_gif === undefined && used1.max === 1024 * 1048576, [freeDefaults.max, freeDefaults.max_file, used1.max]);
  check('la lista dice que está en uso y cuánto ocupa', used1.files[0].in_use === true && used1.used === used1.files[0].size && used1.max === 1024 * 1048576 && used1.max_file === 10 * 1048576, { used: used1.used, max: used1.max, f: used1.files[0] });

  // El diálogo de insertar imagen, con un archivo elegido.
  await prep(A.page);
  const dlg = A.page.evaluate(() => LMD.extras.imageDialog());
  await A.page.waitForSelector('.lmd-img-card');
  const pngFile = path.join(tmp('mdimg-f-'), 'captura.png'); fs.writeFileSync(pngFile, png(120, 80));
  await A.page.setInputFiles('.lmd-img-card input[type=file]:not([data-cam])', pngFile);
  await A.page.fill('.lmd-img-card [data-i=alt]', 'Una captura'); await A.page.click('.lmd-img-card [data-i=ok]');
  const picked2 = await dlg;
  check('elegir un archivo en "Insertar imagen" también lo sube: vuelve la dirección del adjunto', !!picked2 && /\/f\/[0-9a-f]{40}\.png$/.test(picked2.src) && picked2.alt === 'Una captura' && (await filesOf(ana.s)).count === 2, picked2);

  // ---------- Compartida, enlace público, sesión en vivo ----------
  console.log('Quién la ve');
  const beto = await R.signup('beto@ejemplo.test', false);
  await api('POST', '/shares', { path: 'fotos.md', email: beto.email, role: 'view' }, ana.s);
  const B = await R.open(beto); await B.page.goto(R.noteUrl('~' + ana.id + '/fotos.md')); await B.page.waitForSelector('.lmd-article img');
  check('quien recibe la nota compartida ve la imagen', !!(await seen(B.page)), await shown(B.page));
  const link = (await api('POST', '/links', { path: 'fotos.md' }, ana.s)).json;
  const V = await R.open(null); await V.page.goto(R.home + '?f=' + enc('pub/' + link.token)); await V.page.waitForSelector('.lmd-article img');
  check('por el enlace público, sin cuenta, la imagen se ve', !!(await seen(V.page)), await shown(V.page));
  const live = (await api('POST', '/live', { path: 'fotos.md', name: 'Ana' }, ana.s)).json;
  const G = await R.open(null); await G.page.goto(R.home + '#live=' + live.secret);
  await G.page.waitForSelector('.lmd-dlg input, .lmd-ask input', { timeout: 8000 }).catch(() => {});
  if (await G.page.$('.lmd-dlg input, .lmd-ask input')) { await G.page.fill('.lmd-dlg input, .lmd-ask input', 'Invitada'); await G.page.keyboard.press('Enter'); }
  await G.page.waitForSelector('.lmd-article img', { timeout: 10000 }).catch(() => {});
  check('un invitado de una sesión en vivo ve la imagen', !!(await seen(G.page)), await shown(G.page));
  // Un invitado no tiene cuenta donde subir: lo que pega queda dentro de la nota, ya achicado.
  await prep(G.page);
  const guestPaste = await G.page.evaluate(async () => { const I = window.__img; const host = document.querySelector('.lmd-article .lmd-editable'); if (!host) return 'sin bloque'; I.paste(I.fileOf(await I.photo(1200, 800), 'image/jpeg')); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); const im = [...document.querySelectorAll('.lmd-article img')].find((x) => (x.getAttribute('data-lmd-src') || '').startsWith('data:image/')); if (im) return im.getAttribute('data-lmd-src').length; } return 0; });
  check('lo que pega un invitado queda incrustado y achicado, sin tocar el almacenamiento de nadie', typeof guestPaste === 'number' && guestPaste > 100 && guestPaste < 600 * 1024 * 1.4 && (await filesOf(ana.s)).count === 2, guestPaste);
  await api('DELETE', '/live?path=' + enc('fotos.md'), undefined, ana.s);
  await G.ctx.close(); await V.ctx.close(); await B.ctx.close();

  // ---------- Sitio publicado ----------
  console.log('Sitio publicado');
  await api('PUT', '/notes/' + enc('web/inicio.md'), { text: '# Inicio\n\n![foto](' + fileUrl + ')\n' }, ana.s);
  const site = (await api('POST', '/sites', { folder: 'web', slug: 'fotos-ana', title: 'Fotos' }, ana.s)).json;
  const httpsUrl = 'https://sync.ejemplo.test/f/' + pasted.files[0].id + '.webp';
  const putPages = await api('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: 'web/inicio.md', rev: 1, html: '<h1>Inicio</h1><p><img src="' + httpsUrl + '" alt="foto"><img src="' + fileUrl + '" alt="local"><img src="' + httpsUrl.replace('.webp', '.enc') + '" alt="x" onerror="window.__pwn=1"></p>' }] }, ana.s);
  await api('POST', '/sites/' + site.id + '/publish', {}, ana.s);
  const pageHtml = (await rawHost('pages.localhost:' + PORT, '/fotos-ana/')).body;
  check('una página publicada muestra el adjunto por su dirección https, sin manejadores', putPages.status === 200 && pageHtml.includes('<img src="' + httpsUrl + '" alt="foto"') && !/onerror/.test(pageHtml), [putPages.status, putPages.json, pageHtml.slice(pageHtml.indexOf('<h1'), pageHtml.indexOf('<h1') + 400)]);
  check('una dirección que no es https no entra en un sitio: queda su texto', !pageHtml.includes(fileUrl) && /sp-noimg[^>]*>local</.test(pageHtml), null);
  const csp = (await rawHost('pages.localhost:' + PORT, '/fotos-ana/')).headers['content-security-policy'] || '';
  check('y la política del sitio deja cargar imágenes https y nada más de afuera', /img-src https: data:/.test(csp) && /default-src 'none'/.test(csp), csp);
  const viaPages = await rawHost('pages.localhost:' + PORT, '/f/' + pasted.files[0].id + '.webp');
  check('el host de sitios nunca sirve un adjunto', viaPages.status === 404 && !/WEBP/.test(viaPages.body), viaPages.status);

  // ---------- Carpeta protegida ----------
  console.log('Carpeta protegida');
  await A.page.goto(R.home); await A.page.waitForSelector('.lmd-home, .lmd-article'); await prep(A.page);
  await api('PUT', '/notes/' + enc('secreta/diario.md'), { text: '# Diario\n\nRenglón secreto.\n' }, ana.s);
  const made = await A.page.evaluate(async () => {
    const Z = LMD.seal; const K = Z.newKey(); const d = await Z.derive(K); const w = await Z.wrap(K, 'una contraseña larga 1', 100000);
    const v = await LMD.cloud.api('POST', '/vaults', Object.assign({ folder: 'secreta', check: d.check }, w));
    Z.hold({ check: d.check }, d.key); await Z.remember(LMD.cloud.email(), { check: d.check });
    LMD.cloud.vaultStale();
    // La nota que ya estaba pasa a estar cifrada, como hace la app al proteger la carpeta.
    await LMD.cloud.write('secreta/diario.md', '# Diario\n\nRenglón secreto.\n');
    return { id: v.id, state: v.state };
  });
  await A.page.goto(R.noteUrl('secreta/diario.md', true)); await A.page.waitForSelector('.lmd-article .lmd-editable'); await prep(A.page);
  const before = (await filesOf(ana.s)).count;
  await A.page.evaluate(async () => { const I = window.__img; I.paste(I.fileOf(await I.photo(1600, 1000), 'image/jpeg')); });
  const encFile = await until(async () => { const f = await filesOf(ana.s); return f.count === before + 1 ? f.files.find((x) => x.encrypted) : null; });
  check('en una carpeta protegida la imagen sube cifrada', !!made.id && !!encFile && encFile.encrypted === true && encFile.type === '' && /\.enc$/.test(encFile.url), [made, encFile]);
  const inApp = await until(async () => { const l = await shown(A.page); return l.length && l.every((i) => i.ok && i.src.startsWith('blob:') && /\.enc$/.test(i.kept)) ? l : null; });
  check('la app la muestra descifrada en memoria, y el Markdown guarda su dirección', !!inApp, await shown(A.page));
  await A.page.keyboard.press('Control+s');
  const sealedText = await until(async () => { const t = await textOf(ana.s, 'secreta/diario.md'); return /^vault1:/.test(t) ? t : null; });
  await sleep(600);
  const disk = fs.readdirSync(path.join(os.tmpdir())).filter((n) => n.startsWith('mdsync-')).map((n) => path.join(os.tmpdir(), n, 'files', encFile.id.slice(0, 2), encFile.id)).find((p) => fs.existsSync(p));
  const diskBytes = disk ? fs.readFileSync(disk) : Buffer.alloc(0);
  const looksImage = (b) => /^(\x89PNG|GIF8|RIFF)/.test(b.subarray(0, 4).toString('latin1')) || (b[0] === 0xff && b[1] === 0xd8) || b.includes(Buffer.from('WEBP')) || b.includes(Buffer.from('JFIF'));
  check('en el disco del servidor quedan bytes que no son una imagen ni se pueden leer', !!disk && diskBytes.length === encFile.size && !looksImage(diskBytes) && new Set(diskBytes.subarray(0, 4096)).size > 200, [disk, diskBytes.length]);
  check('y la nota que la nombra también está cifrada', !!sealedText && !/\/f\//.test(sealedText), String(sealedText).slice(0, 40));
  const encId = encFile.id;
  const noPublic = [await status(R.base + '/f/' + encId), await status(R.base + '/f/' + encId + '.enc'), await status(R.base + '/f/' + encId + '.webp'), await status(R.base + '/f/' + encId + '.png')];
  check('una imagen cifrada no se sirve por su dirección, con ninguna terminación', noPublic.every((s) => s === 404), noPublic);
  const rawMine = await fetch(R.base + '/files/' + encId + '/raw', { headers: { authorization: 'Bearer ' + ana.s } }); const rawBytes = Buffer.from(await rawMine.arrayBuffer());
  const rawOther = [await status(R.base + '/files/' + encId + '/raw', { headers: { authorization: 'Bearer ' + beto.s } }), await status(R.base + '/files/' + encId + '/raw')];
  check('sus bytes los baja solo su cuenta, como un archivo cualquiera y todavía cifrados', rawMine.status === 200 && rawMine.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(rawMine.headers.get('content-disposition')) && rawBytes.equals(diskBytes) && rawOther[0] === 404 && rawOther[1] === 401, [rawMine.status, rawOther]);
  await A.page.reload(); await A.page.waitForSelector('.lmd-article img');
  const again = await until(async () => { const l = await shown(A.page); return l.length && l.every((i) => i.ok && i.src.startsWith('blob:')) ? l : null; }, 12000);
  check('al recargar, con la carpeta desbloqueada, se vuelve a ver', !!again, await shown(A.page));
  check('subir una imagen en claro con la marca de cifrada no la vuelve pública, y sin carpeta protegida no se aceptan cifradas', (await upload(ana.s, png(8, 8), '?enc=1')).status === 200 && (await upload(beto.s, Buffer.alloc(200, 5), '?enc=1')).status === 409, null);
  const encAsPlain = (await filesOf(ana.s)).files.filter((f) => f.encrypted);
  check('lo que entra como cifrado nunca tiene dirección pública', (await Promise.all(encAsPlain.map((f) => status(R.base + '/f/' + f.id)))).every((s) => s === 404), encAsPlain.length);
  // Una nota protegida que traía una imagen subida en claro: al abrirla, la imagen pasa a estar cifrada.
  const plainOld = (await upload(ana.s, png(50, 30, 0, 123))).json;
  await A.page.evaluate(async (u) => { await LMD.cloud.write('secreta/con-foto.md', '# Con foto\n\n![antes](' + u + ')\n'); }, plainOld.url);
  await A.page.goto(R.noteUrl('secreta/con-foto.md', true)); await A.page.waitForSelector('.lmd-article img');
  const resealed = await until(async () => ((await status(plainOld.url)) === 404 ? true : null), 15000);
  const afterSeal = await until(async () => { const l = await shown(A.page); return l.length === 1 && l[0].ok && l[0].src.startsWith('blob:') && /\.enc$/.test(l[0].kept) ? l : null; }, 8000);
  check('una nota protegida que traía una imagen en claro la vuelve a subir cifrada y borra la copia en claro', resealed === true && !!afterSeal && !(await filesOf(ana.s)).files.some((f) => f.id === plainOld.id), [resealed, await shown(A.page)]);
  const pubTry = await api('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: 'web/inicio.md', rev: 1, html: '<p><img src="' + R.base + '/f/' + encId + '.enc" alt="cifrada"></p>' }] }, ana.s);
  check('ni entra en un sitio publicado', pubTry.status === 200 && !(await rawHost('pages.localhost:' + PORT, '/fotos-ana/')).body.includes(encId), pubTry.status);

  // ---------- Proteger una carpeta que ya tenía imágenes, mover, quitar la protección ----------
  console.log('Proteger con imágenes');
  const p1 = (await upload(ana.s, png(60, 40, 0, 201))).json; const p2 = (await upload(ana.s, png(60, 40, 0, 202))).json;
  // La dirección guardada puede tener otro origen que el que la app tiene configurado: vale la ruta /f/<id>.
  const alias = (u) => u.replace(R.base, 'https://otro-nombre.ejemplo.test');
  await api('PUT', '/notes/' + enc('album/uno.md'), { text: '# Uno\n\n![a](' + alias(p1.url) + ')\n\n![b|240](' + p2.url + ')\n\n![ajena](https://ejemplo.test/f/' + 'c'.repeat(40) + '.png)\n' }, ana.s);
  await api('PUT', '/notes/' + enc('album/dos.md'), { text: '# Dos\n\n![a](' + p1.url + ')\n' }, ana.s);
  await api('PUT', '/notes/' + enc('album/tres.md'), { text: '# Tres\n\nSin imágenes.\n' }, ana.s);
  await api('PUT', '/notes/' + enc('fuera.md'), { text: '# Fuera\n\n![b](' + p2.url + ')\n' }, ana.s);
  await A.page.goto(R.home); await A.page.waitForSelector('.lmd-home, .lmd-article');
  // La primera pasada se corta en la segunda nota: queda a medias y se retoma.
  let cutOnce = true;
  await A.page.route((u) => /\/notes\/album%2Fdos\.md/.test(u.href), (route) => { if (cutOnce && route.request().method() === 'PUT') { cutOnce = false; return route.abort(); } return route.continue(); });
  const firstPass = await A.page.evaluate(async () => {
    const Z = LMD.seal; const K = Z.newKey(); const d = await Z.derive(K); const w = await Z.wrap(K, 'otra contraseña larga 2', 100000);
    Z.hold({ check: d.check }, d.key); await Z.remember(LMD.cloud.email(), { check: d.check });
    await LMD.cloud.vaultCreate(Object.assign({ folder: 'album', check: d.check }, w));
    const vault = (await LMD.cloud.vaults(true)).find((v) => v.folder === 'album'); const steps = [];
    try { await LMD.cloud.sealFolder(vault, (n, m) => steps.push(n + '/' + m)); return { ok: true, steps }; } catch (e) { return { ok: false, code: e.code, steps }; }
  });
  const midList = (await api('GET', '/notes', undefined, ana.s)).json.filter((n) => n.path.startsWith('album/'));
  const midP1 = await status(p1.url);
  check('si se corta a mitad de camino, lo hecho queda hecho y lo que falta sigue en claro', firstPass.ok === false && midList.filter((n) => n.v).length >= 1 && midList.filter((n) => !n.v).length >= 1, [firstPass, midList.map((n) => [n.path, n.v])]);
  check('y una imagen que todavía usa una nota sin cifrar no se borra', midP1 === 200, midP1);
  const secondPass = await A.page.evaluate(async () => { const vault = (await LMD.cloud.vaults(true)).find((v) => v.folder === 'album'); const steps = []; const n = await LMD.cloud.sealFolder(vault, (a, b) => steps.push(a + '/' + b)); return { n, steps, uno: (await LMD.cloud.read('album/uno.md')).text, dos: (await LMD.cloud.read('album/dos.md')).text }; });
  await A.page.unroute((u) => /\/notes\/album%2Fdos\.md/.test(u.href)).catch(() => {});
  const sealedAll = (await api('GET', '/notes', undefined, ana.s)).json.filter((n) => n.path.startsWith('album/'));
  check('al retomar se cifra lo que faltaba, con su progreso', secondPass.n >= 1 && secondPass.steps.length >= 2 && secondPass.steps[secondPass.steps.length - 1] === secondPass.n + '/' + secondPass.n && sealedAll.every((n) => n.v === 1), [secondPass.n, secondPass.steps, sealedAll.map((n) => n.v)]);
  const encOf = (t) => (t.match(/\/f\/[0-9a-f]{40}\.enc/g) || []).map((x) => x.slice(3, 43));
  check('cada nota pasa a nombrar copias cifradas de sus imágenes, también la que tenía otro origen en la dirección, y conserva el tamaño', encOf(secondPass.uno).length === 2 && encOf(secondPass.dos).length === 1 && !/\/f\/[0-9a-f]{40}\.png\)\n\n!\[b/.test(secondPass.uno) && !secondPass.uno.includes(p1.id) && !secondPass.uno.includes(p2.id) && /!\[b\|240\]\(http[^)]*\.enc\)/.test(secondPass.uno) && secondPass.uno.includes('https://ejemplo.test/f/' + 'c'.repeat(40) + '.png'), secondPass.uno);
  const afterP = [await status(p1.url), await status(p2.url)];
  const filesNow = await filesOf(ana.s);
  check('la copia en claro se borra en el acto si nadie fuera de la carpeta la usa, y queda si otra nota la usa', afterP[0] === 404 && afterP[1] === 200 && !filesNow.files.some((f) => f.id === p1.id) && filesNow.files.some((f) => f.id === p2.id), afterP);
  const usedEnc = encOf(secondPass.uno).concat(encOf(secondPass.dos));
  check('el servidor sabe qué imágenes cifradas usa cada nota, sin leerlas: figuran en uso', usedEnc.every((id) => { const f = filesNow.files.find((x) => x.id === id); return f && f.encrypted && f.in_use === true; }) && (await Promise.all(usedEnc.map((id) => status(R.base + '/f/' + id)))).every((s) => s === 404), usedEnc.map((id) => filesNow.files.find((x) => x.id === id)));
  await A.page.goto(R.noteUrl('album/uno.md')); await A.page.waitForSelector('.lmd-article img');
  const albumSeen = await until(async () => { const l = (await shown(A.page)).filter((i) => /\.enc$/.test(i.kept)); return l.length === 2 && l.every((i) => i.ok && i.src.startsWith('blob:')) ? l : null; }, 12000);
  check('y la nota protegida muestra sus imágenes', !!albumSeen, await shown(A.page));
  // Exportar una nota protegida desbloqueada lleva sus imágenes, descifradas, dentro de lo exportado.
  const exported = await until(() => A.page.evaluate(() => { const h = LMD.extras.htmlOf(); return (h.match(/<img[^>]*src="data:image\/png;base64,/g) || []).length === 2 ? h : null; }), 6000);
  check('exportar a HTML una nota protegida desbloqueada incrusta sus imágenes ya descifradas', !!exported && !/\.enc"/.test(exported) && !/blob:/.test(exported), String(exported).slice(0, 300));
  // Mover hacia afuera y hacia adentro convierte en ese momento.
  const movedOut = await A.page.evaluate(async () => { await LMD.cloud.rename('album/uno.md', 'libre.md'); return true; });
  const libre = await textOf(ana.s, 'libre.md'); const libreUrls = (libre.match(/https?:\/\/[^\s)]+\/f\/[0-9a-f]{40}\.png/g) || []).filter((u) => !u.includes('c'.repeat(40)));
  const libreStatus = await Promise.all(libreUrls.map((u) => status(u))); const afterOut = await filesOf(ana.s);
  check('sacar una nota de la carpeta protegida deja sus imágenes como adjuntos comunes en ese momento', movedOut && !/^vault1:/.test(libre) && !/\.enc/.test(libre) && libreUrls.length === 2 && libreStatus.every((s) => s === 200) && /!\[b\|240\]/.test(libre), [libre, libreStatus]);
  check('y sus copias cifradas se borran', encOf(secondPass.uno).every((id) => !afterOut.files.some((f) => f.id === id)) && encOf(secondPass.dos).every((id) => afterOut.files.some((f) => f.id === id)), null);
  await A.page.evaluate(async () => { await LMD.cloud.rename('fuera.md', 'album/fuera.md'); });
  const fueraRaw = await textOf(ana.s, 'album/fuera.md'); const fueraPlain = await A.page.evaluate(async () => (await LMD.cloud.read('album/fuera.md')).text);
  check('meter una nota en la carpeta protegida cifra sus imágenes en ese momento', /^vault1:/.test(fueraRaw) && encOf(fueraPlain).length === 1 && !fueraPlain.includes(p2.id), fueraPlain);
  check('la copia en claro sigue para la nota de afuera que también la usa', (await status(p2.url)) === 200 && libre.includes(p2.id), null);
  // Quitar la protección: todo vuelve a ser un adjunto común.
  const encBefore = (await filesOf(ana.s)).files.filter((f) => f.encrypted).map((f) => f.id);
  const albumEnc = encOf(secondPass.dos).concat(encOf(fueraPlain));
  const opened = await A.page.evaluate(async () => { const vault = (await LMD.cloud.vaults(true)).find((v) => v.folder === 'album'); const steps = []; await LMD.cloud.openFolder(vault, (n, m) => steps.push(n + '/' + m)); return steps; });
  const dosNow = await textOf(ana.s, 'album/dos.md'); const fueraNow = await textOf(ana.s, 'album/fuera.md'); const afterOpen = await filesOf(ana.s);
  const openUrls = (dosNow + fueraNow).match(/https?:\/\/[^\s)]+\/f\/[0-9a-f]{40}\.png/g) || [];
  check('al quitar la protección las notas quedan en claro y sus imágenes vuelven a ser adjuntos con dirección', opened.length >= 2 && !/vault1:|\.enc/.test(dosNow + fueraNow) && openUrls.length === 2 && (await Promise.all(openUrls.map((u) => status(u)))).every((s) => s === 200), [dosNow, fueraNow]);
  check('y las copias cifradas de esa carpeta se borran: quedan solo las de la otra carpeta protegida', albumEnc.every((id) => encBefore.includes(id) && !afterOpen.files.some((f) => f.id === id)) && afterOpen.files.filter((f) => f.encrypted).length === encBefore.length - albumEnc.length, [encBefore.length, afterOpen.files.filter((f) => f.encrypted).length]);

  // ---------- Espacio de equipo: proteger y rotar la llave ----------
  console.log('Equipo: proteger y rotar');
  await api('POST', '/admin/team', { email: ana.email, seats: 3 }, undefined, { 'x-admin-key': R.ADMIN });
  const space = (await api('GET', '/team', undefined, ana.s)).json.mine.space;
  const tDefault = await filesOf(ana.s, '?o=' + space);
  check('el equipo tiene una bolsa común de 2 GB por persona, y cada imagen hasta 10 MB', tDefault.max === 2048 * 1048576 && tDefault.max_file === 10 * 1048576, [tDefault.max, tDefault.max_file]);
  const t1 = (await upload(ana.s, png(70, 50, 0, 211), '?o=' + space)).json;
  await api('PUT', '/notes/' + enc('equipo.md') + '?o=' + space, { text: '# Equipo\n\n![t](' + t1.url + ')\n' }, ana.s);
  await A.page.goto(R.home); await A.page.waitForSelector('.lmd-home, .lmd-article');
  const teamRun = await A.page.evaluate(async (sp) => {
    const Z = LMD.seal; const out = {};
    LMD.cloud.setTeam((await LMD.cloud.account()).team.mine);
    const K1 = Z.newKey(); const d1 = await Z.derive(K1); Z.hold({ check: d1.check }, d1.key); await Z.remember(LMD.cloud.email(), { check: d1.check });
    const v1 = await LMD.cloud.teamVaultCreate(Object.assign({ check: d1.check }, await Z.wrap(K1, 'la contraseña del equipo 1', 100000)));
    await LMD.cloud.sealFolder(v1);
    out.sealed = (await LMD.cloud.read('~' + sp + '/equipo.md')).text;
    const K2 = Z.newKey(); const d2 = await Z.derive(K2); Z.hold({ check: d2.check }, d2.key); await Z.remember(LMD.cloud.email(), { check: d2.check });
    const now = await LMD.cloud.teamVaultRotate(Object.assign({ check: d2.check }, await Z.wrap(K2, 'la contraseña del equipo 2', 100000)));
    out.bad = await LMD.cloud.rotateSpace(now);
    out.rotated = (await LMD.cloud.read('~' + sp + '/equipo.md')).text;
    return out;
  }, space);
  const e1 = encOf(teamRun.sealed)[0]; const e2 = encOf(teamRun.rotated)[0]; const teamFiles = await filesOf(ana.s, '?o=' + space);
  check('proteger el espacio del equipo cifra sus imágenes y borra la copia en claro', !!e1 && (await status(t1.url)) === 404 && !teamFiles.files.some((f) => f.id === t1.id), [teamRun.sealed]);
  check('rotar la llave vuelve a cifrar las imágenes con la llave nueva y borra las de la llave anterior', teamRun.bad === 0 && !!e2 && e2 !== e1 && teamFiles.files.some((f) => f.id === e2 && f.encrypted && f.in_use) && !teamFiles.files.some((f) => f.id === e1), [e1, e2, teamFiles.files.map((f) => [f.id.slice(0, 6), f.in_use])]);
  await A.page.goto(R.noteUrl('~' + space + '/equipo.md')); await A.page.waitForSelector('.lmd-article img');
  const teamSeen = await until(async () => { const l = await shown(A.page); return l.length === 1 && l[0].ok && l[0].src.startsWith('blob:') ? l : null; }, 12000);
  check('y la imagen se ve con la llave nueva', !!teamSeen, await shown(A.page));

  // ---------- Pasar las incrustadas a adjuntos ----------
  console.log('Incrustadas');
  const dataPng = 'data:image/png;base64,' + png(64, 48, 0, 9).toString('base64');
  await api('PUT', '/notes/' + enc('vieja.md'), { text: '# Vieja\n\n![uno](' + dataPng + ')\n\nTexto.\n\n![dos|240](' + dataPng + ')\n' }, ana.s);
  await A.page.goto(R.noteUrl('vieja.md', true)); await A.page.waitForSelector('.lmd-article img');
  check('una nota vieja con imágenes incrustadas se sigue viendo', !!(await seen(A.page)) && (await shown(A.page)).length === 2, await shown(A.page));
  // El menú de la nota lo ofrece solo cuando hay algo incrustado.
  await A.page.evaluate(() => { const b = document.querySelector('[data-act=more], .lmd-more-btn'); if (b) b.click(); });
  const menuHas = await A.page.evaluate(() => [...document.querySelectorAll('button, [role=menuitem]')].some((b) => /Move embedded images to attachments/.test(b.textContent)));
  await A.page.keyboard.press('Escape');
  const countBefore = (await filesOf(ana.s)).count;
  await A.page.evaluate(() => LMD.images.liftHere());
  const lifted = await until(async () => { const t = await textOf(ana.s, 'vieja.md'); return !/data:image/.test(t) && /\/f\/[0-9a-f]{40}\.png/.test(t) ? t : null; }, 12000);
  check('"Move embedded images to attachments" las sube y deja sus direcciones, con el tamaño que tenían', menuHas && !!lifted && (lifted.match(/\/f\/[0-9a-f]{40}\.png/g) || []).length === 2 && /!\[dos\|240\]\(http/.test(lifted) && lifted.length < 400, lifted && lifted.slice(0, 300));
  check('la misma imagen dos veces es un solo adjunto', (await filesOf(ana.s)).count === countBefore + 1, (await filesOf(ana.s)).count - countBefore);
  check('y la nota se sigue viendo', !!(await seen(A.page)) && (await shown(A.page)).every((i) => i.src.includes('/f/')), await shown(A.page));
  const sent = await A.page.evaluate(async (d) => { await LMD.cloud.write('del-navegador.md', '# Local\n\n![a](' + d + ')\n'); return true; }, 'data:image/png;base64,' + png(40, 40, 0, 3).toString('base64'));
  const sentText = await textOf(ana.s, 'del-navegador.md');
  check('una nota del navegador que se manda a la nube llega con sus imágenes como adjuntos', sent && /\/f\/[0-9a-f]{40}\.png/.test(sentText) && !/data:image/.test(sentText), sentText);

  // ---------- Almacenamiento en Ajustes ----------
  console.log('Almacenamiento');
  const pane = await A.page.evaluate(async () => {
    const host = document.createElement('div'); host.className = 'lmd-st-slot'; host.setAttribute('data-files-pane', ''); host.hidden = true; document.body.appendChild(host);
    await LMD.images.pane(host);
    const out = { off: host.hidden, text: host.innerText, bar: host.querySelector('progress') ? +host.querySelector('progress').value : -1, list: !!host.querySelector('[data-st=list]') };
    host.querySelector('[data-st=list]').click();
    await new Promise((r) => setTimeout(r, 900));
    const card = document.querySelector('.lmd-st-card');
    out.rows = card ? card.querySelectorAll('.lmd-st-row').length : -1; out.sum = card ? card.querySelector('.lmd-st-sum').textContent : '';
    out.first = card ? card.querySelector('.lmd-st-row b').textContent : '';
    card.querySelector('[data-sort=date]').click(); out.byDate = card.querySelector('.lmd-st-row b').textContent; card.querySelector('[data-sort=size]').click();
    out.states = [...card.querySelectorAll('.lmd-st-info span')].map((s) => s.textContent.split(' · ').pop());
    out.note = card.querySelector('.lmd-st-note').textContent; out.rowsText = [...card.querySelectorAll('.lmd-st-info span')].map((s) => s.textContent).join(' | ');
    host.remove();
    return out;
  });
  const allNow = await filesOf(ana.s); const biggest = Math.max(...allNow.files.map((f) => f.size));
  check('Ajustes > Cloud muestra "Storage" con el uso, una barra y el acceso a la lista', !pane.off && /^Storage/.test(pane.text.trim()) && / of 1 GB/.test(pane.text) && /See attachments/.test(pane.text) && pane.bar >= 0 && pane.list, pane);
  check('la lista trae todos los adjuntos, ordenados por tamaño, y dice cuáles están en uso o cifrados', pane.rows === allNow.count && pane.first.startsWith(await A.page.evaluate((n) => LMD.images.sizeText(n), biggest)) && pane.states.includes('In use') && /Encrypted · (In use|Not used)/.test(pane.rowsText), pane);
  check('y avisa, ahí mismo, que quien tiene la dirección de una imagen puede verla salvo en carpetas protegidas', /Anyone with the address of an image can see it, except in protected folders\./.test(pane.note) && /deleted after 30 days/.test(pane.note) && !/[!—–]/.test(pane.note), pane.note);
  // Borrar uno desde la lista.
  const victim = allNow.files.find((f) => !f.encrypted && !f.in_use) || allNow.files.find((f) => !f.encrypted);
  await A.page.evaluate((id) => { document.querySelector('.lmd-st-card [data-del="' + id + '"]').click(); }, victim.id);
  await A.page.waitForSelector('.lmd-dlg:not(.lmd-st-dlg) [data-dlg=ok]'); await A.page.click('.lmd-dlg:not(.lmd-st-dlg) [data-dlg=ok]');
  const goneOne = await until(async () => ((await filesOf(ana.s)).count === allNow.count - 1 ? true : null));
  check('borrar un adjunto desde la lista lo saca del servidor y deja de servirse', goneOne === true && (await status(R.base + '/f/' + victim.id)) === 404, victim.id);
  await A.page.evaluate(() => { const c = document.querySelector('.lmd-st-card [data-st=close]'); if (c) c.click(); });

  // ---------- API con token, y MCP ----------
  console.log('API');
  const tok = (await api('POST', '/tokens', { name: 'ia' }, ana.s)).json.token;
  const tokScoped = (await api('POST', '/tokens', { name: 'ia web', folder: 'web' }, ana.s)).json.token;
  const viaApi = await fetch(R.base + '/api/v1/files', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/octet-stream' }, body: png(30, 30, 0, 77) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  check('la API sube una imagen con un token y devuelve su dirección y el Markdown para insertarla', viaApi.status === 200 && viaApi.json.ok && /\/f\/[0-9a-f]{40}\.png$/.test(viaApi.json.data.url) && viaApi.json.data.markdown === '![](' + viaApi.json.data.url + ')' && viaApi.json.data.type === 'image/png', viaApi);
  const apiList = (await api('GET', '/api/v1/files', undefined, tok)).json; const apiScoped = (await api('GET', '/api/v1/files', undefined, tokScoped)).json;
  check('la lista de la API trae el uso y los adjuntos', apiList.ok && apiList.data.files.length === (await filesOf(ana.s)).count && apiList.data.used > 0 && typeof apiList.data.files[0].created === 'string', apiList.data && apiList.data.files.length);
  check('un token limitado a una carpeta ve solo las imágenes que nombran las notas de esa carpeta', apiScoped.ok && apiScoped.data.files.length === 1 && apiScoped.data.files[0].id === pasted.files[0].id, apiScoped.data && apiScoped.data.files.map((f) => f.id));
  const apiBad = [await fetch(R.base + '/api/v1/files', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/png' }, body: Buffer.from('<html><script>1</script></html>') }).then(async (r) => [r.status, (await r.json()).error.code]), await fetch(R.base + '/api/v1/files', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png(4, 4) }).then((r) => r.status), await fetch(R.base + '/api/v1/files', { method: 'POST', headers: { authorization: 'Bearer ' + ana.s, 'content-type': 'image/png' }, body: png(4, 4) }).then((r) => r.status)];
  check('la API rechaza lo que no es una imagen, y no acepta un pedido sin token ni con la sesión de la app', apiBad[0][0] === 415 && apiBad[0][1] === 'bad_image' && apiBad[1] === 401 && apiBad[2] === 401, apiBad);
  const mcp = (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'fotos.md' } } }, tok)).json;
  check('read_note por MCP deja la dirección de la imagen tal cual', JSON.stringify(mcp).includes(fileUrl), JSON.stringify(mcp).slice(0, 300));
  const spec = (await api('GET', '/api/v1/openapi.json')).json;
  check('la especificación de la API incluye /files', !!spec && !!spec.paths && !!spec.paths['/api/v1/files'] && !!spec.paths['/api/v1/files'].post && !!spec.paths['/api/v1/files'].get, spec && Object.keys(spec.paths || {}).filter((k) => /files/.test(k)));
  await A.ctx.close();
} catch (e) { check('sin excepciones en la prueba de la app', false, String(e && e.stack || e)); }
check('la app no dio errores de página', R.errors.length === 0, R.errors.slice(0, 4));
check('y nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 4));

// ---------- Topes por plan, con un servidor de topes chicos ----------
console.log('Topes por plan');
{
  const S = await boot({ FILE_MAX_FREE_MB: '0.05', FILE_MAX_PAID_MB: '0.2', FILES_FREE_MB: '0.1', FILES_PAID_MB: '0.5', FILES_TEAM_MB: '1', FILES_TEAM_SEAT_MB: '0.25' });
  try {
    const free = await S.signup('gratis@ejemplo.test', false); const pro = await S.signup('paga@ejemplo.test', true);
    const lf = (await S.api('GET', '/files', undefined, free.s)).json; const lp = (await S.api('GET', '/files', undefined, pro.s)).json;
    check('cada plan informa sus topes: por imagen y en total', lf.plan === 'free' && lf.max_file === Math.round(0.05 * 1048576) && lf.max === Math.round(0.1 * 1048576) && lp.plan === 'pro' && lp.max_file === Math.round(0.2 * 1048576) && lp.max === Math.round(0.5 * 1048576), [lf, lp].map((x) => [x.plan, x.max_file, x.max]));
    const tooBig = await S.up(free.s, png(10, 10, 70000)); const okPro = await S.up(pro.s, png(10, 10, 70000));
    check('una imagen que pasa el tope del plan gratis se rechaza diciendo cuál es el tope, y en el plan pago entra', tooBig.status === 413 && tooBig.json.error === 'file_too_large' && tooBig.json.max === lf.max_file && tooBig.json.plan === 'free' && /MB/.test(tooBig.json.message) && okPro.status === 200, [tooBig, okPro.status]);
    const gifBig = await S.up(free.s, Buffer.concat([gif2().subarray(0, gif2().length - 1), Buffer.from([0x21, 0xfe]), ...Array.from({ length: 60 }, () => Buffer.concat([Buffer.from([250]), Buffer.alloc(250, 65)])), Buffer.from([0, 0x3b])]), '', 'image/gif');
    const gifHuge = await S.up(free.s, Buffer.concat([gif2().subarray(0, gif2().length - 1), Buffer.from([0x21, 0xfe]), ...Array.from({ length: 260 }, () => Buffer.concat([Buffer.from([250]), Buffer.alloc(250, 65)])), Buffer.from([0, 0x3b])]), '', 'image/gif');
    check('un GIF animado tiene el mismo tope que cualquier imagen', gifBig.status === 200 && gifBig.json.type === 'image/gif' && gifHuge.status === 413 && gifHuge.json.error === 'file_too_large' && gifHuge.json.max === lf.max_file, [gifBig.status, gifHuge]);
    await S.api('DELETE', '/files/' + gifBig.json.id, undefined, free.s);
    const a1 = await S.up(free.s, png(10, 10, 40000, 1)); const a2 = await S.up(free.s, png(10, 10, 40000, 2)); const a3 = await S.up(free.s, png(10, 10, 40000, 3));
    check('al llenarse el almacenamiento, la siguiente se rechaza con lo usado y el tope', a1.status === 200 && a2.status === 200 && a3.status === 413 && a3.json.error === 'storage_full' && a3.json.used === a1.json.size + a2.json.size && a3.json.max === lf.max, [a1.status, a2.status, a3]);
    await S.api('PUT', '/notes/' + enc('n.md'), { text: 'sigue\n' }, free.s);
    check('y la nota se sigue guardando: el tope de imágenes no frena el texto', (await S.api('PUT', '/notes/' + enc('n.md'), { text: 'sigue escribiendo\n' }, free.s)).status === 200, null);
    await S.api('DELETE', '/files/' + a1.json.id, undefined, free.s);
    check('al borrar un adjunto vuelve a haber lugar', (await S.up(free.s, png(10, 10, 40000, 3))).status === 200, null);
    // En paralelo: entre todas no pasan el total.
    const many = await Promise.all(Array.from({ length: 12 }, (_, i) => S.up(pro.s, png(10, 10, 60000, 20 + i))));
    const okN = many.filter((r) => r.status === 200).length; const usedPro = (await S.api('GET', '/files', undefined, pro.s)).json;
    check('doce subidas a la vez no pasan el tope entre todas', okN >= 1 && okN < 12 && usedPro.used <= usedPro.max && many.every((r) => r.status === 200 || r.json.error === 'storage_full') && S.onDisk().length === usedPro.count + (await S.api('GET', '/files', undefined, free.s)).json.count, [okN, usedPro.used, usedPro.max, S.onDisk().length]);
    // Bajar de plan: no se borra nada, y no se sube hasta estar por debajo.
    await S.api('POST', '/admin/plan', { email: pro.email, plan: 'free' }, undefined, { 'x-admin-key': ADMIN });
    const down = (await S.api('GET', '/files', undefined, pro.s)).json; const refused = await S.up(pro.s, png(4, 4, 0, 99));
    const still = await status(down.files[0].url);
    check('al bajar de plan no se borra nada y las imágenes se siguen viendo, pero no se sube más hasta liberar lugar', down.count === usedPro.count && down.used > down.max && down.plan === 'free' && refused.status === 413 && refused.json.error === 'storage_full' && still === 200, [down.count, down.used, down.max, refused.json, still]);
    // Equipo: el tope del espacio suma por persona, y los papeles valen.
    const jefa = await S.signup('jefa@ejemplo.test', true); const edita = await S.signup('edita@ejemplo.test', false); const lee = await S.signup('lee@ejemplo.test', false);
    await S.api('POST', '/admin/team', { email: jefa.email, seats: 5 }, undefined, { 'x-admin-key': ADMIN });
    for (const [who, role] of [[edita, 'editor'], [lee, 'reader']]) { await S.api('POST', '/team/invite', { email: who.email, role }, jefa.s); const inv = (await S.api('GET', '/team', undefined, who.s)).json.invites[0]; await S.api('POST', '/team/accept', { id: inv.id }, who.s); }
    const space = (await S.api('GET', '/team', undefined, jefa.s)).json.mine.space;
    const tl = (await S.api('GET', '/files?o=' + space, undefined, jefa.s)).json;
    check('el espacio de un equipo tiene su tope más lo que suma cada persona', tl.max === Math.round(1 * 1048576) + 3 * Math.round(0.25 * 1048576), [tl.max]);
    const byEditor = await S.up(edita.s, png(6, 6, 0, 41), '?o=' + space); const byReader = await S.up(lee.s, png(6, 6, 0, 42), '?o=' + space); const byOut = await S.up(free.s, png(6, 6, 0, 43), '?o=' + space);
    const readerSees = await S.api('GET', '/files?o=' + space, undefined, lee.s); const outSees = await S.api('GET', '/files?o=' + space, undefined, free.s);
    const readerDel = await S.api('DELETE', '/files/' + byEditor.json.id + '?o=' + space, undefined, lee.s); const outDel = await S.api('DELETE', '/files/' + byEditor.json.id, undefined, free.s);
    check('en el equipo sube quien edita; quien solo lee no sube ni borra, y alguien de afuera no ve nada', byEditor.status === 200 && byReader.status === 403 && byReader.json.error === 'read_only' && byOut.status === 403 && readerSees.status === 200 && outSees.status === 403 && readerDel.status === 403 && outDel.status === 404, [byEditor.status, byReader.json, byOut.status, readerSees.status, outSees.status, readerDel.status, outDel.status]);
    check('lo del equipo ocupa lugar del equipo, no de quien lo subió', (await S.api('GET', '/files', undefined, edita.s)).json.count === 0 && (await S.api('GET', '/files?o=' + space, undefined, jefa.s)).json.count === 1, null);
    check('topes: sin errores del servidor', !/error 500|error no capturado|promesa sin atender/.test(S.log()), (S.log().match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('topes: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await S.stop();
}

// ---------- El aviso en la app al llegar al tope ----------
console.log('Avisos en la app');
{
  const R2 = await rig({ FILES_FREE_MB: '0.03', FILE_MAX_FREE_MB: '0.02', AUTH_PER_IP: '500' });
  try {
    const lia = await R2.signup('lia@ejemplo.test', false);
    await R2.api('PUT', '/notes/' + enc('apuntes.md'), { text: '# Apuntes\n\nLo que venía escribiendo.\n' }, lia.s);
    const L = await R2.open(lia); await L.page.goto(R2.noteUrl('apuntes.md', true)); await L.page.waitForSelector('.lmd-article .lmd-editable'); await prep(L.page);
    await L.page.evaluate(() => LMD.patch({ imageQuality: 'original' })); await sleep(300);
    await L.page.keyboard.press('Control+End'); await L.page.locator('.lmd-article .lmd-editable').last().click(); await L.page.keyboard.type(' Sigo escribiendo.');
    await L.page.evaluate(async () => { const I = window.__img; I.paste(I.fileOf(await I.photo(1400, 900, 0.95), 'image/jpeg')); });
    const flash = await until(() => L.page.evaluate(() => { const f = [...document.querySelectorAll('.lmd-flash, .lmd-toast, [role=status], [role=alert]')].map((x) => x.textContent).find((t) => /limit is/.test(t)); return f || null; }), 6000);
    check('una imagen que pasa el tope por imagen avisa cuál es el tope y qué hacer', !!flash && /The image weighs .* and the limit is 20 KB per image\./.test(flash) && /Pick another image quality in Settings\./.test(flash) && /paid plan/.test(flash) && !/[!—–]/.test(flash), flash);
    await L.page.evaluate(() => LMD.patch({ imageQuality: 'normal' })); await sleep(300);
    // Dos imágenes chicas llenan el almacenamiento; la tercera abre el aviso con el camino a la lista.
    const small = async (seed) => L.page.evaluate(async (s) => { const I = window.__img; const c = I.paint(260 + s, 180); I.paste(I.fileOf(await I.bytes(await I.blobOf(c, 'image/jpeg', 0.9)), 'image/jpeg')); }, seed);
    let n = 0; for (let i = 0; i < 8 && !(await L.page.$('.lmd-dlg')); i++) { await small(i * 7); await until(async () => (await L.page.$('.lmd-dlg')) || ((await R2.api('GET', '/files', undefined, lia.s)).json.count > n), 5000); n = (await R2.api('GET', '/files', undefined, lia.s)).json.count; }
    const full = await L.page.evaluate(() => { const d = document.querySelector('.lmd-dlg'); return d ? { title: d.querySelector('h3').textContent, text: d.querySelector('.lmd-dlg-text, p').textContent, ok: d.querySelector('[data-dlg=ok]').textContent } : null; });
    check('con el almacenamiento lleno, un diálogo propio dice qué pasó y ofrece ir a los adjuntos', !!full && full.title === 'No room for this image' && /Image storage is full\. Delete attachments in Settings, under Cloud\./.test(full.text) && /paid plan has more room/.test(full.text) && full.ok === 'See attachments' && n >= 1, [full, n]);
    await L.page.click('.lmd-dlg [data-dlg=ok]'); await L.page.waitForSelector('.lmd-st-card .lmd-st-row');
    check('y ese botón abre la lista de adjuntos', (await L.page.$$('.lmd-st-card .lmd-st-row')).length === n, n);
    await L.page.click('.lmd-st-card [data-st=close]');
    const typed = await L.page.evaluate(() => document.querySelector('.lmd-article').innerText);
    check('lo que la persona estaba escribiendo sigue en la nota', /Sigo escribiendo\./.test(typed) && /Lo que venía escribiendo\./.test(typed), typed.slice(0, 200));
    // Dentro de la app de Android no hay enlaces de compra.
    const store = await L.page.evaluate(async () => {
      LMD.storeApp = true; document.documentElement.classList.add('lmd-store-app');
      const host = document.createElement('div'); host.setAttribute('data-files-pane', ''); document.body.appendChild(host);
      await LMD.images.pane(host);
      const out = { plan: /plan|upgrade|buy|price/i.test(host.innerText), text: host.innerText, over: host.classList.contains('lmd-st-over'), why: LMD.images.why({ code: 'storage_full', plan: 'free' }) + ' ' + LMD.images.why({ code: 'file_too_large', plan: 'free', size: 5e6, max: 2e6 }) };
      host.querySelector('[data-st=list]').click(); await new Promise((r) => setTimeout(r, 900));
      const card = document.querySelector('.lmd-st-card'); out.card = card.innerText; card.querySelector('[data-st=close]').click();
      host.remove(); LMD.storeApp = false; document.documentElement.classList.remove('lmd-store-app');
      out.webWhy = LMD.images.why({ code: 'storage_full', plan: 'free' });
      return out;
    });
    check('en la app de Android no se ofrece el plan: ni un enlace ni la frase, que en la web sí está', !store.plan && !/paid plan|upgrade|buy/i.test(store.why + store.card) && /paid plan/i.test(store.webWhy), store);
    check('la app de avisos no dio errores de página', R2.errors.length === 0, R2.errors.slice(0, 4));

    // ---------- Teléfono ----------
    console.log('Teléfono');
    const P = await R2.open(lia, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    await P.page.goto(R2.noteUrl('apuntes.md', true)); await P.page.waitForSelector('.lmd-article');
    const phone = await P.page.evaluate(async () => {
      const done = LMD.extras.imageDialog(); await new Promise((r) => setTimeout(r, 200));
      const card = document.querySelector('.lmd-img-card'); const inputs = [...card.querySelectorAll('input[type=file]')];
      const out = { shot: !!card.querySelector('[data-i=shot]') && card.querySelector('[data-i=shot]').textContent, accepts: inputs.map((i) => i.accept), capture: inputs.map((i) => i.getAttribute('capture')), fits: card.getBoundingClientRect().right <= innerWidth && card.getBoundingClientRect().left >= 0, wide: document.documentElement.scrollWidth <= innerWidth + 1 };
      card.querySelector('[data-i=no]').click(); await done;
      LMD.images.manage(''); await new Promise((r) => setTimeout(r, 900));
      const st = document.querySelector('.lmd-st-card'); const box = st.getBoundingClientRect(); const del = st.querySelector('.lmd-st-del');
      out.lista = { fits: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight + 1, rows: st.querySelectorAll('.lmd-st-row').length, del: del ? [Math.round(del.getBoundingClientRect().width), Math.round(del.getBoundingClientRect().height)] : null };
      st.querySelector('[data-st=close]').click();
      return out;
    });
    check('en el teléfono, "Insertar imagen" ofrece la galería y la cámara', phone.shot === 'Take a photo' && phone.accepts.every((a) => a === 'image/*') && phone.capture.includes('environment') && phone.capture.includes(null) && phone.fits && phone.wide, phone);
    check('y la lista de adjuntos entra en la pantalla, con botones que se pueden tocar', phone.lista.fits && phone.lista.rows >= 1 && phone.lista.del[0] >= 44 && phone.lista.del[1] >= 44, phone.lista);
    await P.ctx.close(); await L.ctx.close();
  } catch (e) { check('avisos: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await R2.close();
}

// ---------- Limpieza de lo que ninguna nota usa ----------
console.log('Limpieza');
{
  const S = await boot({ FILES_SWEEP_MS: '250', FILES_FRESH_MS: '300', FILES_GRACE_MS: '1800', FILE_STALL_MS: '700', FILE_SLOW_AFTER_MS: '600' });
  try {
    const ana = await S.signup('ana@ejemplo.test', true); const otro = await S.signup('otro@ejemplo.test', true);
    const used = (await S.up(ana.s, png(8, 8, 3000, 1))).json; const loose = (await S.up(ana.s, png(8, 8, 3000, 2))).json; const inTrash = (await S.up(ana.s, png(8, 8, 3000, 3))).json; const inHist = (await S.up(ana.s, png(8, 8, 3000, 4))).json; const moved = (await S.up(ana.s, png(8, 8, 3000, 5))).json;
    await S.api('PUT', '/notes/' + enc('a.md'), { text: '![](' + used.url + ')\n' }, ana.s);
    await S.api('PUT', '/notes/' + enc('papelera.md'), { text: '![](' + inTrash.url + ')\n' }, ana.s); await S.api('DELETE', '/notes/' + enc('papelera.md'), undefined, ana.s);
    await S.api('PUT', '/notes/' + enc('h.md'), { text: '![](' + inHist.url + ')\n' }, ana.s);
    // Una versión del historial se guarda si pasó más de un minuto: se escribe directo, como quedó en la base.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(S.dir, 'mdtools.db')); db.prepare('INSERT INTO versions (user, path, text, saved, size, e) VALUES (?, ?, ?, ?, ?, 0)').run(ana.id, 'h.md', '![](' + inHist.url + ')\n', Date.now(), 60); db.close();
    await S.api('PUT', '/notes/' + enc('h.md'), { text: 'ya sin imagen\n' }, ana.s);
    // Una nota de otra cuenta nombra una imagen de esta (una nota que se mudó de espacio).
    await S.api('PUT', '/notes/' + enc('copiada.md'), { text: '![](' + moved.url + ')\n' }, otro.s);
    await sleep(1100);
    const mid = (await S.api('GET', '/files', undefined, ana.s)).json; const by = (id) => mid.files.find((f) => f.id === id);
    check('lo que ninguna nota nombra queda esperando su borrado y deja de contar en el uso', by(loose.id) && by(loose.id).waiting === true && by(loose.id).in_use === false && by(used.id).waiting === false && by(used.id).in_use === true && mid.used === mid.stored - by(loose.id).size, mid.files.map((f) => [f.id.slice(0, 6), f.waiting, f.in_use]));
    check('una imagen nombrada desde la papelera, desde el historial o desde una nota de otro espacio sigue viva', [inTrash.id, inHist.id, moved.id].every((id) => by(id) && by(id).waiting === false), [inTrash.id, inHist.id, moved.id].map((id) => by(id) && by(id).waiting));
    await sleep(2600);
    const end = (await S.api('GET', '/files', undefined, ana.s)).json; const ids = end.files.map((f) => f.id);
    check('pasado el margen, la que nadie usa se borra del servidor y del disco; las demás quedan', !ids.includes(loose.id) && [used.id, inTrash.id, inHist.id, moved.id].every((id) => ids.includes(id)) && (await status(loose.url)) === 404 && (await status(used.url)) === 200 && S.onDisk().length === 4 && !S.onDisk().some((p) => p.endsWith(loose.id)), [ids.length, S.onDisk().length]);
    // Vaciar la papelera suelta esa imagen; volver a nombrar una que esperaba la rescata.
    await S.api('DELETE', '/trash', undefined, ana.s); await sleep(900);
    const w = (await S.api('GET', '/files', undefined, ana.s)).json.files.find((f) => f.id === inTrash.id);
    await S.api('PUT', '/notes/' + enc('rescate.md'), { text: '![](' + inTrash.url + ')\n' }, ana.s); await sleep(700);
    const back = (await S.api('GET', '/files', undefined, ana.s)).json.files.find((f) => f.id === inTrash.id);
    check('al vaciar la papelera la imagen queda esperando, y si una nota la vuelve a nombrar se rescata', !!w && w.waiting === true && !!back && back.waiting === false, [w && w.waiting, back && back.waiting]);
    // Borrar la nota manda la imagen a esperar (sigue en la papelera), y mover la nota conserva la referencia.
    await S.api('POST', '/rename', { from: 'a.md', to: 'carpeta/a.md' }, ana.s); await sleep(700);
    check('mover una nota conserva sus imágenes', (await S.api('GET', '/files', undefined, ana.s)).json.files.find((f) => f.id === used.id).waiting === false && (await status(used.url)) === 200, null);
    // Los cifrados: el servidor no lee las notas, así que vale lo que la app declara.
    const b64 = (n, v) => Buffer.alloc(n, v).toString('base64');
    await S.api('POST', '/vaults', { folder: 'secreta', salt: b64(16, 3), iters: 200000, wrapped: b64(60, 3), check: b64(32, 3) }, otro.s);
    await S.api('PUT', '/notes/' + enc('secreta/n.md'), { text: 'vault1:' + b64(60, 7) }, otro.s);
    const x1 = (await S.up(otro.s, Buffer.alloc(300, 11), '?enc=1')).json; const x2 = (await S.up(otro.s, Buffer.alloc(300, 12), '?enc=1')).json;
    const refOk = await S.api('PUT', '/files/refs', { path: 'secreta/n.md', ids: [x1.id, moved.id, 'f'.repeat(40)] }, otro.s);
    const refBad = [await S.api('PUT', '/files/refs', { path: 'copiada.md', ids: [x1.id] }, otro.s), await S.api('PUT', '/files/refs', { path: 'secreta/no-existe.md', ids: [x1.id] }, otro.s), await S.api('PUT', '/files/refs', { path: 'secreta/n.md', ids: ['../x'] }, otro.s), await S.api('PUT', '/files/refs', { path: 'secreta/n.md', ids: 'x' }, otro.s), await S.api('PUT', '/files/refs', { path: 'secreta/n.md', ids: [x1.id] }), await S.api('PUT', '/files/refs?o=' + otro.id, { path: 'secreta/n.md', ids: [] }, ana.s)];
    check('la app declara qué imágenes cifradas usa una nota protegida: solo identificadores, solo las de esa cuenta', refOk.status === 200 && refOk.json.ids.join() === x1.id && refBad.map((x) => x.status).join() === '409,409,400,400,401,403', [refOk.json, refBad.map((x) => x.status)]);
    await sleep(1100);
    const encMid = (await S.api('GET', '/files', undefined, otro.s)).json.files;
    check('la cifrada que ninguna nota declara queda esperando su borrado; la declarada figura en uso', encMid.find((f) => f.id === x1.id).in_use === true && encMid.find((f) => f.id === x1.id).waiting === false && encMid.find((f) => f.id === x2.id).waiting === true && encMid.find((f) => f.id === x2.id).in_use === false, encMid.map((f) => [f.id.slice(0, 6), f.encrypted, f.in_use, f.waiting]));
    await sleep(2600);
    const encEnd = (await S.api('GET', '/files', undefined, otro.s)).json.files.map((f) => f.id);
    check('y pasado el margen se borra, igual que una en claro', encEnd.includes(x1.id) && !encEnd.includes(x2.id) && !S.onDisk().some((p) => p.endsWith(x2.id)), encEnd.length);
    await S.api('PUT', '/files/refs', { path: 'secreta/n.md', ids: [] }, otro.s); await sleep(3400);
    check('cuando la nota deja de declararla, le pasa lo mismo', !(await S.api('GET', '/files', undefined, otro.s)).json.files.some((f) => f.id === x1.id), null);
    // Subidas lentas: una que manda de a gotas o deja de mandar se corta; una normal entra.
    const trickle = (gapMs, stopAfter) => new Promise((resolve) => { const t0 = Date.now(); const sock = net.connect(S.port, '127.0.0.1', () => { sock.write('POST /files HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + otro.s + '\r\nContent-Type: image/png\r\nContent-Length: 200000\r\n\r\n'); let n = 0; const tick = setInterval(() => { if (sock.destroyed || (stopAfter && ++n > stopAfter)) { clearInterval(tick); return; } sock.write('\x89'); }, gapMs); sock.on('close', () => clearInterval(tick)); }); let b = ''; sock.on('data', (c) => { b += c; }); const end = () => resolve({ ms: Date.now() - t0, head: b.slice(0, 12) }); sock.on('close', end); sock.on('error', () => {}); setTimeout(() => { sock.destroy(); }, 9000); });
    const slow = await trickle(50, 0); const stalled = await trickle(50, 3);
    check('una subida que viene de a gotas, o que deja de mandar, se corta sola en poco tiempo', slow.ms < 4000 && stalled.ms < 4000, [slow, stalled]);
    check('y una subida normal sigue entrando, sin dejar nada a medias', (await S.up(otro.s, png(9, 9, 5000, 77))).status === 200 && fs.readdirSync(path.join(S.dir, 'files', 'tmp')).length === 0, null);
    // Eliminar la cuenta se lleva sus adjuntos.
    const before = S.onDisk().length;
    const del = await S.api('DELETE', '/account', { email: ana.email }, ana.s);
    check('eliminar la cuenta borra sus adjuntos del disco, y sus direcciones dejan de servir', del.status === 200 && before >= 4 && ![used.id, inTrash.id, inHist.id, moved.id].some((id) => S.onDisk().some((p) => p.endsWith(id))) && (await status(used.url)) === 404 && (await status(moved.url)) === 404, [del.status, before, S.onDisk().length]);
    check('limpieza: sin errores del servidor', !/error 500|error no capturado|promesa sin atender|adjuntos: /.test(S.log()), (S.log().match(/(error|adjuntos)[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('limpieza: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await S.stop();
}

await R.close();
process.exit(done() ? 1 : 0);
