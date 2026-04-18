# Team Orchestrator

## What This Is

A full redesign of Devil Code's Workflow Teams TUI into a multi-agent team orchestration cockpit. Users compose a persistent, shareable team once — picking positions from a canonical 11-role library (Architect, Coordinator, Spec Writer, Senior Developer, Developer, Frontend Specialist, Backend Specialist, Reviewer, QA Tester, Release Engineer, Researcher) and assigning each a provider, model, and effort level. A fixed 7-stage workflow (`plan → challenge → contract → build → review → ship → retro`) then auto-dispatches each stage to the position whose canonical capability matches that stage's requirement. The TUI is the cockpit for both team-building and runtime execution.

## Core Value

Enforced workflow structure prevents the ad-hoc chaos of the current TUI. The fixed 7-stage flow guarantees every phase of work (plan, challenge, contract, build, review, ship, retro) runs through the right specialist with explicit handoffs and canonical capability matching. The team roster determines *who* executes each stage; the workflow determines *when* and *in what order*. Teams are portable JSON artifacts users can share, version, and trade like prompt libraries.

## Who It's For

Devil Code users spanning both ends of the experience spectrum, served through progressive disclosure:

- **First-run users** ("I just opened it, no idea what to do") — onboarding wizard, explicit action buttons, inline guidance, visible canonical position library, guided `/team init` flow inside the TUI.
- **Daily power users** — dense keybinds, fuzzy command palette (Ctrl+K), prompt history, keyboard-only tab navigation, minimal chrome that compacts after first successful workflow.
- **Team orchestrators / tech leads** — users who design team compositions deliberately (cost-tier mapping: cheap models for juniors, premium for architect decisions) and share templates across projects or team members.

## Requirements

### Validated
(None yet — ship to validate)

### Active

- Canonical 11-position library with Zod schema + canonical capability enum + free-form supplementary tags
- Stage → capability mapping for all 7 workflow stages; strict coverage validation (team invalid until every stage has ≥1 matching position)
- In-TUI team builder view: position picker browsing the canonical library, editable roster table (Position | Provider | Model | Effort | Delegates-to), save-as-custom-team, validation feedback with stage-coverage indicator
- Hybrid interaction model: footer action bar showing context-aware actions with single-key shortcuts; `/` slash-command autocomplete; Ctrl+K fuzzy command palette; `?` help overlay; Ctrl+X leader key; prompt history (Up/Down); keyboard-navigable tabs
- Runtime cockpit redesign: replace the existing 8 workflow-tui files; fix the `detail-panel.tsx:113-115` rendering bug; first-class onboarding in the detail panel (not engineer-comment-style `guide()` strings); separate paste-mode modal from the command input; visible live stage → position mapping indicator
- Progressive disclosure: first-run onboarding wizard; compacts to power-user density after first successful workflow; user-togglable density preference
- Team export/import to JSON files (`~/.local/share/kilo/teams/<id>.json` for user-level; `.planning/team.json` for project-local override; quickstart templates bundled as JSON)
- Migration from the 5 existing presets (Solo Enhanced, Code Review Pair, Full Stack Team, CI/CD Pipeline, Research Team) — old role names mapped to new canonical library positions
- Team registry / marketplace: remote team-template sharing via publish/subscribe flow (file-based MVP protocol, HTTP registry follow-up within v1)
- Fully configurable workflow DAG: users may reorder stages or override the stage → capability mapping per team; DAG integrity validation (no cycles, all stages covered)
- VS Code extension UI for team building: port the team-builder into `devil-vscode` webview reusing the Zod schema
- Telemetry dashboards for team performance: success rate, stall rate, per-position metrics — built on existing workflow event log
- Live team editing during active workflows: hot-swap positions mid-run with state reconciliation

### Out of Scope

None. User explicitly kept all proposed features in v1.

## Constraints

- **Clean break acceptable** — no backwards-compatibility requirement for existing `TeamConfig` files or `/team init` command. A one-time migration tool converts existing configs to the new schema; legacy code paths may be removed.
- **Scope is large** (4-6 weeks minimum estimate). Phase sequencing must sequence aggressively: foundation → TUI primitives → team-builder → cockpit → extensions (export/import, DAG, registry, VS Code UI, telemetry, live editing).
- **Fork hygiene**: all new code lives under `packages/opencode/src/devilcode/` or `packages/devil-*/`; no `devilcode_change` markers required in those paths. Shared-code edits (none expected) require markers per `bun run check-kilocode-change`.
- **Windows-safe process spawning**: any new spawn calls must go through `src/util/process.ts` (`windowsHide: true` guaranteed).
- **Existing backend model is sufficient** — `TeamConfig` schema (`team/config.ts`), `createWorkflowAgents()` runtime glue (`team/agents.ts`), and stage machine (`workflow/types.ts`) are compatible with the target design. Extensions only, no rewrites.
- **CI enforcement**: `bun turbo typecheck`, `bun run knip` (devil-vscode), `bun run format:check`, `bun run check-kilocode-change`, source-links check must all pass on every PR.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Crystallize via Polymath before planning | User's concept was initially vague ("redesign TUI"); exploration surfaced multi-agent team orchestration as the real target | Saved exploration to `.planning/exploration-workflow-teams-redesign.md`; 5 structured exchanges, zero open-ended questions |
| Full-repo codebase map vs. scoped | User chose full map to surface cross-package impacts (devil-vscode webview, devil-ui primitives) | Generated `.planning/CODEBASE.md` with 3,140 files, 11 package summary, risk areas, conventions |
| Hybrid interaction model (vs. command-first or menu-first) | Matches Opencode + Deepagents conventions while preserving discoverability for first-run users | Footer action bar + `/` + Ctrl+K + `?` + Ctrl+X leader |
| Full 11-position canonical library (vs. minimal 6 or role-per-stage) | Covers every stage specialty including frontend/backend split; user can omit or add | Architect, Coordinator, Spec Writer, Senior Developer, Developer, Frontend Specialist, Backend Specialist, Reviewer, QA Tester, Release Engineer, Researcher |
| Canonical capability enum + free-form supplementary tags | Required coverage validation works against enum; free-form allows domain tags without code churn | New `team/capabilities.ts` with canonical enum + optional free-form fields |
| Strict 7-stage coverage validation | Fail-fast semantics better for onboarding ("tell me what's missing") | Team invalid until every stage has ≥1 matching position |
| Clean break on backwards-compat | Reduces engineering cost, enables schema evolution; migration tool offsets upgrade friction | No legacy code paths; one-time migration from old presets |
| Nothing out of scope for v1 | User prioritizes feature breadth over speed-to-ship | Phases ordered to deliver MVP cockpit in Phase 5, then layer extensions |
| Deep-analysis planning depth + premium cost profile | Project complexity + risk area concentration justifies spec-first approach with premium models | Each phase produces a design doc or ADR before implementation |

## Architecture Influences

- **Backend model locked**: `TeamConfig` (Zod schemas in `packages/opencode/src/devilcode/team/config.ts`) already supports roles with `{displayName, provider, model, effort, tier, canDelegate, maxConcurrent, capabilities}` + routing (`strategy`, `defaultRole`, `parentRole`, `reviewEscalationRole`, `escalationEnabled`) + `ReactionRule[]`. Extensions: add canonical capability enum, optional stage-override field for DAG configurability.
- **Runtime glue exists**: `createWorkflowAgents()` in `team/agents.ts` converts roles → `Agent.Info` records (tier 1 → `primary`, tier 2+ → `subagent`). No changes expected.
- **Stage machine locked**: `WorkflowStage = plan | challenge | contract | build | review | ship | retro` in `workflow/types.ts:3`. DAG configurability layers on top without changing the enum.
- **Target TUI**: 8 files / ~600 LOC at `packages/opencode/src/devilcode/workflow-tui/` — full replacement, not incremental refactor.
- **New files**: `team/library.ts` (11-position canonical library), `team/capabilities.ts` (canonical enum + stage→capability mapping), `team/migration.ts` (old preset migration), `team/registry.ts` (sharing protocol), `workflow-tui/views/team-builder.tsx`, `workflow-tui/views/position-picker.tsx`, `workflow-tui/components/command-palette.tsx`, `workflow-tui/components/help-overlay.tsx`, `workflow-tui/components/action-bar.tsx`, `workflow-tui/components/paste-modal.tsx`, plus mirror UI in `packages/devil-vscode/webview-ui/` for the extension port.
- **OpenTUI primitives**: research needed during Phase 3 — if `@opentui/solid` lacks a modal/palette primitive, build one as a first-class component in `packages/devil-ui/` usable by both TUI and VS Code webview.
- **Prior design doc**: `docs/superpowers/specs/2026-04-06-workflow-tui-design.md` + `docs/superpowers/plans/2026-04-06-workflow-tui.md` — must be read in Phase 1 and reconciled against this new spec.
- **Rendering bug**: `detail-panel.tsx:113-115` — `<text wrapMode="word" width="100%">` inside bordered box produces the mashed `PasteNphasetrequirements` header. Fix as part of Phase 5.

---
*Last updated: 2026-04-18 after initialization*
