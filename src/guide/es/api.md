# Referencia de la API

Una API REST sobre las notas de tu cuenta: las mismas que muestra la app, por HTTP. Es parte del plan pago.

Esta nota es un resumen. La referencia completa, con los parámetros y un ejemplo de cada pedido, está en [sharpmd.app/api.html](https://sharpmd.app/api.html). La descripción en OpenAPI 3.1 está en `https://sync.sharpmd.app/api/v1/openapi.json`.

## Autenticarte

Creá un token en **Ajustes** > **API y automatizaciones**. Son los mismos tokens que usa la IA: uno limitado a una carpeta solo alcanza esa carpeta, y compartir necesita un token creado con ese permiso.

El token empieza con `mdt_` y va en la cabecera:

```text
Authorization: Bearer mdt_...
```

Las notas del espacio del equipo están bajo `@team/`.

## Un pedido de ejemplo

```text
curl -H "Authorization: Bearer mdt_..." "https://sync.sharpmd.app/api/v1/note?path=tienda/tablero.md"
```

Toda respuesta trae `ok`. Si es `true`, lo pedido viene en `data`. Si es `false`, viene `error` con un código estable y un mensaje.

Para no pisar un cambio ajeno, mandá `rev` con la revisión sobre la que trabajaste. Si la nota está en otra, el pedido falla con `rev_conflict` y no se escribe nada.

## Pedidos

Los nombres de los pedidos y sus descripciones están en inglés, como en la API. La lista sale de la descripción que publica el servidor.

<!-- api:start (tools/build-guide.mjs) -->

28 pedidos. La dirección base es `https://sync.sharpmd.app`.

### Notas

| Pedido | Qué hace |
|---|---|
| `GET /api/v1/me` | What this token reaches |
| `GET /api/v1/notes` | List notes, newest first |
| `GET /api/v1/note` | Read a note |
| `PUT /api/v1/note` | Create a note or replace its content |
| `DELETE /api/v1/note` | Move a note to the trash |
| `POST /api/v1/note/append` | Add text at the end of a note |
| `POST /api/v1/note/move` | Move or rename a note |
| `GET /api/v1/folders` | List folders with how many notes each one has |
| `GET /api/v1/search` | Search the text of every note |
| `GET /api/v1/history` | Earlier versions of a note |
| `GET /api/v1/openapi.json` | This document |

### Tableros

| Pedido | Qué hace |
|---|---|
| `GET /api/v1/boards` | The boards of a note, as data |
| `POST /api/v1/boards/cards` | Create a card |
| `PATCH /api/v1/boards/cards/{id}` | Change a card: title, column, done, attributes |
| `DELETE /api/v1/boards/cards/{id}` | Remove a card |
| `POST /api/v1/boards/cards/{id}/move` | Move a card to another column |
| `POST /api/v1/boards/cards/{id}/done` | Mark a card as done |

### Comentarios

| Pedido | Qué hace |
|---|---|
| `GET /api/v1/comments` | Open comments |
| `POST /api/v1/comments` | Leave a comment on a note |
| `POST /api/v1/comments/{id}/resolve` | Mark a comment as done |

### Compartir

| Pedido | Qué hace |
|---|---|
| `GET /api/v1/shares` | Who the notes are shared with, and the public links |
| `POST /api/v1/shares` | Share a note or a folder with another account |
| `DELETE /api/v1/shares` | Stop sharing |
| `POST /api/v1/links` | Create a read-only public link |
| `DELETE /api/v1/links` | Revoke a public link by id, or every link of a note |

### Imágenes

| Pedido | Qué hace |
|---|---|
| `GET /api/v1/files` | List the attached images and the storage in use |
| `POST /api/v1/files` | Upload an image |

### Direcciones de entrada

| Pedido | Qué hace |
|---|---|
| `POST /in/{secret}` | Add to a note through an inbound address |

### Eventos de los webhooks

`note.created`, `note.updated`, `note.deleted`, `note.restored`, `note.moved`, `comment.created`, `comment.resolved`, `card.created`, `card.moved`, `card.updated`, `card.done`, `card.deleted`

<!-- api:end -->

## Dónde sigue

- [Automatizaciones y webhooks](automations.md): los eventos y las direcciones de entrada.
- [Conectar tu IA por MCP](connect-your-ai.md): lo mismo, para una IA.
- [Tablero kanban](boards.md): qué es una tarjeta y sus atributos.
