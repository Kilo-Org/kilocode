# Task Completion Notification

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6084](https://github.com/Kilo-Org/kilocode/issues/6084)

## Problem

Agent tasks can take minutes. Users often switch to another window while waiting. There is currently no way for the extension to alert the user that:

- A task has completed
- The agent is waiting for user input (permission request, question prompt)

## Remaining Work

- When a session transitions to "complete" or "awaiting input" state, show a VS Code notification (toast) if the Kilo Code window is not currently focused
- Use `vscode.window.showInformationMessage()` for task completion
- Use `vscode.window.showWarningMessage()` for permission requests requiring attention
- Add a setting to enable/disable these notifications (default: on)
- Notifications should include a "Show" button that focuses the Kilo Code webview panel

## Implementation Notes

- Session state changes come via SSE events in `KiloConnectionService`
- Track whether the webview panel is currently visible/focused (`KiloProvider.panel.visible`)
- Only fire the notification when the panel is not visible — avoid notifying when the user is already watching
- The `vscode.window.createStatusBarItem()` could also be used as a persistent indicator showing "1 task awaiting input"
