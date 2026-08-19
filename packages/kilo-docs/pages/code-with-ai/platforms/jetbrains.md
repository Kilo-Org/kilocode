---
title: "Kilo Code for JetBrains: Free Open-Source AI Coding Plugin"
description: "Using Kilo Code in JetBrains IDEs"
---

# Kilo Code for JetBrains: Free AI Coding Plugin

## Installation

{% partial file="install-jetbrains.md" /%}

## Agent Manager (Beta)

The Kilo Code tool window has two tabs: **AI Chat** for the regular session view and **Agent Manager** (marked Beta) for running several agents in parallel, each isolated in its own git worktree. Worktrees live under `.kilo/worktrees/` in your project, so agent work stays off your current branch until you merge it. See [Agent Manager](/docs/automate/agent-manager) for the general concepts.

### Creating Worktrees

1. Open the **Agent Manager** tab in the Kilo Code tool window.
2. Click **New Worktree** in the tool window toolbar.
3. Describe the task — the dialog uses the standard prompt with mode, model, and effort controls — and optionally set a worktree name, branch name, and base branch.
4. Click **Create Worktree**. The agent starts working in a session inside the new worktree.

### Managing Worktrees and Sessions

- Each worktree's sessions open in dedicated editor tabs, and a worktree can hold multiple sessions.
- Hover a worktree or session row to rename or delete it. Deleting a worktree removes the working tree and its branch.
- Rows show activity badges (running, waiting, idle), change counts, and ahead/behind counts against the base branch. Click the stats to open the diff against the base branch.
- Worktrees show pull request badges with the PR state when Git and the [GitHub CLI](https://cli.github.com/) are installed and authorized; click a badge to open the PR in your browser. A banner in the panel tells you when either needs to be installed or authorized.
- Row actions also open a terminal rooted at the worktree, or the whole worktree in a new IDE window.

## Editor context in chat

When you send a chat message, Kilo automatically includes context from the IDE so the agent can see what you're working on:

- The active file
- Your open and visible editor tabs
- The current text selection
- The default shell

Files matched by `.kilocodeignore` are excluded (or by `.gitignore` plus `.env` files when the workspace has no `.kilocodeignore`). To turn this off, open **Settings → Tools → Kilo Code**, go to **Context**, and disable **Auto-Include Editor Context**.

Selected text and attached files appear as compact attachment chips inside your sent message. Click a chip to open the referenced file or selection.

## Settings

Open **Settings → Tools → Kilo Code** to configure the plugin, or click the gear icon in the Kilo Code tool window. The JetBrains plugin reads and writes the same shared `kilo.jsonc` config files as the CLI and the VS Code extension, so changes apply across clients. See [Settings](/docs/getting-started/settings) for config file locations and precedence.

- **Auto-Approve** — set per-tool permission levels (Allow / Ask / Deny) and manage granular command and path exceptions without editing config by hand. Permission prompts offer one-time approvals alongside saved allow/reject rules. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the shared permission model.
- **Context** — toggle auto-compaction, set the auto-compaction limit (the percentage of the model window that triggers compaction), enable pruning of old tool outputs, manage file watcher ignore patterns, and toggle **Auto-Include Editor Context** for chat prompts. See [Context Condensing](/docs/customize/context/context-condensing) and [.kilocodeignore](/docs/customize/context/kilocodeignore) for what these settings control.
- **Agent Behavior → Skills** — inspect loaded skills, add extra skill sources (local paths or remote URLs), edit or remove custom skills, and open skill files in the editor. See [Skills](/docs/customize/skills) for the skill format and discovery rules.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — when the workspace differs from the base branch, the session header shows a changes badge. Click it (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.
