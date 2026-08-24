---
"@kilocode/cli": patch
"kilo-code": patch
---

Honor explicit `read: "*.env": "allow"` (and `*.env.*`) when resolving env reads, even if a later broad `read: "*"` rule would otherwise be hardened back to ask. Stop nested subagents from inheriting parent-session deny rules: only the immediate child receives the parent session's deny and `external_directory` ceilings; deeper descendants are governed by their own agent ruleset and default subagent restrictions.
