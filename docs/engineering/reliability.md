# Reliability

Reliability means agents can validate their own work with local commands, CI, logs, and UI evidence.

## Required Commands

|Scenario|Command|
|---|---|
|Repo typecheck|`bun turbo typecheck`|
|Root test pipeline|`bun turbo test`|
|CLI tests|`bun test` from `packages/opencode/`|
|Single CLI test|`bun test test/tool/tool.test.ts` from `packages/opencode/`|
|Standards warnings|`bun run standards:check`|
|Standards enforcement|`bun run standards:enforce`|
|VS Code unused exports|`bun run knip` from `packages/devil-vscode/`|
|Source link refresh|`bun run script/extract-source-links.ts` from root|
|OpenCode marker check|`bun run script/check-opencode-annotations.ts` from root|

## Local Boot Paths

- CLI dev: `bun run dev`
- CLI with args: `bun dev -- help`
- VS Code extension: `bun run extension`
- Docs site: `bun --cwd packages/devil-docs dev`
- Web app UI: run backend from `packages/opencode` with `bun run --conditions=browser ./src/index.ts serve --port 4096`, then run `bun dev -- --port 4444` from `packages/app`.

## Validation Evidence

- Logic changes need tests or a clear explanation for why existing tests cover the path.
- UI changes need screenshots or videos when practical.
- Server endpoint changes require SDK regeneration.
- URL changes in checked packages require source-link extraction.
- Pre-existing failures should be named, investigated enough to identify the likely owner, and fixed when they are in scope.

## CI Philosophy

New standards checks start in warn mode. A check can become blocking only after the baseline is clean, remediation is clear, and false positives are allowlisted.
