---
"@kilocode/cli": patch
---

Fix sessions getting stuck after a failed response by no longer replaying empty text parts to providers such as Anthropic.
