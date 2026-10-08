// La hoja de atajos de teclado (src/shortcuts.js): cómo se abre, qué muestra, y que lo que lista dispare algo.
//   BROWSER=firefox node shortcuts.mjs      BROWSER=webkit node shortcuts.mjs      (sin BROWSER: chromium)
import { rig, tally, sleep } from './rig.mjs';

const ENGINE = process.env.BROWSER || 'chromium';
const R = await rig({}, ENGINE);
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 5000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };
// El WebKit de las pruebas se presenta como una Mac: ahí el atajo va con ⌘ y los rótulos con sus símbolos.
const APPLE = ENGINE === 'webkit'; const MOD = APPLE ? 'Meta' : 'Control';

async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, lang, tools]) => { try { if (localStorage.getItem('keys:listo')) return; localStorage.setItem('keys:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, tools })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}]);
  return { ctx, page };
}
const SMALL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15' };
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
async function note(page, name, text, edit) {
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article'); await sleep(250);
  await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
const isOpen = (page) => page.evaluate(() => !!document.querySelector('.lmd-keys'));
const waitOpen = (page) => until(() => isOpen(page));
const waitShut = (page) => until(async () => !(await isOpen(page)));
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('.lmd-keys-row')].filter((r) => r.offsetParent).map((r) => r.dataset.id));
const keysOf = (page, id) => page.evaluate((i) => { const r = document.querySelector('.lmd-keys-row[data-id="' + i + '"] .lmd-keys-set'); return r ? r.getAttribute('aria-label') : null; }, id);
const flash = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
const TEXT = ['# Atajos', '', 'Uno dos tres.', '', 'Otro renglón.', ''].join('\n');

await step('Se abre con el botón, con ? y con Ctrl+/', async () => {
  const { ctx, page } = await open();
  await note(page, 'a.md', TEXT);
  const btn = await page.evaluate(() => { const b = document.querySelector('.lmd-keys-btn'); const r = b.getBoundingClientRect(); return { seen: getComputedStyle(b).display !== 'none' && r.width > 0, label: b.getAttribute('aria-label'), right: innerWidth - r.right, bottom: innerHeight - r.bottom, top: !!b.closest('.lmd-topbar') }; });
  check('el botón está abajo a la derecha, fuera de la barra de arriba', btn.seen && btn.label === 'Keyboard shortcuts' && btn.right < 60 && btn.bottom < 120 && !btn.top, btn);
  check('y la hoja no se cargó todavía', await page.evaluate(() => !LMD.shortcuts));
  await page.click('.lmd-keys-btn');
  check('el botón abre la hoja', await waitOpen(page));
  const dlg = await page.evaluate(() => { const c = document.querySelector('.lmd-keys-card'); return { role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), label: c.getAttribute('aria-label'), focus: document.activeElement.className, groups: [...document.querySelectorAll('.lmd-keys-group h4')].map((h) => h.textContent), foot: document.querySelector('.lmd-keys-foot').textContent }; });
  check('es un diálogo con nombre y el foco en el buscador', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.label === 'Keyboard shortcuts' && dlg.focus === 'lmd-keys-q', dlg);
  check('los grupos van en su orden', J(dlg.groups) === J(['Writing and formatting', 'Navigate', 'Files', 'Tools', 'Board', 'Diagram and formula editors', 'AI', 'General']), dlg.groups);
  check('el pie dice cómo abrirla', dlg.foot === 'Open this sheet with ?, or with ' + (APPLE ? '⌘' : 'Ctrl+') + '/ while typing.', dlg.foot);
  const fit = await page.evaluate(() => { const c = document.querySelector('.lmd-keys-card').getBoundingClientRect(); const b = document.querySelector('.lmd-keys-body'); const lefts = new Set([...document.querySelectorAll('.lmd-keys-group')].map((g) => Math.round(g.getBoundingClientRect().left))); return { in: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, side: b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, cols: lefts.size, kbd: document.querySelectorAll('.lmd-keys-row kbd').length }; });
  check('entra en la pantalla, sin scroll horizontal y en varias columnas', fit.in && fit.side && fit.cols >= 2 && fit.kbd > 60, fit);
  check('fuera de Mac las teclas van con su nombre', APPLE || await keysOf(page, 'save') === 'Ctrl+S' && await keysOf(page, 'redo') === 'Ctrl+Y / Ctrl+Shift+Z' && await keysOf(page, 'ai-ask') === 'Alt+Shift+Q');
  check('en la web no figuran las teclas que atiende la extensión, y sí las de la app', await page.evaluate(() => !document.querySelector('.lmd-keys-row[data-id=sidebar]') && !!document.querySelector('.lmd-keys-row[data-id=wiki]')));
  const bad = await page.evaluate(() => { const box = document.querySelector('.lmd-keys'); const t = box.textContent + [...box.querySelectorAll('[title], [aria-label], [placeholder]')].map((n) => (n.title || '') + (n.getAttribute('aria-label') || '') + (n.placeholder || '')).join(' '); return /[!¡—–]/.test(t); });
  check('sin signos de admiración ni rayas largas', !bad);
  check('cada texto tiene su inglés', J(await page.evaluate(() => LMD.shortcuts.LIST.filter((s) => LMD.t(s.text) === s.text || (s.when.ctx && LMD.t(s.when.ctx) === s.when.ctx)).map((s) => s.id))) === '[]');
  await page.keyboard.press('Escape');
  check('Escape la cierra y el foco vuelve al botón', await waitShut(page) && await page.evaluate(() => document.activeElement === document.querySelector('.lmd-keys-btn')));
  await blur(page);
  await page.keyboard.press('?');
  check('? la abre', await waitOpen(page));
  await page.mouse.click(6, 400);
  check('un clic afuera la cierra', await waitShut(page));
  await page.keyboard.press(MOD + '+/');
  check('Ctrl+/ la abre', await waitOpen(page));
  await page.keyboard.press(MOD + '+/');
  check('y la cierra', await waitShut(page));
  check('el archivo se pidió una sola vez', await page.evaluate(() => [...document.scripts].filter((s) => s.src.split('/').pop() === 'shortcuts.js').length) === 1);
  // Desde Ajustes > Avanzado, encima del panel.
  await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card'); await page.click('[data-ptab=adv]');
  await page.click('.lmd-panel [data-act=shortcuts]');
  check('Ajustes > Avanzado la abre', await waitOpen(page));
  await page.keyboard.press('Escape'); await waitShut(page); await sleep(150);
  check('y al cerrarla Ajustes sigue abierto', await page.evaluate(() => !document.querySelector('.lmd-panel').hidden));
  await ctx.close();
});

await step('Escribiendo: ? es una letra y Ctrl+/ abre igual', async () => {
  const { ctx, page } = await open();
  await note(page, 'b.md', TEXT, true);
  await page.locator('.lmd-article .lmd-editable', { hasText: 'Uno dos' }).first().click();
  await page.keyboard.press('Control+End'); await page.keyboard.type(' que?', { delay: 15 }); await sleep(200);
  check('? no abre la hoja mientras se escribe, y queda escrito', !(await isOpen(page)) && await page.evaluate(() => /que\?/.test(document.querySelector('.lmd-article').textContent)));
  await page.keyboard.press(MOD + '+/');
  check('Ctrl+/ la abre también escribiendo', await waitOpen(page));
  await page.keyboard.type('?');
  check('en el buscador de la hoja ? también es una letra', await isOpen(page) && await page.evaluate(() => document.querySelector('.lmd-keys-q').value === '?'));
  await page.keyboard.press('Escape'); await waitShut(page);
  check('al cerrarla el foco vuelve al bloque', await page.evaluate(() => !!document.activeElement && document.activeElement.isContentEditable));
  await ctx.close();
});

await step('El buscador filtra por acción y por tecla', async () => {
  const { ctx, page } = await open();
  await note(page, 'c.md', TEXT);
  await page.keyboard.press('?'); await waitOpen(page);
  const total = (await shown(page)).length;
  await page.fill('.lmd-keys-q', 'bold'); await sleep(120);
  const byName = await shown(page);
  check('por nombre', J(byName) === J(['bold', 'md-bold']), byName);
  await page.fill('.lmd-keys-q', APPLE ? '⌘s' : 'ctrl+s'); await sleep(120);
  const byKey = await shown(page);
  check('por tecla', byKey.includes('save') && (APPLE || byKey.includes('search')) && !byKey.includes('bold'), byKey);
  await page.fill('.lmd-keys-q', APPLE ? '⌘ s' : 'ctrl s'); await sleep(120);
  check('con o sin el signo más', (await shown(page)).includes('save'));
  await page.fill('.lmd-keys-q', 'board'); await sleep(120);
  const byGroup = await shown(page);
  check('por grupo', byGroup.includes('card-open') && byGroup.includes('card-save'), byGroup);
  await page.fill('.lmd-keys-q', 'zzzz'); await sleep(120);
  check('sin coincidencias lo dice', (await shown(page)).length === 0 && await page.evaluate(() => { const p = document.querySelector('.lmd-keys-none'); return !p.hidden && p.textContent === 'No shortcut matches.' && [...document.querySelectorAll('.lmd-keys-group')].every((g) => g.hidden); }));
  await page.fill('.lmd-keys-q', ''); await sleep(120);
  check('y vacío vuelve a mostrar todo', (await shown(page)).length === total && total > 40, total);
  await ctx.close();
});

await step('Una herramienta apagada sale atenuada y lleva a prenderla', async () => {
  const { ctx, page } = await open({ tools: { linkmap: true } });
  await note(page, 'd.md', TEXT);
  await page.keyboard.press('?'); await waitOpen(page);
  const st = await page.evaluate(() => { const r = (id) => { const li = document.querySelector('.lmd-keys-row[data-id=' + id + ']'); return li ? { off: li.classList.contains('lmd-keys-off'), link: (li.querySelector('[data-keys=tools]') || {}).textContent || '', dim: +getComputedStyle(li.querySelector('.lmd-keys-set')).opacity } : null; }; return { present: r('present'), linkmap: r('linkmap'), board: r('card-open'), save: r('save') }; });
  check('la apagada: atenuada y con su enlace', st.present.off && st.present.link === 'Turn on in Settings > Tools' && st.present.dim < 0.6, st.present);
  check('la prendida y las que no dependen de una herramienta, no', !st.linkmap.off && !st.linkmap.link && st.linkmap.dim === 1 && !st.board.off && !st.save.off, st);
  check('el enlace va una vez por herramienta: el resto de sus teclas dice dónde valen', await page.evaluate(() => { const li = document.querySelector('.lmd-keys-row[data-id=pres-next]'); const s = li.querySelector('small'); return li.classList.contains('lmd-keys-off') && li.querySelector('[data-keys=tools]').hidden && s.textContent === 'Presenting' && !s.hidden && document.querySelector('.lmd-keys-row[data-id=present] [data-keys=tools]').offsetParent !== null; }));
  await page.fill('.lmd-keys-q', 'next slide'); await sleep(120);
  check('y si el buscador deja una sola de esas teclas, el enlace va en ella', await page.evaluate(() => document.querySelector('.lmd-keys-row[data-id=pres-next] [data-keys=tools]').offsetParent !== null));
  await page.fill('.lmd-keys-q', ''); await sleep(120);
  await page.click('.lmd-keys-row[data-id=present] [data-keys=tools]');
  check('el enlace cierra la hoja y abre Ajustes > Herramientas', await waitShut(page) && await until(() => page.evaluate(() => { const b = document.querySelector('[data-ptab=tools]'); return !!b && b.classList.contains('lmd-on') && !!document.querySelector('.lmd-tl-card[data-tool=present]'); })));
  await ctx.close();
});

await step('En Mac las teclas van con sus símbolos', async () => {
  const { ctx, page } = await open({ ctx: MAC });
  await note(page, 'e.md', TEXT);
  await page.keyboard.press('Meta+/');
  check('⌘/ la abre', await waitOpen(page));
  const k = { save: await keysOf(page, 'save'), redo: await keysOf(page, 'redo'), search: await keysOf(page, 'search'), ask: await keysOf(page, 'ai-ask'), brk: await keysOf(page, 'break'), any: await keysOf(page, 'sheet-any'), apply: await keysOf(page, 'ed-apply') };
  check('⌘ ⌥ ⇧ en lugar de Ctrl Alt Shift', J(k) === J({ save: '⌘S', redo: '⇧⌘Z', search: '⇧⌘F', ask: '⌥⇧Q', brk: '⇧↩', any: '⌘/', apply: '⌘↩' }), k);
  check('cada símbolo en su tecla', await page.evaluate(() => [...document.querySelectorAll('.lmd-keys-row[data-id=search] kbd')].map((n) => n.textContent).join('|')) === '⇧|⌘|F');
  check('y coinciden con lo que la app ya escribe en sus títulos', await page.evaluate(() => LMD.keys('Ctrl+S') === LMD.shortcuts.keysOf('save') && LMD.keys('Alt+Shift+P') === LMD.shortcuts.keysOf('present') && LMD.keys('Ctrl+Y') === LMD.shortcuts.keysOf('redo') && LMD.keys('Ctrl+Enter') === LMD.shortcuts.keysOf('ed-apply')));
  check('el pie también', await page.evaluate(() => document.querySelector('.lmd-keys-foot').textContent) === 'Open this sheet with ?, or with ⌘/ while typing.');
  check('sin Ctrl, Alt ni Shift escritos', await page.evaluate(() => !/Ctrl|Alt|Shift/.test(document.querySelector('.lmd-keys-body').textContent)));
  await page.keyboard.press('Control+/'); await sleep(200);
  check('Ctrl+/ acá no es el atajo', await isOpen(page));
  await page.keyboard.press('Meta+/');
  check('⌘/ la cierra', await waitShut(page));
  await ctx.close();
});

if (ENGINE === 'chromium') await step('Pantalla chica y táctil: sin botón flotante, desde el menú', async () => {
  const { ctx, page } = await open({ ctx: SMALL });
  await note(page, 'f.md', TEXT);
  check('el botón flotante no aparece', await page.evaluate(() => getComputedStyle(document.querySelector('.lmd-keys-btn')).display === 'none'));
  await page.click('.lmd-topbar [data-act=more]'); await page.waitForSelector('.lmd-menu [data-more=shortcuts]');
  check('el menú la ofrece', await page.evaluate(() => document.querySelector('.lmd-menu [data-more=shortcuts]').textContent) === 'Keyboard shortcuts');
  await page.click('.lmd-menu [data-more=shortcuts]');
  check('y la abre', await waitOpen(page));
  await sleep(200);
  const fit = await page.evaluate(() => { const c = document.querySelector('.lmd-keys-card').getBoundingClientRect(); const b = document.querySelector('.lmd-keys-body'); const wide = [...document.querySelectorAll('.lmd-keys-row')].filter((r) => r.getBoundingClientRect().right > innerWidth + 1).length; return { in: c.left >= 0 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1, side: b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, wide, scrolls: b.scrollHeight > b.clientHeight, focus: (document.activeElement.dataset || {}).keys || '' }; });
  check('entra en el ancho, se recorre hacia abajo y no levanta el teclado', fit.in && fit.side && !fit.wide && fit.scrolls && fit.focus === 'close', fit);
  await page.click('.lmd-keys [data-keys=close]');
  check('su botón la cierra', await waitShut(page));
  await ctx.close();
});

// ---------- Lo que la hoja dice, pasa ----------
// Cada atajo listado tiene acá su prueba, o figura abajo con el motivo por el que no se dispara desde esta batería.
const ELSEWHERE = {
  follow: 'necesita un enlace a otra pestaña', print: 'abre el cuadro de impresión del navegador', 'pres-full': 'la pantalla completa pide un gesto real', 'pres-pdf': 'abre el cuadro de impresión',
  sidebar: 'lo atiende la extensión', centered: 'lo atiende la extensión', refresh: 'lo atiende la extensión', theme: 'lo atiende la extensión',
  speak: 'depende de las voces del equipo (voice.mjs)', dictate: 'necesita micrófono (voice.mjs)', 'daily-month': 'tools.mjs', wiki: 'links.mjs', replace: 'extras.mjs', 'replace-all': 'extras.mjs',
  'card-tag': 'data.mjs', 'col-name': 'data.mjs', 'ed-apply': 'diagram-editor.mjs y formulas.mjs', 'ed-cancel': 'diagram-editor.mjs y formulas.mjs', 'ed-indent': 'diagram-editor.mjs', 'ed-hole': 'formulas.mjs',
  'code-done': 'writing.mjs', 'list-level': 'lists.mjs', 'list-move': 'lists.mjs', 'ai-here': 'assistant.mjs', 'ai-send': 'assistant.mjs', 'ai-gen': 'assistant.mjs', comment: 'ai.mjs',
};
const BODY = ['# Atajos', '', 'Uno dos tres.', '', 'Otro renglón.', '', '- [ ] primera', '- [ ] segunda', '', '| a | b |', '|---|---|', '| uno | dos |', '', '```kanban', '## Por hacer', '- Tarjeta de prueba', '## Hecho', '```', '', '## Dos', '', 'Texto de la segunda.', '', '## Tres', '', 'Fin.', ''].join('\n');
// Negrita y cursiva las hace el navegador: el Firefox de las pruebas no aplica esas teclas a un texto editable.
const NO_NATIVE = ENGINE === 'firefox'; if (NO_NATIVE) { ELSEWHERE.bold = ELSEWHERE.italic = 'es del navegador'; }
const fired = {};
await step('Cada atajo listado dispara algo', async () => {
  const { ctx, page } = await open({ tools: { present: true, daily: true, linkmap: true, assistant: true } });
  await note(page, 'g.md', BODY, true);
  await until(() => page.evaluate(() => !!(LMD.present && LMD.daily && LMD.linkmap && LMD.assistant)), 8000);
  const para = (has) => page.locator('.lmd-article .lmd-editable', { hasText: has }).first();
  const html = (has) => page.evaluate((h) => { const n = [...document.querySelectorAll('.lmd-article .lmd-editable')].find((x) => x.textContent.includes(h)); return n ? n.innerHTML : ''; }, has);
  const probe = async (id, fn) => { try { fired[id] = !!(await fn()); } catch (e) { fired[id] = false; console.log('     ' + id + ': ' + String(e && e.message || e).split('\n')[0]); } };
  const active = (sel) => page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), sel);

  // Formato
  if (!NO_NATIVE) await probe('bold', async () => { await para('Uno dos').click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Control+B'); const h = await html('Uno dos'); if (process.env.DEBUG) console.log('     bold: ' + h); return /<(b|strong)\b/.test(h); });
  if (!NO_NATIVE) await probe('italic', async () => { await page.keyboard.press('Control+I'); return /<(i|em)\b/.test(await html('Uno dos')); });
  await probe('link', async () => { await page.keyboard.press(MOD + '+K'); const ok = await until(() => page.evaluate(() => !!document.querySelector('.lmd-ask'))); await page.keyboard.press('Escape'); await until(() => page.evaluate(() => !document.querySelector('.lmd-ask'))); return ok; });
  await probe('break', async () => { await para('Otro').click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('abajo'); return /<br/i.test(await html('Otro')); });
  await probe('revert', async () => { await page.keyboard.type(' XYZ'); await page.keyboard.press('Escape'); await sleep(250); return !(await page.evaluate(() => /XYZ|abajo/.test(document.querySelector('.lmd-article').textContent))); });
  await probe('md-bold', async () => { await para('Otro').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' **fuerte**', { delay: 15 }); return /<strong>fuerte<\/strong>/.test(await html('Otro')); });
  await probe('enter', async () => { await page.keyboard.press('Enter'); return until(() => page.evaluate(() => { const a = document.activeElement; return !!a && a.classList.contains('lmd-draft'); })); });
  const kind = () => page.evaluate(() => (document.activeElement.dataset || {}).kind || '');
  const typed = async (id, text, want) => probe(id, async () => { await page.keyboard.type(text, { delay: 15 }); const k = await kind(); await page.keyboard.press('Backspace'); await sleep(60); return k === want; });
  await typed('md-title', '## ', 'h2'); await typed('md-list', '- ', 'ul'); await typed('md-num', '1. ', 'ol'); await typed('md-quote', '> ', 'quote'); await typed('md-task', '[] ', 'task');
  await page.keyboard.press('Escape'); await sleep(250);
  await probe('cell', async () => { await page.locator('.lmd-article .lmd-cell', { hasText: 'uno' }).click(); await page.keyboard.press('Tab'); const next = await page.evaluate(() => document.activeElement.textContent); await page.keyboard.press('Shift+Tab'); const prev = await page.evaluate(() => document.activeElement.textContent); return next === 'dos' && prev === 'uno'; });
  await blur(page); await sleep(200);
  await probe('task-move', async () => { await page.evaluate(() => document.querySelector('.lmd-cl-grip').focus()); await page.keyboard.press('ArrowDown'); await sleep(250); return /segunda[\s\S]*primera/.test(await page.evaluate(() => document.querySelector('.lmd-article').textContent)); });
  await blur(page);

  // Archivos, deshacer y rehacer
  await probe('save', async () => { await page.keyboard.press(MOD + '+S'); return until(async () => /fuerte/.test(await saved(page, 'g.md'))); });
  await probe('undo', async () => { await blur(page); await page.keyboard.press(MOD + '+Z'); return until(async () => /undone/i.test(await flash(page)), 2500); });
  await probe('redo', async () => { await page.keyboard.press(MOD + '+Y'); const a = await until(async () => /redone/i.test(await flash(page)), 2500); await page.keyboard.press(MOD + '+Z'); await sleep(150); await page.keyboard.press(MOD + '+Shift+Z'); return a && await until(async () => /redone/i.test(await flash(page)), 2500); });
  await probe('rename', async () => { await page.keyboard.press('F2'); const ok = await until(() => active('.lmd-docname-input'), 2500); await page.keyboard.press('Escape'); await sleep(200); return ok; });

  // Navegar
  await probe('search', async () => { await page.keyboard.press(MOD + '+Shift+F'); return until(() => page.evaluate(() => document.activeElement === document.querySelector('.lmd-search input, input.lmd-search-input') || (document.activeElement.closest && !!document.activeElement.closest('.lmd-search'))), 2500); });
  await probe('search-step', async () => { await page.keyboard.type('e', { delay: 20 }); await sleep(500); const c = () => page.evaluate(() => document.querySelector('.lmd-search-count').textContent); const a = await c(); await page.keyboard.press('Enter'); await sleep(200); const b = await c(); await page.keyboard.press('Shift+Enter'); await sleep(200); const d = await c(); return a !== b && b !== d; });
  await probe('close', async () => { await page.keyboard.press('Escape'); await sleep(200); return page.evaluate(() => !document.documentElement.classList.contains('lmd-searching')); });
  await blur(page);
  await probe('menu', async () => { await page.focus('.lmd-topbar [data-act=export]'); await page.keyboard.press('Enter'); await page.waitForSelector('.lmd-menu [data-more]'); await page.keyboard.press('ArrowDown'); return page.evaluate(() => document.activeElement === document.querySelectorAll('.lmd-menu [data-more]')[1]); });
  await probe('menu-ends', async () => { await page.keyboard.press('End'); const last = await page.evaluate(() => { const all = document.querySelectorAll('.lmd-menu [data-more]'); return document.activeElement === all[all.length - 1]; }); await page.keyboard.press('Home'); const first = await page.evaluate(() => document.activeElement === document.querySelector('.lmd-menu [data-more]')); await page.keyboard.press('Escape'); await sleep(150); return last && first && await page.evaluate(() => !document.querySelector('.lmd-menu-export')); });

  // La hoja
  await blur(page);
  await probe('sheet', async () => { await page.keyboard.press('?'); const ok = await waitOpen(page); await page.keyboard.press('Escape'); await waitShut(page); return ok; });
  await probe('sheet-any', async () => { await page.keyboard.press(MOD + '+/'); const ok = await waitOpen(page); await page.keyboard.press('Escape'); await waitShut(page); return ok; });

  // Tablero
  await probe('card-open', async () => { await page.evaluate(() => document.querySelector('.lmd-article .lmd-card').focus()); await page.keyboard.press('Enter'); return until(() => page.evaluate(() => !!document.querySelector('.lmd-cd')), 3000); });
  await probe('card-save', async () => { await page.fill('.lmd-cd [data-cd=title]', 'Tarjeta cambiada'); await page.keyboard.press('Control+Enter'); return until(() => page.evaluate(() => !document.querySelector('.lmd-cd') && /Tarjeta cambiada/.test(document.querySelector('.lmd-article').textContent)), 3000); });
  await blur(page);

  // Herramientas
  await probe('ai-ask', async () => { const n = () => page.evaluate(() => document.querySelectorAll('.lmd-ask, [class*="lmd-ai-panel"], html.lmd-ai-open').length); const a = await n(); await page.keyboard.press('Alt+Shift+Q'); const ok = await until(async () => (await n()) > a, 4000); if (process.env.DEBUG) console.log('     ai-ask: ' + await page.evaluate(() => [LMD.tools.isOn('assistant'), document.documentElement.className, [...document.querySelectorAll('[class*=lmd-ai]')].map((x) => x.className).join(','), (document.querySelector('.lmd-status') || {}).textContent].join(' | '))); await page.evaluate(() => { if (LMD.assistant.state().panel) LMD.assistant.ask(); }); await sleep(300); return ok; });
  await probe('linkmap', async () => { await page.keyboard.press('Alt+Shift+G'); const ok = await until(() => page.evaluate(() => !!document.querySelector('.lmd-map')), 4000); await page.evaluate(() => { const b = document.querySelector('.lmd-map [data-map=close]'); if (b) b.click(); }); await until(() => page.evaluate(() => !document.querySelector('.lmd-map'))); return ok; });
  await blur(page);
  const pres = () => page.evaluate(() => LMD.present.state());
  await probe('present', async () => { await page.click('[data-act=mode-read]'); await sleep(300); await page.keyboard.press('Alt+Shift+P'); return until(async () => !!(await pres()), 4000); });
  await probe('pres-next', async () => { await page.keyboard.press('ArrowRight'); const a = (await pres()).i; await page.keyboard.press(' '); return a === 1 && (await pres()).i === 2; });
  await probe('pres-prev', async () => { await page.keyboard.press('ArrowLeft'); const a = (await pres()).i; await page.keyboard.press('Backspace'); return a === 1 && (await pres()).i === 0; });
  await probe('pres-ends', async () => { await page.keyboard.press('End'); const s = await pres(); await page.keyboard.press('Home'); return s.i === s.total - 1 && (await pres()).i === 0; });
  await probe('pres-over', async () => { await page.keyboard.press('o'); const a = (await pres()).over; await page.keyboard.press('o'); return a && !(await pres()).over; });
  await probe('pres-laser', async () => { await page.keyboard.press('l'); const a = (await pres()).laser; await page.keyboard.press('l'); return !!a && !(await pres()).laser; });
  await probe('pres-notes', async () => { await page.keyboard.press('n'); const a = (await pres()).notes; await page.keyboard.press('n'); return !!a && !(await pres()).notes; });
  await probe('sheet-in-pres', async () => { await page.keyboard.press('?'); await sleep(250); return !(await isOpen(page)); });
  await page.keyboard.press('Alt+Shift+P'); await until(async () => !(await pres()));
  await probe('daily', async () => { await page.keyboard.press('Alt+Shift+H'); return until(() => page.evaluate(() => /\d{4}-\d{2}-\d{2}/.test(decodeURIComponent(location.href))), 5000); });

  check('con la presentación abierta, ? es de ella y no abre la hoja', fired['sheet-in-pres'] === true); delete fired['sheet-in-pres'];
  const ids = await page.evaluate(() => LMD.shortcuts.LIST.map((s) => s.id));
  const failed = Object.keys(fired).filter((id) => !fired[id]);
  check('todos los que se pueden disparar acá, disparan', failed.length === 0 && Object.keys(fired).length >= 30, { failed, n: Object.keys(fired).length });
  const loose = ids.filter((id) => !(id in fired) && !ELSEWHERE[id]); const gone = Object.keys(fired).concat(Object.keys(ELSEWHERE)).filter((id) => !ids.includes(id));
  check('ningún atajo de la tabla queda sin prueba ni motivo, y ninguna prueba es de un atajo que ya no está', loose.length === 0 && gone.length === 0, { loose, gone });
  check('los ids de la tabla no se repiten y cada uno tiene grupo', new Set(ids).size === ids.length && await page.evaluate(() => LMD.shortcuts.LIST.every((s) => LMD.shortcuts.GROUPS.some((g) => g[0] === s.group) && s.keys && s.text)));
  // Los títulos de la app que nombran un atajo dicen el mismo que la tabla.
  const titles = await page.evaluate(() => { const all = new Set(LMD.shortcuts.LIST.flatMap((s) => LMD.shortcuts.combos(s.keys).map((c) => c.plain))); all.add('?'); return [...document.querySelectorAll('[title]')].map((n) => /\(([^()]*)\)$/.exec(n.title)).filter((m) => m && /^(Ctrl|Alt|Shift|F\d|\?)/.test(m[1])).map((m) => m[1]).filter((k) => !all.has(k)); });
  check('los títulos con un atajo coinciden con la tabla', titles.length === 0, titles);
  await ctx.close();
});

check('sin errores de página', R.errors.length === 0, R.errors.slice(0, 3));
await R.close();
process.exit(done() ? 1 : 0);
