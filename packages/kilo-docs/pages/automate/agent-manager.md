---
title: "Agent Manager"
description: "Manage and orchestrate multiple AI agents"
---

# Agent Manager

The Agent Manager is a control panel for running and orchestrating multiple Kilo Code agents, with support for parallel worktree-isolated sessions and multiple conversations in the same worktree.

The Agent Manager is a **full-panel editor tab** built directly into the extension. It uses the extension's embedded runtime, so no separate Kilo CLI installation or CLI authentication setup is required. It supports:

- Multiple parallel sessions in isolated git worktrees or the shared Local workspace
- A diff/review panel showing changes vs. the parent branch
- Dedicated VS Code integrated terminals per session
- Setup scripts and `.env` auto-copy on worktree creation
- Session import from existing branches, external worktrees, or GitHub PR URLs
- "Continue in Worktree" to promote a sidebar session to the Agent Manager
- The same providers, BYOK keys, custom providers, and extension features supported in the sidebar

{% callout type="tip" %}
New to running multiple agents in parallel? The [Agent Manager Workflows](/docs/automate/agent-manager-workflows) guide walks through when to use the sidebar vs. the Agent Manager, how to pick tasks that parallelize well, and the common patterns for testing, reviewing, and integrating changes across worktrees.
{% /callout %}

## Orchestration model

Kilo now separates execution into two orchestration layers and provides Kilo Swarm as a communication layer. Use the `task` tool for child agents that belong to the current session. Use Agent Manager sessions for independent, top-level work that you want to supervise from the panel.

The old `orchestrator` agent is deprecated. Agents with full tool access, such as Code, Plan, and Debug, can delegate with `task` directly. You do not need to switch to a dedicated orchestrator first. See [Orchestrator Mode (Deprecated)](/docs/code-with-ai/agents/orchestrator-mode) for the migration details.

| Mechanism | Use it for | Workspace scope | Execution and communication |
|---|---|---|---|
| `task` subagent | A focused subtask owned by the current agent | The same project directory or worktree as the parent | Foreground tasks return a result before the parent continues. Background tasks return immediately and deliver their result later. The parent and descendants can use Kilo Swarm. |
| Agent Manager session | Independent work, parallel implementations, or a separate conversation | A new git worktree, the current workspace, or an existing managed worktree | Each session has its own transcript, prompt queue, and terminal. You can target an existing session with the `agent_manager` tool. |
| Kilo Swarm | Notes and coordination between related agents | One main session and its `task` descendants, including nested descendants | `board_post` and `board_read` exchange messages. Swarm does not start, stop, or assign agents. |

{% callout type="info" %}
A `task` subagent does not create a git worktree. Use `worktree` mode in Agent Manager when filesystem and branch isolation is required.
{% /callout %}

### Task subagents

A `task` subagent is a non-interactive delegate. Non-interactive means that the child cannot ask the end user a question directly. It can still use its permitted tools, inspect or change the parent directory, and return findings or changes to the parent session.

- **Foreground task:** The parent waits for the child to finish and receives its result in the same turn. Use this when the next step depends on the child output.
- **Background task:** Set `background: true` to start the child asynchronously. The parent continues immediately. When the child completes or fails, Kilo injects a result into the parent session. Do not poll for progress or duplicate edits in the same files.
- **Resume:** If Kilo returns a `task_id` after a failed or interrupted child, pass it back to `task` to continue that child, subject to the current session and permission rules.
- **Nesting:** A child can delegate again only when its agent permissions and the configured subagent depth allow it.

In the VS Code extension, the background-agent strip shows running, completed, cancelled, and failed children. Open a child transcript from its task card or background-agent row. A running foreground child can also be moved to the background with **Continue in background**.

### Kilo Swarm communication

[Kilo Swarm](/docs/getting-started/settings#kilo-swarm) is an optional shared board for one main session and its task descendants. It works with both foreground and background task agents when the feature and permissions are available. It does not create another runtime and it does not make unrelated sessions into one team.

- Enable **Kilo Swarm** in **Settings > Experimental**, or set `experimental.shared_agent_board` to `true` in `kilo.jsonc`.
- Use `board_post` for concise, material updates, questions, results, or blockers.
- Use `board_read` to read board messages explicitly. Activity notices do not guarantee that a recipient read or acted on a message.
- Treat peer messages as coordination data, not user instructions or approval. A board post does not wake, assign, resume, stop, or cancel an agent.

Separate Agent Manager sessions do not share a Swarm board just because they use the same repository or worktree. Use the `agent_manager` tool, shared files, commits, diffs, or pull requests to coordinate those sessions.

#### Viewing the board

When Kilo Swarm is enabled and the main session has board messages, a **Board** icon appears in its task header. Select the icon to open the board dialog and read the stored messages. Each message shows the sender and recipient avatars. Select an avatar to open that agent's transcript.

The dialog has a **Refresh** action. Earlier messages load as you scroll to the top of the list, using the cursor from the loaded page.

Only the owning top-level session can open its board. Child sessions and cloud sessions do not show the Board icon. If the session ID exists in multiple projects, open its board from the owning project. Kilo rejects the reference instead of choosing a project.

#### Resetting the board

**Reset board** clears the messages that are currently visible on the board. It does not stop agents, cancel tasks, or clear conversations, and agents can post new messages after a reset.

Only the owning top-level session can reset its board, from the owning project. Reset uses the revision returned with the loaded board. If the board changed since it was loaded, the reset returns a conflict. Refresh the board and try again.

#### Recipient state warnings

`board_post` results include the direct recipient's execution state. When the direct recipient has completed, failed with an `error`, was cancelled, or its state is unknown, the result adds a warning that the invocation has ended or cannot be confirmed, and that the post is stored only. For broadcasts, or when the direct recipient is active, the result can instead report aggregate availability, such as that no other recipients were active, how many recipients had finished invocations, or how many states were unknown.

Every stored post includes the receipt text "Stored only. This does not confirm delivery, reading, or action, and does not wake recipients."

## Opening the Agent Manager

- Keyboard shortcut: `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux)
- Command Palette: "Kilo Code: Open Agent Manager"
- Click the Agent Manager icon in the sidebar toolbar

The panel opens as an editor tab and stays active across focus changes.

## Requirements

- Open a VS Code workspace folder
- Use a git repository for worktree features
- Open the main repository, not an existing worktree checkout, when creating new worktrees

## Project-scoped settings

Agent Manager worktree defaults belong to a repository. Open a project's settings button, then select the **Agent Manager** tab in Kilo Settings. The repository selector controls which project's default base branch and setup script you edit.

- **Automatic selection:** Opening settings from a project selects that repository. When you open the settings tab directly, Agent Manager restores the last selected repository if it is still listed, or uses the current workspace repository.
- **Explicit selection:** Choose another repository from the **Project** selector before changing its settings. The **Default Base Branch** control uses **Auto-detect** by default, or you can choose a specific branch. The selected value is saved for that repository and is used when creating new worktrees.
- **Stale branches:** If a saved default branch no longer exists, Agent Manager clears it when it refreshes the repository's branch list and returns to **Auto-detect**. Choose a new branch to set an explicit default again.

The **Worktree Setup Script** control opens or creates the setup script for the selected repository. See [Setup Scripts](#setup-scripts) for supported filenames and execution behavior.

## Providers and Authentication

Agent Manager uses the same sign-in, provider settings, models, BYOK keys, custom providers, MCP servers, and permission rules as the extension sidebar. Configure them from extension Settings and they apply to Agent Manager as well.

See [Authentication](/docs/getting-started/setup-authentication), [AI Providers](/docs/ai-providers), and [Bring Your Own Key](/docs/getting-started/byok) for setup details.

## Working with Worktrees

Managed worktree sessions run in an isolated git worktree on a separate branch, keeping your main branch clean. Local sessions stay in the selected workspace or managed worktree and share its files and branch.

### Update from the base branch

In a managed worktree's chat, type `/update-from-base` and select the action to ask its agent to fetch and merge the saved base branch. The worktree's right-click menu and **Agent Manager: Update from base** in the Command Palette run the same action.

The saved base stays the same if you switch branches in Local or change the project's default base. For example, a worktree created from `main` still updates from `main` when Local has `release` checked out. If you switch branches inside the managed worktree, the agent updates that worktree's current branch, not its original branch. Select the intended worktree before running the command; it does not update Local.

The agent uses the recorded remote, or the saved base branch's upstream if no remote was recorded. It asks for a source if the base is local-only or unavailable. The request prohibits stashing, discarding uncommitted work, and pushing. Existing merge or rebase operations and blocking dirty changes require your input. Normal tool approvals still apply.

### Worktree Location

Managed worktrees are created under `.kilo/worktrees/` in your project. Kilo also stores Agent Manager UI state in `.kilo/agent-manager.json`.

{% callout type="info" %}
Worktrees share Git object storage with the main repository, but each worktree is still a separate checkout on disk. Files created inside each worktree, such as `node_modules`, build output, local databases, generated files, and package-manager caches, can multiply disk usage across parallel agents. Closing a managed worktree removes its checkout directory, but it does not remove external caches, containers, volumes, simulators, or databases that your scripts created outside the worktree.
{% /callout %}

### PR Status Badges

Each worktree item displays a **PR status badge** when its branch has an associated pull request. The badge shows the PR number (e.g. `#142`) and is color-coded to reflect the current state at a glance. Click the badge to open the internal PR panel. Use **Open in browser** in the panel header to open the pull request on GitHub.

If the pull request has unresolved review threads, the badge also shows a comment count. The badge, the hover-card link, and the count all open the PR panel at its comments section.

{% callout type="info" %}
The GitHub CLI (`gh`) must be installed and authenticated for PR badges to work. If `gh` is missing or not logged in, badges won't appear.
{% /callout %}

#### How PRs are detected

The extension uses `gh` to automatically discover PRs for each worktree branch. Three strategies are tried in order:

1. **Branch tracking ref** — `gh pr view` resolves via the branch's tracking ref (works for fork PRs checked out with `gh pr checkout`)
2. **Branch name** — `gh pr view <branch>` matches same-repo branches pushed to origin
3. **HEAD commit SHA** — `gh pr list --search "<sha>"` as a last resort, matching PRs whose head ref points to the exact same commit

You can also import a PR directly from the new worktree dialog: click **New Worktree** or press `Cmd+N` (macOS) / `Ctrl+N` (Windows/Linux), switch to the **Import** tab, then paste the GitHub PR URL. The branch is checked out and the badge appears automatically.

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

The badge shows the pull request icon. A status icon appears beside the number when there is a terminal signal, evaluated in this order: **checks failing** (cross), **changes requested** (warning), **approved** (checkmark). Merged and closed pull requests show no status icon, and an open pull request with no terminal signal shows none either.

#### Hover card details

Hovering over a worktree item shows a card with additional PR details:

- **PR number** with a link icon that opens the PR panel
- **State** — Open, Draft, Merged, or Closed
- **Review** — Approved, Changes Requested, or Pending (when a review exists)
- **Checks** — how many checks passed out of the total (e.g. `8/10 passed`)

#### Automatic updates

PR badges update automatically in the background. The active worktree refreshes frequently, while other worktrees sync periodically to keep badges current. Polling pauses when the Agent Manager panel is hidden.

### Reviewing a pull request

The PR panel is available when the selected worktree has an associated pull request. Open it in any of these ways:

- Click the pull request icon in the Agent Manager toolbar
- Click the PR badge on a worktree, or the link icon in its hover card
- Press `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R` (Windows/Linux)

The selected worktree controls the panel. The panel shows the worktree branch and its parent branch, so confirm that you are reviewing the intended branch. The PR association uses the detection methods described above, including the branch tracking ref, branch name, or current commit SHA.

The panel header provides the **Push Pull Request Fixes** toggle, **Refresh**, **Copy PR link**, **Open in browser**, and **Close**. The panel body contains:

- **Summary:** merge readiness, review status, checks, unresolved comments, and conversation counts. Checks, comments, and conversation include a jump action.
- **Files and review:** load the PR files and post inline review comments (see below)
- **Reviewers:** requested and completed reviewers with avatars and states (see below)
- **Checks:** passed, failed, running, cancelled, or skipped checks, with duration and browser links when available
- **Comments:** unresolved review threads first, then a collapsed **Resolved** group
- **Conversation:** description, comments and reviews, commits, and lifecycle events (see below)

#### Merge readiness

The summary shows the merge state before the merge controls:

| State | Meaning |
|---|---|
| Ready to merge | The branch is clean and can merge |
| Branch is behind the base branch | Update the branch before merging |
| Merging blocked | Required reviews or other requirements are not met |
| Checks are failing | A check failed, so the merge is unstable |
| Draft pull request | Mark the pull request ready for review before merging |
| Merge conflicts | The branch conflicts with the base, so resolve conflicts first |
| Checking mergeability | GitHub has not reported a state yet |

Merge controls appear only when you have write permission. Choose **Create merge commit**, **Squash and merge**, or **Rebase and merge** from the split button. Agent Manager remembers the last method you used per repository and preselects it when the repository allows it.

- **Update branch:** shown when the branch is behind. This asks GitHub to merge the base branch into the PR branch.
- **Fix with Kilo:** shown for merge conflicts. It lists the conflicting files and starts an update-from-base request, which asks the agent to resolve the conflicts in the worktree.
- **Enable auto-merge:** available when the repository allows auto-merge. GitHub merges the pull request when its requirements are met. Use **Disable auto-merge** to cancel it.
- **Merge pull request:** when the branch is clean, the primary button merges immediately after a confirmation that names the selected method.

Merge actions run through `gh` against GitHub. Agent Manager refuses to update the branch or merge when the PR head changed since the panel last loaded; refresh the panel and try again.

#### Inline review comments and reviews

Use **Files and review** to load the changed files. Select **Load PR files** to start, or **Load latest PR files** to refresh after a new commit. Existing drafts stay saved with their original commit. The panel loads up to the GitHub limit of 3000 files and disables review when the diff is too large.

To comment on a line, select a line or drag across lines in one gutter of the unified diff. You can comment on the new version (right side) or the old version (left side). A multiline selection is posted as a range. In the comment form:

- Switch between **Write** and **Preview**. `Cmd+Enter` / `Ctrl+Enter` submits.
- Use **Insert suggestion** on a new-version (right side) line comment or a reply to wrap the selected text in a `suggestion` fence. When you view a comment that contains a `suggestion` fence, use **Preview change** to see the proposed diff and **Apply to worktree** to write it into the local worktree file. Applying a suggestion does not stage, commit, or push. The worktree branch and HEAD must match the PR head, and the target lines must still match, or the apply fails.
- Submit the review as **Comment**, **Approve**, or **Request changes**. You cannot approve or request changes on your own pull request. Approve needs no body; the other decisions require one.

For review threads and comments:

- **Reply** to a thread from the thread card.
- **Resolve** or **Unresolve** a thread.
- **Edit** or **Delete** your own comments and replies. You need the matching GitHub permission.
- **React** with the GitHub reaction set. Click a reaction pill to toggle it, or use the reaction picker.
- **Fix with Kilo** sends a thread to the current agent as review context. **Fix N with Kilo** sends the unresolved threads together, up to the panel limit. With an active Agent Manager terminal, the label becomes **Send to terminal** or **Send N unresolved to terminal** and the threads go to that terminal instead.
- **Copy** copies the formatted thread. **Show in diff**, **Open file**, and **Open on GitHub** jump to the comment location.

Outdated threads show an **Outdated** label. Unresolved threads appear first, and resolved threads move into the **Resolved** group and are collapsed by default.

Sending a thread gives it to Kilo as review context, and it does not post anything to GitHub. Use the reply form to post to GitHub.

#### Checks

Each failing check offers **Fix with Kilo**, which sends the failure summary and log commands to the current agent. With an active Agent Manager terminal, the label becomes **Send failures to terminal**.

#### Conversation

The conversation lists the pull request description and history in one timeline:

- **Description** at the top
- **Comments and reviews** as cards, with reviewer states and reactions
- **Commits** as rows. Consecutive commits by one author collapse into one expandable group.
- **Lifecycle events:** merged, closed, reopened, and force-push, with the actor
- **Show earlier activity** when GitHub has timeline items before the loaded window. It opens the pull request on GitHub.

Use a comment card's **Fix with Kilo** action to hand it to the agent. **Dismiss** hides a comment from the next send, and **Restore** brings it back. **Fix N with Kilo** or **Send N to terminal** sends the actionable comments together.

#### Reviewers

The Reviewers section shows each requested or completed reviewer with an avatar and one of these GitHub-style states: **Approved**, **Changes requested**, **Commented**, or **Awaiting**.

#### Push Pull Request Fixes

**Push Pull Request Fixes** controls whether fix prompts ask the agent to commit and push so the pull request updates. The default is on.

- Set it in **Settings > Agent Behaviour > Push Pull Request Fixes** (`kilo-code.new.agentManager.pushFixes`).
- Toggle the same setting from the PR panel header with the **Push Pull Request Fixes** button.
- When it is on, fix prompts for PR review comments and CI failures include: "When the changes pass local checks, commit them and push to this branch so the pull request updates. Do not force-push."
- Update from base follows the same setting. With it on, the agent is asked to push the branch after a clean merge. With it off, it is not.
- Permission prompts still confirm commits and pushes. Turning the setting on does not auto-approve them.

### Creating a New Worktree Session

1. Click **New Worktree** or press `Cmd+N` (macOS) / `Ctrl+N` (Windows/Linux) to open the new worktree dialog
2. Enter a branch name (or let Kilo generate one)
3. Type your first message, then create the worktree

Kilo creates the worktree from the selected project's configured default base branch. In a multi-project workspace, the selected project determines this setting. An explicit base branch selected in the dialog takes precedence. If no default is configured, Kilo falls back to automatic detection of the repository's remote default branch. The agent works in isolation, so your main branch is unaffected.

To create a worktree immediately from the default base branch, press `Cmd+Shift+N` (macOS) / `Ctrl+Shift+N` (Windows/Linux). This uses the selected project's configured default, or the automatic remote-default fallback when no configured default exists.

### Slash Commands in the Worktree Prompt

The new worktree prompt supports slash commands for its configuration options, so you can change them from the keyboard:

| Command | Aliases | Action |
|---|---|---|
| `/models` | `/model` | Open the model selector |
| `/agents` | `/modes` | Open the agent selector |
| `/variant` | `/variants`, `/reasoning`, `/thinking` | Open the reasoning effort selector |
| `/sandbox` | — | Toggle the sandbox for the new worktree |

Navigate the menu with the arrow keys, select with `Enter` or `Tab`, and close it with `Escape`. Focus returns to the prompt after a selection or cancellation. `/agents` appears only when multiple agents are available, `/variant` only when the selected model has reasoning variants, and `/sandbox` only when sandbox controls are enabled.

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
- Sessions in one worktree have separate transcripts and prompt queues, but share the same checkout, branch, and terminal state. Coordinate write-heavy work before asking multiple sessions to edit the same files.
- Use session history to reopen local sessions or preview cloud sessions
- When a worktree is selected, open session history to use the **Worktree** source, which is selected by default and lists only sessions assigned to that worktree. Opening a worktree session returns to its owning worktree.
- Continue a cloud session locally from Agent Manager using the same extension sign-in and provider settings

File mentions, clickable file links, review-comment file links, file-link validation, and native VS Code opening resolve against the referenced session's directory or worktree. If a session ID is present in multiple projects, Kilo rejects the unqualified reference rather than choosing an arbitrary project.

When a session delegates work to a subagent, open the child transcript from its task card or background-agent row. Agent Manager displays it in the read-only **Subagents** inspector. The inspector supports multiple child-session tabs and keeps them scoped to the selected project and parent session. For the difference between Agent Manager inspector tabs and the separate subagent editor tabs used by the sidebar, see [Inspecting delegated sessions in VS Code](/docs/customize/custom-subagents#inspecting-delegated-sessions-in-vs-code).

### Renaming Worktrees

Double-click a worktree name to edit its label inline. You can also right-click the worktree and choose **Rename**. Press `Enter` or click outside the field to save, or press `Escape` to cancel.

Renaming a worktree changes only the label shown in Agent Manager. It does not rename the underlying git branch.

## Starting and orchestrating sessions from chat

Kilo can start Agent Manager sessions from chat with the `agent_manager` tool. It is available by default only in the VS Code extension because Agent Manager is an extension feature.

The tool supports two modes:

| Mode | Behavior |
|---|---|
| `worktree` | Creates one Agent Manager git worktree and session per task. Each task gets an isolated checkout, branch, directory, and terminal. |
| `local` | Creates Agent Manager sessions in the current workspace without git worktree isolation. You can also target an existing managed worktree with its `worktreeID`. |

Each request can include 1-20 tasks. Each task must include at least one of `prompt`, `name`, or `branchName`. Prompted tasks inherit the model and reasoning variant used by the chat turn that starts them. A task can override that selection with a `model` (by name, e.g. `Claude Opus 4.1`) when you explicitly request a different model, or with one of the current model's reasoning `variant` values when you request a different variant. Add `provider` beside `model` to force a model-name match to one of the listed provider IDs. Agent Manager resolves the provider for a model override when `provider` is omitted, preferring the provider used by the current turn and falling back to the Kilo Gateway; a qualified `provider/model` ID is also accepted. Prepared sessions without an initial prompt use the normal model defaults. Use `versions: true` only when the tasks are alternate versions of the same work to compare; otherwise, multiple tasks start as independent sessions.

The companion `agent_manager_models` tool searches models and their supported reasoning variants on demand. Results are grouped by model name (with the offering providers listed for reference) and limited to 20 per call, so the full catalog is never added to the conversation context.

The same tool also manages existing sessions. Use `action: "list"` first to get the current sections, worktrees, local sessions, and exact IDs. It can then send a prompt to one managed session, stop a managed session, move a worktree into a section, or answer a pending question. Moving accepts a section ID from the overview, or `null` to ungroup the worktree. Moving a session moves its whole worktree, including multi-version siblings. Local sessions cannot be assigned to a section. Stopping aborts the session's active work and removes it from the panel, just like closing the session tab.

Prompts to busy or retrying sessions enter the same queue as follow-up messages sent from chat. The tool returns when the prompt is accepted, without waiting for it to run or finish. Sessions with pending questions or permission requests still refuse prompts. Answer a pending question with `action: "answer"`, or resolve the permission request in Agent Manager, before prompting again. A prompt targets one session; the tool does not broadcast to every session.

The tool uses the `agent_manager` permission. Approval prompts are scoped to the requested capability, so approving `worktree` does not automatically approve `local`, an overview, or a targeted prompt. Prompting an existing managed session requires an explicit `prompt` approval the first time, even if Agent Manager session creation was previously approved broadly. Stopping a session likewise requires an explicit `stop` approval, and moving a worktree requires an explicit `move` approval.

### Typical tool sequence

1. Start independent sessions. Use `worktree` for isolated branches, or `local` for sessions that should share a checkout.

   ```json
   {
     "mode": "worktree",
     "versions": false,
     "tasks": [
       {
         "name": "API audit",
         "branchName": "agent/api-audit",
         "prompt": "Audit the API routes and report authentication risks."
       },
       {
         "name": "UI tests",
         "branchName": "agent/ui-tests",
         "prompt": "Add focused tests for the UI state transitions."
       }
     ]
   }
   ```

2. Call `action: "list"` and use the returned session IDs to identify the sessions and worktrees.
3. Send a targeted follow-up without waiting for it to finish.

   ```json
   {
     "action": "prompt",
     "sessionID": "<session ID from list>",
     "prompt": "Run the focused tests, then report any remaining failures."
   }
   ```

Use `Cmd+T` / `Ctrl+T` in the panel, or `mode: "local"` with a selected `worktreeID`, when the sessions should remain on one worktree. The IDs in these examples are placeholders. Always use the IDs returned by `list`.

### Communicating between Agent Manager sessions

- **Sessions in one worktree:** Use targeted `agent_manager` prompts for conversation. They also see the same files, commits, and branch, so coordinate before making overlapping edits.
- **Sessions in different worktrees:** Use targeted prompts plus commits, diffs, or pull requests to pass changes between isolated checkouts. Files are not shared automatically.
- **Task descendants:** A `task` child belongs to the session that launched it. Its Kilo Swarm board is scoped to that session tree, not to every Agent Manager session in the project.

## Sections

Sections let you group worktrees into collapsible, color-coded folders in the sidebar. Use them to organize your workflow however you like — by status ("Review Pending", "In Progress"), by project area ("Frontend", "Backend"), priority, or any other scheme that fits.

### Creating a Section

- **Right-click** any worktree and select **New Section** from the context menu
- A new section is created with a random color and enters rename mode immediately — type a name and press `Enter`

### Assigning Worktrees to Sections

**Via context menu:** Right-click a worktree, hover **Move to Section**, and pick a section from the list. Select **Ungrouped** to remove it from its current section.

**Via drag and drop:** Drag a worktree and drop it onto a section header to move it there.

Multi-version worktrees (created via Multi-Version Mode) are moved together — assigning one version to a section moves all versions in the group.

### Renaming Sections

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

## Previewing pending edits

When an agent requests permission to run `edit`, `write`, or `apply_patch`, the permission card shows the proposed file changes. In Agent Manager, select the expand button on the file diff to open an **Edit preview** in the side panel.

The preview supports patches that contain multiple files and shows each file's diff. Use the view selector to switch between **unified** and **split** views. You can close the preview without changing the request or its patch.

Previewing only displays the proposed changes. It does not approve or deny the pending tool request, apply changes to your local checkout, or revert a file. Make those decisions and use those actions from their respective controls. Outside Agent Manager, the same file-diff control opens the preview in a separate diff tab instead of the side panel.

## Diff / Review Panel

Press `Cmd+D` (macOS) / `Ctrl+D` (Windows/Linux) to toggle the diff panel. It shows a live-updating diff between the worktree and its parent branch.

The worktree creation base and the diff comparison base are separate. The Branch scope starts with the worktree's recorded parent branch, and its base-branch picker changes only the comparison target. It does not change the branch from which the worktree was created.

- Select files and click **Apply to local** to copy the worktree's changes onto your local checkout of the base branch
- Conflicts are surfaced with a resolution dialog
- Supports unified and split diff views
- Markdown files include an eye/code toggle in the file header to switch between rendered Markdown and the raw diff
- **Drag file headers into chat** — drag a file header from the diff panel into the chat input to insert an `@file` mention, giving the agent context about specific changed files

### Sending review comments

Add comments in the diff panel or in the rendered view of a Markdown document. Click **Send all to chat** to send the collected comments to chat. If an Agent Manager terminal is active, the comments are sent to that terminal instead. Press `Cmd+Enter` (macOS) or `Ctrl+Enter` (Windows/Linux) to use the same action from the review panel.

After sending, the local comment collection is cleared. To discard collected comments without sending them, click **Clear all** in the chat input.

### PR review comments in the diff

When the selected worktree has an associated pull request, its review threads also appear inline at their file and line in the Agent Manager diff panel and the full-screen review. The inline cards support the same reply, resolve, unresolve, reaction, and send actions as the PR panel. Threads with no matching line in the current diff appear under **Comments outside the current diff**.

### Diff Scope

A scope selector in the diff toolbar (both in the side panel and the full-screen review) chooses which changes the diff shows:

- **Branch** (default) — the full worktree diff against its parent branch, matching the review behavior above
- **Staged** — staged changes in the selected worktree
- **Unstaged** — unstaged changes in the selected worktree
- **Session** — changes from the selected session

The Branch scope also has a base-branch picker next to it for overriding the comparison branch. **Apply to local** works only on the Branch scope — switch back to Branch to apply.

See [Agent Manager Workflows](/docs/automate/agent-manager-workflows#merging-worktree-and-parent-branch) for the full integration story, including when to apply locally vs. merge directly vs. open a pull request.

## Documents inspector

The Documents inspector previews Markdown file references from Agent Manager chat without leaving the panel. Open a file reference to add it as a document tab, then use the tab strip to switch, reorder, or close open documents. The inspector keeps one tab per file in the active project and worktree context.

- Markdown files (`.md`, `.mdx`, and `.markdown`) open in rendered view by default. Use the preview/source toggle to switch between rendered Markdown and syntax-highlighted source.
- The document renderer also supports syntax-highlighted text and inline PNG, JPEG, GIF, WebP, and SVG previews when a document payload is available. Normal Agent Manager file-opening actions route non-Markdown source references to the native VS Code editor.
- Use **Open file** to open the document in the native VS Code editor. The original line and column are preserved when available.
- Unsupported, binary, missing, out-of-scope, or oversized files show an error fallback in the inspector. Text previews are limited to 2 MB and image previews to 5 MB; open the file in VS Code to inspect larger or unsupported content.

### Inline document review

In a rendered Markdown preview, use the comment control in the line gutter to add a comment at that line. Clicking a line number opens that location in the native editor. Draft comments can be edited or deleted, sent individually to the active session, or sent together with **Send all to chat**. Comments are attached to the document path and line, and remain isolated to the active project and worktree context.

The project and worktree context owns document tabs, loaded content, and comments. The session ID attached to an opened file selects the session's worktree for reading and native-editor navigation. Sessions that share one worktree also share its document inspector state; switching project or worktree changes the visible context without mixing tabs or comments across worktrees.

## Terminals

Each session has a dedicated terminal rooted in the session's worktree directory. Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to focus the terminal for the active session. If the embedded terminal is already visible but the prompt has focus, the same shortcut focuses the terminal without hiding it. Press it again while the terminal has focus to hide the panel.

When you use `@terminal` in an Agent Manager prompt, Kilo captures the focused terminal for the selected session or worktree. This includes embedded **Run** and **Setup** tabs. Terminal context is limited to 500 lines or 50,000 characters; longer output is truncated.

### Choosing the Terminal Destination

The toolbar's terminal button is a split button: click it to open a terminal, or use its dropdown to choose where terminals open:

- **VS Code terminal** (default) — opens or focuses the VS Code integrated terminal at the bottom of the window
- **Agent Manager panel** — opens an embedded terminal in the side panel that also hosts the diff view, so the shell stays inside the Agent Manager layout

The dropdown choice is remembered per panel and becomes the default for new panels. You can also set the default directly with the `kilo-code.new.agentManager.terminalButtonDestination` setting (`vscode` or `agentManager`). The `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) shortcut follows the same destination.

With the **Agent Manager panel** destination, the terminal works like the diff panel: press `Cmd+/` to reveal and focus it, press it while the panel is visible but another control has focus to move focus into the terminal, and press it again from the terminal to hide it. Hiding never stops the terminal — scrollback and running processes continue in the background, and focus returns to the chat input. A terminal stops only when you click its close button or type `exit` in the shell.

### Multiple Terminals

Agent Manager has two separate terminal tab strips:

- **Main terminal tabs** appear alongside the agent session tabs. With the prompt or a main terminal focused, press `Cmd+Shift+T` / `Ctrl+Shift+T` to create another main terminal tab.
- **Side terminal tabs** appear in the terminal panel. Focus a side terminal, then press `Cmd+Shift+T` / `Ctrl+Shift+T` to create another side terminal. You can also click **+** in the side-terminal strip.

The shortcut follows terminal focus, not panel visibility. A visible side panel with the prompt focused still creates a main terminal tab. Press `Cmd+Shift+[` / `Ctrl+Shift+[` for the previous terminal or `Cmd+Shift+]` / `Ctrl+Shift+]` for the next terminal in the focused terminal strip. Drag tabs to reorder them. Pressing `Cmd+W` / `Ctrl+W` with a focused side terminal closes that terminal when other terminals remain. On the last side terminal, it hides the panel and keeps the shell alive; use its close button or type `exit` to stop it.

`Cmd+T` / `Ctrl+T` always creates a new agent session tab. It never creates a terminal.

New terminals are named "Terminal N" using the lowest free number, and tabs pick up the live title from the shell or running program, so a dev server or editor names its own tab.

### Switching Between Terminal and Agent Manager

A common workflow is letting the agent work, then switching to the terminal to run tests or inspect the worktree, then switching back to control the agent:

1. **Agent Manager → Terminal:** Press `Cmd+/` (macOS) / `Ctrl+/` (Windows/Linux) to open and focus the terminal for the current session. The terminal runs inside the session's worktree, so commands like `npm test` or `git status` operate on the agent's isolated branch.
2. **Terminal → Agent Manager:** Press `Cmd+Shift+M` (macOS) / `Ctrl+Shift+M` (Windows/Linux) to bring focus back to the Agent Manager panel and its prompt input. This explicit shortcut always targets the prompt and works from anywhere in VS Code — the terminal, another editor tab, or the sidebar. Returning to the panel by clicking its editor tab or switching windows restores the last focused control instead.

## Setup Scripts

Setup scripts let you prepare each new worktree before the agent starts, for example by installing dependencies, linking local config, copying non-standard env files, or creating per-worktree databases.

Create a script file in `.kilo/` using the appropriate filename for your platform:

| Platform | Filename (checked in order) |
|---|---|
| macOS / Linux | `.kilo/setup-script`, `.kilo/setup-script.sh` |
| Windows | `.kilo/setup-script.ps1`, `.kilo/setup-script.cmd`, `.kilo/setup-script.bat` |

Kilo runs the script automatically whenever a new worktree is created. It uses `sh` for POSIX scripts, PowerShell for `.ps1`, and `cmd.exe` for `.cmd` / `.bat`, so executable permissions are not required.

Where the script runs follows the terminal destination dropdown in the Agent Manager toolbar. **Agent Manager panel** shows live output in a named `Setup` tab in the side terminal panel. After success, the panel returns to its previous state unless you interacted with it; the retained tab remains available for review. Failures keep the panel open. **VS Code terminal** runs setup as a task in the integrated terminal. The script keeps the existing five-minute timeout; when it expires, the setup process tree is terminated and the failed tab retains its partial output.

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

If the setup script fails, Agent Manager shows the failure (a failed `Setup` tab in the side terminal panel, or the task output in the integrated terminal) and keeps the worktree available so you can inspect it, fix the script, or run setup steps manually.

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

- **Run:** Click the play button in the toolbar or press `Cmd+E` (macOS) / `Ctrl+E` (Windows/Linux). Output appears in a named `Run` tab in the Agent Manager terminal panel and remains available after the script exits.
- **Stop:** Click the stop button (same position) or press `Cmd+E` again while running.
- **Configure:** Click the dropdown arrow next to the run button and select "Configure run script" to open the script in your editor.

The terminal destination dropdown in the Agent Manager toolbar also controls where the script runs. **Agent Manager panel** uses the named side terminal, while **VS Code terminal** runs it as a task in the integrated terminal. The integrated terminal option is kept for comparison and will be removed in a future release.

## Session State and Persistence

Agent Manager state is persisted in `.kilo/agent-manager.json`. It stores worktrees, sections, session tabs, ordering, collapsed state, diff preferences, and cached PR metadata. Git branches and worktree directories remain on disk separately.

Closing a managed worktree removes it from Agent Manager, deletes its `.kilo/worktrees/` directory, and deletes the local branch. Closing an imported external worktree removes the Agent Manager entry but leaves the external directory and branch untouched.

## Keyboard Shortcuts (Agent Manager Panel)

| Shortcut (macOS) | Shortcut (Windows/Linux) | Action |
|---|---|---|
| `Cmd+Shift+M` | `Ctrl+Shift+M` | Open / focus Agent Manager (works from anywhere) |
| `Cmd+N` | `Ctrl+N` | Configure a new worktree |
| `Cmd+Shift+N` | `Ctrl+Shift+N` | Create a new worktree immediately |
| `Cmd+Shift+O` | `Ctrl+Shift+O` | Import/open worktree |
| `Cmd+Shift+W` | `Ctrl+Shift+W` | Close current worktree |
| `Cmd+T` | `Ctrl+T` | New agent session tab in worktree |
| `Cmd+W` | `Ctrl+W` | Close the focused tab or terminal; the last side terminal hides instead of stopping |
| `Cmd+Alt+Up` / `Down` | `Ctrl+Alt+Up` / `Down` | Previous / next worktree |
| `Cmd+Alt+Left` / `Right` | `Ctrl+Alt+Left` / `Right` | Previous / next tab in worktree |
| `Cmd+/` | `Ctrl+/` | Focus terminal, or hide it when it already has focus |
| `Cmd+Shift+T` | `Ctrl+Shift+T` | New side terminal when a side terminal is focused; otherwise new main terminal tab |
| `Cmd+Shift+[` / `]` | `Ctrl+Shift+[` / `]` | Previous / next terminal |
| `Cmd+D` | `Ctrl+D` | Toggle diff panel |
| `Cmd+E` | `Ctrl+E` | Run / stop run script |
| `Cmd+Shift+/` | `Ctrl+Shift+/` | Show keyboard shortcuts |
| `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` | Jump to worktree/session by index |

## Troubleshooting

- **"Please open a folder…" error** — the Agent Manager requires a VS Code workspace folder
- **Worktree creation fails** — ensure Git is installed and the workspace is a valid git repository. Open the main repository (where `.git` is a directory), not an existing worktree checkout.
- **A configured base branch is missing** — Kilo clears the stale project setting and uses automatic remote-default detection for the new worktree. Select the project and configure a new default if needed.
- **Provider or authentication errors** — open extension Settings and verify your sign-in, provider, model, or BYOK configuration. Agent Manager uses the same settings as the sidebar.
- **Session history missing cloud sessions** — sign in through the extension and confirm the repository remote matches the sessions you expect to see.
- **PR badges, the review panel, or PR import missing:** install the GitHub CLI (`gh`) and authenticate it for the repository. Run `gh auth status` to check the current login. GitHub PR features do not work until `gh` is available and authenticated.
- **PR data looks temporarily stale:** polling pauses while the Agent Manager panel is hidden, and background updates are not instantaneous. Close and reopen the PR panel, or switch worktrees and select the original worktree again, to trigger a fresh lookup. A transient GitHub, network, or fork lookup failure can leave the last known PR data visible until the next successful refresh.

## Related features

- [Sessions](/docs/collaborate/sessions-sharing)
- [Auto-approving Actions](/docs/getting-started/settings/auto-approving-actions)
- [AI Providers](/docs/ai-providers)
- [Bring Your Own Key](/docs/getting-started/byok)
