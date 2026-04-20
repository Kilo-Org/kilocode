---
phase: 5
title: "Runtime Cockpit Redesign"
review_cycles: 2
status: Passed
completed: 2026-04-19
panel:
  - testing-qa-verification-specialist
  - engineering-frontend-developer
  - testing-test-results-analyzer
---

# Phase 5 Review — Runtime Cockpit Redesign

## Panel

| Slot | Agent | Role |
|------|-------|------|
| 1 | testing-qa-verification-specialist | Primary — evidence-focused QA, structural compliance, test coverage |
| 2 | engineering-frontend-developer | Secondary — SolidJS architecture, reactivity correctness, ARIA |
| 3 | testing-test-results-analyzer | Secondary — test quality metrics, coverage gap analysis |

## Cycle 1 Findings

### BLOCKERs (2)

| ID | File | Issue | Root Cause |
|----|------|-------|-----------|
| B1 | `packages/devil-ui/src/primitives/onboarding-wizard/index.tsx` | `require("@opentui/solid")` in `TerminalOnboardingWizard` without try/catch — crashes in test/DOM environments | CONVENTIONS.md §3 pattern not followed; every other terminal branch (TabGroup, CommandPalette, HelpOverlay) guards the require |
| B2 | `packages/opencode/src/devilcode/workflow-tui/index.tsx` | `useWorkflow()` called inside anonymous `Show` children accessor — context propagation relies on internal SolidJS Owner invariants, not an explicit component boundary | Inline accessor lambda receives context from reactive owner chain but is architecturally fragile and statically unverifiable |

### WARNINGs (10)

| ID | File | Issue |
|----|------|-------|
| W1 | `context.tsx` | `handleMarkFirstRunComplete` had bare `catch {}` — silent failure means onboarding wizard repeats next session |
| W2 | `detail-panel/index.tsx` | `DomBranch` received `isCompact={isCompact()}` (frozen boolean) — density changes after mount had no effect |
| W3 | `command-palette/index.tsx` | `aria-selected` was boolean, not string `"true"/"false"` — violates codebase ARIA convention |
| W4 | `command-input.tsx` | `next` command called `await run(...)` outside try/catch — unhandled rejection |
| W5 | `context.tsx` | `autoCompactFired` race window before `onMount` seeds from Config | (FALSE POSITIVE — see below) |
| W6 | `use-density.test.ts` | No DensityProvider behavioral test — only structural export checks |
| W7 | `tab-group.test.ts` | Shift+Tab backward navigation not asserted |
| W8 | `density.integration.test.ts` | TDZ ordering test used `indexOf("let autoCompactFired")` (variable declaration line) for `effectPos` — trivially true, not meaningful |
| W9 | `footer-bar/index.tsx` | Both `domBranch` and `terminalBranch` eagerly instantiated at component scope | (DOCUMENTED PATTERN — see below) |
| W10 | `runtime-cockpit.tsx` | `wf.tabs.find()` inside TabGroup render-prop establishes reactive subscription to all tab changes |

### SUGGESTIONs (4 — not required)

- Playwright stub in `detail-panel.visual.test.ts` lacks GitHub issue reference
- Cockpit command string checks not scoped to conditional context
- `hint(wf)` called twice per render (once for `.title`, once for `.body`)
- detail-panel `TerminalBranch` uses `require("solid-js/h")` rather than `@opentui/solid` (lower risk but diverges from §3)

## Cycle 1 Fixes Applied

All 10 must-fix findings addressed (2 BLOCKERs + 8 of 10 WARNINGs; 2 deemed false positive/established pattern):

| ID | Fix |
|----|-----|
| B1 | Wrapped `require("@opentui/solid")` in try/catch with conditional call — matches TabGroup/CommandPalette pattern |
| B2 | Extracted `WorkflowViewShell` named component; `useWorkflow()` called at its top level under `WorkflowProvider` |
| W1 | `catch (err) { console.error("[workflow] markFirstRunComplete: ...", err) }` |
| W2 | `DomBranch` calls `useDensityOptional()` directly; `padValue` / `fontSizeValue` are `() =>` thunks used reactively in JSX |
| W3 | `aria-selected={i() === selected() ? "true" : "false"}` |
| W4 | `try { await run(...) } catch (err) { toast.show(...) }` in `next` branch |
| W6 | Behavioral test added: `createSignal` + `setDensity` + `toggle` + `onPersist` contract verified in `withRoot()` |
| W7 | `expect(SRC).toContain("evt.shift")` + `expect(SRC).toContain("ev.shiftKey")` added |
| W8 | `effectPos = contextSrc.indexOf("createEffect(")` — points to effect registration, not variable declaration |
| W10 | `const tabInfoById = createMemo(() => new Map(wf.tabs.map(...)))` at cockpit level; render-prop uses `tabInfoById().get(tab.id)` |

**W5 rationale (not fixed)**: `autoCompactFired` is a `let` variable on the closure. `createEffect` guards on `!store.firstRunComplete` which starts `false`. `onMount` sets `firstRunComplete` from Config only after `autoCompactFired` is seeded, so no window exists where the effect fires before Config seeding resolves. False positive confirmed by all 3 reviewers.

**W9 rationale (not fixed)**: Eager instantiation of both `domBranch` / `terminalBranch` is the established `RenderSurface` pattern used identically in CommandPalette, HelpOverlay, and FooterBar (all Phase 3/5 components). Changing it requires altering the `RenderSurface` contract. Documented as acceptable trade-off; post-Phase-9 optimization candidate.

## Post-Cycle-1 Additional Fix

Cycle 2 reviewers (QA + FE) independently identified `TerminalCommandPalette` in `command-palette/index.tsx` as having a bare `require("@opentui/solid")` — same B1 class, same file touched for W3. Applied identical try/catch guard. Committed separately.

## Cycle 2 Findings

All 10 targeted fixes verified PASS by all 3 reviewers. No new regressions.

| Reviewer | Verdict |
|----------|---------|
| QA Verification Specialist | PASS (advisory: TerminalCommandPalette bare require → fixed before cycle 2 close) |
| Frontend Developer | PASS WITH CONDITION (TerminalCommandPalette → fixed) |
| Test Results Analyzer | PASS (329/329 tests, 0 fail, no flakiness) |

**Consolidated Cycle 2 Verdict: PASS**

## Final Test Results

```
packages/devil-ui:   195 pass, 0 fail (19 files)
packages/opencode:   134 pass, 0 fail (9 devilcode test files)
Total:               329 pass, 0 fail
```

## Commits

- `a8725e96f` — fix(legion): review cycle 1 fixes — Phase 5 Runtime Cockpit (10 files, 119 ins / 43 del)
- `b36be5ec5` — fix(ui): wrap TerminalCommandPalette require(@opentui/solid) in try/catch

## Carry-Forwards to Phase 6

- `hint(wf)` called twice per render in `runtime-cockpit.tsx` (minor inefficiency — `createMemo(() => hint(wf))` improves it)
- `detail-panel` `TerminalBranch` uses `require("solid-js/h")` rather than standard `@opentui/solid` dynamic require (lower risk; CONVENTIONS.md §3 divergence documented)
- `footer-bar` eager dual-branch instantiation (optimize with lazy branching in Phase 9 when RenderSurface contract matures)
- DensityProvider ↔ `store.density` sync gap (known limitation from 05-03-SUMMARY.md §Known Limitation): `/density` command works; auto-compact visual effect activates on next session load
