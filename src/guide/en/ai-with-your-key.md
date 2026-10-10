# AI with your own key

SharpMD has no AI of its own. The assistant uses the key you connect, and it comes turned off.

## Turning it on

1. Open **Settings** > **Tools** and turn on **AI assistant (your key)**.
2. Pick the provider and paste your key.
3. Check it with the **Test** button.

Providers: Claude (Anthropic), OpenAI, Google Gemini, DeepSeek, Groq, Kimi (Moonshot AI), MiniMax, Mistral, OpenRouter, Together AI and xAI (Grok). It also works with an OpenAI-compatible server, such as Ollama or LM Studio on your machine. One key per provider.

## What it does

- On a selection or a block: it improves the writing, fixes spelling and grammar, shortens, expands, changes the tone, translates or explains. The result is a proposal next to the original, with the differences marked. You choose whether it replaces, goes below, is copied or is discarded.
- **Write with AI** generates Markdown at that point. It has shortcuts for a table, a task list, a diagram, a formula, a summary and the key points.
- **Ask about the note** opens a side panel that answers questions about the open note.

`Alt+Shift+A` opens the actions on the selection or the block. `Alt+Shift+Q` opens the question panel.

## Where your text goes

> [!IMPORTANT]
> Requests go from your browser straight to the provider you chose. SharpMD's server receives neither the key nor the text.

The key is stored only on that device, encrypted. It does not travel with the settings, with a note or with an export. The provider receives the text you send, bills it and handles it under its own terms.

A key in a browser is protected from other sites and from our server. It is not protected from someone using your unlocked device: prefer a key with a spending limit.

This is different from [connecting your AI over MCP](connect-your-ai.md), where your AI is the one that reaches your cloud notes.
