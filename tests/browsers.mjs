// La portada y la app web en Firefox y en WebKit (el motor de Safari). No forma parte de `npm test`.
//   BROWSER=firefox node browsers.mjs      BROWSER=webkit node browsers.mjs      (sin BROWSER: firefox)
//   ONLY='Nube|arrastrar' BROWSER=webkit node browsers.mjs     solo los tramos cuyo nombre coincide
//   Antes, una vez: npx playwright-core install firefox webkit
// Recorre lo que una persona hace: la portada en los dos idiomas, en escritorio y en teléfono, con sus clips; y en la
// app, la carga, el inicio, una nota nueva editada en el lugar, diagramas y fórmulas, un archivo suelto (estos
// navegadores no dan acceso a carpetas: se abre una copia y al guardar se descarga), la búsqueda, Ajustes, los menús,
// arrastrar un archivo a la nota y a la papelera, entrar a la nube contra un servidor local, una sesión en vivo como
// invitado, el panel lateral en teléfono y la comparación de planes. En WebKit, además, la app como la ve un iPhone
// (instalar, áreas seguras, teclado en pantalla, copiar, exportar), un iPad y una Mac (atajos con ⌘).
// Las capturas quedan fuera del repo: en ~/.sharpmd/revision-navegadores (o en SHOTS).
import { rig, tally, sleep } from './rig.mjs';
import fs from 'fs'; import os from 'os'; import path from 'path';

const ENGINE = process.env.BROWSER || 'firefox';
const SHOTS = process.env.SHOTS || path.join(os.homedir(), '.sharpmd', 'revision-navegadores');
fs.mkdirSync(SHOTS, { recursive: true });
const R = await rig({ SHARE_FREE: '1', LIVE_PEOPLE: '4' }, ENGINE);
const { check, done } = tally();
const enc = encodeURIComponent;
const shot = (page, name, opt) => page.screenshot(Object.assign({ path: path.join(SHOTS, ENGINE + '-' + name + '.png') }, opt || {})).catch(() => {});
// Cada tramo corre aparte: si uno se cae, se anota y siguen los demás.
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null; // ONLY='Nube|arrastrar' corre solo esos tramos
const step = async (name, fn) => { if (ONLY && !ONLY.test(name)) return; console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.message).split('\n').slice(0, 3).join(' | ')); } };
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const noteText = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(150); } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(ENGINE === 'firefox' ? {} : { isMobile: true }) };
const RICH = '# Trip plan\n\nFirst paragraph about the budget :rocket:\n\n- [ ] Book the flights\n- [x] Renew the passport\n\n| City | Nights |\n| --- | --- |\n| Lima | 3 |\n| Cusco | 4 |\n\n```js\nconst nights = 3 + 4;\n```\n\n```mermaid\ngraph LR\n  A[Lima] --> B[Cusco]\n```\n\n$$\nE = mc^2\n$$\n\nInline $a^2 + b^2$ here.\n\nLast paragraph.\n';

try {
  console.log('Motor: ' + ENGINE + ' ' + R.browser.version());

  // ---------- La portada ----------
  for (const [lang, rel] of [['en', '/index.html'], ['es', '/es/index.html']]) {
    for (const [size, opt] of [['escritorio', { viewport: { width: 1280, height: 800 } }], ['telefono', PHONE]]) {
      await step('Portada ' + lang + ', ' + size, async () => {
        const { ctx, page } = await R.open(null, Object.assign({ colorScheme: 'light', locale: lang === 'es' ? 'es-AR' : 'en-US' }, opt));
        const bad = []; page.on('requestfailed', (r) => { if (r.url().startsWith(R.origin)) bad.push(r.url().slice(R.origin.length) + ' ' + (r.failure() || {}).errorText); });
        const before = R.errors.length;
        await page.goto(R.origin + rel); await page.waitForSelector('h1');
        const top = await page.evaluate(() => ({ h1: document.querySelector('h1').innerText.trim(), lang: document.documentElement.lang, font: document.fonts.check('16px "Figtree"'), clips: document.querySelectorAll('video.clip').length,
          poster: [...document.querySelectorAll('video.clip')].map((v) => !!(v.getAttribute('poster') || v.getAttribute('data-poster'))), sources: [...document.querySelectorAll('video.clip')].map((v) => [...v.querySelectorAll('source')].map((s) => s.type).join()) }));
        check('portada ' + lang + ' ' + size + ': título, idioma y tipografía', top.h1.length > 10 && top.lang === lang && top.font, top);
        check('portada ' + lang + ' ' + size + ': no se pasa de ancho', (await fits(page)) <= 1, await fits(page));
        check('portada ' + lang + ' ' + size + ': cada clip trae su imagen y los dos formatos, primero el MP4 (el que Safari reproduce, y el más liviano)', top.clips >= 4 && top.poster.every(Boolean) && top.sources.every((s) => s === 'video/mp4,video/webm'), top.sources);
        await shot(page, 'portada-' + lang + '-' + size, { fullPage: true });
        // El primer clip: la imagen se ve aunque el video no arranque, y si el motor puede reproducir alguno de los formatos, avanza.
        const clip = await page.evaluate(async () => {
          const v = document.querySelector('video.clip'); v.scrollIntoView({ block: 'center' });
          const can = { webm: v.canPlayType('video/webm'), mp4: v.canPlayType('video/mp4; codecs="avc1.42E01E"') };
          let played = false; let why = '';
          try { await v.play(); await new Promise((resolve) => { const t = setInterval(() => { if (v.currentTime > 0.05) { clearInterval(t); resolve(); } }, 100); setTimeout(() => { clearInterval(t); resolve(); }, 6000); }); played = v.currentTime > 0.05; } catch (e) { why = e.name; }
          const r = v.getBoundingClientRect();
          return { can, played, why, src: (v.currentSrc || '').split('/').pop(), box: [Math.round(r.width), Math.round(r.height)], err: v.error ? v.error.code : 0 };
        });
        const able = !!(clip.can.webm || clip.can.mp4);
        check('portada ' + lang + ' ' + size + ': el clip se reproduce' + (able ? '' : ' (este motor de prueba no trae códecs: queda la imagen, sin romper)'), able ? clip.played : clip.box[0] > 200 && clip.box[1] > 100, clip);
        check('portada ' + lang + ' ' + size + ': sin errores ni pedidos caídos', R.errors.length === before && !bad.filter((b) => !/\.(webm|mp4) /.test(b) || able).length, [R.errors.slice(before), bad]);
        await ctx.close();
      });
    }
  }
  await step('Portada: quien ya usó la app va directo', async () => {
    const { ctx, page } = await R.open(null);
    const asked = []; page.on('request', (r) => asked.push(r.url().slice(R.origin.length)));
    await page.goto(R.origin + '/index.html?site'); await page.evaluate(() => localStorage.setItem('sharpmd:app', '1'));
    await page.goto(R.origin + '/index.html'); await page.waitForSelector('.lmd-home [data-home=new]');
    asked.splice(0, asked.lastIndexOf('/index.html')); // lo que pidió la visita anterior no cuenta
    check('con la app ya usada, la portada manda a la app sin pintarse ni pedir sus clips', /\/src\/app\.html$/.test(page.url()) && !asked.some((u) => /\.(webm|mp4)$/.test(u)), asked.filter((u) => !/^\/(src|vendor|icons)\//.test(u)));
    await ctx.close();
  });
  await step('Clips: formato para Safari', async () => {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'docs', 'clips');
    const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).map((f) => { const b = fs.readFileSync(path.join(dir, f)); return { f, h264: b.includes('avc1'), fast: b.indexOf('moov') > 0 && b.indexOf('moov') < b.indexOf('mdat') }; });
    check('los MP4 son H.264 y llevan el índice adelante (arrancan sin bajarse enteros)', rows.length >= 4 && rows.every((r) => r.h264 && r.fast), rows);
  });

  // ---------- La app ----------
  const { ctx, page } = await R.open(null);
  const failed = []; page.on('requestfailed', (r) => { const why = (r.failure() || {}).errorText || ''; if (r.url().startsWith(R.origin) && !/ABORTED|cancel/i.test(why)) failed.push(r.url().slice(R.origin.length) + ' ' + why); }); // un pedido cortado por cambiar de página no es una falla
  await step('App: carga e inicio', async () => {
    await page.goto(R.home, { waitUntil: 'commit' });
    const splash = await page.waitForSelector('#lmd-splash', { state: 'attached', timeout: 5000 }).then(() => true, () => false);
    await page.waitForSelector('.lmd-home [data-home=new]');
    await page.waitForSelector('#lmd-splash', { state: 'detached' });
    const info = await page.evaluate(() => ({ secure: window.isSecureContext, fs: document.documentElement.dataset.lmdFs, dir: !!document.querySelector('[data-home=dir]'), file: !!document.querySelector('[data-home=file]'), hint: (document.querySelector('.lmd-home-hint') || {}).textContent || '',
      font: document.fonts.check('16px "MDT Inter"'), logo: (document.querySelector('.lmd-home-logo') || {}).naturalWidth || 0, css: { colorMix: CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'), textWrap: CSS.supports('text-wrap', 'balance'), has: CSS.supports('selector(:has(a))'), dvh: CSS.supports('height', '100dvh') } }));
    console.log('  CSS moderno en este motor: ' + JSON.stringify(info.css));
    check('la pantalla de carga se ve y se va; queda el inicio, con su letra y su logo', splash && info.font && info.logo > 0, info);
    check('sin acceso a carpetas no se ofrece "Abrir carpeta", sí "Abrir archivo", y se avisa que al guardar se descarga una copia', info.fs === 'true' ? info.dir : (!info.dir && info.file && /download|cop/i.test(info.hint)), info);
    check('el inicio no se pasa de ancho', (await fits(page)) <= 1);
    await shot(page, 'app-inicio');
  });

  let noteName = '';
  await step('App: nota nueva, editada en el lugar', async () => {
    await page.click('[data-home=new]'); await page.waitForSelector('.lmd-draft');
    noteName = decodeURIComponent((new URL(page.url()).searchParams.get('f') || '').replace(/^local\//, ''));
    await page.waitForSelector('.lmd-menu [data-ins=h1]'); await page.click('.lmd-menu [data-ins=h1]');
    await page.keyboard.type('Trip plan'); await page.keyboard.press('Enter');
    await page.waitForSelector('.lmd-article h1');
    await page.keyboard.type('First paragraph.'); await page.keyboard.press('Enter');
    const afterText = await until(async () => /^# Trip plan\n\nFirst paragraph\./.test(await noteText(page, noteName)) && (await noteText(page, noteName)));
    check('título y párrafo escritos sin sintaxis quedan como Markdown', !!afterText, await noteText(page, noteName));
    // Lista de tareas y tabla, desde el menú de insertar.
    await page.locator('.lmd-article p.lmd-editable', { hasText: 'First paragraph' }).click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-ins]');
    const kinds = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-ins]')].map((b) => b.dataset.ins));
    const task = kinds.find((k) => /task|todo|check/.test(k));
    await page.click('.lmd-menu [data-ins=' + task + ']'); await page.keyboard.type('Book the flights'); await page.keyboard.press('Enter'); await page.keyboard.type('Renew the passport');
    await page.click('.lmd-foot .lmd-status', { force: true });
    const withTasks = await until(async () => /- \[ \] Book the flights\n- \[ \] Renew the passport/.test(await noteText(page, noteName)));
    check('lista de tareas desde el menú de insertar', withTasks, [kinds, await noteText(page, noteName)]);
    await page.locator('.lmd-article input[type=checkbox]').first().click();
    check('marcar una tarea la tilda en el texto', await until(async () => /- \[x\] Book the flights/.test(await noteText(page, noteName))), await noteText(page, noteName));
    await page.locator('.lmd-article h1').click({ button: 'right' }); await page.click('.lmd-menu [data-ins=table]'); await page.waitForSelector('.lmd-article table th');
    await page.keyboard.type('City'); await page.keyboard.press('Tab'); await page.keyboard.type('Nights'); await page.keyboard.press('Tab'); await page.keyboard.type('Lima'); await page.keyboard.press('Tab'); await page.keyboard.type('3');
    await page.click('.lmd-foot .lmd-status', { force: true });
    check('tabla: se escribe celda por celda con Tab', await until(async () => /\| City \| Nights \|\n\| -+ \| -+ \|\n\| Lima \| 3 \|/.test(await noteText(page, noteName))), await noteText(page, noteName));
    check('sin errores al editar', R.errors.length === 0, R.errors);
    await shot(page, 'app-nota-nueva');
  });

  await step('App: diagramas, fórmulas, código y emojis', async () => {
    await page.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await page.goto(R.home + '?f=' + enc('local/rich.md')); await page.waitForSelector('.markdown-body h1');
    const text0 = await page.evaluate(() => document.querySelector('.lmd-article').innerText.length);
    const dia = await page.waitForSelector('.lmd-diagram svg', { timeout: 30000 }).then(() => true, () => false);
    const math = await page.waitForSelector('.lmd-math-block .katex', { timeout: 15000 }).then(() => true, () => false);
    const code = await page.waitForSelector('.lmd-code code [class^=hljs-]', { timeout: 15000 }).then(() => true, () => false);
    const emoji = await until(() => page.evaluate(() => document.querySelector('.lmd-article').innerText.includes('🚀')));
    const sizes = await page.evaluate(() => { const s = document.querySelector('.lmd-diagram svg').getBoundingClientRect(); const k = document.querySelector('.lmd-math-block .katex').getBoundingClientRect(); const i = document.querySelector('p .lmd-math .katex'); return { svg: [Math.round(s.width), Math.round(s.height)], katex: [Math.round(k.width), Math.round(k.height)], inline: !!i, kfont: document.fonts.check('16px KaTeX_Main') }; });
    check('el texto se ve antes y después llegan el diagrama, la fórmula, el color del código y el emoji', text0 > 50 && dia && math && code && emoji, { text0, dia, math, code, emoji });
    check('el diagrama y la fórmula tienen tamaño real, con la tipografía de las fórmulas', sizes.svg[0] > 80 && sizes.svg[1] > 30 && sizes.katex[0] > 30 && sizes.inline && sizes.kfont, sizes);
    check('la nota no se pasa de ancho', (await fits(page)) <= 1);
    await shot(page, 'app-nota', { fullPage: true });
    // Los editores de diagrama y de fórmula abren con su vista previa.
    await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article .lmd-editable');
    await page.click('.lmd-diagram'); const dg = await page.waitForSelector('.lmd-dgm-svg svg', { timeout: 15000 }).then(() => true, () => false);
    await shot(page, 'app-editor-diagrama');
    await page.keyboard.press('Escape'); await sleep(300);
    const leftover = await page.evaluate(() => { const b = document.querySelector('.lmd-ask [data-ask=yes], .lmd-ask [data-d=discard]'); if (b) b.click(); return !!b; });
    await page.click('.lmd-math-block'); const fx = await page.waitForSelector('.lmd-fx .katex', { timeout: 15000 }).then(() => true, () => false);
    await shot(page, 'app-editor-formula');
    await page.keyboard.press('Escape'); await sleep(300);
    check('el editor de diagramas y el de fórmulas abren con su vista previa', dg && fx, { dg, fx, leftover });
    await page.click('[data-act=mode-read]').catch(() => {});
  });

  await step('App: búsqueda', async () => {
    await page.fill('.lmd-search input', 'budget'); await page.waitForSelector('.lmd-results-sum');
    const sum = (await page.textContent('.lmd-results-sum')).trim();
    check('la búsqueda encuentra en la nota y en los archivos', /^\d+ match(es)? in \d+ files?/.test(sum), sum);
    await page.fill('.lmd-search input', '');
  });

  await step('App: Ajustes, todas las pestañas', async () => {
    await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card');
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lmd-panel-card [data-ptab]')].map((b) => b.dataset.ptab));
    const rows = [];
    for (const t of tabs) {
      await page.click('.lmd-panel-card [data-ptab=' + t + ']'); await sleep(250);
      rows.push(await page.evaluate((tab) => { const card = document.querySelector('.lmd-panel-card').getBoundingClientRect(); const shown = [...document.querySelectorAll('.lmd-panel-card section[data-tab]')].filter((s) => s.offsetParent);
        const out = [...document.querySelectorAll('.lmd-panel-card section[data-tab] *')].filter((n) => n.offsetParent && n.getBoundingClientRect().right > card.right + 1).length;
        return { tab, on: document.querySelector('.lmd-panel-card [data-ptab].lmd-on').dataset.ptab, shown: shown.length, own: shown.every((s) => s.dataset.tab === tab), out, inView: card.left >= 0 && card.right <= window.innerWidth + 1 && card.bottom <= window.innerHeight + 1 }; }, t));
      if (t === 'look' || t === 'plan' || t === 'inst') await shot(page, 'app-ajustes-' + t);
    }
    check('las diez pestañas de Ajustes abren, cada una con lo suyo y sin salirse de la tarjeta', tabs.length === 10 && rows.every((r) => r.on === r.tab && r.shown > 0 && r.own && r.out === 0 && r.inView), rows.filter((r) => !(r.on === r.tab && r.shown > 0 && r.own && r.out === 0 && r.inView)));
    // Un cambio de apariencia se aplica en el momento.
    await page.click('.lmd-panel-card [data-ptab=look]');
    const themed = await page.evaluate(async () => { const b = document.querySelector('.lmd-seg[data-seg=theme] button[data-val=light]'); if (!b) return 'sin botón'; b.click(); await new Promise((r) => setTimeout(r, 400)); const bg = getComputedStyle(document.body).backgroundColor; document.querySelector('.lmd-seg[data-seg=theme] button[data-val=dark]').click(); await new Promise((r) => setTimeout(r, 300)); return bg; });
    check('cambiar el tema desde Ajustes pinta al instante', /rgb\((2[0-9]{2}), (2[0-9]{2}), (2[0-9]{2})\)/.test(themed), themed);
    await page.keyboard.press('Escape'); await page.waitForSelector('.lmd-panel-card', { state: 'hidden' });
  });

  await step('App: comparación de planes', async () => {
    await page.goto(R.home + '#lmd-plans'); await page.waitForSelector('.lmd-panel-card .lmd-plans .lmd-plan', { timeout: 15000 });
    const plans = await page.evaluate(() => { const cols = [...document.querySelectorAll('.lmd-panel-card .lmd-plans > *')].map((c) => c.getBoundingClientRect()); const card = document.querySelector('.lmd-panel-card').getBoundingClientRect();
      return { n: cols.length, side: cols.length > 1 && Math.abs(cols[0].top - cols[1].top) < 4 && cols[1].left > cols[0].right - 2, inside: cols.every((c) => c.left >= card.left - 1 && c.right <= card.right + 1), hash: location.hash }; });
    check('los planes se ven lado a lado, dentro de la tarjeta, y el # se limpia', plans.n >= 2 && plans.side && plans.inside && plans.hash === '', plans);
    await shot(page, 'app-planes');
    await page.keyboard.press('Escape');
  });

  await step('App: menús contextuales', async () => {
    await page.goto(R.home + '?f=' + enc('local/rich.md')); await page.waitForSelector('.markdown-body h1'); await page.waitForSelector('.lmd-node');
    await page.locator('.lmd-node', { hasText: 'rich.md' }).first().click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-f]');
    const tree = await page.evaluate(() => { const m = document.querySelector('.lmd-menu'); const r = m.getBoundingClientRect(); return { acts: [...m.querySelectorAll('[data-f]')].map((b) => b.dataset.f), icons: m.querySelectorAll('[data-f] svg').length, inView: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, w: Math.round(r.width) }; });
    check('clic derecho en un archivo del explorador: menú compacto, con íconos, dentro de la ventana', tree.acts.includes('ren') && tree.acts.includes('del') && tree.icons === tree.acts.length && tree.inView && tree.w < 340, tree);
    await shot(page, 'app-menu-archivo');
    await page.keyboard.press('Escape'); await sleep(150);
    await page.evaluate(() => { const m = document.querySelector('.lmd-menu'); if (m) document.body.click(); });
    await page.locator('.lmd-article p', { hasText: 'Last paragraph' }).click({ button: 'right' });
    const read = await page.waitForSelector('.lmd-menu', { timeout: 4000 }).then(() => true, () => false);
    check('clic derecho leyendo abre el menú de lectura', read);
    await shot(page, 'app-menu-lectura');
    await page.keyboard.press('Escape'); await page.mouse.click(700, 20);
  });

  await step('App: un archivo suelto se abre y al guardar se descarga', async () => {
    await page.goto(R.home); await page.waitForSelector('.lmd-home [data-home=file]');
    const native = await page.evaluate(() => !!window.showOpenFilePicker);
    if (native) { check('este motor tiene acceso a archivos: el tramo no aplica', true); return; }
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-home=file]')]);
    await chooser.setFiles({ name: 'suelto.md', mimeType: 'text/markdown', buffer: Buffer.from('# Loose file\n\nOpened from disk.\n') });
    await page.waitForSelector('.markdown-body h1');
    check('el archivo elegido se abre', (await page.textContent('.markdown-body h1')).trim().startsWith('Loose file'));
    await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article p.lmd-editable');
    await page.locator('.lmd-article p.lmd-editable').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' Edited here.'); await page.click('.lmd-foot .lmd-status', { force: true });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('[data-act=save]')]);
    const file = await download.path(); const saved = file ? fs.readFileSync(file, 'utf8') : '';
    const said = await until(() => page.evaluate(() => { const s = document.querySelector('.lmd-status'); return /cop|download/i.test(s.textContent) ? s.textContent : ''; }), 3000);
    check('al guardar se descarga la copia, con su nombre y lo editado', download.suggestedFilename() === 'suelto.md' && /Edited here\./.test(saved), [download.suggestedFilename(), saved]);
    check('y la app dice que descargó una copia porque el navegador no deja escribir el archivo', !!said, said);
    await shot(page, 'app-archivo-suelto');
  });

  // ---------- La nube ----------
  const A = await R.signup('ana@ejemplo.test', true);
  await R.api('PUT', '/notes/' + enc('team/plan.md'), { text: '# Launch plan\n\nFirst paragraph of the plan.\n\nSecond paragraph.\n' }, A.s);
  await R.api('PUT', '/notes/' + enc('team/other.md'), { text: '# Other\n\nA second note.\n' }, A.s);
  await R.api('PUT', '/notes/' + enc('team/tirar.md'), { text: '# Tirar\n\nSe va a la papelera.\n' }, A.s);
  const serverText = async (p) => ((await R.api('GET', '/notes/' + enc(p), undefined, A.s)).json || {}).text || '';
  await step('Nube: entrar con el correo y el código', async () => {
    await page.goto(R.home); await page.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
    await page.click('[data-cloud=ask]'); await page.fill('[data-field=email]', 'ana@ejemplo.test');
    const [started] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/auth/start')), page.click('[data-cloud=start]')]);
    await page.waitForSelector('[data-field=code]'); await page.fill('[data-field=code]', (await started.json()).dev_code); await page.click('[data-cloud=verify]');
    await page.waitForSelector('[data-cloud=menu]');
    await page.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node');
    await page.locator('.lmd-xroot[data-root=cloud] .lmd-node-dir', { hasText: 'team' }).click().catch(() => {});
    await page.locator('.lmd-xroot[data-root=cloud] a.lmd-node', { hasText: 'plan.md' }).click(); await page.waitForSelector('.markdown-body h1');
    check('adentro: la nota de la nube se abre desde el explorador', (await page.textContent('.markdown-body h1')).trim().startsWith('Launch plan'));
    await page.click('[data-act=mode-edit]'); await page.waitForSelector('.lmd-article p.lmd-editable');
    await page.locator('.lmd-article p.lmd-editable', { hasText: 'Second paragraph' }).click(); await page.keyboard.press('End'); await page.keyboard.type(' Saved from ' + ENGINE + '.'); await page.click('.lmd-foot .lmd-status', { force: true });
    const up = await until(async () => new RegExp('Saved from ' + ENGINE).test(((await R.api('GET', '/notes/' + enc('team/plan.md'), undefined, A.s)).json || {}).text || ''), 15000);
    check('lo editado llega al servidor', up);
    await page.click('[data-cloud=menu]'); await page.waitForSelector('.lmd-side-acct .lmd-menu [data-cloud=settings]');
    await shot(page, 'app-menu-cuenta');
    await page.click('[data-cloud=settings]'); await page.waitForSelector('.lmd-panel-card [data-ptab=cloud].lmd-on');
    check('el menú de la cuenta abre Ajustes en la pestaña de la nube', true);
    await page.keyboard.press('Escape');
  });

  await step('App: arrastrar un archivo a la nota y a la papelera', async () => {
    const CLOUD = '.lmd-xroot[data-root=cloud]';
    await page.goto(R.noteUrl('team/plan.md', true)); await page.waitForSelector('.lmd-article p.lmd-editable'); await page.waitForSelector(CLOUD + ' .lmd-node:has-text("other.md")');
    const node = (name) => page.locator(CLOUD + ' a.lmd-node', { hasText: name }).first(); const to = page.locator('.lmd-article p.lmd-editable', { hasText: 'First paragraph' });
    await node('other.md').hover(); await page.mouse.down(); await to.hover(); await to.hover();
    // La marca de dónde va a caer el enlace sigue al cursor: tiene que estar dentro del párrafo sobre el que se arrastra.
    const mark = await page.evaluate(() => { const c = document.querySelector('.lmd-drop-caret'); if (!c) return ''; const r = c.getBoundingClientRect(); const p = [...document.querySelectorAll('.lmd-article p.lmd-editable')].find((x) => /First paragraph/.test(x.textContent)).getBoundingClientRect(); return (c.classList.contains('lmd-drop-line') ? 'renglón' : 'cursor') + (r.height > 4 && r.top >= p.top - 6 && r.bottom <= p.bottom + 6 && r.left >= p.left - 4 && r.left <= p.right + 4 ? ' en el párrafo' : ' fuera ' + JSON.stringify([r.left, r.top, r.height, p.left, p.top, p.bottom])); });
    await page.mouse.up();
    const linked = await until(async () => /\]\(other\.md\)/.test(await serverText('team/plan.md')), 12000);
    check('mientras se arrastra, la marca sigue al cursor dentro del párrafo', mark === 'cursor en el párrafo', mark);
    check('soltar un archivo en la nota deja un enlace donde cae', linked, (await serverText('team/plan.md')).split('\n').filter((l) => /First paragraph/.test(l)));
    await shot(page, 'app-enlace-soltado');
    await page.click('.lmd-foot .lmd-status', { force: true }); await sleep(400);
    const bin = page.locator(CLOUD + ' > .lmd-trash-link span'); // sobre el texto: en el WebKit de prueba, la parte vacía del botón no recibe el arrastre
    // El explorador se vuelve a dibujar cuando llega el guardado de recién: si justo corta el arrastre, se repite.
    let hot = false; let asked = false;
    for (let i = 0; i < 3 && !asked; i++) {
      await node('tirar.md').hover(); await page.mouse.down(); await bin.hover(); await bin.hover();
      hot = await page.evaluate(() => !!document.querySelector('.lmd-trash-link.lmd-drop'));
      await page.mouse.up();
      asked = await page.waitForSelector('.lmd-dlg [data-dlg=ok]', { timeout: 3000 }).then(() => true, () => false);
    }
    await shot(page, 'app-confirmar-papelera'); await page.click('.lmd-dlg [data-dlg=ok]');
    const gone = await until(async () => !((await R.api('GET', '/notes', undefined, A.s)).json || []).some((n) => n.path === 'team/tirar.md'), 10000);
    check('arrastrado a la papelera, se marca el destino y el archivo se va', hot && gone, { hot, gone });
  });

  await step('En vivo: entrar como invitado', async () => {
    await page.goto(R.noteUrl('team/plan.md', true)); await page.waitForSelector('.lmd-article .lmd-editable');
    await page.click('[data-act=sync]'); await page.click('.lmd-menu [data-s=live]');
    await page.waitForSelector('.lmd-live-card [data-lv=name]'); await page.fill('[data-lv=name]', 'Ana'); await page.click('[data-lv=start]');
    await page.waitForSelector('.lmd-live-link input'); const link = await page.inputValue('.lmd-live-link input'); await page.click('.lmd-live-card [data-lv=close]');
    const g = await R.open(null);
    await g.page.goto(R.home + link.slice(link.indexOf('#'))); await g.page.waitForSelector('.lmd-live-card input');
    await g.page.fill('.lmd-live-card input', 'Guest'); await g.page.click('.lmd-live-card [data-lv=join]');
    await g.page.waitForSelector('.lmd-live-bar'); await g.page.waitForSelector('.lmd-article .lmd-editable');
    await g.page.locator('.lmd-article p.lmd-editable', { hasText: 'First paragraph' }).click(); await g.page.keyboard.press('End'); await g.page.keyboard.type(' Hello from the guest.', { delay: 15 });
    const seen = await page.waitForFunction(() => document.querySelector('.lmd-article').innerText.includes('Hello from the guest.'), null, { timeout: 12000 }).then(() => true, () => false);
    check('el invitado entra sin cuenta y lo que escribe aparece en el otro navegador', seen);
    await page.locator('.lmd-article p.lmd-editable', { hasText: 'Second paragraph' }).click(); await page.keyboard.press('End'); await page.keyboard.type(' And back.', { delay: 15 });
    const back = await g.page.waitForFunction(() => document.querySelector('.lmd-article').innerText.includes('And back.'), null, { timeout: 12000 }).then(() => true, () => false);
    check('y lo que escribe el dueño le llega al invitado', back);
    await shot(g.page, 'app-en-vivo-invitado');
    await g.ctx.close();
  });
  check('la app no tuvo errores de página ni pedidos caídos en todo el recorrido', R.errors.length === 0 && failed.length === 0, [R.errors.slice(0, 5), failed.slice(0, 5)]);
  await ctx.close();

  // ---------- Teléfono ----------
  await step('Teléfono: inicio, nota y panel lateral', async () => {
    const m = await R.open(null, PHONE); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    check('teléfono: el inicio entra en el ancho', (await fits(p)) <= 1, await fits(p));
    await shot(p, 'telefono-inicio');
    await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await p.goto(R.home + '?f=' + enc('local/rich.md')); await p.waitForSelector('.markdown-body h1'); await p.waitForSelector('.lmd-diagram svg', { timeout: 30000 });
    check('teléfono: la nota con tabla, código y diagrama entra en el ancho', (await fits(p)) <= 1, await fits(p));
    await shot(p, 'telefono-nota');
    await p.tap('[data-act=sidebar]'); await sleep(450);
    const open = await p.evaluate(() => { const r = document.querySelector('.lmd-sidebar').getBoundingClientRect(); return { left: Math.round(r.left), w: Math.round(r.width), scrim: getComputedStyle(document.querySelector('.lmd-scrim')).display, node: !!document.querySelector('.lmd-sidebar .lmd-node') }; });
    check('teléfono: el panel lateral abre encima, con el explorador', open.left === 0 && open.w > 200 && open.w <= 390 && open.scrim !== 'none' && open.node, open);
    await shot(p, 'telefono-panel');
    await p.touchscreen.tap(380, 420); await sleep(450);
    const shut = await p.evaluate(() => Math.round(document.querySelector('.lmd-sidebar').getBoundingClientRect().right));
    check('teléfono: tocar afuera lo cierra', shut <= 0, shut);
    check('teléfono: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  // ---------- iPhone, iPad y Mac ----------
  // El motor es WebKit, no Safari: no hay muesca, teclado en pantalla ni hoja de compartir. Lo que se puede, se arma:
  // el navegador se presenta como un iPhone, las áreas seguras se ponen fijas en la hoja de estilos (47 px arriba y
  // 34 abajo, las de un iPhone con muesca), el teclado es un visualViewport de prueba que se achica, y la hoja de
  // compartir y el portapapeles anotan qué recibieron y si fue dentro del toque.
  const APPLE = ENGINE === 'webkit';
  const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const INSET = { top: 47, bottom: 34 };
  const appleShot = (page, name, opt) => page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png') }, opt || {})).catch(() => {});
  // Las áreas seguras, fijas: se sirve la misma hoja con env() ya resuelto.
  const withInsets = (ctx) => ctx.route('**/src/content.css', async (r) => {
    const css = fs.readFileSync(new URL('../src/content.css', import.meta.url), 'utf8');
    await r.fulfill({ status: 200, contentType: 'text/css', body: css.replace(/env\(safe-area-inset-top, 0px\)/g, INSET.top + 'px').replace(/env\(safe-area-inset-bottom, 0px\)/g, INSET.bottom + 'px').replace(/env\(safe-area-inset-(left|right), 0px\)/g, '0px') });
  });
  const iphone = async (who, opt) => {
    const a = await R.open(who || null, Object.assign({ viewport: { width: 390, height: 844 }, userAgent: UA_IPHONE, hasTouch: true, isMobile: true, colorScheme: 'light', deviceScaleFactor: 2 }, opt || {}));
    await withInsets(a.ctx);
    await a.page.addInitScript(() => {
      // El teclado: la zona visible se achica desde abajo, como en Safari. window.__kb(alto) lo abre o lo cierra.
      let kb = 0; const vv = new EventTarget();
      Object.defineProperties(vv, { width: { get: () => window.innerWidth }, height: { get: () => window.innerHeight - kb }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
      Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
      window.__kb = (h) => { kb = h; vv.dispatchEvent(new Event('resize')); };
      // La hoja de compartir y el portapapeles: anotan lo que llega y si el toque seguía activo.
      const live = () => (navigator.userActivation ? navigator.userActivation.isActive : null);
      window.__shared = []; window.__copied = [];
      Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files && d.files.length) && window.__noShare !== true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: (d) => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, live: live() }); return Promise.resolve(); }, configurable: true });
      const clip = { write: (items) => { window.__copied.push({ types: items[0].types.slice(), live: live() }); return Promise.resolve(); }, writeText: (t) => { window.__copied.push({ text: String(t), live: live() }); return Promise.resolve(); }, readText: () => Promise.resolve('') };
      Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
      if (navigator.storage) Object.defineProperty(navigator.storage, 'persist', { value: () => { window.__persistAsked = (window.__persistAsked || 0) + 1; return Promise.resolve(false); }, configurable: true });
    });
    return a;
  };
  const inside = (page, sel, top, bottom) => page.evaluate(([s, t, b]) => [...document.querySelectorAll(s)].filter((n) => n.offsetParent && getComputedStyle(n).visibility !== 'hidden').map((n) => { const r = n.getBoundingClientRect(); return { n: (n.dataset.act || n.dataset.ptab || n.className || n.tagName).toString().slice(0, 30), ok: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= t - 1 && r.bottom <= innerHeight - b + 1 }; }).filter((x) => !x.ok).map((x) => x.n), [sel, top || 0, bottom || 0]);

  if (APPLE) await step('iPhone: cabecera, íconos y aviso de guardado', async () => {
    const m = await iphone(); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    const head = await p.evaluate(() => { const q = (s) => document.querySelector(s); const meta = (n) => (q('meta[name="' + n + '"]') || {}).content;
      return { capable: meta('apple-mobile-web-app-capable'), web: meta('mobile-web-app-capable'), title: meta('apple-mobile-web-app-title'), bar: meta('apple-mobile-web-app-status-bar-style'), viewport: meta('viewport'),
        colors: [...document.querySelectorAll('meta[name=theme-color]')].map((x) => x.content + (x.media || '')), icons: [...document.querySelectorAll('link[rel=apple-touch-icon]')].map((l) => (l.getAttribute('sizes') || '') + ' ' + l.getAttribute('href')),
        cls: document.documentElement.className, bg: getComputedStyle(document.body).backgroundColor }; });
    check('iphone: la página se declara instalable, con su nombre y su barra de estado', head.capable === 'yes' && head.web === 'yes' && head.title === 'SharpMD' && head.bar === 'default', head);
    check('iphone: el color de la barra sigue al tema, y la página llega hasta los bordes', head.colors.length === 2 && head.colors.every((c) => c === '#fbfaf7') && /viewport-fit=cover/.test(head.viewport) && /maximum-scale=1/.test(head.viewport), head);
    check('iphone: la página sabe que es un iPhone, y no una Mac', /\blmd-ios\b/.test(head.cls) && !/lmd-mac|lmd-standalone/.test(head.cls), head.cls);
    const sizes = await p.evaluate(async () => { const out = []; for (const n of [180, 167, 152]) { const img = new Image(); img.src = '../icons/apple-touch-icon-' + n + '.png'; try { await img.decode(); } catch (e) { out.push('falta ' + n); continue; }
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) clear++;
      out.push('200:' + img.naturalWidth + 'x' + img.naturalHeight + ':' + (clear ? clear + ' transparentes' : 'opaco')); } return out; });
    check('iphone: los tres íconos de inicio existen, con su tamaño y sin transparencia', head.icons.length === 4 && [180, 167, 152].every((n) => head.icons.some((i) => i.includes(n + 'x' + n + ' ') && i.includes('apple-touch-icon-' + n))) && sizes.join() === '200:180x180:opaco,200:167x167:opaco,200:152x152:opaco', [head.icons, sizes]);
    const told = await until(() => p.evaluate(() => { const t = document.querySelector('.lmd-home').innerText; return /Safari can delete the notes in this browser/.test(t) ? t.split('\n').find((l) => /Safari can delete/.test(l)) : ''; }), 6000);
    check('iphone: pide guardado persistente y avisa una vez, en una línea, que conviene instalar o usar la nube', (await p.evaluate(() => window.__persistAsked)) >= 1 && /Install the app or use the cloud/.test(told || '') && !/[!¡—–]/.test(told || '') && (told || '').length < 130, told);
    await appleShot(p, 'iphone-inicio');
    await p.reload(); await p.waitForSelector('.lmd-home [data-home=new]'); await sleep(2200);
    check('iphone: el aviso no vuelve a salir', !(await p.evaluate(() => /Safari can delete/.test(document.querySelector('.lmd-home').innerText))));
    check('iphone: el inicio entra en el ancho, con todo dentro de la pantalla', (await fits(p)) <= 1 && (await inside(p, '.lmd-home button, .lmd-home a, .lmd-topbar button', 0, 0)).length === 0, [await fits(p), await inside(p, '.lmd-home button, .lmd-home a, .lmd-topbar button', 0, 0)]);
    check('iphone: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  if (APPLE) await step('iPhone: instalar, los pasos', async () => {
    const m = await iphone(); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    await p.tap('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.tap('[data-ptab=inst]'); await p.waitForSelector('[data-inst-ios]');
    const inst = await p.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); const ol = box.querySelector('[data-inst-ios]'); const ico = ol.querySelector('.lmd-inst-ico svg').getBoundingClientRect(); const r = ol.getBoundingClientRect();
      return { heads: [...box.querySelectorAll('h4')].map((h) => h.textContent), steps: [...ol.querySelectorAll('li')].map((li) => li.textContent.trim()), ico: Math.round(ico.width), seen: r.top >= 0 && r.bottom <= innerHeight && r.width > 200, keep: box.querySelector('.lmd-inst-keep').textContent, btn: !!box.querySelector('[data-inst=app]'), text: box.textContent }; });
    check('iphone: Instalar muestra los pasos de iPhone y iPad, con el ícono de compartir dibujado', inst.heads.join('|') === 'On iPhone and iPad' && inst.steps.length === 3 && /^In Safari, tap Share/.test(inst.steps[0]) && /Add to Home Screen/.test(inst.steps[1]) && inst.ico >= 16 && inst.seen && !inst.btn, inst);
    check('iphone: sin extensión, doble clic ni Windows, y con los textos cortos', !/extension|double click|Windows|Dock/i.test(inst.text) && /Safari can delete/.test(inst.keep) && !/[!¡—–]/.test(inst.text) && inst.steps.every((s) => s.length < 70), inst.text);
    check('iphone: Ajustes > Instalar entra en el ancho', (await fits(p)) <= 1, await fits(p));
    await appleShot(p, 'iphone-instalar');
    await p.tap('[data-ptab=look]'); await sleep(400);
    const look = await p.evaluate(() => { const g = document.querySelector('.lmd-th-grid').getBoundingClientRect(); const b = document.querySelector('.lmd-panel-body'); return { in: g.left >= 0 && g.right <= innerWidth, wide: b.scrollWidth - b.clientWidth, n: document.querySelectorAll('.lmd-th').length, low: Math.min(...[...document.querySelectorAll('.lmd-th')].map((x) => x.getBoundingClientRect().height)) }; });
    check('iphone: la grilla de temas entra en el ancho, con miniaturas que se pueden tocar', look.in && look.wide <= 0 && look.n === 12 && look.low >= 44 && (await fits(p)) <= 1, look);
    await p.tap('[data-th=arena]'); await sleep(300);
    const tapped = await p.evaluate(() => ({ bg: document.documentElement.style.getPropertyValue('--bg'), apply: !document.querySelector('[data-th-apply]').hidden, bar: document.querySelector('meta[name=theme-color]').content }));
    check('iphone: tocar un tema lo muestra en vivo, con la barra del sistema en su color, y ofrece aplicarlo', tapped.bg === '#f6efe0' && tapped.apply && tapped.bar === '#f6efe0', tapped);
    await appleShot(p, 'iphone-temas');
    check('iphone: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  if (APPLE) await step('iPhone: áreas seguras', async () => {
    const m = await iphone(); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await p.goto(R.home + '?f=' + enc('local/rich.md')); await p.waitForSelector('.markdown-body h1'); await p.waitForSelector('.lmd-diagram svg', { timeout: 30000 });
    const bars = await p.evaluate(() => { const top = document.querySelector('.lmd-topbar'); const foot = document.querySelector('.lmd-foot'); const r = (n) => n.getBoundingClientRect(); const first = [...top.querySelectorAll('button')].filter((b) => b.offsetParent)[0];
      return { topH: Math.round(r(top).height), btnTop: Math.round(r(first).top), footH: Math.round(r(foot).height), footPad: getComputedStyle(foot).paddingBottom, text: Math.round(r(foot.querySelector('.lmd-status, .lmd-count')).bottom), h: innerHeight, h1: Math.round(r(document.querySelector('.markdown-body h1')).top) }; });
    check('iphone: la barra de arriba deja libre la muesca', bars.topH === 49 + INSET.top && bars.btnTop >= INSET.top && bars.h1 >= bars.topH, bars);
    check('iphone: el pie deja libre la barra de inicio', bars.footH === 30 + INSET.bottom && bars.footPad === INSET.bottom + 'px' && bars.text <= bars.h - INSET.bottom + 1, bars);
    check('iphone: ningún control de la nota queda fuera de pantalla ni debajo de la muesca', (await inside(p, '.lmd-topbar button, .lmd-topbar a', INSET.top, 0)).length === 0 && (await fits(p)) <= 1, await inside(p, '.lmd-topbar button, .lmd-topbar a', INSET.top, 0));
    await appleShot(p, 'iphone-nota');
    await p.tap('[data-act=sidebar]'); await sleep(450);
    const side = await p.evaluate(() => { const s = document.querySelector('.lmd-sidebar'); const cs = getComputedStyle(s); const first = [...s.querySelectorAll('input, button')].filter((b) => b.offsetParent)[0]; return { top: cs.paddingTop, bottom: cs.paddingBottom, first: Math.round(first.getBoundingClientRect().top), right: Math.round(s.getBoundingClientRect().right) }; });
    check('iphone: el panel lateral respeta la muesca y la barra de inicio', side.top === INSET.top + 'px' && side.bottom === INSET.bottom + 'px' && side.first >= INSET.top && side.right <= 390, side);
    await appleShot(p, 'iphone-panel');
    await p.touchscreen.tap(380, 420); await sleep(450);
    await p.evaluate(() => { LMD.dialog.confirm({ title: 'Delete this note?', text: 'It goes to the trash.', ok: 'Delete' }); }); await p.waitForSelector('.lmd-ask-card');
    const dlg = await p.evaluate(() => { const r = document.querySelector('.lmd-ask-card').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: innerHeight, low: Math.min(...[...document.querySelectorAll('.lmd-ask-card button')].map((b) => b.getBoundingClientRect().height)) }; });
    check('iphone: un diálogo queda dentro del área segura, con botones que se pueden tocar', dlg.top >= INSET.top && dlg.bottom <= dlg.h - INSET.bottom && dlg.left >= 12 && dlg.right <= 378 && dlg.low >= 40, dlg);
    await appleShot(p, 'iphone-dialogo');
    await p.keyboard.press('Escape'); await sleep(200);
    await p.evaluate(() => document.querySelector('[data-act=settings]').click()); await p.waitForSelector('.lmd-panel-card'); // con una nota abierta, en el teléfono Ajustes está dentro de "más"
    const panel = await p.evaluate(() => { const head = document.querySelector('.lmd-panel-card header').getBoundingClientRect(); const body = document.querySelector('.lmd-panel-body'); return { head: Math.round(head.top), pad: parseFloat(getComputedStyle(body).paddingBottom), close: Math.round(document.querySelector('[data-act=close-panel]').getBoundingClientRect().top) }; });
    check('iphone: Ajustes a pantalla completa respeta la muesca y la barra de inicio', panel.head >= INSET.top && panel.close >= INSET.top && panel.pad >= INSET.bottom + 20, panel);
    const tabsWide = [];
    for (const t of ['look', 'read', 'plug', 'tools', 'cloud', 'ai', 'plan', 'inst', 'adv']) { await p.tap('[data-ptab=' + t + ']'); await sleep(350); const w = await p.evaluate(() => { const b = document.querySelector('.lmd-panel-body'); return Math.max(b.scrollWidth - b.clientWidth, document.documentElement.scrollWidth - innerWidth); }); if (w > 1) tabsWide.push(t + ' +' + w); }
    check('iphone: ninguna pestaña de Ajustes se pasa de ancho', tabsWide.length === 0, tabsWide);
    check('iphone: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  if (APPLE) await step('iPhone: escribir con el teclado en pantalla', async () => {
    const m = await iphone(); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await p.goto(R.home + '?f=' + enc('local/rich.md') + '&edit=1'); await p.waitForSelector('.lmd-article > p.lmd-editable');
    const para = p.locator('.lmd-article > p.lmd-editable').first();
    await para.tap(); await sleep(200);
    await p.evaluate(() => window.__kb(336)); await sleep(300);
    const up = await p.evaluate(() => ({ cls: document.documentElement.classList.contains('lmd-kb'), kb: document.documentElement.style.getPropertyValue('--lmd-kb'), foot: getComputedStyle(document.querySelector('.lmd-foot')).display, focus: !!document.activeElement && document.activeElement.isContentEditable }));
    check('iphone: al abrirse el teclado la página lo sabe, y el pie se corre', up.cls && up.kb === '336px' && up.foot === 'none' && up.focus, up);
    await p.keyboard.press('End'); await p.keyboard.type(' Typed on the phone.', { delay: 20 }); await sleep(300);
    const caret = await p.evaluate(() => { const r = getSelection().getRangeAt(0).getClientRects()[0] || getSelection().getRangeAt(0).getBoundingClientRect(); return { bottom: Math.round(r.bottom), top: Math.round(r.top), seen: innerHeight - 336, text: document.querySelector('.lmd-article > p.lmd-editable').textContent }; });
    check('iphone: lo escrito entra en la nota y el cursor queda a la vista, arriba del teclado', /Typed on the phone\.$/.test(caret.text) && caret.bottom <= caret.seen && caret.top >= 49 + INSET.top, caret);
    await p.evaluate(() => { const el = document.querySelector('.lmd-article > p.lmd-editable'); const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await sleep(450);
    const bar = await p.evaluate(() => { const b = document.querySelector('.lmd-format'); const r = b.getBoundingClientRect(); const sel = getSelection().getRangeAt(0).getBoundingClientRect(); return { seen: !b.hidden, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), limit: innerHeight - 336, sel: Math.round(sel.bottom), low: Math.min(...[...b.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().height)) }; });
    check('iphone: la barra de formato queda pegada arriba del teclado, entera y sin tapar lo elegido', bar.seen && bar.bottom <= bar.limit && bar.bottom >= bar.limit - 24 && bar.top > bar.sel && bar.left >= 0 && bar.right <= 390 && bar.low >= 40, bar);
    await appleShot(p, 'iphone-teclado');
    await p.tap('.lmd-format [data-fmt=bold]'); await sleep(300);
    check('iphone: negrita desde la barra', await p.evaluate(() => !!document.querySelector('.lmd-article > p.lmd-editable strong, .lmd-article > p.lmd-editable b')));
    const zoom = await p.evaluate(() => { const small = [...document.querySelectorAll('input, select, textarea')].filter((n) => n.offsetParent && !/checkbox|radio|range|color|file/.test(n.type) && parseFloat(getComputedStyle(n).fontSize) < 16).map((n) => n.className || n.name || n.type); const b = document.querySelector('.lmd-topbar button'); return { small, action: getComputedStyle(b).touchAction, tap: getComputedStyle(b).webkitTapHighlightColor, adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust, over: getComputedStyle(document.documentElement).overscrollBehaviorY }; });
    // El WebKit de prueba no conoce todas estas propiedades (en Windows le faltan el destello y el rebote): donde las conoce se mide lo que quedó
    // aplicado, y donde no, que la regla esté en la hoja de estilos.
    const sheet = fs.readFileSync(new URL('../src/content.css', import.meta.url), 'utf8');
    const ruled = /html\.lmd-ios, html\.lmd-ios \.lmd-body[^{]*\{ overscroll-behavior-y: none; \}/.test(sheet) && /-webkit-tap-highlight-color: transparent; touch-action: manipulation;/.test(sheet) && /-webkit-text-size-adjust: 100%/.test(sheet) && /html\.lmd-ios input[^{]*\{ font-size: max\(16px, 1em\); \}/.test(sheet);
    check('iphone: ningún campo tiene letra de menos de 16 px, y los botones no hacen zoom con doble toque ni destellan', zoom.small.length === 0 && zoom.action === 'manipulation' && (zoom.tap === undefined || /rgba\(0, 0, 0, 0\)|transparent/.test(zoom.tap)) && (zoom.adjust === undefined || zoom.adjust === '100%') && ruled, zoom);
    check('iphone: arrastrar más allá del borde no rebota la página', (zoom.over === undefined || zoom.over === 'none') && ruled, zoom.over);
    await p.evaluate(() => window.__kb(0)); await sleep(300);
    check('iphone: al cerrarse el teclado vuelve el pie', await p.evaluate(() => !document.documentElement.classList.contains('lmd-kb') && getComputedStyle(document.querySelector('.lmd-foot')).display !== 'none'));
    check('iphone: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  if (APPLE) await step('iPhone: copiar y exportar', async () => {
    const who = await R.signup('iphone' + Date.now() + '@ejemplo.test', true);
    const m = await iphone(who); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await p.goto(R.home + '?f=' + enc('local/rich.md')); await p.waitForSelector('.markdown-body h1');
    const pick = async (act, sub) => { await p.tap('[data-act=more]'); await p.waitForSelector('.lmd-menu-more'); await p.tap('.lmd-menu-more [data-more=' + act + ']'); await p.waitForSelector('.lmd-menu-' + act); await p.tap('.lmd-menu-' + act + ' [data-more=' + sub + ']'); await sleep(350); };
    await pick('copy', 'copy-rich');
    const rich = await p.evaluate(() => window.__copied.slice(-1)[0]);
    check('iphone: copiar con formato escribe HTML y texto, dentro del toque', !!rich && rich.types && rich.types.includes('text/html') && rich.types.includes('text/plain') && rich.live !== false && /Copied with formatting/.test(await p.textContent('.lmd-status')), rich);
    await pick('copy', 'copy-md');
    const md = await p.evaluate(() => window.__copied.slice(-1)[0]);
    check('iphone: copiar el Markdown, dentro del toque', !!md && /^# Trip plan/.test(md.text || '') && md.live !== false, md);
    await pick('export', 'export-html');
    const html = await p.evaluate(() => window.__shared.slice(-1)[0]);
    check('iphone: exportar a HTML abre la hoja de compartir con el archivo', !!html && html.name === 'rich.html' && html.type === 'text/html' && html.size > 500 && html.live !== false, html);
    await pick('export', 'export-md');
    const file = await p.evaluate(() => window.__shared.slice(-1)[0]);
    check('iphone: exportar el .md también, con su nombre', !!file && file.name === 'rich.md' && /^text\//.test(file.type) && file.live !== false, file);
    await p.evaluate(() => { window.__noShare = true; });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), pick('export', 'export-html')]);
    check('iphone: si la hoja de compartir no acepta archivos, se descarga como siempre', !!dl && dl.suggestedFilename() === 'rich.html' && (await p.evaluate(() => window.__shared.length)) === 2, dl && dl.suggestedFilename());
    // El mensaje para la IA: se crea un token y se copian las instrucciones.
    await p.evaluate(() => document.querySelector('[data-act=settings]').click()); await p.waitForSelector('.lmd-panel-card'); await p.tap('[data-ptab=ai]'); await p.waitForSelector('[data-acct=ai] [data-c=token]', { timeout: 15000 });
    await p.tap('[data-acct=ai] [data-c=token]'); await p.waitForSelector('[data-acct=ai] [data-c=brief]', { timeout: 15000 });
    await p.evaluate(() => { window.__copied.length = 0; });
    await p.tap('[data-acct=ai] [data-c=brief]'); await sleep(500);
    const brief = await p.evaluate(() => window.__copied.slice(-1)[0]);
    check('iphone: copiar el mensaje para la IA, dentro del toque', !!brief && /mcp/i.test(brief.text || '') && (brief.text || '').length > 300 && brief.live !== false, brief && { live: brief.live, n: (brief.text || '').length });
    check('iphone: Ajustes > IA entra en el ancho', (await fits(p)) <= 1, await fits(p));
    check('iphone: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });

  if (APPLE) await step('iPad: inicio, nota y Ajustes', async () => {
    for (const [name, viewport] of [['vertical', { width: 820, height: 1180 }], ['acostado', { width: 1180, height: 820 }]]) {
      const m = await R.open(null, { viewport, userAgent: UA_IPAD, hasTouch: true, isMobile: true, colorScheme: 'light', deviceScaleFactor: 2 }); const p = m.page; const before = R.errors.length;
      await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
      check('ipad ' + name + ': el inicio entra en el ancho y la página sabe que es un iPad', (await fits(p)) <= 1 && await p.evaluate(() => document.documentElement.classList.contains('lmd-ios')), await fits(p));
      await appleShot(p, 'ipad-inicio-' + name);
      await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
      await p.goto(R.home + '?f=' + enc('local/rich.md')); await p.waitForSelector('.markdown-body h1'); await p.waitForSelector('.lmd-diagram svg', { timeout: 30000 });
      check('ipad ' + name + ': la nota entra en el ancho, con sus controles en pantalla', (await fits(p)) <= 1 && (await inside(p, '.lmd-topbar button', 0, 0)).length === 0, [await fits(p), await inside(p, '.lmd-topbar button', 0, 0)]);
      await appleShot(p, 'ipad-nota-' + name);
      await p.evaluate(() => document.querySelector('[data-act=settings]').click()); await p.waitForSelector('.lmd-panel-card'); await sleep(300);
      const look = await p.evaluate(() => { const c = document.querySelector('.lmd-panel-card').getBoundingClientRect(); const b = document.querySelector('.lmd-panel-body'); return { in: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, wide: b.scrollWidth - b.clientWidth, themes: document.querySelectorAll('.lmd-th').length }; });
      check('ipad ' + name + ': Ajustes entra en pantalla, con la grilla de temas', look.in && look.wide <= 0 && look.themes === 12, look);
      await appleShot(p, 'ipad-ajustes-' + name);
      await p.tap('[data-ptab=inst]'); await p.waitForSelector('[data-inst-ios]');
      check('ipad ' + name + ': Instalar muestra los pasos de iPhone y iPad', (await p.evaluate(() => document.querySelectorAll('[data-inst-ios] li').length)) === 3);
      if (name === 'vertical') await appleShot(p, 'ipad-instalar');
      check('ipad ' + name + ': sin errores', R.errors.length === before, R.errors.slice(before));
      await m.ctx.close();
    }
  });

  if (APPLE) await step('Mac: atajos con ⌘ y pasos de instalación', async () => {
    const m = await R.open(null, { viewport: { width: 1280, height: 800 }, userAgent: UA_MAC, colorScheme: 'light' }); const p = m.page; const before = R.errors.length;
    await p.goto(R.home); await p.waitForSelector('.lmd-home [data-home=new]');
    await p.evaluate((t) => LMD.store.notePut('rich.md', t), RICH);
    await p.goto(R.home + '?f=' + enc('local/rich.md') + '&edit=1'); await p.waitForSelector('.lmd-article > p.lmd-editable');
    const keys = await p.evaluate(() => ({ cls: document.documentElement.className, save: document.querySelector('[data-act=save]').title, side: document.querySelector('[data-act=sidebar]').title, bold: document.querySelector('.lmd-format [data-fmt=bold]').title, link: document.querySelector('.lmd-format [data-fmt=link]').title,
      map: [LMD.keys('Ctrl+Y'), LMD.keys('Ctrl+Enter'), LMD.keys('Alt+Shift+P'), LMD.keys('Ctrl+Shift+V'), LMD.t('Cambio deshecho. Ctrl+Y lo rehace')].join(' | '), ctrl: [...document.querySelectorAll('[title]')].map((n) => n.title).filter((t) => /Ctrl\+|Alt\+/.test(t)) }));
    check('mac: los rótulos muestran ⌘, ⌥ y ⇧ en vez de Ctrl y Alt', /\blmd-mac\b/.test(keys.cls) && !/lmd-ios/.test(keys.cls) && /⌘S/.test(keys.save) && keys.side === 'Sidebar' && /⌘B/.test(keys.bold) && /⌘K/.test(keys.link) && keys.ctrl.length === 0, keys);
    check('mac: rehacer es ⇧⌘Z, aplicar es ⌘↩', keys.map === '⇧⌘Z | ⌘↩ | ⌥⇧P | ⇧⌘V | Change undone. ⇧⌘Z redoes it', keys.map);
    await p.locator('.lmd-article > p.lmd-editable').first().click(); await p.keyboard.press('End'); await p.keyboard.type(' Mac.'); await sleep(200);
    // La tecla ⌘ de verdad no existe en el teclado de prueba: se manda el evento que manda una Mac.
    const cmd = (shift) => p.evaluate((s) => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: s ? 'Z' : 'z', code: 'KeyZ', metaKey: true, shiftKey: s, bubbles: true, cancelable: true })); }, shift);
    await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await sleep(700); // fuera del bloque, deshacer es el de la app
    await cmd(false); await sleep(300);
    const undone = await p.evaluate(() => document.querySelector('.lmd-article > p.lmd-editable').textContent);
    await cmd(true); await sleep(300);
    const redone = await p.evaluate(() => document.querySelector('.lmd-article > p.lmd-editable').textContent);
    check('mac: ⌘Z deshace y ⇧⌘Z rehace', !/Mac\.$/.test(undone) && /Mac\.$/.test(redone), [undone.slice(-30), redone.slice(-30)]);
    // Ctrl+K en una Mac borra hasta el fin del renglón: el enlace sale solo con ⌘K.
    await p.locator('.lmd-article > p.lmd-editable').first().click();
    const key = (o) => p.evaluate((x) => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: 'k', code: 'KeyK', bubbles: true, cancelable: true }, x))); }, o);
    await key({ ctrlKey: true }); await sleep(300);
    const withCtrl = await p.locator('.lmd-lk-card').count();
    await key({ metaKey: true }); await sleep(400);
    const withCmd = await p.locator('.lmd-lk-card').count();
    await p.keyboard.press('Escape'); await sleep(200);
    check('mac: Ctrl+K queda para el sistema y ⌘K abre el enlace', withCtrl === 0 && withCmd === 1, [withCtrl, withCmd]);
    await p.click('[data-act=export]'); await p.waitForSelector('.lmd-menu-export');
    const print = await p.evaluate(() => [...document.querySelectorAll('.lmd-menu-export kbd')].map((k) => k.textContent).join());
    await p.keyboard.press('Escape');
    check('mac: imprimir muestra ⌘P', print === '⌘P', print);
    await p.click('[data-act=settings]'); await p.waitForSelector('.lmd-panel-card'); await p.click('[data-ptab=inst]'); await p.waitForSelector('[data-inst-mac]');
    const inst = await p.evaluate(() => { const box = document.querySelector('[data-inst-pane]'); return { heads: [...box.querySelectorAll('h4')].map((h) => h.textContent), steps: [...box.querySelectorAll('[data-inst-mac] li')].map((li) => li.textContent), finder: /In Finder/.test(box.textContent), win: /Windows|Always/.test(box.textContent), ios: !!box.querySelector('[data-inst-ios]'), text: box.textContent }; });
    check('mac: Instalar muestra los pasos de Mac (Safari y Chrome) y el doble clic desde Finder', inst.heads.includes('On Mac') && inst.steps.length === 2 && /Add to Dock/.test(inst.steps[0]) && /Chrome or Edge/.test(inst.steps[1]) && inst.finder && !inst.win && !inst.ios && !/[!¡—–]/.test(inst.text), inst);
    check('mac: sin errores', R.errors.length === before, R.errors.slice(before));
    await m.ctx.close();
  });
} catch (e) {
  check('sin excepciones', false, e.message);
} finally {
  await R.close();
}
const bad = done();
console.log('Capturas en ' + SHOTS);
process.exit(bad ? 1 : 0);
