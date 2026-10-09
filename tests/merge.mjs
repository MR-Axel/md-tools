// Unir en vez de pisar. Cuando la nota abierta cambia afuera (otro programa escribe el archivo, una IA guarda la
// nota de la nube) y acá hay cambios sin guardar, las dos ediciones se unen por líneas sobre la base común; lo que
// choca lo decide la persona, y mientras no decida no se guarda nada encima. Se prueba el algoritmo solo, la app
// con un archivo del disco y con una nota de la nube en dos navegadores, y las herramientas del MCP con las que
// una IA cambia una nota sin pisar lo que la persona tildó o escribió. Todo contra un servidor local.
import { rig, tally, sleep, typeIn, leave, root } from './rig.mjs';
import { chromium } from 'playwright-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm';
const R = await rig({ MCP_FREE: '1' });
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const enc = encodeURIComponent;

try {
  // ---------- El algoritmo ----------
  console.log('La unión de tres vías');
  const code = fs.readFileSync(path.join(root, 'src', 'merge.js'), 'utf8');
  const LMD = {}; vm.runInNewContext(code, { LMD });
  const three = LMD.merge3.three;
  const base = '# Pending\n\n- [ ] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n\nNotes for the week.\n';
  const sub = (t, a, b) => { if (!t.includes(a)) throw new Error('falta: ' + a); return t.replace(a, b); };
  let r = three(base, sub(base, '- [ ] Buy bread', '- [x] Buy bread'), sub(base, 'Notes for the week.', 'Notes for this week.'));
  check('cambios en líneas distintas se unen solos', r.clean && r.text === '# Pending\n\n- [x] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n\nNotes for this week.\n' && !r.conflicts.length, r);
  r = three(base, sub(base, '- [ ] Buy bread', '- [x] Buy bread'), sub(base, '- [ ] Call the bank', '- [ ] Call the bank at nine'));
  check('también en renglones vecinos', r.clean && r.text.includes('- [x] Buy bread\n- [ ] Call the bank at nine\n'), r.text);
  check('sin cambios de un lado queda el otro, tal cual', three(base, base, 'otra cosa').text === 'otra cosa' && three(base, 'lo mío', base).text === 'lo mío' && three(base, 'igual', 'igual').text === 'igual');
  r = three(base, sub(base, '- [ ] Buy bread', '- [x] Buy bread'), sub(base, '- [ ] Buy bread', '- [ ] Buy bread and milk'));
  check('tarea: uno tilda y el otro cambia el texto en la misma línea, quedan las dos cosas', r.clean && r.text.includes('- [x] Buy bread and milk\n') && r.ticked === 0, r.text);
  r = three(base, sub(base, '- [ ] Buy bread', '- [ ] Buy rye bread'), sub(base, '- [ ] Buy bread', '- [x] Buy bread'));
  check('y al revés', r.clean && r.text.includes('- [x] Buy rye bread\n'), r.text);
  r = three(sub(base, '- [ ] Buy bread', '- [x] Buy bread'), sub(base, '- [ ] Buy bread', '- [ ] Buy bread'), sub(sub(base, '- [ ] Buy bread', '- [x] Buy bread'), 'Notes for the week.', 'Otra nota.'));
  check('tarea: lo que un lado destildó a propósito y el otro no tocó queda destildado', r.clean && r.text.includes('- [ ] Buy bread\n') && r.text.includes('Otra nota.'), r.text);
  // La IA reescribe la lista (otro orden, títulos nuevos, una tarea más) sobre una versión donde la persona aún no había tildado.
  const rewritten = '# Pending\n\n## Today\n\n- [ ] Call the bank\n- [ ] Buy bread\n\n## Later\n\n- [ ] Send the invoice\n- [ ] Renew the domain\n\nNotes for the week.\n';
  r = three(base, sub(sub(base, '- [ ] Buy bread', '- [x] Buy bread'), '- [ ] Send the invoice', '- [x] Send the invoice'), rewritten);
  check('tarea: los tildes de la persona sobreviven a una lista reescrita entera', r.clean && r.text === sub(sub(rewritten, '- [ ] Buy bread', '- [x] Buy bread'), '- [ ] Send the invoice', '- [x] Send the invoice'), r);
  r = three(base, base + '- [x] Pay the rent\n', base + '- [ ] Pay the rent\n');
  check('tarea: la misma tarea agregada con la casilla distinta queda tildada, y se avisa', r.clean && r.text.endsWith('- [x] Pay the rent\n') && r.ticked === 1 && (r.text.match(/Pay the rent/g) || []).length === 1, r);
  r = three(base, base + '- [ ] One more\n', base + '- [ ] One more\n- [ ] And another\n');
  check('lo que los dos agregaron igual en el mismo lugar entra una sola vez', r.clean && r.text.endsWith('- [ ] One more\n- [ ] And another\n') && (r.text.match(/One more/g) || []).length === 1, r.text);
  r = three(base, sub(base, 'Notes for the week.', 'Notes, mine.'), sub(base, 'Notes for the week.', 'Notes, theirs.'));
  check('la misma línea cambiada distinto es un choque: no se resuelve solo', !r.clean && r.text === null && r.conflicts.length === 1 && J(r.conflicts[0]) === J({ base: 'Notes for the week.', mine: 'Notes, mine.', theirs: 'Notes, theirs.' }), r);
  check('choque: dejar las dos pone lo de acá, una línea en blanco y lo de afuera, sin marcas', r.resolve('both') === sub(base, 'Notes for the week.', 'Notes, mine.\n\nNotes, theirs.') && !/[<>=|]{4}/.test(r.resolve('both')), r.resolve('both'));
  check('choque: usar lo mío o lo de afuera deja una sola', r.resolve('mine') === sub(base, 'Notes for the week.', 'Notes, mine.') && r.resolve('theirs') === sub(base, 'Notes for the week.', 'Notes, theirs.'));
  r = three(base, sub(sub(base, '- [ ] Buy bread', '- [x] Buy bread'), 'Notes for the week.', 'Notes, mine.'), sub(sub(base, '# Pending', '# To do'), 'Notes for the week.', 'Notes, theirs.'));
  check('choque: lo que no choca igual queda unido alrededor', !r.clean && r.conflicts.length === 1 && r.resolve('theirs') === '# To do\n\n- [x] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n\nNotes, theirs.\n', r.resolve('theirs'));
  r = three(base, sub(base, '- [ ] Call the bank\n', ''), sub(base, '- [ ] Call the bank', '- [x] Call the bank'));
  check('una tarea que uno borró y el otro tildó es un choque', !r.clean && r.conflicts[0].mine === '' && r.conflicts[0].theirs === '- [x] Call the bank', r.conflicts);
  r = three(base, sub(base, '- [ ] Call the bank', '- [x] Call the bank'), sub(base, '- [ ] Call the bank', '- [ ] Write the report'));
  check('una tarea tildada acá y cambiada por otra afuera queda con el texto nuevo y el tilde', r.clean && r.text.includes('- [x] Write the report'), r.text);
  const crlf = (t) => t.replace(/\n/g, '\r\n');
  r = three(crlf(base), crlf(sub(base, '- [ ] Buy bread', '- [x] Buy bread')), sub(base, 'Notes for the week.', 'Notes for this week.'));
  check('respeta los saltos de línea de lo de acá: CRLF sigue siendo CRLF', r.clean && r.text === crlf('# Pending\n\n- [x] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n\nNotes for this week.\n') && !/[^\r]\n/.test(r.text), J(r.text));
  r = three(crlf(base), sub(base, '- [ ] Buy bread', '- [x] Buy bread'), crlf(sub(base, 'Notes for the week.', 'Notes for this week.')));
  check('y LF sigue siendo LF aunque lo de afuera venga en CRLF', r.clean && !r.text.includes('\r') && r.text.includes('- [x] Buy bread') && r.text.includes('this week'), J(r.text));
  check('una diferencia solo de saltos de línea no es un cambio', three(base, sub(base, '- [ ] Buy bread', '- [x] Buy bread'), crlf(base)).text === sub(base, '- [ ] Buy bread', '- [x] Buy bread'));
  r = three('a\nb', 'a\nb\n', 'a\nb\nc');
  check('el final del archivo: uno agrega el salto final y el otro una línea, quedan las dos cosas', r.clean && r.text === 'a\nb\nc\n', J(r.text));
  check('y sin salto final de ningún lado, no aparece', three('a\nb\nc', 'A\nb\nc', 'a\nb\nC').text === 'A\nb\nC' && three('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC').text === 'A\nb\nC');
  const big = Array.from({ length: 60000 }, (_, i) => 'line ' + i);
  const mine = big.slice(); mine[10] = '- mine'; const theirs = big.slice(); theirs[59000] = '- theirs'; theirs.splice(30000, 0, 'added');
  let t0 = Date.now(); r = three(big.join('\n'), mine.join('\n'), theirs.join('\n'));
  check('un archivo grande con pocos cambios se une, y rápido', r.clean && r.text.split('\n').length === 60001 && r.text.includes('- mine\n') && r.text.includes('\nadded\n') && r.text.includes('- theirs\n') && Date.now() - t0 < 3000, Date.now() - t0);
  t0 = Date.now(); r = three(big.join('\n'), big.map((l, i) => (i % 2 ? l + ' m' : l)).join('\n'), big.map((l, i) => (i % 3 ? l + ' t' : l)).join('\n'));
  check('un archivo enorme cambiado por todos lados no se queda pensando: va a la pregunta, con un solo tramo', !r.clean && r.coarse && r.conflicts.length === 1 && Date.now() - t0 < 5000 && r.resolve('mine').split('\n').length === 60000, [r.clean, r.coarse, r.conflicts.length, Date.now() - t0]);
  // Al azar: aplicar la diferencia da el otro texto, y elegir un lado entero siempre da un texto.
  { let bad = 0; const rnd = (n) => Math.floor(Math.random() * n); const make = () => Array.from({ length: rnd(14) }, () => (rnd(3) ? 'l' + rnd(6) : '- [' + (rnd(2) ? 'x' : ' ') + '] t' + rnd(4)));
    for (let k = 0; k < 4000; k++) {
      const a = make(); const x = make(); const y = make();
      const H = LMD.merge3.diff(a, x); const out = []; let p = 0; for (const h of H) { out.push(...a.slice(p, h.s), ...h.lines); p = h.e; } out.push(...a.slice(p));
      if (J(out) !== J(x)) bad++;
      const m = three(a.join('\n'), x.join('\n'), y.join('\n'));
      if (typeof m.resolve('mine') !== 'string' || typeof m.resolve('both') !== 'string' || (m.clean && m.text !== m.resolve('theirs'))) bad++;
      if (three(a.join('\n'), x.join('\n'), a.join('\n')).text !== x.join('\n') || three(a.join('\n'), a.join('\n'), y.join('\n')).text !== y.join('\n')) bad++;
    }
    check('cuatro mil casos al azar: la diferencia se aplica bien y la unión nunca se rompe', bad === 0, bad); }
  // El servidor lleva una copia del algoritmo: tiene que ser la misma, renglón por renglón.
  const server = fs.readFileSync(path.join(root, 'server', 'server.mjs'), 'utf8');
  const marked = (t) => ((/\/\/ merge3:begin[^\n]*\n([\s\S]*?)\/\/ merge3:end/.exec(t.replace(/\r\n/g, '\n')) || [])[1] || '').split('\n').map((l) => l.trim()).filter(Boolean);
  check('el servidor tiene el mismo algoritmo que la app, renglón por renglón', marked(code).length > 100 && J(marked(code)) === J(marked(server)), [marked(code).length, marked(server).length]);
  check('el archivo nuevo está en la página, en el service worker y en la extensión', /<script defer src="merge\.js">/.test(fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8')) && /'src\/merge\.js'/.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')) && JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[1].js.includes('src/merge.js'));

  // ---------- El MCP ----------
  console.log('La IA por MCP: unir, no pisar');
  const { api } = R;
  const A = await R.signup('ana@ejemplo.test', true);
  const tok = (await api('POST', '/tokens', { name: 'Claude' }, A.s)).json.token;
  const tok2 = (await api('POST', '/tokens', { name: 'Otra' }, A.s)).json.token;
  const mcp = async (name, args, t) => { const x = (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }, t || tok)).json.result; return { err: !!x.isError, text: x.content[0].text, more: x.content.slice(1).map((c) => c.text).join('\n'), n: x.content.length, data: x.structuredContent || null }; };
  const person = async (p, text) => { const n = (await api('GET', '/notes/' + enc(p), undefined, A.s)).json; return api('PUT', '/notes/' + enc(p), n && n.rev != null ? { text, rev: n.rev } : { text }, A.s); };
  const noteOf = async (p) => (await api('GET', '/notes/' + enc(p), undefined, A.s)).json;
  const revIn = (x) => +(/Version (\d+)/.exec(x.more) || [])[1];

  const names = (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tok)).json.result.tools;
  const wn = names.find((x) => x.name === 'write_note');
  check('la lista de herramientas trae edit_note y set_task, y write_note acepta la versión de base', names.some((x) => x.name === 'edit_note') && names.some((x) => x.name === 'set_task') && wn.inputSchema.properties.base_rev.type === 'number' && J(wn.inputSchema.required) === J(['path', 'text']) && names.every((x) => !/[!¡—–]/.test(x.description)), wn);
  await person('p/todo.md', base);
  const read1 = await mcp('read_note', { path: 'p/todo.md' });
  check('read_note devuelve el texto solo en el primer bloque, y la versión en el segundo', !read1.err && read1.text === base && read1.n === 2 && revIn(read1) === 1 && /base_rev: 1/.test(read1.more) && /by a person/.test(read1.more), read1);
  check('y la versión viene también como dato, la misma del texto, con quién guardó último', !!read1.data && read1.data.rev === revIn(read1) && read1.data.path === 'p/todo.md' && read1.data.saved_by === 'a person' && read1.data.text === base, read1.data);
  // La persona tilda una tarea después de que la IA leyó; la IA manda la nota entera con un renglón más.
  await person('p/todo.md', sub(base, '- [ ] Buy bread', '- [x] Buy bread'));
  const w1 = await mcp('write_note', { path: 'p/todo.md', text: sub(base, 'Notes for the week.', 'Notes for the week.\n\nAdded by the AI.'), base_rev: revIn(read1) });
  const n1 = await noteOf('p/todo.md');
  check('write_note sobre una versión vieja se une: queda lo de la IA y la tarea que tildó la persona', !w1.err && n1.text === '# Pending\n\n- [x] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n\nNotes for the week.\n\nAdded by the AI.\n' && n1.rev === 3, [w1, n1]);
  check('y la respuesta lo dice, con la versión nueva', /Saved p\/todo\.md/.test(w1.text) && /were merged with yours/.test(w1.text) && /a person edited it/.test(w1.text) && /Now at version 3\./.test(w1.text), w1.text);
  const w1b = await mcp('write_note', { path: 'p/todo.md', text: n1.text + '\nSecond line of the AI.\n', base_rev: 3 });
  check('con la versión al día guarda derecho, sin unir nada', !w1b.err && !/merged/.test(w1b.text) && /Now at version 4\./.test(w1b.text) && (await noteOf('p/todo.md')).text.endsWith('Second line of the AI.\n'), w1b.text);
  // Choque: la persona y la IA cambian la misma línea.
  const before = await noteOf('p/todo.md');
  await person('p/todo.md', sub(before.text, 'Notes for the week.', 'Notes by the person.'));
  const w2 = await mcp('write_note', { path: 'p/todo.md', text: sub(before.text, 'Notes for the week.', 'Notes by the AI.'), base_rev: before.rev });
  const n2 = await noteOf('p/todo.md');
  check('si chocan no se guarda nada, y el error trae el texto de ahora y su versión para que la IA una y reintente', w2.err && /Nothing was saved/.test(w2.text) && /base_rev 5/.test(w2.text) && w2.text.endsWith('Current text of p/todo.md:\n\n' + n2.text) && n2.text.includes('Notes by the person.') && !n2.text.includes('Notes by the AI.') && n2.rev === 5, [w2.text.slice(0, 400), n2.rev]);
  const w2b = await mcp('write_note', { path: 'p/todo.md', text: sub(n2.text, 'Notes by the person.', 'Notes by the person, with what the AI adds.'), base_rev: 5 });
  check('y el reintento sobre esa versión entra', !w2b.err && (await noteOf('p/todo.md')).text.includes('with what the AI adds'), w2b.text);
  // Otro token nunca leyó esa versión: no hay con qué unir, y recibe el texto de ahora.
  const w3 = await mcp('write_note', { path: 'p/todo.md', text: 'pisado', base_rev: 2 }, tok2);
  check('una versión que ese token no leyó no se une a ciegas: vuelve el texto de ahora y no se guarda', w3.err && /no longer at hand/.test(w3.text) && w3.text.includes('with what the AI adds') && !(await noteOf('p/todo.md')).text.includes('pisado'), w3.text.slice(0, 300));
  check('una versión mal formada se rechaza', (await mcp('write_note', { path: 'p/todo.md', text: 'x', base_rev: 1.5 })).err && (await mcp('write_note', { path: 'p/todo.md', text: 'x', base_rev: -1 })).err && !(await noteOf('p/todo.md')).text.startsWith('x'));
  // Sin versión de base funciona como siempre, y avisa si pisó lo de una persona.
  await mcp('read_note', { path: 'p/todo.md' });
  const cur = await noteOf('p/todo.md');
  const w4 = await mcp('write_note', { path: 'p/todo.md', text: cur.text + 'x\n' });
  check('sin versión de base, recién leída, guarda como siempre y sin avisos', !w4.err && w4.text === 'Saved p/todo.md (' + (cur.text.length + 2) + ' characters). Open it: ' + (/Open it: (\S+)/.exec(w4.text) || [])[1], w4.text);
  await person('p/todo.md', sub(cur.text, '- [ ] Call the bank', '- [x] Call the bank'));
  const w5 = await mcp('write_note', { path: 'p/todo.md', text: cur.text });
  check('sin versión de base, si una persona guardó después de la última lectura, entra igual y lo avisa', !w5.err && /^Saved p\/todo\.md/.test(w5.text) && /Warning: a person changed this note after you last read it/.test(w5.text) && /base_rev/.test(w5.text) && (await noteOf('p/todo.md')).text === cur.text, w5.text);
  const w6 = await mcp('write_note', { path: 'p/todo.md', text: cur.text + 'y\n' });
  check('y no avisa de más cuando la última en guardar fue ella misma', !w6.err && !/Warning/.test(w6.text), w6.text);
  const fresh = await mcp('write_note', { path: 'p/nueva.md', text: '# Nueva\n', base_rev: 7 });
  check('una nota nueva se crea igual, con o sin versión', !fresh.err && /Now at version 1\./.test(fresh.text) && (await noteOf('p/nueva.md')).text === '# Nueva\n', fresh.text);

  // set_task
  const tasks = '# List\n\n- [ ] Buy bread\n- [x] Pay the rent\n- [ ] Call Ana\n1. [ ] Call Ana\n\n```kanban\n## To do\n- [ ] Buy bread\n```\n\nText that the person wrote.\n';
  await person('p/tasks.md', tasks);
  const s1 = await mcp('set_task', { path: 'p/tasks.md', task: 'Buy bread' });
  check('set_task tilda una tarea por su texto, sin tocar el resto ni las tarjetas de un tablero', !s1.err && /^Checked "Buy bread" in p\/tasks\.md \(line 3\)\. Open it: /.test(s1.text) && (await noteOf('p/tasks.md')).text === sub(tasks, '# List\n\n- [ ] Buy bread', '# List\n\n- [x] Buy bread'), s1.text);
  const s2 = await mcp('set_task', { path: 'p/tasks.md', task: 'pay the RENT', done: false });
  check('y la destilda con done: false, sin mirar mayúsculas', !s2.err && /^Unchecked "Pay the rent"/.test(s2.text) && (await noteOf('p/tasks.md')).text.includes('- [ ] Pay the rent'), s2.text);
  const s3 = await mcp('set_task', { path: 'p/tasks.md', task: 'Call Ana' });
  check('con dos tareas iguales no adivina: pide cuál', s3.err && /2 tasks match/.test(s3.text) && /1\. \[ \] Call Ana/.test(s3.text) && /occurrence/.test(s3.text), s3.text);
  const s4 = await mcp('set_task', { path: 'p/tasks.md', task: 'Call Ana', occurrence: 2 });
  check('y con el número de aparición tilda esa', !s4.err && (await noteOf('p/tasks.md')).text.includes('- [ ] Call Ana\n1. [x] Call Ana'), s4.text);
  const s5 = await mcp('set_task', { path: 'p/tasks.md', task: 'Buy bread' }); const revS = (await noteOf('p/tasks.md')).rev;
  check('una tarea que ya está así no cambia nada', !s5.err && /Nothing to change/.test(s5.text) && revS === 4, [s5.text, revS]);
  const s6 = await mcp('set_task', { path: 'p/tasks.md', task: 'No such task' });
  check('una tarea que no está dice cuáles hay, y no guarda', s6.err && /no task with that text/.test(s6.text) && /\[x\] Buy bread/.test(s6.text) && (await noteOf('p/tasks.md')).rev === revS, s6.text);
  check('acepta el texto con su viñeta y su casilla, y una parte del texto si es única', !(await mcp('set_task', { path: 'p/tasks.md', task: '- [ ] Pay the rent' })).err && !(await mcp('set_task', { path: 'p/tasks.md', task: 'rent', done: false })).err && (await noteOf('p/tasks.md')).text.includes('- [ ] Pay the rent'));
  // La persona tilda mientras la IA trabaja: la herramienta puntual no lo pisa.
  const tBefore = (await noteOf('p/tasks.md')).text;
  await mcp('read_note', { path: 'p/tasks.md' });
  await person('p/tasks.md', sub(tBefore, '- [ ] Call Ana', '- [x] Call Ana'));
  await mcp('set_task', { path: 'p/tasks.md', task: 'Pay the rent' });
  await mcp('edit_note', { path: 'p/tasks.md', old_text: 'Text that the person wrote.', new_text: 'Text that the person wrote.\n\nA line from the AI.' });
  await mcp('append_note', { path: 'p/tasks.md', text: 'Appended by the AI.' });
  const tAfter = (await noteOf('p/tasks.md')).text;
  check('lo que la persona tildó sobrevive a set_task, edit_note y append_note de la IA', tAfter.includes('- [x] Call Ana\n1. [x] Call Ana') && tAfter.includes('- [x] Pay the rent') && tAfter.includes('A line from the AI.') && tAfter.endsWith('Appended by the AI.'), tAfter);

  // edit_note
  const e1 = await mcp('edit_note', { path: 'p/tasks.md', old_text: 'A line from the AI.', new_text: 'A better line from the AI.' });
  check('edit_note cambia un tramo exacto y devuelve la versión nueva', !e1.err && /^Edited p\/tasks\.md \(now at version \d+\)\. Open it: /.test(e1.text) && (await noteOf('p/tasks.md')).text === sub(tAfter, 'A line from the AI.', 'A better line from the AI.'), e1.text);
  const e2 = await mcp('edit_note', { path: 'p/tasks.md', old_text: 'Call Ana', new_text: 'Call Beto' });
  check('si el tramo aparece más de una vez no cambia nada y dice cuántas', e2.err && /appears 2 times/.test(e2.text) && !(await noteOf('p/tasks.md')).text.includes('Beto'), e2.text);
  const e3 = await mcp('edit_note', { path: 'p/tasks.md', old_text: 'This is not in the note', new_text: 'x' });
  check('si el tramo no está, tampoco, y manda a leer de nuevo', e3.err && /was not found/.test(e3.text) && /Read the note again/.test(e3.text), e3.text);
  check('sin tramo viejo se rechaza, y en una nota que no existe también', (await mcp('edit_note', { path: 'p/tasks.md', old_text: '', new_text: 'x' })).err && (await mcp('edit_note', { path: 'p/no.md', old_text: 'a', new_text: 'b' })).err && (await mcp('set_task', { path: 'p/no.md', task: 'a' })).err);
  await api('PUT', '/notes/' + enc('p/win.md'), { text: 'uno\r\ndos\r\n- [ ] tres\r\n' }, A.s);
  await mcp('edit_note', { path: 'p/win.md', old_text: 'uno\ndos', new_text: 'uno\ndos y medio' }); await mcp('set_task', { path: 'p/win.md', task: 'tres' });
  check('las dos respetan los saltos de línea de la nota', (await noteOf('p/win.md')).text === 'uno\r\ndos y medio\r\n- [x] tres\r\n', J((await noteOf('p/win.md')).text));
  const e4 = await mcp('edit_note', { path: 'p/win.md', old_text: 'dos y medio\n', new_text: '' });
  check('un tramo se puede borrar', !e4.err && (await noteOf('p/win.md')).text === 'uno\r\n- [x] tres\r\n');
  // Las de tablero ya eran puntuales: leen y escriben sobre la misma revisión.
  await mcp('create_board', { path: 'p/board.md' }); await mcp('list_boards', { path: 'p/board.md' });
  const b0 = (await noteOf('p/board.md')).text;
  await person('p/board.md', b0 + '\nA line the person added under the board.\n');
  const card = await mcp('add_card', { path: 'p/board.md', title: 'From the AI' });
  const b1 = (await noteOf('p/board.md')).text;
  check('add_card sobre una nota que la persona cambió después de la lectura de la IA no pisa ese cambio', !card.err && b1.includes('From the AI') && b1.includes('A line the person added under the board.'), b1);
  const guide = await mcp('get_guide');
  check('la guía trae las reglas para no pisar a la persona, también con archivos del disco', ['## Changing a note the person also edits', 'Read a note right before you change it', 'edit_note replaces one exact passage', 'set_task checks or unchecks one task', 'pass base_rev', 'Never uncheck a task the person checked', 'never delete or reword what they wrote', 'Markdown files on the disk', 'never rewrite the whole file'].every((x) => guide.text.includes(x)) && !/[!¡—–]/.test(guide.text), guide.text.slice(0, 200));
  const hello = (await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'prueba' } } }, tok)).json.result.instructions;
  check('y lo que el servidor le dice a la IA al conectarse también', /read a note right before you change it/.test(hello) && /edit_note, set_task, append_note and the board tools over write_note/.test(hello) && /base_rev/.test(hello) && /never uncheck or delete what the person checked or wrote/.test(hello), hello.slice(0, 300));
  // El mismo resultado que la app, caso por caso, pasando por el servidor.
  { const cases = [
      [base, sub(base, '- [ ] Buy bread', '- [x] Buy bread'), sub(base, 'Notes for the week.', 'Notes for this week.')],
      [base, sub(base, '- [ ] Buy bread', '- [ ] Buy rye bread'), sub(base, '- [ ] Buy bread', '- [x] Buy bread')],
      [base, rewritten, sub(sub(base, '- [ ] Buy bread', '- [x] Buy bread'), '- [ ] Send the invoice', '- [x] Send the invoice')],
      [base, base + '- [ ] Pay the rent\n', base + '- [x] Pay the rent\n'],
      [base, sub(base, 'Notes for the week.', 'Notes, mine.'), sub(base, 'Notes for the week.', 'Notes, theirs.')],
      [base, sub(base, '- [ ] Call the bank\n', ''), sub(base, '- [ ] Call the bank', '- [x] Call the bank')],
      [crlf(base), sub(base, '# Pending', '# To do'), crlf(sub(base, '- [ ] Buy bread', '- [x] Buy bread'))],
      ['a\nb', 'a\nb\nc', 'a\nb\n'],
    ]; const off = [];
    for (let k = 0; k < cases.length; k++) {
      const [b, ai, human] = cases[k]; const p = 'eq/caso-' + k + '.md';
      await person(p, b); const rd = await mcp('read_note', { path: p }); await person(p, human);
      const w = await mcp('write_note', { path: p, text: ai, base_rev: revIn(rd) }); const got = (await noteOf(p)).text; const want = three(b, ai, human);
      if (want.clean ? (w.err || got !== want.text) : (!w.err || got !== human)) off.push([k, w.err, got, want.text]);
    }
    check('el servidor une igual que la app en los mismos casos, y rechaza los mismos choques', off.length === 0, off); }

  // ---------- La app: un archivo del disco ----------
  console.log('La app: un archivo del disco que cambia afuera');
  const filler = Array.from({ length: 40 }, (_, i) => 'Filler paragraph number ' + (i + 1) + ' to make the page long enough to scroll.').join('\n\n');
  const DOC = '# Pending\n\n- [ ] Buy bread\n- [ ] Call the bank\n- [ ] Send the invoice\n- [ ] Book the flight\n- [ ] Renew the domain\n\nNotes for the week.\n\n::: details More\nHidden text here.\n:::\n\n' + filler + '\n\nLast line of the note.\n';
  // Un navegador con perfil propio: el disco de prueba es OPFS, que no anda en uno sin perfil.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mdmerge-'));
  const dctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_BIN || chromium.executablePath(), viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'dark', serviceWorkers: 'block' });
  await dctx.route((url) => /(^|\.)sharpmd\.app$/.test(url.hostname), (route) => { R.outside.push(route.request().url()); return route.abort(); });
  await dctx.addInitScript((url) => { try { if (!localStorage.getItem('mdtools:settings')) localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: url })); } catch (e) { /* una página en blanco no tiene almacenamiento */ } }, R.base);
  const d = await dctx.newPage(); d.on('pageerror', (e) => R.errors.push(e.message));
  await d.goto(R.home); await d.waitForSelector('.lmd-home');
  await d.evaluate(async (text) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mrg', { create: true });
    const h = await dir.getFileHandle('todo.md', { create: true }); const w = await h.createWritable(); await w.write(text); await w.close();
    window.showDirectoryPicker = async () => dir;
  }, DOC);
  await Promise.all([d.waitForNavigation(), d.click('[data-home=dir]')]);
  await d.waitForSelector('.markdown-body li.lmd-task-item'); await sleep(600);
  const watch = (p) => p.evaluate(() => { window.__said = []; const n = document.querySelector('.lmd-foot .lmd-status'); new MutationObserver(() => { if (n.textContent && window.__said[window.__said.length - 1] !== n.textContent) window.__said.push(n.textContent); }).observe(n, { childList: true, characterData: true, subtree: true }); });
  const said = (p) => p.evaluate(() => window.__said.splice(0));
  await watch(d);
  // Leer justo mientras la app escribe puede fallar un instante: se reintenta.
  const disk = () => d.evaluate(async () => { for (let k = 0; ; k++) { try { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mrg'); return await (await (await dir.getFileHandle('todo.md')).getFile()).text(); } catch (e) { if (k > 20) throw e; await new Promise((r) => setTimeout(r, 60)); } } });
  const outside = (text) => d.evaluate(async (t) => { for (let k = 0; ; k++) { try { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('mrg'); const w = await (await dir.getFileHandle('todo.md')).createWritable(); await w.write(t); await w.close(); return; } catch (e) { if (k > 20) throw e; await new Promise((r) => setTimeout(r, 60)); } } }, text);
  const src = (p) => p.evaluate(() => { document.querySelector('[data-act=view-raw]').click(); const t = document.querySelector('.lmd-raw-edit'); const pre = document.querySelector('pre.lmd-raw'); const v = t.hidden ? pre.textContent : t.value; document.querySelector('[data-act=view-doc]').click(); return v; });
  const tick = (p, text) => p.locator('li.lmd-task-item', { hasText: text }).first().locator('input[type=checkbox]').check();
  const boxes = (p) => p.evaluate(() => [...document.querySelectorAll('.lmd-article li.lmd-task-item')].map((li) => (li.querySelector('input[type=checkbox]').checked ? '[x] ' : '[ ] ') + li.textContent.trim()));
  const has = (p, text) => p.waitForFunction((t) => document.querySelector('.lmd-article').textContent.includes(t), text, { timeout: 15000 });
  const diskHas = async (text) => { for (let i = 0; i < 80; i++) { if ((await disk()).includes(text)) return true; await sleep(100); } return false; };
  const toast = async (p) => { await p.waitForSelector('.lmd-mrg-toast', { timeout: 15000 }); return p.evaluate(() => { const t = document.querySelector('.lmd-mrg-toast'); return { text: t.querySelector('span').textContent, undo: (t.querySelector('button') || {}).textContent || '' }; }); };
  const noToast = (p) => p.evaluate(() => document.querySelectorAll('.lmd-mrg-toast').forEach((n) => n.remove()));
  const state = (p) => p.evaluate(() => ({ text: document.querySelector('.lmd-savestate').textContent, dirty: document.documentElement.classList.contains('lmd-dirty'), held: document.documentElement.classList.contains('lmd-held') }));
  const setting = (p, patch) => p.evaluate((x) => new Promise((resolve) => chrome.storage.local.get('settings', (got) => chrome.storage.local.set({ settings: Object.assign({}, got.settings || {}, x) }, resolve))), patch);

  // Sin cambios propios: toma lo nuevo sola, sin mover la página, lo plegado ni la selección.
  await d.click('details.lmd-box > summary'); await sleep(200);
  await d.evaluate(() => { window.scrollTo(0, 420); const p = [...document.querySelectorAll('.lmd-article p')].find((n) => n.textContent === 'Notes for the week.'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await sleep(200);
  const pos0 = await d.evaluate(() => ({ y: window.scrollY, open: document.querySelector('details.lmd-box').open, sel: String(getSelection()) }));
  await outside(sub(DOC, 'Last line of the note.', 'Last line, changed outside.')); await has(d, 'Last line, changed outside.'); await sleep(300);
  const pos1 = await d.evaluate(() => ({ y: window.scrollY, open: document.querySelector('details.lmd-box').open, sel: String(getSelection()) }));
  const st1 = await state(d); const said1 = await said(d);
  check('sin cambios propios, el archivo que cambia afuera entra solo y lo dice', said1.includes('Document updated') && !st1.dirty && !(await d.$('.lmd-mrg')) && !(await d.$('.lmd-mrg-toast')), [said1, st1]);
  check('y la página, lo desplegado y la selección quedan donde estaban', pos0.y > 300 && Math.abs(pos1.y - pos0.y) < 4 && pos0.open && pos1.open && pos0.sel === 'Notes for the week.' && pos1.sel === pos0.sel, [pos0, pos1]);
  await d.evaluate(() => { getSelection().removeAllRanges(); window.scrollTo(0, 0); });

  // Con cambios propios en otra línea: se unen solos, con aviso y deshacer.
  await tick(d, 'Buy bread'); await sleep(250);
  const mine2 = await src(d); const out2 = sub(sub(await disk(), '- [ ] Call the bank', '- [ ] Call the bank before noon'), '- [ ] Send the invoice\n', '- [ ] Send the invoice\n- [ ] New from the AI\n');
  check('tildar una tarea leyendo deja un cambio sin guardar', (await state(d)).dirty && mine2.includes('- [x] Buy bread') && !(await disk()).includes('[x]'), await state(d));
  await outside(out2);
  const t2 = await toast(d); await has(d, 'New from the AI');
  const b2 = await boxes(d); const s2x = await src(d);
  check('con cambios propios sin guardar, lo de afuera se une solo: aviso corto y un botón para deshacer', t2.text === 'Changes made elsewhere were merged' && t2.undo === 'Undo' && !(await d.$('.lmd-mrg')), t2);
  check('quedan las dos cosas: lo tildado acá y lo que cambió afuera', J(b2.slice(0, 4)) === J(['[x] Buy bread', '[ ] Call the bank before noon', '[ ] Send the invoice', '[ ] New from the AI']) && s2x === sub(out2, '- [ ] Buy bread', '- [x] Buy bread'), [b2, s2x.slice(0, 200)]);
  check('y nada se escribió todavía en el disco: sigue lo de afuera, y acá hay cambios sin guardar', (await disk()) === out2 && (await state(d)).dirty);
  await d.click('.lmd-mrg-toast button'); await sleep(400);
  const undone = await src(d);
  check('deshacer vuelve a mi versión de antes de unir', undone === mine2 && !(await d.$('.lmd-mrg-toast')), undone.slice(0, 200));
  await d.keyboard.press('Control+s'); const kept = await diskHas('- [x] Buy bread');
  check('y guardada así, queda mi versión', kept && (await disk()) === mine2 && !(await state(d)).dirty, (await disk()).slice(0, 200));

  await tick(d, 'Send the invoice'); await sleep(250);
  await outside(sub(await disk(), 'Notes for the week.', 'Notes for this week.'));
  await toast(d); await d.keyboard.press('Control+s');
  check('unido y guardado, el archivo tiene lo de los dos', (await diskHas('- [x] Send the invoice')) && (await disk()).includes('Notes for this week.') && (await disk()).includes('- [x] Buy bread') && !(await state(d)).dirty, (await disk()).slice(0, 250));
  await noToast(d);

  // La misma línea: acá se tilda, afuera cambia el texto.
  await tick(d, 'Call the bank'); await sleep(250);
  await outside(sub(await disk(), '- [ ] Call the bank', '- [ ] Call the bank at nine'));
  await toast(d); await has(d, 'Call the bank at nine');
  const s3x = await src(d);
  check('la misma tarea tildada acá y con el texto cambiado afuera queda tildada y con el texto nuevo', s3x.includes('- [x] Call the bank at nine\n') && (await boxes(d)).includes('[x] Call the bank at nine'), s3x.slice(0, 200));
  await d.keyboard.press('Control+s'); await diskHas('- [x] Call the bank at nine'); await noToast(d);

  // Guardar con un cambio de afuera que la app todavía no vio (la recarga automática apagada).
  await setting(d, { autoRefresh: false }); await sleep(400);
  await tick(d, 'Book the flight'); await sleep(250);
  await outside(sub(await disk(), 'Notes for this week.', 'Notes, second edit outside.')); await sleep(1600);
  const blind = await d.evaluate(() => document.querySelector('.lmd-article').textContent.includes('second edit outside'));
  await d.keyboard.press('Control+s');
  const both4 = (await diskHas('- [x] Book the flight')) && (await disk()).includes('Notes, second edit outside.');
  const t4 = await toast(d);
  check('al guardar se vuelve a leer el archivo: si cambió desde la base se une antes de escribir, no se pisa', !blind && both4 && t4.text === 'Changes made elsewhere were merged' && !(await state(d)).dirty && (await d.evaluate(() => document.querySelector('.lmd-article').textContent.includes('second edit outside'))), [blind, both4, t4, (await disk()).slice(0, 300)]);
  await setting(d, { autoRefresh: true }); await sleep(400); await noToast(d);

  // Choque de verdad: la misma línea cambiada distinto. Pregunta, y nada se guarda encima sin decidir.
  await d.click('[data-act=mode-edit]'); await sleep(400);
  await typeIn(d, 'Notes, second edit outside.', ' Mine.'); await leave(d); await sleep(300);
  const out5 = sub(await disk(), 'Notes, second edit outside.', 'Notes rewritten by the AI.');
  await outside(out5);
  await d.waitForSelector('.lmd-mrg', { timeout: 15000 });
  const dlg = await d.evaluate(() => { const b = document.querySelector('.lmd-mrg'); return { title: b.querySelector('h3').textContent, labels: [...b.querySelectorAll('.lmd-mrg-label')].map((n) => n.textContent), texts: [...b.querySelectorAll('.lmd-mrg-text')].map((n) => n.textContent), buttons: [...b.querySelectorAll('.lmd-ask-actions button')].map((n) => n.textContent), modal: b.querySelector('[role=dialog]').getAttribute('aria-modal'), tags: b.querySelectorAll('.lmd-mrg-text *').length }; });
  check('la misma línea cambiada de los dos lados abre la pregunta, con el tramo de cada lado a la vista', dlg.title === 'Changed here and somewhere else' && J(dlg.labels) === J(['Yours', 'Theirs']) && J(dlg.texts) === J(['Notes, second edit outside. Mine.', 'Notes rewritten by the AI.']) && dlg.modal === 'true' && dlg.tags === 0, dlg);
  check('con tres salidas y la de dejarlo para después', J(dlg.buttons) === J(['Later', 'Use theirs', 'Use mine', 'Keep both']), dlg.buttons);
  await d.keyboard.press('Escape'); await d.waitForSelector('.lmd-mrg', { state: 'detached' }); await sleep(1800);
  const st5 = await state(d);
  check('dejarlo para después no guarda nada encima: el archivo sigue como lo dejó el otro y el indicador dice que está en pausa', (await disk()) === out5 && st5.held && st5.text === 'Saving paused: a conflict needs your decision' && !(await d.$('.lmd-mrg')), [st5, (await disk()) === out5]);
  await d.keyboard.press('Control+s'); await d.waitForSelector('.lmd-mrg', { timeout: 8000 });
  check('guardar a mano vuelve a preguntar, y sigue sin escribir', (await disk()) === out5);
  await d.click('.lmd-mrg [data-mrg=both]'); await d.waitForSelector('.lmd-mrg', { state: 'detached' });
  const bothOk = await diskHas('Notes, second edit outside. Mine.\n\nNotes rewritten by the AI.\n');
  const st5b = await state(d);
  check('dejar las dos: quedan una debajo de la otra, separadas por una línea en blanco, y recién ahí se guarda', bothOk && !st5b.held && !st5b.dirty && !/[<>=|]{4}/.test(await disk()) && (await src(d)) === (await disk()), [st5b, (await disk()).slice(0, 400)]);

  await typeIn(d, 'Notes rewritten by the AI.', ' Again.'); await leave(d); await sleep(300);
  await outside(sub(await disk(), 'Notes rewritten by the AI.', 'Notes, third version outside.'));
  await d.waitForSelector('.lmd-mrg', { timeout: 15000 }); await d.click('.lmd-mrg [data-mrg=mine]'); await d.waitForSelector('.lmd-mrg', { state: 'detached' }); await sleep(300);
  const mine5 = await src(d);
  await d.keyboard.press('Control+s'); const mineOk = await diskHas('Notes rewritten by the AI. Again.');
  check('usar lo mío: queda lo de acá, y lo demás que cambió afuera igual entra', mineOk && mine5.includes('Notes rewritten by the AI. Again.') && !mine5.includes('third version outside') && (await disk()) === mine5, mine5.slice(0, 400));

  await typeIn(d, 'Notes rewritten by the AI. Again.', ' More.'); await leave(d); await sleep(300);
  const out5c = sub(await disk(), 'Notes rewritten by the AI. Again.', 'Final from outside.');
  await outside(out5c);
  await d.waitForSelector('.lmd-mrg', { timeout: 15000 }); await d.click('.lmd-mrg [data-mrg=theirs]'); await d.waitForSelector('.lmd-mrg', { state: 'detached' }); await sleep(300);
  const st5c = await state(d);
  check('usar lo de afuera: queda lo del archivo y no hay nada por guardar', (await src(d)) === out5c && (await disk()) === out5c && !st5c.dirty && !st5c.held, st5c);

  // Guardado automático: la misma regla, y con un choque se pausa hasta que la persona decida.
  await setting(d, { autosave: true, autosaveDelay: 500 }); await sleep(400);
  await typeIn(d, 'Final from outside.', ' Auto.'); await leave(d);
  check('con el guardado automático, lo escrito se guarda solo', await diskHas('Final from outside. Auto.'), (await disk()).slice(0, 400));
  await sleep(300);
  await d.locator('.lmd-article .lmd-editable', { hasText: 'Final from outside. Auto.' }).first().click(); await d.keyboard.press('Control+End');
  const out6 = sub(await disk(), 'Final from outside. Auto.', 'Outside wins this line.');
  await outside(out6); await sleep(1500);
  await d.keyboard.type(' Two.', { delay: 15 }); await leave(d);
  await d.waitForSelector('.lmd-mrg', { timeout: 15000 });
  check('con el guardado automático, un choque abre la pregunta sola en vez de guardar', (await disk()) === out6);
  await d.click('.lmd-mrg [data-esc]'); await d.waitForSelector('.lmd-mrg', { state: 'detached' }); await sleep(3000);
  const st6 = await state(d);
  check('y mientras no se decida, el guardado automático queda en pausa y lo dice', (await disk()) === out6 && st6.held && st6.dirty && st6.text === 'Saving paused: a conflict needs your decision' && !(await d.$('.lmd-mrg')), st6);
  await d.keyboard.press('Control+s'); await d.waitForSelector('.lmd-mrg', { timeout: 8000 }); await d.click('.lmd-mrg [data-mrg=both]'); await d.waitForSelector('.lmd-mrg', { state: 'detached' });
  const auto6 = await diskHas('Final from outside. Auto. Two.\n\nOutside wins this line.\n');
  check('decidido, se guarda y el indicador vuelve a lo normal', auto6 && !(await state(d)).held && !(await state(d)).dirty, [await state(d), (await disk()).slice(0, 500)]);
  await typeIn(d, 'Outside wins this line.', ' Then more.'); await leave(d);
  check('y el guardado automático sigue andando después', await diskHas('Outside wins this line. Then more.'));
  await dctx.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Windows suelta el perfil después */ }

  // ---------- La app: una nota de la nube, dos clientes ----------
  console.log('La app: una nota de la nube con dos clientes');
  const NOTE = '# Plan\n\n- [ ] Draft the brief\n- [ ] Review the numbers\n- [ ] Send to the client\n\nSummary line.\n';
  await api('PUT', '/notes/plan.md', { text: NOTE }, A.s);
  const c1 = await R.open(A); const c2 = await R.open(A);
  for (const c of [c1, c2]) { await c.page.goto(R.noteUrl('plan.md')); await c.page.waitForSelector('.markdown-body li.lmd-task-item'); await sleep(500); await watch(c.page); }
  // Los guardados del primero se pueden frenar en el camino: así tiene cambios sin subir cuando guarda el otro.
  let gate = null; let open = () => {};
  const holdPuts = () => { gate = new Promise((resolve) => { open = resolve; }); };
  await c1.ctx.route((url) => url.pathname.startsWith('/notes/'), async (route) => { if (route.request().method() === 'PUT' && gate) await gate; await route.continue(); });
  const putSeen = () => c1.page.waitForRequest((q) => q.method() === 'PUT' && /\/notes\/plan\.md/.test(q.url()), { timeout: 15000 });
  const cloud = async () => (await api('GET', '/notes/plan.md', undefined, A.s)).json;
  const cloudHas = async (text) => { for (let i = 0; i < 150; i++) { if ((await cloud()).text.includes(text)) return true; await sleep(100); } return false; };

  holdPuts(); let seen = putSeen();
  await tick(c1.page, 'Draft the brief'); await seen;
  await tick(c2.page, 'Send to the client');
  check('el segundo cliente guarda su tilde mientras el primero tiene el suyo sin subir', await cloudHas('- [x] Send to the client') && !(await cloud()).text.includes('- [x] Draft the brief'));
  gate = null; open();
  const merged = await cloudHas('- [x] Draft the brief');
  const tc = await toast(c1.page); const after1 = await cloud();
  check('el servidor rechaza el guardado hecho sobre la versión vieja y la app une: quedan los dos tildes', merged && after1.text === sub(sub(NOTE, '- [ ] Draft the brief', '- [x] Draft the brief'), '- [ ] Send to the client', '- [x] Send to the client'), after1.text);
  check('con el aviso de que se unieron cambios, nombrando a quien guardó', /^Changes (by ana|made elsewhere) were merged$/.test(tc.text) && tc.undo === 'Undo' && J(await boxes(c1.page)) === J(['[x] Draft the brief', '[ ] Review the numbers', '[x] Send to the client']), [tc, await boxes(c1.page)]);
  await c2.page.waitForFunction(() => document.querySelector('.lmd-article li.lmd-task-item input').checked, null, { timeout: 20000 });
  const said2 = await said(c2.page);
  check('el otro cliente, sin cambios propios, toma lo nuevo solo y dice de quién es', J(await boxes(c2.page)) === J(['[x] Draft the brief', '[ ] Review the numbers', '[x] Send to the client']) && said2.includes('Updated by ana') && !(await c2.page.$('.lmd-mrg-toast')), said2);
  await noToast(c1.page);

  // La IA cambia la nota por MCP con la nota abierta y sin cambios propios: entra sola y se dice que fue la IA.
  await sleep(1200); await said(c1.page);
  await mcp('set_task', { path: 'plan.md', task: 'Review the numbers' });
  await c1.page.waitForFunction(() => [...document.querySelectorAll('.lmd-article li.lmd-task-item input')].every((n) => n.checked), null, { timeout: 20000 });
  await sleep(300); const said3 = await said(c1.page);
  check('lo que escribe la IA entra solo en la nota abierta, y el aviso nombra a su token', said3.includes('Updated by Claude') && (await cloud()).text.includes('- [x] Review the numbers'), said3);

  // Choque en la nube: la persona edita una línea, la IA la cambia antes de que suba. Se pregunta.
  await c1.page.click('[data-act=mode-edit]'); await sleep(400);
  holdPuts(); seen = putSeen();
  await typeIn(c1.page, 'Summary line.', ' Mine.'); await leave(c1.page); await seen;
  const e5 = await mcp('edit_note', { path: 'plan.md', old_text: 'Summary line.', new_text: 'Summary by the AI.' });
  gate = null; open();
  await c1.page.waitForSelector('.lmd-mrg', { timeout: 20000 });
  const cd = await c1.page.evaluate(() => { const b = document.querySelector('.lmd-mrg'); return { labels: [...b.querySelectorAll('.lmd-mrg-label')].map((n) => n.textContent), texts: [...b.querySelectorAll('.lmd-mrg-text')].map((n) => n.textContent) }; });
  const held = await cloud();
  check('en la nube, la misma línea cambiada por la persona y por la IA abre la pregunta, y el servidor conserva lo de la IA', !e5.err && J(cd.texts) === J(['Summary line. Mine.', 'Summary by the AI.']) && cd.labels[0] === 'Yours' && cd.labels[1] === 'From Claude' && held.text.includes('Summary by the AI.') && !held.text.includes('Mine.'), [cd, held.text]);
  await sleep(2500);
  check('y mientras no se decide no sube nada', (await cloud()).rev === held.rev && (await state(c1.page)).held, await state(c1.page));
  await c1.page.click('.lmd-mrg [data-mrg=both]'); await c1.page.waitForSelector('.lmd-mrg', { state: 'detached' });
  const cboth = await cloudHas('Summary line. Mine.\n\nSummary by the AI.\n');
  check('dejar las dos sube las dos versiones del tramo', cboth && !(await state(c1.page)).held, (await cloud()).text);
  // Y al revés: la IA manda la nota entera sobre lo que leyó, mientras la persona destildó y escribió.
  const rd = await mcp('read_note', { path: 'plan.md' }); const rdText = rd.text;

  await typeIn(c1.page, 'Summary by the AI.', ' Checked by me.'); await leave(c1.page);
  await cloudHas('Summary by the AI. Checked by me.');
  const wAi = await mcp('write_note', { path: 'plan.md', text: sub(rdText, '# Plan', '# Plan for the launch'), base_rev: revIn(rd) });
  const fin = await cloud();
  check('la IA que reescribe la nota sobre su lectura no pisa lo que la persona escribió después', !wAi.err && /merged with yours/.test(wAi.text) && fin.text.startsWith('# Plan for the launch\n') && fin.text.includes('Summary by the AI. Checked by me.'), [wAi.text, fin.text]);
  await has(c1.page, 'Plan for the launch');
  check('y la app la toma sola', (await src(c1.page)) === fin.text && !(await c1.page.$('.lmd-mrg')));
  await c1.ctx.close(); await c2.ctx.close();

  check('ningún error de página en toda la prueba', R.errors.length === 0, R.errors.slice(0, 5));
  check('nada salió hacia la nube de verdad', R.outside.length === 0, R.outside.slice(0, 5));
} catch (e) {
  check('la prueba llegó hasta el final', false, String((e && e.stack) || e).slice(0, 900));
} finally {
  await R.close();
}
process.exit(done() ? 1 : 0);
