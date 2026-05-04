---
"@kilocode/cli": minor
---

Support the OpenAI Responses API for custom providers. Set `npm: "@ai-sdk/openai"` on a custom provider and `useResponsesApi: true` in its options (or on a per-model basis) to route requests through `/v1/responses` instead of `/v1/chat/completions`.
