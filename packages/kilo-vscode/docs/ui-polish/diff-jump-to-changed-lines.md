# Diff: Jump to Changed Lines

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6076](https://github.com/Kilo-Org/kilocode/issues/6076)

## What Exists

Diffs from agent tool calls (file edits) are rendered in the chat as read-only diff views. They are not interactive.

## Remaining Work

- Make diff entries in the chat clickable: clicking a hunk should open the corresponding file in the VS Code editor and scroll to the start of the changed lines
- Use `vscode.window.showTextDocument()` with a `selection` range pointing to the first changed line
- The diff component in kilo-ui needs to emit an event or accept an `onClick` callback carrying the file path and line number
- The `KiloProvider` (or a message handler) needs to translate that into a `vscode.commands.executeCommand('vscode.open', uri, { selection })` call

## Implementation Notes

- File paths in diff messages come from the CLI's tool output — they are absolute paths in the workspace
- Wire up: diff click → webview posts `openFile` message with `{ path, line }` → extension opens file at line
- Pattern already exists for other "open file" actions in the extension; follow the same message/handler path
