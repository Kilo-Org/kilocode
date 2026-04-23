---
"kilo-code": patch
---

Fix TUI freeze on huge-file diffs. Session-summary and file-view patches now use git directly instead of a JavaScript Myers implementation, so files of any size render a full diff without blocking the session.
