---
"kilo-code": patch
---

Fix DeepSeek reasoning_content error in thinking mode for multi-turn tool calls. Applies to all provider paths including OpenRouter and custom OpenAI-compatible. Ensures empty reasoning_content is always preserved for historical messages and dynamic SDK key selection for OpenRouter models.
