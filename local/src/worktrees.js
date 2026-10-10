'use strict';
// Bloque "Worktrees": por cada repositorio elegido, sus worktrees con rama,
// ultimo commit, cambios sin confirmar, ultima edicion y que procesos tienen
// esa carpeta como carpeta de trabajo. Solo lectura: no borra ni cambia nada.
//
// git se llama siempre con argumentos fijos y sin consola de por medio. Con
// GIT_OPTIONAL_LOCKS=0 `git status` no toma el candado del indice, asi no le
// pisa el paso a un agente que este trabajando en esa carpeta.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ENV = Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-C', cwd].concat(args),
      { env: ENV, windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// `git worktree list --porcelain`: bloques separados por una linea vacia.
function parseWorktrees(text) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const wt = { path: '', head: '', branch: '', bare: false, detached: false, locked: false, prunable: false };
    for (const line of block.split(/\r?\n/)) {
      const at = line.indexOf(' '); const key = at < 0 ? line : line.slice(0, at); const val = at < 0 ? '' : line.slice(at + 1);
      if (key === 'worktree') wt.path = val;
      else if (key === 'HEAD') wt.head = val;
      else if (key === 'branch') wt.branch = val.replace(/^refs\/heads\//, '');
      else if (key === 'bare' || key === 'detached' || key === 'locked' || key === 'prunable') wt[key] = true;
    }
    if (wt.path) out.push(wt);
  }
  return out;
}

// `git status --porcelain -z`: "XY ruta\0", y en un renombrado sigue "origen\0".
function parseStatus(text) {
  const files = []; const parts = String(text || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; if (e.length < 4) continue;
    files.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++;
  }
  return files;
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const isRepo = (dir) => fs.existsSync(path.join(dir, '.git'));
// Cada carpeta elegida es un repositorio o tiene repositorios adentro (un nivel).
function candidates(folders) {
  const out = [];
  for (const f of folders) {
    if (isRepo(f)) { out.push(f); continue; }
    let kids = [];
    try { kids = fs.readdirSync(f, { withFileTypes: true }); } catch (e) { continue; }
    for (const k of kids) { if (k.isDirectory() && isRepo(path.join(f, k.name))) out.push(path.join(f, k.name)); }
  }
  return out.slice(0, 80);
}

const key = (p) => { const s = path.resolve(p); return process.platform === 'win32' ? s.toLowerCase() : s; };

async function one(wt) {
  const row = Object.assign({ commit: '', subject: '', committed: '', changes: 0, lastEdit: '', missing: false, busy: [] }, wt, { name: path.basename(wt.path) });
  if (wt.bare) return row;
  if (!fs.existsSync(wt.path)) { row.missing = true; return row; }
  const [log, status] = await Promise.all([git(wt.path, ['log', '-1', '--format=%h%x1f%s%x1f%cI']), git(wt.path, ['status', '--porcelain', '-z', '--untracked-files=normal'])]);
  if (log) { const f = log.trim().split('\x1f'); row.commit = f[0] || ''; row.subject = (f[1] || '').slice(0, 100); row.committed = f[2] || ''; }
  const files = parseStatus(status);
  row.changes = files.length;
  // La ultima edicion: el archivo sin confirmar tocado mas tarde o, si no hay ninguno, el ultimo commit.
  let last = row.committed ? Date.parse(row.committed) : 0;
  for (const f of files.slice(0, 300)) { try { const t = fs.statSync(path.join(wt.path, f)).mtimeMs; if (t > last) last = t; } catch (e) { /* borrado */ } }
  row.lastEdit = last ? new Date(last).toISOString() : '';
  return row;
}

// procs: los de la maquina; sessions: las sesiones de agentes (pid -> nombre del agente).
function attach(repos, procs, sessions) {
  const all = []; repos.forEach((r) => r.worktrees.forEach((w) => all.push(w)));
  const paths = all.map((w) => key(w.path) + path.sep);
  for (const p of procs) {
    if (!p.cwd || p.system) continue;
    const here = key(p.cwd) + path.sep;
    // Un worktree puede estar adentro de otro: gana la carpeta mas especifica.
    let best = -1;
    paths.forEach((wp, i) => { if (here.startsWith(wp) && (best < 0 || wp.length > paths[best].length)) best = i; });
    if (best < 0) continue;
    const agent = sessions.get(p.pid) || '';
    const label = agent || String(p.name).replace(/\.exe$/i, '');
    const slot = all[best].busy.find((b) => b.name === label);
    if (slot) slot.count++; else all[best].busy.push({ name: label, agent: !!agent, count: 1 });
  }
  all.forEach((w) => w.busy.sort((a, b) => (b.agent - a.agent) || (b.count - a.count)));
  return repos;
}

let cache = null;
async function list(folders) {
  const stamp = folders.join('|');
  if (cache && cache.stamp === stamp && Date.now() - cache.at < 15000) return JSON.parse(cache.json);
  const seen = new Set(); const repos = [];
  const lists = await pool(candidates(folders), 6, async (dir) => parseWorktrees(await git(dir, ['worktree', 'list', '--porcelain'])));
  for (const wts of lists) {
    if (!wts.length || seen.has(key(wts[0].path))) continue; // el primero es el principal: un repo visto desde dos worktrees es uno solo
    seen.add(key(wts[0].path));
    repos.push({ name: path.basename(wts[0].path), path: wts[0].path, worktrees: wts.slice(0, 120) });
  }
  const flat = []; repos.forEach((r) => r.worktrees.forEach((w, i) => flat.push([r, i])));
  await pool(flat, 6, async ([r, i]) => { r.worktrees[i] = await one(r.worktrees[i]); r.worktrees[i].main = i === 0; });
  repos.sort((a, b) => a.name.localeCompare(b.name));
  cache = { stamp, at: Date.now(), json: JSON.stringify(repos) };
  return repos;
}

module.exports = { parseWorktrees, parseStatus, candidates, attach, list };
