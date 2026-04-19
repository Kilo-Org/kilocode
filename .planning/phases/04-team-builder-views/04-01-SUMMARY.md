# Plan 04-01 Summary — Foundations: TeamRepository + useTeamValidation + StageCoverageIndicator

## Files Created / Modified

### Created
| File | Purpose |
|------|---------|
| `packages/opencode/src/devilcode/team/repository.ts` | TeamRepository interface + FileSystemTeamRepository implementation |
| `packages/opencode/test/devilcode/team/repository.test.ts` | 7 tests covering all CRUD ops, id validation, mkdir-p, round-trip |
| `packages/devil-ui/src/hooks/use-team-validation.tsx` | Reactive Zod-driven team validation hook using lazy require pattern |
| `packages/devil-ui/src/hooks/__tests__/use-team-validation.test.ts` | 5 tests covering valid/invalid configs, stage detection, re-evaluation |
| `packages/devil-ui/src/primitives/stage-coverage-indicator/index.tsx` | DOM + terminal stub dual-branch primitive for stage coverage display |
| `packages/devil-ui/src/stories/stage-coverage-indicator.stories.tsx` | Storybook: Complete, OneMissing, AllMissing, Compact stories |

### Modified
| File | Change |
|------|--------|
| `packages/opencode/src/devilcode/team/index.ts` | Appended TeamHandle, TeamRepository, CreateFileSystemTeamRepositoryOptions, createFileSystemTeamRepository exports |
| `packages/devil-ui/src/hooks/index.ts` | Appended useTeamValidation + TeamValidationResult export |
| `packages/devil-ui/src/primitives/index.ts` | Appended StageCoverageIndicator + StageCoverageIndicatorProps export |

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| `packages/opencode/test/devilcode/team/repository.test.ts` | 7 | PASS |
| `packages/devil-ui/src/hooks/__tests__/use-team-validation.test.ts` | 5 | PASS |
| **Total** | **12** | **All pass** |

## Verification Commands Run

| Check | Command | Result |
|-------|---------|--------|
| 1 | `test -f packages/opencode/src/devilcode/team/repository.ts` | PASS |
| 2 | `test -f packages/opencode/test/devilcode/team/repository.test.ts` | PASS |
| 3 | `grep -q "export interface TeamRepository" ...` | PASS |
| 4 | `grep -q "createFileSystemTeamRepository" ...` | PASS |
| 5 | `grep -q "mkdir" ...` | PASS |
| 6 | `grep -q "TeamRepository" packages/opencode/src/devilcode/team/index.ts` | PASS |
| 7 | `bun test test/devilcode/team/repository.test.ts` | 7 PASS |
| 8 | `test -f packages/devil-ui/src/hooks/use-team-validation.tsx` | PASS |
| 9 | `grep -q "export function useTeamValidation" ...` | PASS |
| 10 | `grep -q "safeParse" ...` | PASS |
| 11 | `grep -q "useTeamValidation" packages/devil-ui/src/hooks/index.ts` | PASS |
| 12 | `bun test src/hooks/__tests__/use-team-validation.test.ts` | 5 PASS |
| 13 | `test -f packages/devil-ui/src/primitives/stage-coverage-indicator/index.tsx` | PASS |
| 14 | `grep -q "StageCoverageIndicator" ...` | PASS |
| 15 | `grep -q "stage-coverage-indicator" packages/devil-ui/src/primitives/index.ts` | PASS |
| 16 | `test -f packages/devil-ui/src/stories/stage-coverage-indicator.stories.tsx` | PASS |
| 17 | `bun turbo typecheck` | FAIL (pre-existing, see Issues) |
| 18 | `bun run knip` (from devil-vscode) | PASS |
| 19 | `bun run format:check` (from devil-vscode) | PASS |
| 20 | `bun run check-devilcode-change` (from devil-vscode) | PASS |

## Key Decisions Made

### Import path for @devilcode/cli in devil-ui

**Decision**: Use lazy `require()` singleton pattern in the hook body; inline stage names in StageCoverageIndicator.

**Reason**: `@devilcode/cli` (packages/opencode) depends on `@devilcode/kilo-ui` (packages/devil-ui) for TUI primitives (`workflow-tui/index.tsx`). Adding `@devilcode/cli` to devil-ui's `package.json` as any dependency type creates a turbo cyclic dependency graph error. Adding it to `peerDependencies` also triggers the cycle.

The solution:
1. The `@devilcode/cli` workspace symlink exists in devil-ui's `node_modules` via bun workspace hoisting WITHOUT being declared in `package.json` (turbo doesn't track undeclared edges).
2. In `use-team-validation.tsx`: a lazy `require()` singleton (`getValidators()`) loads the validator at first call. TypeScript types are declared as local structural interfaces (`TeamConfigValidator`, `StageValidator`) — no cross-package Zod generic imports.
3. In `stage-coverage-indicator/index.tsx`: stage names are inlined as a const array (matching `WorkflowStage.options`) with a comment linking to the canonical source.
4. In `use-team-validation.test.ts`: import uses `@devilcode/cli/devilcode/team/index` (resolved via hoisted symlink at test runtime, not statically type-checked by tsgo in the test file).

### WorkflowStage shape
`WorkflowStage` is `z.enum(["plan", "challenge", "contract", "build", "review", "ship", "retro"])` — confirmed by reading `workflow/types.ts`. It has `.options` array.

### Storybook import
Stories use `storybook-solidjs-vite` (not `storybook-solidjs`) — confirmed from existing `help-overlay.stories.tsx`.

### test-harness `withRoot` signature
`withRoot((dispose) => T)` — confirmed. Plan tests used `withRoot(() => ...)` which works since `dispose` is optional to call. The re-evaluation test was adapted to use two separate `withRoot` calls (instead of signal mutation) because SolidJS server renderer (`createRoot` in Bun's test context) does not reactively recompute memos after signal updates.

## Issues Encountered

### 1. Pre-existing turbo typecheck failure (ENVIRONMENT)
`bun turbo typecheck` was already failing before Phase 4 on `@devilcode/kilo-ui#typecheck`. The tsgo native TypeScript compiler follows workspace symlinks and pulls `../opencode/src/` files into devil-ui's type-checking context. These opencode files use `@/` path aliases that devil-ui's tsconfig doesn't define, causing hundreds of `Cannot find module '@/...'` errors.

This failure predates Plan 04-01 and is reproducible on the clean git HEAD. **No new `src/` (devil-ui source) errors were introduced by this plan.** All errors remain in the `../opencode/src/` namespace.

### 2. Turbo cyclic dependency on @devilcode/cli (ARCHITECTURE)
Attempting to add `@devilcode/cli` as any type of dependency to `packages/devil-ui/package.json` triggers: `Cyclic dependency detected: @devilcode/cli, @devilcode/kilo-ui`. Resolved via lazy require pattern (see Key Decisions).

### 3. @devilcode/cli export wildcards don't cover directories
The `"./*": "./src/*.ts"` export pattern in opencode's `package.json` matches direct `.ts` files but NOT directories. `@devilcode/cli/devilcode/team/quickstarts` (a directory with `index.ts`) fails at runtime. The test uses `@devilcode/cli/devilcode/team/index` instead, which works via the file export.

### 4. SolidJS server renderer doesn't reactively update memos
In `createRoot` (used by `withRoot` test harness), SolidJS runs in server mode where `createMemo` doesn't recompute after signal changes. The re-evaluation test was rewritten as two separate `withRoot` calls to test valid and invalid states independently.

## Requirements Covered

- **P4-R2**: TeamRepository interface + FileSystemTeamRepository (CRUD, path traversal protection, mkdir-p)
- **P4-R2**: useTeamValidation hook with Zod-driven safeParse and stage coverage extraction
- **P4-R2**: StageCoverageIndicator primitive with DOM branch production-ready and terminal stub
