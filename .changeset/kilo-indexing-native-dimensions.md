---
"@kilocode/kilo-indexing": patch
---

Stop sending dimensions overrides through the Kilo embedding provider. Kilo-hosted models use their native catalog dimensions for vector store setup, and the gateway should not receive provider-specific dimension overrides that some upstream embedding APIs reject.
