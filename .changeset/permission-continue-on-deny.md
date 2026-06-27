---
"kilo-code": patch
---

Fix agent halting when a tool permission is denied — the agent now continues the loop on permission rejection by default instead of stopping. Set `experimental.stop_on_deny: true` to restore the previous halt-on-deny behavior.
