# Reading and editing

A note opens for reading. At the top, in the middle, there are two buttons: **View** and **Edit**. You can also double-click a paragraph and the cursor lands there.

## Writing on the page

While editing, click a paragraph, a heading, a list item or a table cell and type. The Markdown is rewritten behind it, block by block.

If you would rather type Markdown, that works too:

| You type | You get |
|---|---|
| `# ` at the start of a line | Heading, from `#` to `####` |
| `- ` | List |
| `1. ` | Numbered list |
| `> ` | Quote |
| `[] ` | Task |
| `**text**` | Bold |
| `:` | A list of emoji to pick from |

> [!TIP]
> The Markdown is one click away. **View source**, in the top bar, shows the text as it is.

## Blocks

Each paragraph, table or diagram is a block. To insert one, use the right-click, the `+` button or `/` on an empty line. The menu has **Table**, **Code block**, **Diagram**, **Formula**, **Board**, **Callout**, **Collapsible section**, **Image** and **Link**.

From the same menu a block turns into another, moves, is duplicated or deleted. `Ctrl+Z` undoes and `Ctrl+Y` redoes.

To work on several blocks at once, press `Esc` inside a block and extend the selection with `Shift` and the arrows. On touch, press and hold.

In a table you can add and remove rows and columns. A cell takes `=sum`, `=avg`, `=min`, `=max`, `=count` or `=median`.

## Saving

- A note in the browser or in the cloud saves itself.
- A file on disk is saved with `Ctrl+S`.

> [!NOTE]
> If you opened the file with a double-click from your disk, the first time you save SharpMD asks you to pick its folder. From then on everything in that folder saves straight to itself.

If another program changes the file while you have it open, SharpMD overwrites nothing. It merges the two changes and, when both touched the same lines, asks you what stays.

::: warning
A read-only note, like the ones in this guide or one shared with you to view, cannot be edited. Save a copy to change it.
:::

## Finding your way

`Ctrl+Shift+F` searches the note or the folder. The outline in the sidebar is built from the headings and marks the section you are in. `Ctrl+K` makes a link to a section or to another file, picked from a list.

Each heading folds with the small chevron in its margin. Folding does not change the file.

What applies to one note only (page width, numbered headings, whether the outline shows) is in **Page settings** and is kept in the front matter of the note.

Next: [Files and folders](files-and-folders.md). Every shortcut is in [Keyboard shortcuts](shortcuts.md).
