'use strict';
// "Mostrar en el Explorador": la regla de reveal.js y su ruta en la API. El explorador no se abre nunca: en su lugar
// va una función que anota qué archivo se habría mostrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('../src/server');
const reveal = require('../src/reveal');
const config = require('../src/config');

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
// Una carpeta permitida con una nota adentro, y otra afuera.
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reveal-test-')));
const allowed = path.join(base, 'notes'); const other = path.join(base, 'private');
fs.mkdirSync(path.join(allowed, 'sub dir'), { recursive: true }); fs.mkdirSync(other);
const note = path.join(allowed, 'sub dir', 'plan, v2.md'); const secret = path.join(other, 'secret.md');
fs.writeFileSync(note, '# plan\n'); fs.writeFileSync(secret, '# secret\n');
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('la regla: solo un archivo que existe, adentro de una carpeta sumada', () => {
  assert.deepEqual(reveal.check(note, [allowed]), { file: note });
  // Con ".." en el medio se resuelve antes de comparar.
  assert.deepEqual(reveal.check(path.join(allowed, 'sub dir', '..', 'sub dir', 'plan, v2.md'), [allowed]), { file: note });
  assert.deepEqual(reveal.check(path.join(allowed, '..', 'private', 'secret.md'), [allowed]), { status: 403, error: 'outside' });
  assert.deepEqual(reveal.check(secret, [allowed]), { status: 403, error: 'outside' });
  // Una carpeta que empieza igual no es la carpeta.
  fs.mkdirSync(allowed + '-old'); fs.writeFileSync(path.join(allowed + '-old', 'a.md'), 'a');
  assert.deepEqual(reveal.check(path.join(allowed + '-old', 'a.md'), [allowed]), { status: 403, error: 'outside' });
  // Sin carpetas sumadas no se muestra nada, ni siquiera lo que existe.
  assert.deepEqual(reveal.check(note, []), { status: 403, error: 'no-folders' });
  assert.deepEqual(reveal.check(note, undefined), { status: 403, error: 'no-folders' });
  assert.deepEqual(reveal.check(path.join(allowed, 'no-such.md'), [allowed]), { status: 404, error: 'missing' });
});

test('la regla, para una carpeta: una de adentro o la sumada misma, con las mismas condiciones', () => {
  const sub = path.join(allowed, 'sub dir');
  assert.deepEqual(reveal.check(sub, [allowed]), { file: sub, dir: true });
  assert.deepEqual(reveal.check(allowed, [allowed]), { file: allowed, dir: true });
  // Con la barra del final, con ".." en el medio y con otra capitalización de la unidad se resuelve igual.
  assert.deepEqual(reveal.check(sub + path.sep, [allowed]), { file: sub, dir: true });
  assert.deepEqual(reveal.check(path.join(sub, '..', 'sub dir'), [allowed]), { file: sub, dir: true });
  // Afuera no: ni la de al lado, ni la de arriba, ni una que empieza igual.
  assert.deepEqual(reveal.check(other, [allowed]), { status: 403, error: 'outside' });
  assert.deepEqual(reveal.check(base, [allowed]), { status: 403, error: 'outside' });
  assert.deepEqual(reveal.check(path.join(allowed, '..', 'private'), [allowed]), { status: 403, error: 'outside' });
  fs.mkdirSync(allowed + '-twin', { recursive: true });
  assert.deepEqual(reveal.check(allowed + '-twin', [allowed]), { status: 403, error: 'outside' });
  assert.deepEqual(reveal.check(sub, []), { status: 403, error: 'no-folders' });
  assert.deepEqual(reveal.check(path.join(allowed, 'no-such-dir'), [allowed]), { status: 404, error: 'missing' });
  for (const bad of [sub + '"', sub + '\n', 'sub dir', sub + '" & calc.exe "']) assert.deepEqual(reveal.check(bad, [allowed]), { status: 400, error: 'bad-path' }, bad);
});

test('qué se lanza: el explorador y la ruta, como lista de argumentos, sin intérprete', () => {
  // Una carpeta se abre por dentro; un archivo queda seleccionado en la suya.
  assert.deepEqual(reveal.command('C:\\notes\\sub dir', true, 'win32'), { cmd: 'explorer.exe', args: ['"C:\\notes\\sub dir"'], verbatim: true });
  assert.deepEqual(reveal.command('C:\\notes\\a.md', false, 'win32'), { cmd: 'explorer.exe', args: ['/select,"C:\\notes\\a.md"'], verbatim: true });
  assert.deepEqual(reveal.command('/Users/me/notes', true, 'darwin'), { cmd: 'open', args: ['/Users/me/notes'] });
  assert.deepEqual(reveal.command('/Users/me/notes/a.md', false, 'darwin'), { cmd: 'open', args: ['-R', '/Users/me/notes/a.md'] });
  assert.deepEqual(reveal.command('/home/me/notes', true, 'linux'), { cmd: 'xdg-open', args: ['/home/me/notes'] });
  assert.deepEqual(reveal.command('/home/me/notes/a.md', false, 'linux'), { cmd: 'xdg-open', args: ['/home/me/notes'] });
  // Nunca una consola: el programa es siempre el explorador del sistema.
  for (const os of ['win32', 'darwin', 'linux']) for (const dir of [true, false]) assert.match(reveal.command('/x/y', dir, os).cmd, /^(explorer\.exe|open|xdg-open)$/);
});

test('un enlace a una carpeta de afuera no pasa', (t) => {
  const link = path.join(allowed, 'link-dir');
  try { fs.symlinkSync(other, link, 'junction'); } catch (e) { t.skip('este sistema no deja crear enlaces sin permisos'); return; }
  assert.deepEqual(reveal.check(link, [allowed]), { status: 403, error: 'outside' });
  fs.rmSync(link, { recursive: false, force: true });
});

test('la regla: lo que no es una ruta de disco limpia se rechaza sin tocar el disco', () => {
  for (const bad of [undefined, null, 7, {}, [note], '', 'plan.md', 'sub dir/plan.md', './plan.md', note + '\n', note + '\u0000', note + '"', '"' + note + '"', note + '" & calc.exe "', 'x'.repeat(1025)]) {
    assert.deepEqual(reveal.check(bad, [allowed]), { status: 400, error: 'bad-path' }, JSON.stringify(bad));
  }
});

test('la regla en Windows: ni red, ni dispositivos, ni flujos alternativos', () => {
  for (const bad of ['\\\\server\\share\\a.md', '\\\\?\\C:\\notes\\a.md', '\\\\.\\C:\\notes\\a.md', '\\notes\\a.md', 'C:notes\\a.md', 'C:\\notes\\a.md:other', 'file:///C:/notes/a.md', '/notes/a.md']) {
    assert.deepEqual(reveal.check(bad, ['C:\\notes'], 'win32'), { status: 400, error: 'bad-path' }, bad);
  }
});

test('un enlace que apunta afuera de la carpeta no pasa', (t) => {
  const link = path.join(allowed, 'link.md');
  try { fs.symlinkSync(secret, link); } catch (e) { t.skip('este sistema no deja crear enlaces simbólicos sin permisos'); return; }
  assert.deepEqual(reveal.check(link, [allowed]), { status: 403, error: 'outside' });
});

async function start(extra) {
  const shown = [];
  const cfg = Object.assign(JSON.parse(JSON.stringify(config.DEFAULTS)), { port: 0, origins: ['https://sharpmd.app'], folders: [allowed] }, extra || {});
  const platform = { listeners: async () => [], processes: async () => [], killTree: async () => { throw new Error('nada se cierra acá'); }, stop: () => {}, capabilities: () => ({ cwd: true }) };
  const app = create({ cfg, token: TOKEN, platform, fixed: true, reveal: (file, dir) => shown.push(dir ? [file, 'dir'] : file) });
  const port = await app.listen();
  const call = async (method, url, body, headers) => {
    const res = await fetch('http://127.0.0.1:' + port + url, { method, headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body === undefined ? {} : { 'Content-Type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  };
  return { app, call, shown, port };
}

test('la API: muestra lo permitido y anota exactamente ese archivo', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  assert.deepEqual((await s.call('GET', '/v1/status')).json.allowReveal, true);
  const ok = await s.call('POST', '/v1/reveal', { path: note });
  assert.deepEqual([ok.status, ok.json], [200, { ok: true }]);
  assert.deepEqual(s.shown, [note]);
  // Lo que venga de más en el pedido no cuenta: no hay forma de pedir otro programa ni otros argumentos.
  await s.call('POST', '/v1/reveal', { path: note, cmd: 'calc.exe', args: ['/c', 'calc'], open: true });
  assert.deepEqual(s.shown, [note, note]);
  // Una carpeta: la de adentro y la sumada misma. El programa sabe que es una carpeta y la abre por dentro.
  const sub = path.join(allowed, 'sub dir');
  assert.equal((await s.call('POST', '/v1/reveal', { path: sub })).status, 200);
  assert.equal((await s.call('POST', '/v1/reveal', { path: allowed })).status, 200);
  assert.deepEqual(s.shown.slice(2), [[sub, 'dir'], [allowed, 'dir']]);
});

test('la API: lo demás se rechaza y no se muestra nada', async (t) => {
  const s = await start(); t.after(() => s.app.close());
  assert.deepEqual([(await s.call('POST', '/v1/reveal', { path: secret })).status, (await s.call('POST', '/v1/reveal', { path: secret })).json], [403, { error: 'outside' }]);
  assert.equal((await s.call('POST', '/v1/reveal', { path: path.join(allowed, 'nope.md') })).status, 404);
  assert.deepEqual([(await s.call('POST', '/v1/reveal', { path: other })).status, (await s.call('POST', '/v1/reveal', { path: base })).status], [403, 403]);
  assert.equal((await s.call('POST', '/v1/reveal', { path: 'plan.md' })).status, 400);
  assert.equal((await s.call('POST', '/v1/reveal', { path: [note] })).status, 400);
  assert.equal((await s.call('POST', '/v1/reveal', {})).status, 400);
  // Sin token, con otro origen, con otro Host, con GET, o sin JSON.
  assert.equal((await s.call('POST', '/v1/reveal', { path: note }, { Authorization: 'Bearer ' + 'x'.repeat(43) })).status, 401);
  assert.equal((await s.call('POST', '/v1/reveal', { path: note }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.call('GET', '/v1/reveal')).status, 404);
  assert.equal((await s.call('GET', '/v1/reveal?path=' + encodeURIComponent(note))).status, 404);
  const text = await fetch('http://127.0.0.1:' + s.port + '/v1/reveal', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'text/plain' }, body: JSON.stringify({ path: note }) });
  assert.equal(text.status, 415);
  assert.deepEqual(s.shown, []);
});

test('la API: sin carpetas sumadas, o apagado en la configuración, no muestra nada', async (t) => {
  const none = await start({ folders: [] }); t.after(() => none.app.close());
  assert.deepEqual([(await none.call('POST', '/v1/reveal', { path: note })).status, none.shown], [403, []]);
  const off = await start({ allowReveal: false }); t.after(() => off.app.close());
  const r = await off.call('POST', '/v1/reveal', { path: note });
  assert.deepEqual([r.status, r.json, off.shown], [403, { error: 'off' }, []]);
  assert.equal((await off.call('GET', '/v1/status')).json.allowReveal, false);
});
