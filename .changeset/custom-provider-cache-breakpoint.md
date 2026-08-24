---
"@kilocode/cli": patch
---

Stop sending prompt_cache_breakpoint to custom OpenAI-compatible providers, and to first-party provider IDs rerouted through custom endpoint overrides; both reject the parameter with HTTP 400.
