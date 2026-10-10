# The cloud and sharing

The cloud is optional. A note reaches the server only when you send it there. Files you open from disk are not uploaded.

## Signing in

In the explorer, the **Cloud** root has the link **Sign in to see your notes**. You type your email and a six-digit code arrives. There is no password.

Once signed in, the same notes are on every device you sign in on, also without a connection.

The free plan holds up to 25 notes in the cloud. What the paid plan adds and what it costs is in **Settings** > **Plan**.

## Sending a note

It is explained in [Files and folders](files-and-folders.md). A cloud note you delete stays for 30 days in the **Trash**, at the bottom of the **Cloud** root, and can be restored from there.

## Sharing

With a cloud note open, the cloud button opens a menu. **Share** has two ways:

| Way | Who gets in | What they can do |
|---|---|---|
| **With another account** | The person whose email you type | **View only** or **Can edit** |
| **With a read-only link** | Anyone who has the link | Read. It can carry a password |

A whole folder can be shared with another account too. Sharing is part of the paid plan.

A cloud folder can also be shared with a link, and it can be a template. It is in the right-click on the folder: **Share the folder…**. With **It is a template**, whoever opens the link reads the folder and takes a copy to edit: to their browser, to their cloud or as a ZIP. The original does not change, and nobody else sees what each person does with their copy. **Ask for an account to use it** lets anyone read it and asks them to sign in to take it. The short address gives it a name, like `sharpmd.app/t/my-template`, good for printing: the name stays with your account and you can point it to another folder. The same window shows how many copies were made.

## Writing at the same time

**Collaborate live** opens a session on a cloud note and gives you a link. Guests join from the browser with a name, without an account, and everyone writes at once. Up to 12 people join. It is part of the paid plan.

A cloud note shows who has it open now and who edited it last. On the paid plan, **Version history** keeps the earlier versions.

## Folders with a password

In the explorer, a right-click on a cloud folder offers **Protect with a password…**. Its notes are encrypted in your browser and the server cannot read them. File and folder names stay visible.

> [!WARNING]
> A protected folder is left out of sharing, of public links and of your AI. For your AI to read it, you unlock it for as long as you choose.

You can also protect your whole cloud with one password, from **Settings** > **Cloud**. With that on there is no sharing, public links, published site or automations until you remove the protection.

## Publishing a site

A cloud folder becomes a public website, with a menu, search and a theme. It is in the right-click on the folder: **Publish as a site…**. One site per account, on the paid plan.

- A note with `publish: false` in its front matter is left out.
- A protected folder is never published.
- What an AI changes stays unpublished until you publish it from the app.

## Leaving

The account is deleted from **Settings** > **Cloud**, with **Delete account**. Its notes and everything else stored for it are removed.

Next: [Connect your AI over MCP](connect-your-ai.md) and [Privacy](privacy.md).
