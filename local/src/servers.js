'use strict';
// Bloque "Servidores": que puertos escuchan, de quien son y cuales parecen de
// desarrollo. Lo de desarrollo es lo unico que se puede cerrar desde afuera.
const fs = require('fs');
const os = require('os');
const http = require('http');
const nodePath = require('path');
const { CMD } = require('./name');

// Ejecutables con los que se levanta algo mientras se desarrolla.
const RUNTIMES = new Set(['node', 'bun', 'deno', 'php', 'php-cgi', 'ruby', 'java', 'javaw', 'dotnet', 'go', 'cargo', 'uvicorn', 'gunicorn',
  'hypercorn', 'flask', 'hugo', 'jekyll', 'nodemon', 'tsx', 'ts-node', 'vite', 'next', 'http-server', 'serve', 'rails', 'puma', 'mix',
  'elixir', 'erl', 'beam.smp', 'air', 'wrangler', 'workerd', 'esbuild', 'caddy', 'py']);
const isRuntime = (name) => RUNTIMES.has(name) || /^python[\d.]*w?$/.test(name);
// Lo que dice que una carpeta es un proyecto.
const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile', 'deno.json', 'pom.xml', 'build.gradle', 'mix.exs'];
// Herramientas que se reconocen en la linea de comandos, y el paquete de donde sale su version.
const STACKS = [
  [/\bvite(\.js)?\b/, 'vite', 'vite'], [/\bnext(\.js)?\b|next-server/, 'next', 'next'], [/\bastro\b/, 'astro', 'astro'], [/\bnuxt\b/, 'nuxt', 'nuxt'],
  [/\breact-scripts\b/, 'react-scripts', 'react-scripts'], [/webpack(-dev-server)?\b/, 'webpack', 'webpack'], [/\bng(\.js)? serve\b|@angular[\\/]cli/, 'angular', '@angular/cli'],
  [/\bremix\b/, 'remix', '@remix-run/dev'], [/svelte-kit\b|@sveltejs[\\/]kit/, 'sveltekit', '@sveltejs/kit'], [/\bstorybook\b/, 'storybook', 'storybook'],
  [/\bexpo\b/, 'expo', 'expo'], [/\bwrangler\b/, 'wrangler', 'wrangler'], [/\bparcel\b/, 'parcel', 'parcel'], [/http-server\b/, 'http-server', 'http-server'],
  [/\bnodemon\b/, 'nodemon', 'nodemon'], [/\buvicorn\b/, 'uvicorn', ''], [/\bgunicorn\b/, 'gunicorn', ''], [/\bflask\b/, 'flask', ''],
  [/manage\.py\s+runserver/, 'django', ''], [/-m\s+http\.server/, 'http.server', ''], [/\brails\b/, 'rails', ''], [/\bartisan\s+serve/, 'laravel', ''],
];

// Todo lo que depende del sistema entra por aca, para poder probar con rutas de cualquier plataforma.
function environment(platform) {
  const win = (platform || process.platform) === 'win32';
  const P = win ? nodePath.win32 : nodePath.posix;
  const env = process.env;
  const home = os.homedir();
  const systemDirs = win
    ? [env.SystemRoot || 'C:\\Windows', env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramData || 'C:\\ProgramData', P.join(home, 'AppData')]
    : ['/usr', '/bin', '/sbin', '/lib', '/etc', '/var', '/opt', '/snap', '/System', '/Library', '/Applications', '/private', P.join(home, 'Library')];
  return {
    win, P, home, systemDirs, selfPid: process.pid,
    // Lo que vive aca es del sistema operativo, lo lance quien lo lance.
    osDirs: win ? [systemDirs[0]] : [],
    exists: (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } },
    readJson: (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } },
  };
}

const norm = (env, p) => { const s = env.P.normalize(String(p || '')).replace(/[\\/]+$/, ''); return env.win ? s.toLowerCase() : s; };
// child esta en parent o es parent.
function inside(env, child, parent) {
  const c = norm(env, child); const p = norm(env, parent);
  return !!c && !!p && (c === p || c.startsWith(p + env.P.sep));
}

// La carpeta del proyecto de un proceso: desde su carpeta de trabajo hacia
// arriba, la primera que tenga una marca. Nunca la carpeta del usuario ni mas
// arriba, nunca carpetas del sistema ni las ocultas del perfil (~/.algo).
function projectRoot(env, dir) {
  if (!dir || !env.P.isAbsolute(dir)) return '';
  let at = env.P.normalize(dir);
  // Adentro de node_modules manda el proyecto que lo contiene.
  const cut = at.split(env.P.sep).indexOf('node_modules');
  if (cut > 0) at = at.split(env.P.sep).slice(0, cut).join(env.P.sep);
  if (env.systemDirs.some((d) => inside(env, at, d))) return '';
  if (inside(env, at, env.home)) {
    const first = env.P.relative(env.home, at).split(env.P.sep)[0];
    if (!first || first[0] === '.') return '';
  }
  for (let i = 0; i < 10; i++) {
    if (norm(env, at) === norm(env, env.home)) return '';
    const up = env.P.dirname(at);
    if (up === at) return ''; // la raiz del disco no es un proyecto
    if (MARKERS.some((m) => env.exists(env.P.join(at, m)))) return at;
    at = up;
  }
  return '';
}

const baseName = (name) => String(name || '').toLowerCase().replace(/\.exe$/, '');

// De que clase es un proceso que escucha:
//   dev     lanzado desde una carpeta de proyecto: se puede cerrar
//   app     un programa del usuario: se muestra, no se cierra
//   system  del sistema o de otro usuario: se muestra aparte, no se cierra
function classify(env, proc) {
  if (!proc || proc.system || !proc.name) return { kind: 'system', root: '' };
  if (proc.exe && env.osDirs.some((d) => inside(env, proc.exe, d))) return { kind: 'system', root: '' };
  if (proc.pid === env.selfPid) return { kind: 'app', root: '' };
  const name = baseName(proc.name);
  let root = projectRoot(env, proc.cwd);
  // Un binario compilado que vive adentro de un proyecto (target/debug/app, ./server) tambien cuenta.
  const exeRoot = proc.exe ? projectRoot(env, env.P.dirname(proc.exe)) : '';
  if (isRuntime(name) && root) return { kind: 'dev', root };
  if (exeRoot && !proc.exe.split(env.P.sep).includes('node_modules')) return { kind: 'dev', root: root || exeRoot };
  if (exeRoot && root) return { kind: 'dev', root };
  return { kind: 'app', root: '' };
}

// Nombre y version, solo de lo que esta escrito: el package.json del proyecto y
// el de la herramienta instalada en el.
function describe(env, root, cmd) {
  const out = { name: '', version: '', stack: '' };
  if (!root) return out;
  const pkg = env.readJson(env.P.join(root, 'package.json'));
  if (pkg) { out.name = typeof pkg.name === 'string' ? pkg.name.slice(0, 80) : ''; out.version = typeof pkg.version === 'string' ? pkg.version.slice(0, 40) : ''; }
  const hit = STACKS.find((s) => s[0].test(String(cmd || '')));
  if (hit) {
    const dep = hit[2] ? env.readJson(env.P.join(root, 'node_modules', ...hit[2].split('/'), 'package.json')) : null;
    out.stack = hit[1] + (dep && typeof dep.version === 'string' ? ' ' + dep.version.slice(0, 30) : '');
  }
  return out;
}

const WILD = new Set(['0.0.0.0', '::', '*']);
const LOOP = (a) => a === '::1' || /^127\./.test(a) || a === 'localhost';

// Junta los puertos con sus procesos. agentOf(pid) dice que sesion de agente lo lanzo, si alguna.
function build(env, listeners, procs, agentOf) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const rows = new Map();
  for (const l of listeners) {
    const key = l.pid + ':' + l.port;
    if (!rows.has(key)) rows.set(key, { pid: l.pid, port: l.port, addresses: [] });
    if (!rows.get(key).addresses.includes(l.address)) rows.get(key).addresses.push(l.address);
  }
  const out = [];
  for (const row of rows.values()) {
    const proc = byPid.get(row.pid);
    const c = classify(env, proc);
    const info = c.kind === 'dev' ? describe(env, c.root, proc.cmd) : { name: '', version: '', stack: '' };
    const agent = c.kind === 'dev' && agentOf ? agentOf(row.pid) : null;
    out.push({
      port: row.port, pid: row.pid, kind: c.kind,
      // Escucha para toda la red, o solo para esta maquina.
      exposed: row.addresses.some((a) => !LOOP(a)),
      addresses: row.addresses,
      process: proc ? proc.name : '',
      command: proc && c.kind !== 'system' ? String(proc.cmd || '').replace(/\s+/g, ' ').slice(0, 220) : '',
      cwd: proc && c.kind === 'dev' ? proc.cwd : '',
      started: proc ? proc.start : '',
      memoryMB: proc ? Math.round(proc.mem / 1048576) : 0,
      project: c.root ? env.P.basename(c.root) : '',
      projectRoot: c.root,
      package: info.name, version: info.version, stack: info.stack,
      launchedBy: agent ? agent.name : '',
      closable: c.kind === 'dev',
      http: null,
    });
  }
  const order = { dev: 0, app: 1, system: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.port - b.port);
}

// Le pide la portada a un servidor de esta maquina y se queda con el titulo y el encabezado Server.
function probe(row, timeoutMs) {
  return new Promise((resolve) => {
    const a = row.addresses.find((x) => WILD.has(x) || /^127\./.test(x)) ? '127.0.0.1' : (row.addresses.includes('::1') ? '::1' : row.addresses[0]);
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ host: a, port: row.port, path: '/', timeout: timeoutMs || 700, headers: { Accept: 'text/html,*/*', 'User-Agent': CMD } }, (res) => {
      let body = ''; res.setEncoding('utf8');
      const end = () => {
        const m = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        finish({ status: res.statusCode, server: clean(res.headers.server), title: clean(m && m[1]) });
        req.destroy();
      };
      res.on('data', (c) => { body += c; if (body.length > 32768) end(); });
      res.on('end', end); res.on('error', end);
    });
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

const probed = new Map(); // pid:puerto:inicio -> { at, value }
async function withHttp(rows, selfPort) {
  const now = Date.now();
  for (const k of probed.keys()) if (now - probed.get(k).at > 300000) probed.delete(k);
  await Promise.all(rows.filter((r) => r.kind === 'dev' && r.port !== selfPort).map(async (r) => {
    const key = r.pid + ':' + r.port + ':' + r.started;
    let hit = probed.get(key);
    if (!hit || now - hit.at > 60000) { hit = { at: now, value: await probe(r) }; probed.set(key, hit); }
    r.http = hit.value;
  }));
  return rows;
}

module.exports = { environment, inside, projectRoot, classify, describe, build, probe, withHttp, baseName, isRuntime };
