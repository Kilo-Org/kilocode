---
"@kilocode/cli": patch
"kilo-code": patch
---

Match file permission rules such as `.local/*.md` against paths from the project directory in folders that are not git repositories, so they apply before `git init` as they do after
