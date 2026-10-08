// Seguridad: un caso por cada control del servidor, de la página de pago y de la app.
// Todo corre contra un servidor local con claves inventadas y contra la extensión cargada en un Chromium:
// ningún pedido sale a sync.sharpmd.app ni a sharpmd.app (lo que apunte ahí se corta y se anota como falla).
// SHARPMD_SERVER apunta a otro server.mjs, para comparar contra una versión anterior. SEC_ONLY=server|app|live|team|gallery|auto|sites corre una parte.
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
    // Tableros: las herramientas de tablero miran el mismo alcance que las de notas.
    const KB = '# Tablero\n\n' + '`'.repeat(3) + 'kanban\n## To do\n- [ ] Tarea ' + SECRET + ' {id=aaaaaaaa}\n\n## Done\n' + '`'.repeat(3) + '\n';
    await call('PUT', '/notes/' + enc('beta/tablero.md'), { text: KB }, I.s);
    const kbOut = []; for (const p of ['beta/tablero.md', 'alfa/../beta/tablero.md', '/beta/tablero.md', 'suelta.md', 'Alfa/y.md']) for (const [n, a] of [['list_boards', {}], ['create_board', {}], ['add_card', { title: 'PISADA' }], ['move_card', { id: 'aaaaaaaa', column: 'Done' }], ['update_card', { id: 'aaaaaaaa', title: 'PISADA', fields: { x: 'PISADA' } }], ['delete_card', { id: 'aaaaaaaa' }]]) { const r = await tool(S, lim.token, n, Object.assign({ path: p }, a)); if (!r.err || JSON.stringify(r.v).includes(SECRET)) kbOut.push(n + ' ' + p); }
    const kbIn = [await tool(S, lim.token, 'create_board', { path: 'alfa/tablero.md' }), await tool(S, lim.token, 'add_card', { path: 'alfa/tablero.md', title: 'adentro' })];
    check('token de carpeta: las herramientas de tablero tampoco salen de la carpeta, y adentro sí andan', kbOut.length === 0 && (await call('GET', '/notes/' + enc('beta/tablero.md'), undefined, I.s)).json.text === KB && (await call('GET', '/search?q=PISADA', undefined, I.s)).json.length === 0 && kbIn.every((r) => !r.err) && kbIn[1].v.card.column === 'To do' && /cloud%2Falfa%2Ftablero\.md$/.test(kbIn[1].v.url), [kbOut, kbIn.map((r) => r.v)]);
    const kbOdd = []; for (const [n, a] of [['add_card', { title: 'x', fields: { 'a b': '1' } }], ['add_card', { title: 'x', fields: { id: 'zzzzzzzz' } }], ['add_card', { title: 'x', fields: { updated: '1' } }], ['add_card', { title: 'x', fields: ['a'] }], ['add_card', { title: 'x', fields: { a: { b: 1 } } }], ['add_card', { title: 'x'.repeat(501) }], ['add_card', { title: '' }], ['add_card', { title: 'x', board: 7 }], ['move_card', { id: '9.9.9', column: 'Done' }], ['move_card', { id: "x' OR 1=1", column: 'Done' }], ['update_card', { id: '', title: 'x' }], ['create_board', { columns: 'To do' }], ['create_board', { columns: [] }], ['create_board', { columns: new Array(21).fill(0).map((_, i) => 'c' + i) }], ['create_board', { columns: ['x'.repeat(121)] }]]) { const r = await tool(S, lim.token, n, Object.assign({ path: 'alfa/tablero.md' }, a)); if (!r.err) kbOdd.push(n + ' ' + JSON.stringify(a).slice(0, 40)); }
    const kbRaw = await tool(S, lim.token, 'add_card', { path: 'alfa/tablero.md', title: 'Con llaves {id=aaaaaaaa} y\nsalto\n## Otra columna', fields: { nota: 'a"b} {c=d}\n- [ ] colada' } });
    const kbAfter = (await tool(S, lim.token, 'list_boards', { path: 'alfa/tablero.md' })).v;
    check('tableros por MCP: campos reservados, claves raras, títulos largos y tableros que no existen se rechazan', kbOdd.length === 0, kbOdd);
    check('tableros por MCP: un título o un campo con llaves y saltos de renglón no arma otra tarjeta ni otra columna', !kbRaw.err && kbAfter.boards.length === 1 && kbAfter.boards[0].columns.length === 4 && kbAfter.boards[0].columns[0].cards.length === 2 && kbAfter.boards[0].columns[0].cards[1].id === kbRaw.v.card.id && kbRaw.v.card.id !== 'aaaaaaaa', [kbRaw.v, kbAfter]);
    await call('DELETE', '/notes/' + enc('beta/tablero.md'), undefined, I.s); await call('DELETE', '/notes/' + enc('alfa/tablero.md'), undefined, I.s);
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
    // El MCP es de todos los planes: al volver a gratis el token sigue entrando, dentro de su carpeta. La API y las automatizaciones no.
    const freeMcp = [await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, lim.token), await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_guide', arguments: {} } }, lim.token), await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'beta/ideas.md' } } }, lim.token)];
    const freePaid = [await call('GET', '/api/v1/notes', undefined, lim.token), await call('POST', '/automations/hooks', { url: 'https://ejemplo.test/x', events: ['note.created'] }, I.s), await call('POST', '/automations/inboxes', { name: 'x', kind: 'append', path: 'alfa/plan.md' }, I.s)];
    check('al volver a gratis el token de MCP sigue entrando sin salirse de su carpeta, y la API y las automatizaciones piden el plan pago', freeMcp.every((r) => r.status === 200) && freeMcp[2].json.result.isError === true && /only reaches the folder/.test(freeMcp[2].json.result.content[0].text) && freePaid.every((r) => r.status === 402), [freeMcp.map((r) => r.status), freePaid.map((r) => r.status)]);
    await makePro(S, I.email);
    // ---------- Compartir desde la IA: un permiso aparte ----------
    console.log(' Compartir por MCP');
    {
    const SHARE5 = ['list_shares', 'share_note', 'unshare_note', 'create_public_link', 'revoke_public_link'];
    const names = async (tok) => (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tok)).json.result.tools.map((x) => x.name);
    const mkTok = async (body) => { const r = (await call('POST', '/tokens', body, I.s)).json; secrets.push(r.token); return r; };
    const plainTok = await mkTok({ name: 'sin permiso' }); const sh = await mkTok({ name: 'comparte', share: true }); const shAlfa = await mkTok({ name: 'comparte alfa', folder: 'alfa', share: true });
    const almost = []; for (const v of ['true', 1, 'yes', {}, [true], null]) almost.push((await mkTok({ name: 'casi', share: v })).share);
    const listed = (await call('GET', '/tokens', undefined, I.s)).json;
    check('compartir por MCP: el permiso se da solo con share: true, y la lista de tokens lo muestra', plainTok.share === false && sh.share === true && shAlfa.share === true && almost.every((x) => x === false) && listed.filter((x) => x.share).map((x) => x.name).sort().join() === 'comparte,comparte alfa' && listed.find((x) => x.name === 'alfa').share === false, [almost, listed.map((x) => [x.name, x.share])]);
    const seen = [await names(plainTok.token), await names(lim.token), await names(sh.token)];
    check('compartir por MCP: sin el permiso las herramientas no figuran; con él, sí', seen[0].length === 17 && seen[1].length === 17 && !seen[0].concat(seen[1]).some((x) => SHARE5.includes(x)) && SHARE5.every((x) => seen[2].includes(x)) && seen[2].length === 22, seen.map((x) => x.length));
    const counts = () => { const d = S.db(); const r = [d.prepare('SELECT COUNT(*) AS n FROM shares').get().n, d.prepare('SELECT COUNT(*) AS n FROM links').get().n]; d.close(); return r.join(); };
    const before = counts(); const denied = [];
    for (const tok of [plainTok.token, lim.token]) for (const [n, a] of [['list_shares', {}], ['share_note', { path: 'alfa/plan.md', email: C.email }], ['share_note', { path: 'alfa', email: C.email, role: 'edit' }], ['unshare_note', { path: 'alfa/plan.md', email: C.email }], ['create_public_link', { path: 'alfa/plan.md' }], ['revoke_public_link', { path: 'alfa/plan.md' }]]) { const r = await tool(S, tok, n, a); if (!r.err || !/cannot share/.test(String(r.v))) denied.push(n); }
    check('compartir por MCP: sin el permiso, llamarlas falla y no deja nada compartido', denied.length === 0 && counts() === before && (await call('GET', '/shared', undefined, C.s)).json.every((n) => n.by !== I.email), [denied, before, counts()]);

    // Con el permiso y limitado a una carpeta: nada fuera de ella.
    const outLink = (await call('POST', '/links', { path: 'beta/ideas.md' }, I.s)).json; await call('POST', '/shares', { path: 'beta/ideas.md', email: B.email }, I.s);
    const base0 = counts(); const escaped = [];
    for (const p of ['beta/ideas.md', 'beta', 'suelta.md', 'alfa/../beta/ideas.md', '../beta/ideas.md', 'alfabeto/x.md', 'Alfa/y.md', 'alfabeto', '/beta/ideas.md', 'alfa\\..\\beta\\ideas.md']) {
      for (const [n, a] of [['share_note', { path: p, email: C.email }], ['create_public_link', { path: p }], ['unshare_note', { path: p, email: B.email }], ['revoke_public_link', { path: p }], ['list_shares', { path: p }]]) { const r = await tool(S, shAlfa.token, n, a); if (!r.err) escaped.push(n + ' ' + p); }
    }
    const byId = await tool(S, shAlfa.token, 'revoke_public_link', { id: outLink.id }); const seenOut = await tool(S, shAlfa.token, 'list_shares', {});
    check('compartir por MCP: un token de carpeta no comparte, enlaza, lista ni revoca fuera de ella', escaped.length === 0 && counts() === base0 && byId.err && seenOut.v.people.length === 0 && seenOut.v.links.length === 0 && (await call('GET', '/public/' + outLink.token)).status === 200 && (await call('GET', '/notes/' + enc('beta/ideas.md') + '?o=' + I.id, undefined, B.s)).status === 200, [escaped, byId.v, seenOut.v]);
    // Adentro, anda: nota, carpeta, enlace con contraseña, y deshacerlo.
    const okNote = await tool(S, shAlfa.token, 'share_note', { path: 'alfa/plan.md', email: C.email }); const okFolder = await tool(S, shAlfa.token, 'share_note', { path: 'alfa/notas', email: C.email, role: 'edit' });
    const got = (await call('GET', '/shared', undefined, C.s)).json.filter((n) => n.by === I.email).map((n) => n.path + ':' + n.role).sort().join();
    const lk = await tool(S, shAlfa.token, 'create_public_link', { path: 'alfa/plan.md', password: 'clave-larga-9' }); const lkTok = lk.err ? '' : new URL(lk.v.url).searchParams.get('f').slice(4); secrets.push(lkTok);
    const pub = [await call('GET', '/public/' + lkTok), await call('GET', '/public/' + lkTok, undefined, undefined, { 'x-password': 'otra' }), await call('GET', '/public/' + lkTok, undefined, undefined, { 'x-password': 'clave-larga-9' })];
    const mineNow = await tool(S, shAlfa.token, 'list_shares', {});
    check('compartir por MCP: dentro de su carpeta comparte una nota y una carpeta, y crea un enlace con contraseña', !okNote.err && !okFolder.err && got === 'alfa/notas/r.md:edit,alfa/plan.md:view' && !lk.err && lk.v.protected === true && /\?f=pub%2F/.test(lk.v.url) && pub[0].status === 401 && pub[1].status === 403 && pub[2].status === 200 && pub[2].json.text === 'plan de alfa' && mineNow.v.people.length === 2 && mineNow.v.links.length === 1 && !JSON.stringify(mineNow.v).includes('beta'), [okNote.v, okFolder.v, got, lk.v, pub.map((r) => r.status), mineNow.v]);
    const undo = [await tool(S, shAlfa.token, 'unshare_note', { path: 'alfa/plan.md', email: C.email }), await tool(S, shAlfa.token, 'unshare_note', { path: 'alfa/notas', email: C.email }), await tool(S, shAlfa.token, 'revoke_public_link', { id: lk.v.id }), await tool(S, shAlfa.token, 'unshare_note', { path: 'alfa/plan.md', email: C.email })];
    check('compartir por MCP: dejar de compartir y revocar el enlace lo deshacen', undo.slice(0, 3).every((r) => !r.err) && undo[3].err && (await call('GET', '/shared', undefined, C.s)).json.every((n) => n.by !== I.email) && (await call('GET', '/public/' + lkTok, undefined, undefined, { 'x-password': 'clave-larga-9' })).status === 404 && counts() === base0, [undo.map((r) => r.v), counts(), base0]);
    const odd = [await tool(S, sh.token, 'share_note', { path: 'alfa/plan.md', email: I.email }), await tool(S, sh.token, 'share_note', { path: 'alfa/plan.md', email: 'no-es-correo' }), await tool(S, sh.token, 'share_note', { path: 'alfa/plan.md' }), await tool(S, sh.token, 'share_note', { path: 'no/existe.md', email: C.email }), await tool(S, sh.token, 'create_public_link', { path: 'no/existe.md' }), await tool(S, sh.token, 'create_public_link', { path: 'alfa' }), await tool(S, sh.token, 'create_public_link', { path: 'alfa/plan.md', password: 'x'.repeat(201) }), await tool(S, sh.token, 'revoke_public_link', {}), await tool(S, sh.token, 'revoke_public_link', { id: linkA.id }), await tool(S, sh.token, 'share_note', { path: 'privada.md', email: C.email })];
    check('compartir por MCP: valen las mismas reglas que en la app (correo propio o mal formado, ruta que no existe, contraseña larga, lo de otra cuenta)', odd.every((r) => r.err) && counts() === base0 && (await call('GET', '/public/' + linkA.token)).status === 200, odd.map((r) => r.v));
    // Carpetas con contraseña: no se comparten ni se enlazan, tampoco con el permiso.
    await call('PUT', '/notes/' + enc('alfa/cofre/previa.md'), { text: 'antes del cofre' }, I.s);
    const vraw = (n) => Buffer.alloc(n, 3).toString('base64');
    const cofre = await call('POST', '/vaults', { folder: 'alfa/cofre', salt: vraw(16), iters: 200000, wrapped: vraw(60), check: vraw(32) }, I.s);
    const vaulted = []; for (const tok of [sh.token, shAlfa.token]) for (const [n, a] of [['share_note', { path: 'alfa/cofre', email: C.email }], ['share_note', { path: 'alfa/cofre/previa.md', email: C.email }], ['create_public_link', { path: 'alfa/cofre/previa.md' }], ['move_note', { from: 'alfa/cofre/previa.md', to: 'alfa/fuera.md' }], ['move_note', { from: 'alfa/plan.md', to: 'alfa/cofre/plan.md' }], ['note_history', { path: 'alfa/cofre/previa.md' }], ['list_boards', { path: 'alfa/cofre/previa.md' }], ['create_board', { path: 'alfa/cofre/previa.md' }], ['create_board', { path: 'alfa/cofre/tablero.md' }], ['add_card', { path: 'alfa/cofre/previa.md', title: 'x' }], ['move_card', { path: 'alfa/cofre/previa.md', id: '0.0.0', column: 'Done' }], ['update_card', { path: 'alfa/cofre/previa.md', id: '0.0.0', title: 'x' }], ['delete_card', { path: 'alfa/cofre/previa.md', id: '0.0.0' }]]) { const r = await tool(S, tok, n, a); if (!r.err || (/board|card/.test(n) && !/protected with a password and is locked/.test(String(r.v)))) vaulted.push(n); }
    check('compartir por MCP: una carpeta con contraseña no se comparte, no se enlaza ni se mueve desde la IA, y bloqueada no deja leer ni cambiar un tablero', cofre.status === 200 && vaulted.length === 0 && counts() === base0 && (await call('GET', '/notes/' + enc('alfa/cofre/tablero.md'), undefined, I.s)).status === 404 && (await call('GET', '/notes/' + enc('alfa/plan.md'), undefined, I.s)).status === 200, [cofre.status, vaulted, counts()]);
    // Mover y leer el historial respetan el alcance del token.
    await call('PUT', '/notes/' + enc('beta/ideas.md'), { text: 'ideas nuevas' }, I.s); await call('PUT', '/notes/' + enc('alfa/plan.md'), { text: 'plan de alfa, segunda vuelta' }, I.s);
    const verBeta = (await call('GET', '/versions/' + enc('beta/ideas.md'), undefined, I.s)).json[0];
    const hist = await tool(S, lim.token, 'note_history', { path: 'alfa/plan.md' });
    const moves = [await tool(S, lim.token, 'move_note', { from: 'beta/ideas.md', to: 'alfa/robada.md' }), await tool(S, lim.token, 'move_note', { from: 'alfa/plan.md', to: 'beta/sacada.md' }), await tool(S, lim.token, 'move_note', { from: 'alfa/plan.md', to: 'alfa/../suelta2.md' }), await tool(S, lim.token, 'move_note', { from: 'alfa/plan.md', to: 'alfa/notas/r.md' }), await tool(S, lim.token, 'note_history', { path: 'beta/ideas.md' }), await tool(S, lim.token, 'note_history', { path: 'alfa/plan.md', version: verBeta.id }), await tool(S, lim.token, 'note_history', { path: 'alfa/plan.md', version: String(verBeta.id) + ' OR 1=1' })];
    const histText = await tool(S, lim.token, 'note_history', { path: 'alfa/plan.md', version: hist.v[0] && hist.v[0].version });
    const moved = await tool(S, lim.token, 'move_note', { from: 'alfa/plan.md', to: 'alfa/hecho/plan.md' });
    check('mover y leer el historial por MCP no salen de la carpeta del token', moves.every((r) => r.err && !JSON.stringify(r.v).includes(SECRET)) && hist.v.length === 1 && histText.v === 'plan de alfa' && !moved.err && /Open it: \S+\?f=cloud%2Falfa%2Fhecho%2Fplan\.md$/.test(moved.v) && (await call('GET', '/notes/' + enc('alfa/hecho/plan.md'), undefined, I.s)).json.text === 'plan de alfa, segunda vuelta' && (await call('GET', '/notes/' + enc('beta/ideas.md'), undefined, I.s)).json.text === 'ideas nuevas', [moves.map((r) => r.v), hist.v, histText.v, moved.v]);
    // Los tokens de antes de esta versión: la columna nace en cero.
    check('compartir por MCP: en la base, solo los tokens creados con el permiso lo tienen', (() => { const d = S.db(); const rows = d.prepare('SELECT name, share FROM tokens').all(); d.close(); return rows.filter((r) => r.share).map((r) => r.name).sort().join() === 'comparte,comparte alfa' && rows.every((r) => r.share === 0 || r.share === 1); })());
    }

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
    check('la cuenta de prueba: sin código en la respuesta, plan gratis, con MCP y sin API ni compartir, y su código no abre otra cuenta', tst.status === 200 && !tst.json.dev_code && tv.json.account.plan === 'free' && tv.json.account.mcp === true && tv.json.account.api === false && tv.json.account.share === false && (await call('POST', '/admin/plan', { email: 'x@ejemplo.test', plan: 'pro' }, tv.json.session)).status === 403 && fixedOther.status === 400, [tst.json, tv.json.account, fixedOther.status]);
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

    // ---------- Papelera, carpeta protegida sin contraseña y eliminar la cuenta ----------
    console.log(' Papelera y eliminar la cuenta');
    {
      const T = await signup(S, 'tacho@ejemplo.test'); const I = await signup(S, 'intrusa@ejemplo.test'); const V = await signup(S, 'seva@ejemplo.test');
      await makePro(S, T.email); await makePro(S, V.email);
      const TRASHED = 'RABANITO-EN-LA-PAPELERA-5521'; secrets.push(TRASHED);
      await call('PUT', '/notes/' + enc('tacho/secreto.md'), { text: TRASHED }, T.s);
      await call('PUT', '/notes/' + enc('tacho/otra.md'), { text: 'sigue' }, T.s);
      await call('POST', '/shares', { path: 'tacho', kind: 'folder', email: I.email, role: 'edit' }, T.s);
      const tl = (await call('POST', '/links', { path: 'tacho/secreto.md' }, T.s)).json.token; secrets.push(tl);
      const tt = (await call('POST', '/tokens', { name: 'IA' }, T.s)).json.token; secrets.push(tt);
      await call('DELETE', '/notes/' + enc('tacho/secreto.md'), undefined, T.s);
      const tid = (await call('GET', '/trash', undefined, T.s)).json[0].id;
      const spill = (r) => JSON.stringify(r.json || '').includes(TRASHED) || JSON.stringify(r.json || '').includes('secreto.md');
      const holes = [];
      for (const [who, w] of [['con la carpeta compartida para editar', I], ['otra cuenta paga', V]]) {
        const tries = [['listar', await call('GET', '/trash', undefined, w.s), 200], ['listar con o', await call('GET', '/trash?o=' + T.id, undefined, w.s), 403], ['restaurar', await call('POST', '/trash/' + tid + '/restore', {}, w.s), 404],
          ['restaurar con o', await call('POST', '/trash/' + tid + '/restore?o=' + T.id, {}, w.s), 403], ['borrar', await call('DELETE', '/trash/' + tid, undefined, w.s), 404], ['borrar con o', await call('DELETE', '/trash/' + tid + '?o=' + T.id, undefined, w.s), 403],
          ['vaciar con o', await call('DELETE', '/trash?o=' + T.id, undefined, w.s), 403], ['vaciar', await call('DELETE', '/trash', undefined, w.s), 200], ['leer', await call('GET', '/notes/' + enc('tacho/secreto.md') + '?o=' + T.id, undefined, w.s), 404],
          ['lo compartido', await call('GET', '/shared', undefined, w.s), 200], ['buscar', await call('GET', '/search?q=' + TRASHED, undefined, w.s), 200]];
        for (const [what, r, want] of tries) if ((what === 'leer' ? r.status !== 403 && r.status !== 404 : r.status !== want) || spill(r)) holes.push(who + ': ' + what + ' ' + r.status);
      }
      check('papelera: otra cuenta no la lista, no restaura ni borra nada de ella, ni teniendo la carpeta compartida para editar', holes.length === 0 && (await call('GET', '/trash', undefined, T.s)).json.length === 1, holes);
      const noSession = [await call('GET', '/trash'), await call('GET', '/trash', undefined, tt), await call('POST', '/trash/' + tid + '/restore', {}, tt), await call('DELETE', '/trash', undefined, tt), await call('DELETE', '/account', { email: T.email }, tt), await call('DELETE', '/account', { email: T.email })];
      check('papelera y cuenta: sin sesión, o con un token de MCP, no hay acceso', noSession.every((r) => r.status === 401), noSession.map((r) => r.status));
      const ai = [await tool(S, tt, 'search_notes', { query: TRASHED }), await tool(S, tt, 'list_notes', {}), await tool(S, tt, 'read_note', { path: 'tacho/secreto.md' })];
      check('papelera: no sale por la búsqueda, por el enlace público ni por MCP', !spill(await call('GET', '/search?q=' + TRASHED, undefined, T.s)) && (await call('GET', '/public/' + tl)).status === 404 && ai.every((r) => !JSON.stringify(r).includes(TRASHED)) && !JSON.stringify(ai[1]).includes('secreto.md'), ai.map((r) => JSON.stringify(r).slice(0, 80)));
      const odd = []; for (const u of ['/trash/abc/restore', '/trash/' + tid + '%20OR%201=1/restore', '/trash/-1/restore', '/trash/' + tid + '/restore/x', '/trash/1e3/restore', '/trash/%00/restore']) { const r = await call('POST', u, {}, T.s); if (r.status !== 404 && r.status !== 400) odd.push(u + ' ' + r.status); }
      check('papelera: un número raro en la dirección no llega a nada', odd.length === 0 && (await call('GET', '/trash', undefined, T.s)).json.length === 1, odd);
      const moved = await call('POST', '/trash/' + tid + '/restore', { to: 'privada.md', path: 'otra/ruta.md', text: 'pisada', o: A.id }, T.s);
      check('papelera: restaurar no deja elegir otra ruta ni otro texto', moved.status === 200 && moved.json.path === 'tacho/secreto.md' && (await call('GET', '/notes/' + enc('tacho/secreto.md'), undefined, T.s)).json.text === TRASHED && (await call('GET', '/notes/privada.md', undefined, T.s)).status === 404, moved.json);
      // Carpeta protegida: eliminarla sin contraseña es solo de su dueña.
      const vb = (n) => Buffer.alloc(n, 4).toString('base64');
      const vault = (await call('POST', '/vaults', { folder: 'cofre', salt: vb(16), iters: 200000, wrapped: vb(60), check: vb(32) }, T.s)).json;
      await call('PUT', '/notes/' + enc('cofre/a.md'), { text: 'vault1:' + vb(60) }, T.s);
      const raids = [await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, I.s), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, V.s), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, tt), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' })];
      const loose = [await call('POST', '/vaults/' + vault.id + '/destroy', {}, T.s), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre/' }, T.s), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: ['cofre'] }, T.s), await call('POST', '/vaults/' + vault.id + '/destroy', { folder: 'tacho' }, T.s)];
      check('carpeta protegida: otra cuenta no la elimina, y sin el nombre exacto tampoco su dueña', raids.map((r) => r.status).join() === '404,404,401,401' && loose.every((r) => r.status === 400) && (await call('GET', '/notes/' + enc('cofre/a.md'), undefined, T.s)).status === 200, [raids.map((r) => r.status), loose.map((r) => r.status)]);
      // Eliminar la cuenta: solo la propia, y no queda nada suyo.
      await call('PUT', '/notes/' + enc('mia.md'), { text: 'una' }, V.s); await call('PUT', '/notes/' + enc('mia.md'), { text: 'dos' }, V.s); await call('DELETE', '/notes/' + enc('mia.md'), undefined, V.s);
      await call('PUT', '/notes/' + enc('otra.md'), { text: 'queda' }, V.s);
      await call('POST', '/shares', { path: 'otra.md', email: T.email, role: 'view' }, V.s); await call('POST', '/links', { path: 'otra.md' }, V.s); await call('POST', '/tokens', { name: 'IA' }, V.s);
      await call('POST', '/comments', { path: 'otra.md', quote: 'q', text: 'cambiar' }, V.s); await call('POST', '/vaults', { folder: 'caja', salt: vb(16), iters: 200000, wrapped: vb(60), check: vb(32) }, V.s);
      await call('POST', '/live', { path: 'otra.md', name: 'Seva' }, V.s);
      await call('POST', '/shares', { path: 'tacho/otra.md', email: V.email, role: 'view' }, T.s);
      const cross = [await call('DELETE', '/account', { email: V.email }, I.s, from(nextIp())), await call('DELETE', '/account', { email: V.email, id: V.id, o: V.id }, T.s, from(nextIp())), await call('DELETE', '/account?o=' + V.id, { email: I.email.toUpperCase() + 'x' }, I.s, from(nextIp())), await call('DELETE', '/account', [V.email], V.s, from(nextIp())), await call('DELETE', '/account', { email: [V.email] }, V.s, from(nextIp()))];
      check('eliminar la cuenta: nadie borra la cuenta de otro, y sin escribir el correo propio no se borra', cross.every((r) => r.status === 400) && (await call('GET', '/account', undefined, V.s)).status === 200 && (await call('GET', '/account', undefined, I.s)).status === 200, cross.map((r) => [r.status, r.json && r.json.error]));
      const done = await call('DELETE', '/account', { email: V.email }, V.s, from(nextIp()));
      const db = S.db(); const count = (sql, ...a) => db.prepare(sql).get(...a).n; const leftovers = [];
      for (const t of ['notes', 'versions', 'trash', 'comments', 'tokens', 'sessions', 'vaults', 'paddle_subs']) if (count('SELECT COUNT(*) AS n FROM ' + t + ' WHERE user = ?', V.id)) leftovers.push(t);
      for (const t of ['shares', 'links', 'lives']) if (count('SELECT COUNT(*) AS n FROM ' + t + ' WHERE owner = ?', V.id)) leftovers.push(t);
      if (count('SELECT COUNT(*) AS n FROM users WHERE id = ? OR email = ?', V.id, V.email)) leftovers.push('users');
      if (count('SELECT COUNT(*) AS n FROM shares WHERE email = ?', V.email)) leftovers.push('compartido con ella');
      const others = count('SELECT COUNT(*) AS n FROM notes WHERE user = ?', T.id);
      db.close();
      check('eliminar la cuenta: en la base no queda nada de esa cuenta, y lo de las demás no se toca', done.status === 200 && leftovers.length === 0 && others >= 3 && (await call('GET', '/account', undefined, V.s)).status === 401 && (await call('GET', '/notes/' + enc('tacho/otra.md'), undefined, T.s)).json.text === 'sigue', [done.json, leftovers, others]);
    }

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
    // Denunciar una nota entra por la misma ruta, sin sesión y sin motivo, y gasta del mismo tope: no es una vía aparte para inundar el correo.
    const rpIp = nextIp(); const rp = []; for (let i = 0; i < 6; i++) rp.push((await call('POST', '/feedback', { text: '', report: { kind: 'link', note: 'pub/enlace-' + i, owner: '' } }, undefined, from(rpIp))).status);
    const rpThenFb = (await call('POST', '/feedback', { text: 'Y ahora un comentario.' }, undefined, from(rpIp))).status;
    const rpBad = [(await call('POST', '/feedback', { text: 'x'.repeat(4001), report: { kind: 'link', note: 'pub/a' } }, undefined, from(nextIp()))).status, (await call('POST', '/feedback', { text: '', report: 'pub/a' }, undefined, from(nextIp()))).status];
    check('las denuncias entran sin sesión, con el mismo tope por IP que los comentarios', rp.join() === '200,200,200,200,200,429' && rpThenFb === 429, [rp, rpThenFb]);
    check('una denuncia con el motivo demasiado largo, o que no dice qué nota es, se rechaza', rpBad.join() === '400,400', rpBad);
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

if (ONLY !== 'app' && ONLY !== 'live' && ONLY !== 'team') await serverSuite();

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
    check('pay.html: el correo se muestra como texto y un plan desconocido cae en el mensual', marked.kids === 0 && marked.email === 'a<b>b</b>@ejemplo.test' && marked.amount === 'USD 4' && weird.email === 'ana@ejemplo.test' && weird.amount === 'USD 4' && weird.shown.join() === 'buy', [marked, weird]);
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
if (ONLY !== 'server' && ONLY !== 'live' && ONLY !== 'team') await appSuite();

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
    check('a la cuenta con la nota compartida, que no es parte de la sesión, el aviso le llega sin el texto ni la lista de invitados', evB.filter((e) => e.type === 'saved').length === 3 && evB.every((e) => !('text' in e) && !('patch' in e) && e.type !== 'live') && !/Ben|img/.test(earB.text) && evB.some((e) => e.type === 'saved' && e.edited && e.edited.kind === 'guest' && e.edited.name === ''), evB);
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
if (ONLY !== 'server' && ONLY !== 'app' && ONLY !== 'team') await liveSuite();

// ---------- Equipos ----------
// Quién entra al espacio de un equipo y quién no, quién puede administrarlo, que invitar no sirva para mandar correo
// a mansalva ni para saber quién tiene cuenta, y que el cobro de un equipo no se pueda atribuir ni falsificar.
// Paddle y el correo son servidores falsos locales.
async function teamSuite() {
  console.log('Seguridad de los equipos');
  const TEAMP = 'pri_prueba_equipo'; const APIKEY = 'clave-api-de-prueba-9911-zzz';
  const paddleCalls = []; const mails = [];
  const collect = (into) => http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { let body = null; try { body = JSON.parse(raw); } catch (e) { body = raw; } into.push({ method: req.method, url: req.url, auth: req.headers.authorization, body }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
  const fakePaddle = collect(paddleCalls); const fakeMail = collect(mails);
  await new Promise((r) => fakePaddle.listen(0, '127.0.0.1', r)); await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));
  const S = await boot({ ADMIN_KEY: ADMIN, PADDLE_WEBHOOK_SECRET: PADDLE, PADDLE_PRICE_TEAM: TEAMP, PADDLE_API_KEY: APIKEY, PADDLE_API_URL: 'http://127.0.0.1:' + fakePaddle.address().port,
    MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port, TEAM_INVITES_DAY: '6', FREE_NOTES: '3', AUTH_PER_IP: '100' });
  secrets.push(APIKEY);
  const { call } = S;
  try {
    let clock = Date.now() - 900000;
    const hook = async (ev, o2) => { o2 = o2 || {}; const raw = JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', o2.secret || PADDLE).update(ts + ':' + raw).digest('hex'); const r = await fetch(S.base + '/paddle/webhook', { method: 'POST', headers: o2.unsigned ? {} : { 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const teamEv = (id, status, email, extra, at) => ({ event_type: 'subscription.updated', occurred_at: new Date(at || (clock += 1000)).toISOString(), data: Object.assign({ id, status, items: [{ price: { id: TEAMP }, quantity: 2 + (extra || 0) }] }, email ? { custom_data: { sharpmd_email: email } } : {}) });
    const acct = async (who) => (await call('GET', '/account', undefined, who.s)).json;
    const invite = (who, email) => call('POST', '/team/invite', { email }, who.s);
    const join = async (owner, who) => { await invite(owner, who.email); const inv = (await acct(who)).team.invites.find((i) => i.by === owner.email); return call('POST', '/team/accept', { id: inv.id }, who.s); };
    const mailsTo = (email) => mails.filter((m) => m.body && m.body.to === email && /invited you|te invitó/.test(m.body.subject));
    const stream = async (url, auth) => {
      const ctrl = new AbortController(); const st = { text: '', status: 0, done: false, stop: () => ctrl.abort() };
      const res = await fetch(S.base + url, { headers: { authorization: 'Bearer ' + auth }, signal: ctrl.signal }); st.status = res.status;
      if (res.ok) (async () => { const rd = res.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; st.text += d.decode(x.value); } } catch (e) { /* se cortó */ } st.done = true; })();
      return st;
    };

    const A = await signup(S, 'ana@ejemplo.test'); const B = await signup(S, 'beto@ejemplo.test'); const X = await signup(S, 'equis@ejemplo.test'); const P = await signup(S, 'pendiente@ejemplo.test');
    const E = await signup(S, 'ex@ejemplo.test'); const D = await signup(S, 'dora@ejemplo.test'); const M = await signup(S, 'miembro2@ejemplo.test');
    await makePro(S, X.email);

    // ---------- El cobro ----------
    console.log(' El cobro del equipo');
    const forged = await hook(teamEv('sub_t1', 'active', A.email, 2), { secret: 'otra-firma' });
    const bare = await hook(teamEv('sub_t1', 'active', A.email, 2), { unsigned: true });
    check('equipo: un aviso sin firma o con otra firma no crea un equipo', forged.status === 401 && bare.status === 401 && (await acct(A)).team.mine === null && (await acct(A)).plan === 'free', [forged.status, bare.status]);
    const made = await hook(teamEv('sub_t1', 'active', A.email, 2));
    const SPACE = (await acct(A)).team.mine.space;
    check('equipo: el aviso firmado lo crea, con los lugares que trae', made.status === 200 && made.json.seats === 4 && (await acct(A)).team.mine.role === 'admin', made.json);
    await hook(teamEv('sub_t1', 'active', X.email, 2));
    check('equipo: la suscripción no se puede atribuir después a otra cuenta', (await acct(X)).team.mine === null && (await acct(A)).team.mine.role === 'admin' && (await acct(A)).team.mine.seats === 4);
    // Una suscripción individual ya vista no se convierte en la de un equipo por traer después el precio del equipo.
    await hook({ event_type: 'subscription.created', occurred_at: new Date(clock += 1000).toISOString(), data: { id: 'sub_solo_x', status: 'active', custom_data: { sharpmd_email: X.email }, items: [{ price: { id: 'pri_otro', custom_data: { app: 'sharpmd' } }, quantity: 1 }] } });
    await hook(teamEv('sub_solo_x', 'active', X.email, 9));
    check('equipo: una suscripción individual no pasa a ser de equipo', (await acct(X)).team.mine === null && (await acct(X)).plan === 'pro');
    await hook(teamEv('sub_t2', 'active', D.email, 3));
    const SPACE2 = (await acct(D)).team.mine.space;

    // ---------- Quién entra al espacio del equipo ----------
    console.log(' El espacio del equipo');
    const TSECRET = 'REMOLACHA-DEL-EQUIPO-4471'; secrets.push(TSECRET);
    await join(A, B); await join(A, E); await invite(A, P.email); await join(D, M);
    const t = (p) => '/notes/' + enc(p) + '?o=' + SPACE;
    await call('PUT', t('secreta.md'), { text: 'uno ' + TSECRET }, A.s); await call('PUT', t('secreta.md'), { text: 'dos ' + TSECRET, rev: 1 }, B.s);
    const vid = (await call('GET', '/versions/' + enc('secreta.md') + '?o=' + SPACE, undefined, A.s)).json[0].id;
    const earE = await stream('/events?path=' + enc('secreta.md') + '&o=' + SPACE, E.s); await sleep(150);
    const gone = await call('POST', '/team/remove', { id: E.id }, A.s);
    await makePro(S, E.email); // paga por su lado: lo que pierde es el equipo, no el plan
    await call('PUT', t('secreta.md'), { text: 'tres ' + TSECRET, rev: 2 }, A.s); await sleep(250);
    check('equipo: a quien sacan se le corta la escucha y no recibe lo que se guarda después', gone.status === 200 && earE.done && !/"rev":3/.test(earE.text), earE.text.slice(-200));
    const leaks = (r) => JSON.stringify(r.json || '').includes(TSECRET);
    const outsiders = [['ajena', X], ['invitada sin aceptar', P], ['ex miembro', E], ['quien administra otro equipo', D], ['miembro de otro equipo', M]];
    const tries = [
      ['leer', (w) => call('GET', t('secreta.md'), undefined, w.s)], ['guardar', (w) => call('PUT', t('secreta.md'), { text: 'pisada' }, w.s)], ['crear', (w) => call('PUT', t('colada.md'), { text: 'x' }, w.s)],
      ['eliminar', (w) => call('DELETE', t('secreta.md'), undefined, w.s)], ['buscar', (w) => call('GET', '/search?q=' + enc(TSECRET) + '&o=' + SPACE, undefined, w.s)],
      ['historial', (w) => call('GET', '/versions/' + enc('secreta.md') + '?o=' + SPACE, undefined, w.s)], ['versión', (w) => call('GET', '/version/' + vid + '?o=' + SPACE, undefined, w.s)],
      ['mover', (w) => call('POST', '/rename', { from: 'secreta.md', to: 'robada.md', o: SPACE }, w.s)], ['escuchar', (w) => stream('/events?path=' + enc('secreta.md') + '&o=' + SPACE, w.s)],
    ];
    const holes = [];
    for (const [who, w] of outsiders) {
      for (const [what, fn] of tries) { const r = await fn(w); if (r.status !== 403 || leaks(r)) holes.push(who + ': ' + what + ' ' + r.status); if (r.stop) r.stop(); }
      const list = await call('GET', '/notes?o=' + SPACE, undefined, w.s); if (list.status !== 200 || list.json.length) holes.push(who + ': listar');
      const version = await call('GET', '/version/' + vid, undefined, w.s); if (version.status !== 404 || leaks(version)) holes.push(who + ': versión sin o');
    }
    check('equipo: quien no es miembro (ajena, invitada sin aceptar, ex miembro, de otro equipo) no lee, guarda, crea, elimina, busca, mueve ni escucha nada del espacio', holes.length === 0, holes);
    check('equipo: y la nota quedó como estaba', (await call('GET', t('secreta.md'), undefined, B.s)).json.text === 'tres ' + TSECRET && (await call('GET', t('colada.md'), undefined, A.s)).status === 404);
    const wild = []; for (const o of ['abc', '-1', '0', SPACE + 'x', SPACE2, A.id, '1e0', '%00', '']) { const r = await call('GET', '/notes/' + enc('secreta.md') + '?o=' + o, undefined, B.s); if (r.status === 200 || leaks(r)) wild.push(o + ' ' + r.status); }
    check('equipo: un miembro no llega a otro espacio ni a lo de otra cuenta cambiando el número de la dirección', wild.length === 0 && (await call('POST', '/rename', { from: 'secreta.md', to: 'x.md', o: [SPACE2] }, B.s)).status === 403 && (await call('POST', '/rename', { from: 'secreta.md', to: 'x.md', o: { id: SPACE } }, X.s)).status === 403, wild);
    // Lo personal de cada miembro no pasa al equipo.
    const PSECRET = 'ACELGA-PERSONAL-9902'; secrets.push(PSECRET);
    await call('PUT', '/notes/' + enc('mia.md'), { text: PSECRET }, B.s);
    const peek = []; for (const u of ['/notes/mia.md?o=' + B.id, '/notes/mia.md?o=' + SPACE, '/notes?o=' + B.id, '/search?q=' + PSECRET + '&o=' + B.id, '/search?q=' + PSECRET + '&o=' + SPACE, '/search?q=' + PSECRET, '/versions/mia.md?o=' + B.id]) { const r = await call('GET', u, undefined, A.s); if (leaks(r) || JSON.stringify(r.json || '').includes(PSECRET) || JSON.stringify(r.json || '').includes('mia.md')) peek.push(u + ' ' + r.status); }
    check('equipo: quien administra no lee nada personal de un miembro', peek.length === 0, peek);
    const view = JSON.stringify(await acct(B));
    check('equipo: lo que un miembro ve del equipo son los correos de los miembros: ni invitaciones pendientes, ni la suscripción, ni la cuenta interna', view.includes(A.email) && !view.includes(P.email) && !view.includes('sub_t1') && !view.includes('team:') && !view.includes('"pending"'), view.slice(0, 600));
    check('equipo: con la cuenta interna no se entra, ni se le comparte, ni se le cambia el plan', (await call('POST', '/auth/start', { email: 'team:abc' }, undefined, from(nextIp()))).status === 400 && (await call('POST', '/shares', { path: 'mia.md', email: 'team:abc', role: 'edit' }, X.s)).status === 400 && (await S.call('POST', '/admin/plan', { email: 'team:abc', plan: 'free' }, undefined, { 'x-admin-key': ADMIN })).status === 400);

    // ---------- Papeles e invitaciones ajenas ----------
    console.log(' Papeles e invitaciones');
    const pInv = (await acct(P)).team.invites[0].id;
    const steal = [(await call('POST', '/team/accept', { id: pInv }, X.s)).status, (await call('POST', '/team/accept', { id: pInv }, M.s)).status, (await call('POST', '/team/accept', { id: String(pInv) + ' OR 1=1' }, X.s)).status];
    await call('POST', '/team/decline', { id: pInv }, X.s); await call('DELETE', '/team/invites/' + pInv, undefined, D.s);
    check('equipo: nadie acepta, rechaza ni quita la invitación de otra persona o de otro equipo', steal.every((s) => s === 404) && (await acct(P)).team.invites.length === 1 && (await acct(X)).team.mine === null, steal);
    const roles = [];
    for (const [who, w] of [['miembro', B], ['de otro equipo', M]]) for (const r of [await invite(w, 'nuevo@ejemplo.test'), await call('POST', '/team/remove', { id: A.id }, w.s), await call('POST', '/team/seats', { seats: 9 }, w.s), await call('PUT', '/team', { name: 'tomado' }, w.s), await call('DELETE', '/team/invites/' + pInv, undefined, w.s)]) if (r.status !== 403) roles.push(who + ' ' + r.status);
    const cross = [(await call('POST', '/team/remove', { id: B.id }, D.s)).status, (await call('POST', '/team/remove', { id: A.id }, D.s)).status];
    check('equipo: un miembro no administra, y quien administra un equipo no toca a la gente de otro', roles.length === 0 && cross.every((s) => s === 404) && (await acct(B)).team.mine.space === SPACE && (await acct(A)).team.mine.name === '' && (await acct(A)).team.mine.seats === 4 && paddleCalls.length === 0, [roles, cross]);
    const twice = [(await call('POST', '/team/accept', { id: pInv }, P.s)).status, (await call('POST', '/team/accept', { id: pInv }, P.s)).status];
    check('equipo: una invitación sirve una sola vez', twice.join() === '200,404' && (await acct(A)).team.mine.members.length === 3, twice);
    // Nombre visible: cada cuenta cambia solo el suyo; viaja como texto a los miembros del mismo equipo, y a nadie más.
    const evilName = '<img src=x onerror=alert(1)>';
    const nameMine = await call('PUT', '/account', { name: evilName, id: A.id, user: A.id, email: A.email }, B.s);
    const seenByA = (await acct(A)).team.mine.members; const nameOut = await signup(S, 'afuera-nombre@ejemplo.test');
    check('nombre visible: nadie cambia el de otra cuenta, y el propio se guarda como texto, sin tocar', nameMine.status === 200 && nameMine.json.name === evilName && nameMine.json.id === B.id && (seenByA.find((x) => x.id === B.id) || {}).name === evilName && (seenByA.find((x) => x.id === A.id) || {}).name === A.email.split('@')[0] && (await acct(A)).name === A.email.split('@')[0], [nameMine.json, seenByA]);
    check('nombre visible: quien no es del equipo no lo recibe', !JSON.stringify(await acct(nameOut)).includes('onerror') && !JSON.stringify((await call('GET', '/shared', undefined, nameOut.s)).json).includes('onerror'));
    await call('PUT', '/account', { name: '' }, B.s);
    // Una cuenta que ya es miembro no sale de su equipo porque alguien pague una suscripción de equipo a su nombre.
    const pull = await hook(teamEv('sub_t9', 'active', B.email, 0));
    check('equipo: un pago a nombre de quien ya está en un equipo no lo saca de ahí', pull.json.ignored === 'in_team' && (await acct(B)).team.mine.space === SPACE && (await acct(B)).team.mine.role === 'editor', pull.json);
    // Avisos desordenados: uno viejo no revive un equipo dado de baja.
    const late = clock + 50000;
    await hook(teamEv('sub_t2', 'canceled', null, 3, late)); const old = await hook(teamEv('sub_t2', 'active', null, 3, late - 20000));
    check('equipo: un aviso anterior al último no revive un equipo dado de baja', old.json.ignored === 'stale' && (await acct(D)).team.mine.active === false && (await acct(M)).plan === 'free', old.json);

    // ---------- Lugares ----------
    console.log(' Lugares');
    // Cuatro lugares y tres ocupados (Ana, Beto y Pendiente): queda uno. Cinco invitaciones a la vez por ese lugar.
    const racers = await Promise.all(Array.from({ length: 5 }, (_, i) => invite(A, 'carrera' + i + '@ejemplo.test')));
    const a1 = await acct(A);
    check('equipo: varias invitaciones a la vez por el último lugar: entra una sola', racers.filter((r) => r.status === 200).length === 1 && racers.filter((r) => r.status === 409 && r.json.error === 'team_full').length === 4 && a1.team.mine.used === 4 && a1.team.mine.used <= a1.team.mine.seats, racers.map((r) => r.status));
    paddleCalls.length = 0;
    const lowered = await call('POST', '/team/seats', { seats: 3 }, A.s);
    const odd = []; for (const v of [3.5, '5', -1, 1, 1e9, null, [5], { n: 5 }, true]) { const r = await call('POST', '/team/seats', { seats: v }, A.s); if (r.status !== 400) odd.push(JSON.stringify(v) + ' ' + r.status); }
    check('equipo: los lugares no bajan de los ocupados ni toman valores raros, y Paddle no recibe nada', lowered.status === 409 && lowered.json.error === 'seats_in_use' && odd.length === 0 && paddleCalls.length === 0, [lowered.json, odd]);
    const raised = await call('POST', '/team/seats', { seats: 8 }, A.s);
    const pc = paddleCalls[0] || {};
    check('equipo: el cambio de lugares va a la suscripción del equipo, con la clave y solo con el precio configurado', raised.status === 200 && paddleCalls.length === 1 && pc.url === '/subscriptions/sub_t1' && pc.auth === 'Bearer ' + APIKEY && JSON.stringify(pc.body.items) === JSON.stringify([{ price_id: TEAMP, quantity: 8 }]), pc);
    check('equipo: la clave de la API de Paddle no viaja en ninguna respuesta', !JSON.stringify([raised.json, await acct(A), (await call('GET', '/team', undefined, A.s)).json]).includes(APIKEY));

    // ---------- Invitar no es mandar correo a mansalva ----------
    console.log(' Topes de invitaciones');
    // Hasta acá el equipo de Ana mandó cuatro invitaciones (Beto, Ex, Pendiente y la que ganó la carrera). El tope de la prueba es seis por día.
    const before = mails.length;
    const burst = []; for (let i = 0; i < 6; i++) burst.push(await invite(A, 'rafaga' + i + '@ejemplo.test'));
    const okN = burst.filter((r) => r.status === 200).length; const stopped = burst.find((r) => r.status === 429);
    check('equipo: pasado el tope diario del equipo no sale ni un correo más, y se dice cuánto falta', okN === 2 && !!stopped && stopped.json.error === 'invite_day' && stopped.json.retry_after > 0 && mails.length - before === okN, [okN, stopped && stopped.json]);
    const pend = (await acct(A)).team.mine.pending;
    await call('DELETE', '/team/invites/' + pend[pend.length - 1].id, undefined, A.s);
    check('equipo: quitar una invitación no devuelve el cupo', (await invite(A, 'otra-mas@ejemplo.test')).status === 429);
    // Por destinatario: tres por día entre todos los equipos. Otro equipo, con cupo propio, tampoco puede insistirle.
    const F = await signup(S, 'fede@ejemplo.test'); await hook(teamEv('sub_t3', 'active', F.email, 8));
    const G = await signup(S, 'gabi@ejemplo.test'); await hook(teamEv('sub_t4', 'active', G.email, 8));
    const hammer = [(await invite(F, 'victima@ejemplo.test')).status, (await invite(F, 'victima@ejemplo.test')).status, (await invite(G, 'victima@ejemplo.test')).status, (await invite(G, 'victima@ejemplo.test')).status, (await invite(F, 'victima@ejemplo.test')).status];
    check('equipo: una misma dirección recibe a lo sumo tres invitaciones por día, vengan del equipo que vengan', hammer.join() === '200,200,200,429,429' && mailsTo('victima@ejemplo.test').length === 3, hammer);
    // Lo que responde y lo que manda no dicen si la dirección tiene cuenta, ni si está en otro equipo.
    const r1 = await invite(F, X.email); const r2 = await invite(F, 'nadie-con-ese-correo@ejemplo.test'); const r3 = await invite(F, B.email);
    const shape = (r) => r.status + JSON.stringify(Object.keys(r.json).sort()) + JSON.stringify(Object.keys(r.json.team.mine).sort());
    const m1 = mailsTo(X.email).pop(); const m2 = mailsTo('nadie-con-ese-correo@ejemplo.test').pop(); const m3 = mailsTo(B.email).pop();
    check('equipo: invitar responde y manda lo mismo a una cuenta, a una dirección sin cuenta y a quien ya está en otro equipo', shape(r1) === shape(r2) && shape(r2) === shape(r3) && !!m1 && !!m2 && !!m3 && m1.body.text === m2.body.text && m2.body.text === m3.body.text && m1.body.html === m2.body.html && m1.body.subject === m3.body.subject, [shape(r1), shape(r2), shape(r3)]);
    const stuck = await call('POST', '/team/accept', { id: (await acct(B)).team.invites.find((i) => i.by === F.email).id }, B.s);
    check('equipo: quien ya está en un equipo no entra a otro, y eso lo sabe solo ella', stuck.status === 409 && stuck.json.error === 'in_team' && !(await acct(F)).team.mine.members.some((m) => m.email === B.email), stuck.json);
    // El nombre del equipo lo escribe una persona: no parte el correo ni mete HTML.
    const named = await call('PUT', '/team', { name: 'Equipo\r\nBcc: robo@ejemplo.test <img src=x onerror=alert(1)>' }, G.s);
    await invite(G, 'con-nombre@ejemplo.test'); const mn = mailsTo('con-nombre@ejemplo.test').pop();
    check('equipo: el nombre del equipo no parte el correo ni mete HTML', named.status === 200 && !/[\r\n]/.test(named.json.team.mine.name) && named.json.team.mine.name.length <= 40 && !!mn && !/[\r\n]/.test(mn.body.subject) && !/<img/i.test(mn.body.html) && !/Bcc:/i.test(mn.body.subject), [named.json.team.mine.name, mn && mn.body.subject]);
    const badTo = []; for (const v of ['a@b.test\r\nBcc: x@y.test', 'a@b.test, c@d.test', '<a@b.test>', 'team:abc', '', null, ['a@b.test'], { email: 'a@b.test' }]) { const r = await invite(G, v); if (r.status !== 400) badTo.push(JSON.stringify(v) + ' ' + r.status); }
    check('equipo: una dirección mal formada no se invita', badTo.length === 0, badTo);

    // ---------- La IA de un miembro ----------
    console.log(' MCP');
    const tokB = (await call('POST', '/tokens', { name: 'IA' }, B.s)).json.token; const tokScoped = (await call('POST', '/tokens', { name: 'IA', folder: 'propias' }, B.s)).json.token; const tokE = (await call('POST', '/tokens', { name: 'IA', folder: '@team' }, E.s)).json.token; const tokX = (await call('POST', '/tokens', { name: 'IA' }, X.s)).json.token;
    secrets.push(tokB, tokScoped, tokE, tokX);
    const reads = [await tool(S, tokB, 'read_note', { path: '@team/secreta.md' }), await tool(S, tokScoped, 'read_note', { path: '@team/secreta.md' }), await tool(S, tokE, 'read_note', { path: '@team/secreta.md' }), await tool(S, tokX, 'read_note', { path: '@team/secreta.md' })];
    const sees = (r) => JSON.stringify(r.v).includes(TSECRET);
    check('equipo: por MCP lee el equipo el token de un miembro; no el limitado a una carpeta propia, ni el de un ex miembro, ni el de una cuenta ajena', sees(reads[0]) && !sees(reads[1]) && !sees(reads[2]) && !sees(reads[3]), reads.map((r) => JSON.stringify(r).slice(0, 80)));
    const sweep = []; for (const tok of [tokScoped, tokE, tokX]) for (const [n, a] of [['list_notes', {}], ['list_folders', {}], ['search_notes', { query: TSECRET }], ['read_note', { path: '@team/../secreta.md' }], ['append_note', { path: '@team/secreta.md', text: 'colado' }]]) { const r = await tool(S, tok, n, a); if (sees(r) || (n !== 'append_note' && n !== 'read_note' && /@team\/secreta/.test(JSON.stringify(r.v)))) sweep.push(n); }
    check('equipo: esos tokens tampoco lo listan, lo buscan ni escriben en él', sweep.length === 0 && (await call('GET', t('secreta.md'), undefined, A.s)).json.text === 'tres ' + TSECRET, sweep);

    {
    const tokShare = (await call('POST', '/tokens', { name: 'IA', share: true }, B.s)).json.token; const tokShareTeam = (await call('POST', '/tokens', { name: 'IA', folder: '@team', share: true }, B.s)).json.token; secrets.push(tokShare, tokShareTeam);
    const rowsOut = () => { const d = S.db(); const r = [d.prepare('SELECT COUNT(*) AS n FROM shares').get().n, d.prepare('SELECT COUNT(*) AS n FROM links').get().n]; d.close(); return r.join(); };
    const out0 = rowsOut(); const teamOut = [];
    for (const tok of [tokShare, tokShareTeam]) for (const [n, a] of [['share_note', { path: '@team/secreta.md', email: X.email }], ['share_note', { path: '@team', email: X.email }], ['create_public_link', { path: '@team/secreta.md' }], ['unshare_note', { path: '@team/secreta.md', email: X.email }], ['revoke_public_link', { path: '@team/secreta.md' }], ['list_shares', { path: '@team/secreta.md' }]]) { const r = await tool(S, tok, n, a); if (!r.err || sees(r)) teamOut.push(n); }
    check('equipo: con el permiso de compartir, la IA igual no comparte ni enlaza las notas del equipo', teamOut.length === 0 && rowsOut() === out0 && (await call('GET', '/shared', undefined, X.s)).json.length === 0, [teamOut, out0, rowsOut()]);
    }

    // ---------- La papelera del equipo y eliminar la cuenta ----------
    console.log(' Papelera del equipo y eliminar la cuenta');
    {
      const BIN = 'NABO-DEL-EQUIPO-EN-LA-PAPELERA-3318'; secrets.push(BIN);
      await call('PUT', t('tacho.md'), { text: BIN }, A.s);
      const delByMember = await call('DELETE', t('tacho.md'), undefined, B.s);
      const tb = (await call('GET', '/trash?o=' + SPACE, undefined, A.s)).json;
      const spill = (r) => JSON.stringify(r.json || '').includes(BIN) || JSON.stringify(r.json || '').includes('tacho.md');
      const out = [];
      for (const [who, w] of [['ajena', X], ['ex miembro', E], ['quien administra otro equipo', D], ['miembro de otro equipo', M]]) {
        const tries = [['listar', await call('GET', '/trash?o=' + SPACE, undefined, w.s), 403], ['restaurar', await call('POST', '/trash/' + tb[0].id + '/restore?o=' + SPACE, {}, w.s), 403], ['borrar', await call('DELETE', '/trash/' + tb[0].id + '?o=' + SPACE, undefined, w.s), 403],
          ['vaciar', await call('DELETE', '/trash?o=' + SPACE, undefined, w.s), 403], ['restaurar sin o', await call('POST', '/trash/' + tb[0].id + '/restore', {}, w.s), 404], ['borrar sin o', await call('DELETE', '/trash/' + tb[0].id, undefined, w.s), 404], ['listar la propia', await call('GET', '/trash', undefined, w.s), 200]];
        for (const [what, r, want] of tries) if (r.status !== want || spill(r)) out.push(who + ': ' + what + ' ' + r.status);
      }
      check('equipo: quien no es miembro no ve, restaura, borra ni vacía la papelera del equipo', delByMember.status === 200 && tb.length === 1 && out.length === 0 && (await call('GET', '/trash?o=' + SPACE, undefined, B.s)).json.length === 1, out);
      check('equipo: la papelera del equipo no se mezcla con la personal de sus miembros', (await call('GET', '/trash', undefined, A.s)).json.length === 0 && (await call('GET', '/trash', undefined, B.s)).json.length === 0 && (await call('POST', '/trash/' + tb[0].id + '/restore', {}, B.s)).status === 404);
      const restored = await call('POST', '/trash/' + tb[0].id + '/restore?o=' + SPACE, {}, B.s);
      check('equipo: cualquier miembro restaura lo que otro eliminó', restored.status === 200 && (await call('GET', t('tacho.md'), undefined, A.s)).json.text === BIN, restored.json);
      // Eliminar la cuenta con un equipo de por medio.
      const adminTeam = (email, seats) => S.call('POST', '/admin/team', { email, seats }, undefined, { 'x-admin-key': ADMIN });
      const bye = (w) => call('DELETE', '/account', { email: w.email }, w.s, from(nextIp()));
      const N1 = await signup(S, 'jefa@ejemplo.test'); const N2 = await signup(S, 'integrante@ejemplo.test'); const N3 = await signup(S, 'cobrada@ejemplo.test');
      await adminTeam(N1.email, 3); await join(N1, N2);
      const sp = (await acct(N1)).team.mine.space; const tn = (p) => '/notes/' + enc(p) + '?o=' + sp;
      await call('PUT', tn('del-equipo.md'), { text: 'escrita por quien se va' }, N2.s);
      await call('PUT', '/notes/' + enc('personal.md'), { text: 'personal' }, N2.s);
      const withPeople = await bye(N1);
      check('eliminar la cuenta: quien administra un equipo con más gente no se borra', withPeople.status === 409 && withPeople.json.error === 'team_has_members' && (await acct(N1)).team.mine.members.length === 2, withPeople.json);
      const memberGone = await bye(N2);
      const after = await acct(N1);
      check('eliminar la cuenta: un miembro sale del equipo, y las notas del equipo quedan', memberGone.status === 200 && after.team.mine.members.length === 1 && (await call('GET', tn('del-equipo.md'), undefined, N1.s)).json.text === 'escrita por quien se va' && (await call('GET', tn('del-equipo.md'), undefined, N2.s)).status === 401, [memberGone.json, after.team.mine]);
      await hook(teamEv('sub_del1', 'active', N3.email, 0));
      const billed = await bye(N3);
      check('eliminar la cuenta: con el cobro del equipo activo no se borra', billed.status === 409 && billed.json.error === 'team_billing_active' && (await acct(N3)).team.mine.role === 'admin', billed.json);
      await hook(teamEv('sub_del1', 'canceled', null, 0));
      const sp3 = (await acct(N3)).team.mine.space;
      const ownerGone = [await bye(N3), await bye(N1)];
      const db = S.db(); const n = (sql, ...a) => db.prepare(sql).get(...a).n;
      const rest = [n('SELECT COUNT(*) AS n FROM teams WHERE space IN (?, ?)', sp, sp3), n('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?, ?, ?, ?)', sp, sp3, N1.id, N2.id, N3.id), n('SELECT COUNT(*) AS n FROM notes WHERE user IN (?, ?, ?, ?, ?)', sp, sp3, N1.id, N2.id, N3.id), n('SELECT COUNT(*) AS n FROM team_members WHERE user IN (?, ?, ?)', N1.id, N2.id, N3.id)];
      const untouched = n('SELECT COUNT(*) AS n FROM notes WHERE user = ?', SPACE);
      db.close();
      check('eliminar la cuenta: quien queda sola en su equipo se borra con el equipo y su espacio, sin tocar otros equipos', ownerGone.every((r) => r.status === 200) && rest.join() === '0,0,0,0' && untouched > 0, [ownerGone.map((r) => r.json), rest, untouched]);
    }

    // ---------- El espacio del equipo protegido con contraseña ----------
    console.log(' El espacio protegido');
    {
      const { hkdfSync, randomBytes, createCipheriv } = await import('crypto');
      const hk = (K, info) => Buffer.from(hkdfSync('sha256', K, Buffer.alloc(0), info, 32));
      const b = (n) => randomBytes(n).toString('base64');
      // Una llave de datos y lo que el navegador mandaría: sal, vueltas, llave envuelta (acá, bytes al azar) y comprobación.
      const mk = () => { const K = randomBytes(32); return { K, key: hk(K, 'sharpmd vault enc v1'), body: { salt: b(16), iters: 600000, wrapped: b(60), check: hk(K, 'sharpmd vault check v1').toString('base64') } }; };
      const sealFor = (key, aad, text) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad)); const body = Buffer.concat([c.update(text, 'utf8'), c.final()]); return 'vault1:' + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64'); };
      const G = await signup(S, 'gala@ejemplo.test'); const H = await signup(S, 'hugo@ejemplo.test'); const I2 = await signup(S, 'ines@ejemplo.test'); const J = await signup(S, 'juan@ejemplo.test');
      await call('POST', '/admin/team', { email: G.email, seats: 4 }, undefined, { 'x-admin-key': ADMIN });
      await join(G, H); await join(G, I2);
      const SP3 = (await acct(G)).team.mine.space; const t3 = (p) => '/notes/' + enc(p) + '?o=' + SP3; const aad3 = (p) => '~' + SP3 + '/' + p;
      const VSECRET = 'ALCAUCIL-PROTEGIDO-7781'; secrets.push(VSECRET);
      await call('PUT', t3('caja.md'), { text: 'antes ' + VSECRET }, G.s);
      const k1 = mk(); secrets.push(k1.K.toString('base64'));
      const tv = async (who) => (await call('GET', '/team/vault', undefined, who.s));
      // Lo que solo hace quien administra, pedido por un miembro, por alguien de afuera, por quien administra otro equipo y sin sesión.
      const adminOnly = (w) => [
        ['proteger', () => call('POST', '/team/vault', k1.body, w)], ['cambiar la contraseña', () => call('PUT', '/team/vault', { salt: b(16), iters: 600000, wrapped: b(60) }, w)],
        ['empezar a quitar', () => call('POST', '/team/vault/open', {}, w)], ['quitar', () => call('DELETE', '/team/vault', undefined, w)], ['eliminar', () => call('POST', '/team/vault/destroy', { name: G.email }, w)],
        ['rotar', () => call('POST', '/team/vault/rotate', mk().body, w)], ['terminar de rotar', () => call('POST', '/team/vault/rotate/done', {}, w)], ['permitir la IA', () => call('PUT', '/team/vault/ai', { members: true }, w)],
        ['descartar el aviso', () => call('DELETE', '/team/vault/gone', undefined, w)],
      ];
      const pre = []; for (const [what, fn] of adminOnly(H.s)) { const r = await fn(); if (r.status !== 403 || r.json.error !== 'not_admin') pre.push(what + ' ' + r.status); }
      check('espacio protegido: un miembro no lo protege ni toca nada de la protección antes de que exista', pre.length === 0 && (await tv(G)).json.vault === null, pre);
      const made = await call('POST', '/team/vault', k1.body, G.s);
      await call('PUT', t3('caja.md'), { text: sealFor(k1.key, aad3('caja.md'), 'adentro ' + VSECRET), rev: 1 }, G.s);
      const state = async () => { const v = (await tv(G)).json.vault; return v ? [v.state, v.wrapped, v.check, v.ai_members, v.gone].join('|') : 'null'; };
      const s0 = await state();
      const holes = [];
      for (const [who, w, code] of [['miembro', H.s, 403], ['ajena', J.s, 404], ['sin sesión', undefined, 401], ['token de MCP', null, 401]]) {
        const auth = w === null ? (await call('POST', '/tokens', { name: 'ia' }, G.s)).json.token : w;
        for (const [what, fn] of adminOnly(auth)) { const r = await fn(); if (r.status !== code) holes.push(who + ': ' + what + ' ' + r.status); }
      }
      check('espacio protegido: proteger, cambiar la contraseña, quitar la protección, eliminar, rotar y decidir sobre la IA son de quien administra, con su sesión', made.status === 200 && holes.length === 0 && (await state()) === s0 && (await call('GET', t3('caja.md'), undefined, G.s)).json.text.startsWith('vault1:'), holes);
      // Quien administra OTRO equipo trabaja sobre el suyo: al de Gala no lo toca.
      await call('PUT', '/team/vault', { salt: b(16), iters: 600000, wrapped: b(60) }, D.s); await call('POST', '/team/vault/destroy', { name: G.email }, D.s); await call('POST', '/team/vault/open', {}, A.s);
      check('espacio protegido: quien administra otro equipo no llega a este', (await state()) === s0 && (await call('GET', t3('caja.md'), undefined, G.s)).status === 200);
      // Por las rutas de las carpetas propias tampoco: la protección del equipo no es de ninguna persona.
      const vid3 = made.json.vault.id; const side = [];
      for (const w of [G, H, J]) for (const [m, u, body] of [['PUT', '/vaults/' + vid3, { salt: b(16), iters: 600000, wrapped: b(60) }], ['DELETE', '/vaults/' + vid3], ['POST', '/vaults/' + vid3 + '/open', {}], ['POST', '/vaults/' + vid3 + '/destroy', { folder: '' }], ['POST', '/vaults/' + vid3 + '/unlock', { key: k1.K.toString('base64'), minutes: 0 }], ['POST', '/vaults/' + vid3 + '/lock', {}]]) { const r = await call(m, u, body, w.s); if (r.status !== 404) side.push(w.email + ' ' + m + ' ' + u + ' ' + r.status); }
      check('espacio protegido: nadie la cambia por las rutas de las carpetas propias, ni quien administra', side.length === 0 && (await state()) === s0 && (await call('GET', '/vaults', undefined, G.s)).json.length === 0, side);
      // La clave de respaldo es la llave escrita para una persona: no hay ruta que la entregue, y el servidor no la tiene.
      const fish = []; for (const u of ['/team/vault/backup', '/team/vault/key', '/team/vault/recover', '/team/vault/rotate', '/team/vault/next']) { const r = await call('GET', u, undefined, H.s); if (r.status === 200) fish.push(u); }
      const seen = JSON.stringify([(await tv(H)).json, await acct(H), (await call('GET', '/team', undefined, H.s)).json]);
      check('espacio protegido: un miembro no tiene de dónde leer la clave de respaldo, ni usa la suya para poner otra contraseña', fish.length === 0 && !seen.includes(k1.K.toString('base64')) && !seen.includes('"gone"') && !seen.includes('"next"') && (await call('PUT', '/team/vault', { salt: b(16), iters: 600000, wrapped: b(60) }, H.s)).status === 403);
      const out = []; for (const w of [J, X, D, M]) { const r = await tv(w); if (JSON.stringify(r.json || '').includes(k1.body.wrapped) || (r.status === 200 && r.json.vault && r.json.vault.id === vid3)) out.push(w.email); }
      check('espacio protegido: quien no es miembro no recibe la llave envuelta', out.length === 0, out);
      // Texto en claro en un espacio protegido, y cifrado en uno sin proteger.
      const plainIn = [await call('PUT', t3('caja.md'), { text: 'en claro' }, H.s), await call('PUT', t3('nueva.md'), { text: 'en claro' }, G.s), await call('POST', '/rename', { from: 'caja.md', to: 'otra.md', o: SP3 }, H.s), await call('POST', '/rename', { from: 'caja.md', to: 'otra.md', o: SP3, text: 'en claro' }, H.s)];
      const junk = [await call('PUT', t3('caja.md'), { text: 'vault1:no-es-base64!' }, H.s), await call('PUT', t3('caja.md'), { text: 'vault1:' }, H.s)];
      const sealedOut = [await call('PUT', t('secreta.md'), { text: sealFor(k1.key, '~' + SPACE + '/secreta.md', 'x') }, B.s), await call('PUT', '/notes/' + enc('propia.md'), { text: sealFor(k1.key, 'propia.md', 'x') }, H.s)];
      check('espacio protegido: no entra texto en claro, ni cifrado en un espacio o una carpeta sin proteger', plainIn.every((r) => r.status === 409 && r.json.error === 'vault') && junk.every((r) => r.status === 400) && sealedOut.every((r) => r.status === 409 && r.json.error === 'vault_text') && (await call('GET', t3('nueva.md'), undefined, G.s)).status === 404, [plainIn.map((r) => r.status), junk.map((r) => r.status), sealedOut.map((r) => r.json)]);
      check('espacio protegido: la búsqueda del servidor y el MCP bloqueado no devuelven nada de adentro', (await call('GET', '/search?q=' + enc(VSECRET) + '&o=' + SP3, undefined, H.s)).json.length === 0 && (await call('GET', '/search?q=ALCAUCIL&o=' + SP3, undefined, G.s)).json.length === 0);
      // Desbloquear para la IA: sin permiso de quien administra un miembro no puede, ni con la llave correcta.
      const hTok = (await call('POST', '/tokens', { name: 'ia' }, H.s)).json.token; const gTok = (await call('POST', '/tokens', { name: 'ia' }, G.s)).json.token; secrets.push(hTok, gTok);
      const key64 = k1.K.toString('base64');
      const noAi = await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, H.s);
      const outAi = [await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, J.s), await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, D.s), await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, hTok)];
      const rdH = await tool(S, hTok, 'read_note', { path: '@team/caja.md' }); const wrH = await tool(S, hTok, 'write_note', { path: '@team/caja.md', text: 'pisada desde la IA' });
      check('espacio protegido: desbloqueo para la IA sin permiso: un miembro no puede aunque tenga la llave, y nadie de afuera', noAi.status === 403 && noAi.json.error === 'ai_not_allowed' && outAi.map((r) => r.status).join() === '404,404,401' && rdH.err && wrH.err && !JSON.stringify([rdH, wrH]).includes(VSECRET) && (await call('GET', t3('caja.md'), undefined, G.s)).json.rev === 2, [noAi.json, outAi.map((r) => [r.status, r.json])]);
      await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, G.s);
      const rdG = await tool(S, gTok, 'read_note', { path: '@team/caja.md' }); const rdH2 = await tool(S, hTok, 'read_note', { path: '@team/caja.md' });
      check('espacio protegido: lo que desbloquea quien administra es para su IA, no para la de los demás', !rdG.err && String(rdG.v).includes(VSECRET) && rdH2.err && (await tv(H)).json.vault.ai === null);
      await call('PUT', '/team/vault/ai', { members: true }, G.s); await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, I2.s);
      const iTok = (await call('POST', '/tokens', { name: 'ia' }, I2.s)).json.token; secrets.push(iTok);
      const rdI = await tool(S, iTok, 'read_note', { path: '@team/caja.md' });
      // Diez llaves equivocadas por hora y por cuenta.
      let guess = null; for (let i = 0; i < 11; i++) guess = await call('POST', '/team/vault/unlock', { key: b(32), minutes: 0 }, H.s);
      check('espacio protegido: adivinar la llave tiene tope', guess.status === 429 && (await tool(S, hTok, 'read_note', { path: '@team/caja.md' })).err, [guess.status, guess.json]);
      // Sale una persona que tenía la llave abierta para su IA.
      const drop = await call('POST', '/team/remove', { id: I2.id }, G.s);
      await makePro(S, I2.email);
      const iTok2 = (await call('POST', '/tokens', { name: 'ia2' }, I2.s)).json.token;
      const after = [await tv(I2), await call('GET', t3('caja.md'), undefined, I2.s), await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, I2.s), await call('PUT', t3('caja.md'), { text: sealFor(k1.key, aad3('caja.md'), 'del ex miembro') }, I2.s)];
      const rdI2 = await tool(S, iTok, 'read_note', { path: '@team/caja.md' }); const rdI3 = await tool(S, iTok2, 'read_note', { path: '@team/caja.md' });
      check('espacio protegido: al salir un miembro se cierra lo que tenía abierto para su IA, y con su llave ya no pide ni guarda nada', !rdI.err && drop.status === 200 && drop.json.team.mine.vault.gone > 0 && after.map((r) => r.status).join() === '404,403,404,403' && rdI2.err && rdI3.err && !JSON.stringify([rdI2, rdI3, after.map((r) => r.json)]).includes(VSECRET), [after.map((r) => r.status), rdI2.v, rdI3.v]);
      // Rotar la llave: el ex miembro se llevó la anterior. Con ella no se abre nada de lo que queda, ni vale como llave del espacio.
      const k2 = mk(); secrets.push(k2.K.toString('base64'));
      await call('POST', '/team/vault/rotate', k2.body, G.s);
      const midH = [await call('PUT', t3('caja.md'), { text: sealFor(k1.key, aad3('caja.md'), 'con la vieja'), rev: 2 }, H.s), await call('POST', '/rename', { from: 'caja.md', to: 'x.md', o: SP3, text: sealFor(k1.key, aad3('x.md'), 'x') }, H.s), await call('POST', '/team/vault/rotate/done', {}, H.s)];
      const hView = (await tv(H)).json.vault;
      await call('PUT', t3('caja.md'), { text: sealFor(k2.key, aad3('caja.md'), 'rotada ' + VSECRET), rev: 2 }, G.s);
      const fin = await call('POST', '/team/vault/rotate/done', {}, G.s);
      check('espacio protegido: mientras se rota la llave un miembro no guarda con la anterior, no ve la nueva y no puede dar la rotación por terminada', midH.map((r) => r.status).join() === '423,423,403' && hView.state === 'rotating' && !('next' in hView) && fin.status === 200 && fin.json.vault.check === k2.body.check, [midH.map((r) => r.json), hView]);
      const cur = (await call('GET', t3('caja.md'), undefined, G.s)).json.text;
      const { createDecipheriv } = await import('crypto');
      const opens = (key) => { try { const raw = Buffer.from(cur.slice(7), 'base64'); const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(Buffer.from(aad3('caja.md'))); d.setAuthTag(raw.subarray(raw.length - 16)); return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8'); } catch (e) { return null; } };
      const stale = [await call('POST', '/team/vault/unlock', { key: key64, minutes: 0 }, G.s), await tv(I2), await call('GET', t3('caja.md'), undefined, I2.s), await call('GET', '/versions/' + enc('caja.md') + '?o=' + SP3, undefined, I2.s), await call('GET', '/trash?o=' + SP3, undefined, I2.s)];
      check('espacio protegido: ex miembro tras rotar la llave: su llave ya no abre lo que hay, no vale para la IA, y no llega al espacio', opens(k1.key) === null && opens(k2.key) === 'rotada ' + VSECRET && stale.map((r) => r.status).join() === '403,404,403,403,403' && stale[0].json.error === 'bad_key' && (await call('GET', '/versions/' + enc('caja.md') + '?o=' + SP3, undefined, G.s)).json.length === 0, stale.map((r) => [r.status, r.json]));
      // Los cambios sobre la protección tienen tope por equipo.
      let burst = null; for (let i = 0; i < 45 && (!burst || burst.status !== 429); i++) burst = await call('PUT', '/team/vault/ai', { members: i % 2 === 0 }, G.s);
      check('espacio protegido: los cambios sobre la protección tienen tope por hora', burst.status === 429 && burst.json.error === 'too_many' && burst.json.retry_after > 0, [burst.status, burst.json]);
      const disk = S.db(); const rowsOf = disk.prepare('SELECT text FROM notes WHERE user = ?').all(SP3).map((r) => String(r.text)).join('\n'); const vrow = disk.prepare('SELECT * FROM vaults WHERE user = ?').get(SP3); disk.close();
      check('espacio protegido: en la base quedan la sal, las vueltas, la llave envuelta y la comprobación, y ninguna llave ni texto', !rowsOf.includes(VSECRET) && vrow.folder === '' && vrow.wrapped === k2.body.wrapped && vrow.verify === k2.body.check && vrow.next === null && !JSON.stringify(vrow).includes(k2.K.toString('base64')) && !JSON.stringify(vrow).includes(key64), Object.keys(vrow));
    }

    // ---------- Papeles, políticas, registro de actividad y tokens del equipo ----------
    console.log(' Papeles, políticas, registro y tokens del equipo');
    {
      const RSECRET = 'ZANAHORIA-DEL-ESPACIO-CON-PAPELES-7719'; secrets.push(RSECRET);
      const N = await signup(S, 'nora@ejemplo.test'); const Ed = await signup(S, 'edi@ejemplo.test'); const Rd = await signup(S, 'lector@ejemplo.test'); const Ad = await signup(S, 'admin2@ejemplo.test'); const Ex = await signup(S, 'exmiembro@ejemplo.test');
      await hook(teamEv('sub_roles', 'active', N.email, 4));
      const SP = (await acct(N)).team.mine.space; const o = '?o=' + SP; const n = (p) => '/notes/' + enc(p) + o;
      const joinAs = async (who, role) => { await call('POST', '/team/invite', { email: who.email, role }, N.s); return call('POST', '/team/accept', { id: (await acct(who)).team.invites[0].id }, who.s); };
      await joinAs(Ed, 'editor'); await joinAs(Rd, 'reader'); await joinAs(Ad, 'admin'); await joinAs(Ex, 'editor');
      await call('PUT', n('secreta.md'), { text: 'uno ' + RSECRET }, N.s); await call('PUT', n('otra.md'), { text: 'dos' }, N.s);
      await call('PUT', n('borrada.md'), { text: 'x' }, N.s); await call('DELETE', n('borrada.md'), undefined, N.s);
      const bin = (await call('GET', '/trash' + o, undefined, N.s)).json[0].id;
      const intact = async () => (await call('GET', n('secreta.md'), undefined, N.s)).json.text === 'uno ' + RSECRET && (await call('GET', '/notes' + o, undefined, N.s)).json.length === 2 && (await call('GET', '/trash' + o, undefined, N.s)).json.length === 1;

      // Quien solo lee, por cada vía que escribe.
      const tokR = (await call('POST', '/tokens', { name: 'IA', share: true }, Rd.s)).json.token; secrets.push(tokR);
      await call('PUT', '/team/policies', { share: true, links: true }, N.s);
      const http1 = [['PUT', n('secreta.md'), { text: 'pisada' }], ['PUT', n('secreta.md'), { text: 'pisada', rev: 1 }], ['PUT', n('nueva.md'), { text: 'x' }], ['DELETE', n('secreta.md')], ['DELETE', n('secreta.md') + '&forever=1'], ['POST', '/rename', { from: 'secreta.md', to: 'robada.md', o: SP }],
        ['POST', '/rename', { from: 'secreta.md', to: 'robada.md', o: String(SP) }], ['POST', '/trash/' + bin + '/restore' + o, {}], ['DELETE', '/trash/' + bin + o], ['DELETE', '/trash' + o], ['POST', '/shares', { path: 'secreta.md', email: X.email, role: 'edit', o: SP }], ['POST', '/links', { path: 'secreta.md', o: SP }],
        ['GET', '/shares' + o], ['DELETE', '/shares/1' + o], ['DELETE', '/links/1' + o]];
      const leaks = []; for (const [m, u, b] of http1) { const r = await call(m, u, b, Rd.s); if (r.status !== 403 || r.json.error !== 'read_only') leaks.push(m + ' ' + u + ' ' + r.status + ' ' + (r.json && r.json.error)); }
      check('papeles: quien solo lee no escribe, crea, elimina, mueve, restaura, vacía, comparte ni enlaza por HTTP (403 read_only en cada ruta)', leaks.length === 0 && await intact(), leaks);
      const mcp1 = []; for (const [name, a] of [['create_board', { path: '@team/secreta.md' }], ['create_board', { path: '@team/tablero-nuevo.md' }], ['add_card', { path: '@team/secreta.md', title: 'colada' }], ['move_card', { path: '@team/secreta.md', id: '0.0.0', column: 'Done' }], ['update_card', { path: '@team/secreta.md', id: '0.0.0', title: 'pisada' }], ['delete_card', { path: '@team/secreta.md', id: '0.0.0' }], ['write_note', { path: '@team/secreta.md', text: 'pisada' }], ['append_note', { path: '@team/secreta.md', text: 'más' }], ['write_note', { path: '@team/nueva.md', text: 'x' }], ['move_note', { from: '@team/secreta.md', to: '@team/robada.md' }], ['share_note', { path: '@team/secreta.md', email: X.email }], ['create_public_link', { path: '@team/secreta.md' }], ['unshare_note', { path: '@team/secreta.md', email: X.email }], ['revoke_public_link', { path: '@team/secreta.md' }]]) { const r = await tool(S, tokR, name, a); if (!r.err || (/board|card/.test(name) && !/Your role in this team is reader/.test(String(r.v)))) mcp1.push(name); }
      check('papeles: tampoco por MCP, aunque su token tenga permiso de compartir', mcp1.length === 0 && await intact() && (await call('GET', '/shared', undefined, X.s)).json.length === 0, mcp1);
      check('papeles: sí lee, por HTTP, por MCP y por los avisos en vivo', (await call('GET', n('secreta.md'), undefined, Rd.s)).json.role === 'view' && JSON.stringify((await tool(S, tokR, 'read_note', { path: '@team/secreta.md' })).v).includes(RSECRET) && (await (async () => { const st = await stream('/events?path=secreta.md&o=' + SP, Rd.s); const ok = st.status === 200; st.stop(); return ok; })()));
      // Un papel que no existe, o subirse el propio.
      const esc1 = []; for (const [who, body] of [[Rd, { id: Rd.id, role: 'admin' }], [Ed, { id: Ed.id, role: 'admin' }], [Ed, { id: Rd.id, role: 'editor' }], [X, { id: Rd.id, role: 'admin' }]]) { const r = await call('POST', '/team/role', body, who.s); if (r.status !== 403 && r.status !== 404) esc1.push(who.email + ' ' + r.status); }
      const badRoles = []; for (const role of ['owner', 'ADMIN', '', null, 1, ['admin'], { role: 'admin' }, 'admin\u0000']) { const r = await call('POST', '/team/role', { id: Rd.id, role }, N.s); if (r.status !== 400) badRoles.push(JSON.stringify(role) + ' ' + r.status); }
      const overOwner = [await call('POST', '/team/role', { id: N.id, role: 'reader' }, Ad.s), await call('POST', '/team/remove', { id: N.id }, Ad.s), await call('POST', '/team/role', { id: N.id, role: 'reader' }, N.s)];
      check('papeles: nadie se sube el papel ni cambia el de otro sin administrar, y un papel inventado se rechaza', esc1.length === 0 && badRoles.length === 0 && (await acct(Rd)).team.mine.role === 'reader' && (await acct(Ed)).team.mine.role === 'editor', [esc1, badRoles]);
      check('papeles: a quien paga no lo baja ni lo saca otra persona que administra, ni se baja solo', overOwner.every((r) => r.status === 409 && r.json.error === 'owner_stays') && (await acct(N)).team.mine.role === 'admin' && (await acct(N)).team.mine.owner === true, overOwner.map((r) => r.status));
      const invBad = await call('POST', '/team/invite', { email: 'otra@ejemplo.test', role: 'owner' }, N.s); const invByEd = await call('POST', '/team/invite', { email: 'otra@ejemplo.test', role: 'admin' }, Ed.s);
      check('papeles: al invitar no se cuela un papel inventado, y quien edita no invita administradores', invBad.status === 400 && invByEd.status === 403, [invBad.status, invByEd.status]);

      // Políticas: solo quien administra las cambia, y se miran en cada pedido.
      await call('PUT', '/team/policies', { share: false, links: false }, N.s);
      const polBy = []; for (const who of [Ed, Rd, X, P]) { for (const body of [{ share: true }, { links: true, tokens: true, automation: true }, { history_days: 30 }, { template: 'x' }]) { const r = await call('PUT', '/team/policies', body, who.s); if (r.status !== 403 && r.status !== 404) polBy.push(who.email + ' ' + r.status); } }
      const polNow = (await call('GET', '/team/policies', undefined, N.s)).json.policies;
      check('políticas: un miembro o una cuenta de afuera no las cambia', polBy.length === 0 && polNow.share === false && polNow.links === false && polNow.automation === false && polNow.history_days === 0 && polNow.template === '', [polBy, polNow]);
      check('políticas: sin sesión, o con un token de IA, no se leen ni se cambian', (await call('GET', '/team/policies')).status === 401 && (await call('PUT', '/team/policies', { share: true })).status === 401 && (await call('PUT', '/team/policies', { share: true }, tokR)).status === 401);
      const badPol = []; for (const body of [{ share: 1 }, { share: 'true' }, { links: null }, { history_days: -1 }, { history_days: 99999 }, { history_days: '30' }, { folder: '../..' }, { folder: 5 }, { template: 'x'.repeat(20001) }, { template: 'enc1:AAAA' }, { template: 'vault1:AAAA' }, { template: 7 }]) { const r = await call('PUT', '/team/policies', body, N.s); if (r.status !== 400) badPol.push(JSON.stringify(body).slice(0, 40) + ' ' + r.status); }
      check('políticas: un valor mal formado se rechaza entero', badPol.length === 0, badPol);
      const tokEd = (await call('POST', '/tokens', { name: 'IA', share: true }, Ed.s)).json.token; secrets.push(tokEd);
      const offOut = [await call('POST', '/shares', { path: 'secreta.md', email: X.email, o: SP }, Ed.s), await call('POST', '/links', { path: 'secreta.md', o: SP }, Ed.s)];
      const offMcp = [await tool(S, tokEd, 'share_note', { path: '@team/secreta.md', email: X.email }), await tool(S, tokEd, 'create_public_link', { path: '@team/secreta.md' })];
      check('políticas: con compartir y enlaces apagados, quien edita no saca una nota del equipo ni por HTTP ni por MCP', offOut.every((r) => r.status === 403 && r.json.error === 'team_policy') && offMcp.every((r) => r.err) && (await call('GET', '/shared', undefined, X.s)).json.length === 0 && (() => { const d = S.db(); const c = d.prepare('SELECT COUNT(*) AS c FROM links WHERE owner = ?').get(SP).c; d.close(); return c === 0; })(), [offOut.map((r) => r.status), offMcp.map((r) => r.err)]);
      const otherSpace = [await call('POST', '/shares', { path: 'secreta.md', email: X.email, o: SPACE }, N.s), await call('POST', '/links', { path: 'secreta.md', o: SPACE }, N.s), await call('GET', '/shares?o=' + SPACE, undefined, N.s), await call('POST', '/shares', { path: 'secreta.md', email: X.email, o: A.id }, N.s), await call('GET', '/shares?o=' + A.id, undefined, N.s)];
      check('políticas: administrar un equipo no da nada sobre el espacio de otro equipo ni sobre la cuenta de otra persona', otherSpace.every((r) => r.status === 403 && r.json.error === 'no_access'), otherSpace.map((r) => r.status));
      await call('PUT', '/team/policies', { tokens: false }, N.s);
      const hidden = [await tool(S, tokEd, 'read_note', { path: '@team/secreta.md' }), await tool(S, tokEd, 'search_notes', { query: RSECRET }), await tool(S, tokEd, 'list_notes', {}), await tool(S, tokEd, 'write_note', { path: '@team/secreta.md', text: 'pisada' })];
      check('políticas: si los miembros no pueden conectar su IA al espacio, su token no lo lee, no lo busca, no lo lista ni escribe ahí', !hidden.some((r) => JSON.stringify(r.v).includes(RSECRET) || /@team/.test(JSON.stringify(r.v)) && !r.err) && await intact(), hidden.map((r) => JSON.stringify(r.v).slice(0, 80)));
      await call('PUT', '/team/policies', { tokens: true }, N.s);

      // Cobro: solo quien paga.
      const views = []; for (const who of [Ed, Rd, Ad]) { const a = await acct(who); const raw = JSON.stringify(a); if (a.billing !== false || a.checkout.monthly || a.checkout.yearly || a.team.checkout || a.team.enabled || a.manage || 'billing' in a.team.mine || /sub_roles|pri_prueba/.test(raw)) views.push(who.email); if (who !== Ad && ('seats' in a.team.mine || 'pending' in a.team.mine)) views.push(who.email + ' lugares'); }
      const seatTry = []; for (const who of [Ed, Rd, Ad, X]) { const r = await call('POST', '/team/seats', { seats: 9 }, who.s); if (r.status !== 403 && r.status !== 404) seatTry.push(who.email + ' ' + r.status); }
      check('cobro: un miembro no ve enlaces de pago, portal, suscripción ni lugares, y no cambia los lugares aunque administre', views.length === 0 && seatTry.length === 0 && (await acct(N)).team.mine.seats === 6 && !paddleCalls.some((c) => /sub_roles/.test(c.url)), [views, seatTry]);
      check('cobro: la cuenta nunca recibe el id de la suscripción', !JSON.stringify(await acct(N)).includes('sub_roles'));

      // Registro de actividad.
      const logTry = []; for (const [who, st] of [[Ed, 403], [Rd, 403], [X, 404], [A, 200]]) { for (const u of ['/team/log', '/team/log?format=csv']) { const r = await call('GET', u, undefined, who.s); if (r.status !== st) logTry.push(who.email + ' ' + r.status); } }
      const logA = JSON.stringify((await call('GET', '/team/log', undefined, A.s)).json); const logN = (await call('GET', '/team/log', undefined, N.s)).json; const csvN = (await call('GET', '/team/log?format=csv', undefined, N.s)).json.csv;
      check('registro: solo lo lee quien administra, y el de su equipo, no el de otro', logTry.length === 0 && !logA.includes('nora@') && !logA.includes('lector@') && logN.entries.length > 5 && !JSON.stringify(logN).includes('ana@ejemplo.test') && (await call('GET', '/team/log')).status === 401, logTry);
      check('registro: no guarda texto de notas ni correos de afuera del equipo, tampoco en la base ni en el CSV', !JSON.stringify(logN).includes(RSECRET) && !csvN.includes(RSECRET) && !JSON.stringify(logN).includes(X.email) && !csvN.includes(X.email) && !csvN.includes('otra@ejemplo.test') && (() => { const d = S.db(); const rows = JSON.stringify(d.prepare('SELECT * FROM team_log').all()); d.close(); return !rows.includes(RSECRET) && !rows.includes('@'); })());
      const inj = []; for (const qs of ["who=1%20OR%201=1", "action=role'--", 'action[]=role', 'from=1e99', 'to=-1', 'before=abc', 'token=' + enc("x' OR '1'='1"), 'who=' + A.id]) { const r = await call('GET', '/team/log?' + qs, undefined, N.s); if (r.status === 500 || (r.json && r.json.entries && r.json.entries.some((e) => e.who === 'ana@ejemplo.test'))) inj.push(qs + ' ' + r.status); }
      check('registro: los filtros no se pueden usar para leer otro equipo ni romper la consulta', inj.length === 0, inj);
      const noWrite = [await call('POST', '/team/log', { action: 'edit' }, N.s), await call('DELETE', '/team/log', undefined, N.s), await call('PUT', '/team/log', {}, N.s)];
      check('registro: nadie lo edita ni lo borra, ni quien administra', noWrite.every((r) => r.status === 404) && (await call('GET', '/team/log', undefined, N.s)).json.entries.length >= logN.entries.length, noWrite.map((r) => r.status));

      // Tokens del equipo.
      const ttBy = []; for (const who of [Ed, Rd, X]) { for (const [m, u, b] of [['GET', '/team/tokens'], ['POST', '/team/tokens', { name: 'x', write: true, share: true }], ['DELETE', '/team/tokens/1']]) { const r = await call(m, u, b, who.s); if (r.status !== 403 && r.status !== 404) ttBy.push(who.email + ' ' + m + ' ' + r.status); } }
      check('token del equipo: solo quien administra los crea, los ve y los revoca', ttBy.length === 0, ttBy);
      const tt = (await call('POST', '/team/tokens', { name: 'Docs', folder: 'docs', write: true, share: true }, Ad.s)).json; const ttRo = (await call('POST', '/team/tokens', { name: 'Lee', share: true }, N.s)).json; secrets.push(tt.token, ttRo.token);
      await call('PUT', n('docs/guia.md'), { text: 'guía' }, N.s);
      const outScope = []; for (const [name, a] of [['read_note', { path: 'secreta.md' }], ['read_note', { path: 'docs/../secreta.md' }], ['read_note', { path: '../secreta.md' }], ['read_note', { path: '@team/secreta.md' }], ['write_note', { path: 'secreta.md', text: 'pisada' }], ['append_note', { path: 'secreta.md', text: 'x' }], ['move_note', { from: 'docs/guia.md', to: 'fuera.md' }], ['move_note', { from: 'secreta.md', to: 'docs/robada.md' }], ['note_history', { path: 'secreta.md' }], ['share_note', { path: 'secreta.md', email: X.email }], ['create_public_link', { path: 'secreta.md' }], ['search_notes', { query: RSECRET }], ['list_notes', {}], ['list_folders', {}]]) { const r = await tool(S, tt.token, name, a); if (JSON.stringify(r.v).includes(RSECRET) || /secreta|otra\.md/.test(JSON.stringify(r.v)) && !r.err || (!r.err && !/^(search_notes|list_notes|list_folders)$/.test(name))) outScope.push(name + ' ' + JSON.stringify(a)); }
      check('token del equipo: fuera de su carpeta no lee, no escribe, no mueve, no comparte, no busca ni lista', outScope.length === 0 && await (async () => (await call('GET', n('secreta.md'), undefined, N.s)).json.text === 'uno ' + RSECRET)(), outScope);
      check('token del equipo: adentro de su carpeta sí', JSON.stringify((await tool(S, tt.token, 'read_note', { path: 'docs/guia.md' })).v).includes('guía') && !(await tool(S, tt.token, 'write_note', { path: 'docs/nueva.md', text: 'x' })).err);
      const roTry = []; for (const [name, a] of [['create_board', { path: 'otra.md' }], ['create_board', { path: 'tablero-nuevo.md' }], ['add_card', { path: 'otra.md', title: 'colada' }], ['move_card', { path: 'otra.md', id: '0.0.0', column: 'Done' }], ['update_card', { path: 'otra.md', id: '0.0.0', title: 'pisada' }], ['delete_card', { path: 'otra.md', id: '0.0.0' }], ['write_note', { path: 'otra.md', text: 'pisada' }], ['append_note', { path: 'otra.md', text: 'x' }], ['move_note', { from: 'otra.md', to: 'o2.md' }], ['share_note', { path: 'otra.md', email: X.email }], ['create_public_link', { path: 'otra.md' }]]) { const r = await tool(S, ttRo.token, name, a); if (!r.err || (/board|card/.test(name) && !/This token can only read/.test(String(r.v)))) roTry.push(name); }
      check('token del equipo: el de solo lectura no cambia nada, aunque al crearlo se haya pedido compartir, y no se le ofrecen las herramientas que escriben', roTry.length === 0 && ttRo.share === false && (await (async () => { const names = (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ttRo.token)).json.result.tools.map((x) => x.name); return names.includes('list_boards') && names.includes('get_guide') && !names.some((x) => /^(create_board|add_card|move_card|update_card|delete_card|write_note)$/.test(x)); })()) && (await call('GET', n('tablero-nuevo.md'), undefined, N.s)).status === 404 && (await call('GET', n('otra.md'), undefined, N.s)).json.text === 'dos', roTry);
      const noPerson = []; for (const [name, a] of [['read_note', { path: '~' + N.id + '/x.md' }], ['list_comments', {}]]) { const r = await tool(S, ttRo.token, name, a); if (JSON.stringify(r.v).includes('nora@')) noPerson.push(name); }
      const asSession = [await call('GET', '/account', undefined, tt.token), await call('GET', '/notes', undefined, tt.token), await call('GET', '/team/log', undefined, tt.token), await call('POST', '/team/tokens', { name: 'otro', write: true }, tt.token), await call('PUT', '/team/policies', { share: true }, tt.token), await call('POST', '/tokens', { name: 'x' }, tt.token)];
      check('token del equipo: no es una sesión: no administra, no crea tokens ni cambia políticas, y no llega a nada de ninguna persona', asSession.every((r) => r.status === 401) && noPerson.length === 0, asSession.map((r) => r.status));
      await call('PUT', '/team/policies', { share: false, links: false }, N.s);
      const ttPol = [await tool(S, tt.token, 'share_note', { path: 'docs/guia.md', email: X.email }), await tool(S, tt.token, 'create_public_link', { path: 'docs/guia.md' })];
      check('token del equipo: con permiso de compartir igual respeta la política del equipo', ttPol.every((r) => r.err) && (await call('GET', '/shared', undefined, X.s)).json.length === 0, ttPol.map((r) => JSON.stringify(r.v).slice(0, 80)));
      const cross = await call('DELETE', '/team/tokens/' + tt.id, undefined, A.s);
      check('token del equipo: quien administra otro equipo no lo revoca', cross.status === 404 && !(await tool(S, tt.token, 'read_note', { path: 'docs/guia.md' })).err);
      const revoked = await call('DELETE', '/team/tokens/' + tt.id, undefined, N.s);
      const dead = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'docs/guia.md' } } }, tt.token);
      check('token del equipo: revocado, no entra más', revoked.status === 200 && dead.status === 401 && !JSON.stringify(dead.json).includes('guía'), dead.status);
      check('token del equipo: en la base queda su hash, no el token', (() => { const d = S.db(); const rows = JSON.stringify(d.prepare('SELECT * FROM tokens WHERE team IS NOT NULL').all()); d.close(); return !rows.includes(ttRo.token) && !rows.includes(ttRo.token.slice(4)); })());

      // Ex miembro: por cada vía.
      const tokEx = (await call('POST', '/tokens', { name: 'IA', folder: '@team', share: true }, Ex.s)).json.token; secrets.push(tokEx);
      const earEx = await stream('/events?path=secreta.md&o=' + SP, Ex.s); await sleep(120);
      await call('POST', '/team/remove', { id: Ex.id }, Ad.s); await sleep(150);
      const exHttp = []; for (const [m, u, b] of [['GET', n('secreta.md')], ['PUT', n('secreta.md'), { text: 'pisada' }], ['DELETE', n('secreta.md')], ['GET', '/search?q=' + RSECRET + '&o=' + SP], ['GET', '/versions/secreta.md' + o], ['GET', '/trash' + o], ['POST', '/rename', { from: 'secreta.md', to: 'r.md', o: SP }], ['GET', '/events?path=secreta.md&o=' + SP], ['GET', '/shares' + o], ['POST', '/shares', { path: 'secreta.md', email: X.email, o: SP }], ['POST', '/links', { path: 'secreta.md', o: SP }], ['GET', '/team/policies'], ['GET', '/team/log'], ['GET', '/team/tokens'], ['PUT', '/team/policies', { share: true }], ['POST', '/team/role', { id: Ex.id, role: 'admin' }]]) { const r = await call(m, u, b, Ex.s); if (r.status !== 403 && r.status !== 404) exHttp.push(m + ' ' + u + ' ' + r.status); if (JSON.stringify(r.json).includes(RSECRET)) exHttp.push('fuga ' + u); }
      const exList = (await call('GET', '/notes' + o, undefined, Ex.s)).json;
      const exMcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: '@team/secreta.md' } } }, tokEx);
      check('ex miembro: no llega al espacio por ninguna ruta, su conexión abierta se corta y su token deja de entrar', exHttp.length === 0 && Array.isArray(exList) && exList.length === 0 && earEx.done === true && !JSON.stringify(exMcp.json).includes(RSECRET) && (exMcp.status === 402 || (exMcp.json.result && exMcp.json.result.isError)), [exHttp, exList, earEx.done, exMcp.status]);
      const demoted = await call('POST', '/team/role', { id: Ad.id, role: 'reader' }, N.s);
      const afterDemote = [await call('PUT', '/team/policies', { share: true }, Ad.s), await call('GET', '/team/log', undefined, Ad.s), await call('POST', '/team/tokens', { name: 'x', write: true }, Ad.s), await call('POST', '/team/invite', { email: 'z@ejemplo.test' }, Ad.s), await call('PUT', n('secreta.md'), { text: 'pisada' }, Ad.s)];
      check('papeles: quien deja de administrar pierde la administración y la escritura en el mismo pedido siguiente', demoted.status === 200 && afterDemote.every((r) => r.status === 403) && await (async () => (await call('GET', n('secreta.md'), undefined, N.s)).json.text === 'uno ' + RSECRET)(), afterDemote.map((r) => r.status));
      // Tope de cambios de administración.
      let capped = 0; for (let i = 0; i < 130 && !capped; i++) { const r = await call('PUT', '/team/policies', { automation: i % 2 === 0 }, N.s); if (r.status === 429) capped = i; }
      check('tope: los cambios de administración de un equipo tienen límite por hora', capped > 0 && capped <= 120, capped);
    }

    console.log(' Sesiones en vivo sobre notas del equipo');
    {
      const { randomBytes } = await import('crypto');
      const LSECRET = 'REMOLACHA-EN-VIVO-DEL-EQUIPO-5512'; const OSECRET = 'ACELGA-DE-OTRA-NOTA-DEL-EQUIPO-9034'; secrets.push(LSECRET, OSECRET);
      const T = await signup(S, 'tina@ejemplo.test'); const Ed = await signup(S, 'vivoedi@ejemplo.test'); const Rd = await signup(S, 'vivolector@ejemplo.test'); const Ad = await signup(S, 'vivoadmin@ejemplo.test'); const Ex = await signup(S, 'vivosale@ejemplo.test');
      await hook(teamEv('sub_vivo', 'active', T.email, 4));
      const SP = (await acct(T)).team.mine.space; const o = '?o=' + SP; const n = (p) => '/notes/' + enc(p) + o;
      const joinAs = async (who, role) => { await call('POST', '/team/invite', { email: who.email, role }, T.s); return call('POST', '/team/accept', { id: (await acct(who)).team.invites[0].id }, who.s); };
      await joinAs(Ed, 'editor'); await joinAs(Rd, 'reader'); await joinAs(Ad, 'admin'); await joinAs(Ex, 'editor');
      await call('PUT', n('vivo.md'), { text: 'uno ' + LSECRET }, T.s); await call('PUT', n('otra.md'), { text: 'dos ' + OSECRET }, T.s);
      await call('PUT', '/notes/' + enc('propia.md'), { text: 'mía' }, Ed.s);
      const live = (who, path, name) => call('POST', '/live', { path, name: name || 'Alguien', o: SP }, who.s);
      const state = async (who, path) => (await call('GET', '/live?path=' + enc(path || 'vivo.md') + '&o=' + SP, undefined, who.s));
      const end = (who, path) => call('DELETE', '/live?path=' + enc(path || 'vivo.md') + '&o=' + SP, undefined, who.s);
      const enter = async (secret, name) => (await call('POST', '/live/join', { secret, name }, undefined, from(nextIp()))).json;
      const entries = async () => (await call('GET', '/team/log', undefined, T.s)).json.entries;
      const lastOf = async (action) => (await entries()).find((e) => e.action === action);

      // Quién la abre.
      const can0 = [(await acct(Ed)).team.mine.can.live, (await acct(Rd)).team.mine.can.live, (await acct(Ad)).team.mine.can.live];
      check('en vivo del equipo: la política nace apagada; quien administra puede igual', can0[0] === false && can0[1] === false && can0[2] === true, can0);
      const offEd = await live(Ed, 'vivo.md'); const offRd = await live(Rd, 'vivo.md'); const offX = await live(X, 'vivo.md'); const offNo = await call('POST', '/live', { path: 'vivo.md', name: 'x', o: SP });
      check('en vivo del equipo: sin la política quien edita no la abre (team_policy), quien lee tampoco (read_only), y alguien de afuera o sin cuenta menos', offEd.status === 403 && offEd.json.error === 'team_policy' && offRd.status === 403 && offRd.json.error === 'read_only' && offX.status === 403 && offX.json.error === 'no_access' && offNo.status === 401, [offEd.json, offRd.json, offX.json, offNo.status]);
      check('en vivo del equipo: sin o, la ruta se busca entre las notas propias: no hay atajo al espacio', (await call('POST', '/live', { path: 'vivo.md', name: 'x' }, Ed.s)).status === 404 && (await call('POST', '/live', { path: 'vivo.md', name: 'x', o: T.id }, Ed.s)).status === 403);
      const first = await live(T, 'vivo.md', 'Tina'); secrets.push(first.json.secret);
      check('en vivo del equipo: quien administra la abre sobre una nota del espacio', first.status === 200 && typeof first.json.secret === 'string' && first.json.team === true && first.json.you === 'o' && first.json.can === true, first.json);
      { const db = S.db(); const row = db.prepare('SELECT * FROM lives WHERE owner = ?').get(SP); db.close();
        check('en vivo del equipo: se guarda de quién es la nota (el espacio) y quién la abrió, y del enlace solo el hash', !!row && row.opener === T.id && row.path === 'vivo.md' && !JSON.stringify(row).includes(first.json.secret), row); }
      check('en vivo del equipo: queda en el registro quién la abrió y sobre qué nota', await (async () => { const e = await lastOf('live_open'); return !!e && e.who === T.email && e.path === 'vivo.md'; })());

      // Quién la ve y quién la maneja.
      const sEd = (await state(Ed)).json; const sRd = (await state(Rd)).json; const sAd = (await state(Ad)).json; const sX = await state(X);
      check('en vivo del equipo: los miembros la ven, cada uno con su lugar; la maneja quien la abrió o administra', sEd.open === true && sEd.team === true && /^m\d+$/.test(sEd.you) && sEd.can === false && sRd.open === true && sRd.can === false && sAd.can === true && sX.status === 403, [sEd, sRd, sAd, sX.status]);
      check('en vivo del equipo: lo que ven no trae correos ni números de cuenta', !/@ejemplo\.test/.test(JSON.stringify([sEd, sRd, sAd])) && !JSON.stringify(sEd.people).includes(String(T.id) + '"'), sEd);
      const noManage = [];
      for (const [who, code] of [[Ed, 'not_opener'], [Rd, 'read_only'], [X, 'no_access']]) for (const [m, u, b2] of [['DELETE', '/live?path=vivo.md&o=' + SP], ['POST', '/live/rotate', { path: 'vivo.md', o: SP }], ['POST', '/live/kick', { path: 'vivo.md', id: 'g1', o: SP }]]) { const r = await call(m, u, b2, who.s); noManage.push(r.status === 403 && r.json.error === code); }
      check('en vivo del equipo: otro editor, un lector y alguien de afuera no la terminan, no cambian el enlace ni sacan a nadie', noManage.every(Boolean) && (await state(T)).json.open === true, noManage);
      const rot = await call('POST', '/live/rotate', { path: 'vivo.md', o: SP }, Ad.s); secrets.push(rot.json.secret);
      check('en vivo del equipo: otro administrador cambia el enlace, y el anterior deja de servir', rot.status === 200 && (await call('POST', '/live/look', { secret: first.json.secret }, undefined, from(nextIp()))).status === 404 && (await call('POST', '/live/look', { secret: rot.json.secret }, undefined, from(nextIp()))).status === 200);

      // El invitado: su pase, y hasta dónde llega.
      const edEv = await stream('/events?path=vivo.md&o=' + SP, Ed.s); const rdEv = await stream('/events?path=vivo.md&o=' + SP, Rd.s);
      const look = (await call('POST', '/live/look', { secret: rot.json.secret }, undefined, from(nextIp()))).json;
      check('en vivo del equipo: antes de entrar se ve quién invita y el nombre de la nota, nada del equipo', look.by === 'Tina' && look.note === 'vivo.md' && !/@|ejemplo/.test(JSON.stringify(look)), look);
      const g = await enter(rot.json.secret, 'Gabi'); const PASS = g.pass; secrets.push(PASS, g.ticket);
      check('en vivo del equipo: el invitado entra sin cuenta y recibe la nota del espacio', typeof PASS === 'string' && g.note.text === 'uno ' + LSECRET && g.note.name === 'vivo.md' && !/@ejemplo\.test/.test(JSON.stringify(g)), g && g.note);
      const gEv = await stream('/live/events', PASS);
      const gSave = await call('PUT', '/live/note', { text: 'uno ' + LSECRET + '\n\nlínea de Gabi', rev: g.note.rev }, PASS);
      const afterG = (await call('GET', n('vivo.md'), undefined, Ed.s)).json;
      check('en vivo del equipo: el invitado guarda con revisión sobre la nota del espacio', gSave.status === 200 && afterG.text.endsWith('línea de Gabi') && afterG.rev === gSave.json.rev && (await call('PUT', '/live/note', { text: 'a ciegas' }, PASS)).status === 400 && (await call('PUT', '/live/note', { text: 'vieja', rev: g.note.rev }, PASS)).status === 409, [gSave.status, afterG.rev]);
      check('en vivo del equipo: lo que guarda el invitado queda en el registro como una edición, con su nombre marcado como invitado', await (async () => { const e = (await entries()).find((x) => x.action === 'edit' && x.via === 'guest'); return !!e && e.token === 'Gabi' && e.path === 'vivo.md' && !e.who; })(), (await entries()).slice(0, 3));
      const edSave = await call('PUT', n('vivo.md'), { text: afterG.text + '\n\nlínea de Edi', rev: afterG.rev }, Ed.s);
      const stale = await call('PUT', n('vivo.md'), { text: 'pisada', rev: afterG.rev }, Ex.s);
      for (let i = 0; i < 40 && !/de Edi/.test(gEv.text); i++) await sleep(150); // el aviso al invitado llega por su canal de eventos: se espera, no se supone
      await sleep(200);
      const evs = (st) => st.text.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
      const edLive = evs(edEv).filter((e) => e.type === 'live').pop(); const rdLive = evs(rdEv).filter((e) => e.type === 'live').pop();
      check('en vivo del equipo: los miembros con la nota abierta ven la sesión y a los invitados sin entrar a ella; el lector también', !!edLive && edLive.team === true && edLive.can === false && edLive.people.some((p2) => p2.name === 'Gabi' && /^g/.test(p2.id)) && edLive.people.some((p2) => p2.id === edLive.you && p2.member) && !!rdLive && rdLive.people.some((p2) => p2.name === 'Gabi'), [edLive, rdLive]);
      check('en vivo del equipo: a un miembro le llega el cambio del invitado con el texto, sin pedir la nota', evs(edEv).some((e) => e.type === 'saved' && e.pid === 'g' + String(g.you).slice(1) && typeof e.text === 'string' && e.text.endsWith('línea de Gabi')), evs(edEv).filter((e) => e.type === 'saved'));
      check('en vivo del equipo: al invitado le llega lo que guarda un miembro, con su lugar y sin su correo', edSave.status === 200 && evs(gEv).some((e) => e.type === 'saved' && /^m\d+$/.test(e.pid) && e.text.endsWith('línea de Edi')) && !/@ejemplo\.test|"who"|"by"/.test(gEv.text) && !gEv.text.includes(String(SP)), gEv.text.slice(0, 400));
      check('en vivo del equipo: entre miembros el guardado sigue yendo con revisión', stale.status === 409 && stale.json.error === 'rev_conflict', stale.json);
      const rdPres = await call('POST', '/live/presence', { path: 'vivo.md', o: SP, block: 'b1.0', editing: true }, Rd.s); await sleep(250);
      check('en vivo del equipo: quien solo lee figura en un bloque sin tomarlo', rdPres.status === 200 && (await state(T)).json.people.some((p2) => p2.member && p2.block === 'b1.0' && p2.editing === false), (await state(T)).json.people);
      // Con el pase, cada ruta del espacio y de la cuenta.
      const spaceRoutes = [['GET', '/notes' + o], ['GET', n('vivo.md')], ['GET', n('otra.md')], ['PUT', n('otra.md'), { text: 'pisada' }], ['PUT', n('nueva.md'), { text: 'x' }], ['DELETE', n('otra.md')], ['GET', '/search' + o + '&q=ACELGA'], ['POST', '/rename', { from: 'otra.md', to: 'robada.md', o: SP }],
        ['GET', '/trash' + o], ['DELETE', '/trash' + o], ['GET', '/versions/' + enc('otra.md') + o], ['GET', '/version/1' + o], ['GET', '/shares' + o], ['POST', '/shares', { path: 'otra.md', email: X.email, role: 'edit', o: SP }], ['POST', '/links', { path: 'otra.md', o: SP }], ['GET', '/shared'],
        ['GET', '/team'], ['GET', '/team/policies'], ['PUT', '/team/policies', { share: true }], ['GET', '/team/log'], ['GET', '/team/log?format=csv'], ['GET', '/team/tokens'], ['POST', '/team/tokens', { name: 'x', write: true }], ['POST', '/team/invite', { email: 'z9@ejemplo.test' }], ['POST', '/team/role', { id: Ed.id, role: 'admin' }],
        ['POST', '/team/remove', { id: Ed.id }], ['POST', '/team/leave', {}], ['PUT', '/team', { name: 'x' }], ['GET', '/team/vault'], ['POST', '/team/vault', {}], ['POST', '/team/vault/unlock', {}], ['GET', '/account'], ['GET', '/notes'], ['GET', '/tokens'], ['POST', '/tokens', { name: 'x' }], ['GET', '/automations' + o], ['GET', '/sites'],
        ['GET', '/comments?path=otra.md&o=' + SP], ['GET', '/live?path=vivo.md&o=' + SP], ['GET', '/live?path=otra.md&o=' + SP], ['POST', '/live', { path: 'otra.md', name: 'x', o: SP }], ['DELETE', '/live?path=vivo.md&o=' + SP], ['POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }], ['GET', '/events?path=otra.md&o=' + SP], ['GET', '/events?path=vivo.md&o=' + SP]];
      const reach = []; for (const [m, u, b2] of spaceRoutes) { const r = await call(m, u, b2, PASS); if (r.status !== 401 || JSON.stringify(r.json).includes(OSECRET)) reach.push(m + ' ' + u + ' ' + r.status); }
      const inside = [await call('POST', '/live/rotate', { path: 'vivo.md', o: SP }, PASS), await call('POST', '/live/kick', { path: 'vivo.md', id: 'g1', o: SP }, PASS), await call('GET', '/live/notes', undefined, PASS), await call('GET', '/live/note/otra.md', undefined, PASS), await call('DELETE', '/live/note', undefined, PASS), await call('POST', '/live/look', {}, PASS)];
      const tricks = [await call('GET', '/live/note?path=otra.md&o=' + SP, undefined, PASS), await call('PUT', '/live/note?path=otra.md&o=' + SP, { text: 'x', rev: 1, path: 'otra.md', o: SP }, PASS)];
      check('pase de invitado: ninguna ruta del espacio, del equipo ni de la cuenta lo acepta (' + spaceRoutes.length + ' rutas)', reach.length === 0, reach);
      check('pase de invitado: dentro de /live/ no maneja la sesión ni alcanza otra nota', inside.every((r) => r.status === 404 || r.status === 401) && !inside.some((r) => JSON.stringify(r.json).includes(OSECRET)), inside.map((r) => r.status));
      check('pase de invitado: pedir otra ruta por parámetro no cambia de nota', tricks[0].json.name === 'vivo.md' && !JSON.stringify(tricks[0].json).includes(OSECRET) && tricks[1].status !== 200 && (await call('GET', n('otra.md'), undefined, T.s)).json.text === 'dos ' + OSECRET, tricks.map((r) => r.status));
      check('pase de invitado: un token o una sesión de cuenta no entran como pase, ni el pase como sesión de otro', (await call('GET', '/live/note', undefined, Ed.s)).status !== 200 && (await call('GET', '/live/events', undefined, Ed.s)).status === 401);

      // Quién está y quién editó: la IA del equipo aparece, y nada de eso sale hacia quien no puede ver la nota.
      const ttok = (await call('POST', '/team/tokens', { name: 'bot-equipo', write: true }, T.s)).json.token; secrets.push(ttok);
      const edEv2 = await stream('/events?path=vivo.md&o=' + SP, Ed.s); const gEv2 = await stream('/live/events', PASS);
      await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'Agente <b>x</b>' } } }, ttok);
      const aiRead = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_note', arguments: { path: 'vivo.md' } } }, ttok);
      await sleep(350);
      const aiSeen = evs(edEv2).filter((e) => e.type === 'presence' && e.ai && e.ai.length).pop(); const aiGuest = evs(gEv2).filter((e) => e.type === 'live' && e.ai && e.ai.length).pop();
      check('presencia: una IA que lee la nota con un token del equipo figura para los miembros, con el nombre del token y del cliente', aiRead.status === 200 && !!aiSeen && aiSeen.ai[0].kind === 'ai' && aiSeen.ai[0].token === 'bot-equipo' && aiSeen.ai[0].client === 'Agente <b>x</b>' && aiSeen.ai[0].writing === false, aiSeen);
      check('presencia: al invitado de la sesión le llega la IA sin correos ni números de cuenta o de token', !!aiGuest && aiGuest.ai[0].token === 'bot-equipo' && !/@ejemplo\.test|"who"/.test(gEv2.text) && !/"id":\d/.test(JSON.stringify(aiGuest.ai)), aiGuest);
      const otherEv = await stream('/events?path=otra.md&o=' + SP, Ed.s); await sleep(250);
      check('presencia: la IA figura solo en la nota que tocó', !evs(otherEv).some((e) => e.ai && e.ai.length), evs(otherEv)); otherEv.stop();
      const outEv = await stream('/events?path=vivo.md&o=' + SP, X.s);
      check('presencia: quien no puede ver la nota no escucha quién está en ella', outEv.status === 403);
      const edNote = (await call('GET', n('vivo.md'), undefined, Ed.s)).json; const rdNote = (await call('GET', n('vivo.md'), undefined, Rd.s)).json; const gNote = (await call('GET', '/live/note', undefined, PASS)).json;
      check('autor: los miembros ven quién hizo el último guardado; al invitado le llega el nombre visible y nunca algo del correo', edNote.edited && edNote.edited.kind === 'user' && edNote.edited.name === 'vivoedi' && rdNote.edited && rdNote.edited.kind === 'user' && gNote.edited && gNote.edited.kind === 'user' && gNote.edited.name === '' && !/vivoedi|@/.test(JSON.stringify(gNote.edited)), [edNote.edited, gNote.edited]);
      const outNote = await call('GET', n('vivo.md'), undefined, X.s); const outVers = await call('GET', '/versions/' + enc('vivo.md') + o, undefined, X.s);
      check('autor: quien no puede ver la nota no recibe ni el autor ni el historial', outNote.status === 403 && outVers.status === 403 && !/edited/.test(JSON.stringify([outNote.json, outVers.json])), [outNote.status, outVers.status]);
      const gSave2 = await call('PUT', '/live/note', { text: edNote.text + '\n\notra de Gabi', rev: edNote.rev }, PASS); await sleep(250);
      const afterGuest = (await call('GET', n('vivo.md'), undefined, Ed.s)).json;
      check('autor: lo que guarda un invitado queda a su nombre, marcado como invitado, también en el aviso', gSave2.status === 200 && afterGuest.edited.kind === 'guest' && afterGuest.edited.name === 'Gabi' && evs(edEv2).some((e) => e.type === 'saved' && e.edited && e.edited.kind === 'guest' && e.edited.name === 'Gabi'), afterGuest.edited);
      const aiWrite = await call('POST', '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'append_note', arguments: { path: 'vivo.md', text: 'línea del bot' } } }, ttok); await sleep(350);
      const savedAi = evs(gEv2).filter((e) => e.type === 'saved' && e.edited).pop(); const busyAi = evs(edEv2).filter((e) => e.ai && e.ai.length && e.ai[0].writing).pop();
      check('autor: lo que guarda la IA del equipo llega a todos como de la IA, y figura escribiendo', aiWrite.status === 200 && !!savedAi && savedAi.edited.kind === 'ai' && savedAi.edited.name === 'bot-equipo' && !!busyAi && (await call('GET', n('vivo.md'), undefined, Rd.s)).json.edited.name === 'bot-equipo', [savedAi, busyAi]);
      { const db = S.db(); const by = db.prepare('SELECT by FROM notes WHERE user = ? AND path = ?').get(SP, 'vivo.md').by; db.close();
        check('autor: en la base queda el número del token o de la cuenta, nunca un correo ni el token', /^t:\d+$/.test(by) && !by.includes(ttok), by); }
      const hooked = S.log();
      check('presencia: nada de esto se anota en la salida del servidor', !hooked.includes('bot-equipo') && !hooked.includes(ttok));
      edEv2.stop(); gEv2.stop();

      // Sacar a un invitado, y terminarla.
      const kickM = await call('POST', '/live/kick', { path: 'vivo.md', id: sEd.you, o: SP }, T.s); const kickO = await call('POST', '/live/kick', { path: 'vivo.md', id: 'o', o: SP }, T.s);
      check('en vivo del equipo: sacar es para invitados: a un miembro o a quien la abrió no se lo saca', kickM.status === 404 && kickO.status === 404, [kickM.status, kickO.status]);
      const kicked = await call('POST', '/live/kick', { path: 'vivo.md', id: g.you, o: SP }, Ad.s); secrets.push(kicked.json.secret);
      check('en vivo del equipo: un administrador saca al invitado: su pase y su reingreso mueren, el enlace cambia y queda en el registro', kicked.status === 200 && (await call('GET', '/live/note', undefined, PASS)).status === 401 && (await call('POST', '/live/join', { ticket: g.ticket, name: 'Gabi' }, undefined, from(nextIp()))).status === 404 && (await call('POST', '/live/look', { secret: rot.json.secret }, undefined, from(nextIp()))).status === 404
        && await (async () => { const e = await lastOf('live_kick'); return !!e && e.who === Ad.email && e.detail === 'Gabi' && e.path === 'vivo.md'; })(), kicked.status);
      const g2 = await enter(kicked.json.secret, 'Hache'); secrets.push(g2.pass, g2.ticket);
      const ended = await end(Ad);
      check('en vivo del equipo: la termina un administrador que no la abrió: el pase, el reingreso y el enlace dejan de servir en el acto', ended.status === 200 && (await state(T)).json.open === false && (await call('GET', '/live/note', undefined, g2.pass)).status === 401 && (await call('PUT', '/live/note', { text: 'tarde', rev: 9 }, g2.pass)).status === 401
        && (await call('POST', '/live/join', { ticket: g2.ticket, name: 'Hache' }, undefined, from(nextIp()))).status === 404 && (await call('POST', '/live/look', { secret: kicked.json.secret }, undefined, from(nextIp()))).status === 404, ended.status);
      check('en vivo del equipo: y queda en el registro quién la terminó', await (async () => { const e = await lastOf('live_end'); return !!e && e.who === Ad.email && e.via === '' && e.path === 'vivo.md'; })());
      await sleep(200);
      check('en vivo del equipo: a los miembros que la tenían abierta se les avisa que terminó', evs(edEv).some((e) => e.type === 'live' && e.open === false) && evs(rdEv).some((e) => e.type === 'live' && e.open === false));
      edEv.stop(); rdEv.stop(); gEv.stop();

      // Con la política prendida, y lo que pasa cuando quien la abrió pierde el permiso.
      await call('PUT', '/team/policies', { live: true }, T.s);
      const byEd = await live(Ed, 'vivo.md', 'Edi'); secrets.push(byEd.json.secret);
      check('en vivo del equipo: con la política, quien edita la abre; quien solo lee sigue sin poder', byEd.status === 200 && !!byEd.json.secret && (await live(Rd, 'otra.md')).json.error === 'read_only' && (await acct(Ed)).team.mine.can.live === true && (await acct(Rd)).team.mine.can.live === false, byEd.json);
      const again = await live(Ex, 'vivo.md', 'Otro');
      check('en vivo del equipo: abrirla de nuevo desde otra cuenta no da el enlace ni le cambia el nombre', again.status === 200 && again.json.secret === undefined && again.json.name === 'Edi' && again.json.can === false, again.json);
      const g3 = await enter(byEd.json.secret, 'Iris'); secrets.push(g3.pass, g3.ticket);
      await call('PUT', '/team/policies', { live: false }, T.s);
      check('en vivo del equipo: al apagar la política, la sesión de quien no administra termina sola y el pase muere', (await state(T)).json.open === false && (await call('GET', '/live/note', undefined, g3.pass)).status === 401 && await (async () => { const e = await lastOf('live_end'); return !!e && e.via === 'auto' && !e.who; })());
      const byT = await live(T, 'otra.md', 'Tina'); secrets.push(byT.json.secret);
      await call('PUT', '/team/policies', { live: true }, T.s); await call('PUT', '/team/policies', { live: false }, T.s);
      check('en vivo del equipo: la de quien administra no depende de la política', (await state(T, 'otra.md')).json.open === true);
      await call('PUT', '/team/policies', { live: true }, T.s);
      const byEd2 = await live(Ed, 'vivo.md', 'Edi'); const g4 = await enter(byEd2.json.secret, 'Juli'); secrets.push(byEd2.json.secret, g4.pass, g4.ticket);
      await call('POST', '/team/role', { id: Ed.id, role: 'reader' }, T.s);
      check('en vivo del equipo: si quien la abrió pasa a lector, termina sola', (await state(T)).json.open === false && (await call('GET', '/live/note', undefined, g4.pass)).status === 401);
      await call('POST', '/team/role', { id: Ed.id, role: 'editor' }, T.s);
      const byEx = await live(Ex, 'vivo.md', 'Sale'); const g5 = await enter(byEx.json.secret, 'Kiko'); secrets.push(byEx.json.secret, g5.pass, g5.ticket);
      await call('POST', '/team/remove', { id: Ex.id }, T.s);
      check('en vivo del equipo: si quien la abrió sale del equipo, termina sola, y ya no la ve', (await state(T)).json.open === false && (await call('GET', '/live/note', undefined, g5.pass)).status === 401 && (await state(Ex)).status === 403 && (await live(Ex, 'vivo.md')).status === 403);

      // Tope por equipo.
      for (let i = 0; i < 12; i++) await call('PUT', n('tope-' + i + '.md'), { text: 'x' }, T.s);
      const many = []; for (let i = 0; i < 12; i++) many.push(await live(Ed, 'tope-' + i + '.md', 'Edi'));
      many.forEach((r) => { if (r.json && r.json.secret) secrets.push(r.json.secret); });
      check('en vivo del equipo: tope de sesiones abiertas a la vez por equipo (10, contando la de quien administra)', many.filter((r) => r.status === 200).length === 9 && many[9].status === 429 && many[9].json.error === 'live_team_max' && many[11].status === 429, many.map((r) => r.status));
      check('en vivo del equipo: y no gasta el cupo de sesiones propias de quien la abre', (await call('POST', '/live', { path: 'propia.md', name: 'Edi' }, Ed.s)).status === 200);

      // El equipo deja de estar al día, y el espacio protegido.
      const g6 = await enter(byT.json.secret, 'Lola'); secrets.push(g6.pass, g6.ticket);
      await hook(teamEv('sub_vivo', 'canceled', T.email, 4));
      check('en vivo del equipo: si el equipo deja de estar al día, sus sesiones terminan y los pases mueren', (await call('GET', '/live/note', undefined, g6.pass)).status === 401 && (await call('POST', '/live/look', { secret: byT.json.secret }, undefined, from(nextIp()))).status === 404 && S.db().prepare('SELECT COUNT(*) AS n FROM lives WHERE owner = ?').get(SP).n === 0);
      await hook(teamEv('sub_vivo', 'active', T.email, 4));
      const byT2 = await live(T, 'otra.md', 'Tina'); const g7 = await enter(byT2.json.secret, 'Mora'); secrets.push(byT2.json.secret, g7.pass, g7.ticket);
      const guard = await call('POST', '/team/vault', { salt: randomBytes(16).toString('base64'), iters: 600000, wrapped: randomBytes(60).toString('base64'), check: randomBytes(32).toString('base64') }, T.s);
      const inVault = await live(T, 'otra.md', 'Tina');
      check('en vivo del equipo: al proteger el espacio con contraseña la sesión termina, y no se abre otra (los invitados no tienen la llave)', guard.status === 200 && (await call('GET', '/live/note', undefined, g7.pass)).status === 401 && inVault.status === 409 && inVault.json.error === 'live_vault', [guard.status, inVault.json]);
      { const db = S.db(); const dump = JSON.stringify(db.prepare('SELECT * FROM team_log WHERE team = (SELECT id FROM teams WHERE space = ?)').all(SP)); const tickets = db.prepare('SELECT COUNT(*) AS n FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)').get().n; db.close();
        check('en vivo del equipo: el registro guarda el nombre que eligió el invitado, y nunca texto de la nota, secretos ni correos', dump.includes('Gabi') && !dump.includes(LSECRET) && !dump.includes('línea de') && !/@ejemplo\.test/.test(dump) && !dump.includes(first.json.secret) && !dump.includes(PASS), dump.slice(0, 300));
        check('en vivo del equipo: no quedan contraseñas de reingreso de sesiones terminadas', tickets === 0, tickets); }
    }

    const logged = secrets.filter((x) => x && S.log().includes(x));
    check('equipo: la salida del servidor no trae texto de notas, tokens ni la clave de Paddle', logged.length === 0, logged.map((x) => String(x).slice(0, 8)));
    check('equipo: nada de esto se anotó como error del servidor, y sigue arriba', !/error 500|error no capturado|promesa sin atender/.test(S.log()) && S.alive() && (await call('GET', '/health')).status === 200, (S.log().match(/error[^\n]*/g) || []).slice(0, 4));
  } catch (e) { check('equipos: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-2000)); }
  await S.stop(); fakePaddle.close(); fakeMail.close();
}
if (!ONLY || ONLY === 'team') await teamSuite();

// ---------- Galería de la comunidad y alias de Gmail ----------
async function gallerySuite() {
  console.log('Seguridad de la galería de la comunidad');
  const mails = [];
  const fakeMail = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { try { const m = JSON.parse(raw); if (m.to === 'revisa@ejemplo.test') mails.push(m); } catch (e) { /* cuerpo raro */ } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
  await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));
  const KEY = Buffer.alloc(32, 7).toString('base64');
  const S = await boot({ ADMIN_KEY: ADMIN, FEEDBACK_TO: 'revisa@ejemplo.test', MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port, DATA_KEY: KEY, AUTH_PER_IP: '100' });
  const { call } = S; const adminH = { 'x-admin-key': ADMIN };
  try {
    const ana = await signup(S, 'ana-galeria@ejemplo.test'); const leo = await signup(S, 'leo-galeria@ejemplo.test');
    const SECRET_TEXT = 'zanahoria-secreta-de-la-plantilla';
    const tpl = (over) => Object.assign({ type: 'template', name: 'Plantilla de prueba', about: 'Para probar', lang: 'es', author: 'Ana', data: { text: '# Hola\n\n' + SECRET_TEXT + '\n' } }, over || {});
    const theme = (data, over) => Object.assign({ type: 'theme', name: 'Tema de prueba', about: '', lang: 'es', author: 'Ana', data }, over || {});
    const COLORS = { fill: '#dbeafe', text: '#1e3a8a', border: '#3b82f6', line: '#437ad3', second: '#e0e7ff', third: '#cffafe' };
    const pal = (colors, over) => Object.assign({ type: 'palette', name: 'Paleta de prueba', about: '', lang: 'es', author: 'Ana', data: { colors } }, over || {});
    const post = (body, who, ip) => call('POST', '/gallery', body, who === undefined ? ana.s : who, from(ip || nextIp()));
    const linkOf = (act) => { const m = new RegExp((act === 'approve' ? 'Approve' : 'Reject') + ': (\\S+)').exec(mails[mails.length - 1].text); return new URL(m[1]); };
    const getPage = (u) => fetch(S.base + u.pathname + u.search, { headers: from(nextIp()) }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const postForm = (u, extra, ip) => fetch(S.base + u.pathname, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...from(ip || nextIp()) }, body: new URLSearchParams(Object.assign(Object.fromEntries(u.searchParams), extra || {})) }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const live = async () => (await call('GET', '/gallery', undefined, undefined, from(nextIp()))).json;
    const sign = (id, act, exp, nonce, key) => createHmac('sha256', key || ADMIN).update(['gallery-review', id, act, exp, nonce].join('|')).digest('base64url');

    // Envío
    check('galería: enviar sin sesión responde 401', (await post(tpl(), null)).status === 401 && (await post(tpl(), 'mds_inventada')).status === 401);
    await makePro(S, ana.email);
    const tok = (await call('POST', '/tokens', { name: 'ia' }, ana.s)).json.token;
    check('galería: un token de IA no envía aportes', !!tok && (await post(tpl(), tok)).status === 401);
    const BAD = [
      ['una clave de más arriba', Object.assign(tpl(), { html: '<b>x</b>' }), 'bad_schema'],
      ['un tipo que no existe', tpl({ type: 'tool' }), 'bad_type'],
      ['código como tipo', tpl({ type: 'script' }), 'bad_type'],
      ['plantilla con una clave de más', tpl({ data: { text: '# x', css: 'body{}' } }), 'bad_data'],
      ['plantilla que no es texto', tpl({ data: { text: ['# x'] } }), 'bad_data'],
      ['plantilla vacía', tpl({ data: { text: '  \n ' } }), 'bad_data'],
      ['datos que no son un objeto', tpl({ data: '# x' }), 'bad_data'],
      ['tema con CSS libre', theme({ accent: '#112233', css: 'body{background:url(https://x.invalid/a)}' }), 'bad_data'],
      ['tema con una clave que no está en la lista', theme({ background: '#ffffff' }), 'bad_data'],
      ['tema vacío', theme({}), 'bad_data'],
      ['color con nombre', theme({ accent: 'red' }), 'bad_data'],
      ['color corto', theme({ accent: '#fff' }), 'bad_data'],
      ['color con url()', theme({ accent: 'url(https://x.invalid/a.png)' }), 'bad_data'],
      ['color con algo pegado', theme({ accent: '#112233;background:url(//x.invalid)' }), 'bad_data'],
      ['color con expresión', theme({ codeColor: 'var(--x)' }), 'bad_data'],
      ['color que no es texto', theme({ accent: 1122867 }), 'bad_data'],
      ['tipografía fuera de la lista', theme({ font: 'Comic Sans MS' }), 'bad_data'],
      ['tipografía con CSS', theme({ font: 'Arial; } body { display: none' }), 'bad_data'],
      ['tipografía remota', theme({ font: 'url(https://x.invalid/f.woff2)' }), 'bad_data'],
      ['fondo claro que no es claro', theme({ paperLight: '#101010' }), 'bad_data'],
      ['fondo oscuro que no es oscuro', theme({ paperDark: '#fafafa' }), 'bad_data'],
      ['modo que no existe', theme({ mode: 'sepia' }), 'bad_data'],
      ['color de texto sin modo fijo', theme({ text: '#dfe7f5' }), 'bad_data'],
      ['color de texto que no se lee sobre el fondo', theme({ mode: 'dark', text: '#30343c' }), 'bad_data'],
      ['panel que tapa el texto', theme({ mode: 'dark', surface: '#d0d0d0' }), 'bad_data'],
      ['enlace que no se lee', theme({ mode: 'light', link: '#ffe08a' }), 'bad_data'],
      ['panel con url()', theme({ mode: 'dark', surface: 'url(https://x.invalid/a.png)' }), 'bad_data'],
      ['borde con CSS pegado', theme({ mode: 'dark', border: '#24324d;background:url(//x.invalid)' }), 'bad_data'],
      ['texto con expresión', theme({ mode: 'dark', text: 'var(--x)' }), 'bad_data'],
      ['forma que no existe', theme({ diagramShape: 'star' }), 'bad_data'],
      ['paleta sin un color', pal({ fill: '#dbeafe', text: '#1e3a8a', border: '#3b82f6', line: '#437ad3', second: '#e0e7ff' }), 'bad_data'],
      ['paleta con un color de más', pal(Object.assign({ extra: '#000000' }, COLORS)), 'bad_data'],
      ['paleta con un color mal escrito', pal(Object.assign({}, COLORS, { line: 'javascript:alert(1)' })), 'bad_data'],
      ['paleta como lista', pal(['#dbeafe']), 'bad_data'],
      ['nombre largo', tpl({ name: 'n'.repeat(61) }), 'bad_name'],
      ['nombre corto', tpl({ name: 'ab' }), 'bad_name'],
      ['nombre que no es texto', tpl({ name: { toString: 1 } }), 'bad_name'],
      ['descripción larga', tpl({ about: 'd'.repeat(161) }), 'bad_about'],
      ['idioma mal escrito', tpl({ lang: 'english' }), 'bad_lang'],
      ['un correo como nombre público', tpl({ author: 'ana-galeria@ejemplo.test' }), 'bad_author'],
      ['nombre público vacío', tpl({ author: ' ' }), 'bad_author'],
    ];
    const wrong = [];
    for (const [name, body, code] of BAD) { const r = await post(body); if (r.status !== 400 || r.json.error !== code) wrong.push([name, r.status, r.json && r.json.error]); }
    check('galería: lo que no calza con el esquema se rechaza entero (' + BAD.length + ' casos: claves de más, CSS, url(), colores y tipografías fuera de lista)', wrong.length === 0, wrong);
    const big = await post(tpl({ data: { text: '# x\n' + 'a'.repeat(20 * 1024) } }));
    check('galería: una plantilla de más de 20 KB responde 413', big.status === 413 && big.json.error === 'too_large', [big.status, big.json]);
    check('galería: nada de lo rechazado quedó guardado ni gastó el cupo del día', (await call('GET', '/gallery/mine', undefined, ana.s)).json.length === 0);

    const hostile = await post(tpl({ name: 'Plan‮ <script>alert(1)</script>', author: '<img src=x onerror=alert(1)>', about: 'linea\nuna "comilla" \u0007' }));
    const row = () => { const db = S.db(); const r = db.prepare('SELECT * FROM gallery WHERE id = ?').get(hostile.json.id); db.close(); return r; };
    check('galería: el nombre y el autor quedan en una línea, sin marcas que den vuelta el texto', hostile.status === 200 && hostile.json.name === 'Plan <script>alert(1)</script>' && !/[‮\n\u0007]/.test(JSON.stringify(hostile.json)), hostile.json);
    const stored = row(); const fileBytes = fs.readFileSync(path.join(S.dir, 'mdtools.db')).toString('latin1') + (fs.existsSync(path.join(S.dir, 'mdtools.db-wal')) ? fs.readFileSync(path.join(S.dir, 'mdtools.db-wal')).toString('latin1') : '');
    check('galería: con DATA_KEY el aporte pendiente se guarda cifrado en reposo', stored.e === 1 && ['name', 'about', 'author', 'data', 'reason'].every((c) => String(stored[c]).startsWith('enc1:')) && !fileBytes.includes(SECRET_TEXT) && !fileBytes.includes('onerror=alert'), [stored.e, String(stored.name).slice(0, 12)]);
    check('galería: el correo de revisión salió con los dos enlaces, y ninguno trae la clave de administración', mails.length === 1 && /Approve: http/.test(mails[0].text) && /Reject: http/.test(mails[0].text) && !mails[0].text.includes(ADMIN), mails.length);

    // Enlaces firmados
    const ok = linkOf('approve'); const no = linkOf('reject'); const id = hostile.json.id; const nonce = stored.nonce;
    const seen = await getPage(ok);
    check('galería: la página de revisión muestra el aporte como texto, sin scripts', seen.status === 200 && !/<script|<img/i.test(seen.text) && seen.text.includes('&lt;script&gt;') && seen.text.includes('&lt;img src=x onerror=alert(1)&gt;'), seen.text.slice(0, 200));
    for (let i = 0; i < 5; i++) await getPage(ok);
    check('galería: abrir el enlace muchas veces (un lector de correo que lo precarga) no aprueba nada', row().status === 'pending' && (await live()).items.length === 0);
    const swap = (u, k, v) => { const c = new URL(u); c.searchParams.set(k, v); return c; };
    const forged = [
      ['la firma de aprobar usada para rechazar', swap(ok, 'act', 'reject')],
      ['la firma de rechazar usada para aprobar', swap(no, 'act', 'approve')],
      ['otro aporte', swap(ok, 'id', String(id + 1))],
      ['el vencimiento estirado', swap(ok, 'exp', String(+ok.searchParams.get('exp') + 1000))],
      ['la firma cambiada', swap(ok, 'sig', ok.searchParams.get('sig').slice(0, -2) + 'AA')],
      ['sin firma', swap(ok, 'sig', '')],
      ['una acción que no existe', swap(ok, 'act', 'remove')],
      ['firmado con otra clave', swap(ok, 'sig', sign(id, 'approve', ok.searchParams.get('exp'), nonce, 'otra-clave'))],
      ['firmado sin el valor del aporte', swap(ok, 'sig', sign(id, 'approve', ok.searchParams.get('exp'), ''))],
      ['bien firmado pero vencido', (() => { const exp = String(Date.now() - 1000); return swap(swap(ok, 'exp', exp), 'sig', sign(id, 'approve', exp, nonce)); })()],
    ];
    const passed = [];
    for (const [name, u] of forged) { const g = await getPage(u); const p = await postForm(u); if (g.status !== 403 || p.status !== 403) passed.push([name, g.status, p.status]); }
    check('galería: un enlace manipulado o vencido no pasa, ni al abrirlo ni al confirmar (' + forged.length + ' casos)', passed.length === 0 && row().status === 'pending', passed);
    check('galería: confirmar sin enlace no aprueba nada', (await fetch(S.base + '/gallery/review', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...from(nextIp()) }, body: 'id=' + id + '&act=approve' })).status === 403 && row().status === 'pending');
    const done = await postForm(ok);
    check('galería: el enlace bueno, confirmado, aprueba', done.status === 200 && row().status === 'approved' && row().nonce === '' && (await live()).items.length === 1);
    const again = await postForm(ok); const late = await postForm(no, { reason: 'tarde' }); const lateGet = await getPage(no);
    check('galería: un enlace ya usado no sirve, y el de rechazar tampoco después de aprobar', again.status === 403 && late.status === 403 && lateGet.status === 403 && row().status === 'approved', [again.status, late.status, lateGet.status]);
    const ip = nextIp(); let last = null; for (let i = 0; i < 22; i++) last = await postForm(swap(ok, 'sig', 'x' + i), null, ip);
    check('galería: los intentos con enlaces que no sirven tienen tope por IP', last.status === 429);

    // Administración
    const second = await post(pal(COLORS));
    const noKey = [await call('GET', '/admin/gallery', undefined, undefined, from(nextIp())), await call('POST', '/admin/gallery', { id: second.json.id, action: 'approve' }, undefined, from(nextIp())),
      await call('POST', '/admin/gallery', { id: second.json.id, action: 'approve' }, ana.s, from(nextIp())), await call('POST', '/admin/gallery', { id: second.json.id, action: 'approve' }, undefined, { 'x-admin-key': 'otra', ...from(nextIp()) })];
    check('galería: aprobar sin la clave de administración responde 403, también con una sesión', noKey.every((r) => r.status === 403) && (await live()).items.length === 1, noKey.map((r) => r.status));
    check('galería: con la clave, una acción que no existe o un aporte que no existe no hacen nada', (await call('POST', '/admin/gallery', { id: second.json.id, action: 'publish' }, undefined, adminH)).status === 400 && (await call('POST', '/admin/gallery', { id: 99999, action: 'approve' }, undefined, adminH)).status === 404 && (await call('POST', '/admin/gallery', { id: '1 OR 1=1', action: 'approve' }, undefined, adminH)).status === 404);
    await call('POST', '/admin/gallery', { id: second.json.id, action: 'approve' }, undefined, adminH);

    // Lo público no trae la cuenta
    const pub = await live(); const one = await call('GET', '/gallery/' + id, undefined, undefined, from(nextIp()));
    const leak = JSON.stringify([pub, one.json]);
    check('galería: ni la lista pública ni un aporte traen el correo o el número de la cuenta', pub.items.length === 2 && !/ejemplo\.test|@|"user"|"account"|"email"|"nonce"|"reason"/.test(leak) && pub.items.every((x) => Object.keys(x).every((k) => ['id', 'type', 'name', 'about', 'lang', 'author', 'adds', 'at', 'data', 'size'].includes(k))), leak.slice(0, 400));
    check('galería: cada cuenta ve solo sus aportes', (await call('GET', '/gallery/mine', undefined, leo.s)).json.length === 0 && (await call('GET', '/gallery/mine')).status === 401 && !/ejemplo\.test|nonce/.test(JSON.stringify((await call('GET', '/gallery/mine', undefined, ana.s)).json)));
    check('galería: otra cuenta no retira un aporte ajeno, y sin sesión tampoco', (await call('DELETE', '/gallery/' + id, undefined, leo.s)).status === 404 && (await call('DELETE', '/gallery/' + id)).status === 401 && (await live()).items.length === 2);

    // Topes
    for (let i = 0; i < 3; i++) await post(pal(COLORS, { name: 'Paleta ' + i }));
    const sixth = await post(pal(COLORS, { name: 'La sexta' }));
    check('galería: seis envíos en un día de la misma cuenta no pasan, aunque cambie de IP', sixth.status === 429 && sixth.json.error === 'too_many' && sixth.json.retry_after > 0, [sixth.status, sixth.json]);
    const addIp = nextIp(); let adds = null; for (let i = 0; i < 3; i++) adds = await call('POST', '/gallery/' + id + '/add', undefined, undefined, from(addIp));
    let flood = null; for (let i = 0; i < 62; i++) flood = await call('POST', '/gallery/' + second.json.id + '/add', undefined, undefined, from(addIp));
    check('galería: el contador no se infla desde una IP, y los pedidos de sumar tienen tope', adds.json.adds === 1 && flood.status === 429 && (await call('GET', '/gallery/' + second.json.id, undefined, undefined, from(nextIp()))).json.adds === 1, [adds.json, flood.status]);
    const reqIp = nextIp(); let many = null; for (let i = 0; i < 305; i++) many = await call('GET', '/gallery', undefined, undefined, from(reqIp));
    check('galería: la lista pública tiene tope de pedidos por IP', many.status === 429 && many.json.error === 'too_many');
    check('galería: una denuncia de un aporte entra por /feedback marcada como tal', (await call('POST', '/feedback', { text: '', report: { kind: 'gallery', note: '#' + id + ' template', owner: 'Ana' } }, undefined, from(nextIp()))).status === 200 && /Kind: gallery/.test(mails[mails.length - 1].text));

    // Borrar la cuenta se lleva sus aportes
    await call('DELETE', '/account', { email: ana.email }, ana.s, from(nextIp()));
    const dbAfter = S.db(); const left = dbAfter.prepare('SELECT COUNT(*) AS n FROM gallery').get().n; dbAfter.close();
    check('galería: al eliminar la cuenta sus aportes salen de la galería y de la base', (await live()).items.length === 0 && left === 0, left);

    // Alias de Gmail
    const g1 = await signup(S, 'j.perez+notas@gmail.com'); const g2 = await signup(S, 'jperez@gmail.com'); const g3 = await signup(S, 'J.P.E.R.E.Z+otra@googlemail.com');
    const acc = (await call('GET', '/account', undefined, g3.s)).json;
    check('alias de Gmail: con puntos, con + o con googlemail se entra a la misma cuenta, que conserva su correo', g1.id === g2.id && g2.id === g3.id && acc.email === 'j.perez+notas@gmail.com', [g1.id, g2.id, g3.id, acc.email]);
    const o1 = await signup(S, 'j.perez@ejemplo.test'); const o2 = await signup(S, 'jperez@ejemplo.test'); const o3 = await signup(S, 'jperez+x@ejemplo.test');
    check('alias de Gmail: en otros dominios cada dirección es su cuenta', new Set([o1.id, o2.id, o3.id, g1.id]).size === 4, [o1.id, o2.id, o3.id]);
    const dbw = S.db(); dbw.exec("INSERT INTO users (email, mkey, created) VALUES ('m.lopez@gmail.com', 'mlopez@gmail.com', 1)"); dbw.exec("INSERT INTO users (email, created) VALUES ('mlopez@gmail.com', 2)");
    const ids = dbw.prepare("SELECT id, email FROM users WHERE email LIKE '%lopez@gmail.com' ORDER BY id").all(); dbw.close();
    const d1 = await signup(S, 'm.lopez@gmail.com'); const d2 = await signup(S, 'mlopez@gmail.com'); const d3 = await signup(S, 'ml.opez+z@gmail.com');
    check('alias de Gmail: dos cuentas que ya existían siguen entrando cada una a la suya', d1.id === ids[0].id && d2.id === ids[1].id && d1.id !== d2.id && d3.id === ids[0].id, [ids, d1.id, d2.id, d3.id]);
    let capped = null; for (let i = 0; i < 6; i++) capped = await call('POST', '/auth/start', { email: 'tope.gmail+' + i + '@gmail.com' }, undefined, from(nextIp()));
    check('alias de Gmail: los alias no multiplican los códigos que se le mandan a una casilla', capped.status === 429 && capped.json.error === 'code_mail_hour', [capped.status, capped.json]);
    // Seis intentos por código: con dos alias serían doce. El tope por casilla (diez por hora) corta en el undécimo.
    let tries = null; let n = 0;
    for (let a = 0; a < 2; a++) {
      const mailA = 'fuerza.bruta+' + a + '@gmail.com'; const stA = await call('POST', '/auth/start', { email: mailA }, undefined, from(nextIp())); const wrongCode = stA.json.dev_code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 6 && n < 11; i++, n++) tries = await call('POST', '/auth/verify', { email: mailA, code: wrongCode }, undefined, from(nextIp()));
    }
    const st = await call('POST', '/auth/start', { email: 'otro.buzon@gmail.com' }, undefined, from(nextIp()));
    check('alias de Gmail: tampoco los intentos de adivinar un código', n === 11 && tries.status === 429 && tries.json.error === 'tries_mail_hour', [tries.status, tries.json]);
    check('alias de Gmail: el código vale para la dirección que lo pidió, no para otro alias', (await call('POST', '/auth/verify', { email: 'otrobuzon@gmail.com', code: st.json.dev_code }, undefined, from(nextIp()))).status === 400 && (await call('POST', '/auth/verify', { email: 'otro.buzon@gmail.com', code: st.json.dev_code }, undefined, from(nextIp()))).status === 200);

    const sigs = [ok.searchParams.get('sig'), no.searchParams.get('sig'), nonce, KEY];
    check('galería: la salida del servidor no trae firmas, la clave de datos ni el texto de un aporte', !sigs.some((x) => x && S.log().includes(x)) && !S.log().includes(SECRET_TEXT));
    check('galería: nada de esto se anotó como error del servidor, y sigue arriba', !/error 500|error no capturado|promesa sin atender/.test(S.log()) && S.alive() && (await call('GET', '/health')).status === 200, (S.log().match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('galería: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-2000)); }
  await S.stop(); fakeMail.close();

  // Sin clave de administración nadie puede revisar: el servidor no recibe aportes, y la lista pública sigue respondiendo.
  const P = await boot({});
  try {
    const u = await signup(P, 'sin-clave@ejemplo.test');
    const r = await P.call('POST', '/gallery', { type: 'palette', name: 'Paleta', about: '', lang: 'es', author: 'Ana', data: { colors: { fill: '#dbeafe', text: '#1e3a8a', border: '#3b82f6', line: '#437ad3', second: '#e0e7ff', third: '#cffafe' } } }, u.s);
    const l = await P.call('GET', '/gallery');
    check('galería: sin ADMIN_KEY no se reciben aportes y un enlace no vale nada', r.status === 404 && l.status === 200 && l.json.open === false && (await fetch(P.base + '/gallery/review?id=1&act=approve&exp=' + (Date.now() + 9999) + '&sig=' + createHmac('sha256', 'undefined').update('gallery-review|1|approve|x|').digest('base64url'))).status === 403, [r.status, l.json]);
  } catch (e) { check('galería sin clave: sin excepciones en la prueba', false, String(e && e.stack || e)); }
  await P.stop();
}
if (!ONLY || ONLY === 'gallery') await gallerySuite();

// ---------- Automatizaciones: API con token, webhooks salientes y direcciones de entrada ----------
async function automationSuite() {
  console.log('Seguridad de las automatizaciones');
  const J = (v) => JSON.stringify(v);
  // Un receptor que anota lo que llega, y un puerto que solo cuenta conexiones: nadie tendría que tocarlo.
  const got = []; const sink = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { got.push({ url: req.url, headers: req.headers, raw, json: (() => { try { return JSON.parse(raw); } catch (e) { return null; } })() }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r)); const SINK = 'http://127.0.0.1:' + sink.address().port;
  let touched = 0; const trap = net.createServer((sock) => { touched++; sock.destroy(); }); await new Promise((r) => trap.listen(0, '127.0.0.1', r)); const TRAP = trap.address().port;
  const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > (ms || 5000)) return v; await sleep(60); } };
  const KEY = Buffer.alloc(32, 9).toString('base64');

  // --- Sin WEBHOOK_ALLOW_PRIVATE: el servidor como corre en producción ---
  const S = await boot({ ADMIN_KEY: ADMIN, DATA_KEY: KEY, AUTH_PER_IP: '200', WEBHOOK_TIMEOUT_MS: '1500', API_PER_MINUTE: '40' });
  try {
    const { call } = S;
    const A = await signup(S, 'ana@ejemplo.test'); await makePro(S, A.email); const B = await signup(S, 'bea@ejemplo.test'); await makePro(S, B.email); const F = await signup(S, 'gratis@ejemplo.test');
    const mk = (url, extra) => call('POST', '/automations/hooks', Object.assign({ url, events: ['note.created'] }, extra || {}), A.s);
    const BAD = ['http://example.com/x', 'https://127.0.0.1/x', 'https://127.0.0.1:' + TRAP + '/x', 'https://localhost/x', 'https://LOCALHOST./x', 'https://10.0.0.5/', 'https://172.16.0.1/', 'https://172.31.255.255/', 'https://192.168.1.1/', 'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/', 'https://0.0.0.0/', 'https://255.255.255.255/', 'https://224.0.0.1/', 'https://198.18.0.1/', 'https://[::1]/', 'https://[::]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[::ffff:a9fe:a9fe]/', 'https://[::127.0.0.1]/', 'https://[fd00::1]/', 'https://[fc00::1]/',
      'https://[fe80::1]/', 'https://[fec0::1]/', 'https://[ff02::1]/', 'https://[64:ff9b::7f00:1]/', 'https://[2002:7f00:1::]/', 'https://[2002:a9fe:a9fe::1]/', 'https://[2001:db8::1]/', 'https://[2001::1]/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://0x7f000001/', 'https://017700000001/', 'https://127.1/',
      'https://0177.0.0.1/', 'https://user:pass@example.com/', 'https://metadata.google.internal/', 'https://printer.local/', 'https://intranet/', 'https://db.internal/x', 'https://example.com:22/', 'https://example.com:25/', 'file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'javascript:alert(1)',
      'data:text/plain,hola', '//example.com/x', 'example.com', '', '   ', 'https://', 'https://' + 'a'.repeat(2100) + '.com/'];
    const leaked = [];
    for (const u of BAD) { const r = await mk(u); if (r.status !== 400 || !['bad_destination'].includes(r.json.error)) leaked.push(u + ' -> ' + r.status + ' ' + (r.json && r.json.error)); }
    check('SSRF: no se aceptan destinos que no sean https públicos (' + BAD.length + ' variantes: redes privadas, loopback, enlace local, metadatos de nube, IPv6 equivalentes, IP escrita en decimal, octal o hexadecimal, usuario en la dirección, otros esquemas, puertos bajos)', leaked.length === 0, leaked);
    const GOOD = ['https://example.com/hook', 'https://hooks.slack.com/services/T0/B0/xyz', 'https://example.com:8443/x', 'https://[2606:4700:4700::1111]/x', 'https://8.8.8.8/x'];
    const refused = []; const made = [];
    for (const u of GOOD) { const r = await mk(u); if (r.status !== 200) refused.push(u + ' -> ' + r.status); else made.push(r.json); }
    check('y un destino público sí se acepta, también por IP o con otro puerto', refused.length === 0, refused);
    const edit = await call('PUT', '/automations/hooks/' + made[0].hook.id, { url: 'https://169.254.169.254/' }, A.s);
    check('SSRF: cambiarle la dirección a un webhook pasa por el mismo control', edit.status === 400 && edit.json.error === 'bad_destination', edit.json);
    // Aunque una fila llegara a la base con un destino interno (o el nombre pasara a apuntar adentro), la entrega lo vuelve a comprobar.
    check('con DATA_KEY, la dirección y el secreto de un webhook se guardan cifrados', (() => { const db = S.db(); const rows = db.prepare('SELECT url, secret, e FROM hooks').all(); db.close(); return rows.length === GOOD.length && rows.every((r) => r.e === 1 && r.url.startsWith('enc1:') && r.secret.startsWith('enc1:')) && !J(rows).includes('hooks.slack.com') && !J(rows).includes(made[0].secret); })());
    const S2 = await boot({ ADMIN_KEY: ADMIN, AUTH_PER_IP: '200', WEBHOOK_TIMEOUT_MS: '1500' });
    try {
      const A2 = await signup(S2, 'ana@ejemplo.test'); await makePro(S2, A2.email);
      const h = (await S2.call('POST', '/automations/hooks', { url: 'https://example.com/hook', events: ['note.created'] }, A2.s)).json.hook;
      const inside = [];
      for (const u of ['http://127.0.0.1:' + TRAP + '/x', 'https://127.0.0.1:' + TRAP + '/x', 'https://localhost:' + TRAP + '/x', 'https://[::1]:' + TRAP + '/x', 'https://[::ffff:127.0.0.1]:' + TRAP + '/x', 'https://169.254.169.254/latest/meta-data/']) {
        const db = S2.db(); db.prepare('UPDATE hooks SET url = ? WHERE id = ?').run(u, h.id); db.close();
        const r = await S2.call('POST', '/automations/hooks/' + h.id + '/test', {}, A2.s);
        if (r.json.ok || r.json.error !== 'blocked_destination' || r.json.code !== 0) inside.push(u + ' -> ' + J(r.json));
      }
      check('SSRF: la entrega vuelve a comprobar el destino y no abre ninguna conexión hacia adentro', inside.length === 0 && touched === 0, [inside, touched]);
      // Un nombre público que resuelve a 127.0.0.1. Sin red para resolverlo, tampoco hay conexión.
      const db = S2.db(); db.prepare('UPDATE hooks SET url = ? WHERE id = ?').run('https://localtest.me:' + TRAP + '/x', h.id); db.close();
      const dnsr = await S2.call('POST', '/automations/hooks/' + h.id + '/test', {}, A2.s);
      check('SSRF: un nombre que resuelve a una dirección interna se corta después de resolverlo (' + dnsr.json.error + ')', !dnsr.json.ok && ['blocked_destination', 'dns_failed'].includes(dnsr.json.error) && touched === 0, [dnsr.json, touched]);
      const log = (await S2.call('GET', '/automations/hooks/' + h.id + '/deliveries', undefined, A2.s)).json;
      check('y queda anotado en el registro como destino bloqueado', log.length >= 6 && log.filter((j) => j.error === 'blocked_destination').length >= 6 && log.every((j) => j.status === 'failed'), log.slice(0, 2));
    } finally { await S2.stop(); }

    // Dueño, pertenencia y sesión
    const hid = made[0].hook.id;
    const cross = [await call('GET', '/automations/hooks/' + hid + '/deliveries', undefined, B.s), await call('PUT', '/automations/hooks/' + hid, { on: false }, B.s), await call('DELETE', '/automations/hooks/' + hid, undefined, B.s), await call('POST', '/automations/hooks/' + hid + '/test', {}, B.s), await call('POST', '/automations/hooks/' + hid + '/secret', {}, B.s)];
    check('otra cuenta no ve, cambia, prueba ni borra un webhook ajeno, ni le saca el secreto', cross.every((r) => r.status === 404) && (await call('GET', '/automations', undefined, A.s)).json.hooks.length === GOOD.length, cross.map((r) => r.status));
    const other = [await call('GET', '/automations?o=' + B.id, undefined, A.s), await call('POST', '/automations/hooks', { o: B.id, url: 'https://example.com/x', events: ['note.created'] }, A.s), await call('POST', '/automations/inboxes', { o: B.id, kind: 'append', path: 'x.md' }, A.s)];
    check('con el número de otra cuenta en o: 403', other.every((r) => r.status === 403), other.map((r) => r.status));
    const tokA = (await call('POST', '/tokens', { name: 'flujo' }, A.s)).json.token; const tokScoped = (await call('POST', '/tokens', { name: 'tienda', folder: 'tienda' }, A.s)).json.token; secrets.push(tokA, tokScoped);
    const wrongKey = [await call('GET', '/automations', undefined, tokA), await call('POST', '/automations/hooks', { url: 'https://example.com/x', events: ['note.created'] }, tokA), await call('GET', '/automations'), await call('GET', '/api/v1/notes', undefined, A.s), await call('GET', '/api/v1/notes'), await call('GET', '/api/v1/notes', undefined, 'mdt_' + 'x'.repeat(40))];
    check('un token de API no maneja automatizaciones, y la sesión de la app no entra a la API', wrongKey.every((r) => r.status === 401), wrongKey.map((r) => r.status));
    const lim = [await call('POST', '/automations/hooks', { url: 'https://example.com/x', events: ['note.created'] }, F.s), await call('POST', '/automations/inboxes', { kind: 'append', path: 'x.md' }, F.s)];
    check('sin plan pago no se crean webhooks ni direcciones de entrada', lim.every((r) => r.status === 402 && r.json.error === 'automation_needs_plan'), lim.map((r) => r.status));
    for (let i = 0; i < 30; i++) await mk('https://example.com/n' + i);
    const count = (await call('GET', '/automations', undefined, A.s)).json.hooks.length;
    check('hay un tope de webhooks por cuenta', count === 20 && (await mk('https://example.com/uno-mas')).status === 429, count);

    // Alcance del token y permiso de compartir, en la API
    await call('PUT', '/api/v1/note', { path: 'tienda/tablero.md', text: '```kanban\n## A\n- [ ] Uno {id=aaaaaaaa}\n\n## B\n```\n' }, tokA); await call('PUT', '/api/v1/note', { path: 'privada/diario.md', text: '# Diario\n\nSecreto.\n```kanban\n## A\n- [ ] X {id=bbbbbbbb}\n```\n' }, tokA);
    const out = [await call('GET', '/api/v1/note?path=' + enc('privada/diario.md'), undefined, tokScoped), await call('PUT', '/api/v1/note', { path: 'privada/nueva.md', text: 'x' }, tokScoped), await call('POST', '/api/v1/note/append', { path: 'privada/diario.md', text: 'x' }, tokScoped), await call('DELETE', '/api/v1/note?path=' + enc('privada/diario.md'), undefined, tokScoped),
      await call('POST', '/api/v1/note/move', { from: 'tienda/tablero.md', to: 'privada/t.md' }, tokScoped), await call('POST', '/api/v1/note/move', { from: 'privada/diario.md', to: 'tienda/d.md' }, tokScoped), await call('GET', '/api/v1/boards?path=' + enc('privada/diario.md'), undefined, tokScoped),
      await call('POST', '/api/v1/boards/cards', { path: 'privada/diario.md', title: 'x' }, tokScoped), await call('POST', '/api/v1/boards/cards/bbbbbbbb/move', { path: 'privada/diario.md', column: 'B' }, tokScoped), await call('GET', '/api/v1/history?path=' + enc('privada/diario.md'), undefined, tokScoped), await call('POST', '/api/v1/comments', { path: 'privada/diario.md', text: 'x' }, tokScoped)];
    const seenOut = [(await call('GET', '/api/v1/notes', undefined, tokScoped)).json.data, (await call('GET', '/api/v1/folders', undefined, tokScoped)).json.data, (await call('GET', '/api/v1/search?q=' + enc('Secreto'), undefined, tokScoped)).json.data];
    check('API: un token limitado a una carpeta no lee, escribe, mueve, borra ni toca tableros fuera de ella', out.every((r) => r.status === 403 && r.json.ok === false && r.json.error.code === 'out_of_scope') && !J(seenOut).includes('privada') && (await call('GET', '/api/v1/note?path=' + enc('privada/diario.md'), undefined, tokA)).json.data.text.includes('- [ ] X {id=bbbbbbbb}'), [out.map((r) => r.status), seenOut]);
    const inScope = await call('POST', '/api/v1/boards/cards/aaaaaaaa/move', { path: 'tienda/tablero.md', column: 'B' }, tokScoped);
    check('y dentro de su carpeta sí mueve una tarjeta', inScope.status === 200 && inScope.json.data.card.column === 'B', inScope.json);
    const noShare = [await call('POST', '/api/v1/shares', { path: 'tienda/tablero.md', email: 'otra@ejemplo.test' }, tokA), await call('POST', '/api/v1/links', { path: 'tienda/tablero.md' }, tokA), await call('GET', '/api/v1/shares', undefined, tokA), await call('DELETE', '/api/v1/links?path=' + enc('tienda/tablero.md'), undefined, tokA)];
    check('API: un token sin permiso de compartir no comparte ni crea enlaces públicos', noShare.every((r) => r.status === 403 && r.json.error.code === 'no_share_permission') && (await call('GET', '/shares', undefined, A.s)).json.links.length === 0, noShare.map((r) => r.status));
    const paths = []; for (const p of ['../fuera.md', 'a/../../b.md', '/etc/passwd/../x', 'a//b.md', '.', 'a\u0000b.md', 'x'.repeat(400) + '.md']) { const r = await call('GET', '/api/v1/note?path=' + enc(p), undefined, tokA); if (![400, 404].includes(r.status)) paths.push(p + ' ' + r.status); const w = await call('PUT', '/api/v1/note', { path: p, text: 'x' }, tokA); if (w.status !== 400 && !(p === '/etc/passwd/../x')) paths.push('PUT ' + p + ' ' + w.status); }
    check('API: las rutas con .. o caracteres de control se rechazan', paths.length === 0, paths);
    const inj = await call('POST', '/api/v1/boards/cards', { path: 'tienda/tablero.md', column: 'A', title: 'Linda\n## Columna falsa\n- [x] Tarjeta falsa', attrs: { nota: 'x"} {id=zzzzzzzz\n## Otra' } }, tokA);
    const after = (await call('GET', '/api/v1/boards?path=' + enc('tienda/tablero.md'), undefined, tokA)).json.data.boards[0];
    check('API: el título o un atributo de una tarjeta no pueden meter columnas, tarjetas ni otro id', inj.status === 200 && after.columns.length === 2 && after.columns.reduce((n, c) => n + c.cards.length, 0) === 2 && after.columns[0].cards[0].id === inj.json.data.card.id && after.columns[0].cards[0].id !== 'zzzzzzzz', after);
    const errShape = await call('PUT', '/api/v1/note', { path: 'tienda/tablero.md', text: 'x', rev: 0 }, tokA);
    check('API: un conflicto de revisión no devuelve el texto de la nota', errShape.status === 409 && errShape.json.error.code === 'rev_conflict' && !J(errShape.json).includes('kanban'), errShape.json);
    let last = null; for (let i = 0; i < 45; i++) last = await call('GET', '/api/v1/me', undefined, tokScoped);
    check('API: tope de pedidos por token, con Retry-After', last.status === 429 && last.json.error.code === 'rate_limited' && +last.headers.get('retry-after') > 0 && (await call('GET', '/api/v1/me', undefined, (await call('POST', '/tokens', { name: 'otro' }, A.s)).json.token)).status === 200, last.json);

    // Carpetas protegidas: afuera de todo esto
    const vb = (n) => Buffer.alloc(n, 3).toString('base64');
    const vault = (await call('POST', '/vaults', { folder: 'cofre', salt: vb(16), iters: 200000, wrapped: vb(60), check: vb(32) }, A.s)).json;
    const vres = [await call('POST', '/automations/hooks', { url: 'https://example.com/x', events: ['note.created'], scope: { kind: 'folder', path: 'cofre' } }, B.s)];
    const db0 = S.db(); db0.prepare('DELETE FROM hooks WHERE user = ? AND id != ?').run(A.id, hid); db0.close();
    const vAll = [await call('POST', '/automations/hooks', { url: 'https://example.com/x', events: ['note.created'], scope: { kind: 'folder', path: 'cofre' } }, A.s), await call('POST', '/automations/hooks', { url: 'https://example.com/x', events: ['note.created'], scope: { kind: 'note', path: 'cofre/a.md' } }, A.s),
      await call('POST', '/automations/inboxes', { kind: 'append', path: 'cofre/entra.md' }, A.s), await call('POST', '/automations/inboxes', { kind: 'create', path: 'cofre' }, A.s), await call('POST', '/automations/inboxes', { kind: 'card', path: 'cofre/sub/t.md' }, A.s)];
    check('una carpeta protegida no se puede automatizar ni recibe entradas', vres[0].status === 200 && vAll.every((r) => r.status === 409 && r.json.error === 'vault'), vAll.map((r) => r.status + ' ' + (r.json && r.json.error)));
    const vApi = [await call('GET', '/api/v1/note?path=' + enc('cofre/a.md'), undefined, tokA), await call('PUT', '/api/v1/note', { path: 'cofre/a.md', text: 'en claro' }, tokA), await call('GET', '/api/v1/boards?path=' + enc('cofre/a.md'), undefined, tokA), await call('POST', '/api/v1/boards/cards', { path: 'cofre/a.md', title: 'x' }, tokA)];
    check('API: una carpeta protegida y bloqueada no se lee ni se escribe (423, como en el MCP)', vApi.every((r) => r.status === 423 && r.json.error.code === 'vault_locked'), vApi.map((r) => r.status));
    // Una dirección de entrada creada antes de proteger la carpeta deja de escribir ahí.
    const pre = (await call('POST', '/automations/inboxes', { kind: 'append', path: 'luego/entra.md' }, A.s)).json;
    await call('POST', '/vaults', { folder: 'luego', salt: vb(16), iters: 200000, wrapped: vb(60), check: vb(32) }, A.s);
    const late = await fetch(pre.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'texto en claro' });
    check('y una entrada que ya existía no escribe en claro dentro de una carpeta que se protegió después', late.status === 409 && (await call('GET', '/notes', undefined, A.s)).json.every((n) => !n.path.startsWith('luego/')), late.status);
    void vault;

    // Direcciones de entrada
    const inb = (await call('POST', '/automations/inboxes', { kind: 'append', path: 'buzon.md' }, A.s)).json; const secret = inb.url.split('/in/')[1];
    await call('PUT', '/notes/' + enc('buzon.md'), { text: '# Buzón\n\nTexto privado de la nota.\n' }, A.s);
    const okIn = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hola' }); const okBody = await okIn.text();
    check('entrada: el secreto se guarda como hash y la respuesta no trae nada de la nota', okIn.status === 200 && okBody === '{"ok":true}' && (() => { const db = S.db(); const rows = db.prepare('SELECT * FROM inboxes').all(); db.close(); return !J(rows).includes(secret) && rows.some((r) => r.hash === createHash('sha256').update(secret).digest('hex')); })() && !S.log().includes(secret), okBody);
    const getIn = await fetch(inb.url + '?text=x'); const putIn = await fetch(inb.url, { method: 'PUT', body: 'x' }); const delIn = await fetch(inb.url, { method: 'DELETE' });
    check('entrada: solo POST (GET si se habilitó); nunca se lee ni se borra por ahí', getIn.status === 405 && putIn.status === 405 && delIn.status === 405 && !(await getIn.text()).includes('privado'), [getIn.status, putIn.status, delIn.status]);
    const big = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(65 * 1024 + 10) }).then((r) => r.status, () => 413);
    const bigJson = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ text: 'y'.repeat(70 * 1024) }) }).then((r) => r.status, () => 413);
    check('entrada: tope de tamaño', big === 413 && bigJson === 413 && !(await call('GET', '/notes/' + enc('buzon.md'), undefined, A.s)).json.text.includes('xxxx'), [big, bigJson]);
    const weird = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ text: 'vault1:AAAA', title: '../../etc/passwd' }) });
    const tr = (await call('POST', '/automations/inboxes', { kind: 'create', path: 'entradas' }, A.s)).json;
    await fetch(tr.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ title: '../../fuera/../x', text: 'cuerpo' }) }); await fetch(tr.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ title: 'CON\u0000trol/barra\\otra', text: 'cuerpo' }) });
    const where = (await call('GET', '/notes', undefined, A.s)).json.map((n) => n.path);
    check('entrada: el título no saca la nota de su carpeta', weird.status === 200 && where.filter((p) => p.startsWith('entradas/')).length === 2 && where.every((p) => !p.includes('..') && !p.startsWith('fuera') && !p.startsWith('etc')), where);
    const ipBad = nextIp(); const tries = [];
    for (let i = 0; i < 34; i++) tries.push((await fetch(S.base + '/in/mdi_' + String(i).padStart(3, '0') + 'x'.repeat(40), { method: 'POST', headers: { 'content-type': 'text/plain', ...from(ipBad) }, body: 'x' })).status);
    const blocked = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain', ...from(ipBad) }, body: 'x' });
    check('entrada: probar secretos al azar tiene tope por IP', tries.slice(0, 30).every((s) => s === 404) && tries.slice(30).every((s) => s === 429) && blocked.status === 429 && (await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain', ...from(nextIp()) }, body: 'sigo' })).status === 200, tries.slice(26));
    const flood = []; for (let i = 0; i < 64; i++) flood.push((await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain', ...from(nextIp()) }, body: 'n' + i })).status);
    check('entrada: tope de pedidos por dirección', flood.filter((s) => s === 200).length <= 60 && flood[flood.length - 1] === 429, flood.slice(-4));
    await call('POST', '/admin/plan', { email: A.email, plan: 'free' }, undefined, { 'x-admin-key': ADMIN });
    const down = await fetch(tr.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }); const apiDown = await call('GET', '/api/v1/notes', undefined, tokA);
    check('al bajar del plan pago, las entradas y la API dejan de responder', down.status === 402 && apiDown.status === 402, [down.status, apiDown.status]);
    await makePro(S, A.email);
    check('automatizaciones: sin errores del servidor y sin secretos en su salida', !/error 500|error no capturado|promesa sin atender/.test(S.log()) && S.alive() && !made.some((m) => S.log().includes(m.secret)) && !S.log().includes(tokA), (S.log().match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('automatizaciones: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-1500)); }
  await S.stop();

  // --- Con WEBHOOK_ALLOW_PRIVATE=1, contra el receptor local: firma, repetición, cabeceras y lo que viaja ---
  const T = await boot({ ADMIN_KEY: ADMIN, AUTH_PER_IP: '200', WEBHOOK_ALLOW_PRIVATE: '1', WEBHOOK_UPDATE_WAIT_MS: '50', MAIL_WEBHOOK: SINK + '/mail', WEBHOOK_RETRY_MS: '100' });
  try {
    const { call } = T;
    const A = await signup(T, 'ana.duenia+equipo@ejemplo.test'); const M = await signup(T, 'marcos.perez@ejemplo.test');
    await call('POST', '/admin/team', { email: A.email, seats: 4 }, undefined, { 'x-admin-key': ADMIN });
    await call('POST', '/team/invite', { email: M.email }, A.s);
    const inv = (await call('GET', '/account', undefined, M.s)).json.team.invites[0]; await call('POST', '/team/accept', { id: inv.id }, M.s);
    const space = (await call('GET', '/account', undefined, A.s)).json.team.mine.space;
    const R = await signup(T, 'rita.lectora@ejemplo.test'); await call('POST', '/team/invite', { email: R.email }, A.s);
    await call('POST', '/team/accept', { id: (await call('GET', '/account', undefined, R.s)).json.team.invites[0].id }, R.s); await call('POST', '/team/role', { id: R.id, role: 'reader' }, A.s);
    const tryAuto = async (who) => [await call('POST', '/automations/hooks', { o: space, url: SINK + '/t', events: ['note.created'] }, who.s), await call('GET', '/automations?o=' + space, undefined, who.s), await call('POST', '/automations/inboxes', { o: space, kind: 'append', path: 'x.md' }, who.s)];
    const member = await tryAuto(M); const reader = await tryAuto(R);
    check('equipo: con la política de automatizaciones apagada (así nace), un miembro no las crea ni las ve sobre el espacio', member.every((r) => r.status === 403 && r.json.error === 'team_policy') && reader.every((r) => r.status === 403), member.map((r) => r.status + ' ' + r.json.error));
    const mine = (await call('POST', '/automations/hooks', { url: SINK + '/own', events: ['note.created', 'note.updated', 'card.moved'], include_text: true }, A.s)).json;
    const team = (await call('POST', '/automations/hooks', { o: space, url: SINK + '/team', events: ['note.created', 'card.moved', 'note.deleted'], scope: { kind: 'folder', path: 'ventas' } }, A.s)).json;
    got.length = 0;
    await call('PUT', '/notes/' + enc('ventas/tablero.md') + '?o=' + space, { text: '```kanban\n## A\n- [ ] Uno {id=aaaaaaaa}\n\n## B\n```\n' }, M.s);
    await call('PUT', '/notes/' + enc('ventas/tablero.md') + '?o=' + space, { text: '```kanban\n## A\n\n## B\n- [ ] Uno {id=aaaaaaaa}\n```\n' }, M.s);
    await call('PUT', '/notes/' + enc('otra/afuera.md') + '?o=' + space, { text: '# Afuera\n' }, M.s);
    await call('PUT', '/notes/' + enc('propia.md'), { text: '# Propia\n\nCuerpo propio.\n' }, A.s);
    const mv = await until(() => got.find((g) => g.url === '/team' && g.json.type === 'card.moved')); await until(() => got.find((g) => g.url === '/own')); await sleep(300);
    const teamGot = got.filter((g) => g.url === '/team'); const ownGot = got.filter((g) => g.url === '/own');
    check('equipo: lo que hace un miembro en el espacio sale con un id opaco y su papel, sin nombre ni correo', !!mv && mv.json.actor.type === 'member' && /^mem_[0-9a-f]{16}$/.test(mv.json.actor.id) && mv.json.actor.role === 'editor' && !('name' in mv.json.actor) && mv.json.actor.via === 'app' && mv.json.note.path === '@team/ventas/tablero.md' && mv.json.note.space === 'team' && /~\d+%2Fventas/.test(mv.json.note.url), mv && mv.json);
    const everything = got.filter((g) => g.url !== '/mail').map((g) => g.raw + J(g.headers)).join('\n');
    check('ninguna carga ni cabecera lleva un correo, el número interno de la cuenta, la sesión ni un token', !/@ejemplo\.test|ejemplo\.test|ana\.duenia|marcos|perez|rita/.test(everything) && !everything.includes(A.s) && !everything.includes(M.s) && !/"account":\s*\d/.test(everything) && got.filter((g) => g.url !== '/mail').every((g) => /^acc_[0-9a-f]{20}$/.test(g.json.account) && !g.headers.authorization && !g.headers.cookie && !g.headers['x-forwarded-for']), everything.slice(0, 400));
    check('cada cuenta tiene su id opaco, y el del espacio del equipo es otro', new Set(teamGot.map((g) => g.json.account)).size === 1 && new Set(ownGot.map((g) => g.json.account)).size === 1 && teamGot[0].json.account !== ownGot[0].json.account);
    check('el ámbito se respeta: lo de afuera de la carpeta no sale, y lo propio no va al webhook del equipo', teamGot.every((g) => g.json.note.path.startsWith('@team/ventas/')) && ownGot.every((g) => g.json.note.path === 'propia.md') && ownGot.length >= 1, [teamGot.map((g) => g.json.note.path), ownGot.map((g) => g.json.note.path)]);
    const g0 = ownGot[0];
    const sigOf = (g, secret, t) => { const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(g.headers['x-sharpmd-signature']); return !!m && createHmac('sha256', secret).update((t || m[1]) + '.' + g.raw).digest('hex') === m[2]; };
    const tOf = (g) => +/^t=(\d+)/.exec(g.headers['x-sharpmd-signature'])[1];
    check('firma: HMAC-SHA-256 del cuerpo con el secreto de ese webhook y la marca de tiempo', sigOf(g0, mine.secret) && !sigOf(g0, team.secret) && !sigOf(g0, 'whsec_x') && !sigOf(Object.assign({}, g0, { raw: g0.raw.replace('propia', 'Propia') }), mine.secret) && sigOf(teamGot[0], team.secret));
    check('repetición: la marca de tiempo es de ahora y está dentro de lo firmado (cambiarla rompe la firma)', Math.abs(Date.now() / 1000 - tOf(g0)) < 30 && !sigOf(g0, mine.secret, String(tOf(g0) + 600)) && /^evt_/.test(g0.headers['x-sharpmd-delivery']));
    check('el contenido viaja solo donde se pidió', ownGot.some((g) => g.json.data.text === '# Propia\n\nCuerpo propio.\n') && teamGot.every((g) => g.json.data.text === undefined));
    // --- Lo nuevo del equipo: papeles, políticas, registro de actividad, tokens del equipo y espacio protegido ---
    const logOf = async () => (await call('GET', '/team/log', undefined, A.s)).json.entries;
    const teamNote = async (p) => (await call('GET', '/notes/' + enc(p) + '?o=' + space, undefined, A.s)).json;
    await call('PUT', '/team/policies', { automation: true }, A.s);
    const mIn = await call('POST', '/automations/inboxes', { o: space, name: 'Formulario', kind: 'append', path: 'ventas/buzon.md' }, M.s);
    const mHook = await call('POST', '/automations/hooks', { o: space, url: SINK + '/mh', events: ['note.created'], scope: { kind: 'folder', path: 'ventas' } }, M.s);
    const rStill = await tryAuto(R);
    check('equipo: con la política prendida un editor crea automatizaciones sobre el espacio; un lector sigue sin poder', mIn.status === 200 && mHook.status === 200 && rStill.every((r) => r.status === 403), [mIn.status, mHook.status, rStill.map((r) => r.status)]);
    const inOk = await fetch(mIn.json.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'pedido 1' });
    await until(() => got.find((g) => g.url === '/mh'));
    let log = await logOf();
    check('equipo: lo que entra por una dirección de entrada queda en el registro, con el nombre de la entrada', inOk.status === 200 && (await teamNote('ventas/buzon.md')).text === 'pedido 1\n' && log.some((e) => e.action === 'create' && e.path === 'ventas/buzon.md' && e.token === 'Inbound: Formulario') && log.filter((e) => e.action === 'automation').length >= 3 && !JSON.stringify(log).includes('pedido 1'), log.slice(0, 4));
    // El papel manda sobre lo ya creado: con quien la creó pasado a lector, su entrada no escribe y su webhook no sale.
    await call('POST', '/team/role', { id: M.id, role: 'reader' }, A.s);
    const before = got.filter((g) => g.url === '/mh').length;
    const inRo = await fetch(mIn.json.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'pedido 2' });
    await call('PUT', '/notes/' + enc('ventas/otra.md') + '?o=' + space, { text: '# Otra\n' }, A.s); await sleep(500);
    check('equipo: un lector no escribe por ninguna vía: su entrada deja de escribir y su webhook deja de salir', inRo.status === 403 && (await teamNote('ventas/buzon.md')).text === 'pedido 1\n' && got.filter((g) => g.url === '/mh').length === before && got.some((g) => g.url === '/team' && g.json.note.path === '@team/ventas/otra.md'), [inRo.status, before]);
    const tokR = (await call('POST', '/tokens', { name: 'IA de Rita' }, R.s)).json.token; secrets.push(tokR);
    const ro = [await call('PUT', '/api/v1/note', { path: '@team/ventas/de-rita.md', text: 'x' }, tokR), await call('POST', '/api/v1/note/append', { path: '@team/ventas/tablero.md', text: 'x' }, tokR), await call('DELETE', '/api/v1/note?path=' + enc('@team/ventas/tablero.md'), undefined, tokR),
      await call('POST', '/api/v1/note/move', { from: '@team/ventas/tablero.md', to: '@team/ventas/t2.md' }, tokR), await call('POST', '/api/v1/boards/cards', { path: '@team/ventas/tablero.md', title: 'x' }, tokR), await call('POST', '/api/v1/boards/cards/aaaaaaaa/move', { path: '@team/ventas/tablero.md', column: 'A' }, tokR),
      await call('POST', '/api/v1/boards/cards/aaaaaaaa/done', { path: '@team/ventas/tablero.md' }, tokR), await call('DELETE', '/api/v1/boards/cards/aaaaaaaa?path=' + enc('@team/ventas/tablero.md'), undefined, tokR)];
    const roRead = await call('GET', '/api/v1/boards?path=' + enc('@team/ventas/tablero.md'), undefined, tokR);
    check('API: con el token de un lector se lee el espacio del equipo, y nada lo cambia (notas ni tableros)', ro.every((r) => r.status === 403 && r.json.error.code === 'read_only') && roRead.status === 200 && roRead.json.data.boards[0].columns[1].cards[0].id === 'aaaaaaaa' && (await teamNote('ventas/tablero.md')).text.includes('## B\n- [ ] Uno {id=aaaaaaaa}'), ro.map((r) => r.status + ' ' + (r.json.error && r.json.error.code)));
    await call('PUT', '/team/policies', { tokens: false }, A.s);
    await call('POST', '/team/role', { id: M.id, role: 'editor' }, A.s); const tokM = (await call('POST', '/tokens', { name: 'IA de Marcos' }, M.s)).json.token; secrets.push(tokM);
    const barredApi = [await call('GET', '/api/v1/note?path=' + enc('@team/ventas/tablero.md'), undefined, tokM), await call('POST', '/api/v1/boards/cards', { path: '@team/ventas/tablero.md', title: 'x' }, tokM)];
    check('API: si el equipo no deja que la IA de los miembros entre al espacio, su token tampoco entra por la API', barredApi.every((r) => r.status === 403 && r.json.error.code === 'team_policy') && !JSON.stringify((await call('GET', '/api/v1/notes', undefined, tokM)).json.data).includes('@team'), barredApi.map((r) => r.status));
    await call('PUT', '/team/policies', { tokens: true }, A.s);
    // Tokens del equipo: sirven en la API como los personales, con el espacio como raíz.
    const tt = (await call('POST', '/team/tokens', { name: 'Flujo de ventas', write: true }, A.s)).json; const ttRo = (await call('POST', '/team/tokens', { name: 'Tablero en la tele', folder: 'ventas' }, A.s)).json; secrets.push(tt.token, ttRo.token);
    const ttList = await call('GET', '/api/v1/notes', undefined, tt.token); const ttMe = await call('GET', '/api/v1/me', undefined, tt.token);
    got.length = 0;
    const ttMove = await call('POST', '/api/v1/boards/cards/aaaaaaaa/move', { path: 'ventas/tablero.md', column: 'A' }, tt.token);
    const viaTt = await until(() => got.find((g) => g.url === '/team' && g.json.type === 'card.moved'));
    log = await logOf();
    check('API: un token del equipo ve el espacio como raíz, mueve una tarjeta, y eso dispara el evento y queda en el registro con su nombre', ttList.status === 200 && ttList.json.data.some((n) => n.path === 'ventas/tablero.md') && !JSON.stringify(ttList.json).includes('@team') && ttMe.json.data.team_token === true && ttMove.status === 200 && ttMove.json.data.card.column === 'A' && /~\d+%2Fventas%2Ftablero\.md$/.test(ttMove.json.data.url)
      && !!viaTt && viaTt.json.actor.type === 'api' && viaTt.json.data.to === 'A' && log.some((e) => e.via === 'team' && e.token === 'Flujo de ventas' && e.action === 'edit' && e.path === 'ventas/tablero.md'), [ttList.json, ttMove.json, viaTt && viaTt.json.actor, log.slice(0, 3)]);
    const ttNo = [await call('PUT', '/api/v1/note', { path: 'ventas/nueva.md', text: 'x' }, ttRo.token), await call('POST', '/api/v1/boards/cards', { path: 'ventas/tablero.md', title: 'x' }, ttRo.token), await call('GET', '/api/v1/note?path=' + enc('otra/afuera.md'), undefined, ttRo.token), await call('POST', '/api/v1/links', { path: 'ventas/tablero.md' }, tt.token), await call('GET', '/automations?o=' + space, undefined, tt.token)];
    check('API: un token del equipo de solo lectura no escribe, uno limitado a una carpeta no sale de ella, y ninguno comparte sin ese permiso ni maneja automatizaciones', ttNo[0].status === 403 && ttNo[0].json.error.code === 'read_only' && ttNo[1].status === 403 && ttNo[2].status === 403 && ttNo[2].json.error.code === 'out_of_scope' && ttNo[3].status === 403 && ttNo[4].status === 401 && (await call('GET', '/api/v1/boards?path=' + enc('ventas/tablero.md'), undefined, ttRo.token)).status === 200, ttNo.map((r) => r.status));
    // Un espacio protegido con contraseña: ningún evento, ninguna entrada, ninguna escritura en claro.
    const V = await signup(T, 'vera@ejemplo.test'); await call('POST', '/admin/team', { email: V.email, seats: 2 }, undefined, { 'x-admin-key': ADMIN });
    const vs = (await call('GET', '/account', undefined, V.s)).json.team.mine.space;
    await call('PUT', '/notes/' + enc('plan.md') + '?o=' + vs, { text: '# Plan\n' }, V.s);
    const vHook = (await call('POST', '/automations/hooks', { o: vs, url: SINK + '/vault', events: ['note.created', 'note.updated', 'note.deleted', 'note.moved', 'card.created'] }, V.s)).json;
    const vIn = (await call('POST', '/automations/inboxes', { o: vs, kind: 'append', path: 'plan.md' }, V.s)).json; const vIn2 = (await call('POST', '/automations/inboxes', { o: vs, kind: 'create', path: '' }, V.s)).json;
    const vTok = (await call('POST', '/team/tokens', { name: 'Flujo', write: true }, V.s)).json.token; secrets.push(vTok);
    const vb2 = (n) => Buffer.alloc(n, 5).toString('base64');
    const prot = await call('POST', '/team/vault', { salt: vb2(16), iters: 200000, wrapped: vb2(60), check: vb2(32) }, V.s);
    got.length = 0;
    const shut = [await call('POST', '/automations/hooks', { o: vs, url: SINK + '/vault2', events: ['note.created'] }, V.s), await call('POST', '/automations/hooks', { o: vs, url: SINK + '/vault2', events: ['note.created'], scope: { kind: 'note', path: 'plan.md' } }, V.s), await call('POST', '/automations/inboxes', { o: vs, kind: 'append', path: 'plan.md' }, V.s), await call('POST', '/automations/inboxes', { o: vs, kind: 'create', path: '' }, V.s), await call('POST', '/automations/inboxes', { o: vs, kind: 'card', path: 'tablero.md' }, V.s)];
    const clear = [(await fetch(vIn.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'en claro' })).status, (await fetch(vIn2.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Nueva', text: 'en claro' }) })).status,
      (await call('PUT', '/api/v1/note', { path: 'plan.md', text: 'en claro' }, vTok)).status, (await call('POST', '/api/v1/note/append', { path: 'plan.md', text: 'en claro' }, vTok)).status, (await call('GET', '/api/v1/note?path=plan.md', undefined, vTok)).status, (await call('POST', '/api/v1/boards/cards', { path: 'plan.md', title: 'x' }, vTok)).status,
      (await call('PUT', '/notes/' + enc('otra.md') + '?o=' + vs, { text: 'en claro' }, V.s)).status];
    await call('DELETE', '/notes/' + enc('plan.md') + '?o=' + vs, undefined, V.s); await sleep(500);
    const vNotes = (await call('GET', '/notes?o=' + vs, undefined, V.s)).json;
    check('espacio del equipo protegido: no se le pueden crear automatizaciones ni entradas', prot.status === 200 && shut.every((r) => r.status === 409 && r.json.error === 'vault'), [prot.status, shut.map((r) => r.status + ' ' + r.json.error)]);
    check('espacio del equipo protegido: ninguna entrada ni la API escriben en claro, y un token del equipo no lo lee', clear[0] === 409 && clear[1] === 409 && clear[2] === 423 && clear[3] === 423 && clear[4] === 423 && clear[5] === 423 && clear[6] === 409 && !vNotes.some((n) => n.path === 'Nueva.md' || n.path === 'otra.md'), [clear, vNotes]);
    check('espacio del equipo protegido: ningún evento sale, ni con la ruta', got.filter((g) => g.url === '/vault' || g.url === '/vault2').length === 0 && !!vHook.hook, got.filter((g) => g.url.startsWith('/vault')).map((g) => g.json.type));
    // Un miembro que sale deja de poder tocar nada, y borrar la cuenta se lleva sus automatizaciones.
    const inb = (await call('POST', '/automations/inboxes', { kind: 'append', path: 'buzon.md' }, A.s)).json;
    await call('DELETE', '/automations/hooks/' + team.hook.id + '?o=' + space, undefined, A.s);
    await call('POST', '/team/remove', { id: M.id }, A.s); await call('POST', '/team/remove', { id: R.id }, A.s); await call('POST', '/admin/team', { email: A.email, seats: 0 }, undefined, { 'x-admin-key': ADMIN });
    const del = await call('DELETE', '/account', { email: A.email }, A.s, from(nextIp()));
    const gone = await fetch(inb.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    const left = (() => { const db = T.db(); const n = { hooks: db.prepare('SELECT COUNT(*) AS n FROM hooks WHERE user = ?').get(A.id).n, inboxes: db.prepare('SELECT COUNT(*) AS n FROM inboxes WHERE user = ?').get(A.id).n, jobs: db.prepare('SELECT COUNT(*) AS n FROM hook_jobs WHERE hook = ?').get(mine.hook.id).n }; db.close(); return n; })();
    check('eliminar la cuenta se lleva sus webhooks, su cola y sus direcciones de entrada', del.status === 200 && gone.status === 404 && left.hooks === 0 && left.inboxes === 0 && left.jobs === 0, [del.status, del.json, gone.status, left]);
    check('automatizaciones (equipo): sin errores del servidor', !/error 500|error no capturado|promesa sin atender/.test(T.log()) && T.alive(), (T.log().match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('automatizaciones (equipo): sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(T.log().slice(-1500)); }
  await T.stop(); sink.close(); trap.close();
}
if (!ONLY || ONLY === 'auto') await automationSuite();

// ---------- Sitios publicados: el host aparte, sus rutas de gestión y lo que se guarda ----------
// El host de sitios es el mismo servidor pedido con otra cabecera Host. Se comprueba que por ahí no exista nada de la
// API, que por el host de siempre no se sirva ningún sitio, que una dirección con trucos no llegue a nada, que cada
// ruta de gestión mire de quién es el sitio, y que el HTML que se guarda salga de la lista blanca del servidor.
async function sitesSuite() {
  console.log('\nSitios publicados');
  const S = await boot({ ADMIN_KEY: ADMIN, FEEDBACK_TO: 'duenio@ejemplo.test', PAGES_URL: 'http://pages.localhost:' + (portSeq + 1) });
  const { call } = S; const PH = 'pages.localhost:' + S.port; const PAGES = 'http://' + PH;
  const raw = (host, p, opt) => new Promise((resolve, reject) => {
    // Una cabecera que Node no deja armar tampoco llega: cuenta como un pedido que no entró.
    try {
      const r = http.request({ host: '127.0.0.1', port: S.port, path: p, method: (opt && opt.method) || 'GET', headers: Object.assign({ host }, (opt && opt.headers) || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
      r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); if (opt && opt.body) r.write(opt.body); r.end();
    } catch (e) { resolve({ status: 0, headers: {}, body: '' }); }
  });
  // Una línea de pedido escrita a mano, para direcciones que un cliente normal arreglaría antes de mandar.
  const wire = (line, host) => new Promise((resolve) => { const sock = net.connect(S.port, '127.0.0.1', () => sock.write(line + '\r\nHost: ' + host + '\r\nConnection: close\r\n\r\n')); let b = ''; sock.on('data', (c) => { b += c; }); sock.on('end', () => resolve(b)); sock.on('error', () => resolve(b)); setTimeout(() => { sock.destroy(); resolve(b); }, 3000); });
  try {
    const A = await signup(S, 'ana-sitio@ejemplo.test'); const B = await signup(S, 'beto-sitio@ejemplo.test'); await makePro(S, A.email); await makePro(S, B.email);
    await call('PUT', '/notes/' + enc('docs/index.md'), { text: '# Inicio\n\nSECRETO-PUBLICADO' }, A.s);
    await call('PUT', '/notes/' + enc('docs/otra.md'), { text: '# Otra' }, A.s);
    await call('PUT', '/notes/' + enc('privado/diario.md'), { text: '# Diario\n\nSECRETO-PRIVADO' }, A.s);
    const site = (await call('POST', '/sites', { folder: 'docs', slug: 'docs-ana', title: 'Docs de Ana' }, A.s)).json;
    const putPage = (html, note, who) => call('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: note || 'docs/index.md', rev: 1, html }] }, (who || A).s);
    await putPage('<h1>Inicio</h1><p>SECRETO-PUBLICADO</p>'); await call('POST', '/sites/' + site.id + '/publish', {}, A.s);
    const tok = (await call('POST', '/tokens', { name: 'ia' }, A.s)).json.token; secrets.push(tok);

    // ---------- Aislamiento por Host ----------
    const auth = { authorization: 'Bearer ' + A.s }; const j = { 'content-type': 'application/json' };
    const apiPaths = ['/health', '/account', '/notes', '/notes/' + enc('docs/index.md'), '/search?q=secreto', '/sites', '/sites/' + site.id, '/tokens', '/trash', '/team', '/shared', '/vaults', '/gallery', '/api/v1/me', '/api/v1/notes', '/api/v1/openapi.json', '/admin/sites', '/admin/gallery', '/events?path=' + enc('docs/index.md'), '/live/events', '/public/abc', '/versions/' + enc('docs/index.md')];
    const viaPages = []; for (const p of apiPaths) viaPages.push(await raw(PH, p, { headers: Object.assign({ 'x-admin-key': ADMIN, origin: 'https://ejemplo.test' }, auth) }));
    check('host de sitios: ninguna ruta de la API existe ahí, ni con la sesión ni con la clave de administración (404 en HTML)', viaPages.every((r) => r.status === 404 && /^text\/html/.test(r.headers['content-type'])) && !viaPages.some((r) => /SECRETO|ana-sitio@|"email"|"session"|"plan"/.test(r.body)), viaPages.map((r) => r.status));
    check('host de sitios: no hay CORS ni se abre a otros orígenes', viaPages.every((r) => !Object.keys(r.headers).some((h) => /^access-control-/.test(h))), Object.keys(viaPages[1].headers));
    const writes = [];
    for (const [m, p, b] of [['POST', '/auth/start', { email: 'x@ejemplo.test' }], ['POST', '/auth/verify', { email: A.email, code: '000000' }], ['PUT', '/notes/' + enc('docs/index.md'), { text: 'pisado' }], ['DELETE', '/notes/' + enc('docs/index.md')], ['POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
      ['POST', '/sites', { folder: 'docs', slug: 'otro-mas', title: 'x' }], ['POST', '/sites/' + site.id + '/unpublish', {}], ['DELETE', '/sites/' + site.id], ['POST', '/admin/sites', { slug: 'docs-ana', action: 'delete' }], ['POST', '/feedback', { text: 'hola desde el otro host' }], ['POST', '/docs-ana/', {}], ['PUT', '/_/report', {}], ['PATCH', '/api/v1/boards/cards/1', {}], ['OPTIONS', '/notes']])
      writes.push(await raw(PH, p, { method: m, headers: Object.assign({ 'x-admin-key': ADMIN, authorization: 'Bearer ' + (p === '/mcp' ? tok : A.s) }, j), body: b ? JSON.stringify(b) : undefined }));
    const intact = (await call('GET', '/notes/' + enc('docs/index.md'), undefined, A.s)).json;
    check('host de sitios: no acepta escrituras ni credenciales: todo método que no sea leer responde 405', writes.every((r) => r.status === 405 && r.headers.allow === 'GET, HEAD') && /SECRETO-PUBLICADO/.test(intact.text) && (await raw(PH, '/docs-ana/')).status === 200, writes.map((r) => r.status));
    const viaApi = [await raw('127.0.0.1:' + S.port, '/docs-ana/'), await raw('127.0.0.1:' + S.port, '/docs-ana/', { headers: auth }), await raw('127.0.0.1:' + S.port, '/_/site.js'), await raw('127.0.0.1:' + S.port, '/_/report?s=docs-ana&p='), await raw('127.0.0.1:' + S.port, '/~' + site.preview.split('~')[1]), await raw('sync.ejemplo.test', '/docs-ana/')];
    check('host de siempre: no sirve sitios, ni su script, ni el formulario de denuncia, ni la vista previa', viaApi.every((r) => (r.status === 401 || r.status === 404) && /^application\/json/.test(r.headers['content-type']) && !/SECRETO|<html/i.test(r.body)), viaApi.map((r) => r.status));
    // La cabecera Host falsificada: lo que decide es Host, nunca lo que diga otra cabecera.
    const spoof = [await raw('127.0.0.1:' + S.port, '/docs-ana/', { headers: { 'x-forwarded-host': PH, forwarded: 'host=' + PH, 'x-host': PH, 'x-original-host': PH } }), await raw('evil.' + PH, '/docs-ana/'), await raw(PH + '.evil.test', '/docs-ana/'), await raw('pages.localhost', '/docs-ana/'), await raw('pages.localhost:1', '/docs-ana/'), await raw(PH + '@evil.test', '/docs-ana/'), await raw('x' + PH, '/docs-ana/')];
    check('Host falsificado: x-forwarded-host y parecidos no cuentan, y un nombre que se le parece no es el host de sitios', spoof.every((r) => r.status !== 200 && !/SECRETO/.test(r.body)), spoof.map((r) => r.status));
    const apiSpoof = [await raw(PH, '/account', { headers: Object.assign({ 'x-forwarded-host': '127.0.0.1:' + S.port, forwarded: 'host=127.0.0.1' }, auth) }), await raw(PH.toUpperCase(), '/account', { headers: auth })];
    const upper = await raw(PH.toUpperCase(), '/docs-ana/');
    check('y al revés: decir por otra cabecera que se viene por el host de la API no abre la API en el host de sitios', apiSpoof.every((r) => r.status === 404 && !/ana-sitio@/.test(r.body)) && upper.status === 200, [apiSpoof.map((r) => r.status), upper.status]);
    // Con dos cabeceras Host vale la primera. Llegar por el host de sitios y sumar atrás el de la API no abre la API.
    const twoHosts = await wire('GET /account HTTP/1.1\r\nHost: ' + PH + '\r\nAuthorization: Bearer ' + A.s, '127.0.0.1:' + S.port);
    check('dos cabeceras Host en un pedido: agregar la de la API atrás de la de sitios no abre la API', /^HTTP\/1\.1 (404|400)/.test(twoHosts) && !/ana-sitio@/.test(twoHosts), twoHosts.slice(0, 80));

    // ---------- Direcciones con trucos ----------
    const tricks = ['/docs-ana/../privado/diario', '/docs-ana/..%2f..%2fprivado%2fdiario', '/docs-ana/%2e%2e/%2e%2e/account', '/docs-ana/..;/account', '/docs-ana//index', '/docs-ana/./index', '/docs-ana/index%00', '/docs-ana/index.md', '/docs-ana/privado/diario', '/docs-ana/%69ndex', '/DOCS-ANA/', '/docs-ana%2f', '/docs-ana\\..\\account',
      '/..%2fdocs-ana/', '/%2e%2e/account', '/_/../account', '/_/site.js/../../account', '/_/%2e%2e/health', '/~/', '/~' + 'a'.repeat(24) + '/', '/~../', '/docs-ana/~' + site.preview.split('~')[1], '/' + 'a'.repeat(700) + '/', '/docs-ana/' + 'a/'.repeat(200), '/docs_ana/', '/docs-ana:80/', '/@docs-ana/', '/docs-ana/?f=../../account', '/1/', '/' + site.id + '/'];
    const tricked = []; for (const t of tricks) tricked.push(await wire('GET ' + t + ' HTTP/1.1', PH));
    const okTrick = (r, i) => (/^HTTP\/1\.1 (404|400|308)/.test(r) || (tricks[i] === '/docs-ana/?f=../../account' && /^HTTP\/1\.1 200/.test(r))) && !/SECRETO-PRIVADO|ana-sitio@|"session"/.test(r);
    check('direcciones con "..", barras codificadas, nulos, mayúsculas o prefijos raros no llegan a ninguna nota ni a la API', tricked.every(okTrick), tricked.map((r, i) => [tricks[i].slice(0, 40), r.slice(9, 12)]).filter((x, i) => !okTrick(tricked[i], i)));
    await call('PUT', '/notes/' + enc('docs/index.md'), { text: '# De Beto' }, B.s);
    const slugTricks = ['../docs-ana', 'docs-ana/../x', 'docs%2fana', '_', '~abc', 'a..b', 'a b', 'docs-ana\u0000', 'docs-ana\n', '.well-known', 'xn--', '-ab', 'ab-'];
    const slugged = []; for (const s of slugTricks) slugged.push((await call('POST', '/sites', { folder: 'docs', slug: s, title: 'x' }, B.s)).json.error);
    check('un slug con trucos de ruta no se acepta al crear', slugged.every((e, i) => e === (slugTricks[i] === 'docs-ana\n' ? 'slug_taken' : 'bad_slug')), slugged);

    // ---------- Quién puede qué en las rutas de gestión ----------
    const F = await signup(S, 'fran-sitio@ejemplo.test');
    const ops = (s) => Promise.all([call('GET', '/sites/' + site.id, undefined, s), call('PUT', '/sites/' + site.id, { title: 'Tomado' }, s), call('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: 'docs/index.md', rev: 1, html: '<p>tomado</p>' }] }, s), call('POST', '/sites/' + site.id + '/publish', {}, s), call('POST', '/sites/' + site.id + '/unpublish', {}, s), call('DELETE', '/sites/' + site.id, undefined, s)]);
    const asB = await ops(B.s); const asF = await ops(F.s); const asNone = await ops(undefined); const asTok = await ops(tok);
    check('gestión: otra cuenta (paga o gratis) recibe 404 en cada ruta del sitio, y sin sesión o con un token de IA, 401', asB.every((r) => r.status === 404) && asF.every((r) => r.status === 404) && asNone.every((r) => r.status === 401) && asTok.every((r) => r.status === 401) && /SECRETO-PUBLICADO/.test((await raw(PH, '/docs-ana/')).body), [asB.map((r) => r.status), asNone.map((r) => r.status), asTok.map((r) => r.status)]);
    const cross = [await putPage('<p>x</p>', 'privado/diario.md'), await putPage('<p>x</p>', 'docs/../privado/diario.md'), await putPage('<p>x</p>', '/etc/passwd'), await putPage('<p>x</p>', 'docs/index.md\u0000.md'), await call('PUT', '/sites/' + site.id, { home: 'privado/diario.md' }, A.s), await call('PUT', '/sites/' + site.id + '/pages', { pages: 'x' }, A.s), await call('PUT', '/sites/' + site.id + '/pages', { pages: [null] }, A.s), await call('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: 'docs/index.md', rev: 1, html: 7 }] }, A.s), await call('PUT', '/sites/' + site.id + '/pages', { pages: [{ note: 'docs/index.md', rev: -1, html: '' }] }, A.s)];
    check('gestión: ni el dueño publica una nota de afuera de la carpeta, ni elige una portada de afuera, ni manda páginas mal armadas', cross.every((r) => r.status === 400) && !/SECRETO-PRIVADO/.test((await raw(PH, '/docs-ana/search.json')).body), cross.map((r) => [r.status, r.json && r.json.error]));
    const o = [await call('POST', '/sites', { o: A.id, folder: 'docs', slug: 'de-otro', title: 'x' }, B.s), await call('POST', '/sites', { o: 999999, folder: 'docs', slug: 'de-otro', title: 'x' }, B.s), await call('POST', '/sites', { o: '1 OR 1=1', folder: 'docs', slug: 'de-otro', title: 'x' }, B.s)];
    check('gestión: nadie crea un sitio sobre las notas de otra cuenta con "o"', o.every((r) => r.status === 403 && r.json.error === 'no_access'), o.map((r) => [r.status, r.json]));
    const adm = [await call('GET', '/admin/sites'), await call('GET', '/admin/sites', undefined, A.s), await call('POST', '/admin/sites', { slug: 'docs-ana', action: 'delete' }, A.s, { 'x-admin-key': 'x' }), await call('POST', '/admin/sites', { slug: 'docs-ana', action: 'suspend' }, undefined, { 'x-admin-key': '' })];
    const admBad = [await call('POST', '/admin/sites', { slug: 'docs-ana', action: 'explotar' }, undefined, { 'x-admin-key': ADMIN }), await call('POST', '/admin/sites', { slug: 'no-esta', action: 'suspend' }, undefined, { 'x-admin-key': ADMIN })];
    check('administración: sin la clave, 403; con la clave, una acción desconocida o un sitio que no existe no hacen nada', adm.every((r) => r.status === 403) && admBad[0].status === 400 && admBad[1].status === 404 && (await raw(PH, '/docs-ana/')).status === 200, [adm.map((r) => r.status), admBad.map((r) => r.status)]);
    const conf = (await call('PUT', '/sites/' + site.id, { title: '<script>alert(1)</script>"><img src=x onerror=alert(2)>', descr: '"><script>alert(3)</script>', logo: '<svg onload=alert(4)>', author: '</title><script>alert(5)</script>' }, A.s)).json;
    const confPage = (await raw(PH, '/docs-ana/')).body; const head = confPage.slice(0, confPage.indexOf('<article'));
    check('la configuración del sitio (título, descripción, logo, autor) sale siempre como texto', !!conf.title && !/<script>alert|<img src=x|<svg onload/.test(confPage) && /&#60;script&#62;alert\(1\)/.test(head) && (confPage.match(/<script/g) || []).length === 1, head.slice(0, 600));
    const css = [(await call('PUT', '/sites/' + site.id, { accent: '#3b82f6;background:url(https://xss.invalid/a)' }, A.s)).status, (await call('PUT', '/sites/' + site.id, { accent: 'expression(alert(1))' }, A.s)).status, (await call('PUT', '/sites/' + site.id, { font: 'Georgia;}body{display:none' }, A.s)).status, (await call('PUT', '/sites/' + site.id, { font: 'url(https://xss.invalid/f.woff)' }, A.s)).status, (await call('PUT', '/sites/' + site.id, { lang: 'es" onload="x' }, A.s)).status, (await call('PUT', '/sites/' + site.id, { noindex: 'si' }, A.s)).status];
    const sheet = (await raw(PH, '/_/site.css')).body;
    check('el tema sale de listas cerradas: un color, una tipografía o un idioma con CSS o con comillas no pasan, y la hoja no trae url()', css.every((x) => x === 400) && !/url\(|@import|expression\(/i.test(sheet) && !/xss\.invalid/.test((await raw(PH, '/docs-ana/')).body), css);

    // ---------- La lista blanca del servidor ----------
    const P = 'window.__pwn=1'; const served0 = (await raw(PH, '/docs-ana/')).body;
    const HOSTILE = [
      '<script>' + P + '</script>', '<SCRIPT SRC=https://xss.invalid/x.js></SCRIPT>', '<scr<script>ipt>' + P + '</scr</script>ipt>', '<script\n>' + P + '</script\n>', '<script/x>' + P + '</script>',
      '<img src=x onerror="' + P + '">', '<img src="x" OnErRoR=' + P + '>', '<img/src=x/onerror=' + P + '>', '<img src=x onerror\n=' + P + '>', '<img src="https://ok.example/a.png" onload="' + P + '">', '<img src=`x`onerror=' + P + '>', '<img """><script>' + P + '</script>">',
      '<svg onload="' + P + '"><script>' + P + '</script></svg>', '<svg><a xlink:href="javascript:' + P + '"><text>x</text></a></svg>', '<svg><foreignObject><iframe src="javascript:' + P + '"></iframe></foreignObject></svg>', '<svg><style>*{background:url(https://xss.invalid/s)}</style></svg>', '<svg><use href="data:image/svg+xml,<svg id=x xmlns=http://www.w3.org/2000/svg><script>' + P + '</script></svg>#x"/></svg>', '<svg><animate onbegin="' + P + '" attributeName=x dur=1s>', '<svg><set attributeName="href" to="javascript:' + P + '"/></svg>',
      '<math><mtext><table><mglyph><style><img src=x onerror="' + P + '"></style></mglyph></table></mtext></math>', '<math><annotation-xml encoding="text/html"><script>' + P + '</script></annotation-xml></math>', '<math href="javascript:' + P + '">x</math>', '<math><mi xlink:href="javascript:' + P + '">x</mi></math>', '<math><mtext></form><form><mglyph><style></math><img src onerror=' + P + '>',
      '<iframe src="javascript:' + P + '"></iframe>', '<iframe srcdoc="<script>parent.__pwn=1</script>"></iframe>', '<object data="javascript:' + P + '"></object>', '<embed src="javascript:' + P + '">', '<applet code=x></applet>', '<frameset onload=' + P + '><frame src=x></frameset>',
      '<form action="https://xss.invalid/f"><input name=q><button formaction="javascript:' + P + '">x</button></form>', '<input onfocus=' + P + ' autofocus>', '<select onchange=' + P + '><option>1</option></select>', '<textarea onfocus=' + P + ' autofocus></textarea>', '<button onclick=' + P + '>x</button>', '<label for=x onclick=' + P + '>x</label>', '<isindex action="javascript:' + P + '">',
      '<a href="javascript:' + P + '">a</a>', '<a href="JaVaScRiPt:' + P + '">a</a>', '<a href=" javascript:' + P + '">a</a>', '<a href="java\tscript:' + P + '">a</a>', '<a href="java\nscript:' + P + '">a</a>', '<a href="java&#x09;script:' + P + '">a</a>', '<a href="&#106;avascript:' + P + '">a</a>', '<a href="&#x6A;avascript&#58;' + P + '">a</a>', '<a href="javascript&colon;' + P + '">a</a>', '<a href="jav&Tab;ascript:' + P + '">a</a>', '<a href="\u0001javascript:' + P + '">a</a>', '<a href="vbscript:msgbox(1)">a</a>',
      '<a href="data:text/html,<script>' + P + '</script>">a</a>', '<a href="data:text/html;base64,PHNjcmlwdD5wYXJlbnQuX19wd249MTwvc2NyaXB0Pg==">a</a>', '<a href="blob:https://xss.invalid/1">a</a>', '<a href="file:///etc/passwd">a</a>', '<a href="//xss.invalid/x" target="_blank" onclick="' + P + '">a</a>', '<a href="https://user:pass@xss.invalid/">a</a>', '<a href="\\\\xss.invalid\\x">a</a>', '<a href="/\\xss.invalid">a</a>', '<a data-wiki="x&quot; onclick=&quot;' + P + '">w</a>', '<a data-n="javascript:' + P + '" href="#x">n</a>', '<a href="x&quot; onmouseover=&quot;' + P + '">q</a>',
      '<img src="javascript:' + P + '">', '<img src="data:text/html,<script>' + P + '</script>">', '<img src="data:image/svg+xml,<svg xmlns=http://www.w3.org/2000/svg onload=' + P + '>">', '<img src="data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>' + P + '</script></svg>').toString('base64') + '">', '<img src="data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="' + P + '"/>').toString('base64') + '">', '<img src="http://xss.invalid/claro.png">', '<img src="https://xss.invalid/a.png" srcset="https://xss.invalid/b.png 2x" style="background:url(https://xss.invalid/c)">', '<img src="x" alt="&quot;><script>' + P + '</script>">', '<img src="https://ok.example/a.png" alt="\'&quot;><img src=x onerror=' + P + '>">',
      '<style>@import "https://xss.invalid/a.css"; body{background:url(https://xss.invalid/b)}</style>', '<p style="background:url(https://xss.invalid/c);position:fixed;inset:0">p</p>', '<div style="background-image:url(javascript:' + P + ')">d</div>', '<p style="width:expression(' + P + ')">e</p>', '<link rel=stylesheet href=https://xss.invalid/l.css>', '<td style="text-align:center;background:url(https://xss.invalid/t)">t</td>', '<p class="sp-top sp-foot sp-made lmd-x" id="sp-main">disfraz</p>',
      '<base href="https://xss.invalid/">', '<meta http-equiv="refresh" content="0;url=javascript:' + P + '">', '<meta http-equiv="Content-Security-Policy" content="script-src *">', '<title><script>' + P + '</script></title>', '<noscript><p title="</noscript><img src=x onerror=' + P + '>"></noscript>', '<template><script>' + P + '</script></template>', '<xmp><script>' + P + '</script></xmp>', '<plaintext><script>' + P + '</script>', '<listing>&lt;img src=x onerror=' + P + '&gt;</listing>',
      '<svg>'.repeat(40) + '<script>' + P + '</script>' + '</svg>'.repeat(39) + '<img src=x onerror=' + P + '>', '<form><form><input></form><img src=x onerror=' + P + '></form>', '<select><option></select><img src=x onerror=' + P + '></option></select>', '<svg></p><style><a id="</style><img src=x onerror=' + P + '>">', '<table><tr><td><svg><desc><td></desc><img src=x onerror=' + P + '>', '<math><mi><style></mi><img src=x onerror=' + P + '></style></math>', '<math><mtext><mglyph><style><!--</style><img title="--&gt;&lt;img src=x onerror=' + P + '&gt;">',
      '<body onload=' + P + '>', '<html onmouseover=' + P + '>', '<details open ontoggle=' + P + '><summary>s</summary>x</details>', '<video src=x onerror=' + P + '><source src=x onerror=' + P + '></video>', '<audio src=x onerror=' + P + '></audio>', '<marquee onstart=' + P + '>m</marquee>', '<div onpointerover=' + P + ' onanimationstart=' + P + ' onfocusin=' + P + ' tabindex=0 autofocus>d</div>', '<p contenteditable onpaste=' + P + ' onbeforeinput=' + P + '>p</p>', '<a href="#" ping="https://xss.invalid/p">ping</a>', '<p xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:' + P + '">x</p>',
      '<!--><script>' + P + '</script>-->', '<!-- --!><script>' + P + '</script>', '<![CDATA[<script>' + P + '</script>]]>', '<?xml version="1.0"?><script>' + P + '</script>', '<!DOCTYPE html [<!ENTITY x "<script>' + P + '</script>">]>', '<p>&lt;script&gt;' + P + '&lt;/script&gt;</p>', '<p>&#60;img src=x onerror=' + P + '&#62;</p>', '<p title="--><script>' + P + '</script>">t</p>', '<a href="https://ok.example/?q=</a><script>' + P + '</script>">cierra</a>', '<p>sin cerrar <b <script>' + P + '</script>', '<img src="https://ok.example/a.png" alt="sin cerrar',
      '\u0000<scr\u0000ipt>' + P + '</scr\u0000ipt>', '<\u0000script>' + P + '</script>', '<img src=x one\u0000rror=' + P + '>', '<a href="java\u0000script:' + P + '">nulo</a>', '<div id="sp-navt"></div><div id="location"></div><a id="sp-main" name="body"></a><form id="forms" name="cookie"></form>', '<h1 id="x&quot; onclick=&quot;' + P + '">título</h1>', '<h2 id="sp-main">otro</h2>', '<h2 onclick=' + P + '>título con manejador</h2>',
    ];
    // Cada carga va sola en una página: así una que deja algo sin cerrar no esconde a las que siguen.
    const arts = [];
    for (const h of HOSTILE) { const r = await putPage('<div>' + h + '</div><p>fin</p>'); const got = (await raw(PH, '/docs-ana/')).body; arts.push(r.status === 200 ? got.slice(got.indexOf('<article'), got.indexOf('</article>')) : 'NO ENTRÓ ' + r.status); }
    // De cada página, las etiquetas solas (el texto va escapado, así que entre '>' y '<' no hay etiquetas) y sin los valores.
    const bare = arts.map((a) => a.replace(/>[^<]*</g, '><')); const names = bare.map((a) => a.replace(/"[^"]*"/g, '""'));
    const OK_TAGS = new Set('article a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr math semantics mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose merror'.split(' '));
    const OK_ATTRS = new Set(['class', 'href', 'rel', 'src', 'alt', 'loading', 'decoding', 'id', 'title', 'open']);
    const which = (bad) => bad.map((x, i) => (x ? [i, HOSTILE[i].slice(0, 50), arts[i].slice(0, 200)] : null)).filter(Boolean).slice(0, 4);
    const badTag = names.map((a) => (a.match(/<\/?([a-zA-Z][^\s/>]*)/g) || []).some((t) => !OK_TAGS.has(t.replace(/^<\/?/, '').toLowerCase())));
    check('lista blanca: ' + HOSTILE.length + ' cargas hostiles, cada una en su página, y no queda una etiqueta fuera de la lista', arts.every((a) => /^<article/.test(a)) && !badTag.some(Boolean), which(badTag));
    const badAttr = names.map((a) => (a.match(/\s([a-zA-Z_:][^\s=>"]*)(?==""|\s|>)/g) || []).some((t) => !OK_ATTRS.has(t.trim().toLowerCase())));
    check('lista blanca: sin manejadores on*, sin style, srcset, target, ping, name ni data-*: solo atributos de la lista', !badAttr.some(Boolean) && !names.some((a) => /\son[a-z]+\s*=/i.test(a)), which(badAttr));
    const hrefs = bare.map((a) => (a.match(/href="[^"]*"/g) || []).map((h) => h.slice(6, -1))); const srcs = bare.map((a) => (a.match(/src="[^"]*"/g) || []).map((h) => h.slice(5, -1)));
    const badHref = hrefs.map((l) => l.some((h) => !/^(https:\/\/|#|\/docs-ana\/)/.test(h) || /user:pass/.test(h)));
    check('lista blanca: los enlaces que quedan son https, de la misma página o de adentro del sitio; ningún javascript:, data:, blob: ni file:', hrefs.flat().length > 3 && !badHref.some(Boolean), which(badHref));
    const badSrc = srcs.map((l) => l.some((x) => !/^https:\/\//.test(x)));
    check('lista blanca: las imágenes que quedan son https: ninguna data: con script, ninguna http', srcs.flat().length >= 2 && !badSrc.some(Boolean), which(badSrc));
    const badRaw = bare.map((a) => /<!--|<!\[CDATA|<\?|<!doctype/i.test(a) || /url\(|@import|expression\(/i.test(a.replace(/alt="[^"]*"|title="[^"]*"/g, '')));
    check('lista blanca: sin comentarios, CDATA ni instrucciones, y sin CSS con url() en ningún atributo', !badRaw.some(Boolean), which(badRaw));
    const all = arts.join('\n');
    check('lista blanca: los ids no pisan los de la plantilla y las clases sp- del contenido no entran', !/id="sp-|class="[^"]*sp-(top|foot|made)/.test(all) && (served0.match(/id="sp-main"/g) || []).length === 1, (all.match(/id="[^"]*"/g) || []).slice(0, 8));
    check('lo que llegó como texto escapado sigue siendo texto', /&lt;script&gt;window\.__pwn=1&lt;\/script&gt;/.test(all) && /&lt;img src=x onerror=window\.__pwn=1&gt;/.test(all), null);
    check('y todo enlace hacia afuera lleva rel="nofollow ugc noopener"', (all.match(/<a href="https:[^>]*>/g) || []).every((t) => / rel="nofollow ugc noopener"/.test(t)), (all.match(/<a href="https:[^>]*>/g) || []).slice(0, 3));
    // Un cuerpo enorme y enredado no cuelga al servidor.
    const t0 = Date.now();
    const heavy = [await putPage('<div>'.repeat(60000) + 'x'), await putPage('<'.repeat(400000)), await putPage('<a href="' + 'a'.repeat(300000)), await putPage('<img src="data:image/svg+xml;base64,' + Buffer.from('<svg>' + '<'.repeat(200000) + ' onload=1></svg>').toString('base64') + '">'), await putPage(('<b ' + 'x=1 '.repeat(50) + '>').repeat(4000)), await putPage('&'.repeat(300000)), await putPage('<!--'.repeat(100000))];
    check('un cuerpo enredado (anidado, sin cerrar, con miles de "<") se procesa rápido y no rompe nada', heavy.every((r) => r.status === 200) && Date.now() - t0 < 8000 && S.alive() && (await raw(PH, '/docs-ana/')).status === 200, [heavy.map((r) => r.status), Date.now() - t0]);
    const deep = (await raw(PH, '/docs-ana/')).body;
    check('y lo que sale sigue bien armado: la plantilla cierra después del cuerpo', /<\/article>/.test(deep) && /<footer class="sp-foot">/.test(deep.slice(deep.indexOf('</article>'))) && /<\/html>\s*$/.test(deep), deep.slice(-200));

    // ---------- Lo que queda guardado ----------
    const db = S.db(); const rows = db.prepare('SELECT * FROM sites').all(); const dump = JSON.stringify(rows);
    check('en la tabla de sitios no hay correos: de la cuenta se guarda el número', !/@ejemplo\.test/.test(dump) && rows[0].owner === A.id, dump.slice(0, 300));
    await call('POST', '/vaults', { folder: 'docs', salt: Buffer.alloc(16, 3).toString('base64'), iters: 200000, wrapped: Buffer.alloc(60, 3).toString('base64'), check: Buffer.alloc(32, 3).toString('base64') }, A.s);
    const sealed = await raw(PH, '/docs-ana/'); const left = S.db().prepare('SELECT COUNT(*) AS n FROM site_pages WHERE site = ?').get(site.id).n;
    check('proteger la carpeta con contraseña baja el sitio y borra lo que estaba publicado', sealed.status === 410 && left === 0 && !/SECRETO/.test(sealed.body), [sealed.status, left]);
    const delA = await call('DELETE', '/account', { email: B.email }, B.s, from(nextIp()));
    check('sitios: sin errores del servidor', delA.status === 200 && !/error 500|error no capturado|promesa sin atender|sitios: error/.test(S.log()) && S.alive(), (S.log().match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('sitios: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-1500)); }
  await S.stop();
}
if (!ONLY || ONLY === 'sites') await sitesSuite();

// ====================================================================================================================
// Imágenes adjuntas: lo que se sube, cómo se guarda y cómo se sirve
// ====================================================================================================================
async function filesSuite() {
  console.log('\nImágenes adjuntas');
  const zlib = await import('zlib');
  const S = await boot({ ADMIN_KEY: ADMIN, PAGES_URL: 'http://pages.localhost:' + (portSeq + 1), FILES_FREE_MB: '0.3', FILE_MAX_FREE_MB: '0.1', FILE_MAX_PAID_MB: '1', FILES_PAID_MB: '4', AUTH_PER_IP: '500' });
  const { call } = S; const PH = 'pages.localhost:' + S.port;
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, c]); };
  const png = (w, h, fill, seed) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), fill ? chunk('prVt', Buffer.alloc(fill, (seed || 1) & 255)) : Buffer.alloc(0), chunk('IDAT', zlib.deflateSync(Buffer.alloc((Math.min(w, 64) * 3 + 1) * Math.min(h, 64), (seed || 0) & 255))), chunk('IEND', Buffer.alloc(0))]); };
  const up = (s, buf, q, headers, ip) => fetch(S.base + '/files' + (q || ''), { method: 'POST', headers: Object.assign({ authorization: 'Bearer ' + s, 'content-type': 'image/png' }, from(ip || '10.90.0.1'), headers || {}), body: buf }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })).catch((e) => ({ status: 0, json: null, err: String(e) }));
  const get = (p, headers, ip) => fetch(S.base + p, { headers: Object.assign({}, from(ip || '10.90.0.2'), headers || {}), redirect: 'manual' }).then(async (r) => ({ status: r.status, type: r.headers.get('content-type') || '', headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }));
  const raw = (host, p, opt) => new Promise((resolve) => { try { const r = http.request({ host: '127.0.0.1', port: S.port, path: p, method: (opt && opt.method) || 'GET', headers: Object.assign({ host }, (opt && opt.headers) || {}) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }); r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); if (opt && opt.body) r.write(opt.body); r.end(); } catch (e) { resolve({ status: 0, headers: {}, body: '' }); } });
  const wire = (text) => new Promise((resolve) => { const sock = net.connect(S.port, '127.0.0.1', () => sock.write(text)); let b = ''; const t = setTimeout(() => { sock.destroy(); resolve(b || 'sin respuesta'); }, 9000); sock.on('data', (c) => { b += c; }); sock.on('end', () => { clearTimeout(t); resolve(b); }); sock.on('error', () => { clearTimeout(t); resolve(b); }); });
  const tree = () => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(d)) { const at = path.join(d, n); if (fs.statSync(at).isDirectory()) walk(at); else out.push(path.relative(path.join(S.dir, 'files'), at).replace(/\\/g, '/')); } }; walk(path.join(S.dir, 'files')); return out; };
  try {
    const A = await signup(S, 'ana-img@ejemplo.test'); const B = await signup(S, 'beto-img@ejemplo.test'); await makePro(S, A.email);
    const P = 'window.__pwn=1';

    // ---------- Lo que entra: solo imágenes, reconocidas por su contenido ----------
    const html = Buffer.from('<!doctype html><html><body><script>' + P + '</script></body></html>');
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="' + P + '"><script>' + P + '</script></svg>');
    const notImg = [await up(A.s, html), await up(A.s, html, '', { 'content-type': 'image/jpeg' }), await up(A.s, svg, '', { 'content-type': 'image/svg+xml' }), await up(A.s, svg), await up(A.s, Buffer.from('%PDF-1.7\n')), await up(A.s, Buffer.from('MZ\x90\x00')), await up(A.s, Buffer.alloc(0)), await up(A.s, Buffer.from('GIF8'))];
    check('un HTML o un SVG con código, digan lo que digan de sí mismos, no se guardan', notImg.every((r) => r.status === 415 && r.json.error === 'bad_image') && tree().length === 0, notImg.map((r) => [r.status, r.json && r.json.error]));
    // Polyglots: empiezan como una imagen y siguen con otra cosa.
    const gifHtml = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0]), Buffer.from('<html><script>' + P + '</script>', 'latin1'), Buffer.from([0x3b])]);
    const pngHtml = Buffer.concat([png(4, 4), html]);
    const riffLie = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), html]);
    const pngHuge = png(70000, 70000);
    const poly = [await up(A.s, gifHtml, '', { 'content-type': 'text/html' }), await up(A.s, pngHtml, '', { 'content-type': 'text/html; charset=utf-8' })];
    check('un WebP con un tamaño declarado que no es el suyo y un PNG de medidas imposibles se rechazan', (await up(A.s, riffLie)).status === 415 && (await up(A.s, pngHuge)).status === 415, null);
    const served = await Promise.all(poly.map((r) => get(new URL(r.json.url).pathname)));
    check('un archivo que empieza como imagen y sigue con HTML se sirve siempre como imagen, nunca como página', poly.every((r) => r.status === 200) && served[0].type === 'image/gif' && served[1].type === 'image/png' && served.every((r) => r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('content-security-policy') === "default-src 'none'; sandbox" && /^inline; filename="image\.(gif|png)"$/.test(r.headers.get('content-disposition'))), served.map((r) => [r.status, r.type]));
    check('la cabecera content-type de quien sube no decide nada', poly[0].json.type === 'image/gif' && poly[1].json.type === 'image/png' && !served.some((r) => /html|svg|xml|javascript/.test(r.type)), poly.map((r) => r.json.type));
    const every = await call('GET', '/files', undefined, A.s);
    check('ninguna respuesta de una imagen lleva cookies ni credenciales', served.every((r) => !r.headers.get('set-cookie') && !r.headers.get('access-control-allow-credentials') && r.headers.get('access-control-allow-origin') === '*') && every.json.files.every((f) => /^image\/(png|gif|jpeg|webp|avif)$/.test(f.type)), null);

    // ---------- Nombres y rutas: nada del cliente llega al disco ----------
    const named = await up(A.s, png(5, 5, 0, 7), '?name=..%2F..%2Fmdtools.db&path=..%2Fx&id=' + 'a'.repeat(40), { 'content-disposition': 'attachment; filename="../../evil.html"', 'x-file-name': '..\\..\\evil.html' });
    const names = tree();
    check('el archivo se guarda con un nombre propio, bajo files/, sin importar el nombre o la ruta que mande el cliente', named.status === 200 && named.json.id !== 'a'.repeat(40) && names.length === 3 && names.every((n) => /^[0-9a-f]{2}\/[0-9a-f]{40}$/.test(n)) && !fs.existsSync(path.join(S.dir, 'evil.html')) && fs.readdirSync(S.dir).every((n) => /^(mdtools\.db(-wal|-shm)?|files)$/.test(n)), [named.status, names, fs.readdirSync(S.dir)]);
    const idOk = named.json.id;
    const walks = ['/f/..%2F..%2Fmdtools.db', '/f/%2e%2e/%2e%2e/mdtools.db', '/f/' + idOk + '/../../mdtools.db', '/f/' + idOk + '%00.png', '/f/' + idOk + '.png/..', '/f/' + idOk.slice(0, 2) + '/' + idOk, '/f/' + idOk.toUpperCase(), '/f/' + idOk + '.html', '/f/' + idOk + '.svg', '/f/' + idOk + '.png.html', '/f//' + idOk, '/f/tmp/x'];
    const walked = await Promise.all(walks.map((w) => get(w)));
    const wired = [await wire('GET /f/../mdtools.db HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), await wire('GET /f/../../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), await wire('GET /f/..\\..\\mdtools.db HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')];
    check('ninguna dirección armada para salir de la carpeta sirve otra cosa: ni la base, ni un archivo con otra terminación', walked.every((r) => (r.status === 404 || r.status === 401) && !r.body.includes('SQLite format 3') && !/^image/.test(r.type)) && wired.every((t) => /^HTTP\/1\.1 (404|400)/.test(t) && !/SQLite format 3/.test(t)), [walked.map((r) => r.status), wired.map((t) => t.slice(0, 20))]);
    const walkSession = [await call('GET', '/files/..%2F..%2Fmdtools.db/raw', undefined, A.s), await call('DELETE', '/files/..%2F..%2Fmdtools.db', undefined, A.s), await call('DELETE', '/files/' + idOk + '%2F..%2F..', undefined, A.s), await call('GET', '/files/' + idOk + '/raw', undefined, A.s)];
    check('con sesión tampoco: las rutas de adjuntos solo aceptan un identificador', walkSession.every((r) => r.status === 404) && fs.existsSync(path.join(S.dir, 'mdtools.db')) && tree().length === 3, walkSession.map((r) => r.status));
    const methods = await Promise.all(['POST', 'PUT', 'DELETE', 'PATCH'].map((m) => fetch(S.base + '/f/' + idOk, { method: m, headers: from('10.90.0.3'), body: m === 'DELETE' ? undefined : 'x' }).then((r) => r.status)));
    check('por la dirección de una imagen solo se lee', methods.every((s) => s === 405) && (await get('/f/' + idOk)).status === 200, methods);

    // ---------- La dirección es la llave: no se adivina ni se enumera ----------
    const ids = [named.json.id, poly[0].json.id, poly[1].json.id];
    check('cada identificador tiene 160 bits al azar y no se parece a otro', ids.every((i) => /^[0-9a-f]{40}$/.test(i)) && new Set(ids).size === 3 && new Set(ids.map((i) => i.slice(0, 8))).size === 3, ids.map((i) => i.slice(0, 6)));
    const near = idOk.slice(0, 39) + (idOk[39] === '0' ? '1' : '0');
    const guess = [await get('/f/' + near, null, '10.91.0.1'), await get('/f/' + idOk.slice(0, 20), null, '10.91.0.1'), await get('/f/' + 'f'.repeat(40), null, '10.91.0.1'), await get('/f/1', null, '10.91.0.1'), await get('/f/', null, '10.91.0.1')];
    check('un identificador casi igual, uno a medias o uno inventado responden lo mismo: nada', guess.every((r) => r.status === 404 && r.body.length === 0 && r.type === guess[0].type), guess.map((r) => r.status));
    let last = 0; for (let i = 0; i < 70; i++) last = (await get('/f/' + createHash('sha1').update('x' + i).digest('hex'), null, '10.91.0.9')).status;
    const blocked = await get('/f/' + idOk, null, '10.91.0.9'); const otherIp = await get('/f/' + idOk, null, '10.91.0.10');
    check('quien prueba direcciones al azar queda frenado, sin frenar a los demás', last === 429 && blocked.status === 429 && !!blocked.headers.get('retry-after') && otherIp.status === 200, [last, blocked.status, otherIp.status]);
    const noList = [await call('GET', '/files'), await call('GET', '/files', undefined, 'mds_' + 'x'.repeat(40)), await call('GET', '/files?o=' + A.id, undefined, B.s), await call('GET', '/f', undefined, A.s), await call('GET', '/files/' + idOk, undefined, A.s)];
    check('no hay forma de listar las imágenes de otra cuenta, ni sin sesión', noList[0].status === 401 && noList[1].status === 401 && noList[2].status === 403 && noList[3].status === 404 && noList[4].status === 404, noList.map((r) => r.status));
    const cross = [await call('DELETE', '/files/' + idOk, undefined, B.s), await call('DELETE', '/files/' + idOk + '?o=' + A.id, undefined, B.s), await call('GET', '/files/' + idOk + '/raw', undefined, B.s), await up(B.s, png(3, 3), '?o=' + A.id)];
    check('otra cuenta no borra una imagen ajena ni sube al espacio de otro', cross[0].status === 404 && cross[1].status === 403 && cross[2].status === 404 && cross[3].status === 403 && (await get('/f/' + idOk)).status === 200, cross.map((r) => r.status));

    // ---------- El host de sitios no sirve adjuntos ni tiene estas rutas ----------
    const viaPages = [await raw(PH, '/f/' + idOk), await raw(PH, '/f/' + idOk + '.png'), await raw(PH, '/files', { headers: { authorization: 'Bearer ' + A.s } }), await raw(PH, '/files', { method: 'POST', headers: { authorization: 'Bearer ' + A.s, 'content-type': 'image/png' }, body: png(3, 3) }), await raw(PH, '/api/v1/files', { headers: { authorization: 'Bearer ' + A.s } })];
    check('por el host de sitios no sale ninguna imagen adjunta ni se sube nada', viaPages[0].status === 404 && viaPages[1].status === 404 && !/PNG/.test(viaPages[0].body + viaPages[1].body) && viaPages[2].status === 404 && viaPages[3].status === 405 && viaPages[4].status === 404, viaPages.map((r) => r.status));
    const hostTrick = await raw('127.0.0.1:' + S.port, '/f/' + idOk, { headers: { 'x-forwarded-host': PH, forwarded: 'host=' + PH } });
    check('y una imagen no hereda la política del sitio: se carga como recurso, sin credenciales, desde el host de la API', hostTrick.status === 200 && hostTrick.headers['cross-origin-resource-policy'] === 'cross-origin' && !hostTrick.headers['set-cookie'], hostTrick.status);

    // ---------- Tamaño: se corta al pasar el tope, sin juntar el cuerpo en memoria ----------
    const mem0 = process.memoryUsage().rss; void mem0;
    const big = await up(B.s, Buffer.concat([png(4, 4), Buffer.alloc(3 * 1048576, 1)]));
    const lied = await wire('POST /files HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + B.s + '\r\nContent-Type: image/png\r\nContent-Length: 5000000000\r\nConnection: close\r\n\r\n' + png(4, 4).toString('latin1'));
    const chunked = await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: S.port, path: '/files', method: 'POST', headers: { authorization: 'Bearer ' + B.s, 'content-type': 'image/png', 'transfer-encoding': 'chunked' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }); r.on('error', () => resolve({ status: 0, body: '' })); r.write(png(4, 4)); let n = 0; const more = () => { if (n++ < 40 && !r.destroyed) { r.write(Buffer.alloc(16384, 2), () => setTimeout(more, 2)); } else r.end(); }; more(); });
    check('una imagen que pasa el tope se rechaza, también si llega por tramos o anunciando otro tamaño, y no queda nada a medias en el disco', big.status === 413 && big.json.error === 'file_too_large' && /^HTTP\/1\.1 413/.test(lied) && chunked.status === 413 && /file_too_large/.test(chunked.body) && fs.readdirSync(path.join(S.dir, 'files', 'tmp')).length === 0 && S.alive(), [big.status, lied.slice(0, 30), chunked.status, fs.readdirSync(path.join(S.dir, 'files', 'tmp')).length]);
    const stalled = await wire('POST /files HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + B.s + '\r\nContent-Type: image/png\r\nContent-Length: 500000\r\n\r\nabc');
    check('un pedido que anuncia de más y deja de mandar recibe su respuesta sin dejar colgado al servidor', /^HTTP\/1\.1 413/.test(stalled) && S.alive() && (await call('GET', '/health')).status === 200, stalled.slice(0, 40));

    // ---------- Cupos en paralelo ----------
    const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => up(B.s, png(6, 6, 60000, 40 + i))));
    const okB = burst.filter((r) => r.status === 200); const lb = (await call('GET', '/files', undefined, B.s)).json;
    check('veinticuatro subidas a la vez no pasan el cupo entre todas, y lo que hay en el disco es lo que dice la tabla', okB.length >= 1 && okB.length <= 5 && lb.used <= lb.max && lb.count === okB.length && burst.every((r) => r.status === 200 || (r.status === 413 && r.json.error === 'storage_full')) && tree().filter((n) => !n.startsWith('tmp/')).length === 3 + lb.count && fs.readdirSync(path.join(S.dir, 'files', 'tmp')).length === 0, [okB.length, lb.used, lb.max, tree().length]);
    const same = await Promise.all(Array.from({ length: 6 }, () => up(A.s, png(7, 7, 2000, 5))));
    check('la misma imagen subida seis veces a la vez no ocupa seis lugares de más', same.every((r) => r.status === 200) && (await call('GET', '/files', undefined, A.s)).json.count <= 3 + 6 && S.db().prepare('SELECT COUNT(*) AS n FROM files WHERE owner = ?').get(A.id).n === tree().filter((n) => !n.startsWith('tmp/')).length - lb.count, same.map((r) => r.status));

    // ---------- Carpeta protegida: lo cifrado no se lee ni se sirve ----------
    await call('POST', '/vaults', { folder: 'secreta', salt: Buffer.alloc(16, 3).toString('base64'), iters: 200000, wrapped: Buffer.alloc(60, 3).toString('base64'), check: Buffer.alloc(32, 3).toString('base64') }, A.s);
    const { randomBytes, createCipheriv } = await import('crypto');
    const key = randomBytes(32); const iv = randomBytes(12); const plainImg = png(40, 40, 3000, 9); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from('sharpmd image v1'));
    const sealed = Buffer.concat([iv, c.update(Buffer.concat([Buffer.from([1]), plainImg])), c.final(), c.getAuthTag()]);
    const e1 = await up(A.s, sealed, '?enc=1', { 'content-type': 'application/octet-stream' });
    const onDisk = fs.readFileSync(path.join(S.dir, 'files', e1.json.id.slice(0, 2), e1.json.id));
    check('una imagen de una carpeta protegida queda en el disco tal como salió del navegador: cifrada', e1.status === 200 && e1.json.encrypted === true && onDisk.equals(sealed) && !onDisk.includes(Buffer.from('PNG')) && !onDisk.includes(Buffer.from('IHDR')) && !onDisk.includes(plainImg.subarray(8, 40)), [e1.status, onDisk.length]);
    const dbRow = S.db().prepare('SELECT * FROM files WHERE id = ?').get(e1.json.id);
    check('en la base queda marcada como cifrada, sin tipo de imagen ni medidas', dbRow.enc === 1 && dbRow.type === 'application/octet-stream' && dbRow.w === 0 && dbRow.h === 0, dbRow);
    const encGets = await Promise.all(['', '.enc', '.png', '.webp', '.jpg', '.gif', '.avif'].map((x) => get('/f/' + e1.json.id + x, { authorization: 'Bearer ' + A.s })));
    check('y no se sirve por su dirección de ninguna forma, ni con la sesión de su dueña', encGets.every((r) => r.status === 404 && r.body.length === 0), encGets.map((r) => r.status));
    const rawGet = await get('/files/' + e1.json.id + '/raw', { authorization: 'Bearer ' + A.s }); const rawNo = [await get('/files/' + e1.json.id + '/raw'), await get('/files/' + e1.json.id + '/raw', { authorization: 'Bearer ' + B.s }), await get('/files/' + idOk + '/raw', { authorization: 'Bearer ' + A.s })];
    check('sus bytes salen solo con la sesión de la cuenta, cifrados y como un archivo que el navegador no abre', rawGet.status === 200 && rawGet.body.equals(sealed) && rawGet.type === 'application/octet-stream' && /^attachment/.test(rawGet.headers.get('content-disposition')) && rawGet.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(rawGet.headers.get('cache-control')) && rawNo[0].status === 401 && rawNo[1].status === 404 && rawNo[2].status === 404, [rawGet.status, rawNo.map((r) => r.status)]);
    // Un HTML subido "cifrado" tampoco se vuelve una página: solo sale por la ruta con sesión, como archivo.
    const e2 = await up(A.s, Buffer.concat([html, Buffer.alloc(40)]), '?enc=1'); const e2raw = await get('/files/' + e2.json.id + '/raw', { authorization: 'Bearer ' + A.s });
    check('lo que entra como cifrado nunca se sirve como página, sea lo que sea', e2.status === 200 && (await get('/f/' + e2.json.id)).status === 404 && e2raw.type === 'application/octet-stream' && e2raw.headers.get('content-security-policy') === "default-src 'none'; sandbox", [e2.status, e2raw.type]);
    check('una cuenta sin carpetas protegidas no puede subir bytes sin revisar', (await up(B.s, sealed, '?enc=1')).status === 409, null);
    // El espacio de un equipo protegido no acepta imágenes en claro.
    await call('POST', '/admin/team', { email: A.email, seats: 3 }, undefined, { 'x-admin-key': ADMIN });
    const space = (await call('GET', '/team', undefined, A.s)).json.mine.space;
    const tv = await call('POST', '/team/vault', { salt: Buffer.alloc(16, 4).toString('base64'), iters: 200000, wrapped: Buffer.alloc(60, 4).toString('base64'), check: Buffer.alloc(32, 4).toString('base64') }, A.s);
    const teamPlain = await up(A.s, png(9, 9, 0, 61), '?o=' + space); const teamEnc = await up(A.s, sealed, '?o=' + space + '&enc=1');
    check('un espacio de equipo protegido solo recibe imágenes cifradas', tv.status === 200 && teamPlain.status === 409 && teamPlain.json.error === 'vault' && teamEnc.status === 200 && (await get('/f/' + teamEnc.json.id)).status === 404, [tv.status, teamPlain.status, teamEnc.status]);

    // ---------- Tokens ----------
    const tok = (await call('POST', '/tokens', { name: 'ia' }, A.s)).json.token; secrets.push(tok);
    const viaTok = [await call('GET', '/files', undefined, tok), await fetch(S.base + '/files', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/png' }, body: png(3, 3) }).then((r) => r.status), await call('GET', '/files/' + e1.json.id + '/raw', undefined, tok), await call('DELETE', '/files/' + idOk, undefined, tok)];
    const teamTok = await fetch(S.base + '/api/v1/files?space=team', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/png' }, body: png(3, 3, 0, 5) }).then(async (r) => [r.status, (await r.json()).error.code]);
    const apiEnc = (await call('GET', '/api/v1/files', undefined, tok)).json;
    check('un token de IA no entra por las rutas de la app, no baja imágenes cifradas, y por la API no sube en claro a un espacio protegido', viaTok[0].status === 401 && viaTok[1] === 401 && viaTok[2].status === 401 && viaTok[3].status === 401 && teamTok[0] === 409 && teamTok[1] === 'vault' && apiEnc.ok && apiEnc.data.files.filter((f) => f.encrypted).every((f) => /\.enc$/.test(f.url)), [viaTok.map((r) => r.status || r), teamTok]);
    const freeTok = await fetch(S.base + '/api/v1/files', { method: 'POST', headers: { authorization: 'Bearer mdt_' + 'x'.repeat(40), 'content-type': 'image/png' }, body: png(3, 3) }).then((r) => r.status);
    check('la API de adjuntos pide un token válido', freeTok === 401, freeTok);

    // ---------- Al eliminar la cuenta ----------
    const urls = (await call('GET', '/files', undefined, B.s)).json.files.map((f) => f.url);
    const delB = await call('DELETE', '/account', { email: B.email }, B.s, from(nextIp()));
    const after = await Promise.all(urls.map((u) => get(new URL(u).pathname, null, '10.92.0.1')));
    check('eliminar la cuenta borra sus imágenes: del disco, de la tabla y de sus direcciones', delB.status === 200 && urls.length >= 1 && after.every((r) => r.status === 404) && S.db().prepare('SELECT COUNT(*) AS n FROM files WHERE owner = ?').get(B.id).n === 0, [delB.status, urls.length]);
    const log = S.log();
    check('adjuntos: nada de lo subido ni ninguna sesión aparece en la salida del servidor, y no hubo errores', !/error 500|error no capturado|promesa sin atender/.test(log) && !secrets.some((s) => s && log.includes(s)) && !log.includes(idOk) && S.alive(), (log.match(/error[^\n]*/g) || []).slice(0, 3));
  } catch (e) { check('adjuntos: sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(S.log().slice(-1500)); }
  await S.stop();
}
if (!ONLY || ONLY === 'files') await filesSuite();

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed.length ? 1 : 0);
