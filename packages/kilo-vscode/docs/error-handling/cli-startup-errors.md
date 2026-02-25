# Surface CLI Startup Errors in the Extension

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6209](https://github.com/Kilo-Org/kilocode/issues/6209)

## Problem

If the CLI fails to start (e.g., due to a malformed `opencode.json`, missing binary, or port conflict), the extension gets stuck on "connecting to the server..." indefinitely. The user receives no feedback about what went wrong.

Common failure cases:

- Malformed `opencode.json` — CLI exits immediately with a JSON parse error
- Missing or corrupted CLI binary at `bin/kilo`
- Another process already holding the port
- OS permission denied when trying to execute the binary

## Remaining Work

- In `ServerManager`, detect when the CLI process exits unexpectedly (before a port is announced)
- Capture the last N lines of stderr output from the process
- Show a clear error notification to the user:
  - `vscode.window.showErrorMessage('Kilo Code: Failed to start CLI server. ' + reason, 'Show Logs', 'Retry')`
  - "Show Logs" should open the extension's output channel with the full stderr
  - "Retry" should attempt to restart the CLI process
- Update the `ConnectionState` to a `'failed'` state and show it in the webview (currently only `'connecting'`, `'connected'`, `'disconnected'` states exist)
- For the specific case of malformed config: parse the error message and show a human-readable hint ("Your opencode.json appears to be invalid JSON. Open it to fix?")

## Implementation Notes

- The `ServerManager.start()` method currently waits for a port line on stdout; add a `process.on('exit', ...)` handler to detect premature exit
- Use the existing output channel from the [Dedicated Output Channel](../infrastructure/dedicated-output-channel.md) work for "Show Logs"
- See also: [#6146 Propagate CLI Errors](propagate-cli-errors-to-ui.md) for the general error propagation case
