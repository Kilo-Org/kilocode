---
"@kilocode/cli": patch
---

The Windows background runner rejects stale parent-PID relationships and stops only the leader and descendants accepted by a fresh creation-time-checked walk, without taskkill tree traversal. Failed queries never authorize cached descendant kills. After the leader exits, a bounded confirmation window lets slow process queries find its surviving children. Unconfirmed completion or stop ends with a warning rather than keeping the runner alive forever.
