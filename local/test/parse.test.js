'use strict';
// El parseo, contra salidas de ejemplo guardadas en test/fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const win = require('../src/platform/windows');
const posix = require('../src/platform/posix');
const servers = require('../src/servers');
const agents = require('../src/agents');
const worktrees = require('../src/worktrees');
const config = require('../src/config');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// Una maquina de mentira: carpetas y archivos que "existen".
function fakeEnv(platform, home, files) {
  const env = servers.environment(platform);
  const P = env.P; const has = new Map(Object.entries(files).map(([k, v]) => [P.normalize(k).toLowerCase(), v]));
  return Object.assign(env, {
    home, selfPid: 999999, osDirs: platform === 'win32' ? ['C:' + P.sep + 'Windows'] : [],
    systemDirs: platform === 'win32' ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', home + '\\AppData'] : ['/usr', '/bin', '/sbin', '/etc', '/var', '/opt', '/System', '/Library', home + '/Library'],
    exists: (p) => has.has(P.normalize(p).toLowerCase()),
    readJson: (p) => { const v = has.get(P.normalize(p).toLowerCase()); return v && typeof v === 'object' ? v : null; },
  });
}
const WIN = () => fakeEnv('win32', 'C:\\Users\\sam', {
  'C:\\Users\\sam\\code\\notes-app\\.git': true,
  'C:\\Users\\sam\\code\\notes-app\\package.json': { name: 'notes-app', version: '1.4.2' },
  'C:\\Users\\sam\\code\\notes-app\\node_modules\\vite\\package.json': { name: 'vite', version: '5.4.2' },
  'C:\\Users\\sam\\code\\site\\.git': true,
  'C:\\Users\\sam\\AppData\\Local\\Discord\\app\\package.json': { name: 'discord', version: '1.0.0' },
  'C:\\Users\\sam\\.editor\\extensions\\lsp\\package.json': { name: 'lsp', version: '0.1.0' },
  'C:\\Users\\sam\\package.json': { name: 'home', version: '0.0.0' },
});

test('netstat: solo lo que escucha, con direccion, puerto y PID', () => {
  const rows = win.parseNetstat(fx('netstat-en.txt'));
  assert.deepEqual(rows, [
    { address: '0.0.0.0', port: 135, pid: 1320 }, { address: '0.0.0.0', port: 445, pid: 4 }, { address: '0.0.0.0', port: 3000, pid: 9120 },
    { address: '127.0.0.1', port: 5173, pid: 4242 }, { address: '192.168.0.14', port: 139, pid: 4 },
  ]);
});

test('netstat: Windows en otro idioma e IPv6', () => {
  const rows = win.parseNetstat(fx('netstat-es-v6.txt'));
  assert.deepEqual(rows.map((r) => r.address + ' ' + r.port + ' ' + r.pid), [':: 135 1320', ':: 3000 9120', '::1 5173 4242', 'fe80::1c2b:3d4e:5f60:7182 8080 6100']);
});

test('netstat: basura no rompe', () => {
  assert.deepEqual(win.parseNetstat(''), []);
  assert.deepEqual(win.parseNetstat('TCP nada que ver\n\u0000\nUDP 0.0.0.0:53 *:* 12'), []);
});

test('procesos de Windows: normaliza y marca los del sistema', () => {
  const procs = win.parseProcs(fx('procs.json'));
  assert.equal(procs.length, 9);
  const by = new Map(procs.map((p) => [p.pid, p]));
  assert.equal(by.get(4).system, true);
  assert.equal(by.get(1320).system, true);
  assert.equal(by.get(4242).system, false);
  assert.equal(by.get(4242).cwd, 'C:\\Users\\sam\\code\\notes-app'); // sin la barra final
  assert.equal(by.get(4).cmd, '');
  assert.equal(win.parseProcs('no es json'), null);
  assert.equal(win.parseProcs('{"procs":7}'), null);
});

test('ss (Linux) y lsof, ps (macOS)', () => {
  assert.deepEqual(posix.parseSs(fx('ss.txt')), [
    { address: '127.0.0.1', port: 5173, pid: 4242 }, { address: '0.0.0.0', port: 22, pid: 812 },
    { address: '0.0.0.0', port: 3000, pid: 9120 }, { address: '0.0.0.0', port: 3000, pid: 9121 }, { address: '::1', port: 8000, pid: 5150 },
  ]);
  assert.deepEqual(posix.parseLsof(fx('lsof.txt')), [
    { address: '127.0.0.1', port: 5173, pid: 4242 }, { address: '0.0.0.0', port: 3000, pid: 9120 }, { address: '::1', port: 3001, pid: 9120 },
  ]);
  const ps = posix.parsePs(fx('ps.txt'), 501);
  assert.equal(ps.length, 3);
  assert.equal(ps[0].system, true);
  assert.deepEqual([ps[1].pid, ps[1].ppid, ps[1].name, ps[1].system, ps[1].mem], [4242, 4100, 'node', false, 81234 * 1024]);
  assert.equal(ps[2].exe, '/usr/bin/python3');
});

test('de que clase es cada proceso que escucha', () => {
  const env = WIN(); const by = new Map(win.parseProcs(fx('procs.json')).map((p) => [p.pid, p]));
  assert.deepEqual(servers.classify(env, by.get(4242)), { kind: 'dev', root: 'C:\\Users\\sam\\code\\notes-app' });
  assert.equal(servers.classify(env, by.get(9120)).kind, 'dev');
  assert.equal(servers.classify(env, by.get(4)).kind, 'system');
  assert.equal(servers.classify(env, by.get(1320)).kind, 'system');
  assert.equal(servers.classify(env, undefined).kind, 'system');
  // Un programa instalado no es de desarrollo aunque su carpeta tenga un package.json.
  assert.equal(servers.classify(env, by.get(6100)).kind, 'app');
  assert.equal(servers.classify(env, by.get(7001)).kind, 'app');
  // node lanzado desde una carpeta oculta del perfil, desde la carpeta del usuario o desde la raiz: no.
  const node = (cwd) => ({ pid: 50, ppid: 1, name: 'node.exe', cmd: 'node x.js', exe: 'C:\\Program Files\\nodejs\\node.exe', cwd, system: false });
  assert.equal(servers.classify(env, node('C:\\Users\\sam\\.editor\\extensions\\lsp')).kind, 'app');
  assert.equal(servers.classify(env, node('C:\\Users\\sam')).kind, 'app');
  assert.equal(servers.classify(env, node('C:\\')).kind, 'app');
  assert.equal(servers.classify(env, node('')).kind, 'app');
  // Desde una subcarpeta, o desde adentro de node_modules, el proyecto es el de arriba.
  assert.equal(servers.classify(env, node('C:\\Users\\sam\\code\\notes-app\\src\\api')).root, 'C:\\Users\\sam\\code\\notes-app');
  assert.equal(servers.classify(env, node('C:\\Users\\sam\\code\\notes-app\\node_modules\\vite\\bin')).root, 'C:\\Users\\sam\\code\\notes-app');
  // Este mismo programa nunca es cerrable.
  assert.equal(servers.classify(Object.assign(env, { selfPid: 50 }), node('C:\\Users\\sam\\code\\notes-app')).kind, 'app');
});

test('lo mismo con rutas de Linux', () => {
  const env = fakeEnv('linux', '/home/sam', { '/home/sam/code/api/go.mod': true });
  const p = (name, exe, cwd) => ({ pid: 60, ppid: 1, name, cmd: name, exe, cwd, system: false });
  assert.equal(servers.classify(env, p('python3.12', '/usr/bin/python3.12', '/home/sam/code/api')).kind, 'dev');
  // Un binario compilado adentro del proyecto.
  assert.equal(servers.classify(env, p('api', '/home/sam/code/api/bin/api', '/')).kind, 'dev');
  assert.equal(servers.classify(env, p('sshd', '/usr/sbin/sshd', '/')).kind, 'app');
  assert.equal(servers.classify(env, p('node', '/usr/bin/node', '/opt/tool')).kind, 'app');
});

test('la lista de servidores: version, herramienta, red y quien lo lanzo', () => {
  const env = WIN(); const procs = win.parseProcs(fx('procs.json'));
  const listeners = win.parseNetstat(fx('netstat-en.txt')).concat(win.parseNetstat(fx('netstat-es-v6.txt')));
  const rows = servers.build(env, listeners, procs, (pid) => (pid === 4242 ? { name: 'Claude Code' } : null));
  const vite = rows.find((r) => r.port === 5173);
  assert.deepEqual([vite.kind, vite.closable, vite.project, vite.package, vite.version, vite.stack, vite.exposed, vite.launchedBy, vite.memoryMB],
    ['dev', true, 'notes-app', 'notes-app', '1.4.2', 'vite 5.4.2', false, 'Claude Code', 150]);
  assert.deepEqual(vite.addresses, ['127.0.0.1', '::1']);
  const py = rows.find((r) => r.port === 3000);
  assert.deepEqual([py.kind, py.project, py.version, py.stack, py.exposed], ['dev', 'site', '', 'http.server', true]);
  const sys = rows.find((r) => r.port === 445);
  assert.deepEqual([sys.kind, sys.closable, sys.command, sys.cwd], ['system', false, '', '']);
  const app = rows.find((r) => r.port === 8080);
  assert.deepEqual([app.kind, app.closable, app.version], ['app', false, '']);
  // Primero lo de desarrollo, despues los programas, al final el sistema.
  assert.deepEqual(rows.map((r) => r.kind).filter((k, i, a) => a.indexOf(k) === i), ['dev', 'app', 'system']);
});

test('agentes: sesiones aparte de la app de escritorio, con lo que lanzaron', () => {
  const procs = win.parseProcs(fx('procs.json'));
  const groups = agents.find(config.DEFAULTS.agents, procs);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.deepEqual([g.name, g.sessions.length, g.otherProcs, g.otherMB], ['Claude Code', 1, 1, 300]);
  const s = g.sessions[0];
  assert.deepEqual([s.pid, s.id, s.project, s.memoryMB, s.children, s.childrenMB], [4000, '11111111-2222-3333-4444-555555555555', 'notes-app', 700, 2, 154]);
  // Un agente apagado en la configuracion no se busca.
  assert.deepEqual(agents.find([{ name: 'X', on: false, process: 'claude' }], procs), []);
  // Un patron mal escrito no rompe: cuenta todos como sesion.
  assert.equal(agents.find([{ name: 'X', on: true, process: 'claude', sessionPattern: '([' }], procs)[0].sessions.length, 2);
});

test('agentes: titulo de la conversacion', () => {
  assert.equal(agents.titleFrom(fx('transcript-plain.jsonl')), 'Add full text search to the notes list and keep it fast on large fold…');
  assert.equal(agents.titleFrom(fx('transcript-titled.jsonl')), 'Search for the notes list');
  assert.equal(agents.titleFrom(''), '');
});

test('worktrees: lista y estado', () => {
  const wts = worktrees.parseWorktrees(fx('worktrees.txt'));
  assert.equal(wts.length, 3);
  assert.deepEqual([wts[0].path, wts[0].branch, wts[0].locked], ['C:/Users/sam/code/notes-app', 'main', false]);
  assert.deepEqual([wts[1].branch, wts[1].locked], ['feat/search', true]);
  assert.deepEqual([wts[2].branch, wts[2].detached, wts[2].prunable], ['', true, true]);
  assert.deepEqual(worktrees.parseStatus(' M src/a.js\0?? notes/new file.md\0R  b.js\0old-b.js\0D  gone.js\0'), ['src/a.js', 'notes/new file.md', 'b.js', 'gone.js']);
  assert.deepEqual(worktrees.parseStatus(''), []);
});

test('worktrees: cada proceso va a la carpeta mas especifica', () => {
  const root = path.resolve('/code/notes-app');
  const repos = [{ worktrees: [{ path: root, busy: [] }, { path: path.join(root, '.agents', 'wt-search'), busy: [] }] }];
  const procs = [
    { pid: 1, name: 'claude.exe', cwd: root, system: false },
    { pid: 2, name: 'node.exe', cwd: path.join(root, '.agents', 'wt-search', 'src'), system: false },
    { pid: 3, name: 'node.exe', cwd: path.join(root, '.agents', 'wt-search'), system: false },
    { pid: 4, name: 'node.exe', cwd: path.resolve('/code/notes-app-2'), system: false },
  ];
  worktrees.attach(repos, procs, new Map([[1, 'Claude Code']]));
  assert.deepEqual(repos[0].worktrees[0].busy, [{ name: 'Claude Code', agent: true, count: 1 }]);
  assert.deepEqual(repos[0].worktrees[1].busy, [{ name: 'node', agent: false, count: 2 }]);
});
