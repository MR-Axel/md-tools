// Servidor de sincronización: cuentas, notas, límites del plan gratis y MCP.
import { spawn } from 'child_process'; import { createHmac } from 'crypto';
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 18000 + Math.floor(Math.random() * 400);
const base = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PADDLE_WEBHOOK_SECRET: 'firma-de-prueba', PORTAL_URL: 'https://portal.ejemplo.test', FREE_NOTES: '3', ALLOW_ORIGINS: 'https://ejemplo.test', FEEDBACK_TO: 'duenio@ejemplo.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

const call = async (method, url, body, auth, extra) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(extra || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { status: r.status, json, headers: r.headers };
};
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
console.log('Servidor de sincronización');
try {
  const start = await call('POST', '/auth/start', { email: 'Ana@Ejemplo.test' });
  check('pide el código de acceso', start.status === 200 && /^\d{6}$/.test(start.json.dev_code), start.json);
  check('no deja pedir dos códigos seguidos', (await call('POST', '/auth/start', { email: 'ana@ejemplo.test' })).status === 429);
  check('rechaza un código equivocado', (await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: '000000' + '' })).status === 400 || start.json.dev_code === '000000');
  const login = await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: start.json.dev_code });
  const s = login.json.session;
  check('entra y devuelve la cuenta', login.status === 200 && s.startsWith('mds_') && login.json.account.plan === 'free' && login.json.account.limit === 3, login.json);
  check('sin sesión no hay acceso', (await call('GET', '/notes')).status === 401);

  await call('PUT', '/notes/' + encodeURIComponent('ideas/uno.md'), { text: '# Uno\n\nUna zanahoria.' }, s);
  await call('PUT', '/notes/dos.md', { text: '# Dos' }, s);
  await call('PUT', '/notes/tres.md', { text: '# Tres' }, s);
  const list = await call('GET', '/notes', undefined, s);
  check('guarda y lista notas', list.json.length === 3 && list.json.some((n) => n.path === 'ideas/uno.md'), list.json);
  check('lee una nota', (await call('GET', '/notes/' + encodeURIComponent('ideas/uno.md'), undefined, s)).json.text === '# Uno\n\nUna zanahoria.');
  const over = await call('PUT', '/notes/cuatro.md', { text: 'x' }, s);
  check('el plan gratis frena en el límite', over.status === 402 && over.json.error === 'note_limit', over.json);
  check('pero deja seguir editando las que ya están', (await call('PUT', '/notes/dos.md', { text: '# Dos, editada' }, s)).status === 200);
  check('rechaza rutas raras', (await call('PUT', '/notes/' + encodeURIComponent('../afuera.md'), { text: 'x' }, s)).status === 400);
  check('renombra', (await call('POST', '/rename', { from: 'tres.md', to: 'archivo/tres.md' }, s)).status === 200);
  check('busca en el texto', (await call('GET', '/search?q=zanahoria', undefined, s)).json[0].path === 'ideas/uno.md');
  check('borra', (await call('DELETE', '/notes/dos.md', undefined, s)).status === 200 && (await call('GET', '/notes', undefined, s)).json.length === 2);

  check('el MCP es del plan pago', (await call('POST', '/tokens', { name: 'Claude' }, s)).status === 402);
  check('el plan no se cambia sin la clave', (await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'pro' })).status === 403);
  await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  const tok = await call('POST', '/tokens', { name: 'Claude' }, s);
  const t = tok.json.token;
  check('con plan pago crea un token para la IA', tok.status === 200 && t.startsWith('mdt_') && tok.json.mcp_url.endsWith('/mcp'), tok.json);
  check('la sesión no sirve como token de MCP', (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, s)).status === 401);
  const init = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } } }, t);
  check('MCP: initialize', init.json.result.serverInfo.name === 'sharpmd' && !!init.json.result.capabilities.tools, init.json);
  check('MCP: las notificaciones no llevan respuesta', (await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, t)).status === 202);
  const tools = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, t);
  check('MCP: lista cinco herramientas', tools.json.result.tools.map((x) => x.name).join() === 'list_notes,read_note,write_note,append_note,search_notes', tools.json);
  const tool = (name, args, id) => call('POST', '/mcp', { jsonrpc: '2.0', id: id || 9, method: 'tools/call', params: { name, arguments: args } }, t);
  await tool('write_note', { path: 'ia/resumen.md', text: '# Resumen\n\nEscrito por la IA.' });
  await tool('append_note', { path: 'ia/resumen.md', text: 'Segunda parte.' });
  const read = await tool('read_note', { path: 'ia/resumen.md' });
  check('MCP: escribe, agrega y lee', read.json.result.content[0].text === '# Resumen\n\nEscrito por la IA.\n\nSegunda parte.', read.json);
  check('MCP: lo que escribe la IA lo ve la app', (await call('GET', '/notes/' + encodeURIComponent('ia/resumen.md'), undefined, s)).json.text.includes('Segunda parte.'));
  const found = await tool('search_notes', { query: 'zanahoria' });
  check('MCP: busca', /ideas\/uno\.md/.test(found.json.result.content[0].text));
  const bad = await tool('read_note', { path: 'no-existe.md' });
  check('MCP: un error vuelve como error de la herramienta', bad.json.result.isError === true, bad.json);
  const vers = await call('GET', '/versions/' + encodeURIComponent('ia/resumen.md'), undefined, s);
  check('guarda historial en el plan pago', vers.json.length === 1, vers.json);
  check('devuelve el texto de una versión anterior', (await call('GET', '/version/' + vers.json[0].id, undefined, s)).json.text === '# Resumen\n\nEscrito por la IA.');

  // compartir entre cuentas
  const start2 = await call('POST', '/auth/start', { email: 'beto@ejemplo.test' });
  const b = (await call('POST', '/auth/verify', { email: 'beto@ejemplo.test', code: start2.json.dev_code })).json.session;
  const owner = (await call('GET', '/account', undefined, s)).json.id;
  const enc = encodeURIComponent;
  check('sin compartir, otra cuenta no entra a la nota', (await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b)).status === 403);
  check('compartir una nota para ver', (await call('POST', '/shares', { path: 'ia/resumen.md', email: 'beto@ejemplo.test', role: 'view' }, s)).status === 200);
  const seen = await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b);
  check('la otra cuenta la lee', seen.status === 200 && seen.json.role === 'view' && seen.json.text.includes('Segunda parte.'), seen.json);
  check('pero con permiso de ver no la puede cambiar', (await call('PUT', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, { text: 'x' }, b)).status === 403);
  check('ni entrar a otra nota del dueño', (await call('GET', '/notes/' + enc('ideas/uno.md') + '?o=' + owner, undefined, b)).status === 403);
  await call('POST', '/shares', { path: 'ideas', kind: 'folder', email: 'beto@ejemplo.test', role: 'edit' }, s);
  const withMe = await call('GET', '/shared', undefined, b);
  check('compartir una carpeta da acceso a lo de adentro', withMe.json.length === 2 && withMe.json.some((n) => n.path === 'ideas/uno.md' && n.role === 'edit' && n.by === 'ana@ejemplo.test'), withMe.json);
  // en vivo: quien escucha se entera cuando otro guarda
  const ctrl = new AbortController();
  const stream = await fetch(base + '/events?path=' + enc('ideas/uno.md'), { headers: { authorization: 'Bearer ' + s }, signal: ctrl.signal });
  const reader = stream.body.getReader(); const dec = new TextDecoder(); let got = '';
  const pump = (async () => { try { for (;;) { const r = await reader.read(); if (r.done) break; got += dec.decode(r.value); } } catch (e) { /* cortado a propósito */ } })();
  await new Promise((r) => setTimeout(r, 200));
  check('con permiso de editar la cambia', (await call('PUT', '/notes/' + enc('ideas/uno.md') + '?o=' + owner, { text: '# Uno\n\nEditado por Beto.' }, b)).status === 200);
  await new Promise((r) => setTimeout(r, 300)); ctrl.abort(); await pump;
  check('el dueño recibe el aviso en vivo', /"type":"presence"/.test(got) && /"type":"saved","by":"beto@ejemplo.test"/.test(got.replace(/"who":\[[^\]]*\],/g, '')), got.slice(0, 300));
  check('el cambio quedó en la nota del dueño', (await call('GET', '/notes/' + enc('ideas/uno.md'), undefined, s)).json.text.includes('Editado por Beto.'));
  const shares = await call('GET', '/shares?path=' + enc('ia/resumen.md'), undefined, s);
  await call('DELETE', '/shares/' + shares.json.people[0].id, undefined, s);
  check('dejar de compartir corta el acceso', (await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b)).status === 403);
  check('compartir es del plan pago', (await call('POST', '/shares', { path: 'x.md', email: 'ana@ejemplo.test' }, b)).status === 402);
  // enlace público con contraseña
  const open = await call('POST', '/links', { path: 'ia/resumen.md' }, s);
  check('enlace público sin contraseña', (await call('GET', '/public/' + open.json.token)).json.text.includes('Segunda parte.'));
  const locked = await call('POST', '/links', { path: 'ia/resumen.md', password: 'manzana-42' }, s);
  check('enlace con contraseña: la pide', (await call('GET', '/public/' + locked.json.token)).status === 401);
  check('rechaza una contraseña equivocada', (await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'pera' })).status === 403);
  check('y abre con la correcta', (await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'manzana-42' })).json.text.includes('Segunda parte.'));
  for (let i = 0; i < 10; i++) await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'no' + i });
  check('diez intentos fallidos bloquean el enlace', (await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'manzana-42' })).status === 429);
  check('un enlace inventado no existe', (await call('GET', '/public/abcdef')).status === 404);

  const pre = await fetch(base + '/notes', { method: 'OPTIONS', headers: { origin: 'https://ejemplo.test', 'access-control-request-method': 'GET' } });
  const ext = await fetch(base + '/health', { headers: { origin: 'chrome-extension://abcdefghijklmnop' } });
  const other = await fetch(base + '/health', { headers: { origin: 'https://otro.test' } });
  check('CORS: el sitio permitido y las extensiones sí, el resto no', pre.headers.get('access-control-allow-origin') === 'https://ejemplo.test' && ext.headers.get('access-control-allow-origin') === 'chrome-extension://abcdefghijklmnop' && !other.headers.get('access-control-allow-origin'));
  // Renombrar: lo compartido, el enlace público y el historial siguen a la nota
  const rc = await call('POST', '/auth/start', { email: 'rena@ejemplo.test' }); const rs = (await call('POST', '/auth/verify', { email: 'rena@ejemplo.test', code: rc.json.dev_code })).json.session;
  await call('POST', '/admin/plan', { email: 'rena@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  await call('PUT', '/notes/viejo.md', { text: 'uno' }, rs); await call('PUT', '/notes/viejo.md', { text: 'dos' }, rs);
  await call('POST', '/shares', { path: 'viejo.md', email: 'pago@ejemplo.test', role: 'view' }, rs);
  const enlace = await call('POST', '/links', { path: 'viejo.md' }, rs);
  await call('POST', '/rename', { from: 'viejo.md', to: 'nuevo.md' }, rs);
  const rcomp = (await call('GET', '/shares?path=nuevo.md', undefined, rs)).json; const rver = (await call('GET', '/versions/nuevo.md', undefined, rs)).json;
  check('renombrar lleva consigo lo compartido y el historial', JSON.stringify(rcomp).includes('pago@ejemplo.test') && Array.isArray(rver) && rver.length >= 1, [rcomp, rver]);
  // Paddle: solo un aviso firmado, de un precio de SharpMD, cambia el plan
  const paddle = async (ev, secret) => { const raw = JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', secret || 'firma-de-prueba').update(ts + ':' + raw).digest('hex'); const r = await fetch(base + '/paddle/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const pc = await call('POST', '/auth/start', { email: 'pago@ejemplo.test' }); const ps = (await call('POST', '/auth/verify', { email: 'pago@ejemplo.test', code: pc.json.dev_code })).json.session;
  const sub = (status, extra) => ({ event_type: 'subscription.updated', data: { id: 'sub_1', status, items: [{ price: { id: 'pri_1', custom_data: { app: 'sharpmd', cycle: 'monthly' } } }], ...extra } });
  check('Paddle: un aviso con otra firma se rechaza', (await paddle(sub('active', { custom_data: { sharpmd_email: 'pago@ejemplo.test' } }), 'otra')).status === 401);
  const otro = await paddle({ event_type: 'subscription.created', data: { id: 'sub_9', status: 'active', custom_data: { sharpmd_email: 'pago@ejemplo.test' }, items: [{ price: { id: 'pri_x', custom_data: { plan: 'otro', meses: 1 } } }] } });
  check('Paddle: un precio de otro producto no toca la cuenta', otro.json.ignored === 'product' && (await call('GET', '/account', undefined, ps)).json.plan === 'free');
  const alta = await paddle(sub('active', { custom_data: { sharpmd_email: 'pago@ejemplo.test' } }));
  const cuentaPaga = (await call('GET', '/account', undefined, ps)).json;
  check('Paddle: la suscripción activa pasa la cuenta a pago', alta.json.plan === 'pro' && cuentaPaga.plan === 'pro' && cuentaPaga.manage === 'https://portal.ejemplo.test', [alta, cuentaPaga]);
  const renueva = await paddle(sub('past_due'));
  check('Paddle: la renovación sin custom_data encuentra la cuenta por la suscripción', renueva.json.plan === 'pro', renueva);
  await paddle(sub('canceled'));
  check('Paddle: al cancelarse vuelve a gratis', (await call('GET', '/account', undefined, ps)).json.plan === 'free');
  check('Paddle: un aviso sin cuenta no rompe', (await paddle({ event_type: 'subscription.created', data: { id: 'sub_2', status: 'active', custom_data: { sharpmd_email: 'nadie@ejemplo.test' }, items: [{ price: { custom_data: { app: 'sharpmd' } } }] } })).json.ignored === 'user');
  // Correo bien formado: lo que antes pasaba con cualquier cosa con una arroba y un punto
  const mailOk = async (mail) => (await call('POST', '/auth/start', { email: mail })).status;
  const malos = ['sin-arroba.test', 'dos@@ejemplo.test', 'con espacio@ejemplo.test', 'ana@ejemplo', 'ana@ejemplo..test', '.ana@ejemplo.test', 'ana.@ejemplo.test', 'ana@-ejemplo.test', 'ana@ejemplo.t', 'ana@ejemplo.123'];
  const rechazos = []; for (const m of malos) rechazos.push(await mailOk(m));
  check('rechaza los correos mal formados', rechazos.every((st) => st === 400), rechazos);
  check('acepta correos comunes, con + y subdominios', (await mailOk('Nombre.Apellido+notas@mail.ejemplo.com.ar')) === 200 && (await mailOk('josé@añil.test')) === 200);

  // Comentarios: llegan con o sin sesión, con tope por IP y por cuenta
  const fb = (body, auth, ip) => call('POST', '/feedback', body, auth, ip ? { 'x-forwarded-for': ip } : undefined);
  const anon = await fb({ text: 'El menú tapa los ajustes.', context: { version: '2.35.0', where: 'extension', browser: 'Chrome', lang: 'es' } }, undefined, '10.0.0.1');
  check('comentarios: sin sesión entra, y sin correo configurado no manda nada', anon.status === 200 && anon.json.ok === true && anon.json.dev === true, anon.json);
  check('comentarios: con sesión entra', (await fb({ text: 'Con la cuenta abierta.' }, ps, '10.0.0.2')).status === 200);
  const corto = await fb({ text: ' abc ' }, undefined, '10.0.0.3'); const largo = await fb({ text: 'x'.repeat(4001) }, undefined, '10.0.0.3');
  check('comentarios: el texto va de 5 a 4000 caracteres', corto.status === 400 && corto.json.error === 'bad_text' && largo.status === 400 && (await fb({ text: 'x'.repeat(4000) }, undefined, '10.0.0.3')).status === 200, [corto.json, largo.json]);
  check('comentarios: un correo mal escrito se rechaza', (await fb({ text: 'Texto de prueba.', email: 'ana@ejemplo' }, undefined, '10.0.0.3')).json.error === 'bad_email');
  const porIp = []; for (let i = 0; i < 6; i++) porIp.push((await fb({ text: 'Comentario ' + i + ' de la misma IP.' }, undefined, '10.0.0.9')).status);
  check('comentarios: cinco por hora por IP', porIp.join() === '200,200,200,200,200,429' && (await fb({ text: 'Desde otra IP sigue entrando.' }, undefined, '10.0.0.10')).status === 200, porIp);
  // La IP que cuenta es la que anota el proxy, la última: inventar las anteriores no saltea el tope.
  check('comentarios: la IP es la última de x-forwarded-for', (await fb({ text: 'Con una IP inventada adelante.' }, undefined, '1.2.3.4, 10.0.0.9')).status === 429);
  const porCuenta = []; for (let i = 0; i < 6; i++) porCuenta.push((await fb({ text: 'Comentario ' + i + ' de la misma cuenta.' }, ps, '10.1.0.' + i)).status);
  check('comentarios: cinco por hora por cuenta, aunque cambie la IP', porCuenta.join() === '200,200,200,200,429,429', porCuenta);

  // Con correo configurado: qué sale, a quién, y que del contexto no pase nada de más
  const second = async (extra) => {
    const port = PORT + 1 + Math.floor(Math.random() * 500); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
    const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 50 && !/puerto/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    const post = async (url, body, auth) => { const r = await fetch('http://127.0.0.1:' + port + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
    return { post, stop: async () => { proc.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(dir, { recursive: true, force: true }); } };
  };
  const sent = [];
  const inbox = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { sent.push(JSON.parse(b)); res.writeHead(200); res.end('{}'); }); });
  await new Promise((r) => inbox.listen(0, '127.0.0.1', r));
  const withMail = await second({ FEEDBACK_TO: 'duenio@ejemplo.test', MAIL_WEBHOOK: 'http://127.0.0.1:' + inbox.address().port });
  const real = await withMail.post('/feedback', { text: 'Al cambiar de idioma se pisan dos ventanas.', email: 'Lectora@Ejemplo.test', context: { version: '2.35.0', where: 'web', browser: 'Mozilla/5.0 Chrome/140', lang: 'es', path: 'C:/privado/diario.md', note: '# Mi diario secreto' } });
  const m = sent[0] || {};
  check('comentarios: se mandan al correo configurado, con respuesta a quien escribió', real.status === 200 && !real.json.dev && m.to === 'duenio@ejemplo.test' && m.subject === 'SharpMD feedback' && m.reply_to === 'lectora@ejemplo.test', [real.json, m]);
  check('comentarios: el cuerpo trae el texto, la versión, web o extensión, el navegador y el idioma', /^Al cambiar de idioma se pisan dos ventanas\./.test(m.text || '') && /Version: 2\.35\.0/.test(m.text) && /Where: web/.test(m.text) && /Browser: Mozilla\/5\.0 Chrome\/140/.test(m.text) && /Language: es/.test(m.text), m.text);
  check('comentarios: ni rutas ni contenido de notas viajan en el contexto', !/privado|diario|secreto/.test(JSON.stringify(m)), m);
  const lc = await withMail.post('/auth/start', { email: 'cuenta@ejemplo.test' }); const ls = (await withMail.post('/auth/verify', { email: 'cuenta@ejemplo.test', code: lc.json.dev_code })).json.session;
  await withMail.post('/feedback', { text: 'Escrito con la cuenta abierta.', email: 'otro@ejemplo.test' }, ls);
  const m2 = sent[sent.length - 1] || {};
  check('comentarios: con sesión, el correo es el de la cuenta', m2.reply_to === 'cuenta@ejemplo.test' && /From: cuenta@ejemplo\.test \(signed in, free plan\)/.test(m2.text || ''), m2);
  await withMail.stop(); inbox.close();
  const noFeedback = await second({});
  check('comentarios: sin FEEDBACK_TO responde 404', (await noFeedback.post('/feedback', { text: 'No debería llegar a nadie.' })).status === 404);
  await noFeedback.stop();

  check('cerrar sesión la invalida', (await call('POST', '/auth/logout', {}, s)).status === 200 && (await call('GET', '/notes', undefined, s)).status === 401);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(log); }
child.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(data, { recursive: true, force: true });
const bad = results.filter((x) => !x).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
process.exit(bad ? 1 : 0);
