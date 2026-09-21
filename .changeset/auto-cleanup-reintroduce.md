---
"kilo-code": minor
---

Reintroduce automatic session cleanup in Settings > Checkpoints. Keep it off by default and apply the configured retention period across all projects and Kilo clients on the machine. Protect running sessions and sessions with a recent fork, confirm manual cleanup, and show live session-level progress with a spinner and processed, deleted, and failed counts. Avoid scanning unrelated session history and preserve progress when status updates are delayed.
