---
"kilo-code": patch
"@kilocode/kilo-indexing": patch
---

Fix the codebase indexing settings to show a model dropdown for the Kilo provider instead of a free-text "Embedding model" input. The Kilo embedding catalog is server-managed, so users should pick from the list rather than typing model ids by hand. While the catalog is loading the dropdown shows "Loading models…" and stays disabled instead of falling back to a placeholder text field.

Show detailed embedding provider error responses during indexing initialization failures, so upstream gateway errors include the exact response body instead of only "Bad Request".
