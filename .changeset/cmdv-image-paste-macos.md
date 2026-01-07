---
"kilo-code": patch
---

Support Cmd+V for pasting images on macOS in VSCode terminal

- Detect empty bracketed paste (when clipboard contains image instead of text)
- Trigger clipboard image check on empty paste or paste timeout
- Add Cmd+V (meta key) support alongside Ctrl+V for image paste
