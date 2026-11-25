---
"@kilocode/cli": patch
---

Keep Mistral tool calls distinct when their ids share a prefix, so a resumed session no longer fails with "Duplicate tool call id".
