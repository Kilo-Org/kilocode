---
"@kilocode/cli": minor
"kilo-code": minor
---

Add a reload action that reboots the per-directory instance, picking up config, skills, agents, commands, and MCP prompts changed on disk. Sessions and history are preserved. Surfaces: `/reload` in the CLI palette and editor chat, a reload button in the task header and settings panel, the `Kilo Code: Reload Config and Skills` command, and a `POST /instance/reload` HTTP endpoint. The endpoint returns 409 while a session is actively running.
