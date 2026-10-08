---
title: "Kilo Code for JetBrains: Free Open-Source AI Coding Plugin"
description: "Using Kilo Code in JetBrains IDEs"
---

# Kilo Code for JetBrains: Free AI Coding Plugin

## Installation

{% partial file="install-jetbrains.md" /%}

## Settings

Open **Settings → Tools → Kilo Code** to configure the plugin. Shared agent settings use the same `kilo.jsonc` files as the CLI and VS Code extension; IDE-specific options such as GitHub integration and worktree indexing stay in the plugin. See [Settings](/docs/getting-started/settings) for config file locations and precedence.

- **Auto-Approve** — set per-tool permission levels (Allow / Ask / Deny) and manage granular command and path exceptions without editing config by hand. Permission prompts offer one-time approvals alongside saved allow/reject rules. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the shared permission model.
- **Context** — toggle auto-compaction, set the auto-compaction limit (the percentage of the model window that triggers compaction), enable pruning of old tool outputs, and manage file watcher ignore patterns. See [Context Condensing](/docs/customize/context/context-condensing) and [.kilocodeignore](/docs/customize/context/kilocodeignore) for what these settings control.
- **Agent Behavior → Skills** — inspect loaded skills, add extra skill sources (local paths or remote URLs), edit or remove custom skills, and open skill files in the editor. See [Skills](/docs/customize/skills) for the skill format and discovery rules.
- **Agent Behavior → MCP Servers** — connect or disconnect MCP servers, sign in to remote servers that use OAuth, reset sign-in, and edit or remove servers. See [MCP servers](#mcp-servers).
- **Integrations** - enable or disable the GitHub integration for pull request badges and imports. It requires the GitHub CLI (`gh`) to be installed and authenticated.
- **Advanced → Index agent worktrees** - include `.kilo/worktrees` in the containing project's index. Worktrees are excluded by default to avoid duplicate search results. Files opened from an excluded worktree in the main IDE window lack code resolution and inspections; open the worktree as its own project for full indexing.

## MCP servers

MCP servers extend the agent with external tools. The plugin reads and writes the same `mcp` entries in your shared `kilo.jsonc` files as the CLI and VS Code extension, so servers you configure there also appear here. To add a server, ask the agent to add it and it writes the entry into your Kilo config.

Open **Settings → Tools → Kilo Code → Agent Behavior → MCP Servers** to see configured servers. Each row shows its connection state — **connected**, **failed**, **needs auth**, **needs registration**, or **disabled** — and offers only the actions valid for that state, such as Connect, Disconnect, Sign In, Reset sign-in, Edit, or Delete. See [Using MCP in Kilo Code](/docs/automate/mcp/using-in-kilo-code) for the config format and tool permissions.

### Signing in to a remote MCP server

Remote servers that use OAuth appear as **needs auth** with a **Sign In** action. Kilo opens the authorization page in the browser on your own machine, so sign-in also works in remote development. While a sign-in is pending, a progress bar lets you cancel it without discarding credentials you already had. If the browser cannot be opened automatically, Kilo shows the authorization URL in a dialog so you can open or copy it. When sign-in finishes or fails, a notification reports the outcome, including the server's own error message.

Use **Reset sign-in** on a connected remote server to clear its stored credentials so you can sign in again.

### OAuth client settings

The edit dialog includes OAuth settings for remote servers. Leave **Mode** on **Automatic** unless the server requires a pre-registered client. Choose **Disabled** to turn off OAuth, or **Custom client** to provide a Client ID, client secret, scope, callback port, or redirect URI. The client secret is stored in your Kilo config file.

### Marketplace installs

After you install an MCP server from the Marketplace that needs sign-in, Kilo offers to start sign-in right away. When a configured server needs authentication, the prompt shows a **Session issues** menu with a sign-in action. Removing a Marketplace MCP server and its companion skills from either MCP or Skills settings confirms and removes the whole bundle.

## Chat and worktrees

Use **Chat** for the current workspace and **Agents** to manage parallel tasks in isolated git worktrees. **+ Session** starts a conversation; **+ Worktree** opens the worktree creation dialog.

- **New Worktree** creates a new branch, imports a GitHub pull request with **From PR**, or uses an available local branch with **From Branch**.
- **Move to Worktree** moves the conversation and uncommitted changes into a new worktree while the session is idle. This action is also available from the main checkout's session list.
- Open a worktree to see its sessions in an editor tab. Its session list is scoped to that worktree; use the list toggle to hide or show it and drag worktree rows to reorder them.
- Worktree rows show session activity, pull request checks and reviews, unresolved review conversations, merge conflicts, and active build/run processes. Use the row menu to copy the branch name, directory, or pull request reference.

### Worktree setup scripts

Add a setup script to install dependencies or prepare configuration in new worktrees. Kilo starts it automatically in a terminal, but **does not wait for it to finish before starting the session**. Wait for setup to complete before asking the agent to use those dependencies or generated files.

| Platform | Filename (checked in order) |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

The terminal runs in the worktree directory with `WORKTREE_PATH` (the worktree directory) and `REPO_PATH` (the repository root) available as environment variables. Use the worktree row menu to create or open the script, or choose **Run Worktree Setup** to run it again.

### Running code in a worktree

Open **Build/Run** in the worktree editor to choose a supported IDE run configuration. Eligible Application, Spring Boot, and Kotlin/Groovy application configurations can run through the project's build system using the worktree's code. Support depends on the configuration and build-system integration; the popup identifies the build system used. A plain-application fallback may omit framework settings, which Kilo reports in a notification.

Use **Show Output** to view a running process's console, **Stop** to stop it, or **Kill** if it remains running. **Build** and **Rebuild** are available for supported build systems. Removing a worktree stops its running processes. For unsupported configurations or full IDE run and debug support, choose **Open in New Frame**.

### Forking a session

Use **Fork Session** in a worktree session's row menu, right-click menu, or prompt bar's more menu to try another approach without losing the original conversation. To branch from an earlier message, use that user message's hover toolbar. The copied conversation opens as a new session next to its source; forking does not create a separate worktree.

## Diagrams in chat

Ask Kilo for a Mermaid diagram to visualize a workflow, architecture, data relationship, or timeline. Chat renders `mermaid` and `mmd` code blocks inline, with source shown while streaming or if rendering fails.

Click a diagram to open a zoomable viewer, or use its toolbar to open an editor tab with **Diagram** and read-only **Source** views. Copying a rendered diagram copies a PNG; copying while it is still streaming or after a render error copies the source instead.

## Navigating prompts

The chat transcript shows a prompt navigator: a vertical rail of ticks along the right edge, one tick per prompt. The rail appears when the session has two or more prompts, and the tick for the prompt you are viewing is highlighted.

- Click a tick to scroll the transcript to that prompt.
- Hover a tick to open the **Prompt navigator**, a list of every prompt with a preview of its response, or **No response yet** when the response has not started. Use the up and down buttons to jump to the first or latest prompt, or click a row to jump to that prompt. Double-click a row, or press `Enter`, to jump and close the list.
- A queued prompt is marked with a distinct tick color and labelled **Queued** in the list.
- When the session has more prompts than the rail can show, a dashed tick stands in for the prompts that do not have their own tick. Click the dashed tick to open the full list.

The rail sits to the right of the transcript. In a narrow sidebar, where there is no free gutter, it moves over the scrollbar column so it stays reachable.

## Reviewing session changes

- **Modified files per turn** — each assistant turn that changed files shows a **Modified** card with the affected files and their diff stats. Expand a file to see its diff inline, or open all of the turn's changes in the **Changed files** diff viewer.
- **Branch comparison** - use the session header's **Compare with base branch** badge to open a diff editor with a file tree and per-file navigation. A separate uncommitted-changes badge compares local edits with the last commit.
- **Stale diff refresh** — diff views detect when files change on disk and offer a **Refresh** action to reload them instead of showing outdated content.

Worktree rows separate committed changes against the base branch from uncommitted changes. Select the uncommitted-changes badge to compare with `HEAD`, or use **Compare to Base** in the session menu to review the branch's changes including uncommitted work.

## Session controls

Right-click in a session or open the prompt bar's more menu to compare changes, copy the session ID, or share the conversation. **Share Session** creates a public link; **Stop Sharing** revokes it. Sharing requires signing in to Kilo and must be allowed by your configuration. The right-click menu also includes **Stop Session**. Its **Auto-Approve** toggle applies across Kilo sessions in the IDE, not just the current conversation.

If a turn fails, use **Retry** after resolving the problem or selecting a different model or agent. Retry uses the current selections. A turn you stop yourself is marked as stopped, not as a failure.

### Keyboard shortcuts

These shortcuts work while a Kilo session is active. They use `Ctrl` on macOS too, and can be changed in **Settings → Keymap**.

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Cycle modes |
| `Ctrl+2` | Cycle favorite models, or recommended models if you have no favorites |
| `Ctrl+3` | Cycle reasoning effort for the current model |
| `Ctrl+0` | Reset the model override |

## Permission requests

When the agent asks for several approvals at once, permission requests queue up instead of replacing each other. Resolve the current request to advance to the next one in the queue.
