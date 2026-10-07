// Seguridad: un caso por cada control del servidor, de la página de pago y de la app.
// Todo corre contra un servidor local con claves inventadas y contra la extensión cargada en un Chromium:
// ningún pedido sale a sync.sharpmd.app ni a sharpmd.app (lo que apunte ahí se corta y se anota como falla).
// SHARPMD_SERVER apunta a otro server.mjs, para comparar contra una versión anterior. SEC_ONLY=server|app corre una mitad.
import { spawn } from 'child_process'; import { createHmac } from 'crypto'; import { DatabaseSync } from 'node:sqlite';
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import net from 'net'; import { fileURLToPath, pathToFileURL } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = process.env.SHARPMD_SERVER || path.join(root, 'server', 'server.mjs');
const ONLY = process.env.SEC_ONLY || '';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 600))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const ADMIN = 'clave-de-prueba-0123456789'; const PADDLE = 'firma-de-prueba';

// Levanta un servidor con su carpeta de datos. Devuelve cómo llamarlo, su salida y cómo apagarlo.
let portSeq = 20000 + Math.floor(Math.random() * 3000);
async function boot(extra) {
  const port = ++portSeq; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsec-'));
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { log: '' }; proc.stdout.on('data', (d) => { st.log += d; }); proc.stderr.on('data', (d) => { st.log += d; });
  for (let i = 0; i < 80 && !/puerto/.test(st.log); i++) await sleep(100);
  const base = 'http://127.0.0.1:' + port;
  const call = async (method, url, body, auth, extraHeaders) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(extraHeaders || {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    let json = null; try { json = await r.json(); } catch (e) { /* sin cuerpo */ }
    return { status: r.status, json, headers: r.headers };
  };
  return { base, port, dir, call, proc, log: () => st.log, alive: () => proc.exitCode === null, db: () => new DatabaseSync(path.join(dir, 'mdtools.db')),
    stop: async () => { proc.kill(); await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo un rato después */ } } };
}
// Cada cuenta entra desde una IP distinta (la última de x-forwarded-for es la que cuenta), para que los topes por IP no se crucen entre casos.
let ipSeq = 0; const nextIp = () => '10.' + (20 + (ipSeq >> 8)) + '.' + (ipSeq++ & 255) + '.7';
const from = (ip) => ({ 'x-forwarded-for': ip });
const secrets = []; // todo lo que no puede aparecer en la salida del servidor
async function signup(S, email, ip) {
  const h = from(ip || nextIp());
  const st = await S.call('POST', '/auth/start', { email }, undefined, h);
  const v = await S.call('POST', '/auth/verify', { email, code: st.json.dev_code }, undefined, h);
  secrets.push(st.json.dev_code, v.json.session);
  return { s: v.json.session, id: v.json.account.id, email };
}
const makePro = (S, email) => S.call('POST', '/admin/plan', { email, plan: 'pro' }, undefined, { 'x-admin-key': ADMIN });
const tool = async (S, tok, name, args) => { const r = await S.call('POST', '/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = (r.json && r.json.result) || { content: [{ text: '' }], isError: true }; let v = c.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!c.isError, status: r.status }; };

async function serverSuite() {
  console.log('Seguridad del servidor');
  const S = await boot({ ADMIN_KEY: ADMIN, TEST_LOGIN: 'revision@ejemplo.test:246810', PADDLE_WEBHOOK_SECRET: PADDLE, FREE_NOTES: '3', ALLOW_ORIGINS: 'https://ejemplo.test', FEEDBACK_TO: 'duenio@ejemplo.test' });
  secrets.push(ADMIN, PADDLE);
  const { call } = S;
  try {
    // ---------- Autorización entre cuentas ----------
    console.log(' Autorización entre cuentas');
    const A = await signup(S, 'ana@ejemplo.test'); const B = await signup(S, 'beto@ejemplo.test'); const C = await signup(S, 'caro@ejemplo.test');
    await makePro(S, A.email); await makePro(S, C.email);
    const SECRET = 'ZANAHORIA-SECRETA-7731'; secrets.push(SECRET);
    for (const [p, t] of [['privada.md', '# Privada\n\n' + SECRET], ['proy/a.md', 'en proy'], ['proyecto/b.md', 'en proyecto ' + SECRET], ['Proy/c.md', 'en Proy con mayúscula ' + SECRET], ['proy.md', 'suelta ' + SECRET], ['a_b/d.md', 'guion bajo'], ['axb/e.md', 'equis ' + SECRET], ['ver.md', 'para ver'], ['editar.md', 'para editar']]) await call('PUT', '/notes/' + enc(p), { text: t }, A.s);
    await call('PUT', '/notes/privada.md', { text: '# Privada\n\n' + SECRET + '\n\nsegunda versión' }, A.s);
    const o = '?o=' + A.id;
    const leaks = (r) => JSON.stringify(r.json || '').includes(SECRET);
    const r1 = await call('GET', '/notes/privada.md' + o, undefined, B.s);
    check('otra cuenta no lee una nota ajena cambiando el dueño (?o=)', r1.status === 403 && !leaks(r1), r1);
    const r2 = [await call('PUT', '/notes/privada.md' + o, { text: 'pisada' }, B.s), await call('DELETE', '/notes/privada.md' + o, undefined, B.s), await call('PUT', '/notes/nueva-ajena.md' + o, { text: 'x' }, B.s)];
    check('ni la escribe, ni la borra, ni crea notas en la cuenta ajena', r2.every((r) => r.status === 403) && (await call('GET', '/notes/privada.md', undefined, A.s)).json.text.includes(SECRET), r2.map((r) => r.status));
    const r3 = [await call('GET', '/notes' + o, undefined, B.s), await call('GET', '/search?q=ZANAHORIA', undefined, B.s), await call('GET', '/shared', undefined, B.s), await call('GET', '/versions/privada.md', undefined, B.s), await call('GET', '/comments?path=privada.md&all=1', undefined, B.s), await call('GET', '/shares', undefined, B.s), await call('GET', '/tokens', undefined, B.s)];
    check('listar, buscar, historial, comentarios, compartidos y tokens devuelven solo lo propio', r3.every((r) => r.status === 200 && !leaks(r)) && r3[0].json.length === 0 && r3[1].json.length === 0, r3.map((r) => r.json));
    const ver = (await call('GET', '/versions/privada.md', undefined, A.s)).json;
    const r4 = ver.length ? await call('GET', '/version/' + ver[0].id, undefined, B.s) : { status: 0 };
    check('una versión del historial no se lee por id desde otra cuenta', ver.length === 1 && r4.status === 404 && !leaks(r4), [ver, r4.status]);
    const r5 = await call('POST', '/rename', { from: 'privada.md', to: 'robada.md' }, B.s);
    check('renombrar actúa solo sobre notas propias', r5.status === 404 && (await call('GET', '/notes/privada.md', undefined, A.s)).status === 200, r5);
    const odd = []; for (const v of ['abc', '0', '-1', '1e0', A.id + ' OR 1=1', A.id + '.0', '0x' + A.id.toString(16), '']) odd.push(await call('GET', '/notes/privada.md?o=' + enc(v), undefined, B.s));
    check('un dueño raro en ?o= nunca abre la nota', odd.every((r) => (r.status === 403 || r.status === 404) && !leaks(r)), odd.map((r) => r.status));
    // ids de otra cuenta en las rutas de borrado
    await call('POST', '/shares', { path: 'ver.md', email: C.email, role: 'view' }, A.s);
    await call('POST', '/shares', { path: 'editar.md', email: C.email, role: 'edit' }, A.s);
    const linkA = (await call('POST', '/links', { path: 'ver.md' }, A.s)).json; const tokA = (await call('POST', '/tokens', { name: 'de ana' }, A.s)).json; secrets.push(linkA.token, tokA.token);
    const comA = (await call('POST', '/comments', { path: 'privada.md', quote: 'q', text: 'comentario de ana' }, A.s)).json;
    const mine = (await call('GET', '/shares', undefined, A.s)).json; const tokId = (await call('GET', '/tokens', undefined, A.s)).json[0].id;
    for (const who of [B.s, C.s]) { for (const s of mine.people) await call('DELETE', '/shares/' + s.id, undefined, who); for (const l of mine.links) await call('DELETE', '/links/' + l.id, undefined, who); await call('DELETE', '/tokens/' + tokId, undefined, who); await call('DELETE', '/comments/' + comA.id, undefined, who); }
    const after = (await call('GET', '/shares', undefined, A.s)).json;
    check('borrar por id lo compartido, un enlace, un token o un comentario ajeno no borra nada', after.people.length === mine.people.length && after.links.length === mine.links.length && (await call('GET', '/tokens', undefined, A.s)).json.length === 1 && (await call('GET', '/comments?path=privada.md', undefined, A.s)).json.length === 1, after);
    const r6 = [await call('POST', '/comments', { path: 'privada.md', text: 'desde afuera' }, C.s), await call('GET', '/comments?path=privada.md&all=1', undefined, C.s)];
    check('comentar o leer comentarios alcanza solo las notas propias', r6[0].status === 404 && r6[1].json.length === 0, r6.map((r) => [r.status, r.json]));

    console.log(' Roles de lo compartido');
    const v1 = await call('GET', '/notes/ver.md' + o, undefined, C.s);
    const v2 = [await call('PUT', '/notes/ver.md' + o, { text: 'x' }, C.s), await call('DELETE', '/notes/ver.md' + o, undefined, C.s)];
    check('con permiso de ver: lee, no escribe ni borra', v1.status === 200 && v1.json.role === 'view' && v2.every((r) => r.status === 403), [v1.status, v2.map((r) => r.status)]);
    const e1 = await call('PUT', '/notes/editar.md' + o, { text: 'editada por caro' }, C.s);
    const e2 = [await call('DELETE', '/notes/editar.md' + o, undefined, C.s), await call('POST', '/shares', { path: 'editar.md', email: B.email, role: 'edit' }, C.s), await call('POST', '/links', { path: 'editar.md' }, C.s), await call('POST', '/rename', { from: 'editar.md', to: 'mia.md' }, C.s)];
    const stillA = (await call('GET', '/shares?path=editar.md', undefined, A.s)).json;
    check('con permiso de editar: escribe, pero no borra, no comparte, no crea enlaces ni renombra', e1.status === 200 && e2[0].status === 403 && e2.slice(1).every((r) => r.status === 404) && stillA.people.length === 1 && stillA.links.length === 0 && (await call('GET', '/notes/editar.md', undefined, A.s)).status === 200, e2.map((r) => r.status));
    check('compartir una nota no abre otras del mismo dueño', (await call('GET', '/notes/privada.md' + o, undefined, C.s)).status === 403);
    await call('POST', '/shares', { path: 'proy', kind: 'folder', email: C.email, role: 'edit' }, A.s);
    await call('POST', '/shares', { path: 'a_b', kind: 'folder', email: C.email, role: 'view' }, A.s);
    const f1 = await call('GET', '/notes/' + enc('proy/a.md') + o, undefined, C.s);
    const f2 = []; for (const p of ['proyecto/b.md', 'Proy/c.md', 'proy.md', 'axb/e.md', 'privada.md']) f2.push(await call('GET', '/notes/' + enc(p) + o, undefined, C.s));
    check('una carpeta compartida no abre hermanas de nombre parecido (proy / proyecto / Proy / proy.md, a_b / axb)', f1.status === 200 && f2.every((r) => r.status === 403 && !leaks(r)), f2.map((r) => r.status));
    const listed = [(await call('GET', '/shared', undefined, C.s)).json, (await call('GET', '/notes' + o, undefined, C.s)).json];
    const paths = listed.map((l) => l.map((n) => n.path).sort().join());
    check('ni las lista: /shared y /notes?o= muestran solo lo que cubre el permiso', paths[0] === 'a_b/d.md,editar.md,proy/a.md,ver.md' && paths[1] === paths[0], paths);
    const ev = [await fetch(S.base + '/events?path=privada.md&o=' + A.id, { headers: { authorization: 'Bearer ' + C.s } }), await fetch(S.base + '/events?path=privada.md')];
    check('los eventos en vivo de una nota piden permiso sobre esa nota', ev[0].status === 403 && ev[1].status === 401, ev.map((r) => r.status));
    // Borrar una nota se lleva su enlace público y lo compartido
    await call('PUT', '/notes/temporal.md', { text: 'primera vida' }, A.s);
    const tl = (await call('POST', '/links', { path: 'temporal.md' }, A.s)).json; await call('POST', '/shares', { path: 'temporal.md', email: C.email, role: 'edit' }, A.s);
    await call('DELETE', '/notes/temporal.md', undefined, A.s); await call('PUT', '/notes/temporal.md', { text: 'segunda vida, privada' }, A.s);
    const reborn = [await call('GET', '/public/' + tl.token), await call('GET', '/notes/temporal.md' + o, undefined, C.s)];
    check('una nota borrada y vuelta a crear no hereda el enlace público ni lo compartido', reborn[0].status === 404 && reborn[1].status === 403, reborn.map((r) => r.status));

    // ---------- Tokens de MCP ----------
    console.log(' Tokens de MCP');
    const sesTok = [await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, A.s), await call('GET', '/notes', undefined, tokA.token), await call('GET', '/account', undefined, tokA.token), await call('POST', '/tokens', { name: 'x' }, tokA.token), await call('POST', '/links', { path: 'ver.md' }, tokA.token)];
    check('una sesión no sirve como token de MCP ni un token como sesión', sesTok.every((r) => r.status === 401), sesTok.map((r) => r.status));
    const I = await signup(S, 'ia@ejemplo.test'); await makePro(S, I.email);
    for (const [p, t] of [['alfa/plan.md', 'plan de alfa'], ['alfa/notas/r.md', 'reunion'], ['beta/ideas.md', 'ideas ' + SECRET], ['alfabeto/x.md', 'parecida ' + SECRET], ['Alfa/y.md', 'mayúscula ' + SECRET], ['suelta.md', 'suelta ' + SECRET]]) await call('PUT', '/notes/' + enc(p), { text: t }, I.s);
    const lim = (await call('POST', '/tokens', { name: 'alfa', folder: 'alfa/' }, I.s)).json; secrets.push(lim.token);
    const outside = ['beta/ideas.md', 'alfa/../beta/ideas.md', 'alfa/./../beta/ideas.md', '../beta/ideas.md', 'alfa//../beta/ideas.md', '/beta/ideas.md', '\\beta\\ideas.md', 'alfa\\..\\beta\\ideas.md', 'alfabeto/x.md', 'Alfa/y.md', 'ALFA/plan.md', 'suelta.md', 'alfa', ' beta/ideas.md'];
    const reads = []; for (const p of outside) reads.push(await tool(S, lim.token, 'read_note', { path: p }));
    check('token de carpeta: read_note no sale de la carpeta (.., barras dobles, mayúsculas, prefijos parecidos)', reads.every((r) => r.err && !JSON.stringify(r.v).includes(SECRET)), reads.map((r, i) => [outside[i], r.err]).filter((x) => !x[1]));
    const writes = []; for (const p of outside.filter((x) => x !== 'alfa')) { writes.push(await tool(S, lim.token, 'write_note', { path: p, text: 'PISADA' })); writes.push(await tool(S, lim.token, 'append_note', { path: p, text: 'PISADA' })); }
    const all = (await call('GET', '/search?q=PISADA', undefined, I.s)).json;
    check('token de carpeta: write_note y append_note tampoco', writes.every((r) => r.err) && all.length === 0, all);
    const scopedLists = [await tool(S, lim.token, 'list_notes', { folder: 'beta' }), await tool(S, lim.token, 'list_notes', {}), await tool(S, lim.token, 'list_folders'), await tool(S, lim.token, 'search_notes', { query: 'ZANAHORIA' }), await tool(S, lim.token, 'search_notes', { query: 'ideas' })];
    check('token de carpeta: listar, carpetas y búsqueda muestran solo su carpeta', scopedLists[0].v.length === 0 && scopedLists[1].v.map((n) => n.path).sort().join() === 'alfa/notas/r.md,alfa/plan.md' && scopedLists[2].v.every((f) => f.folder === 'alfa' || f.folder.startsWith('alfa/')) && scopedLists[3].v.length === 0 && scopedLists[4].v.length === 0, scopedLists.map((r) => r.v));
    const cIn = (await call('POST', '/comments', { path: 'alfa/plan.md', quote: 'q', text: 'adentro' }, I.s)).json; const cOut = (await call('POST', '/comments', { path: 'beta/ideas.md', quote: 'q', text: 'afuera ' + SECRET }, I.s)).json;
    const coms = [await tool(S, lim.token, 'list_comments', {}), await tool(S, lim.token, 'list_comments', { path: 'beta/ideas.md' }), await tool(S, lim.token, 'resolve_comment', { id: cOut.id, reply: 'x' }), await tool(S, lim.token, 'resolve_comment', { id: comA.id, reply: 'x' }), await tool(S, lim.token, 'resolve_comment', { id: String(cOut.id) + ' OR 1=1' })];
    const openOut = (await call('GET', '/comments?path=' + enc('beta/ideas.md'), undefined, I.s)).json;
    check('token de carpeta: no ve ni cierra comentarios de otra carpeta ni de otra cuenta', coms[0].v.length === 1 && coms[0].v[0].id === cIn.id && coms.slice(1).every((r) => r.err) && openOut.length === 1 && (await call('GET', '/comments?path=privada.md', undefined, A.s)).json.length === 1, coms.map((r) => r.v));
    const full = (await call('POST', '/tokens', { name: 'todo' }, I.s)).json; secrets.push(full.token);
    const cross = [await tool(S, full.token, 'read_note', { path: 'privada.md' }), await tool(S, full.token, 'search_notes', { query: 'Privada' })];
    check('un token sin límite de carpeta igual no sale de su cuenta', cross[0].err && cross[1].v.length === 0, cross.map((r) => r.v));
    const tid = (await call('GET', '/tokens', undefined, I.s)).json.find((t) => t.name === 'todo').id;
    await call('DELETE', '/tokens/' + tid, undefined, I.s);
    check('un token revocado deja de servir', (await tool(S, full.token, 'list_notes')).status === 401);
    check('los tokens se guardan como hash', (() => { const d = S.db(); const rows = d.prepare('SELECT hash FROM tokens').all(); const ses = d.prepare('SELECT hash FROM sessions').all(); d.close(); return rows.length > 0 && rows.concat(ses).every((r) => /^[0-9a-f]{64}$/.test(r.hash)) && !rows.some((r) => r.hash.includes('mdt_')); })());
    await call('POST', '/admin/plan', { email: I.email, plan: 'free' }, undefined, { 'x-admin-key': ADMIN });
    const freeMcp = [await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, lim.token), await call('POST', '/tokens', { name: 'gratis' }, I.s), await call('POST', '/comments', { path: 'alfa/plan.md', text: 'hola' }, I.s)];
    check('MCP exige el plan pago: al volver a gratis, el token ya no entra', freeMcp.every((r) => r.status === 402), freeMcp.map((r) => r.status));
    await makePro(S, I.email);
    const bad = []; for (const b of ['null', '[null]', '"x"', '7', '[[]]', '{"method":"tools/call","id":1,"params":null}', '{"method":"tools/call","id":1,"params":{"name":"read_note","arguments":"x"}}', '{"method":"tools/call","id":1,"params":{"name":"__proto__"}}']) bad.push(await call('POST', '/mcp', b, lim.token));
    check('MCP: un mensaje mal armado no produce un error del servidor', bad.every((r) => r.status < 500), bad.map((r) => r.status));
    const big = await call('POST', '/mcp', Array.from({ length: 51 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'search_notes', arguments: { query: 'a' } } })), lim.token);
    check('MCP: un lote de más de 50 mensajes se rechaza', big.status === 413, big.status);
    for (let i = 0; i < 60; i++) await call('POST', '/tokens', { name: 't' + i }, I.s);
    const nTok = (await call('GET', '/tokens', undefined, I.s)).json.length;
    check('hay un tope de tokens por cuenta', nTok === 50 && (await call('POST', '/tokens', { name: 'uno más' }, I.s)).status === 429, nTok);

    // ---------- Inicio de sesión ----------
    console.log(' Inicio de sesión');
    const ip1 = nextIp(); const st1 = await call('POST', '/auth/start', { email: 'fuerza@ejemplo.test' }, undefined, from(ip1)); secrets.push(st1.json.dev_code);
    const wrong = (c) => (c === '111111' ? '222222' : '111111');
    const tries = []; for (let i = 0; i < 6; i++) tries.push((await call('POST', '/auth/verify', { email: 'fuerza@ejemplo.test', code: wrong(st1.json.dev_code) }, undefined, from(ip1))).status);
    const burned = await call('POST', '/auth/verify', { email: 'fuerza@ejemplo.test', code: st1.json.dev_code }, undefined, from(ip1));
    check('un código admite seis intentos: después ni el correcto entra', tries.every((x) => x === 400) && burned.status === 429, [tries, burned.status]);
    const U = await signup(S, 'unavez@ejemplo.test'); const ipU = nextIp();
    const st2 = await call('POST', '/auth/start', { email: 'dosveces@ejemplo.test' }, undefined, from(ipU));
    const once = [await call('POST', '/auth/verify', { email: 'dosveces@ejemplo.test', code: st2.json.dev_code }, undefined, from(ipU)), await call('POST', '/auth/verify', { email: 'dosveces@ejemplo.test', code: st2.json.dev_code }, undefined, from(ipU))];
    secrets.push(st2.json.dev_code, once[0].json.session);
    check('un código sirve una sola vez', once[0].status === 200 && once[1].status === 400 && once[1].json.error === 'code_expired', once.map((r) => r.status));
    const st3 = await call('POST', '/auth/start', { email: 'vence@ejemplo.test' }, undefined, from(nextIp())); secrets.push(st3.json.dev_code);
    { const d = S.db(); d.prepare('UPDATE codes SET expires = ? WHERE email = ?').run(Date.now() - 1000, 'vence@ejemplo.test'); d.close(); }
    const exp = await call('POST', '/auth/verify', { email: 'vence@ejemplo.test', code: st3.json.dev_code }, undefined, from(nextIp()));
    check('un código vencido no entra', exp.status === 400 && exp.json.error === 'code_expired', exp);
    check('el código se guarda como hash, no en claro', (() => { const d = S.db(); const rows = d.prepare('SELECT hash FROM codes').all(); d.close(); return rows.length > 0 && rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash)); })());
    // Enumeración: pedir y verificar responden igual exista o no la cuenta
    const en = [await call('POST', '/auth/start', { email: 'unavez@ejemplo.test' }, undefined, from(nextIp())), await call('POST', '/auth/start', { email: 'no-existe@ejemplo.test' }, undefined, from(nextIp()))];
    secrets.push(en[0].json.dev_code, en[1].json.dev_code);
    const en2 = [await call('POST', '/auth/verify', { email: 'unavez@ejemplo.test', code: wrong(en[0].json.dev_code) }, undefined, from(nextIp())), await call('POST', '/auth/verify', { email: 'no-existe@ejemplo.test', code: wrong(en[1].json.dev_code) }, undefined, from(nextIp())), await call('POST', '/auth/verify', { email: 'jamas-pidio@ejemplo.test', code: '123456' }, undefined, from(nextIp()))];
    check('pedir un código responde igual exista o no la cuenta', en[0].status === 200 && en[1].status === 200 && Object.keys(en[0].json).join() === Object.keys(en[1].json).join() && en2[0].status === en2[1].status && en2[0].json.error === en2[1].json.error && en2[2].json.error === 'code_expired', [en.map((r) => r.json && Object.keys(r.json)), en2.map((r) => r.json)]);
    // Tope por correo: cinco códigos por hora aunque cada uno se use bien
    const perMail = []; const ipM = nextIp();
    for (let i = 0; i < 7; i++) { const s = await call('POST', '/auth/start', { email: 'bombardeo@ejemplo.test' }, undefined, from(nextIp())); perMail.push(s.status); if (s.status === 200) { secrets.push(s.json.dev_code); const v = await call('POST', '/auth/verify', { email: 'bombardeo@ejemplo.test', code: s.json.dev_code }, undefined, from(ipM)); secrets.push(v.json && v.json.session); } }
    check('pedir códigos tiene tope por correo: cinco por hora, venga de la IP que venga', perMail.join() === '200,200,200,200,200,429,429', perMail);
    const perIp = []; const ipFlood = nextIp();
    for (let i = 0; i < 22; i++) { const s = await call('POST', '/auth/start', { email: 'victima' + i + '@ejemplo.test' }, undefined, from(ipFlood)); perIp.push(s.status); if (s.json && s.json.dev_code) secrets.push(s.json.dev_code); }
    const otherIp = await call('POST', '/auth/start', { email: 'tranquila@ejemplo.test' }, undefined, from(nextIp())); secrets.push(otherIp.json && otherIp.json.dev_code);
    check('y por IP: veinte por hora, sin frenar a las demás', perIp.slice(0, 20).every((x) => x === 200) && perIp[20] === 429 && perIp[21] === 429 && otherIp.status === 200, perIp);
    check('una IP inventada adelante en x-forwarded-for no saltea el tope', (await call('POST', '/auth/start', { email: 'otra-mas@ejemplo.test' }, undefined, { 'x-forwarded-for': '1.2.3.4, ' + ipFlood })).status === 429);
    // Fallos por IP: treinta por hora, repartidos entre varios correos
    const ipG = nextIp(); let lastCode = '';
    for (let k = 0; k < 6; k++) { const s = await call('POST', '/auth/start', { email: 'adivina' + k + '@ejemplo.test' }, undefined, from(nextIp())); lastCode = s.json.dev_code; secrets.push(lastCode); if (k < 5) for (let i = 0; i < 6; i++) await call('POST', '/auth/verify', { email: 'adivina' + k + '@ejemplo.test', code: wrong(lastCode) }, undefined, from(ipG)); }
    const ipBlocked = await call('POST', '/auth/verify', { email: 'adivina5@ejemplo.test', code: lastCode }, undefined, from(ipG));
    const ipFree = await call('POST', '/auth/verify', { email: 'adivina5@ejemplo.test', code: lastCode }, undefined, from(nextIp())); secrets.push(ipFree.json && ipFree.json.session);
    check('probar códigos tiene tope por IP: treinta fallos por hora entre todos los correos', ipBlocked.status === 429 && ipFree.status === 200, [ipBlocked.status, ipFree.status]);
    // Cuenta de prueba: el código fijo no da nada especial, y pedir otro código no devuelve los intentos
    const tst = await call('POST', '/auth/start', { email: 'revision@ejemplo.test' }, undefined, from(nextIp()));
    const tv = await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' }, undefined, from(nextIp())); secrets.push(tv.json.session);
    const ipO = nextIp(); await call('POST', '/auth/start', { email: 'otra@ejemplo.test' }, undefined, from(ipO));
    const fixedOther = await call('POST', '/auth/verify', { email: 'otra@ejemplo.test', code: '246810' }, undefined, from(ipO));
    check('la cuenta de prueba: sin código en la respuesta, plan gratis, sin MCP, y su código no abre otra cuenta', tst.status === 200 && !tst.json.dev_code && tv.json.account.plan === 'free' && tv.json.account.mcp === false && tv.json.account.share === false && (await call('POST', '/admin/plan', { email: 'x@ejemplo.test', plan: 'pro' }, tv.json.session)).status === 403 && fixedOther.status === 400, [tst.json, tv.json.account, fixedOther.status]);
    const fx = [];
    for (let round = 0; round < 3; round++) { await call('POST', '/auth/start', { email: 'revision@ejemplo.test' }, undefined, from(nextIp())); for (let i = 0; i < 5; i++) fx.push((await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '00000' + i }, undefined, from(nextIp()))).status); }
    await call('POST', '/auth/start', { email: 'revision@ejemplo.test' }, undefined, from(nextIp()));
    const fxLocked = await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' }, undefined, from(nextIp()));
    check('pedir otro código no reinicia los intentos: diez fallos por hora por correo, y después ni el correcto', fx.slice(0, 10).every((x) => x === 400) && fx.slice(10).every((x) => x === 429) && fxLocked.status === 429, [fx, fxLocked.status]);
    const junk = []; for (const b of ['null', '[]', '"x"', '7', '{"email":{"a":1}}', '{"email":["a@b.test"]}', '{"email":null}', '{bad', '{"email":"","code":{"$ne":1}}']) { junk.push(await call('POST', '/auth/start', b, undefined, from(nextIp()))); junk.push(await call('POST', '/auth/verify', b, undefined, from(nextIp()))); }
    check('pedidos de acceso mal armados responden 400, nunca un error del servidor', junk.every((r) => r.status === 400), junk.map((r) => r.status));
    { const d = S.db(); d.prepare('UPDATE sessions SET seen = ? WHERE user = ?').run(Date.now() - 181 * 86400000, U.id); d.close(); }
    check('una sesión sin uso en 180 días deja de servir', (await call('GET', '/account', undefined, U.s)).status === 401);
    const out = await signup(S, 'sale@ejemplo.test'); await call('POST', '/auth/logout', {}, out.s);
    check('cerrar sesión la invalida en el servidor', (await call('GET', '/account', undefined, out.s)).status === 401);

    // ---------- Enlaces públicos ----------
    console.log(' Enlaces públicos');
    await call('PUT', '/notes/' + enc('clientes/acme/oferta.md'), { text: '# Oferta\n\npública' }, A.s);
    const l1 = (await call('POST', '/links', { path: 'clientes/acme/oferta.md' }, A.s)).json; const l2 = (await call('POST', '/links', { path: 'clientes/acme/oferta.md', password: 'manzana-42' }, A.s)).json; secrets.push(l1.token, l2.token, 'manzana-42');
    check('el token de un enlace es largo y al azar, y se guarda como hash', l1.token.length >= 32 && l1.token !== l2.token && (() => { const d = S.db(); const rows = d.prepare('SELECT hash, pass FROM links').all(); d.close(); return rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash) && !(r.pass || '').includes('manzana')); })(), l1.token.length);
    const pub = await call('GET', '/public/' + l1.token);
    check('un enlace público entrega el nombre, el texto y la fecha: ni carpetas, ni dueño, ni correo', pub.status === 200 && Object.keys(pub.json).sort().join() === 'path,text,updated' && pub.json.path === 'oferta.md' && !JSON.stringify(pub.json).includes('ana@'), pub.json);
    const guess = []; for (const t of ['a', 'abcdef', l1.token.slice(0, -1), l1.token + 'x', l1.token.toUpperCase(), '%00', '1', "' OR 1=1 --"]) guess.push((await call('GET', '/public/' + enc(t))).status);
    check('un token parecido o inventado no abre nada', guess.every((x) => x === 404), guess);
    const pw = [await call('GET', '/public/' + l2.token), await call('GET', '/public/' + l2.token, undefined, undefined, { 'x-password': 'pera' }), await call('GET', '/public/' + l2.token, undefined, undefined, { 'x-password': 'manzana-42' })];
    check('con contraseña: la pide, rechaza la equivocada sin dar el texto y abre con la correcta', pw[0].status === 401 && pw[1].status === 403 && !JSON.stringify(pw[0].json).includes('pública') && !JSON.stringify(pw[1].json).includes('pública') && pw[2].status === 200, pw.map((r) => r.status));
    for (let i = 0; i < 10; i++) await call('GET', '/public/' + l2.token, undefined, undefined, { 'x-password': 'no' + i });
    const lock = [await call('GET', '/public/' + l2.token, undefined, undefined, { 'x-password': 'manzana-42' }), await call('GET', '/notes/' + enc('clientes/acme/oferta.md'), undefined, A.s), await call('GET', '/public/' + l1.token)];
    check('diez fallos bloquean ese enlace, sin dejar afuera al dueño ni a los otros enlaces de la nota', lock[0].status === 429 && lock[1].status === 200 && lock[2].status === 200, lock.map((r) => r.status));
    check('una contraseña de enlace desmedida se rechaza al crearlo', (await call('POST', '/links', { path: 'ver.md', password: 'x'.repeat(201) }, A.s)).status === 400);
    check('crear enlaces públicos es de quien tiene el plan y la nota', (await call('POST', '/links', { path: 'x.md' }, B.s)).status === 402 && (await call('POST', '/links', { path: 'no-existe.md' }, A.s)).status === 404);

    // ---------- Paddle ----------
    console.log(' Avisos de Paddle');
    const P = await signup(S, 'pago@ejemplo.test'); const X = await signup(S, 'atacante@ejemplo.test');
    const paddle = async (ev, o2) => { o2 = o2 || {}; const raw = typeof ev === 'string' ? ev : JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000) + (o2.skew || 0); const h1 = createHmac('sha256', o2.secret || PADDLE).update(ts + ':' + raw).digest('hex'); const r = await fetch(S.base + '/paddle/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(o2.header === null ? {} : { 'paddle-signature': o2.header || 'ts=' + ts + ';h1=' + h1 }) }, body: o2.body || raw }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const sub = (id, status, mail, at, extra) => ({ event_type: 'subscription.updated', occurred_at: at, data: { id, status, items: [{ price: { id: 'pri_1', custom_data: { app: 'sharpmd' } } }], ...(mail ? { custom_data: { sharpmd_email: mail } } : {}), ...extra } });
    const planOf = async (u) => (await call('GET', '/account', undefined, u.s)).json.plan;
    const T0 = Date.now() - 3600000; const iso = (min) => new Date(T0 + min * 60000).toISOString();
    const sig = [await paddle(sub('sub_p', 'active', P.email, iso(0)), { secret: 'otra' }), await paddle(sub('sub_p', 'active', P.email, iso(0)), { header: null }), await paddle(sub('sub_p', 'active', P.email, iso(0)), { header: 'ts=1;h1=' }), await paddle(sub('sub_p', 'active', P.email, iso(0)), { header: 'basura' }), await paddle(sub('sub_p', 'active', P.email, iso(0)), { body: JSON.stringify(sub('sub_p', 'active', X.email, iso(0))) })];
    check('Paddle: sin firma, con otra clave, mal formada o sobre otro cuerpo, el aviso se rechaza', sig.every((r) => r.status === 401) && (await planOf(P)) === 'free' && (await planOf(X)) === 'free', sig.map((r) => r.status));
    const old = [await paddle(sub('sub_p', 'active', P.email, iso(0)), { skew: -600 }), await paddle(sub('sub_p', 'active', P.email, iso(0)), { skew: 600 })];
    check('Paddle: una firma de hace más de cinco minutos (o del futuro) no entra', old.every((r) => r.status === 401) && (await planOf(P)) === 'free', old.map((r) => r.status));
    const other = await paddle({ event_type: 'subscription.created', occurred_at: iso(1), data: { id: 'sub_otro', status: 'active', custom_data: { sharpmd_email: P.email }, items: [{ price: { id: 'pri_x', custom_data: { app: 'otra-cosa' } } }] } });
    const notSub = await paddle({ event_type: 'transaction.completed', occurred_at: iso(1), data: { id: 'txn_1', status: 'completed', custom_data: { sharpmd_email: P.email }, items: [{ price: { custom_data: { app: 'sharpmd' } } }] } });
    check('Paddle: un aviso firmado de otro producto, o que no es de suscripción, no cambia nada', other.json.ignored === 'product' && notSub.json.ignored === 'event' && (await planOf(P)) === 'free', [other.json, notSub.json]);
    await paddle(sub('sub_p', 'active', P.email, iso(2)));
    check('Paddle: el aviso firmado de una suscripción activa pasa la cuenta a pago', (await planOf(P)) === 'pro');
    // Quien controla el formulario de pago pone el correo que quiere en custom_data: no puede sacarle el plan a otro
    await paddle(sub('sub_x', 'active', P.email, iso(3)));
    await paddle(sub('sub_x', 'canceled', P.email, iso(4)));
    check('Paddle: pagar una suscripción a nombre de otro y cancelarla no le saca el plan que esa persona paga', (await planOf(P)) === 'pro');
    await paddle(sub('sub_p', 'canceled', null, iso(5)));
    check('Paddle: al cancelarse la suscripción propia, la cuenta vuelve a gratis', (await planOf(P)) === 'free');
    const replay = await paddle(sub('sub_p', 'active', P.email, iso(2)));
    check('Paddle: repetir un aviso viejo de alta, ya cancelada, no devuelve el plan pago', (await planOf(P)) === 'free' && replay.json.ignored === 'stale', replay.json);
    await paddle(sub('sub_p', 'active', X.email, iso(6)));
    check('Paddle: una suscripción queda atada a su cuenta: otro correo en custom_data no la muda', (await planOf(X)) === 'free' && (await planOf(P)) === 'pro', [await planOf(X), await planOf(P)]);
    const weird = []; for (const b of ['null', '[]', '7', '"x"', '{"event_type":"subscription.updated","data":null}', '{"event_type":"subscription.updated","data":{"items":"x"}}', '{"event_type":"subscription.updated","data":{"id":{"a":1},"items":[{"price":{"custom_data":{"app":"sharpmd"}}}],"custom_data":{"sharpmd_email":["a"]}}}', '{bad']) weird.push((await paddle(b)).status);
    check('Paddle: un cuerpo firmado pero mal armado no produce un error del servidor', weird.every((x) => x < 500), weird);

    // ---------- Clave de administración ----------
    console.log(' Clave de administración');
    const ipA = nextIp(); const adm = [];
    for (const k of [undefined, '', 'x', ADMIN.slice(0, -1) + 'X', ADMIN + 'x', ADMIN.toUpperCase()]) adm.push(await call('POST', '/admin/plan', { email: B.email, plan: 'pro' }, undefined, k === undefined ? from(ipA) : { 'x-admin-key': k, ...from(ipA) }));
    check('la clave de administración: sin clave o con una equivocada, la misma respuesta y ningún cambio', adm.every((r) => r.status === 403 && JSON.stringify(r.json) === JSON.stringify(adm[0].json)) && (await call('GET', '/account', undefined, B.s)).json.plan === 'free', adm.map((r) => [r.status, r.json]));
    for (let i = 0; i < 6; i++) await call('POST', '/admin/plan', { email: B.email, plan: 'pro' }, undefined, { 'x-admin-key': 'prueba' + i, ...from(ipA) });
    const admLock = [await call('POST', '/admin/plan', { email: B.email, plan: 'pro' }, undefined, { 'x-admin-key': ADMIN, ...from(ipA) }), await call('POST', '/admin/plan', { email: 'no-existe@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': ADMIN })];
    check('probar claves de administración tiene tope por IP, y la clave buena sigue andando desde otra', admLock[0].status === 429 && admLock[1].status === 404 && (await call('GET', '/account', undefined, B.s)).json.plan === 'free', admLock.map((r) => r.status));
    check('la sesión o el token de una cuenta no sirven como clave de administración', (await call('POST', '/admin/plan', { email: B.email, plan: 'pro' }, A.s)).status === 403 && (await call('POST', '/admin/plan', { email: B.email, plan: 'pro' }, undefined, { 'x-admin-key': A.s })).status === 403);

    // ---------- Entradas ----------
    console.log(' Entradas');
    const huge = await call('PUT', '/notes/grande.md', { text: 'x'.repeat(2.2 * 1024 * 1024) }, A.s).catch((e) => ({ status: 0, err: String(e) }));
    const large = await call('PUT', '/notes/grande.md', { text: 'x'.repeat(1024 * 1024 + 1) }, A.s);
    const fits = await call('PUT', '/notes/grande.md', { text: 'x'.repeat(1024 * 1024) }, A.s);
    check('una nota de más de 1 MB o un cuerpo de más de 2 MB se rechazan con 413', huge.status === 413 && large.status === 413 && fits.status === 200, [huge, large.status, fits.status]);
    await call('DELETE', '/notes/grande.md', undefined, A.s);
    const badPaths = ['../afuera.md', 'a/../../b.md', 'a/./b.md', 'a//b.md', '.', 'a/', 'x'.repeat(301) + '.md', 'con\nsalto.md', 'con\u0000nulo.md', 'con\ttab.md', '..\\afuera.md', ' '];
    const bp = []; for (const p of badPaths) bp.push((await call('PUT', '/notes/' + enc(p), { text: 'x' }, A.s)).status);
    const bp2 = []; for (const u of ['/notes/%E0%A4%A', '/versions/%E0%A4%A', '/public/%E0%A4%A', '/notes/%', '/notes/%zz']) bp2.push((await call('GET', u, undefined, A.s)).status);
    check('rutas con .., vacías, larguísimas o con caracteres de control se rechazan con 400', bp.every((x) => x === 400), bp);
    check('una dirección mal codificada responde 400, no un error del servidor', bp2.every((x) => x === 400), bp2);
    const sqli = "x'); DROP TABLE notes;--.md";
    const inj = [await call('PUT', '/notes/' + enc(sqli), { text: "'; DELETE FROM users;--" }, A.s), await call('GET', '/notes/' + enc(sqli), undefined, A.s), await call('GET', '/search?q=' + enc("%' OR '1'='1"), undefined, B.s), await call('GET', '/search?q=' + enc('%'), undefined, B.s), await call('POST', '/rename', { from: sqli, to: 'limpia.md' }, A.s), await call('GET', '/notes/privada.md?o=' + enc(A.id + "' OR '1'='1"), undefined, B.s), await call('POST', '/auth/start', { email: "a'--@ejemplo.test" }, undefined, from(nextIp()))];
    check('comillas y SQL en rutas, búsquedas, dueño y correo viajan como datos', inj[0].status === 200 && inj[1].json.text === "'; DELETE FROM users;--" && inj[2].json.length === 0 && inj[3].json.length === 0 && inj[4].status === 200 && inj[5].status === 403 && (await call('GET', '/notes/privada.md', undefined, A.s)).status === 200 && (await call('GET', '/account', undefined, B.s)).status === 200, inj.map((r) => r.status));
    // Leyendo el código: la única consulta que se arma por partes (listComments) pega dos tramos fijos, nunca un dato.
    const src = fs.readFileSync(SERVER, 'utf8'); const glued = src.split('\n').filter((l) => /\bq\((['"])(?:(?!\1).)*\1\s*\+/.test(l));
    const tpl = /\bq\(`|db\.exec\(`[^`]*\$\{|db\.exec\([^`'"]/.test(src) || (src.match(/db\.prepare\(/g) || []).length !== 1;
    check('ninguna consulta arma el SQL pegando datos: todo va con parámetros', (src.match(/\bq\(['"]/g) || []).length > 40 && glued.length === 1 && /const listComments/.test(glued[0]) && /\(p \? ' AND path = \?' : ''\) \+ \(all \? '' : " AND status = 'open'"\) \+ ' ORDER BY created'/.test(glued[0]) && !tpl, [glued.length, tpl]);
    const hdr = await new Promise((resolve) => { const s = net.connect(S.port, '127.0.0.1', () => s.write('GET /health HTTP/1.1\r\nHost: x\r\nX-Raro: a\0b\r\n\r\n')); let d = ''; s.on('data', (c) => { d += c; }); s.on('close', () => resolve(d)); s.on('error', () => resolve(d)); setTimeout(() => { s.destroy(); resolve(d); }, 3000); });
    const longH = await fetch(S.base + '/health', { headers: { 'x-largo': 'a'.repeat(20000) } }).then((r) => r.status).catch(() => 0);
    check('cabeceras ilegibles o enormes se rechazan sin tirar el servicio', /^HTTP\/1\.1 400/.test(hdr) && (longH === 431 || longH === 0) && (await call('GET', '/health')).status === 200, [hdr.slice(0, 40), longH]);

    // ---------- Abuso y disponibilidad ----------
    console.log(' Abuso y disponibilidad');
    const ctrl = new AbortController(); const live = [];
    for (let i = 0; i < 22; i++) live.push(await fetch(S.base + '/events?path=ver.md', { headers: { authorization: 'Bearer ' + A.s, ...from('10.99.0.1') }, signal: ctrl.signal }).then((r) => r.status).catch(() => 0));
    const otherLive = await fetch(S.base + '/events?path=ver.md&o=' + A.id, { headers: { authorization: 'Bearer ' + C.s, ...from('10.99.0.2') }, signal: ctrl.signal }).then((r) => r.status).catch(() => 0);
    check('las conexiones en vivo tienen tope por cuenta (20), sin frenar a las demás', live.slice(0, 20).every((x) => x === 200) && live[20] === 429 && live[21] === 429 && otherLive === 200, live);
    ctrl.abort(); await sleep(300);
    const again = new AbortController(); const reopened = await fetch(S.base + '/events?path=ver.md', { headers: { authorization: 'Bearer ' + A.s }, signal: again.signal }).then((r) => r.status).catch(() => 0); again.abort();
    check('al cerrarse, las conexiones en vivo devuelven su lugar', reopened === 200, reopened);
    const fbIp = nextIp(); const fb = []; for (let i = 0; i < 6; i++) fb.push((await call('POST', '/feedback', { text: 'Comentario número ' + i }, undefined, from(fbIp))).status);
    check('los comentarios al dueño tienen tope por IP', fb.join() === '200,200,200,200,200,429', fb);
    for (let i = 0; i < 205; i++) await call('POST', '/comments', { path: 'ver.md', text: 'c' + i }, A.s);
    check('los comentarios abiertos tienen tope por cuenta (200)', (await call('GET', '/comments', undefined, A.s)).json.length === 200);
    check('el plan gratis frena al llegar a su límite de notas', await (async () => { const st = []; for (let i = 0; i < 5; i++) st.push((await call('PUT', '/notes/n' + i + '.md', { text: 'x' }, B.s)).status); return st.join() === '200,200,200,402,402'; })());
    const stillUp = [(await call('GET', '/health')).status, S.alive(), !/error no capturado|promesa sin atender/.test(S.log())];
    check('después de todo lo anterior el servicio sigue en pie, sin errores escapados', stillUp[0] === 200 && stillUp[1] && stillUp[2], stillUp);
    check('lo que salió mal en una ruta no se anotó como error 500', !/error 500/.test(S.log()), (S.log().match(/error 500[^\n]*/g) || []).slice(0, 5));

    // ---------- CORS y cabeceras ----------
    console.log(' CORS y cabeceras');
    const acao = async (origin, method) => { const r = await fetch(S.base + '/notes', { method: method || 'GET', headers: { origin, ...(method === 'OPTIONS' ? { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } : {}) } }); return [r.headers.get('access-control-allow-origin'), r.headers.get('access-control-allow-credentials')]; };
    const no = []; for (const og of ['https://otro.test', 'https://ejemplo.test.evil.test', 'https://evil-ejemplo.test', 'http://ejemplo.test', 'https://ejemplo.test:444', 'null', 'file://', 'https://ejemplo.test/', 'xchrome-extension://abc', 'https://chrome-extension://abc']) { no.push(await acao(og)); no.push(await acao(og, 'OPTIONS')); }
    const yes = [await acao('https://ejemplo.test'), await acao('https://ejemplo.test', 'OPTIONS'), await acao('chrome-extension://abcdefghijklmnop')];
    check('CORS: no refleja orígenes arbitrarios ni parecidos al permitido', no.every((x) => x[0] === null), no.map((x) => x[0]));
    check('CORS: el sitio permitido y las extensiones entran, y nunca se habilitan credenciales', yes.every((x, i) => x[0] === ['https://ejemplo.test', 'https://ejemplo.test', 'chrome-extension://abcdefghijklmnop'][i] && x[1] === null) , yes);
    const hs = [await call('GET', '/notes', undefined, A.s), await call('GET', '/notes'), await call('GET', '/no-existe', undefined, A.s), await call('GET', '/public/' + l1.token), await call('POST', '/auth/start', '{bad'), await call('GET', '/health')];
    check('toda respuesta lleva cache-control: no-store, x-content-type-options: nosniff y tipo JSON', hs.every((r) => r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff' && /^application\/json/.test(r.headers.get('content-type') || '')), hs.map((r) => [r.status, r.headers.get('cache-control'), r.headers.get('x-content-type-options')]));
    const err500 = [await call('POST', '/auth/start', 'null', undefined, from(nextIp())), await call('GET', '/notes/%E0%A4%A', undefined, A.s)];
    check('los errores no cuentan detalles internos', err500.every((r) => !/Cannot|undefined|properties|URI|at |node:|server\.mjs/.test(JSON.stringify(r.json))), err500.map((r) => r.json));

    // ---------- Registro ----------
    const logged = secrets.filter((x) => x && S.log().includes(x));
    check('la salida del servidor no trae códigos, sesiones, tokens, claves ni texto de notas', logged.length === 0 && secrets.filter(Boolean).length > 40, logged.map((x) => x.slice(0, 8)));
  } catch (e) { check('servidor: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-2000)); }
  await S.stop();

  // Con correo configurado: a quién le sale cada cosa, y que nada de lo que manda quien llama se cuele en las cabeceras
  console.log(' Correo');
  const sent = [];
  const inbox = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { sent.push(JSON.parse(b)); res.writeHead(200); res.end('{}'); }); });
  await new Promise((r) => inbox.listen(0, '127.0.0.1', r));
  const M = await boot({ DEV_CODES: '', FEEDBACK_TO: 'duenio@ejemplo.test', MAIL_WEBHOOK: 'http://127.0.0.1:' + inbox.address().port });
  try {
    const st = await M.call('POST', '/auth/start', { email: 'Lectora@Ejemplo.test', lang: 'es', to: 'tercero@ejemplo.test', subject: 'x', html: '<b>x</b>' });
    const m = sent[0] || {}; const code = (/\d{6}/.exec(m.text || '') || [''])[0];
    check('el código sale solo al correo que lo pidió, y sin DEV_CODES no vuelve en la respuesta', st.status === 200 && !st.json.dev_code && m.to === 'lectora@ejemplo.test' && sent.length === 1 && /^\d{6}$/.test(code) && Object.keys(m).sort().join() === 'html,subject,text,to', [st.json, Object.keys(m)]);
    const bad = []; for (const e of ['a@b.test\r\nBcc: tercero@ejemplo.test', 'a@b.test\nBcc:x@y.test', 'a@b.test, tercero@ejemplo.test', 'a@b.test;tercero@ejemplo.test', '<a@b.test>', 'a b@c.test', 'a@b.test\u0000', 'a@b.test%0d%0aBcc:x@y.test']) { bad.push((await M.call('POST', '/auth/start', { email: e }, undefined, from(nextIp()))).status); bad.push((await M.call('POST', '/feedback', { text: 'Texto de prueba.', email: e }, undefined, from(nextIp()))).status); }
    check('un correo con saltos de línea, comas o varios destinatarios se rechaza: no hay inyección de cabeceras', bad.every((x) => x === 400) && sent.length === 1, bad);
    const fb = await M.call('POST', '/feedback', { text: 'Línea uno.\r\nBcc: tercero@ejemplo.test\r\n\r\notra', email: 'quien@ejemplo.test', to: 'tercero@ejemplo.test', reply_to: 'tercero@ejemplo.test', subject: 'Otro asunto', context: { version: '1\r\nBcc: x@y.test', where: 'web\r\nX: y', browser: 'B\nrowser', lang: 'es\r\nTo: x@y.test' } }, undefined, from(nextIp()));
    const f = sent[1] || {};
    check('feedback: sale solo al dueño, con asunto fijo, y reply_to es el correo validado de quien escribe', fb.status === 200 && f.to === 'duenio@ejemplo.test' && f.subject === 'SharpMD feedback' && f.reply_to === 'quien@ejemplo.test' && Object.keys(f).sort().join() === 'reply_to,subject,text,to', f);
    const tail = (f.text || '').split('\n---\n').pop();
    check('feedback: los datos de contexto van en una sola línea cada uno', tail.split('\n').filter(Boolean).length === 5 && !/^(Bcc|To|X):/m.test(tail), tail);
    const anon = await M.call('POST', '/feedback', { text: 'Sin correo para responder.' }, undefined, from(nextIp()));
    check('feedback: sin correo no hay reply_to', anon.status === 200 && !('reply_to' in (sent[2] || { reply_to: 1 })), sent[2]);
    check('el servidor no anota el código que mandó', !M.log().includes(code) && code.length === 6);
  } catch (e) { check('correo: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await M.stop(); inbox.close();

  // Sin nada opcional configurado: lo que no está prendido no existe
  const N = await boot({});
  try {
    const off = [await N.call('POST', '/admin/plan', { email: 'a@b.test', plan: 'pro' }, undefined, { 'x-admin-key': '' }), await N.call('POST', '/admin/plan', { email: 'a@b.test', plan: 'pro' }, undefined, { 'x-admin-key': 'undefined' }), await N.call('POST', '/paddle/webhook', {}), await N.call('POST', '/feedback', { text: 'No debería llegar.' })];
    check('sin ADMIN_KEY, PADDLE_WEBHOOK_SECRET ni FEEDBACK_TO, esas rutas no hacen nada', off[0].status === 403 && off[1].status === 403 && off[2].status === 404 && off[3].status === 404, off.map((r) => r.status));
    const st = await N.call('POST', '/auth/start', { email: 'revision@ejemplo.test' });
    check('sin TEST_LOGIN no hay cuenta con código fijo', !!st.json.dev_code && (await N.call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: st.json.dev_code === '246810' ? '000000' : '246810' })).status === 400);
    const ext = await fetch(N.base + '/health', { headers: { origin: 'https://sharpmd.app' } });
    check('sin ALLOW_ORIGINS ningún sitio web entra por CORS', !ext.headers.get('access-control-allow-origin'));
  } catch (e) { check('sin configuración: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await N.stop();
}

if (ONLY !== 'app') await serverSuite();
// __APP__

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
