#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { NAME, CMD } = require('../src/name');

const ES = /^es\b/i.test(process.env.SHARPMD_LOCAL_LANG || Intl.DateTimeFormat().resolvedOptions().locale || '');
const t = (en, es) => (ES ? es : en);
const say = (s) => process.stdout.write(s + '\n');

const HELP = t(`${NAME}

  ${CMD}                  start (Ctrl+C stops it)
  ${CMD} --read-only      start without the close actions
  ${CMD} token            show the pairing code
  ${CMD} token --new      make a new one (what was paired stops working)
  ${CMD} folders          list the folders the program may look at
  ${CMD} folders add <folder>
  ${CMD} folders remove <folder>
`, `${NAME}

  ${CMD}                  arranca (Ctrl+C lo apaga)
  ${CMD} --read-only      arranca sin las acciones de cerrar
  ${CMD} token            muestra el código de emparejamiento
  ${CMD} token --new      crea uno nuevo (lo ya emparejado deja de entrar)
  ${CMD} folders          lista las carpetas que el programa puede mirar
  ${CMD} folders add <carpeta>
  ${CMD} folders remove <carpeta>
`);

const args = process.argv.slice(2);
const cmd = args[0] && args[0][0] !== '-' ? args[0] : 'start';
const code = (cfg, token) => cfg.port + '.' + token;

async function main() {
  const cfg = config.load();
  if (cfg.error) say(t('config.json has an error, defaults are used: ', 'config.json tiene un error, se usan los valores por defecto: ') + cfg.error);

  if (args.includes('--help') || args.includes('-h') || cmd === 'help') return say(HELP);

  if (cmd === 'token') {
    const tk = config.token(args.includes('--new'));
    say(t('Pairing code:', 'Código de emparejamiento:'));
    return say('  ' + code(cfg, tk));
  }

  if (cmd === 'folders') {
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    let list = cfg.folders.slice();
    if (args[1] === 'add' || args[1] === 'remove') {
      if (!args[2]) return say(HELP);
      const dir = path.resolve(args[2]);
      if (args[1] === 'add') {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { say(t('That folder does not exist: ', 'Esa carpeta no existe: ') + dir); process.exitCode = 1; return; }
        if (!list.some((x) => same(x, dir))) list.push(dir);
      } else list = list.filter((x) => !same(x, dir));
      config.save({ folders: list });
    }
    if (!list.length) return say(t('No folders yet. Worktrees and showing a file in the file manager need one.', 'Todavía no hay carpetas. Worktrees y mostrar un archivo en el explorador necesitan una.'));
    return list.forEach((x) => say('  ' + x));
  }

  if (cmd !== 'start') { say(HELP); process.exitCode = 1; return; }

  if (args.includes('--read-only')) cfg.allowClose = false;
  const token = config.token(false);
  const { create, VERSION } = require('../src/server');
  const stamp = () => new Date().toTimeString().slice(0, 8);
  const app = create({ cfg, token, fixed: args.includes('--read-only'), log: (m) => say('  [' + stamp() + '] ' + m) });
  try { await app.listen(); } catch (e) {
    say(e.code === 'EADDRINUSE'
      ? t('Port ' + cfg.port + ' is taken. ' + NAME + ' may already be running; or change "port" in ', 'El puerto ' + cfg.port + ' está ocupado. Puede que ' + NAME + ' ya esté corriendo; o cambiá "port" en ') + path.join(config.home(), 'config.json')
      : String(e.message));
    process.exitCode = 1; return;
  }
  say('');
  say('  ' + NAME + ' ' + VERSION);
  say('  ' + t('Listening on this machine only: ', 'Escucha solo en esta máquina: ') + 'http://127.0.0.1:' + cfg.port);
  say('  ' + (cfg.allowClose ? t('Close actions: on (each one asks first).', 'Acciones de cerrar: prendidas (cada una pregunta antes).') : t('Read only: nothing can be closed from outside.', 'Solo lectura: no se puede cerrar nada desde afuera.')));
  say('');
  say('  ' + t('Pairing code (paste it once in SharpMD, Settings > Tools):', 'Código de emparejamiento (se pega una vez en SharpMD, Ajustes > Herramientas):'));
  say('    ' + code(cfg, token));
  say('');
  say('  ' + t('Panel on this machine, for any browser:', 'Panel en esta máquina, para cualquier navegador:'));
  say('    http://127.0.0.1:' + cfg.port + '/#t=' + token);
  say('');
  say('  ' + t('Ctrl+C stops it. Settings: ', 'Ctrl+C lo apaga. Configuración: ') + path.join(config.home(), 'config.json'));
  say('');
  let closing = false;
  const stop = () => { if (closing) return; closing = true; app.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
}

main().catch((e) => { say(String((e && e.stack) || e)); process.exitCode = 1; });
