---
"@kilocode/cli": minor
---

Press Esc twice in a subagent view to stop that subagent and anything it started while the parent session keeps working, the same as Stop on a VS Code task card. The parent is told the user stopped it, so it no longer starts a replacement subagent right away. Leaving the TUI from a subagent view now needs a second press of the exit key.
