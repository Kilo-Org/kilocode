---
"@kilocode/cli": patch
---

Separate the injected `<environment_details>` block from the user's prompt with blank lines so models don't mistake it for user content and copy it into file edits.
