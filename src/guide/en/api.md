# API reference

A REST API over the notes of your account: the same ones the app shows, over HTTP. It is part of the paid plan.

This note is a summary. The full reference, with the parameters and an example of each request, is at [sharpmd.app/api.html](https://sharpmd.app/api.html). The OpenAPI 3.1 description is at `https://sync.sharpmd.app/api/v1/openapi.json`.

## Authenticating

Create a token in **Settings** > **API and automations**. They are the same tokens the AI uses: one limited to a folder only reaches that folder, and sharing needs a token created with that permission.

The token starts with `mdt_` and goes in the header:

```text
Authorization: Bearer mdt_...
```

Notes of the team space are under `@team/`.

## A sample request

```text
curl -H "Authorization: Bearer mdt_..." "https://sync.sharpmd.app/api/v1/note?path=shop/board.md"
```

Every answer carries `ok`. If it is `true`, what you asked for comes in `data`. If it is `false`, `error` comes with a stable code and a message.

To avoid overwriting someone else's change, send `rev` with the revision you worked on. If the note is at another one, the request fails with `rev_conflict` and nothing is written.

## Requests

The list comes from the description the server publishes.

<!-- api:start (tools/build-guide.mjs) -->

28 requests. The base address is `https://sync.sharpmd.app`.

### Notes

| Request | What it does |
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

### Boards

| Request | What it does |
|---|---|
| `GET /api/v1/boards` | The boards of a note, as data |
| `POST /api/v1/boards/cards` | Create a card |
| `PATCH /api/v1/boards/cards/{id}` | Change a card: title, column, done, attributes |
| `DELETE /api/v1/boards/cards/{id}` | Remove a card |
| `POST /api/v1/boards/cards/{id}/move` | Move a card to another column |
| `POST /api/v1/boards/cards/{id}/done` | Mark a card as done |

### Comments

| Request | What it does |
|---|---|
| `GET /api/v1/comments` | Open comments |
| `POST /api/v1/comments` | Leave a comment on a note |
| `POST /api/v1/comments/{id}/resolve` | Mark a comment as done |

### Sharing

| Request | What it does |
|---|---|
| `GET /api/v1/shares` | Who the notes are shared with, and the public links |
| `POST /api/v1/shares` | Share a note or a folder with another account |
| `DELETE /api/v1/shares` | Stop sharing |
| `POST /api/v1/links` | Create a read-only public link |
| `DELETE /api/v1/links` | Revoke a public link by id, or every link of a note |

### Images

| Request | What it does |
|---|---|
| `GET /api/v1/files` | List the attached images and the storage in use |
| `POST /api/v1/files` | Upload an image |

### Inbound

| Request | What it does |
|---|---|
| `POST /in/{secret}` | Add to a note through an inbound address |

### Webhook events

`note.created`, `note.updated`, `note.deleted`, `note.restored`, `note.moved`, `comment.created`, `comment.resolved`, `card.created`, `card.moved`, `card.updated`, `card.done`, `card.deleted`

<!-- api:end -->

## Where to go next

- [Automations and webhooks](automations.md): the events and the inbound addresses.
- [Connect your AI over MCP](connect-your-ai.md): the same, for an AI.
- [Kanban board](boards.md): what a card is and its attributes.
