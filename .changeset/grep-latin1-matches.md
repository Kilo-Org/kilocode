---
"@kilocode/cli": patch
"kilo-code": patch
---

Fix grep failing with "Invalid ripgrep match output" when matched lines aren't valid UTF-8, such as in ISO-8859-1 / Windows-1252 encoded files
