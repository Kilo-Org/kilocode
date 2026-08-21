---
"@kilocode/kilo-jetbrains": patch
---

Keep the slash-command completion popup open while typing quickly and reopen it if it closes mid-token, so fast typing filters commands instead of dismissing the list. Refresh the popup when server commands finish loading, and return focus to the prompt after picking a model, agent, or reasoning option from a slash command.
