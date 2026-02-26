# Subagent Visibility

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6252](https://github.com/Kilo-Org/kilocode/issues/6252)

## Problem

When the main agent spawns a subagent (a nested agent task), the chat UI shows no indication of what the subagent is doing. Users see the parent agent appear idle while subagent work proceeds silently. This makes the UI feel unresponsive.

## Remaining Work

- Show an inline indicator in the chat when a subagent is active, showing:
  - That a subagent is running
  - The subagent's current action (e.g., "Subagent: reading src/index.ts")
  - Progress if available
- When the subagent completes, collapse the indicator into a summary (e.g., "Subagent completed: modified 3 files")
- The indicator should be collapsible — expanded by default while running, collapsible after

## Implementation Notes

- Subagent events come through the CLI's SSE stream as a distinct message or part type
- Identify the relevant event/part type in the CLI's session message schema
- The rendering component is in kilo-ui or `webview-ui/src/`; add a subagent status part renderer
- For the Agent Manager (multi-session view), subagent sessions may already have separate tabs — this issue is specifically about the single-session sidebar view
