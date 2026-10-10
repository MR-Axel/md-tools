'use strict';
// Prueba real en esta maquina: levanta un servidor de prueba en un puerto alto,
// comprueba que la API lo ve como servidor de desarrollo, lo cierra por la API
// y comprueba que se fue. No toca ningun otro proceso: lo unico que pide cerrar
// es lo que ella misma levanto, mas un intento que tiene que ser rechazado.
//
//   node test/real.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sharpmd-local-test-'));
process.env.SHARPMD_LOCAL_HOME = HOME;
const config = require('../src/config');
const { create } = require('../src/server');

const DEMO = path.join(__dirname, '.real', 'demo-app');
const PORT = 47000 + Math.floor(Math.random() * 900);
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? '  ok    ' : '  FALLA ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(DEMO, { recursive: true });
  fs.writeFileSync(path.join(DEMO, 'package.json'), JSON.stringify({ name: 'demo-app', version: '9.8.7', private: true }) + '\n');
  fs.writeFileSync(path.join(DEMO, 'server.js'), "require('http').createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html', Server: 'demo-server' }); s.end('<title>Demo app</title>'); }).listen(Number(process.argv[2]), '127.0.0.1');\n");

  // La carpeta de git donde vive esta copia del programa (puede ser un worktree).
  let repo = path.resolve(__dirname, '..');
  while (!fs.existsSync(path.join(repo, '.git')) && path.dirname(repo) !== repo) repo = path.dirname(repo);
  config.save({ folders: [repo] });
  const token = config.token(false);
  const cfg = Object.assign(config.load(), { port: 0 });
  const app = create({ cfg, token, fixed: true, log: (m) => console.log('        [api] ' + m) });
  const port = await app.listen();
  const api = async (p, body, tk) => {
    const res = await fetch('http://127.0.0.1:' + port + '/v1/' + p, { method: body ? 'POST' : 'GET', headers: Object.assign({ Authorization: 'Bearer ' + (tk || token) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const demo = spawn(process.execPath, ['server.js', String(PORT)], { cwd: DEMO, stdio: 'ignore', windowsHide: true });
  let exited = false; demo.on('exit', () => { exited = true; });
  console.log('\n  servidor de prueba: PID ' + demo.pid + ', puerto ' + PORT + '\n');
  await sleep(900);

  try {
    const before = (await api('servers')).json;
    const mine = before.servers.find((s) => s.port === PORT);
    check('la API lee la carpeta de trabajo de los procesos', before.cwd === true);
    check('el servidor de prueba aparece', !!mine, before.servers.map((s) => s.port));
    if (mine) {
      console.log('        ' + JSON.stringify({ kind: mine.kind, process: mine.process, project: mine.project, package: mine.package, version: mine.version, http: mine.http, exposed: mine.exposed, memoryMB: mine.memoryMB, started: mine.started, launchedBy: mine.launchedBy }));
      check('es el proceso que levantamos', mine.pid === demo.pid, mine.pid);
      check('cuenta como de desarrollo y se puede cerrar', mine.kind === 'dev' && mine.closable === true, mine);
      check('proyecto por la carpeta', mine.project === 'demo-app' && path.resolve(mine.cwd).toLowerCase() === DEMO.toLowerCase(), [mine.project, mine.cwd]);
      check('version del package.json', mine.package === 'demo-app' && mine.version === '9.8.7', [mine.package, mine.version]);
      check('titulo y encabezado Server por HTTP', !!mine.http && mine.http.title === 'Demo app' && mine.http.server === 'demo-server', mine.http);
      check('solo escucha en esta maquina', mine.exposed === false, mine.addresses);
      check('desde cuando corre y cuanta memoria usa', !isNaN(Date.parse(mine.started)) && Date.now() - Date.parse(mine.started) < 60000 && mine.memoryMB > 0, [mine.started, mine.memoryMB]);
    }
    const self = before.servers.find((s) => s.port === port);
    check('la propia API aparece y no se puede cerrar', !!self && self.closable === false && self.kind !== 'dev', self && [self.kind, self.closable]);
    const system = before.servers.filter((s) => s.kind === 'system');
    check('lo del sistema va aparte, sin linea de comando y sin cerrar', system.length > 0 && system.every((s) => !s.closable && !s.command && !s.cwd), system.length);

    check('sin token: 401', (await api('servers', null, 'x'.repeat(43))).status === 401);
    const foreign = await fetch('http://127.0.0.1:' + port + '/v1/servers', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://evil.example' } });
    check('con Origin ajeno: 403', foreign.status === 403 && !foreign.headers.get('access-control-allow-origin'));
    if (self) check('pedir que cierre lo que no es de desarrollo: rechazado', (await api('servers/close', { pid: self.pid, port: self.port, started: self.started })).status === 403);
    if (mine) check('con otra fecha de inicio: rechazado', (await api('servers/close', { pid: mine.pid, port: PORT, started: '2020-01-01T00:00:00.0000000Z' })).status === 403 && !exited);

    const wt = (await api('worktrees')).json;
    const same = (p) => path.resolve(p).toLowerCase() === repo.toLowerCase();
    const here = wt.repos && wt.repos.find((r) => r.worktrees.some((x) => same(x.path)));
    const mineWt = here && here.worktrees.find((x) => same(x.path));
    check('worktrees: el repositorio elegido, con rama y ultimo commit', !!mineWt && !!mineWt.branch && !!mineWt.commit, wt && wt.folders);
    if (here) {
      const w = mineWt;
      console.log('        ' + JSON.stringify({ branch: w.branch, commit: w.commit, subject: w.subject, changes: w.changes, lastEdit: w.lastEdit, busy: w.busy }));
      check('worktrees: ve el proceso que trabaja en esa carpeta', w.busy.some((b) => b.name === 'node'), w.busy);
    }

    const ag = (await api('agents')).json;
    const sessions = ag.agents.reduce((all, g) => all.concat(g.sessions), []);
    console.log('        sesiones de agentes vistas: ' + sessions.length + (sessions.length ? ', memoria total ' + sessions.reduce((t, s) => t + s.memoryMB + s.childrenMB, 0) + ' MB, con titulo ' + sessions.filter((s) => s.title).length : ''));
    check('agentes: la lista responde', Array.isArray(ag.agents));

    if (mine) {
      const others = before.servers.filter((s) => s.port !== PORT).map((s) => s.pid + ':' + s.port);
      const r = await api('servers/close', { pid: mine.pid, port: PORT, started: mine.started });
      check('cerrar por la API: 200 y ok', r.status === 200 && r.json && r.json.ok === true, r);
      await sleep(400);
      check('el proceso de prueba termino', exited);
      const after = (await api('servers')).json;
      check('el puerto ya no aparece', !after.servers.some((s) => s.port === PORT));
      const still = new Set(after.servers.map((s) => s.pid + ':' + s.port));
      const lost = others.filter((k) => !still.has(k));
      // Otros agentes levantan y bajan cosas mientras tanto: se informa, no es una falla de esta prueba.
      console.log('        de los otros ' + others.length + ' puertos que habia, siguen ' + (others.length - lost.length) + (lost.length ? ' (se fueron por su cuenta: ' + lost.join(', ') + ')' : ''));
      check('pedir de nuevo que lo cierre: ya no esta', (await api('servers/close', { pid: mine.pid, port: PORT, started: mine.started })).status === 404);
    }
  } finally {
    if (!exited) { try { demo.kill(); } catch (e) { /* ya se fue */ } }
    await app.close();
    fs.rmSync(HOME, { recursive: true, force: true });
    fs.rmSync(path.join(__dirname, '.real'), { recursive: true, force: true });
  }
  console.log(failed ? '\n  ' + failed + ' fallas\n' : '\n  todo bien\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
