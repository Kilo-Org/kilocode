---
"@kilocode/cli": patch
---

Fix a stopped session hanging when a client continues it. A stop left the session paused, and a continuation prompt — which carries no parts so the original prompt text survives — did not clear that pause, so the turn was dropped without ever starting or reporting back.
