---
"@kilocode/cli": patch
---

Fix auto-compaction triggering far below the configured context threshold. The threshold now applies to the context window shown in the UI and is anchored to provider-reported token usage, so compaction fires at the configured percentage instead of as early as ~40% on models with separate input limits.
