// El espacio de un equipo protegido con contraseña: una sola contraseña, que pone quien administra, cifra en el
// navegador todas las notas del equipo. Primero contra el servidor (qué guarda, qué deja pasar a cada papel, el MCP,
// la salida de un miembro y la rotación de la llave), con el mismo cifrado de la app (src/seal.js tal cual). Después
// en la app, con quien administra y un miembro a la vez, y en pantalla chica. Todo local; nada toca producción.
import { randomBytes } from 'crypto';
import { rig, tally, sleep, typeIn, leave } from './rig.mjs';
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.LMD = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', 'seal.js'), 'utf8'));
const Z = globalThis.LMD.seal;

const mails = [];
const fakeMail = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { mails.push(JSON.parse(raw)); res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => fakeMail.listen(0, '127.0.0.1', r));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtv-'));
const R = await rig({ MAIL_WEBHOOK: 'http://127.0.0.1:' + fakeMail.address().port, AUTH_PER_IP: '300', DATA_DIR: DATA, DATA_KEY: randomBytes(32).toString('base64'), VAULT_MINUTE_MS: '100', APP_URL: 'https://app.ejemplo.test/' });
const { check, done } = tally();
const enc = encodeURIComponent;
const onDisk = (what) => fs.readdirSync(DATA).some((f) => fs.statSync(path.join(DATA, f)).isFile() && fs.readFileSync(path.join(DATA, f)).includes(Buffer.from(what)));

try {
  const { api } = R;
  const acct = async (who) => (await api('GET', '/account', undefined, who.s)).json;
  const team = async (owner, seats) => { await api('POST', '/admin/team', { email: owner.email, seats }, undefined, { 'x-admin-key': R.ADMIN }); return (await acct(owner)).team.mine; };
  const join = async (owner, who) => { await api('POST', '/team/invite', { email: who.email }, owner.s); const inv = (await acct(who)).team.invites.find((i) => i.by === owner.email); return api('POST', '/team/accept', { id: inv.id }, who.s); };
  const deny = async (p) => { const r = await p; return r.status + ':' + (r.json && r.json.error); };
  const listen = async (who, p, o) => {
    const ctrl = new AbortController(); const st = { text: '', stop: () => ctrl.abort() };
    const res = await fetch(R.base + '/events?path=' + enc(p) + '&o=' + o, { headers: { authorization: 'Bearer ' + who.s }, signal: ctrl.signal });
    if (res.ok) (async () => { const rd = res.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; st.text += d.decode(x.value); } } catch (e) { /* se cortó */ } })();
    return st;
  };
  const tool = async (tok, name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; let v = c.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!c.isError, raw: c.content[0].text }; };

  // ====================================================================================================
  console.log('Espacio del equipo protegido (servidor)');
  const A = await R.signup('ana@ejemplo.test'); const B = await R.signup('beto@ejemplo.test'); const C = await R.signup('caro@ejemplo.test'); const X = await R.signup('extra@ejemplo.test');
  const T = await team(A, 4); const SP = T.space;
  await join(A, B); await join(A, C);
  const tn = (p) => '/notes/' + enc(p) + '?o=' + SP;
  const aad = (p) => '~' + SP + '/' + p; // el dato asociado: la ruta como la nombra la app
  const raw = async (p, who) => (await api('GET', tn(p), undefined, (who || A).s)).json;
  await api('PUT', tn('plan.md'), { text: '# Plan\n\nPrimera versión, zanahoria-0.\n' }, A.s);
  await api('PUT', tn('plan.md'), { text: '# Plan\n\nEl secreto del equipo es zanahoria-9.\n' }, B.s);
  await api('PUT', tn('docs/guia.md'), { text: '# Guía\n\nzanahoria-guia\n' }, C.s);
  await api('PUT', tn('vieja.md'), { text: 'zanahoria-papelera' }, A.s); await api('DELETE', tn('vieja.md'), undefined, A.s);
  const count = async (what) => (await api('GET', what + (what.includes('?') ? '&' : '?') + 'o=' + SP, undefined, A.s)).json.length;
  check('antes de proteger: el equipo no tiene protección y sus notas tienen historial y papelera', (await acct(A)).team.mine.vault === null && (await api('GET', '/team/vault', undefined, B.s)).json.vault === null && (await count('/versions/' + enc('plan.md'))) === 1 && (await count('/trash')) === 1);

  const PASS = 'caballo correcto batería grapa'; const K = Z.newKey(); const made = await Z.derive(K); const wrapped = await Z.wrap(K, PASS);
  const body = { ...wrapped, check: made.check };
  check('proteger: un miembro no puede, ni alguien de afuera, ni sin sesión', (await deny(api('POST', '/team/vault', body, B.s))) === '403:not_admin' && (await deny(api('POST', '/team/vault', body, X.s))) === '404:no_team' && (await api('POST', '/team/vault', body)).status === 401);
  check('proteger: rechaza datos mal formados y pocas vueltas', (await deny(api('POST', '/team/vault', { ...body, salt: 'corta' }, A.s))) === '400:bad_vault' && (await deny(api('POST', '/team/vault', { ...body, iters: 1000 }, A.s))) === '400:bad_vault' && (await deny(api('POST', '/team/vault', { ...wrapped }, A.s))) === '400:bad_vault');
  check('un texto cifrado no entra a un espacio sin proteger', (await deny(api('PUT', tn('plan.md'), { text: await Z.seal(made.key, aad('plan.md'), 'x') }, A.s))) === '409:vault_text');
  const ears = await listen(B, 'plan.md', SP);
  const created = await api('POST', '/team/vault', body, A.s);
  const V = created.json.vault;
  check('quien administra lo protege: una sola contraseña para todo el espacio', created.status === 200 && V.team === true && V.state === 'on' && V.check === made.check && V.admin === true && V.ai_members === false && (await deny(api('POST', '/team/vault', body, A.s))) === '409:vault_exists', created.json);
  check('al servidor no le llegó ni la contraseña ni la llave', !JSON.stringify(body).includes(Z.b64(K)) && !onDisk(Z.b64(K)) && !onDisk(PASS) && !R.log().includes(Z.b64(K)));
  check('el historial y la papelera en claro se eliminaron', (await count('/versions/' + enc('plan.md'))) === 0 && (await count('/trash')) === 0);
  check('desde ahí el texto en claro se rechaza, de cualquier miembro', (await deny(api('PUT', tn('plan.md'), { text: 'en claro' }, B.s))) === '409:vault' && (await deny(api('PUT', tn('nueva.md'), { text: 'en claro' }, A.s))) === '409:vault');
  await sleep(300);
  check('los demás miembros se enteran por la escucha', /"type":"vault"/.test(ears.text), ears.text.slice(-200));
  const mv = (await api('GET', '/team/vault', undefined, B.s)).json.vault;
  check('un miembro recibe lo que envuelve a la llave, sin lo que es de quien administra', mv.wrapped === wrapped.wrapped && mv.salt === wrapped.salt && mv.admin === false && !('gone' in mv) && (await acct(B)).team.mine.vault.state === 'on', mv);
  check('nadie de afuera lo ve, y no figura entre las carpetas propias de nadie', (await deny(api('GET', '/team/vault', undefined, X.s))) === '404:no_team' && (await api('GET', '/vaults', undefined, A.s)).json.length === 0 && (await api('GET', '/vaults', undefined, B.s)).json.length === 0);
  check('un miembro no crea carpetas protegidas dentro del equipo', (await deny(api('POST', '/vaults', { folder: '~' + SP + '/docs', ...body }, B.s))) === '400:bad_path' && (await deny(api('POST', '/vaults', { folder: '', ...body }, B.s))) === '400:bad_path');

  // Lo que hace el navegador de quien administra: cifra cada nota que estaba en claro, sobre su revisión.
  const sealAll = async (key, who) => { for (const n of (await api('GET', '/notes?o=' + SP, undefined, who.s)).json.filter((x) => !x.v)) { const got = await raw(n.path, who); await api('PUT', tn(n.path), { text: await Z.seal(key, aad(n.path), got.text), rev: got.rev }, who.s); } };
  const before = (await api('GET', '/notes?o=' + SP, undefined, A.s)).json;
  await sealAll(made.key, A);
  const after = (await api('GET', '/notes?o=' + SP, undefined, A.s)).json;
  check('las notas que ya estaban se cifran una por una, y el listado dice cuáles faltan', before.every((n) => !n.v) && after.length === 2 && after.every((n) => n.v === 1), [before, after]);
  check('en el servidor no queda el texto, ni en el disco', (await raw('plan.md')).text.startsWith('vault1:') && !onDisk('zanahoria-9') && !onDisk('zanahoria-guia') && !onDisk('zanahoria-papelera') && !onDisk('zanahoria-0'));
  check('con DATA_KEY el cifrado en reposo va por encima: en el disco tampoco está el texto cifrado tal cual', !onDisk((await raw('plan.md')).text.slice(0, 60)));

  // ---------- Un miembro entra con la contraseña ----------
  const openAs = async (pass, view) => { const k = await Z.unwrap(view, pass); const d = await Z.derive(k); return d.check === view.check ? d : null; };
  const bKey = (await openAs(PASS, mv)).key;
  let wrong = ''; try { await Z.unwrap(mv, 'otra contraseña'); } catch (e) { wrong = e.code; }
  const n1 = await raw('plan.md', B);
  check('un miembro con la contraseña lee, y con otra no abre', wrong === 'bad_password' && (await Z.open(bKey, aad('plan.md'), n1.text)) === '# Plan\n\nEl secreto del equipo es zanahoria-9.\n');
  let moved = ''; try { await Z.open(bKey, 'plan.md', n1.text); } catch (e) { moved = e.code; }
  check('el texto cifrado está atado al espacio y a la ruta: con otra ruta no abre', moved === 'vault_unreadable');
  const w1 = await api('PUT', tn('plan.md'), { text: await Z.seal(bKey, aad('plan.md'), '# Plan\n\nLo editó Beto, zanahoria-b.\n'), rev: n1.rev }, B.s);
  check('y edita: guarda cifrado sobre la revisión que leyó', w1.status === 200 && w1.json.rev === n1.rev + 1 && !onDisk('zanahoria-b'));
  // Caro había leído la misma revisión: su guardado no pisa, y lo que vuelve lo puede abrir para juntar.
  const w2 = await api('PUT', tn('plan.md'), { text: await Z.seal(bKey, aad('plan.md'), '# Plan\n\nLo editó Caro.\n'), rev: n1.rev }, C.s);
  check('conflicto de revisión entre dos miembros: no se pisa, y vuelve el texto cifrado de ahora', w2.status === 409 && w2.json.error === 'rev_conflict' && w2.json.rev === w1.json.rev && (await Z.open(bKey, aad('plan.md'), w2.json.text)) === '# Plan\n\nLo editó Beto, zanahoria-b.\n', w2.json);
  const w3 = await api('PUT', tn('plan.md'), { text: await Z.seal(bKey, aad('plan.md'), '# Plan\n\nLo editó Beto, zanahoria-b.\n\nY Caro sumó esto.\n'), rev: w2.json.rev }, C.s);
  check('junta y guarda sobre la revisión nueva', w3.status === 200 && w3.json.rev === w1.json.rev + 1);
  // Historial y papelera: cifrados.
  const vers = (await api('GET', '/versions/' + enc('plan.md') + '?o=' + SP, undefined, B.s)).json;
  const ver = vers.length ? (await api('GET', '/version/' + vers[0].id + '?o=' + SP, undefined, B.s)).json : {};
  check('el historial queda cifrado, y cada versión dice con qué ruta se cifró', vers.length === 1 && String(ver.text).startsWith('vault1:') && ver.aad === 'plan.md' && /zanahoria-9/.test(await Z.open(bKey, aad(ver.aad), ver.text)), ver);
  await api('PUT', tn('borrar.md'), { text: await Z.seal(bKey, aad('borrar.md'), 'zanahoria-borrada') }, B.s); await api('DELETE', tn('borrar.md'), undefined, B.s);
  const bin = (await api('GET', '/trash?o=' + SP, undefined, C.s)).json;
  const back = await api('POST', '/trash/' + bin[0].id + '/restore?o=' + SP, {}, C.s);
  check('la papelera queda cifrada y se restaura tal cual', bin.length === 1 && bin[0].protected === true && back.status === 200 && (await Z.open(bKey, aad('borrar.md'), (await raw('borrar.md', C)).text)) === 'zanahoria-borrada', [bin, back.json]);
  check('la búsqueda del servidor no entra al espacio protegido', (await api('GET', '/search?q=zanahoria&o=' + SP, undefined, B.s)).json.length === 0 && (await api('GET', '/search?q=plan&o=' + SP, undefined, B.s)).json.length === 0);
  // Mover dentro del espacio pide el texto cifrado para la ruta nueva.
  const mvNo = await api('POST', '/rename', { from: 'borrar.md', to: 'docs/borrar.md', o: SP }, B.s);
  const mvYes = await api('POST', '/rename', { from: 'borrar.md', to: 'docs/borrar.md', o: SP, text: await Z.seal(bKey, aad('docs/borrar.md'), 'zanahoria-borrada') }, B.s);
  check('mover una nota es volver a cifrarla para su ruta nueva', mvNo.status === 409 && mvNo.json.error === 'vault' && mvYes.status === 200 && (await Z.open(bKey, aad('docs/borrar.md'), (await raw('docs/borrar.md')).text)) === 'zanahoria-borrada', [mvNo.json, mvYes.json]);

  // ---------- Cambiar la contraseña ----------
  const PASS2 = 'otra contraseña bien larga 9'; const re = await Z.wrap(K, PASS2);
  check('cambiar la contraseña: un miembro no puede, ni alguien de afuera', (await deny(api('PUT', '/team/vault', re, B.s))) === '403:not_admin' && (await deny(api('PUT', '/team/vault', re, X.s))) === '404:no_team' && (await api('GET', '/team/vault', undefined, B.s)).json.vault.wrapped === wrapped.wrapped);
  const rewrap = await api('PUT', '/team/vault', re, A.s);
  const mv2 = (await api('GET', '/team/vault', undefined, B.s)).json.vault;
  let oldPass = ''; try { await Z.unwrap(mv2, PASS); } catch (e) { oldPass = e.code; }
  check('quien administra la cambia: la misma llave envuelta de nuevo, sin tocar las notas', rewrap.status === 200 && mv2.check === made.check && oldPass === 'bad_password' && !!(await openAs(PASS2, mv2)) && (await raw('docs/guia.md')).rev === 2, mv2);
  // La clave de respaldo es la llave escrita para una persona: sirve para poner una contraseña nueva, y eso es de quien administra.
  const bk = Z.backupText(K); const fromBk = Z.backupKey(bk); const PASS3 = 'la tercera, con la clave de respaldo';
  check('la clave de respaldo no está en ninguna respuesta del servidor ni en su disco', !JSON.stringify([await acct(A), await acct(B), (await api('GET', '/team/vault', undefined, A.s)).json, (await api('GET', '/team', undefined, B.s)).json]).includes(bk) && !onDisk(bk) && !R.log().includes(bk));
  check('con la clave de respaldo quien administra pone una contraseña nueva; un miembro no', (await deny(api('PUT', '/team/vault', await Z.wrap(fromBk, PASS3), C.s))) === '403:not_admin' && (await api('PUT', '/team/vault', await Z.wrap(fromBk, PASS3), A.s)).status === 200 && !!(await openAs(PASS3, (await api('GET', '/team/vault', undefined, C.s)).json.vault)));

  // ---------- MCP ----------
  console.log(' MCP');
  await api('POST', '/admin/plan', { email: A.email, plan: 'pro' }, undefined, { 'x-admin-key': R.ADMIN });
  const tA = (await api('POST', '/tokens', { name: 'ana' }, A.s)).json.token; const tB = (await api('POST', '/tokens', { name: 'beto' }, B.s)).json.token;
  const tDocs = (await api('POST', '/tokens', { name: 'docs', folder: '@team/docs' }, A.s)).json.token;
  const rd = await tool(tA, 'read_note', { path: '@team/plan.md' });
  const ls = await tool(tA, 'list_notes', {});
  const sr = await tool(tA, 'search_notes', { query: 'zanahoria' });
  const wr = await tool(tA, 'write_note', { path: '@team/ia.md', text: 'en claro desde la IA' });
  check('MCP bloqueado: no lee ni escribe, lista los nombres como protegidos y lo explica', rd.err && /protected with a password/.test(rd.raw) && wr.err && ls.v.filter((n) => n.team).every((n) => n.protected && n.locked) && Array.isArray(sr.v.results) && sr.v.results.length === 0 && sr.v.locked_folders.includes('@team') && !/zanahoria/.test(JSON.stringify([rd, sr])), [rd.raw.slice(0, 80), sr.v]);
  const hist = await tool(tA, 'note_history', { path: '@team/plan.md' }); const mvn = await tool(tA, 'move_note', { from: '@team/plan.md', to: '@team/plan2.md' });
  check('MCP: el historial y mover notas del espacio protegido quedan para la app', hist.err && mvn.err && (await raw('plan.md')).rev === w3.json.rev);
  check('desbloquear para la IA: un miembro no puede sin permiso, ni con una llave equivocada quien administra', (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 15 }, B.s))) === '403:ai_not_allowed' && (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(Z.newKey()), minutes: 15 }, A.s))) === '403:bad_key' && (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 7 }, A.s))) === '400:bad_minutes' && (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 15 }, X.s))) === '404:no_team');
  const un = await api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, A.s);
  const rd2 = await tool(tA, 'read_note', { path: '@team/plan.md' });
  const wr2 = await tool(tA, 'write_note', { path: '@team/ia.md', text: 'Lo escribió la IA, zanahoria-ia.' });
  const sr2 = await tool(tA, 'search_notes', { query: 'zanahoria-ia' });
  check('MCP desbloqueado por quien administra: lee, busca y escribe con el mismo formato de la app', un.status === 200 && un.json.vault.ai && !rd2.err && /zanahoria-b/.test(rd2.raw) && !wr2.err && (await Z.open(bKey, aad('ia.md'), (await raw('ia.md')).text)) === 'Lo escribió la IA, zanahoria-ia.' && !onDisk('zanahoria-ia') && sr2.v.some && sr2.v.some((r) => r.path === '@team/ia.md'), [rd2.raw.slice(0, 60), wr2.raw, sr2.v]);
  const rdB = await tool(tB, 'read_note', { path: '@team/plan.md' }); const rdDocs = await tool(tDocs, 'read_note', { path: '@team/docs/guia.md' });
  check('lo desbloqueado es de quien lo desbloqueó: para la IA de otro miembro sigue cerrado, y para un token que no alcanza todo el equipo también', rdB.err && rdDocs.err && (await api('GET', '/team/vault', undefined, B.s)).json.vault.ai === null);
  check('el interruptor de la IA es de quien administra', (await deny(api('PUT', '/team/vault/ai', { members: true }, B.s))) === '403:not_admin');
  await api('PUT', '/team/vault/ai', { members: true }, A.s);
  const unB = await api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 15 }, B.s);
  check('con el permiso, un miembro lo desbloquea para su IA por un tiempo', unB.status === 200 && unB.json.vault.ai.until > Date.now() && !(await tool(tB, 'read_note', { path: '@team/plan.md' })).err);
  await sleep(1900); // 15 "minutos" de 100 ms
  check('al vencer el plazo se olvida la llave', (await tool(tB, 'read_note', { path: '@team/plan.md' })).err && (await api('GET', '/team/vault', undefined, B.s)).json.vault.ai === null);
  await api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, B.s);
  await api('PUT', '/team/vault/ai', { members: false }, A.s);
  check('al quitar el permiso, lo que un miembro tenía abierto se cierra, y lo de quien administra sigue', (await tool(tB, 'read_note', { path: '@team/plan.md' })).err && !(await tool(tA, 'read_note', { path: '@team/plan.md' })).err);
  await api('POST', '/team/vault/lock', {}, A.s);
  check('bloquear para la IA olvida la llave en el acto', (await tool(tA, 'read_note', { path: '@team/plan.md' })).err);
  check('la llave nunca quedó en el disco ni en la salida del servidor', !onDisk(Z.b64(K)) && !R.log().includes(Z.b64(K)));

  // ---------- Sale un miembro ----------
  console.log(' Salida de un miembro y rotación');
  await api('PUT', '/team/vault/ai', { members: true }, A.s); await api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, C.s);
  check('antes de que nadie salga no hay aviso', (await acct(A)).team.mine.vault.gone === 0);
  const out = await api('POST', '/team/remove', { id: C.id }, A.s);
  const gone = out.json.team.mine.vault.gone;
  check('al sacar a un miembro, quien administra recibe el aviso en la misma respuesta', out.status === 200 && gone > 0 && (await acct(A)).team.mine.vault.gone === gone);
  const tC = (await api('POST', '/tokens', { name: 'caro' }, C.s)).json; // ya sin plan: no hay token
  check('quien salió ya no recibe la llave envuelta, ni lee las notas, ni usa lo que tenía abierto para su IA', (await deny(api('GET', '/team/vault', undefined, C.s))) === '404:no_team' && (await api('GET', tn('plan.md'), undefined, C.s)).status === 403 && (await api('GET', '/notes?o=' + SP, undefined, C.s)).json.length === 0 && !tC.token);
  check('un miembro no ve el aviso ni lo puede descartar', !('gone' in (await acct(B)).team.mine.vault) && (await deny(api('DELETE', '/team/vault/gone', undefined, B.s))) === '403:not_admin');
  // Cambiar la contraseña ya apaga el aviso: quien salió no entra más con la que conocía.
  await api('PUT', '/team/vault', await Z.wrap(K, PASS), A.s);
  check('cambiar la contraseña del equipo apaga el aviso', (await acct(A)).team.mine.vault.gone === 0);
  await api('POST', '/team/leave', {}, B.s);
  check('si un miembro sale por su cuenta, el aviso queda esperando a quien administra', (await acct(A)).team.mine.vault.gone > 0 && (await api('DELETE', '/team/vault/gone', undefined, A.s)).status === 200 && (await acct(A)).team.mine.vault.gone === 0);
  await join(A, B);

  // ---------- Rotar la llave ----------
  const K2 = Z.newKey(); const made2 = await Z.derive(K2); const PASSR = 'contraseña después de rotar'; const next = { ...(await Z.wrap(K2, PASSR)), check: made2.check };
  check('rotar la llave: un miembro no puede, ni con la misma llave de antes', (await deny(api('POST', '/team/vault/rotate', next, B.s))) === '403:not_admin' && (await deny(api('POST', '/team/vault/rotate', { ...next, check: made.check }, A.s))) === '400:bad_vault' && (await deny(api('POST', '/team/vault/rotate/done', {}, A.s))) === '409:vault');
  await api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, A.s);
  const rot = await api('POST', '/team/vault/rotate', next, A.s);
  const mid = (await api('GET', '/team/vault', undefined, B.s)).json.vault;
  check('mientras se rota: quien administra tiene la llave nueva envuelta, y un miembro no la ve', rot.status === 200 && rot.json.vault.state === 'rotating' && rot.json.vault.next.check === made2.check && mid.state === 'rotating' && !('next' in mid) && mid.check === made.check, mid);
  const held = await api('PUT', tn('plan.md'), { text: await Z.seal(bKey, aad('plan.md'), 'con la llave vieja'), rev: (await raw('plan.md')).rev }, B.s);
  check('mientras se rota los demás no guardan, y la IA queda afuera', held.status === 423 && held.json.error === 'vault_rotating' && (await tool(tA, 'read_note', { path: '@team/plan.md' })).err && (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, A.s))) === '409:vault' && (await deny(api('PUT', '/team/vault', await Z.wrap(K, PASS2), A.s))) === '409:vault_rotating');
  // El navegador de quien administra: abre con la llave anterior y guarda con la nueva. Se corta a la mitad y se retoma.
  const rotateSome = async (max) => { let n = 0; for (const row of (await api('GET', '/notes?o=' + SP, undefined, A.s)).json) { const got = await raw(row.path); let plain = null; try { await Z.open(made2.key, aad(row.path), got.text); continue; } catch (e) { plain = await Z.open(made.key, aad(row.path), got.text); } if (n++ >= max) return false; await api('PUT', tn(row.path), { text: await Z.seal(made2.key, aad(row.path), plain), rev: got.rev }, A.s); } return true; };
  const half = await rotateSome(2);
  const midway = (await acct(A)).team.mine.vault;
  check('si se corta a la mitad queda en rotación, con todo todavía legible para quien administra', half === false && midway.state === 'rotating' && !!midway.next);
  const whole = await rotateSome(99);
  const fin = await api('POST', '/team/vault/rotate/done', {}, A.s);
  const mv3 = (await api('GET', '/team/vault', undefined, B.s)).json.vault;
  check('al terminar, la llave nueva reemplaza a la anterior y el aviso se apaga', whole && fin.status === 200 && fin.json.vault.state === 'on' && mv3.check === made2.check && mv3.wrapped === next.wrapped && !('next' in fin.json.vault) && fin.json.vault.gone === 0, mv3);
  const nKey = (await openAs(PASSR, mv3)).key; const cur = await raw('plan.md', B);
  let stale = ''; try { await Z.open(bKey, aad('plan.md'), cur.text); } catch (e) { stale = e.code; }
  let stalePass = ''; try { await Z.unwrap(mv3, PASS); } catch (e) { stalePass = e.code; }
  check('ex miembro tras rotar: con la llave y la contraseña anteriores ya no se abre nada de lo que hay', stale === 'vault_unreadable' && stalePass === 'bad_password' && /Y Caro sumó esto/.test(await Z.open(nKey, aad('plan.md'), cur.text)) && (await api('GET', tn('plan.md'), undefined, C.s)).status === 403 && (await deny(api('POST', '/team/vault/unlock', { key: Z.b64(K), minutes: 0 }, A.s))) === '403:bad_key');
  check('el historial y la papelera cifrados con la llave anterior se eliminaron', (await count('/versions/' + enc('plan.md'))) === 0 && (await count('/trash')) === 0);
  check('los miembros vuelven a guardar, con la llave nueva', (await api('PUT', tn('plan.md'), { text: await Z.seal(nKey, aad('plan.md'), '# Plan\n\nDespués de rotar.\n'), rev: cur.rev }, B.s)).status === 200);

  // ---------- Quitar la protección y eliminar ----------
  console.log(' Quitar la protección');
  check('quitar la protección: un miembro no puede', (await deny(api('POST', '/team/vault/open', {}, B.s))) === '403:not_admin' && (await deny(api('DELETE', '/team/vault', undefined, B.s))) === '403:not_admin');
  await api('POST', '/team/vault/open', {}, A.s);
  check('no se quita mientras queden notas cifradas', (await deny(api('DELETE', '/team/vault', undefined, A.s))) === '409:vault_not_empty');
  for (const row of (await api('GET', '/notes?o=' + SP, undefined, A.s)).json.filter((x) => x.v)) { const got = await raw(row.path); await api('PUT', tn(row.path), { text: await Z.open(nKey, aad(row.path), got.text), rev: got.rev }, A.s); }
  const off = await api('DELETE', '/team/vault', undefined, A.s);
  check('descifradas todas, se quita: vuelve a ser un espacio como antes', off.status === 200 && (await acct(A)).team.mine.vault === null && (await raw('plan.md', B)).text === '# Plan\n\nDespués de rotar.\n' && (await deny(api('PUT', tn('plan.md'), { text: await Z.seal(nKey, aad('plan.md'), 'x') }, B.s))) === '409:vault_text' && (await api('GET', '/search?q=rotar&o=' + SP, undefined, B.s)).json.length === 1);
  // De nuevo protegido, y sin llave ni clave de respaldo: se elimina el contenido escribiendo el nombre del equipo.
  await api('PUT', '/team', { name: 'Los Zapallos' }, A.s);
  await api('POST', '/team/vault', body, A.s); await sealAll(made.key, A);
  const total = (await api('GET', '/notes?o=' + SP, undefined, A.s)).json.length;
  check('eliminar el contenido: un miembro no puede, y sin el nombre exacto del equipo tampoco quien administra', (await deny(api('POST', '/team/vault/destroy', { name: 'Los Zapallos' }, B.s))) === '403:not_admin' && (await deny(api('POST', '/team/vault/destroy', { name: 'los zapallos' }, A.s))) === '400:bad_confirm' && (await deny(api('POST', '/team/vault/destroy', {}, A.s))) === '400:bad_confirm' && (await api('GET', '/notes?o=' + SP, undefined, A.s)).json.length === total);
  const wipe = await api('POST', '/team/vault/destroy', { name: 'Los Zapallos' }, A.s);
  check('con el nombre del equipo se eliminan las notas y la protección, y el equipo sigue', wipe.status === 200 && wipe.json.notes === total && (await api('GET', '/notes?o=' + SP, undefined, B.s)).json.length === 0 && (await acct(A)).team.mine.vault === null && (await acct(B)).team.mine.space === SP && (await api('PUT', tn('nueva.md'), { text: 'en claro otra vez' }, B.s)).status === 200, wipe.json);
  check('nada de esto se anotó como error del servidor', !/error 500|error no capturado|promesa sin atender/.test(R.log()), (R.log().match(/error[^\n]*/g) || []).slice(0, 3));
  ears.stop();

  if (process.env.TV_ONLY !== 'server') await appSuite();
} catch (e) { check('sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }

async function appSuite() {
  console.log('Espacio del equipo protegido (app)');
  const { api } = R;
  const acct = async (who) => (await api('GET', '/account', undefined, who.s)).json;
  const O = await R.signup('olga@ejemplo.test'); const P = await R.signup('pedro@ejemplo.test'); const Q = await R.signup('quique@ejemplo.test');
  await api('POST', '/admin/team', { email: O.email, seats: 4 }, undefined, { 'x-admin-key': R.ADMIN });
  await api('PUT', '/team', { name: 'Los Pomelos' }, O.s);
  for (const who of [P, Q]) { await api('POST', '/team/invite', { email: who.email }, O.s); await api('POST', '/team/accept', { id: (await acct(who)).team.invites[0].id }, who.s); }
  const SP = (await acct(O)).team.mine.space;
  const tn = (p) => '/notes/' + enc(p) + '?o=' + SP; const aad = (p) => '~' + SP + '/' + p;
  const raw = async (p) => (await api('GET', tn(p), undefined, O.s)).json;
  const rows = async () => (await api('GET', '/notes?o=' + SP, undefined, O.s)).json;
  const tv = async (who) => (await api('GET', '/team/vault', undefined, (who || O).s)).json.vault;
  await api('PUT', tn('plan.md'), { text: '# Plan\n\nPrimer párrafo, pomelo-uno.\n\nSegundo párrafo, pomelo-dos.\n' }, O.s);
  await api('PUT', tn('docs/guia.md'), { text: '# Guía\n\npomelo-guia\n' }, P.s);
  await api('PUT', tn('docs/otra.md'), { text: '# Otra\n\npomelo-otra\n' }, P.s);
  const tO = (await api('POST', '/tokens', { name: 'ia' }, O.s)).json.token;
  const mcp = async (name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tO); return { text: r.json.result.content[0].text, err: !!r.json.result.isError }; };
  const tUrl = (p, edit) => R.noteUrl('~' + SP + '/' + p, edit);
  const natives = [];
  const watch = (c) => { c.page.on('dialog', (d) => { natives.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); }); c.sent = []; c.ctx.on('request', (r) => { if (r.url().startsWith(R.base)) c.sent.push(r.method() + ' ' + r.url().slice(R.base.length) + ' ' + (r.postData() || '')); }); return c; };
  const openPlan = async (page) => { await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=plan]'); await page.waitForSelector('.lmd-panel .lmd-team'); await page.waitForTimeout(300); };
  const closePanel = (page) => page.click('[data-act=close-panel]');
  const CARD = '.lmd-vault-card';
  const gone = (page) => page.waitForSelector(CARD, { state: 'detached', timeout: 40000 });
  const failed = async (page) => { await page.waitForSelector(CARD + ' .lmd-dlg-err:not([hidden])'); return page.textContent(CARD + ' .lmd-dlg-err'); };
  const status = async (page, re) => { await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('.lmd-foot .lmd-status').textContent), re, { timeout: 15000 }); return page.textContent('.lmd-foot .lmd-status'); };
  const until = async (fn, ms) => { for (let i = 0; i < (ms || 10000) / 200; i++) { const v = await fn(); if (v) return v; await sleep(200); } return fn(); };
  const line = (page) => page.evaluate(() => { const l = document.querySelector('[data-root=team] .lmd-team-lock'); return l ? { text: l.innerText.replace(/\s+/g, ' ').trim(), shut: l.classList.contains('lmd-team-shut'), nodes: [...document.querySelectorAll('[data-root=team] .lmd-node-name')].map((n) => n.textContent), empty: (document.querySelector('[data-root=team] .lmd-empty') || {}).textContent || '' } : null; });
  const items = async (page) => { await page.click('[data-root=team] .lmd-team-more'); await page.waitForSelector('.lmd-menu [data-f]'); const out = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu [data-f]')].map((b) => b.dataset.f)); await page.keyboard.press('Escape'); return out; };
  const pickItem = async (page, f) => { await page.click('[data-root=team] .lmd-team-more'); await page.waitForSelector('.lmd-menu [data-f=' + f + ']'); await page.click('.lmd-menu [data-f=' + f + ']'); };
  // La clave de respaldo que muestra la app, y de ella la llave: con eso la prueba lee lo que guardó el servidor.
  const keyShown = async (page) => { await page.waitForSelector(CARD + ' [data-v=key] span'); const text = await page.evaluate(() => [...document.querySelectorAll('.lmd-vault-card [data-v=key] span')].map((s) => s.textContent).join('-')); const K = Z.backupKey(text); return { text, K, key: (await Z.derive(K)).key, check: (await Z.derive(K)).check }; };
  const PASS = 'caballo correcto batería grapa'; const PASS2 = 'otra contraseña bien larga 9'; const PASS3 = 'la tercera, después de rotar';

  // ---------- Quien administra protege el espacio ----------
  const olga = watch(await R.open(O));
  await olga.page.goto(tUrl('plan.md', true)); await olga.page.waitForSelector('.lmd-article p.lmd-editable'); await olga.page.waitForSelector('[data-root=team] .lmd-node');
  check('sin proteger, el explorador no muestra candado en el equipo', (await line(olga.page)) === null);
  await openPlan(olga.page);
  const offer = await olga.page.evaluate(() => ({ text: document.querySelector('.lmd-team').innerText, btn: !!document.querySelector('.lmd-team [data-t=v-protect]') }));
  check('Plan le ofrece a quien administra proteger el espacio, en una línea', offer.btn && /Space protection/.test(offer.text) && /the server cannot read them/.test(offer.text), offer.text);
  await olga.page.click('.lmd-team [data-t=v-protect]'); await olga.page.waitForSelector(CARD);
  const first = await olga.page.evaluate(() => document.querySelector('.lmd-vault-card').innerText);
  check('la ventana dice que es una sola contraseña para todos, y qué queda a la vista', /Protect the space of "Los Pomelos"/.test(first) && /one password for the whole team/.test(first) && /Note and folder names are not encrypted/.test(first) && !/[!¡—–]/.test(first), first);
  await olga.page.fill(CARD + ' [data-v=p1]', PASS); await olga.page.fill(CARD + ' [data-v=p2]', PASS); await olga.page.click(CARD + ' [data-v=ok]');
  const k1 = await keyShown(olga.page);
  check('la clave de respaldo es un paso obligado: no se sigue sin guardarla', !!k1.K && (await olga.page.isDisabled(CARD + ' [data-v=ok]')) && (await tv()) === null);
  await olga.page.click(CARD + ' [data-v=copy]'); await olga.page.click(CARD + ' [data-v=ok]'); await gone(olga.page);
  const sealedAll = await until(async () => (await rows()).every((n) => n.v === 1));
  const v1 = await tv();
  check('protege y cifra en su navegador las notas que ya estaban', sealedAll && v1.state === 'on' && v1.check === k1.check && (await Z.open(k1.key, aad('docs/guia.md'), (await raw('docs/guia.md')).text)) === '# Guía\n\npomelo-guia\n', await rows());
  check('ni la contraseña ni la llave viajaron al servidor', !olga.sent.some((s) => s.includes(PASS) || s.includes(Z.b64(k1.K)) || s.includes(k1.text)) && olga.sent.some((s) => s.startsWith('POST /team/vault ')));
  await olga.page.waitForSelector('.lmd-team [data-t=v-rotate]');
  const admin = await olga.page.evaluate(() => ({ text: document.querySelector('.lmd-team').innerText, acts: [...document.querySelectorAll('.lmd-team [data-t^=v-]')].map((b) => b.dataset.t), ai: document.querySelector('.lmd-team [data-t=v-ai]').checked }));
  check('Plan pasa a mostrar la gestión: cambiar la contraseña, ver la clave, rotar, quitar, y el interruptor de la IA apagado', ['v-ai', 'v-pass', 'v-backup', 'v-rotate', 'v-off', 'v-destroy'].every((a) => admin.acts.includes(a)) && admin.ai === false && /names stay visible/.test(admin.text) && /no server search/.test(admin.text) && !/[!¡—–]/.test(admin.text), admin);
  // Ver la clave de respaldo: con la contraseña, la misma que se mostró al proteger.
  await olga.page.click('.lmd-team [data-t=v-backup]'); await olga.page.waitForSelector(CARD);
  await olga.page.fill(CARD + ' [data-v=p]', 'no es'); await olga.page.click(CARD + ' [data-v=ok]');
  const badPass = await failed(olga.page);
  await olga.page.fill(CARD + ' [data-v=p]', PASS); await olga.page.click(CARD + ' [data-v=ok]');
  const again = await keyShown(olga.page);
  check('quien administra vuelve a ver la clave de respaldo con la contraseña', badPass === 'That password does not match.' && again.text === k1.text);
  await olga.page.click(CARD + ' [data-v=no]'); await closePanel(olga.page);
  const l1 = await line(olga.page);
  check('el explorador muestra el candado del equipo, abierto en esta pestaña, con sus notas', !!l1 && !l1.shut && /Protected, unlocked in this tab/.test(l1.text) && /Lock/.test(l1.text) && l1.nodes.includes('plan.md'), l1);
  check('y la nota abierta se sigue leyendo', /pomelo-uno/.test(await olga.page.textContent('.lmd-article')));
  const oItems = await items(olga.page);
  check('quien administra tiene en el explorador todas las acciones', ['v-lock', 'v-ai', 'v-pass', 'v-backup', 'v-rotate', 'v-off'].every((a) => oItems.includes(a)), oItems);

  // ---------- Un miembro entra con la contraseña ----------
  const pedro = watch(await R.open(P));
  await pedro.page.goto(tUrl('plan.md', true)); await pedro.page.waitForSelector(CARD);
  const ask = await pedro.page.evaluate(() => ({ text: document.querySelector('.lmd-vault-card').innerText, forgot: !!document.querySelector('.lmd-vault-card [data-v=forgot]'), keep: !!document.querySelector('.lmd-vault-card [data-v=keep]') }));
  check('al miembro se le pide la contraseña, con a quién pedírsela y sin recuperar ni cambiar nada', /Unlock "Los Pomelos"/.test(ask.text) && /Ask the team administrator for the password\./.test(ask.text) && !ask.forgot && ask.keep && !/[!¡—–]/.test(ask.text), ask);
  await pedro.page.fill(CARD + ' [data-v=p]', 'no es esta'); await pedro.page.click(CARD + ' [data-v=ok]');
  const wrongP = await failed(pedro.page);
  await pedro.page.fill(CARD + ' [data-v=p]', PASS); await pedro.page.check(CARD + ' [data-v=keep]'); await pedro.page.click(CARD + ' [data-v=ok]'); await gone(pedro.page);
  await pedro.page.waitForSelector('.lmd-article p.lmd-editable');
  check('con otra contraseña no entra; con la del equipo lee la nota', wrongP === 'That password does not match.' && /pomelo-dos/.test(await pedro.page.textContent('.lmd-article')));
  await pedro.page.waitForSelector('[data-root=team] .lmd-team-lock');
  const pItems = await items(pedro.page);
  check('un miembro bloquea y olvida; no cambia la contraseña, no ve la clave, no rota ni quita la protección, y la IA queda apagada', pItems.join() === 'v-lock,v-drop', pItems);
  await openPlan(pedro.page);
  const member = await pedro.page.evaluate(() => ({ text: document.querySelector('.lmd-team [data-team=vault]').textContent, acts: [...document.querySelectorAll('.lmd-team [data-t^=v-]')].length }));
  check('en Plan el miembro ve que está protegido y a quién pedirle la contraseña, sin acciones', /Ask the team administrator for it\./.test(member.text) && member.acts === 0, member);
  await closePanel(pedro.page);
  // Los dos editan la misma nota, cada uno un párrafo.
  await typeIn(pedro.page, 'pomelo-uno', ' Pedro estuvo acá.'); await leave(pedro.page);
  const plainOf = async (key, p) => { try { return await Z.open(key, aad(p), (await raw(p)).text); } catch (e) { return ''; } };
  const e1 = await until(async () => /Pedro estuvo acá/.test(await plainOf(k1.key, 'plan.md')));
  check('el miembro edita y lo que sube va cifrado con la llave del equipo', e1 && (await raw('plan.md')).text.startsWith('vault1:') && !pedro.sent.some((s) => s.includes('Pedro estuvo') || s.includes(PASS)));
  await olga.page.waitForFunction(() => /Pedro estuvo acá/.test(document.querySelector('.lmd-article').textContent), null, { timeout: 15000 });
  await typeIn(olga.page, 'pomelo-dos', ' Olga también.'); await leave(olga.page);
  const e2 = await until(async () => { const t = await plainOf(k1.key, 'plan.md'); return /Pedro estuvo acá/.test(t) && /Olga también/.test(t); });
  check('quien administra recibe el cambio en vivo y suma el suyo: quedan los dos', e2, await plainOf(k1.key, 'plan.md'));
  await pedro.page.reload(); await pedro.page.waitForSelector('.lmd-article p.lmd-editable');
  check('con "recordar en este dispositivo" no vuelve a pedir la contraseña al recargar', !(await pedro.page.$(CARD)) && /Olga también/.test(await pedro.page.textContent('.lmd-article')));
  // El historial se lee desde la app, descifrado acá.
  const vers = (await api('GET', '/versions/' + enc('plan.md') + '?o=' + SP, undefined, P.s)).json;
  check('el historial quedó cifrado en el servidor', vers.length >= 1 && (await api('GET', '/version/' + vers[0].id + '?o=' + SP, undefined, P.s)).json.text.startsWith('vault1:'));

  // ---------- Pantalla chica ----------
  const quique = watch(await R.open(Q, { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  await quique.page.goto(tUrl('docs/guia.md')); await quique.page.waitForSelector(CARD);
  const fits = (page, sel) => page.evaluate((s) => { const card = document.querySelector(s); const box = card.getBoundingClientRect(); const out = [...card.querySelectorAll('button, input, a')].filter((n) => n.offsetParent).filter((n) => { const b = n.getBoundingClientRect(); return b.left < -0.5 || b.right > innerWidth + 0.5 || b.width < 1; }).map((n) => n.textContent || n.type); return { w: innerWidth, left: box.left, right: box.right, out, sideways: document.documentElement.scrollWidth - innerWidth }; }, sel);
  const phoneAsk = await fits(quique.page, CARD);
  check('en un teléfono la ventana de la contraseña entra en la pantalla', phoneAsk.left >= 0 && phoneAsk.right <= phoneAsk.w && !phoneAsk.out.length && phoneAsk.sideways <= 0, phoneAsk);
  await quique.page.fill(CARD + ' [data-v=p]', PASS); await quique.page.click(CARD + ' [data-v=ok]'); await gone(quique.page);
  await quique.page.waitForFunction(() => /pomelo-guia/.test((document.querySelector('.lmd-article') || document.body).textContent), null, { timeout: 15000 });
  await quique.page.evaluate(() => { const b = document.querySelector('[data-act=sidebar]'); if (b) b.click(); });
  await quique.page.waitForSelector('[data-root=team] .lmd-team-lock', { state: 'attached' }); await quique.page.waitForTimeout(400);
  const phoneLine = await quique.page.evaluate(() => { const l = document.querySelector('[data-root=team] .lmd-team-lock'); const b = l.getBoundingClientRect(); const btns = [...l.querySelectorAll('button')].map((x) => { const r = x.getBoundingClientRect(); return { h: Math.round(r.height), right: r.right }; }); return { shown: !!l.offsetParent, left: b.left, right: b.right, w: innerWidth, btns, text: l.innerText.replace(/\s+/g, ' ').trim(), sideways: document.documentElement.scrollWidth - innerWidth }; });
  check('y el candado del equipo se ve en el explorador, con botones cómodos para el dedo y sin desbordar', phoneLine.shown && phoneLine.right <= phoneLine.w + 0.5 && phoneLine.btns.length >= 2 && phoneLine.btns.every((x) => x.h >= 32 && x.right <= phoneLine.w + 0.5) && phoneLine.sideways <= 0 && /Protected, unlocked/.test(phoneLine.text), phoneLine);
  await quique.page.click('[data-root=team] .lmd-team-lock [data-team-vault=v-lock]');
  await quique.page.waitForFunction(() => { const l = document.querySelector('[data-root=team] .lmd-team-lock'); return l && l.classList.contains('lmd-team-shut'); }, null, { timeout: 10000 });
  const lockedLine = await line(quique.page);
  check('bloquear desde ahí cierra la nota y deja de listar las del equipo', /Protected, locked/.test(lockedLine.text) && lockedLine.nodes.length === 0 && /Unlock the space to see its notes\./.test(lockedLine.empty), lockedLine);
  await openPlan(quique.page);
  const phonePlan = await quique.page.evaluate(() => { const body = document.querySelector('.lmd-panel-body'); return { sideways: body.scrollWidth - body.clientWidth, text: document.querySelector('.lmd-team').innerText }; });
  check('en un teléfono Plan no se desborda con el bloque de protección', phonePlan.sideways <= 0 && /Space protection/.test(phonePlan.text), phonePlan);
  await closePanel(quique.page);

  // ---------- MCP: bloqueado, y desbloqueado por un tiempo desde la app ----------
  const lockedAi = await mcp('read_note', { path: '@team/plan.md' });
  await pickItem(olga.page, 'v-ai'); await olga.page.waitForSelector(CARD);
  const aiText = await olga.page.evaluate(() => document.querySelector('.lmd-vault-card').innerText);
  await olga.page.fill(CARD + ' [data-v=p]', PASS); await olga.page.click(CARD + ' [data-v=ok]'); await gone(olga.page);
  const openAi = await until(async () => { const r = await mcp('read_note', { path: '@team/plan.md' }); return !r.err && r.text; });
  check('MCP: bloqueado no lee; quien administra lo desbloquea para su IA desde el explorador y lee', lockedAi.err && /Pedro estuvo acá/.test(openAi || '') && /for your AI/.test(aiText) && /everyone else's AI it stays locked/.test(aiText), [lockedAi.text.slice(0, 60), aiText]);
  await olga.page.waitForSelector('[data-root=team] .lmd-team-lock [data-vault-ailock]');
  check('el explorador dice hasta cuándo está abierto para la IA', /Open to the AI until/.test((await line(olga.page)).text), await line(olga.page));
  await olga.page.click('[data-root=team] .lmd-team-lock [data-vault-ailock]');
  check('y "Bloquear ahora" lo cierra', await until(async () => (await mcp('read_note', { path: '@team/plan.md' })).err));

  // ---------- Sale un miembro: el aviso y cambiar la contraseña ----------
  await openPlan(olga.page);
  await olga.page.click('.lmd-team [data-t=remove][data-mail="' + Q.email + '"]'); await olga.page.waitForSelector('.lmd-dlg'); await olga.page.click('.lmd-dlg [data-dlg=ok]');
  await olga.page.waitForSelector('.lmd-team .lmd-team-gone');
  const warn = await olga.page.evaluate(() => ({ text: document.querySelector('.lmd-team-gone').innerText, acts: [...document.querySelectorAll('.lmd-team-gone [data-t]')].map((b) => b.dataset.t + ':' + b.textContent) }));
  check('al sacar a un miembro, quien administra ve el aviso ahí mismo, con cambiar la contraseña y rotar la llave', /Someone left the team and knew the password\./.test(warn.text) && /cannot be taken back/.test(warn.text) && warn.acts[0] === 'v-pass:Change the team password' && warn.acts[1] === 'v-rotate:Rotate the key' && !/[!¡—–]/.test(warn.text), warn);
  const wrappedBefore = (await tv()).wrapped;
  await olga.page.click('.lmd-team-gone [data-t=v-pass]'); await olga.page.waitForSelector(CARD);
  await olga.page.fill(CARD + ' [data-v=p0]', PASS); await olga.page.fill(CARD + ' [data-v=p1]', PASS2); await olga.page.fill(CARD + ' [data-v=p2]', PASS2); await olga.page.click(CARD + ' [data-v=ok]'); await gone(olga.page);
  await olga.page.waitForSelector('.lmd-team .lmd-team-gone', { state: 'detached', timeout: 10000 });
  const v2 = await tv();
  let oldOpens = true; try { await Z.unwrap(v2, PASS); } catch (e) { oldOpens = false; }
  check('cambia la contraseña: la llave se envuelve de nuevo, las notas no se tocan y el aviso se va', v2.wrapped !== wrappedBefore && v2.check === k1.check && !oldOpens && Z.b64(await Z.unwrap(v2, PASS2)) === Z.b64(k1.K) && v2.gone === 0);
  check('quien salió no ve nada del equipo', (await api('GET', '/team/vault', undefined, Q.s)).status === 404 && (await api('GET', tn('plan.md'), undefined, Q.s)).status === 403);

  // ---------- Rotar la llave ----------
  await olga.page.click('.lmd-team [data-t=v-rotate]'); await olga.page.waitForSelector(CARD);
  const rotText = await olga.page.evaluate(() => document.querySelector('.lmd-vault-card').innerText);
  await olga.page.fill(CARD + ' [data-v=p0]', PASS2); await olga.page.fill(CARD + ' [data-v=p1]', PASS3); await olga.page.fill(CARD + ' [data-v=p2]', PASS3); await olga.page.click(CARD + ' [data-v=ok]');
  const k2 = await keyShown(olga.page);
  const needKey = await olga.page.isDisabled(CARD + ' [data-v=ok]');
  await olga.page.click(CARD + ' [data-v=copy]'); await olga.page.click(CARD + ' [data-v=ok]'); await gone(olga.page);
  const v3 = await until(async () => { const v = await tv(); return v.state === 'on' && v.check === k2.check ? v : null; });
  let staleOpens = true; try { await Z.open(k1.key, aad('plan.md'), (await raw('plan.md')).text); } catch (e) { staleOpens = false; }
  const fresh = await plainOf(k2.key, 'plan.md');
  check('rotar la llave: dice qué pasa, da una clave de respaldo nueva y vuelve a cifrar todo', /encrypted again in this browser/.test(rotText) && /cannot be taken back/.test(rotText) && needKey && k2.text !== k1.text && !!v3 && !staleOpens && /Olga también/.test(fresh) && /pomelo-otra/.test(await plainOf(k2.key, 'docs/otra.md')) && !/[!¡—–]/.test(rotText), [rotText, v3]);
  check('ni la contraseña nueva ni la llave nueva viajaron', !olga.sent.some((s) => s.includes(PASS3) || s.includes(Z.b64(k2.K)) || s.includes(k2.text)));
  await closePanel(olga.page);
  check('quien administra sigue con la nota abierta, ya con la llave nueva', await until(async () => /Olga también/.test(await olga.page.textContent('.lmd-article')) && !(await olga.page.$(CARD))));
  // Pedro tenía la llave anterior recordada: no le sirve más. Entra con la contraseña nueva.
  await pedro.page.reload(); await pedro.page.waitForSelector(CARD);
  await pedro.page.fill(CARD + ' [data-v=p]', PASS2); await pedro.page.click(CARD + ' [data-v=ok]');
  const oldP = await failed(pedro.page);
  await pedro.page.fill(CARD + ' [data-v=p]', PASS3); await pedro.page.click(CARD + ' [data-v=ok]'); await gone(pedro.page);
  await pedro.page.waitForSelector('.lmd-article p.lmd-editable');
  check('tras rotar, lo recordado en el dispositivo de un miembro ya no abre: entra con la contraseña nueva', oldP === 'That password does not match.' && /Olga también/.test(await pedro.page.textContent('.lmd-article')));

  // ---------- Quitar la protección ----------
  await openPlan(olga.page);
  await olga.page.click('.lmd-team [data-t=v-off]'); await olga.page.waitForSelector(CARD);
  await olga.page.fill(CARD + ' [data-v=p]', PASS3); await olga.page.fill(CARD + ' [data-v=name]', 'otro nombre'); await olga.page.click(CARD + ' [data-v=ok]');
  const badName = await failed(olga.page);
  check('quitar la protección pide además el nombre del equipo', badName === 'That is not the name of the team.' && (await tv()).state === 'on');
  await olga.page.fill(CARD + ' [data-v=name]', 'Los Pomelos'); await olga.page.click(CARD + ' [data-v=ok]'); await gone(olga.page);
  const plainAgain = await until(async () => (await tv()) === null && (await rows()).every((n) => !n.v));
  check('descifra todo en su navegador y el espacio vuelve a ser como antes', plainAgain && /Olga también/.test((await raw('plan.md')).text) && (await raw('docs/guia.md')).text === '# Guía\n\npomelo-guia\n');
  await olga.page.waitForSelector('.lmd-team [data-t=v-protect]');
  await closePanel(olga.page);
  check('el candado desaparece del explorador', await until(async () => (await line(olga.page)) === null));
  check('sin diálogos del navegador, sin errores de página y sin pedidos hacia afuera', !natives.length && !R.errors.length && !R.outside.length, [natives, R.errors, R.outside]);
}

const bad = done();
await R.close(); fakeMail.close();
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ }
process.exit(bad ? 1 : 0);
