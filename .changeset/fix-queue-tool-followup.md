---
"@kilocode/cli": patch
---

Fix queued prompts appearing to drop earlier messages when a running turn is mid-tool. If you queued a new prompt while a task was still running a tool call, the earlier prompt's assistant reply was cut short before the post-tool follow-up ran, so the queued prompt got answered but the original request appeared unanswered. Queueing now waits for the current step to actually settle before yielding to the next prompt.
