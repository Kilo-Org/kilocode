---
title: "Agent Manager"
description: "Manage and orchestrate multiple AI agents"
---

# Agent Manager

The Agent Manager is a control panel for running and orchestrating multiple Kilo Code agents, with support for parallel worktree-isolated sessions.

The Agent Manager is a **full-panel editor tab** built directly into the extension. It uses the extension's embedded runtime, so no separate Kilo CLI installation or CLI authentication setup is required. It supports:

- Multiple parallel sessions, each in its own git worktree
- A diff/review panel showing changes vs. the parent branch
- Dedicated VS Code integrated terminals per session
- Setup scripts and `.env` auto-copy on worktree creation
- Session import from existing branches, external worktrees, or GitHub PR URLs
- "Continue in Worktree" to promote a sidebar session to the Agent Manager
- The same providers, BYOK keys, custom providers, and extension features supported in the sidebar

{% callout type="tip" %}
New to running multiple agents in parallel? The [Agent Manager Workflows](/docs/automate/agent-manager-workflows) guide walks through when to use the sidebar vs. the Agent Manager, how to pick tasks that parallelize well, and the common patterns for testing, reviewing, and integrating changes across worktrees.
{% /callout %}

## Opening the Agent Manager

- Keyboard shortcut: `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux)
- Command Palette: "Kilo Code: Open Agent Manager"
- Click the Agent Manager icon in the sidebar toolbar

The panel opens as an editor tab and stays active across focus changes.

## Requirements

- Open a VS Code workspace folder
- Use a git repository for worktree features
- Open the main repository, not an existing worktree checkout, when creating new worktrees

## Providers and Authentication

Agent Manager uses the same sign-in, provider settings, models, BYOK keys, custom providers, MCP servers, and permission rules as the extension sidebar. Configure them from extension Settings and they apply to Agent Manager as well.

See [Setup & Authentication](/docs/getting-started/setup-authentication), [AI Providers](/docs/ai-providers), and [Bring Your Own Key](/docs/getting-started/byok) for setup details.

## Working with Worktrees

Each Agent Manager session runs in an isolated git worktree on a separate branch, keeping your main branch clean.

### Worktree Location

Managed worktrees are created under `.kilo/worktrees/` in your project. Kilo also stores Agent Manager UI state in `.kilo/agent-manager.json`.

{% callout type="info" %}
Worktrees share Git object storage with the main repository, but each worktree is still a separate checkout on disk. Files created inside each worktree, such as `node_modules`, build output, local databases, generated files, and package-manager caches, can multiply disk usage across parallel agents. Closing a managed worktree removes its checkout directory, but it does not remove external caches, containers, volumes, simulators, or databases that your scripts created outside the worktree.
{% /callout %}

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

| State | Color | Condition |
|---|---|---|
| Draft | Gray | PR is in draft state |
| Merged | Purple | PR has been merged |
| Closed | Red | PR was closed without merging |
| Checks failing | Red | Any CI check has failed |
| Changes requested | Yellow | A reviewer requested changes |
| Checks pending | Yellow (pulsing) | CI checks are still running |
| Open (default) | Green | PR is open, no failing or pending checks, no blocking review |

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

Imported work stays associated with its branch or worktree and can be continued from Agent Manager.

### Sessions and History

- Create a worktree session to start a new agent in an isolated branch
- Press `Cmd+T` (macOS) / `Ctrl+T` (Windows/Linux) to start another session in the selected worktree
- Use session history to reopen local sessions or preview cloud sessions
- Continue a cloud session locally from Agent Manager using the same extension sign-in and provider settings

## Starting Sessions From Chat

Kilo can start Agent Manager sessions from chat with the experimental `agent_manager` tool. Enable it in **Settings > Experimental > Agent Manager Tool**, or set `experimental.agent_manager_tool` to `true` in `kilo.jsonc`.

The tool is available only in the VS Code extension because Agent Manager is an extension feature. It supports two modes:

| Mode | Behavior |
|---|---|
| `worktree` | Creates one Agent Manager git worktree and session per task |
| `local` | Creates Agent Manager sessions in the current workspace without git worktree isolation |

Each request can include 1-20 tasks. Each task must include at least one of `prompt`, `name`, or `branchName`. Use `versions: true` only when the tasks are alternate versions of the same work to compare; otherwise, multiple tasks start as independent sessions.

The tool uses the `agent_manager` permission. Approval prompts are scoped to the requested mode, so approving `worktree` does not automatically approve `local`.

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
- Markdown files include an eye/code toggle in the file header to switch between rendered Markdown and the raw diff
- **Drag file headers into chat** — drag a file header from the diff panel into the chat input to insert an `@file` mention, giving the agent context about specific changed files

See [Agent Manager Workflows](/docs/automate/agent-manager-workflows#merging-worktree-and-parent-branch) for the full integration story, including when to apply locally vs. merge directly vs. open a pull request.

## Terminals

Each session has a dedicated integrated terminal rooted in the session's worktree directory. Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to focus the terminal for the active session.

### Switching Between Terminal and Agent Manager

A common workflow is letting the agent work, then switching to the terminal to run tests or inspect the worktree, then switching back to control the agent:

1. **Agent Manager → Terminal:** Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to open and focus the terminal for the current session. The terminal runs inside the session's worktree, so commands like `npm test` or `git status` operate on the agent's isolated branch.
2. **Terminal → Agent Manager:** Press `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux) to bring focus back to the Agent Manager panel and its prompt input. This works from anywhere in VS Code — the terminal, another editor tab, or the sidebar.

## Setup Scripts

Setup scripts let you prepare each new worktree before the agent starts, for example by installing dependencies, linking local config, copying non-standard env files, or creating per-worktree databases.

Create a script file in `.kilo/` using the appropriate filename for your platform:

| Platform | Filename (checked in order) |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

Kilo runs the script automatically whenever a new worktree is created. It uses `sh` for POSIX scripts, PowerShell for `.ps1`, and `cmd.exe` for `.cmd` / `.bat`, so executable permissions are not required.

Two extra variables are injected into the setup script's environment:

| Variable | Value |
|---|---|
| `WORKTREE_PATH` | Absolute path to the new worktree directory |
| `REPO_PATH` | Repository root |

For example, on macOS / Linux:

```sh
#!/bin/sh
set -e

cd "$WORKTREE_PATH"
npm install

# Copy a nested env file that Kilo does not auto-copy.
if [ -f "$REPO_PATH/apps/web/.env.local" ] && [ ! -f "$WORKTREE_PATH/apps/web/.env.local" ]; then
  cp "$REPO_PATH/apps/web/.env.local" "$WORKTREE_PATH/apps/web/.env.local"
fi
```

If the setup script fails, Agent Manager shows the failure and keeps the worktree available so you can inspect it, fix the script, or run setup steps manually.

### Environment File Copying

Before the setup script runs, Kilo automatically copies root-level `.env` files from the main repo into the new worktree.

Copied automatically:

- Root-level plain files named exactly `.env`
- Root-level plain files matching `.env.*`, such as `.env.local` or `.env.development`

Not copied automatically:

- Nested env files, such as `apps/web/.env.local`
- Non-dotenv files, such as `.envrc`, `.environment`, or `.env-cmdrc`
- Directories named `.env` or `.env.local`
- Files that already exist in the worktree, because Kilo never overwrites them

Use `.kilo/setup-script` for anything outside the automatic copy rules, including nested env files, ignored local config, local certificates, local database files, generated config directories, or tool-specific files required to run the project.

## Run Script

The run button lets you start your project (dev server, build, tests, etc.) directly from the Agent Manager toolbar without switching to a terminal. It executes a shell script you define once, and runs it in the context of whichever worktree is currently selected.

### Setting up a run script

Create a script file in `.kilo/` using the appropriate filename for your platform:

| Platform | Filename (checked in order) |
|---|---|
| macOS / Linux | `.kilo/run-script`, `.kilo/run-script.sh` |
| Windows | `.kilo/run-script.ps1`, `.kilo/run-script.cmd`, `.kilo/run-script.bat` |

For example, on macOS / Linux create `.kilo/run-script`:

```sh
#!/bin/sh
npm run dev
```

For projects that need a unique dev-server port per worktree, assign the port in the run script and make your app read it from `PORT`:

```sh
#!/bin/sh
set -e

# Pick a deterministic port from the worktree path so each worktree keeps the same URL.
sum=$(cksum <<EOF | cut -d ' ' -f 1
$WORKTREE_PATH
EOF
)
export PORT=$((4000 + (sum % 1000)))

echo "Starting dev server on http://localhost:$PORT"
npm run dev
```

If your stack supports `PORT=0`, you can also let the OS pick a free port instead. Prefer app-side env support where possible, then use the run script to provide per-worktree defaults.

The next time you click the run button (or press `Cmd+E` / `Ctrl+E`), the script runs in the selected worktree's directory.

{% callout type="tip" %}
If no run script exists yet, clicking the run button opens a template file for you to fill in.
{% /callout %}

### Environment variables

Two extra variables are injected into the script's environment:

| Variable | Value |
|---|---|
| `WORKTREE_PATH` | Working directory of the selected worktree (or repo root for "local") |
| `REPO_PATH` | Repository root |

### Using the run button

- **Run:** Click the play button in the toolbar or press `Cmd+E` (macOS) / `Ctrl+E` (Windows/Linux). Output appears in a dedicated VS Code task panel.
- **Stop:** Click the stop button (same position) or press `Cmd+E` again while running.
- **Configure:** Click the dropdown arrow next to the run button and select "Configure run script" to open the script in your editor.

## Session State and Persistence

Agent Manager state is persisted in `.kilo/agent-manager.json`. It stores worktrees, sections, session tabs, ordering, collapsed state, diff preferences, and cached PR metadata. Git branches and worktree directories remain on disk separately.

Closing a managed worktree removes it from Agent Manager, deletes its `.kilo/worktrees/` directory, and deletes the local branch. Closing an imported external worktree removes the Agent Manager entry but leaves the external directory and branch untouched.

## Keyboard Shortcuts (Agent Manager Panel)

| Shortcut (macOS) | Shortcut (Windows/Linux) | Action |
|---|---|---|
| `Cmd+Shift+M` | `Ctrl+Shift+M` | Open / focus Agent Manager (works from anywhere) |
| `Cmd+N` | `Ctrl+N` | New worktree |
| `Cmd+Shift+N` | `Ctrl+Shift+N` | New worktree (advanced options) |
| `Cmd+Shift+O` | `Ctrl+Shift+O` | Import/open worktree |
| `Cmd+Shift+W` | `Ctrl+Shift+W` | Close current worktree |
| `Cmd+T` | `Ctrl+T` | New tab (session) in worktree |
| `Cmd+W` | `Ctrl+W` | Close current tab |
| `Cmd+Alt+Up` / `Down` | `Ctrl+Alt+Up` / `Down` | Previous / next worktree |
| `Cmd+Alt+Left` / `Right` | `Ctrl+Alt+Left` / `Right` | Previous / next tab in worktree |
| `Cmd+/` | `Ctrl+/` | Focus terminal for current session |
| `Cmd+D` | `Ctrl+D` | Toggle diff panel |
| `Cmd+E` | `Ctrl+E` | Run / stop run script |
| `Cmd+Shift+/` | `Ctrl+Shift+/` | Show keyboard shortcuts |
| `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` | Jump to worktree/session by index |

## Troubleshooting

- **"Please open a folder…" error** — the Agent Manager requires a VS Code workspace folder
- **Worktree creation fails** — ensure Git is installed and the workspace is a valid git repository. Open the main repository (where `.git` is a directory), not an existing worktree checkout.
- **Provider or authentication errors** — open extension Settings and verify your sign-in, provider, model, or BYOK configuration. Agent Manager uses the same settings as the sidebar.
- **Session history missing cloud sessions** — sign in through the extension and confirm the repository remote matches the sessions you expect to see.
- **PR badges or PR import missing** — install and authenticate the GitHub CLI (`gh`). This is only required for GitHub PR features.

## Related features

- [Sessions](/docs/collaborate/sessions-sharing)
- [Auto-approving Actions](/docs/getting-started/settings/auto-approving-actions)
- [AI Providers](/docs/ai-providers)
- [Bring Your Own Key](/docs/getting-started/byok)
