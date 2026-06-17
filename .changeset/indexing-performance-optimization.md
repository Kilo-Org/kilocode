---
"kilo-code": patch
---

Fixed 6 codebase indexing bugs: memory leak (3.5-5 GB → <500 MB), progress visibility (total count now shown before scan starts), resumable indexing (partial progress persisted per-batch), queue contention with >5k files (removed per-block mutex), clear error messages for unreachable LAN Ollama hosts, and worker dispose timeouts.

Also optimized file discovery with Bun native fs.glob (30x faster), tree-sitter queue iteration (O(n²) → O(n)), event broadcasting (infinite promise chain → tail-drop drain), and config loading (bypassed Effect schema validation for indexing boot).
