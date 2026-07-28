---
"@kilocode/cli": minor
"kilo-code": minor
---

Route external tooling to the correct VS Code window when several are open. The extension's `kilo serve` now injects `KILO_SERVER_FILE` (the path to its own `vscode-server-<pid>.json` discovery file) into every agent shell command, so scripts such as `talk.js` always talk to the window that owns the calling session. The discovery file also records the window's workspace directory, and `talk.js` gains `--windows`/`--server <pid>` selection and refuses to guess when several windows are live.
