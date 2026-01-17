---
"@kilocode/cli": patch
---

Fix missing visual feedback and input blocking during paste operations

- Display "Pasting image..." loader when pasting images via Cmd+V/Ctrl+V
- Display "Pasting text..." loader when pasting large text (10+ lines)
- Block keyboard input during paste operations to prevent concurrent writes
- Support multiple concurrent paste operations with counter-based tracking
