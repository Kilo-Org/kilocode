---
"kilo-code": patch
---

Fix the task cost shown at the top of the chat double-counting subagent costs. Sessions that spawned subagents were overreporting their totals because the backend already rolls descendant costs up into the parent session, and the webview was then summing them again.
