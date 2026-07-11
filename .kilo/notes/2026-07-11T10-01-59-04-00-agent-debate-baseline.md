# Agent Debate Baseline Checkpoint

- Timestamp: `2026-07-11T10:01:59-04:00`
- Branch: `sean/clean-kilo-source-glm-fix`
- HEAD at decision point: `9a4ff682df feat(shell): add explicit shell route prefixes`
- Purpose: preserve the current recommendation baseline before running a full multi-agent debate on productivity improvements.

## Baseline recommendation list

1. Add first-class runtime verification:
   - `kilo shell doctor`
   - `kilo permission explain --tool bash --command ...`
   - `kilo smoke shell-routes`
2. Add a structured shell field for terminal execution (`default`, `ps`, `cmd`, `bash`) while keeping prefixes as sugar.
3. Add a strict subagent output contract:
   - PASS / FAIL
   - files touched
   - commands run
   - exact blocker
   - scope adhered / violated
   - next safe action
4. Add a permission-rule explainer showing candidate matches and the final winning rule.
5. Improve write/edit ergonomics with safer structured patching.
6. Add missing specialist lanes:
   - `runtime-smoke`
   - `permission-auditor`
   - `config-doctor`
7. Add per-subagent model routing plus model health memory / fallback tracking.
8. Add new skills for:
   - shell routing
   - permission debugging
   - runtime doctoring
9. Prioritize infrastructure that reduces friction:
   - stable native edit/write support
   - reliable Windows shell availability (`pwsh`, `cmd`, real `bash`)
   - redacted doctor framework
   - runtime smoke harness
   - stable reviewer/debug model pairing
   - Windows CI coverage for shell/tool behavior

## Decision

We are intentionally pausing implementation of the baseline list above in order to run a full agent-debate / convergence experiment.

- If the debate produces materially better recommendations, we will adopt the improved list.
- If the debate does **not** improve the quality of the baseline recommendations, we will return to this checkpoint and implement the baseline list captured in this document.
