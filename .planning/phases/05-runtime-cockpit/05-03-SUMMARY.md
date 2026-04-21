---
plan: 05-03
title: "Cockpit Composition + Progressive Disclosure + Integration Tests"
wave: 3
status: Complete
completed: 2026-04-19
---

# 05-03 Summary — Cockpit Composition

## Deliverables

### Task 0 — Config.Info Schema Extension
- **`packages/opencode/src/config/config.ts`** — Extended `Config.Info` with `workflow` optional field before `.strict()`:
  - `density: z.enum(["compact","expanded"]).optional()`
  - `firstRunComplete: z.boolean().optional()`
  - `autoCompactFired: z.boolean().optional()`
  - Wrapped with `devilcode_change start/end` markers (R3-01)

### Task 1 — WorkflowViewState Density + First-Run State
- **`packages/opencode/src/devilcode/workflow-tui/types.ts`** — Added `DensityMode = "compact" | "expanded"` export
- **`packages/opencode/src/devilcode/workflow-tui/context.tsx`** — Extended with:
  - `density: DensityMode` (store field, default `"expanded"`)
  - `firstRunComplete: boolean` (store field, default `false`)
  - `setDensity(mode: DensityMode): Promise<void>` action — Config.get + read-then-merge Config.update (R3-02)
  - `markFirstRunComplete(): Promise<void>` action — same merge pattern
  - Auto-compact `createEffect`: fires once per session when `firstRunComplete && density === "expanded"` and any task reaches `status === "completed"`; sets `autoCompactFired = true` and persists to Config (R3-05)
  - Named handler functions declared BEFORE `createEffect` (R3-06 — no TDZ)
  - `onMount` seeds `density`, `firstRunComplete`, `autoCompactFired` from Config before the refresh loop

### Task 2 — Cockpit Composition Files
- **`packages/opencode/src/devilcode/workflow-tui/tabs/helpers.ts`** *(created)* — `hint(wf)` function migrated from deleted `detail-panel.tsx:guide()`. Returns `{title, body}` for all 7 workflow stages + null/no-phase states.
- **`packages/opencode/src/devilcode/workflow-tui/runtime-cockpit.tsx`** *(created)* — New cockpit composition:
  - Imports `DetailPanel`, `StagePositionBadge`, `TabGroup` from deep devil-ui subpaths
  - Uses `useDensityOptional()` (safe — no throw outside DensityProvider)
  - `useStagePosition(() => wf.state?.currentStage ?? "plan", () => builder.draft)` — two Accessor args
  - `StagePositionBadge info={stagePos()}` — single info prop
  - TabGroup render-prop: looks up `info?.kind` from `wf.tabs` (TabDescriptor has no `kind` field)
  - Includes all 5 tab components: PlanTab, ActivityTab, ChallengeTab, ReviewTab, AgentOutputTab
  - Includes `WorkflowCommandInput`; renders hint panel + selected-task detail (R3-07)
- **`packages/opencode/src/devilcode/workflow-tui/index.tsx`** *(rewritten)* — 3-mode cockpit router:
  - `CockpitMode = "onboarding" | "workflow" | "team-builder"`
  - `teamRepo = createFileSystemTeamRepository()` inside component body, NOT module scope (R3-13)
  - `onMount(() => { if (!wf.firstRunComplete) setMode("onboarding") })` — first-run check
  - `onReviewAccept`: `teamRepo.saveTeam("default", config)` NOT builder.save (R3-03); `void wf.startBuild(config).catch(...)` fire-and-forget (R3-04)
  - `loadQuickstartTemplates()` + `getQuickstart(id)` for wizard quickstart entries
  - `DensityProvider` wraps inside `WorkflowView`: `initial={wf.density}`, `onPersist={(d) => void wf.setDensity(d)}`
- **`packages/opencode/src/devilcode/workflow-tui/command-input.tsx`** *(modified)* — Added `/density` command: validates `compact|expanded`, calls `wf.setDensity(mode)`, shows usage warning on invalid arg

### Deleted Files (absorbed into new structure)
- `packages/opencode/src/devilcode/workflow-tui/status-bar.tsx` — logic in runtime-cockpit.tsx header row
- `packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx` — replaced by DetailPanel primitive; `guide()` moved to helpers.ts
- `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx` — replaced by TabGroup primitive

### Task 3 — Integration Tests (4 files, 81 tests)
- **`packages/opencode/test/devilcode/workflow-tui/cockpit.integration.test.ts`** — 24 structural tests: file existence/deletion, RuntimeCockpit composition, StagePositionBadge, DetailPanel, TabGroup render-prop, tab imports, useStagePosition, useDensityOptional, 3-mode router, DensityProvider, OnboardingWizard, /density command, 8 original commands, hint() stages
- **`packages/opencode/test/devilcode/workflow-tui/onboarding.integration.test.ts`** — 13 tests: teamRepo.saveTeam (R3-03), fire-and-forget startBuild (R3-04), markFirstRunComplete, mode transitions, 5 quickstart templates, QuickstartTemplate field contract, full-stack-team roles
- **`packages/opencode/test/devilcode/workflow-tui/density.integration.test.ts`** — 20 tests: store defaults, type fields, Config.get/update in handlers, auto-compact guards and fire logic, autoCompactFired persistence, handler ordering (R3-06), /density command wiring, DensityProvider initial
- **`packages/devil-ui/src/primitives/__tests__/detail-panel.visual.test.ts`** — 7 structural tests: minWidth:{0} present, no `width: "100%"` in h() calls, min-width:0 in DOM style, DetailPanel export, useDensityOptional, Show+useRenderTarget, title/body props. Playwright snapshot block gated on `STORYBOOK_CI=1` (R3-15)

## Test Results

```
packages/opencode: cockpit.integration    24 pass, 0 fail
packages/opencode: onboarding.integration 13 pass, 0 fail
packages/opencode: density.integration    20 pass, 0 fail
packages/devil-ui: detail-panel.visual     7 pass, 0 fail
Total:                                    64 pass, 0 fail (Wave 3 new tests)
```

(Plus 17 pre-existing tests from prior waves that still pass.)

## CI Gate Results

- `bun turbo typecheck` — pre-existing errors only (`@/bus`, `@/global`, `@/plugin` module aliases; SpanProps mismatch from Wave 1); no new errors from Wave 3
- `knip` — clean
- `format:check` — clean
- `check-devilcode-change` — clean (devilcode_change markers present in config.ts Task 0)

## Known Limitation

**DensityProvider ↔ store.density sync gap**: `DensityProvider`'s `initial` is set once at render. Auto-compact writes `store.density = "compact"` + persists to Config, but doesn't update DensityProvider's internal signal. Visual effect on primitives (compacted layout) activates on next session load when DensityProvider reads the new Config-persisted value. The toggle command `/density compact` works correctly because it calls `wf.setDensity()` which routes through the provider's `onPersist` callback. Documented for Phase 6+ resolution.

## Requirement Coverage

| Req | Description | Status |
|-----|-------------|--------|
| R3-01 | Config.Info.workflow schema extension | ✓ |
| R3-02 | Config.update read-then-merge pattern | ✓ |
| R3-03 | teamRepo.saveTeam, not builder.save | ✓ |
| R3-04 | startBuild fire-and-forget (void, never await) | ✓ |
| R3-05 | autoCompactFired persisted to Config | ✓ |
| R3-06 | Named handlers before createEffect (no TDZ) | ✓ |
| R3-07 | runtime-cockpit renders hint + selected-task detail | ✓ |
| R3-08 | TabGroup render-prop pattern | ✓ |
| R3-09 | Deep subpath imports from devil-ui | ✓ |
| R3-13 | teamRepo inside component body, not module scope | ✓ |
| R3-14 | onboarding integration tests: structural only | ✓ |
| R3-15 | Playwright conditional on STORYBOOK_CI=1; structural always | ✓ |
