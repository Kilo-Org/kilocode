---
"@kilocode/cli": patch
"kilo-code": patch
---

Fix subagent permission errors that referenced phantom deny rules and blocked commands the subagent's own config explicitly allowed. A read-only or delegating agent's `readOnlyBash` allowlist is no longer projected onto a writable subagent as a bash ceiling, so a delegated subagent can run its own allowed commands (e.g. `git status`). Edit, notebook, and MCP denials are still inherited as hard ceilings.
