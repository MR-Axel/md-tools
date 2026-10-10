'use strict';
// Windows: los puertos salen de netstat y los procesos de un PowerShell que
// queda vivo (collector.ps1) y contesta cuando se le pide.
const path = require('path');
const { spawn, execFile } = require('child_process');

// Una fila en escucha de `netstat -ano`. La palabra del estado cambia con el
// idioma de Windows; lo que no cambia es que quien escucha tiene del otro lado
// el puerto 0.
//   TCP    0.0.0.0:135     0.0.0.0:0     LISTENING     1320
//   TCP    [::1]:5173      [::]:0        LISTENING     4242
function parseNetstat(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(?:\S+\s+)?(\d+)\s*$/i);
    if (!m || m[4] !== '0') continue;
    const address = m[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    out.push({ address, port: Number(m[2]), pid: Number(m[5]) });
  }
  return out;
}

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeout || 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function listeners() {
  const [v4, v6] = await Promise.all([run('netstat', ['-ano', '-p', 'TCP']), run('netstat', ['-ano', '-p', 'TCPv6'])]);
  return parseNetstat(v4).concat(parseNetstat(v6));
}

// La carpeta sin la barra final, salvo la raiz de un disco ("C:\"), que sin la barra es otra cosa.
const tidy = (dir) => { const d = String(dir || '').replace(/[\\/]+$/, ''); return /^[A-Za-z]:$/.test(d) ? d + '\\' : d; };

// Lo que devuelve el recolector, ya normalizado.
function parseProcs(line) {
  let data;
  try { data = JSON.parse(line); } catch (e) { return null; }
  if (!data || !Array.isArray(data.procs)) return null;
  return data.procs.filter((p) => p && Number.isInteger(p.pid)).map((p) => ({
    pid: p.pid, ppid: p.ppid || 0, name: String(p.name || ''), cmd: p.cmd || '', exe: p.exe || '',
    cwd: tidy(p.cwd),
    start: p.start || '', mem: Number(p.mem) || 0, cpu: Number(p.cpu) || 0, system: p.session === 0 || p.pid <= 4,
  }));
}

let worker = null; let buffer = ''; let waiting = []; let hasCwd = false;
function startWorker(opts) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'collector.ps1')];
  if (opts && opts.readCwd === false) args.push('-SinCarpeta');
  const w = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  buffer = '';
  w.stdout.setEncoding('utf8');
  w.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line) continue;
      if (line.startsWith('{"ready"')) { hasCwd = /"cwd":true/.test(line); continue; }
      const next = waiting.shift(); if (next) next(parseProcs(line) || []);
    }
  });
  const gone = () => { if (worker === w) worker = null; waiting.splice(0).forEach((f) => f([])); };
  w.on('exit', gone); w.on('error', gone);
  w.stdin.on('error', () => {});
  return w;
}

function processes(opts) {
  return new Promise((resolve) => {
    if (!worker) worker = startWorker(opts);
    const timer = setTimeout(() => { const i = waiting.indexOf(done); if (i >= 0) waiting.splice(i, 1); resolve([]); }, 20000);
    const done = (list) => { clearTimeout(timer); resolve(list); };
    waiting.push(done);
    try { worker.stdin.write('scan\n'); } catch (e) { done([]); }
  });
}

// Cierra un proceso con todo lo que lanzo. Los servidores de consola no tienen
// ventana a la que pedirle que cierre, asi que es forzado.
async function killTree(pid) {
  await run('taskkill', ['/PID', String(pid), '/T', '/F'], 10000);
}

function stop() { if (worker) { try { worker.stdin.end(); worker.kill(); } catch (e) { /* ya no estaba */ } worker = null; } }

module.exports = { parseNetstat, parseProcs, listeners, processes, killTree, stop, capabilities: () => ({ cwd: hasCwd }) };
