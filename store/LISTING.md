# Chrome Web Store: ficha de SharpMD

Todo lo que pide el panel de desarrollador, listo para copiar. El paquete se arma con:

```
git archive --format=zip -o dist/sharpmd.zip HEAD
```

Ese ZIP deja afuera las pruebas, las capturas, la página de presentación y este archivo (ver `.gitattributes`).

## Lo que falta completar

En el orden del menú de la izquierda del panel. Lo que ya está cargado no figura.

| Dónde | Qué falta |
|---|---|
| **Paquete** | Subir `dist/sharpmd.zip`, que es la versión 2.35.0. Con eso el título pasa a decir "SharpMD" |
| **Ficha de Play Store** | Volver a pegar la descripción (la cargada dice "Sharpmd"). Subir las cinco capturas también en "Capturas de pantalla localizadas": el panel pide al menos una ahí. Cuáles son: [Recursos gráficos](#recursos-gráficos) |
| **Privacidad** | Toda la pestaña. Los textos y qué tildar están en [Pestaña de privacidad](#pestaña-de-privacidad) |
| **Distribución** | En Pagos, cambiar a "Contiene compras en la aplicación" |
| **Instrucciones de la prueba** | Pegar el texto de [Instrucciones de la prueba](#instrucciones-de-la-prueba) |
| **Configuración del editor** | El correo de contacto. Ver [el paso a paso](#el-correo-de-contacto-paso-a-paso) |

### El correo de contacto, paso a paso

No va en la ficha ni en "Perfil". Va en la configuración del editor:

1. Arriba a la derecha, el selector tiene que decir "Editor: SharpMD".
2. En el menú de la izquierda, sección EDITOR, entrar a **Configuración** (está debajo de "Elementos").
3. Debajo de "Nombre visible del editor" e "ID de editor" está "Añadir dirección de correo electrónico de contacto". Tocar **Añadir correo**.
4. Escribir `hello@sharpmd.app` y confirmar el correo de verificación, que llega al Gmail por el reenvío.

Sin ese correo verificado el botón "Enviar a revisión" queda gris. "¿Por qué no puedo enviar?", al lado de ese botón, lista lo que todavía falta.

## Antes de enviar

- El paquete se regenera después de cada cambio: `git archive --format=zip -o dist/sharpmd.zip HEAD`.
- El enlace al código que aparece en la descripción apunta al repo de GitHub.
- Los recibos de Paddle salen a nombre de Sur Labs, con SharpMD como producto. Está explicado en la página de ayuda.

## Qué va en cada campo del panel

El formulario tiene tres pestañas. Esta es la primera, "Ficha de Chrome Web Store", en el orden en que aparecen los campos.

### Detalles del producto

| Campo del panel | Qué cargar |
|---|---|
| Título y resumen | No se escriben: salen del `manifest.json` del ZIP |
| Descripción | El bloque [Descripción larga (English)](#descripción-larga-english). El de [español](#descripción-larga-español) va al agregar el idioma Español |
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

El panel acepta cinco capturas como máximo y hay seis hechas. La que queda afuera es `5-start.png`, la pantalla de inicio, porque es la que menos muestra del producto. Si la querés adentro, reemplaza a `6-search.png`.

Las capturas se regeneran con `node tests/shots.mjs` y los mosaicos con `node tests/promo.mjs`. Todas salen en PNG de 24 bits sin alfa, que es lo que pide el panel.

### Campos adicionales

| Campo del panel | Qué cargar |
|---|---|
| URL oficial | `sharpmd.app` (aparece en la lista porque el dominio está verificado en Search Console) |
| URL de la página principal | `https://sharpmd.app/` |
| URL de asistencia | `https://sharpmd.app/support.html` |
| Contenido para adultos | apagado |

### Las otras pestañas

| Pestaña | Qué cargar |
|---|---|
| Privacidad | Ver [Pestaña de privacidad](#pestaña-de-privacidad) |
| Distribución | Pagos: "Contiene compras en la aplicación". Visibilidad: Público. Regiones: todas |
| Instrucciones de la prueba | Ver [Instrucciones de la prueba](#instrucciones-de-la-prueba) |

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

Cada bloque es un campo del formulario, en el orden en que aparecen.

**Descripción de la finalidad única**

```
SharpMD renders Markdown files in the browser and lets the user edit and save them. Notes can optionally be synced to the user's own SharpMD account.
```

**Justificación de storage**

```
Stores the user's settings (theme, layout, language), reading positions, notes kept in the browser and the sign-in session, locally in the browser.
```

**Justificación de scripting**

```
Injects the bundled KaTeX, Mermaid and Graphviz libraries into the Markdown page only when the document contains math or diagrams, so they are not loaded on every file. No remote code is used.
```

**Justificación de Permiso de host**

```
The extension renders Markdown files wherever they live: local files and .md files served by any website. Its content script only matches URLs that end in a Markdown extension (.md, .markdown, .mdx, .mkd, .mdown). It also reads sibling files of the open document to show the folder tree and to search across them. When the user signs in, it talks to the SharpMD sync server (sync.sharpmd.app, or a server the user configures) to store the notes the user chooses to send to the cloud.
```

**¿Utilizas código remoto?**

Elegir **"No, no estoy usando código remoto"**. Todas las librerías van dentro del paquete. En el borrador quedó marcado "Sí": hay que cambiarlo, y con "No" el campo de justificación desaparece.

**Uso de datos: qué tildar**

| Casilla | ¿Se tilda? | Por qué |
|---|---|---|
| Información de identificación personal | Sí | el correo de quien crea una cuenta |
| Información sanitaria | No | |
| Datos financieros y de pagos | No | el pago se hace en la web con Paddle; la extensión no ve la tarjeta |
| Información de autenticación | Sí | el código de acceso y la sesión de la cuenta |
| Comunicaciones personales | No | |
| Ubicación | No | |
| Historial web | No | |
| Actividad del usuario | No | no hay analítica |
| Contenido del sitio web | Sí | el texto de las notas que la persona manda a la nube |

Las tres afirmaciones de abajo se tildan todas: no se venden datos, no se usan para fines ajenos a la finalidad única, no se usan para determinar solvencia.

**URL de la Política de Privacidad**

```
https://sharpmd.app/privacy.html
```

## Instrucciones de la prueba

Hay una cuenta de prueba con plan pago para quien revisa. Entra con un código fijo y no manda ningún correo.

| Campo del panel | Qué cargar |
|---|---|
| Nombre de usuario | `review@sharpmd.app` |
| Contraseña | el código de seis dígitos. No está en este repo, que es público: está en `~/.sharpmd/store-review.txt` (y en el servidor, en `TEST_LOGIN`) |

En las instrucciones adicionales, reemplazando `CODE` por ese mismo código:

```
The extension works without an account. To test it: open the extension details and turn on "Allow access to file URLs", then open any local .md file in Chrome, or click the extension icon and choose "New file".

Cloud notes are optional and sign-in has no password: the user types an email address on the start screen and receives a six-digit code by email.

For this review there is a test account on the paid plan that does not need a mailbox:
1. Click the extension icon, then "Open" to reach the start screen.
2. Click "Sign up or sign in" and type review@sharpmd.app
3. Type the code CODE (it is fixed for this account; no email is sent).
The account has two sample cloud notes. With a note open, Settings > Cloud, AI and Plan show the paid features: sharing, version history and the MCP connection.

The paid plan is bought on https://sharpmd.app through Paddle and is not required to use the extension.
```

Si el código se filtra, se cambia en el servidor (`TEST_LOGIN` en el archivo de entorno) y se actualiza acá en el panel.

## Lo que hay que saber antes de enviar

- El permiso sobre todos los sitios hace que la revisión sea más lenta (días, a veces un par de semanas). La justificación de arriba es la que corresponde.
- En la versión de la tienda el aviso de actualización propio queda apagado solo, porque Chrome la actualiza.
- La cuenta de desarrollador y el envío los hace el dueño de la cuenta: subir el ZIP, pegar estos textos, cargar las capturas y enviar a revisión.
