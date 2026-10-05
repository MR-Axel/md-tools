# MD Tools

English · [Español](README.es.md)

A Chrome extension to read and edit Markdown files in the browser, local (`file://`) or served over the web. No accounts, no paid plan, no network calls: everything runs on your machine.

![MD Tools](docs/reader.png)

![Editing a table cell in place](docs/editing.png)

## What it does

- **Edit in place**: switch to Edit mode and click any paragraph, heading, list item or table cell to change it. Bold, italic, strikethrough, code and links from a small toolbar or the usual shortcuts; add and remove table rows and columns; tick task boxes. The Markdown is rewritten behind the scenes, so you never see the syntax. Save with Ctrl+S, or turn on auto-save.
- **Outline** built from the document headings: collapsible tree, current section highlighted, reading progress.
- **Folder tree**: the Markdown files next to the open document, with subfolders and a button to go up a level.
- **Auto-reload** when the file changes on disk, keeping your scroll position.
- **Search with two scopes**: on the Outline tab it searches the open document; on the Folder tab it searches the text of every Markdown file in the folder and its subfolders.
- **Themes**: light, dark or automatic. Accent colors, the font and custom CSS are thank-you extras for people who support the project, unlocked on the honor system: there is no check. Everything the reader and editor do is free.
- **Layout to taste**: centered content, content width, font size, line height and font family.
- **Custom CSS** on top of the theme.
- **Markdown plugins**, each with its own switch: code highlighting, emoji, subscript and superscript, inserted and highlighted text, abbreviations, definition lists, footnotes, task lists, GitHub-style alerts, inline table of contents (`[[toc]]`), math with KaTeX, diagrams with Mermaid and Graphviz, tables with merged cells, `::: tip` blocks, and YAML front matter shown as a card.
- **`[[name]]` links** that open the file with that name in the folder.
- **Reading position** remembered per file.
- **Word counter** for the document, and words and characters for the current selection.
- Toolbar: switch between document and source, copy the Markdown, copy with formatting, reload, print or save as PDF, settings.
- **English and Spanish**: follows the browser language (Spanish, or English for anything else) and can be changed in Settings.

| Folder search | Settings |
|---|---|
| ![Folder search](docs/folder-search.png) | ![Settings](docs/settings.png) |

## Install

It is not on the Chrome Web Store yet. To load it from source:

1. Download this repository (Code → Download ZIP) and unzip it, or clone it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder.
5. On the MD Tools card, open **Details** and turn on **Allow access to file URLs**. Without it, local files will not open.
6. If you have another Markdown extension installed, disable it so they do not both act on the same file.

Then drag any `.md` file into the browser. `ejemplo/ejemplo.md` exercises every feature.

It also works in other Chromium browsers (Edge, Brave, Arc) through the same steps.

## Shortcuts

| Shortcut | Action |
|---|---|
| Alt+Shift+B | Show or hide the sidebar |
| Alt+Shift+C | Toggle centered content |
| Alt+Shift+R | Toggle auto-reload |
| Alt+Shift+T | Switch theme |
| Ctrl+Shift+F | Focus the search box |

Change them at `chrome://extensions/shortcuts`.

## Saving

Chrome does not let an extension write to disk on its own, so the first time you save, MD Tools asks for permission. Pick the folder the file lives in, or one that contains it: from then on every Markdown file inside saves straight to itself, and the choice is remembered across sessions. Chrome may still show a one-click confirmation the first time in each session. You can also grant a single file instead of a folder.

## Privacy

MD Tools collects nothing and sends nothing. Settings and reading positions are stored locally in the browser. The broad permissions exist for one reason each: `file:///*` and `*://*/*` so it can render Markdown wherever the file lives, and `scripting` to load KaTeX, Mermaid and Graphviz only when a document uses them.

HTML produced from the Markdown goes through DOMPurify before it reaches the page.

## Project layout

```
manifest.json
_locales/         extension name, description and shortcut labels (en, es)
src/
  defaults.js     default settings, storage access and the Spanish/English dictionary
  background.js   reads files and folders, lazy-loads the heavy libraries, handles shortcuts
  content.js      the reader: rendering, outline, tree, search, settings panel
  content.css     styles and themes
  popup.html/js   quick switches
vendor/           third-party libraries, unmodified
ejemplo/          test document covering every feature
```

There is no build step: edit and reload the extension.

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

## Support

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/mraxel)

MD Tools is free and collects no data. If it saves you time, you can [support the next tool on Ko-fi](https://ko-fi.com/mraxel).

## License

MIT. See [LICENSE](LICENSE).
