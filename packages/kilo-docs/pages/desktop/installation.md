---
title: "Installation"
description: "Install Kilo Desktop and complete first-time setup, including optional dependencies for git and local model features."
---

# Installation

Kilo Desktop is distributed as a native installer for your operating system. Download the installer, run it, and launch the app.

## System requirements

- **Operating system:** macOS (Apple Silicon), Windows (`x64`), or Linux (`x64`).
- **Account:** a [Kilo account](/docs/desktop/settings/ai#ai-providers). Signing in is required to use hosted models as well as certain in-app features.

## Install the app

1. Download the [Kilo Desktop installer](https://kilo.ai/install) for your platform.
2. Run the installer and follow the prompts.
3. Launch Kilo Desktop.

## Optional dependencies

Some capabilities rely on tools already installed on your system:

- **Git integration** uses your system `git`. Install git to review changes and switch branches from a chat. See [Git integration](/docs/desktop/features/git).
- **Environments** and **local inference** use a conda runtime that the app provisions for you. See [Environments](/docs/desktop/features/environments).
- **Local inference** also needs a model file in **GGUF format** (`.gguf`) that you provide. Import one from the [Local Model Server](/docs/desktop/settings/ai#local-model-server) settings. See [Local inference](/docs/desktop/features/local-inference).

## After installing

Continue to the [Quickstart](/docs/desktop/quickstart) page to learn how to open a workspace and start your first chat.
