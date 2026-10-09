// Anonymous counts (src/count.js and the block "Anonymous counts" of the server): what the site and the web app send,
// when they send nothing, what the server accepts and keeps, the steps it counts by itself once per account, and the
// totals of GET /admin/funnel. The real cloud is never touched: sharpmd.app is served from this folder and what goes to
// sync.sharpmd.app is written down and handed to a local server.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process'; import { createHmac } from 'crypto'; import { DatabaseSync } from 'node:sqlite';
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import { fileURLToPath, pathToFileURL } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 900))); };
const today = new Date().toISOString().slice(0, 10);
const KEY = { 'x-admin-key': 'clave-de-prueba' };
const UA = 'FunnelProbe/9.9 (agente-de-prueba)';

// ---------- The server, over a database that already had the counter of the home page ----------
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfunnel-'));
{
  const old = new DatabaseSync(path.join(data, 'mdtools.db'));
  old.exec('CREATE TABLE landing_stats (day TEXT NOT NULL, v TEXT NOT NULL, e TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, v, e))');
  old.exec("INSERT INTO landing_stats (day, v, e, n) VALUES ('2026-01-05', 'a', 'view', 40), ('2026-01-05', 'a', 'open', 9), ('2026-01-05', 'b', 'view', 38), ('2026-01-06', 'b', 'open', 4)");
  old.close();
}
const PORT = 19000 + Math.floor(Math.random() * 600); const base = 'http://127.0.0.1:' + PORT;
const ENV = { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', PUBLIC_URL: base, ALLOW_ORIGINS: 'https://sharpmd.app', PADDLE_WEBHOOK_SECRET: 'firma-de-prueba', PADDLE_PRICE_MONTHLY: 'pri_mensual', LANDING_PER_HOUR: '40', STATS_SOURCES_DAY: '3', AUTH_PER_IP: '500' };
let log = ''; let child = null;
const boot = async () => {
  child = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  const mark = log.length; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80 && !/puerto/.test(log.slice(mark)); i++) await sleep(100);
};
const halt = async () => { const gone = new Promise((r) => child.once('exit', r)); child.kill(); await gone; };
await boot();
let ipSeq = 0; const freshIp = () => '198.51.100.' + (++ipSeq % 250) + (ipSeq > 249 ? '' : '');
const call = async (method, url, body, auth, extra) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'user-agent': UA, 'x-forwarded-for': '203.0.113.77', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(extra || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* no era JSON */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') || '' };
};
// As sendBeacon sends it: plain text, no session.
const beat = (body, ip, at) => fetch(base + (at || '/stats'), { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': UA, 'x-forwarded-for': ip || '203.0.113.' + (1 + (++ipSeq % 200)) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const db = () => new DatabaseSync(path.join(data, 'mdtools.db'), { readOnly: true });
const rowsOf = (where, args) => { const d = db(); const r = d.prepare('SELECT step, page, source, variant, SUM(n) AS n FROM stats WHERE ' + (where || '1') + ' GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4').all(...(args || [])).map((x) => [x.step, x.page, x.source, x.variant, Number(x.n)].join(':')); d.close(); return r; };
const countOf = (step, source) => { const d = db(); const r = d.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM stats WHERE step = ? AND (? IS NULL OR source = ?)').get(step, source == null ? null : source, source == null ? null : source); d.close(); return Number(r.n); };
const signup = async (email, src) => {
  const start = await call('POST', '/auth/start', Object.assign({ email }, src === undefined ? {} : { src }));
  const v = await call('POST', '/auth/verify', Object.assign({ email, code: start.json && start.json.dev_code }, src === undefined ? {} : { src }));
  return { status: v.status, s: v.json && v.json.session, start: start.status };
};
const paddle = async (ev) => { const raw = JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', 'firma-de-prueba').update(ts + ':' + raw).digest('hex'); const r = await fetch(base + '/paddle/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw }); return { status: r.status, json: await r.json().catch(() => null) }; };

let browser = null; let site = null; let ext = null; const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfunnel-ext-'));
try {
  console.log('El servidor: lo que ya estaba contado');
  {
    const d = db();
    const kind = d.prepare("SELECT type FROM sqlite_master WHERE name = 'landing_stats'").get().type;
    const cols = d.prepare('PRAGMA table_info(stats)').all().map((c) => c.name).join();
    const moved = d.prepare('SELECT day, step, page, source, variant, n FROM stats ORDER BY day, variant, step').all().map((r) => Object.values(r).join(':'));
    const through = d.prepare('SELECT day, v, e, n FROM landing_stats ORDER BY day, v, e').all().map((r) => Object.values(r).join(':'));
    d.close();
    check('los conteos de landing_stats pasan a stats, como visitas de la portada sin canal', JSON.stringify(moved) === JSON.stringify(['2026-01-05:open:home:unknown:a:9', '2026-01-05:view:home:unknown:a:40', '2026-01-05:view:home:unknown:b:38', '2026-01-06:open:home:unknown:b:4']), moved);
    check('stats guarda el día, el paso, la página, el canal, el titular y la cuenta, y nada más', cols === 'day,step,page,source,variant,n', cols);
    check('landing_stats queda como vista con las columnas de siempre, para quien la lee', kind === 'view' && JSON.stringify(through) === JSON.stringify(['2026-01-05:a:open:9', '2026-01-05:a:view:40', '2026-01-05:b:view:38', '2026-01-06:b:open:4']), [kind, through]);
    const was = await call('GET', '/admin/landing', undefined, undefined, KEY);
    check('GET /admin/landing sigue dando los totales de antes', was.status === 200 && JSON.stringify(was.json.variants) === JSON.stringify({ a: { view: 40, open: 9, rate: 0.225 }, b: { view: 38, open: 4, rate: 0.1053 } }) && was.json.from === '2026-01-05', was.json);
    await halt(); await boot();
    check('y al reiniciar no se cuentan dos veces', JSON.stringify((await call('GET', '/admin/landing', undefined, undefined, KEY)).json.variants.a) === JSON.stringify({ view: 40, open: 9, rate: 0.225 }));
  }

  console.log('El servidor: qué acepta POST /stats');
  {
    const ok = [];
    for (const b of [{ e: 'view', p: 'home', s: 'reddit', v: 'a' }, { e: 'open', p: 'home', s: 'reddit', v: 'a' }, { e: 'plans', p: 'home', s: 'direct', v: 'b' }, { e: 'view', p: 'mcp', s: 'google' }, { e: 'view', p: 'wysiwyg', s: 'other' }, { e: 'open', p: 'mcp', s: 'google' },
      { e: 'view', p: 'pay', s: 'direct' }, { e: 'checkout_open', p: 'pay', s: 'direct' }, { e: ['app_open', 'first_open'], p: 'app', s: 'reddit' }, { e: 'note_created', p: 'app', s: 'reddit' }, { e: 'edited', p: 'app', s: 'play-store' }]) { const r = await beat(b); ok.push(r.status + ':' + (await r.text()).length); }
    check('los eventos de la lista se reciben sin sesión, como texto, y la respuesta va vacía', ok.every((x) => x === '204:0'), ok);
    const old = await beat({ v: 'b', e: 'view' }, null, '/landing');
    check('la portada que ya estaba publicada sigue contando por /landing, sin canal', old.status === 204 && rowsOf("day = ? AND source = 'unknown'", [today]).join() === 'view:home:unknown:b:1', rowsOf("day = ? AND source = 'unknown'", [today]));
    const bad = [];
    for (const b of [{ e: 'signed_up', p: 'app', s: 'reddit' }, { e: 'paid', p: 'pay', s: 'reddit' }, { e: 'cloud_first', p: 'app', s: 'reddit' }, { e: 'ai_token', p: 'app', s: 'direct' }, { e: 'shared', p: 'app', s: 'direct' }, { e: 'signin_start', p: 'app', s: 'direct' },
      { e: 'buy', p: 'home', s: 'direct' }, { e: 'view', p: 'docs', s: 'direct' }, { e: 'view', p: 'app', s: 'direct' }, { e: 'app_open', p: 'home', s: 'direct' }, { e: 'checkout_open', p: 'home', s: 'direct' }, { e: 'view', p: 'mcp', s: 'direct', v: 'a' }, { e: 'view', p: 'home', s: 'direct', v: 'c' },
      { e: ['view', 'view'], p: 'home', s: 'direct' }, { e: [], p: 'home', s: 'direct' }, { e: ['app_open', 'first_open', 'note_created', 'edited', 'app_open'], p: 'app', s: 'direct' }, { e: ['app_open', 'paid'], p: 'app', s: 'direct' }, { e: { a: 1 }, p: 'home' }, { p: 'home', s: 'direct' }, 'hola', '[]', 'null']) bad.push((await beat(b)).status);
    check('un paso de la cuenta, un evento de otra lista, otra página o una lista repetida o larga no se cuentan', bad.every((x) => x === 400), bad);
    const badSrc = [];
    for (const s of ['Reddit', 'a b', 'x'.repeat(25), 'https://x.test/a', 'a/b', 'ana@ejemplo.test', 'ñandú', 7, ['reddit'], { a: 1 }]) badSrc.push((await beat({ e: 'view', p: 'home', s })).status);
    check('un canal que no es una etiqueta de [a-z0-9-]{1,24} se rechaza: ni una dirección, ni un correo', badSrc.every((x) => x === 400), badSrc);
    check('un cuerpo de más de 200 bytes se corta', (await beat('{"e":"view","p":"home","s":"direct","x":"' + 'y'.repeat(300) + '"}')).status === 413);
    const before = rowsOf('day = ?', [today]);
    check('lo rechazado no dejó nada en la tabla', !before.some((r) => /signed_up|paid|cloud_first|buy|docs|Reddit|ejemplo/.test(r)) && before.join() === ['app_open:app:reddit::1', 'checkout_open:pay:direct::1', 'edited:app:play-store::1', 'first_open:app:reddit::1', 'note_created:app:reddit::1', 'open:home:reddit:a:1', 'open:mcp:google::1', 'plans:home:direct:b:1', 'view:home:reddit:a:1', 'view:home:unknown:b:1', 'view:mcp:google::1', 'view:pay:direct::1', 'view:wysiwyg:other::1'].join(), before);

    // Los canales que trae un enlace: hasta STATS_SOURCES_DAY nuevos por día (acá, 3). El resto cae en "other".
    for (const s of ['newsletter', 'podcast', 'meetup', 'cuarto', 'quinto', 'newsletter', 'linkedin', 'telegram']) await beat({ e: 'view', p: 'home', s });
    const labels = rowsOf("day = ? AND step = 'view' AND page = 'home' AND variant = ''", [today]);
    check('los canales propios de un enlace tienen tope por día, y pasado el tope cuentan como "other"; los de la lista entran siempre', labels.join() === 'view:home:linkedin::1,view:home:meetup::1,view:home:newsletter::2,view:home:other::2,view:home:podcast::1,view:home:telegram::1', labels);

    let last = null; for (let i = 0; i < 45; i++) last = await beat({ e: 'view', p: 'wysiwyg', s: 'bing' }, '203.0.113.240');
    check('hay un tope por IP, y otra IP sigue entrando', last.status === 429 && countOf('view', 'bing') === 40 && (await beat({ e: 'view', p: 'wysiwyg', s: 'bing' }, '203.0.113.241')).status === 204, [last.status, countOf('view', 'bing')]);
  }

  console.log('El servidor: los pasos de una cuenta');
  {
    const none = [countOf('signin_start'), countOf('signed_up'), countOf('signed_in')];
    const A = await signup('ana@ejemplo.test', 'reddit');
    const d1 = db(); const kept = d1.prepare('SELECT source, funnel FROM users WHERE email = ?').get('ana@ejemplo.test'); const ucols = d1.prepare('PRAGMA table_info(users)').all().map((c) => c.name); d1.close();
    check('al registrarse cuenta el código pedido y el registro, con el canal que mandó la app', A.status === 200 && none.join() === '0,0,0' && countOf('signin_start', 'reddit') === 1 && countOf('signed_up', 'reddit') === 1 && countOf('signed_in') === 0, [A.status, countOf('signin_start', 'reddit'), countOf('signed_up', 'reddit')]);
    check('en la cuenta queda el canal, una palabra, y nada más del conteo', kept.source === 'reddit' && Number(kept.funnel) === 0 && ucols.includes('source') && ucols.includes('funnel') && !ucols.some((c) => /ip|agent|visitor|device/i.test(c)), [kept, ucols]);
    const again = await signup('ana@ejemplo.test', 'linkedin');
    const d2 = db(); const still = d2.prepare('SELECT source FROM users WHERE email = ?').get('ana@ejemplo.test').source; d2.close();
    check('volver a entrar cuenta un ingreso con el canal de la cuenta, no otro registro, y el canal de la cuenta no cambia', again.status === 200 && countOf('signed_up') === 1 && countOf('signed_in', 'reddit') === 1 && countOf('signed_in', 'linkedin') === 0 && countOf('signin_start', 'linkedin') === 1 && still === 'reddit', [countOf('signed_up'), countOf('signed_in', 'reddit'), still]);
    const B = await signup('beto@ejemplo.test'); const C = await signup('caro@ejemplo.test', '<script>alert(1)</script>'); const D = await signup('dani@ejemplo.test', 'https://sitio.test/ruta?x=1');
    const d3 = db(); const srcs = d3.prepare("SELECT email, source FROM users WHERE email LIKE '%@ejemplo.test' ORDER BY email").all().map((u) => u.email.split('@')[0] + ':' + u.source).join(); d3.close();
    check('sin canal, o con algo que no es una etiqueta, la cuenta entra igual y cuenta como "unknown"', B.status === 200 && C.status === 200 && D.status === 200 && srcs === 'ana:reddit,beto:unknown,caro:unknown,dani:unknown' && countOf('signed_up', 'unknown') === 3, [srcs, countOf('signed_up', 'unknown')]);

    await call('PUT', '/notes/uno.md', { text: '# Uno\n\nTexto secreto de la nota.' }, A.s);
    const first = countOf('cloud_first', 'reddit');
    await call('PUT', '/notes/dos.md', { text: '# Dos' }, A.s); await call('PUT', '/notes/uno.md', { text: '# Uno, otra vez' }, A.s);
    await call('DELETE', '/notes/uno.md?forever=1', undefined, A.s); await call('DELETE', '/notes/dos.md?forever=1', undefined, A.s); await call('PUT', '/notes/tres.md', { text: '# Tres' }, A.s);
    check('la primera nota en la nube se cuenta una vez por cuenta, con el canal de la cuenta', first === 1 && countOf('cloud_first') === 1, [first, countOf('cloud_first')]);
    await call('PUT', '/notes/b.md', { text: '# B' }, B.s);
    check('la de una cuenta sin canal cuenta como "unknown"', countOf('cloud_first', 'unknown') === 1 && countOf('cloud_first') === 2);

    const t1 = await call('POST', '/tokens', { name: 'Claude' }, A.s); await call('POST', '/tokens', { name: 'Otro' }, A.s);
    check('el primer token de IA se cuenta una vez', t1.status === 200 && countOf('ai_token', 'reddit') === 1 && countOf('ai_token') === 1, countOf('ai_token'));

    await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'pro' }, undefined, KEY);
    check('un plan dado a mano no cuenta como pago', countOf('paid') === 0);
    const l1 = await call('POST', '/links', { path: 'tres.md' }, A.s); await call('POST', '/links', { path: 'tres.md' }, A.s); await call('POST', '/shares', { path: 'tres.md', email: 'beto@ejemplo.test' }, A.s);
    check('el primer compartir (un enlace o una persona) se cuenta una vez', l1.status === 200 && countOf('shared', 'reddit') === 1 && countOf('shared') === 1, [l1.status, countOf('shared')]);
    await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'free' }, undefined, KEY);

    const sub = (id, status, mail) => ({ event_type: 'subscription.updated', data: { id, status, items: [{ price: { id: 'pri_mensual' }, quantity: 1 }], ...(mail ? { custom_data: { sharpmd_email: mail } } : {}) } });
    const p1 = await paddle(sub('sub_a', 'active', 'ana@ejemplo.test')); await paddle(sub('sub_a', 'past_due')); await paddle(sub('sub_a', 'canceled')); const p2 = await paddle(sub('sub_a2', 'active', 'ana@ejemplo.test'));
    check('el pago lo cuenta el aviso de Paddle, una vez por cuenta y con su canal', p1.json.plan === 'pro' && p2.json.plan === 'pro' && countOf('paid', 'reddit') === 1 && countOf('paid') === 1, [p1.json, countOf('paid')]);
    await paddle(sub('sub_x', 'canceled', 'beto@ejemplo.test'));
    check('una suscripción que llega dada de baja no cuenta', countOf('paid') === 1);
    const d4 = db(); const bits = Number(d4.prepare('SELECT funnel FROM users WHERE email = ?').get('ana@ejemplo.test').funnel); d4.close();
    check('en la cuenta queda anotado qué pasos ya contó', bits === 15, bits);
  }

  console.log('El servidor: GET /admin/funnel');
  {
    for (let i = 0; i < 10; i++) await beat({ e: 'view', p: i < 6 ? 'home' : 'mcp', s: 'hackernews' });
    for (let i = 0; i < 4; i++) await beat({ e: 'open', p: 'home', s: 'hackernews' });
    for (let i = 0; i < 5; i++) await beat({ e: i < 4 ? ['app_open', 'first_open'] : 'app_open', p: 'app', s: 'hackernews' });
    await beat({ e: 'note_created', p: 'app', s: 'hackernews' }); await beat({ e: 'note_created', p: 'app', s: 'hackernews' }); await beat({ e: 'edited', p: 'app', s: 'hackernews' });
    await beat({ e: 'view', p: 'pay', s: 'hackernews' }); await beat({ e: 'plans', p: 'home', s: 'hackernews' });
    const H = await signup('hugo@ejemplo.test', 'hackernews'); await call('PUT', '/notes/h.md', { text: '# H' }, H.s);
    const noKey = [(await call('GET', '/admin/funnel')).status, (await call('GET', '/admin/funnel', undefined, undefined, { 'x-admin-key': 'otra' })).status, (await call('GET', '/admin/funnel?format=text')).status, (await call('POST', '/admin/funnel', {}, undefined, KEY)).status];
    check('pide la clave de administración', noKey.slice(0, 3).every((x) => x === 403) && noKey[3] !== 200, noKey);
    const f = (await call('GET', '/admin/funnel?source=hackernews', undefined, undefined, KEY)).json;
    const steps = f.total.steps.map((s) => s.step + ':' + s.n + ':' + s.rate).join(' ');
    check('por canal: cada paso con su cuenta y su porcentaje sobre el paso anterior', steps === 'view:10:null open:4:0.4 app_open:5:1.25 first_open:4:0.8 note_created:2:0.5 edited:1:0.5 signin_start:1:1 signed_up:1:1 cloud_first:1:1 ai_token:0:0 shared:0:null checkout_open:0:null paid:0:null', steps);
    check('la página de pago vista y los planes van aparte, no como visitas', f.total.extra.pay_view === 1 && f.total.extra.plans === 1 && f.total.extra.signed_in === 0 && f.source === 'hackernews' && f.days === 7 && f.to === today, f.total.extra);
    check('la serie por día trae los siete días, y hoy lleva todo', f.daily.length === 7 && f.daily[6].day === today && f.daily[6].view === 10 && f.daily[6].signed_up === 1 && f.daily.slice(0, 6).every((x) => x.view === 0), f.daily);
    const all = (await call('GET', '/admin/funnel', undefined, undefined, KEY)).json;
    const hn = all.sources.find((s) => s.source === 'hackernews'); const rd = all.sources.find((s) => s.source === 'reddit'); const n = (o, k) => o.steps.find((s) => s.step === k).n;
    const sum = (k) => all.sources.reduce((a, s) => a + n(s, k), 0);
    check('en total y por canal: los canales suman el total', all.source === null && n(hn, 'view') === 10 && n(rd, 'signed_up') === 1 && n(rd, 'cloud_first') === 1 && n(rd, 'ai_token') === 1 && n(rd, 'shared') === 1 && n(rd, 'paid') === 1 && ['view', 'app_open', 'signed_up', 'paid'].every((k) => sum(k) === n(all.total, k)) && n(all.total, 'signed_up') === 5 && n(all.total, 'paid') === 1, all.total.steps.map((s) => s.step + ':' + s.n).join(' '));
    check('las visitas de antes quedan fuera de los últimos siete días y entran con days', n(all.total, 'view') === countOf('view') - 78 - 2 && n((await call('GET', '/admin/funnel?days=3650', undefined, undefined, KEY)).json.total, 'view') === countOf('view') - 2, [n(all.total, 'view'), countOf('view')]);
    check('un canal mal escrito se rechaza', (await call('GET', '/admin/funnel?source=' + encodeURIComponent('a b'), undefined, undefined, KEY)).status === 400);
    const text = await call('GET', '/admin/funnel?format=text', undefined, undefined, KEY);
    console.log(text.text.split('\n').map((l) => '        | ' + l).join('\n'));
    check('format=text da una tabla corta de texto plano', text.status === 200 && /^text\/plain/.test(text.type) && /^SharpMD funnel, last 7 days \(\d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d\)\n/.test(text.text) && /\nVisits +\d+\n/.test(text.text) && /\nSigned up +5 {2}\d+%\n/.test(text.text) && /\nBY SOURCE\nvisits > app > new > note > code > signup > cloud > paid\n/.test(text.text) && /\nhackernews +10 > 5 > 4 > 2 > 1 > 1 > 1 > 0\n/.test(text.text) && text.text.split('\n').length < 40 && text.text.length < 1500, text.text);
    const one = await call('GET', '/admin/funnel?format=text&source=hackernews&days=1', undefined, undefined, KEY);
    check('y con un canal y un día, solo ese', /last 1 day \(/.test(one.text) && /source hackernews/.test(one.text) && !/BY SOURCE/.test(one.text) && /\nClicked open +4 {2}40%\n/.test(one.text), one.text);
  }

  console.log('El servidor: lo que no guarda');
  {
    const bytes = Buffer.concat(fs.readdirSync(data).filter((f) => /^mdtools\.db/.test(f)).map((f) => fs.readFileSync(path.join(data, f)))).toString('latin1');
    check('ni la IP ni el agente de usuario quedan en la base', !bytes.includes('203.0.113.') && !bytes.includes('198.51.100.') && !bytes.includes('FunnelProbe') && !bytes.includes('agente-de-prueba'));
    const d = db(); const every = d.prepare('SELECT * FROM stats').all(); d.close();
    const words = new Set(every.flatMap((r) => [r.step, r.page, r.source, r.variant]));
    check('en stats hay solo palabras de las listas y números: ni correos, ni rutas, ni texto de notas', every.every((r) => /^\d{4}-\d\d-\d\d$/.test(r.day) && /^[a-z_]{1,20}$/.test(r.step) && /^[a-z]{0,10}$/.test(r.page) && /^[a-z0-9-]{1,24}$/.test(r.source) && /^[ab]?$/.test(r.variant) && Number.isInteger(Number(r.n))) && ![...words].some((w) => /ejemplo|uno|tres|secreto|\.md|@|\//.test(w)), [...words]);
    check('contar no dejó errores en el registro del servidor', !/stats:|error 500/.test(log), log.slice(-400));
  }

  // ====================================================================================================================
  // El navegador: sharpmd.app servido desde esta carpeta, y lo que sale hacia sync.sharpmd.app anotado y pasado al servidor local.
  // ====================================================================================================================
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.md': 'text/markdown', '.mp4': 'video/mp4', '.webm': 'video/webm' };
  const fileFor = (url) => { const rel = decodeURIComponent(new URL(url).pathname); const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel); return file.startsWith(root) && fs.existsSync(file) && !fs.statSync(file).isDirectory() ? file : null; };
  site = http.createServer((req, res) => { const file = fileFor('http://x' + req.url); if (!file) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const copy = 'http://127.0.0.1:' + site.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath() });
  const errors = [];
  // A browser of its own. sent: every request to the sync server, with what it carried. Counts reach the local server.
  const open = async (opt) => {
    opt = opt || {};
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', serviceWorkers: 'block' });
    const sent = [];
    await ctx.route('https://sharpmd.app/**', (r) => { const file = fileFor(r.request().url()); return file ? r.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) }) : r.fulfill({ status: 404, body: '' }); });
    await ctx.route('https://pages.sharpmd.app/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Un sitio publicado</title><h1>Sitio</h1><a href="src/app.html">x</a><script src="https://sharpmd.app/src/count.js" data-page="home"></script>' }));
    await ctx.route('https://cdn.paddle.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Paddle = { Initialize: function () {}, Checkout: { open: function () { window.__checkout = (window.__checkout || 0) + 1; } } };' }));
    await ctx.route('https://sync.sharpmd.app/**', async (r) => {
      const q = r.request(); const u = new URL(q.url()); const h = q.headers();
      sent.push({ path: u.pathname, method: q.method(), body: q.postData() || '', type: h['content-type'] || '', cookie: h.cookie || '', auth: h.authorization || '', referer: h.referer || '' });
      if (u.pathname === '/stats' && q.method() === 'POST') { const res = await fetch(base + '/stats', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': '192.0.2.' + (1 + (++ipSeq % 250)) }, body: q.postData() || '' }); return r.fulfill({ status: res.status, body: '' }); }
      if (u.pathname === '/auth/start') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://sharpmd.app' }, body: '{"ok":true}' });
      return r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://sharpmd.app' }, body: '{"error":"no_route","message":""}' });
    });
    if (opt.init) await ctx.addInitScript(opt.init);
    if (opt.settings) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('mdtools:settings')) localStorage.setItem('mdtools:settings', JSON.stringify(s)); } catch (e) { /* una página en blanco no tiene almacenamiento */ } }, opt.settings);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    const stats = () => sent.filter((x) => x.path === '/stats' || x.path === '/landing');
    return { ctx, page, sent, stats, bodies: () => stats().map((x) => x.body) };
  };
  const SITE = 'https://sharpmd.app'; const APP = SITE + '/src/app.html';
  const appReady = (page) => page.waitForSelector('.lmd-home [data-home=new], .lmd-draft', { timeout: 20000 });
  // The app sends once the page is loaded and the browser is idle: this waits for that, or for long enough to say it did not.
  const settle = async (b, n, ms) => { for (let i = 0; i < (ms || 9000) / 100 && b.stats().length < n; i++) await sleep(100); await sleep(400); return b.bodies(); };
  const every = []; // every count any browser of this test sent, to look at them all at the end

  console.log('La portada');
  {
    const b = await open();
    await b.page.addInitScript(() => { try { localStorage.setItem('sharpmd:hero', 'a'); } catch (e) { /* sin almacenamiento */ } });
    await b.page.goto(SITE + '/?utm_source=Reddit&utm_campaign=lanzamiento&q=busqueda+secreta'); await b.page.waitForSelector('.hero h1'); await settle(b, 1, 3000);
    check('una visita manda una vista, con la página, el canal del enlace ya limpio y el titular', b.bodies().join('|') === '{"e":"view","p":"home","s":"reddit","v":"a"}', b.bodies());
    const one = b.stats()[0];
    check('va a /stats como texto, sin cookie ni sesión, y de la dirección de la página viaja solo el origen', one.path === '/stats' && one.method === 'POST' && /^text\/plain/.test(one.type) && !one.cookie && !one.auth && (one.referer === '' || one.referer === 'https://sharpmd.app/'), one);
    await b.page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
    const tap = async (sel) => { await b.page.evaluate((s) => document.querySelector(s).click(), sel); await sleep(250); return b.stats().length; };
    const afterOther = await tap('nav a[href="#share"]'); const afterOpen = await tap('.hero a.btn.fill[href="src/app.html"]'); const afterAgain = await tap('#plans a[href^="src/app.html"]'); const afterPlans = await tap('nav a[href="#plans"]'); const afterPlans2 = await tap('nav a[href="#plans"]');
    check('abrir la app y ver los planes se cuentan una vez cada uno por visita, y otro enlace no cuenta', afterOther === 1 && afterOpen === 2 && afterAgain === 2 && afterPlans === 3 && afterPlans2 === 3 && b.bodies().slice(1).join('|') === '{"e":"open","p":"home","s":"reddit","v":"a"}|{"e":"plans","p":"home","s":"reddit","v":"a"}', b.bodies());
    const kept = await b.page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage).sort().map((k) => k + '=' + localStorage.getItem(k)).join(), session: Object.keys(sessionStorage).sort().map((k) => k + '=' + sessionStorage.getItem(k)).join() }));
    check('no deja cookies; en el navegador queda el canal, que es una palabra y no un identificador', kept.cookie === '' && kept.local === 'mdtools:site-lang=en,sharpmd:hero=a,sharpmd:src1=reddit' && kept.session === 'sharpmd:src=reddit', kept);
    // Otra página del sitio, en la misma pestaña: el canal de la visita sigue, y no pasa a ser el propio sitio.
    await b.page.goto(SITE + '/es/markdown-editor-mcp.html'); await b.page.waitForSelector('h1'); await settle(b, 4, 3000);
    check('las páginas de búsqueda cuentan su vista con su nombre, y el canal de la visita se mantiene', b.bodies()[3] === '{"e":"view","p":"mcp","s":"reddit"}', b.bodies());
    await b.page.goto(SITE + '/wysiwyg-markdown-editor.html'); await b.page.waitForSelector('h1'); await settle(b, 5, 3000);
    await b.page.evaluate(() => { document.addEventListener('click', (e) => e.preventDefault()); document.querySelector('a.btn.fill[href="src/app.html"]').click(); }); await settle(b, 6, 3000);
    check('y el botón que abre la app desde ahí', b.bodies().slice(4).join('|') === '{"e":"view","p":"wysiwyg","s":"reddit"}|{"e":"open","p":"wysiwyg","s":"reddit"}', b.bodies());
    every.push(...b.stats()); await b.ctx.close();

    // Sin etiqueta en el enlace, el canal sale del sitio de origen: su nombre, nunca su dirección.
    const from = async (referer, query) => { const x = await open(); await x.page.goto(SITE + '/' + (query || '?site'), referer ? { referer } : {}); await x.page.waitForSelector('.hero h1'); const got = await settle(x, 1, 3000); every.push(...x.stats()); await x.ctx.close(); return got.map((t) => JSON.parse(t).s).join(); };
    const refs = { 'https://www.linkedin.com/feed/update/urn:li:activity:7123': 'linkedin', 'https://news.ycombinator.com/item?id=4242': 'hackernews', 'https://t.co/AbCdEf': 'twitter', 'https://www.google.com.ar/search?q=editor+markdown': 'google', 'https://chromewebstore.google.com/detail/sharpmd/abc': 'chrome-web-store',
      'https://wa.me/5491100000000': 'whatsapp', 'https://old.reddit.com/r/markdown/comments/x1/': 'reddit', 'https://blog.ejemplo.test/post/secreto?token=abc': 'other', '': 'direct' };
    const got = {}; for (const r of Object.keys(refs)) got[r] = await from(r);
    check('el sitio de origen se reduce a una etiqueta de la lista, "other" si no está y "direct" si no hay', Object.keys(refs).every((r) => got[r] === refs[r]), got);
    const links = [await from('', '?ref=Product%20Hunt'), await from('https://www.linkedin.com/feed/', '?utm_source=news.ycombinator.com'), await from('', '?src=' + encodeURIComponent('Boletín de Ana <ana@ejemplo.test>!!')), await from('', '?utm_source=' + 'x'.repeat(60))];
    check('la etiqueta del enlace manda sobre el origen, y sale saneada: minúsculas, guiones y hasta 24 caracteres', links.join('|') === 'producthunt|hackernews|bolet-n-de-ana-ana-ejemp|' + 'x'.repeat(24), links);
  }

  console.log('La app');
  {
    const b = await open();
    await b.page.goto(SITE + '/?utm_source=reddit'); await b.page.waitForSelector('.hero h1'); await settle(b, 1, 3000);
    const before = b.stats().length;
    await b.page.goto(APP); await appReady(b.page); await settle(b, before + 1);
    check('al abrir la app sale un solo pedido, diferido: la app abierta y la primera vez, con el canal por el que llegó', b.bodies().slice(before).join('|') === '{"e":["app_open","first_open"],"p":"app","s":"reddit"}', b.bodies());
    await b.page.click('.lmd-home [data-home=new]'); await b.page.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await settle(b, before + 2, 5000);
    check('la primera nota manda "note_created", sin nada de la nota', b.bodies()[before + 1] === '{"e":"note_created","p":"app","s":"reddit"}', b.bodies());
    await b.page.keyboard.type('Un texto secreto que no sale de aca', { delay: 5 }); await settle(b, before + 3, 8000);
    check('la primera edición guardada manda "edited"', b.bodies()[before + 2] === '{"e":"edited","p":"app","s":"reddit"}', b.bodies());
    const n3 = b.stats().length;
    await b.page.keyboard.type(' y sigue', { delay: 5 }); await sleep(1500);
    await b.page.goto(APP); await appReady(b.page); await b.page.click('.lmd-home [data-home=new]'); await b.page.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await b.page.keyboard.type('Otra', { delay: 5 });
    await settle(b, n3 + 1, 6500);
    check('cada evento sale una sola vez: otra nota, otro guardado o volver a cargar en la misma pestaña no mandan nada', b.stats().length === n3, b.bodies().slice(n3));
    const tab = await b.ctx.newPage(); await tab.goto(APP); await appReady(tab); await settle(b, n3 + 1);
    check('otra pestaña cuenta la app abierta, y ya no como primera vez', b.bodies().slice(n3).join('|') === '{"e":"app_open","p":"app","s":"reddit"}', b.bodies().slice(n3));
    // Lo que acompaña al pedido del código: el canal, para que el servidor cuente el ingreso.
    await tab.evaluate(() => LMD.cloud.start('ana@ejemplo.test').catch(() => null)); await sleep(300);
    const asked = b.sent.filter((x) => x.path === '/auth/start').map((x) => JSON.parse(x.body));
    check('al pedir el código de ingreso viaja el canal, para que el servidor cuente el paso', asked.length === 1 && asked[0].src === 'reddit' && Object.keys(asked[0]).sort().join() === 'email,lang,src', asked);
    const kept = await tab.evaluate(() => ({ cookie: document.cookie, counted: localStorage.getItem('sharpmd:counted'), first: localStorage.getItem('sharpmd:src1'), keys: Object.keys(localStorage).filter((k) => /^sharpmd:/.test(k)).sort().join() }));
    check('en el navegador queda qué primeras veces ya se mandaron y el canal: nada que distinga a una persona', kept.cookie === '' && kept.counted === 'first_open,note_created,edited' && kept.first === 'reddit' && kept.keys === 'sharpmd:app,sharpmd:counted,sharpmd:hero,sharpmd:src1', kept);
    every.push(...b.stats()); await b.ctx.close();

    // Quien ya usaba la app antes de que existieran los conteos no es una primera vez de nada.
    const old = await open({ init: () => { try { if (!sessionStorage.getItem('t')) { sessionStorage.setItem('t', '1'); localStorage.setItem('sharpmd:app', '1'); } } catch (e) { /* sin almacenamiento */ } } });
    await old.page.goto(APP); await appReady(old.page); await settle(old, 1);
    await old.page.click('.lmd-home [data-home=new]'); await old.page.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await old.page.keyboard.type('Hola', { delay: 5 }); await settle(old, 2, 4000);
    check('un navegador que ya usaba la app cuenta la apertura y ninguna primera vez; sin origen, el canal es "direct"', old.bodies().join('|') === '{"e":"app_open","p":"app","s":"direct"}', old.bodies());
    every.push(...old.stats()); await old.ctx.close();

    // La app de Android (la web empaquetada): sin otro canal anotado, viene de la tienda.
    const droid = await open();
    await droid.page.goto(APP + '?src=android'); await appReady(droid.page); await settle(droid, 1);
    check('la app de Android cuenta con el canal "play-store"', droid.bodies().join('|') === '{"e":["app_open","first_open"],"p":"app","s":"play-store"}', droid.bodies());
    every.push(...droid.stats()); await droid.ctx.close();
  }

  console.log('El pago');
  {
    const b = await open();
    await b.page.goto(SITE + '/pay.html?plan=monthly&email=' + encodeURIComponent('ana@ejemplo.test') + '&utm_source=linkedin'); await b.page.waitForSelector('#go'); await settle(b, 1, 3000);
    await b.page.click('#go'); await b.page.click('#go'); await settle(b, 2, 3000);
    check('la página de pago cuenta su vista y el cobro abierto una vez, sin el correo ni el plan', b.bodies().join('|') === '{"e":"view","p":"pay","s":"linkedin"}|{"e":"checkout_open","p":"pay","s":"linkedin"}' && (await b.page.evaluate(() => window.__checkout)) === 2 && b.stats().every((x) => !/ana|ejemplo|monthly/.test(x.body + x.referer)), b.stats());
    every.push(...b.stats()); await b.ctx.close();
  }

  console.log('Cuándo no sale nada');
  {
    // The whole walk: the home page, a search page, the payment page and the app with a note created and saved.
    const walk = async (b, home) => {
      const at = home || SITE;
      await b.page.goto(at + '/?utm_source=reddit'); await b.page.waitForSelector('.hero h1');
      await b.page.evaluate(() => { document.addEventListener('click', (e) => e.preventDefault()); document.querySelector('.hero a.btn.fill').click(); document.querySelector('nav a[href="#plans"]').click(); });
      await b.page.goto(at + '/markdown-editor-mcp.html'); await b.page.waitForSelector('h1');
      await b.page.goto(at + '/pay.html?plan=monthly&email=ana%40ejemplo.test'); await b.page.waitForSelector('#go'); await b.page.click('#go');
      await b.page.goto(at + '/src/app.html'); await appReady(b.page);
      await b.page.click('.lmd-home [data-home=new]'); await b.page.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await b.page.keyboard.type('Hola', { delay: 5 });
      await b.page.evaluate(() => LMD.cloud.start('ana@ejemplo.test').catch(() => null));
      await sleep(7000); // past the wait of the deferred request
      const src = b.sent.filter((x) => x.path === '/auth/start').map((x) => JSON.parse(x.body).src);
      const kept = await b.page.evaluate(() => Object.keys(localStorage).filter((k) => /^sharpmd:(src|counted)/.test(k)).concat(Object.keys(sessionStorage).filter((k) => /^sharpmd:(src|open)/.test(k))).join());
      return { counts: b.stats().length, src, kept, toSync: b.sent.map((x) => x.path).join() };
    };
    const quiet = (r) => r.counts === 0 && r.src.every((s) => s === undefined) && r.kept === '';
    const dnt = await open({ init: () => { Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true }); } });
    const rDnt = await walk(dnt); await dnt.ctx.close();
    check('con "No rastrear" no sale ningún conteo, ni viaja el canal al pedir el código, ni se anota nada en el navegador', quiet(rDnt), rDnt);
    const gpc = await open({ init: () => { Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true }); } });
    const rGpc = await walk(gpc); await gpc.ctx.close();
    check('con Global Privacy Control, tampoco', quiet(rGpc), rGpc);
    const own = await open({ settings: { cloudUrl: 'https://notas.ejemplo.test' } });
    await own.ctx.route('https://notas.ejemplo.test/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"no_route"}' }));
    const rOwn = await walk(own); await own.ctx.close();
    check('con un servidor propio no sale nada hacia sync.sharpmd.app', quiet(rOwn) && rOwn.toSync === '', rOwn);
    const off = await open({ settings: { cloudUrl: 'off' } });
    const rOff = await walk(off); await off.ctx.close();
    check('con SharpMD sin nube, tampoco', quiet(rOff) && rOff.toSync === '', rOff);
    const fork = await open();
    const rFork = await walk(fork, copy); await fork.ctx.close();
    check('una copia servida desde otro origen (un fork) no cuenta', rFork.counts === 0 && rFork.kept === '', rFork);
    const pub = await open();
    await pub.page.goto('https://pages.sharpmd.app/demo/'); await pub.page.waitForSelector('h1'); await pub.page.evaluate(() => document.querySelector('a').addEventListener('click', (e) => e.preventDefault())); await pub.page.click('a'); await sleep(1500);
    const pubSrc = fs.readFileSync(path.join(root, 'src', 'publish.js'), 'utf8'); const server = fs.readFileSync(path.join(root, 'server', 'server.mjs'), 'utf8'); const pagesBlock = server.slice(server.indexOf('async function pagesServe'), server.indexOf('async function pagesServe') + 6000);
    check('un sitio publicado no cuenta: ni aunque cargara el script, ni lo lleva en sus páginas', pub.stats().length === 0 && !/count\.js|\/stats|sharpmdCount/.test(pubSrc) && !/count\.js|statAdd|statsHit/.test(pagesBlock), pub.bodies());
    await pub.ctx.close();

    // El interruptor de Ajustes > Avanzado.
    const sw = await open();
    await sw.page.goto(APP); await appReady(sw.page); await settle(sw, 1);
    await sw.page.click('[data-act=settings]'); await sw.page.waitForSelector('.lmd-panel:not([hidden])'); await sw.page.click('[data-ptab=adv]');
    const box = sw.page.locator('.lmd-panel input[data-key=usageCounts]');
    const shown = await sw.page.evaluate(() => { const i = document.querySelector('.lmd-panel input[data-key=usageCounts]'); const sec = i.closest('section'); return { on: i.checked, label: i.closest('label').textContent.trim(), hint: sec.querySelector('.lmd-hint').textContent.trim(), seen: !!i.offsetParent }; });
    check('Ajustes > Avanzado tiene "Send anonymous usage counts", prendido, con un renglón que dice qué se manda', shown.on && shown.seen && shown.label === 'Send anonymous usage counts' && /^What is sent is the name of an event \(the app opened, a first note, a first edit\) and the channel you came from, such as "reddit"\. No cookie, no identifier, and nothing about your notes\./.test(shown.hint), shown);
    await box.uncheck(); await sleep(600); await sw.page.click('[data-act=close-panel]');
    const n0 = sw.stats().length;
    await sw.page.click('.lmd-home [data-home=new]'); await sw.page.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await sw.page.keyboard.type('Hola', { delay: 5 });
    await sw.page.evaluate(() => LMD.cloud.start('ana@ejemplo.test').catch(() => null));
    const tab = await sw.ctx.newPage(); await tab.goto(APP); await appReady(tab);
    const site2 = await sw.ctx.newPage(); await site2.goto(SITE + '/?site&utm_source=reddit'); await site2.waitForSelector('.hero h1'); await sleep(7000);
    const offSrc = sw.sent.filter((x) => x.path === '/auth/start').map((x) => JSON.parse(x.body).src);
    check('apagado, no sale nada: ni de la app, ni de otra pestaña, ni de la portada, ni el canal al pedir el código', n0 === 1 && sw.stats().length === 1 && offSrc.length === 1 && offSrc[0] === undefined && (await tab.evaluate(() => JSON.parse(localStorage.getItem('mdtools:settings')).usageCounts)) === false, [n0, sw.bodies(), offSrc]);
    await tab.click('[data-act=settings]'); await tab.waitForSelector('.lmd-panel:not([hidden])'); await tab.click('[data-ptab=adv]'); await tab.locator('.lmd-panel input[data-key=usageCounts]').check(); await sleep(600); await tab.click('[data-act=close-panel]');
    await tab.click('.lmd-home [data-home=new]'); await tab.waitForSelector('.lmd-draft, .lmd-article .lmd-editable', { timeout: 15000 }); await settle(sw, 2, 5000);
    check('y al volver a prenderlo, vuelve a contar', sw.bodies().slice(1).join('|') === '{"e":"note_created","p":"app","s":"direct"}', sw.bodies());
    every.push(...sw.stats()); await sw.ctx.close();
  }

  console.log('La extensión');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const injected = manifest.content_scripts.flatMap((c) => c.js || []);
    check('la extensión no inyecta count.js en ninguna página: sobre un archivo del disco ese código no existe', !injected.some((f) => /count\.js/.test(f)) && injected.includes('src/content.js'), injected.filter((f) => /count/.test(f)));
    ext = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1300, height: 900 }, locale: 'en-US', ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--disable-features=DisableLoadExtensionCommandLineSwitch'] });
    const worker = ext.serviceWorkers()[0] || await ext.waitForEvent('serviceworker', { timeout: 15000 }); const id = new URL(worker.url()).host;
    const out = []; ext.on('request', (r) => { if (!/^(file|chrome-extension|chrome|data|blob|about|devtools):/.test(r.url())) out.push(r.url()); });
    await ext.route('**/*', (r) => (/^https?:/.test(r.request().url()) ? r.abort() : r.continue()));
    const admin = await ext.newPage(); await admin.goto('chrome://extensions'); await admin.waitForTimeout(800);
    await admin.evaluate(async () => { for (const e of await chrome.developerPrivate.getExtensionsInfo()) await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: e.id, fileAccess: true }); });
    await admin.close();
    // Una copia del ejemplo, para poder editarla y guardarla sin tocar el repositorio.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfunnel-doc-')); fs.writeFileSync(path.join(dir, 'nota.md'), '# Nota del disco\n\nUn texto que no sale de esta máquina.\n');
    const page = await ext.newPage(); await page.goto(pathToFileURL(path.join(dir, 'nota.md')).href); await page.waitForSelector('.markdown-body h1', { timeout: 15000 });
    await page.click('[data-act=settings]').catch(() => {}); await sleep(7000);
    const panel = await page.evaluate(() => { const p = document.querySelector('.lmd-panel'); return p && !p.hidden ? { there: true, sw: !!p.querySelector('input[data-key=usageCounts]') } : { there: false, sw: false }; });
    // The one request the extension installed from its ZIP makes is the daily look at the version number published on GitHub.
    const VERSION = 'https://raw.githubusercontent.com/SharpMD/sharpmd/main/manifest.json';
    check('sobre un archivo del disco la extensión no manda nada: su único pedido es mirar el número de versión publicado', out.every((u) => u === VERSION) && !out.some((u) => /sharpmd\.app/.test(u)), out);
    check('y en sus ajustes no hay nada que apagar, porque no manda conteos', panel.there && !panel.sw, panel);
    const own = await ext.newPage(); await own.goto('chrome-extension://' + id + '/src/app.html'); await own.waitForSelector('.lmd-home [data-home=new], .lmd-draft', { timeout: 20000 }); await sleep(7000);
    check('la página propia de la extensión tampoco manda conteos', !out.some((u) => /\/stats|\/landing/.test(u)), out);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('Lo que viajó');
  {
    const EVENTS = ['view', 'open', 'plans', 'checkout_open', 'app_open', 'first_open', 'note_created', 'edited']; const PAGES = ['home', 'mcp', 'wysiwyg', 'pay', 'app'];
    const shape = every.map((x) => { let b = null; try { b = JSON.parse(x.body); } catch (e) { return false; } const ev = [].concat(b.e);
      return Object.keys(b).every((k) => ['e', 'p', 's', 'v'].includes(k)) && ev.every((e) => EVENTS.includes(e)) && PAGES.includes(b.p) && /^[a-z0-9-]{1,24}$/.test(b.s) && (b.v === undefined || b.v === 'a' || b.v === 'b') && x.body.length <= 200 && !x.cookie && !x.auth && /^text\/plain/.test(x.type) && (x.referer === '' || x.referer === 'https://sharpmd.app/'); });
    check('cada cuerpo enviado lleva solo e, p, s y v, con valores de las listas, en menos de 200 bytes y sin cookie ni sesión', every.length >= 25 && shape.every(Boolean), [every.length, every.filter((x, i) => !shape[i]).slice(0, 3)]);
    const all = every.map((x) => x.body + ' ' + x.referer).join('\n');
    check('nada de contenido, títulos, rutas, nombres de archivo, correo ni búsqueda viajó', !/secreto|Hola|Otra|sigue|ejemplo|@|\.md|\?|busqueda|lanzamiento|token|urn|item|feed|search|http[^s]|https:\/\/(?!sharpmd\.app\/$)/m.test(all.replace(/https:\/\/sharpmd\.app\/(?=\n|$)/g, '')), all.slice(0, 600));
    const got = rowsOf("day = ? AND source = 'play-store' AND page = 'app'", [today]);
    check('y lo que mandó el navegador llegó al servidor como conteo', got.includes('first_open:app:play-store::1') && countOf('checkout_open', 'linkedin') === 1 && countOf('plans', 'reddit') >= 1, got);
    check('ninguna página dio un error', errors.length === 0, errors);
  }
} catch (e) {
  check('la prueba corre hasta el final', false, String(e && e.stack || e).slice(0, 900));
} finally {
  if (ext) await ext.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (site) site.close();
  try { child.kill(); } catch (e) { /* ya no está */ }
  await sleep(300);
  for (const d of [data, profile]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows suelta el archivo después */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - failed) + ' de ' + results.length + ' pruebas pasaron');
process.exit(failed ? 1 : 0);
