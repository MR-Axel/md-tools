'use strict';
// Las reglas que decide cada pedido, en un solo lugar y sin tocar la red, para
// poder probarlas una por una.
//
//  1. Host: tiene que ser 127.0.0.1:<puerto> o localhost:<puerto>. Es la
//     defensa contra DNS rebinding: una pagina ajena puede hacer que SU dominio
//     resuelva a 127.0.0.1, pero el navegador sigue mandando su nombre en Host.
//  2. Origin: si viene, tiene que estar en la lista cerrada. Solo a esos se les
//     contesta con encabezados CORS, asi que el resto no puede leer nada.
//  3. Token: en todo /v1/*, en el encabezado Authorization. Nunca en la URL.
//     Como Authorization no es un encabezado "simple", el navegador pregunta
//     antes (preflight) y esa pregunta tambien pasa por 1 y 2.
//  4. Escrituras: solo POST con cuerpo JSON chico.
const crypto = require('crypto');

function sameToken(given, real) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(real)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Los intentos fallidos se cuentan: a los diez en un minuto se deja de contestar un rato.
function limiter(max, windowMs) {
  let fails = [];
  return {
    blocked(now) { fails = fails.filter((t) => now - t < windowMs); return fails.length >= max; },
    fail(now) { fails.push(now); },
  };
}

// ctx: { port, origins: [..], token, limiter?, now? }
// Devuelve { status, error?, headers } y, si status es 0, el pedido puede seguir.
function check(req, ctx) {
  const h = req.headers || {};
  const method = String(req.method || 'GET').toUpperCase();
  const pathname = String(req.url || '/').split('?')[0];
  const api = pathname.startsWith('/v1/');
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const deny = (status, error) => ({ status, error, headers });

  const hosts = ['127.0.0.1:' + ctx.port, 'localhost:' + ctx.port];
  if (!hosts.includes(String(h.host || '').toLowerCase())) return deny(421, 'host');

  const own = ['http://127.0.0.1:' + ctx.port, 'http://localhost:' + ctx.port];
  const origin = h.origin;
  if (origin !== undefined) {
    if (!own.includes(origin) && !ctx.origins.includes(origin)) return deny(403, 'origin');
    if (api) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
  } else if (api && h['sec-fetch-site'] && !['same-origin', 'none'].includes(h['sec-fetch-site'])) {
    // Un navegador que viene de otro sitio y no dice de donde: no.
    return deny(403, 'origin');
  }

  if (!api) return method === 'GET' ? { status: 0, headers } : deny(405, 'method');

  if (method === 'OPTIONS') {
    if (origin === undefined) return deny(403, 'origin');
    headers['Access-Control-Allow-Methods'] = 'GET, POST';
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
    headers['Access-Control-Max-Age'] = '600';
    // Chrome viejo (Private Network Access) lo pedia en la respuesta previa. Hoy no hace falta y no molesta.
    if (h['access-control-request-private-network']) headers['Access-Control-Allow-Private-Network'] = 'true';
    return { status: 204, headers };
  }
  if (method !== 'GET' && method !== 'POST') return deny(405, 'method');

  const now = ctx.now || Date.now();
  if (ctx.limiter && ctx.limiter.blocked(now)) return deny(429, 'slow-down');
  const m = String(h.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  if (!m || !sameToken(m[1], ctx.token)) {
    if (ctx.limiter) ctx.limiter.fail(now);
    return deny(401, 'token');
  }
  if (method === 'POST' && !/^application\/json\b/i.test(String(h['content-type'] || ''))) return deny(415, 'json');
  return { status: 0, headers };
}

module.exports = { check, limiter, sameToken };
