// Servidor de sincronización: cuentas, notas, límites del plan gratis y MCP.
import { spawn } from 'child_process'; import { createHmac } from 'crypto';
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 18000 + Math.floor(Math.random() * 400);
const base = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', TEST_LOGIN: 'revision@ejemplo.test:246810', PADDLE_WEBHOOK_SECRET: 'firma-de-prueba', PORTAL_URL: 'https://portal.ejemplo.test', FREE_NOTES: '3', ALLOW_ORIGINS: 'https://ejemplo.test', FEEDBACK_TO: 'duenio@ejemplo.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const gap = await call('POST', '/auth/start', { email: 'ana@ejemplo.test' });
  check('no deja pedir dos códigos seguidos', gap.status === 429);
  check('el tope dice cuál es y cuántos segundos faltan, en el cuerpo y en la cabecera', gap.json.error === 'code_gap' && gap.json.retry_after >= 1 && gap.json.retry_after <= 30 && gap.headers.get('retry-after') === String(gap.json.retry_after), [gap.json, gap.headers.get('retry-after')]);
  check('rechaza un código equivocado', (await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: '000000' + '' })).status === 400 || start.json.dev_code === '000000');
  const login = await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: start.json.dev_code });
  const s = login.json.session;
  check('entra y devuelve la cuenta', login.status === 200 && s.startsWith('mds_') && login.json.account.plan === 'free' && login.json.account.limit === 3, login.json);
  check('sin sesión no hay acceso', (await call('GET', '/notes')).status === 401);

  console.log('Nombre visible');
  const acc0 = (await call('GET', '/account', undefined, s)).json;
  check('la cuenta tiene un nombre visible: por defecto, lo que va antes de la arroba', acc0.name === 'ana' && acc0.name_default === true && login.json.account.name === 'ana', acc0);
  let named = await call('PUT', '/account', { name: '  Ana   Paz ' }, s);
  check('cambiarlo lo guarda limpio, y deja de ser el por defecto', named.status === 200 && named.json.name === 'Ana Paz' && named.json.name_default === false && (await call('GET', '/account', undefined, s)).json.name === 'Ana Paz', named.json);
  const badNames = [];
  for (const name of ['A', 'x'.repeat(41), 'ana@paz', 'Ana\nPaz', 12, undefined]) badNames.push((await call('PUT', '/account', name === undefined ? {} : { name }, s)).status);
  check('de 2 a 40 caracteres, sin arroba, sin saltos y solo texto', badNames.every((x) => x === 400) && (await call('GET', '/account', undefined, s)).json.name === 'Ana Paz', badNames);
  check('sin sesión no se cambia', (await call('PUT', '/account', { name: 'Otra' })).status === 401);
  named = await call('PUT', '/account', { name: '' }, s);
  check('vacío vuelve al nombre por defecto', named.status === 200 && named.json.name === 'ana' && named.json.name_default === true, named.json);
  let lastName = null; for (let i = 0; i < 12; i++) lastName = await call('PUT', '/account', { name: 'Nombre ' + i }, s);
  check('hay un tope de cambios por hora', lastName.status === 429 && lastName.json.error === 'too_many' && lastName.json.retry_after >= 1, lastName.json);

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
  { const said = String(init.json.result.instructions || '');
    check('MCP: las instrucciones piden el enlace https que abre un archivo local, y la ruta como texto', said.includes('#open=file%3A%2F%2F%2FC%3A%2FUsers%2Fme%2FDesktop%2Fnotes.md)') && said.includes('#open=file%3A%2F%2F%2FUsers%2Fme%2FDesktop%2Fnotes.md)') && /full path as plain text/.test(said) && !/\]\(file:/.test(said) && !/[!¡—–]/.test(said), said.slice(-500)); }
  check('MCP: initialize', init.json.result.serverInfo.name === 'sharpmd' && !!init.json.result.capabilities.tools, init.json);
  check('MCP: las notificaciones no llevan respuesta', (await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, t)).status === 202);
  const tools = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, t);
  check('MCP: lista las diez herramientas de un token sin permiso de compartir', tools.json.result.tools.map((x) => x.name).join() === 'list_notes,list_folders,read_note,write_note,append_note,search_notes,list_comments,resolve_comment,move_note,note_history', tools.json);
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
  const blocked = await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'manzana-42' });
  check('diez intentos fallidos bloquean el enlace, y dice cuánto falta', blocked.status === 429 && blocked.json.error === 'locked' && blocked.json.retry_after > 590 && blocked.json.retry_after <= 600, blocked.json);
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
  // IA: carpetas, token limitado a una carpeta y comentarios pendientes
  const ic = await call('POST', '/auth/start', { email: 'ia@ejemplo.test' }); const is = (await call('POST', '/auth/verify', { email: 'ia@ejemplo.test', code: ic.json.dev_code })).json.session;
  check('comentar necesita el plan pago', (await call('POST', '/comments', { path: 'x.md', text: 'hola' }, is)).status === 402);
  await call('POST', '/admin/plan', { email: 'ia@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  for (const [pa, tx] of [['alfa/plan.md', '# Plan\n\nPaso uno.\n'], ['alfa/notas/reunion.md', 'reunion'], ['beta/ideas.md', 'ideas'], ['suelta.md', 'suelta']]) await call('PUT', '/notes/' + pa, { text: tx }, is);
  const mk = async (body) => (await call('POST', '/tokens', body, is)).json;
  const full = (await mk({ name: 'todo' })).token; const lim = await mk({ name: 'alfa', folder: 'alfa/' });
  const ask = async (tok, name, args) => { const r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; let v = c.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!c.isError }; };
  const carpetas = (await ask(full, 'list_folders')).v;
  check('MCP: lista las carpetas con su cantidad de notas', JSON.stringify(carpetas) === JSON.stringify([{ folder: 'alfa', notes: 2 }, { folder: 'alfa/notas', notes: 1 }, { folder: 'beta', notes: 1 }]), carpetas);
  check('MCP: list_notes filtra por carpeta', (await ask(full, 'list_notes', { folder: 'alfa' })).v.map((n) => n.path).sort().join() === 'alfa/notas/reunion.md,alfa/plan.md');
  const vistas = (await ask(lim.token, 'list_notes')).v.map((n) => n.path).sort().join();
  check('token de carpeta: solo ve su carpeta', lim.scope === 'alfa' && vistas === 'alfa/notas/reunion.md,alfa/plan.md', [lim.scope, vistas]);
  const fuera = await ask(lim.token, 'read_note', { path: 'beta/ideas.md' }); const escribeFuera = await ask(lim.token, 'write_note', { path: 'suelta.md', text: 'x' });
  check('token de carpeta: no lee ni escribe afuera', fuera.err && escribeFuera.err && (await call('GET', '/notes/suelta.md', undefined, is)).json.text === 'suelta', [fuera, escribeFuera]);
  check('token de carpeta: la búsqueda no sale de la carpeta', (await ask(lim.token, 'search_notes', { query: 'ideas' })).v.length === 0 && (await ask(full, 'search_notes', { query: 'ideas' })).v.length === 1);
  // El enlace para abrir lo escrito, el permiso de compartir y las herramientas nuevas.
  {
  const openAt = 'https://sharpmd.app/src/app.html?f=';
  const w1 = await ask(full, 'write_note', { path: 'ia/mi nota ñ.md', text: '# Hola' }); const w2 = await ask(full, 'append_note', { path: 'ia/mi nota ñ.md', text: 'Más.' });
  check('MCP: write_note y append_note devuelven la dirección para abrir la nota en la app', w1.v === 'Saved ia/mi nota ñ.md (6 characters). Open it: ' + openAt + encodeURIComponent('cloud/ia/' + encodeURIComponent('mi nota ñ.md')) && w2.v === 'Appended to ia/mi nota ñ.md. Open it: ' + openAt + encodeURIComponent('cloud/ia/' + encodeURIComponent('mi nota ñ.md')), [w1.v, w2.v]);
  const mv = await ask(full, 'move_note', { from: 'ia/mi nota ñ.md', to: 'archivo/nota.md' }); const mvAgain = await ask(full, 'move_note', { from: 'beta/ideas.md', to: 'archivo/nota.md' });
  check('MCP: move_note mueve la nota, devuelve su dirección y no pisa otra', mv.v === 'Moved ia/mi nota ñ.md to archivo/nota.md. Open it: ' + openAt + 'cloud%2Farchivo%2Fnota.md' && (await call('GET', '/notes/' + encodeURIComponent('archivo/nota.md'), undefined, is)).json.text === '# Hola\n\nMás.' && (await call('GET', '/notes/' + encodeURIComponent('ia/mi nota ñ.md'), undefined, is)).status === 404 && mvAgain.err && /already a note/.test(mvAgain.v), [mv.v, mvAgain.v]);
  await ask(full, 'write_note', { path: 'archivo/nota.md', text: '# Hola, otra vez' });
  const hs = await ask(full, 'note_history', { path: 'archivo/nota.md' }); const hv = hs.v.length ? await ask(full, 'note_history', { path: 'archivo/nota.md', version: hs.v[0].version }) : { v: null };
  check('MCP: note_history lista las versiones anteriores y devuelve el texto de una', hs.v.length === 1 && hs.v[0].size > 0 && hv.v === '# Hola' && (await ask(full, 'note_history', { path: 'archivo/nota.md', version: 999999 })).err, [hs.v, hv.v]);
  const sharer = await mk({ name: 'comparte', share: true }); const shTools = (await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sharer.token)).json.result.tools;
  check('MCP: un token con el permiso de compartir tiene cinco herramientas más', sharer.share === true && typeof sharer.id === 'number' && shTools.map((x) => x.name).slice(10).join() === 'list_shares,share_note,unshare_note,create_public_link,revoke_public_link' && shTools.every((x) => !('share' in x)) && (await mk({ name: 'no' })).share === false, shTools.map((x) => x.name));
  const noPerm = await ask(full, 'create_public_link', { path: 'suelta.md' });
  check('MCP: sin el permiso, crear un enlace falla y dice a quién pedírselo', noPerm.err && /cannot share notes or create public links\. Ask the person/.test(noPerm.v), noPerm.v);
  const sc = await call('POST', '/auth/start', { email: 'socia@ejemplo.test' }); const ss = (await call('POST', '/auth/verify', { email: 'socia@ejemplo.test', code: sc.json.dev_code })).json.session;
  const s1 = await ask(sharer.token, 'share_note', { path: 'suelta.md', email: 'Socia@Ejemplo.test' }); const s2 = await ask(sharer.token, 'share_note', { path: 'alfa', email: 'socia@ejemplo.test', role: 'edit' });
  const hers = (await call('GET', '/shared', undefined, ss)).json.map((n) => n.path + ':' + n.role).sort().join();
  check('MCP: share_note comparte una nota para ver y una carpeta para editar', s1.v === 'Shared the note suelta.md with socia@ejemplo.test (can view). They see it in SharpMD after signing in with that address.' && /^Shared the folder alfa with socia@ejemplo\.test \(can edit\)/.test(s2.v) && hers === 'alfa/notas/reunion.md:edit,alfa/plan.md:edit,suelta.md:view', [s1.v, s2.v, hers]);
  const l1 = await ask(sharer.token, 'create_public_link', { path: 'suelta.md' }); const l1tok = new URL(l1.v.url).searchParams.get('f').slice(4);
  const ls = await ask(sharer.token, 'list_shares', { path: 'suelta.md' });
  check('MCP: create_public_link devuelve la dirección del enlace, que abre la nota sin cuenta', l1.v.url === openAt + 'pub%2F' + l1tok && l1.v.protected === false && l1.v.path === 'suelta.md' && (await call('GET', '/public/' + l1tok)).json.text === 'suelta' && ls.v.people.length === 1 && ls.v.people[0].email === 'socia@ejemplo.test' && ls.v.links.length === 1 && ls.v.links[0].id === l1.v.id && !JSON.stringify(ls.v).includes(l1tok), [l1.v, ls.v]);
  const u1 = await ask(sharer.token, 'unshare_note', { path: 'suelta.md', email: 'socia@ejemplo.test' }); const r1 = await ask(sharer.token, 'revoke_public_link', { path: 'suelta.md' });
  check('MCP: unshare_note y revoke_public_link lo deshacen', !u1.err && r1.v === 'Revoked 1 public link to suelta.md.' && (await call('GET', '/public/' + l1tok)).status === 404 && (await call('GET', '/shared', undefined, ss)).json.every((n) => n.path !== 'suelta.md') && (await ask(sharer.token, 'revoke_public_link', { path: 'suelta.md' })).err);
  await ask(sharer.token, 'unshare_note', { path: 'alfa', email: 'socia@ejemplo.test' });
  await call('DELETE', '/notes/' + encodeURIComponent('archivo/nota.md') + '?forever=1', undefined, is);
  }
  const com = await call('POST', '/comments', { path: 'alfa/plan.md', quote: 'Paso uno.', text: 'Que el pago vaya primero' }, is);
  await call('POST', '/comments', { path: 'beta/ideas.md', quote: 'ideas', text: 'Sumar una idea' }, is);
  const pend = (await ask(full, 'list_comments')).v; const pendLim = (await ask(lim.token, 'list_comments')).v;
  check('comentarios: la IA los lee con la nota y la cita', com.status === 200 && pend.length === 2 && pend[0].path === 'alfa/plan.md' && pend[0].quote === 'Paso uno.' && pend[0].comment === 'Que el pago vaya primero', pend);
  check('comentarios: el token de carpeta solo ve los de su carpeta', pendLim.length === 1 && pendLim[0].path === 'alfa/plan.md', pendLim);
  check('comentarios: el token de carpeta no cierra uno de afuera', (await ask(lim.token, 'resolve_comment', { id: pend[1].id })).err);
  await ask(lim.token, 'resolve_comment', { id: pend[0].id, reply: 'Movi el pago al principio' });
  const abiertos = (await call('GET', '/comments?path=alfa/plan.md', undefined, is)).json; const todos = (await call('GET', '/comments?path=alfa/plan.md&all=1', undefined, is)).json;
  check('comentarios: al resolverlo queda cerrado con la respuesta', abiertos.length === 0 && todos.length === 1 && todos[0].status === 'done' && todos[0].reply === 'Movi el pago al principio', [abiertos, todos]);
  await call('POST', '/rename', { from: 'beta/ideas.md', to: 'beta/lista.md' }, is);
  check('comentarios: siguen a la nota renombrada y se van al borrarla', (await call('GET', '/comments?path=beta/lista.md', undefined, is)).json.length === 1 && (await call('DELETE', '/notes/beta/lista.md', undefined, is)).status === 200 && (await call('GET', '/comments', undefined, is)).json.length === 0);
  // Cuenta de prueba con código fijo
  const tl = await call('POST', '/auth/start', { email: 'revision@ejemplo.test' });
  check('la cuenta de prueba no devuelve ni manda código', tl.status === 200 && !tl.json.dev_code, tl.json);
  check('la cuenta de prueba no entra con otro código', (await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '000000' })).status === 400);
  check('la cuenta de prueba entra con el código fijo', !!(await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' })).json.session);
  await call('POST', '/auth/start', { email: 'otra@ejemplo.test' });
  check('el código fijo no sirve para otra cuenta', (await call('POST', '/auth/verify', { email: 'otra@ejemplo.test', code: '246810' })).status === 400);
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
  // Denunciar una nota ajena: la misma ruta, con report. Dice qué nota es, nunca su contenido; el motivo es opcional.
  const rp = await withMail.post('/feedback', { text: '', report: { kind: 'link', note: 'pub/abc123\r\nBcc: tercero@ejemplo.test', owner: '', body: '# contenido de la nota' }, context: { version: '2.51.0', where: 'web' } });
  const m3 = sent[sent.length - 1] || {};
  check('denuncia: entra sin sesión y sin motivo, con asunto propio y qué nota es en una sola línea', rp.status === 200 && m3.to === 'duenio@ejemplo.test' && m3.subject === 'SharpMD report' && /^Reported note: pub\/abc123 Bcc: tercero@ejemplo\.test\nOwner: -\nKind: link\n\n\(no reason given\)\n/.test(m3.text || '') && !/contenido de la nota/.test(JSON.stringify(m3)) && !('reply_to' in m3), [rp.json, m3]);
  await withMail.post('/feedback', { text: 'Publica datos de otra persona.', report: { kind: 'otra-cosa', note: 'informes/plan.md', owner: '7' } }, ls);
  const m4 = sent[sent.length - 1] || {};
  check('denuncia: con sesión lleva el motivo, la ruta, la cuenta dueña y a quién responder', m4.subject === 'SharpMD report' && /^Reported note: informes\/plan\.md\nOwner: 7\nKind: -\n\nPublica datos de otra persona\.\n/.test(m4.text || '') && m4.reply_to === 'cuenta@ejemplo.test', m4);
  await withMail.stop(); inbox.close();
  const noFeedback = await second({});
  check('comentarios: sin FEEDBACK_TO responde 404', (await noFeedback.post('/feedback', { text: 'No debería llegar a nadie.' })).status === 404);
  await noFeedback.stop();

  // Otro servidor sobre una carpeta que se conserva entre arranques, con pedidos que pueden llevar cabeceras.
  const boot = async (dir, extra) => {
    const port = 21000 + Math.floor(Math.random() * 3000);
    const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
    let code = null; const exited = new Promise((r) => proc.once('exit', (c) => { code = c; r(c); }));
    for (let i = 0; i < 80 && !/puerto/.test(out) && code === null; i++) await new Promise((r) => setTimeout(r, 100));
    const ask = async (method, url, body, auth, more) => {
      const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(more || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
    };
    const enter = async (mail, pro) => { const c = await ask('POST', '/auth/start', { email: mail }); const s = (await ask('POST', '/auth/verify', { email: mail, code: c.json.dev_code })).json.session; if (pro) await ask('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' }); return s; };
    return { ask, enter, log: () => out, up: () => /puerto/.test(out), exited, stop: async () => { proc.kill(); await exited; await new Promise((r) => setTimeout(r, 150)); } };
  };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
  const wipe = (dir) => fs.rmSync(dir, { recursive: true, force: true });

  // ---------- Topes: cada uno responde con su código y con la espera ----------
  const limDir = tmp();
  const topes = await boot(limDir, { AUTH_PER_IP: '3', TEST_LOGIN: 'revision@ejemplo.test:246810' });
  const from = (ip) => ({ 'x-forwarded-for': ip });
  const waits = (r, code, max) => r.status === 429 && r.json.error === code && r.json.retry_after >= 1 && r.json.retry_after <= max && r.headers.get('retry-after') === String(r.json.retry_after);
  // Por correo: cinco códigos por hora. Entrar borra el código pedido, así que el de 30 segundos no se cruza.
  for (let i = 0; i < 5; i++) { const c = await topes.ask('POST', '/auth/start', { email: 'hora@ejemplo.test' }, undefined, from('10.2.0.' + i)); await topes.ask('POST', '/auth/verify', { email: 'hora@ejemplo.test', code: c.json.dev_code }, undefined, from('10.2.0.' + i)); }
  const porHora = await topes.ask('POST', '/auth/start', { email: 'hora@ejemplo.test' }, undefined, from('10.2.0.9'));
  check('topes: cinco códigos por hora por correo, con su código y su espera', waits(porHora, 'code_mail_hour', 3600) && porHora.json.retry_after > 3500, porHora.json);
  for (let i = 0; i < 3; i++) await topes.ask('POST', '/auth/start', { email: 'red' + i + '@ejemplo.test' }, undefined, from('10.3.0.1'));
  const porRed = await topes.ask('POST', '/auth/start', { email: 'red9@ejemplo.test' }, undefined, from('10.3.0.1'));
  check('topes: el de pedidos por red tiene otro código', waits(porRed, 'code_ip_hour', 3600), porRed.json);
  await topes.ask('POST', '/auth/start', { email: 'gastado@ejemplo.test' }, undefined, from('10.4.0.1'));
  for (let i = 0; i < 6; i++) await topes.ask('POST', '/auth/verify', { email: 'gastado@ejemplo.test', code: 'no' }, undefined, from('10.4.1.' + i));
  const gastado = await topes.ask('POST', '/auth/verify', { email: 'gastado@ejemplo.test', code: 'no' }, undefined, from('10.4.1.9'));
  check('topes: un código con seis intentos queda gastado, sin espera: hay que pedir otro', gastado.status === 429 && gastado.json.error === 'tries_code' && gastado.json.retry_after === undefined && !gastado.headers.get('retry-after'), gastado.json);
  // La cuenta de prueba pide código sin la espera de 30 segundos: sirve para llegar a los diez fallos por correo.
  for (let k = 0; k < 2; k++) { await topes.ask('POST', '/auth/start', { email: 'revision@ejemplo.test' }, undefined, from('10.5.0.' + k)); for (let i = 0; i < 5; i++) await topes.ask('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '000000' }, undefined, from('10.5.' + (k + 1) + '.' + i)); }
  const porCorreo = await topes.ask('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' }, undefined, from('10.5.9.9'));
  check('topes: diez códigos equivocados por hora por correo', waits(porCorreo, 'tries_mail_hour', 3600), porCorreo.json);
  for (let k = 0; k < 5; k++) { await topes.ask('POST', '/auth/start', { email: 'mal' + k + '@ejemplo.test' }, undefined, from('10.6.0.' + k)); for (let i = 0; i < 6; i++) await topes.ask('POST', '/auth/verify', { email: 'mal' + k + '@ejemplo.test', code: 'no' }, undefined, from('10.6.9.9')); }
  await topes.ask('POST', '/auth/start', { email: 'mal9@ejemplo.test' }, undefined, from('10.6.0.9'));
  const porRedMal = await topes.ask('POST', '/auth/verify', { email: 'mal9@ejemplo.test', code: 'no' }, undefined, from('10.6.9.9'));
  check('topes: treinta códigos equivocados por hora por red', waits(porRedMal, 'tries_ip_hour', 3600), porRedMal.json);
  await topes.stop(); wipe(limDir);

  // ---------- Cifrado en reposo (DATA_KEY) ----------
  // Lo que hay en el disco: el archivo de la base y su WAL, tal como los vería quien se lleva un respaldo.
  const onDisk = (dir, word) => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).some((f) => fs.readFileSync(path.join(dir, f)).includes(Buffer.from(word)));
  const K1 = Buffer.alloc(32, 7).toString('base64'); const K2 = Buffer.alloc(32, 9).toString('base64');
  const encDir = tmp();
  let srv = await boot(encDir, {});
  let es = await srv.enter('cifra@ejemplo.test', true);
  await srv.ask('PUT', '/notes/' + encodeURIComponent('diario/lunes.md'), { text: '# Lunes\n\nremolacha-uno en claro.' }, es);
  await srv.ask('PUT', '/notes/' + encodeURIComponent('diario/lunes.md'), { text: '# Lunes\n\nremolacha-dos en claro, más larga.' }, es);
  await srv.ask('POST', '/comments', { path: 'diario/lunes.md', quote: 'remolacha-cita', text: 'remolacha-pedido' }, es);
  const encTok = (await srv.ask('POST', '/tokens', { name: 'ia' }, es)).json.token;
  const encLink = (await srv.ask('POST', '/links', { path: 'diario/lunes.md' }, es)).json.token;
  await srv.stop();
  check('sin DATA_KEY todo sigue en claro en el disco', ['remolacha-uno', 'remolacha-dos', 'remolacha-cita', 'remolacha-pedido'].every((w) => onDisk(encDir, w)));
  srv = await boot(encDir, { DATA_KEY: K1 });
  check('con DATA_KEY arranca y cifra lo que estaba en claro', srv.up() && /se cifraron 3 filas/.test(srv.log()), srv.log());
  const encTool = async (name, args) => (await srv.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, encTok)).json.result.content[0].text;
  const whole = async () => {
    const list = (await srv.ask('GET', '/notes', undefined, es)).json; const note = (await srv.ask('GET', '/notes/' + encodeURIComponent('diario/lunes.md'), undefined, es)).json;
    const vers = (await srv.ask('GET', '/versions/' + encodeURIComponent('diario/lunes.md'), undefined, es)).json; const ver = (await srv.ask('GET', '/version/' + vers[0].id, undefined, es)).json;
    const coms = (await srv.ask('GET', '/comments?path=' + encodeURIComponent('diario/lunes.md') + '&all=1', undefined, es)).json;
    return { size: list.find((n) => n.path === 'diario/lunes.md').size, text: note.text, vsize: vers[0].size, vtext: ver.text, quote: coms[0].quote, com: coms[0].text, reply: coms[0].reply,
      search: (await srv.ask('GET', '/search?q=remolacha-dos', undefined, es)).json.map((r) => r.path + ':' + r.hits.length).join(), mcp: await encTool('read_note', { path: 'diario/lunes.md' }),
      found: /diario\/lunes\.md/.test(await encTool('search_notes', { query: 'remolacha-dos' })), pub: (await srv.ask('GET', '/public/' + encLink)).json.text };
  };
  const T2 = '# Lunes\n\nremolacha-dos en claro, más larga.'; const T1 = '# Lunes\n\nremolacha-uno en claro.';
  const sameAll = (w) => w.text === T2 && w.size === T2.length && w.vtext === T1 && w.vsize === T1.length && w.quote === 'remolacha-cita' && w.com === 'remolacha-pedido' && w.search === 'diario/lunes.md:1' && w.mcp === T2 && w.found && w.pub === T2;
  let w = await whole();
  check('cifrado: notas, historial, comentarios, búsqueda, MCP, enlace público y tamaños responden igual', sameAll(w), w);
  const comId = (await srv.ask('GET', '/comments', undefined, es)).json[0].id;
  await encTool('resolve_comment', { id: comId, reply: 'remolacha-respuesta' });
  await srv.ask('PUT', '/notes/nueva.md', { text: 'remolacha-nueva, escrita ya con la clave.' }, es);
  await srv.ask('PUT', '/notes/nueva.md', { text: 'remolacha-nueva, segunda versión.' }, es);
  const grande = await srv.ask('PUT', '/notes/grande.md', { text: 'ñ'.repeat(524289) }, es);
  check('cifrado: el límite de 1 MB se mide sobre el texto en claro', grande.status === 413 && (await srv.ask('PUT', '/notes/justa.md', { text: 'a'.repeat(1024 * 1024) }, es)).status === 200, grande.json);
  await srv.stop();
  check('cifrado: en el disco no queda nada legible, ni lo migrado ni lo nuevo', !['remolacha-uno', 'remolacha-dos', 'remolacha-cita', 'remolacha-pedido', 'remolacha-respuesta', 'remolacha-nueva'].some((x) => onDisk(encDir, x)) && onDisk(encDir, 'enc1:'));
  srv = await boot(encDir, { DATA_KEY: K1 });
  w = await whole();
  const reply = (await srv.ask('GET', '/comments?path=' + encodeURIComponent('diario/lunes.md') + '&all=1', undefined, es)).json[0].reply;
  check('cifrado: la migración es idempotente, al volver a arrancar no toca nada y todo se lee', srv.up() && !/se cifraron/.test(srv.log()) && sameAll(w) && reply === 'remolacha-respuesta' && (await srv.ask('GET', '/notes/nueva.md', undefined, es)).json.text === 'remolacha-nueva, segunda versión.', [srv.log(), w, reply]);
  await srv.stop();
  const before = fs.readFileSync(path.join(encDir, 'mdtools.db'));
  const refuses = async (extra, re) => { const s = await boot(encDir, extra); const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('sigue'), 4000))]); if (code === 'sigue') await s.stop(); return code === 1 && !s.up() && re.test(s.log()) ? true : [code, s.log()]; };
  const sinClave = await refuses({}, /falta DATA_KEY/); const otraClave = await refuses({ DATA_KEY: K2 }, /no es la clave/); const malFormada = await refuses({ DATA_KEY: 'corta' }, /32 bytes/);
  check('cifrado: sin la clave el servidor no arranca y lo dice', sinClave === true, sinClave);
  check('cifrado: con otra clave tampoco arranca', otraClave === true, otraClave);
  check('cifrado: una clave mal formada se rechaza al arrancar', malFormada === true, malFormada);
  check('cifrado: los arranques rechazados no tocan la base', fs.readFileSync(path.join(encDir, 'mdtools.db')).equals(before));
  srv = await boot(encDir, { DATA_KEY: K1 });
  check('cifrado: con la clave original vuelve a andar', srv.up() && (await srv.ask('GET', '/notes/nueva.md', undefined, es)).json.text === 'remolacha-nueva, segunda versión.');
  await srv.stop(); wipe(encDir);

  // ---------- Papelera ----------
  {
  const trDir = tmp();
  let tr = await boot(trDir, { DATA_KEY: K1, FREE_NOTES: '3', SHARE_FREE: '1' });
  const ts = await tr.enter('papelera@ejemplo.test'); const tp = await tr.enter('paga@ejemplo.test', true); const tx = await tr.enter('ajena@ejemplo.test');
  const bin = async (who) => (await tr.ask('GET', '/trash', undefined, who)).json;
  for (const n of ['uno', 'dos', 'tres']) await tr.ask('PUT', '/notes/' + n + '.md', { text: 'rabanito-' + n }, ts);
  await tr.ask('PUT', '/notes/uno.md', { text: 'rabanito-uno, segunda' }, ts);
  const tlink = (await tr.ask('POST', '/links', { path: 'uno.md' }, ts)).json.token;
  await tr.ask('POST', '/shares', { path: 'uno.md', email: 'ajena@ejemplo.test', role: 'view' }, ts);
  const del1 = await tr.ask('DELETE', '/notes/uno.md', undefined, ts);
  const b1 = await bin(ts);
  check('papelera: eliminar una nota la manda a la papelera, con su vencimiento a 30 días', del1.status === 200 && del1.json.trash === true && b1.length === 1 && b1[0].path === 'uno.md' && Math.abs(b1[0].expires - b1[0].deleted - 30 * 86400000) < 1000 && b1[0].text === undefined, [del1.json, b1]);
  check('papelera: lo eliminado no se lista, no se lee, no se busca, no queda compartido ni publicado', !(await tr.ask('GET', '/notes', undefined, ts)).json.some((n) => n.path === 'uno.md') && (await tr.ask('GET', '/notes/uno.md', undefined, ts)).status === 404 &&
    (await tr.ask('GET', '/search?q=rabanito-uno', undefined, ts)).json.length === 0 && (await tr.ask('GET', '/public/' + tlink)).status === 404 && (await tr.ask('GET', '/shared', undefined, tx)).json.length === 0 && (await tr.ask('GET', '/account', undefined, ts)).json.notes === 2);
  check('papelera: lo eliminado no cuenta para el tope del plan gratis', (await tr.ask('PUT', '/notes/cuatro.md', { text: 'x' }, ts)).status === 200);
  const full = await tr.ask('POST', '/trash/' + b1[0].id + '/restore', {}, ts);
  check('papelera: restaurar respeta el tope del plan gratis', full.status === 402 && full.json.error === 'note_limit' && (await bin(ts)).length === 1, full.json);
  await tr.ask('DELETE', '/notes/cuatro.md', undefined, ts);
  const back = await tr.ask('POST', '/trash/' + b1[0].id + '/restore', {}, ts);
  const again = (await tr.ask('GET', '/notes/uno.md', undefined, ts)).json;
  check('papelera: restaurar devuelve la nota a su ruta con su texto, y sale de la papelera', back.status === 200 && back.json.path === 'uno.md' && again.text === 'rabanito-uno, segunda' && again.rev === 3 && !(await bin(ts)).some((x) => x.path === 'uno.md'), [back.json, again]);
  check('papelera: lo restaurado no vuelve publicado ni compartido', (await tr.ask('GET', '/public/' + tlink)).status === 404 && (await tr.ask('GET', '/shared', undefined, tx)).json.length === 0);
  // Choque de nombres: se elimina, se crea otra en la misma ruta y se restaura la primera.
  await tr.ask('DELETE', '/notes/dos.md', undefined, ts);
  await tr.ask('PUT', '/notes/dos.md', { text: 'la nueva' }, ts);
  const twin = await tr.ask('POST', '/trash/' + (await bin(ts)).find((x) => x.path === 'dos.md').id + '/restore', {}, ts);
  check('papelera: si la ruta ya está ocupada, se restaura con otro nombre', twin.status === 402 || (twin.status === 200 && twin.json.path === 'dos (2).md'), twin.json);
  // Con plan pago: historial, MCP y el choque de nombres sin tope de notas.
  await tr.ask('PUT', '/notes/' + encodeURIComponent('proy/plan.md'), { text: 'apio-plan' }, tp);
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp);
  await tr.ask('PUT', '/notes/' + encodeURIComponent('proy/plan.md'), { text: 'el plan nuevo' }, tp);
  const ptok = (await tr.ask('POST', '/tokens', { name: 'IA' }, tp)).json.token;
  const ptool = async (name, args) => (await tr.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ptok)).json.result.content[0].text;
  check('papelera: la IA no ve lo que está en la papelera', !/apio-plan/.test(await ptool('search_notes', { query: 'apio' })) && !/apio-plan/.test(await ptool('read_note', { path: 'proy/plan.md' })) && JSON.parse(await ptool('list_notes', {})).length === 1);
  const pid = (await bin(tp))[0].id;
  check('papelera: la de otra cuenta no se ve, no se restaura ni se borra', (await bin(tx)).length === 0 && (await tr.ask('POST', '/trash/' + pid + '/restore', {}, tx)).status === 404 && (await tr.ask('DELETE', '/trash/' + pid, undefined, tx)).status === 404 &&
    (await tr.ask('GET', '/trash?o=2', undefined, tx)).status === 403 && (await tr.ask('DELETE', '/trash', undefined, tx)).json.removed === 0 && (await bin(tp)).length === 1);
  const twin2 = await tr.ask('POST', '/trash/' + pid + '/restore', {}, tp);
  check('papelera: el nombre nuevo conserva la carpeta y la extensión', twin2.status === 200 && twin2.json.path === 'proy/plan (2).md' && twin2.json.from === 'proy/plan.md' && (await tr.ask('GET', '/notes/' + encodeURIComponent('proy/plan (2).md'), undefined, tp)).json.text === 'apio-plan' && (await tr.ask('GET', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp)).json.text === 'el plan nuevo', twin2.json);
  // Carpeta con contraseña: lo eliminado sigue cifrado, y con el nombre ocupado hay que volver a cifrarlo.
  const vb = (n, fill) => Buffer.alloc(n, fill).toString('base64'); const sealedText = (fill) => 'vault1:' + Buffer.alloc(60, fill).toString('base64');
  const vault = (await tr.ask('POST', '/vaults', { folder: 'cofre', salt: vb(16, 1), iters: 200000, wrapped: vb(60, 2), check: vb(32, 3) }, tp)).json;
  const cofre = '/notes/' + encodeURIComponent('cofre/a.md');
  await tr.ask('PUT', cofre, { text: sealedText(5) }, tp);
  await tr.ask('DELETE', cofre, undefined, tp);
  const vrow = (await bin(tp)).find((x) => x.path === 'cofre/a.md');
  const vback = await tr.ask('POST', '/trash/' + vrow.id + '/restore', {}, tp);
  check('papelera: una nota de una carpeta protegida va y vuelve cifrada, tal como estaba', vrow.protected === true && vback.status === 200 && (await tr.ask('GET', cofre, undefined, tp)).json.text === sealedText(5), [vrow, vback.json]);
  await tr.ask('DELETE', cofre, undefined, tp);
  await tr.ask('PUT', cofre, { text: sealedText(6) }, tp);
  const vid2 = (await bin(tp)).find((x) => x.path === 'cofre/a.md').id;
  const rekey = await tr.ask('POST', '/trash/' + vid2 + '/restore', {}, tp);
  const plainIn = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: 'cofre/a (2).md', text: 'en claro' }, tp);
  const elsewhere = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: 'afuera.md', text: sealedText(7) }, tp);
  const rekeyed = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: rekey.json.to, text: sealedText(7) }, tp);
  check('papelera: con el nombre ocupado, una nota protegida pide que el navegador la vuelva a cifrar para el nombre nuevo', rekey.status === 409 && rekey.json.error === 'trash_rekey' && rekey.json.to === 'cofre/a (2).md' && rekey.json.text === sealedText(5) && plainIn.status === 409 && elsewhere.status === 409 &&
    rekeyed.status === 200 && rekeyed.json.path === 'cofre/a (2).md' && (await tr.ask('GET', '/notes/' + encodeURIComponent('cofre/a (2).md'), undefined, tp)).json.text === sealedText(7), [rekey.json, plainIn.json, elsewhere.json, rekeyed.json]);
  // Eliminar la carpeta protegida sin su contraseña.
  await tr.ask('PUT', '/notes/' + encodeURIComponent('cofre/b.md'), { text: sealedText(8) }, tp);
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('cofre/b.md'), undefined, tp);
  const wrongName = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'Cofre' }, tp);
  const notMine = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, tx);
  const gone = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, tp);
  const left = (await tr.ask('GET', '/notes', undefined, tp)).json.map((n) => n.path).sort();
  check('carpeta protegida: eliminarla sin la contraseña pide su nombre exacto y es solo de su dueño', wrongName.status === 400 && wrongName.json.error === 'bad_confirm' && notMine.status === 404, [wrongName.json, notMine.status]);
  check('carpeta protegida: se van la carpeta, sus notas y lo suyo de la papelera, y nada más', gone.status === 200 && gone.json.notes === 2 && (await tr.ask('GET', '/vaults', undefined, tp)).json.length === 0 && left.join() === 'proy/plan (2).md,proy/plan.md' && !(await bin(tp)).some((x) => x.path.startsWith('cofre/')), [gone.json, left, await bin(tp)]);
  check('carpeta protegida: después la carpeta vuelve a aceptar notas comunes', (await tr.ask('PUT', cofre, { text: 'en claro' }, tp)).status === 200);
  // Borrar del todo y vaciar.
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp); await tr.ask('DELETE', cofre, undefined, tp);
  const two = await bin(tp);
  const one = await tr.ask('DELETE', '/trash/' + two[0].id, undefined, tp);
  check('papelera: eliminar del todo saca solo esa', one.status === 200 && (await bin(tp)).length === two.length - 1 && (await tr.ask('POST', '/trash/' + two[0].id + '/restore', {}, tp)).status === 404);
  const forever = await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan (2).md') + '?forever=1', undefined, tp);
  check('papelera: lo que se mudó se borra sin pasar por la papelera', forever.json.trash === false && !(await bin(tp)).some((x) => x.path === 'proy/plan (2).md'));
  const empty = await tr.ask('DELETE', '/trash', undefined, tp);
  check('papelera: vaciar la deja sin nada', empty.status === 200 && empty.json.removed === two.length - 1 && (await bin(tp)).length === 0, empty.json);
  await tr.ask('PUT', '/notes/vence.md', { text: 'rabanito-vence' }, tp); await tr.ask('DELETE', '/notes/vence.md', undefined, tp);
  await tr.stop();
  check('papelera: con DATA_KEY, lo eliminado queda cifrado en el disco', !onDisk(trDir, 'rabanito-') && !onDisk(trDir, 'apio-plan') && onDisk(trDir, 'enc1:'));
  // Vencimiento: con un plazo de un segundo, lo de la papelera se purga solo.
  tr = await boot(trDir, { DATA_KEY: K1, TRASH_DAYS: String(1 / 86400) });
  await new Promise((r) => setTimeout(r, 1100));
  const kept = (await tr.ask('GET', '/trash', undefined, tp)).json.length;
  await tr.ask('PUT', '/notes/corta.md', { text: 'x' }, tp); await tr.ask('DELETE', '/notes/corta.md', undefined, tp);
  const fresh = (await tr.ask('GET', '/trash', undefined, tp)).json;
  await new Promise((r) => setTimeout(r, 1300));
  check('papelera: al vencer el plazo se purga sola', kept === 0 && fresh.length === 1 && (await tr.ask('GET', '/trash', undefined, tp)).json.length === 0 && (await tr.ask('POST', '/trash/' + fresh[0].id + '/restore', {}, tp)).status === 404, [kept, fresh]);
  await tr.stop(); wipe(trDir);

  // ---------- Eliminar la cuenta ----------
  const bye = (who, mail, ip) => call('DELETE', '/account', mail === undefined ? {} : { email: mail }, who, { 'x-forwarded-for': ip || '10.9.0.1' });
  await call('PUT', '/notes/mia.md', { text: 'de la cuenta que se va' }, ps);
  await call('DELETE', '/notes/mia.md', undefined, ps);
  await call('PUT', '/notes/queda.md', { text: 'de la cuenta que se va' }, ps);
  await paddle(sub('active'));
  const paying = await bye(ps, 'pago@ejemplo.test');
  check('eliminar la cuenta: con una suscripción activa no se borra, y dice dónde cancelarla', paying.status === 409 && paying.json.error === 'subscription_active' && paying.json.manage === 'https://portal.ejemplo.test' && (await call('GET', '/account', undefined, ps)).status === 200, paying.json);
  const tokP = (await call('POST', '/tokens', { name: 'IA' }, ps)).json.token;
  await call('POST', '/shares', { path: 'queda.md', email: 'ana@ejemplo.test', role: 'view' }, ps);
  const linkP = (await call('POST', '/links', { path: 'queda.md' }, ps)).json.token;
  await paddle(sub('canceled'));
  const noMail = await bye(ps); const wrongMail = await bye(ps, 'ana@ejemplo.test');
  check('eliminar la cuenta: hay que escribir el correo de la cuenta', noMail.status === 400 && wrongMail.status === 400 && wrongMail.json.error === 'bad_confirm' && (await call('GET', '/account', undefined, ps)).status === 200, [noMail.json, wrongMail.json]);
  check('eliminar la cuenta: sin sesión no hay ruta', (await call('DELETE', '/account', { email: 'pago@ejemplo.test' })).status === 401);
  const byeOk = await bye(ps, ' Pago@Ejemplo.test ');
  check('eliminar la cuenta: se borra, y la sesión, el token y el enlace dejan de servir', byeOk.status === 200 && (await call('GET', '/account', undefined, ps)).status === 401 && (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokP)).status === 401 && (await call('GET', '/public/' + linkP)).status === 404, byeOk.json);
  check('eliminar la cuenta: lo que había compartido ya no le llega a nadie', !(await call('GET', '/shared', undefined, s)).json.some((n) => n.by === 'pago@ejemplo.test'));
  const pc2 = await call('POST', '/auth/start', { email: 'pago@ejemplo.test' }, undefined, { 'x-forwarded-for': '10.9.0.2' }); const ps2 = (await call('POST', '/auth/verify', { email: 'pago@ejemplo.test', code: pc2.json.dev_code })).json.session;
  check('eliminar la cuenta: entrar de nuevo con ese correo es una cuenta nueva, vacía', (await call('GET', '/notes', undefined, ps2)).json.length === 0 && (await call('GET', '/trash', undefined, ps2)).json.length === 0 && (await call('GET', '/account', undefined, ps2)).json.plan === 'free');
  await paddle(sub('past_due'));
  check('eliminar la cuenta: un aviso viejo de su suscripción no le da el plan a la cuenta nueva', (await call('GET', '/account', undefined, ps2)).json.plan === 'free');
  let capped = null; for (let i = 0; i < 6; i++) capped = await bye(ps2, 'otro@ejemplo.test', '10.9.0.3');
  check('eliminar la cuenta: tiene tope de pedidos', capped.status === 429 && capped.json.error === 'too_many' && capped.json.retry_after > 0, capped.json);
  }

  // Alias de Gmail: una sola cuenta para la misma casilla
  {
    const enter = async (email, ip) => { const h = { 'x-forwarded-for': ip }; const st = await call('POST', '/auth/start', { email }, undefined, h); const v = await call('POST', '/auth/verify', { email, code: st.json.dev_code }, undefined, h); return { status: v.status, s: v.json.session, acc: v.json.account }; };
    const a = await enter('Maria.Gomez+trabajo@gmail.com', '10.8.0.1'); const b = await enter('mariagomez@gmail.com', '10.8.0.2'); const c = await enter('m.a.r.i.a.gomez+otra+mas@googlemail.com', '10.8.0.3');
    check('alias de Gmail: la cuenta se crea con el correo tal como se escribió', a.status === 200 && a.acc.email === 'maria.gomez+trabajo@gmail.com', a.acc);
    check('alias de Gmail: sin puntos, con otro + o con googlemail.com entra a la misma cuenta, que conserva su correo', b.acc.id === a.acc.id && c.acc.id === a.acc.id && b.acc.email === a.acc.email && c.acc.email === a.acc.email, [a.acc.id, b.acc.id, c.acc.id, c.acc.email]);
    await call('PUT', '/notes/alias.md', { text: '# Alias' }, a.s);
    check('alias de Gmail: las notas son las mismas entrando con cualquiera', (await call('GET', '/notes/alias.md', undefined, c.s)).json.text === '# Alias');
    const d = await enter('maria.gomez@ejemplo.test', '10.8.0.4'); const e = await enter('mariagomez@ejemplo.test', '10.8.0.5'); const f = await enter('mariagomez+x@ejemplo.test', '10.8.0.6');
    check('alias de Gmail: fuera de gmail.com y googlemail.com no se toca nada', new Set([a.acc.id, d.acc.id, e.acc.id, f.acc.id]).size === 4 && f.acc.email === 'mariagomez+x@ejemplo.test', [d.acc.id, e.acc.id, f.acc.id]);
    const g = await enter('otragmail@gmail.com', '10.8.0.7');
    check('alias de Gmail: otra casilla de Gmail es otra cuenta', g.acc.id !== a.acc.id && g.acc.email === 'otragmail@gmail.com');
  }

  check('cerrar sesión la invalida', (await call('POST', '/auth/logout', {}, s)).status === 200 && (await call('GET', '/notes', undefined, s)).status === 401);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(log); }
child.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(data, { recursive: true, force: true });
const bad = results.filter((x) => !x).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
process.exit(bad ? 1 : 0);
