---
"@kilocode/cli": patch
---

Expose a custom or plugin command named `goal` as `/goal:command` instead of dropping it. `/goal` still starts a session goal, and the configuration warning now names the alias so the command stays reachable.
