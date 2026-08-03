---
"@kilocode/kilo-indexing": patch
---

Fix code index hanging at "Initializing file watcher…": replace the chokidar watcher with @parcel/watcher so subscribing no longer blocks the bundled runtime, prune ignored and per-repo gitignored directories from the native watch so large repositories don't exhaust OS file-watch limits, and fall back to a full scan (incremental updates disabled) when the native watcher can't start instead of failing indexing.
