# Phase 4 Review — Team Builder Views

**Status**: COMPLETE — Review PASSED (3 cycles)
**Completed**: 2026-04-19
**Reviewers**: QA Verification Specialist · Frontend Developer · Test Results Analyzer · Senior Developer

---

## Verdict: PASS

All findings resolved across 3 cycles. 80 tests pass, 0 fail. Typecheck clean (no new errors in Phase 4 files).

---

## Cycle 1 Findings & Fixes

| # | Severity | File | Issue | Fix |
|---|----------|------|-------|-----|
| 1 | **BLOCKER** | `workflow-tui/views/team-builder-view.tsx:97-99` | `onSelectRole` called `builder.editRole(positionId, "_selected", true)` instead of updating `store.selectedRole` — row selection permanently broken | Added `selectRole(id: string \| null)` to `TeamBuilderActions` + implementation; `onSelectRole` now calls `builder.selectRole(positionId)` |
| 2 | WARNING | `workflow-tui/index.tsx:52-57` | `void cleanupTeamCmds` — command cleanup not registered with `onCleanup` | Added `onCleanup` import; replaced `void cleanupTeamCmds` with `onCleanup(cleanupTeamCmds)` |
| 3 | WARNING | `team/repository.ts:77-80` | `loadTeam` throws raw ENOENT OS error | Wrapped in try/catch; ENOENT throws `Team "${id}" not found` domain error |
| 4 | WARNING | `team/repository.ts:83-89` | `saveTeam` returns `name: id` instead of reading from config | Returns `(config as Record<string, unknown>).name as string ?? id` |
| 5 | WARNING | `components/roster-table.tsx:341-344` | Eagerly instantiates both DOM and terminal JSX branches before `RenderSurface` | Replaced with `<Show when={adapter.kind === "dom"} fallback={<TerminalStub .../>}>` pattern |
| 6 | WARNING | `components/position-picker.tsx:366-371` | Same eager-instantiation issue | Same `<Show>` fix |
| 7 | WARNING | `primitives/stage-coverage-indicator/index.tsx:61` | `aria-invalid={boolean}` — must be string per WAI-ARIA spec | Changed to `aria-invalid={isMissing ? "true" : "false"}` |
| 8 | WARNING | `components/position-picker.tsx:196-346` | Dialog doesn't focus search input on open | Added `let searchInput` ref + `createEffect(() => { if (props.open && searchInput) searchInput.focus() })` |
| 9 | WARNING | `components/position-picker.tsx:260-329` | `<button role="option">` identified as invalid ARIA (initial diagnosis incorrect — see cycle 2 regression) | Removed `role="option"` from buttons (later reverted in cycle 2 — see fix B below) |
| 10 | WARNING | `components/roster-table.tsx:57-91` | `<table>` missing `aria-label`; `<th>` missing `scope="col"` | Added `aria-label="Team roster"` to table; `scope="col"` to all 6 `<th>` elements |
| 11 | WARNING | `test/workflow-tui/team-builder.test.ts:19-68` | No TeamBuilderProvider action tests | Added 3 tests in new `"TeamBuilderProvider state machine"` describe block |
| 12 | WARNING | `hooks/__tests__/use-team-validation.test.ts:38-55` | `errorsByRole` test only asserted `isValid`, not actual grouping | Test now asserts `Object.keys(r.errorsByRole)` contains the broken role key AND `.length > 0` |
| 13 | WARNING | `primitives/stage-coverage-indicator/` | Zero test coverage for success criterion component | Created `primitives/__tests__/stage-coverage-indicator.test.ts` (10 structural tests) |
| 14 | WARNING | `workflow-tui/views/quickstart-loader.tsx:14` | `loadQuickstartTemplates()` at render time with no error handling | Wrapped in try/catch with empty-object fallback; added `if (!tpl) return null` guard |

---

## Cycle 2 Findings & Fixes

| Fix | Severity | File | Issue | Fix |
|-----|----------|------|-------|-----|
| A | **BLOCKER** | `team/repository.ts:88` | TS2698: `{ ...raw }` spread on `raw: unknown` — cycle 1 ENOENT try/catch typed `raw` as `unknown` but the spread was not updated | `CanonicalTeamConfig.parse({ ...(raw as Record<string, unknown>), enabled: true })` |
| B | WARNING | `components/position-picker.tsx:268-271` | Cycle 1 removed `role="option"` from `<button>` but left `aria-selected` — invalid ARIA state on implicit `role="button"`. The original `<button role="option">` inside `role="listbox"` is the canonical WAI-ARIA combobox/listbox APG pattern. | Restored `role="option"`; changed `aria-selected` to string: `{i() === selectedIndex() ? "true" : "false"}` |
| C | NIT | `test/devilcode/workflow-tui/team-builder.test.ts:73` | Test titled "addRole populates draft.roles" did not test `addRole` — tested `POSITION_LIBRARY` structure instead | Renamed to "POSITION_LIBRARY has expected shape for canonical positions (addRole data source)" with comment explaining Bun/JSX constraint |

---

## Cycle 3 Findings & Fixes

| Fix | Severity | File | Issue | Fix |
|-----|----------|------|-------|-----|
| D | **BLOCKER** | `test/devilcode/workflow-tui/team-builder.test.ts:92` | TS2554: `expect(x).toBe(true, message)` — Bun's `toBe` takes one arg; failure message belongs on `expect()` | Changed to `expect(result.success, \`Template "${id}" failed validation\`).toBe(true)` |

---

## Final Test Summary

| Suite | Tests | Expects | Status |
|---|---|---|---|
| `opencode/test/devilcode/team/repository.test.ts` | 7 | 12 | PASS |
| `opencode/test/devilcode/workflow-tui/index.smoke.test.ts` | 7 | 11 | PASS |
| `opencode/test/devilcode/workflow-tui/team-builder.test.ts` | 7 | 30 | PASS |
| `devil-ui/src/components/__tests__/roster-table.test.ts` | 14 | 28 | PASS |
| `devil-ui/src/components/__tests__/position-picker.test.ts` | 15 | 32 | PASS |
| `devil-ui/src/hooks/__tests__/use-team-validation.test.ts` | 5 | 12 | PASS |
| `devil-ui/src/primitives/__tests__/stage-coverage-indicator.test.ts` | 10 | 22 | PASS |
| **Total** | **65** | **147** | **ALL PASS** |

(Plus 15 pre-existing non-Phase-4 hook tests: 80 pass total, 0 fail)

---

## Carry-Forward Notes (Phase 5)

1. **`<Show fallback={<TerminalStub />}>` eager fallback**: SolidJS evaluates `fallback` prop JSX eagerly (it's an expression, not a function). Current `TerminalStub` components are stateless (render `<text>` only), so eager construction is harmless. If Phase 5 terminal branches gain reactive primitives, change to lazy form: `fallback={() => <TerminalStub ... />}`.

2. **`selectRole` doesn't close open overlays**: `selectRole(id)` only updates `store.selectedRole`. Callers are responsible for closing `pickerOpen`/`quickstartOpen`. Current call sites in `team-builder-view.tsx` are safe. Phase 5 compound interactions should document this contract or add a `closeOverlays()` utility action.

3. **TeamBuilderProvider action tests limited by Bun/`@opentui/solid` constraint**: `addRole`, `removeRole`, `editRole`, `loadQuickstart`, `reset`, and `save` store mutations are not covered at the reactive-signal level. This is the established Phase 3 precedent (see `index.smoke.test.ts`). Full provider action test coverage is unblocked if Phase 5 resolves the `@opentui/solid` dynamic-import harness constraint.
