---
"@kilocode/kilo-indexing": minor
---

Keep codebase indexing intact when several sessions share a workspace. Only one session now writes a workspace's index, and a session that finds a partially built index no longer discards it and starts over. A session that loses the writer race stands by and retries on a bounded backoff, so it takes over when the holder stops instead of waiting for a restart, and the lock is handed back whenever the file watcher stops.
