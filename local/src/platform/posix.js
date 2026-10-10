'use strict';
// Linux y macOS. Escrito contra el formato documentado de ss, lsof y ps y
// probado solo con salidas de ejemplo: falta correrlo en maquinas reales
// (ver README, "Plataformas").
const fs = require('fs');
const { execFile } = require('child_process');

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeout || 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout)));
  });
}

// Linux: `ss -H -ltnp`
//   LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=23))
function parseSs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[0] !== 'LISTEN') continue;
    const m = f[3].match(/^(.*):(\d+)$/); if (!m) continue;
    const address = m[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/^\*$/, '0.0.0.0');
    const pids = new Set(); const re = /pid=(\d+)/g; let p;
    while ((p = re.exec(line))) pids.add(Number(p[1]));
    pids.forEach((pid) => out.push({ address, port: Number(m[2]), pid }));
  }
  return out;
}

// macOS: `lsof -nP -iTCP -sTCP:LISTEN -F pn` da un renglon por campo:
//   p4242
//   n127.0.0.1:5173
function parseLsof(text) {
  const out = []; let pid = 0;
  for (const line of String(text).split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) {
      const m = line.slice(1).match(/^(.*):(\d+)$/); if (!m) continue;
      out.push({ address: m[1].replace(/^\[|\]$/g, '').replace(/^\*$/, '0.0.0.0'), port: Number(m[2]), pid });
    }
  }
  return out;
}

// `ps -eo pid=,ppid=,uid=,rss=,etimes=,comm=,args=` no sirve igual en los dos:
// macOS no tiene etimes. Se pide lstart, que esta en ambos y ocupa 5 palabras.
//   4242  4100  501  81234 Mon Sep  1 10:20:30 2025 node /home/u/app/server.js
function parsePs(text, myUid) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (!m) continue;
    const cmd = m[6]; const first = cmd.split(/\s+/)[0] || '';
    const when = new Date(m[5]);
    out.push({
      pid: Number(m[1]), ppid: Number(m[2]), name: first.split('/').pop(), cmd: cmd.slice(0, 1500), exe: first[0] === '/' ? first : '',
      cwd: '', start: isNaN(when) ? '' : when.toISOString(), mem: Number(m[4]) * 1024, cpu: 0,
      system: myUid != null && Number(m[3]) !== myUid,
    });
  }
  return out;
}

async function listeners() {
  if (process.platform === 'linux') return parseSs(await run('ss', ['-H', '-ltnp']));
  return parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']));
}

async function processes() {
  const uid = process.getuid ? process.getuid() : null;
  const list = parsePs(await run('ps', ['-axo', 'pid=,ppid=,uid=,rss=,lstart=,args=']), uid);
  const mine = list.filter((p) => !p.system);
  if (process.platform === 'linux') {
    for (const p of mine) { try { p.cwd = fs.readlinkSync('/proc/' + p.pid + '/cwd'); } catch (e) { /* no es nuestro */ } }
  } else if (mine.length) {
    // macOS: la carpeta de trabajo sale de lsof, de todos juntos.
    const text = await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', mine.map((p) => p.pid).join(',')]);
    let pid = 0; const by = new Map(mine.map((p) => [p.pid, p]));
    for (const line of text.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1));
      else if (line[0] === 'n' && by.has(pid)) by.get(pid).cwd = line.slice(1);
    }
  }
  return list;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
async function killTree(pid) {
  // Primero se pide; si a los dos segundos sigue, se corta.
  try { process.kill(pid, 'SIGTERM'); } catch (e) { return; }
  for (let i = 0; i < 10 && alive(pid); i++) await new Promise((r) => setTimeout(r, 200));
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* se fue justo */ } }
}

module.exports = { parseSs, parseLsof, parsePs, listeners, processes, killTree, stop: () => {}, capabilities: () => ({ cwd: true }) };
