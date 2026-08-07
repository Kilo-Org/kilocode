---
"@kilocode/cli": patch
---

Fetch the Perplexity Agent model list live from its OpenAI-compatible `/models` endpoint instead of relying on the stale models.dev snapshot, so newly added models become available as soon as `PERPLEXITY_API_KEY` is configured.
