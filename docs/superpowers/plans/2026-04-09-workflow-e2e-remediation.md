# Workflow E2E Remediation Plan

**Date:** 2026-04-09
**Owner:** CLI workflow TUI
**Status:** Proposed

## Goal

Turn `/team` from a mostly presentational dashboard into a guided, stateful workflow surface that is honest about what works, interactive at every stage, and testable end to end.

## Problem Summary

The current workflow implementation has four systemic issues:

1. Stage execution is incomplete. `ship`, `retro`, and `pause` do not perform the behaviors the UI and docs promise.
2. Workflow state is not reflected back into the UI. Task progress, activity, and challenge artifacts are missing or dead.
3. Guidance is fragmented and misleading. First-run onboarding, command semantics, and stage-specific next steps are inconsistent across the TUI, docs, and spec.
4. There is no TUI-focused end-to-end coverage, so regressions are easy to ship.

## Findings To Resolve

### F1. Build progress is not actually represented in workflow state

- `TaskPanel` reads `wf.state.activeTasks` for progress and task status.
- `startBuild()` only updates `activeSessions`, not `state.activeTasks`, `activeWave`, or `totalWaves`.
- Result: the left panel cannot reliably show running or completed work.

### F2. `pause` is a UI-only flag

- The command says "Paused after current wave".
- The implementation only flips `executing` in the local store.
- Result: users are told they can intervene, but no execution control exists.

### F3. `ship` and `retro` are stage labels, not operational stages

- The command path short-circuits both stages without orchestrator work.
- Quality gates currently run inside review.
- Result: the lifecycle is incomplete and the docs describe behavior that does not exist.

### F4. Challenge and activity visibility are broken

- `Activity` is created as a tab but not rendered by the detail panel.
- Challenge results are returned by the orchestrator but are neither persisted nor reloaded.
- Result: the dashboard loses key artifacts that users need for trust and recovery.

### F5. Selected tasks do not have a real detail view

- The docs describe a task detail pane with files, dependencies, and verification commands.
- The actual detail panel only renders agent output or artifact tabs.
- Result: task selection provides little value before a build starts and limited value during execution.

### F6. Guidance and documentation drift from the implementation

- Fresh workflow instructions still point users at commands that are not the real happy path.
- The spec and user docs describe free-text guidance at any stage, retry flows, auto-resume, rich task details, and ship/retro behaviors that are not implemented.
- Result: the workflow feels ambiguous even when the underlying state machine is valid.

### F7. Test coverage is concentrated in state/helpers, not the TUI command flow

- Current tests cover workflow helpers and state files.
- There is no focused coverage for command routing, stage execution semantics, or tab visibility in the workflow TUI.

## Remediation Phases

## Phase 1: Make The Lifecycle Honest

**Objective:** remove fake behavior and wire the missing stage semantics.

- Implement explicit orchestrator handlers for `ship` and `retro`.
- Move quality gates to the stage that the product intends to own them, then keep docs and copy aligned with that choice.
- Replace the current `pause()` stub with a real build-runner pause/resume mechanism, or remove the command until it is real.
- Centralize command semantics for `next`, `approve`, and `revise` so they are not hand-coded in the input component.

**Acceptance criteria**

- `ship` performs observable work and produces a persisted artifact or event trail.
- `retro` persists lessons or other retrospective output.
- `pause` either controls execution correctly or is no longer offered.
- Command copy matches runtime behavior.

## Phase 2: Make State Observable

**Objective:** ensure the dashboard reflects the workflow engine instead of only local component state.

- Persist active wave and task status transitions during build execution.
- Add challenge artifact persistence and reload support beside the existing plan/review artifacts.
- Render the existing `ActivityTab`.
- Add a dedicated task detail surface for selected tasks, including files, dependencies, verification, and summary output.

**Acceptance criteria**

- Task panel progress updates during execution and after resume.
- Challenge results survive leaving and re-entering the workflow view.
- Activity is visible from the tab bar.
- Selecting a task always reveals useful structured detail, even before an agent tab exists.

## Phase 3: Add Guided UX

**Objective:** make the first-run and stage-to-stage flow self-explanatory.

- Add a first-run onboarding state that asks for phase requirements instead of assuming command literacy.
- Add stage-specific prompt hints and inline "what happens next" copy.
- Surface blocking preflight failures, challenge verdicts, review blockers, and ship readiness in the main pane instead of only toasts.
- Add explicit empty-state messaging for each stage artifact.

**Acceptance criteria**

- A new user can get from `/team init` to a plan without knowing any workflow commands.
- The UI explains why a command is unavailable and what input is expected next.
- The main pane, not just transient toasts, tells the user what to do.

## Phase 4: Reconcile Spec, Docs, And Tests

**Objective:** stop shipping drift.

- Update `/team` docs and the broader team workflow docs to match the actual lifecycle and interaction model.
- Update or replace the original workflow TUI design spec where it no longer matches the product.
- Add TUI-focused tests for:
  - fresh workflow onboarding
  - command routing for `next`, `approve`, `revise`
  - activity/challenge/review tab visibility
  - build progress state updates
  - ship/retro execution
  - pause semantics

**Acceptance criteria**

- No user-facing doc describes a flow that the CLI cannot execute.
- Workflow TUI regressions are covered by automated tests.

## Recommended Implementation Order

1. State and lifecycle correctness
2. Artifact persistence and visibility
3. Guided UX
4. Docs and test hardening

This order matters. Improving copy before fixing state and stage semantics will make the dashboard feel more polished while staying misleading.

## Validation Checklist

- Run: `bun test test/kilocode/workflow/ test/kilocode/team/` from `packages/opencode`
- Add new workflow TUI tests and run them in the same suite
- Run: `bunx tsgo --noEmit` from `packages/opencode`
- Manually verify:
  - `/team init`
  - first-run planning input
  - challenge artifact visibility
  - build progress updates
  - pause/resume behavior
  - review findings
  - ship and retro outputs

## Non-Goals

- VS Code workflow dashboard parity
- New orchestration features beyond the documented seven-stage lifecycle
- Broader redesign of team routing, concurrency, or model selection outside what workflow correctness requires
