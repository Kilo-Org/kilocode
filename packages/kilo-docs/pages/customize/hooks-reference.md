---
title: "Hooks Reference"
description: "Input fields, matcher values, defaults and output of every Kilo Code hook event"
platform: new
---

# Hooks reference

This page lists, for each [hook](/docs/customize/hooks) event, what Kilo Code sends on stdin, what the matcher is tested against, and what the hook's output does. Read [Hooks](/docs/customize/hooks) first for the configuration format, the common input fields and the exit-code rules.

## Defaults

| Event | Default timeout | `onFailure: "block"` | Exit `2` | Context from |
|---|---|---|---|---|
| `PreToolUse` | 600 s | Honored | Blocks the call | JSON |
| `PostToolUse` | 600 s | Ignored | stderr to the agent | JSON |
| `PostToolUseFailure` | 600 s | Ignored | stderr to the agent | JSON |
| `PostToolBatch` | 600 s | Honored | Ends the turn | JSON |
| `PermissionRequest` | 600 s | Honored (denies) | Logged | None |
| `TaskCreated` | 600 s | Honored | The todo is not added | None |
| `TaskCompleted` | 600 s | Ignored | The todo stays open | None |
| `UserPromptSubmit` | 30 s | Honored | Rejects the prompt | JSON and stdout |
| `UserPromptExpansion` | 600 s | Honored | Rejects the command | JSON and stdout |
| `PreModelSwitch` | 30 s (a timeout blocks) | Honored | Rejects the prompt | None |
| `PostModelSwitch` | 30 s | Ignored | stderr to you | JSON and stdout |
| `SessionStart` | 600 s | Ignored | stderr to you | JSON and stdout |
| `SessionEnd` | 1.5 s for all hooks together | Ignored | Logged | None |
| `InstructionsLoaded` | 600 s | Ignored | Logged | None |
| `Stop` | 600 s | Ignored | The agent continues | JSON |
| `SubagentStop` | 600 s | Ignored | The subagent continues | JSON |
| `SubagentStart` | 600 s | Ignored | stderr to you | JSON |
| `StopFailure` | 600 s | Ignored | Logged | None |
| `PreCompact` | 600 s | Honored | Skips compaction | None |
| `PostCompact` | 600 s | Ignored | stderr to you | None |
| `Notification` | 600 s | Ignored | Logged | None |
| `ConfigChange` | 600 s | Ignored | Logged | None |
| `FileChanged` | 600 s | Ignored | Logged | None |
| `CwdChanged` | 600 s | Ignored | stderr to you | None |
| `GoalReport` | 600 s | Ignored | The goal keeps running | JSON |
| `WakeupFire` | 60 s | Honored (skips) | Skips the occurrence | JSON |
| `WorktreeSetup` | 300 s | Honored | Setup is marked failed | None |
| `WorktreeTeardown` | 60 s | Ignored | Logged | None |
| `CommitMessage` | 30 s | Honored | Rejects the message | None |
| `BranchName` | 10 s | Honored | Keeps the current name | None |

"JSON" means `hookSpecificOutput.additionalContext`; "stdout" means plain stdout of a hook that exits `0`. A hook that fails (it cannot start, times out, prints invalid JSON, or exits with a code other than `0` or `2`) does not block, unless `onFailure: "block"` is set on an event that honors it. There are two exceptions: a `PreModelSwitch` hook that times out always blocks, and the JSON output of a hook that exits with another code still applies, so a JSON deny on exit `1` blocks.

## Matcher values

| Event | Matched against | Values |
|---|---|---|
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` | Tool name | Kilo Code tool ids, their Claude Code names, MCP tools. See [Matchers](/docs/customize/hooks#matchers). |
| `UserPromptExpansion` | `command_name` | The command, skill or MCP prompt name. |
| `PreModelSwitch`, `PostModelSwitch` | The new model | The canonical name (`claude-sonnet-4-5`: lower case, date suffix and `[1m]` removed, `.` replaced by `-`), the bare model id (`claude-sonnet-4.5`), the model id (`anthropic/claude-sonnet-4.5`) and `provider/model`. |
| `SessionStart` | `source` | `startup`, `resume`, `fork`, `compact` |
| `SessionEnd` | `reason` | `other`, `prompt_input_exit` |
| `InstructionsLoaded` | `load_reason` | `session_start`, `nested_traversal`, `compact` |
| `SubagentStop`, `SubagentStart` | Agent type | The Kilo Code agent name and its Claude Code alias: `general` and `general-purpose`, `explore` and `Explore`, `plan` and `Plan`. |
| `StopFailure` | `error` | `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `model_not_found`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`. Only letters, digits, `_` and `\|` count as an exact list. |
| `PreCompact`, `PostCompact` | `trigger` | `manual`, `auto` |
| `Notification` | `notification_type` | `permission_prompt`, `agent_needs_input`, `idle_prompt` |
| `ConfigChange` | `source` | `user_settings`, `project_settings` |
| `FileChanged` | File name | The file names to watch in the project folder, separated by `\|`, each taken literally. Without a matcher, the hook watches no file by itself and runs for the paths other hooks add with `watchPaths`. |
| `GoalReport` | `reported_status` | `complete`, `blocked` |
| `WakeupFire` | `kind` | `once`, `cron` |
| `WorktreeSetup` | `origin` | `create`, `promote`, `import`, `multi_version`, `tool`, `continue`, `cli` |

`PostToolBatch`, `TaskCreated`, `TaskCompleted`, `UserPromptSubmit`, `Stop`, `CwdChanged`, `WorktreeTeardown`, `CommitMessage` and `BranchName` have no matcher: every hook runs, and a `matcher` field is ignored.

## Event input

Fields each event adds to the [common fields](/docs/customize/hooks#hook-input):

| Event | Fields |
|---|---|
| `PreToolUse` | `tool_name`, `kilo_tool_name`, `tool_input`, `tool_use_id`, `mcp_server`, `kilo_source` (attachments and command templates) |
| `PostToolUse` | Same as `PreToolUse`, plus `tool_response`, `kilo_tool_response` |
| `PostToolUseFailure` | `tool_name`, `kilo_tool_name`, `tool_input`, `tool_use_id`, `mcp_server`, `error` (`Exit code N` and the output for shell commands, `Command timed out after N ms` and the output for a command killed at its timeout), `is_interrupt` (`false` for a shell timeout), `duration_ms` |
| `PostToolBatch` | `tool_calls`: `tool_name`, `tool_input`, `tool_use_id` and `tool_response` (the text the model sees) for each call of the step |
| `PermissionRequest` | `tool_name`, `kilo_tool_name`, `tool_input`, `mcp_server`, `kilo_permission`, `kilo_patterns` |
| `TaskCreated`, `TaskCompleted` | `task_id` (stable, derived from the todo text), `task_subject`, `kilo_status`, `kilo_priority` |
| `UserPromptSubmit` | `prompt`, `session_title` |
| `UserPromptExpansion` | `expansion_type` (`slash_command` or `mcp_prompt`), `command_name`, `command_args`, `command_source`, `prompt` |
| `PreModelSwitch`, `PostModelSwitch` | `from_model`, `to_model`, `requested_model` (bare model ids), `source` (`sdk`, or `plan_followup` after "Implement the plan"), `kilo_from`, `kilo_to` |
| `SessionStart` | `source`, `model`, `session_title` |
| `SessionEnd` | `reason` |
| `InstructionsLoaded` | `file_path`, `memory_type` (`User`, `Managed` or `Project`), `load_reason`, `trigger_file_path` (nested files) |
| `Stop`, `SubagentStop` | `stop_hook_active`, `last_assistant_message`, `session_crons` (pending wakeups and cron tasks: `id`, `schedule`, `recurring`, `prompt`); `SubagentStop` adds `kilo_agent_type` |
| `SubagentStart` | `kilo_agent_type`, `kilo_resumed` |
| `StopFailure` | `error`, `error_details`, `last_assistant_message`, `kilo_error_name` |
| `PreCompact` | `trigger`, `kilo_trigger` (`tool` when the model asked for compaction), `custom_instructions` (always `null`) |
| `PostCompact` | `trigger`, `compact_summary` |
| `Notification` | `message`, `title`, `notification_type`, `kilo_notification_type` |
| `ConfigChange` | `source` |
| `FileChanged` | `file_path`, `event` (`change`, `add` or `unlink`) |
| `CwdChanged` | `old_cwd`, `new_cwd` |
| `GoalReport` | `goal`, `reported_status`, `reason`, `report_hook_active`, `attempt` |
| `WakeupFire` | `kind`, `wakeup_id`, `prompt`, `due_at`, `goal_linked` |
| `WorktreeSetup` | `worktree_path`, `repo_path`, `branch`, `parent_branch`, `origin`, `setup_script` (`none`, `succeeded` or `failed`) |
| `WorktreeTeardown` | `worktree_path`, `repo_path` |
| `CommitMessage` | `commit_message`, `selected_files`, `previous_message`, `language`, `kilo_path` |
| `BranchName` | `branch_name`, `prompt` |

## Event details

### Tool events

- `PreToolUse` runs before the permission prompt. For prompt attachments (`@file`, pasted text, MCP resources) the tool is `read` (`Read`) or `read_mcp_resource` (`ReadMcpResourceTool`); a block replaces the attachment with a note and its content is never read. For `` !`cmd` `` lines in command templates the tool is `bash`; a blocked line is replaced by the reason. `ask` cannot prompt for attachments, so it blocks them.
- Code-mode tool calls run `PreToolUse` and `PostToolUse` with the inner tool's name. They cannot prompt, so `ask` blocks them.
- `PostToolUse` runs for calls that succeeded, and only it can replace the output with `updatedToolOutput`. A tool that fails, or a shell command that exits non-zero or is killed at its timeout, runs `PostToolUseFailure` instead, which can add feedback but cannot replace the output.
- `PostToolUseFailure` does not run when you cancel a call, for permission rejections, or when a hook blocked the call.
- `PermissionRequest` runs when a prompt is shown, including the prompts a `PreToolUse` `ask` opens. It does not run for calls rules allow or deny, for background subagents (which are denied without a prompt), or for sandbox network prompts.
- `TaskCreated` and `TaskCompleted` compare the new todo list with the previous one, by todo text. A blocked todo is removed from (or kept open in) the list the tool saves; the agent sees the reason and is asked to resubmit later. The chat still shows the list the model sent.

### Prompts

- `UserPromptSubmit` runs for prompts and slash commands you send, and for messages you send to a running subagent. It does not run for goal turns, wakeups, background results, task prompts to subagents, or `Stop` continuations. For a slash command, `prompt` is `/name arguments`.
- Prompts are admitted in the order they arrive, and the session shows as busy while these hooks run; **Stop** cancels them.
- A blocked prompt is not saved. You see a notice with the reason and your prompt text, so you can copy it.
- `UserPromptExpansion` runs before the template's `!` shell lines, so a block keeps them from running.
- `PreModelSwitch` runs only when a prompt you send changes the session's provider or model. Slash commands, `/goal` prompts, goal turns, wakeups, subagents and the first model of a session apply their model without it, and without `PostModelSwitch`. `PostModelSwitch` also runs after "Implement the plan" switched the model (`source` is `plan_followup`).

### Sessions

- `SessionStart` runs once per session in each Kilo Code process: before the first prompt's `UserPromptSubmit`, or on the first model step of `/goal`, `/resume-claude`, `/resume-codex`, a wakeup or a summarize. It runs again with `compact` after compaction. Subagents run `SubagentStart` instead.
- Context from `SessionStart` starts with a note telling the model to treat it as information, not instructions. It is added to the conversation after your first message, not before it, and Kilo Code adds the last startup context again after compaction when no `SessionStart` hook matches `compact`.
- `SessionEnd` runs when a session that ran `SessionStart` is deleted, and when `kilo serve`, the TUI or `kilo run` exits. With `kilo run --attach`, the session belongs to the server you attach to, so it ends when that server exits. All `SessionEnd` hooks of one exit share 1.5 seconds, raised to the largest `SessionEnd` `timeout` in your config (at most 60 seconds). `KILO_SESSIONEND_HOOKS_TIMEOUT_MS` (or `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`) replaces that budget, with no 60-second limit. Under `kilo serve` and the TUI the budget, including that override, is capped at 3 seconds. The minimal interface (`--mini`) keeps the full budget.
- `InstructionsLoaded` runs for each instruction file of the session when `SessionStart` runs, and when the agent reads a file in a folder with its own `AGENTS.md`. `memory_type` is `User` for files in your Kilo Code or Claude Code config folders, `Managed` for managed config, and `Project` otherwise.

### Agent loop

- `Stop` and `SubagentStop` run only when the agent finishes on its own: not after errors, cancellations, `/compact`, or when another prompt is queued. A block or `additionalContext` adds a "Stop hook feedback" message to the conversation and the agent continues. See [Loop safety](/docs/customize/hooks#loop-safety) for the caps.
- A continued subagent's final answer becomes the task result.
- `SubagentStart` runs for every task-tool spawn and resume, in the foreground or background, including command subtasks.
- `StopFailure` runs for the main session only, after a turn ended with an error.

### Compaction

| Compaction | When `PreCompact` blocks |
|---|---|
| `/compact` (`manual`) | Compaction does not happen and you see a notice. |
| The model's context tool (`auto`, `kilo_trigger: "tool"`) | The tool tells the model compaction was blocked; the turn continues. |
| Before a request, when the last response was large enough to trigger compaction (`auto`) | The request is sent without compaction. The block holds for the rest of the turn, so the hook runs at most once per turn. |
| After the provider rejected a request as too long (`auto`) | The turn ends with a context overflow error: `Compaction was blocked by a PreCompact hook: <reason>`. |
| With `compaction.threshold_percent` set, when Kilo Code's own estimate of the next request reaches the threshold (`auto`) | Kilo Code does not send a request it estimates to be too large, so the turn ends with the same error even though the provider has not rejected anything. |

`PostCompact` runs in the background after compaction, and the next model call runs `SessionStart` with `source: "compact"`.

### Environment

- `Notification` fires once a permission prompt or a question stays unanswered for 6 seconds, and once the session is idle for 60 seconds after a turn. Answering earlier cancels it.
- `ConfigChange` runs after the VS Code settings or another Kilo Code client changed the global config (`user_settings`) or the project config (`project_settings`) through Kilo Code. A global change runs the hook once, even with several projects open.
- `FileChanged` watches the file names in its matchers in the project folder, plus the absolute paths hooks return in `watchPaths`. A group without a matcher adds nothing to the watch list and runs only for the paths hooks add with `watchPaths`, so use one to handle those paths. Changes are debounced by 100 ms.
- `CwdChanged` compares the `workdir` of each shell command with the previous one in the session, starting from the session folder.

### Kilo only

- `GoalReport` runs when the `/goal` model reported `complete` or `blocked`, before the goal settles. A block sends the reason to the next goal turn as feedback; after 3 blocks in a row the goal is paused. `continue: false` pauses the goal. Pausing or cancelling the goal stops the hook.
- `WakeupFire` runs in the background when a wakeup or cron occurrence is due, so a slow hook never delays Kilo Code. A block skips that occurrence; a cron task keeps its schedule. For a wakeup a goal is waiting on, a block pauses the goal with the reason.
- `WorktreeSetup` runs for every Agent Manager worktree (created, promoted, imported, multi-version, from the worktree tool, or continued in a worktree) and for `kilo` CLI worktrees. In Agent Manager the session starts only after these hooks finish. The CLI ignores a block (it only logs it).
- `WorktreeTeardown` runs before Agent Manager or the CLI removes a managed worktree, and Kilo Code waits for it, so a `docker compose down` finishes first. It cannot block.
- `CommitMessage` runs in the repository folder when the commit path is inside the project, and in the project folder otherwise. A block shows the reason as the commit message error.
- `BranchName` runs after Agent Manager generated a branch name. A block keeps the current name; a rewritten name is still sanitized.
