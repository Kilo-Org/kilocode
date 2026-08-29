---
"@kilocode/cli": patch
---

Fix requests that could end with an assistant message, which Anthropic (Claude 4.6+ and Opus 5) rejects with an "assistant message prefill" 400 error that loses the turn. The outbound messages array is now normalized so it always ends with a user or tool message: trailing scaffold-only assistant turns are dropped, and a content-bearing assistant tail is followed by a synthetic continuation prompt.
