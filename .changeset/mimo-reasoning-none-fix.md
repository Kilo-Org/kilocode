---
"kilo-code": patch
---

Fix MiMo and other OpenAI-compatible models throwing error when thinking mode is set to "Instant" — remaps `reasoning: { effort: "none" }` to `reasoning: { enabled: false }` for `@ai-sdk/openai-compatible` providers that don't support the `"none"` reasoning effort tier.
