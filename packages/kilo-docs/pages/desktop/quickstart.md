---
title: "Quickstart"
description: "Sign in, open a workspace, and start your first agentic chat in Kilo Desktop."
---

# Quickstart

This guide walks you through your first session in Kilo Desktop. If you haven't installed the app yet, see [Installation](/docs/desktop/installation).

## Complete onboarding

On first launch, a short setup wizard walks you through the setup steps.

### 1. Review the terms of service

Review and accept Kilo's [terms of service](https://kilo.ai/terms).

### 2. Connect to Kilo

Sign in to your **Kilo account** to use frontier models, credits, and organization settings through the [Kilo Gateway](/docs/gateway). You can skip this step and connect later from [Settings](/docs/desktop/settings/ai#ai-providers). 

{% callout type="note" %}
A Kilo account is also required to use [conda environments](/docs/desktop/features/environments), [local models](/docs/desktop/features/local-inference), and [notebooks](/docs/desktop/features/notebooks). You can sign in during onboarding or later from the **Account** section in [Settings](/docs/desktop/settings/general#account).
{% /callout %}

### 3. Choose an autonomy level

Choose whether you want Kilo to operate with high autonomy or review its work first, pausing to show its plan and ask for your approval before it edits files or runs commands.

### 4. Create a workspace

A workspace scopes a chat to a folder on your machine. Add the folder you want the agent to work in; the agent's file access, terminal, and git operations all run inside it. You can add more workspaces anytime. 

## Navigate the home screen

When Kilo Desktop opens, you land on a new chat in the workspace you created during setup.

{% image src="/docs/img/desktop/quickstart-home-screen.png" alt="The Kilo Desktop home screen with the sidebar and a new chat" width="800" /%}

### Sidebar

The sidebar on the left manages your chats and workspaces.

- **New chat** starts a fresh conversation.
- **Search** finds your past chats.
- **Workspaces** lists the folders you've added. Select the dropdown to switch to a different workspace or create a new one. Use the filter to organize the list — group by **Status**, **Workspace**, or **Updated**, order by **Updated** or **Title**, choose what each row shows, and filter by status (**Needs attention**, **Working**, **Idle**, or **Archived**).

### Settings

Access the app settings by clicking the {% svgIcon src="/docs/img/desktop/settings.svg" /%} settings icon at the bottom of the sidebar. See [General settings](/docs/desktop/settings/general) and [AI settings](/docs/desktop/settings/ai) for details.

## Chat with the agent

The rest of the window is where you chat with the agent. Type a message, use `@` to mention workspace files, or `/` to run a command.

### Input controls

The controls around the input let you:

- **Add an attachment** with the **+** button.
- **Choose an agent** to set how it approaches your request. Pick one of the default agents: Code, Plan, Ask, Debug, or Architect, or create your own. See [Using agents](/docs/code-with-ai/agents/using-agents) for what each one does.
- **Select autonomy level** for the agent. With **Manually approve**, Kilo asks before each file edit or command; with **Automatically approve**, it proceeds on its own without requesting permission.
- **Pick a model** for the chat. The available models depend on how you're signed in and which providers you've connected. The list can include [Kilo Gateway](/docs/gateway) models, provider models you've added, or a [local model](/docs/desktop/features/local-inference) you've added.
- **Select a workspace** to scope the chat to a folder, add a **New workspace**, or choose **No workspace** to chat without one.
- **Set where changes go** with the git controls beside the workspace — work in your **Local** repository (switching or creating **branches** as needed), or run the session in a **new worktree**, an isolated copy created from a base branch. See [Git integration](/docs/desktop/features/git).

### Send your first message

Enter your message and send it to start the conversation. See [What you can ask](/docs/desktop/what-you-can-ask) for prompts to get you started.

## Work in panels

Panels let you work in the same workspace alongside the chat. Send a message to access the panels view.

{% image src="/docs/img/desktop/quickstart-panels.png" alt="A chat with panels open beside it in Kilo Desktop" width="800" /%}

### Open a panel

Open a panel with the **+ Add tab group** button at the top of a chat:

{% image src="/docs/img/desktop/quickstart-add-tab-group-button.png" alt="The Add tab group button at the top of a chat" width="800" /%}

Then, pick a panel:

- **[Files](/docs/desktop/features/files)** — browse and edit files in the workspace.
- **[Changes](/docs/desktop/features/git)** — review uncommitted git changes.
- **[Notebook](/docs/desktop/features/notebooks)** — analyze data in an interactive Python notebook.
- **[Browser](/docs/desktop/features/browser)** — open web pages without leaving the app.
- **[Terminal](/docs/desktop/features/terminal)** — run commands in an interactive shell.

### Arrange panels

Each panel opens as a tab with its own controls: {% svgIcon src="/docs/img/desktop/maximize-2.svg" /%} **Expand** grows the panel to fill the workspace (select it again to collapse), {% svgIcon src="/docs/img/desktop/external-link.svg" /%} **Pop out** moves the panel into its own window, and the {% svgIcon src="/docs/img/desktop/x.svg" /%} close button removes it. Use {% svgIcon src="/docs/img/desktop/plus.svg" /%} **Add tab** beside a group's tabs to add another panel to the same group.

By default, each panel you open is added as a tab next to the others, and the tabs get narrower to fit your screen as you open more. Turn on {% svgIcon src="/docs/img/desktop/gallery-horizontal.svg" /%} **Carousel layout** to keep the tabs wider, then hold **Shift** and scroll with your mouse to pan across them.

{% svgIcon src="/docs/img/desktop/bot.svg" /%} **Show chat** jumps you back to your conversation tab.

### Save and reuse layouts

When you find a panel arrangement you like, save it as a **layout** and reuse it in other chats. A layout stores how your panels are arranged, not their contents — your chat history and the files, notebooks, or pages you had open aren't included.

Use the {% svgIcon src="/docs/img/desktop/panels-top-left.svg" /%} **Layouts** button at the top right of a chat to:

- **Save current layout** — name the arrangement and, optionally, **Use as default for new chats**. The dialog lists any open panels it can't recreate in a new chat (such as a specific file, notebook, or browser page).
- **Apply a layout** — select a saved layout from the menu to rearrange the current chat to match.
- **Manage layouts** — set or clear the default, update a layout from the current arrangement, rename it, or delete it.

The default layout applies to new chats only; existing chats stay as they are.