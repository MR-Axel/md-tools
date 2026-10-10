# SharpMD Local

Un programa chico que corre en tu computadora y le cuenta a [SharpMD](https://sharpmd.app) cosas
que una página web no puede ver sola:

- **Servidores**: qué puertos están escuchando, de qué proceso y de qué
  proyecto son, qué versión corren y desde cuándo. Para encontrar lo que quedó
  levantado de más y cerrarlo.
- **Worktrees**: los worktrees de los repositorios que elijas, con su rama, su
  último commit, si tienen cambios sin confirmar, cuándo se editaron por última
  vez y qué procesos están trabajando en esa carpeta.
- **Sesiones locales**: las sesiones de agentes de IA abiertas (Claude Code y los que
  configures), con su título, su proyecto y la memoria que usa cada una.
- **Mostrar en el Explorador**: abre el explorador de archivos del sistema con un
  archivo tuyo seleccionado.

Es gratis, es local y no depende de ninguna cuenta. Escucha **solo en
`127.0.0.1`**: nada sale de la máquina y nada pasa por los servidores de
SharpMD.

Read in English: [README.md](README.md).

## Qué hace y qué no

| Hace | No hace |
| --- | --- |
| Lista los puertos TCP en escucha y sus procesos | No ejecuta comandos que le lleguen de afuera |
| Lee la carpeta de trabajo de tus procesos para saber de qué proyecto son | No lee ni devuelve archivos a pedido |
| Lee nombre y versión del `package.json` del proyecto | No borra worktrees ni toca un repositorio |
| Le pide la portada a tus servidores de desarrollo para mostrar su título | No cierra nada del sistema ni programas instalados |
| Corre `git worktree list`, `git log -1` y `git status` en las carpetas que elijas | No mira ninguna carpeta que no hayas elegido |
| Lee el principio del registro de cada sesión de agente para sacar su título | No guarda historial ni manda nada a ningún lado |
| Cierra un servidor de desarrollo o una sesión de agente, si lo pedís y confirmás | No escucha en la red: solo en esta máquina |
| Abre el explorador de archivos sobre un archivo de una carpeta que sumaste | No abre el archivo ni lanza ninguna otra cosa |

## Instalar y arrancar

Hace falta [Node.js](https://nodejs.org) 22 o más nuevo. No tiene dependencias.

```
git clone https://github.com/SharpMD/sharpmd.git
cd sharpmd/local
node bin/sharpmd-local.js
```

En Windows también sirve el doble clic en `start.cmd`.

Al arrancar muestra dos cosas: el **código de emparejamiento** y la dirección de
su **panel propio**.

```
  SharpMD Local 0.1.0
  Escucha solo en esta máquina: http://127.0.0.1:7717
  Acciones de cerrar: prendidas (cada una pregunta antes).

  Código de emparejamiento (se pega una vez en SharpMD, Ajustes > Herramientas):
    7717.Qm3…

  Panel en esta máquina, para cualquier navegador:
    http://127.0.0.1:7717/#t=Qm3…
```

## Emparejar con SharpMD

1. En SharpMD: **Ajustes > Herramientas** y prender *Servidores locales*,
   *Worktrees* o *Sesiones locales*.
2. Pegar el código de emparejamiento y tocar **Emparejar**.
3. La primera vez el navegador pregunta si el sitio puede conectarse con esta
   computadora. Hay que permitirlo: sin eso la página no llega al programa.

El código queda guardado en ese navegador. Se empareja una vez por navegador,
y las tres herramientas lo comparten. Mientras está emparejado, el menú de un
archivo de tu disco ofrece además **Mostrar en el Explorador**.

### Qué navegadores

| Navegador | Desde SharpMD | Panel propio |
| --- | --- | --- |
| Chrome, Edge y otros Chromium (142 en adelante) | Sí, con el permiso "conectarse a dispositivos de la red local" | Sí |
| Firefox | Sí, con el permiso de acceso a este dispositivo | Sí |
| Safari | **No**: bloquea los pedidos de una página `https` a `http://127.0.0.1` | Sí |

En Safari, o si no querés darle ese permiso al sitio, usá el **panel propio**:
la dirección que el programa muestra al arrancar. Tiene las mismas tres
vistas y no pasa por ninguna web.

## Elegir las carpetas

Arranca sin ninguna. Se suman desde la consola:

```
node bin/sharpmd-local.js folders add C:\code\notes-app
node bin/sharpmd-local.js folders add C:\code
node bin/sharpmd-local.js folders
node bin/sharpmd-local.js folders remove C:\code
```

Una carpeta puede ser un repositorio o una carpeta con repositorios adentro
(un nivel). De ahí salen los worktrees, y Mostrar en el Explorador solo funciona
con archivos de esas carpetas. No hace falta reiniciar.

## Cómo decide qué es "de desarrollo"

Un proceso que escucha un puerto cae en una de tres clases:

- **Desarrollo**: lo lanzó un intérprete o una herramienta de desarrollo (node,
  bun, deno, python, php, ruby, java, dotnet, go, vite, next y parecidos) **desde
  una carpeta de proyecto**, o es un binario que vive adentro de una. Una
  carpeta de proyecto es la que tiene `.git`, `package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod` o similar, y no es la carpeta del usuario, ni una
  carpeta del sistema, ni una carpeta oculta del perfil.
- **Otros programas**: lo demás que es tuyo (el navegador, el editor, una app
  instalada). Se muestra; no se puede cerrar desde acá.
- **Sistema**: servicios del sistema y procesos de otros usuarios. Se muestran
  aparte, sin línea de comando; no se pueden cerrar desde acá.

La versión sale de lo que está escrito, sin adivinar: el `package.json` del
proyecto y, si en la línea de comando se reconoce la herramienta, el
`package.json` de esa herramienta instalada en el proyecto (`vite 5.4.2`).

## Modelo de seguridad

Un servicio local que lista procesos y puede cerrar uno es un blanco: cualquier
página abierta en el navegador puede intentar hablarle. Estas son las defensas,
cada una con su prueba en `test/security.test.js` y `test/reveal.test.js`.

| Riesgo | Defensa |
| --- | --- |
| Alguien de la red le habla | Escucha solo en `127.0.0.1`. No abre el puerto en ninguna otra interfaz. |
| Una página ajena lee la lista | Todo `/v1/*` pide el token. Sin token: `401`, sin datos. |
| Una página ajena adivina el token | 256 bits al azar. A los diez intentos errados en un minuto deja de contestar un rato. La comparación no filtra tiempos. |
| Una página ajena usa un token robado | Lista cerrada de orígenes (`https://sharpmd.app` y la extensión). Otro `Origin`: `403` y sin encabezados CORS, así que el navegador no le deja leer nada. Lo mismo en la respuesta de preflight. |
| DNS rebinding (un dominio ajeno que resuelve a `127.0.0.1`) | Se valida `Host`: tiene que ser `127.0.0.1:<puerto>` o `localhost:<puerto>`. Otro valor: `421`, también para el panel. |
| Un formulario o una imagen de otra página dispara una acción (CSRF) | El token viaja en `Authorization`, que no se puede mandar sin preflight; las acciones piden `POST` con `Content-Type: application/json`. No hay cookies ni sesión. |
| El token se filtra por el historial o un registro | Nunca va en la URL de un pedido. El panel lo recibe después del `#` (que no viaja al servidor) y lo saca de la barra. |
| Cerrar algo que no corresponde | Solo procesos que el propio programa clasificó como de desarrollo, o sesiones que reconoció como de un agente. El pedido lleva PID, puerto y fecha de inicio, y los tres tienen que coincidir con lo que el programa ve en ese momento (un PID reusado no pasa). Nunca se cierra a sí mismo ni a quien lo lanzó. |
| Cerrar por error | La interfaz siempre pregunta antes. Con `--read-only` o `"allowClose": false` no se cierra nada. |
| Ejecutar comandos o leer archivos | No hay ruta para eso. Lo único que entra por la red son números y una fecha; `git` y las herramientas del sistema se llaman con argumentos fijos y sin consola de por medio. |
| Usar Mostrar en el Explorador para abrir o ejecutar algo | La ruta tiene que ser absoluta, sin comillas ni caracteres de control, un archivo que existe y, ya resuelta del todo (enlaces simbólicos y `..`), estar adentro de una carpeta que sumaste. Sin carpetas sumadas no se muestra nada. El explorador se lanza con la ruta como argumento, sin consola de por medio, y es lo único que se lanza: el archivo queda seleccionado, nunca se abre. `"allowReveal": false` lo apaga. |
| Mirar carpetas ajenas | Las carpetas se eligen solo desde la consola de esta máquina, nunca por la API. |
| Un título o un nombre con HTML adentro | Todo lo que viene de la máquina se escribe como texto. El panel propio va con una CSP que no admite scripts en línea y no se puede embeber. |

El token vive en `~/.sharpmd-local/token`, que solo lee tu usuario. Para
cambiarlo (lo ya emparejado deja de entrar):

```
node bin/sharpmd-local.js token --new
```

Lo que **no** cubre: otro programa corriendo con tu mismo usuario puede leer
ese archivo, igual que puede leer cualquier otro archivo tuyo o cerrar tus
procesos sin pasar por acá. Y quien tenga el token y pueda correr código en tu
máquina ve lo mismo que ves vos en el panel.

## Configuración

`~/.sharpmd-local/config.json` (se crea al sumar la primera carpeta; se puede
escribir a mano). Lo que no esté, toma su valor por defecto.

| Clave | Por defecto | Qué es |
| --- | --- | --- |
| `port` | `7717` | El puerto. Cambiarlo cambia el código de emparejamiento. |
| `origins` | la web y la extensión | Quién puede hablarle desde un navegador. |
| `allowClose` | `true` | `false`: solo lectura. |
| `allowReveal` | `true` | `false`: nunca abre el explorador de archivos. |
| `probeHttp` | `true` | Pedirle la portada a los servidores de desarrollo para leer el título. |
| `readCwd` | `true` | Leer la carpeta de trabajo de los procesos. Sin esto no sabe de qué proyecto son y nada cuenta como de desarrollo. |
| `agentTitles` | `true` | Mostrar el título de cada sesión de agente. |
| `folders` | `[]` | Las carpetas que puede mirar. |
| `agents` | Claude Code prendido | Qué agentes seguir: `name`, `on`, `process` (el ejecutable), `sessionPattern` (qué línea de comando es una sesión), `idPattern` y `transcripts` (de dónde sale el título). |

## Apagarlo

`Ctrl+C` en su consola, o cerrar la ventana. No instala ningún servicio ni
arranca solo: si no lo abrís, no corre.

En SharpMD, **Desemparejar** borra el código de ese navegador. Para borrar todo
rastro: eliminar la carpeta `~/.sharpmd-local`.

## Plataformas

| | Windows 10 y 11 | Linux | macOS |
| --- | --- | --- | --- |
| Estado | Probado en una máquina real | Escrito, **sin probar en una máquina real** | Escrito, **sin probar en una máquina real** |
| Puertos | `netstat -ano` | `ss -ltnp` | `lsof -iTCP -sTCP:LISTEN` |
| Procesos | PowerShell (`Win32_Process`) | `ps` | `ps` |
| Carpeta de trabajo | Se lee del propio proceso | `/proc/<pid>/cwd` | `lsof -d cwd` |
| Cerrar | `taskkill /T /F` (el proceso y lo que lanzó) | `SIGTERM` y, a los dos segundos, `SIGKILL` | igual |
| Mostrar en el Explorador | `explorer.exe /select,` | `xdg-open` sobre la carpeta (sin seleccionar) | `open -R` |

Lo que falta para Linux y macOS: correrlo de verdad y ajustar lo que aparezca;
cerrar también los procesos hijos (hoy solo el que escucha); el tiempo de
procesador de cada sesión, que es lo que dice si un agente está trabajando o
esperando; revisar la lista de carpetas del sistema; y un lanzador equivalente
a `start.cmd`.

En Windows, la carpeta de trabajo se lee de la memoria del propio proceso, como
hace Process Explorer. Solo funciona con procesos de tu usuario. Un antivirus
muy estricto puede marcar esa lectura; con `"readCwd": false` no se hace.

## El nombre

El nombre del programa está en un solo lugar, `src/name.js` (y, del lado de la
app, en `LMD.tools.local` de `src/tools.js`). Fuera de esos dos, solo lo llevan
`package.json`, el nombre del archivo de `bin/` y estos README.

## Pruebas

```
npm test                 # parseo con salidas guardadas, seguridad de la API, Mostrar en el Explorador
npm run test:real        # en esta máquina: levanta un servidor, lo ve, lo cierra
```

Los ejemplos de `test/fixtures` son inventados: ningún proceso, puerto ni ruta
de ahí sale de una máquina real.

`test/browser.mjs` prueba la conexión desde una página real de
`https://sharpmd.app` en Chromium, Firefox y WebKit. Necesita `playwright-core`, que no es dependencia:

```
PLAYWRIGHT_CORE=<ruta a node_modules/playwright-core> node test/browser.mjs
```

Las pruebas de la app para las tres herramientas están en `tests/localtools.mjs`,
en la raíz del repositorio.

## Licencia

MIT, como el resto de la app. Ver [LICENSE](../LICENSE).
