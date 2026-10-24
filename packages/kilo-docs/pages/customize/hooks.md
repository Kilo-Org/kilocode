---
title: "Hooks"
description: "Run shell commands automatically when the agent uses a tool, when you send a prompt, when a session starts or stops, and more"
platform: new
---

# Hooks

Hooks run your own commands automatically when the agent acts. Use them to run a linter after every edit and show its errors to the agent, to block edits to protected files, to keep secrets out of commands, to add project context when a session starts, to make the agent keep going until the tests pass, or to get a desktop notification when Kilo Code is waiting for you.

Hooks use the [Claude Code hooks](https://code.claude.com/docs/en/hooks) format, so existing hook scripts work in Kilo Code. Behavior matches Claude Code 2.1.301 except where listed in [Differences from Claude Code](#differences-from-claude-code).

{% callout type="info" %}
Hooks run with your full user permissions and outside the [sandbox](/docs/getting-started/settings/sandboxing). Only add commands you trust.
{% /callout %}

## Events

Kilo Code runs 30 hook events. The [hooks reference](/docs/customize/hooks-reference) lists the input, matcher values and output of each one.

### Tools

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `PreToolUse` | Before a tool call, before any permission prompt. Also for `@` file attachments, MCP resource attachments, `!` shell lines in command templates and code-mode tool calls. | Tool name | Yes: denies the call. `ask` forces a permission prompt. |
| `PostToolUse` | After a tool call succeeds | Tool name | No: feedback to the agent; `updatedToolOutput` replaces the output |
| `PostToolUseFailure` | After a tool call fails, including a shell command that exits non-zero | Tool name | No: feedback to the agent |
| `PostToolBatch` | After a model step that ran tools, before the next model call | None | Yes: ends the turn |
| `PermissionRequest` | When Kilo Code shows a permission prompt for a tool call | Tool name | Deny only |
| `TaskCreated` | When the agent adds a todo | None | Yes: the todo is not added |
| `TaskCompleted` | When the agent marks a todo completed | None | Yes: the todo stays open |

### Prompts

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `UserPromptSubmit` | When you send a prompt or a slash command | None | Yes: rejects the prompt |
| `UserPromptExpansion` | When a custom command, skill or MCP prompt expands | Command name | Yes: rejects the command |
| `PreModelSwitch` | Before a prompt switches the session to another model | Model | Yes: rejects the prompt |
| `PostModelSwitch` | After the session model changed | Model | No |

### Sessions

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `SessionStart` | Before the first response of a session, after a resume or fork, and after compaction | Source | No |
| `SessionEnd` | When a session is deleted, or when Kilo Code exits | Reason | No |
| `InstructionsLoaded` | When an instruction file (`AGENTS.md`, `CLAUDE.md`, config instructions) is loaded | Load reason | No |

### Agent loop

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `Stop` | When the agent finishes responding | None | Yes: the agent continues |
| `SubagentStop` | When a subagent finishes | Agent type | Yes: the subagent continues |
| `SubagentStart` | When a subagent starts or resumes | Agent type | No |
| `StopFailure` | When a turn ends with an API error | Error type | No |

### Compaction

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `PreCompact` | Before the conversation is compacted, manually or automatically | Trigger | Yes: skips compaction |
| `PostCompact` | After compaction succeeded | Trigger | No |

### Environment

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `Notification` | When Kilo Code waits for you: a permission prompt or a question unanswered for 6 seconds, or idle 60 seconds after a turn | Notification type | No |
| `ConfigChange` | After Kilo Code writes its global or project config | Config source | No |
| `FileChanged` | When a watched file in the project folder changes | File names | No |
| `CwdChanged` | When a shell command runs in a different folder than the previous one | None | No |

### Kilo only

These events have no Claude Code equivalent. They are only read from Kilo Code config.

| Event | When it runs | Matcher | Can block |
|---|---|---|---|
| `GoalReport` | When the model reports a `/goal` complete or blocked, before the goal settles | Reported status | Yes: the goal keeps running |
| `WakeupFire` | Before a scheduled wakeup or cron occurrence starts its turn | Kind | Yes: skips the occurrence |
| `WorktreeSetup` | After a managed worktree is created, its `.env` files copied and its setup script run | Origin | Yes: setup is marked failed |
| `WorktreeTeardown` | Before a managed worktree is removed | None | No |
| `CommitMessage` | After the editor generates a commit message | None | Yes: rewrites or rejects it |
| `BranchName` | After Agent Manager generates a branch name | None | Yes: rewrites it, or keeps the current name |

## Configuration

### In VS Code

Open **Settings → Agent Behaviour → Hooks** to see your hooks grouped by event, and to add, edit, or remove them. Click **Add hook** and pick the event in the editor. Changes are saved to your global config when you click **Save**. The tab also lists, read-only, the hooks that run from other config (managed or organization config) and from Claude Code, and the Claude Code hooks Kilo Code skips.

When you save a change, the list of hooks for that event is rewritten in your config file, so comments inside that list are not kept.

{% image src="/docs/img/screenshot-tests/kilo-vscode/visual-regression/settings/agent-behaviour-hooks-chromium-linux.png" alt="Hooks tab in Kilo Code" width="420" caption="Hooks tab in Kilo Code" /%}

### In the config file

Add a `hooks` key to your **global** config file (`~/.config/kilo/kilo.jsonc`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "edit|write|apply_patch",
        "hooks": [{ "type": "command", "command": "~/.config/kilo/hooks/lint.sh", "timeout": 30 }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [{ "type": "command", "command": "~/.config/kilo/hooks/guard.sh", "onFailure": "block" }]
      }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "~/.config/kilo/hooks/tests-pass.sh" }] }]
  }
}
```

Each event holds a list of groups. A group has an optional `matcher` and a list of `hooks`:

| Field | Description |
|---|---|
| `matcher` | What the group applies to. What it matches depends on the event (tool name, source, trigger, ...). See [Matchers](#matchers). Ignored on events without a matcher. |
| `hooks[].type` | Always `"command"`. |
| `hooks[].command` | Command to run. Without `args`, it runs in `bash` (Git Bash on Windows), or in the platform shell when bash is not installed. |
| `hooks[].args` | Optional. When set, `command` is the program to run and `args` its arguments, with no shell involved. |
| `hooks[].shell` | Optional. `"bash"` (default) or `"powershell"` (runs `pwsh`, or `powershell` when `pwsh` is missing). Ignored with `args`. |
| `hooks[].if` | Optional, tool events only. A permission-rule condition such as `"Bash(rm *)"` or `"Edit(*.env)"`: the hook runs only when the call matches, or when Kilo Code cannot tell. See [Conditions](#conditions-with-if). |
| `hooks[].timeout` | Timeout in seconds. Defaults to 600; 30 for `UserPromptSubmit`, `PreModelSwitch`, `PostModelSwitch` and `CommitMessage`; 60 for `WakeupFire` and `WorktreeTeardown`; 300 for `WorktreeSetup`; 10 for `BranchName`. `SessionEnd` hooks share a 1.5 second budget. |
| `hooks[].onFailure` | Optional. What happens when the hook fails: `"continue"` (default) lets the action proceed, `"block"` blocks it. Honored on `PreToolUse`, `PostToolBatch`, `PermissionRequest`, `TaskCreated`, `UserPromptSubmit`, `UserPromptExpansion`, `PreModelSwitch`, `PreCompact`, `WakeupFire`, `WorktreeSetup`, `CommitMessage` and `BranchName`. See [Make guards fail closed](#make-guards-fail-closed). |
| `hooks[].async` | Optional. `true` runs the hook in the background: Kilo Code does not wait for it, logs its output, and ignores its exit code, decisions and `onFailure`. Its timeout still applies. |

All hooks that match an event run in parallel, up to 8 at a time. The same command runs only once, even if several groups match (for `apply_patch`, once per patched file). Background hooks share a limit of 8 running at once. When a hook times out, or when you cancel the agent, its whole process tree is stopped.

{% callout type="warning" %}
Hooks are only read from your global config, managed config, and organization config. Hooks in a project's `kilo.json`, `kilo.jsonc`, or `.kilo/` folder are ignored, so a repository you clone cannot run commands on your machine.
{% /callout %}

### Matchers

| Matcher | Matches |
|---|---|
| Omitted, `""`, or `"*"` | Everything |
| Names separated by `\|` or `,`, e.g. `"edit\|write"` | Exactly those names |
| Anything else, e.g. `"^github_.*"` | Values that match the regular expression |

On `StopFailure`, only letters, digits, `_` and `|` count as an exact list. On `FileChanged`, the matcher is the list of file names to watch, each taken literally (`".envrc|.env"`; `"*"` is a file named `*`). A `FileChanged` hook without a matcher watches no file by itself: it runs for the paths other hooks add with `watchPaths`. Events without a matcher run every hook every time. The [hooks reference](/docs/customize/hooks-reference#matcher-values) lists the values each event matches against.

For tool events, Kilo Code tool ids and their Claude Code names both match, so `"edit|write"` and `"Edit|Write"` are equivalent:

| Kilo Code | Claude Code |
|---|---|
| `bash` | `Bash` |
| `read` | `Read` |
| `write` | `Write` |
| `edit`, `apply_patch` | `Edit` (also `MultiEdit`) |
| `glob` | `Glob` |
| `grep` | `Grep` |
| `webfetch` | `WebFetch` |
| `websearch` | `WebSearch` |
| `task` | `Agent` (also `Task`) |
| `todowrite` | `TodoWrite` |
| `question` | `AskUserQuestion` |
| `skill` | `Skill` |
| `list_mcp_resources` | `ListMcpResourcesTool` |
| `read_mcp_resource` | `ReadMcpResourceTool` |
| `plan_exit` | `ExitPlanMode` |
| `notebook_edit`, `notebook_read` | `NotebookEdit`, `NotebookRead` |
| MCP tool `<server>_<tool>` | `mcp__<server>__<tool>` |

Some models edit files with `apply_patch` instead of `edit`. For an `apply_patch` call, hooks run once for each file in the patch, with that file as `file_path`, so a guard on file paths sees every file the patch touches, including deleted files and the old path of moved files.

MCP tools are named `<server>_<tool>` in Kilo Code, e.g. `github_create_issue`. Claude Code's `mcp__github__.*` style also matches them. Characters other than letters, digits, `_` and `-` in server and tool names become `_`.

Matchers are case-sensitive. When a tool matcher lists a tool name that no tool answers to, such as a typo or a Claude Code tool Kilo Code does not have, the hook never runs for it: Kilo Code logs a warning, and the VS Code Hooks tab shows it next to the hook.

### Conditions with `if`

On `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `PermissionRequest`, `if` narrows a hook to some calls with a permission-rule condition: `Tool(pattern)`. Kilo Code skips the hook only when it is sure the call does not match. Anything it cannot evaluate runs the hook, so a guard never runs less often than written.

| Condition | Evaluated as |
|---|---|
| `Bash(rm *)` | Each part of the command, split on `\|`, `;` and `&`, with leading `NAME=value` assignments removed and repeated spaces counted as one, is matched with `*` wildcards. Commands with quotes, `$`, redirects, subshells, groups, wrappers such as `sudo`, `env`, `xargs` or `sh`, a program given by path such as `/usr/bin/git`, a program name with a `*`, or a program name in another letter case such as `GIT` always run the hook. `prefix:*` means `prefix*`. |
| `Edit(*.env)`, `Read(src/**)` | A glob on the file path. A pattern without `/` matches the file name; `//abs/path` is absolute (on Windows, `//c/Users/me/**` for `C:\Users\me`); `~/` is your home folder; anything else is relative to the project folder. |
| `WebFetch(domain:example.com)` | The URL host is `example.com` or a subdomain of it. |
| `Bash`, `mcp__github__create_issue` | Every call of that tool. |
| Anything else | The hook runs. |

On other events, a hook with `if` never runs, as in Claude Code. The VS Code Hooks tab shows a warning on such a hook, and keeps its `if` when you edit it.

## Hook input

Each hook receives a JSON object on stdin. Every event has these fields:

| Field | Value |
|---|---|
| `session_id` | The root session: for a subagent, the session that started it. Left out for events without a session (`FileChanged`, `ConfigChange`, `CommitMessage`, worktree events). |
| `hook_event_name` | The event. |
| `cwd` | The session folder, or the project folder (`CwdChanged`: the new folder). |
| `prompt_id` | The user message that started the turn, when known. |
| `permission_mode` | `bypassPermissions` when the session allows everything, `plan` with the plan agent, else `default` (also with client-side auto-approve). Sent on tool, `PermissionRequest`, prompt, `Stop`, `SubagentStop` and `CwdChanged` events, and on `InstructionsLoaded` for nested files. |
| `agent_id`, `agent_type` | In subagents: the subagent session id and its type (`general-purpose`, `Explore`, `Plan`, or the Kilo Code agent name). |
| `kilo_session_id` | The session the event belongs to. |
| `kilo_agent` | The Kilo Code agent name. |
| `kilo_platform` | The client: `vscode`, `cli`, ... |

Tool events add `tool_name` (the Claude Code name), `kilo_tool_name`, `tool_input` and `tool_use_id`. `PostToolUse` adds `tool_response` and `kilo_tool_response`; MCP tools add `mcp_server: { "name": "github" }`. A `PostToolUse` input looks like this:

```json
{
  "session_id": "ses_...",
  "kilo_session_id": "ses_...",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUse",
  "permission_mode": "default",
  "tool_name": "Edit",
  "kilo_tool_name": "edit",
  "tool_input": {
    "filePath": "/path/to/project/src/index.ts",
    "file_path": "/path/to/project/src/index.ts",
    "oldString": "...",
    "old_string": "..."
  },
  "tool_use_id": "call_...",
  "tool_response": { "filePath": "/path/to/project/src/index.ts", "success": true },
  "kilo_tool_response": "Edit applied successfully."
}
```

- `tool_input` holds the tool arguments, exactly as the model sent them (see the table below). For built-in tools, Claude Code's names `file_path`, `old_string`, `new_string`, and `replace_all` are added next to Kilo Code's `filePath`, `oldString`, `newString`, and `replaceAll`, and `file_path` is absolute. MCP tool arguments are passed unchanged.
- `tool_response` is an object for `bash` (`stdout`, `stderr`, `interrupted`) and for `write` and `edit` (`filePath`, `success`), as in Claude Code. For other tools it is the output text. `kilo_tool_response` is always the text the agent sees.
- For prompt attachments and command templates, `PreToolUse` gets a `kilo_source` field: `attachment`, `mcp_resource` or `command_template`.

`tool_input` for the built-in tools:

| Tool | `tool_input` fields |
|---|---|
| `bash` (`Bash`) | `command`, `description`, `timeout` (milliseconds), `workdir` |
| `read` (`Read`) | `filePath`, `offset`, `limit`, plus `file_path` |
| `write` (`Write`) | `filePath`, `content`, plus `file_path` |
| `edit` (`Edit`) | `filePath`, `oldString`, `newString`, `replaceAll`, plus `file_path`, `old_string`, `new_string`, `replace_all` |
| `apply_patch` (`Edit`) | `patchText`, plus `file_path` (the file this run is for) and `file_paths` (every file in the patch) |
| `glob` (`Glob`) | `pattern`, `path` |
| `grep` (`Grep`) | `pattern`, `path`, `include` |
| `webfetch` (`WebFetch`) | `url`, `format`, `timeout` |
| `websearch` (`WebSearch`) | `query`, `numResults`, `livecrawl`, `type`, `contextMaxCharacters` |
| `task` (`Agent`) | `description`, `prompt`, `subagent_type`, `task_id`, `command`, `background` |

Optional fields are left out when the model does not set them. A `bash` guard sees the whole `command` string, including quoted text and heredoc bodies, so match it carefully to avoid false positives. The fields of the other events are in the [hooks reference](/docs/customize/hooks-reference#event-input).

Kilo Code does not send `transcript_path`, `agent_transcript_path`, `scratchpad_dir`, `effort` or `background_tasks`: sessions live in a database, not in a transcript file. Use `last_assistant_message` on `Stop`, or run `kilo export <kilo_session_id>`.

The command runs in the project folder with these environment variables:

| Variable | Value |
|---|---|
| `KILO_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` | The project folder. |
| `KILO_HOOK_EVENT` | The event. |
| `KILO_HOOK_DEPTH` | How deep in hooks this process is: `1` for a hook Kilo Code started. See [Loop safety](#loop-safety). |
| `KILO_NO_DAEMON` | `1`: a `kilo` command in a hook starts its own backend and never attaches to a running Kilo daemon. See [Loop safety](#loop-safety). |
| `WORKTREE_PATH`, `REPO_PATH` | `WorktreeSetup` and `WorktreeTeardown` only: the worktree and the main repository, as for setup scripts. |

`CLAUDE_ENV_FILE` is not set.

## Hook output

Exit codes and JSON on stdout combine as in Claude Code:

| Exit code | Effect | JSON on stdout |
|---|---|---|
| `0` | Success. On `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart` and `PostModelSwitch`, plain stdout is added as context. Elsewhere plain stdout is only logged. | Applied. |
| `2` | Blocks on events that can block, with stderr as the reason. On `PermissionRequest`, exit `2` alone is ignored: deny with the JSON `decision` object. On `PostToolUse` and `PostToolUseFailure`, stderr is shown to the agent. On `PostModelSwitch`, `SessionStart`, `SubagentStart`, `PostCompact` and `CwdChanged`, stderr is shown to you. Elsewhere it is logged. | Still applied, but cannot lift the block. A block reason in the JSON is preferred over stderr. |
| Anything else | A hook error: the action proceeds, unless `onFailure` is `"block"`. The first error of each hook in a session is shown to you. | Still applied: a JSON deny on exit `1` blocks. |

A hook also fails when it cannot start, times out, or prints output that starts with `{` but is not valid JSON. On `PreModelSwitch`, a timeout always blocks. On `Stop`, `SubagentStop` and `TaskCompleted`, exit `2` with empty stdout and a `No such file or directory` error is treated as a failure, not a block, so a moved script cannot keep the agent going.

JSON fields:

| Field | Events | Effect |
|---|---|---|
| `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason` | `PreToolUse`, `PreModelSwitch` | Blocks with that reason. |
| `hookSpecificOutput.permissionDecision: "ask"` | `PreToolUse` | Shows a permission prompt for the call, even when rules or auto-approve would allow it. In VS Code, the prompt shows the hook's reason, the tool and the call's input. When nobody can answer (goal turns, wakeups, background subagents, `kilo run` without a terminal), the call is denied. |
| `hookSpecificOutput.permissionDecision: "ask"` | `PreModelSwitch` | Rejects the prompt. |
| `hookSpecificOutput.permissionDecision: "allow"` or `"defer"` | `PreToolUse` | Ignored: hooks cannot skip a permission prompt. |
| `hookSpecificOutput.decision.behavior: "deny"` with `message` | `PermissionRequest` | Denies the call and closes the prompt. With `interrupt: true`, the turn stops too. `"allow"` is ignored. |
| `hookSpecificOutput.updatedInput` | `PreToolUse` | Kilo Code does not rewrite tool input: when it differs from `tool_input`, the call is blocked. |
| `hookSpecificOutput.updatedToolOutput`, `updatedMCPToolOutput` | `PostToolUse` | Replaces the output the agent sees (images and attachments are dropped). Only for calls that succeeded: a shell command that exits non-zero runs `PostToolUseFailure`, which cannot replace the output. |
| `decision: "block"` with `reason` | Events that can block | Blocks with that reason. On `PostToolUse` and `PostToolUseFailure`, the reason is shown to the agent. |
| `continue: false` with `stopReason` | Events that can block, and `PostToolUse`, `PostToolUseFailure` | Stops: rejects the prompt, model switch or compaction; skips the wakeup; pauses the goal on `GoalReport`; never continues on `Stop`. On tool events other than `PermissionRequest`, the turn ends after the current step (`PreToolUse` also blocks the call). On `PermissionRequest` it counts only together with a deny, and then also stops the turn. Ignored on `TaskCreated`, `TaskCompleted`, `WorktreeSetup`, `CommitMessage` and `BranchName`: use exit `2` or `decision: "block"` there. |
| `hookSpecificOutput.additionalContext` | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `UserPromptSubmit`, `UserPromptExpansion`, `PostModelSwitch`, `SessionStart`, `Stop`, `SubagentStop`, `SubagentStart`, `GoalReport`, `WakeupFire` | Adds context for the agent (see below). Ignored on other events. |
| `hookSpecificOutput.watchPaths` | `SessionStart`, `CwdChanged`, `FileChanged` | Absolute paths `FileChanged` also watches. `SessionStart` and `CwdChanged` add to the list (`[]` from `CwdChanged` clears it); `FileChanged` replaces it. |
| `hookSpecificOutput.sessionTitle` | `UserPromptSubmit`, `SessionStart` | Sets the session title. |
| `hookSpecificOutput.suppressOriginalPrompt: true` | `UserPromptSubmit` | Leaves the prompt text out of the "blocked" notice. |
| `hookSpecificOutput.commitMessage` | `CommitMessage` | Replaces the generated commit message. With several hooks, the last one in config order wins. |
| `hookSpecificOutput.branchName` | `BranchName` | Replaces the generated branch name. |
| `systemMessage` | All | Events with a session: shown to you as a notice. Logged on `FileChanged`, `ConfigChange`, `SessionEnd`, `CommitMessage`, `WorktreeSetup` and `WorktreeTeardown`. |

Where context goes:

- `PreToolUse`, `PostToolUse` and `PostToolUseFailure`: next to the tool result the agent sees. `PostToolBatch`: next to the last tool result of the step.
- `UserPromptSubmit` and `UserPromptExpansion`: added to the prompt, hidden in the chat. For `/goal`, `/resume-claude`, `/resume-codex` and commands that run as a subtask, the context is dropped; a block still rejects the command.
- `SessionStart` and `PostModelSwitch`: added to the conversation before the next model call, so the system prompt and its cache stay unchanged.
- `SubagentStart`: added to the subagent's first prompt.
- `Stop` and `SubagentStop`: the agent continues with it, like a block.
- `GoalReport`: added to the reason the goal settles with. `WakeupFire`: added to the wakeup prompt.

Each context item is cut at 10,000 characters.

Blocks, stops, `systemMessage`, stderr shown to you and first errors appear as a notice in the chat. In VS Code, the reason a `Stop` hook made the agent continue, and why an attachment is missing, show as collapsed **Hook feedback** notes in the conversation. `kilo run` prints notices without failing the run.

### Make guards fail closed

By default, a hook that fails lets the action proceed, as in Claude Code. A guard with a wrong path, a missing interpreter, or a crash then protects nothing. For a hook that must stop an action when it cannot decide, set `"onFailure": "block"`. These count as failures:

- The hook cannot start, for example because the script or its interpreter does not exist.
- It runs longer than its `timeout`.
- It exits with a code other than `0` or `2`.
- It prints output that starts like JSON (`{`) but does not parse.

Also:

- Name the interpreter and the script by absolute path, or use `args` (for example `"command": "/usr/bin/python3", "args": ["/Users/me/.config/kilo/hooks/guard.py"]`), so a different `PATH` cannot turn the guard into a no-op.
- Test the guard once by renaming its script: the tool call should be blocked with a message saying the hook failed.
- `PostToolUse` hooks run after the tool, so use them for feedback, formatting, and logging, never to prevent an action.
- Background (`async`) hooks never block.

## Loop safety

Hooks that block can make the agent loop. Kilo Code caps every loop:

- **`Stop` and `SubagentStop`**: a hook can make the agent continue at most 8 times in a row (`KILO_STOP_HOOK_BLOCK_CAP`, or `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). The count resets when the agent calls a tool, but a turn never continues more than 3 times the cap (24 by default), or 2 times on turns nobody is watching: goal turns, wakeups and background results. Kilo Code then ends the turn and shows a notice.
- The second run of a `Stop` hook gets `"stop_hook_active": true`. Exit `0` when it is set if your hook should only ask for one more try:

  ```bash
  [ "$(jq -r '.stop_hook_active')" = "true" ] && exit 0
  ```

- **`GoalReport`**: after 3 rejected reports in a row, the goal is paused with the hook's reason.
- **`FileChanged`**: changes to a file are ignored while its hook runs and for 500 ms after, so a hook that rewrites the file it watches does not loop.
- **`PostToolBatch`**: a block ends the turn.
- **Hooks that run `kilo`**: hooks get `KILO_HOOK_DEPTH`. A Kilo Code started by a hook only runs the tool-guard events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `TaskCreated`, `TaskCompleted`), and from depth 3 none. Hooks also get `KILO_NO_DAEMON=1`, so a `kilo` command in a hook never attaches to a running Kilo daemon, which would not see `KILO_HOOK_DEPTH`.

## Examples

### Lint after every edit

`~/.config/kilo/hooks/lint.sh`:

```bash
#!/bin/sh
file=$(jq -r '.tool_input.file_path // empty')
[ -f "$file" ] || exit 0
[ -x ./node_modules/.bin/eslint ] || exit 0
case "$file" in
  *.ts|*.tsx) ./node_modules/.bin/eslint "$file" >&2 || exit 2 ;;
esac
```

When ESLint reports errors, the script exits with `2`, and the agent sees the errors in the edit result and fixes them. The script uses the project's own ESLint, so it does nothing in projects without one, and it skips deleted files.

{% callout type="tip" %}
To only format files after an edit, without feedback to the agent, the built-in [`formatter`](/docs/code-with-ai/platforms/cli#formatter-and-lsp-toggles) setting is simpler.
{% /callout %}

### Add project context when a session starts

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume", "hooks": [{ "type": "command", "command": "~/.config/kilo/hooks/context.sh" }] }
    ]
  }
}
```

`~/.config/kilo/hooks/context.sh`:

```bash
#!/bin/bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
echo "Current branch: $(git branch --show-current)"
echo "Recent commits:"
git log --oneline -5
```

Plain stdout is added to the conversation before the first response. After compaction, Kilo Code adds the last `SessionStart` context again when no hook matches `compact`.

### Keep going until the tests pass

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "~/.config/kilo/hooks/tests-pass.sh", "timeout": 300 }] }] } }
```

`~/.config/kilo/hooks/tests-pass.sh`:

```bash
#!/bin/bash
input=$(cat)
# Ask for one more try only: never block the continuation itself.
[ "$(jq -r '.stop_hook_active' <<<"$input")" = "true" ] && exit 0
cd "$(jq -r '.cwd' <<<"$input")" || exit 0
[ -f package.json ] || exit 0
if ! out=$(npm test --silent 2>&1); then
  echo "The tests fail. Fix them before finishing:" >&2
  tail -n 30 <<<"$out" >&2
  exit 2
fi
```

### Get a desktop notification

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Kilo Code is waiting for you\" with title \"Kilo Code\"'",
            "async": true
          }
        ]
      }
    ]
  }
}
```

On Linux, use `notify-send "Kilo Code" "Kilo Code is waiting for you"`. `async` keeps the notification from delaying anything.

### Prefix commit messages with the ticket

`~/.config/kilo/hooks/ticket.sh`, registered on `CommitMessage`:

```bash
#!/bin/bash
input=$(cat)
ticket=$(git branch --show-current | grep -oE '[A-Z]+-[0-9]+' | head -n 1)
[ -n "$ticket" ] || exit 0
message=$(jq -r '.commit_message' <<<"$input")
case "$message" in "$ticket"*) exit 0 ;; esac
jq -n --arg m "$ticket: $message" '{ hookSpecificOutput: { hookEventName: "CommitMessage", commitMessage: $m } }'
```

### Give each worktree its own port

`~/.config/kilo/hooks/port.sh`, registered on `WorktreeSetup`:

```bash
#!/bin/bash
# Derive a stable port from the worktree path, so parallel dev servers do not collide.
port=$((3000 + $(printf '%s' "$WORKTREE_PATH" | cksum | cut -d ' ' -f 1) % 1000))
echo "PORT=$port" >>"$WORKTREE_PATH/.env.local"
```

`WorktreeSetup` runs after the repository's `.kilo/setup-script`, so it can rely on installed dependencies. When it exits with `2`, Agent Manager marks the worktree setup as failed.

## Claude Code hooks

When Claude Code compatibility is on, Kilo Code also runs the command hooks from `~/.claude/settings.json`, for every Claude Code event it supports except `ConfigChange` (23 events).

{% callout type="warning" %}
`Stop`, `SessionStart`, `UserPromptSubmit` and `Notification` hooks you wrote for Claude Code now also run in Kilo Code. Set `KILO_DISABLE_CLAUDE_CODE_HOOKS=1` to skip Claude Code hooks while keeping the rest of the compatibility.
{% /callout %}

- `"disableAllHooks": true` in that file turns them all off.
- Hooks from a project's `.claude/settings.json` are not read.
- Kilo-only events (`GoalReport`, `WakeupFire`, `WorktreeSetup`, `WorktreeTeardown`, `CommitMessage`, `BranchName`) and `ConfigChange` are never read from that file.
- Skipped events: `Elicitation`, `ElicitationResult`, `Setup`, `MessageDisplay`, `TeammateIdle`, `WorktreeCreate`, `WorktreeRemove`, `DirectoryAdded` and `PermissionDenied` (not supported by Kilo Code), and `ConfigChange` (Kilo config only).
- Skipped hooks: `asyncRewake` hooks, `if` on an event that is not a tool event, a `shell` other than `bash` or `powershell`, `http`, `prompt`, `agent` and `mcp_tool` hooks, and invalid `args`. The VS Code Hooks tab lists what was skipped.
- In sandboxed sessions, Claude Code hooks are not run. `FileChanged`, which has no session, follows the folder's sandbox default, including the `/sandbox` setting. The sandbox also blocks writes to `~/.claude`, so a sandboxed agent cannot add a hook that would run outside the sandbox.

Claude Code compatibility is on by default in the CLI, and off by default in the VS Code extension (setting `kilo-code.new.claudeCodeCompat`).

## Differences from Claude Code

| Area | Kilo Code |
|---|---|
| `PermissionRequest` | Can only deny. Hooks run at the same time as the prompt, so the prompt shows right away; the first answer wins. `allow`, `updatedInput` and `updatedPermissions` are ignored, so remote-approval hooks still show the local prompt. Not run for calls denied without a prompt, such as those of background subagents. |
| `PreToolUse` scope | Also runs for `@` file attachments, pasted text attachments, MCP resource attachments and `!` shell lines in command templates, so secret guards hold. `PostToolUse` does not run for them. |
| `PreToolUse` `ask` | Never answered by rules, auto-approve or allow-everything, never remembered. Denies the call when nobody can answer. The tool's own permission rule can ask a second time. |
| `updatedInput` | Not applied: a `PreToolUse` hook that rewrites the input blocks the call. |
| `PostToolUseFailure` | Also runs when a shell command exits non-zero (then `PostToolUse` does not run). Not run for the MCP resource tools. It cannot replace the output: `updatedToolOutput` applies only to calls that succeeded. |
| `TaskCreated`, `TaskCompleted` | Run for `todowrite`, the Kilo Code todo tool. A block rolls back only that todo. |
| `UserPromptSubmit` | Not run for wakeups, background results, goal turns or messages from other sessions. |
| `CwdChanged` | Means a shell command ran in a different folder than the previous one: Kilo Code's shell keeps no working directory between commands. |
| `ConfigChange` | Observe only, read from Kilo Code config only, and runs for changes Kilo Code writes, not for edits made outside it. |
| `FileChanged` | A group without a matcher runs only for the paths hooks add with `watchPaths`, not for files other groups name. |
| `watchPaths` | From `CwdChanged`, adds to the watch list instead of replacing it. |
| `systemMessage`, `continue` | `systemMessage` is shown on every event with a session, including `Notification`, `PreCompact`, `PostCompact`, `InstructionsLoaded` and `StopFailure`; `continue: false` on `PreCompact` blocks compaction. |
| Exit `2` on `FileChanged`, `SessionEnd` | stderr is logged, not shown. |
| `CLAUDE_ENV_FILE` | Not provided. |
| `Notification` | Sends 3 of Claude Code's 12 types: `permission_prompt`, `agent_needs_input` (with `kilo_notification_type: "question"`) and `idle_prompt`. |
| `SessionStart`, `SessionEnd` | `SessionStart` sources are `startup`, `resume`, `fork` and `compact` (never `clear`). `SessionEnd` reasons are `other` and `prompt_input_exit`. |
| `SessionStart` context | Added to the conversation after your first message, not before it. |
| `SessionStart` for commands | `/goal`, `/resume-claude` and `/resume-codex` run it on their first model step, not when you send the command. |
| `PreModelSwitch`, `PostModelSwitch` | Matchers are tested against the canonical name (`claude-sonnet-4-5`), the model id, and `provider/model`. A model no spelling matches does not run every hook. |
| Model switch scope | `PostModelSwitch` runs only after a prompt you send or "Implement the plan" switched the model; `PreModelSwitch` only for prompts you send. Neither runs for slash commands, `/goal`, goal turns, wakeups or subagents. |
| `PreCompact` | A block on an automatic compaction lets the turn go on without compacting, and holds for the rest of the turn. If the provider then rejects a request as too long, the turn ends with `Compaction was blocked by a PreCompact hook: <reason>`. With `compaction.threshold_percent` set, Kilo Code also estimates each request before sending it: while a block is in place, a request whose estimate reaches the threshold is not sent and the turn ends the same way. |
| `WorktreeCreate`, `WorktreeRemove` | Not run: they would replace git worktree creation. Use `WorktreeSetup` and `WorktreeTeardown`. `WorktreeSetup` ignores `additionalContext`. |
| Transcript | No `transcript_path`: sessions are stored in a database. |
| Context | Cut at 10,000 characters, without saving the rest to a file. |
| `async` | The timeout applies, and output is only logged instead of being delivered on the next turn. |
| Hook types | Only `command` hooks. `asyncRewake` is skipped. |

## Limitations

- In the global config directory, hooks are read from one config file. Use a single file for your hooks.
- A `PermissionRequest` hook for a call made inside code mode sees the code-mode tool, not the inner tool.
- When `updatedToolOutput` replaces a tool's output, the chat can still show the original output.
- `updatedToolOutput` replaces the output of a call that succeeded. A shell command that exits non-zero, or a tool that fails, runs `PostToolUseFailure`, which can add feedback but cannot replace or redact the output.

## Related

- [Hooks reference](/docs/customize/hooks-reference): the input, matcher values and output of every event.
- [Plugins](/docs/automate/extending/plugins): TypeScript plugins can also hook into tool calls with `tool.execute.before` and `tool.execute.after`.
- [Agent Permissions](/docs/customize/agent-permissions)
