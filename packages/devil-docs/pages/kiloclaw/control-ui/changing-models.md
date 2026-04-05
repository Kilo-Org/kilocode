---
title: "Changing Models"
description: "Browse and switch models from the Control UI chat"
---

# Changing Models

The Control UI Chat tab doubles as a command line for model management. KiloClaw exposes 335+ models through the `kilocode` provider and you can browse and switch between them without leaving the chat.

| Command                              | Description                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `/model status`                      | View the currently active model and provider                                    |
| `/models kilocode`                   | Browse available models (paginated, 20 per page)                                |
| `/models kilocode <page>`            | Jump to a specific page (e.g. `/models kilocode 2`)                             |
| `/model kilocode/<provider>/<model>` | Switch to a specific model (e.g. `/model kilocode/anthropic/claude-sonnet-4.6`) |
| `/models kilocode all`               | List every available model at once                                              |

Each `/models` response includes helper text at the bottom with shortcuts for switching, paging, and listing all models.

To change the default model for all new sessions, edit `agents.defaults.model.primary` in your `openclaw.json` via **Config** in the Control UI (or the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#changing-the-model) for a quick dropdown pick).

For the full list of providers, advanced configuration, and CLI commands, see the [OpenClaw Model Providers documentation](https://docs.openclaw.ai/providers).
