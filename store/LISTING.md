# Chrome Web Store: ficha de Sharpmd

Todo lo que pide el panel de desarrollador, listo para copiar. El paquete se arma con:

```
git archive --format=zip -o dist/sharpmd.zip HEAD
```

Ese ZIP deja afuera las pruebas, las capturas, la página de presentación y este archivo (ver `.gitattributes`).

## Datos básicos

| Campo | Valor |
|---|---|
| Nombre | Sharpmd: Markdown reader & editor |
| Categoría | Productivity → Tools (Herramientas) |
| Idioma principal | English |
| Sitio web | https://mr-axel.github.io/sharpmd/ |
| Política de privacidad | https://mr-axel.github.io/sharpmd/privacy.html |
| Soporte | https://github.com/MR-Axel/sharpmd/issues |

## Descripción corta (máximo 132 caracteres)

El panel la toma del manifest, que ya la tiene en inglés y en español:

- EN: Read and edit Markdown in the browser: outline, folder tree, search, diagrams, math and in-place editing.
- ES: Leé y editá Markdown en el navegador: índice, carpeta, búsqueda, diagramas, matemática y edición en el lugar.

## Descripción larga (English)

```
Sharpmd opens Markdown files in the browser and lets you edit them on the formatted text.

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
• Focus mode and typewriter mode
• Save with Ctrl+S, or turn on auto-save

FILES
• Create, rename and delete files from the tree
• Paste an image and it is saved next to the document
• Code and config files open highlighted, CSV opens as a table
• Export to a single HTML file, or to PDF through print

PRIVATE BY DESIGN
Files are read in your browser and never uploaded. There is no account, no analytics and no server.

Free and open source (MIT): https://github.com/MR-Axel/sharpmd

After installing, open the extension details and turn on "Allow access to file URLs" so it can open local files.
```

## Descripción larga (Español)

```
Sharpmd abre archivos Markdown en el navegador y te deja editarlos sobre el texto ya formateado.

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
• Modo foco y máquina de escribir
• Guardás con Ctrl+S, o activás el guardado automático

ARCHIVOS
• Creás, renombrás y eliminás archivos desde el árbol
• Pegás una imagen y queda guardada al lado del documento
• El código y los archivos de configuración se ven resaltados, y los CSV como tabla
• Exporta a un solo archivo HTML, o a PDF desde imprimir

PRIVACIDAD
Los archivos se leen en tu navegador y nunca se suben. No hay cuenta, analítica ni servidor.

Gratis y de código abierto (MIT): https://github.com/MR-Axel/sharpmd

Después de instalarla, abrí los detalles de la extensión y activá "Permitir acceso a URL de archivo" para que pueda abrir archivos locales.
```

## Imágenes

Capturas de 1280x800, en `docs/store/` (se regeneran con `node tests/shots.mjs`):

1. `1-reader.png`: documento con índice
2. `2-editing.png`: celda de tabla en edición
3. `3-blocks.png`: menú de bloques
4. `4-diagram.png`: editor de diagramas
5. `6-search.png`: búsqueda en la carpeta

Ícono de 128x128: `icons/icon128.png`. El mosaico promocional chico (440x280) es opcional y no está hecho.

## Pestaña de privacidad

**Propósito único**

```
Sharpmd renders Markdown files in the browser and lets the user edit and save them.
```

**Justificación de permisos**

| Permiso | Texto |
|---|---|
| storage | Stores the user's settings (theme, layout, language) and reading positions locally in the browser. |
| scripting | Injects the bundled KaTeX, Mermaid and Graphviz libraries into the Markdown page only when the document contains math or diagrams, so they are not loaded on every file. No remote code is used. |
| Host permission (file:///* and all sites) | The extension renders Markdown files wherever they live: local files and .md files served by any website. Its content script only matches URLs that end in a Markdown extension (.md, .markdown, .mdx, .mkd, .mdown). It also reads sibling files of the open document to show the folder tree and to search across them. |

**¿Usa código remoto?** No. Todas las librerías van dentro del paquete.

**Uso de datos:** no marcar ninguna categoría. Tildar las tres declaraciones: no se venden datos, no se usan para fines ajenos al propósito, no se usan para determinar solvencia.

## Lo que hay que saber antes de enviar

- El permiso sobre todos los sitios hace que la revisión sea más lenta (días, a veces un par de semanas). La justificación de arriba es la que corresponde.
- En la versión de la tienda el aviso de actualización propio queda apagado solo, porque Chrome la actualiza.
- La cuenta de desarrollador y el envío los hace el dueño de la cuenta: subir el ZIP, pegar estos textos, cargar las capturas y enviar a revisión.
