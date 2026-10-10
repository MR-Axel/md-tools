'use strict';
// "Mostrar en el Explorador": abre el explorador de archivos del sistema con un archivo seleccionado, o adentro de una
// carpeta. Es lo único que
// este programa hace con una ruta que viene de afuera, así que la regla es corta y cerrada:
//
//   - la ruta tiene que ser absoluta, sin caracteres de control ni comillas, y de hasta 1024 caracteres;
//   - tiene que existir y ser un archivo o una carpeta (no un dispositivo ni otra cosa);
//   - se resuelve del todo (enlaces simbólicos y "..") y lo resuelto tiene que quedar adentro de una de las carpetas
//     que la persona sumó con `folders add`, o ser una de ellas si es una carpeta. Sin carpetas sumadas no se muestra nada;
//   - el explorador se lanza con la ruta como argumento, sin consola de por medio: no hay intérprete que pueda leer
//     la ruta como una orden. Y no se lanza ninguna otra cosa: no se abre el archivo, no se ejecuta nada.
const fs = require('fs');
const nodePath = require('path');
const { spawn } = require('child_process');

const key = (p, win) => (win ? p.toLowerCase() : p);
function inside(child, parent, win) {
  const sep = win ? '\\' : '/';
  const c = key(child, win); const p = key(parent, win).replace(/[\\/]+$/, '');
  return c.startsWith(p + sep);
}

// Devuelve { file } con la ruta ya resuelta (y dir: true si es una carpeta), o { status, error } con el motivo.
function check(input, folders, platform) {
  const win = (platform || process.platform) === 'win32';
  const P = win ? nodePath.win32 : nodePath.posix;
  if (typeof input !== 'string' || !input || input.length > 1024 || /[\u0000-\u001f\u007f"]/.test(input) || !P.isAbsolute(input)) return { status: 400, error: 'bad-path' };
  if (win) {
    // Solo rutas de disco: nada de la red (\\servidor\...), de dispositivos (\\?\, \\.\) ni de flujos alternativos (archivo:otro).
    if (!/^[A-Za-z]:[\\/]/.test(input) || input.slice(2).includes(':')) return { status: 400, error: 'bad-path' };
  }
  if (!Array.isArray(folders) || !folders.length) return { status: 403, error: 'no-folders' };
  let real;
  try { real = fs.realpathSync.native(input); } catch (e) { return { status: 404, error: 'missing' }; }
  let stat;
  try { stat = fs.statSync(real); } catch (e) { return { status: 404, error: 'missing' }; }
  const dir = stat.isDirectory();
  if (!dir && !stat.isFile()) return { status: 400, error: 'not-a-file' };
  if (/["\u0000-\u001f]/.test(real)) return { status: 400, error: 'bad-path' };
  // Una carpeta sumada se puede abrir ella misma; un archivo tiene que estar adentro.
  const same = (a, b) => key(a, win).replace(/[\\/]+$/, '') === key(b, win).replace(/[\\/]+$/, '');
  const ok = folders.some((f) => { try { const base = fs.realpathSync.native(f); return inside(real, base, win) || (dir && same(real, base)); } catch (e) { return false; } });
  if (!ok) return { status: 403, error: 'outside' };
  return dir ? { file: real, dir: true } : { file: real };
}

// Qué se lanza para una ruta: el programa y sus argumentos, como lista. Un archivo queda seleccionado en su carpeta;
// una carpeta se abre por dentro. Separado de open para poder probarlo sin abrir nada.
function command(file, dir, platform) {
  const os = platform || process.platform;
  if (dir) {
    if (os === 'win32') return { cmd: 'explorer.exe', args: ['"' + file + '"'], verbatim: true };
    return { cmd: os === 'darwin' ? 'open' : 'xdg-open', args: [file] };
  }
  if (os === 'win32') return { cmd: 'explorer.exe', args: ['/select,"' + file + '"'], verbatim: true };
  if (os === 'darwin') return { cmd: 'open', args: ['-R', file] };
  return { cmd: 'xdg-open', args: [nodePath.dirname(file)] }; // en Linux no hay una forma común de seleccionar: se abre su carpeta
}

// Lanza el explorador. La ruta ya pasó por check: existe, es un archivo o una carpeta y no tiene comillas.
function open(file, dir) {
  if (dir) {
    const c = command(file, true); const o = { detached: true, stdio: 'ignore', windowsHide: false };
    if (c.verbatim) o.windowsVerbatimArguments = true;
    const child = spawn(c.cmd, c.args, o);
    child.on('error', () => {});
    child.unref();
    return;
  }
  let cmd; let args; const opts = { detached: true, stdio: 'ignore', windowsHide: false };
  if (process.platform === 'win32') {
    // El Explorador lee su propia línea: /select,"ruta". Se le pasa tal cual (sin que Node la vuelva a entrecomillar).
    cmd = 'explorer.exe'; args = ['/select,"' + file + '"']; opts.windowsVerbatimArguments = true;
  } else if (process.platform === 'darwin') { cmd = 'open'; args = ['-R', file]; }
  else { cmd = 'xdg-open'; args = [nodePath.dirname(file)]; } // en Linux no hay una forma común de seleccionar: se abre su carpeta
  const child = spawn(cmd, args, opts);
  child.on('error', () => {});
  child.unref();
}

module.exports = { check, open, inside, command };
