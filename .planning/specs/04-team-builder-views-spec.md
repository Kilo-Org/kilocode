# Spec: Phase 4 — Team Builder Views

**Status:** Draft → Critiqued → Assessed
**Created:** 2026-04-19
**Architecture:** Clean (devil-ui split + TeamRepository seam)
**Source:** ROADMAP.md Phase 4 (no REQUIREMENTS.md — between milestones)

---

## Overview

Phase 4 ships the in-TUI team-building experience on top of the foundation locked in Phases 1–3. Users browse the canonical 11-position library via a fuzzy `PositionPicker`, edit a 6-column roster table (`Position | Provider | Model | Effort | Delegates-to | Capabilities`), watch a `StageCoverageIndicator` block workflow start until all 7 stages have a matching capability, save the result to `~/.local/share/kilo/teams/<id>.json`, and load any of the 5 bundled quickstart templates. Phase 5 (cockpit redesign), Phase 6 (full persistence), Phase 7 (DAG override), and Phase 9 (VS Code Agent Manager) all extend this Phase 4 surface — Clean architecture (TeamRepository seam + reusable `devil-ui` components + `useTeamValidation` hook) is chosen so those later phases extend rather than rewrite.

## Requirements

| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| P4-R1 | In-TUI team builder view | Must | TeamBuilderView renders inside workflow-tui provider tree; user can browse PositionPicker, edit RosterTable rows (Position/Provider/Model/Effort/Delegates-to/Capabilities), save via `/team save <id>`, load via `/team load-quickstart <id>` |
| P4-R2 | Strict 7-stage coverage validation | Must | `useTeamValidation()` returns `{ isValid: boolean, missingStages: WorkflowStage[], errors: ZodIssue[] }`; `StageCoverageIndicator` highlights missing stages red; `startBuild()` refuses to dispatch when `isValid === false`; CanonicalTeamConfig.parse runs with `enabled=true` so existing `superRefine` stage-coverage check fires |

## Architecture

### Layered structure

```
opencode/workflow-tui/views/         ← TUI-specific composition layer
  team-builder-view.tsx              ← Root view (route registered in index.tsx)
  team-builder-context.tsx           ← TeamBuilderProvider + useTeamBuilder
  team-builder-commands.ts           ← Registers /team save, /team load-quickstart, /team validate, /team build
  quickstart-loader.tsx              ← Modal listing 5 templates

devil-ui/components/                 ← Framework-agnostic, reusable in Phase 9 webview
  roster-table.tsx                   ← 6-column editable grid
  position-picker.tsx                ← Fuzzy picker over POSITION_LIBRARY

devil-ui/primitives/
  stage-coverage-indicator/          ← 7-stage indicator (DOM + terminal stub)

devil-ui/hooks/
  use-team-validation.tsx            ← Zod-driven validation hook (no TUI deps)

opencode/team/
  repository.ts                      ← TeamRepository interface + FileSystemTeamRepository impl
```

### Data flow

```
User action (keybind/command)
  → TeamBuilderProvider store mutation
  → CanonicalTeamConfig draft updated
  → useTeamValidation re-runs (Zod parse with enabled=true)
  → StageCoverageIndicator + RosterTable re-render
  → On save: TeamRepository.saveTeam(id, config) → fs writeFile
  → On startBuild: WorkflowProvider.startBuild(config) — refuses if !isValid
```

### Key Decisions

| # | Decision | Choice | Rationale | Alternatives Considered |
|---|----------|--------|-----------|-------------------------|
| 1 | State management for builder | Separate `TeamBuilderProvider` (sibling to WorkflowProvider, NOT nested) | Phase 5 cockpit redesign should not destabilize builder; isolation reduces blast radius | Nested in WorkflowViewState (rejected: Phase 5 will heavily mutate WorkflowViewState) |
| 2 | Persistence boundary | `TeamRepository` interface in `team/repository.ts`, `FileSystemTeamRepository` impl Phase 4, swappable Phase 6 | Phase 6 owns full override-precedence; clean seam means Phase 6 ships an additional impl, not a rewrite | Direct `fs/promises` calls (rejected: Phase 6 would need to refactor view code) |
| 3 | Component placement | RosterTable + PositionPicker + StageCoverageIndicator + useTeamValidation live in `devil-ui` (not `workflow-tui`) | Phase 9 VS Code Agent Manager imports them unchanged. Phase 3 set the same precedent (CommandPalette/HelpOverlay/FooterBar/PasteModal in devil-ui). | All in workflow-tui (rejected: Phase 9 would need to duplicate or extract — net more work) |
| 4 | Validation logic | `useTeamValidation(config)` hook calls `CanonicalTeamConfig.parse({ ...config, enabled: true })` then surfaces ZodIssues per row + missing stages | Reuses existing `superRefine` stage-coverage validator from `team/config.ts` (zero new validation logic). Phase 7 extends by passing DAG override through same hook. | New custom validator (rejected: drift risk vs Zod source-of-truth) |
| 5 | Position picker UX | Reuse Phase 3 `CommandPalette` primitive's fuzzy infrastructure (fuzzysort) inside a dedicated PositionPicker component | Avoids duplicating fuzzy-search code; leverages already-tested matcher | Build new picker from scratch (rejected: rebuild already-working code) |
| 6 | Save on Windows | `mkdir -p` parent directory via `fs.promises.mkdir(dir, { recursive: true })` before `writeFile` | Prevents ENOENT on first save when `~/.local/share/kilo/teams/` does not exist; works on both POSIX and Windows | Assume directory exists (rejected: first-run users break) |
| 7 | Tests | Bun native runner only; integration test for build → validate → save → reload round-trip; unit tests for hook + repository + components (DOM branch) | Project convention; no @solidjs/testing-library available (Phase 3 lesson) | Add testing-library (rejected: out of scope, Phase 3 already worked around) |
| 8 | Terminal branches for new primitives | Stub with explicit Phase 5 TODO (mirrors Phase 3 pattern); ship DOM branches production-ready for Storybook | Phase 5 owns terminal polish; OpenTUI has `<select-list>` etc but full table/picker rendering is Phase 5 work | Build full terminal branches now (rejected: Phase 5 will rewrite when cockpit lands) |

## Deliverables

### TeamRepository
- **Path:** `packages/opencode/src/devilcode/team/repository.ts`
- **Purpose:** Persistence seam; Phase 6 ships additional implementations (project-local override, registry-fetch)
- **Key Content:**
  - `interface TeamRepository { listTeams(): Promise<TeamHandle[]>; loadTeam(id: string): Promise<CanonicalTeamConfig>; saveTeam(id: string, config: CanonicalTeamConfig): Promise<TeamHandle>; deleteTeam(id: string): Promise<void> }`
  - `type TeamHandle = { id: string; name: string; path: string; updatedAt: string }`
  - `createFileSystemTeamRepository(rootDir?: string): TeamRepository` — defaults to `path.join(os.homedir(), ".local/share/kilo/teams")`; uses `mkdir -p` before write; validates schema on load via `CanonicalTeamConfig.parse({ ...raw, enabled: true })`
- **Dependencies:** `team/config.ts` (CanonicalTeamConfig)
- **Estimated Size:** ~120 LOC + ~150 LOC tests

### useTeamValidation hook
- **Path:** `packages/devil-ui/src/hooks/use-team-validation.tsx`
- **Purpose:** Reactive validation Phase 9 webview can consume directly
- **Key Content:**
  - `useTeamValidation(config: Accessor<Partial<CanonicalTeamConfig>>): Accessor<ValidationResult>` where `ValidationResult = { isValid: boolean; missingStages: WorkflowStage[]; errorsByRole: Record<string, ZodIssue[]>; rawErrors: ZodIssue[] }`
  - Internally: `CanonicalTeamConfig.safeParse({ ...config(), enabled: true })`; flattens issues by `path[1]` (role key); derives `missingStages` from the stage-coverage error message via regex match (single source-of-truth)
  - Re-export from `packages/devil-ui/src/hooks/index.ts`
- **Dependencies:** `team/config.ts`, `team/capabilities.ts`, `workflow/types.ts` (WorkflowStage)
- **Estimated Size:** ~80 LOC + ~100 LOC tests
- **Path Override:** true — devil-ui must depend on team package types; this introduces a new edge in the dep graph (`devil-ui → opencode/team`). See Open Question 1.

### RosterTable component
- **Path:** `packages/devil-ui/src/components/roster-table.tsx`
- **Purpose:** 6-column editable team roster
- **Key Content:**
  - Props: `{ roles: Record<CanonicalPosition, CanonicalTeamRole>; errorsByRole: Record<string, ZodIssue[]>; onEdit(positionId, field, value); onDelete(positionId); onAdd(positionId) }`
  - Columns: Position | Provider | Model | Effort | Delegates-to | Capabilities
  - Row click → focused edit mode (DOM: native inputs; terminal: stub w/ Phase 5 TODO)
  - Highlights row red when `errorsByRole[positionId]` non-empty; cell tooltip shows ZodIssue message
  - Storybook story: 5 quickstarts × DOM branch
- **Dependencies:** `team/library.ts` (POSITION_LIBRARY for column constraints), `team/config.ts` (types)
- **Estimated Size:** ~200 LOC + ~120 LOC tests + 1 Storybook file

### PositionPicker component
- **Path:** `packages/devil-ui/src/components/position-picker.tsx`
- **Purpose:** Fuzzy search over POSITION_LIBRARY (11 entries)
- **Key Content:**
  - Props: `{ open: boolean; excludeIds?: CanonicalPosition[]; onSelect(positionId); onClose() }`
  - Internally uses `fuzzysort` (already in devil-keybind deps via Phase 3)
  - Shows displayName + description + primaryCapability + canonicalCapabilities chips
  - Storybook stories: Open / Closed / WithExclusions
- **Dependencies:** `team/library.ts`
- **Estimated Size:** ~150 LOC + ~80 LOC tests + 1 Storybook file

### StageCoverageIndicator primitive
- **Path:** `packages/devil-ui/src/primitives/stage-coverage-indicator/index.tsx`
- **Purpose:** Visual 7-stage indicator
- **Key Content:**
  - Props: `{ missingStages: WorkflowStage[]; allStages?: WorkflowStage[] }` (defaults to `WorkflowStage.options`)
  - Renders 7 stage chips inline; missing stages get red background + ❌ icon; covered stages get green + ✓
  - Compact mode (single line, narrow terminals)
  - Storybook stories: Complete / 1Missing / AllMissing / Compact
- **Dependencies:** `workflow/types.ts` (WorkflowStage)
- **Estimated Size:** ~90 LOC + ~60 LOC tests + 1 Storybook file

### TeamBuilderProvider + view
- **Path 1:** `packages/opencode/src/devilcode/workflow-tui/views/team-builder-context.tsx`
- **Path 2:** `packages/opencode/src/devilcode/workflow-tui/views/team-builder-view.tsx`
- **Purpose:** Compose devil-ui components into a TUI-renderable team-builder
- **Key Content (context.tsx):**
  - `TeamBuilderProvider` with createStore: `{ draft: Partial<CanonicalTeamConfig>; selectedRole: CanonicalPosition | null; pickerOpen: boolean; saveStatus: "idle"|"saving"|"saved"|"error"; loadedQuickstart: QuickstartId | null }`
  - Actions: `addRole(positionId)`, `removeRole(positionId)`, `editRole(positionId, field, value)`, `loadQuickstart(id)`, `save(teamId)`, `validateAndStartBuild()`
  - Injects `TeamRepository` via prop (default `createFileSystemTeamRepository()` — overridable for tests)
- **Key Content (view.tsx):**
  - Header: team name input + save status
  - Body: `<RosterTable>` + `<PositionPicker open={...}>`
  - Footer: `<StageCoverageIndicator>` + Start-Workflow button (disabled if !isValid)
  - Wraps TeamBuilderProvider over devil-ui components
- **Dependencies:** All devil-ui deliverables above + TeamRepository + workflow-tui context
- **Estimated Size:** ~80 LOC context + ~150 LOC view + ~120 LOC integration tests

### team-builder-commands + quickstart-loader
- **Path 1:** `packages/opencode/src/devilcode/workflow-tui/views/team-builder-commands.ts`
- **Path 2:** `packages/opencode/src/devilcode/workflow-tui/views/quickstart-loader.tsx`
- **Purpose:** Wire `/team save`, `/team load-quickstart`, `/team validate`, `/team build` into CommandRegistry; render quickstart selector modal
- **Key Content:**
  - Exports `registerTeamBuilderCommands(registry, teamBuilder)` returning unregister fn
  - Quickstart-loader is a `<Show>`-gated modal triggered by `/team load-quickstart` with no args
- **Dependencies:** Phase 3 CommandRegistry, `team/quickstarts/index.ts`
- **Estimated Size:** ~80 LOC commands + ~100 LOC quickstart-loader + ~80 LOC tests

### Workflow-tui integration changes
- **Path:** `packages/opencode/src/devilcode/workflow-tui/index.tsx` (modify)
- **Purpose:** Mount TeamBuilderProvider + view conditionally; preserve Phase 3 provider tree
- **Key Content:** Add new tab `"Team"` to existing tabs OR add a route gate; minimal change — wrap `WorkflowViewInner` body in a `<Switch>` between team-builder and existing detail panel
- **Dependencies:** All Phase 4 deliverables
- **Estimated Size:** ~25 LOC delta

## Path Validation

**Status:** All paths follow Phase 3 precedent + project conventions. One override flagged.

| Deliverable | Path | Category | Valid | Notes |
|-------------|------|----------|-------|-------|
| TeamRepository | `packages/opencode/src/devilcode/team/repository.ts` | services | ✓ | Mirrors `team/agents.ts`, `team/migration.ts` |
| useTeamValidation | `packages/devil-ui/src/hooks/use-team-validation.tsx` | hooks | ✓ | Mirrors Phase 3 `use-command-registry.tsx` |
| RosterTable | `packages/devil-ui/src/components/roster-table.tsx` | components | ✓ override | devil-ui has `components/` (40+ existing); see OQ-1 |
| PositionPicker | `packages/devil-ui/src/components/position-picker.tsx` | components | ✓ override | Same as above |
| StageCoverageIndicator | `packages/devil-ui/src/primitives/stage-coverage-indicator/` | primitives | ✓ | Phase 3 primitives precedent |
| TeamBuilderProvider | `packages/opencode/src/devilcode/workflow-tui/views/` | views | ✓ | Per PROJECT.md Architecture Influences |
| team-builder-view | `packages/opencode/src/devilcode/workflow-tui/views/` | views | ✓ | Same |
| commands + quickstart-loader | `packages/opencode/src/devilcode/workflow-tui/views/` | views | ✓ | Same |

### Override notes
- **OQ-1 (Components in devil-ui):** Use `components/` over `primitives/` because RosterTable + PositionPicker are domain-specific (team-shaped) — not generic primitives. `primitives/` reserved for cross-domain interaction surfaces (CommandPalette, PasteModal). StageCoverageIndicator is borderline; placed in `primitives/` since it's a pure visual indicator with no team semantics beyond stage names.

## Open Questions

| # | Question | Impact | Default if Unresolved |
|---|----------|--------|-----------------------|
| 1 | Should `devil-ui` depend on `@devilcode/cli`/`opencode` for `team/` types, or should team types move to a shared package? | Deferrable | Phase 4 ships with `devil-ui → opencode/team` import (deep-path import similar to Phase 3 `adapters/terminal`). Phase 9 may extract to shared types package if friction surfaces. |
| 2 | Should the StageCoverageIndicator block startBuild via dialog or silent button-disabled? | Deferrable | Button-disabled + tooltip showing missing stages. Less noisy than modal. |
| 3 | Save filename collision: `<id>.json` already exists — overwrite, prompt, or auto-suffix? | Deferrable | Phase 4 ships overwrite (Phase 6 owns full UX); save command prints WARN to status bar on overwrite |
| 4 | Where does Phase 4 register the `/team build` route from workflow-tui (vs the existing `/team init` Bun CLI command shipped Phase 2)? | Deferrable | Phase 4 adds `/team build` as a TUI-only command (CommandRegistry); Phase 2 `/team init` continues to launch from CLI. Both eventually reach the same TeamBuilderView. |

## Complexity Assessment

**Rating:** Medium-Complex

| Metric | Value |
|--------|-------|
| Requirements | 2 (P4-R1, P4-R2) |
| Deliverables | 9 (8 new files, 1 modified) |
| Estimated waves | 3 |
| Estimated plans | 3 (matches ROADMAP estimate) |
| Estimated LOC | ~1,300 source + ~700 tests |
| Competing proposals | Recommended (already executed: Clean approved) |

**Rationale:** Two requirements but six concrete success criteria with cross-package implications (opencode/team + devil-ui + workflow-tui). Architectural choice (Clean) matters for Phase 5/6/9 zero-rework. Three waves emerge naturally from dep ordering (abstractions → reusable components → composition + persistence).

**Recommended next step:** Run `/legion:plan 4 --auto-refine` (already executing) — proceed to phase decomposition.

## Revision History
| # | Section | Change | Reason |
|---|---------|--------|--------|
| 1 | Architecture | Renamed `useQuickstarts` hook → folded into TeamBuilderProvider actions | Critique: hook would only have one consumer (TeamBuilderProvider); inline simpler |
| 2 | Deliverables | Split `team-builder.tsx` into `view.tsx` + `context.tsx` + `commands.ts` | Critique: single-file would exceed 500-line risk threshold per CODEBASE.md |
| 3 | Open Questions | Added OQ-3 (filename collision) and OQ-4 (`/team build` vs `/team init` boundary) | Critique: assumption hunt surfaced both as deferrable but unresolved |
| 4 | Path Validation | Marked components/ override with rationale | Critique: pre-empt path validation challenge in critique cycle |
