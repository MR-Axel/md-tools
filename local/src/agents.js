'use strict';
// Bloque "Agentes": las sesiones de agentes de IA abiertas en la maquina, con
// la memoria que usa cada una (la sesion mas lo que lanzo: sus servidores MCP,
// sus consolas). Un agente es un nombre de ejecutable y, si hace falta, un
// patron de su linea de comandos: los CLI suelen compartir el binario con la
// app de escritorio, y sumar las dos cosas da un numero que no dice nada.
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseName = (name) => String(name || '').toLowerCase().replace(/\.exe$/, '');
const regex = (src) => { try { return src ? new RegExp(src, 'i') : null; } catch (e) { return null; } };
const MB = (bytes) => Math.round(bytes / 1048576);

// procs -> [{ name, process, sessions: [...], otherProcs, otherMB }]
function find(agents, procs) {
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const tree = (pid, seen) => {
    let all = [];
    for (const k of kids.get(pid) || []) { if (seen.has(k.pid)) continue; seen.add(k.pid); all.push(k); all = all.concat(tree(k.pid, seen)); }
    return all;
  };
  const out = [];
  for (const ag of agents) {
    if (!ag.on) continue;
    const mine = procs.filter((p) => baseName(p.name) === baseName(ag.process) && !p.system);
    if (!mine.length) continue;
    const isSession = regex(ag.sessionPattern); const idRe = regex(ag.idPattern);
    const sessions = []; let otherProcs = 0; let otherBytes = 0;
    for (const p of mine) {
      if (isSession && !isSession.test(p.cmd || '')) { otherProcs++; otherBytes += p.mem; continue; }
      // Todo lo que la sesion lanzo, directo o no: sus servidores MCP, sus consolas.
      const below = tree(p.pid, new Set([p.pid]));
      const m = idRe ? idRe.exec(p.cmd || '') : null;
      sessions.push({
        agent: ag.name, pid: p.pid, started: p.start, id: m ? m[1] : '',
        cwd: p.cwd || '', project: p.cwd ? path.basename(p.cwd.replace(/[\\/]+$/, '')) : '',
        memoryMB: MB(p.mem), childrenMB: MB(below.reduce((t, k) => t + k.mem, 0)), children: below.length,
        cpuSeconds: p.cpu, title: '', lastActivity: '', active: null,
      });
    }
    out.push({ name: ag.name, process: ag.process, transcripts: ag.transcripts || '', sessions, otherProcs, otherMB: MB(otherBytes) });
  }
  return out;
}

// ---------- titulo y ultima actividad, del registro de la conversacion ----------
const found = new Map(); // id -> { file, title }

function locate(root, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return '';
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return ''; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(root, d.name, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return '';
}

// El titulo: el que el agente le puso a la conversacion o, si no, el primer
// mensaje de la persona, recortado. Se lee solo el principio del archivo: una
// conversacion larga pesa cientos de megas.
function titleFrom(text) {
  let named = ''; let first = '';
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch (e) { continue; }
    if (typeof j.customTitle === 'string' && j.customTitle) named = j.customTitle;
    else if (typeof j.aiTitle === 'string' && j.aiTitle) named = j.aiTitle;
    else if (j.type === 'summary' && typeof j.summary === 'string') named = j.summary;
    if (!first && j.type === 'user' && j.message && j.message.content) {
      const c = j.message.content;
      const t = typeof c === 'string' ? c : ((Array.isArray(c) ? c.find((x) => x && x.type === 'text') : null) || {}).text;
      const clean = String(t || '').replace(/\s+/g, ' ').trim();
      // Los avisos del sistema no sirven de titulo.
      if (clean.length > 3 && clean[0] !== '<') first = clean;
    }
  }
  const title = named || first;
  return title.length > 70 ? title.slice(0, 69) + '…' : title;
}

function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    const text = buf.toString('utf8', 0, n);
    return n < bytes ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  } catch (e) { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* nada */ } }
}

// Una sesion abierta no es una sesion trabajando. Se mira cuanto procesador
// gasto entre una lectura y la siguiente: trabajando usa una parte apreciable
// de un nucleo; esperando, casi nada.
const lastCpu = new Map(); // pid -> { at, cpu, start }
function activity(sessions, now) {
  const seen = new Set();
  for (const s of sessions) {
    seen.add(s.pid);
    const was = lastCpu.get(s.pid);
    if (was && was.start === s.started && now - was.at >= 4000 && now - was.at < 180000) {
      s.active = (s.cpuSeconds - was.cpu) / ((now - was.at) / 1000) >= 0.04;
    }
    if (!was || was.start !== s.started || now - was.at >= 4000) lastCpu.set(s.pid, { at: now, cpu: s.cpuSeconds, start: s.started });
  }
  for (const pid of lastCpu.keys()) if (!seen.has(pid)) lastCpu.delete(pid);
}

// Una sesion nueva no lleva el id de su conversacion en la linea de comandos.
// Su registro es, en la carpeta de registros de su proyecto, el primero que
// nacio despues de que ella arranco y que no es de otra sesion.
const guessed = new Map(); // pid|inicio -> archivo
function guess(root, sessions) {
  const taken = new Set(Array.from(found.values()).map((h) => h.file).concat(Array.from(guessed.values())));
  const pending = sessions.filter((s) => !s.id && s.cwd && s.started && !guessed.has(s.pid + '|' + s.started)).sort((x, y) => Date.parse(x.started) - Date.parse(y.started));
  if (!pending.length) return;
  let dirs; try { dirs = fs.readdirSync(root); } catch (e) { return; }
  for (const s of pending) {
    const want = s.cwd.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
    const dir = dirs.find((d) => d.toLowerCase() === want); if (!dir) continue;
    let best = null;
    try {
      for (const f of fs.readdirSync(path.join(root, dir))) {
        if (!/^[0-9a-f-]{36}\.jsonl$/i.test(f)) continue;
        const file = path.join(root, dir, f); if (taken.has(file)) continue;
        const born = fs.statSync(file).birthtimeMs;
        if (born >= Date.parse(s.started) - 2000 && (!best || born < best.born)) best = { file, born };
      }
    } catch (e) { continue; }
    if (best) { guessed.set(s.pid + '|' + s.started, best.file); taken.add(best.file); }
  }
}

function enrich(groups, opts) {
  const now = Date.now();
  for (const g of groups) {
    activity(g.sessions, now);
    if (!g.transcripts) continue;
    const root = path.join(os.homedir(), g.transcripts);
    guess(root, g.sessions);
    for (const s of g.sessions) {
      const key = s.id || guessed.get(s.pid + '|' + s.started); if (!key) continue;
      let hit = found.get(key);
      if (!hit) { const file = s.id ? locate(root, s.id) : key; if (!file) continue; hit = { file, title: '' }; found.set(key, hit); }
      try { s.lastActivity = fs.statSync(hit.file).mtime.toISOString(); } catch (e) { found.delete(key); continue; }
      if (opts && opts.titles === false) continue;
      // Una conversacion recien abierta todavia no tiene titulo: se vuelve a mirar hasta que lo tenga.
      if (!hit.title) hit.title = titleFrom(readHead(hit.file, 512 * 1024));
      s.title = hit.title;
    }
  }
  return groups;
}

module.exports = { find, enrich, titleFrom, activity, baseName };
