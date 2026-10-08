// Automatizaciones, de punta a punta contra un servidor local: la API con token (/api/v1), los webhooks salientes
// (contra un receptor local que comprueba la firma), las direcciones de entrada (/in/…), los eventos de tarjeta
// venga el cambio de la app, de la API o del MCP, y la interfaz (Ajustes > Automatizaciones, el detalle de una
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
  check('el de una carpeta no recibe lo de afuera; el de una nota, solo esa nota', at('/slack').length === 1 && at('/one').length === 1, [at('/slack').length, at('/one').length]);
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
  await page.click('.lmd-cd [data-cd-sug=vence]'); await page.fill('.lmd-cd [data-cd-val=due]', '2026-10-20'); await page.click('.lmd-cd [data-cd=ok]');
  g = await until(() => at('/ok').find((x) => x.json && x.json.type === 'card.updated'), 9000);
  check('cambiar un atributo en el detalle dispara card.updated con el cambio', !!g && J(g.json.data.changes) === J({ due: { from: null, to: '2026-10-20' } }) && g.json.data.card.title === 'Write copy', g && g.json);
  const chip = await page.locator('.lmd-card', { hasText: 'Write copy' }).locator('.lmd-chip').first().textContent();
  check('y la tarjeta lo muestra en chico', /Oct 20/.test(chip), chip);

  // El servidor y la app leen el mismo formato: un mismo tablero da lo mismo de los dos lados.
  const sample = '{show=due,owner priority=low|medium|high n=number}\n## To do\n- [ ] A {due=2026-10-20 owner="Ana \\"P\\" Paz" id=aaaaaaaa created=2026-10-01T10:00:00Z}\n- [x] B\n- [ ] C {not attrs}\n* [ ] D {k=v}\n- [ ] F {a=1 {b=2}\n\n### Done\n- E {x=1 y="two words" id=eeeeeeee updated=2026-10-02T10:00:00Z}';
  await v1('PUT', '/note', { path: 'ui/parity.md', text: '```kanban\n' + sample + '\n```\n' }, K.token);
  const fromServer = (await v1('GET', '/boards?path=' + encodeURIComponent('ui/parity.md'), undefined, K.token)).json.data.boards[0];
  const fromApp = await page.evaluate((t) => LMD.board.model.parse(t), sample);
  const flat = (cols, title) => cols.map((c) => [c.title, c.cards.map((k) => [k.id || '', k[title], k.done, k.created || '', k.attrs])]);
  check('la app y el servidor leen igual un tablero: columnas, tarjetas, atributos y configuración', J(fromServer.show) === J(fromApp.show) && J(fromServer.fields) === J(fromApp.fields) && J(flat(fromServer.columns, 'title')) === J(flat(fromApp.columns, 'text')) && fromApp.columns[0].cards.length === 5 && fromApp.columns[0].cards[0].attrs.owner === 'Ana "P" Paz' && fromApp.columns[0].cards[2].text === 'C {not attrs}', [flat(fromServer.columns, 'title'), flat(fromApp.columns, 'text')]);
  const rewritten = (await v1('POST', '/boards/cards/eeeeeeee/done', { path: 'ui/parity.md' }, K.token)).json.data;
  const again = (await api('GET', '/notes/' + encodeURIComponent('ui/parity.md'), undefined, K.ana.s)).json.text;
  const appWrites = await page.evaluate((t) => LMD.board.model.serialize(LMD.board.model.parse(t)).join('\n'), again.split('\n').slice(1, -2).join('\n'));
  check('y lo que escribe el servidor, la app lo vuelve a escribir igual', rewritten.card.done === true && appWrites === again.split('\n').slice(1, -2).join('\n') && /^\{show=due,owner priority=low\|medium\|high n=number\}$/m.test(again), [again, appWrites]);

  console.log('Interfaz: alta guiada desde el tablero');
  await page.click('.lmd-board-menu'); await page.waitForSelector('.lmd-menu-board');
  const menuText = await page.textContent('.lmd-menu-board');
  await page.click('.lmd-menu-board [data-bm=notify]'); await page.waitForSelector('.lmd-au-wiz');
  let s = await page.evaluate(() => ({ step: document.querySelector('.lmd-au-step').textContent, kind: document.querySelector('.lmd-au-wiz input[name=lmd-au-kind]:checked').value, note: document.querySelector('.lmd-au-wiz [data-au=note]').value }));
  check('el menú del tablero ofrece avisar cuando cambie una tarjeta, con esa nota ya puesta', /Notify when a card changes/.test(menuText) && /Step 1 of 3 · Where to watch/.test(s.step) && s.kind === 'note' && s.note === 'ui/board.md', [menuText, s]);
  await page.click('.lmd-au-wiz [data-au=next]');
  s = await page.evaluate(() => ({ step: document.querySelector('.lmd-au-step').textContent, on: [...document.querySelectorAll('.lmd-au-wiz .lmd-au-body input:checked')].map((i) => i.value), all: document.querySelectorAll('.lmd-au-wiz .lmd-au-body input').length, groups: [...document.querySelectorAll('.lmd-au-group legend')].map((l) => l.textContent) }));
  check('paso 2: los eventos de tarjeta ya marcados, en grupos', /Step 2 of 3 · What to notify/.test(s.step) && J(s.on.sort()) === J(['card.created', 'card.deleted', 'card.done', 'card.moved', 'card.updated']) && s.all === 12 && J(s.groups) === J(['Board cards', 'Notes', 'Comments']), s);
  await page.click('.lmd-au-wiz [data-au=next]');
  s = await page.evaluate(() => ({ step: document.querySelector('.lmd-au-step').textContent, fmts: [...document.querySelectorAll('[data-au-fmt]')].map((b) => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')), text: document.querySelector('.lmd-au-wiz .lmd-ask-card').textContent }));
  check('paso 3: Slack, Discord o JSON, con Slack elegido', /Step 3 of 3 · Where to send/.test(s.step) && J(s.fmts) === J(['Slack*', 'Discord', 'Make, n8n, Zapier or other']) && plain(s.text), s);
  await page.fill('.lmd-au-wiz [data-au=url]', 'ftp://nada'); await page.click('.lmd-au-wiz [data-au=next]');
  const errText = await page.textContent('.lmd-au-wiz .lmd-dlg-err');
  check('una dirección que no es https se rechaza antes de mandar', /has to start with https/.test(errText) && plain(errText), errText);
  await page.click('.lmd-au-wiz [data-au=back]'); await page.click('.lmd-au-wiz [data-au=next]');
  check('volver atrás no pierde lo escrito', (await page.inputValue('.lmd-au-wiz [data-au=url]')) === 'ftp://nada');
  await page.fill('.lmd-au-wiz [data-au=url]', SINK + '/ui-slack'); await page.fill('.lmd-au-wiz [data-au=name]', 'Team channel'); await page.click('.lmd-au-wiz [data-au=next]');
  await page.waitForSelector('.lmd-au-wiz [data-au=test]');
  got.length = 0; await page.click('.lmd-au-wiz [data-au=test]'); await page.waitForSelector('.lmd-au-result:not([hidden])');
  const result = await page.textContent('.lmd-au-result');
  check('creada, "Send a test" manda el mensaje y dice que llegó', /^The test arrived \(\d+ ms\)\.$/.test(result) && at('/ui-slack').length === 1 && /SharpMD test/.test(at('/ui-slack')[0].json.text), [result, at('/ui-slack').length]);
  await page.click('.lmd-au-wiz [data-au=no]'); await page.waitForSelector('.lmd-au-wiz', { state: 'detached' });
  got.length = 0;
  await page.locator('.lmd-card', { hasText: 'Write copy' }).locator('.lmd-card-check').check();
  g = await until(() => at('/ui-slack').find((x) => /done/.test(x.json.text)), 9000);
  check('y de ahí en más Slack recibe la línea armada', !!g && /^Card "Write copy" done in <http[^|]+\|ui\/board\.md>$/.test(g.json.text), g && g.json);

  console.log('Interfaz: Ajustes > Automatizaciones');
  await page.click('[data-act=settings]'); await page.waitForSelector('[data-ptab=auto]'); await page.click('[data-ptab=auto]'); await page.waitForSelector('.lmd-au-list');
  s = await page.evaluate(() => ({ tab: document.querySelector('[data-ptab=auto]').textContent, heads: [...document.querySelectorAll('[data-auto-pane] h4')].map((h) => h.textContent), rows: [...document.querySelectorAll('[data-list=hooks] .lmd-au-item')].map((li) => li.querySelector('div').textContent), text: document.querySelector('[data-auto-pane]').textContent, api: [...document.querySelectorAll('[data-auto-pane] .lmd-field input')].pop().value, docs: document.querySelector('.lmd-au-docs').href, wide: document.querySelector('.lmd-panel-body').scrollWidth <= document.querySelector('.lmd-panel-body').clientWidth + 1 }));
  check('la pestaña lista los avisos con su ámbito, sus eventos y adónde van', s.tab === 'Automations' && J(s.heads) === J(['Outgoing notifications', 'Inbound addresses', 'API']) && s.rows.some((r) => /^Team channel/.test(r) && /ui\/board\.md · 5 events · Slack/.test(r) && /127\.0\.0\.1/.test(r)) && s.rows.some((r) => /All notes/.test(r)), s.rows);
  check('sin secretos a la vista, sin signos de admiración ni rayas, y sin desborde', !/whsec_|mdi_/.test(s.text) && plain(s.text) && s.wide, s.text.slice(0, 300));
  check('la API: su dirección y el enlace a la documentación', s.api === base + '/api/v1' && s.docs === 'https://sharpmd.app/api.html', [s.api, s.docs]);
  const row = page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Team channel' });
  await row.locator('[data-ha=log]').click(); await page.waitForSelector('.lmd-au-log .lmd-au-table');
  const logText = await page.textContent('.lmd-au-log');
  check('el registro de entregas muestra estado, respuesta y duración', /Delivery log/.test(logText) && /Delivered/.test(logText) && /200/.test(logText) && /Test/.test(logText) && plain(logText), logText.slice(0, 300));
  await page.click('.lmd-au-log [data-au=no]');
  await row.locator('[data-ha=pause]').click(); await page.waitForSelector('[data-list=hooks] .lmd-au-off');
  check('pausar lo deja a la vista como pausado', /Paused/.test(await page.locator('[data-list=hooks] .lmd-au-item', { hasText: 'Team channel' }).textContent()));
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
    s = await page.evaluate(() => ({ kind: document.querySelector('.lmd-au-wiz input[name=lmd-au-kind]:checked').value, folder: document.querySelector('.lmd-au-wiz [data-au=folder]').value }));
    check('el menú de una carpeta ofrece "Automate…" con esa carpeta ya puesta', item === 'Automate…' && s.kind === 'folder' && s.folder === 'ui', [item, s]);
    await page.keyboard.press('Escape');
  } else check('el menú de una carpeta ofrece "Automate…" con esa carpeta ya puesta', false, 'no encontré la carpeta en el explorador');
  const lia = await R.open(K.free);
  await lia.page.goto(R.home + '#lmd-auto'); await lia.page.waitForSelector('[data-auto-pane] .lmd-extra');
  const gate = await lia.page.textContent('[data-auto-pane]');
  check('sin plan pago se ve la sección con el aviso de plan', /Automations are part of the paid plan\./.test(gate) && /See plans/.test(gate) && plain(gate), gate);
  await lia.ctx.close();

  console.log('Interfaz: pantalla chica');
  const small = await R.open(K.ana, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const sp = small.page;
  await sp.goto(R.noteUrl('ui/board.md')); await sp.waitForSelector('.lmd-board .lmd-card');
  s = await sp.evaluate(() => { const b = document.querySelector('.lmd-board'); const col = b.querySelector('.lmd-col').getBoundingClientRect(); return { page: document.documentElement.scrollWidth <= window.innerWidth, snap: getComputedStyle(b).scrollSnapType, col: col.width, scrolls: b.scrollWidth > b.clientWidth, open: getComputedStyle(b.querySelector('.lmd-card-open')).opacity }; });
  check('el tablero se desliza con el dedo, con columnas que encajan, sin mover la página', s.page && /x mandatory/.test(s.snap) && s.col > 250 && s.col < 340 && s.scrolls && s.open === '1', s);
  await sp.locator('.lmd-card', { hasText: 'Pick a name' }).locator('.lmd-card-open').tap(); await sp.waitForSelector('.lmd-cd');
  await sp.tap('.lmd-cd [data-cd-sug=responsable]'); await sp.fill('.lmd-cd [data-cd-val=owner]', 'Lia');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-cd-card').getBoundingClientRect(); const tap = [...document.querySelectorAll('.lmd-cd-card button, .lmd-cd-card select, .lmd-cd-card input[type=text]')].filter((n) => n.offsetParent).map((n) => Math.round(n.getBoundingClientRect().height)); return { fits: c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight + 1, min: Math.min(...tap), page: document.documentElement.scrollWidth <= window.innerWidth }; });
  check('el detalle de la tarjeta entra en la pantalla y se toca cómodo', s.fits && s.page && s.min >= 32, s);
  await sp.tap('.lmd-cd [data-cd=ok]'); await sp.waitForSelector('.lmd-cd', { state: 'detached' });
  check('y guarda', /Pick a name \{owner=Lia id=/.test((await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text) || !!(await until(async () => /Pick a name \{owner=Lia id=/.test((await api('GET', '/notes/' + encodeURIComponent('ui/board.md'), undefined, K.ana.s)).json.text), 6000)));
  await sp.tap('[data-act=more]'); await sp.waitForSelector('.lmd-menu-more');
  const more = await sp.textContent('.lmd-menu-more');
  await sp.tap('.lmd-menu-more [data-more=page]'); await sp.waitForSelector('.lmd-pg');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-pg .lmd-ask-card').getBoundingClientRect(); return { fits: c.left >= 0 && c.right <= window.innerWidth, text: document.querySelector('.lmd-pg').textContent }; });
  check('"más" trae Ajustes de la página, y la ventana entra', /Page settings/.test(more) && s.fits && /Page width/.test(s.text) && plain(s.text), [more, s]);
  await sp.tap('.lmd-pg [data-pg=ok]');
  await sp.goto(R.home + '#lmd-auto'); await sp.waitForSelector('.lmd-au-list');
  s = await sp.evaluate(() => ({ body: document.querySelector('.lmd-panel-body').scrollWidth <= document.querySelector('.lmd-panel-body').clientWidth + 1, page: document.documentElement.scrollWidth <= window.innerWidth, btn: Math.min(...[...document.querySelectorAll('.lmd-au-acts button')].map((b) => b.getBoundingClientRect().height)) }));
  check('Automatizaciones en pantalla chica: sin desborde y con botones que se tocan', s.body && s.page && s.btn >= 32, s);
  await sp.tap('[data-c=hook]'); await sp.waitForSelector('.lmd-au-wiz');
  s = await sp.evaluate(() => { const c = document.querySelector('.lmd-au-wiz .lmd-ask-card').getBoundingClientRect(); return { fits: c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight + 1 }; });
  check('el alta guiada entra en la pantalla', s.fits, s);
  await small.ctx.close(); await page.context().close();
}

const failed = done();
if (R.errors.length) console.log('errores de página: ' + J(R.errors.slice(0, 5)));
await R.close(); sink.close();
process.exit(failed || bad || R.errors.length ? 1 : 0);
