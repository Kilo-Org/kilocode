---
"@kilocode/cli": patch
---

Fix requests failing with "prompt is too long" when a large number of custom instruction or rule files pushed the system prompt past the model's token limit. Instructions are now kept up to a size budget, and files that don't fit are listed in a summary instead of causing the request to fail.
