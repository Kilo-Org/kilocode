---
"@kilocode/cli": patch
"kilo-code": patch
---

Show a clear "No changes found to generate a commit message for" error instead of a generic "Unexpected server error" when there is nothing to commit. The endpoint now returns a typed 422, and the extension surfaces the real message directly.
