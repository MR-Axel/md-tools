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
| `WEBHOOK_ALLOW_PRIVATE` | `1` lets outgoing webhooks go to `http:` and to private addresses. Only for tests, or for a server of your own inside a network you trust: with it, anyone with an account can make the server call internal addresses | off |
| `WEBHOOK_RETRY_MS` | Waits between delivery attempts of a webhook, in milliseconds, separated by commas | `60000,300000,900000,2400000` (5 attempts in an hour) |
| `WEBHOOK_MAX_FAILS` | Failed attempts in a row that turn a webhook off | `15` |
| `WEBHOOK_TIMEOUT_MS` | How long a delivery waits for the answer | `8000` |
| `AI_SEEN_MS` | How long an AI is shown as present in a note after reading it with a token, in milliseconds | `60000` |
| `AI_WROTE_MS` | The same after writing it | `120000` |
| `AI_WRITING_MS` | How long it is shown as writing after a save | `10000` |
| `WEBHOOK_UPDATE_WAIT_MS` | How long `note.updated` waits to join the saves of one note into one event | `10000` |
| `API_PER_MINUTE` | Requests per minute of each token on `/api/v1` | `120` |
| `INBOX_PER_MINUTE` | Requests per minute of each inbound address | `60` |
| `DATA_DIR` | Folder for the database | `./data` |
| `PUBLIC_URL` | Public address, shown to the user when connecting an AI | `http://localhost:PORT` |
| `ALLOW_ORIGINS` | Web origins allowed to call the API, comma separated. Browser extensions are always allowed | none |
| `RESEND_API_KEY`, `MAIL_FROM` | Send the sign-in code through Resend | |
| `MAIL_WEBHOOK` | Or post `{ to, subject, text, html }` to your own mailer | |
| `FREE_NOTES` | Notes on the free plan | `10` |
| `API_FREE` | `1` opens the API and the automations on the free plan too. MCP is on every plan and needs no switch. `MCP_FREE`, the older name, does the same | off |
| `LANDING_PER_HOUR` | Notices the home page may send per IP in an hour (`POST /landing`) | `60` |
| `ADMIN_KEY` | Key for `POST /admin/plan`, `POST /admin/team`, `/admin/gallery`, `/admin/sites` and `GET /admin/landing`. It also signs the review links of the community gallery: without it the gallery takes no contributions | off |
| `TEST_LOGIN` | `email:123456`. That one account signs in with the fixed code and gets no email. For store reviewers | off |
| `CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY` | Payment links the app shows in Settings → Plan. The account email is appended as `email=`, and the app adds `back=` with the address to return to | |
| `PADDLE_WEBHOOK_SECRET` | Turns on `POST /paddle/webhook`: Paddle subscription events switch the plan | off |
| `PORTAL_URL` | Where a subscriber manages the subscription | |
| `PADDLE_TEAM_BASE`, `PADDLE_TEAM_SEAT`, `PADDLE_API_KEY`, `CHECKOUT_TEAM` | The team plan: see "Teams" below | off |
| `FEEDBACK_TO` | Address that receives what people send from "Send feedback" (`POST /feedback`). It goes out through the same mailer as the sign-in code. Without it the endpoint answers 404 and the app offers a `mailto:` link instead | off |
| `GALLERY_NOTIFY_URL` | Optional hook for the community gallery: every new contribution posts `{ "text": "..." }` there, one short line with the type and the name, no links and no addresses. Point it at anything that takes a JSON POST | off |
| `AUTH_PER_IP` | Sign-in codes one IP address may request per hour. Each email is also limited to 5 codes an hour and 15 a day, and wrong codes to 10 an hour per email and 30 per IP. Behind a proxy the IP is the last entry of `x-forwarded-for`: check that your proxy sets it, or every visitor shares one allowance | `20` |
| `PAGES_URL` | Origin of the second host that serves published sites, for example `https://pages.example.com`: only the origin, and a different host name than `PUBLIC_URL`. Without it publishing is off and the app does not offer it. See "Published sites" | off |
| `PAGES_PER_ACCOUNT` | Published sites per paid account, and per team space | `1` |
| `PAGES_GRACE_DAYS` | Days a site stays up after its account leaves the paid plan | `7` |
| `PAGES_MAX_PAGES`, `PAGES_MAX_MB` | Pages per site, and megabytes of stored HTML per site | `300`, `40` |
| `PAGES_NEW_DAY`, `PAGES_PUTS_HOUR` | Sites one account may create per day, and pages one site may upload per hour | `3`, `1200` |
| `PAGES_GRACE_MS` | Tests only: the grace period in milliseconds. Leave it alone in production | |
| `DATA_KEY` | 32 bytes in base64. Turns on encryption at rest: see below | off |
| `FILE_MAX_FREE_MB`, `FILE_MAX_PAID_MB` | Megabytes one attached image may weigh, an animated GIF included, on the free plan and on the paid one. See "Attached images" | `5`, `10` |
| `FILES_FREE_MB`, `FILES_PAID_MB` | Megabytes of attached images per free account and per paid account. With `0` the free plan does not upload | `0`, `1024` |
| `FILES_TEAM_SEAT_MB`, `FILES_TEAM_MB` | Megabytes each member adds to the shared pool of a team space, and a fixed base on top of it if you want one | `2048`, `0` |
| `FILE_UPLOAD_KBPS` | Slowest upload accepted, in KB per second. An upload gets the time its limit takes at that speed instead of the minute every other request has | `32` |
| `FILES_GRACE_DAYS` | Days an image that no note uses waits before it is deleted | `30` |
| `FILES_PER_HOUR`, `FILES_GETS_MINUTE` | Uploads per hour and account, and image requests per minute and IP | `300`, `600` |
| `FILES_SWEEP_MS`, `FILES_FRESH_MS`, `FILES_GRACE_MS` | Tests only: how often the cleanup runs, how long a new image may wait to appear in a note, and the grace period in milliseconds. Leave them alone in production | |
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

Email, notes with who made their last save (the number of the account or of the token, or the name a guest of a live session chose; never an email), their previous versions (paid plan, 30 days) with who had written each one, deleted notes while they are in the trash (30 days), and hashes of sign-in codes, sessions and tokens. Sessions and tokens are stored hashed: the server cannot show a token again after creating it. Of a live session it stores the note, the name chosen by whoever opened it, the hash of the link's secret and, on a team note, the member who opened it; the guests live in memory only (see "Live sessions"). Of a team it stores its name, the accounts that belong to it, the invitations that are waiting (the invited email address, until it is accepted, declined or removed) the id of the subscription that pays for it, the role of each member, the policies its administrators set and, for 90 days, an activity log of its shared space: who did what and when, with the path of the note, never its text, and the name a guest of a live session chose when what they wrote was saved or they were removed (see "Teams").

Of a contribution to the community gallery it stores the type, the name, the description, the language, the public name its sender chose, the content, the account that sent it, its state and how many times it was added (a number, not who). See "Community gallery".

Of a published site it stores the account it belongs to (its number, never the email address), the folder, the address, its settings (title, description, language, color, font, text logo, author name and its two switches), a preview key, how many times it was reported and, of each page, the path of the note, its address, its title and description, the HTML that is served, its text for the search and the revision of the note it was made from. That content is public: it is not encrypted at rest. See "Published sites".

Of an attached image it stores the file itself, under `DATA_DIR/files/`, and a row with the account or team space it belongs to, who uploaded it, its type, size, hash and date, and whether it arrived encrypted. Never the name the file had: the app removes the metadata of a photo (camera, date, location) before uploading, unless the person chose to keep the original. `DATA_KEY` does not cover these files. See "Attached images".

Of an automation it stores the destination address and the signing secret (encrypted with `DATA_KEY` when it is set), what it watches and which events. Of each delivery, the type of event, the path of the note, the result, the response code and the duration, for the last 50 deliveries of each webhook and up to 30 days: the body that was sent is deleted once it is delivered or given up. Of an inbound address, a hash of its secret, its last four characters, how many times it was used and when.

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
- A deleted note of a protected folder goes to the trash as it was, encrypted. Protecting a folder deletes what the trash held of it in plain text, and removing the protection deletes what it held encrypted.
- `POST /vaults/{id}/destroy` deletes a protected folder without its key, for someone who lost both the password and the backup key: the folder, its notes, their history and what the trash held of them. None of it goes to the trash, since nobody could read it.

### MCP and "unlock for the AI"

The MCP tools do not see the content of a locked folder. `list_notes` and `list_folders` show that it exists, with `protected: true` and `locked: true`. `read_note`, `write_note` and `append_note` answer with a message written for the AI: the folder is protected with a password and the person can unlock it for the AI from SharpMD. `search_notes` skips its content and says which folders were left out.

The user can unlock a folder for the AI from the app, for 15 minutes, 1 hour, 8 hours or until it is locked again. The browser then sends the data key. The server checks it against the stored check value, derives the encryption key, and keeps that key in memory only, with its expiry. While it is there, the MCP tools read by decrypting and write by encrypting in the same format the browser uses. Locking by hand, the time running out or restarting the server forgets the key. It is never written to the database or to the log. Unlocking is part of MCP, so it works on every plan. A token limited to a folder only benefits when the whole protected folder is inside its reach.

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
| `GET /account` | Plan, note count and limit. `plan` is what the account has now; `own_plan` what it pays for by itself (a member of a team can have `plan: "pro"` and `own_plan: "free"`); `billing` is `false` when the plan comes from a team someone else pays, and then no payment link is sent; `team` is described in "Teams" |
| `GET /notes` | List |
| `GET` / `PUT` / `DELETE /notes/{path}` | Read (`{ text, rev, updated, role }`), write `{ text, rev? }`, delete. Deleting moves the note to the trash; `?forever=1` skips it. See "Revisions" and "Trash" below |
| `DELETE /account` `{ email }` | Deletes the account of the session. See "Deleting an account" below |
| `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}`, `DELETE /trash` | List the trash, restore a note, delete one for good, empty it. See "Trash" below |
| `GET /events?path=` | Server-sent events for an open note: `presence` (who else has it open, and `ai`: the agents in it, see "Who is in a note"), `saved` (`{ by, updated, rev, edited }`), `comments`, `vault`, and `live` while a live session is open |
| `POST /rename` `{ from, to, text?, updated? }` | Rename. With a protected folder involved, `text` is the note for its new path and `updated` what the client read: `409 changed` if the note changed meanwhile |
| `GET /search?q=` | Search the text of every note outside protected folders |
| `GET /vaults` | Protected folders: `{ id, folder, salt, iters, wrapped, check, state, ai }`. `ai` is `null`, or `{ until }` while unlocked for the AI (`until: 0` means until locked) |
| `POST /vaults` `{ folder, salt, iters, wrapped, check }` | Protect a folder. `409 vault_nested` inside or around another one |
| `PUT /vaults/{id}` `{ salt, iters, wrapped }` | Change the password: the same data key, wrapped again |
| `POST /vaults/{id}/unlock` `{ key, minutes }` | Unlock for the AI. `minutes` is 15, 60, 480 or 0. `403 bad_key` if the key is not the one of that folder, ten wrong keys an hour |
| `POST /vaults/{id}/lock` | Forget the key now |
| `POST /vaults/{id}/destroy` `{ folder }` | Delete the folder and its notes without the key. `folder` has to be the exact name of the folder, or it answers `400 bad_confirm` |
| `POST /vaults/{id}/open`, `DELETE /vaults/{id}` | Remove protection: the first lets the folder take plain text again while the browser decrypts each note, the second ends it and answers `409 vault_not_empty` while encrypted notes remain |
| `POST /tokens` `{ name, folder, share }` | Creates a token for MCP, shown once. With `folder`, the token only reaches that folder. With `share: true`, it can share notes and create public links |
| `GET` / `POST /comments`, `DELETE /comments/{id}` | Comments left on a note for the AI: `{ path, quote, text }` |
| `GET /tokens`, `DELETE /tokens/{id}` | List the tokens (with `scope` and `share`) and revoke one |
| `POST /feedback` `{ text, email?, context? }` | Mails the text to `FEEDBACK_TO`, with or without a session. 5 to 4000 characters, five an hour per IP and per account. Behind a proxy the IP is the last entry of `x-forwarded-for` |
| `GET /gallery?type=&q=&lang=&sort=&page=` | Public, no session: the approved contributions. See "Community gallery" |
| `GET /gallery/{id}`, `POST /gallery/{id}/add` | Public: one approved contribution in full, and the anonymous "added" counter |
| `POST /gallery`, `GET /gallery/mine`, `DELETE /gallery/{id}` | With a session: send a contribution, see the state of your own, withdraw one |
| `GET` / `POST /gallery/review` | The page behind the signed links of the review email |
| `GET` / `POST /admin/gallery` | With `x-admin-key`: list, approve, reject, remove |
| `GET` / `POST /sites`, `GET` / `PUT` / `DELETE /sites/{id}`, `PUT /sites/{id}/pages`, `POST /sites/{id}/publish`, `POST /sites/{id}/unpublish` | With a session: publish a folder as a public site. See "Published sites" |
| `GET` / `POST /admin/sites` | With `x-admin-key`: list the published sites, suspend, restore, delete |
| `POST /landing` `{ v, e }` | Public, no session: the home page says which headline it showed (`v`: `a` or `b`) and what happened (`e`: `view` or `open`). It adds one to a counter per day, variant and event, and stores nothing else: no IP, no header, no identifier. `LANDING_PER_HOUR` per IP, counted in memory. Answers `204` |
| `GET /admin/landing?days=` | With `x-admin-key`: `{ from, to, variants: { a: { view, open, rate }, b: { view, open, rate } } }`, where `rate` is open divided by view. `days` limits it to the last days |
| `GET` / `POST /files`, `DELETE /files/{id}`, `GET /files/{id}/raw` | With a session: list the attached images with the storage in use, upload one, delete one, and download the bytes of an encrypted one. See "Attached images" |
| `GET /f/{id}` | No session: serves an attached image to whoever has its address |
| `POST /mcp` | MCP over Streamable HTTP, with `Authorization: Bearer mdt_...`. On every plan. On the free plan it works over the notes that plan holds: a tool that would add a note past `FREE_NOTES` answers with an error that says so, and the sharing tools answer that sharing is part of the paid plan |

MCP tools: `list_notes`, `list_folders`, `read_note`, `write_note`, `append_note`, `search_notes`, `list_comments`, `resolve_comment`, `move_note`, `note_history`, `get_guide`, `list_boards`, `create_board`, `add_card`, `move_card`, `update_card`, `delete_card`.

`write_note`, `append_note` and `move_note` end their answer with `Open it: <url>`, the address that opens the note in the app. It is built from `APP_URL` as `?f=cloud/<path>`, the same address the app uses, so point `APP_URL` at the app your users open. Opened without a session, the app asks to sign in and then opens the note.

`read_note` returns the Markdown as it is stored: an attached image is the address of the image, and there is no tool that uploads one. From an automated flow, images go through `POST /api/v1/files`.

`move_note` `{ from, to }` moves or renames a note inside the same space, and its history, comments, shares and public links follow it. `note_history` `{ path, version? }` lists the earlier versions of a note, or returns the text of one. Neither works inside a folder protected with a password.

Boards. The board tools are the card operations of the API (`/api/v1/boards`) under names for a model, with the same rules: the folder limit of the token, team roles and policies, protected folders, and the write goes over the revision that was read. `list_boards` `{ path }` returns each board of a note with its columns, the column of finished cards (`done_column`) and every card with its `id`, title and fields. `create_board` `{ path, title?, columns?, done? }` creates the note with a board, or adds a board at the end of a note that exists; without `columns` it gets To do, In progress, Paused and Done, with `{done=Done}` written in the board. `add_card` `{ path, title, column?, fields?, position?, board? }`, `move_card` `{ path, id, column, position? }`, `update_card` `{ path, id, title?, fields?, done? }` (a field with an empty value is removed) and `delete_card` `{ path, id }` answer with the card (`id`, `title`, `column`, `done`, `fields`), the `path` and the `url` that opens the note. Moving a card to the column of finished cards marks it as done. They produce the same card events as the API, with `actor.type: "mcp"`. A token that only reads is offered `list_boards` and not the others.

`get_guide` returns a Markdown guide for the AI: the folder structure to document a project (`README.md`, `architecture.md`, `features/`, `epics.md`, `decisions.md`, `log.md`) and the rules of its task board in `board.md` (one card per task, moved through To do, In progress, Paused and Done, with the fields `agent`, `needs` and `link`). The `instructions` of `initialize` carry a short version and tell the AI to call it once per session. The message the app copies from Settings > AI (MCP) says the same.

Sharing from an AI is a way out for the notes if the AI is fed instructions by someone else, so it is a separate permission. Five more tools exist only for a token created with `share: true` ("Can share and create links" in Settings > AI), which is off by default, cannot be added to an existing token and shows in the token list:

| Tool | What it does |
| --- | --- |
| `list_shares` `{ path? }` | Who the notes are shared with and which public links exist |
| `share_note` `{ path, email, role? }` | Shares a note, or a folder if `path` is one, with another account to `view` (default) or `edit` |
| `unshare_note` `{ path, email }` | Stops sharing it with that address |
| `create_public_link` `{ path, password? }` | Creates a read-only public link and returns its URL, once |
| `revoke_public_link` `{ id }` or `{ path }` | Revokes one link, or every link to a note |

Without the permission these tools are not in `tools/list` and calling them fails. With it, they go through the same code as `POST /shares` and `POST /links`, so the same rules and limits apply. They stay inside the folder of the token, and they do not reach folders protected with a password. On team notes they work only when the policies of the team allow it (see "Teams").

### Trash

`DELETE /notes/{path}` moves the note to the trash, where it stays for `TRASH_DAYS` days (30) and is then purged. Its public links, its shares, its comments and its live session end when it is deleted, and do not come back when it is restored.

What is in the trash is not a note. It does not count toward the limit of the free plan, and search, sharing, public links, live sessions and MCP cannot reach it. With `DATA_KEY` it is encrypted at rest like the rest. A note from a protected folder is kept as it was, encrypted in the browser; one that was still in plain text inside a protected folder is deleted without passing through the trash.

| Call | What it does |
|---|---|
| `GET /trash` | `[{ id, path, size, deleted, expires, protected }]`, newest first. No text |
| `POST /trash/{id}/restore` | Puts the note back at its path and answers `{ path, from, updated, size, rev }`. If a note already has that path it comes back under another name (`plan.md` becomes `plan (2).md`). `402 note_limit` when the free plan is full |
| `DELETE /trash/{id}` | Deletes that note for good |
| `DELETE /trash` | Empties the trash |

With `?o=` and the number of the team space, the four work on the trash of the team: any member lists it, restores from it and empties it. Any other `o` answers `403 no_access`, and an `id` from someone else's trash `404 not_found`.

A protected note that has to come back under another name cannot be renamed by the server, because its ciphertext is tied to its path. The restore answers `409 trash_rekey` with `{ path, to, text }`: the browser decrypts `text` with the old path, encrypts it for `to` and repeats the call with `{ to, text }`.

Each account keeps up to 300 notes in the trash; past that the oldest go.

### Gmail aliases

For `@gmail.com` and `@googlemail.com`, and only for those, signing in ignores the dots of the local part and whatever follows a `+`: `j.doe+notes@gmail.com`, `jdoe@gmail.com` and `jdoe@googlemail.com` are one account. The account keeps the address it was created with, and the code goes to the address the person typed. An address that matches an existing account exactly always signs in to that account, so two accounts that already existed before this rule keep working, each with its own address; a new alias of both goes to the older one. The limits on codes and on wrong codes count per mailbox, not per alias. Sharing and team invitations still match the address of the account as stored.

### Community gallery

People send templates, themes and diagram palettes; whoever runs the server approves or rejects each one; what is approved is public. A contribution is data, never code: anything outside the schema below is rejected whole (`400`), and the app checks it again before using it.

```json
{ "type": "template", "name": "Weekly review", "about": "What went well and what comes next", "lang": "en",
  "author": "Ana P.", "data": { "text": "# Weekly review {{date}}\n\n## Went well\n" } }
```

| Field | Rule |
|---|---|
| `type` | `template`, `theme` or `palette` |
| `name` | 3 to 60 characters, one line |
| `about` | Up to 160 characters, one line. May be empty |
| `lang` | Two lowercase letters: `en`, `es` |
| `author` | The public name the sender chose, 2 to 40 characters. Never an email address: an `@` is rejected |
| `data` of a `template` | `{ text }`: Markdown, up to 20 KB (`413 too_large`). `{{date}}` becomes the date when a note is created from it. The app renders it through the same sanitizer as any note |
| `data` of a `theme` | Any of `mode` (`auto`, `light`, `dark`), `accent`, `codeColor`, `paperLight`, `paperDark`, `surface`, `text`, `muted`, `border`, `link` (colors as `#rrggbb`), `font` (one of `Inter`, `System`, `Arial`, `Calibri`, `Verdana`, `Trebuchet MS`, `Georgia`, `Cambria`, `Palatino`, `Times New Roman`, `Consolas`, `Courier New`) and `diagramShape` (`round`, `square`). At least one. `paperLight` has to be a light color and `paperDark` a dark one, so the text stays readable. `surface`, `text`, `muted`, `border` and `link` need `mode` set to `light` or `dark`, and are rejected unless text, secondary text and links reach a 4.5 contrast ratio on the page and the panels. No CSS, no `url()`, no other key |
| `data` of a `palette` | `{ colors: { fill, text, border, line, second, third } }`, the six of them, each `#rrggbb` |

Errors: `bad_schema` (a key that is not in the list), `bad_type`, `bad_name`, `bad_about`, `bad_lang`, `bad_author`, `bad_data`. Names lose control characters and marks that flip the text direction, and are always shown as text.

| Call | What it does |
|---|---|
| `POST /gallery` | With a session of any plan. Stores the contribution as `pending` and answers `{ id, type, name, about, lang, author, status, reason, adds, created }`. Five a day per account (`429 too_many`), 30 kept per account (`409 gallery_full`). `404 no_route` without `ADMIN_KEY` |
| `GET /gallery/mine` | The contributions of the account with their `status`: `pending`, `approved`, `rejected` or `removed`, and the `reason` when one was written |
| `DELETE /gallery/{id}` | Withdraws one of your own, in any state. It is deleted |
| `GET /gallery` | Public. `{ items, total, page, pages, open }`, 24 per page, `sort=popular` (default, by times added) or `sort=new`. `type`, `lang` and `q` (name, description and author) filter. Each item is `{ id, type, name, about, lang, author, adds, at, data }`; a template comes with `size` instead of `data`. No account, no email. `open` says whether the server takes contributions. Cached for a minute (`cache-control: public, max-age=60`) |
| `GET /gallery/{id}` | Public. One approved contribution with its `data` |
| `POST /gallery/{id}/add` | Public. Counts that the contribution was added: once per IP and contribution a day, 60 requests an hour per IP. It stores a number, not who |
| `GET /admin/gallery?status=` | With `x-admin-key`. The contributions in that state (`pending` by default), with `data` and the `account` that sent each |
| `POST /admin/gallery` `{ id, action, reason? }` | With `x-admin-key`. `action` is `approve`, `reject` or `remove` (takes down one that was approved). The sender sees the state and the reason |

Review by email: each new contribution mails `FEEDBACK_TO` its type, name, shown author, the account that sent it, the content as text and two links, approve and reject. A link is signed with HMAC-SHA-256 keyed with `ADMIN_KEY` over the contribution, the action, the expiry (14 days) and a value kept with that contribution. Opening it (`GET /gallery/review`) only shows a page with the contribution and a button; the decision is the `POST` that button sends, so a mail reader that preloads links approves nothing. Rejecting takes an optional reason. Once decided, or withdrawn, both links stop working. Bad links are limited to 20 an hour per IP. The page has no scripts and cannot be framed. Without `FEEDBACK_TO` or a mailer the contribution still waits in `GET /admin/gallery`.

Reports go through `POST /feedback` with `report: { kind: "gallery", note, owner }`. With `DATA_KEY`, the name, description, author, content and reason of every contribution are encrypted at rest like the notes. Every route here has a request limit: 300 a minute per IP across `/gallery`.

### Published sites

A paid account can publish one cloud folder as a public website: several pages, a menu with the tree of pages, search and a theme. It is off unless `PAGES_URL` is set: without it every `/sites` route answers `404 no_route`, `GET /account` carries `pages: { enabled: false }` and the app does not offer it. That goes for a server of your own too: to publish sites from it you need a second host name.

**Two hosts, one process.** `PAGES_URL` is the origin of a second host name that reaches this same server, for example `https://pages.example.com`. It has to be only the origin, with no path, and a different host than `PUBLIC_URL`: otherwise the server does not start. The server tells the two apart by the `Host` header of each request and by nothing else (`X-Forwarded-Host` and `Forwarded` are ignored):

- On the pages host there is no API. No account route, no session, no token, no MCP, no CORS: `/account`, `/notes`, `/mcp`, `/api/v1/…`, `/admin/…` answer `404` there, and any method other than `GET` and `HEAD` answers `405`. Credentials are never read. The only thing that host writes is a report.
- On every other host no site is served, nor its stylesheet, its script, the report form or a preview.

That separation of origins is the main defense: a published page runs in an origin that shares nothing with the app or with the sync API. The app and the server use no cookies (a session is a bearer token kept by the origin of the app), so a sibling name such as `pages.example.com` next to `sync.example.com` is enough. Do not add the pages origin to `ALLOW_ORIGINS`.

Behind a proxy, point the second name at the same port. With Caddy:

```
pages.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

The proxy has to pass the `Host` header as it arrived and set `x-forwarded-for`. Caddy does both. With nginx, add `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-For $remote_addr;`. In the DNS, the pages name needs its own record (A, AAAA or CNAME) to the same machine, and its own certificate. If you put a cache in front, it has to respect `must-revalidate`: pages are served with `cache-control: public, max-age=0, must-revalidate` and an `ETag`, so unpublishing and suspending take effect at once.

**What the pages host serves.**

| Address | What it is |
|---|---|
| `/{slug}/` | The home page of the site. Without a home note it redirects to the first page |
| `/{slug}/{route}` | One page. The route is the path of the note inside the folder, without the extension, in lowercase letters, digits and hyphens |
| `/{slug}/search.json` | The search index: `[{ r, t, x }]` (route, title, text) |
| `/{slug}/sitemap.xml`, `/{slug}/robots.txt` | Per site. With "do not index" the sitemap answers `404` |
| `/~{key}/…` | The preview of a site that is not published yet, for whoever has that address. Always `noindex` |
| `/_/site.css`, `/_/site.js` | The one stylesheet and the one script of every site |
| `/_/report?s={slug}&p={route}`, `POST /_/report` | The report form and where it sends |
| `/robots.txt`, `/sitemap.xml`, `/` | Of the host: the sitemap is an index of the sites that can be indexed |

An address that does not exist answers `404`, a site that is not published (or whose grace period ended) `410`, and a suspended one `451`, each with a neutral page that says nothing about the site or its owner. An address may only carry letters, digits, hyphens, dots and slashes: anything encoded, a `..` or a double slash is a `404`.

Every response of that host carries:

```
Content-Security-Policy: default-src 'none'; script-src <PAGES_URL>/_/site.js; style-src <PAGES_URL>/_/site.css; img-src https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

No `unsafe-inline`: no inline script, no inline style and no handler runs there, whatever a page contains. `connect-src 'self'` is for the search index and the report. Sites load no analytics, set no cookies and have no forms; the light or dark choice of a visitor is kept in their browser.

**What is stored.** The server cannot turn Markdown into HTML, so each page is rendered in the browser of whoever publishes, through the same path as the HTML export, with formulas as MathML and diagrams already drawn. Only the body of the note travels. The server does not trust it: it reads that HTML tag by tag and writes it again from scratch (`siteClean`), keeping only an allowlist of tags and attributes and escaping every text and every value again:

- No `script`, `style`, `iframe`, `object`, `embed`, `form`, form controls, `svg`, `template`, `base`, `meta` or `link`: they go with everything inside. A tag that is not on the list is dropped and its text stays. Comments are dropped.
- No `on*` handler, no `style` attribute, no `data-*`. A text alignment written as a style becomes a class. Classes are kept only if they are the ones the reader produces (`lmd-…`, `hljs…`, footnotes); the classes and ids of the site template (`sp-…`) cannot come from the content.
- Links: `http`, `https`, `mailto`, `tel`, or a section of the same page. Anything else (`javascript:`, `data:`, `blob:`, `file:`) loses its address. A link that leaves the site gets `rel="nofollow ugc noopener"`.
- Links between notes, relative ones and `[[wikilinks]]`, are resolved when the page is served: to the page of that note if it is published in the same site, and otherwise they stay as text without a link.
- Images: `https:`, or embedded as `data:` of an image type. A diagram travels as an embedded SVG image, where nothing can run; an SVG with a script, a handler or a frame is refused anyway. An image with a path of the disk of whoever wrote the note does not exist in the cloud: its alternative text is shown instead.
- MathML: a short list of presentation elements, without `annotation`.

Of each page the server stores the path of the note, its route, title, description, that HTML, its plain text for the search (up to 8,000 characters) and the `rev` of the note it was rendered from. All of it is public, so it is not encrypted at rest with `DATA_KEY`. The `sites` table holds the number of the account, never an email address.

**What is never published.** Only notes inside the chosen folder. Never a folder protected with a password, or one inside it, or a protected team space (`409 vault`); protecting a folder that was published takes its site down and deletes what was stored. Never a note in the trash: a page is served only while its note exists, so deleting or renaming a note removes its page at once. And never a note with `publish: false` in its front matter: the server reads the note itself and refuses that page even if a client sends it.

**Routes, with the session of the account.** An MCP or API token is not accepted on them (`401`).

| Call | What it does |
|---|---|
| `GET /sites` | `{ enabled, url, max, max_pages, grace_days, sites }`. Each site is `{ id, o, team, slug, folder, url, preview, title, descr, home, lang, accent, font, logo, author, noindex, auto, live, suspended, reason, lapsed, ends, published, pages, size, can, pending }`. `pending` is `{ changed, added, removed }`, three lists of note paths: what is different from what is published. `o` is the team space, or `0` |
| `GET /sites/slug?slug=` | `{ ok: true }`, or `{ ok: false, why }` with `bad_slug`, `slug_reserved` or `slug_taken` |
| `POST /sites` `{ folder, slug, title, o?, descr?, home?, lang?, accent?, font?, logo?, author?, noindex?, auto? }` | Creates the site, not published yet. `slug` takes lowercase letters, digits and hyphens, 3 to 40, and some names are reserved. `lang` is `en` or `es`; `accent` and `font` come from the closed lists of the app (`400 bad_theme`); `author` is a name, never an email (`400 bad_author`); `home` is a note of the folder. `402 site_needs_plan`, `409 site_limit`, `409 vault`, `404 no_notes`, `429 too_many` |
| `GET /sites/{id}`, `PUT /sites/{id}` | One site, and changing its settings (the same fields, and `slug`) |
| `PUT /sites/{id}/pages` `{ pages: [{ note, rev, html, title?, descr?, order?, toc? }] }` | Uploads up to 20 rendered pages. `toc: false` leaves the page without its "On this page" list. Each `note` has to exist inside the folder, and `rev` cannot be ahead of the note. `400 bad_note`, `400 bad_rev`, `409 vault`, `409 site_full`, `413 too_large`, `413 site_too_big`. The answer says, per page, its `route`, `images_skipped`, or `excluded: true` |
| `POST /sites/{id}/publish` | Removes the pages whose note is gone or excluded and puts the site up. `409 site_empty` |
| `POST /sites/{id}/unpublish` | Deletes every stored page at once. The settings stay |
| `DELETE /sites/{id}` | Deletes the site and frees its address |

`GET /account` carries `pages`: `{ enabled, url, max, paid, grace_days, max_pages, team, sites }`, with each site in short, so the app can say that a site is suspended or about to be unpublished.

**Unpublished changes.** The server compares the `rev` stored with each page against the current one of its note, and counts new notes and removed ones too. Nothing is rendered on the server: what an AI changes over MCP, the API or an inbound address stays as a pending change until someone with the app publishes it. The app uploads only what changed, and with "publish each note when you save it" it uploads the page of a note right after saving it.

**Plan.** `PAGES_PER_ACCOUNT` sites per paid account (1). When the account leaves the paid plan the site stays up for `PAGES_GRACE_DAYS` (7) and nothing new can be published (`402`); after that it is unpublished and its pages are deleted, and the settings and the address are kept for when the plan comes back.

**Teams.** A folder of the team space can be published too, with `o`. The policy `publish`, off by default, decides whether members who are not administrators may do it; a reader never can (`403 read_only`), and administrators always can. Any member sees the site of the team. Creating, publishing and unpublishing it go to the activity log (`site`, `publish`, `unpublish`) with the folder and the address. A team space has its own allowance of `PAGES_PER_ACCOUNT` sites.

**Limits.** `PAGES_MAX_PAGES` pages per site (300), 1.5 MB of HTML per page and `PAGES_MAX_MB` per site (40), `PAGES_PUTS_HOUR` uploaded pages per site and hour (1,200), 30 publications per site and hour, `PAGES_NEW_DAY` sites created per account and day (3), 900 requests a minute per IP on the pages host and 5 reports an hour per IP.

**Abuse and takedown.** Hosting what other people publish means being able to take it down fast.

1. Every page has a "Report" link in its footer. It opens a form served by the pages host, with no third-party script, that posts `{ s, p, text, email? }` to `POST /_/report`. The report goes out through the same mailer as `POST /feedback`, to `FEEDBACK_TO`, with `report.kind: "site"` and the address of the page. It is also counted on the site, so it shows up even without a mailer.
2. Look at what was reported. The list, most recently reported first:

```
curl "https://sync.example.com/admin/sites?status=reported" -H "x-admin-key: $ADMIN_KEY"
```

   `status` is `reported`, `live`, `suspended` or nothing, and `q` searches the address, the title and the account. Each row is `{ id, slug, url, account, team, folder, title, live, suspended, reason, lapsed, pages, size, reports, reported, created, published }`.
3. Suspend it. It stops being served at once, preview included, with `451`:

```
curl -X POST https://sync.example.com/admin/sites -H "x-admin-key: $ADMIN_KEY" \
  -H "content-type: application/json" -d '{"slug":"some-site","action":"suspend","reason":"Impersonates a bank"}'
```

   The owner sees in the app that the site is suspended, with the reason, and cannot publish it, change its address or delete it while it is suspended, so the address cannot be taken again to get around it.
4. Then `"action":"restore"` puts it back as it was, or `"action":"delete"` removes the site and its pages for good. To act on the account itself, `POST /admin/plan`.

These admin routes are called on the API host, never on the pages host.

### Attached images

In a cloud note an image is not kept inside the Markdown. The app uploads it as an attachment and the note stores its address, a short line such as `![](https://sync.example.com/f/3b1f…9c.webp)`. A photo no longer makes a note pass the 1 MB limit of its text, which stays as it was.

Before uploading, the app makes the image smaller in the browser: up to 2000 px on its longest side and about 400 KB ("Normal"), or 3200 px and about 1.5 MB ("High"), as WebP where the browser can encode it and JPEG otherwise. It applies the EXIF rotation and drops the metadata, the location included. A PNG stays a PNG when recompressing does not make it smaller. Animated GIF and animated WebP are not recompressed. With "Original" the file travels untouched, metadata included, and the limits below still apply. None of this is trusted by the server.

**Who can see an image.** The address is the key. `GET /f/{id}` takes no session: the id is 160 random bits, it cannot be guessed and nothing lists it. Whoever has the address of an image can see it, exactly like a public link, and for the same reason: that is what lets the image show in a note shared with another account, in a public link, to the guests of a live session, in an exported file and in a published site, without checking permissions on every request. What follows from it:

- Sharing a note shares the addresses of its images. Someone who had access and copied an address keeps seeing that image after the access ends, until the image is deleted.
- Deleting an attachment, or the account, makes its address answer `404` at once. A browser or a proxy that already cached it may still show it: images are served as immutable for a year.
- Images of a folder protected with a password do not work this way. See below.

**What is accepted.** PNG, JPEG, GIF, WebP and AVIF, recognised by the first bytes of the file. The `Content-Type` of the upload is ignored, and so is any file name. SVG is refused: it is a document that can carry code. A PNG or a GIF with impossible dimensions and a WebP whose declared size is not its real size are refused (`415 bad_image`). The body is written to a temporary file as it arrives and the upload is cut when it passes the limit, so it is never held whole in memory. The file is stored as `DATA_DIR/files/<first two characters>/<id>`, a name the server makes; nothing sent by the client reaches a path.

**How it is served.** Only `GET` and `HEAD`, only from the API host (the pages host answers `404`), and always with:

```
Content-Type: image/png | image/jpeg | image/gif | image/webp | image/avif   (the type recognised at upload)
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Content-Disposition: inline; filename="image.<ext>"
Cross-Origin-Resource-Policy: cross-origin
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=31536000, immutable
```

No cookie is read or set, and credentials are never allowed across origins. A file that starts like an image and continues as something else is still served as that image type and nothing in it runs, even opened alone in a tab. `FILES_GETS_MINUTE` requests a minute per IP, and 60 addresses that do not exist per hour and IP before `429`.

| Call | What it does |
|---|---|
| `POST /files` | With a session. The body is the image, not JSON. Answers `{ id, url, type, size, width, height, created, encrypted, used, max }`. The same image uploaded twice to the same space is one attachment. `415 bad_image`, `413 file_too_large` (with `max` and `plan`), `413 storage_full` (with `used` and `max`), `408 upload_slow`, `429 too_many` |
| `POST /files?enc=1` | An image encrypted in the browser, for a protected folder. `409 vault` when the space has no protected folder |
| `GET /files` | `{ used, max, max_file, plan, count, stored, grace_days, files }`. Each file is `{ id, url, type, size, width, height, created, encrypted, in_use, waiting }`. `used` counts what notes use; `stored` everything that is on disk. For an encrypted image `in_use` says whether a note declared it (see below) |
| `DELETE /files/{id}` | Deletes the image now. With `?unused=1`, only if no note of that space uses it (`409 in_use`): for an encrypted one, if no note declares it |
| `PUT /files/refs` `{ path, ids }` | The app tells which encrypted images a note of a protected folder uses. Only ids travel, never content. Ids that are not encrypted images of that space are dropped; `409 vault` for a note outside a protected folder, `400 bad_ids` |
| `GET /files/{id}/raw` | The bytes of an encrypted image, for the account or the team it belongs to |

With `?o=` and the number of the team space, the same calls work on the team: any member lists, administrators and editors upload and delete (`403 read_only` for a reader), and the storage used is that of the team. Uploading and deleting go to the activity log as `attach` and `detach`.

**Folders protected with a password, and a protected team space.** The browser encrypts the image with the key of the folder before uploading it: AES-256-GCM, a random 96-bit nonce, the same key that encrypts the notes of that folder. The server stores bytes it cannot read, without type or dimensions, and never serves them on `/f/`: that address answers `404`. The app downloads them with the session (`GET /files/{id}/raw`), decrypts them in memory and shows them from there. They cannot be in a published site or behind a public link, because notes of a protected folder cannot. A protected team space refuses images that are not encrypted (`409 vault`).

Images follow their note whenever the way the note is stored changes, in the same step that encrypts or decrypts its text:

- Protecting a folder, or a team space, that already had images: for each note, each readable attachment is downloaded, encrypted with the key of the folder and uploaded, the note is saved naming the encrypted copy, and the readable copy is deleted from the server at once unless a note outside the folder uses it (then it stays for that note). It goes note by note with its progress, it can be resumed if it is interrupted, and the app does not report the folder as protected until it has finished.
- Removing the protection does the reverse: the encrypted images become ordinary attachments again and their encrypted copies are deleted.
- Rotating the key of a team space encrypts every image again with the new key and deletes the copies made with the old one.
- Moving a note into or out of a protected folder converts its images at that moment.

An attachment is recognised by its path, `/f/<id>`, whatever origin the stored address has, and only if it belongs to a space of the account: an image hosted anywhere else is left as the web address it is. What is still to delete is kept in the browser until it is done. As a last net, opening a protected note that names a readable attachment converts it then.

Since the server cannot read protected notes, the app declares what they use: after saving or opening a note of a protected folder it sends `PUT /files/refs` with the ids of the encrypted images in it.

**Limits per plan.** Checked on every upload, after the app has made the image smaller.

| | Free | Paid | Team |
|---|---|---|---|
| One image, an animated GIF included | No upload | 10 MB | 10 MB |
| Storage | Images by address | 1 GB | 2 GB per member, in one pool for the team |

The space an upload is going to take is reserved before its body is read, so uploads sent at the same time cannot pass the total together. When an account leaves the paid plan nothing is deleted and its images keep being served; it cannot upload again until it is under the limit of its plan. The members of a team keep their own allowance for their own notes.

**Slow connections.** Every other request has a minute to arrive. An upload has the time its limit takes at `FILE_UPLOAD_KBPS` (about eleven minutes for 20 MB at 32 KB per second) and is cut earlier with `408 upload_slow` if, after the first fifteen seconds, it comes in slower than that on average, or if nothing arrives for twenty seconds. A connection cannot be held open by sending a byte now and then.

**Cleanup.** Every six hours the server reads which images are named in a note, in a version of the history or in a note in the trash, across the whole server (a note moved to another space still names the image of the first). An image nobody names for an hour is marked: it stops counting as storage in use and, after `FILES_GRACE_DAYS` (30), it is deleted from the disk. Named again before that, it is kept. What waits to be deleted cannot pass the limit of its space: if it does, the oldest go first. Deleting an account deletes its images. Moving, renaming or copying a note changes nothing, since the note carries the addresses. If a row cannot be read (a wrong `DATA_KEY`), the cleanup deletes nothing. Encrypted images go through the same cleanup with what the app declared instead of what the server reads: one that no note declares is marked and deleted after the same `FILES_GRACE_DAYS`. A note that stops using an image keeps it declared while a version of its history could still name it (30 days, or the history of the team space), and a deleted note while it is in the trash.

**Older notes.** A note that carries images embedded as `data:` keeps working. The app offers "Move embedded images to attachments" in the menu of the note and in Settings > Cloud, and does it by itself when a note from the browser is sent to the cloud.

**Running it.** `DATA_DIR/files/` is data, like the database: put it in the backup, and restore the two together. A database restored without its files shows notes with missing images; files without their rows are deleted by the next cleanup. Plan the disk for it: the worst case is the sum of the limits of the accounts (100 MB per free account, 5 GB per paid one and 10 GB per team member by default: lower them with the variables above if the disk is smaller), twice over while deleted images wait out their grace period. These files are not encrypted with `DATA_KEY`: the readable ones are reachable by address anyway, and the ones of protected folders are already encrypted by the browser. If you put a cache or a CDN in front, it may keep an image after it was deleted. Do not serve `/f/` from the pages host.

### Deleting an account

`DELETE /account` with the session and `{ email }`, the email of that same account, deletes it: its notes, version history, trash, attached images, comments, contributions to the community gallery, tokens, sessions, shares in both directions, public links, published sites, protected folders, live sessions, pending team invitations to that email and the record of its ended subscriptions. Open connections are closed. Five requests an hour per IP and per account.

It refuses while money is still being charged, with `409` and a `manage` field holding `PORTAL_URL`:

- `subscription_active`: the account has an active subscription of its own.
- `team_billing_active`: it manages a team whose subscription is active.
- `team_has_members`: it manages a team that still has other members. Alone in its team, the team and the notes of its space are deleted with the account.

A member of a team leaves the team; the notes of the team stay with the team. `400 bad_confirm` when the email is not the one of the account.

### Who is in a note, and who edited it last

People. Every account that has a note open (`GET /events`) receives `who` (emails) and `names` (visible names) of the others, as before. Only someone who can read the note can listen to it.

AI. An agent that reads or writes a note with a token (`mdt_...`, personal or of a team; over MCP or the REST API) counts as present in that note for `AI_SEEN_MS` after its last read and `AI_WROTE_MS` after its last write. The same events carry `ai: [{ kind: "ai", id, token, client, writing }]`: `token` is the name of the token, `client` is what the MCP client said in `initialize` (`clientInfo.name`, empty if it said nothing or came through the REST API), and `writing` is true for `AI_WRITING_MS` after a save. `id` is a number made up for the occasion, not the token's. This lives in memory only. The guests of a live session receive the same list in their `live` events.

Last edit. `GET /notes/{path}` carries `edited`: `{ kind, name }` for whoever made the last save, or `null` for a note saved before this was recorded (the app then shows only `updated`). `kind` is `user` (`name` is the visible name of the account), `ai` (`name` is the name of the token, empty once the token is revoked) or `guest` (the name a guest of a live session chose; empty for an account that only has the note shared with it, which is not part of the session). The `saved` event carries the same `edited`, and `GET /versions/{path}` gives each version the `edited` of whoever had written it. A guest of a live session gets it in `GET /live/note` and in `saved`, where an account that has not chosen a visible name comes with an empty `name`: nothing taken from an email reaches a guest. The database stores `u:12`, `t:5` or `g:Name` in `notes.by` and `versions.by`; the name is looked up on reading. None of this is added to webhooks or to the REST API.

### Revisions

Every note has a revision number, `rev`. It starts at 1 and goes up by one with each save. `GET /notes/{path}` returns it, and so does a successful `PUT`.

- `PUT { text, rev }` saves only if `rev` is the current revision of the note. If someone saved in between, nothing is written and the answer is `409 rev_conflict` with the current `text`, `rev` and `updated`. The client merges and tries again over the new revision. The app merges by lines and, where both sides touched the same lines, keeps the saved text and puts the local one aside.
- `PUT { text }` without `rev` saves as before, overwriting. That keeps an extension that has not been updated working. A note that does not exist yet is created either way.
- `rev` must be a whole number, zero or more: anything else answers `400 bad_rev`.
- `write_note` and `append_note` save over the revision that is current at that instant, in one step, so an AI never overwrites a save that came in between and never appends to an old text. Both are announced on `/events`, with `by: "mcp"`.

### Live sessions

The owner of a note, on the paid plan (or with `LIVE_FREE=1`), opens a live session on it and hands out a link. Whoever has the link joins without an account and gets a pass that works only for that note and only while the session is open.

On a note of a team space the routes take `o` (the team space, as everywhere else) and the session belongs to the note of the space, with the member who opened it on record. See "Live sessions on team notes" below.

| Call | What it does |
|---|---|
| `POST /live` `{ path, name, o }` | Opens the session on a note of the account (or of the team space, with `o`) and returns `{ secret, open, name, created, max, people }`. `name` is what guests see instead of the email. The secret is returned once: only its hash is stored. If the session was already open it answers without `secret`. `402 live_needs_plan`, `409 live_vault` for a note in a protected folder or a protected team space, `403 team_policy` or `read_only` and `429 live_team_max` on a team note |
| `GET /live?path=&o=` | `{ open: false }`, or the session: `{ open, name, created, max, people }`. On a team note also `team: true`, `you` (the caller's id in `people`) and `can` (whether the caller manages it) |
| `DELETE /live?path=` | Ends the session. Every pass stops working at once |
| `POST /live/rotate` `{ path }` | New secret. The old link stops working; the people inside stay |
| `POST /live/kick` `{ path, id }` | Removes a guest (`id` as in `people`, for example `g3`). Their pass and re-entry key die at once, and the secret changes so they cannot come back with the same link. Returns the session with the new `secret` |
| `POST /live/look` `{ secret }` | Before joining: `{ by, note, people, full }`. `404 live_gone` for a wrong secret and for a session that ended, with no way to tell them apart. Twenty wrong secrets an hour per IP |
| `POST /live/join` `{ secret, name }` | Returns `{ pass, ticket, you, name, color, by, max, note: { name, text, rev, updated }, people }`. `429 live_full` when the session is full. With `{ ticket, name }` instead of the secret, someone who had already joined comes back after losing the pass, even if the link changed |
| `GET /live/note` | With `Authorization: Bearer mdl_...` (the pass): `{ name, text, rev, updated }` |
| `PUT /live/note` `{ text, rev }` | A guest always saves over a revision: `400 rev_required` without it, `409 rev_conflict` like any other save. 300 saves a minute per guest |
| `GET /live/events` | Server-sent events for the guest: `live` and `saved`, nothing else |
| `POST /live/presence` `{ block, editing }` | Where the caller is. A guest sends it with the pass; the owner with the account session and `path`. `block` is a short mark of letters, digits, dots, dashes and colons (the app sends a fingerprint of the block and its lines; the text never travels here). Forty every ten seconds per person, then `429 presence_rate`. If someone else is already writing in that block the answer carries `held` with their id |
| `POST /live/leave` | The guest leaves: pass and re-entry key are deleted |

`people` is `[{ id, name, color, block, editing, here }]`. `id` is `o` for whoever opened the session, `g1`, `g2`... for guests and, on a team note, `m1`, `m2`... for the other members of the team who have the note open (with `member: true`, and an empty `name` when the account has not chosen a visible name: the address is never sent); `color` is a number the server assigns. Nobody can speak for someone else: presence is always attributed to the pass or session that sent it, and names cannot be changed by another participant. A name is trimmed to 40 characters and loses control characters and invisible direction marks; it is otherwise stored as typed, so a client must always show it as text, never as HTML.

While a session is open, the `saved` event sent to its members (the owner and the guests) carries the change itself, so they apply it without another request: `text` with the whole note, or, when the note is over 4000 characters, `base` and `patch: { at, del, lines }` (from line `at`, remove `del` lines and put `lines`, over revision `base`). `pid` says who saved. An event for a guest never carries an email. Roster changes are batched: at most one `live` event every 120 ms per session.

What a pass cannot do: list or read any other note, see the history, share, create links or tokens, use MCP, reach anything else of a team, or call any route outside `/live/`. Guests are kept in memory only (name, color, pass hash); re-entry keys are stored as hashes in the `live_tickets` table and deleted with the session. A guest with no connection and no requests for two minutes gives up the place and can come back with the re-entry key.

A session ends when the owner ends it, after 12 hours with nobody connected, when the note is deleted, renamed or moved, when its folder gets a password, or when the account leaves the paid plan.

| Variable | What it does | Default |
|---|---|---|
| `LIVE_FREE` | `1` lets the free plan open live sessions too | off |
| `LIVE_PEOPLE` | People per session, counting whoever opened it | `12` |
| `LIVE_IDLE_MS` | How long a session with nobody connected lasts | 12 hours |
| `LIVE_GUEST_MS` | How long a guest with no connection keeps the place | 2 minutes |

The connection limits of `/events` apply to `/live/events` too: 60 open connections per IP, and 4 per guest. Behind a proxy, make sure it does not buffer event streams (the server sends `x-accel-buffering: no`) and that it lets them stay open.

#### Live sessions on team notes

A member who can edit opens a live session on a note of the team space and invites people from outside with the link. Administrators always can; editors when the `live` policy is on (it is off by default); readers never. The `lives` table keeps whose note it is (`owner`, the team space) and who opened it (`opener`, empty on a personal note).

- Every route checks membership, role and policy on each request. `POST /live` with `o`: `403 read_only` for a reader, `403 team_policy` without the policy, `409 live_vault` in a team space protected with a password (a guest does not have the key), `429 live_team_max` over 10 open sessions per team. Opening, rotating, removing and ending share a limit of 120 an hour per team.
- The other members do not join: with the note open (`GET /events?path=&o=`) they receive the `live` events, each with its own `you` and `can`, and the `saved` events with the change inside. They save with `PUT /notes/{path}?o=` over a revision, as always, and say where they are with `POST /live/presence` `{ path, o, block, editing }`. A reader is shown on a block and never holds it. Members do not take the place of a guest.
- `GET /live?path=&o=` answers any member. Rotating the link, removing a guest and ending the session are for whoever opened it and for any administrator: `403 not_opener` for another editor, `403 read_only` for a reader. Only guests can be removed.
- The session ends by itself when whoever opened it stops being allowed: they become a reader, leave the team or delete their account, the policy is turned off (for a session opened by someone who is not an administrator), the team stops being paid, or the space is protected with a password. The guests' passes die in that same request.
- A guest's pass reaches that one note of the space and nothing else of the team: not its other notes, its trash, its history, its members, its policies, its log or its tokens.
- In the activity log: `live_open`, `live_end` and `live_kick` (with the name of the guest in `detail`). What a guest saves is an `edit` entry with `via: guest` and the name the guest chose in `token`. A session that ended by itself is a `live_end` entry with `via: auto`.

### Teams

One account pays for a team. It is an administrator of the team, always, and it takes one of the seats. Everyone else joins with their usual account by accepting an invitation sent to the email they sign in with. Nobody is added without accepting. While the team is paid, every member has the paid plan. A person is in one team at a time.

Roles. Every member has one of three roles, chosen when inviting and changed later:

| Role | What it does |
|---|---|
| `admin` | Invites and removes people, changes roles, sets the team policies, creates team tokens and reads the activity log. The account that pays is an administrator and nobody can change its role or remove it. It can name other administrators: they manage people and settings, not the billing |
| `editor` | Reads and writes in the team space |
| `reader` | Reads the team space. Every route that changes something there answers `403 read_only` |

All three take a seat, the reader too. Members that existed before roles are editors.

Three levels of settings. Personal settings (appearance, fonts, language, tools, reading and editing preferences) live in each person's browser: the server never sees them and no administrator can set them. Team settings are the policies below: an administrator decides them, they apply to the team space, and the server checks them on every request. Billing is only for the account that pays: `GET /account` carries `billing: false` for a member of a paid team that someone else pays, with empty `checkout` links, `team.enabled: false`, an empty `team.checkout` and no `seats`, `used` or `billing` in `team.mine`. The app shows that member their team and their role, and nothing about plans or prices.

| Call | What it does |
|---|---|
| `GET /team` | The same `team` object that `GET /account` carries: `{ enabled, checkout, included, max, mine, invites }`. `mine` is `null` or `{ id, name, role, owner, active, space, members, solo, vault, policies, can, history_days, history_max, history_choices }`. `role` is `admin`, `editor` or `reader`; `owner` is `true` for the account that pays; `members` are `{ id, email, role, admin, owner }`; `can` says what this account may do in the space (`write`, `share`, `links`, `live`, `tokens`, `automation`, `publish`). Administrators also get `seats`, `used`, `pending` (each with its `role`) and `log_days`, and the account that pays gets `billing`. `vault` is `null`, or the protection of the team space as `GET /team/vault` returns it. `invites` are the invitations waiting for this account: `{ id, name, by }` |
| `PUT /team` `{ name }` | Administrator: the name of the team, up to 40 characters |
| `POST /team/invite` `{ email, role, lang }` | Administrator: invites that address and mails it, in English or with `lang: "es"` in Spanish. `role` is `admin`, `editor` (the default) or `reader`: `400 bad_role` for anything else. Inviting an address again changes the role of its invitation. `409 team_full` when members plus pending invitations fill the seats, `409 already_member`, `400 own_email`. Limits: `429 invite_day` (per team and day, `TEAM_INVITES_DAY`) and `429 invite_mail_day` (three a day per address, across all teams). The answer and the email are the same whether or not that address has an account |
| `DELETE /team/invites/{id}` | Administrator: removes a pending invitation |
| `POST /team/accept` `{ id }`, `POST /team/decline` `{ id }` | The invited account answers. Only the account whose email was invited can accept. `409 in_team` if it already belongs to a team |
| `POST /team/remove` `{ id }` | Administrator: removes a member (`id` as in `members`). `409 owner_stays` for the account that pays |
| `POST /team/role` `{ id, role }` | Administrator: changes the role of a member. `400 bad_role`, `404 not_found` for an account outside the team, `409 owner_stays` for the account that pays. The open connections of that member to team notes are closed, so they come back with the new role |
| `POST /team/leave` | A member leaves. The account that pays cannot: `409 owner_stays` |
| `GET /team/policies` | Any member: `{ policies, can, history_days, history_max }` |
| `PUT /team/policies` `{ share, links, live, tokens, automation, publish, history_days, folder, template }` | Administrator: changes the policies sent, see below. `400 bad_policy` |
| `GET /team/log` | Administrator: the activity log, see below |
| `GET /team/tokens`, `POST /team/tokens` `{ name, folder, write, share }`, `DELETE /team/tokens/{id}` | Administrator: team tokens, see below |
| `POST /team/seats` `{ seats }` | The account that pays (`403 not_owner` for another administrator): changes the subscription in Paddle and then the seats. `409 seats_in_use` below the seats in use, `400 bad_seats`, `502 billing_failed` if Paddle refuses, `409 no_billing` for a team made by hand |

The team space. The notes of a team belong to the team, not to a person: they stay when someone leaves. They are stored under an internal account of the team (its email is `team:...`, which is not an address: nobody can sign in as it or share with it), so they get revisions, history, events and encryption at rest exactly like any other note. `mine.space` is the number of that account, and a member reaches the team notes with `o=`: `GET /notes?o=`, `GET` / `PUT` / `DELETE /notes/{path}?o=`, `GET /events?path=&o=`, `GET /search?q=&o=`, `GET /versions/{path}?o=`, `GET /version/{id}?o=`, and `POST /rename` with `o` in the body. Administrators and editors read, edit, move and delete. A reader reads: `GET /notes/{path}?o=` answers with `role: "view"`, `GET /events`, `GET /search`, the versions and the list of the trash work, and `PUT`, `DELETE`, `POST /rename`, restoring from the trash, deleting from it and emptying it answer `403 read_only`. Anyone else gets `403 no_access`. A member cannot read anything personal of another member.

Team policies. What an administrator decides for the space, stored with the team and checked by one function, `teamAllows(team, user, what)`, on every route. Administrators are always allowed. A reader is only ever allowed `tokens`.

| Policy | Default | What it decides for members who are not administrators |
|---|---|---|
| `share` | off | Sharing a team note or folder with an account outside the team: `POST /shares` with `o` in the body, `GET /shares?o=`, `DELETE /shares/{id}?o=` and the MCP tools `share_note` and `unshare_note` on `@team/` paths |
| `links` | off | Public links to team notes: `POST /links` with `o`, `DELETE /links/{id}?o=`, and `create_public_link` and `revoke_public_link` |
| `tokens` | on | Whether the AI of a member reaches the team space. Off, the tokens of members stop seeing `@team/` at once, and a path there answers with a message for the AI |
| `automation` | off | Using automations on the team space. Whatever runs an automation asks `teamAllows(team, user, 'automation')` first |
| `publish` | off | Publishing a folder of the team space as a public site: `POST /sites` with `o`, and every route of that site. See "Published sites" |
| `live` | off | Opening a live session with guests on a team note. Turning it off ends the sessions opened by members who are not administrators |
| `history_days` | `0` | How long the version history of the space is kept: `30`, `90`, `180` or `365`, never more than `TEAM_HISTORY_DAYS`. `0` is the longest the server allows. Shortening it deletes the older versions right away |
| `folder` | empty | The folder where the app puts a note created at the top of the team space |
| `template` | empty | The text a new team note starts with, up to 20,000 characters. It is stored on the server, encrypted at rest with `DATA_KEY` like a note, and readable by the server: a protected space has no template (`409 vault`), and protecting a space clears it |

What goes out of the team. With `share` or `links` allowed, a team note is shared or linked exactly like a personal one, with `o` naming the space. The account it is shared with sees the name of the team as the sender, never the internal account. A team note cannot be shared with someone who is already in the team (`409 already_member`), and the whole space cannot be shared. A protected space has no sharing and no links. Who a team note is shared with is visible to administrators and editors. Refusals are `403 team_policy`, or `403 read_only` for a reader.

The activity log. For administrators: who did what in the team space and when. Each entry is `{ id, at, who, uid, via, token, action, path, about, detail }`. `via` is empty from the app, `ai` with the token of a person, `team` with a team token (`token` is the name of that token), `guest` for a guest of a live session (`token` is the name the guest chose) and `auto` for what the server did by itself. Actions: `create`, `edit`, `move`, `delete`, `restore`, `purge`, `empty_trash`, `share`, `unshare`, `link`, `unlink`, `invite`, `uninvite`, `join`, `leave`, `remove`, `role`, `policy`, `team_name`, `protect`, `password`, `rotate`, `rotate_done`, `unprotect`, `destroy`, `ai`, `ai_unlock`, `token_create`, `token_revoke`, `automation`, `automation_remove`, `site`, `publish`, `unpublish`, `live_open`, `live_end`, `live_kick`.

- It never stores the text of a note. It stores the path, the action, the account and the time. `detail` holds a role, the name of a policy with its new value, the new path of a move, the name of a token or the name of a guest who was removed from a live session.
- It stores no email address. Of the person who acted it stores the account number, and the address is looked up when the log is read: an account that was deleted shows empty. The address a note was shared with and the address that was invited are not written. A guest of a live session has no account: the log keeps the name they chose.
- Several saves of one note by the same account within ten minutes are one `edit` entry. An AI reaching the space is one `ai` entry per token and hour.
- With a protected space, the paths of the notes are in the log as they are everywhere else: names are not encrypted.
- `GET /team/log` takes `who` (account number), `token` (name), `action`, `from` and `to` (milliseconds) and `before` (an entry id, to continue): `{ entries, more, days }`, 100 entries a page, newest first. With `format=csv` it answers `{ csv, days }` with up to 5,000 rows and the same filters; cells that start like a formula are neutralised.
- Entries older than `TEAM_LOG_DAYS` (90) are not returned and are deleted. Nobody can edit or delete entries. The log is deleted with the team.

Team tokens. A token that belongs to the team, not to a person: for an AI or a service that works for the team. An administrator creates it with a name, an optional folder, and the permissions to write and to share (reading is always there; sharing needs writing). It is shown once and stored hashed. It keeps working when the person who created it leaves. `POST /mcp` with it works on the team space as its root, with plain paths and no `@team/` prefix, and reaches nothing of any person. It is not a session: every other route answers `401`. It respects the policies as an editor or a reader would (`share` and `links`), and it cannot open a protected space, because the key of a protected space is unlocked per person. In the activity log its entries carry its name. At most 30 per team. When the subscription of the team ends it answers `402` until the team is paid again.

History. In the team space the version history is kept for `TEAM_HISTORY_DAYS` (365), or less if the `history_days` policy says so. Personal notes keep 30 days. `GET /versions/{path}?o=` returns up to 500 versions.

What the team space does not have in this version: comments for the AI. That route works on the caller's own notes. A member cannot protect a folder inside the team space: `/vaults` only works on the caller's own notes. The whole space can be protected by its administrator, see below. Until then, text that starts with `vault1:` is refused there with `409 vault_text`.

Protecting the team space. The administrator can protect the whole team space with one password. It is not per folder, and members cannot add passwords of their own, so nobody can lock the rest of the team out. It is a protected folder like the ones above: the same data key, the same wrapping with the password, the same backup key and the same `vault1:` format, stored as one more row of the same table under the internal account of the team. The only difference in the encryption is the associated data of each note, which is `~{space}/{path}` instead of the bare path, so a ciphertext of a team note does not open as a personal note or in another team. Members receive the password from the administrator, outside the app. Anyone who knows it can unwrap the data key in their browser, read and write.

| Call | Who | What it does |
|---|---|---|
| `GET /team/vault` | Any member | `{ vault }`: `null`, or `{ id, team, admin, salt, iters, wrapped, check, state, ai, ai_members }`. The administrator also gets `gone` (when a member last left since the password changed, or `0`) and, while a rotation is running, `next` |
| `POST /team/vault` `{ salt, iters, wrapped, check }` | Administrator | Protects the space. `409 vault_exists`. Deletes the plain-text history and trash of the space |
| `PUT /team/vault` `{ salt, iters, wrapped }` | Administrator | Changes the password: the same data key, wrapped again. The notes are not touched. Clears `gone` |
| `POST /team/vault/rotate` `{ salt, iters, wrapped, check }` | Administrator | Starts a key rotation with a new data key, already wrapped with a new password. `state` becomes `rotating` |
| `POST /team/vault/rotate/done` | Administrator | Ends it: the new key replaces the old one, and the history and trash encrypted with the old key are deleted |
| `POST /team/vault/open`, `DELETE /team/vault` | Administrator | Remove the protection, as for a folder: `409 vault_not_empty` while encrypted notes remain |
| `POST /team/vault/destroy` `{ name }` | Administrator | Deletes every note of the space, their history and trash, and the protection, without the key. `name` has to be the exact name of the team, or the administrator's email if the team has no name: `400 bad_confirm` |
| `PUT /team/vault/ai` `{ members }` | Administrator | Whether members may unlock the space for their AI. Off by default. Turning it off forgets the keys members had unlocked |
| `DELETE /team/vault/gone` | Administrator | Dismisses the notice that a member left |
| `POST /team/vault/unlock` `{ key, minutes }`, `POST /team/vault/lock` | Administrator, or a member when `ai_members` is on (`403 ai_not_allowed` otherwise) | Unlock for the caller's own AI, with the same times and limits as a folder |

In this table "Administrator" is the account that pays for the team: it holds the backup key, and a key rotation is done by one browser. Another administrator gets `403 not_owner` on those routes and counts as a member for `ai_members`.

Every route checks membership and role on the server: `404 no_team` for an account that is not in a team, `403 not_admin` for a member on an administrator route, `401` without a session (an MCP token is not a session). The administrator routes share a limit of 40 changes an hour per team. The server stores the salt, the rounds, the wrapped key and the check value. It never receives the password or the data key, except in `unlock`. With `DATA_KEY`, encryption at rest is applied on top, as for any note.

What the server enforces in a protected space: only text that starts with `vault1:` is accepted, from any member (`409 vault`). `GET /search?o=` returns nothing from it. History and trash hold ciphertext. `POST /rename` with `o` needs `text` for the new path. The names of notes and folders are not encrypted. `GET /notes?o=` adds `v: 1` to the notes that are already encrypted, so the browser of the administrator knows which ones are left after protecting a space that had notes. `GET /events` sends `vault` to the members who have a team note open whenever the protection changes.

MCP on a protected space. `@team/` notes are listed with `protected: true` and `locked: true`, and reading, writing and searching them answers with a message for the AI. `unlock` keeps the encryption key in memory for the account that sent it, not for the team: one member unlocking does not open the space for the tokens of the others. The token has to reach the whole `@team`. `move_note` and `note_history` do not work on a protected space.

Key rotation. While `state` is `rotating`, the browser of the administrator reads each note with the old key and saves it with the new one. Other members cannot save, rename or restore (`423 vault_rotating`), so nothing new is written with the old key, and nobody can unlock for the AI. If it stops halfway it stays in `rotating` and the administrator resumes it with both passwords. The new key has a new backup key.

When a member leaves or is removed, their AI key is forgotten at once, they stop receiving the wrapped key and the notes, and `gone` is set so the app tells the administrator, with two actions. Changing the password stops someone who only knew the password: the server no longer hands out a wrapped key that opens with it. Rotating the key covers someone who kept the data key, or a copy of the old wrapped key: nothing saved from then on opens with it. The honest limit: neither takes back what that person already read, copied or downloaded, and a copy of the old ciphertext taken before the rotation still opens with the old key.

The backup key is the data key written for a person. The server never has it and no route returns it. The app shows it to the administrator only, and only the administrator can use it to set a new password (`PUT /team/vault`). A member who knows the password does hold the data key in their browser, which is what lets them read: the restriction on members is on what they can change, not on a secret they could not derive.

MCP. The token of a member reaches the team notes under the prefix `@team/`: `list_notes` and `list_folders` show them with `team: true`, and `read_note`, `write_note`, `append_note` and `search_notes` work on them. The folder limit of a token is checked on the whole path, prefix included: a token limited to one of the person's own folders does not see the team, and a token limited to `@team` or `@team/some/folder` sees only that. While someone belongs to a team, a personal folder literally named `@team` is hidden from their MCP tools. `move_note` and `note_history` work on team notes; a note cannot be moved between the team space and personal notes. The token of a reader reads team notes and cannot change them. The sharing tools work on team notes only when the `share` or `links` policy allows it for that member, and never on a protected space. With the `tokens` policy off, the token of a member who is not an administrator does not see `@team/`.

Leaving and cancelling. A member who leaves or is removed goes back to their own plan and keeps their notes; their open connections to team notes are closed at once. When the subscription of the team ends, the team stays with its people and its notes but no longer gives the paid plan: the team notes can still be read and edited, new ones are refused past the free limit (`402 team_ended`) and no history is kept. Nothing is deleted. A new payment by the same account brings the team back. Someone who already pays an individual subscription and joins a team keeps that subscription: the server never cancels it, `mine.solo` is `true` and the app tells them it is still active and links to `PORTAL_URL`.

Billing. A team is one Paddle subscription with two items: the base price, quantity 1, which covers 2 people, and the price per extra seat with quantity seats minus 2 (left out when it is 0). `POST /paddle/webhook` recognises it by the id of the base price and reads the seats from it. Like an individual subscription, it is tied to the account it was first seen with. Changing the seats from the app calls `PATCH /subscriptions/{id}` on the Paddle API with `proration_billing_mode: "prorated_immediately"`. If seats are lowered from the Paddle dashboard below the people in the team, nobody is removed: no new invitations go out until there is room. A payment in the name of an account that already belongs to another team does not move it: its own team starts when it leaves the other one.

| Variable | What it does | Default |
|---|---|---|
| `PADDLE_TEAM_BASE` | Id of the base price of the team plan (covers 2 people) | off |
| `PADDLE_TEAM_SEAT` | Id of the price of each extra seat | off |
| `PADDLE_API_KEY` | Paddle API key, used only to change the seats of a subscription | off |
| `PADDLE_API_URL` | Paddle API address. The sandbox is `https://sandbox-api.paddle.com` | `https://api.paddle.com` |
| `CHECKOUT_TEAM` | Payment link for the team plan that the app shows in Settings → Plan. The account email is appended as `email=` | |
| `TEAM_MAX_SEATS` | Most seats a team can have | `50` |
| `TEAM_INVITES_DAY` | Invitations one team may send per day | `20` |
| `TEAM_HISTORY_DAYS` | Days of version history kept in a team space. The `history_days` policy can only shorten it | `365` |
| `TEAM_LOG_DAYS` | Days the activity log of a team is kept | `90` |
| `APP_URL` | Address of the app: the invitation email links to it, and the MCP tools build on it the link that opens a note | `https://sharpmd.app/src/app.html` |
| `TRASH_DAYS` | Days a deleted note stays in the trash. `0` turns the trash off: deleting is final | `30` |

The team plan is offered only when `PADDLE_WEBHOOK_SECRET`, `PADDLE_TEAM_BASE`, `PADDLE_TEAM_SEAT` and `PADDLE_API_KEY` are all set. Without them `team.enabled` is `false` and the app does not show it.

On your own server, without Paddle, make a team by hand. It gives the paid plan to its members and the shared space; the seats are changed with the same call, and `seats: 0` ends it:

```
curl -X POST https://sync.example.com/admin/team -H "x-admin-key: $ADMIN_KEY" \
  -H "content-type: application/json" -d '{"email":"someone@example.com","seats":5}'
```

A comment is how the user points the AI at a passage: it stays open until the AI reads it with `list_comments`, makes the change and calls `resolve_comment`. The server cannot wake an AI client up; the client reads the open comments when it is asked to, or on its own schedule.

Connecting Claude Code:

```
claude mcp add --transport http sharpmd https://sync.example.com/mcp --header "Authorization: Bearer mdt_..."
```

### Automations

The public description, with examples for Make, n8n, Activepieces, Zapier and Slack, is at <https://sharpmd.app/api.html>. All of it is part of the paid plan (`API_FREE=1` opens it on the free plan). MCP is not: it works on every plan, over the notes that plan holds. `GET /account` carries `api: true` when the account can use the API and the automations. Deploy `openapi.json` next to `server.mjs`: it is what `GET /api/v1/openapi.json` serves (rebuild it with `node tools/build-openapi.mjs`).

**REST API, with a token.** `/api/v1/…` takes `Authorization: Bearer mdt_…`, the same tokens as MCP, and every request ends in the same code as the MCP tools: the folder of the token, the sharing permission, the team space under `@team/` and protected folders (only while unlocked for the AI) behave the same. Answers are `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. It can be called from any origin: there are no cookies, the token travels in the request.

| Call | What it does |
|---|---|
| `GET /api/v1/me` | What the token reaches |
| `GET /api/v1/notes?folder=&limit=&cursor=` | Notes, newest first, in pages (`next_cursor`) |
| `GET /api/v1/note?path=` | Text, `rev`, `updated` and the URL that opens it in the app |
| `PUT /api/v1/note` `{ path, text, rev? }` | Creates or replaces. With `rev`, `409 rev_conflict` if the note moved on |
| `POST /api/v1/note/append` `{ path, text }` · `POST /api/v1/note/move` `{ from, to }` · `DELETE /api/v1/note?path=` | Append, move, send to the trash |
| `GET /api/v1/folders` · `GET /api/v1/search?q=` · `GET /api/v1/history?path=&version=` | Folders, search, earlier versions |
| `GET /api/v1/comments?path=` · `POST /api/v1/comments` · `POST /api/v1/comments/:id/resolve` | Comments for the AI |
| `GET /api/v1/boards?path=` | The kanban boards of a note as JSON: columns, cards, attributes |
| `POST /api/v1/boards/cards` `{ path, column, title, attrs?, rev? }` | Creates a card |
| `PATCH /api/v1/boards/cards/:id` · `POST …/:id/move` `{ path, column }` · `POST …/:id/done` · `DELETE …/:id?path=` | Changes, moves, completes or removes a card. `:id` is the id of the card or its position (`board.column.card`) |
| `GET/POST/DELETE /api/v1/shares` · `POST/DELETE /api/v1/links` | Sharing, only with a token that has that permission |
| `GET /api/v1/files` · `POST /api/v1/files` | The attached images with the storage in use, and uploading one: the body is the image, and the answer carries its `url` and the `markdown` to put in a note. `?space=team` works on the team space, when the `tokens` policy lets the token reach it and the role can write. A token limited to a folder lists only the images that the notes of that folder use. A team token that cannot write cannot upload. No encrypted images here: a token has no key of a protected folder |
| `GET /api/v1/openapi.json` | OpenAPI 3.1, no token needed |

Card operations rewrite the Markdown of the note on the revision they read, and give an id to the cards that had none.

**Outgoing webhooks.** Managed with the session of the account (`o` = the team space: for whoever can write there and has the `automation` policy, which is off by default and always on for admins):

| Call | What it does |
|---|---|
| `GET /automations` | Webhooks and inbound addresses, without secrets |
| `POST /automations/hooks` `{ url, scope: { kind: all / folder / note, path }, events, format: json / slack / discord, include_text, name, lang }` | Creates one. Returns its signing secret once. Up to 20 per account |
| `PUT /automations/hooks/:id` · `DELETE` | Changes it (`on: false` pauses it), removes it |
| `POST /automations/hooks/:id/test` · `POST …/secret` · `GET …/deliveries` | Sends a `ping`, replaces the secret, lists the last 50 deliveries (status, code, duration) |

Events: `note.created`, `note.updated`, `note.deleted`, `note.restored`, `note.moved`, `comment.created`, `comment.resolved`, `card.created`, `card.moved`, `card.updated`, `card.done`, `card.deleted`. A card that enters the done column (the one named in the board config with `done=`, or the first one called Done, Hecho, Listo and the like) is marked done and one that leaves it is unmarked, from the app, the API and MCP alike, unless the request says `done` itself; that move sends `card.moved` and then `card.done` (leaving sends `card.moved` and `card.updated` with `done`). Card events come from comparing the boards of the note before and after each save, by card id (by text, for boards without ids), whoever saved: the app, the API or MCP. The body is `{ id, type, created, account, note: { path, name, url, space }, actor: { type, id?, role?, via? }, data }`; `account` is an opaque id. The text of the note travels only with `include_text` (up to 64 KB). `X-SharpMD-Signature: t=<seconds>,v1=<hex>` is the HMAC-SHA-256 of `<t>.<body>` with the secret.

- Deliveries wait in the database (`hook_jobs`), so a restart does not lose them. A failed one is retried with growing waits; after `WEBHOOK_MAX_FAILS` failed attempts in a row the webhook is turned off and the app shows it.
- **SSRF.** Only `https:`, no user or password in the address, no ports under 1024 other than 443. The name is resolved and every address it has must be public: loopback, private, link-local, CGNAT, multicast, cloud metadata and their IPv6 forms (mapped, NAT64, 6to4, Teredo, unique local) are refused. The connection goes to the address that was checked, with no second resolution. Redirects are not followed, the wait is short, the response is read up to 16 KB and dropped, and no header of the request that caused the event is forwarded. The check runs when the webhook is saved and again on every delivery.
- The address and the secret are stored with `DATA_KEY` when it is set, like the text of the notes. The secret cannot be a hash: it signs every delivery.
- Notes in a protected folder produce no events, and a webhook or an inbound address cannot point inside one. The same goes for a team space protected with a password: no events, no inbound addresses, nothing written in clear.
- **Teams.** A team member appears in an event as `{ type: "member", id: "mem_…", role, via }`: an opaque id, never a name or an address. Writing to the team space through the API follows the role (a reader gets `403 read_only`, also on board operations) and the `tokens` policy. Team tokens (`/team/tokens`) work on `/api/v1` like personal ones, with the team space as the root. A webhook or an inbound address on the team space works while the account that created it can still write and automate there. What the API or an inbound address changes in the space goes to the activity log with the name of the token or of the address, and creating or removing an automation is logged too (`automation`, `automation_remove`).

**Inbound addresses.** `POST /automations/inboxes` `{ kind: append / create / card, path, template, column, allow_get, name, tz }` returns the address once; the server keeps a hash of its secret. `POST /in/<secret>` then adds to the note (`append`), creates a note in the folder (`create`, named after `title` or the date) or creates a card on the board of the note (`card`). It takes `text/plain`, JSON, `application/x-www-form-urlencoded` and `multipart/form-data` without files, up to 64 KB, and answers `{ ok: true }`: never content of the note. `GET /in/<secret>?text=` works only with `allow_get`. Limits: `INBOX_PER_MINUTE` per address, 5000 a day, and 30 unknown secrets per hour per IP.

## Tests

```
cd ../tests
node server.mjs
node revision.mjs
node live.mjs
node team.mjs
node teamvault.mjs
node teamadmin.mjs
node cloud.mjs
node vault.mjs
node vaultapp.mjs
node automation.mjs
node sites.mjs
node images.mjs
```
