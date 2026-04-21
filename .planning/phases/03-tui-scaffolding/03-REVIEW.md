# Phase 3 Review — TUI Scaffolding: Hybrid Interaction Primitives

**Status**: PASSED
**Date**: 2026-04-19
**Review Mode**: Dynamic panel — QA Verification Specialist + Backend Architect
**Cycles**: 3 of 3

## Summary

Phase 3 review passed after 3 cycles. All blockers and warnings resolved.

## Cycle 1 Findings (6 fixed)

| # | Severity | File | Finding | Resolution |
|---|----------|------|---------|------------|
| 1 | WARNING | `registry.ts` | `this`-binding hazard — shorthand methods using `this.unregister()` / `this.getAllByScope()` fragile when destructured | Extracted `getAllByScopeLocal` closure; replaced `this.unregister` with `commands.delete(cmd.id)` |
| 2 | WARNING | `paste-modal/index.tsx` | Double focus init — sync `if (props.open)` block + `createEffect` both calling `setFocusedNodeId` on mount | Removed sync block; `createEffect` only |
| 3 | WARNING | `command-palette/index.tsx` | `cmd.enabled?.()` predicate not evaluated — disabled commands would fire on click and show no visual mute | Added `aria-disabled`, click guard, muted color when `cmd.enabled?.() === false` |
| 4 | WARNING | `use-command-registry.tsx` | `entries` signal dual-contract undocumented — value is global-scope only but reactive trigger fires for all scopes | JSDoc updated with explicit dual-contract documentation |
| 5 | WARNING | `use-command-registry.test.ts` | No test covering cross-scope subscribe reactivity | Added "registering a workflow-scope command triggers subscribe callback" test (15 total) |
| 6 | CAUTION | `registry.ts` | `subscribe` returned new array on every notification (existing behavior preserved but not verified reactive) | In-body comment added; existing behavior confirmed correct |

## Cycle 2 Findings (2 fixed)

| # | Severity | File | Finding | Resolution |
|---|----------|------|---------|------------|
| 7 | WARNING | `paste-modal/index.tsx` | `handleKeyDown` bound to both `<dialog>` and `<textarea>` without `e.stopPropagation()` — Escape fires `handleClose()` twice unconditionally | Added `e.stopPropagation()` at top of `handleKeyDown` |
| 8 | WARNING | `command-palette/index.tsx` | `selected` index not clamped when `results()` shrinks from registry mutations — `results()[selected()]` returns `undefined`; Enter silently no-ops | Added `createEffect` to clamp `selected` to `len - 1` on results shrink |

## Cycle 3 Findings (2 fixed)

| # | Severity | File | Finding | Resolution |
|---|----------|------|---------|------------|
| 9 | WARNING | `command-palette/index.tsx` | `createEffect` read `selected()` as tracked dep → reactive self-subscription; terminates but fragile | Changed to `untrack(selected)` — effect re-triggers only on `results()` changes |
| 10 | WARNING | `paste-modal/index.tsx` | JSDoc said "set synchronously" — inaccurate; `createEffect` queues after reactive flush | Updated JSDoc to "managed reactively via createEffect (after reactive flush)" |

## Informational (no fix required)

| # | File | Note |
|---|------|------|
| I1 | `paste-modal/index.tsx` | Terminal branch `<input>` has `onKeyDown={handleKeyDown}` which now calls `stopPropagation` — harmless in Phase 3 stub; Phase 5 terminal impl should review |
| I2 | `command-palette/index.tsx` | `aria-activedescendant` clears correctly during one-frame window between registry mutation and clamp effect; `if (cmd)` guard prevents crash |
| I3 | `paste-modal/index.tsx` | `<dialog>` uses `open={...}` (controlled), not `showModal()` — native `cancel` event path is inert; `stopPropagation` fix is architecturally sound for this pattern |

## Final Verification

| Command | Result |
|---------|--------|
| `bun turbo typecheck` (14/14) | PASS |
| `cd packages/devil-ui && bun run typecheck` | PASS (post cycle-3 fixes) |
| `cd packages/devil-keybind && bun test` (46 pass) | PASS |
| `cd packages/devil-ui && bun test src/hooks/__tests__` (15 pass) | PASS |
| `cd packages/opencode && bun test test/devilcode/workflow-tui` (7 pass) | PASS |

## Commits

- `07aaf6947` — Phase 3 execution complete (Wave 3)
- `fix(legion): review cycle 1 fixes for phase 3` — 6 cycle-1 fixes
- `fix(legion): review cycle 2 fixes for phase 3` — 2 cycle-2 fixes
- `fix(legion): review cycle 3 fixes for phase 3` — 2 cycle-3 fixes
- `chore(legion): phase 3 review passed — TUI Scaffolding` — review sign-off
