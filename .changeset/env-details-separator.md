---
"@kilocode/cli": patch
---

Separate system-generated context blocks (the `<environment_details>` block, plan-to-code switch reminders, and plan-file reminders) from the user's prompt with blank lines so models don't mistake them for user content and copy them into file edits.
