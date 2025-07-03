---
"kilo-code": patch
---

Fix auto-generate commit message fails when git diff too large

Now we automatically exclude lockfiles when generating commit message diffs to avoid overflowing the context window.
