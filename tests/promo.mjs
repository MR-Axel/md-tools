// Mosaicos promocionales de la Chrome Web Store: 440x280 y 1400x560, PNG de 24 bits sin alfa.
// Uso: node promo.mjs   (deja los PNG en docs/store, al lado de las capturas)
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'store');
const url = (p) => pathToFileURL(path.join(root, p)).href;
const base = `<style>
  @font-face { font-family: "Inter"; font-weight: 100 900; src: url("${url('vendor/fonts/inter.woff2')}") format("woff2"); }
  * { box-sizing: border-box; } html, body { margin: 0; height: 100%; }
  body { background: #121418; color: #e6e8ec; font-family: "Inter", sans-serif; -webkit-font-smoothing: antialiased; overflow: hidden; }
  .glow { position: absolute; inset: 0; background: radial-gradient(60% 80% at 20% 110%, rgba(190, 242, 100, .18), transparent 70%); }
  .brand { display: flex; align-items: center; gap: .5em; font-weight: 720; letter-spacing: -0.03em; }
  .brand img { width: 1.25em; height: 1.25em; border-radius: .28em; }
  .tag { color: #a0a7b4; letter-spacing: -0.01em; }
  .tag b { color: #bef264; font-weight: 600; }
</style>`;
const small = `<!doctype html><meta charset="utf-8">${base}<body><div class="glow"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 44px">
    <div class="brand" style="font-size:46px"><img src="${url('icons/icon128.png')}">Sharpmd</div>
    <div class="tag" style="margin-top:16px;font-size:21px;line-height:1.3">Read and edit Markdown<br>in the browser</div>
  </div></body>`;
const big = `<!doctype html><meta charset="utf-8">${base}<body><div class="glow"></div>
  <div style="position:absolute;left:84px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center">
    <div class="brand" style="font-size:72px"><img src="${url('icons/icon128.png')}">Sharpmd</div>
    <div class="tag" style="margin-top:26px;font-size:34px;line-height:1.25">Read and edit Markdown<br>in the browser</div>
    <div class="tag" style="margin-top:22px;font-size:20px"><b>Free and open source</b> · sharpmd.app</div>
  </div>
  <img src="${url('docs/store/2-editing.png')}" style="position:absolute;left:660px;top:70px;width:880px;border:1px solid #2a2e37;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6)">
</body>`;
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
for (const [name, w, h, html] of [['promo-440x280', 440, 280, small], ['promo-1400x560', 1400, 560, big]]) {
  const tmp = path.join(out, '_' + name + '.html'); fs.writeFileSync(tmp, html);
  const pg = await b.newPage({ viewport: { width: w, height: h } });
  await pg.goto(pathToFileURL(tmp).href); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(out, name + '.png') }); await pg.close(); fs.rmSync(tmp);
}
await b.close();
console.log('mosaicos en ' + out);
