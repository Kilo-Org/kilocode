---
"@kilocode/cli": minor
---

feat(cli): add `kilocode update` command for CLI self-update

- Detects installation method (npm, pnpm, yarn, bun, npx, docker, local)
- Executes appropriate update command based on detected method
- Supports `--check` flag to only check for updates without installing
- Updates auto-update notification to use `kilocode update`
