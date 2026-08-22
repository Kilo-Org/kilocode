---
"@kilocode/cli": patch
---

Stop sending prompt_cache_breakpoint to custom OpenAI-compatible providers, which reject the parameter with HTTP 400.
