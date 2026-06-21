---
"@kilocode/cli": minor
---

Add hashline-style hash-anchored line editing tool

Add a new `hash_edit` tool that enables precise, hash-anchored line edits. When `hashlineEdit.enabled` is set in config, the `read` tool annotates file output with short deterministic hashes (e.g. `#HL 2:f1c|const x = 1;`), and the new `hash_edit` tool lets the agent target lines by their hash reference — eliminating ambiguous string matching and fragile unified diffs.

Supports `replace`, `delete`, `insert_before`, and `insert_after` operations with structured error codes (`HASH_MISMATCH`, `FILE_REV_MISMATCH`, `INVALID_REF`) for reliable automated retry.
