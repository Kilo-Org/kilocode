---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Legacy custom modes now migrate to the same permission keys the CLI reads: a browser group grants browser use, an MCP group grants the tools of each migrated server, and a file restriction becomes a wildcard glob that keeps the files it allowed.
