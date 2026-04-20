# Spec: Phase 5 — Runtime Cockpit Redesign

**Status:** Draft → Critiqued → Assessed
**Created:** 2026-04-19
**Architecture:** Clean (5 devil-ui primitives + 3 hooks; thin opencode composition)
**Source:** ROADMAP.md Phase 5 (no REQUIREMENTS.md — between milestones)

---

## Overview

Phase 5 replaces the existing 8 workflow-tui root files + `tabs/` dir with a redesigned runtime cockpit that composes primitives from `devil-ui`. It fixes the `detail-panel.tsx:113-115` rendering bug, introduces keyboard-navigable tabs (Tab/Shift+Tab + number shortcuts 1-5), surfaces a live stage→position indicator in the header, and ships progressive disclosure: first-run onboarding wizard when no team is configured + auto-compact density toggle after first successful workflow completes. Phase 3 terminal stubs for `CommandPalette / HelpOverlay / FooterBar / PasteModal` are unstubbed in this phase. Phase 9 (VS Code webview) consumes the new `devil-ui` primitives + hooks unchanged — matches the Phase 3+4 Clean precedent prioritizing Phase 9 zero-rework.

## Requirements

| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| P5-R1 | Runtime cockpit redesign | Must | All 8 root workflow-tui files replaced or refactored. `detail-panel.tsx` word-wrap bug fixed + visual regression test. Tabs keyboard-navigable via Tab/Shift+Tab + 1-5 shortcuts. Stage→position indicator visible in header; updates reactively as `currentStage` changes. All existing commands (back, status, pause, approve, revise, next, task, stage names) still work; zero regression across integration suite. |
| P5-R2 | Progressive disclosure (first-run vs daily) | Must | First-run users (no team config) see onboarding wizard overlay when WorkflowView mounts. Wizard chains `loadQuickstart → review → save → startBuild` into one linear flow. After first successful workflow completes (`retro` stage reached or `build` returns success), density auto-switches to compact and persists via `Config.update({ "workflow.density": "compact" })`. Manual toggle via `/density compact\|expanded` or settings UI. Density state reactive; all primitives re-render on change. |

## Architecture

### Layered structure

```
opencode/workflow-tui/                ← thin composition + TUI-specific wiring
  index.tsx                           ← mode router: onboarding | workflow | team-builder
  context.tsx                         ← WorkflowProvider + density/firstRun extensions
  orchestrator.ts                     ← unchanged
  types.ts                            ← extended (TabInfo unchanged; add DensityMode alias)
  runtime-cockpit.tsx                 ← NEW: composes StagePositionBadge + TabGroup + DetailPanel + CommandInput
  command-input.tsx                   ← refactored: /density cmd + tab shortcut routing
  task-panel.tsx                      ← refactored: consumes TabGroup slot props
  tabs/                               ← content adapters (stateless renderers)
    plan-tab.tsx, activity-tab.tsx,
    challenge-tab.tsx, review-tab.tsx,
    agent-output-tab.tsx              ← unchanged rendering logic; wrapped by TabGroup
    tab-bar.tsx                       ← REMOVED (replaced by TabGroup primitive)
  status-bar.tsx                      ← REMOVED (split: phase/wave strip → runtime-cockpit header row; stage/position → StagePositionBadge)
  detail-panel.tsx                    ← REMOVED (replaced by DetailPanel primitive consumer)

devil-ui/primitives/
  onboarding-wizard/                  ← NEW: modal flow (quickstart → roster → done)
  density-provider/                   ← NEW: context + toggle component
  stage-position-badge/               ← NEW: pure render, fed by hook
  tab-group/                          ← NEW: keyboard-navigable Tab/Shift+Tab/1-5 + slot-based content
  detail-panel/                       ← NEW: bordered panel with word-wrap-correct body

devil-ui/hooks/
  use-density.tsx                     ← NEW: {density, toggle, setDensity}
  use-first-run.tsx                   ← NEW: {isFirstRun, markComplete}
  use-stage-position.tsx              ← NEW: {stage, position, agentLabel}

devil-ui/primitives/{command-palette,help-overlay,footer-bar,paste-modal}/
  + terminal branches UNSTUBBED      ← Phase 3 carry-forward closed
```

### Data flow

```
First-run:
  index.tsx mounts → useFirstRun() reads Config.get("workflow.firstRunComplete")
    → if !complete: render <OnboardingWizard /> overlay
    → wizard: quickstart picker → team review → save → markComplete() + startBuild()
    → onboarding closes; runtime-cockpit mounts

Runtime:
  runtime-cockpit.tsx composes:
    <DensityProvider>
      <row>
        <phase/wave text strip>
        <StagePositionBadge />  ← reads useStagePosition() → wf.state.currentStage + team.roles lookup
      </row>
      <TabGroup tabs={wf.tabs} active={wf.activeTab} onSwitch={wf.switchTab} onClose={wf.closeTab}>
        <Slot id="plan"><PlanTab/></Slot>
        <Slot id="activity"><ActivityTab/></Slot>
        ... (challenge/review/agent-output)
      </TabGroup>
      <WorkflowCommandInput />   ← routes /density + tab shortcuts
    </DensityProvider>

Density auto-compact:
  wf.state.currentStage transitions → ship or retro + last-run successful
    → useDensity().setDensity("compact") + Config.update({"workflow.density": "compact"})
    → DensityProvider re-emits; TabGroup + DetailPanel + StagePositionBadge consume hook → compact render
```

### Key Decisions

| # | Decision | Choice | Rationale | Alternatives Considered |
|---|----------|--------|-----------|-------------------------|
| 1 | Architecture philosophy | Clean (5 primitives + 3 hooks in devil-ui) | Matches Phase 3+4 precedent; Phase 9 webview reuses cockpit unchanged; user explicitly prioritized Phase 9 zero-rework | Minimal (inline everything): Phase 9 rebuilds entire cockpit. Pragmatic (extract subset): partial Phase 9 rework on tabs + onboarding. |
| 2 | Onboarding wizard location | `devil-ui/primitives/onboarding-wizard/` with DOM + terminal branches | Phase 9 web onboarding identical UX to TUI; avoids drift. Terminal branch ships in Phase 5 (no deferred stub). | Inline opencode (rejected: Phase 9 rebuilds). |
| 3 | Density persistence | `Config.update({"workflow.density": "compact"\|"expanded"})` + in-memory signal | Reuses Phase 2 Config.update read-then-merge pattern; durable across sessions; Phase 9 reads same key via SDK. | localStorage (rejected: not accessible from VS Code extension runtime). settings.json new file (rejected: adds new persistence path). |
| 4 | Stage→position mapping data source | `useStagePosition()` reads `wf.state.currentStage` + team config's `roles` + `STAGE_CAPABILITY_REQUIREMENTS` from `team/capabilities.ts`; returns first role whose `capabilities` contains stage's required capability | Single source of truth (capabilities.ts already owns stage→capability map). No duplicated mapping logic. | Hardcoded stage→role map (rejected: drift risk with canonical capabilities). Injected via prop from opencode (rejected: Phase 9 would re-inject same data). |
| 5 | Tab keyboard nav | `TabGroup` primitive owns Tab/Shift+Tab cycling + 1-5 number shortcuts; emits `onSwitch(id)` + `onClose(id)` callbacks; opencode wires these to `wf.switchTab` / `wf.closeTab` | Keyboard logic reusable across TUI + webview; existing `WorkflowViewState` tab actions unchanged | Inline into opencode (rejected: Phase 9 rewrites). Global keyboard handler in index.tsx (rejected: tab semantics belong with component). |
| 6 | Detail-panel bug fix | Wrap `<text>` in an inner `<box flexGrow={1} minWidth={0}>` to force flex sizing; drop explicit `width="100%"` on text. Encode as `DetailPanel` primitive layout invariant. | `minWidth={0}` is the canonical flexbox fix for a flex child overflowing a bordered parent; proven in OpenTUI samples. Drops the width="100%" that fights box padding. | Keep width="100%" + paddingRight=2 (rejected: still bleeds; not a root fix). `overflowX=hidden` on parent (rejected: hides the overflow, doesn't prevent it — screen readers + test assertions still see malformed content). |
| 7 | Unstub Phase 3 terminal branches | All 4 (CommandPalette, HelpOverlay, FooterBar, PasteModal) terminal branches unstubbed in Phase 5 Wave 2 | Phase 3 explicitly marked them as Phase-5-owned. Onboarding wizard depends on a working terminal modal (HelpOverlay/CommandPalette patterns). Leaving PasteModal stubbed blocks `/paste` from the cockpit. | Defer PasteModal to Phase 6 (rejected: breaks Phase 3 contract; adds another debt row). |
| 8 | First-run detection | `useFirstRun()` returns `!Config.get("workflow.firstRunComplete") && !wf.state` | Dual check: no persisted flag AND no active workflow state. Handles edge case where user ran `/team init` via Phase 2 CLI but never completed a workflow — wizard still fires with prefilled team. | Only state check (rejected: fires on every new project). Only config flag (rejected: ignores fresh project). |
| 9 | Tabs/ content files | Keep `plan-tab/activity-tab/challenge-tab/review-tab/agent-output-tab.tsx` as stateless renderers; rewrap by TabGroup slot pattern. Remove `tab-bar.tsx`. | Content rendering logic is stable; only the tab-chrome/keyboard layer changes. Minimizes diff surface; focused tests. | Rewrite all tab content (rejected: out of scope; no regression signal requires it). |
| 10 | Tests | Bun native runner + DOM branch for devil-ui primitives (Phase 3 precedent); opencode integration tests for cockpit + onboarding + density persistence; visual regression snapshot for detail-panel fix | Matches Phase 3+4 test stack. Playwright snapshot for detail-panel reproduces the bug fixture + asserts fix. | Add @solidjs/testing-library (rejected: Phase 3+4 established workaround works). |
| 11 | Carry-forward: `<Show fallback>` eager eval | Convert all `<Show fallback={<TerminalStub.../>}>` patterns to lazy form `fallback={() => <TerminalStub.../>}` in Phase 4 RosterTable + PositionPicker, AND document lazy form in a new `devil-ui/CONVENTIONS.md` as the default | Phase 5 introduces more reactive terminal branches (TabGroup, DetailPanel, StagePositionBadge). Eager eval of terminal JSX with new reactive primitives is unsafe. | Document only (rejected: Phase 4 existing code would remain hazardous). |
| 12 | Carry-forward: `selectRole` overlay contract | Add `closeOverlays()` helper action to `TeamBuilderActions`; document that `selectRole` does NOT close overlays | Phase 5 compound interactions (wizard drops into builder drops into picker) need explicit close semantics | Rely on callers (rejected: Phase 5 adds more callers; error-prone). |

## Deliverables

### OnboardingWizard primitive
- **Path:** `packages/devil-ui/src/primitives/onboarding-wizard/index.tsx`
- **Purpose:** Linear first-run wizard: quickstart picker → roster review → save → startBuild
- **Key Content:**
  - Props: `{ open: boolean; quickstarts: QuickstartTemplate[]; onLoadQuickstart(id); onReviewAccept(config); onCancel() }`
  - Steps (enum): `"pick" | "review" | "save" | "done"`
  - Internally uses Phase 4's `PositionPicker` logic via composition (DOES NOT duplicate); embeds `RosterTable` in "review" step read-only mode
  - Terminal branch: full rendering (NOT stubbed); uses OpenTUI `<select-list>` for step 1, preformatted text grid for step 2
  - Accessibility: `role="dialog"`, `aria-modal="true"`, focus trap, ESC cancels
- **Dependencies:** `team/quickstarts`, `devil-ui/components/roster-table`, `devil-ui/components/position-picker`
- **Estimated Size:** ~280 LOC + ~180 LOC tests + 1 Storybook file

### DensityProvider + DensityToggle
- **Path 1:** `packages/devil-ui/src/context/density.tsx` (Provider + context)
- **Path 2:** `packages/devil-ui/src/primitives/density-toggle/index.tsx` (UI toggle)
- **Purpose:** Reactive density signal shared across cockpit; durable via Config.update bridge
- **Key Content:**
  - `<DensityProvider initial="compact"\|"expanded" onPersist={(d) => void}>`
  - Context emits `{density, setDensity, toggle}`
  - `<DensityToggle>` renders a 2-state switch (DOM: button; terminal: `[C]ompact | [E]xpanded` text)
  - opencode wires `onPersist` to `Config.update({"workflow.density": d})` read-then-merge
- **Dependencies:** none (pure SolidJS)
- **Estimated Size:** ~120 LOC + ~90 LOC tests

### StagePositionBadge primitive
- **Path:** `packages/devil-ui/src/primitives/stage-position-badge/index.tsx`
- **Purpose:** Pure-render header indicator: "▶ BUILD → Developer (Claude-3.5-Sonnet)"
- **Key Content:**
  - Props: `{ stage: WorkflowStage; position?: CanonicalPosition; roleLabel?: string; modelLabel?: string; compact?: boolean }`
  - Stage symbols: `plan=📋`, `challenge=⚔`, `contract=🤝`, `build=🔨`, `review=🔎`, `ship=🚢`, `retro=🔁` (ASCII-safe fallbacks for terminal)
  - Renders missing-position case: "BUILD → ⚠ no position mapped"
  - Compact mode: single text token (`[BUILD:Dev]`)
- **Dependencies:** `workflow/types.ts` (WorkflowStage), `team/library.ts` (CanonicalPosition)
- **Estimated Size:** ~80 LOC + ~70 LOC tests + 1 Storybook file

### TabGroup primitive
- **Path:** `packages/devil-ui/src/primitives/tab-group/index.tsx`
- **Purpose:** Keyboard-navigable tab container w/ slot-based content; Tab/Shift+Tab cycles, 1-5 number shortcuts jump
- **Key Content:**
  - Props: `{ tabs: Array<{id, label, closeable?, kind?}>; activeTab: string; onSwitch(id); onClose?(id); density?: DensityMode; children: JSX.Element }`
  - Internal keyboard handler: Tab advances; Shift+Tab retreats; `1`-`9` jump to Nth tab; `w`/`x` closes current if closeable
  - Slot pattern: children rendered inside a `<Slot when={tab.id}>` wrapper; TabGroup filters to active slot
  - Visual separator rendered between `kind === "agent"` and other kinds (matches existing tab-bar.tsx behavior)
  - ARIA: `role="tablist"`, each tab button `role="tab"`, `aria-selected`, `aria-controls` linked to slot panel
- **Dependencies:** `devil-ui/hooks/use-density` (optional for density-aware height)
- **Estimated Size:** ~180 LOC + ~160 LOC tests + 1 Storybook file

### DetailPanel primitive
- **Path:** `packages/devil-ui/src/primitives/detail-panel/index.tsx`
- **Purpose:** Bordered panel primitive with word-wrap-correct body; encodes the fix for the Phase 4/5 rendering bug
- **Key Content:**
  - Props: `{ title: string; body: string; density?: DensityMode }`
  - Layout invariant (fix for `detail-panel.tsx:113-115` bug):
    ```tsx
    <box border={["bottom"]} paddingLeft={1} paddingRight={1}>
      <text><b>{title}</b></text>
      <box flexGrow={1} minWidth={0}>      {/* the fix: flex child w/ minWidth 0 */}
        <text wrapMode="word">{body}</text> {/* no width="100%" */}
      </box>
    </box>
    ```
  - Compact mode: hides title; renders body only
- **Dependencies:** `devil-ui/hooks/use-density` (optional)
- **Estimated Size:** ~70 LOC + ~50 LOC tests (including Playwright visual regression for the bug repro)

### useDensity, useFirstRun, useStagePosition hooks
- **Path:** `packages/devil-ui/src/hooks/use-density.tsx`, `.../use-first-run.tsx`, `.../use-stage-position.tsx`
- **Purpose:** Reactive accessors consumed by primitives + opencode composition
- **Key Content:**
  - `useDensity()` → `Accessor<{density, setDensity, toggle}>`; reads from DensityContext; throws if unprovided
  - `useFirstRun(opts: {configGetter: () => Promise<boolean>; workflowState: Accessor<WorkflowState | undefined>})` → `Accessor<{isFirstRun, markComplete}>`; `isFirstRun` reactive on both config + state
  - `useStagePosition(ctx: {workflowState: Accessor<WorkflowState | undefined>; teamConfig: Accessor<CanonicalTeamConfig | undefined>})` → `Accessor<{stage, position?, roleLabel?, modelLabel?}>`; derives position via capability matching
- **Dependencies:** `team/capabilities.ts` (stage→capability map), `team/library.ts` (CanonicalPosition)
- **Estimated Size:** ~150 LOC total + ~200 LOC tests

### Unstub Phase 3 terminal branches
- **Paths:**
  - `packages/devil-ui/src/primitives/command-palette/index.tsx` (terminal branch)
  - `packages/devil-ui/src/primitives/help-overlay/index.tsx` (terminal branch)
  - `packages/devil-ui/src/primitives/footer-bar/index.tsx` (terminal branch)
  - `packages/devil-ui/src/primitives/paste-modal/index.tsx` (terminal branch; use OpenTUI `<input>` multi-line fallback pattern from Phase 3)
- **Purpose:** Close Phase 3 carry-forward #1
- **Key Content:**
  - CommandPalette terminal: fuzzy search via existing devil-keybind registry; renders as bordered modal with `<select-list>`
  - HelpOverlay terminal: keybind map rendered as grouped text grid (by context); ESC closes
  - FooterBar terminal: 3-5 action chips; uses `[K]` single-letter shortcut rendering
  - PasteModal terminal: single `<input>` bound to a signal; `Ctrl+D` confirms; ESC cancels (no multi-line — OpenTUI lacks `<textarea>` per Phase 3 finding; document single-line limitation)
- **Dependencies:** existing Phase 3 primitives; OpenTUI `<input>`, `<select-list>`
- **Estimated Size:** ~300 LOC across 4 files + ~200 LOC tests

### runtime-cockpit.tsx (opencode)
- **Path:** `packages/opencode/src/devilcode/workflow-tui/runtime-cockpit.tsx`
- **Purpose:** Compose devil-ui primitives into the runtime view
- **Key Content:**
  - `<RuntimeCockpit>` — no props; consumes `useWorkflow` + `useDensity`
  - Header row: phase/wave text strip on left, `<StagePositionBadge>` on right
  - Body: `<TabGroup tabs={wf.tabs} activeTab={wf.activeTab} onSwitch={wf.switchTab} onClose={wf.closeTab}>` with `{PlanTab, ActivityTab, ChallengeTab, ReviewTab, AgentOutputTab}` slots
  - Footer: existing `<WorkflowCommandInput>` (refactored for tab shortcuts + density commands)
  - Feeds `<StagePositionBadge>` via `useStagePosition({workflowState, teamConfig})` — teamConfig sourced from `useTeamBuilder().draft` or persisted team
- **Dependencies:** all devil-ui Phase 5 deliverables + WorkflowProvider + existing tab content components
- **Estimated Size:** ~150 LOC + ~120 LOC integration tests

### context.tsx extensions (opencode)
- **Path:** `packages/opencode/src/devilcode/workflow-tui/context.tsx` (modify)
- **Purpose:** Add `firstRunComplete` reactive accessor reading from Config; ship density persistence bridge
- **Key Content:**
  - New: `firstRunComplete: Accessor<boolean>` read from `Config.get("workflow.firstRunComplete")` on mount, refreshed on cross-session events
  - New action: `markFirstRunComplete(): Promise<void>` — writes via `Config.update` read-then-merge
  - New action: `setDensity(mode: DensityMode): Promise<void>` — writes via `Config.update` read-then-merge; triggers device-level persistence
  - Auto-compact effect: `createEffect` watches `wf.state.currentStage` + last-run success; first successful build → calls `setDensity("compact")` once (guarded by `firstRunComplete` flag)
- **Dependencies:** `Config.update` helper, existing `WorkflowStateManager`
- **Estimated Size:** ~80 LOC delta + ~100 LOC delta tests

### index.tsx refactor (opencode)
- **Path:** `packages/opencode/src/devilcode/workflow-tui/index.tsx` (modify)
- **Purpose:** Expand mode router to onboarding | workflow | team-builder; wire DensityProvider
- **Key Content:**
  - Mode signal: `createSignal<"onboarding" | "workflow" | "team-builder">("workflow")`
  - Effect: on mount, check `useFirstRun()` → if isFirstRun → setMode("onboarding")
  - Render `<DensityProvider initial={Config.get("workflow.density") ?? "expanded"} onPersist={setDensityPersist}>` wrapping all three modes
  - Onboarding branch: `<OnboardingWizard open={true} quickstarts={...} onLoadQuickstart={builder.loadQuickstart} onReviewAccept={async (c) => { await builder.save("auto"); await builder.validateAndStartBuild(); await wf.markFirstRunComplete(); setMode("workflow") }} onCancel={() => setMode("team-builder")} />`
  - Workflow branch: `<RuntimeCockpit />` (replaces existing `WorkflowStatusBar + TaskPanel + DetailPanel + WorkflowCommandInput + Toast` inline tree)
  - Team-builder branch: unchanged (preserves Phase 4 integration)
- **Dependencies:** all Phase 5 deliverables above + existing Phase 4 team-builder wiring
- **Estimated Size:** ~30 LOC delta (current 105 LOC → ~135 LOC)

### Removals
- **Delete:** `packages/opencode/src/devilcode/workflow-tui/status-bar.tsx` (logic split into `runtime-cockpit.tsx` header strip + `StagePositionBadge` primitive)
- **Delete:** `packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx` (replaced by `DetailPanel` primitive consumer inside content tabs; `hint()` helper moves to `tabs/helpers.ts`)
- **Delete:** `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx` (replaced by `TabGroup`)
- **Estimated Size:** −250 LOC (source) + test adjustments

### Tests (aggregate)
- **Integration tests (opencode):** onboarding flow (first-run → wizard → save → startBuild); density persistence (Config read/write round-trip); cockpit regression (8 existing command coverage + tab shortcuts 1-5 + Tab/Shift+Tab cycle); detail-panel visual regression (Playwright snapshot before + after fix); stage→position badge reactive update on stage change
- **Unit tests (devil-ui):** each primitive (DOM branch) + each hook; ARIA role assertions on OnboardingWizard + TabGroup
- **Estimated Size:** ~700 LOC total tests

## Path Validation

**Status:** All paths follow Phase 3+4 precedent.

| Deliverable | Path | Category | Valid | Notes |
|-------------|------|----------|-------|-------|
| OnboardingWizard | `devil-ui/src/primitives/onboarding-wizard/` | primitives | ✓ | Modal flow = cross-domain interaction surface |
| DensityProvider | `devil-ui/src/context/density.tsx` | context | ✓ | Mirrors Phase 3 `render-target.tsx` placement |
| DensityToggle | `devil-ui/src/primitives/density-toggle/` | primitives | ✓ | Pure UI surface |
| StagePositionBadge | `devil-ui/src/primitives/stage-position-badge/` | primitives | ✓ | Pure visual indicator (matches StageCoverageIndicator Phase 4 precedent) |
| TabGroup | `devil-ui/src/primitives/tab-group/` | primitives | ✓ | Cross-domain container primitive |
| DetailPanel | `devil-ui/src/primitives/detail-panel/` | primitives | ✓ | Generic bordered panel; not team-shaped |
| useDensity | `devil-ui/src/hooks/use-density.tsx` | hooks | ✓ | Phase 3 `use-command-registry.tsx` pattern |
| useFirstRun | `devil-ui/src/hooks/use-first-run.tsx` | hooks | ✓ | Same |
| useStagePosition | `devil-ui/src/hooks/use-stage-position.tsx` | hooks | ✓ | Same |
| runtime-cockpit | `opencode/src/devilcode/workflow-tui/runtime-cockpit.tsx` | views | ✓ | Matches existing workflow-tui flat structure |
| context extensions | `opencode/src/devilcode/workflow-tui/context.tsx` | services | ✓ | Modifies existing file |
| Terminal unstubs | existing Phase 3 primitive files | primitives | ✓ | In-place |

## Open Questions

| # | Question | Impact | Default if Unresolved |
|---|----------|--------|-----------------------|
| 1 | Phase 4 OQ-1 (devil-ui → opencode/team import edge): does `useStagePosition` reading `team/capabilities.ts` + `team/library.ts` exacerbate this? | Deferrable | Accept: Phase 9 may extract to shared types package. devil-ui already has `@devilcode/cli` workspace dep from Phase 4; no new edge. |
| 2 | PasteModal terminal branch single-line limitation (OpenTUI has no `<textarea>`) — acceptable or defer? | Deferrable | Accept Phase 5: ship single-line w/ visible "multi-line via system paste" hint; multi-line becomes Phase 6+ or OpenTUI upstream PR. |
| 3 | First-run detection race: wizard mounts → user quits before save → next run: wizard re-fires with persisted draft or clean slate? | Deferrable | Phase 5 ships clean-slate (safer for onboarding); Phase 6 may add draft-resume. |
| 4 | Should `/density` command live in opencode command-input or as a devil-ui registered CommandRegistry entry? | Deferrable | devil-ui-registered (Phase 9 webview gets it for free); command-input routes via registry. |
| 5 | Auto-compact trigger: `retro` stage reached OR `build` success OR `ship` success? | Deferrable | Phase 5 ships: first `build` task completes with `status: "completed"` AND `firstRunComplete === true` → `setDensity("compact")`. Retro/ship too late (user already looking at cockpit for minutes). |
| 6 | Tab number shortcuts 1-5 vs 1-9: existing cockpit can spawn N agent tabs during build; 1-5 only covers artifact tabs | Deferrable | Phase 5 ships 1-9 (matches TabGroup prop `tabs` length up to 9); ROADMAP `1-5` was shorthand. Documented in DECISION 5. |

## Complexity Assessment

**Rating:** Complex (exceeds Phase 4 Medium-Complex)

| Metric | Value |
|--------|-------|
| Requirements | 2 (P5-R1, P5-R2) |
| Success Criteria (ROADMAP) | 7 |
| Deliverables | 12 new files (5 primitives + 3 hooks + 1 cockpit + 1 context subfile + 2 devil-ui index wiring) + 4 unstubs + 2 modify + 3 deletes |
| Estimated waves | 3 |
| Estimated plans | 3 (matches ROADMAP estimate) |
| Estimated LOC | ~1,500 source + ~900 tests (larger than Phase 4's 1,300/700) |
| Competing proposals | ✓ 3 generated (Minimal / Clean / Pragmatic); Clean selected |
| Critical cross-phase carry-forward | 4 from Phase 3 (stubs) + 3 from Phase 4 (Show-fallback, selectRole, provider action tests) |
| Phase 9 reuse surface | 5 primitives + 3 hooks imported unchanged |

**Rationale:** 7 success criteria (vs Phase 4's 6), 8-file replacement + full terminal stub closure + progressive disclosure = materially more scope than Phase 4. Clean architecture decision mandates 5 new devil-ui primitives with DOM+terminal branches shipped together (no "defer terminal to next phase" escape hatch). Auto-refine critique likely surfaces at least 1 REWORK cycle given cross-phase carry-forwards and config persistence complexity.

**Recommended next step:** Run plan decomposition (Wave 1 foundations → Wave 2 cockpit composition → Wave 3 integration + unstubs + progressive disclosure).

## Revision History
| # | Section | Change | Reason |
|---|---------|--------|--------|
| 1 | Key Decision 6 | Chose `minWidth={0}` flex fix over `overflowX=hidden` clipping | Self-critique: clipping hides root cause and defeats visual regression test |
| 2 | Deliverables / Unstub | All 4 Phase 3 stubs unstubbed in Phase 5 (including PasteModal) | Self-critique: deferring PasteModal to Phase 6 creates 3rd carry-forward cycle; closes debt now |
| 3 | Open Question 5 | Auto-compact triggers on first `build` task success, not `retro` | Self-critique: retro is 4 stages later; user already disoriented by expanded density |
| 4 | Open Question 6 | Tab shortcuts 1-9, not 1-5 | Self-critique: active agent tabs push total past 5 during wave execution |
| 5 | Architecture / Key Decision 11 | Added carry-forward Phase 4 #1 fix (Show-fallback lazy form) as deliverable, not just documentation | Self-critique: documentation-only leaves existing Phase 4 code unsafe for Phase 5's new reactive terminal branches |
| 6 | Architecture / Key Decision 12 | Added `closeOverlays()` action to TeamBuilderActions per Phase 4 carry-forward #2 | Self-critique: Phase 5 compound flows (wizard → builder → picker) multiplies overlay nesting |
