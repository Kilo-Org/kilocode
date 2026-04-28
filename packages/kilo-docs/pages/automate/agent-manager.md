---
title: "Agent Manager"
description: "Manage and orchestrate multiple AI agents"
---

# Agent Manager

The Agent Manager is a control panel for running and orchestrating multiple Kilo Code agents, with support for parallel worktree-isolated sessions.

{% tabs %}
{% tab label="VSCode" %}

The Agent Manager is a **full-panel editor tab** built directly into the extension. All sessions share the single `kilo serve` backend process. It supports:

- Multiple parallel sessions, each in its own git worktree
- A diff/review panel showing changes vs. the parent branch
- Dedicated VS Code integrated terminals per session
- Setup scripts and `.env` auto-copy on worktree creation
- Session import from existing branches, external worktrees, or GitHub PR URLs
- "Continue in Worktree" to promote a sidebar session to the Agent Manager

{% callout type="tip" %}
New to running multiple agents in parallel? The [Agent Manager Workflows](/docs/automate/agent-manager-workflows) guide walks through when to use the sidebar vs. the Agent Manager, how to pick tasks that parallelize well, and the common patterns for testing, reviewing, and integrating changes across worktrees.
{% /callout %}

## Opening the Agent Manager

- Keyboard shortcut: `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux)
- Command Palette: "Kilo Code: Open Agent Manager"
- Click the Agent Manager icon in the sidebar toolbar

The panel opens as an editor tab and stays active across focus changes.

## Working with Worktrees

Each Agent Manager session runs in an isolated git worktree on a separate branch, keeping your main branch clean.

### PR Status Badges

Each worktree item displays a **PR status badge** when its branch has an associated pull request. The badge shows the PR number (e.g. `#142`) and is color-coded to reflect the current state at a glance. Click the badge to open the PR in your browser.

{% callout type="info" %}
The GitHub CLI (`gh`) must be installed and authenticated for PR badges to work. If `gh` is missing or not logged in, badges won't appear.
{% /callout %}

#### How PRs are detected

The extension uses `gh` to automatically discover PRs for each worktree branch. Three strategies are tried in order:

1. **Branch tracking ref** — `gh pr view` resolves via the branch's tracking ref (works for fork PRs checked out with `gh pr checkout`)
2. **Branch name** — `gh pr view <branch>` matches same-repo branches pushed to origin
3. **HEAD commit SHA** — `gh pr list --search "<sha>"` as a last resort, matching PRs whose head ref points to the exact same commit

You can also import a PR directly from the advanced new worktree dialog: open the **New Worktree** dropdown and select **Advanced**, or press `Cmd+Shift+N` (macOS) / `Ctrl+Shift+N` (Windows/Linux), switch to the **Import** tab, then paste the GitHub PR URL. The branch is checked out and the badge appears automatically.

#### Badge colors

The badge color reflects the most important signal, evaluated in priority order:

| State             | Color            | Condition                                                    |
| ----------------- | ---------------- | ------------------------------------------------------------ |
| Draft             | Gray             | PR is in draft state                                         |
| Merged            | Purple           | PR has been merged                                           |
| Closed            | Red              | PR was closed without merging                                |
| Checks failing    | Red              | Any CI check has failed                                      |
| Changes requested | Yellow           | A reviewer requested changes                                 |
| Checks pending    | Yellow (pulsing) | CI checks are still running                                  |
| Open (default)    | Green            | PR is open, no failing or pending checks, no blocking review |

When checks are pending on an open PR, the badge pulses to indicate activity.

#### Badge icon

The badge shows a **checkmark** icon when the PR review status is "Approved", and a **branch** icon in all other cases.

#### Hover card details

Hovering over a worktree item shows a card with additional PR details:

- **PR number** with a link icon to open it in the browser
- **State** — Open, Draft, Merged, or Closed
- **Review** — Approved, Changes Requested, or Pending (when a review exists)
- **Checks** — how many checks passed out of the total (e.g. `8/10 passed`)

#### Automatic updates

PR badges update automatically in the background. The active worktree refreshes frequently, while other worktrees sync periodically to keep badges current. Polling pauses when the Agent Manager panel is hidden.

### Creating a New Worktree Session

1. Click **New Worktree** or press `Cmd+N` (macOS) / `Ctrl+N` (Windows/Linux) to create a new worktree
2. Enter a branch name (or let Kilo generate one)
3. Type your first message to start the agent

A new git worktree is created from your current branch. The agent works in isolation — your main branch is unaffected.

### Multi-Version Mode

You can run up to 4 parallel implementations of the same prompt across separate worktrees:

1. Click the multi-version button and enter a prompt
2. Optionally assign different models to each version
3. Kilo creates one worktree + session per version and runs them in parallel

### Importing Existing Work

- **From a branch:** Import an existing git branch as a worktree
- **From a GitHub PR URL:** Paste a PR URL to import it as a worktree
- **From an external worktree:** Import a worktree that already exists on disk
- **Continue in Worktree:** From the sidebar chat, promote the current session to a new Agent Manager worktree

## Sections

Sections let you group worktrees into collapsible, color-coded folders in the sidebar. Use them to organize your workflow however you like — by status ("Review Pending", "In Progress"), by project area ("Frontend", "Backend"), priority, or any other scheme that fits.

### Creating a Section

- **Right-click** any worktree and select **New Section** from the context menu
- A new section is created with a random color and enters rename mode immediately — type a name and press `Enter`

### Assigning Worktrees to Sections

**Via context menu:** Right-click a worktree, hover **Move to Section**, and pick a section from the list. Select **Ungrouped** to remove it from its current section.

**Via drag and drop:** Drag a worktree and drop it onto a section header to move it there.

Multi-version worktrees (created via Multi-Version Mode) are moved together — assigning one version to a section moves all versions in the group.

### Renaming

Right-click the section header and select **Rename Section**. An inline text field appears — type the new name and press `Enter` to confirm or `Escape` to cancel.

### Colors

Right-click the section header and select **Set Color** to open the color picker. Eight colors are available (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta) plus a **Default** option that uses the standard panel border color. The selected color appears as a left border stripe on the section.

### Reordering

Right-click the section header and use **Move Up** / **Move Down** to reposition it in the sidebar. Sections and ungrouped worktrees share the same ordering space.

### Collapsing

Click the section header to toggle it open or closed. Collapsed sections hide their worktrees and show only the section name and a member count badge. Collapse state is persisted across reloads.

### Deleting a Section

Right-click the section header and select **Delete Section**. The section is removed but its worktrees are preserved — they become ungrouped.

## Sending Messages, Approvals, and Control

- **Continue the conversation:** Send a follow-up message to the running agent
- **Approvals:** The Permission Dock shows tool approval prompts — approve once, approve always, or deny
- **Cancel:** Sends a cooperative stop signal to the agent
- **Stop:** Force-terminates the session and marks it as stopped

## Diff / Review Panel

Press `Cmd+D` (macOS) / `Ctrl+D` (Windows/Linux) to toggle the diff panel. It shows a live-updating diff between the worktree and its parent branch.

- Select files and click **Apply to local** to copy the worktree's changes onto your local checkout of the base branch
- Conflicts are surfaced with a resolution dialog
- Supports unified and split diff views
- **Drag file headers into chat** — drag a file header from the diff panel into the chat input to insert an `@file` mention, giving the agent context about specific changed files

See [Agent Manager Workflows](/docs/automate/agent-manager-workflows#merging-worktree-and-parent-branch) for the full integration story, including when to apply locally vs. merge directly vs. open a pull request.

## Terminals

Each session has a dedicated integrated terminal rooted in the session's worktree directory. Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to focus the terminal for the active session.

### Switching Between Terminal and Agent Manager

A common workflow is letting the agent work, then switching to the terminal to run tests or inspect the worktree, then switching back to control the agent:

1. **Agent Manager → Terminal:** Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to open and focus the terminal for the current session. The terminal runs inside the session's worktree, so commands like `npm test` or `git status` operate on the agent's isolated branch.
2. **Terminal → Agent Manager:** Press `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux) to bring focus back to the Agent Manager panel and its prompt input. This works from anywhere in VS Code — the terminal, another editor tab, or the sidebar.

## Setup Scripts

Place an executable script at `.kilo/setup-script` in your project root. It runs automatically whenever a new worktree is created (useful for `npm install`, env setup, etc.). Root-level `.env` and `.env.*` files are also auto-copied from the main repo before the setup script runs.

## Run Script

The run button lets you start your project (dev server, build, tests, etc.) directly from the Agent Manager toolbar without switching to a terminal. It executes a shell script you define once, and runs it in the context of whichever worktree is currently selected.

### Setting up a run script

Create a script file in `.kilo/` using the appropriate filename for your platform:

| Platform      | Filename (checked in order)                                            |
| ------------- | ---------------------------------------------------------------------- |
| macOS / Linux | `.kilo/run-script`, `.kilo/run-script.sh`                              |
| Windows       | `.kilo/run-script.ps1`, `.kilo/run-script.cmd`, `.kilo/run-script.bat` |

For example, on macOS / Linux create `.kilo/run-script`:

```sh
#!/bin/sh
npm run dev
```

The next time you click the run button (or press `Cmd+E` / `Ctrl+E`), the script runs in the selected worktree's directory.

{% callout type="tip" %}
If no run script exists yet, clicking the run button opens a template file for you to fill in.
{% /callout %}

### Environment variables

Two extra variables are injected into the script's environment:

| Variable        | Value                                                                 |
| --------------- | --------------------------------------------------------------------- |
| `WORKTREE_PATH` | Working directory of the selected worktree (or repo root for "local") |
| `REPO_PATH`     | Repository root                                                       |

### Using the run button

- **Run:** Click the play button in the toolbar or press `Cmd+E` (macOS) / `Ctrl+E` (Windows/Linux). Output appears in a dedicated VS Code task panel.
- **Stop:** Click the stop button (same position) or press `Cmd+E` again while running.
- **Configure:** Click the dropdown arrow next to the run button and select "Configure run script" to open the script in your editor.

## Session State and Persistence

Agent Manager state is persisted in `.kilo/agent-manager.json`. Sessions, worktrees, and their order are restored on reload.

## Keyboard Shortcuts (Agent Manager Panel)

| Shortcut (macOS)         | Shortcut (Windows/Linux)  | Action                                           |
| ------------------------ | ------------------------- | ------------------------------------------------ |
| `Cmd+Shift+M`            | `Ctrl+Shift+M`            | Open / focus Agent Manager (works from anywhere) |
| `Cmd+N`                  | `Ctrl+N`                  | New worktree                                     |
| `Cmd+Shift+N`            | `Ctrl+Shift+N`            | New worktree (advanced options)                  |
| `Cmd+Shift+O`            | `Ctrl+Shift+O`            | Import/open worktree                             |
| `Cmd+Shift+W`            | `Ctrl+Shift+W`            | Close current worktree                           |
| `Cmd+T`                  | `Ctrl+T`                  | New tab (session) in worktree                    |
| `Cmd+W`                  | `Ctrl+W`                  | Close current tab                                |
| `Cmd+Alt+Up` / `Down`    | `Ctrl+Alt+Up` / `Down`    | Previous / next worktree                         |
| `Cmd+Alt+Left` / `Right` | `Ctrl+Alt+Left` / `Right` | Previous / next tab in worktree                  |
| `Cmd+/`                  | `Ctrl+/`                  | Focus terminal for current session               |
| `Cmd+D`                  | `Ctrl+D`                  | Toggle diff panel                                |
| `Cmd+E`                  | `Ctrl+E`                  | Run / stop run script                            |
| `Cmd+Shift+/`            | `Ctrl+Shift+/`            | Show keyboard shortcuts                          |
| `Cmd+1` … `Cmd+9`        | `Ctrl+1` … `Ctrl+9`       | Jump to worktree/session by index                |

## Troubleshooting

- **"Please open a folder…" error** — the Agent Manager requires a VS Code workspace folder
- **Worktree creation fails** — ensure Git is installed and the workspace is a valid git repository. Open the main repository (where `.git` is a directory), not an existing worktree checkout.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

The Agent Manager is a dedicated control panel for running and supervising Kilo Code agents as interactive CLI processes. It supports:

- Local sessions
- Resuming existing sessions
- Parallel Mode (with support for Git worktree) for safe, isolated changes
- Viewing and continuing cloud-synced sessions filtered to your current repository

This page reflects the actual implementation in the extension.

## Prerequisites

- Install/update the Kilo Code CLI (latest) — see [CLI setup](/docs/code-with-ai/platforms/cli)
- Open a project in VS Code (workspace required)
- Authentication: You must be logged in via the extension settings OR use CLI with kilocode as provider (see [Authentication Requirements](#authentication-requirements))

## Opening the Agent Manager

- Command Palette: "Kilo Code: Open Agent Manager"
- Or use the title/menu entry if available in your Kilo Code UI

The panel opens as a webview and stays active across focus changes.

## Sending messages, approvals, and control

- Continue the conversation: Send a follow-up message to the running agent
- Approvals: If the agent asks to use a tool, run a command, launch the browser, or connect to an MCP server, the UI shows an approval prompt
  - Approve or reject, optionally adding a short note
- Cancel vs Stop
  - Cancel sends a structured cancel message to the running process (clean cooperative stop)
  - Stop force-terminates the underlying CLI process, updating status to "stopped"

## Resuming an existing session

You can continue a session later (local or remote):

- If a session is not currently running, the Agent Manager will spawn a new CLI process attached to that session's ID
- Labels from the original session are preserved whenever possible
- Your first follow-up message becomes the continuation input

## Parallel Mode

Parallel Mode runs the agent in an isolated Git worktree branch, keeping your main branch clean.

- Enable the "Parallel Mode" toggle before starting
- The extension prevents using Parallel Mode inside an existing worktree
  - Open the main repository (where .git is a directory) to use this feature

### Worktree Location

Worktrees are created in `.kilocode/worktrees/` within your project directory. This folder is automatically excluded from git via `.git/info/exclude` (a local-only ignore file that doesn't require a commit).

```
your-project/
├── .git/
│   └── info/
│       └── exclude   # local ignore rules (includes .kilocode/worktrees/)
├── .kilocode/
│   └── worktrees/
│       └── feature-branch-1234567890/   # isolated working directory
└── ...
```

### While Running

The Agent Manager surfaces:

- Branch name created/used
- Worktree path
- A completion/merge instruction message when the agent finishes

### After Completion

- The worktree is cleaned up automatically, but the branch is preserved
- Review the branch in your VCS UI
- Merge or cherry-pick the changes as desired

### Resuming Sessions

If you resume a Parallel Mode session later, the extension will:

1. Reuse the existing worktree if it still exists
2. Or recreate it from the session's branch

## Authentication Requirements

The Agent Manager requires proper authentication for full functionality, including session syncing and cloud features.

### Supported Authentication Methods

1. **Kilo Code Extension (Recommended)**
   - Sign in through the extension settings
   - Provides seamless authentication for the Agent Manager
   - Enables session syncing and cloud features

2. **CLI with Kilo Code Provider**
   - Use the CLI configured with `kilocode` as the provider
   - Run `kilocode config` to set up authentication
   - See [CLI setup](/docs/code-with-ai/platforms/cli) for details

### BYOK Limitations

**Important:** Bring Your Own Key (BYOK) is not fully supported with the Agent Manager.

If you're using BYOK with providers like Anthropic, OpenAI, or OpenRouter:

- The Agent Manager will not have access to cloud-synced sessions
- Session syncing features will be unavailable
- You must use one of the supported authentication methods above for full functionality

To use the Agent Manager with all features enabled, switch to the Kilo Code provider or sign in through the extension.

## Remote sessions (Cloud)

When signed in (Kilo Cloud), the Agent Manager lists your recent cloud-synced sessions:

- Up to 50 sessions are fetched
- Sessions are filtered to the current repository via normalized Git remote URL
  - If the current workspace has no remote, only sessions without a git_url are shown
- Selecting a remote session loads its message transcript
- To continue the work locally, send a message — the Agent Manager will spawn a local process bound to that session

Message transcripts are fetched from a signed blob and exclude internal checkpoint "save" markers as chat rows (checkpoints still appear as dedicated entries in the UI).

## Troubleshooting

- CLI not found or outdated
  - Install/update the CLI: [CLI setup](/docs/code-with-ai/platforms/cli)
  - If you see an "unknown option --json-io" error, update to the latest CLI
- "Please open a folder…" error
  - The Agent Manager requires a VS Code workspace folder
- "Cannot use parallel mode from within a git worktree"
  - Open the main repository (where .git is a directory), not a worktree checkout
- Remote sessions not visible
  - Ensure you're signed in and the repo's remote URL matches the sessions you expect to see
  - If using BYOK, session syncing is not available — switch to Kilo Code provider or sign in through the extension
- Authentication errors
  - Verify you're logged in via extension settings or using CLI with kilocode provider
  - BYOK configurations do not support Agent Manager authentication

{% /tab %}
{% /tabs %}

## Related features

- [Sessions](/docs/collaborate/sessions-sharing)
- [Auto-approving Actions](/docs/getting-started/settings/auto-approving-actions)
- [CLI](/docs/code-with-ai/platforms/cli)
