---
"@kilocode/cli": minor
"kilo-code": minor
---

Expose each agent's own session ID through the `KILO_SESSION_ID` environment variable in every shell command, and make the VS Code extension's server discoverable by writing a `vscode-server-<pid>.json` state file (same schema as `daemon.json`) while it runs. Together these let agents running inside the VS Code extension identify themselves and be reached by external tooling on the same server the UI uses, enabling inter-agent communication without a separate daemon.
