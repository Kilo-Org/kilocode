---
title: "Hooks"
description: "Run shell commands automatically before and after Kilo Code uses a tool"
platform: new
---

# Hooks

Hooks run your own commands automatically around the agent's tool calls. Use them to run a linter or formatter after every edit and show its errors to the agent, to block edits to protected files, or to keep secrets out of commands before they run.

Hooks use the same format as [Claude Code hooks](https://code.claude.com/docs/en/hooks), so existing hook scripts work in Kilo Code.

{% callout type="info" %}
Hooks run with your full user permissions and outside the [sandbox](/docs/getting-started/settings/sandboxing). Only add commands you trust.
{% /callout %}

## Supported events

| Event | When it runs | What it can do |
|---|---|---|
| `PreToolUse` | Before a tool call, before any permission prompt | Block the call. The agent sees the reason and can adapt. |
| `PostToolUse` | After a tool call succeeds | Send feedback to the agent, such as lint errors. |

## Configuration

### In VS Code

Open **Settings → Agent Behaviour → Hooks** to see your hooks grouped by event, and to add, edit, or remove them. Changes are saved to your global config when you click **Save**. The tab also lists, read-only, the hooks that run from other config (managed or organization config) and from Claude Code.

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
    ]
  }
}
```

Each event holds a list of groups. A group has an optional `matcher` and a list of `hooks`:

| Field | Description |
|---|---|
| `matcher` | Which tools the group applies to. See [Matchers](#matchers). |
| `hooks[].type` | Always `"command"`. |
| `hooks[].command` | Command to run. Without `args`, it runs through the shell (`sh` on macOS and Linux, `cmd.exe` on Windows). |
| `hooks[].args` | Optional. When set, `command` is the program to run and `args` its arguments, with no shell involved. |
| `hooks[].timeout` | Timeout in seconds. Defaults to 60. |
| `hooks[].onFailure` | Optional. What happens when the hook fails: `"continue"` (default) lets the call run, `"block"` blocks it. Same field and values as Claude Code. See [Make guards fail closed](#make-guards-fail-closed). |

All hooks that match a tool call run in parallel, up to 8 at a time. The same command runs only once, even if several groups match (for `apply_patch`, once per patched file). When a hook times out, its whole process tree is stopped.

{% callout type="warning" %}
Hooks are only read from your global config, managed config, and organization config. Hooks in a project's `kilo.json`, `kilo.jsonc`, or `.kilo/` folder are ignored, so a repository you clone cannot run commands on your machine.
{% /callout %}

### Matchers

| Matcher | Matches |
|---|---|
| Omitted, `""`, or `"*"` | Every tool |
| Names separated by `\|` or `,`, e.g. `"edit\|write"` | Exactly those tools |
| Anything else, e.g. `"^github_.*"` | Tools whose name matches the regular expression |

Kilo Code tool ids and their Claude Code names both match, so `"edit|write"` and `"Edit|Write"` are equivalent:

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

Matchers are case-sensitive. When a matcher lists a tool name that no tool answers to, such as a typo or a Claude Code tool Kilo Code does not have, the hook never runs for it: Kilo Code logs a warning, and the VS Code Hooks tab shows it next to the hook.

## Hook input

Each hook receives a JSON object on stdin:

```json
{
  "session_id": "ses_...",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "kilo_tool_name": "edit",
  "tool_input": {
    "filePath": "/path/to/project/src/index.ts",
    "file_path": "/path/to/project/src/index.ts",
    "oldString": "...",
    "old_string": "..."
  },
  "tool_use_id": "call_...",
  "tool_response": "Edit applied successfully."
}
```

- `tool_input` holds the tool arguments, exactly as the model sent them (see the table below). For built-in tools, Claude Code's names `file_path`, `old_string`, `new_string`, and `replace_all` are added next to Kilo Code's `filePath`, `oldString`, `newString`, and `replaceAll`, and `file_path` is absolute. MCP tool arguments are passed unchanged.
- `tool_response` is the tool output as text and is only sent to `PostToolUse` hooks. Claude Code sends a structured object here, so scripts that read fields of `tool_response` need adapting.
- The command runs in the project directory, with `KILO_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` set to it.

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

Optional fields are left out when the model does not set them. A `bash` guard sees the whole `command` string, including quoted text and heredoc bodies, so match it carefully to avoid false positives.

## Hook output

| Exit code | `PreToolUse` | `PostToolUse` |
|---|---|---|
| `0` | The call proceeds. JSON on stdout can still block it (see below). | Nothing is shown to the agent, unless stdout is JSON with feedback. |
| `2` | The call is blocked. stderr is the reason the agent sees. | stderr is added to the tool result for the agent. |
| Anything else | Logged. The call proceeds, unless `onFailure` is `"block"`. | Logged. |

A hook that times out or fails to start never blocks a tool call, unless `onFailure` is `"block"`. If you cancel the agent while `PreToolUse` hooks are running, the tool call does not run.

For finer control, exit `0` and print a JSON object on stdout:

```json
{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason": "Do not edit generated files" } }
```

| Field | Effect |
|---|---|
| `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason` | `PreToolUse`: blocks the call with that reason. |
| `decision: "block"` with `reason` | `PreToolUse`: blocks the call. `PostToolUse`: shows the reason to the agent. |
| `hookSpecificOutput.additionalContext` | `PostToolUse`: adds the text to the tool result. |
| `continue: false` with `stopReason` | `PreToolUse`: blocks the call. |

`permissionDecision: "allow"` and `"ask"` are ignored: hooks can only make tool use stricter, never skip a permission prompt.

### Make guards fail closed

By default, a hook that fails lets the tool call run, as in Claude Code. A guard with a wrong path, a missing interpreter, or a crash then protects nothing. For a hook that must stop a call when it cannot decide, set `"onFailure": "block"`. These count as failures:

- The hook cannot start, for example because the script or its interpreter does not exist.
- It runs longer than its `timeout`.
- It exits with a code other than `0` or `2`.
- It prints output that starts like JSON (`{`) but does not parse.

Also:

- Name the interpreter and the script by absolute path, or use `args` (for example `"command": "/usr/bin/python3", "args": ["/Users/me/.config/kilo/hooks/guard.py"]`), so a different `PATH` cannot turn the guard into a no-op.
- Test the guard once by renaming its script: the tool call should be blocked with a message saying the hook failed.
- `PostToolUse` hooks run after the tool, so use them for feedback, formatting, and logging, never to prevent an action.

## Example: lint after every edit

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

## Claude Code hooks

When Claude Code compatibility is on, Kilo Code also runs the `PreToolUse` and `PostToolUse` command hooks from `~/.claude/settings.json`:

- `"disableAllHooks": true` in that file turns them all off.
- Hooks that use the Claude Code fields `if`, `async`, `asyncRewake`, or `shell` are skipped, because Kilo Code does not support those fields yet.
- Other events and hook types are skipped, and hooks from a project's `.claude/settings.json` are not read.
- In sandboxed sessions, Claude Code hooks are not run. The sandbox also blocks writes to `~/.claude`, so a sandboxed agent cannot add a hook that would run outside the sandbox.

Claude Code compatibility is on by default in the CLI, and off by default in the VS Code extension (setting `kilo-code.new.claudeCodeCompat`). Set `KILO_DISABLE_CLAUDE_CODE_HOOKS=1` to skip Claude Code hooks while keeping the rest of the compatibility.

## Limitations

- Only `PreToolUse` and `PostToolUse` are supported. Other Claude Code events (`Stop`, `UserPromptSubmit`, `SessionStart`, ...) are ignored.
- Only `command` hooks are supported.
- `PreToolUse` hooks cannot rewrite the tool input (`updatedInput`).
- Tool calls made inside code mode do not run hooks.
- In the global config directory, hooks are read from one config file. Use a single file for your hooks.

## Related

- [Plugins](/docs/automate/extending/plugins): TypeScript plugins can also hook into tool calls with `tool.execute.before` and `tool.execute.after`.
- [Agent Permissions](/docs/customize/agent-permissions)
