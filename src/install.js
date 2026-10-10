// Ajustes > Instalar: dónde abre el botón de la extensión, la extensión, la app instalada y el doble clic.
// También lo que llega con la app instalada: los archivos que Windows le manda con "Abrir con" (launchQueue),
// y el aviso de sin conexión de la barra de arriba.
(function () {
  'use strict';
  const T = LMD.t;
  const { ICON, el, esc } = LMD.kit;
  const APP = /\/app\.html$/.test(location.pathname);
  const WEB = APP && window.__MDT_WEB === true;
  const OWN = APP && location.protocol === 'chrome-extension:';
  const EXT = window.__MDT_WEB !== true; // dentro de la extensión: su página propia o un .md abierto en el navegador

  // Dónde se consigue la extensión. La de Android queda vacía hasta que la app esté publicada: sin dirección, su renglón no aparece.
  const EXTENSION_URL = 'https://chromewebstore.google.com/detail/ejgkmgehiacbnfognldclppemehapcek';
  const ANDROID_URL = '';
  const HELP_URL = new URL('../?site#faq', LMD.WEB_APP_URL).href;

  // ---------- Instalar la app ----------
  // Chrome avisa cuando la app se puede instalar; el aviso se guarda para dispararlo desde el botón de Ajustes.
  let offer = null; let repaint = null;
  const standalone = () => navigator.standalone === true || ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => window.matchMedia && window.matchMedia('(display-mode: ' + m + ')').matches);
  const IOS = LMD.device.ios; const MAC = LMD.device.mac;
  // Chrome y Edge avisan (beforeinstallprompt) cuando la app se puede instalar. Si pasados unos segundos no avisaron,
  // puede ser que ya esté instalada o que el aviso se haya descartado: ahí vale decir dónde está en el menú. Otro
  // navegador que tampoco avisó no instala apps (hay derivados de Chromium que no traen esa opción): se dice eso.
  // No se mira el nombre de ninguno: Chrome y Edge se reconocen por la marca que declaran (userAgentData), y como un
  // derivado puede declarar la de Chrome, el texto del menú lleva una salida para quien no encuentre la opción.
  const OFFER_WAIT = 6000;
  const sinceLoad = () => (window.performance && performance.now ? performance.now() : OFFER_WAIT);
  const installer = () => ((navigator.userAgentData && navigator.userAgentData.brands) || []).some((b) => b && (b.brand === 'Google Chrome' || b.brand === 'Microsoft Edge'));
  // El ícono de Compartir de Safari, dibujado: es lo que hay que buscar en la barra.
  const SHARE = '<span class="lmd-inst-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/></svg></span>';

  // ---------- Que el navegador no borre las notas ----------
  // Se pide guardado persistente. Safari en iPhone borra lo de un sitio sin uso por semanas si la app no está
  // instalada: ahí se avisa una sola vez.
  function keep(core) {
    if (!WEB || !navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().then((kept) => {
      if (kept || !IOS || standalone()) return;
      try { if (localStorage.getItem('sharpmd:keep-told') === '1') return; localStorage.setItem('sharpmd:keep-told', '1'); } catch (e) { return; }
      setTimeout(() => core.flash(T('Safari puede borrar las notas de este navegador tras semanas sin uso. Conviene instalar la app o usar la nube.'), 'warn'), 1500);
    }).catch(() => { /* el navegador no responde: queda como estaba */ });
  }
  const wasInstalled = () => { try { return localStorage.getItem('sharpmd:installed') === '1'; } catch (e) { return false; } };
  const markInstalled = (on) => { try { if (on) localStorage.setItem('sharpmd:installed', '1'); else localStorage.removeItem('sharpmd:installed'); } catch (e) { /* sin almacenamiento */ } };
  if (WEB) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; markInstalled(false); if (repaint) repaint(); });
    window.addEventListener('appinstalled', () => { offer = null; markInstalled(true); if (repaint) repaint(); });
  }

  // ---------- Lo que llega de afuera: qué se puede abrir ----------
  const SHARE_CACHE = 'lmd-share'; const SHARE_MAX = 5 * 1024 * 1024;
  const SHARE_EXT = /\.(md|markdown|mdx|mkd|mdown|txt|json|ya?ml)$/i; // lo mismo que deja elegir "Abrir archivo"
  const SHARE_TYPES = { 'text/markdown': '.md', 'text/x-markdown': '.md', 'text/plain': '.txt', 'application/json': '.json', 'application/yaml': '.yaml', 'application/x-yaml': '.yaml', 'text/yaml': '.yaml' };
  // Muchos gestores de archivos mandan un .md como application/octet-stream, como texto o sin extensión en el nombre.
  // Con un nombre que la app conoce se abre sin más; si no, decide el contenido: si es texto, se abre. Lo que dice ser
  // otra cosa (una imagen, un PDF) no se abre.
  const TEXTISH = /^(text\/.+|application\/(octet-stream|json|yaml|x-yaml|markdown|x-markdown|x-unknown))$/;
  async function looksText(blob) {
    const bytes = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 27)) return false;
    return true;
  }
  // Devuelve { file } con un nombre que el lector sabe abrir, o { why } con el aviso.
  async function asNote(blob, name, type, size) {
    name = String(name || '').replace(/[\\/]/g, '-').slice(0, 200);
    type = String(type || (blob && blob.type) || '').split(';')[0].trim().toLowerCase();
    const known = SHARE_EXT.test(name);
    if (!known && type && !TEXTISH.test(type)) return { why: T('Solo se abren archivos Markdown, de texto, JSON o YAML.') };
    if (!blob || blob.size > SHARE_MAX || size > SHARE_MAX) return { why: T('Ese archivo es demasiado grande para abrirlo acá.') };
    if (!known) {
      if (!(await looksText(blob))) return { why: T('Solo se abren archivos Markdown, de texto, JSON o YAML.') };
      name = (name || 'shared') + (SHARE_TYPES[type] || (/\.[a-z0-9]{1,8}$/i.test(name) ? '.txt' : '.md'));
    }
    return { file: new File([blob], name) };
  }
  const COPY_NOTE = 'Se abrió una copia. Los cambios no se guardan en el archivo original.';

  // ---------- "Abrir con": el archivo que manda el sistema ----------
  // El consumidor se registra apenas carga este archivo, antes de que arranque el lector: lo que llega mientras tanto
  // espera en una fila. Queda registrado, así que también atiende un archivo que llega con la app ya abierta.
  let onLaunch = null; const queued = []; let arrived = false;
  if (WEB && window.launchQueue && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer((params) => {
      if (!params || !params.files || !params.files.length) return; // un arranque común, sin archivo
      arrived = true;
      if (onLaunch) onLaunch(params); else queued.push(params);
    });
  }
  // Con permiso de escritura se abre en su lugar y queda en la lista de abiertos, como uno elegido a mano. Con
  // permiso de solo lectura, o con un nombre que el lector no conoce, se abre una copia y se avisa.
  async function openLaunched(params, homeCtx) {
    const handle = params && params.files && params.files[0];
    if (!handle || handle.kind !== 'file') return false;
    arrived = true; unmiss();
    const ctx = homeCtx();
    let own = SHARE_EXT.test(handle.name || '');
    if (own && handle.queryPermission) { try { own = (await handle.queryPermission({ mode: 'readwrite' })) !== 'denied'; } catch (e) { own = false; } }
    if (own) {
      try { await LMD.home.adopt(ctx, handle); return true; }
      catch (e) { /* sin lugar donde guardar el permiso (pasa en algunos teléfonos): se abre una copia */ }
    }
    try {
      const file = await handle.getFile();
      const got = await asNote(file, handle.name || file.name, file.type);
      if (got.why) { ctx.say(got.why); return false; }
      let failed = '';
      await LMD.home.openFile(ctx, got.file, (text) => { failed = text; });
      if (failed) { ctx.say(failed); return false; }
      ctx.warn(T(COPY_NOTE));
      return true;
    } catch (e) { ctx.say(T('No se pudo abrir. Probá de nuevo.')); return false; }
  }

  // ---------- Se esperaba un archivo y no llegó ----------
  // La app de Android abre con ?open=1 cuando la lanzaron para abrir un archivo. Si el navegador que la muestra no lo
  // entrega (ni por la fila de archivos ni como envío compartido), el inicio lo dice y deja el botón de abrir a un
  // toque, en vez de quedar mudo.
  const OPEN_WAIT = 2500;
  function unmiss() { document.querySelectorAll('.lmd-open-miss').forEach((n) => n.remove()); }
  function miss(ctx, text) {
    const card = ctx && ctx.box && !ctx.box.hidden && ctx.box.querySelector('.lmd-home-card');
    if (!card) return false;
    unmiss();
    const box = el('div', { class: 'lmd-open-miss', role: 'status' });
    box.appendChild(el('p', { text }));
    const btn = el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-home': 'file' }, ICON.file + '<span></span>');
    btn.lastChild.textContent = T('Abrir archivo');
    btn.addEventListener('click', () => setTimeout(unmiss, 0)); // el clic lo atiende el inicio: abre el selector
    box.appendChild(btn);
    const actions = card.querySelector('.lmd-home-actions');
    if (actions) actions.after(box); else card.appendChild(box);
    return true;
  }
  // El inicio se dibuja después de leer la dirección: se espera a que esté.
  function missSoon(homeCtx, text, wait) {
    let tries = 0;
    const go = () => { if (arrived || /[?&]f=/.test(location.search)) return; if (!miss(homeCtx(), text) && ++tries < 40) setTimeout(go, 150); };
    setTimeout(go, wait || 0);
  }
  function expect(homeCtx) {
    try { const u = new URL(location.href); u.searchParams.delete('open'); history.replaceState(history.state, '', u.href); } catch (e) { /* dirección rara */ }
    missSoon(homeCtx, T('Este navegador no entregó el archivo. Abrilo con el botón de abajo.'), OPEN_WAIT);
  }

  // ---------- "Compartir": lo que manda otra app ----------
  // El service worker (sw.js) recibe el envío, lo deja en una caché aparte y manda a app.html?share=1. Acá se
  // recoge una sola vez: un archivo se abre como uno elegido a mano, sin guardar; un texto o un enlace, como nota nueva.
  // Devuelve true si abrió algo; si no, el aviso para el inicio. Si no llegó nada, el inicio lo dice con su botón.
  function sharedNote(meta) {
    const one = (v) => String(v || '').replace(/\r\n?/g, '\n').trim();
    const title = one(meta.title).replace(/\s+/g, ' '); const text = one(meta.text); let url = one(meta.url);
    if (!/^https?:\/\/\S+$/i.test(url)) url = '';
    const parts = [];
    if (title) parts.push('# ' + title);
    if (text) parts.push(text);
    if (url && !text.includes(url)) parts.push('<' + url + '>');
    return parts.length ? parts.join('\n\n') + '\n' : '';
  }
  async function takeShared(ctx) {
    try { const u = new URL(location.href); u.searchParams.delete('share'); history.replaceState(history.state, '', u.href); } catch (e) { /* dirección rara */ }
    let meta = null; let body = null;
    try {
      const cache = await caches.open(SHARE_CACHE); const at = (name) => new URL('share/' + name, location.href).href;
      const m = await cache.match(at('meta')); const f = await cache.match(at('file'));
      meta = m ? await m.json() : null; body = f ? await f.blob() : null;
      await caches.delete(SHARE_CACHE);
    } catch (e) { /* sin caché: no hay nada que recoger */ }
    // El envío no se pudo leer, o llegó vacío (pasa cuando el navegador descarta el archivo por su tipo).
    const nothing = () => { missSoon(() => ctx, T('Lo compartido no llegó. Abrí el archivo con el botón de abajo.')); return ''; };
    if (!meta || typeof meta !== 'object') return nothing();
    arrived = true;
    const file = meta.file;
    if (file) {
      const got = await asNote(body, file.name, file.type, +file.size || 0);
      if (got.why) return got.why;
      let failed = '';
      LMD.home.account(ctx);
      await LMD.home.openFile(ctx, got.file, (text) => { failed = text; });
      if (failed) return failed;
      ctx.warn(meta.count > 1 ? T('Llegaron {n} archivos. Se abrió el primero.', { n: meta.count }) : T(COPY_NOTE));
      return true;
    }
    const text = sharedNote(meta);
    if (!text) { arrived = false; return nothing(); }
    if (text.length > SHARE_MAX) return T('Ese texto es demasiado grande para abrirlo acá.');
    LMD.home.account(ctx);
    await LMD.home.create(ctx, { text, replace: true });
    return true;
  }

  // ---------- Sin conexión ----------
  function offlineChip() {
    const bar = document.querySelector('.lmd-top-right');
    if (!bar || bar.querySelector('.lmd-offline')) return;
    const chip = el('span', { class: 'lmd-offline', role: 'status', title: T('Lo guardado en este dispositivo sigue disponible. La nube se actualiza al volver la conexión.') }, ICON.cloud + '<span></span>');
    chip.querySelector('span').textContent = T('Sin conexión');
    bar.prepend(chip);
    const paint = () => { chip.hidden = navigator.onLine !== false; };
    window.addEventListener('online', paint); window.addEventListener('offline', paint);
    paint();
  }

  // ---------- Compartir hacia otra app ----------
  // En el teléfono, "Compartir" abre una hoja propia con caminos claros: como texto (lo que mejor anda en WhatsApp y
  // en los chats), como archivo, con un enlace público o copiando. La hoja de compartir del sistema solo abre dentro
  // del toque: por eso el texto y los archivos se arman al abrir esta hoja, y el enlace, que hay que pedirlo al
  // servidor, se comparte con un segundo toque. Si falla se dice, con la alternativa a un toque. Cancelar no es un error.
  const LONG_TEXT = 60000; // más largo que esto, WhatsApp y otros chats cortan el mensaje
  const MIME = { md: 'text/markdown', markdown: 'text/markdown', mdx: 'text/markdown', mkd: 'text/markdown', mdown: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml' };
  const refused = {}; // extensiones que este navegador ya rechazó al compartir: no se vuelven a ofrecer en esta sesión
  let host = null; let sheet = null;
  const canShareOut = () => LMD.touch.coarse() || LMD.storeApp === true;
  const canFile = (file) => { try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; } };
  // El archivo con su tipo; si el navegador no lo toma, el mismo nombre como texto plano; y aparte, como .txt.
  function filesFor(text, name) {
    const ext = ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || '').toLowerCase(); const type = MIME[ext] || 'text/markdown';
    const base = name.replace(/\.[a-z0-9]+$/i, '') || 'note';
    const same = refused[ext] ? null : [new File([text], name, { type })].concat(type === 'text/plain' ? [] : [new File([text], name, { type: 'text/plain' })]).find(canFile) || null;
    const txt = ext === 'txt' || refused.txt ? null : [new File([text], base + '.txt', { type: 'text/plain' })].find(canFile) || null;
    return { ext: ext || 'md', same, txt };
  }
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
  // o: { text, name, cloud }. El enlace público se ofrece si la nota está en la nube y la cuenta puede crear enlaces.
  function shareOut(o) {
    closeSheet();
    const text = String(o.text || ''); const name = String(o.name || 'note.md'); const files = filesFor(text, name);
    const flash = (msg, kind) => { if (host) host.flash(msg, kind); };
    const title = T('Compartir');
    const box = sheet = el('div', { class: 'lmd-ask lmd-so' }, '<div class="lmd-ask-card lmd-so-card" role="dialog" aria-modal="true"><h3></h3><p class="lmd-so-name"></p>' +
      '<p class="lmd-hint lmd-so-long" hidden></p><div class="lmd-so-list"></div><div class="lmd-so-link" hidden></div>' +
      '<p class="lmd-img-err" role="alert" hidden></p><div class="lmd-so-alt" hidden></div>' +
      '<div class="lmd-ask-actions"><button type="button" class="lmd-btn" data-so="close" data-esc></button></div></div>');
    const q = (sel) => box.querySelector(sel);
    q('.lmd-ask-card').setAttribute('aria-label', title); q('h3').textContent = title; q('.lmd-so-name').textContent = name; q('[data-so=close]').textContent = T('Cerrar');
    const list = q('.lmd-so-list'); const err = q('.lmd-img-err'); const alt = q('.lmd-so-alt');
    const option = (act, icon, label, sub) => {
      const b = el('button', { type: 'button', class: 'lmd-so-opt', 'data-so': act }, icon + '<span><b></b><small></small></span>');
      b.querySelector('b').textContent = label; b.querySelector('small').textContent = sub || ''; b.querySelector('small').hidden = !sub;
      list.appendChild(b);
      return b;
    };
    const asFile = (ext) => T('Compartir como archivo {a}', { a: '.' + ext });
    option('text', ICON.b_p, T('Compartir como texto'), T('Lo que mejor anda en WhatsApp y en los chats.'));
    if (files.same) option('file', ICON.file, asFile(files.ext));
    if (files.txt) option('txt', ICON.txt, asFile('txt'), files.same ? T('Por si la otra app no toma el .{a}.', { a: files.ext }) : T('Este navegador no comparte archivos .{a}: va como .txt.', { a: files.ext }));
    if (!files.same && !files.txt) option('save', ICON.download, T('Descargar el archivo'), T('Este navegador no comparte archivos.'));
    if (o.cloud && LMD.sync.canLink()) option('link', ICON.link, T('Compartir un enlace'), T('Crea un enlace público de solo lectura.'));
    option('copy', ICON.copy, T('Copiar'), T('El Markdown, para pegarlo donde quieras.'));
    if (text.length > LONG_TEXT) { const long = q('.lmd-so-long'); long.hidden = false; long.textContent = T('Esta nota es larga y un chat puede cortarla. Va mejor como archivo o como enlace.'); }

    const clear = () => { err.hidden = true; err.textContent = ''; alt.hidden = true; alt.textContent = ''; };
    // El aviso de lo que falló, con las alternativas a un toque: cada una es un toque nuevo, con su propio gesto.
    const fail = (msg, acts) => {
      clear(); err.hidden = false; err.textContent = msg;
      (acts || []).forEach(([act, label]) => alt.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-so': act, text: label })));
      alt.hidden = !alt.childNodes.length;
    };
    const copy = (what) => { if (host) host.copy(what); }; // avisa "Copiado" por su cuenta
    const save = () => { closeSheet(); if (LMD.kit.saveFile(new Blob([text], { type: MIME[files.ext] || 'text/markdown' }), name) === 'download') flash(T('Archivo descargado')); };
    // navigator.share se llama acá mismo, sin esperar nada antes: así sigue dentro del toque.
    const send = (data, onFail) => {
      let wait;
      try { wait = navigator.share(data); } catch (e) { onFail(e); return; }
      Promise.resolve(wait).then(closeSheet, (e) => { if (!e || e.name !== 'AbortError') onFail(e); }); // cerrar la hoja del sistema no es un error
    };
    const textFail = () => fail(T('No se pudo compartir. Copiá el texto y pegalo en la otra app.'), [['copy', T('Copiar')]]);
    const shareText = () => {
      if (!navigator.share) { fail(T('Este navegador no comparte desde la app. Copiá el texto y pegalo en la otra app.'), [['copy', T('Copiar')]]); return; }
      send({ title: name, text }, textFail);
    };
    const shareFile = (file, ext) => {
      if (!file) return;
      send({ files: [file], title: name }, () => {
        refused[ext] = true; // el navegador dijo que podía y no pudo: no se vuelve a ofrecer así
        const b = list.querySelector('[data-so=' + (ext === 'txt' ? 'txt' : 'file') + ']'); if (b) b.remove();
        fail(T('No se pudo compartir el archivo. ¿Compartirlo como texto?'), [['text', T('Compartir como texto')]].concat(ext !== 'txt' && files.txt && !refused.txt ? [['txt', asFile('txt')]] : [], [['save', T('Descargar')]]));
      });
    };
    // El enlace hay que pedirlo: al tenerlo queda a la vista, y compartirlo es un toque nuevo.
    let linking = false; let url = '';
    const shareLink = async (btn) => {
      if (linking) return;
      linking = true; btn.disabled = true;
      try {
        const got = await LMD.sync.publicLink();
        if (sheet !== box) return;
        url = got.url; list.hidden = true; q('.lmd-so-long').hidden = true;
        const pane = q('.lmd-so-link'); pane.hidden = false; pane.textContent = '';
        pane.appendChild(el('input', { type: 'text', readonly: '', 'aria-label': T('Enlace'), value: url }));
        if (!got.reused) pane.appendChild(el('p', { class: 'lmd-hint', text: T('Copiá el enlace ahora: no se vuelve a mostrar.') }));
        const row = pane.appendChild(el('div', { class: 'lmd-so-alt' }));
        if (navigator.share) row.appendChild(el('button', { type: 'button', class: 'lmd-btn lmd-btn-fill', 'data-so': 'send-link', text: T('Compartir el enlace') }));
        row.appendChild(el('button', { type: 'button', class: 'lmd-btn', 'data-so': 'copy-link', text: T('Copiar el enlace') }));
      } catch (e) { fail(LMD.sync.linkWhy(e), [['text', T('Compartir como texto')]]); btn.disabled = false; }
      linking = false;
    };
    box.addEventListener('click', (e) => {
      if (e.target === box) { closeSheet(); return; }
      const b = e.target.closest('[data-so]'); if (!b) return;
      const act = b.dataset.so;
      if (act === 'close') { closeSheet(); return; }
      clear();
      if (act === 'text') shareText();
      else if (act === 'file') shareFile(files.same, files.ext);
      else if (act === 'txt') shareFile(files.txt, 'txt');
      else if (act === 'save') save();
      else if (act === 'copy') { copy(text); closeSheet(); }
      else if (act === 'link') shareLink(b);
      else if (act === 'send-link') send({ title: name, url }, () => fail(T('No se pudo compartir. Copiá el enlace y pegalo en la otra app.'), [['copy-link', T('Copiar el enlace')]]));
      else if (act === 'copy-link') { copy(url); flash(T('Enlace copiado')); }
    });
    document.body.appendChild(box);
    return box;
  }

  function init(core, homeCtx) {
    host = core;
    if (!APP) return;
    offlineChip();
    keep(core);
    onLaunch = (params) => { openLaunched(params, homeCtx); };
    queued.splice(0).forEach(onLaunch);
  }

  // ---------- La pestaña de Ajustes ----------
  const head = (text) => '<h4>' + esc(T(text)) + '</h4>';
  const line = (text, extra) => '<div class="lmd-inst-row"><p>' + text + '</p>' + (extra || '') + '</div>';
  const out = (href, text, cls) => '<a class="' + (cls || 'lmd-btn') + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(T(text)) + '</a>';

  async function pane(box) {
    repaint = () => { if (box.isConnected) pane(box); };
    // Dentro de la app de Android no hay nada que instalar: solo cómo seguir en la computadora.
    if (LMD.storeApp) {
      box.innerHTML = head('En la computadora') + line(esc(T('Abrí sharpmd.app en Chrome. Con tu cuenta, las notas de la nube son las mismas.')));
      return;
    }
    if (WEB) await LMD.bridge.settle(); // con la extensión instalada, su primera respuesta dice la versión
    const s = await LMD.load();
    const info = WEB ? LMD.bridge.info() : null;
    const ext = EXT || (WEB && LMD.bridge.present());
    const version = EXT ? chrome.runtime.getManifest().version : info ? info.v : '';
    let fileAccess = info ? info.fileAccess : null;
    if (OWN) { try { fileAccess = await chrome.extension.isAllowedFileSchemeAccess(); } catch (e) { fileAccess = null; } }
    else if (EXT && location.protocol === 'file:') fileAccess = true;
    // En un teléfono no hay extensiones ni doble clic.
    const desktop = !IOS && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const web = s.openIn !== 'ext';
    let html = '';
    if (ext) {
      html += head('Abrir SharpMD en') + '<div class="lmd-inst-open" role="radiogroup" aria-label="' + esc(T('Abrir SharpMD en')) + '">' +
        '<label class="lmd-inst-opt"><input type="radio" name="lmd-open-in" value="web"' + (web ? ' checked' : '') + '><span>' + esc(T('App web (recomendada). Sin conexión se abre en la extensión, con las mismas notas.')) + '</span></label>' +
        '<label class="lmd-inst-opt"><input type="radio" name="lmd-open-in" value="ext"' + (web ? '' : ' checked') + '><span>' + esc(T(EXT ? 'Esta extensión' : 'La extensión')) + '</span></label>' +
      '</div>';
    }
    // Sin el permiso para archivos del disco la extensión no abre los .md del disco: se dice acá, con el botón que
    // lleva a sus ajustes en el navegador (desde la web lo abre la extensión: una página no puede abrir chrome://).
    const noAccess = fileAccess === false && (OWN || WEB);
    let never = false;
    if (OWN && noAccess) { try { never = ((await chrome.storage.local.get('fileSetup')).fileSetup || {}).never === true; } catch (e) { /* sin almacenamiento */ } }
    if (desktop) {
      html += head('Extensión de Chrome') + (ext
        ? line(esc(T('Instalada, versión {v}', { v: version })) + (fileAccess === true ? ' · ' + esc(T('Acceso a archivos: sí')) : fileAccess === false ? ' · ' + esc(T('Acceso a archivos: no')) : ''),
          noAccess ? '<button type="button" class="lmd-btn" data-inst="details">' + esc(T('Abrir los ajustes de la extensión')) + '</button>' : '') +
          (noAccess ? '<p class="lmd-hint" data-inst-how>' + esc(T('O entrá a las extensiones del navegador, buscá SharpMD, Detalles.')) + (OWN && !never ? ' <button type="button" class="lmd-link" data-inst="never">' + esc(T('No uso archivos del disco')) + '</button>' : '') + '</p>' : '')
        : line(esc(T('No está en este navegador.')) + ' ' + esc(T('Abre los .md del disco y de cualquier sitio, también sin conexión.')), out(EXTENSION_URL, 'Conseguir la extensión')));
    }
    html += head(IOS ? 'En iPhone y iPad' : MAC ? 'En Mac' : 'Instalar como app');
    const gives = esc(T(MAC ? 'Ventana propia y su ícono en el Dock.' : 'Ventana propia y "Abrir con" para los .md en Windows.'));
    if (EXT) html += line(gives + ' ' + esc(T('Se instala desde la app web.')), out(LMD.WEB_APP_URL, 'Abrir la app web'));
    else if (standalone() || (wasInstalled() && !offer)) html += line(esc(T('Ya está instalada.')));
    else if (offer) html += line(gives, '<button type="button" class="lmd-btn lmd-btn-fill" data-inst="app">' + esc(T('Instalar')) + '</button>');
    else if (IOS) html += '<ol class="lmd-inst-steps" data-inst-ios><li>' + esc(T('En Safari, tocá Compartir')) + ' ' + SHARE + '</li><li>' + esc(T('Elegí "Agregar a inicio".')) + '</li><li>' + esc(T('Abrila desde su ícono: pantalla completa, también sin conexión.')) + '</li></ol>' +
      '<p class="lmd-inst-keep">' + esc(T('Sin instalar, Safari puede borrar las notas del navegador tras semanas sin uso.')) + '</p>';
    else if (MAC) html += '<ol class="lmd-inst-steps" data-inst-mac><li>' + esc(T('En Safari: menú Archivo, Agregar al Dock.')) + '</li><li>' + esc(T('En Chrome o Edge: el ícono de instalar, en la barra de direcciones.')) + '</li></ol>' + '<p class="lmd-inst-keep">' + gives + '</p>';
    else if (desktop && !installer()) {
      // Mientras el aviso todavía puede llegar, solo lo que da; después, la verdad en corto.
      const left = OFFER_WAIT - sinceLoad();
      html += line(left > 0 ? gives : esc(T('Este navegador no ofrece instalar apps. Funciona en Chrome y Edge.')));
      if (left > 0) setTimeout(() => { if (repaint) repaint(); }, left + 50);
    }
    else html += line(gives + ' ' + esc(T('Desde el menú del navegador: Instalar SharpMD. En iPhone: Compartir, Agregar a inicio.')) + (desktop ? ' ' + esc(T('Si el menú no trae esa opción, este navegador no instala apps: usá Chrome o Edge.')) : ''));
    if (desktop) {
      html += head('Abrir los .md con doble clic') +
        '<ol class="lmd-inst-steps"><li>' + esc(T(MAC ? 'En Finder: clic derecho en un .md, Obtener información, Abrir con, Chrome, Cambiar todo.' : 'Clic derecho en un .md, Abrir con, Elegir otra aplicación, Chrome, Siempre.')) + '</li>' +
        '<li>' + esc(T(fileAccess === true ? 'El acceso a archivos ya está activado.' : 'En los detalles de la extensión, activá "Permitir acceso a URL de archivo".')) + '</li></ol>' +
        '<div class="lmd-inst-links">' + out(HELP_URL, 'Ayuda', 'lmd-link') + '</div>';
    }
    // Un PDF abierto desde el disco, en el visor de SharpMD en vez del visor del navegador. Viene apagado, y solo
    // existe donde corre la extensión: prenderlo registra pdfopen.js sobre file:///*.pdf (bridge-sw.js, syncPdf).
    if (EXT && desktop) html += '<label class="lmd-check lmd-inst-pdf"><input type="checkbox" data-inst="pdf"' + (s.diskPdf === true ? ' checked' : '') + '><span>' + esc(T('Abrir los PDF del disco con SharpMD')) + '</span></label>' +
      '<p class="lmd-hint">' + esc(T('Un PDF de tu computadora se ve acá y no en el visor del navegador. Los de sitios web no cambian.')) + '</p>';
    // Qué puede leer la app web por la extensión al abrir un enlace a un archivo del disco. Se maneja solo desde la
    // extensión: la web no puede prenderlo ni sumar carpetas.
    if (EXT && desktop) html += head('Carpetas de las que la app web puede abrir archivos') + '<div data-inst-files></div>';
    if (ANDROID_URL) html += head('App de Android') + line(esc(T('La misma app en el teléfono, con tus notas de la nube.')), out(ANDROID_URL, 'Conseguir la app'));
    box.innerHTML = html;

    box.querySelectorAll('input[name=lmd-open-in]').forEach((input) => input.addEventListener('change', () => { if (input.checked) LMD.patch({ openIn: input.value }); }));
    const pdf = box.querySelector('[data-inst=pdf]');
    if (pdf) pdf.addEventListener('change', () => LMD.patch({ diskPdf: pdf.checked }));
    const install = box.querySelector('[data-inst=app]');
    if (install) install.addEventListener('click', async () => {
      const e = offer; if (!e) return;
      offer = null;
      try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') markInstalled(true); } catch (err) { /* el navegador no lo mostró */ }
      pane(box);
    });
    const files = box.querySelector('[data-inst-files]');
    if (files) {
      let w = {};
      try { w = (await chrome.storage.local.get('webFiles')).webFiles || {}; } catch (e) { /* sin almacenamiento */ }
      const roots = Array.isArray(w.roots) ? w.roots.filter((r) => r && typeof r.url === 'string') : [];
      const put = (next) => chrome.storage.local.set({ webFiles: next }).then(() => { if (box.isConnected) pane(box); });
      const sw = el('label', { class: 'lmd-check' }); const on = el('input', { type: 'checkbox', 'data-inst': 'web-files' }); on.checked = w.off !== true;
      sw.append(on, el('span', { text: T('La app web puede abrir archivos del disco por la extensión') }));
      on.addEventListener('change', () => put({ off: !on.checked, roots }));
      files.appendChild(sw);
      files.appendChild(el('p', { class: 'lmd-hint', text: T('Solo al abrir un enlace a un archivo, y solo dentro de las carpetas de los archivos que abriste con la extensión.') }));
      if (roots.length) {
        const list = el('ul', { class: 'lmd-inst-files' });
        roots.forEach((r) => list.appendChild(el('li', { text: LMD.filePath(r.url) })));
        files.appendChild(list);
        const clear = el('button', { type: 'button', class: 'lmd-btn', 'data-inst': 'files-clear', text: T('Vaciar la lista') });
        clear.addEventListener('click', () => put({ off: w.off === true, roots: [] }));
        files.appendChild(el('div', { class: 'lmd-inst-links' })).appendChild(clear);
      } else files.appendChild(el('p', { class: 'lmd-hint', 'data-inst-none': '', text: T('Todavía no hay ninguna.') }));
    }
    const details = box.querySelector('[data-inst=details]');
    if (details) details.addEventListener('click', () => { LMD.bridge.setup(); });
    const drop = box.querySelector('[data-inst=never]');
    if (drop) drop.addEventListener('click', async () => { await LMD.bridge.setupNever(); if (box.isConnected) pane(box); });
  }

  // ---------- Un enlace https que abre un archivo del disco ----------
  // app.html#open=<la dirección file:// codificada, o la ruta del sistema>. Un enlace lo puede mandar cualquiera: nunca
  // se abre sin el clic de quien mira, y la ruta se muestra siempre como texto. Antes de preguntar ya se sabe qué va
  // a hacer el botón, así que hay una sola pregunta, con el botón rotulado por lo que hace:
  // - "Abrir", si la extensión puede entregar el archivo (está en una carpeta que la persona ya abrió con ella): el
  //   texto llega por el puente y se muestra acá, como copia. Con "Abrir SharpMD en: la extensión", y en la página de
  //   la extensión, esta pestaña pasa al archivo, en su lector.
  // - "Elegir el archivo", en cualquier otro caso (sin extensión, carpeta sin habilitar, lectura apagada): el clic
  //   copia la ruta y abre el selector de archivos. El archivo elegido se abre acá, con su permiso, y guardar escribe
  //   en él. La pestaña nunca sale de la app.
  // La web no puede habilitar carpetas. Para que los enlaces a una carpeta pasen a abrirse con un clic, la pregunta
  // ofrece abrir el archivo una vez con la extensión: va a una pestaña nueva, y es el lector quien pregunta ahí.
  let asking = false;
  async function openLink(frag, ctx) {
    if (asking) return false;
    asking = true;
    try { return await askOpen(frag, ctx); } finally { asking = false; }
  }
  const low = (t) => String(t).toLowerCase();
  // De lo ya abierto, lo más cercano a ese archivo, para que el selector arranque ahí: el mismo archivo, o la carpeta
  // abierta que esté más abajo en su ruta (por nombre: de un permiso no se sabe la ruta). Si no hay, lo más reciente.
  async function nearest(parts, name) {
    let best = null; let score = -1;
    try {
      for (const r of await LMD.store.rootsAll()) {
        if (!r.handle || r.ghost) continue;
        const at = r.kind === 'dir' ? parts.map(low).lastIndexOf(low(r.name)) : -1;
        const mine = r.kind === 'file' && low(r.name) === low(name) ? 1000 : at >= 0 ? 10 + at : 0;
        if (mine > score) { best = r; score = mine; }
      }
    } catch (e) { /* sin lista de abiertos */ }
    return best ? best.handle : null;
  }
  // failed: la app ya intentó abrirlo (al seguir un enlace de una nota, o al recargar) y no pudo; dice por qué. Ahí
  // no se pregunta de nuevo: sale directo la pregunta que ofrece elegir el archivo.
  async function askOpen(frag, ctx, failed) {
    const D = LMD.dialog; const title = T('¿Abrir este archivo de tu disco?');
    let given = String(frag || '');
    try { given = decodeURIComponent(given); } catch (e) { /* un % suelto: vale como está */ }
    const url = LMD.fileUrl(given);
    // Un PDF, un libro o una imagen: en la página de la extensión se ven en el visor, que lee el archivo por su service
    // worker. En la app web todavía no: por el puente llega solo texto, y el enlace se rechaza como hasta ahora.
    if (!url && OWN && !failed) {
      const any = LMD.fileUrl(given, true); let seen = '';
      try { seen = any ? decodeURIComponent(new URL(any).pathname.split('/').pop()) : ''; } catch (e) { seen = ''; }
      if (seen && ctx.disk.views(seen)) { if (!(await D.confirm({ title, path: LMD.filePath(any), ok: T('Abrir') }))) return false; return ctx.open(ctx.disk.doc(any)); }
    }
    if (!url) { await D.confirm({ title: T('Este enlace no se puede abrir'), text: T('Solo se abren archivos Markdown del disco.'), ok: T('Cerrar'), cancel: false }); return false; }
    const path = LMD.filePath(url);
    const parts = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean); const name = parts.pop();
    const copyNote = () => ctx.warn(T('Se abrió una copia. El archivo del disco no cambia.'));
    // El archivo, en la app: por su ruta real (content.js decide si es el archivo de una carpeta ya abierta o una
    // copia que lee la extensión).
    const show = () => ctx.open(ctx.disk.doc(url));
    // El selector recuerda por id dónde quedó: uno por carpeta, así el próximo enlace a esa carpeta arranca en ella.
    const pid = 'lmd-o-' + LMD.bridge.hash(low(parts.join('/'))).replace(/[^a-z0-9]/gi, '').slice(0, 24);
    const startIn = await nearest(parts, name);
    // Elegir el archivo: la ruta al portapapeles y el selector, los dos con el mismo clic y en ese orden (los dos
    // piden un gesto). La ruta copiada es una ayuda, no un paso obligado: en algunos navegadores pegarla en el
    // selector no anda, así que la instrucción dice buscar el archivo.
    const HOW = T('Buscá "{a}" en el selector. La ruta queda copiada, por si tu navegador deja pegarla (Ctrl+V).', { a: name });
    const pickNow = (d) => {
        let copied = null;
        try { copied = navigator.clipboard.writeText(path); } catch (e) { copied = Promise.reject(e); }
        d.note(HOW);
        copied.then(() => {}, () => d.note(T('Buscá "{a}" en el selector.', { a: name })));
        LMD.home.pickLinked(ctx, pid, startIn).then(async (got) => {
          if (!got) return;
          const open = async () => { LMD.home.account(ctx); await LMD.home.openLinked(ctx, got); if (got.file) copyNote(); d.close(true); };
          // Otro archivo que el del enlace: se dice, y se puede elegir de nuevo o abrir ese.
          if (low(got.name) !== low(name)) d.note(T('Elegiste "{a}". El enlace es a "{b}".', { a: got.name, b: name }), { label: T('Abrir "{a}" igual', { a: got.name }), go: open });
          else await open();
        });
    };
    const choose = (o) => D.confirm(Object.assign({ title, path, ok: T('Elegir el archivo'), note: HOW }, o, { act: pickNow }));
    const once = async () => { const r = await LMD.bridge.openFile(url, true); if (!(r && r.ok && r.opened)) ctx.say(T('La extensión no lo pudo abrir.')); };
    // Por qué no se pudo, dicho en la pregunta que ofrece elegirlo.
    const because = (why) => {
      if (why === 'none') return choose({ text: T('Sin la extensión de Chrome, elegí el archivo.'), link: { href: EXTENSION_URL, text: T('Conseguir la extensión') } });
      if (why === 'old') return choose({ text: T('Esta versión de la extensión no abre archivos por enlace. Elegí el archivo.') });
      if (why === 'refused') return choose({ text: T('Por enlace, la extensión solo abre lo que está en carpetas que ya abriste con ella. Elegí el archivo.'), more: { text: T('Para abrir con un clic los enlaces a esta carpeta:'), link: T('Abrirlo una vez con la extensión'), go: once } });
      if (why === 'access') return choose({ title: T('A la extensión le falta el permiso para archivos del disco'), text: T('Prendelo en los ajustes de la extensión, o elegí el archivo.'), cancel: T('Cerrar'), more: { text: '', link: T('Abrir los ajustes de la extensión'), go: () => LMD.bridge.setup() } });
      if (why === 'missing') return choose({ title: T('No se encontró el archivo'), text: T('Puede que se haya movido o que tenga otro nombre.'), cancel: T('Cerrar') });
      return choose({ title: T('La extensión no lo pudo abrir'), text: T('Actualizala o elegí el archivo a mano.'), cancel: T('Cerrar') });
    };
    await LMD.bridge.settle(); // el puente con la extensión se presenta al cargar: se espera a saber si está
    const ext = LMD.bridge.canOpen();
    if (failed) return because(!ext ? 'none' : failed);
    // Con "Abrir SharpMD en: la extensión", y en su página propia, lo muestra el lector de la extensión en esta pestaña.
    const inReader = ext && (OWN || (await LMD.load()).openIn === 'ext');
    // La web ya tiene abierta, con permiso, una carpeta que lo contiene: es el archivo real, con o sin extensión.
    if (!inReader && await ctx.disk.real(url)) { if (!(await D.confirm({ title, path, ok: T('Abrir') }))) return false; return show(); }
    if (!ext) return because('none');
    // can: true si la extensión lo entrega, false si no (no dice si el archivo existe), null si es una extensión anterior.
    const can = inReader ? true : await LMD.bridge.canRead(url);
    // Una extensión anterior, que entrega archivos pero no contesta si puede: se pregunta con "Abrir" y se pide el
    // archivo. Si no lo entrega, la misma pregunta pasa en el lugar a "Elegir el archivo", con el porqué.
    if (can === null) {
      let picking = false; let busy = false;
      return D.confirm({ title, path, ok: T('Abrir'), act: async (d) => {
        if (picking) { pickNow(d); return; }
        if (busy) return;
        busy = true;
        const r = await LMD.bridge.readFile(url);
        busy = false;
        if (r && r.ok && r.opened && typeof r.text === 'string') { LMD.bridge.keep(url, r.text); d.close(true); await show(); return; }
        const why = r && r.ok ? r.why : ''; picking = true;
        d.turn({ ok: T('Elegir el archivo'), text: r && !r.ok && r.error === 'refused' ? T('Esta versión de la extensión no abre archivos por enlace. Elegí el archivo.')
          : why === 'refused' ? T('Por enlace, la extensión solo abre lo que está en carpetas que ya abriste con ella. Elegí el archivo.')
          : why === 'access' ? T('A la extensión le falta el permiso para archivos del disco') + '. ' + T('Prendelo en los ajustes de la extensión, o elegí el archivo.')
          : why === 'missing' ? T('No se encontró el archivo') + '. ' + T('Puede que se haya movido o que tenga otro nombre.')
          : T('La extensión no lo pudo abrir.') + ' ' + T('Actualizala o elegí el archivo a mano.') });
        d.note(HOW);
      } });
    }
    if (!can) return because('refused');
    if (!(await D.confirm({ title, path, ok: T('Abrir') }))) return false;
    if (inReader) {
      const r = await LMD.bridge.openFile(url);
      if (r && r.ok && r.opened) return true;
      return because(r && r.ok ? r.why : '');
    }
    // En la app web: el texto llega por el puente y se muestra acá adentro. Si falla, content.js vuelve acá con el porqué.
    return show();
  }
  // No se pudo abrir un archivo del disco (un enlace de una nota, o una dirección recargada): se ofrece elegirlo.
  async function offerFile(url, ctx, why) {
    if (asking) return false;
    asking = true;
    try { return await askOpen(url, ctx, why || 'failed'); } finally { asking = false; }
  }

  LMD.install = { init, pane, openLaunched, takeShared, expect, shareOut, canShareOut, openLink, offer: offerFile, EXTENSION_URL, ANDROID_URL };
})();
