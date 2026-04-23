---
"kilo-code": patch
"@opencode-ai/ui": patch
"@kilocode/kilo-ui": patch
---

Significantly speed up LLM token streaming in long sessions. The chat view now stays responsive while the model streams a reply, even in sessions with hundreds of messages. Previously, each SSE batch produced ~1.3 seconds of visible freeze (roughly 80 dropped frames); streaming ticks are now inside a single animation frame.
