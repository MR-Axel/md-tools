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
| `TEST_LOGIN` | `email:123456`. That one account signs in with the fixed code and gets no email. For store reviewers | off |
| `CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY` | Payment links the app shows in Settings → Plan. The account email is appended as `email=`, and the app adds `back=` with the address to return to | |
| `PADDLE_WEBHOOK_SECRET` | Turns on `POST /paddle/webhook`: Paddle subscription events switch the plan | off |
| `PORTAL_URL` | Where a subscriber manages the subscription | |
| `FEEDBACK_TO` | Address that receives what people send from "Send feedback" (`POST /feedback`). It goes out through the same mailer as the sign-in code. Without it the endpoint answers 404 and the app offers a `mailto:` link instead | off |
| `AUTH_PER_IP` | Sign-in codes one IP address may request per hour. Each email is also limited to 5 codes an hour and 15 a day, and wrong codes to 10 an hour per email and 30 per IP. Behind a proxy the IP is the last entry of `x-forwarded-for`: check that your proxy sets it, or every visitor shares one allowance | `20` |
| `DATA_KEY` | 32 bytes in base64. Turns on encryption at rest: see below | off |
| `VAULT_MINUTE_MS` | Tests only: how many milliseconds a minute lasts for a folder unlocked for the AI. Leave it alone in production | `60000` |

Put it behind a reverse proxy with HTTPS. The web app at sharpmd.app needs that: browsers do not let a public site call a server on `localhost` or on the local network without asking. The extension has no such limit, so `http://localhost:8787` works there. With Caddy:

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

Notes are not end-to-end encrypted by default: the MCP endpoint has to read them to serve an AI, and sharing has to hand them to another account. There are two layers on top of that, and they are independent:

- Encryption at rest (`DATA_KEY`) covers everything, and protects the database file.
- Folders protected with a password are end-to-end encrypted: the browser encrypts, and the server stores text it cannot read.

## Folders protected with a password

A user can protect a cloud folder with a password from the app (right-click the folder). Everything inside it, subfolders included, is then encrypted in the browser. Protected folders cannot be nested. They work on the free plan and the paid plan.

How it works:

- Each protected folder has a random 256-bit data key, made in the browser. Two things are derived from it with HKDF-SHA-256: the AES-256-GCM key that encrypts the notes, and a check value.
- The password does not encrypt notes. It wraps the data key: PBKDF2-SHA-256 with 600,000 iterations and a random salt gives a key, and that key encrypts the data key with AES-256-GCM. Changing the password wraps the same data key again and leaves the notes alone.
- Each note is encrypted with AES-256-GCM, a random 96-bit nonce per save, and the path of the note as associated data. A ciphertext copied to another path does not open. On the wire and in the database it is `vault1:` followed by base64.
- The backup key the app offers when the folder is created is the data key itself, written in groups of four characters. With it the user can set a new password.

What the server stores for each folder: the folder path, the salt, the iteration count, the wrapped data key and the check value. It never receives the password. It receives the data key in exactly one case, described below.

What the server still sees: the paths of the notes (names are not encrypted), their size, when they changed and how many versions they have.

What the server enforces:

- Inside a protected folder it only accepts text that starts with `vault1:`, and outside it never does. A wrong one gets `409 vault` or `409 vault_text`.
- Notes in a protected folder are left out of `GET /search`. Sharing them, creating a public link for them and commenting them for the AI answer `409 vault`. A folder shared earlier, or a parent folder that is shared, gives no access to them.
- Protecting a folder deletes what was readable or reachable from outside: the plain-text history of its notes, their comments, their public links and their shares. SQLite zeroes what it deletes (`secure_delete`) and the write-ahead log is truncated when a note goes from plain to encrypted, so the old text does not linger in the file.
- Renaming or moving a note into, out of or inside a protected folder needs the text again (`POST /rename` with `text`), because the ciphertext is tied to the path.

### MCP and "unlock for the AI"

The MCP tools do not see the content of a locked folder. `list_notes` and `list_folders` show that it exists, with `protected: true` and `locked: true`. `read_note`, `write_note` and `append_note` answer with a message written for the AI: the folder is protected with a password and the person can unlock it for the AI from SharpMD. `search_notes` skips its content and says which folders were left out.

The user can unlock a folder for the AI from the app, for 15 minutes, 1 hour, 8 hours or until it is locked again. The browser then sends the data key. The server checks it against the stored check value, derives the encryption key, and keeps that key in memory only, with its expiry. While it is there, the MCP tools read by decrypting and write by encrypting in the same format the browser uses. Locking by hand, the time running out or restarting the server forgets the key. It is never written to the database or to the log. Unlocking is part of MCP, so it needs the paid plan (or `MCP_FREE=1`). A token limited to a folder only benefits when the whole protected folder is inside its reach.

If you run your own server, this is the point to understand: while a folder is unlocked for the AI, your server can read it, and so can anyone who can read the memory of that process. Restarting the server locks every folder. A folder nobody unlocks stays unreadable to you too, and there is nothing you can do for a user who loses both the password and the backup key.

## Encryption at rest

Set `DATA_KEY` and the server stores the text of notes, of their previous versions and of comments (quote, text and reply) encrypted with AES-256-GCM, one random nonce per value. Stored values start with `enc1:`. Without the variable everything stays in plain text, as before: it is your server and your choice.

What it protects: the database file and every copy of it. A stolen disk, a leaked backup or a snapshot is unreadable without the key.

What it does not protect: a running server. The key is in the memory of the process and in its environment, so whoever gets into the machine while it runs can read the notes. Paths, emails, dates and sizes are not encrypted either.

Generate a key:

```
openssl rand -base64 32
```

Losing the key is losing the data. There is no recovery and no second key. Keep a copy somewhere that is not the server and is not next to the backups: a backup stored with its key protects nothing.

Turning it on with data already in the database, in this order:

1. Stop the server and copy the whole `DATA_DIR` folder (`mdtools.db`, plus `mdtools.db-wal` and `mdtools.db-shm` if they are there). That copy is in plain text: once you have checked that everything works, delete it or keep it somewhere safe.
2. Generate the key with the command above.
3. Save the key outside the server, for example in a password manager. Do this before the next step.
4. Set `DATA_KEY` in the environment of the service and start it. On start it encrypts the rows that were in plain text, in batches, and rewrites the file so the old text does not stay in free pages. The log says `DATA_KEY: se cifraron N filas que estaban en claro`. If it is interrupted, the next start continues where it stopped.
5. Check: open a note in the app, search for a word and open the history of a note. Then look for a word you know is in a note inside the file, and expect no match: `grep -c "that word" data/mdtools.db`.

From then on the server needs the same key every time. If the database has encrypted rows and `DATA_KEY` is missing or is a different key, the server prints why and does not start. It never writes plain text over an encrypted database and never returns unreadable text.

There is no command to change the key or to go back to plain text. To do either, restore the plain copy from step 1, or export the notes and load them into a new database.

## API

Sign-in is a six-digit code sent by mail, no passwords.

| Call | What it does |
|---|---|
| `POST /auth/start` `{ email, lang }` | Sends the code, in English or with `lang: "es"` in Spanish. A limit answers `429` with its own code (`code_gap`, `code_mail_hour`, `code_mail_day`, `code_ip_hour`), `retry_after` in the body and a `Retry-After` header, both in seconds |
| `POST /auth/verify` `{ email, code }` | Returns `{ session, account }`. Limits: `tries_mail_hour`, `tries_mail_day`, `tries_ip_hour`, with the wait, and `tries_code` when that code is used up and a new one is needed |
| `GET /account` | Plan, note count and limit |
| `GET /notes` | List |
| `GET` / `PUT` / `DELETE /notes/{path}` | Read, write `{ text }`, delete |
| `POST /rename` `{ from, to, text?, updated? }` | Rename. With a protected folder involved, `text` is the note for its new path and `updated` what the client read: `409 changed` if the note changed meanwhile |
| `GET /search?q=` | Search the text of every note outside protected folders |
| `GET /vaults` | Protected folders: `{ id, folder, salt, iters, wrapped, check, state, ai }`. `ai` is `null`, or `{ until }` while unlocked for the AI (`until: 0` means until locked) |
| `POST /vaults` `{ folder, salt, iters, wrapped, check }` | Protect a folder. `409 vault_nested` inside or around another one |
| `PUT /vaults/{id}` `{ salt, iters, wrapped }` | Change the password: the same data key, wrapped again |
| `POST /vaults/{id}/unlock` `{ key, minutes }` | Unlock for the AI. `minutes` is 15, 60, 480 or 0. `403 bad_key` if the key is not the one of that folder, ten wrong keys an hour |
| `POST /vaults/{id}/lock` | Forget the key now |
| `POST /vaults/{id}/open`, `DELETE /vaults/{id}` | Remove protection: the first lets the folder take plain text again while the browser decrypts each note, the second ends it and answers `409 vault_not_empty` while encrypted notes remain |
| `POST /tokens` `{ name, folder }` | Creates a token for MCP, shown once. With `folder`, the token only reaches that folder |
| `GET` / `POST /comments`, `DELETE /comments/{id}` | Comments left on a note for the AI: `{ path, quote, text }` |
| `GET /tokens`, `DELETE /tokens/{id}` | List the tokens and revoke one |
| `POST /feedback` `{ text, email?, context? }` | Mails the text to `FEEDBACK_TO`, with or without a session. 5 to 4000 characters, five an hour per IP and per account. Behind a proxy the IP is the last entry of `x-forwarded-for` |
| `POST /mcp` | MCP over Streamable HTTP, with `Authorization: Bearer mdt_...` |

MCP tools: `list_notes`, `list_folders`, `read_note`, `write_note`, `append_note`, `search_notes`, `list_comments`, `resolve_comment`.

A comment is how the user points the AI at a passage: it stays open until the AI reads it with `list_comments`, makes the change and calls `resolve_comment`. The server cannot wake an AI client up; the client reads the open comments when it is asked to, or on its own schedule.

Connecting Claude Code:

```
claude mcp add --transport http sharpmd https://sync.example.com/mcp --header "Authorization: Bearer mdt_..."
```

## Tests

```
cd ../tests
node server.mjs
node cloud.mjs
node vault.mjs
node vaultapp.mjs
```
