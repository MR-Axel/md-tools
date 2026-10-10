# SharpMD Local

A small program that runs on your computer and tells [SharpMD](https://sharpmd.app) things a web page cannot see by
itself:

- **Local servers**: which ports are listening, which process and project each one belongs to, the version it runs and
  since when. To find what was left running and close it.
- **Worktrees**: the git worktrees of the folders you choose, with their branch, last commit, uncommitted changes, last
  edit and which processes are working in that folder.
- **Local sessions**: the AI agent sessions open on the machine (Claude Code and the ones you set up), with their
  title, project and the memory each one uses.
- **Show in Explorer**: opens the system file manager with a file of yours selected.

It is free, local and needs no account. It listens on **`127.0.0.1` only**: nothing leaves the machine and nothing goes
through SharpMD's servers.

Leer en español: [README.es.md](README.es.md).

## What it does and what it does not

| It does | It does not |
| --- | --- |
| List the listening TCP ports and their processes | Run commands that come from outside |
| Read the working folder of your processes to know their project | Read or return files on request |
| Read name and version from the project's `package.json` | Delete worktrees or touch a repository |
| Ask your dev servers for their front page to show its title | Close anything from the system or installed programs |
| Run `git worktree list`, `git log -1` and `git status` in the folders you choose | Look at any folder you did not add |
| Read the start of each agent session's log to get its title | Keep history or send anything anywhere |
| Close a dev server or an agent session, if you ask and confirm | Listen on the network: this machine only |
| Open the file manager on a file inside a folder you added | Open the file itself, or launch anything else |

## Install and start

It needs [Node.js](https://nodejs.org) 22 or newer. It has no dependencies.

```
git clone https://github.com/SharpMD/sharpmd.git
cd sharpmd/local
node bin/sharpmd-local.js
```

On Windows you can also double-click `start.cmd`.

When it starts it prints the **pairing code** and the address of its **own panel**:

```
  SharpMD Local 0.1.0
  Listening on this machine only: http://127.0.0.1:7717
  Close actions: on (each one asks first).

  Pairing code (paste it once in SharpMD, Settings > Tools):
    7717.Qm3…

  Panel on this machine, for any browser:
    http://127.0.0.1:7717/#t=Qm3…
```

## Pair it with SharpMD

1. In SharpMD: **Settings > Tools**, and turn on *Local servers*, *Worktrees* or *Local sessions*.
2. Paste the pairing code and press **Pair**.
3. The first time, the browser asks whether the site may connect to this computer. Allow it: without that the page
   cannot reach the program.

The code is kept in that browser. You pair once per browser and the three tools share it. While it is paired, the menu
of a file from your disk also offers **Show in Explorer**.

### Browsers

| Browser | From SharpMD | Own panel |
| --- | --- | --- |
| Chrome, Edge and other Chromium (142 and later) | Yes, with the local network permission | Yes |
| Firefox | Yes, with the permission to reach this device | Yes |
| Safari | **No**: it blocks requests from an `https` page to `http://127.0.0.1` | Yes |

In Safari, or if you would rather not give the site that permission, use the **own panel**: the address the program
prints when it starts. It has the same three views and goes through no website.

## Choose the folders

It starts with none. Add them from the console:

```
node bin/sharpmd-local.js folders add C:\code\notes-app
node bin/sharpmd-local.js folders add C:\code
node bin/sharpmd-local.js folders
node bin/sharpmd-local.js folders remove C:\code
```

A folder can be a repository or a folder with repositories inside (one level). Worktrees come from those folders, and
Show in Explorer only works for files inside them. No restart needed.

## What counts as "development"

A process that listens on a port falls into one of three kinds:

- **Development**: started by an interpreter or a dev tool (node, bun, deno, python, php, ruby, java, dotnet, go, vite,
  next and the like) **from a project folder**, or a binary that lives inside one. A project folder is one with `.git`,
  `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` or similar, that is not your home folder, a system folder or
  a hidden folder of your profile.
- **Other programs**: the rest of what is yours (the browser, the editor, an installed app). Shown; cannot be closed
  from here.
- **System**: system services and processes of other users. Shown apart, with no command line; cannot be closed from
  here.

The version comes from what is written down, with no guessing: the project's `package.json` and, when the tool is
recognised in the command line, the `package.json` of that tool installed in the project (`vite 5.4.2`).

## Security model

A local service that lists processes and can close one is a target: any page open in the browser can try to talk to
it. These are the defences, each with its test in `test/security.test.js` and `test/reveal.test.js`.

| Risk | Defence |
| --- | --- |
| Someone on the network talks to it | It listens on `127.0.0.1` only. |
| Another page reads the list | Every `/v1/*` route needs the token. Without it: `401`, no data. |
| Another page guesses the token | 256 random bits. After ten wrong tries in a minute it stops answering for a while. The comparison leaks no timing. |
| Another page uses a stolen token | Closed list of origins (`https://sharpmd.app` and the extension). Any other `Origin`: `403` with no CORS headers, so the browser lets it read nothing. Same for the preflight answer. |
| DNS rebinding (a foreign domain that resolves to `127.0.0.1`) | `Host` is checked: it has to be `127.0.0.1:<port>` or `localhost:<port>`. Anything else: `421`, for the panel too. |
| A form or an image on another page triggers an action (CSRF) | The token travels in `Authorization`, which cannot be sent without a preflight; actions need `POST` with `Content-Type: application/json`. No cookies, no session. |
| The token leaks through history or a log | It never goes in the URL of a request. The panel gets it after the `#` (which is not sent to the server) and removes it from the address bar. |
| Closing the wrong thing | Only processes the program itself classified as development, or sessions it recognised as an agent's. The request carries PID, port and start time, and all three have to match what the program sees at that moment (a reused PID does not pass). It never closes itself or whoever started it. |
| Closing by mistake | The interface always asks first. With `--read-only` or `"allowClose": false` nothing is closed. |
| Running commands or reading files | There is no route for that. `git` and the system tools are called with fixed arguments and no shell in between. |
| Show in Explorer used to open or run something | The path has to be absolute, with no quotes or control characters, an existing regular file, and, once fully resolved (symlinks and `..`), inside a folder you added. With no folders added nothing is shown. The file manager is started with the path as an argument, with no shell, and it is the only thing started: the file is selected, never opened. `"allowReveal": false` turns it off. |
| Looking at other folders | Folders are chosen from the console of this machine only, never through the API. |
| A title or a name with HTML inside | Everything that comes from the machine is written as text. The own panel is served with a CSP that allows no inline scripts and cannot be embedded. |

The token lives in `~/.sharpmd-local/token`, readable by your user only. To change it (what was paired stops working):

```
node bin/sharpmd-local.js token --new
```

What it does **not** cover: another program running as your user can read that file, just as it can read any other
file of yours or close your processes without going through here. And whoever has the token and can run code on your
machine sees what you see in the panel.

## Settings

`~/.sharpmd-local/config.json` (created when you add the first folder; it can be written by hand). What is missing
takes its default.

| Key | Default | What it is |
| --- | --- | --- |
| `port` | `7717` | The port. Changing it changes the pairing code. |
| `origins` | the website and the extension | Who can talk to it from a browser. |
| `allowClose` | `true` | `false`: read only. |
| `allowReveal` | `true` | `false`: it never opens the file manager. |
| `probeHttp` | `true` | Ask dev servers for their front page to read the title. |
| `readCwd` | `true` | Read the working folder of processes. Without it nothing counts as development. |
| `agentTitles` | `true` | Show the title of each agent session. |
| `folders` | `[]` | The folders it may look at. |
| `agents` | Claude Code on | Which agents to follow: `name`, `on`, `process` (the executable), `sessionPattern` (which command line is a session), `idPattern` and `transcripts` (where the title comes from). |

## Stop it

`Ctrl+C` in its console, or close the window. It installs no service and does not start by itself.

In SharpMD, **Unpair** deletes the code from that browser. To remove every trace: delete the `~/.sharpmd-local` folder.

## Platforms

| | Windows 10 and 11 | Linux | macOS |
| --- | --- | --- | --- |
| State | Tested on a real machine | Written, **not tested on a real machine** | Written, **not tested on a real machine** |
| Ports | `netstat -ano` | `ss -ltnp` | `lsof -iTCP -sTCP:LISTEN` |
| Processes | PowerShell (`Win32_Process`) | `ps` | `ps` |
| Working folder | Read from the process itself | `/proc/<pid>/cwd` | `lsof -d cwd` |
| Close | `taskkill /T /F` (the process and what it started) | `SIGTERM` and, two seconds later, `SIGKILL` | same |
| Show in Explorer | `explorer.exe /select,` | `xdg-open` on the folder (no selection) | `open -R` |

Still missing for Linux and macOS: running it for real and fixing what shows up; closing child processes too (today
only the one that listens); the processor time of each session, which is what tells a working agent from a waiting
one; reviewing the list of system folders; and a launcher like `start.cmd`.

On Windows the working folder is read from the memory of the process itself, the way Process Explorer does. It only
works with processes of your user. A very strict antivirus may flag that read; with `"readCwd": false` it is not done.

## The name

The name of the program is in one place, `src/name.js` (and, on the app side, `LMD.tools.local` in `src/tools.js`).
Outside those two, only `package.json`, the file name in `bin/` and these READMEs carry it.

## Tests

```
npm test                 # parsing against saved samples, the API's security, Show in Explorer
npm run test:real        # on this machine: starts a server, sees it, closes it
```

The samples in `test/fixtures` are made up: no process, port or path in them comes from a real machine.

`test/browser.mjs` tests the connection from a real `https://sharpmd.app` page in Chromium, Firefox and WebKit. It
needs `playwright-core`, which is not a dependency:

```
PLAYWRIGHT_CORE=<path to node_modules/playwright-core> node test/browser.mjs
```

The app's own tests for the three tools are in `tests/localtools.mjs`, at the root of the repository.

## License

MIT, like the rest of the app. See [LICENSE](../LICENSE).
