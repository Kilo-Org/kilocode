---
"kilo-code": minor
"@kilocode/cli": minor
"@kilocode/core-schemas": patch
---

Add image support to Agent Manager

- Paste images from clipboard (Ctrl/Cmd+V) or select via file browser button
- Works in new agent prompts, follow-up messages, and resumed sessions
- Support for PNG, JPEG, WebP, and GIF formats (up to 4 images per message)
- Click thumbnails to preview, hover to remove
- New `newTask` stdin message type for initial prompts with images
- Temp image files are automatically cleaned up when extension deactivates
