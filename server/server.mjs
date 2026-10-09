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
//   FREE_NOTES      notas del plan gratis (10). El número sale solo de acá: la app y la IA lo reciben del servidor
//   FREE_AGENTS     agentes activos a la vez en el plan gratis (2). El plan pago no tiene tope y guarda su historial
//   AGENT_STALE_MS, AGENT_GONE_MS, AGENT_DONE_MS, AGENT_HISTORY_MS   los tiempos de los agentes (ver las constantes)
//   API_FREE=1      opens the API and the automations on the free plan too (MCP_FREE=1, the older name, does the same)
//   SHARE_FREE=1    habilita compartir también en el plan gratis
//   CHECKOUT_MONTHLY, CHECKOUT_YEARLY   enlaces de pago que la app muestra en Ajustes → Plan
//   ADMIN_KEY       clave para cambiar el plan de una cuenta desde /admin/plan
//   TEST_LOGIN      correo:123456 de una cuenta de prueba que entra con ese código fijo, sin correo (para revisiones de tienda)
//   PADDLE_WEBHOOK_SECRET   firma de los avisos de Paddle: con esto /paddle/webhook activa y da de baja el plan pago
//   PORTAL_URL      dirección donde quien paga administra su suscripción
//   FEEDBACK_TO     correo que recibe los comentarios y reportes de error de POST /feedback (además quedan en la tabla feedback). Sin esto, responde 404
//   AUTH_PER_IP     códigos de acceso que una misma IP puede pedir por hora (20). Detrás de un proxy la IP sale de x-forwarded-for
//   VAULT_MINUTE_MS solo para pruebas: cuántos milisegundos dura un minuto de una carpeta desbloqueada para la IA (60000)
//   DATA_KEY        32 bytes en base64: con ella, el texto de las notas, del historial y de los comentarios se guarda cifrado
//                   (AES-256-GCM). Protege el archivo de la base y sus respaldos. Perderla es perder esos datos
//   LIVE_FREE=1     habilita las sesiones en vivo también en el plan gratis
//   LIVE_PEOPLE     personas por sesión en vivo, contando a quien la abrió (12)
//   LIVE_IDLE_MS    cuánto dura una sesión en vivo sin nadie conectado (12 horas)
//   LIVE_GUEST_MS   cuánto conserva su lugar un invitado sin conexión (2 minutos)
//   PADDLE_PRICE_MONTHLY, PADDLE_PRICE_YEARLY   ids de los precios vigentes del plan pago en Paddle (mensual y anual)
//   PADDLE_PRICE_LEGACY   ids de precios anteriores del plan pago, separados por coma: quien sigue suscripto a uno
//                   conserva el plan. Un precio marcado en Paddle con custom_data.app = 'sharpmd' cuenta igual
//   PADDLE_PRICE_TEAM   id del precio del plan de equipo en Paddle: por persona y por mes, con la cantidad = lugares.
//                   Con él (o con custom_data.kind = 'team' en el precio) el aviso reconoce la suscripción de un equipo
//   PADDLE_PRICE_TEAM_NOTRIAL   opcional: el mismo precio sin prueba gratis, para quien ya usó la suya
//   PADDLE_API_KEY  clave de la API de Paddle: con ella el servidor cambia la cantidad de lugares de un equipo.
//                   Sin PADDLE_PRICE_TEAM, esta clave y PADDLE_WEBHOOK_SECRET el plan de equipo queda apagado y la app no lo ofrece
//   PADDLE_API_URL  dirección de la API de Paddle (https://api.paddle.com; la de pruebas es https://sandbox-api.paddle.com)
//   CHECKOUT_TEAM   enlace de pago del plan de equipo que la app muestra en Ajustes → Plan
//   TEAM_MAX_SEATS  lugares que puede tener un equipo como máximo (50)
//   TEAM_INVITES_DAY  invitaciones que un equipo puede mandar por día (20)
//   TEAM_HISTORY_DAYS días de historial de versiones en el espacio de un equipo (365)
//   TEAM_LOG_DAYS   días que dura el registro de actividad de un equipo (90)
//   APP_URL         dirección de la app: a ella llevan el correo de invitación, el botón del correo con el código y los enlaces que el MCP devuelve
//                   para abrir una nota (https://sharpmd.app/src/app.html)
//   TRASH_DAYS      días que una nota eliminada queda en la papelera antes de borrarse del todo (30)
//   GALLERY_NOTIFY_URL  opcional: cada aporte nuevo a la galería manda acá un POST con { text } (una línea corta, sin
//                   enlaces ni correos). La galería recibe aportes solo con ADMIN_KEY puesta: hace falta quien los revise
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
// Lo que usan las automatizaciones (webhooks salientes): ver el bloque AUTOMATIZACIONES.
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';

const env = process.env;
const PORT = +(env.PORT || 8787);
const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), 'data');
const PUBLIC_URL = (env.PUBLIC_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const ORIGINS = (env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FREE_NOTES = +(env.FREE_NOTES || 10);
// Agentes (start_agent y las demás): cuántos a la vez en el plan gratis, y sus tiempos. Un agente que no da señales
// en AGENT_STALE_MS figura "sin señal"; en AGENT_GONE_MS se borra. Uno que terminó sigue a la vista AGENT_DONE_MS.
// El plan pago guarda los que terminaron o se perdieron AGENT_HISTORY_MS. AGENTS_MAX es un techo técnico, de cualquier
// plan, de agentes anotados a la vez; AGENT_HISTORY_MAX, el de filas de historial por cuenta, y AGENT_HISTORY_PAGE cuántas se entregan.
const FREE_AGENTS = Math.max(1, Math.floor(+(env.FREE_AGENTS || 2)) || 2);
const AGENT_STALE_MS = Math.max(50, +(env.AGENT_STALE_MS || 5 * 60000) || 5 * 60000);
const AGENT_GONE_MS = Math.max(AGENT_STALE_MS, +(env.AGENT_GONE_MS || 30 * 60000) || 30 * 60000);
const AGENT_DONE_MS = Math.max(50, +(env.AGENT_DONE_MS || 2 * 60000) || 2 * 60000);
const AGENT_HISTORY_MS = Math.max(AGENT_DONE_MS, +(env.AGENT_HISTORY_MS || 24 * 3600000) || 24 * 3600000);
const AGENTS_MAX = 200; const AGENT_HISTORY_MAX = 500; const AGENT_HISTORY_PAGE = 100;
const TEST_LOGIN =/^[^\s:]+@[^\s:]+:\d{6}$/.test(env.TEST_LOGIN || '') ? [env.TEST_LOGIN.split(':')[0].toLowerCase(), env.TEST_LOGIN.split(':')[1]] : null;
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
// by: quién hizo el último guardado de la nota ('u:12' una cuenta, 't:5' un token de IA, 'g:Ana' un invitado de una
// sesión en vivo, con el nombre que eligió). En una versión del historial, quién había escrito ese texto. Las notas
// y versiones anteriores a esta columna quedan sin autor. Nunca guarda un correo: el nombre se busca al leer.
for (const table of ['notes', 'versions']) { try { db.exec('ALTER TABLE ' + table + ' ADD COLUMN by TEXT'); } catch (e) { /* ya estaba */ } }
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
// Para el espacio de un equipo (la fila con folder vacío, a nombre de la cuenta interna del equipo): gone es cuándo
// salió alguien que conocía la contraseña, ai_members si los miembros pueden desbloquear para su IA, y next lo que
// envuelve a la llave nueva mientras se rota.
for (const col of ['gone INTEGER NOT NULL DEFAULT 0', 'ai_members INTEGER NOT NULL DEFAULT 0', 'next TEXT']) { try { db.exec('ALTER TABLE vaults ADD COLUMN ' + col); } catch (e) { /* ya estaba */ } }
// Las filas sin tamaño son anteriores a esta columna y están en claro: se mide de una vez, sin traerlas a memoria.
db.exec('UPDATE notes SET size = LENGTH(text) WHERE size IS NULL AND e = 0');
db.exec('UPDATE versions SET size = LENGTH(text) WHERE size IS NULL AND e = 0');
const q = (sql) => db.prepare(sql);
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');
// Compara dos secretos sin que el tiempo de la respuesta diga cuánto coinciden.
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// Gmail entrega en la misma casilla con o sin puntos y con cualquier cosa después de un +: para esos dos dominios, y
// solo para esos, la cuenta se busca por esta forma. El correo guardado de cada cuenta no cambia.
const mailKey = (email) => { const m = /^([^@]+)@(gmail\.com|googlemail\.com)$/.exec(email); const local = m ? m[1].split('+')[0].replace(/\./g, '') : ''; return local ? local + '@gmail.com' : email; };
try { db.exec('ALTER TABLE users ADD COLUMN mkey TEXT'); } catch (e) { /* ya estaba */ }
for (const u of q('SELECT id, email FROM users WHERE mkey IS NULL').all()) q('UPDATE users SET mkey = ? WHERE id = ?').run(mailKey(u.email), u.id);
db.exec('CREATE INDEX IF NOT EXISTS users_mkey ON users (mkey)');
// Galería de la comunidad: aportes declarativos (plantillas, temas, paletas). status: pending | approved | rejected | removed.
// nonce: lo que ata los enlaces de revisión del correo a este aporte; se vacía al decidir, y con eso dejan de servir.
db.exec("CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, about TEXT NOT NULL, lang TEXT NOT NULL, author TEXT NOT NULL, data TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', e INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', adds INTEGER NOT NULL DEFAULT 0, nonce TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, decided INTEGER)");
db.exec('CREATE INDEX IF NOT EXISTS gallery_status ON gallery (status)');

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
  { name: 'gallery', cols: ['name', 'about', 'author', 'data', 'reason'], any: 'SELECT 1 FROM gallery WHERE e = 1 LIMIT 1', pick: 'SELECT rowid AS rid, name, about, author, data, reason FROM gallery WHERE e = 0 LIMIT 50', put: 'UPDATE gallery SET name = ?, about = ?, author = ?, data = ?, reason = ?, e = 1 WHERE rowid = ? AND e = 0' },
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
// El correo del código: inglés por defecto, español si la app lo pide. Va en HTML y en texto plano, sin imágenes ni
// rastreo. El código va primero en el asunto (el teléfono lo ofrece para copiar desde el aviso) y solo en su renglón,
// sin nada pegado: un doble clic o una pulsación larga lo toma entero.
// El botón abre la app con el correo y el código ya cargados. Van en el fragmento de la dirección (#signin=), que el
// navegador no manda a ningún servidor ni pone en Referer. Es el mismo código, con su único uso y su vencimiento: el
// enlace no suma ningún poder. Abrirlo no inicia sesión: la app pregunta, y recién al confirmar llama a /auth/verify,
// así que un antivirus o un cliente de correo que abre los enlaces no gasta el código.
const MAIL = {
  en: { subject: (c) => c + ' is your SharpMD code', lead: 'Your sign-in code', go: 'Sign in to SharpMD', or: 'Or type the code in the app.', note: 'It expires in 15 minutes and works once. If you did not ask for it, you can ignore this email.',
    text: (c, link) => c + '\n\nThat is your SharpMD sign-in code. Type it in the app, or open this link and confirm:\n' + link + '\n\nIt expires in 15 minutes and works once. If you did not ask for it, you can ignore this email.' },
  es: { subject: (c) => c + ' es tu código de SharpMD', lead: 'Tu código para entrar', go: 'Entrar a SharpMD', or: 'O escribí el código en la app.', note: 'Vence en 15 minutos y sirve una sola vez. Si no lo pediste, podés ignorar este correo.',
    text: (c, link) => c + '\n\nEse es tu código para entrar a SharpMD. Escribilo en la app, o abrí este enlace y confirmá:\n' + link + '\n\nVence en 15 minutos y sirve una sola vez. Si no lo pediste, podés ignorar este correo.' },
};
const signinLink = (email, code) => APP_URL.split('#')[0] + '#signin=' + Buffer.from(code + ':' + email, 'utf8').toString('base64url');
const mailHtml = (m, code, link) => '<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2026">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;background:#ffffff;border:1px solid #dedbd2;border-radius:14px">' +
  '<tr><td style="padding:28px 32px 8px;font-size:17px;font-weight:700;letter-spacing:-0.01em"><span style="display:inline-block;padding:3px 5px 3px 6px;border-radius:6px;background:#14161a;color:#f3f5f8;font:700 15px/16px ui-monospace,Consolas,Menlo,monospace;vertical-align:middle">#<span style="display:inline-block;width:5px;height:14px;margin-left:3px;border-radius:1px;background:#c5f467;vertical-align:-2px"></span></span>&nbsp; <span style="vertical-align:middle">Sharp<span style="font-weight:400">MD</span></span></td></tr>' +
  '<tr><td style="padding:8px 32px 0;font-size:15px;color:#5c6370">' + m.lead + '</td></tr>' +
  '<tr><td style="padding:14px 32px 6px"><div style="padding:16px 0;border-radius:10px;background:#f1efe9;text-align:center;font:700 32px/1 ui-monospace,Consolas,Menlo,monospace;letter-spacing:0.28em;color:#1d2026;-webkit-user-select:all;user-select:all">' + code + '</div></td></tr>' +
  '<tr><td style="padding:10px 32px 0" align="center"><a href="' + html(link) + '" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#4d7c0f;color:#ffffff;font-size:15px;font-weight:650;text-decoration:none">' + m.go + '</a></td></tr>' +
  '<tr><td style="padding:10px 32px 0;font-size:13.5px;color:#5c6370" align="center">' + m.or + '</td></tr>' +
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
  const link = signinLink(email, code);
  const sent = await sendMail({ to: email, subject: m.subject(code), text: m.text(code, link), html: mailHtml(m, code, link) });
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
  const email = cleanEmail(body.email); const ip = 'start:ip:' + clientIp(req); const to = 'start:mail:' + mailKey(email);
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
  statAdd('signin_start', statSource(body.src)); // one more code asked for, under the channel the app says: nothing about who
  await sendCode(email, code, body.lang);
  return env.DEV_CODES ? { ok: true, dev_code: code } : { ok: true };
}

// Seis intentos por código. Además, los fallos se cuentan por correo (10 por hora, 30 por día) y por IP (30 por
// hora) sin importar cuántos códigos se pidan: pedir otro código no devuelve los intentos. Cada tope tiene su
// código (tries_mail_hour, tries_mail_day, tries_ip_hour, tries_code). Antes los cuatro respondían too_many_tries.
// tries_code no trae espera: ese código ya no sirve y hay que pedir otro.
function authVerify(req, body) {
  const email = cleanEmail(body.email); const ip = 'fail:ip:' + clientIp(req); const who = 'fail:mail:' + mailKey(email);
  limit(who, 10, HOUR, 'tries_mail_hour'); limit(who, 30, DAY, 'tries_mail_day'); limit(ip, 30, HOUR, 'tries_ip_hour');
  const row = q('SELECT * FROM codes WHERE email = ?').get(email);
  if (!row || row.expires < now()) throw new Fail(400, 'code_expired');
  if (row.tries >= 6) throw new Fail(429, 'tries_code');
  if (!same(row.hash, sha(email + ':' + String(body.code == null ? '' : body.code).trim()))) { q('UPDATE codes SET tries = tries + 1 WHERE email = ?').run(email); mark(who); mark(ip); throw new Fail(400, 'bad_code'); }
  q('DELETE FROM codes WHERE email = ?').run(email);
  // La cuenta: la de ese correo tal cual, y si no, la que coincide al sacarle los alias de Gmail (la más vieja, si
  // hubiera más de una de antes). Dos cuentas que ya existían siguen entrando cada una con su correo.
  let user = q('SELECT * FROM users WHERE email = ?').get(email) || q('SELECT * FROM users WHERE mkey = ? ORDER BY id LIMIT 1').get(mailKey(email));
  const fixed = !!TEST_LOGIN && email === TEST_LOGIN[0];
  if (!user) {
    // The channel the account came from ("reddit") stays on the account: the later steps are counted under it.
    const source = statSource(body.src);
    const made = q('INSERT OR IGNORE INTO users (email, mkey, created, source) VALUES (?, ?, ?, ?)').run(email, mailKey(email), now(), source).changes;
    user = q('SELECT * FROM users WHERE email = ?').get(email);
    if (made && !fixed) statAdd('signed_up', source);
  } else if (!fixed) statAdd('signed_in', user.source || 'unknown');
  const session = 'mds_' + random(32);
  q('INSERT INTO sessions (hash, user, created, seen) VALUES (?, ?, ?, ?)').run(sha(session), user.id, now(), now());
  return { session, account: account(userById(user.id)) };
}

function userFrom(req, kind) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new Fail(401, 'no_auth');
  if (kind === 'session' && m[1].startsWith('mds_')) {
    const s = q('SELECT user FROM sessions WHERE hash = ? AND seen > ?').get(sha(m[1]), now() - SESSION_DAYS * DAY);
    if (s) { q('UPDATE sessions SET seen = ? WHERE hash = ?').run(now(), sha(m[1])); return ctxSet('user', userById(s.user)); }
  }
  if (kind === 'token' && m[1].startsWith('mdt_')) {
    const t = q('SELECT * FROM tokens WHERE hash = ?').get(sha(m[1]));
    // Un token del equipo no es de una persona: entra como el espacio del equipo, con lo que se le dio al crearlo.
    if (t && t.team) { const u = teamTokenUser(t); if (u) { q('UPDATE tokens SET used = ? WHERE id = ?').run(now(), t.id); return ctxSet('user', u); } }
    else if (t) { q('UPDATE tokens SET used = ? WHERE id = ?').run(now(), t.id); const u = userById(t.user); if (u) { u.scope = t.scope || ''; u.canShare = !!t.share; u.tokenName = t.name; u.tokenId = t.id; } return ctxSet('user', u); }
  }
  throw new Fail(401, 'bad_auth');
}

const countNotes = (user) => q('SELECT COUNT(*) AS n FROM notes WHERE user = ?').get(user.id).n;
// MCP (the endpoint, its tokens, the comments for the AI and unlocking a folder for it) is on every plan: on the free
// one it works over the same notes, with the same limit. The REST API, the webhooks, the inbound addresses and the
// automations belong to the paid plan.
const apiAllowed = (user) => user.plan === 'pro' || !!env.API_FREE || !!env.MCP_FREE;
const shareAllowed = (user) => user.plan === 'pro' || !!env.SHARE_FREE;
// plan es el que vale ahora; own_plan, el que la cuenta paga por su lado (un miembro de un equipo puede tener los dos).
// Administra una suscripción quien la paga: la propia, o la del equipo si es quien lo administra.
// ---------- Nombre visible de la cuenta ----------
// Lo que los demás ven de una persona en notas compartidas y equipos. Sin elegir, es lo que va antes de la arroba
// de su correo. Es texto plano: quien lo muestra lo pone como texto, nunca como HTML. Hacia afuera (webhooks, API)
// no viaja: ahí el actor sigue siendo su identificador y su papel.
try { db.exec('ALTER TABLE users ADD COLUMN name TEXT'); } catch (e) { /* ya estaba */ }
const NAME_PER_HOUR = Math.max(1, +(env.NAME_PER_HOUR || 10));
const nameOf = (u) => (u && u.name ? u.name : String((u && u.email) || '').split('@')[0]);
// PUT /account { name }: de 2 a 40 caracteres, sin arroba ni saltos de línea. Vacío o null vuelve al nombre por defecto.
function accountName(user, body) {
  const raw = body ? body.name : undefined;
  if (raw !== null && typeof raw !== 'string') throw new Fail(400, 'bad_name');
  rate('name:' + user.id, NAME_PER_HOUR, HOUR, 'too_many');
  let name = null;
  if (raw !== null && raw.trim() !== '') {
    if (/[\r\n]/.test(raw) || raw.includes('@') || raw.length > 200) throw new Fail(400, 'bad_name', 'A display name has 2 to 40 characters, no @ and no line breaks');
    name = cleanName(raw);
    if (name.length < 2 || name !== raw.replace(/\s+/g, ' ').trim()) throw new Fail(400, 'bad_name', 'A display name has 2 to 40 characters, no @ and no line breaks');
  }
  q('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
  return account(userById(user.id));
}
// ---------- fin del nombre visible ----------
// El aviso de la primera nota en la nube ("protegela con una contraseña") se muestra una vez por cuenta: acá queda
// anotado que ya se vio, para que no vuelva en otro dispositivo. Proteger algo también lo da por visto.
try { db.exec('ALTER TABLE users ADD COLUMN protect_seen INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* ya estaba */ }
const protectSeen = (userId) => { const r = q('SELECT protect_seen FROM users WHERE id = ?').get(userId); return !!(r && r.protect_seen); };
function protectSeenSet(user) { q('UPDATE users SET protect_seen = ? WHERE id = ? AND protect_seen = 0').run(now(), user.id); return { ok: true }; }
const account = (user) => ({ id: user.id, protect_seen: protectSeen(user.id), share: shareAllowed(user), live: user.plan === 'pro' || !!env.LIVE_FREE, email: user.email, name: nameOf(user), name_default: !user.name, plan: user.plan, own_plan: user.own || user.plan, notes: countNotes(user), limit: user.plan === 'pro' ? null : FREE_NOTES, free_notes: FREE_NOTES, mcp: true, api: apiAllowed(user), mcp_url: PUBLIC_URL + '/mcp',
  manage: ((user.own || user.plan) === 'pro' || (user.team && user.team.owner === user.id && user.team.sub)) && env.PORTAL_URL ? env.PORTAL_URL : '',
  // billing: si a esta cuenta se le muestra algo de cobro. A quien tiene el plan por un equipo que paga otra persona, no:
  // ni enlaces de pago ni precios. Lo que paga por su lado (su suscripción individual) lo sigue administrando.
  billing: !teamGuest(user), checkout: teamGuest(user) ? { monthly: '', yearly: '' } : { monthly: payLink(env.CHECKOUT_MONTHLY, user), yearly: payLink(env.CHECKOUT_YEARLY, user) }, team: teamView(user), pages: pagesView(user) });

// ---------- Comentarios ----------
// Lo que alguien escribe desde "Enviar comentarios" queda guardado en la tabla feedback y además sale por correo a
// FEEDBACK_TO. Entra con o sin sesión. Tope de cinco por hora por IP y por cuenta.
// Guardado es recibido: si el correo falla, el comentario ya está en la base y la respuesta es de éxito.
// De cada uno se guarda el texto, el correo si lo dieron, si había sesión y con qué plan, y los cuatro datos de
// contexto ya saneados (place es "where": web o extension). De una denuncia, además, qué nota es. Nada de contenido de
// notas. Va en claro, sin DATA_KEY: lo lee de afuera, en solo lectura, quien avisa las novedades. El id no se repite
// (AUTOINCREMENT): "los nuevos desde el id N" vale aunque la tabla se haya vaciado. Se borran solos a los 180 días.
const FEEDBACK_MAX = 5;
const FEEDBACK_DAYS = 180;
db.exec("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'feedback', from_email TEXT NOT NULL DEFAULT '', signed_in INTEGER NOT NULL DEFAULT 0, plan TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', rep_kind TEXT NOT NULL DEFAULT '', rep_note TEXT NOT NULL DEFAULT '', rep_owner TEXT NOT NULL DEFAULT '')");
const feedbackSweep = () => q('DELETE FROM feedback WHERE created < ?').run(now() - FEEDBACK_DAYS * DAY);
// GET /admin/feedback?days=N: los de los últimos N días (30 si no se dice, 180 como mucho), del más nuevo al más viejo.
function feedbackAdmin(url) {
  const days = Math.min(FEEDBACK_DAYS, Math.max(1, Math.floor(+url.searchParams.get('days') || 30)));
  const rows = q('SELECT * FROM feedback WHERE created >= ? ORDER BY id DESC LIMIT 500').all(now() - days * DAY);
  return { days, items: rows.map((r) => Object.assign({ id: r.id, created: r.created, kind: r.kind, from_email: r.from_email, signed_in: !!r.signed_in, plan: r.plan, text: r.text, context: { version: r.version, where: r.place, browser: r.browser, lang: r.lang } },
    r.kind === 'report' ? { report: { kind: r.rep_kind, note: r.rep_note, owner: r.rep_owner } } : {})) };
}
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
  const f = { note: rep ? field(rep.note, 300) : '-', owner: rep ? field(rep.owner, 120) : '-', kind: rep && ['link', 'shared', 'live', 'gallery', 'site'].includes(rep.kind) ? rep.kind : '-',
    version: field(c.version, 40), where: c.where === 'extension' ? 'extension' : 'web', browser: field(c.browser, 300), lang: field(c.lang, 20) };
  const kept = (v) => (v === '-' ? '' : v);
  const id = Number(q('INSERT INTO feedback (created, kind, from_email, signed_in, plan, text, version, place, browser, lang, rep_kind, rep_note, rep_owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(now(), rep ? 'report' : 'feedback', from, user ? 1 : 0, user ? String(user.plan || '') : '', text.slice(0, 4000), kept(f.version), f.where, kept(f.browser), kept(f.lang), kept(f.kind), kept(f.note), kept(f.owner)).lastInsertRowid);
  const mail = { to: env.FEEDBACK_TO, subject: rep ? 'SharpMD report' : 'SharpMD feedback',
    text: (rep ? 'Reported note: ' + f.note + '\nOwner: ' + f.owner + '\nKind: ' + f.kind + '\n\n' : '') +
      (text || '(no reason given)') + '\n\n---\nFrom: ' + (from || 'anonymous') + (user ? ' (signed in, ' + user.plan + ' plan)' : '') +
      '\nVersion: ' + f.version + '\nWhere: ' + f.where +
      '\nBrowser: ' + f.browser + '\nLanguage: ' + f.lang + '\n' };
  if (from) mail.reply_to = from;
  // El comentario ya quedó guardado: si el correo no sale, se anota y la respuesta es la misma.
  // Sin correo configurado y en modo de prueba no sale nada: alcanza para probar la app.
  let sent = true;
  try { sent = await sendMail(mail); } catch (e) { console.error('comentarios: no salió el correo del comentario ' + id); }
  return sent ? { ok: true } : { ok: true, dev: true };
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
// Una bóveda con folder vacío cubre todo: la del espacio de un equipo, o la de una persona que protegió toda su
// nube (POST /vaults { root: true }). Con esa, la persona no tiene otras: no va una dentro de otra.
const inside = (p, folder) => !folder || p.startsWith(folder + '/');
const preOf = (folder) => (folder ? folder + '/' : '');
// En el espacio de un equipo el dato asociado lleva además de qué espacio es: ~espacio/ruta, que es como el
// navegador nombra a esa nota. El formato es el mismo de siempre.
const teamAad = (spaceId, p) => '~' + spaceId + '/' + p;
const sealing = (vault) => !!vault && (vault.state === 'on' || vault.state === 'rotating');
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
  if (sealing(vault) && !sealedIn) throw new Fail(409, 'vault', 'This folder is protected with a password: its notes must arrive encrypted');
  if (!sealedIn) { if (Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large'); return { v: 0, size: text.length }; }
  if (!sealing(vault)) throw new Fail(409, 'vault_text', 'Encrypted text only goes inside a folder protected with a password');
  const body = text.slice(VAULT.length); const size = /^[A-Za-z0-9+/]+=*$/.test(body) ? Buffer.from(body, 'base64').length - 28 : -1;
  if (size < 0) throw new Fail(400, 'bad_vault_text');
  if (size > MAX_NOTE) throw new Fail(413, 'too_large');
  return { v: 1, size };
}

// Desbloqueada para la IA: la llave de cifrado de la carpeta, solo en memoria y con vencimiento. Bloquear a mano,
// vencer el plazo o reiniciar el servidor la olvidan. No se guarda K, sino la llave que sale de ella.
// En el espacio de un equipo la llave abierta es de quien la abrió: cada miembro desbloquea para su propia IA.
const aiKeys = new Map(); // id de la bóveda (o id:cuenta en la de un equipo) → { key, until, timer }
const aiSlot = (vault, uid) => (vault.folder || uid == null ? String(vault.id) : vault.id + ':' + uid);
function aiForget(vault, tell, uid) {
  const slot = aiSlot(vault, uid); const k = aiKeys.get(slot); if (!k) return;
  clearTimeout(k.timer); k.key.fill(0); aiKeys.delete(slot);
  if (tell) announceUser(vault.user, { type: 'vault' });
}
// Todas las llaves abiertas de una bóveda. Con keep, la de esa cuenta queda.
function aiForgetAll(vault, keep) {
  for (const [slot, k] of Array.from(aiKeys)) {
    if (slot !== String(vault.id) && !slot.startsWith(vault.id + ':')) continue;
    if (keep != null && slot === vault.id + ':' + keep) continue;
    clearTimeout(k.timer); k.key.fill(0); aiKeys.delete(slot);
  }
}
const aiKey = (vault, uid) => { const k = aiKeys.get(aiSlot(vault, uid)); if (!k) return null; if (k.until && k.until <= now()) { aiForget(vault, true, uid); return null; } return k; };
const vaultView = (v) => { const k = aiKey(v); return { id: v.id, folder: v.folder, root: !v.folder, salt: v.salt, iters: v.iters, wrapped: v.wrapped, check: v.verify, state: v.state, created: v.created, ai: k ? { until: k.until } : null }; };
// Al proteger una carpeta se va lo que quedaba en claro o abierto hacia afuera: el historial, los comentarios para
// la IA (citan el texto), los enlaces públicos y lo compartido.
function vaultPurge(userId, folder) {
  const pre = preOf(folder);
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
  // root: toda la nube de la cuenta, con una sola contraseña. La carpeta es la raíz.
  const folder = body.root === true ? '' : cleanPath(String(body.folder || '').replace(/\/+$/, ''));
  if (folder[0] === '~') throw new Fail(400, 'bad_path');
  const all = vaultsOf(user.id);
  if (all.length >= MAX_VAULTS) throw new Fail(429, 'too_many');
  // Una carpeta es bóveda con todo lo que tiene adentro: no va una dentro de otra.
  if (all.some((v) => v.folder === folder || inside(folder, v.folder) || inside(v.folder, folder))) throw new Fail(409, 'vault_nested', 'Protected folders cannot be nested');
  const iters = +body.iters;
  if (!b64(body.salt, 16) || !b64(body.wrapped, 60) || !b64(body.check, 32) || !Number.isInteger(iters) || iters < 100000 || iters > 10000000) throw new Fail(400, 'bad_vault');
  q('INSERT INTO vaults (user, folder, salt, iters, wrapped, verify, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, folder, body.salt, iters, body.wrapped, body.check, now());
  vaultPurge(user.id, folder);
  protectSeenSet(user);
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
  aiForgetAll(v);
  q("UPDATE vaults SET state = 'opening' WHERE id = ?").run(v.id);
  announceUser(v.user, { type: 'vault' });
  return vaultView(q('SELECT * FROM vaults WHERE id = ?').get(v.id));
}
function vaultRemove(user, v) {
  const pre = preOf(v.folder);
  if (q('SELECT 1 FROM notes WHERE user = ? AND v = 1 AND substr(path, 1, length(?)) = ? LIMIT 1').get(v.user, pre, pre)) throw new Fail(409, 'vault_not_empty', 'There are still encrypted notes in this folder');
  aiForgetAll(v);
  q('DELETE FROM versions WHERE user = ? AND substr(path, 1, length(?)) = ?').run(v.user, pre, pre); // el historial cifrado ya no tendría llave
  q('DELETE FROM trash WHERE user = ? AND v = 1 AND substr(path, 1, length(?)) = ?').run(v.user, pre, pre); // ni lo cifrado de la papelera
  q('DELETE FROM vaults WHERE id = ?').run(v.id);
  announceUser(v.user, { type: 'vault' });
  return { ok: true };
}
// Eliminar la carpeta entera sin su llave: para quien perdió la contraseña y la clave de respaldo. Se van la
// bóveda, sus notas, su historial y lo que tuviera en la papelera. Nada de eso pasa por la papelera: sin la llave
// no se podría leer nunca. Quien lo pide escribe el nombre de la carpeta, y acá se vuelve a comparar.
function vaultDestroy(user, v, body) {
  // La nube entera se confirma con el correo de la cuenta: no hay nombre de carpeta que escribir.
  if (v.folder ? typeof body.folder !== 'string' || body.folder !== v.folder : typeof body.confirm !== 'string' || body.confirm !== user.email) throw new Fail(400, 'bad_confirm');
  return vaultWipe({ id: v.user }, v);
}
function vaultWipe(user, v) {
  const pre = preOf(v.folder);
  aiForgetAll(v);
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
// Es parte del MCP, que está en todos los planes. Diez llaves equivocadas por hora por cuenta.
function vaultUnlock(user, v, body) { aiOpen(user, v, body); return vaultView(v); }
function aiOpen(user, v, body, uid) {
  if (v.state !== 'on') throw new Fail(409, 'vault', 'This folder is having its protection removed');
  const minutes = +body.minutes;
  if (!VAULT_MINUTES.includes(minutes)) throw new Fail(400, 'bad_minutes');
  limit('vkey:' + user.id, 10, HOUR, 'too_many');
  const K = b64(body.key, 32);
  if (!K || !crypto.timingSafeEqual(hk(K, VAULT_CHECK), Buffer.from(v.verify, 'base64'))) { if (K) K.fill(0); mark('vkey:' + user.id); throw new Fail(403, 'bad_key'); }
  aiForget(v, false, uid);
  const rec = { key: hk(K, VAULT_ENC), until: minutes ? now() + minutes * VAULT_MINUTE_MS : 0, timer: null };
  K.fill(0);
  if (minutes) { rec.timer = setTimeout(() => aiForget(v, true, uid), minutes * VAULT_MINUTE_MS); rec.timer.unref(); }
  aiKeys.set(aiSlot(v, uid), rec);
  announceUser(v.user, { type: 'vault' });
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
  const has = user.plan === 'pro' ? 0 : countNotes(user);
  if (has < FREE_NOTES) return;
  if (user.email.startsWith('team:')) throw new Fail(402, 'team_ended', 'This team is no longer on the paid plan: its notes can still be read and edited, but no new ones can be added');
  throw new Fail(402, 'note_limit', 'The free plan holds ' + FREE_NOTES + ' notes and this account has ' + has + '. Nothing was saved. Existing notes can still be read and edited. To add a new one, delete a note or move to the paid plan, which has no note limit: ' + plansUrl(), { limit: FREE_NOTES, notes: has });
}
// El uso del plan gratis, para decírselo a una IA: cuántas notas hay y cuántas entran. null en el plan pago y en
// el espacio de un equipo. El tope sale siempre de FREE_NOTES. El servidor no sabe precios: da el enlace a los planes.
const plansUrl = () => APP_URL.split('#')[0] + '#lmd-plans';
function planUse(user) {
  if (!user || user.plan === 'pro' || String(user.email || '').startsWith('team:')) return null;
  const notes = countNotes(user);
  return { notes, limit: FREE_NOTES, left: Math.max(0, FREE_NOTES - notes) };
}
const planLine = (u) => 'Free plan: ' + u.notes + ' of ' + u.limit + ' notes used, ' + (u.left || 'none') + ' left.';
// Después de crear una nota. Con lugar, una línea. Cuando quedan dos o menos, además qué decirle a la persona.
const LOW_ROOM = 2;
const planAfter = (u) => (u.left > LOW_ROOM ? 'Free plan: ' + u.notes + ' of ' + u.limit + ' notes used.'
  : planLine(u) + ' Tell the person that ' + (u.left ? 'the free plan is about to fill up and that ' + (u.left === 1 ? '1 note is' : u.left + ' notes are') + ' left' : 'the free plan is full and that the next new note will not be saved') + '. The paid plan has no note limit: ' + plansUrl());
// Lo que se suma al error del tope cuando quien lo recibe es una IA.
const FULL_FOR_AI = ' Tell the person what happened and give them that link, or offer to make room. Do not delete notes on your own.';
function writeNote(user, p, text, base) {
  p = cleanPath(p); text = String(text == null ? '' : text);
  const kind = checkText(user.id, p, text);
  const row = q('SELECT text, e, v, size, rev, updated, by FROM notes WHERE user = ? AND path = ?').get(user.id, p);
  const prev = row ? { text: unseal(row.text, row.e, 'notes.text') } : null;
  if (row && base != null && base !== row.rev) throw new Fail(409, 'rev_conflict', '', { text: prev.text, rev: row.rev, updated: row.updated });
  if (!prev) roomFor(user);
  // El historial es del plan pago: se guarda la versión anterior si cambió y pasó más de un minuto. Al cifrar una
  // nota (o al descifrarla) la versión anterior no se guarda: sería dejar el texto en claro, o uno que ya nadie abre.
  if (prev && user.plan === 'pro' && prev.text !== text && row.v === kind.v) {
    const last = q('SELECT saved FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT 1').get(user.id, p);
    if (!last || now() - last.saved > 60000) q('INSERT INTO versions (user, path, text, saved, size, e, aad, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, p, seal(prev.text, 'versions.text'), now(), row.size == null ? prev.text.length : row.size, SEALED, row.v ? p : null, row.by || null);
  }
  const rev = row ? row.rev + 1 : 1; const at = now();
  q('INSERT INTO notes (user, path, text, updated, size, e, v, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, path) DO UPDATE SET text = excluded.text, updated = excluded.updated, size = excluded.size, e = excluded.e, v = excluded.v, rev = excluded.rev').run(user.id, p, seal(text, 'notes.text'), at, kind.size, SEALED, kind.v, rev);
  if (row && !row.v && kind.v) scrub();
  if (!row) statOnce(user.id, STAT_BIT.cloud, 'cloud_first');
  const saved = { path: p, updated: at, size: kind.size, rev };
  // prev no viaja en la respuesta: lo usa quien llama para avisar el cambio a los que tienen la nota abierta.
  Object.defineProperty(saved, 'prev', { value: prev ? prev.text : null, enumerable: false });
  autoNoteSaved(user, p, prev ? prev.text : null, text, saved, kind.v); // automatizaciones: eventos de la nota y de sus tarjetas
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
  if (!row.v && !vault) autoEmit(user, 'note.deleted', p, { trash: keep });
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
  if (!kind.v) autoEmit(owner, 'note.restored', to, { rev, size: kind.size });
  return { path: to, from: row.path, updated: at, size: kind.size, rev };
}
function trashRoute(user, p, m, url, body) {
  // En la papelera del equipo: listar, cualquier miembro; restaurar, vaciar y borrar, quien puede escribir.
  const owner = spaceOf(user, url.searchParams.get('o'), m === 'GET' ? 'view' : 'edit');
  const team = owner.id === user.id ? null : user.team;
  if (p === '/trash' && m === 'GET') return trashList(owner);
  if (p === '/trash' && m === 'DELETE') { const removed = Number(q('DELETE FROM trash WHERE user = ?').run(owner.id).changes); if (team && removed) teamLog(team, user, 'empty_trash', ''); return { ok: true, removed }; }
  const tm = /^\/trash\/(\d+)(\/restore)?$/.exec(p);
  if (tm && tm[2] && m === 'POST') { teamHold(user, owner); const r = trashRestore(owner, tm[1], body); if (team) teamLog(team, user, 'restore', r.path); return r; }
  if (tm && !tm[2] && m === 'DELETE') {
    const row = q('SELECT path FROM trash WHERE id = ? AND user = ?').get(+tm[1], owner.id);
    if (!q('DELETE FROM trash WHERE id = ? AND user = ?').run(+tm[1], owner.id).changes) throw new Fail(404, 'not_found');
    if (team) teamLog(team, user, 'purge', row ? row.path : '');
    return { ok: true };
  }
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
  autoNoteMoved(user, from, to);
  return { path: to };
}
// reach(bóveda) da la llave con la que se puede leer esa carpeta, o nada. Sin reach (la búsqueda de la app) las
// notas de las carpetas con contraseña quedan afuera. Con reach (la IA), las de una carpeta bloqueada aparecen
// solo si coincide el nombre, marcadas como bloqueadas y sin texto.
function searchNotes(user, text, reach, aadPre) {
  const needle = String(text || '').toLowerCase(); if (!needle) return [];
  const out = []; const vaults = vaultsOf(user.id);
  // De a una nota: traerlas todas juntas ocuparía en memoria la nube entera de la cuenta.
  for (const n of q('SELECT path, text, e, v FROM notes WHERE user = ?').iterate(user.id)) {
    const vault = vaults.find((x) => inside(n.path, x.folder)); let body = null;
    if (!vault && !n.v) body = unseal(n.text, n.e, 'notes.text');
    else {
      if (!reach) continue;
      const key = vault && n.v ? reach(vault) : null;
      if (key) { try { body = vaultOpen(key, (aadPre || '') + n.path, unseal(n.text, n.e, 'notes.text')); } catch (e) { body = null; } }
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
  // El espacio del equipo: quien administra y quien edita leen, editan, mueven y eliminan sus notas. Quien solo lee
  // entra como a algo compartido para ver.
  if (user.team && user.team.space === ownerId) return teamAllows(user.team, user, 'write') ? 'team' : 'view';
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
  // A quien solo lee en su equipo se le dice eso (read_only), no que no tiene acceso.
  if (!role || (need === 'edit' && role === 'view') || (need === 'owner' && role !== 'owner' && role !== 'team')) throw new Fail(403, role && user.team && user.team.space === ownerId ? 'read_only' : 'no_access');
  return { owner: ownerId === user.id ? user : userById(ownerId), role };
}
function sharedWith(user) {
  const out = []; const seen = new Set();
  for (const s of q('SELECT s.owner, s.path, s.kind, s.role, u.email AS by FROM shares s JOIN users u ON u.id = s.owner WHERE s.email = ?').all(user.email)) {
    // Lo que comparte un equipo sale con el nombre del equipo (su cuenta interna no es un correo). A un miembro no
    // se le repite acá lo que ya ve en el espacio.
    if (s.by.startsWith('team:')) { if (user.team && user.team.space === s.owner) continue; s.by = teamLabel(s.owner); }
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
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan', 'Sharing notes and creating public links are part of the paid plan');
  const p = cleanPath(body.path); const email = cleanEmail(body.email);
  const kind = body.kind === 'folder' ? 'folder' : 'note'; const role = body.role === 'edit' ? 'edit' : 'view';
  if (email === user.email) throw new Fail(400, 'own_email');
  if (vaultsOf(user.id).some((v) => p === v.folder || inside(p, v.folder))) throw new Fail(409, 'vault', 'A folder protected with a password cannot be shared');
  if (kind === 'note' && !q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  if (q('SELECT COUNT(*) AS n FROM shares WHERE owner = ?').get(user.id).n >= MAX_SHARES) throw new Fail(429, 'too_many');
  q('INSERT INTO shares (owner, path, kind, email, role, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner, path, email) DO UPDATE SET role = excluded.role, kind = excluded.kind').run(user.id, p, kind, email, role, now());
  statOnce(user.id, STAT_BIT.shared, 'shared');
  return { ok: true };
}

// Enlace público de solo lectura, con contraseña opcional. La contraseña se guarda con scrypt.
const passHash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
function addLink(user, body) {
  if (!shareAllowed(user)) throw new Fail(402, 'share_needs_plan', 'Sharing notes and creating public links are part of the paid plan');
  const p = cleanPath(body.path);
  if (vaultOf(user.id, p)) throw new Fail(409, 'vault', 'A note in a folder protected with a password cannot have a public link');
  if (!q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(user.id, p)) throw new Fail(404, 'not_found');
  if (q('SELECT COUNT(*) AS n FROM links WHERE owner = ?').get(user.id).n >= MAX_LINKS) throw new Fail(429, 'too_many');
  if (body.password != null && String(body.password).length > 200) throw new Fail(400, 'bad_password');
  const token = random(24); let pass = null;
  if (body.password) { const salt = random(12); pass = salt + ':' + passHash(body.password, salt); }
  const r = q('INSERT INTO links (hash, owner, path, pass, created) VALUES (?, ?, ?, ?, ?)').run(sha(token), user.id, p, pass, now());
  statOnce(user.id, STAT_BIT.shared, 'shared');
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
// Sus nombres visibles, en el mismo orden: los recibe quien ya ve esos correos por tener abierta la misma nota.
const namesIn = (room, who) => who.map((mail) => { const c = Array.from(room).find((x) => x.email === mail); return (c && c.name) || ''; });
function announce(key, event, skip) {
  const room = rooms.get(key); if (!room) return;
  const who = whoIn(room); const names = namesIn(room, who);
  const ai = aiIn(key);
  for (const c of room) if (c !== skip && !c.gid) push(c, Object.assign({ who, names, ai }, event));
}
// ---------- Quién está en la nota: también la IA ----------
// Un agente que lee o escribe una nota con un token (por MCP o por la API) figura como presente un rato después de
// cada llamada sobre esa nota: AI_SEEN_MS desde la última lectura y AI_WROTE_MS desde la última escritura. Sale en
// los mismos avisos de presencia, con kind 'ai', el nombre del token y, si el cliente MCP lo dijo al conectarse
// (clientInfo.name de initialize), el nombre del cliente. Vive en memoria: nada de esto se guarda.
const AI_SEEN_MS = Math.max(1000, +(env.AI_SEEN_MS || 60000)); const AI_WROTE_MS = Math.max(AI_SEEN_MS, +(env.AI_WROTE_MS || 120000));
const AI_WRITING_MS = Math.min(AI_WROTE_MS, Math.max(500, +(env.AI_WRITING_MS || 10000))); // cuánto figura "escribiendo" tras un guardado
const aiRooms = new Map(); // nota → Map(token → { n, name, client, until, writing })
const aiTimers = new Map(); const mcpClients = new Map(); let aiSeq = 0;
function mcpClientSeen(user, params) {
  if (!user || user.tokenId == null) return;
  let name = ''; try { name = cleanName(params && params.clientInfo && params.clientInfo.name); } catch (e) { name = ''; }
  if (mcpClients.size > 5000) mcpClients.clear();
  if (name) mcpClients.set(user.tokenId, name); else mcpClients.delete(user.tokenId);
}
const aiIn = (key) => { const m = aiRooms.get(key); const t = now(); return m ? Array.from(m.values()).filter((x) => x.until > t).map((x) => ({ kind: 'ai', id: 'a' + x.n, token: x.name, client: x.client, writing: x.writing > t })) : []; };
// Avisa a quienes tienen la nota abierta (y a los invitados de su sesión en vivo, si hay una).
function aiTell(key) {
  if (!rooms.has(key)) return;
  announce(key, { type: 'presence' });
  const i = key.indexOf(':'); const row = liveRow(+key.slice(0, i), key.slice(i + 1)); if (row) tellLive(row);
}
// Saca a las que ya vencieron y deja el reloj puesto para el próximo cambio (deja de escribir, o se va).
function aiSweep(key) {
  clearTimeout(aiTimers.get(key)); aiTimers.delete(key);
  const m = aiRooms.get(key); if (!m) return;
  const t = now(); let next = Infinity;
  for (const [id, x] of m) { if (x.until <= t) m.delete(id); else next = Math.min(next, x.until, x.writing > t ? x.writing : Infinity); }
  if (!m.size) { aiRooms.delete(key); return; }
  const timer = setTimeout(() => { aiSweep(key); aiTell(key); }, Math.max(30, next - t + 15)); timer.unref(); aiTimers.set(key, timer);
}
function aiTouch(user, ownerId, p, wrote) {
  if (!user || user.tokenId == null) return;
  const key = roomKey(ownerId, p);
  let m = aiRooms.get(key);
  if (!m) { if (aiRooms.size >= 20000) return; m = new Map(); aiRooms.set(key, m); }
  let x = m.get(user.tokenId); if (!x) { x = { n: ++aiSeq, until: 0, writing: 0 }; m.set(user.tokenId, x); }
  x.name = String(user.tokenName || '').slice(0, 60); x.client = mcpClients.get(user.tokenId) || '';
  x.until = Math.max(x.until, now() + (wrote ? AI_WROTE_MS : AI_SEEN_MS)); if (wrote) x.writing = now() + AI_WRITING_MS;
  aiSweep(key); aiTell(key);
}
// Quién hizo el último guardado, en palabras. Para una cuenta, su nombre visible; a un invitado de una sesión en
// vivo solo le llega el que esa cuenta eligió (vacío si no eligió ninguno), nunca algo sacado de su correo.
// outside: quien pregunta ve la nota porque se la compartieron y no es parte de su sesión en vivo: de un invitado
// sabe que fue un invitado, sin su nombre (tampoco recibe la lista de quiénes están en la sesión).
function editedBy(by, forGuest, outside) {
  if (!by || typeof by !== 'string') return null;
  const v = by.slice(2);
  if (by[0] === 'u') { const u = q('SELECT name, email FROM users WHERE id = ?').get(+v); return u ? { kind: 'user', name: forGuest ? u.name || '' : nameOf(u) } : null; }
  if (by[0] === 't') { const t = q('SELECT name FROM tokens WHERE id = ?').get(+v); return { kind: 'ai', name: t ? t.name : '' }; }
  if (by[0] === 'g') return { kind: 'guest', name: outside ? '' : v };
  return null;
}
const noteEdited = (ownerId, p, forGuest, outside) => { const r = q('SELECT by FROM notes WHERE user = ? AND path = ?').get(ownerId, p); return r ? editedBy(r.by, forGuest, outside) : null; };
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
// who.ed: quién guardó, como se anota en la nota ('u:12', 't:5', 'g:Ana'); sin eso la nota queda sin autor.
function tellSaved(ownerId, p, saved, who, text) {
  q('UPDATE notes SET by = ? WHERE user = ? AND path = ?').run(who.ed || null, ownerId, p);
  const edited = who.ed ? [editedBy(who.ed, false), editedBy(who.ed, true), editedBy(who.ed, false, true)] : [null, null, null];
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
    const member = !!live && (c.gid ? c.live === live.id : !!c.lm);
    if (c.gid && !member) continue;
    const ev = c.gid ? { type: 'saved', pid, updated: saved.updated, rev: saved.rev } : { who: list, type: 'saved', by: who.by, updated: saved.updated, rev: saved.rev, pid };
    const by = edited[c.gid ? 1 : c.lm ? 0 : 2]; if (by) ev.edited = by;
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
  // lm: es de la sesión en vivo de esa nota sin haber entrado por el enlace (la nota es suya, o es de su equipo).
  const lm = owner.id === user.id || (!!user.team && user.team.space === owner.id);
  const client = { res, email: user.email, uid: user.id, name: nameOf(user), lm, shown: user.name || '', admin: owner.id !== user.id && teamRoleOf(user) === 'admin' };
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(client);
  announce(key, { type: 'presence' });
  // Si la nota tiene una sesión en vivo y quien entra es quien la abrió, o un miembro del equipo, recibe quiénes están.
  const session = lm ? liveRow(owner.id, p) : null;
  if (session) { push(client, liveEvent(session, client, livePeople(session))); tellLive(session); }
  const beat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 25000);
  req.on('close', () => {
    clearInterval(beat); mine.forEach((k) => liveAdd(k, -1));
    const room = rooms.get(key); if (room) { room.delete(client); if (!room.size) rooms.delete(key); else announce(key, { type: 'presence' }); }
    if (lm) { const now_ = liveRow(owner.id, p); if (now_) { liveTouch(now_); tellLive(now_); } }
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
const MAX_TEAM_LIVES = 10; // sesiones abiertas a la vez en el espacio de un equipo
const LIVE_TEAM_HOUR = 120; // abrir, cambiar el enlace, sacar y terminar: por hora y por equipo
db.exec('CREATE TABLE IF NOT EXISTS lives (id INTEGER PRIMARY KEY, hash TEXT UNIQUE NOT NULL, owner INTEGER NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, UNIQUE (owner, path))');
// owner es de quién es la nota: una cuenta, o la cuenta interna del espacio de un equipo. opener, quién abrió la
// sesión cuando la nota es de un equipo (un miembro); en una nota propia queda vacío: la abrió su dueño.
try { db.exec('ALTER TABLE lives ADD COLUMN opener INTEGER'); } catch (e) { /* ya estaba */ }
// Quien ya entró guarda una contraseña de reingreso propia (acá, su hash): si su pase se pierde (el servidor se
// reinició, o estuvo un rato largo sin conexión) vuelve a entrar con ella aunque el enlace haya cambiado mientras
// tanto. Se borra al sacarlo, al salir por su cuenta y al cerrar la sesión.
db.exec('CREATE TABLE IF NOT EXISTS live_tickets (hash TEXT PRIMARY KEY, live INTEGER NOT NULL, created INTEGER NOT NULL)');
db.exec('DELETE FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)');
const liveAllowed = (user) => user.plan === 'pro' || !!env.LIVE_FREE;
const teamBySpace = (spaceId) => q('SELECT * FROM teams WHERE space = ?').get(spaceId) || null;
// ¿La sesión puede seguir? La de una nota propia, mientras su dueño tenga el plan. La de una nota de un equipo,
// mientras el equipo esté al día y sin contraseña, y quien la abrió siga adentro, pueda editar y tenga permitido
// invitar gente de afuera (quien administra, siempre; los demás, si la política live está prendida).
function liveCan(row) {
  if (!row.opener) { const o = userById(row.owner); return !!o && liveAllowed(o); }
  const t = teamBySpace(row.owner); const u = userById(row.opener);
  return !!t && t.status === 'active' && !!u && !!u.team && u.team.id === t.id && teamAllows(u.team, u, 'write') && teamAllows(u.team, u, 'live') && !teamVault(t);
}
// Cambió algo en el equipo (un papel, una política, alguien salió, se cayó el cobro): las sesiones que ya no pueden
// seguir terminan en el acto.
function liveTeamSweep(t) { if (t) for (const row of q('SELECT * FROM lives WHERE owner = ?').all(t.space)) if (!liveCan(row)) liveEnd(row, 'closed'); }
// En una sesión en vivo, el rechazo por revisión dice además quién hizo el guardado que quedó (su número dentro
// de la sesión, nunca un correo): así al otro se le puede avisar con nombre.
function liveWrite(owner, p, text, rev) {
  try { return writeNote(owner, p, text, rev); }
  catch (e) {
    if (e instanceof Fail && e.code === 'rev_conflict') { const row = liveRow(owner.id, p); const last = row && memOf(row).last; if (last && last.rev === e.extra.rev) e.extra.pid = last.pid; }
    throw e;
  }
}
const liveMem = new Map(); // id de la sesión → { guests: Map(id → invitado), owner: { block, editing, timer }, members: Map(cuenta → lugar), seq, mseq, tick }
const passes = new Map(); // hash del pase → { live, gid }
const memOf = (row) => { let m = liveMem.get(row.id); if (!m) { m = { guests: new Map(), owner: { block: null, editing: false, timer: null }, members: new Map(), seq: 0, mseq: 0, tick: null }; liveMem.set(row.id, m); } return m; };
const liveOpener = (row) => row.opener || row.owner;
// Un color que nadie de la sesión esté usando (el 0 es de quien la abrió).
function liveColor(m) {
  const used = new Set(Array.from(m.guests.values()).concat(Array.from(m.members.values())).map((x) => x.color));
  let color = 1; while (used.has(color) && color < LIVE_COLORS - 1) color++;
  return color;
}
// El lugar de una cuenta en la sesión: el de quien la abrió, o el de otro miembro del equipo que tiene la nota
// abierta. Un miembro no entra por el enlace ni ocupa el lugar de un invitado: figura mientras tenga la nota abierta.
function liveSeat(row, uid) {
  const m = memOf(row);
  if (uid === liveOpener(row)) return m.owner;
  let s = m.members.get(uid);
  if (!s) { s = { n: ++m.mseq, color: liveColor(m), block: null, editing: false, timer: null }; m.members.set(uid, s); }
  return s;
}
// Quién es dentro de la sesión: 'o' quien la abrió, 'm2' otro miembro del equipo. Nunca un número de cuenta.
const livePid = (row, uid) => (uid === liveOpener(row) ? 'o' : 'm' + liveSeat(row, uid).n);
const liveRoom = (row) => rooms.get(roomKey(row.owner, row.path)) || new Set();
const liveMembers = (row) => Array.from(liveRoom(row)).filter((c) => (c.gid ? c.live === row.id : !!c.lm));
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
  const opener = liveOpener(row);
  const here = Array.from(room).some((c) => !c.gid && c.uid === opener);
  const out = [{ id: 'o', name: row.name, color: 0, block: here ? m.owner.block : null, editing: here && m.owner.editing, here }];
  if (row.opener) {
    // Los demás miembros del equipo que tienen la nota abierta, con el nombre visible que eligieron (nunca el correo:
    // sin nombre elegido viaja vacío y la app dice "miembro del equipo").
    const open = new Map(); for (const c of room) if (!c.gid && c.lm && c.uid !== opener) open.set(c.uid, c.shown || '');
    for (const [uid, s] of Array.from(m.members)) if (!open.has(uid)) { clearTimeout(s.timer); m.members.delete(uid); }
    for (const [uid, name] of open) { const s = liveSeat(row, uid); out.push({ id: 'm' + s.n, name, color: s.color, block: s.block, editing: s.editing, here: true, member: true }); }
  }
  for (const g of m.guests.values()) out.push({ id: 'g' + g.id, name: g.name, color: g.color, block: g.conns ? g.block : null, editing: !!g.conns && g.editing, here: g.conns > 0 });
  return out;
}
// who: la cuenta que pregunta. En una nota de un equipo se le dice además quién es ahí adentro (you) y si la maneja
// (can: quien la abrió y quien administra el equipo cambian el enlace, sacan a un invitado y la terminan).
const liveView = (row, who) => Object.assign({ open: true, name: row.name, created: row.created, max: LIVE_PEOPLE, people: livePeople(row) },
  row.opener && who ? { team: true, you: livePid(row, who.id), can: who.id === row.opener || teamRoleOf(who) === 'admin' } : {});
const liveEvent = (row, c, people) => Object.assign({ type: 'live', open: true, people, ai: aiIn(roomKey(row.owner, row.path)) }, row.opener && !c.gid ? { team: true, you: livePid(row, c.uid), can: c.uid === row.opener || !!c.admin } : {});
// Quiénes están y en qué bloque, a todos los de la sesión. Junta los cambios de un instante en un solo aviso.
function tellLive(row) {
  const m = memOf(row); if (m.tick) return;
  m.tick = setTimeout(() => {
    m.tick = null;
    if (!liveMem.has(row.id)) return;
    const people = livePeople(row);
    for (const c of liveMembers(row)) push(c, liveEvent(row, c, people));
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
// by: quién la terminó, si fue alguien. En una nota de un equipo queda en el registro de actividad.
function liveEnd(row, why, by) {
  if (!q('DELETE FROM lives WHERE id = ?').run(row.id).changes) return;
  if (row.opener) teamLog(teamBySpace(row.owner), by || { auto: true }, 'live_end', row.path);
  q('DELETE FROM live_tickets WHERE live = ?').run(row.id);
  const m = liveMem.get(row.id);
  if (m) { clearTimeout(m.tick); clearTimeout(m.owner.timer); for (const s of m.members.values()) clearTimeout(s.timer); for (const g of Array.from(m.guests.values())) dropGuest(row, g, why); liveMem.delete(row.id); }
  for (const c of liveRoom(row)) if (!c.gid && c.lm) push(c, { type: 'live', open: false, why });
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
  if (row && (liveStale(row) || !owner || !liveCan(row))) liveEnd(row, liveStale(row) ? 'expired' : 'closed');
  else if (row) return { row, owner };
  // El mismo aviso para un secreto que nunca existió y para una sesión que ya terminó. Veinte fallos por hora por red.
  mark('lbad:' + ip);
  throw new Fail(404, 'live_gone');
}
const noteName = (p) => p.split('/').pop();

// Con o, la nota es del espacio del equipo de quien llama: la abre un miembro que puede editar, si quien administra
// lo permitió (política live), y nunca en un espacio protegido con contraseña (un invitado no tiene la llave).
function liveOpen(user, body) {
  const owner = spaceOf(user, body.o, 'edit'); const team = owner.id !== user.id ? user.team : null;
  if (team) {
    if (team.status !== 'active') throw new Fail(402, 'live_needs_plan');
    if (!teamAllows(team, user, 'live')) throw new Fail(403, 'team_policy', 'The administrator of the team has not allowed members to open live sessions with guests');
    if (teamVault(team)) throw new Fail(409, 'live_vault', 'A team space protected with a password has no live sessions with guests');
    rate('lteam:' + team.id, LIVE_TEAM_HOUR, HOUR, 'too_many');
  } else if (!liveAllowed(user)) throw new Fail(402, 'live_needs_plan');
  const p = cleanPath(body.path); const name = cleanName(body.name);
  const n = q('SELECT v FROM notes WHERE user = ? AND path = ?').get(owner.id, p);
  if (!n) throw new Fail(404, 'not_found');
  // El servidor aplica y reparte los cambios: una nota cifrada desde el navegador no la puede leer.
  if (n.v || vaultOf(owner.id, p)) throw new Fail(409, 'live_vault', 'A note in a folder protected with a password cannot be edited live');
  let row = liveRow(owner.id, p);
  if (row && !liveCan(row)) { liveEnd(row, 'closed'); row = null; }
  if (row) {
    // Ya estaba abierta: el enlace no se vuelve a dar (solo se guarda su hash). Para uno nuevo está /live/rotate.
    // En un equipo, el nombre con que figura la sesión lo cambia solo quien la abrió.
    if (liveOpener(row) === user.id) {
      const taken = Array.from(memOf(row).guests.values()).map((g) => g.name);
      row.name = freeName(name, taken); q('UPDATE lives SET name = ? WHERE id = ?').run(row.name, row.id);
      tellLive(row);
    }
    return liveView(row, user);
  }
  if (q('SELECT COUNT(*) AS n FROM lives WHERE owner = ?').get(owner.id).n >= (team ? MAX_TEAM_LIVES : MAX_LIVES)) throw new Fail(429, team ? 'live_team_max' : 'too_many', '', team ? { max: MAX_TEAM_LIVES } : undefined);
  const secret = random(32);
  q('INSERT INTO lives (hash, owner, path, name, created, seen, opener) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha(secret), owner.id, p, name, now(), now(), team ? user.id : null);
  row = q('SELECT * FROM lives WHERE owner = ? AND path = ?').get(owner.id, p);
  if (team) teamLog(team, user, 'live_open', p);
  tellLive(row);
  return Object.assign(liveView(row, user), { secret });
}
function liveRotate(row) {
  const secret = random(32);
  q('UPDATE lives SET hash = ? WHERE id = ?').run(sha(secret), row.id);
  return secret;
}
function liveKick(row, id, by) {
  // Solo a un invitado: un miembro del equipo no entró por el enlace, y se lo saca del equipo, no de la sesión.
  const g = /^g\d+$/.test(String(id || '')) ? memOf(row).guests.get(+String(id).slice(1)) : null;
  if (!g) throw new Fail(404, 'not_found');
  dropGuest(row, g, 'kicked', true);
  if (row.opener) teamLog(teamBySpace(row.owner), by, 'live_kick', row.path, g.name);
  const secret = liveRotate(row);
  tellLive(row);
  return Object.assign(liveView(row, by), { secret });
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
  const color = liveColor(m);
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
  return Object.assign({ pass, you: 'g' + id, name: g.name, color: g.color, by: row.name, max: LIVE_PEOPLE, note: { name: noteName(row.path), text: n.text, rev: n.rev, updated: n.updated, edited: noteEdited(owner.id, row.path, true) }, people: livePeople(row) }, back ? {} : { ticket });
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
  if (!liveCan(row)) { liveEnd(row, 'closed'); throw new Fail(401, 'bad_auth'); }
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
  if (p === '/live/note' && m === 'GET') { const n = readNote(owner, row.path); return { name: noteName(row.path), text: n.text, rev: n.rev, updated: n.updated, edited: noteEdited(owner.id, row.path, true) }; }
  if (p === '/live/note' && m === 'PUT') {
    rate('lsave:' + g.hash, 300, 60000, 'too_many');
    const body = await readBody(req); const rev = cleanRev(body.rev);
    // Un invitado guarda siempre sobre una revisión: nunca pisa a ciegas.
    if (rev == null) throw new Fail(400, 'rev_required');
    const text = String(body.text == null ? '' : body.text);
    const saved = liveWrite(owner, row.path, text, rev);
    tellSaved(owner.id, row.path, saved, { by: 'guest', pid: 'g' + g.id, ed: 'g:' + g.name }, text);
    // En una nota de un equipo, lo que guarda un invitado queda en el registro como una edición, con su nombre.
    if (row.opener) teamLog(teamBySpace(row.owner), { guest: g.name }, 'edit', row.path);
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
  const p = cleanPath(body.path);
  // Un comentario cita el texto de la nota: en una carpeta con contraseña quedaría en claro en el servidor.
  if (vaultOf(user.id, p)) throw new Fail(409, 'vault', 'Notes in a folder protected with a password do not take comments for the AI');
  readNote(user, p);
  const text = String(body.text == null ? '' : body.text).trim(); const quote = String(body.quote == null ? '' : body.quote).trim().slice(0, 2000);
  if (!text || text.length > 2000) throw new Fail(400, 'bad_text');
  if (q("SELECT COUNT(*) AS n FROM comments WHERE user = ? AND status = 'open'").get(user.id).n >= 200) throw new Fail(429, 'too_many');
  const r = q('INSERT INTO comments (user, path, quote, text, created, e) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, p, seal(quote, 'comments.quote'), seal(text, 'comments.text'), now(), SEALED);
  autoEmit(user, 'comment.created', p, { comment: { id: Number(r.lastInsertRowid), text, quote: quote.slice(0, 280) } });
  return { id: Number(r.lastInsertRowid), path: p, quote, text, status: 'open', created: now() };
}
const listComments = (user, p, all) => q('SELECT id, path, quote, text, status, reply, created, done, e FROM comments WHERE user = ?' + (p ? ' AND path = ?' : '') + (all ? '' : " AND status = 'open'") + ' ORDER BY created').all(...(p ? [user.id, cleanPath(p)] : [user.id]))
  .map((c) => ({ id: c.id, path: c.path, quote: unseal(c.quote, c.e, 'comments.quote'), text: unseal(c.text, c.e, 'comments.text'), status: c.status, reply: unseal(c.reply, c.e, 'comments.reply'), created: c.created, done: c.done }));

// Un token puede estar limitado a una carpeta: fuera de ella no ve ni escribe nada.
const within = (user, p) => !user.scope || p === user.scope || p.startsWith(user.scope + '/');
function scoped(user, p) { p = cleanPath(p); if (!within(user, p)) throw new Fail(403, 'out_of_scope', 'This token only reaches the folder ' + user.scope + '/'); return p; }
const inFolder = (p, folder) => !folder || p.startsWith(folder.replace(/\/+$/, '') + '/');

// ---------- Unir en vez de pisar ----------
// Una IA que manda una nota entera la escribió sobre la versión que leyó. Si la persona cambió la nota mientras
// tanto (tildó una tarea, corrigió un renglón), se unen las dos ediciones por líneas sobre esa versión común, con
// las mismas reglas que usa la app (src/merge.js): el tramo que sigue es copia de aquel.
// merge3:begin (el mismo tramo está en server/server.mjs: tests/merge.mjs comprueba que no se separen)
// Qué cambió x respecto de b, como tramos sobre las líneas de b: [{ s, e, lines }] (de s a e pasan a ser lines).
// Camino más corto de Myers, con tope de trabajo: si las diferencias son demasiadas va todo el medio como un solo
// tramo (coarse), y quien une lo trata como un choque en vez de quedarse pensando.
function mergeDiff(b, x) {
  const nb = b.length; const nx = x.length;
  let s = 0; while (s < nb && s < nx && b[s] === x[s]) s++;
  let t = 0; while (t < nb - s && t < nx - s && b[nb - 1 - t] === x[nx - 1 - t]) t++;
  const N = nb - s - t; const M = nx - s - t;
  if (!N && !M) return [];
  const whole = [{ s, e: nb - t, lines: x.slice(s, nx - t) }];
  if (!N || !M) return whole;
  const max = Math.min(N + M, 2000, Math.max(8, Math.floor(40000000 / (N + M))));
  const off = max + 1; const V = new Int32Array(2 * max + 3); const trace = []; let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let j = i - k;
      while (i < N && j < M && b[s + i] === x[s + j]) { i++; j++; }
      V[off + k] = i;
      if (i >= N && j >= M) { found = d; break; }
    }
    trace.push(V.slice(off - d - 1, off + d + 2));
  }
  if (found < 0) { whole.coarse = true; return whole; }
  // De atrás para adelante: qué líneas de b se fueron y cuáles de x entraron.
  const del = new Uint8Array(N); const ins = new Uint8Array(M); let i = N; let j = M;
  for (let d = found; d > 0; d--) {
    const P = trace[d - 1]; const k = i - j; const at = (q) => P[q + d];
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const pi = at(pk); const pj = pi - pk;
    if (pk === k + 1) ins[pj] = 1; else del[pi] = 1;
    i = pi; j = pj;
  }
  const out = []; let cur = null; i = 0; j = 0;
  while (i < N || j < M) {
    if (i < N && j < M && !del[i] && !ins[j]) { cur = null; i++; j++; continue; }
    if (!cur) { cur = { s: s + i, e: s + i, lines: [] }; out.push(cur); }
    if (i < N && del[i]) { i++; cur.e = s + i; } else { cur.lines.push(x[s + j]); j++; }
  }
  return out;
}
// Una línea de tarea, partida en lo que va antes de la casilla, la casilla y lo que sigue. null si no es una tarea.
function mergeTask(line) {
  const m = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s.*)?)$/.exec(line);
  return m ? { pre: m[1], box: m[2], post: m[3], text: m[1] + m[3], done: m[2] !== ' ' } : null;
}
// Unión de tres vías por líneas: base es el texto común, mine lo de acá y theirs lo de afuera.
// Devuelve { clean, text, conflicts, ticked, coarse, resolve }:
//   clean     no quedó nada por decidir, y text es el resultado.
//   conflicts los tramos que los dos cambiaron distinto: [{ base, mine, theirs }], cada uno el texto de ese tramo.
//   ticked    en cuántas tareas los dos dejaron la casilla distinta sin una base que desempate: quedó tildada.
//   resolve   (qué) arma el texto con los choques resueltos: 'mine', 'theirs' o 'both' (lo de acá, una línea en
//             blanco y lo de afuera, sin marcas), uno para todos o una lista con uno por tramo.
// Reglas: lo que cambió un solo lado entra. En una tarea, la casilla y el texto se unen por separado: si uno
// tildó y el otro cambió el texto quedan las dos cosas. El resultado sale con los saltos de línea de mine.
function mergeThree(base, mine, theirs) {
  base = String(base == null ? '' : base); mine = String(mine == null ? '' : mine); theirs = String(theirs == null ? '' : theirs);
  const lf = (v) => (v.indexOf('\r') === -1 ? v : v.replace(/\r\n/g, '\n'));
  const done = (text) => ({ clean: true, text, conflicts: [], ticked: 0, coarse: false, resolve: () => text });
  const B = lf(base); const Mi = lf(mine); const Th = lf(theirs);
  if (Mi === B || Mi === Th) return done(theirs);
  if (Th === B) return done(mine);
  const eol = mine.indexOf('\r\n') !== -1 || (mine.indexOf('\n') === -1 && theirs.indexOf('\r\n') !== -1) ? '\r\n' : '\n';
  // El salto del final del archivo no es una línea: se une aparte, como una casilla.
  const end = (v) => v.endsWith('\n'); const body = (v) => (end(v) ? v.slice(0, -1) : v);
  const tail = end(Mi) === end(Th) || end(Th) === end(B) ? end(Mi) : end(Th);
  const b = body(B).split('\n'); const m = body(Mi).split('\n'); const t = body(Th).split('\n');
  const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
  // Un reemplazo de n líneas por n líneas se mira renglón por renglón: así dos cambios en renglones vecinos no chocan.
  const fine = (H) => { if (H.coarse) return H; const out = []; for (const h of H) { if (h.e - h.s !== h.lines.length || h.e - h.s < 2) { out.push(h); continue; } for (let k = 0; k < h.lines.length; k++) if (b[h.s + k] !== h.lines[k]) out.push({ s: h.s + k, e: h.s + k + 1, lines: [h.lines[k]] }); } return out; };
  const Am = mergeDiff(b, m); const Ct = mergeDiff(b, t); const A = fine(Am); const C = fine(Ct);
  let ticked = 0;
  const words = (v) => new Set(v.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  // Dos tareas que dicen casi lo mismo: comparten al menos la mitad de las palabras.
  const near = (x, y) => { const p = words(x); const r = words(y); let n = 0; for (const w of p) if (r.has(w)) n++; const all = p.size + r.size - n; return all > 0 && n / all >= 0.5; };
  // Una línea que los dos cambiaron. En una tarea se unen aparte el texto y la casilla; si no, null (choque).
  const line = (bl, ml, tl) => {
    if (ml === tl) return ml;
    const tm = mergeTask(ml); const tt = mergeTask(tl); const tb = bl == null ? null : mergeTask(bl);
    if (!tm || !tt) return null;
    let from = null;
    if (tm.text === tt.text) from = tm; else if (tb && tm.text === tb.text) from = tt; else if (tb && tt.text === tb.text) from = tm;
    if (!from) return null;
    let box;
    if (tm.done === tt.done) box = from.box; else if (tb && tm.done === tb.done) box = tt.box; else if (tb && tt.done === tb.done) box = tm.box;
    else { box = tm.done ? tm.box : tt.box; ticked++; }
    return from.pre + box + from.post;
  };
  // X cambió solo casillas respecto de la base (las mismas líneas, con otra casilla): esos tildes se llevan a Y,
  // que cambió otra cosa. Cada tarea se busca en Y por su lugar o por su texto. null si alguna no aparece.
  const boxOnly = (bs, xs) => bs.length === xs.length && bs.every((l, k) => { if (l === xs[k]) return true; const p = mergeTask(l); const r = mergeTask(xs[k]); return !!p && !!r && p.text === r.text; });
  // Si en el tramo no está porque Y la mudó a otra parte, vale cuando esa tarea es una sola en la base y en todo
  // el texto de Y (all): el tilde se le pone al final, donde haya quedado (moved).
  const moved = [];
  const once = (list, text) => { let n = 0; for (const l of list) { const q = mergeTask(l); if (q && q.text === text) n++; } return n === 1; };
  const carry = (bs, xs, ys, all) => {
    const H = mergeDiff(bs, ys); if (H.coarse) return null;
    const res = ys.slice(); const used = new Set(); const far = [];
    for (let k = 0; k < bs.length; k++) {
      if (bs[k] === xs[k]) continue;
      const tb = mergeTask(bs[k]); const tx = mergeTask(xs[k]); let shift = 0; let hit = -1; let inside = null;
      for (const h of H) { if (h.e <= k) shift += h.lines.length - (h.e - h.s); else if (h.s <= k) { inside = h; break; } else break; }
      if (!inside) hit = k + shift;
      else {
        const y0 = inside.s + shift; const cand = []; for (let n = 0; n < inside.lines.length; n++) { const ty = mergeTask(inside.lines[n]); if (ty) cand.push({ at: y0 + n, ty, n }); }
        const here = inside.e - inside.s === inside.lines.length ? cand.find((c) => c.n === k - inside.s) : null;
        const exact = cand.filter((c) => c.ty.text === tb.text); const close = cand.filter((c) => near(c.ty.text, tb.text));
        if (here && (here.ty.text === tb.text || near(here.ty.text, tb.text))) hit = here.at; else if (exact.length === 1) hit = exact[0].at; else if (!exact.length && close.length === 1) hit = close[0].at;
      }
      const ty = hit < 0 ? null : mergeTask(res[hit]);
      if (!ty && once(b, tb.text) && once(all, tb.text)) { far.push({ text: tb.text, was: tb.done, box: tx.box }); continue; }
      if (!ty || used.has(hit)) return null;
      used.add(hit);
      if (ty.done === tb.done) res[hit] = ty.pre + tx.box + ty.post;
    }
    for (const f of far) moved.push(f);
    return res;
  };
  // Un tramo que los dos tocaron: las líneas de la base, lo de acá y lo de afuera. Devuelve las líneas unidas, o null.
  const region = (bs, ms, ts) => {
    if (same(ms, ts)) return ms;
    if (bs.length === ms.length && bs.length === ts.length) {
      const keep = ticked; const out = [];
      for (let k = 0; k < bs.length; k++) { const l = ms[k] === bs[k] ? ts[k] : ts[k] === bs[k] ? ms[k] : line(bs[k], ms[k], ts[k]); if (l == null) { out.length = 0; break; } out.push(l); }
      if (out.length === bs.length && bs.length) return out;
      ticked = keep;
    }
    if (boxOnly(bs, ms)) { const r = carry(bs, ms, ts, t); if (r) return r; }
    if (boxOnly(bs, ts)) { const r = carry(bs, ts, ms, m); if (r) return r; }
    return null;
  };
  // Los dos agregaron en el mismo lugar: si uno contiene lo del otro al principio o al final, va una sola vez; la
  // misma tarea con la casilla distinta queda tildada; si no, primero lo de acá y después lo de afuera.
  const both = (ms, ts) => {
    const starts = (x, y) => y.length <= x.length && y.every((l, k) => l === x[k]); const ends = (x, y) => y.length <= x.length && y.every((l, k) => l === x[x.length - y.length + k]);
    if (starts(ms, ts) || ends(ms, ts)) return ms;
    if (starts(ts, ms) || ends(ts, ms)) return ts;
    if (ms.length === ts.length) { const keep = ticked; const out = ms.map((l, k) => line(null, l, ts[k])); if (out.every((l) => l != null)) return out; ticked = keep; }
    return ms.concat(ts);
  };
  const parts = []; let pos = 0; let i = 0; let j = 0;
  const put = (lines) => { const last = parts[parts.length - 1]; if (Array.isArray(last)) { for (const l of lines) last.push(l); } else parts.push(lines.slice()); };
  const take = (h, lines) => { put(b.slice(pos, h.s)); put(lines || h.lines); pos = h.e; };
  const side = (list, gs, ge) => { const o = []; let p = gs; for (const h of list) { for (let k = p; k < h.s; k++) o.push(b[k]); for (const l of h.lines) o.push(l); p = h.e; } for (let k = p; k < ge; k++) o.push(b[k]); return o; };
  while (i < A.length || j < C.length) {
    const a = A[i]; const c = C[j];
    if (!c) { take(a); i++; continue; }
    if (!a) { take(c); j++; continue; }
    if (a.s === a.e && c.s === c.e && a.s === c.s) { take(a, both(a.lines, c.lines)); i++; j++; continue; }
    if (a.e <= c.s) { take(a); i++; continue; }
    if (c.e <= a.s) { take(c); j++; continue; }
    // Se pisan: se junta todo lo que se encadena con ese tramo, de un lado y del otro.
    const gs = Math.min(a.s, c.s); let ge = Math.max(a.e, c.e); const ga = []; const gc = [];
    for (;;) {
      if (i < A.length && A[i].s < ge) { ge = Math.max(ge, A[i].e); ga.push(A[i++]); }
      else if (j < C.length && C[j].s < ge) { ge = Math.max(ge, C[j].e); gc.push(C[j++]); }
      else break;
    }
    const bs = b.slice(gs, ge); const ms = side(ga, gs, ge); const ts = side(gc, gs, ge);
    const r = region(bs, ms, ts);
    put(b.slice(pos, gs)); pos = ge;
    if (r) put(r); else parts.push({ base: bs, mine: ms, theirs: ts });
  }
  put(b.slice(pos));
  // Los tildes de las tareas mudadas, ya con todo en su lugar.
  const settle = (lines) => { for (let k = 0; k < lines.length; k++) { const q = mergeTask(lines[k]); if (!q) continue; const f = moved.find((x) => x.text === q.text && x.was === q.done); if (f) lines[k] = q.pre + f.box + q.post; } };
  if (moved.length) for (const p of parts) { if (Array.isArray(p)) settle(p); else { settle(p.mine); settle(p.theirs); } }
  const open = parts.filter((p) => !Array.isArray(p));
  const resolve = (how) => {
    const out = []; let n = 0;
    for (const p of parts) {
      if (Array.isArray(p)) { for (const l of p) out.push(l); continue; }
      const pick = (Array.isArray(how) ? how[n] : how) || 'both'; n++;
      const lines = pick === 'mine' ? p.mine : pick === 'theirs' ? p.theirs : p.mine.concat(p.mine.length && p.theirs.length ? [''] : [], p.theirs);
      for (const l of lines) out.push(l);
    }
    return out.join(eol) + (tail ? eol : '');
  };
  return { clean: !open.length, text: open.length ? null : resolve(), conflicts: open.map((p) => ({ base: p.base.join('\n'), mine: p.mine.join('\n'), theirs: p.theirs.join('\n') })), ticked, coarse: !!(Am.coarse || Ct.coarse), resolve };
}
// merge3:end
// Lo último que cada token leyó o escribió de cada nota: su revisión y su texto. Es la base de esa unión. Vive en
// memoria y con tope; si falta, a la IA le vuelve el texto de ahora para que una ella. El texto de una nota de una
// carpeta con contraseña no se guarda acá: solo su revisión.
const AI_READS_MAX = 2000; const AI_READS_CHARS = 48 * 1024 * 1024; const aiReads = new Map(); let aiReadsChars = 0;
function aiReadSet(user, ownerId, p, rev, text) {
  if (!user || user.tokenId == null) return;
  const key = user.tokenId + '|' + ownerId + ':' + p; const old = aiReads.get(key);
  if (old) { aiReadsChars -= old.text == null ? 0 : old.text.length; aiReads.delete(key); }
  aiReads.set(key, { rev, text }); aiReadsChars += text == null ? 0 : text.length;
  for (const [k, v] of aiReads) { if (aiReads.size <= AI_READS_MAX && aiReadsChars <= AI_READS_CHARS) break; aiReads.delete(k); aiReadsChars -= v.text == null ? 0 : v.text.length; }
}
const aiReadGet = (user, ownerId, p) => (user && user.tokenId != null ? aiReads.get(user.tokenId + '|' + ownerId + ':' + p) || null : null);
// Una respuesta del MCP en varios bloques de texto: el primero es el contenido, los demás lo que hay que saber de él.
class Parts { constructor(list) { this.list = list; } }
// Las tareas de una nota (- [ ] y - [x]) fuera de los bloques de código: las tarjetas de un tablero no cuentan.
function taskLines(lines) {
  const out = []; let fence = '';
  lines.forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = ''; return; }
    if (fence) return;
    const t = mergeTask(l); if (t) out.push({ i, t, label: t.post.slice(1).replace(/\s+/g, ' ').trim() });
  });
  return out;
}

// ---------- MCP (Streamable HTTP, respuestas JSON) ----------
const TOOLS = [
  { name: 'list_notes', description: 'List the Markdown notes in the SharpMD cloud folder, newest first. Pass a folder to list only what is inside it. On the free plan the answer ends with how many notes the plan holds and how many are left.', inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Optional folder, for example projects/launch' } } } },
  { name: 'list_folders', description: 'List the folders that hold notes, with how many notes each one has. A top-level folder is usually a project.', inputSchema: { type: 'object', properties: {} } },
  { name: 'read_note', description: 'Read one note by its path. The answer ends with the version of the note: pass it as base_rev when you replace the note with write_note.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of the note, for example ideas/launch.md' } }, required: ['path'] } },
  { name: 'write_note', description: 'Create a note or replace its whole content with Markdown text. To change part of an existing note, prefer edit_note, set_task or append_note. When you replace a note, pass base_rev with the version read_note gave you: if the person changed the note in the meantime, their changes are merged with yours instead of being overwritten, and if both changed the same lines nothing is saved and you get the current text back.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string', description: 'Full Markdown content' }, base_rev: { type: 'number', description: 'Optional: the version of the note your text is based on, from read_note' } }, required: ['path', 'text'] } },
  { name: 'append_note', description: 'Append Markdown text to the end of a note, creating it if it does not exist.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] } },
  { name: 'edit_note', description: 'Replace one exact passage of a note with new text, without sending the whole note. old_text must appear exactly once in the note: copy it as it is written, with enough of the text around it to be unique. Everything else in the note stays as the person left it.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string', description: 'The exact passage to replace' }, new_text: { type: 'string', description: 'What goes in its place. Empty to delete the passage' } }, required: ['path', 'old_text', 'new_text'] } },
  { name: 'set_task', description: 'Check or uncheck one task of a note (a line like - [ ] Buy bread) without rewriting the note. The task is found by its text. Only uncheck a task when the person asks for it.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, task: { type: 'string', description: 'The text of the task, as written in the note' }, done: { type: 'boolean', description: 'true to check it (default), false to uncheck it' }, occurrence: { type: 'number', description: 'Optional: which one, from 1, when several tasks have that text' } }, required: ['path', 'task'] } },
  { name: 'search_notes', description: 'Search the text of every note. Returns matching notes with the lines that match.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'list_comments', description: 'List the comments the user left for you and that are still open. Each one has the note path, the quoted passage it refers to and what the user asks. Check this when the user says they left comments, and before editing a note.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional: only the comments on this note' } } } },
  { name: 'resolve_comment', description: 'Mark a comment as done after making the change it asks for with edit_note or write_note. Add a short reply saying what you changed.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, reply: { type: 'string', description: 'One or two sentences on what was changed' } }, required: ['id'] } },
  { name: 'move_note', description: 'Move or rename a note. Its history, comments, shares and public links follow it. Fails if a note already exists at the new path.', inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'Current path' }, to: { type: 'string', description: 'New path, for example archive/2025/plan.md' } }, required: ['from', 'to'] } },
  { name: 'note_history', description: 'List the earlier versions kept for a note, newest first. Pass version to read the text of one of them.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, version: { type: 'number', description: 'Optional: id of the version to read' } }, required: ['path'] } },
  // El modo de trabajo completo, a demanda: la estructura del proyecto y las reglas del tablero (ver guide).
  { name: 'get_guide', description: 'Read the SharpMD working guide: the folder structure to document a project (README, architecture, features, epics, decisions, log), the rules of its task board and the format of the list of what the person has to do. Call it once at the start of a session, before you create notes or cards.', inputSchema: { type: 'object', properties: {} } },
  // Tableros: las mismas operaciones que la API (apiTool), con nombres para un modelo.
  { name: 'list_boards', description: 'List the kanban boards of a note: each board with its columns, which column holds finished cards, and every card with its id, title and fields. Call it before moving or updating cards, to get their ids and the exact column names.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of the note that holds the board, for example project/board.md' } }, required: ['path'] } },
  { name: 'create_board', description: 'Create a kanban board. If the note does not exist it is created with the board; if it exists, the board is added at its end. Without columns it gets To do, In progress, Paused and Done, and cards moved to Done are marked as done.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of the note, for example project/board.md' }, title: { type: 'string', description: 'Optional heading written above the board' }, columns: { type: 'array', items: { type: 'string' }, description: 'Optional column names, in order' }, done: { type: 'string', description: 'Optional: the column that holds finished cards. By default the one called Done or similar' } }, required: ['path'] } },
  { name: 'add_card', description: 'Add a card to a board. Returns the id of the card, which move_card, update_card and delete_card take. Use fields for anything beyond the title, for example {"agent": "claude", "due": "2026-01-31"}.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string', description: 'Short title of the task' }, column: { type: 'string', description: 'Column name. By default the first column' }, fields: { type: 'object', description: 'Optional fields of the card, as key and value', additionalProperties: { type: ['string', 'number', 'boolean'] } }, position: { type: 'string', enum: ['top', 'bottom'], description: 'Where in the column. By default bottom' }, board: { type: 'number', description: 'Optional: which board of the note, from 0, when it has more than one' } }, required: ['path', 'title'] } },
  { name: 'move_card', description: 'Move a card to another column. Moving it to the column of finished cards marks it as done, and moving it out unmarks it. A column that does not exist is created, so take the names from list_boards.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, id: { type: 'string', description: 'Id of the card, from add_card or list_boards' }, column: { type: 'string', description: 'Name of the column to move it to' }, position: { type: 'string', enum: ['top', 'bottom'], description: 'Where in the column. By default bottom' } }, required: ['path', 'id', 'column'] } },
  { name: 'update_card', description: 'Change the title or the fields of a card. Only the fields you pass change: a field with an empty value is removed, the others stay. To change its column use move_card.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, id: { type: 'string', description: 'Id of the card, from add_card or list_boards' }, title: { type: 'string' }, fields: { type: 'object', description: 'Fields to set, as key and value. An empty value removes the field', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } }, done: { type: 'boolean', description: 'Optional: mark or unmark the card as done without moving it' } }, required: ['path', 'id'] } },
  { name: 'delete_card', description: 'Delete a card from a board. Finished cards are the record of the work: move them to Done instead, and delete only a card that was added by mistake.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, id: { type: 'string', description: 'Id of the card, from add_card or list_boards' } }, required: ['path', 'id'] } },
  // Las que sacan notas hacia afuera: existen solo para un token creado con el permiso de compartir.
  { share: true, name: 'list_shares', description: 'List who the notes are shared with and which public links exist. Pass a path to see only that note or folder.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional note or folder' } } } },
  { share: true, name: 'share_note', description: 'Share a note, or a whole folder, with another SharpMD account by its email address. Only do this when the person asks for it. They open it after signing in to SharpMD with that address.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path of a note, or of a folder to share everything inside it' }, email: { type: 'string' }, role: { type: 'string', enum: ['view', 'edit'], description: 'view (default) or edit' } }, required: ['path', 'email'] } },
  { share: true, name: 'unshare_note', description: 'Stop sharing a note or folder with an email address.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, email: { type: 'string' } }, required: ['path', 'email'] } },
  { share: true, name: 'create_public_link', description: 'Create a read-only public link to a note and return its URL. Anyone with the URL can read the note, so only do this when the person asks for it. Pass a password to protect it. The URL is only returned once.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, password: { type: 'string', description: 'Optional password the reader must type' } }, required: ['path'] } },
  { share: true, name: 'revoke_public_link', description: 'Revoke public links: one by its id, or every link to a note by its path.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, path: { type: 'string' } } } },
];
// A un token del equipo que solo lee no se le ofrecen las que cambian algo.
const BOARD_TOOLS = new Set(['list_boards', 'create_board', 'add_card', 'move_card', 'update_card', 'delete_card']);
const WRITE_TOOLS = new Set(['write_note', 'append_note', 'edit_note', 'set_task', 'move_note', 'resolve_comment', 'create_board', 'add_card', 'move_card', 'update_card', 'delete_card', 'share_note', 'unshare_note', 'create_public_link', 'revoke_public_link']);
// Las de agentes (AGENT_DEFS) van después de las de notas y tableros, y antes de las de compartir.
const toolsFor = (user) => { const mine = TOOLS.filter((t) => (!t.share || user.canShare) && !(user.canWrite === false && WRITE_TOOLS.has(t.name))); const plain = ({ share, ...t }) => agentArg(t); return mine.filter((t) => !t.share).map(plain).concat(AGENT_DEFS, mine.filter((t) => t.share).map(plain)); };
const SHARE_TOOLS = new Set(TOOLS.filter((t) => t.share).map((t) => t.name));
const NO_SHARE = 'This token cannot share notes or create public links. Ask the person to do it from the SharpMD app, or to create a token with that permission in Settings > AI.';

// Lo que la IA lee cuando pide algo de una carpeta bloqueada: qué pasa y cómo lo resuelve la persona.
const LOCKED = (folder) => (!folder ? 'All the notes of this account are protected with a password and are locked, so they cannot be read, searched or changed right now. The person can unlock them for the AI from SharpMD: Settings, then AI, then "Unlock for the AI". Ask them to do that, then try again.' : '') || 'The folder "' + folder + '" is protected with a password and is locked, so its notes cannot be read, searched or changed right now. The person can unlock it for the AI from SharpMD: right-click the folder, then "Unlock for the AI". Ask them to do that, then try again.';
// La llave con la que este token puede usar una carpeta con contraseña, o null. Hace falta que la persona la haya
// desbloqueado para la IA y que la carpeta entera esté dentro del alcance del token.
const aiReach = (user, vault) => { const k = vault.state === 'on' && within(user, vault.folder) ? aiKey(vault) : null; return k ? k.key : null; };
// Para una ruta: null si no está en una carpeta con contraseña, la llave si está desbloqueada, o el aviso para la IA.
const TEAM_LOCKED = 'The team space is protected with a password and is locked for the AI, so its notes cannot be read, searched or changed right now. The person can unlock it for the AI from SharpMD: in the file explorer, the menu next to the team, then "Unlock for the AI". A member who is not the administrator can only do that if the administrator of the team allowed it. Ask them to do that, then try again.';
function vaultGate(user, p) {
  const vault = vaultOf(user.id, p); if (!vault) return null;
  // Un token del equipo no abre un espacio protegido: la llave se desbloquea por persona, y él no es ninguna.
  if (user.teamToken) throw new Fail(423, 'vault_locked', TEAM_TOKEN_LOCKED);
  const key = aiReach(user, vault);
  if (!key) throw new Fail(423, 'vault_locked', LOCKED(vault.folder));
  return key;
}

// opt.raw: quien llama es la API REST (ver apiTool), que quiere datos en vez de la frase que lee una IA.
// Sobre lo que responde cada herramienta, lo que una IA necesita saber del plan gratis: cuánto lugar queda al
// listar, y cuánto quedó después de una llamada que creó una nota (editar una que ya estaba no lo repite).
// La API REST (opt.raw) recibe los datos sin esa línea.
function callTool(user, name, args, opt) {
  const did = {}; const out = runTool(user, name, args, opt, did);
  if (opt && opt.raw) return out;
  if (name === 'list_notes') { const u = planUse(user); return u ? new Parts([JSON.stringify(out, null, 2), planLine(u)]) : out; }
  const u = did.made ? planUse(did.made) : null;
  if (!u) return out;
  const line = planAfter(u);
  if (typeof out === 'string') return out + '\n' + line;
  if (out instanceof Parts) return new Parts(out.list.concat(line));
  return out && typeof out === 'object' && !Array.isArray(out) ? Object.assign({}, out, { plan: line }) : out;
}
function runTool(user, name, args, opt, did) {
  args = args || {}; opt = opt || {}; did = did || {};
  const vaults = vaultsOf(user.id);
  // El espacio del equipo, si la cuenta está en uno: sus notas figuran bajo @team/ y se leen y escriben como las
  // demás. El alcance del token se mira sobre la ruta entera, con @team/ incluido: un token limitado a una carpeta
  // propia no ve el equipo, y uno limitado a @team o a @team/algo ve solo eso.
  // Si quien administra no deja que los miembros conecten su IA al espacio, el token de un miembro no lo ve.
  // tt: un token del equipo. Ahí user es el espacio mismo y sus notas son la raíz, sin @team/.
  const tt = user.teamToken || null; const theTeam = tt ? tt.team : user.team;
  const space = !tt && user.team && teamAllows(user.team, user, 'tokens') ? userById(user.team.space) : null;
  const inTeam = (a) => !!tt || a.who !== user;
  const mayWrite = (a) => { if (inTeam(a) && !teamAllows(theTeam, user, 'write')) throw new Fail(403, 'read_only', tt ? 'This token can only read the notes of the team.' : 'Your role in this team is reader: you can read the team notes but not change them.'); };
  // Lo que pasa en el espacio del equipo queda en su registro de actividad: la ruta y qué se hizo, nunca el texto.
  const noted = (action, a, detail) => { if (inTeam(a)) teamLog(theTeam, user, action, a.p, detail); };
  const seen = (a) => { if (!a || inTeam(a)) teamAiSeen(theTeam, user); };
  if (tt) seen();
  // barred: es miembro, pero el equipo no deja que su IA entre al espacio. @team/ no es entonces una carpeta propia:
  // se rechaza diciendo por qué, para que la IA no crea que guardó algo en el equipo.
  const barred = !tt && !!user.team && !space;
  const teamPath = (p) => (!!space || barred) && (p === TEAM_PRE.slice(0, -1) || p.startsWith(TEAM_PRE));
  // at: de quién es la nota de esa ruta y cómo se llama ahí. full es la ruta como la ve la IA.
  const at = (raw) => { const full = scoped(user, raw); if (barred && teamPath(full)) throw new Fail(403, 'team_policy', 'The administrator of the team has not allowed members to connect their AI to the team space.'); return teamPath(full) && full.length > TEAM_PRE.length ? { who: space, p: cleanPath(full.slice(TEAM_PRE.length)), full } : { who: user, p: full, full }; };
  // El espacio del equipo protegido: su llave, si quien llama lo desbloqueó para su IA y el token alcanza todo @team.
  const tv = space ? teamVault(user.team) : null;
  const teamKey = () => { const k = tv && tv.state === 'on' && within(user, TEAM_PRE.slice(0, -1)) ? aiKey(tv, user.id) : null; return k ? k.key : null; };
  const aadOf = (a) => (a.who === user ? a.p : teamAad(space.id, a.p));
  const tag = (p) => { if (teamPath(p)) return tv ? { team: true, protected: true, locked: !teamKey() } : { team: true }; const v = vaults.find((x) => p === x.folder || inside(p, x.folder)); return v ? { protected: true, locked: !aiReach(user, v) } : {}; };
  const mine = () => listNotes(user).filter((n) => !teamPath(n.path)).concat(space ? listNotes(space).map((n) => ({ path: TEAM_PRE + n.path, updated: n.updated, size: n.size })) : [])
    .filter((n) => within(user, n.path)).sort((a, b) => b.updated - a.updated);
  if (name === 'list_notes') return mine().filter((n) => inFolder(n.path, args.folder && cleanPath(args.folder))).map((n) => Object.assign({ path: n.path, updated: new Date(n.updated).toISOString(), size: n.size }, tag(n.path)));
  if (name === 'list_folders') {
    const count = new Map();
    for (const n of mine()) { const parts = n.path.split('/'); for (let i = 1; i < parts.length; i++) { const f = parts.slice(0, i).join('/'); count.set(f, (count.get(f) || 0) + 1); } }
    // Una carpeta con contraseña figura aunque esté vacía.
    for (const v of vaults) if (v.folder && within(user, v.folder) && !count.has(v.folder)) count.set(v.folder, 0);
    // La del equipo también, para que la IA sepa que existe.
    if (space && within(user, TEAM_PRE.slice(0, -1)) && !count.has(TEAM_PRE.slice(0, -1))) count.set(TEAM_PRE.slice(0, -1), 0);
    return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, notes]) => Object.assign({ folder, notes }, tag(folder)));
  }
  // Dentro de una carpeta desbloqueada para la IA se lee descifrando y se escribe cifrando, con el mismo formato
  // que usa el navegador. Una nota que el navegador todavía no cifró no se entrega.
  const read = (a, key) => {
    const n = readNote(a.who, a.p);
    aiTouch(user, a.who.id, a.p, false);
    aiReadSet(user, a.who.id, a.p, n.rev, key ? null : n.text);
    if (!key) return n.text;
    if (!n.text.startsWith(VAULT)) throw new Fail(423, 'vault_locked', 'This note is still being encrypted by SharpMD. Try again in a moment.');
    return vaultOpen(key, aadOf(a), n.text);
  };
  // El espacio del equipo se protege entero, con una sola contraseña.
  const teamGate = () => { if (!tv) return null; const key = teamKey(); if (!key) throw new Fail(423, 'vault_locked', TEAM_LOCKED); return key; };
  const gate = (a) => (a.who === user ? vaultGate(user, a.p) : teamGate());
  // La IA guarda sobre la revisión que hay en ese momento: lee y escribe sin soltar el hilo, así que no pisa un
  // guardado que entró en el medio ni se cruza con otro. Quien tiene la nota abierta se entera al instante.
  const revOf = (a) => { const now_ = q('SELECT rev FROM notes WHERE user = ? AND path = ?').get(a.who.id, a.p); return now_ ? now_.rev : null; };
  const write = (a, key, text, base) => {
    text = String(text == null ? '' : text);
    if (key && Buffer.byteLength(text) > MAX_NOTE) throw new Fail(413, 'too_large');
    const fresh = revOf(a) == null;
    const saved = writeNote(a.who, a.p, key ? vaultSeal(key, aadOf(a), text) : text, base === undefined ? revOf(a) : base);
    tellSaved(a.who.id, a.p, saved, { by: 'mcp', ed: user.tokenId != null ? 't:' + user.tokenId : null }, text);
    aiTouch(user, a.who.id, a.p, true);
    aiReadSet(user, a.who.id, a.p, saved.rev, key ? null : text);
    if (fresh) did.made = a.who;
    return saved;
  };
  // Quién hizo el último guardado de la nota, para decírselo a la IA sin nombres: ella misma, una persona, otra IA.
  const lastBy = (a) => { const r = q('SELECT by, updated FROM notes WHERE user = ? AND path = ?').get(a.who.id, a.p); const by = (r && r.by) || ''; return { self: user.tokenId != null && by === 't:' + user.tokenId, who: by[0] === 'u' ? 'a person' : by[0] === 'g' ? 'a guest' : by[0] === 't' ? 'another AI' : 'someone', updated: r ? r.updated : 0 }; };
  // La versión que manda la IA: un entero, también si llega como texto.
  const revArg = (v) => (v == null || v === '' ? null : cleanRev(typeof v === 'string' && /^\d+$/.test(v) ? +v : v));
  // La dirección para abrir esa nota en la app, con el mismo formato que usa la app al navegar.
  const appLink = (f) => APP_URL + '?f=' + encodeURIComponent(f);
  const openUrl = (a) => appLink('cloud/' + (a.who === user && !isSpace(a.who) ? '' : '~' + a.who.id + '/') + a.p.split('/').map(encodeURIComponent).join('/'));
  const k = { user, at, gate, read, write, revOf, openUrl, seen, mayWrite, noted, mcp: (n, x) => runTool(user, n, x, null, did) };
  if (opt.raw) { const out = apiTool(name, args, k); if (out !== undefined) return out; }
  if (name === 'get_guide') return guide(user);
  if (AGENT_TOOLS.has(name)) return agentTool(name, args, k);
  // Mover o cambiar una tarjeta es señal de vida del agente que la tiene enlazada.
  if (BOARD_TOOLS.has(name)) { const out = boardTool(name, args, k); if (args.id != null) agentCardBeat(user, at(args.path), args.id); return out; }
  if (name === 'read_note') {
    const a = at(args.path); seen(a); const text = read(a, gate(a)); const rev = revOf(a); const last = lastBy(a);
    // El texto va solo en el primer bloque, como siempre. El segundo dice sobre qué versión se está parado.
    return new Parts([text, 'Version ' + rev + ' of ' + a.full + ', last saved ' + iso(last.updated) + ' by ' + (last.self ? 'you' : last.who) + '. To change part of it use edit_note, set_task or append_note. If you replace it with write_note, pass base_rev: ' + rev + ' so that what the person changes in the meantime is merged instead of overwritten.']);
  }
  if (name === 'write_note') {
    const a = at(args.path); mayWrite(a); const key = gate(a); const cur = revOf(a); const had = cur != null;
    const mine = String(args.text == null ? '' : args.text); const baseRev = revArg(args.base_rev);
    const mem = aiReadGet(user, a.who.id, a.p); const last = had ? lastBy(a) : null; let text = mine; let said = '';
    if (had && baseRev != null && baseRev !== cur) {
      // La nota cambió desde la versión sobre la que la IA escribió: se unen las dos ediciones, o no se guarda nada.
      const now = read(a, key);
      const m = mem && mem.rev === baseRev && mem.text != null ? mergeThree(mem.text, mine, now) : null;
      if (!m || !m.clean) throw new Fail(409, 'rev_conflict', 'Nothing was saved. ' + a.full + ' changed since version ' + baseRev + ' (' + last.who + ' edited it)' + (m ? ' and your text changes the same lines' : ' and that version is no longer at hand to merge with') + '. It is now at version ' + cur + '. Apply your change to the current text below and call write_note again with base_rev ' + cur + ', or make the change with edit_note or set_task. Keep everything the person wrote or checked.\n\nCurrent text of ' + a.full + ':\n\n' + now, { rev: cur });
      text = m.text;
      said = ' The note had changed since version ' + baseRev + ' (' + last.who + ' edited it): those changes were merged with yours' + (m.ticked ? ', and a task that both sides left with a different box stayed checked' : '') + '. Read it again before the next change.';
    } else if (had && baseRev == null && !last.self && !(mem && mem.rev === cur)) {
      // Sin versión de base se guarda como siempre, pisando. Si en el medio guardó otro, la IA se entera.
      said = ' Warning: ' + last.who + (mem ? ' changed this note after you last read it' : ' saved this note last and you had not read it') + ', and this write replaced the whole note. Read it again and put back anything they wrote or checked that is now missing. Next time pass base_rev, or use edit_note or set_task.';
    }
    const saved = write(a, key, text, cur); noted(had ? 'edit' : 'create', a);
    return 'Saved ' + a.full + ' (' + text.length + ' characters). Open it: ' + openUrl(a) + (baseRev == null ? '' : ' Now at version ' + saved.rev + '.') + said;
  }
  if (name === 'edit_note') {
    // Leer, cambiar el tramo y escribir pasan sobre la misma revisión: lo demás queda como lo dejó la persona.
    const a = at(args.path); mayWrite(a); const key = gate(a); const rev = revOf(a); const text = read(a, key);
    const lf = (v) => String(v).replace(/\r\n/g, '\n'); const from = typeof args.old_text === 'string' ? lf(args.old_text) : ''; const to = lf(args.new_text == null ? '' : args.new_text);
    if (!from) throw new Fail(400, 'bad_text', 'old_text is the exact passage to replace, copied from the note');
    const crlf = text.includes('\r\n'); const body = lf(text); const n = body.split(from).length - 1;
    if (!n) throw new Fail(409, 'no_match', 'Nothing was saved. old_text was not found in ' + a.full + '. Read the note again: the person may have changed it, and the passage has to be copied exactly as it is written.');
    if (n > 1) throw new Fail(409, 'many_matches', 'Nothing was saved. old_text appears ' + n + ' times in ' + a.full + '. Add more of the text around it, so that it matches only once.');
    if (from === to) return 'Nothing to change in ' + a.full + ': old_text and new_text are the same.';
    const next = body.replace(from, () => to);
    const saved = write(a, key, crlf ? next.replace(/\n/g, '\r\n') : next, rev); noted('edit', a);
    return 'Edited ' + a.full + ' (now at version ' + saved.rev + '). Open it: ' + openUrl(a);
  }
  if (name === 'set_task') {
    const a = at(args.path); mayWrite(a); const key = gate(a); const rev = revOf(a); const text = read(a, key);
    const want = String(args.task == null ? '' : args.task).replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!want) throw new Fail(400, 'bad_task', 'task is the text of the task, as written in the note');
    const done = !(args.done === false || args.done === 'false');
    const lines = text.split(/\r?\n/); const all = taskLines(lines);
    let hits = all.filter((x) => x.label.toLowerCase() === want); if (!hits.length) hits = all.filter((x) => x.label.toLowerCase().includes(want));
    const show = (list) => list.slice(0, 20).map((x, n) => '\n' + (n + 1) + '. ' + (x.t.done ? '[x] ' : '[ ] ') + x.label).join('');
    if (!hits.length) throw new Fail(404, 'task_not_found', 'Nothing was saved. There is no task with that text in ' + a.full + '. Read the note again: the person may have changed it.' + (all.length ? ' Its tasks:' + show(all) : ''));
    const nth = args.occurrence == null || args.occurrence === '' ? null : +args.occurrence;
    if (nth != null && (!Number.isInteger(nth) || nth < 1 || nth > hits.length)) throw new Fail(400, 'bad_occurrence', 'occurrence goes from 1 to ' + hits.length + ' for that text:' + show(hits));
    if (hits.length > 1 && nth == null) throw new Fail(409, 'task_ambiguous', 'Nothing was saved. ' + hits.length + ' tasks match that text. Pass occurrence with the number of the one you mean, or more of its text:' + show(hits));
    const hit = hits[(nth || 1) - 1];
    if (hit.t.done === done) return 'Nothing to change: "' + hit.label + '" in ' + a.full + ' is already ' + (done ? 'checked' : 'unchecked') + '.';
    lines[hit.i] = hit.t.pre + (done ? 'x' : ' ') + hit.t.post;
    write(a, key, lines.join(text.includes('\r\n') ? '\r\n' : '\n'), rev); noted('edit', a, 'task');
    return (done ? 'Checked' : 'Unchecked') + ' "' + hit.label + '" in ' + a.full + ' (line ' + (hit.i + 1) + '). Open it: ' + openUrl(a);
  }
  if (name === 'append_note') {
    // Lo que se lee y lo que se escribe son de la misma revisión: si no coincidiera, no se agrega sobre un texto viejo.
    const a = at(args.path); mayWrite(a); const key = gate(a); let prev = ''; const base = revOf(a);
    try { prev = read(a, key); } catch (e) { if (e.code !== 'not_found') throw e; }
    write(a, key, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + (prev ? '\n' : '') + String(args.text || ''), base);
    noted(base == null ? 'create' : 'edit', a);
    return 'Appended to ' + a.full + '. Open it: ' + openUrl(a);
  }
  if (name === 'search_notes') {
    const results = searchNotes(user, args.query, (v) => aiReach(user, v)).filter((r) => !teamPath(r.path))
      .concat(space ? searchNotes(space, args.query, tv ? teamKey : undefined, tv ? teamAad(space.id, '') : '').map((r) => Object.assign(r, { path: TEAM_PRE + r.path })) : []).filter((r) => within(user, r.path)).slice(0, 30);
    // Si quedó alguna carpeta bloqueada al alcance del token, se dice: lo que hay adentro no se buscó.
    if (tt && vaults.length) return { results, locked_folders: ['/'], note: 'The notes were not searched. ' + TEAM_TOKEN_LOCKED };
    const shut = vaults.filter((v) => !aiReach(user, v) && (within(user, v.folder) || inside(user.scope, v.folder) || user.scope === v.folder)).map((v) => v.folder || '/');
    const teamShut = !!tv && !teamKey() && (within(user, TEAM_PRE.slice(0, -1)) || (user.scope || '').startsWith(TEAM_PRE));
    if (teamShut) shut.push(TEAM_PRE.slice(0, -1));
    return shut.length ? { results, locked_folders: shut, note: 'The notes inside locked folders were not searched. ' + (teamShut && shut.length === 1 ? TEAM_LOCKED : LOCKED(shut[0])) } : results;
  }
  if (name === 'list_comments') return listComments(user, args.path ? scoped(user, args.path) : '', false).filter((c) => within(user, c.path)).map((c) => ({ id: c.id, path: c.path, quote: c.quote, comment: c.text, created: new Date(c.created).toISOString() }));
  if (name === 'resolve_comment') {
    const c = q('SELECT id, path, e FROM comments WHERE id = ? AND user = ?').get(+args.id, user.id);
    if (!c || !within(user, c.path)) throw new Fail(404, 'not_found');
    // La respuesta se guarda como el resto de la fila: cifrada si la fila lo está.
    const reply = String(args.reply || '').slice(0, 1000);
    q("UPDATE comments SET status = 'done', reply = ?, done = ? WHERE id = ?").run(c.e ? seal(reply, 'comments.reply') : reply, now(), c.id);
    announce(roomKey(user.id, c.path), { type: 'comments' });
    autoEmit(user, 'comment.resolved', c.path, { comment: { id: c.id, reply } });
    return 'Comment ' + c.id + ' marked as done.';
  }
  if (name === 'move_note') {
    const a = at(args.from); const b = at(args.to);
    if (a.who !== b.who) throw new Fail(409, 'other_space', 'A note cannot be moved between your own notes and the team space. Write it in the new place instead.');
    mayWrite(a);
    if (tt && vaults.length) throw new Fail(409, 'vault', 'Notes in a team space protected with a password can only be moved from the SharpMD app.');
    // Mover hacia, desde o dentro de una carpeta con contraseña pide volver a cifrar el texto: eso lo hace la app.
    if (a.who === user && (vaultOf(user.id, a.p) || vaultOf(user.id, b.p))) throw new Fail(409, 'vault', 'Notes in a folder protected with a password can only be moved from the SharpMD app.');
    if (a.who !== user && tv) throw new Fail(409, 'vault', 'Notes in a team space protected with a password can only be moved from the SharpMD app.');
    try { renameNote(a.who, a.p, b.p); } catch (e) { if (e.code === 'exists') throw new Fail(409, 'exists', 'There is already a note at ' + b.full + '.'); throw e; }
    noted('move', a, b.p);
    return 'Moved ' + a.full + ' to ' + b.full + '. Open it: ' + openUrl(b);
  }
  if (name === 'note_history') {
    const a = at(args.path); seen(a);
    // El historial de una carpeta con contraseña está cifrado desde el navegador: no se entrega.
    if (a.who === user && vaultOf(user.id, a.p)) throw new Fail(409, 'vault', 'The history of a note in a folder protected with a password can only be read from the SharpMD app.');
    if (a.who !== user && tv) throw new Fail(409, 'vault', 'The history of a note in a team space protected with a password can only be read from the SharpMD app.');
    if (args.version == null) return q('SELECT id, saved, size FROM versions WHERE user = ? AND path = ? AND aad IS NULL ORDER BY saved DESC LIMIT 100').all(a.who.id, a.p).map((v) => ({ version: v.id, saved: new Date(v.saved).toISOString(), size: v.size }));
    // La versión tiene que ser de esa nota: el alcance del token se miró sobre la ruta.
    const v = q('SELECT text, e FROM versions WHERE id = ? AND user = ? AND path = ? AND aad IS NULL').get(+args.version, a.who.id, a.p);
    if (!v) throw new Fail(404, 'not_found');
    return unseal(v.text, v.e, 'versions.text');
  }
  if (SHARE_TOOLS.has(name)) {
    if (!user.canShare) throw new Fail(403, 'no_share_permission', NO_SHARE);
    // Lo propio, dentro del alcance del token. Lo del equipo sale hacia afuera solo si quien administra lo permite
    // (y nunca el espacio entero): what es la política que se mira, 'share' o 'links'. Lo que está en una carpeta
    // con contraseña, o en un espacio protegido, lo rechazan addShare y addLink.
    const NO_TEAM_SHARE = 'The administrator of the team has not allowed sharing team notes outside the team.';
    const own = (raw, what) => {
      const a = at(raw);
      if (a.who === user && !tt && teamPath(a.full)) throw new Fail(403, 'team', 'The whole team space cannot be shared. Share a note or a folder inside it.');
      if (inTeam(a) && !teamAllows(theTeam, user, what)) throw new Fail(403, 'team_policy', NO_TEAM_SHARE);
      return a;
    };
    const pre = (a) => (a.who === user ? '' : TEAM_PRE);
    if (name === 'list_shares') {
      const a = args.path ? own(args.path, 'share') : { who: user, p: '' };
      const all = sharesOf(a.who, a.p);
      return { people: all.people.filter((s) => within(user, pre(a) + s.path)).map((s) => ({ path: pre(a) + s.path, kind: s.kind, email: s.email, role: s.role })), links: all.links.filter((l) => within(user, pre(a) + l.path)).map((l) => ({ id: l.id, path: pre(a) + l.path, protected: !!l.protected, created: new Date(l.created).toISOString() })) };
    }
    if (name === 'share_note') {
      const a = own(args.path, 'share'); const p = a.p;
      // Una nota si existe con esa ruta; si no, la carpeta que tenga notas adentro.
      const kind = q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(a.who.id, p) ? 'note' : listNotes(a.who).some((n) => inside(n.path, p)) ? 'folder' : '';
      if (!kind) throw new Fail(404, 'not_found', 'There is no note or folder at ' + a.full + '.');
      const role = args.role === 'edit' ? 'edit' : 'view';
      if (inTeam(a)) teamShare(theTeam, user, a.who, { path: p, email: args.email, kind, role }); else addShare(user, { path: p, email: args.email, kind, role });
      return 'Shared the ' + kind + ' ' + a.full + ' with ' + cleanEmail(args.email) + ' (' + (role === 'edit' ? 'can edit' : 'can view') + '). They see it in SharpMD after signing in with that address.';
    }
    if (name === 'unshare_note') {
      const a = own(args.path, 'share'); const email = cleanEmail(args.email);
      if (!q('DELETE FROM shares WHERE owner = ? AND path = ? AND email = ?').run(a.who.id, a.p, email).changes) throw new Fail(404, 'not_found', a.full + ' is not shared with ' + email + '.');
      noted('unshare', a);
      return 'Stopped sharing ' + a.full + ' with ' + email + '.';
    }
    if (name === 'create_public_link') {
      const a = own(args.path, 'links'); const body = { path: a.p, password: args.password == null || args.password === '' ? null : String(args.password) };
      const made = inTeam(a) ? teamLink(theTeam, user, a.who, body) : addLink(user, body);
      return { path: a.full, url: appLink('pub/' + made.token), id: made.id, protected: made.protected, note: 'Anyone with this URL can read the note' + (made.protected ? ' after typing the password.' : '.') + ' The URL is not shown again.' };
    }
    // revoke_public_link: uno por id, o todos los de una nota. Por id se busca en lo propio y, si se puede, en lo del equipo.
    const of = args.id == null ? own(args.path, 'links') : null;
    const owners = of ? [of.who] : [user].concat(space && teamAllows(theTeam, user, 'links') ? [space] : []);
    if (tt && !teamAllows(theTeam, user, 'links')) throw new Fail(403, 'team_policy', NO_TEAM_SHARE);
    const hit = owners.flatMap((w) => q('SELECT id, path FROM links WHERE owner = ?').all(w.id).map((l) => ({ id: l.id, p: l.path, who: w, full: (w === user ? '' : TEAM_PRE) + l.path })))
      .filter((l) => within(user, l.full) && (of ? l.p === of.p : l.id === +args.id));
    if (!hit.length) throw new Fail(404, 'not_found', 'There is no public link there.');
    for (const l of hit) { q('DELETE FROM links WHERE id = ? AND owner = ?').run(l.id, l.who.id); noted('unlink', l); }
    return 'Revoked ' + hit.length + ' public link' + (hit.length === 1 ? '' : 's') + ' to ' + hit[0].full + '.';
  }
  throw new Fail(400, 'unknown_tool');
}

function mcp(user, msg) {
  // El cliente dice quién es al conectarse: con ese nombre figura la IA en las notas que toque.
  if (msg && msg.method === 'initialize') mcpClientSeen(user, msg.params);
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'sharpmd', version: '1.0.0' },
    instructions: 'Notes are Markdown files in the user\'s SharpMD cloud folder. Paths look like folder/name.md, and a top-level folder is usually a project. The user can leave comments for you on a note: call list_comments, make each change with edit_note or write_note, then resolve_comment. The person edits the same notes while you work, and checks tasks in them: read a note right before you change it, prefer edit_note, set_task, append_note and the board tools over write_note, pass base_rev from read_note when you do use write_note, and never uncheck or delete what the person checked or wrote. A folder marked as protected and locked is encrypted with a password: you cannot read it until the person unlocks it for the AI from SharpMD. If the person belongs to a team, the notes the team shares are under @team/ and every member can read and edit them. write_note, edit_note, set_task, append_note and move_note return a link that opens the note in the SharpMD app: give it to the person. ' + (user.canWrite === false ? '' : 'Work this way without being asked. Keep the project documented in one folder: README.md as the index, architecture.md, features/ with one note per feature, epics.md, decisions.md and log.md. Keep its task board in board.md, one card per task: To do when you plan it, In progress when you start, Paused when you need something from the person (say what in a field called needs), Done when it is finished. Change the board with create_board, add_card, move_card and update_card instead of rewriting the note. Keep what only the person can do in pending.md: a task list where each item has numbered steps with the direct link to the page where each one is done. Call get_guide once per session for the full structure and rules. When you split work between subagents or start a long task, register each agent with start_agent and close it with end_agent, so the person sees who is working on what. ') + (user.teamToken ? 'This token belongs to a team, not to a person: every note it reaches is in the shared space of the team' + (user.canWrite ? '. ' : ', and it can only read. ') : '') + (user.canShare ? 'This token can share notes with other accounts and create public links: only do that when the person asks.' : 'This token cannot share notes or create public links: the person does that from the SharpMD app.') + (user.scope ? ' This token only reaches the folder ' + user.scope + '/.' : '') + ' When you mention a Markdown file that lives on the person\'s disk instead of here, give it as a link that opens it in their browser with the SharpMD extension: ' + APP_URL + '#open= followed by the file:// address of the file, percent-encoded as a single value (what encodeURIComponent returns). For example [notes.md](' + APP_URL + '#open=' + encodeURIComponent('file:///C:/Users/me/Desktop/notes.md') + ') on Windows, or [notes.md](' + APP_URL + '#open=' + encodeURIComponent('file:///Users/me/Desktop/notes.md') + ') on Mac and Linux. Under the link, write the full path as plain text, in case the link cannot be clicked.' });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools: toolsFor(user) });
  if (msg.method === 'tools/call') {
    try {
      const out = callTool(user, msg.params && msg.params.name, msg.params && msg.params.arguments);
      // agent_id en cualquier llamada es la señal de vida de ese agente; si ya no está, se le dice.
      const blocks = (out instanceof Parts ? out.list : [typeof out === 'string' ? out : JSON.stringify(out, null, 2)]).concat(agentPulse(user, msg.params));
      return reply({ content: blocks.map((text) => ({ type: 'text', text })) });
    } catch (e) { return reply({ content: [{ type: 'text', text: 'Error: ' + (e.message || e.code || 'failed') + (e.code === 'note_limit' ? FULL_FOR_AI : '') }], isError: true }); }
  }
  if (msg.id === undefined) return null; // notificación: no lleva respuesta
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
}

// ---------- HTTP ----------
function cors(req, res) {
  if (autoCors(req, res)) return;
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
//   - Compartir hacia afuera y los enlaces públicos de una nota del equipo dependen del papel y de la política del
//     equipo (más abajo). Sesiones en vivo no hay todavía. Tampoco carpetas con contraseña de cada miembro: el espacio
//     se protege entero, con una sola contraseña que pone quien administra (más abajo, "Espacio del equipo protegido").
//   - Lugares: los miembros más las invitaciones pendientes nunca superan los lugares pagos.
//   - Cobro: un solo precio por persona y por mes; la cantidad de la suscripción son los lugares. Arranca con una
//     prueba gratis, que cuenta como equipo al día. Cada cuenta tiene una sola: otra suscripción en prueba no da nada
//     hasta su primer cobro.
// Los precios de SharpMD en Paddle, por su id: los del plan pago (los vigentes y los anteriores, que siguen valiendo
// para quien ya está suscripto) y el del equipo. Un precio marcado con custom_data.app = 'sharpmd' cuenta igual.
const priceIds = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const PRICES_SOLO = new Set([env.PADDLE_PRICE_MONTHLY, env.PADDLE_PRICE_YEARLY, env.PADDLE_PRICE_LEGACY].flatMap(priceIds));
const TEAM_PRICE = String(env.PADDLE_PRICE_TEAM || '').trim();
const TEAM_PRICE_NOTRIAL = String(env.PADDLE_PRICE_TEAM_NOTRIAL || '').trim(); // el mismo precio sin prueba gratis, si existe
const ours = (price) => !!price.custom_data && price.custom_data.app === 'sharpmd';
const teamPrice = (price) => (!!price.id && (price.id === TEAM_PRICE || price.id === TEAM_PRICE_NOTRIAL)) || (ours(price) && price.custom_data.kind === 'team');
const PADDLE_API = String(env.PADDLE_API_URL || 'https://api.paddle.com').replace(/\/+$/, '');
// El plan de equipo se ofrece solo con todo lo que hace falta para cobrarlo y para cambiar los lugares.
const TEAM_BILLING = !!(env.PADDLE_WEBHOOK_SECRET && TEAM_PRICE && env.PADDLE_API_KEY);
const TEAM_MIN = 2; // un equipo paga por dos personas como mínimo
const TEAM_MAX_SEATS = Math.max(TEAM_MIN, +(env.TEAM_MAX_SEATS || 50));
const TEAM_INVITES_DAY = +(env.TEAM_INVITES_DAY || 20); // invitaciones que un equipo manda por día
const TEAM_PRE = '@team/'; // bajo qué carpeta ve la IA las notas del equipo
const APP_URL = String(env.APP_URL || 'https://sharpmd.app/src/app.html');
db.exec("CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, owner INTEGER UNIQUE NOT NULL, space INTEGER UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', seats INTEGER NOT NULL, sub TEXT, status TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL)");
db.exec('CREATE TABLE IF NOT EXISTS team_members (team INTEGER NOT NULL, user INTEGER PRIMARY KEY, joined INTEGER NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS team_invites (id INTEGER PRIMARY KEY, team INTEGER NOT NULL, email TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (team, email))');
// kind: 'solo' la suscripción individual, 'team' la de un equipo. Se decide la primera vez que se ve la suscripción.
try { db.exec("ALTER TABLE paddle_subs ADD COLUMN kind TEXT NOT NULL DEFAULT 'solo'"); } catch (e) { /* ya estaba */ }
// De la suscripción de un equipo: price es el precio que lleva (con ese mismo se cambian los lugares) y trial queda en 1
// si alguna vez estuvo en prueba gratis. trial_until, en el equipo, es hasta cuándo dura la prueba (0: no está en prueba).
for (const [table, col] of [['paddle_subs', "price TEXT NOT NULL DEFAULT ''"], ['paddle_subs', 'trial INTEGER NOT NULL DEFAULT 0'], ['teams', 'trial_until INTEGER NOT NULL DEFAULT 0']]) { try { db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col); } catch (e) { /* ya estaba */ } }
// Si esa cuenta ya tuvo su prueba gratis de equipo (en otra suscripción que la que se mira, si se pasa una).
const teamTried = (userId, except) => !!q("SELECT 1 FROM paddle_subs WHERE user = ? AND kind = 'team' AND trial = 1 AND id != ? LIMIT 1").get(userId, except || '');

// Papeles: 'admin' administra (quien paga lo es siempre, y puede nombrar a otros), 'editor' lee y escribe en el
// espacio, 'reader' solo lee. Los tres ocupan un lugar. Quienes ya eran miembros quedan como editores.
// policies: lo que quien administra decide para el espacio (más abajo, "Equipos: papeles, políticas...").
for (const [table, col] of [['team_members', "role TEXT NOT NULL DEFAULT 'editor'"], ['team_invites', "role TEXT NOT NULL DEFAULT 'editor'"], ['teams', "policies TEXT NOT NULL DEFAULT '{}'"]]) { try { db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col); } catch (e) { /* ya estaba */ } }
db.exec("UPDATE team_members SET role = 'admin' WHERE role != 'admin' AND user IN (SELECT owner FROM teams)");

// my_role: el papel de esa cuenta en su equipo.
const teamOf = (userId) => q('SELECT t.*, m.role AS my_role FROM team_members m JOIN teams t ON t.id = m.team WHERE m.user = ?').get(userId) || null;
// La cuenta tal como la usa el resto del servidor: plan es el que vale ahora (pago si lo paga ella o si está en un
// equipo al día), own el que paga por su lado y team su equipo. Toda cuenta que se lee para decidir algo sale de acá.
function userById(id) {
  const u = q('SELECT * FROM users WHERE id = ?').get(id); if (!u) return u;
  u.own = u.plan; u.team = teamOf(u.id);
  if (u.team && u.team.status === 'active') u.plan = 'pro';
  return u;
}
const withEmail = (link, user) => (link ? link + (link.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(user.email) : '');
// El enlace de pago de una cuenta. Quien ya tuvo su prueba gratis de equipo lo lleva con trial=0: la página de pago no
// se la ofrece de nuevo. Lo que de verdad impide encadenar pruebas es el aviso de Paddle (más abajo), no este enlace.
const payLink = (link, user) => { const url = withEmail(link, user); return url && TEAM_BILLING && teamTried(user.id) ? url + '&trial=0' : url; };
// Lugares ocupados: los miembros y las invitaciones que todavía nadie respondió.
const teamUsed = (t) => q('SELECT COUNT(*) AS n FROM team_members WHERE team = ?').get(t.id).n + q('SELECT COUNT(*) AS n FROM team_invites WHERE team = ?').get(t.id).n;
// Lo que la app sabe del equipo. Un miembro ve quiénes están (sus correos, nada más de nadie); las invitaciones
// pendientes y el cobro, solo quien administra. invites son las invitaciones que esperan a esta cuenta.
function teamView(user) {
  const t = user.team || null;
  const invites = q("SELECT i.id, t.name, u.email AS by, i.role FROM team_invites i JOIN teams t ON t.id = i.team JOIN users u ON u.id = t.owner WHERE i.email = ? AND t.status = 'active' ORDER BY i.created").all(user.email);
  // Quien tiene el plan por un equipo que paga otra persona no recibe nada de cobro: ni la oferta ni el enlace de pago.
  const guest = teamGuest(user);
  // trial: si a esta cuenta se le ofrece la prueba gratis.
  const offer = TEAM_BILLING && !guest;
  const out = { enabled: offer, checkout: offer ? payLink(env.CHECKOUT_TEAM, user) : '', min: TEAM_MIN, max: TEAM_MAX_SEATS, trial: offer && !teamTried(user.id), mine: null, invites };
  if (!t) return out;
  const owner = t.owner === user.id; const role = teamRoleOf(user); const admin = role === 'admin';
  const members = q('SELECT u.id, u.email, u.name, m.role FROM team_members m JOIN users u ON u.id = m.user WHERE m.team = ? ORDER BY m.joined, u.id').all(t.id)
    .map((x) => { const r = x.id === t.owner ? 'admin' : TEAM_ROLES.includes(x.role) ? x.role : 'editor'; return { id: x.id, email: x.email, name: nameOf(x), role: r, admin: r === 'admin', owner: x.id === t.owner }; });
  // solo: además paga un plan individual por su lado. La app le avisa que sigue activo y cómo darlo de baja.
  // owner: es quien paga. role: 'admin', 'editor' o 'reader'. can: lo que esta cuenta puede hacer en el espacio.
  out.mine = { id: t.id, name: t.name, role, owner, active: t.status === 'active', space: t.space, members, solo: user.own === 'pro' };
  out.mine.vault = teamVaultView(user, t);
  out.mine.policies = teamPolicies(t); out.mine.history_days = teamHistoryDays(t); out.mine.history_max = TEAM_HISTORY_DAYS; out.mine.history_choices = TEAM_HISTORY_CHOICES.filter((d) => d <= TEAM_HISTORY_DAYS);
  out.mine.can = Object.fromEntries(['write'].concat(POLICY_BOOLS).map((k) => [k, teamAllows(t, user, k)]));
  // Los lugares y las invitaciones pendientes, para quien administra personas. El cobro, solo para quien paga.
  if (admin) { out.mine.seats = t.seats; out.mine.used = teamUsed(t); out.mine.pending = q('SELECT id, email, role, created FROM team_invites WHERE team = ? ORDER BY created').all(t.id); out.mine.log_days = TEAM_LOG_DAYS; }
  // trial_until: hasta cuándo dura la prueba gratis, mientras dure.
  if (owner) { out.mine.billing = TEAM_BILLING && !!t.sub; if (t.status === 'active' && t.trial_until > now()) out.mine.trial_until = t.trial_until; }
  return out;
}
// Quien deja de ser miembro deja de escuchar las notas del equipo en el acto.
function teamCut(spaceId, userId) {
  for (const [key, room] of rooms) if (key.startsWith(spaceId + ':')) for (const c of Array.from(room)) if (c.uid === userId) c.res.end();
}
// Crea el equipo de esa cuenta o lo vuelve a poner al día, con esa cantidad de lugares. sub es la suscripción que
// lo paga, si hay una. Quien ya es miembro de otro equipo no sale de ahí porque llegue un pago a su nombre (lo
// pudo hacer cualquiera): no se crea nada y devuelve null. Su equipo nace cuando sale del otro.
// trialUntil: hasta cuándo dura la prueba gratis, si la suscripción está en prueba.
function teamOpen(user, seats, sub, trialUntil) {
  seats = Math.max(TEAM_MIN, Math.min(TEAM_MAX_SEATS, seats)); const until = Math.max(0, Math.floor(+trialUntil || 0));
  const t = q('SELECT * FROM teams WHERE owner = ?').get(user.id);
  if (!t && teamOf(user.id)) return null;
  db.exec('BEGIN');
  try {
    if (t) {
      q("UPDATE teams SET seats = ?, sub = COALESCE(?, sub), status = 'active', trial_until = ? WHERE id = ?").run(seats, sub || null, until, t.id);
      q("UPDATE users SET plan = 'pro' WHERE id = ?").run(t.space);
    } else {
      const space = Number(q("INSERT INTO users (email, plan, created) VALUES (?, 'pro', ?)").run('team:' + random(12), now()).lastInsertRowid);
      const id = Number(q("INSERT INTO teams (owner, space, seats, sub, status, created, trial_until) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(user.id, space, seats, sub || null, now(), until).lastInsertRowid);
      q("INSERT INTO team_members (team, user, joined, role) VALUES (?, ?, ?, 'admin')").run(id, user.id, now());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return q('SELECT * FROM teams WHERE owner = ?').get(user.id);
}
// El cobro se cayó: el equipo queda, con su gente y sus notas, pero ya no da el plan pago.
function teamShut(t) {
  q("UPDATE teams SET status = 'ended', trial_until = 0 WHERE id = ?").run(t.id);
  q("UPDATE users SET plan = 'free' WHERE id = ?").run(t.space);
  liveTeamSweep(q('SELECT * FROM teams WHERE id = ?').get(t.id));
}
// Un aviso de Paddle sobre la suscripción de un equipo. Los lugares son la cantidad de su ítem (item); si el aviso no
// la trae, quedan los que había. trialUntil: hasta cuándo dura la prueba gratis, o 0.
function teamBilled(user, sub, active, item, trialUntil) {
  if (active) {
    const had = q('SELECT seats FROM teams WHERE owner = ?').get(user.id);
    const t = teamOpen(user, Math.floor(+(item && item.quantity) || 0) || (had ? had.seats : TEAM_MIN), sub, trialUntil);
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

// Administra quien tiene ese papel: quien paga, y quienes nombró. Lo que toca el cobro (los lugares) y la llave del
// espacio protegido es solo de quien paga: ownerTeam.
function adminTeam(user) {
  const t = user.team;
  if (!t) throw new Fail(404, 'no_team');
  if (teamRoleOf(user) !== 'admin') throw new Fail(403, 'not_admin');
  return t;
}
function ownerTeam(user) {
  const t = user.team;
  if (!t) throw new Fail(404, 'no_team');
  if (t.owner !== user.id) throw new Fail(403, teamRoleOf(user) === 'admin' ? 'not_owner' : 'not_admin');
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
  // El papel se elige al invitar. Sin role entra como editor, que es lo que era un miembro hasta ahora.
  const role = body.role == null ? 'editor' : body.role;
  if (!TEAM_ROLES.includes(role)) throw new Fail(400, 'bad_role');
  if (email === user.email) throw new Fail(400, 'own_email');
  if (q('SELECT 1 FROM team_members m JOIN users u ON u.id = m.user WHERE m.team = ? AND u.email = ?').get(t.id, email)) throw new Fail(409, 'already_member');
  const had = q('SELECT id FROM team_invites WHERE team = ? AND email = ?').get(t.id, email);
  if (!had && teamUsed(t) >= t.seats) throw new Fail(409, 'team_full');
  const day = 'tinv:team:' + t.id; const to = 'tinv:to:' + email;
  limit(day, TEAM_INVITES_DAY, DAY, 'invite_day'); limit(to, 3, DAY, 'invite_mail_day');
  mark(day); mark(to);
  if (!had) q('INSERT INTO team_invites (team, email, created, role) VALUES (?, ?, ?, ?)').run(t.id, email, now(), role);
  else q('UPDATE team_invites SET role = ? WHERE id = ?').run(role, had.id);
  // En el registro queda que se invitó y con qué papel, no a qué dirección: todavía no es del equipo.
  teamLog(t, user, 'invite', '', role);
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
  const role = TEAM_ROLES.includes(inv.role) ? inv.role : 'editor';
  q('INSERT INTO team_members (team, user, joined, role) VALUES (?, ?, ?, ?)').run(t.id, user.id, now(), role);
  q('DELETE FROM team_invites WHERE id = ?').run(inv.id);
  teamLog(t, user, 'join', '', role);
  return { ok: true };
}
// Sacar a alguien o salir: deja de ser miembro. Sus notas propias no se tocan y las del equipo quedan en el equipo.
function teamDrop(t, userId, by) {
  if (userId === t.owner) throw new Fail(409, 'owner_stays');
  const r = q('DELETE FROM team_members WHERE team = ? AND user = ?').run(t.id, userId);
  if (!r.changes) throw new Fail(404, 'not_found');
  if (by && by.id !== userId) teamLog(t, by, 'remove', '', '', userId); else teamLog(t, { id: userId }, 'leave', '');
  teamCut(t.space, userId);
  liveTeamSweep(t);
  teamVaultLeft(t, userId);
  // Si tenía paga una suscripción de equipo que esperaba a que saliera de este, su equipo nace ahora, con el mínimo
  // de lugares. El próximo aviso de Paddle trae la cantidad real.
  const paid = q("SELECT id FROM paddle_subs WHERE user = ? AND kind = 'team' AND status = 'active' ORDER BY at DESC LIMIT 1").get(userId);
  if (paid) teamOpen({ id: userId }, TEAM_MIN, paid.id);
  return { ok: true };
}
// Cambiar los lugares es cambiar la cantidad del ítem de la suscripción en Paddle, con el mismo precio que ya tiene.
// Con prorrateo en el momento; durante la prueba gratis no hay nada que cobrar y Paddle solo acepta el cambio sin
// cobro. Nunca menos que los ocupados.
async function teamSeats(user, body) {
  const t = ownerTeam(user); const n = body.seats;
  if (!Number.isInteger(n) || n < TEAM_MIN || n > TEAM_MAX_SEATS) throw new Fail(400, 'bad_seats');
  if (t.status !== 'active') throw new Fail(402, 'team_ended');
  if (!TEAM_BILLING || !t.sub) throw new Fail(409, 'no_billing');
  if (n < teamUsed(t)) throw new Fail(409, 'seats_in_use', '', { used: teamUsed(t) });
  if (n === t.seats) return { ok: true, seats: n };
  if (seatBusy.has(t.id)) throw new Fail(409, 'team_busy');
  limit('tseat:' + t.id, 10, HOUR, 'too_many'); mark('tseat:' + t.id);
  seatBusy.add(t.id);
  try {
    const known = q('SELECT price FROM paddle_subs WHERE id = ?').get(t.sub);
    const items = [{ price_id: (known && known.price) || TEAM_PRICE, quantity: n }];
    const mode = t.trial_until > now() ? 'do_not_bill' : 'prorated_immediately';
    let r = null;
    try { r = await fetch(PADDLE_API + '/subscriptions/' + encodeURIComponent(t.sub), { method: 'PATCH', headers: { authorization: 'Bearer ' + env.PADDLE_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ items, proration_billing_mode: mode }), signal: AbortSignal.timeout(15000) }); }
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
    teamLog(t, user, 'team_name', '');
    return after({ ok: true });
  }
  if (p === '/team/invite' && m === 'POST') return after(await teamInvite(user, await readBody(req)));
  if (p.startsWith('/team/invites/') && m === 'DELETE') { const t = adminTeam(user); if (q('DELETE FROM team_invites WHERE id = ? AND team = ?').run(+p.slice(14), t.id).changes) teamLog(t, user, 'uninvite', ''); return after({ ok: true }); }
  if (p === '/team/accept' && m === 'POST') return after(teamAccept(user, (await readBody(req)).id));
  if (p === '/team/decline' && m === 'POST') { q('DELETE FROM team_invites WHERE id = ? AND email = ?').run(+(await readBody(req)).id, user.email); return after({ ok: true }); }
  if (p === '/team/remove' && m === 'POST') { const t = adminTeam(user); return after(teamDrop(t, +(await readBody(req)).id, user)); }
  if (p === '/team/leave' && m === 'POST') { if (!user.team) throw new Fail(404, 'no_team'); return after(teamDrop(user.team, user.id)); }
  if (p === '/team/seats' && m === 'POST') return after(await teamSeats(user, await readBody(req)));
  // Papeles, políticas, registro de actividad y tokens del equipo: más abajo.
  const more = await teamAdminRoute(user, p, m, req, after);
  if (more) return more;
  if (p === '/team/vault' || p.startsWith('/team/vault/')) return teamVaultRoute(user, p, m, m === 'GET' ? {} : await readBody(req));
  throw new Fail(404, 'no_route');
}
// ---------- Espacio del equipo protegido ----------
// El espacio entero de un equipo se protege con una sola contraseña, que pone quien administra y que los miembros
// reciben por fuera de la app. Es una bóveda más (misma tabla, mismo formato, mismo cifrado en el navegador), a
// nombre de la cuenta interna del equipo y con folder vacío: cubre todas sus notas. Lo que cambia es quién puede qué:
//   - Proteger, cambiar la contraseña, quitar la protección, eliminar el contenido, rotar la llave y decidir si los
//     miembros pueden desbloquear para su IA: solo quien administra. Se mira acá, en cada pedido.
//   - Leer lo que envuelve a la llave (para desbloquear con la contraseña): cualquier miembro. Nadie más.
//   - Un miembro no crea carpetas con contraseña dentro del equipo: /vaults trabaja solo sobre lo propio.
// Rotar la llave: quien administra manda la llave nueva ya envuelta (next) y el espacio pasa a 'rotating'. Su
// navegador vuelve a cifrar cada nota, y mientras tanto los demás miembros no guardan (423 vault_rotating), para
// que nada quede escrito con la llave vieja. Al terminar, lo nuevo reemplaza a lo anterior, y el historial y la
// papelera cifrados con la llave vieja se eliminan.
const TEAM_VAULT_HOUR = 40; // cambios por hora sobre la protección de un equipo
const teamVault = (t) => (t ? q("SELECT * FROM vaults WHERE user = ? AND folder = ''").get(t.space) || null : null);
function teamVaultView(user, t) {
  const v = teamVault(t); if (!v) return null;
  const admin = t.owner === user.id; const k = aiKey(v, user.id);
  const out = { id: v.id, team: true, admin, salt: v.salt, iters: v.iters, wrapped: v.wrapped, check: v.verify, state: v.state, created: v.created, ai: k ? { until: k.until } : null, ai_members: !!v.ai_members };
  // La llave nueva envuelta y el aviso de que alguien salió son de quien administra.
  if (admin) { out.gone = v.gone; if (v.state === 'rotating' && v.next) out.next = JSON.parse(v.next); }
  return out;
}
// Alguien dejó de ser miembro: lo que tenía abierto para su IA se olvida y queda anotado para quien administra.
function teamVaultLeft(t, userId) {
  const v = teamVault(t); if (!v) return;
  aiForget(v, false, userId);
  q('UPDATE vaults SET gone = ? WHERE id = ?').run(now(), v.id);
}
// Mientras se rota la llave, solo guarda quien administra.
function teamHold(user, owner) {
  if (owner.id === user.id || !user.team || user.team.space !== owner.id || user.team.owner === user.id) return;
  const v = teamVault(user.team);
  if (v && v.state === 'rotating') throw new Fail(423, 'vault_rotating', 'The key of this team space is being changed. Try again in a moment.');
}
const wrapOk = (body) => { const iters = +body.iters; return !!b64(body.salt, 16) && !!b64(body.wrapped, 60) && Number.isInteger(iters) && iters >= 100000 && iters <= 10000000; };
// Lo que cambia en la protección queda en el registro de actividad del equipo.
const TEAM_VAULT_ACTS = { 'POST /team/vault': 'protect', 'PUT /team/vault': 'password', 'PUT /team/vault/ai': 'policy', 'POST /team/vault/rotate': 'rotate', 'POST /team/vault/rotate/done': 'rotate_done', 'DELETE /team/vault': 'unprotect', 'POST /team/vault/destroy': 'destroy', 'POST /team/vault/unlock': 'ai_unlock' };
function teamVaultRoute(user, p, m, body) {
  const out = teamVaultDo(user, p, m, body);
  const act = TEAM_VAULT_ACTS[m + ' ' + p];
  if (act) teamLog(user.team, user, act, '', act === 'policy' ? 'ai_unlock=' + (body.members === true ? 'on' : 'off') : '');
  // La plantilla de las notas nuevas se guarda en el servidor, legible: en un espacio protegido no queda.
  if (act === 'protect') teamPolicySave(user.team, { template: '' });
  return out;
}
function teamVaultDo(user, p, m, body) {
  const t = user.team;
  if (!t) throw new Fail(404, 'no_team');
  const view = () => teamVaultView(userById(user.id), t);
  if (p === '/team/vault' && m === 'GET') return { vault: teamVaultView(user, t) };
  const v = teamVault(t);
  const tell = () => announceUser(t.space, { type: 'vault' });
  // Desbloquear y bloquear para la IA: quien administra, o un miembro si quien administra lo permitió.
  if (p === '/team/vault/unlock' && m === 'POST') {
    if (!v) throw new Fail(404, 'not_found');
    if (t.owner !== user.id && !v.ai_members) throw new Fail(403, 'ai_not_allowed', 'The administrator of the team has not allowed members to unlock the team space for their AI');
    if (v.state !== 'on') throw new Fail(409, 'vault', 'The protection of this team space is being changed');
    aiOpen(user, v, body, user.id);
    return { vault: view() };
  }
  if (p === '/team/vault/lock' && m === 'POST') { if (!v) throw new Fail(404, 'not_found'); aiForget(v, true, user.id); return { vault: view() }; }
  // Todo lo demás es de quien paga el equipo: guarda la clave de respaldo, y la rotación la hace un solo navegador.
  ownerTeam(user);
  limit('tvault:' + t.id, TEAM_VAULT_HOUR, HOUR, 'too_many'); mark('tvault:' + t.id);
  if (p === '/team/vault' && m === 'POST') {
    if (v) throw new Fail(409, 'vault_exists');
    if (!wrapOk(body) || !b64(body.check, 32)) throw new Fail(400, 'bad_vault');
    q("INSERT INTO vaults (user, folder, salt, iters, wrapped, verify, created) VALUES (?, '', ?, ?, ?, ?, ?)").run(t.space, body.salt, +body.iters, body.wrapped, body.check, now());
    vaultPurge(t.space, '');
    tell();
    return { vault: view() };
  }
  if (!v) throw new Fail(404, 'not_found');
  if (p === '/team/vault' && m === 'PUT') {
    // Cambiar la contraseña: la misma llave, envuelta de nuevo. Quien salió con la contraseña vieja ya no entra con ella.
    if (v.state === 'rotating') throw new Fail(409, 'vault_rotating');
    if (!wrapOk(body)) throw new Fail(400, 'bad_vault');
    q('UPDATE vaults SET salt = ?, iters = ?, wrapped = ?, gone = 0 WHERE id = ?').run(body.salt, +body.iters, body.wrapped, v.id);
    tell();
    return { vault: view() };
  }
  if (p === '/team/vault/ai' && m === 'PUT') {
    q('UPDATE vaults SET ai_members = ? WHERE id = ?').run(body.members === true ? 1 : 0, v.id);
    if (body.members !== true) aiForgetAll(v, t.owner);
    tell();
    return { vault: view() };
  }
  if (p === '/team/vault/gone' && m === 'DELETE') { q('UPDATE vaults SET gone = 0 WHERE id = ?').run(v.id); return { vault: view() }; }
  if (p === '/team/vault/rotate' && m === 'POST') {
    if (v.state !== 'on') throw new Fail(409, v.state === 'rotating' ? 'vault_rotating' : 'vault');
    if (!wrapOk(body) || !b64(body.check, 32) || body.check === v.verify) throw new Fail(400, 'bad_vault');
    aiForgetAll(v);
    q("UPDATE vaults SET state = 'rotating', next = ? WHERE id = ?").run(JSON.stringify({ salt: body.salt, iters: +body.iters, wrapped: body.wrapped, check: body.check }), v.id);
    tell();
    return { vault: view() };
  }
  if (p === '/team/vault/rotate/done' && m === 'POST') {
    if (v.state !== 'rotating' || !v.next) throw new Fail(409, 'vault');
    const n = JSON.parse(v.next);
    db.exec('BEGIN');
    try {
      q("UPDATE vaults SET salt = ?, iters = ?, wrapped = ?, verify = ?, state = 'on', next = NULL, gone = 0 WHERE id = ?").run(n.salt, n.iters, n.wrapped, n.check, v.id);
      // Lo que quedó cifrado con la llave vieja no se puede leer con la nueva.
      q('DELETE FROM versions WHERE user = ?').run(t.space);
      q('DELETE FROM trash WHERE user = ? AND v = 1').run(t.space);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    scrub(); tell();
    return { vault: view() };
  }
  if (p === '/team/vault/open' && m === 'POST') { if (v.state === 'rotating') throw new Fail(409, 'vault_rotating'); vaultOpening(user, v); return { vault: view() }; }
  if (p === '/team/vault' && m === 'DELETE') { vaultRemove(user, v); return { ok: true, vault: null }; }
  if (p === '/team/vault/destroy' && m === 'POST') {
    // Se confirma con el nombre del equipo o, si no tiene, con el correo de quien administra.
    if (typeof body.name !== 'string' || body.name !== (t.name || user.email)) throw new Fail(400, 'bad_confirm');
    return vaultWipe({ id: t.space }, v);
  }
  throw new Fail(404, 'no_route');
}
// De quién son las notas de un pedido que trae o: propias, o del espacio del equipo de quien llama.
// need 'edit': lo que se pide cambia algo, y en el espacio del equipo eso es de quien administra o edita.
function spaceOf(user, o, need) {
  if (o == null || o === '' || +o === user.id) return user;
  if (user.team && +o === user.team.space) {
    if (need === 'edit' && !teamAllows(user.team, user, 'write')) throw new Fail(403, 'read_only');
    return userById(user.team.space);
  }
  throw new Fail(403, 'no_access');
}

// ---------- Equipos: papeles, políticas, registro de actividad y tokens del equipo ----------
// Tres niveles. Lo personal (apariencia, idioma, herramientas) no pasa por acá: vive en el navegador de cada uno.
// Lo del equipo lo decide quien administra y vale para el espacio: se guarda en teams.policies y se mira en el
// servidor en cada pedido, con teamAllows. El cobro es solo de quien paga (ownerTeam, y teamGuest para no mostrarlo).
//   - Papeles: 'admin', 'editor', 'reader' (ver arriba). Quien paga es admin siempre: no se lo saca ni se le cambia.
//   - Políticas, para quien no administra: share (compartir notas del equipo con cuentas de afuera), links (enlaces
//     públicos), live (sesiones en vivo con invitados), tokens (que su IA alcance el espacio), automation
//     (automatizaciones sobre el espacio). Quien administra puede siempre; quien solo lee, solo 'tokens'. Lo que
//     saca notas del equipo hacia afuera nace apagado. Además: history_days (cuánto dura el historial, hasta
//     TEAM_HISTORY_DAYS), folder y template (la carpeta y el texto con que nace una nota nueva del equipo).
//   - Registro de actividad: quién hizo qué y cuándo en el espacio. Guarda la ruta, la acción, la cuenta y el
//     momento. Nunca el texto de una nota ni el correo de alguien de afuera: de quien actúa guarda el número de
//     cuenta (el correo se busca al leer; si la cuenta ya no existe, sale vacío). Dura TEAM_LOG_DAYS días.
//   - Tokens del equipo: son del equipo, no de una persona. Entran como el espacio (sus notas son la raíz), con
//     carpeta, permiso de escribir y de compartir. Siguen andando si quien los creó se va. No abren un espacio protegido.
const TEAM_ROLES = ['admin', 'editor', 'reader'];
const TEAM_HISTORY_DAYS = Math.max(1, Math.floor(+(env.TEAM_HISTORY_DAYS || 365)) || 365); // historial del espacio del equipo
const TEAM_HISTORY_CHOICES = [30, 90, 180, 365]; // a cuánto lo puede acortar quien administra
const TEAM_LOG_DAYS = Math.max(1, Math.floor(+(env.TEAM_LOG_DAYS || 90)) || 90); // cuánto dura el registro de actividad
const TEAM_ADMIN_HOUR = 120; // cambios de administración por hora y por equipo
const TEAM_LOG_HOUR = 240; // lecturas del registro por hora y por cuenta
const TEAM_LOG_PAGE = 100; const TEAM_LOG_CSV = 5000; const TEAM_LOG_MAX = 200000; // filas por página, por exportación y por equipo
const MAX_TEAM_TOKENS = 30; const TEAM_TEMPLATE_MAX = 20000;
const TEAM_EDIT_GAP = 10 * 60000; // ediciones seguidas de la misma nota por la misma cuenta: una fila cada tanto
for (const col of ['team INTEGER', 'can_write INTEGER NOT NULL DEFAULT 1', 'made_by INTEGER']) { try { db.exec('ALTER TABLE tokens ADD COLUMN ' + col); } catch (e) { /* ya estaba */ } }
// via: '' desde la app, 'ai' con el token de una persona, 'team' con un token del equipo. token: el nombre del token.
// about: la cuenta sobre la que se actuó (a quién se le cambió el papel, a quién se sacó).
db.exec("CREATE TABLE IF NOT EXISTS team_log (id INTEGER PRIMARY KEY, team INTEGER NOT NULL, at INTEGER NOT NULL, uid INTEGER, via TEXT NOT NULL DEFAULT '', token TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', about INTEGER, detail TEXT NOT NULL DEFAULT '')");
db.exec('CREATE INDEX IF NOT EXISTS team_log_at ON team_log (team, at)');

const POLICY_BOOLS = ['share', 'links', 'live', 'tokens', 'automation', 'publish'];
const POLICY_DEFAULT = { share: false, links: false, live: false, tokens: true, automation: false, publish: false, history_days: 0, folder: '', template: '' };
function teamPolicies(t) {
  let raw = {}; try { raw = JSON.parse((t && t.policies) || '{}') || {}; } catch (e) { raw = {}; }
  const out = Object.assign({}, POLICY_DEFAULT);
  for (const k of POLICY_BOOLS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  if (Number.isInteger(raw.history_days) && raw.history_days > 0) out.history_days = Math.min(raw.history_days, TEAM_HISTORY_DAYS);
  if (typeof raw.folder === 'string') out.folder = raw.folder;
  // La plantilla es texto que escribió alguien: con DATA_KEY se guarda cifrada en reposo, como una nota.
  if (typeof raw.template === 'string') { try { out.template = raw.template.startsWith(ENC) ? unseal(raw.template, 1, 'teams.template') : raw.template; } catch (e) { out.template = ''; } }
  return out;
}
// Guarda las políticas con esos cambios encima. Devuelve cómo quedaron.
function teamPolicySave(t, change) {
  const next = Object.assign(teamPolicies(q('SELECT * FROM teams WHERE id = ?').get(t.id)), change);
  q('UPDATE teams SET policies = ? WHERE id = ?').run(JSON.stringify(Object.assign({}, next, { template: next.template ? seal(next.template, 'teams.template') : '' })), t.id);
  t.policies = q('SELECT policies FROM teams WHERE id = ?').get(t.id).policies;
  return next;
}
// El papel de quien llama. Un token del equipo vale como editor o como lector, según se haya creado.
const teamRoleOf = (user) => { if (user.teamToken) return user.canWrite ? 'editor' : 'reader'; const t = user.team; return !t ? null : t.owner === user.id ? 'admin' : TEAM_ROLES.includes(t.my_role) ? t.my_role : 'editor'; };
// Tiene el plan por un equipo que paga otra persona: no se le muestra nada de cobro.
const teamGuest = (user) => !!user.team && user.team.status === 'active' && user.team.owner !== user.id;
const teamLabel = (spaceId) => { const t = q('SELECT name FROM teams WHERE space = ?').get(spaceId); return (t && t.name) || 'Team'; };
// La pregunta que hace todo el servidor antes de dejar hacer algo en el espacio de un equipo: ¿esta cuenta (o este
// token del equipo) puede what? what: 'read', 'write', 'admin', o una política ('share', 'links', 'live', 'tokens',
// 'automation'). Quien no es de ese equipo no puede nada.
function teamAllows(team, user, what) {
  if (!team || !user) return false;
  const mine = user.teamToken ? user.teamToken.team : user.team;
  if (!mine || mine.id !== team.id) return false;
  const role = teamRoleOf(user);
  if (what === 'read') return true;
  if (what === 'admin') return role === 'admin';
  if (what === 'write') return role !== 'reader';
  if (!POLICY_BOOLS.includes(what)) return false;
  if (role === 'admin') return true;
  if (role === 'reader' && what !== 'tokens') return false;
  return teamPolicies(team)[what] === true;
}
const teamHistoryDays = (t) => { const d = teamPolicies(t).history_days; return d ? Math.min(d, TEAM_HISTORY_DAYS) : TEAM_HISTORY_DAYS; };
// El historial vencido: 30 días para las cuentas, y para el espacio de cada equipo lo que diga su política.
function historySweep(only) {
  if (!only) q('DELETE FROM versions WHERE saved < ? AND user NOT IN (SELECT space FROM teams)').run(now() - HISTORY_DAYS * DAY);
  for (const t of only ? [only] : q('SELECT * FROM teams').all()) q('DELETE FROM versions WHERE user = ? AND saved < ?').run(t.space, now() - teamHistoryDays(t) * DAY);
}

// Un token del equipo entra como la cuenta interna del espacio. Con el equipo vencido deja de servir (402, como
// cualquier token sin plan pago); con el equipo eliminado, 401.
function teamTokenUser(tok) {
  const team = q('SELECT * FROM teams WHERE id = ?').get(tok.team);
  const u = team ? userById(team.space) : null; if (!u) return null;
  u.scope = tok.scope || ''; u.canShare = !!tok.share; u.canWrite = !!tok.can_write; u.tokenName = tok.name; u.tokenId = tok.id;
  u.teamToken = { id: tok.id, name: tok.name, team };
  return u;
}
const TEAM_TOKEN_LOCKED = 'The team space is protected with a password, so a token of the team cannot read, search or change its notes. A member can connect their own AI and unlock the space for it from SharpMD.';

// Una fila del registro. Nunca recibe texto de una nota. Una falla al anotar no frena lo que se estaba haciendo.
const logSeen = new Map();
function teamLog(team, user, action, path, detail, about) {
  if (!team) return;
  try {
    const tt = user && user.teamToken; const uid = user && !tt && user.id ? user.id : null;
    // guest: un invitado de una sesión en vivo, con el nombre que eligió. auto: nadie, lo hizo el servidor.
    const guest = user && user.guest ? String(user.guest) : '';
    const via = guest ? 'guest' : user && user.auto ? 'auto' : tt ? 'team' : user && user.tokenName != null ? 'ai' : ''; const token = guest ? guest.slice(0, 60) : via === 'team' || via === 'ai' ? String(user.tokenName || '').slice(0, 60) : '';
    if (action === 'edit' || action === 'ai') {
      const key = team.id + '|' + action + '|' + (uid || '') + '|' + via + '|' + (user && user.tokenId || guest) + '|' + (action === 'edit' ? path : '');
      const last = logSeen.get(key) || 0; const gap = action === 'edit' ? TEAM_EDIT_GAP : HOUR;
      if (now() - last < gap) return;
      logSeen.set(key, now());
    }
    q('INSERT INTO team_log (team, at, uid, via, token, action, path, about, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(team.id, now(), uid, via, token, action, String(path || '').slice(0, 300), about || null, String(detail || '').slice(0, 300));
  } catch (e) { console.error('registro del equipo: no se pudo anotar · ' + String(e && e.message || e).slice(0, 200)); }
}
// La IA entró al espacio: una fila por token y por hora, con el nombre del token.
const teamAiSeen = (team, user) => teamLog(team, user, 'ai', '');
function teamLogSweep() {
  q('DELETE FROM team_log WHERE at < ?').run(now() - TEAM_LOG_DAYS * DAY);
  for (const t of q('SELECT team, COUNT(*) AS n FROM team_log GROUP BY team HAVING n > ?').all(TEAM_LOG_MAX)) q('DELETE FROM team_log WHERE team = ? AND id NOT IN (SELECT id FROM team_log WHERE team = ? ORDER BY id DESC LIMIT ?)').run(t.team, t.team, TEAM_LOG_MAX);
  for (const [k, at] of logSeen) if (now() - at > HOUR) logSeen.delete(k);
}
const TEAM_ACTIONS = ['create', 'edit', 'move', 'delete', 'restore', 'purge', 'empty_trash', 'share', 'unshare', 'link', 'unlink', 'invite', 'uninvite', 'join', 'leave', 'remove', 'role', 'policy', 'team_name', 'protect', 'password', 'rotate', 'rotate_done', 'unprotect', 'destroy', 'ai', 'ai_unlock', 'token_create', 'token_revoke', 'automation', 'automation_remove', 'site', 'publish', 'unpublish', 'live_open', 'live_end', 'live_kick', 'attach', 'detach'];
// Lo que se pide del registro: who (número de cuenta), token (nombre), action, from y to (milisegundos), before (id, para seguir).
function teamLogRows(team, url, max) {
  const g = (k) => url.searchParams.get(k) || '';
  // Cada filtro es un número o un texto ya comprobado, o null si no se pidió. La consulta es fija: no se arma con lo que llega.
  const num = (k, max15) => { const v = g(k); if (!v) return null; if (!(max15 ? /^\d{1,15}$/ : /^\d{1,12}$/).test(v)) throw new Fail(400, 'bad_filter'); return +v; };
  const who = num('who'); const from = num('from', true); const to = num('to', true); const before = num('before');
  const token = g('token') ? g('token').slice(0, 60) : null; const action = g('action') || null;
  if (action && !TEAM_ACTIONS.includes(action)) throw new Fail(400, 'bad_filter');
  // El correo sale de la cuenta, al leer: en el registro no hay ninguno.
  return q('SELECT l.id, l.at, l.uid, l.via, l.token, l.action, l.path, l.detail, u.email AS who, u.name AS who_name, a.email AS about, a.name AS about_name FROM team_log l LEFT JOIN users u ON u.id = l.uid LEFT JOIN users a ON a.id = l.about WHERE l.team = ? AND l.at >= ? AND (? IS NULL OR l.uid = ?) AND (? IS NULL OR l.token = ?) AND (? IS NULL OR l.action = ?) AND (? IS NULL OR l.at >= ?) AND (? IS NULL OR l.at <= ?) AND (? IS NULL OR l.id < ?) ORDER BY l.id DESC LIMIT ?')
    .all(team.id, now() - TEAM_LOG_DAYS * DAY, who, who, token, token, action, action, from, from, to, to, before, before, max)
    .map((r) => ({ id: r.id, at: r.at, uid: r.uid, who: r.who || '', who_name: r.who_name || '', about_name: r.about_name || '', via: r.via, token: r.token, action: r.action, path: r.path, about: r.about || '', detail: r.detail }));
}
// Una celda de CSV. Lo que empieza como una fórmula se guarda con un apóstrofo delante: una planilla no lo ejecuta.
const csvCell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const teamLogCsv = (rows) => ['when,who,via,token,action,path,about,detail'].concat(rows.map((r) => [new Date(r.at).toISOString(), r.who, r.via, r.token, r.action, r.path, r.about, r.detail].map(csvCell).join(','))).join('\r\n') + '\r\n';

// Compartir y crear un enlace público sobre una nota del equipo. owner es la cuenta interna del espacio. Ya se miró
// que quien llama puede (teamAllows). Con alguien del equipo no se comparte: ya la tiene.
function teamShare(team, user, owner, body) {
  const email = cleanEmail(body.email);
  if (q('SELECT 1 FROM team_members m JOIN users u ON u.id = m.user WHERE m.team = ? AND u.email = ?').get(team.id, email)) throw new Fail(409, 'already_member', 'That person is already in the team');
  const r = addShare(owner, body);
  teamLog(team, user, 'share', cleanPath(body.path), (body.kind === 'folder' ? 'folder ' : '') + (body.role === 'edit' ? 'edit' : 'view'));
  return r;
}
function teamLink(team, user, owner, body) {
  const r = addLink(owner, body);
  teamLog(team, user, 'link', cleanPath(body.path), r.protected ? 'password' : '');
  return r;
}
// De quién es lo que se comparte en un pedido que trae o. Con el espacio del equipo, what dice qué se necesita:
// 'share' o 'links' (el papel y la política), o 'see' para ver con quién está compartido (quien administra o edita).
function shareOwner(user, o, what) {
  if (o == null || o === '' || +o === user.id) return user;
  const t = user.team;
  if (!t || +o !== t.space) throw new Fail(403, 'no_access');
  if (what === 'see' ? !teamAllows(t, user, 'write') : !teamAllows(t, user, what)) throw new Fail(403, teamRoleOf(user) === 'reader' ? 'read_only' : 'team_policy', 'The administrator of the team has not allowed this');
  return userById(t.space);
}

async function teamAdminRoute(user, p, m, req, after) {
  const t = user.team; const url = new URL(req.url, 'http://x');
  // Las políticas las lee cualquier miembro (necesita saber con qué nace una nota y qué puede hacer); las cambia quien administra.
  if (p === '/team/policies' && m === 'GET') { if (!t) throw new Fail(404, 'no_team'); return { policies: teamPolicies(t), can: Object.fromEntries(['write'].concat(POLICY_BOOLS).map((k) => [k, teamAllows(t, user, k)])), history_days: teamHistoryDays(t), history_max: TEAM_HISTORY_DAYS }; }
  const known = p === '/team/policies' || p === '/team/role' || p === '/team/log' || p === '/team/tokens' || p.startsWith('/team/tokens/');
  if (!known) return null;
  adminTeam(user);
  if (p === '/team/log' && m === 'GET') {
    const key = 'tlog:' + user.id; limit(key, TEAM_LOG_HOUR, HOUR, 'too_many'); mark(key);
    if (url.searchParams.get('format') === 'csv') return { csv: teamLogCsv(teamLogRows(t, url, TEAM_LOG_CSV)), days: TEAM_LOG_DAYS };
    const rows = teamLogRows(t, url, TEAM_LOG_PAGE + 1);
    return { entries: rows.slice(0, TEAM_LOG_PAGE), more: rows.length > TEAM_LOG_PAGE, days: TEAM_LOG_DAYS };
  }
  if (p === '/team/tokens' && m === 'GET') return q('SELECT k.id, k.name, k.scope, k.share, k.can_write, k.created, k.used, u.email AS by FROM tokens k LEFT JOIN users u ON u.id = k.made_by WHERE k.team = ? ORDER BY k.created DESC, k.id DESC').all(t.id).map((k) => ({ id: k.id, name: k.name, scope: k.scope || '', write: !!k.can_write, share: !!k.share, created: k.created, used: k.used, by: k.by || '' }));
  if (m === 'GET') throw new Fail(404, 'no_route');
  limit('tadm:' + t.id, TEAM_ADMIN_HOUR, HOUR, 'too_many'); mark('tadm:' + t.id);
  if (p === '/team/role' && m === 'POST') {
    const b = await readBody(req); const id = +b.id;
    if (!TEAM_ROLES.includes(b.role)) throw new Fail(400, 'bad_role');
    if (id === t.owner) throw new Fail(409, 'owner_stays');
    const row = q('SELECT role FROM team_members WHERE team = ? AND user = ?').get(t.id, id);
    if (!row) throw new Fail(404, 'not_found');
    if (row.role !== b.role) {
      q('UPDATE team_members SET role = ? WHERE team = ? AND user = ?').run(b.role, t.id, id);
      teamLog(t, user, 'role', '', b.role, id);
      // Quien pasa a solo leer deja de recibir en vivo como alguien que edita: vuelve a entrar con su papel nuevo.
      teamCut(t.space, id);
      liveTeamSweep(t);
    }
    return after({ ok: true });
  }
  if (p === '/team/policies' && m === 'PUT') {
    const b = await readBody(req); const now_ = teamPolicies(t); const change = {};
    for (const k of POLICY_BOOLS) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') throw new Fail(400, 'bad_policy'); change[k] = b[k]; }
    if (b.history_days !== undefined) {
      if (b.history_days !== 0 && !(TEAM_HISTORY_CHOICES.includes(b.history_days) && b.history_days <= TEAM_HISTORY_DAYS)) throw new Fail(400, 'bad_policy');
      change.history_days = b.history_days === TEAM_HISTORY_DAYS ? 0 : b.history_days;
    }
    if (b.folder !== undefined) { if (typeof b.folder !== 'string') throw new Fail(400, 'bad_policy'); const f = b.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim(); change.folder = f ? cleanPath(f) : ''; }
    if (b.template !== undefined) {
      if (typeof b.template !== 'string' || b.template.length > TEAM_TEMPLATE_MAX || b.template.startsWith(ENC) || b.template.startsWith(VAULT)) throw new Fail(400, 'bad_policy');
      if (b.template && teamVault(t)) throw new Fail(409, 'vault', 'A protected team space has no template: the server would store it readable');
      change.template = b.template;
    }
    const changed = Object.keys(change).filter((k) => change[k] !== now_[k]);
    if (changed.length) {
      teamPolicySave(t, change);
      // Del cambio queda cuál fue y, si es un sí o un no o los días, a qué pasó. De la plantilla y la carpeta, solo que cambiaron.
      for (const k of changed) teamLog(t, user, 'policy', '', k === 'template' || k === 'folder' ? k : k + '=' + (typeof change[k] === 'boolean' ? (change[k] ? 'on' : 'off') : change[k] || TEAM_HISTORY_DAYS));
      if (changed.includes('history_days')) historySweep(t);
      // Sin la política, las sesiones en vivo que abrió quien no administra terminan.
      if (changed.includes('live')) liveTeamSweep(t);
    }
    return after({ ok: true, policies: teamPolicies(t) });
  }
  if (p === '/team/tokens' && m === 'POST') {
    if (t.status !== 'active') throw new Fail(402, 'team_ended');
    if (q('SELECT COUNT(*) AS n FROM tokens WHERE team = ?').get(t.id).n >= MAX_TEAM_TOKENS) throw new Fail(429, 'too_many');
    const b = await readBody(req); const name = cleanName(b.name).slice(0, 60);
    const scope = String(b.folder || '').trim() ? cleanPath(String(b.folder).replace(/\/+$/, '')) : '';
    // Leer siempre. Escribir y compartir se piden al crearlo; compartir sin escribir no tiene sentido.
    const write = b.write === true; const share = write && b.share === true; const token = 'mdt_' + random(30);
    const r = q('INSERT INTO tokens (hash, user, name, scope, share, created, team, can_write, made_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(sha(token), t.space, name, scope, share ? 1 : 0, now(), t.id, write ? 1 : 0, user.id);
    teamLog(t, user, 'token_create', scope, name + (write ? (share ? ' · write, share' : ' · write') : ' · read'));
    return { id: Number(r.lastInsertRowid), token, name, scope, write, share, mcp_url: PUBLIC_URL + '/mcp' };
  }
  if (p.startsWith('/team/tokens/') && m === 'DELETE') {
    const row = q('SELECT id, name FROM tokens WHERE id = ? AND team = ?').get(+p.slice(13), t.id);
    if (!row) throw new Fail(404, 'not_found');
    q('DELETE FROM tokens WHERE id = ?').run(row.id);
    teamLog(t, user, 'token_revoke', '', row.name);
    return { ok: true };
  }
  throw new Fail(404, 'no_route');
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
const ACCOUNT_ROWS = ['DELETE FROM notes WHERE user = ?', 'DELETE FROM versions WHERE user = ?', 'DELETE FROM trash WHERE user = ?', 'DELETE FROM comments WHERE user = ?', 'DELETE FROM gallery WHERE user = ?', 'DELETE FROM tokens WHERE user = ?',
  'DELETE FROM sessions WHERE user = ?', 'DELETE FROM vaults WHERE user = ?', 'DELETE FROM paddle_subs WHERE user = ?', 'DELETE FROM shares WHERE owner = ?', 'DELETE FROM links WHERE owner = ?', 'DELETE FROM lives WHERE owner = ?',
  'DELETE FROM site_pages WHERE site IN (SELECT id FROM sites WHERE owner = ?)', 'DELETE FROM sites WHERE owner = ?',
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
    for (const v of vaultsOf(id)) aiForgetAll(v);
  }
  // Y las que abrió sobre notas de un equipo del que es miembro.
  for (const row of q('SELECT * FROM lives WHERE opener = ?').all(user.id)) liveEnd(row, 'closed');
  // Quien era miembro de un equipo con el espacio protegido: su llave abierta para la IA se olvida, y queda anotado que salió.
  if (!own && user.team) teamVaultLeft(user.team, user.id);
  db.exec('BEGIN');
  try {
    if (!own && user.team) q('DELETE FROM team_members WHERE team = ? AND user = ?').run(user.team.id, user.id);
    if (own) { q('DELETE FROM team_members WHERE team = ?').run(own.id); q('DELETE FROM team_invites WHERE team = ?').run(own.id); q('DELETE FROM team_log WHERE team = ?').run(own.id); q('DELETE FROM tokens WHERE team = ?').run(own.id); q('DELETE FROM teams WHERE id = ?').run(own.id); }
    // En el registro de otros equipos, lo que hizo esta cuenta queda sin nombre.
    q('UPDATE team_log SET uid = NULL WHERE uid = ?').run(user.id); q('UPDATE team_log SET about = NULL WHERE about = ?').run(user.id);
    q('UPDATE tokens SET made_by = NULL WHERE made_by = ?').run(user.id);
    for (const id of ids) for (const sql of ACCOUNT_ROWS) q(sql).run(id);
    q('DELETE FROM shares WHERE email = ?').run(user.email);
    q('DELETE FROM team_invites WHERE email = ?').run(user.email);
    q('DELETE FROM feedback WHERE from_email = ?').run(user.email);
    q('DELETE FROM codes WHERE email = ?').run(user.email);
    q('DELETE FROM live_tickets WHERE live NOT IN (SELECT id FROM lives)').run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  scrub(); galleryFresh();
  for (const id of ids) filesDropOwner(id); // sus imágenes adjuntas, del disco y de la tabla
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
// Hasta cuándo dura la prueba gratis de una suscripción en prueba: lo dice su ítem, o la fecha del primer cobro.
const trialEnd = (d, item) => Date.parse((item && item.trial_dates && item.trial_dates.ends_at) || d.next_billed_at || (d.current_billing_period && d.current_billing_period.ends_at) || '') || 0;
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
  // La cuenta de Paddle puede vender otros productos: solo cuentan los precios de SharpMD, por su marca
  // (custom_data.app) o por su id (los configurados: los vigentes, los anteriores y el del equipo).
  const items = (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.price && typeof i.price === 'object');
  if (!items.some((i) => ours(i.price) || PRICES_SOLO.has(i.price.id) || teamPrice(i.price))) return { ok: true, ignored: 'product' };
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
  // De equipo es la suscripción que trae el precio del equipo. Como la cuenta, se decide la primera vez que se la ve.
  const seat = items.find((i) => teamPrice(i.price)) || null;
  const kind = known ? known.kind : (seat ? 'team' : 'solo');
  // La prueba gratis de un equipo es una por cuenta: otra suscripción en prueba no cuenta como al día hasta su primer cobro.
  const trialing = kind === 'team' && d.status === 'trialing'; const again = trialing && teamTried(user.id, id);
  const status = PADDLE_ACTIVE.includes(d.status) && !again ? 'active' : 'ended';
  q("INSERT INTO paddle_subs (id, user, status, at, kind, price, trial) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, at = MAX(at, excluded.at), price = CASE excluded.price WHEN '' THEN price ELSE excluded.price END, trial = MAX(trial, excluded.trial)")
    .run(id, user.id, status, at, kind, kind === 'team' && seat ? String(seat.price.id || '').slice(0, 80) : '', trialing ? 1 : 0);
  // La suscripción de un equipo no toca el plan propio de la cuenta: da el plan pago a sus miembros mientras esté al día.
  if (kind === 'team') {
    if (again) { console.error('paddle: otra prueba gratis de equipo para una cuenta que ya tuvo la suya · ' + id.slice(0, 60)); return Object.assign({ ok: true, trial: 'used' }, teamBilled(user, id, false)); }
    // Counted once per account: the team started (its free trial included), and the first payment once the trial is over.
    if (status === 'active') { statOnce(user.id, STAT_BIT.team, 'team_started'); if (!trialing) statOnce(user.id, STAT_BIT.paid, 'paid'); }
    return Object.assign({ ok: true }, teamBilled(user, id, status === 'active', seat, trialing ? trialEnd(d, seat) : 0));
  }
  // El plan es pago mientras quede alguna suscripción activa de la cuenta. Así, quien paga una suscripción a nombre
  // de otra persona y después la cancela no le saca el plan que esa persona paga por su lado.
  const other = q("SELECT id FROM paddle_subs WHERE user = ? AND status = 'active' AND kind != 'team' ORDER BY at DESC LIMIT 1").get(user.id);
  const plan = other ? 'pro' : 'free';
  q('UPDATE users SET plan = ?, paddle_sub = ? WHERE id = ?').run(plan, other ? other.id : id, user.id);
  if (status === 'active') statOnce(user.id, STAT_BIT.paid, 'paid');
  return { ok: true, plan };
}

// ---------- Galería de la comunidad ----------
// Aportes de la gente, que quedan a la vista de todos recién cuando quien administra el servidor los aprueba.
// Son datos, nunca código: una plantilla es Markdown (la app lo pasa por el mismo saneado que cualquier nota), un
// tema es un puñado de valores de una lista cerrada, y una paleta son seis colores. Acá no entra CSS, ni una
// dirección, ni nada que la app pueda cargar o ejecutar: lo que no calza con el esquema se rechaza entero.
//   { type, name, about, lang, author, data }
//   template  data: { text }                      hasta 20 KB
//   theme     data: { mode, accent, paperLight, paperDark, font, codeColor, diagramShape, surface, text, muted, border, link }   todas opcionales, al menos una
//   palette   data: { colors: { fill, text, border, line, second, third } }
// author es el nombre que eligió quien aporta. El correo de la cuenta no sale nunca por las rutas públicas.
// Cada aporte nuevo manda un correo a FEEDBACK_TO con dos enlaces firmados (HMAC con ADMIN_KEY sobre el aporte, la
// acción, el vencimiento y un valor propio de ese aporte). Abrir un enlace solo muestra una página: decide el botón,
// que manda un POST. Decidido el aporte, los dos enlaces dejan de servir.
const GALLERY_TYPES = ['template', 'theme', 'palette'];
const GALLERY_FONTS = ['Inter', 'System', 'Arial', 'Calibri', 'Verdana', 'Trebuchet MS', 'Georgia', 'Cambria', 'Palatino', 'Times New Roman', 'Consolas', 'Courier New'];
const GALLERY_THEME = ['mode', 'accent', 'paperLight', 'paperDark', 'font', 'codeColor', 'diagramShape', 'surface', 'text', 'muted', 'border', 'link'];
const GALLERY_INK = ['surface', 'text', 'muted', 'border', 'link']; // colores sueltos: van con un modo fijo, y se mira que dejen leer
const GALLERY_COLORS = ['fill', 'text', 'border', 'line', 'second', 'third'];
const GALLERY_HEX = /^#[0-9a-f]{6}$/i;
const MAX_TEMPLATE = 20 * 1024; const GALLERY_DAY = 5; const GALLERY_PAGE = 24; const GALLERY_MINE = 30;
const GALLERY_LINK_MS = 14 * DAY;
const galleryOn = () => !!env.ADMIN_KEY;
// Una línea de texto: sin caracteres de control ni marcas que den vuelta el texto. Se muestra siempre como texto.
const galLine = (v) => (typeof v === 'string' ? v : '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
const galOnly = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => keys.includes(k));
const galLum = (hex) => { const n = parseInt(hex.slice(1), 16); const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
function galleryData(type, d) {
  const bad = () => new Fail(400, 'bad_data');
  const hex = (v) => { if (typeof v !== 'string' || !GALLERY_HEX.test(v)) throw bad(); return v.toLowerCase(); };
  if (type === 'template') {
    if (!galOnly(d, ['text']) || typeof d.text !== 'string') throw bad();
    const text = d.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (!text.trim() || text.startsWith(VAULT)) throw bad();
    if (Buffer.byteLength(text) > MAX_TEMPLATE) throw new Fail(413, 'too_large');
    return { text };
  }
  if (type === 'theme') {
    if (!galOnly(d, GALLERY_THEME) || !Object.keys(d).length) throw bad();
    const out = {};
    if ('mode' in d) { if (!['auto', 'light', 'dark'].includes(d.mode)) throw bad(); out.mode = d.mode; }
    if ('accent' in d) out.accent = hex(d.accent);
    if ('codeColor' in d) out.codeColor = hex(d.codeColor);
    // El fondo va por tema: uno claro para el tema claro y uno oscuro para el oscuro, así el texto siempre se lee.
    if ('paperLight' in d) { out.paperLight = hex(d.paperLight); if (galLum(out.paperLight) < 0.7) throw bad(); }
    if ('paperDark' in d) { out.paperDark = hex(d.paperDark); if (galLum(out.paperDark) > 0.08) throw bad(); }
    if ('font' in d) { if (!GALLERY_FONTS.includes(d.font)) throw bad(); out.font = d.font; }
    if ('diagramShape' in d) { if (!['round', 'square'].includes(d.diagramShape)) throw bad(); out.diagramShape = d.diagramShape; }
    // Los colores de texto, paneles, bordes y enlaces son de un modo solo (claro u oscuro). Es la misma cuenta que hace
    // la app (src/community.js): texto, secundario y enlace a 4.5 o más sobre el fondo, y el panel sin tapar el texto.
    if (GALLERY_INK.some((k) => k in d)) {
      GALLERY_INK.forEach((k) => { if (k in d) out[k] = hex(d[k]); });
      if (out.mode !== 'light' && out.mode !== 'dark') throw bad();
      const dark = out.mode === 'dark'; const ratio = (a, b) => { const x = galLum(a); const y = galLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const paper = (dark ? out.paperDark : out.paperLight) || (dark ? '#121418' : '#fbfaf7');
      const text = out.text || (dark ? '#e6e8ec' : '#1d2026'); const muted = out.muted || (dark ? '#a0a7b4' : '#5c6370');
      if (ratio(text, paper) < 4.5 || ratio(muted, paper) < 4.5) throw bad();
      if (out.surface && (ratio(text, out.surface) < 4.5 || ratio(muted, out.surface) < 4.5)) throw bad();
      if (out.border && ratio(out.border, paper) > ratio(text, paper)) throw bad();
      if (out.link && ratio(out.link, paper) < 4.5) throw bad();
    }
    return out;
  }
  if (!galOnly(d, ['colors']) || !galOnly(d.colors, GALLERY_COLORS) || Object.keys(d.colors).length !== GALLERY_COLORS.length) throw bad();
  const colors = {}; GALLERY_COLORS.forEach((k) => { colors[k] = hex(d.colors[k]); });
  return { colors };
}
function galleryClean(body) {
  if (!galOnly(body, ['type', 'name', 'about', 'lang', 'author', 'data'])) throw new Fail(400, 'bad_schema');
  if (!GALLERY_TYPES.includes(body.type)) throw new Fail(400, 'bad_type');
  const name = galLine(body.name); if (name.length < 3 || name.length > 60) throw new Fail(400, 'bad_name');
  const about = galLine(body.about); if (about.length > 160 || (body.about != null && typeof body.about !== 'string')) throw new Fail(400, 'bad_about');
  if (typeof body.lang !== 'string' || !/^[a-z]{2}$/.test(body.lang)) throw new Fail(400, 'bad_lang');
  // El nombre a mostrar nunca es un correo.
  const author = galLine(body.author); if (author.length < 2 || author.length > 40 || author.includes('@')) throw new Fail(400, 'bad_author');
  return { type: body.type, name, about, lang: body.lang, author, data: galleryData(body.type, body.data) };
}

const galSeal = (item) => ['name', 'about', 'author', 'data', 'reason'].map((c) => seal(c === 'data' ? JSON.stringify(item.data) : item[c] || '', 'gallery.' + c));
function galleryOpen(row) {
  const col = (c) => unseal(row[c], row.e, 'gallery.' + c);
  return { id: row.id, user: row.user, type: row.type, name: col('name'), about: col('about'), lang: row.lang, author: col('author'), data: JSON.parse(col('data')), reason: col('reason') || '', status: row.status, adds: row.adds, created: row.created, decided: row.decided, nonce: row.nonce };
}
const galleryGet = (id) => { const row = Number.isInteger(id) && id > 0 ? q('SELECT * FROM gallery WHERE id = ?').get(id) : null; return row ? galleryOpen(row) : null; };
// Lo que ve cualquiera: ni la cuenta ni su correo. En la lista, una plantilla va sin su texto (se pide de a una).
const galleryPublic = (it, full) => Object.assign({ id: it.id, type: it.type, name: it.name, about: it.about, lang: it.lang, author: it.author, adds: it.adds, at: it.decided || it.created },
  it.type === 'template' && !full ? { size: it.data.text.length } : { data: it.data });
const galleryOwn = (it) => ({ id: it.id, type: it.type, name: it.name, about: it.about, lang: it.lang, author: it.author, status: it.status, reason: it.status === 'pending' || it.status === 'approved' ? '' : it.reason, adds: it.adds, created: it.created });
// Lo aprobado, ya abierto, en memoria: la lista pública no toca la base en cada pedido.
let galleryCache = null;
const galleryFresh = () => { galleryCache = null; };
const galleryLive = () => { if (!galleryCache) galleryCache = q("SELECT * FROM gallery WHERE status = 'approved'").all().map(galleryOpen); return galleryCache; };

function galleryList(url) {
  const type = url.searchParams.get('type') || ''; const lang = url.searchParams.get('lang') || '';
  const text = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
  let rows = galleryLive().filter((it) => (!type || it.type === type) && (!lang || it.lang === lang) && (!text || (it.name + '\n' + it.about + '\n' + it.author).toLowerCase().includes(text)));
  rows = rows.slice().sort(url.searchParams.get('sort') === 'new' ? (a, b) => b.decided - a.decided : (a, b) => b.adds - a.adds || b.decided - a.decided);
  const pages = Math.max(1, Math.ceil(rows.length / GALLERY_PAGE)); const page = Math.min(pages, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
  return { items: rows.slice((page - 1) * GALLERY_PAGE, page * GALLERY_PAGE).map((it) => galleryPublic(it)), total: rows.length, page, pages, open: galleryOn(), __cache: 'public, max-age=60' };
}

// Los enlaces del correo. La firma cubre el aporte, la acción, el vencimiento y el valor propio del aporte.
const gallerySig = (id, act, exp, nonce) => crypto.createHmac('sha256', String(env.ADMIN_KEY)).update(['gallery-review', id, act, exp, nonce].join('|')).digest('base64url');
const galleryLink = (it, act) => { const exp = now() + GALLERY_LINK_MS; return PUBLIC_URL + '/gallery/review?id=' + it.id + '&act=' + act + '&exp=' + exp + '&sig=' + gallerySig(it.id, act, exp, it.nonce); };
// Un enlace sirve si la firma es de este servidor, no venció y el aporte sigue pendiente. Todo lo demás falla igual.
function galleryTicket(get) {
  const id = parseInt(get('id'), 10); const act = get('act'); const exp = parseInt(get('exp'), 10); const sig = String(get('sig') || '');
  const it = galleryOn() && (act === 'approve' || act === 'reject') && exp > now() ? galleryGet(id) : null;
  if (!it || it.status !== 'pending' || !it.nonce || !same(sig, gallerySig(id, act, exp, it.nonce))) return null;
  return { it, act, exp, sig };
}
function galleryDecide(it, status, reason) {
  const why = status === 'approved' ? '' : galLine(reason).slice(0, 300);
  q("UPDATE gallery SET status = ?, reason = ?, decided = ?, nonce = '' WHERE id = ?").run(status, seal(why, 'gallery.reason'), now(), it.id);
  galleryFresh();
  return { ok: true, id: it.id, status };
}

const hEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const galleryText = (it) => (it.type === 'template' ? it.data.text : JSON.stringify(it.data, null, 2));
// Los colores de un tema o de una paleta, para verlos en la página de revisión. Ya pasaron por el esquema.
const gallerySwatches = (it) => { const d = it.type === 'palette' ? it.data.colors : it.type === 'theme' ? it.data : {}; return Object.keys(d).filter((k) => GALLERY_HEX.test(d[k])).map((k) => '<span class="sw"><i style="background:' + d[k] + '"></i>' + hEsc(k) + '</span>').join(''); };
const galleryPage = (title, inner, status) => ({ __status: status || 200, __html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + hEsc(title) + '</title><style>' +
  'body{margin:0;padding:24px 16px;background:#f4f3ee;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2026}main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #dedbd2;border-radius:14px;padding:24px}' +
  'h1{font-size:18px;margin:0 0 14px}h1 b{color:#4d7c0f}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0 0 14px}dt{color:#5c6370}dd{margin:0;overflow-wrap:anywhere}' +
  'pre{background:#f1efe9;border-radius:10px;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,Consolas,Menlo,monospace;max-height:60vh;overflow:auto}' +
  '.sw{display:inline-flex;align-items:center;gap:6px;margin:0 12px 8px 0;font-size:13px;color:#5c6370}.sw i{width:22px;height:22px;border-radius:6px;border:1px solid #dedbd2}' +
  'textarea{display:block;width:100%;box-sizing:border-box;min-height:70px;margin:6px 0 14px;padding:8px;border:1px solid #dedbd2;border-radius:8px;font:inherit}' +
  'button{font:600 15px/1 inherit;padding:12px 20px;border:0;border-radius:10px;color:#fff;background:#4d7c0f;cursor:pointer}button.no{background:#b42318}p{margin:0 0 12px}.muted{color:#5c6370;font-size:13px}' +
  '</style></head><body><main><h1><b>#</b> SharpMD gallery</h1>' + inner + '</main></body></html>' });
const galleryGone = () => galleryPage('SharpMD gallery', '<p>This link no longer works. It was already used, it expired, or the contribution was withdrawn.</p>', 403);
function galleryReviewPage(t) {
  const it = t.it; const owner = userById(it.user);
  return galleryPage((t.act === 'approve' ? 'Approve' : 'Reject') + ' · ' + it.name,
    '<dl><dt>Type</dt><dd>' + hEsc(it.type) + '</dd><dt>Name</dt><dd>' + hEsc(it.name) + '</dd><dt>About</dt><dd>' + hEsc(it.about || '-') + '</dd><dt>Language</dt><dd>' + hEsc(it.lang) + '</dd>' +
    '<dt>Shown author</dt><dd>' + hEsc(it.author) + '</dd><dt>Account</dt><dd>' + hEsc(owner ? owner.email : '-') + '</dd></dl>' +
    '<div>' + gallerySwatches(it) + '</div><pre>' + hEsc(galleryText(it)) + '</pre>' +
    '<form method="post" action="/gallery/review"><input type="hidden" name="id" value="' + it.id + '"><input type="hidden" name="act" value="' + t.act + '"><input type="hidden" name="exp" value="' + t.exp + '"><input type="hidden" name="sig" value="' + hEsc(t.sig) + '">' +
    (t.act === 'reject' ? '<label>Reason (optional, the sender sees it)<textarea name="reason" maxlength="300"></textarea></label><button class="no" type="submit">Reject</button>'
      : '<p class="muted">Once approved it is public for everyone, under the shown author.</p><button type="submit">Approve and publish</button>') + '</form>');
}

function galleryNotify(text) {
  const url = String(env.GALLERY_NOTIFY_URL || '').trim(); if (!/^https?:\/\//i.test(url)) return;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) }).catch(() => { /* el aviso es de cortesía: el aporte ya quedó guardado */ });
}
async function gallerySubmit(req, user, body) {
  if (!galleryOn()) throw new Fail(404, 'no_route');
  const item = galleryClean(body);
  const keys = [['gal:user:' + user.id, GALLERY_DAY], ['gal:ip:' + clientIp(req), GALLERY_DAY * 4]];
  keys.forEach((k) => limit(k[0], k[1], DAY, 'too_many'));
  if (q('SELECT COUNT(*) AS n FROM gallery WHERE user = ?').get(user.id).n >= GALLERY_MINE) throw new Fail(409, 'gallery_full');
  keys.forEach((k) => mark(k[0]));
  const sealed = galSeal(item);
  const id = Number(q("INSERT INTO gallery (user, type, name, about, lang, author, data, reason, e, status, nonce, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)").run(user.id, item.type, sealed[0], sealed[1], item.lang, sealed[2], sealed[3], sealed[4], SEALED, random(18), now()).lastInsertRowid);
  const it = galleryGet(id);
  if (env.FEEDBACK_TO) {
    const mail = { to: env.FEEDBACK_TO, reply_to: user.email, subject: 'SharpMD gallery: ' + it.type + ' "' + it.name + '"',
      text: 'New contribution to the gallery, waiting for review.\n\nType: ' + it.type + '\nName: ' + it.name + '\nAbout: ' + (it.about || '-') + '\nLanguage: ' + it.lang + '\nShown author: ' + it.author +
        '\nAccount: ' + user.email + ' (' + user.plan + ' plan)\nId: ' + it.id + '\n\nApprove: ' + galleryLink(it, 'approve') + '\nReject: ' + galleryLink(it, 'reject') +
        '\n\nEach link opens a page that asks to confirm. They work once and expire in 14 days.\n\n--- content ---\n' + galleryText(it) + '\n' };
    // Si el correo no sale, el aporte queda pendiente igual: se ve con GET /admin/gallery.
    try { await sendMail(mail); } catch (e) { console.error('galería: no salió el correo de revisión del aporte ' + it.id); }
  }
  galleryNotify('SharpMD gallery: new ' + it.type + ' waiting for review (' + it.name.slice(0, 60) + ')');
  return galleryOwn(it);
}

// Sumar un aporte: cuenta una vez por IP y por día para cada aporte. El número es anónimo: no se guarda quién.
function galleryAdd(req, id) {
  const it = galleryLive().find((x) => x.id === id); if (!it) throw new Fail(404, 'not_found');
  const ip = clientIp(req); const all = 'galadd:ip:' + ip; const one = 'galadd:' + id + ':' + ip;
  limit(all, 60, HOUR, 'too_many'); mark(all);
  if (!over(one, 1, DAY)) { mark(one); q('UPDATE gallery SET adds = adds + 1 WHERE id = ?').run(id); it.adds += 1; }
  return { ok: true, adds: it.adds };
}

// Las rutas de la galería. Las públicas primero; las que siguen piden sesión.
async function galleryRoute(req, url, p, m) {
  const ip = clientIp(req); const num = /^\/gallery\/(\d{1,12})(\/add)?$/.exec(p);
  rate('gal:req:' + ip, 300, 60000, 'too_many');
  if (p === '/gallery' && m === 'GET') return galleryList(url);
  if (p === '/gallery/review' && (m === 'GET' || m === 'POST')) {
    // Los intentos con un enlace que no sirve tienen tope por IP, como la clave de administración.
    const key = 'galrev:' + ip; if (over(key, 20, HOUR)) return galleryPage('SharpMD gallery', '<p>Too many attempts. Try again later.</p>', 429);
    const form = m === 'POST' ? new URLSearchParams(await readRaw(req, 8192)) : url.searchParams;
    const t = galleryTicket((k) => form.get(k));
    if (!t) { mark(key); return galleryGone(); }
    if (m === 'GET') return galleryReviewPage(t);
    galleryDecide(t.it, t.act === 'approve' ? 'approved' : 'rejected', form.get('reason'));
    return galleryPage('SharpMD gallery', '<p>' + (t.act === 'approve' ? 'Approved. It is now public in the gallery.' : 'Rejected. The sender sees it in the app.') + '</p><p class="muted">' + hEsc(t.it.name) + '</p>');
  }
  if (num && !num[2] && m === 'GET') { const it = galleryLive().find((x) => x.id === +num[1]); if (!it) throw new Fail(404, 'not_found'); return Object.assign(galleryPublic(it, true), { __cache: 'public, max-age=60' }); }
  if (num && num[2] && m === 'POST') return galleryAdd(req, +num[1]);
  const user = userFrom(req, 'session');
  if (p === '/gallery' && m === 'POST') return gallerySubmit(req, user, await readBody(req));
  if (p === '/gallery/mine' && m === 'GET') return q('SELECT * FROM gallery WHERE user = ? ORDER BY created DESC LIMIT ?').all(user.id, GALLERY_MINE).map((r) => galleryOwn(galleryOpen(r)));
  // Retirar un aporte propio, esté como esté: se borra del todo.
  if (num && !num[2] && m === 'DELETE') { const r = q('DELETE FROM gallery WHERE id = ? AND user = ?').run(+num[1], user.id); if (!r.changes) throw new Fail(404, 'not_found'); galleryFresh(); return { ok: true }; }
  return null;
}
// Con la clave de administración: ver lo que espera (o lo de otro estado), aprobar, rechazar y retirar algo ya publicado.
function galleryAdmin(m, url, body) {
  if (m === 'GET') {
    const status = ['pending', 'approved', 'rejected', 'removed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    return q('SELECT * FROM gallery WHERE status = ? ORDER BY created DESC LIMIT 200').all(status).map((r) => { const it = galleryOpen(r); const owner = userById(it.user); return Object.assign(galleryOwn(it), { reason: it.reason, data: it.data, account: owner ? owner.email : '' }); });
  }
  if (m !== 'POST') throw new Fail(405, 'method_not_allowed');
  const it = galleryGet(body.id); if (!it) throw new Fail(404, 'not_found');
  const next = { approve: 'approved', reject: 'rejected', remove: 'removed' }[body.action]; if (!next) throw new Fail(400, 'bad_action');
  return galleryDecide(it, next, body.reason);
}

// ====================================================================================================================
// AUTOMATIZACIONES
// Para conectar SharpMD con flujos de afuera (Make, n8n, Activepieces, Zapier, Slack). Cuatro piezas:
//   1. Tableros con atributos: cada tarjeta de un bloque kanban tiene id, fechas y atributos propios.
//   2. Webhooks salientes: lo que pasa con una nota o con una tarjeta sale, firmado, a una dirección https.
//   3. Direcciones de entrada: una dirección secreta que agrega texto a una nota, crea una nota o una tarjeta.
//   4. API REST con token, bajo /api/v1, que comparte sus reglas con las herramientas del MCP.
// Las cuatro son del plan pago (como el MCP). Las notas de una carpeta protegida quedan afuera: no generan
// eventos, no reciben entradas y la API las trata como el MCP (solo con la carpeta desbloqueada para la IA).
// Variables:
//   WEBHOOK_ALLOW_PRIVATE=1  deja mandar webhooks a destinos http o de red privada. Solo para pruebas o un servidor
//                            propio dentro de una red de confianza: con esto el servidor puede llamar a cualquier
//                            dirección interna que alguien con cuenta le pida
//   WEBHOOK_RETRY_MS         esperas entre reintentos, en milisegundos y separadas por coma (60000,300000,900000,2400000:
//                            cinco intentos en una hora)
//   WEBHOOK_MAX_FAILS        intentos fallidos seguidos que desactivan un webhook (15)
//   WEBHOOK_TIMEOUT_MS       cuánto espera cada entrega (8000)
//   WEBHOOK_UPDATE_WAIT_MS   cuánto espera note.updated para juntar los guardados seguidos de una misma nota (10000)
//   API_PER_MINUTE           pedidos por minuto de cada token en /api/v1 (120)
//   INBOX_PER_MINUTE         pedidos por minuto de cada dirección de entrada (60)
// ====================================================================================================================

// ---------- Quién hace el pedido ----------
// Cada pedido lleva su contexto: la cuenta que llamó y por dónde (app, api, mcp, inbox). Con eso un evento dice quién
// lo causó sin que las funciones de las notas tengan que recibirlo.
const reqCtx = new AsyncLocalStorage();
const ctxSet = (k, v) => { const st = reqCtx.getStore(); if (st) st[k] = v; return v; };
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

// ---------- Tableros: el mismo formato que lee y escribe src/board.js ----------
// Un tablero es un bloque ```kanban. Cada título es una columna y cada tarea una tarjeta. Al final de la tarjeta
// puede haber un grupo entre llaves con sus atributos: {due=2026-10-20 owner="Ana Paz" id=c8k2m9xq created=… updated=…}.
// id, created y updated los pone el programa; el resto es de la persona. Antes de la primera columna, un renglón
// solo con llaves configura el tablero: {show=due,owner priority=low|medium|high estimate=number}.
// Lo que no se entiende se deja como texto: una tarjeta sin llaves es una tarjeta sin atributos.
const KB_NAMES = /^(kanban|tablero|board)$/i;
const KB_KEY = /^[\p{L}_][\p{L}\p{N}_.-]{0,39}$/u;
const KB_RESERVED = new Set(['id', 'created', 'updated', 'show', 'by']);
// En el renglón de configuración: done= es la columna de hechas y tags= el color de cada etiqueta. No son campos.
const KB_TAGCFG = /^[^:,]+:(?:gray|red|orange|yellow|green|teal|blue|purple|pink)(?:,[^:,]+:(?:gray|red|orange|yellow|green|teal|blue|purple|pink))*$/;
const KB_ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const kbId = () => { let s = ''; for (const b of crypto.randomBytes(8)) s += KB_ALPHA[b % 32]; return s; };
function kbPairs(inner) {
  const re = /\s*([\p{L}_][\p{L}\p{N}_.-]{0,39})=(?:"((?:[^"\\]|\\.)*)"|([^\s"]*))(?=\s|$)/uy; const out = []; let at = 0; let m;
  while ((m = re.exec(inner))) { out.push([m[1], m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]]); at = re.lastIndex; }
  return out.length && !inner.slice(at).trim() ? out : null;
}
function kbSplit(raw) {
  const m = /^(.*\S)\s*\{([^{}]*)\}\s*$/.exec(raw); const pairs = m && kbPairs(m[2]);
  return pairs ? { text: m[1].trim(), pairs } : { text: raw, pairs: [] };
}
const kbVal = (v) => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return /^[^\s"{}=\\]+$/.test(v) ? v : '"' + v.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; };
const kbType = (v) => (/^(text|longtext|date|number)$/.test(v) ? { type: v } : { type: 'select', options: v.split('|').map((s) => s.trim()).filter(Boolean) });
function kbParse(lines) {
  const board = { show: [], fields: {}, columns: [] }; let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (h) { cur = { title: h[1].trim(), cards: [] }; board.columns.push(cur); continue; }
    const c = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (!c) {
      const cfg = !cur && /^\s*\{([^{}]*)\}\s*$/.exec(line); const pairs = cfg && kbPairs(cfg[1]);
      if (pairs) for (const [k, v] of pairs) { if (k === 'show') board.show = v.split(',').map((s) => s.trim()).filter(Boolean); else if (k === 'done') board.done = v; else if (k === 'tags' && KB_TAGCFG.test(v)) board.tags = v; else if (!KB_RESERVED.has(k)) board.fields[k] = kbType(v); }
      continue;
    }
    if (!c[2].trim()) continue;
    if (!cur) { cur = { title: 'To do', cards: [] }; board.columns.push(cur); }
    const s = kbSplit(c[2].trim()); const card = { id: '', text: s.text, done: !!c[1] && c[1] !== ' ', created: '', updated: '', by: '', attrs: {} };
    for (const [k, v] of s.pairs) { if (k === 'id') card.id = v; else if (k === 'created') card.created = v; else if (k === 'updated') card.updated = v; else if (k === 'by') card.by = v; else if (k !== 'show') card.attrs[k] = v; }
    cur.cards.push(card);
  }
  return board;
}
function kbCardLine(card) {
  const pairs = Object.keys(card.attrs).map((k) => k + '=' + kbVal(card.attrs[k]));
  if (card.id) pairs.push('id=' + kbVal(card.id)); if (card.created) pairs.push('created=' + kbVal(card.created)); if (card.by) pairs.push('by=' + kbVal(card.by)); if (card.updated) pairs.push('updated=' + kbVal(card.updated));
  return '- [' + (card.done ? 'x' : ' ') + '] ' + card.text.replace(/\s*\n\s*/g, ' ').trim() + (pairs.length ? ' {' + pairs.join(' ') + '}' : '');
}
function kbWrite(board) {
  const out = []; const cfg = [];
  if (board.show.length) cfg.push('show=' + kbVal(board.show.join(',')));
  for (const k of Object.keys(board.fields)) { const f = board.fields[k]; cfg.push(k + '=' + kbVal(f.type === 'select' ? f.options.join('|') : f.type)); }
  if (board.done != null) cfg.push('done=' + kbVal(board.done));
  if (board.tags) cfg.push('tags=' + kbVal(board.tags));
  if (cfg.length) out.push('{' + cfg.join(' ') + '}');
  board.columns.forEach((col, i) => {
    if (i) out.push('');
    out.push('## ' + (col.title.trim() || 'Column'));
    for (const card of col.cards) if (card.text.trim()) out.push(kbCardLine(card));
  });
  return out;
}
// Los bloques kanban de un texto: dónde empieza y termina cada uno (renglones de las cercas) y su tablero.
function kbBlocks(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n'; const lines = String(text).split(/\r?\n/); const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(lines[i]); if (!m) continue;
    const close = new RegExp('^ {0,3}' + m[1][0] + '{' + m[1].length + ',}\\s*$'); let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (KB_NAMES.test(m[2])) blocks.push({ from: i, to: j, board: kbParse(lines.slice(i + 1, j)) });
    i = j;
  }
  return { lines, eol, blocks };
}
const kbHas = (text) => /(^|\n) {0,3}(`{3,}|~{3,})\s*(kanban|tablero|board)\b/i.test(text);
// Las tarjetas sin id reciben uno y su fecha de creación. Devuelve si cambió algo.
function kbStamp(board, at) { let n = 0; for (const col of board.columns) for (const c of col.cards) if (!c.id) { c.id = kbId(); if (!c.created) c.created = at; n++; } return n; }
const kbCard = (card, column, ref) => Object.assign({ id: card.id || null }, ref ? { ref } : {}, { title: card.text, column, done: card.done, created: card.created || null, updated: card.updated || card.created || null, attrs: Object.assign({}, card.attrs) });
const kbView = (text) => kbBlocks(text).blocks.map((b, bi) => ({ index: bi, show: b.board.show, fields: b.board.fields,
  columns: b.board.columns.map((col, ci) => ({ title: col.title, cards: col.cards.map((c, ki) => kbCard(c, col.title, bi + '.' + ci + '.' + ki)) })) }));
// Todas las tarjetas de un texto, en fila: de qué tablero y columna es cada una.
function kbFlat(text) {
  const out = [];
  kbBlocks(text).blocks.forEach((b, bi) => b.board.columns.forEach((col, ci) => col.cards.forEach((card, ki) => out.push({ card, bi, ci, ki, column: col.title, titles: b.board.columns.map((x) => x.title) }))));
  return out;
}
// Qué pasó con las tarjetas entre dos versiones de una nota. Se emparejan por id; las que no tienen id (un tablero
// viejo, o uno escrito a mano) por su texto, y si tampoco, por su lugar.
function kbDiff(before, after) {
  const a = kbFlat(before); const b = kbFlat(after); const pair = new Map(); const taken = new Set();
  const match = (same) => { for (const x of a) { if (pair.has(x)) continue; const y = b.find((n) => !taken.has(n) && same(x, n)); if (y) { pair.set(x, y); taken.add(y); } } };
  match((x, y) => x.card.id && x.card.id === y.card.id);
  match((x, y) => !x.card.id && x.card.text === y.card.text && x.bi === y.bi && x.ci === y.ci);
  match((x, y) => !x.card.id && x.card.text === y.card.text);
  match((x, y) => !x.card.id && x.bi === y.bi && x.ci === y.ci && x.ki === y.ki);
  const events = [];
  for (const y of b) if (!taken.has(y)) events.push({ type: 'card.created', data: { card: kbCard(y.card, y.column), board: y.bi } });
  for (const x of a) {
    const y = pair.get(x);
    if (!y) { events.push({ type: 'card.deleted', data: { card: kbCard(x.card, x.column), board: x.bi } }); continue; }
    const card = kbCard(y.card, y.column);
    // Una columna a la que le cambiaron el nombre no mueve sus tarjetas.
    const renamed = x.ci === y.ci && x.bi === y.bi && !y.titles.includes(x.column);
    if (x.column !== y.column && !renamed) events.push({ type: 'card.moved', data: { card, from: x.column, to: y.column, board: y.bi } });
    if (!x.card.done && y.card.done) events.push({ type: 'card.done', data: { card, board: y.bi } });
    const changes = {};
    if (x.card.text !== y.card.text) changes.title = { from: x.card.text, to: y.card.text };
    if (x.card.done && !y.card.done) changes.done = { from: true, to: false };
    for (const k of new Set(Object.keys(x.card.attrs).concat(Object.keys(y.card.attrs)))) { const from = k in x.card.attrs ? x.card.attrs[k] : null; const to = k in y.card.attrs ? y.card.attrs[k] : null; if (from !== to) changes[k] = { from, to }; }
    if (Object.keys(changes).length) events.push({ type: 'card.updated', data: { card, changes, board: y.bi } });
  }
  return events;
}
// Reescribe un tablero dentro del texto de la nota.
function kbSave(parsed, block) { const body = kbWrite(block.board); return parsed.lines.slice(0, block.from + 1).concat(body, parsed.lines.slice(block.to)).join(parsed.eol); }
const kbText = (v, max, code) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); if (!s || s.length > max) throw new Fail(400, code); return s; };
function kbAttrs(card, attrs) {
  if (attrs == null) return;
  if (typeof attrs !== 'object' || Array.isArray(attrs)) throw new Fail(400, 'bad_attrs', 'attrs is an object of key and value');
  for (const k of Object.keys(attrs)) {
    if (!KB_KEY.test(k) || KB_RESERVED.has(k)) throw new Fail(400, 'bad_attr_key', 'Attribute keys start with a letter, have no spaces and are not id, created, updated or show: ' + k.slice(0, 40));
    const v = attrs[k];
    if (v == null || v === '') { delete card.attrs[k]; continue; }
    if (typeof v === 'object') throw new Fail(400, 'bad_attrs', 'Attribute values are text, numbers or true/false');
    card.attrs[k] = String(v).replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  if (Object.keys(card.attrs).length > 30) throw new Fail(400, 'too_many_attrs', 'A card holds up to 30 attributes');
}
const kbColumn = (board, title, make) => { const t = kbText(title, 120, 'bad_column'); let col = board.columns.find((c) => c.title === t) || board.columns.find((c) => c.title.toLowerCase() === t.toLowerCase()); if (!col && make) { col = { title: t, cards: [] }; board.columns.push(col); } if (!col) throw new Fail(404, 'column_not_found', 'There is no column called ' + t); return col; };
// Una operación sobre las tarjetas de una nota. Devuelve el texto nuevo y la tarjeta tocada. op: create, update, delete.
const KB_DONE_NAMES = /^(done|complete|completed|finished|closed|shipped|hecho|hecha|hechos|hechas|listo|lista|listos|listas|terminado|terminada|terminados|terminadas|completado|completada|completados|completadas|finalizado|finalizada|finalizados|finalizadas|cerrado|cerrada|cerrados|cerradas)$/i;
function kbDoneColumn(board) {
  const cols = board.columns;
  if (board.done === '') return null;
  if (board.done != null) { const want = String(board.done).toLowerCase(); const hit = cols.find((c) => c.title === board.done) || cols.find((c) => c.title.toLowerCase() === want); if (hit) return hit; }
  return cols.find((c) => KB_DONE_NAMES.test(c.title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim())) || null;
}
function kbApply(text, op, args) {
  const parsed = kbBlocks(text); const at = isoNow();
  if (!parsed.blocks.length) throw new Fail(404, 'no_board', 'This note has no kanban board');
  if (op === 'create') {
    const bi = args.board == null ? 0 : +args.board; const block = parsed.blocks[bi];
    if (!block) throw new Fail(404, 'no_board', 'This note has no board number ' + args.board);
    const col = args.column == null || args.column === '' ? block.board.columns[0] || kbColumn(block.board, 'To do', true) : kbColumn(block.board, args.column, true);
    const card = { id: kbId(), text: kbText(args.title, 500, 'bad_title'), done: args.done === true, created: at, updated: at, attrs: {} };
    kbAttrs(card, args.attrs);
    if (args.done == null && kbDoneColumn(block.board) === col) card.done = true;
    if (args.position === 'top') col.cards.unshift(card); else col.cards.push(card);
    kbStamp(block.board, at);
    return { text: kbSave(parsed, block), card: kbCard(card, col.title), board: bi };
  }
  const want = String(args.id == null ? '' : args.id); const ref = /^(\d+)\.(\d+)\.(\d+)$/.exec(want); let hit = null;
  parsed.blocks.forEach((block, bi) => block.board.columns.forEach((col, ci) => col.cards.forEach((card, ki) => { if (!hit && want && (card.id === want || (ref && +ref[1] === bi && +ref[2] === ci && +ref[3] === ki))) hit = { block, bi, col, ki, card }; })));
  if (!hit) throw new Fail(404, 'card_not_found', 'There is no card with that id in this note');
  const { block, card } = hit; let col = hit.col;
  if (op === 'delete') { col.cards.splice(hit.ki, 1); kbStamp(block.board, at); return { text: kbSave(parsed, block), card: kbCard(card, col.title), board: hit.bi }; }
  const was = JSON.stringify([card.text, card.done, card.attrs, col.title]);
  if (args.title != null) card.text = kbText(args.title, 500, 'bad_title');
  if (args.done != null) card.done = args.done === true || args.done === 'true' || args.done === 1;
  kbAttrs(card, args.attrs);
  if (args.column != null && args.column !== '') {
    const to = kbColumn(block.board, args.column, true);
    if (to !== col || args.position) {
      const doneCol = kbDoneColumn(block.board);
      if (to !== col && args.done == null && doneCol) { if (to === doneCol) card.done = true; else if (col === doneCol) card.done = false; }
      col.cards.splice(col.cards.indexOf(card), 1); if (args.position === 'top') to.cards.unshift(card); else to.cards.push(card); col = to;
    }
  }
  kbStamp(block.board, at);
  if (JSON.stringify([card.text, card.done, card.attrs, col.title]) !== was) card.updated = at;
  return { text: kbSave(parsed, block), card: kbCard(card, col.title), board: hit.bi };
}

// ---------- Eventos ----------
const EVENT_TYPES = ['note.created', 'note.updated', 'note.deleted', 'note.restored', 'note.moved', 'comment.created', 'comment.resolved', 'card.created', 'card.moved', 'card.updated', 'card.done', 'card.deleted'];
const HOOK_FORMATS = ['json', 'slack', 'discord'];
const MAX_HOOKS = 20; const MAX_INBOXES = 20; const HOOK_LOG = 50; const HOOK_TEXT_MAX = 64 * 1024; const HOOK_QUEUE = 300; const CARD_EVENTS_MAX = 50;
const HOOK_PRIVATE = env.WEBHOOK_ALLOW_PRIVATE === '1';
const HOOK_RETRY = String(env.WEBHOOK_RETRY_MS || '60000,300000,900000,2400000').split(',').map((s) => +s).filter((n) => n >= 0);
const HOOK_MAX_FAILS = Math.max(1, +(env.WEBHOOK_MAX_FAILS || 15));
const HOOK_TIMEOUT = Math.max(200, +(env.WEBHOOK_TIMEOUT_MS || 8000));
const HOOK_UPDATE_WAIT = Math.max(0, +(env.WEBHOOK_UPDATE_WAIT_MS == null ? 10000 : env.WEBHOOK_UPDATE_WAIT_MS));
const API_PER_MIN = Math.max(1, +(env.API_PER_MINUTE || 120)); const IN_PER_MIN = Math.max(1, +(env.INBOX_PER_MINUTE || 60)); const IN_PER_DAY = 5000; const IN_MAX = 64 * 1024;
// url y secret van cifrados en reposo con DATA_KEY, como el texto de las notas: la dirección de un webhook de Slack
// es una credencial, y el secreto tiene que poder leerse para firmar (por eso no se guarda como hash).
// off: '' prendido, 'user' pausado por la persona, 'failed' desactivado por fallos seguidos.
db.exec("CREATE TABLE IF NOT EXISTS hooks (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, maker INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, secret TEXT NOT NULL, e INTEGER NOT NULL DEFAULT 0, host TEXT NOT NULL DEFAULT '', scope_kind TEXT NOT NULL DEFAULT 'all', scope_path TEXT NOT NULL DEFAULT '', events TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'json', body INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'en', off TEXT NOT NULL DEFAULT '', fails INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last INTEGER, last_code INTEGER)");
db.exec('CREATE INDEX IF NOT EXISTS hooks_user ON hooks (user)');
// La cola de entregas y, a la vez, su registro. Entregada o vencida, de una entrega queda el tipo de evento, la ruta
// de la nota, el estado, el código de la respuesta y cuánto tardó: el cuerpo se borra.
db.exec("CREATE TABLE IF NOT EXISTS hook_jobs (id INTEGER PRIMARY KEY, hook INTEGER NOT NULL, event TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', body TEXT, e INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', code INTEGER, ms INTEGER, err TEXT, created INTEGER NOT NULL, done INTEGER)");
db.exec('CREATE INDEX IF NOT EXISTS hook_jobs_due ON hook_jobs (status, next)');
db.exec('CREATE INDEX IF NOT EXISTS hook_jobs_hook ON hook_jobs (hook, id)');
// Direcciones de entrada. Del secreto se guarda el hash y sus últimos caracteres, para reconocerla en la lista.
// kind: 'append' agrega a una nota, 'create' crea una nota en una carpeta, 'card' crea una tarjeta en un tablero.
db.exec("CREATE TABLE IF NOT EXISTS inboxes (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, maker INTEGER NOT NULL, hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'append', path TEXT NOT NULL DEFAULT '', tpl TEXT NOT NULL DEFAULT '', col TEXT NOT NULL DEFAULT '', allow_get INTEGER NOT NULL DEFAULT 0, tz TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, used INTEGER, n INTEGER NOT NULL DEFAULT 0)");
db.exec('CREATE INDEX IF NOT EXISTS inboxes_user ON inboxes (user)');
ACCOUNT_ROWS.unshift('DELETE FROM hook_jobs WHERE hook IN (SELECT id FROM hooks WHERE user = ?)', 'DELETE FROM hooks WHERE user = ?', 'DELETE FROM inboxes WHERE user = ?');
// El identificador de la cuenta que viaja en los eventos: opaco y estable, nunca el correo ni el número interno.
const AUTO_SALT = (() => { const row = q("SELECT value FROM meta WHERE key = 'auto_salt'").get(); if (row) return row.value; const v = random(24); q("INSERT INTO meta (key, value) VALUES ('auto_salt', ?)").run(v); return v; })();
const autoAcct = (id) => 'acc_' + sha(AUTO_SALT + ':' + id).slice(0, 20);
const autoAllowed = (owner) => !!owner && apiAllowed(owner);
const isSpace = (owner) => String(owner.email || '').startsWith('team:');
// Un miembro, en un evento: un identificador opaco y estable, y su papel. Ni su correo ni parte de él salen hacia un tercero.
const memberId = (u) => 'mem_' + sha(AUTO_SALT + ':m:' + u.id).slice(0, 16);
// El equipo dueño de un espacio, y si la cuenta que creó una automatización todavía puede usarla ahí.
const teamOfSpace = (owner) => (isSpace(owner) ? q('SELECT * FROM teams WHERE space = ?').get(owner.id) || null : null);
const makerMay = (team, makerId, what) => { const u = userById(makerId); return !!u && teamAllows(team, u, what); };
function autoActor(owner) {
  const st = reqCtx.getStore() || {}; const u = st.user; const via = st.via || (u && u.tokenId ? 'mcp' : 'app');
  if (u && u.id !== owner.id && u.team && u.team.space === owner.id) return { type: 'member', id: memberId(u), role: teamRoleOf(u), via };
  return { type: via };
}
const autoUrl = (owner, p) => APP_URL + '?f=' + encodeURIComponent('cloud/' + (isSpace(owner) ? '~' + owner.id + '/' : '') + p.split('/').map(encodeURIComponent).join('/'));
const autoNoteRef = (owner, p) => ({ path: (isSpace(owner) ? TEAM_PRE : '') + p, name: p.split('/').pop(), url: autoUrl(owner, p), space: isSpace(owner) ? 'team' : 'own' });
const hookCovers = (h, p) => h.scope_kind === 'all' || (h.scope_kind === 'folder' ? p.startsWith(h.scope_path + '/') : p === h.scope_path);

// Una línea legible por evento, para Slack y Discord. link arma el enlace a la nota como lo pide cada uno.
const AUTO_WORDS = {
  en: { 'note.created': 'Note created: {note}', 'note.updated': 'Note updated: {note}', 'note.deleted': 'Note deleted: {path}', 'note.restored': 'Note restored: {note}', 'note.moved': 'Note moved from {from} to {note}',
    'comment.created': 'New comment on {note}: "{text}"', 'comment.resolved': 'Comment resolved on {note}', 'card.created': 'Card "{title}" added to {column} in {note}', 'card.moved': 'Card "{title}" moved from {from} to {to} in {note}',
    'card.updated': 'Card "{title}" updated in {note}: {changes}', 'card.done': 'Card "{title}" done in {note}', 'card.deleted': 'Card "{title}" removed from {note}', ping: 'SharpMD test: this automation works', by: ' by {name}', none: 'empty' },
  es: { 'note.created': 'Nota creada: {note}', 'note.updated': 'Nota actualizada: {note}', 'note.deleted': 'Nota eliminada: {path}', 'note.restored': 'Nota restaurada: {note}', 'note.moved': 'Nota movida de {from} a {note}',
    'comment.created': 'Comentario nuevo en {note}: "{text}"', 'comment.resolved': 'Comentario resuelto en {note}', 'card.created': 'Tarjeta "{title}" agregada a {column} en {note}', 'card.moved': 'Tarjeta "{title}" pasó de {from} a {to} en {note}',
    'card.updated': 'Tarjeta "{title}" actualizada en {note}: {changes}', 'card.done': 'Tarjeta "{title}" hecha en {note}', 'card.deleted': 'Tarjeta "{title}" quitada de {note}', ping: 'Prueba de SharpMD: esta automatización funciona', by: ' por {name}', none: 'vacío' },
};
function autoLine(ev, lang, clean, link) {
  const w = AUTO_WORDS[lang === 'es' ? 'es' : 'en']; const d = ev.data || {}; const card = d.card || {};
  const short = (v) => clean(String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, 200));
  const vals = { note: ev.note ? link(ev.note.url, clean(ev.note.path)) : '', path: ev.note ? clean(ev.note.path) : '', title: short(card.title), column: short(card.column), from: short(d.from), to: short(d.to), text: short(d.comment && d.comment.text),
    changes: d.changes ? Object.keys(d.changes).slice(0, 6).map((k) => short(k) + ' ' + (d.changes[k].from == null ? w.none : short(d.changes[k].from)) + ' → ' + (d.changes[k].to == null ? w.none : short(d.changes[k].to))).join(', ') : '' };
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] == null ? '' : o[k]));
  return fill(w[ev.type] || ev.type, vals) + (ev.actor && ev.actor.type === 'member' && ev.actor.name ? fill(w.by, { name: clean(ev.actor.name) }) : '');
}
const slackClean = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const discordClean = (s) => s.replace(/([\\*_~`|>\[\]()@#])/g, '\\$1');
function hookBody(hook, ev) {
  if (hook.format === 'slack') return JSON.stringify({ text: autoLine(ev, hook.lang, slackClean, (url, text) => '<' + url + '|' + text + '>') });
  if (hook.format === 'discord') return JSON.stringify({ content: autoLine(ev, hook.lang, discordClean, (url, text) => '[' + text + '](' + url + ')').slice(0, 1900), allowed_mentions: { parse: [] } });
  return JSON.stringify(ev);
}
// Deja el evento en la cola de cada webhook de esa cuenta que lo mira. text: el contenido de la nota, para los que lo
// pidieron. Nunca corta lo que la llamó: si algo falla acá, la nota ya quedó guardada.
function autoEmit(owner, type, p, data, opt) {
  try {
    if (!owner || !type) return;
    let hooks = q("SELECT * FROM hooks WHERE user = ? AND off = ''").all(owner.id).filter((h) => (hookCovers(h, p) || (opt && opt.from && hookCovers(h, opt.from))) && JSON.parse(h.events).includes(type));
    if (!hooks.length || !autoAllowed(owner)) return;
    // En el espacio de un equipo, un webhook sirve mientras quien lo creó pueda automatizar ahí (la política del equipo).
    const team = teamOfSpace(owner);
    if (team) { hooks = hooks.filter((h) => makerMay(team, h.maker, 'automation')); if (!hooks.length) return; }
    // Lo que está en una carpeta protegida no genera eventos.
    if (vaultOf(owner.id, p) || (opt && opt.from && vaultOf(owner.id, opt.from))) return;
    const at = now(); const ev = { id: 'evt_' + random(15), type, created: iso(at), account: autoAcct(owner.id), note: autoNoteRef(owner, p), actor: autoActor(owner), data: data || {} };
    for (const h of hooks) {
      let one = ev;
      if (opt && opt.text != null && h.body && h.format === 'json') { const cut = Buffer.byteLength(opt.text) > HOOK_TEXT_MAX; one = Object.assign({}, ev, { data: Object.assign({}, ev.data, { text: cut ? Buffer.from(opt.text).subarray(0, HOOK_TEXT_MAX).toString('utf8') : opt.text, truncated: cut }) }); }
      const body = seal(hookBody(h, one), 'hook_jobs.body');
      // Los guardados seguidos de una nota salen como un solo note.updated, con lo último.
      const wait = type === 'note.updated' ? HOOK_UPDATE_WAIT : 0;
      const same = wait ? q("SELECT id FROM hook_jobs WHERE hook = ? AND type = 'note.updated' AND path = ? AND status = 'pending' AND attempt = 0").get(h.id, p) : null;
      if (same && !autoRunning.has(same.id)) { q('UPDATE hook_jobs SET body = ?, e = ?, event = ?, next = ? WHERE id = ?').run(body, SEALED, ev.id, at + wait, same.id); setTimeout(autoPump, wait + 20).unref(); continue; }
      if (q("SELECT COUNT(*) AS n FROM hook_jobs WHERE hook = ? AND status = 'pending'").get(h.id).n >= HOOK_QUEUE) continue;
      q('INSERT INTO hook_jobs (hook, event, type, path, body, e, next, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(h.id, ev.id, type, p, body, SEALED, at + wait, at);
      if (wait) setTimeout(autoPump, wait + 20).unref();
    }
    setImmediate(autoPump);
  } catch (e) { console.error('automatizaciones: no se pudo anotar el evento ' + type + ' · ' + String(e && e.stack || e).slice(0, 600)); }
}
// Una nota se guardó. prev es el texto que había (null si la nota es nueva); v, si el texto llegó cifrado desde el navegador.
function autoNoteSaved(owner, p, prev, text, saved, v) {
  if (v || text.startsWith(VAULT) || (prev != null && prev.startsWith(VAULT)) || prev === text) return;
  const data = { rev: saved.rev, size: saved.size, updated: iso(saved.updated) };
  autoEmit(owner, prev == null ? 'note.created' : 'note.updated', p, data, { text });
  if (prev == null || (!kbHas(prev) && !kbHas(text))) return;
  let events = [];
  try { events = kbDiff(prev, text); } catch (e) { return; }
  for (const ev of events.slice(0, CARD_EVENTS_MAX)) autoEmit(owner, ev.type, p, Object.assign(ev.data, { rev: saved.rev }));
}
function autoNoteMoved(owner, from, to) {
  // Lo que apuntaba a esa nota (un webhook de una sola nota, una dirección de entrada) la sigue.
  try { q("UPDATE hooks SET scope_path = ? WHERE user = ? AND scope_kind = 'note' AND scope_path = ?").run(to, owner.id, from); q("UPDATE inboxes SET path = ? WHERE user = ? AND kind != 'create' AND path = ?").run(to, owner.id, from); } catch (e) { /* el evento sale igual */ }
  autoEmit(owner, 'note.moved', to, { from: (isSpace(owner) ? TEAM_PRE : '') + from, to: (isSpace(owner) ? TEAM_PRE : '') + to }, { from });
}

// ---------- Destinos: nada de red privada ----------
// Un webhook hace que el servidor llame a una dirección que eligió otra persona. Sin cuidado, eso sirve para llegar
// a lo que solo el servidor ve: su propia máquina, la red interna, el servicio de metadatos de la nube. Por eso:
// solo https, sin usuario ni contraseña en la dirección; el nombre se resuelve y todas sus direcciones tienen que
// ser públicas; la conexión se hace a esa misma dirección ya comprobada (no se vuelve a resolver); no se siguen
// redirecciones; hay tiempo límite y la respuesta se corta pasado un tope. Se comprueba al crear y en cada entrega.
function ip4Private(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
// Las ocho palabras de una dirección IPv6, o null si no se entiende.
function ip6Words(ip) {
  let s = String(ip).split('%')[0].toLowerCase();
  const v4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) { const n = v4.slice(2).map(Number); if (n.some((x) => x > 255)) return null; s = v4[1] + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16); }
  const halves = s.split('::'); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : []; const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : gap < 1) return null;
  const words = head.concat(Array(halves.length === 2 ? gap : 0).fill('0'), tail);
  if (words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.map((w) => parseInt(w, 16));
}
function ipPrivate(ip) {
  const kind = net.isIP(String(ip).split('%')[0]);
  if (kind === 4) { const n = ip.split('.').map(Number); return ip4Private(n[0], n[1], n[2]); }
  if (kind !== 6) return true; // lo que no se entiende, no pasa
  const w = ip6Words(ip); if (!w) return true;
  const v4 = (hi, lo) => ip4Private(hi >> 8, hi & 255, lo >> 8);
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return w[5] === 0 ? true : v4(w[6], w[7]); // ::, ::1, ::a.b.c.d y ::ffff:a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b) return w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 ? v4(w[6], w[7]) : true; // NAT64
  if (w[0] === 0x2002) return v4(w[1], w[2]); // 6to4
  if (w[0] === 0x2001 && (w[1] === 0 || w[1] === 0xdb8)) return true; // Teredo y documentación
  if (w[0] === 0x100 && w[1] === 0) return true; // descarte
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0 || (w[0] & 0xff00) === 0xff00 || w[0] === 0;
}
const NO_DEST = (why) => new Fail(400, 'bad_destination', why);
const OWN_HOST = (() => { try { return new URL(PUBLIC_URL).hostname.toLowerCase(); } catch (e) { return ''; } })();
// Lo que se puede saber sin resolver el nombre. Devuelve la dirección ya leída.
function hookUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch (e) { throw NO_DEST('That is not a web address'); }
  if (String(raw).length > 2000) throw NO_DEST('That address is too long');
  if (u.username || u.password) throw NO_DEST('The address cannot carry a user or a password');
  if (u.protocol !== 'https:' && !(HOOK_PRIVATE && u.protocol === 'http:')) throw NO_DEST('The address has to start with https://');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) throw NO_DEST('That is not a web address');
  if (HOOK_PRIVATE) return { u, host };
  // Un webhook que apunta a este mismo servidor (a una dirección de entrada, por ejemplo) se llamaría a sí mismo sin fin.
  if (host === OWN_HOST) throw NO_DEST('The address cannot be this same server');
  if (u.port && +u.port !== 443 && +u.port < 1024) throw NO_DEST('That port is not allowed');
  if (net.isIP(host) ? ipPrivate(host) : (!host.includes('.') || /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example|onion)$/.test(host))) throw NO_DEST('That address points to a private network');
  return { u, host };
}
async function hookTarget(raw) {
  const { u, host } = hookUrl(raw);
  if (net.isIP(host)) return { u, host, ip: host, family: net.isIP(host) };
  let all = [];
  try { all = await dns.promises.lookup(host, { all: true, verbatim: true }); } catch (e) { throw new Fail(400, 'dns_failed', 'That name does not resolve'); }
  if (!all.length) throw new Fail(400, 'dns_failed', 'That name does not resolve');
  if (!HOOK_PRIVATE && all.some((a) => ipPrivate(a.address))) throw NO_DEST('That address points to a private network');
  const pick = all.find((a) => a.family === 4) || all[0];
  return { u, host, ip: pick.address, family: pick.family };
}
// Manda el cuerpo y devuelve { code, ms, err }. No tira: una entrega fallida es un resultado.
async function hookPost(raw, body, headers) {
  const t0 = now(); let t;
  try { t = await hookTarget(raw); } catch (e) { return { code: 0, ms: now() - t0, err: e.code === 'dns_failed' ? 'dns_failed' : 'blocked_destination' }; }
  return new Promise((resolve) => {
    let settled = false; let req = null;
    const end = (code, err) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, ms: now() - t0, err: err || '' }); if (req) req.destroy(); };
    const timer = setTimeout(() => end(0, 'timeout'), HOOK_TIMEOUT);
    try {
      const lib = t.u.protocol === 'https:' ? https : http;
      req = lib.request({ protocol: t.u.protocol, hostname: t.host, port: t.u.port || (t.u.protocol === 'https:' ? 443 : 80), path: t.u.pathname + t.u.search, method: 'POST', agent: false,
        servername: t.u.protocol === 'https:' && !net.isIP(t.host) ? t.host : undefined,
        // La conexión va a la dirección que ya se comprobó: el nombre no se vuelve a resolver.
        lookup: (h, o, cb) => { if (typeof o === 'function') { cb = o; o = {}; } if (o && o.all) cb(null, [{ address: t.ip, family: t.family }]); else cb(null, t.ip, t.family); },
        headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'user-agent': 'SharpMD-Webhooks/1 (+https://sharpmd.app/api.html)', accept: '*/*' }, headers) });
      req.on('response', (res) => {
        const code = res.statusCode || 0; let seen = 0;
        // La respuesta no se guarda: se lee hasta un tope y se suelta.
        res.on('data', (c) => { seen += c.length; if (seen > 16384) end(code, code >= 200 && code < 300 ? '' : code >= 300 && code < 400 ? 'redirect' : 'http_' + code); });
        res.on('end', () => end(code, code >= 200 && code < 300 ? '' : code >= 300 && code < 400 ? 'redirect' : 'http_' + code));
        res.on('error', () => end(code, code >= 200 && code < 300 ? '' : 'http_' + code));
      });
      req.on('error', (e) => end(0, /certificate|self.signed|CERT|TLS|SSL/i.test(String(e && (e.code || e.message))) ? 'tls' : 'connection'));
      req.end(body);
    } catch (e) { end(0, 'connection'); }
  });
}
// t=<segundos>,v1=<HMAC-SHA-256 en hexadecimal de "<t>.<cuerpo>" con el secreto del webhook>. Quien recibe rehace la
// cuenta y descarta lo que traiga una marca de tiempo vieja: así un pedido copiado no sirve más tarde.
const hookSign = (secret, body, at) => { const t = Math.floor((at || now()) / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex'); };
const hookHeaders = (hook, job, body) => ({ 'x-sharpmd-event': job.type, 'x-sharpmd-delivery': job.event, 'x-sharpmd-signature': hookSign(unseal(hook.secret, hook.e, 'hooks.secret'), body) });

// ---------- La cola ----------
const autoRunning = new Set(); const AUTO_PARALLEL = 4;
function autoPump() {
  if (autoRunning.size >= AUTO_PARALLEL) return;
  let due = [];
  try { due = q("SELECT * FROM hook_jobs WHERE status = 'pending' AND next <= ? ORDER BY next, id LIMIT 20").all(now()); } catch (e) { return; }
  for (const job of due) {
    if (autoRunning.size >= AUTO_PARALLEL) break;
    if (autoRunning.has(job.id)) continue;
    autoRunning.add(job.id);
    autoDeliver(job).catch((e) => console.error('automatizaciones: entrega · ' + String(e && e.stack || e).slice(0, 600))).finally(() => { autoRunning.delete(job.id); setImmediate(autoPump); });
  }
}
const jobClose = (job, status, r) => q('UPDATE hook_jobs SET status = ?, body = NULL, e = 0, code = ?, ms = ?, err = ?, done = ?, attempt = ? WHERE id = ?').run(status, r.code || 0, r.ms || 0, r.err || '', now(), job.attempt, job.id);
async function autoDeliver(job) {
  const hook = q('SELECT * FROM hooks WHERE id = ?').get(job.hook);
  if (!hook || hook.off) { jobClose(job, 'canceled', {}); return; }
  const body = unseal(job.body, job.e, 'hook_jobs.body');
  const r = await hookPost(unseal(hook.url, hook.e, 'hooks.url'), body, hookHeaders(hook, job, body));
  job.attempt++;
  const ok = !r.err && r.code >= 200 && r.code < 300;
  // La cuenta de fallos se lleva en la base: dos entregas del mismo webhook pueden terminar a la vez.
  q('UPDATE hooks SET last = ?, last_code = ?, fails = CASE WHEN ? THEN 0 ELSE fails + 1 END WHERE id = ?').run(now(), r.code || 0, ok ? 1 : 0, hook.id);
  const fails = (q('SELECT fails FROM hooks WHERE id = ?').get(hook.id) || { fails: 0 }).fails;
  if (ok) jobClose(job, 'ok', r);
  else if (fails >= HOOK_MAX_FAILS) {
    // Muchos fallos seguidos: el webhook se desactiva y lo que tenía en cola no sale. La app lo muestra y deja volver a prenderlo.
    jobClose(job, 'failed', r);
    q("UPDATE hooks SET off = 'failed' WHERE id = ?").run(hook.id);
    q("UPDATE hook_jobs SET status = 'canceled', body = NULL, e = 0, done = ? WHERE hook = ? AND status = 'pending'").run(now(), hook.id);
  } else if (job.attempt > HOOK_RETRY.length) jobClose(job, 'failed', r);
  else {
    const wait = HOOK_RETRY[job.attempt - 1];
    q('UPDATE hook_jobs SET attempt = ?, next = ?, code = ?, ms = ?, err = ? WHERE id = ?').run(job.attempt, now() + wait, r.code || 0, r.ms || 0, r.err || '', job.id);
    setTimeout(autoPump, wait + 20).unref();
  }
  q('DELETE FROM hook_jobs WHERE hook = ? AND status != ? AND id NOT IN (SELECT id FROM hook_jobs WHERE hook = ? AND status != ? ORDER BY id DESC LIMIT ?)').run(hook.id, 'pending', hook.id, 'pending', HOOK_LOG);
}
setInterval(autoPump, 5000).unref();
setInterval(() => { try { q("DELETE FROM hook_jobs WHERE status != 'pending' AND created < ?").run(now() - 30 * DAY); q('DELETE FROM hook_jobs WHERE hook NOT IN (SELECT id FROM hooks)').run(); } catch (e) { /* en la próxima */ } }, 6 * HOUR).unref();
setImmediate(autoPump); // lo que quedó en cola antes de un reinicio sale al arrancar

// ---------- Automatizaciones: lo que maneja la app, con la sesión de la cuenta ----------
// Las de una cuenta las maneja esa cuenta. Las del espacio de un equipo (o = el número del espacio), quien pueda
// escribir ahí y tenga la política 'automation' (quien administra, siempre; un lector, nunca).
function autoOwner(user, o) {
  if (o == null || o === '' || +o === user.id) return user;
  if (user.team && +o === user.team.space) {
    if (!teamAllows(user.team, user, 'automation')) throw new Fail(403, 'team_policy', 'The administrator of the team has not allowed members to automate the team space');
    return spaceOf(user, o, 'edit');
  }
  throw new Fail(403, 'no_access');
}
const autoNeedsPlan = (owner) => { if (!autoAllowed(owner)) throw new Fail(402, 'automation_needs_plan', 'Automations are part of the paid plan'); };
const hookMask = (url) => { try { const u = new URL(url); const tail = (u.pathname + u.search).replace(/\/+$/, ''); return u.protocol + '//' + u.host + (tail.length > 6 ? '/…' + tail.slice(-4) : tail); } catch (e) { return ''; } };
const hookView = (h) => ({ id: h.id, name: h.name, destination: hookMask(unseal(h.url, h.e, 'hooks.url')), scope: { kind: h.scope_kind, path: h.scope_path }, events: JSON.parse(h.events), format: h.format, include_text: !!h.body, lang: h.lang,
  state: h.off === 'failed' ? 'failed' : h.off ? 'paused' : 'on', created: h.created, last: h.last ? { at: h.last, code: h.last_code || 0, ok: (h.last_code || 0) >= 200 && (h.last_code || 0) < 300 } : null });
const inboxView = (r) => ({ id: r.id, name: r.name, kind: r.kind, path: r.path, template: r.tpl, column: r.col, allow_get: !!r.allow_get, hint: r.hint, created: r.created, used: r.used || null, count: r.n });
// A qué mira un webhook: toda la cuenta, una carpeta o una nota. Nada que esté dentro de una carpeta protegida.
function autoScope(owner, raw) {
  const kind = raw && ['all', 'folder', 'note'].includes(raw.kind) ? raw.kind : 'all';
  // Un espacio de equipo protegido con contraseña está cifrado entero: no hay nada que el servidor pueda avisar.
  if (vaultOf(owner.id, 'x')) throw new Fail(409, 'vault', 'A space protected with a password cannot be automated: the server cannot read its notes');
  if (kind === 'all') return { kind, path: '' };
  const p = cleanPath(String(raw.path || '').replace(/\/+$/, ''));
  if (vaultsOf(owner.id).some((v) => p === v.folder || inside(p, v.folder))) throw new Fail(409, 'vault', 'A protected folder cannot be automated: the server cannot read its notes');
  return { kind, path: p };
}
function hookFields(owner, b, was) {
  const out = {};
  if (b.name !== undefined || !was) out.name = autoName(b.name);
  if (b.scope !== undefined || !was) { const s = autoScope(owner, b.scope); out.scope_kind = s.kind; out.scope_path = s.path; }
  if (b.events !== undefined || !was) { const ev = Array.isArray(b.events) ? Array.from(new Set(b.events.filter((x) => EVENT_TYPES.includes(x)))) : []; if (!ev.length) throw new Fail(400, 'bad_events', 'Pick at least one event'); out.events = JSON.stringify(ev); }
  if (b.format !== undefined || !was) out.format = HOOK_FORMATS.includes(b.format) ? b.format : 'json';
  if (b.include_text !== undefined || !was) out.body = b.include_text === true ? 1 : 0;
  if (b.lang !== undefined || !was) out.lang = b.lang === 'es' ? 'es' : 'en';
  if (b.url !== undefined || !was) { const { u, host } = hookUrl(b.url); out.url = seal(u.href, 'hooks.url'); out.host = host; }
  if (b.on !== undefined && was) { out.off = b.on === false ? 'user' : ''; if (b.on !== false) out.fails = 0; }
  return out;
}
function inboxFields(owner, b, was) {
  const out = {};
  if (b.name !== undefined || !was) out.name = autoName(b.name);
  const kind = was ? was.kind : ['append', 'create', 'card'].includes(b.kind) ? b.kind : 'append';
  if (!was) out.kind = kind;
  if (b.path !== undefined || !was) {
    // 'create' apunta a una carpeta (vacío: la raíz); las otras dos, a una nota.
    const raw = String(b.path || '').replace(/\/+$/, ''); const p = kind === 'create' && !raw ? '' : cleanPath(raw);
    if (vaultsOf(owner.id).some((v) => p === v.folder || inside(p || 'x', v.folder))) throw new Fail(409, 'vault', 'A protected folder cannot receive entries: its notes are encrypted in the browser');
    out.path = p;
  }
  if (b.template !== undefined || !was) { out.tpl = String(b.template || '').replace(/\r\n/g, '\n').slice(0, 2000); }
  if (b.column !== undefined || !was) out.col = String(b.column || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (b.allow_get !== undefined || !was) out.allow_get = b.allow_get === true ? 1 : 0;
  if (b.tz !== undefined || !was) { let tz = String(b.tz || '').slice(0, 60); try { if (tz) new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { tz = ''; } out.tz = tz; }
  return out;
}
const autoName = (v) => String(v == null ? '' : v).replace(/[\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
async function autoRoute(req, user, p, m, url) {
  const body = m === 'POST' || m === 'PUT' ? await readBody(req) : {};
  const owner = autoOwner(user, m === 'GET' || m === 'DELETE' ? url.searchParams.get('o') : body.o);
  if (p === '/automations' && m === 'GET') {
    return { allowed: autoAllowed(owner), events: EVENT_TYPES, formats: HOOK_FORMATS, api_url: PUBLIC_URL + '/api/v1', inbox_url: PUBLIC_URL + '/in/', limits: { hooks: MAX_HOOKS, inboxes: MAX_INBOXES },
      hooks: q('SELECT * FROM hooks WHERE user = ? ORDER BY id').all(owner.id).map(hookView), inboxes: q('SELECT * FROM inboxes WHERE user = ? ORDER BY id').all(owner.id).map(inboxView) };
  }
  if (p === '/automations/hooks' && m === 'POST') {
    autoNeedsPlan(owner);
    if (q('SELECT COUNT(*) AS n FROM hooks WHERE user = ?').get(owner.id).n >= MAX_HOOKS) throw new Fail(429, 'too_many');
    const f = hookFields(owner, body, null); const secret = 'whsec_' + random(32);
    const r = q('INSERT INTO hooks (user, maker, name, url, secret, e, host, scope_kind, scope_path, events, format, body, lang, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(owner.id, user.id, f.name, f.url, seal(secret, 'hooks.secret'), SEALED, f.host, f.scope_kind, f.scope_path, f.events, f.format, f.body, f.lang, now());
    if (isSpace(owner)) teamLog(user.team, user, 'automation', f.scope_path, 'webhook ' + f.host);
    return { hook: hookView(q('SELECT * FROM hooks WHERE id = ?').get(Number(r.lastInsertRowid))), secret };
  }
  const hm = /^\/automations\/hooks\/(\d+)(?:\/(test|secret|deliveries))?$/.exec(p);
  if (hm) {
    const hook = q('SELECT * FROM hooks WHERE id = ? AND user = ?').get(+hm[1], owner.id);
    if (!hook) throw new Fail(404, 'not_found');
    if (!hm[2] && m === 'DELETE') { q('DELETE FROM hook_jobs WHERE hook = ?').run(hook.id); q('DELETE FROM hooks WHERE id = ?').run(hook.id); if (isSpace(owner)) teamLog(user.team, user, 'automation_remove', hook.scope_path, 'webhook ' + hook.host); return { ok: true }; }
    if (hm[2] === 'deliveries' && m === 'GET') return q('SELECT id, type, path, status, attempt, code, ms, err, created, done FROM hook_jobs WHERE hook = ? ORDER BY id DESC LIMIT ?').all(hook.id, HOOK_LOG)
      .map((j) => ({ id: j.id, type: j.type, path: j.path, status: j.status, attempts: j.attempt, code: j.code || 0, ms: j.ms || 0, error: j.err || '', created: j.created, done: j.done || null }));
    autoNeedsPlan(owner);
    if (!hm[2] && m === 'PUT') {
      const f = hookFields(owner, body, hook);
      // Una fila cifrada con otra marca: la dirección nueva y el secreto de antes tienen que quedar con la misma.
      if (f.url !== undefined && hook.e !== SEALED) { f.secret = seal(unseal(hook.secret, hook.e, 'hooks.secret'), 'hooks.secret'); f.e = SEALED; }
      const n = Object.assign({}, hook, f);
      q('UPDATE hooks SET name = ?, url = ?, secret = ?, e = ?, host = ?, scope_kind = ?, scope_path = ?, events = ?, format = ?, body = ?, lang = ?, off = ?, fails = ? WHERE id = ?').run(n.name, n.url, n.secret, n.e, n.host, n.scope_kind, n.scope_path, n.events, n.format, n.body, n.lang, n.off, n.fails, hook.id);
      return { hook: hookView(q('SELECT * FROM hooks WHERE id = ?').get(hook.id)) };
    }
    if (hm[2] === 'secret' && m === 'POST') {
      const secret = 'whsec_' + random(32);
      q('UPDATE hooks SET secret = ?, url = ?, e = ? WHERE id = ?').run(seal(secret, 'hooks.secret'), seal(unseal(hook.url, hook.e, 'hooks.url'), 'hooks.url'), SEALED, hook.id);
      return { secret };
    }
    if (hm[2] === 'test' && m === 'POST') {
      rate('hooktest:' + user.id, 10, 60000, 'too_many');
      const ev = { id: 'evt_' + random(15), type: 'ping', created: isoNow(), account: autoAcct(owner.id), note: null, actor: { type: 'app' }, data: { message: 'This is a test from SharpMD' } };
      const text = hookBody(hook, ev); const job = { type: 'ping', event: ev.id };
      const r = await hookPost(unseal(hook.url, hook.e, 'hooks.url'), text, hookHeaders(hook, job, text));
      const ok = !r.err && r.code >= 200 && r.code < 300;
      q("INSERT INTO hook_jobs (hook, event, type, path, body, attempt, next, status, code, ms, err, created, done) VALUES (?, ?, 'ping', '', NULL, 1, ?, ?, ?, ?, ?, ?, ?)").run(hook.id, ev.id, now(), ok ? 'ok' : 'failed', r.code || 0, r.ms || 0, r.err || '', now(), now());
      q('UPDATE hooks SET last = ?, last_code = ? WHERE id = ?').run(now(), r.code || 0, hook.id);
      return { ok, code: r.code || 0, ms: r.ms || 0, error: r.err || '' };
    }
  }
  if (p === '/automations/inboxes' && m === 'POST') {
    autoNeedsPlan(owner);
    if (q('SELECT COUNT(*) AS n FROM inboxes WHERE user = ?').get(owner.id).n >= MAX_INBOXES) throw new Fail(429, 'too_many');
    const f = inboxFields(owner, body, null); const secret = 'mdi_' + random(32);
    const r = q('INSERT INTO inboxes (user, maker, hash, hint, name, kind, path, tpl, col, allow_get, tz, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(owner.id, user.id, sha(secret), secret.slice(-4), f.name, f.kind, f.path, f.tpl, f.col, f.allow_get, f.tz, now());
    if (isSpace(owner)) teamLog(user.team, user, 'automation', f.path, 'inbound ' + f.kind);
    return { inbox: inboxView(q('SELECT * FROM inboxes WHERE id = ?').get(Number(r.lastInsertRowid))), url: PUBLIC_URL + '/in/' + secret };
  }
  const im = /^\/automations\/inboxes\/(\d+)(?:\/(secret))?$/.exec(p);
  if (im) {
    const row = q('SELECT * FROM inboxes WHERE id = ? AND user = ?').get(+im[1], owner.id);
    if (!row) throw new Fail(404, 'not_found');
    if (!im[2] && m === 'DELETE') { q('DELETE FROM inboxes WHERE id = ?').run(row.id); if (isSpace(owner)) teamLog(user.team, user, 'automation_remove', row.path, 'inbound ' + row.kind); return { ok: true }; }
    autoNeedsPlan(owner);
    if (!im[2] && m === 'PUT') { const n = Object.assign({}, row, inboxFields(owner, body, row)); q('UPDATE inboxes SET name = ?, path = ?, tpl = ?, col = ?, allow_get = ?, tz = ? WHERE id = ?').run(n.name, n.path, n.tpl, n.col, n.allow_get, n.tz, row.id); return { inbox: inboxView(q('SELECT * FROM inboxes WHERE id = ?').get(row.id)) }; }
    // Una dirección nueva: la de antes deja de servir en el acto.
    if (im[2] === 'secret' && m === 'POST') { const secret = 'mdi_' + random(32); q('UPDATE inboxes SET hash = ?, hint = ? WHERE id = ?').run(sha(secret), secret.slice(-4), row.id); return { url: PUBLIC_URL + '/in/' + secret }; }
  }
  throw new Fail(404, 'no_route');
}

// ---------- Direcciones de entrada ----------
// POST /in/<secreto> agrega lo que llega a una nota, crea una nota o crea una tarjeta. Quien tiene la dirección
// puede escribir ahí y nada más: no lee, no lista y la respuesta no trae nada de la nota.
const inClean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const inScalar = (v) => v == null || ['string', 'number', 'boolean'].includes(typeof v);
function inMultipart(raw, type) {
  const bm = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type); if (!bm) throw new Fail(400, 'bad_form');
  const out = {};
  for (const part of raw.split('--' + (bm[1] || bm[2])).slice(1)) {
    const cut = part.indexOf('\r\n\r\n'); if (cut < 0) continue;
    const head = part.slice(0, cut); const name = /name="([^"]*)"/i.exec(head);
    // Los archivos no se reciben: se saltean.
    if (!name || /filename=/i.test(head)) continue;
    out[name[1]] = part.slice(cut + 4).replace(/\r\n$/, '');
  }
  return out;
}
async function inFields(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase(); const raw = await readRaw(req, IN_MAX);
  if (type.includes('json')) {
    let v; try { v = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { throw new Fail(400, 'bad_json'); }
    if (typeof v === 'string') return { fields: { text: v }, shape: 'text' };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { fields: { text: '```json\n' + JSON.stringify(v, null, 2) + '\n```' }, shape: 'text' };
    return { fields: v, shape: 'table' };
  }
  if (type.includes('x-www-form-urlencoded')) return { fields: Object.fromEntries(new URLSearchParams(raw)), shape: 'list' };
  if (type.includes('multipart/form-data')) return { fields: inMultipart(raw, String(req.headers['content-type'])), shape: 'list' };
  return { fields: { text: raw }, shape: 'text' };
}
// Lo que llegó, como Markdown: el campo text si vino; si no, los campos como tabla (JSON) o como lista (formulario),
// y si alguno es una estructura, el JSON entero en un bloque de código.
function inText(fields, shape) {
  if (typeof fields.text === 'string' && fields.text.trim()) return inClean(fields.text).trim();
  const keys = Object.keys(fields).filter((k) => k !== 'text' && k !== 'title').slice(0, 60);
  if (!keys.length) return '';
  if (!keys.every((k) => inScalar(fields[k]))) return '```json\n' + JSON.stringify(Object.fromEntries(keys.map((k) => [k, fields[k]])), null, 2).replace(/```/g, '` ` `') + '\n```';
  const cell = (v) => inClean(v).replace(/\n+/g, ' ').trim();
  if (shape === 'table') return '| Field | Value |\n| --- | --- |\n' + keys.map((k) => '| ' + cell(k).replace(/\|/g, '\\|') + ' | ' + cell(fields[k]).replace(/\|/g, '\\|') + ' |').join('\n');
  return keys.map((k) => '- **' + cell(k) + '**: ' + cell(fields[k])).join('\n');
}
function inClock(tz) {
  const d = new Date(); let parts = null;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); } catch (e) { parts = null; }
  const date = parts ? parts.year + '-' + parts.month + '-' + parts.day : d.toISOString().slice(0, 10); const time = parts ? parts.hour + ':' + parts.minute : d.toISOString().slice(11, 16);
  return { date, time, datetime: isoNow() };
}
// Agregar al final: un renglón de lista o de tabla sigue pegado al anterior; lo demás va en un párrafo aparte.
function inAppend(prev, add) {
  if (!prev.trim()) return add + '\n';
  const kind = (line) => (/^\s*([-*+]|\d+[.)])\s/.test(line) ? 'li' : /^\s*\|/.test(line) ? 'row' : '');
  const lines = prev.replace(/\s+$/, '').split('\n'); const k = kind(add.split('\n')[0]);
  return prev.replace(/\s+$/, '') + (k && k === kind(lines[lines.length - 1]) ? '\n' : '\n\n') + add + '\n';
}
async function inboxRoute(req, url, p, m) {
  const bad = 'in:bad:' + clientIp(req);
  limit(bad, 30, HOUR, 'too_many');
  const secret = p.slice(4);
  const row = /^mdi_[A-Za-z0-9_-]{20,80}$/.test(secret) ? q('SELECT * FROM inboxes WHERE hash = ?').get(sha(secret)) : null;
  if (!row) { mark(bad); throw new Fail(404, 'not_found'); }
  if (m !== 'POST' && !(m === 'GET' && row.allow_get)) throw new Fail(405, 'method_not_allowed');
  rate('in:' + row.id, IN_PER_MIN, 60000, 'rate_limited'); limit('in:day:' + row.id, IN_PER_DAY, DAY, 'rate_limited'); mark('in:day:' + row.id);
  const got = m === 'GET' ? { fields: Object.fromEntries(url.searchParams), shape: 'list' } : await inFields(req);
  const owner = userById(row.user);
  if (!autoAllowed(owner)) throw new Fail(402, 'automation_needs_plan', 'Automations are part of the paid plan');
  ctxSet('via', 'inbox'); ctxSet('user', null);
  // En el espacio de un equipo, la entrada vale mientras quien la creó pueda escribir y automatizar ahí: un lector
  // no escribe por ninguna vía. Lo que entra queda en el registro del equipo, con el nombre de la entrada.
  const team = teamOfSpace(owner);
  if (team && !(makerMay(team, row.maker, 'automation') && makerMay(team, row.maker, 'write'))) throw new Fail(403, 'team_policy', 'This entry is no longer allowed on the team space');
  const fields = got.fields; const text = inText(fields, got.shape); const title = inScalar(fields.title) ? inClean(fields.title).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!text && !title) throw new Fail(400, 'empty', 'Nothing to add: send a text field or a body');
  const clock = inClock(row.tz);
  const vars = Object.assign({}, Object.fromEntries(Object.keys(fields).filter((k) => inScalar(fields[k])).map((k) => [k.toLowerCase(), inClean(fields[k])])), { text: text || title, title, date: clock.date, time: clock.time, datetime: clock.datetime });
  const piece = (row.tpl ? row.tpl.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (all, k) => (vars[k.toLowerCase()] == null ? '' : vars[k.toLowerCase()])) : text || title).trim();
  if (!piece) throw new Fail(400, 'empty', 'Nothing to add: send a text field or a body');
  const write = (path, next) => { const saved = writeNote(owner, path, next, null); tellSaved(owner.id, path, saved, { by: 'inbox' }, next); if (team) teamLog(team, { id: row.maker, tokenName: 'Inbound: ' + (row.name || row.hint) }, saved.rev === 1 ? 'create' : 'edit', path); return saved; };
  const current = (path) => { const n = q('SELECT text, e, v FROM notes WHERE user = ? AND path = ?').get(owner.id, path); if (n && n.v) throw new Fail(409, 'vault'); return n ? unseal(n.text, n.e, 'notes.text') : null; };
  if (row.path && vaultOf(owner.id, row.path + (row.kind === 'create' ? '/x' : ''))) throw new Fail(409, 'vault', 'This entry points to a protected folder');
  let made = {};
  if (row.kind === 'create') {
    // El nombre: el campo title si vino, o la fecha y la hora. Si ya hay una nota con ese nombre, lleva un número.
    const stem = (title || clock.date + ' ' + clock.time.replace(':', '')).replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '').trim().slice(0, 100) || clock.date;
    let path = cleanPath((row.path ? row.path + '/' : '') + stem + '.md');
    if (q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(owner.id, path)) path = freePath(owner.id, path);
    write(path, piece + '\n');
  } else if (row.kind === 'card') {
    const prev = current(row.path) || '';
    const base = kbHas(prev) ? prev : inAppend(prev, '```kanban\n## ' + (row.col || 'To do') + '\n```');
    const attrs = {};
    for (const k of Object.keys(fields)) if (k !== 'text' && k !== 'title' && KB_KEY.test(k) && !KB_RESERVED.has(k) && inScalar(fields[k]) && String(fields[k] == null ? '' : fields[k]).trim() && Object.keys(attrs).length < 12) attrs[k] = fields[k];
    const out = kbApply(base, 'create', { column: row.col || null, title: (title || piece.split('\n')[0]).replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').slice(0, 300), attrs });
    write(row.path, out.text); made = { id: out.card.id };
  } else write(row.path, inAppend(current(row.path) || '', piece));
  q('UPDATE inboxes SET used = ?, n = n + 1 WHERE id = ?').run(now(), row.id);
  return Object.assign({ ok: true }, made);
}

// ---------- API REST ----------
// /api/v1, con un token mdt_ en Authorization: Bearer. Es otra puerta a lo mismo que ofrece el MCP: cada pedido
// termina en callTool, así que el alcance del token, el permiso de compartir, el espacio del equipo bajo @team/ y
// las carpetas protegidas valen igual. Respuestas: { ok: true, data } o { ok: false, error: { code, message } }.
const OPENAPI = (() => { try { const doc = JSON.parse(fs.readFileSync(new URL('./openapi.json', import.meta.url), 'utf8')); doc.servers = [{ url: PUBLIC_URL }]; return doc; } catch (e) { return null; } })();
const API_WORDS = { not_found: 'There is nothing at that path', no_auth: 'Send the token in the Authorization header: Bearer mdt_…', bad_auth: 'That token is not valid', bad_path: 'That path is not valid', bad_json: 'The body is not valid JSON', bad_rev: 'rev is a whole number',
  rev_conflict: 'The note changed since that revision: read it again and retry', too_large: 'That is too large', rate_limited: 'Too many requests: wait and retry', no_route: 'There is no such endpoint', method_not_allowed: 'That method is not allowed here', bad_text: 'The text is missing or too long',
  note_limit: 'The plan of this account does not hold more notes', exists: 'There is already a note at that path', bad_title: 'The title is missing or too long', bad_column: 'The column name is missing or too long', server_error: 'Something failed on the server' };
// El cuerpo de un error de la API. El texto de la nota que acompaña a un rev_conflict no viaja.
function apiError(e) {
  const known = e instanceof Fail; const code = known ? e.code : 'server_error'; const extra = Object.assign({}, known ? e.extra : null); delete extra.text;
  return { ok: false, error: Object.assign({ code, message: (known && e.message && e.message !== e.code ? e.message : '') || API_WORDS[code] || '' }, extra) };
}
// Lo que la API suma a las herramientas del MCP, y las mismas con la respuesta en datos. k trae las piezas de
// callTool (cómo ubicar una ruta, abrir una carpeta protegida, leer y escribir): las reglas son las de ahí.
function apiTool(name, args, k) {
  const meta = (a) => { const n = q('SELECT rev, updated, size FROM notes WHERE user = ? AND path = ?').get(a.who.id, a.p); return { path: a.full, rev: n ? n.rev : null, updated: n ? iso(n.updated) : null, size: n ? n.size : null, url: autoUrl(a.who, a.p) }; };
  const base = (a) => (args.rev == null ? k.revOf(a) : cleanRev(args.rev));
  if (name === 'read_note') { const a = k.at(args.path); k.seen(a); const text = k.read(a, k.gate(a)); return Object.assign({ text }, meta(a)); }
  if (name === 'write_note') {
    if (typeof args.text !== 'string') throw new Fail(400, 'bad_text', 'text is the Markdown content of the note');
    const a = k.at(args.path); k.mayWrite(a); const key = k.gate(a); const fresh = k.revOf(a) == null;
    k.write(a, key, args.text, args.rev == null ? undefined : cleanRev(args.rev));
    k.noted(fresh ? 'create' : 'edit', a);
    return Object.assign({ created: fresh }, meta(a));
  }
  if (name === 'append_note') { if (typeof args.text !== 'string' || !args.text) throw new Fail(400, 'bad_text', 'text is what to add at the end of the note'); k.mcp('append_note', args); return meta(k.at(args.path)); }
  if (name === 'move_note') { k.mcp('move_note', args); return Object.assign({ from: k.at(args.from).full }, meta(k.at(args.to))); }
  if (name === 'delete_note') { const a = k.at(args.path); k.mayWrite(a); k.gate(a); const out = deleteNote(a.who, a.p); k.noted('delete', a); return { path: a.full, trash: out.trash }; }
  if (name === 'add_comment') {
    const a = k.at(args.path);
    if (a.who !== k.user || k.user.teamToken) throw new Fail(409, 'team', 'Comments for the AI work on your own notes, not on the team space');
    const c = addComment(k.user, { path: a.p, quote: args.quote, text: args.text }); announce(roomKey(k.user.id, c.path), { type: 'comments' });
    return { id: c.id, path: c.path, quote: c.quote, comment: c.text, created: iso(c.created) };
  }
  if (name === 'resolve_comment') { k.mcp('resolve_comment', args); return { id: +args.id, status: 'done' }; }
  if (name === 'boards') { const a = k.at(args.path); k.seen(a); const text = k.read(a, k.gate(a)); return Object.assign({ boards: kbView(text) }, meta(a)); }
  if (name === 'card_create' || name === 'card_update' || name === 'card_delete') {
    // Leer, cambiar y escribir sobre la misma revisión: si la nota cambió en el medio, no se pisa.
    const a = k.at(args.path); k.mayWrite(a); const key = k.gate(a); const rev = base(a); const text = k.read(a, key);
    const out = kbApply(text, name.slice(5), args);
    k.write(a, key, out.text, rev);
    k.noted('edit', a, 'card');
    return Object.assign({ card: out.card, board: out.board }, meta(a));
  }
  return undefined;
}
// Las herramientas de tablero del MCP. Son las operaciones de arriba (card_create, card_update, card_delete) con otro
// nombre: las reglas de las tarjetas viven en kbApply y las de acceso en callTool. La respuesta lleva la tarjeta con
// su id y su columna, y la dirección para abrir la nota.
const KB_DEFAULT_COLUMNS = ['To do', 'In progress', 'Paused', 'Done'];
function boardTool(name, args, k) {
  const a = k.at(args.path); const where = () => ({ path: a.full, url: k.openUrl(a) });
  if (name === 'list_boards') {
    k.seen(a); const text = k.read(a, k.gate(a));
    const boards = kbBlocks(text).blocks.map((b, bi) => { const done = kbDoneColumn(b.board); return { board: bi, done_column: done ? done.title : null,
      columns: b.board.columns.map((col, ci) => ({ column: col.title, cards: col.cards.map((c, ki) => Object.assign({ id: c.id || bi + '.' + ci + '.' + ki, title: c.text, done: c.done }, Object.keys(c.attrs).length ? { fields: Object.assign({}, c.attrs) } : {})) })) }; });
    return Object.assign(where(), { boards }, boards.length ? {} : { note: 'This note has no kanban board. Create one with create_board.' });
  }
  if (name === 'create_board') {
    // Leer y escribir sobre la misma revisión, como las tarjetas: no pisa un guardado que entró en el medio.
    k.mayWrite(a); const key = k.gate(a); const rev = k.revOf(a); const prev = rev == null ? '' : k.read(a, key);
    const names = args.columns == null ? KB_DEFAULT_COLUMNS : args.columns;
    if (!Array.isArray(names) || !names.length || names.length > 20) throw new Fail(400, 'bad_columns', 'columns is a list of 1 to 20 column names');
    const board = { show: [], fields: {}, columns: [] };
    for (const n of names) { const title = kbText(n, 120, 'bad_column'); if (board.columns.some((c) => c.title.toLowerCase() === title.toLowerCase())) throw new Fail(400, 'bad_columns', 'Two columns have the same name: ' + title); board.columns.push({ title, cards: [] }); }
    const done = args.done == null || args.done === '' ? kbDoneColumn(board) : kbColumn(board, args.done);
    if (done) board.done = done.title;
    const head = args.title == null || args.title === '' ? '' : kbText(args.title, 200, 'bad_title');
    const top = rev == null ? '# ' + (head || a.p.split('/').pop().replace(/\.[^.]+$/, '')) + '\n\n' : (prev.trim() ? prev.replace(/\s+$/, '') + '\n\n' : '') + (head ? '## ' + head + '\n\n' : '');
    k.write(a, key, top + ['```kanban'].concat(kbWrite(board), '```').join('\n') + '\n', rev);
    k.noted(rev == null ? 'create' : 'edit', a);
    return Object.assign({ result: (rev == null ? 'Created the note with a board' : 'Added a board to the note') + ': ' + board.columns.map((c) => c.title).join(', ') + '.' + (done ? ' Cards moved to ' + done.title + ' are marked as done.' : '') }, where(), { board: kbBlocks(prev).blocks.length, columns: board.columns.map((c) => c.title), done_column: done ? done.title : null });
  }
  const fields = args.fields === undefined ? args.attrs : args.fields; const path = args.path; const id = args.id; let out; let did;
  if (name === 'add_card') { out = apiTool('card_create', { path, board: args.board, column: args.column, title: args.title, attrs: fields, position: args.position }, k); did = 'Card added to ' + out.card.column; }
  else if (name === 'move_card') {
    if (args.column == null || args.column === '') throw new Fail(400, 'bad_column', 'column is the name of the column to move the card to');
    out = apiTool('card_update', { path, id, column: args.column, position: args.position }, k); did = 'Card moved to ' + out.card.column + (out.card.done ? ' and marked as done' : '');
  } else if (name === 'update_card') { out = apiTool('card_update', { path, id, title: args.title, attrs: fields, done: args.done }, k); did = 'Card updated'; }
  else { out = apiTool('card_delete', { path, id }, k); did = 'Card deleted'; }
  const c = out.card;
  return Object.assign({ result: did + '.', card: { id: c.id, title: c.title, column: c.column, done: c.done, fields: c.attrs } }, where(), { board: out.board });
}

// ---------- Agentes ----------
// Una IA que reparte trabajo se anota acá: cada agente con el nombre que ella elige, su tarea en una línea y, si
// corresponde, la nota o la tarjeta del tablero en la que trabaja. La persona los ve en vivo desde la app
// (herramienta Agentes, src/agents.js). Son temporales y no tocan las notas: viven en esta tabla, por cuenta. Con un
// token de equipo la cuenta es el espacio del equipo, y los ve cada miembro.
//   - La señal de vida es cualquier llamada MCP que lleve agent_id, un update_agent, o mover o cambiar su tarjeta.
//   - Sin señal AGENT_STALE_MS figura 'silent'; sin señal AGENT_GONE_MS se va. Al terminar ('done') sigue a la vista
//     AGENT_DONE_MS.
//   - Plan gratis: FREE_AGENTS con señal a la vez, y nada queda después. Plan pago: sin tope, y los que terminaron o
//     se perdieron ('lost') quedan AGENT_HISTORY_MS como historial.
//   - Con una tarjeta enlazada, su campo agent pasa a llevar el nombre. Al terminar, la tarjeta y su campo quedan.
// El nombre, la tarea, lo que necesita y el resultado se guardan cifrados si hay DATA_KEY, como el resto del texto.
db.exec("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, token INTEGER, name TEXT NOT NULL, task TEXT NOT NULL DEFAULT '', needs TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', e INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'working', parent TEXT NOT NULL DEFAULT '', note_owner INTEGER, note_path TEXT NOT NULL DEFAULT '', card TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, seen INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0)");
db.exec('CREATE INDEX IF NOT EXISTS agents_owner ON agents (owner)');
ACCOUNT_ROWS.unshift('DELETE FROM agents WHERE owner = ?');
const AGENT_DEFS = [
  { name: 'start_agent', description: 'Register an agent that is working on the notes, so the person sees it live in SharpMD: who is working, on what, and what it needs. Call it when you split work between subagents (each one registers itself, with its own name) or when you start a long task. Returns the id of the agent. It is temporary: it is removed on its own when it stops giving signs of life, and nothing is written to the notes.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Short name you choose to tell this agent apart, for example tests or docs writer' }, task: { type: 'string', description: 'One line: what this agent is doing' }, path: { type: 'string', description: 'Optional: the note it works on, for example project/board.md' }, card: { type: 'string', description: 'Optional: id of its card on the board of that note. The field agent of the card is set to the name' }, parent: { type: 'string', description: 'Optional: id of the agent that launched this one' } }, required: ['name', 'task'] } },
  { name: 'update_agent', description: 'Change what an agent shows: its task, its status, or the note or card it works on. Status is working, waiting (it needs something from the person: say exactly what in needs) or done. Calling it also counts as a sign of life.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id of the agent, from start_agent' }, task: { type: 'string', description: 'One line: what it is doing now' }, status: { type: 'string', enum: ['working', 'waiting', 'done'] }, needs: { type: 'string', description: 'With waiting: what it needs from the person, in one line' }, path: { type: 'string', description: 'The note it works on now. Empty to clear it' }, card: { type: 'string', description: 'Id of its card on the board of that note' } }, required: ['id'] } },
  { name: 'end_agent', description: 'Mark an agent as finished. Call it when its task is done or abandoned. It stays visible for a short while and then goes away. Its card on the board is not touched: move it to Done with move_card.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id of the agent, from start_agent' }, result: { type: 'string', description: 'Optional: one line on how it ended' } }, required: ['id'] } },
  { name: 'list_agents', description: 'List the agents registered on this account: name, task, status (working, waiting, silent when it gave no sign of life for a while, done), what it needs, and the note or card it works on. Use it to see what the other agents are doing before you start something.', inputSchema: { type: 'object', properties: { history: { type: 'boolean', description: 'Optional: also the agents that ended in the last hours. Paid plan only' } } } },
];
const AGENT_TOOLS = new Set(AGENT_DEFS.map((t) => t.name));
// Las demás herramientas aceptan agent_id: con él, la llamada cuenta como señal de vida de ese agente.
const AGENT_ARG = { type: 'string', description: 'Optional: your id from start_agent, to show you are still at work' };
const agentArg = (t) => Object.assign({}, t, { inputSchema: Object.assign({}, t.inputSchema, { properties: Object.assign({}, t.inputSchema.properties, { agent_id: AGENT_ARG }) }) });
const AGENT_COL = 'agents.text';
const agentText = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
// Un tiempo en palabras, para lo que lee la IA: sale de las constantes, nunca escrito a mano.
const agentSpan = (ms) => { const one = (n, w) => n + ' ' + w + (n === 1 ? '' : 's'); return ms >= 2 * HOUR ? one(Math.round(ms / HOUR), 'hour') : ms >= 60000 ? one(Math.round(ms / 60000), 'minute') : one(Math.max(1, Math.round(ms / 1000)), 'second'); };
// Un texto vacío se guarda vacío: no hay nada que cifrar.
const agentSeal = (v) => (v === '' ? '' : seal(v, AGENT_COL)); const agentPlain = (v, e) => (v === '' ? '' : unseal(v, e, AGENT_COL));
const agentOpen = (r) => Object.assign(r, { name: agentPlain(r.name, r.e), task: agentPlain(r.task, r.e), needs: agentPlain(r.needs, r.e), result: agentPlain(r.result, r.e) });
// Cómo figura: lo que se guardó, salvo que lleve un rato sin señal.
const agentState = (r, t) => (r.ended ? r.status : t - r.seen > AGENT_STALE_MS ? 'silent' : r.status);
// A la vista: los que no terminaron, y los que terminaron hace poco. Lo demás es historial.
const agentLive = (r, t) => !r.ended || (r.status === 'done' && t - r.ended <= AGENT_DONE_MS);
const agentsActive = (ownerId) => q('SELECT COUNT(*) AS n FROM agents WHERE owner = ? AND ended = 0 AND seen > ?').get(ownerId, now() - AGENT_STALE_MS).n;
// Avisa a las páginas abiertas: a las notas de la cuenta y, si el agente trabaja sobre una nota de otro espacio
// (la del equipo, desde el token de un miembro), también a esa. La app vuelve a pedir la lista.
const agentShown = new Map(); // id → cómo figuraba la última vez que se avisó
function agentTell(r) {
  announceUser(r.owner, { type: 'agents' });
  if (r.note_owner && r.note_owner !== r.owner && r.note_path) announce(roomKey(r.note_owner, r.note_path), { type: 'agents' });
}
// Saca lo vencido de una cuenta, o de todas. Lo que se pierde pasa al historial en el plan pago y se borra en el gratis.
function agentsSweep(ownerId) {
  const t = now(); const paid = new Map();
  const keeps = (owner) => { if (!paid.has(owner)) { const u = userById(owner); paid.set(owner, !!u && u.plan === 'pro'); } return paid.get(owner); };
  const cols = 'SELECT id, owner, status, seen, ended, note_owner, note_path FROM agents';
  for (const r of ownerId == null ? q(cols).all() : q(cols + ' WHERE owner = ?').all(ownerId)) {
    const lost = !r.ended && t - r.seen > AGENT_GONE_MS;
    if (lost && keeps(r.owner)) { q("UPDATE agents SET status = 'lost', ended = ? WHERE id = ?").run(r.seen + AGENT_GONE_MS, r.id); agentShown.set(r.id, 'past'); agentTell(r); }
    else if (lost || (r.ended && t - r.ended > (keeps(r.owner) ? AGENT_HISTORY_MS : AGENT_DONE_MS))) { q('DELETE FROM agents WHERE id = ?').run(r.id); agentShown.delete(r.id); agentTell(r); }
  }
}
// El reloj: lo que cambió solo por el paso del tiempo (quedó sin señal, se fue, dejó de estar a la vista) se avisa.
function agentsTick() {
  agentsSweep(); const t = now();
  for (const r of q('SELECT id, owner, status, seen, ended, note_owner, note_path FROM agents').all()) {
    const view = agentLive(r, t) ? agentState(r, t) : 'past';
    if (agentShown.get(r.id) !== view) { agentShown.set(r.id, view); agentTell(r); }
  }
}
setInterval(() => { try { agentsTick(); } catch (e) { /* en la próxima vuelta */ } }, Math.min(15000, Math.max(100, Math.min(AGENT_STALE_MS, AGENT_DONE_MS) / 3))).unref();
const agentChanged = (id) => { const r = q('SELECT id, owner, status, seen, ended, note_owner, note_path FROM agents WHERE id = ?').get(id); if (r) { agentShown.set(r.id, agentLive(r, now()) ? agentState(r, now()) : 'past'); agentTell(r); } };
// Señal de vida. Devuelve si el agente sigue anotado. Solo avisa a la app si venía sin señal.
function agentBeat(user, id) {
  if (typeof id !== 'string' || !id || id.length > 40) return false;
  const r = q('SELECT id, seen FROM agents WHERE id = ? AND owner = ? AND ended = 0').get(id, user.id); if (!r) return false;
  q('UPDATE agents SET seen = ? WHERE id = ?').run(now(), id);
  if (now() - r.seen > AGENT_STALE_MS) agentChanged(id);
  return true;
}
function agentCardBeat(user, a, card) {
  for (const r of q('SELECT id FROM agents WHERE owner = ? AND note_owner = ? AND note_path = ? AND card = ? AND ended = 0').all(user.id, a.who.id, a.p, String(card))) agentBeat(user, r.id);
}
const AGENT_GONE = () => 'There is no agent with that id on this account. It may have been removed after ' + agentSpan(AGENT_GONE_MS) + ' without a sign of life. Register it again with start_agent.';
// Lo que se suma a la respuesta de cualquier otra herramienta llamada con agent_id: nada si el agente sigue anotado.
function agentPulse(user, params) {
  const id = params && params.arguments && params.arguments.agent_id;
  if (id == null || id === '' || AGENT_TOOLS.has(params.name)) return [];
  return agentBeat(user, String(id)) ? [] : ['The agent ' + agentText(id, 40) + ' is not registered any more, so the person does not see it. Register it again with start_agent.'];
}
// El uso del plan gratis, en una línea. null en el plan pago.
const agentPlan = (user) => (user.plan === 'pro' ? null : 'Free plan: ' + agentsActive(user.id) + ' of ' + FREE_AGENTS + ' agents active at once, and no history.');
function agentTool(name, args, k) {
  const user = k.user; const owner = user.id; const t = now();
  agentsSweep(owner);
  // La ruta como la escribe esta IA: una nota del equipo, vista desde el token de un miembro, va bajo @team/.
  const fullOf = (r) => (!r.note_path ? '' : r.note_owner === owner ? r.note_path : TEAM_PRE + r.note_path);
  const view = (r) => {
    const out = { id: r.id, name: r.name, task: r.task, status: agentState(r, now()) };
    if (r.needs) out.needs = r.needs; if (r.result) out.result = r.result; if (r.parent) out.parent = r.parent;
    if (r.note_path) out.path = fullOf(r); if (r.card) out.card = r.card;
    out.started = iso(r.created); out.last_seen = iso(r.seen); if (r.ended) out.ended = iso(r.ended);
    return out;
  };
  // Un token limitado a una carpeta ve los agentes que anotó él y los que trabajan dentro de su carpeta: de los
  // demás no se entera, ni por su tarea ni por la ruta de su nota.
  const reach = (r) => !user.scope || (r.token != null && r.token === user.tokenId) || (!!r.note_path && within(user, fullOf(r)));
  const all = () => q('SELECT * FROM agents WHERE owner = ? ORDER BY created, rowid').all(owner).filter(reach).map(agentOpen);
  const one = (id) => { const r = q('SELECT * FROM agents WHERE id = ? AND owner = ?').get(typeof id === 'string' ? id : '', owner); if (!r || r.status === 'lost' || !reach(r)) throw new Fail(404, 'agent_not_found', AGENT_GONE()); return agentOpen(r); };
  // Dónde trabaja: una nota que existe y, si se dio, una tarjeta de su tablero. El campo agent de esa tarjeta pasa a
  // llevar el nombre (si este token puede escribir ahí): así el tablero y esta lista dicen lo mismo.
  const link = (path, card, agentName) => {
    const none = card == null || card === '';
    if (path == null || path === '') { if (!none) throw new Fail(400, 'bad_card', 'card needs path: the note that holds the board'); return { owner: null, path: '', card: '', a: null }; }
    const a = k.at(path);
    if (k.revOf(a) == null) throw new Fail(404, 'not_found', 'There is no note at ' + a.full + '.');
    if (none) return { owner: a.who.id, path: a.p, card: '', a };
    const text = k.read(a, k.gate(a)); let hit = null;
    for (const b of kbBlocks(text).blocks) for (const col of b.board.columns) for (const c of col.cards) if (!hit && c.id && c.id === String(card)) hit = c;
    if (!hit) throw new Fail(404, 'card_not_found', 'There is no card with the id ' + agentText(card, 40) + ' in ' + a.full + '. Take the id from add_card or list_boards.');
    let can = user.canWrite !== false; try { k.mayWrite(a); } catch (e) { can = false; }
    if (can && hit.attrs.agent !== agentName) apiTool('card_update', { path: a.full, id: hit.id, attrs: { agent: agentName } }, k);
    return { owner: a.who.id, path: a.p, card: hit.id, a };
  };
  const where = (l) => (l.a ? Object.assign({ path: l.a.full }, l.card ? { card: l.card } : {}, { url: k.openUrl(l.a) }) : {});
  if (name === 'list_agents') {
    const rows = all(); const plan = agentPlan(user);
    const out = { agents: rows.filter((r) => agentLive(r, t)).map(view) };
    if (args.history) { if (plan) out.history_note = 'The history of the agents that ended is part of the paid plan, which keeps the last ' + agentSpan(AGENT_HISTORY_MS) + ': ' + plansUrl(); else out.history = rows.filter((r) => !agentLive(r, t)).sort((a, b) => b.ended - a.ended).slice(0, AGENT_HISTORY_PAGE).map(view); }
    if (plan) out.plan = plan;
    return out;
  }
  if (name === 'start_agent') {
    const wanted = agentText(args.name, 40); if (!wanted) throw new Fail(400, 'bad_name', 'name is a short name for this agent, for example tests or docs writer');
    const task = agentText(args.task, 200); if (!task) throw new Fail(400, 'bad_task', 'task is one line that says what this agent is doing');
    const rows = all().filter((r) => !r.ended);
    let parent = '';
    if (args.parent != null && args.parent !== '') { const p = rows.find((r) => r.id === args.parent); if (!p) throw new Fail(404, 'agent_not_found', 'parent is the id of an agent that is still registered. ' + AGENT_GONE()); parent = p.id; }
    const active = agentsActive(owner);
    // El tope del plan gratis cuenta los que dan señal: uno que se colgó no le ocupa el lugar a otro.
    if (user.plan !== 'pro' && active >= FREE_AGENTS) throw new Fail(402, 'agent_limit', 'Free plan: ' + FREE_AGENTS + ' agents can be active at once and this account has ' + active + '. This one was not registered. The work can go on without it, or end one that finished with end_agent. Tell the person what happened: the paid plan has no limit on agents and keeps the history of the last ' + agentSpan(AGENT_HISTORY_MS) + ': ' + plansUrl(), { limit: FREE_AGENTS, active });
    if (q('SELECT COUNT(*) AS n FROM agents WHERE owner = ? AND ended = 0').get(owner).n >= AGENTS_MAX) throw new Fail(429, 'too_many', 'This account already has ' + AGENTS_MAX + ' agents registered. End the ones that finished with end_agent.');
    const agentName = freeName(wanted, rows.map((r) => r.name));
    const l = link(args.path, args.card, agentName);
    const id = 'ag_' + random(6);
    q('INSERT INTO agents (id, owner, token, name, task, e, status, parent, note_owner, note_path, card, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, owner, user.tokenId == null ? null : user.tokenId, agentSeal(agentName), agentSeal(task), SEALED, 'working', parent, l.owner, l.path, l.card, t, t);
    // El historial tiene techo: pasado eso se van los más viejos.
    q('DELETE FROM agents WHERE owner = ? AND ended > 0 AND id NOT IN (SELECT id FROM agents WHERE owner = ? AND ended > 0 ORDER BY ended DESC LIMIT ?)').run(owner, owner, AGENT_HISTORY_MAX);
    agentChanged(id);
    const plan = agentPlan(user);
    return Object.assign({ id, name: agentName, task, status: 'working' }, parent ? { parent } : {}, where(l),
      { note: 'Pass agent_id: "' + id + '" on your other calls so the person sees this agent is at work. Call update_agent when its task changes or it needs something from the person, and end_agent when it finishes. After ' + agentSpan(AGENT_STALE_MS) + ' without a call it shows as silent, and after ' + agentSpan(AGENT_GONE_MS) + ' it is removed.' }, plan ? { plan } : {});
  }
  const r = one(args.id);
  if (name === 'end_agent' || (name === 'update_agent' && args.status === 'done')) {
    if (r.status !== 'done') {
      const result = args.result == null ? r.result : agentText(args.result, 200);
      q("UPDATE agents SET status = 'done', needs = ?, result = ?, e = ?, name = ?, task = ?, seen = ?, ended = ? WHERE id = ?").run(agentSeal(''), agentSeal(result), SEALED, agentSeal(r.name), agentSeal(r.task), t, t, r.id);
      agentChanged(r.id);
    }
    return Object.assign(view(one(r.id)), { note: 'Ended. It stays visible for ' + agentSpan(AGENT_DONE_MS) + '.' + (r.card ? ' Its card was not touched.' : '') });
  }
  // update_agent
  if (r.status === 'done') throw new Fail(409, 'agent_ended', 'This agent already ended. Register a new one with start_agent.');
  if (args.status != null && args.status !== 'working' && args.status !== 'waiting') throw new Fail(400, 'bad_status', 'status is working, waiting or done');
  const task = args.task == null ? r.task : agentText(args.task, 200); if (!task) throw new Fail(400, 'bad_task', 'task is one line that says what this agent is doing');
  const asked = args.needs == null ? null : agentText(args.needs, 200);
  // Decir qué necesita es quedar esperando; volver a trabajar lo borra.
  const status = args.status || (asked ? 'waiting' : asked === '' ? 'working' : r.status);
  const needs = status === 'waiting' ? (asked == null ? r.needs : asked) : '';
  if (status === 'waiting' && !needs) throw new Fail(400, 'bad_needs', 'With status waiting, needs says in one line what this agent needs from the person');
  const here = () => { try { return r.note_path ? k.at(fullOf(r)) : null; } catch (e) { return null; } };
  let l = { owner: r.note_owner, path: r.note_path, card: r.card, a: here() };
  if (args.path !== undefined || args.card !== undefined) l = link(args.path === undefined ? fullOf(r) : args.path, args.card === undefined ? (args.path === undefined ? r.card : '') : args.card, r.name);
  q('UPDATE agents SET task = ?, needs = ?, name = ?, result = ?, e = ?, status = ?, note_owner = ?, note_path = ?, card = ?, seen = ? WHERE id = ?')
    .run(agentSeal(task), agentSeal(needs), agentSeal(r.name), agentSeal(r.result), SEALED, status, l.owner, l.path, l.card, t, r.id);
  agentChanged(r.id);
  return Object.assign(view(one(r.id)), l.a ? { url: k.openUrl(l.a) } : {}, status === 'waiting' ? { note: 'The person sees what this agent needs. Tell them in the conversation too.' } : {});
}
// Lo que la app muestra: los agentes de la cuenta y, si está en un equipo, los del espacio del equipo. Las rutas van
// como las abre la app (~espacio/ruta para lo que no es propio). El historial, solo en el plan pago.
function agentsFor(user) {
  const t = now(); const owners = [user.id].concat(user.team && user.team.space ? [user.team.space] : []);
  const rows = [];
  for (const o of owners) { agentsSweep(o); for (const r of q('SELECT * FROM agents WHERE owner = ? ORDER BY created, rowid').all(o)) rows.push(agentOpen(r)); }
  const tokens = new Map(); const tokenOf = (id) => { if (id == null) return ''; if (!tokens.has(id)) { const x = q('SELECT name FROM tokens WHERE id = ?').get(id); tokens.set(id, x ? x.name : ''); } return tokens.get(id); };
  const view = (r) => ({ id: r.id, name: r.name, task: r.task, status: agentState(r, t), needs: r.needs, result: r.result, parent: r.parent, path: !r.note_path ? '' : r.note_owner === user.id ? r.note_path : '~' + r.note_owner + '/' + r.note_path, card: r.card,
    // El nombre del token se muestra a quien es su dueño; de los del equipo, solo el cliente que se conectó.
    token: r.owner === user.id ? tokenOf(r.token) : '', client: (r.token != null && mcpClients.get(r.token)) || '', team: r.owner !== user.id, created: r.created, seen: r.seen, ended: r.ended });
  const paid = user.plan === 'pro';
  return { now: t, agents: rows.filter((r) => agentLive(r, t)).map(view), history: paid ? rows.filter((r) => !agentLive(r, t)).sort((a, b) => b.ended - a.ended).slice(0, AGENT_HISTORY_PAGE).map(view) : null,
    limit: paid ? null : FREE_AGENTS, free_agents: FREE_AGENTS, history_hours: Math.round(AGENT_HISTORY_MS / HOUR), stale_ms: AGENT_STALE_MS, gone_ms: AGENT_GONE_MS, done_ms: AGENT_DONE_MS };
}
// La guía que una IA lee a demanda (get_guide): cómo documentar un proyecto y cómo llevar su tablero. El mensaje que
// se copia desde la app (aiBrief, en src/sync.js) trae el resumen; el detalle está solo acá.
function guide(user) {
  const F = '```'; const dir = user.scope || '<project>'; const ro = user.canWrite === false; const use = planUse(user);
  return [
    '# Working in SharpMD',
    '',
    'Three jobs, done without being asked: keep the project documented, keep a task board the person can follow, and keep a list of what the person has to do.',
    '',
    '## The project folder',
    '',
    user.teamToken ? 'This token reaches the shared notes of a team. Use one top-level folder per project.' : user.scope ? 'This token only reaches ' + user.scope + '/, so that folder is the project folder.' : 'One top-level folder per project. If its name is not evident from the conversation or from list_folders, ask the person once.',
    'Before you create anything, call list_notes on the folder and search_notes, and read what is there. Update what exists instead of writing a second copy.',
    '',
    '| Note | What it holds |',
    '| --- | --- |',
    '| ' + dir + '/README.md | What the project is, how to run it, and an index with a link to every other note. |',
    '| ' + dir + '/architecture.md | The components and how they connect, with a Mermaid diagram. |',
    '| ' + dir + '/features/<name>.md | One note per feature: what it does, how it is used, acceptance criteria, where it lives in the code, what is pending. |',
    '| ' + dir + '/epics.md | The epics, each with its features and its status. |',
    '| ' + dir + '/decisions.md | Decision log, newest last: date, context, decision, consequence. |',
    '| ' + dir + '/log.md | Dated work log. Add entries with append_note, do not rewrite it. |',
    '| ' + dir + '/board.md | The task board. |',
    '| ' + dir + '/pending.md | What the person has to do, each item with its steps. |',
    '',
    '- Create the structure in the first session, from what you can learn in the code and the conversation. Leave a section empty instead of inventing its content.',
    '- Before you create the structure, check how much room the plan has: on the free plan list_notes says it.' + (use ? ' Right now: ' + planLine(use).replace(/^Free plan: /, '') : '') + ' If the whole structure does not fit, create README.md, board.md and pending.md first and tell the person which notes were left out.',
    '- Keep it current as you work. A feature that changes updates its note, a choice between options adds an entry to decisions.md, and each session adds an entry to log.md.',
    '- Link the notes with relative paths: [Architecture](architecture.md) from the README, [README](../README.md) from a feature note.',
    '- Read a note right before you change it. The rules for changing notes are in the next section.',
    '',
    '### Feature note',
    '',
    F + 'markdown',
    '# Feature name',
    '',
    'Status: planned, in progress or done. Epic: [name](../epics.md).',
    '',
    '## What it does',
    '## How it is used',
    '## Acceptance criteria',
    '- [ ] One line per criterion',
    '## Where it lives in the code',
    '## Pending',
    F,
    '',
    '### Epics',
    '',
    F + 'markdown',
    '## Epic name',
    '',
    'Status: planned, in progress or done.',
    '',
    '- [Feature name](features/feature-name.md): status',
    F,
    '',
    '### Decision entry',
    '',
    F + 'markdown',
    '## 2026-01-15 Short title',
    '',
    '- Context: what forced the choice.',
    '- Decision: what was chosen.',
    '- Consequence: what it costs or changes.',
    F,
    '',
    '### Log entry',
    '',
    F + 'markdown',
    '## 2026-01-15',
    '',
    '- What changed, with a link to the note or the commit.',
    F,
    '',
    '## Changing a note the person also edits',
    '',
    'The person has the same notes open, writes in them and checks tasks while you work. What they wrote or checked always stays.',
    '',
    '- Read a note right before you change it, not at the start of the session.',
    '- Change only the part you need: edit_note replaces one exact passage, set_task checks or unchecks one task, append_note adds at the end, and the board tools move one card.',
    '- Use write_note to create a note or to rewrite it whole, and then pass base_rev with the version read_note gave you. If the person changed the note in the meantime, their changes are merged with yours. If both changed the same lines nothing is saved and you get the current text: apply your change to it and try again.',
    '- Never uncheck a task the person checked, and never delete or reword what they wrote, unless they ask for it.',
    '- The same goes for Markdown files on the disk: read the file again right before each edit, make small edits to the lines you need, and never rewrite the whole file.',
    '',
    '## The task board',
    '',
    'The board is ' + dir + '/board.md, with the columns To do, In progress, Paused and Done. If the note has no board, create it with create_board: those four columns are its default. If it has one, call list_boards and use its column names as they are, in whatever language: planned, being done, waiting for the person, finished.',
    '',
    'Change the board with add_card, move_card and update_card, not with write_note. They keep the card ids, and the person sees the change at once.',
    '',
    '1. Before you start a piece of work, add one card per task to To do: a short title, and a field agent with who will do it (your name, or the name of the subagent).',
    '2. When you start a task, move its card to In progress.',
    '3. When you need something from the person, move the card to Paused, set the field needs to exactly what you need, and tell the person in the conversation.',
    '4. When the person answers, remove needs (set it to an empty value) and move the card back to In progress.',
    '5. When the task is finished, move the card to Done and set the field link to the note or the change that shows the result.',
    '',
    '- One card per task. A card In progress means someone is working on it now.',
    '- Do not delete finished cards: they are the record of the work.',
    '- With subagents, give each one the path of the board and the id of its card, and have it move its own card.',
    '- The fields agent, needs and link have that meaning. Others are free, for example due=2026-01-31 or priority=high.',
    '',
    '## Agents',
    '',
    'The person can watch live who is working on their notes. Register when you split work between subagents, or when you start a task that will take a while. A quick single edit does not need it.',
    '',
    '- start_agent takes a short name you choose, the task in one line and, if there is one, the path of the board and the id of the card. It returns an id. The field agent of the card is set to the name.',
    '- Each subagent registers itself with its own name, passes parent with your id, and moves its own card.',
    '- Pass agent_id on the other calls: each one is a sign of life. After ' + agentSpan(AGENT_STALE_MS) + ' without one the agent shows as silent, and after ' + agentSpan(AGENT_GONE_MS) + ' it is removed.',
    '- When it needs something from the person, call update_agent with status waiting and needs, besides moving the card to Paused.',
    '- Call end_agent when the task is done. The card stays on the board.',
    ...(user.plan === 'pro' ? [] : ['- The free plan shows ' + FREE_AGENTS + ' agents at once. If start_agent says the limit was reached, go on with the work and tell the person.']),
    '',
    '## The list of what the person has to do',
    '',
    'The board holds your tasks. What only the person can do (open an account, pay, decide, hand over a credential) goes in ' + dir + '/pending.md. Create it the first time something depends on them, and link it from the README.',
    '',
    '- It is a task list (- [ ] and - [x]) grouped by topic under headings, the most urgent first. One short line per item.',
    '- The steps go right under the item, indented inside it, in a collapsible section (::: details Steps, the steps, then ::: to close). The list stays readable and the steps are one click away.',
    '- Number the steps. Each one is a single action with the direct link to the exact page where it is done. "Go to the console" is not a step: the link is.',
    '- Say what the person has to bring back (a key, an id, a yes or a no) and where to leave it.',
    '- If it costs money, say how much and where it is paid.',
    '- If you are not sure of a menu path, say so and ask for a screenshot. Do not invent it.',
    '- Never ask for a secret in the conversation. Name the file or the screen where the person enters it.',
    '- Tick an item as soon as you learn it is done. When the person decides something, move it to a section Decided, with the date.',
    '- Your own tasks stay on the board. If one has to appear here, mark it as yours.',
    '- At the end of every session, tell the person what is left for them, with the link to this note.',
    '',
    F + 'markdown',
    '# Pending',
    '',
    '## Payments',
    '',
    '- [ ] Create the payment account',
    '  ::: details Steps',
    '  1. Open [the sign-up page](https://dashboard.example.com/register) and create the account. It is free.',
    '  2. Copy the secret key from [API keys](https://dashboard.example.com/apikeys).',
    '  3. Paste it in the file .env, on the line PAYMENT_KEY=. Do not send it in the chat.',
    '  :::',
    '- [ ] Choose the plan: 20 USD a month, paid at [Billing](https://dashboard.example.com/billing)',
    '',
    '## Decided',
    '',
    '- [x] 2026-01-15 The domain is example.com',
    F,
    '',
    '## ' + (ro ? 'This token cannot write' : 'Without write access, or with local files'),
    '',
    (ro ? 'This token can only read, so keep' : 'If a token cannot write, or the person prefers local files, keep') + ' the same structure as .md files on disk, for example in a docs folder of the repository, and give the person a link to each file as the server instructions say. There the board is a code block in board.md that you edit as text:',
    '',
    F + 'markdown',
    F.replace(/`/g, '~') + 'kanban',
    '{done=Done}',
    '## To do',
    '- [ ] Short title of the task {agent=claude}',
    '',
    '## In progress',
    '',
    '## Paused',
    '',
    '## Done',
    '- [x] A finished task {agent=claude link=features/sign-in.md}',
    F.replace(/`/g, '~'),
    F,
  ].join('\n') + '\n';
}
async function apiRoute(req, url, p, m) {
  const r = p.slice(7) || '/';
  if (r === '/openapi.json' && m === 'GET') { if (!OPENAPI) throw new Fail(404, 'not_found'); return Object.assign({ __cache: 'public, max-age=300' }, OPENAPI); }
  const user = userFrom(req, 'token');
  if (!apiAllowed(user)) throw new Fail(402, 'api_needs_plan', 'The API is part of the paid plan');
  rate('api:' + user.tokenId, API_PER_MIN, 60000, 'rate_limited');
  ctxSet('via', 'api');
  // Adjuntos: el cuerpo es la imagen misma, no JSON (bloque ADJUNTOS).
  if (r === '/files' || r.startsWith('/files/')) return filesApi(req, url, r, m, user);
  const qs = url.searchParams; const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
  const arg = (key) => (body[key] !== undefined ? body[key] : qs.has(key) ? qs.get(key) : undefined);
  const call = (name, args) => callTool(user, name, args, { raw: true });
  const ok = (data, more) => Object.assign({ ok: true, data }, more);
  const num = (v) => (v == null || v === '' ? undefined : Number.isInteger(+v) ? +v : NaN);
  if (r === '/me' && m === 'GET') return ok({ account: autoAcct(user.id), plan: user.plan, scope: user.scope || null, can_share: !!user.canShare, team: !!(user.team || user.teamToken), team_token: !!user.teamToken, limits: { requests_per_minute: API_PER_MIN } });
  if (r === '/notes' && m === 'GET') {
    const all = call('list_notes', { folder: qs.get('folder') || undefined });
    const size = Math.min(200, Math.max(1, +(qs.get('limit') || 50) || 50)); let from = 0;
    if (qs.get('cursor')) { from = +Buffer.from(qs.get('cursor'), 'base64url').toString('utf8'); if (!Number.isInteger(from) || from < 0) throw new Fail(400, 'bad_cursor', 'That cursor is not valid'); }
    return ok(all.slice(from, from + size), { total: all.length, next_cursor: from + size < all.length ? Buffer.from(String(from + size)).toString('base64url') : null });
  }
  if (r === '/folders' && m === 'GET') return ok(call('list_folders', {}));
  if (r === '/search' && m === 'GET') { const out = call('search_notes', { query: qs.get('q') || '' }); return Array.isArray(out) ? ok(out) : ok(out.results, { locked_folders: out.locked_folders }); }
  if (r === '/note') {
    if (m === 'GET') return ok(call('read_note', { path: qs.get('path') }));
    if (m === 'PUT' || m === 'POST') return ok(call('write_note', { path: arg('path'), text: body.text, rev: body.rev }));
    if (m === 'DELETE') return ok(call('delete_note', { path: qs.get('path') }));
  }
  if (r === '/note/append' && m === 'POST') return ok(call('append_note', { path: arg('path'), text: body.text }));
  if (r === '/note/move' && m === 'POST') return ok(call('move_note', { from: body.from, to: body.to }));
  if (r === '/history' && m === 'GET') { const v = num(qs.get('version')); const out = call('note_history', { path: qs.get('path'), version: v }); return ok(v == null ? out : { path: qs.get('path'), version: v, text: out }); }
  if (r === '/comments' && m === 'GET') return ok(call('list_comments', { path: qs.get('path') || undefined }));
  if (r === '/comments' && m === 'POST') return ok(call('add_comment', { path: body.path, quote: body.quote, text: body.text }));
  const cm = /^\/comments\/(\d+)\/resolve$/.exec(r);
  if (cm && m === 'POST') return ok(call('resolve_comment', { id: +cm[1], reply: body.reply }));
  if (r === '/boards' && m === 'GET') return ok(call('boards', { path: qs.get('path') }));
  if (r === '/boards/cards' && m === 'POST') return ok(call('card_create', { path: arg('path'), board: num(body.board), column: body.column, title: body.title, attrs: body.attrs, done: body.done, position: body.position, rev: body.rev }));
  const km = /^\/boards\/cards\/([^/]{1,80})(?:\/(move|done))?$/.exec(r);
  if (km) {
    const id = dec(km[1]); const path = arg('path');
    if (!km[2] && (m === 'PATCH' || m === 'PUT')) return ok(call('card_update', { path, id, title: body.title, column: body.column, done: body.done, attrs: body.attrs, position: body.position, rev: body.rev }));
    if (!km[2] && m === 'DELETE') return ok(call('card_delete', { path, id, rev: num(qs.get('rev')) }));
    if (km[2] === 'move' && m === 'POST') { if (body.column == null || body.column === '') throw new Fail(400, 'bad_column'); return ok(call('card_update', { path, id, column: body.column, position: body.position, rev: body.rev })); }
    if (km[2] === 'done' && m === 'POST') return ok(call('card_update', { path, id, done: body.done == null ? true : body.done, rev: body.rev }));
  }
  // Compartir: solo con un token que tenga ese permiso (lo comprueba callTool).
  if (r === '/shares' && m === 'GET') return ok(call('list_shares', { path: qs.get('path') || undefined }));
  if (r === '/shares' && m === 'POST') return ok({ message: call('share_note', { path: body.path, email: body.email, role: body.role }) });
  if (r === '/shares' && m === 'DELETE') return ok({ message: call('unshare_note', { path: qs.get('path'), email: qs.get('email') }) });
  if (r === '/links' && m === 'POST') return ok(call('create_public_link', { path: body.path, password: body.password }));
  if (r === '/links' && m === 'DELETE') return ok({ message: call('revoke_public_link', { id: num(qs.get('id')), path: qs.get('path') || undefined }) });
  throw new Fail(404, 'no_route');
}
// /api/v1 y /in no usan cookies ni la sesión de la app: se pueden llamar desde cualquier origen. Lo que abre la
// puerta es el token o el secreto de la dirección, que viajan en el pedido.
function autoCors(req, res) {
  const p = String(req.url || '');
  if (!p.startsWith('/api/v1/') && !p.startsWith('/in/')) return false;
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('access-control-expose-headers', 'retry-after');
  return true;
}
// ====================================================================================================================
// Fin de AUTOMATIZACIONES
// ====================================================================================================================

// ====================================================================================================================
// SITIOS PUBLICADOS ("Publicar"): una carpeta de notas servida como sitio web público
// ====================================================================================================================
// Dónde. El mismo servidor atiende un segundo nombre de host, el de PAGES_URL, y por ahí salen solo los sitios:
//   <PAGES_URL>/<slug>/            la portada del sitio
//   <PAGES_URL>/<slug>/<ruta>      cada página
// Quién es quién lo dice la cabecera Host. Por ese host no existe ninguna otra ruta del servidor (ni API, ni
// sesiones, ni MCP): no se leen credenciales y lo único que se escribe es una denuncia. Por el host de siempre no se
// sirve ningún sitio. Ese es el resguardo principal: aunque alguien lograra meter un script en su sitio, corre en un
// origen que no comparte nada con la app ni con este servidor. Sin PAGES_URL todo esto queda apagado.
// Qué se guarda. El HTML de cada página lo arma el navegador de quien publica (acá no hay con qué convertir
// Markdown). Llega solo el cuerpo de la nota y se vuelve a filtrar con una lista blanca escrita a mano (siteClean):
// sin script, style, iframe, object, form ni svg en línea, sin manejadores on*, sin javascript:, y data: solo en
// imágenes. Los diagramas viajan como imagen (data:image/svg+xml), así que la página no necesita estilos en línea.
// De cada página queda la ruta, el título, el cuerpo, el texto para el buscador y la revisión de la nota.
// Qué no se publica. Carpetas con contraseña, notas de la papelera (una página se sirve solo mientras su nota
// existe) y las notas con publish: false en su encabezado. Solo lo que está dentro de la carpeta elegida.
// Lo guardado de un sitio es público: con DATA_KEY queda sin cifrar en reposo. De la cuenta se guarda el número,
// nunca el correo.
const PAGES = (() => {
  const raw = String(env.PAGES_URL || '').trim().replace(/\/+$/, ''); if (!raw) return null;
  let u = null; try { u = new URL(raw); } catch (e) { fatal('PAGES_URL no es una dirección: ' + raw); }
  if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash || u.username || u.password) fatal('PAGES_URL es solo el origen del host de sitios, sin ruta: por ejemplo https://pages.example.com');
  let mine = ''; try { mine = new URL(PUBLIC_URL).host.toLowerCase(); } catch (e) { /* PUBLIC_URL mal escrita: no hay con qué comparar */ }
  if (u.host.toLowerCase() === mine) fatal('PAGES_URL tiene que ser otro nombre de host que PUBLIC_URL: los sitios publicados no comparten origen con la API');
  return { url: u.origin, host: u.host.toLowerCase(), port: u.protocol === 'https:' ? ':443' : ':80' };
})();
const PAGES_PER_ACCOUNT = Math.max(0, Math.floor(+(env.PAGES_PER_ACCOUNT == null || env.PAGES_PER_ACCOUNT === '' ? 1 : env.PAGES_PER_ACCOUNT)) || 0);
// Al bajar al plan gratis el sitio sigue este tiempo y después se despublica. PAGES_GRACE_MS es para las pruebas.
const PAGES_GRACE_MS = env.PAGES_GRACE_MS ? Math.max(0, +env.PAGES_GRACE_MS || 0) : Math.max(0, +(env.PAGES_GRACE_DAYS == null || env.PAGES_GRACE_DAYS === '' ? 7 : env.PAGES_GRACE_DAYS) || 0) * DAY;
const SITE_MAX_PAGES = Math.max(1, Math.floor(+(env.PAGES_MAX_PAGES || 300)) || 300); // páginas por sitio
const SITE_PAGE_MAX = 1536 * 1024; // caracteres del cuerpo de una página, con sus imágenes incrustadas
const SITE_TOTAL_MAX = Math.max(1, +(env.PAGES_MAX_MB || 40) || 40) * 1048576; // y de todo el sitio
const SITE_PUTS_HOUR = Math.max(1, Math.floor(+(env.PAGES_PUTS_HOUR || 1200)) || 1200); // páginas subidas por hora y por sitio
const SITE_PUBLISH_HOUR = 30; // publicaciones por hora y por sitio
const SITE_NEW_DAY = Math.max(1, Math.floor(+(env.PAGES_NEW_DAY || 3)) || 3); // sitios creados por día y por cuenta
const SITE_REPORTS_HOUR = 5; // denuncias por hora y por IP
const SITE_HITS_MINUTE = 900; // pedidos por minuto y por IP al host de sitios
const SITE_TEXT_MAX = 8000; // caracteres de cada página en el índice del buscador

db.exec("CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, made_by INTEGER, slug TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, conf TEXT NOT NULL DEFAULT '{}', live INTEGER NOT NULL DEFAULT 0, pkey TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', lapsed INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, reported INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, published INTEGER NOT NULL DEFAULT 0)");
db.exec('CREATE INDEX IF NOT EXISTS sites_owner ON sites (owner)');
db.exec('CREATE INDEX IF NOT EXISTS sites_pkey ON sites (pkey)');
db.exec("CREATE TABLE IF NOT EXISTS site_pages (site INTEGER NOT NULL, note TEXT NOT NULL, route TEXT NOT NULL, title TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', html TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', toc TEXT NOT NULL DEFAULT '[]', rev INTEGER NOT NULL, ord REAL, size INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (site, note))");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS site_pages_route ON site_pages (site, route)');

// ---------- La lista blanca ----------
// Lo que entra es HTML que mandó un navegador, o cualquier cosa que mande quien llame a la ruta a mano. No se
// "limpia" ese texto: se lo lee etiqueta por etiqueta y se escribe de nuevo, desde cero, solo con etiquetas y
// atributos de la lista y con todo el texto y los valores vueltos a escapar. Lo que el navegador reciba es
// exactamente lo que se validó acá.
const SAN_HTML = new Set('a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr'.split(' '));
const SAN_MATH = new Set('math semantics mrow mi mo mn ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose merror'.split(' '));
const SAN_VOID = new Set(['br', 'hr', 'img', 'wbr', 'col']);
// Se saltean con todo lo que traen adentro. Las primeras, además, llevan texto crudo: se busca su cierre a mano.
const SAN_RAW = new Set('script style textarea title xmp iframe noembed noframes noscript plaintext'.split(' '));
const SAN_SKIP = new Set('svg form object select button option optgroup template head applet audio video canvas map dialog slot portal annotation annotation-xml datalist frameset marquee picture'.split(' '));
const SAN_SKIP_VOID = new Set('input meta link base embed source track area frame keygen bgsound param'.split(' '));
const SAN_MATH_ATTR = new Set('mathvariant display displaystyle scriptlevel stretchy fence separator lspace rspace columnalign rowalign rowspacing columnspacing accent accentunder linethickness width height depth minsize maxsize movablelimits largeop symmetric form columnlines rowlines notation mathcolor mathbackground mathsize voffset columnspan rowspan'.split(' '));
const SAN_ID_ON = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'sup', 'a', 'section']);
const SAN_BLOCK = new Set('p div li h1 h2 h3 h4 h5 h6 td th tr br pre blockquote dt dd summary figcaption table section hr'.split(' '));
// Clases: las que arma el propio lector (lmd-), las del resaltado de código y las de las notas al pie. Las de la
// plantilla del sitio empiezan con sp- y no entran: el contenido no se puede disfrazar de menú ni de pie.
const SAN_CLASS = /^(hljs(-[A-Za-z0-9_-]{1,40})?|[a-z]{1,20}_|language-[\w+#-]{1,30}|lmd-[a-z0-9-]{1,40}|footnotes?[a-z-]{0,20}|task-list[a-z-]{0,20}|contains-task-list)$/;
const SAN_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', Tab: '\t', NewLine: '\n', sol: '/', bsol: '\\', lpar: '(', rpar: ')', num: '#', period: '.', comma: ',', semi: ';', equals: '=', quest: '?', excl: '!', commat: '@', lowbar: '_', hyphen: '-', dollar: '$', percnt: '%', plus: '+', ast: '*', grave: '`', lcub: '{', rcub: '}', lsqb: '[', rsqb: ']', verbar: '|' };
// El valor de un atributo como lo va a leer el navegador. Lo que no se sabe decodificar queda como texto, y como al
// escribir se escapa cada &, el navegador tampoco lo decodifica: no hay un "javascript&colon;" que pase de largo.
const sanDecode = (v) => String(v).replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, (m, hex, dec, name) => {
  if (name) return m.endsWith(';') && Object.prototype.hasOwnProperty.call(SAN_ENT, name) ? SAN_ENT[name] : m;
  const n = hex ? parseInt(hex, 16) : parseInt(dec, 10);
  return !n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '�' : String.fromCodePoint(n);
});
const sanAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sanUnattr = (v) => String(v).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sanText = (t) => t.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Un enlace: a una sección de la misma página (same), hacia afuera (out, solo http, https, mailto y tel) o relativo
// (rel: a otra nota del sitio, se resuelve al servir). Cualquier otro esquema no pasa.
function sanHref(raw) {
  const v = String(raw).trim();
  if (!v || v.length > 2000 || /[\u0000-\u001f\u007f\\]/.test(v)) return null;
  if (v[0] === '#') return { same: v };
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(v);
  if (m) {
    const s = m[1].toLowerCase();
    if (s === 'mailto' || s === 'tel') return { out: v };
    if (s !== 'http' && s !== 'https') return null;
    try { const u = new URL(v); return u.username || u.password ? null : { out: u.href }; } catch (e) { return null; }
  }
  if (v.startsWith('//')) { try { const u = new URL('https:' + v); return u.username || u.password ? null : { out: u.href }; } catch (e) { return null; } }
  return { rel: v };
}
// Una imagen: https, o incrustada como data: de un tipo de imagen. Un SVG incrustado se dibuja como imagen (ahí no
// corre nada), pero igual no pasa si trae un script, un manejador o un marco.
const SAN_IMG_DATA = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
function sanImg(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (/^https:\/\//i.test(v)) {
    if (v.length > 2000 || /[\u0000- \u007f\\"<>]/.test(v)) return null;
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch (e) { return null; }
  }
  const m = SAN_IMG_DATA.exec(v); if (!m) return null;
  if (m[1] === 'svg+xml') {
    const xml = Buffer.from(m[2], 'base64').toString('utf8');
    // [^<>]: cada búsqueda termina en la etiqueta siguiente, así una entrada llena de "<" no la vuelve lenta.
    if (/<\s*script|<[^<>]*\son[a-z]+\s*=|javascript\s*:|<\s*(iframe|object|embed)\b/i.test(xml)) return null;
  }
  return v;
}
// Una etiqueta de apertura desde s[i] ('<' y una letra): su nombre, sus atributos (el primero de cada nombre, como
// hace el navegador) y dónde termina. Sin su '>' no es una etiqueta: se descarta todo lo que sigue.
function sanTag(s, i) {
  const n = s.length; let j = i + 1;
  while (j < n && !/[\s/>]/.test(s[j])) j++;
  const name = s.slice(i + 1, j).toLowerCase(); const attrs = new Map(); let self = false;
  for (;;) {
    while (j < n && /[\s/]/.test(s[j])) { if (s[j] === '/') self = true; j++; }
    if (j >= n) return null;
    if (s[j] === '>') return { name, attrs, self, end: j + 1 };
    self = false;
    let k = j; if (s[k] === '=') k++;
    while (k < n && !/[\s/>=]/.test(s[k])) k++;
    const an = s.slice(j, k).toLowerCase(); j = k;
    while (j < n && /\s/.test(s[j])) j++;
    let val = '';
    if (s[j] === '=') {
      j++; while (j < n && /\s/.test(s[j])) j++;
      if (j >= n) return null;
      const quote = s[j];
      if (quote === '"' || quote === "'") { const e = s.indexOf(quote, j + 1); if (e === -1) return null; val = s.slice(j + 1, e); j = e + 1; }
      else { k = j; while (k < n && !/[\s>]/.test(s[k])) k++; val = s.slice(j, k); j = k; }
    }
    if (an && !attrs.has(an) && attrs.size < 40) attrs.set(an, sanDecode(val));
  }
}
// Los atributos que quedan de una etiqueta de la lista. De un enlace a otra nota queda data-n (la ruta relativa) o
// data-w (el nombre de un [[enlace]]), siempre primero: al servir se cambian por la dirección de la página.
function sanAttrs(name, a, math, ids) {
  let out = ''; let id = '';
  const put = (k, v) => { out += ' ' + k + '="' + sanAttr(v) + '"'; };
  if (math) { for (const [k, v] of a) if (SAN_MATH_ATTR.has(k) && /^[\w .%#+-]{0,40}$/.test(v)) put(k, v); return { out, id }; }
  if (name === 'a') {
    const wiki = a.get('data-wiki');
    if (wiki != null && wiki.trim() && wiki.length <= 300 && !/[\u0000-\u001f]/.test(wiki)) put('data-w', wiki.trim());
    else if (a.has('href')) {
      const r = sanHref(a.get('href'));
      if (r && r.same) put('href', r.same);
      else if (r && r.out) { put('href', r.out); put('rel', 'nofollow ugc noopener'); }
      else if (r && r.rel) put('data-n', r.rel);
    }
  }
  const cls = String(a.get('class') || '').split(/\s+/).filter((c) => SAN_CLASS.test(c)).slice(0, 12);
  // La alineación de una celda llega como estilo en línea: acá no hay estilos en línea, queda como clase.
  if (/^(td|th|p|div|h[1-6])$/.test(name)) {
    const al = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(a.get('style') || '') || /^(left|center|right)$/i.exec(a.get('align') || '');
    if (al) cls.push('sp-al-' + al[1].toLowerCase());
  }
  if (cls.length) put('class', cls.join(' '));
  if (SAN_ID_ON.has(name)) {
    const v = a.get('id');
    if (v && /^[\p{L}\p{N}_][\p{L}\p{N}_:.-]{0,119}$/u.test(v) && !/^sp-/i.test(v) && !ids.has(v)) { ids.add(v); id = v; put('id', v); }
  }
  if (a.has('title') && a.get('title').length <= 300) put('title', a.get('title'));
  if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(a.get('lang') || '')) put('lang', a.get('lang'));
  if (/^(ltr|rtl|auto)$/i.test(a.get('dir') || '')) put('dir', a.get('dir').toLowerCase());
  if (name === 'td' || name === 'th') for (const k of ['colspan', 'rowspan']) if (/^[1-9]\d?$/.test(a.get(k) || '')) put(k, a.get(k));
  if (name === 'ol' && /^-?\d{1,6}$/.test(a.get('start') || '')) put('start', a.get('start'));
  if (name === 'li' && /^-?\d{1,6}$/.test(a.get('value') || '')) put('value', a.get('value'));
  if ((name === 'col' || name === 'colgroup') && /^[1-9]\d?$/.test(a.get('span') || '')) put('span', a.get('span'));
  if (name === 'details' && a.has('open')) out += ' open';
  return { out, id };
}
// El slug de un título, igual al que arma la app para sus anclas.
const siteSlugify = (t) => String(t).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'seccion';
// Devuelve el cuerpo ya filtrado, su texto plano, sus títulos (para el índice y las anclas), el primer párrafo y
// cuántas imágenes quedaron afuera.
function siteClean(input) {
  const s = String(input == null ? '' : input).replace(/\u0000/g, ''); const low = s.toLowerCase(); const n = s.length;
  const out = []; const stack = []; const words = []; const toc = []; const ids = new Set();
  let i = 0; let heading = null; let para = null; let first = ''; let skipped = 0;
  const CLOSE = /<\/([A-Za-z][A-Za-z0-9:-]*)[^>]*>/y;
  const text = (t) => { if (!t) return; out.push(sanText(t)); const plain = sanDecode(t); words.push(plain); if (heading) heading.text += plain; if (para != null) para += plain; };
  const ended = (name) => {
    if (SAN_BLOCK.has(name)) words.push(' ');
    if (heading && name === heading.name) {
      const t = heading.text.replace(/\s+/g, ' ').trim().slice(0, 200); let id = heading.id;
      if (!id && t) { const base = siteSlugify(t); id = base; let k = 1; while (ids.has(id) || /^sp-/.test(id)) id = base + '-' + k++; ids.add(id); out[heading.at] = out[heading.at].replace(/>$/, ' id="' + sanAttr(id) + '">'); }
      if (id && t && toc.length < 400) toc.push({ id, t, l: +name[1] });
      heading = null;
    }
    if (para != null && name === 'p') { const t = para.replace(/\s+/g, ' ').trim(); if (t && !first) first = t.slice(0, 300); para = null; }
  };
  const closeTo = (at) => { while (stack.length > at) { const t = stack.pop(); out.push('</' + t + '>'); ended(t); } };
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { text(s.slice(i)); break; }
    if (lt > i) text(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e === -1 ? n : e + 3; continue; }
    const c = s[i + 1];
    if (c === '!' || c === '?') { const e = s.indexOf('>', i); i = e === -1 ? n : e + 1; continue; }
    if (c === '/') {
      CLOSE.lastIndex = i; const m = CLOSE.exec(s);
      if (!m) { const e = s.indexOf('>', i); i = e === -1 ? n : e + 1; continue; }
      i += m[0].length; const at = stack.lastIndexOf(m[1].toLowerCase()); if (at !== -1) closeTo(at);
      continue;
    }
    if (!c || !/[A-Za-z]/.test(c)) { text('<'); i++; continue; }
    const tag = sanTag(s, i); if (!tag) break;
    i = tag.end; const name = tag.name;
    if (SAN_RAW.has(name)) { const e = low.indexOf('</' + name, i); const g = e === -1 ? -1 : s.indexOf('>', e); i = g === -1 ? n : g + 1; continue; }
    if (SAN_SKIP.has(name)) {
      if (tag.self) continue;
      // Hasta su cierre, contando las que se abren adentro. Cada posición se busca una vez: no se vuelve a recorrer lo ya visto.
      const open = '<' + name; const close = '</' + name;
      let depth = 1; let e = low.indexOf(close, i); let o = low.indexOf(open, i);
      while (depth && e !== -1) {
        if (o !== -1 && o < e) { depth++; i = o + open.length; o = low.indexOf(open, i); }
        else { depth--; const g = s.indexOf('>', e); i = g === -1 ? n : g + 1; if (depth) e = low.indexOf(close, i); if (o !== -1 && o < i) o = low.indexOf(open, i); }
      }
      if (depth) i = n;
      continue;
    }
    if (SAN_SKIP_VOID.has(name)) {
      // La casilla de una tarea: queda dibujada, sin ser un control.
      if (name === 'input' && String(tag.attrs.get('type') || '').toLowerCase() === 'checkbox') out.push('<span class="sp-check' + (tag.attrs.has('checked') ? ' sp-on' : '') + '"></span>');
      continue;
    }
    const math = SAN_MATH.has(name);
    if (!SAN_HTML.has(name) && !math) continue; // una etiqueta que no está en la lista: queda su texto, sin ella
    if (name === 'img') {
      const src = sanImg(tag.attrs.get('src')); const alt = String(tag.attrs.get('alt') || '').slice(0, 300);
      // Una imagen que no es https ni viene incrustada (una ruta del disco de quien escribió) no existe acá: queda su texto.
      if (!src) { skipped++; if (alt.trim()) { out.push('<span class="sp-noimg">' + sanAttr(alt) + '</span>'); words.push(' ' + alt + ' '); } continue; }
      let extra = '';
      for (const k of ['width', 'height']) if (/^[1-9]\d{0,3}$/.test(tag.attrs.get(k) || '')) extra += ' ' + k + '="' + tag.attrs.get(k) + '"';
      if (tag.attrs.has('title') && tag.attrs.get('title').length <= 300) extra += ' title="' + sanAttr(tag.attrs.get('title')) + '"';
      out.push('<img src="' + sanAttr(src) + '" alt="' + sanAttr(alt) + '"' + extra + ' loading="lazy" decoding="async">');
      continue;
    }
    if (stack.length >= 120 && !SAN_VOID.has(name)) continue;
    const at = sanAttrs(name, tag.attrs, math, ids);
    if (SAN_BLOCK.has(name)) words.push(' ');
    out.push('<' + name + at.out + '>');
    if (SAN_VOID.has(name)) continue;
    if (math && tag.self) { out.push('</' + name + '>'); continue; }
    stack.push(name);
    if (/^h[1-6]$/.test(name) && !heading) heading = { name, id: at.id, text: '', at: out.length - 1 };
    if (name === 'p' && !first && para == null && stack.length === 1) para = '';
  }
  closeTo(0);
  return { html: out.join(''), text: words.join('').replace(/\s+/g, ' ').trim(), toc, first, skipped };
}

// ---------- Qué entra en un sitio ----------
const SITE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// Nombres que no puede tener un sitio: se confundirían con algo del servicio.
const SITE_RESERVED = new Set('www api app apps admin administrator mail email static assets asset sharpmd sharp-md support help about blog docs doc status login signin signup sign-in sign-up logout account accounts billing pay payment pricing plans legal privacy terms tos security abuse report reports robots sitemap favicon search public pages page site sites null undefined test demo example root system official team teams dashboard settings mcp auth oauth health feed rss new edit cdn img images js css fonts download downloads store home index news press contact careers jobs'.split(' '));
const SITE_ACCENTS = { '': '', '#3b82f6': 'blue', '#6c7ee1': 'indigo', '#a855f7': 'violet', '#ec4899': 'pink', '#ef4444': 'red', '#f97316': 'orange', '#eab308': 'amber', '#14b8a6': 'teal' };
const SITE_FONTS = { '': '', System: 'system', Arial: 'arial', Calibri: 'calibri', Verdana: 'verdana', 'Trebuchet MS': 'trebuchet', Georgia: 'georgia', Cambria: 'cambria', Palatino: 'palatino', 'Times New Roman': 'times', Consolas: 'consolas', 'Courier New': 'courier' };
const SITE_MD = /\.(md|mdx|mkd|mdown|markdown|txt)$/i;
const siteNoteOk = (p) => { const base = p.slice(p.lastIndexOf('/') + 1); return SITE_MD.test(base) || !base.includes('.'); };
const siteWikiKey = (v) => String(v).toLowerCase().replace(/\.(md|mdx|mkd|mdown|markdown)$/i, '').replace(/[\s_-]+/g, '');
// Un tramo de la dirección de una página: minúsculas, números y guiones. Un nombre que no deja nada, una huella.
const siteSeg = (t) => { const v = String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''); return v || 'p-' + sha(String(t)).slice(0, 8); };
const siteLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const siteConfOf = (site) => { let c = {}; try { c = JSON.parse(site.conf || '{}') || {}; } catch (e) { c = {}; } return Object.assign({ title: '', descr: '', home: '', lang: 'en', accent: '', font: '', logo: '', author: '', noindex: false, auto: false }, c); };
// publish: false en el encabezado de la nota la deja afuera del sitio.
const siteExcluded = (text) => { const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(String(text || '')); return !!m && /^publish:[ \t]*["']?(false|no|off|0)["']?[ \t]*$/mi.test(m[1]); };
// Una carpeta con contraseña que cubre la del sitio (o el espacio del equipo protegido): de ahí no se publica nada.
const siteVaulted = (ownerId, folder) => vaultsOf(ownerId).some((v) => !v.folder || v.folder === folder || inside(folder, v.folder));
const siteFolderNotes = (site) => { const vs = vaultsOf(site.owner); return q('SELECT path, rev, v FROM notes WHERE user = ? AND substr(path, 1, length(?)) = ?').all(site.owner, site.folder + '/', site.folder + '/').filter((x) => !x.v && siteNoteOk(x.path) && !vs.some((v) => inside(x.path, v.folder))); };
// La nota que hace de portada: la elegida, o la que se llama index, readme, home o inicio en la raíz de la carpeta.
function siteHome(site, conf) {
  if (conf.home && q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(site.owner, conf.home)) return conf.home;
  const names = new Map(q('SELECT path FROM notes WHERE user = ? AND substr(path, 1, length(?)) = ?').all(site.owner, site.folder + '/', site.folder + '/').map((x) => x.path.slice(site.folder.length + 1)).filter((r) => !r.includes('/')).map((r) => [r.replace(SITE_MD, '').toLowerCase(), r]));
  for (const k of ['index', 'readme', 'home', 'inicio']) if (names.has(k)) return site.folder + '/' + names.get(k);
  return '';
}
const siteRouteOf = (site, home, note) => (note === home ? '' : note.slice(site.folder.length + 1).replace(SITE_MD, '').split('/').map(siteSeg).join('/'));
// Las direcciones de todas las páginas, de nuevo: cambió la portada, o se quitaron páginas. Dos notas que darían la
// misma dirección se distinguen con un número.
function siteReroute(site) {
  const conf = siteConfOf(site); const home = siteHome(site, conf); const used = new Set();
  const rows = q('SELECT note, route FROM site_pages WHERE site = ? ORDER BY note').all(site.id);
  const next = rows.map((r) => { const base = siteRouteOf(site, home, r.note); let route = base; let k = 2; while (used.has(route)) route = (base || 'index') + '-' + k++; used.add(route); return { note: r.note, route, was: r.route }; });
  if (!next.some((r) => r.route !== r.was)) return;
  q("UPDATE site_pages SET route = '~' || note WHERE site = ?").run(site.id);
  for (const r of next) q('UPDATE site_pages SET route = ? WHERE site = ? AND note = ?').run(r.route, site.id, r.note);
}
const siteTouch = (site) => { site.updated = now(); q('UPDATE sites SET updated = ? WHERE id = ?').run(site.updated, site.id); };
// Baja todo lo servido de un sitio. La configuración queda.
function siteTakeDown(site) {
  q('DELETE FROM site_pages WHERE site = ?').run(site.id);
  q('UPDATE sites SET live = 0, updated = ? WHERE id = ?').run(now(), site.id); site.live = 0;
}
// El plan de quien tiene las notas. Al bajar a gratis empieza a correr el margen; al volver al plan pago se
// olvida. Vencido el margen, el sitio se despublica y queda su configuración.
function siteLapse(site, owner) {
  const paid = !!owner && owner.plan === 'pro';
  if (paid && site.lapsed) { q('UPDATE sites SET lapsed = 0 WHERE id = ?').run(site.id); site.lapsed = 0; }
  if (!paid && !site.lapsed) { site.lapsed = now(); q('UPDATE sites SET lapsed = ? WHERE id = ?').run(site.lapsed, site.id); }
  const has = () => site.live || q('SELECT 1 FROM site_pages WHERE site = ? LIMIT 1').get(site.id);
  if (!paid && site.lapsed && now() - site.lapsed >= PAGES_GRACE_MS && has()) siteTakeDown(site);
  // La carpeta pasó a tener contraseña: lo que estaba publicado de ella se borra, como sus enlaces públicos.
  else if (siteVaulted(site.owner, site.folder) && has()) siteTakeDown(site);
  return site;
}
function sitesSweep() {
  // Lo publicado de una nota que ya no existe (se eliminó o cambió de nombre) no se servía más: acá se borra.
  q('DELETE FROM site_pages WHERE NOT EXISTS (SELECT 1 FROM sites s JOIN notes n ON n.user = s.owner AND n.path = site_pages.note WHERE s.id = site_pages.site)').run();
  for (const s of q('SELECT * FROM sites').all()) { try { siteLapse(s, userById(s.owner)); } catch (e) { console.error('sitios: no se pudo revisar el plan · ' + String(e && e.message || e).slice(0, 200)); } } }
if (PAGES) setInterval(sitesSweep, Math.min(600000, Math.max(1000, PAGES_GRACE_MS / 4 || 600000))).unref();

// Lo que cambió desde la última publicación: notas con otra revisión, notas nuevas en la carpeta y páginas cuya
// nota ya no está, salió de la carpeta o pasó a publish: false. De cada una va la ruta, nunca el texto.
function sitePending(site) {
  const notes = siteFolderNotes(site); const at = new Map(notes.map((x) => [x.path, x.rev]));
  const pages = new Map(q('SELECT note, rev FROM site_pages WHERE site = ?').all(site.id).map((x) => [x.note, x.rev]));
  const textOf = (p) => { const r = q('SELECT text, e FROM notes WHERE user = ? AND path = ?').get(site.owner, p); return r ? unseal(r.text, r.e, 'notes.text') : ''; };
  const changed = []; const added = []; const removed = [];
  for (const x of notes) {
    if (pages.has(x.path)) { if (pages.get(x.path) !== x.rev) { if (siteExcluded(textOf(x.path))) removed.push(x.path); else changed.push(x.path); } }
    else if (!siteExcluded(textOf(x.path))) added.push(x.path);
  }
  for (const p of pages.keys()) if (!at.has(p)) removed.push(p);
  return { changed, added, removed };
}
// Un sitio como lo ve quien lo maneja. full suma lo que falta publicar.
function siteView(site, user, full) {
  const c = siteConfOf(site); const team = site.owner !== user.id;
  const n = q('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM site_pages WHERE site = ?').get(site.id);
  const out = { id: site.id, o: team ? site.owner : 0, team, slug: site.slug, folder: site.folder, url: PAGES.url + '/' + site.slug + '/', preview: PAGES.url + '/~' + site.pkey + '/',
    title: c.title, descr: c.descr, home: c.home, lang: c.lang, accent: c.accent, font: c.font, logo: c.logo, author: c.author, noindex: !!c.noindex, auto: !!c.auto,
    live: !!site.live, suspended: !!site.suspended, reason: site.suspended ? site.reason : '', lapsed: site.lapsed || 0, ends: site.lapsed ? site.lapsed + PAGES_GRACE_MS : 0,
    published: site.published || 0, pages: n.n, size: n.size, can: !team || (teamAllows(user.team, user, 'publish') && teamAllows(user.team, user, 'write')) };
  if (full) out.pending = sitePending(site);
  return out;
}
// Los sitios que alcanza una cuenta: los suyos y los del espacio de su equipo.
function sitesOf(user) {
  const rows = q('SELECT * FROM sites WHERE owner = ? OR owner = ? ORDER BY id').all(user.id, user.team ? user.team.space : user.id);
  return rows.map((s) => siteLapse(s, s.owner === user.id ? user : userById(s.owner)));
}
// Va en GET /account: si el servidor publica sitios, cuántos entran y los que hay. La app lee de acá si el sitio
// está suspendido o por despublicarse, sin pedir nada más.
function pagesView(user) {
  if (!PAGES) return { enabled: false };
  const t = user.team && user.team.status === 'active' ? user.team : null;
  return { enabled: true, url: PAGES.url, max: PAGES_PER_ACCOUNT, paid: user.plan === 'pro', grace_days: Math.round(PAGES_GRACE_MS / DAY), max_pages: SITE_MAX_PAGES,
    team: !!t && !teamVault(t) && teamAllows(t, user, 'publish') && teamAllows(t, user, 'write'), sites: sitesOf(user).map((s) => siteView(s, user, false)) };
}
// De quién son las notas que se publican: de la cuenta, o del espacio de su equipo si el papel y la política
// "publish" lo permiten. Quien administra el equipo puede siempre; quien solo lee, nunca.
function siteOwner(user, o) {
  if (o == null || o === '' || o === 0 || +o === user.id) return { owner: user, team: null };
  const t = user.team;
  if (!t || +o !== t.space) throw new Fail(403, 'no_access');
  if (!teamAllows(t, user, 'write')) throw new Fail(403, 'read_only');
  if (!teamAllows(t, user, 'publish')) throw new Fail(403, 'team_policy', 'The administrator of the team has not allowed members to publish sites');
  if (teamVault(t)) throw new Fail(409, 'vault', 'A team space protected with a password cannot be published');
  return { owner: userById(t.space), team: t };
}
function siteFor(user, id, need) {
  const site = q('SELECT * FROM sites WHERE id = ?').get(+id);
  if (!site) throw new Fail(404, 'not_found');
  if (site.owner === user.id) return { site: siteLapse(site, user), owner: user, team: null };
  const t = user.team;
  if (!t || site.owner !== t.space) throw new Fail(404, 'not_found');
  if (need !== 'see') { if (!teamAllows(t, user, 'write')) throw new Fail(403, 'read_only'); if (!teamAllows(t, user, 'publish')) throw new Fail(403, 'team_policy', 'The administrator of the team has not allowed members to publish sites'); }
  const owner = userById(t.space);
  return { site: siteLapse(site, owner), owner, team: t };
}
const siteNeedsPlan = (owner) => { if (!owner || owner.plan !== 'pro') throw new Fail(402, 'site_needs_plan', 'Publishing a site is part of the paid plan'); };
const siteNotHeld = (site) => { if (site.suspended) throw new Fail(403, 'site_suspended', 'This site was suspended'); };
function siteSlug(v, mine) {
  const slug = String(v == null ? '' : v).trim().toLowerCase();
  if (!SITE_SLUG.test(slug)) throw new Fail(400, 'bad_slug', 'The address takes lowercase letters, numbers and hyphens, 3 to 40');
  if (SITE_RESERVED.has(slug)) throw new Fail(409, 'slug_reserved');
  const row = q('SELECT id FROM sites WHERE slug = ?').get(slug);
  if (row && row.id !== mine) throw new Fail(409, 'slug_taken');
  return slug;
}
// La configuración: cada dato contra su lista o su largo. Nada de acá llega a la página como CSS ni como HTML.
function siteConfClean(b, prev, site, owner) {
  const c = Object.assign({}, prev);
  if (b.title !== undefined) { c.title = siteLine(b.title, 80); if (!c.title) throw new Fail(400, 'bad_title'); }
  if (b.descr !== undefined) c.descr = siteLine(b.descr, 200);
  if (b.logo !== undefined) c.logo = siteLine(b.logo, 30);
  if (b.author !== undefined) { c.author = siteLine(b.author, 60); if (c.author.includes('@')) throw new Fail(400, 'bad_author', 'The author name cannot be an email address'); }
  if (b.lang !== undefined) { if (b.lang !== 'en' && b.lang !== 'es') throw new Fail(400, 'bad_lang'); c.lang = b.lang; }
  if (b.accent !== undefined) { const v = String(b.accent || '').toLowerCase(); if (!Object.prototype.hasOwnProperty.call(SITE_ACCENTS, v)) throw new Fail(400, 'bad_theme'); c.accent = v; }
  if (b.font !== undefined) { const v = String(b.font || ''); if (!Object.prototype.hasOwnProperty.call(SITE_FONTS, v)) throw new Fail(400, 'bad_theme'); c.font = v; }
  if (b.noindex !== undefined) { if (typeof b.noindex !== 'boolean') throw new Fail(400, 'bad_value'); c.noindex = b.noindex; }
  if (b.auto !== undefined) { if (typeof b.auto !== 'boolean') throw new Fail(400, 'bad_value'); c.auto = b.auto; }
  if (b.home !== undefined) {
    const h = String(b.home || '').trim() ? cleanPath(b.home) : '';
    if (h && (!inside(h, site.folder) || !siteNoteOk(h) || !q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(owner.id, h))) throw new Fail(400, 'bad_home');
    c.home = h;
  }
  if (!c.title) throw new Fail(400, 'bad_title');
  return c;
}
function siteCreate(user, b) {
  const { owner, team } = siteOwner(user, b.o);
  siteNeedsPlan(owner);
  if (q('SELECT COUNT(*) AS n FROM sites WHERE owner = ?').get(owner.id).n >= PAGES_PER_ACCOUNT) throw new Fail(409, 'site_limit', 'This plan includes ' + PAGES_PER_ACCOUNT + ' published site' + (PAGES_PER_ACCOUNT === 1 ? '' : 's'));
  const folder = cleanPath(String(b.folder == null ? '' : b.folder).replace(/\/+$/, ''));
  if (siteVaulted(owner.id, folder)) throw new Fail(409, 'vault', 'A folder protected with a password cannot be published');
  const site = { id: 0, owner: owner.id, folder, slug: '', conf: '{}' };
  if (!siteFolderNotes(site).length) throw new Fail(404, 'no_notes', 'That folder has no notes to publish');
  const slug = siteSlug(b.slug, 0);
  const conf = siteConfClean(b, siteConfOf(site), site, owner);
  limit('site:new:' + user.id, SITE_NEW_DAY, DAY, 'too_many'); mark('site:new:' + user.id);
  const id = Number(q('INSERT INTO sites (owner, made_by, slug, folder, conf, live, pkey, created, updated) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)').run(owner.id, user.id, slug, folder, JSON.stringify(conf), random(18), now(), now()).lastInsertRowid);
  if (team) teamLog(team, user, 'site', folder, slug);
  return siteView(q('SELECT * FROM sites WHERE id = ?').get(id), user, true);
}
// Sube páginas ya dibujadas. De cada una se comprueba la nota: que exista, que esté en la carpeta del sitio, que no
// esté cifrada ni excluida, y que la revisión que dice quien publica no sea de más adelante que la que hay.
function sitePut(user, x, b) {
  const { site, owner } = x;
  siteNeedsPlan(owner); siteNotHeld(site);
  if (siteVaulted(owner.id, site.folder)) throw new Fail(409, 'vault', 'A folder protected with a password cannot be published');
  const list = Array.isArray(b.pages) ? b.pages : null;
  if (!list || !list.length || list.length > 20) throw new Fail(400, 'bad_pages');
  const conf = siteConfOf(site); const home = siteHome(site, conf); const done = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') throw new Fail(400, 'bad_pages');
    limit('site:put:' + site.id, SITE_PUTS_HOUR, HOUR, 'too_many'); mark('site:put:' + site.id);
    const note = cleanPath(p.note);
    if (!inside(note, site.folder) || !siteNoteOk(note)) throw new Fail(400, 'bad_note', 'That note is not inside the folder of the site');
    const row = q('SELECT text, e, v, rev FROM notes WHERE user = ? AND path = ?').get(owner.id, note);
    if (!row) throw new Fail(404, 'not_found');
    if (row.v || vaultOf(owner.id, note)) throw new Fail(409, 'vault', 'A note protected with a password cannot be published');
    if (siteExcluded(unseal(row.text, row.e, 'notes.text'))) { q('DELETE FROM site_pages WHERE site = ? AND note = ?').run(site.id, note); done.push({ note, excluded: true }); continue; }
    const rev = cleanRev(p.rev);
    if (rev == null || rev > row.rev) throw new Fail(400, 'bad_rev');
    if (typeof p.html !== 'string') throw new Fail(400, 'bad_pages');
    if (p.html.length > SITE_PAGE_MAX) throw new Fail(413, 'too_large', 'That page is too big to publish');
    const clean = siteClean(p.html);
    const had = q('SELECT size FROM site_pages WHERE site = ? AND note = ?').get(site.id, note);
    const tot = q('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM site_pages WHERE site = ?').get(site.id);
    if (!had && tot.n >= SITE_MAX_PAGES) throw new Fail(409, 'site_full', 'A site holds up to ' + SITE_MAX_PAGES + ' pages');
    if (tot.size - (had ? had.size : 0) + clean.html.length > SITE_TOTAL_MAX) throw new Fail(413, 'site_too_big', 'The site is over its size limit');
    const h1 = clean.toc.find((h) => h.l === 1);
    const title = siteLine(p.title, 120) || (h1 && h1.t.slice(0, 120)) || note.slice(note.lastIndexOf('/') + 1).replace(SITE_MD, '');
    const descr = siteLine(p.descr, 300) || clean.first.slice(0, 200);
    const ord = typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : null;
    let route = siteRouteOf(site, home, note); const base = route; let k = 2;
    while (q('SELECT 1 FROM site_pages WHERE site = ? AND route = ? AND note != ?').get(site.id, route, note)) route = (base || 'index') + '-' + k++;
    q('INSERT INTO site_pages (site, note, route, title, descr, html, text, toc, rev, ord, size, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (site, note) DO UPDATE SET route = excluded.route, title = excluded.title, descr = excluded.descr, html = excluded.html, text = excluded.text, toc = excluded.toc, rev = excluded.rev, ord = excluded.ord, size = excluded.size, at = excluded.at')
      .run(site.id, note, route, title, descr, clean.html, clean.text.slice(0, SITE_TEXT_MAX), JSON.stringify(p.toc === false ? clean.toc.map((h) => Object.assign({ x: 1 }, h)) : clean.toc), rev, ord, clean.html.length, now());
    done.push({ note, route, images_skipped: clean.skipped });
  }
  siteTouch(site);
  return { ok: true, pages: done };
}
// Publicar: se quitan las páginas cuya nota ya no corresponde, se reparten las direcciones y el sitio queda a la vista.
function sitePublish(user, x) {
  const { site, owner, team } = x;
  siteNeedsPlan(owner); siteNotHeld(site);
  if (siteVaulted(owner.id, site.folder)) throw new Fail(409, 'vault', 'A folder protected with a password cannot be published');
  limit('site:pub:' + site.id, SITE_PUBLISH_HOUR, HOUR, 'too_many'); mark('site:pub:' + site.id);
  const keep = new Set(siteFolderNotes(site).map((n) => n.path));
  for (const p of q('SELECT note FROM site_pages WHERE site = ?').all(site.id)) {
    const row = keep.has(p.note) ? q('SELECT text, e FROM notes WHERE user = ? AND path = ?').get(owner.id, p.note) : null;
    if (!row || siteExcluded(unseal(row.text, row.e, 'notes.text'))) q('DELETE FROM site_pages WHERE site = ? AND note = ?').run(site.id, p.note);
  }
  if (!q('SELECT 1 FROM site_pages WHERE site = ? LIMIT 1').get(site.id)) throw new Fail(409, 'site_empty', 'There are no pages to publish yet');
  siteReroute(site);
  const first = !site.live;
  q('UPDATE sites SET live = 1, published = ?, updated = ? WHERE id = ?').run(now(), now(), site.id);
  if (team) teamLog(team, user, 'publish', site.folder, site.slug + (first ? '' : ' (update)'));
  return siteView(q('SELECT * FROM sites WHERE id = ?').get(site.id), user, true);
}
function sitesRoute(req, user, p, m, url) {
  if (!PAGES) throw new Fail(404, 'no_route');
  const body = () => readBody(req);
  if (p === '/sites' && m === 'GET') return { enabled: true, url: PAGES.url, max: PAGES_PER_ACCOUNT, max_pages: SITE_MAX_PAGES, grace_days: Math.round(PAGES_GRACE_MS / DAY), sites: sitesOf(user).map((s) => siteView(s, user, true)) };
  if (p === '/sites/slug' && m === 'GET') { limit('site:slug:' + user.id, 300, HOUR, 'too_many'); mark('site:slug:' + user.id); try { return { ok: true, slug: siteSlug(url.searchParams.get('slug'), +(url.searchParams.get('id') || 0)) }; } catch (e) { if (e instanceof Fail) return { ok: false, why: e.code }; throw e; } }
  if (p === '/sites' && m === 'POST') return body().then((b) => siteCreate(user, b));
  const sm = /^\/sites\/(\d{1,12})(?:\/(pages|publish|unpublish))?$/.exec(p);
  if (!sm) throw new Fail(404, 'no_route');
  if (!sm[2] && m === 'GET') return siteView(siteFor(user, sm[1], 'see').site, user, true);
  const x = siteFor(user, sm[1], 'manage');
  if (!sm[2] && m === 'PUT') return body().then((b) => {
    const prev = siteConfOf(x.site); const conf = siteConfClean(b, prev, x.site, x.owner);
    let slug = x.site.slug;
    if (b.slug !== undefined && String(b.slug).trim().toLowerCase() !== slug) { siteNotHeld(x.site); slug = siteSlug(b.slug, x.site.id); }
    q('UPDATE sites SET conf = ?, slug = ?, updated = ? WHERE id = ?').run(JSON.stringify(conf), slug, now(), x.site.id);
    const site = q('SELECT * FROM sites WHERE id = ?').get(x.site.id);
    if (conf.home !== prev.home) siteReroute(site);
    return siteView(site, user, true);
  });
  if (!sm[2] && m === 'DELETE') {
    // Un sitio suspendido no se elimina desde la app: volver a crearlo con la misma dirección sería saltarse la suspensión.
    siteNotHeld(x.site);
    q('DELETE FROM site_pages WHERE site = ?').run(x.site.id); q('DELETE FROM sites WHERE id = ?').run(x.site.id);
    if (x.team) teamLog(x.team, user, 'unpublish', x.site.folder, x.site.slug);
    return { ok: true };
  }
  if (sm[2] === 'pages' && m === 'PUT') return body().then((b) => sitePut(user, x, b));
  if (sm[2] === 'publish' && m === 'POST') return sitePublish(user, x);
  if (sm[2] === 'unpublish' && m === 'POST') {
    const was = x.site.live; siteTakeDown(x.site);
    if (x.team && was) teamLog(x.team, user, 'unpublish', x.site.folder, x.site.slug);
    return siteView(q('SELECT * FROM sites WHERE id = ?').get(x.site.id), user, true);
  }
  throw new Fail(404, 'no_route');
}
// Administración, con ADMIN_KEY: ver los sitios, suspender uno (deja de servirse en el acto, con 451), volver a
// ponerlo y eliminarlo. Acá sí se ve el correo de la cuenta: es para quien opera el servidor.
function sitesAdmin(m, url, b) {
  if (!PAGES) throw new Fail(404, 'no_route');
  const row = (s) => { const u = q('SELECT email FROM users WHERE id = ?').get(s.owner); const t = q('SELECT t.name, u.email FROM teams t JOIN users u ON u.id = t.owner WHERE t.space = ?').get(s.owner); const n = q('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM site_pages WHERE site = ?').get(s.id); const c = siteConfOf(s);
    return { id: s.id, slug: s.slug, url: PAGES.url + '/' + s.slug + '/', account: t ? t.email : u ? u.email : '', team: t ? (t.name || 'Team') : '', folder: s.folder, title: c.title, live: !!s.live, suspended: !!s.suspended, reason: s.reason, lapsed: s.lapsed, pages: n.n, size: n.size, reports: s.reports, reported: s.reported, created: s.created, published: s.published }; };
  if (m === 'GET') {
    const st = url.searchParams.get('status') || ''; const find = String(url.searchParams.get('q') || '').toLowerCase().slice(0, 80);
    let rows = q('SELECT * FROM sites ORDER BY reported DESC, id DESC LIMIT 2000').all();
    if (st === 'live') rows = rows.filter((s) => s.live && !s.suspended); else if (st === 'suspended') rows = rows.filter((s) => s.suspended); else if (st === 'reported') rows = rows.filter((s) => s.reports > 0);
    const out = rows.map(row).filter((r) => !find || r.slug.includes(find) || r.account.toLowerCase().includes(find) || r.title.toLowerCase().includes(find));
    return { sites: out.slice(0, 500), total: out.length };
  }
  if (m !== 'POST') throw new Fail(405, 'method_not_allowed');
  const s = b.id != null ? q('SELECT * FROM sites WHERE id = ?').get(+b.id) : q('SELECT * FROM sites WHERE slug = ?').get(String(b.slug || '').toLowerCase());
  if (!s) throw new Fail(404, 'not_found');
  if (b.action === 'suspend') q('UPDATE sites SET suspended = ?, reason = ?, updated = ? WHERE id = ?').run(now(), siteLine(b.reason, 300), now(), s.id);
  else if (b.action === 'restore') q("UPDATE sites SET suspended = 0, reason = '', updated = ? WHERE id = ?").run(now(), s.id);
  else if (b.action === 'delete') { q('DELETE FROM site_pages WHERE site = ?').run(s.id); q('DELETE FROM sites WHERE id = ?').run(s.id); return { ok: true, deleted: s.slug }; }
  else throw new Fail(400, 'bad_action');
  console.log('sitios: ' + b.action + ' · ' + s.slug);
  return { ok: true, site: row(q('SELECT * FROM sites WHERE id = ?').get(s.id)) };
}

// ---------- Lo que se sirve ----------
const SITE_STR = {
  en: { search: 'Search', menu: 'Menu', pages: 'Pages', toc: 'On this page', prev: 'Previous', next: 'Next', made: 'Published with SharpMD', report: 'Report', skip: 'Skip to content', theme: 'Light or dark', none: 'No results',
    by: 'By {a}', updated: 'Updated {a}', preview: 'Preview. Only people with this link see it.', gone_t: 'Not published', gone: 'This site is no longer published.', missing_t: 'Page not found', missing: 'This page does not exist.',
    back: 'Go to the start of the site', held_t: 'Not available', held: 'This site is not available.', r_title: 'Report this site', r_lead: 'Tell us if this site has something that should not be here. We get the address of the page and what you write.',
    r_why: 'Reason', r_mail: 'Your email (optional)', r_send: 'Send report', r_ok: 'Sent. Thank you.', r_fail: 'It could not be sent. Try again later.', r_many: 'Too many reports from here for now. Try again later.',
    r_short: 'Write a few words about the reason.', r_js: 'This form needs JavaScript. You can also write from sharpmd.app/support.html.', r_back: 'Back to the site', root_t: 'Sites published with SharpMD', root: 'This address hosts sites that people publish from their notes with SharpMD.', what: 'What is SharpMD' },
  es: { search: 'Buscar', menu: 'Menú', pages: 'Páginas', toc: 'En esta página', prev: 'Anterior', next: 'Siguiente', made: 'Publicado con SharpMD', report: 'Denunciar', skip: 'Ir al contenido', theme: 'Claro u oscuro', none: 'Sin resultados',
    by: 'Por {a}', updated: 'Actualizado {a}', preview: 'Vista previa. Solo la ve quien tiene este enlace.', gone_t: 'Sin publicar', gone: 'Este sitio ya no está publicado.', missing_t: 'No existe esa página', missing: 'Esta página no existe.',
    back: 'Ir al inicio del sitio', held_t: 'No disponible', held: 'Este sitio no está disponible.', r_title: 'Denunciar este sitio', r_lead: 'Avisanos si este sitio tiene algo que no debería estar acá. Nos llega la dirección de la página y lo que escribas.',
    r_why: 'Motivo', r_mail: 'Tu correo (opcional)', r_send: 'Enviar denuncia', r_ok: 'Enviado. Gracias.', r_fail: 'No se pudo enviar. Probá más tarde.', r_many: 'Llegaste al tope de denuncias por ahora. Probá más tarde.',
    r_short: 'Escribí en pocas palabras el motivo.', r_js: 'Este formulario necesita JavaScript. También podés escribir desde sharpmd.app/support.html.', r_back: 'Volver al sitio', root_t: 'Sitios publicados con SharpMD', root: 'En esta dirección están los sitios que la gente publica desde sus notas con SharpMD.', what: 'Qué es SharpMD' },
};
const SITE_DARK = '--bg:#121418;--panel:#1a1d23;--ink:#e6e8ec;--soft:#a0a7b4;--faint:#7b8290;--line:#2a2e37;--ac0:#bef264;--mix:#fff;--code:#1d2027;--card:#f6f5f1;--k:#f0a8d0;--s:#b5e48c;--n:#f6c177;--t:#8cc8ff;color-scheme:dark';
const SITE_CSS = String.raw`
:root{--bg:#fbfaf7;--panel:#f4f2ec;--ink:#1d2026;--soft:#5c6370;--faint:#8a909c;--line:#dedbd2;--ac0:#4d7c0f;--mix:#000;--code:#f1efe9;--card:transparent;--k:#a8327e;--s:#3f6b0c;--n:#a35a00;--t:#1f5fb0;--ac:var(--ac0);--link:color-mix(in srgb,var(--ac) 76%,var(--mix));--font:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;--mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){DARK}}
:root[data-theme=dark]{DARK}
:root[data-accent=blue]{--ac:#3b82f6}:root[data-accent=indigo]{--ac:#6c7ee1}:root[data-accent=violet]{--ac:#a855f7}:root[data-accent=pink]{--ac:#ec4899}:root[data-accent=red]{--ac:#ef4444}:root[data-accent=orange]{--ac:#f97316}:root[data-accent=amber]{--ac:#eab308}:root[data-accent=teal]{--ac:#14b8a6}
:root[data-font=arial]{--font:Arial,Helvetica,sans-serif}:root[data-font=calibri]{--font:Calibri,Candara,"Segoe UI",sans-serif}:root[data-font=verdana]{--font:Verdana,Geneva,sans-serif}:root[data-font=trebuchet]{--font:"Trebuchet MS","Lucida Grande",sans-serif}:root[data-font=georgia]{--font:Georgia,"Times New Roman",serif}:root[data-font=cambria]{--font:Cambria,Georgia,serif}:root[data-font=palatino]{--font:"Palatino Linotype",Palatino,"Book Antiqua",serif}:root[data-font=times]{--font:"Times New Roman",Times,serif}:root[data-font=consolas]{--font:Consolas,"Cascadia Mono",Menlo,monospace}:root[data-font=courier]{--font:"Courier New",Courier,monospace}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.7 var(--font);overflow-wrap:break-word}
a{color:var(--link);text-underline-offset:.18em;text-decoration-thickness:1px}
a:not([href]){color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--ac);outline-offset:2px;border-radius:4px}
[hidden]{display:none!important}
.sp-skip{position:absolute;left:-999px;top:8px;padding:8px 14px;background:var(--ink);color:var(--bg);border-radius:8px;z-index:30}
.sp-skip:focus{left:8px}
.sp-top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;height:58px;padding:0 20px;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.sp-brand{display:flex;align-items:baseline;gap:8px;min-width:0;margin-right:auto;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--ink);text-decoration:none}
.sp-brand span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-mark{color:var(--ac);font-family:var(--mono);font-weight:700}
.sp-search{position:relative;flex:0 1 260px;min-width:0}
.sp-search input{width:100%;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink);font:15px var(--font)}
.sp-search input::placeholder{color:var(--faint)}
.sp-hits{position:absolute;right:0;top:44px;width:min(440px,calc(100vw - 24px));max-height:70vh;overflow:auto;padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--bg);box-shadow:0 14px 40px rgba(0,0,0,.18)}
.sp-hit{display:block;padding:9px 11px;border-radius:8px;color:var(--ink);text-decoration:none}
.sp-hit:hover,.sp-hit:focus{background:var(--panel)}
.sp-hit b{display:block;font-size:15px}
.sp-hit span{display:block;font-size:13.5px;line-height:1.45;color:var(--soft)}
.sp-empty{margin:0;padding:10px 12px;font-size:14px;color:var(--soft)}
.sp-theme{flex:none;width:36px;height:36px;padding:0;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--ink);cursor:pointer}
.sp-theme::before{content:"";display:block;width:16px;height:16px;margin:auto;border-radius:50%;border:2px solid currentColor;background:linear-gradient(90deg,currentColor 50%,transparent 50%)}
.sp-navt{position:absolute;opacity:0;width:1px;height:1px}
.sp-navb{display:none;flex:none;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font-size:14.5px;line-height:34px;cursor:pointer;-webkit-user-select:none;user-select:none}
.sp-navt:focus-visible+.sp-top .sp-navb{outline:2px solid var(--ac);outline-offset:2px}
.sp-shell{display:grid;grid-template-columns:270px minmax(0,1fr) 230px;max-width:1340px;margin:0 auto}
.sp-nav{position:sticky;top:58px;align-self:start;height:calc(100vh - 58px);overflow:auto;padding:22px 14px 40px 20px;border-right:1px solid var(--line);font-size:15px;line-height:1.4}
.sp-nav ul{list-style:none;margin:0;padding:0}
.sp-nav ul ul{margin-left:10px;padding-left:10px;border-left:1px solid var(--line)}
.sp-nav a{display:block;padding:6px 10px;border-radius:7px;color:var(--soft);text-decoration:none}
.sp-nav a:hover{color:var(--ink);background:var(--panel)}
.sp-nav a[aria-current]{color:var(--ink);font-weight:600;background:color-mix(in srgb,var(--ac) 15%,transparent)}
.sp-nav summary{padding:6px 10px;border-radius:7px;font-weight:600;color:var(--ink);cursor:pointer}
.sp-nav details{margin:4px 0}
.sp-main{min-width:0;padding:38px 44px 70px}
.sp-body{max-width:740px;margin:0 auto}
.sp-toc{position:sticky;top:58px;align-self:start;max-height:calc(100vh - 58px);overflow:auto;padding:38px 18px 40px 6px;font-size:14px;line-height:1.4}
.sp-toc h2{margin:0 0 10px;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:600}
.sp-toc ul{list-style:none;margin:0;padding:0}
.sp-toc a{display:block;padding:4px 0;color:var(--soft);text-decoration:none}
.sp-toc a:hover{color:var(--ink)}
.sp-toc .sp-l3{padding-left:14px}
.sp-preview{margin:0;padding:8px 20px;background:var(--ac);color:#fff;font-size:14px;text-align:center}
.sp-body h1,.sp-body h2,.sp-body h3,.sp-body h4,.sp-body h5,.sp-body h6{line-height:1.25;margin:1.7em 0 .55em;letter-spacing:-.012em;scroll-margin-top:76px}
.sp-body h1{font-size:2.05em;margin-top:0;letter-spacing:-.022em}
.sp-body h2{font-size:1.45em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
.sp-body h3{font-size:1.2em}.sp-body h4{font-size:1.05em}
.sp-body p,.sp-body ul,.sp-body ol,.sp-body dl,.sp-body blockquote,.sp-body pre,.sp-body figure{margin:0 0 1.05em}
.sp-body ul,.sp-body ol{padding-left:1.4em}
.sp-body ol ol,.sp-body ol ol ol ol ol{list-style-type:lower-alpha}.sp-body ol ol ol,.sp-body ol ol ol ol ol ol{list-style-type:lower-roman}.sp-body ol ol ol ol{list-style-type:decimal}
.sp-body li{margin:.2em 0}
.sp-body li>p{margin:0 0 .4em}
.sp-body img{max-width:100%;height:auto;border-radius:8px}
.sp-body hr{border:0;border-top:1px solid var(--line);margin:2.2em 0}
.sp-body blockquote{padding:.1em 1.1em;border-left:3px solid var(--line);color:var(--soft)}
.sp-body code,.sp-body kbd,.sp-body samp{font:.88em/1.5 var(--mono)}
.sp-body :not(pre)>code{padding:.14em .4em;border-radius:5px;background:var(--code)}
.sp-body kbd{padding:.1em .45em;border:1px solid var(--line);border-bottom-width:2px;border-radius:5px}
.sp-body pre{padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:auto;-webkit-overflow-scrolling:touch;tab-size:2}
.sp-body pre code{font-size:14.5px}
.sp-body mark{padding:.05em .25em;border-radius:4px;background:color-mix(in srgb,#facc15 45%,transparent);color:inherit}
.sp-body table{border-collapse:collapse;font-size:.94em}
.sp-body th,.sp-body td{padding:7px 12px;border:1px solid var(--line);text-align:left;vertical-align:top}
.sp-body th{background:var(--panel);font-weight:600}
.sp-body .lmd-table{overflow-x:auto;margin:0 0 1.05em;-webkit-overflow-scrolling:touch}
.sp-al-left{text-align:left!important}.sp-al-center{text-align:center!important}.sp-al-right{text-align:right!important}
.sp-body .lmd-diagram{margin:0 0 1.2em;padding:14px;text-align:center;overflow-x:auto;border-radius:12px;background:var(--card)}
.sp-body .lmd-diagram img{border-radius:0}
.sp-body math{font-size:1.1em}
.sp-body math[display=block]{display:block;margin:0 0 1.05em;overflow-x:auto;overflow-y:hidden;padding:4px 0}
.sp-body .lmd-math-block{overflow-x:auto}
.sp-body .lmd-box,.sp-body .lmd-alert{margin:0 0 1.05em;padding:.7em 1.1em;border:0;border-left:3px solid var(--faint);border-radius:0 10px 10px 0;background:var(--panel);color:var(--ink)}
.sp-body .lmd-box>:last-child,.sp-body .lmd-alert>:last-child{margin-bottom:0}
.sp-body .lmd-box-title,.sp-body .lmd-alert-title{margin:0 0 .3em;font-weight:700}
.sp-body .lmd-box summary{font-weight:700;cursor:pointer}
.sp-body .lmd-box-tip,.sp-body .lmd-alert-tip{border-left-color:#16a34a}.sp-body .lmd-box-info,.sp-body .lmd-alert-note,.sp-body .lmd-box-note{border-left-color:#3b82f6}.sp-body .lmd-alert-important{border-left-color:#a855f7}.sp-body .lmd-box-warning,.sp-body .lmd-alert-warning{border-left-color:#eab308}.sp-body .lmd-box-danger,.sp-body .lmd-alert-caution{border-left-color:#ef4444}
.sp-body .lmd-task-list{list-style:none;padding-left:.2em}
.sp-check{display:inline-block;width:1em;height:1em;margin-right:.5em;vertical-align:-.14em;border:1.5px solid var(--faint);border-radius:4px}
.sp-check.sp-on{border-color:var(--ac);background:var(--ac);box-shadow:inset 0 0 0 2.5px var(--bg)}
.sp-noimg{padding:.1em .5em;border:1px dashed var(--line);border-radius:6px;font-size:.9em;color:var(--soft)}
.sp-body .lmd-toc{display:block;margin:0 0 1.05em;padding:.7em 1.1em;border:1px solid var(--line);border-radius:10px}
.sp-body .lmd-toc a{display:block;padding:2px 0}
.sp-body .lmd-toc-l3{padding-left:1em}.sp-body .lmd-toc-l4,.sp-body .lmd-toc-l5,.sp-body .lmd-toc-l6{padding-left:2em}
.sp-body .lmd-front{display:none}
.sp-body .lmd-kanban{white-space:pre-wrap}
.sp-body .footnotes{margin-top:2.4em;padding-top:.6em;border-top:1px solid var(--line);font-size:.92em;color:var(--soft)}
.hljs-comment,.hljs-quote{color:var(--faint);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in,.hljs-type,.hljs-doctag{color:var(--k)}
.hljs-string,.hljs-attr,.hljs-regexp,.hljs-addition,.hljs-template-tag{color:var(--s)}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-meta,.hljs-variable,.hljs-template-variable{color:var(--n)}
.hljs-title,.hljs-section,.hljs-name,.hljs-selector-id,.hljs-selector-class,.hljs-attribute{color:var(--t)}
.hljs-deletion{color:#ef4444}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
.sp-step{display:flex;gap:14px;max-width:740px;margin:3em auto 0}
.sp-step a{flex:1 1 0;min-width:0;padding:12px 16px;border:1px solid var(--line);border-radius:12px;color:var(--ink);text-decoration:none}
.sp-step a:hover{border-color:var(--ac)}
.sp-step small{display:block;font-size:12.5px;color:var(--faint)}
.sp-step b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.sp-step .sp-next{text-align:right;margin-left:auto}
.sp-step .sp-next:only-child{flex:0 1 50%}
.sp-foot{display:flex;flex-wrap:wrap;gap:6px 18px;max-width:740px;margin:2.6em auto 0;padding-top:16px;border-top:1px solid var(--line);font-size:13.5px;color:var(--faint)}
.sp-foot a{color:var(--soft)}
.sp-foot .sp-made{margin-left:auto}
.sp-note{max-width:560px;margin:14vh auto 0;padding:0 22px;text-align:center}
.sp-note h1{font-size:1.6em;margin:0 0 .4em;letter-spacing:-.02em}
.sp-note p{color:var(--soft);margin:0 0 1.2em}
.sp-report{max-width:560px;margin:8vh auto 0;padding:0 22px}
.sp-report h1{font-size:1.5em;margin:0 0 .4em;letter-spacing:-.02em}
.sp-report p{color:var(--soft);margin:0 0 1em}
.sp-report label{display:block;margin:0 0 12px;font-size:14px;color:var(--soft)}
.sp-report textarea,.sp-report input{display:block;width:100%;margin-top:5px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:16px/1.5 var(--font)}
.sp-report textarea{min-height:130px;resize:vertical}
.sp-btn{display:inline-block;height:42px;padding:0 20px;border:0;border-radius:10px;background:var(--ink);color:var(--bg);font:600 15px/42px var(--font);cursor:pointer;text-decoration:none}
.sp-btn[disabled]{opacity:.5;cursor:default}
.sp-msg{min-height:1.6em;margin-top:12px;color:var(--ink)}
@media (max-width:1180px){.sp-shell{grid-template-columns:260px minmax(0,1fr)}.sp-toc{display:none}}
@media (max-width:860px){
body{font-size:16.5px}
.sp-top{padding:0 12px;gap:8px}
.sp-navb{display:block}
.sp-search{flex:1 1 120px}
.sp-shell{display:block}
.sp-nav{display:none;position:static;height:auto;padding:12px 12px 16px;border-right:0;border-bottom:1px solid var(--line);background:var(--panel)}
.sp-navt:checked~.sp-shell .sp-nav{display:block}
.sp-nav a,.sp-nav summary{padding:10px}
.sp-main{padding:24px 18px 56px}
.sp-body h1{font-size:1.75em}
.sp-step{flex-direction:column}.sp-step .sp-next:only-child{flex:1 1 auto}
.sp-foot .sp-made{margin-left:0}
}
@media print{.sp-top,.sp-nav,.sp-toc,.sp-step,.sp-preview,.sp-skip{display:none}.sp-shell{display:block}.sp-main{padding:0}}
`.split('DARK').join(SITE_DARK).replace(/\r?\n/g, '');
const SITE_JS = String.raw`(function () {
  'use strict';
  var d = document, root = d.documentElement, KEY = 'sp-theme', saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch (e) { saved = ''; }
  if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  function norm(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function make(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function start() {
    var tb = d.querySelector('.sp-theme');
    if (tb) {
      tb.hidden = false;
      tb.addEventListener('click', function () {
        var now = root.getAttribute('data-theme');
        var dark = now ? now === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
        var next = dark ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem(KEY, next); } catch (e) { /* no storage */ }
      });
    }
    var box = d.querySelector('.sp-search');
    if (box) {
      box.hidden = false;
      var input = box.querySelector('input'), hits = box.querySelector('.sp-hits'), docs = null, asked = false;
      var close = function () { hits.hidden = true; hits.textContent = ''; };
      var run = function () {
        var terms = norm(input.value).split(/\s+/).filter(Boolean);
        hits.textContent = '';
        if (!terms.length || !docs) { hits.hidden = true; return; }
        var found = [];
        docs.forEach(function (doc) {
          var score = 0, ok = terms.every(function (t) { var a = doc.nt.indexOf(t) !== -1, b = doc.nx.indexOf(t) !== -1; score += a ? 10 : b ? 1 : 0; return a || b; });
          if (ok) found.push({ doc: doc, score: score });
        });
        found.sort(function (a, b) { return b.score - a.score; });
        found.slice(0, 10).forEach(function (f) {
          var a = make('a', 'sp-hit'); a.href = box.getAttribute('data-base') + '/' + f.doc.r;
          a.appendChild(make('b', '', f.doc.t));
          var at = f.doc.nx.indexOf(terms[0]), from = Math.max(0, at - 50);
          if (f.doc.x) a.appendChild(make('span', '', (from ? '…' : '') + f.doc.x.slice(from, from + 150)));
          hits.appendChild(a);
        });
        if (!found.length) hits.appendChild(make('p', 'sp-empty', box.getAttribute('data-none')));
        hits.hidden = false;
      };
      var load = function () {
        if (asked) return; asked = true;
        fetch(box.getAttribute('data-index'), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
          docs = (Array.isArray(list) ? list : []).map(function (x) { return { r: String(x.r || ''), t: String(x.t || ''), x: String(x.x || ''), nt: norm(x.t || ''), nx: norm(x.x || '') }; });
          run();
        }).catch(function () { asked = false; });
      };
      input.addEventListener('focus', load);
      input.addEventListener('input', function () { load(); run(); });
      box.addEventListener('keydown', function (e) {
        var list = Array.prototype.slice.call(hits.querySelectorAll('.sp-hit')), at = list.indexOf(d.activeElement);
        if (e.key === 'Escape') { close(); input.blur(); }
        else if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); list[Math.min(list.length - 1, at + 1)].focus(); }
        else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); if (at <= 0) input.focus(); else list[at - 1].focus(); }
        else if (e.key === 'Enter' && d.activeElement === input && list.length) { e.preventDefault(); location.href = list[0].href; }
      });
      d.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
      d.addEventListener('keydown', function (e) {
        var t = e.target;
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { e.preventDefault(); input.focus(); }
      });
    }
    var rep = d.querySelector('.sp-report[data-s]');
    if (rep) {
      var btn = rep.querySelector('button'), msg = rep.querySelector('.sp-msg'), why = rep.querySelector('textarea'), mail = rep.querySelector('input');
      rep.querySelector('.sp-form').hidden = false;
      btn.addEventListener('click', function () {
        var text = why.value.trim();
        if (text.length < 5) { msg.textContent = rep.getAttribute('data-short'); why.focus(); return; }
        btn.disabled = true; msg.textContent = '';
        fetch('/_/report', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s: rep.getAttribute('data-s'), p: rep.getAttribute('data-p'), text: text, email: mail.value.trim() }) })
          .then(function (r) {
            if (r.ok) { rep.querySelector('.sp-form').hidden = true; msg.textContent = rep.getAttribute('data-ok'); return; }
            btn.disabled = false; msg.textContent = rep.getAttribute(r.status === 429 ? 'data-many' : 'data-fail');
          }).catch(function () { btn.disabled = false; msg.textContent = rep.getAttribute('data-fail'); });
      });
    }
  }
  if (d.readyState !== 'loading') start(); else d.addEventListener('DOMContentLoaded', start);
})();
`;
const SITE_VER = sha(SITE_CSS + SITE_JS).slice(0, 12);
// La política de cada respuesta del host de sitios: nada por defecto; el único script y la única hoja de estilos
// son los propios, por su dirección exacta; imágenes por https o incrustadas; el buscador y la denuncia hablan solo
// con este host. Sin estilos ni scripts en línea, sin marcos, sin formularios que salgan.
const SITE_CSP = PAGES ? "default-src 'none'; script-src " + PAGES.url + "/_/site.js; style-src " + PAGES.url + "/_/site.css; img-src https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" : '';
const SITE_HEADERS = { 'content-security-policy': SITE_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' };
const SITE_ICON = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3.75" fill="#14161a"/><path fill="#f3f5f8" d="M3 4h2v8H3zM7 4h2v8H7zM2 5h8v2H2zM2 9h8v2H2z"/><rect x="11" y="3" width="3" height="10" rx=".5" fill="#c5f467"/></svg>').toString('base64');
const siteDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// El documento entero, con su cabecera. Todo lo que no es el cuerpo ya filtrado pasa por html().
function siteDoc(o) {
  const c = o.conf || {}; const accent = SITE_ACCENTS[c.accent] || ''; const font = SITE_FONTS[c.font] || '';
  const meta = (k, v, prop) => (v ? '<meta ' + (prop ? 'property' : 'name') + '="' + k + '" content="' + html(v) + '">\n' : '');
  return '<!doctype html>\n<html lang="' + (o.lang === 'es' ? 'es' : 'en') + '"' + (accent ? ' data-accent="' + accent + '"' : '') + (font ? ' data-font="' + font + '"' : '') + '>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + html(o.title) + '</title>\n' + meta('description', o.descr) + (o.noindex ? '<meta name="robots" content="noindex">\n' : '') + (o.canonical ? '<link rel="canonical" href="' + html(o.canonical) + '">\n' : '') +
    (o.og ? meta('og:type', o.og.type, true) + meta('og:title', o.og.title, true) + meta('og:description', o.descr, true) + meta('og:url', o.canonical, true) + meta('og:site_name', o.og.site, true) + meta('twitter:card', 'summary') : '') +
    (o.author ? meta('author', o.author) : '') + '<meta name="generator" content="SharpMD">\n<link rel="icon" href="' + SITE_ICON + '">\n<link rel="stylesheet" href="/_/site.css?v=' + SITE_VER + '">\n<script src="/_/site.js?v=' + SITE_VER + '"></script>\n</head>\n<body>\n' + o.body + '\n</body>\n</html>\n';
}
// Una página que solo avisa: no existe, ya no está publicada, o no está disponible. No dice nada del sitio ni de quién es.
function siteNote(lang, kind, back) {
  const t = SITE_STR[lang === 'es' ? 'es' : 'en'];
  return siteDoc({ lang, title: t[kind + '_t'], noindex: true, body: '<main class="sp-note"><h1>' + html(t[kind + '_t']) + '</h1><p>' + html(t[kind]) + '</p>' + (back ? '<p><a href="' + html(back) + '">' + html(t.back) + '</a></p>' : '') +
    '<p><a href="https://sharpmd.app">' + html(t.made) + '</a></p></main>' });
}
// Las páginas que se pueden servir de un sitio: las que tienen su nota en pie y sin cifrar. Una nota eliminada (está
// en la papelera) o cambiada de nombre saca su página en el acto, sin esperar a que alguien vuelva a publicar.
const siteLivePages = (site) => q('SELECT p.note, p.route, p.title, p.descr, p.toc, p.ord, p.at FROM site_pages p JOIN notes n ON n.user = ? AND n.path = p.note AND n.v = 0 WHERE p.site = ?').all(site.owner, site.id);
// El árbol del menú y el orden de lectura: en cada carpeta, primero sus páginas (por order del encabezado, después
// por título) y después sus subcarpetas. La portada va primera.
function siteTree(site, pages) {
  const dir = (name) => ({ name, dirs: new Map(), pages: [] }); const top = dir('');
  for (const p of pages) { const parts = p.note.slice(site.folder.length + 1).split('/'); parts.pop(); let at = top; for (const d of parts) { if (!at.dirs.has(d)) at.dirs.set(d, dir(d)); at = at.dirs.get(d); } at.pages.push(p); }
  const ab = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const cmp = (a, b) => (a.route === '' ? -1 : b.route === '' ? 1 : 0) || ((a.ord == null ? 1e12 : a.ord) - (b.ord == null ? 1e12 : b.ord)) || ab(a.title, b.title);
  const flat = [];
  const walk = (node) => { node.pages.sort(cmp); node.pages.forEach((p) => flat.push(p)); node.list = Array.from(node.dirs.values()).sort((a, b) => ab(a.name, b.name)); node.list.forEach(walk); };
  walk(top);
  return { top, flat };
}
function siteContext(site, base, preview) {
  const pages = siteLivePages(site); const tree = siteTree(site, pages);
  const byNote = new Map(); const byLower = new Map(); const wiki = new Map(); const byRoute = new Map();
  for (const p of tree.flat) { byNote.set(p.note, p); byRoute.set(p.route, p); if (!byLower.has(p.note.toLowerCase())) byLower.set(p.note.toLowerCase(), p); const k = siteWikiKey(p.note.slice(p.note.lastIndexOf('/') + 1)); if (!wiki.has(k)) wiki.set(k, p); }
  const conf = siteConfOf(site);
  return { site, conf, base, preview, tree, byNote, byLower, wiki, byRoute, t: SITE_STR[conf.lang === 'es' ? 'es' : 'en'] };
}
// El ancla de una sección en la página de destino: la que tiene ese id, o la del título que se parece.
function siteAnchor(target, frag) {
  let f = frag; try { f = decodeURIComponent(frag); } catch (e) { f = frag; }
  let list = []; try { list = JSON.parse(target.toc || '[]'); } catch (e) { list = []; }
  if (list.some((h) => h.id === f)) return f;
  const norm = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const hit = list.find((h) => norm(h.id) === norm(f) || norm(h.t) === norm(f));
  return hit ? hit.id : siteSlugify(f);
}
// Adónde lleva un enlace entre notas: a la página de esa nota si está publicada en este sitio, o a ningún lado.
function siteTarget(ctx, page, kind, value) {
  let ref = value; let frag = ''; const h = ref.indexOf('#'); if (h !== -1) { frag = ref.slice(h + 1); ref = ref.slice(0, h); }
  let target = null;
  if (kind === 'w') target = ref.trim() ? ctx.wiki.get(siteWikiKey(ref.split('/').pop())) : page;
  else {
    const qm = ref.indexOf('?'); if (qm !== -1) ref = ref.slice(0, qm);
    try { ref = decodeURIComponent(ref); } catch (e) { return ''; }
    if (!ref) target = page;
    else {
      const parts = ref[0] === '/' ? ctx.site.folder.split('/') : page.note.split('/').slice(0, -1);
      for (const seg of ref.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
      const p = parts.join('/'); const l = p.toLowerCase();
      target = ctx.byNote.get(p) || ctx.byNote.get(p + '.md') || ctx.byLower.get(l) || ctx.byLower.get(l + '.md') || null;
    }
  }
  if (!target) return '';
  return ctx.base + '/' + target.route + (frag ? '#' + encodeURIComponent(siteAnchor(target, frag)) : '');
}
// En el cuerpo guardado, un enlace a otra nota es <a data-n="…"> o <a data-w="…">, que solo puede haber escrito
// siteClean (el texto y los valores van escapados). Acá toma su dirección, o queda como texto sin enlace.
const siteLinks = (ctx, page, body) => body.replace(/<a data-([nw])="([^"]*)"/g, (m, kind, v) => { const href = siteTarget(ctx, page, kind, sanUnattr(v)); return href ? '<a href="' + sanAttr(href) + '"' : '<a'; });
function siteNav(ctx, node, here) {
  let out = '<ul>';
  for (const p of node.pages) out += '<li><a href="' + html(ctx.base + '/' + p.route) + '"' + (p === here ? ' aria-current="page"' : '') + '>' + html(p.title) + '</a></li>';
  for (const d of node.list) out += '<li><details open><summary>' + html(d.name) + '</summary>' + siteNav(ctx, d, here) + '</details></li>';
  return out + '</ul>';
}
function sitePage(ctx, page) {
  const { site, conf, t, base } = ctx; const row = q('SELECT html FROM site_pages WHERE site = ? AND note = ?').get(site.id, page.note);
  let toc = []; try { toc = JSON.parse(page.toc || '[]'); } catch (e) { toc = []; }
  const home = page.route === ''; const brand = conf.logo || conf.title;
  const at = ctx.tree.flat.indexOf(page); const prev = ctx.tree.flat[at - 1]; const next = ctx.tree.flat[at + 1];
  // x: la nota pidió no mostrar su índice (toc: false en sus ajustes de página).
  const side = toc.filter((h) => !h.x && (h.l === 2 || h.l === 3));
  const report = '/_/report?s=' + encodeURIComponent(site.slug) + '&p=' + encodeURIComponent(page.route);
  const step = (p, cls, label) => (p ? '<a class="' + cls + '" href="' + html(base + '/' + p.route) + '"' + (cls === 'sp-prev' ? ' rel="prev"' : ' rel="next"') + '><small>' + html(label) + '</small><b>' + html(p.title) + '</b></a>' : '');
  const body = '<a class="sp-skip" href="#sp-main">' + html(t.skip) + '</a>\n' + (ctx.preview ? '<p class="sp-preview">' + html(t.preview) + '</p>\n' : '') +
    '<input type="checkbox" class="sp-navt" id="sp-navt" aria-label="' + html(t.menu) + '">\n' +
    '<header class="sp-top"><label class="sp-navb" for="sp-navt">' + html(t.menu) + '</label><a class="sp-brand" href="' + html(base + '/') + '"><span class="sp-mark" aria-hidden="true">#</span><span>' + html(brand) + '</span></a>' +
    '<div class="sp-search" role="search" data-index="' + html(base + '/search.json') + '" data-base="' + html(base) + '" data-none="' + html(t.none) + '" hidden><input type="search" placeholder="' + html(t.search) + '" aria-label="' + html(t.search) + '" autocomplete="off" spellcheck="false"><div class="sp-hits" hidden></div></div>' +
    '<button type="button" class="sp-theme" aria-label="' + html(t.theme) + '" title="' + html(t.theme) + '" hidden></button></header>\n' +
    '<div class="sp-shell">\n<nav class="sp-nav" aria-label="' + html(t.pages) + '">' + siteNav(ctx, ctx.tree.top, page) + '</nav>\n' +
    '<main class="sp-main" id="sp-main"><article class="sp-body">' + (toc.some((h) => h.l === 1) ? '' : '<h1>' + html(page.title) + '</h1>') + siteLinks(ctx, page, row ? row.html : '') + '</article>' +
    (prev || next ? '<nav class="sp-step" aria-label="' + html(t.prev + ' / ' + t.next) + '">' + step(prev, 'sp-prev', t.prev) + step(next, 'sp-next', t.next) + '</nav>' : '') +
    '<footer class="sp-foot">' + (conf.author ? '<span>' + html(t.by.replace('{a}', conf.author)) + '</span>' : '') + '<span>' + html(t.updated.replace('{a}', '')) + '<time datetime="' + siteDay(page.at) + '">' + siteDay(page.at) + '</time></span>' +
    '<a class="sp-made" href="https://sharpmd.app">' + html(t.made) + '</a><a href="' + html(report) + '" rel="nofollow">' + html(t.report) + '</a></footer></main>\n' +
    (side.length > 1 ? '<aside class="sp-toc" aria-label="' + html(t.toc) + '"><h2>' + html(t.toc) + '</h2><ul>' + side.map((h) => '<li><a class="sp-l' + h.l + '" href="#' + html(encodeURIComponent(h.id)) + '">' + html(h.t) + '</a></li>').join('') + '</ul></aside>\n' : '') + '</div>';
  const url = PAGES.url + '/' + site.slug + '/' + page.route;
  return siteDoc({ lang: conf.lang, conf, title: home ? conf.title : page.title + ' · ' + conf.title, descr: page.descr || conf.descr, noindex: ctx.preview || !!conf.noindex, canonical: ctx.preview ? '' : url, author: conf.author,
    og: { type: home ? 'website' : 'article', title: home ? conf.title : page.title, site: conf.title }, body });
}
function siteReportPage(query) {
  const slug = String(query.get('s') || ''); const route = String(query.get('p') || '');
  const site = SITE_SLUG.test(slug) ? q('SELECT * FROM sites WHERE slug = ?').get(slug) : null;
  if (!site || !/^[a-z0-9/-]{0,300}$/.test(route)) return null;
  const conf = siteConfOf(site); const t = SITE_STR[conf.lang === 'es' ? 'es' : 'en'];
  return siteDoc({ lang: conf.lang, title: t.r_title, noindex: true, body: '<main class="sp-report" data-s="' + html(slug) + '" data-p="' + html(route) + '" data-ok="' + html(t.r_ok) + '" data-fail="' + html(t.r_fail) + '" data-many="' + html(t.r_many) + '" data-short="' + html(t.r_short) + '">' +
    '<h1>' + html(t.r_title) + '</h1><p>' + html(t.r_lead) + '</p><p><code>' + html(PAGES.url + '/' + slug + '/' + route) + '</code></p>' +
    '<div class="sp-form" hidden><label>' + html(t.r_why) + '<textarea maxlength="2000"></textarea></label><label>' + html(t.r_mail) + '<input type="email" maxlength="200" autocomplete="email"></label><button type="button" class="sp-btn">' + html(t.r_send) + '</button></div>' +
    '<noscript><p>' + html(t.r_js) + '</p></noscript><p class="sp-msg" role="status"></p><p><a href="' + html('/' + slug + '/') + '">' + html(t.r_back) + '</a></p></main>' });
}
// La denuncia de un sitio: lo único que el host de sitios escribe. Sale por el mismo camino que POST /feedback, con
// report.kind "site". De quien denuncia no se lee ninguna credencial: llega como anónimo, con su IP para el tope.
async function siteReport(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new Fail(415, 'bad_type');
  let b = null; try { b = JSON.parse(await readRaw(req, 8192)); } catch (e) { if (e instanceof Fail) throw e; throw new Fail(400, 'bad_json'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Fail(400, 'bad_json');
  const slug = String(b.s || ''); const route = String(b.p || ''); const text = String(b.text == null ? '' : b.text).trim().slice(0, 2000);
  const site = SITE_SLUG.test(slug) ? q('SELECT * FROM sites WHERE slug = ?').get(slug) : null;
  if (!site || !/^[a-z0-9/-]{0,300}$/.test(route)) throw new Fail(404, 'not_found');
  if (text.length < 5) throw new Fail(400, 'bad_text');
  const ip = 'site:report:' + clientIp(req);
  limit(ip, SITE_REPORTS_HOUR, HOUR, 'too_many'); mark(ip);
  q('UPDATE sites SET reports = reports + 1, reported = ? WHERE id = ?').run(now(), site.id);
  let email = ''; try { email = String(b.email || '').trim() ? cleanEmail(b.email) : ''; } catch (e) { email = ''; }
  const plain = { headers: { 'x-forwarded-for': req.headers['x-forwarded-for'] || '' }, socket: req.socket };
  try {
    await feedback(plain, { text, email, report: { kind: 'site', note: PAGES.url + '/' + slug + '/' + route, owner: 'site ' + site.id }, context: { where: 'web', browser: req.headers['user-agent'] || '', lang: siteConfOf(site).lang } });
  } catch (e) { if (e instanceof Fail && e.status === 429) throw e; /* sin correo configurado, o el correo falló: la denuncia ya quedó contada en el sitio */ }
  return { ok: true };
}
const pagesHost = (req) => { if (!PAGES) return false; const h = String(req.headers.host || '').toLowerCase(); return h === PAGES.host || h === PAGES.host + PAGES.port; };
// Todo lo que entra por el host de sitios termina acá. No se llama a userFrom ni a route: por este host no hay API.
async function pagesServe(req, res) {
  const head = req.method === 'HEAD';
  const send = (status, type, body, extra) => {
    const h = Object.assign({}, SITE_HEADERS, { 'content-type': type, 'cache-control': status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store' }, extra || {});
    if (status === 200 && body) {
      const tag = '"' + sha(body).slice(0, 24) + '"'; h.etag = tag;
      if (String(req.headers['if-none-match'] || '').split(',').map((v) => v.trim().replace(/^W\//, '')).includes(tag)) { res.writeHead(304, h); res.end(); return; }
    }
    h['content-length'] = Buffer.byteLength(body || '');
    res.writeHead(status, h); res.end(head ? undefined : body);
  };
  const page = (status, body, extra) => send(status, 'text/html; charset=utf-8', body, extra);
  try {
    rate('pages:' + clientIp(req), SITE_HITS_MINUTE, 60000, 'too_many');
    const raw = String(req.url || '/'); const qi = raw.indexOf('?'); const p = qi === -1 ? raw : raw.slice(0, qi); const query = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));
    if (p === '/_/report' && req.method === 'POST') { const out = await siteReport(req); send(200, 'application/json; charset=utf-8', JSON.stringify(out), { 'cache-control': 'no-store' }); return; }
    if (req.method !== 'GET' && !head) { send(405, 'text/plain; charset=utf-8', 'Method not allowed', { allow: 'GET, HEAD' }); return; }
    // Una dirección de acá lleva solo letras, números, guiones, puntos y barras. Nada codificado, nada con "..".
    if (p.length > 600 || !/^\/[A-Za-z0-9._~/-]*$/.test(p) || /\/\/|(^|\/)\.\.?(\/|$)/.test(p)) { page(404, siteNote('en', 'missing')); return; }
    if (p === '/_/site.css') { send(200, 'text/css; charset=utf-8', SITE_CSS, { 'cache-control': 'public, max-age=86400' }); return; }
    if (p === '/_/site.js') { send(200, 'text/javascript; charset=utf-8', SITE_JS, { 'cache-control': 'public, max-age=86400' }); return; }
    if (p === '/_/report') { const body = siteReportPage(query); if (body) page(200, body, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); else page(404, siteNote('en', 'missing')); return; }
    if (p === '/') { const t = SITE_STR.en; page(200, siteDoc({ lang: 'en', title: t.root_t, descr: t.root, body: '<main class="sp-note"><h1>' + html(t.root_t) + '</h1><p>' + html(t.root) + '</p><p><a href="https://sharpmd.app">' + html(t.what) + '</a></p></main>' })); return; }
    if (p === '/robots.txt') { send(200, 'text/plain; charset=utf-8', 'User-agent: *\nDisallow: /_/\nDisallow: /~\nSitemap: ' + PAGES.url + '/sitemap.xml\n'); return; }
    if (p === '/sitemap.xml') {
      const rows = q('SELECT slug, conf, lapsed FROM sites WHERE live = 1 AND suspended = 0 ORDER BY id LIMIT 20000').all().filter((s) => !siteConfOf(s).noindex && !(s.lapsed && now() - s.lapsed >= PAGES_GRACE_MS));
      send(200, 'application/xml; charset=utf-8', '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.map((s) => '<sitemap><loc>' + PAGES.url + '/' + s.slug + '/sitemap.xml</loc></sitemap>\n').join('') + '</sitemapindex>\n');
      return;
    }
    const parts = p.slice(1).split('/'); const first = parts[0]; const rest = parts.slice(1).join('/');
    const preview = first[0] === '~';
    const site = preview ? (/^~[A-Za-z0-9_-]{16,48}$/.test(first) ? q('SELECT * FROM sites WHERE pkey = ?').get(first.slice(1)) : null) : (SITE_SLUG.test(first) ? q('SELECT * FROM sites WHERE slug = ?').get(first) : null);
    if (!site) { page(404, siteNote('en', 'missing')); return; }
    const lang = siteConfOf(site).lang; const base = '/' + first;
    if (parts.length === 1) { res.writeHead(308, Object.assign({}, SITE_HEADERS, { location: base + '/', 'cache-control': 'no-store' })); res.end(); return; }
    if (site.suspended) { page(451, siteNote(lang, 'held'), { 'x-robots-tag': 'noindex' }); return; }
    if (siteVaulted(site.owner, site.folder)) siteTakeDown(site);
    if ((!preview && (!site.live || (site.lapsed && now() - site.lapsed >= PAGES_GRACE_MS))) || siteVaulted(site.owner, site.folder)) { page(410, siteNote(lang, 'gone'), { 'x-robots-tag': 'noindex' }); return; }
    const ctx = siteContext(site, base, preview); const conf = ctx.conf;
    const robots = preview || conf.noindex ? { 'x-robots-tag': 'noindex' } : {};
    if (!ctx.tree.flat.length) { page(410, siteNote(lang, 'gone'), { 'x-robots-tag': 'noindex' }); return; }
    if (rest === 'search.json') {
      const text = new Map(q('SELECT note, text FROM site_pages WHERE site = ?').all(site.id).map((r) => [r.note, r.text]));
      send(200, 'application/json; charset=utf-8', JSON.stringify(ctx.tree.flat.map((x) => ({ r: x.route, t: x.title, x: text.get(x.note) || '' }))), robots); return;
    }
    if (rest === 'robots.txt' && !preview) { send(200, 'text/plain; charset=utf-8', 'User-agent: *\n' + (conf.noindex ? 'Disallow: /' + site.slug + '/\n' : 'Allow: /' + site.slug + '/\nSitemap: ' + PAGES.url + '/' + site.slug + '/sitemap.xml\n')); return; }
    if (rest === 'sitemap.xml' && !preview) {
      if (conf.noindex) { page(404, siteNote(lang, 'missing', base + '/')); return; }
      send(200, 'application/xml; charset=utf-8', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ctx.tree.flat.map((x) => '<url><loc>' + PAGES.url + '/' + site.slug + '/' + x.route + '</loc><lastmod>' + siteDay(x.at) + '</lastmod></url>\n').join('') + '</urlset>\n');
      return;
    }
    const route = rest.replace(/\/+$/, '');
    if (route && !/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(route)) { page(404, siteNote(lang, 'missing', base + '/'), robots); return; }
    const hit = ctx.byRoute.get(route);
    // Sin una nota de portada, la dirección del sitio lleva a su primera página.
    if (!hit && route === '') { res.writeHead(302, Object.assign({}, SITE_HEADERS, { location: base + '/' + ctx.tree.flat[0].route, 'cache-control': 'no-store' })); res.end(); return; }
    if (!hit) { page(404, siteNote(lang, 'missing', base + '/'), robots); return; }
    page(200, sitePage(ctx, hit), robots);
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    if (status >= 500) console.error('sitios: error ' + status + ' en ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 80) + ' · ' + String(e && e.stack || e).slice(0, 800));
    if (res.headersSent) { res.end(); return; }
    const extra = e instanceof Fail && e.extra && e.extra.retry_after ? { 'retry-after': String(e.extra.retry_after) } : {};
    if (String(req.url || '').startsWith('/_/report')) send(status, 'application/json; charset=utf-8', JSON.stringify({ error: e instanceof Fail ? e.code : 'server_error' }), extra);
    else send(status, 'text/plain; charset=utf-8', status === 429 ? 'Too many requests' : 'Error', extra);
  }
}
// ====================================================================================================================
// Fin de SITIOS PUBLICADOS
// ====================================================================================================================

// ====================================================================================================================
// ADJUNTOS
// Las imágenes de una nota de la nube no viajan dentro del Markdown: se suben como adjuntos y la nota guarda su
// dirección. Cada adjunto es un archivo bajo DATA_DIR/files/ (nombrado por su identificador, nunca por lo que mandó
// el cliente) y una fila en la tabla files.
//   - La dirección es la llave: /f/<40 hexadecimales> (160 bits al azar). Se sirve sin sesión, para que la imagen se
//     vea en notas compartidas, enlaces públicos, sesiones en vivo, exportaciones y sitios publicados. Quien tiene
//     la dirección ve la imagen, igual que con un enlace público. Nunca desde el host de sitios, nunca con cookies.
//   - Solo imágenes: PNG, JPEG, GIF, WebP y AVIF, reconocidas por sus primeros bytes. Lo que diga la cabecera
//     content-type del pedido no cuenta. SVG no entra: es un documento que puede llevar código.
//   - Carpetas protegidas y espacio de equipo protegido: el navegador cifra la imagen con la llave de la carpeta y
//     acá llegan bytes que no se pueden leer (enc = 1). Esos no se sirven por /f/: los baja la app con su sesión
//     (GET /files/{id}/raw) y los descifra en memoria. Como el servidor no puede leer las notas que los nombran,
//     la app declara, al guardar cada nota protegida, qué adjuntos cifrados usa (PUT /files/refs: solo identificadores).
//   - Topes por plan: peso por imagen y almacenamiento total del espacio. El espacio que se va a ocupar se reserva
//     antes de recibir, para que varias subidas a la vez no pasen el total entre todas.
//   - Limpieza: un barrido mira qué adjuntos siguen nombrados en alguna nota, versión del historial o nota de la
//     papelera. El que no, queda marcado y deja de contar en el uso; pasados FILES_GRACE_DAYS se borra. De
//     los cifrados se mira lo que declaró la app: el que ninguna nota declara corre la misma suerte.
// Variables:
//   FILE_MAX_FREE_MB, FILE_MAX_PAID_MB    peso máximo de una imagen (también un GIF) en el plan gratis y en el pago (5, 10)
//   FILES_FREE_MB, FILES_PAID_MB          almacenamiento de adjuntos de una cuenta gratis y de una paga (0, 1024). Con 0 el plan gratis no sube imágenes: las enlaza por su dirección
//   FILES_TEAM_SEAT_MB, FILES_TEAM_MB     lo que suma cada persona a la bolsa común de un equipo, y una base fija si se quiere (2048, 0)
//   FILE_UPLOAD_KBPS                      velocidad mínima de una subida, en KB por segundo: más lenta que eso se corta (32)
//   FILES_GRACE_DAYS                      días que un adjunto sin uso espera antes de borrarse (30)
//   FILES_PER_HOUR                        subidas por hora y por cuenta (300)
//   FILES_GETS_MINUTE                     pedidos de imágenes por minuto y por IP (600)
//   FILES_SWEEP_MS, FILES_FRESH_MS, FILES_GRACE_MS   solo para pruebas: cada cuánto corre el barrido, cuánto se
//                                         espera a que una imagen recién subida aparezca en una nota, y el margen
// ====================================================================================================================
const MB = 1048576;
const envMb = (name, def) => { const n = env[name] == null || env[name] === '' ? def : +env[name]; return Math.round((Number.isFinite(n) && n > 0 ? n : def) * MB); };
const envMb0 = (name, def) => { const n = env[name] == null || env[name] === '' ? def : +env[name]; return Math.round((Number.isFinite(n) && n >= 0 ? n : def) * MB); };
const envMs = (name, def) => { const n = +(env[name] || 0); return Number.isFinite(n) && n > 0 ? n : def; };
const FILE_MAX = { free: envMb('FILE_MAX_FREE_MB', 5), pro: envMb('FILE_MAX_PAID_MB', 10) };
// El equipo tiene una bolsa común: lo que suma cada persona. FILES_TEAM_MB le agrega una base fija (0 por defecto).
const FILES_TOTAL = { free: envMb0('FILES_FREE_MB', 0), pro: envMb('FILES_PAID_MB', 1024), team: envMb('FILES_TEAM_MB', 0), seat: envMb('FILES_TEAM_SEAT_MB', 2048) };
// Una subida no depende del minuto que tiene cualquier otro pedido: tiene el tiempo que lleva su tope a la velocidad
// mínima, y se corta antes si viene más lenta que eso o deja de mandar.
const FILE_UPLOAD_BPS = Math.max(1, +(env.FILE_UPLOAD_KBPS || 32) || 32) * 1024;
const FILE_UPLOAD_MS = Math.max(120000, Math.ceil((FILE_MAX.pro + 65536) / FILE_UPLOAD_BPS) * 1000 + 30000);
const FILE_STALL_MS = envMs('FILE_STALL_MS', 20000); const FILE_SLOW_AFTER_MS = envMs('FILE_SLOW_AFTER_MS', 15000);
const fileUploadReq = (req) => req.method === 'POST' && /^\/(api\/v1\/)?files(\?|$)/.test(String(req.url || ''));
const FILES_GRACE_MS = envMs('FILES_GRACE_MS', Math.max(1, +(env.FILES_GRACE_DAYS || 30) || 30) * DAY);
const FILES_FRESH_MS = envMs('FILES_FRESH_MS', HOUR);
const FILES_SWEEP_MS = envMs('FILES_SWEEP_MS', 6 * HOUR);
const FILES_PER_HOUR = Math.max(1, +(env.FILES_PER_HOUR || 300) || 300);
const FILES_GETS_MINUTE = Math.max(1, +(env.FILES_GETS_MINUTE || 600) || 600);
const FILES_MISS_HOUR = 60; // direcciones que no existen, por hora y por IP: después de eso, 429
const FILES_LIST_MAX = 5000; const FILE_SIDE_MAX = 16384; const FILE_DRAIN = Math.max(32 * MB, FILE_MAX.pro + MB);
// Lo que suma el cifrado del navegador a una imagen: nonce (12), etiqueta (16) y el byte que dice de qué tipo es.
const FILE_ENC_EXTRA = 64;
const FILES_DIR = path.join(DATA_DIR, 'files'); const FILES_TMP = path.join(FILES_DIR, 'tmp');
fs.mkdirSync(FILES_TMP, { recursive: true });
// Lo que quedó a medio subir cuando el servidor se detuvo.
for (const name of fs.readdirSync(FILES_TMP)) { try { fs.unlinkSync(path.join(FILES_TMP, name)); } catch (e) { /* lo saca el próximo arranque */ } }
// owner: la cuenta o el espacio del equipo. made_by: quién la subió. enc: 1 si llegó cifrada desde el navegador.
// orphan: desde cuándo ninguna nota la nombra (0 mientras está en uso).
db.exec('CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, made_by INTEGER, type TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, enc INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, orphan INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE INDEX IF NOT EXISTS files_owner ON files (owner, created)');
db.exec('CREATE INDEX IF NOT EXISTS files_hash ON files (owner, hash)');
// Qué adjuntos cifrados usa cada nota protegida, según lo declaró la app. gone: desde cuándo la nota dejó de usarlo
// (0 mientras lo usa). Lo que dejó de usarse se recuerda mientras pueda seguir nombrado en el historial.
db.exec('CREATE TABLE IF NOT EXISTS file_refs (owner INTEGER NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, gone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, path, id))');
db.exec('CREATE INDEX IF NOT EXISTS file_refs_id ON file_refs (owner, id)');

const FILE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
const FILE_ID = /^[0-9a-f]{40}$/;
// Dónde vive un adjunto en el disco. El identificador se revisa acá otra vez: a esta ruta no llega nada del cliente.
const fileAt = (id) => { if (!FILE_ID.test(id)) throw new Fail(404, 'not_found'); return path.join(FILES_DIR, id.slice(0, 2), id); };
const fileUrl = (f) => PUBLIC_URL + '/f/' + f.id + '.' + (f.enc ? 'enc' : FILE_EXT[f.type]);
const fileView = (f) => ({ id: f.id, url: fileUrl(f), type: f.enc ? '' : f.type, size: f.size, width: f.w, height: f.h, created: f.created, encrypted: !!f.enc });
// De qué tipo es, por sus primeros bytes. null: no es una imagen de las que se aceptan.
function fileSniff(b) {
  const txt = (from, to) => b.toString('latin1', from, to);
  if (b.length >= 24 && txt(0, 8) === '\x89PNG\r\n\x1a\n' && txt(12, 16) === 'IHDR') return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', w: 0, h: 0 };
  if (b.length >= 10 && /^GIF8[79]a$/.test(txt(0, 6))) return { type: 'image/gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length >= 16 && txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP' && /^VP8[ LX]$/.test(txt(12, 16))) return { type: 'image/webp', w: 0, h: 0, riff: b.readUInt32LE(4) + 8 };
  if (b.length >= 16 && txt(4, 8) === 'ftyp' && /^avi[fs]$/.test(txt(8, 12)) && b.readUInt32BE(0) >= 16 && b.readUInt32BE(0) <= 4096) return { type: 'image/avif', w: 0, h: 0 };
  return null;
}
// El tope de un espacio: el del plan de la cuenta, o el del equipo más lo que suma cada persona.
function filesQuota(owner) {
  if (owner.plan !== 'pro') return FILES_TOTAL.free;
  const t = teamOfSpace(owner);
  return t ? FILES_TOTAL.team + FILES_TOTAL.seat * q('SELECT COUNT(*) AS n FROM team_members WHERE team = ?').get(t.id).n : FILES_TOTAL.pro;
}
// El uso cuenta lo vivo: lo que ya no nombra ninguna nota espera su borrado sin ocupar lugar.
const filesUsed = (ownerId) => q('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE owner = ? AND orphan = 0').get(ownerId).n;
const filesLimits = (owner) => { const plan = owner.plan === 'pro' ? 'pro' : 'free'; return { plan, file: FILE_MAX[plan], total: filesQuota(owner) }; };
const mbText = (bytes) => { const n = bytes / MB; return (n >= 1024 ? Math.round(n / 102.4) / 10 + ' GB' : Math.round(n * 10) / 10 + ' MB'); };
function fileDrop(id) {
  q('DELETE FROM files WHERE id = ?').run(id); q('DELETE FROM file_refs WHERE id = ?').run(id);
  try { fs.unlinkSync(fileAt(id)); } catch (e) { /* ya no estaba */ }
}
// Todo lo de una cuenta o de un espacio: al eliminar la cuenta.
function filesDropOwner(ownerId) { for (const f of q('SELECT id FROM files WHERE owner = ?').all(ownerId)) fileDrop(f.id); q('DELETE FROM file_refs WHERE owner = ?').run(ownerId); }
// Lo que falta leer de un pedido que ya se va a rechazar: se descarta, para que quien sube reciba la respuesta en
// vez de una conexión cortada. Con un cuerpo enorme no se espera: se corta.
const fileDrain = (req) => new Promise((resolve) => {
  if (req.complete || req.destroyed) { resolve(); return; }
  // Si anuncia más de lo que se está dispuesto a descartar, o deja de mandar, no se lo espera.
  if (+req.headers['content-length'] > FILE_DRAIN) { resolve(); return; }
  let n = 0; const stop = setTimeout(resolve, 4000);
  const done = () => { clearTimeout(stop); resolve(); };
  req.on('data', (c) => { n += c.length; if (n > FILE_DRAIN) { req.destroy(); done(); } });
  req.on('end', done); req.on('error', done); req.on('close', done);
  req.resume();
});
// Recibe el cuerpo a un archivo temporal, de a tramos: nunca queda entero en memoria. Pasado max deja de escribir.
// Devuelve el archivo, el tamaño, el hash y los primeros bytes.
function fileReceive(req, max) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(FILES_TMP, crypto.randomBytes(16).toString('hex'));
    const out = fs.createWriteStream(tmp, { flags: 'wx' }); const hash = crypto.createHash('sha256');
    let size = 0; let head = Buffer.alloc(0); let done = false; let big = false; const t0 = now(); let last = t0;
    // Lenta de más, quieta de más o pasada de tiempo: se corta. Nadie ocupa una conexión mandando de a gotas.
    const watch = setInterval(() => {
      const dt = now() - t0;
      if (now() - last > FILE_STALL_MS || dt > FILE_UPLOAD_MS || (dt > FILE_SLOW_AFTER_MS && size < (dt / 1000) * FILE_UPLOAD_BPS)) { fail(new Fail(408, 'upload_slow', 'The upload was too slow and was cut. Try again on a better connection')); req.destroy(); }
    }, Math.min(2000, Math.max(100, FILE_STALL_MS / 4)));
    watch.unref();
    const fail = (err) => { if (done) return; done = true; clearInterval(watch); out.destroy(); fs.unlink(tmp, () => reject(err)); };
    out.on('error', () => fail(new Fail(500, 'server_error')));
    req.on('data', (c) => {
      if (done) return;
      size += c.length; last = now();
      if (size > max) {
        if (!big) { big = true; out.destroy(); }
        if (size > FILE_DRAIN) { req.destroy(); fail(new Fail(413, 'file_too_large')); }
        return;
      }
      if (head.length < 64) head = Buffer.concat([head, c.subarray(0, 64 - head.length)]);
      hash.update(c);
      if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      if (done) return;
      if (big) { fail(new Fail(413, 'file_too_large')); return; }
      out.end(() => { if (done) return; done = true; clearInterval(watch); resolve({ tmp, size, hash: hash.digest('hex'), head }); });
    });
    req.on('error', () => fail(new Fail(400, 'bad_request')));
    req.on('close', () => { if (!req.complete) fail(new Fail(400, 'bad_request')); });
  });
}
const filesHeld = new Map(); // bytes reservados por las subidas en curso de cada espacio
// Sube una imagen al espacio de owner. who es quien la sube (para el tope de pedidos y el registro).
async function fileUpload(req, who, owner, enc) {
  const lim = filesLimits(owner);
  const refuse = async (err) => { await fileDrain(req); throw err; };
  const tooBig = (max) => new Fail(413, 'file_too_large', 'An image can weigh up to ' + mbText(max) + ' on this plan', { max, plan: lim.plan });
  const full = (used) => new Fail(413, 'storage_full', 'The image storage of this plan is full (' + mbText(lim.total) + ')', { used, max: lim.total, plan: lim.plan });
  try { rate('files:put:' + who.id, FILES_PER_HOUR, HOUR, 'too_many'); } catch (e) { await refuse(e); }
  if (enc && !q('SELECT 1 FROM vaults WHERE user = ? LIMIT 1').get(owner.id)) await refuse(new Fail(409, 'vault', 'Encrypted images belong to a folder protected with a password'));
  if (!lim.total && lim.plan === 'free') await refuse(new Fail(402, 'files_need_plan', 'Uploading images belongs to the paid plan. A note can still show an image by its address', { plan: 'free' }));
  // Un espacio de equipo protegido solo recibe imágenes cifradas.
  if (!enc && sealing(q("SELECT * FROM vaults WHERE user = ? AND folder = ''").get(owner.id))) await refuse(new Fail(409, 'vault', 'This space is protected with a password: its images are encrypted in the browser'));
  const max = lim.file + (enc ? FILE_ENC_EXTRA : 0);
  const declared = +req.headers['content-length'];
  if (Number.isFinite(declared) && declared > max) await refuse(tooBig(lim.file));
  const hold = Number.isFinite(declared) && declared > 0 ? declared : max;
  if (filesUsed(owner.id) + (filesHeld.get(owner.id) || 0) + hold > lim.total) await refuse(full(filesUsed(owner.id)));
  filesHeld.set(owner.id, (filesHeld.get(owner.id) || 0) + hold);
  let got = null;
  try {
    try { got = await fileReceive(req, max); } catch (e) { throw e instanceof Fail && e.code === 'file_too_large' ? tooBig(lim.file) : e; }
    let kind = { type: 'application/octet-stream', w: 0, h: 0 };
    if (enc) { if (got.size < 30) throw new Fail(415, 'bad_image', 'That is not an image SharpMD can store'); }
    else {
      kind = fileSniff(got.head);
      const side = (n) => n >= 1 && n <= FILE_SIDE_MAX;
      if (!kind || ((kind.type === 'image/png' || kind.type === 'image/gif') && !(side(kind.w) && side(kind.h))) || (kind.riff && Math.abs(kind.riff - got.size) > 1)) throw new Fail(415, 'bad_image', 'That is not an image SharpMD can store: PNG, JPEG, GIF, WebP or AVIF');
    }
    // La misma imagen subida otra vez al mismo espacio es el mismo adjunto.
    const twin = enc ? null : q('SELECT * FROM files WHERE owner = ? AND hash = ? AND enc = 0').get(owner.id, got.hash);
    if (twin) { if (twin.orphan) q('UPDATE files SET orphan = 0, created = ? WHERE id = ?').run(now(), twin.id); return Object.assign(fileView(twin), { used: filesUsed(owner.id), max: lim.total }); }
    if (filesUsed(owner.id) + got.size > lim.total) throw full(filesUsed(owner.id));
    const id = crypto.randomBytes(20).toString('hex'); const at = fileAt(id);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.renameSync(got.tmp, at); got.tmp = '';
    const row = { id, owner: owner.id, made_by: who.id || null, type: kind.type, size: got.size, hash: got.hash, enc: enc ? 1 : 0, w: kind.w || 0, h: kind.h || 0, created: now(), orphan: 0 };
    try { q('INSERT INTO files (id, owner, made_by, type, size, hash, enc, w, h, created, orphan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(row.id, row.owner, row.made_by, row.type, row.size, row.hash, row.enc, row.w, row.h, row.created); }
    catch (e) { try { fs.unlinkSync(at); } catch (x) { /* nada que quitar */ } throw e; }
    return Object.assign(fileView(row), { used: filesUsed(owner.id), max: lim.total });
  } finally {
    if (got && got.tmp) { try { fs.unlinkSync(got.tmp); } catch (e) { /* ya no estaba */ } }
    const left = (filesHeld.get(owner.id) || 0) - hold;
    if (left > 0) filesHeld.set(owner.id, left); else filesHeld.delete(owner.id);
  }
}
// Qué adjuntos están nombrados en el texto de las notas, del historial y de la papelera. Con ownerId, solo en ese
// espacio; sin él, en todo el servidor (una nota que se mudó a otro espacio sigue nombrando la imagen del primero).
// under: solo las notas dentro de esa carpeta. Una fila que no se puede leer corta todo: sin saber qué nombra, no se borra nada.
const FILE_REF = /\/f\/([0-9a-f]{40})/g;
const FILE_SCANS = [
  { column: 'notes.text', all: 'SELECT path, text, e FROM notes', own: 'SELECT path, text, e FROM notes WHERE user = ?' },
  { column: 'versions.text', all: 'SELECT path, text, e FROM versions', own: 'SELECT path, text, e FROM versions WHERE user = ?' },
  { column: 'trash.text', all: 'SELECT path, text, e FROM trash', own: 'SELECT path, text, e FROM trash WHERE user = ?' },
];
function filesRefs(ownerId, under) {
  const seen = new Set();
  for (const scan of under ? FILE_SCANS.slice(0, 1) : FILE_SCANS) {
    const st = q(ownerId == null ? scan.all : scan.own); const column = scan.column;
    for (const r of ownerId == null ? st.iterate() : st.iterate(ownerId)) {
      if (under && !r.path.startsWith(under + '/')) continue;
      const text = String(unseal(r.text, r.e, column) || '');
      if (text.indexOf('/f/') === -1) continue;
      for (const m of text.matchAll(FILE_REF)) seen.add(m[1]);
    }
  }
  return seen;
}
let filesSwept = 0; // cuándo corrió el último barrido completo
// Lo declarado se pone al día: una nota que ya no existe (ni está en la papelera) deja de usar sus adjuntos, y lo
// que una nota dejó de usar se olvida cuando ya no puede estar en su historial.
function fileRefsSweep() {
  q('UPDATE file_refs SET gone = ? WHERE gone = 0 AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.user = file_refs.owner AND n.path = file_refs.path) AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.user = file_refs.owner AND t.path = file_refs.path)').run(now());
  const keep = env.FILES_GRACE_MS ? FILES_GRACE_MS : Math.max(HISTORY_DAYS, TEAM_HISTORY_DAYS) * DAY;
  q('DELETE FROM file_refs WHERE gone > 0 AND gone < ? AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.user = file_refs.owner AND v.path = file_refs.path)').run(now() - FILES_FRESH_MS);
  q('DELETE FROM file_refs WHERE gone > 0 AND gone < ?').run(now() - keep);
}
// PUT /files/refs { path, ids }: la app dice qué adjuntos cifrados usa una nota protegida. Solo identificadores.
function fileRefsPut(owner, body) {
  const p = cleanPath(body.path);
  if (!Array.isArray(body.ids) || body.ids.length > 2000 || body.ids.some((x) => typeof x !== 'string' || !FILE_ID.test(x))) throw new Fail(400, 'bad_ids', 'ids is a list of attachment ids');
  const ids = Array.from(new Set(body.ids));
  // Con algo que declarar, la nota tiene que existir y estar en una carpeta protegida. Vaciar la lista vale siempre.
  if (ids.length && (!vaultOf(owner.id, p) || !q('SELECT 1 FROM notes WHERE user = ? AND path = ?').get(owner.id, p))) throw new Fail(409, 'vault', 'Only notes of a protected folder declare encrypted images');
  const mine = new Set(ids.length ? q('SELECT id FROM files WHERE owner = ? AND enc = 1').all(owner.id).map((x) => x.id) : []);
  const use = ids.filter((x) => mine.has(x));
  db.exec('BEGIN');
  try {
    for (const row of q('SELECT id FROM file_refs WHERE owner = ? AND path = ? AND gone = 0').all(owner.id, p)) if (!use.includes(row.id)) q('UPDATE file_refs SET gone = ? WHERE owner = ? AND path = ? AND id = ?').run(now(), owner.id, p, row.id);
    for (const id of use) { q('INSERT INTO file_refs (owner, path, id, gone) VALUES (?, ?, ?, 0) ON CONFLICT (owner, path, id) DO UPDATE SET gone = 0').run(owner.id, p, id); q('UPDATE files SET orphan = 0 WHERE id = ? AND orphan != 0').run(id); }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true, path: p, ids: use };
}
function filesSweep() {
  fileRefsSweep();
  const rows = q('SELECT id, owner, size, created, orphan, enc FROM files').all();
  if (rows.length) {
    let refs = null; const declared = new Set(q('SELECT DISTINCT id FROM file_refs').all().map((x) => x.id));
    try { refs = filesRefs(null); } catch (e) { console.error('adjuntos: el barrido no pudo leer las notas y no borró nada · ' + String(e && e.message || e).slice(0, 200)); return; }
    const waiting = new Map();
    for (const f of rows) {
      if (f.enc ? declared.has(f.id) : refs.has(f.id)) { if (f.orphan) q('UPDATE files SET orphan = 0 WHERE id = ?').run(f.id); continue; }
      if (!f.orphan) { if (now() - f.created > FILES_FRESH_MS) { f.orphan = now(); q('UPDATE files SET orphan = ? WHERE id = ?').run(f.orphan, f.id); } else continue; }
      if (now() - f.orphan > FILES_GRACE_MS) { fileDrop(f.id); continue; }
      if (!waiting.has(f.owner)) waiting.set(f.owner, []);
      waiting.get(f.owner).push(f);
    }
    // Lo que espera su borrado no puede pasar el tope del espacio: si lo pasa, se van primero los más viejos.
    for (const [ownerId, list] of waiting) {
      const owner = userById(ownerId); const max = owner ? filesQuota(owner) : 0;
      let sum = list.reduce((n, f) => n + f.size, 0);
      for (const f of list.sort((a, b) => a.orphan - b.orphan)) { if (sum <= max) break; fileDrop(f.id); sum -= f.size; }
    }
  }
  // Los adjuntos de una cuenta que ya no existe, y lo que quedó a medio subir hace más de una hora.
  for (const f of q('SELECT id FROM files WHERE owner NOT IN (SELECT id FROM users)').all()) fileDrop(f.id);
  try { for (const name of fs.readdirSync(FILES_TMP)) { const at = path.join(FILES_TMP, name); if (now() - fs.statSync(at).mtimeMs > HOUR) fs.unlinkSync(at); } } catch (e) { /* el próximo barrido */ }
  filesSwept = now();
}
setInterval(() => { try { filesSweep(); } catch (e) { console.error('adjuntos: falló el barrido · ' + String(e && e.stack || e).slice(0, 600)); } }, FILES_SWEEP_MS).unref();
// La lista de un espacio, con su uso y sus topes. in_use: si alguna nota la nombra (en las cifradas, si alguna la declaró).
function filesList(owner, under) {
  const lim = filesLimits(owner); const mine = filesRefs(owner.id, under); const declared = new Set(q('SELECT DISTINCT id FROM file_refs WHERE owner = ? AND gone = 0').all(owner.id).map((x) => x.id));
  let rows = q('SELECT * FROM files WHERE owner = ? ORDER BY created DESC, id LIMIT ?').all(owner.id, FILES_LIST_MAX);
  // Un token limitado a una carpeta solo ve las imágenes que nombran las notas de esa carpeta.
  if (under) rows = rows.filter((f) => !f.enc && mine.has(f.id));
  const seenElsewhere = (f) => !f.orphan && filesSwept > 0 && f.created < filesSwept - FILES_FRESH_MS;
  const all = q('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM files WHERE owner = ?').get(owner.id);
  return { used: filesUsed(owner.id), max: lim.total, max_file: lim.file, plan: lim.plan, count: under ? rows.length : all.n, stored: under ? rows.reduce((n, f) => n + f.size, 0) : all.size, grace_days: Math.round(FILES_GRACE_MS / DAY),
    files: rows.map((f) => Object.assign(fileView(f), { in_use: f.enc ? declared.has(f.id) : mine.has(f.id) || seenElsewhere(f), waiting: !!f.orphan })) };
}
// Rutas de la app, con la sesión. o: el espacio del equipo.
async function filesRoute(req, user, p, m, url) {
  const o = url.searchParams.get('o');
  if (p === '/files' && m === 'GET') { rate('files:list:' + user.id, 1200, HOUR, 'too_many'); return filesList(spaceOf(user, o)); }
  if (p === '/files/refs' && m === 'PUT') { rate('files:refs:' + user.id, 3000, HOUR, 'too_many'); const body = await readBody(req); return fileRefsPut(spaceOf(user, o, 'edit'), body); }
  if (p === '/files' && m === 'POST') {
    let owner = null;
    try { owner = spaceOf(user, o, 'edit'); teamHold(user, owner); } catch (e) { await fileDrain(req); throw e; }
    const out = await fileUpload(req, user, owner, url.searchParams.get('enc') === '1');
    if (owner !== user) teamLog(user.team, user, 'attach', '', out.id.slice(0, 8));
    return out;
  }
  const fm = /^\/files\/([0-9a-f]{40})(\/raw)?$/.exec(p);
  if (!fm) throw new Fail(404, 'no_route');
  if (fm[2] && m === 'GET') {
    // Los bytes de una imagen cifrada, para quien puede leer ese espacio. El navegador los descifra.
    const f = q('SELECT * FROM files WHERE id = ? AND owner = ? AND enc = 1').get(fm[1], spaceOf(user, o).id);
    if (!f) throw new Fail(404, 'not_found');
    return { __file: f };
  }
  if (!fm[2] && m === 'DELETE') {
    const owner = spaceOf(user, o, 'edit');
    const f = q('SELECT id, enc FROM files WHERE id = ? AND owner = ?').get(fm[1], owner.id);
    if (!f) throw new Fail(404, 'not_found');
    // unused=1: solo si ninguna nota de ese espacio la nombra (la app lo pide tras cifrar las imágenes de una nota).
    if (url.searchParams.get('unused') === '1') { rate('files:unused:' + user.id, 6000, HOUR, 'too_many'); if (f.enc ? !!q('SELECT 1 FROM file_refs WHERE owner = ? AND id = ? AND gone = 0 LIMIT 1').get(owner.id, f.id) : filesRefs(owner.id).has(f.id)) throw new Fail(409, 'in_use', 'A note still uses this image'); }
    fileDrop(f.id);
    if (owner !== user) teamLog(user.team, user, 'detach', '', f.id.slice(0, 8));
    return { ok: true, used: filesUsed(owner.id), max: filesQuota(owner) };
  }
  throw new Fail(404, 'no_route');
}
// La API con token: listar y subir. Con ?space=team, el espacio del equipo de quien es el token (si la política
// del equipo deja que su IA lo alcance). Un token del equipo trabaja siempre sobre el espacio. No hay imágenes
// cifradas por acá: un token no tiene la llave de una carpeta protegida.
async function filesApi(req, url, r, m, user) {
  const ok = (data) => ({ ok: true, data });
  const write = m === 'POST';
  let owner = user; let team = null;
  try {
    if (r !== '/files' || (m !== 'GET' && m !== 'POST')) throw new Fail(404, 'no_route');
    if (user.teamToken) { team = user.teamToken.team; if (write && !user.canWrite) throw new Fail(403, 'read_only', 'This token can only read'); }
    else if (url.searchParams.get('space') === 'team') {
      team = user.team;
      if (!team || !teamAllows(team, user, 'tokens')) throw new Fail(403, 'no_access', 'This token does not reach the team space');
      if (write && !teamAllows(team, user, 'write')) throw new Fail(403, 'read_only', 'This account can only read the team space');
      owner = userById(team.space);
    } else if (url.searchParams.has('space') && url.searchParams.get('space') !== 'me') throw new Fail(400, 'bad_space', 'space is "team", or nothing for your own');
  } catch (e) { if (write) await fileDrain(req); throw e; }
  if (m === 'GET') {
    const out = filesList(owner, user.scope || '');
    return ok({ used: out.used, max: out.max, max_file: out.max_file, count: out.count, files: out.files.map((f) => ({ id: f.id, url: f.url, type: f.type, size: f.size, created: iso(f.created), encrypted: f.encrypted, in_use: f.in_use })) });
  }
  const out = await fileUpload(req, user, owner, false);
  if (team) teamLog(team, user, 'attach', '', out.id.slice(0, 8));
  return ok({ id: out.id, url: out.url, type: out.type, size: out.size, markdown: '![](' + out.url + ')' });
}
// Las cabeceras de toda imagen servida: el tipo es el que se reconoció al subir, el navegador no adivina otro, y
// aunque alguien la abra sola en una pestaña no corre nada.
const FILE_HEADERS = { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };
// GET /f/<id>: sin sesión, sin CORS con credenciales, sin cookies. Devuelve true si el pedido era de acá.
function fileServe(req, res) {
  const raw = String(req.url || ''); const qi = raw.indexOf('?'); const p = qi === -1 ? raw : raw.slice(0, qi);
  if (!p.startsWith('/f/')) return false;
  const deny = (status, extra) => { res.writeHead(status, Object.assign({}, FILE_HEADERS, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-length': 0 }, extra || {})); res.end(); return true; };
  if (req.method === 'OPTIONS') return deny(204, { 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '86400' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, { allow: 'GET, HEAD' });
  const ip = clientIp(req);
  try { rate('files:get:' + ip, FILES_GETS_MINUTE, 60000, 'rate_limited'); limit('files:miss:' + ip, FILES_MISS_HOUR, HOUR, 'rate_limited'); }
  catch (e) { return deny(429, { 'retry-after': String((e.extra && e.extra.retry_after) || 60) }); }
  const m = /^\/f\/([0-9a-f]{40})(?:\.(png|jpg|gif|webp|avif))?$/.exec(p);
  // Una cifrada no existe por acá, y la respuesta es la misma que para una dirección inventada.
  const f = m ? q('SELECT id, type, size, hash FROM files WHERE id = ? AND enc = 0').get(m[1]) : null;
  if (!f || !FILE_EXT[f.type] || (m[2] && m[2] !== FILE_EXT[f.type])) { mark('files:miss:' + ip); return deny(404); }
  const etag = '"' + f.hash.slice(0, 32) + '"';
  const head = Object.assign({}, FILE_HEADERS, { 'content-type': f.type, 'content-disposition': 'inline; filename="image.' + FILE_EXT[f.type] + '"', 'cache-control': 'public, max-age=31536000, immutable', etag });
  if (String(req.headers['if-none-match'] || '').split(',').map((v) => v.trim().replace(/^W\//, '')).includes(etag)) { res.writeHead(304, head); res.end(); return true; }
  head['content-length'] = f.size;
  if (req.method === 'HEAD') { res.writeHead(200, head); res.end(); return true; }
  const stream = fs.createReadStream(fileAt(f.id));
  stream.on('open', () => { res.writeHead(200, head); stream.pipe(res); });
  stream.on('error', () => { if (res.headersSent) res.destroy(); else deny(404); });
  res.on('close', () => stream.destroy());
  return true;
}
// Los bytes de una imagen cifrada, para la app: un archivo que el navegador no muestra ni interpreta.
function fileSend(res, f) {
  const stream = fs.createReadStream(fileAt(f.id));
  stream.on('open', () => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="image.bin"', 'content-length': f.size, 'content-security-policy': "default-src 'none'; sandbox" }); stream.pipe(res); });
  stream.on('error', () => { if (res.headersSent) res.destroy(); else { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'not_found', message: '' })); } });
  res.on('close', () => stream.destroy());
}
// ====================================================================================================================
// Fin de ADJUNTOS
// ====================================================================================================================

// ---------- Anonymous counts: the visits and the steps after them ----------
// The site and the web app say that something happened (a page was seen, the app was opened, a first note was made)
// and which channel the visit came from ("reddit", "direct"). That adds one to a counter per day, step, page, channel
// and headline, and nothing else: no IP, no header and no identifier is stored, and no row says who or which browser.
// The limit per IP lives in memory, like the others, and is lost on restart.
// The steps of an account (it signed up, its first cloud note, its first token, its first share, its first payment) are
// counted here, when they happen, once per account, under the channel the account came from. That channel is the only
// thing kept on the account (users.source): a label many accounts share, not an identifier.
// The counts are of events and not of people: nobody is followed from one step to the next, so the steps of a period
// are not the same group of visitors.
//   POST /stats   { e: 'view' | ['app_open', 'first_open'], p: 'home', s: 'reddit', v: 'a' }   (also at /landing, its old name)
//   GET /admin/funnel?days=7&source=reddit&format=text   (x-admin-key)
const STAT_SOURCES = ['direct', 'other', 'unknown', 'reddit', 'linkedin', 'whatsapp', 'telegram', 'twitter', 'github', 'google', 'bing', 'duckduckgo', 'youtube', 'hackernews', 'producthunt', 'chrome-web-store', 'play-store'];
const STAT_SITE = ['home', 'mcp', 'wysiwyg'];
// What a browser may count, and from which page. The steps of an account are not here: nobody can send them.
const STAT_CLIENT = { view: STAT_SITE.concat('pay'), open: STAT_SITE, plans: STAT_SITE, checkout_open: ['pay'], app_open: ['app'], first_open: ['app'], note_created: ['app'], edited: ['app'] };
// A link can bring its own channel (utm_source=newsletter). Only so many new ones a day: the rest count as "other".
const STAT_SOURCES_DAY = +(env.STATS_SOURCES_DAY || 30);
const STAT_BIT = { cloud: 1, token: 2, shared: 4, paid: 8, team: 16 };
const LANDING_PER_HOUR = +(env.LANDING_PER_HOUR || 60);
db.exec("CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, step TEXT NOT NULL, page TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, step, page, source, variant))");
// The counter the home page had (landing_stats: day, v, e, n) moves into stats with what it had counted. Its name stays
// as a view with the same columns, for whoever reads it.
{
  const old = q("SELECT type FROM sqlite_master WHERE name = 'landing_stats'").get();
  if (old && old.type === 'table') {
    db.exec('BEGIN');
    try {
      db.exec("INSERT INTO stats (day, step, page, source, variant, n) SELECT day, e, 'home', 'unknown', v, n FROM landing_stats WHERE true ON CONFLICT (day, step, page, source, variant) DO UPDATE SET n = n + excluded.n");
      db.exec('DROP TABLE landing_stats');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.exec("CREATE VIEW IF NOT EXISTS landing_stats AS SELECT day, variant AS v, step AS e, SUM(n) AS n FROM stats WHERE page = 'home' AND step IN ('view', 'open') AND variant IN ('a', 'b') GROUP BY day, variant, step");
}
try { db.exec('ALTER TABLE users ADD COLUMN source TEXT'); } catch (e) { /* ya estaba */ }
// Which of its steps an account already counted. The accounts from before start with what they had already done.
try {
  db.exec('ALTER TABLE users ADD COLUMN funnel INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE users SET funnel = (CASE WHEN EXISTS (SELECT 1 FROM notes WHERE notes.user = users.id) THEN 1 ELSE 0 END) | (CASE WHEN EXISTS (SELECT 1 FROM tokens WHERE tokens.user = users.id) THEN 2 ELSE 0 END)' +
    ' | (CASE WHEN EXISTS (SELECT 1 FROM shares WHERE shares.owner = users.id) OR EXISTS (SELECT 1 FROM links WHERE links.owner = users.id) THEN 4 ELSE 0 END)' +
    ' | (CASE WHEN EXISTS (SELECT 1 FROM paddle_subs WHERE paddle_subs.user = users.id) THEN 8 ELSE 0 END) | (CASE WHEN EXISTS (SELECT 1 FROM teams WHERE teams.owner = users.id) THEN 16 ELSE 0 END)');
} catch (e) { /* ya estaba */ }
const statDay = () => new Date(now()).toISOString().slice(0, 10);
// A channel: one of the list, or the label a link brought, already cleaned by the page. Anything else is not counted
// (strict) or counts as unknown. Past the limit of new labels of the day, "other".
function statSource(v, strict) {
  if (v == null || v === '') return 'unknown';
  if (typeof v !== 'string' || !/^[a-z0-9-]{1,24}$/.test(v)) { if (strict) throw new Fail(400, 'bad_source'); return 'unknown'; }
  if (STAT_SOURCES.includes(v)) return v;
  const day = statDay();
  if (q('SELECT 1 FROM stats WHERE day = ? AND source = ? LIMIT 1').get(day, v)) return v;
  const seen = q('SELECT DISTINCT source FROM stats WHERE day = ?').all(day).filter((r) => !STAT_SOURCES.includes(r.source)).length;
  return seen < STAT_SOURCES_DAY ? v : 'other';
}
// Counting never breaks what was being done.
function statAdd(step, source, page, variant) {
  try { q('INSERT INTO stats (day, step, page, source, variant, n) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (day, step, page, source, variant) DO UPDATE SET n = n + 1').run(statDay(), step, page || '', source, variant || ''); }
  catch (e) { console.error('stats: ' + String(e && e.message).slice(0, 200)); }
}
// A step of an account, the first time only. The space of a team is not a person: it does not count.
function statOnce(id, bit, step) {
  try {
    const u = q('SELECT email, source, funnel FROM users WHERE id = ?').get(id);
    if (!u || (Number(u.funnel) & bit) || u.email.startsWith('team:')) return;
    q('UPDATE users SET funnel = funnel | ? WHERE id = ?').run(bit, id);
    statAdd(step, u.source || 'unknown');
  } catch (e) { console.error('stats: ' + String(e && e.message).slice(0, 200)); }
}
async function statsHit(req) {
  rate('landing:' + clientIp(req), LANDING_PER_HOUR, HOUR, 'too_many');
  // The body arrives as plain text (sendBeacon cannot send application/json without a preflight): it is read anyway.
  let b = null; try { b = JSON.parse(String(await readRaw(req, 200))); } catch (e) { if (e instanceof Fail) throw e; throw new Fail(400, 'bad_json'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Fail(400, 'bad_event');
  // The home page published before this sends only the headline and the event: it is the page "home", with no channel.
  const events = Array.isArray(b.e) ? b.e : [b.e]; const page = b.p == null ? 'home' : b.p; const variant = b.v == null ? '' : b.v;
  if (!events.length || events.length > 4 || new Set(events).size !== events.length) throw new Fail(400, 'bad_event');
  if (events.some((e) => typeof e !== 'string' || !Object.hasOwn(STAT_CLIENT, e) || !STAT_CLIENT[e].includes(page))) throw new Fail(400, 'bad_event');
  if (variant !== '' && (page !== 'home' || (variant !== 'a' && variant !== 'b'))) throw new Fail(400, 'bad_event');
  const source = statSource(b.s, true);
  for (const e of events) statAdd(e, source, page, variant);
  return { __status: 204 };
}
// The steps, in order. Each rate is the count of the step over the count of the one before, in the same period.
const FUNNEL = [['view', 'Visits'], ['open', 'Clicked open'], ['app_open', 'App opened'], ['first_open', 'First open'], ['note_created', 'First note'], ['edited', 'First edit'], ['signin_start', 'Asked for code'],
  ['signed_up', 'Signed up'], ['cloud_first', 'First cloud note'], ['ai_token', 'AI token'], ['shared', 'Shared'], ['checkout_open', 'Opened checkout'], ['paid', 'Paid']];
const FUNNEL_EXTRA = ['plans', 'pay_view', 'signed_in', 'team_started'];
function funnelAdmin(url) {
  const days = Math.min(3650, Math.max(1, Math.floor(+(url.searchParams.get('days') || 7)) || 7));
  const only = url.searchParams.get('source') || '';
  if (only && !/^[a-z0-9-]{1,24}$/.test(only)) throw new Fail(400, 'bad_source');
  const to = statDay(); const from = new Date(now() - (days - 1) * DAY).toISOString().slice(0, 10);
  // The payment page seen is not a visit: it is counted apart.
  const rows = q("SELECT day, CASE WHEN step = 'view' AND page = 'pay' THEN 'pay_view' ELSE step END AS step, source, SUM(n) AS n FROM stats WHERE day >= ? AND day <= ? AND (? = '' OR source = ?) GROUP BY 1, 2, 3").all(from, to, only, only);
  const blank = () => Object.fromEntries(FUNNEL.map((f) => f[0]).concat(FUNNEL_EXTRA).map((k) => [k, 0]));
  const total = blank(); const sources = new Map(); const daily = new Map();
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) daily.set(new Date(t).toISOString().slice(0, 10), blank());
  for (const r of rows) {
    if (!(r.step in total)) continue;
    const n = Number(r.n); total[r.step] += n;
    if (!sources.has(r.source)) sources.set(r.source, blank());
    sources.get(r.source)[r.step] += n;
    if (daily.has(r.day)) daily.get(r.day)[r.step] += n;
  }
  const shape = (c) => ({
    steps: FUNNEL.map((f, i) => ({ step: f[0], label: f[1], n: c[f[0]], rate: i && c[FUNNEL[i - 1][0]] ? Math.round((c[f[0]] / c[FUNNEL[i - 1][0]]) * 10000) / 10000 : null })),
    extra: Object.fromEntries(FUNNEL_EXTRA.map((k) => [k, c[k]])),
  });
  const list = Array.from(sources).sort((a, b) => b[1].view - a[1].view || b[1].app_open - a[1].app_open || b[1].signed_up - a[1].signed_up || (a[0] < b[0] ? -1 : 1));
  if (url.searchParams.get('format') === 'text') {
    const pct = (r) => (r == null ? '' : '  ' + Math.round(r * 100) + '%');
    const short = [['view', 'visits'], ['app_open', 'app'], ['first_open', 'new'], ['note_created', 'note'], ['signin_start', 'code'], ['signed_up', 'signup'], ['cloud_first', 'cloud'], ['paid', 'paid']];
    const lines = ['SharpMD funnel, last ' + days + (days === 1 ? ' day' : ' days') + ' (' + from + ' to ' + to + ')' + (only ? ', source ' + only : ''), 'Counts of events, not of people.', '', 'TOTAL']
      .concat(shape(total).steps.map((s) => s.label.padEnd(17) + String(s.n).padStart(6) + pct(s.rate)));
    if (!only && list.length) {
      lines.push('', 'BY SOURCE', short.map((s) => s[1]).join(' > '));
      for (const [name, c] of list.slice(0, 12)) lines.push(name.padEnd(17) + short.map((s) => c[s[0]]).join(' > '));
    }
    return { __text: lines.join('\n') + '\n' };
  }
  return { from, to, days, source: only || null, total: shape(total), sources: list.map(([source, c]) => Object.assign({ source }, shape(c))), daily: Array.from(daily).map(([day, c]) => Object.assign({ day }, c)) };
}
// The totals per variant, with the open/view rate. ?days=N looks at the last N days only.
function landingAdmin(url) {
  const days = Math.min(3650, Math.max(0, Math.floor(+url.searchParams.get('days') || 0)));
  const from = days ? new Date(now() - (days - 1) * DAY).toISOString().slice(0, 10) : '';
  const rows = q('SELECT v, e, SUM(n) AS n, MIN(day) AS first, MAX(day) AS last FROM landing_stats WHERE day >= ? GROUP BY v, e').all(from);
  const variants = { a: { view: 0, open: 0, rate: null }, b: { view: 0, open: 0, rate: null } };
  let first = null; let last = null;
  for (const r of rows) { if (!variants[r.v]) continue; variants[r.v][r.e] = Number(r.n); if (!first || r.first < first) first = r.first; if (!last || r.last > last) last = r.last; }
  for (const k in variants) variants[k].rate = variants[k].view ? Math.round((variants[k].open / variants[k].view) * 10000) / 10000 : null;
  return { from: first, to: last, variants };
}

async function route(req, url) {
  const p = url.pathname; const m = req.method;
  if (p === '/health') return { ok: true };
  if ((p === '/stats' || p === '/landing') && m === 'POST') return statsHit(req);
  // Automatizaciones: la API con token y las direcciones de entrada.
  if (p.startsWith('/api/v1/')) return apiRoute(req, url, p, m);
  if (p.startsWith('/in/')) return inboxRoute(req, url, p, m);
  if (p === '/auth/start' && m === 'POST') return authStart(req, await readBody(req));
  if (p === '/auth/verify' && m === 'POST') return authVerify(req, await readBody(req));
  if (p === '/paddle/webhook' && m === 'POST') return paddleWebhook(req);
  if (p === '/feedback' && m === 'POST') return feedback(req, await readBody(req));
  if (((p === '/admin/plan' || p === '/admin/team') && m === 'POST') || p === '/admin/gallery' || p === '/admin/sites' || ((p === '/admin/landing' || p === '/admin/funnel' || p === '/admin/feedback') && m === 'GET')) {
    // La misma respuesta sin clave configurada, sin clave en el pedido o con una equivocada. Diez fallos por hora por IP.
    const ip = 'admin:' + clientIp(req);
    limit(ip, 10, HOUR, 'too_many');
    if (!env.ADMIN_KEY || !same(req.headers['x-admin-key'] || '', env.ADMIN_KEY)) { mark(ip); throw new Fail(403, 'forbidden'); }
    if (p === '/admin/gallery') return galleryAdmin(m, url, m === 'POST' ? await readBody(req) : {});
    if (p === '/admin/sites') return sitesAdmin(m, url, m === 'POST' ? await readBody(req) : {});
    if (p === '/admin/landing') return landingAdmin(url);
    if (p === '/admin/funnel') return funnelAdmin(url);
    if (p === '/admin/feedback') return feedbackAdmin(url);
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
    const body = await readAny(req);
    // Un lote largo son muchas consultas seguidas a la base, que atiende de a un pedido: tiene tope.
    if (Array.isArray(body) && body.length > MAX_BATCH) throw new Fail(413, 'too_large');
    const out = Array.isArray(body) ? body.map((x) => mcp(user, x)).filter(Boolean) : mcp(user, body);
    return out == null || (Array.isArray(out) && !out.length) ? { __status: 202 } : out;
  }
  if (p === '/gallery' || p.startsWith('/gallery/')) { const out = await galleryRoute(req, url, p, m); if (out) return out; }
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
    // De quién es la nota: propia, o del espacio del equipo de quien llama (o). Un miembro ve la sesión y dice en
    // qué bloque está; la maneja quien la abrió y quien administra el equipo.
    const owner = spaceOf(user, m === 'POST' ? body.o : url.searchParams.get('o')); const team = owner.id !== user.id ? user.team : null;
    let row = liveRow(owner.id, cleanPath(m === 'POST' ? body.path : url.searchParams.get('path')));
    if (row && team && !liveCan(row)) { liveEnd(row, 'closed'); row = null; }
    if (p === '/live' && m === 'GET') return row ? liveView(row, user) : { open: false };
    if (!row) throw new Fail(404, 'live_gone');
    if (p === '/live/presence' && m === 'POST') {
      // Quien solo lee figura en el bloque que mira, sin tomarlo.
      if (team && !teamAllows(team, user, 'write')) body.editing = false;
      return livePresence(row, liveSeat(row, user.id), livePid(row, user.id), body);
    }
    if (team) {
      if (liveOpener(row) !== user.id && !teamAllows(team, user, 'admin')) throw new Fail(403, teamAllows(team, user, 'write') ? 'not_opener' : 'read_only', 'Only whoever opened the session or an administrator of the team can do that');
      rate('lteam:' + team.id, LIVE_TEAM_HOUR, HOUR, 'too_many');
    }
    if (p === '/live' && m === 'DELETE') { liveEnd(row, 'closed', user); return { ok: true }; }
    if (p === '/live/rotate' && m === 'POST') return { secret: liveRotate(row) };
    if (p === '/live/kick' && m === 'POST') return liveKick(row, body.id, user);
  }
  if (p === '/team' || p.startsWith('/team/')) return teamRoute(user, p, m, req);
  if (p === '/automations' || p.startsWith('/automations/')) return autoRoute(req, user, p, m, url);
  if (p === '/sites' || p.startsWith('/sites/')) return sitesRoute(req, user, p, m, url);
  if (p === '/files' || p.startsWith('/files/')) return filesRoute(req, user, p, m, url);
  if (p === '/shared' && m === 'GET') return sharedWith(user);
  // Con o (en el cuerpo o en la dirección), compartir y los enlaces trabajan sobre el espacio del equipo, si el
  // papel de quien llama y la política del equipo lo permiten. Sin o, sobre lo propio, como siempre.
  if (p === '/shares' && m === 'POST') { const b = await readBody(req); const owner = shareOwner(user, b.o, 'share'); if (owner === user) return addShare(user, b); const r = teamShare(user.team, user, owner, b); statOnce(user.id, STAT_BIT.shared, 'shared'); return r; }
  if (p === '/shares' && m === 'GET') return sharesOf(shareOwner(user, url.searchParams.get('o'), 'see'), url.searchParams.get('path'));
  if (p.startsWith('/shares/') && m === 'DELETE') {
    const owner = shareOwner(user, url.searchParams.get('o'), 'share'); const row = q('SELECT path FROM shares WHERE id = ? AND owner = ?').get(+p.slice(8), owner.id);
    q('DELETE FROM shares WHERE id = ? AND owner = ?').run(+p.slice(8), owner.id);
    if (row && owner !== user) teamLog(user.team, user, 'unshare', row.path);
    return { ok: true };
  }
  if (p === '/links' && m === 'POST') { const b = await readBody(req); const owner = shareOwner(user, b.o, 'links'); if (owner === user) return addLink(user, b); const r = teamLink(user.team, user, owner, b); statOnce(user.id, STAT_BIT.shared, 'shared'); return r; }
  if (p.startsWith('/links/') && m === 'DELETE') {
    const owner = shareOwner(user, url.searchParams.get('o'), 'links'); const row = q('SELECT path FROM links WHERE id = ? AND owner = ?').get(+p.slice(7), owner.id);
    q('DELETE FROM links WHERE id = ? AND owner = ?').run(+p.slice(7), owner.id);
    if (row && owner !== user) teamLog(user.team, user, 'unlink', row.path);
    return { ok: true };
  }
  if (p === '/account' && m === 'GET') return account(user);
  if (p === '/account' && m === 'PUT') return accountName(user, await readBody(req));
  if (p === '/account/protect-seen' && m === 'POST') return protectSeenSet(user);
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
  if (p === '/agents' && m === 'GET') return agentsFor(user);
  if (p === '/comments' && m === 'GET') return listComments(user, url.searchParams.get('path') || '', url.searchParams.get('all') === '1');
  if (p === '/comments' && m === 'POST') { const c = addComment(user, await readBody(req)); announce(roomKey(user.id, c.path), { type: 'comments' }); return c; }
  if (p.startsWith('/comments/') && m === 'DELETE') { q('DELETE FROM comments WHERE id = ? AND user = ?').run(+p.slice(10), user.id); return { ok: true }; }
  if (p === '/tokens' && m === 'POST') {
    if (q('SELECT COUNT(*) AS n FROM tokens WHERE user = ?').get(user.id).n >= MAX_TOKENS) throw new Fail(429, 'too_many');
    const b = await readBody(req); const token = 'mdt_' + random(30);
    const scope = String(b.folder || '').trim() ? cleanPath(String(b.folder).replace(/\/+$/, '')) : '';
    // Compartir y crear enlaces es un permiso aparte, que se pide al crear el token: sin share: true no lo tiene.
    const share = b.share === true;
    const r = q('INSERT INTO tokens (hash, user, name, scope, share, created) VALUES (?, ?, ?, ?, ?, ?)').run(sha(token), user.id, String(b.name || 'AI').slice(0, 60), scope, share ? 1 : 0, now());
    statOnce(user.id, STAT_BIT.token, 'ai_token');
    return { id: Number(r.lastInsertRowid), token, scope, share, mcp_url: PUBLIC_URL + '/mcp' };
  }
  if (p.startsWith('/tokens/') && m === 'DELETE') { q('DELETE FROM tokens WHERE id = ? AND user = ?').run(+p.slice(8), user.id); return { ok: true }; }
  if (p === '/notes' && m === 'GET') {
    const oid = +(url.searchParams.get('o') || user.id);
    if (oid === user.id) return listNotes(user).map((n) => (n.v ? n : { path: n.path, updated: n.updated, size: n.size }));
    if (user.team && oid === user.team.space) return listNotes({ id: oid }).map((n) => (n.v ? { path: n.path, updated: n.updated, size: n.size, v: 1 } : { path: n.path, updated: n.updated, size: n.size }));
    return sharedWith(user).filter((n) => n.owner === oid).map((n) => ({ path: n.path, updated: n.updated, size: n.size }));
  }
  // Con o, estas cuatro trabajan sobre el espacio del equipo de quien llama. Cualquier otro o se rechaza.
  if (p === '/search' && m === 'GET') return searchNotes(spaceOf(user, url.searchParams.get('o')), url.searchParams.get('q'));
  if (p === '/rename' && m === 'POST') { const b = await readBody(req); const owner = spaceOf(user, b.o, 'edit'); teamHold(user, owner); const r = renameNote(owner, b.from, b.to, b); if (owner !== user) teamLog(user.team, user, 'move', cleanPath(b.from), r.path); return r; }
  if (p.startsWith('/notes/')) {
    const note = dec(p.slice(7));
    const clean = cleanPath(note);
    if (m === 'GET') { const t = target(user, url, clean, 'view'); return Object.assign(readNote(t.owner, clean), { role: t.role, edited: noteEdited(t.owner.id, clean, false, t.role !== 'owner' && t.role !== 'team' && !(user.team && user.team.space === t.owner.id)) }); }
    if (m === 'PUT') {
      const t = target(user, url, clean, 'edit');
      teamHold(user, t.owner);
      const body = await readBody(req);
      const mine = t.role === 'owner' || t.role === 'team';
      const saved = mine ? liveWrite(t.owner, clean, body.text, cleanRev(body.rev)) : writeNote(t.owner, clean, body.text, cleanRev(body.rev));
      // Dentro de una sesión en vivo, quién fue: quien la abrió ('o') u otro miembro del equipo ('m2').
      const session = mine ? liveRow(t.owner.id, clean) : null;
      tellSaved(t.owner.id, clean, saved, { by: user.email, pid: session ? livePid(session, user.id) : t.role === 'owner' ? 'o' : 'x', ed: 'u:' + user.id }, String(body.text == null ? '' : body.text));
      if (t.role === 'team') teamLog(user.team, user, saved.rev === 1 ? 'create' : 'edit', clean);
      return saved;
    }
    if (m === 'DELETE') { const t = target(user, url, clean, 'owner'); const r = deleteNote(t.owner, clean, url.searchParams.get('forever') === '1'); if (t.role === 'team') teamLog(user.team, user, 'delete', clean); return r; }
  }
  // El historial del espacio de un equipo dura más (TEAM_HISTORY_DAYS): su lista trae más versiones.
  if (p.startsWith('/versions/') && m === 'GET') { const owner = spaceOf(user, url.searchParams.get('o')); return q('SELECT id, saved, size, by FROM versions WHERE user = ? AND path = ? ORDER BY saved DESC LIMIT ?').all(owner.id, cleanPath(dec(p.slice(10))), owner === user ? 100 : 500).map((v) => ({ id: v.id, saved: v.saved, size: v.size, edited: editedBy(v.by, false) })); }
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
  // El host de los sitios publicados es otro mundo: por ahí no hay API, ni CORS, ni credenciales.
  if (pagesHost(req)) { pagesServe(req, res); return; }
  // Las imágenes adjuntas se sirven sin sesión y con sus propias cabeceras (bloque ADJUNTOS).
  if (fileServe(req, res)) return;
  for (const k in BASE_HEADERS) res.setHeader(k, BASE_HEADERS[k]);
  res.setHeader('vary', 'origin');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events' && req.method === 'GET') { listen(req, res, userFrom(req, 'session'), url); return; }
    if (url.pathname === '/live/events' && req.method === 'GET') { listenGuest(req, res); return; }
    const out = await reqCtx.run({ user: null, via: '' }, () => route(req, url));
    // La página de revisión de la galería: HTML sin scripts, que no se puede enmarcar ni mandar su formulario a otro lado.
    if (out && out.__html !== undefined) { res.writeHead(out.__status || 200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }); res.end(out.__html); return; }
    if (out && out.__file) { fileSend(res, out.__file); return; }
    if (out && out.__text !== undefined) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(out.__text); return; }
    if (out && out.__status) { res.writeHead(out.__status); res.end(); return; }
    if (out && out.__cache) { res.setHeader('cache-control', out.__cache); delete out.__cache; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    // De un error inesperado se anota qué fue y dónde, sin el cuerpo del pedido. Hacia afuera va solo "server_error".
    if (status >= 500) console.error(status === 500 ? 'error 500 en ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 80) + ' · ' + String(e && e.stack || e).slice(0, 1500) : 'error ' + status + ' ' + (e.code || '') + ' en ' + req.method + ' ' + String(req.url).split('?')[0].slice(0, 80));
    if (res.headersSent) { res.end(); return; }
    const body = JSON.stringify(String(req.url).startsWith('/api/v1/') ? apiError(e) : e instanceof Fail ? Object.assign({ error: e.code, message: e.message || '' }, e.extra) : { error: 'server_error', message: '' });
    if (e instanceof Fail && e.extra && e.extra.retry_after) res.setHeader('retry-after', String(e.extra.retry_after));
    // Un cuerpo pasado de tamaño: se avisa y recién ahí se corta, para no seguir recibiendo.
    if (status === 413) { res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', connection: 'close' }); res.end(body, () => req.destroy()); return; }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  }
});
// Conexiones lentas: los encabezados tienen 15 segundos para llegar y el pedido entero, un minuto. /events no
// entra en esa cuenta: lo que queda abierto ahí es la respuesta.
// Una subida de imagen tiene su propio plazo (FILE_UPLOAD_MS, con velocidad mínima); el resto, el minuto de siempre,
// que se mide por pedido en el manejador.
server.headersTimeout = 15000; server.requestTimeout = Math.max(60000, FILE_UPLOAD_MS + 30000);
server.on('request', (req) => { if (fileUploadReq(req)) return; const t = setTimeout(() => { if (!req.complete) req.destroy(); }, 60000); t.unref(); req.on('close', () => clearTimeout(t)); req.on('end', () => clearTimeout(t)); });
// Un error que se escapa de una ruta se anota y el servicio sigue: no se cae por un pedido.
process.on('uncaughtException', (e) => console.error('error no capturado · ' + String(e && e.stack || e).slice(0, 1500)));
process.on('unhandledRejection', (e) => console.error('promesa sin atender · ' + String(e && e.stack || e).slice(0, 1500)));

// Limpieza: códigos vencidos, historial viejo, lo que venció en la papelera, comentarios de más de 180 días y sesiones sin uso, cada seis horas; los topes en memoria, cada diez minutos.
feedbackSweep(); // y al arrancar
setInterval(() => {
  q('DELETE FROM codes WHERE expires < ?').run(now());
  historySweep(); teamLogSweep();
  trashSweep(); feedbackSweep();
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
