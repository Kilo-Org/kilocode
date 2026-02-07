---
"@kilocode/api": patch
---

Fix Responses API compatibility by adding type field to message objects

Some OpenAI-compatible endpoint providers (like Kimi, GLM-4.7) require the type field to be explicitly set in message objects when using the Responses API. This fix adds type: "message" to user and assistant messages in:

- openai-responses.ts
- openai-codex.ts
- openai-native.ts

This ensures compatibility with both lenient (OpenAI) and strict (Kimi, GLM) providers.
