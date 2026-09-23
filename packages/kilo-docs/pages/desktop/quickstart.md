---
title: "Quickstart"
description: "Sign in, open a workspace, and start your first agentic chat in Kilo Desktop."
---

# Quickstart

This guide walks you through your first session in Kilo Desktop. If you haven't installed the app yet, see [Installation](/docs/desktop/installation).

## 1. Complete onboarding

On first launch, a short setup wizard walks you through two steps.

### Connect to Kilo

Sign in to your **Kilo account** to use frontier models, credits, and organization settings through the [Kilo Gateway](/docs/gateway). You can skip this step and connect later from [Settings](/docs/desktop/settings#ai-providers).

### Create a workspace

A workspace scopes a chat to a folder on your machine. Add the folder you want the agent to work in; the agent's file access, terminal, and git operations all run inside it. You can add more workspaces anytime. 

{% callout type="note" %}
Signing in to an **Anaconda account** is optional and separate from onboarding. Add it later from [Settings](/docs/desktop/settings#accounts-and-authentication) to unlock the downloadable model catalog for [local inference](/docs/desktop/features/local-inference) and the [Anaconda MCP](https://anaconda.com/docs/anaconda-mcp/main) connection.
{% /callout %}

## 2. Start a chat

When Kilo Desktop opens, you land on a new chat that asks "What should we work on?".

The sidebar on the left manages your chats and workspaces:

- **New chat** starts a fresh conversation.
- **Search** finds your past chats.
- **Workspaces** lists the folders you've added and lets you switch between them.
- **Settings** opens from the bottom of the sidebar, alongside your account.

The rest of the window is where you chat with the agent. Type a message, use `@` to mention workspace files, or `/` to run a command. The controls around the input let you:

- **Add an attachment** with the **+** button.
- **Choose an agent** to set how it approaches your request. Pick one of the default agents: Code, Plan, Ask, Debug, or Architect, or create your own. See [Using agents](/docs/code-with-ai/agents/using-agents) for what each one does.
- **Pick a model** for the chat. The available models depend on how you're signed in and which providers you've connected. The list can include [Kilo Gateway](/docs/gateway) models, provider models you've added, or a [local model](/docs/desktop/features/local-inference) you've downloaded.
- **Select a workspace** to scope the chat to a folder, add a **New workspace**, or choose **No workspace** to chat without one.

Enter your message and send it to start the conversation.

## 3. Use the workspace panels

Panels let you work in the same workspace alongside the chat. Open one with the **+** (**Add tab group**) button at the top of a chat, then pick a panel:

- **[Files](/docs/desktop/features/files)** -- browse and edit files in the workspace.
- **[Changes](/docs/desktop/features/git)** -- review uncommitted git changes.
- **[Notebook](/docs/desktop/features/notebooks)** -- analyze data in an interactive Python notebook.
- **[Browser](/docs/desktop/features/browser)** -- open web pages without leaving the app.
- **[Terminal](/docs/desktop/features/terminal)** -- run commands in an interactive shell.

Each panel opens as a tab with its own controls: **Expand** grows the panel to fill the workspace (select it again to collapse), **Pop out** moves the panel into its own window, and the close button removes it. Use the **+** (**Add tab**) beside a group's tabs to add another panel to the same group.

By default, each panel you open is added as a tab next to the others, and the tabs get narrower to fit your screen as you open more. Turn on **Carousel layout** to keep the tabs wider, then hold **Shift** and scroll with your mouse to pan across them. **Show chat** jumps you back to your conversation tab.

See [Features](/docs/desktop/features) for what each panel does, and [What you can ask](/docs/desktop/what-you-can-ask) for example prompts.
