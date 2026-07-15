---
"@kilocode/cli": minor
---

Remote sessions: slash commands, runtime catalog, and sessionless create-and-run. Slash commands (`list_commands`, `send_command`, built-in `compact`) are discoverable and executable against any remote runtime. Runtime presence is first-class: the CLI advertises and tracks active runtimes so the mobile client can list them and pick a target. Runtime catalog surfaces available models, agents, and variants for that runtime. `create-and-run` creates a root session, persists the first prompt, and forks the agent loop without waiting for completion; a prompt-start failure is returned as an idempotent partial result so the client can recover without re-creating the session.
