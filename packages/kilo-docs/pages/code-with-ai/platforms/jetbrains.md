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

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — when the workspace differs from the base branch, the session header shows a changes badge. Click it (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.

## Session actions

Right-click anywhere in a chat session to open the session context menu, or click the **more** button on the prompt bar for the same actions (except Copy and Stop, which live only in the right-click menu):

- **Stop Session** — stop the running turn
- **Auto-Approve** — approve permission prompts automatically; applies to every Kilo session in the IDE
- **Compare to Base** — open a diff of everything the session's branch changes against its base branch, including uncommitted work
- **Open Pull Request in Browser** / **Copy Pull Request Reference** — available when the session's branch has a pull request
- **Copy Session ID** — copy the session identifier to the clipboard
- **Share Session** — create a public link to the conversation and copy it to the clipboard. **Stop Sharing** revokes the link, and **Copy Share Link** copies the link of an already-shared session.

Sharing requires you to be signed in to Kilo, and is unavailable when sharing is disabled in your configuration.

## Running configurations in a worktree

In Agent Manager worktree sessions, the worktree editor header has a **Build/Run** dropdown that runs IDE run configurations against the selected worktree:

- **Start** — lists the supported run configurations (Gradle and command-line style types) and starts one inside the worktree. Command-line style configurations run with the worktree as their working directory and receive `WORKTREE_PATH` and `REPO_PATH` environment variables.
- **Running** — lists live worktree processes with **Stop** and **Show Output** actions. Stop behaves like the IDE's own Stop button, including a second press that force-kills processes that support it. Output opens in the Run tool window.
- **Build** / **Rebuild** — compile the worktree with the project's build tool, when the project supports it.

Configurations that rely on module classpaths are not listed, because they would run the main checkout's compiled classes. For full run and debug support, use **Open in New Frame** in the same dropdown to open the worktree in a separate IDE window.
