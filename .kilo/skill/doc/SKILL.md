---
name: doc
description: Write PR descriptions, changelogs, and run source-link extraction for this fork.
---

# Documentation

## PR descriptions
- 2-3 lines: WHAT changed and WHY. Skip file-by-file inventories and test summaries.
- Conventional commit scope matches package (cli, vscode, sdk, ui, ...); omit scope if multi-package.

## Source links
- After adding/modifying URLs in `packages/*/src`, run `bun run script/extract-source-links.ts` from repo root and commit `packages/kilo-docs/source-links.md` (CI fails if stale).

## kilocode_change markers
- Single line: `// kilocode_change`
- Block: `// kilocode_change start` ... `// kilocode_change end`
- Not needed in `src/kilocode/` or `test/kilocode/`.

## SDK regen
- After changing `packages/opencode/src/server/` endpoints, run `./script/generate.ts` (root) to regen `packages/sdk/js/`.
