---
name: monorepo
description: Navigate this Turborepo/Bun monorepo and the user's many GitHub repos — locate code, pick the right package, find the right repo.
---

# Monorepo & multi-repo navigation

## Layout
- Root: Kilo/OpenCode fork (monorepo). CLI = `packages/opencode/`.
- Other packages: `kilo-vscode`, `kilo-ui`, `app`, `desktop`, `sdk/js`, `util`, `plugin`, `gateway`, `telemetry`, `i18n`.
- Agent config/skills/commands: `.kilo/` at repo root. Kilo-specific extension assets: `.kilocode/`.

## Finding code
- Prefer `grep` (ripgrep) and `glob` over shell `find`. Use `codesearch` for API/pattern context.
- For architecture questions, delegate to `repo-architecture-explainer` or `explore`.
- `Instance.provide({ directory, fn })` binds project context for CLI code.

## The user's many repos
- Repos: github.com/vortsghost2025 (many). Use `gh repo list vortsghost2025` to enumerate; see the `github` skill for ops.
- When a task targets a specific repo, clone/branch it locally or operate via `gh` API.

## Conventions
- Per-package `package.json` scripts (e.g., `bun run dev`, `bun run typecheck`). Turborepo `turbo` for cross-package.
