---
"@kilocode/cli": patch
---

Keep remote CLI sessions reconnecting after connection stalls. Token acquisition and connection attempts are now bounded by deadlines with a single fenced retry owner, and heartbeat session gathers are bounded so one stuck gather can no longer silently kill every future heartbeat. A stalled connection recovers on its own instead of appearing frozen on mobile until the CLI is restarted.
