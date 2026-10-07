# Chrome Web Store: ficha de SharpMD

Todo lo que pide el panel de desarrollador, listo para copiar. El paquete se arma con:

```
git archive --format=zip -o dist/sharpmd.zip HEAD
```

Ese ZIP deja afuera las pruebas, las capturas, la página de presentación y este archivo (ver `.gitattributes`).

## Qué va en cada campo del panel

El formulario tiene tres pestañas. Esta es la primera, "Ficha de Chrome Web Store", en el orden en que aparecen los campos.

### Detalles del producto

| Campo del panel | Qué cargar |
|---|---|
| Título y resumen | No se escriben: salen del `manifest.json` del ZIP |
| Descripción | El bloque "Descripción larga (English)" de más abajo. El de español va al agregar el idioma Español |
| Categoría | Herramientas |
| Idioma | English |

### Recursos gráficos

Todos los archivos están en `docs/store/`.

| Campo del panel | Archivo | Nota |
|---|---|---|
| Icono de Chrome Web Store | ya cargado | sale del ZIP (`icons/icon128.png`) |
| Vídeo promocional localizado | vacío | solo acepta un enlace de YouTube; el video existe pero no está subido |
| Capturas de pantalla localizadas | vacío | son para una ficha por idioma; con las globales alcanza |
| Vídeo promocional global | vacío | igual que arriba |
| **Capturas de pantalla globales** (obligatorio, hasta 5) | `1-reader.png`, `2-editing.png`, `3-blocks.png`, `4-diagram.png`, `6-search.png` | en ese orden; la primera es la que se ve en los resultados |
| Imagen en mosaico promocional pequeña (440x280) | `promo-440x280.png` | |
| Imagen en mosaico promocional con desplazamiento (1400x560) | `promo-1400x560.png` | |

`5-start.png` es la pantalla de inicio: no entra en las cinco, queda de repuesto.

Las capturas se regeneran con `node tests/shots.mjs` y los mosaicos con `node tests/promo.mjs`. Todas salen en PNG de 24 bits sin alfa, que es lo que pide el panel.

### Campos adicionales

| Campo del panel | Qué cargar |
|---|---|
| URL oficial | `sharpmd.app` (aparece en la lista porque el dominio está verificado en Search Console) |
| URL de la página principal | `https://sharpmd.app/` |
| URL de asistencia | `https://github.com/MR-Axel/sharpmd/issues` |
| Contenido para adultos | apagado |

### Las otras dos pestañas

| Pestaña | Qué cargar |
|---|---|
| Privacidad | Propósito único, justificación de cada permiso, código remoto y uso de datos: todo está en "Pestaña de privacidad", más abajo. URL de la política: `https://sharpmd.app/privacy.html` |
| Distribución | Gratis, todas las regiones, visibilidad pública |

En la cuenta del editor (no en la ficha) va el correo de contacto, `hello@sharpmd.app`, y la declaración de operador.

## Descripción corta (máximo 132 caracteres)

El panel la toma del manifest, que ya la tiene en inglés y en español:

- EN: Read and edit Markdown in the browser: outline, folder tree, search, diagrams, math and in-place editing.
- ES: Leé y editá Markdown en el navegador: índice, carpeta, búsqueda, diagramas, matemática y edición en el lugar.

## Descripción larga (English)

```
SharpMD opens Markdown files in the browser and lets you edit them on the formatted text.

Set Chrome as the default app for .md files and a double-click opens them with an outline, the folder they live in and search. Click the extension icon to start a new note or to open a file or a whole folder.

READ
• Outline built from the headings, with reading progress
• Folder tree with the files next to the document
• Search in the document, or in every file of the folder at once
• Math with KaTeX, diagrams with Mermaid and Graphviz, tables, footnotes, task lists, callouts, YAML front matter
• [[name]] links between files
• Light and dark themes

EDIT
• Click a paragraph, a heading, a list item or a table cell and type
• Type **bold** or `code` and the marks turn into formatting
• Start a line with #, - or > to get a heading, a list or a quote
• Right-click a block to insert, turn into, move, duplicate or delete
• Diagram editor with live preview and nine templates
• Find and replace, undo and redo for block operations
• Type : to pick an emoji from a list
• Focus mode and typewriter mode
• Save with Ctrl+S, or turn on auto-save

FILES
• Create, rename and delete files from the tree
• Paste an image and it is saved next to the document
• Code and config files open highlighted, CSV opens as a table
• Export to a single HTML file, or to PDF through print

CLOUD AND AI (OPTIONAL)
• Sign in with a code sent to your email and send a note to the cloud with one click
• Cloud notes open on any device, and without a connection once you have opened them
• Share a note or a folder with another account, or make a read-only public link
• Connect Claude or any MCP client so your AI can read and write your cloud notes
• Free up to 10 cloud notes. The paid plan (USD 3.99 a month or USD 39 a year) has no limit and adds sharing, the MCP connection, version history and the appearance options

PRIVATE BY DESIGN
Files are read in your browser and never uploaded. No analytics. Cloud notes are optional: a note reaches the server only when you send it there.

Free and open source (MIT): https://github.com/MR-Axel/sharpmd

After installing, open the extension details and turn on "Allow access to file URLs" so it can open local files.
```

## Descripción larga (Español)

```
SharpMD abre archivos Markdown en el navegador y te deja editarlos sobre el texto ya formateado.

Poné Chrome como programa por defecto para los .md y con doble clic se abren con el índice, la carpeta donde están y un buscador. Desde el ícono de la extensión arrancás una nota nueva o abrís un archivo o una carpeta entera.

LEER
• Índice armado con los títulos, con el avance de lectura
• Árbol de la carpeta con los archivos que están al lado del documento
• Búsqueda en el documento, o en todos los archivos de la carpeta a la vez
• Matemática con KaTeX, diagramas con Mermaid y Graphviz, tablas, notas al pie, listas de tareas, avisos y cabecera YAML
• Links [[nombre]] entre archivos
• Tema claro y oscuro

EDITAR
• Hacés clic en un párrafo, un título, un ítem o una celda y escribís
• Escribís **negrita** o `código` y los signos se vuelven formato
• Si la línea empieza con #, - o >, pasa a ser título, lista o cita
• Clic derecho sobre un bloque para insertar, convertir, mover, duplicar o eliminar
• Editor de diagramas con vista previa en vivo y nueve plantillas
• Buscar y reemplazar, deshacer y rehacer
• Escribís : y elegís un emoji de la lista
• Modo foco y máquina de escribir
• Guardás con Ctrl+S, o activás el guardado automático

ARCHIVOS
• Creás, renombrás y eliminás archivos desde el árbol
• Pegás una imagen y queda guardada al lado del documento
• El código y los archivos de configuración se ven resaltados, y los CSV como tabla
• Exporta a un solo archivo HTML, o a PDF desde imprimir

NUBE E IA (OPCIONAL)
• Entrás con un código que llega a tu correo y mandás una nota a la nube con un clic
• Las notas de la nube se abren en cualquier dispositivo, y sin conexión una vez que las abriste
• Compartís una nota o una carpeta con otra cuenta, o armás un enlace público de solo lectura
• Conectás Claude o cualquier cliente MCP para que tu IA lea y escriba tus notas de la nube
• Gratis hasta 10 notas en la nube. El plan pago (USD 3,99 por mes o USD 39 por año) no tiene límite y suma compartir, la conexión MCP, el historial de versiones y las opciones de apariencia

PRIVACIDAD
Los archivos se leen en tu navegador y nunca se suben. Sin analítica. Las notas en la nube son opcionales: una nota llega al servidor solo cuando la mandás.

Gratis y de código abierto (MIT): https://github.com/MR-Axel/sharpmd

Después de instalarla, abrí los detalles de la extensión y activá "Permitir acceso a URL de archivo" para que pueda abrir archivos locales.
```

## Pestaña de privacidad

**Propósito único**

```
SharpMD renders Markdown files in the browser and lets the user edit and save them.
```

**Justificación de permisos**

| Permiso | Texto |
|---|---|
| storage | Stores the user's settings (theme, layout, language) and reading positions locally in the browser. |
| scripting | Injects the bundled KaTeX, Mermaid and Graphviz libraries into the Markdown page only when the document contains math or diagrams, so they are not loaded on every file. No remote code is used. |
| Host permission (file:///* and all sites) | The extension renders Markdown files wherever they live: local files and .md files served by any website. Its content script only matches URLs that end in a Markdown extension (.md, .markdown, .mdx, .mkd, .mdown). It also reads sibling files of the open document to show the folder tree and to search across them. |

**¿Usa código remoto?** No. Todas las librerías van dentro del paquete.

**Uso de datos:** con la nube prendida hay que marcar dos categorías, porque quien entra con su cuenta deja su correo y las notas que manda: "Información de identificación personal" (el correo) y "Contenido del sitio web" (el texto de las notas en la nube). Sin cuenta no sale nada. Tildar las tres declaraciones: no se venden datos, no se usan para fines ajenos al propósito, no se usan para determinar solvencia.

## Lo que hay que saber antes de enviar

- El permiso sobre todos los sitios hace que la revisión sea más lenta (días, a veces un par de semanas). La justificación de arriba es la que corresponde.
- En la versión de la tienda el aviso de actualización propio queda apagado solo, porque Chrome la actualiza.
- La cuenta de desarrollador y el envío los hace el dueño de la cuenta: subir el ZIP, pegar estos textos, cargar las capturas y enviar a revisión.
