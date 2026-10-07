# SharpMD

[English](README.md) · Español

![SharpMD](docs/store/1-reader.png)

![Editando una celda de la tabla en el lugar](docs/store/2-editing.png)

**Probala sin instalar nada: [sharpmd.app](https://sharpmd.app/)**

Extensión de Chrome para leer y editar archivos Markdown en el navegador, locales (`file://`) o servidos por web. Sin cuentas, sin planes pagos y sin mandar datos a ningún lado: todo corre en la máquina.

## Qué hace

- **Edición en el lugar**: pasás a modo Edición y hacés clic en cualquier párrafo, título, ítem o celda para cambiarlo. Negrita, cursiva, tachado, código y enlaces desde una barrita o con los atajos de siempre; agregar y quitar filas y columnas; tildar tareas. El Markdown se reescribe por detrás, sin que veas la sintaxis. Se guarda con Ctrl+S, o con guardado automático.
- **Escribir contenido nuevo**: Enter cierra un bloque y abre el siguiente, o agrega un ítem a la lista. Una línea que empieza con `#`, `-`, `1.`, `>` o `[]` se convierte en título, lista, cita o tarea mientras escribís. El clic derecho (o el botón +, o `/` en una línea vacía) inserta párrafo, título, lista, tabla, bloque de código, diagrama, fórmula, aviso, imagen o separador, y convierte, mueve, duplica o elimina el bloque donde hiciste clic. Ctrl+Z deshace las operaciones de bloques y Ctrl+Y las rehace. Shift + clic derecho deja el menú del navegador, para la ortografía.
- **Tableros**: un bloque `kanban` convierte los títulos en columnas y las tareas en tarjetas. Arrastrás tarjetas entre columnas, las tildás, agregás y renombrás. En cualquier otro programa se lee como una lista de tareas común.
- **Listas de tareas** que se tildan también leyendo; las hechas quedan tachadas.
- **Totales en tablas**: el botón Σ agrega una fila que suma cada columna con números. Una celda con `=sum`, `=avg`, `=min`, `=max`, `=count` o `=median` muestra el resultado de su columna, con la misma moneda y el mismo formato de decimales que los números de arriba.
- **Notas en la nube**, opcionales: entrás con un código que llega a tu correo, mandás una nota a la nube y la abrís en cualquier dispositivo, también sin conexión. Se comparten con otra cuenta o con un enlace público de solo lectura.
- **Carpetas con contraseña**: una carpeta de la nube puede llevar contraseña. Sus notas se cifran en el navegador y el servidor no puede leerlas. La desbloqueás para tu IA por el tiempo que elijas.
- **Sesiones en vivo**: abrís una sesión sobre una nota de la nube y mandás el enlace. Quien lo tiene entra desde el navegador con un nombre, sin cuenta, y editan todos a la vez.
- **IA por MCP**: Claude o cualquier cliente MCP puede listar, leer, escribir, agregar y buscar en tus notas de la nube. Un token puede quedar limitado a una carpeta, y un comentario sobre un bloque le dice a la IA qué cambiar.
- **Plantillas y enlaces**: 26 plantillas para arrancar una nota, y Ctrl+K para enlazar a una sección o a otro archivo eligiendo de una lista.
- **Editor de fórmulas** con vista previa en vivo, y editor de diagramas con piezas, paletas de colores y errores explicados.
- **En el celular**: la misma app en pantalla chica, y la app web abre sin conexión.
- **Emojis**: escribís `:` y elegís de la lista.
- **Notas en el navegador**: Nuevo arranca una nota que se guarda sola en el navegador, sin carpeta ni cuenta, y sigue ahí cuando volvés. Ctrl+S la convierte en archivo.
- **Editor de diagramas**: en modo Editar, un clic sobre un diagrama Mermaid o Graphviz lo abre con el código a un lado y la vista previa en vivo al otro. Nueve plantillas de Mermaid para arrancar (flujo, secuencia, estados, clases, datos, Gantt, torta, mapa mental, línea de tiempo); un error de sintaxis se muestra debajo del último dibujo que salió bien. Al pasar el mouse por un diagrama: copiar el código, bajar el SVG y ampliarlo.
- **Buscar y reemplazar** en el documento mientras editás, de a una coincidencia o todas.
- **Modo foco y máquina de escribir** (Ajustes → Edición): atenúa todo menos el bloque que estás escribiendo, y mantiene el renglón actual a media altura.
- **Exportar a HTML**: un solo archivo, con la matemática en MathML.
- **Archivos desde el árbol** (página de SharpMD): archivo nuevo, renombrar y eliminar con clic derecho.
- **Pegar imágenes** (página de SharpMD): una imagen del portapapeles se guarda en `assets/`, al lado del documento, y queda insertada.
- **No solo Markdown** (página de SharpMD): los archivos de código y configuración se ven resaltados y se editan como texto, los CSV y TSV se ven como tabla, y las imágenes como imágenes.
- **Índice automático** del documento, con la sección actual resaltada mientras se hace scroll.
- **Árbol de carpetas**: los archivos Markdown de la carpeta del documento, con subcarpetas que se abren y botón para subir de nivel.
- **Recarga automática** cuando el archivo cambia en disco, sin perder la posición.
- **Tema** claro, oscuro o automático. Los colores de acento, la tipografía y el CSS propio son extras de agradecimiento para quienes apoyan el proyecto, y se liberan a palabra: no hay verificación. Todo lo que hace el lector y el editor es gratis.
- **Contenido centrado**, con **ancho**, **tamaño de letra**, **interlineado** y **tipografía** a medida. Las líneas largas del código bajan de renglón, con un ajuste para dejarlas con scroll.
- **CSS propio** encima del tema.
- **Plugins de Markdown**, cada uno con su interruptor: resaltado de código, emoji, subíndice y superíndice, insertado, marcado, abreviaturas, listas de definición, notas al pie, listas de tareas, alertas estilo GitHub, índice en el texto (`[[toc]]`), matemática con KaTeX, diagramas con Mermaid y Graphviz, tablas con celdas combinadas, bloques `::: tip` y la cabecera YAML mostrada como ficha.
- **Español e inglés**: toma el idioma del navegador (español, o inglés para cualquier otro) y se cambia desde Ajustes.
- **Búsqueda siempre a la vista, con dos alcances**: con la pestaña Índice busca en el documento abierto; con la pestaña Carpeta busca el texto en todos los Markdown de la carpeta y sus subcarpetas.
- **Links `[[nombre]]`** que abren el archivo de la carpeta con ese nombre.
- **Posición de lectura** recordada por archivo.
- **Contador** de palabras del documento y de palabras y caracteres de lo seleccionado.
- Barra de íconos arriba: cambiar entre documento y código fuente, copiar el Markdown, copiar con formato, recargar, imprimir o guardar PDF, y ajustes.
- Botón de copiar en los bloques de código y visor de imágenes.

## Instalación

1. Abrir `chrome://extensions`.
2. Activar **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** y elegir esta carpeta .
4. En la tarjeta de SharpMD, entrar a **Detalles** y activar **Permitir acceso a URL de archivo**. Sin eso no abre archivos locales.
5. Si hay otra extensión de Markdown instalada, desactivarla para que no actúen las dos sobre el mismo archivo.

Después alcanza con arrastrar un `.md` al navegador.

## Abrir archivos desde SharpMD

Hacé clic en el ícono de la extensión y elegí **Nuevo** o **Abrir**. **Nuevo** arranca una nota vacía lista para escribir; el primer Ctrl+S pregunta dónde guardarla. **Abrir** lleva a la página de SharpMD, donde elegís un archivo o una carpeta (o los arrastrás) y los leés y editás ahí mismo. Como la carpeta ya la elegiste vos, guardar no pide ningún permiso más, y la página recuerda lo último que abriste.

Abrir un `.md` directo en el navegador sigue funcionando igual que antes. La pestaña Carpeta de la barra lateral tiene un botón que lleva a esta página.

## Sin instalar nada

La página de SharpMD es HTML y JavaScript, así que también funciona servida desde cualquier hosting estático, sin la extensión. En Chrome, Edge, Brave y otros navegadores Chromium abre archivos y carpetas y guarda en el lugar. En Firefox y Safari, que no dejan que una página escriba en el disco, abre de a un archivo y al guardar descarga una copia. En los dos casos no se sube nada: los archivos se leen en tu navegador.

Está publicada en [sharpmd.app](https://sharpmd.app/). Para correr tu propia copia, serví esta carpeta (`npx serve .`) y abrí la dirección que te muestra.

La app de Android es esta misma web empaquetada (Trusted Web Activity): abre `sharpmd.app` a pantalla completa, con las mismas notas y la misma cuenta. `.well-known/assetlinks.json` lleva la huella de la llave que firma la app.

## Actualizar

Chrome no puede actualizar una extensión cargada desde una carpeta, así que SharpMD mira este repositorio una vez por día (o por semana, o nunca: Ajustes → Actualizaciones) y avisa en la barra lateral, y en el popup del ícono de la extensión, cuando hay una versión más nueva. Desde ahí: descargás el ZIP, reemplazás la carpeta de la extensión con su contenido y tocás **Aplicar**, que recarga la extensión. Si clonaste el repositorio, alcanza con `git pull` y **Aplicar**.

Es el único pedido de red que hace la extensión: lee el número de versión publicado y no manda ningún dato.

## Atajos

| Atajo | Acción |
|---|---|
| Alt+Shift+B | Mostrar u ocultar la barra lateral |
| Alt+Shift+C | Centrar o no el contenido |
| Alt+Shift+R | Activar o desactivar la recarga automática |
| Alt+Shift+T | Cambiar el tema |
| Ctrl+Shift+F | Buscar en el documento |

Se cambian en `chrome://extensions/shortcuts`.

## Estructura

```
manifest.json
_locales/         nombre, descripción y atajos de la extensión (en, es)
src/
  defaults.js     ajustes por defecto, acceso al storage y el diccionario español/inglés
  kit.js          íconos y utilidades compartidas
  markdown.js     el parser con sus plugins: links [[wiki]], matemática, cabecera YAML
  theme.js        tema claro u oscuro y color de acento
  serialize.js    del bloque editado al Markdown
  store.js        permisos de archivos y carpetas, guardados en IndexedDB
  home.js         pantalla de inicio de la página propia
  write.js        bloques nuevos, atajos de Markdown y menú de clic derecho
  diagram.js      editor de diagramas con vista previa en vivo
  board.js        tableros kanban y cuentas en tablas
  extras.js       archivos desde el árbol, imágenes pegadas, reemplazar, máquina de escribir, exportar a HTML
  content.js      el lector: interfaz, índice, árbol, búsqueda, edición, guardado, ajustes
  content.css     estilos y temas
  background.js   lectura de archivos y carpetas, carga diferida de las librerías pesadas, atajos, aviso de versión
  web.js          reemplaza las APIs de la extensión cuando la página se sirve desde un sitio
  storeapp.js     avisa si la página corre dentro de la app de Android
  app.html        la página de SharpMD: abrir un archivo o una carpeta y editar ahí
  popup.html/js   el encendido y el botón que abre la página de SharpMD
vendor/           librerías de terceros, sin modificar
examples/         documentos de prueba con todas las funciones
tests/            prueba de punta a punta
```

No hay paso de build: se edita y se recarga la extensión.

## Pruebas

```
cd tests
npm install
npm test
```

Carga la extensión en un Chromium y recorre los dos modos: el `.md` abierto directo en el navegador y la página propia con una carpeta. Necesita un Chromium de Playwright (`npx playwright install chromium`) o la variable `CHROME_BIN` apuntando a otro.

## Librerías de terceros

Todas van copiadas en `vendor/`, porque Manifest V3 no permite cargar código remoto.

| Librería | Licencia |
|---|---|
| markdown-it y sus plugins (emoji, sub, sup, ins, mark, abbr, deflist, footnote, multimd-table, container) | MIT |
| highlight.js | BSD-3-Clause |
| KaTeX | MIT |
| Mermaid | MIT |
| Viz.js (Graphviz) | MIT |
| DOMPurify | MPL-2.0 o Apache-2.0 |
| Inter (tipografía) | OFL-1.1 |

El HTML que sale del Markdown pasa por DOMPurify antes de entrar a la página.

## Notas en la nube y servidor de sincronización

En `server/` está SharpMD Sync: cuentas, notas en la nube y un servidor MCP para que una IA las lea y las escriba. Entrás desde la pantalla de inicio con un código que llega a tu correo. El plan gratis guarda 10 notas en la nube; el pago (USD 3,99 por mes o USD 39 por año) no tiene límite y suma compartir, la conexión MCP, 30 días de historial y las opciones de apariencia. El plan de equipo (USD 7,98 por mes para 2 personas, USD 3 por mes por cada una más) le da a cada miembro el plan pago y un espacio compartido para las notas del equipo: quien paga invita por correo y administra los lugares.

El servidor es un solo archivo, sin dependencias, y lo podés alojar vos: cargás su dirección en Ajustes → Cuenta, o escribís `off` ahí para usar SharpMD sin nada de nube. El detalle está en [server/README.md](server/README.md).

La app es MIT. El servidor de `server/` es AGPL-3.0 o posterior.

## Apoyar

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/surlabs)

El editor es gratis y no tiene analítica. Si te ahorra tiempo, podés [bancar la próxima herramienta en Ko-fi](https://ko-fi.com/surlabs).
