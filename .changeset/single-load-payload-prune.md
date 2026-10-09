---
"@kilocode/cli": patch
---

Reduce the work done on every agent step in long sessions once the request passes the payload pruning limit. The session transcript is no longer reloaded and re-serialized after pruning, and pruning no longer reads the whole session history again. Plan mode also keeps its plan file instructions on those steps.
