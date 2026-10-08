// Arma server/openapi.json, la descripción de la API que el servidor sirve en GET /api/v1/openapi.json.
// Se corre a mano cuando cambia la API: node tools/build-openapi.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'openapi.json');
const ref = (n) => ({ $ref: '#/components/schemas/' + n });
const ok = (data, more) => ({ type: 'object', required: ['ok', 'data'], properties: Object.assign({ ok: { type: 'boolean', const: true }, data }, more || {}) });
const json = (schema) => ({ content: { 'application/json': { schema } } });
const errs = { 400: { $ref: '#/components/responses/Error' }, 401: { $ref: '#/components/responses/Error' }, 402: { $ref: '#/components/responses/Error' }, 403: { $ref: '#/components/responses/Error' }, 404: { $ref: '#/components/responses/Error' }, 409: { $ref: '#/components/responses/Error' }, 423: { $ref: '#/components/responses/Error' }, 429: { $ref: '#/components/responses/Error' } };
const res = (schema, description) => Object.assign({ 200: Object.assign({ description: description || 'OK' }, json(schema)) }, errs);
const qp = (name, description, required, schema) => ({ name, in: 'query', required: !!required, description, schema: schema || { type: 'string' } });
const body = (required, properties) => ({ required: true, content: { 'application/json': { schema: { type: 'object', required, properties } } } });
const str = (description, example) => Object.assign({ type: 'string' }, description ? { description } : {}, example !== undefined ? { example } : {});
const PATH = qp('path', 'Path of the note, for example shop/board.md. Notes of the team space start with @team/.', true);
const REV = { type: 'integer', minimum: 0, description: 'Revision the change was made on. If the note is at another revision the request fails with rev_conflict and nothing is written. Leave it out to write on whatever is there.' };
const ATTRS = { type: 'object', description: 'Attributes of the card as key and value. Values are text, numbers or true/false, and are stored as text. null or an empty value removes the attribute. Keys start with a letter and have no spaces; id, created, updated and show are reserved.', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] }, example: { due: '2026-10-20', owner: 'Ana Paz' } };
const CARD_ID = { name: 'id', in: 'path', required: true, description: 'Id of the card, or its ref (board.column.position, for example 0.1.2) when the card has no id yet.', schema: { type: 'string' } };
const cardRes = res(ok(ref('CardResult')));

const doc = {
  openapi: '3.1.0',
  info: { title: 'SharpMD API', version: '1.0.0', summary: 'Read and write the Markdown notes of a SharpMD account from automated flows.',
    description: 'The same notes the SharpMD app shows, over plain HTTP. Authenticate with a token created in Settings > Automations (or Settings > AI): the tokens are the ones MCP uses, so a token limited to a folder only reaches that folder, and sharing needs a token created with that permission. Notes of the team space are under @team/. Notes inside a protected folder are encrypted in the browser: they are only reachable while the person has the folder unlocked for the AI.\n\nEvery response is JSON: { "ok": true, "data": … } or { "ok": false, "error": { "code", "message" } }. Each token can make 120 requests per minute; past that the answer is 429 with a Retry-After header.\n\nDocs with examples: https://sharpmd.app/api.html',
    license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' } },
  servers: [{ url: 'https://sync.sharpmd.app' }],
  security: [{ token: [] }],
  tags: [{ name: 'Notes' }, { name: 'Boards', description: 'Kanban boards inside a note: columns and cards with attributes.' }, { name: 'Comments', description: 'Comments left for the AI on a note.' }, { name: 'Sharing', description: 'Needs a token created with the sharing permission.' }, { name: 'Inbound', description: 'Secret addresses that add to a note without a token.' }],
  paths: {
    '/api/v1/me': { get: { tags: ['Notes'], operationId: 'me', summary: 'What this token reaches', responses: res(ok({ type: 'object', properties: { account: str('Opaque id of the account', 'acc_3f1c9a7b2d4e5f601234'), plan: str(), scope: { type: ['string', 'null'], description: 'Folder the token is limited to, or null' }, can_share: { type: 'boolean' }, team: { type: 'boolean' } } })) } },
    '/api/v1/notes': { get: { tags: ['Notes'], operationId: 'listNotes', summary: 'List notes, newest first',
      parameters: [qp('folder', 'Only the notes inside this folder'), qp('limit', 'Notes per page, 1 to 200 (50)', false, { type: 'integer', minimum: 1, maximum: 200, default: 50 }), qp('cursor', 'next_cursor of the previous page')],
      responses: res(ok({ type: 'array', items: ref('NoteRow') }, { total: { type: 'integer' }, next_cursor: { type: ['string', 'null'] } })) } },
    '/api/v1/note': {
      get: { tags: ['Notes'], operationId: 'readNote', summary: 'Read a note', parameters: [PATH], responses: res(ok(ref('Note'))) },
      put: { tags: ['Notes'], operationId: 'writeNote', summary: 'Create a note or replace its content', description: 'POST works the same, for tools that cannot send PUT.',
        requestBody: body(['path', 'text'], { path: str(null, 'shop/board.md'), text: str('Full Markdown content'), rev: REV }), responses: res(ok(ref('Saved'))) },
      delete: { tags: ['Notes'], operationId: 'deleteNote', summary: 'Move a note to the trash', description: 'It stays in the trash for 30 days and can be restored from the app.', parameters: [PATH], responses: res(ok({ type: 'object', properties: { path: str(), trash: { type: 'boolean' } } })) },
    },
    '/api/v1/note/append': { post: { tags: ['Notes'], operationId: 'appendNote', summary: 'Add text at the end of a note', description: 'Creates the note if it does not exist.', requestBody: body(['path', 'text'], { path: str(), text: str('Markdown to add') }), responses: res(ok(ref('Saved'))) } },
    '/api/v1/note/move': { post: { tags: ['Notes'], operationId: 'moveNote', summary: 'Move or rename a note', description: 'Its history, comments, shares and public links follow it.', requestBody: body(['from', 'to'], { from: str(), to: str() }), responses: res(ok(ref('Saved'))) } },
    '/api/v1/folders': { get: { tags: ['Notes'], operationId: 'listFolders', summary: 'List folders with how many notes each one has', responses: res(ok({ type: 'array', items: { type: 'object', properties: { folder: str(), notes: { type: 'integer' }, protected: { type: 'boolean' }, locked: { type: 'boolean' }, team: { type: 'boolean' } } } })) } },
    '/api/v1/search': { get: { tags: ['Notes'], operationId: 'search', summary: 'Search the text of every note', parameters: [qp('q', 'Text to look for', true)], responses: res(ok({ type: 'array', items: { type: 'object', properties: { path: str(), hits: { type: 'array', items: { type: 'object', properties: { line: { type: 'integer' }, text: str() } } }, locked: { type: 'boolean' } } } })) } },
    '/api/v1/history': { get: { tags: ['Notes'], operationId: 'history', summary: 'Earlier versions of a note', description: 'Without version, the list (newest first). With version, the text of that one.', parameters: [PATH, qp('version', 'Id of the version to read', false, { type: 'integer' })], responses: res(ok({ oneOf: [{ type: 'array', items: { type: 'object', properties: { version: { type: 'integer' }, saved: str(), size: { type: 'integer' } } } }, { type: 'object', properties: { path: str(), version: { type: 'integer' }, text: str() } }] })) } },
    '/api/v1/boards': { get: { tags: ['Boards'], operationId: 'readBoards', summary: 'The boards of a note, as data', parameters: [PATH], responses: res(ok({ type: 'object', properties: { boards: { type: 'array', items: ref('Board') }, path: str(), rev: { type: 'integer' }, updated: str(), url: str() } })) } },
    '/api/v1/boards/cards': { post: { tags: ['Boards'], operationId: 'createCard', summary: 'Create a card', description: 'The column is created if the board does not have it. The Markdown of the note is rewritten.',
      requestBody: body(['path', 'title'], { path: str(), title: str(null, 'Call the supplier'), column: str('Title of the column. Left out: the first one', 'To do'), board: { type: 'integer', description: 'Which board of the note, from 0 (0)' }, attrs: ATTRS, done: { type: 'boolean' }, position: { type: 'string', enum: ['top', 'bottom'] }, rev: REV }), responses: cardRes } },
    '/api/v1/boards/cards/{id}': {
      patch: { tags: ['Boards'], operationId: 'updateCard', summary: 'Change a card: title, column, done, attributes', description: 'Only what is sent changes. PUT works the same.', parameters: [CARD_ID],
        requestBody: body(['path'], { path: str(), title: str(), column: str('Move it to this column'), done: { type: 'boolean' }, attrs: ATTRS, position: { type: 'string', enum: ['top', 'bottom'] }, rev: REV }), responses: cardRes },
      delete: { tags: ['Boards'], operationId: 'deleteCard', summary: 'Remove a card', parameters: [CARD_ID, PATH, qp('rev', 'Revision the change was made on', false, { type: 'integer' })], responses: cardRes },
    },
    '/api/v1/boards/cards/{id}/move': { post: { tags: ['Boards'], operationId: 'moveCard', summary: 'Move a card to another column', parameters: [CARD_ID], requestBody: body(['path', 'column'], { path: str(), column: str(null, 'Done'), position: { type: 'string', enum: ['top', 'bottom'] }, rev: REV }), responses: cardRes } },
    '/api/v1/boards/cards/{id}/done': { post: { tags: ['Boards'], operationId: 'doneCard', summary: 'Mark a card as done', parameters: [CARD_ID], requestBody: body(['path'], { path: str(), done: { type: 'boolean', default: true }, rev: REV }), responses: cardRes } },
    '/api/v1/comments': {
      get: { tags: ['Comments'], operationId: 'listComments', summary: 'Open comments', parameters: [qp('path', 'Only the comments on this note')], responses: res(ok({ type: 'array', items: ref('Comment') })) },
      post: { tags: ['Comments'], operationId: 'addComment', summary: 'Leave a comment on a note', requestBody: body(['path', 'text'], { path: str(), text: str('What should change'), quote: str('The passage it refers to') }), responses: res(ok(ref('Comment'))) },
    },
    '/api/v1/comments/{id}/resolve': { post: { tags: ['Comments'], operationId: 'resolveComment', summary: 'Mark a comment as done', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: body([], { reply: str('What was changed') }), responses: res(ok({ type: 'object', properties: { id: { type: 'integer' }, status: str() } })) } },
    '/api/v1/shares': {
      get: { tags: ['Sharing'], operationId: 'listShares', summary: 'Who the notes are shared with, and the public links', parameters: [qp('path', 'Only this note or folder')], responses: res(ok({ type: 'object', properties: { people: { type: 'array', items: { type: 'object' } }, links: { type: 'array', items: { type: 'object' } } } })) },
      post: { tags: ['Sharing'], operationId: 'share', summary: 'Share a note or a folder with another account', requestBody: body(['path', 'email'], { path: str(), email: str(), role: { type: 'string', enum: ['view', 'edit'] } }), responses: res(ok(ref('Message'))) },
      delete: { tags: ['Sharing'], operationId: 'unshare', summary: 'Stop sharing', parameters: [PATH, qp('email', 'Address it was shared with', true)], responses: res(ok(ref('Message'))) },
    },
    '/api/v1/links': {
      post: { tags: ['Sharing'], operationId: 'createLink', summary: 'Create a read-only public link', description: 'The URL is returned once.', requestBody: body(['path'], { path: str(), password: str('Optional password the reader must type') }), responses: res(ok({ type: 'object', properties: { path: str(), url: str(), id: { type: 'integer' }, protected: { type: 'boolean' } } })) },
      delete: { tags: ['Sharing'], operationId: 'revokeLink', summary: 'Revoke a public link by id, or every link of a note', parameters: [qp('id', 'Id of the link', false, { type: 'integer' }), qp('path', 'Or the path of the note')], responses: res(ok(ref('Message'))) },
    },
    '/api/v1/openapi.json': { get: { tags: ['Notes'], operationId: 'openapi', summary: 'This document', security: [], responses: { 200: { description: 'OpenAPI 3.1' } } } },
    '/in/{secret}': { post: { tags: ['Inbound'], operationId: 'inbound', summary: 'Add to a note through an inbound address', security: [],
      description: 'An inbound address is created in Settings > Automations. Depending on how it was set up, what arrives is added at the end of a note, becomes a new note in a folder, or becomes a card on a board. It takes text/plain, JSON ({ "text", "title" }; any other JSON becomes a table of field and value, or a code block if it is nested), application/x-www-form-urlencoded and multipart/form-data (fields become a list; files are skipped). Up to 64 KB and 60 requests per minute. The answer never carries content of the note. GET with ?text= works only if the address allows it.',
      parameters: [{ name: 'secret', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'text/plain': { schema: { type: 'string' } }, 'application/json': { schema: { type: 'object', properties: { text: str(), title: str() }, additionalProperties: true } }, 'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: true } } } },
      responses: { 200: Object.assign({ description: 'Added' }, json({ type: 'object', properties: { ok: { type: 'boolean' }, id: str('Id of the card, when the address creates cards') } })), 404: { description: 'No such address' }, 413: { description: 'Too large' }, 429: { description: 'Too many requests' } } } },
  },
  webhooks: {
    event: { post: { summary: 'What SharpMD sends to the address of an automation', description: 'One POST per event, JSON, signed. Header X-SharpMD-Signature: t=<unix seconds>,v1=<hex HMAC-SHA-256 of "<t>.<raw body>" with the secret of the automation>. Reject what does not match or carries a timestamp older than five minutes. X-SharpMD-Event carries the type and X-SharpMD-Delivery the id of the event, which repeats on a retry. Answer 2xx within 8 seconds; anything else is retried up to 5 times within an hour. With the Slack or Discord format the body is { "text" } or { "content" } instead.',
      requestBody: json(ref('Event')), responses: { 200: { description: 'Received' } } } },
  },
  components: {
    securitySchemes: { token: { type: 'http', scheme: 'bearer', description: 'A token that starts with mdt_' } },
    responses: { Error: Object.assign({ description: 'Error' }, json(ref('Error'))) },
    schemas: {
      Error: { type: 'object', required: ['ok', 'error'], properties: { ok: { type: 'boolean', const: false }, error: { type: 'object', required: ['code', 'message'], properties: { code: str('Stable code: no_auth, bad_auth, api_needs_plan, out_of_scope, not_found, rev_conflict, vault_locked, rate_limited, no_board, card_not_found, bad_attr_key, too_large…', 'not_found'), message: str(), retry_after: { type: 'integer', description: 'Seconds to wait, on 429' }, rev: { type: 'integer', description: 'Current revision, on rev_conflict' } } } } },
      Message: { type: 'object', properties: { message: str() } },
      NoteRow: { type: 'object', properties: { path: str(), updated: str('ISO date'), size: { type: 'integer' }, team: { type: 'boolean' }, protected: { type: 'boolean' }, locked: { type: 'boolean' } } },
      Saved: { type: 'object', properties: { path: str(), rev: { type: 'integer' }, updated: str(), size: { type: 'integer' }, url: str('Opens the note in the SharpMD app'), created: { type: 'boolean' }, from: str() } },
      Note: { type: 'object', properties: { path: str(), text: str('Markdown'), rev: { type: 'integer' }, updated: str(), size: { type: 'integer' }, url: str() } },
      Card: { type: 'object', properties: { id: { type: ['string', 'null'], description: 'Stable id. null on a card of an older board that was never edited', example: 'c8k2m9xq' }, ref: str('board.column.position, usable in place of the id', '0.0.2'), title: str(), column: str('The status of the card: the title of its column'), done: { type: 'boolean' }, created: { type: ['string', 'null'], description: 'ISO date and time' }, updated: { type: ['string', 'null'], description: 'ISO date and time of the last move or edit' }, attrs: { type: 'object', additionalProperties: { type: 'string' } } } },
      Board: { type: 'object', properties: { index: { type: 'integer' }, show: { type: 'array', items: { type: 'string' }, description: 'Attributes shown on the cards' }, fields: { type: 'object', description: 'Declared attributes and their type: text, date, number or select with its options', additionalProperties: { type: 'object', properties: { type: { type: 'string', enum: ['text', 'date', 'number', 'select'] }, options: { type: 'array', items: { type: 'string' } } } } }, columns: { type: 'array', items: { type: 'object', properties: { title: str(), cards: { type: 'array', items: ref('Card') } } } } } },
      CardResult: { type: 'object', properties: { card: ref('Card'), board: { type: 'integer' }, path: str(), rev: { type: 'integer' }, updated: str(), url: str() } },
      Comment: { type: 'object', properties: { id: { type: 'integer' }, path: str(), quote: str(), comment: str(), created: str() } },
      Event: { type: 'object', required: ['id', 'type', 'created', 'account', 'note', 'actor', 'data'], properties: {
        id: str('Id of the event. The same on every retry', 'evt_Zk3v9Q0aXc81LmPq7RtY'),
        type: { type: 'string', enum: ['note.created', 'note.updated', 'note.deleted', 'note.restored', 'note.moved', 'comment.created', 'comment.resolved', 'card.created', 'card.moved', 'card.updated', 'card.done', 'card.deleted', 'ping'] },
        created: str('ISO date and time', '2026-10-07T14:03:11Z'), account: str('Opaque id of the account. Never the email address', 'acc_3f1c9a7b2d4e5f601234'),
        note: { type: ['object', 'null'], properties: { path: str(null, 'shop/board.md'), name: str(null, 'board.md'), url: str('Opens the note in the app'), space: { type: 'string', enum: ['own', 'team'] } } },
        actor: { type: 'object', properties: { type: { type: 'string', enum: ['app', 'api', 'mcp', 'inbox', 'member'] }, id: str('For member: an opaque id of the team member', 'mem_3f1c9a7b2d4e5f60'), role: { type: 'string', enum: ['admin', 'editor', 'reader'] }, via: { type: 'string', enum: ['app', 'api', 'mcp'] } } },
        data: { type: 'object', description: 'note.created, note.updated: rev, size, updated, and text only if the automation includes the content (up to 64 KB, with truncated). note.moved: from, to. note.deleted: trash. comment.*: comment { id, text, quote | reply }. card.*: card, board, and from/to (card.moved) or changes { key: { from, to } } (card.updated).', additionalProperties: true } } },
    },
  },
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log('openapi: ' + Object.keys(doc.paths).length + ' rutas');
