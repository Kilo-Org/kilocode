---
"@kilocode/cli": minor
---

Add an experimental `kilo design` command for voice-steered live design iteration. It runs one in-process Kilo session driven by a continuous voice loop: speak (or type, in fake-voice mode) and finalized turns dispatch to the agent while edits stream back into the browser. Press Escape to interrupt and keep listening. The command is hidden from release builds while it's in development.
