# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Package Context

VSCode extension for Kilo Code. Part of a Bun/Turbo monorepo but this package uses **pnpm** (not Bun).

## Commands

```bash
pnpm compile          # Type-check + lint + build
pnpm watch            # Watch mode (esbuild + tsc)
pnpm test             # Run tests (requires pretest compilation)
pnpm lint             # ESLint on src/
pnpm run format       # Run formatter (do this before committing to avoid styling-only changes in commits)
```

Single test: `pnpm test -- --grep "test name"`

## Architecture (Non-Obvious)

- Two separate esbuild builds in [`esbuild.js`](esbuild.js): extension (Node/CJS) and webview (browser/IIFE)
- Webview uses **Solid.js** (not React) - JSX compiles via `esbuild-plugin-solid`
- Extension code in `src/`, webview code in `webview-ui/src/` with separate tsconfig
- Tests compile to `out/` via `compile-tests`, not `dist/`
- CSP requires nonce for scripts - see [`getNonce()`](src/KiloProvider.ts:62)
- Extension and webview have no shared state - communicate via `vscode.Webview.postMessage()`
- For editor panels, use [`AgentManagerProvider`](src/AgentManagerProvider.ts) pattern with `retainContextWhenHidden: true`

## Debugging

- Extension logs: "Extension Host" output channel (not Debug Console)
- Webview logs: Command Palette → "Developer: Open Webview Developer Tools"
- All debug output must be prepended with `[Kilo New]` for easy filtering

## Naming Conventions

- All VSCode commands must use `kilo-code.new.` prefix (not `kilo-code.`)
- All view IDs must use `kilo-code.new.` prefix (e.g., `kilo-code.new.sidebarView`)

## Style

Follow monorepo root AGENTS.md style guide:

- Prefer `const` over `let`, early returns over `else`
- Single-word variable names when possible
- Avoid `try`/`catch`, avoid `any` type
- ESLint enforces: curly braces, strict equality, semicolons, camelCase/PascalCase imports

## Committing

- Before committing, always run `pnpm run format` so commits don't accidentally include formatting/styling-only diffs.
