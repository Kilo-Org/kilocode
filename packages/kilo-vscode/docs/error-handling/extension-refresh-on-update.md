# Extension View Doesn't Refresh on Restart/Update

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6086](https://github.com/Kilo-Org/kilocode/issues/6086)

## Problem

When the extension updates and VS Code restarts the extensions, an already-open Kilo Code webview panel does not reload. It continues showing the old version's UI until the user manually closes and reopens the panel.

## Remaining Work

- Subscribe to `vscode.extensions.onDidChange` to detect when an extension is updated
- When the Kilo Code extension itself is updated (compare version strings), force-reload the webview panel: dispose the existing panel and recreate it
- Alternatively, post a message to the webview to trigger a page reload (`panel.webview.postMessage({ type: 'reload' })`) and handle it in the webview with `window.location.reload()`
- If the extension host restarts (not just the webview), the `activate()` function will re-run — ensure the panel is properly disposed and recreated in this case too

## Implementation Notes

- `vscode.extensions.onDidChange` fires when extension installations change
- The webview panel object (`KiloProvider.panel`) should be checked for staleness after an extension host restart
- A simpler approach: on activation, if a previously-persisted panel view state exists, recreate the panel fresh instead of restoring the stale one
