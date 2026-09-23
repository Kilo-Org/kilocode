---
title: "Troubleshooting"
description: "Fixes for common Kilo Desktop issues, including the local harness, git, and local models."
---

# Troubleshooting

If something isn't working in Kilo Desktop, start here.

## The app can't reach the agent

Kilo Desktop runs the agent through a local server (the Kilo harness) that starts on demand. If chats fail to respond:

- Wait a moment after launch -- the server starts the first time you open a chat and needs to report healthy before it accepts requests.
- Make sure you're signed in to your [Kilo account](/docs/desktop/settings#accounts-and-authentication) so hosted models are available.
- Restart the app to relaunch the server.

## The Changes tab shows an error

Git integration requires your system `git` and a standard (non-bare) repository. If the **Changes** tab or branch switcher isn't available:

- Confirm the workspace folder is inside a git repository.
- Confirm `git` is installed and on your `PATH`. See [Installation](/docs/desktop/installation#optional-dependencies).

## The model catalog is empty

Browsing the downloadable catalog for [local inference](/docs/desktop/features/local-inference) requires an Anaconda account. Sign in from [Settings](/docs/desktop/settings#accounts-and-authentication), then reopen the catalog.

## A local model isn't listed in a chat

Local models appear in the chat model selector only after the **Local Model Server** is enabled and the model is installed. Check the [Local Model Server](/docs/desktop/settings#local-model-server) settings.

## Anaconda tools aren't available

The [Anaconda MCP](https://anaconda.com/docs/anaconda-mcp/main) connection activates while you're signed in to your Anaconda account. Confirm you're signed in, then start a new chat.
