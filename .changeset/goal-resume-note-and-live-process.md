---
"kilo-code": patch
---

Prevent a session goal from pausing itself with `No successful action or explicit completion report` right after a background process exits, so it keeps waiting on its remaining work and continues. The exit note is also delivered to the goal once instead of on every following continuation turn.
