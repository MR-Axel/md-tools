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
//   LIVE_FREE=1     habilita las sesiones en vivo también en el plan gratis
//   LIVE_PEOPLE     personas por sesión en vivo, contando a quien la abrió (12)
//   LIVE_IDLE_MS    cuánto dura una sesión en vivo sin nadie conectado (12 horas)
//   LIVE_GUEST_MS   cuánto conserva su lugar un invitado sin conexión (2 minutos)
//   PADDLE_TEAM_BASE, PADDLE_TEAM_SEAT   ids de los dos precios del plan de equipo en Paddle: el base (cubre 2 personas)
//                   y el de cada lugar adicional. Con ellos el aviso de Paddle reconoce la suscripción de un equipo
//   PADDLE_API_KEY  clave de la API de Paddle: con ella el servidor cambia la cantidad de lugares de un equipo.
//                   Sin estas tres (y PADDLE_WEBHOOK_SECRET) el plan de equipo queda apagado y la app no lo ofrece
//   PADDLE_API_URL  dirección de la API de Paddle (https://api.paddle.com; la de pruebas es https://sandbox-api.paddle.com)
//   CHECKOUT_TEAM   enlace de pago del plan de equipo que la app muestra en Ajustes → Plan
//   TEAM_MAX_SEATS  lugares que puede tener un equipo como máximo (50)
//   TEAM_INVITES_DAY  invitaciones que un equipo puede mandar por día (20)
//   APP_URL         dirección de la app: a ella llevan el correo de invitación y los enlaces que el MCP devuelve
//                   para abrir una nota (https://sharpmd.app/src/app.html)
//   TRASH_DAYS      días que una nota eliminada queda en la papelera antes de borrarse del todo (30)
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
const TRASH_MS = Math.max(0, +(env.TRASH_DAYS || 30)) * 86400000; // cuánto queda en la papelera una nota eliminada
const MAX_TRASH = 300; // notas en la papelera por cuenta: pasado eso se van las más viejas
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
// share: el token puede compartir notas y crear enlaces públicos. Los que ya existían quedan sin ese permiso.
try { db.exec('ALTER TABLE tokens ADD COLUMN share INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
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
// Papelera: la nota eliminada, como estaba (v: cifrada desde el navegador; rev: su revisión), y cuándo se eliminó.
db.exec('CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, size INTEGER, e INTEGER NOT NULL DEFAULT 0, v INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS trash_user ON trash (user, deleted)');
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
  { name: 'trash', cols: ['text'], any: 'SELECT 1 FROM trash WHERE e = 1 LIMIT 1', pick: 'SELECT rowid AS rid, text FROM trash WHERE e = 0 LIMIT 50', put: 'UPDATE trash SET text = ?, e = 1 WHERE rowid = ? AND e = 0' },
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
  return { session, account: account(userById(user.id)) };
}

function userFrom(req, kind) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new Fail(401, 'no_auth');
  if (kind === 'session' && m[1].startsWith('mds_')) {
    const s = q('SELECT user FROM sessions WHERE hash = ? AND seen > ?').get(sha(m[1]), now() - SESSION_DAYS * DAY);
    if (s) { q('UPDATE sessions SET seen = ? WHERE hash = ?').run(now(), sha(m[1])); return userById(s.user); }
  }
  if (kind === 'token' && m[1].startsWith('mdt_')) {
    const t = q('SELECT id, user, scope, share FROM tokens WHERE hash = ?').get(sha(m[1]));
    if (t) { q('UPDATE tokens SET used = ? WHERE id = ?').run(now(), t.id); const u = userById(t.user); if (u) { u.scope = t.scope || ''; u.canShare = !!t.share; } return u; }
  }
  throw new Fail(401, 'bad_auth');
}

const countNotes = (user) => q('SELECT COUNT(*) AS n FROM notes WHERE user = ?').get(user.id).n;
const mcpAllowed = (user) => user.plan === 'pro' || !!env.MCP_FREE;
const shareAllowed = (user) => user.plan === 'pro' || !!env.SHARE_FREE;
// plan es el que vale ahora; own_plan, el que la cuenta paga por su lado (un miembro de un equipo puede tener los dos).
// Administra una suscripción quien la paga: la propia, o la del equipo si es quien lo administra.
const account = (user) => ({ id: user.id, share: shareAllowed(user), live: user.plan === 'pro' || !!env.LIVE_FREE, email: user.email, plan: user.plan, own_plan: user.own || user.plan, notes: countNotes(user), limit: user.plan === 'pro' ? null : FREE_NOTES, mcp: mcpAllowed(user), mcp_url: PUBLIC_URL + '/mcp',
  manage: ((user.own || user.plan) === 'pro' || (user.team && user.team.owner === user.id && user.team.sub)) && env.PORTAL_URL ? env.PORTAL_URL : '',
  checkout: { monthly: withEmail(env.CHECKOUT_MONTHLY, user), yearly: withEmail(env.CHECKOUT_YEARLY, user) }, team: teamView(user) });

// ---------- Comentarios ----------
// Lo que alguien escribe desde "Enviar comentarios" llega por correo a FEEDBACK_TO. Entra con o sin sesión.
// Tope de cinco por hora por IP y por cuenta.
const FEEDBACK_MAX = 5;
async function feedback(req, body) {
  if (!env.FEEDBACK_TO || !(env.RESEND_API_KEY || env.MAIL_WEBHOOK || env.DEV_CODES)) throw new Fail(404, 'no_route');
  let user = null;
  if (req.headers.authorization) { try { user = userFrom(req, 'session'); } catch (e) { /* sesión vencida: entra como anónimo */ } }
  const text = String(body.text == null ? '' : body.text).trim();
  // Una denuncia ("Denunciar esta nota") entra por acá mismo, con report: dice qué nota es (el enlace público, o la
  // ruta y la cuenta dueña), nunca su contenido. El motivo es opcional. Lleva los mismos topes que un comentario.
  const rep = body.report && typeof body.report === 'object' ? body.report : null;
  if ((!rep && text.length < 5) || text.length > 4000) throw new Fail(400, 'bad_text');
  const from = user ? user.email : (String(body.email || '').trim() ? cleanEmail(body.email) : '');
  const keys = ['ip:' + clientIp(req)].concat(user ? ['user:' + user.id] : []);
  keys.forEach((k) => limit('fb:' + k, FEEDBACK_MAX, HOUR, 'too_many'));
  keys.forEach((k) => mark('fb:' + k));
  // Del contexto solo pasan estos cuatro datos, recortados: nada de notas ni de rutas.
  const c = body.context && typeof body.context === 'object' ? body.context : {};
  const field = (v, max) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max) || '-';
  const mail = { to: env.FEEDBACK_TO, subject: rep ? 'SharpMD report' : 'SharpMD feedback',
    text: (rep ? 'Reported note: ' + field(rep.note, 300) + '\nOwner: ' + field(rep.owner, 120) + '\nKind: ' + (['link', 'shared', 'live'].includes(rep.kind) ? rep.kind : '-') + '\n\n' : '') +
      (text || '(no reason given)') + '\n\n---\nFrom: ' + (from || 'anonymous') + (user ? ' (signed in, ' + user.plan + ' plan)' : '') +
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
  // Lo que había de esa carpeta en la papelera estaba en claro.
  q('DELETE FROM trash WHERE user = ? AND substr(path, 1, length(?)) = ?').run(userId, pre, pre);
  // Y las sesiones en vivo de sus notas: desde ahora viajan cifradas y el servidor no las puede repartir.
  for (const row of q('SELECT * FROM lives WHERE owner = ? AND substr(path, 1, length(?)) = ?').all(userId, pre, pre)) liveEnd(row, 'closed');
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
  q('DELETE FROM trash WHERE user = ? AND v = 1 AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre); // ni lo cifrado de la papelera
  q('DELETE FROM vaults WHERE id = ?').run(v.id);
  announceUser(user.id, { type: 'vault' });
  return { ok: true };
}
// Eliminar la carpeta entera sin su llave: para quien perdió la contraseña y la clave de respaldo. Se van la
// bóveda, sus notas, su historial y lo que tuviera en la papelera. Nada de eso pasa por la papelera: sin la llave
// no se podría leer nunca. Quien lo pide escribe el nombre de la carpeta, y acá se vuelve a comparar.
function vaultDestroy(user, v, body) {
  if (typeof body.folder !== 'string' || body.folder !== v.folder) throw new Fail(400, 'bad_confirm');
  const pre = v.folder + '/';
  aiForget(v, false);
  for (const row of q('SELECT * FROM lives WHERE owner = ? AND substr(path, 1, length(?)) = ?').all(user.id, pre, pre)) liveEnd(row, 'closed');
  let notes = 0;
  db.exec('BEGIN');
  try {
    notes = q('DELETE FROM notes WHERE user = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre).changes;
    q('DELETE FROM versions WHERE user = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre);
    q('DELETE FROM comments WHERE user = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre);
    q('DELETE FROM trash WHERE user = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre);
    q('DELETE FROM links WHERE owner = ? AND substr(path, 1, length(?)) = ?').run(user.id, pre, pre);
    q('DELETE FROM shares WHERE owner = ? AND (path = ? OR substr(path, 1, length(?)) = ?)').run(user.id, v.folder, pre, pre);
    q('DELETE FROM vaults WHERE id = ?').run(v.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  scrub();
  announceUser(user.id, { type: 'vault' });
  return { ok: true, notes: Number(notes) };
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
// Una nota más: en el plan gratis hay tope. Lo que está en la papelera no cuenta.
function roomFor(user) {
  if (user.plan === 'pro' || countNotes(user) < FREE_NOTES) return;
  if (user.email.startsWith('team:')) throw new Fail(402, 'team_ended', 'This team is no longer on the paid plan: its notes can still be read and edited, but no new ones can be added');
  throw new Fail(402, 'note_limit', 'The free plan holds ' + FREE_NOTES + ' notes');
}
function writeNote(user, p, text, base) {
  p = cleanPath(p); text = String(text == null ? '' : text);
  const kind = checkText(user.id, p, text);
  const row = q('SELECT text, e, v, size, rev, updated FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  const prev = row ? { text: unseal(row.text, row.e, 'notes.text') } : null;
  if (row && base != null && base !== row.rev) throw new Fail(409, 'rev_conflict', '', { text: prev.text, rev: row.rev, updated: row.updated });
  if (!prev) roomFor(user);
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
// Eliminar manda la nota a la papelera, donde queda TRASH_DAYS días: se guarda como estaba (una nota de una
// carpeta con contraseña sigue cifrada con su llave y su ruta) y, con DATA_KEY, cifrada en reposo. forever la
// borra sin pasar por ahí: lo usa la app cuando la nota en realidad se mudó (de lo propio al equipo, o al revés).
// Una nota que estaba en claro dentro de una carpeta con contraseña (el navegador todavía no la cifró) tampoco
// pasa por la papelera: quedaría en claro.
function deleteNote(user, p, forever) {
  p = cleanPath(p);
  const row = q('SELECT text, e, v, size, rev FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  if (!row) throw new Fail(404, 'not_found');
  const vault = vaultOf(user.id, p);
  const keep = !forever && TRASH_MS > 0 && (row.v ? !!vault : !vault);
  db.exec('BEGIN');
  try {
    if (keep) {
      q('INSERT INTO trash (user, path, text, size, e, v, rev, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, p, seal(unseal(row.text, row.e, 'notes.text'), 'trash.text'), row.size, SEALED, row.v, row.rev, now());
      q('DELETE FROM trash WHERE user = ? AND id NOT IN (SELECT id FROM trash WHERE user = ? ORDER BY deleted DESC, id DESC LIMIT ?)').run(user.id, user.id, MAX_TRASH);
    }
    q('DELETE FROM notes WHERE user = ? AND path = ?').run(user.id, p);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  liveDrop(user.id, cleanPath(p));
  q('DELETE FROM comments WHERE user = ? AND path = ?').run(user.id, cleanPath(p));
  // Los enlaces públicos y lo compartido de esa nota se van con ella: una nota nueva con el mismo nombre no nace publicada.
  q('DELETE FROM links WHERE owner = ? AND path = ?').run(user.id, cleanPath(p));
  q("DELETE FROM shares WHERE owner = ? AND path = ? AND kind != 'folder'").run(user.id, cleanPath(p));
  return { ok: true, trash: keep };
}

// ---------- Papelera ----------
// Lo que está acá no es una nota: no cuenta para el tope del plan gratis y no lo alcanzan la búsqueda, compartir,
// los enlaces públicos, las sesiones en vivo ni el MCP (todo eso trabaja sobre la tabla de notas). Solo se lista,
// se restaura o se borra del todo, con la sesión de la cuenta; la del equipo, cualquiera de sus miembros.
const trashSweep = () => q('DELETE FROM trash WHERE deleted < ?').run(now() - TRASH_MS);
const trashList = (owner) => { trashSweep(); return q('SELECT id, path, size, v, deleted FROM trash WHERE user = ? ORDER BY deleted DESC, id DESC').all(owner.id).map((r) => ({ id: r.id, path: r.path, size: r.size, deleted: r.deleted, expires: r.deleted + TRASH_MS, protected: !!r.v })); };
// Una ruta libre a partir de otra: "plan.md" pasa a "plan (2).md", "plan (3).md"...
function freePath(userId, p) {
  const dot = p.lastIndexOf('.'); const cut = dot > p.lastIndexOf('/') + 1 ? dot : p.length;
  for (let i = 2; i < 1000; i++) { const x = p.slice(0, cut) + ' (' + i + ')' + p.slice(cut); if (!q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(userId, x)) return cleanPath(x); }
  throw new Fail(409, 'exists');
}
// Restaurar devuelve la nota a su ruta. Si ahí ya hay otra, vuelve con otro nombre. Una nota cifrada desde el
// navegador está atada a su ruta: para cambiarle el nombre hay que volver a cifrarla, y eso lo hace el navegador.
// El servidor le contesta 409 trash_rekey con el texto cifrado y la ruta libre (to); el navegador repite el pedido
// con esa ruta y el texto cifrado para ella.
function trashRestore(owner, id, body) {
  trashSweep();
  const row = q('SELECT * FROM trash WHERE id = ? AND user = ?').get(+id, owner.id);
  if (!row) throw new Fail(404, 'not_found');
  roomFor(owner);
  let text = unseal(row.text, row.e, 'trash.text'); let to = row.path;
  if (q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(owner.id, to)) {
    to = freePath(owner.id, row.path);
    if (row.v) {
      if (body.to !== to || typeof body.text !== 'string') throw new Fail(409, 'trash_rekey', 'A note with that name already exists: this one has to be encrypted again for its new name', { path: row.path, to, text });
      text = body.text;
    }
  }
  const kind = checkText(owner.id, to, text);
  if (kind.v !== row.v) throw new Fail(409, row.v ? 'vault_text' : 'vault');
  const at = now(); const rev = row.rev + 1;
  db.exec('BEGIN');
  try {
    q('INSERT INTO notes (user, path, text, updated, size, e, v, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(owner.id, to, seal(text, 'notes.text'), at, kind.size, SEALED, kind.v, rev);
    q('DELETE FROM trash WHERE id = ?').run(row.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { path: to, from: row.path, updated: at, size: kind.size, rev };
}
function trashRoute(user, p, m, url, body) {
  const owner = spaceOf(user, url.searchParams.get('o'));
  if (p === '/trash' && m === 'GET') return trashList(owner);
  if (p === '/trash' && m === 'DELETE') return { ok: true, removed: Number(q('DELETE FROM trash WHERE user = ?').run(owner.id).changes) };
  const tm = /^\/trash\/(\d+)(\/restore)?$/.exec(p);
  if (tm && tm[2] && m === 'POST') return trashRestore(owner, tm[1], body);
  if (tm && !tm[2] && m === 'DELETE') { if (!q('DELETE FROM trash WHERE id = ? AND user = ?').run(+tm[1], owner.id).changes) throw new Fail(404, 'not_found'); return { ok: true }; }
  throw new Fail(404, 'no_route');
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
    liveDrop(user.id, from);
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
  // Una sesión en vivo es de la nota en esa ruta: al moverla o cambiarle el nombre, se cierra.
  liveDrop(user.id, from);
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
  // El espacio del equipo: cualquier miembro lee, edita, mueve y elimina sus notas.
  if (user.team && user.team.space === ownerId) return 'team';
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
  if (!role || (need === 'edit' && role === 'view') || (need === 'owner' && role !== 'owner' && role !== 'team')) throw new Fail(403, 'no_access');
  return { owner: ownerId === user.id ? user : userById(ownerId), role };
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
// Con quién compartió la cuenta y qué enlaces públicos tiene; con of, solo lo de esa ruta.
function sharesOf(user, of) {
  const people = q('SELECT id, path, kind, email, role FROM shares WHERE owner = ?').all(user.id).filter((s) => !of || s.path === of);
  const links = q('SELECT id, path, pass IS NOT NULL AS protected, created FROM links WHERE owner = ?').all(user.id).filter((l) => !of || l.path === of);
  return { people, links };
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
  const r = q('INSERT INTO links (hash, owner, path, pass, created) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, p, pass, now());
  return { id: Number(r.lastInsertRowid), token, protected: !!pass };
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
// Cada conexión: { res, email, uid } si es de una cuenta, o { res, gid, live } si es de un invitado de una sesión
// en vivo. Los avisos de la cuenta (quién está, por correo; comentarios; carpetas con contraseña) no le llegan
// nunca a un invitado: lo suyo sale solo por tellLive y tellSaved.
const rooms = new Map();
const roomKey = (ownerId, p) => ownerId + ':' + p;
const push = (c, event) => { if (!c.res.destroyed) c.res.write('data: ' + JSON.stringify(event) + '\n\n'); };
const whoIn = (room) => Array.from(new Set(Array.from(room).filter((c) => c.email).map((c) => c.email)));
function announce(key, event, skip) {
  const room = rooms.get(key); if (!room) return;
  const who = whoIn(room);
  for (const c of room) if (c !== skip && !c.gid) push(c, Object.assign({ who }, event));
}
// Qué cambió entre dos textos, por líneas: de la línea at se sacan del y entran lines. Lo usa el aviso de guardado
// de una sesión en vivo cuando el texto es grande, para no mandar la nota entera con cada cambio.
function linePatch(prev, text) {
  const b = prev.split('\n'); const x = text.split('\n');
  let s = 0; while (s < b.length && s < x.length && b[s] === x[s]) s++;
  let e = 0; while (e < b.length - s && e < x.length - s && b[b.length - 1 - e] === x[x.length - 1 - e]) e++;
  return { at: s, del: b.length - e - s, lines: x.slice(s, x.length - e) };
}
const LIVE_INLINE = 4000; // hasta este largo el aviso lleva el texto entero
// Alguien guardó: quienes tienen la nota abierta se enteran, con la revisión nueva. who: { by, pid }, donde by es
// el correo de la cuenta (o 'mcp', o 'guest') y pid quién fue dentro de la sesión en vivo ('o' quien la abrió,
// 'g3' un invitado, 'x' otro). Con una sesión abierta, a quienes participan les llega además el cambio mismo: el
// texto nuevo o, si es largo, las líneas que cambiaron sobre la revisión anterior (base). Así lo aplican sin pedir
// la nota. A un invitado no le llega ningún correo. text es lo que quedó guardado, en claro.
function tellSaved(ownerId, p, saved, who, text) {
  const live = liveRow(ownerId, p);
  if (live) memOf(live).last = { rev: saved.rev, pid: who.pid || 'x' };
  const room = rooms.get(roomKey(ownerId, p)); if (!room) return;
  let change = null;
  if (live && text != null) {
    const patch = saved.prev != null && text.length > LIVE_INLINE ? linePatch(saved.prev, text) : null;
    change = patch && JSON.stringify(patch.lines).length < text.length / 2 ? { base: saved.rev - 1, patch } : { text };
  }
  const list = whoIn(room); const pid = who.pid || 'x';
  for (const c of room) {
    const member = !!live && (c.gid ? c.live === live.id : c.uid === ownerId);
    if (c.gid && !member) continue;
    const ev = c.gid ? { type: 'saved', pid, updated: saved.updated, rev: saved.rev } : { who: list, type: 'saved', by: who.by, updated: saved.updated, rev: saved.rev, pid };
    push(c, member && change ? Object.assign(ev, change) : ev);
  }
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
  const client = { res, email: user.email, uid: user.id };
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(client);
  announce(key, { type: 'presence' });
  // Si la nota tiene una sesión en vivo y quien entra es quien la abrió, recibe quiénes están.
  const session = owner.id === user.id ? liveRow(owner.id, p) : null;
  if (session) { push(client, { type: 'live', open: true, people: livePeople(session) }); tellLive(session); }
  const beat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 25000);
  req.on('close', () => {
    clearInterval(beat); mine.forEach((k) => liveAdd(k, -1));
    const room = rooms.get(key); if (room) { room.delete(client); if (!room.size) rooms.delete(key); else announce(key, { type: 'presence' }); }
    if (owner.id === user.id) { const now_ = liveRow(owner.id, p); if (now_) { liveTouch(now_); tellLive(now_); } }
  });
}

// ---------- Sesión en vivo ----------
// Quien tiene una nota propia y plan pago abre una sesión sobre esa nota y pasa un enlace. Quien tiene el enlace
// entra sin cuenta: elige un nombre y recibe un pase que sirve SOLO para esa nota y solo mientras la sesión esté
// abierta (leerla, guardarla con revisión, escuchar sus cambios y decir en qué bloque está). Nada más: el pase no
// es una sesión de cuenta ni un token, y fuera de /live/ ninguna ruta lo acepta.
//   - Del enlace se guarda el hash del secreto (256 bits al azar), nunca el secreto.
//   - Los invitados viven en memoria: su nombre, su color y su pase (como hash). No se escriben en la base, y al
//     cerrar la sesión, al sacarlos o al reiniciar el servidor dejan de existir. Con el enlace vuelven a entrar.
//   - Sacar a un invitado cambia el enlace: si no, volvería a entrar con el mismo. Los demás siguen adentro.
//   - La sesión se cierra a mano, sola tras LIVE_IDLE_MS sin nadie conectado, y si la nota se elimina, cambia de
//     nombre o entra a una carpeta con contraseña (ahí el servidor no puede leerla), o si la cuenta deja el plan pago.
const LIVE_PEOPLE = Math.max(2, +(env.LIVE_PEOPLE || 12)); // personas por sesión, contando a quien la abrió
const LIVE_IDLE_MS = +(env.LIVE_IDLE_MS || 12 * HOUR); // sin nadie conectado, la sesión vence
const LIVE_GUEST_MS = +(env.LIVE_GUEST_MS || 120000); // un invitado sin conexión ni pedidos deja su lugar
const LIVE_EDIT_MS = 8000; // "está escribiendo en este bloque" vale este tiempo si no se renueva
const MAX_LIVES = 20; const LIVE_PER_GUEST = 4; const LIVE_COLORS = 12;
db.exec('CREATE TABLE IF NOT EXISTS lives (id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, owner INTEGER NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, UNIQUE (owner, path))');
// Quien ya entró guarda una contraseña de reingreso propia (acá, su hash): si su pase se pierde (el servidor se
// reinició, o estuvo un rato largo sin conexión) vuelve a entrar con ella aunque el enlace haya cambiado mientras
// tanto. Se borra al sacarlo, al salir por su cuenta y al cerrar la sesión.
db.exec('CREATE TABLE IF NOT EXISTS live_tickets (hash TEXT PRIMARY KEY, live INTEGER NOT NULL, created INTEGER NOT NULL)');
db.exec('DELETE FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)');
const liveAllowed = (user) => user.plan === 'pro' || !!env.LIVE_FREE;
// En una sesión en vivo, el rechazo por revisión dice además quién hizo el guardado que quedó (su número dentro
// de la sesión, nunca un correo): así al otro se le puede avisar con nombre.
function liveWrite(owner, p, text, rev) {
  try { return writeNote(owner, p, text, rev); }
  catch (e) {
    if (e instanceof Fail && e.code === 'rev_conflict') { const row = liveRow(owner.id, p); const last = row && memOf(row).last; if (last && last.rev === e.extra.rev) e.extra.pid = last.pid; }
    throw e;
  }
}
const liveMem = new Map(); // id de la sesión → { guests: Map(id → invitado), owner: { block, editing, timer }, seq, tick }
const passes = new Map(); // hash del pase → { live, gid }
const memOf = (row) => { let m = liveMem.get(row.id); if (!m) { m = { guests: new Map(), owner: { block: null, editing: false, timer: null }, seq: 0, tick: null }; liveMem.set(row.id, m); } return m; };
const liveRoom = (row) => rooms.get(roomKey(row.owner, row.path)) || new Set();
const liveMembers = (row) => Array.from(liveRoom(row)).filter((c) => (c.gid ? c.live === row.id : c.uid === row.owner));
// Tope de ritmo liviano, por ventana fija: para lo que llega muchas veces por segundo (presencia, guardados de invitados).
const windows = new Map();
function rate(key, max, span, code) {
  const t = now(); let w = windows.get(key);
  if (!w || t - w.t >= span) { w = { t, n: 0 }; windows.set(key, w); }
  if (w.n >= max) throw new Fail(429, code, '', { retry_after: Math.max(1, Math.ceil((span - (t - w.t)) / 1000)) });
  w.n++;
}
// El nombre visible: una línea, sin caracteres de control ni marcas que den vuelta el texto, hasta 40 caracteres.
// No se le saca nada más: quien lo muestra lo pone como texto, nunca como HTML.
function cleanName(v) {
  const name = (typeof v === 'string' ? v : '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!name) throw new Fail(400, 'bad_name');
  return name;
}
// Dos personas de la misma sesión no llevan el mismo nombre: al segundo se le suma un número.
function freeName(name, taken) {
  const has = (n) => taken.some((t) => t.toLowerCase() === n.toLowerCase());
  if (!has(name)) return name;
  for (let i = 2; ; i++) { const n = name.slice(0, 36) + ' ' + i; if (!has(n)) return n; }
}
function livePeople(row) {
  const m = memOf(row); const room = liveRoom(row);
  const here = Array.from(room).some((c) => c.uid === row.owner);
  const out = [{ id: 'o', name: row.name, color: 0, block: here ? m.owner.block : null, editing: here && m.owner.editing, here }];
  for (const g of m.guests.values()) out.push({ id: 'g' + g.id, name: g.name, color: g.color, block: g.conns ? g.block : null, editing: !!g.conns && g.editing, here: g.conns > 0 });
  return out;
}
const liveView = (row) => ({ open: true, name: row.name, created: row.created, max: LIVE_PEOPLE, people: livePeople(row) });
// Quiénes están y en qué bloque, a todos los de la sesión. Junta los cambios de un instante en un solo aviso.
function tellLive(row) {
  const m = memOf(row); if (m.tick) return;
  m.tick = setTimeout(() => {
    m.tick = null;
    if (!liveMem.has(row.id)) return;
    const ev = { type: 'live', open: true, people: livePeople(row) };
    for (const c of liveMembers(row)) push(c, ev);
  }, 120);
  m.tick.unref();
}
const liveTouch = (row) => { row.seen = now(); q('UPDATE lives SET seen = ? WHERE id = ?').run(row.seen, row.id); };
// forget: además pierde la contraseña de reingreso (lo sacaron, o salió por su cuenta). Sin eso, quien se quedó sin
// conexión un rato deja su lugar pero puede volver.
function dropGuest(row, g, why, forget) {
  const m = memOf(row);
  clearTimeout(g.timer); passes.delete(g.hash); m.guests.delete(g.id);
  if (forget && g.ticket) q('DELETE FROM live_tickets WHERE hash = ?').run(g.ticket);
  for (const c of Array.from(liveRoom(row))) if (c.gid === g.id && c.live === row.id) { push(c, { type: 'live', open: false, why }); c.res.end(); }
}
// Cierra la sesión: los pases dejan de servir en el acto y a cada conexión se le avisa por qué antes de cortarla.
function liveEnd(row, why) {
  q('DELETE FROM lives WHERE id = ?').run(row.id);
  q('DELETE FROM live_tickets WHERE live = ?').run(row.id);
  const m = liveMem.get(row.id);
  if (m) { clearTimeout(m.tick); clearTimeout(m.owner.timer); for (const g of Array.from(m.guests.values())) dropGuest(row, g, why); liveMem.delete(row.id); }
  for (const c of liveRoom(row)) if (c.uid === row.owner) push(c, { type: 'live', open: false, why });
}
const liveStale = (row) => !liveMembers(row).length && now() - row.seen > LIVE_IDLE_MS;
// La sesión abierta sobre esa nota, o nada. Una vencida se cierra acá mismo.
function liveRow(ownerId, p) {
  const row = q('SELECT * FROM lives WHERE owner = ? AND path = ?').get(ownerId, p);
  if (row && liveStale(row)) { liveEnd(row, 'expired'); return null; }
  return row || null;
}
// La nota dejó de estar donde estaba (se eliminó, cambió de nombre o quedó en una carpeta con contraseña).
function liveDrop(ownerId, p) { const row = q('SELECT * FROM lives WHERE owner = ? AND path = ?').get(ownerId, p); if (row) liveEnd(row, 'closed'); }
// ticket: en vez del secreto del enlace, la contraseña de reingreso de alguien que ya había entrado.
function liveBySecret(req, secret, ticket) {
  const ip = clientIp(req);
  limit('lbad:' + ip, 20, HOUR, 'too_many');
  const fits = (v) => typeof v === 'string' && v.length >= 20 && v.length <= 100;
  const row = fits(ticket) ? q('SELECT l.* FROM live_tickets t JOIN lives l ON l.id = t.live WHERE t.hash = ?').get(sha(ticket))
    : fits(secret) ? q('SELECT * FROM lives WHERE hash = ?').get(sha(secret)) : null;
  const owner = row && userById(row.owner);
  if (row && (liveStale(row) || !owner || !liveAllowed(owner))) liveEnd(row, liveStale(row) ? 'expired' : 'closed');
  else if (row) return { row, owner };
  // El mismo aviso para un secreto que nunca existió y para una sesión que ya terminó. Veinte fallos por hora por red.
  mark('lbad:' + ip);
  throw new Fail(404, 'live_gone');
}
const noteName = (p) => p.split('/').pop();

function liveOpen(user, body) {
  if (!liveAllowed(user)) throw new Fail(402, 'live_needs_plan');
  const p = cleanPath(body.path); const name = cleanName(body.name);
  const n = q('SELECT v FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  if (!n) throw new Fail(404, 'not_found');
  // El servidor aplica y reparte los cambios: una nota cifrada desde el navegador no la puede leer.
  if (n.v || vaultOf(user.id, p)) throw new Fail(409, 'live_vault', 'A note in a folder protected with a password cannot be edited live');
  let row = liveRow(user.id, p);
  if (row) {
    // Ya estaba abierta: el enlace no se vuelve a dar (solo se guarda su hash). Para uno nuevo está /live/rotate.
    const taken = Array.from(memOf(row).guests.values()).map((g) => g.name);
    row.name = freeName(name, taken); q('UPDATE lives SET name = ? WHERE id = ?').run(row.name, row.id);
    tellLive(row);
    return liveView(row);
  }
  if (q('SELECT COUNT(*) AS n FROM lives WHERE owner = ?').get(user.id).n >= MAX_LIVES) throw new Fail(429, 'too_many');
  const secret = random(32);
  q('INSERT INTO lives (hash, owner, path, name, created, seen) VALUES (?, ?, ?, ?, ?, ?)').run(sha(secret), user.id, p, name, now(), now());
  row = q('SELECT * FROM lives WHERE owner = ? AND path = ?').get(user.id, p);
  tellLive(row);
  return Object.assign(liveView(row), { secret });
}
function liveRotate(row) {
  const secret = random(32);
  q('UPDATE lives SET hash = ? WHERE id = ?').run(sha(secret), row.id);
  return secret;
}
function liveKick(row, id) {
  const g = memOf(row).guests.get(+String(id || '').replace(/^g/, ''));
  if (!g) throw new Fail(404, 'not_found');
  dropGuest(row, g, 'kicked', true);
  const secret = liveRotate(row);
  tellLive(row);
  return Object.assign(liveView(row), { secret });
}
// Lo que se ve antes de entrar: de quién es la sesión, el nombre de la nota y si hay lugar.
function liveLook(req, body) {
  const { row } = liveBySecret(req, body.secret);
  const m = memOf(row);
  return { by: row.name, note: noteName(row.path), people: livePeople(row).filter((x) => x.here).length, full: m.guests.size + 1 >= LIVE_PEOPLE };
}
function liveJoin(req, body) {
  rate('ljoin:' + clientIp(req), 60, HOUR, 'too_many');
  const back = typeof body.ticket === 'string' ? body.ticket : null;
  const { row, owner } = liveBySecret(req, body.secret, back);
  const name = cleanName(body.name);
  let n;
  try { n = readNote(owner, row.path); } catch (e) { liveEnd(row, 'closed'); throw new Fail(404, 'live_gone'); }
  const m = memOf(row);
  // Quien vuelve con su contraseña de reingreso ocupa el lugar que ya tenía, si todavía figura.
  if (back) for (const g of Array.from(m.guests.values())) if (g.ticket === sha(back)) dropGuest(row, g, 'left');
  // Los que se fueron sin avisar le dejan el lugar a quien entra.
  for (const g of Array.from(m.guests.values())) if (!g.conns && now() - g.at > LIVE_GUEST_MS) dropGuest(row, g, 'left');
  if (m.guests.size + 1 >= LIVE_PEOPLE) throw new Fail(429, 'live_full');
  const used = new Set(Array.from(m.guests.values()).map((g) => g.color));
  let color = 1; while (used.has(color) && color < LIVE_COLORS - 1) color++;
  const pass = 'mdl_' + random(32); const id = ++m.seq;
  const ticket = back || 'mdk_' + random(32);
  if (!back) {
    q('INSERT INTO live_tickets (hash, live, created) VALUES (?, ?, ?)').run(sha(ticket), row.id, now());
    // Tope por sesión: pasadas las 300, se van las más viejas.
    q('DELETE FROM live_tickets WHERE live = ? AND hash NOT IN (SELECT hash FROM live_tickets WHERE live = ? ORDER BY created DESC LIMIT 300)').run(row.id, row.id);
  }
  const g = { id, hash: sha(pass), ticket: sha(ticket), name: freeName(name, [row.name].concat(Array.from(m.guests.values()).map((x) => x.name))), color, block: null, editing: false, timer: null, conns: 0, at: now() };
  m.guests.set(id, g); passes.set(g.hash, { live: row.id, gid: id });
  liveTouch(row); tellLive(row);
  // Hacia afuera va el nombre de la nota, no en qué carpetas la guarda su dueño. Tampoco el correo de nadie.
  return Object.assign({ pass, you: 'g' + id, name: g.name, color: g.color, by: row.name, max: LIVE_PEOPLE, note: { name: noteName(row.path), text: n.text, rev: n.rev, updated: n.updated }, people: livePeople(row) }, back ? {} : { ticket });
}
// De quién es el pase. Con la sesión cerrada, el invitado sacado o el pase inventado, la respuesta es la misma.
function guestFrom(req) {
  const m = /^Bearer\s+(mdl_\S+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new Fail(401, 'no_auth');
  const hit = passes.get(sha(m[1]));
  const row = hit && q('SELECT * FROM lives WHERE id = ?').get(hit.live);
  const g = row && memOf(row).guests.get(hit.gid);
  const owner = g && userById(row.owner);
  if (!owner) throw new Fail(401, 'bad_auth');
  if (!liveAllowed(owner)) { liveEnd(row, 'closed'); throw new Fail(401, 'bad_auth'); }
  g.at = now();
  return { row, g, owner };
}
// En qué bloque está alguien y si está escribiendo ahí. who es el registro de quien avisa (el de quien abrió la
// sesión o el de un invitado): nadie puede hablar por otro, ni cambiarle el nombre o el color.
function livePresence(row, who, pid, body) {
  rate('lpres:' + row.id + ':' + pid, 40, 10000, 'presence_rate');
  const block = body.block == null ? null : body.block;
  if (block != null && (typeof block !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(block))) throw new Fail(400, 'bad_block');
  let editing = block != null && body.editing === true; let held = '';
  // Dos no escriben en el mismo bloque: el segundo que lo pide se entera de quién lo tiene.
  if (editing) held = (livePeople(row).find((x) => x.id !== pid && x.editing && x.block === block) || {}).id || '';
  if (held) editing = false;
  who.block = block; who.editing = editing;
  clearTimeout(who.timer); who.timer = null;
  if (editing) { who.timer = setTimeout(() => { who.editing = false; who.timer = null; tellLive(row); }, LIVE_EDIT_MS); who.timer.unref(); }
  tellLive(row);
  return held ? { ok: true, held } : { ok: true };
}
// Las rutas de un invitado. Lo que no está acá, un pase no lo alcanza.
async function liveGuest(req, p, m) {
  const { row, g, owner } = guestFrom(req);
  if (p === '/live/note' && m === 'GET') { const n = readNote(owner, row.path); return { name: noteName(row.path), text: n.text, rev: n.rev, updated: n.updated }; }
  if (p === '/live/note' && m === 'PUT') {
    rate('lsave:' + g.hash, 300, 60000, 'too_many');
    const body = await readBody(req); const rev = cleanRev(body.rev);
    // Un invitado guarda siempre sobre una revisión: nunca pisa a ciegas.
    if (rev == null) throw new Fail(400, 'rev_required');
    const text = String(body.text == null ? '' : body.text);
    const saved = liveWrite(owner, row.path, text, rev);
    tellSaved(owner.id, row.path, saved, { by: 'guest', pid: 'g' + g.id }, text);
    return { updated: saved.updated, size: saved.size, rev: saved.rev };
  }
  if (p === '/live/presence' && m === 'POST') return livePresence(row, g, 'g' + g.id, await readBody(req));
  if (p === '/live/leave' && m === 'POST') { dropGuest(row, g, 'left', true); tellLive(row); return { ok: true }; }
  throw new Fail(404, 'no_route');
}
function listenGuest(req, res) {
  const { row, g } = guestFrom(req);
  const ip = 'ip:' + clientIp(req);
  if (g.conns >= LIVE_PER_GUEST || (live.get(ip) || 0) >= LIVE_PER_IP) throw new Fail(429, 'too_many');
  liveAdd(ip, 1); g.conns++;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.on('error', () => { /* la conexión se cortó: de limpiar se ocupa close */ });
  const key = roomKey(row.owner, row.path);
  const client = { res, gid: g.id, live: row.id };
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(client);
  push(client, { type: 'live', open: true, people: livePeople(row) });
  tellLive(row);
  const beat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 25000);
  req.on('close', () => {
    clearInterval(beat); liveAdd(ip, -1);
    const room = rooms.get(key); if (room) { room.delete(client); if (!room.size) rooms.delete(key); }
    g.conns = Math.max(0, g.conns - 1); g.at = now();
    if (!g.conns) { g.editing = false; clearTimeout(g.timer); g.timer = null; }
    const still = q('SELECT * FROM lives WHERE id = ?').get(row.id);
    if (still && liveMem.has(still.id)) { liveTouch(still); tellLive(still); }
  });
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
  { name: 'move_note', description: 'Move or rename a note. Its history, comments, shares and public links follow it. Fails if a note already exists at the new path.', inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'Current path' }, to: { type: 'string', description: 'New path, for example archive/2025/plan.md' } }, required: ['from', 'to'] } },
  { name: 'note_history', description: 'List the earlier versions kept for a note, newest first. Pass version to read the text of one of them.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, version: { type: 'number', description: 'Optional: id of the version to read' } }, required: ['path'] } },
  // Las que sacan notas hacia afuera: existen solo para un token creado con el permiso de compartir.
  { share: true, name: 'list_shares', description: 'List who the notes are shared with and which public links exist. Pass a path to see only that note or folder.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional note or folder' } } } },
  { share: true, name: 'share_note', description: 'Share a note, or a whole folder, with another SharpMD account by its email address. Only do this when the person asks for it. They open it after signing in to SharpMD with that address.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of a note, or of a folder to share everything inside it' }, email: { type: 'string' }, role: { type: 'string', enum: ['view', 'edit'], description: 'view (default) or edit' } }, required: ['path', 'email'] } },
  { share: true, name: 'unshare_note', description: 'Stop sharing a note or folder with an email address.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, email: { type: 'string' } }, required: ['path', 'email'] } },
  { share: true, name: 'create_public_link', description: 'Create a read-only public link to a note and return its URL. Anyone with the URL can read the note, so only do this when the person asks for it. Pass a password to protect it. The URL is only returned once.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, password: { type: 'string', description: 'Optional password the reader must type' } }, required: ['path'] } },
  { share: true, name: 'revoke_public_link', description: 'Revoke public links: one by its id, or every link to a note by its path.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, path: { type: 'string' } } } },
];
const toolsFor = (user) => TOOLS.filter((t) => !t.share || user.canShare).map(({ share, ...t }) => t);
const SHARE_TOOLS = new Set(TOOLS.filter((t) => t.share).map((t) => t.name));
const NO_SHARE = 'This token cannot share notes or create public links. Ask the person to do it from the SharpMD app, or to create a token with that permission in Settings > AI.';

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
  // El espacio del equipo, si la cuenta está en uno: sus notas figuran bajo @team/ y se leen y escriben como las
  // demás. El alcance del token se mira sobre la ruta entera, con @team/ incluido: un token limitado a una carpeta
  // propia no ve el equipo, y uno limitado a @team o a @team/algo ve solo eso.
  const space = user.team ? userById(user.team.space) : null;
  const teamPath = (p) => !!space && (p === TEAM_PRE.slice(0, -1) || p.startsWith(TEAM_PRE));
  // at: de quién es la nota de esa ruta y cómo se llama ahí. full es la ruta como la ve la IA.
  const at = (raw) => { const full = scoped(user, raw); return teamPath(full) && full.length > TEAM_PRE.length ? { who: space, p: cleanPath(full.slice(TEAM_PRE.length)), full } : { who: user, p: full, full }; };
  const tag = (p) => { if (teamPath(p)) return { team: true }; const v = vaults.find((x) => p === x.folder || inside(p, x.folder)); return v ? { protected: true, locked: !aiReach(user, v) } : {}; };
  const mine = () => listNotes(user).filter((n) => !teamPath(n.path)).concat(space ? listNotes(space).map((n) => ({ path: TEAM_PRE + n.path, updated: n.updated, size: n.size })) : [])
    .filter((n) => within(user, n.path)).sort((a, b) => b.updated - a.updated);
  if (name === 'list_notes') return mine().filter((n) => inFolder(n.path, args.folder && cleanPath(args.folder))).map((n) => Object.assign({ path: n.path, updated: new Date(n.updated).toISOString(), size: n.size }, tag(n.path)));
  if (name === 'list_folders') {
    const count = new Map();
    for (const n of mine()) { const parts = n.path.split('/'); for (let i = 1; i < parts.length; i++) { const f = parts.slice(0, i).join('/'); count.set(f, (count.get(f) || 0) + 1); } }
    // Una carpeta con contraseña figura aunque esté vacía.
    for (const v of vaults) if (within(user, v.folder) && !count.has(v.folder)) count.set(v.folder, 0);
    // La del equipo también, para que la IA sepa que existe.
    if (space && within(user, TEAM_PRE.slice(0, -1)) && !count.has(TEAM_PRE.slice(0, -1))) count.set(TEAM_PRE.slice(0, -1), 0);
    return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, notes]) => Object.assign({ folder, notes }, tag(folder)));
  }
  // Dentro de una carpeta desbloqueada para la IA se lee descifrando y se escribe cifrando, con el mismo formato
  // que usa el navegador. Una nota que el navegador todavía no cifró no se entrega.
  const read = (a, key) => {
    const n = readNote(a.who, a.p);
    if (!key) return n.text;
    if (!n.text.startsWith(VAULT)) throw new Fail(423, 'vault_locked', 'This note is still being encrypted by SharpMD. Try again in a moment.');
    return vaultOpen(key, a.p, n.text);
  };
  // En el espacio del equipo no hay carpetas con contraseña.
  const gate = (a) => (a.who === user ? vaultGate(user, a.p) : null);
  // La IA guarda sobre la revisión que hay en ese momento: lee y escribe sin soltar el hilo, así que no pisa un
  // guardado que entró en el medio ni se cruza con otro. Quien tiene la nota abierta se entera al instante.
  const revOf = (a) => { const now_ = q('SELECT rev FROM notes WHERE user = ? AND path = ?').get(a.who.id, a.p); return now_ ? now_.rev : null; };
  const write = (a, key, text, base) => {
    text = String(text == null ? '' : text);
    if (key && Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large');
    const saved = writeNote(a.who, a.p, key ? vaultSeal(key, a.p, text) : text, base === undefined ? revOf(a) : base);
    tellSaved(a.who.id, a.p, saved, { by: 'mcp' }, text);
    return saved;
  };
  // La dirección para abrir esa nota en la app, con el mismo formato que usa la app al navegar.
  const appLink = (f) => APP_URL + '?f=' + encodeURIComponent(f);
  const openUrl = (a) => appLink('cloud/' + (a.who === user ? '' : '~' + a.who.id + '/') + a.p.split('/').map(encodeURIComponent).join('/'));
  if (name === 'read_note') { const a = at(args.path); return read(a, gate(a)); }
  if (name === 'write_note') { const a = at(args.path); write(a, gate(a), args.text); return 'Saved ' + a.full + ' (' + String(args.text == null ? '' : args.text).length + ' characters). Open it: ' + openUrl(a); }
  if (name === 'append_note') {
    // Lo que se lee y lo que se escribe son de la misma revisión: si no coincidiera, no se agrega sobre un texto viejo.
    const a = at(args.path); const key = gate(a); let prev = ''; const base = revOf(a);
    try { prev = read(a, key); } catch (e) { if (e.code !== 'not_found') throw e; }
    write(a, key, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + (prev ? '\n' : '') + String(args.text || ''), base);
    return 'Appended to ' + a.full + '. Open it: ' + openUrl(a);
  }
  if (name === 'search_notes') {
    const results = searchNotes(user, args.query, (v) => aiReach(user, v)).filter((r) => !teamPath(r.path))
      .concat(space ? searchNotes(space, args.query).map((r) => Object.assign(r, { path: TEAM_PRE + r.path })) : []).filter((r) => within(user, r.path)).slice(0, 30);
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
  if (name === 'move_note') {
    const a = at(args.from); const b = at(args.to);
    if (a.who !== b.who) throw new Fail(409, 'other_space', 'A note cannot be moved between your own notes and the team space. Write it in the new place instead.');
    // Mover hacia, desde o dentro de una carpeta con contraseña pide volver a cifrar el texto: eso lo hace la app.
    if (a.who === user && (vaultOf(user.id, a.p) || vaultOf(user.id, b.p))) throw new Fail(409, 'vault', 'Notes in a folder protected with a password can only be moved from the SharpMD app.');
    try { renameNote(a.who, a.p, b.p); } catch (e) { if (e.code === 'exists') throw new Fail(409, 'exists', 'There is already a note at ' + b.full + '.'); throw e; }
    return 'Moved ' + a.full + ' to ' + b.full + '. Open it: ' + openUrl(b);
  }
  if (name === 'note_history') {
    const a = at(args.path);
    // El historial de una carpeta con contraseña está cifrado desde el navegador: no se entrega.
    if (a.who === user && vaultOf(user.id, a.p)) throw new Fail(409, 'vault', 'The history of a note in a folder protected with a password can only be read from the SharpMD app.');
    if (args.version == null) return q('SELECT id, saved, size FROM versions WHERE user = ? AND path = ? AND aad IS NULL ORDER BY saved DESC LIMIT 100').all(a.who.id, a.p).map((v) => ({ version: v.id, saved: new Date(v.saved).toISOString(), size: v.size }));
    // La versión tiene que ser de esa nota: el alcance del token se miró sobre la ruta.
    const v = q('SELECT text, e FROM versions WHERE id = ? AND user = ? AND path = ? AND aad IS NULL').get(+args.version, a.who.id, a.p);
    if (!v) throw new Fail(404, 'not_found');
    return unseal(v.text, v.e, 'versions.text');
  }
  if (SHARE_TOOLS.has(name)) {
    if (!user.canShare) throw new Fail(403, 'no_share_permission', NO_SHARE);
    // Solo lo propio y dentro del alcance del token. Lo del equipo no se comparte hacia afuera (la app tampoco lo
    // ofrece), y lo que está en una carpeta con contraseña lo rechazan addShare y addLink.
    const own = (raw) => { const a = at(raw); if (teamPath(a.full)) throw new Fail(403, 'team', 'Team notes are open to every member of the team and cannot be shared or linked from here.'); return a.p; };
    if (name === 'list_shares') {
      const all = sharesOf(user, args.path ? own(args.path) : '');
      return { people: all.people.filter((s) => within(user, s.path)).map((s) => ({ path: s.path, kind: s.kind, email: s.email, role: s.role })), links: all.links.filter((l) => within(user, l.path)).map((l) => ({ id: l.id, path: l.path, protected: !!l.protected, created: new Date(l.created).toISOString() })) };
    }
    if (name === 'share_note') {
      const p = own(args.path);
      // Una nota si existe con esa ruta; si no, la carpeta que tenga notas adentro.
      const kind = q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p) ? 'note' : listNotes(user).some((n) => inside(n.path, p)) ? 'folder' : '';
      if (!kind) throw new Fail(404, 'not_found', 'There is no note or folder at ' + p + '.');
      const role = args.role === 'edit' ? 'edit' : 'view';
      addShare(user, { path: p, email: args.email, kind, role });
      return 'Shared the ' + kind + ' ' + p + ' with ' + cleanEmail(args.email) + ' (' + (role === 'edit' ? 'can edit' : 'can view') + '). They see it in SharpMD after signing in with that address.';
    }
    if (name === 'unshare_note') {
      const p = own(args.path); const email = cleanEmail(args.email);
      if (!q('DELETE FROM shares WHERE owner = ? AND path = ? AND email = ?').run(user.id, p, email).changes) throw new Fail(404, 'not_found', p + ' is not shared with ' + email + '.');
      return 'Stopped sharing ' + p + ' with ' + email + '.';
    }
    if (name === 'create_public_link') {
      const p = own(args.path); const made = addLink(user, { path: p, password: args.password == null || args.password === '' ? null : String(args.password) });
      return { path: p, url: appLink('pub/' + made.token), id: made.id, protected: made.protected, note: 'Anyone with this URL can read the note' + (made.protected ? ' after typing the password.' : '.') + ' The URL is not shown again.' };
    }
    // revoke_public_link: uno por id, o todos los de una nota.
    const of = args.id == null ? own(args.path) : '';
    const hit = q('SELECT id, path FROM links WHERE owner = ?').all(user.id).filter((l) => within(user, l.path) && (args.id == null ? l.path === of : l.id === +args.id));
    if (!hit.length) throw new Fail(404, 'not_found', 'There is no public link there.');
    for (const l of hit) q('DELETE FROM links WHERE id = ? AND owner = ?').run(l.id, user.id);
    return 'Revoked ' + hit.length + ' public link' + (hit.length === 1 ? '' : 's') + ' to ' + hit[0].path + '.';
  }
  throw new Fail(400, 'unknown_tool');
}

function mcp(user, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'sharpmd', version: '1.0.0' },
    instructions: 'Notes are Markdown files in the user\'s SharpMD cloud folder. Paths look like folder/name.md, and a top-level folder is usually a project. The user can leave comments for you on a note: call list_comments, make each change with write_note, then resolve_comment. A folder marked as protected and locked is encrypted with a password: you cannot read it until the person unlocks it for the AI from SharpMD. If the person belongs to a team, the notes the team shares are under @team/ and every member can read and edit them. write_note, append_note and move_note return a link that opens the note in the SharpMD app: give it to the person. ' + (user.canShare ? 'This token can share notes with other accounts and create public links: only do that when the person asks.' : 'This token cannot share notes or create public links: the person does that from the SharpMD app.') + (user.scope ? ' This token only reaches the folder ' + user.scope + '/.' : '') });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools: toolsFor(user) });
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

// ---------- Equipos ----------
// Un equipo es de quien lo paga: esa cuenta lo administra (invita, saca gente, cambia la cantidad de lugares) y
// ocupa uno de los lugares. Los demás entran con su cuenta de siempre, aceptando una invitación que llega al
// correo con el que entran. Mientras el equipo está al día, sus miembros tienen el plan pago; al salir, o si el
// cobro se cae, cada uno vuelve a su plan propio y conserva sus notas.
//   - Una cuenta está en un solo equipo a la vez.
//   - El espacio del equipo: sus notas no son de ninguna persona. Se guardan a nombre de una cuenta interna del
//     equipo (su correo es team:..., que no es un correo: nadie puede entrar con ella ni compartirle nada), así
//     que tienen revisión, historial, avisos en vivo y cifrado en reposo como cualquier otra nota. Los miembros
//     las piden con o = el número de esa cuenta, igual que lo compartido entre cuentas.
//   - Con el cobro caído no se borra nada: las notas del equipo se siguen leyendo y editando, pero no se crean
//     nuevas pasado el tope gratis y no se guarda historial. Es la misma regla de quien baja del plan pago.
//   - En el espacio del equipo no hay carpetas con contraseña, enlaces públicos, compartir hacia afuera ni
//     sesiones en vivo: esas rutas trabajan sobre las notas propias de quien llama.
//   - Lugares: los miembros más las invitaciones pendientes nunca superan los lugares pagos.
const TEAM_BASE = String(env.PADDLE_TEAM_BASE || '').trim(); const TEAM_SEAT = String(env.PADDLE_TEAM_SEAT || '').trim();
const PADDLE_API = String(env.PADDLE_API_URL || 'https://api.paddle.com').replace(/\/+$/, '');
// El plan de equipo se ofrece solo con todo lo que hace falta para cobrarlo y para cambiar los lugares.
const TEAM_BILLING = !!(env.PADDLE_WEBHOOK_SECRET && TEAM_BASE && TEAM_SEAT && env.PADDLE_API_KEY);
const TEAM_INCLUDED = 2; // personas que cubre el precio base
const TEAM_MAX_SEATS = Math.max(TEAM_INCLUDED, +(env.TEAM_MAX_SEATS || 50));
const TEAM_INVITES_DAY = +(env.TEAM_INVITES_DAY || 20); // invitaciones que un equipo manda por día
const TEAM_PRE = '@team/'; // bajo qué carpeta ve la IA las notas del equipo
const APP_URL = String(env.APP_URL || 'https://sharpmd.app/src/app.html');
db.exec("CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, owner INTEGER UNIQUE NOT NULL, space INTEGER UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', seats INTEGER NOT NULL, sub TEXT, status TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL)");
db.exec('CREATE TABLE IF NOT EXISTS team_members (team INTEGER NOT NULL, user INTEGER PRIMARY KEY, joined INTEGER NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS team_invites (id INTEGER PRIMARY KEY, team INTEGER NOT NULL, email TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (team, email))');
// kind: 'solo' la suscripción individual, 'team' la de un equipo. Se decide la primera vez que se ve la suscripción.
try { db.exec("ALTER TABLE paddle_subs ADD COLUMN kind TEXT NOT NULL DEFAULT 'solo'"); } catch (e) { /* ya estaba */ }

const teamOf = (userId) => q('SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team WHERE m.user = ?').get(userId) || null;
// La cuenta tal como la usa el resto del servidor: plan es el que vale ahora (pago si lo paga ella o si está en un
// equipo al día), own el que paga por su lado y team su equipo. Toda cuenta que se lee para decidir algo sale de acá.
function userById(id) {
  const u = q('SELECT * FROM users WHERE id = ?').get(id); if (!u) return u;
  u.own = u.plan; u.team = teamOf(u.id);
  if (u.team && u.team.status === 'active') u.plan = 'pro';
  return u;
}
const withEmail = (link, user) => (link ? link + (link.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(user.email) : '');
// Lugares ocupados: los miembros y las invitaciones que todavía nadie respondió.
const teamUsed = (t) => q('SELECT COUNT(*) AS n FROM team_members WHERE team = ?').get(t.id).n + q('SELECT COUNT(*) AS n FROM team_invites WHERE team = ?').get(t.id).n;
// Lo que la app sabe del equipo. Un miembro ve quiénes están (sus correos, nada más de nadie); las invitaciones
// pendientes y el cobro, solo quien administra. invites son las invitaciones que esperan a esta cuenta.
function teamView(user) {
  const t = user.team || null;
  const invites = q("SELECT i.id, t.name, u.email AS by FROM team_invites i JOIN teams t ON t.id = i.team JOIN users u ON u.id = t.owner WHERE i.email = ? AND t.status = 'active' ORDER BY i.created").all(user.email);
  const out = { enabled: TEAM_BILLING, checkout: TEAM_BILLING ? withEmail(env.CHECKOUT_TEAM, user) : '', included: TEAM_INCLUDED, max: TEAM_MAX_SEATS, mine: null, invites };
  if (!t) return out;
  const admin = t.owner === user.id;
  const members = q('SELECT u.id, u.email FROM team_members m JOIN users u ON u.id = m.user WHERE m.team = ? ORDER BY m.joined, u.id').all(t.id).map((x) => ({ id: x.id, email: x.email, admin: x.id === t.owner }));
  // solo: además paga un plan individual por su lado. La app le avisa que sigue activo y cómo darlo de baja.
  out.mine = { id: t.id, name: t.name, role: admin ? 'admin' : 'member', active: t.status === 'active', space: t.space, seats: t.seats, used: teamUsed(t), members, solo: user.own === 'pro' };
  if (admin) { out.mine.pending = q('SELECT id, email, created FROM team_invites WHERE team = ? ORDER BY created').all(t.id); out.mine.billing = TEAM_BILLING && !!t.sub; }
  return out;
}
// Quien deja de ser miembro deja de escuchar las notas del equipo en el acto.
function teamCut(spaceId, userId) {
  for (const [key, room] of rooms) if (key.startsWith(spaceId + ':')) for (const c of Array.from(room)) if (c.uid === userId) c.res.end();
}
// Crea el equipo de esa cuenta o lo vuelve a poner al día, con esa cantidad de lugares. sub es la suscripción que
// lo paga, si hay una. Quien ya es miembro de otro equipo no sale de ahí porque llegue un pago a su nombre (lo
// pudo hacer cualquiera): no se crea nada y devuelve null. Su equipo nace cuando sale del otro.
function teamOpen(user, seats, sub) {
  seats = Math.max(TEAM_INCLUDED, Math.min(TEAM_MAX_SEATS, seats));
  const t = q('SELECT * FROM teams WHERE owner = ?').get(user.id);
  if (!t && teamOf(user.id)) return null;
  db.exec('BEGIN');
  try {
    if (t) {
      q("UPDATE teams SET seats = ?, sub = COALESCE(?, sub), status = 'active' WHERE id = ?").run(seats, sub || null, t.id);
      q("UPDATE users SET plan = 'pro' WHERE id = ?").run(t.space);
    } else {
      const space = Number(q("INSERT INTO users (email, plan, created) VALUES (?, 'pro', ?)").run('team:' + random(12), now()).lastInsertRowid);
      const id = Number(q("INSERT INTO teams (owner, space, seats, sub, status, created) VALUES (?, ?, ?, ?, 'active', ?)").run(user.id, space, seats, sub || null, now()).lastInsertRowid);
      q('INSERT INTO team_members (team, user, joined) VALUES (?, ?, ?)').run(id, user.id, now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return q('SELECT * FROM teams WHERE owner = ?').get(user.id);
}
// El cobro se cayó: el equipo queda, con su gente y sus notas, pero ya no da el plan pago.
function teamShut(t) {
  q("UPDATE teams SET status = 'ended' WHERE id = ?").run(t.id);
  q("UPDATE users SET plan = 'free' WHERE id = ?").run(t.space);
}
// Un aviso de Paddle sobre la suscripción de un equipo. Los lugares salen de la suscripción: los que cubre el
// precio base más la cantidad del precio por lugar adicional.
function teamBilled(user, sub, active, items) {
  if (active) {
    const extra = items.find((i) => i.price.id === TEAM_SEAT);
    const t = teamOpen(user, TEAM_INCLUDED + Math.max(0, Math.floor(+(extra && extra.quantity) || 0)), sub);
    if (!t) { console.error('paddle: suscripción de equipo para una cuenta que ya está en otro equipo · ' + sub.slice(0, 60)); return { ignored: 'in_team' }; }
    return { team: t.id, seats: t.seats };
  }
  const t = q('SELECT * FROM teams WHERE owner = ?').get(user.id);
  if (!t || t.sub !== sub) return { ignored: 'team' };
  // Si la cuenta tiene otra suscripción de equipo activa, el equipo sigue con esa.
  const other = q("SELECT id FROM paddle_subs WHERE user = ? AND kind = 'team' AND status = 'active' ORDER BY at DESC LIMIT 1").get(user.id);
  if (other) { q('UPDATE teams SET sub = ? WHERE id = ?').run(other.id, t.id); return { team: t.id }; }
  teamShut(t);
  return { team: t.id, ended: true };
}

function adminTeam(user) {
  const t = user.team;
  if (!t) throw new Fail(404, 'no_team');
  if (t.owner !== user.id) throw new Fail(403, 'not_admin');
  return t;
}
// El correo de la invitación, con el mismo aspecto que el del código. Es el mismo tenga o no cuenta quien lo
// recibe: dice quién invita y que se entra con ese correo. Lo que escribe una persona (el nombre del equipo) va escapado.
const html = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const INVITE = {
  en: { subject: (by) => by + ' invited you to a team on SharpMD', lead: (by, team) => '<b>' + by + '</b> invited you to ' + (team ? 'the team <b>' + team + '</b>' : 'their team') + ' on SharpMD.', go: 'Open SharpMD',
    note: 'Sign in with this email address and you will see the invitation, to accept or decline. If you do not know who sent it, you can ignore this email.',
    text: (by, team) => by + ' invited you to ' + (team ? 'the team "' + team + '"' : 'their team') + ' on SharpMD.\n\nOpen ' + APP_URL + ' and sign in with this email address: you will see the invitation, to accept or decline.\n\nIf you do not know who sent it, you can ignore this email.' },
  es: { subject: (by) => by + ' te invitó a un equipo en SharpMD', lead: (by, team) => '<b>' + by + '</b> te invitó ' + (team ? 'al equipo <b>' + team + '</b>' : 'a su equipo') + ' en SharpMD.', go: 'Abrir SharpMD',
    note: 'Entrá con este correo y vas a ver la invitación, para aceptarla o rechazarla. Si no sabés quién la mandó, podés ignorar este correo.',
    text: (by, team) => by + ' te invitó ' + (team ? 'al equipo "' + team + '"' : 'a su equipo') + ' en SharpMD.\n\nAbrí ' + APP_URL + ' y entrá con este correo: vas a ver la invitación, para aceptarla o rechazarla.\n\nSi no sabés quién la mandó, podés ignorar este correo.' },
};
const inviteHtml = (m, by, team) => '<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2026">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;background:#ffffff;border:1px solid #dedbd2;border-radius:14px">' +
  '<tr><td style="padding:28px 32px 8px;font-size:17px;font-weight:700;letter-spacing:-0.01em"><span style="color:#4d7c0f">#</span> SharpMD</td></tr>' +
  '<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.5;color:#1d2026;overflow-wrap:anywhere">' + m.lead(html(by), html(team)) + '</td></tr>' +
  '<tr><td style="padding:18px 32px 6px"><a href="' + html(APP_URL) + '" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#4d7c0f;color:#ffffff;font-size:15px;font-weight:650;text-decoration:none">' + m.go + '</a></td></tr>' +
  '<tr><td style="padding:12px 32px 28px;font-size:13.5px;line-height:1.5;color:#8a909c">' + m.note + '</td></tr>' +
  '</table><div style="padding-top:14px;font-size:12px;color:#8a909c">sharpmd.app</div></td></tr></table></body></html>';

// Mientras se cambia la cantidad de lugares en Paddle no entra nadie: si no, podría quedar más gente que lugares.
const seatBusy = new Set();
// Invitar manda un correo a una dirección cualquiera: tiene tope por equipo y por día, y otro por destinatario
// (tres por día, entre todos los equipos), para que no sirva para llenarle la casilla a nadie. La respuesta es la
// misma tenga o no cuenta esa dirección.
async function teamInvite(user, body) {
  const t = adminTeam(user);
  if (t.status !== 'active') throw new Fail(402, 'team_ended');
  if (seatBusy.has(t.id)) throw new Fail(409, 'team_busy');
  const email = cleanEmail(body.email);
  if (email === user.email) throw new Fail(400, 'own_email');
  if (q('SELECT 1 FROM team_members m JOIN users u ON u.id = m.user WHERE m.team = ? AND u.email = ?').get(t.id, email)) throw new Fail(409, 'already_member');
  const had = q('SELECT id FROM team_invites WHERE team = ? AND email = ?').get(t.id, email);
  if (!had && teamUsed(t) >= t.seats) throw new Fail(409, 'team_full');
  const day = 'tinv:team:' + t.id; const to = 'tinv:to:' + email;
  limit(day, TEAM_INVITES_DAY, DAY, 'invite_day'); limit(to, 3, DAY, 'invite_mail_day');
  mark(day); mark(to);
  if (!had) q('INSERT INTO team_invites (team, email, created) VALUES (?, ?, ?)').run(t.id, email, now());
  const m = INVITE[body.lang === 'es' ? 'es' : 'en'];
  // Sin correo configurado la invitación igual queda: aparece al entrar a la app con esa cuenta.
  try { await sendMail({ to: email, subject: m.subject(user.email), text: m.text(user.email, t.name), html: inviteHtml(m, user.email, t.name) }); }
  catch (e) { if (!had) q('DELETE FROM team_invites WHERE team = ? AND email = ?').run(t.id, email); throw e; }
  return { ok: true };
}
// Aceptar: la invitación es para el correo con el que se entró (ya comprobado con el código). Nadie queda sumado
// sin aceptar, y quien ya está en un equipo tiene que salir primero.
function teamAccept(user, id) {
  const inv = q('SELECT * FROM team_invites WHERE id = ? AND email = ?').get(+id, user.email);
  if (!inv) throw new Fail(404, 'not_found');
  const t = q('SELECT * FROM teams WHERE id = ?').get(inv.team);
  if (!t || t.status !== 'active') throw new Fail(409, 'team_ended');
  if (user.team) throw new Fail(409, 'in_team');
  if (seatBusy.has(t.id)) throw new Fail(409, 'team_busy');
  // La invitación ya ocupaba un lugar; solo falta si los lugares bajaron desde entonces.
  if (q('SELECT COUNT(*) AS n FROM team_members WHERE team = ?').get(t.id).n >= t.seats) throw new Fail(409, 'team_full');
  q('INSERT INTO team_members (team, user, joined) VALUES (?, ?, ?)').run(t.id, user.id, now());
  q('DELETE FROM team_invites WHERE id = ?').run(inv.id);
  return { ok: true };
}
// Sacar a alguien o salir: deja de ser miembro. Sus notas propias no se tocan y las del equipo quedan en el equipo.
function teamDrop(t, userId) {
  if (userId === t.owner) throw new Fail(409, 'owner_stays');
  const r = q('DELETE FROM team_members WHERE team = ? AND user = ?').run(t.id, userId);
  if (!r.changes) throw new Fail(404, 'not_found');
  teamCut(t.space, userId);
  // Si tenía paga una suscripción de equipo que esperaba a que saliera de este, su equipo nace ahora, con los lugares
  // que cubre el precio base. El próximo aviso de Paddle trae la cantidad real.
  const paid = q("SELECT id FROM paddle_subs WHERE user = ? AND kind = 'team' AND status = 'active' ORDER BY at DESC LIMIT 1").get(userId);
  if (paid) teamOpen({ id: userId }, TEAM_INCLUDED, paid.id);
  return { ok: true };
}
// Cambiar los lugares es cambiar la suscripción en Paddle, con prorrateo en el momento: un ítem con el precio base
// y, si hay más de los que cubre, otro con el precio por lugar y esa cantidad. Nunca menos que los ocupados.
async function teamSeats(user, body) {
  const t = adminTeam(user); const n = body.seats;
  if (!Number.isInteger(n) || n < TEAM_INCLUDED || n > TEAM_MAX_SEATS) throw new Fail(400, 'bad_seats');
  if (t.status !== 'active') throw new Fail(402, 'team_ended');
  if (!TEAM_BILLING || !t.sub) throw new Fail(409, 'no_billing');
  if (n < teamUsed(t)) throw new Fail(409, 'seats_in_use', '', { used: teamUsed(t) });
  if (n === t.seats) return { ok: true, seats: n };
  if (seatBusy.has(t.id)) throw new Fail(409, 'team_busy');
  limit('tseat:' + t.id, 10, HOUR, 'too_many'); mark('tseat:' + t.id);
  seatBusy.add(t.id);
  try {
    const items = [{ price_id: TEAM_BASE, quantity: 1 }].concat(n > TEAM_INCLUDED ? [{ price_id: TEAM_SEAT, quantity: n - TEAM_INCLUDED }] : []);
    let r = null;
    try { r = await fetch(PADDLE_API + '/subscriptions/' + encodeURIComponent(t.sub), { method: 'PATCH', headers: { authorization: 'Bearer ' + env.PADDLE_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ items, proration_billing_mode: 'prorated_immediately' }), signal: AbortSignal.timeout(15000) }); }
    catch (e) { r = null; }
    if (!r || !r.ok) { console.error('paddle: no se pudo cambiar la cantidad de lugares · ' + (r ? r.status : 'sin respuesta')); throw new Fail(502, 'billing_failed'); }
    q('UPDATE teams SET seats = ? WHERE id = ?').run(n, t.id);
  } finally { seatBusy.delete(t.id); }
  return { ok: true, seats: n };
}
// Las rutas del equipo. Cada una mira en el servidor si quien llama es miembro y con qué papel; después de un
// cambio vuelve el equipo como quedó.
async function teamRoute(user, p, m, req) {
  const after = (r) => Object.assign(r, { team: teamView(userById(user.id)) });
  if (p === '/team' && m === 'GET') return teamView(user);
  if (p === '/team' && m === 'PUT') {
    const t = adminTeam(user); const b = await readBody(req);
    q('UPDATE teams SET name = ? WHERE id = ?').run(String(b.name == null ? '' : b.name).trim() ? cleanName(b.name) : '', t.id);
    return after({ ok: true });
  }
  if (p === '/team/invite' && m === 'POST') return after(await teamInvite(user, await readBody(req)));
  if (p.startsWith('/team/invites/') && m === 'DELETE') { const t = adminTeam(user); q('DELETE FROM team_invites WHERE id = ? AND team = ?').run(+p.slice(14), t.id); return after({ ok: true }); }
  if (p === '/team/accept' && m === 'POST') return after(teamAccept(user, (await readBody(req)).id));
  if (p === '/team/decline' && m === 'POST') { q('DELETE FROM team_invites WHERE id = ? AND email = ?').run(+(await readBody(req)).id, user.email); return after({ ok: true }); }
  if (p === '/team/remove' && m === 'POST') { const t = adminTeam(user); return after(teamDrop(t, +(await readBody(req)).id)); }
  if (p === '/team/leave' && m === 'POST') { if (!user.team) throw new Fail(404, 'no_team'); return after(teamDrop(user.team, user.id)); }
  if (p === '/team/seats' && m === 'POST') return after(await teamSeats(user, await readBody(req)));
  throw new Fail(404, 'no_route');
}
// De quién son las notas de un pedido que trae o: propias, o del espacio del equipo de quien llama.
function spaceOf(user, o) {
  if (o == null || o === '' || +o === user.id) return user;
  if (user.team && +o === user.team.space) return userById(user.team.space);
  throw new Fail(403, 'no_access');
}

// ---------- Eliminar la cuenta ----------
// La pide la propia cuenta, con su sesión, y escribiendo su correo. Se borra todo lo suyo: notas, historial,
// papelera, comentarios, tokens, sesiones, lo que compartió y lo que le compartieron, enlaces públicos, carpetas
// con contraseña, sesiones en vivo, invitaciones a su correo y el registro de sus suscripciones terminadas.
// No se borra con un cobro en marcha: seguiría cobrándose sin cuenta. Primero se cancela la suscripción
// (subscription_active, o team_billing_active si es la del equipo que administra). Quien administra un equipo con
// más gente saca primero a los demás (team_has_members): las notas del equipo se van con el equipo.
// Un miembro sale de su equipo y las notas del equipo quedan en el equipo.
const ACCOUNT_DELETES = 5; // pedidos por hora, por IP y por cuenta
// Todo lo que cuelga de una cuenta, tabla por tabla. La cuenta misma va al final.
const ACCOUNT_ROWS = ['DELETE FROM notes WHERE user = ?', 'DELETE FROM versions WHERE user = ?', 'DELETE FROM trash WHERE user = ?', 'DELETE FROM comments WHERE user = ?', 'DELETE FROM tokens WHERE user = ?',
  'DELETE FROM sessions WHERE user = ?', 'DELETE FROM vaults WHERE user = ?', 'DELETE FROM paddle_subs WHERE user = ?', 'DELETE FROM shares WHERE owner = ?', 'DELETE FROM links WHERE owner = ?', 'DELETE FROM lives WHERE owner = ?',
  'DELETE FROM users WHERE id = ?'];
function accountDelete(req, user, body) {
  const keys = ['accdel:ip:' + clientIp(req), 'accdel:user:' + user.id];
  keys.forEach((k) => limit(k, ACCOUNT_DELETES, HOUR, 'too_many'));
  keys.forEach((k) => mark(k));
  if (typeof body.email !== 'string' || body.email.trim().toLowerCase() !== user.email) throw new Fail(400, 'bad_confirm');
  const manage = env.PORTAL_URL || '';
  if (q("SELECT 1 FROM paddle_subs WHERE user = ? AND status = 'active' AND kind != 'team' LIMIT 1").get(user.id)) throw new Fail(409, 'subscription_active', 'Cancel the subscription before deleting the account', { manage });
  const own = q('SELECT * FROM teams WHERE owner = ?').get(user.id);
  if (own) {
    if (q("SELECT 1 FROM paddle_subs WHERE user = ? AND status = 'active' AND kind = 'team' LIMIT 1").get(user.id)) throw new Fail(409, 'team_billing_active', 'Cancel the team subscription before deleting the account', { manage });
    if (q('SELECT COUNT(*) AS n FROM team_members WHERE team = ?').get(own.id).n > 1) throw new Fail(409, 'team_has_members', 'Remove the other members of the team before deleting the account');
  }
  // Lo que vive en memoria o tiene conexiones abiertas se corta antes de tocar la base.
  const ids = own ? [user.id, own.space] : [user.id];
  for (const id of ids) {
    for (const row of q('SELECT * FROM lives WHERE owner = ?').all(id)) liveEnd(row, 'closed');
    for (const v of vaultsOf(id)) aiForget(v, false);
  }
  db.exec('BEGIN');
  try {
    if (!own && user.team) q('DELETE FROM team_members WHERE team = ? AND user = ?').run(user.team.id, user.id);
    if (own) { q('DELETE FROM team_members WHERE team = ?').run(own.id); q('DELETE FROM team_invites WHERE team = ?').run(own.id); q('DELETE FROM teams WHERE id = ?').run(own.id); }
    for (const id of ids) for (const sql of ACCOUNT_ROWS) q(sql).run(id);
    q('DELETE FROM shares WHERE email = ?').run(user.email);
    q('DELETE FROM team_invites WHERE email = ?').run(user.email);
    q('DELETE FROM codes WHERE email = ?').run(user.email);
    q('DELETE FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)').run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  scrub();
  // Las pestañas que seguían escuchando notas de la cuenta (o del equipo que se fue con ella) se cortan.
  for (const [key, room] of rooms) for (const c of Array.from(room)) if (c.uid === user.id || ids.some((id) => key.startsWith(id + ':'))) c.res.end();
  return { ok: true };
}

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
  // Los dos precios del plan de equipo cuentan por su id, lleven o no esa marca.
  const items = (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.price && typeof i.price === 'object');
  if (!items.some((i) => (i.price.custom_data && i.price.custom_data.app === 'sharpmd') || (TEAM_BASE && (i.price.id === TEAM_BASE || i.price.id === TEAM_SEAT)))) return { ok: true, ignored: 'product' };
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
  // De equipo es la suscripción que trae el precio base del equipo. Como la cuenta, se decide la primera vez que se la ve.
  const kind = known ? known.kind : (TEAM_BASE && items.some((i) => i.price.id === TEAM_BASE) ? 'team' : 'solo');
  q('INSERT INTO paddle_subs (id, user, status, at, kind) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, at = MAX(at, excluded.at)').run(id, user.id, status, at, kind);
  // La suscripción de un equipo no toca el plan propio de la cuenta: da el plan pago a sus miembros mientras esté al día.
  if (kind === 'team') return Object.assign({ ok: true }, teamBilled(user, id, status === 'active', items));
  // El plan es pago mientras quede alguna suscripción activa de la cuenta. Así, quien paga una suscripción a nombre
  // de otra persona y después la cancela no le saca el plan que esa persona paga por su lado.
  const other = q("SELECT id FROM paddle_subs WHERE user = ? AND status = 'active' AND kind != 'team' ORDER BY at DESC LIMIT 1").get(user.id);
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
  if ((p === '/admin/plan' || p === '/admin/team') && m === 'POST') {
    // La misma respuesta sin clave configurada, sin clave en el pedido o con una equivocada. Diez fallos por hora por IP.
    const ip = 'admin:' + clientIp(req);
    limit(ip, 10, HOUR, 'too_many');
    if (!env.ADMIN_KEY || !same(req.headers['x-admin-key'] || '', env.ADMIN_KEY)) { mark(ip); throw new Fail(403, 'forbidden'); }
    const b = await readBody(req);
    if (p === '/admin/team') {
      // Un equipo armado a mano, sin cobro: para quien aloja su propio servidor. seats: 0 lo deja sin plan pago.
      const owner = q('SELECT * FROM users WHERE email = ?').get(cleanEmail(b.email));
      if (!owner) throw new Fail(404, 'not_found');
      if (!Number.isInteger(b.seats) || b.seats < 0) throw new Fail(400, 'bad_seats');
      if (!b.seats) { const t = q('SELECT * FROM teams WHERE owner = ?').get(owner.id); if (!t) throw new Fail(404, 'not_found'); teamShut(t); return { ok: true }; }
      const t = teamOpen(owner, b.seats, null);
      if (!t) throw new Fail(409, 'in_team');
      return { ok: true, team: t.id, seats: t.seats };
    }
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
  // Sesión en vivo, del lado de quien entra por el enlace: mirar, entrar, y lo que alcanza un pase de invitado.
  if (p === '/live/look' && m === 'POST') return liveLook(req, await readBody(req));
  if (p === '/live/join' && m === 'POST') return liveJoin(req, await readBody(req));
  if (p.startsWith('/live/') && /^Bearer\s+mdl_/i.test(req.headers.authorization || '')) return liveGuest(req, p, m);
  const user = userFrom(req, 'session');
  // Y del lado de quien la abre: abrir, ver quiénes están, cambiar el enlace, sacar a alguien y terminarla.
  if (p === '/live' && m === 'POST') return liveOpen(user, await readBody(req));
  if (p === '/live' || p === '/live/rotate' || p === '/live/kick' || p === '/live/presence') {
    const body = m === 'POST' ? await readBody(req) : {};
    const row = liveRow(user.id, cleanPath(m === 'POST' ? body.path : url.searchParams.get('path')));
    if (p === '/live' && m === 'GET') return row ? liveView(row) : { open: false };
    if (!row) throw new Fail(404, 'live_gone');
    if (p === '/live' && m === 'DELETE') { liveEnd(row, 'closed'); return { ok: true }; }
    if (p === '/live/rotate' && m === 'POST') return { secret: liveRotate(row) };
    if (p === '/live/kick' && m === 'POST') return liveKick(row, body.id);
    if (p === '/live/presence' && m === 'POST') return livePresence(row, memOf(row).owner, 'o', body);
  }
  if (p === '/team' || p.startsWith('/team/')) return teamRoute(user, p, m, req);
  if (p === '/shared' && m === 'GET') return sharedWith(user);
  if (p === '/shares' && m === 'POST') return addShare(user, await readBody(req));
  if (p === '/shares' && m === 'GET') return sharesOf(user, url.searchParams.get('path'));
  if (p.startsWith('/shares/') && m === 'DELETE') { q('DELETE FROM shares WHERE id = ? AND owner = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/links' && m === 'POST') return addLink(user, await readBody(req));
  if (p.startsWith('/links/') && m === 'DELETE') { q('DELETE FROM links WHERE id = ? AND owner = ?').run(+p.slice(7), user.id); return { ok: true }; }
  if (p === '/account' && m === 'GET') return account(user);
  if (p === '/account' && m === 'DELETE') return accountDelete(req, user, await readBody(req));
  if (p === '/trash' || p.startsWith('/trash/')) return trashRoute(user, p, m, url, m === 'POST' ? await readBody(req) : {});
  if (p === '/vaults' && m === 'GET') return vaultsOf(user.id).map(vaultView);
  if (p === '/vaults' && m === 'POST') return vaultCreate(user, await readBody(req));
  const vm = /^\/vaults\/(\d+)(?:\/(unlock|lock|open|destroy))?$/.exec(p);
  if (vm) {
    const v = q('SELECT * FROM vaults WHERE id = ? AND user = ?').get(+vm[1], user.id);
    if (!v) throw new Fail(404, 'not_found');
    if (!vm[2] && m === 'PUT') return vaultRewrap(user, v, await readBody(req));
    if (!vm[2] && m === 'DELETE') return vaultRemove(user, v);
    if (vm[2] === 'unlock' && m === 'POST') return vaultUnlock(user, v, await readBody(req));
    if (vm[2] === 'lock' && m === 'POST') { aiForget(v, true); return vaultView(v); }
    if (vm[2] === 'open' && m === 'POST') return vaultOpening(user, v);
    if (vm[2] === 'destroy' && m === 'POST') return vaultDestroy(user, v, await readBody(req));
  }
  if (p === '/auth/logout' && m === 'POST') { q('DELETE FROM sessions WHERE hash = ?').run(sha(req.headers.authorization.split(/\s+/)[1])); return { ok: true }; }
  if (p === '/tokens' && m === 'GET') return q('SELECT id, name, scope, share, created, used FROM tokens WHERE user = ? ORDER BY created DESC').all(user.id).map((t) => Object.assign(t, { share: !!t.share }));
  if (p === '/comments' && m === 'GET') return listComments(user, url.searchParams.get('path') || '', url.searchParams.get('all') === '1');
  if (p === '/comments' && m === 'POST') { const c = addComment(user, await readBody(req)); announce(roomKey(user.id, c.path), { type: 'comments' }); return c; }
  if (p.startsWith('/comments/') && m === 'DELETE') { q('DELETE FROM comments WHERE id = ? AND user = ?').run(+p.slice(10), user.id); return { ok: true }; }
  if (p === '/tokens' && m === 'POST') {
    if (!mcpAllowed(user)) throw new Fail(402, 'mcp_needs_plan');
    if (q('SELECT COUNT(*) AS n FROM tokens WHERE user = ?').get(user.id).n >= MAX_TOKENS) throw new Fail(429, 'too_many');
    const b = await readBody(req); const token = 'mdt_' + random(30);
    const scope = String(b.folder || '').trim() ? cleanPath(String(b.folder).replace(/\/+$/, '')) : '';
    // Compartir y crear enlaces es un permiso aparte, que se pide al crear el token: sin share: true no lo tiene.
    const share = b.share === true;
    const r = q('INSERT INTO tokens (hash, user, name, scope, share, created) VALUES (?, ?, ?, ?, ?, ?)').run(sha(token), user.id, String(b.name || 'AI').slice(0, 60), scope, share ? 1 : 0, now());
    return { id: Number(r.lastInsertRowid), token, scope, share, mcp_url: PUBLIC_URL + '/mcp' };
  }
  if (p.startsWith('/tokens/') && m === 'DELETE') { q('DELETE FROM tokens WHERE id = ? AND user = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/notes' && m === 'GET') {
    const oid = +(url.searchParams.get('o') || user.id);
    if (oid === user.id) return listNotes(user).map((n) => (n.v ? n : { path: n.path, updated: n.updated, size: n.size }));
    if (user.team && oid === user.team.space) return listNotes({ id: oid }).map((n) => ({ path: n.path, updated: n.updated, size: n.size }));
    return sharedWith(user).filter((n) => n.owner === oid).map((n) => ({ path: n.path, updated: n.updated, size: n.size }));
  }
  // Con o, estas cuatro trabajan sobre el espacio del equipo de quien llama. Cualquier otro o se rechaza.
  if (p === '/search' && m === 'GET') return searchNotes(spaceOf(user, url.searchParams.get('o')), url.searchParams.get('q'));
  if (p === '/rename' && m === 'POST') { const b = await readBody(req); return renameNote(spaceOf(user, b.o), b.from, b.to, b); }
  if (p.startsWith('/notes/')) {
    const note = dec(p.slice(7));
    const clean = cleanPath(note);
    if (m === 'GET') { const t = target(user, url, clean, 'view'); return Object.assign(readNote(t.owner, clean), { role: t.role }); }
    if (m === 'PUT') {
      const t = target(user, url, clean, 'edit');
      const body = await readBody(req);
      const saved = t.role === 'owner' ? liveWrite(t.owner, clean, body.text, cleanRev(body.rev)) : writeNote(t.owner, clean, body.text, cleanRev(body.rev));
      tellSaved(t.owner.id, clean, saved, { by: user.email, pid: t.role === 'owner' ? 'o' : 'x' }, String(body.text == null ? '' : body.text));
      return saved;
    }
    if (m === 'DELETE') return deleteNote(target(user, url, clean, 'owner').owner, clean, url.searchParams.get('forever') === '1');
  }
  if (p.startsWith('/versions/') && m === 'GET') return q('SELECT id, saved, size FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 100').all(spaceOf(user, url.searchParams.get('o')).id, cleanPath(dec(p.slice(10))));
  if (p.startsWith('/version/') && m === 'GET') {
    const v = q('SELECT id, path, text, saved, e, aad FROM versions WHERE id = ? AND user = ?').get(+p.slice(9), spaceOf(user, url.searchParams.get('o')).id);
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
    if (url.pathname === '/live/events' && req.method === 'GET') { listenGuest(req, res); return; }
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

// Limpieza: códigos vencidos, historial viejo, lo que venció en la papelera y sesiones sin uso, cada seis horas; los topes en memoria, cada diez minutos.
setInterval(() => {
  q('DELETE FROM codes WHERE expires < ?').run(now());
  q('DELETE FROM versions WHERE saved < ?').run(now() - HISTORY_DAYS * DAY);
  trashSweep();
  q('DELETE FROM sessions WHERE seen < ?').run(now() - SESSION_DAYS * DAY);
}, 6 * HOUR).unref();
setInterval(() => { for (const k of marks.keys()) if (!recent(k, DAY).length) marks.delete(k); for (const [k, w] of windows) if (now() - w.t > HOUR) windows.delete(k); }, 600000).unref();
// Sesiones en vivo: los invitados que se fueron sin avisar dejan su lugar, y la sesión sin nadie conectado vence.
setInterval(() => {
  for (const row of q('SELECT * FROM lives').all()) {
    const m = liveMem.get(row.id);
    if (m) { let gone = false; for (const g of Array.from(m.guests.values())) if (!g.conns && now() - g.at > LIVE_GUEST_MS) { dropGuest(row, g, 'left'); gone = true; } if (gone) tellLive(row); }
    if (liveMembers(row).length) { if (now() - row.seen > Math.min(60000, LIVE_IDLE_MS / 4)) liveTouch(row); }
    else if (liveStale(row)) liveEnd(row, 'expired');
  }
}, Math.min(15000, Math.max(200, LIVE_IDLE_MS / 4))).unref();

server.listen(PORT, env.HOST || '127.0.0.1', () => console.log('SharpMD Sync en ' + PUBLIC_URL + ' (puerto ' + PORT + ')'));
