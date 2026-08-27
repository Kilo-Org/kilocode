---
"@kilocode/kilo-jetbrains": patch
---

Show why a turn failed instead of letting the session stop with no visible reason. The provider's explanation now appears once for the failed turn when it is not already shown by the Retry card, and the session is flagged in history, worktree rows, and its editor tab the same way an error or a pending question is.
