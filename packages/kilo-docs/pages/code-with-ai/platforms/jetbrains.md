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
- **Advanced → Index agent worktrees** — worktrees under `.kilo/worktrees` are excluded from the project's index by default, so active Agent Manager worktrees do not slow down indexing or produce duplicate results in Search Everywhere and Go to File. Turn this on to index them anyway; changing it reindexes open projects. Opening a worktree as its own project always indexes it fully. Note that files opened from an excluded worktree in the main frame lose code resolution and inspections.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — when the workspace differs from the base branch, the session header shows a changes badge. Click it (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Working with worktrees

The **Agents** tab of the Kilo Code tool window runs sessions in isolated git worktrees, and each worktree's sessions open in a dedicated editor tab. The tab for your main checkout — the repository's base working tree, not a linked worktree — can also start worktree flows directly, without switching back to the tool window:

- **Move to Worktree** — the session list's row menu leads with **Move to Worktree**, which moves the conversation and your uncommitted changes into a new worktree for isolated follow-up work. The action hides while the session is running.
- **New Worktree / Move to Worktree toolbar** — sessions in the main checkout's tab show the same toolbar above the prompt that the **Agents** panel shows.
- **Uncommitted changes** — the tab header reports the main checkout's uncommitted change counts, which are exactly what a move carries. Linked worktree tabs keep the plain session view.

### Forking a session

Forking copies a session's history into a new session, so you can branch off and try a different approach without losing the original conversation. In a worktree session editor, **Fork Session** is available from:

- the session list's row menu,
- the session's right-click menu and the prompt bar's "more" menu,
- every user prompt's hover toolbar, which forks the session at that message.

The forked session opens next to its source and starts with a hidden note telling the agent it is running in a fork and which directory it now works in.

### Worktree list status

Each row in the **Agents** tab worktree list shows what needs attention without opening the worktree:

- **Pull request status** — when the worktree branch has a pull request, the row shows its state, review verdict, and CI checks, plus how many review conversations are still unresolved. Hover the row for a popup with details and links that open the pull request or its checks on GitHub.
- **Merge conflicts** — a worktree whose pull request no longer merges against its base branch is marked with a conflict badge.
- **Run indicator** — a green dot appears on the row's icon while a run configuration is active in that worktree.

Row text that does not fit the list width fades into the row background instead of ending in an ellipsis.

### Running code in a worktree

The worktree's **Build/Run** popup runs the project's run configurations inside the worktree, so the worktree's own code executes instead of the main checkout's:

- Module-based configurations — Spring Boot, Application, and Kotlin/Groovy application run configurations — are delegated to the project's build system (typically Gradle), which resolves the classpath from the worktree's own build. The popup marks which build system will execute each configuration.
- When a framework's build system integration declines a configuration (for example, Spring Boot with "Run using Gradle" turned off), Kilo runs it as a plain application instead and lists which of the configuration's settings could not come along.
- Stopping a run terminates the application gracefully, with a **Kill** option for a process that outlives its build. Removing a worktree also stops its running processes.

## Keyboard shortcuts

The chat's mode, model, and reasoning effort pickers can be cycled from the keyboard. Each shortcut is a registered action, so it appears in **Settings → Keymap** and can be rebound.

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Cycle to the next mode |
| `Ctrl+2` | Cycle to the next favorite model (or recommended model when no favorites are set) |
| `Ctrl+3` | Cycle to the next reasoning effort for the current model |
| `Ctrl+0` | Reset the model override to the default |

The same `Ctrl` shortcuts apply on macOS (not `Cmd`). The shortcuts work from anywhere in a Kilo session — tool window, editor tab, or worktree session editor — and are also shown in the prompt bar's picker tooltips.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.
