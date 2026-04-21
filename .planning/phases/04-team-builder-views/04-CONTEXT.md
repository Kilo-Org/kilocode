# Phase 4: Team Builder Views — Context

## Phase Goal
Ship the in-TUI team-building experience. Position picker browsing the canonical library; editable roster table; save/load flow; live stage-coverage indicator with strict validation; quickstart template loader.

## Requirements Covered
- **P4-R1: In-TUI team builder view** — TeamBuilderView renders inside workflow-tui provider tree; user can browse PositionPicker, edit RosterTable rows, save via `/team save <id>`, load via `/team load-quickstart <id>`.
- **P4-R2: Strict 7-stage coverage validation** — `useTeamValidation()` returns `{ isValid, missingStages, errorsByRole }`; `StageCoverageIndicator` highlights missing stages red; `startBuild()` refuses to dispatch when invalid; reuses existing `superRefine` stage-coverage check from `team/config.ts`.

(REQUIREMENTS.md not present — descriptions sourced from ROADMAP.md success criteria + spec `04-team-builder-views-spec.md`.)

## What Already Exists (from prior phases)

### Phase 1 outputs (Foundation)
- `packages/opencode/src/devilcode/team/library.ts` — `POSITION_LIBRARY` (11 entries), `PositionLibraryEntry` Zod schema, `POSITION_CAPABILITY_MAP`, `getDefaultCanDelegate()`, `validatePositionLibrary()`
- `packages/opencode/src/devilcode/team/capabilities.ts` — `CanonicalCapability` enum (8 values), `STAGE_CAPABILITY_REQUIREMENTS` (covers all 7 stages), `requiredCapabilitiesFor()`
- `packages/opencode/src/devilcode/team/config.ts` — `CanonicalTeamConfig` Zod schema with `superRefine` stage-coverage validator (fires when `enabled=true`); `CanonicalTeamRole`, `CanonicalTeamRouting`, `EffortLevel`, `ReactionRule`

### Phase 2 outputs (Preset Migration)
- `packages/opencode/src/devilcode/team/migration.ts` — `fromLegacyTeamConfig`, `migrateLegacyTeamConfig`, `migrateLegacyTeamConfigFile`
- `packages/opencode/src/devilcode/team/quickstarts/index.ts` — `loadQuickstartTemplates()`, `QUICKSTART_IDS`, `QuickstartTemplate` schema with `team: CanonicalTeamConfig`
- 5 quickstart JSONs (solo-enhanced, code-review-pair, full-stack-team, ci-cd-pipeline, research-team) — all pass stage-coverage validation
- Legacy `TEAM_PRESETS` removed; clean break complete; `/team init` reworked as TUI-launcher

### Phase 3 outputs (TUI Scaffolding)
- `packages/devil-keybind/src/registry.ts` — `createCommandRegistry()`, `createKeybindRegistry()` with `subscribe()` for SolidJS reactivity
- `packages/devil-keybind/src/matcher.ts` — `searchCommands()` wrapping fuzzysort
- `packages/devil-keybind/src/leader.ts` — `createLeaderChain()` (registered but not wired in Phase 3)
- `packages/devil-ui/src/context/render-target.tsx` — `RenderTargetProvider`, `useRenderTarget`, `RenderSurface`, `createFocusSignal`
- `packages/devil-ui/src/adapters/{terminal,dom}.ts` — async terminal factory + DOM adapter (no OpenTUI deps in DOM)
- `packages/devil-ui/src/hooks/use-command-registry.tsx` — `CommandRegistryProvider`, `useCommandRegistry` (synchronous subscribe)
- `packages/devil-ui/src/hooks/use-prompt-history.ts` — `usePromptHistory`, `createMemoryStore`
- `packages/devil-ui/src/primitives/` — `CommandPalette`, `HelpOverlay`, `FooterBar`, `PasteModal` (DOM branches live, terminal branches stubbed for Phase 5)
- `packages/devil-ui/src/primitives/TERMINAL-STORYBOOK-DECISION.md` — DOM-only Storybook strategy (terminal Storybook INFEASIBLE)
- `packages/opencode/src/devilcode/workflow-tui/index.tsx` — provider tree: `WorkflowProvider` > `RenderTargetProvider` > `CommandRegistryProvider` > `WorkflowViewInner`; uses `createResource` (NOT top-level await) for terminal adapter
- `packages/opencode/src/devilcode/workflow-tui/context.tsx` — `WorkflowProvider` exposes `startBuild(teamConfig: CanonicalTeamConfig | undefined)` action

### Catalog/runtime
- `package.json` root catalog entries: `@opentui/{core,solid}: 0.1.87` (single version verified via `bun pm why`)
- `packages/opencode/package.json` declares `@devilcode/keybind: workspace:*` + `@devilcode/kilo-ui: workspace:*`
- `packages/devil-ui/package.json` declares `@devilcode/keybind` dep + `fuzzysort: catalog:` + per-pkg `bunfig.toml` test runner

## Key Design Decisions

### Architecture: Clean (selected from 3 proposals)
- **Why Clean over Minimal/Pragmatic**: Phase 9 (VS Code Agent Manager webview) reuses team-builder UI. Phase 6 (full persistence) extends repository. Phase 7 (DAG override) extends validation. Clean abstractions = zero rework in those phases. Same rationale Phase 3 used (selected Clean for Phase 9 zero-rework).
- **Trade-off accepted**: 9 deliverables (vs 4 Minimal); slightly longer execution. Net win: Phase 5/6/9 ship without refactoring Phase 4 code.

### Wave structure
- **Wave 1 (Plan 04-01)**: Foundations — TeamRepository + useTeamValidation + StageCoverageIndicator. No internal deps. Wave 2/3 can't start without these.
- **Wave 2 (Plan 04-02)**: Reusable devil-ui components — RosterTable + PositionPicker. Consume `useTeamValidation` from Wave 1. Independent of Wave 3.
- **Wave 3 (Plan 04-03)**: Composition — TeamBuilderProvider + view + commands + integration. Consumes Wave 1 + Wave 2.

### Component placement
- **devil-ui owns**: RosterTable, PositionPicker, StageCoverageIndicator, useTeamValidation. No `@opentui/*` static imports — consumable from VS Code webview Phase 9.
- **opencode/workflow-tui owns**: TeamBuilderProvider (state), team-builder-view.tsx (composition), commands wiring, quickstart-loader. TUI-specific.
- **opencode/team owns**: TeamRepository (persistence seam — Phase 6 ships additional impl).

### Validation strategy
- `useTeamValidation()` calls `CanonicalTeamConfig.safeParse({ ...config, enabled: true })` → reuses existing stage-coverage `superRefine` validator.
- Surfaces ZodIssues grouped by role key (`path[1]`) and derives `missingStages` from the error message regex.
- Single source-of-truth: any future change to capabilities/stages updates Zod schema → hook reflects automatically.

### Save semantics (Phase 4 minimum)
- `FileSystemTeamRepository` writes `~/.local/share/kilo/teams/<id>.json`.
- `mkdir -p` parent before write (Windows safety).
- Overwrite on collision (Phase 6 owns full UX — prompt/auto-suffix).

### Terminal branches
- Phase 3 pattern preserved: DOM branches production-ready, terminal branches stubbed with explicit Phase 5 TODO comment + Storybook DOM-only.
- No new OpenTUI primitive work in Phase 4. Phase 5 owns terminal table/picker rendering.

### Agent assignments rationale
- **Plan 04-01**: engineering-backend-architect (lead — Repository contract + Zod seam) + engineering-senior-developer (devil-ui hook + primitive impl). Reviewer: testing-qa-verification-specialist.
- **Plan 04-02**: engineering-frontend-developer (lead — SolidJS components) + design-ui-designer (table ergonomics + picker visuals). Reviewer: testing-qa-verification-specialist.
- **Plan 04-03**: engineering-frontend-developer (lead — view composition + integration) + engineering-senior-developer (state actions + commands wiring + integration tests). Reviewer: testing-qa-verification-specialist.
- ROADMAP-recommended UX Architect role folded into UI Designer (table ergonomics) and Senior Developer (validation feedback loop). Coordinator skipped — small phase, single divisional cluster (matches Phase 3 precedent).

## Open Items Carried From Spec
- **OQ-1**: `devil-ui → opencode/team` import edge introduced. Acceptable Phase 4; Phase 9 may extract shared types package if friction.
- **OQ-2**: StageCoverageIndicator blocks via disabled-button + tooltip (not modal). Less noisy.
- **OQ-3**: Save filename collision = silent overwrite + status-bar WARN. Phase 6 owns full UX.
- **OQ-4**: `/team build` (TUI) coexists with `/team init` (CLI). Both reach TeamBuilderView eventually.

## Plan Structure
- **Plan 04-01 (Wave 1)**: Foundations — TeamRepository + useTeamValidation hook + StageCoverageIndicator primitive
- **Plan 04-02 (Wave 2)**: Reusable Components — RosterTable + PositionPicker (devil-ui) + Storybook
- **Plan 04-03 (Wave 3)**: Composition — TeamBuilderProvider + view + commands + quickstart-loader + workflow-tui integration + integration tests
