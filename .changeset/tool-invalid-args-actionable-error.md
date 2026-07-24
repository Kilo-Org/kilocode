---
"@kilocode/cli": patch
---

Tool invalid-argument errors are now actionable to the model: the raw `SchemaError(...)` fallback at the tool boundary is replaced with one readable `<json-path>: <reason>` line per failing field, and decoding enumerates every offending field instead of stopping at the first.
