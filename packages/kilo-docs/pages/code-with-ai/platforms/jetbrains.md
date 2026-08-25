---
title: "Kilo Code for JetBrains: Free Open-Source AI Coding Plugin"
description: "Using Kilo Code in JetBrains IDEs"
---

# Kilo Code for JetBrains: Free AI Coding Plugin

## Installation

{% partial file="install-jetbrains.md" /%}

## Settings

Open **Settings → Tools → Kilo Code** to configure the plugin. The JetBrains plugin reads and writes the same shared `kilo.jsonc` config files as the CLI and the VS Code extension, so changes apply across clients. See [Settings](/docs/getting-started/settings) for config file locations and precedence.

- **Auto-Approve** — set per-tool permission levels (Allow / Ask / Deny) and manage granular command and path exceptions without editing config by hand. Permission prompts offer one-time approvals alongside saved allow/reject rules. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the shared permission model.
- **Context** — toggle auto-compaction, set the auto-compaction limit (the percentage of the model window that triggers compaction), enable pruning of old tool outputs, and manage file watcher ignore patterns. See [Context Condensing](/docs/customize/context/context-condensing) and [.kilocodeignore](/docs/customize/context/kilocodeignore) for what these settings control.
- **Agent Behavior → Skills** — inspect loaded skills, add extra skill sources (local paths or remote URLs), edit or remove custom skills, and open skill files in the editor. See [Skills](/docs/customize/skills) for the skill format and discovery rules.

## Chat and Agents tabs

The Kilo Code tool window is split into two tabs:

- **Chat** — the conversation with the agent in the current workspace.
- **Agents** — the Agent Manager, a control panel for running and orchestrating multiple agents in parallel, each in its own git worktree. A notification dot appears on the tab when a worktree session needs attention.

### Working with worktrees

- The worktree list shows each session's activity state with compact status icons and badges, including a running indicator for active sessions.
- Drag worktrees to reorder them; the order is persisted and selection stays stable across refreshes.
- Session history is scoped to the current worktree, so sessions from the main checkout or sibling worktrees are not mixed in. Sessions started from a worktree's separate IDE frame also appear in Agent Manager.

### Chat branch dock

When the workspace is a git repository, the chat header shows a branch dock with the current branch, a file-change summary, and worktree actions:

- **New Worktree** — create a new git worktree with its own branch and session.
- **Move to Worktree** — move the conversation and your current local changes into a dedicated worktree for isolated follow-up work. Available whenever the repository has local changes, even before the chat has a session.

When the branch has an associated pull request, the dock shows the PR badge and title with access to the diff. Worktree actions appear only while the session is idle.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — when the workspace differs from the base branch, the session header shows a changes badge. Click it (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.
