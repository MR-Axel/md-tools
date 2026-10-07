// Nube de punta a punta: entrar con el código, nota nueva en la nube, token y una IA escribiendo por MCP.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 19000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', MCP_FREE: '1', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1500, height: 950 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
await app.addInitScript(() => { window.confirm = () => true; });
const home = `chrome-extension://${id}/src/app.html`;
const o = {};
const mcp = (token, name, args) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json());

try {
  await app.goto(home); await app.waitForSelector('.lmd-home');
  o.sinServidor = await app.evaluate(() => document.querySelector('.lmd-home-cloud').hidden);
  await app.evaluate((url) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url } }, resolve)), base);
  await app.goto(home); await app.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
  await app.click('[data-cloud=ask]'); await app.fill('[data-field=email]', 'ana@ejemplo.test');
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  const code = (await started.json()).dev_code;
  await app.waitForSelector('[data-field=code]'); await app.fill('[data-field=code]', '999999' === code ? '000000' : '999999'); await app.click('[data-cloud=verify]');
  await app.waitForSelector('.lmd-home-cloud-err'); o.codigoMalo = await app.textContent('.lmd-home-cloud-err');
  await app.fill('[data-field=code]', code); await app.click('[data-cloud=verify]');
  await app.waitForSelector('[data-cloud=logout]'); o.cuenta = await app.textContent('.lmd-home-cloud-row span');

  await Promise.all([app.waitForNavigation(), app.click('[data-home=new]')]); await app.waitForSelector('.lmd-draft');
  o.url = /f=cloud%2Fnota-/.test(app.url());
  await app.keyboard.type('# Plan'); await app.keyboard.press('Enter'); await app.keyboard.type('Escrito en la app.'); await app.click('.lmd-foot .lmd-status', { force: true });
  await app.waitForFunction(() => /Guardando/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 4000 }).catch(() => {});
  await app.waitForFunction(() => /nube/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 8000 });
  o.estado = await app.textContent('.lmd-savestate');
  const noteUrl = app.url(); const notePath = decodeURIComponent(decodeURIComponent(noteUrl.split('f=cloud%2F')[1].split('&')[0]));

  const page2 = await ctx.newPage(); await page2.goto(home); await page2.waitForSelector('.lmd-home-item');
  o.enInicio = await page2.textContent('.lmd-home-item');
  await page2.click('[data-cloud=token]'); await page2.waitForSelector('.lmd-home-cloud-field input');
  const fields = await page2.evaluate(() => [...document.querySelectorAll('.lmd-home-cloud-field input')].map((i) => i.value));
  o.campos = [fields[0], fields[1].slice(0, 4), fields[2].slice(0, 44)];
  const token = fields[1];
  const read = await mcp(token, 'read_note', { path: notePath });
  o.leeLaIA = read.result.content[0].text;
  await mcp(token, 'append_note', { path: notePath, text: 'Agregado por la IA.' });
  await page2.close();
  await app.bringToFront();
  await app.waitForFunction(() => /Agregado por la IA/.test(document.querySelector('.markdown-body').textContent), null, { timeout: 20000 });
  o.veLoDeLaIA = true;

  await app.goto(home); await app.waitForSelector('[data-cloud=logout]'); await app.click('[data-cloud=logout]'); await app.waitForSelector('[data-cloud=ask]');
  o.salio = (await app.locator('.lmd-home-item').count()) === 0;
  await app.goto(noteUrl.replace('&edit=1', '')); await app.waitForSelector('.lmd-home-msg:not([hidden])');
  o.sinSesion = await app.textContent('.lmd-home-msg');
} catch (e) { o.excepcion = String(e && e.stack || e).slice(0, 600); }

const J = (v) => JSON.stringify(v);
const checks = [
  ['sin servidor configurado la nube no aparece', o.sinServidor === true],
  ['un código equivocado avisa', /no coincide/.test(o.codigoMalo || ''), o.codigoMalo],
  ['entrar muestra la cuenta y el cupo', /ana@ejemplo\.test · 0 de 20 notas/.test(o.cuenta || ''), o.cuenta],
  ['con la cuenta abierta, la nota nueva va a la nube', o.url === true],
  ['se guarda sola en la nube', /Guardado en la nube/.test(o.estado || ''), o.estado],
  ['aparece en el inicio como nota de la nube', /en la nube/.test(o.enInicio || ''), o.enInicio],
  ['el panel para conectar una IA da URL, token y comando', o.campos && o.campos[0] === base + '/mcp' && o.campos[1] === 'mdt_' && o.campos[2].startsWith('claude mcp add --transport http sharpmd'), o.campos],
  ['la IA lee por MCP lo escrito en la app', (o.leeLaIA || '').trim() === '# Plan\n\nEscrito en la app.', o.leeLaIA],
  ['lo que agrega la IA aparece en la app sin recargar', o.veLoDeLaIA === true],
  ['salir saca las notas de la nube del inicio', o.salio === true],
  ['sin sesión no se abre una nota de la nube', /Entrá a tu cuenta/.test(o.sinSesion || ''), o.sinSesion],
  ['sin errores', errors.length === 0 && !o.excepcion, [errors, o.excepcion]],
];
console.log('Nube y MCP');
checks.forEach(([name, ok, detail]) => console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))));
const bad = checks.filter((c) => !c[1]).length;
console.log('\n' + (checks.length - bad) + ' de ' + checks.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
