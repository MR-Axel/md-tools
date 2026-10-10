'use strict';
// La API de verdad, escuchando en un puerto libre, con una maquina de mentira
// detras: nada de lo que se "cierra" aca es un proceso real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { create } = require('../src/server');
const servers = require('../src/servers');
const security = require('../src/security');
const config = require('../src/config');
const win = require('../src/platform/windows');

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function machine() {
  const state = { killed: [], procs: win.parseProcs(fx('procs.json')), listeners: win.parseNetstat(fx('netstat-en.txt')) };
  const platform = {
    listeners: async () => state.listeners.slice(), processes: async () => state.procs.slice(),
    killTree: async (pid) => { state.killed.push(pid); state.listeners = state.listeners.filter((l) => l.pid !== pid); state.procs = state.procs.filter((p) => p.pid !== pid); },
    stop: () => {}, capabilities: () => ({ cwd: true }),
  };
  const env = servers.environment('win32');
  const marks = ['c:\\users\\sam\\code\\notes-app\\.git', 'c:\\users\\sam\\code\\site\\.git'];
  Object.assign(env, { home: 'C:\\Users\\sam', selfPid: 999999, osDirs: ['C:' + env.P.sep + 'Windows'], systemDirs: ['C:\\Windows', 'C:\\Program Files', 'C:\\Users\\sam\\AppData'], exists: (p) => marks.includes(p.toLowerCase()), readJson: () => null });
  return { state, platform, env };
}

async function start(extra) {
  const m = machine();
  const cfg = Object.assign(JSON.parse(JSON.stringify(config.DEFAULTS)), { port: 0, probeHttp: false, origins: ['https://sharpmd.app'] }, extra || {});
  const app = create({ cfg, token: TOKEN, platform: m.platform, env: m.env, fixed: true });
  const port = await app.listen();
  // Un pedido crudo: los encabezados van tal cual se escriben, incluido Host.
  const call = (method, url, headers, body) => new Promise((resolve, reject) => {
    const h = Object.assign({ Host: '127.0.0.1:' + port }, headers || {});
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: h, setHost: false }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
  const auth = { Authorization: 'Bearer ' + TOKEN };
  return { app, port, call, auth, state: m.state, json: Object.assign({ 'Content-Type': 'application/json' }, auth) };
}

test('sin token no se lee nada', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  for (const url of ['/v1/status', '/v1/servers', '/v1/agents', '/v1/worktrees']) {
    const r = await s.call('GET', url);
    assert.equal(r.status, 401, url);
    assert.deepEqual(r.json, { error: 'token' });
  }
  assert.equal((await s.call('GET', '/v1/servers', { Authorization: 'Bearer ' + TOKEN.replace('test', 'tost') })).status, 401);
  assert.equal((await s.call('GET', '/v1/servers', { Authorization: TOKEN })).status, 401);
  // En la URL no vale.
  assert.equal((await s.call('GET', '/v1/servers?token=' + TOKEN)).status, 401);
  assert.equal((await s.call('GET', '/v1/servers', s.auth)).status, 200);
});

test('sin token no se cierra nada', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  const r = await s.call('POST', '/v1/servers/close', { 'Content-Type': 'application/json' }, { pid: 4242, port: 5173, started: '2025-09-01T10:20:30.0000000Z' });
  assert.equal(r.status, 401);
  assert.deepEqual(s.state.killed, []);
});

test('Host ajeno (DNS rebinding): rechazado aunque traiga el token', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  for (const host of ['evil.example', 'evil.example:' + s.port, '127.0.0.1.evil.example:' + s.port, '127.0.0.1:1', '192.168.0.14:' + s.port, '']) {
    const r = await s.call('GET', '/v1/servers', Object.assign({}, s.auth, { Host: host }));
    assert.equal(r.status, 421, 'Host: ' + host);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  // El panel tampoco se sirve con otro nombre.
  assert.equal((await s.call('GET', '/', { Host: 'evil.example:' + s.port })).status, 421);
  assert.equal((await s.call('GET', '/v1/servers', Object.assign({}, s.auth, { Host: 'localhost:' + s.port }))).status, 200);
});

test('Origin ajeno: rechazado aunque traiga el token, y sin encabezados CORS', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  for (const origin of ['https://evil.example', 'http://sharpmd.app', 'https://sharpmd.app.evil.example', 'https://sub.sharpmd.app', 'null', 'http://127.0.0.1:1', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
    const r = await s.call('GET', '/v1/servers', Object.assign({}, s.auth, { Origin: origin }));
    assert.equal(r.status, 403, 'Origin: ' + origin);
    assert.deepEqual(r.json, { error: 'origin' });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  const ok = await s.call('GET', '/v1/servers', Object.assign({}, s.auth, { Origin: 'https://sharpmd.app' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://sharpmd.app');
  assert.equal(ok.headers.vary, 'Origin');
  // Un navegador que viene de otro sitio sin decir de donde.
  assert.equal((await s.call('GET', '/v1/servers', Object.assign({}, s.auth, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
});

test('la pregunta previa (preflight) solo se le contesta a la lista', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  const ask = { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
  const no = await s.call('OPTIONS', '/v1/servers/close', Object.assign({ Origin: 'https://evil.example' }, ask));
  assert.equal(no.status, 403);
  assert.equal(no.headers['access-control-allow-origin'], undefined);
  assert.equal(no.headers['access-control-allow-headers'], undefined);
  const yes = await s.call('OPTIONS', '/v1/servers/close', Object.assign({ Origin: 'https://sharpmd.app', 'Access-Control-Request-Private-Network': 'true' }, ask));
  assert.equal(yes.status, 204);
  assert.equal(yes.headers['access-control-allow-origin'], 'https://sharpmd.app');
  assert.equal(yes.headers['access-control-allow-methods'], 'GET, POST');
  assert.equal(yes.headers['access-control-allow-headers'], 'authorization, content-type');
  assert.equal(yes.headers['access-control-allow-private-network'], 'true');
  // Nunca un comodin ni credenciales.
  assert.equal(yes.headers['access-control-allow-credentials'], undefined);
  assert.equal((await s.call('OPTIONS', '/v1/servers/close', ask)).status, 403);
  assert.equal((await s.call('OPTIONS', '/v1/servers', Object.assign({ Origin: 'https://sharpmd.app', Host: 'evil.example' }, ask))).status, 421);
});

test('cerrar: solo lo de desarrollo, y solo si sigue siendo el mismo proceso', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  const list = (await s.call('GET', '/v1/servers', s.auth)).json.servers;
  const vite = list.find((r) => r.port === 5173); const sys = list.find((r) => r.port === 445); const rpc = list.find((r) => r.port === 135);
  assert.deepEqual([vite.kind, vite.closable, sys.kind, sys.closable], ['dev', true, 'system', false]);
  const close = (body, headers) => s.call('POST', '/v1/servers/close', headers || s.json, body);
  // Del sistema: no, aunque se mande todo bien.
  assert.equal((await close({ pid: sys.pid, port: 445, started: sys.started })).status, 403);
  assert.equal((await close({ pid: rpc.pid, port: 135, started: rpc.started })).status, 403);
  // Un proceso que no escucha, un puerto que no es suyo, una fecha que no coincide (el PID se reuso).
  assert.equal((await close({ pid: 7001, port: 5173, started: vite.started })).status, 404);
  assert.equal((await close({ pid: vite.pid, port: 3000, started: vite.started })).status, 404);
  assert.equal((await close({ pid: vite.pid, port: 5173, started: '2025-01-01T00:00:00.0000000Z' })).status, 403);
  // Pedidos mal formados.
  assert.equal((await close({ pid: '4242', port: 5173, started: vite.started })).status, 400);
  assert.equal((await close({ pid: vite.pid, port: 5173 })).status, 400);
  assert.equal((await close('[1,2]')).status, 400);
  assert.equal((await close('{"pid":' + '1'.repeat(3000) + '}')).status, 400);
  // Sin Content-Type JSON (lo que mandaria un formulario de otra pagina).
  assert.equal((await close({ pid: vite.pid, port: 5173, started: vite.started }, Object.assign({ 'Content-Type': 'text/plain' }, s.auth))).status, 415);
  assert.deepEqual(s.state.killed, []);
  // Y ahora si.
  const ok = await close({ pid: vite.pid, port: 5173, started: vite.started });
  assert.deepEqual([ok.status, ok.json], [200, { ok: true, pid: 4242, port: 5173 }]);
  assert.deepEqual(s.state.killed, [4242]);
  assert.equal((await s.call('GET', '/v1/servers', s.auth)).json.servers.some((r) => r.port === 5173), false);
});

test('cerrar una sesion de agente: solo una reconocida', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  const g = (await s.call('GET', '/v1/agents', s.auth)).json.agents[0];
  assert.deepEqual([g.name, g.sessions.length, g.sessions[0].closable], ['Claude Code', 1, true]);
  const close = (body) => s.call('POST', '/v1/agents/close', s.json, body);
  // La app de escritorio y un proceso cualquiera no son sesiones.
  assert.equal((await close({ pid: 4001, started: '2025-09-01T08:30:00.0000000Z' })).status, 404);
  assert.equal((await close({ pid: 7001, started: '2025-09-01T08:11:00.0000000Z' })).status, 404);
  assert.equal((await close({ pid: 4000, started: 'otra' })).status, 403);
  assert.deepEqual(s.state.killed, []);
  assert.equal((await close({ pid: 4000, started: g.sessions[0].started })).json.ok, true);
  assert.deepEqual(s.state.killed, [4000]);
});

test('solo lectura: no cierra nada ni lo ofrece', async (t) => {
  const s = await start({ allowClose: false }); t.after(() => s.app.close());
  const vite = (await s.call('GET', '/v1/servers', s.auth)).json.servers.find((r) => r.port === 5173);
  assert.equal(vite.closable, false);
  assert.equal((await s.call('POST', '/v1/servers/close', s.json, { pid: vite.pid, port: 5173, started: vite.started })).status, 403);
  assert.equal((await s.call('POST', '/v1/agents/close', s.json, { pid: 4000, started: '2025-09-01T09:00:00.0000000Z' })).status, 403);
  assert.deepEqual(s.state.killed, []);
});

test('no hay rutas de mas: ni archivos, ni comandos, ni otros verbos', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  for (const url of ['/v1/exec', '/v1/files', '/v1/servers/../../etc/passwd', '/v1/worktrees/remove', '/v1/config']) assert.equal((await s.call('GET', url, s.auth)).status, 404, url);
  for (const url of ['/..%2f..%2fpackage.json', '/panel/../server.js', '/config.json', '/token']) assert.equal((await s.call('GET', url)).status, 404, url);
  assert.equal((await s.call('DELETE', '/v1/servers', s.auth)).status, 405);
  assert.equal((await s.call('PUT', '/v1/servers/close', s.json, {})).status, 405);
  assert.equal((await s.call('POST', '/', s.json, {})).status, 405);
  // Leer con POST o cerrar con GET tampoco.
  assert.equal((await s.call('GET', '/v1/servers/close', s.auth)).status, 404);
  // Sin carpetas elegidas, Worktrees no mira nada.
  assert.deepEqual((await s.call('GET', '/v1/worktrees', s.auth)).json, { folders: 0, repos: [] });
});

test('el panel propio: sin datos adentro y sin poder embeberse', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  const r = await s.call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.text.includes(TOKEN), false);
  assert.equal((await s.call('GET', '/panel.js')).status, 200);
});

test('muchos tokens errados seguidos: se deja de contestar', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  for (let i = 0; i < 10; i++) assert.equal((await s.call('GET', '/v1/status', { Authorization: 'Bearer wrong-token-wrong-token-' + i })).status, 401);
  assert.equal((await s.call('GET', '/v1/status', { Authorization: 'Bearer wrong-token-wrong-token-x' })).status, 429);
  assert.equal((await s.call('GET', '/v1/status', s.auth)).status, 429);
});

test('las reglas, una por una', () => {
  const ctx = { port: 7717, origins: ['https://sharpmd.app'], token: TOKEN };
  const req = (method, url, headers) => ({ method, url, headers: Object.assign({ host: '127.0.0.1:7717' }, headers) });
  assert.equal(security.check(req('GET', '/v1/status', { authorization: 'Bearer ' + TOKEN }), ctx).status, 0);
  assert.equal(security.check(req('GET', '/v1/status', { authorization: 'Bearer ' + TOKEN, origin: 'http://127.0.0.1:7717' }), ctx).status, 0);
  assert.equal(security.check(req('GET', '/v1/status', { authorization: 'Bearer ' + TOKEN, host: 'LOCALHOST:7717' }), ctx).status, 0);
  assert.equal(security.check(req('GET', '/v1/status', { authorization: 'Bearer ' + TOKEN, host: '[::1]:7717' }), ctx).status, 421);
  assert.equal(security.check(req('GET', '/v1/status', {}), ctx).status, 401);
  assert.equal(security.check(req('HEAD', '/v1/status', { authorization: 'Bearer ' + TOKEN }), ctx).status, 405);
  assert.equal(security.sameToken(TOKEN, TOKEN), true);
  assert.equal(security.sameToken(TOKEN + 'x', TOKEN), false);
  assert.equal(security.sameToken('', TOKEN), false);
});
