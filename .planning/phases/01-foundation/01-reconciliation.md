# Plan 01-01 Reconciliation: Prior 2026-04-06 Workflow TUI Spec vs Phase 1 Foundation Spec

## Summary

The 2026-04-06 workflow-tui design spec (`docs/superpowers/specs/2026-04-06-workflow-tui-design.md`) and its companion plan (`docs/superpowers/plans/2026-04-06-workflow-tui.md`) describe a full TUI dashboard for driving the multi-model workflow engine through its 7 stages. That prior spec is a **Phase 3+ concern** — it specifies the interactive interface layered on top of the data model, not the data model itself. The current Phase 1 Foundation spec (`01-foundation-spec.md`) is focused exclusively on locking the canonical capability enum, stage→capability mapping, and the Zod schema types that underwrite every later phase. The two specs address orthogonal layers and do not structurally conflict. Where the prior spec makes concrete claims about workflow stages, role taxonomy, or command structure that are relevant to the capability model, those claims are enumerated below with their disposition.

---

## Claims Table

| # | Claim | Source (file:line) | Disposition | Rationale | New Location |
|---|-------|--------------------|-------------|-----------|--------------|
| 1 | Workflow stages are: `plan`, `challenge`, `contract`, `build`, `review`, `ship`, `retro` (7 stages) | workflow-tui-design.md:10, 196–211 | **Preserved** | Exactly matches `WorkflowStage` enum in `workflow/types.ts:3`. No discrepancy. | `packages/opencode/src/devilcode/workflow/types.ts:3` |
| 2 | The `challenge` stage is a distinct stage in the workflow (not merged with `plan`) | workflow-tui-design.md:10, command table line 146 | **Preserved** | Challenge maps to `planning` capability (shared with `plan`) per Phase 1 Key Decisions. The stage exists; the capability reuses `planning` to avoid enum bloat. | `STAGE_CAPABILITY_REQUIREMENTS.challenge = "planning"` in `team/capabilities.ts` |
| 3 | The `contract` stage exists between challenge and build | workflow-tui-design.md:command table line 148 | **Preserved** | Maps to `design` capability in Phase 1. Stage name unchanged. | `STAGE_CAPABILITY_REQUIREMENTS.contract = "design"` in `team/capabilities.ts` |
| 4 | The `retro` stage is the final stage after `ship` | workflow-tui-design.md:command table line 151 | **Preserved** | `retro → retrospective` mapping locked in Phase 1 Key Decisions. | `STAGE_CAPABILITY_REQUIREMENTS.retro = "retrospective"` in `team/capabilities.ts` |
| 5 | Route type: `WorkflowRoute = { type: "workflow"; initialAction?: "plan" \| "build" \| "review" }` | workflow-tui-design.md:22–25 | **Superseded** | Phase 1 does not touch TUI routing. Route definition is Phase 3 scope. Prior spec's `initialAction` is a narrow union; Phase 3 may broaden it. Defer to Phase 3 implementation. | Phase 3 context file |
| 6 | Entry via `/team` slash command and command palette | workflow-tui-design.md:30–64 | **Superseded** | Command registration is TUI/Phase 3 scope. Phase 1 establishes no commands. | Phase 3 context file |
| 7 | TUI dashboard component tree: `WorkflowView`, `WorkflowStatusBar`, `TaskPanel`, `DetailPanel`, `TabBar`, tab content components, `WorkflowCommandInput` | workflow-tui-design.md:69–85, workflow-tui.md:35–55 | **Superseded** | TUI component authoring is Phase 3+ scope. No component files are created in Phase 1. | Phase 3 context file |
| 8 | Status bar colors: `plan=cyan`, `challenge=yellow`, `build=green`, `review=orange`, `ship=blue`, `retro=purple` | workflow-tui-design.md:96, workflow-tui.md:130–145 | **Superseded** | TUI theming is Phase 3 scope. Colors are view layer, not data model. | Phase 3 context file |
| 9 | Task status icons: `✓` complete, `◐` in progress, `○` pending, `✗` failed, `↑` escalated, `◌` blocked | workflow-tui-design.md:121–122 | **Superseded** | View-layer constant; Phase 3 owns `workflow-tui/types.ts`. | Phase 3 context file |
| 10 | Command input accepts stage keywords: `plan`, `challenge`, `build`, `review`, `ship`, `retro`, `next`, `status`, `pause`, `approve`, `revise`, `back`, `task <id>` | workflow-tui-design.md:145–160 | **Superseded** | Command dispatch is Phase 3 scope. `WorkflowCommand` type lives in `workflow-tui/types.ts` (Phase 3). | Phase 3 context file |
| 11 | `approve` at `challenge` stage advances to `build`; `approve` at `contract` stage advances to `build`; `approve` at `review` stage advances to `ship` | workflow-tui-design.md:154, 159 | **Superseded** | Stage machine transitions are Phase 3 scope. Phase 1 does not encode transition rules beyond the static stage→capability map. Transition logic lives in `workflow/executor.ts` and `Workflow.advanceStage`. | Phase 3 context file |
| 12 | Responsive layout: `120+ cols` full, `80-119` task panel collapses to icons, `<80` task panel hidden | workflow-tui-design.md:165–168 | **Superseded** | TUI layout logic; Phase 3. | Phase 3 context file |
| 13 | Session architecture: root session (Opus/orchestrator), child sessions per stage, `rootSessionId` in STATE.md | workflow-tui-design.md:172–184 | **Superseded** | Session management is Phase 5+ scope. Phase 1 has no session concepts. | Phase 5 context file |
| 14 | BUILD: dispatches waves in parallel via `batch([task(...)])`, tasks write `SUMMARY.md`, max 2 challenge revision rounds | workflow-tui-design.md:195–204 | **Superseded** | Build execution is Phase 3/5 scope. Phase 1 encodes `build → implementation` mapping only. | Phase 3/5 context files |
| 15 | REVIEW: max 3 cycles, escalates to user if cycles exhausted | workflow-tui-design.md:204–206 | **Superseded** | Review lifecycle is Phase 3 scope. Phase 1 encodes `review → review` capability only. | Phase 3 context file |
| 16 | SHIP: runs final quality gates, persists ship report, updates ROADMAP.md | workflow-tui-design.md:207–210 | **Superseded** | Ship execution is Phase 3 scope. Phase 1 encodes `ship → release` capability only. | Phase 3 context file |
| 17 | New file layout under `packages/opencode/src/devilcode/workflow-tui/` (index.tsx, status-bar.tsx, task-panel.tsx, detail-panel.tsx, tabs/, command-input.tsx, orchestrator.ts, types.ts, context.tsx) | workflow-tui-design.md:232–249, workflow-tui.md:35–55 | **Superseded** | None of these files are created in Phase 1. Directory `workflow-tui/` is Phase 3 scope. | Phase 3 context file |
| 18 | Modified shared files: `context/route.tsx` (add WorkflowRoute to Route union), `app.tsx` (add WorkflowView to route switch), `kilo-commands.tsx` (register /team) | workflow-tui-design.md:257–263, workflow-tui.md:56–60 | **Superseded** | Route/command integration is Phase 3 scope. No shared files touched in Phase 1. | Phase 3 context file |
| 19 | `WorkflowContext` provider with `WorkflowViewState` interface (state, plans, challenge, review, activeSessions, executing, and action methods) | workflow-tui-design.md:267–291, workflow-tui.md:169–393 | **Superseded** | Context provider is Phase 3 scope. Phase 1 has no SolidJS components. | Phase 3 context file |
| 20 | `WorkflowOrchestrator` class bridges view to engine; uses `validateWaveIntegrity`, `detectFileConflicts`, `triageFindings`, `routeFix` | workflow-tui.md:1383–1471 | **Superseded** | Orchestrator bridge is Phase 3 scope. Referenced utilities (`executor.ts`, `reviewer.ts`) are already built; orchestrator wiring is Phase 3. | Phase 3 context file |
| 21 | Role colors in tab bar are tier-specific | workflow-tui-design.md:136 | **Superseded** | TUI theming; Phase 3. | Phase 3 context file |
| 22 | Free-text input in `plan` stage seeds phase context and dispatches planning | workflow-tui-design.md:160, 216–217 | **Superseded** | Command input handling; Phase 3. | Phase 3 context file |
| 23 | Error recovery: agent crash releases concurrency slot, session die resumes from STATE.md, rate-limit causes `blocked` status | workflow-tui-design.md:222–228 | **Superseded** | Runtime error handling; Phase 3/5. | Phase 3/5 context files |
| 24 | The workflow view IS the orchestrator — execution only while user is in the view | workflow-tui-design.md:15, 37 | **Superseded** | Execution lifecycle decision; Phase 3. Phase 1 has no runtime concept. | Phase 3 context file |
| 25 | The prior plan references `groupByWave` from `workflow/executor` | workflow-tui.md:484 | **Preserved** | `groupByWave` already exists in `workflow/executor.ts`. Phase 1 does not touch it. Relevant for Phase 3 task-panel component. | `packages/opencode/src/devilcode/workflow/executor.ts` (existing) |
| 26 | Roles are referred to with names like "orchestrator", "senior", "worker", "Codex", "Opus", "Kimi" | workflow-tui-design.md:91, 132, 188, 193, 195 | **Superseded** | Prior spec used informal names. Phase 1 locks a canonical 11-position library with formal `CanonicalPosition` IDs. The informal names are superseded by the canonical taxonomy. | `packages/opencode/src/devilcode/team/library.ts` (Phase 1 Plan 01-02) |
| 27 | No mention of `testing` or `research` capabilities in the prior spec | workflow-tui-design.md (entire doc), workflow-tui.md (entire doc) | **Noted — Additive** | Phase 1 adds `testing` and `research` to the canonical capability set. These are absent from the prior spec (which was TUI-focused and did not define a capability model). No conflict; the prior spec simply did not address capabilities at this level. | `CanonicalCapability` in `team/capabilities.ts` |

---

## Invariants Carried Forward

The following invariants are established by the prior spec and must be honored in Phase 1 and later phases:

- **7 workflow stages, fixed**: `plan | challenge | contract | build | review | ship | retro`. The prior spec treats these as the definitive stage set. Phase 1 must not add, remove, or rename stages. (Already honored: Phase 1 imports `WorkflowStage` from `workflow/types.ts` without modification.)

- **Stage independence**: Each stage can be triggered explicitly by the user (prior spec, command table). This implies the stage→capability mapping must treat each stage as independently meaningful — mapping two stages to the same capability (e.g., `plan` and `challenge` both map to `planning`) must not conflate the stages at runtime. The stage enum remains unchanged; only the capability requirement is shared. (Already honored in Phase 1 spec Key Decisions.)

- **`contract` stage exists and is user-visible**: The prior spec includes an `approve` command that explicitly transitions `challenge → contract → build`. Some workflows might skip `contract` in practice, but the stage must exist in the state machine. Phase 1 must ensure `STAGE_CAPABILITY_REQUIREMENTS` includes `contract`. (Already honored: `contract → design`.)

- **`retro` is the terminal stage**: No later spec should reorder retro to a non-terminal position without explicit user decision. This Phase 1 plan only encodes `retro → retrospective`; it does not define stage ordering or terminal state logic. That invariant must be preserved in Phase 3 when the state machine is wired to the TUI.

- **Project-persistent state lives in `.planning/`**: All workflow artifacts are on disk, not in memory. Phase 1 introduces no in-memory runtime; any runtime hydration from `.planning/` is Phase 3 scope.

---

## REQUIRES USER DECISION

**0 items. Plan 01-02 proceeds without gate.**

All conflicts between the prior 2026-04-06 spec and the current Phase 1 Foundation spec were trivially resolvable:

- The prior spec described a TUI component layer (Phase 3 scope); Phase 1 describes a data model layer. There is no overlap requiring user arbitration.
- Informal role names in the prior spec (orchestrator, senior, worker, Codex, Opus, Kimi) are superseded by the canonical position library — this is a naming rationalization, not a contradiction, and is resolved by adopting the canonical names.
- The `testing` and `research` capabilities introduced in Phase 1 are additive; the prior spec was silent on capabilities, so there is no contradiction to resolve.
- Stage colors for the TUI (claim #8) are deferred to Phase 3 with no impact on the Phase 1 data model.

---

## Recommendations for Later Phases

The following observations from the prior docs are relevant to Phase 3+ and should be pulled into those phases' context files:

**Phase 3 (TUI Scaffolding):**
- The prior spec's `WorkflowRoute` type uses `initialAction?: "plan" | "build" | "review"` — Phase 3 may want to widen this to `WorkflowStage` or keep the narrow union. Evaluate during Phase 3 design.
- Stage color scheme from prior spec (claim #8): `plan=cyan, challenge=yellow, build=green, review=orange, ship=blue, retro=magenta/purple`. Well-established in the prior spec; pull into `workflow-tui/types.ts` during Phase 3.
- `stageColor(stage: WorkflowStage): string` function already designed in `workflow-tui.md:130–145`. Ready to copy verbatim into Phase 3 `types.ts`.
- `taskStatusIcon` function designed in `workflow-tui.md:111–128`. Ready to copy verbatim.
- `WorkflowCommand` type and `WORKFLOW_COMMANDS` array designed in `workflow-tui.md:95–155`. The command list (`plan|challenge|build|review|ship|retro|next|status|pause|approve|revise|back`) should be carried into Phase 3 intact.
- `approve` semantics: at `challenge` stage → advances to `build`; at `contract` stage → advances to `build`; at `review` stage → advances to `ship`. This transition logic is in `workflow-tui.md:1037–1045`. Phase 3 must implement these transitions explicitly.
- `groupByWave` is already available in `workflow/executor.ts` — Phase 3 task panel imports it directly.
- Responsive breakpoints: 120+ cols full split, 80-119 task panel icons-only, <80 task panel hidden. Phase 3 must honor these.
- Error recovery patterns (claim #23): agent crash, session die, rate-limit backoff. Phase 3/5 must implement these.

**Phase 5 (Session Management):**
- Root session ID stored in `STATE.md` as `rootSessionId`. Phase 5 must preserve and restore this when re-entering the workflow view.
- Session architecture: one root session (Orchestrator), child sessions per wave/task. Phase 5 design should align with `workflow-tui-design.md:172–184`.
- `WorkflowOrchestrator` class in `workflow-tui.md:1383–1471` is a useful starting point for Phase 5's session bridge. Key methods: `validateBuild`, `getWaves`, `advanceStage`, `triageReview`, `getFixRouting`.

**All Phases:**
- The prior spec explicitly excludes VS Code extension integration, web UI, desktop app integration, and Phase C features (memory, retrospective scoring, agent registry). These exclusions are still valid and should not be reopened without explicit user decision.
