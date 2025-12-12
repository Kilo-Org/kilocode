---
"@kilocode/cli": patch
---

Add image paste support to CLI

- Allow Ctrl+V in the CLI to paste clipboard images, attach them as [Image #N], and send them with messages (macOS only, with status feedback and cleanup)
- Add image mention parsing (@path and [Image #N]) so pasted or referenced images are included when sending messages
- Split media code into a dedicated module with platform-specific clipboard handlers and image utilities
