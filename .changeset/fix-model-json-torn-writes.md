---
"@kilocode/cli": patch
---

Prevent `model.json` from being corrupted when per-agent model selections, recent models, or favorites are changed rapidly. Concurrent writes are now serialized so they cannot tear the file into invalid JSON on Windows or under heavy I/O contention.
