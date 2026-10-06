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
    focusMode: false, // al editar, atenúa todo menos el bloque en el que se escribe
    typewriter: false, // al editar, mantiene el renglón actual a media altura
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

  // Tipografías que ya vienen con el sistema, cada una con su respaldo.
  const FONTS = [
    { name: 'Del sistema', value: '' },
    { name: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { name: 'Calibri', value: 'Calibri, Candara, "Segoe UI", sans-serif' },
    { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { name: 'Trebuchet MS', value: '"Trebuchet MS", "Lucida Grande", sans-serif' },
    { name: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { name: 'Cambria', value: 'Cambria, Georgia, serif' },
    { name: 'Palatino', value: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
    { name: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { name: 'Consolas', value: 'Consolas, "Cascadia Mono", Menlo, monospace' },
    { name: 'Courier New', value: '"Courier New", Courier, monospace' },
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
      "Del sistema": "System default",
      "Lectura": "Reading",
      "Edición": "Editing",
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
      "Ya aporté": "I already supported",
      "Gracias por apoyar": "Thanks for supporting",
      "Actualizaciones": "Updates",
      "Nombre del archivo nuevo": "Name for the new file", "nota": "note", "Nombre nuevo": "New name",
      "Ese nombre tiene caracteres que no se pueden usar": "That name has characters that cannot be used",
      "Ya hay un archivo con ese nombre": "A file with that name already exists",
      "No se pudo crear el archivo": "Could not create the file", "No se pudo renombrar": "Could not rename", "No se pudo eliminar": "Could not delete",
      "¿Eliminar \"{a}\"? No se puede deshacer.": "Delete \"{a}\"? This cannot be undone.",
      "Nuevo archivo acá": "New file here", "Nuevo archivo": "New file", "Renombrar": "Rename",
      "Archivo nuevo en esta carpeta": "New file in this folder",
      "Para pegar imágenes abrí la carpeta desde la página de MD Tools": "To paste images, open the folder from the MD Tools page",
      "imagen": "image", "Imagen guardada en {a}": "Image saved to {a}", "No se pudo guardar la imagen": "Could not save the image",
      "Sin coincidencias": "No matches", "Reemplazado. Quedan {n}": "Replaced. {n} left",
      "{n} reemplazo. Ctrl+Z lo deshace": "{n} replacement. Ctrl+Z undoes it", "{n} reemplazos. Ctrl+Z los deshace": "{n} replacements. Ctrl+Z undoes them",
      "Reemplazar con": "Replace with", "Uno": "One", "Todos": "All",
      "Reemplazar la primera coincidencia": "Replace the first match", "Reemplazar todas": "Replace all",
      "HTML descargado": "HTML downloaded", "Exportar a HTML": "Export to HTML",
      "Modo foco: atenuar lo que no estoy escribiendo": "Focus mode: dim what I am not writing",
      "Máquina de escribir: mantener el renglón a media altura": "Typewriter: keep the current line at mid height",
      "Este tipo de archivo no se puede mostrar.": "This kind of file cannot be shown.",
      "Se muestran las primeras {n} filas.": "Showing the first {n} rows.",
      "Este archivo se edita desde la vista de código": "This file is edited from the source view",
      "Las imágenes no se editan acá": "Images are not edited here",
      "Editar diagrama": "Edit diagram", "Plantillas": "Templates", "Ver la sintaxis": "Syntax reference",
      "Flujo": "Flowchart", "Secuencia": "Sequence", "Estados": "States", "Clases": "Classes", "Datos": "Data", "Torta": "Pie",
      "Mapa mental": "Mind map", "Línea de tiempo": "Timeline", "¿Sirve?": "Works?", "Sí": "Yes", "Seguir": "Continue", "Corregir": "Fix",
      "Usuario": "User", "Servidor": "Server", "Pide algo": "Asks for something", "Consulta": "Query", "Respuesta": "Response", "Resultado": "Result",
      "Borrador": "Draft", "Revisión": "Review", "Publicado": "Published", "Pedido": "Order", "Cliente": "Customer", "Plan": "Plan",
      "Diseño": "Design", "Prototipo": "Prototype", "Desarrollo": "Development", "Primera versión": "First version", "Reparto": "Split",
      "Tema": "Topic", "Idea": "Idea", "Detalle": "Detail", "Historia": "History", "Lanzamiento": "Launch",
      "Copiar el código del diagrama": "Copy the diagram code", "Descargar como SVG": "Download as SVG", "Ampliar": "Enlarge",
      "Código del diagrama copiado": "Diagram code copied", "diagrama": "diagram",
      "Escribí acá, o / para insertar": "Type here, or / to insert",
      "Título 1": "Heading 1", "Título 2": "Heading 2", "Título 3": "Heading 3", "Título 4": "Heading 4",
      "Lista": "List", "Lista numerada": "Numbered list", "Tarea": "Task", "Lista de tareas": "Task list", "Cita": "Quote",
      "Ítem nuevo": "New item", "Párrafo": "Paragraph", "Tabla": "Table", "Bloque de código": "Code block",
      "Diagrama": "Diagram", "Fórmula": "Formula", "Aviso": "Callout", "Imagen": "Image", "Separador": "Divider",
      "Columna": "Column", "Inicio": "Start", "Fin": "End", "Texto del aviso": "Callout text",
      "Dirección o ruta de la imagen": "Image address or path",
      "Bloque eliminado. Ctrl+Z lo deshace": "Block deleted. Ctrl+Z brings it back",
      "Insertar debajo": "Insert below", "Insertar": "Insert", "Convertir en": "Turn into", "Este bloque": "This block",
      "Subir": "Move up", "Bajar": "Move down", "Duplicar": "Duplicate", "Eliminar": "Delete",
      "Cambio deshecho": "Change undone", "No hay más cambios para deshacer": "Nothing left to undo",
      "Seguir escribiendo": "Keep writing",
      "Insertar un bloque (también con clic derecho)": "Insert a block (right-click works too)",
      "Abrir otro archivo o carpeta": "Open another file or folder",
      "Abrí un archivo Markdown o una carpeta para leerlo y editarlo acá mismo.": "Open a Markdown file or a folder to read and edit it right here.",
      "Abrir archivo": "Open file",
      "Abrir carpeta": "Open folder",
      "También podés arrastrar un archivo o una carpeta a esta ventana.": "You can also drag a file or a folder onto this window.",
      "Recientes": "Recent",
      "También podés arrastrar un archivo a esta ventana. Este navegador no deja escribir sobre el archivo: al guardar se descarga una copia.": "You can also drag a file onto this window. This browser cannot write to the file: saving downloads a copy.",
      "Quitar de la lista": "Remove from the list",
      "Esa carpeta no tiene archivos Markdown.": "That folder has no Markdown files.",
      "Ese archivo no es Markdown.": "That file is not Markdown.",
      "No se pudo abrir. Probá de nuevo.": "Could not open it. Try again.",
      "Chrome pide que confirmes el acceso antes de seguir.": "Chrome asks you to confirm access before continuing.",
      "Continuar": "Continue",
      "Volver al inicio": "Back to start",
      "Ese acceso ya no está guardado. Abrí el archivo o la carpeta de nuevo.": "That access is no longer saved. Open the file or folder again.",
      "No se encontró \"{a}\".": "Could not find \"{a}\".",
      "Abrir un archivo o una carpeta": "Open a file or a folder",
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
      "Modo": "Mode",
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
      "Auto": "Auto",
      "Falta un permiso para abrir archivos locales.": "A permission is missing to open local files.",
      "En los detalles de la extensión, activá \"Permitir acceso a URL de archivo\".": "In the extension details, turn on \"Allow access to file URLs\".",
      "Abrir los detalles": "Open details",
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

  root.LMD = { SPONSOR_URL, DEFAULTS, PLUGIN_LABELS, ACCENTS, FONTS, merge, load, save, patch, setLang, t, lang };
})(typeof self !== 'undefined' ? self : this);
