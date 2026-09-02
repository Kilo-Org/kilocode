---
"kilo-code": patch
---

Clear a session's completed (✓) activity indicator when you switch to that session's tab. Opening a finished session now counts as acknowledging it, so the check no longer lingers after you review it. A session that completes while it is already the focused tab still shows its check, and unresolved states (needs input, error) are never cleared by focus.
