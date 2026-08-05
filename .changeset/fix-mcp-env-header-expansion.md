---
"@kilocode/cli": patch
---

Fix project config MCP headers: reject untrusted `{env:…}`/`{file:…}` (no process.env or authEnv) per entry so one bad header no longer drops the entire MCP set.
