---
"@kilocode/cli": patch
---

Auto-approve rule suggestions for bash commands now keep workspace and cwd flags intact, so commands like `pnpm --filter web typecheck` are suggested as `pnpm --filter web typecheck *` instead of the meaningless `pnpm --filter *`. Covers `pnpm --filter` / `-F`, `npm --workspace` / `-w`, `yarn --cwd`, `git -C`, and `cargo --package` / `-p` / `--manifest-path`.
