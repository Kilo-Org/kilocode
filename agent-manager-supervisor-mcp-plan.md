# Agent Manager Supervisor MCP Plan

## Problem

Agent Manager can run many isolated agents in parallel, but the user still has to inspect sessions, decide what needs attention, send follow-ups, and keep the board organized.

The Supervisor MCP should make Kilo a bounded attention router: read the board, inspect selected sessions, prompt existing sessions, move worktree-backed cards, and return a concise report.

## MVP Scope

The MVP is one supervisor pass.

Allowed:

- read overview
- inspect selected sessions
- prompt existing sessions
- create sections
- move worktree-backed cards to sections
- rename sections
- ungroup worktree-backed cards
- remove sections by ungrouping their cards
- report actions, labels, and decisions

Deferred:

- create sessions
- attach sessions to worktrees
- move sessions to local
- remove sessions or worktrees
- reorder cards or sections
- watch mode or continuous supervision
- external issue discovery from Slack, Discord, GitHub, Sentry, or trackers
- merge, delete, force-push, approve, or apply-worktree flows

## Architecture Constraint

Agent Manager state is owned by the VS Code extension, not the CLI process.

The persisted `.kilo/agent-manager.json` file is not authoritative by itself. It stores durable board metadata like sessions, worktrees, sections, ordering, and base branch settings. Live state comes from extension services, backend session APIs, git pollers, PR/check pollers, pending input/permission queues, and active directory overrides.

The MCP tools must run in the extension host or call an extension-owned request/response bridge. CLI-facing tools can expose the capability, but reads and writes must resolve through the extension.

## Tool Surface

### `agent_manager_overview`

Return a compact board snapshot.

Include:

- sections
- worktree-backed cards
- sessions
- session status
- section assignment
- cwd and branch
- git summary when available
- PR/check summary when available
- waiting or permission state when available

Use this as the first and cheapest pass.

### `agent_manager_inspect`

Return a bounded snapshot for one session.

Inputs:

- `session_id`
- optional `tail`

Include:

- latest assistant output
- latest user or operator prompt
- latest tool call, result, error, or permission state
- git status and diffstat for worktree-backed sessions
- PR/check/review summary when available

Use this only for sessions that look waiting, stale, red, done, risky, or ambiguous.

### `agent_manager_prompt`

Send a follow-up prompt to an existing session.

Inputs:

- `session_id`
- `prompt`

Prompts should be narrow and operational.

Examples:

```text
Inspect the failing checks, fix only issues related to your current task, then report what changed.
```

```text
You look done but I do not see a PR. Create or update the PR, then summarize the status.
```

```text
Pause and explain why this scope is needed before making more changes.
```

### `agent_manager_section`

Create, rename, remove, and move worktree-backed cards between sections.

Actions:

- `create`
- `rename`
- `move`
- `ungroup`
- `remove`

Move inputs:

- `worktree_id` or `session_id`
- `section_id` or section name

Moving by `session_id` resolves to the session's worktree. If the session is local or detached, return `not_sectionable`.

Removing a section only removes the section. Worktree-backed cards inside it are ungrouped. Sessions and worktrees are not deleted.

## Attention Labels

Attention labels are supervisor output, not persisted truth.

Each label includes:

- `label`
- `confidence`: `high`, `medium`, or `low`
- `evidence`
- `suggested_action`

Use practical labels:

- `needs-decision`: asks for user or product direction
- `waiting`: needs input or permission
- `needs-fix`: checks, tool errors, reviews, or PR state show a problem
- `needs-nudge`: obvious operational next step exists
- `ready-review`: PR exists and checks look green
- `risky`: scope drift, sensitive files, large unexpected diff, or destructive intent
- `stalled`: no clear progress or repeated failure
- `healthy`: recent progress with no obvious action
- `unknown`: not enough reliable context

Hard external signals beat transcript claims. If a session says it is ready but checks are red, label it `needs-fix`.

## Supervisor Pass

A pass should:

1. Read `agent_manager_overview`.
2. Select only relevant sessions for inspection.
3. Read `agent_manager_inspect` for those sessions.
4. Assign evidence-backed attention labels.
5. Create requested sections if missing.
6. Move worktree-backed cards into requested sections.
7. Prompt existing sessions when the next step is obvious and safe.
8. Return a concise report.

The pass ends after the report. It does not watch, poll, or keep running.

## Safety

Allowed without extra confirmation in the MVP:

- read overview
- inspect selected sessions
- create requested sections
- move worktree-backed cards to sections
- ungroup worktree-backed cards
- rename or remove sections when requested
- prompt existing sessions with narrow operational follow-ups
- report labels and evidence

Require explicit user confirmation:

- prompt an agent to make broad product or architecture changes
- prompt an agent to touch sensitive files
- prompt an agent to resolve conflicts
- stop or abort a running agent
- grant permissions to child agents

Never do in the MVP:

- create new sessions
- attach sessions to worktrees
- move sessions to local
- remove sessions or worktrees
- reorder cards or sections
- merge PRs
- approve PRs
- delete worktrees
- force push
- apply one worktree into another branch
- discover or start work from external systems

## Report Format

The final report should be short and prioritized.

Include:

- actions taken
- sessions needing user attention
- sessions prompted
- cards moved
- labels with evidence and confidence
- decisions needed from the user

Example:

```markdown
## Actions Taken

- Created `NEEDS INPUT` and `REVIEW`
- Moved `auth-refactor` to `REVIEW`
- Moved `billing-fix` to `NEEDS INPUT`
- Prompted `ci-cleanup` to inspect failing checks

## Attention

1. `billing-fix` - `needs-decision` - high
   Evidence: latest output asks whether to keep legacy billing behavior.
   Suggested action: decide billing behavior before it continues.

2. `ci-cleanup` - `needs-fix` - high
   Evidence: PR checks are red.
   Suggested action: wait for the agent's follow-up after check inspection.

3. `auth-refactor` - `ready-review` - medium
   Evidence: PR exists and checks are green.
   Suggested action: review the PR.
```

## Success

The MVP is successful when Kilo can handle this request reliably:

```text
Check all my agents. Create NEEDS INPUT and REVIEW if missing. Move anything needing me to NEEDS INPUT. Move green PRs to REVIEW. Nudge red PRs. Give me a short priority list.
```

Expected outcome:

- relevant sessions are inspected
- safe follow-up prompts are sent
- requested sections are created
- worktree-backed cards are moved
- risky or product-level decisions are escalated
- no session lifecycle actions happen
- no destructive git or PR actions happen
- the user gets a concise attention report
