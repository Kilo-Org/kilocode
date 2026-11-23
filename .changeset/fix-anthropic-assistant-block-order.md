---
"kilo-code": patch
---

Fix intermittent Anthropic 400 "This model does not support assistant message prefill" on Claude 4.6 and Opus 5. An assistant turn could be sent as `[tool_use, text]` when the text part received a part ID minted after the tool part, even though the text streamed first. Assistant content is now reordered so text precedes the first tool call before the request is sent.
