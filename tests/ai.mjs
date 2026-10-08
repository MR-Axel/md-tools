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
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base, AI_SEEN_MS: '4000', AI_WROTE_MS: '6000', AI_WRITING_MS: '2500' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  // Los comentarios para la IA van con el MCP, que está en todos los planes: en el gratis se comenta igual.
  await app.click('.lmd-menu [data-read=comment]'); await app.waitForSelector('.lmd-cm-pop textarea');
  const freeCm = await app.evaluate(() => ({ pop: document.querySelectorAll('.lmd-cm-pop').length, why: document.querySelectorAll('.lmd-plan-why').length, mode: LMD.comments.mode(), plan: LMD.sync.account().plan }));
  check('en el plan gratis comentar abre el cuadro del comentario, sin pasar por Plan', freeCm.plan === 'free' && freeCm.pop === 1 && freeCm.why === 0 && freeCm.mode === 'on', freeCm);
  await app.fill('.lmd-cm-pop textarea', 'Decilo más corto.'); await app.click('.lmd-cm-pop [data-cm=send]'); await app.waitForFunction(() => document.querySelectorAll('.lmd-cm-mark').length === 1);
  const freeSent = (await api('GET', '/comments', undefined, session)).json;
  check('y el comentario llega al servidor', sent.includes('POST /comments') && freeSent.length === 1 && freeSent[0].text === 'Decilo más corto.', freeSent);
  await api('DELETE', '/comments/' + freeSent[0].id, undefined, session);
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i] === 'POST /comments') sent.splice(i, 1); // lo que sigue mira los envíos desde acá
  await app.click('.lmd-sync'); await app.waitForSelector('.lmd-menu [data-s=comments]');
  check('en el menú de la nube, ni los comentarios ni conectar una IA aparecen bloqueados en el plan gratis', await app.evaluate(() => !document.querySelector('.lmd-menu [data-s=comments]').classList.contains('lmd-locked') && !document.querySelector('.lmd-menu [data-s=ai]').classList.contains('lmd-locked')));
  await app.keyboard.press('Escape'); await app.mouse.click(640, 600);

  console.log('Conectar una IA en el plan gratis');
  await app.click('[data-act=settings]'); await app.waitForSelector('.lmd-panel-card'); await app.click('[data-ptab=ai]'); await app.waitForSelector('[data-acct=ai] [data-c=token]');
  const freePane = await app.evaluate(() => { const b = document.querySelector('[data-acct=ai]'); return { text: b.textContent, url: (b.querySelector('.lmd-field input') || {}).value, plans: b.querySelectorAll('[data-c=plans]').length, locked: b.querySelectorAll('.lmd-locked, .lmd-extra').length, share: b.querySelectorAll('[data-c=share]').length }; });
  check('Ajustes, IA (MCP): sin aviso del plan ni candado, con la dirección y el botón para crear un token', freePane.url === base + '/mcp' && freePane.plans === 0 && freePane.locked === 0 && !/plan pago/i.test(freePane.text) && /En el plan gratis tu IA trabaja con las 10 notas de tu nube\./.test(freePane.text) && plain(freePane.text), freePane);
  check('compartir no se ofrece al crear el token: sigue siendo del plan pago', freePane.share === 0, freePane.share);
  await app.evaluate(() => { window.__freeCopied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t) => { window.__freeCopied.push(t); } }); });
  await app.click('[data-acct=ai] [data-c=token]'); await app.waitForSelector('.lmd-ai-new');
  const freeTok = await app.evaluate(() => [...document.querySelectorAll('[data-acct=ai] .lmd-field')].find((f) => f.querySelector('span').textContent === 'Token').querySelector('input').value);
  await app.click('[data-acct=ai] [data-c=brief]'); await app.waitForFunction(() => window.__freeCopied.length === 1);
  const freeBrief = await app.evaluate(() => window.__freeCopied[0]); const freeSay = await app.textContent('[data-acct=ai] .lmd-acct-msg');
  check('la cuenta gratis crea el token y copia las instrucciones para su IA', /^mdt_/.test(freeTok) && freeBrief.includes(freeTok) && freeBrief.includes(base + '/mcp') && freeSay === 'Instrucciones copiadas. Pegalas en tu IA.', [freeTok.slice(0, 6), freeBrief.slice(0, 200), freeSay]);
  const freeList = JSON.parse((await mcp(freeTok, 'list_notes')).content[0].text).map((n) => n.path).sort();
  const freeWrite = await mcp(freeTok, 'write_note', { path: 'ia/gratis.md', text: '# De la IA\n' });
  check('con ese token la IA lee y escribe las notas de la cuenta gratis', J(freeList) === J(['proyecto/docs/notas.md', 'proyecto/plan.md', 'suelta.md']) && freeWrite.isError !== true && (await noteText('ia/gratis.md', session)) === '# De la IA\n', [freeList, freeWrite]);
  for (let i = 0; i < 6; i++) await notePut('relleno/' + i + '.md', 'x', session);
  const freeFull = await mcp(freeTok, 'write_note', { path: 'ia/una-mas.md', text: 'x' }); const freeEdit = await mcp(freeTok, 'append_note', { path: 'ia/gratis.md', text: 'Otra línea.' });
  check('en el tope de 10 notas la herramienta dice por qué, en inglés, y las que ya están se siguen editando', freeFull.isError === true && /free plan holds 10 notes/.test(freeFull.content[0].text) && /paid plan/.test(freeFull.content[0].text) && plain(freeFull.content[0].text) && !/[áéíóúñ]/.test(freeFull.content[0].text) && freeEdit.isError !== true && (await api('GET', '/notes', undefined, session)).json.length === 10, [freeFull, freeEdit]);
  const freeApi = await fetch(base + '/api/v1/notes', { headers: { authorization: 'Bearer ' + freeTok } });
  check('y ese mismo token no abre la API, que sigue siendo del plan pago', freeApi.status === 402 && (await freeApi.json()).error.code === 'api_needs_plan');
  for (let i = 0; i < 6; i++) await api('DELETE', '/notes/' + encodeURIComponent('relleno/' + i + '.md'), undefined, session);
  await api('DELETE', '/notes/' + encodeURIComponent('ia/gratis.md'), undefined, session);
  for (const t of (await api('GET', '/tokens', undefined, session)).json) await api('DELETE', '/tokens/' + t.id, undefined, session);
  await app.click('[data-act=close-panel]');

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
  const made = await app.evaluate(() => ({ fields: [...document.querySelectorAll('[data-acct=ai] .lmd-field')].map((f) => [f.querySelector('span').textContent, f.querySelector('input, textarea').value]), list: [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent) }));
  const scoped = made.fields[1][1];
  check('la lista dice a qué carpeta alcanza cada token', made.list.length === 2 && /^IA · Carpeta proyecto\/docs\/ · creado el /.test(made.list[0]) && /^IA · Todas las notas · /.test(made.list[1]), made.list);
  check('el comando para copiar es el de siempre', made.fields[2][0] === 'Claude Code' && made.fields[2][1] === 'claude mcp add --transport http sharpmd ' + base + '/mcp --header "Authorization: Bearer ' + scoped + '"', made.fields[2]);
  const cmd = await app.evaluate(() => { const t = document.querySelector('[data-acct=ai] .lmd-field-long textarea'); return t && { tag: t.tagName, cut: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 2, lines: Math.round(t.clientHeight / parseFloat(getComputedStyle(t).lineHeight)), copy: !!t.parentNode.querySelector('[data-c=copy]') }; });
  check('el comando se ve entero, en varios renglones, con su botón de copiar', !!cmd && cmd.tag === 'TEXTAREA' && !cmd.cut && cmd.lines >= 2 && cmd.copy, cmd);
  // Un token con el nombre de siempre en el otro idioma ("AI") se lista en el idioma de la app.
  const sess = await app.evaluate(() => new Promise((r) => chrome.storage.local.get('cloud', (x) => r(x.cloud.session))));
  await fetch(base + '/tokens', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess }, body: JSON.stringify({ name: 'AI' }) });
  await app.click('[data-ptab=cloud]'); await app.click('[data-ptab=ai]'); await app.waitForFunction(() => document.querySelectorAll('.lmd-tokens li').length === 3);
  const names = await app.evaluate(() => [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent.split(' · ')[0]));
  check('el nombre por defecto de un token sale en el idioma de la app', J(names) === J(['IA', 'IA', 'IA']), names);
  const inside = JSON.parse((await mcp(scoped, 'list_notes')).content[0].text).map((n) => n.path);
  const out = await mcp(scoped, 'read_note', { path: 'proyecto/plan.md' });
  check('ese token solo ve su carpeta', J(inside) === J(['proyecto/docs/notas.md']) && out.isError === true && /only reaches the folder proyecto\/docs\//.test(out.content[0].text), [inside, out]);
  console.log('Instrucciones para la IA');
  // Lo que se copia se junta acá: el portapapeles de verdad no hace falta para saber qué texto salió.
  await app.evaluate(() => { window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t) => { window.__copied.push(t); } }); });
  const copied = () => app.evaluate(() => window.__copied[window.__copied.length - 1] || '');
  const english = (t) => /^You are being connected to SharpMD/.test(t) && !/[áéíóúñ¿¡]/i.test(t) && !/\b(para|notas|carpeta|compartir|enlace|token recién)\b/i.test(t);
  const sober = (t) => !/[!¡—–]/.test(t);
  await app.locator('.lmd-tokens li', { hasText: 'Carpeta proyecto/docs/' }).locator('[data-brief]').click();
  await app.waitForFunction(() => window.__copied.length === 1);
  const old = await copied(); const oldSay = await app.textContent('[data-acct=ai] .lmd-acct-msg');
  check('de un token viejo, las instrucciones salen en inglés con la app en español, con la URL del servidor y un marcador en lugar del token', (await app.evaluate(() => LMD.lang())) === 'es' && english(old) && sober(old) && old.includes('- URL: ' + base + '/mcp') && old.includes('- Header: Authorization: Bearer PASTE_YOUR_TOKEN') && !/mdt_/.test(old), old.slice(0, 400));
  check('dicen a qué carpeta alcanza el token, y que para compartir hay que pedírselo a la persona', old.includes('This token only reaches the folder proyecto/docs/.') && /This token cannot share notes or create public links\. If I want that, tell me to do it from the SharpMD app/.test(old) && !/share_note|create_public_link/.test(old), old.slice(-900));
  check('y la interfaz avisa que falta poner el token', /Reemplazá PASTE_YOUR_TOKEN por tu token/.test(oldSay) && plain(oldSay), oldSay);

  const box0 = await app.evaluate(() => { const c = document.querySelector('[data-acct=ai] [data-c=share]'); return { off: !c.checked, label: c.closest('label').textContent }; });
  await app.selectOption('[data-c=folder]', ''); await app.check('[data-acct=ai] [data-c=share]'); await app.click('[data-acct=ai] [data-c=token]'); await app.waitForSelector('.lmd-ai-new');
  const fresh = await app.evaluate(() => ({ token: [...document.querySelectorAll('[data-acct=ai] .lmd-field')].find((f) => f.querySelector('span').textContent === 'Token').querySelector('input').value, button: document.querySelector('[data-acct=ai] [data-c=brief]').textContent,
    rows: [...document.querySelectorAll('.lmd-tokens li span')].map((s) => s.textContent), reset: !document.querySelector('[data-acct=ai] [data-c=share]').checked, acts: [...document.querySelector('.lmd-tokens li').querySelectorAll('button')].map((b) => b.textContent) }));
  check('el permiso de compartir se elige al crear el token, apagado por defecto, y la lista lo muestra', box0.off && box0.label === 'Puede compartir y crear enlaces' && fresh.rows.length === 4 && / · puede compartir$/.test(fresh.rows[0]) && fresh.rows.slice(1).every((r) => !/puede compartir/.test(r)) && fresh.reset && J(fresh.acts) === J(['Instrucciones', 'Revocar']), [box0, fresh.rows, fresh.acts]);
  await app.click('[data-acct=ai] [data-c=brief]'); await app.waitForFunction(() => window.__copied.length === 2);
  const msg = await copied(); let block = {}; try { block = JSON.parse((/\x60\x60\x60json\n([\s\S]*?)\n\x60\x60\x60/.exec(msg) || [])[1]); } catch (e) { /* queda vacío y la prueba falla */ }
  check('con el token recién creado, el botón copia el mensaje listo: URL, cabecera, comando de Claude Code y bloque mcpServers', fresh.button === 'Copiar instrucciones para tu IA' && english(msg) && sober(msg) && !msg.includes('PASTE_YOUR_TOKEN') && msg.includes('- URL: ' + base + '/mcp') && msg.includes('- Header: Authorization: Bearer ' + fresh.token) && msg.includes('claude mcp add --transport http sharpmd ' + base + '/mcp --header "Authorization: Bearer ' + fresh.token + '"') && !!block.mcpServers && block.mcpServers.sharpmd.url === base + '/mcp' && block.mcpServers.sharpmd.headers.Authorization === 'Bearer ' + fresh.token && !/only reaches the folder/.test(msg), [msg.slice(0, 300), block]);
  const promised = ['list_notes', 'append_note', 'read_note', 'write_note', 'list_comments', 'resolve_comment', '\x60\x60\x60mermaid', 'Tables to compare', 'Task lists', 'Collapsible sections for steps and long detail', '::: details Title', '::: tip', '::: warning', 'LaTeX', 'language name', 'frontmatter', 'One note per topic', 'local .md file', 'Who should it be shared with', 'public link', 'password', 'Give me that link', 'SharpMD extension', 'https://sharpmd.app/src/app.html', '](https://sharpmd.app/src/app.html#open=file%3A%2F%2F%2FC%3A%2FUsers%2Fme%2FDesktop%2Fnotes.md)', '](https://sharpmd.app/src/app.html#open=file%3A%2F%2F%2FUsers%2Fme%2FDesktop%2Fnotes.md)', 'encodeURIComponent', 'full path of the file as plain text'].filter((x) => !msg.includes(x)).concat(/\]\(file:/.test(msg) ? ['un enlace file:// que no se puede cliquear'] : []);
  check('el mensaje dice para qué usarlo, cómo escribir, qué preguntar antes y qué entregar al terminar', promised.length === 0, promised);
  const memory = (/## Use it as project memory\n\n([\s\S]*?)\n\n## /.exec(msg) || [])[1] || '';
  check('trae la sección de memoria del proyecto: leer antes de empezar, una nota índice por proyecto y sumar notas para la próxima sesión', memory.split('\n').length === 3 && /Before you start a task, call search_notes and read the notes of the project/.test(memory) && /architecture/.test(memory) && /decisions/.test(memory) && /conventions/.test(memory) && memory.includes('project/README.md') && /link/.test(memory) && /Claude, Codex or another agent/.test(memory) && sober(memory), memory);
  check('con un token limitado a una carpeta, la nota índice va en esa carpeta', old.includes('proyecto/docs/README.md') && !old.includes('project/README.md'));
  // Las dos secciones del espacio de proyecto: documentar y llevar el tablero.
  const sect = (t, name) => (new RegExp('## ' + name + '\\n\\n([\\s\\S]*?)\\n\\n## ').exec(t) || [])[1] || '';
  const docs = sect(msg, 'Document the project'); const brd = sect(msg, 'Keep a task board');
  check('trae la sección para documentar el proyecto: la estructura fija, leer antes lo que hay, enlaces relativos y mantenerlo al día', ['README.md', 'architecture.md', 'Mermaid', 'features/', 'acceptance criteria', 'epics.md', 'decisions.md', 'log.md', 'first session', 'Search and read what already exists', 'relative paths', 'keep them current', 'ask me once'].every((x) => docs.includes(x)) && sober(docs), docs);
  check('y la del tablero: las cuatro columnas, una tarjeta por tarea con su agente, qué necesita al pausar, el enlace al terminar, y las herramientas de tablero', ['<project>/board.md', 'To do, In progress, Paused and Done', 'create_board', 'add_card', 'move_card', 'update_card', 'Do not rewrite its Markdown by hand', 'field agent', 'subagent', 'field needs', 'tell me', 'field link', 'One card per task', 'finished cards stay', 'each one moves its own card'].every((x) => brd.includes(x)) && sober(brd), brd);
  // La lista de lo que le toca a la persona: aparte del tablero, que es de las tareas del agente.
  const todo = sect(msg, 'Keep a list of what I have to do');
  check('y la de lo que le toca a la persona: pending.md, una línea por punto con sus pasos plegados, enlaces directos, costos, sin inventar rutas ni pedir secretos por chat', ['The board is for your tasks', '<project>/pending.md', '- [ ] and - [x]', 'grouped by topic', 'the most urgent first', 'One short line per item', '::: details Steps', 'Number the steps', 'the direct link to the exact page where it is done', 'not "go to the console"', 'what I have to bring back and where to leave it', 'how much and where it is paid', 'ask me for a screenshot', 'Do not invent it', 'Never ask me for a secret in the chat', 'the file or the screen where I enter it', 'Tick an item as soon as you learn it is done', 'a section Decided, with the date', 'go on the board, or marked as yours', 'Link the note from the README', 'at the end of every session tell me what is left for me'].every((x) => todo.includes(x)) && todo.split('\n').filter((l) => /^- /.test(l)).length === 9 && sober(todo), todo);
  check('y cierra las tres diciendo que se hacen sin que se lo pidan, con la guía y la salida a archivos locales', ['Do all three without being asked', 'get_guide', 'the format of pending.md', 'cannot write', 'local .md files', '"When you finish" says'].every((x) => todo.includes(x)), todo.slice(-400));
  check('con un token limitado a una carpeta, pending.md va en esa carpeta', old.includes('proyecto/docs/pending.md'));
  check('con un token limitado a una carpeta, esa carpeta es la del proyecto y el tablero va ahí', old.includes('The project folder is proyecto/docs/, the one this token reaches.') && old.includes('proyecto/docs/board.md') && !old.includes('<project>') && !old.includes('ask me once'), sect(old, 'Document the project'));
  const words = msg.split(/\s+/).filter(Boolean).length;
  check('el mensaje completo sigue siendo corto: menos de 1250 palabras', words < 1250, words);
  check('y con el permiso, que puede compartir y crear enlaces solo cuando se lo piden', /share_note/.test(msg) && /create_public_link/.test(msg) && /only when I ask/.test(msg) && !/cannot share/.test(msg));
  await app.locator('.lmd-tokens li').first().locator('[data-brief]').click(); await app.waitForFunction(() => window.__copied.length === 3);
  const again = await copied(); const saySent = await app.textContent('[data-acct=ai] .lmd-acct-msg');
  check('desde la lista, mientras ese token sigue a la vista, sale igual', again === msg && saySent === 'Instrucciones copiadas. Pegalas en tu IA.', saySent);
  const own = await app.evaluate(() => LMD.sync.aiBrief({ url: 'https://notas.ejemplo.test/mcp', token: 'mdt_EXAMPLE', scope: '', share: false }));
  check('con un servidor propio, el mensaje lleva la dirección de ese servidor', own.includes('- URL: https://notas.ejemplo.test/mcp') && own.includes('"url": "https://notas.ejemplo.test/mcp"') && own.includes('sharpmd https://notas.ejemplo.test/mcp --header "Authorization: Bearer mdt_EXAMPLE"') && !own.includes('sync.sharpmd.app') && !own.includes(base), own.slice(0, 300));
  // El interruptor del espacio de proyecto, junto al botón: prendido por defecto, y apagado saca esas dos secciones.
  const wsUi = await app.evaluate(() => { const c = document.querySelector('[data-acct=ai] [data-c=ws]'); const b = document.querySelector('[data-acct=ai] [data-c=brief]'); const h = c.closest('label').previousElementSibling; return { n: document.querySelectorAll('[data-acct=ai] [data-c=ws]').length, on: c.checked, label: c.closest('label').textContent, hint: h.textContent, after: !!(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING), near: c.getBoundingClientRect().top - b.getBoundingClientRect().bottom }; });
  check('junto al botón, una línea dice qué va a hacer la IA y un interruptor prendido incluye el espacio de proyecto', wsUi.n === 1 && wsUi.on && wsUi.label === 'Incluir las instrucciones del espacio de proyecto' && wsUi.hint === 'Con ese mensaje, tu IA documenta el proyecto y lleva un tablero de tareas en SharpMD.' && plain(wsUi.hint) && wsUi.after && wsUi.near < 90, wsUi);
  await app.click('[data-acct=ai] .lmd-ai-ws'); const before = await app.evaluate(() => window.__copied.length);
  await app.click('[data-acct=ai] [data-c=brief]'); await app.waitForFunction((n) => window.__copied.length === n + 1, before);
  const short = await copied();
  check('apagado, el mensaje sale corto: sin las dos secciones y con todo lo demás igual', !(await app.evaluate(() => document.querySelector('[data-acct=ai] [data-c=ws]').checked)) && !/## Document the project|## Keep a task board|## Keep a list of what I have to do|pending\.md|get_guide|create_board/.test(short) && short.length < msg.length && english(short) && sober(short) && ['## Connect', '## What to use it for', '## Use it as project memory', '## How to write', '## Before you create a document', '## When you finish', 'Treat the token as a secret'].every((x) => short.includes(x)) && short === msg.replace(/\n## Document the project[\s\S]*?(?=\n## How to write)/, ''), [short.length, msg.length]);
  await app.click('[data-acct=ai] .lmd-ai-ws'); await app.locator('.lmd-tokens li').first().locator('[data-brief]').click(); await app.waitForFunction((n) => window.__copied.length === n + 2, before);
  check('y prendido de nuevo vuelve a salir completo, también desde la lista', (await copied()) === msg);
  const lone = await app.evaluate(() => [LMD.sync.aiBrief({ url: 'https://notas.ejemplo.test/mcp', token: 'mdt_EXAMPLE', scope: '', share: false, workspace: false }), LMD.sync.aiBrief({ url: 'https://notas.ejemplo.test/mcp', token: 'mdt_EXAMPLE', scope: '', share: false })].map((t) => /## Keep a task board/.test(t)));
  check('aiBrief incluye el espacio de proyecto salvo que se le pida que no', J(lone) === J([false, true]), lone);
  const toolNames = (await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fresh.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json())).result.tools.map((x) => x.name);
  const scopedNames = (await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + scoped }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json())).result.tools.map((x) => x.name);
  check('el token creado con el permiso tiene las herramientas de compartir; el otro, no', toolNames.includes('share_note') && toolNames.includes('create_public_link') && !scopedNames.some((x) => /share|link/.test(x)), [toolNames, scopedNames]);
  const guideText = (await mcp(fresh.token, 'get_guide')).content[0].text; const scopedGuide = (await mcp(scoped, 'get_guide')).content[0].text;
  check('las herramientas que nombra el mensaje existen en el servidor, y la guía que manda leer repite su estructura', ['get_guide', 'create_board', 'add_card', 'move_card', 'update_card', 'list_boards'].every((x) => toolNames.includes(x) && scopedNames.includes(x)) && ['README.md', 'architecture.md', 'features/', 'epics.md', 'decisions.md', 'log.md', 'board.md', 'To do, In progress, Paused and Done', 'agent', 'needs', 'link', 'pending.md', '::: details Steps', 'screenshot', 'Decided'].every((x) => guideText.includes(x) && msg.includes(x)) && sober(guideText), guideText.slice(0, 300));
  check('con un token limitado a una carpeta, la guía pone la estructura en esa carpeta', scopedGuide.includes('This token only reaches proyecto/docs/, so that folder is the project folder.') && scopedGuide.includes('proyecto/docs/board.md') && scopedGuide.includes('proyecto/docs/pending.md') && !scopedGuide.includes('<project>'), scopedGuide.slice(0, 500));
  const agentBoard = JSON.parse((await mcp(scoped, 'create_board', { path: 'proyecto/docs/board.md' })).content[0].text); const agentCard = JSON.parse((await mcp(scoped, 'add_card', { path: 'proyecto/docs/board.md', title: 'Document the sign-in', fields: { agent: 'claude' } })).content[0].text);
  const agentOut = await mcp(scoped, 'create_board', { path: 'proyecto/board.md' });
  check('y ese token arma el tablero y carga una tarjeta en su carpeta, no afuera', agentBoard.columns.join() === 'To do,In progress,Paused,Done' && agentCard.card.column === 'To do' && agentCard.card.fields.agent === 'claude' && /cloud%2Fproyecto%2Fdocs%2Fboard\.md$/.test(agentCard.url) && agentOut.isError === true && /only reaches the folder proyecto\/docs\//.test(agentOut.content[0].text), [agentBoard, agentCard, agentOut]);

  console.log('El enlace que devuelve la IA');
  const WEB = 'https://sharpmd.app/src/app.html';
  const wrote = (await mcp(fresh.token, 'write_note', { path: 'proyecto/informe final.md', text: '# Informe\n\nListo para leer.\n' })).content[0].text;
  const link = (/Open it: (\S+)$/.exec(wrote) || [])[1] || '';
  check('write_note devuelve la dirección para abrir la nota, con el formato de la app', link === WEB + '?f=' + encodeURIComponent('cloud/proyecto/' + encodeURIComponent('informe final.md')) && home + link.slice(WEB.length) === cloudUrl('proyecto/informe final.md'), wrote);
  const pub = JSON.parse((await mcp(fresh.token, 'create_public_link', { path: 'proyecto/informe final.md' })).content[0].text);
  await app.click('[data-act=close-panel]');
  await app.goto(home + link.slice(WEB.length)); await app.waitForSelector('.lmd-article h1');
  check('con la sesión iniciada, esa dirección abre la nota', /Informe/.test(await app.textContent('.lmd-article h1')) && /Listo para leer/.test(await app.textContent('.lmd-article')));

  console.log('Espacio de proyecto: la plantilla y la IA sobre el mismo tablero');
  // Sin una IA: la plantilla crea en la nube la carpeta con la misma estructura que arma un agente.
  await app.evaluate(() => { LMD.extras.fromTemplate(''); }); await app.waitForSelector('.lmd-tpl-card');
  await app.click('.lmd-tpl-list [data-id=workspace]'); await app.click('[data-tpl=ok]'); await app.waitForSelector('.lmd-dlg input');
  await app.fill('.lmd-dlg input', 'tienda'); await app.keyboard.press('Enter');
  await app.waitForFunction(() => document.title === 'README.md' && /Nombre del proyecto/.test((document.querySelector('.markdown-body h1') || {}).textContent || ''), null, { timeout: 15000 });
  const wsNotes = (await api('GET', '/notes', undefined, await app.evaluate(() => new Promise((r) => chrome.storage.local.get('cloud', (x) => r(x.cloud.session)))))).json.map((n) => n.path).filter((p) => p.startsWith('tienda/')).sort();
  check('la plantilla Espacio de proyecto crea la carpeta en la nube con sus siete notas y abre el índice', J(wsNotes) === J(['tienda/README.md', 'tienda/architecture.md', 'tienda/board.md', 'tienda/decisions.md', 'tienda/epics.md', 'tienda/features/funcion-de-ejemplo.md', 'tienda/log.md']) && new URL(app.url()).searchParams.get('f') === 'cloud/tienda/README.md', [wsNotes, app.url()]);
  // Con una IA: el agente encuentra ese tablero, con sus columnas en el idioma de la persona, y mueve la tarjeta.
  const tb = JSON.parse((await mcp(fresh.token, 'list_boards', { path: 'tienda/board.md' })).content[0].text);
  const tbFirst = tb.boards[0].columns[0].cards[0];
  const tbMoved = JSON.parse((await mcp(fresh.token, 'move_card', { path: 'tienda/board.md', id: tbFirst.id, column: tb.boards[0].done_column })).content[0].text);
  check('la IA lee ese tablero con list_boards (cuatro columnas, la de hechas) y mueve su tarjeta de ejemplo, que queda hecha', tb.boards.length === 1 && J(tb.boards[0].columns.map((c) => c.column)) === J(['Por hacer', 'En curso', 'En pausa', 'Hecho']) && tb.boards[0].done_column === 'Hecho' && tbFirst.title === 'Tarea de ejemplo' && tbFirst.fields.agent === 'yo' && tbMoved.card.column === 'Hecho' && tbMoved.card.done === true && /^[a-z2-9]{8}$/.test(tbMoved.card.id) && /cloud%2Ftienda%2Fboard\.md$/.test(tbMoved.url), [tb, tbMoved]);
  await app.goto(home + tbMoved.url.slice(WEB.length)); await app.waitForSelector('.lmd-article h1');
  const shownBoard = await app.evaluate(() => ({ text: document.querySelector('.lmd-article').textContent, cols: [...document.querySelectorAll('.lmd-article .lmd-board-col, .lmd-article [data-col]')].length }));
  check('y la persona lo ve en la app: la tarjeta está en Hecho', /Hecho[\s\S]*Tarea de ejemplo/.test(shownBoard.text) && !/Por hacer[\s\S]*Tarea de ejemplo[\s\S]*En curso/.test(shownBoard.text), shownBoard);
  // Sin sesión: queda en el inicio, que pide entrar; al entrar, se abre la nota que se había pedido.
  await app.evaluate(() => new Promise((r) => chrome.storage.local.remove('cloud', r)));
  await app.goto(home + pub.url.slice(WEB.length)); await app.waitForSelector('.lmd-article h1');
  check('el enlace público que creó la IA abre la nota sin cuenta', pub.url.startsWith(WEB + '?f=pub%2F') && /Informe/.test(await app.textContent('.lmd-article h1')));
  await app.goto(home + link.slice(WEB.length)); await app.waitForSelector('.lmd-home-cloud:not([hidden]) [data-cloud=ask]');
  const door = await app.evaluate(() => ({ home: document.querySelector('.lmd-home').textContent, note: document.querySelectorAll('.lmd-article h1').length, in: LMD.cloud.signedIn() }));
  check('sin sesión, la dirección de la nota deja en el inicio y pide entrar', !door.in && door.note === 0 && /Entrá a tu cuenta para abrir las notas de la nube\./.test(door.home), door);
  await app.click('[data-cloud=ask]'); await app.fill('[data-field=email]', mail);
  const [started] = await Promise.all([app.waitForResponse((r) => r.url().endsWith('/auth/start')), app.click('[data-cloud=start]')]);
  await app.waitForSelector('[data-field=code]'); await app.fill('[data-field=code]', (await started.json()).dev_code); await app.click('[data-cloud=verify]');
  const back = await app.waitForSelector('.lmd-article h1', { timeout: 15000 }).then(() => true, () => false);
  check('y al entrar, se abre la nota que se había pedido', back && /Informe/.test(await app.textContent('.lmd-article h1')) && new URL(app.url()).searchParams.get('f') === 'cloud/proyecto/informe%20final.md', app.url());

  console.log('La IA en la nota');
  const aiStrip = () => app.evaluate(() => { const s = document.querySelector('.lmd-here'); const avs = [...s.querySelectorAll('.lmd-live-avs > .lmd-live-av')]; return { shown: !s.hidden && s.offsetParent !== null, n: avs.length, ai: avs.filter((a) => a.classList.contains('lmd-here-ai')).map((a) => a.title), busy: avs.some((a) => a.classList.contains('lmd-here-busy')), svg: !!s.querySelector('.lmd-here-ai svg'), img: s.querySelectorAll('img').length, tip: (s.querySelector('.lmd-here-tip') || {}).textContent || '' }; });
  const aiGone = () => app.waitForFunction(() => document.querySelector('.lmd-here').hidden, null, { timeout: 15000 }).then(() => true, () => false);
  await aiGone();
  check('en una nota propia sin compartir no hay tira de avatares', !(await aiStrip()).shown);
  await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fresh.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } }) });
  await mcp(fresh.token, 'read_note', { path: 'proyecto/informe final.md' });
  await app.waitForFunction(() => !document.querySelector('.lmd-here').hidden, null, { timeout: 8000 }).catch(() => {});
  const reading = await aiStrip();
  check('cuando una IA lee la nota aparece en la tira, con un ícono propio y el nombre del cliente y del token', reading.shown && reading.n === 1 && reading.ai.length === 1 && /^IA · Claude Code \(token "[^"]+"\)$/.test(reading.ai[0]) && reading.svg && reading.img === 0 && !reading.busy, reading);
  await mcp(fresh.token, 'write_note', { path: 'proyecto/informe final.md', text: '# Informe\n\nLa IA lo cambió.\n' });
  await app.waitForFunction(() => /La IA lo cambió/.test(document.querySelector('.lmd-article').textContent) && !!document.querySelector('.lmd-here .lmd-here-busy'), null, { timeout: 8000 }).catch(() => {});
  const writing = await aiStrip();
  check('cuando escribe, la nota abierta se actualiza y su avatar lo marca', /La IA lo cambió/.test(await app.textContent('.lmd-article')) && writing.shown && writing.busy && / · escribiendo$/.test(writing.ai[0]), writing);
  check('el cuadrito dice cuándo fue la última edición y que fue la IA, con el nombre de su token', /^Última edición: .+, por IA · .+/.test(writing.tip) && !/@/.test(writing.tip) && plain(writing.tip), writing.tip);
  await app.hover('.lmd-here');
  check('y sale al pasar el cursor por la tira', await app.evaluate(() => getComputedStyle(document.querySelector('.lmd-here-tip')).display !== 'none'));
  await app.mouse.move(600, 500);
  await app.waitForFunction(() => !document.querySelector('.lmd-here .lmd-here-busy'), null, { timeout: 8000 }).catch(() => {});
  const calm = await aiStrip();
  check('al rato deja de figurar escribiendo, y sigue en la nota', calm.shown && !calm.busy && calm.ai.length === 1, calm);
  check('y se va sola cuando deja de usarla', await aiGone());

  check('nada usó prompt, alert ni confirm del navegador', natives.length === 0, natives);
  check('nada salió hacia el servidor de producción', outside.length === 0, outside);
  check('sin errores de JavaScript', errors.length === 0, errors);
} catch (e) { check('la prueba corrió hasta el final', false, String(e && e.stack || e).split('\n').slice(0, 4)); }

const bad = results.filter((r) => !r).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
await ctx.close(); server.kill(); await new Promise((r) => setTimeout(r, 300));
fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
