---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Legacy custom modes now migrate to the same permission keys the CLI reads: only a command group grants shell commands, a browser group grants the Integrated Browser tool of the VS Code client, an MCP group grants the tools of each migrated server, and a file restriction becomes a wildcard glob that keeps the files it allowed.
