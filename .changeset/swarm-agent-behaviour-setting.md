---
"@kilocode/cli": patch
"kilo-code": patch
---

Move the Kilo Swarm setting out of Experimental to Agent Behaviour. The setting stays enabled by default and is now controlled by the top-level `shared_agent_board` key. The `experimental.shared_agent_board` key is no longer read.
