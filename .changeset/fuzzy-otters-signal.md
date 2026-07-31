---
"@kilocode/cli": patch
---

Report Bash commands terminated by a signal with the conventional 128 + signum exit code (e.g. 139 for SIGSEGV) instead of hanging until the command timeout.
