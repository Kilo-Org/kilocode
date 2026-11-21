---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Legacy custom modes now migrate to the same permission keys the CLI reads: only a command group grants shell commands, a browser group grants the Integrated Browser tool of the VS Code client, an MCP group grants the tools of each migrated server, and a file restriction becomes a wildcard glob that keeps the files it allowed. A file restriction made only of digits is reported and asks instead of denying the allowed files, the denied skill permission is recorded in the migration notes rather than as a warning because no legacy group grants skills, and an MCP group that grants nothing is reported when a global MCP store declared a server. A mode that lists the same group more than once keeps the narrower rule and reports the repeat in the migration warnings. With auto-approval on and no command lists, the migration grants shell commands and leaves other tools at their defaults.
