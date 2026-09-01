---
"@kilocode/cli": patch
---

Surface the actual tool name when the model calls an unavailable tool, instead of a confusing "unavailable tool 'invalid'" error. Malformed tool calls that cannot be repaired now report the real tool name and available tools, so the model can self-correct.
