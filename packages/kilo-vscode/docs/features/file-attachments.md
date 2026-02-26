# File Attachments in Chat Input

**Priority:** P2
**Status:** 🔨 Partial (assigned)
**Issue:** [#6078](https://github.com/Kilo-Org/kilocode/issues/6078)

## What Exists

Image attachments are already supported. Non-image file attachments (markdown plans, text files, PDFs, etc.) are not.

## Remaining Work

- Add a file attachment button to the chat input toolbar (paperclip icon or similar)
- Support drag-and-drop of files onto the chat input area
- Support a file picker dialog via the button
- For text-based files (`.md`, `.txt`, `.json`, `.ts`, etc.): read the file content and include it as a text part in the message
- For binary files: show an unsupported notice or pass as a binary attachment if the CLI API supports it
- Show attached files as chips/tags above the input before sending, with a remove button
- Limit attachment size with a clear error if exceeded

## Implementation Notes

- The webview cannot directly read files from the filesystem due to VS Code CSP restrictions
- Pattern: webview sends a `requestFilePick` message → extension opens `vscode.window.showOpenDialog()` → extension reads the file and sends content back as a `fileAttachment` message
- Alternatively, drag-and-drop within the webview can use the browser File API to read file content (works because the file is dropped into the webview DOM)
- The CLI's message send API accepts text parts; embed the file content inline in the message text or as a separate part
