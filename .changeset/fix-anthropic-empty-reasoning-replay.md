---
"kilo-code": patch
---

Stop replaying Anthropic thinking blocks whose text was lost. A reasoning block that retained its signature but lost its text caused a 400 ("`thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified"), because the signature cannot validate against empty content. Such blocks are now omitted, and they no longer keep the empty-text separator workaround alive.
