---
"@kilocode/cli": patch
---

Fix auto-compaction triggering far below the configured context threshold. The threshold now applies to the context window shown in the UI and is anchored to provider-reported token usage plus newly added content, instead of an inflated estimate of the whole payload on models with separate input limits. On models whose input limit is smaller than their context window, the reserved input safety buffer can still trigger compaction before a high configured percentage is reached.
