---
title: "Installation"
description: "Install and update Kilo Desktop, including optional dependencies for git and local model features."
---

# Installation

Kilo Desktop is distributed as a native installer for your operating system. Download the installer, run it, and launch the app.

## System requirements

- **Operating system:** macOS (Apple Silicon), Windows (`x64` or `ARM64`), or Linux (`x64` or `ARM64`).
- **Account:** a [Kilo account](/docs/desktop/settings/ai#ai-providers). Signing in is required to use the local model server, notebooks, and conda environments.

## Install the app

1. Download the [Kilo Desktop installer](https://kilo.ai/install) for your platform.
2. Run the installer and follow the prompts.
3. Launch Kilo Desktop.

## Optional dependencies

Some capabilities rely on tools already installed on your system:

- **Git integration** uses your system `git` (version 2.17 or newer). Install git to review changes and switch branches from a chat. See [Git integration](/docs/desktop/features/git).
- **Conda environments** and **local inference** use a conda runtime that the app provisions for you. See [Conda environments](/docs/desktop/features/environments).
- **Local inference** also needs a model file in **GGUF format** (`.gguf`). Download one from the model catalog or import your own in the [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings. See [Local inference](/docs/desktop/features/local-inference).

## Updates

Kilo Desktop checks for updates on its own, and you can check anytime with **Check for updates** in [Settings → About](/docs/desktop/settings/general#about).

- **macOS and Windows** — updates download in the background. When one is ready, select **Restart to update** in the sidebar or in **About** to install it.
- **Linux** — Kilo Desktop checks for updates but doesn't install them. When one is available, the sidebar shows **Update available** and **About** shows a **Download** button that opens the new `.deb` package in your browser. Install it with your package manager.

## After installing

Continue to the [Quickstart](/docs/desktop/quickstart) page to learn how to open a workspace and start your first chat.
