// Cifrado de las carpetas con contraseña ("bóvedas") de la nube. Todo pasa en el navegador, con WebCrypto y sin
// dependencias; el servidor recibe el resultado. Acá no hay interfaz: la interfaz está en vault.js.
//
//   - Llave de datos K: 32 bytes al azar, una por carpeta. Es lo que guarda la clave de respaldo.
//   - De K salen, con HKDF-SHA-256, dos cosas distintas: la llave AES-256-GCM que cifra las notas y un valor de
//     comprobación. Con el valor de comprobación (que el servidor guarda) se sabe si una K es la correcta, y de él
//     no se puede volver a K ni a la llave de cifrado.
//   - La contraseña no cifra las notas: envuelve a K. De la contraseña sale una llave con PBKDF2-SHA-256
//     (600.000 vueltas, sal al azar de 16 bytes) y con ella se cifra K (AES-256-GCM). Por eso cambiar la contraseña
//     no toca las notas, y por eso con K (la clave de respaldo) se puede poner una contraseña nueva.
//   - Cada nota: AES-256-GCM con un nonce al azar de 96 bits por guardado y la ruta de la nota como dato asociado.
//     GCM detecta cualquier cambio, y la ruta atada hace que un texto cifrado puesto en otra ruta no abra.
//     Viaja como vault1: + base64(nonce | texto cifrado con su etiqueta).
// Los nombres de las notas y de las carpetas no se cifran.
(function (root) {
  'use strict';

  const PREFIX = 'vault1:';
  const ITERS = 600000;
  const ENC_INFO = 'sharpmd vault enc v1'; const CHECK_INFO = 'sharpmd vault check v1'; const WRAP_AAD = 'sharpmd vault wrap v1';
  const subtle = () => root.crypto.subtle;
  const utf8 = new TextEncoder();
  const rand = (n) => root.crypto.getRandomValues(new Uint8Array(n));
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const join = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
  const fail = (code) => Object.assign(new Error(code), { code });

  const newKey = () => rand(32);

  // De la contraseña, la llave que envuelve a K. La contraseña se normaliza (NFKC) para que una misma contraseña
  // escrita en dos teclados distintos dé los mismos bytes.
  async function kek(password, salt, iters) {
    const base = await subtle().importKey('raw', utf8.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // Envuelve K con la contraseña. Devuelve lo que guarda el servidor: sal, vueltas y la llave envuelta.
  async function wrap(K, password, iters) {
    iters = iters || ITERS;
    const salt = rand(16); const iv = rand(12);
    const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(WRAP_AAD) }, await kek(password, salt, iters), K));
    return { salt: b64(salt), iters, wrapped: b64(join(iv, body)) };
  }
  // Devuelve K. Con otra contraseña GCM no abre: sale bad_password.
  async function unwrap(vault, password) {
    try {
      const raw = unb64(vault.wrapped);
      const K = await subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: utf8.encode(WRAP_AAD) }, await kek(password, unb64(vault.salt), vault.iters), raw.subarray(12));
      return new Uint8Array(K);
    } catch (e) { throw fail('bad_password'); }
  }
  // De K, la llave de cifrado (no se puede sacar del navegador: extractable false) y el valor de comprobación.
  async function derive(K) {
    const base = await subtle().importKey('raw', K, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const how = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) });
    const key = await subtle().deriveKey(how(ENC_INFO), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const check = b64(new Uint8Array(await subtle().deriveBits(how(CHECK_INFO), base, 256)));
    return { key, check };
  }

  const sealed = (text) => typeof text === 'string' && text.startsWith(PREFIX);
  async function seal(key, path, text) {
    const iv = rand(12);
    const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(path) }, key, utf8.encode(String(text))));
    return PREFIX + b64(join(iv, body));
  }
  // Con otra llave, otra ruta o un texto tocado no abre: sale vault_unreadable, nunca texto a medias.
  async function open(key, path, stored) {
    try {
      const raw = unb64(String(stored).slice(PREFIX.length));
      const body = await subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: utf8.encode(path) }, key, raw.subarray(12));
      return new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (e) { throw fail('vault_unreadable'); }
  }

  // ---------- Clave de respaldo ----------
  // K escrita para una persona: base32 sin los caracteres que se confunden (0 y O, 1 e I), en grupos de cuatro.
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function backupText(K) {
    let bits = 0; let have = 0; let out = '';
    for (const b of K) { bits = (bits << 8) | b; have += 8; while (have >= 5) { out += ALPHA[(bits >>> (have - 5)) & 31]; have -= 5; } bits &= (1 << have) - 1; }
    if (have) out += ALPHA[(bits << (5 - have)) & 31];
    return out.match(/.{1,4}/g).join('-');
  }
  // Devuelve K, o null si lo escrito no tiene la forma de una clave de respaldo.
  function backupKey(text) {
    const s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length !== 52) return null;
    const out = new Uint8Array(32); let bits = 0; let have = 0; let n = 0;
    for (const c of s) {
      const v = ALPHA.indexOf(c); if (v < 0) return null;
      bits = (bits << 5) | v; have += 5;
      if (have >= 8) { if (n < 32) out[n++] = (bits >>> (have - 8)) & 255; have -= 8; bits &= (1 << have) - 1; }
    }
    return n === 32 && bits === 0 ? out : null;
  }

  // Qué tan difícil de adivinar parece una contraseña: 0 muy corta, 1 débil, 2 aceptable, 3 fuerte. Es una guía
  // simple por largo y variedad, no una medida.
  function strength(p) {
    p = String(p || ''); const n = Array.from(p).length;
    if (n < 8) return 0;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
    if (n >= 20 || (n >= 14 && kinds >= 2)) return 3;
    if (n >= 14 || (n >= 10 && kinds >= 2)) return 2;
    return 1;
  }

  // ---------- Llaves abiertas en esta pestaña ----------
  // Por valor de comprobación (uno por carpeta). Viven en memoria hasta bloquear o cerrar la pestaña. "Recordar en
  // este dispositivo" guarda además la CryptoKey en IndexedDB: sigue sin poder exportarse, pero queda en el equipo.
  const keys = new Map();
  async function keyFor(who, vault) {
    if (!vault) return null;
    if (keys.has(vault.check)) return keys.get(vault.check);
    const kept = await root.LMD.store.vkeyGet(who, vault.check);
    if (kept) keys.set(vault.check, kept);
    return kept || null;
  }
  const hold = (vault, key) => { keys.set(vault.check, key); };
  const held = (vault) => keys.has(vault.check);
  const remember = (who, vault) => root.LMD.store.vkeyPut(who, vault.check, keys.get(vault.check));
  const remembered = async (who, vault) => !!(await root.LMD.store.vkeyGet(who, vault.check));
  const unremember = (who, vault) => root.LMD.store.vkeyDelete(who, vault.check);
  const forget = async (who, vault) => { keys.delete(vault.check); await root.LMD.store.vkeyDelete(who, vault.check); };
  const forgetAll = async (who) => { keys.clear(); await root.LMD.store.vkeyClear(who); };

  // ---------- Un secreto chico de este dispositivo ----------
  // Para algo que no sale del equipo (la clave del asistente de IA, aikey.js): una llave AES-256-GCM que no se
  // puede exportar, hecha acá (deviceKey) o derivada de una contraseña (passKey). El texto va con seal() y open().
  const deviceKey = () => subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const passKey = (password, salt, iters) => kek(password, salt, iters || ITERS);

  root.LMD = root.LMD || {};
  // WebCrypto solo existe en páginas seguras (https, la extensión, localhost).
  const supported = () => !!(root.crypto && root.crypto.subtle);

  root.LMD.seal = { supported, PREFIX, ITERS, b64, unb64, newKey, wrap, unwrap, derive, sealed, seal, open, backupText, backupKey, strength, keyFor, hold, held, remember, remembered, unremember, forget, forgetAll, deviceKey, passKey, rand };
})(typeof self !== 'undefined' ? self : globalThis);
