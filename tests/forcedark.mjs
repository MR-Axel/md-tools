// El oscurecido forzado del navegador (el "Darken websites" de Chrome, el modo oscuro de Samsung Internet): con el
// teléfono en oscuro, el navegador reescribe los colores de una página clara. Acá se prende de verdad en Chromium
// (Emulation.setAutoDarkModeOverride) y se miran píxeles de capturas, no estilos: el fondo, el acento, un interruptor
// prendido y un nodo de diagrama tienen que salir con los colores del tema, en claro y en oscuro.
// Donde el navegador no respeta la declaración (Samsung Internet), la app pasa a su tema oscuro y avisa una vez.
// Con SHOTS=carpeta guarda las capturas.
import { rig, tally, sleep } from './rig.mjs';
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const box = { LMD: {}, window: { matchMedia: () => ({ matches: false }) }, localStorage: { setItem() {} }, document: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'theme.js'), 'utf8'), box);
const TH = box.LMD.theme;
const { check, done } = tally();
const SHOTS = process.env.SHOTS || '';
const NOTE = '# Launch plan\n\nWhat is left before we ship. A [link](https://example.com).\n\n```mermaid\ngraph LR\n  A[Start] --> B[End]\n  B -- text --> z\n  B --> d\n```\n\n> [!WARNING]\n> Careful with this.\n\n> A plain quote.\n\nThe end.\n';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' };
const hex = (rgb) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(rgb); return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : rgb; };
// Un píxel puede venir con un punto de diferencia por canal (el suavizado, el perfil de color).
const near = (a, b, tol) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return x.every((v, i) => Math.abs(v - y[i]) <= (tol || 3)); };

const r = await rig();
try {
  const who = await r.signup('ana@ejemplo.test', true);
  await r.api('PUT', '/notes/' + encodeURIComponent('work/launch.md'), { text: NOTE }, who.s);

  // Un teléfono con el dispositivo en oscuro, los ajustes dados y, con force, el oscurecido del navegador prendido.
  const phone = async (settings, opt) => {
    const o = opt || {};
    const { ctx, page } = await r.open(null, Object.assign({ colorScheme: o.scheme || 'dark' }, PHONE, o.ua ? { userAgent: o.ua } : {}));
    await ctx.addInitScript(([url, w, s]) => {
      try {
        if (localStorage.getItem('test:set')) return;
        localStorage.setItem('test:set', '1');
        localStorage.setItem('mdtools:settings', JSON.stringify(Object.assign({ cloudUrl: url }, s)));
        localStorage.setItem('mdtools:cloud', JSON.stringify({ session: w.s, email: w.email, at: url }));
      } catch (e) { /* una página en blanco no tiene almacenamiento */ }
    }, [r.base, who, settings]);
    if (o.force !== false) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: true }); }
    if (process.env.DEBUG_ERR) page.on('pageerror', (e) => console.log(e.stack));
    return { ctx, page };
  };
  // Los colores de una captura, en coordenadas de la página: se decodifica en una pestaña aparte, sin oscurecido.
  const reader = await r.open(null, {});
  const pixels = (buf, pts) => reader.page.evaluate(async ([b64, at]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return at.map(([x, y]) => { const d = g.getImageData(Math.round(x * 2), Math.round(y * 2), 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); });
  }, [buf.toString('base64'), pts]);
  const shot = async (page, name) => page.screenshot(SHOTS ? { path: path.join(SHOTS, name + '.png') } : {});
  const declared = (page) => page.evaluate(() => ({ meta: document.querySelector('meta[name=color-scheme]').content, lock: !!document.querySelector('meta[name=darkreader-lock]'), css: getComputedStyle(document.documentElement).colorScheme,
    bars: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content + (m.media ? ' ' + m.media : '')), dark: document.documentElement.classList.contains('lmd-dark'), forcing: LMD.theme.forcing(), probe: LMD.theme.forcedDark(),
    toast: !!document.querySelector('.lmd-forced-toast'), flip: (document.querySelector('[data-act=theme-flip]') || {}).title || '' }));
  // Dónde mirar: el fondo, el botón de vista prendido (el acento), y el relleno y el texto de un nodo del diagrama.
  const spots = (page) => page.evaluate(() => {
    const on = [...document.querySelectorAll('.lmd-topbar .lmd-on')].find((n) => n.offsetParent); const b = on.getBoundingClientRect();
    const node = document.querySelector('.lmd-diagram .node rect, .lmd-diagram .node polygon'); const n = node.getBoundingClientRect();
    const label = document.querySelector('.lmd-diagram .node .nodeLabel, .lmd-diagram .node text');
    // Un aviso y una cita: la barra de la izquierda de cada uno, y el título del aviso.
    const al = document.querySelector('.lmd-article .lmd-alert'); const a = al.getBoundingClientRect(); const q = document.querySelector('.lmd-article blockquote:not(.lmd-alert)').getBoundingClientRect();
    return { accent: [b.left + 7, b.top + b.height / 2], node: [n.left + 6, n.top + n.height / 2], label: getComputedStyle(label).color,
      alert: [a.left + 2, a.top + a.height / 2], alertBg: [a.right - 6, a.top + 6], quote: [q.left + 1.5, q.top + q.height / 2], title: al.querySelector('.lmd-alert-title').textContent, titleColor: getComputedStyle(al.querySelector('.lmd-alert-title')).color };
  });
  const openSettings = async (page, tab) => {
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    await page.evaluate(() => document.querySelector('.lmd-menu [data-more=settings]').click());
    await page.waitForSelector('.lmd-panel:not([hidden])');
    await page.evaluate((t) => document.querySelector('.lmd-ptabs [data-ptab=' + t + ']').click(), tab); await sleep(300);
  };
  const switchSpot = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('.lmd-switch input:checked + i')].find((n) => n.offsetParent).getBoundingClientRect(); return [b.left + 6, b.top + b.height / 2]; });

  // ---------- Por declaración: el navegador respeta "only light" ----------
  console.log('Chromium con el oscurecido forzado: lo resuelve la declaración');
  const CASES = [['lima', { theme: 'light' }], ['salvia', { theme: 'light', preset: 'salvia', presetLight: 'salvia' }], ['noche', { theme: 'dark' }], ['marea', { theme: 'dark', preset: 'marea', presetDark: 'marea' }]];
  for (const [id, settings] of CASES) {
    const p = TH.byId(id); const c = p.c; const base = id === 'lima' || id === 'noche';
    // Con los dos temas de siempre los diagramas llevan los colores de Mermaid; con un tema incluido, los del tema.
    const nodeFill = base ? (p.dark ? '#1f2020' : '#ececff') : c.soft;
    const { ctx, page } = await phone(settings);
    await page.goto(r.noteUrl('work/launch.md')); await page.waitForSelector('.lmd-diagram svg'); await sleep(500);
    const d = await declared(page);
    const want = p.dark ? 'dark' : 'only light';
    check(id + ': el esquema declarado es el del tema (' + want + '), en el <meta> y en la página', d.meta === want && (p.dark ? d.css === 'dark' : /only/.test(d.css) && /light/.test(d.css)) && d.lock, d);
    check(id + ': las barras del sistema toman el fondo del tema, sin depender del dispositivo', d.bars.length === 2 && d.bars.every((b) => b === c.bg), d.bars);
    check(id + ': la app no cambia de tema por su cuenta ni avisa', d.dark === p.dark && !d.forcing && !d.toast && d.probe.darkens && !d.probe.deep, d);
    const at = await spots(page); const px = await pixels(await shot(page, 'forzado-' + id + '-nota'), [[5, 300], at.accent, at.node, at.alert, at.alertBg, at.quote]);
    const warn = p.dark ? '#f0a23a' : '#8f4d00';
    check(id + ': un aviso sale con la barra de su color, el título legible y su panel; la cita, con la barra gris', near(px[3], warn) && near(px[4], c.soft) && near(px[5], c.line) && at.title === 'Warning' && hex(at.titleColor) === warn && TH.contrast(warn, px[4]) >= 4.5, [px.slice(3), warn, c.soft, c.line, at.title, at.titleColor]);
    check(id + ': el fondo pintado es el del tema', near(px[0], c.bg), [px[0], c.bg]);
    check(id + ': el acento pintado es el del tema', near(px[1], c.fill), [px[1], c.fill]);
    check(id + ': el nodo del diagrama sale con su relleno y el texto se lee (4.5:1 o más)', near(px[2], nodeFill) && TH.contrast(hex(at.label), px[2]) >= 4.5, [px[2], nodeFill, hex(at.label)]);
    await openSettings(page, 'plug');
    const sw = await pixels(await shot(page, 'forzado-' + id + '-ajustes'), [await switchSpot(page), [200, 400]]);
    check(id + ': el interruptor prendido lleva el acento y Ajustes el fondo del tema', near(sw[0], c.fill) && near(sw[1], c.bg), [sw, c.fill, c.bg]);
    if (id === 'lima') {
      // La prueba mide de verdad: sin la declaración, el mismo navegador reescribe el fondo.
      await page.evaluate(() => { document.documentElement.style.colorScheme = 'light'; document.querySelector('meta[name=color-scheme]').content = 'light dark'; }); await sleep(300);
      const off = await pixels(await shot(page, 'forzado-lima-sin-declarar'), [[200, 400]]);
      check('sin declarar "only light" el navegador sí oscurece el tema claro: la prueba lo ve', !near(off[0], c.bg, 40), off);
      await page.reload(); await page.waitForSelector('.lmd-diagram svg');
      // Cambiar de tema lleva la declaración y las barras al tema nuevo, sin recargar.
      await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more'); await page.evaluate(() => document.querySelector('.lmd-menu [data-more=theme-flip]').click()); await sleep(600);
      const f = await declared(page); const fx = await pixels(await shot(page, 'forzado-lima-pasa-a-oscuro'), [[5, 300]]);
      check('al pasar a oscuro, el esquema, las barras y el fondo pintado pasan al tema oscuro', f.meta === 'dark' && f.css === 'dark' && f.bars.every((b) => b === TH.byId('noche').c.bg) && near(fx[0], TH.byId('noche').c.bg), [f, fx]);
    }
    await ctx.close();
  }

  // La primera carga, sin nada guardado y en automático: el dispositivo manda y la declaración lo acompaña desde boot.js.
  {
    const { ctx, page } = await phone({}, { scheme: 'light', force: false });
    await page.goto(r.home); await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(300);
    const d = await declared(page); const px = await pixels(await shot(page, 'forzado-inicio-claro'), [[5, 300]]);
    check('dispositivo en claro y tema automático: claro declarado y pintado tal cual', d.meta === 'only light' && !d.dark && near(px[0], TH.byId('lima').c.bg), [d, px]);
    await ctx.close();
  }

  // ---------- Por detección: el navegador no respeta la declaración ----------
  console.log('Samsung Internet (no respeta la declaración): la app pasa a su tema oscuro');
  {
    const noche = TH.byId('noche').c;
    const { ctx, page } = await phone({ theme: 'light' }, { ua: SAMSUNG });
    await page.goto(r.noteUrl('work/launch.md')); await page.waitForSelector('.lmd-diagram svg'); await sleep(500);
    const d = await declared(page);
    check('con un tema claro elegido, se ve el tema oscuro de la app y queda declarado', d.dark && d.forcing && d.meta === 'dark' && d.bars.every((b) => b === noche.bg), d);
    const toast = await page.evaluate(() => { const t = document.querySelector('.lmd-forced-toast'); return t ? { text: t.querySelector('span').textContent, buttons: [...t.querySelectorAll('button')].map((b) => b.textContent), fits: t.getBoundingClientRect().right <= innerWidth && t.getBoundingClientRect().left >= 0, tall: Math.min(...[...t.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)) } : null; });
    check('y avisa, con la salida "Keep light"', toast && toast.text === 'Your browser darkens light pages. SharpMD switched to its dark theme so colors stay right.' && toast.buttons.join() === 'Keep light,Got it' && toast.fits && toast.tall >= 40, toast);
    const at = await spots(page); const px = await pixels(await shot(page, 'samsung-claro-pasa-a-oscuro'), [[5, 300], at.accent, at.node]);
    check('los colores pintados son los del tema oscuro: fondo, acento y diagrama legible', near(px[0], noche.bg) && near(px[1], noche.fill) && TH.contrast(hex(at.label), px[2]) >= 4.5, [px, hex(at.label)]);
    await page.reload(); await page.waitForSelector('.lmd-diagram svg'); await sleep(300);
    const again = await declared(page);
    check('el aviso sale una sola vez, y la recarga arranca ya en oscuro', again.dark && !again.toast, again);
    const boot = await page.evaluate(() => [localStorage.getItem('lmd:dark'), localStorage.getItem('lmd:mode'), JSON.parse(localStorage.getItem('mdtools:settings')).theme]);
    check('lo elegido en Ajustes no se toca: sigue en claro', boot[0] === '1' && boot[1] === 'dark' && boot[2] === 'light', boot);
    // Pedir claro a mano (el botón de claro u oscuro) es insistir.
    await page.tap('[data-act=more]'); await page.waitForSelector('.lmd-menu-more');
    const label = await page.evaluate(() => document.querySelector('.lmd-menu [data-more=theme-flip]').textContent);
    await page.evaluate(() => document.querySelector('.lmd-menu [data-more=theme-flip]').click()); await sleep(600);
    const kept = await declared(page);
    check('"Switch to light" a mano deja el tema claro, y ya no se fuerza', label === 'Switch to light' && !kept.dark && !kept.forcing && kept.meta === 'only light', [label, kept]);
    await ctx.close();
  }
  {
    const { ctx, page } = await phone({ theme: 'auto', presetDark: 'marea' }, { ua: SAMSUNG, scheme: 'light' }); // Samsung Internet dice "claro" aunque el teléfono esté en oscuro
    await page.goto(r.home); await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(300);
    const d = await declared(page); const px = await pixels(await shot(page, 'samsung-automatico-inicio'), [[5, 300]]);
    check('en automático y con el navegador diciendo "claro", igual pasa al oscuro: el último tema oscuro usado', d.dark && d.forcing && d.toast && near(px[0], TH.byId('marea').c.bg), [d, px]);
    await page.evaluate(() => [...document.querySelectorAll('.lmd-forced-toast button')].find((b) => b.textContent === 'Keep light').click());
    await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(400);
    const k = await declared(page);
    check('"Keep light" vuelve al tema claro y no pregunta más', !k.dark && !k.forcing && !k.toast && k.meta === 'only light', k);
    await page.reload(); await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(300);
    const k2 = await declared(page);
    check('y la elección queda para las próximas cargas', !k2.dark && !k2.toast, k2);
    await ctx.close();
  }
  {
    const { ctx, page } = await phone({ theme: 'light' }, { ua: SAMSUNG, force: false });
    await page.goto(r.home); await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(300);
    const d = await declared(page);
    check('Samsung Internet sin oscurecido (teléfono en claro): el tema claro queda como está', !d.dark && !d.forcing && !d.toast && !d.probe.darkens, d);
    await ctx.close();
  }
  {
    const { ctx, page } = await phone({ theme: 'dark' }, { force: false });
    await page.goto(r.home); await page.waitForSelector('.lmd-home [data-home=new]'); await sleep(300);
    const d = await declared(page);
    check('sin oscurecido forzado la sonda no da falsos positivos', !d.probe.darkens && !d.probe.deep && !d.forcing && d.dark && d.meta === 'dark', d);
    await ctx.close();
  }

  // ---------- El editor de diagramas en los doce temas ----------
  console.log('El editor de diagramas con el oscurecido forzado, en los doce temas');
  {
    const { ctx, page } = await phone({ theme: 'light' });
    await page.goto(r.noteUrl('work/launch.md', true)); await page.waitForSelector('.lmd-diagram svg'); await sleep(400);
    const bad = []; const seen = [];
    for (const p of TH.PRESETS) {
      await page.evaluate((id) => LMD.patch(LMD.theme.patchFor(id)), p.id); await sleep(500);
      await page.waitForSelector('.lmd-diagram svg');
      await page.evaluate(() => document.querySelector('.lmd-diagram').click()); await page.waitForSelector('.lmd-dgm-svg svg'); await sleep(900);
      const at = await page.evaluate(() => {
        const node = document.querySelector('.lmd-dgm-svg .node rect'); const n = node.getBoundingClientRect(); const label = document.querySelector('.lmd-dgm-svg .node .nodeLabel, .lmd-dgm-svg .node text');
        const card = document.querySelector('.lmd-dgm-svg').getBoundingClientRect(); const chip = document.querySelector('.lmd-dgm-add [data-piece]'); const ta = document.querySelector('.lmd-dgm textarea');
        return { node: [n.left + 5, n.top + n.height / 2], label: getComputedStyle(label).color, paper: [card.left + 4, card.top + 4], chip: getComputedStyle(chip).color, code: getComputedStyle(ta).color, codeAt: [ta.getBoundingClientRect().right - 6, ta.getBoundingClientRect().bottom - 6] };
      });
      const px = await pixels(await shot(page, 'forzado-editor-' + p.id), [at.node, at.paper, at.codeAt]);
      const text = TH.contrast(hex(at.label), px[0]); const edge = TH.contrast(px[0], px[1]); const code = TH.contrast(hex(at.code), px[2]); const chip = TH.contrast(hex(at.chip), px[1]);
      seen.push(p.id + ' ' + text.toFixed(1));
      if (!(text >= 4.5 && code >= 4.5 && chip >= 4.5) || !near(px[1], p.c.bg, 30) && !near(px[1], p.c.soft, 30) && !near(px[1], p.c.code, 30)) bad.push(p.id + ' texto/nodo ' + text.toFixed(2) + ' código ' + code.toFixed(2) + ' pieza ' + chip.toFixed(2) + ' fondo ' + px[1] + ' nodo ' + px[0] + ' borde ' + edge.toFixed(2));
      await page.keyboard.press('Escape'); await sleep(200);
      if (await page.locator('.lmd-dgm').count()) { await page.keyboard.press('Escape'); await sleep(200); }
    }
    check('en los doce el texto del nodo, el código y las piezas se leen (4.5:1) sobre lo que de verdad se pinta', bad.length === 0 && seen.length === 12, bad.length ? bad : seen);
    await ctx.close();
  }

  // ---------- La portada ----------
  console.log('La portada con el oscurecido forzado');
  {
    const { ctx, page } = await phone({});
    await page.goto(r.origin + '/index.html?site'); await page.waitForSelector('h1'); await sleep(500);
    const px = await pixels(await shot(page, 'forzado-portada'), [[4, 4]]);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('la portada trae su propio tema oscuro y el navegador no lo reescribe', near(px[0], hex(bg), 6) && near(hex(bg), '#121418', 6), [px, bg]);
    await ctx.close();
  }

  check('ninguna página dio error', r.errors.length === 0, r.errors.slice(0, 3));
  check('nada salió a la nube de verdad', r.outside.length === 0, r.outside.slice(0, 3));
} finally { await r.close(); }
process.exit(done() ? 1 : 0);
