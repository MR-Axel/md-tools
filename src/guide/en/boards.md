# Kanban board

A board is a code block named `kanban`. Each heading is a column and each task is a card.

```kanban
## To do
- [ ] Open a folder from disk
- [ ] Connect my AI {priority=high}

## In progress
- [ ] Read the guide

## Done
- [x] Open SharpMD
```

In a note of your own, cards drag from one column to another, and a click opens the detail of a card. This guide is read only: save a copy to try it.

To add one, pick **Board** in the block menu.

## What is saved

The board above is this text:

````text
```kanban
## To do
- [ ] Open a folder from disk
- [ ] Connect my AI {priority=high}

## In progress
- [ ] Read the guide

## Done
- [x] Open SharpMD
```
````

In any other program it reads as a plain task list.

## Attributes of a card

A card can end with its attributes in braces:

```text
- [ ] Check the order {due=2026-10-20 priority=high}
```

- `id`, `created` and `updated` are written by SharpMD. The `id` never changes.
- The rest is yours: `key=value`, with quotes when the value has spaces.
- A line with only braces before the first column sets up the board. `show` says which attributes are drawn on the cards, and `key=a|b|c` gives an attribute a list of options.

```text
{show=due,priority priority=low|medium|high}
```

## With your AI and with other apps

An AI connected over MCP creates boards, adds cards and moves them. See [Connect your AI over MCP](connect-your-ai.md). A webhook tells the outside when a card changes: [Automations and webhooks](automations.md).

The board is a tool that comes turned on. If you turn it off in **Settings** > **Tools**, the block shows as code and the note does not change.
