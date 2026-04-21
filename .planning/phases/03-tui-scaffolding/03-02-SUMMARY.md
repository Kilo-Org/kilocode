# Plan 03-02 Summary — devil-ui RenderTarget + Adapters + Hooks

**Status**: Complete
**Wave**: 2
**Agent**: engineering-frontend-developer
**Date**: 2026-04-19

## Files Created

- `packages/devil-ui/src/context/render-target.tsx` — `RenderTargetAdapter`, `RenderTargetProvider`, `useRenderTarget`, `RenderSurface`, `createFocusSignal`
- `packages/devil-ui/src/adapters/terminal.ts` — Async factory with dynamic `@opentui/core` import (no static OpenTUI dep)
- `packages/devil-ui/src/adapters/dom.ts` — DOM adapter with canvas-based text measurement
- `packages/devil-ui/src/adapters/index.ts` — Barrel (DOM-safe only; terminal excluded)
- `packages/devil-ui/src/adapters/README.md` — Documents deep-path import rule for terminal
- `packages/devil-ui/src/primitives/index.ts` — Empty barrel stub for Plan 03-03
- `packages/devil-ui/src/hooks/use-command-registry.tsx` — `CommandRegistryProvider` + `useCommandRegistry` with synchronous subscribe (no `onMount`)
- `packages/devil-ui/src/hooks/use-prompt-history.ts` — `usePromptHistory` + `createMemoryStore`
- `packages/devil-ui/src/hooks/__tests__/test-harness.ts` — `withRoot` utility for createRoot-based tests
- `packages/devil-ui/src/hooks/__tests__/use-command-registry.test.ts` — 7 tests
- `packages/devil-ui/src/hooks/__tests__/use-prompt-history.test.ts` — 7 tests
- `packages/devil-ui/src/vite-env.d.ts` — Type declarations for SVG/PNG/woff2/CSS assets (pre-existing typecheck fix)
- `packages/devil-ui/bunfig.toml` — Test root `./src`

## Files Modified

- `package.json` (root) — Added `@opentui/solid: 0.1.87` + `@opentui/core: 0.1.87` to catalog + overrides
- `packages/opencode/package.json` — Flipped `@opentui/*` to `catalog:`; added `@devilcode/keybind: workspace:*` + `@devilcode/kilo-ui: workspace:*`
- `packages/devil-gateway/package.json` — Flipped `@opentui/*` dev deps to `catalog:` (was 0.1.75, causing dual-version; root cause of singleton risk)
- `packages/devil-ui/package.json` — Added exports map entries, peer deps for `@opentui/*` (optional), `@devilcode/keybind` dep, `fuzzysort: catalog:`, `test` + `typecheck` scripts
- `packages/devil-ui/tsconfig.json` — Added `"types": ["@types/bun"]` for bun:test resolution
- `packages/devil-ui/src/context/index.ts` — Appended explicit named re-exports for RenderTarget symbols
- `packages/devil-ui/src/hooks/index.ts` — Appended explicit named re-exports for new hooks
- `packages/devil-ui/src/stories/session-turn.stories.tsx` — Removed non-existent `stepsExpanded` prop (pre-existing bug)

## Verification

| Command | Result |
|---------|--------|
| `bun install` | PASS |
| `bun pm ls @opentui/solid` — single version 0.1.87 | PASS |
| `bun pm ls @opentui/core` — single version 0.1.87 | PASS |
| `bun turbo typecheck` (14/14) | PASS |
| `cd packages/devil-keybind && bun test` (46 pass) | PASS |
| `cd packages/devil-ui && bun test src/hooks/__tests__` (14 pass) | PASS |
| `cd packages/devil-vscode && bun run knip` | PASS |
| `cd packages/devil-vscode && bun run format:check` | PASS |
| `bun run check-devilcode-change` | PASS |
| Symbol collision grep (`RenderSurface`/`RenderTargetProvider`/`useRenderTarget`) | PASS (0 matches) |

**Verification Commands Run**: 14  
**Verification Passed**: 14  
**Verification Failed**: 0

## Key Decisions

1. `use-command-registry` named `.tsx` (not `.ts`) because `CommandRegistryProvider` uses JSX syntax.
2. Root `overrides` for `@opentui/*` added because `devil-gateway` was pulling in `@opentui@0.1.75` as a dev dep — root cause of dual-version singleton risk. Updated gateway deps to `catalog:` + belt-and-suspenders overrides.
3. Added `vite-env.d.ts` to fix pre-existing SVG/font/CSS import type errors blocking the new `typecheck` script.
4. Fixed pre-existing story bug (`stepsExpanded` prop mismatch) required for clean typecheck.
5. Subscriptions wired synchronously in hook body (`not onMount`) per cycle-2 CAUTION-1 contract.
6. `check-kilocode-change` is named `check-devilcode-change` in this fork.

## Issues

None after pre-existing fixes.

## Requirements Covered

- Hybrid interaction model (partial — RenderTarget abstraction + hook foundation)
