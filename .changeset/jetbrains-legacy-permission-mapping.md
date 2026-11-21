---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Legacy custom modes now migrate to the same permission keys the CLI reads: only a command group grants shell commands, a browser group grants the Integrated Browser tool of the VS Code client, an MCP group grants the tools of each migrated server, and a file restriction becomes a wildcard glob that keeps the files it allowed. A file restriction made only of digits is reported and asks instead of denying the allowed files, skills are denied with a migration message because no legacy group grants them, and an MCP group that grants nothing is reported when a global MCP store declared a server.
