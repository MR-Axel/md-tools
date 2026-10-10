# Extensión de Chrome y app de Android

SharpMD es la misma app en tres lugares.

| Dónde | Qué suma |
|---|---|
| La web | No se instala nada. Abre sin conexión después de la primera visita |
| La extensión de Chrome | Abre los `.md` de tu disco con doble clic y el Markdown que sirve cualquier sitio |
| La app de Android | La app web a pantalla completa, y recibe lo que otras apps comparten |

## La extensión

Está en la Chrome Web Store. Anda igual en Edge, Brave y Arc.

Chrome la instala con el permiso para abrir archivos del disco apagado, y una extensión no puede prenderlo sola. Al instalarla se abre una página con el botón que lleva a los detalles de la extensión: ahí prendés "Permitir acceso a URL de archivo" una vez. Sin ese permiso la extensión sigue andando con la app web, pero no abre archivos de tu disco.

Para que un doble clic abra un `.md` ya dibujado, poné a Chrome como app predeterminada para esos archivos.

### Con la web a la vez

Con la extensión instalada, la app web y la extensión comparten las notas del navegador y la lista de archivos y carpetas abiertos. El botón de la extensión abre la app web, o la página propia de la extensión cuando no hay conexión. Se elige en **Ajustes** > **Instalar**.

## Instalarla como app

Desde **Ajustes** > **Instalar** la app web se instala con su propia ventana. La misma pestaña trae los pasos para iPhone, iPad y Mac.

> [!TIP]
> En iPhone y iPad se instala desde Safari: Compartir, y después Agregar a inicio.

## Android

La app de Android abre `sharpmd.app` a pantalla completa, con las mismas notas, la misma cuenta y la misma copia sin conexión. Es siempre la versión actual del sitio.

Otras apps le pueden mandar cosas con Compartir:

- Un archivo de Markdown, de texto, JSON o YAML se abre como un documento sin guardar.
- Un texto o un enlace empieza una nota nueva.

También figura en "Abrir con" para esos tipos de archivo.

Sigue en [Atajos de teclado](shortcuts.md).
