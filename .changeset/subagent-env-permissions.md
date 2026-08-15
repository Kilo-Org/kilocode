---
"@kilocode/cli": patch
"kilo-code": patch
---

Include the spawned subagent's own permission rules in the child session permission ruleset. This lets user-configured subagents explicitly allow reading `.env` files, while still inheriting parent denials and keeping `.env` hardening for broad `read: "*": "allow"`.
