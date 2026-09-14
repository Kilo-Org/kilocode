---
"@kilocode/cli": patch
---

Fix auto-compaction duplicating the cut conversation entry into both the summary input and the kept recent context, which could inflate the summary prompt and cause compaction to be skipped when the context window overflows.
