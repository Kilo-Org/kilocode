---
"@kilocode/cli": minor
"@kilocode/kilo-indexing": minor
"kilo-code": minor
---

Use embedded LanceDB as the default semantic search vector store so indexing works without a separate Qdrant server. Existing Qdrant users and Intel Mac users can select `qdrant` with `indexing.vectorStore`.
