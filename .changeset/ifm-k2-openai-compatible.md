---
"@kilocode/cli": minor
---

Support MBZUAI-IFM K2 models (K2-Think, K2-Horizon) on OpenAI-compatible endpoints: reasoning variants map to `chat_template_kwargs.reasoning_effort` and reasoning traces round-trip through `reasoning_content`, so the provider only needs a model name, API key, and base URL. Strict OpenAI-compatible APIs now accept Kilo request bodies: all-text multi-part user messages are flattened to text (arrays carrying non-text parts such as images are preserved) and assistant tool-call turns with no visible text send `content: ""` instead of `null`.
