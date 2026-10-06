---
"@kilocode/kilo-indexing": minor
---

Keep codebase indexing intact when several sessions share a workspace. Only one session now writes a workspace's index, and a session that finds a partially built index no longer discards it and starts over.