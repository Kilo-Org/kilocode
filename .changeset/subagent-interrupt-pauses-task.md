---
"@kilocode/cli": minor
---

Interrupting a subagent now pauses its task instead of ending it: the parent keeps waiting, the task card shows "Interrupted — waiting for you", and Esc twice in the paused subagent view returns control to the parent. Esc in the TUI prompt now interrupts only the current turn and leaves background subagents running, matching VS Code.
