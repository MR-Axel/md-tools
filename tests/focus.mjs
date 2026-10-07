// Foco al escribir: en una nota del navegador, una de la nube y una del disco con guardado automático, escribir de
// corrido con pausas de uno y dos segundos no saca el cursor del bloque, y lo escrito llega al Markdown guardado
// sin salir de él. Cubre código (nuevo y existente), celda, párrafo, ítem de lista, bloque nuevo y celda con fórmula.
// Todo contra un servidor local: la nube de verdad queda apagada.
import { chromium } from 'playwright-core';
import { autoDialogs } from './dialogs.mjs';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 19000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', MCP_FREE: '1', SHARE_FREE: '1', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
{ let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; }); for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100)); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(autoDialogs);
const home = `chrome-extension://${id}/src/app.html`;
const DOC = '# Doc\n\nPrimer texto.\n\n- alfa\n- beta\n\n| Producto | Cant |\n| --- | --- |\n| uno | 2 |\n| dos | 3 |\n| Total | =sum |\n\n```js\nlet a = 1;\n```\n\nFin.\n';
const checks = [];
const J = (v) => JSON.stringify(v);

// Escribe de corrido con una pausa de un segundo y otra de dos en el medio: varios segundos en total.
const typeSlow = async (text) => {
  const a = Math.floor(text.length / 3); const b = Math.floor(2 * text.length / 3);
  await app.keyboard.type(text.slice(0, a), { delay: 45 }); await app.waitForTimeout(1000);
  await app.keyboard.type(text.slice(a, b), { delay: 45 }); await app.waitForTimeout(2000);
  await app.keyboard.type(text.slice(b), { delay: 45 });
};
// Marca el elemento con foco, para saber después si sigue siendo el mismo nodo.
const mark = (tag) => app.evaluate((t) => { const a = document.activeElement; a.__probe = t; return a.className + '|' + a.tagName; }, tag);
// Dónde quedó el foco, qué tiene escrito y qué hay antes del cursor.
const probe = (tag) => app.evaluate((t) => {
  const a = document.activeElement; const same = !!a && a.__probe === t && a.isConnected;
  if (!same) return { same, where: a ? a.tagName + '.' + a.className : '' };
  if (a.tagName === 'TEXTAREA') return { same, text: a.value, before: a.value.slice(0, a.selectionStart) };
  const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(a);
  if (sel.rangeCount && a.contains(sel.anchorNode)) r.setEnd(sel.anchorNode, sel.anchorOffset);
  return { same, text: a.textContent, before: r.toString() };
}, tag);

// Una pasada completa sobre la nota abierta. saved() devuelve el Markdown que quedó guardado.
async function pass(name, saved, first) {
  const add = (what, ok, detail) => checks.push([name + ': ' + what, ok, detail]);
  // Cada caso: se escribe con pausas, se espera el guardado sin salir del bloque, y se mira foco, cursor y archivo.
  const step = async (what, typed, expect, inFile) => {
    const tag = name + what; await mark(tag);
    await typeSlow(typed); await app.waitForTimeout(3600);
    const p = await probe(tag); const md = await saved();
    add(what + ' conserva el foco y el cursor', p.same && p.text.includes(expect) && p.before.endsWith(expect), p);
    add(what + ' queda guardado sin salir del bloque', md.includes(inFile || expect), md);
  };
  await app.click('[data-act=mode-edit]'); await app.waitForTimeout(400);
  if (first) await first();
  await app.locator('.lmd-article p.lmd-editable', { hasText: 'Primer texto' }).click(); await app.keyboard.press('End');
  await step('párrafo', ' Sigo escribiendo de corrido sin parar', 'Sigo escribiendo de corrido sin parar');
  await app.locator('.lmd-li-text', { hasText: 'alfa' }).click(); await app.keyboard.press('End');
  await step('ítem de lista', ' con mas cosas en el item', 'alfa con mas cosas en el item', '- alfa con mas cosas en el item');
  await app.locator('td.lmd-cell', { hasText: 'uno' }).click(); await app.keyboard.press('End');
  await step('celda', ' y medio kilo de pan', 'uno y medio kilo de pan', '| uno y medio kilo de pan | 2 |');
  // celda con fórmula: al entrar muestra =sum; se la cambia por =avg letra a letra
  await app.locator('td.lmd-cell').last().click(); await app.keyboard.press('Control+a');
  await step('celda con fórmula', '=avg', '=avg', '| Total | =avg |');
  // bloque de código existente
  await app.locator('.lmd-code').first().dblclick(); await app.waitForSelector('textarea.lmd-src'); await app.keyboard.press('Control+End');
  await step('código existente', '\nlet b = 2;\nlet c = a + b;', 'let a = 1;\nlet b = 2;\nlet c = a + b;', '```js\nlet a = 1;\nlet b = 2;\nlet c = a + b;\n```');
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
  // bloque de código recién insertado
  await app.locator('.lmd-article h1').click({ button: 'right' }); await app.click('.lmd-menu [data-ins=code]'); await app.waitForSelector('textarea.lmd-src');
  await step('código nuevo', 'const x = 10;\nconst y = x * 2;', 'const x = 10;\nconst y = x * 2;', '```\nconst x = 10;\nconst y = x * 2;\n```');
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(700);
  // bloque nuevo: Enter al final de un párrafo
  await app.locator('.lmd-article p.lmd-editable', { hasText: 'Fin.' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-draft');
  await step('bloque nuevo', 'Un bloque nuevo escrito con calma', 'Un bloque nuevo escrito con calma', 'Fin.\n\nUn bloque nuevo escrito con calma');
  await app.click('.lmd-foot .lmd-status', { force: true }); await app.waitForTimeout(2500);
  const end = await saved();
  add('al salir queda todo en el Markdown, una sola vez', ['Sigo escribiendo de corrido sin parar', '- alfa con mas cosas en el item', 'uno y medio kilo de pan', '=avg', 'let c = a + b;', 'const y = x * 2;', 'Un bloque nuevo escrito con calma'].every((t) => end.split(t).length === 2), end);
  add('el documento se vuelve a dibujar bien al salir', await app.evaluate(() => !document.querySelector('.lmd-draft, .lmd-pending, textarea.lmd-src') && document.querySelectorAll('.lmd-article p').length >= 3 && /Un bloque nuevo/.test(document.querySelector('.lmd-article').textContent)));
}

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url, autosave: true, autosaveDelay: 1000 } }, resolve)), base);

  // ---------- En este navegador ----------
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate((t) => LMD.store.notePut('foco.md', t), DOC);
  await app.goto(home + '?f=' + encodeURIComponent('local/foco.md')); await app.waitForSelector('.markdown-body h1');
  await pass('navegador', () => app.evaluate(async () => (await LMD.store.noteGet('foco.md')).text));

  // ---------- Nube ----------
  await app.goto(home); await app.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
  await app.click('[data-cloud=ask]'); await app.fill('[data-field=email]', 'ana@ejemplo.test');
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  await app.waitForSelector('[data-field=code]'); await app.fill('[data-field=code]', (await started.json()).dev_code); await app.click('[data-cloud=verify]');
  await app.waitForSelector('[data-cloud=menu]');
  await app.evaluate((t) => LMD.cloud.write('foco.md', t), DOC);
  await app.goto(home + '?f=' + encodeURIComponent('cloud/foco.md')); await app.waitForSelector('.markdown-body h1');
  await pass('nube', () => app.evaluate(async () => (await LMD.cloud.read('foco.md')).text));
  // Beto, con quien se comparte la nota, la cambia desde su cuenta: a la app le llega como evento en vivo.
  await app.evaluate(() => LMD.cloud.share('foco.md', 'beto@ejemplo.test', 'edit', 'note'));
  const call = (method, url, body, session) => fetch(base + url, { method, headers: Object.assign({ 'content-type': 'application/json' }, session ? { authorization: 'Bearer ' + session } : {}), body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const code = (await call('POST', '/auth/start', { email: 'beto@ejemplo.test', lang: 'es' })).dev_code;
  const beto = (await call('POST', '/auth/verify', { email: 'beto@ejemplo.test', code })).session;
  const owner = [].concat((await call('GET', '/shared', null, beto)) || []).find((n) => n.path === 'foco.md').owner;
  const other = async (from, to) => { const n = await call('GET', '/notes/foco.md?o=' + owner, null, beto); await call('PUT', '/notes/foco.md?o=' + owner, { text: n.text.replace(from, to) }, beto); };
  // Otra persona guarda mientras se escribe: no se redibuja encima; al salir aparecen los dos cambios.
  await app.locator('.lmd-article p.lmd-editable', { hasText: 'Fin.' }).click(); await app.keyboard.press('End'); await mark('vivo');
  await app.keyboard.type(' Mas', { delay: 45 });
  await other('# Doc', '# Doc de dos');
  await app.waitForTimeout(1500); await app.keyboard.type(' texto mio', { delay: 45 }); await app.waitForTimeout(12500);
  const vivo = await probe('vivo');
  checks.push(['nube: un cambio de otra persona no saca el foco', vivo.same && vivo.before.endsWith('Fin. Mas texto mio'), vivo]);
  await app.click('.lmd-foot .lmd-status', { force: true });
  await app.waitForFunction(() => /Doc de dos/.test(document.querySelector('.markdown-body h1').textContent), null, { timeout: 25000 }).catch(() => {});
  await app.waitForTimeout(2500);
  const junto = await app.evaluate(async () => (await LMD.cloud.read('foco.md')).text);
  checks.push(['nube: al salir se juntan los dos cambios', /# Doc de dos/.test(junto) && /Fin\. Mas texto mio/.test(junto), junto]);

  // ---------- Disco, con guardado automático ----------
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(async (t) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('foco', { create: true });
    const h = await dir.getFileHandle('doc.md', { create: true }); const s = await h.createWritable(); await s.write(t); await s.close();
    window.showDirectoryPicker = async () => dir;
  }, DOC);
  await Promise.all([app.waitForNavigation(), app.click('[data-home=dir]')]); await app.waitForSelector('.markdown-body h1');
  const disk = () => app.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('foco'); return (await (await dir.getFileHandle('doc.md')).getFile()).text(); });
  // En el disco el guardado automático arranca después del primer Ctrl+S, que es el que deja el permiso.
  await pass('disco', disk, async () => { await app.keyboard.press('Control+s'); await app.waitForTimeout(900); });
  // El archivo cambia por fuera con el cursor en un bloque: el sondeo no redibuja encima; al salir se actualiza.
  await app.locator('.lmd-article p.lmd-editable', { hasText: 'Fin.' }).click(); await mark('sondeo');
  await app.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('foco'); const h = await dir.getFileHandle('doc.md');
    const t = await (await h.getFile()).text(); const s = await h.createWritable(); await s.write(t.replace('# Doc', '# Doc cambiado por fuera')); await s.close();
  });
  await app.waitForTimeout(3000);
  const sondeo = await probe('sondeo');
  checks.push(['disco: un cambio por fuera no saca el foco', sondeo.same, sondeo]);
  await app.click('.lmd-foot .lmd-status', { force: true });
  await app.waitForFunction(() => /cambiado por fuera/.test(document.querySelector('.markdown-body h1').textContent), null, { timeout: 6000 }).catch(() => {});
  checks.push(['disco: al salir se ve el cambio de afuera', /cambiado por fuera/.test(await app.textContent('.markdown-body h1'))]);
  // Escape sigue cancelando, aunque lo escrito ya hubiera pasado al Markdown en una pausa.
  await app.locator('.lmd-code').last().dblclick(); await app.waitForSelector('textarea.lmd-src'); await app.keyboard.type('zzz'); await app.waitForTimeout(1600);
  await app.keyboard.press('Escape'); await app.waitForTimeout(400);
  await app.locator('.lmd-article p.lmd-editable', { hasText: 'Fin.' }).click(); await app.keyboard.press('End'); await app.keyboard.press('Enter'); await app.waitForSelector('.lmd-draft');
  await app.keyboard.type('qqq'); await app.waitForTimeout(1600); await app.keyboard.press('Escape'); await app.waitForTimeout(2600);
  const tras = await disk();
  checks.push(['disco: Escape descarta lo escrito en el código y en el bloque nuevo', !/zzz|qqq/.test(tras) && !tras.includes('\n\n\n'), tras]);
  checks.push(['sin errores de JavaScript', errors.length === 0, errors]);
} catch (e) { checks.push(['la prueba llegó hasta el final', false, String(e && e.stack || e).slice(0, 600)]); }

console.log('Foco al escribir');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail).slice(0, 400))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); server.kill(); fs.rmSync(profile, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
