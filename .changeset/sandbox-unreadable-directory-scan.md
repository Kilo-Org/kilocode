---
"@kilocode/cli": patch
"kilo-code": patch
---

Keep Linux sandbox setup working when a writable directory contains an unreadable subdirectory (for example a folder with mode 600); unreadable subdirectories are now protected with a read-only mount instead of failing every sandboxed tool call with an access error.
