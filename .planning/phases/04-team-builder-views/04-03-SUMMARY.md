# Plan 04-03 Summary — Composition: TeamBuilderProvider + Views + Commands + Integration Tests

**Phase**: 4 — Team Builder Views
**Wave**: 3 (depends on 04-01 + 04-02, both complete)
**Completed**: 2026-04-19

---

## Files Created / Modified

| File | Action | LOC |
|---|---|---|
| `packages/opencode/src/devilcode/workflow-tui/views/team-builder-context.tsx` | CREATE | 219 |
| `packages/opencode/src/devilcode/workflow-tui/views/team-builder-view.tsx` | CREATE | 186 |
| `packages/opencode/src/devilcode/workflow-tui/views/team-builder-commands.ts` | CREATE | 79 |
| `packages/opencode/src/devilcode/workflow-tui/views/quickstart-loader.tsx` | CREATE | 105 |
| `packages/opencode/src/devilcode/workflow-tui/index.tsx` | MODIFY | +46/-19 (net +27 LOC) |
| `packages/opencode/test/devilcode/workflow-tui/team-builder.test.ts` | CREATE | 69 |

index.tsx LOC delta: **+27** (target was ~25; within range).

---

## Test Counts

| Suite | Tests | Assertions | Status |
|---|---|---|---|
| `team-builder.test.ts` (new) | 4 | 17 | PASS |
| `index.smoke.test.ts` (existing) | 7 | 11 | PASS |
| **Total workflow-tui** | **11** | **28** | **PASS** |

---

## Verification Commands + Results

| # | Command | Result |
|---|---|---|
| 1 | `test -f views/team-builder-context.tsx` | PASS |
| 2 | `test -f views/team-builder-view.tsx` | PASS |
| 3 | `test -f views/team-builder-commands.ts` | PASS |
| 4 | `test -f views/quickstart-loader.tsx` | PASS |
| 5 | `test -f test/.../team-builder.test.ts` | PASS |
| 6-8 | grep TeamBuilderProvider / useTeamBuilder / createFileSystemTeamRepository in context | PASS |
| 9-11 | grep RosterTable / PositionPicker / StageCoverageIndicator in view | PASS |
| 12-14 | grep registerTeamBuilderCommands / team.build / team.save in commands | PASS |
| 15 | grep QUICKSTART_IDS in quickstart-loader | PASS |
| 16 | grep TeamBuilderProvider in index.tsx | PASS |
| 17 | grep registerTeamBuilderCommands in index.tsx | PASS |
| 18 | `bun test test/devilcode/workflow-tui/team-builder.test.ts` | 4 pass, 0 fail |
| 19 | `bun test test/devilcode/workflow-tui` | 11 pass, 0 fail |
| 20 | `bun turbo typecheck` — pre-existing @devilcode/kilo-ui failure | 0 new errors in workflow-tui/ |
| 21 | `bun run knip` (devil-vscode) | PASS — no unused exports |
| 22 | `bun run format:check` (devil-vscode) | PASS |
| 23 | `bun run check-devilcode-change` | PASS — no stale markers |

---

## Key Decisions

### Command interface shape
`registerTeamBuilderCommands` was originally written with `CommandRegistry` parameter, but `useCommandRegistry()` returns `UseCommandRegistryResult` (which only exposes `register`, `unregister`, `get`, `search`, `matchEvent`, `entries` — not `getAllByScope` or `subscribe`). Changed to accept `RegisterFn = (cmd: Command) => () => void` — a minimal structural type that works with `registry.register.bind(registry)` call in index.tsx.

Fields on each Command: `id`, `title`, `scope`, `aliases`, `hideKeywords`, `hidden`, `onSelect`. `hideKeywords` defaults to `[]` in Zod but is required in the `Command` interface — must be supplied explicitly.

### Mode-switch mechanism
`createSignal<"workflow" | "team-builder">("workflow")` inside `WorkflowViewInner`. Escape key in team-builder mode returns to workflow mode (instead of route.back). The `<Show>` conditional renders either the full workflow layout (StatusBar + TaskPanel + DetailPanel + CommandInput + Toast) or `<TeamBuilderView />`.

### JSX tag selection
`team-builder-view.tsx` and `quickstart-loader.tsx` use DOM elements (`<div>`, `<input>`, `<button>`). Added `/** @jsxImportSource solid-js */` pragma to both files — same pattern used by devil-ui components. This overrides the package-level `@opentui/solid` jsxImportSource for these files, enabling standard HTML element types while remaining within the @opentui/solid tree at runtime. `team-builder-context.tsx` uses only `<TeamBuilderCtx.Provider>` (SolidJS internal, valid in both runtimes) so no pragma needed.

### Provider tree position
`<TeamBuilderProvider>` wraps `<WorkflowViewInner />` inside `<CommandRegistryProvider>`, giving it access to the command registry and render target. It is parallel to (not nested in) `<WorkflowProvider>`.

### POSITION_LIBRARY access pattern
`POSITION_LIBRARY[positionId as CanonicalPosition]` — the library is keyed by `CanonicalPosition` enum values. `addRole` reads `entry.canonicalCapabilities`, `entry.tier`, `entry.displayName`, `entry.id`, and `entry.defaultCanDelegate` to build a `CanonicalTeamRole`.

---

## Issues Encountered

1. **TypeScript: `UseCommandRegistryResult` != `CommandRegistry`** — `useCommandRegistry()` doesn't expose `getAllByScope`/`subscribe`. Fixed by changing `registerTeamBuilderCommands` to accept a minimal `RegisterFn` type instead of the full `CommandRegistry`.

2. **TypeScript: `hideKeywords` required** — `CommandData` schema has `hideKeywords: z.array(z.string()).default([])` but the `Command` interface inherits it as required (no `?`). Fixed by explicitly passing `hideKeywords: []` on all 4 commands.

3. **TypeScript: DOM JSX in @opentui/solid context** — Files using `<div>`, `<input>`, etc. fail typecheck under `@opentui/solid` JSX types (which expect `<box>`, `<text>`, etc.). Fixed with `/** @jsxImportSource solid-js */` pragma on affected files.

4. **TeamBuilderProvider return type** — Initial annotation was `ReturnType<typeof createContext>` which is incorrect for a JSX component. Fixed to `JSX.Element`.

---

## Requirements Covered

- **P4-R1**: TeamBuilderProvider state machine with all required actions (setTeamId, addRole, removeRole, editRole, loadQuickstart, save, validateAndStartBuild, openPicker, closePicker, openQuickstart, closeQuickstart, reset). COMPLETE.
- **P4-R2**: TeamBuilderView composing RosterTable + PositionPicker + StageCoverageIndicator + QuickstartLoader + mode integration in index.tsx + 4 registered commands. COMPLETE.

---

## Phase 4 Status

**COMPLETE — ready for /legion:review**

All 3 waves delivered:
- Wave 1 (04-01): Foundation — TeamRepository, POSITION_LIBRARY, useTeamValidation, StageCoverageIndicator
- Wave 2 (04-02): Components — RosterTable, PositionPicker, devil-keybind CommandRegistry/schemas
- Wave 3 (04-03): Composition — TeamBuilderProvider, views, commands, index.tsx integration, round-trip tests
