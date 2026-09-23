# Kilo Autonomous Goal Engine – Implementation Plan

## 1. Goal

Extend Kilo's `/goal` into an autonomous hierarchical coding system. The user gives a high-level objective and the engine:

1. interprets the goal and inspects the repository;
2. derives acceptance criteria and a dependency-aware task DAG;
3. routes reasoning/architecture work to a cloud model and well-defined implementation to local models;
4. runs tests, linters and type checks automatically;
5. reviews every change with a separate read-only reviewer;
6. repairs failures locally, escalates repeated failures to the cloud model;
7. re-checks the original goal, plans missing work, and finishes only after final verification;
8. tracks local/cloud usage and cost and pauses when a budget is exceeded.

Target workflow:

```text
/goal "Implement offline map downloads with persistent regions"
```

## 2. Core principle

Cloud models spend tokens on reasoning. Local models spend tokens on implementation.

```text
USER → Engine → Planner (cloud) → Task DAG
  → Worker (local) → Mechanical checks → Reviewer (local, read-only)
      PASS → Goal checker → (replan | Final review → DONE)
      FAIL → Repair (local, max N) → Escalation (cloud) → back to checks
```

## 3. Non-goals (MVP)

- No redesign of Kilo's agent architecture; reuse existing sessions, agents, permissions.
- No parallel workers, no worktrees, no distributed execution.
- No autonomous deploy/push/publish. Workspace edits are autonomous; everything else is denied or asks.
- No ML router. Deterministic rules only.
- No recursive agent spawning by workers.

## 4. What already exists (reuse, do not rebuild)

All paths under `packages/opencode/src` unless noted.

| Need | Existing building block |
|---|---|
| `/goal` command, pause/resume/clear, TUI row, VS Code dock | `kilocode/session/goal/{state,runner,policy,tool,instructions}.ts`, dispatch at `session/prompt.ts:2314`, `kilocode/cli/cmd/tui/component/goal.tsx`. Status persisted in `session.metadata["kilo.goal"] = {text,status,active,reason}` and synced to all UIs. |
| Child session with chosen agent, model, permissions | Task tool path: `Session.create({parentID, agent, permission})` → `SessionPrompt.prompt({agent, model, parts})` → `SessionDrain.wait` (`tool/task.ts:224-301`). |
| Schema-validated LLM output | `PromptInput.format = {type:"json_schema", schema}` → `info.structured` (`session/prompt.ts:1781-1897`). `retryCount` is unused, so the caller retries. |
| Agent registry, read-only rulesets | `patchAgents` in `kilocode/agent/index.ts:481`; `readOnlyBash`, `explore`/`ask` agents. Agents must be registered by name. |
| Unattended permission handling | `KiloHeadless.mark(rootID)` fails any `ask` immediately (`kilocode/permission/headless.ts`). `subagent_depth` (default 1) blocks recursive spawning. |
| Persistence of JSON documents | `Storage.Service` `read/write/update/remove` (`storage/storage.ts:53`), pattern in `kilocode/wakeup/index.ts`. |
| Token/cost per call | `SessionV1.Assistant.cost/tokens`; pricing from `Provider.Model.cost` (USD per 1M tokens). |
| Config | Kilo keys in `packages/core/src/v1/config/config.ts` inside the `kilocode_change` block (~line 117); regenerate SDK with `./script/generate.ts` from repo root. |
| Model resolution | `Provider.parseModel`, `defaultModel`, `getSmallModel`; config `model`, `small_model`, `subagent_model`. |
| Tests | `test/kilocode/session/goal.test.ts` template: `LayerNode.compile`, `TestLLMServer`, `reply().tool(...)`, `it.instance`. Run from `packages/opencode/`. |

Not existing: plan/task model, DAG scheduler, router, mechanical checks, independent reviewer, repair/escalation, budget, local-provider detection.

## 5. Design decisions

1. **One execution primitive.** Planner, worker, reviewer and goal checker are all "run a child session with agent X, model Y, permissions Z, JSON schema S, retry N on invalid output". One helper, four prompts.
2. **Engine beside the existing loop, gated by config.** `autonomous_goal.enabled` (default `false`). When enabled `/goal` dispatches to the engine; the existing loop is untouched and its tests stay green.
3. **Model classes are config, not detection.** `local-small`, `local-coder`, `cloud-reasoner` map to `provider/model` strings in config, with fallbacks `small_model` → `subagent_model` → `model` → default. No model IDs in code.
4. **Stuck detection lives in the repair package.** Failure fingerprint (normalized first error line + failing test names) plus attempt counter. No separate module for MVP.
5. **Event log lives in the persisted state** (capped array) plus `Effect.log`. No new bus events or SDK types for MVP; UIs get status through the existing metadata mirror.
6. **Sequential execution only.** One task at a time.
7. **Permissions enforced in code**, not prompts: worker ruleset denies `git push*`, `sudo *`, `rm -rf *`, publish/deploy commands; reviewer, planner and checker are read-only.

Module: `packages/opencode/src/kilocode/autonomous/` (exempt from `kilocode_change` markers). Tests: `packages/opencode/test/kilocode/autonomous/`.

## 6. Data model (summary)

```ts
GoalState { id; sessionID; objective; status: planning|running|paused|blocked|reviewing|completed|failed;
  createdAt; updatedAt; summary?; acceptanceCriteria: Criterion[]; tasks: Task[]; openFindings: Finding[];
  planningRevision; escalations; budget: BudgetState; events: EventEntry[]; final?: FinalEvidence }

Task { id; title; description; type: research|implementation|test|review|repair|verification;
  status: pending|ready|running|verifying|repairing|blocked|completed|failed; complexity: 0..4;
  dependsOn: string[]; relevantFiles?; acceptanceCriteria: string[]; risk: {security?, auth?, schema?, infra?};
  preferredModelClass: local-small|local-coder|cloud-reasoner; attempts; maxAttempts;
  failures: TaskFailure[]; result?: TaskResult; route?: {modelClass, model, reason} }

TaskResult { status: completed|blocked; summary; changedFiles; assumptions; unresolved; confidence? }
TaskFailure { attempt; stage: check|review|worker|escalation; fingerprint; message; modelClass }
Finding { id; taskID?; type; file?; description; blocking; resolved }
BudgetState { cloudCost; cloudCalls; cloudInput; cloudOutput; localCalls; localInput; localOutput; perTask: Record<id,{cost,calls}> }
```

## 7. Packages

Each package is one commit with tests. Order is top to bottom.

### P0 – Plan + architecture notes
- [x] Rewrite this plan into packaged form.
- [x] `docs/autonomous-goal/current-architecture.md`: existing goal loop, session/prompt primitives, agents/permissions, persistence, cost, config, tests, with file paths.

### P1 – Config
- [x] Add `autonomous_goal` to `packages/core/src/v1/config/config.ts`: `enabled`, `models: {local_small?, local_coder?, cloud_reasoner?}`, `worker_max_attempts` (2), `routing: {local_small_max_complexity: 0, local_coder_max_complexity: 2}`, `stuck: {same_error_limit: 2}`, `budget: {cloud_task_max_usd: 2, cloud_goal_max_usd: 10, max_cloud_calls_per_task: 3, max_cloud_calls_per_goal: 20}`, `final_review_cloud_at_complexity` (3), `checks?: string[]`.
- [x] `autonomous/config.ts`: `resolve(cfg)` returns a fully defaulted object.
- [x] Regenerate SDK (`./script/generate.ts`); note the cloud `extras.ts` mirror in the PR.
- [x] Test: defaults and override merge.

### P2 – State + store
- [x] `autonomous/state.ts`: Effect `Schema` for the types in §6.
- [x] `autonomous/store.ts`: `load`, `save`, `update`, `remove` via `Storage.Service` key `["autonomous", sessionID]`; decode with schema; reject malformed documents.
- [x] `autonomous/log.ts`: `record(state, event, detail)` appends to a capped event log and logs via Effect.
- [x] Tests: round-trip; restore keeps dependencies, attempts, budget; malformed doc rejected.

### P3 – Scheduler (DAG, pure)
- [x] `autonomous/scheduler.ts`: `validate(tasks)` (unknown/self dependency, cycle via Kahn), `ready(state)`, `next(state)`, `propagate(state)` (failed → dependents blocked), `merge(state, planned)` for replanning (keep completed/failed, replace pending).
- [x] Tests: chain, fan-out, fan-in, cycle rejected, failed dependency blocks, replan merge keeps completed work.

### P4 – Router + model classes
- [x] `autonomous/models.ts`: `resolve(cfg, provider)` → `{local-small, local-coder, cloud-reasoner}` as `{providerID, modelID}` with fallbacks.
- [x] `autonomous/router.ts` (pure): `route({task, attempts, escalated, budget, cfg})` → `{modelClass, reason}`. Complexity 0 → local-small; 1–2 → local-coder; ≥3, any risk flag, preferred cloud, or escalated → cloud-reasoner; cloud budget exhausted → `blocked` with reason.
- [x] Tests: routing matrix, security escalation, retry escalation, budget constraint.

### P5 – Budget
- [x] `autonomous/budget.ts`: `charge(state, {modelClass, taskID, cost, tokens})`, `allow(state, cfg, taskID)` for cloud calls, `reason(state, cfg)`. Local and cloud tracked separately.
- [x] Tests: per-task and per-goal USD and call limits; local unlimited.

### P6 – Agents + permissions
- [x] Register hidden subagents in `patchAgents`: `autonomous-planner` (read-only), `autonomous-worker` (edit/write allow; bash allow with deny list; `question`, `task`, `suggest`, `goal*` deny), `autonomous-reviewer`, `autonomous-checker` and `autonomous-final` (read-only). Prompts in `autonomous/prompt/*.txt`.
- [x] Register only when `autonomous_goal.enabled`.
- [x] Tests: worker ruleset denies push/sudo and allows edit; reviewer cannot edit.

### P7 – Session runner
- [x] `autonomous/runner.ts`: `run({parent, agent, model, schema, text, retries})` creates a child session (`parentID`, `KiloHeadless.mark`), prompts with `format: json_schema`, waits for drain, decodes `info.structured`; on invalid output re-prompts the same session with the error up to `retries`; returns `{value, cost, tokens, sessionID, text}`; honours cancellation.
- [x] Tests with `TestLLMServer`: valid first try; invalid then valid; retries exhausted.

### P8 – Planner
- [x] `autonomous/planner.ts`, `planner-schema.ts`, `prompt/planner.txt`: input objective (plus prior state and goal-checker findings on replan); output `{goal_summary, acceptance_criteria, tasks, risks}`; validate with scheduler; on DAG error retry with the message; `replan` uses `merge`.
- [x] Tests: valid plan accepted; invalid dependency retried; planner cannot edit.

### P9 – Worker executor
- [x] `autonomous/worker.ts`: minimal-context prompt (task, criteria, relevant files, prior failure summaries); `git status --porcelain` before/after → `changedFiles`; result via runner with `TaskResult` schema; stored on the task.
- [x] Tests: result recorded; changed files detected in a temporary git repo.

### P10 – Mechanical verifier
- [x] `autonomous/verifier.ts`: `detect(dir)` from `package.json` scripts (`test`, `lint`, `typecheck`), `pyproject.toml`/`pytest.ini` (`pytest`, `ruff check .`), `pubspec.yaml` (`flutter analyze`, `flutter test`), `Cargo.toml` (`cargo check`, `cargo test`); `cfg.checks` overrides. `run(dir, commands, timeout)` via `Bun.spawn`, truncated stdout/stderr, exit code; skip when the binary is missing.
- [x] Tests: detection fixtures; pass/fail with a fake script; missing tool skipped.

### P11 – Reviewer
- [x] `autonomous/reviewer.ts`, `prompt/reviewer.txt`: input task, criteria, bounded `git diff`, check output, worker summary; output `{ok, severity, findings[{id,type,file?,description,blocking}], confidence}`; blocking findings appended to task failures and `openFindings`.
- [x] Tests: blocking finding fails the task; pass path.

### P12 – Repair + escalation (includes stuck detection)
- [x] `autonomous/repair.ts`: `fingerprint(failure)`; `decide(task, cfg)` → `retry-local` | `escalate` | `fail`. Escalate when same fingerprint ≥ limit, attempts ≥ max, worker reports blocked, reviewer confidence low, or a risk flag appears. Escalated attempt uses cloud-reasoner with minimal context (task, criteria, diff, failures, findings). Records escalations and repair history.
- [x] Tests: first failure → local retry; same error twice → escalate; escalation fails → task failed → dependents blocked.

### P13 – Goal checker + final review
- [x] `autonomous/checker.ts`, `prompt/checker.txt`: output `{complete, criteria[{id,status,evidence?,reason?}], new_work[]}`; updates criteria; `new_work` triggers replan.
- [x] `autonomous/final.ts`: gate = checks pass on whole tree, no blocking findings, all criteria satisfied, no failed required tasks; final reviewer over the full diff (cloud when max complexity ≥ threshold, else local); evidence stored in state.
- [x] Tests: worker cannot complete the goal; missing criterion creates work; gate blocks on a failing check.

### P14 – Engine loop + end-to-end tests
- [x] `autonomous/engine.ts`: `{start, pause, resume, clear, status}`; forked fiber in instance scope; loop per §8 with persistence after every transition; `GoalState.start/pause` and metadata mirror `kilo.goal = {text, status, active, reason}`; pause stops after the current task; budget exceeded → `paused` with reason; unresolvable → `blocked` with a concise question.
- [x] E2E test (scripted `TestLLMServer`): plan → two tasks → worker → check fails once → local repair → review ok → checker complete → final review → `completed` with cost summary.
- [x] E2E test: same error twice → escalation → completion.
- [x] Restart test: state restored, active → paused, resume continues from persisted tasks.

### P15 – `/goal` integration, status, docs
- [x] Branch at `session/prompt.ts:2314` (`kilocode_change`): when enabled, `Engine.command(input)`; args `<objective>`, `status` (bare default), `pause`, `resume`, `clear`, `tasks`, `budget`.
- [x] `autonomous/status.ts`: text renderer (progress bar, criteria, tasks, models, usage, escalations) emitted as a synthetic assistant notice.
- [x] Allow `kilo run --command goal <objective>` when enabled: the CLI reads the server config first, then starts the goal and waits for it to settle, exiting non-zero unless it completes.
- [x] Docs: "Autonomous engine (experimental)" section in `packages/kilo-docs/pages/code-with-ai/agents/goals.md`.
- [x] Tests: command routing, status snapshot, existing goal tests unchanged with the flag off.

### P16 – Repository memory, learned routing, GitHub issues
- [x] `autonomous/memory.ts`: planner writes `repo_summary`; stored per project (`["autonomous-repo", projectID]`) and fed back to the next planner run so it skips rediscovery.
- [x] `autonomous/stats.ts` + router: per-project outcome history by model class and complexity; after 5 runs a local class under 50% success is skipped for that complexity (only ever moves up, never down). Planner sees the history.
- [x] `autonomous/issue.ts`: `/goal #123`, `owner/repo#123`, or an issue URL resolves to the issue title and body through the `gh` CLI.
- [x] Tests: stats recording, history-aware routing, issue parsing and resolution, memory round-trip, planner prompt content.

### Later (not MVP)
- Parallel workers with worktrees; benchmark mode; opening a PR from a completed goal.

## 8. Execution loop

```ts
while (!terminal(goal)) {
  const task = scheduler.next(goal)
  if (!task) {
    const check = await checker.check(goal)
    if (check.complete) { await final.review(goal); continue }
    if (check.newWork.length) { await planner.replan(goal, check); continue }
    block(goal, "No ready tasks and goal incomplete"); break
  }
  const route = router.route(task)
  if (route.blocked) { pause(goal, route.reason); break }
  await worker.run(task, route)
  const checks = await verifier.run(task)
  if (!checks.ok) { await repair.handle(task, checks); continue }
  const review = await reviewer.review(task, checks)
  if (!review.ok) { await repair.handle(task, review); continue }
  complete(task)
}
```

## 9. Safety guardrails

- Worker permissions enforced by ruleset, never by prompt: deny `git push*`, `sudo *`, `rm -rf *`, `npm publish*`, `terraform apply*`, `kubectl delete*`, credential/secret changes.
- Planner, reviewer, checker are read-only.
- `KiloHeadless.mark` on every engine child so no permission prompt can hang; anything not explicitly allowed fails the task instead.
- Budget checked before every cloud call; exceeded → goal paused with a report.
- No infinite loops: attempts capped, same-error limit, dependents blocked on failure.
- Completion requires checker plus final review; worker self-reports never complete a goal.

## 10. Verification

- Per package, from `packages/opencode/`: `bun test ./test/kilocode/autonomous/<file>.test.ts` and `bun run typecheck`.
- Existing goal suite stays green: `bun test ./test/kilocode/session/goal.test.ts`.
- After P1: `./script/generate.ts` from root, `bun run lint`.
- After P6 and P15: `bun run script/check-opencode-annotations.ts --worktree` from root.
- MVP acceptance: P14 end-to-end tests pass with no interactive prompts.
- Manual: set `autonomous_goal.enabled: true` in `opencode.json`, run `/goal "add X"` against a small sample project, confirm `/goal status` and completion.
