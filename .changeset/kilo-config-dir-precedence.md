---
"@kilocode/cli": patch
---

Make `kilo.jsonc` / `kilo.json` take precedence over `opencode.jsonc` / `opencode.json` in the same `.kilo` or `.kilocode` config directory, and log a warning when both kinds of files are present.
