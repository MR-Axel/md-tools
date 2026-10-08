// Galería de la comunidad: enviar un aporte, el correo de revisión con sus enlaces, la página que pide confirmar,
// aprobar y rechazar, la lista pública, y en la app agregar una plantilla, un tema y una paleta, sin conexión y
// en pantalla chica. Corre contra un servidor local; el correo y el aviso opcional caen en un servidor de prueba.
import http from 'http';
import { rig, tally, sleep } from './rig.mjs';
const { check, done } = tally();

const mails = []; const pings = [];
const hook = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { (req.url === '/notify' ? pings : mails).push(JSON.parse(b)); } catch (e) { /* cuerpo raro */ } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
const hookUrl = 'http://127.0.0.1:' + hook.address().port;
const R = await rig({ FEEDBACK_TO: 'revisa@ejemplo.test', MAIL_WEBHOOK: hookUrl + '/mail', GALLERY_NOTIFY_URL: hookUrl + '/notify' });
const { api } = R; const admin = { 'x-admin-key': R.ADMIN };
const from = (ip) => ({ 'x-forwarded-for': ip });
const linksOf = (mail) => ({ approve: (/Approve: (\S+)/.exec(mail.text) || [])[1], reject: (/Reject: (\S+)/.exec(mail.text) || [])[1] });
const page = (url) => fetch(url).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));
const confirm = (link, reason) => { const u = new URL(link); const body = new URLSearchParams(u.search); if (reason) body.set('reason', reason); return fetch(u.origin + u.pathname, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).then(async (r) => ({ status: r.status, text: await r.text() })); };
const waitMail = async (n) => { for (let i = 0; i < 40 && mails.length < n; i++) await sleep(50); return mails[n - 1]; };
const TEMPLATE = { type: 'template', name: 'Weekly review <b>', about: 'What went well and what comes next', lang: 'en', author: 'Ana P.', data: { text: '# Weekly review {{date}}\n\n## Went well\n\n- \n\n## Next\n\n- [ ] \n' } };
const THEME = { type: 'theme', name: 'Paper and ink', about: 'Warm paper with a blue accent', lang: 'en', author: 'Pro Q.', data: { accent: '#2563eb', paperLight: '#fdf6e3', paperDark: '#0b1020', font: 'Georgia', codeColor: '#a855f7' } };
const THEME_FREE = { type: 'theme', name: 'Night code', about: 'Dark with green code', lang: 'en', author: 'Ana P.', data: { mode: 'dark', codeColor: '#22c55e', diagramShape: 'square' } };
const PALETTE = { type: 'palette', name: 'Sunset', about: 'Warm tones', lang: 'en', author: 'Ana P.', data: { colors: { fill: '#ffedd5', text: '#7c2d12', border: '#f97316', line: '#c2410c', second: '#fee2e2', third: '#fef3c7' } } };

console.log('Galería de la comunidad');
try {
  const ana = await R.signup('ana@ejemplo.test'); const pro = await R.signup('pro@ejemplo.test', true); const leo = await R.signup('leo@ejemplo.test');
  mails.length = 0;

  // ---------- Servidor ----------
  const empty = await api('GET', '/gallery');
  check('la galería pública responde sin sesión, vacía, con caché corta', empty.status === 200 && empty.json.items.length === 0 && empty.json.open === true && /max-age=60/.test(empty.headers.get('cache-control') || ''), [empty.json, empty.headers.get('cache-control')]);
  check('enviar pide sesión', (await api('POST', '/gallery', TEMPLATE)).status === 401);
  const sent = await api('POST', '/gallery', TEMPLATE, ana.s);
  check('un aporte entra y queda pendiente', sent.status === 200 && sent.json.status === 'pending' && sent.json.id > 0 && !('account' in sent.json), sent.json);
  const mail = await waitMail(1); const links = linksOf(mail || { text: '' });
  check('llega un correo a FEEDBACK_TO con tipo, nombre, autor, cuenta, contenido y los dos enlaces', !!mail && mail.to === 'revisa@ejemplo.test' && /gallery/.test(mail.subject) && mail.text.includes('Type: template') && mail.text.includes('Name: Weekly review <b>') &&
    mail.text.includes('Shown author: Ana P.') && mail.text.includes('Account: ana@ejemplo.test') && mail.text.includes('## Went well') && !!links.approve && !!links.reject && mail.reply_to === 'ana@ejemplo.test', mail);
  for (let i = 0; i < 20 && !pings.length; i++) await sleep(50);
  check('el aviso opcional recibe una línea corta, sin correos ni enlaces', pings.length === 1 && /template/.test(pings[0].text) && !/@|http/.test(pings[0].text) && pings[0].text.length < 160, pings);
  check('lo pendiente no es público', (await api('GET', '/gallery')).json.items.length === 0 && (await api('GET', '/gallery/' + sent.json.id)).status === 404);
  const mine = await api('GET', '/gallery/mine', undefined, ana.s);
  check('quien envió ve su aporte en revisión, y otra cuenta no lo ve', mine.json.length === 1 && mine.json[0].status === 'pending' && (await api('GET', '/gallery/mine', undefined, leo.s)).json.length === 0, mine.json);

  const look = await page(links.approve);
  check('abrir el enlace muestra el aporte y pide confirmar, sin aprobar nada', look.status === 200 && look.text.includes('Weekly review &lt;b&gt;') && !look.text.includes('Weekly review <b>') && /<form method="post"/.test(look.text) && look.text.includes('ana@ejemplo.test') &&
    (await api('GET', '/gallery')).json.items.length === 0 && (await page(links.approve)).status === 200, look.text.slice(0, 300));
  check('la página no admite scripts ni marcos', /default-src 'none'/.test(look.headers.get('content-security-policy') || '') && look.headers.get('x-frame-options') === 'DENY' && !/<script/i.test(look.text));
  const yes = await confirm(links.approve);
  const pub = await api('GET', '/gallery');
  check('confirmar con el botón lo aprueba y queda público', yes.status === 200 && /Approved/.test(yes.text) && pub.json.items.length === 1 && pub.json.items[0].name === 'Weekly review <b>' && pub.json.items[0].author === 'Ana P.', [yes.status, pub.json]);
  check('la lista pública no trae correos ni la cuenta, y la plantilla va sin su texto', !/@|"user"|account|email/.test(JSON.stringify(pub.json)) && pub.json.items[0].data === undefined && pub.json.items[0].size > 10, pub.json);
  const one = await api('GET', '/gallery/' + sent.json.id);
  check('el aporte aprobado se pide entero, sin datos de la cuenta', one.status === 200 && one.json.data.text.includes('## Went well') && !/@|account|email/.test(JSON.stringify(one.json)), one.json);
  check('los enlaces sirven una sola vez: ni aprobar de nuevo ni rechazar después', (await confirm(links.approve)).status === 403 && (await confirm(links.reject, 'tarde')).status === 403 && (await page(links.reject)).status === 403 && (await api('GET', '/gallery')).json.items.length === 1);

  const t1 = await api('POST', '/gallery', THEME, pro.s); const l1 = linksOf(await waitMail(2));
  const rejPage = await page(l1.reject);
  const no = await confirm(l1.reject, 'Too close to an existing one');
  const proMine = await api('GET', '/gallery/mine', undefined, pro.s);
  check('rechazar pide confirmar, admite un motivo y quien envió lo ve', rejPage.status === 200 && /name="reason"/.test(rejPage.text) && no.status === 200 && proMine.json[0].status === 'rejected' && proMine.json[0].reason === 'Too close to an existing one' && (await api('GET', '/gallery')).json.items.length === 1, proMine.json);

  check('las rutas de administración piden la clave', (await api('GET', '/admin/gallery')).status === 403 && (await api('POST', '/admin/gallery', { id: t1.json.id, action: 'approve' })).status === 403);
  const t2 = await api('POST', '/gallery', THEME, pro.s); const f1 = await api('POST', '/gallery', THEME_FREE, ana.s); const p1 = await api('POST', '/gallery', PALETTE, ana.s);
  const pend = await api('GET', '/admin/gallery', undefined, undefined, admin);
  check('administración: lista lo pendiente con su cuenta y su contenido', pend.status === 200 && pend.json.length === 3 && pend.json.every((x) => x.status === 'pending' && /@ejemplo\.test$/.test(x.account) && x.data), pend.json.map((x) => [x.id, x.status, x.account]));
  for (const id of [t2.json.id, f1.json.id, p1.json.id]) await api('POST', '/admin/gallery', { id, action: 'approve' }, undefined, admin);
  const all = await api('GET', '/gallery');
  check('administración: aprobar publica, y el tema y la paleta llegan con sus valores', all.json.total === 4 && all.json.items.find((x) => x.type === 'palette').data.colors.fill === '#ffedd5' && all.json.items.find((x) => x.id === t2.json.id).data.accent === '#2563eb', all.json);
  check('la lista se filtra por tipo y por texto', (await api('GET', '/gallery?type=theme')).json.total === 2 && (await api('GET', '/gallery?q=sunset')).json.total === 1 && (await api('GET', '/gallery?q=zzz')).json.total === 0 && (await api('GET', '/gallery?type=palette&q=warm')).json.total === 1);

  const a1 = await api('POST', '/gallery/' + p1.json.id + '/add', undefined, undefined, from('10.1.1.1')); const a2 = await api('POST', '/gallery/' + p1.json.id + '/add', undefined, undefined, from('10.1.1.1'));
  const a3 = await api('POST', '/gallery/' + p1.json.id + '/add', undefined, undefined, from('10.1.1.2'));
  check('el contador de agregados suma una vez por IP y por aporte', a1.json.adds === 1 && a2.json.adds === 1 && a3.json.adds === 2 && (await api('POST', '/gallery/99999/add')).status === 404, [a1.json, a2.json, a3.json]);
  check('la lista sale ordenada por los más agregados', (await api('GET', '/gallery')).json.items[0].id === p1.json.id && (await api('GET', '/gallery?sort=new')).json.items[0].id !== undefined);

  const extra = await api('POST', '/gallery', Object.assign({}, PALETTE, { name: 'To remove' }), ana.s);
  await api('POST', '/admin/gallery', { id: extra.json.id, action: 'approve' }, undefined, admin);
  const gone = await api('POST', '/admin/gallery', { id: extra.json.id, action: 'remove', reason: 'Duplicate' }, undefined, admin);
  const anaMine = await api('GET', '/gallery/mine', undefined, ana.s);
  check('administración: retirar algo aprobado lo saca de la lista y quien envió lo ve retirado', gone.json.status === 'removed' && (await api('GET', '/gallery')).json.total === 4 && anaMine.json.find((x) => x.id === extra.json.id).status === 'removed' && anaMine.json.find((x) => x.id === extra.json.id).reason === 'Duplicate', anaMine.json);
  check('nadie retira el aporte de otra cuenta', (await api('DELETE', '/gallery/' + p1.json.id, undefined, leo.s)).status === 404 && (await api('GET', '/gallery')).json.total === 4);
  const sixth = await api('POST', '/gallery', Object.assign({}, PALETTE, { name: 'One more' }), ana.s); const seventh = await api('POST', '/gallery', Object.assign({}, PALETTE, { name: 'Too many' }), ana.s);
  check('cinco envíos por día por cuenta', sixth.status === 200 && seventh.status === 429 && seventh.json.error === 'too_many' && seventh.json.retry_after > 0, [sixth.status, seventh.json]);
  check('quien envió retira el suyo, pendiente o publicado', (await api('DELETE', '/gallery/' + sixth.json.id, undefined, ana.s)).status === 200 && (await api('DELETE', '/gallery/' + extra.json.id, undefined, ana.s)).status === 200 && (await api('GET', '/gallery/mine', undefined, ana.s)).json.length === 3);

  // ---------- App ----------
  const TID = sent.json.id; const PID = p1.json.id; const PAID = t2.json.id; const FREE = f1.json.id;
  const openTools = async (pg) => { await pg.click('[data-act=settings]'); await pg.waitForSelector('.lmd-panel-card'); await pg.click('[data-ptab=tools]'); await pg.waitForSelector('.lmd-gal-card, .lmd-gal-note:not([hidden]), .lmd-gal-list .lmd-empty'); };
  const closePanel = async (pg) => { await pg.click('[data-act=close-panel]'); await pg.waitForTimeout(150); };
  const card = (id) => '.lmd-gal-card[data-gid="' + id + '"]';
  const kept = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('mdtools:community') || 'null'));
  const cfg = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('mdtools:settings') || '{}'));

  const A = await R.open(leo, { colorScheme: 'light' }); const pg = A.page;
  await pg.goto(R.home); await pg.waitForSelector('[data-home=tpl]');
  await openTools(pg);
  const cards = await pg.evaluate(() => [...document.querySelectorAll('.lmd-gal-card')].map((c) => ({ id: +c.dataset.gid, kind: c.dataset.gkind, name: c.querySelector('b').textContent, html: c.querySelector('b').innerHTML, by: c.querySelector('.lmd-gal-by').textContent })));
  check('la sección Comunidad lista lo aprobado, con el más agregado primero', cards.length === 4 && cards[0].id === PID && /by Ana P\./.test(cards[0].by) && /Added 2 times/.test(cards[0].by), cards);
  check('el nombre de un aporte se muestra como texto', cards.find((c) => c.id === TID).name === 'Weekly review <b>' && cards.find((c) => c.id === TID).html === 'Weekly review &lt;b&gt;', cards.find((c) => c.id === TID));
  check('el lugar para herramientas de la comunidad sigue vacío: acá solo hay contenido', await pg.evaluate(() => { const c = document.querySelector('[data-tools-community]'); return c.hidden && !c.children.length && LMD.tools.community.length === 0; }));
  await pg.click('[data-gtype=template]'); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card').length === 1);
  const onlyTpl = await pg.evaluate(() => [...document.querySelectorAll('.lmd-gal-card')].map((c) => c.dataset.gkind).join());
  await pg.click('[data-gtype=""]'); await pg.fill('.lmd-gal-q', 'sunset'); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card').length === 1 && document.querySelector('.lmd-gal-card').dataset.gkind === 'palette');
  await pg.fill('.lmd-gal-q', 'nada de nada'); await pg.waitForSelector('.lmd-gal-list .lmd-empty');
  const none = await pg.textContent('.lmd-gal-list .lmd-empty');
  await pg.fill('.lmd-gal-q', ''); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card').length === 4);
  check('se filtra por tipo y con el buscador', onlyTpl === 'template' && /No contribution matches/.test(none), [onlyTpl, none]);

  // Plantilla: vista previa y agregar
  await pg.click(card(TID) + ' [data-gal=view]'); await pg.waitForSelector('.lmd-gal-view .lmd-gal-md h1');
  const pv = await pg.evaluate(() => ({ h1: document.querySelector('.lmd-gal-view .lmd-gal-md h1').textContent, title: document.querySelector('.lmd-gal-view h3').firstChild.textContent, raw: document.querySelector('.lmd-gal-view h3 b') }));
  await pg.click('.lmd-gal-view [data-gv=add]'); await pg.waitForFunction((sel) => /Remove/.test(document.querySelector(sel + ' [data-gal=remove]')?.textContent || ''), card(TID));
  const afterTpl = await kept(pg);
  check('la plantilla tiene vista previa dibujada como una nota y se agrega', /Weekly review/.test(pv.h1) && pv.title === 'Weekly review <b>' && pv.raw === null && afterTpl.templates.length === 1 && afterTpl.templates[0].id === TID && /## Went well/.test(afterTpl.templates[0].data.text), [pv, afterTpl]);
  await sleep(300);
  check('agregar suma al contador del aporte', (await api('GET', '/gallery/' + TID)).json.adds === 1);

  // Paleta
  await pg.click(card(PID) + ' [data-gal=add]'); await pg.waitForSelector(card(PID) + ' [data-gal=remove]');
  const pal = await pg.evaluate(() => { const D = LMD.diagram; const code = D.withPalette('mermaid', 'graph LR\n  A --> B', D.PALETTES.length); return { code, back: D.paletteOf('mermaid', code) === D.PALETTES.length, house: D.PALETTES.length }; });
  check('la paleta agregada pinta un diagrama como las de la casa', pal.house === 8 && pal.back && /#ffedd5/.test(pal.code) && /#f97316/.test(pal.code), pal);

  // Temas: el que usa colores y tipografía es del plan pago; el que no, se aplica y se puede volver
  const before = await cfg(pg);
  await pg.click(card(PAID) + ' [data-gal=add]'); await pg.waitForSelector('.lmd-gal-view .lmd-extra');
  const locked = await pg.evaluate(() => ({ note: document.querySelector('.lmd-gal-view .lmd-extra p').textContent, add: !!document.querySelector('.lmd-gal-view [data-gv=add]'), sample: !!document.querySelector('.lmd-gal-view .lmd-gal-sample'), bg: document.querySelector('.lmd-gal-view .lmd-gal-sample').style.background, pay: !!document.querySelector('.lmd-gal-view [data-pay] [data-gv=plans]') }));
  await pg.evaluate(() => document.documentElement.classList.add('lmd-store-app'));
  const payHidden = await pg.evaluate(() => getComputedStyle(document.querySelector('.lmd-gal-view [data-pay]')).display === 'none');
  await pg.evaluate(() => document.documentElement.classList.remove('lmd-store-app'));
  await pg.click('.lmd-gal-view [data-gv=close]');
  const still = await cfg(pg);
  check('sin el plan pago, un tema con colores y tipografía muestra su vista previa y el aviso del plan, y no se aplica', /paid plan/.test(locked.note) && !locked.add && locked.sample && /253, 246, 227|fdf6e3/i.test(locked.bg) && locked.pay && !still.accent && !still.paperLight && !still.fontFamily && JSON.stringify(before) === JSON.stringify(still), [locked, still]);
  check('dentro de la app de Android no se muestra el enlace a los planes', payHidden);
  await pg.click(card(FREE) + ' [data-gal=add]'); await pg.waitForFunction(() => document.documentElement.classList.contains('lmd-dark'));
  await pg.waitForSelector('.lmd-gal-theme:not([hidden])');
  const on = await pg.evaluate(() => ({ dark: document.documentElement.classList.contains('lmd-dark'), tint: document.documentElement.style.getPropertyValue('--code-tint'), square: !document.documentElement.classList.contains('lmd-dgm-round'), strip: document.querySelector('.lmd-gal-theme span').textContent }));
  await pg.click('.lmd-gal-theme [data-gal=back]'); await pg.waitForFunction(() => document.documentElement.classList.contains('lmd-light'));
  const off = await pg.evaluate(() => ({ light: document.documentElement.classList.contains('lmd-light'), tint: document.documentElement.style.getPropertyValue('--code-tint'), round: document.documentElement.classList.contains('lmd-dgm-round'), strip: document.querySelector('.lmd-gal-theme').hidden }));
  check('un tema que no toca lo del plan pago se aplica en vivo', on.dark && on.tint === '#22c55e' && on.square && /Night code/.test(on.strip), on);
  check('y se vuelve al anterior', off.light && off.tint === '' && off.round && off.strip, off);

  // ---------- Claves nuevas del tema: paneles, texto, secundario, bordes y enlaces ----------
  const FULL = { mode: 'dark', paperDark: '#0d1524', accent: '#7cc4ff', surface: '#152036', text: '#dfe7f5', muted: '#9aa9c2', border: '#24324d', link: '#8fb8ff' };
  const WRONG = [['sin modo fijo', { text: '#dfe7f5' }], ['con modo automático', { mode: 'auto', text: '#dfe7f5' }], ['texto que no se lee', { mode: 'dark', text: '#30343c' }], ['secundario que no se lee', { mode: 'light', muted: '#c9c9c9' }],
    ['panel que tapa el texto', { mode: 'dark', surface: '#d0d0d0' }], ['borde más fuerte que el texto', { mode: 'light', text: '#6a6a6a', border: '#000000' }], ['enlace que no se lee', { mode: 'light', link: '#ffe08a' }],
    ['color con url()', { mode: 'dark', surface: 'url(https://x.invalid/a.png)' }], ['color con CSS pegado', { mode: 'dark', text: '#dfe7f5;background:red' }], ['una clave parecida', { mode: 'dark', background: '#000000' }]];
  const local = await pg.evaluate(([full, wrong]) => ({ ok: LMD.community.checkData('theme', full), bad: wrong.filter((w) => LMD.community.checkData('theme', w[1]) !== null).map((w) => w[0]), paid: LMD.community.needsPlan({ mode: 'dark', text: '#dfe7f5' }),
    to: LMD.community.toSettings(full) }), [FULL, WRONG]);
  check('la app acepta un tema con las claves nuevas y rechaza el que no deja leer (' + WRONG.length + ' casos)', JSON.stringify(local.ok) === JSON.stringify(FULL) && local.bad.length === 0, local);
  check('las claves nuevas son del plan pago y van a ajustes propios, sin CSS', local.paid && local.to.colSurface === '#152036' && local.to.colText === '#dfe7f5' && local.to.colMuted === '#9aa9c2' && local.to.colBorder === '#24324d' && local.to.colLink === '#8fb8ff' && local.to.preset === '', local.to);
  const tem = await R.signup('temas@ejemplo.test', true);
  const okPost = await api('POST', '/gallery', { type: 'theme', name: 'Deep tide', about: '', lang: 'en', author: 'Tema T.', data: FULL }, tem.s);
  const badPost = []; for (const w of WRONG) { const r = await api('POST', '/gallery', { type: 'theme', name: 'Wrong one', about: '', lang: 'en', author: 'Tema T.', data: w[1] }, tem.s); if (r.status !== 400 || r.json.error !== 'bad_data') badPost.push([w[0], r.status]); }
  check('el servidor acepta las mismas claves y rechaza los mismos casos', okPost.status === 200 && badPost.length === 0 && JSON.stringify((await api('GET', '/gallery/mine', undefined, tem.s)).json.map((x) => x.name)) === '["Deep tide"]', [okPost.status, okPost.json, badPost]);
  await api('DELETE', '/gallery/' + okPost.json.id, undefined, tem.s);

  // ---------- Temas incluidos ----------
  await pg.click('[data-gtype=theme]'); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card[data-gkind=included]').length === 12 && document.querySelectorAll('.lmd-gal-card[data-gkind=theme]').length === 2);
  const inc = await pg.evaluate(() => { const all = [...document.querySelectorAll('.lmd-gal-card')]; const own = all.filter((c) => c.dataset.gkind === 'included');
    return { first: all.slice(0, 12).every((c) => c.dataset.gkind === 'included'), names: own.map((c) => c.querySelector('b').textContent).join(), tags: own.every((c) => c.querySelector('.lmd-tag').textContent === 'Included'), thumbs: own.every((c) => c.querySelector('.lmd-th-page')), about: own.every((c) => c.querySelector('.lmd-gal-about').textContent.length > 8 && !/[!¡—–]/.test(c.textContent)),
      paid: own.filter((c) => /Paid plan/.test(c.querySelector('.lmd-gal-by').textContent)).length, report: own.some((c) => c.querySelector('[data-gal=report]')), on: own.filter((c) => c.querySelector('[data-gal=add]').disabled).map((c) => c.dataset.gid).join() }; });
  check('en Temas, la galería arranca con los doce incluidos, marcados y con su miniatura', inc.first && inc.names === 'Lime,Sand,Chalk,Sage,Mist,Ink,Night,Coal,Tide,Forest,Lagoon,Plum' && inc.tags && inc.thumbs && inc.about && inc.paid === 8 && !inc.report && inc.on === 'lima', inc);
  await pg.fill('.lmd-gal-q', 'plum'); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card').length === 1);
  const found = await pg.evaluate(() => document.querySelector('.lmd-gal-card').dataset.gid);
  await pg.fill('.lmd-gal-q', ''); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card[data-gkind=included]').length === 12);
  check('el buscador también los encuentra', found === 'ciruela', found);
  const reqs = []; const spy = (r) => { if (r.url().startsWith(R.base) && /\/gallery\//.test(r.url())) reqs.push(r.method() + ' ' + new URL(r.url()).pathname); }; pg.on('request', spy);
  await pg.click(card('arena') + ' [data-gal=add]'); await pg.waitForFunction(() => document.documentElement.classList.contains('lmd-themed'));
  await pg.waitForFunction((sel) => document.querySelector(sel + ' [data-gal=add]').disabled, card('arena'));
  const sand = await pg.evaluate(() => ({ bg: document.documentElement.style.getPropertyValue('--bg'), btn: document.querySelector('.lmd-gal-card[data-gid=arena] [data-gal=add]').textContent }));
  check('uno gratis se aplica desde la galería, sin pasar por el servidor', sand.bg === '#f6efe0' && sand.btn === 'Applied' && (await cfg(pg)).preset === 'arena' && reqs.length === 0, [sand, reqs]);
  pg.off('request', spy);
  await pg.click(card('marea') + ' [data-gal=add]'); await pg.waitForSelector('.lmd-gal-view .lmd-extra');
  const incLocked = await pg.evaluate(() => ({ note: document.querySelector('.lmd-gal-view .lmd-extra p').textContent, add: !!document.querySelector('.lmd-gal-view [data-gv=add]'), thumb: getComputedStyle(document.querySelector('.lmd-gal-view .lmd-th-page')).backgroundColor, pay: !!document.querySelector('.lmd-gal-view [data-pay] [data-gv=plans]') }));
  await pg.evaluate(() => document.documentElement.classList.add('lmd-store-app'));
  const incPayHidden = await pg.evaluate(() => getComputedStyle(document.querySelector('.lmd-gal-view [data-pay]')).display === 'none');
  await pg.evaluate(() => document.documentElement.classList.remove('lmd-store-app'));
  await pg.click('.lmd-gal-view [data-gv=close]');
  check('uno del plan pago muestra su vista previa y el aviso del plan, y no se aplica', /paid plan/.test(incLocked.note) && !/[!¡—–]/.test(incLocked.note) && !incLocked.add && incLocked.thumb === 'rgb(13, 21, 36)' && incLocked.pay && incPayHidden && (await cfg(pg)).preset === 'arena', incLocked);
  await pg.click(card('lima') + ' [data-gal=add]'); await pg.waitForFunction(() => !document.documentElement.classList.contains('lmd-themed'));
  check('y el de siempre vuelve con un clic', (await cfg(pg)).preset === '' && (await cfg(pg)).theme === 'light');
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('mdtools:settings')); s.theme = 'auto'; localStorage.setItem('mdtools:settings', JSON.stringify(s)); });
  await pg.click('[data-gtype=""]'); await pg.waitForFunction(() => document.querySelectorAll('.lmd-gal-card[data-gkind=included]').length === 0 && document.querySelectorAll('.lmd-gal-card').length === 4);

  // Denunciar un aporte
  const nMail = mails.length;
  await pg.click(card(PID) + ' [data-gal=report]'); await pg.waitForSelector('.lmd-report-card');
  const repTitle = await pg.textContent('.lmd-report-card h3');
  await pg.fill('.lmd-report-card textarea', 'Not original'); await pg.click('.lmd-report-card [data-rp=send]');
  const rep = await waitMail(nMail + 1);
  check('cada aporte se puede denunciar con el diálogo de siempre', /Report this contribution/.test(repTitle) && !!rep && rep.subject === 'SharpMD report' && /Kind: gallery/.test(rep.text) && rep.text.includes('#' + PID + ' palette Sunset') && /Not original/.test(rep.text), rep);
  await pg.waitForSelector('.lmd-report-card', { state: 'detached' });
  await closePanel(pg);

  // La plantilla agregada aparece en "Desde una plantilla", marcada, y se puede quitar
  await pg.click('[data-home=tpl]'); await pg.waitForSelector('.lmd-tpl-card');
  const inPicker = await pg.evaluate(() => { const rows = [...document.querySelectorAll('.lmd-tpl-list [data-id]')]; const row = rows.find((r) => r.dataset.id.startsWith('c:')); const label = row && row.previousElementSibling; return { row: row && row.textContent, html: row && row.innerHTML, label: label && label.textContent, total: rows.length }; });
  await pg.click('.lmd-tpl-list [data-id="c:' + TID + '"]');
  const picked = await pg.evaluate(() => ({ h1: document.querySelector('.lmd-tpl-prev h1')?.textContent || '', rm: !document.querySelector('[data-tpl=rm]').hidden, date: /\d{4}-\d{2}-\d{2}/.test(document.querySelector('.lmd-tpl-prev h1')?.textContent || '') }));
  check('la plantilla agregada sale en Desde una plantilla, en el grupo Comunidad', inPicker.row === 'Weekly review <b>' && inPicker.html === 'Weekly review &lt;b&gt;' && inPicker.label === 'Community' && inPicker.total === 27 && /Weekly review/.test(picked.h1) && picked.date && picked.rm, [inPicker, picked]);
  await pg.click('.lmd-tpl-list [data-id=daily]');
  const houseRm = await pg.evaluate(() => document.querySelector('[data-tpl=rm]').hidden);
  await pg.keyboard.press('Escape');

  // Sin conexión: se ve lo agregado y sigue sirviendo
  await R.stop();
  await openTools(pg);
  const offline = await pg.evaluate(() => ({ note: document.querySelector('.lmd-gal-note').textContent, hidden: document.querySelector('.lmd-gal-note').hidden, cards: [...document.querySelectorAll('.lmd-gal-card')].map((c) => c.dataset.gkind + ':' + c.querySelector('b').textContent), report: !!document.querySelector('.lmd-gal-report') }));
  check('sin conexión la sección muestra lo ya agregado y una línea que lo explica', !offline.hidden && /cannot be reached/.test(offline.note) && offline.cards.length === 2 && offline.cards.includes('template:Weekly review <b>') && offline.cards.includes('palette:Sunset') && !offline.report, offline);
  await pg.click('.lmd-gal-card[data-gkind=template] [data-gal=view]'); await pg.waitForSelector('.lmd-gal-view .lmd-gal-md h1');
  const offPrev = await pg.textContent('.lmd-gal-view .lmd-gal-md h1'); await pg.click('.lmd-gal-view [data-gv=close]');
  await closePanel(pg);
  await pg.click('[data-home=tpl]'); await pg.waitForSelector('.lmd-tpl-card');
  const offPick = await pg.evaluate(() => !!document.querySelector('.lmd-tpl-list [data-id^="c:"]'));
  await pg.click('.lmd-tpl-list [data-id^="c:"]'); await pg.click('[data-tpl=rm]'); await pg.waitForFunction(() => !document.querySelector('.lmd-tpl-list [data-id^="c:"]'));
  const afterRm = await kept(pg); const groupGone = await pg.evaluate(() => ![...document.querySelectorAll('.lmd-tpl-list .lmd-menu-label')].some((p) => p.textContent === 'Community'));
  await pg.keyboard.press('Escape');
  check('sin conexión la plantilla agregada se ve y se usa, y se puede quitar', /Weekly review/.test(offPrev) && offPick && afterRm.templates.length === 0 && afterRm.palettes.length === 1 && groupGone && houseRm, [offPrev, offPick, afterRm]);
  await R.start();
  await A.ctx.close();

  // Con el plan pago el tema completo se aplica, y se vuelve
  const B = await R.open(pro, { colorScheme: 'light' }); const pp = B.page;
  await pp.goto(R.home); await pp.waitForSelector('[data-home=tpl]');
  await pp.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('mdtools:settings')).supporter === true; } catch (e) { return false; } }, null, { timeout: 15000 }).catch(() => {});
  await openTools(pp);
  await pp.click(card(PAID) + ' [data-gal=view]'); await pp.waitForSelector('.lmd-gal-view [data-gv=add]');
  await pp.click('.lmd-gal-view [data-gv=add]'); await pp.waitForFunction(() => document.documentElement.style.getPropertyValue('--bg') === '#fdf6e3');
  const full = await pp.evaluate(() => { const st = document.documentElement.style; return { bg: st.getPropertyValue('--bg'), fill: st.getPropertyValue('--accent-fill'), font: st.getPropertyValue('--lmd-font'), tint: st.getPropertyValue('--code-tint'), css: document.querySelectorAll('style').length }; });
  await pp.waitForSelector('.lmd-gal-theme:not([hidden])');
  await pp.click('.lmd-gal-theme [data-gal=back]'); await pp.waitForFunction(() => !document.documentElement.style.getPropertyValue('--bg'));
  const undone = await pp.evaluate(() => { const st = document.documentElement.style; return [st.getPropertyValue('--bg'), st.getPropertyValue('--accent-fill'), st.getPropertyValue('--lmd-font'), st.getPropertyValue('--code-tint')].join('|'); });
  check('con el plan pago el tema completo se aplica: acento, fondo, tipografía y color de código', full.bg === '#fdf6e3' && full.fill === '#2563eb' && /Georgia/.test(full.font) && full.tint === '#a855f7', full);
  check('y volver deja todo como estaba', undone === '|||', undone);
  await B.ctx.close();

  // Enviar desde la app: la nota abierta como plantilla, con vista previa de lo que sale
  await api('PUT', '/notes/' + encodeURIComponent('Reading log.md'), { text: '# Reading log\n\n| Book | Notes |\n|---|---|\n|  |  |\n' }, leo.s);
  const S = await R.open(leo); const sp = S.page; const posted = [];
  sp.on('request', (r) => { if (r.method() === 'POST' && /\/gallery$/.test(new URL(r.url()).pathname)) posted.push(r.postData()); });
  await sp.goto(R.noteUrl('Reading log.md')); await sp.waitForSelector('.lmd-article:not([hidden]) h1');
  await openTools(sp);
  await sp.click('[data-gal=share]'); await sp.waitForSelector('.lmd-gal-share');
  const form = await sp.evaluate(() => ({ kind: document.querySelector('.lmd-gal-share input[type=radio]:checked').value, name: document.querySelector('[data-gs=name]').value, lang: document.querySelector('[data-gs=lang]').value, line: document.querySelector('.lmd-gal-share > .lmd-hint').textContent, prev: !!document.querySelector('.lmd-gal-share .lmd-gal-md table') }));
  await sp.click('[data-gs=send]'); const needName = await sp.textContent('.lmd-gal-share .lmd-img-err');
  await sp.fill('[data-gs=about]', 'Books and what stayed'); await sp.fill('[data-gs=author]', 'leo@ejemplo.test'); await sp.click('[data-gs=send]');
  const needAuthor = await sp.textContent('.lmd-gal-share .lmd-img-err');
  await sp.fill('[data-gs=author]', 'Leo R.');
  const shown = await sp.evaluate(() => document.querySelector('.lmd-gal-share [data-gs=prev]').innerText);
  const nBefore = mails.length;
  await sp.click('[data-gs=send]'); await sp.waitForSelector('.lmd-gal-share .lmd-fb-ok');
  const shareMail = await waitMail(nBefore + 1); const body = JSON.parse(posted[0] || '{}');
  check('compartir abre con la nota como plantilla, su vista previa y la línea que dice qué pasa', form.kind === 'template' && form.name === 'Reading log' && form.lang === 'en' && /goes to review/.test(form.line) && /public under the name you chose/.test(form.line) && form.prev && /Reading log/.test(shown) && /by Leo R\./.test(shown), [form, shown]);
  check('pide un nombre público que no sea un correo', /public name/.test(needAuthor) && posted.length === 1, [needName, needAuthor, posted.length]);
  check('el envío lleva solo el tipo, los datos escritos y el contenido', Object.keys(body).sort().join() === 'about,author,data,lang,name,type' && Object.keys(body.data).join() === 'text' && body.data.text.startsWith('# Reading log') && !/ejemplo\.test|Reading log\.md|cloud\//.test(posted[0]), body);
  check('y dispara el correo de revisión', !!shareMail && /Name: Reading log/.test(shareMail.text) && /Account: leo@ejemplo.test/.test(shareMail.text) && /Shown author: Leo R\./.test(shareMail.text), shareMail);
  await sp.waitForSelector('.lmd-gal-my');
  const my = await sp.evaluate(() => [...document.querySelectorAll('.lmd-gal-my')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('quien envió ve el estado de su aporte en la app', my.length === 1 && /Reading log/.test(my[0]) && /IN REVIEW|In review/i.test(my[0]) && /Withdraw/.test(my[0]), my);
  await sp.waitForSelector('.lmd-gal-share', { state: 'detached' });
  // Una paleta, desde el mismo diálogo
  await sp.click('[data-gal=share]'); await sp.waitForSelector('.lmd-gal-share');
  await sp.check('.lmd-gal-share input[value=palette]');
  const palForm = await sp.evaluate(() => ({ colors: !document.querySelector('.lmd-gal-colors').hidden, inputs: document.querySelectorAll('.lmd-gal-colors input[type=color]').length, sample: !!document.querySelector('.lmd-gal-share .lmd-gal-pal'), author: document.querySelector('[data-gs=author]').value }));
  await sp.check('.lmd-gal-share input[value=theme]');
  const themeForm = await sp.evaluate(() => document.querySelector('.lmd-gal-share [data-gs=prev]').innerText);
  await sp.check('.lmd-gal-share input[value=palette]'); await sp.fill('[data-gs=name]', 'Blue house'); await sp.click('[data-gs=send]'); await sp.waitForSelector('.lmd-gal-share .lmd-fb-ok');
  const palBody = JSON.parse(posted[1] || '{}');
  check('una paleta se arma con sus seis colores y se envía', palForm.colors && palForm.inputs === 6 && palForm.sample && palForm.author === 'Leo R.' && palBody.type === 'palette' && Object.keys(palBody.data.colors).length === 6 && /^#[0-9a-f]{6}$/.test(palBody.data.colors.fill), [palForm, palBody]);
  check('el tema de fábrica no tiene nada para compartir y lo dice', /no changes to share/.test(themeForm), themeForm);
  await sp.waitForSelector('.lmd-gal-share', { state: 'detached' });
  // Retirar el propio
  await sp.waitForFunction(() => document.querySelectorAll('.lmd-gal-my').length === 2);
  await sp.click('.lmd-gal-my [data-gal=withdraw]'); await sp.waitForSelector('.lmd-dlg'); await sp.click('.lmd-dlg [data-dlg=ok]');
  await sp.waitForFunction(() => document.querySelectorAll('.lmd-gal-my').length === 1);
  check('y puede retirar el suyo', (await api('GET', '/gallery/mine', undefined, leo.s)).json.length === 1);
  await S.ctx.close();

  // Sin sesión: se ve la galería, y compartir pide entrar
  const G = await R.open(null); const gp = G.page;
  await gp.goto(R.home); await gp.waitForSelector('[data-home=tpl]'); await openTools(gp);
  const guestCards = await gp.evaluate(() => document.querySelectorAll('.lmd-gal-card').length);
  await gp.click('[data-gal=share]'); await gp.waitForSelector('.lmd-dlg');
  const ask = await gp.textContent('.lmd-dlg-card'); await gp.click('.lmd-dlg [data-dlg=no]');
  check('sin sesión se ve la galería y compartir pide entrar', guestCards === 4 && /Sign in to share/.test(ask) && !(await gp.$('.lmd-gal-mine:not([hidden])')), [guestCards, ask]);
  await G.ctx.close();

  // Pantalla chica
  const M = await R.open(leo, { viewport: { width: 380, height: 760 }, hasTouch: true, isMobile: true }); const mp = M.page;
  await mp.goto(R.noteUrl('Reading log.md')); await mp.waitForSelector('.lmd-article:not([hidden]) h1');
  await mp.evaluate(() => document.querySelector('[data-act=settings]').click()); await mp.waitForSelector('.lmd-panel-card'); await mp.tap('[data-ptab=tools]'); await mp.waitForSelector('.lmd-gal-card');
  const fits = (sel) => mp.evaluate((q) => { const w = window.innerWidth; const bad = [...document.querySelectorAll(q + ', ' + q + ' *')].filter((n) => n.offsetParent && !n.closest('.lmd-gal-md, .lmd-seg')).map((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > w + 1) ? n.className || n.tagName : ''; }).filter(Boolean); return { bad: bad.slice(0, 5), scroll: document.documentElement.scrollWidth <= w + 1 }; }, sel);
  const small = await fits('.lmd-gal');
  await mp.tap(card(PAID) + ' [data-gal=view]'); await mp.waitForSelector('.lmd-gal-view');
  const smallView = await fits('.lmd-gal-view'); const viewBox = await mp.evaluate(() => { const r = document.querySelector('.lmd-gal-view').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1; });
  await mp.tap('.lmd-gal-view [data-gv=close]');
  await mp.tap('[data-gal=share]'); await mp.waitForSelector('.lmd-gal-share');
  const smallShare = await fits('.lmd-gal-share'); const sendReach = await mp.evaluate(() => { const c = document.querySelector('.lmd-gal-share'); const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 && c.scrollHeight >= c.clientHeight; });
  await mp.tap('[data-gs=no]');
  check('en pantalla chica la sección entra en el ancho, sin desplazamiento horizontal', small.scroll && !small.bad.length, small);
  check('en pantalla chica la vista previa y el diálogo de compartir entran en la pantalla', smallView.scroll && !smallView.bad.length && viewBox && smallShare.scroll && !smallShare.bad.length && sendReach, [smallView, viewBox, smallShare, sendReach]);
  await M.ctx.close();

  check('nada salió hacia la nube de verdad y no hubo errores de página', R.outside.length === 0 && R.errors.length === 0, [R.outside.slice(0, 3), R.errors.slice(0, 3)]);
  check('nada de esto se anotó como error del servidor', !/error 500|error no capturado|promesa sin atender/.test(R.log()), (R.log().match(/error[^\n]*/g) || []).slice(0, 3));
} catch (e) { check('sin excepciones en la prueba', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }
await R.close(); hook.close();
process.exit(done() ? 1 : 0);
