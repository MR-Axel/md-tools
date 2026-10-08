// Draws every PNG of the logo from one description of the mark: the extension icons, the PWA icons (with the
// maskable one), the Apple touch icons, and the two SVG sources (icons/logo.svg and icons/logo-app.svg).
// Usage: node tools/build-icons.mjs                 (writes icons/, commit the result)
//        node tools/build-icons.mjs --store <dir>   (also writes the large PNGs the store listings ask for, outside the repo)
// It uses the Chromium that the tests install (tests/node_modules/playwright-core).
// The same drawing is written by hand in a few places that cannot load a file: the loading screen of src/app.html
// and of tools/landing.src.html, the tab icon in src/content.js, the icon of published sites in server/server.mjs
// and the social card in tests/social.mjs. If the mark changes, change those too.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'tests', 'package.json'))('playwright-core');

const INK = '#14161a', PAPER = '#f3f5f8', LIME = '#c5f467';
// The mark on a 64 grid: a number sign made of four bars, and a block cursor to its right.
const HASH = [[14.5, 17, 6, 30], [26.5, 17, 6, 30], [8.5, 23.25, 30, 6], [8.5, 34.75, 30, 6]];
const CURSOR = [43.5, 15, 11, 34];
// Small sizes are drawn on their own pixel grid, so every bar and every gap is a whole number of pixels.
const GRID = {
  16: { hash: [[3, 4, 2, 8], [7, 4, 2, 8], [2, 5, 8, 2], [2, 9, 8, 2]], cursor: [11, 3, 3, 10], r: 0, rc: 0.5 },
  32: { hash: [[7, 8, 3, 16], [14, 8, 3, 16], [4, 11, 16, 3], [4, 18, 16, 3]], cursor: [22, 7, 6, 18], r: 0.5, rc: 1 },
  48: { hash: [[10, 13, 5, 22], [19, 13, 5, 22], [6, 17, 22, 5], [6, 26, 22, 5]], cursor: [32, 11, 9, 26], r: 1, rc: 2 },
};
const rect = (r, rx, fill) => '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="' + rx + '"' + (fill ? ' fill="' + fill + '"' : '') + '/>';

// app: the inverted mark (lime tile, dark drawing). bleed: a square with no corners of its own, for the icons the
// system crops itself. scale: shrinks the drawing around the center (a maskable icon keeps it inside the middle 80%).
function svg(size, o = {}) {
  const g = !o.bleed && !o.app && GRID[size];
  const box = g ? size : 64;
  const tile = '<rect width="' + box + '" height="' + box + '"' + (o.bleed ? '' : ' rx="' + (15 * box / 64) + '"') + ' fill="' + (o.app ? LIME : INK) + '"/>';
  const hash = (g ? g.hash : HASH).map((r) => rect(r, g ? g.r : 1.3)).join('');
  const cur = g ? g.cursor : CURSOR, rc = g ? g.rc : 2.4;
  const draw = o.app
    ? '<g fill="' + INK + '">' + hash + rect(cur, rc) + '</g>'
    : '<g fill="' + PAPER + '">' + hash + '</g>' + rect(cur, rc, LIME);
  const fit = o.scale && o.scale !== 1 ? '<g transform="translate(32 32) scale(' + o.scale + ') translate(-31.5 -32)">' + draw + '</g>' : draw;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + box + ' ' + box + '">' + tile + fit + '</svg>';
}

const icons = path.join(root, 'icons');
fs.writeFileSync(path.join(icons, 'logo.svg'), svg(64) + '\n');
fs.writeFileSync(path.join(icons, 'logo-app.svg'), svg(64, { app: true }) + '\n');

// [file, size, options]. The phone icons (maskable and Apple touch) use the inverted mark, full bleed.
const OUT = [16, 32, 48, 128, 192, 512].map((n) => [path.join(icons, 'icon' + n + '.png'), n, {}]);
OUT.push([path.join(icons, 'icon512-maskable.png'), 512, { app: true, bleed: true, scale: 0.8 }]);
for (const n of [152, 167, 180]) OUT.push([path.join(icons, 'apple-touch-icon-' + n + '.png'), n, { app: true, bleed: true }]);
const at = process.argv.indexOf('--store');
if (at > 0) {
  const dir = path.resolve(process.argv[at + 1] || ''); fs.mkdirSync(dir, { recursive: true });
  for (const n of [512, 1024]) {
    OUT.push([path.join(dir, 'sharpmd-mark-' + n + '.png'), n, {}], [path.join(dir, 'sharpmd-mark-square-' + n + '.png'), n, { bleed: true }]);
    OUT.push([path.join(dir, 'sharpmd-app-' + n + '.png'), n, { app: true }], [path.join(dir, 'sharpmd-app-square-' + n + '.png'), n, { app: true, bleed: true }]);
  }
  OUT.push([path.join(dir, 'chrome-store-128.png'), 128, {}]);
  fs.writeFileSync(path.join(dir, 'sharpmd-mark.svg'), svg(64) + '\n'); fs.writeFileSync(path.join(dir, 'sharpmd-app.svg'), svg(64, { app: true }) + '\n');
}

const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
try {
  const pg = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  for (const [file, n, o] of OUT) {
    await pg.setContent('<!doctype html><style>html, body { margin: 0; background: transparent; } svg { display: block; width: ' + n + 'px; height: ' + n + 'px; }</style>' + svg(n, o));
    // A full-bleed icon has no transparent pixel: iOS paints black behind any it finds.
    await pg.screenshot({ path: file, clip: { x: 0, y: 0, width: n, height: n }, omitBackground: !o.bleed });
    console.log(path.relative(root, file) + ' · ' + n + ' px · ' + fs.statSync(file).size + ' B');
  }
} finally { await b.close(); }
