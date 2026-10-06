// Ajustes por defecto, compartidos entre el script de contenido, el popup y el service worker.
(function (root) {
  const DEFAULTS = {
    enabled: true,
    language: 'auto', // auto (según el navegador) | es | en
    theme: 'auto', // auto | light | dark
    accent: '', // vacío = color del tema; si no, un hex (#rrggbb)
    supporter: false, // la persona dijo que aportó; no se verifica
    centered: true,
    contentWidth: 1040, // px
    fontSize: 16, // px
    fontFamily: '', // vacío = tipografía del sistema
    lineHeight: 1.65,
    autoRefresh: true,
    rememberPosition: true,
    updateCheck: 'daily', // daily | weekly | off: cada cuánto mira si hay versión nueva en GitHub
    wrapCode: true, // las líneas largas de los bloques de código bajan de renglón
    autosave: false,
    autosaveDelay: 2000, // ms después del último cambio
    refreshInterval: 1000, // ms
    sidebarHidden: false,
    sidebarTab: 'outline', // outline | files
    sidebarWidth: 300,
    filesOnlyMarkdown: true,
    filesShowHidden: false,
    customCSS: '',
    plugins: {
      highlight: true,
      emoji: true,
      sub: true,
      sup: true,
      ins: true,
      mark: true,
      abbr: true,
      deflist: true,
      footnote: true,
      tasklists: true,
      alerts: true,
      toc: true,
      katex: true,
      mermaid: true,
      graphviz: true,
      tables: true,
      containers: true,
      frontmatter: true,
      wikilinks: true,
      anchors: true,
      copyCode: true,
      imageViewer: true,
      html: true,
      linkify: true,
      typographer: true,
      breaks: false,
    },
  };

  const PLUGIN_LABELS = {
    highlight: 'Resaltado de código',
    emoji: 'Emoji (:smile:)',
    sub: 'Subíndice (H~2~O)',
    sup: 'Superíndice (x^2^)',
    ins: 'Insertado (++texto++)',
    mark: 'Marcado (==texto==)',
    abbr: 'Abreviaturas',
    deflist: 'Listas de definición',
    footnote: 'Notas al pie',
    tasklists: 'Listas de tareas',
    alerts: 'Alertas ([!NOTE], [!WARNING])',
    toc: 'Índice en el texto ([[toc]])',
    katex: 'Matemática (KaTeX)',
    mermaid: 'Diagramas (Mermaid)',
    graphviz: 'Diagramas (Graphviz, bloque dot)',
    tables: 'Tablas extendidas (celdas combinadas)',
    containers: 'Bloques ::: tip, warning, details',
    frontmatter: 'Cabecera YAML como ficha',
    wikilinks: 'Links [[nombre]] entre archivos',
    anchors: 'Ancla en los títulos',
    copyCode: 'Botón de copiar en bloques de código',
    imageViewer: 'Ampliar imágenes al hacer clic',
    html: 'Permitir HTML en el documento',
    linkify: 'Convertir URLs sueltas en links',
    typographer: 'Tipografía (comillas y guiones)',
    breaks: 'Salto de línea simple = <br>',
  };

  function merge(saved) {
    const out = Object.assign({}, DEFAULTS, saved || {});
    out.plugins = Object.assign({}, DEFAULTS.plugins, (saved && saved.plugins) || {});
    return out;
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get('settings', (r) => resolve(merge(r && r.settings)));
    });
  }

  function save(settings) {
    return new Promise((resolve) => chrome.storage.local.set({ settings }, resolve));
  }

  // Los cambios se encolan: dos patch seguidos no se pisan entre sí.
  let queue = Promise.resolve();
  function patch(partial) {
    queue = queue.then(async () => {
      const cur = await load();
      const next = Object.assign({}, cur, partial);
      if (partial.plugins) next.plugins = Object.assign({}, cur.plugins, partial.plugins);
      await save(next);
      return next;
    });
    return queue;
  }

  const ACCENTS = [
    { name: 'Del tema', value: '' },
    { name: 'Azul', value: '#3b82f6' },
    { name: 'Índigo', value: '#6c7ee1' },
    { name: 'Violeta', value: '#a855f7' },
    { name: 'Rosa', value: '#ec4899' },
    { name: 'Rojo', value: '#ef4444' },
    { name: 'Naranja', value: '#f97316' },
    { name: 'Ámbar', value: '#eab308' },
    { name: 'Turquesa', value: '#14b8a6' },
  ];

  // Idioma. Las claves son el texto en español; EN tiene la traducción. Sin traducción, queda el español.
  const EN = {
      "Carpeta": "Folder",
      "Índice": "Outline",
      "Arrastrar para cambiar el ancho": "Drag to resize",
      "Barra lateral (Alt+Shift+B)": "Sidebar (Alt+Shift+B)",
      "Palabras y caracteres": "Words and characters",
      "Vista": "View",
      "Ver documento": "View document",
      "Ver código fuente": "View source",
      "Copiar Markdown": "Copy Markdown",
      "Copiar con formato (la selección, o todo el documento)": "Copy with formatting (the selection, or the whole document)",
      "Recargar ahora": "Reload now",
      "Imprimir o guardar PDF": "Print or save as PDF",
      "Ajustes": "Settings",
      "Volver arriba": "Back to top",
      "Copiar": "Copy",
      "Enlace a esta sección": "Link to this section",
      "No hay un archivo con ese nombre en la carpeta": "No file with that name in this folder",
      "Copiado con formato": "Copied with formatting",
      "Selección: {w} palabra · {c} caracteres": "Selection: {w} word · {c} characters",
      "Selección: {w} palabras · {c} caracteres": "Selection: {w} words · {c} characters",
      "{w} palabras": "{w} words",
      "Buscar en todos los archivos de la carpeta": "Search all files in this folder",
      "Buscar en este documento": "Search this document",
      "Recarga automática activa": "Auto-reload on",
      "Este documento no tiene títulos.": "This document has no headings.",
      "{w} palabras · {m} min · {n} sección": "{w} words · {m} min · {n} section",
      "{w} palabras · {m} min · {n} secciones": "{w} words · {m} min · {n} sections",
      "Avance de lectura": "Reading progress",
      "Plegar o desplegar": "Collapse or expand",
      "No se pudo releer el archivo": "Could not re-read the file",
      "Documento actualizado": "Document updated",
      "Sin cambios": "No changes",
      "Subir a la carpeta superior": "Go up one folder",
      "Leyendo carpeta…": "Reading folder…",
      "No se pudo leer la carpeta. Activá \"Permitir acceso a URL de archivo\" en los detalles de la extensión.": "Could not read the folder. Turn on \"Allow access to file URLs\" in the extension details.",
      "Este servidor no expone el listado de la carpeta.": "This server does not expose the folder listing.",
      "Carpeta sin archivos Markdown.": "No Markdown files in this folder.",
      "Buscando en la carpeta…": "Searching the folder…",
      "{t} coincidencia en {f} archivo (de {n})": "{t} match in {f} file (of {n})",
      "{t} coincidencia en {f} archivos (de {n})": "{t} match in {f} files (of {n})",
      "{t} coincidencias en {f} archivo (de {n})": "{t} matches in {f} file (of {n})",
      "{t} coincidencias en {f} archivos (de {n})": "{t} matches in {f} files (of {n})",
      "Sin coincidencias en {n} archivo": "No matches in {n} file",
      "Sin coincidencias en {n} archivos": "No matches in {n} files",
      ". Se revisaron los primeros {n}.": ". Only the first {n} were checked.",
      "Línea {n}": "Line {n}",
      "y más en este archivo": "and more in this file",
      "Cerrar": "Close",
      "Apariencia": "Appearance",
      "Idioma": "Language",
      "Tema": "Theme",
      "Automático": "Auto",
      "Claro": "Light",
      "Oscuro": "Dark",
      "Color de acento": "Accent color",
      "Otro color": "Custom color",
      "Centrar el contenido": "Center the content",
      "Ajustar las líneas largas del código": "Wrap long lines in code blocks",
      "Ancho del contenido": "Content width",
      "Tamaño de letra": "Font size",
      "Interlineado": "Line height",
      "Tipografía": "Font",
      "Del sistema. Ej.: Georgia, serif": "System font. E.g.: Georgia, serif",
      "Documento": "Document",
      "Recargar solo cuando el archivo cambia": "Reload automatically when the file changes",
      "Revisar cada": "Check every",
      "Recordar por dónde iba en cada archivo": "Remember where I left off in each file",
      "Mostrar solo archivos Markdown": "Show Markdown files only",
      "Mostrar archivos y carpetas ocultos": "Show hidden files and folders",
      "Plugins de Markdown": "Markdown plugins",
      "CSS propio": "Custom CSS",
      "Se aplica encima del tema. El documento vive dentro de .markdown-body.": "Applied on top of the theme. The document lives inside .markdown-body.",
      "Restablecer todo": "Reset everything",
      "No se pudo releer el archivo. Recargá la pestaña con F5": "Could not re-read the file. Reload the tab with F5",
      "Invitame un café": "Buy me a coffee",
      "Los colores, la tipografía y el CSS propio son extras para quienes apoyan el proyecto. No se verifica: queda en tu palabra.": "Colors, the font and custom CSS are extras for people who support the project. Nothing is verified: it is on your word.",
      "Extra": "Extra",
      "Gracias por apoyar el proyecto.": "Thanks for supporting the project.",
      "Los colores son un extra para quienes apoyan el proyecto. No se verifica: queda en tu palabra.": "Colors are an extra for people who support the project. Nothing is verified: it is on your word.",
      "Ya aporté": "I already supported",
      "Gracias por apoyar": "Thanks for supporting",
      "Actualizaciones": "Updates",
      "Buscar versiones nuevas": "Check for new versions",
      "Por día": "Daily",
      "Por semana": "Weekly",
      "Nunca": "Never",
      "Versión instalada: {v}": "Installed version: {v}",
      "Buscar ahora": "Check now",
      "Buscando…": "Checking…",
      "Ya tenés la última versión ({v})": "You have the latest version ({v})",
      "No se pudo consultar GitHub": "Could not reach GitHub",
      "Lo único que se consulta es el número de versión publicado en GitHub. No se manda ningún dato.": "The only thing fetched is the version number published on GitHub. No data is sent.",
      "Hay una versión nueva: {v}": "New version available: {v}",
      "Tenés la {v}.": "You have {v}.",
      "Descargar": "Download",
      "Aplicar": "Apply",
      "Descargá el ZIP, reemplazá con su contenido la carpeta de la extensión y tocá Aplicar. Si la clonaste con git, alcanza con git pull y Aplicar.": "Download the ZIP, replace the extension folder with its contents and click Apply. If you cloned it with git, run git pull and click Apply.",
      "Ahora no": "Not now",
      "Permiso para guardar": "Permission to save",
      "Chrome pide que elijas dónde puede escribir MD Tools. Elegí la carpeta de este archivo una sola vez y vas a poder guardar todo lo que haya adentro, sin que vuelva a preguntar.": "Chrome asks you to choose where MD Tools may write. Pick this file's folder once and you can save everything inside it, without being asked again.",
      "Elegir la carpeta": "Choose the folder",
      "Solo este archivo": "This file only",
      "Cancelar": "Cancel",
      "Esa carpeta no contiene \"{a}\". Elegí la carpeta donde está el archivo, o una que la contenga.": "That folder does not contain \"{a}\". Choose the folder where the file is, or one that contains it.",
      "No se pudo obtener el permiso. Probá de nuevo.": "Could not get the permission. Try again.",
      "En esa carpeta hay un archivo con el mismo nombre, pero su contenido no coincide con el que tenés abierto. ¿Guardar igual sobre ese archivo?": "That folder has a file with the same name, but its content does not match the one you have open. Save over that file anyway?",
      "Ver": "View",
      "Guardar y volver a solo lectura": "Save and go back to read only",
      "Estás viendo el documento": "You are viewing the document",
      "Estás editando el documento": "You are editing the document",
      "Editar el documento": "Edit the document",
      "Editando": "Editing",
      "Estás editando. Clic para guardar y volver a solo lectura": "You are editing. Click to save and go back to read only",
      "Solo lectura. Clic para editar": "Read only. Click to edit",
      "Modo": "Mode",
      "Solo lectura": "Read only",
      "Editar": "Edit",
      "Guardar (Ctrl+S)": "Save (Ctrl+S)",
      "Guardar (Ctrl+S). Hay cambios sin guardar": "Save (Ctrl+S). There are unsaved changes",
      "Negrita (Ctrl+B)": "Bold (Ctrl+B)",
      "Cursiva (Ctrl+I)": "Italic (Ctrl+I)",
      "Tachado": "Strikethrough",
      "Código": "Code",
      "Enlace": "Link",
      "Quitar formato": "Clear formatting",
      "Fila": "Row",
      "Columna": "Column",
      "Guardá una vez con Ctrl+S para activar el guardado automático": "Save once with Ctrl+S to turn on auto-save",
      "Modo edición: hacé clic en un texto o una celda para cambiarlo": "Edit mode: click any text or cell to change it",
      "Este bloque se edita desde la vista de código": "This block is edited from the source view",
      "Esta tabla se edita desde la vista de código": "This table is edited from the source view",
      "Dirección del enlace": "Link address",
      "Sin cambios para guardar": "Nothing to save",
      "Este navegador no deja escribir el archivo: se descargó una copia": "This browser cannot write the file: a copy was downloaded",
      "Elegiste \"{a}\" y el documento abierto es \"{b}\". ¿Guardar igual sobre el archivo elegido?": "You picked \"{a}\" and the open document is \"{b}\". Save over the picked file anyway?",
      "Guardado": "Saved",
      "No se pudo guardar": "Could not save",
      "El archivo cambió en el disco. Tus cambios sin guardar se mantienen": "The file changed on disk. Your unsaved changes are kept",
      "Guardar solo mientras edito": "Auto-save while I edit",
      "Guardar a los": "Save after",
      "MD Tools es gratis y no junta datos. Si te sirve, podés apoyarlo.": "MD Tools is free and collects no data. If it helps you, you can support it.",
      "Apoyar el proyecto": "Support the project",
      "Lector MD es gratis y no junta datos. Si te sirve, podés apoyarlo.": "Lector MD is free and collects no data. If it helps you, you can support it.",
      "Nota": "Note",
      "Consejo": "Tip",
      "Importante": "Important",
      "Advertencia": "Warning",
      "Precaución": "Caution",
      "Información": "Info",
      "Peligro": "Danger",
      "Detalles": "Details",
      "Resaltado de código": "Code highlighting",
      "Emoji (:smile:)": "Emoji (:smile:)",
      "Subíndice (H~2~O)": "Subscript (H~2~O)",
      "Superíndice (x^2^)": "Superscript (x^2^)",
      "Insertado (++texto++)": "Inserted (++text++)",
      "Marcado (==texto==)": "Highlighted (==text==)",
      "Abreviaturas": "Abbreviations",
      "Listas de definición": "Definition lists",
      "Notas al pie": "Footnotes",
      "Listas de tareas": "Task lists",
      "Alertas ([!NOTE], [!WARNING])": "Alerts ([!NOTE], [!WARNING])",
      "Índice en el texto ([[toc]])": "Inline table of contents ([[toc]])",
      "Matemática (KaTeX)": "Math (KaTeX)",
      "Diagramas (Mermaid)": "Diagrams (Mermaid)",
      "Diagramas (Graphviz, bloque dot)": "Diagrams (Graphviz, dot block)",
      "Tablas extendidas (celdas combinadas)": "Extended tables (merged cells)",
      "Bloques ::: tip, warning, details": "Blocks ::: tip, warning, details",
      "Cabecera YAML como ficha": "YAML front matter as a card",
      "Links [[nombre]] entre archivos": "[[name]] links between files",
      "Ancla en los títulos": "Heading anchors",
      "Botón de copiar en bloques de código": "Copy button on code blocks",
      "Ampliar imágenes al hacer clic": "Click to enlarge images",
      "Permitir HTML en el documento": "Allow HTML in the document",
      "Convertir URLs sueltas en links": "Turn bare URLs into links",
      "Tipografía (comillas y guiones)": "Typography (quotes and dashes)",
      "Salto de línea simple = <br>": "Single line break = <br>",
      "Del tema": "Theme default",
      "Azul": "Blue",
      "Índigo": "Indigo",
      "Violeta": "Purple",
      "Rosa": "Pink",
      "Rojo": "Red",
      "Naranja": "Orange",
      "Ámbar": "Amber",
      "Turquesa": "Teal",
      "Activado": "Enabled",
      "Recarga automática": "Auto-reload",
      "Ocultar barra lateral": "Hide sidebar",
      "Auto": "Auto",
      "Falta un permiso para abrir archivos locales.": "A permission is missing to open local files.",
      "En los detalles de la extensión, activá \"Permitir acceso a URL de archivo\".": "In the extension details, turn on \"Allow access to file URLs\".",
      "Abrir los detalles": "Open details",
      "El resto de los ajustes (ancho, letra, plugins, CSS propio) está en el ícono de controles, arriba a la derecha del documento.": "The rest of the settings (width, font, plugins, custom CSS) are under the sliders icon, top right of the document."
  };
  let current = 'es';
  function setLang(pref) {
    if (pref === 'es' || pref === 'en') current = pref;
    else {
      let ui = '';
      try { ui = chrome.i18n.getUILanguage(); } catch (e) { ui = (typeof navigator !== 'undefined' && navigator.language) || ''; }
      current = /^es\b/i.test(ui) ? 'es' : 'en';
    }
    return current;
  }
  function t(text, vars) {
    let out = current === 'en' && Object.prototype.hasOwnProperty.call(EN, text) ? EN[text] : text;
    if (vars) for (const k in vars) out = out.split('{' + k + '}').join(vars[k]);
    return out;
  }
  const lang = () => current;

  const SPONSOR_URL = 'https://ko-fi.com/mraxel';

  root.LMD = { SPONSOR_URL, DEFAULTS, PLUGIN_LABELS, ACCENTS, merge, load, save, patch, setLang, t, lang };
})(typeof self !== 'undefined' ? self : this);
