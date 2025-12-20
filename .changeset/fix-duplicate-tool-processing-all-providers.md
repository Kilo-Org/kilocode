---
"kilo-code": patch
---

Fix duplicate tool processing in 7 additional providers (inception, lm-studio, deepinfra, xai, lite-llm, qwen-code, chutes)

Following PR #4531 which fixed duplicate tool processing in OpenAI-compatible providers, this change applies the same fix to 7 additional providers that had the same issue. The `ToolCallAccumulator` was processing tool calls in the streaming loop, but the code was also manually emitting `tool_call_partial` chunks, causing duplicates. This fix removes the `ToolCallAccumulator` usage and relies solely on emitting raw `tool_call_partial` chunks, which are then properly handled by `NativeToolCallParser`.

Affected providers:
- inception
- lm-studio  
- deepinfra
- xai
- lite-llm
- qwen-code
- chutes
