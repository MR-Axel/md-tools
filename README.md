<p align="center"><img src="icons/icon128.png" width="84" alt="SharpMD"></p>

<h1 align="center">SharpMD</h1>

<p align="center">A Markdown editor and reader that runs in the browser.<br>Open a file or a whole folder and edit on the formatted text.</p>

<p align="center">
  <a href="https://sharpmd.app/"><strong>Website</strong></a> ·
  <a href="https://sharpmd.app/src/app.html"><strong>Open the web app</strong></a> ·
  <a href="#install"><strong>Install the extension</strong></a> ·
  <a href="README.es.md">Español</a>
</p>

![SharpMD showing a Markdown document with its outline](docs/store/1-reader.png)

Free and open source. No account, no tracking: files are read in your browser and never uploaded.

## Features

| | |
|---|---|
| **Edit in place** | Click a paragraph, a heading, a list item or a table cell and type. The Markdown is rewritten behind it. |
| **Formatting as you type** | `**bold**`, `*italic*` and `` `code` `` turn into formatting. A line that starts with `#`, `-`, `1.`, `>` or `[]` becomes a heading, a list, a quote or a task. |
| **Blocks** | Right-click, the handle next to a block, the + button or `/` on an empty line: insert, turn into, move, duplicate or delete. Undo with Ctrl+Z, redo with Ctrl+Y. |
| **Tables** | Add and remove rows and columns. A totals row sums each column, and a cell can hold `=sum`, `=avg`, `=min`, `=max`, `=count` or `=median`. |
| **Boards** | A `kanban` block turns headings into columns and tasks into cards you can drag. Anywhere else it reads as a plain task list. |
| **Diagrams** | Mermaid and Graphviz, with an editor that shows the drawing next to the code and nine templates. Rounded or straight shapes. |
| **Math** | KaTeX, inline and in blocks. |
| **Images** | Insert by address or from a file, pick a size, paste from the clipboard. |
| **Folder** | The files next to the open document, search across all of them, `[[name]]` links, and new, rename and delete from the tree. |
| **Outline** | Built from the headings, with the current section and reading progress. |
| **Notes** | New starts a note that saves itself in the browser, or in a folder you choose. |
| **Emoji** | Type `:` and pick from the list. |
| **Focus** | Focus mode dims everything but the block you are writing; typewriter mode keeps the line at mid height. |
| **Export** | One standalone HTML file, or PDF through print. |
| **More than Markdown** | Code and config files open highlighted, CSV as a table, images as images. |
| **Cloud notes** | Optional. Sign in with a code sent to your email, send a note to the cloud and open it on any device, also without a connection. |
| **Sharing** | A note or a folder with another account, to read or to edit, or a read-only public link with a password. |
| **AI over MCP** | Claude or any MCP client can list, read, write, append to and search your cloud notes. |
| **Yours to adjust** | Light and dark themes, width, font size, code block color, custom CSS, English and Spanish. |

| Editing a table | Blocks menu |
|---|---|
| ![Editing a table cell in place](docs/store/2-editing.png) | ![The block menu](docs/store/3-blocks.png) |

| Diagram editor | Folder search |
|---|---|
| ![The diagram editor with live preview](docs/store/4-diagram.png) | ![Searching every file in a folder](docs/store/6-search.png) |

## Two ways to use it

**On the web.** Nothing to install: [open the web app](https://sharpmd.app/src/app.html). Chrome, Edge and Brave open folders and save in place. Firefox and Safari open one file at a time, and saving downloads a copy.

**As an extension.** Set Chrome as the default app for `.md` files and a double-click opens them rendered. It also renders Markdown served by any website, and it works offline.

## Install

The extension is not on the Chrome Web Store yet. To load it from source:

1. Download this repository (Code → Download ZIP) and unzip it, or clone it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder.
5. On the SharpMD card, open **Details** and turn on **Allow access to file URLs**. Without it, local files will not open.
6. If another Markdown extension is installed, disable it so they do not both act on the same file.

Then drag any `.md` file into the browser, or click the extension icon and choose **New** or **Open**. `examples/sample.md` exercises every feature.

It works the same in Edge, Brave and Arc.

## Updating

Chrome cannot update an extension loaded from a folder, so SharpMD checks this repository once a day (or once a week, or never: Settings → Updates) and tells you in the sidebar and in the popup when there is a newer version. Download the ZIP, replace the folder and click **Apply**. If you cloned the repository, `git pull` and **Apply** is enough.

## Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+S | Save |
| Ctrl+Z / Ctrl+Y | Undo and redo block operations |
| Ctrl+B / Ctrl+I | Bold and italic |
| Ctrl+Shift+F | Focus the search box |
| Alt+Shift+B | Show or hide the sidebar |
| Alt+Shift+C | Toggle centered content |
| Alt+Shift+R | Toggle auto-reload |
| Alt+Shift+T | Switch theme |

The Alt+Shift shortcuts can be changed at `chrome://extensions/shortcuts`.

## Saving

A page cannot write to disk on its own, so the first time you save a file opened by double-click, SharpMD asks you to pick its folder. From then on every Markdown file inside saves straight to itself. Files and folders opened from the SharpMD page already carry that permission.

## Privacy

No analytics. Settings, reading positions and browser notes are stored in your browser. Files you open are never uploaded. Cloud notes are optional: a note reaches the sync server only when you send it there. Apart from that, the only network request the extension makes is the daily check of the version number published here, which you can turn off. HTML produced from the Markdown goes through DOMPurify before it reaches the page. Details in the [privacy page](https://sharpmd.app/privacy.html).

## Cloud notes and the sync server

`server/` holds SharpMD Sync: accounts, notes in the cloud and an MCP endpoint so an AI can read and write them. Sign in from the start screen with a code sent to your email. The free plan holds 10 cloud notes; the paid plan (USD 3.99 a month or USD 39 a year) has no limit and adds sharing, the MCP connection, 30 days of version history and the appearance options.

The server is one file with no dependencies, and you can host it yourself: set its address in Settings → Account, or type `off` there to use SharpMD with no cloud at all. See [server/README.md](server/README.md).

## Development

The app has no build step. The landing page is the one exception: `index.html`, `es/index.html` and `sitemap.xml` are generated from `tools/landing.src.html`, so each language is served as its own page. Edit the source, run `node tools/build-site.mjs` and commit the result.

There is no build step: edit and reload the extension.

```
manifest.json
_locales/         extension name, description and shortcut labels (en, es)
src/
  defaults.js     default settings, storage access and the English/Spanish dictionary
  kit.js          icons and shared helpers
  markdown.js     the parser and its plugins: [[wiki]] links, math, YAML front matter
  theme.js        light or dark theme and accent color
  serialize.js    from an edited block back to Markdown
  store.js        file and folder permissions and browser notes, kept in IndexedDB
  cloud.js        client for the optional sync server
  home.js         start screen of the SharpMD page
  write.js        new blocks, Markdown shortcuts and the block menu
  diagram.js      diagram editor with live preview
  board.js        kanban boards and table formulas
  extras.js       files from the tree, images, replace, typewriter mode, HTML export
  content.js      the reader: interface, outline, tree, search, editing, saving, settings
  content.css     styles and themes
  background.js   reads files and folders, lazy-loads the heavy libraries, shortcuts, update check
  web.js          stands in for the extension APIs when the page is served from a site
  app.html        the SharpMD page: open a file or a folder and edit it there
  popup.html/js   the popup of the extension icon
server/           optional sync server with MCP
vendor/           third-party libraries, unmodified
examples/         sample documents covering every feature
tests/            end-to-end tests
```

Tests load the extension in a Chromium and walk through every mode:

```
cd tests
npm install
npm test
```

They need a Playwright Chromium (`npx playwright install chromium`) or `CHROME_BIN` pointing at another one.

## Third-party libraries

All of them are vendored in `vendor/`, because Manifest V3 does not allow remote code.

| Library | License |
|---|---|
| markdown-it and plugins (emoji, sub, sup, ins, mark, abbr, deflist, footnote, multimd-table, container) | MIT |
| highlight.js | BSD-3-Clause |
| KaTeX | MIT |
| Mermaid | MIT |
| Viz.js (Graphviz) | MIT |
| DOMPurify | MPL-2.0 or Apache-2.0 |
| Inter (typeface) | OFL-1.1 |

## Support

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/surlabs)

The editor is free and has no analytics. If it saves you time, you can [support the next tool on Ko-fi](https://ko-fi.com/surlabs).

## License

The app is MIT. See [LICENSE](LICENSE). The sync server in `server/` is AGPL-3.0-or-later.
