---
"@kilocode/cli": patch
"kilo-code": patch
---

Start the CLI on Windows when a drive mounted on `B:` cannot be read, instead of exiting with `EPERM`, `EUNKNOWN` or `EISDIR` before the server starts
