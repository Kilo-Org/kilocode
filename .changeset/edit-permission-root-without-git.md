---
"@kilocode/cli": patch
"kilo-code": patch
---

Match edit permission rules against workspace-relative paths in folders that are not Git repositories, so rules like `.local/test/*.md` apply before `git init` too
