---
"@kilocode/kilo-indexing": patch
---

Fix the indexer silently skipping files when an embedding batch exceeds the embedding model's maximum input context (for example, small-context models such as Granite that reject batches over 512 tokens). Oversized batches are now split reactively in response to the provider's context-overflow error, and deterministic 4xx embedding responses are no longer retried, so large blocks on small-context embedding models are indexed instead of dropped.
