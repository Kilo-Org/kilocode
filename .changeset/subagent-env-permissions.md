---
"@kilocode/cli": patch
"kilo-code": patch
---

Honor explicit `read: "*.env": "allow"` (and `*.env.*`) when resolving env reads, even if a later broad `read: "*"` rule would otherwise be hardened back to ask. Do not copy a subagent's full agent ruleset into `session.permission`, which made nested subagents inherit the delegator's deny catch-all.
