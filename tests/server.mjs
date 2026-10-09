// Servidor de sincronización: cuentas, notas, límites del plan gratis y MCP.
import { spawn } from 'child_process'; import { createHmac } from 'crypto'; import { DatabaseSync } from 'node:sqlite';
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
const PORT = 18000 + Math.floor(Math.random() * 400);
const base = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', TEST_LOGIN: 'revision@ejemplo.test:246810', PADDLE_WEBHOOK_SECRET: 'firma-de-prueba', PADDLE_PRICE_MONTHLY: 'pri_mensual', PADDLE_PRICE_YEARLY: 'pri_anual', PADDLE_PRICE_LEGACY: 'pri_viejo_mensual,pri_viejo_anual', PORTAL_URL: 'https://portal.ejemplo.test', FREE_NOTES: '3', ALLOW_ORIGINS: 'https://ejemplo.test', FEEDBACK_TO: 'duenio@ejemplo.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !/puerto/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

const call = async (method, url, body, auth, extra) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(extra || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { status: r.status, json, headers: r.headers };
};
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '  ok   ' : '  FALLA ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail))); };
console.log('Servidor de sincronización');
try {
  const start = await call('POST', '/auth/start', { email: 'Ana@Ejemplo.test' });
  check('pide el código de acceso', start.status === 200 && /^\d{6}$/.test(start.json.dev_code), start.json);
  const gap = await call('POST', '/auth/start', { email: 'ana@ejemplo.test' });
  check('no deja pedir dos códigos seguidos', gap.status === 429);
  check('el tope dice cuál es y cuántos segundos faltan, en el cuerpo y en la cabecera', gap.json.error === 'code_gap' && gap.json.retry_after >= 1 && gap.json.retry_after <= 30 && gap.headers.get('retry-after') === String(gap.json.retry_after), [gap.json, gap.headers.get('retry-after')]);
  check('rechaza un código equivocado', (await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: '000000' + '' })).status === 400 || start.json.dev_code === '000000');
  const login = await call('POST', '/auth/verify', { email: 'ana@ejemplo.test', code: start.json.dev_code });
  const s = login.json.session;
  check('entra y devuelve la cuenta', login.status === 200 && s.startsWith('mds_') && login.json.account.plan === 'free' && login.json.account.limit === 3, login.json);
  check('sin sesión no hay acceso', (await call('GET', '/notes')).status === 401);

  console.log('Nombre visible');
  const acc0 = (await call('GET', '/account', undefined, s)).json;
  check('la cuenta tiene un nombre visible: por defecto, lo que va antes de la arroba', acc0.name === 'ana' && acc0.name_default === true && login.json.account.name === 'ana', acc0);
  let named = await call('PUT', '/account', { name: '  Ana   Paz ' }, s);
  check('cambiarlo lo guarda limpio, y deja de ser el por defecto', named.status === 200 && named.json.name === 'Ana Paz' && named.json.name_default === false && (await call('GET', '/account', undefined, s)).json.name === 'Ana Paz', named.json);
  const badNames = [];
  for (const name of ['A', 'x'.repeat(41), 'ana@paz', 'Ana\nPaz', 12, undefined]) badNames.push((await call('PUT', '/account', name === undefined ? {} : { name }, s)).status);
  check('de 2 a 40 caracteres, sin arroba, sin saltos y solo texto', badNames.every((x) => x === 400) && (await call('GET', '/account', undefined, s)).json.name === 'Ana Paz', badNames);
  check('sin sesión no se cambia', (await call('PUT', '/account', { name: 'Otra' })).status === 401);
  named = await call('PUT', '/account', { name: '' }, s);
  check('vacío vuelve al nombre por defecto', named.status === 200 && named.json.name === 'ana' && named.json.name_default === true, named.json);
  let lastName = null; for (let i = 0; i < 12; i++) lastName = await call('PUT', '/account', { name: 'Nombre ' + i }, s);
  check('hay un tope de cambios por hora', lastName.status === 429 && lastName.json.error === 'too_many' && lastName.json.retry_after >= 1, lastName.json);

  await call('PUT', '/notes/' + encodeURIComponent('ideas/uno.md'), { text: '# Uno\n\nUna zanahoria.' }, s);
  await call('PUT', '/notes/dos.md', { text: '# Dos' }, s);
  await call('PUT', '/notes/tres.md', { text: '# Tres' }, s);
  const list = await call('GET', '/notes', undefined, s);
  check('guarda y lista notas', list.json.length === 3 && list.json.some((n) => n.path === 'ideas/uno.md'), list.json);
  check('lee una nota', (await call('GET', '/notes/' + encodeURIComponent('ideas/uno.md'), undefined, s)).json.text === '# Uno\n\nUna zanahoria.');
  const over = await call('PUT', '/notes/cuatro.md', { text: 'x' }, s);
  check('el plan gratis frena en el límite', over.status === 402 && over.json.error === 'note_limit', over.json);
  check('pero deja seguir editando las que ya están', (await call('PUT', '/notes/dos.md', { text: '# Dos, editada' }, s)).status === 200);
  check('rechaza rutas raras', (await call('PUT', '/notes/' + encodeURIComponent('../afuera.md'), { text: 'x' }, s)).status === 400);
  check('renombra', (await call('POST', '/rename', { from: 'tres.md', to: 'archivo/tres.md' }, s)).status === 200);
  check('busca en el texto', (await call('GET', '/search?q=zanahoria', undefined, s)).json[0].path === 'ideas/uno.md');
  check('borra', (await call('DELETE', '/notes/dos.md', undefined, s)).status === 200 && (await call('GET', '/notes', undefined, s)).json.length === 2);

  // El MCP está en el plan gratis, sobre las mismas notas y con el mismo tope (acá, 3). Lo demás sigue siendo del plan pago.
  {
    const ftok = await call('POST', '/tokens', { name: 'Claude gratis', share: true }, s); const ft = ftok.json.token;
    const fmcp = async (name, args) => { const r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args || {} } }, ft); const c = (r.json && r.json.result) || { content: [{ text: '' }], isError: true }; return { status: r.status, text: c.content[0].text, err: !!c.isError }; };
    const facc = (await call('GET', '/account', undefined, s)).json;
    check('en el plan gratis se crea un token para la IA, y la cuenta dice que tiene MCP y no API', ftok.status === 200 && String(ft).startsWith('mdt_') && ftok.json.mcp_url.endsWith('/mcp') && facc.plan === 'free' && facc.mcp === true && facc.api === false && facc.limit === 3, [ftok.json, facc]);
    const flist = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ft);
    const fread = await fmcp('read_note', { path: 'ideas/uno.md' });
    check('MCP gratis: lista las herramientas y lee una nota', flist.status === 200 && flist.json.result.tools.some((x) => x.name === 'write_note') && !fread.err && fread.text.includes('zanahoria'), [flist.status, fread]);
    const fw1 = await fmcp('write_note', { path: 'gratis/tercera.md', text: 'tres' });
    const fw2 = await fmcp('write_note', { path: 'gratis/cuarta.md', text: 'cuatro' });
    const fap = await fmcp('append_note', { path: 'gratis/quinta.md', text: 'cinco' });
    const fed = await fmcp('write_note', { path: 'gratis/tercera.md', text: 'tres, editada' });
    const fnotes = (await call('GET', '/notes', undefined, s)).json.map((n) => n.path).sort();
    check('MCP gratis: escribe hasta el tope de notas, y pasado el tope el error lo dice claro y en inglés', !fw1.err && fw2.err && /free plan holds 3 notes/.test(fw2.text) && /Nothing was saved/.test(fw2.text) && /paid plan/.test(fw2.text) && !/[áéíóúñ¡!—]/.test(fw2.text) && fap.err && /free plan holds 3 notes/.test(fap.text) && fnotes.length === 3 && !fnotes.includes('gratis/cuarta.md') && !fnotes.includes('gratis/quinta.md'), [fw1, fw2, fap, fnotes]);
    check('MCP gratis: en el tope se siguen editando las notas que ya están', !fed.err && (await call('GET', '/notes/' + encodeURIComponent('gratis/tercera.md'), undefined, s)).json.text === 'tres, editada', fed);
    const fsh = await fmcp('share_note', { path: 'ideas/uno.md', email: 'otra@ejemplo.test' }); const flk = await fmcp('create_public_link', { path: 'ideas/uno.md' });
    check('MCP gratis: compartir y crear enlaces siguen siendo del plan pago', fsh.err && /paid plan/.test(fsh.text) && flk.err && /paid plan/.test(flk.text) && (await call('GET', '/shares', undefined, s)).json.people.length === 0, [fsh, flk]);
    const fapi = await call('GET', '/api/v1/notes', undefined, ft);
    const fhook = await call('POST', '/automations/hooks', { url: 'https://ejemplo.test/x', events: ['note.created'] }, s);
    const fin = await call('POST', '/automations/inboxes', { name: 'x', kind: 'append', path: 'ideas/uno.md' }, s);
    const fau = (await call('GET', '/automations', undefined, s)).json;
    check('la API, los webhooks, las direcciones de entrada y las automatizaciones siguen siendo del plan pago', fapi.status === 402 && fapi.json.error.code === 'api_needs_plan' && fhook.status === 402 && fhook.json.error === 'automation_needs_plan' && fin.status === 402 && fin.json.error === 'automation_needs_plan' && fau.allowed === false, [fapi.json, fhook.json, fin.json, fau.allowed]);
    const fcom = await call('POST', '/comments', { path: 'ideas/uno.md', text: 'acortalo' }, s);
    const fcl = await fmcp('list_comments', {});
    check('los comentarios para la IA van con el MCP, también en el plan gratis', fcom.status === 200 && !fcl.err && fcl.text.includes('acortalo'), [fcom.json, fcl]);
    await call('DELETE', '/comments/' + fcom.json.id, undefined, s);
    await call('DELETE', '/notes/' + encodeURIComponent('gratis/tercera.md'), undefined, s);
    await call('DELETE', '/tokens/' + ftok.json.id, undefined, s);
  }
  check('el plan no se cambia sin la clave', (await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'pro' })).status === 403);
  await call('POST', '/admin/plan', { email: 'ana@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  const tok = await call('POST', '/tokens', { name: 'Claude' }, s);
  const t = tok.json.token;
  check('con plan pago crea un token para la IA', tok.status === 200 && t.startsWith('mdt_') && tok.json.mcp_url.endsWith('/mcp'), tok.json);
  check('la sesión no sirve como token de MCP', (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, s)).status === 401);
  const init = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } } }, t);
  { const said = String(init.json.result.instructions || '');
    check('MCP: las instrucciones piden el enlace https que abre un archivo local, y la ruta como texto', said.includes('#open=file%3A%2F%2F%2FC%3A%2FUsers%2Fme%2FDesktop%2Fnotes.md)') && said.includes('#open=file%3A%2F%2F%2FUsers%2Fme%2FDesktop%2Fnotes.md)') && /full path as plain text/.test(said) && !/\]\(file:/.test(said) && !/[!¡—–]/.test(said), said.slice(-500)); }
  check('MCP: initialize', init.json.result.serverInfo.name === 'sharpmd' && !!init.json.result.capabilities.tools, init.json);
  check('MCP: las notificaciones no llevan respuesta', (await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, t)).status === 202);
  const tools = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, t);
  check('MCP: lista las herramientas de un token sin permiso de compartir, con la guía y las de tablero', tools.json.result.tools.map((x) => x.name).join() === 'list_notes,list_folders,read_note,write_note,append_note,edit_note,set_task,search_notes,list_comments,resolve_comment,move_note,note_history,get_guide,list_boards,create_board,add_card,move_card,update_card,delete_card,start_agent,update_agent,end_agent,list_agents' && tools.json.result.tools.every((x) => x.description.length > 20 && !/[!¡—–]/.test(x.description)), tools.json);
  const tool = (name, args, id) => call('POST', '/mcp', { jsonrpc: '2.0', id: id || 9, method: 'tools/call', params: { name, arguments: args } }, t);
  await tool('write_note', { path: 'ia/resumen.md', text: '# Resumen\n\nEscrito por la IA.' });
  await tool('append_note', { path: 'ia/resumen.md', text: 'Segunda parte.' });
  const read = await tool('read_note', { path: 'ia/resumen.md' });
  check('MCP: escribe, agrega y lee', read.json.result.content[0].text === '# Resumen\n\nEscrito por la IA.\n\nSegunda parte.', read.json);
  check('MCP: lo que escribe la IA lo ve la app', (await call('GET', '/notes/' + encodeURIComponent('ia/resumen.md'), undefined, s)).json.text.includes('Segunda parte.'));
  {
    // Tableros por MCP: las mismas operaciones que la API, con el id de la tarjeta, la columna y el enlace.
    const said = String(init.json.result.instructions || '');
    check('MCP: las instrucciones nombran la estructura del proyecto, el tablero y sus herramientas', ['README.md', 'architecture.md', 'features/', 'epics.md', 'decisions.md', 'log.md', 'board.md', 'To do', 'In progress', 'Paused', 'Done', 'needs', 'create_board', 'add_card', 'move_card', 'update_card', 'get_guide', 'pending.md', 'numbered steps', 'direct link'].every((x) => said.includes(x)), said.slice(0, 900));
    const bt = async (name, args) => { const r = (await tool(name, args)).json.result; let v = r.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!r.isError }; };
    const gd = (await bt('get_guide', {})).v;
    check('MCP: get_guide devuelve la guía en Markdown, sobria, con la estructura y las reglas del tablero', typeof gd === 'string' && /^# Working in SharpMD/.test(gd) && ['<project>/README.md', '<project>/architecture.md', '<project>/features/<name>.md', '<project>/epics.md', '<project>/decisions.md', '<project>/log.md', '<project>/board.md', 'Mermaid', 'Acceptance criteria', 'Context:', 'Consequence:', 'append_note', 'create_board', 'add_card', 'move_card', 'update_card', 'list_boards', 'field agent', 'field needs', 'field link', 'Do not delete finished cards', 'subagents', 'relative paths', '{done=Done}'].every((x) => gd.includes(x)) && !/[!¡—–]/.test(gd), gd);
    check('MCP: get_guide trae el formato de pending.md, con sus reglas y un ejemplo', ['Three jobs, done without being asked', '| <project>/pending.md |', '## The list of what the person has to do', 'The board holds your tasks', 'link it from the README', '- [ ] and - [x]', 'the most urgent first', 'One short line per item', '::: details Steps', 'Number the steps', 'the direct link to the exact page where it is done', '"Go to the console" is not a step: the link is.', 'bring back', 'where to leave it', 'how much and where it is paid', 'ask for a screenshot', 'Do not invent it', 'Never ask for a secret in the conversation', 'the file or the screen', 'Tick an item as soon as you learn it is done', 'a section Decided, with the date', 'mark it as yours', 'At the end of every session', '# Pending\n', '- [ ] Create the payment account\n  ::: details Steps\n  1. Open [the sign-up page](https://dashboard.example.com/register)', '\n  :::\n- [ ] Choose the plan: 20 USD a month, paid at [Billing](https://dashboard.example.com/billing)', '## Decided\n\n- [x] 2026-01-15'].every((x) => gd.includes(x)) && gd.indexOf('## The list of what the person has to do') > gd.indexOf('## The task board'), gd.slice(gd.indexOf('## The list of what')));
    const made = await bt('create_board', { path: 'ia/board.md' });
    const mdBoard = (await call('GET', '/notes/' + encodeURIComponent('ia/board.md'), undefined, s)).json.text;
    check('MCP: create_board crea la nota con el tablero de cuatro columnas y la de hechas marcada', !made.err && made.v.columns.join() === 'To do,In progress,Paused,Done' && made.v.done_column === 'Done' && made.v.board === 0 && made.v.path === 'ia/board.md' && /\?f=cloud%2Fia%2Fboard\.md$/.test(made.v.url) && mdBoard === '# board\n\n' + '`'.repeat(3) + 'kanban\n{done=Done}\n## To do\n\n## In progress\n\n## Paused\n\n## Done\n' + '`'.repeat(3) + '\n', [made.v, mdBoard]);
    const card = await bt('add_card', { path: 'ia/board.md', title: 'Write the sign-in spec', fields: { agent: 'claude' } });
    const cid = card.v.card && card.v.card.id;
    check('MCP: add_card deja la tarjeta en la primera columna y devuelve su id, la columna y el enlace', !card.err && /^[a-z2-9]{8}$/.test(cid) && card.v.card.column === 'To do' && card.v.card.done === false && card.v.card.fields.agent === 'claude' && card.v.url === made.v.url, card.v);
    const doing = await bt('move_card', { path: 'ia/board.md', id: cid, column: 'in progress' });
    const paused = await bt('move_card', { path: 'ia/board.md', id: cid, column: 'Paused' }); const needs = await bt('update_card', { path: 'ia/board.md', id: cid, fields: { needs: 'The name of the mail provider' } });
    check('MCP: move_card la pasa de columna (sin crear otra por las mayúsculas) y update_card le suma un campo sin tocar los demás', doing.v.card.column === 'In progress' && paused.v.card.column === 'Paused' && needs.v.card.fields.agent === 'claude' && needs.v.card.fields.needs === 'The name of the mail provider' && needs.v.card.done === false, [doing.v, needs.v]);
    const cleared = await bt('update_card', { path: 'ia/board.md', id: cid, title: 'Write the sign-in spec v2', fields: { needs: '', link: 'ia/resumen.md' } });
    const done = await bt('move_card', { path: 'ia/board.md', id: cid, column: 'Done' });
    check('MCP: un campo vacío se quita, y mover a la columna de hechas marca la tarjeta', !('needs' in cleared.v.card.fields) && cleared.v.card.title === 'Write the sign-in spec v2' && done.v.card.done === true && done.v.card.column === 'Done' && /marked as done/.test(done.v.result) && /- \[x\] Write the sign-in spec v2 \{agent=claude link=ia\/resumen\.md id=/.test((await call('GET', '/notes/' + encodeURIComponent('ia/board.md'), undefined, s)).json.text), [cleared.v, done.v]);
    const listed = await bt('list_boards', { path: 'ia/board.md' });
    check('MCP: list_boards da las columnas, la de hechas y las tarjetas con su id', listed.v.boards.length === 1 && listed.v.boards[0].done_column === 'Done' && listed.v.boards[0].columns.map((c) => c.column).join() === 'To do,In progress,Paused,Done' && listed.v.boards[0].columns[3].cards[0].id === cid && listed.v.boards[0].columns[3].cards[0].done === true && listed.v.url === made.v.url, listed.v);
    const second = await bt('create_board', { path: 'ia/board.md', title: 'Ideas', columns: ['Maybe', 'Shipped'], done: 'Shipped' });
    const two = await bt('add_card', { path: 'ia/board.md', board: 1, column: 'Shipped', title: 'Dark theme' });
    check('MCP: create_board sobre una nota que existe suma otro tablero sin tocar el primero', second.v.board === 1 && second.v.done_column === 'Shipped' && two.v.card.done === true && two.v.board === 1 && (await bt('list_boards', { path: 'ia/board.md' })).v.boards[0].columns[3].cards[0].id === cid, [second.v, two.v]);
    const gone = await bt('delete_card', { path: 'ia/board.md', id: two.v.card.id });
    const errs = [await bt('add_card', { path: 'ia/resumen.md', title: 'x' }), await bt('move_card', { path: 'ia/board.md', id: 'zzzzzzzz', column: 'Done' }), await bt('move_card', { path: 'ia/board.md', id: cid }), await bt('add_card', { path: 'ia/board.md', title: 'x', fields: { id: 'pisada' } }), await bt('create_board', { path: 'ia/otro.md', columns: ['A', 'a'] }), await bt('create_board', { path: 'ia/otro.md', columns: ['A'], done: 'B' }), await bt('list_boards', { path: 'ia/no-existe.md' })];
    check('MCP: delete_card la quita, y los errores se dicen sin escribir nada', !gone.err && gone.v.card.title === 'Dark theme' && errs.every((r) => r.err) && /no kanban board/.test(errs[0].v) && /no card with that id/.test(errs[1].v) && (await call('GET', '/notes/' + encodeURIComponent('ia/otro.md'), undefined, s)).status === 404, errs.map((r) => r.v));
    // Un campo de texto largo (longtext) es un tipo más: no se confunde con una lista de una sola opción, y un tablero viejo se lee igual.
    await call('PUT', '/notes/' + encodeURIComponent('ia/tipos.md'), { text: '# Tipos\n\n```kanban\n{show=needs needs=longtext est=number etapa=idea|final nota=text}\n## To do\n- [ ] Uno {needs="Un texto largo, en un solo renglón del archivo" id=aaaaaaaa}\n\n## Done\n```\n' }, s);
    const tipos = await call('GET', '/api/v1/boards?path=' + encodeURIComponent('ia/tipos.md'), undefined, t);
    const tf = (((tipos.json || {}).data || {}).boards || [{}])[0].fields || {};
    const moved = await bt('move_card', { path: 'ia/tipos.md', id: 'aaaaaaaa', column: 'Done' });
    const tiposText = (await call('GET', '/notes/' + encodeURIComponent('ia/tipos.md'), undefined, s)).json.text;
    check('tablero: el tipo longtext se lee como texto largo, junto a los de siempre, y al reescribir el tablero queda igual', tipos.status === 200 && JSON.stringify(tf) === JSON.stringify({ needs: { type: 'longtext' }, est: { type: 'number' }, etapa: { type: 'select', options: ['idea', 'final'] }, nota: { type: 'text' } }) && !moved.err && tiposText.includes('{show=needs needs=longtext est=number etapa=idea|final nota=text}') && /- \[x\] Uno \{needs="Un texto largo, en un solo renglón del archivo" id=aaaaaaaa/.test(tiposText), [tipos.status, tf, tiposText]);
    await call('DELETE', '/notes/' + encodeURIComponent('ia/tipos.md'), undefined, s);
    await call('DELETE', '/notes/' + encodeURIComponent('ia/board.md'), undefined, s);
  }
  const found = await tool('search_notes', { query: 'zanahoria' });
  check('MCP: busca', /ideas\/uno\.md/.test(found.json.result.content[0].text));
  const bad = await tool('read_note', { path: 'no-existe.md' });
  check('MCP: un error vuelve como error de la herramienta', bad.json.result.isError === true, bad.json);
  const vers = await call('GET', '/versions/' + encodeURIComponent('ia/resumen.md'), undefined, s);
  check('guarda historial en el plan pago', vers.json.length === 1, vers.json);
  check('devuelve el texto de una versión anterior', (await call('GET', '/version/' + vers.json[0].id, undefined, s)).json.text === '# Resumen\n\nEscrito por la IA.');

  // compartir entre cuentas
  const start2 = await call('POST', '/auth/start', { email: 'beto@ejemplo.test' });
  const b = (await call('POST', '/auth/verify', { email: 'beto@ejemplo.test', code: start2.json.dev_code })).json.session;
  const owner = (await call('GET', '/account', undefined, s)).json.id;
  const enc = encodeURIComponent;
  check('sin compartir, otra cuenta no entra a la nota', (await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b)).status === 403);
  check('compartir una nota para ver', (await call('POST', '/shares', { path: 'ia/resumen.md', email: 'beto@ejemplo.test', role: 'view' }, s)).status === 200);
  const seen = await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b);
  check('la otra cuenta la lee', seen.status === 200 && seen.json.role === 'view' && seen.json.text.includes('Segunda parte.'), seen.json);
  check('pero con permiso de ver no la puede cambiar', (await call('PUT', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, { text: 'x' }, b)).status === 403);
  check('ni entrar a otra nota del dueño', (await call('GET', '/notes/' + enc('ideas/uno.md') + '?o=' + owner, undefined, b)).status === 403);
  await call('POST', '/shares', { path: 'ideas', kind: 'folder', email: 'beto@ejemplo.test', role: 'edit' }, s);
  const withMe = await call('GET', '/shared', undefined, b);
  check('compartir una carpeta da acceso a lo de adentro', withMe.json.length === 2 && withMe.json.some((n) => n.path === 'ideas/uno.md' && n.role === 'edit' && n.by === 'ana@ejemplo.test'), withMe.json);
  // en vivo: quien escucha se entera cuando otro guarda
  const ctrl = new AbortController();
  const stream = await fetch(base + '/events?path=' + enc('ideas/uno.md'), { headers: { authorization: 'Bearer ' + s }, signal: ctrl.signal });
  const reader = stream.body.getReader(); const dec = new TextDecoder(); let got = '';
  const pump = (async () => { try { for (;;) { const r = await reader.read(); if (r.done) break; got += dec.decode(r.value); } } catch (e) { /* cortado a propósito */ } })();
  await new Promise((r) => setTimeout(r, 200));
  check('con permiso de editar la cambia', (await call('PUT', '/notes/' + enc('ideas/uno.md') + '?o=' + owner, { text: '# Uno\n\nEditado por Beto.' }, b)).status === 200);
  await new Promise((r) => setTimeout(r, 300)); ctrl.abort(); await pump;
  check('el dueño recibe el aviso en vivo', /"type":"presence"/.test(got) && /"type":"saved","by":"beto@ejemplo.test"/.test(got.replace(/"who":\[[^\]]*\],/g, '')), got.slice(0, 300));
  check('el cambio quedó en la nota del dueño', (await call('GET', '/notes/' + enc('ideas/uno.md'), undefined, s)).json.text.includes('Editado por Beto.'));
  const shares = await call('GET', '/shares?path=' + enc('ia/resumen.md'), undefined, s);
  await call('DELETE', '/shares/' + shares.json.people[0].id, undefined, s);
  check('dejar de compartir corta el acceso', (await call('GET', '/notes/' + enc('ia/resumen.md') + '?o=' + owner, undefined, b)).status === 403);
  check('compartir es del plan pago', (await call('POST', '/shares', { path: 'x.md', email: 'ana@ejemplo.test' }, b)).status === 402);
  // enlace público con contraseña
  const open = await call('POST', '/links', { path: 'ia/resumen.md' }, s);
  check('enlace público sin contraseña', (await call('GET', '/public/' + open.json.token)).json.text.includes('Segunda parte.'));
  const locked = await call('POST', '/links', { path: 'ia/resumen.md', password: 'manzana-42' }, s);
  check('enlace con contraseña: la pide', (await call('GET', '/public/' + locked.json.token)).status === 401);
  check('rechaza una contraseña equivocada', (await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'pera' })).status === 403);
  check('y abre con la correcta', (await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'manzana-42' })).json.text.includes('Segunda parte.'));
  for (let i = 0; i < 10; i++) await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'no' + i });
  const blocked = await call('GET', '/public/' + locked.json.token, undefined, undefined, { 'x-password': 'manzana-42' });
  check('diez intentos fallidos bloquean el enlace, y dice cuánto falta', blocked.status === 429 && blocked.json.error === 'locked' && blocked.json.retry_after > 590 && blocked.json.retry_after <= 600, blocked.json);
  check('un enlace inventado no existe', (await call('GET', '/public/abcdef')).status === 404);

  const pre = await fetch(base + '/notes', { method: 'OPTIONS', headers: { origin: 'https://ejemplo.test', 'access-control-request-method': 'GET' } });
  const ext = await fetch(base + '/health', { headers: { origin: 'chrome-extension://abcdefghijklmnop' } });
  const other = await fetch(base + '/health', { headers: { origin: 'https://otro.test' } });
  check('CORS: el sitio permitido y las extensiones sí, el resto no', pre.headers.get('access-control-allow-origin') === 'https://ejemplo.test' && ext.headers.get('access-control-allow-origin') === 'chrome-extension://abcdefghijklmnop' && !other.headers.get('access-control-allow-origin'));
  // Renombrar: lo compartido, el enlace público y el historial siguen a la nota
  const rc = await call('POST', '/auth/start', { email: 'rena@ejemplo.test' }); const rs = (await call('POST', '/auth/verify', { email: 'rena@ejemplo.test', code: rc.json.dev_code })).json.session;
  await call('POST', '/admin/plan', { email: 'rena@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  await call('PUT', '/notes/viejo.md', { text: 'uno' }, rs); await call('PUT', '/notes/viejo.md', { text: 'dos' }, rs);
  await call('POST', '/shares', { path: 'viejo.md', email: 'pago@ejemplo.test', role: 'view' }, rs);
  const enlace = await call('POST', '/links', { path: 'viejo.md' }, rs);
  await call('POST', '/rename', { from: 'viejo.md', to: 'nuevo.md' }, rs);
  const rcomp = (await call('GET', '/shares?path=nuevo.md', undefined, rs)).json; const rver = (await call('GET', '/versions/nuevo.md', undefined, rs)).json;
  check('renombrar lleva consigo lo compartido y el historial', JSON.stringify(rcomp).includes('pago@ejemplo.test') && Array.isArray(rver) && rver.length >= 1, [rcomp, rver]);
  // IA: carpetas, token limitado a una carpeta y comentarios pendientes
  const ic = await call('POST', '/auth/start', { email: 'ia@ejemplo.test' }); const is = (await call('POST', '/auth/verify', { email: 'ia@ejemplo.test', code: ic.json.dev_code })).json.session;
  check('comentar no pide el plan pago: sin la nota responde que no existe', (await call('POST', '/comments', { path: 'x.md', text: 'hola' }, is)).status === 404);
  await call('POST', '/admin/plan', { email: 'ia@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
  for (const [pa, tx] of [['alfa/plan.md', '# Plan\n\nPaso uno.\n'], ['alfa/notas/reunion.md', 'reunion'], ['beta/ideas.md', 'ideas'], ['suelta.md', 'suelta']]) await call('PUT', '/notes/' + pa, { text: tx }, is);
  const mk = async (body) => (await call('POST', '/tokens', body, is)).json;
  const full = (await mk({ name: 'todo' })).token; const lim = await mk({ name: 'alfa', folder: 'alfa/' });
  const ask = async (tok, name, args) => { const r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; let v = c.content[0].text; try { v = JSON.parse(v); } catch (e) { /* texto */ } return { v, err: !!c.isError }; };
  const carpetas = (await ask(full, 'list_folders')).v;
  check('MCP: lista las carpetas con su cantidad de notas', JSON.stringify(carpetas) === JSON.stringify([{ folder: 'alfa', notes: 2 }, { folder: 'alfa/notas', notes: 1 }, { folder: 'beta', notes: 1 }]), carpetas);
  check('MCP: list_notes filtra por carpeta', (await ask(full, 'list_notes', { folder: 'alfa' })).v.map((n) => n.path).sort().join() === 'alfa/notas/reunion.md,alfa/plan.md');
  const vistas = (await ask(lim.token, 'list_notes')).v.map((n) => n.path).sort().join();
  check('token de carpeta: solo ve su carpeta', lim.scope === 'alfa' && vistas === 'alfa/notas/reunion.md,alfa/plan.md', [lim.scope, vistas]);
  const fuera = await ask(lim.token, 'read_note', { path: 'beta/ideas.md' }); const escribeFuera = await ask(lim.token, 'write_note', { path: 'suelta.md', text: 'x' });
  check('token de carpeta: no lee ni escribe afuera', fuera.err && escribeFuera.err && (await call('GET', '/notes/suelta.md', undefined, is)).json.text === 'suelta', [fuera, escribeFuera]);
  check('token de carpeta: la búsqueda no sale de la carpeta', (await ask(lim.token, 'search_notes', { query: 'ideas' })).v.length === 0 && (await ask(full, 'search_notes', { query: 'ideas' })).v.length === 1);
  // El enlace para abrir lo escrito, el permiso de compartir y las herramientas nuevas.
  {
  const openAt = 'https://sharpmd.app/src/app.html?f=';
  const w1 = await ask(full, 'write_note', { path: 'ia/mi nota ñ.md', text: '# Hola' }); const w2 = await ask(full, 'append_note', { path: 'ia/mi nota ñ.md', text: 'Más.' });
  check('MCP: write_note y append_note devuelven la dirección para abrir la nota en la app', w1.v === 'Saved ia/mi nota ñ.md (6 characters). Open it: ' + openAt + encodeURIComponent('cloud/ia/' + encodeURIComponent('mi nota ñ.md')) && w2.v === 'Appended to ia/mi nota ñ.md. Open it: ' + openAt + encodeURIComponent('cloud/ia/' + encodeURIComponent('mi nota ñ.md')), [w1.v, w2.v]);
  const mv = await ask(full, 'move_note', { from: 'ia/mi nota ñ.md', to: 'archivo/nota.md' }); const mvAgain = await ask(full, 'move_note', { from: 'beta/ideas.md', to: 'archivo/nota.md' });
  check('MCP: move_note mueve la nota, devuelve su dirección y no pisa otra', mv.v === 'Moved ia/mi nota ñ.md to archivo/nota.md. Open it: ' + openAt + 'cloud%2Farchivo%2Fnota.md' && (await call('GET', '/notes/' + encodeURIComponent('archivo/nota.md'), undefined, is)).json.text === '# Hola\n\nMás.' && (await call('GET', '/notes/' + encodeURIComponent('ia/mi nota ñ.md'), undefined, is)).status === 404 && mvAgain.err && /already a note/.test(mvAgain.v), [mv.v, mvAgain.v]);
  await ask(full, 'write_note', { path: 'archivo/nota.md', text: '# Hola, otra vez' });
  const hs = await ask(full, 'note_history', { path: 'archivo/nota.md' }); const hv = hs.v.length ? await ask(full, 'note_history', { path: 'archivo/nota.md', version: hs.v[0].version }) : { v: null };
  check('MCP: note_history lista las versiones anteriores y devuelve el texto de una', hs.v.length === 1 && hs.v[0].size > 0 && hv.v === '# Hola' && (await ask(full, 'note_history', { path: 'archivo/nota.md', version: 999999 })).err, [hs.v, hv.v]);
  const sharer = await mk({ name: 'comparte', share: true }); const shTools = (await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sharer.token)).json.result.tools;
  check('MCP: un token con el permiso de compartir tiene cinco herramientas más', sharer.share === true && typeof sharer.id === 'number' && shTools.map((x) => x.name).slice(-5).join() === 'list_shares,share_note,unshare_note,create_public_link,revoke_public_link' && shTools.every((x) => !('share' in x)) && (await mk({ name: 'no' })).share === false, shTools.map((x) => x.name));
  const noPerm = await ask(full, 'create_public_link', { path: 'suelta.md' });
  check('MCP: sin el permiso, crear un enlace falla y dice a quién pedírselo', noPerm.err && /cannot share notes or create public links\. Ask the person/.test(noPerm.v), noPerm.v);
  const sc = await call('POST', '/auth/start', { email: 'socia@ejemplo.test' }); const ss = (await call('POST', '/auth/verify', { email: 'socia@ejemplo.test', code: sc.json.dev_code })).json.session;
  const s1 = await ask(sharer.token, 'share_note', { path: 'suelta.md', email: 'Socia@Ejemplo.test' }); const s2 = await ask(sharer.token, 'share_note', { path: 'alfa', email: 'socia@ejemplo.test', role: 'edit' });
  const hers = (await call('GET', '/shared', undefined, ss)).json.map((n) => n.path + ':' + n.role).sort().join();
  check('MCP: share_note comparte una nota para ver y una carpeta para editar', s1.v === 'Shared the note suelta.md with socia@ejemplo.test (can view). They see it in SharpMD after signing in with that address.' && /^Shared the folder alfa with socia@ejemplo\.test \(can edit\)/.test(s2.v) && hers === 'alfa/notas/reunion.md:edit,alfa/plan.md:edit,suelta.md:view', [s1.v, s2.v, hers]);
  const l1 = await ask(sharer.token, 'create_public_link', { path: 'suelta.md' }); const l1tok = new URL(l1.v.url).searchParams.get('f').slice(4);
  const ls = await ask(sharer.token, 'list_shares', { path: 'suelta.md' });
  check('MCP: create_public_link devuelve la dirección del enlace, que abre la nota sin cuenta', l1.v.url === openAt + 'pub%2F' + l1tok && l1.v.protected === false && l1.v.path === 'suelta.md' && (await call('GET', '/public/' + l1tok)).json.text === 'suelta' && ls.v.people.length === 1 && ls.v.people[0].email === 'socia@ejemplo.test' && ls.v.links.length === 1 && ls.v.links[0].id === l1.v.id && !JSON.stringify(ls.v).includes(l1tok), [l1.v, ls.v]);
  const u1 = await ask(sharer.token, 'unshare_note', { path: 'suelta.md', email: 'socia@ejemplo.test' }); const r1 = await ask(sharer.token, 'revoke_public_link', { path: 'suelta.md' });
  check('MCP: unshare_note y revoke_public_link lo deshacen', !u1.err && r1.v === 'Revoked 1 public link to suelta.md.' && (await call('GET', '/public/' + l1tok)).status === 404 && (await call('GET', '/shared', undefined, ss)).json.every((n) => n.path !== 'suelta.md') && (await ask(sharer.token, 'revoke_public_link', { path: 'suelta.md' })).err);
  await ask(sharer.token, 'unshare_note', { path: 'alfa', email: 'socia@ejemplo.test' });
  await call('DELETE', '/notes/' + encodeURIComponent('archivo/nota.md') + '?forever=1', undefined, is);
  }
  const com = await call('POST', '/comments', { path: 'alfa/plan.md', quote: 'Paso uno.', text: 'Que el pago vaya primero' }, is);
  await call('POST', '/comments', { path: 'beta/ideas.md', quote: 'ideas', text: 'Sumar una idea' }, is);
  const pend = (await ask(full, 'list_comments')).v; const pendLim = (await ask(lim.token, 'list_comments')).v;
  check('comentarios: la IA los lee con la nota y la cita', com.status === 200 && pend.length === 2 && pend[0].path === 'alfa/plan.md' && pend[0].quote === 'Paso uno.' && pend[0].comment === 'Que el pago vaya primero', pend);
  check('comentarios: el token de carpeta solo ve los de su carpeta', pendLim.length === 1 && pendLim[0].path === 'alfa/plan.md', pendLim);
  check('comentarios: el token de carpeta no cierra uno de afuera', (await ask(lim.token, 'resolve_comment', { id: pend[1].id })).err);
  await ask(lim.token, 'resolve_comment', { id: pend[0].id, reply: 'Movi el pago al principio' });
  const abiertos = (await call('GET', '/comments?path=alfa/plan.md', undefined, is)).json; const todos = (await call('GET', '/comments?path=alfa/plan.md&all=1', undefined, is)).json;
  check('comentarios: al resolverlo queda cerrado con la respuesta', abiertos.length === 0 && todos.length === 1 && todos[0].status === 'done' && todos[0].reply === 'Movi el pago al principio', [abiertos, todos]);
  await call('POST', '/rename', { from: 'beta/ideas.md', to: 'beta/lista.md' }, is);
  check('comentarios: siguen a la nota renombrada y se van al borrarla', (await call('GET', '/comments?path=beta/lista.md', undefined, is)).json.length === 1 && (await call('DELETE', '/notes/beta/lista.md', undefined, is)).status === 200 && (await call('GET', '/comments', undefined, is)).json.length === 0);
  // Cuenta de prueba con código fijo
  const tl = await call('POST', '/auth/start', { email: 'revision@ejemplo.test' });
  check('la cuenta de prueba no devuelve ni manda código', tl.status === 200 && !tl.json.dev_code, tl.json);
  check('la cuenta de prueba no entra con otro código', (await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '000000' })).status === 400);
  check('la cuenta de prueba entra con el código fijo', !!(await call('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' })).json.session);
  await call('POST', '/auth/start', { email: 'otra@ejemplo.test' });
  check('el código fijo no sirve para otra cuenta', (await call('POST', '/auth/verify', { email: 'otra@ejemplo.test', code: '246810' })).status === 400);
  // Paddle: solo un aviso firmado, de un precio de SharpMD, cambia el plan
  const paddle = async (ev, secret) => { const raw = JSON.stringify(ev); const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', secret || 'firma-de-prueba').update(ts + ':' + raw).digest('hex'); const r = await fetch(base + '/paddle/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': 'ts=' + ts + ';h1=' + h1 }, body: raw }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const pc = await call('POST', '/auth/start', { email: 'pago@ejemplo.test' }); const ps = (await call('POST', '/auth/verify', { email: 'pago@ejemplo.test', code: pc.json.dev_code })).json.session;
  const sub = (status, extra) => ({ event_type: 'subscription.updated', data: { id: 'sub_1', status, items: [{ price: { id: 'pri_1', custom_data: { app: 'sharpmd', cycle: 'monthly' } } }], ...extra } });
  check('Paddle: un aviso con otra firma se rechaza', (await paddle(sub('active', { custom_data: { sharpmd_email: 'pago@ejemplo.test' } }), 'otra')).status === 401);
  const otro = await paddle({ event_type: 'subscription.created', data: { id: 'sub_9', status: 'active', custom_data: { sharpmd_email: 'pago@ejemplo.test' }, items: [{ price: { id: 'pri_x', custom_data: { plan: 'otro', meses: 1 } } }] } });
  check('Paddle: un precio de otro producto no toca la cuenta', otro.json.ignored === 'product' && (await call('GET', '/account', undefined, ps)).json.plan === 'free');
  const alta = await paddle(sub('active', { custom_data: { sharpmd_email: 'pago@ejemplo.test' } }));
  const cuentaPaga = (await call('GET', '/account', undefined, ps)).json;
  check('Paddle: la suscripción activa pasa la cuenta a pago', alta.json.plan === 'pro' && cuentaPaga.plan === 'pro' && cuentaPaga.manage === 'https://portal.ejemplo.test', [alta, cuentaPaga]);
  const renueva = await paddle(sub('past_due'));
  check('Paddle: la renovación sin custom_data encuentra la cuenta por la suscripción', renueva.json.plan === 'pro', renueva);
  await paddle(sub('canceled'));
  check('Paddle: al cancelarse vuelve a gratis', (await call('GET', '/account', undefined, ps)).json.plan === 'free');
  check('Paddle: un aviso sin cuenta no rompe', (await paddle({ event_type: 'subscription.created', data: { id: 'sub_2', status: 'active', custom_data: { sharpmd_email: 'nadie@ejemplo.test' }, items: [{ price: { custom_data: { app: 'sharpmd' } } }] } })).json.ignored === 'user');
  // Los precios por su id: los vigentes y los anteriores dan el plan pago aunque no lleven la marca; otro id, no.
  const byId = (id, status, price, mail) => paddle({ event_type: 'subscription.updated', data: { id, status, items: [{ price: { id: price }, quantity: 1 }], ...(mail ? { custom_data: { sharpmd_email: mail } } : {}) } });
  const planDe = async () => (await call('GET', '/account', undefined, ps)).json.plan;
  const viejo = await byId('sub_viejo', 'active', 'pri_viejo_anual', 'pago@ejemplo.test'); const conViejo = await planDe();
  const viejoBaja = await byId('sub_viejo', 'canceled', 'pri_viejo_anual');
  check('Paddle: un precio anterior todavía se reconoce como plan pago, y su baja también', viejo.json.plan === 'pro' && conViejo === 'pro' && viejoBaja.json.plan === 'free' && (await planDe()) === 'free', [viejo.json, viejoBaja.json]);
  const nuevo = await byId('sub_nuevo', 'active', 'pri_mensual', 'pago@ejemplo.test'); const conNuevo = await planDe(); await byId('sub_nuevo', 'canceled', 'pri_mensual');
  const ajeno = await byId('sub_ajeno', 'active', 'pri_cualquiera', 'pago@ejemplo.test');
  check('Paddle: los precios vigentes también, y un id que no está configurado no da nada', nuevo.json.plan === 'pro' && conNuevo === 'pro' && ajeno.json.ignored === 'product' && (await planDe()) === 'free', [nuevo.json, ajeno.json]);
  // El equipo: un precio marcado kind: team, con los lugares como cantidad. En prueba gratis cuenta como al día.
  const eqCode = await call('POST', '/auth/start', { email: 'equipo@ejemplo.test' }); const eqSes = (await call('POST', '/auth/verify', { email: 'equipo@ejemplo.test', code: eqCode.json.dev_code })).json.session;
  const finPrueba = new Date(Date.now() + 14 * 86400000).toISOString();
  const eq = (id, status, quantity, mail) => paddle({ event_type: 'subscription.updated', data: { id, status, next_billed_at: status === 'trialing' ? finPrueba : null, items: [{ price: { id: 'pri_equipo', custom_data: { app: 'sharpmd', kind: 'team', cycle: 'monthly' } }, quantity, ...(status === 'trialing' ? { trial_dates: { ends_at: finPrueba } } : {}) }], ...(mail ? { custom_data: { sharpmd_email: mail } } : {}) } });
  const equipoDe = async () => (await call('GET', '/account', undefined, eqSes)).json;
  const enPrueba = await eq('sub_eq', 'trialing', 3, 'equipo@ejemplo.test'); const e1 = await equipoDe();
  check('Paddle: la suscripción de equipo en prueba arma el equipo con los lugares de su cantidad, y da el plan', enPrueba.json.seats === 3 && e1.plan === 'pro' && e1.own_plan === 'free' && e1.team.mine.seats === 3 && e1.team.mine.active === true && e1.team.mine.trial_until === Date.parse(finPrueba), [enPrueba.json, e1.team.mine]);
  const crece = await eq('sub_eq', 'active', 5); const e2 = await equipoDe();
  check('Paddle: al cobrarse sigue, con la cantidad nueva y ya sin prueba', crece.json.seats === 5 && e2.team.mine.seats === 5 && !('trial_until' in e2.team.mine) && e2.plan === 'pro', [crece.json, e2.team.mine]);
  const finEq = await eq('sub_eq', 'canceled', 5); const e3 = await equipoDe();
  check('Paddle: al cancelarse el equipo pierde el plan y conserva a su gente', finEq.json.ended === true && e3.plan === 'free' && e3.team.mine.active === false && e3.team.mine.members.length === 1, [finEq.json, e3.team.mine]);
  const otraPrueba = await eq('sub_eq_2', 'trialing', 2, 'equipo@ejemplo.test');
  check('Paddle: otra prueba gratis para la misma cuenta no le devuelve el plan', otraPrueba.json.trial === 'used' && (await equipoDe()).plan === 'free', otraPrueba.json);
  // Correo bien formado: lo que antes pasaba con cualquier cosa con una arroba y un punto
  const mailOk = async (mail) => (await call('POST', '/auth/start', { email: mail })).status;
  const malos = ['sin-arroba.test', 'dos@@ejemplo.test', 'con espacio@ejemplo.test', 'ana@ejemplo', 'ana@ejemplo..test', '.ana@ejemplo.test', 'ana.@ejemplo.test', 'ana@-ejemplo.test', 'ana@ejemplo.t', 'ana@ejemplo.123'];
  const rechazos = []; for (const m of malos) rechazos.push(await mailOk(m));
  check('rechaza los correos mal formados', rechazos.every((st) => st === 400), rechazos);
  check('acepta correos comunes, con + y subdominios', (await mailOk('Nombre.Apellido+notas@mail.ejemplo.com.ar')) === 200 && (await mailOk('josé@añil.test')) === 200);

  // Comentarios: llegan con o sin sesión, con tope por IP y por cuenta
  const fb = (body, auth, ip) => call('POST', '/feedback', body, auth, ip ? { 'x-forwarded-for': ip } : undefined);
  const anon = await fb({ text: 'El menú tapa los ajustes.', context: { version: '2.35.0', where: 'extension', browser: 'Chrome', lang: 'es' } }, undefined, '10.0.0.1');
  check('comentarios: sin sesión entra, y sin correo configurado no manda nada', anon.status === 200 && anon.json.ok === true && anon.json.dev === true, anon.json);
  check('comentarios: con sesión entra', (await fb({ text: 'Con la cuenta abierta.' }, ps, '10.0.0.2')).status === 200);
  const corto = await fb({ text: ' abc ' }, undefined, '10.0.0.3'); const largo = await fb({ text: 'x'.repeat(4001) }, undefined, '10.0.0.3');
  check('comentarios: el texto va de 5 a 4000 caracteres', corto.status === 400 && corto.json.error === 'bad_text' && largo.status === 400 && (await fb({ text: 'x'.repeat(4000) }, undefined, '10.0.0.3')).status === 200, [corto.json, largo.json]);
  check('comentarios: un correo mal escrito se rechaza', (await fb({ text: 'Texto de prueba.', email: 'ana@ejemplo' }, undefined, '10.0.0.3')).json.error === 'bad_email');
  const porIp = []; for (let i = 0; i < 6; i++) porIp.push((await fb({ text: 'Comentario ' + i + ' de la misma IP.' }, undefined, '10.0.0.9')).status);
  check('comentarios: cinco por hora por IP', porIp.join() === '200,200,200,200,200,429' && (await fb({ text: 'Desde otra IP sigue entrando.' }, undefined, '10.0.0.10')).status === 200, porIp);
  // La IP que cuenta es la que anota el proxy, la última: inventar las anteriores no saltea el tope.
  check('comentarios: la IP es la última de x-forwarded-for', (await fb({ text: 'Con una IP inventada adelante.' }, undefined, '1.2.3.4, 10.0.0.9')).status === 429);
  const porCuenta = []; for (let i = 0; i < 6; i++) porCuenta.push((await fb({ text: 'Comentario ' + i + ' de la misma cuenta.' }, ps, '10.1.0.' + i)).status);
  check('comentarios: cinco por hora por cuenta, aunque cambie la IP', porCuenta.join() === '200,200,200,200,429,429', porCuenta);
  // Cada comentario queda guardado, salga o no el correo: lo lista /admin/feedback con la clave de administración.
  const fbKey = { 'x-admin-key': 'clave-de-prueba' };
  const fbList = await call('GET', '/admin/feedback', undefined, undefined, fbKey);
  const fbAnon = ((fbList.json || {}).items || []).find((i) => i.text === 'El menú tapa los ajustes.') || {};
  const fbUser = ((fbList.json || {}).items || []).find((i) => i.text === 'Con la cuenta abierta.') || {};
  check('comentarios guardados: sin sesión queda el texto y los cuatro datos de contexto, sin correo', fbList.status === 200 && fbAnon.kind === 'feedback' && fbAnon.from_email === '' && fbAnon.signed_in === false && fbAnon.plan === '' && fbAnon.created > Date.now() - 600000 && JSON.stringify(fbAnon.context) === JSON.stringify({ version: '2.35.0', where: 'extension', browser: 'Chrome', lang: 'es' }) && !('report' in fbAnon), fbAnon);
  check('comentarios guardados: con sesión queda el correo de la cuenta y su plan', fbUser.from_email === 'pago@ejemplo.test' && fbUser.signed_in === true && /^(free|pro)$/.test(fbUser.plan) && fbUser.context.where === 'web' && fbUser.context.version === '', fbUser);
  check('comentarios guardados: lo rechazado no se guarda, lo más nuevo va primero y el texto se guarda entero hasta 4000', !fbList.json.items.some((i) => /abc|Texto de prueba/.test(i.text)) && fbList.json.items.some((i) => i.text.length === 4000) && fbList.json.items.every((i, n, all) => !n || all[n - 1].id > i.id), fbList.json.items.map((i) => i.id));
  const fbNoKey = [await call('GET', '/admin/feedback', undefined, undefined, { 'x-forwarded-for': '10.0.1.1' }), await call('GET', '/admin/feedback', undefined, undefined, { 'x-admin-key': 'otra', 'x-forwarded-for': '10.0.1.1' }), await call('POST', '/admin/feedback', {}, undefined, fbKey), await call('GET', '/admin/feedback?days=1', undefined, undefined, fbKey), await call('GET', '/admin/feedback?days=9999', undefined, undefined, fbKey)];
  check('comentarios guardados: /admin/feedback pide la clave, es solo de lectura y days va de 1 a 180', fbNoKey[0].status === 403 && fbNoKey[1].status === 403 && fbNoKey[2].status !== 200 && fbNoKey[3].json.days === 1 && fbNoKey[3].json.items.length === fbList.json.items.length && fbNoKey[4].json.days === 180 && fbList.json.days === 30, fbNoKey.map((r) => [r.status, r.json && r.json.days]));

  // Con correo configurado: qué sale, a quién, y que del contexto no pase nada de más
  const second = async (extra) => {
    const port = PORT + 1 + Math.floor(Math.random() * 500); const dir = (extra && extra.DATA_DIR) || fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
    const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 50 && !/puerto/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    const get = async (url, headers) => { const r = await fetch('http://127.0.0.1:' + port + url, { headers: headers || {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const post = async (url, body, auth) => { const r = await fetch('http://127.0.0.1:' + port + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
    return { post, get, dir, log: () => out, stop: async (keep) => { const gone = new Promise((r) => proc.once('exit', r)); proc.kill(); await gone; await new Promise((r) => setTimeout(r, 300)); if (!keep) fs.rmSync(dir, { recursive: true, force: true }); } };
  };
  const sent = [];
  const inbox = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { sent.push(JSON.parse(b)); res.writeHead(200); res.end('{}'); }); });
  await new Promise((r) => inbox.listen(0, '127.0.0.1', r));
  const withMail = await second({ FEEDBACK_TO: 'duenio@ejemplo.test', ADMIN_KEY: 'clave-de-prueba', MAIL_WEBHOOK: 'http://127.0.0.1:' + inbox.address().port });
  const real = await withMail.post('/feedback', { text: 'Al cambiar de idioma se pisan dos ventanas.', email: 'Lectora@Ejemplo.test', context: { version: '2.35.0', where: 'web', browser: 'Mozilla/5.0 Chrome/140', lang: 'es', path: 'C:/privado/diario.md', note: '# Mi diario secreto' } });
  const m = sent[0] || {};
  check('comentarios: se mandan al correo configurado, con respuesta a quien escribió', real.status === 200 && !real.json.dev && m.to === 'duenio@ejemplo.test' && m.subject === 'SharpMD feedback' && m.reply_to === 'lectora@ejemplo.test', [real.json, m]);
  check('comentarios: el cuerpo trae el texto, la versión, web o extensión, el navegador y el idioma', /^Al cambiar de idioma se pisan dos ventanas\./.test(m.text || '') && /Version: 2\.35\.0/.test(m.text) && /Where: web/.test(m.text) && /Browser: Mozilla\/5\.0 Chrome\/140/.test(m.text) && /Language: es/.test(m.text), m.text);
  check('comentarios: ni rutas ni contenido de notas viajan en el contexto', !/privado|diario|secreto/.test(JSON.stringify(m)), m);
  const lc = await withMail.post('/auth/start', { email: 'cuenta@ejemplo.test' }); const ls = (await withMail.post('/auth/verify', { email: 'cuenta@ejemplo.test', code: lc.json.dev_code })).json.session;
  await withMail.post('/feedback', { text: 'Escrito con la cuenta abierta.', email: 'otro@ejemplo.test' }, ls);
  const m2 = sent[sent.length - 1] || {};
  check('comentarios: con sesión, el correo es el de la cuenta', m2.reply_to === 'cuenta@ejemplo.test' && /From: cuenta@ejemplo\.test \(signed in, free plan\)/.test(m2.text || ''), m2);
  // Denunciar una nota ajena: la misma ruta, con report. Dice qué nota es, nunca su contenido; el motivo es opcional.
  const rp = await withMail.post('/feedback', { text: '', report: { kind: 'link', note: 'pub/abc123\r\nBcc: tercero@ejemplo.test', owner: '', body: '# contenido de la nota' }, context: { version: '2.51.0', where: 'web' } });
  const m3 = sent[sent.length - 1] || {};
  check('denuncia: entra sin sesión y sin motivo, con asunto propio y qué nota es en una sola línea', rp.status === 200 && m3.to === 'duenio@ejemplo.test' && m3.subject === 'SharpMD report' && /^Reported note: pub\/abc123 Bcc: tercero@ejemplo\.test\nOwner: -\nKind: link\n\n\(no reason given\)\n/.test(m3.text || '') && !/contenido de la nota/.test(JSON.stringify(m3)) && !('reply_to' in m3), [rp.json, m3]);
  await withMail.post('/feedback', { text: 'Publica datos de otra persona.', report: { kind: 'otra-cosa', note: 'informes/plan.md', owner: '7' } }, ls);
  const m4 = sent[sent.length - 1] || {};
  check('denuncia: con sesión lleva el motivo, la ruta, la cuenta dueña y a quién responder', m4.subject === 'SharpMD report' && /^Reported note: informes\/plan\.md\nOwner: 7\nKind: -\n\nPublica datos de otra persona\.\n/.test(m4.text || '') && m4.reply_to === 'cuenta@ejemplo.test', m4);
  const kept = (await withMail.get('/admin/feedback', { 'x-admin-key': 'clave-de-prueba' })).json.items;
  const k1 = kept.find((i) => /pisan dos ventanas/.test(i.text)) || {}; const k3 = kept.find((i) => i.kind === 'report' && !i.text) || {}; const k4 = kept.find((i) => i.kind === 'report' && i.text) || {};
  check('comentarios guardados: con correo configurado también quedan, con el correo que dieron y sin rutas ni contenido de notas', kept.length === 4 && k1.kind === 'feedback' && k1.from_email === 'lectora@ejemplo.test' && k1.signed_in === false && k1.context.browser === 'Mozilla/5.0 Chrome/140' && !/privado|diario|secreto|contenido de la nota/.test(JSON.stringify(kept)), kept);
  check('denuncias guardadas: qué nota es en una sola línea, sin motivo o con él, y la cuenta de quien denuncia si había sesión', k3.report && k3.report.kind === 'link' && k3.report.note === 'pub/abc123 Bcc: tercero@ejemplo.test' && k3.report.owner === '' && k3.from_email === '' && k3.context.version === '2.51.0' &&
    k4.report && k4.report.kind === '' && k4.report.note === 'informes/plan.md' && k4.report.owner === '7' && k4.text === 'Publica datos de otra persona.' && k4.from_email === 'cuenta@ejemplo.test' && k4.signed_in === true && k4.plan === 'free', [k3, k4]);
  // El correo con el código: el código primero en el asunto y solo en su renglón, y un enlace que lo lleva en el fragmento.
  const cm = sent.find((x) => x.to === 'cuenta@ejemplo.test') || {}; const cCode = lc.json.dev_code;
  const cLink = (/^(https:\/\/\S+)$/m.exec(cm.text || '') || [])[1] || ''; const cFrag = cLink.split('#signin=')[1] || '';
  check('correo del código: el asunto empieza con el código y el texto lo trae solo en el primer renglón', cm.subject === cCode + ' is your SharpMD code' && (cm.text || '').split('\n')[0] === cCode && (cm.text || '').split('\n')[1] === '' && /expires in 15 minutes and works once/.test(cm.text), [cm.subject, cm.text]);
  check('correo del código: el enlace abre la app y lleva el correo y el código en el fragmento, nunca en la ruta ni en la consulta', cLink.split('#')[0] === 'https://sharpmd.app/src/app.html' && /^[A-Za-z0-9_-]+$/.test(cFrag) && Buffer.from(cFrag, 'base64url').toString() === cCode + ':cuenta@ejemplo.test' && !cLink.split('#')[0].includes(cCode) && !/cuenta|%40|@/.test(cLink.split('#')[0]) && cLink.split('#').length === 2, cLink);
  const cHtml = cm.html || '';
  check('correo del código: el HTML trae el código solo en su caja, el botón con el mismo enlace, y nada remoto ni que rastree', cHtml.includes('>' + cCode + '</div>') && cHtml.includes('href="' + cLink + '"') && />Sign in to SharpMD<\/a>/.test(cHtml) && (cHtml.match(/href=/g) || []).length === 1 && !/<img|<script|<link|src=|url\(|<form|onclick/i.test(cHtml), cHtml);
  const lcEs = await withMail.post('/auth/start', { email: 'hola@ejemplo.test', lang: 'es' }); const cmEs = sent.find((x) => x.to === 'hola@ejemplo.test') || {};
  check('correo del código: en español si la app lo pidió', cmEs.subject === lcEs.json.dev_code + ' es tu código de SharpMD' && (cmEs.text || '').split('\n')[0] === lcEs.json.dev_code && />Entrar a SharpMD<\/a>/.test(cmEs.html || '') && /#signin=[A-Za-z0-9_-]+\n/.test(cmEs.text), [cmEs.subject, cmEs.text]);
  check('correo del código: el enlace no suma nada, el código se usa una sola vez', (await withMail.post('/auth/verify', { email: 'hola@ejemplo.test', code: lcEs.json.dev_code })).status === 200 && (await withMail.post('/auth/verify', { email: 'hola@ejemplo.test', code: lcEs.json.dev_code })).json.error === 'code_expired');
  await withMail.stop(); inbox.close();
  // Otra dirección para la app: el enlace del correo sale de APP_URL.
  const sent2 = []; const inbox2 = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { sent2.push(JSON.parse(b)); res.writeHead(200); res.end('{}'); }); });
  await new Promise((r) => inbox2.listen(0, '127.0.0.1', r));
  const ownApp = await second({ APP_URL: 'https://notas.ejemplo.test/app.html', MAIL_WEBHOOK: 'http://127.0.0.1:' + inbox2.address().port });
  await ownApp.post('/auth/start', { email: 'propia@ejemplo.test' });
  check('correo del código: con APP_URL el enlace va a esa app', /\nhttps:\/\/notas\.ejemplo\.test\/app\.html#signin=[A-Za-z0-9_-]+\n/.test((sent2[0] || {}).text || ''), sent2[0]);
  await ownApp.stop(); inbox2.close();
  // Si el correo falla (el proveedor responde con error, o ni contesta), el comentario queda guardado y la respuesta es de éxito.
  const broken = http.createServer((req, res) => { req.resume(); res.writeHead(500); res.end('{}'); }); await new Promise((r) => broken.listen(0, '127.0.0.1', r));
  const failing = await second({ FEEDBACK_TO: 'duenio@ejemplo.test', ADMIN_KEY: 'clave-de-prueba', MAIL_WEBHOOK: 'http://127.0.0.1:' + broken.address().port });
  const lost = await failing.post('/feedback', { text: 'El correo de este no va a salir.', email: 'quien@ejemplo.test' });
  const lostRep = await failing.post('/feedback', { text: '', report: { kind: 'gallery', note: 'gallery/12', owner: '' } });
  const lostKept = (await failing.get('/admin/feedback', { 'x-admin-key': 'clave-de-prueba' })).json.items;
  check('comentarios: si el correo falla, queda guardado y la respuesta es de éxito', lost.status === 200 && lost.json.ok === true && lostRep.status === 200 && lostKept.length === 2 && lostKept[1].text === 'El correo de este no va a salir.' && lostKept[1].from_email === 'quien@ejemplo.test' && lostKept[0].report.note === 'gallery/12' && /no salió el correo del comentario 1/.test(failing.log()), [lost, lostKept]);
  check('correo del código: si falla, pedir el código sigue respondiendo el error', (await failing.post('/auth/start', { email: 'quien@ejemplo.test' })).status === 502);
  await failing.stop(); broken.close();
  const dead = await second({ FEEDBACK_TO: 'duenio@ejemplo.test', ADMIN_KEY: 'clave-de-prueba', MAIL_WEBHOOK: 'http://127.0.0.1:9/' });
  const lost2 = await dead.post('/feedback', { text: 'Tampoco sale si el proveedor no contesta.' });
  check('comentarios: si el proveedor ni contesta, también queda guardado', lost2.status === 200 && lost2.json.ok === true && (await dead.get('/admin/feedback', { 'x-admin-key': 'clave-de-prueba' })).json.items.length === 1, lost2);
  await dead.stop();
  // Retención: los de más de 180 días se borran solos, y el id de uno nuevo no repite el de uno borrado.
  const fbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
  let old = await second({ DATA_DIR: fbDir, FEEDBACK_TO: 'duenio@ejemplo.test', ADMIN_KEY: 'clave-de-prueba' });
  for (const t of ['El más viejo, se va.', 'Casi viejo, se queda.', 'El último, que también vence.']) await old.post('/feedback', { text: t });
  await old.stop(true);
  const fdb = new DatabaseSync(path.join(fbDir, 'mdtools.db'));
  fdb.prepare('UPDATE feedback SET created = ? WHERE id = 1').run(Date.now() - 181 * 86400000); fdb.prepare('UPDATE feedback SET created = ? WHERE id = 2').run(Date.now() - 179 * 86400000); fdb.prepare('UPDATE feedback SET created = ? WHERE id = 3').run(Date.now() - 200 * 86400000);
  // La consulta de solo lectura con la que se avisan los nuevos por otro canal.
  const news = fdb.prepare('SELECT id, created, kind, from_email, text FROM feedback WHERE id > ? ORDER BY id LIMIT 50').all(1);
  fdb.close();
  old = await second({ DATA_DIR: fbDir, FEEDBACK_TO: 'duenio@ejemplo.test', ADMIN_KEY: 'clave-de-prueba' });
  const left = (await old.get('/admin/feedback?days=180', { 'x-admin-key': 'clave-de-prueba' })).json.items;
  await old.post('/feedback', { text: 'Uno nuevo después de la limpieza.' });
  const left2 = (await old.get('/admin/feedback?days=180', { 'x-admin-key': 'clave-de-prueba' })).json.items;
  check('comentarios: los de más de 180 días se borran solos y los demás quedan', left.length === 1 && left[0].id === 2 && left[0].text === 'Casi viejo, se queda.', left);
  check('comentarios: la consulta de novedades por id anda sobre la base, y un id borrado no se repite', news.map((r) => r.id).join() === '2,3' && Object.keys(news[0]).join() === 'id,created,kind,from_email,text' && left2[0].id === 4, [news, left2]);
  await old.stop();
  const noFeedback = await second({});
  check('comentarios: sin FEEDBACK_TO responde 404', (await noFeedback.post('/feedback', { text: 'No debería llegar a nadie.' })).status === 404);
  await noFeedback.stop();

  // Otro servidor sobre una carpeta que se conserva entre arranques, con pedidos que pueden llevar cabeceras.
  const boot = async (dir, extra) => {
    const port = 21000 + Math.floor(Math.random() * 3000);
    const proc = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { env: { ...process.env, DATA_KEY: '', PORT: String(port), DATA_DIR: dir, DEV_CODES: '1', ADMIN_KEY: 'clave-de-prueba', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
    let code = null; const exited = new Promise((r) => proc.once('exit', (c) => { code = c; r(c); }));
    for (let i = 0; i < 80 && !/puerto/.test(out) && code === null; i++) await new Promise((r) => setTimeout(r, 100));
    const ask = async (method, url, body, auth, more) => {
      const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(more || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
    };
    const enter = async (mail, pro) => { const c = await ask('POST', '/auth/start', { email: mail }); const s = (await ask('POST', '/auth/verify', { email: mail, code: c.json.dev_code })).json.session; if (pro) await ask('POST', '/admin/plan', { email: mail, plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' }); return s; };
    return { ask, enter, log: () => out, up: () => /puerto/.test(out), exited, stop: async () => { proc.kill(); await exited; await new Promise((r) => setTimeout(r, 150)); } };
  };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdsync-'));
  const wipe = (dir) => fs.rmSync(dir, { recursive: true, force: true });

  // ---------- Topes: cada uno responde con su código y con la espera ----------
  const limDir = tmp();
  const topes = await boot(limDir, { AUTH_PER_IP: '3', TEST_LOGIN: 'revision@ejemplo.test:246810' });
  const from = (ip) => ({ 'x-forwarded-for': ip });
  const waits = (r, code, max) => r.status === 429 && r.json.error === code && r.json.retry_after >= 1 && r.json.retry_after <= max && r.headers.get('retry-after') === String(r.json.retry_after);
  // Por correo: cinco códigos por hora. Entrar borra el código pedido, así que el de 30 segundos no se cruza.
  for (let i = 0; i < 5; i++) { const c = await topes.ask('POST', '/auth/start', { email: 'hora@ejemplo.test' }, undefined, from('10.2.0.' + i)); await topes.ask('POST', '/auth/verify', { email: 'hora@ejemplo.test', code: c.json.dev_code }, undefined, from('10.2.0.' + i)); }
  const porHora = await topes.ask('POST', '/auth/start', { email: 'hora@ejemplo.test' }, undefined, from('10.2.0.9'));
  check('topes: cinco códigos por hora por correo, con su código y su espera', waits(porHora, 'code_mail_hour', 3600) && porHora.json.retry_after > 3500, porHora.json);
  for (let i = 0; i < 3; i++) await topes.ask('POST', '/auth/start', { email: 'red' + i + '@ejemplo.test' }, undefined, from('10.3.0.1'));
  const porRed = await topes.ask('POST', '/auth/start', { email: 'red9@ejemplo.test' }, undefined, from('10.3.0.1'));
  check('topes: el de pedidos por red tiene otro código', waits(porRed, 'code_ip_hour', 3600), porRed.json);
  await topes.ask('POST', '/auth/start', { email: 'gastado@ejemplo.test' }, undefined, from('10.4.0.1'));
  for (let i = 0; i < 6; i++) await topes.ask('POST', '/auth/verify', { email: 'gastado@ejemplo.test', code: 'no' }, undefined, from('10.4.1.' + i));
  const gastado = await topes.ask('POST', '/auth/verify', { email: 'gastado@ejemplo.test', code: 'no' }, undefined, from('10.4.1.9'));
  check('topes: un código con seis intentos queda gastado, sin espera: hay que pedir otro', gastado.status === 429 && gastado.json.error === 'tries_code' && gastado.json.retry_after === undefined && !gastado.headers.get('retry-after'), gastado.json);
  // La cuenta de prueba pide código sin la espera de 30 segundos: sirve para llegar a los diez fallos por correo.
  for (let k = 0; k < 2; k++) { await topes.ask('POST', '/auth/start', { email: 'revision@ejemplo.test' }, undefined, from('10.5.0.' + k)); for (let i = 0; i < 5; i++) await topes.ask('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '000000' }, undefined, from('10.5.' + (k + 1) + '.' + i)); }
  const porCorreo = await topes.ask('POST', '/auth/verify', { email: 'revision@ejemplo.test', code: '246810' }, undefined, from('10.5.9.9'));
  check('topes: diez códigos equivocados por hora por correo', waits(porCorreo, 'tries_mail_hour', 3600), porCorreo.json);
  for (let k = 0; k < 5; k++) { await topes.ask('POST', '/auth/start', { email: 'mal' + k + '@ejemplo.test' }, undefined, from('10.6.0.' + k)); for (let i = 0; i < 6; i++) await topes.ask('POST', '/auth/verify', { email: 'mal' + k + '@ejemplo.test', code: 'no' }, undefined, from('10.6.9.9')); }
  await topes.ask('POST', '/auth/start', { email: 'mal9@ejemplo.test' }, undefined, from('10.6.0.9'));
  const porRedMal = await topes.ask('POST', '/auth/verify', { email: 'mal9@ejemplo.test', code: 'no' }, undefined, from('10.6.9.9'));
  check('topes: treinta códigos equivocados por hora por red', waits(porRedMal, 'tries_ip_hour', 3600), porRedMal.json);
  await topes.stop(); wipe(limDir);

  // ---------- Cifrado en reposo (DATA_KEY) ----------
  // Lo que hay en el disco: el archivo de la base y su WAL, tal como los vería quien se lleva un respaldo.
  const onDisk = (dir, word) => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).some((f) => fs.readFileSync(path.join(dir, f)).includes(Buffer.from(word)));
  const K1 = Buffer.alloc(32, 7).toString('base64'); const K2 = Buffer.alloc(32, 9).toString('base64');
  const encDir = tmp();
  let srv = await boot(encDir, {});
  let es = await srv.enter('cifra@ejemplo.test', true);
  await srv.ask('PUT', '/notes/' + encodeURIComponent('diario/lunes.md'), { text: '# Lunes\n\nremolacha-uno en claro.' }, es);
  await srv.ask('PUT', '/notes/' + encodeURIComponent('diario/lunes.md'), { text: '# Lunes\n\nremolacha-dos en claro, más larga.' }, es);
  await srv.ask('POST', '/comments', { path: 'diario/lunes.md', quote: 'remolacha-cita', text: 'remolacha-pedido' }, es);
  const encTok = (await srv.ask('POST', '/tokens', { name: 'ia' }, es)).json.token;
  const encLink = (await srv.ask('POST', '/links', { path: 'diario/lunes.md' }, es)).json.token;
  await srv.stop();
  check('sin DATA_KEY todo sigue en claro en el disco', ['remolacha-uno', 'remolacha-dos', 'remolacha-cita', 'remolacha-pedido'].every((w) => onDisk(encDir, w)));
  srv = await boot(encDir, { DATA_KEY: K1 });
  check('con DATA_KEY arranca y cifra lo que estaba en claro', srv.up() && /se cifraron 3 filas/.test(srv.log()), srv.log());
  const encTool = async (name, args) => (await srv.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, encTok)).json.result.content[0].text;
  const whole = async () => {
    const list = (await srv.ask('GET', '/notes', undefined, es)).json; const note = (await srv.ask('GET', '/notes/' + encodeURIComponent('diario/lunes.md'), undefined, es)).json;
    const vers = (await srv.ask('GET', '/versions/' + encodeURIComponent('diario/lunes.md'), undefined, es)).json; const ver = (await srv.ask('GET', '/version/' + vers[0].id, undefined, es)).json;
    const coms = (await srv.ask('GET', '/comments?path=' + encodeURIComponent('diario/lunes.md') + '&all=1', undefined, es)).json;
    return { size: list.find((n) => n.path === 'diario/lunes.md').size, text: note.text, vsize: vers[0].size, vtext: ver.text, quote: coms[0].quote, com: coms[0].text, reply: coms[0].reply,
      search: (await srv.ask('GET', '/search?q=remolacha-dos', undefined, es)).json.map((r) => r.path + ':' + r.hits.length).join(), mcp: await encTool('read_note', { path: 'diario/lunes.md' }),
      found: /diario\/lunes\.md/.test(await encTool('search_notes', { query: 'remolacha-dos' })), pub: (await srv.ask('GET', '/public/' + encLink)).json.text };
  };
  const T2 = '# Lunes\n\nremolacha-dos en claro, más larga.'; const T1 = '# Lunes\n\nremolacha-uno en claro.';
  const sameAll = (w) => w.text === T2 && w.size === T2.length && w.vtext === T1 && w.vsize === T1.length && w.quote === 'remolacha-cita' && w.com === 'remolacha-pedido' && w.search === 'diario/lunes.md:1' && w.mcp === T2 && w.found && w.pub === T2;
  let w = await whole();
  check('cifrado: notas, historial, comentarios, búsqueda, MCP, enlace público y tamaños responden igual', sameAll(w), w);
  const comId = (await srv.ask('GET', '/comments', undefined, es)).json[0].id;
  await encTool('resolve_comment', { id: comId, reply: 'remolacha-respuesta' });
  await srv.ask('PUT', '/notes/nueva.md', { text: 'remolacha-nueva, escrita ya con la clave.' }, es);
  await srv.ask('PUT', '/notes/nueva.md', { text: 'remolacha-nueva, segunda versión.' }, es);
  const grande = await srv.ask('PUT', '/notes/grande.md', { text: 'ñ'.repeat(524289) }, es);
  check('cifrado: el límite de 1 MB se mide sobre el texto en claro', grande.status === 413 && (await srv.ask('PUT', '/notes/justa.md', { text: 'a'.repeat(1024 * 1024) }, es)).status === 200, grande.json);
  await srv.stop();
  check('cifrado: en el disco no queda nada legible, ni lo migrado ni lo nuevo', !['remolacha-uno', 'remolacha-dos', 'remolacha-cita', 'remolacha-pedido', 'remolacha-respuesta', 'remolacha-nueva'].some((x) => onDisk(encDir, x)) && onDisk(encDir, 'enc1:'));
  srv = await boot(encDir, { DATA_KEY: K1 });
  w = await whole();
  const reply = (await srv.ask('GET', '/comments?path=' + encodeURIComponent('diario/lunes.md') + '&all=1', undefined, es)).json[0].reply;
  check('cifrado: la migración es idempotente, al volver a arrancar no toca nada y todo se lee', srv.up() && !/se cifraron/.test(srv.log()) && sameAll(w) && reply === 'remolacha-respuesta' && (await srv.ask('GET', '/notes/nueva.md', undefined, es)).json.text === 'remolacha-nueva, segunda versión.', [srv.log(), w, reply]);
  await srv.stop();
  const before = fs.readFileSync(path.join(encDir, 'mdtools.db'));
  const refuses = async (extra, re) => { const s = await boot(encDir, extra); const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('sigue'), 4000))]); if (code === 'sigue') await s.stop(); return code === 1 && !s.up() && re.test(s.log()) ? true : [code, s.log()]; };
  const sinClave = await refuses({}, /falta DATA_KEY/); const otraClave = await refuses({ DATA_KEY: K2 }, /no es la clave/); const malFormada = await refuses({ DATA_KEY: 'corta' }, /32 bytes/);
  check('cifrado: sin la clave el servidor no arranca y lo dice', sinClave === true, sinClave);
  check('cifrado: con otra clave tampoco arranca', otraClave === true, otraClave);
  check('cifrado: una clave mal formada se rechaza al arrancar', malFormada === true, malFormada);
  check('cifrado: los arranques rechazados no tocan la base', fs.readFileSync(path.join(encDir, 'mdtools.db')).equals(before));
  srv = await boot(encDir, { DATA_KEY: K1 });
  check('cifrado: con la clave original vuelve a andar', srv.up() && (await srv.ask('GET', '/notes/nueva.md', undefined, es)).json.text === 'remolacha-nueva, segunda versión.');
  await srv.stop(); wipe(encDir);

  // ---------- El uso del plan gratis, dicho a la IA ----------
  // El tope sale de FREE_NOTES: con 10 y con 25 los textos dicen ese número, y una cuenta paga no recibe ninguno.
  for (const N of [10, 25]) {
    const uDir = tmp(); const us = await boot(uDir, { FREE_NOTES: String(N), APP_URL: 'https://app.ejemplo.test/src/app.html' });
    const PLANS = 'https://app.ejemplo.test/src/app.html#lmd-plans';
    const fses = await us.enter('uso@ejemplo.test'); const pses = await us.enter('paga-uso@ejemplo.test', true);
    const ftok = (await us.ask('POST', '/tokens', { name: 'IA' }, fses)).json.token; const ptok = (await us.ask('POST', '/tokens', { name: 'IA' }, pses)).json.token;
    const said = [];
    const tool = async (tok, name, args) => { const r = await us.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; const parts = c.content.map((x) => x.text); if (tok === ftok) said.push(...parts); return { parts, text: parts.join('\n'), err: !!c.isError }; };
    const facc = (await us.ask('GET', '/account', undefined, fses)).json; const pacc = (await us.ask('GET', '/account', undefined, pses)).json;
    check('uso (' + N + '): la cuenta trae el tope del plan gratis, también la paga', facc.limit === N && facc.free_notes === N && pacc.limit === null && pacc.free_notes === N, [facc.limit, facc.free_notes, pacc.limit, pacc.free_notes]);
    const l0 = await tool(ftok, 'list_notes');
    check('uso (' + N + '): list_notes deja ver el uso del plan, aparte de la lista', l0.parts.length === 2 && JSON.parse(l0.parts[0]).length === 0 && l0.parts[1] === 'Free plan: 0 of ' + N + ' notes used, ' + N + ' left.', l0.parts);
    const w1 = await tool(ftok, 'write_note', { path: 'p/README.md', text: '# Uno' });
    const w1b = await tool(ftok, 'write_note', { path: 'p/README.md', text: '# Uno, otra vez' });
    const e1 = await tool(ftok, 'edit_note', { path: 'p/README.md', old_text: 'otra vez', new_text: 'de nuevo' });
    check('uso (' + N + '): write_note dice el uso al crear, en una línea, y no al editar', !w1.err && w1.text.endsWith('\nFree plan: 1 of ' + N + ' notes used.') && !/Tell the person/.test(w1.text) && !w1b.err && !/Free plan/.test(w1b.text) && !e1.err && !/Free plan/.test(e1.text), [w1.text, w1b.text, e1.text]);
    const a1 = await tool(ftok, 'append_note', { path: 'p/log.md', text: 'hoy' }); const a1b = await tool(ftok, 'append_note', { path: 'p/log.md', text: 'mañana' });
    const b1 = await tool(ftok, 'create_board', { path: 'p/board.md' }); const b1b = await tool(ftok, 'create_board', { path: 'p/board.md', title: 'Otro' });
    const c1 = await tool(ftok, 'add_card', { path: 'p/board.md', title: 'Una tarea' });
    const m1 = await tool(ftok, 'move_note', { from: 'p/log.md', to: 'p/registro.md' });
    check('uso (' + N + '): append_note y create_board lo dicen si crearon la nota; agregar, sumar un tablero o una tarjeta y mover, no', a1.text.endsWith('\nFree plan: 2 of ' + N + ' notes used.') && !/Free plan/.test(a1b.text) && JSON.parse(b1.text).plan === 'Free plan: 3 of ' + N + ' notes used.' && !b1b.err && JSON.parse(b1b.text).plan === undefined && !c1.err && !/Free plan/.test(c1.text) && !m1.err && !/Free plan/.test(m1.text), [a1.text, a1b.text, b1.text, b1b.text, c1.text, m1.text]);
    for (let i = 3; i < N - 3; i++) await us.ask('PUT', '/notes/relleno-' + i + '.md', { text: 'x' }, fses);
    const low2 = await tool(ftok, 'write_note', { path: 'p/a.md', text: 'a' }); const low1 = await tool(ftok, 'write_note', { path: 'p/b.md', text: 'b' }); const low0 = await tool(ftok, 'write_note', { path: 'p/c.md', text: 'c' });
    const tell = ' The paid plan has no note limit: ' + PLANS;
    check('uso (' + N + '): cuando quedan 2 o menos, la línea le pide a la IA que avise, con cuántas quedan y el enlace a los planes',
      low2.text.endsWith('\nFree plan: ' + (N - 2) + ' of ' + N + ' notes used, 2 left. Tell the person that the free plan is about to fill up and that 2 notes are left.' + tell) &&
      low1.text.endsWith('\nFree plan: ' + (N - 1) + ' of ' + N + ' notes used, 1 left. Tell the person that the free plan is about to fill up and that 1 note is left.' + tell) &&
      low0.text.endsWith('\nFree plan: ' + N + ' of ' + N + ' notes used, none left. Tell the person that the free plan is full and that the next new note will not be saved.' + tell), [low2.text, low1.text, low0.text]);
    const over = await tool(ftok, 'write_note', { path: 'p/d.md', text: 'd' }); const overB = await tool(ftok, 'create_board', { path: 'p/otro.md' });
    const overHttp = await us.ask('PUT', '/notes/e.md', { text: 'e' }, fses); const still = await tool(ftok, 'edit_note', { path: 'p/a.md', old_text: 'a', new_text: 'a, editada' });
    const FULL = 'The free plan holds ' + N + ' notes and this account has ' + N + '. Nothing was saved. Existing notes can still be read and edited. To add a new one, delete a note or move to the paid plan, which has no note limit: ' + PLANS;
    check('uso (' + N + '): en el tope el error dice qué pasó y qué hacer, y que no borre notas por su cuenta', over.err && over.text === 'Error: ' + FULL + ' Tell the person what happened and give them that link, or offer to make room. Do not delete notes on your own.' && overB.err && overB.text === over.text && !still.err, [over.text, overB.text, still.text]);
    check('uso (' + N + '): el mismo tope por la app trae el número y cuántas hay, sin la parte que es para la IA', overHttp.status === 402 && overHttp.json.error === 'note_limit' && overHttp.json.message === FULL && overHttp.json.limit === N && overHttp.json.notes === N, overHttp.json);
    const lf = await tool(ftok, 'list_notes'); const g = await tool(ftok, 'get_guide');
    check('uso (' + N + '): la lista y la guía dicen cuánto lugar queda, y la guía qué crear primero si no entra todo', lf.parts[1] === 'Free plan: ' + N + ' of ' + N + ' notes used, none left.' && JSON.parse(lf.parts[0]).length === N &&
      g.text.includes('Before you create the structure, check how much room the plan has: on the free plan list_notes says it. Right now: ' + N + ' of ' + N + ' notes used, none left. If the whole structure does not fit, create README.md, board.md and pending.md first and tell the person which notes were left out.'), [lf.parts[1], g.text.slice(0, 1800)]);
    const nums = said.join('\n').match(/(?:of|holds) \d+ notes/g) || [];
    check('uso (' + N + '): todos los textos dicen ' + N + ', y ninguno lleva signos de admiración, rayas ni castellano', nums.length > 8 && nums.every((x) => x === 'of ' + N + ' notes' || x === 'holds ' + N + ' notes') && said.filter((x) => /Free plan|free plan/.test(x)).every((x) => !/[áéíóúñ¡!—–]/.test(x)), nums);
    const pl0 = await tool(ptok, 'list_notes'); const pw = await tool(ptok, 'write_note', { path: 'p/README.md', text: '# Paga' }); const pa = await tool(ptok, 'append_note', { path: 'p/log.md', text: 'hoy' });
    const pb = await tool(ptok, 'create_board', { path: 'p/board.md' }); const pg = await tool(ptok, 'get_guide');
    for (let i = 0; i < N; i++) await us.ask('PUT', '/notes/mas-' + i + '.md', { text: 'x' }, pses);
    const pw2 = await tool(ptok, 'write_note', { path: 'p/pasado.md', text: 'x' });
    check('uso (' + N + '): una cuenta paga no recibe ninguna de esas líneas', pl0.parts.length === 1 && [pw, pa, pb, pw2].every((x) => !x.err && !/free plan/i.test(x.text)) && JSON.parse(pb.text).plan === undefined && !/Right now/.test(pg.text) && pg.text.includes('create README.md, board.md and pending.md first'), [pl0.parts, pw.text, pa.text, pb.text, pw2.text]);
    await us.stop(); wipe(uDir);
  }

  // ---------- Agentes ----------
  // Los tiempos van acelerados: sin señal a los 1,5 s, se va a los 3,5 s, terminado queda 1,2 s, historial 9 s.
  {
    const aDir = tmp(); const STALE = 1500; const GONE = 3500; const DONE = 1200; const HIST = 9000;
    const ag = await boot(aDir, { DATA_KEY: K1, FREE_AGENTS: '2', AGENT_STALE_MS: String(STALE), AGENT_GONE_MS: String(GONE), AGENT_DONE_MS: String(DONE), AGENT_HISTORY_MS: String(HIST), APP_URL: 'https://app.ejemplo.test/src/app.html' });
    const PLANS = 'https://app.ejemplo.test/src/app.html#lmd-plans'; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fses = await ag.enter('agentes@ejemplo.test'); const pses = await ag.enter('paga-agentes@ejemplo.test', true);
    const ftok = (await ag.ask('POST', '/tokens', { name: 'IA' }, fses)).json.token; const ptok = (await ag.ask('POST', '/tokens', { name: 'IA paga' }, pses)).json.token;
    const said = [];
    const tool = async (tok, name, args) => { const r = await ag.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, tok); const c = r.json.result; const parts = c.content.map((x) => x.text); said.push(...parts); let v = null; try { v = JSON.parse(parts[0]); } catch (e) { /* texto */ } return { parts, text: parts.join('\n'), err: !!c.isError, v }; };
    const seenBy = async (ses) => (await ag.ask('GET', '/agents', undefined, ses)).json; const J = (v) => JSON.stringify(v);
    const byId = (list, id) => (list || []).find((x) => x.id === id);

    const defs = (await ag.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ftok)).json.result.tools;
    const AG = ['start_agent', 'update_agent', 'end_agent', 'list_agents'];
    check('agentes: las cuatro herramientas están en la lista, y las demás aceptan agent_id', AG.every((n) => defs.some((d) => d.name === n)) && defs.filter((d) => !AG.includes(d.name)).every((d) => d.inputSchema.properties.agent_id && d.inputSchema.properties.agent_id.type === 'string') && defs.filter((d) => AG.includes(d.name)).every((d) => !d.inputSchema.properties.agent_id),
      defs.map((d) => d.name));
    check('agentes: sin sesión no se listan, y un token no sirve para la app', (await ag.ask('GET', '/agents')).status === 401 && (await ag.ask('GET', '/agents', undefined, ftok)).status === 401);

    // Plan gratis: dos a la vez
    const a1 = await tool(ftok, 'start_agent', { name: '  tests ', task: 'Run the remolacha-agente suite\nand report' });
    check('agentes: start_agent devuelve el id, el nombre limpio, la tarea en una línea y cómo seguir', !a1.err && /^ag_[\w-]{6,}$/.test(a1.v.id) && a1.v.name === 'tests' && a1.v.task === 'Run the remolacha-agente suite and report' && a1.v.status === 'working' && a1.v.note.includes('agent_id: "' + a1.v.id + '"') && /After 2 seconds without a call it shows as silent, and after 4 seconds it is removed\./.test(a1.v.note), a1.v);
    check('agentes: en el plan gratis la respuesta dice cuántos hay de cuántos', a1.v.plan === 'Free plan: 1 of 2 agents active at once, and no history.', a1.v.plan);
    const a2 = await tool(ftok, 'start_agent', { name: 'tests', task: 'Second runner' });
    check('agentes: dos con el mismo nombre no se confunden, al segundo se le suma un número', !a2.err && a2.v.name === 'tests 2' && a2.v.id !== a1.v.id && a2.v.plan === 'Free plan: 2 of 2 agents active at once, and no history.', a2.v);
    const a3 = await tool(ftok, 'start_agent', { name: 'docs', task: 'Write the docs' });
    check('agentes: el tercero no entra en el plan gratis, y el error dice qué pasó, que se le avise a la persona y el enlace a los planes', a3.err && a3.text.startsWith('Error: Free plan: 2 agents can be active at once and this account has 2. This one was not registered.') && /Tell the person what happened/.test(a3.text) && a3.text.endsWith('keeps the history of the last 9 seconds: ' + PLANS), a3.text);
    let fv = await seenBy(fses);
    check('agentes: la app recibe los dos, con el token que los anotó, el tope del plan y sin historial', fv.agents.length === 2 && fv.agents.map((x) => x.name).join() === 'tests,tests 2' && fv.agents.every((x) => x.status === 'working' && x.token === 'IA' && x.team === false && x.created <= fv.now) && fv.limit === 2 && fv.free_agents === 2 && fv.history === null && fv.stale_ms === STALE, fv);
    check('agentes: los de una cuenta no los ve otra', (await seenBy(pses)).agents.length === 0);
    const bad = [await tool(ftok, 'start_agent', { task: 'x' }), await tool(ftok, 'start_agent', { name: 'x' }), await tool(ftok, 'update_agent', { id: a1.v.id, card: 'abc' }), await tool(ftok, 'update_agent', { id: a1.v.id, path: 'no/existe.md' }), await tool(ftok, 'update_agent', { id: 'ag_noexiste', task: 'x' }), await tool(ftok, 'update_agent', { id: a1.v.id, status: 'sleeping' }), await tool(ftok, 'update_agent', { id: a1.v.id, status: 'waiting' })];
    check('agentes: lo mal armado se rechaza diciendo qué falta', bad.every((x) => x.err) && /name is a short name/.test(bad[0].text) && /task is one line/.test(bad[1].text) && /card needs path/.test(bad[2].text) && /There is no note at no\/existe\.md/.test(bad[3].text) && /There is no agent with that id/.test(bad[4].text) && /working, waiting or done/.test(bad[5].text) && /needs says in one line/.test(bad[6].text), bad.map((x) => x.text));
    const w2 = await tool(ftok, 'update_agent', { id: a2.v.id, needs: 'The staging password' });
    fv = await seenBy(fses);
    check('agentes: decir qué necesita lo deja esperando, y la app lo ve', !w2.err && w2.v.status === 'waiting' && w2.v.needs === 'The staging password' && byId(fv.agents, a2.v.id).status === 'waiting' && byId(fv.agents, a2.v.id).needs === 'The staging password', [w2.v, fv.agents]);
    const w1 = await tool(ftok, 'update_agent', { id: a1.v.id, task: 'Fixing two failures' });
    check('agentes: update_agent cambia la tarea', !w1.err && w1.v.task === 'Fixing two failures' && w1.v.status === 'working', w1.v);

    // Latido: el que manda agent_id sigue; el que no, queda sin señal
    await wait(900); const beat = await tool(ftok, 'list_notes', { agent_id: a1.v.id });
    await wait(900); const beat2 = await tool(ftok, 'list_folders', { agent_id: a1.v.id });
    const l1 = await tool(ftok, 'list_agents');
    check('agentes: una llamada con agent_id es señal de vida, y no cambia lo que la herramienta responde', !beat.err && !beat2.err && beat.parts.length === 2 && byId(l1.v.agents, a1.v.id).status === 'working', [beat.parts, l1.v]);
    check('agentes: sin señales pasa a silent, y lo dice igual la app', byId(l1.v.agents, a2.v.id).status === 'silent' && byId((await seenBy(fses)).agents, a2.v.id).status === 'silent', l1.v);
    const ghost = await tool(ftok, 'list_notes', { agent_id: 'ag_noexiste' });
    check('agentes: con un agent_id que ya no está, la respuesta lo avisa aparte', !ghost.err && ghost.parts.length === 3 && /is not registered any more/.test(ghost.parts[2]) && /start_agent/.test(ghost.parts[2]), ghost.parts);
    const a4 = await tool(ftok, 'start_agent', { name: 'docs', task: 'Write the docs', parent: a1.v.id });
    check('agentes: uno sin señal no ocupa lugar en el tope, y un subagente lleva a su padre', !a4.err && a4.v.parent === a1.v.id && a4.v.plan === 'Free plan: 2 of 2 agents active at once, and no history.', a4);
    for (let i = 0; i < 3; i++) { await wait(700); await tool(ftok, 'list_notes', { agent_id: a1.v.id }); await tool(ftok, 'update_agent', { id: a4.v.id, task: 'Write the docs, part ' + i }); }
    fv = await seenBy(fses); const goneUp = await tool(ftok, 'update_agent', { id: a2.v.id, task: 'x' });
    check('agentes: pasado el tiempo sin señales se borra solo, y los que siguieron dando señales quedan', !byId(fv.agents, a2.v.id) && byId(fv.agents, a1.v.id).status === 'working' && byId(fv.agents, a4.v.id).parent === a1.v.id && fv.history === null && goneUp.err && /removed after 4 seconds without a sign of life/.test(goneUp.text), [fv, goneUp.text]);
    const e1 = await tool(ftok, 'end_agent', { id: a4.v.id, result: 'Docs written' });
    fv = await seenBy(fses); const again = await tool(ftok, 'update_agent', { id: a4.v.id, task: 'x' });
    check('agentes: end_agent lo deja terminado y a la vista un rato, y ya no se puede cambiar', !e1.err && e1.v.status === 'done' && e1.v.result === 'Docs written' && /stays visible for 1 second/.test(e1.v.note) && byId(fv.agents, a4.v.id).status === 'done' && byId(fv.agents, a4.v.id).result === 'Docs written' && again.err && /already ended/.test(again.text), [e1.v, again.text]);
    await wait(DONE + 500); await tool(ftok, 'list_notes', { agent_id: a1.v.id });
    const fh = await tool(ftok, 'list_agents', { history: true });
    check('agentes: en el plan gratis el terminado se va sin dejar historial, y pedirlo dice de qué plan es', !fh.err && fh.v.agents.length === 1 && fh.v.agents[0].id === a1.v.id && fh.v.history === undefined && fh.v.history_note.endsWith(PLANS) && fh.v.plan === 'Free plan: 1 of 2 agents active at once, and no history.' && (await seenBy(fses)).agents.length === 1, fh.v);
    const fg = await tool(ftok, 'get_guide');
    check('agentes: la guía dice cuándo anotarse, que cada subagente se anota y cierra, y el tope del plan gratis', /## Agents/.test(fg.text) && /split work between subagents/.test(fg.text) && /Each subagent registers itself with its own name/.test(fg.text) && /Call end_agent when the task is done/.test(fg.text) && fg.text.includes('The free plan shows 2 agents at once.') && fg.text.includes('After 2 seconds without one the agent shows as silent, and after 4 seconds it is removed.'), fg.text.slice(fg.text.indexOf('## Agents'), fg.text.indexOf('## Agents') + 900));

    // Plan pago: sin tope, con la tarjeta enlazada y con historial
    const ev = { text: '' }; const ctrl = new AbortController();
    await tool(ptok, 'create_board', { path: 'p/board.md' });
    const card = (await tool(ptok, 'add_card', { path: 'p/board.md', title: 'Build the importer' })).v.card.id;
    const acc = (await ag.ask('GET', '/account', undefined, pses)).json;
    const sse = await fetch('http://127.0.0.1:' + new URL(acc.mcp_url).port + '/events?path=' + encodeURIComponent('p/board.md'), { headers: { authorization: 'Bearer ' + pses }, signal: ctrl.signal }).catch(() => null);
    if (sse && sse.ok) (async () => { const rd = sse.body.getReader(); const d = new TextDecoder(); try { for (;;) { const x = await rd.read(); if (x.done) break; ev.text += d.decode(x.value); } } catch (e) { /* se cortó */ } })();
    const many = []; for (const n of ['uno', 'dos', 'tres', 'cuatro']) many.push(await tool(ptok, 'start_agent', { name: n, task: 'Tarea ' + n }));
    check('agentes: el plan pago no tiene tope ni recibe líneas del plan', many.every((x) => !x.err && x.v.plan === undefined) && (await seenBy(pses)).agents.length === 4 && (await seenBy(pses)).limit === null, many.map((x) => x.text));
    const noCard = await tool(ptok, 'start_agent', { name: 'builder', task: 'Importer', path: 'p/board.md', card: 'zzzz' });
    const b1 = await tool(ptok, 'start_agent', { name: 'builder', task: 'Importer', path: 'p/board.md', card, parent: many[0].v.id });
    const cardNow = async () => (await tool(ptok, 'list_boards', { path: 'p/board.md' })).v.boards[0].columns.flatMap((c) => c.cards.map((k) => Object.assign({ column: c.column }, k))).find((k) => k.id === card);
    let pv = await seenBy(pses);
    check('agentes: una tarjeta que no existe no anota nada y lo dice', noCard.err && /There is no card with the id zzzz in p\/board\.md/.test(noCard.text) && pv.agents.filter((x) => x.name === 'builder').length === 1, noCard.text);
    check('agentes: con una tarjeta enlazada, su campo agent lleva el nombre y la app recibe la nota y la tarjeta', !b1.err && b1.v.path === 'p/board.md' && b1.v.card === card && b1.v.url === 'https://app.ejemplo.test/src/app.html?f=cloud%2Fp%2Fboard.md' && (await cardNow()).fields.agent === 'builder' && byId(pv.agents, b1.v.id).path === 'p/board.md' && byId(pv.agents, b1.v.id).card === card && byId(pv.agents, b1.v.id).parent === many[0].v.id, [b1.v, await cardNow(), byId(pv.agents, b1.v.id)]);
    await wait(300);
    check('agentes: quien tiene la nota abierta recibe el aviso por el canal de siempre', /"type":"agents"/.test(ev.text), ev.text.slice(0, 300));
    const seen0 = byId(pv.agents, b1.v.id).seen; await wait(200);
    const mv = await tool(ptok, 'move_card', { path: 'p/board.md', id: card, column: 'In progress' });
    pv = await seenBy(pses);
    check('agentes: mover su tarjeta también es señal de vida', !mv.err && byId(pv.agents, b1.v.id).seen > seen0 && byId(pv.agents, many[1].v.id).seen === byId(pv.agents, many[1].v.id).created, [seen0, byId(pv.agents, b1.v.id)]);
    const e2 = await tool(ptok, 'end_agent', { id: b1.v.id, result: 'Importer merged' });
    const kept = await cardNow();
    check('agentes: al terminar no se toca la tarjeta ni su campo', !e2.err && /Its card was not touched/.test(e2.v.note) && kept.fields.agent === 'builder' && kept.column === 'In progress', [e2.v, kept]);
    // uno sigue dando señales; los otros tres se pierden
    for (let i = 0; i < 6; i++) { await wait(700); await tool(ptok, 'list_notes', { agent_id: many[0].v.id }); }
    pv = await seenBy(pses); const ph = await tool(ptok, 'list_agents', { history: true });
    check('agentes: en el plan pago el que terminó y los que se perdieron quedan en el historial, fuera de la lista en vivo', pv.agents.length === 1 && pv.agents[0].id === many[0].v.id && pv.history.length === 4 && byId(pv.history, b1.v.id).status === 'done' && byId(pv.history, b1.v.id).result === 'Importer merged' && pv.history.filter((x) => x.status === 'lost').length === 3 && pv.history_hours === 0 &&
      !ph.err && ph.v.agents.length === 1 && ph.v.history.length === 4 && ph.v.history.some((x) => x.status === 'lost') && ph.v.history_note === undefined && ph.v.plan === undefined, [pv, ph.v]);
    for (let i = 0; i < 12; i++) { await wait(700); await tool(ptok, 'list_notes', { agent_id: many[0].v.id }); }
    pv = await seenBy(pses);
    check('agentes: el historial también vence', pv.agents.length === 1 && pv.history.length === 0, pv);

    // Token de equipo: los agentes son del espacio, y los ve cada miembro
    const team = await ag.ask('POST', '/admin/team', { email: 'paga-agentes@ejemplo.test', seats: 3 }, undefined, { 'x-admin-key': 'clave-de-prueba' });
    const bot = (await ag.ask('POST', '/team/tokens', { name: 'bot', write: true }, pses)).json.token;
    const space = (await ag.ask('GET', '/account', undefined, pses)).json.team.mine.space;
    await tool(bot, 'write_note', { path: 'equipo.md', text: '# Equipo' });
    const tb = await tool(bot, 'start_agent', { name: 'team bot', task: 'Sync the roadmap', path: 'equipo.md' });
    pv = await seenBy(pses); const mineTeam = pv.agents.find((x) => x.id === tb.v.id);
    check('agentes: con un token de equipo el agente es del espacio: lo ve un miembro, con la ruta que abre la app', team.status === 200 && !tb.err && tb.v.path === 'equipo.md' && !!mineTeam && mineTeam.team === true && mineTeam.token === '' && mineTeam.path === '~' + space + '/equipo.md' && !(await seenBy(fses)).agents.some((x) => x.id === tb.v.id), [tb.v, mineTeam, space]);
    // Un token limitado a una carpeta: ve los suyos y los que trabajan dentro de su carpeta, nada más.
    const stok = (await ag.ask('POST', '/tokens', { name: 'solo p', folder: 'p/' }, pses)).json.token;
    await tool(ptok, 'write_note', { path: 'otra/nota.md', text: '# Otra' });
    const outA = await tool(ptok, 'start_agent', { name: 'afuera', task: 'Trabaja fuera de la carpeta', path: 'otra/nota.md' }); const inA = await tool(ptok, 'start_agent', { name: 'adentro', task: 'Trabaja en la carpeta', path: 'p/board.md' });
    const ownA = await tool(stok, 'start_agent', { name: 'propio', task: 'Del token limitado' }); const sl = await tool(stok, 'list_agents'); const sOut = await tool(stok, 'update_agent', { id: outA.v.id, task: 'x' }); const sPath = await tool(stok, 'start_agent', { name: 'x', task: 'x', path: 'otra/nota.md' });
    check('agentes: un token limitado a una carpeta ve los suyos y los de su carpeta, y no toca ni enlaza lo de afuera', !outA.err && !inA.err && !ownA.err && J(sl.v.agents.map((x) => x.name).sort()) === J(['adentro', 'propio']) && sOut.err && /There is no agent with that id/.test(sOut.text) && sPath.err && /only reaches the folder p\//.test(sPath.text) && (await tool(ptok, 'list_agents')).v.agents.length >= 4, [sl.v, sOut.text, sPath.text]);
    const cross = await tool(ptok, 'update_agent', { id: tb.v.id, task: 'x' });
    check('agentes: el token de una persona no cambia los del equipo', cross.err && /There is no agent with that id/.test(cross.text), cross.text);
    ctrl.abort();

    check('agentes: lo que lee la IA va en inglés, sin signos de admiración ni rayas', said.filter((x) => /agent/i.test(x) && !x.startsWith('# Working in SharpMD')).every((x) => !/[áéíóúñ¡!—–]/.test(x)), said.filter((x) => /[áéíóúñ¡!—–]/.test(x)).slice(0, 3));
    await ag.stop();
    const rawDb = ['mdtools.db', 'mdtools.db-wal'].map((f) => { try { return fs.readFileSync(path.join(aDir, f)).toString('latin1'); } catch (e) { return ''; } }).join('');
    const adb = new DatabaseSync(path.join(aDir, 'mdtools.db'), { readOnly: true }); const arows = adb.prepare('SELECT name, task, e FROM agents').all(); adb.close();
    check('agentes: con DATA_KEY el nombre y la tarea se guardan cifrados', arows.length >= 2 && arows.every((r) => r.e === 1 && r.name.startsWith('enc1:') && r.task.startsWith('enc1:')) && !rawDb.includes('remolacha-agente') && !rawDb.includes('Sync the roadmap'), arows.length);
    wipe(aDir);

    // El tope sale de FREE_AGENTS: con otro número, los textos dicen ese
    const a3Dir = tmp(); const ag3 = await boot(a3Dir, { FREE_AGENTS: '3' });
    const s3 = await ag3.enter('tres@ejemplo.test'); const t3 = (await ag3.ask('POST', '/tokens', { name: 'IA' }, s3)).json.token; const out3 = [];
    for (let i = 0; i < 4; i++) { const r = await ag3.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'start_agent', arguments: { name: 'n' + i, task: 't' } } }, t3); out3.push(r.json.result); }
    const lim3 = out3[3].content[0].text; const g3 = (await ag3.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_guide', arguments: {} } }, t3)).json.result.content[0].text;
    check('agentes: con FREE_AGENTS=3 entran tres y los textos dicen tres, con los tiempos de fábrica', out3.slice(0, 3).every((x) => !x.isError) && out3[3].isError && /Free plan: 3 agents can be active at once and this account has 3\./.test(lim3) && /history of the last 24 hours/.test(lim3) && g3.includes('The free plan shows 3 agents at once.') && g3.includes('After 5 minutes without one the agent shows as silent, and after 30 minutes it is removed.') && (await ag3.ask('GET', '/agents', undefined, s3)).json.history_hours === 24, [lim3]);
    await ag3.stop(); wipe(a3Dir);
  }

  // ---------- Papelera ----------
  {
  const trDir = tmp();
  let tr = await boot(trDir, { DATA_KEY: K1, FREE_NOTES: '3', SHARE_FREE: '1' });
  const ts = await tr.enter('papelera@ejemplo.test'); const tp = await tr.enter('paga@ejemplo.test', true); const tx = await tr.enter('ajena@ejemplo.test');
  const bin = async (who) => (await tr.ask('GET', '/trash', undefined, who)).json;
  for (const n of ['uno', 'dos', 'tres']) await tr.ask('PUT', '/notes/' + n + '.md', { text: 'rabanito-' + n }, ts);
  await tr.ask('PUT', '/notes/uno.md', { text: 'rabanito-uno, segunda' }, ts);
  const tlink = (await tr.ask('POST', '/links', { path: 'uno.md' }, ts)).json.token;
  await tr.ask('POST', '/shares', { path: 'uno.md', email: 'ajena@ejemplo.test', role: 'view' }, ts);
  const del1 = await tr.ask('DELETE', '/notes/uno.md', undefined, ts);
  const b1 = await bin(ts);
  check('papelera: eliminar una nota la manda a la papelera, con su vencimiento a 30 días', del1.status === 200 && del1.json.trash === true && b1.length === 1 && b1[0].path === 'uno.md' && Math.abs(b1[0].expires - b1[0].deleted - 30 * 86400000) < 1000 && b1[0].text === undefined, [del1.json, b1]);
  check('papelera: lo eliminado no se lista, no se lee, no se busca, no queda compartido ni publicado', !(await tr.ask('GET', '/notes', undefined, ts)).json.some((n) => n.path === 'uno.md') && (await tr.ask('GET', '/notes/uno.md', undefined, ts)).status === 404 &&
    (await tr.ask('GET', '/search?q=rabanito-uno', undefined, ts)).json.length === 0 && (await tr.ask('GET', '/public/' + tlink)).status === 404 && (await tr.ask('GET', '/shared', undefined, tx)).json.length === 0 && (await tr.ask('GET', '/account', undefined, ts)).json.notes === 2);
  check('papelera: lo eliminado no cuenta para el tope del plan gratis', (await tr.ask('PUT', '/notes/cuatro.md', { text: 'x' }, ts)).status === 200);
  const full = await tr.ask('POST', '/trash/' + b1[0].id + '/restore', {}, ts);
  check('papelera: restaurar respeta el tope del plan gratis', full.status === 402 && full.json.error === 'note_limit' && (await bin(ts)).length === 1, full.json);
  await tr.ask('DELETE', '/notes/cuatro.md', undefined, ts);
  const back = await tr.ask('POST', '/trash/' + b1[0].id + '/restore', {}, ts);
  const again = (await tr.ask('GET', '/notes/uno.md', undefined, ts)).json;
  check('papelera: restaurar devuelve la nota a su ruta con su texto, y sale de la papelera', back.status === 200 && back.json.path === 'uno.md' && again.text === 'rabanito-uno, segunda' && again.rev === 3 && !(await bin(ts)).some((x) => x.path === 'uno.md'), [back.json, again]);
  check('papelera: lo restaurado no vuelve publicado ni compartido', (await tr.ask('GET', '/public/' + tlink)).status === 404 && (await tr.ask('GET', '/shared', undefined, tx)).json.length === 0);
  // Choque de nombres: se elimina, se crea otra en la misma ruta y se restaura la primera.
  await tr.ask('DELETE', '/notes/dos.md', undefined, ts);
  await tr.ask('PUT', '/notes/dos.md', { text: 'la nueva' }, ts);
  const twin = await tr.ask('POST', '/trash/' + (await bin(ts)).find((x) => x.path === 'dos.md').id + '/restore', {}, ts);
  check('papelera: si la ruta ya está ocupada, se restaura con otro nombre', twin.status === 402 || (twin.status === 200 && twin.json.path === 'dos (2).md'), twin.json);
  // Con plan pago: historial, MCP y el choque de nombres sin tope de notas.
  await tr.ask('PUT', '/notes/' + encodeURIComponent('proy/plan.md'), { text: 'apio-plan' }, tp);
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp);
  await tr.ask('PUT', '/notes/' + encodeURIComponent('proy/plan.md'), { text: 'el plan nuevo' }, tp);
  const ptok = (await tr.ask('POST', '/tokens', { name: 'IA' }, tp)).json.token;
  const ptool = async (name, args) => (await tr.ask('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ptok)).json.result.content[0].text;
  check('papelera: la IA no ve lo que está en la papelera', !/apio-plan/.test(await ptool('search_notes', { query: 'apio' })) && !/apio-plan/.test(await ptool('read_note', { path: 'proy/plan.md' })) && JSON.parse(await ptool('list_notes', {})).length === 1);
  const pid = (await bin(tp))[0].id;
  check('papelera: la de otra cuenta no se ve, no se restaura ni se borra', (await bin(tx)).length === 0 && (await tr.ask('POST', '/trash/' + pid + '/restore', {}, tx)).status === 404 && (await tr.ask('DELETE', '/trash/' + pid, undefined, tx)).status === 404 &&
    (await tr.ask('GET', '/trash?o=2', undefined, tx)).status === 403 && (await tr.ask('DELETE', '/trash', undefined, tx)).json.removed === 0 && (await bin(tp)).length === 1);
  const twin2 = await tr.ask('POST', '/trash/' + pid + '/restore', {}, tp);
  check('papelera: el nombre nuevo conserva la carpeta y la extensión', twin2.status === 200 && twin2.json.path === 'proy/plan (2).md' && twin2.json.from === 'proy/plan.md' && (await tr.ask('GET', '/notes/' + encodeURIComponent('proy/plan (2).md'), undefined, tp)).json.text === 'apio-plan' && (await tr.ask('GET', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp)).json.text === 'el plan nuevo', twin2.json);
  // Carpeta con contraseña: lo eliminado sigue cifrado, y con el nombre ocupado hay que volver a cifrarlo.
  const vb = (n, fill) => Buffer.alloc(n, fill).toString('base64'); const sealedText = (fill) => 'vault1:' + Buffer.alloc(60, fill).toString('base64');
  const vault = (await tr.ask('POST', '/vaults', { folder: 'cofre', salt: vb(16, 1), iters: 200000, wrapped: vb(60, 2), check: vb(32, 3) }, tp)).json;
  const cofre = '/notes/' + encodeURIComponent('cofre/a.md');
  await tr.ask('PUT', cofre, { text: sealedText(5) }, tp);
  await tr.ask('DELETE', cofre, undefined, tp);
  const vrow = (await bin(tp)).find((x) => x.path === 'cofre/a.md');
  const vback = await tr.ask('POST', '/trash/' + vrow.id + '/restore', {}, tp);
  check('papelera: una nota de una carpeta protegida va y vuelve cifrada, tal como estaba', vrow.protected === true && vback.status === 200 && (await tr.ask('GET', cofre, undefined, tp)).json.text === sealedText(5), [vrow, vback.json]);
  await tr.ask('DELETE', cofre, undefined, tp);
  await tr.ask('PUT', cofre, { text: sealedText(6) }, tp);
  const vid2 = (await bin(tp)).find((x) => x.path === 'cofre/a.md').id;
  const rekey = await tr.ask('POST', '/trash/' + vid2 + '/restore', {}, tp);
  const plainIn = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: 'cofre/a (2).md', text: 'en claro' }, tp);
  const elsewhere = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: 'afuera.md', text: sealedText(7) }, tp);
  const rekeyed = await tr.ask('POST', '/trash/' + vid2 + '/restore', { to: rekey.json.to, text: sealedText(7) }, tp);
  check('papelera: con el nombre ocupado, una nota protegida pide que el navegador la vuelva a cifrar para el nombre nuevo', rekey.status === 409 && rekey.json.error === 'trash_rekey' && rekey.json.to === 'cofre/a (2).md' && rekey.json.text === sealedText(5) && plainIn.status === 409 && elsewhere.status === 409 &&
    rekeyed.status === 200 && rekeyed.json.path === 'cofre/a (2).md' && (await tr.ask('GET', '/notes/' + encodeURIComponent('cofre/a (2).md'), undefined, tp)).json.text === sealedText(7), [rekey.json, plainIn.json, elsewhere.json, rekeyed.json]);
  // Eliminar la carpeta protegida sin su contraseña.
  await tr.ask('PUT', '/notes/' + encodeURIComponent('cofre/b.md'), { text: sealedText(8) }, tp);
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('cofre/b.md'), undefined, tp);
  const wrongName = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'Cofre' }, tp);
  const notMine = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, tx);
  const gone = await tr.ask('POST', '/vaults/' + vault.id + '/destroy', { folder: 'cofre' }, tp);
  const left = (await tr.ask('GET', '/notes', undefined, tp)).json.map((n) => n.path).sort();
  check('carpeta protegida: eliminarla sin la contraseña pide su nombre exacto y es solo de su dueño', wrongName.status === 400 && wrongName.json.error === 'bad_confirm' && notMine.status === 404, [wrongName.json, notMine.status]);
  check('carpeta protegida: se van la carpeta, sus notas y lo suyo de la papelera, y nada más', gone.status === 200 && gone.json.notes === 2 && (await tr.ask('GET', '/vaults', undefined, tp)).json.length === 0 && left.join() === 'proy/plan (2).md,proy/plan.md' && !(await bin(tp)).some((x) => x.path.startsWith('cofre/')), [gone.json, left, await bin(tp)]);
  check('carpeta protegida: después la carpeta vuelve a aceptar notas comunes', (await tr.ask('PUT', cofre, { text: 'en claro' }, tp)).status === 200);
  // Borrar del todo y vaciar.
  await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan.md'), undefined, tp); await tr.ask('DELETE', cofre, undefined, tp);
  const two = await bin(tp);
  const one = await tr.ask('DELETE', '/trash/' + two[0].id, undefined, tp);
  check('papelera: eliminar del todo saca solo esa', one.status === 200 && (await bin(tp)).length === two.length - 1 && (await tr.ask('POST', '/trash/' + two[0].id + '/restore', {}, tp)).status === 404);
  const forever = await tr.ask('DELETE', '/notes/' + encodeURIComponent('proy/plan (2).md') + '?forever=1', undefined, tp);
  check('papelera: lo que se mudó se borra sin pasar por la papelera', forever.json.trash === false && !(await bin(tp)).some((x) => x.path === 'proy/plan (2).md'));
  const empty = await tr.ask('DELETE', '/trash', undefined, tp);
  check('papelera: vaciar la deja sin nada', empty.status === 200 && empty.json.removed === two.length - 1 && (await bin(tp)).length === 0, empty.json);
  await tr.ask('PUT', '/notes/vence.md', { text: 'rabanito-vence' }, tp); await tr.ask('DELETE', '/notes/vence.md', undefined, tp);
  await tr.stop();
  check('papelera: con DATA_KEY, lo eliminado queda cifrado en el disco', !onDisk(trDir, 'rabanito-') && !onDisk(trDir, 'apio-plan') && onDisk(trDir, 'enc1:'));
  // Vencimiento: con un plazo de un segundo, lo de la papelera se purga solo.
  tr = await boot(trDir, { DATA_KEY: K1, TRASH_DAYS: String(1 / 86400) });
  await new Promise((r) => setTimeout(r, 1100));
  const kept = (await tr.ask('GET', '/trash', undefined, tp)).json.length;
  await tr.ask('PUT', '/notes/corta.md', { text: 'x' }, tp); await tr.ask('DELETE', '/notes/corta.md', undefined, tp);
  const fresh = (await tr.ask('GET', '/trash', undefined, tp)).json;
  await new Promise((r) => setTimeout(r, 1300));
  check('papelera: al vencer el plazo se purga sola', kept === 0 && fresh.length === 1 && (await tr.ask('GET', '/trash', undefined, tp)).json.length === 0 && (await tr.ask('POST', '/trash/' + fresh[0].id + '/restore', {}, tp)).status === 404, [kept, fresh]);
  await tr.stop(); wipe(trDir);

  // ---------- Eliminar la cuenta ----------
  const bye = (who, mail, ip) => call('DELETE', '/account', mail === undefined ? {} : { email: mail }, who, { 'x-forwarded-for': ip || '10.9.0.1' });
  await call('PUT', '/notes/mia.md', { text: 'de la cuenta que se va' }, ps);
  await call('DELETE', '/notes/mia.md', undefined, ps);
  await call('PUT', '/notes/queda.md', { text: 'de la cuenta que se va' }, ps);
  await paddle(sub('active'));
  const paying = await bye(ps, 'pago@ejemplo.test');
  check('eliminar la cuenta: con una suscripción activa no se borra, y dice dónde cancelarla', paying.status === 409 && paying.json.error === 'subscription_active' && paying.json.manage === 'https://portal.ejemplo.test' && (await call('GET', '/account', undefined, ps)).status === 200, paying.json);
  const tokP = (await call('POST', '/tokens', { name: 'IA' }, ps)).json.token;
  await call('POST', '/shares', { path: 'queda.md', email: 'ana@ejemplo.test', role: 'view' }, ps);
  const linkP = (await call('POST', '/links', { path: 'queda.md' }, ps)).json.token;
  await paddle(sub('canceled'));
  const noMail = await bye(ps); const wrongMail = await bye(ps, 'ana@ejemplo.test');
  check('eliminar la cuenta: hay que escribir el correo de la cuenta', noMail.status === 400 && wrongMail.status === 400 && wrongMail.json.error === 'bad_confirm' && (await call('GET', '/account', undefined, ps)).status === 200, [noMail.json, wrongMail.json]);
  check('eliminar la cuenta: sin sesión no hay ruta', (await call('DELETE', '/account', { email: 'pago@ejemplo.test' })).status === 401);
  const byeOk = await bye(ps, ' Pago@Ejemplo.test ');
  check('eliminar la cuenta: se borra, y la sesión, el token y el enlace dejan de servir', byeOk.status === 200 && (await call('GET', '/account', undefined, ps)).status === 401 && (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokP)).status === 401 && (await call('GET', '/public/' + linkP)).status === 404, byeOk.json);
  check('eliminar la cuenta: sus comentarios guardados también se borran', !(await call('GET', '/admin/feedback', undefined, undefined, { 'x-admin-key': 'clave-de-prueba' })).json.items.some((i) => i.from_email === 'pago@ejemplo.test'));
  check('eliminar la cuenta: lo que había compartido ya no le llega a nadie', !(await call('GET', '/shared', undefined, s)).json.some((n) => n.by === 'pago@ejemplo.test'));
  const pc2 = await call('POST', '/auth/start', { email: 'pago@ejemplo.test' }, undefined, { 'x-forwarded-for': '10.9.0.2' }); const ps2 = (await call('POST', '/auth/verify', { email: 'pago@ejemplo.test', code: pc2.json.dev_code })).json.session;
  check('eliminar la cuenta: entrar de nuevo con ese correo es una cuenta nueva, vacía', (await call('GET', '/notes', undefined, ps2)).json.length === 0 && (await call('GET', '/trash', undefined, ps2)).json.length === 0 && (await call('GET', '/account', undefined, ps2)).json.plan === 'free');
  await paddle(sub('past_due'));
  check('eliminar la cuenta: un aviso viejo de su suscripción no le da el plan a la cuenta nueva', (await call('GET', '/account', undefined, ps2)).json.plan === 'free');
  let capped = null; for (let i = 0; i < 6; i++) capped = await bye(ps2, 'otro@ejemplo.test', '10.9.0.3');
  check('eliminar la cuenta: tiene tope de pedidos', capped.status === 429 && capped.json.error === 'too_many' && capped.json.retry_after > 0, capped.json);
  }

  // Alias de Gmail: una sola cuenta para la misma casilla
  {
    const enter = async (email, ip) => { const h = { 'x-forwarded-for': ip }; const st = await call('POST', '/auth/start', { email }, undefined, h); const v = await call('POST', '/auth/verify', { email, code: st.json.dev_code }, undefined, h); return { status: v.status, s: v.json.session, acc: v.json.account }; };
    const a = await enter('Maria.Gomez+trabajo@gmail.com', '10.8.0.1'); const b = await enter('mariagomez@gmail.com', '10.8.0.2'); const c = await enter('m.a.r.i.a.gomez+otra+mas@googlemail.com', '10.8.0.3');
    check('alias de Gmail: la cuenta se crea con el correo tal como se escribió', a.status === 200 && a.acc.email === 'maria.gomez+trabajo@gmail.com', a.acc);
    check('alias de Gmail: sin puntos, con otro + o con googlemail.com entra a la misma cuenta, que conserva su correo', b.acc.id === a.acc.id && c.acc.id === a.acc.id && b.acc.email === a.acc.email && c.acc.email === a.acc.email, [a.acc.id, b.acc.id, c.acc.id, c.acc.email]);
    await call('PUT', '/notes/alias.md', { text: '# Alias' }, a.s);
    check('alias de Gmail: las notas son las mismas entrando con cualquiera', (await call('GET', '/notes/alias.md', undefined, c.s)).json.text === '# Alias');
    const d = await enter('maria.gomez@ejemplo.test', '10.8.0.4'); const e = await enter('mariagomez@ejemplo.test', '10.8.0.5'); const f = await enter('mariagomez+x@ejemplo.test', '10.8.0.6');
    check('alias de Gmail: fuera de gmail.com y googlemail.com no se toca nada', new Set([a.acc.id, d.acc.id, e.acc.id, f.acc.id]).size === 4 && f.acc.email === 'mariagomez+x@ejemplo.test', [d.acc.id, e.acc.id, f.acc.id]);
    const g = await enter('otragmail@gmail.com', '10.8.0.7');
    check('alias de Gmail: otra casilla de Gmail es otra cuenta', g.acc.id !== a.acc.id && g.acc.email === 'otragmail@gmail.com');
  }

  console.log('Última edición');
  {
    const { DatabaseSync } = await import('node:sqlite'); const pathMod = await import('path');
    const h = { 'x-forwarded-for': '10.9.1.9' };
    const st = await call('POST', '/auth/start', { email: 'edita@ejemplo.test' }, undefined, h);
    const es = (await call('POST', '/auth/verify', { email: 'edita@ejemplo.test', code: st.json.dev_code }, undefined, h)).json.session;
    await call('POST', '/admin/plan', { email: 'edita@ejemplo.test', plan: 'pro' }, undefined, { 'x-admin-key': 'clave-de-prueba' });
    const note = () => call('GET', '/notes/autor.md', undefined, es).then((r) => r.json);
    await call('PUT', '/notes/autor.md', { text: 'uno' }, es);
    const n1 = await note();
    check('la nota dice quién hizo el último guardado: la cuenta, por su nombre visible', n1.edited && n1.edited.kind === 'user' && n1.edited.name === 'edita' && n1.updated > 0 && !JSON.stringify(n1.edited).includes('@'), n1.edited);
    const tk = (await call('POST', '/tokens', { name: 'robot' }, es)).json;
    const mcpCall = (name, args) => call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tk.token);
    await mcpCall('write_note', { path: 'autor.md', text: 'dos, de la IA' });
    const n2 = await note();
    check('si guardó una IA, dice que fue una IA y el nombre de su token', n2.edited && n2.edited.kind === 'ai' && n2.edited.name === 'robot' && n2.text === 'dos, de la IA', n2.edited);
    const vers = (await call('GET', '/versions/autor.md', undefined, es)).json;
    check('el historial dice de quién era cada versión', vers.length === 1 && vers[0].edited && vers[0].edited.kind === 'user' && vers[0].edited.name === 'edita', vers);
    const viaApi = await call('GET', '/api/v1/note?path=autor.md', undefined, tk.token);
    check('por la API la nota viaja como antes, sin el autor', viaApi.status === 200 && !/"edited"|"by"/.test(JSON.stringify(viaApi.json)), viaApi.json);
    await call('DELETE', '/tokens/' + tk.id, undefined, es);
    const n3 = await note();
    check('con el token revocado sigue diciendo que fue una IA, sin nombre', n3.edited && n3.edited.kind === 'ai' && n3.edited.name === '', n3.edited);
    // Una nota guardada antes de que existiera la columna: queda sin autor, con su fecha.
    const db = new DatabaseSync(pathMod.join(data, 'mdtools.db')); db.exec('PRAGMA busy_timeout = 3000');
    const cols = (t) => db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
    const hasCols = cols('notes').includes('by') && cols('versions').includes('by');
    db.prepare("UPDATE notes SET by = NULL WHERE path = 'autor.md'").run(); db.close();
    const n4 = await note();
    check('las notas anteriores a la columna quedan sin autor y conservan su fecha', hasCols && n4.edited === null && n4.updated === n3.updated && n4.text === n3.text, [hasCols, n4.edited]);
    check('otra cuenta no llega al autor de una nota ajena', (await call('GET', '/notes/autor.md', undefined, s)).status === 404 && (await call('GET', '/versions/autor.md', undefined, s)).json.length === 0);
  }

  // La portada: dos titulares a prueba. Un contador por día, variante y evento, sin nada de quien visita.
  {
    const KEY = { 'x-admin-key': 'clave-de-prueba' };
    // Como lo manda sendBeacon: texto plano, sin sesión.
    const beat = (body, ip) => fetch(base + '/landing', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': ip || '203.0.113.7' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const zero = await call('GET', '/admin/landing', undefined, undefined, KEY);
    check('portada: sin visitas los totales están en cero y sin tasa', zero.status === 200 && JSON.stringify(zero.json.variants) === JSON.stringify({ a: { view: 0, open: 0, rate: null }, b: { view: 0, open: 0, rate: null } }) && zero.json.from === null, zero.json);
    const sent = [];
    for (const b of [{ v: 'a', e: 'view' }, { v: 'a', e: 'view' }, { v: 'a', e: 'view' }, { v: 'a', e: 'view' }, { v: 'a', e: 'open' }, { v: 'b', e: 'view' }, { v: 'b', e: 'view' }, { v: 'b', e: 'open' }]) { const r = await beat(b); sent.push(r.status + ':' + (await r.text()).length); }
    check('portada: el aviso se recibe sin sesión, como texto, y responde vacío', sent.every((x) => x === '204:0'), sent);
    const badOnes = [];
    for (const b of [{ v: 'c', e: 'view' }, { v: 'a', e: 'buy' }, { v: 'a' }, 'hola', '[]', '{"v":"a","e":"view","x":"' + 'y'.repeat(400) + '"}']) badOnes.push((await beat(b, '203.0.113.8')).status);
    check('portada: otra variante, otro evento, algo que no es JSON o un cuerpo largo no se cuentan', badOnes.slice(0, 5).every((x) => x === 400) && badOnes[5] === 413, badOnes);
    const tot = await call('GET', '/admin/landing', undefined, undefined, KEY);
    const today = new Date().toISOString().slice(0, 10);
    check('portada: /admin/landing da los totales por variante con la tasa open/view', tot.status === 200 && JSON.stringify(tot.json.variants) === JSON.stringify({ a: { view: 4, open: 1, rate: 0.25 }, b: { view: 2, open: 1, rate: 0.5 } }) && tot.json.from === today && tot.json.to === today && (await call('GET', '/admin/landing?days=1', undefined, undefined, KEY)).json.variants.a.view === 4, tot.json);
    check('portada: los totales piden la clave de administración', (await call('GET', '/admin/landing')).status === 403 && (await call('GET', '/admin/landing', undefined, undefined, { 'x-admin-key': 'otra' })).status === 403 && (await call('POST', '/admin/landing', {}, undefined, KEY)).status !== 200);
    const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path.join(data, 'mdtools.db'), { readOnly: true });
    const cols = db.prepare('PRAGMA table_info(landing_stats)').all().map((c) => c.name).join(); const rows = db.prepare('SELECT * FROM landing_stats ORDER BY v, e').all().map((r) => Object.values(r).join(':'));
    db.close();
    check('portada: la tabla guarda solo el día, la variante, el evento y la cuenta, sin IP ni identificador', cols === 'day,v,e,n' && JSON.stringify(rows) === JSON.stringify([today + ':a:open:1', today + ':a:view:4', today + ':b:open:1', today + ':b:view:2']) && !JSON.stringify(rows).includes('203.0.113'), [cols, rows]);
    let last = null; for (let i = 0; i < 70; i++) last = await beat({ v: 'b', e: 'view' }, '203.0.113.9');
    const after = (await call('GET', '/admin/landing', undefined, undefined, KEY)).json.variants.b.view;
    check('portada: hay un tope por IP, y otra IP sigue entrando', last.status === 429 && after === 2 + 60 && (await beat({ v: 'b', e: 'view' }, '203.0.113.10')).status === 204, [last.status, after]);
  }

  check('cerrar sesión la invalida', (await call('POST', '/auth/logout', {}, s)).status === 200 && (await call('GET', '/notes', undefined, s)).status === 401);
} catch (e) { check('sin excepciones', false, String(e && e.stack || e)); console.log(log); }
child.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(data, { recursive: true, force: true });
const bad = results.filter((x) => !x).length;
console.log('\n' + (results.length - bad) + ' de ' + results.length + ' pruebas pasaron');
process.exit(bad ? 1 : 0);
