---
"@kilocode/cli": patch
---

Fix bash permission rules being bypassed on PowerShell for commands containing a bare `--` such as `git checkout -- <file>`. Commands the shell parser cannot parse now get checked against their raw command text instead of executing without a permission check.
