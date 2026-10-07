// Seguridad: un caso por cada control del servidor, de la página de pago y de la app.
// Todo corre contra un servidor local con claves inventadas y contra la extensión cargada en un Chromium:
// ningún pedido sale a sync.sharpmd.app ni a sharpmd.app (lo que apunte ahí se corta y se anota como falla).
// SHARPMD_SERVER apunta a otro server.mjs, para comparar contra una versión anterior. SEC_ONLY=server|app corre una mitad.
import { spawn } from 'child_process'; import { createHmac, createHash } from 'crypto'; import { DatabaseSync } from 'node:sqlite';
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

if (ONLY !== 'app' && ONLY !== 'live') await serverSuite();

// ---------- App, extensión y página de pago ----------
async function appSuite() {
  console.log('Seguridad de la app');
  const { chromium } = await import('playwright-core');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const appHtml = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  const csp = manifest.content_security_policy.extension_pages;
  check('manifest: las páginas de la extensión solo corren sus propios scripts', /script-src 'self' 'wasm-unsafe-eval'/.test(csp) && !/unsafe-inline|unsafe-eval'|https?:|\*/.test(csp.replace("'wasm-unsafe-eval'", '')), csp);
  const war = manifest.web_accessible_resources;
  check('manifest: lo único abierto a otros sitios son las tipografías, y la app solo a sharpmd.app', war.length === 2 && war[0].resources.every((r) => /fonts\/\*$/.test(r)) && war[1].resources.join() === 'src/app.html' && war[1].matches.join() === 'https://sharpmd.app/*' && !manifest.externally_connectable, war);
  check('manifest: pide solo storage y scripting, y el script de contenido corre solo en el marco principal', manifest.permissions.slice().sort().join() === 'scripting,storage' && !manifest.content_scripts.some((c) => c.all_frames || c.match_about_blank), manifest.permissions);
  check('la versión del manifest y la de la app coinciden', new RegExp("VERSION = '" + manifest.version.replace(/\./g, '\\.') + "'").test(fs.readFileSync(path.join(root, 'src', 'defaults.js'), 'utf8')));
  const meta = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(appHtml) || [])[1] || '';
  check('app.html trae una política de contenido sin scripts en línea ni de otros sitios, y no tiene ninguno propio', /script-src 'self' 'wasm-unsafe-eval';/.test(meta) && /object-src 'none'/.test(meta) && /base-uri 'none'/.test(meta) && /frame-src 'none'/.test(meta) && !/<script(?![^>]*\ssrc=)[^>]*>/.test(appHtml) && !/\son[a-z]+=/i.test(appHtml) && !/src="https?:/.test(appHtml), meta);

  const S = await boot({ ADMIN_KEY: ADMIN, MCP_FREE: '1', SHARE_FREE: '1' });
  // Otro servidor, que no es el de la cuenta: anota con qué credenciales le llegan los pedidos.
  const spy = { auth: [], hits: 0 };
  const other = http.createServer((req, res) => { spy.hits++; if (req.headers.authorization) spy.auth.push(req.headers.authorization); res.writeHead(req.method === 'OPTIONS' ? 204 : 401, { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': 'authorization, content-type, x-password', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'content-type': 'application/json' }); res.end(req.method === 'OPTIONS' ? '' : '{"error":"bad_auth"}'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r)); const otherBase = 'http://127.0.0.1:' + other.address().port;
  // El sitio: la raíz del repositorio servida como en GitHub Pages, más una carpeta de prueba con su listado.
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
  const outside = { hits: 0 };
  const far = http.createServer((req, res) => { outside.hits++; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('# De otro servidor\n\nNo debería leerse.'); });
  await new Promise((r) => far.listen(0, '127.0.0.1', r)); const farBase = 'http://127.0.0.1:' + far.address().port;
  const site = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/carpeta/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(['<script>', 'addRow("nota.md","nota.md",0,10,"10 B",0,"");', 'addRow("hermana.md","hermana.md",0,10,"10 B",0,"");', 'addRow("lejana.md",' + JSON.stringify(farBase + '/lejana.md') + ',0,10,"10 B",0,"");', 'addRow("arriba.md","../arriba.md",0,10,"10 B",0,"");', '</script>'].join('\n')); return; }
    if (rel === '/carpeta/nota.md' || rel === '/carpeta/hermana.md' || rel === '/arriba.md') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('# ' + rel + '\n\nTexto de prueba.'); return; }
    if (rel === '/datos/informe') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('# No es un archivo Markdown\n\nTexto plano de un sitio.'); return; }
    if (rel === '/marco.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><iframe id="f" src="/pay.html?email=ana%40ejemplo.test" width="600" height="600"></iframe>'); return; }
    const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const origin = 'http://127.0.0.1:' + site.address().port;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtools-'));
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1400, height: 900 }, locale: 'es-AR', ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--lang=es-AR'] });
  // Nada sale a producción ni a Paddle: lo que apunte ahí se corta y se cuenta.
  const escaped = [];
  await ctx.route(/^https?:\/\/([a-z0-9-]+\.)*(sharpmd\.app|paddle\.com)\//i, (r) => { escaped.push(r.request().url()); r.abort(); });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }); const id = new URL(sw.url()).host;
    const home = `chrome-extension://${id}/src/app.html`;
    const app = await ctx.newPage(); const errors = []; app.on('pageerror', (e) => errors.push(e.message));
    const store = (obj) => app.evaluate((o) => new Promise((resolve) => chrome.storage.local.set(o, resolve)), obj);
    await app.goto(home); await app.waitForSelector('.lmd-home');
    await store({ settings: { cloudUrl: 'off' } });

    console.log(' Página de la extensión y versión web');
    const inline = (page) => page.evaluate(() => new Promise((resolve) => { const b = document.createElement('button'); b.setAttribute('onclick', 'window.__probe = 1'); document.body.appendChild(b); b.click(); b.remove(); setTimeout(() => resolve(window.__probe === 1), 50); }));
    check('en la página de la extensión un manejador escrito en el HTML no corre', (await inline(app)) === false);
    const framed = await app.evaluate(() => new Promise((resolve) => { const f = document.createElement('iframe'); f.src = location.pathname; f.onload = () => setTimeout(() => { const d = f.contentDocument; resolve({ ui: !!(d && d.querySelector('.lmd-main, .lmd-home')), kids: d ? d.body.children.length : -1 }); f.remove(); }, 800); f.onerror = () => resolve({ ui: false, blocked: true }); document.body.appendChild(f); setTimeout(() => resolve({ ui: false, blocked: true }), 4000); }));
    check('la app no arranca dentro de un marco', framed.ui === false, framed);
    const web = await ctx.newPage(); web.on('pageerror', (e) => errors.push(e.message));
    await web.goto(origin + '/src/app.html'); await web.waitForSelector('.lmd-home');
    check('en la versión web tampoco: la política de app.html corta los scripts en línea', (await inline(web)) === false);
    const blocked = await web.evaluate(() => new Promise((resolve) => { const s = document.createElement('script'); s.src = 'data:text/javascript,window.__probe2=1'; s.onload = () => resolve(false); s.onerror = () => resolve(true); document.head.appendChild(s); setTimeout(() => resolve(window.__probe2 !== 1), 1500); }));
    check('y un script que no viene del propio sitio no carga', blocked === true);
    // La política no rompe lo que la app dibuja: matemática, Mermaid, Graphviz e imágenes de otros sitios
    await web.evaluate(async (img) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sec', { create: true });
      const h = await dir.getFileHandle('nota.md', { create: true }); const w = await h.createWritable();
      await w.write('# Con todo\n\nFórmula $a^2+b^2$.\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n```dot\ndigraph { a -> b; a [URL="https://ejemplo.test/a"]; }\n```\n\n![remota](' + img + ')\n'); await w.close();
      window.showDirectoryPicker = async () => dir;
    }, origin + '/icons/icon48.png');
    await Promise.all([web.waitForNavigation(), web.click('[data-home=dir]')]);
    await web.waitForSelector('.markdown-body h1'); await web.waitForFunction(() => document.querySelectorAll('.lmd-diagram > svg').length === 2 && !!document.querySelector('.katex'), null, { timeout: 20000 }).catch(() => {});
    const drawn = await web.evaluate(() => ({ katex: !!document.querySelector('.katex'), diagrams: document.querySelectorAll('.lmd-diagram > svg').length, img: (() => { const i = document.querySelector('.markdown-body img'); return !!i && i.complete && i.naturalWidth > 0; })(), link: (document.querySelector('.lmd-diagram-dot a') || { getAttribute: () => '' }).getAttribute('xlink:href') || (document.querySelector('.lmd-diagram-dot a') || { getAttribute: () => '' }).getAttribute('href') }));
    check('con la política puesta se siguen dibujando KaTeX, Mermaid, Graphviz y las imágenes remotas', drawn.katex && drawn.diagrams === 2 && drawn.img && drawn.link === 'https://ejemplo.test/a', drawn);

    console.log(' Lo que el documento no puede traer');
    const clean = await web.evaluate(() => {
      const out = DOMPurify.sanitize('<p class="lmd-btn nota lmd-wiki" data-act="reset" data-l="1-2" data-key="k" style="position:fixed;z-index:9;color:red">a</p><div class="lmd-ask lmd-dlg" style="position:absolute;top:0">b</div><span data-tex="x" class="lmd-math">c</span>', { ADD_ATTR: ['target', 'data-tex'], FORBID_TAGS: ['style', 'form'] });
      const d = document.createElement('div'); d.innerHTML = out; const p = d.querySelector('p'); const box = d.querySelector('div'); const m = d.querySelector('span');
      return { html: out, cls: p.className, act: p.hasAttribute('data-act'), key: p.hasAttribute('data-key'), line: p.getAttribute('data-l'), pos: p.style.position, z: p.style.zIndex, color: p.style.color, box: box.className + '|' + box.style.position, math: m.className + '|' + m.getAttribute('data-tex') };
    });
    check('del HTML de una nota se van los atributos data-* y las clases que la app usa para sí', clean.cls === 'nota lmd-wiki' && !clean.act && !clean.key && clean.line === '1-2' && clean.box === '|' && clean.math === 'lmd-math|x', clean);
    check('y los estilos que sacan un bloque de su lugar; el resto del estilo queda', clean.pos === '' && clean.z === '' && clean.color === 'red', clean);
    const svgSafe = await web.evaluate(() => {
      const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a id="a" xlink:href="otro-esquema:algo"><text>a</text></a><a id="b" href="https://ejemplo.test/x"><text>b</text></a><a id="c" href="#seccion"><text>c</text></a><a id="d" href=" Otro-Esquema:algo"><text>d</text></a><g id="e" onclick="void 0"></g><foreignObject id="f"></foreignObject></svg>', 'image/svg+xml');
      const s = LMD.md.safeSvg(doc.documentElement); const at = (i, n) => { const e = s.querySelector('#' + i); return e ? e.getAttribute(n) : 'sin elemento'; };
      return [at('a', 'xlink:href'), at('b', 'href'), at('c', 'href'), at('d', 'href'), at('e', 'onclick'), at('f', 'id')];
    });
    check('en un diagrama de Graphviz quedan solo los enlaces a páginas y secciones, sin manejadores', JSON.stringify(svgSafe) === JSON.stringify([null, 'https://ejemplo.test/x', '#seccion', null, null, 'sin elemento']), svgSafe);
    const opts = await web.evaluate(async () => { await LMD.patch({ supporter: true, customCSS: '.markdown-body h1 { color: rgb(1, 2, 3); } </style><p id="colado">x</p>' }); await new Promise((r) => setTimeout(r, 400)); const st = document.getElementById('lmd-custom-css'); return { kids: st ? st.children.length : -1, leaked: !!document.getElementById('colado'), color: getComputedStyle(document.querySelector('.markdown-body h1')).color }; });
    check('el CSS propio se aplica como texto de una hoja de estilos: no puede cerrar la etiqueta ni agregar elementos', opts.kids === 0 && !opts.leaked && opts.color === 'rgb(1, 2, 3)', opts);
    await web.close();

    console.log(' La sesión es del servidor que la dio');
    const acct = await signup(S, 'sesion@ejemplo.test');
    await store({ settings: { cloudUrl: S.base }, cloud: { session: acct.s, email: acct.email } });
    await app.goto(home); await app.waitForSelector('.lmd-home');
    const signed = () => app.evaluate(async () => { LMD.cloud.reset(); await LMD.cloud.ready(); let ok = false; try { await LMD.cloud.account(); ok = true; } catch (e) { /* sin sesión o sin servidor */ } try { await LMD.cloud.list(true); } catch (e) { /* idem */ } return { in: LMD.cloud.signedIn(), ok }; });
    const first = await signed();
    await store({ settings: { cloudUrl: otherBase } }); await app.goto(home); await app.waitForSelector('.lmd-home'); await app.waitForTimeout(800);
    const moved = await signed(); await app.waitForTimeout(500);
    check('al cambiar la dirección del servidor, la sesión no viaja al nuevo', first.in && first.ok && !moved.in && spy.auth.length === 0, [first, moved, spy]);
    await store({ settings: { cloudUrl: S.base } }); await app.goto(home); await app.waitForSelector('.lmd-home');
    const back = await signed();
    check('y al volver a la dirección anterior sigue ahí', back.in && back.ok, back);
    check('la sesión guardada anota de qué servidor es', (await app.evaluate(() => new Promise((resolve) => chrome.storage.local.get('cloud', (r) => resolve(r.cloud.at))))) === S.base);
    await store({ settings: { cloudUrl: 'off' } });

    console.log(' Archivos abiertos desde un sitio');
    const doc = await ctx.newPage(); doc.on('pageerror', (e) => errors.push(e.message));
    await doc.goto(origin + '/carpeta/nota.md'); await doc.waitForSelector('.markdown-body h1'); await doc.waitForSelector('.lmd-tree-box a.lmd-node', { timeout: 10000 }).catch(() => {});
    await doc.fill('.lmd-search input', 'texto'); await doc.waitForTimeout(2500);
    const tree = await doc.evaluate(() => ({ nodes: [...document.querySelectorAll('.lmd-tree-box a.lmd-node')].map((a) => a.textContent.trim()), results: [...document.querySelectorAll('.lmd-results .lmd-res')].map((g) => g.dataset.url), body: document.querySelector('.lmd-results').textContent }));
    check('el árbol de un sitio muestra solo lo que está dentro de la carpeta', tree.nodes.join().includes('hermana.md') && !/lejana|arriba/.test(tree.nodes.join()), tree.nodes);
    check('y la búsqueda no lee archivos de otro servidor ni de fuera de la carpeta', outside.hits === 0 && !/lejana|arriba\.md|otro servidor/.test(tree.body) && tree.results.every((u) => u.startsWith(origin + '/carpeta/')), [outside.hits, tree.results]);
    const notMd = await ctx.newPage(); await notMd.goto(origin + '/datos/informe?archivo=x.md'); await notMd.waitForTimeout(1200);
    check('el lector no actúa sobre una dirección que solo termina en .md en la consulta', (await notMd.evaluate(() => !document.querySelector('.lmd-main') && !!document.querySelector('pre'))));
    await notMd.close(); await doc.close();

    console.log(' Página de pago');
    const pay = await ctx.newPage(); pay.on('pageerror', (e) => errors.push(e.message)); const navs = [];
    pay.on('framenavigated', (f) => { if (f === pay.mainFrame()) navs.push(f.url()); });
    const links = async (q) => { await pay.goto(origin + '/pay.html' + q); await pay.waitForTimeout(250); return pay.evaluate(() => ({ back: [...document.querySelectorAll('[data-back]')].map((a) => a.href), paid: document.querySelector('[data-paid]').href, other: document.getElementById('other').href, email: document.getElementById('email').textContent, kids: document.getElementById('email').children.length, amount: document.getElementById('amount').textContent, shown: ['buy', 'noemail', 'done'].filter((i) => !document.getElementById(i).hidden) })); };
    const own = origin + '/src/app.html';
    const backs = [];
    for (const b of ['https://otro-sitio.test/', '//otro-sitio.test/x', 'https://otro-sitio.test@' + origin.slice(7) + '.otro.test/', 'data:text/html,x', 'otro-esquema:x', 'chrome-extension://' + id + '/src/popup.html', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/otra.html', '\\\\otro-sitio.test\\x', 'https:otro-sitio.test']) backs.push([b, await links('?email=ana%40ejemplo.test&back=' + enc(b))]);
    const stray = backs.filter(([, r]) => !r.back.every((h) => h === own) || r.paid !== own + '#lmd-paid' || /back=/.test(r.other) || !r.other.startsWith(origin + '/pay.html?'));
    check('pay.html: una vuelta (back) a otro sitio o a otra página de una extensión se ignora', stray.length === 0, stray.map((x) => [x[0], x[1].back[0]]));
    const okSame = await links('?email=ana%40ejemplo.test&back=' + enc(origin + '/src/app.html?f=local%2Fa.md#x')); const okExt = await links('?email=ana%40ejemplo.test&back=' + enc(home + '?f=cloud%2Fa.md'));
    check('pay.html: vuelve al mismo sitio o a la app de la extensión', okSame.back[0] === origin + '/src/app.html?f=local%2Fa.md' && okExt.back[0] === home + '?f=cloud%2Fa.md' && okExt.paid === home + '?f=cloud%2Fa.md#lmd-paid', [okSame.back[0], okExt.back[0]]);
    navs.length = 0; await pay.goto(origin + '/pay.html?done=1&back=' + enc('https://otro-sitio.test/')); await pay.waitForTimeout(1800);
    check('pay.html: después del pago no redirige a una dirección de afuera', navs.every((u) => u.startsWith(origin + '/pay.html')) && pay.url().startsWith(origin + '/pay.html'), navs);
    const marked = await links('?plan=' + enc('yearly"><b>x</b>') + '&email=' + enc('a<b>b</b>@ejemplo.test'));
    const weird = await links('?plan=__proto__&email=' + enc('Ana@Ejemplo.test'));
    check('pay.html: el correo se muestra como texto y un plan desconocido cae en el mensual', marked.kids === 0 && marked.email === 'a<b>b</b>@ejemplo.test' && marked.amount === 'USD 3.99' && weird.email === 'ana@ejemplo.test' && weird.amount === 'USD 3.99' && weird.shown.join() === 'buy', [marked, weird]);
    const none = await links('?email=' + enc('sin-arroba'));
    check('pay.html: sin un correo bien formado no ofrece pagar', none.shown.join() === 'noemail', none.shown);
    await pay.goto(origin + '/marco.html'); await pay.waitForTimeout(800);
    const inFrame = await pay.frames().find((f) => /pay\.html/.test(f.url())).evaluate(() => ['buy', 'noemail', 'done'].filter((i) => !document.getElementById(i).hidden));
    check('pay.html: dentro de un marco no muestra nada para pagar', inFrame.length === 0, inFrame);
    await pay.close();

    check('ningún pedido salió a sharpmd.app (los de Paddle se cortaron antes de salir)', escaped.filter((u) => /sharpmd\.app/.test(u)).length === 0, escaped);
    check('sin errores de JavaScript en las páginas', errors.length === 0, errors);
  } catch (e) { check('app: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await ctx.close(); other.close(); far.close(); site.close(); await S.stop();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* el navegador suelta el perfil un rato después */ }
}
if (ONLY !== 'server' && ONLY !== 'live') await appSuite();

// ---------- Sesión en vivo ----------
// Quien entra por el enlace no tiene cuenta: recibe un pase que sirve solo para la nota de esa sesión y solo
// mientras esté abierta. Acá se prueba que no alcanza nada más, que se corta en el acto, y los topes.
// (Lo que pasa en el navegador con un nombre o un contenido hostil se prueba en live.mjs, con navegadores de verdad.)
async function liveSuite() {
  console.log('Seguridad de la sesión en vivo');
  const S = await boot({ ADMIN_KEY: ADMIN, LIVE_PEOPLE: '4', SHARE_FREE: '1', MCP_FREE: '1' });
  const { call } = S; const sha = (s) => createHash('sha256').update(s).digest('hex');
  // Una escucha abierta: lo que fue llegando, y cómo cortarla.
  const listen = async (url, auth, extra) => {
    const ctrl = new AbortController(); const st = { text: '', status: 0, done: false };
    try {
      const res = await fetch(S.base + url, { headers: { ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(extra || {}) }, signal: ctrl.signal });
      st.status = res.status;
      if (res.ok) (async () => { const rd = res.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; st.text += d.decode(x.value); } } catch (e) { /* cortada */ } st.done = true; })();
      else ctrl.abort();
    } catch (e) { st.status = 0; }
    return { get text() { return st.text; }, get status() { return st.status; }, get done() { return st.done; }, stop: () => ctrl.abort(), events: () => st.text.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6))) };
  };
  const guestSecrets = [];
  try {
    const A = await signup(S, 'ana@ejemplo.test'); const B = await signup(S, 'beto@ejemplo.test'); const F = await signup(S, 'gratis@ejemplo.test');
    await makePro(S, A.email); await makePro(S, B.email);
    const SECRET = 'REMOLACHA-SECRETA-9917'; secrets.push(SECRET);
    for (const [p, t] of [['equipo/plan.md', '# Plan\n\nUno.\n\nDos.\n'], ['privada.md', '# Privada\n\n' + SECRET], ['equipo/otra.md', 'otra ' + SECRET], ['borrar.md', 'x'], ['mover.md', 'x'], ['plan-pago.md', 'x'], ['cofre/a.md', 'x']]) await call('PUT', '/notes/' + enc(p), { text: t }, A.s);
    await call('PUT', '/notes/b.md', { text: 'de beto ' + SECRET }, B.s);
    await call('PUT', '/notes/gratis.md', { text: 'x' }, F.s);
    await call('POST', '/shares', { path: 'equipo/plan.md', email: B.email, role: 'edit' }, A.s);
    const live = (body, s) => call('POST', '/live', body, s);
    const leaks = (r) => JSON.stringify(r.json || '').includes(SECRET);

    // ---------- Abrir ----------
    console.log(' Quién abre una sesión');
    check('sin cuenta no se abre una sesión', (await live({ path: 'equipo/plan.md', name: 'X' })).status === 401);
    const freeTry = await live({ path: 'gratis.md', name: 'Gratis' }, F.s);
    check('con el plan gratis responde 402 con un código propio', freeTry.status === 402 && freeTry.json.error === 'live_needs_plan', freeTry.json);
    check('la cuenta dice si puede abrir sesiones', (await call('GET', '/account', undefined, A.s)).json.live === true && (await call('GET', '/account', undefined, F.s)).json.live === false);
    check('no se abre sobre la nota de otra cuenta, ni compartida para editar', (await live({ path: 'equipo/plan.md', name: 'Beto' }, B.s)).status === 404 && (await live({ path: 'privada.md', name: 'Beto' }, B.s)).status === 404);
    check('ni sobre una nota que no existe o una ruta mal formada', (await live({ path: 'no-existe.md', name: 'Ana' }, A.s)).status === 404 && (await live({ path: '../x.md', name: 'Ana' }, A.s)).status === 400 && (await live({ name: 'Ana' }, A.s)).status === 400);
    const noName = await Promise.all(['', '   ', null, 7, {}, ['Ana'], '\u200b\u200e'].map((name) => live({ path: 'equipo/plan.md', name }, A.s)));
    check('sin un nombre de verdad no se abre', noName.every((r) => r.status === 400 && r.json.error === 'bad_name'), noName.map((r) => r.status));
    const opened = await live({ path: 'equipo/plan.md', name: 'Ana' }, A.s);
    const secret = opened.json.secret; guestSecrets.push(secret);
    check('abrir devuelve un secreto de 256 bits al azar', opened.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(secret) && opened.json.open === true && opened.json.people.length === 1, opened.json && { ...opened.json, secret: '…' });
    const again = await live({ path: 'equipo/plan.md', name: 'Ana' }, A.s);
    check('una sola sesión por nota, y el secreto no se vuelve a dar', again.status === 200 && again.json.open === true && !('secret' in again.json) && !JSON.stringify(again.json).includes(secret));
    const other = await live({ path: 'equipo/otra.md', name: 'Ana' }, A.s); guestSecrets.push(other.json.secret);
    check('dos sesiones tienen secretos distintos', other.json.secret !== secret && /^[A-Za-z0-9_-]{43}$/.test(other.json.secret));
    const db = S.db(); const rows = db.prepare('SELECT * FROM lives').all(); db.close();
    check('en la base queda el hash del secreto, no el secreto', rows.length === 2 && rows.some((r) => r.hash === sha(secret)) && !JSON.stringify(rows).includes(secret), rows.map((r) => Object.keys(r)));
    const onDisk = ['mdtools.db', 'mdtools.db-wal'].map((f) => { try { return fs.readFileSync(path.join(S.dir, f)).toString('latin1'); } catch (e) { return ''; } }).join('');
    check('ni en el archivo de la base ni en su registro de escritura aparece el secreto', !onDisk.includes(secret) && !onDisk.includes(other.json.secret) && onDisk.includes(sha(secret)));
    check('el estado de la sesión es de su dueño: otra cuenta no la ve ni la toca', (await call('GET', '/live?path=' + enc('equipo/plan.md'), undefined, B.s)).json.open === false && (await call('DELETE', '/live?path=' + enc('equipo/plan.md'), undefined, B.s)).status === 404
      && (await call('POST', '/live/rotate', { path: 'equipo/plan.md' }, B.s)).status === 404 && (await call('POST', '/live/kick', { path: 'equipo/plan.md', id: 'g1' }, B.s)).status === 404 && (await call('GET', '/live?path=' + enc('equipo/plan.md'))).status === 401);
    check('en una carpeta con contraseña no hay sesión: error propio', await (async () => {
      const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
      await call('POST', '/vaults', { folder: 'cofre', salt: b64(16), iters: 200000, wrapped: b64(60), check: b64(32) }, A.s);
      const r = await live({ path: 'cofre/a.md', name: 'Ana' }, A.s); return r.status === 409 && r.json.error === 'live_vault';
    })());

    // ---------- El secreto ----------
    console.log(' El secreto del enlace');
    const ipBad = nextIp(); const wrongs = [];
    for (const s of ['', 'corto', 'x'.repeat(43), secret.slice(0, 42) + (secret[42] === 'A' ? 'B' : 'A'), secret + 'x', secret.toLowerCase() === secret ? secret.toUpperCase() : secret.toLowerCase(), null, 12345, { $ne: '' }, [secret], sha(secret)]) wrongs.push(await call('POST', '/live/look', { secret: s }, undefined, from(ipBad)));
    check('un secreto casi igual, su hash o cualquier otra cosa: la misma respuesta que una sesión que no existe', wrongs.every((r) => r.status === 404 && r.json.error === 'live_gone') && new Set(wrongs.map((r) => JSON.stringify(r.json))).size === 1, wrongs.map((r) => [r.status, r.json]));
    const flood = []; for (let i = 0; i < 12; i++) flood.push((await call('POST', '/live/join', { secret: 'y'.repeat(43) + i, name: 'x' }, undefined, from(ipBad))).status);
    check('veinte secretos equivocados por hora desde una red, y se corta', flood.slice(0, 9).every((s) => s === 404) && flood.slice(9).every((s) => s === 429), flood);
    check('cortado, tampoco entra el secreto bueno desde esa red (no sirve para probar)', (await call('POST', '/live/look', { secret }, undefined, from(ipBad))).status === 429);
    const look = await call('POST', '/live/look', { secret }, undefined, from(nextIp()));
    check('con el secreto se ve de quién es la sesión y el nombre de la nota, sin la carpeta ni el correo', look.status === 200 && look.json.by === 'Ana' && look.json.note === 'plan.md' && !/equipo|@/.test(JSON.stringify(look.json)), look.json);

    // ---------- Entrar ----------
    console.log(' El pase del invitado');
    const join = (name, sec, ip) => call('POST', '/live/join', { secret: sec || secret, name }, undefined, from(ip || nextIp()));
    const j1 = await join('Ben'); const g1 = j1.json; guestSecrets.push(g1.pass, g1.ticket);
    check('entrar da un pase propio, el texto de la nota y su revisión', j1.status === 200 && /^mdl_[A-Za-z0-9_-]{43}$/.test(g1.pass) && g1.note.name === 'plan.md' && g1.note.text === '# Plan\n\nUno.\n\nDos.\n' && g1.note.rev === 1 && g1.by === 'Ana' && g1.you === 'g1');
    check('lo que recibe no trae el correo ni la carpeta de nadie', !/@ejemplo|equipo\//.test(JSON.stringify(g1)), JSON.stringify(g1).slice(0, 300));
    const badNames = await Promise.all(['', '  ', null, 9, {}, '\u0000\u0007', '\u202e\u200f'].map((n) => join(n)));
    check('sin un nombre de verdad no se entra', badNames.every((r) => r.status === 400 && r.json.error === 'bad_name'), badNames.map((r) => r.status));
    const HTML = '<img src=x onerror=alert(1)>"\'&<script>'; const j2 = await join(HTML + 'x'.repeat(100)); const g2 = j2.json; guestSecrets.push(g2.pass, g2.ticket);
    check('el nombre se guarda como texto, recortado a 40 caracteres', j2.status === 200 && g2.name === (HTML + 'x'.repeat(100)).slice(0, 40) && g2.name.length === 40, g2.name);
    const j3 = await join('  A\tn\u0000a\u202e \n '); const g3 = j3.json; guestSecrets.push(g3.pass, g3.ticket);
    check('sin caracteres de control ni marcas que den vuelta el texto, y sin repetir el nombre de otro', j3.status === 200 && g3.name === 'Ana 2', g3.name);
    const roster = (await call('GET', '/live?path=' + enc('equipo/plan.md'), undefined, A.s)).json.people;
    check('cada uno tiene su número y su color, asignados por el servidor', roster.map((p) => p.id).join() === 'o,g1,g2,g3' && new Set(roster.map((p) => p.color)).size === 4 && roster[0].color === 0, roster);
    const j4 = await join('Uno de más');
    check('tope de participantes: con cuatro (contando a quien la abrió) no entra otro', j4.status === 429 && j4.json.error === 'live_full' && (await call('POST', '/live/look', { secret }, undefined, from(nextIp()))).json.full === true, j4.json);

    // ---------- Lo que alcanza un pase ----------
    console.log(' Lo que el pase alcanza, y lo que no');
    const P = g1.pass;
    const mine = await call('GET', '/live/note', undefined, P);
    check('lee la nota de su sesión', mine.status === 200 && mine.json.text === '# Plan\n\nUno.\n\nDos.\n' && mine.json.name === 'plan.md' && !('path' in mine.json));
    const elsewhere = [
      ['GET', '/notes'], ['GET', '/notes?o=' + A.id], ['GET', '/notes/privada.md'], ['GET', '/notes/' + enc('equipo/plan.md')], ['GET', '/notes/privada.md?o=' + A.id], ['PUT', '/notes/privada.md', { text: 'pisada' }], ['PUT', '/notes/' + enc('equipo/plan.md'), { text: 'pisada' }],
      ['PUT', '/notes/nueva.md', { text: 'nueva' }], ['DELETE', '/notes/privada.md'], ['POST', '/rename', { from: 'privada.md', to: 'x.md' }], ['GET', '/search?q=REMOLACHA'], ['GET', '/account'], ['GET', '/shared'], ['GET', '/shares'], ['POST', '/shares', { path: 'privada.md', email: 'x@ejemplo.test' }],
      ['POST', '/links', { path: 'privada.md' }], ['GET', '/tokens'], ['POST', '/tokens', { name: 'x' }], ['GET', '/versions/privada.md'], ['GET', '/versions/' + enc('equipo/plan.md')], ['GET', '/version/1'], ['GET', '/comments'], ['POST', '/comments', { path: 'privada.md', text: 'x' }],
      ['GET', '/vaults'], ['POST', '/vaults', {}], ['POST', '/auth/logout', {}], ['POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'privada.md' } } }],
      ['GET', '/live?path=' + enc('equipo/plan.md')], ['POST', '/live', { path: 'privada.md', name: 'x' }], ['DELETE', '/live?path=' + enc('equipo/plan.md')],
      ['GET', '/events?path=privada.md'], ['GET', '/events?path=' + enc('equipo/plan.md')], ['GET', '/events?path=' + enc('equipo/plan.md') + '&o=' + A.id],
    ];
    const tried = []; for (const [m, u, b] of elsewhere) { const r = await call(m, u, b, P); tried.push([m + ' ' + u.slice(0, 30), r.status, leaks(r)]); }
    check('fuera de su sesión no sirve para nada: ' + elsewhere.length + ' rutas de cuenta responden 401 sin soltar un dato', tried.every((t) => t[1] === 401 && !t[2]), tried.filter((t) => t[1] !== 401 || t[2]));
    const ownerOnly = []; for (const [m, u, b] of [['POST', '/live/rotate', { path: 'equipo/plan.md' }], ['POST', '/live/kick', { path: 'equipo/plan.md', id: 'g2' }], ['GET', '/live/notes'], ['GET', '/live/note/privada.md'], ['DELETE', '/live/note'], ['POST', '/live/note', { text: 'x' }], ['GET', '/live/'], ['PUT', '/live/presence', {}]]) ownerOnly.push((await call(m, u, b, P)).status);
    check('tampoco cambia el enlace, saca a otro ni llega a rutas que no son suyas', ownerOnly.every((s) => s === 404), ownerOnly);
    check('sacar a alguien es de quien abrió la sesión: nadie quedó afuera', (await call('GET', '/live?path=' + enc('equipo/plan.md'), undefined, A.s)).json.people.length === 4);
    const tricks = [await call('GET', '/live/note?path=privada.md&o=' + A.id, undefined, P), await call('GET', '/live/note?note=privada.md', undefined, P)];
    check('no hay forma de pedirle otra nota: los parámetros de más no cuentan', tricks.every((r) => r.status === 200 && r.json.name === 'plan.md' && !leaks(r)));
    const put = (body, pass) => call('PUT', '/live/note', body, pass || P);
    const noRev = await put({ text: 'sin revisión' });
    check('un invitado no guarda a ciegas: sin revisión responde 400', noRev.status === 400 && noRev.json.error === 'rev_required' && (await call('GET', '/live/note', undefined, P)).json.rev === 1, noRev.json);
    const okPut = await put({ text: '# Plan\n\nUno, de Ben.\n\nDos.\n', rev: 1, path: 'privada.md', o: B.id, owner: B.id, name: 'privada.md' });
    check('guarda sobre la revisión, y solo en la nota de su sesión', okPut.status === 200 && okPut.json.rev === 2 && !('path' in okPut.json) && (await call('GET', '/notes/' + enc('equipo/plan.md'), undefined, A.s)).json.text === '# Plan\n\nUno, de Ben.\n\nDos.\n'
      && (await call('GET', '/notes/privada.md', undefined, A.s)).json.text === '# Privada\n\n' + SECRET && (await call('GET', '/notes/b.md', undefined, B.s)).json.text === 'de beto ' + SECRET, okPut.json);
    const stalePut = await put({ text: 'PISADO', rev: 1 });
    check('sobre una revisión vieja recibe 409 con lo que hay, sin guardar', stalePut.status === 409 && stalePut.json.error === 'rev_conflict' && stalePut.json.rev === 2 && stalePut.json.text.includes('Uno, de Ben.') && stalePut.json.pid === 'g1' && !/@/.test(JSON.stringify(stalePut.json)), stalePut.json);
    const bigPut = await put({ text: 'a'.repeat(1024 * 1024 + 1), rev: 2 });
    check('el tope de 1 MB vale también para él', bigPut.status === 413 && (await put({ text: 'vault1:' + Buffer.alloc(60).toString('base64'), rev: 2 })).status === 409 && (await put({ text: 'x', rev: '2' })).status === 400 && (await call('PUT', '/live/note', '[1]', P)).status === 400);
    check('el pase de una sesión no sirve en otra: cada uno lee solo su nota', await (async () => { const o = (await join('Otra', other.json.secret)).json; guestSecrets.push(o.pass, o.ticket); const r = await call('GET', '/live/note', undefined, o.pass); return r.json.name === 'otra.md' && (await call('GET', '/live/note', undefined, P)).json.name === 'plan.md'; })());
    check('un pase inventado, uno cortado o una contraseña de reingreso no son un pase', (await call('GET', '/live/note', undefined, 'mdl_' + 'z'.repeat(43))).status === 401 && (await call('GET', '/live/note', undefined, P.slice(0, 30))).status === 401 && (await call('GET', '/live/note')).status === 401 && (await call('GET', '/live/note', undefined, g1.ticket)).status === 401);
    check('y la sesión de una cuenta tampoco entra por las rutas de invitado', (await call('GET', '/live/note', undefined, A.s)).status === 404 && (await call('PUT', '/live/note', { text: 'x', rev: 2 }, B.s)).status === 404 && (await call('GET', '/live/events', undefined, A.s)).status === 401);

    // ---------- Lo que escucha ----------
    console.log(' Lo que le llega por la escucha');
    const earG = await listen('/live/events', g2.pass); const earO = await listen('/events?path=' + enc('equipo/plan.md'), A.s); const earB = await listen('/events?path=' + enc('equipo/plan.md') + '&o=' + A.id, B.s);
    await sleep(300);
    await call('PUT', '/notes/' + enc('equipo/plan.md'), { text: '# Plan\n\nUno, de Ben.\n\nDos, de Ana.\n', rev: 2 }, A.s);
    await put({ text: '# Plan\n\nUno, de Ben.\n\nDos, de Ana.\n\nTres.\n', rev: 3 });
    await call('PUT', '/notes/' + enc('equipo/plan.md') + '?o=' + A.id, { text: '# Plan\n\nUno, de Ben.\n\nDos, de Ana.\n\nTres.\n\nCuatro, de Beto.\n', rev: 4 }, B.s);
    await call('POST', '/comments', { path: 'equipo/plan.md', quote: 'Uno', text: 'un comentario para la IA' }, A.s);
    await call('POST', '/vaults', { folder: 'cofre2', salt: Buffer.alloc(16, 1).toString('base64'), iters: 200000, wrapped: Buffer.alloc(60, 1).toString('base64'), check: Buffer.alloc(32, 1).toString('base64') }, A.s);
    await sleep(400);
    const evG = earG.events(); const evO = earO.events(); const evB = earB.events();
    const savedG = evG.filter((e) => e.type === 'saved');
    check('al invitado le llega cada guardado con el texto nuevo y quién fue (por número), sin pedir la nota', savedG.length === 3 && savedG[0].text.includes('Dos, de Ana.') && savedG[0].pid === 'o' && savedG[1].pid === 'g1' && savedG[2].pid === 'x' && savedG[2].text.includes('Cuatro, de Beto.') && savedG.map((e) => e.rev).join() === '3,4,5', savedG);
    check('por la escucha del invitado no pasa ningún correo, ni quién más tiene la nota abierta por su cuenta, ni comentarios ni carpetas', !/@ejemplo|"who"|"by"|"presence"|"comments"|"vault"/.test(earG.text) && evG.every((e) => e.type === 'saved' || e.type === 'live'), earG.text.slice(0, 400));
    check('a quien abrió la sesión le llega el guardado del invitado con el texto, sin correo de invitado', evO.some((e) => e.type === 'saved' && e.pid === 'g1' && e.by === 'guest' && e.text.includes('Tres.')), evO.filter((e) => e.type === 'saved'));
    check('a la cuenta con la nota compartida, que no es parte de la sesión, el aviso le llega sin el texto ni la lista de invitados', evB.filter((e) => e.type === 'saved').length === 3 && evB.every((e) => !('text' in e) && !('patch' in e) && e.type !== 'live') && !/Ben|img/.test(earB.text), evB);
    const ears = []; for (let i = 0; i < 5; i++) ears.push(await listen('/live/events', g3.pass));
    check('tope de conexiones por invitado: la quinta escucha con el mismo pase se rechaza', ears.slice(0, 4).every((e) => e.status === 200) && ears[4].status === 429, ears.map((e) => e.status));
    ears.forEach((e) => e.stop());
    // Sesenta escuchas abiertas desde una misma red (tres cuentas con veinte cada una): ahí tampoco entra la de un invitado.
    const many = []; const ipMany = '10.98.0.1';
    for (const mail of ['red1@ejemplo.test', 'red2@ejemplo.test', 'red3@ejemplo.test']) { const X = await signup(S, mail); await call('PUT', '/notes/n.md', { text: 'x' }, X.s); for (let i = 0; i < 20; i++) many.push(await listen('/events?path=n.md', X.s, from(ipMany))); }
    const overIp = await listen('/live/events', g3.pass, from(ipMany));
    check('y el tope de conexiones por red que ya existía también lo alcanza', many.every((e) => e.status === 200) && overIp.status === 429, [many.filter((e) => e.status === 200).length, overIp.status]);
    many.forEach((e) => e.stop()); overIp.stop(); await sleep(300);

    // ---------- Presencia ----------
    console.log(' Presencia: nadie habla por otro');
    const at = (body, pass) => call('POST', '/live/presence', body, pass);
    const people = async () => (await call('GET', '/live?path=' + enc('equipo/plan.md'), undefined, A.s)).json.people;
    const earP = await listen('/live/events', g1.pass); const ear2 = await listen('/live/events', g2.pass); await sleep(200);
    await at({ block: 'abc123.2.1', editing: true, id: 'o', pid: 'o', you: 'g2', name: 'Ana', color: 0, who: 'o', here: false }, g1.pass);
    await sleep(300);
    let now = await people();
    check('lo que avisa un invitado vale solo para él: no cambia el nombre, el color ni el lugar de otro', now[1].id === 'g1' && now[1].block === 'abc123.2.1' && now[1].editing === true && now[1].name === 'Ben' && now[0].name === 'Ana' && now[0].block === null && now[0].color === 0 && now[2].block === null, now);
    const claim = await at({ block: 'abc123.2.1', editing: true }, g2.pass); await sleep(200); now = await people();
    check('dos no toman el mismo bloque: el segundo se entera de quién lo tiene y no queda como que escribe', claim.json.held === 'g1' && now[2].block === 'abc123.2.1' && now[2].editing === false && now[1].editing === true, [claim.json, now]);
    const badBlocks = await Promise.all(['<img src=x onerror=1>', 'a b', 'x'.repeat(81), 7, {}, ['a'], '../../x', 'a\nb'].map((block) => at({ block, editing: true }, g2.pass)));
    check('el lugar es una marca corta de letras y números: otra cosa se rechaza', badBlocks.every((r) => r.status === 400 && r.json.error === 'bad_block'), badBlocks.map((r) => r.status));
    check('sin pase no se avisa nada, y quien abrió la sesión avisa lo suyo por su cuenta', (await at({ block: 'a.1.1' })).status === 401 && (await at({ path: 'equipo/plan.md', block: 'own.9.1', editing: false }, A.s)).status === 200 && (await at({ path: 'equipo/plan.md', block: 'x.1.1' }, B.s)).status === 404);
    const before = ear2.events().filter((e) => e.type === 'live').length; const burst = [];
    for (let i = 0; i < 60; i++) burst.push(at({ block: 'r' + i + '.1.1', editing: false }, g3.pass));
    const res = await Promise.all(burst); await sleep(500);
    const okN = res.filter((r) => r.status === 200).length; const cut = res.filter((r) => r.status === 429);
    const told = ear2.events().filter((e) => e.type === 'live').length - before;
    check('tope de ritmo: de sesenta avisos seguidos entran cuarenta y el resto recibe 429 con cuánto esperar', okN === 40 && cut.length === 20 && cut.every((r) => r.json.error === 'presence_rate' && r.json.retry_after >= 1 && r.headers.get('retry-after')), [okN, cut.length]);
    check('y a los demás les llegan juntos, no uno por aviso', told >= 1 && told <= 6, told);
    check('el tope de uno no frena al otro', (await at({ block: 'abc123.2.1', editing: true }, g1.pass)).status === 200);
    await sleep(8600); now = await people();
    check('"está escribiendo" se suelta solo a los ocho segundos si no se renueva', now[1].editing === false && now[1].block === 'abc123.2.1' && earP.events().filter((e) => e.type === 'live').pop().people[1].editing === false, now[1]);
    earP.stop(); ear2.stop();

    // ---------- Sacar a un invitado ----------
    console.log(' Sacar a un invitado, cambiar el enlace');
    const earK = await listen('/live/events', g2.pass); const earStay = await listen('/live/events', g1.pass); await sleep(200);
    check('un invitado no se saca solo a otro ni a quien abrió', (await call('POST', '/live/kick', { path: 'equipo/plan.md', id: 'g1' }, g2.pass)).status === 404 && (await call('POST', '/live/kick', { path: 'equipo/plan.md', id: 'o' }, A.s)).status === 404 && (await call('POST', '/live/kick', { path: 'equipo/plan.md', id: 'g99' }, A.s)).status === 404);
    const kick = await call('POST', '/live/kick', { path: 'equipo/plan.md', id: 'g2' }, A.s); const secret2 = kick.json.secret; guestSecrets.push(secret2);
    const right = [(await call('GET', '/live/note', undefined, g2.pass)).status, (await put({ text: 'x', rev: 5 }, g2.pass)).status, (await at({ block: 'a.1.1' }, g2.pass)).status, (await listen('/live/events', g2.pass)).status];
    check('sacar a un invitado lo corta en el acto: su pase ya no lee, no guarda, no avisa ni escucha', kick.status === 200 && right.every((s) => s === 401), right);
    await sleep(300);
    const lastK = earK.events().pop();
    check('su escucha abierta recibe el motivo y se cierra', earK.done && lastK.type === 'live' && lastK.open === false && lastK.why === 'kicked', [earK.done, lastK]);
    check('el enlace cambia: con el anterior no vuelve a entrar, ni con su contraseña de reingreso', /^[A-Za-z0-9_-]{43}$/.test(secret2) && secret2 !== secret && (await join('Otra vez')).status === 404 && (await call('POST', '/live/join', { ticket: g2.ticket, name: 'Otra vez' }, undefined, from(nextIp()))).status === 404);
    check('los demás siguen adentro con su pase', (await call('GET', '/live/note', undefined, g1.pass)).status === 200 && !earStay.done && (await people()).map((p) => p.id).join() === 'o,g1,g3');
    const back = await call('POST', '/live/join', { ticket: g1.ticket, name: 'Ben' }, undefined, from(nextIp())); guestSecrets.push(back.json.pass);
    check('y quien sigue adentro puede volver a entrar con su contraseña de reingreso aunque el enlace haya cambiado', back.status === 200 && /^mdl_/.test(back.json.pass) && !('ticket' in back.json) && (await call('GET', '/live/note', undefined, back.json.pass)).status === 200 && (await call('GET', '/live/note', undefined, g1.pass)).status === 401 && (await people()).length === 3);
    const rot = await call('POST', '/live/rotate', { path: 'equipo/plan.md' }, A.s); const secret3 = rot.json.secret; guestSecrets.push(secret3);
    check('"crear un enlace nuevo" deja sin efecto el anterior sin sacar a nadie', rot.status === 200 && (await join('Tarde', secret2)).status === 404 && (await call('POST', '/live/look', { secret: secret3 }, undefined, from(nextIp()))).status === 200 && (await call('GET', '/live/note', undefined, back.json.pass)).status === 200);
    const left = await call('POST', '/live/leave', {}, g3.pass);
    check('quien sale por su cuenta deja de tener pase y contraseña de reingreso', left.status === 200 && (await call('GET', '/live/note', undefined, g3.pass)).status === 401 && (await call('POST', '/live/join', { ticket: g3.ticket, name: 'x' }, undefined, from(nextIp()))).status === 404);
    earStay.stop();

    // ---------- Cerrar ----------
    console.log(' Cerrar la sesión');
    const n1 = (await call('POST', '/live/join', { secret: secret3, name: 'Uno' }, undefined, from(nextIp()))).json; const n2 = (await call('POST', '/live/join', { secret: secret3, name: 'Dos' }, undefined, from(nextIp()))).json; guestSecrets.push(n1.pass, n2.pass, n1.ticket, n2.ticket);
    const earC = await listen('/live/events', n1.pass); const earOwner = await listen('/events?path=' + enc('equipo/plan.md'), A.s); await sleep(200);
    const closed = await call('DELETE', '/live?path=' + enc('equipo/plan.md'), undefined, A.s);
    const dead = []; for (const p of [n1.pass, n2.pass, back.json.pass]) dead.push((await call('GET', '/live/note', undefined, p)).status, (await put({ text: 'tarde', rev: 5 }, p)).status, (await listen('/live/events', p)).status);
    check('al cerrar la sesión todos los pases dejan de servir en el acto', closed.status === 200 && dead.every((s) => s === 401), dead);
    await sleep(300);
    check('las escuchas de los invitados se cierran con el motivo, y la de quien la abrió sigue', earC.done && earC.events().pop().why === 'closed' && !earOwner.done && earOwner.events().some((e) => e.type === 'live' && e.open === false));
    check('el enlace y las contraseñas de reingreso dejan de servir, con la misma respuesta que un secreto equivocado', (await join('x', secret3)).json.error === 'live_gone' && (await call('POST', '/live/look', { secret: secret3 }, undefined, from(nextIp()))).status === 404 && (await call('POST', '/live/join', { ticket: n1.ticket, name: 'x' }, undefined, from(nextIp()))).status === 404
      && (await call('GET', '/live?path=' + enc('equipo/plan.md'), undefined, A.s)).json.open === false);
    const db2 = S.db(); const left2 = [db2.prepare("SELECT COUNT(*) AS n FROM lives WHERE path = 'equipo/plan.md'").get().n, db2.prepare('SELECT COUNT(*) AS n FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)').get().n]; db2.close();
    check('en la base no queda nada de esa sesión', left2[0] === 0 && left2[1] === 0, left2);
    check('lo guardado durante la sesión quedó en la nota de su dueño', (await call('GET', '/notes/' + enc('equipo/plan.md'), undefined, A.s)).json.text.includes('Cuatro, de Beto.'));
    earOwner.stop(); earG.stop(); earO.stop(); earB.stop();
    // Otras formas de terminar: la nota se elimina, cambia de nombre, queda en una carpeta con contraseña, o la cuenta deja el plan pago.
    const endBy = async (p, act) => { const s = (await live({ path: p, name: 'Ana' }, A.s)).json.secret; const g = (await call('POST', '/live/join', { secret: s, name: 'Inv' }, undefined, from(nextIp()))).json; guestSecrets.push(s, g.pass, g.ticket); const pre = (await call('GET', '/live/note', undefined, g.pass)).status; await act(); return [pre, (await call('GET', '/live/note', undefined, g.pass)).status, (await call('POST', '/live/look', { secret: s }, undefined, from(nextIp()))).status]; };
    const byDelete = await endBy('borrar.md', () => call('DELETE', '/notes/borrar.md', undefined, A.s));
    const byRename = await endBy('mover.md', () => call('POST', '/rename', { from: 'mover.md', to: 'movida.md' }, A.s));
    const byPlan = await endBy('plan-pago.md', () => S.call('POST', '/admin/plan', { email: A.email, plan: 'free' }, undefined, { 'x-admin-key': ADMIN }));
    check('eliminar la nota, cambiarle el nombre o dejar el plan pago cierran la sesión y cortan los pases', [byDelete, byRename, byPlan].every((r) => r[0] === 200 && r[1] === 401 && r[2] === 404), [byDelete, byRename, byPlan]);
    await makePro(S, A.email);
    const stillOther = await call('GET', '/live?path=' + enc('equipo/otra.md'), undefined, A.s);
    check('la otra sesión de la misma cuenta siguió abierta todo el tiempo salvo por el plan', stillOther.status === 200);

    const logged = guestSecrets.concat(secrets).filter((x) => x && S.log().includes(x));
    check('la salida del servidor no trae secretos de enlace, pases, contraseñas de reingreso ni texto de notas', logged.length === 0 && guestSecrets.filter(Boolean).length > 15 && !/mdl_|mdk_/.test(S.log()), logged.map((x) => x.slice(0, 8)));
    check('nada de esto se anotó como error del servidor, y sigue arriba', !/error 500|error no capturado|promesa sin atender/.test(S.log()) && S.alive() && (await call('GET', '/health')).status === 200, (S.log().match(/error[^\n]*/g) || []).slice(0, 4));
  } catch (e) { check('sesión en vivo: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-2000)); }
  await S.stop();

  // Vencimiento: con tiempos cortos, para verlo pasar.
  console.log(' Vencimiento');
  const V = await boot({ ADMIN_KEY: ADMIN, LIVE_IDLE_MS: '1500', LIVE_GUEST_MS: '700' });
  try {
    const A = await signup(V, 'ana@ejemplo.test'); await V.call('POST', '/admin/plan', { email: A.email, plan: 'pro' }, undefined, { 'x-admin-key': ADMIN });
    await V.call('PUT', '/notes/a.md', { text: 'a' }, A.s); await V.call('PUT', '/notes/b.md', { text: 'b' }, A.s);
    const sa = (await V.call('POST', '/live', { path: 'a.md', name: 'Ana' }, A.s)).json.secret; const sb = (await V.call('POST', '/live', { path: 'b.md', name: 'Ana' }, A.s)).json.secret;
    const ga = (await V.call('POST', '/live/join', { secret: sa, name: 'Inv' }, undefined, from(nextIp()))).json; const gb = (await V.call('POST', '/live/join', { secret: sb, name: 'Inv' }, undefined, from(nextIp()))).json;
    // En b queda alguien escuchando; en a, nadie.
    const ctrl = new AbortController(); const held = await fetch(V.base + '/live/events', { headers: { authorization: 'Bearer ' + gb.pass }, signal: ctrl.signal });
    await sleep(1000);
    const mid = (await V.call('GET', '/live?path=a.md', undefined, A.s)).json;
    check('un invitado sin conexión deja su lugar pasado un rato, y puede volver con su contraseña de reingreso', mid.open === true && mid.people.length === 1 && (await V.call('GET', '/live/note', undefined, ga.pass)).status === 401 && (await V.call('POST', '/live/join', { ticket: ga.ticket, name: 'Inv' }, undefined, from(nextIp()))).status === 200);
    await sleep(3200);
    const a = (await V.call('GET', '/live?path=a.md', undefined, A.s)).json; const b = (await V.call('GET', '/live?path=b.md', undefined, A.s)).json;
    check('la sesión sin nadie conectado vence sola', a.open === false && (await V.call('POST', '/live/look', { secret: sa }, undefined, from(nextIp()))).status === 404 && (await V.call('POST', '/live/join', { ticket: ga.ticket, name: 'x' }, undefined, from(nextIp()))).status === 404 && (await V.call('GET', '/live/note', undefined, ga.pass)).status === 401, a);
    check('la que tiene a alguien conectado no vence', held.status === 200 && b.open === true && b.people.length === 2 && (await V.call('GET', '/live/note', undefined, gb.pass)).status === 200, b);
    ctrl.abort(); await sleep(2600);
    check('y vence cuando se va el último', (await V.call('GET', '/live?path=b.md', undefined, A.s)).json.open === false && (await V.call('GET', '/live/note', undefined, gb.pass)).status === 401);
    const db = V.db(); const n = [db.prepare('SELECT COUNT(*) AS n FROM lives').get().n, db.prepare('SELECT COUNT(*) AS n FROM live_tickets').get().n]; db.close();
    check('vencidas, no dejan nada en la base', n[0] === 0 && n[1] === 0, n);
  } catch (e) { check('vencimiento: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(V.log().slice(-2000)); }
  await V.stop();
}
if (ONLY !== 'server' && ONLY !== 'app') await liveSuite();

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
