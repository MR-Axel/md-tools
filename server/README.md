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
| `ADMIN_KEY` | Key for `POST /admin/plan` and `POST /admin/team` | off |
| `TEST_LOGIN` | `email:123456`. That one account signs in with the fixed code and gets no email. For store reviewers | off |
| `CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY` | Payment links the app shows in Settings → Plan. The account email is appended as `email=`, and the app adds `back=` with the address to return to | |
| `PADDLE_WEBHOOK_SECRET` | Turns on `POST /paddle/webhook`: Paddle subscription events switch the plan | off |
| `PORTAL_URL` | Where a subscriber manages the subscription | |
| `PADDLE_TEAM_BASE`, `PADDLE_TEAM_SEAT`, `PADDLE_API_KEY`, `CHECKOUT_TEAM` | The team plan: see "Teams" below | off |
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

Email, notes, their previous versions (paid plan, 30 days), deleted notes while they are in the trash (30 days), and hashes of sign-in codes, sessions and tokens. Sessions and tokens are stored hashed: the server cannot show a token again after creating it. Of a live session it stores the note, the name its owner chose and the hash of the link's secret; the guests live in memory only (see "Live sessions"). Of a team it stores its name, the accounts that belong to it, the invitations that are waiting (the invited email address, until it is accepted, declined or removed) and the id of the subscription that pays for it (see "Teams").

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
| `GET /account` | Plan, note count and limit. `plan` is what the account has now; `own_plan` what it pays for by itself (a member of a team can have `plan: "pro"` and `own_plan: "free"`); `team` is described in "Teams" |
| `GET /notes` | List |
| `GET` / `PUT` / `DELETE /notes/{path}` | Read (`{ text, rev, updated, role }`), write `{ text, rev? }`, delete. Deleting moves the note to the trash; `?forever=1` skips it. See "Revisions" and "Trash" below |
| `DELETE /account` `{ email }` | Deletes the account of the session. See "Deleting an account" below |
| `GET /trash`, `POST /trash/{id}/restore`, `DELETE /trash/{id}`, `DELETE /trash` | List the trash, restore a note, delete one for good, empty it. See "Trash" below |
| `GET /events?path=` | Server-sent events for an open note: `presence` (who else has it open), `saved` (`{ by, updated, rev }`), `comments`, `vault`, and `live` while a live session is open |
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
| `POST /mcp` | MCP over Streamable HTTP, with `Authorization: Bearer mdt_...` |

MCP tools: `list_notes`, `list_folders`, `read_note`, `write_note`, `append_note`, `search_notes`, `list_comments`, `resolve_comment`, `move_note`, `note_history`.

`write_note`, `append_note` and `move_note` end their answer with `Open it: <url>`, the address that opens the note in the app. It is built from `APP_URL` as `?f=cloud/<path>`, the same address the app uses, so point `APP_URL` at the app your users open. Opened without a session, the app asks to sign in and then opens the note.

`move_note` `{ from, to }` moves or renames a note inside the same space, and its history, comments, shares and public links follow it. `note_history` `{ path, version? }` lists the earlier versions of a note, or returns the text of one. Neither works inside a folder protected with a password.

Sharing from an AI is a way out for the notes if the AI is fed instructions by someone else, so it is a separate permission. Five more tools exist only for a token created with `share: true` ("Can share and create links" in Settings > AI), which is off by default, cannot be added to an existing token and shows in the token list:

| Tool | What it does |
| --- | --- |
| `list_shares` `{ path? }` | Who the notes are shared with and which public links exist |
| `share_note` `{ path, email, role? }` | Shares a note, or a folder if `path` is one, with another account to `view` (default) or `edit` |
| `unshare_note` `{ path, email }` | Stops sharing it with that address |
| `create_public_link` `{ path, password? }` | Creates a read-only public link and returns its URL, once |
| `revoke_public_link` `{ id }` or `{ path }` | Revokes one link, or every link to a note |

Without the permission these tools are not in `tools/list` and calling them fails. With it, they go through the same code as `POST /shares` and `POST /links`, so the same rules and limits apply. They stay inside the folder of the token, and they do not reach folders protected with a password or the team space.

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

### Deleting an account

`DELETE /account` with the session and `{ email }`, the email of that same account, deletes it: its notes, version history, trash, comments, tokens, sessions, shares in both directions, public links, protected folders, live sessions, pending team invitations to that email and the record of its ended subscriptions. Open connections are closed. Five requests an hour per IP and per account.

It refuses while money is still being charged, with `409` and a `manage` field holding `PORTAL_URL`:

- `subscription_active`: the account has an active subscription of its own.
- `team_billing_active`: it manages a team whose subscription is active.
- `team_has_members`: it manages a team that still has other members. Alone in its team, the team and the notes of its space are deleted with the account.

A member of a team leaves the team; the notes of the team stay with the team. `400 bad_confirm` when the email is not the one of the account.

### Revisions

Every note has a revision number, `rev`. It starts at 1 and goes up by one with each save. `GET /notes/{path}` returns it, and so does a successful `PUT`.

- `PUT { text, rev }` saves only if `rev` is the current revision of the note. If someone saved in between, nothing is written and the answer is `409 rev_conflict` with the current `text`, `rev` and `updated`. The client merges and tries again over the new revision. The app merges by lines and, where both sides touched the same lines, keeps the saved text and puts the local one aside.
- `PUT { text }` without `rev` saves as before, overwriting. That keeps an extension that has not been updated working. A note that does not exist yet is created either way.
- `rev` must be a whole number, zero or more: anything else answers `400 bad_rev`.
- `write_note` and `append_note` save over the revision that is current at that instant, in one step, so an AI never overwrites a save that came in between and never appends to an old text. Both are announced on `/events`, with `by: "mcp"`.

### Live sessions

The owner of a note, on the paid plan (or with `LIVE_FREE=1`), opens a live session on it and hands out a link. Whoever has the link joins without an account and gets a pass that works only for that note and only while the session is open.

| Call | What it does |
|---|---|
| `POST /live` `{ path, name }` | Opens the session on a note of the account and returns `{ secret, open, name, created, max, people }`. `name` is what guests see instead of the email. The secret is returned once: only its hash is stored. If the session was already open it answers without `secret`. `402 live_needs_plan`, `409 live_vault` for a note in a protected folder |
| `GET /live?path=` | `{ open: false }`, or the session: `{ open, name, created, max, people }` |
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

`people` is `[{ id, name, color, block, editing, here }]`. `id` is `o` for whoever opened the session and `g1`, `g2`... for guests; `color` is a number the server assigns. Nobody can speak for someone else: presence is always attributed to the pass or session that sent it, and names cannot be changed by another participant. A name is trimmed to 40 characters and loses control characters and invisible direction marks; it is otherwise stored as typed, so a client must always show it as text, never as HTML.

While a session is open, the `saved` event sent to its members (the owner and the guests) carries the change itself, so they apply it without another request: `text` with the whole note, or, when the note is over 4000 characters, `base` and `patch: { at, del, lines }` (from line `at`, remove `del` lines and put `lines`, over revision `base`). `pid` says who saved. An event for a guest never carries an email. Roster changes are batched: at most one `live` event every 120 ms per session.

What a pass cannot do: list or read any other note, see the history, share, create links or tokens, use MCP, or call any route outside `/live/`. Guests are kept in memory only (name, color, pass hash); re-entry keys are stored as hashes in the `live_tickets` table and deleted with the session. A guest with no connection and no requests for two minutes gives up the place and can come back with the re-entry key.

A session ends when the owner ends it, after 12 hours with nobody connected, when the note is deleted, renamed or moved, when its folder gets a password, or when the account leaves the paid plan.

| Variable | What it does | Default |
|---|---|---|
| `LIVE_FREE` | `1` lets the free plan open live sessions too | off |
| `LIVE_PEOPLE` | People per session, counting whoever opened it | `12` |
| `LIVE_IDLE_MS` | How long a session with nobody connected lasts | 12 hours |
| `LIVE_GUEST_MS` | How long a guest with no connection keeps the place | 2 minutes |

The connection limits of `/events` apply to `/live/events` too: 60 open connections per IP, and 4 per guest. Behind a proxy, make sure it does not buffer event streams (the server sends `x-accel-buffering: no`) and that it lets them stay open.

### Teams

One account pays for a team and manages it. It is the only one that invites, removes people and changes the number of seats, and it takes one of the seats. Everyone else joins with their usual account by accepting an invitation sent to the email they sign in with. Nobody is added without accepting. While the team is paid, every member has the paid plan. A person is in one team at a time.

| Call | What it does |
|---|---|
| `GET /team` | The same `team` object that `GET /account` carries: `{ enabled, checkout, included, max, mine, invites }`. `mine` is `null` or `{ id, name, role, active, space, seats, used, members, solo }`, plus `pending` and `billing` for the administrator. `invites` are the invitations waiting for this account: `{ id, name, by }` |
| `PUT /team` `{ name }` | Administrator: the name of the team, up to 40 characters |
| `POST /team/invite` `{ email, lang }` | Administrator: invites that address and mails it, in English or with `lang: "es"` in Spanish. `409 team_full` when members plus pending invitations fill the seats, `409 already_member`, `400 own_email`. Limits: `429 invite_day` (per team and day, `TEAM_INVITES_DAY`) and `429 invite_mail_day` (three a day per address, across all teams). The answer and the email are the same whether or not that address has an account |
| `DELETE /team/invites/{id}` | Administrator: removes a pending invitation |
| `POST /team/accept` `{ id }`, `POST /team/decline` `{ id }` | The invited account answers. Only the account whose email was invited can accept. `409 in_team` if it already belongs to a team |
| `POST /team/remove` `{ id }` | Administrator: removes a member (`id` as in `members`) |
| `POST /team/leave` | A member leaves. The administrator cannot: `409 owner_stays` |
| `POST /team/seats` `{ seats }` | Administrator: changes the subscription in Paddle and then the seats. `409 seats_in_use` below the seats in use, `400 bad_seats`, `502 billing_failed` if Paddle refuses, `409 no_billing` for a team made by hand |

The team space. The notes of a team belong to the team, not to a person: they stay when someone leaves. They are stored under an internal account of the team (its email is `team:...`, which is not an address: nobody can sign in as it or share with it), so they get revisions, history, events and encryption at rest exactly like any other note. `mine.space` is the number of that account, and a member reaches the team notes with `o=`: `GET /notes?o=`, `GET` / `PUT` / `DELETE /notes/{path}?o=`, `GET /events?path=&o=`, `GET /search?q=&o=`, `GET /versions/{path}?o=`, `GET /version/{id}?o=`, and `POST /rename` with `o` in the body. Every member reads, edits, moves and deletes. Anyone else gets `403 no_access`. A member cannot read anything personal of another member.

What the team space does not have in this version: folders protected with a password (text that starts with `vault1:` is refused there with `409 vault_text`), sharing with accounts outside the team, public links, comments for the AI and live sessions. Those routes work on the caller's own notes.

MCP. The token of a member reaches the team notes under the prefix `@team/`: `list_notes` and `list_folders` show them with `team: true`, and `read_note`, `write_note`, `append_note` and `search_notes` work on them. The folder limit of a token is checked on the whole path, prefix included: a token limited to one of the person's own folders does not see the team, and a token limited to `@team` or `@team/some/folder` sees only that. While someone belongs to a team, a personal folder literally named `@team` is hidden from their MCP tools. `move_note` and `note_history` work on team notes; a note cannot be moved between the team space and personal notes. The sharing tools do not work on team notes.

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

## Tests

```
cd ../tests
node server.mjs
node revision.mjs
node live.mjs
node team.mjs
node cloud.mjs
node vault.mjs
node vaultapp.mjs
```
