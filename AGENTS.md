# AGENTS.md

Devil is an open source AI coding agent platform. This repository is optimized for agent work: keep the entrypoint short, put durable knowledge in versioned docs, and enforce the important rules mechanically.

- Use parallel tools whenever independent reads or checks can run at the same time.
- Default branch: `main`.
- You may be in a git worktree. Make changes only in the current working directory.
- Prefer automation and execute requested actions unless blocked by missing information, safety, or irreversible effects.
- Read [docs/engineering/index.md](docs/engineering/index.md) before broad changes.
- For package-specific rules, read the nearest nested `AGENTS.md`.

## First Stops

| Need | Source |
| --- | --- |
| Architecture and package map | [docs/engineering/architecture.md](docs/engineering/architecture.md) |
| Build, test, and validation commands | [docs/engineering/reliability.md](docs/engineering/reliability.md) |
| Coding style and review taste | [docs/engineering/standards.md](docs/engineering/standards.md) |
| Fork hygiene and `devilcode_change` markers | [docs/engineering/fork-hygiene.md](docs/engineering/fork-hygiene.md) |
| Plans and historical execution context | [docs/engineering/plans.md](docs/engineering/plans.md) |
| Quality score and known risks | [docs/engineering/quality.md](docs/engineering/quality.md) |
| Security expectations | [docs/engineering/security.md](docs/engineering/security.md) |
| Cleanup backlog | [docs/engineering/technical-debt.md](docs/engineering/technical-debt.md) |

## Common Commands

- Dev CLI: `bun run dev`
- Dev CLI with args: `bun dev -- help`
- VS Code extension: `bun run extension`
- Typecheck: `bun turbo typecheck`
- Root tests: `bun test` from `packages/opencode/` only
- Single CLI test: `bun test test/tool/tool.test.ts` from `packages/opencode/`
- Standards warnings: `bun run standards:check`
- Standards enforcement: `bun run standards:enforce`
- SDK regen after server endpoint changes: `./script/generate.ts` from root
- Source link refresh after URL changes in checked packages: `bun run script/extract-source-links.ts`

## Products

All products are clients of the CLI in `packages/opencode/`, which owns the agent runtime, HTTP server, and session management.

| Product | Package | Notes |
| --- | --- | --- |
| Devil CLI | `packages/opencode/` | Core engine: TUI, `devil run`, `devil serve`, `devil web`. Forked from upstream OpenCode. |
| Devil VS Code Extension | `packages/devil-vscode/` | Bundles the CLI and includes Agent Manager. Some compatibility IDs still use `kilo-code.*`. |
| OpenCode Desktop | `packages/desktop/` | Tauri native app, synced from upstream and not actively maintained. |
| OpenCode Web | `packages/app/` | Shared SolidJS frontend for desktop and `devil web`, not actively maintained. |

## Non-Negotiables

- Prefer new Devil-specific code in `packages/opencode/src/devilcode/`, `packages/opencode/test/devilcode/`, or `packages/devil-*`.
- Shared upstream OpenCode changes in `packages/opencode/` need `devilcode_change` markers unless the path contains `devilcode` or `kilocode`.
- Do not edit generated SDK files by hand.
- Do not use empty `catch` blocks.
- Prefer `const`, early returns, and short names when clear.
- Avoid `any`; rely on inference unless exported types or clarity need annotations.
- Use Bun APIs where they fit.
- On Windows, subprocesses must not flash visible consoles. In `packages/opencode/`, use `Process.spawn`; in `packages/devil-vscode/`, use the local process wrappers.
- Always run relevant tests after code changes and report any pre-existing failures.

## Naming

Devil is the canonical public identity for this repo. Kilo names remain only where they are compatibility surfaces, such as extension IDs, command prefixes, package names, persisted settings, or legacy migration paths. New docs, workflows, and checks should use Devil naming unless an exception is documented.
