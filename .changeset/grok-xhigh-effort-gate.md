---
"@kilocode/cli": patch
---

Stop offering OpenAI-only `none`/`xhigh` reasoning-effort variants to non-gpt-5 models routed through the OpenAI provider npm, which some OpenAI-compatible endpoints reject with a 400. Only gpt-5-family models now receive the rollout-gated tiers.
