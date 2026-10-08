// La imagen que se ve al compartir el enlace de sharpmd.app (og:image y twitter:image): 1200x630, PNG.
// Uso: node social.mjs   (la deja en docs/, con el nombre que espera tools/build-site.mjs)
// Si el diseño cambia, se le cambia el número al archivo acá y en build-site.mjs: las redes guardan la anterior por su dirección.
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'social-card-3.png');
const font = pathToFileURL(path.join(root, 'vendor/fonts/inter.woff2')).href;
const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Inter"; font-weight: 100 900; src: url("${font}") format("woff2"); }
  * { box-sizing: border-box; } html, body { margin: 0; }
  body { width: 1200px; height: 630px; position: relative; overflow: hidden; background: #121418; color: #e6e8ec; font-family: "Inter", sans-serif; -webkit-font-smoothing: antialiased; }
  .glow { position: absolute; right: -220px; top: -160px; width: 900px; height: 900px; background: radial-gradient(closest-side, rgba(190, 242, 100, .17), rgba(190, 242, 100, 0)); }
  .text { position: absolute; left: 88px; top: 0; bottom: 0; width: 640px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 26px; font-size: 104px; font-weight: 740; letter-spacing: -0.045em; line-height: 1; }
  .brand svg { width: 128px; height: 118px; flex: none; }
  .tag { margin-top: 40px; font-size: 47px; line-height: 1.18; font-weight: 560; letter-spacing: -0.028em; color: #c9ced8; }
  .tag b { color: #bef264; font-weight: 620; }
  /* A la derecha, un recorte de la app como detalle: una nota con el párrafo que se está escribiendo. */
  .app { position: absolute; left: 800px; top: 118px; width: 560px; height: 620px; border: 1.5px solid #2f343e; border-radius: 22px; background: #0f1114; box-shadow: 0 40px 90px rgba(0, 0, 0, .55); padding: 46px 44px; transform: rotate(-3deg); }
  .app h1 { margin: 0 0 22px; font-size: 40px; letter-spacing: -0.03em; font-weight: 720; }
  .app .p { height: 14px; border-radius: 7px; background: #2a2e37; margin-bottom: 16px; }
  .app .edit { margin: 26px -14px 30px; padding: 16px 14px; border: 2px solid #bef264; border-radius: 10px; background: rgba(190, 242, 100, .07); font-size: 25px; white-space: nowrap; }
  .app .edit small { display: block; margin-bottom: 6px; color: #bef264; font-size: 16px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
  .app .edit i { display: inline-block; width: 3px; height: 30px; margin-left: 3px; vertical-align: -6px; background: #e8eaee; border-radius: 2px; }
  .app .t { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; } .app .t i { width: 22px; height: 22px; border-radius: 6px; border: 2px solid #4a505c; flex: none; } .app .t.on i { background: #bef264; border-color: #bef264; } .app .t .p { margin: 0; flex: 1; }
</style><body>
  <div class="glow"></div>
  <div class="app"><h1>Launch plan</h1><div class="p" style="width:92%"></div><div class="p" style="width:64%"></div>
    <div class="edit"><small>Written by your AI</small>Checkout passes the test<i></i></div>
    <div class="t on"><i></i><div class="p" style="max-width:250px"></div></div><div class="t on"><i></i><div class="p" style="max-width:310px"></div></div><div class="t"><i></i><div class="p" style="max-width:210px"></div></div><div class="t"><i></i><div class="p" style="max-width:280px"></div></div></div>
  <div class="text">
    <div class="brand"><svg viewBox="8 12 50 40"><path d="M27 16 22 48M41 16 36 48M13 27h30M11 38h30" fill="none" stroke="#bef264" stroke-width="5.5" stroke-linecap="round"/><rect x="48" y="15" width="6" height="34" rx="3" fill="#e8eaee"/></svg>SharpMD</div>
    <div class="tag">Markdown notes your <b>AI</b> writes and your <b>team</b> reads</div>
  </div>
</body>`;
const tmp = path.join(root, 'docs', '_social.html'); fs.writeFileSync(tmp, html);
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
try {
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await pg.goto(pathToFileURL(tmp).href); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out });
} finally { await b.close(); fs.rmSync(tmp); }
console.log(out + ' · ' + Math.round(fs.statSync(out).size / 1024) + ' KB');
