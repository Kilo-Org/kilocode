# New Task Discoverability

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6250](https://github.com/Kilo-Org/kilocode/issues/6250)

## Problem

The new extension only supports starting a new task by clicking the "+" button in the header. The legacy extension offered three clear affordances:

1. A "+" button in the header
2. A prominent "Start new Task" button at the bottom of the active task
3. An "×" close button on the task header to end the current task

Users coming from the legacy extension are confused and don't know how to start fresh. Long-running sessions accumulate context, so having obvious ways to start new tasks is important for usability.

## Remaining Work

- Add a "New task" button at the bottom of the chat, visible when a session is active (below the last message, above the input box, or as a floating button)
- Add a close/end button on the active session header that ends the session and returns to the session list or a clean input state
- Both actions should create a new CLI session (equivalent to what the "+" header button already does)
- Keep the existing "+" header button as a third entry point

## Implementation Notes

- Session creation is done by calling the CLI's session create endpoint via the extension's HTTP client
- The webview posts a message to the extension which triggers the session create call; follow the existing pattern
- New UI elements go in `webview-ui/src/`
