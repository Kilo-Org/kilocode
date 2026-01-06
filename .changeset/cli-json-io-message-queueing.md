---
"@kilocode/cli": patch
---

Queue `--json-io` stdin messages (and interactive TUI user messages) until the extension is ready and the agent can accept them, with backpressure to avoid sending multiple messages before the agent reacts.
