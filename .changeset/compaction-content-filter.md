---
"@kilocode/cli": patch
"kilo-code": patch
---

Keep the full conversation when a compaction summary is blocked by the provider's content filter or refused, instead of replacing history with a partial summary. Failed compactions now explain what happened, no longer re-run before your next message, and suggest choosing a separate compaction model, with a "Choose compaction model" button in VS Code.
