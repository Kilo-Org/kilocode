---
"@kilocode/cli": patch
---

Project skills, agents, commands, and instruction files that contain `${env:...}` or `${file:...}` placeholders now load instead of failing with an environment reference error. The placeholders stay literal there, while project JSON config still rejects them.
