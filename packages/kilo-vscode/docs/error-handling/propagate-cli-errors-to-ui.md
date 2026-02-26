# Propagate All CLI Errors to the UI

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6146](https://github.com/Kilo-Org/kilocode/issues/6146)

## Problem

Errors that occur inside the CLI (e.g., TypeScript compilation failures, missing dependencies, tool errors) are not surfaced in the chat UI. The extension silently shows no response, leaving users with no indication of what went wrong.

Example: in a fresh clone without `bun install`, the CLI fails with a module resolution error. The extension shows nothing — the user has to run the CLI manually to discover the problem.

## Remaining Work

- Intercept CLI error output (stderr) in `ServerManager` and/or `KiloConnectionService`
- Surface errors to the user in one or more ways:
  1. Show a VS Code error notification for critical/startup errors (`vscode.window.showErrorMessage`)
  2. For errors that occur mid-session, inject an error message into the chat UI as a system message
  3. Ensure the CLI's error SSE events are forwarded to the webview and rendered as error cards
- Distinguish between startup errors (before connection is established) and runtime errors (during a session)
- For startup errors: capture stderr output from the CLI process in `ServerManager` and show it to the user with a "Show details" button

## Implementation Notes

- `ServerManager` already captures the process stdout for port detection; extend it to also capture stderr
- If the process exits with a non-zero code, show `vscode.window.showErrorMessage` with the last N lines of stderr
- See also: [#6209 CLI Startup Errors](cli-startup-errors.md) which covers the specific startup error case
