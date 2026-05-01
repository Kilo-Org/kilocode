---
"@kilocode/cli": patch
"kilo-code": patch
---

Scope the custom commit message prompt to the current project. Setting it in the VS Code settings now writes to the workspace's `kilo.json` so different repositories can have different conventions, instead of silently applying globally. Also fixes the project-level config update endpoint, which previously wrote to a file that wasn't loaded.
