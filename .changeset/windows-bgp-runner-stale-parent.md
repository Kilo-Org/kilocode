---
"@kilocode/cli": patch
---

Reject stale parent-PID relationships when tracking persistent background processes on Windows. Stop only the leader and descendants accepted by a fresh creation-time-checked walk, without asking taskkill to traverse parent PIDs.
