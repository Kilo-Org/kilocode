---
title: "Troubleshooting"
description: "Fixes for common Kilo Desktop issues, including the local server, git, and local models."
---

# Troubleshooting

If something isn't working in Kilo Desktop, start here.

## The app can't reach the agent

Kilo Desktop runs the agent through a local server (a `kilo serve` process) that starts on demand. If chats fail to respond:

- Wait a moment after launch — the server starts the first time you open a chat and needs to report healthy before it accepts requests.
- Make sure you're signed in to your [Kilo account](/docs/desktop/settings/ai#ai-providers) so hosted models are available.
- Restart the app to relaunch the server.

## The Changes tab or branch switcher isn't available

Git integration needs your system `git`. If the tools are missing or not working:

- Confirm `git` is installed and on your `PATH`. 
- If the folder isn't a git repository, use **Initialize Git** in the Changes tab to create one. See [Git integration](/docs/desktop/features/git#set-up-git-for-a-folder).
- For bare or unsafe repositories, the branch switcher is intentionally hidden. Kilo Desktop shows a short explanation instead of a broken control.

## A local model isn't listed in a chat

Local models appear in the model picker only after you're signed in to your [Kilo account](/docs/desktop/settings/ai#ai-providers), the **Local Model Server** is enabled, and you've imported a model. Check the [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings.
