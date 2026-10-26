---
"@kilocode/cli": patch
"kilo-code": patch
---

Fix auto-compaction starting well before the configured context threshold, and stop compaction from looping on models without a known context size or after you stop a compaction.
