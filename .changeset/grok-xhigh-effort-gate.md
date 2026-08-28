---
"@kilocode/cli": patch
---

Stop offering OpenAI-only `none`/`xhigh` reasoning-effort variants for non-OpenAI models routed through the OpenAI provider npm (e.g. Grok on an OpenAI-compatible base URL), which the upstream provider rejects with a 400. Only gpt-5-family models now receive the rollout-gated tiers.
