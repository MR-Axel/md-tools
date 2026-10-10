// El plan pago comprado con Google Play dentro de la app de Android: el servidor confirma el token contra la API de
// Google (acá simulada), lo reconoce y prende el plan; los avisos de Pub/Sub y el chequeo al consultar la cuenta lo
// renuevan o lo apagan; convive con Paddle sin mezclarse. Y la pestaña Plan, dentro de la app, con la Digital Goods
// API simulada. Con el interruptor apagado no cambia nada.
import crypto from 'crypto'; import http from 'http';
import { rig, tally, sleep } from './rig.mjs';
const { check, done } = tally();

// ---------- Google de mentira: el token de acceso, las compras, el acknowledge y las claves de Pub/Sub ----------
const sa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const push = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_EMAIL = 'compras@proyecto-de-prueba.iam.gserviceaccount.com'; const PUSH_EMAIL = 'avisos@proyecto-de-prueba.iam.gserviceaccount.com';
const G = { purchases: new Map(), acks: [], tokens: 0, badJwt: 0, down: false, calls: [] };
const buy = (token, product, ms, more) => G.purchases.set(token, Object.assign({ kind: 'androidpublisher#subscriptionPurchaseV2', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  lineItems: [{ productId: product, expiryTime: new Date(Date.now() + ms).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }] }, more || {}));
const state = (token, st, ms, renew) => { const p = G.purchases.get(token); p.subscriptionState = 'SUBSCRIPTION_STATE_' + st; if (ms !== undefined) p.lineItems[0].expiryTime = new Date(Date.now() + ms).toISOString(); p.lineItems[0].autoRenewingPlan = renew ? { autoRenewEnabled: true } : {}; };
const google = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://x'); G.calls.push(req.method + ' ' + url.pathname);
    if (url.pathname === '/certs') return send(200, { keys: [Object.assign(push.publicKey.export({ format: 'jwk' }), { kid: 'clave-1', alg: 'RS256', use: 'sig' })] });
    if (G.down) return send(503, { error: 'down' });
    if (url.pathname === '/token' && req.method === 'POST') {
      // El servidor firma un JWT con la clave de la cuenta de servicio: se revisa de verdad.
      const jwt = new URLSearchParams(raw).get('assertion') || ''; const [h, c, s] = jwt.split('.');
      let claims = {}; try { claims = JSON.parse(Buffer.from(c, 'base64url').toString()); } catch (e) { /* mal armado */ }
      const good = !!s && crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), sa.publicKey, Buffer.from(s, 'base64url')) && claims.iss === SA_EMAIL && claims.scope === 'https://www.googleapis.com/auth/androidpublisher' && claims.exp > Date.now() / 1000;
      if (!good) { G.badJwt++; return send(400, { error: 'invalid_grant' }); }
      G.tokens++; return send(200, { access_token: 'acceso-de-prueba', expires_in: 3600, token_type: 'Bearer' });
    }
    if (req.headers.authorization !== 'Bearer acceso-de-prueba') return send(401, { error: 'unauthorized' });
    let m = /^\/androidpublisher\/v3\/applications\/app\.sharpmd\/purchases\/subscriptionsv2\/tokens\/([^/]+)$/.exec(url.pathname);
    if (m && req.method === 'GET') { const p = G.purchases.get(decodeURIComponent(m[1])); return p ? send(200, p) : send(404, { error: { code: 404 } }); }
    m = /^\/androidpublisher\/v3\/applications\/app\.sharpmd\/purchases\/subscriptions\/([^/]+)\/tokens\/([^/:]+):acknowledge$/.exec(url.pathname);
    if (m && req.method === 'POST') { const p = G.purchases.get(decodeURIComponent(m[2])); if (!p) return send(404, {}); p.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'; G.acks.push(m[1] + ':' + decodeURIComponent(m[2])); return send(200, {}); }
    send(404, { error: 'ruta' });
  });
});
await new Promise((r) => google.listen(0, '127.0.0.1', r));
const gUrl = 'http://127.0.0.1:' + google.address().port;
const AUD = 'https://sync.ejemplo.test/play/notifications';
const SECRET = 'firma-de-prueba';
const SA_JSON = JSON.stringify({ type: 'service_account', client_email: SA_EMAIL, private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const PLAY_ENV = { PLAY_SERVICE_ACCOUNT: Buffer.from(SA_JSON).toString('base64'), PLAY_API_URL: gUrl, PLAY_TOKEN_URL: gUrl + '/token', PLAY_CERTS_URL: gUrl + '/certs', PLAY_PUBSUB_AUDIENCE: AUD, PLAY_PUBSUB_EMAIL: PUSH_EMAIL, PLAY_SLACK_MS: '2500',
  PADDLE_WEBHOOK_SECRET: SECRET, PADDLE_PRICE_MONTHLY: 'pri_mensual', PADDLE_PRICE_YEARLY: 'pri_anual', CHECKOUT_MONTHLY: 'https://pago.ejemplo.test/m', CHECKOUT_YEARLY: 'https://pago.ejemplo.test/y', PORTAL_URL: 'https://pago.ejemplo.test/portal' };

const R = await rig(Object.assign({ PLAY_BILLING: '1' }, PLAY_ENV));
const acct = async (who) => (await R.api('GET', '/account', undefined, who.s)).json;
const verify = (who, productId, purchaseToken) => R.api('POST', '/play/verify', { productId, purchaseToken }, who && who.s);
// Un aviso de Pub/Sub, firmado como los firma Google (o mal firmado, a propósito).
const notify = async (data, opt) => {
  const o = Object.assign({ key: push.privateKey, kid: 'clave-1', aud: AUD, email: PUSH_EMAIL, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3000, sign: true }, opt || {});
  const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = b({ alg: 'RS256', kid: o.kid, typ: 'JWT' }) + '.' + b({ iss: o.iss, aud: o.aud, email: o.email, email_verified: true, iat: Math.floor(Date.now() / 1000) - 5, exp: o.exp });
  const jwt = head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), o.key).toString('base64url');
  const body = { message: { data: Buffer.from(JSON.stringify(Object.assign({ version: '1.0', packageName: 'app.sharpmd', eventTimeMillis: String(Date.now()) }, data))).toString('base64'), messageId: String(Date.now()) }, subscription: 'projects/prueba/subscriptions/avisos' };
  return R.api('POST', '/play/notifications', body, undefined, o.sign ? { authorization: 'Bearer ' + jwt } : {});
};
const subNote = (token, type) => ({ subscriptionNotification: { version: '1.0', notificationType: type, purchaseToken: token } });
const paddle = async (id, status, mail) => {
  const raw = JSON.stringify({ event_type: 'subscription.updated', occurred_at: new Date().toISOString(), data: { id, status, items: [{ price: { id: 'pri_mensual' }, quantity: 1 }], ...(mail ? { custom_data: { sharpmd_email: mail } } : {}) } });
  const ts = Math.floor(Date.now() / 1000); const h1 = crypto.createHmac('sha256', SECRET).update(ts + ':' + raw).digest('hex');
  const r = await fetch(R.base + '/paddle/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const HOUR = 3600000;

let off = null;
try {
  console.log('Google Play: la compra');
  const ana = await R.signup('ana@ejemplo.test'); const beto = await R.signup('beto@ejemplo.test');
  let a = await acct(ana);
  check('prendido, la cuenta dice qué productos ofrece la app y de dónde sale el plan', a.play && a.play.package === 'app.sharpmd' && a.play.products.monthly === 'pro_monthly' && a.play.products.yearly === 'pro_yearly' && a.plan === 'free' && a.plan_from === '', a.play);
  check('sin sesión no se confirma nada', (await verify(null, 'pro_yearly', 'token-de-ana-0001')).status === 401);
  buy('token-de-ana-0001', 'pro_yearly', HOUR);
  let r = await verify(ana, 'pro_yearly', 'token-de-ana-0001');
  a = await acct(ana);
  check('compra feliz: el servidor la confirma con Google y prende el plan pago hasta el vencimiento', r.status === 200 && r.json.plan === 'pro' && r.json.product === 'pro_yearly' && r.json.expires > Date.now() + HOUR - 60000 && a.plan === 'pro' && a.own_plan === 'pro' && a.limit === null, [r.json, a.plan]);
  check('la reconoce ante Google (acknowledge) una sola vez, con un JWT de la cuenta de servicio bien firmado', G.acks.join() === 'pro_yearly:token-de-ana-0001' && G.tokens === 1 && G.badJwt === 0, [G.acks, G.tokens, G.badJwt]);
  check('queda anotado que el plan sale de Play, se administra en Google Play y no se ofrece pagar además por la web', a.plan_from === 'play' && /^https:\/\/play\.google\.com\/store\/account\/subscriptions\?package=app\.sharpmd&sku=pro_yearly$/.test(a.manage) && a.checkout.monthly === '' && a.checkout.yearly === '', [a.plan_from, a.manage, a.checkout]);
  r = await verify(ana, 'pro_yearly', 'token-de-ana-0001');
  check('mandar la misma compra otra vez desde la misma cuenta no rompe ni la reconoce de nuevo', r.status === 200 && r.json.plan === 'pro' && G.acks.length === 1, [r.status, G.acks]);

  r = await verify(beto, 'pro_yearly', 'token-de-ana-0001');
  check('token repetido en otra cuenta: se rechaza y esa cuenta sigue en el plan gratis', r.status === 409 && r.json.error === 'token_used' && (await acct(beto)).plan === 'free' && (await acct(ana)).plan === 'pro', r.json);
  const acks0 = G.acks.length;
  r = await verify(beto, 'pro_yearly', 'token-que-google-no-conoce');
  check('token inválido: Google no lo conoce y no se prende nada', r.status === 400 && r.json.error === 'bad_purchase' && (await acct(beto)).plan === 'free', r.json);
  const bad = [await verify(beto, 'otro_producto', 'token-de-beto-0001'), await verify(beto, 'pro_yearly', 'corto'), await verify(beto, 'pro_yearly', 'con espacios adentro'), await verify(beto, 'pro_yearly', 12345)];
  check('un producto que no es de SharpMD o un token mal armado se rechazan sin consultar a Google', bad[0].json.error === 'bad_product' && bad.slice(1).every((x) => x.status === 400 && x.json.error === 'bad_purchase'), bad.map((x) => x.json));
  buy('token-de-beto-mensual', 'pro_monthly', HOUR);
  r = await verify(beto, 'pro_yearly', 'token-de-beto-mensual');
  check('una compra de otro producto que el que se dice no vale', r.status === 400 && r.json.error === 'bad_purchase', r.json);
  buy('token-de-beto-pendiente', 'pro_monthly', HOUR, { subscriptionState: 'SUBSCRIPTION_STATE_PENDING' });
  r = await verify(beto, 'pro_monthly', 'token-de-beto-pendiente');
  check('un pago pendiente todavía no da el plan', r.status === 409 && r.json.error === 'purchase_pending' && (await acct(beto)).plan === 'free', r.json);
  buy('token-de-beto-vencido', 'pro_monthly', -HOUR, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' });
  r = await verify(beto, 'pro_monthly', 'token-de-beto-vencido');
  check('una suscripción ya vencida tampoco', r.status === 400 && r.json.error === 'purchase_ended' && (await acct(beto)).plan === 'free', r.json);
  G.down = true;
  r = await verify(beto, 'pro_monthly', 'token-de-beto-mensual');
  G.down = false;
  check('si Google no responde no se da el plan a ciegas, y nada de lo rechazado se reconoció', r.status === 502 && r.json.error === 'play_failed' && (await acct(beto)).plan === 'free' && G.acks.length === acks0, [r.json, G.acks]);
  r = await verify(beto, 'pro_monthly', 'token-de-beto-mensual');
  check('con Google de vuelta la misma compra entra', r.status === 200 && (await acct(beto)).plan_from === 'play' && G.acks.includes('pro_monthly:token-de-beto-mensual'), r.json);

  console.log('Google Play: los avisos');
  const firmas = [await notify(subNote('token-de-ana-0001', 3), { sign: false }), await notify(subNote('token-de-ana-0001', 3), { aud: 'https://otro.ejemplo.test/' }), await notify(subNote('token-de-ana-0001', 3), { email: 'otro@proyecto.iam.gserviceaccount.com' }),
    await notify(subNote('token-de-ana-0001', 3), { key: other.privateKey }), await notify(subNote('token-de-ana-0001', 3), { exp: Math.floor(Date.now() / 1000) - 600 }), await notify(subNote('token-de-ana-0001', 3), { iss: 'https://otro.ejemplo.test' }), await notify(subNote('token-de-ana-0001', 3), { kid: 'clave-que-no-existe' })];
  check('un aviso sin firma, para otro destinatario, de otra cuenta de servicio, con otra clave, vencido o de otro emisor se rechaza', firmas.every((x) => x.status === 401 && x.json.error === 'bad_signature') && (await acct(ana)).plan === 'pro', firmas.map((x) => x.status));
  check('el aviso de prueba de la consola entra', (await notify({ testNotification: { version: '1.0' } })).json.test === true);
  r = [await notify(subNote('token-de-nadie-0001', 2)), await notify(Object.assign(subNote('token-de-ana-0001', 13), { packageName: 'otra.app' })), await notify({ oneTimeProductNotification: { sku: 'x' } })];
  check('un aviso de una compra sin cuenta, de otra app o de otro tipo no rompe ni cambia nada', r.every((x) => x.status === 200) && r.map((x) => x.json.ignored).join() === 'token,package,event' && (await acct(ana)).plan === 'pro', r.map((x) => x.json));
  state('token-de-ana-0001', 'CANCELED', HOUR, false);
  r = await notify(subNote('token-de-ana-0001', 3));
  a = await acct(ana);
  check('cancelación por aviso: lo ya pagado se respeta, el plan sigue hasta el vencimiento', r.status === 200 && r.json.plan === 'pro' && a.plan === 'pro' && a.plan_from === 'play', [r.json, a.plan]);
  state('token-de-ana-0001', 'EXPIRED', -1000, false);
  r = await notify(subNote('token-de-ana-0001', 13));
  a = await acct(ana);
  check('y al vencer, el aviso lo apaga: plan gratis, sin origen y otra vez con enlaces de pago', r.json.plan === 'free' && a.plan === 'free' && a.plan_from === '' && a.limit > 0 && /pago\.ejemplo\.test/.test(a.checkout.yearly) && a.manage === '', [r.json, a.plan, a.plan_from]);
  state('token-de-ana-0001', 'ACTIVE', HOUR, true);
  r = await notify(subNote('token-de-ana-0001', 1));
  check('una suscripción recuperada lo vuelve a prender', r.json.plan === 'pro' && (await acct(ana)).plan_from === 'play', r.json);
  state('token-de-beto-mensual', 'ACTIVE', 40 * 24 * HOUR, true);
  r = await notify(subNote('token-de-beto-mensual', 2));
  check('renovación por aviso: el plan sigue', r.json.plan === 'pro' && (await acct(beto)).plan === 'pro', r.json);
  G.down = true; r = await notify(subNote('token-de-beto-mensual', 2)); G.down = false;
  check('si Google no responde el aviso falla, así Pub/Sub lo reintenta, y la cuenta queda como estaba', r.status === 502 && (await acct(beto)).plan === 'pro', r.status);
  const del = await R.api('DELETE', '/account', { email: 'beto@ejemplo.test' }, beto.s);
  check('con una suscripción de Play que se renueva la cuenta no se borra: primero se cancela en Google Play', del.status === 409 && del.json.error === 'subscription_active' && /play\.google\.com/.test(del.json.manage), del.json);
  r = await notify({ voidedPurchaseNotification: { purchaseToken: 'token-de-beto-mensual', orderId: 'GPA.0000', productType: 1, refundType: 1 } });
  check('reembolso por aviso: el plan se corta en el momento', r.json.plan === 'free' && (await acct(beto)).plan === 'free', r.json);

  console.log('Google Play: el vencimiento sin aviso');
  const caro = await R.signup('caro@ejemplo.test'); const dani = await R.signup('dani@ejemplo.test');
  buy('token-de-caro-0001', 'pro_monthly', 1200); buy('token-de-dani-0001', 'pro_monthly', 1200);
  await verify(caro, 'pro_monthly', 'token-de-caro-0001'); await verify(dani, 'pro_monthly', 'token-de-dani-0001');
  check('las dos cuentas quedan en el plan pago', (await acct(caro)).plan === 'pro' && (await acct(dani)).plan === 'pro');
  await sleep(1500);
  state('token-de-caro-0001', 'EXPIRED', -100, false);
  a = await acct(caro);
  check('vencimiento: pasada la fecha, al consultar la cuenta se le pregunta a Google y el plan vuelve a gratis', a.plan === 'free' && a.plan_from === '' && (await R.api('GET', '/notes', undefined, caro.s)).status === 200, [a.plan, a.plan_from]);
  G.down = true;
  a = await acct(dani);
  check('si Google no responde justo ahí, una suscripción que se renueva conserva el plan un margen', a.plan === 'pro' && a.plan_from === 'play', a.plan);
  await sleep(2800);
  a = await acct(dani);
  G.down = false;
  check('pasado el margen el plan se apaga solo, aunque Google siga sin responder', a.plan === 'free', a.plan);
  buy('token-de-caro-0002', 'pro_yearly', HOUR, { linkedPurchaseToken: 'token-de-caro-0001' });
  r = await verify(caro, 'pro_yearly', 'token-de-caro-0002');
  check('volver a suscribirse después de vencida (un token nuevo que nombra al anterior) prende el plan de nuevo', r.status === 200 && (await acct(caro)).plan === 'pro', r.json);
  buy('token-de-eva-robado', 'pro_yearly', HOUR, { linkedPurchaseToken: 'token-de-caro-0002' });
  const eva = await R.signup('eva@ejemplo.test');
  r = await verify(eva, 'pro_yearly', 'token-de-eva-robado');
  check('un token que reemplaza a la compra en pie de otra cuenta no entra en una cuenta distinta', r.status === 409 && r.json.error === 'token_used' && (await acct(eva)).plan === 'free', r.json);

  console.log('Google Play y Paddle');
  const fede = await R.signup('fede@ejemplo.test');
  await paddle('sub_fede', 'active', 'fede@ejemplo.test');
  a = await acct(fede);
  check('una cuenta que paga por Paddle queda con ese origen', a.plan === 'pro' && a.plan_from === 'paddle' && a.manage === 'https://pago.ejemplo.test/portal', [a.plan, a.plan_from, a.manage]);
  buy('token-de-fede-0001', 'pro_monthly', HOUR); const acks1 = G.acks.length;
  r = await verify(fede, 'pro_monthly', 'token-de-fede-0001');
  check('con Paddle activo no se compra además por Play: se rechaza y la compra no se reconoce (Google la devuelve sola)', r.status === 409 && r.json.error === 'plan_active' && G.acks.length === acks1 && (await acct(fede)).plan_from === 'paddle', r.json);
  await paddle('sub_caro', 'active', 'caro@ejemplo.test'); await paddle('sub_caro', 'canceled');
  a = await acct(caro);
  check('y al revés: un aviso de Paddle que se da de baja no le saca el plan a quien lo tiene por Play', a.plan === 'pro' && a.plan_from === 'play', [a.plan, a.plan_from]);
  const gabi = await R.signup('gabi@ejemplo.test', true);
  buy('token-de-gabi-0001', 'pro_monthly', HOUR);
  r = await verify(gabi, 'pro_monthly', 'token-de-gabi-0001');
  check('quien tiene el plan puesto a mano tampoco compra por Play', r.status === 409 && r.json.error === 'plan_active' && (await acct(gabi)).plan_from === 'admin', r.json);

  // ---------- La pestaña Plan dentro de la app ----------
  console.log('La app de Android: la pestaña Plan');
  // La Digital Goods API y Payment Request, como las entrega Chrome dentro de la app. window.__play cuenta qué se pidió.
  const fake = (cfg) => {
    window.__play = { asked: [], shown: [], completed: [], cfg };
    if (cfg.none) return;
    window.getDigitalGoodsService = async (method) => {
      window.__play.asked.push(method);
      if (cfg.reject) throw new Error('unsupported context');
      return { getDetails: async (ids) => { window.__play.asked.push(ids.join(',')); return cfg.items.filter((i) => ids.includes(i.itemId)); }, listPurchases: async () => cfg.owned || [] };
    };
    window.PaymentRequest = function (methods, details) {
      this.show = async () => {
        window.__play.shown.push({ method: methods[0].supportedMethods, sku: methods[0].data.sku, total: details.total.amount });
        if (cfg.cancel) { const e = new Error('cancelado'); e.name = 'AbortError'; throw e; }
        return { details: { purchaseToken: cfg.token }, complete: async (x) => { window.__play.completed.push(x); } };
      };
    };
  };
  const ITEMS = [{ itemId: 'pro_yearly', title: 'SharpMD', type: 'subscription', subscriptionPeriod: 'P1Y', price: { currency: 'ARS', value: '52000.00' } }, { itemId: 'pro_monthly', title: 'SharpMD', type: 'subscription', subscriptionPeriod: 'P1M', price: { currency: 'ARS', value: '5200.00' } }];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const openPlan = async (page) => { await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=plan]'); await page.waitForSelector('.lmd-panel .lmd-plans'); await page.waitForTimeout(400); };
  const look = (page) => page.evaluate(() => {
    const box = document.querySelector('.lmd-panel [data-acct=plan]'); const seen = (el) => !!el && el.offsetParent !== null; const paid = box.querySelector('.lmd-plans > .lmd-plan:nth-child(2)');
    return { store: LMD.storeApp === true, play: [...box.querySelectorAll('[data-play]')].filter(seen).map((b) => b.dataset.play + ' ' + b.textContent + (b.classList.contains('lmd-btn-fill') ? ' fill' : '')), web: [...box.querySelectorAll('[data-pay], .lmd-plan-buy')].filter(seen).length,
      list: paid ? [...paid.querySelectorAll('li')].filter(seen).length : 0, same: seen(box.querySelector('.lmd-play-same')) ? box.querySelector('.lmd-play-same').textContent : '', terms: seen(box.querySelector('.lmd-play-terms')), say: (box.querySelector('.lmd-play-say') || {}).textContent || '',
      manage: [...box.querySelectorAll('.lmd-plan a[target=_blank]')].filter(seen).map((x) => x.textContent + ' ' + x.getAttribute('href')), on: paid ? paid.classList.contains('lmd-plan-on') : false, team: /team|equipo/i.test([...box.querySelectorAll('a, button')].filter(seen).map((x) => x.textContent + ' ' + (x.getAttribute('href') || '')).join(' ')), text: box.innerText, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  const inApp = async (who, cfg, lang) => { const o = await R.open(who, phone); await o.ctx.addInitScript(fake, cfg); if (lang) await o.ctx.addInitScript((l) => { try { localStorage.setItem('mdtools:site-lang', l); } catch (e) { /* sin almacenamiento */ } }, lang); await o.page.goto(R.home + '?src=android'); await o.page.waitForSelector('.lmd-home [data-home=new], .lmd-draft'); await openPlan(o.page); return o; };

  const hugo = await R.signup('hugo@ejemplo.test');
  buy('token-de-hugo-0001', 'pro_yearly', HOUR);
  let app = await inApp(hugo, { items: ITEMS, token: 'token-de-hugo-0001' });
  let v = await look(app.page);
  check('dentro de la app, con todo prendido, la pestaña Plan ofrece suscribirse con el precio que da Google Play, en la moneda de la persona', v.store && v.play.length === 2 && /^yearly .*52[.,]000.* \/ year fill$/.test(v.play[0]) && /^monthly .*5[.,]200.* \/ month$/.test(v.play[1]) && /ARS|\$/.test(v.play[0]), v.play);
  check('los botones de pago de la web siguen escondidos, y no se nombra el plan de equipo ni otro lugar donde pagar', v.web === 0 && !v.team && !/paddle|sharpmd\.app|USD/i.test(v.text), [v.web, v.team, v.text.slice(0, 400)]);
  check('se ve qué incluye el plan pago, que la misma cuenta sirve en la web y en la extensión, y cómo se cobra', v.list === 7 && /web/.test(v.same) && /Chrome extension/.test(v.same) && v.terms, [v.list, v.same, v.terms]);
  check('en el teléfono nada desborda a lo ancho', !v.wide);
  check('la app pidió los productos por la Digital Goods API con el método de Play', (await app.page.evaluate(() => window.__play.asked)).join('|') === 'https://play.google.com/billing|pro_yearly,pro_monthly');
  await app.page.click('.lmd-panel [data-play=yearly]');
  await app.page.waitForFunction(() => !!document.querySelector('.lmd-panel .lmd-play-say'));
  v = await look(app.page); const flow = await app.page.evaluate(() => window.__play);
  check('suscribirse lanza la compra de Play con ese producto y, al terminar, manda el token al servidor y la da por buena', flow.shown.length === 1 && flow.shown[0].method === 'https://play.google.com/billing' && flow.shown[0].sku === 'pro_yearly' && flow.completed.join() === 'success' && G.acks.includes('pro_yearly:token-de-hugo-0001'), flow);
  check('la cuenta se refresca ahí mismo: plan pago a nombre de Play, sin botones de compra y con el enlace para administrarla en Google Play', (await acct(hugo)).plan_from === 'play' && v.on && v.play.length === 0 && /paid plan/.test(v.say) && v.manage.length === 1 && /^Manage in Google Play https:\/\/play\.google\.com\/store\/account\/subscriptions/.test(v.manage[0]), v);
  await app.ctx.close();

  const ines = await R.signup('ines@ejemplo.test');
  app = await inApp(ines, { items: ITEMS, cancel: true });
  await app.page.click('.lmd-panel [data-play=monthly]'); await app.page.waitForTimeout(500);
  v = await look(app.page);
  check('cerrar la pantalla de pago de Play no cambia nada ni muestra un error', v.play.length === 2 && v.say === '' && (await acct(ines)).plan === 'free', v);
  await app.ctx.close();
  app = await inApp(ines, { items: ITEMS, token: 'token-de-hugo-0001' });
  await app.page.click('.lmd-panel [data-play=yearly]'); await app.page.waitForFunction(() => !!document.querySelector('.lmd-panel .lmd-play-say'));
  v = await look(app.page);
  check('una compra de Play que ya es de otra cuenta se explica y no da el plan', /another SharpMD account/.test(v.say) && v.play.length === 2 && (await acct(ines)).plan === 'free' && (await app.page.evaluate(() => window.__play.completed.join())) === 'fail', v.say);
  await app.ctx.close();
  buy('token-de-ines-0001', 'pro_monthly', HOUR);
  app = await inApp(ines, { items: ITEMS, owned: [{ itemId: 'pro_monthly', purchaseToken: 'token-de-ines-0001' }, { itemId: 'pro_yearly', purchaseToken: 'token-de-hugo-0001' }] });
  await app.page.waitForFunction(() => !!document.querySelector('.lmd-panel .lmd-play-say'));
  v = await look(app.page);
  check('una compra que Google Play ya tiene y la cuenta no (se cortó después de pagar) se recupera al abrir la pestaña', (await acct(ines)).plan_from === 'play' && v.on && v.play.length === 0, v);
  await app.ctx.close();

  app = await inApp(await R.signup('juan@ejemplo.test'), { items: ITEMS, token: 'x' }, 'es');
  v = await look(app.page);
  check('en castellano, los mismos textos', /año/.test(v.play[0]) && /mes/.test(v.play[1]) && v.same === 'La misma cuenta sirve en la web y en la extensión de Chrome.' && !/[!¡—]/.test(v.same + v.text.match(/Se cobra[^\n]*/)[0]), [v.play, v.same]);
  await app.ctx.close();

  // Sin la Digital Goods API (otro navegador, una app vieja), o si no responde con los productos: como hoy.
  const kira = await R.signup('kira@ejemplo.test');
  for (const [name, cfg] of [['sin la Digital Goods API', { none: true }], ['si la Digital Goods API no está para esta app', { reject: true, items: ITEMS }], ['si Play no devuelve los productos', { items: [] }]]) {
    app = await inApp(kira, cfg); v = await look(app.page);
    check(name + ' la pestaña queda como hoy: el plan se ve y no se vende', v.store && v.play.length === 0 && v.web === 0 && v.list === 7 && v.same === '' && !v.terms, v);
    await app.ctx.close();
  }
  // En la web común (mismo servidor, con Play prendido) nada de Play aparece, aunque el navegador tenga la API.
  let web = await R.open(kira); await web.ctx.addInitScript(fake, { items: ITEMS, token: 'x' }); await web.page.goto(R.home); await web.page.waitForSelector('.lmd-home [data-home=new], .lmd-draft'); await openPlan(web.page);
  v = await look(web.page);
  check('en la web común no hay compra por Play: siguen los enlaces de pago de siempre', !v.store && v.play.length === 0 && v.web > 0 && v.same === '' && (await web.page.evaluate(() => window.__play.asked.length)) === 0, v);
  await web.ctx.close();
  web = await R.open(hugo); await web.page.goto(R.home); await web.page.waitForSelector('.lmd-home [data-home=new], .lmd-draft'); await openPlan(web.page);
  v = await look(web.page);
  check('quien se suscribió en la app ve en la web su plan pago, sin enlaces de pago y con el de Google Play para administrarlo', v.on && v.web === 0 && v.manage.length === 1 && /^Manage in Google Play/.test(v.manage[0]), v);
  await web.ctx.close();
  check('ninguna página dio error y nada salió hacia el sitio publicado', R.errors.length === 0 && R.outside.length === 0, [R.errors, R.outside]);

  // ---------- El interruptor apagado ----------
  console.log('Interruptor apagado');
  off = await rig(PLAY_ENV); // las credenciales están, PLAY_BILLING no
  const luz = await off.signup('luz@ejemplo.test'); const callsBefore = G.calls.length;
  buy('token-de-luz-0001', 'pro_yearly', HOUR);
  a = (await off.api('GET', '/account', undefined, luz.s)).json;
  r = await off.api('POST', '/play/verify', { productId: 'pro_yearly', purchaseToken: 'token-de-luz-0001' }, luz.s);
  const pushOff = await off.api('POST', '/play/notifications', { message: { data: '' } });
  check('apagado, la cuenta dice play: false, confirmar una compra responde que no está disponible y la ruta de avisos no existe', a.play === false && a.plan_from === '' && r.status === 404 && r.json.error === 'play_unavailable' && pushOff.status === 404 && pushOff.json.error === 'no_route' && (await off.api('GET', '/account', undefined, luz.s)).json.plan === 'free', [a.play, r.json, pushOff.json]);
  check('y el servidor no le pide nada a Google', G.calls.length === callsBefore, G.calls.slice(callsBefore));
  const o = await off.open(luz, phone); await o.ctx.addInitScript(fake, { items: ITEMS, token: 'token-de-luz-0001' }); await o.page.goto(off.home + '?src=android'); await o.page.waitForSelector('.lmd-home [data-home=new], .lmd-draft'); await openPlan(o.page);
  v = await look(o.page);
  check('dentro de la app todo queda como hoy: sin botones de compra, sin la línea nueva, y la Digital Goods API ni se consulta', v.store && v.play.length === 0 && v.web === 0 && v.list === 7 && v.same === '' && !v.terms && (await o.page.evaluate(() => window.__play.asked.length)) === 0, v);
  await o.ctx.close();
  await off.api('POST', '/admin/plan', { email: 'luz@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': off.ADMIN });
  check('y el plan pago de siempre sigue andando igual', (await off.api('GET', '/account', undefined, luz.s)).json.plan === 'pro');
} catch (e) { check('la prueba llegó al final', false, String(e && e.stack || e)); }
await R.close(); if (off) await off.close(); google.close();
process.exit(done() ? 1 : 0);
