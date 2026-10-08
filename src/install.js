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
  const EXTENSION_URL = 'https://github.com/MR-Axel/sharpmd#install';
  const ANDROID_URL = '';
  const HELP_URL = new URL('../?site#faq', LMD.WEB_APP_URL).href;

  // ---------- Instalar la app ----------
  // Chrome avisa cuando la app se puede instalar; el aviso se guarda para dispararlo desde el botón de Ajustes.
  let offer = null; let repaint = null;
  const standalone = () => navigator.standalone === true || ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => window.matchMedia && window.matchMedia('(display-mode: ' + m + ')').matches);
  const IOS = LMD.device.ios; const MAC = LMD.device.mac;
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

  // ---------- "Abrir con": el archivo que manda el sistema ----------
  // Llega con su permiso: se abre, se guarda en su lugar y queda en la lista de abiertos, como uno elegido a mano.
  async function openLaunched(params, homeCtx) {
    const handle = params && params.files && params.files[0];
    if (!handle || handle.kind !== 'file') return false;
    try { await LMD.home.adopt(homeCtx(), handle); return true; }
    catch (e) { homeCtx().say(T('No se pudo abrir. Probá de nuevo.')); return false; }
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

  function init(core, homeCtx) {
    if (!APP) return;
    offlineChip();
    keep(core);
    if (WEB && window.launchQueue && window.launchQueue.setConsumer) window.launchQueue.setConsumer((params) => { openLaunched(params, homeCtx); });
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
    if (desktop) {
      html += head('Extensión de Chrome') + (ext
        ? line(esc(T('Instalada, versión {v}', { v: version })))
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
    else html += line(gives + ' ' + esc(T('Desde el menú del navegador: Instalar SharpMD. En iPhone: Compartir, Agregar a inicio.')));
    if (desktop) {
      html += head('Abrir los .md con doble clic') +
        '<ol class="lmd-inst-steps"><li>' + esc(T(MAC ? 'En Finder: clic derecho en un .md, Obtener información, Abrir con, Chrome, Cambiar todo.' : 'Clic derecho en un .md, Abrir con, Elegir otra aplicación, Chrome, Siempre.')) + '</li>' +
        '<li>' + esc(T(fileAccess === true ? 'El acceso a archivos ya está activado.' : 'En los detalles de la extensión, activá "Permitir acceso a URL de archivo".')) + '</li></ol>' +
        '<div class="lmd-inst-links">' + (OWN && fileAccess !== true ? '<button type="button" class="lmd-btn" data-inst="details">' + esc(T('Detalles de la extensión')) + '</button>' : '') + out(HELP_URL, 'Ayuda', 'lmd-link') + '</div>';
    }
    if (ANDROID_URL) html += head('App de Android') + line(esc(T('La misma app en el teléfono, con tus notas de la nube.')), out(ANDROID_URL, 'Conseguir la app'));
    box.innerHTML = html;

    box.querySelectorAll('input[name=lmd-open-in]').forEach((input) => input.addEventListener('change', () => { if (input.checked) LMD.patch({ openIn: input.value }); }));
    const install = box.querySelector('[data-inst=app]');
    if (install) install.addEventListener('click', async () => {
      const e = offer; if (!e) return;
      offer = null;
      try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome === 'accepted') markInstalled(true); } catch (err) { /* el navegador no lo mostró */ }
      pane(box);
    });
    const details = box.querySelector('[data-inst=details]');
    if (details) details.addEventListener('click', () => { try { chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }); } catch (e) { /* sin extensión */ } });
  }

  // ---------- Un enlace https que abre un archivo del disco ----------
  // app.html#open=<la dirección file:// codificada, o la ruta del sistema>. Un enlace lo puede mandar cualquiera: nunca
  // se abre sin el clic de quien mira, y la ruta se muestra siempre como texto. Con la extensión, la pestaña pasa al
  // archivo y lo muestra el lector de siempre; sin ella, queda la ruta para copiar y el selector de archivos.
  let asking = false;
  async function openLink(frag, ctx) {
    if (asking) return false;
    asking = true;
    try { return await askOpen(frag, ctx); } finally { asking = false; }
  }
  async function askOpen(frag, ctx) {
    const D = LMD.dialog; const title = T('¿Abrir este archivo de tu disco?');
    let given = String(frag || '');
    try { given = decodeURIComponent(given); } catch (e) { /* un % suelto: vale como está */ }
    const url = LMD.fileUrl(given);
    if (!url) { await D.confirm({ title: T('Este enlace no se puede abrir'), text: T('Solo se abren archivos Markdown del disco.'), ok: T('Cerrar'), cancel: false }); return false; }
    const path = LMD.filePath(url);
    const byHand = () => LMD.home.pick(ctx, 'file');
    const without = async (text) => {
      if (await D.confirm({ title, text, path, ok: T('Abrir archivo…'), link: { href: EXTENSION_URL, text: T('Conseguir la extensión') } })) byHand();
      return false;
    };
    await LMD.bridge.settle(); // el puente con la extensión se presenta al cargar: se espera a saber si está
    if (!LMD.bridge.canOpen()) return without(T('Para abrir archivos del disco desde un enlace hace falta la extensión de Chrome.'));
    if (!(await D.confirm({ title, path, ok: T('Abrir') }))) return false;
    const r = await LMD.bridge.openFile(url);
    if (r && r.ok && r.opened) return true;
    const why = r && r.ok ? r.why : '';
    if (why === 'access') {
      if (await D.confirm({ title: T('Falta el acceso a archivos'), text: T('En los detalles de la extensión, activá "Permitir acceso a URL de archivo".') + ' ' + T('Después volvé a abrir el enlace.'), path, ok: T('Detalles de la extensión'), cancel: T('Cerrar') })) LMD.bridge.setup();
      return false;
    }
    if (why === 'missing') {
      if (await D.confirm({ title: T('No se encontró el archivo'), text: T('Puede que se haya movido o que tenga otro nombre.'), path, ok: T('Abrir archivo…'), cancel: T('Cerrar') })) byHand();
      return false;
    }
    return without(T('La extensión no lo pudo abrir. Actualizala o elegí el archivo a mano.'));
  }

  LMD.install = { init, pane, openLaunched, openLink, EXTENSION_URL, ANDROID_URL };
})();
