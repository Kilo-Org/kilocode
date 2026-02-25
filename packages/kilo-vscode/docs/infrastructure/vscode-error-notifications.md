# VSCode Error Notifications for Critical Failures

**Priority:** P1
**Status:** 🔨 Partial
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## What Exists

- `showErrorMessage()` used in peripheral services: commit message service (5 calls), Agent Manager (worktree failures), autocomplete (Copilot conflicts)
- `showWarningMessage()` used for: reset settings confirmation, worktree git requirement
- `showInformationMessage()` used for: terminal actions ("no terminal content available")

## Remaining Work

- Show `vscode.window.showErrorMessage()` when CLI binary is missing or server fails to start
- Show `vscode.window.showWarningMessage()` when SSE connection is lost (with "Retry" action)
- Avoid notification spam — throttle or deduplicate repeated errors
- Currently all core connection errors only go to `console.error` and webview `postMessage` — if webview is hidden, user sees nothing

## Implementation Notes

```typescript
// In initializeConnection() catch block:
vscode.window.showErrorMessage(`Kilo Code: Failed to start CLI server — ${error.message}`, "Retry").then((action) => {
  if (action === "Retry") this.initializeConnection()
})
```

Files to change:

- [`src/KiloProvider.ts`](../../src/KiloProvider.ts) — add `vscode.window.showErrorMessage()` calls in error paths
- [`src/services/cli-backend/connection-service.ts`](../../src/services/cli-backend/connection-service.ts) — surface critical errors to callers
