---
"@kilocode/cli": minor
---

Let the agent start or resume a session goal itself with the `goal` tool. The agent's call arms the goal without cancelling the current turn, then the goal loop continues after that turn. The tool uses the `goal` permission, which is allowed by default and can be set to `ask` or `deny`.
