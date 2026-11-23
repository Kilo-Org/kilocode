---
"@kilocode/cli": patch
"kilo-code": patch
---

Apply a configured file-write permission from an older configuration document to file writes when the document is converted to the newer format, so the permission a user authored takes effect. When such a document also sets the deprecated tool toggle for the same capability, the toggle keeps the effect it has today.
