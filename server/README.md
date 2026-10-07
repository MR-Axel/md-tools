# SharpMD Sync

The optional server behind SharpMD: accounts, notes in the cloud and an MCP endpoint so an AI can read and write those notes. One file, no dependencies, SQLite on disk.

SharpMD works without it. This is only for syncing notes between devices and connecting an AI.

License: AGPL-3.0-or-later. You can run it for yourself or your team. If you offer it to others as a service, you publish your changes.

## Run it

Needs Node 22.13 or newer.

```
DEV_CODES=1 node server.mjs
```

`DEV_CODES=1` returns the sign-in code in the response instead of mailing it. Use it only to try things out.

Then, in SharpMD: Settings → Cloud → Sync server, and type the address (`http://localhost:8787`). The start screen shows a sign-in line.

## Configuration

| Variable | What it does | Default |
|---|---|---|
| `PORT` | Local port | `8787` |
| `HOST` | Interface to listen on | `127.0.0.1` |
| `DATA_DIR` | Folder for the database | `./data` |
| `PUBLIC_URL` | Public address, shown to the user when connecting an AI | `http://localhost:PORT` |
| `ALLOW_ORIGINS` | Web origins allowed to call the API, comma separated. Browser extensions are always allowed | none |
| `RESEND_API_KEY`, `MAIL_FROM` | Send the sign-in code through Resend | |
| `MAIL_WEBHOOK` | Or post `{ to, subject, text, html }` to your own mailer | |
| `FREE_NOTES` | Notes on the free plan | `10` |
| `MCP_FREE` | `1` gives MCP access to the free plan too | off |
| `ADMIN_KEY` | Key for `POST /admin/plan` | off |
| `CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY` | Payment links the app shows in Settings → Plan. The account email is appended as `email=`, and the app adds `back=` with the address to return to | |
| `PADDLE_WEBHOOK_SECRET` | Turns on `POST /paddle/webhook`: Paddle subscription events switch the plan | off |
| `PORTAL_URL` | Where a subscriber manages the subscription | |
| `FEEDBACK_TO` | Address that receives what people send from "Send feedback" (`POST /feedback`). It goes out through the same mailer as the sign-in code. Without it the endpoint answers 404 and the app offers a `mailto:` link instead | off |

Put it behind a reverse proxy with HTTPS. With Caddy:

```
sync.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Changing a plan by hand:

```
curl -X POST https://sync.example.com/admin/plan -H "x-admin-key: $ADMIN_KEY" \
  -H "content-type: application/json" -d '{"email":"someone@example.com","plan":"pro"}'
```

## What it stores

Email, notes and their previous versions (paid plan, 30 days), and hashes of sign-in codes, sessions and tokens. Sessions and tokens are stored hashed: the server cannot show a token again after creating it.

Notes are not end-to-end encrypted. The MCP endpoint has to read them to serve an AI.

## API

Sign-in is a six-digit code sent by mail, no passwords.

| Call | What it does |
|---|---|
| `POST /auth/start` `{ email, lang }` | Sends the code, in English or with `lang: "es"` in Spanish |
| `POST /auth/verify` `{ email, code }` | Returns `{ session, account }` |
| `GET /account` | Plan, note count and limit |
| `GET /notes` | List |
| `GET` / `PUT` / `DELETE /notes/{path}` | Read, write `{ text }`, delete |
| `POST /rename` `{ from, to }` | Rename |
| `GET /search?q=` | Search the text of every note |
| `POST /tokens` `{ name }` | Creates a token for MCP, shown once |
| `GET /tokens`, `DELETE /tokens/{id}` | List the tokens and revoke one |
| `POST /feedback` `{ text, email?, context? }` | Mails the text to `FEEDBACK_TO`, with or without a session. 5 to 4000 characters, five an hour per IP and per account. Behind a proxy the IP is the last entry of `x-forwarded-for` |
| `POST /mcp` | MCP over Streamable HTTP, with `Authorization: Bearer mdt_...` |

MCP tools: `list_notes`, `read_note`, `write_note`, `append_note`, `search_notes`.

Connecting Claude Code:

```
claude mcp add --transport http sharpmd https://sync.example.com/mcp --header "Authorization: Bearer mdt_..."
```

## Tests

```
cd ../tests
node server.mjs
node cloud.mjs
```
