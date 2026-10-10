'use strict';
// Configuracion y token. Todo vive en una carpeta del usuario, fuera del
// programa: ~/.sharpmd-local/ (o la que diga SHARPMD_LOCAL_HOME).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { HOME } = require('./name');

const home = () => process.env.SHARPMD_LOCAL_HOME || path.join(os.homedir(), HOME);

const DEFAULTS = {
  port: 7717,
  // Quien puede hablarle desde un navegador. Lista cerrada: la web y la extension.
  origins: ['https://sharpmd.app', 'chrome-extension://ejgkmgehiacbnfognldclppemehapcek'],
  // false deja todo de solo lectura: no se cierra nada desde afuera.
  allowClose: true,
  // Pedirle la portada a cada servidor de desarrollo para leer su titulo.
  probeHttp: true,
  // Leer la carpeta de trabajo de los procesos (hace falta para saber de que proyecto son).
  readCwd: true,
  // Mostrar el titulo de cada sesion de agente (sale de su propio registro de conversacion).
  agentTitles: true,
  // false: no abre el explorador de archivos a pedido.
  allowReveal: true,
  // Las carpetas que el programa puede mirar: de ahi salen los worktrees (un repositorio, o una carpeta con
  // repositorios adentro) y solo adentro de ellas muestra un archivo en el explorador. Vacio: no mira nada.
  folders: [],
  // Agentes de IA a seguir. process es el nombre del ejecutable; sessionPattern
  // separa las sesiones del resto de procesos con ese nombre; idPattern saca el
  // id de la conversacion de la linea de comandos y transcripts dice donde se
  // guardan (relativo a la carpeta del usuario).
  agents: [
    { name: 'Claude Code', on: true, process: 'claude', sessionPattern: 'output-format[ =]+stream-json|--resume|--session-id', idPattern: '--(?:resume|session-id)[= ]+([0-9a-f-]{36})', transcripts: '.claude/projects' },
    { name: 'Codex', on: false, process: 'codex' },
    { name: 'Gemini CLI', on: false, process: 'gemini' },
    { name: 'Aider', on: false, process: 'aider' },
    { name: 'Cursor', on: false, process: 'cursor', sessionPattern: 'extensionHost' },
  ],
};

const file = (name) => path.join(home(), name);

function load() {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  let error = '';
  try {
    const own = JSON.parse(fs.readFileSync(file('config.json'), 'utf8'));
    for (const k of Object.keys(DEFAULTS)) if (own[k] !== undefined && typeof own[k] === typeof DEFAULTS[k] && Array.isArray(own[k]) === Array.isArray(DEFAULTS[k])) cfg[k] = own[k];
  } catch (e) { if (e.code !== 'ENOENT') error = e.message; }
  cfg.port = Number(process.env.SHARPMD_LOCAL_PORT || cfg.port);
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) cfg.port = DEFAULTS.port;
  cfg.origins = cfg.origins.filter((o) => typeof o === 'string' && /^(https:\/\/|chrome-extension:\/\/|moz-extension:\/\/)[^/\s]+$/.test(o));
  cfg.folders = cfg.folders.filter((p) => typeof p === 'string' && path.isAbsolute(p));
  cfg.agents = cfg.agents.filter((a) => a && typeof a.name === 'string' && typeof a.process === 'string');
  cfg.error = error;
  return cfg;
}

function save(partial) {
  fs.mkdirSync(home(), { recursive: true });
  let own = {};
  try { own = JSON.parse(fs.readFileSync(file('config.json'), 'utf8')); } catch (e) { /* todavia no hay */ }
  fs.writeFileSync(file('config.json'), JSON.stringify(Object.assign(own, partial), null, 2) + '\n');
}

// El token de emparejamiento: se crea la primera vez y queda en un archivo que
// solo lee el usuario. fresh lo cambia (lo que estaba emparejado deja de entrar).
function token(fresh) {
  if (!fresh) {
    try { const t = fs.readFileSync(file('token'), 'utf8').trim(); if (/^[A-Za-z0-9_-]{40,}$/.test(t)) return t; } catch (e) { /* no hay: se crea */ }
  }
  const t = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(file('token'), t + '\n', { mode: 0o600 });
  try { fs.chmodSync(file('token'), 0o600); } catch (e) { /* Windows: el perfil ya es privado */ }
  return t;
}

module.exports = { DEFAULTS, home, load, save, token };
