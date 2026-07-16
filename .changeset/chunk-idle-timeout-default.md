---
"@kilocode/cli": patch
---

Prevent agent and subagent sessions from stalling indefinitely with a 60-second model-stream idle watchdog that pauses while local tools run. Set `chunkTimeout: false` to disable it.
