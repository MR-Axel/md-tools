// Administración de un equipo: los tres papeles (quien administra, quien edita, quien solo lee) contra cada vía del
// espacio (HTTP, avisos en vivo, MCP), las políticas que decide quien administra, el cobro que solo ve quien paga,
// el registro de actividad con su exportación, los tokens del equipo y el historial largo. Contra el servidor y
// con navegadores de verdad. El correo es un servidor falso local: nada sale de esta máquina.
import { rig, tally, sleep } from './rig.mjs';
import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';

const mails = [];
const fakeMail = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { mails.push(JSON.parse(raw)); res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mdadm-'));
const PORTAL = 'https://portal.ejemplo.test';
const R = await rig({ PADDLE_WEBHOOK_SECRET: 'firma', PADDLE_PRICE_TEAM: 'pri_equipo', PADDLE_API_KEY: 'clave', PADDLE_API_URL: 'http://127.0.0.1:9',
  CHECKOUT_TEAM: 'https://pago.ejemplo.test/pay.html?plan=team', CHECKOUT_MONTHLY: 'https://pago.ejemplo.test/pay.html?plan=monthly', CHECKOUT_YEARLY: 'https://pago.ejemplo.test/pay.html?plan=yearly', PORTAL_URL: PORTAL,
  MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port, AUTH_PER_IP: '300', DATA_DIR: DATA, DATA_KEY: randomBytes(32).toString('base64'), APP_URL: 'https://app.ejemplo.test/' });
const { check, done } = tally();
const enc = encodeURIComponent;

try {
  const { api } = R;
  const acct = async (who) => (await api('GET', '/account', undefined, who.s)).json;
  const mine = async (who) => (await acct(who)).team.mine;
  const adminTeam = (email, seats) => api('POST', '/admin/team', { email, seats }, undefined, { 'x-admin-key': R.ADMIN });
  const tool = async (t, name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, t); return r.json ? r.json.result : { status: r.status }; };
  const text = (r) => (r && r.content ? r.content[0].text : '');
  const tools = async (t) => (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, t)).json.result.tools.map((x) => x.name);
  const listen = async (who, p, o) => {
    const ctrl = new AbortController(); const st = { text: '', status: 0, closed: false, stop: () => ctrl.abort() };
    const res = await fetch(R.base + '/events?path=' + enc(p) + (o ? '&o=' + o : ''), { headers: { authorization: 'Bearer ' + who.s }, signal: ctrl.signal });
    st.status = res.status;
    if (res.ok) (async () => { const rd = res.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; st.text += d.decode(x.value); } } catch (e) { /* se cortó */ } st.closed = true; })();
    return st;
  };
  const log = async (who, qs) => (await api('GET', '/team/log' + (qs ? '?' + qs : ''), undefined, who.s));
  const acts = async (who, qs) => ((await log(who, qs)).json.entries || []).map((e) => e.action);

  // Ana paga y administra; Beto edita; Rita solo lee; Dana administra sin pagar; Zoe no es del equipo.
  const A = await R.signup('ana@ejemplo.test'); const B = await R.signup('beto@ejemplo.test'); const RD = await R.signup('rita@ejemplo.test');
  const D = await R.signup('dana@ejemplo.test'); const Z = await R.signup('zoe@ejemplo.test', true);
  await adminTeam(A.email, 6);
  const SPACE = (await mine(A)).space; const O = '?o=' + SPACE;

  // ---------- Papeles ----------
  console.log('Papeles');
  const inv1 = await api('POST', '/team/invite', { email: B.email }, A.s);
  const inv2 = await api('POST', '/team/invite', { email: RD.email, role: 'reader' }, A.s);
  const inv3 = await api('POST', '/team/invite', { email: D.email, role: 'admin' }, A.s);
  const invBad = await api('POST', '/team/invite', { email: 'x@ejemplo.test', role: 'owner' }, A.s);
  check('el papel se elige al invitar: sin decirlo, editor; uno que no existe se rechaza', inv1.status === 200 && inv2.status === 200 && inv3.status === 200 && invBad.status === 400 && invBad.json.error === 'bad_role', [inv1.status, inv2.status, inv3.status, invBad.json]);
  const pend = (await mine(A)).pending;
  check('quien administra ve cada invitación pendiente con su papel', pend.length === 3 && pend.find((p) => p.email === RD.email).role === 'reader' && pend.find((p) => p.email === B.email).role === 'editor', pend);
  const seenInv = (await acct(RD)).team.invites;
  check('y quien fue invitado ve con qué papel entra', seenInv.length === 1 && seenInv[0].role === 'reader', seenInv);
  for (const w of [B, RD, D]) await api('POST', '/team/accept', { id: (await acct(w)).team.invites[0].id }, w.s);
  const mA = await mine(A); const mB = await mine(B); const mR = await mine(RD); const mD = await mine(D);
  check('cada cuenta entra con su papel, y quien paga es administrador y dueño', mA.role === 'admin' && mA.owner === true && mB.role === 'editor' && mB.owner === false && mR.role === 'reader' && mD.role === 'admin' && mD.owner === false, [mA.role, mB.role, mR.role, mD.role]);
  check('quien solo lee ocupa un lugar como cualquiera', mA.used === 4 && mA.seats === 6, [mA.used, mA.seats]);
  check('la lista de miembros dice el papel de cada uno', mB.members.length === 4 && mB.members.find((m) => m.email === RD.email).role === 'reader' && mB.members.find((m) => m.email === A.email).owner === true, mB.members);
  check('lo que puede cada uno en el espacio viaja con el equipo', mB.can.write === true && mR.can.write === false && mR.can.share === false && mA.can.share === true && mB.can.share === false && mB.can.tokens === true, [mB.can, mR.can]);

  // Las notas del espacio, por HTTP.
  const put = (who, p, body, o) => api('PUT', '/notes/' + enc(p) + (o === false ? '' : O), typeof body === 'string' ? { text: body } : body, who.s);
  const w1 = await put(B, 'plan.md', '# Plan\n\nuno');
  check('quien edita crea notas en el espacio', w1.status === 200 && w1.json.rev === 1, w1.json);
  const rRead = await api('GET', '/notes/plan.md' + O, undefined, RD.s);
  check('quien solo lee las lee, y el servidor le dice que entra a ver', rRead.status === 200 && rRead.json.text.includes('uno') && rRead.json.role === 'view', rRead.json);
  check('a quien edita le dice que entra como miembro', (await api('GET', '/notes/plan.md' + O, undefined, B.s)).json.role === 'team');
  const rPut = await put(RD, 'plan.md', 'pisado'); const rNew = await put(RD, 'nueva.md', 'x');
  const rDel = await api('DELETE', '/notes/plan.md' + O, undefined, RD.s);
  const rMove = await api('POST', '/rename', { from: 'plan.md', to: 'otra.md', o: SPACE }, RD.s);
  check('quien solo lee no guarda, no crea, no elimina y no mueve: 403 read_only', [rPut, rNew, rDel, rMove].every((r) => r.status === 403 && r.json.error === 'read_only'), [rPut.json, rNew.json, rDel.json, rMove.json]);
  check('y la nota quedó como estaba', (await api('GET', '/notes/plan.md' + O, undefined, B.s)).json.text.includes('uno'));
  const rList = await api('GET', '/notes' + O, undefined, RD.s); const rSearch = await api('GET', '/search?q=uno&o=' + SPACE, undefined, RD.s);
  check('lista y busca como cualquier miembro', rList.status === 200 && rList.json.length === 1 && rSearch.status === 200 && rSearch.json.length === 1, [rList.json, rSearch.json]);
  await sleep(20); await put(B, 'plan.md', '# Plan\n\ndos');
  const rVers = await api('GET', '/versions/plan.md' + O, undefined, RD.s);
  const rVer = rVers.json.length ? await api('GET', '/version/' + rVers.json[0].id + O, undefined, RD.s) : { status: 0 };
  check('ve el historial de una nota', rVers.status === 200 && rVers.json.length === 1 && rVer.status === 200 && rVer.json.text.includes('uno'), [rVers.json, rVer.status]);
  // La papelera.
  await put(B, 'vieja.md', 'se va'); await api('DELETE', '/notes/vieja.md' + O, undefined, B.s);
  const tList = await api('GET', '/trash' + O, undefined, RD.s); const tid = tList.json[0].id;
  const tRest = await api('POST', '/trash/' + tid + '/restore' + O, {}, RD.s); const tDel = await api('DELETE', '/trash/' + tid + O, undefined, RD.s); const tEmpty = await api('DELETE', '/trash' + O, undefined, RD.s);
  check('ve la papelera del equipo pero no restaura, no borra ni la vacía', tList.status === 200 && tList.json.length === 1 && [tRest, tDel, tEmpty].every((r) => r.status === 403 && r.json.error === 'read_only'), [tRest.json, tDel.json, tEmpty.json]);
  const tOk = await api('POST', '/trash/' + tid + '/restore' + O, {}, B.s);
  check('quien edita sí restaura', tOk.status === 200 && tOk.json.path === 'vieja.md', tOk.json);
  // Avisos en vivo.
  const ear = await listen(RD, 'plan.md', SPACE); await sleep(150);
  await put(B, 'plan.md', '# Plan\n\ntres'); await sleep(250);
  check('quien solo lee escucha los cambios de la nota', ear.status === 200 && /"type":"saved"/.test(ear.text), ear.text.slice(0, 200));
  const earZ = await listen(Z, 'plan.md', SPACE);
  check('quien no es del equipo no escucha', earZ.status === 403);
  // Cambiar el papel.
  const up = await api('POST', '/team/role', { id: RD.id, role: 'editor' }, D.s); await sleep(150);
  check('otra persona que administra cambia un papel, y la conexión abierta de esa cuenta se corta para que vuelva a entrar', up.status === 200 && up.json.team.mine.members.find((m) => m.id === RD.id).role === 'editor' && ear.closed === true, [up.json, ear.closed]);
  check('con el papel nuevo ya guarda', (await put(RD, 'de-rita.md', 'hola')).status === 200);
  await api('POST', '/team/role', { id: RD.id, role: 'reader' }, A.s);
  check('y al volver a solo leer, deja de guardar en el acto', (await put(RD, 'de-rita.md', 'otra vez')).status === 403);
  const noOwner = await api('POST', '/team/role', { id: A.id, role: 'editor' }, D.s); const noKick = await api('POST', '/team/remove', { id: A.id }, D.s);
  check('a quien paga nadie le cambia el papel ni lo saca', noOwner.status === 409 && noOwner.json.error === 'owner_stays' && noKick.status === 409 && (await mine(A)).role === 'admin', [noOwner.json, noKick.json]);
  const byB = await api('POST', '/team/role', { id: RD.id, role: 'admin' }, B.s); const selfUp = await api('POST', '/team/role', { id: RD.id, role: 'admin' }, RD.s);
  const badRole = await api('POST', '/team/role', { id: B.id, role: 'jefe' }, A.s); const ghost = await api('POST', '/team/role', { id: Z.id, role: 'editor' }, A.s);
  check('quien no administra no cambia papeles, ni el propio', byB.status === 403 && byB.json.error === 'not_admin' && selfUp.status === 403, [byB.json, selfUp.json]);
  check('un papel inventado o una cuenta de afuera se rechazan', badRole.status === 400 && ghost.status === 404, [badRole.json, ghost.json]);
  const dInv = await api('POST', '/team/invite', { email: 'nuevo@ejemplo.test', role: 'reader' }, D.s); const bInv = await api('POST', '/team/invite', { email: 'otro@ejemplo.test' }, B.s);
  check('quien administra sin pagar invita; quien edita no', dInv.status === 200 && bInv.status === 403, [dInv.json, bInv.json]);

  // ---------- Cobro ----------
  console.log('Cobro');
  const aA = await acct(A); const aB = await acct(B); const aD = await acct(D); const aR = await acct(RD);
  check('quien paga ve la oferta, sus lugares y el enlace de pago', aA.billing === true && aA.team.enabled === true && /plan=team/.test(aA.team.checkout) && aA.team.mine.seats === 6 && /plan=monthly/.test(aA.checkout.monthly), aA);
  for (const [name, a] of [['quien edita', aB], ['quien solo lee', aR]]) check(name + ' no recibe nada de cobro: ni enlaces de pago, ni oferta, ni lugares, ni portal', a.billing === false && a.checkout.monthly === '' && a.checkout.yearly === '' && a.team.enabled === false && a.team.checkout === '' && a.manage === '' && !('seats' in a.team.mine) && !('used' in a.team.mine) && !('billing' in a.team.mine) && !('pending' in a.team.mine) && !/pago\.ejemplo|portal\.ejemplo/.test(JSON.stringify(a)), a);
  check('quien administra sin pagar ve lugares e invitaciones, y nada de pagos', aD.billing === false && aD.team.mine.seats === 6 && Array.isArray(aD.team.mine.pending) && !('billing' in aD.team.mine) && aD.manage === '' && !/pago\.ejemplo|portal\.ejemplo/.test(JSON.stringify(aD)), aD);
  const seatsD = await api('POST', '/team/seats', { seats: 8 }, D.s); const seatsB = await api('POST', '/team/seats', { seats: 8 }, B.s);
  check('cambiar los lugares es de quien paga: ni quien administra ni quien edita', seatsD.status === 403 && seatsD.json.error === 'not_owner' && seatsB.status === 403 && seatsB.json.error === 'not_admin', [seatsD.json, seatsB.json]);
  const tv = await api('POST', '/team/vault', { salt: 'x', iters: 1, wrapped: 'x', check: 'x' }, D.s);
  check('y la protección del espacio también', tv.status === 403 && tv.json.error === 'not_owner', tv.json);

  // ---------- Políticas ----------
  console.log('Políticas');
  const pol0 = (await api('GET', '/team/policies', undefined, B.s)).json;
  check('las políticas nacen así: la IA de cada miembro alcanza el espacio; compartir, enlaces, sesiones y automatizaciones, apagados', pol0.policies.tokens === true && pol0.policies.share === false && pol0.policies.links === false && pol0.policies.live === false && pol0.policies.automation === false && pol0.history_days === 365, pol0);
  for (const [name, w] of [['quien edita', B], ['quien solo lee', RD]]) { const r = await api('PUT', '/team/policies', { share: true }, w.s); check(name + ' no cambia políticas', r.status === 403 && r.json.error === 'not_admin', r.json); }
  check('quien no es de un equipo no tiene políticas que leer ni cambiar', (await api('GET', '/team/policies', undefined, Z.s)).status === 404 && (await api('PUT', '/team/policies', { share: true }, Z.s)).status === 404);
  const shareOff = await api('POST', '/shares', { path: 'plan.md', email: Z.email, role: 'view', o: SPACE }, B.s); const linkOff = await api('POST', '/links', { path: 'plan.md', o: SPACE }, B.s);
  check('con la política apagada, quien edita no comparte hacia afuera ni crea enlaces: 403 team_policy', shareOff.status === 403 && shareOff.json.error === 'team_policy' && linkOff.status === 403 && linkOff.json.error === 'team_policy', [shareOff.json, linkOff.json]);
  const shareA = await api('POST', '/shares', { path: 'plan.md', email: Z.email, role: 'view', o: SPACE }, A.s);
  const zSees = await api('GET', '/shared', undefined, Z.s);
  check('quien administra sí, y a quien recibe le figura el nombre del equipo, no una cuenta interna', shareA.status === 200 && zSees.json.length === 1 && zSees.json[0].by === 'Team' && zSees.json[0].owner === SPACE && !/team:/.test(JSON.stringify(zSees.json)), zSees.json);
  check('esa cuenta lee lo compartido y nada más del espacio', (await api('GET', '/notes/plan.md' + O, undefined, Z.s)).status === 200 && (await api('GET', '/notes/vieja.md' + O, undefined, Z.s)).status === 403 && (await put(Z, 'plan.md', 'x')).status === 403);
  const withMember = await api('POST', '/shares', { path: 'plan.md', email: B.email, o: SPACE }, A.s);
  check('con alguien del equipo no se comparte: ya la tiene', withMember.status === 409 && withMember.json.error === 'already_member', withMember.json);
  const bad1 = await api('PUT', '/team/policies', { share: 'si' }, A.s); const bad2 = await api('PUT', '/team/policies', { history_days: 7 }, A.s); const bad3 = await api('PUT', '/team/policies', { folder: '../afuera' }, A.s);
  check('una política mal escrita se rechaza', [bad1, bad2, bad3].every((r) => r.status === 400), [bad1.json, bad2.json, bad3.json]);
  const on = await api('PUT', '/team/policies', { share: true, links: true, folder: 'notas/', template: '# Título\n\n' }, D.s);
  check('quien administra las cambia, y vuelven como quedaron', on.status === 200 && on.json.policies.share === true && on.json.policies.links === true && on.json.policies.folder === 'notas' && on.json.policies.template === '# Título\n\n' && on.json.team.mine.policies.share === true, on.json);
  check('la plantilla se guarda cifrada en reposo', (() => { const db = new DatabaseSync(path.join(DATA, 'mdtools.db')); const raw = db.prepare('SELECT policies FROM teams').get().policies; db.close(); return !raw.includes('Título') && raw.includes('enc1:'); })());
  check('los miembros leen las políticas, con la carpeta y la plantilla de las notas nuevas', (await api('GET', '/team/policies', undefined, RD.s)).json.policies.template === '# Título\n\n');
  const shareB = await api('POST', '/shares', { path: 'vieja.md', email: Z.email, role: 'edit', o: SPACE }, B.s); const linkB = await api('POST', '/links', { path: 'plan.md', o: SPACE }, B.s);
  check('con la política prendida, quien edita comparte y crea enlaces', shareB.status === 200 && linkB.status === 200 && !!linkB.json.token, [shareB.json, linkB.json]);
  check('el enlace público abre la nota del equipo', (await api('GET', '/public/' + linkB.json.token)).json.text.includes('tres'));
  const shareR = await api('POST', '/shares', { path: 'plan.md', email: 'x@ejemplo.test', o: SPACE }, RD.s); const linkR = await api('POST', '/links', { path: 'plan.md', o: SPACE }, RD.s); const seeR = await api('GET', '/shares' + O, undefined, RD.s);
  check('quien solo lee no comparte, no crea enlaces ni ve con quién está compartido, aun con la política prendida', [shareR, linkR, seeR].every((r) => r.status === 403 && r.json.error === 'read_only'), [shareR.json, linkR.json, seeR.json]);
  const seeB = await api('GET', '/shares?o=' + SPACE + '&path=plan.md', undefined, B.s);
  check('quien edita ve con quién está compartida una nota del equipo', seeB.status === 200 && seeB.json.people.length === 1 && seeB.json.links.length === 1, seeB.json);
  check('lo compartido del equipo no se mezcla con lo propio de nadie', (await api('GET', '/shares', undefined, B.s)).json.people.length === 0 && (await api('GET', '/shares', undefined, A.s)).json.links.length === 0);
  await api('PUT', '/team/policies', { links: false }, A.s);
  const unlinkB = await api('DELETE', '/links/' + linkB.json.id + O, undefined, B.s);
  check('apagar la política frena a quien edita también para revocar', unlinkB.status === 403 && (await api('GET', '/public/' + linkB.json.token)).status === 200, unlinkB.json);
  check('y quien administra revoca el enlace', (await api('DELETE', '/links/' + linkB.json.id + O, undefined, A.s)).status === 200 && (await api('GET', '/public/' + linkB.json.token)).status === 404);
  const zOther = await api('POST', '/shares', { path: 'plan.md', email: 'x@ejemplo.test', o: SPACE }, Z.s);
  check('quien no es del equipo no comparte nada de su espacio', zOther.status === 403 && zOther.json.error === 'no_access', zOther.json);

  // ---------- MCP con el token de cada persona ----------
  console.log('MCP');
  const tok = async (who, extra) => (await api('POST', '/tokens', Object.assign({ name: 'IA de ' + who.email.split('@')[0] }, extra || {}), who.s)).json.token;
  const tB = await tok(B, { share: true }); const tR = await tok(RD, { share: true });
  check('la IA de quien solo lee lee el espacio', text(await tool(tR, 'read_note', { path: '@team/plan.md' })).includes('tres'));
  const mW = await tool(tR, 'write_note', { path: '@team/plan.md', text: 'pisado' }); const mAp = await tool(tR, 'append_note', { path: '@team/plan.md', text: 'más' });
  const mN = await tool(tR, 'write_note', { path: '@team/ia.md', text: 'nueva' }); const mMv = await tool(tR, 'move_note', { from: '@team/plan.md', to: '@team/p2.md' });
  const mSh = await tool(tR, 'share_note', { path: '@team/plan.md', email: 'x@ejemplo.test' }); const mLk = await tool(tR, 'create_public_link', { path: '@team/plan.md' });
  check('pero no escribe, no agrega, no crea, no mueve, no comparte ni crea enlaces', [mW, mAp, mN, mMv, mSh, mLk].every((r) => r.isError === true), [mW, mAp, mN, mMv, mSh, mLk].map(text));
  check('y nada cambió', (await api('GET', '/notes/plan.md' + O, undefined, B.s)).json.text.includes('tres') && (await api('GET', '/notes/ia.md' + O, undefined, B.s)).status === 404);
  check('en lo propio su IA sigue escribiendo', (await tool(tR, 'write_note', { path: 'mia.md', text: 'x' })).isError !== true);
  check('la IA de quien edita escribe en el espacio', (await tool(tB, 'write_note', { path: '@team/ia.md', text: 'de la IA' })).isError !== true);
  const mShB = await tool(tB, 'share_note', { path: '@team/ia.md', email: Z.email }); const mLkB = await tool(tB, 'create_public_link', { path: '@team/ia.md' });
  check('comparte una nota del equipo si la política lo permite, y no crea un enlace si no', mShB.isError !== true && mLkB.isError === true && /administrator/.test(text(mLkB)), [text(mShB), text(mLkB)]);
  check('el espacio entero no se comparte', (await tool(tB, 'share_note', { path: '@team', email: Z.email })).isError === true);
  await api('PUT', '/team/policies', { tokens: false }, A.s);
  const hid = await tool(tB, 'list_notes', {});
  check('si quien administra no deja conectar la IA al espacio, el token de un miembro deja de verlo', !/@team/.test(text(hid)) && (await tool(tB, 'read_note', { path: '@team/plan.md' })).isError === true, text(hid).slice(0, 200));
  const tA = await tok(A);
  check('el de quien administra lo sigue viendo', /@team\/plan\.md/.test(text(await tool(tA, 'list_notes', {}))));
  await api('PUT', '/team/policies', { tokens: true }, A.s);

  // ---------- Tokens del equipo ----------
  console.log('Tokens del equipo');
  const ttBad = [await api('POST', '/team/tokens', { name: 'x', write: true }, B.s), await api('GET', '/team/tokens', undefined, RD.s), await api('POST', '/team/tokens', { name: 'x' }, Z.s)];
  check('solo quien administra crea y ve los tokens del equipo', ttBad[0].status === 403 && ttBad[1].status === 403 && ttBad[2].status === 404, ttBad.map((r) => r.json));
  check('un token sin nombre no se crea', (await api('POST', '/team/tokens', { name: '  ', write: true }, D.s)).status === 400);
  const full = (await api('POST', '/team/tokens', { name: 'Bot de despliegue', write: true, share: true }, D.s)).json;
  const ro = (await api('POST', '/team/tokens', { name: 'Solo lectura' }, A.s)).json;
  const sc = (await api('POST', '/team/tokens', { name: 'Docs', folder: 'docs', write: true }, A.s)).json;
  check('se crean con nombre, carpeta y permisos, y el token se entrega una sola vez', /^mdt_/.test(full.token) && full.write === true && full.share === true && ro.write === false && ro.share === false && sc.scope === 'docs', [full, ro, sc]);
  const tl = (await api('GET', '/team/tokens', undefined, A.s)).json;
  check('la lista dice quién creó cada uno, y no trae el token', tl.length === 3 && tl.find((x) => x.name === 'Bot de despliegue').by === D.email && !/mdt_/.test(JSON.stringify(tl)), tl);
  check('no se mezclan con los tokens personales de nadie', !(await api('GET', '/tokens', undefined, A.s)).json.some((x) => x.name === 'Docs') && !(await api('GET', '/tokens', undefined, D.s)).json.length);
  const tlist = text(await tool(full.token, 'list_notes', {}));
  check('ve el espacio del equipo como raíz, sin @team/, y nada de ninguna persona', /"plan\.md"/.test(tlist) && !/@team/.test(tlist) && !/mia\.md/.test(tlist), tlist.slice(0, 300));
  check('lee y escribe', text(await tool(full.token, 'read_note', { path: 'plan.md' })).includes('tres') && (await tool(full.token, 'write_note', { path: 'bot/estado.md', text: 'ok' })).isError !== true && (await api('GET', '/notes/' + enc('bot/estado.md') + O, undefined, B.s)).json.text === 'ok');
  check('el de solo lectura lee y no escribe, y no se le ofrecen las herramientas que cambian algo', text(await tool(ro.token, 'read_note', { path: 'plan.md' })).includes('tres') && (await tool(ro.token, 'write_note', { path: 'plan.md', text: 'x' })).isError === true && !(await tools(ro.token)).includes('write_note') && (await tools(ro.token)).includes('read_note'));
  const out1 = await tool(sc.token, 'read_note', { path: 'plan.md' }); const out2 = await tool(sc.token, 'write_note', { path: 'plan.md', text: 'x' }); const in1 = await tool(sc.token, 'write_note', { path: 'docs/guia.md', text: 'guía' });
  check('el limitado a una carpeta no sale de ella', out1.isError === true && /only reaches/.test(text(out1)) && out2.isError === true && in1.isError !== true && !/plan\.md/.test(text(await tool(sc.token, 'list_notes', {}))), [text(out1), text(in1)]);
  const tSh = await tool(full.token, 'share_note', { path: 'bot/estado.md', email: Z.email }); const tLk = await tool(full.token, 'create_public_link', { path: 'bot/estado.md' });
  check('respeta las políticas: comparte porque está permitido, y no crea enlaces porque no', tSh.isError !== true && tLk.isError === true, [text(tSh), text(tLk)]);
  check('con la sesión de una cuenta no sirve, ni para la administración', (await api('GET', '/account', undefined, full.token)).status === 401 && (await api('GET', '/team/tokens', undefined, full.token)).status === 401);
  await api('POST', '/team/remove', { id: D.id }, A.s);
  check('sigue andando cuando quien lo creó ya no está en el equipo', text(await tool(full.token, 'read_note', { path: 'plan.md' })).includes('tres') && (await api('GET', '/team/tokens', undefined, A.s)).json.length === 3);
  check('quien salió ya no administra nada', (await api('GET', '/team/tokens', undefined, D.s)).status === 404 && (await api('GET', '/team/log', undefined, D.s)).status === 404 && (await api('PUT', '/team/policies', { share: false }, D.s)).status === 404);
  const rev = await api('DELETE', '/team/tokens/' + sc.id, undefined, A.s);
  check('revocado, deja de entrar', rev.status === 200 && (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, sc.token)).status === 401);
  check('un miembro no revoca un token del equipo, ni por la ruta de los personales', (await api('DELETE', '/team/tokens/' + full.id, undefined, B.s)).status === 403 && (await api('DELETE', '/tokens/' + full.id, undefined, B.s)).status === 200 && text(await tool(full.token, 'read_note', { path: 'plan.md' })).includes('tres'));

  // ---------- Registro de actividad ----------
  console.log('Registro de actividad');
  for (const [name, w, st] of [['quien edita', B, 403], ['quien solo lee', RD, 403], ['quien no es del equipo', Z, 404]]) check(name + ' no lee el registro', (await log(w)).status === st && (await log(w, 'format=csv')).status === st);
  const all = (await log(A)).json;
  const have = new Set(all.entries.map((e) => e.action));
  const want = ['create', 'edit', 'delete', 'restore', 'share', 'link', 'unlink', 'invite', 'join', 'remove', 'role', 'policy', 'token_create', 'token_revoke', 'ai'];
  check('quedó anotado lo que pasó: ' + want.join(', '), want.every((k) => have.has(k)), want.filter((k) => !have.has(k)));
  const raw = JSON.stringify(all.entries);
  check('sin el texto de ninguna nota', !/uno|dos|tres|de la IA|guía|Título/.test(raw), raw.match(/.{0,40}(uno|dos|tres|de la IA|guía|Título).{0,20}/));
  check('y sin correos de afuera del equipo: ni con quién se compartió ni a quién se invitó', !raw.includes(Z.email) && !raw.includes('nuevo@ejemplo.test') && !raw.includes('x@ejemplo.test'), raw.match(/.{0,60}(zoe|nuevo@|x@).{0,20}/));
  const roleRow = all.entries.find((e) => e.action === 'role'); const rmRow = all.entries.find((e) => e.action === 'remove');
  check('cada fila dice quién, qué, cuándo y sobre qué', roleRow.who === A.email && roleRow.about === RD.email && roleRow.detail === 'reader' && rmRow.about === D.email && all.entries.every((e) => e.at > Date.now() - 600000), [roleRow, rmRow]);
  const viaTeam = all.entries.find((e) => e.via === 'team' && e.action === 'create' && e.token === 'Bot de despliegue'); const viaAi = all.entries.find((e) => e.via === 'ai' && e.action === 'create'); const aiIn = all.entries.filter((e) => e.action === 'ai');
  check('lo que hizo un token del equipo figura con su nombre, y lo de la IA de una persona con la persona y su token', viaTeam && viaTeam.token === 'Bot de despliegue' && viaTeam.who === '' && viaTeam.path === 'bot/estado.md' && viaAi && viaAi.who === B.email && viaAi.token === 'IA de beto' && viaAi.path === 'ia.md', [viaTeam, viaAi]);
  check('la entrada de cada IA al espacio se anota una vez por hora, no en cada pedido', aiIn.length >= 4 && aiIn.filter((e) => e.token === 'Bot de despliegue').length === 1, aiIn.map((e) => e.token));
  const editsB = all.entries.filter((e) => e.action === 'edit' && e.path === 'plan.md' && e.who === B.email && !e.via);
  check('varias ediciones seguidas de una nota son una sola fila', editsB.length === 1, editsB);
  const fWho = (await log(A, 'who=' + B.id)).json.entries; const fAct = (await log(A, 'action=policy')).json.entries; const fTok = (await log(A, 'token=' + enc('Bot de despliegue'))).json.entries;
  check('se filtra por persona, por tipo y por token', fWho.length > 0 && fWho.every((e) => e.who === B.email) && fAct.length > 0 && fAct.every((e) => e.action === 'policy') && fTok.length > 0 && fTok.every((e) => e.token === 'Bot de despliegue'), [fWho.length, fAct.length, fTok.length]);
  const fFuture = (await log(A, 'from=' + (Date.now() + 60000))).json.entries; const fPast = (await log(A, 'to=' + (Date.now() - 3600000))).json.entries; const fNow = (await log(A, 'from=' + (Date.now() - 600000) + '&to=' + (Date.now() + 1000))).json.entries;
  check('y por fechas', fFuture.length === 0 && fPast.length === 0 && fNow.length === all.entries.length, [fFuture.length, fPast.length, fNow.length]);
  check('un filtro que no existe se rechaza', (await log(A, 'action=borrar-todo')).status === 400 && (await log(A, 'from=ayer')).status === 400);
  const page2 = (await log(A, 'before=' + all.entries[all.entries.length - 1].id)).json;
  check('before sigue desde una fila', all.more === false ? page2.entries.length === 0 : page2.entries.length > 0, [all.more, page2.entries.length]);
  const pol = fAct.map((e) => e.detail);
  check('de una política queda cuál cambió y a qué; de la plantilla, solo que cambió', pol.includes('share=on') && pol.includes('links=off') && pol.includes('template') && pol.includes('folder') && pol.includes('tokens=off'), pol);
  // CSV.
  await put(B, '=cmd().md', 'x');
  const csv = (await log(A, 'format=csv')).json.csv; const lines = csv.trim().split('\r\n');
  check('la exportación es un CSV con encabezado y una fila por evento', lines[0] === 'when,who,via,token,action,path,about,detail' && lines.length === (await log(A)).json.entries.length + 1 && /^\d{4}-\d\d-\d\dT/.test(lines[1]), lines.slice(0, 2));
  check('respeta los filtros', (await log(A, 'format=csv&action=role')).json.csv.trim().split('\r\n').slice(1).every((l) => /,role,/.test(l)));
  check('una ruta que empieza como una fórmula sale neutralizada', csv.includes(",'=cmd().md,") && !/,=cmd/.test(csv), lines.find((l) => l.includes('cmd')));
  check('y tampoco trae texto de notas ni correos de afuera', !/uno|tres|guía/.test(csv) && !csv.includes(Z.email));
  // Retención: lo viejo no se entrega.
  { const db = new DatabaseSync(path.join(DATA, 'mdtools.db')); db.prepare("UPDATE team_log SET at = ? WHERE action = 'invite'").run(Date.now() - 91 * 86400000); db.close(); }
  check('lo que pasó hace más de 90 días ya no figura', !(await acts(A)).includes('invite') && !/,invite,/.test((await log(A, 'format=csv')).json.csv));

  // ---------- Historial ----------
  console.log('Historial');
  const vers = async () => (await api('GET', '/versions/plan.md' + O, undefined, A.s)).json;
  const before = await vers();
  { const db = new DatabaseSync(path.join(DATA, 'mdtools.db'));
    const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(before[0].id);
    for (const days of [40, 100, 200, 400]) db.prepare('INSERT INTO versions (user, path, text, saved, size, e, aad) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.user, row.path, row.text, Date.now() - days * 86400000, row.size, row.e, row.aad);
    db.close(); }
  check('el equipo informa cuánto dura su historial y a cuánto se puede acortar', (await mine(A)).history_days === 365 && (await mine(A)).history_max === 365 && (await mine(A)).history_choices.join() === '30,90,180,365');
  const h180 = await api('PUT', '/team/policies', { history_days: 180 }, A.s); const after180 = await vers();
  check('en el espacio el historial dura un año; al acortarlo a 180 días se va lo anterior y queda el resto', h180.status === 200 && h180.json.team.mine.history_days === 180 && after180.length === before.length + 2, [before.length, after180.length]);
  await api('PUT', '/team/policies', { history_days: 30 }, A.s);
  check('a 30 días queda solo lo reciente', (await vers()).length === before.length);
  check('volver al máximo no trae de vuelta lo borrado', (await api('PUT', '/team/policies', { history_days: 365 }, A.s)).json.policies.history_days === 0 && (await vers()).length === before.length);

  // ---------- Protección del espacio ----------
  console.log('Espacio protegido');
  const b64 = (n) => randomBytes(n).toString('base64');
  const prot = await api('POST', '/team/vault', { salt: b64(16), iters: 100000, wrapped: b64(60), check: b64(32) }, A.s);
  const lockedT = await tool(full.token, 'read_note', { path: 'plan.md' }); const lockedW = await tool(full.token, 'write_note', { path: 'plan.md', text: 'x' }); const lockedS = text(await tool(full.token, 'search_notes', { query: 'plan' }));
  check('un token del equipo no abre un espacio protegido: ni lee, ni escribe, ni busca adentro', prot.status === 200 && lockedT.isError === true && /protected with a password/.test(text(lockedT)) && lockedW.isError === true && /locked_folders/.test(lockedS), [prot.json, text(lockedT), lockedS.slice(0, 200)]);
  const afterProt = (await api('GET', '/team/policies', undefined, A.s)).json.policies;
  check('al proteger, la plantilla se borra (el servidor la guardaba legible) y no se acepta otra', afterProt.template === '' && (await api('PUT', '/team/policies', { template: '# x' }, A.s)).status === 409, afterProt);
  check('lo compartido hacia afuera se corta', (await api('GET', '/shared', undefined, Z.s)).json.length === 0 && (await api('POST', '/shares', { path: 'plan.md', email: Z.email, o: SPACE }, A.s)).status === 409);
  const logP = (await log(A)).json.entries;
  check('proteger queda en el registro, y las rutas de las notas siguen a la vista', logP.some((e) => e.action === 'protect' && e.who === A.email) && logP.some((e) => e.path === 'plan.md'));

  // ---------- Quien se va ----------
  console.log('Ex miembro');
  await api('POST', '/team/remove', { id: B.id }, A.s);
  const ex = [await api('GET', '/notes' + O, undefined, B.s), await api('GET', '/notes/plan.md' + O, undefined, B.s), await put(B, 'plan.md', 'x'), await api('GET', '/team/policies', undefined, B.s), await api('GET', '/shares' + O, undefined, B.s), await api('POST', '/links', { path: 'plan.md', o: SPACE }, B.s)];
  check('un ex miembro no llega a nada del espacio', ex[0].json.length === 0 && ex[1].status === 403 && ex[2].status === 403 && ex[3].status === 404 && ex[4].status === 403 && ex[5].status === 403, ex.map((r) => r.status));
  const exAi = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_note', arguments: { path: '@team/plan.md' } } }, tB);
  check('su IA tampoco: sigue conectada a su cuenta, pero del espacio no lee nada', exAi.json.result.isError === true && /not_found|no_access|no_team/.test(JSON.stringify(exAi.json)) && !/tres|vault1/.test(JSON.stringify(exAi.json)), exAi.json);
  check('y vuelve a ver lo de cobro de su propia cuenta', (await acct(B)).billing === true && /plan=monthly/.test((await acct(B)).checkout.monthly));
  const logEnd = (await log(A)).json.entries;
  check('en el registro sigue figurando lo que hizo', logEnd.some((e) => e.who === B.email && e.action === 'create'));
  await api('DELETE', '/account', { email: B.email }, B.s);
  const logGone = (await log(A)).json.entries;
  check('si elimina su cuenta, sus filas quedan sin nombre', !JSON.stringify(logGone).includes(B.email) && logGone.some((e) => e.action === 'create' && e.who === '' && !e.via), logGone.filter((e) => e.action === 'create'));

  // ---------- Migración ----------
  console.log('Migración');
  await R.stop();
  { const db = new DatabaseSync(path.join(DATA, 'mdtools.db'));
    // Una base de antes: sin papeles ni políticas. SQLite no saca columnas con DEFAULT de una tabla sin rehacerla.
    db.exec('CREATE TABLE tm2 (team INTEGER NOT NULL, user INTEGER PRIMARY KEY, joined INTEGER NOT NULL); INSERT INTO tm2 SELECT team, user, joined FROM team_members; DROP TABLE team_members; ALTER TABLE tm2 RENAME TO team_members');
    db.exec('ALTER TABLE teams DROP COLUMN policies');
    db.close(); }
  await R.start();
  const mig = await mine(A);
  check('con una base de antes, quien paga queda como administrador y los demás como editores', mig.role === 'admin' && mig.owner === true && mig.members.filter((m) => !m.owner).every((m) => m.role === 'editor') && mig.members.length === 2, mig.members);
  check('y las políticas vuelven a las de fábrica', mig.policies.share === false && mig.policies.tokens === true && mig.history_days === 365, mig.policies);
  check('los tokens del equipo siguen entrando después de reiniciar', (await tools(full.token)).includes('list_notes'));

  // ---------- En la app ----------
  console.log('En la app');
  const U = await R.signup('olga@ejemplo.test'); const P = await R.signup('pedro@ejemplo.test'); const L = await R.signup('lucia@ejemplo.test');
  await adminTeam(U.email, 5);
  await api('POST', '/team/invite', { email: P.email }, U.s); await api('POST', '/team/invite', { email: L.email, role: 'reader' }, U.s);
  for (const w of [P, L]) await api('POST', '/team/accept', { id: (await acct(w)).team.invites[0].id }, w.s);
  await api('PUT', '/team', { name: 'Taller' }, U.s);
  const SP = (await mine(U)).space; const OS = '?o=' + SP;
  await api('PUT', '/notes/' + enc('plan.md') + OS, { text: '# Plan\n\nPrimer párrafo.\n' }, U.s);
  const tUrl = (p, edit) => R.noteUrl('~' + SP + '/' + p, edit);
  const natives = [];
  const watch = (c) => { c.page.on('dialog', (d) => { natives.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); }); return c; };
  const openPlan = async (page) => { await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=plan]'); await page.waitForSelector('.lmd-panel .lmd-team [data-team=members]'); await page.waitForTimeout(300); };
  const closePanel = (page) => page.click('[data-act=close-panel]');
  const said = (page, text) => page.waitForFunction((t) => { const m = document.querySelector('.lmd-team-msg'); return !!m && !m.hidden && m.textContent === t; }, text, { timeout: 10000 });
  const pols = async () => (await api('GET', '/team/policies', undefined, U.s)).json.policies;

  const olga = watch(await R.open(U));
  await olga.page.goto(tUrl('plan.md')); await olga.page.waitForSelector('[data-root=team] .lmd-node');
  await openPlan(olga.page);
  const adminView = await olga.page.evaluate(() => { const t = document.querySelector('.lmd-panel .lmd-team'); return { text: t.innerText, roles: [...t.querySelectorAll('[data-team=members] select[data-t=role]')].map((s) => s.value), invRole: !!t.querySelector('select[data-t=invite-role]'), heads: [...t.querySelectorAll('h4')].map((h) => h.textContent.trim()), locked: !!t.querySelector('.lmd-managed'), enabled: [...t.querySelectorAll('[data-team=policies] input, [data-team=policies] select')].every((i) => !i.disabled) }; });
  check('quien administra ve a cada miembro con su papel y lo puede cambiar, menos el propio', /olga@ejemplo\.test · Administrator/.test(adminView.text) && /pedro@ejemplo\.test · Editor/.test(adminView.text) && /lucia@ejemplo\.test · Reader/.test(adminView.text) && adminView.roles.join() === 'editor,reader' && adminView.invRole, adminView);
  check('Plan tiene las secciones del equipo: ajustes, protección, tokens y registro', ['Team settings', 'Space protection', 'Team tokens', 'Activity log'].every((h) => adminView.heads.includes(h)) && adminView.enabled && !adminView.locked, adminView.heads);
  check('y dice que quien solo lee ocupa un lugar', /A reader takes a seat too\./.test(adminView.text));
  check('sin PAGES_TEAM_DOMAIN en el servidor, Plan no ofrece el subdominio del equipo', !adminView.heads.includes('Team subdomain') && !(await olga.page.$('.lmd-team [data-t=sub-name], .lmd-team [data-t=sub-save], .lmd-team [data-team=subdomain]')), adminView.heads);
  // Cada cambio vuelve a dibujar la gestión: se espera su aviso, borrando antes el del cambio anterior.
  const does = async (page, fn, text) => { await page.evaluate(() => { const m = document.querySelector('.lmd-team-msg'); if (m) { m.hidden = true; m.textContent = ''; } }); await fn(); await said(page, text); };
  await does(olga.page, () => olga.page.selectOption('.lmd-team select[data-t=role][data-id="' + P.id + '"]', 'reader'), 'Role changed.');
  check('cambiar el papel desde la lista lo cambia en el servidor', (await mine(P)).role === 'reader');
  await does(olga.page, () => olga.page.selectOption('.lmd-team select[data-t=role][data-id="' + P.id + '"]', 'editor'), 'Role changed.');
  await olga.page.fill('.lmd-team [data-t=email]', 'nueva@ejemplo.test'); await olga.page.selectOption('.lmd-team select[data-t=invite-role]', 'reader');
  await does(olga.page, () => olga.page.click('.lmd-team [data-t=invite]'), 'Invitation sent.');
  check('al invitar se elige el papel, y la invitación pendiente lo muestra', /nueva@ejemplo\.test · Reader/.test(await olga.page.innerText('.lmd-team [data-team=pending]')) && (await mine(U)).pending[0].role === 'reader');
  await does(olga.page, () => olga.page.check('.lmd-team [data-p=share]'), 'Setting saved.');
  await does(olga.page, () => olga.page.selectOption('.lmd-team [data-p=history_days]', '90'), 'Setting saved.');
  await does(olga.page, async () => { await olga.page.fill('.lmd-team [data-p=folder]', 'notas'); await olga.page.press('.lmd-team [data-p=folder]', 'Enter'); }, 'Setting saved.');
  await olga.page.click('.lmd-team [data-t=template]'); await olga.page.waitForSelector('.lmd-team-tpl-ask textarea');
  await olga.page.fill('.lmd-team-tpl-ask textarea', '# Título\n\n## Contexto\n');
  await does(olga.page, () => olga.page.click('.lmd-team-tpl-ask [data-d=ok]'), 'Setting saved.');
  const p1 = await pols();
  check('los ajustes del equipo se guardan desde Plan: compartir, historial, carpeta y plantilla de las notas nuevas', p1.share === true && p1.links === false && p1.history_days === 90 && p1.folder === 'notas' && p1.template === '# Título\n\n## Contexto\n', p1);
  check('y la plantilla figura como puesta', /Template for new notes\s+Set/.test(await olga.page.innerText('.lmd-team [data-team=policies]')));
  // Tokens del equipo.
  // Las opciones del token (nombre, carpeta, permisos) aparecen recién al pedir uno, en el lugar del botón.
  const tokIdle = await olga.page.evaluate(() => document.querySelectorAll('.lmd-team .lmd-tokform, .lmd-team [data-t=tok-name], .lmd-team [data-t=tok-folder], .lmd-team [data-t=tok-write], .lmd-team [data-t=tok-share]').length);
  await olga.page.click('.lmd-team [data-t=tok-open]'); await olga.page.waitForSelector('.lmd-team .lmd-tokform [data-t=tok-name]');
  const tokForm = await olga.page.evaluate(() => { const f = document.querySelector('.lmd-team .lmd-tokform'); return { focus: document.activeElement === f.querySelector('[data-t=tok-name]'), write: f.querySelector('[data-t=tok-write]').checked, share: f.querySelector('[data-t=tok-share]').checked, buttons: [...f.querySelectorAll('button')].map((b) => b.textContent) }; });
  await olga.page.click('.lmd-team [data-t=tok-new]'); await olga.page.waitForSelector('.lmd-team .lmd-tokform-err:not([hidden])');
  const tokNoName = await olga.page.evaluate(() => ({ why: document.querySelector('.lmd-team .lmd-tokform-err').textContent, rows: document.querySelector('.lmd-team [data-team=tokens]').innerText }));
  check('el token del equipo pide sus opciones recién al crearlo: antes no hay ninguna a la vista, y sin nombre no se crea', tokIdle === 0 && tokForm.focus && tokForm.write && !tokForm.share && tokForm.buttons.join() === 'Cancel,Create' && tokNoName.why === 'Type a name.' && !/Bot del taller/.test(tokNoName.rows), [tokIdle, tokForm, tokNoName]);
  await olga.page.fill('.lmd-team [data-t=tok-name]', 'Bot del taller'); await olga.page.click('.lmd-team [data-t=tok-new]');
  await olga.page.waitForSelector('.lmd-team .lmd-ai-new'); await olga.page.waitForFunction(() => /Bot del taller/.test(document.querySelector('.lmd-team [data-team=tokens]').innerText));
  const tokUi = await olga.page.evaluate(() => { const t = document.querySelector('.lmd-team'); return { token: [...t.querySelectorAll('.lmd-field')].find((f) => f.querySelector('span').textContent === 'Token').querySelector('input').value, row: t.querySelector('[data-team=tokens]').innerText }; });
  check('un token del equipo se crea desde Plan, se muestra una vez y queda en la lista con lo que puede', /^mdt_/.test(tokUi.token) && /Bot del taller · All team notes\s+reads and writes · never used/.test(tokUi.row), tokUi);
  check('y entra al espacio del equipo', /"plan\.md"/.test(text(await tool(tokUi.token, 'list_notes', {}))));
  // Regenerar: el mismo token del equipo con un secreto nuevo, que queda a la vista.
  await olga.page.click('.lmd-team [data-t=tok-regen]'); await olga.page.waitForSelector('.lmd-dlg');
  const reAsk = await olga.page.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent, ok: document.querySelector('.lmd-dlg [data-dlg=ok]').textContent }));
  await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForFunction((old) => { const f = [...document.querySelectorAll('.lmd-team .lmd-field')].find((x) => x.querySelector('span').textContent === 'Token'); return f && f.querySelector('input').value !== old; }, tokUi.token);
  await olga.page.waitForFunction(() => /Bot del taller/.test(document.querySelector('.lmd-team [data-team=tokens]').innerText));
  const reUi = await olga.page.evaluate(() => { const t = document.querySelector('.lmd-team'); return { token: [...t.querySelectorAll('.lmd-field')].find((f) => f.querySelector('span').textContent === 'Token').querySelector('input').value, row: t.querySelector('[data-team=tokens]').innerText, rows: t.querySelectorAll('[data-team=tokens] li').length }; });
  const reLog = (await api('GET', '/team/log?action=token_regenerate', undefined, U.s)).json;
  check('regenerar un token del equipo pide confirmar, deja el mismo token con un secreto nuevo, y queda en el registro', reAsk.title === 'Regenerate the token "Bot del taller"?' && reAsk.text === 'Connections using this token stop working. You will have to paste the new token wherever you use it.' && reAsk.ok === 'Regenerate' && /^mdt_/.test(reUi.token) && reUi.token !== tokUi.token && reUi.rows === 1 && /Bot del taller · All team notes\s+reads and writes · never used/.test(reUi.row) && (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokUi.token)).status === 401 && /"plan\.md"/.test(text(await tool(reUi.token, 'list_notes', {}))) && reLog.entries.length === 1 && reLog.entries[0].detail === 'Bot del taller', [reAsk, reUi, reLog]);
  tokUi.token = reUi.token;
  await olga.page.click('.lmd-team [data-t=tok-rm]'); await olga.page.waitForSelector('.lmd-dlg'); await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForFunction(() => /No tokens yet\./.test(document.querySelector('.lmd-team [data-team=tokens]').innerText));
  check('revocarlo pide confirmar con un diálogo propio, y deja de entrar', (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokUi.token)).status === 401 && !(await olga.page.$('.lmd-team .lmd-ai-new')));
  // Registro de actividad.
  await olga.page.click('.lmd-team [data-t=log]'); await olga.page.waitForSelector('.lmd-tlog [data-l=list] li time');
  const logUi = await olga.page.evaluate(() => ({ rows: [...document.querySelectorAll('.lmd-tlog [data-l=list] li')].map((li) => li.innerText.replace(/\n+/g, ' | ')), hint: document.querySelector('.lmd-tlog p.lmd-hint').textContent, people: [...document.querySelectorAll('.lmd-tlog [data-l=who] option')].map((o) => o.textContent) }));
  check('el registro muestra quién hizo qué, con palabras', logUi.rows.some((r) => /olga@ejemplo\.test \| Changed a setting \| Share: yes/.test(r)) && logUi.rows.some((r) => /Changed a role \| Reader · pedro@ejemplo\.test/.test(r)) && logUi.rows.some((r) => /Team token · Bot del taller \| An AI connected/.test(r)) && logUi.rows.some((r) => /Created \| plan\.md/.test(r)) && logUi.rows.some((r) => /Version history: 90 days/.test(r)), logUi.rows);
  check('dice qué guarda y por cuánto tiempo', /It does not keep the content of the notes\. Entries are deleted after 90 days\./.test(logUi.hint) && logUi.people.includes('pedro@ejemplo.test'), logUi.hint);
  await olga.page.selectOption('.lmd-tlog [data-l=action]', 'role'); await olga.page.waitForFunction(() => { const li = [...document.querySelectorAll('.lmd-tlog [data-l=list] li')]; return li.length > 0 && li.every((x) => /Changed a role/.test(x.innerText)); });
  check('filtra por tipo', (await olga.page.$$('.lmd-tlog [data-l=list] li')).length === 2);
  await olga.page.selectOption('.lmd-tlog [data-l=who]', String(L.id)); await olga.page.waitForSelector('.lmd-tlog .lmd-tlog-none');
  check('y por persona, y dice cuando no hay nada', /No activity matches those filters\./.test(await olga.page.innerText('.lmd-tlog [data-l=list]')));
  await olga.page.selectOption('.lmd-tlog [data-l=who]', '');
  const [dl] = await Promise.all([olga.page.waitForEvent('download'), olga.page.click('.lmd-tlog [data-l=csv]')]);
  const csvFile = fs.readFileSync(await dl.path(), 'utf8');
  check('exporta un CSV con los filtros puestos', dl.suggestedFilename() === 'sharpmd-team-activity.csv' && csvFile.replace(/^﻿/, '').startsWith('when,who,via,token,action,path,about,detail\r\n') && csvFile.trim().split('\r\n').length === 3 && /,role,/.test(csvFile), csvFile.slice(0, 300));
  const logBox = await olga.page.evaluate(() => { const c = document.querySelector('.lmd-tlog').getBoundingClientRect(); return c.right <= innerWidth && c.bottom <= innerHeight; });
  await olga.page.click('.lmd-tlog [data-l=close]');
  check('la ventana del registro entra en la pantalla y se cierra', logBox && !(await olga.page.$('.lmd-tlog')));
  const adminAll = await olga.page.innerText('.lmd-panel [data-acct=plan]');
  check('los textos nuevos no llevan signos de admiración ni rayas largas', !/[!¡—–]/.test(adminAll), adminAll.match(/.{0,30}[!¡—–].{0,30}/));
  // Lo personal y lo de cada nota, dicho en Ajustes.
  await olga.page.click('[data-ptab=look]'); const lookHint = await olga.page.innerText('.lmd-panel section[data-tab=look] .lmd-scope');
  await olga.page.click('[data-ptab=read]'); const readHint = await olga.page.innerText('.lmd-panel section[data-tab=read] .lmd-scope');
  check('Ajustes dice qué es personal, dónde está lo del equipo y que lo de una nota va en su menú', lookHint === 'These settings are yours. Nobody else sees or changes them.' && /The width and other options of a single note are changed from the menu of that note\./.test(readHint) && /What applies to the whole team is in Plan, under Team settings\./.test(readHint), [lookHint, readHint]);
  await closePanel(olga.page);

  // Quien edita: comparte porque la política lo permite, y no crea enlaces porque no.
  const pedro = watch(await R.open(P));
  await pedro.page.goto(tUrl('plan.md')); await pedro.page.waitForSelector('[data-root=team] .lmd-node');
  await pedro.page.click('.lmd-sync'); await pedro.page.waitForSelector('.lmd-menu [data-s]');
  const pMenu = await pedro.page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-s]')].map((b) => b.dataset.s + (b.classList.contains('lmd-locked') ? ':locked' : '')));
  await pedro.page.click('.lmd-menu [data-s=share]'); await pedro.page.waitForSelector('.lmd-share');
  const shareUi = await pedro.page.evaluate(() => { const s = document.querySelector('.lmd-share'); return { people: !!s.querySelector('[data-sh=invite]'), link: !!s.querySelector('[data-sh=link]'), text: s.innerText }; });
  check('a quien edita se le ofrece compartir una nota del equipo, solo la mitad que el equipo permite', pMenu.includes('share') && shareUi.people && !shareUi.link && /This note belongs to the team/.test(shareUi.text) && /Managed by your team administrator/.test(shareUi.text), [pMenu, shareUi]);
  await pedro.page.fill('.lmd-share [data-sh=email]', Z.email); await pedro.page.click('.lmd-share [data-sh=invite]');
  await pedro.page.waitForFunction((m) => document.querySelector('.lmd-share [data-sh=people]').innerText.includes(m), Z.email);
  check('y la comparte con una cuenta de afuera', (await api('GET', '/shared', undefined, Z.s)).json.some((n) => n.owner === SP && n.path === 'plan.md' && n.by === 'Taller'));
  await pedro.page.click('.lmd-share [data-rm]'); await pedro.page.waitForFunction(() => !document.querySelector('.lmd-share [data-sh=people] li'));
  check('y deja de compartirla', !(await api('GET', '/shared', undefined, Z.s)).json.length);
  await pedro.page.click('.lmd-share [data-sh=close]');
  // Una nota nueva del equipo nace en la carpeta y con la plantilla que eligió quien administra.
  await pedro.page.click('[data-root=team] .lmd-tree-new'); await pedro.page.waitForSelector('.lmd-menu [data-f=new]'); await pedro.page.click('.lmd-menu [data-f=new]');
  await pedro.page.waitForSelector('.lmd-dlg input'); await pedro.page.fill('.lmd-dlg input', 'idea'); await pedro.page.click('.lmd-dlg [data-dlg=ok]');
  await pedro.page.waitForFunction(() => /Contexto/.test((document.querySelector('.lmd-article') || {}).innerText || ''), null, { timeout: 15000 });
  const born = await api('GET', '/notes/' + enc('notas/idea.md') + OS, undefined, U.s);
  check('una nota nueva del equipo nace en la carpeta y con la plantilla del equipo', born.status === 200 && born.json.text === '# Título\n\n## Contexto\n', born.json);
  await openPlan(pedro.page);
  const edView = await pedro.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); const t = b.querySelector('.lmd-team'); return { all: b.innerText, role: t.querySelector('[data-team=role]').innerText, managed: !!t.querySelector('[data-team=policies] .lmd-managed'), off: [...t.querySelectorAll('[data-team=policies] input, [data-team=policies] select')].every((i) => i.disabled), on: t.querySelector('[data-p=share]').checked, admin: !!t.querySelector('[data-t=log], [data-t=tok-new], [data-t=invite], [data-t=template], select[data-t=role], [data-t=name]'), cols: b.querySelectorAll('.lmd-plan').length, pay: !!b.querySelector('[data-pay], .lmd-plan-buy, .lmd-team-seats') }; });
  check('quien edita ve su equipo, su papel y los ajustes del equipo bloqueados, con lo que decidió quien administra', /Your role\s+Editor/.test(edView.role) && edView.managed && edView.off && edView.on && !edView.admin, edView);
  check('y nada de cobro: ni planes, ni precios, ni lugares, ni botones de compra', edView.cols === 1 && !edView.pay && !/USD|\$|\/ month|Seats|seats|Subscribe|subscription/i.test(edView.all), edView.all);
  await closePanel(pedro.page);
  await pedro.ctx.close();

  // Quien solo lee: lee, y la app no le ofrece cambiar nada en el espacio. Plan, después, en el ancho de un teléfono.
  const lucia = watch(await R.open(L));
  const puts = []; lucia.page.on('response', (r) => { if (/^(PUT|DELETE|POST)$/.test(r.request().method()) && /\/(notes|rename|trash|shares|links)\b/.test(new URL(r.url()).pathname)) puts.push(r.request().method() + ' ' + r.status()); });
  await lucia.page.goto(tUrl('plan.md', true)); await lucia.page.waitForFunction(() => /Primer párrafo/.test((document.querySelector('.lmd-article') || {}).innerText || ''), null, { timeout: 15000 });
  await lucia.page.waitForSelector('[data-root=team] .lmd-node');
  const roUi = await lucia.page.evaluate(() => ({ readonly: document.documentElement.classList.contains('lmd-readonly'), editable: !!document.querySelector('.lmd-article .lmd-editable'), root: !!document.querySelector('[data-root=team]'), plus: !!document.querySelector('[data-root=team] .lmd-tree-new'), cloudPlus: !!document.querySelector('[data-root=cloud] .lmd-tree-new') }));
  check('quien solo lee abre la nota del equipo en solo lectura, aunque pida editar', roUi.readonly && !roUi.editable, roUi);
  check('el explorador le muestra el espacio sin el botón de crear ahí, y sí en su nube', roUi.root && !roUi.plus && roUi.cloudPlus, roUi);
  await lucia.page.evaluate(() => document.querySelector('.lmd-sync').click()); await lucia.page.waitForSelector('.lmd-menu [data-s]');
  const lMenu = await lucia.page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-s]')].map((b) => b.dataset.s));
  const lLabel = await lucia.page.evaluate(() => document.querySelector('.lmd-menu .lmd-menu-label').textContent);
  check('el menú de la nota no le ofrece compartir ni la sesión en vivo, y dice su equipo y su papel en vez de un plan', !lMenu.includes('share') && !lMenu.includes('live') && lMenu.includes('history') && lLabel === 'lucia@ejemplo.test · Taller · Reader', [lMenu, lLabel]);
  await lucia.page.keyboard.press('Escape'); await lucia.page.evaluate(() => { const m = document.querySelector('.lmd-menu'); if (m) m.remove(); });
  await lucia.page.evaluate(() => { const n = document.querySelector('[data-root=team] .lmd-node'); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 })); }); await sleep(300);
  check('en una nota del equipo no hay menú para renombrar ni eliminar', !(await lucia.page.$('.lmd-menu [data-f]')));
  await api('PUT', '/notes/' + enc('borrada.md') + OS, { text: 'x' }, U.s); await api('DELETE', '/notes/' + enc('borrada.md') + OS, undefined, U.s);
  await lucia.page.evaluate((s) => document.querySelector('[data-trash="' + s + '"]').click(), String(SP)); await lucia.page.waitForSelector('.lmd-trash li');
  const trashUi = await lucia.page.evaluate(() => { const t = document.querySelector('.lmd-trash'); return { rows: t.querySelectorAll('li').length, acts: t.querySelectorAll('[data-tr=back], [data-tr=del], [data-tr=empty]').length }; });
  check('ve la papelera del equipo sin restaurar, eliminar ni vaciar', trashUi.rows === 1 && trashUi.acts === 0, trashUi);
  await lucia.page.click('.lmd-trash [data-tr=no]');
  check('y la app no mandó ningún cambio al espacio', puts.length === 0, puts);
  await lucia.page.setViewportSize({ width: 390, height: 780 });
  await openPlan(lucia.page);
  const rdView = await lucia.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); const body = document.querySelector('.lmd-panel-body'); const out = [...b.querySelectorAll('button, input, select, a')].filter((n) => n.offsetParent).filter((n) => { const r = n.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + 0.5; }).length; return { all: b.innerText, sideways: body.scrollWidth - body.clientWidth, out, pay: !!b.querySelector('[data-pay], .lmd-plan-buy, .lmd-team-seats'), leave: !!b.querySelector('[data-t=leave]') }; });
  check('en Plan ve su equipo y su papel, con cómo pedir más, y puede salir', /Taller/.test(rdView.all) && /Your role\s+Reader/.test(rdView.all) && /To edit them, ask an administrator to change your role\./.test(rdView.all) && rdView.leave, rdView.all);
  check('sin nada de cobro, y entra en el ancho del teléfono', !rdView.pay && !/USD|\$|\/ month|Seats|Subscribe|subscription/i.test(rdView.all) && rdView.sideways <= 0 && rdView.out === 0, rdView);
  await closePanel(lucia.page);
  await lucia.ctx.close();

  // Quien administra, en un teléfono: la gestión y el registro entran en el ancho.
  const phone = watch(await R.open(U, { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await phone.page.goto(tUrl('plan.md')); await phone.page.waitForSelector('[data-root=team] .lmd-node', { state: 'attached' });
  await openPlan(phone.page);
  const phAdmin = await phone.page.evaluate(() => { const b = document.querySelector('.lmd-panel [data-acct=plan]'); const body = document.querySelector('.lmd-panel-body'); const ctl = [...b.querySelectorAll('.lmd-team button, .lmd-team input:not([type=checkbox]), .lmd-team select')].filter((n) => n.offsetParent); return { sideways: body.scrollWidth - body.clientWidth, out: ctl.filter((n) => { const r = n.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + 0.5; }).map((n) => n.dataset.t || n.dataset.p), low: ctl.filter((n) => n.getBoundingClientRect().height < 36).map((n) => n.dataset.t || n.dataset.p || n.textContent) }; });
  check('en un teléfono la gestión del equipo no se desborda y sus controles se pueden tocar', phAdmin.sideways <= 0 && !phAdmin.out.length && !phAdmin.low.length, phAdmin);
  await phone.page.click('.lmd-team [data-t=log]'); await phone.page.waitForSelector('.lmd-tlog [data-l=list] li time');
  const phLog = await phone.page.evaluate(() => { const c = document.querySelector('.lmd-tlog'); const r = c.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, wide: [...c.querySelectorAll('select, input, button, li')].filter((n) => n.getBoundingClientRect().right > innerWidth + 0.5).length }; });
  check('y el registro también', phLog.fits && phLog.wide === 0, phLog);
  await phone.page.click('.lmd-tlog [data-l=close]');
  await phone.ctx.close(); await olga.ctx.close();
  check('nunca se usó alert, confirm ni prompt del navegador', !natives.length, natives);
  check('sin errores de página', !R.errors.length, R.errors);
  check('ningún pedido salió a producción', !R.outside.length, R.outside);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }
await R.close();
fakeMail.close();
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ }
process.exit(done() ? 1 : 0);
