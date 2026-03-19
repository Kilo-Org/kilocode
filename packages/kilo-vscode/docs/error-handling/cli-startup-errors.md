# Surface CLI Startup Errors in the Extension

**Priority:** P1
**Issue:** [#6209](https://github.com/Kilo-Org/kilocode/issues/6209)

StartupErrorBanner exists in webview but VS Code-native notifications for startup failures are missing.

## Remaining Work

- Detect CLI process unexpected exit before port announced (`process.on('exit', ...)` in ServerManager)
- Capture last N lines of stderr
- Show error notification with "Show Logs" and "Retry" buttons
- Add `'failed'` state to `ConnectionState`
- For malformed config: parse error and show human-readable hint
