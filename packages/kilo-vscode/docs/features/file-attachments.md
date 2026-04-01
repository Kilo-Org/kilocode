# File Attachments in Chat Input

**Priority:** P2
**Issue:** [#6078](https://github.com/Kilo-Org/kilocode/issues/6078)

Image attachments and `@file` path mentions work. Non-image file content attachments are missing.

## Remaining Work

- Add a file attachment button to the chat input toolbar (paperclip icon or similar)
- Support drag-and-drop of non-image files onto the chat input area
- Support a file picker dialog via the button
- For text-based files: read content and include as a text part in the message
- For binary files: show an unsupported notice
- Show attached files as chips/tags above the input with remove button
- Limit attachment size with a clear error if exceeded
