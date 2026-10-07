// Comentarios para la IA y token limitado a una carpeta, de punta a punta contra un servidor local.
// La IA es un doble: llama al MCP del servidor con un token (list_comments, write_note, resolve_comment) y la app
// tiene que reflejarlo sin recargar. La nube de verdad no se toca: la app apunta al servidor local desde el arranque.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 21000 + Math.floor(Math.random() * 900);
const base = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const outside = [];
await ctx.route((url) => /(^|\.)sync\.sharpmd\.app$/.test(url.hostname), (r) => { outside.push(r.request().url()); return r.abort(); });
const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
const natives = []; app.on('dialog', (d) => { natives.push(d.type()); d.dismiss(); });
const sent = []; app.on('request', (r) => { if (r.url().startsWith(base)) sent.push(r.method() + ' ' + new URL(r.url()).pathname); });
const home = `chrome-extension://${id}/src/app.html`;
const mail = 'ana@ejemplo.test';
const J = (v) => JSON.stringify(v);
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + J(detail))); };
const api = (method, p, body, s, extra) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, s ? { authorization: 'Bearer ' + s } : {}, extra || {}), body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const mcp = (token, name, args) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) }).then((r) => r.json()).then((r) => r.result);
const cloudUrl = (p) => home + '?f=' + encodeURIComponent('cloud/' + p.split('/').map(encodeURIComponent).join('/'));
const notePut = (p, text, s) => api('PUT', '/notes/' + encodeURIComponent(p), { text }, s);
const noteText = async (p, s) => (await api('GET', '/notes/' + encodeURIComponent(p), undefined, s)).json.text;
const said = async (re) => { await app.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 15000 }); return app.textContent('.lmd-foot .lmd-status'); };
const marks = () => app.locator('.lmd-cm-mark').count();
const para = (text) => app.locator('.lmd-article > p', { hasText: text });
const openNote = async (p) => { await app.goto(cloudUrl(p)); await app.waitForSelector('.markdown-body h1'); await app.waitForFunction(() => !!LMD.sync.account()); };
const plain = (t) => !/[!¡—]/.test(t);

const PLAN = '# Plan de lanzamiento\n\nLanzamos el lunes 19 con la reserva desde el teléfono.\n\nEl recordatorio sale por WhatsApp el día anterior.\n\n| Tarea | Quién |\n| --- | --- |\n| Pago de la seña | Sofía |\n\nDespués medimos reservas por día.\n';

try {
  // Entrar por la API y dejar la sesión guardada: la pantalla de inicio no es parte de esta prueba.
  const code = (await api('POST', '/auth/start', { email: mail })).json.dev_code;
  const session = (await api('POST', '/auth/verify', { email: mail, code })).json.session;
  await app.goto(home); await app.waitForSelector('.lmd-home');
  await app.evaluate(([url, s, m]) => new Promise((resolve) => chrome.storage.local.set({ settings: { cloudUrl: url }, cloud: { session: s, email: m } }, resolve)), [base, session, mail]);
  await notePut('proyecto/plan.md', PLAN, session); await notePut('proyecto/docs/notas.md', '# Notas\n\nSueltas.\n', session); await notePut('suelta.md', '# Suelta\n\nFuera de carpetas.\n', session);

  console.log('Comentarios: dónde aparecen');
  await app.evaluate(() => LMD.store.notePut('local.md', '# Local\n\nNota del navegador.'));
  await app.goto(home + '?f=' + encodeURIComponent('local/local.md')); await app.waitForSelector('.markdown-body h1');
  await para('Nota del navegador').click({ button: 'right' }); await app.waitForSelector('.lmd-menu-read');
  check('en una nota que no es de la nube no se ofrece comentar', (await app.locator('.lmd-menu [data-read=comment]').count()) === 0);
  await app.keyboard.press('Escape');

  await openNote('proyecto/plan.md');
  await para('Lanzamos el lunes').click({ button: 'right' }); await app.waitForSelector('.lmd-menu-read [data-read=comment]');
  await app.click('.lmd-menu [data-read=comment]'); await app.waitForSelector('.lmd-plan-why');
  const why = await app.evaluate(() => ({ line: document.querySelector('.lmd-plan-why').textContent, tab: document.querySelector('[data-ptab].lmd-on').dataset.ptab, pop: document.querySelectorAll('.lmd-cm-pop').length }));
  check('en el plan gratis comentar lleva a Ajustes → Plan con una línea que lo explica', why.tab === 'plan' && /comentarios para la IA son parte del plan pago/.test(why.line) && plain(why.line) && why.pop === 0, why);
  check('y el servidor no recibió ningún comentario', !sent.includes('POST /comments'), sent.filter((x) => /comments/.test(x)));
  await app.click('[data-act=close-panel]');
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=comments]');
  check('en el menú de la nube, la lista aparece bloqueada en el plan gratis', await app.evaluate(() => document.querySelector('.lmd-menu [data-s=comments]').classList.contains('lmd-locked')));
  await app.keyboard.press('Escape'); await app.mouse.click(640, 600);

  console.log('Comentarios: dejar uno');
  await api('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  await openNote('proyecto/plan.md');
  await app.waitForFunction(() => LMD.comments.mode() === 'on');
  // Leyendo, sin nada elegido: se cita el bloque.
  await para('Lanzamos el lunes').click({ button: 'right' }); await app.click('.lmd-menu [data-read=comment]'); await app.waitForSelector('.lmd-cm-pop textarea');
  const box = await app.evaluate(() => { const p = document.querySelector('.lmd-cm-pop'); const b = [...document.querySelectorAll('.lmd-article > p')].find((n) => /Lanzamos/.test(n.textContent)).getBoundingClientRect(); const r = p.getBoundingClientRect();
    return { quote: p.querySelector('blockquote').textContent, focus: document.activeElement === p.querySelector('textarea'), under: Math.abs(r.top - b.bottom) < 12 && Math.abs(r.left - b.left) < 4, buttons: [...p.querySelectorAll('button')].map((x) => x.textContent) }; });
  check('el cuadro se abre anclado al bloque, con el texto citado y el campo listo', box.quote === 'Lanzamos el lunes 19 con la reserva desde el teléfono.' && box.focus && box.under && J(box.buttons) === J(['Cancelar', 'Enviar']), box);
  await app.click('.lmd-cm-pop [data-cm=send]');
  check('sin texto no se envía y lo dice', /Escribí qué querés que cambie/.test(await app.textContent('.lmd-cm-pop .lmd-img-err')) && !sent.includes('POST /comments'));
  await app.fill('.lmd-cm-pop textarea', 'Pasalo al martes 20.'); await app.click('.lmd-cm-pop [data-cm=send]');
  await app.waitForSelector('.lmd-cm-mark');
  const first = (await api('GET', '/comments?path=' + encodeURIComponent('proyecto/plan.md'), undefined, session)).json;
  check('enviar lo deja en el servidor con la cita y el pedido', first.length === 1 && first[0].quote === 'Lanzamos el lunes 19 con la reserva desde el teléfono.' && first[0].text === 'Pasalo al martes 20.' && first[0].status === 'open' && (await app.locator('.lmd-cm-pop').count()) === 0, first);
  const mark = await app.evaluate(() => { const m = document.querySelector('.lmd-cm-mark').getBoundingClientRect(); const b = [...document.querySelectorAll('.lmd-article > p')].find((n) => /Lanzamos/.test(n.textContent)).getBoundingClientRect(); const a = document.querySelector('.lmd-article').getBoundingClientRect();
    return { same: Math.abs(m.top - b.top) < 6, margin: m.left > b.right - 60 && m.right <= a.right, n: document.querySelectorAll('.lmd-cm-mark').length }; });
  check('el bloque comentado lleva una marca al margen, a su altura', mark.same && mark.margin && mark.n === 1, mark);

  // Leyendo, con texto elegido: se cita lo elegido.
  const spot = await app.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article > p')].find((n) => /recordatorio/.test(n.textContent)); const t = p.firstChild; const i = t.nodeValue.indexOf('por WhatsApp'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 12); const s = getSelection(); s.removeAllRanges(); s.addRange(r); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  await app.mouse.click(spot[0], spot[1], { button: 'right' }); await app.click('.lmd-menu [data-read=comment]'); await app.waitForSelector('.lmd-cm-pop textarea');
  const pickedQuote = await app.textContent('.lmd-cm-pop blockquote');
  await app.fill('.lmd-cm-pop textarea', 'Mejor por correo.'); await app.keyboard.press('Control+Enter');
  await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-mark').length === 2);
  check('con texto elegido se cita lo elegido, y Ctrl+Enter envía', pickedQuote === 'por WhatsApp' && (await marks()) === 2, pickedQuote);

  // Editando, desde la manija, con cambios sin guardar: primero se guarda la nota. Para que la nota siga sin
  // guardar mientras se comenta, el guardado queda retenido en la red hasta que la prueba lo suelta.
  let release = null; let held = 0; const gate = new Promise((r) => { release = r; });
  await ctx.route(base + '/notes/**', async (r) => { if (r.request().method() !== 'PUT') return r.continue(); held++; await gate; return r.continue(); });
  await app.click('[data-act=mode-edit]'); await app.waitForSelector('.lmd-editing');
  await para('Después medimos').click(); await app.keyboard.press('End'); await app.keyboard.type(' Y cancelaciones.');
  for (let i = 0; i < 60 && !held; i++) await app.waitForTimeout(100); // el guardado automático salió y quedó retenido
  await app.waitForTimeout(600); await app.mouse.move(640, 20);
  await para('Después medimos').hover(); await app.waitForSelector('.lmd-handle:not([hidden])');
  await app.click('.lmd-handle', { timeout: 5000 }); await app.waitForSelector('.lmd-menu [data-op=comment]'); await app.click('.lmd-menu [data-op=comment]'); await app.waitForSelector('.lmd-cm-pop textarea');
  const editQuote = await app.textContent('.lmd-cm-pop blockquote');
  const posts = () => sent.filter((x) => x === 'POST /comments').length; const had = posts();
  await app.fill('.lmd-cm-pop textarea', 'Sumá las llegadas tarde.'); await app.click('.lmd-cm-pop [data-cm=send]');
  await app.waitForTimeout(900);
  const waited = [await app.evaluate(() => document.documentElement.classList.contains('lmd-dirty')), posts() - had, /Y cancelaciones\./.test(await noteText('proyecto/plan.md', session))];
  release(); await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-mark').length === 3);
  await ctx.unroute(base + '/notes/**');
  check('desde la manija del bloque, editando, cita el bloque como quedó', editQuote === 'Después medimos reservas por día. Y cancelaciones.', editQuote);
  check('con cambios sin guardar, el comentario espera a que la nota se guarde', J(waited) === J([true, 0, false]) && posts() - had === 1 && /Y cancelaciones\./.test(await noteText('proyecto/plan.md', session)), [waited, posts() - had]);
  // Clic derecho en edición: la misma opción, dentro de "Este bloque".
  await app.locator('.lmd-article table').click({ button: 'right', position: { x: 30, y: 8 } }); await app.waitForSelector('.lmd-menu [data-op=comment]');
  check('el clic derecho en edición también lo ofrece', (await app.textContent('.lmd-menu [data-op=comment]')) === 'Comentar para la IA');
  await app.keyboard.press('Escape');
  await app.click('[data-act=mode-read]'); await app.waitForFunction(() => !document.documentElement.classList.contains('lmd-editing'));
  await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-mark').length === 3);

  console.log('Comentarios: verlos');
  await app.locator('.lmd-cm-mark').first().click(); await app.waitForSelector('.lmd-cm-pop .lmd-cm-item');
  const seen = await app.evaluate(() => ({ text: document.querySelector('.lmd-cm-pop .lmd-cm-text').textContent, rm: document.querySelector('.lmd-cm-pop [data-cm=rm]').textContent, all: document.querySelector('.lmd-cm-pop [data-cm=all]').textContent }));
  check('al tocar la marca se ve el comentario, con Borrar', seen.text === 'Pasalo al martes 20.' && seen.rm === 'Borrar' && seen.all === 'Ver todos', seen);
  await app.keyboard.press('Escape');
  check('Escape cierra el cuadro', (await app.locator('.lmd-cm-pop').count()) === 0);
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=comments]');
  check('el menú de la nube dice cuántos hay abiertos', (await app.textContent('.lmd-menu [data-s=comments] .lmd-menu-n')) === '3' && !(await app.evaluate(() => document.querySelector('.lmd-menu [data-s=comments]').classList.contains('lmd-locked'))));
  await app.click('.lmd-menu [data-s=comments]'); await app.waitForSelector('.lmd-cm-card li');
  const listed = await app.evaluate(() => ({ groups: [...document.querySelectorAll('.lmd-cm-list h4')].map((h) => h.textContent), items: [...document.querySelectorAll('.lmd-cm-list li .lmd-cm-text')].map((n) => n.textContent), hint: [...document.querySelectorAll('.lmd-cm-card > .lmd-hint')].map((n) => n.textContent) }));
  check('la lista muestra los tres abiertos', J(listed.groups) === J(['Abiertos 3']) && J(listed.items) === J(['Pasalo al martes 20.', 'Mejor por correo.', 'Sumá las llegadas tarde.']), listed);
  check('y una sola línea dice cómo sigue', listed.hint.length === 1 && /La IA conectada los lee cuando le pedís que revise los comentarios\./.test(listed.hint[0]) && plain(listed.hint[0]) && listed.hint[0].length < 90, listed.hint);

  console.log('Comentarios: la IA los lee y los resuelve');
  const token = (await api('POST', '/tokens', { name: 'IA' }, session)).json.token;
  const forAi = JSON.parse((await mcp(token, 'list_comments', { path: 'proyecto/plan.md' })).content[0].text);
  check('la IA los lee con list_comments', forAi.length === 3 && forAi[0].quote === 'Lanzamos el lunes 19 con la reserva desde el teléfono.' && forAi[0].comment === 'Pasalo al martes 20.' && forAi[1].quote === 'por WhatsApp', forAi);
  const now = await noteText('proyecto/plan.md', session);
  await mcp(token, 'write_note', { path: 'proyecto/plan.md', text: now.replace('Lanzamos el lunes 19', 'Lanzamos el martes 20') });
  await mcp(token, 'resolve_comment', { id: forAi[0].id, reply: 'Listo: el lanzamiento pasó al martes 20.' });
  // La lista quedó abierta: se tiene que actualizar sola, igual que la nota y las marcas.
  await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-list .lmd-cm-done').length === 1, null, { timeout: 15000 });
  const live = await app.evaluate(() => ({ groups: [...document.querySelectorAll('.lmd-cm-list h4')].map((h) => h.textContent), reply: document.querySelector('.lmd-cm-done .lmd-cm-reply').textContent, when: document.querySelector('.lmd-cm-done .lmd-cm-meta small').textContent,
    order: [...document.querySelectorAll('.lmd-cm-list li')].map((li) => li.classList.contains('lmd-cm-done')), note: document.querySelector('.lmd-article').textContent, marks: document.querySelectorAll('.lmd-cm-mark').length, flash: document.querySelector('.lmd-foot .lmd-status').textContent }));
  check('al resolverlo la IA, la lista lo pasa a resueltos con su respuesta y la fecha, sin recargar', J(live.groups) === J(['Abiertos 2', 'Resueltos 1']) && /Respuesta de la IA/.test(live.reply) && /Listo: el lanzamiento pasó al martes 20\./.test(live.reply) && /^Resuelto el \d/.test(live.when) && J(live.order) === J([false, false, true]), live);
  check('la nota muestra lo que escribió la IA y la marca de ese bloque se va', /Lanzamos el martes 20/.test(live.note) && live.marks === 2, [live.marks, live.note.slice(0, 80)]);
  check('un aviso corto dice que la IA resolvió un comentario', live.flash === 'La IA resolvió un comentario', live.flash);
  await app.click('.lmd-cm-card [data-cm=close]');

  // La IA cambia el texto citado sin resolver el comentario: queda en la lista, sin marca.
  await mcp(token, 'write_note', { path: 'proyecto/plan.md', text: (await noteText('proyecto/plan.md', session)).replace('sale por WhatsApp el', 'sale por correo el') });
  await app.waitForFunction(() => /sale por correo/.test(document.querySelector('.lmd-article').textContent), null, { timeout: 25000 });
  await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-mark').length === 1);
  await app.evaluate(() => LMD.comments.list()); await app.waitForSelector('.lmd-cm-card li');
  const gone = await app.evaluate(() => [...document.querySelectorAll('.lmd-cm-list li:not(.lmd-cm-done)')].map((li) => [li.querySelector('.lmd-cm-text').textContent, li.querySelector('.lmd-cm-quote').tagName, li.querySelector('.lmd-cm-meta small').textContent]));
  check('si el texto citado ya no está, el comentario sigue en la lista, sin marca', gone.length === 2 && gone[0][0] === 'Mejor por correo.' && gone[0][1] === 'BLOCKQUOTE' && /ya no está en la nota/.test(gone[0][2]) && gone[1][1] === 'BUTTON' && !/ya no está/.test(gone[1][2]), gone);
  // La cita lleva al bloque.
  await app.click('.lmd-cm-list button.lmd-cm-quote');
  check('tocar la cita cierra la lista y señala el bloque', (await app.locator('.lmd-cm-card').count()) === 0 && (await app.evaluate(() => /Después medimos/.test((document.querySelector('.lmd-cm-here') || {}).textContent || ''))));
  await app.evaluate(() => LMD.comments.list()); await app.waitForSelector('.lmd-cm-card li');
  await app.click('.lmd-cm-list li:not(.lmd-cm-done) [data-cm=rm]');
  await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-list li:not(.lmd-cm-done)').length === 1);
  const left = (await api('GET', '/comments?path=' + encodeURIComponent('proyecto/plan.md') + '&all=1', undefined, session)).json.map((c) => [c.text, c.status]);
  check('Borrar lo saca de la lista y del servidor', J(left) === J([['Pasalo al martes 20.', 'done'], ['Sumá las llegadas tarde.', 'open']]), left);
  await app.click('.lmd-cm-card [data-cm=close]');

  console.log('Comentarios: cambiar de nota sin recargar');
  const swap = await app.evaluate(async () => {
    const out = [document.querySelectorAll('.lmd-cm-mark').length];
    LMD.comments.detach(); out.push(document.querySelectorAll('.lmd-cm-mark').length, LMD.comments.mode(), LMD.comments.count());
    await LMD.comments.attach('proyecto/docs/notas.md'); out.push(document.querySelectorAll('.lmd-cm-mark').length, LMD.comments.mode());
    await LMD.comments.attach('proyecto/plan.md'); out.push(document.querySelectorAll('.lmd-cm-mark').length, LMD.comments.count());
    return out;
  });
  check('detach suelta las marcas y la lista; attach las arma para la nota que se le pasa', J(swap) === J([1, 0, '', 0, 0, 'on', 1, 1]), swap);
  // Un evento que llega para la nota anterior después de soltarla no revive nada.
  const stale = await app.evaluate(async () => { LMD.comments.detach(); await LMD.comments.onEvent({ type: 'comments' }); const n = document.querySelectorAll('.lmd-cm-mark').length; await LMD.comments.attach('proyecto/plan.md'); return n; });
  check('un evento que llega con la nota ya soltada no dibuja nada', stale === 0, stale);

  console.log('Token limitado a una carpeta');
  await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=ai]'); await app.waitForSelector('[data-acct=ai] [data-c=folder]');
  const pick = await app.evaluate(() => ({ label: document.querySelector('[data-acct=ai] .lmd-pick span').textContent, options: [...document.querySelectorAll('[data-c=folder] option')].map((o) => [o.value, o.textContent]), chosen: document.querySelector('[data-c=folder]').value, list: [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent) }));
  check('el selector lista las carpetas de la nube, con todas las notas por defecto', pick.label === 'Carpeta' && J(pick.options) === J([['', 'Todas las notas'], ['proyecto', 'proyecto/'], ['proyecto/docs', 'proyecto/docs/']]) && pick.chosen === '', pick);
  check('un token sin carpeta figura con todas las notas', pick.list.length === 1 && /^IA · Todas las notas · creado el /.test(pick.list[0]), pick.list);
  await app.selectOption('[data-c=folder]', 'proyecto/docs'); await app.click('[data-acct=ai] [data-c=token]'); await app.waitForSelector('.lmd-ai-new');
  const made = await app.evaluate(() => ({ fields: [...document.querySelectorAll('[data-acct=ai] .lmd-field')].map((f) => [f.querySelector('span').textContent, f.querySelector('input').value]), list: [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent) }));
  const scoped = made.fields[1][1];
  check('la lista dice a qué carpeta alcanza cada token', made.list.length === 2 && /^IA · Carpeta proyecto\/docs\/ · creado el /.test(made.list[0]) && /^IA · Todas las notas · /.test(made.list[1]), made.list);
  check('el comando para copiar es el de siempre', made.fields[2][0] === 'Claude Code' && made.fields[2][1] === 'claude mcp add --transport http sharpmd ' + base + '/mcp --header "Authorization: Bearer ' + scoped + '"', made.fields[2]);
  const inside = JSON.parse((await mcp(scoped, 'list_notes')).content[0].text).map((n) => n.path);
  const out = await mcp(scoped, 'read_note', { path: 'proyecto/plan.md' });
  check('ese token solo ve su carpeta', J(inside) === J(['proyecto/docs/notas.md']) && out.isError === true && /only reaches the folder proyecto\/docs\//.test(out.content[0].text), [inside, out]);
  await app.click('[data-act=close-panel]');

  check('nada usó prompt, alert ni confirm del navegador', natives.length === 0, natives);
  check('nada salió hacia el servidor de producción', outside.length === 0, outside);
  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { check('la prueba corrió hasta el final', false, String(e && e.stack || e).split('\n').slice(0, 4)); }

const bad = results.filter((r) => !r).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
