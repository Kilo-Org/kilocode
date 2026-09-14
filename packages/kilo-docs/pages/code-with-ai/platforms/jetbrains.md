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
- **Integrations** — control the GitHub integration. Kilo uses the GitHub CLI (`gh`) to resolve pull requests for worktrees. Turning it off stops Kilo from running `gh`: pull request badges and pull request import disappear. The setting is on by default, and the `gh` warning banner can also turn it off. GitHub state refreshes when you return to the IDE or switch between the Chat and Agents tabs.
- **Advanced → Index agent worktrees** — include Kilo-managed worktrees under `.kilo/worktrees` in the containing project's index. They are excluded by default, so a large worktree checkout does not slow down indexing or add duplicate results to Search Everywhere. Opening a worktree as its own project always indexes it fully. Changing the setting reindexes open projects.

## Worktrees

Worktrees give each task its own git checkout and branch, so parallel work does not disturb your main checkout. Create one with **New Worktree** in the session dock, or use **Move to Worktree** to move the current conversation and its local changes into a new worktree. If the workspace has unresolved merge conflicts, **Move to Worktree** stops and names the conflicted files instead of moving a partial change — resolve them first. The worktree list shows each worktree with its sessions, a changes summary, and a pull request badge when one is available. While a build or run configuration is active in a worktree, its row shows a live-run indicator, so a running dev server or build is visible without opening the worktree.

In the base checkout's worktree tab, the session list's row menu includes **Move to Worktree**, and the same **New Worktree** and **Move to Worktree** actions appear above the prompt. The tab header reports the base checkout's uncommitted changes — the changes a move would carry.

### Worktree setup script

Prepare a new worktree before the agent starts by adding a setup script inside the repository's `.kilo/` directory:

| Platform | Filename (checked in order) |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

Kilo runs the script automatically when it creates a worktree, in a terminal tab named `Setup: <worktree>`. It runs POSIX scripts with `sh`, `.ps1` with PowerShell, and `.cmd` / `.bat` with `cmd.exe`, so executable permissions are not required.

The worktree row menu also provides:

- **Run Worktree Setup** — run the script again in a terminal.
- **Open Worktree Setup** / **Create Worktree Setup** — open the resolved script, or create it from a template, in the editor.

Two variables are available to the script's environment:

| Variable | Value |
|---|---|
| `WORKTREE_PATH` | Absolute path to the worktree directory |
| `REPO_PATH` | Absolute path to the main repository |

### Build/Run configurations

The worktree editor's **Build/Run** toolbar button opens the **Run in Worktree** popup. It lists the project's run configurations that can run in the worktree, plus any processes already running there.

- Configurations the worktree can run directly are transplanted as-is.
- Module-based configurations — Spring Boot, Application, and Kotlin or Groovy application configurations — are handed to the same build-system integration the IDE's own run delegation uses, for example the Gradle integration behind **Delegate IDE build/run actions to Gradle**. Gradle resolves the classpath from the worktree's own build, so the run uses the worktree's code rather than the main checkout's. The popup describes these entries with their executing build system (for example, `Application · via Gradle`).
- If a framework's build integration declines the configuration, Kilo runs it as a plain JVM application and sends a notification naming the settings that could not come along.

The **Running** section lists each live process. **Stop** asks it to terminate gracefully; if an application outlives its build, use **Kill**. **Show Output** opens the process's console. Removing a worktree stops its running applications. When the project has a linked external build system, the popup also offers **Build** and **Rebuild**, and **Open in New Frame** opens the worktree in a separate window for full run and debug support.

### Changes and pull requests

- **Changes summary** — each worktree row summarizes committed changes against the base branch. Select it to open **Changes vs base branch**. A separate indicator counts uncommitted files; select it, or choose **Open Uncommitted Changes** in the worktree row menu, to compare the working tree with `HEAD`. When the branch's pull request no longer merges into its base, the summary carries a red conflict marker and its tooltip leads with the conflict.
- **Pull request badge** — when the GitHub integration is on and `gh` is installed and authenticated, a worktree with an associated pull request shows a badge. Select it to open the pull request in your browser, or use the row menu to copy the pull request reference. When the pull request has unresolved review conversations, the badge shows a comment indicator with how many are unresolved. You can also import a pull request as a worktree.

### Forking a session

Fork a session to branch off from an earlier point without losing the original conversation. The fork copies the session's history into a new session that opens next to its source.

In the worktree editor, fork from any of these places:

- The session list row menu (**Fork Session**)
- The session's right-click menu or the prompt bar's more menu (**Fork Session**)
- The hover toolbar on any user prompt, to fork from that message

The fork starts with a note telling the agent it is a fork and which worktree directory it now works in. Forking is available in the Agent Manager worktree editor, including worktrees linked to your base checkout. The sidebar chat and read-only subagent tabs do not offer it.

## Session modes and interruptions

Picking a mode in the chat prompt applies to the current session and is remembered as the mode for new sessions. It does not change the CLI's global default agent, so switching modes does not interrupt tasks running in other worktrees.

When Kilo stops a running task for you — for example because a configuration, provider, or organization change made it reload — the session shows why it stopped and offers **Retry**, and Kilo raises a notification. This distinguishes a task Kilo stopped on its own from one you stopped yourself.

### Selector shortcuts

Cycle the prompt bar's mode, model, and reasoning-effort selectors without the mouse while a Kilo session is active:

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Cycle to the next mode (skips deprecated modes) |
| `Ctrl+2` | Cycle to the next favorite model, or the next recommended model when there are no favorites |
| `Ctrl+3` | Cycle the current model's reasoning-effort options |
| `Ctrl+0` | Clear the per-agent model override, like the selector's reset icon |

The shortcuts use `Ctrl` on macOS as well, work anywhere in a Kilo session (tool window, editor tab, or worktree session editor), and appear in **Settings → Keymap** so you can rebind them.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** — the session header shows a badge for committed changes against the base branch and a separate badge for uncommitted changes. Select the branch badge (**Compare with base branch**) to open a diff editor with a file tree and per-file navigation, or select the uncommitted badge to compare the working tree with the last commit. In a worktree, **Compare to Base** shows everything the branch changes against its base, including uncommitted work.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.
