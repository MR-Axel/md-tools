# Chrome extension and Android app

SharpMD is the same app in three places.

| Where | What it adds |
|---|---|
| The web | Nothing to install. It opens offline after the first visit |
| The Chrome extension | Opens the `.md` files on your disk with a double-click, and the Markdown any site serves |
| The Android app | The web app full screen, and it receives what other apps share |

## The extension

It is on the Chrome Web Store. It works the same in Edge, Brave and Arc.

Chrome installs it with the permission to open files from disk turned off, and an extension cannot turn it on by itself. On install a page opens with a button to the details of the extension: there you turn on "Allow access to file URLs" once. Without that permission the extension still works with the web app, but it does not open files from your disk.

For a double-click to open a `.md` already drawn, set Chrome as the default app for those files.

### Together with the web

With the extension installed, the web app and the extension share the browser notes and the list of opened files and folders. The extension button opens the web app, or the extension's own page when there is no connection. You choose in **Settings** > **Install**.

## Installing it as an app

From **Settings** > **Install** the web app installs with its own window. The same tab has the steps for iPhone, iPad and Mac.

> [!TIP]
> On iPhone and iPad it installs from Safari: Share, then Add to Home Screen.

## Android

The Android app opens `sharpmd.app` full screen, with the same notes, the same account and the same offline copy. It is always the current version of the site.

Other apps can send things to it with Share:

- A Markdown, text, JSON or YAML file opens as an unsaved document.
- A text or a link starts a new note.

It also shows under "Open with" for those file types.

Next: [Keyboard shortcuts](shortcuts.md).
