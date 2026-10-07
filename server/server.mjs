// SharpMD Sync: notas en la nube y servidor MCP, en un solo archivo y sin dependencias.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Requiere Node 22.13 o superior (usa node:sqlite). Se configura con variables de entorno:
//   PORT            puerto local (8787)
//   DATA_DIR        carpeta de la base (./data)
//   PUBLIC_URL      dirección pública del servicio, la que se muestra para conectar una IA
//   ALLOW_ORIGINS   orígenes web permitidos, separados por coma. Las extensiones entran siempre
//   RESEND_API_KEY  manda el código de acceso por Resend (con MAIL_FROM)
//   MAIL_WEBHOOK    o lo manda a un webhook propio: POST { to, subject, text }
//   DEV_CODES=1     sin correo: el código vuelve en la respuesta (solo para pruebas)
//   FREE_NOTES      notas del plan gratis (10)
//   MCP_FREE=1      habilita el MCP también en el plan gratis
//   SHARE_FREE=1    habilita compartir también en el plan gratis
//   CHECKOUT_MONTHLY, CHECKOUT_YEARLY   enlaces de pago que la app muestra en Ajustes → Plan
//   ADMIN_KEY       clave para cambiar el plan de una cuenta desde /admin/plan
//   TEST_LOGIN      correo:123456 de una cuenta de prueba que entra con ese código fijo, sin correo (para revisiones de tienda)
//   PADDLE_WEBHOOK_SECRET   firma de los avisos de Paddle: con esto /paddle/webhook activa y da de baja el plan pago
//   PORTAL_URL      dirección donde quien paga administra su suscripción
//   FEEDBACK_TO     correo que recibe los comentarios y reportes de error de POST /feedback. Sin esto, responde 404
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const env = process.env;
const PORT = +(env.PORT || 8787);
const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), 'data');
const PUBLIC_URL = (env.PUBLIC_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const ORIGINS = (env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FREE_NOTES = +(env.FREE_NOTES || 10);
const TEST_LOGIN = /^[^\s:]+@[^\s:]+:\d{6}$/.test(env.TEST_LOGIN || '') ? [env.TEST_LOGIN.split(':')[0].toLowerCase(), env.TEST_LOGIN.split(':')[1]] : null;
const MAX_NOTE = 1024 * 1024; // 1 MB por nota
const HISTORY_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'mdtools.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, plan TEXT NOT NULL DEFAULT 'free', created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user INTEGER NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, user INTEGER NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER);
  CREATE TABLE IF NOT EXISTS notes (user INTEGER NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user, path));
  CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, saved INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS versions_note ON versions (user, path, saved);
  CREATE TABLE IF NOT EXISTS shares (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (owner, path, email));
  CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, owner INTEGER NOT NULL, path TEXT NOT NULL, pass TEXT, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
`);
try { db.exec('ALTER TABLE users ADD COLUMN paddle_sub TEXT'); } catch (e) { /* ya estaba */ }
const q = (sql) => db.prepare(sql);
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

class Fail extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }

// ---------- Correo ----------
// El correo del código: inglés por defecto, español si la app lo pide. Va en HTML y en texto plano.
const MAIL = {
  en: { subject: 'Your SharpMD code: ', lead: 'Your sign-in code', note: 'It expires in 15 minutes. If you did not ask for it, you can ignore this email.', text: (c) => 'Your SharpMD code is ' + c + '. It expires in 15 minutes.\n\nIf you did not ask for it, you can ignore this email.' },
  es: { subject: 'Tu código de SharpMD: ', lead: 'Tu código para entrar', note: 'Vence en 15 minutos. Si no lo pediste, podés ignorar este correo.', text: (c) => 'Tu código de SharpMD es ' + c + '. Vence en 15 minutos.\n\nSi no lo pediste, podés ignorar este correo.' },
};
const mailHtml = (m, code) => '<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2026">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;background:#ffffff;border:1px solid #dedbd2;border-radius:14px">' +
  '<tr><td style="padding:28px 32px 8px;font-size:17px;font-weight:700;letter-spacing:-0.01em"><span style="color:#4d7c0f">#</span> SharpMD</td></tr>' +
  '<tr><td style="padding:8px 32px 0;font-size:15px;color:#5c6370">' + m.lead + '</td></tr>' +
  '<tr><td style="padding:14px 32px 6px"><div style="padding:16px 0;border-radius:10px;background:#f1efe9;text-align:center;font:700 32px/1 ui-monospace,Consolas,Menlo,monospace;letter-spacing:0.28em;color:#1d2026">' + code + '</div></td></tr>' +
  '<tr><td style="padding:12px 32px 28px;font-size:13.5px;line-height:1.5;color:#8a909c">' + m.note + '</td></tr>' +
  '</table><div style="padding-top:14px;font-size:12px;color:#8a909c">sharpmd.app</div></td></tr></table></body></html>';

// Sale por Resend o por el webhook propio. Devuelve false si no hay con qué mandar.
async function sendMail(mail) {
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: env.MAIL_FROM || 'SharpMD <onboarding@resend.dev>' }, mail, { to: [mail.to] })) });
    if (!r.ok) throw new Fail(502, 'mail_failed');
  } else if (env.MAIL_WEBHOOK) {
    const r = await fetch(env.MAIL_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mail) });
    if (!r.ok) throw new Fail(502, 'mail_failed');
  } else return false;
  return true;
}

async function sendCode(email, code, lang) {
  const m = MAIL[lang === 'es' ? 'es' : 'en'];
  const sent = await sendMail({ to: email, subject: m.subject + code, text: m.text(code), html: mailHtml(m, code) });
  if (!sent && !env.DEV_CODES) throw new Fail(500, 'mail_not_configured');
}

// ---------- Cuentas ----------
// Un correo bien formado: sin espacios, una sola arroba, el nombre sin puntos al borde ni dobles, y un
// dominio de etiquetas válidas que termina en letras. La app usa la misma regla antes de pedir el código.
function validEmail(e) {
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(e);
  if (!m || e.length > 200 || /^\.|\.$|\.\./.test(m[1]) || /[(),:;<>[\]\\"]/.test(m[1])) return false;
  const labels = m[2].split('.');
  return labels.length > 1 && labels.every((l) => /^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(l)) && /^(\p{L}{2,}|xn--[a-z0-9-]+)$/iu.test(labels[labels.length - 1]);
}
const cleanEmail = (v) => { const e = String(v || '').trim().toLowerCase(); if (!validEmail(e)) throw new Fail(400, 'bad_email'); return e; };

async function authStart(body) {
  const email = cleanEmail(body.email);
  // Cuenta de prueba para quien revisa la app en una tienda: código fijo, sin correo. Es una sola cuenta, sin datos de nadie.
  const fixed = TEST_LOGIN && email === TEST_LOGIN[0] ? TEST_LOGIN[1] : '';
  const prev = q('SELECT sent FROM codes WHERE email = ?').get(email);
  if (!fixed && prev && now() - prev.sent < 30000) throw new Fail(429, 'too_soon');
  const code = fixed || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  q('INSERT OR REPLACE INTO codes (email, hash, expires, tries, sent) VALUES (?, ?, ?, 0, ?)').run(email, sha(email + ':' + code), now() + 15 * 60000, now());
  if (fixed) return { ok: true };
  await sendCode(email, code, body.lang);
  return env.DEV_CODES ? { ok: true, dev_code: code } : { ok: true };
}

function authVerify(body) {
  const email = cleanEmail(body.email);
  const row = q('SELECT * FROM codes WHERE email = ?').get(email);
  if (!row || row.expires < now()) throw new Fail(400, 'code_expired');
  if (row.tries >= 6) throw new Fail(429, 'too_many_tries');
  if (row.hash !== sha(email + ':' + String(body.code || '').trim())) { q('UPDATE codes SET tries = tries + 1 WHERE email = ?').run(email); throw new Fail(400, 'bad_code'); }
  q('DELETE FROM codes WHERE email = ?').run(email);
  q('INSERT OR IGNORE INTO users (email, created) VALUES (?, ?)').run(email, now());
  const user = q('SELECT * FROM users WHERE email = ?').get(email);
  const session = 'mds_' + random(32);
  q('INSERT INTO sessions (hash, user, created, seen) VALUES (?, ?, ?, ?)').run(sha(session), user.id, now(), now());
  return { session, account: account(user) };
}

function userFrom(req, kind) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new Fail(401, 'no_auth');
  if (kind === 'session' && m[1].startsWith('mds_')) {
    const s = q('SELECT user FROM sessions WHERE hash = ?').get(sha(m[1]));
    if (s) { q('UPDATE sessions SET seen = ? WHERE hash = ?').run(now(), sha(m[1])); return q('SELECT * FROM users WHERE id = ?').get(s.user); }
  }
  if (kind === 'token' && m[1].startsWith('mdt_')) {
    const t = q('SELECT id, user FROM tokens WHERE hash = ?').get(sha(m[1]));
    if (t) { q('UPDATE tokens SET used = ? WHERE id = ?').run(now(), t.id); return q('SELECT * FROM users WHERE id = ?').get(t.user); }
  }
  throw new Fail(401, 'bad_auth');
}

const countNotes = (user) => q('SELECT COUNT(*) AS n FROM notes WHERE user = ?').get(user.id).n;
const mcpAllowed = (user) => user.plan === 'pro' || !!env.MCP_FREE;
const shareAllowed = (user) => user.plan === 'pro' || !!env.SHARE_FREE;
const account = (user) => ({ id: user.id, share: shareAllowed(user), email: user.email, plan: user.plan, notes: countNotes(user), limit: user.plan === 'pro' ? null : FREE_NOTES, mcp: mcpAllowed(user), mcp_url: PUBLIC_URL + '/mcp', manage: user.plan === 'pro' && env.PORTAL_URL ? env.PORTAL_URL : '',
  checkout: { monthly: env.CHECKOUT_MONTHLY ? env.CHECKOUT_MONTHLY + (env.CHECKOUT_MONTHLY.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(user.email) : '', yearly: env.CHECKOUT_YEARLY ? env.CHECKOUT_YEARLY + (env.CHECKOUT_YEARLY.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(user.email) : '' } });

// ---------- Comentarios ----------
// Lo que alguien escribe desde "Enviar comentarios" llega por correo a FEEDBACK_TO. Entra con o sin sesión.
// Tope de cinco por hora por IP y por cuenta. El servidor vive detrás de un proxy: la IP sale de
// x-forwarded-for, y de ahí la última, que es la que anota el proxy (las anteriores las escribe quien llama).
const FEEDBACK_MAX = 5; const HOUR = 3600000;
const sentBy = new Map();
const recent = (key) => (sentBy.get(key) || []).filter((t) => now() - t < HOUR);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';
async function feedback(req, body) {
  if (!env.FEEDBACK_TO || !(env.RESEND_API_KEY || env.MAIL_WEBHOOK || env.DEV_CODES)) throw new Fail(404, 'no_route');
  let user = null;
  if (req.headers.authorization) { try { user = userFrom(req, 'session'); } catch (e) { /* sesión vencida: entra como anónimo */ } }
  const text = String(body.text == null ? '' : body.text).trim();
  if (text.length < 5 || text.length > 4000) throw new Fail(400, 'bad_text');
  const from = user ? user.email : (String(body.email || '').trim() ? cleanEmail(body.email) : '');
  const keys = ['ip:' + clientIp(req)].concat(user ? ['user:' + user.id] : []);
  if (keys.some((k) => recent(k).length >= FEEDBACK_MAX)) throw new Fail(429, 'too_many');
  keys.forEach((k) => sentBy.set(k, recent(k).concat(now())));
  // Del contexto solo pasan estos cuatro datos, recortados: nada de notas ni de rutas.
  const c = body.context && typeof body.context === 'object' ? body.context : {};
  const field = (v, max) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max) || '-';
  const mail = { to: env.FEEDBACK_TO, subject: 'SharpMD feedback',
    text: text + '\n\n---\nFrom: ' + (from || 'anonymous') + (user ? ' (signed in, ' + user.plan + ' plan)' : '') +
      '\nVersion: ' + field(c.version, 40) + '\nWhere: ' + (c.where === 'extension' ? 'extension' : 'web') +
      '\nBrowser: ' + field(c.browser, 300) + '\nLanguage: ' + field(c.lang, 20) + '\n' };
  if (from) mail.reply_to = from;
  // Sin correo configurado y en modo de prueba no sale nada: alcanza para probar la app.
  if (!(await sendMail(mail))) return { ok: true, dev: true };
  return { ok: true };
}

// ---------- Notas ----------
function cleanPath(v) {
  const p = String(v || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!p || p.length > 300 || p.split('/').some((s) => !s || s === '.' || s === '..') || /[\x00-\x1f]/.test(p)) throw new Fail(400, 'bad_path');
  return p;
}
const listNotes = (user) => q('SELECT path, updated, LENGTH(text) AS size FROM notes WHERE user = ? ORDER BY updated DESC').all(user.id);
function readNote(user, p) {
  const n = q('SELECT path, text, updated FROM notes WHERE user = ? AND path = ?').get(user.id, cleanPath(p));
  if (!n) throw new Fail(404, 'not_found');
  return n;
}
function writeNote(user, p, text) {
  p = cleanPath(p); text = String(text == null ? '' : text);
  if (Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large');
  const prev = q('SELECT text FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  if (!prev && user.plan !== 'pro' && countNotes(user) >= FREE_NOTES) throw new Fail(402, 'note_limit', 'The free plan holds ' + FREE_NOTES + ' notes');
  // El historial es del plan pago: se guarda la versión anterior si cambió y pasó más de un minuto.
  if (prev && user.plan === 'pro' && prev.text !== text) {
    const last = q('SELECT saved FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 1').get(user.id, p);
    if (!last || now() - last.saved > 60000) q('INSERT INTO versions (user, path, text, saved) VALUES (?, ?, ?, ?)').run(user.id, p, prev.text, now());
  }
  q('INSERT INTO notes (user, path, text, updated) VALUES (?, ?, ?, ?) ON CONFLICT (user, path) DO UPDATE SET text = excluded.text, updated = excluded.updated').run(user.id, p, text, now());
  return { path: p, updated: now(), size: text.length };
}
function deleteNote(user, p) {
  const r = q('DELETE FROM notes WHERE user = ? AND path = ?').run(user.id, cleanPath(p));
  if (!r.changes) throw new Fail(404, 'not_found');
  return { ok: true };
}
function renameNote(user, from, to) {
  from = cleanPath(from); to = cleanPath(to);
  if (q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, to)) throw new Fail(409, 'exists');
  const r = q('UPDATE notes SET path = ?, updated = ? WHERE user = ? AND path = ?').run(to, now(), user.id, from);
  if (!r.changes) throw new Fail(404, 'not_found');
  // El historial, lo compartido y los enlaces públicos siguen a la nota.
  q('UPDATE versions SET path = ? WHERE user = ? AND path = ?').run(to, user.id, from);
  q("UPDATE OR REPLACE shares SET path = ? WHERE owner = ? AND path = ? AND kind != 'folder'").run(to, user.id, from);
  q('UPDATE links SET path = ? WHERE owner = ? AND path = ?').run(to, user.id, from);
  return { path: to };
}
function searchNotes(user, text) {
  const needle = String(text || '').toLowerCase(); if (!needle) return [];
  const out = [];
  for (const n of q('SELECT path, text FROM notes WHERE user = ?').all(user.id)) {
    const lines = n.text.split(/\r?\n/); const hits = [];
    for (let i = 0; i < lines.length && hits.length < 5; i++) if (lines[i].toLowerCase().includes(needle)) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) });
    if (hits.length || n.path.toLowerCase().includes(needle)) out.push({ path: n.path, hits });
    if (out.length >= 30) break;
  }
  return out;
}

// ---------- Compartir entre cuentas ----------
// Una nota o una carpeta se comparte con el correo de otra cuenta, para ver o para editar.
const covers = (share, p) => (share.kind === 'folder' ? p.startsWith(share.path + '/') : p === share.path);
function roleOn(user, ownerId, p) {
  if (ownerId === user.id) return 'owner';
  const hit = q('SELECT path, kind, role FROM shares WHERE owner = ? AND email = ?').all(ownerId, user.email).filter((s) => covers(s, p));
  if (!hit.length) return null;
  return hit.some((s) => s.role === 'edit') ? 'edit' : 'view';
}
// Dueño de la nota a la que apunta el pedido, y con qué permiso entra quien pide.
function target(user, url, p, need) {
  const ownerId = +(url.searchParams.get('o') || user.id);
  const role = roleOn(user, ownerId, p);
  if (!role || (need === 'edit' && role === 'view') || (need === 'owner' && role !== 'owner')) throw new Fail(403, 'no_access');
  return { owner: ownerId === user.id ? user : q('SELECT * FROM users WHERE id = ?').get(ownerId), role };
}
function sharedWith(user) {
  const out = []; const seen = new Set();
  for (const s of q('SELECT s.owner, s.path, s.kind, s.role, u.email AS by FROM shares s JOIN users u ON u.id = s.owner WHERE s.email = ?').all(user.email)) {
    const notes = s.kind === 'folder' ? q("SELECT path, updated, LENGTH(text) AS size FROM notes WHERE user = ? AND path LIKE ? ESCAPE '!'").all(s.owner, s.path.replace(/[!%_]/g, '!$&') + '/%')
      : q('SELECT path, updated, LENGTH(text) AS size FROM notes WHERE user = ? AND path = ?').all(s.owner, s.path);
    for (const n of notes) { const key = s.owner + ':' + n.path; if (seen.has(key)) continue; seen.add(key); out.push({ owner: s.owner, by: s.by, path: n.path, updated: n.updated, size: n.size, role: roleOn(user, s.owner, n.path) }); }
  }
  return out.sort((a, b) => b.updated - a.updated);
}
function addShare(user, body) {
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan');
  const p = cleanPath(body.path); const email = cleanEmail(body.email);
  const kind = body.kind === 'folder' ? 'folder' : 'note'; const role = body.role === 'edit' ? 'edit' : 'view';
  if (email === user.email) throw new Fail(400, 'own_email');
  if (kind === 'note' && !q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  q('INSERT INTO shares (owner, path, kind, email, role, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner, path, email) DO UPDATE SET role = excluded.role, kind = excluded.kind').run(user.id, p, kind, email, role, now());
  return { ok: true };
}

// Enlace público de solo lectura, con contraseña opcional. La contraseña se guarda con scrypt.
const passHash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
function addLink(user, body) {
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan');
  const p = cleanPath(body.path);
  if (!q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  const token = random(24); let pass = null;
  if (body.password) { const salt = random(12); pass = salt + ':' + passHash(body.password, salt); }
  q('INSERT INTO links (hash, owner, path, pass, created) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, p, pass, now());
  return { token, protected: !!pass };
}
function publicNote(token, password) {
  const link = q('SELECT * FROM links WHERE hash = ?').get(sha(String(token)));
  if (!link) throw new Fail(404, 'not_found');
  if (link.pass) {
    if (link.locked > now()) throw new Fail(429, 'locked');
    if (!password) throw new Fail(401, 'need_password');
    const [salt, hash] = link.pass.split(':');
    const given = Buffer.from(passHash(password, salt), 'hex');
    if (!crypto.timingSafeEqual(given, Buffer.from(hash, 'hex'))) {
      // Diez intentos fallidos bloquean el enlace diez minutos.
      const fails = link.fails + 1;
      q('UPDATE links SET fails = ?, locked = ? WHERE id = ?').run(fails >= 10 ? 0 : fails, fails >= 10 ? now() + 600000 : 0, link.id);
      throw new Fail(403, 'bad_password');
    }
    if (link.fails) q('UPDATE links SET fails = 0 WHERE id = ?').run(link.id);
  }
  const n = q('SELECT path, text, updated FROM notes WHERE user = ? AND path = ?').get(link.owner, link.path);
  if (!n) throw new Fail(404, 'not_found');
  return n;
}

// ---------- En vivo ----------
// Quien tiene una nota abierta queda escuchando: se entera al instante cuando otro la guarda, y de quién más está.
const rooms = new Map();
const roomKey = (ownerId, p) => ownerId + ':' + p;
function announce(key, event, skip) {
  const room = rooms.get(key); if (!room) return;
  const who = Array.from(new Set(Array.from(room).map((c) => c.email)));
  for (const c of room) if (c !== skip) c.res.write('data: ' + JSON.stringify(Object.assign({ who }, event)) + '\n\n');
}
function listen(req, res, user, url) {
  const p = cleanPath(url.searchParams.get('path'));
  const { owner } = target(user, url, p, 'view');
  const key = roomKey(owner.id, p);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const client = { res, email: user.email };
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(client);
  announce(key, { type: 'presence' });
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(beat); const room = rooms.get(key); if (room) { room.delete(client); if (!room.size) rooms.delete(key); else announce(key, { type: 'presence' }); } });
}

// ---------- MCP (Streamable HTTP, respuestas JSON) ----------
const TOOLS = [
  { name: 'list_notes', description: 'List the Markdown notes in the SharpMD cloud folder, newest first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_note', description: 'Read one note by its path.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of the note, for example ideas/launch.md' } }, required: ['path'] } },
  { name: 'write_note', description: 'Create a note or replace its whole content with Markdown text.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string', description: 'Full Markdown content' } }, required: ['path', 'text'] } },
  { name: 'append_note', description: 'Append Markdown text to the end of a note, creating it if it does not exist.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] } },
  { name: 'search_notes', description: 'Search the text of every note. Returns matching notes with the lines that match.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];

function callTool(user, name, args) {
  args = args || {};
  if (name === 'list_notes') return listNotes(user).map((n) => ({ path: n.path, updated: new Date(n.updated).toISOString(), size: n.size }));
  if (name === 'read_note') return readNote(user, args.path).text;
  if (name === 'write_note') { const r = writeNote(user, args.path, args.text); return 'Saved ' + r.path + ' (' + r.size + ' characters).'; }
  if (name === 'append_note') {
    let prev = '';
    try { prev = readNote(user, args.path).text; } catch (e) { if (e.code !== 'not_found') throw e; }
    const r = writeNote(user, args.path, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + (prev ? '\n' : '') + String(args.text || ''));
    return 'Appended to ' + r.path + '.';
  }
  if (name === 'search_notes') return searchNotes(user, args.query);
  throw new Fail(400, 'unknown_tool');
}

function mcp(user, msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'sharpmd', version: '1.0.0' },
    instructions: 'Notes are Markdown files in the user\'s SharpMD cloud folder. Paths look like folder/name.md.' });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools: TOOLS });
  if (msg.method === 'tools/call') {
    try {
      const out = callTool(user, msg.params && msg.params.name, msg.params && msg.params.arguments);
      return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) { return reply({ content: [{ type: 'text', text: 'Error: ' + (e.message || e.code || 'failed') }], isError: true }); }
  }
  if (msg.id === undefined) return null; // notificación: no lleva respuesta
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
}

// ---------- HTTP ----------
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (/^(chrome|moz)-extension:\/\//.test(origin) || ORIGINS.includes(origin) || ORIGINS.includes('*'))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-password');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-max-age', '86400');
  }
}
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_NOTE * 2) { reject(new Fail(413, 'too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Fail(400, 'bad_json')); } });
  req.on('error', reject);
});

const readRaw = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_NOTE) { reject(new Fail(413, 'too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

// ---------- Paddle ----------
// Lo único que activa o da de baja el plan pago. La firma va sobre el cuerpo tal como llegó.
// De quién es el aviso sale de custom_data.sharpmd_email, que escribe la página de pago, o de la
// suscripción ya guardada (las renovaciones no traen custom_data). Nunca del correo del cliente
// de Paddle: quien paga con el correo de otro no compra para el otro.
function paddleSigned(raw, header) {
  const parts = Object.fromEntries(String(header || '').split(';').map((x) => x.split('=')));
  if (!parts.ts || !parts.h1 || Math.abs(Date.now() / 1000 - +parts.ts) > 3600) return false;
  const mine = crypto.createHmac('sha256', env.PADDLE_WEBHOOK_SECRET).update(parts.ts + ':' + raw).digest('hex');
  const a = Buffer.from(mine); const b = Buffer.from(String(parts.h1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function paddleWebhook(req) {
  if (!env.PADDLE_WEBHOOK_SECRET) throw new Fail(404, 'no_route');
  const raw = await readRaw(req);
  if (!paddleSigned(raw, req.headers['paddle-signature'])) { if (req.headers['paddle-signature']) console.error('paddle: aviso con firma inválida, revisar PADDLE_WEBHOOK_SECRET'); throw new Fail(401, 'bad_signature'); }
  let ev; try { ev = JSON.parse(raw); } catch (e) { throw new Fail(400, 'bad_json'); }
  const d = ev.data || {};
  if (!/^subscription\./.test(ev.event_type || '')) return { ok: true, ignored: 'event' };
  // La cuenta de Paddle puede vender otros productos: solo cuentan los precios marcados como de SharpMD.
  if (!(d.items || []).some((i) => i && i.price && i.price.custom_data && i.price.custom_data.app === 'sharpmd')) return { ok: true, ignored: 'product' };
  const tagged = d.custom_data && d.custom_data.sharpmd_email;
  let user = null;
  if (tagged) { try { user = q('SELECT * FROM users WHERE email = ?').get(cleanEmail(tagged)); } catch (e) { user = null; } }
  if (!user && d.id) user = q('SELECT * FROM users WHERE paddle_sub = ?').get(String(d.id));
  if (!user) { console.error('paddle: aviso ' + ev.event_type + ' sin cuenta · ' + d.id); return { ok: true, ignored: 'user' }; }
  const plan = ['active', 'trialing', 'past_due'].includes(d.status) ? 'pro' : 'free';
  q('UPDATE users SET plan = ?, paddle_sub = ? WHERE id = ?').run(plan, String(d.id || ''), user.id);
  return { ok: true, plan };
}

async function route(req, url) {
  const p = url.pathname; const m = req.method;
  if (p === '/health') return { ok: true };
  if (p === '/auth/start' && m === 'POST') return authStart(await readBody(req));
  if (p === '/auth/verify' && m === 'POST') return authVerify(await readBody(req));
  if (p === '/paddle/webhook' && m === 'POST') return paddleWebhook(req);
  if (p === '/feedback' && m === 'POST') return feedback(req, await readBody(req));
  if (p === '/admin/plan' && m === 'POST') {
    if (!env.ADMIN_KEY || req.headers['x-admin-key'] !== env.ADMIN_KEY) throw new Fail(403, 'forbidden');
    const b = await readBody(req);
    const r = q('UPDATE users SET plan = ? WHERE email = ?').run(b.plan === 'pro' ? 'pro' : 'free', cleanEmail(b.email));
    if (!r.changes) throw new Fail(404, 'not_found');
    return { ok: true };
  }
  if (p === '/mcp') {
    if (m !== 'POST') throw new Fail(405, 'method_not_allowed');
    const user = userFrom(req, 'token');
    if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
    const body = await readBody(req);
    const out = Array.isArray(body) ? body.map((x) => mcp(user, x)).filter(Boolean) : mcp(user, body);
    return out == null || (Array.isArray(out) && !out.length) ? { __status: 202 } : out;
  }
  if (p.startsWith('/public/') && m === 'GET') return publicNote(decodeURIComponent(p.slice(8)), req.headers['x-password']);
  const user = userFrom(req, 'session');
  if (p === '/shared' && m === 'GET') return sharedWith(user);
  if (p === '/shares' && m === 'POST') return addShare(user, await readBody(req));
  if (p === '/shares' && m === 'GET') {
    const of = url.searchParams.get('path');
    const people = q('SELECT id, path, kind, email, role FROM shares WHERE owner = ?').all(user.id).filter((s) => !of || s.path === of);
    const links = q('SELECT id, path, pass IS NOT NULL AS protected, created FROM links WHERE owner = ?').all(user.id).filter((l) => !of || l.path === of);
    return { people, links };
  }
  if (p.startsWith('/shares/') && m === 'DELETE') { q('DELETE FROM shares WHERE id = ? AND owner = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/links' && m === 'POST') return addLink(user, await readBody(req));
  if (p.startsWith('/links/') && m === 'DELETE') { q('DELETE FROM links WHERE id = ? AND owner = ?').run(+p.slice(7), user.id); return { ok: true }; }
  if (p === '/account' && m === 'GET') return account(user);
  if (p === '/auth/logout' && m === 'POST') { q('DELETE FROM sessions WHERE hash = ?').run(sha(req.headers.authorization.split(/\s+/)[1])); return { ok: true }; }
  if (p === '/tokens' && m === 'GET') return q('SELECT id, name, created, used FROM tokens WHERE user = ? ORDER BY created DESC').all(user.id);
  if (p === '/tokens' && m === 'POST') {
    if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
    const b = await readBody(req); const token = 'mdt_' + random(30);
    q('INSERT INTO tokens (hash, user, name, created) VALUES (?, ?, ?, ?)').run(sha(token), user.id, String(b.name || 'AI').slice(0, 60), now());
    return { token, mcp_url: PUBLIC_URL + '/mcp' };
  }
  if (p.startsWith('/tokens/') && m === 'DELETE') { q('DELETE FROM tokens WHERE id = ? AND user = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/notes' && m === 'GET') {
    const oid = +(url.searchParams.get('o') || user.id);
    if (oid === user.id) return listNotes(user);
    return sharedWith(user).filter((n) => n.owner === oid).map((n) => ({ path: n.path, updated: n.updated, size: n.size }));
  }
  if (p === '/search' && m === 'GET') return searchNotes(user, url.searchParams.get('q'));
  if (p === '/rename' && m === 'POST') { const b = await readBody(req); return renameNote(user, b.from, b.to); }
  if (p.startsWith('/notes/')) {
    const note = decodeURIComponent(p.slice(7));
    const clean = cleanPath(note);
    if (m === 'GET') { const t = target(user, url, clean, 'view'); return Object.assign(readNote(t.owner, clean), { role: t.role }); }
    if (m === 'PUT') {
      const t = target(user, url, clean, 'edit');
      const saved = writeNote(t.owner, clean, (await readBody(req)).text);
      announce(roomKey(t.owner.id, clean), { type: 'saved', by: user.email, updated: saved.updated });
      return saved;
    }
    if (m === 'DELETE') return deleteNote(target(user, url, clean, 'owner').owner, clean);
  }
  if (p.startsWith('/versions/') && m === 'GET') return q('SELECT id, saved, LENGTH(text) AS size FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 100').all(user.id, cleanPath(decodeURIComponent(p.slice(10))));
  if (p.startsWith('/version/') && m === 'GET') {
    const v = q('SELECT id, path, text, saved FROM versions WHERE id = ? AND user = ?').get(+p.slice(9), user.id);
    if (!v) throw new Fail(404, 'not_found');
    return v;
  }
  throw new Fail(404, 'no_route');
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events' && req.method === 'GET') { listen(req, res, userFrom(req, 'session'), url); return; }
    const out = await route(req, url);
    if (out && out.__status) { res.writeHead(out.__status); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(status === 500 ? e : 'error ' + status + ' ' + (e.code || '') + ' en ' + req.method + ' ' + String(req.url).split('?')[0]);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.code || 'server_error', message: e.message || '' }));
  }
});

// Limpieza diaria: códigos vencidos e historial viejo.
setInterval(() => {
  q('DELETE FROM codes WHERE expires < ?').run(now());
  q('DELETE FROM versions WHERE saved < ?').run(now() - HISTORY_DAYS * 86400000);
  for (const k of sentBy.keys()) if (!recent(k).length) sentBy.delete(k);
}, 6 * 3600000).unref();

server.listen(PORT, env.HOST || '127.0.0.1', () => console.log('SharpMD Sync en ' + PUBLIC_URL + ' (puerto ' + PORT + ')'));
