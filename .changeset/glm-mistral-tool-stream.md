---
"@kilocode/cli": patch
"kilo-code": patch
---

Fix tool calls for GLM models served on the Mistral API (e.g. `zai-glm-5-3`, `glm-5-2`). GLM streams tool-call arguments across multiple chunks where only the first carries the tool call id, which the bundled Mistral provider rejected and dropped every continuation fragment — truncating arguments into `JSON Parse error: Unterminated string` / `invalid arguments` failures. The provider now correlates fragments by index and emits one complete tool call.
