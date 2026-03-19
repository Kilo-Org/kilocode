# Propagate All CLI Errors to the UI

**Priority:** P1
**Issue:** [#6146](https://github.com/Kilo-Org/kilocode/issues/6146)

## Remaining Work

- Intercept CLI error output (stderr) in `ServerManager` / `KiloConnectionService`
- Show VS Code error notification for critical/startup errors
- Inject error messages into chat UI as system messages for mid-session errors
- Ensure CLI's error SSE events are forwarded to the webview and rendered
- Distinguish between startup errors and runtime errors
