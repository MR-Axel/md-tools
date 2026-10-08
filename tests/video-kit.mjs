// The two product videos: the desktop one (Chrome Web Store, landing page, social posts) and the phone one (Google Play).
// Both are the real app, driven by Playwright over made-up content, against the local site and a local sync server.
// Nothing reaches sharpmd.app. Neither is part of `npm test`.
//
// Usage:  FFMPEG=/path/to/ffmpeg node video.mjs [desktop] [android] [--only=scene,scene] [--keep]
//   FFMPEG      an ffmpeg with libx264 (`npm install ffmpeg-static` in a folder of its own; Playwright's build is not enough)
//   VIDEO_OUT   where the finished files go (default: dist/video, which git ignores)
//   VIDEO_TMP   scratch folder for frames and scene clips (default: the system temp folder); removed at the end unless --keep
//   --only      record just those scenes and stop before the final cut (their clips stay in VIDEO_TMP, with snapshots)
//
// How it works: every scene is recorded with the DevTools screencast (JPEG frames with their timestamps) from a browser
// whose device scale factor is real, so the frames come out at the size they are shown in the video. Playwright's own
// recordVideo is VP8 at a low bitrate and leaves small text blurry at 1080p. Each scene keeps only the windows between
// roll() and hold(), so loading and setup never reach the cut. ffmpeg then lays each scene over a 1920x1080 canvas, puts
// the caption on top (a transparent PNG drawn by the browser with the app's own font) and joins the scenes with short fades.
import { rig, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import { spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';

const FFMPEG = process.env.FFMPEG;
if (!FFMPEG || !fs.existsSync(FFMPEG)) { console.error('Set FFMPEG to an ffmpeg binary with libx264.'); process.exit(1); }
const OUT = process.env.VIDEO_OUT || path.join(root, 'dist', 'video');
const TMP = path.join(process.env.VIDEO_TMP || os.tmpdir(), 'sharpmd-video-work');
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const WANT = args.filter((a) => !a.startsWith('--'));
const want = (name) => !WANT.length || WANT.includes(name);
fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(path.join(TMP, 'snaps'), { recursive: true });

const FPS = 30; const FADE = 0.2;
const BG = '#121418'; const LIME = '#bef264';
// Where the app sits on the 1920x1080 canvas, and the size it is recorded at (CSS pixels times the scale factor).
const DESK = { w: 1024, h: 576, dsf: 1.5625, x: 160, y: 136, outW: 1600, outH: 900 };
const PHONE = { w: 360, h: 800, dsf: 2, x: 738, y: 47, outW: 444, outH: 986 };
const FULL = { w: 1920, h: 1080, dsf: 1, x: 0, y: 0, outW: 1920, outH: 1080 };

// ---------- Made-up content ----------
const PLAN = `# Launch plan

What is left before the online store opens.

## This week

- [x] Photos of the twelve products
- [x] Shipping prices by zone
- [ ] Test a purchase with a real card
- [ ] Write the welcome email

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

The total of an order, with shipping:

$$
T = \\sum_{i=1}^{n} p_i \\, q_i + s
$$
`;
const CHECK = `# Checkout

The steps a customer goes through, and what each one needs.

1. Cart, with the shipping price already in it
2. Address
3. Payment

Prices by zone are in this file:
`;
const ZONES = '# Shipping zones\n\n| Zone | Price |\n|---|---|\n| City | 4 |\n| Region | 7 |\n| Rest of the country | 11 |\n';
const DAY = `# Opening day

Notes for the first morning. Add what you find.

- Nora: product pages are live
- Tomas:
- Lia: the newsletter goes out at ten

## Open questions

Do we ship on Saturdays?
`;
const RESEARCH = `# Customer research

Five calls with people who bought from the pilot store.

## What we heard

- Three of five want to see the shipping price before the cart
- Two asked for a reminder when an order ships
`;
const VOICE = '# Returns\n\nHow a return is handled, step by step.\n';
const FOLDER = {
  'launch-plan.md': PLAN, 'order-flow.md': FLOW, 'checkout.md': CHECK, 'shipping-zones.md': ZONES,
  'notes/opening-day.md': DAY, 'notes/customer-calls.md': RESEARCH, 'notes/kickoff.md': '# Kickoff\n\nThe checkout is the riskiest piece, so it goes first.\n',
  'suppliers/packaging.md': '# Packaging\n\nBoxes in three sizes, ordered by the hundred.\n', 'suppliers/couriers.md': '# Couriers\n\nTwo quotes so far.\n',
};
const PHONE_PLAN = `# Launch plan

What is left before the store opens.

- [x] Photos of the products
- [x] Shipping prices by zone
- [ ] Test a purchase

Next review is on Thursday.
`;
const PHONE_FLOW = `# Order flow

\`\`\`mermaid
graph TD
  A[Order placed] --> B{Paid?}
  B -- Yes --> C[Packed]
  B -- No --> D[Reminder]
  C --> E[Shipped]
\`\`\`

## Shipping

| Zone | Price | Days |
|---|---|---|
| City | 4 | 1 |
| Suburbs | 5 | 2 |
| Region | 7 | 3 |
| Country | 11 | 5 |
| Abroad | 24 | 9 |
`;

// ---------- Recording ----------
// PUBLIC_URL only changes the address the app shows in Settings > AI: the server still listens on 127.0.0.1.
const R = await rig({ PUBLIC_URL: 'https://sync.sharpmd.app' });
const put = (who, p, text) => R.api('PUT', '/notes/' + encodeURIComponent(p), { text }, who.s);
const mcp = (token, name, a) => fetch(R.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a || {} } }) }).then((r) => r.json()).then((r) => r.result);
const run = (a) => { const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || r.error)); return r; };
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// A pointer on screen (a headless browser draws none) and a soft ring where a finger lands.
const POINTER = (kind) => {
  if (window.top !== window) return;
  const make = () => {
    if (document.getElementById('vid-pointer') || !document.documentElement) return;
    const style = document.createElement('style');
    style.textContent = '@keyframes vid-tap { from { transform: translate(-50%, -50%) scale(.35); opacity: .9; } to { transform: translate(-50%, -50%) scale(1); opacity: 0; } }' +
      '.vid-tap { position: fixed; z-index: 2147483647; width: 64px; height: 64px; border-radius: 50%; pointer-events: none; background: rgba(190, 242, 100, .32); border: 2px solid rgba(190, 242, 100, .85); animation: vid-tap .55s ease-out forwards; }';
    // The videos carry no word about plans: the line under the account and the Plan tab stay out of the picture.
    style.textContent += '.lmd-home-acct[data-cloud=menu] small, .lmd-panel [data-ptab=plan] { display: none !important; }';
    document.documentElement.appendChild(style);
    const c = document.createElement('div'); c.id = 'vid-pointer';
    if (kind === 'mouse') {
      let pos = { x: 600, y: 340 }; try { pos = JSON.parse(sessionStorage.getItem('vid-pointer')) || pos; } catch (e) { /* no storage */ }
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.6-4.3 3 6.6 2.7-1.2-3-6.5h6.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));transform:translate(' + (pos.x - 4) + 'px,' + (pos.y - 2) + 'px)';
      document.addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)'; try { sessionStorage.setItem('vid-pointer', JSON.stringify({ x: e.clientX, y: e.clientY })); } catch (err) { /* no storage */ } }, true);
    }
    document.documentElement.appendChild(c);
    window.__vidTap = (x, y) => { const r = document.createElement('div'); r.className = 'vid-tap'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); };
  };
  if (document.documentElement) make();
  document.addEventListener('DOMContentLoaded', make);
};

// Every take is a browser of its own, with a real profile: the scale factor has to be the window's own for the screencast to
// follow it, and a folder handle only survives in a profile that is kept on disk.
async function stage(geo, phone) {
  let n = 0;
  // who: already signed in. o.settings: merged into the app's settings. o.storage: more localStorage. o.init: [fn, arg] pairs run before the app.
  const take = async (who, o) => {
    o = o || {};
    const profile = path.join(TMP, 'profiles', 'p' + (++n) + '-' + Math.random().toString(36).slice(2, 7));
    const ctx = await chromium.launchPersistentContext(profile, Object.assign({ executablePath: process.env.CHROME_BIN || undefined, viewport: null, colorScheme: 'dark', locale: 'en-US', serviceWorkers: 'block',
      args: ['--force-device-scale-factor=' + geo.dsf, '--window-size=' + geo.w + ',' + geo.h, '--hide-scrollbars'].concat(phone ? ['--touch-events=enabled'] : []) }, phone ? { hasTouch: true } : {}));
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => { R.outside.push(r.request().url()); return r.abort(); });
    if (!phone) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: R.origin });
    await ctx.addInitScript(([url, w, settings, extra]) => {
      try {
        if (localStorage.getItem('vid:ready')) return;
        localStorage.setItem('vid:ready', '1');
        localStorage.setItem('mdtools:settings', JSON.stringify(Object.assign({ cloudUrl: url, language: 'en' }, settings)));
        if (w) localStorage.setItem('mdtools:cloud', JSON.stringify({ session: w.s, email: w.email, at: url }));
        Object.keys(extra).forEach((k) => localStorage.setItem(k, JSON.stringify(extra[k])));
      } catch (e) { /* a blank page has no storage */ }
    }, [R.base, who || null, o.settings || {}, o.storage || {}]);
    for (const [fn, arg] of o.init || []) await ctx.addInitScript(fn, arg);
    await ctx.addInitScript(POINTER, phone ? 'touch' : geo === FULL ? 'none' : 'mouse');
    const page = ctx.pages()[0] || await ctx.newPage(); page.on('pageerror', (e) => R.errors.push(e.message));
    page.on('dialog', (d) => { R.errors.push('native dialog: ' + d.message()); d.dismiss().catch(() => {}); });
    const dir = path.join(TMP, 'frames', String(++n).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 7)); fs.mkdirSync(dir, { recursive: true });
    const T = { ctx, page, geo, dir, frames: [], windows: [], writes: [], last: null, rolling: false, cur: { x: 600, y: 340 } };
    const cdp = await ctx.newCDPSession(page);
    const keep = (data, ts) => { const file = path.join(dir, 'f' + String(T.frames.length).padStart(5, '0') + '.jpg'); T.frames.push({ ts, file }); T.writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64'))); };
    cdp.on('Page.screencastFrame', (f) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      T.last = f.data; if (T.rolling) keep(f.data, Math.max(Date.now() - 400, Math.min(Date.now(), f.metadata.timestamp * 1000)));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, everyNthFrame: 1 });
    T.wait = (ms) => sleep(ms);
    // What happens between roll() and hold() is what the scene shows.
    T.roll = async () => { await sleep(60); const now = Date.now(); T.windows.push({ from: now, to: 0 }); if (T.last) keep(T.last, now); T.rolling = true; };
    T.hold = async () => { await sleep(40); T.rolling = false; T.windows[T.windows.length - 1].to = Date.now(); };
    // Snapshots are for working on one scene (--only): on a full run they would only make the recording stutter.
    T.snap = (name) => !ONLY.length ? Promise.resolve() : page.screenshot({ path: path.join(TMP, 'snaps', name + '.jpg'), type: 'jpeg', quality: 70 }).catch(() => {});
    T.point = async (loc, pos) => { const b = await loc.boundingBox(); if (!b) throw new Error('nothing to point at: ' + loc); return pos ? { x: b.x + pos.x, y: b.y + pos.y } : { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    // The pointer travels like a hand: it speeds up and slows down.
    T.move = async (x, y, ms) => {
      ms = ms == null ? 420 : ms; const a = { ...T.cur }; const t0 = Date.now();
      for (;;) { const k = ms > 0 ? Math.min(1, (Date.now() - t0) / ms) : 1; const e = ease(k); await page.mouse.move(a.x + (x - a.x) * e, a.y + (y - a.y) * e); if (k >= 1) break; await sleep(8); }
      T.cur = { x, y };
    };
    T.over = async (loc, pos, ms) => { const d = await T.point(loc, pos); await T.move(d.x, d.y, ms); return d; };
    T.click = async (loc, opt) => { opt = opt || {}; const d = await T.over(loc, opt.pos, opt.ms); await sleep(90); await page.mouse.click(d.x, d.y, { button: opt.button || 'left' }); return d; };
    T.type = (text, delay) => page.keyboard.type(text, { delay: delay == null ? 45 : delay });
    // A tap, with the ring a moment before the page reacts.
    T.tapAt = async (x, y) => { await page.evaluate(([px, py]) => window.__vidTap && window.__vidTap(px, py), [x, y]); await sleep(140); await page.touchscreen.tap(x, y); };
    T.tap = async (loc, pos) => { const d = await T.point(loc, pos); await T.tapAt(d.x, d.y); return d; };
    T.ring = (x, y) => page.evaluate(([px, py]) => window.__vidTap && window.__vidTap(px, py), [x, y]);
    T.close = async () => { T.rolling = false; await cdp.send('Page.stopScreencast').catch(() => {}); await Promise.all(T.writes); await ctx.close(); };
    S.last = T;
    return T;
  };
  const S = { take, geo, last: null };
  return S;
}

// ---------- The cut ----------
// The frames a scene kept, as a list ffmpeg reads: each frame with how long it stayed on screen.
function listOf(takes, file) {
  const lines = []; let total = 0; let lastFile = null;
  for (const T of takes) for (const w of T.windows) {
    const fr = T.frames.filter((f) => f.ts >= w.from && f.ts <= w.to);
    fr.forEach((f, i) => { const d = ((i + 1 < fr.length ? fr[i + 1].ts : w.to) - f.ts) / 1000; if (d <= 0) return; lines.push("file '" + f.file.replace(/\\/g, '/') + "'", 'duration ' + d.toFixed(4)); total += d; lastFile = f.file; });
  }
  if (lastFile) lines.push("file '" + lastFile.replace(/\\/g, '/') + "'");
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return total;
}
// A page drawn by the browser and saved with its transparency: captions and the phone frame.
async function drawPng(html, file) {
  const c = await R.browser.newContext({ viewport: { width: 1920, height: 1080 } }); const p = await c.newPage();
  await p.route(R.origin + '/__drawn', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html })); await p.goto(R.origin + '/__drawn'); await p.evaluate(() => document.fonts.ready); await sleep(150);
  await p.screenshot({ path: file, omitBackground: true }); await c.close();
}
const FONT = `@font-face { font-family: "Inter"; font-weight: 100 900; src: url("${R.origin}/vendor/fonts/inter.woff2") format("woff2"); }
  * { box-sizing: border-box; } html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  body { color: #e6e8ec; font-family: "Inter", sans-serif; -webkit-font-smoothing: antialiased; }`;
// The canvas around the app: everything dark except a rounded hole where the recording shows through.
const holeCss = (g, radius) => `.hole { position: absolute; left: ${g.x}px; top: ${g.y}px; width: ${g.outW}px; height: ${g.outH}px; border-radius: ${radius}px; box-shadow: 0 0 0 4000px ${BG}; }`;
const deskOverlay = (label) => `<!doctype html><meta charset="utf-8"><style>${FONT} ${holeCss(DESK, 14)}
  .edge { position: absolute; left: ${DESK.x}px; top: ${DESK.y}px; width: ${DESK.outW}px; height: ${DESK.outH}px; border-radius: 14px; border: 1px solid #2a2e37; }
  .cap { position: absolute; left: 0; right: 0; top: 34px; display: flex; justify-content: center; }
  .cap span { background: ${LIME}; color: #14170d; font-weight: 680; font-size: 38px; letter-spacing: -0.02em; line-height: 1; padding: 16px 34px 18px; border-radius: 999px; white-space: nowrap; }
</style><body><div class="hole"></div><div class="edge"></div><div class="cap"><span>${label}</span></div></body>`;
const phoneOverlay = (label) => `<!doctype html><meta charset="utf-8"><style>${FONT} ${holeCss(PHONE, 34)}
  .body { position: absolute; left: ${PHONE.x - 13}px; top: ${PHONE.y - 13}px; width: ${PHONE.outW + 26}px; height: ${PHONE.outH + 26}px; border-radius: 47px; border: 13px solid #23272f; box-shadow: 0 0 0 2px #3a404b, 0 40px 90px rgba(0, 0, 0, .55); }
  .glow { position: absolute; inset: 0; background: radial-gradient(50% 70% at 12% 105%, rgba(190, 242, 100, .13), transparent 70%); }
  .cap { position: absolute; left: 110px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .cap i { display: block; width: 76px; height: 10px; border-radius: 5px; background: ${LIME}; margin-bottom: 34px; }
  .cap span { font-weight: 720; font-size: 76px; letter-spacing: -0.035em; line-height: 1.06; }
  .brand { position: absolute; right: 110px; bottom: 84px; display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 34px; letter-spacing: -0.03em; color: #a0a7b4; }
  .brand img { width: 46px; height: 46px; border-radius: 11px; }
</style><body><div class="hole"></div><div class="glow"></div><div class="body"></div><div class="cap"><i></i><span>${label}</span></div><div class="brand"><img src="${R.origin}/icons/icon128.png"><div>Sharp<span style="font-weight:400">MD</span></div></div></body>`;
// The opening and closing cards, animated by the browser and recorded like any other scene.
const card = (lines) => `<!doctype html><meta charset="utf-8"><style>${FONT} html, body { background: ${BG}; }
  .glow { position: absolute; inset: 0; background: radial-gradient(60% 80% at 20% 110%, rgba(190, 242, 100, .16), transparent 70%); }
  .mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .mid > * { opacity: 0; transform: translateY(18px); } .go .mid > * { opacity: 1; transform: none; transition: opacity .45s ease, transform .45s cubic-bezier(.2, .7, .2, 1); }
  .go .mid > :nth-child(2) { transition-delay: .28s; } .go .mid > :nth-child(3) { transition-delay: .56s; }
  img { width: 216px; height: 216px; border-radius: 48px; box-shadow: 0 30px 80px rgba(0, 0, 0, .55); }
  h1 { margin: 56px 0 0; font-weight: 720; font-size: 86px; letter-spacing: -0.035em; line-height: 1.08; } h1 b { color: ${LIME}; font-weight: 720; }
  p { margin: 28px 0 0; font-size: 44px; color: #a0a7b4; letter-spacing: -0.015em; } p b { color: ${LIME}; font-weight: 600; }
</style><body><div class="glow"></div><div class="mid"><img src="${R.origin}/icons/icon512.png">${lines}</div></body>`;

async function cardScene(S, html, ms) {
  const T = await S.take(null);
  // Served from the site's own address, so the font loads.
  await T.page.route(R.origin + '/__card', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html })); await T.page.goto(R.origin + '/__card');
  await T.page.evaluate(() => document.fonts.ready); await sleep(400);
  await T.roll(); await sleep(250); await T.page.evaluate(() => document.body.classList.add('go')); await sleep(ms); await T.hold();
  return [T];
}

// Turns what a scene recorded into its clip on the canvas, caption included.
async function clip(name, takes, geo, overlayHtml) {
  for (const T of takes) await T.close();
  const list = path.join(TMP, name + '.txt'); const secs = listOf(takes, list); const out = path.join(TMP, name + '.mp4');
  const scale = `fps=${FPS},scale=${geo.outW}:${geo.outH}:flags=lanczos,format=gbrp`;
  const enc264 = ['-t', secs.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-an', out];
  const tv = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
  if (!overlayHtml) run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', scale + ',' + tv, ...enc264]);
  else {
    const png = path.join(TMP, name + '.png'); await drawPng(overlayHtml, png);
    run(['-f', 'concat', '-safe', '0', '-i', list, '-loop', '1', '-i', png, '-filter_complex',
      `[0:v]${scale},pad=1920:1080:${geo.x}:${geo.y}:color=${BG.replace('#', '0x')}[a];[1:v]format=gbrap[o];[a][o]overlay=format=gbrp,${tv}[v]`, '-map', '[v]', ...enc264]);
  }
  console.log('  ' + name + ': ' + secs.toFixed(1) + ' s');
  return { name, file: out, secs };
}
// Joins the scene clips with short fades and writes the finished video, its poster and a frame every two seconds to look at.
function finish(clips, name, crf, posterAt) {
  const inputs = []; clips.forEach((c) => inputs.push('-i', c.file));
  let graph = ''; let prev = '[0:v]'; let at = 0;
  clips.forEach((c, i) => { if (!i) { at = c.secs; return; } const off = at - FADE; const tag = i === clips.length - 1 ? '[v]' : '[x' + i + ']'; graph += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${off.toFixed(3)}${tag};`; prev = tag; at = off + c.secs; });
  const file = path.join(OUT, name + '.mp4');
  run([...inputs, '-filter_complex', graph.replace(/;$/, ''), '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', file]);
  run(['-ss', posterAt.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '3', path.join(OUT, name + '-poster.jpg')]);
  const rev = path.join(OUT, 'revision'); fs.mkdirSync(rev, { recursive: true });
  fs.readdirSync(rev).filter((f) => f.startsWith(name + '-')).forEach((f) => fs.rmSync(path.join(rev, f)));
  run(['-i', file, '-vf', 'fps=1/2:start_time=0:round=down,scale=1280:-2:flags=lanczos', '-q:v', '4', path.join(rev, name + '-%02d.jpg')]);
  console.log(name + '.mp4: ' + at.toFixed(1) + ' s · ' + (fs.statSync(file).size / 1048576).toFixed(2) + ' MB');
  return at;
}

// ---------- What the scenes share ----------
const settle = (page) => page.evaluate(() => document.fonts.ready).then(() => sleep(350));
const editing = async (page) => { await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article .lmd-editable'); await sleep(350); };
// The made-up folder, as if picked from the disk: it lives in the browser's private file system.
const seedFolder = (page, files) => page.evaluate(async (list) => {
  const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('shop', { create: true });
  for (const name of Object.keys(list)) {
    const parts = name.split('/'); let dir = top;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const h = await dir.getFileHandle(parts[parts.length - 1], { create: true }); const s = await h.createWritable(); await s.write(list[name]); await s.close();
  }
  window.showDirectoryPicker = async () => top;
}, files);
// Opens the folder and leaves that file on screen.
async function folderAt(T, file) {
  const p = T.page;
  await p.goto(R.home); await p.waitForSelector('[data-home=dir]'); await seedFolder(p, FOLDER);
  await p.click('[data-home=dir]'); await p.waitForSelector('.lmd-xroot[data-root=disk] a.lmd-node');
  await p.locator('.lmd-xroot[data-root=disk] a.lmd-node', { hasText: file }).first().click(); await p.waitForFunction((f) => new RegExp(f.replace('.', '\\.')).test(decodeURIComponent(location.href)), file);
  await p.waitForSelector('.lmd-article h1'); await settle(p);
}
// The end of the last line of a block, relative to the block.
const endOf = (loc) => loc.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const cs = r.getClientRects(); const u = cs[cs.length - 1]; const b = el.getBoundingClientRect(); return { x: u.right - b.left - 3, y: u.top - b.top + u.height / 2 }; });

// The speech recogniser, replaced before the app loads: it says what the scene tells it to.
const fakeRecognizer = () => {
  const S = window.__sr = { current: null };
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.processLocally = false; this._on = false; }
    start() { if (this._on) throw new DOMException('already started', 'InvalidStateError'); this._on = true; S.current = this; setTimeout(() => { if (this.onstart) this.onstart({}); if (this.onaudiostart) this.onaudiostart({}); }, 10); }
    stop() { if (!this._on) return; this._on = false; setTimeout(() => { if (this.onend) this.onend({}); }, 10); }
    abort() { this.stop(); }
  }
  S.emit = (text, final) => { const r = S.current; if (!r || !r._on) return false; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: !!final })] }); return true; };
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeSR, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeSR, configurable: true, writable: true });
};
const fakeSynth = () => {
  const V = (name, lang, uri, def) => ({ name, lang, voiceURI: uri, localService: true, default: !!def });
  const fake = { getVoices: () => [V('English', 'en-US', 'v-us', true)], addEventListener() {}, removeEventListener() {}, pause() {}, resume() {}, speaking: false, pending: false, paused: false, speak(u) { setTimeout(() => { if (u.onstart) u.onstart({ type: 'start' }); }, 10); }, cancel() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; };
};
const say = (page, text, final) => page.evaluate(([t, f]) => window.__sr.emit(t, f), [text, final !== false]);


export { R, stage, clip, finish, cardScene, card, deskOverlay, phoneOverlay, folderAt, editing, settle, endOf, put, mcp, say, fakeRecognizer, fakeSynth, sleep, TMP, ONLY, KEEP, want, DESK, PHONE, FULL,
  PLAN, DAY, RESEARCH, VOICE, ZONES, PHONE_PLAN, PHONE_FLOW };
