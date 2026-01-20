---
"@kilocode/cli": patch
---

Fix CLI context drops caused by stale partial updates overwriting completed messages

When delayed IPC messages with `partial=true` arrived after a message had already been completed (`partial=false`), the stale update would overwrite the completed message, causing context loss. This fix adds a check to prevent partial updates from reverting completed messages back to partial state.
