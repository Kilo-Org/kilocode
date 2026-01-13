---
"@kilocode/cli": patch
---

Add session_created event emission for Agent Manager integration

Emit session_created event when a task is first started in JSON mode, allowing Agent Manager to track CLI sessions.
