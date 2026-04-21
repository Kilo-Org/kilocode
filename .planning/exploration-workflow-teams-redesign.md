# Exploration: Workflow Teams TUI Redesign

**Mode**: crystallize
**Created**: 2026-04-18
**User**: dasblueeyeddevil@gmail.com
**Status**: Crystallized — ready for `/legion:start`

---

## Raw Concept (verbatim)

> "The Workflow Teams section of this tool is severely lacking in intuitiveness and good UX. Instructions are unclear, flow is basically absent, interactable elements are limited at best. Please review opensource tools like Deepagents CLI and Opencode CLI to see how they handled their approach to TUI and workflows, then redesign my TUI."

Plus clarification during exploration:
> "Users must be able to build their 'team' in advance, assigning a provider & model to each team's 'positions' (architect, coordinator, senior developer, etc.). Then the workflow engages the different positions in a defined flow: architecture/planning first, then spec'ing/designing, then implementing."

---

## Crystallized Summary

**Devil Code Workflow Teams — Multi-Agent Team Orchestration TUI.** A persistent, shareable team-of-agents system where the user composes a team from a canonical semantic-role library (11 positions: Architect, Coordinator, Spec Writer, Senior Developer, Developer, Frontend Specialist, Backend Specialist, Reviewer, QA Tester, Release Engineer, Researcher), assigns provider+model+effort to each, and runs a fixed 7-stage workflow (`plan → challenge → contract → build → review → ship → retro`) that auto-dispatches each stage to the position whose canonical capability matches that stage's requirement. The TUI is the cockpit for both team-building AND runtime execution, with hybrid interaction model (footer action bar + `/` commands + Ctrl+K palette + `?` help) and progressive disclosure for first-run vs daily users.

---

## Scope Decisions

| Dimension | Decision |
| --- | --- |
| Redesign depth | **Full redesign from spec** (2+ weeks, higher risk accepted) |
| Interaction model | **Hybrid** — footer action bar with context actions + `/` slash-command autocomplete + Ctrl+K fuzzy command palette + `?` help overlay + Opencode-style leader key (Ctrl+X default) |
| Target user | **Both via progressive disclosure** — first-run: onboarding hints + explicit action buttons; after first successful workflow: compacts to power-user density; settings toggle |
| Purpose | **Multi-agent team orchestration + shareable team templates** |
| Team-builder home | **Inside Workflow Teams TUI** (primary) with `/team` CLI commands as scriptable secondary |
| Stage→position model | **Fixed stages, configurable positions** — stages declare required canonical capability, positions claim stages via capability tags |
| Legacy handling | **Replace 5 presets with canonical semantic-role library**; existing presets become quickstart templates that auto-fill the new position library |
| Canonical positions | **Full 11-position spectrum** (see detail below) |
| Capabilities | **Canonical enum + free-form supplementary tags** |
| Stage coverage | **Strict — all 7 stages must have ≥1 assigned position, else team invalid** |

---

## Canonical Position Library (11 positions)

| Position | Tier | Canonical capabilities (default) | Primary stages |
| --- | --- | --- | --- |
| Architect | 1 | planning, design, coordination | plan, challenge, contract |
| Coordinator | 1 | coordination | all (orchestrates) |
| Spec Writer | 2 | contract, design | contract |
| Senior Developer | 1 | implementation, design | build (complex tasks) |
| Developer | 2 | implementation | build |
| Frontend Specialist | 2 | implementation, ui, accessibility | build (UI/UX) |
| Backend Specialist | 2 | implementation, api, db | build (api/db) |
| Reviewer | 2 | review, risk-analysis | challenge, review |
| QA Tester | 2 | review, tests | review, ship |
| Release Engineer | 2 | release, ci | ship |
| Researcher | 3 | research, analysis, synthesis | any (support) |

**Capability system**: required canonical tags (`planning`, `design`, `contract`, `implementation`, `review`, `release`, `research`, `retro`) drawn from a Zod enum. Free-form supplementary tags allowed beyond the enum for domain-specific work. Each workflow stage declares which canonical tag it requires; team is considered valid only when every stage's required tag is claimed by ≥1 position.

**Note**: `retro` stage currently has no strong position match in the 11-position library — needs resolution during planning (options: add "Retro Scribe" position, assign to Coordinator, or let Architect own it).

---

## Interaction Model (Hybrid)

```
[Plan] [Activity] [Challenge] [Review] [AgentOutput]     ← keyboard-cycleable tabs
─────────────────────────────────────────────────────
 [main content area — task list, plan, challenge, etc.]

workflow>  _                                             ← primary input
─────────────────────────────────────────────────────
 [a] Approve   [r] Revise   [n] Next   [p] Paste spec   ← context-aware action bar
  /  commands   Ctrl+K palette   ?  help   esc  exit    ← discoverability hints
```

Patterns adopted:
- **From Opencode**: Ctrl+X leader key, Ctrl+K fuzzy command palette showing all commands + keybinds, prompt history (Up/Down), dynamically-enabled context-aware commands.
- **From Deepagents**: central command registry (`name`, `description`, `aliases`, `hidden_keywords`) for fuzzy match across `/slash`, Ctrl+K palette, and `?` help.
- **New**: explicit paste-mode separation (dedicated modal for phase spec input, so `workflow>` prompt is never overloaded with "paste a 500-line spec OR type `approve`").

---

## Knowns (What's Clear)

1. **Backend model is sufficient.** `TeamConfig` schema in `packages/opencode/src/devilcode/team/config.ts` already supports roles with `{displayName, provider, model, effort, tier, canDelegate, maxConcurrent, capabilities}`, plus routing (`strategy`, `defaultRole`, `parentRole`, `reviewEscalationRole`, `escalationEnabled`) and `ReactionRule[]`. No schema changes required for core redesign.
2. **Runtime glue exists.** `createWorkflowAgents()` (`team/agents.ts`) converts `TeamConfig.roles` → runtime `Agent.Info` records. Tier 1 positions become `primary` agents, tier 2+ become `subagent`.
3. **Stage machine exists.** `WorkflowStage = plan | challenge | contract | build | review | ship | retro` (`workflow/types.ts:3`). Routes, state, dispatch all wired up.
4. **Current TUI is small.** 8 files / ~600 LOC at `packages/opencode/src/devilcode/workflow-tui/`. Full replacement is feasible.
5. **Current commands exist but hidden.** 10+ commands (`back`, `status`, `pause`, `approve`, `revise`, `next`, `task <id>`, stage names) in `command-input.tsx:107-190` — zero discoverability from UI.
6. **Prior design doc exists** (not yet read): `docs/superpowers/specs/2026-04-06-workflow-tui-design.md` + `docs/superpowers/plans/2026-04-06-workflow-tui.md`.
7. **Rendering bug located**: `detail-panel.tsx:113-115` — `<text wrapMode="word" width="100%">` inside bordered box produces the mashed `PasteNphasetrequirements` header seen in screenshot. Fix as part of redesign.

---

## Unknowns (Resolution Path)

| # | Unknown | Resolution |
| --- | --- | --- |
| 1 | `retro` stage canonical position — library has 11, but no obvious retro owner | Planning phase: decide between (a) add 12th position "Retro Scribe", (b) assign to Coordinator, (c) let Architect own it |
| 2 | Team sharing mechanism — file export, URL, registry? | Design/spec phase: MVP = JSON file export/import; registry deferred |
| 3 | Migration — existing `TeamConfig`s from 5 current presets | Planning phase: write role-name mapping (lead→Senior Developer, research→Researcher, coder→Developer, reviewer→Reviewer, architect→Architect, frontend-dev→Frontend Specialist, backend-dev→Backend Specialist, release→Release Engineer, implementer→Developer, ci-fixer→Release Engineer, orchestrator→Coordinator, deep-researcher→Researcher, fast-scanner→Researcher) |
| 4 | OpenTUI palette/modal primitives — exist or build? | Planning phase: research `@opentui/solid` components; if absent, build minimal modal primitive in `packages/devil-ui/` |
| 5 | Prior 2026-04-06 spec — authoritative or superseded? | First planning task: read spec + plan, reconcile with this crystallization |
| 6 | `/team init` CLI — keep, rework, or deprecate? | Planning phase: likely keep as shortcut to launch TUI team-builder with interactive defaults |
| 7 | Config file format + location for teams | Planning phase: probably `~/.local/share/kilo/teams/<id>.json` for user teams + project-local `.planning/team.json` for project-specific override |

---

## Key Files for Planning

### To replace / heavily rework
- `packages/opencode/src/devilcode/workflow-tui/index.tsx` (23 LOC — entry point + escape keybind)
- `packages/opencode/src/devilcode/workflow-tui/command-input.tsx` (~200 LOC — overloaded input, bare commands)
- `packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx` (194 LOC — guide strings, rendering bug, tabs)
- `packages/opencode/src/devilcode/workflow-tui/status-bar.tsx` (invisible `/team init` hint)
- `packages/opencode/src/devilcode/workflow-tui/task-panel.tsx` (missing keyboard nav)
- `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx` (mouse-only tab switching)
- `packages/opencode/src/devilcode/workflow-tui/context.tsx` (state, may need team-build state added)
- `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts` (command dispatch, may need extending)

### To extend (not replace)
- `packages/opencode/src/devilcode/team/config.ts` — add canonical capability enum
- `packages/opencode/src/devilcode/team/presets.ts` — migrate to quickstart templates using new position library
- `packages/opencode/src/devilcode/team/agents.ts` — runtime glue (no changes expected)
- `packages/opencode/src/devilcode/team/router.ts` — stage→capability routing (may need extension)
- `packages/opencode/src/devilcode/workflow/routes.ts` — HTTP endpoints (may add team CRUD)

### To read first
- `docs/superpowers/specs/2026-04-06-workflow-tui-design.md`
- `docs/superpowers/plans/2026-04-06-workflow-tui.md`
- `packages/devil-docs/pages/automate/tools/team-command.md`
- `packages/devil-docs/pages/collaborate/teams/team-management.md`
- `packages/devil-docs/pages/code-with-ai/agents/team-workflow.md`

### New files likely needed
- `packages/opencode/src/devilcode/team/library.ts` — canonical 11-position library definitions
- `packages/opencode/src/devilcode/team/capabilities.ts` — canonical capability enum + stage→capability mapping
- `packages/opencode/src/devilcode/team/migration.ts` — old preset → new position mapping
- `packages/opencode/src/devilcode/workflow-tui/views/team-builder.tsx` — new team composition view
- `packages/opencode/src/devilcode/workflow-tui/views/position-picker.tsx` — position library browser
- `packages/opencode/src/devilcode/workflow-tui/components/command-palette.tsx` — Ctrl+K fuzzy palette
- `packages/opencode/src/devilcode/workflow-tui/components/help-overlay.tsx` — `?` keybind/command overlay
- `packages/opencode/src/devilcode/workflow-tui/components/action-bar.tsx` — context-aware footer
- `packages/opencode/src/devilcode/workflow-tui/components/paste-modal.tsx` — dedicated paste-mode

---

## Research Sources

**Codebase**:
- `packages/opencode/src/devilcode/team/config.ts` (Zod schemas)
- `packages/opencode/src/devilcode/team/presets.ts` (5 existing presets)
- `packages/opencode/src/devilcode/team/agents.ts` (runtime agent generation)
- `packages/opencode/src/devilcode/workflow/types.ts` (stage enum, PlanTask)
- `packages/opencode/src/devilcode/workflow-tui/*` (8 files)

**External**:
- [Deep Agents CLI docs](https://docs.langchain.com/oss/python/deepagents/cli/overview) — command registry, slash + palette + keybind pattern
- [deepagents GitHub](https://github.com/langchain-ai/deepagents)
- [OpenCode TUI docs](https://opencode.ai/docs/tui/) — leader key, Ctrl+K palette, prompt history
- [sst/opencode CLI commands DeepWiki](https://deepwiki.com/sst/opencode/6.1-command-line-interface-(cli))
- [OpenCode TUI theming & keybinds](https://deepwiki.com/sst/opencode/6.4-tui-theming-and-keybinds)

---

## Recommended Next Action

Run `/legion:start` with this crystallization pre-populated. Planning phase should:
1. Read the 2026-04-06 design spec + plan first, reconcile.
2. Resolve the 7 tracked unknowns.
3. Break work into phases: (a) canonical library + capability model + migration, (b) TUI scaffolding (command palette, help overlay, action bar, paste modal), (c) team-builder views, (d) runtime cockpit redesign, (e) sharing (export/import), (f) rendering-bug fix + keyboard nav polish, (g) docs + tests.

---

**Exchange count**: 5 (research + scope + clarifying + role library + decision)
**No open-ended questions issued.**
