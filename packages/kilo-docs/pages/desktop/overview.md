---
title: "Overview"
description: "Kilo Desktop brings Kilo's agents to your machine, uniting coding, notebooks, terminals, git, and local models all in one place."
---

# Overview

{% callout type="generic" %}
Kilo Desktop is a desktop application that puts an agentic AI chat next to the tools you already use to write code and analyze data science notebooks. From a single conversation, you can ask the agent to write and edit code, run commands in a terminal, explore data in notebooks, review git changes, and more.
{% /callout %}

## What you can do

- Chat with an AI agent scoped to a workspace folder on your machine.
- Explore and visualize data in interactive Python notebooks next to your chat and let the agent build, run, and iterate on them with you.
- Put the agent to work in your workspace: edit files, run terminal commands, review git changes, and browse the web, all from the conversation.
- Run models locally or connect to hosted providers through the [Kilo Gateway](/docs/gateway).
- Manage conda environments and packages without leaving the app.

## How it works

Kilo Desktop runs on the same agent engine as the rest of Kilo. It starts a local copy of the [Kilo CLI](/docs/code-with-ai/platforms/cli) on your machine and drives it through a chat interface, so your sessions use the same runtime that powers the CLI and the [VS Code extension](/docs/code-with-ai/platforms/vscode), with your configuration and sessions kept local to your machine.

Because the app is model-agnostic, you decide where inference happens. Connect hosted models through the [Kilo Gateway](/docs/gateway), bring your own provider API keys, or [run models locally](/docs/desktop/features/local-inference). You're never locked into a single provider and can choose which model works best for your current task.

## Where to go next

- [Installation](/docs/desktop/installation) — Install Kilo Desktop on your machine.
- [Quickstart](/docs/desktop/quickstart) — Open a workspace and start your first chat.
- [What you can ask](/docs/desktop/what-you-can-ask) — Example prompts mapped to capabilities.
- [Features](/docs/desktop/features) — The capabilities available via chat.
- [General settings](/docs/desktop/settings/general) — your account, appearance, and app preferences.
- [AI settings](/docs/desktop/settings/ai) — AI providers, agent behavior, and local models.