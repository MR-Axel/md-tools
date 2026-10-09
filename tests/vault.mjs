// Carpetas con contraseña, del lado del servidor: qué guarda, qué deja pasar por cada ruta y por cada herramienta
// del MCP, y qué pasa mientras una carpeta está desbloqueada para la IA. El cifrado es el mismo que usa la app:
// se carga src/seal.js tal cual. Todo contra un servidor local; nada toca producción.
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.LMD = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', 'seal.js'), 'utf8'));
const Z = globalThis.LMD.seal;

const boot = async (dir, extra) => {
  const port = 24000 + Math.floor(Math.random() * 3000);
  const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', VAULT_MINUTE_MS: '100', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => proc.once('exit', r));
  for (let i = 0; i < 80 && !/puerto/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  const base = 'http://127.0.0.1:' + port;
  const ask = async (method, url, body, auth, more) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(more || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const enter = async (mail, pro) => { const c = await ask('POST', '/auth/start', { email: mail }); const s = (await ask('POST', '/auth/verify', { email: mail, code: c.json.dev_code })).json.session; if (pro) await ask('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' }); return s; };
  return { base, ask, enter, log: () => out, stop: async () => { proc.kill(); await exited; await new Promise((r) => setTimeout(r, 150)); } };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
const onDisk = (dir, what) => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).some((f) => fs.readFileSync(path.join(dir, f)).includes(Buffer.isBuffer(what) ? what : Buffer.from(what)));

console.log('Carpetas con contraseña (servidor)');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
let srv = await boot(data, {});
try {
  const s = await srv.enter('ana@ejemplo.test', true); const b = await srv.enter('beto@ejemplo.test', false);
  const owner = (await srv.ask('GET', '/account', undefined, s)).json.id;
  const put = (p, text, auth) => srv.ask('PUT', '/notes/' + enc(p), { text }, auth || s);
  const get = (p, auth, o) => srv.ask('GET', '/notes/' + enc(p) + (o ? '?o=' + o : ''), undefined, auth || s);
  const SECRET = '# Diario\n\nLa clave del banco es berenjena-7.';
  await put('abierta/uno.md', '# Uno\n\nNada que esconder, pepino.');
  await put('secreta/diario.md', '# Diario\n\nPrimera versión, berenjena-0.');
  await put('secreta/diario.md', SECRET);
  await put('secreta/sub/lista.md', '- berenjena-lista');
  await srv.ask('POST', '/comments', { path: 'secreta/diario.md', quote: 'berenjena-cita', text: 'Cambiá esto' }, s);
  await srv.ask('POST', '/shares', { path: 'secreta/diario.md', email: 'beto@ejemplo.test', role: 'edit' }, s);
  await srv.ask('POST', '/shares', { path: 'secreta', kind: 'folder', email: 'beto@ejemplo.test', role: 'view' }, s);
  const link = (await srv.ask('POST', '/links', { path: 'secreta/diario.md' }, s)).json.token;
  const full = (await srv.ask('POST', '/tokens', { name: 'todo' }, s)).json.token;
  const tAbierta = (await srv.ask('POST', '/tokens', { name: 'abierta', folder: 'abierta' }, s)).json.token;
  const tSecreta = (await srv.ask('POST', '/tokens', { name: 'secreta', folder: 'secreta' }, s)).json.token;
  const tSub = (await srv.ask('POST', '/tokens', { name: 'sub', folder: 'secreta/sub' }, s)).json.token;
  const tool = async (tok, name, args) => { const r = await srv.ask('POST', '/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; let v = c.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!c.isError, raw: c.content[0].text }; };

  // ---------- Crear: lo que llega al servidor ----------
  const PASSWORD = 'correcto caballo batería'; const K = Z.newKey(); const made = await Z.derive(K); const wrapped = await Z.wrap(K, PASSWORD);
  const bad = await srv.ask('POST', '/vaults', { folder: 'secreta', salt: 'corta', iters: 600000, wrapped: wrapped.wrapped, check: made.check }, s);
  const weak = await srv.ask('POST', '/vaults', { folder: 'secreta', salt: wrapped.salt, iters: 1000, wrapped: wrapped.wrapped, check: made.check }, s);
  check('crear: rechaza datos mal formados y pocas vueltas', bad.status === 400 && bad.json.error === 'bad_vault' && weak.status === 400, [bad.json, weak.json]);
  const created = await srv.ask('POST', '/vaults', { folder: 'secreta', ...wrapped, check: made.check }, s);
  const V = created.json;
  check('crear: guarda la carpeta, la sal, las vueltas, la llave envuelta y el valor de comprobación', created.status === 200 && V.folder === 'secreta' && V.salt === wrapped.salt && V.iters === 600000 && V.wrapped === wrapped.wrapped && V.check === made.check && V.state === 'on' && V.ai === null, V);
  check('crear: una carpeta protegida no va dentro de otra, ni encima', (await srv.ask('POST', '/vaults', { folder: 'secreta/sub', ...wrapped, check: made.check }, s)).json.error === 'vault_nested' && (await srv.ask('POST', '/vaults', { folder: 'secreta', ...wrapped, check: made.check }, s)).json.error === 'vault_nested');
  const purged = { vers: (await srv.ask('GET', '/versions/' + enc('secreta/diario.md'), undefined, s)).json.length, coms: (await srv.ask('GET', '/comments?all=1', undefined, s)).json.length, pub: (await srv.ask('GET', '/public/' + link)).status, shares: (await srv.ask('GET', '/shares', undefined, s)).json };
  check('crear: se van el historial en claro, los comentarios, los enlaces públicos y lo compartido de esa carpeta', purged.vers === 0 && purged.coms === 0 && purged.pub === 404 && purged.shares.people.length === 0 && purged.shares.links.length === 0, purged);
  let listed = (await srv.ask('GET', '/notes', undefined, s)).json;
  check('la lista marca qué notas de la carpeta siguen en claro', listed.filter((n) => n.path.startsWith('secreta/')).every((n) => !n.v) && listed.length === 3, listed);

  // ---------- Coherencia: adentro solo cifrado, afuera nunca ----------
  const sealedDiario = await Z.seal(made.key, 'secreta/diario.md', SECRET);
  const inPlain = await put('secreta/nueva.md', 'en claro'); const outSealed = await put('abierta/colada.md', sealedDiario); const junk = await put('secreta/rota.md', 'vault1:%%%');
  check('adentro no acepta texto en claro, afuera no acepta texto cifrado, y uno mal armado tampoco', inPlain.status === 409 && inPlain.json.error === 'vault' && outSealed.status === 409 && outSealed.json.error === 'vault_text' && junk.status === 400, [inPlain.json, outSealed.json, junk.json]);
  const okSealed = await put('secreta/diario.md', sealedDiario);
  await put('secreta/sub/lista.md', await Z.seal(made.key, 'secreta/sub/lista.md', '- berenjena-lista'));
  listed = (await srv.ask('GET', '/notes', undefined, s)).json;
  const back = (await get('secreta/diario.md')).json.text;
  check('la nota cifrada se guarda tal como llega y la app la vuelve a abrir', okSealed.status === 200 && okSealed.json.size === Buffer.byteLength(SECRET) && back === sealedDiario && (await Z.open(made.key, 'secreta/diario.md', back)) === SECRET && listed.filter((n) => n.v).length === 2, [okSealed.json, listed]);
  check('cifrar una nota no deja su versión en claro en el historial', (await srv.ask('GET', '/versions/' + enc('secreta/diario.md'), undefined, s)).json.length === 0);
  const big = await put('secreta/grande.md', await Z.seal(made.key, 'secreta/grande.md', 'a'.repeat(1024 * 1024 + 1)));
  check('el límite de 1 MB vale también para lo cifrado', big.status === 413, big.json);
  check('en el disco ya no queda el texto de las notas protegidas, ni en la base ni en su WAL', !onDisk(data, 'berenjena-7') && !onDisk(data, 'berenjena-0') && !onDisk(data, 'berenjena-lista') && !onDisk(data, 'berenjena-cita') && onDisk(data, 'pepino'));

  // ---------- Bloqueada: nada la lee ----------
  check('búsqueda de la app: las notas protegidas quedan afuera', (await srv.ask('GET', '/search?q=berenjena', undefined, s)).json.length === 0 && (await srv.ask('GET', '/search?q=diario', undefined, s)).json.length === 0 && (await srv.ask('GET', '/search?q=pepino', undefined, s)).json.length === 1);
  const sh1 = await srv.ask('POST', '/shares', { path: 'secreta/diario.md', email: 'beto@ejemplo.test', role: 'view' }, s); const sh2 = await srv.ask('POST', '/shares', { path: 'secreta', kind: 'folder', email: 'beto@ejemplo.test', role: 'view' }, s);
  const ln = await srv.ask('POST', '/links', { path: 'secreta/diario.md' }, s); const cm = await srv.ask('POST', '/comments', { path: 'secreta/diario.md', quote: 'x', text: 'y' }, s);
  check('compartir, enlace público y comentarios responden 409 vault', [sh1, sh2, ln, cm].every((r) => r.status === 409 && r.json.error === 'vault'), [sh1.json, sh2.json, ln.json, cm.json]);
  // Una carpeta de más arriba compartida antes no abre lo que tiene una protegida adentro.
  await put('caja/suelta.md', 'suelta'); await put('caja/dentro/x.md', 'tomate-en-claro');
  await srv.ask('POST', '/shares', { path: 'caja', kind: 'folder', email: 'beto@ejemplo.test', role: 'edit' }, s);
  const K2 = Z.newKey(); const made2 = await Z.derive(K2);
  const V2 = (await srv.ask('POST', '/vaults', { folder: 'caja/dentro', ...(await Z.wrap(K2, 'otra contraseña larga')), check: made2.check }, s)).json;
  await put('caja/dentro/x.md', await Z.seal(made2.key, 'caja/dentro/x.md', 'tomate-en-claro'));
  const seen = (await srv.ask('GET', '/shared', undefined, b)).json.map((n) => n.path);
  const viaShare = [await get('caja/dentro/x.md', b, owner), await srv.ask('PUT', '/notes/' + enc('caja/dentro/x.md') + '?o=' + owner, { text: 'pisada' }, b), await srv.ask('GET', '/events?path=' + enc('caja/dentro/x.md') + '&o=' + owner, undefined, b)];
  check('otra cuenta no entra por una carpeta compartida de más arriba', seen.join() === 'caja/suelta.md' && viaShare.every((r) => r.status === 403) && (await get('caja/suelta.md', b, owner)).status === 200, [seen, viaShare.map((r) => r.status)]);
  check('otra cuenta no ve las carpetas protegidas de esta', (await srv.ask('GET', '/vaults', undefined, b)).json.length === 0 && (await srv.ask('POST', '/vaults/' + V.id + '/lock', {}, b)).status === 404);

  const ln1 = await tool(full, 'list_notes'); const lf1 = await tool(full, 'list_folders');
  const dn = ln1.v.find((n) => n.path === 'secreta/diario.md'); const un = ln1.v.find((n) => n.path === 'abierta/uno.md');
  check('MCP: list_notes muestra que la nota existe, protegida y bloqueada', dn && dn.protected === true && dn.locked === true && un.protected === undefined, ln1.v);
  check('MCP: list_folders marca la carpeta y lo que tiene adentro', lf1.v.find((f) => f.folder === 'secreta').locked === true && lf1.v.find((f) => f.folder === 'secreta/sub').protected === true && lf1.v.find((f) => f.folder === 'abierta').protected === undefined && lf1.v.find((f) => f.folder === 'caja/dentro').locked === true, lf1.v);
  const rd = await tool(full, 'read_note', { path: 'secreta/diario.md' }); const wr = await tool(full, 'write_note', { path: 'secreta/diario.md', text: 'pisada por la IA' }); const nw = await tool(full, 'write_note', { path: 'secreta/ia.md', text: 'nueva' }); const ap = await tool(full, 'append_note', { path: 'secreta/diario.md', text: 'agregado' });
  const tells = (r) => r.err && /protected with a password/.test(r.raw) && /Unlock for the AI/.test(r.raw) && /right-click the folder/.test(r.raw) && !/vault1:/.test(r.raw) && !/berenjena/.test(r.raw);
  check('MCP: leer, escribir y agregar en una carpeta bloqueada responden con el aviso para la IA', tells(rd) && tells(wr) && tells(nw) && tells(ap), [rd.raw, wr.raw, nw.raw, ap.raw]);
  check('MCP: nada cambió en la carpeta bloqueada', (await get('secreta/diario.md')).json.text === sealedDiario && (await get('secreta/ia.md')).status === 404);
  const se = await tool(full, 'search_notes', { query: 'berenjena' }); const sn = await tool(full, 'search_notes', { query: 'diario' });
  check('MCP: la búsqueda no entra a la carpeta bloqueada, y lo dice', se.v.results.length === 0 && se.v.locked_folders.join() === 'caja/dentro,secreta' && /Unlock for the AI/.test(se.v.note) && sn.v.results.length === 1 && sn.v.results[0].locked === true && sn.v.results[0].hits.length === 0 && !/vault1:|berenjena/.test(se.raw + sn.raw), [se.v, sn.v]);
  const other = await tool(tAbierta, 'read_note', { path: 'secreta/diario.md' }); const otherList = await tool(tAbierta, 'list_folders');
  check('MCP: un token de otra carpeta ni la ve ni la lee', other.err && /only reaches the folder abierta/.test(other.raw) && otherList.v.map((f) => f.folder).join() === 'abierta' && (await tool(tAbierta, 'search_notes', { query: 'diario' })).v.length === 0, [other.raw, otherList.v]);

  // ---------- Desbloquear para la IA ----------
  const Kb64 = Z.b64(K);
  const unlock = (id, key, minutes, auth) => srv.ask('POST', '/vaults/' + id + '/unlock', { key, minutes }, auth || s);
  const wrongKey = await unlock(V.id, Z.b64(K2), 15); const shortKey = await unlock(V.id, 'abcd', 15); const badMin = await unlock(V.id, Kb64, 7);
  check('una llave equivocada no desbloquea', wrongKey.status === 403 && wrongKey.json.error === 'bad_key' && shortKey.status === 403 && badMin.status === 400 && (await tool(full, 'read_note', { path: 'secreta/diario.md' })).err && (await srv.ask('GET', '/vaults', undefined, s)).json.every((v) => v.ai === null), [wrongKey.json, shortKey.json, badMin.json]);
  // En vivo: la app se entera de cada cambio de estado.
  const ctrl = new AbortController(); let got = '';
  const stream = await fetch(srv.base + '/events?path=' + enc('abierta/uno.md'), { headers: { authorization: 'Bearer ' + s }, signal: ctrl.signal });
  const reader = stream.body.getReader(); const dec = new TextDecoder();
  const pump = (async () => { try { for (;;) { const r = await reader.read(); if (r.done) break; got += dec.decode(r.value); } } catch (e) { /* cortado a propósito */ } })();
  const vaultEvents = () => (got.match(/"type":"vault"/g) || []).length;
  await wait(150);
  const t0 = Date.now(); const opened = await unlock(V.id, Kb64, 60);
  check('desbloquear con la llave correcta: el servidor dice hasta cuándo', opened.status === 200 && opened.json.ai && Math.abs(opened.json.ai.until - (t0 + 60 * 100)) < 1500 && JSON.stringify(opened.json).indexOf(Kb64) === -1, opened.json);
  const rd2 = await tool(full, 'read_note', { path: 'secreta/diario.md' });
  check('MCP: con la carpeta desbloqueada lee el texto', !rd2.err && rd2.v === SECRET, rd2.raw);
  await tool(full, 'write_note', { path: 'secreta/ia.md', text: '# De la IA\n\nEscrito con la carpeta abierta, rabanito.' }); await tool(full, 'append_note', { path: 'secreta/diario.md', text: 'Agregado por la IA.' });
  const iaRaw = (await get('secreta/ia.md')).json.text; const diarioRaw = (await get('secreta/diario.md')).json.text;
  check('MCP: lo que escribe queda cifrado en el mismo formato, y la app lo abre', iaRaw.startsWith('vault1:') && (await Z.open(made.key, 'secreta/ia.md', iaRaw)) === '# De la IA\n\nEscrito con la carpeta abierta, rabanito.' && (await Z.open(made.key, 'secreta/diario.md', diarioRaw)) === SECRET + '\n\nAgregado por la IA.' && !onDisk(data, 'rabanito'), iaRaw.slice(0, 40));
  const se2 = await tool(full, 'search_notes', { query: 'berenjena' }); const ln2 = await tool(full, 'list_notes', { folder: 'secreta' });
  check('MCP: la búsqueda entra a la desbloqueada y sigue sin entrar a la otra', se2.v.results.some((r) => r.path === 'secreta/diario.md' && r.hits.length === 1) && se2.v.locked_folders.join() === 'caja/dentro' && ln2.v.every((n) => n.protected === true && n.locked === false), [se2.v, ln2.v]);
  check('MCP: la otra carpeta protegida sigue bloqueada', (await tool(full, 'read_note', { path: 'caja/dentro/x.md' })).err);
  check('token de carpeta: uno de la carpeta protegida lee; uno de otra carpeta, no', (await tool(tSecreta, 'read_note', { path: 'secreta/ia.md' })).v.includes('rabanito') && (await tool(tAbierta, 'read_note', { path: 'secreta/ia.md' })).err && (await tool(tAbierta, 'search_notes', { query: 'rabanito' })).v.length === 0);
  const sub = await tool(tSub, 'read_note', { path: 'secreta/sub/lista.md' });
  check('token de carpeta: si la carpeta protegida no entra entera en su alcance, no se beneficia', sub.err && /Unlock for the AI/.test(sub.raw) && !/berenjena/.test(sub.raw), sub.raw);
  check('la búsqueda de la app sigue sin entrar aunque esté desbloqueada para la IA', (await srv.ask('GET', '/search?q=rabanito', undefined, s)).json.length === 0);
  check('la llave no se escribe en el disco ni en el registro', !onDisk(data, Kb64) && !onDisk(data, Buffer.from(K)) && !onDisk(data, Buffer.from(K).toString('hex')) && !srv.log().includes(Kb64) && !srv.log().includes(Buffer.from(K).toString('hex')));

  // Un texto cifrado no se puede mover a otra ruta: ni la app ni el servidor lo abren ahí.
  await put('secreta/copia.md', diarioRaw);
  const moved = await tool(full, 'read_note', { path: 'secreta/copia.md' }); let appOpens = true; try { await Z.open(made.key, 'secreta/copia.md', diarioRaw); } catch (e) { appOpens = e.code !== 'vault_unreadable'; }
  check('un texto cifrado puesto en otra ruta no abre', moved.err && /could not be decrypted/.test(moved.raw) && !/berenjena/.test(moved.raw) && appOpens === false, moved.raw);
  await srv.ask('DELETE', '/notes/' + enc('secreta/copia.md'), undefined, s);
  const noText = await srv.ask('POST', '/rename', { from: 'secreta/ia.md', to: 'secreta/ia2.md' }, s); const outNoText = await srv.ask('POST', '/rename', { from: 'secreta/ia.md', to: 'abierta/ia.md' }, s);
  const wrongKind = await srv.ask('POST', '/rename', { from: 'secreta/ia.md', to: 'abierta/ia.md', text: iaRaw }, s); const inPlainMove = await srv.ask('POST', '/rename', { from: 'abierta/uno.md', to: 'secreta/uno.md', text: 'en claro' }, s);
  check('renombrar o mover sin volver a cifrar no pasa', noText.status === 409 && noText.json.error === 'vault' && outNoText.status === 409 && wrongKind.status === 409 && wrongKind.json.error === 'vault_text' && inPlainMove.status === 409 && inPlainMove.json.error === 'vault', [noText.json, outNoText.json, wrongKind.json, inPlainMove.json]);
  // Historial: versiones cifradas, que siguen a la nota al renombrarla dentro de la carpeta.
  await put('secreta/ia.md', await Z.seal(made.key, 'secreta/ia.md', 'Segunda versión.'));
  const stale = await srv.ask('POST', '/rename', { from: 'secreta/ia.md', to: 'secreta/ia2.md', text: await Z.seal(made.key, 'secreta/ia2.md', 'Segunda versión.'), updated: 5 }, s);
  const ren = await srv.ask('POST', '/rename', { from: 'secreta/ia.md', to: 'secreta/ia2.md', text: await Z.seal(made.key, 'secreta/ia2.md', 'Segunda versión.'), updated: (await get('secreta/ia.md')).json.updated }, s);
  const vers = (await srv.ask('GET', '/versions/' + enc('secreta/ia2.md'), undefined, s)).json; const ver = vers.length ? (await srv.ask('GET', '/version/' + vers[0].id, undefined, s)).json : {};
  check('mover dentro de la carpeta: llega cifrado para la ruta nueva, no pisa un cambio ajeno y el historial sigue cifrado', stale.status === 409 && stale.json.error === 'changed' && ren.status === 200 && vers.length === 1 && ver.aad === 'secreta/ia.md' && ver.text.startsWith('vault1:') && (await Z.open(made.key, ver.aad, ver.text)).includes('rabanito') && (await tool(full, 'read_note', { path: 'secreta/ia2.md' })).v === 'Segunda versión.', [stale.json, ren.json, vers, ver.aad]);
  const out = await srv.ask('POST', '/rename', { from: 'secreta/ia2.md', to: 'abierta/ia.md', text: 'Segunda versión.' }, s);
  check('sacar una nota de la carpeta la deja en claro y sin su historial cifrado', out.status === 200 && (await get('abierta/ia.md')).json.text === 'Segunda versión.' && (await srv.ask('GET', '/versions/' + enc('abierta/ia.md'), undefined, s)).json.length === 0 && (await tool(tAbierta, 'read_note', { path: 'abierta/ia.md' })).v === 'Segunda versión.');
  await srv.ask('POST', '/comments', { path: 'abierta/ia.md', quote: 'Segunda', text: 'comentario' }, s); const lk = (await srv.ask('POST', '/links', { path: 'abierta/ia.md' }, s)).json.token;
  const into = await srv.ask('POST', '/rename', { from: 'abierta/ia.md', to: 'secreta/ia.md', text: await Z.seal(made.key, 'secreta/ia.md', 'Segunda versión.') }, s);
  check('meter una nota en la carpeta la cifra y le saca comentarios y enlaces', into.status === 200 && (await get('secreta/ia.md')).json.text.startsWith('vault1:') && (await srv.ask('GET', '/comments?all=1', undefined, s)).json.length === 0 && (await srv.ask('GET', '/public/' + lk)).status === 404 && !onDisk(data, 'Segunda versión.'));

  // Bloquear a mano, vencer el plazo y reiniciar el servidor olvidan la llave.
  const locked = await srv.ask('POST', '/vaults/' + V.id + '/lock', {}, s);
  check('bloquear a mano la olvida', locked.json.ai === null && (await tool(full, 'read_note', { path: 'secreta/diario.md' })).err);
  await unlock(V.id, Kb64, 15); const during = !(await tool(full, 'read_note', { path: 'secreta/diario.md' })).err; const before = vaultEvents();
  await wait(1900);
  const after = await tool(full, 'read_note', { path: 'secreta/diario.md' });
  check('el desbloqueo vence solo', during && tells(after) && (await srv.ask('GET', '/vaults', undefined, s)).json.find((v) => v.id === V.id).ai === null, after.raw);
  check('cada cambio de estado avisa por el canal de eventos, también al vencer', before === 3 && vaultEvents() === before + 1, [before, vaultEvents()]);
  ctrl.abort(); await pump;
  const forever = await unlock(V.id, Kb64, 0);
  check('"hasta bloquear" no tiene vencimiento', forever.json.ai && forever.json.ai.until === 0 && !(await tool(full, 'read_note', { path: 'secreta/diario.md' })).err);
  const free = await unlock((await srv.ask('POST', '/vaults', { folder: 'de-beto', ...(await Z.wrap(K2, 'la de beto, bien larga')), check: made2.check }, b)).json.id, Z.b64(K2), 15, b);
  check('la carpeta protegida está en el plan gratis, y desbloquearla para la IA también: va con el MCP', free.status === 200 && !!free.json.ai && (await srv.ask('GET', '/vaults', undefined, b)).json.length === 1, free.json);
  await srv.stop();
  srv = await boot(data, {});
  const afterRestart = await tool(full, 'read_note', { path: 'secreta/diario.md' });
  check('reiniciar el servidor la bloquea', tells(afterRestart) && (await srv.ask('GET', '/vaults', undefined, s)).json.every((v) => v.ai === null) && !onDisk(data, Kb64) && !onDisk(data, Buffer.from(K)), afterRestart.raw);
  for (let i = 0; i < 10; i++) await unlock(V.id, Z.b64(K2), 15);
  const capped = await unlock(V.id, Kb64, 15);
  check('diez llaves equivocadas por hora y se corta', capped.status === 429 && capped.json.error === 'too_many' && capped.json.retry_after > 0, capped.json);

  // ---------- Cambiar la contraseña y quitar la protección ----------
  const rewrapped = await Z.wrap(K, 'una contraseña nueva y larga');
  const rw = await srv.ask('PUT', '/vaults/' + V.id, rewrapped, s); const nowV = (await srv.ask('GET', '/vaults', undefined, s)).json.find((v) => v.id === V.id);
  let oldFails = false; try { await Z.unwrap(nowV, PASSWORD); } catch (e) { oldFails = e.code === 'bad_password'; }
  check('cambiar la contraseña vuelve a envolver la misma llave: las notas no se tocan', rw.status === 200 && nowV.check === made.check && Buffer.from(await Z.unwrap(nowV, 'una contraseña nueva y larga')).equals(Buffer.from(K)) && oldFails && (await Z.open(made.key, 'secreta/diario.md', (await get('secreta/diario.md')).json.text)).includes('berenjena-7'));
  const early = await srv.ask('DELETE', '/vaults/' + V.id, undefined, s);
  const opening = await srv.ask('POST', '/vaults/' + V.id + '/open', {}, s);
  check('quitar la protección: no se borra con notas cifradas adentro, y al empezar deja de servir para la IA', early.status === 409 && early.json.error === 'vault_not_empty' && opening.json.state === 'opening' && (await tool(full, 'read_note', { path: 'secreta/diario.md' })).err && (await srv.ask('POST', '/vaults/' + V.id + '/unlock', { key: Kb64, minutes: 15 }, s)).status !== 200);
  for (const n of (await srv.ask('GET', '/notes', undefined, s)).json.filter((x) => x.v && x.path.startsWith('secreta/'))) await put(n.path, await Z.open(made.key, n.path, (await get(n.path)).json.text));
  const removed = await srv.ask('DELETE', '/vaults/' + V.id, undefined, s);
  const plainAgain = await tool(full, 'read_note', { path: 'secreta/diario.md' });
  check('quitar la protección: con todo descifrado se borra y la carpeta vuelve a ser común', removed.status === 200 && !plainAgain.err && plainAgain.v.includes('berenjena-7') && (await srv.ask('GET', '/vaults', undefined, s)).json.length === 1 && (await srv.ask('GET', '/versions/' + enc('secreta/diario.md'), undefined, s)).json.length === 0 && (await srv.ask('GET', '/search?q=berenjena-7', undefined, s)).json.length === 1, [removed.json, plainAgain.raw]);

  // ---------- El aviso de la primera nota en la nube: se anota por cuenta ----------
  const c = await srv.enter('cora@ejemplo.test', true);
  const acct = async (auth) => (await srv.ask('GET', '/account', undefined, auth)).json;
  const d = await srv.enter('dina@ejemplo.test', false);
  const seen0 = (await acct(c)).protect_seen; const marked = await srv.ask('POST', '/account/protect-seen', {}, c);
  check('el aviso: una cuenta nueva no lo vio, al marcarlo queda anotado en esa cuenta y no en otra', seen0 === false && marked.status === 200 && (await acct(c)).protect_seen === true && (await acct(d)).protect_seen === false && (await srv.ask('POST', '/account/protect-seen', {})).status === 401, [seen0, marked.json]);
  check('el aviso: haber protegido una carpeta lo da por visto', (await acct(s)).protect_seen === true && (await acct(b)).protect_seen === true);

  // ---------- Toda la nube de una cuenta, con una sola contraseña ----------
  await put('raiz.md', '# Raíz\n\nPrimera versión, zanahoria-0.', c); await put('raiz.md', '# Raíz\n\nEl secreto es zanahoria-raiz.', c); await put('dir/hoja.md', '- zanahoria-hoja', c);
  await srv.ask('POST', '/shares', { path: 'raiz.md', email: 'beto@ejemplo.test', role: 'view' }, c);
  await srv.ask('POST', '/comments', { path: 'raiz.md', quote: 'zanahoria-cita', text: 'Cambiá esto' }, c);
  const cLink = (await srv.ask('POST', '/links', { path: 'dir/hoja.md' }, c)).json.token;
  const cFull = (await srv.ask('POST', '/tokens', { name: 'todo' }, c)).json.token; const cDir = (await srv.ask('POST', '/tokens', { name: 'dir', folder: 'dir' }, c)).json.token;
  const K3 = Z.newKey(); const made3 = await Z.derive(K3); const w3 = await Z.wrap(K3, PASSWORD);
  const overFolders = await srv.ask('POST', '/vaults', { root: true, ...w3, check: made3.check }, s);
  const all3 = await srv.ask('POST', '/vaults', { root: true, ...w3, check: made3.check }, c); const V3 = all3.json;
  check('toda la nube: se crea sobre la raíz, y no encima de carpetas que ya tienen su contraseña', all3.status === 200 && V3.folder === '' && V3.root === true && V3.state === 'on' && overFolders.status === 409 && overFolders.json.error === 'vault_nested', [all3.json, overFolders.json]);
  check('toda la nube: adentro no va otra carpeta protegida, ni una segunda raíz', (await srv.ask('POST', '/vaults', { folder: 'dir', ...w3, check: made3.check }, c)).json.error === 'vault_nested' && (await srv.ask('POST', '/vaults', { root: true, ...w3, check: made3.check }, c)).json.error === 'vault_nested');
  check('toda la nube: se van lo compartido, el enlace público, los comentarios y el historial anterior', (await srv.ask('GET', '/shares', undefined, c)).json.people.length === 0 && (await srv.ask('GET', '/public/' + cLink)).status === 404 && (await srv.ask('GET', '/comments?all=1', undefined, c)).json.length === 0 && (await srv.ask('GET', '/versions/' + enc('raiz.md'), undefined, c)).json.length === 0);
  const clear3 = await put('nueva.md', '# En claro', c); const clear4 = await put('dir/otra.md', '# En claro', c);
  check('toda la nube: el servidor ya no acepta texto en claro, ni en la raíz ni en una carpeta', clear3.status === 409 && clear3.json.error === 'vault' && clear4.status === 409, [clear3.json, clear4.json]);
  // Lo que ya había lo cifra el navegador, nota por nota; acá se hace lo mismo con la llave.
  for (const [p, text] of [['raiz.md', '# Raíz\n\nEl secreto es zanahoria-raiz.'], ['dir/hoja.md', '- zanahoria-hoja'], ['nueva.md', '# Nueva\n\nzanahoria-nueva']]) await put(p, await Z.seal(made3.key, p, text), c);
  const list3 = (await srv.ask('GET', '/notes', undefined, c)).json;
  check('toda la nube: cifradas las que había y la nueva, el disco no guarda su texto', list3.length === 3 && list3.every((n) => n.v === 1) && !onDisk(data, 'zanahoria-raiz') && !onDisk(data, 'zanahoria-0') && !onDisk(data, 'zanahoria-hoja') && !onDisk(data, 'zanahoria-nueva') && !onDisk(data, 'zanahoria-cita') && onDisk(data, 'pepino'), list3);
  check('toda la nube: no se comparte, no lleva enlace público ni comentarios para la IA', (await srv.ask('POST', '/shares', { path: 'raiz.md', email: 'beto@ejemplo.test', role: 'view' }, c)).status === 409 && (await srv.ask('POST', '/shares', { path: 'dir', kind: 'folder', email: 'beto@ejemplo.test', role: 'view' }, c)).status === 409 &&
    (await srv.ask('POST', '/links', { path: 'raiz.md' }, c)).status === 409 && (await srv.ask('POST', '/comments', { path: 'raiz.md', quote: 'x', text: 'y' }, c)).status === 409);
  const r3 = await tool(cFull, 'read_note', { path: 'raiz.md' }); const w3n = await tool(cFull, 'write_note', { path: 'ia.md', text: 'desde la IA' }); const s3 = await tool(cFull, 'search_notes', { query: 'zanahoria' }); const l3 = await tool(cFull, 'list_notes', {});
  check('toda la nube, MCP bloqueado: no lee, no escribe, no busca, y dice cómo desbloquear', r3.err && /All the notes of this account are protected with a password and are locked/.test(r3.raw) && /Unlock for the AI/.test(r3.raw) && w3n.err && s3.v.locked_folders.join() === '/' && s3.v.results.every((x) => !x.hits.length) && l3.v.length === 3 && l3.v.every((n) => n.protected === true && n.locked === true), [r3.raw, s3.v, l3.v]);
  const badKey = await srv.ask('POST', '/vaults/' + V3.id + '/unlock', { key: Z.b64(Z.newKey()), minutes: 15 }, c);
  const un3 = await srv.ask('POST', '/vaults/' + V3.id + '/unlock', { key: Z.b64(K3), minutes: 15 }, c);
  const r3b = await tool(cFull, 'read_note', { path: 'raiz.md' }); await tool(cFull, 'write_note', { path: 'ia.md', text: 'desde la IA, zanahoria-ia' }); const s3b = await tool(cFull, 'search_notes', { query: 'zanahoria-hoja' });
  const iaRaw3 = (await get('ia.md', c)).json.text; const scoped3 = await tool(cDir, 'read_note', { path: 'dir/hoja.md' });
  check('toda la nube, desbloqueada para la IA: lee, busca y lo que escribe queda cifrado; con otra llave no se desbloquea', badKey.status === 403 && un3.status === 200 && !!un3.json.ai && !r3b.err && /zanahoria-raiz/.test(r3b.raw) && s3b.v.some((x) => x.path === 'dir/hoja.md') && iaRaw3.startsWith('vault1:') && (await Z.open(made3.key, 'ia.md', iaRaw3)) === 'desde la IA, zanahoria-ia' && !onDisk(data, 'zanahoria-ia'), [badKey.json, r3b.raw, s3b.v]);
  check('toda la nube: un token limitado a una carpeta no la alcanza ni desbloqueada', scoped3.err && /locked/.test(scoped3.raw), scoped3.raw);
  await srv.ask('POST', '/vaults/' + V3.id + '/lock', {}, c);
  check('toda la nube: al bloquear, la IA deja de leer', (await tool(cFull, 'read_note', { path: 'raiz.md' })).err && (await srv.ask('GET', '/vaults', undefined, c)).json[0].ai === null);
  const wrongWord = await srv.ask('POST', '/vaults/' + V3.id + '/destroy', { folder: '' }, c); const wrongMail = await srv.ask('POST', '/vaults/' + V3.id + '/destroy', { confirm: 'ana@ejemplo.test' }, c);
  const wiped = await srv.ask('POST', '/vaults/' + V3.id + '/destroy', { confirm: 'cora@ejemplo.test' }, c);
  check('toda la nube: sin llave solo queda eliminar todo, y se confirma con el correo de la cuenta', wrongWord.status === 400 && wrongMail.status === 400 && wrongMail.json.error === 'bad_confirm' && wiped.status === 200 && wiped.json.notes === 4 && (await srv.ask('GET', '/notes', undefined, c)).json.length === 0 && (await srv.ask('GET', '/vaults', undefined, c)).json.length === 0 && (await put('libre.md', '# Libre', c)).status === 200, [wrongWord.json, wrongMail.json, wiped.json]);
  check('toda la nube: lo de otra cuenta no se tocó', (await get('abierta/uno.md')).json.text.includes('pepino') && (await srv.ask('GET', '/vaults', undefined, s)).json.length === 1);
  await srv.stop();

  // ---------- Con cifrado en reposo además ----------
  srv = await boot(data, { DATA_KEY: Buffer.alloc(32, 3).toString('base64') });
  const raw2 = (await get('caja/dentro/x.md')).json.text;
  await srv.ask('POST', '/vaults/' + V2.id + '/unlock', { key: Z.b64(K2), minutes: 15 }, s);
  const both = await tool(full, 'read_note', { path: 'caja/dentro/x.md' });
  await tool(full, 'write_note', { path: 'caja/dentro/y.md', text: 'tomate-dos' });
  check('con DATA_KEY las dos capas conviven: la nota protegida se lee y se escribe igual', raw2.startsWith('vault1:') && (await Z.open(made2.key, 'caja/dentro/x.md', raw2)) === 'tomate-en-claro' && both.v === 'tomate-en-claro' && (await Z.open(made2.key, 'caja/dentro/y.md', (await get('caja/dentro/y.md')).json.text)) === 'tomate-dos' && !onDisk(data, 'vault1:'), both.raw);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(srv.log()); }
await srv.stop();
fs.rmSync(data, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log('\n' + (results.length - failed) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed ? 1 : 0);
