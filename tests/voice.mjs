// Herramientas, leer en voz alta y dictado.
//   - La gramática del dictado (LMD.voice.parse) sin micrófono: texto, fórmula y diagrama, en español y en inglés.
//   - Ajustes > Herramientas: las tarjetas, los interruptores y que el código de cada una se pide recién al prenderla.
//   - Leer en voz alta con un sintetizador de prueba: el orden, lo que se anuncia, la marca, la pausa y los controles.
//   - Dictado de punta a punta con un reconocedor de prueba: provisorios, definitivos, órdenes, fórmula, diagrama,
//     el aviso de privacidad, el reconocimiento en el dispositivo y todo lo que corta el micrófono.
//   - Pantalla chica.
// Ningún micrófono ni voz de verdad: el reconocedor y el sintetizador se reemplazan antes de que cargue la app.
//   BROWSER=firefox node voice.mjs      BROWSER=webkit node voice.mjs      (sin BROWSER: chromium)
import { rig, tally, sleep, root } from './rig.mjs';
import fs from 'fs'; import path from 'path'; import vm from 'vm';

const ENGINE = process.env.BROWSER || 'chromium';
const R = await rig({}, ENGINE);
const { check, done } = tally();
const J = (v) => JSON.stringify(v);
const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(80); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { check(name + ': sin excepciones', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); } };

// ---------- Dobles de prueba ----------
// El reconocedor: anota cómo se lo arrancó y emite lo que la prueba le pide.
const fakeRecognizer = (conf) => {
  const S = window.__sr = { log: [], current: null, local: conf.local || 'none', installOk: !!conf.installOk, deny: false };
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.processLocally = false; this._on = false; }
    start() {
      if (this._on) throw new DOMException('already started', 'InvalidStateError');
      this._on = true; S.current = this; S.log.push('start:' + this.lang + ':' + (this.processLocally ? 'local' : 'cloud') + ':' + (this.continuous && this.interimResults ? 'ok' : 'mal'));
      setTimeout(() => {
        if (S.deny) { this._on = false; if (this.onerror) this.onerror({ error: 'not-allowed' }); if (this.onend) this.onend({}); return; }
        if (this.onstart) this.onstart({}); if (this.onaudiostart) this.onaudiostart({});
      }, 10);
    }
    stop() { if (!this._on) return; this._on = false; S.log.push('stop'); setTimeout(() => { if (this.onend) this.onend({}); }, 10); }
    abort() { if (!this._on) return; this._on = false; S.log.push('abort'); setTimeout(() => { if (this.onend) this.onend({}); }, 10); }
  }
  if (S.local !== 'none') {
    FakeSR.available = (o) => { S.log.push('available:' + o.langs[0] + ':' + o.processLocally); return Promise.resolve(S.local); };
    FakeSR.install = (o) => { S.log.push('install:' + o.langs[0]); if (S.installOk) S.local = 'available'; return Promise.resolve(S.installOk); };
  }
  S.emit = (text, final) => { const r = S.current; if (!r || !r._on) return false; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: !!final })] }); return true; };
  // El navegador corta por su cuenta, como hace cada tanto.
  S.drop = (error) => { const r = S.current; r._on = false; if (error && r.onerror) r.onerror({ error }); if (r.onend) r.onend({}); };
  S.on = () => !!(S.current && S.current._on);
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeSR, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeSR, configurable: true, writable: true });
};
const noRecognizer = () => { ['SpeechRecognition', 'webkitSpeechRecognition'].forEach((k) => Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true })); };
// El sintetizador: anota lo que se le pide leer y "termina" cada frase enseguida, salvo que se lo frene.
const fakeSynth = (conf) => {
  const V = (name, lang, uri, def) => ({ name, lang, voiceURI: uri, localService: true, default: !!def });
  const S = window.__tts = { log: [], cancels: 0, hold: false, cur: null, voices: conf.none ? [] : [V('Prueba ES', 'es-ES', 'v-es'), V('Test US', 'en-US', 'v-us', true), V('Test GB', 'en-GB', 'v-gb')] };
  const end = (u) => { if (S.cur !== u) return; S.cur = null; if (u.onend) u.onend({ type: 'end' }); };
  const fake = {
    getVoices: () => S.voices.slice(), addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
    get speaking() { return !!S.cur; }, get pending() { return false; }, get paused() { return false; },
    speak(u) { S.cur = u; S.log.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : '', rate: u.rate, t: Math.round(performance.now()), on: (document.querySelector('.lmd-speaking') || {}).tagName || '' }); if (!S.hold) setTimeout(() => end(u), 12); },
    cancel() { S.cancels++; const u = S.cur; S.cur = null; if (u && u.onerror) setTimeout(() => u.onerror({ type: 'error', error: 'interrupted' }), 0); },
  };
  S.release = () => { const u = S.cur; if (u) end(u); };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  // La frase también es de prueba: la de verdad solo acepta voces del navegador.
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; };
};

// Una ventana con sus dobles, el idioma de la app y qué herramientas arrancan prendidas.
async function open(o) {
  o = o || {};
  const { ctx, page } = await R.open(null, o.ctx);
  await page.addInitScript(([base, lang, tools, consent]) => { try { if (localStorage.getItem('voz:listo')) return; localStorage.setItem('voz:listo', '1'); localStorage.setItem('mdtools:settings', JSON.stringify({ cloudUrl: base, language: lang, tools })); if (consent) localStorage.setItem('mdtools:dictation', JSON.stringify({ consent: 1 })); } catch (e) { /* página en blanco */ } }, [R.base, o.lang || 'en', o.tools || {}, !!o.consent]);
  if (o.sr === false) await page.addInitScript(noRecognizer); else await page.addInitScript(fakeRecognizer, o.sr || {});
  await page.addInitScript(fakeSynth, o.tts || {});
  return { ctx, page };
}
const noteUrl = (name, edit) => R.home + '?f=' + encodeURIComponent('local/' + name) + (edit ? '&edit=1' : '');
// Abre una nota del navegador con ese texto.
async function note(page, name, text, edit) {
  await page.goto(R.home); await page.waitForSelector('.lmd-home, .lmd-article');
  await page.evaluate(([n, t]) => LMD.store.notePut(n, t), [name, text]);
  await page.goto(noteUrl(name, edit)); await page.waitForSelector(edit ? '.lmd-editing .lmd-article' : '.lmd-article > *');
  await sleep(350);
}
const saved = (page, name) => page.evaluate(async (n) => ((await LMD.store.noteGet(n)) || {}).text || '', name);
const stored = (page, key) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem('mdtools:' + k)); } catch (e) { return null; } }, key);
const say = async (page, text, final) => { const ok = await page.evaluate(([t, f]) => window.__sr.emit(t, f), [text, final !== false]); await sleep(final === false ? 60 : 140); return ok; };
const srLog = (page) => page.evaluate(() => window.__sr.log.slice());
const flashText = (page) => page.evaluate(() => (document.querySelector('.lmd-status') || {}).textContent || '');
const dct = (page) => page.evaluate(() => (LMD.dictate ? LMD.dictate.state() : null));
const micOn = async (page) => { await page.click('.lmd-dct-mic'); };
const listening = (page) => until(() => page.evaluate(() => !!document.querySelector('.lmd-dct-bar') && LMD.dictate.state().active), 4000);
const stopped = (page) => until(() => page.evaluate(() => !document.querySelector('.lmd-dct-bar') && !LMD.dictate.state().active && !window.__sr.on()), 4000);
// Deja el cursor al final del último bloque editable, o en uno nuevo si la nota está vacía.
const caretLast = async (page) => {
  const n = await page.locator('.lmd-article .lmd-editable').count();
  if (n) { await page.locator('.lmd-article .lmd-editable').last().click(); await page.keyboard.press('Control+End'); }
  else { await page.click('.lmd-article .lmd-add'); await page.evaluate(() => LMD.write.closeMenu()); }
  await sleep(150);
};

try {
  // ---------- La gramática, sin navegador ----------
  await step('Gramática: texto, fórmula y diagrama', async () => {
    const box = { }; box.self = box; vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(root, 'src', 'voice.js'), 'utf8'), box);
    const P = box.LMD.voice.parse;
    const text = (lang, said, want, ctx) => { const got = P(said, 'text', lang, ctx).text; check('texto ' + lang + ': ' + said, got === want, got); };
    const ops = (lang, said, want) => { const got = P(said, 'text', lang).ops.map((o) => o.op + (o.kind ? ':' + o.kind : '') + (o.mode ? ':' + o.mode + ':' + o.rest : '') + (o.done ? ':done' : '')).join(' '); check('órdenes ' + lang + ': ' + said, got === want, got); };
    const tex = (lang, said, want) => { const got = P(said, 'formula', lang).latex; check('fórmula ' + lang + ': ' + said, got === want, got); };
    const dgm = (lang, said, want) => { const got = P(said, 'diagram', lang).mermaid; check('diagrama ' + lang + ': ' + said.replace(/\n/g, ' / '), got === ['flowchart TD'].concat(want).join('\n'), got); };

    // Texto, español
    text('es', 'hola mundo coma esto es una prueba punto', 'Hola mundo, esto es una prueba.');
    text('es', 'el punto es que no llegó', 'El punto es que no llegó');
    text('es', 'una coma de más', 'Una coma de más');
    text('es', 'título introducción', '# Introducción');
    text('es', 'subtítulo los detalles punto y aparte ahora sigo', '## Los detalles.\n\nAhora sigo');
    text('es', 'título resumen del mes nueva línea ventas arriba dos puntos bien', '# Resumen del mes\n\nVentas arriba: bien');
    text('es', 'nueva lista manzanas siguiente peras siguiente uvas', '- Manzanas\n- Peras\n- Uvas');
    text('es', 'la siguiente semana viajo', 'La siguiente semana viajo');
    text('es', 'al día siguiente llovió', 'Al día siguiente llovió');
    text('es', 'peras siguiente uvas', 'Peras siguiente uvas');
    text('es', 'peras siguiente uvas', 'Peras\n\nUvas', { list: true });
    text('es', 'tarea comprar pan', '- [ ] Comprar pan');
    text('es', 'tarea hecha llamar a Juan', '- [x] Llamar a Juan');
    text('es', 'tarea uno tarea dos tarea hecha tres', '- [ ] Uno\n- [ ] Dos\n- [x] Tres');
    text('es', 'cita el que busca encuentra', '> El que busca encuentra');
    text('es', 'esto es negrita muy importante fin negrita y sigue', 'Esto es **muy importante** y sigue');
    text('es', 'cursiva suave fin cursiva punto', '*suave*.');
    text('es', 'usá código npm install fin código para instalar', 'Usá `npm install` para instalar');
    text('es', 'abre interrogación cómo estás signo de pregunta', '¿Cómo estás?');
    text('es', 'hola punto y coma chau puntos suspensivos', 'Hola; chau…');
    text('es', 'abre paréntesis nota cierra paréntesis listo', '(nota) listo');
    text('es', 'literal punto final', 'Punto final');
    text('es', 'no quiero deshacer nada', 'No quiero deshacer nada');
    text('es', 'la fórmula es simple', 'La fórmula es simple');
    ops('es', 'deshacer', 'undo');
    ops('es', 'borrar eso', 'scratch');
    ops('es', 'terminar dictado', 'stop');
    ops('es', 'hola punto y aparte', 'text punct break');
    ops('es', 'título', 'block:h1');
    ops('es', 'título introducción', 'block:h1 text break');
    ops('es', 'la energía es fórmula e igual m c al cuadrado fin fórmula', 'text mode:formula:e igual m c al cuadrado fin fórmula');
    ops('es', 'insertar ecuación x más uno', 'mode:formula:x más uno');
    ops('es', 'diagrama de flujo inicio pedido', 'mode:diagram:inicio pedido');

    // Texto, inglés
    text('en', 'hello world comma this is a test period', 'Hello world, this is a test.');
    text('en', 'the period ended', 'The period ended');
    text('en', 'title introduction', '# Introduction');
    text('en', 'subtitle the details new paragraph and now more', '## The details\n\nAnd now more');
    text('en', 'new list apples next pears next item grapes', '- Apples\n- Pears\n- Grapes');
    text('en', 'the next week I travel', 'The next week I travel');
    text('en', 'task buy bread', '- [ ] Buy bread');
    text('en', 'task done call John', '- [x] Call John');
    text('en', 'quote seek and you shall find', '> Seek and you shall find');
    text('en', 'this is bold very important end bold and more', 'This is **very important** and more');
    text('en', 'italic soft end italic', '*soft*');
    text('en', 'run code npm install end code first', 'Run `npm install` first');
    text('en', 'what time is it question mark', 'What time is it?');
    text('en', 'open quote hi close quote', '“hi”');
    text('en', 'literal comma is a word', 'Comma is a word');
    ops('en', 'undo', 'undo');
    ops('en', 'scratch that', 'scratch');
    ops('en', 'stop dictation', 'stop');
    ops('en', 'insert equation x squared end formula', 'mode:formula:x squared end formula');
    ops('en', 'flowchart start order', 'mode:diagram:start order');

    // Fórmula, español
    tex('es', 'x al cuadrado más dos x menos tres igual cero', 'x^{2} + 2x - 3 = 0');
    tex('es', 'a sobre b', '\\frac{a}{b}');
    tex('es', 'a dividido b', '\\frac{a}{b}');
    tex('es', 'fracción a más b sobre c menos d fin fracción', '\\frac{a + b}{c - d}');
    tex('es', 'raíz cuadrada de x', '\\sqrt{x}');
    tex('es', 'raíz cúbica de veintisiete igual tres', '\\sqrt[3]{27} = 3');
    tex('es', 'raíz de abre paréntesis x más uno cierra paréntesis', '\\sqrt{x + 1}');
    tex('es', 'abre paréntesis a más b cierra paréntesis al cuadrado', '\\left(a + b\\right)^{2}');
    tex('es', 'x subíndice uno más x sub dos', 'x_{1} + x_{2}');
    tex('es', 'e elevado a menos x', 'e^{-x}');
    tex('es', 'dos elevado a la n', '2^{n}');
    tex('es', 'x al cubo', 'x^{3}');
    tex('es', 'x distinto de cero', 'x \\neq 0');
    tex('es', 'a mayor o igual que b', 'a \\geq b');
    tex('es', 'a menor o igual que b', 'a \\leq b');
    tex('es', 'a mayor que b', 'a > b');
    tex('es', 'a menor que b', 'a < b');
    tex('es', 'sumatoria de x sub i desde i igual uno hasta n', '\\sum_{i = 1}^{n} x_{i}');
    tex('es', 'suma de i al cuadrado desde i igual cero hasta infinito', '\\sum_{i = 0}^{\\infty} i^{2}');
    tex('es', 'integral de x al cuadrado entre cero y uno', '\\int_{0}^{1} x^{2}');
    tex('es', 'integral de x al cuadrado diferencial x entre cero y uno', '\\int_{0}^{1} x^{2}\\,dx');
    tex('es', 'límite cuando x tiende a infinito de uno sobre x', '\\lim_{x \\to \\infty} \\frac{1}{x}');
    tex('es', 'dos pi r', '2\\pi r');
    tex('es', 'alfa más beta igual gamma', '\\alpha + \\beta = \\gamma');
    tex('es', 'delta mayúscula x', '\\Delta x');
    tex('es', 'theta igual pi sobre dos', '\\theta = \\frac{\\pi}{2}');
    tex('es', 'cincuenta por ciento', '50\\%');
    tex('es', 'uno coma cinco por diez', '1{,}5 \\cdot 10');
    tex('es', 'treinta y cinco más ciento veinte', '35 + 120');
    tex('es', 'dos mil veinticuatro', '2024');
    tex('es', 'equis por i griega', 'x \\cdot y');
    tex('es', 'x más perro verde igual y', 'x + \\text{perro verde} = y');
    tex('es', '2x + 3 = 7', '2x + 3 = 7');
    tex('es', 'x mayor que 1,5', 'x > 1{,}5');
    tex('es', 'n factorial', 'n!');
    { const r = P('e igual m c al cuadrado fin fórmula y sigue el texto', 'formula', 'es'); check('fórmula es: "fin fórmula" cierra y deja lo que sigue', r.latex === 'e = mc^{2}' && r.done && !r.stop && r.rest === 'y sigue el texto', r); }
    { const r = P('x más uno terminar dictado', 'formula', 'es'); check('fórmula es: "terminar dictado" cierra y corta', r.latex === 'x + 1' && r.done && r.stop, r); }
    { const r = P('x más', 'formula', 'es'); check('fórmula es: a medio decir no se rompe', r.latex === 'x +' && !r.done, r); }

    // Fórmula, inglés
    tex('en', 'x squared plus two x minus three equals zero', 'x^{2} + 2x - 3 = 0');
    tex('en', 'a over b', '\\frac{a}{b}');
    tex('en', 'a divided by b', '\\frac{a}{b}');
    tex('en', 'fraction a plus b over c minus d end fraction', '\\frac{a + b}{c - d}');
    tex('en', 'square root of x', '\\sqrt{x}');
    tex('en', 'cube root of twenty seven equals three', '\\sqrt[3]{27} = 3');
    tex('en', 'open parenthesis a plus b close parenthesis squared', '\\left(a + b\\right)^{2}');
    tex('en', 'x sub one plus x sub two', 'x_{1} + x_{2}');
    tex('en', 'e to the power of minus x', 'e^{-x}');
    tex('en', 'two to the n', '2^{n}');
    tex('en', 'x cubed', 'x^{3}');
    tex('en', 'x not equal to zero', 'x \\neq 0');
    tex('en', 'a greater than or equal to b', 'a \\geq b');
    tex('en', 'a less than b', 'a < b');
    tex('en', 'sum of x sub i from i equals one to n', '\\sum_{i = 1}^{n} x_{i}');
    tex('en', 'sum from i equals one to n of i squared', '\\sum_{i = 1}^{n} i^{2}');
    tex('en', 'integral of x squared from zero to one', '\\int_{0}^{1} x^{2}');
    tex('en', 'limit as x approaches infinity of one over x', '\\lim_{x \\to \\infty} \\frac{1}{x}');
    tex('en', 'two pi r', '2\\pi r');
    tex('en', 'alpha plus beta equals gamma', '\\alpha + \\beta = \\gamma');
    tex('en', 'capital delta x', '\\Delta x');
    tex('en', 'fifty percent', '50\\%');
    tex('en', 'one point five times ten', '1.5 \\cdot 10');
    tex('en', 'one hundred and twenty five plus thirty', '125 + 30');
    tex('en', 'twenty-five', '25');
    tex('en', 'x plus green dog equals y', 'x + \\text{green dog} = y');
    tex('en', 'sine of x', '\\sin x');
    { const r = P('e equals m c squared end formula and more text', 'formula', 'en'); check('fórmula en: "end formula" cierra y deja lo que sigue', r.latex === 'e = mc^{2}' && r.done && r.rest === 'and more text', r); }

    // Diagrama, español
    dgm('es', 'inicio pedido recibido\ndespués revisar stock\ndecisión hay stock\ndespués enviar pedido\nsi no avisar al cliente\nfin entregado',
      ['  n1(["Pedido recibido"])', '  n2["Revisar stock"]', '  n3{"¿Hay stock?"}', '  n4["Enviar pedido"]', '  n5["Avisar al cliente"]', '  n6(["Entregado"])', '  n1 --> n2', '  n2 --> n3', '  n3 -->|"Sí"| n4', '  n3 -->|"No"| n5', '  n5 --> n6']);
    dgm('es', 'paso uno después dos después tres volver a uno', ['  n1["Uno"]', '  n2["Dos"]', '  n3["Tres"]', '  n1 --> n2', '  n2 --> n3', '  n3 --> n1']);
    dgm('es', 'inicio\npaso cargar datos\nsi son válidos entonces guardar si no mostrar error\ndespués terminar\nfin',
      ['  n1(["Inicio"])', '  n2["Cargar datos"]', '  n3{"¿Son válidos?"}', '  n4["Guardar"]', '  n5["Mostrar error"]', '  n6["Terminar"]', '  n7(["Fin"])', '  n1 --> n2', '  n2 --> n3', '  n3 -->|"Sí"| n4', '  n3 -->|"No"| n5', '  n4 --> n6', '  n6 --> n7']);
    dgm('es', 'paso cobrar después empacar\ndesde empacar a cobrar', ['  n1["Cobrar"]', '  n2["Empacar"]', '  n1 --> n2', '  n2 --> n1']);
    dgm('es', 'paso cobrar después empacar\nrenombrar empacar como armar la caja', ['  n1["Cobrar"]', '  n2["Armar la caja"]', '  n1 --> n2']);
    dgm('es', 'paso cobrar después empacar después enviar\nborrar último paso', ['  n1["Cobrar"]', '  n2["Empacar"]', '  n1 --> n2']);
    dgm('es', 'paso revisar el fin de mes después cerrar "caja" <ya>', ['  n1["Revisar el fin de mes"]', '  n2["Cerrar #quot;caja#quot; #lt;ya#gt;"]', '  n1 --> n2']);
    dgm('es', 'paso preparar después de pagar el paso final', ['  n1["Preparar después de pagar el paso final"]']);
    dgm('es', 'decisión llueve\nsi no volver a llueve', ['  n1{"¿Llueve?"}', '  n1 -->|"No"| n1']);
    { const r = P('paso uno después dos\nfin diagrama y luego texto', 'diagram', 'es'); check('diagrama es: "fin diagrama" cierra y deja lo que sigue', r.done && r.nodes === 2 && r.edges === 1 && r.rest === 'y luego texto', r); }
    { const r = P('paso uno\nhorizontal', 'diagram', 'es'); check('diagrama es: "horizontal" lo acuesta', r.mermaid === 'flowchart LR\n  n1["Uno"]', r.mermaid); }

    // Diagrama, inglés
    dgm('en', 'start order received\nthen check stock\ndecision in stock\nthen ship order\nelse tell the customer\nend delivered',
      ['  n1(["Order received"])', '  n2["Check stock"]', '  n3{"In stock?"}', '  n4["Ship order"]', '  n5["Tell the customer"]', '  n6(["Delivered"])', '  n1 --> n2', '  n2 --> n3', '  n3 -->|"Yes"| n4', '  n3 -->|"No"| n5', '  n5 --> n6']);
    dgm('en', 'step one then two then three go back to one', ['  n1["One"]', '  n2["Two"]', '  n3["Three"]', '  n1 --> n2', '  n2 --> n3', '  n3 --> n1']);
    dgm('en', 'if it is valid then save else show error\nthen finish', ['  n1{"It is valid?"}', '  n2["Save"]', '  n3["Show error"]', '  n4["Finish"]', '  n1 -->|"Yes"| n2', '  n1 -->|"No"| n3', '  n2 --> n4']);
    dgm('en', 'step pay then pack\nfrom pack to pay\nrename pack to box it', ['  n1["Pay"]', '  n2["Box it"]', '  n1 --> n2', '  n2 --> n1']);
    dgm('en', 'step pay then pack then ship\ndelete last step', ['  n1["Pay"]', '  n2["Pack"]', '  n1 --> n2']);
    { const r = P('step one then two\nend diagram', 'diagram', 'en'); check('diagrama en: "end diagram" cierra', r.done && r.nodes === 2, r); }

    // Las tablas no repiten una frase dentro del mismo modo e idioma: la segunda nunca se alcanzaría.
    const T = box.LMD.voice.TABLES; const twice = [];
    ['es', 'en'].forEach((l) => { [T.TEXT[l], T.FORMULA[l], T.DIAGRAM[l].rows].forEach((rows, k) => { const seen = new Set(); rows.forEach((r) => r[0].split('|').forEach((p) => { if (seen.has(p)) twice.push(l + k + ':' + p); seen.add(p); })); }); });
    check('ninguna frase está dos veces en la misma tabla', twice.length === 0, twice);
    const H = box.LMD.voice.HELP;
    check('la hoja de ayuda tiene los tres modos en los dos idiomas', ['es', 'en'].every((l) => ['text', 'formula', 'diagram'].every((m) => H[l][m].length >= 8 && H[l][m].every((r) => r.length === 2 && r[0] && r[1]))));
  });

  // ---------- Ajustes > Herramientas ----------
  await step('Ajustes: la pestaña Herramientas y sus interruptores', async () => {
    const { ctx, page } = await open();
    await note(page, 'tools.md', '# Tools\n\nA paragraph.\n');
    const loaded = () => page.evaluate(() => ({ speak: !!LMD.speak, dictate: !!LMD.dictate, voice: !!LMD.voice, tags: [...document.scripts].map((s) => s.src.split('/').pop()).filter((n) => /^(speak|voice|dictate)\.js$/.test(n)) }));
    check('con todo apagado no se pidió el código de ninguna herramienta', J(await loaded()) === J({ speak: false, dictate: false, voice: false, tags: [] }), await loaded());
    check('ni hay botón de micrófono ni controles de lectura', await page.evaluate(() => !document.querySelector('.lmd-dct-mic, .lmd-spk, .lmd-dct-bar')));
    await page.click('[data-act=settings]'); await page.waitForSelector('.lmd-panel-card');
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lmd-panel [data-ptab]')].map((b) => b.dataset.ptab + ':' + b.textContent.trim()));
    check('Tools es una pestaña propia, después de Plugins', tabs.indexOf('tools:Tools') === tabs.indexOf('plug:Plugins') + 1 && tabs.length === 9, tabs);
    await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card');
    const cards = await page.evaluate(() => [...document.querySelectorAll('.lmd-tl-list:not([hidden]) .lmd-tl-card')].map((c) => ({ id: c.dataset.tool, name: c.querySelector('b').textContent, about: c.querySelector('p').textContent.length > 20, icon: !!c.querySelector('.lmd-tl-ico svg'),
      sw: c.querySelector('input[type=checkbox]') ? (c.querySelector('input').checked ? 'on' : 'off') : 'none', tag: (c.querySelector('.lmd-tag') || {}).textContent || '', opts: !!c.querySelector('.lmd-tl-more:not([hidden])') })));
    check('tres tarjetas: leer en voz alta y dictado apagadas, el tablero fijo y sin interruptor', J(cards) === J([
      { id: 'speak', name: 'Read aloud', about: true, icon: true, sw: 'off', tag: '', opts: false }, { id: 'dictate', name: 'Dictation', about: true, icon: true, sw: 'off', tag: '', opts: false },
      { id: 'board', name: 'Kanban board', about: true, icon: true, sw: 'none', tag: 'Built in', opts: false }]), cards);
    check('la sección de Plugins sigue siendo otra, con sus interruptores', await page.evaluate(() => document.querySelectorAll('section[data-tab=plug] [data-plugin]').length > 20 && !document.querySelector('section[data-tab=plug] .lmd-tl-card')));
    check('el lugar para la lista de la comunidad está, vacío y sin nada a la vista', await page.evaluate(() => { const c = document.querySelector('[data-tools-community]'); return !!c && c.hidden && !c.children.length && LMD.tools.community.length === 0; }));
    const texts = await page.evaluate(() => document.querySelector('section[data-tab=tools]').innerText);
    check('los textos no llevan signos de admiración ni rayas largas', !/[!¡—–]/.test(texts), texts);

    await page.click('.lmd-tl-card[data-tool=speak] .lmd-switch'); await until(() => page.evaluate(() => !!LMD.speak));
    check('al prender Leer en voz alta se pide su archivo, y solo ese', J(await loaded()) === J({ speak: true, dictate: false, voice: false, tags: ['speak.js'] }), await loaded());
    await sleep(350);
    check('queda guardado en las preferencias de siempre', J((await stored(page, 'settings')).tools) === J({ speak: true }), await stored(page, 'settings'));
    await page.click('.lmd-tl-card[data-tool=speak] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-card[data-tool=speak] .lmd-tl-opts select');
    check('sus opciones: velocidad, idioma, voz y leer la nota', await page.evaluate(() => { const o = document.querySelector('.lmd-tl-card[data-tool=speak] .lmd-tl-opts'); return o.querySelectorAll('select').length === 3 && !!o.querySelector('[data-spk=go]') && o.querySelector('[data-spk=voice]').options.length === 3; }));
    await page.selectOption('.lmd-tl-opts [data-spk=rate]', '1.5'); await sleep(350);
    check('las opciones se guardan junto al interruptor', J((await stored(page, 'settings')).tools) === J({ speak: true, speakRate: 1.5 }), (await stored(page, 'settings')).tools);

    await page.click('.lmd-tl-card[data-tool=dictate] .lmd-switch'); await until(() => page.evaluate(() => !!LMD.dictate && !!LMD.voice));
    check('al prender Dictado llegan su gramática y su código', (await loaded()).tags.join() === 'speak.js,voice.js,dictate.js', (await loaded()).tags);
    check('prenderlo no arranca el micrófono', J(await srLog(page)) === '[]' && !(await dct(page)).active, await srLog(page));
    await page.click('.lmd-tl-card[data-tool=dictate] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-opts [data-dct=lang]');
    const dopts = await page.evaluate(() => { const o = document.querySelector('.lmd-tl-card[data-tool=dictate] .lmd-tl-opts'); return { lang: [...o.querySelector('[data-dct=lang]').options].map((x) => x.value).join(), commands: o.querySelector('[data-dct=commands]').checked, where: o.querySelector('[data-dct=where]').textContent, help: !!o.querySelector('[data-dct=help]') }; });
    check('sus opciones: idioma, órdenes y dónde se transcribe el audio', dopts.lang === 'auto,es,en' && dopts.commands && /provider/.test(dopts.where) && /does not receive or store audio/.test(dopts.where) && dopts.help, dopts);
    await page.click('.lmd-tl-opts [data-dct=help]'); await page.waitForSelector('.lmd-dct-help');
    const sheet = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.lmd-dct-sheet h4')].map((h) => h.textContent).join(''), rows: document.querySelectorAll('.lmd-dct-sheet dt').length, sample: document.querySelector('.lmd-dct-sheet').innerText }));
    check('la hoja de ayuda lista las frases de texto, fórmula y diagrama', sheet.titles === 'TextFormulaDiagram' && sheet.rows >= 30 && /scratch that/.test(sheet.sample) && /end formula/.test(sheet.sample) && /go back to/.test(sheet.sample), sheet.titles + ' ' + sheet.rows);
    await page.click('.lmd-dct-help [data-help=es]'); await sleep(120);
    check('y cambia de idioma', /fin fórmula/.test(await page.evaluate(() => document.querySelector('.lmd-dct-sheet').innerText)) && await page.evaluate(() => document.querySelectorAll('.lmd-dct-help').length === 1));
    await page.keyboard.press('Escape'); await sleep(150);
    check('Escape la cierra y deja Ajustes abierto', await page.evaluate(() => !document.querySelector('.lmd-dct-help') && !document.querySelector('.lmd-panel').hidden));

    await page.click('.lmd-tl-card[data-tool=speak] .lmd-switch'); await sleep(350);
    check('apagar una herramienta la deja apagada y esconde sus opciones', J((await stored(page, 'settings')).tools.speak) === 'false' && await page.evaluate(() => !LMD.tools.isOn('speak') && document.querySelector('.lmd-tl-card[data-tool=speak] .lmd-tl-more').hidden && document.querySelector('.lmd-tl-card[data-tool=speak] .lmd-tl-opts').hidden));
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForSelector('.lmd-article > *'); await until(() => page.evaluate(() => !!LMD.dictate));
    check('al recargar, lo prendido vuelve prendido y lo apagado no se pide', J(await loaded()) === J({ speak: false, dictate: true, voice: true, tags: ['voice.js', 'dictate.js'] }), await loaded());
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Ajustes: donde no hay reconocimiento de voz', async () => {
    const { ctx, page } = await open({ sr: false, tools: { dictate: true } });
    await note(page, 'nosr.md', '# No recognition\n\nText.\n', true);
    await page.click('[data-act=settings]'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card');
    const card = () => page.evaluate(() => { const c = document.querySelector('.lmd-tl-card[data-tool=dictate]'); return { off: c.classList.contains('lmd-tl-off'), disabled: c.querySelector('input').disabled, checked: c.querySelector('input').checked, why: (c.querySelector('.lmd-tl-why') || {}).textContent || '' }; });
    check('la tarjeta de Dictado queda deshabilitada y dice por qué', J(await card()) === J({ off: true, disabled: true, checked: false, why: 'This browser has no speech recognition. It works in Chrome, Edge and Safari.' }), await card());
    check('y no se pidió su código aunque estuviera prendida', await page.evaluate(() => !LMD.dictate && !document.querySelector('.lmd-dct-mic')));
    await page.evaluate(() => { LMD.storeApp = LMD.storeApp || { test: true }; document.querySelector('[data-ptab=plug]').click(); document.querySelector('[data-ptab=tools]').click(); });
    check('dentro de la app de Android dice que el micrófono no está disponible ahí', /not available inside this app/.test((await card()).why), await card());
    check('Leer en voz alta sigue disponible', await page.evaluate(() => !document.querySelector('.lmd-tl-card[data-tool=speak]').classList.contains('lmd-tl-off')));
    await ctx.close();
  });

  // ---------- Leer en voz alta ----------
  const READ = '# Trip plan\n\nFirst paragraph about the budget. It has two sentences.\n\n- Book the flights\n- Renew the passport\n  - Take a photo\n\n| City | Nights |\n| --- | --- |\n| Lima | 3 |\n| Cusco | 4 |\n\n```js\nconst nights = 3 + 4;\n```\n\n```mermaid\ngraph LR\n  A[Lima] --> B[Cusco]\n```\n\n$$\n\\frac{a}{b}\n$$\n\nThe area is $\\pi r^2$ and x is $x = 2$ here.\n\n> A quote to close.\n\n## The end\n\nLast words.\n';
  await step('Leer en voz alta: orden, anuncios, marca y pausa', async () => {
    const { ctx, page } = await open({ tools: { speak: true } });
    await note(page, 'read.md', READ);
    await until(() => page.evaluate(() => !!LMD.speak)); await page.waitForSelector('.lmd-diagram svg', { timeout: 15000 }).catch(() => {});
    const log = () => page.evaluate(() => window.__tts.log.slice());
    check('prender la herramienta no lee nada por su cuenta', (await log()).length === 0 && await page.evaluate(() => !document.querySelector('.lmd-spk')));

    // Con el menú de lectura, desde un bloque.
    await page.locator('.lmd-article p', { hasText: 'First paragraph' }).click({ button: 'right' }); await page.waitForSelector('.lmd-menu-read');
    const items = await page.evaluate(() => [...document.querySelectorAll('.lmd-menu-read [data-read]')].map((b) => b.dataset.read + ':' + b.textContent.trim()));
    check('el menú de lectura suma "Read from here"', items.includes('speak:Read from here'), items);
    await page.click('.lmd-menu-read [data-read=speak]');
    await until(async () => !(await page.evaluate(() => LMD.speak.state().active)) && (await log()).length > 5, 12000);
    const all = await log(); const said = all.map((x) => x.text);
    check('lee desde ese bloque, en orden, de a una oración', J(said.slice(0, 5)) === J(['First paragraph about the budget.', 'It has two sentences.', 'Book the flights', 'Renew the passport', 'Take a photo']), said);
    check('no lee lo de antes del bloque elegido', !said.includes('Trip plan'), said);
    check('la tabla va fila por fila', J(said.slice(5, 8)) === J(['City, Nights', 'Lima, 3', 'Cusco, 4']), said);
    check('el código y el diagrama se anuncian en corto, sin leerlos', J(said.slice(8, 10)) === J(['Code block.', 'Diagram.']) && !said.some((t) => /const nights|graph LR|-->/.test(t)), said);
    check('la fórmula en bloque se anuncia; en línea, la simple se lee y la otra se anuncia', said[10] === 'Formula.' && said[11] === 'The area is Formula and x is x = 2 here.', said.slice(10, 12));
    check('sigue con la cita, el título y el final', J(said.slice(12)) === J(['A quote to close.', 'The end', 'Last words.']), said.slice(12));
    const k = said.indexOf('The end');
    check('tras un título hace una pausa antes de seguir', all[k + 1].t - all[k].t >= 400 && all[k].t - all[k - 1].t < 250, [all[k - 1].t, all[k].t, all[k + 1].t]);
    check('cada bloque estaba marcado mientras se lo leía', J(all.map((x) => x.on)) === J(['P', 'P', 'LI', 'LI', 'LI', 'TR', 'TR', 'TR', 'DIV', 'DIV', 'DIV', 'P', 'P', 'H2', 'P']), all.map((x) => x.on));
    check('con el texto en inglés usa una voz en inglés', all.every((x) => x.voice === 'Test US' && x.lang === 'en-US' && x.rate === 1), all[0]);
    check('al terminar se van la marca y los controles', await page.evaluate(() => !document.querySelector('.lmd-speaking, .lmd-spk')));

    // Los controles: pausar, seguir, velocidad y detener.
    await page.evaluate(() => { window.__tts.log.length = 0; window.__tts.hold = true; LMD.speak.start({}); });
    await until(async () => (await log()).length === 1);
    await until(() => page.evaluate(() => { const r = document.querySelector('.lmd-speaking').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 3000); // la página sube sola hasta el título
    const first = await page.evaluate(() => ({ text: window.__tts.log[0].text, marked: document.querySelector('.lmd-speaking').tagName, bar: !!document.querySelector('.lmd-spk'), label: document.querySelector('.lmd-spk [data-spk=play]').title, inView: (() => { const r = document.querySelector('.lmd-speaking').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })() }));
    check('la nota entera arranca por el título, marcado y a la vista, con los controles', J(first) === J({ text: 'Trip plan', marked: 'H1', bar: true, label: 'Pause', inView: true }), first);
    await page.click('.lmd-spk [data-spk=play]'); await sleep(200);
    const paused = await page.evaluate(() => ({ st: LMD.speak.state(), cancels: window.__tts.cancels, label: document.querySelector('.lmd-spk [data-spk=play]').title, n: window.__tts.log.length }));
    check('pausar corta la voz y deja todo en su lugar', paused.st.active && paused.st.paused && paused.cancels >= 1 && paused.label === 'Resume' && paused.n === 1, paused);
    await sleep(300);
    check('en pausa no sigue leyendo', (await log()).length === 1);
    await page.click('.lmd-spk [data-spk=play]'); await until(async () => (await log()).length === 2);
    check('seguir retoma la misma oración', (await log())[1].text === 'Trip plan' && !(await page.evaluate(() => LMD.speak.state().paused)), await log());
    await page.selectOption('.lmd-spk [data-spk=rate]', '2'); await until(async () => (await log()).length === 3);
    check('cambiar la velocidad vale desde esa misma oración', (await log())[2].rate === 2 && (await log())[2].text === 'Trip plan', (await log())[2]);
    await page.selectOption('.lmd-spk [data-spk=voice]', 'v-gb'); await until(async () => (await log()).length === 4);
    check('y elegir otra voz del mismo idioma también', (await log())[3].voice === 'Test GB', (await log())[3]);
    check('las voces ofrecidas son las del idioma del texto', await page.evaluate(() => [...document.querySelector('.lmd-spk [data-spk=voice]').options].map((o) => o.textContent).join()) === 'Automatic voice,Test US,Test GB');
    await page.click('.lmd-spk [data-spk=stop]'); await sleep(200);
    check('detener saca los controles y la marca, y no lee más', await page.evaluate(() => !document.querySelector('.lmd-spk, .lmd-speaking') && !LMD.speak.state().active) && (await log()).length === 4);

    // Lo elegido, con el atajo.
    await page.evaluate(() => { window.__tts.log.length = 0; window.__tts.hold = false; LMD.tools.setOpt({ speakRate: 1, speakVoiceEn: '' }); });
    await sleep(300);
    await page.evaluate(() => { const p = [...document.querySelectorAll('.lmd-article p')].find((x) => /Last words/.test(x.textContent)); const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 4); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.keyboard.press('Alt+Shift+S'); await until(async () => (await log()).length >= 1 && !(await page.evaluate(() => LMD.speak.state().active)));
    check('con texto elegido, el atajo lee solo eso', J((await log()).map((x) => x.text)) === J(['Last']), await log());
    // Desde el bloque del cursor.
    await page.evaluate(() => { window.__tts.log.length = 0; getSelection().removeAllRanges(); });
    await page.locator('.lmd-article blockquote p').click(); await page.keyboard.press('Alt+Shift+S');
    await until(async () => (await log()).length >= 3 && !(await page.evaluate(() => LMD.speak.state().active)));
    check('sin nada elegido, lee desde el bloque donde está el cursor', J((await log()).map((x) => x.text)) === J(['A quote to close.', 'The end', 'Last words.']), await log());
    // Otra nota: lo que se leía se corta.
    await page.evaluate(() => { window.__tts.log.length = 0; window.__tts.hold = true; LMD.store.notePut('other.md', '# Other\n'); LMD.speak.start({}); });
    await until(async () => (await log()).length === 1);
    await page.evaluate(() => { history.pushState(null, '', location.pathname + '?f=' + encodeURIComponent('local/other.md')); window.dispatchEvent(new PopStateEvent('popstate')); });
    await until(() => page.evaluate(() => !LMD.speak.state().active), 5000);
    check('al pasar a otra nota deja de leer', await page.evaluate(() => !LMD.speak.state().active && !document.querySelector('.lmd-spk')));
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Leer en voz alta: español, oraciones largas y sin voces', async () => {
    const { ctx, page } = await open({ tools: { speak: true }, lang: 'es' });
    await note(page, 'leer.md', '# Plan del viaje\n\nEl presupuesto alcanza para los vuelos y para la comida de toda la semana.\n\n```js\nlet a = 1;\n```\n\n![El mapa](mapa.png)\n');
    await until(() => page.evaluate(() => !!LMD.speak));
    await page.evaluate(() => LMD.speak.start({}));
    await until(async () => (await page.evaluate(() => window.__tts.log.length)) >= 4 && !(await page.evaluate(() => LMD.speak.state().active)));
    const all = await page.evaluate(() => window.__tts.log.slice());
    check('un texto en español se lee con una voz en español, y los anuncios van en español', all.every((x) => x.voice === 'Prueba ES' && x.lang === 'es-ES') && J(all.map((x) => x.text)) === J(['Plan del viaje', 'El presupuesto alcanza para los vuelos y para la comida de toda la semana.', 'Bloque de código.', 'Imagen: El mapa.']), all.map((x) => x.text));
    const long = 'Uno dos tres, '.repeat(40) + 'fin.';
    const parts = await page.evaluate((t) => LMD.speak.sentences(t), long + ' Otra oración. ¿Y una pregunta?');
    check('las oraciones largas se parten en las comas, sin perder texto', parts.length >= 4 && parts.every((p) => p.length <= 221) && parts.join(' ').replace(/\s+/g, ' ') === (long + ' Otra oración. ¿Y una pregunta?').replace(/\s+/g, ' '), parts.map((p) => p.length));
    check('detecta el idioma del texto', await page.evaluate(() => [LMD.speak.detect('El perro come en la casa de su dueño'), LMD.speak.detect('The dog eats in the house of its owner'), LMD.speak.detect('¿Cómo? Sí, mañana')].join()) === 'es,en,es');
    await page.evaluate(() => { LMD.tools.setOpt({ speakLang: 'en' }); });
    await sleep(350);
    await page.evaluate(() => { window.__tts.log.length = 0; LMD.speak.start({}); });
    await until(async () => (await page.evaluate(() => window.__tts.log.length)) >= 1);
    check('con el idioma elegido a mano, usa ese', (await page.evaluate(() => window.__tts.log[0])).voice === 'Test US');
    await page.evaluate(() => LMD.speak.stop());
    await ctx.close();

    const b = await open({ tools: { speak: true }, tts: { none: true } });
    await note(b.page, 'mudo.md', '# Sin voces\n\nTexto.\n');
    await until(() => b.page.evaluate(() => !!LMD.speak));
    const ok = await b.page.evaluate(() => LMD.speak.start({}));
    check('donde no hay voces, lo dice y no arranca', ok === false && /no voices installed/.test(await flashText(b.page)) && await b.page.evaluate(() => !document.querySelector('.lmd-spk') && window.__tts.log.length === 0), await flashText(b.page));
    await b.ctx.close();
  });

  // ---------- Dictado ----------
  await step('Dictado: el aviso de privacidad y el micrófono solo con un gesto', async () => {
    const { ctx, page } = await open({ tools: { dictate: true } });
    await note(page, 'dict.md', '# Dictation\n\nFirst.\n', true);
    await until(() => page.evaluate(() => !!LMD.dictate));
    await page.click('.lmd-foot .lmd-status', { force: true }); await sleep(400);
    check('con la herramienta prendida y sin cursor en un bloque, no hay micrófono a la vista', await page.evaluate(() => document.querySelector('.lmd-dct-mic').hidden));
    const inFirst = async () => { await page.locator('.lmd-article .lmd-editable', { hasText: 'First' }).first().click(); await page.keyboard.press('Control+End'); await sleep(150); };
    await inFirst();
    const mic = await page.evaluate(() => { const m = document.querySelector('.lmd-dct-mic'); const b = document.activeElement.getBoundingClientRect(); const r = m.getBoundingClientRect(); return { shown: !m.hidden, pressed: m.getAttribute('aria-pressed'), title: m.title, beside: r.left >= b.right && Math.abs(r.top - b.top) < 12, sel: getSelection().isCollapsed }; });
    check('con el cursor en un bloque, sin nada elegido, aparece el micrófono al lado', J(mic) === J({ shown: true, pressed: 'false', title: 'Dictate (Alt+Shift+D)', beside: true, sel: true }), mic);
    check('hasta acá el micrófono nunca se prendió', J(await srLog(page)) === '[]');

    await micOn(page); await page.waitForSelector('.lmd-dlg');
    const dlg = await page.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent, ok: document.querySelector('.lmd-dlg [data-dlg=ok]').textContent }));
    check('la primera vez un diálogo propio avisa adónde puede ir el audio', J(dlg) === J({ title: 'Dictation', text: 'To transcribe, the browser may send the audio to its provider. SharpMD does not receive or store audio.', ok: 'Accept and dictate' }), dlg);
    check('con el diálogo abierto el micrófono sigue apagado', J(await srLog(page)) === '[]');
    await page.click('.lmd-dlg [data-dlg=no]'); await sleep(250);
    check('sin aceptar no se prende ni queda nada guardado', J(await srLog(page)) === '[]' && !(await dct(page)).active && (await stored(page, 'dictation')) === null && await page.evaluate(() => !document.querySelector('.lmd-dct-bar')));

    await inFirst(); await micOn(page); await page.waitForSelector('.lmd-dlg'); await page.click('.lmd-dlg [data-dlg=ok]');
    check('al aceptar empieza a escuchar', !!(await listening(page)), await dct(page));
    check('se arrancó en inglés, continuo y con resultados provisorios', J(await srLog(page)) === J(['start:en-US:cloud:ok']), await srLog(page));
    const consent = await stored(page, 'dictation');
    check('el permiso queda en una clave propia, fuera de los ajustes', !!consent && consent.consent > 0 && !('dictation' in (await stored(page, 'settings'))) && !('consent' in ((await stored(page, 'settings')).tools || {})), consent);
    const bar = await page.evaluate(() => { const b = document.querySelector('.lmd-dct-bar'); const r = b.getBoundingClientRect(); const m = document.querySelector('.lmd-dct-mic'); return { label: b.querySelector('.lmd-dct-label').textContent, stop: b.querySelector('[data-dct=stop]').textContent.trim(), fixed: getComputedStyle(b).position, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, dot: !!b.querySelector('.lmd-dct-dot'), mic: m.getAttribute('aria-pressed') + ' ' + m.classList.contains('lmd-on') }; });
    check('mientras escucha hay un indicador fijo con su botón para cortar', J(bar) === J({ label: 'Listening', stop: 'Stop', fixed: 'fixed', inView: true, dot: true, mic: 'true true' }), bar);
    check('el foco sigue en el bloque', await page.evaluate(() => document.activeElement.classList.contains('lmd-editable')));

    // Provisorio y definitivo.
    await say(page, 'and then the sec', false);
    const soft = await page.evaluate(() => ({ ghost: (document.querySelector('.lmd-voice-ghost') || {}).textContent, inBlock: !!document.activeElement.querySelector('.lmd-voice-ghost'), said: document.querySelector('.lmd-dct-said').textContent, md: LMD.serialize.inlineMd(document.activeElement) }));
    check('lo provisorio se ve en el lugar y en el indicador, y no entra al texto', J(soft) === J({ ghost: ' and then the sec', inBlock: true, said: 'and then the sec', md: 'First.' }), soft);
    await say(page, 'and then the second comma with a test period');
    const hard = await page.evaluate(() => ({ ghost: !!document.querySelector('.lmd-voice-ghost'), text: document.activeElement.textContent.replace(/\u200b/g, '') }));
    check('lo definitivo lo reemplaza, con su espacio, su mayúscula y su puntuación', J(hard) === J({ ghost: false, text: 'First. And then the second, with a test.' }), hard);
    await page.click('.lmd-dct-bar [data-dct=stop]');
    check('el botón del indicador corta', !!(await stopped(page)) && (await srLog(page)).slice(-1)[0] === 'stop', await srLog(page));
    await sleep(900);
    check('lo dictado queda guardado en la nota', (await saved(page, 'dict.md')) === '# Dictation\n\nFirst. And then the second, with a test.\n', await saved(page, 'dict.md'));

    await inFirst(); await page.keyboard.press('Alt+Shift+D');
    check('la segunda vez arranca sin volver a preguntar, también con el atajo', !!(await listening(page)) && await page.evaluate(() => !document.querySelector('.lmd-dlg')));
    await page.keyboard.press('Alt+Shift+D');
    check('y el mismo atajo corta', !!(await stopped(page)));
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Dictado: órdenes de texto de punta a punta', async () => {
    const { ctx, page } = await open({ tools: { dictate: true }, consent: true });
    await note(page, 'cmd.md', '', true);
    await until(() => page.evaluate(() => !!LMD.dictate));
    await caretLast(page); await micOn(page);
    check('en una nota vacía empieza a escuchar', !!(await listening(page)));
    await say(page, 'title shopping');
    await say(page, 'we need a few things colon');
    await say(page, 'new list apples next pears next grapes');
    await say(page, 'new paragraph');
    await say(page, 'new paragraph back to plain text period');
    await say(page, 'task buy bread');
    await say(page, 'task done call John');
    await say(page, 'quote less is more');
    await say(page, 'new paragraph this is bold very important end bold and use code npm install end code period');
    await say(page, 'subtitle notes');
    await say(page, 'what time is it question mark');
    await say(page, 'stop dictation');
    check('"stop dictation" apaga el micrófono', !!(await stopped(page)));
    await sleep(1000);
    const md = await saved(page, 'cmd.md');
    const want = '# Shopping\n\nWe need a few things:\n\n- Apples\n- Pears\n- Grapes\n\nBack to plain text.\n\n- [ ] Buy bread\n- [x] Call John\n\n> Less is more\n\nThis is **very important** and use `npm install`.\n\n## Notes\n\nWhat time is it?\n';
    check('título, lista, tareas, cita, negrita, código y subtítulo quedan como Markdown', md.replace(/^[*+] /gm, '- ').trim() === want.trim(), md);
    check('las dos listas no se pegan entre sí', /Grapes\n\nBack to plain text\.\n\n[-*+] \[ \] Buy bread/.test(md), md);

    // Borrar lo último, y deshacer.
    await caretLast(page); await micOn(page); await listening(page);
    await say(page, 'new paragraph this one stays period');
    await say(page, 'and this one goes away');
    await say(page, 'scratch that');
    await sleep(200);
    const afterScratch = await page.evaluate(() => ({ text: document.activeElement.textContent.replace(/\u200b/g, ''), editable: document.activeElement.classList.contains('lmd-editable'), on: LMD.dictate.state().active }));
    check('"scratch that" saca lo último que se dictó y deja el cursor en su lugar, escuchando', J(afterScratch) === J({ text: 'This one stays.', editable: true, on: true }), afterScratch);
    await say(page, 'still here');
    await say(page, 'undo');
    await sleep(200);
    check('"undo" deshace un paso', !/still here/.test(await page.evaluate(() => document.querySelector('.lmd-article').textContent)) && (await dct(page)).active);
    await say(page, 'the end period');
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page); await sleep(1000);
    check('lo que quedó es lo que no se borró', /This one stays\. The end\.\n$/.test(await saved(page, 'cmd.md')) && !/goes away|still here/.test(await saved(page, 'cmd.md')), (await saved(page, 'cmd.md')).slice(-80));

    // Sin órdenes: todo entra como texto.
    await page.evaluate(() => LMD.tools.setOpt({ dictateCommands: false })); await sleep(350);
    await caretLast(page); await micOn(page); await listening(page);
    await say(page, 'new paragraph title comma period');
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page); await sleep(1000);
    check('con las órdenes apagadas, lo dicho entra tal cual', /The end\. New paragraph title comma period\n$/.test(await saved(page, 'cmd.md')), (await saved(page, 'cmd.md')).slice(-80));
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Dictado: fórmula y diagrama', async () => {
    const { ctx, page } = await open({ tools: { dictate: true }, consent: true });
    await note(page, 'fx.md', '# Formulas\n\nEnergy is\n', true);
    await until(() => page.evaluate(() => !!LMD.dictate));
    await page.locator('.lmd-article .lmd-editable', { hasText: 'Energy is' }).first().click(); await page.keyboard.press('Control+End'); await sleep(150); await micOn(page); await listening(page);
    await say(page, 'formula e equals m c');
    const mid = await until(() => page.evaluate(() => { const b = document.querySelector('.lmd-dct-bar'); const p = b.querySelector('.lmd-dct-pane'); return !p.hidden && p.querySelector('.katex') ? { label: b.querySelector('.lmd-dct-label').textContent, code: p.querySelector('code').textContent, mode: LMD.dictate.state().mode } : null; }), 8000);
    check('en modo fórmula se ve dibujada mientras se habla', J(mid) === J({ label: 'Formula', code: 'e = mc', mode: 'formula' }), mid);
    await say(page, 'squared plus', false);
    check('lo provisorio también entra en el dibujo, sin tocar la nota', (await until(() => page.evaluate(() => document.querySelector('.lmd-dct-pane code').textContent === 'e = mc^{2} +'), 3000)) && !/\$/.test(await page.evaluate(() => LMD.serialize.inlineMd(document.activeElement))), await page.evaluate(() => document.querySelector('.lmd-dct-pane code').textContent));
    await say(page, 'squared end formula and that is all period');
    const inline = await page.evaluate(() => ({ md: LMD.serialize.inlineMd(document.activeElement), drawn: !!document.activeElement.querySelector('.lmd-math .katex'), mode: LMD.dictate.state().mode, pane: document.querySelector('.lmd-dct-pane').hidden }));
    check('con el cursor en medio de un texto la fórmula entra en línea, y lo que sigue es texto', J(inline) === J({ md: 'Energy is $e = mc^{2}$ and that is all.', drawn: true, mode: 'text', pane: true }), inline);

    await say(page, 'new paragraph insert equation sum of x sub i from i equals one to n');
    await say(page, 'scratch that');
    check('"scratch that" dentro de una fórmula saca lo último dicho', (await until(() => page.evaluate(() => document.querySelector('.lmd-dct-pane').classList.contains('lmd-dct-empty') && LMD.dictate.state().mode === 'formula'), 3000)), await dct(page));
    await say(page, 'fraction a plus b over two end fraction');
    await say(page, 'end formula');
    await sleep(400);
    const block = await page.evaluate(() => ({ math: (document.querySelector('.lmd-math-block') || {}).getAttribute ? document.querySelector('.lmd-math-block').getAttribute('data-tex') : null, focus: document.activeElement.classList.contains('lmd-draft'), on: LMD.dictate.state().active }));
    check('en un bloque vacío la fórmula queda como bloque propio, y se sigue dictando debajo', J(block) === J({ math: '\\frac{a + b}{2}', focus: true, on: true }), block);

    // Diagrama.
    await say(page, 'flowchart start order received');
    const d1 = await until(() => page.evaluate(() => { const p = document.querySelector('.lmd-dct-pane'); return !p.hidden && p.querySelector('.lmd-dct-view svg') ? { label: document.querySelector('.lmd-dct-label').textContent, nodes: p.querySelectorAll('.lmd-dct-view svg .node').length } : null; }), 20000);
    check('en modo diagrama se lo ve armarse', J(d1) === J({ label: 'Diagram', nodes: 1 }), d1);
    await say(page, 'then check stock');
    await say(page, 'if there is stock then ship it else tell the customer');
    const d2 = await until(() => page.evaluate(() => { const n = document.querySelectorAll('.lmd-dct-view svg .node').length; return n === 5 ? n : 0; }), 10000);
    check('y crecer con cada paso', d2 === 5, await page.evaluate(() => document.querySelector('.lmd-dct-pane code').textContent));
    await say(page, 'end diagram');
    await page.waitForSelector('.lmd-article .lmd-diagram svg', { timeout: 15000 }).catch(() => {});
    await say(page, 'done period');
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page); await sleep(1000);
    const md = await saved(page, 'fx.md');
    const want = '# Formulas\n\nEnergy is $e = mc^{2}$ and that is all.\n\n$$\n\\frac{a + b}{2}\n$$\n\n```mermaid\nflowchart TD\n  n1(["Order received"])\n  n2["Check stock"]\n  n3{"There is stock?"}\n  n4["Ship it"]\n  n5["Tell the customer"]\n  n1 --> n2\n  n2 --> n3\n  n3 -->|"Yes"| n4\n  n3 -->|"No"| n5\n```\n\nDone.\n';
    check('la nota guarda la fórmula en línea, la de bloque y el diagrama, exactos', md === want, md);
    check('el diagrama dictado se dibuja en la nota', await page.evaluate(() => document.querySelectorAll('.lmd-article .lmd-diagram svg .node').length === 5));

    // Cortar a mitad de una fórmula no la pierde.
    await caretLast(page); await micOn(page); await listening(page);
    await say(page, 'new paragraph formula x squared plus one');
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page); await sleep(1000);
    check('cortar con una fórmula a medio decir la escribe como quedó', /\$\$\nx\^\{2\} \+ 1\n\$\$\n$/.test(await saved(page, 'fx.md')), (await saved(page, 'fx.md')).slice(-60));
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Dictado en español', async () => {
    const { ctx, page } = await open({ tools: { dictate: true }, lang: 'es', ctx: { locale: 'es-AR' }, consent: true });
    await note(page, 'es.md', '', true);
    await until(() => page.evaluate(() => !!LMD.dictate));
    await caretLast(page); await micOn(page); await listening(page);
    check('con la app en español dicta en español, con la variante del navegador', J(await srLog(page)) === J(['start:es-AR:cloud:ok']) && await page.evaluate(() => document.querySelector('.lmd-dct-label').textContent === 'Escuchando' && document.querySelector('[data-dct=stop]').textContent.trim() === 'Cortar'), await srLog(page));
    await say(page, 'título lista de compras');
    await say(page, 'hola mundo coma esto es una prueba punto y aparte');
    await say(page, 'tarea comprar pan');
    await say(page, 'tarea hecha llamar a Juan');
    await say(page, 'nueva línea');
    await say(page, 'nueva línea');
    await say(page, 'el área es fórmula pi por r al cuadrado fin fórmula punto');
    await say(page, 'nueva línea diagrama de flujo inicio después revisar fin diagrama');
    await say(page, 'terminar dictado');
    await stopped(page); await sleep(1000);
    const md = await saved(page, 'es.md');
    const want = '# Lista de compras\n\nHola mundo, esto es una prueba.\n\n- [ ] Comprar pan\n- [x] Llamar a Juan\n\nEl área es $\\pi \\cdot r^{2}$.\n\n```mermaid\nflowchart TD\n  n1(["Inicio"])\n  n2["Revisar"]\n  n1 --> n2\n```\n';
    check('las órdenes en español escriben el mismo Markdown', md.trim() === want.trim(), md);
    await page.evaluate(() => LMD.tools.setOpt({ dictateLang: 'en' })); await sleep(350);
    await caretLast(page); await micOn(page); await listening(page);
    check('el idioma del dictado se puede elegir aparte del de la app', (await srLog(page)).slice(-1)[0] === 'start:en-US:cloud:ok', await srLog(page));
    await page.click('.lmd-dct-bar [data-dct=help]'); await page.waitForSelector('.lmd-dct-help');
    check('la ayuda abre en el idioma en que se está dictando', /end formula/.test(await page.evaluate(() => document.querySelector('.lmd-dct-sheet').innerText)) && await page.evaluate(() => document.querySelector('.lmd-dct-help h3').textContent === 'Frases que entiende'));
    await page.keyboard.press('Escape'); await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page);
    await ctx.close();
  });

  await step('Dictado: lo que corta el micrófono', async () => {
    const { ctx, page } = await open({ tools: { dictate: true }, consent: true });
    await note(page, 'cut.md', '# Cuts\n\nText\n', true);
    await page.evaluate(() => LMD.store.notePut('cut2.md', '# Second\n\nMore\n'));
    await until(() => page.evaluate(() => !!LMD.dictate));
    const start = async () => { await page.locator('.lmd-article p.lmd-editable').first().click(); await page.keyboard.press('Control+End'); await sleep(150); await micOn(page); return !!(await listening(page)); };

    check('escuchando', await start());
    await page.evaluate(() => window.__sr.drop('no-speech'));
    await sleep(250);
    check('si el navegador corta por su cuenta, se vuelve a escuchar sin soltar el indicador', (await dct(page)).active && (await srLog(page)).filter((x) => /^start/.test(x)).length === 2 && await page.evaluate(() => window.__sr.on() && !!document.querySelector('.lmd-dct-bar')), await srLog(page));

    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('al pasar a otra pestaña se corta', !!(await stopped(page)));
    await page.evaluate(() => { delete document.hidden; });

    check('escuchando', await start());
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('al perder el foco la ventana se corta', !!(await stopped(page)));

    check('escuchando', await start());
    await say(page, 'something');
    await page.evaluate(() => { history.pushState(null, '', location.pathname + '?f=' + encodeURIComponent('local/cut2.md')); window.dispatchEvent(new PopStateEvent('popstate')); });
    check('al cambiar de nota se corta', !!(await stopped(page)), await dct(page));
    await page.waitForSelector('.lmd-article h1'); await sleep(900);
    check('y lo dictado quedó en la nota anterior, no en la nueva', /Text something\n$/.test(await saved(page, 'cut.md')) && (await saved(page, 'cut2.md')) === '# Second\n\nMore\n', [await saved(page, 'cut.md'), await saved(page, 'cut2.md')]);

    await page.click('[data-act=mode-edit]').catch(() => {}); await sleep(300);
    await page.evaluate(() => { LMD.dictate.cfg.silence = 500; });
    check('escuchando', await start());
    await sleep(250); await say(page, 'word');
    await sleep(350);
    check('cada cosa que se oye renueva la espera', (await dct(page)).active);
    check('tras un silencio largo se corta solo y lo dice', !!(await stopped(page)) && /stopped after a long silence/.test(await flashText(page)), await flashText(page));
    await page.evaluate(() => { LMD.dictate.cfg.silence = 30000; });

    check('escuchando', await start());
    await page.click('[data-act=mode-read]');
    check('al salir de edición se corta', !!(await stopped(page)));
    await page.click('[data-act=mode-edit]'); await sleep(300);

    await page.evaluate(() => { window.__sr.deny = true; });
    await page.locator('.lmd-article p.lmd-editable').first().click(); await sleep(150); await micOn(page); await sleep(400);
    check('si el navegador niega el micrófono, lo dice y no queda nada prendido', /did not allow the microphone/.test(await flashText(page)) && !(await dct(page)).active && await page.evaluate(() => !document.querySelector('.lmd-dct-bar') && document.querySelector('.lmd-dct-mic').getAttribute('aria-pressed') === 'false'), await flashText(page));
    await page.evaluate(() => { window.__sr.deny = false; });

    check('escuchando', await start());
    await page.click('[data-act=settings]'); await page.click('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card');
    await page.click('.lmd-tl-card[data-tool=dictate] .lmd-switch');
    check('apagar la herramienta corta y esconde el micrófono', !!(await stopped(page)) && await page.evaluate(() => document.querySelector('.lmd-dct-mic').hidden));
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });

  await step('Dictado: reconocimiento en el dispositivo', async () => {
    const { ctx, page } = await open({ tools: { dictate: true }, sr: { local: 'downloadable', installOk: true } });
    await note(page, 'local.md', '# Local\n\nText\n', true);
    await until(() => page.evaluate(() => !!LMD.dictate));
    await caretLast(page); await micOn(page); await page.waitForSelector('.lmd-dlg');
    const dlg = await page.evaluate(() => ({ title: document.querySelector('.lmd-dlg h3').textContent, text: document.querySelector('.lmd-dlg p').textContent, ok: document.querySelector('.lmd-dlg [data-dlg=ok]').textContent, no: document.querySelector('.lmd-dlg [data-dlg=no]').textContent }));
    check('si el navegador puede reconocer en el dispositivo, primero ofrece descargarlo', J(dlg) === J({ title: 'Dictate without sending audio', text: 'The browser can download speech recognition for this language. With it, audio stays on the device.', ok: 'Download', no: 'Not now' }), dlg);
    check('preguntó por ese idioma, en el dispositivo, y todavía no descargó ni escuchó', J(await srLog(page)) === J(['available:en-US:true']), await srLog(page));
    await page.click('.lmd-dlg [data-dlg=ok]');
    check('al aceptar lo descarga y escucha en el dispositivo', !!(await listening(page)) && J((await srLog(page)).slice(1)) === J(['install:en-US', 'start:en-US:local:ok']), await srLog(page));
    check('sin pasar por el aviso del proveedor, y lo dice el indicador', (await stored(page, 'dictation')) === null && await page.evaluate(() => !document.querySelector('.lmd-dlg') && document.querySelector('.lmd-dct-where').textContent === 'On this device'), await stored(page, 'dictation'));
    await say(page, 'works offline period');
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page);
    await caretLast(page); await micOn(page);
    check('la vez siguiente arranca directo en el dispositivo, sin diálogos', !!(await listening(page)) && (await srLog(page)).slice(-1)[0] === 'start:en-US:local:ok' && !(await srLog(page)).slice(-3).some((x) => /^install/.test(x)), await srLog(page));
    await page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(page);
    await ctx.close();

    // Sin querer descargarlo: queda el aviso del proveedor, y la oferta no se repite.
    const b = await open({ tools: { dictate: true }, sr: { local: 'downloadable', installOk: true } });
    await note(b.page, 'local2.md', '# Local\n\nText\n', true);
    await until(() => b.page.evaluate(() => !!LMD.dictate));
    await caretLast(b.page); await micOn(b.page); await b.page.waitForSelector('.lmd-dlg'); await b.page.click('.lmd-dlg [data-dlg=no]');
    await until(() => b.page.evaluate(() => { const h = document.querySelector('.lmd-dlg h3'); return h && h.textContent === 'Dictation'; }));
    check('con "Not now" pasa al aviso del proveedor antes de escuchar', await b.page.evaluate(() => /may send the audio to its provider/.test(document.querySelector('.lmd-dlg p').textContent)) && !(await srLog(b.page)).some((x) => /^(start|install)/.test(x)), await srLog(b.page));
    await b.page.click('.lmd-dlg [data-dlg=ok]');
    check('y al aceptar escucha con el reconocimiento del navegador', !!(await listening(b.page)) && (await srLog(b.page)).slice(-1)[0] === 'start:en-US:cloud:ok', await srLog(b.page));
    await b.page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(b.page);
    const kept = await stored(b.page, 'dictation');
    check('quedan guardados el permiso y que no se quiso descargar', kept.consent > 0 && kept.skip && kept.skip['en-US'] === true, kept);
    await caretLast(b.page); await micOn(b.page);
    check('la vez siguiente no vuelve a ofrecer la descarga', !!(await listening(b.page)) && await b.page.evaluate(() => !document.querySelector('.lmd-dlg')));
    await b.page.click('.lmd-dct-bar [data-dct=stop]'); await stopped(b.page);
    await b.page.click('[data-act=settings]'); await b.page.click('[data-ptab=tools]'); await b.page.waitForSelector('.lmd-tl-card');
    await b.page.click('.lmd-tl-card[data-tool=dictate] .lmd-tl-more'); await b.page.waitForSelector('.lmd-tl-opts [data-dct=install]');
    await b.page.click('.lmd-tl-opts [data-dct=install]');
    check('desde las opciones se puede descargar después', !!(await until(() => b.page.evaluate(() => /transcribed on this device/.test(document.querySelector('.lmd-tl-opts [data-dct=where]').textContent) && !document.querySelector('.lmd-tl-opts [data-dct=install]')), 4000)) && !((await stored(b.page, 'dictation')).skip || {})['en-US'], await stored(b.page, 'dictation'));
    await b.ctx.close();

    // La descarga falla: se avisa y queda el camino del proveedor.
    const c = await open({ tools: { dictate: true }, sr: { local: 'downloadable', installOk: false } });
    await note(c.page, 'local3.md', '# Local\n\nText\n', true);
    await until(() => c.page.evaluate(() => !!LMD.dictate));
    await caretLast(c.page); await micOn(c.page); await c.page.waitForSelector('.lmd-dlg'); await c.page.click('.lmd-dlg [data-dlg=ok]');
    await until(() => c.page.evaluate(() => { const h = document.querySelector('.lmd-dlg h3'); return h && h.textContent === 'Dictation'; }));
    check('si la descarga falla no escucha sin antes mostrar el aviso del proveedor', !(await srLog(c.page)).some((x) => /^start/.test(x)) && (await srLog(c.page)).includes('install:en-US'), await srLog(c.page));
    await c.page.click('.lmd-dlg [data-dlg=no]'); await sleep(200);
    check('y si no se acepta, no escucha', !(await srLog(c.page)).some((x) => /^start/.test(x)) && !(await dct(c.page)).active);
    await c.ctx.close();
  });

  // ---------- Pantalla chica ----------
  await step('Pantalla chica', async () => {
    const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, ...(ENGINE === 'firefox' ? {} : { isMobile: true }) };
    const { ctx, page } = await open({ tools: { dictate: true, speak: true }, ctx: phone, consent: true });
    await note(page, 'phone.md', '# Phone\n\nA paragraph to read and to dictate into.\n\n- One\n- Two\n', true);
    await until(() => page.evaluate(() => !!LMD.dictate && !!LMD.speak));
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.locator('.lmd-article p.lmd-editable').first().click(); await sleep(250);
    const mic = await page.evaluate(() => { const m = document.querySelector('.lmd-dct-mic'); const r = m.getBoundingClientRect(); const foot = document.querySelector('.lmd-foot').getBoundingClientRect(); return { shown: !m.hidden, docked: m.classList.contains('lmd-docked'), size: Math.round(r.width) + 'x' + Math.round(r.height), right: innerWidth - r.right <= 14 && r.right <= innerWidth, aboveFoot: r.bottom <= foot.top + 1 && r.bottom > innerHeight - 140 }; });
    check('el micrófono queda abajo a la derecha, grande para el dedo, arriba del pie', J(mic) === J({ shown: true, docked: true, size: '44x44', right: true, aboveFoot: true }), mic);
    await page.tap('.lmd-dct-mic'); check('con un toque empieza a escuchar', !!(await listening(page)));
    await say(page, 'formula x squared');
    await until(() => page.evaluate(() => !document.querySelector('.lmd-dct-pane').hidden && !!document.querySelector('.lmd-dct-pane .katex')), 8000);
    const bar = await page.evaluate(() => { const r = document.querySelector('.lmd-dct-bar').getBoundingClientRect(); const s = document.querySelector('[data-dct=stop]').getBoundingClientRect(); return { in: r.left >= 0 && r.right <= innerWidth && r.top >= 0, stop: s.right <= innerWidth && s.width > 40 }; });
    check('el indicador y su botón para cortar entran en la pantalla', bar.in && bar.stop && (await fits()) <= 0, [bar, await fits()]);
    await page.tap('.lmd-dct-bar [data-dct=help]'); await page.waitForSelector('.lmd-dct-help');
    const help = await page.evaluate(() => { const r = document.querySelector('.lmd-dct-help .lmd-ask-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; });
    check('la hoja de ayuda entra y se puede cerrar', help && (await fits()) <= 0);
    await page.tap('.lmd-dct-help [data-esc]');
    await page.tap('.lmd-dct-bar [data-dct=stop]'); check('y un toque corta', !!(await stopped(page)));
    await page.click('[data-act=mode-read]'); await sleep(400);
    await page.evaluate(() => { window.__tts.hold = true; LMD.speak.start({}); });
    await page.waitForSelector('.lmd-spk');
    const spk = await page.evaluate(() => { const r = document.querySelector('.lmd-spk').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    check('los controles de lectura entran en la pantalla', spk && (await fits()) <= 0);
    await page.tap('.lmd-spk [data-spk=stop]');
    await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForSelector('.lmd-panel-card');
    await page.tap('[data-ptab=tools]'); await page.waitForSelector('.lmd-tl-card');
    await page.tap('.lmd-tl-card[data-tool=dictate] .lmd-tl-more'); await page.waitForSelector('.lmd-tl-opts [data-dct=lang]');
    const pane = await page.evaluate(() => { const card = document.querySelector('.lmd-panel-card').getBoundingClientRect(); return [...document.querySelectorAll('section[data-tab=tools] *')].filter((n) => n.offsetParent && n.getBoundingClientRect().right > card.right + 1).length; });
    check('la pestaña Tools y sus opciones no se salen de la pantalla', pane === 0 && (await fits()) <= 0, [pane, await fits()]);
    check('sin errores de página', R.errors.length === 0, R.errors);
    await ctx.close();
  });
} finally {
  await R.close();
}
process.exit(done() ? 1 : 0);
