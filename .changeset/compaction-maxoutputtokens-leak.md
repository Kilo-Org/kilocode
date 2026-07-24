---
"@kilocode/cli": patch
---

Fix compaction failure against strict OpenAI-compatible providers during context compaction. The compaction path no longer leaks `maxOutputTokens` into provider options, which was rejected by strict upstreams with "Unsupported parameter(s)".
