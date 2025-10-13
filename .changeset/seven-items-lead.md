---
"kilo-code": patch
---

The reasoning effort setting is no longer ignored for GLM 4.6 when using the Kilo Code or OpenRouter providers. Some inference providers on OpenRouter have trouble when reasoning is enabled, but this is now less of a problem, because more providers have come online. Most providers do not expose reasoning tokens for GLM 4.6, regardless of reasoning effort.
