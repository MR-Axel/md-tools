// Guardado con revisión: cada nota tiene un número que sube con cada guardado, y un guardado hecho sobre una
// revisión vieja no pisa: vuelve 409 con lo que hay, y la app junta y reintenta. Se prueba contra el servidor
// (pedidos sueltos y muchos a la vez), la mezcla por líneas, y con dos navegadores de verdad escribiendo a la vez.
// Todo contra un servidor local.
import { rig, tally, sleep, typeIn, leave } from './rig.mjs';
const R = await rig({ MCP_FREE: '1', SHARE_FREE: '1' });
const { check, done } = tally();
const enc = encodeURIComponent;
const J = (v) => JSON.stringify(v);

try {
  const { api } = R;
  const A = await R.signup('ana@ejemplo.test', true); const B = await R.signup('beto@ejemplo.test', true);

  // ---------- El servidor ----------
  console.log('Revisión en el servidor');
  const first = await api('PUT', '/notes/uno.md', { text: 'a\nb\nc' }, A.s);
  check('una nota nueva nace en la revisión 1', first.status === 200 && first.json.rev === 1, first.json);
  const got = await api('GET', '/notes/uno.md', undefined, A.s);
  check('leer devuelve la revisión', got.json.rev === 1 && got.json.text === 'a\nb\nc', got.json);
  const second = await api('PUT', '/notes/uno.md', { text: 'a\nb\nc\nd', rev: 1 }, A.s);
  check('guardar sobre la revisión actual la sube de a uno', second.status === 200 && second.json.rev === 2, second.json);
  const stale = await api('PUT', '/notes/uno.md', { text: 'PISADO', rev: 1 }, A.s);
  check('guardar sobre una revisión vieja responde 409 con el texto y la revisión de ahora', stale.status === 409 && stale.json.error === 'rev_conflict' && stale.json.text === 'a\nb\nc\nd' && stale.json.rev === 2, stale.json);
  check('y no guarda nada', (await api('GET', '/notes/uno.md', undefined, A.s)).json.text === 'a\nb\nc\nd');
  const ahead = await api('PUT', '/notes/uno.md', { text: 'PISADO', rev: 9 }, A.s);
  check('una revisión que todavía no existe tampoco pasa', ahead.status === 409 && ahead.json.rev === 2, ahead.json);
  const legacy = await api('PUT', '/notes/uno.md', { text: 'sin revisión' }, A.s);
  check('un guardado sin revisión sigue entrando, como antes (extensión sin actualizar)', legacy.status === 200 && legacy.json.rev === 3, legacy.json);
  for (const bad of ['2', 1.5, -1, {}, true]) {
    const r = await api('PUT', '/notes/uno.md', { text: 'x', rev: bad }, A.s);
    if (r.status !== 400 || r.json.error !== 'bad_rev') { check('una revisión mal formada se rechaza: ' + J(bad), false, r.json); }
  }
  check('una revisión mal formada se rechaza sin guardar', (await api('GET', '/notes/uno.md', undefined, A.s)).json.text === 'sin revisión');
  check('una revisión null vale como no mandarla', (await api('PUT', '/notes/uno.md', { text: 'con null', rev: null }, A.s)).status === 200);

  // Compartida para editar: la otra cuenta también guarda con revisión, y el aviso en vivo la trae.
  await api('POST', '/shares', { path: 'uno.md', email: B.email, role: 'edit' }, A.s);
  const ctrl = new AbortController(); let stream = '';
  const ev = await fetch(R.base + '/events?path=uno.md', { headers: { authorization: 'Bearer ' + A.s }, signal: ctrl.signal });
  (async () => { const rd = ev.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; stream += d.decode(x.value); } } catch (e) { /* se cortó a propósito */ } })();
  await sleep(150);
  const theirs = await api('GET', '/notes/uno.md?o=' + A.id, undefined, B.s);
  const shared = await api('PUT', '/notes/uno.md?o=' + A.id, { text: 'de beto', rev: theirs.json.rev }, B.s);
  check('quien edita una nota compartida guarda con revisión', shared.status === 200 && shared.json.rev === theirs.json.rev + 1, shared.json);
  check('y con una vieja recibe el 409', (await api('PUT', '/notes/uno.md?o=' + A.id, { text: 'x', rev: theirs.json.rev }, B.s)).status === 409);
  await sleep(200);
  check('el aviso de guardado trae la revisión nueva', new RegExp('"type":"saved","by":"beto@ejemplo.test","updated":\\d+,"rev":' + shared.json.rev).test(stream), stream.slice(-300));

  // MCP: escribe sobre la revisión actual, la sube, y avisa a quien tiene la nota abierta.
  const tok = (await api('POST', '/tokens', { name: 'IA' }, A.s)).json.token;
  const tool = async (name, args) => { const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tok); return r.json.result; };
  const before = (await api('GET', '/notes/uno.md', undefined, A.s)).json.rev;
  const w = await tool('write_note', { path: 'uno.md', text: 'de la IA' });
  const after = (await api('GET', '/notes/uno.md', undefined, A.s)).json;
  check('write_note guarda y sube la revisión', !w.isError && after.rev === before + 1 && after.text === 'de la IA', [w, after]);
  await tool('append_note', { path: 'uno.md', text: 'agregado' });
  const appended = (await api('GET', '/notes/uno.md', undefined, A.s)).json;
  check('append_note agrega sobre lo que hay y sube la revisión', appended.rev === before + 2 && appended.text === 'de la IA\n\nagregado', appended);
  await sleep(200);
  check('lo que escribe la IA se avisa en vivo, con su revisión', new RegExp('"type":"saved","by":"mcp","updated":\\d+,"rev":' + appended.rev).test(stream), stream.slice(-300));
  check('quien guardaba sobre la revisión anterior a la IA recibe el 409', (await api('PUT', '/notes/uno.md', { text: 'x', rev: before }, A.s)).status === 409);
  ctrl.abort();
  // Cuarenta agregados de la IA a la vez contra cuarenta guardados de la app: no se pierde ninguno de la IA.
  await api('PUT', '/notes/ia.md', { text: 'inicio' }, A.s);
  await Promise.all(Array.from({ length: 40 }, (_, i) => [tool('append_note', { path: 'ia.md', text: 'ia-' + i }), (async () => {
    for (;;) { const n = (await api('GET', '/notes/ia.md', undefined, A.s)).json; const r = await api('PUT', '/notes/ia.md', { text: n.text + '\n\napp-' + i, rev: n.rev }, A.s); if (r.status === 200) return; }
  })()]).flat());
  const mixed = (await api('GET', '/notes/ia.md', undefined, A.s)).json;
  const count = (re) => (mixed.text.match(re) || []).length;
  check('IA y app escribiendo a la vez: están los 40 agregados de cada una, una vez', count(/ia-\d+/g) === 40 && count(/app-\d+/g) === 40 && new Set(mixed.text.match(/(ia|app)-\d+/g)).size === 80 && mixed.rev === 81, [count(/ia-\d+/g), count(/app-\d+/g), mixed.rev]);

  // Muchos a la vez sobre la misma revisión: entra uno solo.
  await api('PUT', '/notes/carrera.md', { text: 'base' }, A.s);
  const race = await Promise.all(Array.from({ length: 40 }, (_, i) => api('PUT', '/notes/carrera.md', { text: 'gana ' + i, rev: 1 }, A.s)));
  const won = race.filter((r) => r.status === 200); const lost = race.filter((r) => r.status === 409);
  const final = (await api('GET', '/notes/carrera.md', undefined, A.s)).json;
  check('cuarenta guardados a la vez sobre la misma revisión: entra uno y los otros 39 reciben 409', won.length === 1 && lost.length === 39 && final.rev === 2, [won.length, lost.length, final.rev]);
  check('los 39 reciben el texto del que entró', lost.every((r) => r.json.text === final.text && r.json.rev === 2));

  // Renombrar no deja la revisión en cero, y la nota vieja deja de existir.
  await api('POST', '/rename', { from: 'carrera.md', to: 'carrera-2.md' }, A.s);
  check('la nota renombrada conserva su revisión', (await api('GET', '/notes/carrera-2.md', undefined, A.s)).json.rev === 2);

  // ---------- La mezcla por líneas ----------
  console.log('Mezcla por líneas');
  const { page: lab } = await R.open(A);
  await lab.goto(R.home); await lab.waitForFunction(() => window.LMD && LMD.cloud && LMD.cloud.merge);
  const merge = (b, m, t) => lab.evaluate(([x, y, z]) => LMD.cloud.merge(x, y, z), [b, m, t]);
  const L = (s) => s.split('').join('\n');
  let m = await merge(L('abcdefgh'), L('aBcdefgh'), L('abcdefGh'));
  check('dos cambios en partes distintas entran los dos', m.text === L('aBcdefGh') && !m.lost.length, m);
  m = await merge(L('abcdefgh'), L('aBcdeFgh'), L('abcDefgh'));
  check('cambios intercalados (uno arriba y abajo, el otro en el medio) también se juntan', m.text === L('aBcDeFgh') && !m.lost.length, m);
  check('merge3 ya no falla por eso', await lab.evaluate(([x, y, z]) => LMD.cloud.merge3(x, y, z), [L('abcdefgh'), L('aBcdeFgh'), L('abcDefgh')]) === L('aBcDeFgh'));
  m = await merge(L('abc'), L('aXc'), L('aYc'));
  check('la misma línea cambiada por los dos: queda lo guardado y lo de acá vuelve aparte', m.text === L('aYc') && m.lost.length === 1 && m.lost[0].mine === 'X' && m.lost[0].theirs === 'Y', m);
  check('merge3 lo da por no mezclable', await lab.evaluate(([x, y, z]) => LMD.cloud.merge3(x, y, z), [L('abc'), L('aXc'), L('aYc')]) === null);
  m = await merge(L('abc'), L('aXc'), L('aXc'));
  check('el mismo cambio de los dos lados no es un choque', m.text === L('aXc') && !m.lost.length, m);
  m = await merge(L('abc'), L('abc') + '\nmío', L('abc') + '\nsuyo');
  check('dos agregados en el mismo lugar quedan los dos', m.text === L('abc') + '\nmío\nsuyo' && !m.lost.length, m);
  m = await merge(L('abcdef'), L('aXcdeZ'), L('aYcdef'));
  check('un choque arriba no arrastra el cambio de abajo', m.text === L('aYcdeZ') && m.lost.length === 1 && m.lost[0].mine === 'X', m);
  m = await merge(L('abcdef'), L('adef'), L('abXcdef'));
  check('borrar líneas que el otro tocó es un choque: nada se pierde en silencio', m.lost.length === 1 && m.text === L('abXcdef'), m);
  m = await merge('', 'a', 'b');
  check('sobre una nota vacía', m.lost.length === 1 || m.text === 'a\nb', m);
  // Al azar: sin choques, mezclar en un orden o en el otro da lo mismo y no se pierde ni se duplica nada.
  const fuzz = await lab.evaluate(() => {
    let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let bad = 0; let clean = 0;
    for (let turn = 0; turn < 400; turn++) {
      const base = Array.from({ length: 30 }, (_, i) => 'línea ' + i + ' ' + rnd(5));
      const edit = (tag, from, to) => { const x = base.slice(); for (let k = 0; k < 3; k++) { const at = from + rnd(to - from); const op = rnd(3); if (op === 0) x[at] = tag + turn + '-' + k; else if (op === 1) x.splice(at, 0, tag + turn + '+' + k); else x[at] = x[at] + ' ' + tag; } return x; };
      // Cada uno edita su mitad: no hay choque posible.
      const mine = edit('M', 0, 14); const theirs = edit('T', 16, 30);
      const r = LMD.cloud.merge(base.join('\n'), mine.join('\n'), theirs.join('\n')); const back = LMD.cloud.merge(base.join('\n'), theirs.join('\n'), mine.join('\n'));
      const want = mine.slice(0, mine.length - 15).concat(theirs.slice(15));
      if (r.lost.length || back.lost.length || r.text !== back.text || r.text !== want.join('\n')) bad++; else clean++;
    }
    return { bad, clean };
  });
  check('400 mezclas al azar en mitades distintas: siempre entran las dos, en cualquier orden', fuzz.bad === 0 && fuzz.clean === 400, fuzz);
  const big = await lab.evaluate(() => {
    const base = Array.from({ length: 20000 }, (_, i) => 'renglón ' + i); const mine = base.slice(); const theirs = base.slice();
    mine[100] = 'mío'; theirs[19000] = 'suyo'; const t0 = performance.now();
    const r = LMD.cloud.merge(base.join('\n'), mine.join('\n'), theirs.join('\n'));
    const lines = r.text.split('\n');
    return { ok: !r.lost.length && lines[100] === 'mío' && lines[19000] === 'suyo' && lines.length === 20000, ms: Math.round(performance.now() - t0) };
  });
  check('una nota de 20.000 renglones se mezcla en menos de un segundo', big.ok && big.ms < 1000, big);
  await lab.context().close();

  // ---------- Dos navegadores a la vez ----------
  console.log('Dos navegadores guardando a la vez');
  const NOTE = '# Plan\n\nPrimer párrafo.\n\nSegundo párrafo.\n\nTercer párrafo.\n';
  await api('PUT', '/notes/' + enc('equipo/plan.md'), { text: NOTE }, A.s);
  const one = await R.open(A); const two = await R.open(A);
  const puts = []; // cada guardado que sale de un navegador, con cómo le fue
  for (const [who, c] of [['uno', one], ['dos', two]]) c.page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/notes\//.test(r.url())) puts.push([who, r.status()]); });
  const serverText = async () => (await api('GET', '/notes/' + enc('equipo/plan.md'), undefined, A.s)).json;
  const shown = (page) => page.evaluate(() => document.querySelector('.lmd-article').innerText);
  const settled = (page) => page.waitForFunction(() => /Saved to the cloud/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 15000 });
  for (const c of [one, two]) { await c.page.goto(R.noteUrl('equipo/plan.md', true)); await c.page.waitForSelector('.lmd-article p.lmd-editable'); }

  // Diez rondas: cada uno escribe en su párrafo y los dos sueltan el bloque en el mismo instante.
  for (let i = 0; i < 10; i++) {
    await typeIn(one.page, 'Primer párrafo', ' uno' + i + '.', 0); await typeIn(two.page, 'Tercer párrafo', ' dos' + i + '.', 0);
    await Promise.all([leave(one.page), leave(two.page)]);
    await Promise.all([settled(one.page), settled(two.page)]);
    await one.page.waitForFunction((n) => new RegExp('dos' + n + '\\.').test(document.querySelector('.lmd-article').innerText), i, { timeout: 15000 });
    await two.page.waitForFunction((n) => new RegExp('uno' + n + '\\.').test(document.querySelector('.lmd-article').innerText), i, { timeout: 15000 });
  }
  const end = await serverText();
  const all = (t) => Array.from({ length: 10 }, (_, i) => i).every((i) => t.includes(' uno' + i + '.') && t.includes(' dos' + i + '.'));
  const once = (t) => Array.from({ length: 10 }, (_, i) => i).every((i) => t.split(' uno' + i + '.').length === 2 && t.split(' dos' + i + '.').length === 2);
  check('diez rondas de dos guardados a la vez en párrafos distintos: en el servidor están los veinte cambios', all(end.text), end.text);
  check('ninguno quedó duplicado', once(end.text), end.text);
  check('hubo guardados rechazados por la revisión y se resolvieron solos', puts.some((p) => p[1] === 409) && puts.filter((p) => p[1] === 200).length >= 20, puts.map((p) => p[1]).join(' '));
  check('los dos navegadores muestran lo mismo que el servidor', all(await shown(one.page)) && all(await shown(two.page)));
  check('y quedaron en "guardado"', /Saved to the cloud/.test(await one.page.textContent('.lmd-savestate')) && /Saved to the cloud/.test(await two.page.textContent('.lmd-savestate')));

  // Los dos cambian el mismo párrafo a la vez: entra el que llegó primero, y al otro se le pregunta qué queda.
  await typeIn(one.page, 'Segundo párrafo', ' VERSION-UNO', 0); await typeIn(two.page, 'Segundo párrafo', ' VERSION-DOS', 0);
  await Promise.all([leave(one.page), leave(two.page)]);
  await Promise.race([one.page.waitForSelector('.lmd-mrg', { timeout: 20000 }), two.page.waitForSelector('.lmd-mrg', { timeout: 20000 })]);
  await sleep(1500);
  const clash = (await serverText()).text; const kept = /VERSION-UNO/.test(clash) ? 'UNO' : 'DOS'; const loser = kept === 'UNO' ? two : one; const other = kept === 'UNO' ? 'DOS' : 'UNO';
  check('los dos sobre el mismo párrafo: en el servidor queda una versión entera, no una mezcla rota', (/VERSION-UNO/.test(clash)) !== (/VERSION-DOS/.test(clash)) && /Segundo párrafo\. VERSION-(UNO|DOS)\n/.test(clash), clash);
  const asked = await loser.page.evaluate(() => { const b = document.querySelector('.lmd-mrg'); return b ? { texts: [...b.querySelectorAll('.lmd-mrg-text')].map((n) => n.textContent), state: document.querySelector('.lmd-savestate').textContent } : null; });
  check('a quien no entró se le pregunta qué queda, con las dos versiones a la vista, y mientras tanto no se guarda', !!asked && asked.texts.length === 2 && asked.texts[0].includes('VERSION-' + other) && asked.texts[1].includes('VERSION-' + kept) && /Saving paused/.test(asked.state), asked);
  check('y nada quedó aparte ni se perdió: la decisión es suya', (await loser.page.evaluate(async () => (await LMD.store.notesAll()).length)) === 0 && (await serverText()).text === clash);
  await loser.page.click('.lmd-mrg [data-mrg=theirs]'); await loser.page.waitForSelector('.lmd-mrg', { state: 'detached' });
  await loser.page.waitForFunction((k) => document.querySelector('.lmd-article').innerText.includes('VERSION-' + k), kept, { timeout: 15000 });
  check('los dos terminan mostrando la versión que quedó', (await shown(one.page)).includes('VERSION-' + kept) && (await shown(two.page)).includes('VERSION-' + kept));

  // Sin conexión: lo escrito espera, y al volver se junta con lo que cambió mientras tanto en vez de pisarlo.
  await two.ctx.route((url) => url.href.startsWith(R.base), (r) => r.abort());
  await typeIn(two.page, 'Tercer párrafo', ' sin-conexion.', 0); await leave(two.page);
  await two.page.waitForFunction(() => /Offline/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 15000 });
  await typeIn(one.page, 'Primer párrafo', ' mientras-tanto.', 0); await leave(one.page); await settled(one.page);
  const mid = await serverText();
  await two.ctx.unroute((url) => url.href.startsWith(R.base)); await two.ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await two.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled(two.page);
  const back = await serverText();
  check('lo escrito sin conexión sube al volver, junto con lo que cambió mientras tanto', back.text.includes('sin-conexion.') && back.text.includes('mientras-tanto.') && back.rev > mid.rev, back);
  await one.page.waitForFunction(() => document.querySelector('.lmd-article').innerText.includes('sin-conexion.'), null, { timeout: 15000 });
  check('y el otro navegador lo recibe', true);

  // Con la pestaña cerrada: lo pendiente sube desde la cola, también sobre la revisión que haya.
  await two.ctx.route((url) => url.href.startsWith(R.base), (r) => r.abort());
  await typeIn(two.page, 'Tercer párrafo', ' en-la-cola.', 0); await leave(two.page);
  await two.page.waitForFunction(() => /Offline/.test(document.querySelector('.lmd-savestate').textContent), null, { timeout: 15000 });
  await two.page.goto('about:blank');
  await typeIn(one.page, 'Primer párrafo', ' otra-vez.', 0); await leave(one.page); await settled(one.page);
  await two.ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await two.page.goto(R.home); await two.page.waitForSelector('.lmd-home');
  let queued = null;
  for (let i = 0; i < 40; i++) { queued = await serverText(); if (queued.text.includes('en-la-cola.')) break; await sleep(250); }
  check('lo que quedó en la cola con la pestaña cerrada sube sin pisar lo del otro', queued.text.includes('en-la-cola.') && queued.text.includes('otra-vez.'), queued);

  check('sin errores de página', !R.errors.length, R.errors);
  check('ningún pedido salió a producción', !R.outside.length, R.outside);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(R.log().slice(-1500)); }
await R.close();
process.exit(done() ? 1 : 0);
