// Plan de equipo: una cuenta lo paga y lo administra, invita por correo, los miembros tienen el plan pago mientras
// estén, y todos comparten un espacio de notas que es del equipo. Se prueba contra el servidor (alta por el aviso
// de Paddle, invitar, aceptar, rechazar, sacar, salir, lugares, baja del cobro, el espacio compartido, MCP y lo que
// no puede hacer quien no es miembro) y con navegadores de verdad, también en pantalla chica.
// Paddle y el correo son servidores falsos locales: nada sale de esta máquina.
import { rig, tally, sleep, typeIn, leave } from './rig.mjs';
import { createHmac, randomBytes } from 'crypto';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';

const SECRET = 'firma-de-prueba'; const BASE = 'pri_prueba_equipo_base'; const SEAT = 'pri_prueba_equipo_lugar'; const KEY = 'clave-de-api-de-prueba';
const PORTAL = 'https://portal.ejemplo.test';
// La API de Paddle, falsa: anota cada pedido y responde bien, salvo que se le pida fallar.
const paddleCalls = []; let paddleFails = false;
const fakePaddle = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => { paddleCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null }); res.writeHead(paddleFails ? 500 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: {} })); });
});
// El correo, falso: junta lo que el servidor manda.
const mails = [];
const fakeMail = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { mails.push(JSON.parse(raw)); res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => fakePaddle.listen(0, '127.0.0.1', r)); await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mdteam-'));

const R = await rig({ PADDLE_WEBHOOK_SECRET: SECRET, PADDLE_TEAM_BASE: BASE, PADDLE_TEAM_SEAT: SEAT, PADDLE_API_KEY: KEY, PADDLE_API_URL: 'http://127.0.0.1:' + fakePaddle.address().port,
  CHECKOUT_TEAM: 'https://pago.ejemplo.test/pay.html?plan=team', CHECKOUT_MONTHLY: 'https://pago.ejemplo.test/pay.html?plan=monthly', PORTAL_URL: PORTAL, MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port,
  TEAM_INVITES_DAY: '12', AUTH_PER_IP: '300', FREE_NOTES: '3', DATA_DIR: DATA, DATA_KEY: randomBytes(32).toString('base64'), APP_URL: 'https://app.ejemplo.test/' });
const { check, done } = tally();
const enc = encodeURIComponent;

try {
  const { api } = R;
  const acct = async (who) => (await api('GET', '/account', undefined, who.s)).json;
  let clock = Date.now() - 600000;
  const signed = async (ev) => { const raw = JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', SECRET).update(ts + ':' + raw).digest('hex'); const r = await fetch(R.base + '/paddle/webhook', { method: 'POST', headers: { 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw }); return { status: r.status, json: await r.json() }; };
  // Un aviso de la suscripción de un equipo: el precio base y, con extra, el precio por lugar con esa cantidad.
  const teamSub = (id, status, email, extra) => signed({ event_type: 'subscription.updated', occurred_at: new Date(clock += 1000).toISOString(),
    data: Object.assign({ id, status, items: [{ price: { id: BASE, custom_data: { app: 'sharpmd' } }, quantity: 1 }].concat(extra ? [{ price: { id: SEAT, custom_data: { app: 'sharpmd' } }, quantity: extra }] : []) }, email ? { custom_data: { sharpmd_email: email } } : {}) });
  const soloSub = (id, status, email) => signed({ event_type: 'subscription.updated', occurred_at: new Date(clock += 1000).toISOString(), data: Object.assign({ id, status, items: [{ price: { id: 'pri_prueba_individual', custom_data: { app: 'sharpmd' } }, quantity: 1 }] }, email ? { custom_data: { sharpmd_email: email } } : {}) });
  const invite = (who, email, lang) => api('POST', '/team/invite', Object.assign({ email }, lang ? { lang } : {}), who.s);
  const pendingFor = async (who) => (await acct(who)).team.invites;
  const listen = async (who, p, o) => {
    const ctrl = new AbortController(); const st = { text: '', status: 0, closed: false, stop: () => ctrl.abort() };
    const res = await fetch(R.base + '/events?path=' + enc(p) + (o ? '&o=' + o : ''), { headers: { authorization: 'Bearer ' + who.s }, signal: ctrl.signal });
    st.status = res.status;
    if (res.ok) (async () => { const rd = res.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; st.text += d.decode(x.value); } } catch (e) { /* se cortó */ } st.closed = true; })();
    return st;
  };

  const A = await R.signup('ana@ejemplo.test'); const B = await R.signup('beto@ejemplo.test'); const C = await R.signup('carla@ejemplo.test');
  const Z = await R.signup('zoe@ejemplo.test', true); // paga por su lado y no es de ningún equipo

  // ---------- Alta por el aviso de Paddle ----------
  console.log('Alta del equipo');
  const before = await acct(A);
  check('con el cobro configurado la app ofrece el plan de equipo, con el enlace de pago a nombre de la cuenta', before.team.enabled === true && before.team.mine === null && before.team.checkout === 'https://pago.ejemplo.test/pay.html?plan=team&email=' + enc(A.email) && before.team.included === 2, before.team);
  const alta = await teamSub('sub_eq_1', 'active', A.email, 1);
  const a1 = await acct(A);
  check('el aviso de la suscripción de equipo crea el equipo, con los lugares que trae (2 del base más 1)', alta.status === 200 && alta.json.seats === 3 && a1.team.mine && a1.team.mine.role === 'admin' && a1.team.mine.seats === 3 && a1.team.mine.used === 1 && a1.team.mine.active === true, [alta.json, a1.team]);
  check('quien paga tiene el plan pago por el equipo, sin plan individual', a1.plan === 'pro' && a1.own_plan === 'free' && a1.limit === null && a1.mcp === true && a1.share === true && a1.live === true, a1);
  check('y es quien administra la suscripción', a1.manage === PORTAL && a1.team.mine.billing === true, a1);
  const SPACE = a1.team.mine.space;
  // La suscripción queda atada a la cuenta con la que se vio la primera vez: otro correo en custom_data no la mueve.
  const robo = await teamSub('sub_eq_1', 'active', Z.email, 1);
  const z0 = await acct(Z);
  check('un aviso de la misma suscripción a nombre de otra cuenta no le da el equipo', robo.status === 200 && z0.team.mine === null && (await acct(A)).team.mine.role === 'admin', [robo.json, z0.team]);
  check('un aviso de equipo sin firma válida se rechaza', (await fetch(R.base + '/paddle/webhook', { method: 'POST', headers: { 'paddle-signature': 'ts=' + Math.floor(Date.now() / 1000) + ';h1=00' }, body: '{}' })).status === 401);
  const nadie = await teamSub('sub_eq_x', 'active', 'no-existe@ejemplo.test', 0);
  check('un aviso de equipo para un correo sin cuenta no crea nada', nadie.json.ignored === 'user', nadie.json);

  // ---------- Invitar, aceptar, rechazar ----------
  console.log('Invitaciones');
  mails.length = 0;
  const inv1 = await invite(A, B.email);
  const inv2 = await invite(A, 'sin-cuenta@ejemplo.test');
  check('invitar responde lo mismo tenga o no cuenta la dirección', inv1.status === 200 && inv2.status === 200 && JSON.stringify(Object.keys(inv1.json).sort()) === JSON.stringify(Object.keys(inv2.json).sort()) && inv1.json.ok === true && inv2.json.ok === true, [inv1.json, inv2.json]);
  const m1 = mails.find((m) => m.to === B.email); const m2 = mails.find((m) => m.to === 'sin-cuenta@ejemplo.test');
  check('llega un correo a cada una, que dice quién invita y lleva a la app', !!m1 && !!m2 && m1.subject === 'ana@ejemplo.test invited you to a team on SharpMD' && /ana@ejemplo\.test invited you to their team/.test(m1.text) && m1.text.includes('https://app.ejemplo.test/') && /Open SharpMD/.test(m1.html), m1);
  check('el correo es el mismo para quien tiene cuenta y para quien no', !!m1 && !!m2 && m1.text === m2.text && m1.html === m2.html && m1.subject === m2.subject);
  check('el correo no usa signos de admiración ni rayas largas', !!m1 && !/[!¡—–]/.test(m1.text + m1.subject + m1.html.replace(/<!doctype html>/i, '')), m1 && m1.text);
  const a2 = await acct(A);
  check('las invitaciones pendientes ocupan lugar', a2.team.mine.used === 3 && a2.team.mine.pending.length === 2 && a2.team.mine.members.length === 1, a2.team.mine);
  const full = await invite(A, C.email);
  check('con los lugares completos no se puede invitar a nadie más', full.status === 409 && full.json.error === 'team_full', full.json);
  check('y ese correo no salió', !mails.some((m) => m.to === C.email));
  const b0 = await acct(B);
  check('la persona invitada ve la invitación al entrar, con quién la invita', b0.team.invites.length === 1 && b0.team.invites[0].by === A.email && b0.team.mine === null, b0.team);
  check('y no queda sumada sin aceptar: sigue en el plan gratis y no entra al espacio del equipo', b0.plan === 'free' && (await api('GET', '/notes/x.md?o=' + SPACE, undefined, B.s)).status === 403);
  check('nadie acepta la invitación de otra persona', (await api('POST', '/team/accept', { id: b0.team.invites[0].id }, C.s)).status === 404 && (await api('POST', '/team/accept', { id: b0.team.invites[0].id }, Z.s)).status === 404);
  check('ni la rechaza por ella', (await api('POST', '/team/decline', { id: b0.team.invites[0].id }, Z.s)).status === 200 && (await pendingFor(B)).length === 1);
  const yes = await api('POST', '/team/accept', { id: b0.team.invites[0].id }, B.s);
  const b1 = await acct(B);
  check('al aceptar entra al equipo y tiene el plan pago', yes.status === 200 && b1.plan === 'pro' && b1.own_plan === 'free' && b1.team.mine.role === 'editor' && b1.team.mine.space === SPACE && b1.limit === null && b1.mcp === true, b1);
  check('un miembro ve quiénes están, y nada del cobro ni de las invitaciones', b1.team.mine.members.map((m) => m.email).join() === 'ana@ejemplo.test,beto@ejemplo.test' && b1.team.mine.pending === undefined && b1.team.mine.billing === undefined && b1.manage === '', b1);
  // Carla: se le hace lugar, se la invita en castellano y rechaza.
  const sin = (await acct(A)).team.mine.pending.find((i) => i.email === 'sin-cuenta@ejemplo.test');
  check('quien administra quita una invitación pendiente y libera el lugar', (await api('DELETE', '/team/invites/' + sin.id, undefined, A.s)).status === 200 && (await acct(A)).team.mine.used === 2);
  await invite(A, C.email, 'es');
  const mc = mails.find((m) => m.to === C.email);
  check('con lang: es el correo sale en castellano', !!mc && mc.subject === 'ana@ejemplo.test te invitó a un equipo en SharpMD' && /entrá con este correo/.test(mc.text) && /Entrá con este correo/.test(mc.html) && /Abrir SharpMD/.test(mc.html), mc);
  const c0 = await pendingFor(C);
  const no = await api('POST', '/team/decline', { id: c0[0].id }, C.s);
  check('rechazar borra la invitación y libera el lugar', no.status === 200 && (await pendingFor(C)).length === 0 && (await acct(A)).team.mine.used === 2 && (await acct(C)).plan === 'free');
  check('una invitación rechazada ya no se puede aceptar', (await api('POST', '/team/accept', { id: c0[0].id }, C.s)).status === 404);
  check('no se invita al propio correo ni a quien ya está', (await invite(A, A.email)).json.error === 'own_email' && (await invite(A, B.email)).json.error === 'already_member' && (await invite(A, 'no es un correo')).json.error === 'bad_email');
  // El nombre del equipo lo escribe una persona: en el correo va escapado.
  check('quien administra le pone nombre al equipo', (await api('PUT', '/team', { name: 'Los <b>Pibes</b> & Cía' }, A.s)).json.team.mine.name === 'Los <b>Pibes</b> & Cía');
  mails.length = 0; await invite(A, 'con-nombre@ejemplo.test');
  check('el nombre del equipo viaja escapado en el correo', mails.length === 1 && !mails[0].html.includes('<b>Pibes</b>') && mails[0].html.includes('&#60;b&#62;Pibes') && mails[0].text.includes('the team "Los <b>Pibes</b> & Cía"'), mails[0] && mails[0].html.slice(600, 1100));
  await api('DELETE', '/team/invites/' + (await acct(A)).team.mine.pending[0].id, undefined, A.s);
  await api('PUT', '/team', { name: '' }, A.s);

  // ---------- Lo que solo hace quien administra ----------
  console.log('Papeles');
  const deny = async (r) => { const x = await r; return x.status + ':' + (x.json && x.json.error); };
  check('un miembro no invita, no saca, no cambia lugares ni el nombre', (await deny(invite(B, C.email))) === '403:not_admin' && (await deny(api('POST', '/team/remove', { id: A.id }, B.s))) === '403:not_admin' && (await deny(api('POST', '/team/seats', { seats: 9 }, B.s))) === '403:not_admin' &&
    (await deny(api('PUT', '/team', { name: 'x' }, B.s))) === '403:not_admin' && (await deny(api('DELETE', '/team/invites/1', undefined, B.s))) === '403:not_admin');
  check('quien no está en un equipo no tiene qué administrar', (await deny(invite(Z, C.email))) === '404:no_team' && (await deny(api('POST', '/team/remove', { id: B.id }, Z.s))) === '404:no_team' && (await deny(api('POST', '/team/seats', { seats: 9 }, Z.s))) === '404:no_team' && (await deny(api('POST', '/team/leave', {}, Z.s))) === '404:no_team');
  check('sin sesión no hay rutas de equipo', (await api('GET', '/team')).status === 401 && (await api('POST', '/team/invite', { email: C.email })).status === 401);
  check('quien paga no puede salir de su equipo ni sacarse', (await deny(api('POST', '/team/leave', {}, A.s))) === '409:owner_stays' && (await deny(api('POST', '/team/remove', { id: A.id }, A.s))) === '409:owner_stays');

  // ---------- El espacio compartido ----------
  console.log('Espacio del equipo');
  const tnote = (p) => '/notes/' + enc(p) + '?o=' + SPACE;
  const w1 = await api('PUT', tnote('plan.md'), { text: 'MARCA-SECRETA-DEL-EQUIPO\nlínea dos' }, A.s);
  check('quien administra crea una nota en el espacio del equipo', w1.status === 200 && w1.json.rev === 1, w1.json);
  const r1 = await api('GET', tnote('plan.md'), undefined, B.s);
  check('otro miembro la lee', r1.status === 200 && r1.json.text === 'MARCA-SECRETA-DEL-EQUIPO\nlínea dos' && r1.json.rev === 1 && r1.json.role === 'team', r1.json);
  const evA = await listen(A, 'plan.md', SPACE); await sleep(150);
  const w2 = await api('PUT', tnote('plan.md'), { text: 'MARCA-SECRETA-DEL-EQUIPO\nlínea dos\nde beto', rev: 1 }, B.s);
  check('y la edita, sobre la revisión que leyó', w2.status === 200 && w2.json.rev === 2, w2.json);
  const clash = await api('PUT', tnote('plan.md'), { text: 'PISADO', rev: 1 }, A.s);
  check('un guardado sobre la revisión vieja responde 409 con el texto y la revisión de ahora, sin pisar', clash.status === 409 && clash.json.error === 'rev_conflict' && clash.json.rev === 2 && clash.json.text.endsWith('de beto') && (await api('GET', tnote('plan.md'), undefined, A.s)).json.text.endsWith('de beto'), clash.json);
  await sleep(200);
  check('quien tiene la nota abierta recibe el aviso del guardado, con la revisión', /"type":"saved","by":"beto@ejemplo\.test","updated":\d+,"rev":2/.test(evA.text), evA.text.slice(-300));
  evA.stop();
  const vers = await api('GET', '/versions/' + enc('plan.md') + '?o=' + SPACE, undefined, A.s);
  const ver = vers.json.length ? await api('GET', '/version/' + vers.json[0].id + '?o=' + SPACE, undefined, B.s) : { json: {} };
  check('la nota del equipo tiene historial, y lo ven los miembros', vers.status === 200 && vers.json.length === 1 && ver.json.text === 'MARCA-SECRETA-DEL-EQUIPO\nlínea dos', [vers.json, ver.json]);
  check('las notas del equipo no figuran entre las propias ni cuentan en el tope de nadie', (await api('GET', '/notes', undefined, A.s)).json.length === 0 && (await acct(B)).notes === 0 && (await api('GET', '/notes?o=' + SPACE, undefined, B.s)).json.map((n) => n.path).join() === 'plan.md');
  await api('PUT', tnote('proyectos/uno.md'), { text: 'uno' }, B.s);
  const ren = await api('POST', '/rename', { from: 'proyectos/uno.md', to: 'proyectos/dos.md', o: SPACE }, A.s);
  check('cualquier miembro mueve una nota del equipo, y el historial la sigue', ren.status === 200 && (await api('GET', tnote('proyectos/dos.md'), undefined, B.s)).json.text === 'uno' && (await api('GET', tnote('proyectos/uno.md'), undefined, B.s)).status === 404, ren.json);
  const found = await api('GET', '/search?q=secreta&o=' + SPACE, undefined, B.s);
  check('y busca dentro del espacio del equipo', found.status === 200 && found.json.length === 1 && found.json[0].path === 'plan.md', found.json);
  check('la búsqueda propia no trae notas del equipo', (await api('GET', '/search?q=secreta', undefined, B.s)).json.length === 0);
  check('un miembro elimina una nota del equipo', (await api('DELETE', tnote('proyectos/dos.md'), undefined, B.s)).status === 200 && (await api('GET', tnote('proyectos/dos.md'), undefined, A.s)).status === 404);
  check('en el espacio del equipo no entra texto cifrado desde el navegador (no hay carpetas con contraseña)', (await deny(api('PUT', tnote('secreta/x.md'), { text: 'vault1:' + Buffer.alloc(60).toString('base64') }, A.s))) === '409:vault_text');
  // Lo que es de cada persona sigue siendo solo suyo.
  await api('PUT', '/notes/' + enc('diario.md'), { text: 'solo de ana' }, A.s);
  check('un miembro no lee las notas propias de otro, ni por su cuenta ni por el equipo', (await api('GET', '/notes/diario.md?o=' + A.id, undefined, B.s)).status === 403 && (await api('GET', tnote('diario.md'), undefined, B.s)).status === 404 && (await api('GET', '/notes?o=' + A.id, undefined, B.s)).json.length === 0);
  check('ni su historial, ni lo que busca', (await api('GET', '/versions/diario.md?o=' + A.id, undefined, B.s)).status === 403 && (await api('GET', '/search?q=ana&o=' + A.id, undefined, B.s)).status === 403);
  // Con DATA_KEY las notas del equipo se guardan cifradas, igual que las demás.
  await sleep(300);
  const disk = ['mdtools.db', 'mdtools.db-wal'].map((f) => { try { return fs.readFileSync(path.join(DATA, f)).toString('latin1'); } catch (e) { return ''; } }).join('');
  check('con DATA_KEY el texto de las notas del equipo y de su historial no queda en claro en el archivo de la base', disk.length > 1000 && !disk.includes('MARCA-SECRETA-DEL-EQUIPO') && disk.includes('enc1:'), disk.length);

  // ---------- Quien no es miembro ----------
  console.log('Quien no es miembro');
  check('no lee, no escribe y no elimina notas del equipo', (await api('GET', tnote('plan.md'), undefined, Z.s)).status === 403 && (await api('PUT', tnote('plan.md'), { text: 'x' }, Z.s)).status === 403 && (await api('PUT', tnote('nueva.md'), { text: 'x' }, Z.s)).status === 403 && (await api('DELETE', tnote('plan.md'), undefined, Z.s)).status === 403);
  check('no las lista, no las busca, no ve su historial y no las mueve', (await api('GET', '/notes?o=' + SPACE, undefined, Z.s)).json.length === 0 && (await api('GET', '/search?q=secreta&o=' + SPACE, undefined, Z.s)).status === 403 &&
    (await api('GET', '/versions/plan.md?o=' + SPACE, undefined, Z.s)).status === 403 && (await api('GET', '/version/' + vers.json[0].id + '?o=' + SPACE, undefined, Z.s)).status === 403 && (await api('GET', '/version/' + vers.json[0].id, undefined, Z.s)).status === 404 &&
    (await api('POST', '/rename', { from: 'plan.md', to: 'robada.md', o: SPACE }, Z.s)).status === 403);
  check('no escucha sus cambios', (await listen(Z, 'plan.md', SPACE)).status === 403);
  check('no se le puede compartir nada del equipo ni abrirle un enlace o una sesión en vivo', (await api('POST', '/shares', { path: 'plan.md', email: Z.email, role: 'view' }, A.s)).status === 404 && (await api('POST', '/links', { path: 'plan.md' }, A.s)).status === 404 && (await api('POST', '/live', { path: 'plan.md', name: 'Ana' }, A.s)).status === 404);
  check('y la nota sigue intacta', (await api('GET', tnote('plan.md'), undefined, A.s)).json.text.endsWith('de beto'));
  check('con la cuenta interna del equipo no entra nadie', (await api('POST', '/auth/start', { email: 'team:abc' })).status === 400);

  // ---------- MCP ----------
  console.log('MCP');
  const tok = async (who, folder) => (await api('POST', '/tokens', Object.assign({ name: 'IA' }, folder ? { folder } : {}), who.s)).json.token;
  const tool = async (t, name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, t); return r.json ? r.json.result : { status: r.status }; };
  const text = (r) => (r && r.content ? r.content[0].text : '');
  await api('PUT', '/notes/' + enc('proy/propia.md'), { text: 'nota propia de beto' }, B.s);
  const tb = await tok(B);
  const ls = JSON.parse(text(await tool(tb, 'list_notes')));
  check('MCP: la IA de un miembro ve las notas del equipo bajo @team/, marcadas, junto a las propias', ls.some((n) => n.path === '@team/plan.md' && n.team === true) && ls.some((n) => n.path === 'proy/propia.md' && !n.team), ls);
  check('MCP: y la carpeta @team entre las carpetas', JSON.parse(text(await tool(tb, 'list_folders'))).some((f) => f.folder === '@team' && f.team === true));
  check('MCP: lee una nota del equipo', text(await tool(tb, 'read_note', { path: '@team/plan.md' })).endsWith('de beto'));
  const evB = await listen(A, 'plan.md', SPACE); await sleep(150);
  const mw = await tool(tb, 'append_note', { path: '@team/plan.md', text: 'de la IA' });
  const afterAi = (await api('GET', tnote('plan.md'), undefined, A.s)).json;
  await sleep(200);
  check('MCP: escribe en ella sobre la revisión actual, y quien la tiene abierta se entera', !mw.isError && afterAi.rev === 3 && afterAi.text.endsWith('de beto\n\nde la IA') && /"type":"saved","by":"mcp"/.test(evB.text), [mw, afterAi, evB.text.slice(-200)]);
  evB.stop();
  const tw = await tool(tb, 'write_note', { path: '@team/ia/nueva.md', text: 'hola equipo' });
  check('MCP: crea una nota nueva en el equipo', !tw.isError && (await api('GET', tnote('ia/nueva.md'), undefined, A.s)).json.text === 'hola equipo');
  check('MCP: y devuelve la dirección de esa nota en el espacio del equipo, sobre APP_URL', text(tw).endsWith(' Open it: https://app.ejemplo.test/?f=' + enc('cloud/~' + SPACE + '/ia/nueva.md')), text(tw));
  check('MCP: la búsqueda trae lo del equipo con su ruta', JSON.parse(text(await tool(tb, 'search_notes', { query: 'hola equipo' }))).some((r) => r.path === '@team/ia/nueva.md'));
  const tScoped = await tok(B, 'proy');
  check('MCP: un token limitado a una carpeta propia no ve ni toca el equipo', !JSON.parse(text(await tool(tScoped, 'list_notes'))).some((n) => n.path.startsWith('@team/')) && (await tool(tScoped, 'read_note', { path: '@team/plan.md' })).isError === true && (await tool(tScoped, 'write_note', { path: '@team/x.md', text: 'x' })).isError === true && (await api('GET', tnote('x.md'), undefined, A.s)).status === 404);
  const tTeam = await tok(B, '@team/ia');
  const lsTeam = JSON.parse(text(await tool(tTeam, 'list_notes')));
  check('MCP: un token limitado a una carpeta del equipo ve solo esa carpeta', lsTeam.length === 1 && lsTeam[0].path === '@team/ia/nueva.md' && (await tool(tTeam, 'read_note', { path: '@team/plan.md' })).isError === true && (await tool(tTeam, 'read_note', { path: 'proy/propia.md' })).isError === true, lsTeam);
  const tz = await tok(Z);
  check('MCP: la IA de quien no es miembro no ve el equipo: @team/ es para ella una carpeta propia más', !JSON.parse(text(await tool(tz, 'list_notes'))).some((n) => n.path.startsWith('@team/')) && (await tool(tz, 'read_note', { path: '@team/plan.md' })).isError === true);

  // ---------- Lugares ----------
  console.log('Lugares');
  paddleCalls.length = 0;
  const up = await api('POST', '/team/seats', { seats: 5 }, A.s);
  const call = paddleCalls[0] || {};
  check('subir los lugares cambia la suscripción en Paddle: el base y la cantidad de lugares adicionales, con prorrateo inmediato', up.status === 200 && up.json.seats === 5 && paddleCalls.length === 1 && call.method === 'PATCH' && call.url === '/subscriptions/sub_eq_1' && call.auth === 'Bearer ' + KEY &&
    JSON.stringify(call.body) === JSON.stringify({ items: [{ price_id: BASE, quantity: 1 }, { price_id: SEAT, quantity: 3 }], proration_billing_mode: 'prorated_immediately' }), [up.json, call]);
  check('y el equipo ya tiene esos lugares', (await acct(A)).team.mine.seats === 5 && up.json.team.mine.seats === 5);
  await invite(A, C.email); // ana, beto y una invitación pendiente: tres ocupados
  const low = await api('POST', '/team/seats', { seats: 2 }, A.s);
  check('no se puede bajar por debajo de los lugares ocupados, y Paddle no se entera', low.status === 409 && low.json.error === 'seats_in_use' && low.json.used === 3 && paddleCalls.length === 1 && (await acct(A)).team.mine.seats === 5, low.json);
  const down = await api('POST', '/team/seats', { seats: 3 }, A.s);
  check('bajar hasta los ocupados sí', down.status === 200 && paddleCalls.length === 2 && JSON.stringify(paddleCalls[1].body.items) === JSON.stringify([{ price_id: BASE, quantity: 1 }, { price_id: SEAT, quantity: 1 }]), [down.json, paddleCalls[1]]);
  let bad = 0; for (const n of [1, 0, -3, 2.5, '4', null, 5000]) { const r = await api('POST', '/team/seats', { seats: n }, A.s); if (r.status !== 400 || r.json.error !== 'bad_seats') bad++; }
  check('una cantidad de lugares que no sirve se rechaza sin llamar a Paddle', bad === 0 && paddleCalls.length === 2);
  paddleFails = true;
  const failed = await api('POST', '/team/seats', { seats: 6 }, A.s);
  paddleFails = false;
  check('si Paddle no acepta el cambio, los lugares quedan como estaban', failed.status === 502 && failed.json.error === 'billing_failed' && (await acct(A)).team.mine.seats === 3, failed.json);
  await teamSub('sub_eq_1', 'active', null, 2);
  check('un aviso de Paddle con otra cantidad actualiza los lugares (sin custom_data: la cuenta sale de la suscripción)', (await acct(A)).team.mine.seats === 4);
  await api('POST', '/team/decline', { id: (await pendingFor(C))[0].id }, C.s);

  // ---------- Sacar y salir ----------
  console.log('Sacar y salir');
  const evOut = await listen(B, 'plan.md', SPACE); await sleep(150);
  const out = await api('POST', '/team/remove', { id: B.id }, A.s);
  await sleep(250);
  const b2 = await acct(B);
  check('quien administra saca a un miembro: vuelve al plan gratis', out.status === 200 && b2.plan === 'free' && b2.team.mine === null && b2.limit === 3 && b2.mcp === false, b2);
  check('conserva sus notas', (await api('GET', '/notes/' + enc('proy/propia.md'), undefined, B.s)).json.text === 'nota propia de beto');
  check('ya no entra al espacio del equipo, y la escucha que tenía abierta se le cortó', (await api('GET', tnote('plan.md'), undefined, B.s)).status === 403 && (await api('PUT', tnote('plan.md'), { text: 'x' }, B.s)).status === 403 && evOut.closed === true, evOut);
  check('su token de IA deja de servir para el equipo', (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tb)).status === 402);
  check('las notas del equipo quedan en el equipo', (await api('GET', tnote('plan.md'), undefined, A.s)).json.text.includes('de beto') && (await api('GET', tnote('ia/nueva.md'), undefined, A.s)).status === 200);
  check('sacar a quien no es miembro no hace nada', (await deny(api('POST', '/team/remove', { id: Z.id }, A.s))) === '404:not_found');
  await invite(A, C.email);
  await api('POST', '/team/accept', { id: (await pendingFor(C))[0].id }, C.s);
  const bye = await api('POST', '/team/leave', {}, C.s);
  check('un miembro sale por su cuenta y vuelve al plan gratis', bye.status === 200 && bye.json.team.mine === null && (await acct(C)).plan === 'free' && (await acct(A)).team.mine.members.length === 1, bye.json);

  // ---------- Un equipo a la vez, y quien ya pagaba por su lado ----------
  console.log('Un equipo a la vez');
  const D = await R.signup('dora@ejemplo.test'); const E = await R.signup('eva@ejemplo.test');
  await teamSub('sub_eq_2', 'active', D.email, 14);
  check('otro equipo, de otra cuenta, con 16 lugares', (await acct(D)).team.mine.seats === 16 && (await acct(D)).team.mine.space !== SPACE);
  await invite(A, B.email); await invite(D, B.email);
  const two = await pendingFor(B);
  await api('POST', '/team/accept', { id: two.find((i) => i.by === A.email).id }, B.s);
  const second = await api('POST', '/team/accept', { id: two.find((i) => i.by === D.email).id }, B.s);
  check('quien ya está en un equipo no entra a otro sin salir del primero', second.status === 409 && second.json.error === 'in_team' && (await acct(B)).team.mine.space === SPACE, second.json);
  check('y el espacio del otro equipo le sigue cerrado', (await api('GET', '/notes/x.md?o=' + (await acct(D)).team.mine.space, undefined, B.s)).status === 403);
  await soloSub('sub_solo_eva', 'active', E.email);
  await invite(A, E.email); await api('POST', '/team/accept', { id: (await pendingFor(E))[0].id }, E.s);
  const e1 = await acct(E);
  check('quien ya paga un plan individual entra al equipo sin que nadie le cancele nada: la app sabe que lo sigue pagando y dónde darlo de baja', e1.plan === 'pro' && e1.own_plan === 'pro' && e1.team.mine.solo === true && e1.manage === PORTAL, e1);

  // ---------- Topes de invitaciones ----------
  console.log('Topes');
  let sent = 0; let stop = null;
  for (let i = 0; i < 16 && !stop; i++) { const r = await invite(D, 'tope' + i + '@ejemplo.test'); if (r.status === 200) sent++; else stop = r; }
  check('un equipo manda hasta 12 invitaciones por día (TEAM_INVITES_DAY): la siguiente se frena con cuánto falta', sent === 11 && stop && stop.status === 429 && stop.json.error === 'invite_day' && stop.json.retry_after > 0 && +stop.headers.get('retry-after') > 0, [sent, stop && stop.json]);
  const F = await R.signup('fede@ejemplo.test'); await teamSub('sub_eq_3', 'active', F.email, 5);
  const same = []; for (let i = 0; i < 4; i++) same.push((await invite(F, 'insistente@ejemplo.test')).status);
  mails.length = 0;
  const fromOther = await invite(A, 'insistente@ejemplo.test');
  check('una misma dirección recibe hasta 3 invitaciones por día, entre todos los equipos', same.join() === '200,200,200,429' && fromOther.status === 429 && fromOther.json.error === 'invite_mail_day' && mails.length === 0, [same, fromOther.json]);
  check('y la invitación repetida no ocupa otro lugar', (await acct(F)).team.mine.used === 2);

  // ---------- Baja del cobro ----------
  console.log('Baja del cobro');
  const cancel = await teamSub('sub_eq_1', 'canceled', null, 2);
  const a3 = await acct(A); const b3 = await acct(B); const e3 = await acct(E);
  check('al cancelarse el cobro el equipo queda sin plan pago: sus miembros vuelven a gratis', cancel.json.ended === true && a3.plan === 'free' && b3.plan === 'free' && a3.team.mine.active === false && b3.team.mine.active === false, [cancel.json, a3.team.mine]);
  check('quien pagaba por su lado sigue con su plan', e3.plan === 'pro' && e3.own_plan === 'pro');
  check('no se borra nada: las notas del equipo se siguen leyendo y editando', (await api('GET', tnote('plan.md'), undefined, B.s)).json.text.includes('de beto') && (await api('PUT', tnote('plan.md'), { text: 'después de la baja' }, B.s)).status === 200);
  // ia/nueva.md todavía no tiene versiones anteriores: con el plan al día, su primer cambio guardaría una.
  const versOf = async (p) => (await api('GET', '/versions/' + enc(p) + '?o=' + SPACE, undefined, A.s)).json.length;
  await api('PUT', tnote('ia/nueva.md'), { text: 'cambiada sin plan' }, A.s);
  const noHistory = await versOf('ia/nueva.md');
  await api('PUT', tnote('tres.md'), { text: '3' }, A.s);
  const over = await api('PUT', tnote('cuatro.md'), { text: '4' }, A.s);
  check('pero no se suman notas nuevas pasado el tope gratis, y se dice por qué', over.status === 402 && over.json.error === 'team_ended', over.json);
  check('y deja de guardarse historial', noHistory === 0, noHistory);
  check('no se invita ni se cambian lugares con el cobro caído', (await deny(invite(A, 'tarde@ejemplo.test'))) === '402:team_ended' && (await deny(api('POST', '/team/seats', { seats: 6 }, A.s))) === '402:team_ended');
  check('las notas propias de cada uno siguen ahí', (await api('GET', '/notes/' + enc('diario.md'), undefined, A.s)).json.text === 'solo de ana' && (await api('GET', '/notes/' + enc('proy/propia.md'), undefined, B.s)).status === 200);
  const viejo = await teamSub('sub_eq_1', 'active', null, 2);
  check('volver a pagar reactiva el equipo, con su gente y sus notas', viejo.status === 200 && (await acct(B)).plan === 'pro' && (await acct(A)).team.mine.active === true && (await acct(A)).team.mine.members.length === 3);
  await api('PUT', tnote('ia/nueva.md'), { text: 'cambiada con plan' }, A.s);
  check('y el historial vuelve a guardarse', (await versOf('ia/nueva.md')) === 1);

  // ---------- Un equipo armado a mano, sin cobro (servidor propio) ----------
  const G = await R.signup('gabi@ejemplo.test');
  const byHand = await api('POST', '/admin/team', { email: G.email, seats: 4 }, undefined, { 'x-admin-key': R.ADMIN });
  const g1 = await acct(G);
  check('con la clave de administración se arma un equipo sin cobro: da el plan pago y no deja cambiar lugares desde la app', byHand.status === 200 && g1.plan === 'pro' && g1.team.mine.seats === 4 && g1.team.mine.billing === false && (await deny(api('POST', '/team/seats', { seats: 5 }, G.s))) === '409:no_billing', [byHand.json, g1.team]);
  check('sin la clave no', (await api('POST', '/admin/team', { email: G.email, seats: 9 }, undefined, { 'x-admin-key': 'otra' })).status === 403);

  // ---------- En el navegador ----------
  console.log('En el navegador');
  const O = await R.signup('olga@ejemplo.test'); const P = await R.signup('pedro@ejemplo.test'); const Q = await R.signup('quique@ejemplo.test', true);
  await teamSub('sub_eq_n', 'active', O.email, 1);
  const SP = (await acct(O)).team.mine.space; const NOTE = '# Plan\n\nPrimer párrafo.\n\nSegundo párrafo.\n\nTercer párrafo.\n';
  await api('PUT', '/notes/' + enc('plan.md') + '?o=' + SP, { text: NOTE }, O.s);
  const tUrl = (p, edit) => R.noteUrl('~' + SP + '/' + p, edit);
  const natives = [];
  const watch = (c) => { c.page.on('dialog', (d) => { natives.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); }); return c; };
  const openPlan = async (page) => { await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=plan]'); await page.waitForSelector('.lmd-panel .lmd-plans'); await page.waitForTimeout(300); };
  const closePanel = (page) => page.click('[data-act=close-panel]');

  const olga = watch(await R.open(O));
  await olga.page.goto(tUrl('plan.md', true)); await olga.page.waitForSelector('.lmd-article p.lmd-editable');
  await olga.page.waitForSelector('[data-root=team] .lmd-node');
  const root = await olga.page.evaluate(() => ({ roots: [...document.querySelectorAll('.lmd-xroot')].map((s) => s.dataset.root), name: document.querySelector('[data-root=team] .lmd-tree-path').textContent, nodes: [...document.querySelectorAll('[data-root=team] .lmd-node-name')].map((n) => n.textContent), active: !!document.querySelector('[data-root=team] .lmd-node.lmd-active'), plus: !!document.querySelector('[data-root=team] .lmd-tree-new'), inCloud: [...document.querySelectorAll('[data-root=cloud] .lmd-node-name')].map((n) => n.textContent) }));
  check('el explorador tiene una sección propia del equipo, junto a navegador y nube, con sus notas', root.roots.includes('team') && root.roots.indexOf('team') === root.roots.indexOf('cloud') + 1 && root.name === 'Team' && root.nodes.includes('plan.md') && root.active && root.plus, root);
  check('y esas notas no se mezclan con las de la nube propia', !root.inCloud.includes('plan.md') && !root.inCloud.some((n) => /^~/.test(n)), root.inCloud);
  await olga.page.click('.lmd-sync'); await olga.page.waitForSelector('.lmd-menu [data-s]');
  const menu = await olga.page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-s]')].map((b) => b.dataset.s + (b.classList.contains('lmd-locked') ? ':locked' : '')));
  check('en una nota del equipo el menú de la nube ofrece el historial y, a quien administra, compartir y la sesión en vivo', menu.includes('history') && menu.includes('share') && menu.includes('live'), menu);
  await olga.page.keyboard.press('Escape'); await olga.page.mouse.click(700, 500);

  // Ajustes → Plan: la columna del equipo y la gestión de quien administra.
  await openPlan(olga.page);
  const pane = await olga.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); return { cols: b.querySelectorAll('.lmd-plan').length, teamOn: !!b.querySelector('.lmd-plan-team.lmd-plan-on'), price: b.querySelector('.lmd-plan-team h4').textContent, text: b.querySelector('.lmd-team').innerText, invite: !!b.querySelector('[data-t=invite]'), seats: b.querySelector('.lmd-team-cost').textContent, manage: (b.querySelector('.lmd-team a.lmd-btn') || {}).href || '', all: b.innerText }; });
  check('Plan muestra el equipo como tercera columna, con su precio, y es el plan actual', pane.cols === 3 && pane.teamOn && /Team\s+USD 7\.98 \/ month/.test(pane.price) && /2 people included, USD 3 for each extra one/.test(pane.all), pane);
  check('quien administra ve miembros, lugares con su costo, invitar y el enlace para administrar el cobro', /olga@ejemplo\.test · Administrator/.test(pane.text) && /1 of 3 taken/.test(pane.text) && pane.invite && pane.seats === '3 seats: USD 10.98 a month' && pane.manage.startsWith(PORTAL), pane);
  check('los textos del equipo no llevan signos de admiración ni rayas largas', !/[!¡—–]/.test(pane.all), pane.all);
  mails.length = 0;
  await olga.page.fill('.lmd-team [data-t=email]', P.email); await olga.page.click('.lmd-team [data-t=invite]');
  await olga.page.waitForSelector('.lmd-team [data-team=pending]');
  const invited = await olga.page.evaluate(() => ({ pending: document.querySelector('.lmd-team [data-team=pending]').innerText, msg: document.querySelector('.lmd-team-msg').textContent, used: document.querySelector('.lmd-team').innerText }));
  check('invita por correo desde ahí: la invitación queda como pendiente y ocupa un lugar', /pedro@ejemplo\.test/.test(invited.pending) && invited.msg === 'Invitation sent.' && /2 of 3 taken/.test(invited.used) && mails.some((m) => m.to === P.email), invited);
  await olga.page.fill('.lmd-team [data-t=email]', 'no es un correo'); await olga.page.click('.lmd-team [data-t=invite]'); await olga.page.waitForTimeout(200);
  check('un correo mal escrito se avisa ahí mismo, sin mandar nada', (await olga.page.textContent('.lmd-team-msg')) === 'That email does not look valid.' && mails.length === 1, await olga.page.textContent('.lmd-team-msg'));
  // Lugares: el costo que queda se ve antes de confirmar.
  paddleCalls.length = 0;
  await olga.page.click('.lmd-team-seats [data-t=more]'); await olga.page.click('.lmd-team-seats [data-t=more]');
  const preview = await olga.page.evaluate(() => ({ n: document.querySelector('.lmd-team-seats [data-t=n]').textContent, cost: document.querySelector('.lmd-team-cost').textContent, can: !document.querySelector('.lmd-team-seats [data-t=seats]').disabled }));
  check('al cambiar los lugares se ve el costo que queda, antes de confirmar nada', preview.n === '5' && preview.cost === '5 seats: USD 16.98 a month' && preview.can && paddleCalls.length === 0, preview);
  await olga.page.click('.lmd-team-seats [data-t=less]'); await olga.page.click('.lmd-team-seats [data-t=less]'); await olga.page.click('.lmd-team-seats [data-t=less]'); await olga.page.click('.lmd-team-seats [data-t=less]');
  check('no deja bajar de los lugares ocupados', (await olga.page.textContent('.lmd-team-seats [data-t=n]')) === '2' && (await olga.page.textContent('.lmd-team-cost')) === '2 seats: USD 7.98 a month');
  await olga.page.click('.lmd-team-seats [data-t=more]'); await olga.page.click('.lmd-team-seats [data-t=more]');
  await olga.page.click('.lmd-team-seats [data-t=seats]'); await olga.page.waitForSelector('.lmd-dlg');
  const ask = await olga.page.evaluate(() => document.querySelector('.lmd-dlg-card').innerText);
  check('confirmar pasa por un diálogo propio que repite el costo', /Change to 4 seats\?/.test(ask) && /USD 13\.98 a month/.test(ask), ask);
  await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForFunction(() => /2 of 4 taken/.test(document.querySelector('.lmd-team').innerText), null, { timeout: 10000 });
  check('y cambia la suscripción', paddleCalls.length === 1 && paddleCalls[0].body.items[1].quantity === 2 && (await olga.page.textContent('.lmd-team-msg')) === 'Seats changed.', paddleCalls);
  await closePanel(olga.page);

  // Pedro entra a la app: el aviso de la invitación, con aceptar y rechazar.
  const pedro = watch(await R.open(P));
  await pedro.page.goto(R.home); await pedro.page.waitForSelector('.lmd-team-ask');
  const note1 = await pedro.page.evaluate(() => ({ title: document.querySelector('.lmd-team-ask h3').textContent, text: document.querySelector('.lmd-team-ask').innerText, btns: [...document.querySelectorAll('.lmd-team-ask button')].map((b) => b.textContent), team: !!document.querySelector('[data-root=team]') }));
  check('quien tiene una invitación pendiente la ve al entrar a la app, con unirse y rechazar', note1.title === 'olga@ejemplo.test invited you to their team' && note1.btns.join('|') === 'Not now|Decline|Join' && !note1.team && !/[!¡—–]/.test(note1.text), note1);
  await pedro.page.click('.lmd-team-ask [data-t=yes]');
  await pedro.page.waitForSelector('[data-root=team] .lmd-node');
  check('al unirse aparece el espacio del equipo en el explorador, sin recargar', !(await pedro.page.$('.lmd-team-ask')) && (await acct(P)).plan === 'pro' && (await pedro.page.evaluate(() => [...document.querySelectorAll('[data-root=team] .lmd-node-name')].map((n) => n.textContent))).includes('plan.md'));

  // Los dos editan la misma nota del equipo a la vez.
  await pedro.page.goto(tUrl('plan.md', true)); await pedro.page.waitForSelector('.lmd-article p.lmd-editable');
  const puts = [];
  for (const [who, c] of [['olga', olga], ['pedro', pedro]]) c.page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/notes\//.test(r.url())) puts.push([who, r.status(), /[?&]o=/.test(r.url())]); });
  const serverText = async () => (await api('GET', '/notes/' + enc('plan.md') + '?o=' + SP, undefined, O.s)).json;
  const settled = (page) => page.waitForFunction(() => /Saved to the cloud/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 15000 });
  const ROUNDS = 6;
  for (let i = 0; i < ROUNDS; i++) {
    await typeIn(olga.page, 'Primer párrafo', ' olga' + i + '.', 0); await typeIn(pedro.page, 'Tercer párrafo', ' pedro' + i + '.', 0);
    await Promise.all([leave(olga.page), leave(pedro.page)]);
    await Promise.all([settled(olga.page), settled(pedro.page)]);
    await olga.page.waitForFunction((n) => document.querySelector('.lmd-article').innerText.includes('pedro' + n + '.'), i, { timeout: 15000 });
    await pedro.page.waitForFunction((n) => document.querySelector('.lmd-article').innerText.includes('olga' + n + '.'), i, { timeout: 15000 });
  }
  const end = await serverText(); const every = (t) => Array.from({ length: ROUNDS }, (_, i) => i).every((i) => t.split(' olga' + i + '.').length === 2 && t.split(' pedro' + i + '.').length === 2);
  check('dos miembros editando la misma nota del equipo a la vez: en el servidor quedan todos los cambios, una vez cada uno', every(end.text), end.text);
  check('los guardados fueron al espacio del equipo, y los que chocaron por la revisión se resolvieron solos', puts.every((p) => p[2]) && puts.some((p) => p[1] === 409) && puts.filter((p) => p[1] === 200).length >= ROUNDS * 2, puts.map((p) => p[1]).join(' '));
  check('los dos ven lo mismo', every(await olga.page.evaluate(() => document.querySelector('.lmd-article').innerText)) && every(await pedro.page.evaluate(() => document.querySelector('.lmd-article').innerText)));

  // Pedro crea una nota en el equipo desde el explorador, con el diálogo propio.
  await pedro.page.click('[data-root=team] .lmd-tree-new'); await pedro.page.click('.lmd-menu [data-f=new]');
  await pedro.page.waitForSelector('.lmd-dlg input'); await pedro.page.fill('.lmd-dlg input', 'ideas'); await pedro.page.keyboard.press('Enter');
  await pedro.page.waitForFunction(() => /ideas\.md/.test(decodeURIComponent(location.href)), null, { timeout: 10000 });
  await pedro.page.waitForSelector('.lmd-article h1');
  await pedro.page.waitForFunction(() => [...document.querySelectorAll('[data-root=team] .lmd-node-name')].some((n) => n.textContent === 'ideas.md'), null, { timeout: 10000 }).catch(() => {});
  const made = [(await api('GET', '/notes/' + enc('ideas.md') + '?o=' + SP, undefined, O.s)).json.text, (await api('GET', '/notes', undefined, P.s)).json.length, await pedro.page.evaluate(() => [...document.querySelectorAll('[data-root=team] .lmd-node-name')].map((n) => n.textContent))];
  check('un miembro crea una nota en el equipo desde el explorador', made[0] === '# ideas\n' && made[1] === 0 && made[2].includes('ideas.md'), made);
  // Y la renombra: el diálogo muestra el nombre, sin la marca interna del espacio.
  await pedro.page.click('[data-root=team] .lmd-node.lmd-active', { button: 'right' }); await pedro.page.click('.lmd-menu [data-f=ren]');
  await pedro.page.waitForSelector('.lmd-dlg input');
  const shownName = await pedro.page.inputValue('.lmd-dlg input');
  await pedro.page.fill('.lmd-dlg input', 'notas/ideas.md'); await pedro.page.keyboard.press('Enter');
  await pedro.page.waitForFunction(() => /notas\/ideas\.md/.test(decodeURIComponent(location.href)), null, { timeout: 10000 });
  check('y la mueve a una carpeta del equipo', shownName === 'ideas.md' && (await api('GET', '/notes/' + enc('notas/ideas.md') + '?o=' + SP, undefined, O.s)).status === 200 && (await api('GET', '/notes/' + enc('ideas.md') + '?o=' + SP, undefined, O.s)).status === 404, shownName);

  // Lo que ve un miembro en Plan, y salir del equipo.
  await openPlan(pedro.page);
  const member = await pedro.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); return { text: b.querySelector('.lmd-team').innerText, invite: !!b.querySelector('[data-t=invite]'), seats: !!b.querySelector('.lmd-team-seats'), remove: !!b.querySelector('[data-t=remove]'), paid: b.querySelector('.lmd-plans-guest').innerText, cols: b.querySelectorAll('.lmd-plan').length, buy: !!b.querySelector('[data-pay], .lmd-plan-buy'), all: b.innerText }; });
  check('un miembro ve en qué equipo está y quién lo administra, sin nada de gestión', /Managed by olga@ejemplo\.test/.test(member.text) && /Leave the team/.test(member.text) && !member.invite && !member.seats && !member.remove, member);
  check('y que el plan pago lo tiene por el equipo, con su papel', /You have everything in the paid plan through your team\./.test(member.paid) && /Your role\s+Editor/.test(member.text), [member.paid, member.text.slice(0, 200)]);
  check('sin planes, precios ni botones de compra: el cobro es de quien paga', member.cols === 1 && !member.buy && !/USD|\$|\/ month|Subscribe|seats?\b/i.test(member.all), member.all);
  check('los ajustes del equipo le aparecen bloqueados, con quién los administra', await pedro.page.evaluate(() => { const p = document.querySelector('.lmd-team [data-team=policies]'); return !!p && /Managed by your team administrator/.test(p.innerText) && [...p.querySelectorAll('input, select')].every((i) => i.disabled) && !p.querySelector('button'); }));
  await closePanel(pedro.page);

  // Olga saca a Pedro desde Plan, con confirmación propia.
  await openPlan(olga.page);
  await olga.page.click('.lmd-team [data-t=remove]'); await olga.page.waitForSelector('.lmd-dlg');
  check('sacar a alguien pide confirmación en un diálogo propio', /Remove pedro@ejemplo\.test from the team\?/.test(await olga.page.textContent('.lmd-dlg-card')));
  await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForFunction(() => !/pedro@ejemplo\.test/.test(document.querySelector('.lmd-team').innerText), null, { timeout: 10000 });
  check('y lo saca', (await acct(P)).team.mine === null && (await acct(P)).plan === 'free');
  await closePanel(olga.page);

  // La papelera del equipo: lo que se elimina del espacio queda ahí, y se restaura desde el explorador.
  await api('PUT', '/notes/' + enc('tacho.md') + '?o=' + SP, { text: '# Tacho\n' }, O.s);
  await olga.page.goto(tUrl('plan.md')); await olga.page.waitForSelector('[data-root=team] .lmd-node:has-text("tacho.md")');
  await olga.page.locator('[data-root=team] .lmd-node', { hasText: 'tacho.md' }).click({ button: 'right' }); await olga.page.click('.lmd-menu [data-f=del]'); await olga.page.waitForSelector('.lmd-dlg');
  const delText = await olga.page.textContent('.lmd-dlg-card p');
  await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForFunction(() => ![...document.querySelectorAll('[data-root=team] .lmd-node-name')].some((n) => n.textContent === 'tacho.md'));
  await olga.page.click('[data-root=team] > .lmd-trash-link'); await olga.page.waitForSelector('.lmd-trash li');
  const tbin = await olga.page.evaluate(() => ({ title: document.querySelector('.lmd-trash h3').textContent, rows: [...document.querySelectorAll('.lmd-trash li b')].map((b) => b.textContent), all: document.querySelector('.lmd-trash').innerText }));
  const ownBin = (await api('GET', '/trash', undefined, O.s)).json.length;
  check('eliminar una nota del equipo la manda a la papelera del equipo, no a la personal', /30 days/.test(delText) && tbin.title === 'Team trash' && tbin.rows.join() === 'tacho.md' && ownBin === 0, [delText, tbin, ownBin]);
  check('los textos de la papelera no llevan signos de admiración ni rayas largas', !/[!¡—–]/.test(tbin.all + delText), tbin.all);
  await olga.page.click('.lmd-trash [data-tr=back]');
  await olga.page.waitForSelector('[data-root=team] .lmd-node:has-text("tacho.md")');
  check('y desde ahí vuelve al espacio del equipo', (await api('GET', '/notes/' + enc('tacho.md') + '?o=' + SP, undefined, O.s)).json.text === '# Tacho\n' && (await api('GET', '/trash?o=' + SP, undefined, O.s)).json.length === 0);
  await olga.page.click('.lmd-trash [data-tr=no]');

  // Eliminar la cuenta con el cobro del equipo activo: no se borra, y dice qué hacer antes.
  await olga.page.evaluate(() => document.querySelector('[data-act=settings]').click()); await olga.page.waitForSelector('.lmd-panel-card'); await olga.page.click('[data-ptab=cloud]');
  await olga.page.waitForSelector('[data-acct=cloud] [data-c=delete]'); await olga.page.click('[data-acct=cloud] [data-c=delete]'); await olga.page.waitForSelector('.lmd-dlg input');
  const askDel = await olga.page.evaluate(() => document.querySelector('.lmd-dlg').innerText);
  await olga.page.fill('.lmd-dlg input', O.email); await olga.page.keyboard.press('Enter');
  await olga.page.waitForSelector('.lmd-dlg .lmd-dlg-link a');
  const blocked = await olga.page.evaluate(() => {
    const d = document.querySelector('.lmd-dlg'); const link = d.querySelector('.lmd-dlg-link');
    const out = { title: d.querySelector('h3').textContent, text: d.querySelector('p').textContent, href: link.querySelector('a').href, buttons: d.querySelectorAll('.lmd-ask-actions button').length, shown: link.offsetParent !== null, all: d.innerText };
    document.documentElement.classList.add('lmd-store-app'); out.inStore = link.offsetParent !== null; document.documentElement.classList.remove('lmd-store-app');
    return out;
  });
  check('eliminar la cuenta con el cobro del equipo activo avisa que primero se cancela, con el enlace al portal', blocked.title === 'Cancel the team subscription first' && /Cancel it, then delete the account/.test(blocked.text) && blocked.href.startsWith(PORTAL) && blocked.buttons === 1 && blocked.shown && (await acct(O)).email === O.email && (await acct(O)).team.mine.role === 'admin', blocked);
  check('dentro de la app de la tienda ese aviso no muestra el enlace de pago', blocked.inStore === false);
  check('los textos de eliminar la cuenta no llevan signos de admiración ni rayas largas', !/[!¡—–]/.test(askDel + blocked.all), [askDel, blocked.all]);
  await olga.page.click('.lmd-dlg [data-dlg=ok]'); await closePanel(olga.page);
  await pedro.page.goto(R.home); await pedro.page.waitForSelector('.lmd-home'); await pedro.page.waitForTimeout(1200);
  check('a quien sacaron ya no le aparece el espacio del equipo', !(await pedro.page.$('[data-root=team]')));
  await pedro.ctx.close();

  // Quique ya paga por su lado: se lo invita, lo deja para después, y se une desde Plan en un teléfono.
  await invite(O, Q.email);
  const quique = watch(await R.open(Q, { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await api('PUT', '/notes/' + enc('mia.md'), { text: '# Mía\n\nUna nota propia.\n' }, Q.s);
  await quique.page.goto(R.noteUrl('mia.md')); await quique.page.waitForSelector('.lmd-team-ask');
  const fits = (sel) => quique.page.evaluate((s) => { const card = document.querySelector(s); const box = card.getBoundingClientRect(); const out = [...card.querySelectorAll('button, input, a')].filter((n) => n.offsetParent).filter((n) => { const b = n.getBoundingClientRect(); return b.left < -0.5 || b.right > innerWidth + 0.5 || b.width < 1; }).map((n) => n.textContent || n.type); return { w: innerWidth, left: box.left, right: box.right, out, sideways: document.documentElement.scrollWidth - innerWidth }; }, sel);
  const phoneAsk = await fits('.lmd-team-ask .lmd-ask-card');
  const phoneBtns = await quique.page.evaluate(() => [...document.querySelectorAll('.lmd-team-ask button')].map((b) => Math.round(b.getBoundingClientRect().height)));
  check('en un teléfono el aviso de la invitación entra en la pantalla, con botones cómodos para el dedo', phoneAsk.left >= 0 && phoneAsk.right <= phoneAsk.w && !phoneAsk.out.length && phoneAsk.sideways <= 0 && phoneBtns.every((h) => h >= 40), [phoneAsk, phoneBtns]);
  check('a quien ya paga un plan individual se le avisa que su suscripción sigue activa', /Your individual subscription is still active\. You can cancel it from Settings, Plan\./.test(await quique.page.textContent('.lmd-team-ask')));
  await quique.page.click('.lmd-team-ask [data-t=later]');
  check('"Ahora no" cierra el aviso y deja la invitación pendiente', !(await quique.page.$('.lmd-team-ask')) && (await pendingFor(Q)).length === 1);
  await openPlan(quique.page);
  await quique.page.waitForSelector('.lmd-team [data-team=invites]');
  const phonePlan = await quique.page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); const cols = [...document.querySelectorAll('.lmd-panel .lmd-plan')].map((p) => Math.round(p.getBoundingClientRect().left)); return { sideways: body.scrollWidth - body.clientWidth, cols, text: document.querySelector('.lmd-team').innerText }; });
  check('en un teléfono Plan no se desborda de costado y las tres columnas quedan una debajo de otra', phonePlan.sideways <= 0 && phonePlan.cols.length === 3 && new Set(phonePlan.cols).size === 1, phonePlan);
  check('la invitación sigue en Plan', /olga@ejemplo\.test invited you to their team/.test(phonePlan.text), phonePlan.text);
  await quique.page.click('.lmd-team [data-team=invites] [data-t=yes]');
  await quique.page.waitForSelector('.lmd-team [data-t=leave]');
  const solo = await quique.page.evaluate(() => { const n = document.querySelector('.lmd-team-solo'); return n ? { text: n.innerText, href: (n.querySelector('a') || {}).href || '' } : null; });
  check('al unirse, Plan le dice que su suscripción individual sigue activa, con el enlace para darla de baja', !!solo && /Your individual subscription is still active\./.test(solo.text) && /Cancel it/.test(solo.text) && solo.href.startsWith(PORTAL), solo);
  const phoneTeam = await fits('.lmd-panel [data-acct=plan]');
  check('y la gestión del equipo entra en el ancho del teléfono', !phoneTeam.out.length, phoneTeam);
  const drawer = await quique.page.evaluate(() => ({ team: !!document.querySelector('[data-root=team]'), nodes: [...document.querySelectorAll('[data-root=team] .lmd-node-name')].map((n) => n.textContent) }));
  check('el espacio del equipo está en el explorador del teléfono', drawer.team && drawer.nodes.includes('plan.md'), drawer);
  await quique.page.click('.lmd-team [data-t=leave]'); await quique.page.waitForSelector('.lmd-dlg');
  check('salir del equipo pide confirmación y dice qué pasa con las notas', /Leave the team\?/.test(await quique.page.textContent('.lmd-dlg-card')) && /keep your notes/.test(await quique.page.textContent('.lmd-dlg-card')));
  await quique.page.click('.lmd-dlg [data-dlg=ok]');
  await quique.page.waitForFunction(() => !document.querySelector('.lmd-team [data-t=leave]'), null, { timeout: 10000 });
  const q2 = await acct(Q);
  check('y sale: conserva su plan propio y sus notas, y el equipo ya no está en su explorador', q2.team.mine === null && q2.plan === 'pro' && (await api('GET', '/notes/' + enc('mia.md'), undefined, Q.s)).status === 200 && !(await quique.page.$('[data-root=team]')));
  await quique.ctx.close();

  // Sin el cobro configurado, el plan de equipo no se ofrece: lo prueba settings.mjs con su servidor. Acá, quien no
  // está en un equipo lo ve como una opción con su botón de pago.
  const carla = watch(await R.open(C));
  await api('PUT', '/notes/' + enc('suya.md'), { text: '# Suya\n' }, C.s);
  await carla.page.goto(R.noteUrl('suya.md')); await carla.page.waitForSelector('.lmd-article h1');
  await openPlan(carla.page);
  const offer = await carla.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); const t = b.querySelector('.lmd-plan-team'); return { on: t.classList.contains('lmd-plan-on'), pay: (t.querySelector('[data-pay=team]') || {}).href || '', label: (t.querySelector('[data-pay=team]') || {}).textContent, mgmt: !!b.querySelector('.lmd-team'), root: !!document.querySelector('[data-root=team]') }; });
  check('quien no está en un equipo ve el plan de equipo como una opción más, con su enlace de pago y la dirección a la que volver', !offer.on && offer.pay.startsWith('https://pago.ejemplo.test/pay.html?plan=team&email=' + enc(C.email) + '&back=') && offer.label === 'USD 7.98 / month' && !offer.mgmt && !offer.root, offer);
  // Sale a pagar y vuelve: la app espera a que el equipo exista (lo crea el aviso de Paddle) y recién ahí lo confirma.
  await carla.ctx.route((url) => url.hostname === 'pago.ejemplo.test', (r) => r.fulfill({ contentType: 'text/html', body: '<p>pago</p>' }));
  await carla.page.click('.lmd-plan-team [data-pay=team]'); await carla.page.waitForURL(/pago\.ejemplo\.test/);
  const went = new URL(carla.page.url());
  check('el botón lleva a la página de pago del equipo, con el correo de la cuenta y la vuelta a la nota', went.searchParams.get('plan') === 'team' && went.searchParams.get('email') === C.email && went.searchParams.get('back').startsWith(R.home), carla.page.url());
  await carla.page.goto(R.noteUrl('suya.md') + '#lmd-paid'); await carla.page.waitForSelector('.lmd-paywait');
  check('al volver del pago espera la confirmación', /Waiting for the payment confirmation/.test(await carla.page.textContent('.lmd-paywait')) && !(await carla.page.$('[data-root=team]')));
  await teamSub('sub_eq_c', 'active', C.email, 0);
  await carla.page.waitForSelector('.lmd-paywait-done', { timeout: 20000 });
  await carla.page.waitForSelector('[data-root=team]');
  const paid = await carla.page.evaluate(() => ({ msg: document.querySelector('.lmd-paywait').innerText.trim(), on: !!document.querySelector('.lmd-plan-team.lmd-plan-on'), team: document.querySelector('.lmd-team') ? document.querySelector('.lmd-team').innerText : '' }));
  check('cuando llega el aviso de Paddle confirma el pago y aparece el equipo, con su gestión y su espacio', paid.msg === 'Payment confirmed. Your team is ready.' && paid.on && /carla@ejemplo\.test · Administrator/.test(paid.team) && /1 of 2 taken/.test(paid.team), paid);
  await carla.ctx.close();

  // ---------- Página de pago y portada ----------
  console.log('Página de pago y portada');
  const PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const shop = watch(await R.open(null, PHONE));
  // Paddle.js no se carga de verdad: un doble anota con qué se abriría el checkout.
  await shop.ctx.route((url) => url.hostname === 'cdn.paddle.com', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Paddle = { Initialize: function (o) { window.__init = o; }, Checkout: { open: function (o) { window.__open = o; } } };' }));
  const sections = () => shop.page.evaluate(() => [...document.querySelectorAll('main section')].filter((s) => !s.hidden).map((s) => s.id));
  const sideways = () => shop.page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, out: [...document.querySelectorAll('main a, main button')].filter((n) => n.offsetParent).filter((n) => { const b = n.getBoundingClientRect(); return b.left < 0 || b.right > innerWidth; }).length }));
  await shop.page.goto(R.origin + '/pay.html?plan=team&email=' + enc('ana@ejemplo.test')); await shop.page.waitForTimeout(300);
  check('pay.html: mientras no estén cargados los precios del equipo, no ofrece pagarlo', (await sections()).join() === 'noteam' && !(await shop.page.evaluate(() => window.__open)));
  await shop.page.goto(R.origin + '/pay.html?plan=monthly&email=' + enc('ana@ejemplo.test')); await shop.page.waitForTimeout(300);
  check('pay.html: y el plan individual no lo menciona', (await sections()).join() === 'buy' && (await shop.page.evaluate(() => document.getElementById('team').hidden && document.getElementById('amount').textContent === 'USD 3.99')));
  // Con los dos precios puestos en la página (acá, de prueba), el plan de equipo se arma con sus dos ítems.
  await shop.ctx.route((url) => url.pathname === '/pay.html', async (r) => { const res = await r.fetch(); const body = (await res.text()).replace("var TEAM = { base: '', seat: ''", "var TEAM = { base: '" + BASE + "', seat: '" + SEAT + "'"); await r.fulfill({ response: res, body }); });
  await shop.page.goto(R.origin + '/pay.html?plan=team&email=' + enc('ana@ejemplo.test')); await shop.page.waitForSelector('#buy:not([hidden])');
  const teamPay = await shop.page.evaluate(() => ({ title: document.querySelector('#buy h1').innerText.trim(), amount: document.getElementById('amount').textContent, cycle: document.getElementById('cycle').textContent, seats: document.getElementById('seats').textContent, less: document.getElementById('less').disabled, text: document.getElementById('buy').innerText, other: document.getElementById('other').textContent }));
  check('pay.html: el plan de equipo muestra su precio para 2 personas, mensual', teamPay.title === 'Team plan' && teamPay.amount === 'USD 7.98' && teamPay.cycle === 'a month' && teamPay.seats === '2' && teamPay.less && /USD 3 a month for each extra one/.test(teamPay.text) && /Individual plan: USD 3\.99 a month/.test(teamPay.other) && !/[!¡—–]/.test(teamPay.text), teamPay);
  check('pay.html: entra en el ancho de un teléfono', (await sideways()).over <= 0 && (await sideways()).out === 0, await sideways());
  await shop.page.click('#go');
  const forTwo = await shop.page.evaluate(() => window.__open);
  check('pay.html: para 2 personas el checkout lleva solo el precio base, a nombre de la cuenta', JSON.stringify(forTwo.items) === JSON.stringify([{ priceId: BASE, quantity: 1 }]) && forTwo.customData.sharpmd_email === 'ana@ejemplo.test' && forTwo.customer.email === 'ana@ejemplo.test', forTwo);
  await shop.page.click('#more'); await shop.page.click('#more'); await shop.page.click('#more');
  check('pay.html: al sumar personas el precio se actualiza', (await shop.page.textContent('#amount')) === 'USD 16.98' && (await shop.page.textContent('#seats')) === '5');
  await shop.page.click('#go');
  const five = await shop.page.evaluate(() => window.__open);
  check('pay.html: y el checkout suma el precio por lugar con esa cantidad', JSON.stringify(five.items) === JSON.stringify([{ priceId: BASE, quantity: 1 }, { priceId: SEAT, quantity: 3 }]), five.items);
  await shop.page.goto(R.origin + '/pay.html?plan=monthly&email=' + enc('ana@ejemplo.test')); await shop.page.waitForSelector('#buy:not([hidden])');
  const cross = await shop.page.evaluate(() => ({ hidden: document.getElementById('team').hidden, href: document.getElementById('team').getAttribute('href'), text: document.getElementById('team').innerText }));
  check('pay.html: desde el plan individual se llega al de equipo', !cross.hidden && /^pay\.html\?plan=team&email=ana%40ejemplo\.test$/.test(cross.href) && /Team plan: USD 7\.98 a month for 2 people/.test(cross.text) && (await sideways()).out === 0, cross);
  // La portada, en inglés y en castellano, en teléfono y en escritorio.
  const plansOf = (page) => page.evaluate(() => ({ plans: [...document.querySelectorAll('#plans .plan')].map((p) => ({ name: p.querySelector('h3').textContent, price: p.querySelector('.price').textContent.replace(/\s+/g, ' ').trim(), left: Math.round(p.getBoundingClientRect().left), top: Math.round(p.getBoundingClientRect().top), right: Math.round(p.getBoundingClientRect().right) })), over: document.documentElement.scrollWidth - innerWidth, w: innerWidth, text: document.querySelector('#plans').innerText }));
  await shop.page.goto(R.origin + '/index.html?site'); await shop.page.waitForSelector('#plans .plan');
  const landPhone = await plansOf(shop.page);
  const teamOpen = /var TEAM = \{ base: '[^']+', seat: '[^']+'/.test(fs.readFileSync(new URL('../pay.html', import.meta.url), 'utf8'));
  // La portada muestra el plan de equipo cuando su cobro está abierto (los dos precios cargados en pay.html).
  if (teamOpen) check('portada: el plan de equipo es la tercera columna, y en un teléfono las tres quedan una debajo de otra sin desbordar', landPhone.plans.length === 3 && landPhone.plans[2].name === 'Team' && landPhone.plans[2].price === 'USD 7.98 a month' && new Set(landPhone.plans.map((p) => p.left)).size === 1 && landPhone.plans.every((p) => p.right <= landPhone.w) && landPhone.over <= 0 && /2 people included, USD 3 for each extra one/.test(landPhone.text), landPhone.plans);
  else check('portada sin el plan de equipo abierto: quedan los dos planes y no se lo nombra', landPhone.plans.length === 2 && !/Team|7\.98/.test(landPhone.text) && landPhone.over <= 0, landPhone.plans);
  await shop.page.goto(R.origin + '/es/index.html?site'); await shop.page.waitForSelector('#plans .plan');
  const landEs = await plansOf(shop.page);
  if (teamOpen) check('portada en castellano: lo mismo', landEs.plans.length === 3 && landEs.plans[2].name === 'Equipo' && landEs.plans[2].price === 'USD 7.98 por mes' && landEs.over <= 0 && /2 personas incluidas, USD 3 por cada una más/.test(landEs.text) && !/[!¡—–]/.test(landEs.text), landEs.plans);
  else check('portada en castellano sin el plan abierto: tampoco', landEs.plans.length === 2 && !/Equipo|7\.98/.test(landEs.text) && landEs.over <= 0, landEs.plans);
  await shop.ctx.close();
  const desk = await R.open(null);
  await desk.page.goto(R.origin + '/index.html?site'); await desk.page.waitForSelector('#plans .plan');
  const landDesk = await plansOf(desk.page);
  if (teamOpen) check('portada en escritorio: las tres columnas en una fila', landDesk.plans.length === 3 && new Set(landDesk.plans.map((p) => p.top)).size === 1 && landDesk.over <= 0, landDesk.plans);
  else check('portada en escritorio sin el plan abierto: dos columnas en una fila', landDesk.plans.length === 2 && new Set(landDesk.plans.map((p) => p.top)).size === 1 && landDesk.over <= 0, landDesk.plans);
  // La comparación fila por fila: cada plan trae las mismas filas en el mismo orden, y lo que no incluye queda apagado, sin frase.
  const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#plans .plan')].map((p) => ({ rows: [...p.querySelectorAll('.rows li')].map((li) => li.querySelector('span').textContent.trim()), off: [...p.querySelectorAll('.rows li.no')].map((li) => li.querySelector('span').textContent.trim()), tops: [...p.querySelectorAll('.rows li')].map((li) => Math.round(li.getBoundingClientRect().top)),
    cta: p.querySelector('a.btn').getAttribute('href'), label: p.querySelector('a.btn').textContent.trim(), text: p.innerText })));
  const cmp = await rowsOf(desk.page); const [freeP, paidP] = cmp;
  check('portada: los planes se comparan fila por fila, con las mismas filas en el mismo orden y a la misma altura', cmp.every((p) => p.rows.length >= 10 && p.rows.join('|') === freeP.rows.join('|') && p.tops.join() === freeP.tops.join()), cmp.map((p) => [p.rows.length, p.tops.slice(0, 3)]));
  check('portada: lo que el plan gratis no incluye figura como ausente, y el pago lo trae', ['Sharing and public links', 'Live sessions by link', 'The MCP connection for your AI', 'Version history', 'Colors, fonts and your own CSS'].every((r) => freeP.off.includes(r) && !paidP.off.includes(r)) && !freeP.off.includes('Notes in the cloud') && /Notes in the cloud\s*10/.test(freeP.text) && /Notes in the cloud\s*No limit/.test(paidP.text) && !/[!¡—–]/.test(cmp.map((p) => p.text).join('')), [freeP.off, paidP.off]);
  check('portada: cada plan tiene su botón, el gratis abre la app y el pago la abre en los planes', freeP.cta === 'src/app.html' && paidP.cta === 'src/app.html#lmd-plans' && cmp.every((p) => p.label.length > 3) && (teamOpen ? cmp[2].cta === 'src/app.html#lmd-plans' : cmp.length === 2) && /USD 3\.99 a month/.test(paidP.text) && /or USD 39 a year/.test(paidP.text) && /USD 0/.test(freeP.text), cmp.map((p) => [p.cta, p.label]));
  await desk.ctx.close();

  check('nunca se usó alert, confirm ni prompt del navegador', !natives.length, natives);
  check('Paddle solo recibió cambios de lugares, siempre con la clave', paddleCalls.every((c) => c.method === 'PATCH' && c.auth === 'Bearer ' + KEY));
  check('sin errores de página', !R.errors.length, R.errors);
  check('ningún pedido salió a producción', !R.outside.length, R.outside);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }
await R.close();
fakePaddle.close(); fakeMail.close();
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ }
process.exit(done() ? 1 : 0);
