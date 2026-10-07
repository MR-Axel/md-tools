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
//   AUTH_PER_IP     códigos de acceso que una misma IP puede pedir por hora (20). Detrás de un proxy la IP sale de x-forwarded-for
//   VAULT_MINUTE_MS solo para pruebas: cuántos milisegundos dura un minuto de una carpeta desbloqueada para la IA (60000)
//   DATA_KEY        32 bytes en base64: con ella, el texto de las notas, del historial y de los comentarios se guarda cifrado
//                   (AES-256-GCM). Protege el archivo de la base y sus respaldos. Perderla es perder esos datos
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
const SESSION_DAYS = 180; // una sesión sin uso en ese tiempo deja de servir
const AUTH_PER_IP = +(env.AUTH_PER_IP || 20);
// Topes por cuenta de lo que no tiene otro límite: nadie llega a estos números usando la app.
const MAX_TOKENS = 50; const MAX_SHARES = 500; const MAX_LINKS = 200; const MAX_BATCH = 50;
const LIVE_PER_USER = 20; const LIVE_PER_IP = 60; // conexiones abiertas de /events
// Cuánto dura un "minuto" de una carpeta desbloqueada para la IA. Solo las pruebas lo acortan, para ver vencer el plazo.
const VAULT_MINUTE_MS = +(env.VAULT_MINUTE_MS || 60000);

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'mdtools.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA secure_delete = ON;
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
try { db.exec('ALTER TABLE tokens ADD COLUMN scope TEXT'); } catch (e) { /* ya estaba */ }
db.exec("CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, path TEXT NOT NULL, quote TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', reply TEXT, created INTEGER NOT NULL, done INTEGER)");
// Cada suscripción de Paddle con su cuenta y su estado: una cuenta puede tener más de una (alguien pagó por ella).
db.exec('CREATE TABLE IF NOT EXISTS paddle_subs (id TEXT PRIMARY KEY, user INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0)');
db.exec("INSERT OR IGNORE INTO paddle_subs (id, user, status, at) SELECT paddle_sub, id, CASE plan WHEN 'pro' THEN 'active' ELSE 'canceled' END, 0 FROM users WHERE paddle_sub IS NOT NULL AND paddle_sub != ''");
// Tamaño del texto en claro (LENGTH(text) deja de servir con el texto cifrado) y marca de fila cifrada.
try { db.exec('ALTER TABLE notes ADD COLUMN size INTEGER'); } catch (e) { /* ya estaba */ }
try { db.exec('ALTER TABLE notes ADD COLUMN e INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
try { db.exec('ALTER TABLE versions ADD COLUMN size INTEGER'); } catch (e) { /* ya estaba */ }
try { db.exec('ALTER TABLE versions ADD COLUMN e INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
try { db.exec('ALTER TABLE comments ADD COLUMN e INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
// v: el texto de la nota llegó cifrado desde el navegador (carpeta con contraseña). aad: la ruta a la que quedó atada una versión cifrada.
try { db.exec('ALTER TABLE notes ADD COLUMN v INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
try { db.exec('ALTER TABLE versions ADD COLUMN aad TEXT'); } catch (e) { /* ya estaba */ }
// rev: el número de revisión de la nota. Sube de a uno con cada guardado; quien guarda dice sobre cuál escribió.
try { db.exec('ALTER TABLE notes ADD COLUMN rev INTEGER NOT NULL DEFAULT 1'); } catch (e) { /* ya estaba */ }
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
// Carpetas con contraseña. De cada una se guarda con qué se envolvió su llave (sal, vueltas y la llave envuelta) y un
// valor para comprobar la llave. Nunca la contraseña ni la llave. state: 'on', o 'opening' mientras se le quita la protección.
db.exec("CREATE TABLE IF NOT EXISTS vaults (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, folder TEXT NOT NULL, salt TEXT NOT NULL, iters INTEGER NOT NULL, wrapped TEXT NOT NULL, verify TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'on', created INTEGER NOT NULL, UNIQUE (user, folder))");
// Las filas sin tamaño son anteriores a esta columna y están en claro: se mide de una vez, sin traerlas a memoria.
db.exec('UPDATE notes SET size = LENGTH(text) WHERE size IS NULL AND e = 0');
db.exec('UPDATE versions SET size = LENGTH(text) WHERE size IS NULL AND e = 0');
const q = (sql) => db.prepare(sql);
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');
// Compara dos secretos sin que el tiempo de la respuesta diga cuánto coinciden.
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// extra viaja en el cuerpo de la respuesta: por ejemplo retry_after, los segundos que faltan en un tope.
class Fail extends Error { constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra || null; } }

// ---------- Cifrado en reposo ----------
// Con DATA_KEY, el texto de las notas, del historial y de los comentarios se guarda cifrado con AES-256-GCM:
// un nonce aleatorio de 96 bits por valor, y como dato asociado la columna a la que pertenece, para que un valor
// no se pueda pasar de una columna a otra. GCM además detecta cualquier cambio en lo guardado.
// Protege el archivo de la base y sus respaldos; no protege de quien entra al servidor en marcha, que tiene la clave.
// Sin DATA_KEY todo queda en claro, como siempre.
const ENC = 'enc1:';
// El aviso sale entero antes de terminar: escribir en el descriptor no espera a nadie.
const fatal = (text) => { fs.writeSync(2, text + '\n'); process.exit(1); };
const DATA_KEY = (() => {
  const raw = String(env.DATA_KEY || '').trim(); if (!raw) return null;
  const key = /^[A-Za-z0-9+/_-]+=*$/.test(raw) ? Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64') : Buffer.alloc(0);
  if (key.length !== 32) fatal('DATA_KEY no sirve: tienen que ser 32 bytes en base64. El servidor no arranca. Para generar una: openssl rand -base64 32');
  return key;
})();
const SEALED = DATA_KEY ? 1 : 0;
function seal(text, column) {
  if (!DATA_KEY || text == null) return text;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv); c.setAAD(Buffer.from(column));
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ENC + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}
// e es la marca de la fila: 1 si se guardó cifrada. Una fila cifrada que no abre es un error, nunca un texto vacío.
function unseal(stored, e, column) {
  if (!e || stored == null) return stored;
  if (!DATA_KEY || !String(stored).startsWith(ENC)) throw new Error('fila cifrada sin clave');
  const raw = Buffer.from(String(stored).slice(ENC.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, raw.subarray(0, 12)); d.setAAD(Buffer.from(column)); d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
}
// Al arrancar. La base anota, cifrada, una frase fija: con eso se sabe si la clave de ahora es la misma de antes.
// Con datos cifrados y sin clave, o con otra clave, el servidor no arranca: nunca escribe en claro sobre una base
// cifrada ni devuelve texto ilegible.
// Por tabla: cómo traer una tanda de filas en claro, cómo guardarlas cifradas y qué columnas llevan texto.
const SEAL_JOBS = [
  { name: 'notes', cols: ['text'], any: 'SELECT 1 FROM notes WHERE e = 1 LIMIT 1', pick: 'SELECT rowid AS rid, text FROM notes WHERE e = 0 LIMIT 50', put: 'UPDATE notes SET text = ?, e = 1 WHERE rowid = ? AND e = 0' },
  { name: 'versions', cols: ['text'], any: 'SELECT 1 FROM versions WHERE e = 1 LIMIT 1', pick: 'SELECT rowid AS rid, text FROM versions WHERE e = 0 LIMIT 50', put: 'UPDATE versions SET text = ?, e = 1 WHERE rowid = ? AND e = 0' },
  { name: 'comments', cols: ['quote', 'text', 'reply'], any: 'SELECT 1 FROM comments WHERE e = 1 LIMIT 1', pick: 'SELECT rowid AS rid, quote, text, reply FROM comments WHERE e = 0 LIMIT 50', put: 'UPDATE comments SET quote = ?, text = ?, reply = ?, e = 1 WHERE rowid = ? AND e = 0' },
];
(() => {
  const PROOF = 'sharpmd-data-key';
  const proof = q("SELECT value FROM meta WHERE key = 'data_key'").get();
  const anySealed = SEAL_JOBS.some((job) => q(job.any).get());
  if (!DATA_KEY) {
    if (proof || anySealed) fatal('Esta base tiene datos cifrados y falta DATA_KEY. El servidor no arranca: sin la clave no puede leerlos, y no va a escribir en claro encima. Poné la misma DATA_KEY con la que se cifró.');
    return;
  }
  if (proof) {
    let ok = false; try { ok = unseal(proof.value, 1, 'meta') === PROOF; } catch (e) { ok = false; }
    if (!ok) fatal('DATA_KEY no es la clave con la que se cifró esta base. El servidor no arranca: con otra clave no puede leer los datos. Poné la clave original.');
  } else {
    if (anySealed) fatal('Esta base tiene datos cifrados pero no la marca de su clave. El servidor no arranca. Restaurá la base desde un respaldo completo.');
    q("INSERT INTO meta (key, value) VALUES ('data_key', ?)").run(seal(PROOF, 'meta'));
  }
  // Lo que estaba en claro se cifra por tandas de 50 filas, cada una en su transacción: si se corta, la próxima
  // vez sigue con las que faltan (las ya cifradas llevan e = 1 y no se vuelven a tocar).
  let total = 0;
  for (const job of SEAL_JOBS) {
    for (;;) {
      const rows = q(job.pick).all();
      if (!rows.length) break;
      db.exec('BEGIN');
      try {
        const up = q(job.put);
        for (const r of rows) up.run(...job.cols.map((c) => seal(r[c], job.name + '.' + c)), r.rid);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      total += rows.length;
    }
  }
  // SQLite no borra lo que pisa: el texto viejo quedaría en páginas libres y en el WAL. Se reescribe el archivo.
  if (total) { db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); console.log('DATA_KEY: se cifraron ' + total + ' filas que estaban en claro'); }
})();

// ---------- Topes ----------
// Cuántas veces pasó algo (por IP, por correo o por cuenta) en la última hora o el último día. Vive en memoria:
// al reiniciar se pierde, y alcanza. El servidor vive detrás de un proxy: la IP sale de x-forwarded-for, y de
// ahí la última, que es la que anota el proxy (las anteriores las escribe quien llama).
const HOUR = 3600000; const DAY = 86400000;
const marks = new Map();
const recent = (key, span) => (marks.get(key) || []).filter((t) => now() - t < (span || HOUR));
const mark = (key) => marks.set(key, recent(key, DAY).concat(now()));
const over = (key, max, span) => recent(key, span).length >= max;
// Segundos que faltan para que un tope afloje: cuando salga de la ventana la marca que lo llenó. 0 si no está lleno.
const waitFor = (key, max, span) => { const r = recent(key, span); return r.length < max ? 0 : Math.max(1, Math.ceil(((span || HOUR) - (now() - r[r.length - max])) / 1000)); };
// Corta con 429, el código propio de ese tope y cuánto falta (retry_after en el cuerpo y cabecera Retry-After).
const limit = (key, max, span, code) => { const s = waitFor(key, max, span); if (s) throw new Fail(429, code, '', { retry_after: s }); };
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';

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
const cleanEmail = (v) => { const e = (typeof v === 'string' ? v : '').trim().toLowerCase(); if (!validEmail(e)) throw new Fail(400, 'bad_email'); return e; };

// Pedir un código manda un correo: sin tope, el servidor serviría para llenarle la casilla a cualquiera y para
// probar códigos sin fin (cada código nuevo trae seis intentos). Por correo: uno cada 30 segundos, 5 por hora
// y 15 por día. Por IP: AUTH_PER_IP por hora. Cada tope responde con su código (code_gap, code_mail_hour,
// code_mail_day, code_ip_hour) y con los segundos que faltan. Antes los cuatro respondían too_soon.
async function authStart(req, body) {
  const email = cleanEmail(body.email); const ip = 'start:ip:' + clientIp(req); const to = 'start:mail:' + email;
  // Cuenta de prueba para quien revisa la app en una tienda: código fijo, sin correo. Es una sola cuenta, sin datos de nadie.
  const fixed = TEST_LOGIN && email === TEST_LOGIN[0] ? TEST_LOGIN[1] : '';
  limit(ip, AUTH_PER_IP, HOUR, 'code_ip_hour');
  const prev = q('SELECT sent FROM codes WHERE email = ?').get(email);
  if (!fixed && prev && now() - prev.sent < 30000) throw new Fail(429, 'code_gap', '', { retry_after: Math.max(1, Math.ceil((30000 - (now() - prev.sent)) / 1000)) });
  if (!fixed) { limit(to, 5, HOUR, 'code_mail_hour'); limit(to, 15, DAY, 'code_mail_day'); }
  mark(ip); if (!fixed) mark(to);
  const code = fixed || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  q('INSERT OR REPLACE INTO codes (email, hash, expires, tries, sent) VALUES (?, ?, ?, 0, ?)').run(email, sha(email + ':' + code), now() + 15 * 60000, now());
  if (fixed) return { ok: true };
  await sendCode(email, code, body.lang);
  return env.DEV_CODES ? { ok: true, dev_code: code } : { ok: true };
}

// Seis intentos por código. Además, los fallos se cuentan por correo (10 por hora, 30 por día) y por IP (30 por
// hora) sin importar cuántos códigos se pidan: pedir otro código no devuelve los intentos. Cada tope tiene su
// código (tries_mail_hour, tries_mail_day, tries_ip_hour, tries_code). Antes los cuatro respondían too_many_tries.
// tries_code no trae espera: ese código ya no sirve y hay que pedir otro.
function authVerify(req, body) {
  const email = cleanEmail(body.email); const ip = 'fail:ip:' + clientIp(req); const who = 'fail:mail:' + email;
  limit(who, 10, HOUR, 'tries_mail_hour'); limit(who, 30, DAY, 'tries_mail_day'); limit(ip, 30, HOUR, 'tries_ip_hour');
  const row = q('SELECT * FROM codes WHERE email = ?').get(email);
  if (!row || row.expires < now()) throw new Fail(400, 'code_expired');
  if (row.tries >= 6) throw new Fail(429, 'tries_code');
  if (!same(row.hash, sha(email + ':' + String(body.code == null ? '' : body.code).trim()))) { q('UPDATE codes SET tries = tries + 1 WHERE email = ?').run(email); mark(who); mark(ip); throw new Fail(400, 'bad_code'); }
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
    const s = q('SELECT user FROM sessions WHERE hash = ? AND seen > ?').get(sha(m[1]), now() - SESSION_DAYS * DAY);
    if (s) { q('UPDATE sessions SET seen = ? WHERE hash = ?').run(now(), sha(m[1])); return q('SELECT * FROM users WHERE id = ?').get(s.user); }
  }
  if (kind === 'token' && m[1].startsWith('mdt_')) {
    const t = q('SELECT id, user, scope FROM tokens WHERE hash = ?').get(sha(m[1]));
    if (t) { q('UPDATE tokens SET used = ? WHERE id = ?').run(now(), t.id); const u = q('SELECT * FROM users WHERE id = ?').get(t.user); if (u) u.scope = t.scope || ''; return u; }
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
// Tope de cinco por hora por IP y por cuenta.
const FEEDBACK_MAX = 5;
async function feedback(req, body) {
  if (!env.FEEDBACK_TO || !(env.RESEND_API_KEY || env.MAIL_WEBHOOK || env.DEV_CODES)) throw new Fail(404, 'no_route');
  let user = null;
  if (req.headers.authorization) { try { user = userFrom(req, 'session'); } catch (e) { /* sesión vencida: entra como anónimo */ } }
  const text = String(body.text == null ? '' : body.text).trim();
  if (text.length < 5 || text.length > 4000) throw new Fail(400, 'bad_text');
  const from = user ? user.email : (String(body.email || '').trim() ? cleanEmail(body.email) : '');
  const keys = ['ip:' + clientIp(req)].concat(user ? ['user:' + user.id] : []);
  keys.forEach((k) => limit('fb:' + k, FEEDBACK_MAX, HOUR, 'too_many'));
  keys.forEach((k) => mark('fb:' + k));
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

// ---------- Bóvedas: carpetas con contraseña ----------
// El navegador cifra cada nota de la carpeta antes de subirla y el servidor guarda ese texto tal como llega
// (empieza con vault1:). La llave nace y vive en el navegador: acá no llega la contraseña, y la llave solo cuando la
// persona desbloquea la carpeta para la IA, y entonces queda en memoria, nunca en el disco ni en el registro.
//   - Llave de datos K: 32 bytes al azar. De K salen, con HKDF-SHA-256, la llave de cifrado y el valor de comprobación.
//   - Cada nota: AES-256-GCM, nonce al azar de 96 bits, y la ruta de la nota como dato asociado: un texto cifrado
//     puesto en otra ruta no abre.
//   - La contraseña envuelve a K en el navegador (PBKDF2-SHA-256 y AES-GCM). Acá solo se guarda el resultado.
// Los nombres de las notas y de las carpetas no se cifran.
const VAULT = 'vault1:';
const VAULT_ENC = 'sharpmd vault enc v1'; const VAULT_CHECK = 'sharpmd vault check v1';
const MAX_VAULTS = 50; const VAULT_MINUTES = [15, 60, 480, 0]; // 0: hasta que se bloquee o se reinicie el servidor
const inside = (p, folder) => p.startsWith(folder + '/');
const vaultsOf = (userId) => q('SELECT * FROM vaults WHERE user = ?').all(userId);
const vaultOf = (userId, p) => vaultsOf(userId).find((v) => inside(p, v.folder)) || null;
// "Todo lo que está dentro de una carpeta" se pregunta con substr(path, 1, length(?)) = ?, pasando dos veces la
// carpeta con su barra: compara exacto, distinguiendo mayúsculas (LIKE no las distingue).
// Base64 de exactamente esa cantidad de bytes, o null.
const b64 = (v, bytes) => { if (typeof v !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(v)) return null; const b = Buffer.from(v, 'base64'); return b.length === bytes ? b : null; };
const hk = (key, info) => Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), info, 32));
// El mismo formato que arma el navegador: vault1: + base64(nonce de 12 bytes | texto cifrado | etiqueta de 16 bytes).
function vaultSeal(key, p, text) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(p, 'utf8'));
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return VAULT + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}
function vaultOpen(key, p, stored) {
  try {
    const raw = Buffer.from(String(stored).slice(VAULT.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAAD(Buffer.from(p, 'utf8')); d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
  } catch (e) { throw new Fail(409, 'vault_unreadable', 'This note could not be decrypted with the key of its folder'); }
}
// Una nota pasó de estar en claro a estar cifrada. SQLite pone en cero lo que borra (secure_delete), pero el texto
// viejo sigue en el WAL hasta que se vacía: se vacía ahora, para que no quede en el disco ni en un respaldo.
const scrub = () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* se vacía en la próxima */ } };
// Qué texto acepta una ruta: dentro de una carpeta con contraseña solo cifrado, y fuera nunca. Devuelve si es
// cifrado y cuánto pesa en claro (del cifrado se sabe por su largo: sobran el nonce y la etiqueta, 28 bytes).
function checkText(userId, p, text) {
  const sealedIn = text.startsWith(VAULT); const vault = vaultOf(userId, p);
  if (vault && vault.state === 'on' && !sealedIn) throw new Fail(409, 'vault', 'This folder is protected with a password: its notes must arrive encrypted');
  if (!sealedIn) { if (Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large'); return { v: 0, size: text.length }; }
  if (!vault || vault.state !== 'on') throw new Fail(409, 'vault_text', 'Encrypted text only goes inside a folder protected with a password');
  const body = text.slice(VAULT.length); const size = /^[A-Za-z0-9+/]+=*$/.test(body) ? Buffer.from(body, 'base64').length - 28 : -1;
  if (size < 0) throw new Fail(400, 'bad_vault_text');
  if (size > MAX_NOTE) throw new Fail(413, 'too_large');
  return { v: 1, size };
}

// Desbloqueada para la IA: la llave de cifrado de la carpeta, solo en memoria y con vencimiento. Bloquear a mano,
// vencer el plazo o reiniciar el servidor la olvidan. No se guarda K, sino la llave que sale de ella.
const aiKeys = new Map(); // id de la bóveda → { key, until, timer }
function aiForget(vault, tell) {
  const k = aiKeys.get(vault.id); if (!k) return;
  clearTimeout(k.timer); k.key.fill(0); aiKeys.delete(vault.id);
  if (tell) announceUser(vault.user, { type: 'vault' });
}
const aiKey = (vault) => { const k = aiKeys.get(vault.id); if (!k) return null; if (k.until && k.until <= now()) { aiForget(vault, true); return null; } return k; };
const vaultView = (v) => { const k = aiKey(v); return { id: v.id, folder: v.folder, salt: v.salt, iters: v.iters, wrapped: v.wrapped, check: v.verify, state: v.state, created: v.created, ai: k ? { until: k.until } : null }; };
// Al proteger una carpeta se va lo que quedaba en claro o abierto hacia afuera: el historial, los comentarios para
// la IA (citan el texto), los enlaces públicos y lo compartido.
function vaultPurge(userId, folder) {
  const pre = folder + '/';
  q('DELETE FROM versions WHERE user = ? AND substr(path, 1, length(?)) = ?').run(userId, pre, pre);
  q('DELETE FROM comments WHERE user = ? AND substr(path, 1, length(?)) = ?').run(userId, pre, pre);
  q('DELETE FROM links WHERE owner = ? AND substr(path, 1, length(?)) = ?').run(userId, pre, pre);
  q('DELETE FROM shares WHERE owner = ? AND (path = ? OR substr(path, 1, length(?)) = ?)').run(userId, folder, pre, pre);
}
function vaultCreate(user, body) {
  const folder = cleanPath(String(body.folder || '').replace(/\/+$/, ''));
  if (folder[0] === '~') throw new Fail(400, 'bad_path');
  const all = vaultsOf(user.id);
  if (all.length >= MAX_VAULTS) throw new Fail(429, 'too_many');
  // Una carpeta es bóveda con todo lo que tiene adentro: no va una dentro de otra.
  if (all.some((v) => v.folder === folder || inside(folder, v.folder) || inside(v.folder, folder))) throw new Fail(409, 'vault_nested', 'Protected folders cannot be nested');
  const iters = +body.iters;
  if (!b64(body.salt, 16) || !b64(body.wrapped, 60) || !b64(body.check, 32) || !Number.isInteger(iters) || iters < 100000 || iters > 10000000) throw new Fail(400, 'bad_vault');
  q('INSERT INTO vaults (user, folder, salt, iters, wrapped, verify, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, folder, body.salt, iters, body.wrapped, body.check, now());
  vaultPurge(user.id, folder);
  announceUser(user.id, { type: 'vault' });
  return vaultView(q('SELECT * FROM vaults WHERE user = ? AND folder = ?').get(user.id, folder));
}
// Cambiar la contraseña es volver a envolver la misma llave: las notas no se tocan.
function vaultRewrap(user, v, body) {
  const iters = +body.iters;
  if (!b64(body.salt, 16) || !b64(body.wrapped, 60) || !Number.isInteger(iters) || iters < 100000 || iters > 10000000) throw new Fail(400, 'bad_vault');
  q('UPDATE vaults SET salt = ?, iters = ?, wrapped = ? WHERE id = ?').run(body.salt, iters, body.wrapped, v.id);
  announceUser(user.id, { type: 'vault' });
  return vaultView(q('SELECT * FROM vaults WHERE id = ?').get(v.id));
}
// Quitar la protección: primero pasa a 'opening' (la carpeta vuelve a aceptar texto en claro y el navegador
// descifra y vuelve a guardar cada nota) y recién sin notas cifradas adentro se borra.
function vaultOpening(user, v) {
  aiForget(v, false);
  q("UPDATE vaults SET state = 'opening' WHERE id = ?").run(v.id);
  announceUser(user.id, { type: 'vault' });
  return vaultView(q('SELECT * FROM vaults WHERE id = ?').get(v.id));
}
function vaultRemove(user, v) {
  const pre = v.folder + '/';
  if (q('SELECT 1 FROM notes WHERE user = ? AND v = 1 AND substr(path, 1, length(?)) = ? LIMIT 1').get(user.id, pre, pre)) throw new Fail(409, 'vault_not_empty', 'There are still encrypted notes in this folder');
  aiForget(v, false);
  q('DELETE FROM versions WHERE user = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre); // el historial cifrado ya no tendría llave
  q('DELETE FROM vaults WHERE id = ?').run(v.id);
  announceUser(user.id, { type: 'vault' });
  return { ok: true };
}
// Desbloquear para la IA: llega la llave de datos, se comprueba contra el valor guardado y queda en memoria.
// Es parte del MCP: plan pago. Diez llaves equivocadas por hora por cuenta.
function vaultUnlock(user, v, body) {
  if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
  if (v.state !== 'on') throw new Fail(409, 'vault', 'This folder is having its protection removed');
  const minutes = +body.minutes;
  if (!VAULT_MINUTES.includes(minutes)) throw new Fail(400, 'bad_minutes');
  limit('vkey:' + user.id, 10, HOUR, 'too_many');
  const K = b64(body.key, 32);
  if (!K || !crypto.timingSafeEqual(hk(K, VAULT_CHECK), Buffer.from(v.verify, 'base64'))) { if (K) K.fill(0); mark('vkey:' + user.id); throw new Fail(403, 'bad_key'); }
  aiForget(v, false);
  const rec = { key: hk(K, VAULT_ENC), until: minutes ? now() + minutes * VAULT_MINUTE_MS : 0, timer: null };
  K.fill(0);
  if (minutes) { rec.timer = setTimeout(() => aiForget(v, true), minutes * VAULT_MINUTE_MS); rec.timer.unref(); }
  aiKeys.set(v.id, rec);
  announceUser(user.id, { type: 'vault' });
  return vaultView(v);
}

// ---------- Notas ----------
function cleanPath(v) {
  const p = String(v || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!p || p.length > 300 || p.split('/').some((s) => !s || s === '.' || s === '..') || /[\x00-\x1f]/.test(p)) throw new Fail(400, 'bad_path');
  return p;
}
// v marca las notas cuyo texto está cifrado desde el navegador. Dentro de una carpeta con contraseña, una sin esa
// marca todavía está en claro: el navegador la cifra apenas tiene la llave.
const listNotes = (user) => q('SELECT path, updated, size, v FROM notes WHERE user = ? ORDER BY updated DESC').all(user.id);
function readNote(user, p) {
  const n = q('SELECT path, text, updated, e, rev FROM notes WHERE user = ? AND path = ?').get(user.id, cleanPath(p));
  if (!n) throw new Fail(404, 'not_found');
  return { path: n.path, text: unseal(n.text, n.e, 'notes.text'), updated: n.updated, rev: n.rev };
}
// La revisión que manda quien guarda: un entero desde cero, o nada (una extensión sin actualizar no la manda).
const cleanRev = (v) => { if (v == null) return null; if (!Number.isInteger(v) || v < 0) throw new Fail(400, 'bad_rev'); return v; };
// base es la revisión sobre la que se escribió. Si la nota ya va por otra, no se guarda nada y vuelven el texto y
// la revisión de ahora (409 rev_conflict): quien guardaba junta lo suyo y reintenta. Sin base se guarda como
// siempre, pisando. Leer, comparar y escribir pasan sin soltar el hilo: entre dos guardados no se cuela otro.
// Devuelve también prev, el texto que había, para quien quiera avisar solo lo que cambió.
function writeNote(user, p, text, base) {
  p = cleanPath(p); text = String(text == null ? '' : text);
  const kind = checkText(user.id, p, text);
  const row = q('SELECT text, e, v, size, rev, updated FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  const prev = row ? { text: unseal(row.text, row.e, 'notes.text') } : null;
  if (row && base != null && base !== row.rev) throw new Fail(409, 'rev_conflict', '', { text: prev.text, rev: row.rev, updated: row.updated });
  if (!prev && user.plan !== 'pro' && countNotes(user) >= FREE_NOTES) throw new Fail(402, 'note_limit', 'The free plan holds ' + FREE_NOTES + ' notes');
  // El historial es del plan pago: se guarda la versión anterior si cambió y pasó más de un minuto. Al cifrar una
  // nota (o al descifrarla) la versión anterior no se guarda: sería dejar el texto en claro, o uno que ya nadie abre.
  if (prev && user.plan === 'pro' && prev.text !== text && row.v === kind.v) {
    const last = q('SELECT saved FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 1').get(user.id, p);
    if (!last || now() - last.saved > 60000) q('INSERT INTO versions (user, path, text, saved, size, e, aad) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, p, seal(prev.text, 'versions.text'), now(), row.size == null ? prev.text.length : row.size, SEALED, row.v ? p : null);
  }
  const rev = row ? row.rev + 1 : 1; const at = now();
  q('INSERT INTO notes (user, path, text, updated, size, e, v, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, path) DO UPDATE SET text = excluded.text, updated = excluded.updated, size = excluded.size, e = excluded.e, v = excluded.v, rev = excluded.rev').run(user.id, p, seal(text, 'notes.text'), at, kind.size, SEALED, kind.v, rev);
  if (row && !row.v && kind.v) scrub();
  const saved = { path: p, updated: at, size: kind.size, rev };
  // prev no viaja en la respuesta: lo usa quien llama para avisar el cambio a los que tienen la nota abierta.
  Object.defineProperty(saved, 'prev', { value: prev ? prev.text : null, enumerable: false });
  return saved;
}
function deleteNote(user, p) {
  const r = q('DELETE FROM notes WHERE user = ? AND path = ?').run(user.id, cleanPath(p));
  if (!r.changes) throw new Fail(404, 'not_found');
  q('DELETE FROM comments WHERE user = ? AND path = ?').run(user.id, cleanPath(p));
  // Los enlaces públicos y lo compartido de esa nota se van con ella: una nota nueva con el mismo nombre no nace publicada.
  q('DELETE FROM links WHERE owner = ? AND path = ?').run(user.id, cleanPath(p));
  q("DELETE FROM shares WHERE owner = ? AND path = ? AND kind != 'folder'").run(user.id, cleanPath(p));
  return { ok: true };
}
function renameNote(user, from, to, body) {
  from = cleanPath(from); to = cleanPath(to);
  if (q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, to)) throw new Fail(409, 'exists');
  const row = q('SELECT v, updated FROM notes WHERE user = ? AND path = ?').get(user.id, from);
  if (!row) throw new Fail(404, 'not_found');
  const vf = vaultOf(user.id, from); const vt = vaultOf(user.id, to);
  if (row.v || vf || vt) {
    // Entra, sale o se mueve dentro de una carpeta con contraseña: el texto cifrado está atado a su ruta, así que
    // el navegador manda el texto que corresponde a la ruta nueva (cifrado para adentro, en claro para afuera).
    // updated es lo que leyó: si la nota cambió mientras tanto, no se pisa.
    if (!body || body.text == null) throw new Fail(409, 'vault', 'Moving a note into, out of or inside a protected folder needs its text again');
    if (body.updated != null && +body.updated !== row.updated) throw new Fail(409, 'changed');
    const text = String(body.text); const kind = checkText(user.id, to, text);
    q('UPDATE notes SET path = ?, text = ?, size = ?, e = ?, v = ?, updated = ?, rev = rev + 1 WHERE user = ? AND path = ?').run(to, seal(text, 'notes.text'), kind.size, SEALED, kind.v, now(), user.id, from);
    if (!row.v && kind.v) scrub();
    // Dentro de la misma carpeta el historial sigue a la nota (cada versión recuerda la ruta con la que se cifró).
    // Al entrar o salir se elimina: quedaría en claro, o cifrado con una llave que la nota ya no usa.
    if (vf && vt && vf.id === vt.id) q('UPDATE versions SET path = ? WHERE user = ? AND path = ?').run(to, user.id, from);
    else q('DELETE FROM versions WHERE user = ? AND path = ?').run(user.id, from);
    if (vt) {
      q('DELETE FROM comments WHERE user = ? AND path = ?').run(user.id, from);
      q('DELETE FROM links WHERE owner = ? AND path = ?').run(user.id, from);
      q("DELETE FROM shares WHERE owner = ? AND path = ? AND kind != 'folder'").run(user.id, from);
    }
    return { path: to };
  }
  q('UPDATE notes SET path = ?, updated = ? WHERE user = ? AND path = ?').run(to, now(), user.id, from);
  // El historial, lo compartido y los enlaces públicos siguen a la nota.
  q('UPDATE versions SET path = ? WHERE user = ? AND path = ?').run(to, user.id, from);
  q("UPDATE OR REPLACE shares SET path = ? WHERE owner = ? AND path = ? AND kind != 'folder'").run(to, user.id, from);
  q('UPDATE links SET path = ? WHERE owner = ? AND path = ?').run(to, user.id, from);
  q('UPDATE comments SET path = ? WHERE user = ? AND path = ?').run(to, user.id, from);
  return { path: to };
}
// reach(bóveda) da la llave con la que se puede leer esa carpeta, o nada. Sin reach (la búsqueda de la app) las
// notas de las carpetas con contraseña quedan afuera. Con reach (la IA), las de una carpeta bloqueada aparecen
// solo si coincide el nombre, marcadas como bloqueadas y sin texto.
function searchNotes(user, text, reach) {
  const needle = String(text || '').toLowerCase(); if (!needle) return [];
  const out = []; const vaults = vaultsOf(user.id);
  // De a una nota: traerlas todas juntas ocuparía en memoria la nube entera de la cuenta.
  for (const n of q('SELECT path, text, e, v FROM notes WHERE user = ?').iterate(user.id)) {
    const vault = vaults.find((x) => inside(n.path, x.folder)); let body = null;
    if (!vault && !n.v) body = unseal(n.text, n.e, 'notes.text');
    else {
      if (!reach) continue;
      const key = vault && n.v ? reach(vault) : null;
      if (key) { try { body = vaultOpen(key, n.path, unseal(n.text, n.e, 'notes.text')); } catch (e) { body = null; } }
    }
    const hits = [];
    if (body != null) { const lines = body.split(/\r?\n/); for (let i = 0; i < lines.length && hits.length < 5; i++) if (lines[i].toLowerCase().includes(needle)) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) }); }
    if (hits.length || n.path.toLowerCase().includes(needle)) out.push(body == null ? { path: n.path, hits, locked: true } : { path: n.path, hits });
    if (out.length >= 30) break;
  }
  return out;
}

// ---------- Compartir entre cuentas ----------
// Una nota o una carpeta se comparte con el correo de otra cuenta, para ver o para editar.
const covers = (share, p) => (share.kind === 'folder' ? p.startsWith(share.path + '/') : p === share.path);
function roleOn(user, ownerId, p) {
  if (ownerId === user.id) return 'owner';
  // Lo que está en una carpeta con contraseña no se comparte: ni por haberla compartido antes, ni por una carpeta de más arriba.
  if (vaultOf(ownerId, p)) return null;
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
    const notes = s.kind === 'folder' ? q("SELECT path, updated, size FROM notes WHERE user = ? AND path LIKE ? ESCAPE '!'").all(s.owner, s.path.replace(/[!%_]/g, '!$&') + '/%')
      : q('SELECT path, updated, size FROM notes WHERE user = ? AND path = ?').all(s.owner, s.path);
    // LIKE no distingue mayúsculas: sin este filtro, compartir "Proy" listaría también lo de "proy".
    for (const n of notes) { const key = s.owner + ':' + n.path; if (seen.has(key) || !covers(s, n.path) || vaultOf(s.owner, n.path)) continue; seen.add(key); out.push({ owner: s.owner, by: s.by, path: n.path, updated: n.updated, size: n.size, role: roleOn(user, s.owner, n.path) }); }
  }
  return out.sort((a, b) => b.updated - a.updated);
}
function addShare(user, body) {
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan');
  const p = cleanPath(body.path); const email = cleanEmail(body.email);
  const kind = body.kind === 'folder' ? 'folder' : 'note'; const role = body.role === 'edit' ? 'edit' : 'view';
  if (email === user.email) throw new Fail(400, 'own_email');
  if (vaultsOf(user.id).some((v) => p === v.folder || inside(p, v.folder))) throw new Fail(409, 'vault', 'A folder protected with a password cannot be shared');
  if (kind === 'note' && !q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  if (q('SELECT COUNT(*) AS n FROM shares WHERE owner = ?').get(user.id).n >= MAX_SHARES) throw new Fail(429, 'too_many');
  q('INSERT INTO shares (owner, path, kind, email, role, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner, path, email) DO UPDATE SET role = excluded.role, kind = excluded.kind').run(user.id, p, kind, email, role, now());
  return { ok: true };
}

// Enlace público de solo lectura, con contraseña opcional. La contraseña se guarda con scrypt.
const passHash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
function addLink(user, body) {
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan');
  const p = cleanPath(body.path);
  if (vaultOf(user.id, p)) throw new Fail(409, 'vault', 'A note in a folder protected with a password cannot have a public link');
  if (!q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  if (q('SELECT COUNT(*) AS n FROM links WHERE owner = ?').get(user.id).n >= MAX_LINKS) throw new Fail(429, 'too_many');
  if (body.password != null && String(body.password).length > 200) throw new Fail(400, 'bad_password');
  const token = random(24); let pass = null;
  if (body.password) { const salt = random(12); pass = salt + ':' + passHash(body.password, salt); }
  q('INSERT INTO links (hash, owner, path, pass, created) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, p, pass, now());
  return { token, protected: !!pass };
}
function publicNote(token, password) {
  const link = q('SELECT * FROM links WHERE hash = ?').get(sha(String(token)));
  if (!link) throw new Fail(404, 'not_found');
  if (link.pass) {
    if (link.locked > now()) throw new Fail(429, 'locked', '', { retry_after: Math.ceil((link.locked - now()) / 1000) });
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
  const n = q('SELECT path, text, updated, e, v FROM notes WHERE user = ? AND path = ?').get(link.owner, link.path);
  // Un enlace nunca muestra una nota de una carpeta con contraseña, ni siquiera su texto cifrado.
  if (!n || n.v || vaultOf(link.owner, link.path)) throw new Fail(404, 'not_found');
  // Hacia afuera va el nombre de la nota, no en qué carpetas la guarda su dueño.
  return { path: n.path.split('/').pop(), text: unseal(n.text, n.e, 'notes.text'), updated: n.updated };
}

// ---------- En vivo ----------
// Quien tiene una nota abierta queda escuchando: se entera al instante cuando otro la guarda, y de quién más está.
const rooms = new Map();
const roomKey = (ownerId, p) => ownerId + ':' + p;
function announce(key, event, skip) {
  const room = rooms.get(key); if (!room) return;
  const who = Array.from(new Set(Array.from(room).map((c) => c.email)));
  for (const c of room) if (c !== skip && !c.res.destroyed) c.res.write('data: ' + JSON.stringify(Object.assign({ who }, event)) + '\n\n');
}
// Alguien guardó: quienes tienen la nota abierta se enteran, con la revisión nueva. text es lo que quedó guardado.
function tellSaved(ownerId, p, saved, who, text) {
  announce(roomKey(ownerId, p), { type: 'saved', by: who.by, updated: saved.updated, rev: saved.rev });
}
// Un aviso para todas las notas abiertas de una cuenta: por ejemplo, que cambió el estado de una carpeta con contraseña.
function announceUser(userId, event) { for (const key of rooms.keys()) if (key.startsWith(userId + ':')) announce(key, event); }
// Cada conexión abierta ocupa memoria y un descriptor: hay un tope por cuenta y otro por IP.
const live = new Map();
const liveAdd = (key, d) => { const n = (live.get(key) || 0) + d; if (n > 0) live.set(key, n); else live.delete(key); };
function listen(req, res, user, url) {
  const p = cleanPath(url.searchParams.get('path'));
  const { owner } = target(user, url, p, 'view');
  const key = roomKey(owner.id, p);
  const mine = ['u:' + user.id, 'ip:' + clientIp(req)];
  if ((live.get(mine[0]) || 0) >= LIVE_PER_USER || (live.get(mine[1]) || 0) >= LIVE_PER_IP) throw new Fail(429, 'too_many');
  mine.forEach((k) => liveAdd(k, 1));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.on('error', () => { /* la conexión se cortó: de limpiar se ocupa close */ });
  const client = { res, email: user.email };
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(client);
  announce(key, { type: 'presence' });
  const beat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 25000);
  req.on('close', () => { clearInterval(beat); mine.forEach((k) => liveAdd(k, -1)); const room = rooms.get(key); if (room) { room.delete(client); if (!room.size) rooms.delete(key); else announce(key, { type: 'presence' }); } });
}

// Comentarios para la IA: la persona marca un bloque de una nota y escribe qué quiere cambiar.
// Quedan pendientes hasta que la IA los lee con list_comments y los cierra con resolve_comment.
function addComment(user, body) {
  if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
  const p = cleanPath(body.path);
  // Un comentario cita el texto de la nota: en una carpeta con contraseña quedaría en claro en el servidor.
  if (vaultOf(user.id, p)) throw new Fail(409, 'vault', 'Notes in a folder protected with a password do not take comments for the AI');
  readNote(user, p);
  const text = String(body.text == null ? '' : body.text).trim(); const quote = String(body.quote == null ? '' : body.quote).trim().slice(0, 2000);
  if (!text || text.length > 2000) throw new Fail(400, 'bad_text');
  if (q("SELECT COUNT(*) AS n FROM comments WHERE user = ? AND status = 'open'").get(user.id).n >= 200) throw new Fail(429, 'too_many');
  const r = q('INSERT INTO comments (user, path, quote, text, created, e) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, p, seal(quote, 'comments.quote'), seal(text, 'comments.text'), now(), SEALED);
  return { id: Number(r.lastInsertRowid), path: p, quote, text, status: 'open', created: now() };
}
const listComments = (user, p, all) => q('SELECT id, path, quote, text, status, reply, created, done, e FROM comments WHERE user = ?' + (p ? ' AND path = ?' : '') + (all ? '' : " AND status = 'open'") + ' ORDER BY created').all(...(p ? [user.id, cleanPath(p)] : [user.id]))
  .map((c) => ({ id: c.id, path: c.path, quote: unseal(c.quote, c.e, 'comments.quote'), text: unseal(c.text, c.e, 'comments.text'), status: c.status, reply: unseal(c.reply, c.e, 'comments.reply'), created: c.created, done: c.done }));

// Un token puede estar limitado a una carpeta: fuera de ella no ve ni escribe nada.
const within = (user, p) => !user.scope || p === user.scope || p.startsWith(user.scope + '/');
function scoped(user, p) { p = cleanPath(p); if (!within(user, p)) throw new Fail(403, 'out_of_scope', 'This token only reaches the folder ' + user.scope + '/'); return p; }
const inFolder = (p, folder) => !folder || p.startsWith(folder.replace(/\/+$/, '') + '/');

// ---------- MCP (Streamable HTTP, respuestas JSON) ----------
const TOOLS = [
  { name: 'list_notes', description: 'List the Markdown notes in the SharpMD cloud folder, newest first. Pass a folder to list only what is inside it.', inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Optional folder, for example projects/launch' } } } },
  { name: 'list_folders', description: 'List the folders that hold notes, with how many notes each one has. A top-level folder is usually a project.', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_note', description: 'Read one note by its path.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of the note, for example ideas/launch.md' } }, required: ['path'] } },
  { name: 'write_note', description: 'Create a note or replace its whole content with Markdown text.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string', description: 'Full Markdown content' } }, required: ['path', 'text'] } },
  { name: 'append_note', description: 'Append Markdown text to the end of a note, creating it if it does not exist.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] } },
  { name: 'search_notes', description: 'Search the text of every note. Returns matching notes with the lines that match.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_comments', description: 'List the comments the user left for you and that are still open. Each one has the note path, the quoted passage it refers to and what the user asks. Check this when the user says they left comments, and before editing a note.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional: only the comments on this note' } } } },
  { name: 'resolve_comment', description: 'Mark a comment as done after making the change it asks for with write_note. Add a short reply saying what you changed.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, reply: { type: 'string', description: 'One or two sentences on what was changed' } }, required: ['id'] } },
];

// Lo que la IA lee cuando pide algo de una carpeta bloqueada: qué pasa y cómo lo resuelve la persona.
const LOCKED = (folder) => 'The folder "' + folder + '" is protected with a password and is locked, so its notes cannot be read, searched or changed right now. The person can unlock it for the AI from SharpMD: right-click the folder, then "Unlock for the AI". Ask them to do that, then try again.';
// La llave con la que este token puede usar una carpeta con contraseña, o null. Hace falta que la persona la haya
// desbloqueado para la IA y que la carpeta entera esté dentro del alcance del token.
const aiReach = (user, vault) => { const k = vault.state === 'on' && within(user, vault.folder) ? aiKey(vault) : null; return k ? k.key : null; };
// Para una ruta: null si no está en una carpeta con contraseña, la llave si está desbloqueada, o el aviso para la IA.
function vaultGate(user, p) {
  const vault = vaultOf(user.id, p); if (!vault) return null;
  const key = aiReach(user, vault);
  if (!key) throw new Fail(423, 'vault_locked', LOCKED(vault.folder));
  return key;
}

function callTool(user, name, args) {
  args = args || {};
  const vaults = vaultsOf(user.id);
  const tag = (p) => { const v = vaults.find((x) => p === x.folder || inside(p, x.folder)); return v ? { protected: true, locked: !aiReach(user, v) } : {}; };
  const mine = () => listNotes(user).filter((n) => within(user, n.path));
  if (name === 'list_notes') return mine().filter((n) => inFolder(n.path, args.folder && cleanPath(args.folder))).map((n) => Object.assign({ path: n.path, updated: new Date(n.updated).toISOString(), size: n.size }, tag(n.path)));
  if (name === 'list_folders') {
    const count = new Map();
    for (const n of mine()) { const parts = n.path.split('/'); for (let i = 1; i < parts.length; i++) { const f = parts.slice(0, i).join('/'); count.set(f, (count.get(f) || 0) + 1); } }
    // Una carpeta con contraseña figura aunque esté vacía.
    for (const v of vaults) if (within(user, v.folder) && !count.has(v.folder)) count.set(v.folder, 0);
    return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, notes]) => Object.assign({ folder, notes }, tag(folder)));
  }
  // Dentro de una carpeta desbloqueada para la IA se lee descifrando y se escribe cifrando, con el mismo formato
  // que usa el navegador. Una nota que el navegador todavía no cifró no se entrega.
  const read = (p, key) => {
    const n = readNote(user, p);
    if (!key) return n.text;
    if (!n.text.startsWith(VAULT)) throw new Fail(423, 'vault_locked', 'This note is still being encrypted by SharpMD. Try again in a moment.');
    return vaultOpen(key, p, n.text);
  };
  // La IA guarda sobre la revisión que hay en ese momento: lee y escribe sin soltar el hilo, así que no pisa un
  // guardado que entró en el medio ni se cruza con otro. Quien tiene la nota abierta se entera al instante.
  const revOf = (p) => { const at = q('SELECT rev FROM notes WHERE user = ? AND path = ?').get(user.id, p); return at ? at.rev : null; };
  const write = (p, key, text, base) => {
    text = String(text == null ? '' : text);
    if (key && Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large');
    const saved = writeNote(user, p, key ? vaultSeal(key, p, text) : text, base === undefined ? revOf(p) : base);
    tellSaved(user.id, p, saved, { by: 'mcp' }, text);
    return saved;
  };
  if (name === 'read_note') { const p = scoped(user, args.path); return read(p, vaultGate(user, p)); }
  if (name === 'write_note') { const p = scoped(user, args.path); const r = write(p, vaultGate(user, p), args.text); return 'Saved ' + r.path + ' (' + String(args.text == null ? '' : args.text).length + ' characters).'; }
  if (name === 'append_note') {
    // Lo que se lee y lo que se escribe son de la misma revisión: si no coincidiera, no se agrega sobre un texto viejo.
    const p = scoped(user, args.path); const key = vaultGate(user, p); let prev = ''; const base = revOf(p);
    try { prev = read(p, key); } catch (e) { if (e.code !== 'not_found') throw e; }
    const r = write(p, key, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + (prev ? '\n' : '') + String(args.text || ''), base);
    return 'Appended to ' + r.path + '.';
  }
  if (name === 'search_notes') {
    const results = searchNotes(user, args.query, (v) => aiReach(user, v)).filter((r) => within(user, r.path));
    // Si quedó alguna carpeta bloqueada al alcance del token, se dice: lo que hay adentro no se buscó.
    const shut = vaults.filter((v) => !aiReach(user, v) && (within(user, v.folder) || inside(user.scope, v.folder) || user.scope === v.folder)).map((v) => v.folder);
    return shut.length ? { results, locked_folders: shut, note: 'The notes inside locked folders were not searched. ' + LOCKED(shut[0]) } : results;
  }
  if (name === 'list_comments') return listComments(user, args.path ? scoped(user, args.path) : '', false).filter((c) => within(user, c.path)).map((c) => ({ id: c.id, path: c.path, quote: c.quote, comment: c.text, created: new Date(c.created).toISOString() }));
  if (name === 'resolve_comment') {
    const c = q('SELECT id, path, e FROM comments WHERE id = ? AND user = ?').get(+args.id, user.id);
    if (!c || !within(user, c.path)) throw new Fail(404, 'not_found');
    // La respuesta se guarda como el resto de la fila: cifrada si la fila lo está.
    const reply = String(args.reply || '').slice(0, 1000);
    q("UPDATE comments SET status = 'done', reply = ?, done = ? WHERE id = ?").run(c.e ? seal(reply, 'comments.reply') : reply, now(), c.id);
    announce(roomKey(user.id, c.path), { type: 'comments' });
    return 'Comment ' + c.id + ' marked as done.';
  }
  throw new Fail(400, 'unknown_tool');
}

function mcp(user, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'sharpmd', version: '1.0.0' },
    instructions: 'Notes are Markdown files in the user\'s SharpMD cloud folder. Paths look like folder/name.md, and a top-level folder is usually a project. The user can leave comments for you on a note: call list_comments, make each change with write_note, then resolve_comment. A folder marked as protected and locked is encrypted with a password: you cannot read it until the person unlocks it for the AI from SharpMD.' });
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
    res.setHeader('access-control-expose-headers', 'retry-after');
    // Un servidor propio en la misma máquina o red: el navegador pregunta antes de dejar que una web pública lo llame.
    if (req.headers['access-control-request-private-network']) res.setHeader('access-control-allow-private-network', 'true');
  }
}
// El cuerpo tal como llegó, hasta max bytes. Pasado el tope se deja de guardar y se responde 413: la conexión
// la corta quien responde, después de avisar.
const readRaw = (req, max) => new Promise((resolve, reject) => {
  let size = 0; let chunks = [];
  req.on('data', (c) => { size += c.length; if (size > (max || MAX_NOTE)) { chunks = []; reject(new Fail(413, 'too_large')); } else if (chunks) chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => reject(new Fail(400, 'bad_request')));
});
// El cuerpo como JSON. Las rutas esperan un objeto: cualquier otra cosa (null, un número, una lista) es un pedido mal armado.
const readAny = async (req) => { const raw = await readRaw(req, MAX_NOTE * 2); try { return raw ? JSON.parse(raw) : {}; } catch (e) { throw new Fail(400, 'bad_json'); } };
const readBody = async (req) => { const b = await readAny(req); if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Fail(400, 'bad_json'); return b; };
// Un tramo de la dirección mal codificado es un pedido mal armado, no un error del servidor.
const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { throw new Fail(400, 'bad_path'); } };

// ---------- Paddle ----------
// Lo único que activa o da de baja el plan pago. La firma va sobre el cuerpo tal como llegó.
// De quién es el aviso sale de custom_data.sharpmd_email, que escribe la página de pago, o de la
// suscripción ya guardada (las renovaciones no traen custom_data). Nunca del correo del cliente
// de Paddle: quien paga con el correo de otro no compra para el otro.
// Un aviso vale cinco minutos desde que Paddle lo firmó: pasado eso, una copia vieja ya no entra.
const PADDLE_ACTIVE = ['active', 'trialing', 'past_due'];
function paddleSigned(raw, header) {
  const parts = Object.fromEntries(String(header || '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }));
  if (!/^\d{1,12}$/.test(parts.ts || '') || !parts.h1 || Math.abs(Date.now() / 1000 - +parts.ts) > 300) return false;
  return same(crypto.createHmac('sha256', env.PADDLE_WEBHOOK_SECRET).update(parts.ts + ':' + raw).digest('hex'), parts.h1);
}
async function paddleWebhook(req) {
  if (!env.PADDLE_WEBHOOK_SECRET) throw new Fail(404, 'no_route');
  const raw = await readRaw(req);
  if (!paddleSigned(raw, req.headers['paddle-signature'])) { if (req.headers['paddle-signature']) console.error('paddle: aviso con firma inválida, revisar PADDLE_WEBHOOK_SECRET'); throw new Fail(401, 'bad_signature'); }
  let ev; try { ev = JSON.parse(raw); } catch (e) { throw new Fail(400, 'bad_json'); }
  if (!ev || typeof ev !== 'object') throw new Fail(400, 'bad_json');
  const d = ev.data && typeof ev.data === 'object' ? ev.data : {};
  if (!/^subscription\./.test(ev.event_type || '')) return { ok: true, ignored: 'event' };
  // La cuenta de Paddle puede vender otros productos: solo cuentan los precios marcados como de SharpMD.
  if (!(Array.isArray(d.items) ? d.items : []).some((i) => i && i.price && i.price.custom_data && i.price.custom_data.app === 'sharpmd')) return { ok: true, ignored: 'product' };
  const id = String(d.id || ''); const at = Date.parse(ev.occurred_at) || 0;
  // Una suscripción queda atada a la cuenta con la que se vio la primera vez. Sin eso, la cuenta sale de
  // custom_data (lo escribe la página de pago) o de la suscripción guardada antes de que existiera esta tabla.
  const known = id ? q('SELECT * FROM paddle_subs WHERE id = ?').get(id) : null;
  const tagged = d.custom_data && d.custom_data.sharpmd_email;
  let user = known ? q('SELECT * FROM users WHERE id = ?').get(known.user) : null;
  if (!user && tagged) { try { user = q('SELECT * FROM users WHERE email = ?').get(cleanEmail(tagged)); } catch (e) { user = null; } }
  if (!user && id) user = q('SELECT * FROM users WHERE paddle_sub = ?').get(id);
  if (!user || !id) { console.error('paddle: aviso ' + String(ev.event_type).slice(0, 40) + ' sin cuenta · ' + id.slice(0, 60)); return { ok: true, ignored: 'user' }; }
  // Los avisos pueden llegar desordenados o repetidos: uno anterior al último aplicado no cambia nada.
  if (known && at && at < known.at) return { ok: true, ignored: 'stale' };
  const status = PADDLE_ACTIVE.includes(d.status) ? 'active' : 'ended';
  q('INSERT INTO paddle_subs (id, user, status, at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, at = MAX(at, excluded.at)').run(id, user.id, status, at);
  // El plan es pago mientras quede alguna suscripción activa de la cuenta. Así, quien paga una suscripción a nombre
  // de otra persona y después la cancela no le saca el plan que esa persona paga por su lado.
  const other = q("SELECT id FROM paddle_subs WHERE user = ? AND status = 'active' ORDER BY at DESC LIMIT 1").get(user.id);
  const plan = other ? 'pro' : 'free';
  q('UPDATE users SET plan = ?, paddle_sub = ? WHERE id = ?').run(plan, other ? other.id : id, user.id);
  return { ok: true, plan };
}

async function route(req, url) {
  const p = url.pathname; const m = req.method;
  if (p === '/health') return { ok: true };
  if (p === '/auth/start' && m === 'POST') return authStart(req, await readBody(req));
  if (p === '/auth/verify' && m === 'POST') return authVerify(req, await readBody(req));
  if (p === '/paddle/webhook' && m === 'POST') return paddleWebhook(req);
  if (p === '/feedback' && m === 'POST') return feedback(req, await readBody(req));
  if (p === '/admin/plan' && m === 'POST') {
    // La misma respuesta sin clave configurada, sin clave en el pedido o con una equivocada. Diez fallos por hora por IP.
    const ip = 'admin:' + clientIp(req);
    limit(ip, 10, HOUR, 'too_many');
    if (!env.ADMIN_KEY || !same(req.headers['x-admin-key'] || '', env.ADMIN_KEY)) { mark(ip); throw new Fail(403, 'forbidden'); }
    const b = await readBody(req);
    const r = q('UPDATE users SET plan = ? WHERE email = ?').run(b.plan === 'pro' ? 'pro' : 'free', cleanEmail(b.email));
    if (!r.changes) throw new Fail(404, 'not_found');
    return { ok: true };
  }
  if (p === '/mcp') {
    if (m !== 'POST') throw new Fail(405, 'method_not_allowed');
    const user = userFrom(req, 'token');
    if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
    const body = await readAny(req);
    // Un lote largo son muchas consultas seguidas a la base, que atiende de a un pedido: tiene tope.
    if (Array.isArray(body) && body.length > MAX_BATCH) throw new Fail(413, 'too_large');
    const out = Array.isArray(body) ? body.map((x) => mcp(user, x)).filter(Boolean) : mcp(user, body);
    return out == null || (Array.isArray(out) && !out.length) ? { __status: 202 } : out;
  }
  if (p.startsWith('/public/') && m === 'GET') return publicNote(dec(p.slice(8)), req.headers['x-password']);
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
  if (p === '/vaults' && m === 'GET') return vaultsOf(user.id).map(vaultView);
  if (p === '/vaults' && m === 'POST') return vaultCreate(user, await readBody(req));
  const vm = /^\/vaults\/(\d+)(?:\/(unlock|lock|open))?$/.exec(p);
  if (vm) {
    const v = q('SELECT * FROM vaults WHERE id = ? AND user = ?').get(+vm[1], user.id);
    if (!v) throw new Fail(404, 'not_found');
    if (!vm[2] && m === 'PUT') return vaultRewrap(user, v, await readBody(req));
    if (!vm[2] && m === 'DELETE') return vaultRemove(user, v);
    if (vm[2] === 'unlock' && m === 'POST') return vaultUnlock(user, v, await readBody(req));
    if (vm[2] === 'lock' && m === 'POST') { aiForget(v, true); return vaultView(v); }
    if (vm[2] === 'open' && m === 'POST') return vaultOpening(user, v);
  }
  if (p === '/auth/logout' && m === 'POST') { q('DELETE FROM sessions WHERE hash = ?').run(sha(req.headers.authorization.split(/\s+/)[1])); return { ok: true }; }
  if (p === '/tokens' && m === 'GET') return q('SELECT id, name, scope, created, used FROM tokens WHERE user = ? ORDER BY created DESC').all(user.id);
  if (p === '/comments' && m === 'GET') return listComments(user, url.searchParams.get('path') || '', url.searchParams.get('all') === '1');
  if (p === '/comments' && m === 'POST') { const c = addComment(user, await readBody(req)); announce(roomKey(user.id, c.path), { type: 'comments' }); return c; }
  if (p.startsWith('/comments/') && m === 'DELETE') { q('DELETE FROM comments WHERE id = ? AND user = ?').run(+p.slice(10), user.id); return { ok: true }; }
  if (p === '/tokens' && m === 'POST') {
    if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
    if (q('SELECT COUNT(*) AS n FROM tokens WHERE user = ?').get(user.id).n >= MAX_TOKENS) throw new Fail(429, 'too_many');
    const b = await readBody(req); const token = 'mdt_' + random(30);
    const scope = String(b.folder || '').trim() ? cleanPath(String(b.folder).replace(/\/+$/, '')) : '';
    q('INSERT INTO tokens (hash, user, name, scope, created) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, String(b.name || 'AI').slice(0, 60), scope, now());
    return { token, scope, mcp_url: PUBLIC_URL + '/mcp' };
  }
  if (p.startsWith('/tokens/') && m === 'DELETE') { q('DELETE FROM tokens WHERE id = ? AND user = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/notes' && m === 'GET') {
    const oid = +(url.searchParams.get('o') || user.id);
    if (oid === user.id) return listNotes(user).map((n) => (n.v ? n : { path: n.path, updated: n.updated, size: n.size }));
    return sharedWith(user).filter((n) => n.owner === oid).map((n) => ({ path: n.path, updated: n.updated, size: n.size }));
  }
  if (p === '/search' && m === 'GET') return searchNotes(user, url.searchParams.get('q'));
  if (p === '/rename' && m === 'POST') { const b = await readBody(req); return renameNote(user, b.from, b.to, b); }
  if (p.startsWith('/notes/')) {
    const note = dec(p.slice(7));
    const clean = cleanPath(note);
    if (m === 'GET') { const t = target(user, url, clean, 'view'); return Object.assign(readNote(t.owner, clean), { role: t.role }); }
    if (m === 'PUT') {
      const t = target(user, url, clean, 'edit');
      const body = await readBody(req);
      const saved = writeNote(t.owner, clean, body.text, cleanRev(body.rev));
      tellSaved(t.owner.id, clean, saved, { by: user.email }, String(body.text == null ? '' : body.text));
      return saved;
    }
    if (m === 'DELETE') return deleteNote(target(user, url, clean, 'owner').owner, clean);
  }
  if (p.startsWith('/versions/') && m === 'GET') return q('SELECT id, saved, size FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 100').all(user.id, cleanPath(dec(p.slice(10))));
  if (p.startsWith('/version/') && m === 'GET') {
    const v = q('SELECT id, path, text, saved, e, aad FROM versions WHERE id = ? AND user = ?').get(+p.slice(9), user.id);
    if (!v) throw new Fail(404, 'not_found');
    // aad: en una versión cifrada desde el navegador, la ruta con la que se cifró (la nota pudo cambiar de nombre).
    return Object.assign({ id: v.id, path: v.path, text: unseal(v.text, v.e, 'versions.text'), saved: v.saved }, v.aad ? { aad: v.aad } : {});
  }
  throw new Fail(404, 'no_route');
}

// En todas las respuestas: nada se guarda en caché, el navegador no adivina el tipo y no viaja la dirección de origen.
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const server = http.createServer(async (req, res) => {
  for (const k in BASE_HEADERS) res.setHeader(k, BASE_HEADERS[k]);
  res.setHeader('vary', 'origin');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events' && req.method === 'GET') { listen(req, res, userFrom(req, 'session'), url); return; }
    const out = await route(req, url);
    if (out && out.__status) { res.writeHead(out.__status); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    // De un error inesperado se anota qué fue y dónde, sin el cuerpo del pedido. Hacia afuera va solo "server_error".
    if (status >= 500) console.error(status === 500 ? 'error 500 en ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 80) + ' · ' + String(e && e.stack || e).slice(0, 1500) : 'error ' + status + ' ' + (e.code || '') + ' en ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 80));
    if (res.headersSent) { res.end(); return; }
    const body = JSON.stringify(e instanceof Fail ? Object.assign({ error: e.code, message: e.message || '' }, e.extra) : { error: 'server_error', message: '' });
    if (e instanceof Fail && e.extra && e.extra.retry_after) res.setHeader('retry-after', String(e.extra.retry_after));
    // Un cuerpo pasado de tamaño: se avisa y recién ahí se corta, para no seguir recibiendo.
    if (status === 413) { res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', connection: 'close' }); res.end(body, () => req.destroy()); return; }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  }
});
// Conexiones lentas: los encabezados tienen 15 segundos para llegar y el pedido entero, un minuto. /events no
// entra en esa cuenta: lo que queda abierto ahí es la respuesta.
server.headersTimeout = 15000; server.requestTimeout = 60000;
// Un error que se escapa de una ruta se anota y el servicio sigue: no se cae por un pedido.
process.on('uncaughtException', (e) => console.error('error no capturado · ' + String(e && e.stack || e).slice(0, 1500)));
process.on('unhandledRejection', (e) => console.error('promesa sin atender · ' + String(e && e.stack || e).slice(0, 1500)));

// Limpieza: códigos vencidos, historial viejo y sesiones sin uso, cada seis horas; los topes en memoria, cada diez minutos.
setInterval(() => {
  q('DELETE FROM codes WHERE expires < ?').run(now());
  q('DELETE FROM versions WHERE saved < ?').run(now() - HISTORY_DAYS * DAY);
  q('DELETE FROM sessions WHERE seen < ?').run(now() - SESSION_DAYS * DAY);
}, 6 * HOUR).unref();
setInterval(() => { for (const k of marks.keys()) if (!recent(k, DAY).length) marks.delete(k); }, 600000).unref();

server.listen(PORT, env.HOST || '127.0.0.1', () => console.log('SharpMD Sync en ' + PUBLIC_URL + ' (puerto ' + PORT + ')'));
