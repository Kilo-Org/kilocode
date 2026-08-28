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

The tool window toolbar has labeled create actions: **+ Session** starts a new session in the Chat tab, and **+ Worktree** opens the New Worktree dialog in the Agents tab.

When a chat has no session yet, the empty state reflects where you are working. On a plain branch it suggests keeping changes isolated and offers a **run it in a worktree** link that opens the New Worktree flow; in a worktree it confirms that your main checkout stays untouched.

### Working with worktrees

- The worktree list shows each session's activity state with compact status icons and badges, including a running indicator for active sessions.
- Drag worktrees to reorder them; the order is persisted and selection stays stable across refreshes.
- Session history is scoped to the current worktree, so sessions from the main checkout or sibling worktrees are not mixed in. Sessions started from a worktree's separate IDE frame also appear in Agent Manager.
- In a worktree editor tab, the session-list toggle hides or shows the session list. The choice is remembered per worktree. While the list is hidden, the toggle shows the session count or flags a background session that needs your attention, so a pending question stays visible.

### Chat branch dock

When the workspace is a git repository, the chat header shows a branch dock with the current branch, a file-change summary, and worktree actions:

- **New Worktree** — open the New Worktree dialog, which has three tabs: **New** creates a worktree on a new branch with an optional initial prompt, **From PR** imports a GitHub pull request by URL, and **From Branch** imports an existing local branch that no worktree is using yet. Imported PR branches get git tracking set up, so `git push` and `git pull` work in the new worktree.
- **Move to Worktree** — move the conversation and your current local changes into a dedicated worktree for isolated follow-up work. Available whenever the repository has local changes, even before the chat has a session.

When the branch has an associated pull request, the dock shows the PR badge and title with access to the diff. Worktree actions appear only while the session is idle.

## Mermaid diagrams in chat

Chat renders `mermaid` and `mmd` code fences as inline diagrams. Flowcharts (`flowchart`/`graph`) and sequence diagrams (`sequenceDiagram`) are supported; other Mermaid diagram types fall back to the source with a render note. While a reply is still streaming, or if a diagram fails to render, the fence shows its source instead.

- **Viewer window** — click a rendered diagram to open it in a resizable viewer with zoom controls, trackpad pinch zoom, Cmd/Ctrl+wheel zoom, drag to pan, and double-click to fit.
- **Editor tab** — use the open action on a diagram's toolbar to open it in its own editor tab with a rendered **Diagram** view and a read-only **Source** view.
- **Copy** — copying a rendered diagram puts the picture (PNG) on the clipboard. While streaming or after a render error, copy falls back to the Mermaid source.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — when the workspace differs from the base branch, the session header shows a changes badge. Click it (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.

## Turn failures and retries

When a turn fails — for example from a provider error or missing provider credentials — the transcript ends with an error card showing the failure details and a **Retry** action. Retry replays the failed turn using the model and agent selected at that moment, so you can switch away from an unavailable provider and press **Retry** to continue the conversation.

Pressing **Stop** is not treated as a failure. The transcript shows a short "Stopped" note, and the session does not get an error badge in the history, recents, or Agent Manager worktree rows.
