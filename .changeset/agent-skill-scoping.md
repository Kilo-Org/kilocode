---
"kilo-code": minor
---

Add optional per-agent `skills` allow-list to scope which skills an agent can see and load. When `agent.<name>.skills` is set, only skills matching the glob patterns (with `!` negation support) are injected into that agent's system prompt and loadable via the skill tool; other agents are unaffected.
