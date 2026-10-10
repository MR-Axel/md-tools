# Automations and webhooks

They connect your cloud notes with Slack, Discord, Make, n8n, Activepieces or Zapier. They are part of the paid plan and are set up in **Settings** > **API and automations**.

There are three pieces:

| Piece | What for |
|---|---|
| **Automations** | SharpMD tells the outside when something changes (webhooks) |
| **Inbound addresses** | Something outside writes into your notes |
| **API tokens** | A flow reads and writes notes and moves cards |

## Telling the outside

**New automation** sets up a webhook: you choose what to watch (the whole account, a folder or a note), which events and where to send them. There are ready-made formats for Slack and Discord, and JSON for the rest.

You can also get there from the explorer: right-click a cloud note or folder and **Automate…**.

The events:

- Of a note: `note.created`, `note.updated`, `note.moved`, `note.deleted`, `note.restored`
- Of a comment: `comment.created`, `comment.resolved`
- Of a card on a board: `card.created`, `card.moved`, `card.updated`, `card.done`, `card.deleted`

Each delivery is signed with HMAC-SHA-256 in the `X-SharpMD-Signature` header. Your flow checks the signature with the secret of the automation.

## Receiving from outside

**New inbound address** creates a secret address. What arrives there adds text to a note, creates a note or creates a card. It works for a form, a sale or an email.

> [!WARNING]
> The address is shown only once. Copy it right then. Anyone who has it can write there.

## Reading and writing from a flow

The API uses the same tokens as the AI. The requests are in the [API reference](api.md).

With the whole cloud protected with a password there are no automations until you remove the protection. See [The cloud and sharing](cloud-and-sharing.md).
