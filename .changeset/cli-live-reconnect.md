---
"@kilocode/cli": patch
---

Remote CLI sessions no longer appear frozen on mobile when the connection to the session relay stalls; they now recover on their own instead of staying read-only until the CLI is restarted. Token acquisition and connection attempts are bounded by deadlines with a single fenced retry owner, and heartbeat session gathers are bounded so one stuck gather can no longer silently kill every future heartbeat.
