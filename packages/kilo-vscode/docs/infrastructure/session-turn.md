# Switch to Session Turn

**Priority:** P2
**Status:** 🔨 Partial (assigned)
**Issue:** [#6244](https://github.com/Kilo-Org/kilocode/issues/6244)

## Problem

The CLI introduced a `Session Turn` concept — a structured unit of work within a session that groups related messages, tool calls, and results. The extension currently works at the raw message/part level, which makes it harder to:

- Track the lifecycle of a single agent turn (start, running, complete, error)
- Group messages for display (e.g., collapsing all tool calls within one turn)
- Implement features like "retry this turn" or "edit and retry"

## Remaining Work

- Understand the `Session Turn` API in the CLI — look at `packages/opencode/src/session/` for the turn model
- Update the extension's session state management to track turns, not just individual messages
- Adjust the webview's message rendering to group content by turn where appropriate
- The SDK (once [#6243](sdk-over-http.md) is done) should expose turn-level endpoints natively

## Implementation Notes

- This is primarily an architectural refactor of how the extension consumes session data
- The Agent Manager is particularly relevant here: turn-level tracking enables better "what is this agent doing?" visibility
- Coordinate with the [Session Turn](sdk-over-http.md) SDK work — the SDK should expose turn methods cleanly before migrating the extension
