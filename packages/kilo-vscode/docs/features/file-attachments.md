# File Attachments in Chat Input

**Priority:** P2
**Issue:** [#6078](https://github.com/Kilo-Org/kilocode/issues/6078)

Image attachments and `@file` path mentions work. Non-image file content attachments are missing.

## Supported Image Types

The following image formats are supported for paste and drag-and-drop:

- PNG (`image/png`)
- JPEG (`image/jpeg`)
- GIF (`image/gif`)
- WebP (`image/webp`)

## Drag-and-Drop (Shift Required)

VS Code disables webview pointer-events during drag operations so it can handle drops in the editor area. To drop images into the chat input, **hold Shift while dragging**. This re-enables the webview to receive drop events (VS Code 1.91+, see [microsoft/vscode#182449](https://github.com/microsoft/vscode/issues/182449)).

## Remaining Work

- Add a file attachment button to the chat input toolbar (paperclip icon or similar)
- Support drag-and-drop of non-image files onto the chat input area
- Support a file picker dialog via the button
- For text-based files: read content and include as a text part in the message
- For binary files: show an unsupported notice
- Show attached files as chips/tags above the input with remove button
- Limit attachment size with a clear error if exceeded
