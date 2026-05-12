---
"kilo-code": patch
---

Fix the codebase indexing settings to show a model dropdown for the Kilo provider instead of a free-text "Embedding model" input. The Kilo embedding catalog is server-managed, so users should pick from the list rather than typing model ids by hand. While the catalog is loading the dropdown shows "Loading models…" and stays disabled instead of falling back to a placeholder text field.
