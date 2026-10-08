// Sesión en vivo, con navegadores de verdad: quien tiene la nota abre la sesión y pasa el enlace; el invitado entra
// desde la web, sin cuenta; cada uno ve dónde está el otro; lo que uno escribe aparece en el otro sin redibujar el
// documento ni sacarle el cursor; dos en el mismo bloque; sin conexión; sacar a alguien y terminar la sesión; el
// teléfono; y tres escribiendo a la vez durante treinta segundos sin perder ni duplicar nada.
// Todo contra un servidor local.
import { rig, tally, sleep, typeIn, leave } from './rig.mjs';
const R = await rig({ SHARE_FREE: '1', LIVE_PEOPLE: '4', FEEDBACK_TO: 'duenio@ejemplo.test' });
const { check, done } = tally();
const enc = encodeURIComponent;
const J = (v) => JSON.stringify(v);

const NOTE = '# Launch plan\n\nFirst paragraph of the plan.\n\nSecond paragraph, about the budget.\n\n- item one\n- item two\n- item three\n\n| Task | Owner |\n| --- | --- |\n| Design | Ana |\n| Build | Ben |\n\n```js\nlet a = 1;\n```\n\nLast paragraph.\n';
const text = (page) => page.evaluate(() => document.querySelector('.lmd-article').innerText);
const sees = (page, what, ms) => page.waitForFunction((w) => document.querySelector('.lmd-article').innerText.includes(w), what, { timeout: ms || 8000 }).then(() => true, () => false);
const marks = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-live-mark')].filter((m) => !m.hidden).map((m) => ({ who: m.title, tag: m.textContent, editing: m.classList.contains('lmd-live-editing'), color: m.style.getPropertyValue('--lmd-live'), block: m._block.innerText.slice(0, 40), left: Math.round(m.getBoundingClientRect().left - m._block.getBoundingClientRect().left) })));
const saved = (page) => page.waitForFunction(() => /Saved to the cloud/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 15000 }).then(() => true, () => false);
// El Markdown como lo tiene ese navegador: lo que copia "Copiar Markdown".
const rawOf = async (page) => { await page.bringToFront(); await page.evaluate(() => { document.querySelector('[data-act=copy]').click(); document.querySelector('.lmd-menu-copy [data-more=copy-md]').click(); }); await sleep(120); return (await page.evaluate(() => navigator.clipboard.readText())).split(String.fromCharCode(13)).join(''); }; // Windows devuelve el portapapeles con CRLF
const serverNote = async (s, p) => (await R.api('GET', '/notes/' + enc(p), undefined, s)).json;
const overflow = (page) => page.evaluate(() => {
  const w = window.innerWidth; const bad = [];
  document.querySelectorAll('.lmd-live-bar, .lmd-live-bar *, .lmd-live-card, .lmd-live-card *, .lmd-live-note, .lmd-live-note *, .lmd-live-chip, .lmd-topbar').forEach((n) => { const r = n.getBoundingClientRect(); if (r.width && (r.right > w + 1 || r.left < -1)) bad.push(n.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  return { page: document.documentElement.scrollWidth - w, bad: bad.slice(0, 5) };
});

// Abre la nota como su dueño, en edición.
async function ownerAt(who, path, opt) {
  const c = await R.open(who, opt); await c.page.goto(R.noteUrl(path, true)); await c.page.waitForSelector('.lmd-article .lmd-editable');
  return c;
}
// Abre la sesión desde el menú de la nube y devuelve el enlace.
async function startLive(page, name) {
  await page.click('[data-act=sync]'); await page.click('.lmd-menu [data-s=live]');
  await page.waitForSelector('.lmd-live-card [data-lv=name]');
  await page.fill('[data-lv=name]', name); await page.click('[data-lv=start]');
  await page.waitForSelector('.lmd-live-link input');
  const link = await page.inputValue('.lmd-live-link input');
  await page.click('.lmd-live-card [data-lv=close]');
  return link;
}
// Entra por el enlace con ese nombre.
async function joinLive(link, name, opt) {
  const c = await R.open(null, opt);
  c.calls = []; c.page.on('request', (r) => { if (r.url().startsWith(R.base)) c.calls.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await c.page.goto(link); await c.page.waitForSelector('.lmd-live-card input');
  await c.page.fill('.lmd-live-card input', name); await c.page.click('.lmd-live-card [data-lv=join]');
  await c.page.waitForSelector('.lmd-live-bar');
  await c.page.waitForSelector('.lmd-article .lmd-editable');
  return c;
}

try {
  const { api } = R;
  const A = await R.signup('ana@ejemplo.test', true); const F = await R.signup('free@ejemplo.test', false); const C = await R.signup('caro@ejemplo.test', true);
  await api('PUT', '/notes/' + enc('team/plan.md'), { text: NOTE }, A.s);
  await api('PUT', '/notes/gratis.md', { text: '# Gratis\n\nUna nota.\n' }, F.s);
  await api('POST', '/shares', { path: 'team/plan.md', email: C.email, role: 'edit' }, A.s);

  // ---------- Abrir la sesión ----------
  console.log('Abrir la sesión');
  const free = await ownerAt(F, 'gratis.md');
  await free.page.click('[data-act=sync]'); await free.page.waitForSelector('.lmd-menu [data-s=live]');
  check('en una nota de la nube, el menú de la nube ofrece "Colaborar en vivo"', (await free.page.textContent('.lmd-menu [data-s=live]')).trim() === 'Collaborate live');
  await free.page.click('.lmd-menu [data-s=live]'); await free.page.waitForSelector('.lmd-panel:not([hidden]) .lmd-plan-why');
  check('con el plan gratis lleva a Ajustes, Plan, con el motivo', (await free.page.textContent('.lmd-plan-why')) === 'Live collaboration is part of the paid plan.' && !(await free.page.$('.lmd-live-card')), await free.page.textContent('.lmd-plan-why'));
  check('y el plan pago la nombra', /Live sessions: the people you invite join without an account/.test(await free.page.textContent('.lmd-plans')));
  check('el servidor tampoco la abre sin el plan', (await api('POST', '/live', { path: 'gratis.md', name: 'Free' }, F.s)).json.error === 'live_needs_plan');
  await free.ctx.close();

  const sharedBy = await R.open(C); await sharedBy.page.goto(R.noteUrl('~' + A.id + '/team/plan.md', true)); await sharedBy.page.waitForSelector('.lmd-article .lmd-editable');
  await sharedBy.page.click('[data-act=sync]'); await sharedBy.page.click('.lmd-menu [data-s=live]');
  await sharedBy.page.waitForFunction(() => /Only the person who created/.test(document.querySelector('.lmd-status').textContent), null, { timeout: 4000 }).catch(() => {});
  check('quien recibió la nota compartida no puede abrir una sesión sobre ella', /Only the person who created the note/.test(await sharedBy.page.textContent('.lmd-status')) && !(await sharedBy.page.$('.lmd-live-card')), await sharedBy.page.textContent('.lmd-status'));

  const own = await ownerAt(A, 'team/plan.md');
  check('sin sesión no hay nada en la barra de arriba', await own.page.evaluate(() => document.querySelector('.lmd-live-chip').hidden && !document.querySelector('.lmd-live-bar')));
  await own.page.click('[data-act=sync]'); await own.page.click('.lmd-menu [data-s=live]'); await own.page.waitForSelector('.lmd-live-card [data-lv=name]');
  const intro = await own.page.evaluate(() => ({ text: document.querySelector('.lmd-live-card').innerText, bang: /[!¡—–]/.test(document.querySelector('.lmd-live-card').innerText) }));
  check('el cuadro dice qué es antes de abrirla, sin signos de admiración ni rayas', /Anyone with the link can edit this note with you, without an account/.test(intro.text) && /Guests see this name, not your email/.test(intro.text) && !intro.bang, intro.text);
  const proposed = await own.page.inputValue('[data-lv=name]');
  check('el nombre propuesto es el nombre visible de la cuenta', proposed === (await api('GET', '/account', undefined, A.s)).json.name && proposed.length > 0, proposed);
  await own.page.fill('[data-lv=name]', '');
  await own.page.click('[data-lv=start]'); await own.page.waitForSelector('.lmd-live-card .lmd-dlg-err:not([hidden])');
  check('sin nombre no se abre', (await own.page.textContent('.lmd-live-card .lmd-dlg-err')) === 'Type a name.' && (await api('GET', '/live?path=' + enc('team/plan.md'), undefined, A.s)).json.open === false, await own.page.textContent('.lmd-live-card .lmd-dlg-err'));
  await own.page.fill('[data-lv=name]', 'Ana'); await own.page.click('[data-lv=start]'); await own.page.waitForSelector('.lmd-live-link input');
  const link = await own.page.inputValue('.lmd-live-link input');
  const secret = new URL(link).hash.replace('#live=', '');
  check('abrir la sesión da un enlace a la app web con un secreto largo', link.startsWith(R.home + '#live=') && /^[A-Za-z0-9_-]{43}$/.test(secret), link.replace(secret, '…'));
  await own.page.click('[data-lv=copy]'); await sleep(150);
  check('"Copiar" deja el enlace en el portapapeles', (await own.page.evaluate(() => navigator.clipboard.readText())) === link);
  const card = await own.page.evaluate(() => ({ people: [...document.querySelectorAll('.lmd-live-people li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()), acts: [...document.querySelectorAll('.lmd-live-card .lmd-ask-actions button')].map((b) => b.textContent), text: document.querySelector('.lmd-live-card').innerText }));
  check('el cuadro muestra quién está y los botones dicen qué pasa', J(card.people) === J(['A Ana · you']) && J(card.acts) === J(['End the session', 'Create a new link', 'Close']) && !/ana@ejemplo/.test(card.text), card);
  await own.page.click('.lmd-live-card [data-lv=close]');
  const chip = await own.page.evaluate(() => { const c = document.querySelector('.lmd-live-chip'); return { shown: !c.hidden && c.offsetParent !== null, text: c.innerText.replace(/\s+/g, ' ').trim(), title: c.title }; });
  check('con sesión hay un botón a la vista arriba: "Colaborar en vivo"', chip.shown && /^Live A/.test(chip.text) && chip.title === 'Collaborate live · Ana', chip);
  await own.page.click('.lmd-live-chip'); await own.page.waitForSelector('.lmd-live-link input');
  check('ese botón abre el mismo cuadro, con el enlace', (await own.page.inputValue('.lmd-live-link input')) === link);
  await own.page.click('.lmd-live-card [data-lv=close]');
  check('otra pestaña de la misma cuenta también ve que la nota está en vivo', await (async () => { const o2 = await ownerAt(A, 'team/plan.md'); const ok = await o2.page.waitForFunction(() => !document.querySelector('.lmd-live-chip').hidden, null, { timeout: 5000 }).then(() => true, () => false); await o2.ctx.close(); return ok; })());
  check('a quien se le compartió la nota por correo no le aparece la sesión', await sharedBy.page.evaluate(() => document.querySelector('.lmd-live-chip').hidden));
  await sharedBy.ctx.close();

  // ---------- Entrar por el enlace ----------
  console.log('Entrar por el enlace');
  const gone = await R.open(null); await gone.page.goto(R.home + '#live=' + 'x'.repeat(43)); await gone.page.waitForSelector('.lmd-home');
  check('un enlace que no existe deja en el inicio de la app, con el aviso', /That live session has ended/.test(await gone.page.evaluate(() => document.querySelector('.lmd-home').innerText)) && !/live=/.test(gone.page.url()) && !(await gone.page.evaluate(() => document.documentElement.classList.contains('lmd-guest'))), [gone.page.url(), await gone.page.evaluate(() => document.querySelector('.lmd-home').innerText.slice(0, 200))]);
  await gone.ctx.close();

  const ben = await R.open(null);
  ben.calls = []; ben.page.on('request', (r) => { if (r.url().startsWith(R.base)) ben.calls.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await ben.page.goto(link); await ben.page.waitForSelector('.lmd-live-card input');
  const ask = await ben.page.evaluate(() => ({ text: document.querySelector('.lmd-live-card').innerText, files: getComputedStyle(document.querySelector('.lmd-zone-files')).display, focus: document.activeElement.tagName, home: !document.querySelector('.lmd-home').hidden }));
  check('el enlace abre la web sin cuenta y pide un nombre, diciendo de quién es la sesión y qué nota', /Ana invited you to edit "plan\.md"\./.test(ask.text) && /No account needed/.test(ask.text) && ask.focus === 'INPUT' && ask.files === 'none', ask);
  await ben.page.click('.lmd-live-card [data-lv=join]'); await ben.page.waitForSelector('.lmd-live-card .lmd-dlg-err:not([hidden])');
  check('sin nombre no entra', (await ben.page.textContent('.lmd-live-card .lmd-dlg-err')) === 'Type a name.');
  await ben.page.fill('.lmd-live-card input', 'Ben'); await ben.page.keyboard.press('Enter');
  await ben.page.waitForSelector('.lmd-live-bar'); await ben.page.waitForSelector('.lmd-article .lmd-editable');
  await ben.page.waitForFunction(() => /2 people/.test(document.querySelector('.lmd-live-bar').textContent));
  // El invitado no tiene cuenta y la nota es de otra persona: puede denunciarla desde el pie. Viaja qué sesión es, no lo escrito.
  const benLink = await ben.page.evaluate(() => { const b = document.querySelector('.lmd-foot .lmd-report'); return [b.hidden, b.textContent, !!b.offsetParent || getComputedStyle(b).display !== 'none']; });
  await ben.page.click('.lmd-foot .lmd-report'); await ben.page.waitForSelector('.lmd-report-card [data-rp=text]');
  const [benSent] = await Promise.all([ben.page.waitForRequest((r) => r.url().endsWith('/feedback')), ben.page.click('.lmd-report-card [data-rp=send]')]);
  const benBody = benSent.postDataJSON(); const benStatus = (await benSent.response()).status();
  check('el invitado de una sesión en vivo puede denunciar la nota, sin cuenta', J(benLink) === J([false, 'Report this note', true]) && benStatus === 200 && benBody.report.kind === 'live' && /^live:/.test(benBody.report.note) && !!benBody.report.owner && !/Launch|launch plan/i.test(JSON.stringify(benBody).replace(benBody.report.note, '')), [benLink, benStatus, benBody.report]);
  await ben.page.waitForSelector('.lmd-report-card', { state: 'detached' });
  check('quien abrió la sesión, sobre su propia nota, no ve esa opción', await own.page.evaluate(() => document.querySelector('.lmd-foot .lmd-report').hidden));
  const in1 = await ben.page.evaluate(() => ({ bar: document.querySelector('.lmd-live-msg').textContent, btns: [...document.querySelectorAll('.lmd-live-bar button')].map((b) => b.textContent), editing: document.documentElement.classList.contains('lmd-editing'), title: document.querySelector('.lmd-docname').textContent,
    files: getComputedStyle(document.querySelector('.lmd-zone-files')).display, tree: document.querySelector('.lmd-tree-box').children.length, sync: document.querySelector('.lmd-sync').hidden, url: location.search.slice(0, 6), menu: !!document.querySelector('.lmd-menu') }));
  check('entra a la nota en edición, con una barra que dice de quién es la sesión y cuánta gente hay', in1.bar === 'Live session by Ana · 2 people' && J(in1.btns) === J(['Download a copy', 'Leave the session']) && in1.editing && in1.title === 'plan.md', in1);
  check('el invitado no ve el explorador ni el ícono de la nube', in1.files === 'none' && in1.tree === 0 && in1.sync, in1);
  check('no se le abre ningún menú ni bloque nuevo al entrar', !in1.menu && !(await ben.page.$('.lmd-draft')));
  check('del servidor el invitado solo usó las rutas de la sesión', ben.calls.length > 3 && ben.calls.every((c) => / \/live\//.test(c) || c === 'POST /feedback'), [...new Set(ben.calls)]); // y la denuncia de más arriba, que sale por la ruta de comentarios
  await ben.page.click('[data-act=settings]'); await ben.page.waitForSelector('.lmd-panel:not([hidden])');
  check('en Ajustes no tiene cuenta, IA, plan ni servidor', J(await ben.page.evaluate(() => [...document.querySelectorAll('.lmd-panel [data-ptab]')].map((b) => b.dataset.ptab))) === J(['look', 'read', 'plug']));
  await ben.page.click('[data-act=close-panel]');
  check('el nombre queda recordado para la próxima', /"name":"Ben"/.test(await ben.page.evaluate(() => localStorage.getItem('mdtools:live') || '')));
  const benSession = await ben.page.evaluate(() => sessionStorage.getItem('lmd-live'));
  await ben.page.reload(); await ben.page.waitForSelector('.lmd-live-bar'); await ben.page.waitForSelector('.lmd-article .lmd-editable');
  check('recargar la pestaña vuelve a la sesión sin pedir el nombre ni crear otro invitado', !(await ben.page.$('.lmd-live-card')) && (await api('GET', '/live?path=' + enc('team/plan.md'), undefined, A.s)).json.people.length === 2 && (await ben.page.evaluate(() => sessionStorage.getItem('lmd-live'))) === benSession);
  await own.page.waitForFunction(() => /Ben/.test(document.querySelector('.lmd-live-chip').title));
  const chip2 = await own.page.evaluate(() => { const c = document.querySelector('.lmd-live-chip'); return { title: c.title, avs: [...c.querySelectorAll('.lmd-live-av')].map((a) => [a.textContent, a.title, a.style.getPropertyValue('--lmd-live')]) }; });
  check('quien abrió la sesión ve arriba a los dos, con iniciales y colores distintos', chip2.title === 'Collaborate live · Ana, Ben' && chip2.avs.length === 2 && chip2.avs[0][0] === 'A' && chip2.avs[1][0] === 'B' && chip2.avs[0][2] !== chip2.avs[1][2], chip2);
  check('y el invitado también', await ben.page.evaluate(() => [...document.querySelectorAll('.lmd-live-chip .lmd-live-av')].map((a) => a.title).join(',') === 'Ana,Ben'));

  // ---------- Verse y escribir a la vez ----------
  console.log('Presencia y cambios en el lugar');
  await ben.page.locator('.lmd-article p', { hasText: 'Second paragraph' }).click();
  await own.page.waitForFunction(() => document.querySelectorAll('.lmd-live-mark').length === 1, null, { timeout: 5000 }).catch(() => {});
  let m = await marks(own.page);
  check('donde el invitado pone el cursor, el dueño ve una marca de color al margen con su nombre', m.length === 1 && m[0].who === 'Ben' && /Second paragraph/.test(m[0].block) && !m[0].editing && m[0].left < 0 && m[0].left > -30 && /^#/.test(m[0].color), m);
  await own.page.hover('.lmd-live-mark'); await sleep(300);
  check('al pasar el mouse por la marca se lee el nombre', await own.page.evaluate(() => { const t = document.querySelector('.lmd-live-mark .lmd-live-tag'); return t.textContent === 'Ben' && getComputedStyle(t).opacity !== '0'; }));
  await own.page.mouse.move(600, 700);
  // El dueño marca un bloque que no se va a tocar, para ver después si sigue siendo el mismo nodo.
  await own.page.evaluate(() => { document.querySelector('.lmd-article table').__probe = 'tabla'; document.querySelector('.lmd-article h1').__probe = 'titulo'; window.__renders = 0; new MutationObserver((rs) => { if (rs.some((r) => r.target === document.querySelector('.lmd-article') && r.removedNodes.length > 3)) window.__renders++; }).observe(document.querySelector('.lmd-article'), { childList: true }); });
  const puts = []; ben.page.on('response', (r) => { if (r.request().method() === 'PUT') puts.push(Date.now()); });
  const t0 = Date.now();
  await ben.page.keyboard.press('End'); await ben.page.keyboard.type(' Ben was here.', { delay: 20 });
  const typedAt = Date.now();
  check('lo que escribe el invitado le llega al dueño sin salir del bloque', await sees(own.page, 'Ben was here.', 4000));
  const lag = Date.now() - typedAt;
  check('y llega en menos de dos segundos desde la última tecla (se confirma a los ~500 ms de pausa)', lag < 2000 && puts.length >= 1 && puts[0] - t0 < 2000, { lag, firstPut: puts[0] - t0 });
  m = await marks(own.page);
  check('mientras escribe, su bloque dice "editando: Ben"', m.length === 1 && m[0].editing && m[0].tag === 'editing: Ben' && /Second paragraph/.test(m[0].block), m);
  const flash = await own.page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /Ben was here/.test(x.textContent)); return { flash: p.classList.contains('lmd-live-flash'), color: p.style.getPropertyValue('--lmd-live') }; });
  check('el bloque que cambió se enciende un momento con el color de quien lo hizo', flash.flash && flash.color === m[0].color, [flash, m[0].color]);
  const kept = await own.page.evaluate(() => ({ tabla: document.querySelector('.lmd-article table').__probe, titulo: document.querySelector('.lmd-article h1').__probe, renders: window.__renders }));
  check('el cambio entró solo en ese bloque: los demás son los mismos nodos y el documento no se redibujó', kept.tabla === 'tabla' && kept.titulo === 'titulo' && kept.renders === 0, kept);
  const held = await own.page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /Ben was here/.test(x.textContent)); return { cls: p.classList.contains('lmd-live-held'), ce: p.getAttribute('contenteditable'), by: p.dataset.liveBy }; });
  check('ese bloque queda tomado: no se puede editar mientras el otro escribe', held.cls && held.ce === 'false' && held.by === 'Ben', held);
  await own.page.locator('.lmd-article p', { hasText: 'Ben was here' }).click({ force: true });
  await own.page.keyboard.type('NO');
  check('el dueño hace clic ahí y escribe, y no entra nada', !(await text(own.page)).includes('NO') && await own.page.evaluate(() => !(document.activeElement && document.activeElement.isContentEditable)));
  // El invitado suelta el bloque.
  await leave(ben.page);
  await own.page.waitForFunction(() => !document.querySelector('.lmd-live-held'), null, { timeout: 6000 }).catch(() => {});
  const freed = await own.page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /Ben was here/.test(x.textContent)); return { cls: p.classList.contains('lmd-live-held'), ce: p.getAttribute('contenteditable'), marks: document.querySelectorAll('.lmd-live-editing').length }; });
  check('al salir del bloque se suelta y se vuelve a poder editar', !freed.cls && freed.ce === 'true' && freed.marks === 0, freed);
  check('y lo escrito quedó guardado en la nota del dueño', (await serverNote(A.s, 'team/plan.md')).text.includes('Second paragraph, about the budget. Ben was here.'));

  // El dueño escribe mientras el invitado está escribiendo en otro bloque: el cursor del invitado no se mueve.
  await ben.page.locator('.lmd-article li .lmd-li-text', { hasText: 'item two' }).click(); await ben.page.keyboard.press('End');
  await ben.page.evaluate(() => { document.activeElement.__probe = 'mio'; });
  const typing = ben.page.keyboard.type(' typed without ever stopping for the whole time', { delay: 55 });
  await sleep(400);
  await typeIn(own.page, 'First paragraph', ' Ana adds this.', 25); await leave(own.page);
  await own.page.locator('.lmd-article p', { hasText: 'Last paragraph' }).click(); await own.page.keyboard.press('End'); await own.page.keyboard.type(' And this.', { delay: 25 }); await leave(own.page);
  await typing;
  const st = await ben.page.evaluate(() => { const a = document.activeElement; const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(a); r.setEnd(sel.focusNode, sel.focusOffset); return { same: a.__probe === 'mio' && a.isConnected, text: a.textContent, before: r.toString(), art: document.querySelector('.lmd-article').innerText }; });
  check('mientras el invitado escribe de corrido llegan cambios del dueño y no pierde el foco ni una letra', st.same && st.text === 'item two typed without ever stopping for the whole time' && st.before === st.text, st);
  check('y los cambios del dueño ya están a la vista, alrededor de su bloque', /Ana adds this\./.test(st.art) && /And this\./.test(st.art), st.art);
  await leave(ben.page); await saved(ben.page); await saved(own.page);
  const both = (await serverNote(A.s, 'team/plan.md')).text;
  check('en el servidor están las tres ediciones', both.includes('- item two typed without ever stopping for the whole time') && both.includes('of the plan. Ana adds this.') && both.includes('Last paragraph. And this.'), both);

  // Un cambio en la misma lista donde el invitado tiene el cursor, y uno en la tabla donde está en una celda.
  await ben.page.locator('.lmd-article li .lmd-li-text', { hasText: 'item one' }).click(); await ben.page.keyboard.press('End');
  await ben.page.evaluate(() => { document.activeElement.__probe = 'uno'; });
  await typeIn(own.page, 'item three', ' changed', 20); await leave(own.page);
  check('otro ítem de la misma lista cambia sin sacar el cursor del suyo', await sees(ben.page, 'item three changed') && await ben.page.evaluate(() => document.activeElement.__probe === 'uno' && document.activeElement.isConnected));
  await ben.page.locator('.lmd-article td', { hasText: 'Design' }).click(); await ben.page.keyboard.press('End');
  await ben.page.evaluate(() => { document.activeElement.__probe = 'celda'; });
  await sleep(700);
  m = await marks(own.page);
  check('con el cursor en una celda, la marca del invitado toma la tabla entera', m.length === 1 && /Task/.test(m[0].block), m);
  await api('PUT', '/notes/' + enc('team/plan.md'), { text: (await serverNote(A.s, 'team/plan.md')).text.replace('| Build | Ben |', '| Build | Benito |'), rev: (await serverNote(A.s, 'team/plan.md')).rev }, A.s);
  check('otra celda de la misma tabla cambia sin sacar el cursor de la suya', await sees(ben.page, 'Benito') && await ben.page.evaluate(() => document.activeElement.__probe === 'celda' && document.activeElement.isConnected));
  await leave(ben.page);

  // El cursor quieto en un bloque que otro cambia: el texto nuevo entra en ese mismo nodo, con el cursor adentro.
  await ben.page.locator('.lmd-article p', { hasText: 'Last paragraph' }).click(); await ben.page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await ben.page.keyboard.press('ArrowRight');
  await ben.page.evaluate(() => { document.activeElement.__probe = 'quieto'; });
  await sleep(600);
  await typeIn(own.page, 'Last paragraph', ' Parked.', 20); await leave(own.page);
  await sees(ben.page, 'Parked.');
  const parked = await ben.page.evaluate(() => { const a = document.activeElement; const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(a); r.setEnd(sel.focusNode, sel.focusOffset); return { same: a.__probe === 'quieto', text: a.textContent, before: r.toString() }; });
  check('con el cursor quieto en el bloque que otro cambia, el texto nuevo entra ahí mismo y el cursor queda donde estaba', parked.same && /Parked\.$/.test(parked.text) && parked.before === 'Last', parked);
  await leave(ben.page);

  // En la vista de código: lo que llega se pone en el cuadro sin sacar el cursor, y lo escrito ahí también viaja.
  await ben.page.click('[data-act=view-raw]'); await ben.page.waitForSelector('.lmd-raw-edit:not([hidden])');
  await ben.page.evaluate(() => { const ta = document.querySelector('.lmd-raw-edit'); ta.focus(); const at = ta.value.indexOf('Second paragraph') + 6; ta.setSelectionRange(at, at); });
  await ben.page.keyboard.type('RAW', { delay: 30 });
  check('lo escrito en la vista de código llega al otro', await sees(own.page, 'SecondRAW paragraph'));
  await typeIn(own.page, 'First paragraph', ' From Ana while Ben is in the source.', 10); await leave(own.page);
  await ben.page.waitForFunction(() => /while Ben is in the source/.test(document.querySelector('.lmd-raw-edit').value), null, { timeout: 8000 }).catch(() => {});
  const rawSt = await ben.page.evaluate(() => { const ta = document.querySelector('.lmd-raw-edit'); return { focus: document.activeElement === ta, has: /while Ben is in the source/.test(ta.value) && /SecondRAW paragraph/.test(ta.value), before: ta.value.slice(ta.selectionStart - 9, ta.selectionStart) }; });
  check('y lo que llega entra en el cuadro sin sacar el cursor de donde estaba', rawSt.focus && rawSt.has && rawSt.before === 'SecondRAW', rawSt);
  for (let i = 0; i < 3; i++) await ben.page.keyboard.press('Backspace');
  await own.page.waitForFunction(() => !document.querySelector('.lmd-article').innerText.includes('SecondRAW'), null, { timeout: 8000 }).catch(() => {});
  await ben.page.click('[data-act=view-doc]'); await ben.page.waitForSelector('.lmd-article .lmd-editable');
  check('al volver al documento está todo, lo propio y lo ajeno', (await text(ben.page)).includes('From Ana while Ben is in the source.') && (await text(ben.page)).includes('Second paragraph, about') && (await rawOf(ben.page)) === (await serverNote(A.s, 'team/plan.md')).text);

  // La página no se mueve cuando cambia algo más arriba.
  const LONG = '# Largo\n\n' + Array.from({ length: 60 }, (_, i) => 'Párrafo número ' + i + ' con algo de texto para ocupar lugar en la pantalla.').join('\n\n') + '\n';
  await api('PUT', '/notes/largo.md', { text: LONG }, A.s);
  const own2 = await ownerAt(A, 'largo.md'); const link2 = await startLive(own2.page, 'Ana');
  const dan = await joinLive(link2, 'Dan');
  await dan.page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /número 40 /.test(x.textContent)); window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY - 200); window.__top = p.getBoundingClientRect().top; window.__y = window.scrollY; });
  await typeIn(own2.page, 'número 2 ', ' Se agrega una oración larga que hace que este párrafo ocupe más renglones que antes, bastante más, para empujar todo lo que viene debajo.'.repeat(2), 0); await leave(own2.page);
  await sees(dan.page, 'empujar todo');
  const pos = await dan.page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /número 40 /.test(x.textContent)); return { top: Math.round(p.getBoundingClientRect().top), was: Math.round(window.__top), y: Math.round(window.scrollY), y0: Math.round(window.__y) }; });
  check('un cambio más arriba no mueve lo que el otro está leyendo', Math.abs(pos.top - pos.was) <= 2 && pos.y > pos.y0, pos);
  // Una nota grande viaja como las líneas que cambiaron, no entera.
  const stream = await dan.page.evaluate(async (base) => {
    const pass = JSON.parse(sessionStorage.getItem('lmd-live')).pass; const ctrl = new AbortController(); let got = '';
    const res = await fetch(base + '/live/events', { headers: { authorization: 'Bearer ' + pass }, signal: ctrl.signal });
    const rd = res.body.getReader(); const d = new TextDecoder();
    (async () => { try { for (;;) { const x = await rd.read(); if (x.done) break; got += d.decode(x.value); } } catch (e) { /* cortado */ } })();
    window.__stream = () => got; window.__stop = () => ctrl.abort(); return true;
  }, R.base);
  await typeIn(own2.page, 'número 5 ', ' Corto.', 0); await leave(own2.page); await sees(dan.page, 'Corto.');
  const got = await dan.page.evaluate(() => { const g = window.__stream(); window.__stop(); return g; });
  const ev = got.split('\n\n').map((c) => c.replace(/^data: /, '')).filter((c) => /"type":"saved"/.test(c)).map((c) => JSON.parse(c)).pop();
  check('en una nota larga el aviso lleva solo las líneas que cambiaron, sobre la revisión anterior', !!ev && !('text' in ev) && ev.patch && ev.patch.del === 1 && ev.patch.lines.length === 1 && /Corto\.$/.test(ev.patch.lines[0]) && ev.base === ev.rev - 1 && ev.pid === 'o' && !('by' in ev) && !('who' in ev), ev);
  check('y quien lo recibe lo aplica bien', (await rawOf(dan.page)) === (await serverNote(A.s, 'largo.md')).text);
  await dan.ctx.close(); await own2.ctx.close();

  // ---------- Dos en el mismo bloque ----------
  console.log('Dos en el mismo bloque');
  // El invitado tiene el cursor en un bloque y el dueño empieza a escribir ahí: el bloque es del primero que escribe.
  await ben.page.locator('.lmd-article p', { hasText: 'First paragraph' }).click(); await ben.page.keyboard.press('End');
  await sleep(500);
  await own.page.locator('.lmd-article p', { hasText: 'First paragraph' }).click(); await own.page.keyboard.press('End');
  const slow = own.page.keyboard.type(' Ana keeps writing here for a while.', { delay: 60 });
  await ben.page.waitForFunction(() => !!document.querySelector('.lmd-live-held'), null, { timeout: 5000 }).catch(() => {});
  const mineHeld = await ben.page.evaluate(() => { const a = document.activeElement; return { held: a.classList.contains('lmd-live-held'), by: a.dataset.liveBy, focus: a.isContentEditable, tag: (document.querySelector('.lmd-live-editing .lmd-live-tag') || {}).textContent }; });
  check('si otro empieza a escribir donde uno tiene el cursor quieto, el bloque pasa a ser suyo sin sacarle el foco', mineHeld.held && mineHeld.by === 'Ana' && mineHeld.focus && mineHeld.tag === 'editing: Ana', mineHeld);
  const before = await ben.page.evaluate(() => document.activeElement.textContent);
  await ben.page.keyboard.type('ZZZ');
  const blocked = await ben.page.evaluate(() => ({ text: document.activeElement.textContent, status: document.querySelector('.lmd-status').textContent }));
  check('y lo que teclea ahí no entra: se le avisa quién está escribiendo', !blocked.text.includes('ZZZ') && blocked.status === 'Ana is writing in this block', [before, blocked]);
  await slow; await leave(own.page); await leave(ben.page); await saved(own.page);
  check('lo del que tenía el bloque quedó entero', (await serverNote(A.s, 'team/plan.md')).text.includes('From Ana while Ben is in the source. Ana keeps writing here for a while.') && !(await serverNote(A.s, 'team/plan.md')).text.includes('ZZZ'));

  // La carrera: los dos escriben en el mismo bloque sin haberse visto (se corta el aviso de presencia). Gana lo
  // que llegó primero al servidor; al otro se le avisa y su versión queda para copiar.
  await own.ctx.route((u) => u.pathname === '/live/presence', (r) => r.abort()); await ben.ctx.route((u) => u.pathname === '/live/presence', (r) => r.abort());
  await sleep(600);
  await own.page.locator('.lmd-article p', { hasText: 'Second paragraph' }).click(); await own.page.keyboard.press('End');
  await ben.page.locator('.lmd-article p', { hasText: 'Second paragraph' }).click(); await ben.page.keyboard.press('End');
  await Promise.all([own.page.keyboard.type(' VERSION-ANA', { delay: 5 }), ben.page.keyboard.type(' VERSION-BEN', { delay: 5 })]);
  await Promise.all([own.page.waitForSelector('.lmd-live-note', { timeout: 6000 }).catch(() => null), ben.page.waitForSelector('.lmd-live-note', { timeout: 6000 }).catch(() => null)]);
  await sleep(800);
  const race = (await serverNote(A.s, 'team/plan.md')).text; const win = /VERSION-ANA/.test(race) ? 'ANA' : 'BEN'; const loser = win === 'ANA' ? ben : own; const winner = win === 'ANA' ? own : ben; const lose = win === 'ANA' ? 'BEN' : 'ANA';
  check('los dos en el mismo bloque a la vez: en el servidor queda una versión entera', /VERSION-ANA/.test(race) !== /VERSION-BEN/.test(race) && new RegExp('Ben was here\\. VERSION-' + win + '\\n').test(race), race);
  const note1 = await loser.page.evaluate(() => { const n = document.querySelector('.lmd-live-note'); return n ? { text: n.querySelector('p').textContent, btn: n.querySelector('.lmd-btn').textContent, role: n.getAttribute('role') } : null; });
  check('al que perdió se le avisa, con quién fue', !!note1 && new RegExp('^' + (win === 'ANA' ? 'Ana' : 'Ben') + ' changed the same block at the same time\\. Their version was kept\\. Yours was not lost\\.$').test(note1.text) && note1.btn === 'Copy mine' && note1.role === 'alert', note1);
  check('al que ganó no se le avisa nada', !(await winner.page.$('.lmd-live-note')));
  await loser.page.bringToFront(); await loser.page.click('.lmd-live-note .lmd-btn'); await sleep(200);
  const clip = await loser.page.evaluate(() => navigator.clipboard.readText());
  check('"Copiar lo mío" deja su versión del bloque en el portapapeles', clip.includes('VERSION-' + lose) && /Second paragraph/.test(clip) && (await loser.page.textContent('.lmd-live-note .lmd-btn')) === 'Copied', clip);
  const lf = await loser.page.evaluate(() => ({ focus: !!document.activeElement && document.activeElement.isContentEditable, text: document.activeElement ? document.activeElement.textContent : '' }));
  check('y en pantalla le queda lo que quedó guardado', (await text(loser.page)).includes('VERSION-' + win) && !(await text(loser.page)).includes('VERSION-' + lose), [lf, await text(loser.page)]);
  await loser.page.click('.lmd-live-x'); check('el aviso se cierra', !(await loser.page.$('.lmd-live-note')));
  await own.ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ben.ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ben.ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort()); await own.ctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (r) => r.abort());
  await leave(own.page); await leave(ben.page); await saved(own.page); await saved(ben.page);
  check('después de la carrera los dos tienen el mismo Markdown que el servidor', (await rawOf(own.page)) === (await serverNote(A.s, 'team/plan.md')).text && (await rawOf(ben.page)) === (await serverNote(A.s, 'team/plan.md')).text);

  // ---------- Seguridad en el navegador ----------
  console.log('Nombres y contenido hostiles');
  const EVIL = '<img src=x onerror="window.__pwn=1"><b>x</b>';
  const eve = await joinLive(link, EVIL);
  await eve.page.locator('.lmd-article p', { hasText: 'Last paragraph' }).click(); await eve.page.keyboard.press('End'); await eve.page.keyboard.type(' e', { delay: 30 });
  await own.page.waitForFunction(() => document.querySelectorAll('.lmd-live-chip .lmd-live-av').length === 3);
  await own.page.waitForFunction(() => !!document.querySelector('.lmd-live-editing'), null, { timeout: 5000 }).catch(() => {});
  await own.page.click('.lmd-live-chip'); await own.page.waitForSelector('.lmd-live-people li');
  const xss = await own.page.evaluate(() => ({ pwn: window.__pwn, imgs: document.querySelectorAll('.lmd-live-chip img, .lmd-live-card img, .lmd-live-layer img, .lmd-live-chip b, .lmd-live-card li b, .lmd-live-layer b').length,
    name: [...document.querySelectorAll('.lmd-live-name')].map((n) => n.textContent).find((t) => /img/.test(t)), tag: [...document.querySelectorAll('.lmd-live-tag')].map((t) => t.textContent).find((t) => /img/.test(t)), title: document.querySelector('.lmd-live-chip').title, held: (document.querySelector('.lmd-live-held') || { dataset: {} }).dataset.liveBy }));
  check('un nombre con HTML se ve como texto en el cuadro, arriba y en la marca: no arma etiquetas ni corre nada', xss.pwn === undefined && xss.imgs === 0 && xss.name === EVIL.slice(0, 40) && xss.tag === 'editing: ' + EVIL.slice(0, 40) && xss.title.includes('<img'), xss);
  await own.page.click('.lmd-live-card [data-lv=close]');
  // El dueño intenta escribir en el bloque tomado por ese nombre: el aviso también lo muestra como texto.
  await leave(eve.page);
  const HOSTILE = '\n\n<script>window.__pwn = 2</script>\n\n<img src=x onerror="window.__pwn=3">\n\n[clic](javascript:window.__pwn=4)\n\n<a href="javascript:window.__pwn=5">a</a><iframe srcdoc="<script>parent.__pwn=6</script>"></iframe>\n\n<svg onload="window.__pwn=7"></svg>\n\nTexto del invitado.\n';
  const evePass = JSON.parse(await eve.page.evaluate(() => sessionStorage.getItem('lmd-live'))).pass;
  const cur = await serverNote(A.s, 'team/plan.md');
  const hostile = await api('PUT', '/live/note', { text: cur.text + HOSTILE, rev: cur.rev }, evePass);
  check('un invitado guarda contenido hostil y el servidor lo acepta como texto', hostile.status === 200);
  await sees(own.page, 'Texto del invitado.'); await sees(ben.page, 'Texto del invitado.'); await sleep(500);
  for (const [who, c] of [['el dueño', own], ['otro invitado', ben]]) {
    const h = await c.page.evaluate(() => ({ pwn: window.__pwn, script: document.querySelectorAll('.lmd-article script, .lmd-article iframe, .lmd-article [onerror], .lmd-article [onload]').length, js: [...document.querySelectorAll('.lmd-article a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') || '')).length }));
    check('ese contenido no ejecuta nada en el navegador de ' + who, h.pwn === undefined && h.script === 0 && h.js === 0, h);
  }
  const clean = await serverNote(A.s, 'team/plan.md');
  await api('PUT', '/notes/' + enc('team/plan.md'), { text: clean.text.replace(HOSTILE, '\n'), rev: clean.rev }, A.s);
  await sleep(600);

  // ---------- Tope de gente, sacar a alguien ----------
  console.log('Tope, sacar y terminar');
  const fay = await joinLive(link, 'Fay');
  check('cuatro personas entran (el tope de esta prueba)', (await api('GET', '/live?path=' + enc('team/plan.md'), undefined, A.s)).json.people.length === 4);
  const full = await R.open(null); await full.page.goto(link); await full.page.waitForSelector('.lmd-live-card input');
  check('la quinta ve que la sesión está completa antes de intentar', (await full.page.textContent('.lmd-live-card .lmd-dlg-err')) === 'The session is full. Try again in a while.');
  await full.page.fill('.lmd-live-card input', 'Gus'); await full.page.click('.lmd-live-card [data-lv=join]'); await sleep(500);
  check('y no entra', !(await full.page.$('.lmd-live-bar')) && (await full.page.textContent('.lmd-live-card .lmd-dlg-err')) === 'The session is full. Try again in a while.');
  await full.page.click('[data-lv=no]'); await full.page.waitForSelector('.lmd-home');
  check('"Ahora no" deja en la app de siempre, sin el enlace en la dirección', !/live=/.test(full.page.url()) && await full.page.evaluate(() => !document.documentElement.classList.contains('lmd-guest')));
  await full.ctx.close(); await fay.ctx.close();

  // Sacar a Eve: se corta en el acto, el enlace cambia, y los demás siguen.
  await eve.page.locator('.lmd-article p', { hasText: 'Texto del invitado' }).first().click().catch(() => {});
  await own.page.click('.lmd-live-chip'); await own.page.waitForSelector('.lmd-live-people li');
  const rows = await own.page.evaluate(() => [...document.querySelectorAll('.lmd-live-people li')].map((li) => [li.querySelector('.lmd-live-name').textContent, !!li.querySelector('[data-kick]')]));
  check('el dueño puede sacar a los invitados, no a sí mismo', rows[0][0] === 'Ana · you' && !rows[0][1] && rows.slice(1).every((r) => r[1]), rows);
  const eveId = await own.page.evaluate(() => [...document.querySelectorAll('.lmd-live-people li')].find((li) => /img/.test(li.textContent)).querySelector('[data-kick]').dataset.kick);
  await own.page.click('[data-kick="' + eveId + '"]'); await own.page.waitForSelector('.lmd-dlg-card');
  const kq = await own.page.evaluate(() => ({ title: document.querySelector('.lmd-dlg-card h3').textContent, imgs: document.querySelectorAll('.lmd-dlg-card img').length, text: document.querySelector('.lmd-dlg-card p').textContent, ok: document.querySelector('.lmd-dlg-card [data-dlg=ok]').textContent }));
  check('antes pregunta, y dice que el enlace cambia', kq.title.startsWith('Remove <img') && kq.imgs === 0 && /The link changes/.test(kq.text) && kq.ok === 'Remove', kq);
  await own.page.click('.lmd-dlg-card [data-dlg=ok]');
  await own.page.waitForFunction((old) => { const i = document.querySelector('.lmd-live-link input'); return i && i.value !== old; }, link);
  const link3 = await own.page.inputValue('.lmd-live-link input');
  check('al sacar a alguien el enlace cambia y el cuadro lo dice', link3 !== link && /The link changed: the old one no longer works/.test(await own.page.textContent('.lmd-live-card')) && !/img/.test(await own.page.textContent('.lmd-live-people')) && /Ben/.test(await own.page.textContent('.lmd-live-people')));
  await own.page.click('.lmd-live-card [data-lv=close]');
  await eve.page.waitForFunction(() => document.querySelector('.lmd-live-bar').classList.contains('lmd-live-over'), null, { timeout: 6000 }).catch(() => {});
  const out = await eve.page.evaluate(() => ({ bar: document.querySelector('.lmd-live-msg').textContent, btns: [...document.querySelectorAll('.lmd-live-bar button')].map((b) => b.textContent), ro: document.documentElement.classList.contains('lmd-readonly'), editable: document.querySelectorAll('.lmd-article [contenteditable=true]').length, chip: document.querySelector('.lmd-live-chip').hidden, text: document.querySelector('.lmd-article').innerText.includes('Launch plan') }));
  check('la persona sacada lo ve en el acto: la barra lo dice, la nota queda a la vista sin poder editar', out.bar === 'The person who opened the session removed you. What you wrote is still here.' && J(out.btns) === J(['Download my copy', 'Open SharpMD']) && out.ro && out.editable === 0 && out.chip && out.text, out);
  check('su pase ya no sirve', (await api('GET', '/live/note', undefined, evePass)).status === 401 && (await api('PUT', '/live/note', { text: 'x', rev: 1 }, evePass)).status === 401);
  const [dl] = await Promise.all([eve.page.waitForEvent('download'), eve.page.click('.lmd-live-bar [data-lv=copy]')]);
  const fs = await import('fs'); const dlText = fs.readFileSync(await dl.path(), 'utf8');
  check('"Descargar mi copia" le da la nota como la tenía', dl.suggestedFilename() === 'plan.md' && dlText.includes('# Launch plan') && dlText.includes('VERSION-' + win), [dl.suggestedFilename(), dlText.slice(0, 80)]);
  const old = await R.open(null); await old.page.goto(link); await old.page.waitForSelector('.lmd-home');
  check('con el enlace anterior ya no se entra', /That live session has ended/.test(await old.page.evaluate(() => document.querySelector('.lmd-home').innerText)));
  await old.ctx.close(); await eve.ctx.close();
  await typeIn(ben.page, 'Last paragraph', ' Still in.', 20); await leave(ben.page);
  check('los demás siguen adentro y escribiendo', await sees(own.page, 'Still in.') && /2 people/.test(await ben.page.textContent('.lmd-live-msg')));

  // ---------- Sin conexión ----------
  console.log('Sin conexión');
  await ben.ctx.setOffline(true);
  await typeIn(ben.page, 'item one', ' offline-edit', 20); await leave(ben.page);
  await ben.page.waitForFunction(() => document.querySelector('.lmd-live-bar').classList.contains('lmd-live-down'), null, { timeout: 12000 }).catch(() => {});
  check('sin conexión la barra lo dice', (await ben.page.textContent('.lmd-live-msg')) === 'Offline. You can keep writing: it is sent when the connection is back.', await ben.page.textContent('.lmd-live-msg'));
  await typeIn(ben.page, 'item three', ' and-more', 20); await leave(ben.page);
  check('y se sigue pudiendo escribir', (await text(ben.page)).includes('offline-edit') && (await text(ben.page)).includes('and-more'));
  await typeIn(own.page, 'First paragraph', ' Meanwhile.', 20); await leave(own.page); await saved(own.page);
  await ben.ctx.setOffline(false); await ben.page.evaluate(() => window.dispatchEvent(new Event('online')));
  check('al volver, lo escrito sin conexión llega al otro', await sees(own.page, 'offline-edit', 15000) && await sees(own.page, 'and-more', 5000));
  check('y lo que cambió mientras tanto llega al que volvió', await sees(ben.page, 'Meanwhile.', 8000));
  await ben.page.waitForFunction(() => !document.querySelector('.lmd-live-bar').classList.contains('lmd-live-down'), null, { timeout: 8000 }).catch(() => {});
  check('la barra vuelve a decir de quién es la sesión', /^Live session by Ana/.test(await ben.page.textContent('.lmd-live-msg')), await ben.page.textContent('.lmd-live-msg'));
  await saved(ben.page);
  check('y los dos quedan iguales al servidor', (await rawOf(own.page)) === (await serverNote(A.s, 'team/plan.md')).text && (await rawOf(ben.page)) === (await serverNote(A.s, 'team/plan.md')).text);

  // El servidor se reinicia: la sesión sigue (el enlace vale) y el invitado vuelve a entrar solo, con su nombre.
  await R.stop(); await sleep(400);
  await typeIn(ben.page, 'Last paragraph', ' Across-restart.', 20); await leave(ben.page);
  await R.start();
  check('tras reiniciar el servidor el invitado vuelve a entrar solo y lo que escribió llega', await sees(own.page, 'Across-restart.', 25000) && (await serverNote(A.s, 'team/plan.md')).text.includes('Across-restart.'));
  await ben.page.waitForFunction(() => /^Live session by Ana · 2 people/.test(document.querySelector('.lmd-live-msg').textContent), null, { timeout: 15000 }).catch(() => {});
  check('y la barra vuelve a mostrar a los dos', (await ben.page.textContent('.lmd-live-msg')) === 'Live session by Ana · 2 people' && !(await ben.page.$('.lmd-live-card')), await ben.page.textContent('.lmd-live-msg'));

  // La sesión termina mientras el invitado está sin conexión: al volver se le ofrece descargar lo suyo.
  await ben.ctx.setOffline(true);
  await typeIn(ben.page, 'item two', ' never-sent', 20); await leave(ben.page);
  await ben.page.waitForFunction(() => document.querySelector('.lmd-live-bar').classList.contains('lmd-live-down'), null, { timeout: 12000 }).catch(() => {});
  await own.page.click('.lmd-live-chip'); await own.page.waitForSelector('.lmd-live-card [data-lv=end]'); await own.page.click('[data-lv=end]'); await own.page.waitForSelector('.lmd-dlg-card');
  check('terminar la sesión pregunta antes y dice qué pasa', /Guests stop seeing and editing the note right away, and the link stops working/.test(await own.page.textContent('.lmd-dlg-card p')) && (await own.page.textContent('.lmd-dlg-card [data-dlg=ok]')) === 'End the session');
  await own.page.click('.lmd-dlg-card [data-dlg=ok]');
  await own.page.waitForFunction(() => document.querySelector('.lmd-live-chip').hidden);
  const after = await own.page.evaluate(() => ({ card: !!document.querySelector('.lmd-live-card'), marks: document.querySelectorAll('.lmd-live-mark').length, status: document.querySelector('.lmd-status').textContent, live: document.documentElement.classList.contains('lmd-live') }));
  check('para el dueño la nota vuelve a ser una nota común', !after.card && after.marks === 0 && !after.live && (await api('GET', '/live?path=' + enc('team/plan.md'), undefined, A.s)).json.open === false, after);
  await ben.ctx.setOffline(false); await ben.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await ben.page.waitForFunction(() => document.querySelector('.lmd-live-bar').classList.contains('lmd-live-over'), null, { timeout: 20000 }).catch(() => {});
  const lateBar = await ben.page.evaluate(() => ({ bar: document.querySelector('.lmd-live-msg').textContent, btns: [...document.querySelectorAll('.lmd-live-bar button')].map((b) => b.textContent), ro: document.documentElement.classList.contains('lmd-readonly') }));
  check('el invitado que vuelve encuentra la sesión terminada y se le ofrece descargar su copia', lateBar.bar === 'The live session ended. What you wrote is still here.' && J(lateBar.btns) === J(['Download my copy', 'Open SharpMD']) && lateBar.ro, lateBar);
  const [dl2] = await Promise.all([ben.page.waitForEvent('download'), ben.page.click('.lmd-live-bar [data-lv=copy]')]);
  check('y la copia trae lo que no llegó a enviar', fs.readFileSync(await dl2.path(), 'utf8').includes('never-sent') && !(await serverNote(A.s, 'team/plan.md')).text.includes('never-sent'));
  await Promise.all([ben.page.waitForNavigation(), ben.page.click('.lmd-live-bar [data-lv=leave]')]); await ben.page.waitForSelector('.lmd-home');
  check('"Abrir SharpMD" lo lleva a la app de siempre, ya sin la sesión', !/live=/.test(ben.page.url()) && await ben.page.evaluate(() => !document.documentElement.classList.contains('lmd-guest') && sessionStorage.getItem('lmd-live') === null));
  await ben.ctx.close();
  await typeIn(own.page, 'First paragraph', ' Alone again.', 10); await leave(own.page); await saved(own.page);
  check('y el dueño sigue guardando como siempre', (await serverNote(A.s, 'team/plan.md')).text.includes('Alone again.'));

  // Carpeta protegida: no hay sesión en vivo, y se explica por qué.
  check('en una carpeta con contraseña el servidor no abre la sesión y responde con un error propio', await (async () => {
    await api('PUT', '/notes/' + enc('secreta/a.md'), { text: 'en claro' }, A.s);
    const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
    const v = await api('POST', '/vaults', { folder: 'secreta', salt: b64(16), iters: 200000, wrapped: b64(60), check: b64(32) }, A.s);
    const r = await api('POST', '/live', { path: 'secreta/a.md', name: 'Ana' }, A.s);
    return v.status === 200 && r.status === 409 && r.json.error === 'live_vault';
  })());
  await own.ctx.close();

  // ---------- Teléfono ----------
  console.log('Teléfono (390 x 844)');
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  await api('PUT', '/notes/movil.md', { text: NOTE }, A.s);
  const pOwn = await ownerAt(A, 'movil.md', PHONE);
  await pOwn.page.tap('[data-act=more]'); await pOwn.page.tap('.lmd-menu-more [data-more=sync]'); await pOwn.page.tap('.lmd-menu [data-s=live]');
  await pOwn.page.waitForSelector('.lmd-live-card [data-lv=name]'); await pOwn.page.fill('[data-lv=name]', 'Ana'); await pOwn.page.tap('[data-lv=start]'); await pOwn.page.waitForSelector('.lmd-live-link input');
  let of = await overflow(pOwn.page);
  const tapSize = await pOwn.page.evaluate(() => Math.min(...[...document.querySelectorAll('.lmd-live-card .lmd-ask-actions button')].map((b) => b.getBoundingClientRect().height)));
  check('teléfono: el cuadro de la sesión entra en la pantalla y los botones son para el dedo', of.page <= 0 && !of.bad.length && tapSize >= 40, [of, tapSize]);
  const pLink = await pOwn.page.inputValue('.lmd-live-link input'); await pOwn.page.tap('.lmd-live-card [data-lv=close]');
  const pGuest = await R.open(null, PHONE); await pGuest.page.goto(pLink); await pGuest.page.waitForSelector('.lmd-live-card input');
  of = await overflow(pGuest.page);
  check('teléfono: el pedido de nombre entra en la pantalla', of.page <= 0 && !of.bad.length && (await pGuest.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.lmd-live-card input')).fontSize))) >= 16, of);
  await pGuest.page.fill('.lmd-live-card input', 'Beatriz Fernández de la Sesión Larga'); await pGuest.page.tap('.lmd-live-card [data-lv=join]');
  await pGuest.page.waitForSelector('.lmd-live-bar'); await pGuest.page.waitForSelector('.lmd-article .lmd-editable'); await sleep(500);
  of = await overflow(pGuest.page);
  const pb = await pGuest.page.evaluate(() => ({ btn: Math.min(...[...document.querySelectorAll('.lmd-live-bar button')].map((b) => b.getBoundingClientRect().height)), chip: document.querySelector('.lmd-live-chip').innerText.replace(/\s+/g, ''), chipW: document.querySelector('.lmd-live-chip').getBoundingClientRect().width, doc: document.querySelector('.lmd-docname').getBoundingClientRect().width }));
  check('teléfono: la barra de la sesión entra, con botones de 40 px, y arriba queda cuánta gente hay', of.page <= 0 && !of.bad.length && pb.btn >= 40 && pb.chip === '2' && pb.doc > 60, [of, pb]);
  await pGuest.page.locator('.lmd-article p', { hasText: 'First paragraph' }).tap(); await pGuest.page.keyboard.type(' From the phone.', { delay: 25 });
  check('teléfono: lo escrito con el dedo llega al otro', await sees(pOwn.page, 'From the phone.'));
  await pOwn.page.waitForSelector('.lmd-live-mark');
  await pOwn.page.evaluate(() => { const p = document.querySelector('.lmd-live-held'); if (p) window.__heldOk = true; });
  await leave(pGuest.page); await pGuest.page.locator('.lmd-article p', { hasText: 'Last paragraph' }).tap(); await sleep(900);
  const pm = await pOwn.page.evaluate(() => { const m = document.querySelector('.lmd-live-mark'); const r = m.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, tagShown: getComputedStyle(m.querySelector('.lmd-live-tag')).opacity }; });
  await pOwn.page.tap('.lmd-live-mark'); await sleep(250);
  const tagNow = await pOwn.page.evaluate(() => { const t = document.querySelector('.lmd-live-mark .lmd-live-tag'); const r = t.getBoundingClientRect(); return { text: t.textContent, shown: getComputedStyle(t).opacity, right: r.right, w: window.innerWidth }; });
  check('teléfono: la marca queda dentro de la pantalla y al tocarla se lee el nombre', pm.left >= 0 && pm.right <= 390 && pm.tagShown === '0' && tagNow.shown === '1' && /^Beatriz/.test(tagNow.text) && tagNow.right <= tagNow.w, [pm, tagNow]);
  await pOwn.page.tap('.lmd-live-chip'); await pOwn.page.waitForSelector('.lmd-live-people li');
  of = await overflow(pOwn.page);
  check('teléfono: el cuadro con la gente entra, con el nombre largo recortado', of.page <= 0 && !of.bad.length && (await pOwn.page.$$('.lmd-live-people li')).length === 2, of);
  await pOwn.page.tap('.lmd-live-card [data-lv=close]');
  await pGuest.page.tap('.lmd-live-bar [data-lv=leave]');
  await pGuest.page.waitForSelector('.lmd-home', { timeout: 10000 });
  await pOwn.page.waitForFunction(() => document.querySelector('.lmd-live-chip').innerText.replace(/\s+/g, '') === '1', null, { timeout: 6000 }).catch(() => {});
  check('teléfono: "Salir de la sesión" lo saca y el dueño deja de verlo', !/live=/.test(pGuest.page.url()) && (await api('GET', '/live?path=movil.md', undefined, A.s)).json.people.length === 1);
  await pGuest.ctx.close(); await pOwn.ctx.close();

  // ---------- Aguante: tres escribiendo a la vez ----------
  console.log('Tres escribiendo a la vez, 30 segundos');
  const BIG = '# Aguante\n\nBloque de Ana:\n\nBloque de Ben:\n\nBloque de Caro:\n\n## Lista\n\n- ana:\n- ben:\n- caro:\n\nFin.\n';
  await api('PUT', '/notes/aguante.md', { text: BIG }, A.s);
  const s1 = await ownerAt(A, 'aguante.md'); const sLink = await startLive(s1.page, 'Ana');
  const s2 = await joinLive(sLink, 'Ben'); const s3 = await joinLive(sLink, 'Caro');
  const team = [['ana', s1, 'Bloque de Ana:', 'ana:'], ['ben', s2, 'Bloque de Ben:', 'ben:'], ['caro', s3, 'Bloque de Caro:', 'caro:']];
  const typed = { ana: [], ben: [], caro: [] }; const stats = { 409: 0, 200: 0, 429: 0 };
  for (const [, c] of team) c.page.on('response', (r) => { if (r.request().method() === 'PUT' && stats[r.status()] !== undefined) stats[r.status()]++; });
  const until = Date.now() + 30000;
  // Cada uno escribe palabras numeradas en su párrafo; cada tanto pasa a su ítem de la lista, o abre un bloque nuevo con Enter.
  const work = async ([who, c, para, item]) => {
    let n = 0; let where = 'p';
    await c.page.locator('.lmd-article p', { hasText: para }).click(); await c.page.keyboard.press('Control+End');
    while (Date.now() < until) {
      const word = ' ' + who + n++;
      await c.page.keyboard.type(word, { delay: 8 + (n % 5) * 6 }); typed[who].push(word.trim());
      await sleep(40 + (n * 37) % 260);
      if (n % 9 === 0) {
        where = where === 'p' ? 'li' : 'p';
        const target = where === 'li' ? c.page.locator('.lmd-article li .lmd-li-text', { hasText: item }) : c.page.locator('.lmd-article p', { hasText: para });
        await target.first().click({ timeout: 4000 }).catch(() => {}); await c.page.keyboard.press('Control+End');
      }
      if (n % 14 === 0 && where === 'p') { await c.page.keyboard.press('Enter'); await sleep(150); const w2 = who + 'nuevo' + n; await c.page.keyboard.type(w2, { delay: 10 }); typed[who].push(w2); await sleep(700); await c.page.locator('.lmd-article p', { hasText: para }).first().click({ timeout: 4000 }).catch(() => {}); await c.page.keyboard.press('Control+End'); }
    }
    await leave(c.page);
  };
  await Promise.all(team.map(work));
  await sleep(1500);
  for (const [, c] of team) await saved(c.page);
  await sleep(1500);
  const endNote = await serverNote(A.s, 'aguante.md'); const all = typed.ana.concat(typed.ben, typed.caro);
  const countOf = (t, w) => t.split(new RegExp('(?<![a-z0-9])' + w + '(?![a-z0-9])')).length - 1;
  const missing = all.filter((w) => countOf(endNote.text, w) === 0); const twice = all.filter((w) => countOf(endNote.text, w) > 1);
  check('tres escribiendo 30 segundos: no se perdió ninguna palabra (' + all.length + ' palabras, ' + stats[200] + ' guardados, ' + stats[409] + ' rechazados y reintentados)', all.length > 150 && missing.length === 0, { total: all.length, missing: missing.slice(0, 12), stats });
  check('y ninguna quedó duplicada', twice.length === 0, twice.slice(0, 12));
  const raws = []; for (const [, c] of team) raws.push(await rawOf(c.page));
  check('el Markdown final es idéntico en los tres y en el servidor', raws.every((r) => r === endNote.text), raws.map((r) => r.length).concat(endNote.text.length));
  const shown3 = []; for (const [, c] of team) shown3.push((await text(c.page)).replace(/\s+/g, ' ').trim());
  check('y lo que se ve en pantalla también', shown3[0] === shown3[1] && shown3[1] === shown3[2], shown3.map((x) => x.length));
  check('cada uno escribió en lo suyo: las palabras de cada persona quedaron en orden dentro de su párrafo', team.every(([who, , para]) => { const line = endNote.text.split('\n').find((l) => l.startsWith(para)) || ''; const nums = (line.match(new RegExp(who + '(\\d+)', 'g')) || []).map((w) => +w.replace(who, '')); return nums.length > 5 && nums.every((x, i) => !i || x > nums[i - 1]); }), endNote.text.slice(0, 600));
  check('ningún invitado llegó al tope de guardados por minuto', stats[429] === 0, stats);
  for (const [, c] of team) await c.ctx.close();

  check('sin errores de página', !R.errors.length, R.errors.slice(0, 5));
  check('ningún pedido salió a producción', !R.outside.length, R.outside.slice(0, 5));
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }
await R.close();
process.exit(done() ? 1 : 0);
