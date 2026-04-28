---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix a session hang that could occur when multiple Kilo panels showed the same permission prompt, or when a subagent's permission was replied to from the wrong worktree. Replies are now routed to the exact CLI instance that holds the pending permission, and stale/unknown permissions surface a clear error so the UI doesn't leave buttons permanently disabled.
