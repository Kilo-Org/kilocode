---
"@kilocode/cli": patch
---

Fix requests that could end with an assistant message, which Anthropic (Claude 4.6+ and Opus 5) rejects with an "assistant message prefill" 400 error that loses the turn. The outbound messages array is now normalized before it reaches the provider so it always ends with a user or tool message: trailing scaffold-only assistant turns are dropped from the request, and a content-bearing assistant tail is followed by a synthetic continuation prompt that exists only in the outgoing request and is never saved to the session.
