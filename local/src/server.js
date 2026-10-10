'use strict';
// La API local. Escucha SOLO en 127.0.0.1. Cada pedido pasa primero por
// security.check (Host, Origin, token); recien despues se mira que pide.
//
// No hay ninguna ruta que ejecute un comando que venga de afuera ni que lea un
// archivo que venga de afuera: lo unico que entra por la red son un numero de
// proceso, un puerto y una fecha, y los tres se comparan contra lo que el
// programa vio por su cuenta.
const fs = require('fs');
const http = require('http');
const path = require('path');
const security = require('./security');
const servers = require('./servers');
const agents = require('./agents');
const worktrees = require('./worktrees');
const config = require('./config');
const reveal = require('./reveal');
const { NAME, CMD } = require('./name');
const VERSION = require('../package.json').version;

const PANEL = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/panel.js': ['panel.js', 'text/javascript; charset=utf-8'],
  '/panel.css': ['panel.css', 'text/css; charset=utf-8'],
};
const PANEL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function create(opts) {
  const platform = opts.platform || (process.platform === 'win32' ? require('./platform/windows') : require('./platform/posix'));
  const env = opts.env || servers.environment();
  const token = opts.token;
  let port = opts.cfg.port; // con 0 (pruebas) se sabe recien al escuchar
  const limiter = security.limiter(10, 60000);
  const log = opts.log || (() => {});

  // La configuracion se relee sola: sumar una carpeta de repos no pide reiniciar. El puerto no cambia en marcha.
  let cfg = opts.cfg; let cfgAt = Date.now();
  const settings = () => {
    if (!opts.fixed && Date.now() - cfgAt > 2000) { cfg = Object.assign(config.load(), { port }); cfgAt = Date.now(); }
    return cfg;
  };

  // Una foto de la maquina: puertos y procesos. Vale un par de segundos.
  let snap = null; let pending = null;
  function snapshot(fresh) {
    if (!fresh && snap && Date.now() - snap.at < 2500) return Promise.resolve(snap);
    if (pending && !fresh) return pending;
    const mine = Promise.all([platform.listeners(), platform.processes({ readCwd: settings().readCwd })]).then(([listeners, procs]) => {
      snap = { at: Date.now(), listeners, procs };
      if (pending === mine) pending = null;
      return snap;
    }, (e) => { if (pending === mine) pending = null; throw e; });
    pending = mine;
    return mine;
  }

  const sessionsOf = (procs) => agents.find(settings().agents, procs);
  // Lo que no se cierra nunca: este programa y quien lo lanzo (cerrarlo nos llevaria puestos).
  function untouchable(procs) {
    const by = new Map(procs.map((p) => [p.pid, p])); const set = new Set(); let at = process.pid;
    for (let i = 0; i < 30 && at && !set.has(at); i++) { set.add(at); at = (by.get(at) || {}).ppid; }
    return set;
  }
  function serverRows(s) {
    const by = new Map(s.procs.map((p) => [p.pid, p]));
    const sess = new Map(); sessionsOf(s.procs).forEach((g) => g.sessions.forEach((x) => sess.set(x.pid, g)));
    const agentOf = (pid) => { let at = pid; for (let i = 0; i < 15 && at; i++) { if (sess.has(at)) return sess.get(at); at = (by.get(at) || {}).ppid; } return null; };
    return servers.build(env, s.listeners, s.procs, agentOf);
  }

  async function closeAndWait(pid, stillThere) {
    await platform.killTree(pid);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 350));
      if (!stillThere(await snapshot(true))) return true;
    }
    return false;
  }

  const routes = {
    'GET /v1/status': async () => {
      const c = settings();
      return [200, { app: CMD, name: NAME, version: VERSION, platform: process.platform, allowClose: !!c.allowClose, allowReveal: !!c.allowReveal,
        folders: c.folders.length, agents: c.agents.filter((a) => a.on).map((a) => a.name), configError: c.error || '' }];
    },
    'GET /v1/servers': async () => {
      const s = await snapshot(false); let rows = serverRows(s);
      const safe = untouchable(s.procs);
      rows.forEach((r) => { if (safe.has(r.pid) || !settings().allowClose) r.closable = false; if (r.port === port && r.pid === process.pid) r.self = true; });
      if (settings().probeHttp) rows = await servers.withHttp(rows, port);
      return [200, { at: new Date(s.at).toISOString(), cwd: platform.capabilities().cwd, servers: rows }];
    },
    'GET /v1/agents': async () => {
      const s = await snapshot(false); const safe = untouchable(s.procs);
      const groups = agents.enrich(sessionsOf(s.procs), { titles: settings().agentTitles });
      return [200, { at: new Date(s.at).toISOString(), agents: groups.map((g) => ({
        name: g.name, otherProcs: g.otherProcs, otherMB: g.otherMB,
        sessions: g.sessions.map((x) => Object.assign({}, x, { closable: !!settings().allowClose && !safe.has(x.pid) })),
      })) }];
    },
    'GET /v1/worktrees': async () => {
      const c = settings();
      if (!c.folders.length) return [200, { folders: 0, repos: [] }];
      const [repos, s] = await Promise.all([worktrees.list(c.folders), snapshot(false)]);
      const sess = new Map(); sessionsOf(s.procs).forEach((g) => g.sessions.forEach((x) => sess.set(x.pid, g.name)));
      repos.forEach((r) => r.worktrees.forEach((w) => { w.busy = []; }));
      return [200, { folders: c.folders.length, repos: worktrees.attach(repos, s.procs, sess) }];
    },
    // Mostrar un archivo en el explorador del sistema. Todas las reglas estan en reveal.js.
    'POST /v1/reveal': async (body) => {
      const c = settings();
      if (!c.allowReveal) return [403, { error: 'off' }];
      const r = reveal.check(body.path, c.folders);
      if (!r.file) return [r.status, { error: r.error }];
      (opts.reveal || reveal.open)(r.file, !!r.dir);
      log('reveal ' + r.file);
      return [200, { ok: true }];
    },
    // Cerrar un servidor de desarrollo. Tiene que seguir siendo el mismo proceso
    // (misma fecha de inicio), seguir escuchando ese puerto y seguir contando como de desarrollo.
    'POST /v1/servers/close': async (body) => {
      if (!settings().allowClose) return [403, { error: 'read-only' }];
      if (!Number.isInteger(body.pid) || !Number.isInteger(body.port) || typeof body.started !== 'string') return [400, { error: 'bad-request' }];
      const s = await snapshot(true);
      const row = serverRows(s).find((r) => r.pid === body.pid && r.port === body.port);
      if (!row) return [404, { error: 'gone' }];
      if (row.kind !== 'dev' || !row.started || row.started !== body.started || untouchable(s.procs).has(row.pid)) return [403, { error: 'not-closable' }];
      const closed = await closeAndWait(row.pid, (now) => now.listeners.some((l) => l.pid === row.pid && l.port === row.port));
      log('close server pid ' + row.pid + ' port ' + row.port + (closed ? ': closed' : ': still there'));
      return [200, { ok: closed, pid: row.pid, port: row.port }];
    },
    // Cerrar una sesion de agente: solo una que el programa reconocio como tal.
    'POST /v1/agents/close': async (body) => {
      if (!settings().allowClose) return [403, { error: 'read-only' }];
      if (!Number.isInteger(body.pid) || typeof body.started !== 'string') return [400, { error: 'bad-request' }];
      const s = await snapshot(true);
      let hit = null; sessionsOf(s.procs).forEach((g) => g.sessions.forEach((x) => { if (x.pid === body.pid) hit = x; }));
      if (!hit) return [404, { error: 'gone' }];
      if (!hit.started || hit.started !== body.started || untouchable(s.procs).has(hit.pid)) return [403, { error: 'not-closable' }];
      const closed = await closeAndWait(hit.pid, (now) => now.procs.some((p) => p.pid === hit.pid && p.start === hit.started));
      log('close agent session pid ' + hit.pid + (closed ? ': closed' : ': still there'));
      return [200, { ok: closed, pid: hit.pid }];
    },
  };

  // El cuerpo de un POST: JSON chico. Pasado el limite no se lee mas y se contesta que no.
  function readBody(req) {
    return new Promise((resolve) => {
      let text = ''; let over = false;
      req.setEncoding('utf8');
      req.on('data', (c) => { if (over) return; text += c; if (text.length > 2048) { over = true; text = ''; resolve(null); } });
      req.on('end', () => { if (over) return; let j = null; try { j = JSON.parse(text); } catch (e) { j = null; } resolve(!j || typeof j !== 'object' || Array.isArray(j) ? null : j); });
      req.on('error', () => resolve(null));
    });
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, headers, body) => {
      if (res.headersSent) return;
      const text = body === undefined ? '' : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      if (body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json; charset=utf-8';
      res.writeHead(status, headers); res.end(text);
    };
    const verdict = security.check(req, { port, origins: settings().origins, token, limiter });
    if (verdict.status === 204) return send(204, verdict.headers);
    if (verdict.status) return send(verdict.status, verdict.headers, { error: verdict.error });
    const pathname = req.url.split('?')[0];
    if (PANEL[pathname]) {
      const [file, type] = PANEL[pathname];
      return fs.readFile(path.join(__dirname, 'panel', file), (err, data) => {
        if (err) return send(404, verdict.headers, { error: 'not-found' });
        // El nombre del programa sale de name.js tambien aca.
        data = String(data).split('{{NAME}}').join(NAME).split('{{CMD}}').join(CMD);
        send(200, Object.assign(verdict.headers, { 'Content-Type': type, 'Content-Security-Policy': PANEL_CSP, 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' }), data);
      });
    }
    const route = routes[req.method + ' ' + pathname];
    if (!route) return send(404, verdict.headers, { error: 'not-found' });
    try {
      let body = {};
      if (req.method === 'POST') { body = await readBody(req); if (!body) return send(400, Object.assign(verdict.headers, { Connection: 'close' }), { error: 'bad-request' }); }
      const [status, data] = await route(body);
      send(status, verdict.headers, data);
    } catch (e) {
      log('error: ' + ((e && e.stack) || e));
      send(500, verdict.headers, { error: 'internal' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;

  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { port = server.address().port; resolve(port); }); }),
    close: () => new Promise((resolve) => { platform.stop(); server.close(() => resolve()); server.closeAllConnections && server.closeAllConnections(); }),
  };
}

module.exports = { create, VERSION };
