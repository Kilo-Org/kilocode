---
"kilo-code": patch
---

Speed up LLM token streaming in long sessions. The chat view now stays responsive while the model streams a reply, even in sessions with hundreds of messages. Previously, each incoming token triggered reactive work across every mounted message in the session, so long sessions progressively froze during streaming even though rendering itself was fast.
