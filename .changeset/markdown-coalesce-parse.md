---
"@opencode-ai/ui": patch
"kilo-code": patch
---

Cap markdown re-parse rate at one per animation frame during LLM token streaming. Previously every token re-parsed the entire accumulated message and ran morphdom against it, producing thousands of ParseHTML events per second in long sessions. The streamed content now updates at most once per frame — visually identical, significantly less main-thread work.
