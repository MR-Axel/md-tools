// Automatizaciones, de punta a punta contra un servidor local: la API con token (/api/v1), los webhooks salientes
// (contra un receptor local que comprueba la firma), las direcciones de entrada (/in/…), los eventos de tarjeta
// venga el cambio de la app, de la API o del MCP, y la interfaz (Ajustes > API y automatizaciones, el detalle de una
// tarjeta, pantalla chica). La nube de verdad no se toca.
import { rig, tally, sleep, root } from './rig.mjs';
import http from 'http'; import crypto from 'crypto'; import fs from 'fs'; import path from 'path';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);

// ---------- El receptor: anota lo que llega y contesta según la ruta ----------
const got = []; let flaky = 0;
const sink = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const at = req.url.split('?')[0];
    got.push({ url: req.url, at, method: req.method, headers: req.headers, raw, json: (() => { try { return JSON.parse(raw); } catch (e) { return null; } })() });
    if (at === '/fail') { res.writeHead(500); res.end('no'); return; }
    if (at === '/flaky') { flaky++; if (flaky < 3) { res.writeHead(503); res.end('wait'); return; } }
    if (at === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:' + sink.address().port + '/ok' }); res.end(); return; }
    if (at === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 1500); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const SINK = 'http://127.0.0.1:' + sink.address().port;
const at = (p) => got.filter((g) => g.at === p);
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > (ms || 6000)) return v; await sleep(60); } };
const types = (p) => at(p).map((g) => (g.json && g.json.type) || '?');
const signed = (g, secret, maxAge) => {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(g.headers['x-sharpmd-signature'] || ''); if (!m) return false;
  const want = crypto.createHmac('sha256', secret).update(m[1] + '.' + g.raw).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2])) && Math.abs(Date.now() / 1000 - +m[1]) < (maxAge || 300);
};

const R = await rig({ WEBHOOK_ALLOW_PRIVATE: '1', WEBHOOK_RETRY_MS: '150,150', WEBHOOK_UPDATE_WAIT_MS: '150', WEBHOOK_MAX_FAILS: '5', WEBHOOK_TIMEOUT_MS: '700', API_PER_MINUTE: '400' });
const { api, base } = R;
// La API con token: el cuerpo ya leído.
const v1 = (method, p, body, token, extra) => api(method, '/api/v1' + p, body, token, extra);
const mcp = (token, name, args) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) }).then((r) => r.json()).then((r) => r.result);
const post = (url, body, type) => fetch(url, { method: 'POST', headers: type ? { 'content-type': type } : {}, body }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const BOARD = '# Shop\n\n```kanban\n## To do\n- [ ] Fix checkout\n- [ ] Write copy\n\n## Done\n- [x] Pick a name\n```\n';

let bad = 1;
try {
  const ana = await R.signup('ana@ejemplo.test', true); const free = await R.signup('lia@ejemplo.test', false);
  const token = (await api('POST', '/tokens', { name: 'Flow' }, ana.s)).json.token;
  const scoped = (await api('POST', '/tokens', { name: 'Shop', folder: 'shop' }, ana.s)).json.token;
  const noteOf = async (p) => (await api('GET', '/notes/' + encodeURIComponent(p), undefined, ana.s)).json;

  // =====================================================================================================
  console.log('API: entrar');
  let r = await v1('GET', '/me');
  check('sin token: 401 con el formato de la API', r.status === 401 && r.json.ok === false && r.json.error.code === 'no_auth' && !!r.json.error.message, r);
  r = await v1('GET', '/me', undefined, 'mdt_cualquiera');
  check('un token inventado: 401', r.status === 401 && r.json.error.code === 'bad_auth', r);
  r = await v1('GET', '/me', undefined, ana.s);
  check('la sesión de la app no entra a la API', r.status === 401, r);
  r = await v1('GET', '/me', undefined, token);
  check('con token: la cuenta con un id opaco, sin el correo', r.status === 200 && r.json.ok && /^acc_[0-9a-f]{20}$/.test(r.json.data.account) && !J(r.json).includes('ejemplo.test') && r.json.data.scope === null, r.json);
  r = await api('GET', '/api/v1/openapi.json');
  check('la descripción OpenAPI se sirve sin token y apunta a este servidor', r.status === 200 && /^3\.1/.test(r.json.openapi) && r.json.servers[0].url === base && !!r.json.paths['/api/v1/boards'], r.status);
  const pre = await fetch(base + '/api/v1/note', { method: 'OPTIONS', headers: { origin: 'https://hook.make.com', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type' } });
  check('CORS: la API se puede llamar desde cualquier origen, con PATCH y DELETE', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /PATCH/.test(pre.headers.get('access-control-allow-methods')) && /authorization/.test(pre.headers.get('access-control-allow-headers')));
  const preApp = await fetch(base + '/notes', { method: 'OPTIONS', headers: { origin: 'https://hook.make.com' } });
  check('y el resto del servidor sigue cerrado a ese origen', !preApp.headers.get('access-control-allow-origin'));

  console.log('API: notas');
  r = await v1('PUT', '/note', { path: 'shop/board.md', text: BOARD }, token);
  check('crear una nota devuelve su revisión y la dirección para abrirla', r.status === 200 && r.json.data.created === true && r.json.data.rev === 1 && /app\.html\?f=cloud%2Fshop%2Fboard\.md$/.test(r.json.data.url), r.json);
  r = await v1('GET', '/note?path=' + encodeURIComponent('shop/board.md'), undefined, token);
  check('leerla', r.json.data.text === BOARD && r.json.data.rev === 1 && r.json.data.path === 'shop/board.md', r.json);
  r = await v1('PUT', '/note', { path: 'shop/board.md', text: BOARD + '\nMore.\n', rev: 7 }, token);
  check('reemplazar sobre una revisión vieja: 409 sin el texto de la nota', r.status === 409 && r.json.error.code === 'rev_conflict' && r.json.error.rev === 1 && r.json.error.text === undefined, r.json);
  r = await v1('PUT', '/note', { path: 'shop/notes.md', text: '# Notes\n' }, token); await v1('PUT', '/note', { path: 'ideas.md', text: '# Ideas\n\nA checkout idea.\n' }, token);
  r = await v1('POST', '/note/append', { path: 'shop/notes.md', text: 'Second line.' }, token);
  check('agregar al final', r.status === 200 && r.json.data.rev === 2 && (await noteOf('shop/notes.md')).text === '# Notes\n\nSecond line.', r.json);
  r = await v1('GET', '/notes?limit=2', undefined, token);
  const page2 = await v1('GET', '/notes?limit=2&cursor=' + r.json.next_cursor, undefined, token);
  check('listar con páginas', r.json.data.length === 2 && r.json.total === 3 && !!r.json.next_cursor && page2.json.data.length === 1 && page2.json.next_cursor === null, [r.json, page2.json]);
  r = await v1('GET', '/notes?folder=shop', undefined, token);
  check('listar una carpeta', r.json.data.length === 2 && r.json.data.every((n) => n.path.startsWith('shop/')), r.json);
  r = await v1('GET', '/folders', undefined, token);
  check('carpetas', J(r.json.data) === J([{ folder: 'shop', notes: 2 }]), r.json);
  r = await v1('GET', '/search?q=checkout', undefined, token);
  check('buscar', r.json.data.length === 2 && r.json.data.some((x) => x.path === 'ideas.md'), r.json);
  r = await v1('POST', '/note/move', { from: 'ideas.md', to: 'shop/ideas.md' }, token);
  check('mover', r.status === 200 && r.json.data.path === 'shop/ideas.md' && r.json.data.from === 'ideas.md', r.json);
  r = await v1('DELETE', '/note?path=' + encodeURIComponent('shop/ideas.md'), undefined, token);
  const trash = (await api('GET', '/trash', undefined, ana.s)).json;
  check('borrar manda a la papelera', r.json.data.trash === true && trash.length === 1 && trash[0].path === 'shop/ideas.md', [r.json, trash]);
  r = await v1('GET', '/note?path=nada.md', undefined, token);
  check('lo que no existe: 404 con código y mensaje', r.status === 404 && r.json.error.code === 'not_found' && !!r.json.error.message, r.json);
  r = await v1('GET', '/nada', undefined, token);
  check('una ruta que no existe: 404 no_route', r.status === 404 && r.json.error.code === 'no_route', r.json);
  await v1('PUT', '/note', { path: 'private.md', text: '# Private\n' }, token);
  r = await v1('GET', '/note?path=private.md', undefined, scoped);
  const lst = await v1('GET', '/notes', undefined, scoped);
  check('un token de carpeta no sale de su carpeta', r.status === 403 && r.json.error.code === 'out_of_scope' && lst.json.data.every((n) => n.path.startsWith('shop/')), [r.json, lst.json]);
  r = await v1('POST', '/links', { path: 'shop/notes.md' }, token);
  check('un token sin permiso de compartir no crea enlaces', r.status === 403 && r.json.error.code === 'no_share_permission', r.json);
  r = await v1('POST', '/comments', { path: 'shop/notes.md', quote: 'Second line.', text: 'Make it friendlier' }, token);
  const cid = r.json.data && r.json.data.id; const open = await v1('GET', '/comments', undefined, token);
  r = await v1('POST', '/comments/' + cid + '/resolve', { reply: 'Done' }, token);
  check('comentarios: crear, listar y resolver', open.json.data.length === 1 && open.json.data[0].comment === 'Make it friendlier' && r.json.data.status === 'done' && (await v1('GET', '/comments', undefined, token)).json.data.length === 0, [open.json, r.json]);
  await sleep(20); await api('POST', '/admin/plan', { email: free.email, plan: 'pro' }, undefined, { 'x-admin-key': R.ADMIN });
  const freeTok = (await api('POST', '/tokens', { name: 'X' }, free.s)).json.token;
  await api('POST', '/admin/plan', { email: free.email, plan: 'free' }, undefined, { 'x-admin-key': R.ADMIN });
  r = await v1('GET', '/notes', undefined, freeTok);
  check('sin plan pago la API responde 402', r.status === 402 && r.json.error.code === 'api_needs_plan', r.json);

  console.log('API: tableros');
  r = await v1('GET', '/boards?path=' + encodeURIComponent('shop/board.md'), undefined, token);
  const b0 = r.json.data.boards[0];
  check('un tablero viejo se lee igual: columnas, tarjetas sin id y su referencia', r.json.data.boards.length === 1 && J(b0.columns.map((c) => c.title + ':' + c.cards.length)) === J(['To do:2', 'Done:1']) && b0.columns[0].cards[0].id === null && b0.columns[0].cards[0].ref === '0.0.0' && b0.columns[1].cards[0].done === true, r.json);
  r = await v1('POST', '/boards/cards', { path: 'shop/board.md', column: 'To do', title: 'Call supplier', attrs: { due: '2026-10-20', owner: 'Ana Paz', priority: 'high' } }, token);
  const card = r.json.data.card; let text = (await noteOf('shop/board.md')).text;
  check('crear una tarjeta: id, fechas y atributos', r.status === 200 && /^[a-z2-9]{8}$/.test(card.id) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(card.created) && card.attrs.owner === 'Ana Paz' && card.column === 'To do' && /app\.html/.test(r.json.data.url), r.json);
  check('y el Markdown sigue legible, con los atributos entre llaves', new RegExp('^- \\[ \\] Call supplier \\{due=2026-10-20 owner="Ana Paz" priority=high id=' + card.id + ' created=\\S+ updated=\\S+\\}$', 'm').test(text), text);
  check('las tarjetas que ya estaban reciben su id sin cambiar de texto', /^- \[ \] Fix checkout \{id=[a-z2-9]{8} created=\S+\}$/m.test(text) && /^- \[x\] Pick a name \{id=[a-z2-9]{8} created=\S+\}$/m.test(text), text);
  r = await v1('POST', '/boards/cards/' + card.id + '/move', { path: 'shop/board.md', column: 'Done' }, token);
  text = (await noteOf('shop/board.md')).text;
  check('mover una tarjeta de columna', r.json.data.card.column === 'Done' && text.indexOf('Call supplier') > text.indexOf('## Done'), [r.json, text]);
  r = await v1('PATCH', '/boards/cards/' + card.id, { path: 'shop/board.md', attrs: { priority: null, due: '2026-10-22' }, title: 'Call the supplier' }, token);
  check('cambiar atributos y título; null quita un atributo', r.json.data.card.title === 'Call the supplier' && r.json.data.card.attrs.due === '2026-10-22' && !('priority' in r.json.data.card.attrs), r.json);
  r = await v1('POST', '/boards/cards/' + card.id + '/done', { path: 'shop/board.md' }, token);
  check('marcarla hecha', r.json.data.card.done === true && /^- \[x\] Call the supplier /m.test((await noteOf('shop/board.md')).text), r.json);
  r = await v1('POST', '/boards/cards/0.0.1/move', { path: 'shop/board.md', column: 'Doing' }, token);
  check('por referencia, y a una columna nueva', r.status === 200 && r.json.data.card.title === 'Write copy' && r.json.data.card.column === 'Doing' && /## Doing\n- \[ \] Write copy/.test((await noteOf('shop/board.md')).text), r.json);
  r = await v1('PATCH', '/boards/cards/' + card.id, { path: 'shop/board.md', attrs: { id: 'x' } }, token);
  const r2 = await v1('PATCH', '/boards/cards/' + card.id, { path: 'shop/board.md', attrs: { 'bad key': 'x' } }, token);
  check('id, created y updated no se pisan como atributos', r.status === 400 && r.json.error.code === 'bad_attr_key' && r2.status === 400, [r.json, r2.json]);
  r = await v1('PATCH', '/boards/cards/' + card.id, { path: 'shop/board.md', title: 'X', rev: 1 }, token);
  check('con una revisión vieja no se reescribe', r.status === 409 && r.json.error.code === 'rev_conflict', r.json);
  r = await v1('DELETE', '/boards/cards/' + card.id + '?path=' + encodeURIComponent('shop/board.md'), undefined, token);
  check('eliminar una tarjeta', r.status === 200 && !/Call the supplier/.test((await noteOf('shop/board.md')).text), r.json);
  // "Hecha" es un estado: la columna de hechas tilda la tarjeta y salir la destilda; un done explícito manda.
  await v1('PUT', '/note', { path: 'shop/done.md', text: '# Done\n\n```kanban\n## To do\n- [ ] One {id=dddddddd}\n- [x] Old {id=oooooooo}\n\n## Doing\n\n## Done\n```\n' }, token);
  const dn = async (method, url, body) => (await v1(method, '/boards/cards' + url, Object.assign({ path: 'shop/done.md' }, body), token)).json.data.card;
  const dSteps = [];
  dSteps.push((await dn('POST', '/dddddddd/move', { column: 'Done' })).done);
  dSteps.push(/## Done\n- \[x\] One \{/.test((await noteOf('shop/done.md')).text));
  dSteps.push((await dn('POST', '/dddddddd/move', { column: 'Doing' })).done);
  dSteps.push((await dn('PATCH', '/dddddddd', { column: 'Done', done: false })).done);
  dSteps.push((await dn('PATCH', '/dddddddd', { column: 'To do', done: true })).done);
  dSteps.push((await dn('POST', '/oooooooo/move', { column: 'Doing' })).done);
  dSteps.push((await dn('POST', '', { column: 'Done', title: 'Born done' })).done);
  dSteps.push((await dn('POST', '', { column: 'Done', title: 'Born open', done: false })).done);
  dSteps.push((await dn('POST', '', { column: 'To do', title: 'Plain' })).done);
  check('mover a la columna de hechas marca la tarjeta, sacarla la desmarca, y un done explícito manda', J(dSteps) === J([true, true, false, false, true, true, true, false, false]), dSteps);
  r = await v1('POST', '/boards/cards', { path: 'shop/notes.md', title: 'X' }, token);
  const r3 = await v1('POST', '/boards/cards/zzzzzzzz/done', { path: 'shop/board.md' }, token);
  check('una nota sin tablero y una tarjeta que no existe: 404', r.status === 404 && r.json.error.code === 'no_board' && r3.status === 404 && r3.json.error.code === 'card_not_found', [r.json, r3.json]);

  // =====================================================================================================
  console.log('Webhooks: alta');
  r = await api('GET', '/automations', undefined, ana.s);
  check('la lista arranca vacía y dice qué eventos hay', r.status === 200 && r.json.allowed === true && r.json.hooks.length === 0 && r.json.events.includes('card.moved') && r.json.events.length === 12, r.json);
  r = await api('POST', '/automations/hooks', { url: SINK + '/ok', events: ['nada'] }, ana.s);
  check('sin eventos válidos no se crea', r.status === 400 && r.json.error === 'bad_events', r.json);
  r = await api('POST', '/automations/hooks', { name: 'All', url: SINK + '/ok', scope: { kind: 'all' }, events: r.json && (await api('GET', '/automations', undefined, ana.s)).json.events }, ana.s);
  const all = r.json.hook; const secret = r.json.secret;
  check('crear un webhook devuelve su secreto una vez y la dirección a medias', r.status === 200 && /^whsec_/.test(secret) && all.state === 'on' && !J(all).includes(secret) && all.destination.startsWith('http://127.0.0.1') && all.format === 'json' && all.include_text === false, r.json);
  r = await api('GET', '/automations', undefined, ana.s);
  check('la lista no trae secretos', r.json.hooks.length === 1 && !J(r.json).includes('whsec_'), r.json);
  r = await api('POST', '/automations/hooks', { url: SINK + '/ok', events: ['note.created'] }, free.s);
  check('sin plan pago: 402', r.status === 402 && r.json.error === 'automation_needs_plan', r.json);
  r = await api('GET', '/automations/hooks/' + all.id + '/deliveries', undefined, free.s);
  const r4 = await api('DELETE', '/automations/hooks/' + all.id, undefined, free.s);
  check('otra cuenta no ve ni borra un webhook ajeno', r.status === 404 && r4.status === 404 && (await api('GET', '/automations', undefined, ana.s)).json.hooks.length === 1, [r.status, r4.status]);

  console.log('Webhooks: eventos de nota');
  got.length = 0;
  await v1('PUT', '/note', { path: 'log.md', text: '# Log\n\nSecret body of the note.\n' }, token);
  let g = await until(() => at('/ok').find((x) => x.json && x.json.type === 'note.created'));
  check('note.created llega firmado', !!g && signed(g, secret) && g.headers['x-sharpmd-event'] === 'note.created' && g.headers['x-sharpmd-delivery'] === g.json.id && /^SharpMD-Webhooks/.test(g.headers['user-agent']), g && g.headers);
  check('la firma no vale con otro secreto ni con el cuerpo cambiado', !!g && !signed(g, 'whsec_otro') && !signed(Object.assign({}, g, { raw: g.raw + ' ' }), secret));
  check('ni pasada la ventana de tiempo: un pedido copiado no sirve después', !!g && !signed(g, secret, -1));
  check('la carga: id, tipo, fecha, cuenta opaca, nota con su dirección, quién y datos', !!g && /^evt_/.test(g.json.id) && /Z$/.test(g.json.created) && /^acc_/.test(g.json.account) && g.json.note.path === 'log.md' && g.json.note.name === 'log.md' && /app\.html\?f=cloud%2Flog\.md$/.test(g.json.note.url) && g.json.actor.type === 'api' && g.json.data.rev === 1, g && g.json);
  check('sin el correo de la cuenta y sin el texto de la nota', !!g && !g.raw.includes('ejemplo.test') && !g.raw.includes('ana@') && !g.raw.includes('Secret body') && !g.headers.authorization && !g.headers.cookie, g && g.raw);
  got.length = 0;
  for (let i = 0; i < 4; i++) await api('PUT', '/notes/' + encodeURIComponent('log.md'), { text: '# Log\n\nSecret body ' + i + '.\n' }, ana.s);
  await sleep(700);
  check('los guardados seguidos salen como un solo note.updated, con la última revisión y hecho desde la app', J(types('/ok')) === J(['note.updated']) && at('/ok')[0].json.data.rev === 5 && at('/ok')[0].json.actor.type === 'app' && at('/ok')[0].json.data.text === undefined, at('/ok').map((x) => x.json));
  got.length = 0;
  await api('POST', '/rename', { from: 'log.md', to: 'logs/2026.md' }, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'note.moved'));
  check('note.moved con de dónde y adónde', !!g && g.json.data.from === 'log.md' && g.json.data.to === 'logs/2026.md' && g.json.note.path === 'logs/2026.md', g && g.json);
  await api('DELETE', '/notes/' + encodeURIComponent('logs/2026.md'), undefined, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'note.deleted'));
  check('note.deleted', !!g && g.json.note.path === 'logs/2026.md' && g.json.data.trash === true, g && g.json);
  const tid = (await api('GET', '/trash', undefined, ana.s)).json.find((t) => t.path === 'logs/2026.md').id;
  await api('POST', '/trash/' + tid + '/restore', {}, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'note.restored'));
  check('note.restored', !!g && g.json.note.path === 'logs/2026.md', g && g.json);
  await api('POST', '/comments', { path: 'logs/2026.md', quote: 'Secret body 3.', text: 'Shorter' }, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'comment.created'));
  const cm = g && g.json.data.comment;
  await mcp(token, 'resolve_comment', { id: cm && cm.id, reply: 'Cut it' });
  const g2 = await until(() => at('/ok').find((x) => x.json.type === 'comment.resolved'));
  check('comment.created y comment.resolved (resuelto por la IA)', !!g && cm.text === 'Shorter' && !!g2 && g2.json.data.comment.reply === 'Cut it' && g2.json.actor.type === 'mcp', [g && g.json, g2 && g2.json]);

  console.log('Webhooks: eventos de tarjeta');
  const fresh = '# Plan\n\n```kanban\n{show=due,owner}\n## To do\n- [ ] Fix checkout {due=2026-10-20 id=aaaaaaaa created=2026-10-01T10:00:00Z}\n- [ ] Write copy {id=bbbbbbbb created=2026-10-01T10:00:00Z}\n\n## Done\n```\n';
  await api('PUT', '/notes/' + encodeURIComponent('shop/plan.md'), { text: fresh }, ana.s); await sleep(250); got.length = 0;
  // Desde la app: la tarjeta pasa a Done y queda tildada.
  await api('PUT', '/notes/' + encodeURIComponent('shop/plan.md'), { text: fresh.replace('- [ ] Fix checkout {due=2026-10-20 id=aaaaaaaa created=2026-10-01T10:00:00Z}\n', '').replace('## Done\n', '## Done\n- [x] Fix checkout {due=2026-10-20 id=aaaaaaaa created=2026-10-01T10:00:00Z updated=2026-10-07T12:00:00Z}\n') }, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.moved'));
  check('desde la app: card.moved con from y to, y la tarjeta con sus atributos', !!g && g.json.data.from === 'To do' && g.json.data.to === 'Done' && g.json.data.card.id === 'aaaaaaaa' && g.json.data.card.title === 'Fix checkout' && g.json.data.card.attrs.due === '2026-10-20' && g.json.data.card.updated === '2026-10-07T12:00:00Z' && g.json.actor.type === 'app' && signed(g, secret), g && g.json);
  check('y card.done por haberla tildado', !!(await until(() => at('/ok').find((x) => x.json.type === 'card.done' && x.json.data.card.id === 'aaaaaaaa'))), types('/ok'));
  await sleep(300); got.length = 0;
  // Desde la API.
  await v1('PATCH', '/boards/cards/bbbbbbbb', { path: 'shop/plan.md', attrs: { owner: 'Lia' }, title: 'Write the copy' }, token);
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.updated'));
  check('desde la API: card.updated con el valor anterior y el nuevo', !!g && J(g.json.data.changes) === J({ title: { from: 'Write copy', to: 'Write the copy' }, owner: { from: null, to: 'Lia' } }) && g.json.actor.type === 'api', g && g.json);
  await v1('POST', '/boards/cards', { path: 'shop/plan.md', column: 'To do', title: 'Ship it' }, token);
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.created'));
  check('card.created', !!g && g.json.data.card.title === 'Ship it' && g.json.data.card.column === 'To do', g && g.json);
  await sleep(300); got.length = 0;
  // Desde el MCP: la IA reescribe la nota y saca una tarjeta.
  const cur = (await noteOf('shop/plan.md')).text;
  await mcp(token, 'write_note', { path: 'shop/plan.md', text: cur.replace(/^- \[ \] Ship it.*\n/m, '') });
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.deleted'));
  check('desde el MCP: card.deleted', !!g && g.json.data.card.title === 'Ship it' && g.json.actor.type === 'mcp', g && g.json);
  // Desde el MCP, con las herramientas de tablero: los mismos eventos, hechos por la IA.
  await sleep(300); got.length = 0;
  const made = JSON.parse((await mcp(token, 'add_card', { path: 'shop/plan.md', column: 'To do', title: 'Agent task', fields: { agent: 'claude' } })).content[0].text);
  const mine = (type) => until(() => at('/ok').find((x) => x.json.type === type && x.json.data.card.id === made.card.id));
  g = await mine('card.created');
  check('herramientas de tablero del MCP: add_card dispara card.created, hecho por la IA', !!g && g.json.actor.type === 'mcp' && g.json.data.card.title === 'Agent task' && g.json.data.card.column === 'To do' && g.json.data.card.attrs.agent === 'claude' && g.json.note.path === 'shop/plan.md' && signed(g, secret), g && g.json);
  await mcp(token, 'update_card', { path: 'shop/plan.md', id: made.card.id, fields: { needs: 'A decision on the price' } });
  g = await mine('card.updated');
  check('update_card dispara card.updated con el campo que cambió', !!g && J(g.json.data.changes) === J({ needs: { from: null, to: 'A decision on the price' } }) && g.json.actor.type === 'mcp', g && g.json);
  await mcp(token, 'move_card', { path: 'shop/plan.md', id: made.card.id, column: 'Done' });
  g = await mine('card.moved'); const g3 = await mine('card.done');
  check('move_card a la columna de hechas dispara card.moved y card.done', !!g && g.json.data.from === 'To do' && g.json.data.to === 'Done' && g.json.actor.type === 'mcp' && !!g3 && g3.json.data.card.done === true && g3.json.actor.type === 'mcp', [g && g.json, g3 && g3.json]);
  await mcp(token, 'delete_card', { path: 'shop/plan.md', id: made.card.id });
  g = await mine('card.deleted');
  check('delete_card dispara card.deleted', !!g && g.json.data.card.title === 'Agent task' && g.json.actor.type === 'mcp', g && g.json);
  await mcp(token, 'create_board', { path: 'shop/agents.md' });
  g = await until(() => at('/ok').find((x) => x.json.type === 'note.created' && x.json.note.path === 'shop/agents.md'));
  check('create_board dispara note.created, hecho por la IA', !!g && g.json.actor.type === 'mcp', g && g.json);
  // Un tablero viejo, sin ids: mover una tarjeta se reconoce por su texto.
  await api('PUT', '/notes/' + encodeURIComponent('old.md'), { text: '```kanban\n## A\n- [ ] Uno\n- [ ] Dos\n\n## B\n```\n' }, ana.s); await sleep(250); got.length = 0;
  await api('PUT', '/notes/' + encodeURIComponent('old.md'), { text: '```kanban\n## A\n- [ ] Dos\n\n## B\n- [ ] Uno\n```\n' }, ana.s);
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.moved'));
  await sleep(300);
  check('un tablero sin ids: card.moved igual, y ninguna tarjeta creada ni eliminada', !!g && g.json.data.card.title === 'Uno' && g.json.data.card.id === null && g.json.data.from === 'A' && g.json.data.to === 'B' && !types('/ok').some((t) => t === 'card.created' || t === 'card.deleted'), types('/ok'));
  got.length = 0;
  await api('PUT', '/notes/' + encodeURIComponent('old.md'), { text: '```kanban\n## A\n- [ ] Dos {id=cccccccc created=2026-10-07T12:00:00Z}\n\n## Listo\n- [ ] Uno {id=dddddddd created=2026-10-07T12:00:00Z}\n```\n' }, ana.s);
  await sleep(600);
  check('recibir ids y renombrar una columna no dispara eventos de tarjeta', J(types('/ok')) === J(['note.updated']), types('/ok'));

  console.log('Webhooks: ámbito y formatos');
  r = await api('POST', '/automations/hooks', { name: 'Slack', url: SINK + '/slack', scope: { kind: 'folder', path: 'shop' }, events: ['card.moved', 'card.done', 'note.created'], format: 'slack' }, ana.s);
  const slack = r.json.hook;
  r = await api('POST', '/automations/hooks', { name: 'One', url: SINK + '/one', scope: { kind: 'note', path: 'shop/plan.md' }, events: ['card.moved'], format: 'discord', lang: 'es' }, ana.s);
  const one = r.json.hook;
  r = await api('POST', '/automations/hooks', { name: 'Text', url: SINK + '/text', scope: { kind: 'note', path: 'old.md' }, events: ['note.updated'], include_text: true }, ana.s);
  got.length = 0;
  await v1('POST', '/boards/cards/bbbbbbbb/move', { path: 'shop/plan.md', column: 'Done' }, token);
  await v1('PUT', '/note', { path: 'elsewhere.md', text: '# Elsewhere\n' }, token);
  await api('PUT', '/notes/' + encodeURIComponent('old.md'), { text: '# Old\n\nNow with text.\n' }, ana.s);
  g = await until(() => at('/slack')[0]); const gd = await until(() => at('/one')[0]); const gt = await until(() => at('/text')[0]); await sleep(300);
  check('formato Slack: un mensaje listo, con la línea legible y el enlace', !!g && J(Object.keys(g.json)) === J(['text']) && /^Card "Write the copy" moved from To do to Done in <http[^|]+\|shop\/plan\.md>$/.test(g.json.text), g && g.json);
  check('formato Discord, en español', !!gd && /^Tarjeta "Write the copy" pasó de To do a Done en \[shop\/plan\.md\]\(http[^)]+\)$/.test(gd.json.content), gd && gd.json);
  // Mover a la columna de hechas es un movimiento y además deja la tarjeta hecha: salen card.moved y card.done.
  const gDoneLine = at('/slack').map((x) => x.json.text).find((t) => / done in /.test(t));
  check('mover a la columna de hechas por la API emite card.moved y card.done, en ese orden', at('/slack').length === 2 && /^Card "Write the copy" done in <http[^|]+\|shop\/plan\.md>$/.test(gDoneLine || '') && / moved from /.test(at('/slack')[0].json.text), at('/slack').map((x) => x.json.text));
  check('el de una carpeta no recibe lo de afuera; el de una nota, solo esa nota', at('/slack').length === 2 && at('/one').length === 1, [at('/slack').length, at('/one').length]);
  check('con "incluir el contenido" viaja el texto; sin eso, no', !!gt && gt.json.data.text === '# Old\n\nNow with text.\n' && gt.json.data.truncated === false && at('/ok').filter((x) => x.json.type === 'note.updated').every((x) => x.json.data.text === undefined), gt && gt.json);
  r = await api('PUT', '/automations/hooks/' + slack.id, { on: false }, ana.s);
  got.length = 0; await v1('PUT', '/note', { path: 'shop/more.md', text: '# More\n' }, token); await sleep(400);
  check('pausado no recibe nada', r.json.hook.state === 'paused' && at('/slack').length === 0, at('/slack').length);
  await api('PUT', '/automations/hooks/' + slack.id, { on: true }, ana.s);

  console.log('Webhooks: reintentos, fallos y prueba');
  r = await api('POST', '/automations/hooks', { name: 'Flaky', url: SINK + '/flaky', scope: { kind: 'note', path: 'retry.md' }, events: ['note.created'] }, ana.s);
  const flk = r.json.hook; got.length = 0;
  await v1('PUT', '/note', { path: 'retry.md', text: '# Retry\n' }, token);
  await until(() => at('/flaky').length >= 3, 5000); await sleep(200);
  let log = (await api('GET', '/automations/hooks/' + flk.id + '/deliveries', undefined, ana.s)).json;
  check('reintenta con espera hasta que sale: tres intentos, el mismo evento', at('/flaky').length === 3 && new Set(at('/flaky').map((x) => x.json.id)).size === 1, at('/flaky').length);
  check('el registro: estado, código, intentos y duración, sin el cuerpo', log.length === 1 && log[0].status === 'ok' && log[0].code === 200 && log[0].attempts === 3 && log[0].ms >= 0 && log[0].type === 'note.created' && !J(log).includes('Retry'), log);
  r = await api('POST', '/automations/hooks', { name: 'Down', url: SINK + '/fail', scope: { kind: 'folder', path: 'down' }, events: ['note.created'] }, ana.s);
  const down = r.json.hook;
  await v1('PUT', '/note', { path: 'down/a.md', text: '# A\n' }, token); await v1('PUT', '/note', { path: 'down/b.md', text: '# B\n' }, token);
  const off = await until(async () => (await api('GET', '/automations', undefined, ana.s)).json.hooks.find((h) => h.id === down.id && h.state === 'failed'), 6000);
  log = (await api('GET', '/automations/hooks/' + down.id + '/deliveries', undefined, ana.s)).json;
  check('tras muchos fallos seguidos se desactiva solo', !!off && log.some((j) => j.status === 'failed' && j.code === 500 && j.error === 'http_500'), log);
  const sent = at('/fail').length; await v1('PUT', '/note', { path: 'down/c.md', text: '# C\n' }, token); await sleep(400);
  r = await api('PUT', '/automations/hooks/' + down.id, { on: true }, ana.s);
  check('desactivado no manda más, y se puede volver a prender', at('/fail').length === sent && r.json.hook.state === 'on', [at('/fail').length, sent]);
  await api('DELETE', '/automations/hooks/' + down.id, undefined, ana.s);
  got.length = 0;
  r = await api('POST', '/automations/hooks/' + slack.id + '/test', {}, ana.s);
  check('"enviar una prueba" manda un mensaje y dice cómo salió', r.json.ok === true && r.json.code === 200 && at('/slack').length === 1 && /SharpMD test/.test(at('/slack')[0].json.text), r.json);
  r = await api('PUT', '/automations/hooks/' + flk.id, { url: SINK + '/redirect' }, ana.s);
  r = await api('POST', '/automations/hooks/' + flk.id + '/test', {}, ana.s);
  check('una redirección no se sigue', r.json.ok === false && r.json.code === 302 && r.json.error === 'redirect' && at('/ok').length === 0, r.json);
  await api('PUT', '/automations/hooks/' + flk.id, { url: SINK + '/slow' }, ana.s);
  r = await api('POST', '/automations/hooks/' + flk.id + '/test', {}, ana.s);
  check('un destino lento se corta por tiempo', r.json.ok === false && r.json.error === 'timeout' && r.json.ms < 1400, r.json);
  r = await api('POST', '/automations/hooks/' + all.id + '/secret', {}, ana.s); const secret2 = r.json.secret;
  got.length = 0; await v1('PUT', '/note', { path: 'after.md', text: '# After\n' }, token);
  g = await until(() => at('/ok').find((x) => x.json.type === 'note.created'));
  check('cambiar el secreto: lo nuevo firma con el nuevo', /^whsec_/.test(r.json.secret) && r.json.secret !== secret && !!g && signed(g, r.json.secret) && !signed(g, secret));
  // La cola vive en la base: lo que quedó pendiente sale después de un reinicio.
  await api('PUT', '/automations/hooks/' + flk.id, { url: SINK + '/later', scope: { kind: 'note', path: 'later.md' }, events: ['note.created', 'note.updated'] }, ana.s);
  got.length = 0;
  await v1('PUT', '/note', { path: 'later.md', text: '# Later\n' }, token); await v1('PUT', '/note', { path: 'later.md', text: '# Later\n\nMore.\n' }, token);
  await until(() => at('/later').length >= 1); await sleep(40);
  await R.stop(); const before = types('/later'); await R.start();
  await until(() => types('/later').includes('note.updated'), 8000);
  check('un reinicio no pierde lo que estaba en cola', !before.includes('note.updated') && types('/later').includes('note.created') && types('/later').includes('note.updated'), [before, types('/later')]);

  // =====================================================================================================
  console.log('Direcciones de entrada');
  r = await api('POST', '/automations/inboxes', { name: 'Journal', kind: 'append', path: 'in/journal.md' }, ana.s);
  const inbox = r.json.inbox; const inUrl = r.json.url;
  check('crear una dirección de entrada: la dirección se ve una vez', r.status === 200 && new RegExp('^' + base + '/in/mdi_[A-Za-z0-9_-]{40,}$').test(inUrl) && inbox.hint === inUrl.slice(-4) && !J((await api('GET', '/automations', undefined, ana.s)).json).includes(inUrl.split('/in/')[1]), r.json);
  r = await post(inUrl, 'First entry', 'text/plain');
  check('texto plano: se agrega a la nota, que nace si no estaba', r.status === 200 && J(r.json) === J({ ok: true }) && (await noteOf('in/journal.md')).text === 'First entry\n', [r, (await noteOf('in/journal.md')).text]);
  r = await post(inUrl, J({ text: 'Second entry', title: 'ignored' }), 'application/json');
  check('JSON con text', (await noteOf('in/journal.md')).text === 'First entry\n\nSecond entry\n', (await noteOf('in/journal.md')).text);
  r = await post(inUrl, J({ name: 'Ana', amount: 1200, paid: true }), 'application/json');
  check('otro JSON plano: una tabla de campo y valor', (await noteOf('in/journal.md')).text.endsWith('\n\n| Field | Value |\n| --- | --- |\n| name | Ana |\n| amount | 1200 |\n| paid | true |\n'), (await noteOf('in/journal.md')).text);
  r = await post(inUrl, J({ order: { id: 7, items: ['a', 'b'] } }), 'application/json');
  check('JSON con estructura: un bloque de código', /```json\n\{\n {2}"order": \{[\s\S]+\n```\n$/.test((await noteOf('in/journal.md')).text), (await noteOf('in/journal.md')).text);
  r = await post(inUrl, 'name=Lia+Paz&email=lia%40tienda.test&message=Hola', 'application/x-www-form-urlencoded');
  check('formulario: los campos como lista', (await noteOf('in/journal.md')).text.endsWith('\n\n- **name**: Lia Paz\n- **email**: lia@tienda.test\n- **message**: Hola\n'), (await noteOf('in/journal.md')).text);
  const bnd = '----x' + Date.now(); const multi = ['--' + bnd, 'Content-Disposition: form-data; name="product"', '', 'Mate', '--' + bnd, 'Content-Disposition: form-data; name="file"; filename="a.txt"', 'Content-Type: text/plain', '', 'ARCHIVO', '--' + bnd, 'Content-Disposition: form-data; name="qty"', '', '2', '--' + bnd + '--', ''].join('\r\n');
  r = await post(inUrl, multi, 'multipart/form-data; boundary=' + bnd);
  text = (await noteOf('in/journal.md')).text;
  check('multipart: los campos entran y los archivos no', r.status === 200 && text.endsWith('- **product**: Mate\n- **qty**: 2\n') && !text.includes('ARCHIVO'), text);
  check('la respuesta nunca trae contenido de la nota', J(r.json) === J({ ok: true }));
  r = await fetch(inUrl + '?text=por+GET').then((x) => x.status);
  check('GET no está habilitado si no se pide', r === 405, r);
  await api('PUT', '/automations/inboxes/' + inbox.id, { allow_get: true, template: '- {{date}} {{text}}' }, ana.s);
  await fetch(inUrl + '?text=por+GET'); await post(inUrl, 'otra', 'text/plain');
  text = (await noteOf('in/journal.md')).text;
  check('con GET habilitado y plantilla: renglones de lista pegados, con la fecha', /- \*\*qty\*\*: 2\n- \d{4}-\d\d-\d\d por GET\n- \d{4}-\d\d-\d\d otra\n$/.test(text), text);
  r = await api('POST', '/automations/inboxes', { name: 'Leads', kind: 'create', path: 'leads', template: '# {{title}}\n\n{{text}}\n\nFrom {{email}}' }, ana.s);
  const mk = r.json.url;
  await post(mk, J({ title: 'Lia: Paz / test?', text: 'Wants a quote', email: 'lia@tienda.test' }), 'application/json'); await post(mk, 'Sin título', 'text/plain');
  let lst2 = (await api('GET', '/notes', undefined, ana.s)).json.filter((n) => n.path.startsWith('leads/')).map((n) => n.path).sort();
  check('crear una nota en una carpeta: por title o por fecha', lst2.length === 2 && lst2.includes('leads/Lia Paz test.md') && lst2.some((p) => /^leads\/\d{4}-\d\d-\d\d \d{4}\.md$/.test(p)) && (await noteOf('leads/Lia Paz test.md')).text === '# Lia: Paz / test?\n\nWants a quote\n\nFrom lia@tienda.test\n', lst2);
  r = await api('POST', '/automations/inboxes', { name: 'Cards', kind: 'card', path: 'shop/plan.md', column: 'To do' }, ana.s);
  got.length = 0; const cardIn = await post(r.json.url, J({ title: 'New order 77', owner: 'Lia', total: 1500 }), 'application/json');
  text = (await noteOf('shop/plan.md')).text;
  g = await until(() => at('/ok').find((x) => x.json.type === 'card.created'));
  check('crear una tarjeta en una columna del tablero, con los campos como atributos', cardIn.status === 200 && /^[a-z2-9]{8}$/.test(cardIn.json.id) && new RegExp('## To do\\n(?:.*\\n)*- \\[ \\] New order 77 \\{owner=Lia total=1500 id=' + cardIn.json.id).test(text), text);
  check('y dispara card.created, hecho por una entrada', !!g && g.json.data.card.title === 'New order 77' && g.json.actor.type === 'inbox', g && g.json);
  r = await post(base + '/in/mdi_' + 'x'.repeat(43), 'hola', 'text/plain');
  const r5 = await post(base + '/in/otra-cosa', 'hola', 'text/plain');
  check('un secreto que no existe: 404 y nada más', r.status === 404 && r.json.error === 'not_found' && Object.keys(r.json).length === 2 && r5.status === 404, [r, r5]);
  r = await post(inUrl, 'x'.repeat(70 * 1024), 'text/plain');
  check('un cuerpo pasado de tamaño: 413', r.status === 413, r.status);
  r = await post(inUrl, '   ', 'text/plain');
  check('vacío: 400', r.status === 400 && r.json.error === 'empty', r);
  r = await api('POST', '/automations/inboxes/' + inbox.id + '/secret', {}, ana.s);
  const oldDead = await post(inUrl, 'tarde', 'text/plain'); const newOk = await post(r.json.url, 'con la nueva', 'text/plain');
  check('cambiar la dirección: la vieja deja de servir en el acto', oldDead.status === 404 && newOk.status === 200 && r.json.url !== inUrl, [oldDead.status, newOk.status]);
  await api('DELETE', '/automations/inboxes/' + inbox.id, undefined, ana.s);
  check('eliminada, no recibe', (await post(r.json.url, 'nada', 'text/plain')).status === 404);
  r = await api('POST', '/automations/inboxes', { kind: 'append', path: 'x.md' }, free.s);
  check('sin plan pago no se crean entradas', r.status === 402, r.json);

  bad = 0;
  await uiTests({ ana, free, token, secret: secret2 });
} catch (e) { console.log('  FALLA la prueba se cortó -> ' + (e && e.stack || e)); bad = 1; }

// La interfaz se prueba aparte, más abajo, con el mismo servidor.
async function uiTests(K) {
  const plain = (t) => !/[!¡—–]/.test(t);
  const board = '# Plan\n\n```kanban\n## To do\n- [ ] Fix checkout\n- [ ] Write copy\n\n## Doing\n\n## Done\n- [x] Pick a name\n```\n\nNotes below the board.\n';
  await v1('PUT', '/note', { path: 'ui/board.md', text: board }, K.token); await sleep(300);

  console.log('Interfaz: el tablero avisa');
  const { page } = await R.open(K.ana);
  await page.goto(R.noteUrl('ui/board.md')); await page.waitForSelector('.lmd-board .lmd-card'); await page.waitForFunction(() => !!LMD.sync.account());
  got.length = 0;
  await page.dragAndDrop('.lmd-col[data-c="0"] .lmd-card[data-k="0"]', '.lmd-col[data-c="1"] .lmd-cards');
  let g = await until(() => at('/ok').find((x) => x.json && x.json.type === 'card.moved'), 9000);
  check('arrastrar una tarjeta en la app dispara card.moved, firmado, con from y to', !!g && g.json.data.card.title === 'Fix checkout' && g.json.data.from === 'To do' && g.json.data.to === 'Doing' && g.json.actor.type === 'app' && /^[a-z2-9]{8}$/.test(g.json.data.card.id) && signed(g, K.secret), g && g.json);
  check('la tarjeta lleva su fecha de edición, puesta por la app', !!g && /^\d{4}-\d\d-\d\dT/.test(g.json.data.card.updated) && /^\d{4}-\d\d-\d\dT/.test(g.json.data.card.created), g && g.json.data.card);
  await sleep(400); got.length = 0;
  await page.locator('.lmd-card', { hasText: 'Write copy' }).locator('.lmd-card-text').click(); await page.waitForSelector('.lmd-cd');
  const addField = async (pg, type, value) => { await pg.click('.lmd-cd [data-cd=add-open]'); await pg.click('.lmd-cd [data-cd-type=' + type + ']'); await pg.fill('.lmd-cd [data-cd=newval]', value); await pg.click('.lmd-cd [data-cd=add]'); };
  await addField(page, 'due', '2026-10-20'); await addField(page, 'tags', 'bug, idea'); await addField(page, 'person', 'Lia'); await addField(page, 'link', 'https://example.com/a');
  await page.click('.lmd-cd [data-cd-me]'); await page.keyboard.press('Control+Enter');
  g = await until(() => at('/ok').find((x) => x.json && x.json.type === 'card.updated'), 9000);
  const mine = K.ana.email.split('@')[0];
  check('cambiar campos en el detalle dispara card.updated con el valor anterior y el nuevo de cada uno', !!g && J(g.json.data.changes) === J({ due: { from: null, to: '2026-10-20' }, tags: { from: null, to: 'bug,idea' }, assignee: { from: null, to: 'Lia, ' + mine }, link: { from: null, to: 'https://example.com/a' } }) && g.json.data.card.title === 'Write copy', g && g.json);
  check('el actor del evento sigue sin nombre ni correo', !!g && !/@/.test(J(g.json.actor)) && !('name' in g.json.actor), g && g.json.actor);
  const chip = await page.locator('.lmd-card', { hasText: 'Write copy' }).locator('.lmd-chip').first().textContent();
  check('y la tarjeta lo muestra en chico', /Oct 20/.test(chip), chip);

  // El servidor y la app leen el mismo formato: un mismo tablero da lo mismo de los dos lados.
  const sample = '{show=due,owner priority=low|medium|high n=number done=Done tags=bug:red,idea:blue}\n## To do\n- [ ] A {due=2026-10-20 owner="Ana \\"P\\" Paz" tags=bug,idea id=aaaaaaaa created=2026-10-01T10:00:00Z by=Ana}\n- [x] B\n- [ ] C {not attrs}\n* [ ] D {k=v}\n- [ ] F {a=1 {b=2}\n\n### Done\n- E {x=1 y="two words" id=eeeeeeee updated=2026-10-02T10:00:00Z}';
  await v1('PUT', '/note', { path: 'ui/parity.md', text: '```kanban\n' + sample + '\n```\n' }, K.token);
  const fromServer = (await v1('GET', '/boards?path=' + encodeURIComponent('ui/parity.md'), undefined, K.token)).json.data.boards[0];
  const fromApp = await page.evaluate((t) => LMD.board.model.parse(t), sample);
  const flat = (cols, title) => cols.map((c) => [c.title, c.cards.map((k) => [k.id || '', k[title], k.done, k.created || '', k.attrs])]);
  check('la app y el servidor leen igual un tablero: columnas, tarjetas, atributos y configuración', J(fromServer.show) === J(fromApp.show) && J(fromServer.fields) === J(fromApp.fields) && J(flat(fromServer.columns, 'title')) === J(flat(fromApp.columns, 'text')) && fromApp.columns[0].cards.length === 5 && fromApp.columns[0].cards[0].attrs.owner === 'Ana "P" Paz' && fromApp.columns[0].cards[2].text === 'C {not attrs}', [flat(fromServer.columns, 'title'), flat(fromApp.columns, 'text')]);
  check('la columna de hechas, los colores de las etiquetas y el autor no son campos ni de un lado ni del otro', !('done' in fromServer.fields) && !('tags' in fromServer.fields) && !('by' in fromServer.columns[0].cards[0].attrs) && fromServer.columns[0].cards[0].attrs.tags === 'bug,idea' && fromApp.done === 'Done' && J(fromApp.tags) === J({ bug: 'red', idea: 'blue' }) && fromApp.columns[0].cards[0].by === 'Ana' && !('by' in fromApp.columns[0].cards[0].attrs), [fromServer.fields, fromApp]);
  const noBy = await v1('PATCH', '/boards/cards/aaaaaaaa', { path: 'ui/parity.md', attrs: { by: 'Otra' } }, K.token);
  check('el autor de una tarjeta no se cambia por la API', noBy.status === 400 && noBy.json.error.code === 'bad_attr_key', noBy.json);
  const rewritten = (await v1('POST', '/boards/cards/eeeeeeee/done', { path: 'ui/parity.md' }, K.token)).json.data;
  const again = (await api('GET', '/notes/' + encodeURIComponent('ui/parity.md'), undefined, K.ana.s)).json.text;
  const appWrites = await page.evaluate((t) => LMD.board.model.serialize(LMD.board.model.parse(t)).join('\n'), again.split('\n').slice(1, -2).join('\n'));
  check('y lo que escribe el servidor, la app lo vuelve a escribir igual', rewritten.card.done === true && appWrites === again.split('\n').slice(1, -2).join('\n') && /^\{show=due,owner priority=low\|medium\|high n=number done=Done tags=bug:red,idea:blue\}$/m.test(again) && / created=2026-10-01T10:00:00Z by=Ana\}$/m.test(again), [again, appWrites]);

  // La columna de hechas es la misma para la app y para el servidor: la que dice el tablero o la que se llama como una.
  const doneCases = ['## To do\n- [ ] P {id=pppppppp}\n\n## Listo', '{done=""}\n## A\n- [ ] P {id=pppppppp}\n\n## Done', '{done=A}\n## B\n- [ ] P {id=pppppppp}\n\n## A\n\n## Done', '{done=Nope}\n## A\n- [ ] P {id=pppppppp}\n\n## Done',
    '## A\n- [ ] P {id=pppppppp}\n\n## Hechas ✅\n\n## Done', '{done=review}\n## A\n- [ ] P {id=pppppppp}\n\n## REVIEW\n\n## Done', '## A\n- [ ] P {id=pppppppp}\n\n## Not done yet\n\n## B'];
  const doneBoth = [];
  for (let i = 0; i < doneCases.length; i++) {
    const dp = 'ui/done' + i + '.md'; await v1('PUT', '/note', { path: dp, text: '```kanban\n' + doneCases[i] + '\n```\n' }, K.token);
    const appSays = await page.evaluate((x) => { const b = LMD.board.model.parse(x); const d = LMD.board.model.doneIndex(b); return d < 0 ? null : b.columns[d].title; }, doneCases[i]);
    const titles = (await v1('GET', '/boards?path=' + encodeURIComponent(dp), undefined, K.token)).json.data.boards[0].columns.map((c) => c.title);
    let serverSays = null;
    for (const c of titles) { const mv = await v1('POST', '/boards/cards/pppppppp/move', { path: dp, column: c }, K.token); if (mv.json.data.card.done) serverSays = c; }
    doneBoth.push([appSays, serverSays]);
  }
  check('la app y el servidor eligen la misma columna de hechas', doneBoth.every((x) => x[0] === x[1]) && J(doneBoth.map((x) => x[0])) === J(['Listo', null, 'A', 'Done', 'Hechas ✅', 'REVIEW', null]), doneBoth);

  console.log('Interfaz: una automatización desde el tablero');
  // Lo que viaja al servidor al guardar, tal cual.
  const sentBy = async (pg, act, method) => { const [rq] = await Promise.all([pg.waitForRequest((x) => /\/automations\/hooks(\/\d+)?$/.test(x.url()) && x.method() === (method || 'POST')), act()]); return rq.postData(); };
  // El formulario, como se ve: los eventos elegidos, las fichas, el resumen y lo que falta.
  const form = (pg) => pg.evaluate(() => { const w = document.querySelector('.lmd-au-wiz'); const $ = (q) => w.querySelector(q); const t = (q) => ($(q) && !$(q).hidden ? $(q).textContent : ''); return {
    title: $('h3').textContent, labs: [...w.querySelectorAll('.lmd-au-lab')].map((n) => n.textContent), tpl: [...w.querySelectorAll('[data-au-tpl]')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')),
    chips: [...w.querySelectorAll('.lmd-ms-chip > span')].map((n) => n.textContent), many: $('.lmd-ms').classList.contains('lmd-ms-many'), field: $('.lmd-ms-text').textContent, aria: $('.lmd-ms-btn').getAttribute('aria-label'), bad: $('.lmd-ms-btn').getAttribute('aria-invalid'),
    name: $('[data-au=name]').value, scope: $('[data-au=scope]').value, format: $('[data-au=format]').value, fmts: [...$('[data-au=format]').options].map((o) => o.textContent), url: $('[data-au=url]').value, hint: $('[data-au=url]').placeholder, urlBad: $('[data-au=url]').getAttribute('aria-invalid'),
    more: !$('.lmd-au-more').hidden, sum: t('.lmd-au-sum'), miss: $('.lmd-au-miss').textContent, errEv: t('#lmd-au-err-ev'), errUrl: t('#lmd-au-err-url'), tip: t('#lmd-au-tip'), off: $('[data-au=save]').disabled, save: $('[data-au=save]').textContent, text: $('.lmd-ask-card').textContent }; });
  const CARDS = ['card.moved', 'card.done', 'card.created', 'card.updated', 'card.deleted'];
  await page.click('.lmd-board-menu'); await page.waitForSelector('.lmd-menu-board');
  const menuText = await page.textContent('.lmd-menu-board');
  await page.click('.lmd-menu-board [data-bm=notify]'); await page.waitForSelector('.lmd-au-wiz');
  let s = await form(page);
  check('el menú del tablero ofrece avisar cuando cambie una tarjeta, y abre una sola pantalla con esa nota ya puesta', /Notify when a card changes/.test(menuText) && s.title === 'New automation' && J(s.labs) === J(['Name', 'When', 'In', 'Notify']) && s.scope === 'note:ui/board.md' && !/Step \d/.test(s.text) && !(await page.locator('.lmd-au-wiz [data-au=next], .lmd-au-wiz [data-au=back]').count()), [menuText, s]);
  check('los cinco eventos de tarjeta ya elegidos, con su plantilla marcada', /^When: A card moves to another column, A card is marked done, A card is created, The details of a card change, A card is deleted$/.test(s.aria) && J(s.tpl) === J(['Task done', 'Card changes*', 'New note', 'New comment']) && (s.many ? s.field === '5 events' : s.chips.length === 5), s);
  check('adónde avisar: Slack, Discord o JSON en un desplegable, con Slack elegido', s.format === 'slack' && J(s.fmts) === J(['Slack', 'Discord', 'Make, n8n, Zapier or other']) && s.hint === 'https://hooks.slack.com/services/…' && s.tip === 'Paste the incoming webhook address of your channel.' && !s.more && plain(s.text), s);
  check('sin dirección no se guarda, y dice qué falta', s.off && s.save === 'Save' && s.miss === 'To save, add: the address.' && !s.errUrl, s);
  await page.fill('.lmd-au-wiz [data-au=url]', 'ftp://nada');
  s = await form(page);
  check('una dirección que no es https se avisa junto al campo mientras se escribe, sin esperar a guardar', /has to start with https/.test(s.errUrl) && s.urlBad === 'true' && s.off && s.miss === 'To save, add: a valid address.' && plain(s.errUrl), s);
  await page.fill('.lmd-au-wiz [data-au=url]', 'https://ho');
  const typing = await form(page);
  await page.focus('.lmd-au-wiz [data-au=name]');
  s = await form(page);
  check('una dirección a medias no molesta hasta salir del campo', !typing.errUrl && typing.off && /has to start with https/.test(s.errUrl) && s.off, [typing, s]);
  await page.fill('.lmd-au-wiz [data-au=url]', SINK + '/ui-slack'); await page.fill('.lmd-au-wiz [data-au=name]', 'Team channel');
  s = await form(page);
  check('completo: el resumen se arma solo y Guardar se habilita', s.sum === 'When any of the 5 picked events happens, in the note ui/board.md, notify Slack (' + SINK.slice(7) + ').' && !s.off && !s.miss && !s.errUrl && !s.urlBad, s);
  const sentBoard = await sentBy(page, () => page.click('.lmd-au-wiz [data-au=save]'));
  check('lo que se manda es lo mismo que mandaba el alta de tres pasos para esa elección', sentBoard === J({ name: 'Team channel', url: SINK + '/ui-slack', scope: { kind: 'note', path: 'ui/board.md' }, events: CARDS, format: 'slack', include_text: false, lang: 'en' }), sentBoard);
  await page.waitForSelector('.lmd-au-wiz [data-au=test]');
  got.length = 0; await page.click('.lmd-au-wiz [data-au=test]'); await page.waitForSelector('.lmd-au-result:not([hidden])');
  const result = await page.textContent('.lmd-au-result');
  check('creada, "Send a test" manda el mensaje y dice que llegó', /^The test arrived \(\d+ ms\)\.$/.test(result) && at('/ui-slack').length === 1 && /SharpMD test/.test(at('/ui-slack')[0].json.text), [result, at('/ui-slack').length]);
  await page.click('.lmd-au-wiz [data-au=no]'); await page.waitForSelector('.lmd-au-wiz', { state: 'detached' });
  got.length = 0;
  // "Hecha" es un estado: llevar la tarjeta a la columna de hechas la tilda en el archivo y dispara card.done.
  await page.locator('.lmd-card', { hasText: 'Write copy' }).dragTo(page.locator('.lmd-col', { hasText: 'Done' }).locator('.lmd-col-head'));
  g = await until(() => at('/ui-slack').find((x) => /done/.test(x.json.text)), 9000);
  check('y de ahí en más Slack recibe la línea armada', !!g && /^Card "Write copy" done in <http[^|]+\|ui\/board\.md>$/.test(g.json.text), g && g.json);
  const gDone = await until(() => at('/ok').find((x) => x.json && x.json.type === 'card.done' && x.json.data.card.title === 'Write copy'), 9000);
  const doneText = (await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text;
  check('mover una tarjeta a la columna de hechas dispara card.done y la deja [x] en el Markdown', !!gDone && gDone.json.data.card.done === true && gDone.json.data.card.column === 'Done' && /## Done\n- \[x\] Write copy \{/.test(doneText), [gDone && gDone.json, doneText]);
  got.length = 0;
  await page.locator('.lmd-card', { hasText: 'Write copy' }).dragTo(page.locator('.lmd-col', { hasText: 'To do' }).locator('.lmd-col-head'));
  const gBack = await until(() => at('/ok').find((x) => x.json && x.json.type === 'card.updated' && x.json.data.changes.done), 9000);
  check('y sacarla la vuelve a [ ], con el cambio en card.updated', !!gBack && J(gBack.json.data.changes.done) === J({ from: true, to: false }) && /- \[ \] Write copy \{/.test((await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text), gBack && gBack.json);

  console.log('Interfaz: solo lectura');
  const pub = (await api('POST', '/links', { path: 'ui/board.md' }, K.ana.s)).json;
  const guest = await R.open(null); const gp = guest.page;
  await gp.goto(R.home + '?f=' + encodeURIComponent('pub/' + pub.token)); await gp.waitForSelector('.lmd-board .lmd-card');
  await gp.locator('.lmd-card', { hasText: 'Write copy' }).click(); await gp.waitForSelector('.lmd-cd');
  const ro = await gp.evaluate(() => ({ title: document.querySelector('.lmd-cd [data-cd=title]').value, editable: [...document.querySelectorAll('.lmd-cd input, .lmd-cd select')].filter((n) => !n.disabled && !n.hidden).length, botones: [...document.querySelectorAll('.lmd-cd button')].map((b) => b.dataset.cd || b.className), enlace: (document.querySelector('.lmd-cd-attr[data-key=link] a') || {}).href, personas: [...document.querySelectorAll('.lmd-cd-attr[data-key=assignee] .lmd-cd-pill')].length, arrastra: document.querySelector('.lmd-card').getAttribute('draggable'), menu: getComputedStyle(document.querySelector('.lmd-col-menu')).display }));
  check('con un enlace público el detalle se abre sin poder editar: sin guardar, eliminar ni agregar', ro.title === 'Write copy' && ro.editable === 0 && J(ro.botones) === J(['no']) && ro.enlace === 'https://example.com/a' && ro.personas === 2 && ro.arrastra === 'false' && ro.menu === 'none', ro);
  await gp.keyboard.press('Escape'); await gp.waitForSelector('.lmd-cd', { state: 'detached' });
  await guest.ctx.close();

  console.log('Interfaz: Ajustes > API y automatizaciones');
  await page.click('[data-act=settings]'); await page.waitForSelector('[data-ptab=auto]'); await page.click('[data-ptab=auto]'); await page.waitForSelector('.lmd-au-list');
  s = await page.evaluate(() => ({ tab: document.querySelector('[data-ptab=auto]').textContent, heads: [...document.querySelectorAll('[data-auto-pane] h4')].map((h) => h.textContent), rows: [...document.querySelectorAll('[data-list=hooks] .lmd-au-item')].map((li) => li.querySelector('div').textContent), text: document.querySelector('[data-auto-pane]').textContent, api: document.querySelector('[data-auto-pane] .lmd-field input').value, toks: document.querySelectorAll('[data-list=tokens] li').length, make: (document.querySelector('[data-auto-pane] [data-c=token]') || {}).textContent, makeFill: !!document.querySelector('[data-auto-pane] [data-c=token].lmd-btn-fill'), kept: (document.querySelector('[data-auto-pane] .lmd-tok-kept') || {}).textContent, docs: document.querySelector('.lmd-au-docs').href, wide: document.querySelector('.lmd-panel-body').scrollWidth <= document.querySelector('.lmd-panel-body').clientWidth + 1 }));
  check('la pestaña lista los avisos con su ámbito, sus eventos y adónde van', s.tab === 'API and automations' && J(s.heads) === J(['API tokens', 'Webhooks', 'Inbound addresses']) && s.rows.some((r) => /^Team channel/.test(r) && /ui\/board\.md · 5 events · Slack/.test(r) && /127\.0\.0\.1/.test(r)) && s.rows.some((r) => /All notes/.test(r)), s.rows);
  check('sin secretos a la vista, sin signos de admiración ni rayas, y sin desborde', !/whsec_|mdi_/.test(s.text) && plain(s.text) && s.wide, s.text.slice(0, 300));
  check('la API va primero: su dirección, los tokens de la cuenta, crear uno y el enlace a la referencia', s.api === base + '/api/v1' && s.docs === 'https://sharpmd.app/api.html' && s.toks >= 1 && s.make === 'Create another token' && !s.makeFill && s.kept === 'The token is already created. For security it is not shown again: if you lost it, regenerate it.', [s.api, s.docs, s.toks, s.make, s.makeFill, s.kept]);
  // Un token se crea y se revoca ahí mismo, sin pasar por la pestaña de IA.
  const toks0 = s.toks;
  await page.click('[data-auto-pane] [data-c=token]'); await page.waitForSelector('[data-auto-pane] [data-api-token]');
  const tokMade = await page.evaluate(() => ({ token: document.querySelector('[data-api-token]').value, note: document.querySelector('[data-auto-pane] .lmd-ai-new').textContent, rows: [...document.querySelectorAll('[data-list=tokens] li span')].map((x) => x.textContent), tab: document.querySelector('[data-ptab].lmd-on').dataset.ptab }));
  const works = await v1('GET', '/me', undefined, tokMade.token);
  check('"Crear un token" lo crea ahí mismo y lo muestra una sola vez, y el token anda contra la API', /^mdt_/.test(tokMade.token) && /not shown again/.test(tokMade.note) && tokMade.rows.length === toks0 + 1 && tokMade.rows.some((r) => /^API · All notes/.test(r)) && tokMade.tab === 'auto' && works.status === 200, [tokMade.rows, tokMade.tab, works.status]);
  // Regenerar: pregunta antes, y el mismo token queda con un secreto nuevo a la vista.
  await page.locator('[data-list=tokens] li', { hasText: /^API · / }).locator('[data-tg]').click(); await page.waitForSelector('.lmd-dlg-card');
  const reAsk = await page.evaluate(() => { const c = document.querySelector('.lmd-dlg-card'); return { title: c.querySelector('h3').textContent, text: c.querySelector('p').textContent, ok: c.querySelector('[data-dlg=ok]').textContent, danger: c.querySelector('[data-dlg=ok]').classList.contains('lmd-btn-danger') }; });
  await page.click('.lmd-dlg-card [data-dlg=ok]'); await page.waitForFunction((old) => { const n = document.querySelector('[data-api-token]'); return n && n.value !== old; }, tokMade.token);
  const reTok = await page.evaluate(() => ({ token: document.querySelector('[data-api-token]').value, rows: document.querySelectorAll('[data-list=tokens] li').length, kept: document.querySelectorAll('[data-auto-pane] .lmd-tok-kept').length, acts: [...document.querySelector('[data-list=tokens] li').querySelectorAll('button')].map((b) => b.textContent) }));
  check('"Regenerate" pregunta antes, y deja el mismo token con un secreto nuevo a la vista: el viejo deja de servir y el nuevo anda', reAsk.title === 'Regenerate this token?' && reAsk.text === 'Connections using this token stop working. You will have to paste the new token wherever you use it.' && reAsk.ok === 'Regenerate' && reAsk.danger && /^mdt_/.test(reTok.token) && reTok.token !== tokMade.token && reTok.rows === toks0 + 1 && reTok.kept === 0 && reTok.acts.join() === 'Regenerate,Revoke' && (await v1('GET', '/me', undefined, tokMade.token)).status === 401 && (await v1('GET', '/me', undefined, reTok.token)).status === 200, [reAsk, reTok]);
  await page.locator('[data-list=tokens] li', { hasText: /^API · / }).locator('[data-tk]').click(); await page.waitForSelector('.lmd-dlg-card'); await page.click('.lmd-dlg-card [data-dlg=ok]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-list=tokens] li').length === n && !document.querySelector('[data-api-token]'), toks0);
  check('revocarlo lo saca de la lista y deja de servir', (await v1('GET', '/me', undefined, reTok.token)).status === 401);
  const row = page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Team channel' });
  await row.locator('[data-ha=log]').click(); await page.waitForSelector('.lmd-au-log .lmd-au-table');
  const logText = await page.textContent('.lmd-au-log');
  check('el registro de entregas muestra estado, respuesta y duración', /Delivery log/.test(logText) && /Delivered/.test(logText) && /200/.test(logText) && /Test/.test(logText) && plain(logText), logText.slice(0, 300));
  await page.click('.lmd-au-log [data-au=no]');
  // Editar: la misma pantalla, ya cargada. La dirección no vuelve del servidor: vacía, queda la de ahora.
  await row.locator('[data-ha=edit]').click(); await page.waitForSelector('.lmd-au-wiz');
  s = await form(page);
  check('editar abre la misma pantalla ya cargada, sin plantillas y con la dirección a medias', s.title === 'Edit automation' && !s.tpl.length && s.name === 'Team channel' && s.scope === 'note:ui/board.md' && s.format === 'slack' && /^When: A card moves/.test(s.aria) && s.url === '' && /^http:\/\/127\.0\.0\.1:\d+\/…lack$/.test(s.hint) && s.tip === 'Empty: the current address stays.' && !s.off && /notify Slack \(127\.0\.0\.1:\d+\)\.$/.test(s.sum), s);
  await page.click('.lmd-au-wiz .lmd-ms-btn svg'); await page.waitForSelector('.lmd-ms-pop');
  await page.click('.lmd-ms-pop [data-ms-all="0"]'); await page.click('.lmd-ms-pop [data-v="card.done"]'); await page.keyboard.press('Escape');
  await page.fill('.lmd-au-wiz [data-au=name]', 'Team channel 2');
  const sentEdit = await sentBy(page, () => page.click('.lmd-au-wiz [data-au=save]'), 'PUT');
  await page.waitForSelector('.lmd-au-wiz [data-au=test]');
  const savedTitle = await page.textContent('.lmd-au-wiz h3');
  got.length = 0; await page.click('.lmd-au-wiz [data-au=test]'); await page.waitForSelector('.lmd-au-result:not([hidden])');
  check('guardar los cambios manda solo lo que cambia, sin tocar la dirección, y la prueba sigue llegando al mismo lugar', sentEdit === J({ name: 'Team channel 2', scope: { kind: 'note', path: 'ui/board.md' }, events: ['card.done'], format: 'slack', include_text: false }) && savedTitle === 'Automation saved' && /^The test arrived/.test(await page.textContent('.lmd-au-result')) && at('/ui-slack').length === 1, [sentEdit, savedTitle, at('/ui-slack').length]);
  await page.click('.lmd-au-wiz [data-au=no]'); await page.waitForSelector('.lmd-au-wiz', { state: 'detached' });
  const row2 = page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Team channel 2' });
  await row2.waitFor();
  check('y la lista lo muestra cambiado', /ui\/board\.md · 1 event · Slack/.test(await row2.textContent()), await row2.textContent());
  await row2.locator('[data-ha=pause]').click(); await page.waitForSelector('[data-list=hooks] .lmd-au-off');
  check('pausar lo deja a la vista como pausado', /Paused/.test(await page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Team channel 2' }).textContent()));

  console.log('Interfaz: el formulario en una pantalla');
  await page.click('[data-auto-pane] [data-c=hook]'); await page.waitForSelector('.lmd-au-wiz');
  s = await form(page);
  const btnOf = () => page.evaluate(() => { const b = document.querySelector('.lmd-au-wiz .lmd-ms-btn'); return { pop: b.getAttribute('aria-haspopup'), open: b.getAttribute('aria-expanded'), list: !!document.getElementById(b.getAttribute('aria-controls')), focus: document.activeElement === b, dialog: !!document.querySelector('.lmd-au-wiz [data-au=save]') }; });
  let b = await btnOf();
  check('vacío: el campo de eventos lo dice, no hay resumen y Guardar espera', s.field === 'Pick what to notify' && s.aria === 'When: Pick what to notify' && !s.chips.length && !s.sum && s.off && s.miss === 'To save, add: an event, the address.' && !s.errEv && !s.errUrl && s.scope === 'all' && s.tpl.every((x) => !/\*/.test(x)) && plain(s.text), s);
  check('el desplegable es un botón con aria-haspopup y aria-expanded, y arranca con el foco', b.pop === 'listbox' && b.open === 'false' && b.focus && !(await page.locator('.lmd-au-wiz select[multiple]').count()), b);
  // Por teclado: flecha abre, flechas recorren, espacio tilda, escribir busca, Enter tilda, Escape cierra solo la lista.
  await page.keyboard.press('ArrowDown'); await page.waitForSelector('.lmd-ms-pop');
  const pop = () => page.evaluate(() => { const p = document.querySelector('.lmd-ms-pop'); const l = p.querySelector('[role=listbox]'); const q = p.querySelector('.lmd-ms-q'); const a = document.activeElement; const on = document.getElementById(a.getAttribute('aria-activedescendant') || '');
    return { multi: l.getAttribute('aria-multiselectable'), groups: [...l.querySelectorAll('[role=group]')].filter((g) => !g.hidden).map((g) => g.getAttribute('aria-label')), opts: [...l.querySelectorAll('[role=option][data-v]')].filter((o) => !o.hidden).map((o) => o.dataset.v), picked: [...l.querySelectorAll('[role=option][data-v][aria-selected=true]')].map((o) => o.dataset.v),
      all: [...l.querySelectorAll('[data-ms-all]')].map((o) => o.getAttribute('aria-selected') + (o.classList.contains('lmd-ms-some') ? '~' : '')), allText: l.querySelector('[data-ms-all] small').textContent, focus: a === l ? 'list' : a === q ? 'search' : a.className, active: on ? on.dataset.v || 'all:' + on.dataset.msAll : '', search: !!q && q.getAttribute('role') === 'combobox', layer: p.parentNode.classList.contains('lmd-au-wiz'), none: !p.querySelector('.lmd-ms-nothing').hidden }; });
  let p = await pop(); b = await btnOf();
  check('flecha abajo lo abre: una lista de selección múltiple con los tres grupos, el buscador y el foco adentro', b.open === 'true' && b.list && p.multi === 'true' && J(p.groups) === J(['Board cards', 'Notes', 'Comments']) && p.opts.length === 12 && p.search && p.focus === 'list' && p.active === 'all:0' && p.allText === 'All in this group' && p.layer, [b, p]);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  p = await pop(); s = await form(page);
  check('las flechas recorren y espacio tilda: la ficha aparece sin cerrar la lista', p.active === 'card.done' && J(p.picked) === J(['card.done']) && J(s.chips) === J(['A card is marked done']) && J(p.all) === J(['false~', 'false', 'false']), [p, s.chips]);
  await page.keyboard.type('comm');
  p = await pop();
  check('escribir busca: quedan los comentarios, con el foco en el buscador', p.focus === 'search' && J(p.groups) === J(['Comments']) && J(p.opts) === J(['comment.created', 'comment.resolved']) && p.active === 'all:2', p);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  p = await pop(); s = await form(page);
  check('y Enter tilda lo que está marcado', p.active === 'comment.created' && J(p.picked) === J(['card.done', 'comment.created']) && J(s.chips) === J(['A card is marked done', 'There is a new comment']), [p, s.chips]);
  await page.fill('.lmd-ms-q', 'zzz');
  const nothing = (await pop()).none;
  await page.fill('.lmd-ms-q', '');
  await page.keyboard.press('Escape'); await sleep(120);
  b = await btnOf();
  check('Escape cierra solo el desplegable: el diálogo sigue y el foco vuelve al botón', nothing && !(await page.locator('.lmd-ms-pop').count()) && b.dialog && b.focus && b.open === 'false', [nothing, b]);
  // Con clic: una opción, "todas las de este grupo", y afuera para cerrar.
  await page.click('.lmd-au-wiz .lmd-ms-btn svg'); await page.waitForSelector('.lmd-ms-pop');
  await page.click('.lmd-ms-pop [data-v="note.created"]');
  s = await form(page);
  const one = s.chips.slice();
  await page.click('.lmd-ms-pop [data-ms-all="1"]');
  p = await pop(); s = await form(page);
  check('con clic se tilda una, y "todas las de este grupo" tilda el grupo entero; si no entran, queda el resumen', J(one) === J(['A card is marked done', 'A note is created', 'There is a new comment']) && J(p.picked) === J(['card.done', 'note.created', 'note.updated', 'note.moved', 'note.deleted', 'note.restored', 'comment.created']) && J(p.all) === J(['false~', 'true', 'false~']) && s.many && s.field === '7 events' && /^When any of the 7 picked events happens, in all my notes, notify Slack\.$/.test(s.sum), [one, p, s]);
  await page.click('.lmd-ms-pop [data-ms-all="1"]');
  p = await pop();
  await page.mouse.click(6, 6); await sleep(120);
  b = await btnOf(); s = await form(page);
  check('otra vez lo destilda, y un clic afuera cierra la lista sin cerrar el diálogo', J(p.picked) === J(['card.done', 'comment.created']) && !(await page.locator('.lmd-ms-pop').count()) && b.dialog && J(s.chips) === J(['A card is marked done', 'There is a new comment']) && !s.many && s.sum === 'When a card is marked done or there is a new comment, in all my notes, notify Slack.', [p, b, s]);
  await page.click('.lmd-au-wiz [data-ms-rm="card.done"]');
  s = await form(page);
  const less = s;
  await page.click('.lmd-au-wiz [data-ms-rm="comment.created"]');
  s = await form(page);
  check('la cruz de una ficha la quita; sin ninguna, el campo lo dice ahí mismo', J(less.chips) === J(['There is a new comment']) && less.sum === 'When there is a new comment, in all my notes, notify Slack.' && !less.errEv && !s.chips.length && s.errEv === 'Pick at least one event.' && s.bad === 'true' && !s.sum && s.off && /an event/.test(s.miss), [less, s]);
  // Plantillas: un clic llena los eventos y el nombre, mientras el nombre no sea de la persona.
  await page.click('.lmd-au-wiz [data-au-tpl="0"]');
  const t1 = await form(page);
  await page.click('.lmd-au-wiz [data-au-tpl="2"]');
  const t2 = await form(page);
  await page.fill('.lmd-au-wiz [data-au=name]', 'Leads'); await page.click('.lmd-au-wiz [data-au-tpl="3"]');
  const t3 = await form(page);
  check('las plantillas llenan los eventos y el nombre en un clic, y no pisan un nombre escrito a mano', J(t1.chips) === J(['A card is marked done']) && t1.name === 'Task done' && /^Task done\*/.test(t1.tpl.join()) && !t1.errEv && J(t2.chips) === J(['A note is created']) && t2.name === 'New note' && t2.tpl[2] === 'New note*' && J(t3.chips) === J(['There is a new comment']) && t3.name === 'Leads', [t1, t2, t3]);
  const scopes = await page.evaluate(() => { const sel = document.querySelector('.lmd-au-wiz [data-au=scope]'); return { first: sel.options[0].textContent, groups: [...sel.querySelectorAll('optgroup')].map((g) => g.label), folder: !!sel.querySelector('option[value="folder:ui"]'), note: !!sel.querySelector('option[value="note:ui/board.md"]') }; });
  await page.selectOption('.lmd-au-wiz [data-au=scope]', 'folder:ui'); await page.selectOption('.lmd-au-wiz [data-au=format]', 'json');
  await page.fill('.lmd-au-wiz [data-au=url]', SINK + '/ui-json');
  s = await form(page);
  check('el alcance es un desplegable (todo, una carpeta o una nota) y el resumen lo sigue', scopes.first === 'All my notes' && J(scopes.groups) === J(['Folders', 'Notes']) && scopes.folder && scopes.note && s.sum === 'When there is a new comment, in the folder ui/, notify ' + SINK.slice(7) + '.', [scopes, s.sum]);
  check('con JSON aparece "Más opciones", plegado, con incluir el contenido', s.more && s.hint === 'https://' && (await page.evaluate(() => { const d = document.querySelector('.lmd-au-more'); return !d.open && d.querySelector('summary').textContent === 'More options' && !!d.querySelector('[data-au=text]'); })), s);
  await page.click('.lmd-au-more summary'); await page.check('.lmd-au-wiz [data-au=text]');
  const sentJson = await sentBy(page, () => page.press('.lmd-au-wiz [data-au=url]', 'Enter')); // Enter en un campo de texto guarda
  await page.waitForSelector('.lmd-au-wiz [data-au=test]');
  const oldBody = { name: 'Leads', url: SINK + '/ui-json', scope: { kind: 'folder', path: 'ui' }, events: ['comment.created'], format: 'json', include_text: true, lang: 'en' };
  const viaOld = (await api('POST', '/automations/hooks', oldBody, K.ana.s)).json.hook;
  const kept = (h) => J([h.name, h.destination, h.scope, h.events, h.format, h.include_text, h.lang, h.state]);
  const viaForm = (await api('GET', '/automations', undefined, K.ana.s)).json.hooks.find((h) => String(h.id) === String(viaOld.id - 1));
  check('para la misma elección, lo que queda guardado es idéntico a lo que guardaba el alta de tres pasos', sentJson === J(oldBody) && !!viaForm && kept(viaForm) === kept(viaOld), [sentJson, viaForm, viaOld]);
  await api('DELETE', '/automations/hooks/' + viaOld.id, undefined, K.ana.s);
  const secretShown = await page.inputValue('.lmd-au-wiz .lmd-field input');
  got.length = 0; await page.click('.lmd-au-wiz [data-au=test]'); await page.waitForSelector('.lmd-au-result:not([hidden])');
  check('con JSON, al guardar se ve el secreto una vez y la prueba llega firmada con él', /^whsec_/.test(secretShown) && at('/ui-json').length === 1 && signed(at('/ui-json')[0], secretShown) && at('/ui-json')[0].json.type === 'ping', [secretShown.slice(0, 8), at('/ui-json').length]);
  await page.click('.lmd-au-wiz [data-au=no]'); await page.waitForSelector('.lmd-au-wiz', { state: 'detached' });
  // Eliminar, desde la lista.
  const leads = page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Leads' }); await leads.waitFor();
  await leads.locator('[data-ha=rm]').click(); await page.waitForSelector('.lmd-dlg-card'); await page.click('.lmd-dlg-card [data-dlg=ok]'); await leads.waitFor({ state: 'detached' });
  check('eliminar la saca de la lista y del servidor', !(await api('GET', '/automations', undefined, K.ana.s)).json.hooks.some((h) => h.name === 'Leads'));
  // La lista no se sale de la ventana ni la corta el borde del diálogo: en una ventana baja se abre para arriba.
  await page.setViewportSize({ width: 620, height: 430 });
  await page.click('[data-auto-pane] [data-c=hook]'); await page.waitForSelector('.lmd-au-wiz');
  await page.click('.lmd-au-wiz .lmd-ms-btn'); await page.waitForSelector('.lmd-ms-pop'); await sleep(200);
  const near = await page.evaluate(() => { const r = document.querySelector('.lmd-ms-pop').getBoundingClientRect(); const f = document.querySelector('.lmd-au-wiz .lmd-ms').getBoundingClientRect(); const l = document.querySelector('.lmd-ms-list'); return { top: r.top, bottom: r.bottom, h: innerHeight, up: r.bottom <= f.top, down: r.top >= f.bottom, w: Math.abs(r.width - f.width) < 2, scrolls: l.scrollHeight > l.clientHeight, sheet: document.querySelector('.lmd-ms-pop').classList.contains('lmd-ms-sheet') }; });
  check('cerca del borde de abajo la lista queda entera a la vista, con scroll adentro', near.top >= 0 && near.bottom <= near.h && (near.up || near.down) && near.w && near.scrolls && !near.sheet, near);
  await page.setViewportSize({ width: 620, height: 330 }); await sleep(200);
  const tight = await page.evaluate(() => { const r = document.querySelector('.lmd-ms-pop').getBoundingClientRect(); const f = document.querySelector('.lmd-au-wiz .lmd-ms').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, up: r.bottom <= f.top, down: r.top >= f.bottom, field: [f.top, f.bottom] }; });
  check('y al achicarse la ventana se vuelve a acomodar sin salirse', tight.top >= 0 && tight.bottom <= tight.h && (tight.up || tight.down), tight);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForSelector('.lmd-au-wiz', { state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 800 });
  // Un aviso que se desactivó solo se ve con su aviso y se puede volver a prender.
  const dead = (await api('POST', '/automations/hooks', { name: 'Broken', url: SINK + '/fail', scope: { kind: 'folder', path: 'boom' }, events: ['note.created'] }, K.ana.s)).json.hook;
  await v1('PUT', '/note', { path: 'boom/a.md', text: '# A\n' }, K.token); await v1('PUT', '/note', { path: 'boom/b.md', text: '# B\n' }, K.token);
  await until(async () => (await api('GET', '/automations', undefined, K.ana.s)).json.hooks.find((h) => h.id === dead.id && h.state === 'failed'), 6000);
  await page.click('[data-ptab=look]'); await page.click('[data-ptab=auto]'); await page.waitForSelector('.lmd-au-warn[role=alert]');
  const broken = await page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Broken' }).textContent();
  check('el que se desactivó por fallos lo dice y ofrece volver a prenderlo', /Turned off after repeated failures\./.test(broken) && /Turn back on/.test(broken), broken);
  await api('DELETE', '/automations/hooks/' + dead.id, undefined, K.ana.s);
  await page.click('[data-c=inbox]'); await page.waitForSelector('.lmd-au-in');
  await page.fill('.lmd-au-in [data-au=note]', 'in/from-ui'); await page.fill('.lmd-au-in [data-au=tpl]', '- {{date}} {{text}}'); await page.click('.lmd-au-in [data-au=ok]');
  await page.waitForSelector('[data-in-url]');
  const inUrl = await page.inputValue('[data-in-url]');
  const sent = await post(inUrl, 'From a form', 'text/plain');
  const made = (await api('GET', '/notes/' + encodeURIComponent('in/from-ui.md'), undefined, K.ana.s)).json;
  check('una dirección de entrada creada desde la app recibe y escribe en la nota', new RegExp('^' + base + '/in/mdi_').test(inUrl) && sent.status === 200 && /^- \d{4}-\d\d-\d\d From a form\n$/.test(made.text || ''), [inUrl.slice(0, 40), sent.status, made.text]);
  await page.click('[data-c=copy]');
  s = await page.evaluate(() => ({ rows: [...document.querySelectorAll('[data-list=inboxes] .lmd-au-item')].map((li) => li.querySelector('div').textContent), note: document.querySelector('.lmd-ai-new').textContent }));
  check('la dirección se ve una sola vez, con copiar, y la lista dice qué hace', /Adds to in\/from-ui\.md/.test(s.rows.join('|')) && /not shown again/.test(s.note) && !s.rows.join('|').includes(inUrl.split('/in/')[1]), s);
  await page.keyboard.press('Escape');

  console.log('Interfaz: desde el explorador y sin plan');
  const dirNode = page.locator('.lmd-node-dir', { hasText: 'ui' }).first();
  if (await dirNode.count()) {
    await dirNode.click({ button: 'right' }); await page.waitForSelector('.lmd-menu [data-f=auto]');
    const item = await page.textContent('.lmd-menu [data-f=auto]');
    await page.click('.lmd-menu [data-f=auto]'); await page.waitForSelector('.lmd-au-wiz');
    s = await form(page);
    check('el menú de una carpeta ofrece "Automate…" con esa carpeta ya puesta', item === 'Automate…' && s.scope === 'folder:ui' && !s.chips.length && s.field === 'Pick what to notify', [item, s]);
    await page.keyboard.press('Escape');
  } else check('el menú de una carpeta ofrece "Automate…" con esa carpeta ya puesta', false, 'no encontré la carpeta en el explorador');
  const lia = await R.open(K.free);
  await lia.page.goto(R.home + '#lmd-auto'); await lia.page.waitForSelector('[data-auto-pane] .lmd-extra');
  const gate = await lia.page.textContent('[data-auto-pane]');
  check('sin plan pago se ve la sección con el aviso de plan', /The API and automations are part of the paid plan\./.test(gate) && /See plans/.test(gate) && plain(gate), gate);
  await lia.ctx.close();

  console.log('Interfaz: pantalla chica');
  const small = await R.open(K.ana, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const sp = small.page;
  await sp.goto(R.noteUrl('ui/board.md')); await sp.waitForSelector('.lmd-board .lmd-card');
  s = await sp.evaluate(() => { const b = document.querySelector('.lmd-board'); const col = b.querySelector('.lmd-col').getBoundingClientRect(); return { page: document.documentElement.scrollWidth <= window.innerWidth, snap: getComputedStyle(b).scrollSnapType, col: col.width, scrolls: b.scrollWidth > b.clientWidth, open: getComputedStyle(b.querySelector('.lmd-col-menu')).opacity, sinControles: b.querySelectorAll('.lmd-card input, .lmd-card button').length === 0 }; });
  check('el tablero se desliza con el dedo, con columnas que encajan, sin mover la página', s.page && /x mandatory/.test(s.snap) && s.col > 250 && s.col < 340 && s.scrolls && s.open === '1' && s.sinControles, s);
  // deslizar el tablero con el dedo no abre una tarjeta; un toque, sí
  const cdp = await small.ctx.newCDPSession(sp); const cb = await sp.locator('.lmd-card', { hasText: 'Pick a name' }).boundingBox().catch(() => null);
  const first = await sp.locator('.lmd-card').first().boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x + 40, y: first.y + 12 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: first.x + 40 - i * 18, y: first.y + 12 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
  check('deslizar sobre una tarjeta no la abre', (await sp.locator('.lmd-cd').count()) === 0 && cb !== undefined);
  await sp.evaluate(() => { document.querySelector('.lmd-board').scrollLeft = 0; }); await sleep(300);
  await sp.evaluate(() => [...document.querySelectorAll('.lmd-card')].find((c) => /Pick a name/.test(c.textContent)).scrollIntoView({ inline: 'center', block: 'center' })); await sleep(400);
  await sp.locator('.lmd-card', { hasText: 'Pick a name' }).tap(); await sp.waitForSelector('.lmd-cd');
  await sp.tap('.lmd-cd [data-cd=add-open]'); await sp.tap('.lmd-cd [data-cd-use=assignee]'); await sp.fill('.lmd-cd [data-cd=newval]', 'Lia'); await sp.tap('.lmd-cd [data-cd=add]');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-cd-card').getBoundingClientRect(); const tap = [...document.querySelectorAll('.lmd-cd-card button, .lmd-cd-card select, .lmd-cd-card input[type=text]')].filter((n) => n.offsetParent).map((n) => Math.round(n.getBoundingClientRect().height)); return { fits: c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight + 1, min: Math.min(...tap), page: document.documentElement.scrollWidth <= window.innerWidth }; });
  check('el detalle de la tarjeta entra en la pantalla y se toca cómodo', s.fits && s.page && s.min >= 32, s);
  await sp.tap('.lmd-cd [data-cd=ok]'); await sp.waitForSelector('.lmd-cd', { state: 'detached' });
  check('y guarda', /Pick a name \{assignee=Lia id=/.test((await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text) || !!(await until(async () => /Pick a name \{assignee=Lia id=/.test((await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text), 6000)));
  await sp.tap('[data-act=more]'); await sp.waitForSelector('.lmd-menu-more');
  const more = await sp.textContent('.lmd-menu-more');
  await sp.tap('.lmd-menu-more [data-more=page]'); await sp.waitForSelector('.lmd-pg');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-pg .lmd-ask-card').getBoundingClientRect(); return { fits: c.left >= 0 && c.right <= window.innerWidth, text: document.querySelector('.lmd-pg').textContent }; });
  check('"más" trae Ajustes de la página, y la ventana entra', /Page settings/.test(more) && s.fits && /Page width/.test(s.text) && plain(s.text), [more, s]);
  await sp.tap('.lmd-pg [data-pg=ok]');
  await sp.goto(R.home + '#lmd-auto'); await sp.waitForSelector('.lmd-au-list');
  s = await sp.evaluate(() => ({ body: document.querySelector('.lmd-panel-body').scrollWidth <= document.querySelector('.lmd-panel-body').clientWidth + 1, page: document.documentElement.scrollWidth <= window.innerWidth, btn: Math.min(...[...document.querySelectorAll('.lmd-au-acts button')].map((b) => b.getBoundingClientRect().height)) }));
  check('API y automatizaciones en pantalla chica: sin desborde y con botones que se tocan', s.body && s.page && s.btn >= 32, s);
  await sp.tap('[data-c=hook]'); await sp.waitForSelector('.lmd-au-wiz');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-au-wiz .lmd-ask-card').getBoundingClientRect(); return { fits: c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight + 1, wide: document.querySelector('.lmd-au-wiz .lmd-ask-card').scrollWidth <= document.querySelector('.lmd-au-wiz .lmd-ask-card').clientWidth + 1, tap: Math.min(...[...document.querySelectorAll('.lmd-au-wiz select, .lmd-au-wiz input[type=text], .lmd-au-wiz input[type=url], .lmd-au-wiz .lmd-ms, .lmd-au-wiz .lmd-btn, .lmd-au-wiz [data-au-tpl]')].map((n) => Math.round(n.getBoundingClientRect().height))) }; });
  check('el formulario entra en la pantalla, sin desborde y con controles que se tocan', s.fits && s.wide && s.tap >= 36, s);
  await sp.tap('.lmd-au-wiz .lmd-ms-btn'); await sp.waitForSelector('.lmd-ms-pop'); await sleep(250);
  s = await sp.evaluate(() => { const n = document.querySelector('.lmd-ms-pop'); const r = n.getBoundingClientRect(); return { sheet: n.classList.contains('lmd-ms-sheet'), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom), tall: r.height / window.innerHeight, row: Math.min(...[...n.querySelectorAll('[role=option]')].map((o) => o.getBoundingClientRect().height)), done: (n.querySelector('[data-ms-done]') || {}).offsetHeight || 0, typing: document.activeElement.tagName, page: document.documentElement.scrollWidth <= window.innerWidth }; });
  check('en teléfono el desplegable es una hoja pegada abajo, con filas que se tocan y sin abrir el teclado', s.sheet && s.left === 8 && s.right === 8 && s.bottom === 8 && s.tall <= 0.62 && s.row >= 44 && s.done >= 40 && s.typing !== 'INPUT' && s.page, s);
  await sp.tap('.lmd-ms-pop [data-v="card.done"]'); await sp.tap('.lmd-ms-pop [data-ms-all="2"]');
  await sp.evaluate(() => history.back()); await sleep(350);
  s = await sp.evaluate(() => ({ pop: !!document.querySelector('.lmd-ms-pop'), dialog: !!document.querySelector('.lmd-au-wiz [data-au=save]'), chips: [...document.querySelectorAll('.lmd-au-wiz .lmd-ms-chip > span')].map((n) => n.textContent), many: document.querySelector('.lmd-au-wiz .lmd-ms-text').textContent }));
  check('el atrás del sistema cierra la hoja y deja el formulario con lo elegido', !s.pop && s.dialog && (s.chips.length === 3 || s.many === '3 events'), s);
  await sp.tap('.lmd-au-wiz .lmd-ms-btn svg'); await sp.waitForSelector('.lmd-ms-pop'); await sp.tap('.lmd-ms-pop [data-ms-done]'); await sleep(100);
  check('y "Listo" también la cierra', !(await sp.locator('.lmd-ms-pop').count()) && !!(await sp.locator('.lmd-au-wiz [data-au=save]').count()));
  await small.ctx.close();

  console.log('Interfaz: en español');
  const es = await R.open(K.ana, { viewport: { width: 1280, height: 800 } });
  await es.ctx.addInitScript(() => { try { const st = JSON.parse(localStorage.getItem('mdtools:settings') || '{}'); st.language = 'es'; localStorage.setItem('mdtools:settings', JSON.stringify(st)); } catch (e) { /* sin almacenamiento */ } });
  const ep = es.page;
  await ep.goto(R.home + '#lmd-auto'); await ep.waitForSelector('.lmd-au-list');
  await ep.click('[data-auto-pane] [data-c=hook]'); await ep.waitForSelector('.lmd-au-wiz');
  await ep.click('.lmd-au-wiz [data-au-tpl="0"]');
  await ep.click('.lmd-au-wiz .lmd-ms-btn svg'); await ep.waitForSelector('.lmd-ms-pop');
  const esPop = await ep.evaluate(() => ({ groups: [...document.querySelectorAll('.lmd-ms-pop [role=group]')].map((g) => g.getAttribute('aria-label')), all: document.querySelector('.lmd-ms-pop [data-ms-all] small').textContent, q: document.querySelector('.lmd-ms-q').placeholder, cut: [...document.querySelectorAll('.lmd-ms-pop [role=option] span')].filter((n) => n.scrollWidth > n.clientWidth + 1).length }));
  await ep.click('.lmd-ms-pop [data-v="note.created"]'); await ep.keyboard.press('Escape');
  await ep.fill('.lmd-au-wiz [data-au=url]', SINK + '/ui-es');
  s = await form(ep);
  const fitsEs = await ep.evaluate(() => { const c = document.querySelector('.lmd-au-wiz .lmd-ask-card'); const cut = (q) => [...c.querySelectorAll(q)].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent); return { wide: c.scrollWidth <= c.clientWidth + 1, cut: cut('.lmd-au-lab, [data-au-tpl], .lmd-ms-chip > span, .lmd-btn, .lmd-au-sum, .lmd-au-tip'), lab: Math.max(...[...c.querySelectorAll('.lmd-au-lab')].map((n) => n.getBoundingClientRect().height)) }; });
  check('en español: los rótulos, las plantillas, los grupos y el resumen', s.title === 'Nueva automatización' && J(s.labs) === J(['Nombre', 'Cuando', 'En', 'Avisar a']) && J(s.tpl) === J(['Tarea hecha', 'Cambios en tarjetas', 'Nota nueva', 'Comentario nuevo']) && J(esPop.groups) === J(['Tarjetas de un tablero', 'Notas', 'Comentarios']) && esPop.all === 'Todas las de este grupo' && esPop.q === 'Buscar' &&
    J(s.chips) === J(['Una tarjeta queda hecha', 'Se crea una nota']) && s.sum === 'Cuando una tarjeta queda hecha o se crea una nota, en todas mis notas, avisar a Slack (' + SINK.slice(7) + ').' && s.save === 'Guardar' && s.name === 'Tarea hecha' && plain(s.text), [s, esPop]);
  check('y los textos largos entran: nada cortado ni desbordado', fitsEs.wide && !fitsEs.cut.length && !esPop.cut && fitsEs.lab < 40, [fitsEs, esPop.cut]);
  await ep.fill('.lmd-au-wiz [data-au=url]', '');
  const esMiss = await form(ep);
  await ep.fill('.lmd-au-wiz [data-au=url]', SINK + '/ui-es');
  const sentEs = await sentBy(ep, () => ep.click('.lmd-au-wiz [data-au=save]'));
  await ep.waitForSelector('.lmd-au-wiz [data-au=test]');
  check('dice qué falta en español, y los avisos de esa automatización salen en español', esMiss.miss === 'Para guardar falta: la dirección.' && esMiss.off && JSON.parse(sentEs).lang === 'es' && J(JSON.parse(sentEs).events) === J(['card.done', 'note.created']) && (await ep.textContent('.lmd-au-wiz h3')) === 'Automatización creada', [esMiss.miss, sentEs]);
  await es.ctx.close();
  await page.context().close();
}

const failed = done();
if (R.errors.length) console.log('errores de página: ' + J(R.errors.slice(0, 5)));
await R.close(); sink.close();
process.exit(failed || bad || R.errors.length ? 1 : 0);
