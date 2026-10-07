// Los clips en bucle de la portada: la app de verdad, grabada con Playwright sobre contenido inventado.
// Cada clip muestra una sola cosa en pocos segundos. Salen a docs/clips como WebM (VP9), MP4 (H.264) y un póster JPG.
// Uso:  FFMPEG=/ruta/a/ffmpeg node clips.mjs [edit diagram live drop]
// Hace falta un ffmpeg con libvpx-vp9 y libx264 (el que baja Playwright solo graba VP8, no alcanza): por ejemplo
// `npm install ffmpeg-static` en una carpeta aparte y FFMPEG apuntando a su ejecutable. No forma parte de `npm test`.
import { rig, sleep, root } from './rig.mjs';
import { spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';

const FFMPEG = process.env.FFMPEG;
if (!FFMPEG || !fs.existsSync(FFMPEG)) { console.error('Falta FFMPEG: la ruta a un ffmpeg con libvpx-vp9 y libx264.'); process.exit(1); }
const out = path.join(root, 'docs', 'clips'); fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-clips-'));
const W = 880; const H = 550;
const want = process.argv.slice(2);

const PLAN = `# Launch plan

What is left before the online store opens.

## This week

- [x] Photos of the twelve products
- [x] Shipping prices by zone
- [ ] Test a purchase with a real card

| Task | Owner | Status |
|---|---|---|
| Product pages | Nora | Done |
| Checkout | Tomas | In testing |
| Newsletter | Lia | Started |
`;
const FLOW = `# Order flow

What happens after a customer pays.

\`\`\`mermaid
graph LR
  A[Order placed] --> B{Paid?}
  B -- Yes --> C[Packed]
  B -- No --> D[Reminder email]
  C --> E[Shipped]
\`\`\`
`;
const NOTES = `# Opening day

Notes for the first morning. Add what you find.

- Nora: product pages are live
- Tomas:
- Lia: the newsletter goes out at ten

## Open questions

Do we ship on Saturdays?
`;
const ZONES = '# Shipping zones\n\n| Zone | Price |\n|---|---|\n| City | 4 |\n| Region | 7 |\n| Rest of the country | 11 |\n';
const CHECK = `# Checkout

The steps a customer goes through, and what each one needs.

1. Cart, with the shipping price already in it
2. Address
3. Payment

Prices by zone are in this file:
`;

const R = await rig();
const enc = encodeURIComponent;
const put = (who, p, text) => R.api('PUT', '/notes/' + enc(p), { text }, who.s);

// Un cursor a la vista: el navegador sin ventana no dibuja el del sistema.
const CURSOR = () => {
  const make = () => {
    if (document.getElementById('clip-cursor') || !document.body) return;
    const c = document.createElement('div'); c.id = 'clip-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;width:20px;height:20px;margin:-2px 0 0 -3px;pointer-events:none;transition:transform .04s linear;transform:translate(-40px,-40px);' +
      'background:url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M3 2l13 7.2-5.7 1.5L8.6 17z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>') + '") no-repeat';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  };
  document.addEventListener('DOMContentLoaded', make); make();
};

// Abre un navegador que graba, con la sesión de who. side: con la barra lateral a la vista.
async function studio(who, side) {
  const dir = path.join(tmp, 'v' + Math.random().toString(36).slice(2, 8));
  const c = await R.open(who, { viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  c.t0 = Date.now(); c.dir = dir;
  await c.ctx.addInitScript((hide) => { try { const s = JSON.parse(localStorage.getItem('mdtools:settings') || '{}'); s.sidebarHidden = hide; localStorage.setItem('mdtools:settings', JSON.stringify(s)); } catch (e) { /* sin almacenamiento */ } }, !side);
  await c.ctx.addInitScript(CURSOR);
  return c;
}
// Mueve el cursor hasta el centro (o un punto) de un elemento, a la vista.
async function glide(page, loc, at) {
  const b = await loc.boundingBox(); const x = b.x + (at ? at.x : b.width / 2); const y = b.y + (at ? at.y : b.height / 2);
  await page.mouse.move(x, y, { steps: 18 }); await sleep(120);
  return [x, y];
}
const run = (args) => { const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr); };
// Cierra la grabación y saca del tramo [from, to] (milisegundos desde que arrancó) los tres archivos del clip.
async function cut(c, name, from, to) {
  const video = c.page.video(); await c.ctx.close();
  const raw = await video.path(); const ss = (from / 1000).toFixed(2); const t = ((to - from) / 1000).toFixed(2);
  const vf = 'fps=24,scale=' + W + ':-2:flags=lanczos';
  run(['-ss', ss, '-t', t, '-i', raw, '-an', '-vf', vf, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '35', '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-g', '240', path.join(out, name + '.webm')]);
  run(['-ss', ss, '-t', t, '-i', raw, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '27', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-g', '240', path.join(out, name + '.mp4')]);
  run(['-ss', ss, '-i', raw, '-frames:v', '1', '-vf', 'scale=' + W + ':-2:flags=lanczos', '-q:v', '5', path.join(out, name + '.jpg')]);
  const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024);
  console.log(name + ': ' + t + ' s · webm ' + kb(name + '.webm') + ' KB · mp4 ' + kb(name + '.mp4') + ' KB · póster ' + kb(name + '.jpg') + ' KB');
}
const editing = async (page) => { await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article .lmd-editable'); await sleep(400); };

const CLIPS = {
  // Escribir sobre el texto ya formateado: un párrafo, los signos que se vuelven negrita y una celda de la tabla.
  async edit() {
    const who = await R.signup('nora@ejemplo.test', true); await put(who, 'launch-plan.md', PLAN);
    const c = await studio(who, false); const p = c.page;
    await p.goto(R.noteUrl('launch-plan.md')); await p.waitForSelector('.lmd-article table'); await editing(p);
    await p.mouse.move(700, 480); await sleep(500);
    const from = Date.now() - c.t0;
    await sleep(350);
    const para = p.locator('.lmd-article p', { hasText: 'What is left' });
    const [x, y] = await glide(p, para, { x: 300, y: 12 }); await p.mouse.click(x, y); await p.keyboard.press('Control+End'); await p.mouse.move(x + 40, y + 34, { steps: 6 }); await sleep(250);
    await p.keyboard.type(' We go live on **Monday**.', { delay: 55 }); await sleep(700);
    const cell = p.locator('.lmd-article td', { hasText: 'In testing' });
    const [cx, cy] = await glide(p, cell); await p.mouse.click(cx, cy); await p.keyboard.press('End'); await p.mouse.move(cx + 150, cy + 30, { steps: 6 }); await sleep(250);
    await p.keyboard.type(', one bug left', { delay: 55 }); await sleep(1300);
    await cut(c, 'edit', from, Date.now() - c.t0);
  },
  // El editor de diagramas: se escribe una línea y el dibujo de al lado la suma.
  async diagram() {
    const who = await R.signup('tomas@ejemplo.test', true); await put(who, 'order-flow.md', FLOW);
    const c = await studio(who, false); const p = c.page;
    await p.goto(R.noteUrl('order-flow.md')); await p.waitForSelector('.lmd-diagram svg'); await editing(p);
    await p.mouse.move(640, 500); await sleep(400);
    const from = Date.now() - c.t0;
    await sleep(350);
    const d = p.locator('.lmd-diagram').first(); const [x, y] = await glide(p, d); await p.mouse.click(x, y);
    await p.waitForSelector('.lmd-dgm-svg svg'); await sleep(900);
    const ta = p.locator('.lmd-dgm textarea'); await ta.focus(); await p.keyboard.press('Control+End'); await sleep(200);
    await p.keyboard.type('\n  E --> F[Thank-you email]', { delay: 60 });
    await p.waitForFunction(() => /Thank-you email/.test(document.querySelector('.lmd-dgm-svg').textContent), null, { timeout: 8000 }).catch(() => {});
    await sleep(1400);
    await cut(c, 'diagram', from, Date.now() - c.t0);
  },
  // Una sesión en vivo: dos personas en la misma nota, cada una en su bloque, y lo que escribe una le aparece a la otra.
  async live() {
    const who = await R.signup('lia@ejemplo.test', true); await put(who, 'opening-day.md', NOTES);
    const c = await studio(who, false); const p = c.page;
    await p.goto(R.noteUrl('opening-day.md')); await p.waitForSelector('.lmd-article h1');
    await p.click('[data-act=sync]'); await p.click('.lmd-menu [data-s=live]'); await p.waitForSelector('.lmd-live-card [data-lv=name]');
    await p.fill('[data-lv=name]', 'Lia'); await p.click('[data-lv=start]'); await p.waitForSelector('.lmd-live-link input');
    const link = await p.inputValue('.lmd-live-link input'); await p.click('.lmd-live-card [data-lv=close]');
    const g = await R.open(null, { viewport: { width: W, height: H } });
    await g.page.goto(link); await g.page.waitForSelector('.lmd-live-card input'); await g.page.fill('.lmd-live-card input', 'Tomas'); await g.page.click('.lmd-live-card [data-lv=join]');
    await g.page.waitForSelector('.lmd-live-bar'); await g.page.waitForSelector('.lmd-article .lmd-editable');
    await editing(p).catch(() => {});
    await p.mouse.move(700, 470); await sleep(900);
    const from = Date.now() - c.t0;
    await sleep(300);
    await g.page.locator('.lmd-article li', { hasText: 'Tomas:' }).click(); await g.page.keyboard.press('End');
    const q = p.locator('.lmd-article p', { hasText: 'Do we ship' }); const [x, y] = await glide(p, q, { x: 200, y: 12 }); await p.mouse.click(x, y); await p.keyboard.press('Control+End'); await p.mouse.move(x + 60, y + 60, { steps: 6 });
    await Promise.all([
      g.page.keyboard.type(' checkout passes with the test card', { delay: 70 }),
      (async () => { await sleep(500); await p.keyboard.type(' Only until noon.', { delay: 80 }); })(),
    ]);
    await p.waitForFunction(() => /test card/.test(document.querySelector('.lmd-article').textContent), null, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    await g.ctx.close();
    await cut(c, 'live', from, Date.now() - c.t0);
  },
  // Arrastrar un archivo del explorador a la nota: queda un enlace donde cae.
  async drop() {
    const who = await R.signup('ines@ejemplo.test', true);
    await put(who, 'checkout.md', CHECK); await put(who, 'shipping-zones.md', ZONES); await put(who, 'launch-plan.md', PLAN);
    const c = await studio(who, true); const p = c.page;
    await p.goto(R.noteUrl('checkout.md')); await p.waitForSelector('.lmd-article h1'); await p.waitForSelector('.lmd-xroot[data-root=cloud] a.lmd-node'); await editing(p);
    await p.mouse.move(600, 480); await sleep(500);
    const from = Date.now() - c.t0;
    await sleep(350);
    const file = p.locator('.lmd-xroot[data-root=cloud] a.lmd-node', { hasText: 'shipping-zones.md' });
    await glide(p, file, { x: 70, y: 14 }); await sleep(450); await p.mouse.down();
    const para = p.locator('.lmd-article p', { hasText: 'Prices by zone' }); const b = await para.boundingBox();
    // Entre dos bloques la marca es un renglón: el enlace queda en su propio párrafo.
    await p.mouse.move(b.x + 120, b.y + b.height + 7, { steps: 34 }); await p.mouse.move(b.x + 122, b.y + b.height + 7, { steps: 2 }); await sleep(800);
    await p.mouse.up(); await sleep(500);
    await p.mouse.move(b.x + 330, b.y + 110, { steps: 14 }); await sleep(1700);
    await cut(c, 'drop', from, Date.now() - c.t0);
  },
};

try {
  for (const name of Object.keys(CLIPS)) { if (want.length && !want.includes(name)) continue; await CLIPS[name](); }
  if (R.errors.length) console.log('errores de página:', R.errors);
} finally { await R.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ } }
const total = fs.readdirSync(out).filter((f) => /\.(webm|mp4)$/.test(f)).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log('clips en ' + out + ' · ' + Math.round(total / 1024) + ' KB entre todos los videos');
process.exit(0);
