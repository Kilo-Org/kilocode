# Plan 03-01 Summary — devil-keybind Package Foundation

**Status**: Complete
**Wave**: 1
**Agent**: engineering-backend-architect
**Date**: 2026-04-19

## Files Created

- `packages/devil-keybind/package.json` — New workspace package manifest for `@devilcode/keybind`
- `packages/devil-keybind/tsconfig.json` — Extends `@tsconfig/bun`, includes `src/**/*.ts`
- `packages/devil-keybind/bunfig.toml` — Test root set to `./test` (overrides repo-root blocker)
- `packages/devil-keybind/src/schemas.ts` — Zod schemas (`CommandScope`, `Keybind`, `CommandData`) + TS-only `Command` interface + `CommandRegistry`/`KeybindRegistry` interfaces with `subscribe()`
- `packages/devil-keybind/src/parser.ts` — Internal `parseBinding()` + `matchParsedBinding()` replicating `util/keybind.ts` behavior; not exported from barrel
- `packages/devil-keybind/src/registry.ts` — `createCommandRegistry()` + `createKeybindRegistry()` factories
- `packages/devil-keybind/src/matcher.ts` — `searchCommands()` wrapping fuzzysort with score threshold -10000
- `packages/devil-keybind/src/leader.ts` — `createLeaderChain()` state machine with 2s timeout, flat chains only
- `packages/devil-keybind/src/index.ts` — Barrel export (excludes internal `parseBinding`)
- `packages/devil-keybind/test/registry.test.ts` — 14 tests covering register/unregister, scoping, hidden, subscribe, Zod validation, onSelect/enabled
- `packages/devil-keybind/test/matcher.test.ts` — 8 tests covering empty query, title/alias/hideKeywords matching, hidden exclusion, threshold filtering
- `packages/devil-keybind/test/leader.test.ts` — 8 tests covering activate, press, timeout (fake timers), cancel, flat chain invariant
- `packages/devil-keybind/test/parser-corpus.test.ts` — 16 tests covering all binding format cases via matchEvent (indirect parser test)

## Verification

| Command | Result |
|---------|--------|
| `bun install` | PASS |
| `bun turbo typecheck` (13/13) | PASS |
| `cd packages/devil-keybind && bun test` (46 tests, 79 expects) | PASS |
| `cd packages/devil-vscode && bun run format:check` | PASS |

**Verification Commands Run**: 4
**Verification Passed**: 4
**Verification Failed**: 0

## Key Decisions

1. **tsconfig `include` excludes test files**: Matched opencode convention — test files are not type-checked by `bun turbo typecheck`. Resolves `bun:test` module-not-found errors since `bun-types` is in Bun's cache, not on standard tsgo resolution paths.
2. **`lib: ["ESNext", "DOM"]`**: Added DOM lib to provide `setTimeout`/`clearTimeout` type declarations; matches opencode tsconfig. Leader state machine uses these globals (also native in Bun).
3. **`noUncheckedIndexedAccess: false`**: Disabled to match opencode convention; the inherited `@tsconfig/bun` default enables it, causing spurious "possibly undefined" on array index access.
4. **`parseBinding` kept internal**: Not exported from barrel per spec, enabling Phase 5 to swap implementation for shared opencode parser without breaking public surface.
5. **Parser normalization**: Replicated exact `util/keybind.ts` behavior — `esc` → `escape` at parse time, key names normalized via `normaliseKeyName()`.

## Issues

None.

## Requirements Covered

- Hybrid interaction model (partial — keybind foundation only)
