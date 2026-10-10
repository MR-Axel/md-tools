// Las imágenes de la página de novedades (updates.html y es/updates.html): capturas de la app, en inglés y en
// español, con notas inventadas. Quedan en site/updates/<idioma>/, en WebP, de 1200 px de ancho y menos de 150 KB.
//   node updates-shots.mjs            todas
//   ONLY=viewer node updates-shots.mjs   una sola (viewer, send-to-cloud, export-folder, folder-template, explore-diagram)
// Después: node ../tools/build-updates.mjs
// Corre sobre la app web servida acá mismo, con un servidor de sincronización local (rig.mjs): nada toca la nube de verdad.
// Para sumar una captura: una escena más en SCENES, con el nombre del archivo que nombra la fuente (tools/updates.<idioma>.md).
import { rig, sleep, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path';

const ONLY = process.env.ONLY || '';
// La ventana mide 1000 px y se captura a 1,2: la imagen sale de 1200 px y la interfaz se lee mejor en una columna de texto.
const W = 1000; const H = 640; const SCALE = 1.2; const MAX = 150 * 1024;
const F = '```';
const DATA = {
  en: {
    locale: 'en-US', mail: 'robin@example.test', dir: 'garden-club', sub: 'season-plan', pdf: 'handbook.pdf', pdfTitle: 'Garden club handbook', kit: 'Welcome kit', short: 'welcome-kit',
    pdfPages: [['Garden club handbook', 'What every new member needs to know before the first Saturday.'], ['Tools and the shed', 'The shed opens at nine. Put every tool back on its hook and write down what breaks.'],
      ['Watering', 'Beds are watered early, before the sun reaches them. Each bed has a turn on the rota.'], ['Compost', 'Kitchen scraps go in the left bin. The right bin rests until spring.']],
    files: {
      'welcome.md': '# Welcome to the garden club\n\nWe meet on Saturdays at nine. Bring gloves and a bottle of water.\n\n- [x] Read the handbook\n- [ ] Pick a bed\n- [ ] Join the watering rota\n',
      'budget.md': '# Budget\n\n| Item | Cost |\n|---|---|\n| Seeds | 40 |\n| Compost | 25 |\n| Hose | 30 |\n',
      'season-plan/1-spring.md': '# Spring\n\nSow lettuce, peas and radishes. See [summer](2-summer.md).\n',
      'season-plan/2-summer.md': '# Summer\n\nTomatoes, basil and beans. Water twice a day in a heat wave.\n',
      'season-plan/3-autumn.md': '# Autumn\n\nGarlic and broad beans go in before the first frost.\n',
    },
    cloud: { '1-start-here.md': '# Start here\n\nThree steps for your first week in the club.\n\n1. Read the handbook\n2. Pick a bed\n3. Join the watering rota\n', '2-your-bed.md': '# Your bed\n\nWrite down what you sow and when.\n', '3-watering-rota.md': '# Watering rota\n\n| Day | Who |\n|---|---|\n| Monday | |\n| Thursday | |\n' },
    map: ['# From the garden to the door', '', 'Every Friday the club packs harvest boxes.', '', F + 'mermaid', 'flowchart LR', '  list[Friday list] --> pick[Harvest]', '  pick --> pack[Pack the boxes]', '  pack --> bike[Bike delivery]', '  pack --> stall[Pick up at the stall]',
      '  %% @pack: Two people. Each box gets a card with what is inside.', '  %% @pick: Leaves first, roots last.', F, ''].join('\n'),
    pickNode: 'pack',
  },
  es: {
    locale: 'es-AR', mail: 'caro@example.test', dir: 'huerta-del-barrio', sub: 'plan-de-temporada', pdf: 'manual.pdf', pdfTitle: 'Manual de la huerta', kit: 'Kit de bienvenida', short: 'kit-de-bienvenida',
    pdfPages: [['Manual de la huerta', 'Lo que cada persona nueva tiene que saber antes del primer sábado.'], ['Las herramientas y el galpón', 'El galpón abre a las nueve. Cada herramienta vuelve a su gancho, y lo que se rompe se anota.'],
      ['El riego', 'Los canteros se riegan temprano, antes de que les dé el sol. Cada cantero tiene su turno.'], ['El compost', 'Los restos de cocina van al cajón de la izquierda. El de la derecha descansa hasta la primavera.']],
    files: {
      'bienvenida.md': '# Bienvenida a la huerta del barrio\n\nNos juntamos los sábados a las nueve. Traé guantes y una botella de agua.\n\n- [x] Leer el manual\n- [ ] Elegir un cantero\n- [ ] Anotarse en los turnos de riego\n',
      'presupuesto.md': '# Presupuesto\n\n| Cosa | Costo |\n|---|---|\n| Semillas | 40 |\n| Compost | 25 |\n| Manguera | 30 |\n',
      'plan-de-temporada/1-primavera.md': '# Primavera\n\nSembrar lechuga, arvejas y rabanitos. Sigue en [verano](2-verano.md).\n',
      'plan-de-temporada/2-verano.md': '# Verano\n\nTomates, albahaca y chauchas. Con ola de calor se riega dos veces por día.\n',
      'plan-de-temporada/3-otono.md': '# Otoño\n\nEl ajo y las habas van antes de la primera helada.\n',
    },
    cloud: { '1-empezar.md': '# Empezar\n\nTres pasos para tu primera semana en la huerta.\n\n1. Leer el manual\n2. Elegir un cantero\n3. Anotarse en los turnos de riego\n', '2-tu-cantero.md': '# Tu cantero\n\nAnotá qué sembrás y cuándo.\n', '3-turnos-de-riego.md': '# Turnos de riego\n\n| Día | Quién |\n|---|---|\n| Lunes | |\n| Jueves | |\n' },
    map: ['# De la huerta a la puerta', '', 'Cada viernes la huerta arma cajones de cosecha.', '', F + 'mermaid', 'flowchart LR', '  list[Lista del viernes] --> pick[Cosecha]', '  pick --> pack[Armar los cajones]', '  pack --> bike[Reparto en bici]', '  pack --> stall[Retiro en el puesto]',
      '  %% @pack: Dos personas. Cada cajón lleva una tarjeta con lo que trae.', '  %% @pick: Primero las hojas, al final las raíces.', F, ''].join('\n'),
    pickNode: 'pack',
  },
};

// El PDF sale de imprimir una página con Chromium, como en tests/viewer.mjs.
let R = null;
async function makePdf(d) {
  const page = await R.browser.newPage();
  const body = d.pdfPages.map(([h, p], i) => '<section style="page-break-after:always">' + (i ? '<h2>' + h + '</h2>' : '<h1>' + h + '</h1>') + '<p>' + p + '</p></section>').join('');
  await page.setContent('<!doctype html><html><head><title>' + d.pdfTitle + '</title><style>body{font:13pt Georgia,serif;margin:0;color:#222}section{padding:16mm}h1{font-size:26pt;margin:30mm 0 6mm}h2{font-size:18pt}</style></head><body>' + body + '</body></html>');
  const buf = await page.pdf({ width: '148mm', height: '210mm', outline: true, tagged: true, printBackground: true });
  await page.close();
  return buf;
}

R = await rig({ ALLOW_ORIGINS: '*' });
let failed = false;
try {
  for (const lang of Object.keys(DATA)) {
    const d = DATA[lang]; const out = path.join(root, 'site', 'updates', lang); fs.mkdirSync(out, { recursive: true });
    const who = await R.signup(d.mail, true);
    for (const [name, text] of Object.entries(d.cloud)) await R.api('PUT', '/notes/' + encodeURIComponent(d.kit + '/' + name), { text }, who.s);
    // El disco de prueba es OPFS, que pide un navegador con perfil propio (como en tests/folderexport.mjs).
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdnews-'));
    const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: W, height: H }, deviceScaleFactor: SCALE, locale: d.locale, colorScheme: 'light', serviceWorkers: 'block' });
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (route) => { R.outside.push(route.request().url()); return route.abort(); });
    // La app en su idioma, ya con la sesión de esa cuenta y la herramienta de los diagramas prendida.
    await ctx.addInitScript(([base, w, l]) => { try { if (localStorage.getItem('mdtools:settings')) return; localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: l, tools: { explore: true } })); localStorage.setItem('mdtools:cloud', JSON.stringify({ session: w.s, email: w.email, at: base })); } catch (e) { /* una página en blanco no tiene almacenamiento */ } }, [R.base, who, lang]);
    const page = await ctx.newPage();
    const conv = await ctx.newPage(); await conv.goto(R.origin + '/icons/icon16.png');
    // De PNG a WebP en el propio navegador. Si pasa del tope, baja la calidad de a poco.
    const save = async (name, clip) => {
      const png = (await page.screenshot(clip ? { clip } : {})).toString('base64'); let buf = null;
      for (const q of [0.86, 0.8, 0.72, 0.64, 0.55]) {
        const b64 = await conv.evaluate(async ([data, quality]) => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/webp', quality).split(',')[1]; }, [png, q]);
        buf = Buffer.from(b64, 'base64'); if (buf.length <= MAX) break;
      }
      if (buf.length > MAX) throw new Error(name + ' pesa ' + Math.round(buf.length / 1024) + ' KB');
      fs.writeFileSync(path.join(out, name + '.webp'), buf);
      console.log('  ' + lang + '/' + name + '.webp  ' + Math.round(buf.length / 1024) + ' KB');
    };
    const node = (title) => '.lmd-xroot[data-root=disk] .lmd-node[title="' + title + '"]';
    // La carpeta del disco: una del navegador (OPFS) que se abre como si fuera una del disco.
    const openFolder = async () => {
      await page.goto(R.home); await page.waitForSelector('.lmd-home');
      const pdf = (await makePdf(d)).toString('base64');
      await page.evaluate(async ([dirName, files, pdfName, pdfData]) => {
        const top = await navigator.storage.getDirectory();
        try { await top.removeEntry(dirName, { recursive: true }); } catch (e) { /* no estaba */ }
        const dir = await top.getDirectoryHandle(dirName, { create: true });
        const write = async (rel, body) => { const parts = rel.split('/'); let at = dir; for (const p of parts.slice(0, -1)) at = await at.getDirectoryHandle(p, { create: true }); const h = await at.getFileHandle(parts[parts.length - 1], { create: true }); const w = await h.createWritable(); await w.write(body); await w.close(); };
        for (const [rel, body] of Object.entries(files)) await write(rel, body);
        await write(pdfName, Uint8Array.from(atob(pdfData), (c) => c.charCodeAt(0)));
        window.showDirectoryPicker = async () => dir;
      }, [d.dir, d.files, d.pdf, pdf]);
      await Promise.all([page.waitForNavigation(), page.click('[data-home=dir]')]);
      await page.waitForSelector(node(d.pdf), { state: 'attached' }); await page.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-tree'); await sleep(500);
    };
    const SCENES = {
      'viewer': async () => {
        await openFolder();
        await page.click(node(d.pdf)); await page.waitForSelector('.lmd-vw-page canvas', { timeout: 20000 }); await page.waitForSelector('.lmd-vw-text span', { timeout: 20000 }); await sleep(900);
        await page.mouse.move(600, 420);
        await save('viewer');
      },
      'send-to-cloud': async () => {
        await openFolder();
        await page.click(node(d.sub), { button: 'right' }); await page.waitForSelector('.lmd-menu'); await sleep(300);
        await save('send-to-cloud', { x: 0, y: 0, width: W, height: 570 });
        await page.keyboard.press('Escape');
      },
      'export-folder': async () => {
        await openFolder();
        await page.click(node(d.sub), { button: 'right' }); await page.click('.lmd-menu [data-f=fexp]'); await page.waitForSelector('.lmd-fx'); await sleep(500);
        for (const k of ['cover', 'toc']) { const box = page.locator('.lmd-fx [data-fx=' + k + ']'); if (await box.count() && !(await box.isChecked())) await box.check().catch(() => {}); }
        await sleep(300);
        await save('export-folder');
        await page.keyboard.press('Escape');
      },
      'folder-template': async () => {
        await page.goto(R.noteUrl(d.kit + '/' + Object.keys(d.cloud)[0])); await page.waitForSelector('.lmd-article h1');
        await page.evaluate((b) => { window.LMD.CLOUD_URL = b; }, R.base); // como en sharpmd.app: la dirección corta se muestra con el dominio del sitio
        await page.click('.lmd-sync'); await page.waitForSelector('.lmd-menu [data-s=share]'); await page.click('.lmd-menu [data-s=share]'); await page.waitForSelector('.lmd-share [data-sh=folderlink]');
        await page.click('.lmd-share [data-sh=folderlink]'); await page.waitForSelector('.lmd-share-folder [data-sf=save]:not([disabled])');
        await page.check('.lmd-share-folder [data-sf=tpl]'); await page.fill('.lmd-share-folder [data-sf=name]', d.short); await page.click('.lmd-share-folder [data-sf=save]');
        await page.waitForSelector('.lmd-share-folder [data-sf=links] li input', { timeout: 10000 }); await sleep(400);
        await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
        await save('folder-template');
        await page.click('.lmd-share-folder [data-sf=close]');
      },
      'explore-diagram': async () => {
        await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
        await page.evaluate(([t]) => window.LMD.store.notePut('harvest.md', t), [d.map]);
        await page.goto(R.home + '?f=' + encodeURIComponent('local/harvest.md')); await page.waitForSelector('.lmd-xp-stage g.lmd-xp-node', { timeout: 20000 }); await sleep(600);
        await page.click('.lmd-xp-stage g.lmd-xp-node[data-xp-id="' + d.pickNode + '"]'); await page.waitForSelector('.lmd-xp-card:not([hidden])'); await sleep(500);
        await save('explore-diagram');
      },
    };
    // El diagrama va primero, antes de abrir la carpeta del disco: así sale igual corriendo todas o solo esa.
    const order = ['explore-diagram'].concat(Object.keys(SCENES).filter((n) => n !== 'explore-diagram'));
    for (const name of order) { const run = SCENES[name]; if (ONLY && ONLY !== name) continue; try { await run(); } catch (e) { failed = true; console.log('  FALLA ' + lang + '/' + name + ': ' + String(e && e.message || e).split('\n')[0]); } }
    await ctx.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows lo suelta después */ }
  }
  if (R.outside.length) { failed = true; console.log('  FALLA: algo apuntó a la nube de verdad: ' + R.outside.slice(0, 3).join(', ')); }
} finally { await R.close(); }
process.exit(failed ? 1 : 0);
