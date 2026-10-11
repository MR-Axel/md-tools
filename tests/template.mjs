// Plantillas: una carpeta de la nube compartida con un enlace para que cada persona se lleve su copia.
// Quien comparte la marca como plantilla, decide si pide una cuenta y le pone un nombre corto (sharpmd.app/t/<nombre>).
// Quien abre el enlace la ve de solo lectura y se lleva una copia: a su navegador, a su nube (entrando ahí mismo con
// el código del correo) o en un ZIP. El original no cambia en ningún caso, y nada de afuera de la carpeta sale.
// Todo contra un servidor local (FREE_NOTES=6) y la app web. Capturas en C:\tmp\agplantilla\ (o SHOTS).
// Uso: node template.mjs
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { rig, tally, sleep, root, leave } from './rig.mjs';

const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { let v = null; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(80); } };
const SHOTS = process.env.SHOTS || 'C:\\tmp\\agplantilla';
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* sin carpeta de capturas, se sigue */ }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { /* una captura que falla no frena la prueba */ } };

const FREE = 6;
const R = await rig({ FREE_NOTES: String(FREE), ALLOW_ORIGINS: '*' });
// La plantilla: cuatro notas, una en una subcarpeta, con enlaces entre ellas y una tarea.
const TPL = {
  'Planillas/README.md': '# Planillas\n\nEmpezá por [la primera semana](semana-1.md) y mirá [las metas](extra/metas.md).\n\n- [ ] Tarea de ejemplo\n',
  'Planillas/semana-1.md': '# Semana 1\n\nCompletá esta planilla. [Volver](README.md)\n',
  'Planillas/semana-2.md': '# Semana 2\n\nOtra planilla.\n',
  'Planillas/extra/metas.md': '# Metas\n\n[Arriba](../README.md)\n',
};
// Lo que NO es de la plantilla: vecinas de nombre parecido y una carpeta privada.
const OTHER = { 'Planillas-vecina.md': '# Vecina\n\nSECRETO-VECINA\n', 'Planillas2/otra.md': '# Otra\n\nSECRETO-DOS\n', 'privado/diario.md': '# Diario\n\nSECRETO-DIARIO\n',
  'Curso/clase-1.md': '# Clase 1\n\nCon cuenta.\n', 'Curso/clase-2.md': '# Clase 2\n', 'Vieja/a.md': '# Vieja\n', 'Nueva/b.md': '# Nueva\n',
  'Mover/uno.md': '# Uno\n', 'Mover/sub/dos.md': '# Dos\n', 'Sola/unica.md': '# Unica\n', 'Llena/ya.md': '# Ya estaba\n\nSECRETO-LLENA\n', 'cofre/x.md': '# Cofre\n' };
const rel = (o, pre) => Object.keys(o).filter((p) => p.startsWith(pre)).map((p) => p.slice(pre.length)).sort();
// Un ZIP, leído por su índice: { nombre: texto }.
function unzip(buf) {
  const out = {}; const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10); const size = buf.readUInt32LE(p + 20); const nl = buf.readUInt16LE(p + 28); const el = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'); const at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.slice(at, at + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nl + el + cl;
  }
  return out;
}
const vb = (n, seed) => Buffer.from(Array.from({ length: n }, (x, i) => (i * 7 + seed * 13) % 256)).toString('base64');
const noShout = (s) => !/[!¡—]/.test(s);

let bad = 1;
try {
  const api = R.api;
  const autora = await R.signup('autora@example.test', true); const colega = await R.signup('colega@example.test', true);
  const put = (who, p, text) => api('PUT', '/notes/' + encodeURIComponent(p), { text }, who.s);
  for (const [p, t] of Object.entries(Object.assign({}, TPL, OTHER))) await put(autora, p, t);
  await put(colega, 'Suya/nota.md', '# De la colega\n');
  const notesOf = async (who) => { const out = {}; for (const n of (await api('GET', '/notes', undefined, who.s)).json) out[n.path] = [(await api('GET', '/notes/' + encodeURIComponent(n.path), undefined, who.s)).json.text, n.updated]; return out; };
  const before = await notesOf(autora);
  const links = async (who, p) => (await api('GET', '/shares?path=' + encodeURIComponent(p), undefined, who.s)).json.links;
  const copiesOf = async (p) => ((await links(autora, p))[0] || {}).copies;
  const from = (ip) => ({ 'x-forwarded-for': ip }); // otra red, para no gastar los topes de esta

  // ---------- El servidor ----------
  console.log('Una carpeta con enlace');
  const plain = (await api('POST', '/links', { path: 'Planillas', kind: 'folder' }, autora.s));
  check('una carpeta de la nube tiene su enlace de solo lectura', plain.status === 200 && plain.json.kind === 'folder' && !!plain.json.token && plain.json.template === false && plain.json.copies === 0, plain.json);
  const tok = plain.json.token; const linkId = plain.json.id;
  const seen = (await api('GET', '/public/' + tok)).json;
  check('quien tiene el enlace ve las notas de la carpeta, con las de sus subcarpetas, y nada más', seen.kind === 'folder' && seen.name === 'Planillas' && J(seen.notes.map((n) => n.path).sort()) === J(rel(TPL, 'Planillas/')) && seen.template === null && !seen.notes.some((n) => 'text' in n), seen);
  const one = (await api('GET', '/public/' + tok + '?note=' + encodeURIComponent('extra/metas.md'))).json;
  check('y lee cada nota por su ruta adentro de la carpeta', one.path === 'extra/metas.md' && one.text === TPL['Planillas/extra/metas.md'], one);
  const out1 = await api('GET', '/public/' + tok + '?note=' + encodeURIComponent('../privado/diario.md'));
  const out2 = await api('GET', '/public/' + tok + '?note=' + encodeURIComponent('otra.md'));
  const out3 = await api('GET', '/public/' + tok + '?note=' + encodeURIComponent('/privado/diario.md'));
  check('una ruta que sale de la carpeta no devuelve nada', out1.status >= 400 && out2.status === 404 && out3.status === 404 && ![out1, out2, out3].some((r) => /SECRETO/.test(J(r.json))), [out1.status, out2.status, out3.status]);
  check('sin marcarla como plantilla no se entrega entera ni cuenta copias', (await api('GET', '/public/' + tok + '?all=1')).json.error === 'not_template' && (await api('POST', '/public/' + tok + '/copied')).json.error === 'not_template');
  check('un enlace de carpeta no lleva contraseña', (await api('POST', '/links', { path: 'Planillas', kind: 'folder', password: 'x' }, autora.s)).json.error === 'folder_password');
  check('una carpeta que no existe no se comparte, y sin el plan pago tampoco', (await api('POST', '/links', { path: 'no-hay', kind: 'folder' }, autora.s)).status === 404 && (await api('POST', '/links', { path: 'x', kind: 'folder' }, (await R.signup('gratis@example.test')).s)).json.error === 'share_needs_plan');

  console.log('Plantilla, nombre corto y nombres que no se dan');
  const setL = (id, body, who) => api('PUT', '/links/' + id, body, (who || autora).s);
  check('un nombre con mayúsculas, espacios o guiones de más no entra', (await setL(linkId, { template: true, name: 'Mi Plantilla' })).json.error === 'bad_name' && (await setL(linkId, { template: true, name: 'ab' })).json.error === 'bad_name'
    && (await setL(linkId, { template: true, name: '-planillas' })).json.error === 'bad_name' && (await setL(linkId, { template: true, name: 'a--b' })).json.error === 'bad_name' && (await setL(linkId, { template: true, name: 'x'.repeat(41) })).json.error === 'bad_name');
  const reserved = []; for (const n of ['admin', 'api', 'sharpmd', 'sharp-md-oficial', 'plantillas', 'login', 'src', 'support']) reserved.push((await setL(linkId, { template: true, name: n })).json.error);
  check('los nombres reservados no se dan', reserved.every((e) => e === 'name_reserved'), reserved);
  check('un nombre rechazado no deja la plantilla a medio marcar', (await links(autora, 'Planillas'))[0].template === false && (await links(autora, 'Planillas'))[0].name === '');
  const named = await setL(linkId, { template: true, name: 'planillas-libro' });
  check('marcada como plantilla, con su nombre: se guarda con el enlace', named.status === 200 && named.json.template === true && named.json.login === false && named.json.name === 'planillas-libro' && named.json.copies === 0, named.json);
  const mine = (await links(autora, 'Planillas'))[0];
  check('quien administra el enlace lo ve con sus opciones y su contador', mine.kind === 'folder' && mine.path === 'Planillas' && mine.template && !mine.login && mine.name === 'planillas-libro' && mine.copies === 0, mine);
  check('la lista de enlaces de una nota no cambia de forma', J(Object.keys((await api('POST', '/links', { path: 'privado/diario.md' }, autora.s)).json).sort()) === J(['id', 'protected', 'token']) && J(Object.keys((await links(autora, 'privado/diario.md'))[0]).sort()) === J(['created', 'id', 'path', 'protected']));
  const theirs = (await api('POST', '/links', { path: 'Suya', kind: 'folder', template: true, name: 'planillas-libro' }, colega.s));
  check('otra cuenta no puede tomar ese nombre, y su enlace no queda creado', theirs.json.error === 'name_taken' && !(await links(colega, 'Suya')).length, theirs.json);
  const byName = (await api('GET', '/template/planillas-libro')).json;
  check('la plantilla se abre por su nombre, sin secreto', byName.kind === 'folder' && byName.name === 'Planillas' && byName.template.name === 'planillas-libro' && byName.template.login === false && byName.notes.length === 4, byName);
  check('el nombre vale con mayúsculas', (await api('GET', '/template/Planillas-Libro')).status === 200);
  const miss = await api('GET', '/template/no-existe', undefined, undefined, from('10.9.9.1'));
  check('un nombre que no existe responde 404', miss.status === 404 && miss.json.error === 'not_found', miss.json);
  const tries = []; for (let i = 0; i < 62; i++) tries.push((await api('GET', '/template/nombre-al-azar-' + i, undefined, undefined, from('10.9.9.2'))).status);
  check('probar nombres al azar tiene tope por red', tries.slice(0, 60).every((s) => s === 404) && tries[61] === 429, tries.slice(58));

  console.log('Carpeta protegida');
  const vault = await api('POST', '/vaults', { folder: 'cofre', salt: vb(16, 1), iters: 200000, wrapped: vb(60, 2), check: vb(32, 3) }, autora.s);
  const locked = await api('POST', '/links', { path: 'cofre', kind: 'folder', template: true }, autora.s);
  check('una carpeta protegida con contraseña no se puede compartir con un enlace ni marcar como plantilla', vault.status === 200 && locked.status === 409 && locked.json.error === 'vault', [vault.status, locked.json]);

  console.log('Llevársela entera, y el contador');
  const all = (await api('GET', '/template/planillas-libro?all=1', undefined, undefined, from('10.1.1.1'))).json;
  check('la plantilla se entrega entera: sus cuatro notas con el texto, y ni una de afuera', J(all.notes.map((n) => n.path).sort()) === J(rel(TPL, 'Planillas/')) && all.notes.every((n) => n.text === TPL['Planillas/' + n.path]) && !/SECRETO/.test(J(all)), all.notes.map((n) => n.path));
  const c1 = (await api('POST', '/template/planillas-libro/copied', undefined, undefined, from('10.1.1.1'))).json;
  const c2 = (await api('POST', '/template/planillas-libro/copied', undefined, undefined, from('10.1.1.1'))).json;
  check('una copia completa suma uno, y avisar de nuevo sin habérsela llevado no suma', c1.counted === true && c2.counted === false && (await copiesOf('Planillas')) === 1, [c1, c2, await copiesOf('Planillas')]);
  const cold = (await api('POST', '/template/planillas-libro/copied', undefined, undefined, from('10.1.1.2'))).json;
  check('quien nunca se la llevó no suma', cold.counted === false && (await copiesOf('Planillas')) === 1, cold);
  for (let i = 0; i < 36; i++) { await api('GET', '/public/' + tok + '?all=1', undefined, undefined, from('10.1.1.3')); await api('POST', '/public/' + tok + '/copied', undefined, undefined, from('10.1.1.3')); }
  check('desde una misma red el contador de un enlace sube hasta su tope (30 por día) y no más', (await copiesOf('Planillas')) === 31, await copiesOf('Planillas'));
  const acct = []; await api('POST', '/links', { path: 'Nueva', kind: 'folder', template: true }, autora.s).then(async (r) => { for (let i = 0; i < 5; i++) { await api('GET', '/public/' + r.json.token + '?all=1', undefined, colega.s, from('10.1.1.' + (10 + i))); acct.push((await api('POST', '/public/' + r.json.token + '/copied', undefined, colega.s, from('10.1.1.' + (10 + i)))).json.counted); } await api('DELETE', '/links/' + r.json.id, undefined, autora.s); });
  check('y una misma cuenta suma hasta tres por día a un enlace, aunque cambie de red', J(acct) === J([true, true, true, false, false]), acct);
  check('el contador no anota de quién fue cada copia', J(Object.keys((await links(autora, 'Planillas'))[0]).sort()) === J(['copies', 'created', 'id', 'kind', 'login', 'name', 'path', 'protected', 'template']));
  await api('DELETE', '/links/' + linkId, undefined, autora.s);
  const again = await api('POST', '/links', { path: 'Planillas', kind: 'folder', template: true, name: 'planillas-libro' }, autora.s);
  const tok2 = again.json.token;
  check('quitado el enlace, quien lo creó le pone el mismo nombre al nuevo y el contador arranca de cero', again.status === 200 && again.json.name === 'planillas-libro' && (await copiesOf('Planillas')) === 0 && (await api('GET', '/public/' + tok)).status === 404 && (await api('GET', '/template/planillas-libro')).status === 200, again.json);

  console.log('Pedir una cuenta');
  const curso = (await api('POST', '/links', { path: 'Curso', kind: 'folder', template: true, login: true, name: 'curso-con-cuenta' }, autora.s)).json;
  const cRead = await api('GET', '/template/curso-con-cuenta'); const cNote = await api('GET', '/template/curso-con-cuenta?note=clase-1.md');
  const cAll = await api('GET', '/template/curso-con-cuenta?all=1'); const cAllIn = await api('GET', '/template/curso-con-cuenta?all=1', undefined, colega.s);
  check('una plantilla que pide cuenta se lee sin sesión y se entrega entera solo con sesión', curso.login === true && cRead.status === 200 && cRead.json.template.login === true && cNote.json.text === OTHER['Curso/clase-1.md'] && cAll.status === 401 && cAll.json.error === 'need_account' && cAllIn.status === 200 && cAllIn.json.notes.length === 2, [cAll.json, cAllIn.status]);
  check('y su contador también pide sesión', (await api('POST', '/template/curso-con-cuenta/copied')).json.error === 'need_account' && (await api('POST', '/template/curso-con-cuenta/copied', undefined, colega.s)).json.counted === true && (await copiesOf('Curso')) === 1);

  console.log('Retirar una plantilla y apuntar el nombre a otra carpeta');
  const vieja = (await api('POST', '/links', { path: 'Vieja', kind: 'folder', template: true, name: 'guia-vieja' }, autora.s)).json;
  await api('DELETE', '/links/' + vieja.id, undefined, autora.s);
  const gone = await api('GET', '/template/guia-vieja');
  check('una plantilla retirada responde 410, distinto de un nombre que nunca existió', gone.status === 410 && gone.json.error === 'template_gone', gone.json);
  check('el nombre retirado sigue siendo de su cuenta: otra no lo puede tomar', (await api('POST', '/links', { path: 'Suya', kind: 'folder', template: true, name: 'guia-vieja' }, colega.s)).json.error === 'name_taken');
  const nueva = (await api('POST', '/links', { path: 'Nueva', kind: 'folder', template: true, name: 'guia-vieja' }, autora.s)).json;
  const moved = (await api('GET', '/template/guia-vieja')).json;
  check('quien lo tiene lo apunta a otra carpeta suya', nueva.name === 'guia-vieja' && moved.name === 'Nueva' && J(moved.notes.map((n) => n.path)) === J(['b.md']), moved);
  const off = await setL(nueva.id, { template: false });
  check('dejar de ser plantilla suelta el nombre y la dirección corta dice que fue retirada', off.json.template === false && off.json.name === '' && (await api('GET', '/template/guia-vieja')).status === 410 && (await api('GET', '/public/' + nueva.token)).status === 200);
  await setL(nueva.id, { template: true, name: 'guia-vieja' });

  console.log('Renombrar la carpeta compartida');
  const mov = (await api('POST', '/links', { path: 'Mover', kind: 'folder', template: true }, autora.s)).json;
  await api('POST', '/rename', { from: 'Mover/uno.md', to: 'Movida/uno.md' }, autora.s);
  const mid = (await api('GET', '/public/' + mov.token));
  await api('POST', '/rename', { from: 'Mover/sub/dos.md', to: 'Movida/sub/dos.md' }, autora.s);
  const after = (await api('GET', '/public/' + mov.token)).json;
  check('al renombrar la carpeta nota por nota, el enlace la sigue', mid.status === 200 && after.name === 'Movida' && J(after.notes.map((n) => n.path).sort()) === J(['sub/dos.md', 'uno.md']), [mid.status, after]);
  const sola = (await api('POST', '/links', { path: 'Sola', kind: 'folder', template: true }, autora.s)).json;
  await api('POST', '/rename', { from: 'Sola/unica.md', to: 'Llena/unica.md' }, autora.s);
  const leak = await api('GET', '/public/' + sola.token);
  check('mover su única nota a una carpeta que ya tenía otras no deja a la vista esa carpeta', leak.status === 404 && !/SECRETO/.test(J(leak.json)), leak.json);
  // Vuelven a su lugar: al final se compara todo con lo que había.
  await api('POST', '/rename', { from: 'Llena/unica.md', to: 'Sola/unica.md' }, autora.s);
  await api('POST', '/rename', { from: 'Movida/uno.md', to: 'Mover/uno.md' }, autora.s); await api('POST', '/rename', { from: 'Movida/sub/dos.md', to: 'Mover/sub/dos.md' }, autora.s);

  // ---------- La app ----------
  // /t/<nombre> no existe como archivo: el alojamiento sirve 404.html con código 404, como GitHub Pages.
  const nf = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  const visitor = async (who, opt, lang) => {
    const v = await R.open(who, Object.assign({ acceptDownloads: true }, opt || {}));
    if (lang) await v.ctx.addInitScript(([url, l]) => { try { const s = JSON.parse(localStorage.getItem('mdtools:settings') || '{}'); if (s.language !== l) localStorage.setItem('mdtools:settings', JSON.stringify(Object.assign(s, { cloudUrl: url, language: l }))); } catch (e) { /* sin almacenamiento */ } }, [R.base, lang]);
    await v.ctx.route((url) => url.origin === R.origin && /^\/t\/[^/]+\/?$/.test(url.pathname) && !fs.existsSync(path.join(root, url.pathname)), (r) => r.fulfill({ status: 404, contentType: 'text/html', body: nf }));
    return v;
  };
  const T_URL = R.origin + '/t/planillas-libro';
  const bar = (page) => page.evaluate(() => { const b = document.querySelector('.lmd-tplbar'); return b && b.offsetParent ? { what: b.querySelector('strong').textContent, line: b.querySelector('span').textContent, button: b.querySelector('button').textContent } : null; });
  const state = (page) => page.evaluate(() => ({ f: new URLSearchParams(location.search).get('f') || '', title: document.title, h1: (document.querySelector('.lmd-article h1') || { textContent: '' }).textContent.trim(), editing: document.documentElement.classList.contains('lmd-editing'), pub: document.documentElement.classList.contains('lmd-public'), tpl: document.documentElement.classList.contains('lmd-tpl') }));
  const fork = (page) => page.evaluate(() => {
    const c = document.querySelector('.lmd-fork .lmd-fork-card'); if (!c) return null;
    return { title: c.querySelector('h3').textContent, lead: (c.querySelector('.lmd-fork-lead') || { textContent: '' }).textContent, ways: [...c.querySelectorAll('.lmd-fork-way')].map((b) => b.dataset.fk + (b.disabled ? '-' : '') + ':' + b.querySelector('b').textContent + '|' + b.querySelector('small').textContent),
      need: (c.querySelector('.lmd-fork-need') || { textContent: '' }).textContent, err: (c.querySelector('.lmd-img-err:not([hidden])') || { textContent: '' }).textContent, all: c.textContent };
  });
  const use = async (page) => { await page.click('.lmd-tplbar [data-act=tpl-use]'); await page.waitForSelector('.lmd-fork .lmd-fork-way'); };
  const local = (page) => page.evaluate(async () => (await LMD.store.notesAll()).map((n) => n.name).sort());
  const localText = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text, name);
  const sentBar = async (page) => { await page.waitForSelector('.lmd-sent', { timeout: 10000 }); return page.evaluate(() => document.querySelector('.lmd-sent span').textContent); };
  const closeSent = (page) => page.evaluate(() => document.querySelectorAll('.lmd-sent').forEach((b) => b.remove()));
  const tree = (page, sec) => page.evaluate((s) => [...document.querySelectorAll('.lmd-xroot[data-root=' + s + '] .lmd-node .lmd-node-name')].map((n) => n.textContent), sec);
  const cloudOf = async (who) => ((await api('GET', '/notes', undefined, who.s)).json || []).map((n) => n.path).sort();
  const textOf = async (who, p) => ((await api('GET', '/notes/' + encodeURIComponent(p), undefined, who.s)).json || {}).text;

  console.log('Abrir la plantilla sin sesión');
  const a = await visitor();
  await a.page.goto(T_URL); await a.page.waitForSelector('.lmd-tplbar'); await a.page.waitForSelector('.lmd-fp[data-done]');
  const s0 = await state(a.page); const b0 = await bar(a.page);
  check('sharpmd.app/t/<nombre> abre la plantilla en la página de su carpeta (su README arriba y el índice de sus notas), de solo lectura', s0.f === 't/planillas-libro/' && s0.h1 === 'Planillas' && (await a.page.evaluate(() => /Empezá por la primera semana/.test(document.querySelector('.lmd-fp-md').textContent) && document.querySelectorAll('.lmd-fp-row').length === 4)) && s0.pub && s0.tpl && !s0.editing && (await a.page.evaluate(() => getComputedStyle(document.querySelector('.lmd-modeseg')).display === 'none')), s0);
  check('arriba dice qué es y qué pasa, con el botón principal', J(b0) === J({ what: 'Template · read only', line: 'You get a copy to edit. The original does not change.', button: 'Use this template' }), b0);
  const t0 = await until(async () => { const t = await tree(a.page, 'pub'); return t.length >= 4 ? t : null; });
  check('el explorador muestra la carpeta con sus notas y su subcarpeta', !!t0 && J(t0.slice().sort()) === J(['README.md', 'extra', 'semana-1.md', 'semana-2.md']) && (await a.page.evaluate(() => document.querySelector('.lmd-xroot[data-root=pub] .lmd-tree-path').textContent)) === 'Planillas', t0);
  await shot(a.page, '01-plantilla-abierta');
  await a.page.click('.lmd-article a[href*="semana-1"]');
  check('los enlaces entre sus notas andan', !!(await until(async () => { const s = await state(a.page); return s.f === 't/planillas-libro/semana-1.md' && s.h1 === 'Semana 1' && s.tpl; })), await state(a.page));
  await a.page.click('.lmd-xroot[data-root=pub] .lmd-node-dir'); await a.page.click('.lmd-xroot[data-root=pub] .lmd-node:has(.lmd-node-name:text-is("metas.md"))');
  check('y las de una subcarpeta también', !!(await until(async () => { const s = await state(a.page); return s.f === 't/planillas-libro/extra/metas.md' && s.h1 === 'Metas'; })), await state(a.page));
  await a.page.goto(T_URL); await a.page.waitForSelector('.lmd-tplbar'); await a.page.waitForSelector('.lmd-fp[data-done]');

  console.log('Querer editar el original');
  await a.page.dblclick('.lmd-article p'); await a.page.waitForSelector('.lmd-fork .lmd-fork-way');
  const f1 = await fork(a.page);
  check('doble clic: no se edita, y se ofrece ahí mismo usar la plantilla', f1.title === 'Use this template' && f1.lead === 'The original cannot be edited. Take a copy and edit that one.' && !(await state(a.page)).editing, f1);
  check('las tres salidas: a este navegador, a mi nube y descargar', J(f1.ways) === J(['browser:Copy to this browser|No account. It is saved on this device.', 'cloud:Copy to my cloud|We ask for your email and send you a code.', 'zip:Download|A ZIP with the notes in Markdown.']) && noShout(f1.all), f1.ways);
  await shot(a.page, '02-usar-esta-plantilla');
  await a.page.keyboard.press('Escape'); await a.page.waitForSelector('.lmd-fork', { state: 'detached' });
  await a.page.keyboard.press('x');
  check('una tecla: lo mismo', !!(await until(() => fork(a.page))) && !(await state(a.page)).editing);
  await a.page.keyboard.press('Escape'); await a.page.waitForSelector('.lmd-fork', { state: 'detached' });
  await a.page.click('.lmd-article input.lmd-task');
  check('tildar una tarea: no se tilda, y se ofrece lo mismo', !!(await until(() => fork(a.page))) && !(await a.page.evaluate(() => document.querySelector('.lmd-article input.lmd-task').checked)));
  await a.page.keyboard.press('Escape'); await a.page.waitForSelector('.lmd-fork', { state: 'detached' });

  console.log('Copiar a este navegador');
  const n0 = await copiesOf('Planillas');
  await use(a.page);
  check('desde el botón, la ventana dice qué pasa en una línea', (await fork(a.page)).lead === 'You get a copy to edit. The original does not change.');
  await a.page.click('.lmd-fork [data-fk=browser]');
  const s1 = await until(async () => { const s = await state(a.page); return s.f === 'local/Planillas/README.md' && s.editing ? s : null; });
  check('queda toda la carpeta en "En este navegador" y se abre la primera nota ya editable', !!s1 && s1.h1 === 'Planillas' && !s1.pub && !s1.tpl && J(await local(a.page)) === J(Object.keys(TPL).sort()), [await state(a.page), await local(a.page)]);
  check('con el mismo texto, nota por nota', (await Promise.all(Object.keys(TPL).map(async (p) => (await localText(a.page, p)) === TPL[p]))).every(Boolean));
  const said1 = await sentBar(a.page);
  check('el aviso dice dónde quedó y que el original no cambia', said1 === 'The copy is in this browser, in "Planillas". The original does not change.' && !(await bar(a.page)), said1);
  const lt = await until(async () => { const t = await tree(a.page, 'local'); return t.includes('Planillas') && t.includes('README.md') ? t : null; });
  check('el explorador la muestra como una carpeta, con su subcarpeta', !!lt && lt.includes('extra') && lt.includes('semana-1.md'), await tree(a.page, 'local'));
  await shot(a.page, '03-copia-en-el-navegador');
  await closeSent(a.page);
  await a.page.locator('.lmd-article .lmd-editable', { hasText: 'Empezá por' }).first().click(); await a.page.keyboard.press('Control+End'); await a.page.keyboard.type(' MIA', { delay: 15 }); await leave(a.page);
  check('lo que se escribe queda en la copia', !!(await until(async () => /MIA/.test(await localText(a.page, 'Planillas/README.md')))), await localText(a.page, 'Planillas/README.md'));
  check('y el original sigue igual', (await textOf(autora, 'Planillas/README.md')) === TPL['Planillas/README.md']);
  check('la copia completa sumó una al contador (abrir la que ya estaba no suma; hacer otra, sí)', (await until(async () => (await copiesOf('Planillas')) === n0 + 1)) === true, await copiesOf('Planillas'));
  await a.page.goto(R.home + '?f=' + encodeURIComponent('local/Planillas/extra/metas.md')); await a.page.waitForSelector('.lmd-article h1');
  check('una nota de la subcarpeta de la copia se abre por su dirección', (await state(a.page)).h1 === 'Metas');
  await a.page.click('[data-act=mode-read]'); await a.page.waitForFunction(() => !document.documentElement.classList.contains('lmd-editing')); // en edición un clic sobre un enlace lo edita
  await a.page.click('.lmd-article a[href*="README"]');
  check('y sus enlaces a otras notas de la copia andan', !!(await until(async () => { const s = await state(a.page); return s.f === 'local/Planillas/README.md' && s.h1 === 'Planillas'; })), await state(a.page));

  console.log('Segunda copia al navegador');
  await a.page.goto(T_URL); await a.page.waitForSelector('.lmd-tplbar'); await a.page.waitForSelector('.lmd-fp[data-done]');
  await use(a.page); await a.page.click('.lmd-fork [data-fk=browser]'); await a.page.waitForSelector('.lmd-send-again');
  const ag = await a.page.evaluate(() => { const c = document.querySelector('.lmd-send-again'); return { title: c.querySelector('h3').textContent, text: c.querySelector('p').textContent, buttons: [...c.querySelectorAll('button')].map((b) => b.textContent) }; });
  check('ya hay una carpeta con ese nombre: se ofrece abrir esa o hacer otra', ag.title === 'You already have a folder "Planillas" in this browser' && J(ag.buttons) === J(['Cancel', 'Make another copy', 'Open the one I have']) && noShout(ag.text), ag);
  await a.page.click('.lmd-send-again [data-sa=open]');
  check('"Abrir la que ya tengo" abre la copia de antes, con lo escrito', !!(await until(async () => { const s = await state(a.page); return s.f === 'local/Planillas/README.md' && s.editing; })) && /MIA/.test(await a.page.evaluate(() => document.querySelector('.lmd-article').textContent)) && (await local(a.page)).length === 4);
  await a.page.goto(T_URL); await a.page.waitForSelector('.lmd-tplbar'); await a.page.waitForSelector('.lmd-fp[data-done]');
  await use(a.page); await a.page.click('.lmd-fork [data-fk=browser]'); await a.page.waitForSelector('.lmd-send-again'); await a.page.click('.lmd-send-again [data-sa=new]');
  check('"Hacer otra copia" la deja con otro nombre, sin tocar la primera', !!(await until(async () => (await state(a.page)).f === 'local/Planillas-2/README.md')) && (await local(a.page)).length === 8 && /MIA/.test(await localText(a.page, 'Planillas/README.md')) && (await localText(a.page, 'Planillas-2/README.md')) === TPL['Planillas/README.md'], await local(a.page));
  await closeSent(a.page);
  // La carpeta de la copia se elimina entera desde el explorador.
  await a.page.locator('.lmd-xroot[data-root=local] .lmd-node-dir', { hasText: 'Planillas-2' }).first().click({ button: 'right' }); await a.page.waitForSelector('.lmd-menu');
  await a.page.click('.lmd-menu [data-f=del]'); await a.page.waitForSelector('.lmd-ask [data-dlg=ok]'); await a.page.click('.lmd-ask [data-dlg=ok]');
  check('la carpeta de una copia se elimina desde el explorador, con sus notas', !!(await until(async () => (await local(a.page)).length === 4)) && (await local(a.page)).every((n) => n.startsWith('Planillas/')), await local(a.page));

  console.log('Descargar');
  await a.page.goto(T_URL); await a.page.waitForSelector('.lmd-tplbar'); await a.page.waitForSelector('.lmd-fp[data-done]');
  await use(a.page);
  const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('.lmd-fork [data-fk=zip]')]);
  const zipPath = path.join(SHOTS, 'descarga.zip'); await dl.saveAs(zipPath);
  const zip = unzip(fs.readFileSync(zipPath));
  check('el ZIP se llama como la carpeta y trae los .md con sus subcarpetas', dl.suggestedFilename() === 'Planillas.zip' && J(Object.keys(zip).sort()) === J(Object.keys(TPL).sort()), [dl.suggestedFilename(), Object.keys(zip)]);
  check('cada nota del ZIP tiene el texto del original', Object.keys(TPL).every((p) => zip[p] === TPL[p]));
  check('descargar también cuenta como una copia', (await until(async () => (await copiesOf('Planillas')) === n0 + 3)) === true && /Planillas\.zip/.test(await sentBar(a.page)), await copiesOf('Planillas'));
  await a.ctx.close();

  console.log('Copiar a mi nube, sin sesión: el correo, el código y la copia sigue sola');
  const b = await visitor();
  await b.page.goto(T_URL); await b.page.waitForSelector('.lmd-tplbar'); await b.page.waitForSelector('.lmd-fp[data-done]');
  await use(b.page); await b.page.click('.lmd-fork [data-fk=cloud]'); await b.page.waitForSelector('.lmd-fork-login [data-field=email]');
  const lg = await b.page.evaluate(() => { const c = document.querySelector('.lmd-fork-login'); return { title: c.querySelector('h3').textContent, sub: c.querySelector('.lmd-login-sub').textContent, next: c.querySelector('.lmd-fork-next').textContent }; });
  check('pide el correo ahí mismo y dice que manda un código', lg.title === 'Sign in to use the template' && /we send you a code/.test(lg.sub) && lg.next === 'Once you sign in, the copy continues on its own.' && noShout(J(lg)), lg);
  await shot(b.page, '04-entrar-para-copiar');
  await b.page.fill('.lmd-fork-login [data-field=email]', 'lectora@example.test');
  const [started] = await Promise.all([b.page.waitForResponse((r) => r.url().endsWith('/auth/start')), b.page.click('.lmd-fork-login [data-cloud=start]')]);
  const code = (await started.json()).dev_code; // el servidor de prueba devuelve el código en vez de mandar el correo
  await b.page.waitForSelector('.lmd-fork-login [data-field=code]'); await b.page.fill('.lmd-fork-login [data-field=code]', code); await b.page.click('.lmd-fork-login [data-cloud=verify]');
  const s2 = await until(async () => { const s = await state(b.page); return s.f === 'cloud/Planillas/README.md' && s.editing ? s : null; }, 15000);
  const lectora = { s: await b.page.evaluate(() => JSON.parse(localStorage.getItem('mdtools:cloud') || '{}').session) };
  check('con el código la cuenta queda creada y la copia sigue sola, sin repetir nada', !!s2 && s2.h1 === 'Planillas' && !s2.pub && J(await cloudOf(lectora)) === J(Object.keys(TPL).sort()), [await state(b.page), await cloudOf(lectora)]);
  check('la copia de la nube tiene el texto del original', (await Promise.all(Object.keys(TPL).map(async (p) => (await textOf(lectora, p)) === TPL[p]))).every(Boolean));
  const said2 = await sentBar(b.page);
  check('el aviso dice cuántas notas, dónde y que el original no cambia', said2 === '4 notes were copied to your cloud, in "Planillas". The original does not change.', said2);
  check('la cuenta quedó abierta en la app', (await b.page.evaluate(() => LMD.cloud.signedIn() && LMD.cloud.email())) === 'lectora@example.test');
  check('sumó una al contador', (await until(async () => (await copiesOf('Planillas')) === n0 + 4)) === true, await copiesOf('Planillas'));
  await shot(b.page, '05-copia-en-la-nube');
  await closeSent(b.page);
  await b.page.locator('.lmd-article .lmd-editable', { hasText: 'Empezá por' }).first().click(); await b.page.keyboard.press('Control+End'); await b.page.keyboard.type(' NUBE', { delay: 15 }); await leave(b.page);
  await b.page.keyboard.press('Control+s');
  check('lo que se escribe queda en la copia de esa cuenta', !!(await until(async () => /NUBE/.test(await textOf(lectora, 'Planillas/README.md')), 12000)), await textOf(lectora, 'Planillas/README.md'));
  check('el original no cambia, y quien la compartió no ve la copia', (await textOf(autora, 'Planillas/README.md')) === TPL['Planillas/README.md'] && (await cloudOf(autora)).length === Object.keys(before).length);

  console.log('Segunda copia a la nube, y el plan gratis sin lugar');
  await b.page.goto(T_URL); await b.page.waitForSelector('.lmd-tplbar'); await b.page.waitForSelector('.lmd-fp[data-done]');
  await use(b.page);
  check('con sesión, la salida de la nube nombra la cuenta', (await fork(b.page)).ways[1] === 'cloud:Copy to my cloud|In your account, lectora@example.test.', (await fork(b.page)).ways);
  await b.page.click('.lmd-fork [data-fk=cloud]'); await b.page.waitForSelector('.lmd-send-again');
  check('si ya copió esta plantilla, se ofrece abrir la copia o hacer otra', (await b.page.textContent('.lmd-send-again h3')) === 'You already have a folder "Planillas" in your cloud');
  await b.page.click('.lmd-send-again [data-sa=open]');
  check('"Abrir la que ya tengo" abre su copia, con lo que escribió', !!(await until(async () => { const s = await state(b.page); return s.f === 'cloud/Planillas/README.md'; })) && !!(await until(() => b.page.evaluate(() => /NUBE/.test(document.querySelector('.lmd-article').textContent)))) && (await cloudOf(lectora)).length === 4);
  await b.page.goto(T_URL); await b.page.waitForSelector('.lmd-tplbar'); await b.page.waitForSelector('.lmd-fp[data-done]');
  await use(b.page); await b.page.click('.lmd-fork [data-fk=cloud]'); await b.page.waitForSelector('.lmd-send-again'); await b.page.click('.lmd-send-again [data-sa=new]');
  await b.page.waitForSelector('.lmd-send-card .lmd-send-warn');
  const full = await b.page.evaluate(() => { const c = document.querySelector('.lmd-send:not(.lmd-send-again) .lmd-send-card'); const t = (s) => (c.querySelector(s) || { textContent: '' }).textContent; return { title: t('h3'), dest: t('.lmd-send-dest'), sum: t('.lmd-send-sum'), warn: t('.lmd-send-warn'), alt: t('.lmd-send-alt'), buttons: [...c.querySelectorAll('.lmd-ask-actions button')].map((x) => x.textContent), picks: c.querySelectorAll('[data-pick]').length }; });
  check('otra copia no entra en el plan gratis: se dice antes de empezar cuántos lugares faltan, con el número de la cuenta', full.title === 'Copy "Planillas" to your cloud' && full.dest === 'Cloud / Planillas-2' && new RegExp('Free plan: 2 of ' + FREE + ' places left').test(full.sum) && full.warn === 'It does not fit in the free plan: 2 more places are needed. The paid plan has no limit.' && !full.picks, full);
  check('y se ofrece copiar al navegador o descargar, sin copiar a medias', full.alt === 'You can also copy it to this browser or download it.' && J(full.buttons) === J(['Cancel', 'See plans', 'Download', 'Copy to this browser']), full.buttons);
  await shot(b.page, '06-no-entra-en-el-plan');
  await b.page.click('.lmd-send-card [data-sd=tpl-browser]');
  check('"Copiar a este navegador" desde ahí deja la copia en el navegador, y la nube queda como estaba', !!(await until(async () => (await state(b.page)).f === 'local/Planillas/README.md')) && (await local(b.page)).length === 4 && (await cloudOf(lectora)).length === 4, [await state(b.page), await cloudOf(lectora)]);
  await b.ctx.close();

  console.log('Con sesión: copia directo');
  const tercero = await R.signup('tercero@example.test');
  const c = await visitor(tercero);
  await c.page.goto(R.home + '?f=' + encodeURIComponent('pub/' + tok2)); await c.page.waitForSelector('.lmd-tplbar'); await c.page.waitForSelector('.lmd-fp[data-done]');
  check('el enlace con el secreto abre la misma plantilla', (await state(c.page)).f === 'pub/' + tok2 + '/' && (await state(c.page)).tpl, await state(c.page));
  await use(c.page); await c.page.click('.lmd-fork [data-fk=cloud]');
  const s3 = await until(async () => { const s = await state(c.page); return s.f === 'cloud/Planillas/README.md' && s.editing ? s : null; }, 15000);
  check('con sesión y lugar, copia sin preguntar nada', !!s3 && J(await cloudOf(tercero)) === J(Object.keys(TPL).sort()) && !(await c.page.$('.lmd-send')), [await state(c.page), await cloudOf(tercero)]);
  check('sumó una al contador', (await until(async () => (await copiesOf('Planillas')) === n0 + 6)) === true, await copiesOf('Planillas'));
  await c.ctx.close();

  console.log('Plantilla que pide una cuenta');
  const d = await visitor();
  await d.page.goto(R.origin + '/t/curso-con-cuenta'); await d.page.waitForSelector('.lmd-tplbar'); await d.page.waitForSelector('.lmd-fp[data-done]');
  check('se lee sin sesión', (await state(d.page)).h1 === 'Curso' && (await d.page.evaluate(() => [...document.querySelectorAll('.lmd-fp-rname')].map((n) => n.textContent).join())) === 'clase-1,clase-2' && (await state(d.page)).tpl, await state(d.page));
  await use(d.page);
  const f2 = await fork(d.page);
  check('sin sesión no se copia al navegador ni se descarga, y se dice por qué', J(f2.ways.map((w) => w.split('|')[0])) === J(['browser-:Copy to this browser', 'cloud:Copy to my cloud', 'zip-:Download']) && f2.need.startsWith('This template asks for an account to copy or download it.') && noShout(f2.all), f2);
  await shot(d.page, '07-pide-una-cuenta');
  await d.page.click('.lmd-fork [data-fk=browser]', { force: true }); await sleep(400);
  check('el botón apagado no copia nada', !(await local(d.page)).length && (await state(d.page)).f.startsWith('t/curso-con-cuenta/'));
  await d.page.click('.lmd-fork [data-fk=signin]'); await d.page.waitForSelector('.lmd-fork-login [data-field=email]');
  await d.page.fill('.lmd-fork-login [data-field=email]', 'alumna@example.test');
  const [st2] = await Promise.all([d.page.waitForResponse((r) => r.url().endsWith('/auth/start')), d.page.click('.lmd-fork-login [data-cloud=start]')]);
  await d.page.waitForSelector('.lmd-fork-login [data-field=code]'); await d.page.fill('.lmd-fork-login [data-field=code]', (await st2.json()).dev_code); await d.page.click('.lmd-fork-login [data-cloud=verify]');
  await d.page.waitForSelector('.lmd-fork:not(.lmd-fork-login) .lmd-fork-way');
  const f3 = await fork(d.page);
  check('al entrar, las tres salidas quedan disponibles', J(f3.ways.map((w) => w.split(':')[0])) === J(['browser', 'cloud', 'zip']) && !f3.need, f3.ways);
  await d.page.click('.lmd-fork [data-fk=browser]');
  check('y la copia al navegador anda', !!(await until(async () => (await state(d.page)).f === 'local/Curso/clase-1.md')) && J(await local(d.page)) === J(['Curso/clase-1.md', 'Curso/clase-2.md']), await local(d.page));
  await d.ctx.close();

  console.log('La dirección corta: escrita a mano, que no existe y retirada');
  const e = await visitor();
  for (const [name, addr] of [['con mayúsculas y barra al final', '/t/Planillas-Libro/'], ['con .html', '/t/planillas-libro.html'], ['por la página que existe de verdad, sin depender del 404', '/t/?planillas-libro']]) {
    await e.page.goto(R.origin + addr); await e.page.waitForSelector('.lmd-tplbar'); await e.page.waitForSelector('.lmd-fp[data-done]');
    check('la dirección ' + name + ' abre la plantilla', (await state(e.page)).f === 't/planillas-libro/', await state(e.page));
  }
  const lead = (page) => page.evaluate(() => { const l = document.querySelector('.lmd-home-lead:not([hidden])'); return l && l.offsetParent ? { title: l.querySelector('h2').textContent, text: l.querySelector('p').textContent } : null; });
  await e.page.goto(R.origin + '/t/no-existe'); await e.page.waitForSelector('.lmd-home-lead:not([hidden])');
  const l1 = await lead(e.page);
  check('un nombre que no existe: una página clara, que nombra la dirección', l1.title === 'We could not find that template' && l1.text === 'There is no template at sharpmd.app/t/no-existe. Check that the address is typed correctly.' && !(await bar(e.page)) && noShout(J(l1)), l1);
  await shot(e.page, '08-no-existe');
  await api('DELETE', '/links/' + nueva.id, undefined, autora.s);
  await e.page.goto(R.origin + '/t/guia-vieja'); await e.page.waitForSelector('.lmd-home-lead:not([hidden])');
  const l2 = await lead(e.page);
  check('una plantilla retirada: lo dice, distinto de una que no existe', l2.title === 'This template is no longer available' && l2.text === 'Whoever shared it withdrew it.' && noShout(J(l2)), l2);
  await shot(e.page, '09-retirada');
  await e.page.goto(R.origin + '/t/'); await e.page.waitForSelector('h1');
  check('sin nombre, /t/ dice qué es una plantilla', /Templates/.test(await e.page.textContent('h1')) && new URL(e.page.url()).pathname === '/t/');
  await e.ctx.close();

  console.log('En español');
  const g = await visitor(null, null, 'es');
  await g.page.goto(T_URL); await g.page.waitForSelector('.lmd-tplbar'); await g.page.waitForSelector('.lmd-fp[data-done]');
  const bEs = await bar(g.page);
  check('la tira, en español', J(bEs) === J({ what: 'Plantilla · solo lectura', line: 'Te queda una copia para editar. El original no cambia.', button: 'Usar esta plantilla' }), bEs);
  await g.page.dblclick('.lmd-article p'); await g.page.waitForSelector('.lmd-fork .lmd-fork-way');
  const fEs = await fork(g.page);
  check('la ventana, en español y con voseo', fEs.title === 'Usar esta plantilla' && fEs.lead === 'El original no se edita. Llevate una copia y editala.' && J(fEs.ways) === J(['browser:Copiar a este navegador|Sin cuenta. Queda guardada en este dispositivo.', 'cloud:Copiar a mi nube|Te pedimos el correo y te mandamos un código.', 'zip:Descargar|Un ZIP con las notas en Markdown.']) && noShout(fEs.all), fEs);
  await g.page.click('.lmd-fork [data-fk=cloud]'); await g.page.waitForSelector('.lmd-fork-login [data-field=email]');
  check('entrar, en español', (await g.page.textContent('.lmd-fork-login h3')) === 'Entrar para usar la plantilla' && /te mandamos un código/.test(await g.page.textContent('.lmd-fork-login .lmd-login-sub')) && (await g.page.textContent('.lmd-fork-login .lmd-fork-next')) === 'Al entrar, la copia sigue sola.');
  await g.page.click('.lmd-fork-login [data-fk=back]'); await g.page.waitForSelector('.lmd-fork:not(.lmd-fork-login) .lmd-fork-way');
  await g.page.click('.lmd-fork [data-fk=browser]');
  check('la copia al navegador, con su aviso en español', !!(await until(async () => (await state(g.page)).f === 'local/Planillas/README.md')) && (await sentBar(g.page)) === 'La copia quedó en este navegador, en "Planillas". El original no cambia.');
  await g.page.goto(R.origin + '/t/no-existe'); await g.page.waitForSelector('.lmd-home-lead:not([hidden])');
  check('y la página de un nombre que no existe', J(await lead(g.page)) === J({ title: 'No encontramos esa plantilla', text: 'No hay ninguna plantilla en sharpmd.app/t/no-existe. Revisá que la dirección esté bien escrita.' }), await lead(g.page));
  await g.ctx.close();

  console.log('En el teléfono (390 px)');
  const m = await visitor(null, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.page.goto(T_URL); await m.page.waitForSelector('.lmd-tplbar'); await m.page.waitForSelector('.lmd-fp[data-done]');
  const geo = await m.page.evaluate(() => { const b = document.querySelector('.lmd-tplbar'); const r = b.getBoundingClientRect(); const k = b.querySelector('button').getBoundingClientRect(); return { wide: document.documentElement.scrollWidth, left: r.left, right: r.right, btn: k.height, btnRight: k.right, top: r.top }; });
  check('la tira entra en la pantalla, con el botón cómodo para el dedo', geo.wide <= 390 && geo.left >= 0 && geo.right <= 390 && geo.btnRight <= 390 && geo.btn >= 44, geo);
  await shot(m.page, '10-telefono-plantilla');
  await m.page.tap('.lmd-tplbar [data-act=tpl-use]'); await m.page.waitForSelector('.lmd-fork .lmd-fork-way');
  const dgeo = await m.page.evaluate(() => { const c = document.querySelector('.lmd-fork-card').getBoundingClientRect(); return { left: c.left, right: c.right, bottom: c.bottom, ways: [...document.querySelectorAll('.lmd-fork-way')].map((b) => Math.round(b.getBoundingClientRect().height)), wide: document.documentElement.scrollWidth }; });
  check('la ventana entra entera y cada salida mide al menos 44 px', dgeo.left >= 0 && dgeo.right <= 390 && dgeo.bottom <= 844 && dgeo.ways.every((h) => h >= 44) && dgeo.wide <= 390, dgeo);
  await shot(m.page, '11-telefono-salidas');
  await m.page.tap('.lmd-fork [data-fk=browser]');
  check('copiar al navegador anda en el teléfono y abre la nota editable', !!(await until(async () => { const s = await state(m.page); return s.f === 'local/Planillas/README.md' && s.editing; })) && (await local(m.page)).length === 4, await state(m.page));
  await m.ctx.close();

  console.log('Quien comparte: la ventana de la carpeta');
  const o = await visitor(autora);
  await o.page.goto(R.noteUrl('Curso/clase-1.md')); await o.page.waitForSelector('.lmd-article h1');
  const folderRow = (name) => o.page.locator('.lmd-xroot[data-root=cloud] .lmd-node-dir').filter({ has: o.page.locator('.lmd-node-name', { hasText: new RegExp('^' + name + '$') }) }).first();
  const openShare = async (name) => { await folderRow(name).click({ button: 'right' }); await o.page.waitForSelector('.lmd-menu [data-f=flink]'); await o.page.click('.lmd-menu [data-f=flink]'); await o.page.waitForSelector('.lmd-share-folder'); };
  await o.page.waitForSelector('.lmd-xroot[data-root=cloud] .lmd-node-dir');
  await openShare('Planillas');
  // Con un servidor propio (el de la prueba lo es) no hay quién resuelva sharpmd.app/t/<nombre>: no se ofrece.
  check('con un servidor propio la ventana no ofrece la dirección corta', !(await o.page.$('.lmd-share-folder [data-sf=name]')) && !!(await o.page.$('.lmd-share-folder [data-sf=tpl]')));
  await o.page.click('.lmd-share-folder [data-sf=close]');
  await o.page.evaluate((b) => { LMD.CLOUD_URL = b; }, R.base); // de acá en más, como en sharpmd.app: el servidor de la app es el de la casa
  await openShare('Planillas');
  const sh = await until(() => o.page.evaluate(() => { const c = document.querySelector('.lmd-share-folder'); const li = c.querySelector('[data-sf=links] li'); return li ? { title: c.querySelector('h3').textContent, tpl: c.querySelector('[data-sf=tpl]').checked, login: c.querySelector('[data-sf=login]').checked, name: c.querySelector('[data-sf=name]').value, url: (li.querySelector('input') || {}).value, meta: li.querySelector('.lmd-share-meta').textContent, save: c.querySelector('[data-sf=save]').textContent, labels: [...c.querySelectorAll('.lmd-check > span')].map((s) => s.firstChild.textContent), all: c.textContent } : null; }));
  const total = await copiesOf('Planillas');
  check('la ventana muestra las dos opciones, la dirección corta y cuántas copias se hicieron', !!sh && sh.title === 'Share the folder "Planillas"' && sh.tpl && !sh.login && sh.name === 'planillas-libro' && sh.url === 'https://sharpmd.app/t/planillas-libro' && sh.meta === 'Template · ' + total + ' copies made' && total === n0 + 8 && J(sh.labels) === J(['It is a template', 'Ask for an account to use it']) && sh.save === 'Save' && noShout(sh.all), sh);
  await shot(o.page, '12-compartir-la-carpeta');
  await o.page.click('.lmd-share-folder [data-sf=close]');
  await api('DELETE', '/links/' + sola.id, undefined, autora.s);
  await openShare('Sola'); await o.page.waitForSelector('.lmd-share-folder [data-sf=save]:not([disabled])');
  const fresh = await o.page.evaluate(() => { const c = document.querySelector('.lmd-share-folder'); return { tpl: c.querySelector('[data-sf=tpl]').checked, login: c.querySelector('[data-sf=login]').checked, loginOff: c.querySelector('[data-sf=login]').disabled, nameOff: c.querySelector('[data-sf=name]').disabled, save: c.querySelector('[data-sf=save]').textContent }; });
  check('en una carpeta sin enlace, las dos opciones vienen apagadas y "Pedir una cuenta" depende de "Es una plantilla"', !fresh.tpl && !fresh.login && fresh.loginOff && fresh.nameOff && fresh.save === 'Create link', fresh);
  await o.page.check('.lmd-share-folder [data-sf=tpl]'); await o.page.check('.lmd-share-folder [data-sf=login]');
  await o.page.fill('.lmd-share-folder [data-sf=name]', ''); await o.page.type('.lmd-share-folder [data-sf=name]', 'Mi Planilla Única');
  check('el nombre se acomoda mientras se escribe: minúsculas, sin acentos, con guiones', (await o.page.inputValue('.lmd-share-folder [data-sf=name]')) === 'mi-planilla-unica');
  await o.page.fill('.lmd-share-folder [data-sf=name]', 'plantillas'); await o.page.click('.lmd-share-folder [data-sf=save]'); await o.page.waitForSelector('.lmd-share-folder .lmd-img-err:not([hidden])');
  check('un nombre reservado se dice en la ventana', (await o.page.textContent('.lmd-share-folder .lmd-img-err')) === 'That name is reserved. Choose another.');
  await o.page.fill('.lmd-share-folder [data-sf=name]', 'mi-planilla-unica'); await o.page.click('.lmd-share-folder [data-sf=save]');
  const made = await until(() => o.page.evaluate(() => { const li = document.querySelector('.lmd-share-folder [data-sf=links] li'); return li && li.querySelector('input') ? { url: li.querySelector('input').value, meta: li.querySelector('.lmd-share-meta').textContent } : null; }));
  const srv = (await links(autora, 'Sola'))[0];
  check('crea el enlace con las opciones elegidas y muestra su dirección', !!made && made.url === 'https://sharpmd.app/t/mi-planilla-unica' && made.meta === 'Template · 0 copies made' && srv.template && srv.login && srv.name === 'mi-planilla-unica', [made, srv]);
  await o.page.click('.lmd-share-folder [data-sf=close]');
  await openShare('cofre');
  check('una carpeta protegida: la ventana dice que no se puede, y no ofrece nada más', (await o.page.textContent('.lmd-share-folder .lmd-share-vault')) === 'A folder protected with a password cannot be shared with a link or used as a template.' && !(await o.page.$('.lmd-share-folder [data-sf=tpl]')));
  await o.page.click('.lmd-share-folder [data-sf=close]');
  // Desde la ventana de compartir una nota se llega a la de su carpeta.
  await o.page.click('.lmd-sync'); await o.page.waitForSelector('.lmd-menu [data-s=share]'); await o.page.click('.lmd-menu [data-s=share]'); await o.page.waitForSelector('.lmd-share [data-sh=folderlink]');
  check('compartir una nota ofrece compartir su carpeta', (await o.page.textContent('.lmd-share [data-sh=folderlink]')) === 'Share the whole folder "Curso" with a link or as a template…');
  await o.page.click('.lmd-share [data-sh=folderlink]'); await o.page.waitForSelector('.lmd-share-folder');
  check('y abre la ventana de la carpeta, con lo que ya tenía', (await o.page.textContent('.lmd-share-folder h3')) === 'Share the folder "Curso"' && !!(await until(() => o.page.evaluate(() => document.querySelector('.lmd-share-folder [data-sf=login]').checked && document.querySelector('.lmd-share-folder [data-sf=name]').value === 'curso-con-cuenta'))));
  await o.ctx.close();

  console.log('El original, al final');
  const afterAll = await notesOf(autora);
  const same = Object.keys(before).filter((p) => !/^(Mover|Sola|cofre)\//.test(p)); // las que la prueba movió y devolvió a su lugar, y la que quedó en la carpeta protegida
  check('las notas de quien compartió son las mismas, con el mismo texto y sin un solo guardado nuevo', J(Object.keys(afterAll).sort()) === J(Object.keys(before).sort()) && same.every((p) => afterAll[p] && afterAll[p][0] === before[p][0] && afterAll[p][1] === before[p][1]), same.filter((p) => !afterAll[p] || afterAll[p][0] !== before[p][0] || afterAll[p][1] !== before[p][1]));
  check('nada apuntó a la nube de verdad', !R.outside.length, R.outside.slice(0, 3));
  check('sin errores de JavaScript', !R.errors.length, R.errors.slice(0, 3));
  bad = done();
} catch (e) {
  console.log('\nLa prueba se cortó: ' + (e && e.stack || e));
  done();
} finally {
  await R.close();
}
process.exit(bad ? 1 : 0);
