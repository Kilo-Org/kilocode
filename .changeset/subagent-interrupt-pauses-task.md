---
"@kilocode/cli": minor
---

Interrupting a subagent now pauses its task instead of ending it: the parent keeps waiting, the task card shows "Interrupted — waiting for you", and sending a prompt in the subagent view resumes the task. Esc in the TUI prompt now interrupts only the current turn and leaves background subagents running, matching VS Code.
