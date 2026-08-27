---
"@kilocode/kilo-jetbrains": patch
---

Show why a turn failed instead of letting the session stop with no visible reason. The reason is written once, on the turn that failed, and Retry sits below it whenever that turn can be continued. Failures the conversation has already moved past no longer leave cards behind mid-transcript, and failed sessions are flagged in history, worktree rows, and their editor tab the same way an error or a pending question is.
