# Task Completion Notification

**Priority:** P2
**Issue:** [#6084](https://github.com/Kilo-Org/kilocode/issues/6084)

## Implementation

- `kilo-code.new.attention.notifications` enables VS Code workbench notifications (default: off).
- `kilo-code.new.attention.windowsNotifications` enables Windows notification center alerts while VS Code is unfocused (default: off).
- The OS notification setting appears only on Windows. macOS and Linux require separate native notification implementations.
- Completion and questions use `showInformationMessage()`; permission requests use `showWarningMessage()`; terminal failures use `showErrorMessage()`.
- Alerts include the originating workspace and session title. The VS Code "Show" action opens that session.
- Errors are only announced after the errored root turn closes without retrying; manual aborts are ignored.
- Notifications are suppressed while the Kilo sidebar, a Kilo editor tab, or Agent Manager is active.
