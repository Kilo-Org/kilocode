# Phase 5: Runtime Cockpit Redesign — Context

## Phase Goal
Replace the existing 8 root workflow-tui files with a redesigned runtime cockpit that composes devil-ui primitives. Fix the `detail-panel.tsx:113-115` rendering bug via a flex-safe `DetailPanel` primitive. Keyboard-navigable tabs with Tab/Shift+Tab + 1-9 number shortcuts. Live stage→position indicator in the header. Progressive disclosure: first-run onboarding wizard when no team is configured; auto-compact density after first successful workflow completes. Close Phase 3's 4 terminal-stub carry-forwards (`CommandPalette`, `HelpOverlay`, `FooterBar`, `PasteModal`) in the same phase.

## Requirements Covered
- **P5-R1: Runtime cockpit redesign** — 8 root workflow-tui files replaced/refactored; `detail-panel.tsx` word-wrap bug fixed + visual regression test; tabs keyboard-navigable via Tab/Shift+Tab + 1-9 shortcuts; stage→position indicator visible in header and reactive on `currentStage` change; zero regression across `back/status/pause/approve/revise/next/task` commands.
- **P5-R2: Progressive disclosure (first-run vs daily)** — First-run users (no team config) see `<OnboardingWizard>` overlay; wizard chains `loadQuickstart → review → save → startBuild`; after first successful workflow (first `build` task completes with `status === "completed"`), density auto-switches to compact and persists via `Config.update({"workflow.density": "compact"})`. Manual toggle via `/density compact|expanded` command and `<DensityToggle>` UI.

(REQUIREMENTS.md not present — descriptions sourced from ROADMAP.md success criteria + spec `.planning/specs/05-runtime-cockpit-spec.md`.)

## What Already Exists (from prior phases)

### Phase 1 outputs (Foundation)
- `packages/opencode/src/devilcode/team/library.ts` — `POSITION_LIBRARY` (11 entries), `CanonicalPosition` enum
- `packages/opencode/src/devilcode/team/capabilities.ts` — `CanonicalCapability`, `STAGE_CAPABILITY_REQUIREMENTS` map (used by `useStagePosition` to derive role from stage)
- `packages/opencode/src/devilcode/team/config.ts` — `CanonicalTeamConfig` with `superRefine` stage-coverage validator

### Phase 2 outputs (Preset Migration)
- `packages/opencode/src/devilcode/team/quickstarts/` — 5 quickstart JSONs + `loadQuickstartTemplates()` (consumed by `<OnboardingWizard>`)
- `Config.update(config: Info)` read-then-merge pattern established for team persistence; reused by `setDensity` + `markFirstRunComplete`

### Phase 3 outputs (TUI Scaffolding)
- `packages/devil-keybind/` — `createCommandRegistry`, `createKeybindRegistry`, `searchCommands`, `createLeaderChain`
- `packages/devil-ui/src/context/render-target.tsx` — `RenderTargetProvider`, `useRenderTarget`, `RenderSurface`, `createFocusSignal`
- `packages/devil-ui/src/adapters/{terminal,dom}.ts` — async terminal factory + DOM adapter
- `packages/devil-ui/src/hooks/use-command-registry.tsx` + `use-prompt-history.ts`
- `packages/devil-ui/src/primitives/{command-palette,help-overlay,footer-bar,paste-modal}/` — **DOM branches live; terminal branches stubbed — Phase 5 unstubs all 4**
- `packages/devil-ui/src/primitives/TERMINAL-STORYBOOK-DECISION.md` — DOM-only Storybook strategy

### Phase 4 outputs (Team Builder Views)
- `packages/opencode/src/devilcode/team/repository.ts` — `TeamRepository` interface + `createFileSystemTeamRepository` (used implicitly by wizard's save step)
- `packages/devil-ui/src/hooks/use-team-validation.tsx` — `useTeamValidation` hook (wizard blocks save until valid)
- `packages/devil-ui/src/primitives/stage-coverage-indicator/` — `StageCoverageIndicator` primitive (rendered inside wizard review step)
- `packages/devil-ui/src/components/{roster-table,position-picker}.tsx` — `RosterTable` + `PositionPicker` (composed by `OnboardingWizard`)
- `packages/opencode/src/devilcode/workflow-tui/views/` — `TeamBuilderProvider` + `team-builder-view.tsx` + `team-builder-commands.ts` + `quickstart-loader.tsx` (preserved; Phase 5 expands mode router to include onboarding)

### Carry-forward work Phase 5 must close
1. **Phase 3**: 4 terminal stubs (unstub all — Plan 05-02 Task 1)
2. **Phase 4 #1**: `<Show fallback={<TerminalStub .../>}>` eager JSX eval — convert to lazy form across `roster-table.tsx` + `position-picker.tsx`; document in `devil-ui/CONVENTIONS.md` (Plan 05-02 Task 3)
3. **Phase 4 #2**: `selectRole()` does NOT close overlays — add `closeOverlays()` helper to `TeamBuilderActions` (Plan 05-02 Task 3)
4. **Phase 4 #3**: Provider action tests limited by Bun/@opentui harness — Phase 5 does not resolve; documented as known scope limit

## Key Design Decisions

### Architecture: Clean (selected from 3 proposals)
- **Why Clean over Minimal/Pragmatic**: Phase 9 (VS Code Agent Manager webview) reuses the entire cockpit UI surface. Minimal (inline everything) forces Phase 9 to rebuild onboarding + density + tabs + stage badge from scratch. Pragmatic (partial extraction) leaves tab model inline, forcing Phase 9 tab rewrite. Clean extracts 5 primitives + 3 hooks; Phase 9 imports unchanged. Matches Phase 3+4 precedent where user chose Clean for the same reason.
- **Trade-off accepted**: 12 new deliverables + 4 unstubs (larger than Phase 4's 9). Estimated 1,500 LOC source + 900 LOC tests. Auto-refine critique likely surfaces ≥1 REWORK cycle given cross-phase carry-forwards.

### Wave structure
- **Wave 1 (Plan 05-01)**: devil-ui hooks + 4 primitives (StagePositionBadge, DetailPanel, TabGroup, DensityProvider+Toggle). No internal deps beyond Phase 3+4 exports. Foundations for W2+W3.
- **Wave 2 (Plan 05-02)**: Unstub 4 Phase 3 terminal primitives + ship OnboardingWizard primitive + close Phase 4 carry-forwards. Consumes Wave 1 primitives (OnboardingWizard embeds RosterTable + PositionPicker + StageCoverageIndicator + new primitives).
- **Wave 3 (Plan 05-03)**: opencode composition — `runtime-cockpit.tsx` + `context.tsx` extensions + `index.tsx` mode router + `command-input.tsx`/`task-panel.tsx` refactors + removals (`status-bar.tsx` + `detail-panel.tsx` + `tabs/tab-bar.tsx`) + integration tests + detail-panel Playwright visual regression.

### Component placement
- **devil-ui owns**: OnboardingWizard, DensityProvider+Toggle, StagePositionBadge, TabGroup, DetailPanel (primitives); useDensity, useFirstRun, useStagePosition (hooks). No `@opentui/*` static imports; consumable by Phase 9 webview without modification.
- **opencode/workflow-tui owns**: `runtime-cockpit.tsx` (composition), `index.tsx` mode router, `context.tsx` density + firstRun extensions + auto-compact effect, command routing (`/density` command). TUI-specific — Phase 9 composes its own webview equivalent.
- **Deletes**: `status-bar.tsx` (logic splits between `runtime-cockpit.tsx` header strip + `StagePositionBadge`), `detail-panel.tsx` (replaced by `DetailPanel` primitive consumer; `hint()` helper moves to `tabs/helpers.ts`), `tabs/tab-bar.tsx` (replaced by `TabGroup`).

### Detail-panel bug fix strategy
- Root cause: `<text fg wrapMode="word" width="100%">` inside `<box border paddingLeft=1 paddingRight=1>` — OpenTUI flex container width conflict produces character bleed.
- Fix: `DetailPanel` primitive wraps body text in an intermediate `<box flexGrow={1} minWidth={0}>`; drops explicit `width="100%"` on text; lets flex handle containment. `minWidth={0}` is the canonical flexbox escape for a child overflowing a bordered parent.
- Validation: Playwright snapshot test captures bug repro fixture + asserts fixed rendering (Plan 05-03 Task 3).

### Stage→position data derivation
- `useStagePosition({workflowState, teamConfig})` hook reads `wf.state.currentStage` + team config `roles`; looks up stage's required capability via `STAGE_CAPABILITY_REQUIREMENTS`; returns first role whose `capabilities` array contains that capability.
- Single source of truth: `capabilities.ts` owns the stage→capability map. No parallel map in devil-ui.

### Density persistence
- `DensityProvider initial onPersist` context; `useDensity()` emits `{density, setDensity, toggle}`.
- opencode wires `onPersist={(d) => Config.update(read-then-merge {"workflow.density": d})}`; on mount reads `Config.get("workflow.density") ?? "expanded"` as `initial`.
- Auto-compact: `createEffect` in `context.tsx` fires `setDensity("compact")` once when first `build` task reaches `status: "completed"` AND `firstRunComplete === true`. Guarded against re-fire.

### First-run detection
- `useFirstRun({configGetter, workflowState})` → `isFirstRun` = `!configGetter() && !workflowState()?`.
- Mode router: on mount, if isFirstRun → setMode("onboarding").
- Wizard finishing path: `await markFirstRunComplete() → setMode("workflow")`.

### Tab keyboard contract
- `TabGroup` owns: `Tab` cycles forward, `Shift+Tab` cycles backward, digits `1`-`9` jump to Nth tab, `w` closes current tab if `closeable`. Emits `onSwitch(id)` / `onClose(id)` — opencode wires to `wf.switchTab` / `wf.closeTab`.
- ARIA: `role="tablist"`, each tab button `role="tab"`, `aria-selected`, `aria-controls`. Shortcut 1-9 not 1-5 (ROADMAP's 1-5 was shorthand; agent tabs push total past 5 during wave execution).

### Onboarding wizard flow (P5-R2 acceptance)
- Step 1 "pick": `<PositionPicker>` + quickstart list (5 bundled templates).
- Step 2 "review": read-only `<RosterTable>` + `<StageCoverageIndicator>` + "Start Workflow" button (disabled until `useTeamValidation` returns `isValid === true`).
- Step 3 "save": writes to `~/.local/share/kilo/teams/default.json` via `TeamRepository.saveTeam("default", config)`; calls `markFirstRunComplete()`; invokes `wf.startBuild(config)`.
- Terminal branch ships fully (no stub) — Phase 5 owns terminal polish per Phase 3 precedent.

### Tests
- Unit: devil-ui primitives + hooks via Phase 3 `withRoot` harness (DOM branch) + structural smoke tests where terminal rendering is required.
- Integration: opencode `cockpit.integration.test.ts` covers onboarding E2E, density persistence round-trip, 8-command regression, tab keyboard (Tab/Shift+Tab/1-9), stage→position reactive update.
- Visual regression: Playwright snapshot on `DetailPanel` reproducing the `detail-panel.tsx:113-115` bug fixture.

### Agent assignments rationale
- **Plan 05-01**: engineering-frontend-developer (primitives in SolidJS + TypeScript) + engineering-senior-developer (hook architecture, DensityProvider context wiring, signal/Accessor contracts). Reviewer: testing-qa-verification-specialist.
- **Plan 05-02**: engineering-frontend-developer (primitives + unstubs) + design-ux-researcher (onboarding flow ergonomics, first-run vs daily behavior). Reviewer: testing-qa-verification-specialist.
- **Plan 05-03**: engineering-frontend-developer (composition + mode router) + engineering-senior-developer (state-machine integration, `Config.update` bridge, auto-compact effect). Reviewer: testing-qa-verification-specialist + engineering-backend-architect (cross-check `Config.update` semantics).
- ROADMAP-recommended UI Designer role folded into Frontend Developer (visual density + toggle are pure SolidJS work per Phase 3+4 precedent).

## Open Items Carried From Spec
- **OQ-1**: `devil-ui → opencode/team` import edge (Phase 4 carry-forward) extends to `team/capabilities.ts` + `team/library.ts`. Acceptable — Phase 9 may extract shared types package.
- **OQ-2**: `PasteModal` terminal branch single-line limitation (OpenTUI has no `<textarea>`). Accept Phase 5; multi-line deferred to Phase 6+ or upstream PR.
- **OQ-3**: First-run wizard quit mid-flow — re-fires with clean slate next run (Phase 6 may add draft-resume).
- **OQ-4**: `/density` command registration — via `CommandRegistry` for Phase 9 webview discoverability.
- **OQ-5**: Auto-compact trigger — first `build` task completion (not `retro` or `ship` — too late).
- **OQ-6**: Tab shortcuts 1-9 (not 1-5); agent tabs push past 5 during execution.

## Plan Structure
- **Plan 05-01 (Wave 1)**: Foundations — devil-ui hooks (useDensity, useFirstRun, useStagePosition) + primitives (StagePositionBadge, DetailPanel with `minWidth={0}` fix, TabGroup, DensityProvider+Toggle)
- **Plan 05-02 (Wave 2)**: Unstubs + OnboardingWizard + Phase 4 carry-forwards — 4 Phase 3 terminal branches unstubbed; OnboardingWizard primitive (DOM + terminal); `<Show fallback>` lazy conversion; `closeOverlays()` action; `devil-ui/CONVENTIONS.md`
- **Plan 05-03 (Wave 3)**: Composition — `runtime-cockpit.tsx` + `context.tsx` extensions + `index.tsx` mode router + `command-input.tsx`/`task-panel.tsx` refactors + deletes + integration tests + detail-panel Playwright visual regression
