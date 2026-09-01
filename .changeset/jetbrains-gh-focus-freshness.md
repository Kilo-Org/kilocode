---
"@kilocode/kilo-jetbrains": patch
---

Show pull request and gh authorization changes right after you come back to the IDE. Returning from a long absence now reloads immediately instead of waiting out the poll, refreshes that arrive during a burst of window or tab switches are no longer dropped, and closing a dialog no longer triggers a needless lookup. A newly created worktree also gets its pull request badge without waiting for the cache to expire.
