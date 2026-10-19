---
"@kilocode/cli": patch
---

Restore `edit` and `write` for subagents delegated by an agent that allows edits on specific paths. The subagent's own edit allowlist now governs instead of inheriting a blanket edit deny.
