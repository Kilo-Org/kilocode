---
"kilo-code": patch
---

Fixed 8 codebase indexing bugs: peak memory reduced 85-90%, total file count shown before scan starts, partial progress persisted per-batch for crash recovery, per-block mutex contention eliminated, clear error messages for unreachable LAN Ollama hosts, worker dispose timeout increased, ENAMETOOLONG crash from recursive symlinks fixed, and tree-sitter WASM heap exhaustion after 4K+ files resolved.

Optimized file discovery with fdir (symlink-safe), replaced chokidar with @parcel/watcher for native OS filesystem events, improved tree-sitter queue iteration and fallback chunking, switched event broadcasting to tail-drop drain, and reduced boot time 55% via LanceDB runtime skip, fire-and-forget file watcher, and watcher init timeout with graceful fallback.
