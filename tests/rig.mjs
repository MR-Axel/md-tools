// Lo que comparten las pruebas con varios navegadores a la vez (revision.mjs, live.mjs): el sitio servido como en
// sharpmd.app, un servidor de sincronización local y cómo abrir cada navegador ya apuntando a ese servidor.
// La nube de verdad no se toca: lo que apunte a sync.sharpmd.app o a sharpmd.app se corta y se anota.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown' };
const ADMIN = 'clave-de-prueba';

export async function rig(env) {
  const site = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + site.address().port; const home = origin + '/src/app.html';

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
  const PORT = 24000 + Math.floor(Math.random() * 4000); const base = 'http://127.0.0.1:' + PORT;
  const st = { log: '', proc: null };
  const start = async () => {
    st.proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: ADMIN, PUBLIC_URL: base, ALLOW_ORIGINS: origin, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    const mark = st.log.length;
    st.proc.stdout.on('data', (d) => { st.log += d; }); st.proc.stderr.on('data', (d) => { st.log += d; });
    for (let i = 0; i < 80 && !/puerto/.test(st.log.slice(mark)); i++) await sleep(100);
  };
  const stop = async () => { const gone = new Promise((r) => st.proc.once('exit', r)); st.proc.kill(); await gone; };
  await start();
  const api = (method, p, body, s, extra) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));
  // Una cuenta ya adentro; con pro, en el plan pago.
  const signup = async (email, pro) => {
    const code = (await api('POST', '/auth/start', { email })).json.dev_code;
    const v = (await api('POST', '/auth/verify', { email, code })).json;
    if (pro) await api('POST', '/admin/plan', { email, plan: 'pro' }, undefined, { 'x-admin-key': ADMIN });
    return { s: v.session, id: v.account.id, email };
  };

  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
  const outside = []; const errors = [];
  // Un navegador aparte (su propio almacenamiento), en inglés y tema oscuro. Con who, ya con la sesión de esa cuenta.
  const open = async (who, opt) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'en-US', serviceWorkers: 'block' }, opt || {}));
    await ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => { outside.push(r.request().url()); return r.abort(); });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await ctx.addInitScript(([url, w]) => {
      try {
        if (localStorage.getItem('mdtools:settings')) return;
        localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: url }));
        if (w) localStorage.setItem('mdtools:cloud', JSON.stringify({ session: w.s, email: w.email, at: url }));
      } catch (e) { /* una página en blanco no tiene almacenamiento */ }
    }, [base, who || null]);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };
  const noteUrl = (p, edit) => home + '?f=' + encodeURIComponent('cloud/' + p.split('/').map(encodeURIComponent).join('/')) + (edit ? '&edit=1' : '');
  const close = async () => { await browser.close(); site.close(); try { st.proc.kill(); } catch (e) { /* ya no está */ } await sleep(300); try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ } };
  return { origin, home, base, api, signup, open, noteUrl, close, start, stop, outside, errors, log: () => st.log, ADMIN };
}

// Resultados: el mismo formato que el resto de la batería.
export function tally() {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 700))); };
  const done = () => { const bad = results.filter((r) => !r.ok).length; console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron'); return bad; };
  return { check, done, results };
}

// Escribe al final de un párrafo que ya existe (el que contiene has) y deja el cursor ahí.
export async function typeIn(page, has, text, delay) {
  await page.locator('.lmd-article .lmd-editable', { hasText: has }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: delay == null ? 15 : delay });
}
// Saca el foco del bloque sin tocar otro bloque.
export const leave = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
