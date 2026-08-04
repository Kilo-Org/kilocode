---
"kilo-code": patch
---

Agent Manager sessions started from another session can now reply to the session that created them. The spawning session is registered as managed when it starts sessions through the `agent_manager` tool, closing the one-way parent→child orchestration gap where a spawned session could not report back to its creator.
