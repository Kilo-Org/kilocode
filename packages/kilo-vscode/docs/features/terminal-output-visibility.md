# Terminal Command Output Visibility

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6256](https://github.com/Kilo-Org/kilocode/issues/6256)

## Problem

When the agent executes a terminal command, the chat shows only a generic heading (e.g., "Running command"). It does not show:

- The actual command being run
- Any output from the command
- Whether the command succeeded or failed

The CLI TUI already shows this information. The lack of visibility makes the extension feel opaque and makes the permission model harder to evaluate ("do I want to allow this command if I can't even see what it is?").

## Remaining Work

- Show the actual command string in the terminal tool call row (not just a generic "executing terminal command" label)
- Show truncated command output (e.g., first 10 lines or 500 characters) in an expandable section below the command
- Show a clear success/failure indicator (green checkmark / red × with exit code)
- For long-running commands, show streaming output in real-time if the CLI sends incremental output via SSE
- The full output should be accessible via expand (not shown in full by default to avoid cluttering the chat)

## Implementation Notes

- Terminal tool calls are a specific part type in the CLI's message schema; the command string and result/output are in the part payload
- The rendering is in kilo-ui or `webview-ui/src/`
- The CLI may send output as a single result part after completion, or incrementally via SSE — check what the CLI actually sends and design the renderer accordingly
