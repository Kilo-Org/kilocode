# VSCode Error Notifications for Critical Failures

**Priority:** P1

`showErrorMessage` is used in peripheral services (commit, Agent Manager, autocomplete). Core connection errors only go to `console.error` and webview `postMessage`.

## Remaining Work

- Show `showErrorMessage()` when CLI binary is missing or server fails to start
- Show `showWarningMessage()` when SSE connection is lost (with "Retry" action)
- Avoid notification spam — throttle or deduplicate repeated errors
