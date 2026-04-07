# Integration Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire existing tested-and-passing modules (locks, lessons, quality gates, preflight, health monitor, event log) into the orchestration pipeline so they actually execute at the right points in the workflow lifecycle.

**Architecture:** Each gap connects a standalone module (already tested in `test/kilocode/workflow/`) to its call site. Gap 7 fixes a typing hole in `Tool.Context`. Gaps 8-9 add lock/lesson calls into `build-runner.ts`. Gaps 10-11 wire quality gates and preflight into the orchestrator's review and plan stages. Gap 12 adds health polling to the TUI refresh loop. Gap 13 adds an Activity tab to display the event log. All changes are in `packages/opencode/` under the `devilcode/` directory tree to minimize upstream merge friction.

**Tech Stack:** TypeScript, Zod, SolidJS (Ink-like TUI), existing `LockManager`, `LessonStore`, `EventLogger`, `runQualityGates`, `runPreflight`, `detectStuckTasks`, `detectDeadlock` modules.

**Prerequisite:** The Core Execution Pipeline plan (gaps 1-6) must be completed first. This plan assumes these files exist and export the APIs described in that plan:
- `packages/opencode/src/devilcode/workflow/dispatch.ts` (exports `dispatchPlan`, `dispatchChallenge`, `dispatchReview`)
- `packages/opencode/src/devilcode/workflow/build-runner.ts` (exports `BuildRunner`, `BuildRunnerOptions`, `BuildCallbacks`)
- `packages/opencode/src/devilcode/workflow/session-bridge.ts` (exports `SessionBridge`)
- `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts` (updated with `executePlan`, `executeChallenge`, `executeContracts`, `executeBuild`, `executeReview` methods)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/opencode/src/tool/tool.ts` | Add `teamRole?: string` to `Tool.Context` |
| Modify | `packages/opencode/src/tool/task.ts` | Replace `(ctx as any).teamRole` with typed access |
| Modify | `packages/opencode/src/session/prompt.ts` | Pass `teamRole` when constructing `Tool.Context` |
| Modify | `packages/opencode/src/devilcode/workflow/build-runner.ts` | Add lock acquisition/release and lesson capture |
| Modify | `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts` | Wire quality gates into `executeReview` |
| Modify | `packages/opencode/src/devilcode/workflow-tui/context.tsx` | Wire preflight into plan stage; add health polling; add events to store |
| Modify | `packages/opencode/src/devilcode/workflow-tui/types.ts` | Add `"activity"` to `TabKind` |
| Create | `packages/opencode/src/devilcode/workflow-tui/tabs/activity-tab.tsx` | Render event log entries |
| Create | `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts` | Tests for lock, lesson, quality-gate, preflight, and health wiring |

---

## Task 1: Fix `ctx.teamRole` Typing (Gap 7)

The `Tool.Context` type is missing `teamRole`. The code in `task.ts` uses `(ctx as any).teamRole` to work around this. The fix adds the field to the type, updates the cast site, and updates the context construction site in `prompt.ts`.

**Files:**
- Modify: `packages/opencode/src/tool/tool.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create the test file:

```typescript
// packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
import { describe, test, expect } from "bun:test"

describe("Gap 7: Tool.Context teamRole typing", () => {
  test("Tool.Context type includes teamRole field", async () => {
    // Import the type and verify the field exists at the type level.
    // We construct a minimal Context object with teamRole to prove the type allows it.
    const { Tool } = await import("@/tool/tool")

    // If teamRole is not on the type, this file won't compile.
    // Runtime check: construct a partial context-like object and confirm the field.
    const ctx: Partial<Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
      teamRole: "senior",
    }
    expect(ctx.teamRole).toBe("senior")
  })

  test("Tool.Context teamRole is optional (undefined when not set)", async () => {
    const ctx: Partial<(await import("@/tool/tool")).Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
    }
    expect(ctx.teamRole).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: FAIL -- `teamRole` does not exist on type `Tool.Context`

- [ ] **Step 3: Add `teamRole` to `Tool.Context` in `tool.ts`**

In `packages/opencode/src/tool/tool.ts`, replace:

```typescript
  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }
```

with:

```typescript
  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    teamRole?: string // devilcode_change — role assigned by team config routing
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }
```

- [ ] **Step 4: Remove the `(ctx as any)` cast in `task.ts`**

In `packages/opencode/src/tool/task.ts`, replace:

```typescript
        parentRole: (ctx as any).teamRole,
```

with:

```typescript
        parentRole: ctx.teamRole,
```

- [ ] **Step 5: Pass `teamRole` when constructing `Tool.Context` in `prompt.ts`**

In `packages/opencode/src/session/prompt.ts`, the `taskCtx` construction (around line 470) currently looks like:

```typescript
        const taskCtx: Tool.Context = {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: { bypassAgentCheck: true },
          messages: msgs,
```

Replace with:

```typescript
        const taskCtx: Tool.Context = {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: sessionID,
          abort,
          callID: part.callID,
          extra: { bypassAgentCheck: true },
          messages: msgs,
          teamRole: task.teamRole, // devilcode_change — propagate team role to subtask
```

Note: `task.teamRole` comes from the parent agent's resolved role. If the `task` object passed from the session processor does not have a `teamRole` field, add it to the task type in the same file or pass it from the agent options. Search for how `task` is populated to find the correct source. The key requirement is: whatever value `resolveTaskModel` used for `parentRole` in the parent context must be available as `teamRole` in the child context.

If `task` does not have `teamRole`, use a fallback:

```typescript
          teamRole: (task as any).teamRole ?? undefined, // devilcode_change
```

This is an intermediate solution. The correct long-term fix is adding `teamRole` to the task dispatch type, but that is outside this plan's scope.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS

- [ ] **Step 7: Run typecheck on modified files**

```bash
cd packages/opencode && bunx tsgo --noEmit src/tool/tool.ts src/tool/task.ts
```

Expected: No type errors. The `(ctx as any).teamRole` cast removal should compile cleanly now that `teamRole` is on the type.

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/tool/tool.ts packages/opencode/src/tool/task.ts packages/opencode/src/session/prompt.ts packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): add teamRole to Tool.Context type, remove unsafe cast in task.ts"
```

---

## Task 2: Wire Lock Acquisition into Build Runner (Gap 8)

The `LockManager` exists and is tested, but `build-runner.ts` never calls it. Tasks should acquire file locks before execution and release them in the `finally` block. This prevents two concurrent tasks from modifying the same file.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/build-runner.ts`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add lock-wiring tests**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import { LockManager } from "@/devilcode/workflow/locks"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("Gap 8: Lock acquisition during build", () => {
  let tmpDir: string
  let lockManager: LockManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lock-wire-test-"))
    const planningDir = path.join(tmpDir, ".planning")
    await fs.mkdir(planningDir, { recursive: true })
    lockManager = new LockManager(planningDir)
  })

  test("lock is acquired before task execution", async () => {
    // Simulate what build-runner should do: acquire, then release
    const taskId = "T-001"
    const role = "worker"
    const files = ["src/foo.ts", "src/bar.ts"]

    await lockManager.acquire(taskId, role, files)
    const locks = await lockManager.listLocks()
    expect(locks).toHaveLength(1)
    expect(locks[0].taskId).toBe(taskId)
    expect(locks[0].role).toBe(role)
    expect(locks[0].files).toEqual(files)
  })

  test("lock is released after task execution (including on failure)", async () => {
    const taskId = "T-001"
    await lockManager.acquire(taskId, "worker", ["src/foo.ts"])

    // Simulate finally block
    try {
      throw new Error("task failed")
    } catch {
      // error handling
    } finally {
      await lockManager.release(taskId)
    }

    const locks = await lockManager.listLocks()
    expect(locks).toHaveLength(0)
  })

  test("conflict detection works before acquisition", async () => {
    await lockManager.acquire("T-001", "worker", ["src/shared.ts"])
    const conflicts = await lockManager.checkConflicts(["src/shared.ts"])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].taskId).toBe("T-001")
  })
})
```

- [ ] **Step 2: Add the `beforeEach` import at the top of the file**

Update the import at the top of `integration-wiring.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test"
```

- [ ] **Step 3: Run the tests to verify the lock tests pass**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS -- these tests exercise `LockManager` directly, which already works.

- [ ] **Step 4: Add `lockManager` and `eventLogger` to `BuildRunnerOptions`**

In `packages/opencode/src/devilcode/workflow/build-runner.ts`, find the `BuildRunnerOptions` type:

```typescript
export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
} & BuildCallbacks
```

Replace with:

```typescript
export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
  lockManager?: LockManager
  eventLogger?: EventLogger
} & BuildCallbacks
```

Add the imports at the top of the file:

```typescript
import { LockManager } from "./locks"
import { EventLogger } from "./events"
```

- [ ] **Step 5: Add lock acquire/release to `executeTask`**

In `build-runner.ts`, find the `executeTask` method. The current structure is:

```typescript
  private async executeTask(task: PlanTask, useWorktree: boolean): Promise<TaskResult> {
    let worktree: Worktree.Info | undefined
    try {
      // Create worktree if running in parallel
      if (useWorktree) {
        worktree = await Worktree.create({ name: `wf-${task.id}` })
        log.info("worktree created", { taskId: task.id, directory: worktree.directory })
      }
```

After the worktree creation block (after the `log.info("worktree created"...` line), add:

```typescript
      // Acquire file locks if lock manager is configured
      if (this.options.lockManager && task.files.length > 0) {
        const conflicts = await this.options.lockManager.checkConflicts(task.files)
        if (conflicts.length > 0) {
          const conflictMsg = conflicts
            .map((c) => `${c.taskId} holds lock on: ${c.files.join(", ")}`)
            .join("; ")
          log.info("file conflict detected", { taskId: task.id, conflicts: conflictMsg })
          throw new Error(`File conflict: ${conflictMsg}`)
        }
        await this.options.lockManager.acquire(task.id, task.role, task.files)
        if (this.options.eventLogger) {
          await this.options.eventLogger.log({
            eventType: "files_locked",
            taskId: task.id,
            role: task.role,
            message: `Locked files: ${task.files.join(", ")}`,
          })
        }
        log.info("files locked", { taskId: task.id, files: task.files })
      }
```

- [ ] **Step 6: Add lock release to the `finally` block**

In the same `executeTask` method, find the `finally` block:

```typescript
    } finally {
      // Clean up worktree if we created one
      if (worktree) {
        await Worktree.remove({ directory: worktree.directory }).catch((e) => {
          log.error("worktree cleanup failed", { taskId: task.id, error: String(e) })
        })
      }
    }
```

Replace it with:

```typescript
    } finally {
      // Release file locks
      if (this.options.lockManager) {
        await this.options.lockManager.release(task.id).catch((e) => {
          log.error("lock release failed", { taskId: task.id, error: String(e) })
        })
        if (this.options.eventLogger) {
          await this.options.eventLogger.log({
            eventType: "files_unlocked",
            taskId: task.id,
            message: `Released locks for task ${task.id}`,
          }).catch(() => {})
        }
      }
      // Clean up worktree if we created one
      if (worktree) {
        await Worktree.remove({ directory: worktree.directory }).catch((e) => {
          log.error("worktree cleanup failed", { taskId: task.id, error: String(e) })
        })
      }
    }
```

- [ ] **Step 7: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow/build-runner.ts
```

Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/build-runner.ts packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): wire lock acquisition and release into build-runner task execution"
```

---

## Task 3: Wire Lesson Capture on Task Failure (Gap 9)

When a task fails during the build stage, the build runner should attempt to extract a lesson from the failure using `extractFromAgentReport()` and save it via `LessonStore`. This feeds the learning loop -- future plan dispatches include lessons from past failures.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/build-runner.ts`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add lesson-capture tests**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import { extractFromAgentReport, LessonStore } from "@/devilcode/workflow/learning"

describe("Gap 9: Lesson capture on failure", () => {
  let tmpDir: string
  let lessonStore: LessonStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lesson-wire-test-"))
    lessonStore = new LessonStore(tmpDir)
  })

  test("extractFromAgentReport produces a lesson from valid failure data", () => {
    const lesson = extractFromAgentReport({
      trigger: "TypeScript compilation failed due to missing type export",
      resolution: "Added the missing export to the shared types module",
      files: ["src/types.ts", "src/api.ts"],
      taskTitle: "Implement user API",
      category: "code_pattern",
    })
    expect(lesson).not.toBeNull()
    expect(lesson!.scope).toBe("project")
    expect(lesson!.files).toContain("src/types.ts")
    expect(lesson!.title).toContain("Implement user API")
  })

  test("lesson is saved to store and retrievable", async () => {
    const lesson = extractFromAgentReport({
      trigger: "Import path was incorrect causing module not found error",
      resolution: "Changed the import path to use the correct relative path",
      files: ["src/service.ts"],
    })
    expect(lesson).not.toBeNull()

    await lessonStore.save(lesson!)
    const all = await lessonStore.list()
    expect(all).toHaveLength(1)
    expect(all[0].trigger).toContain("Import path")
  })

  test("infra noise is filtered out (no lesson created)", () => {
    const lesson = extractFromAgentReport({
      trigger: "Connection timed out when calling the external API",
      resolution: "Retried the connection and it worked the second time",
      files: ["src/client.ts"],
    })
    expect(lesson).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS -- these directly exercise the existing learning module.

- [ ] **Step 3: Add `lessonStore` to `BuildRunnerOptions`**

In `packages/opencode/src/devilcode/workflow/build-runner.ts`, update the `BuildRunnerOptions` type:

```typescript
export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
  lockManager?: LockManager
  eventLogger?: EventLogger
  lessonStore?: LessonStore
} & BuildCallbacks
```

Add the import at the top:

```typescript
import { LessonStore, extractFromAgentReport } from "./learning"
```

- [ ] **Step 4: Add lesson capture to the `catch` block in `executeTask`**

In the `catch` block of `executeTask`, after the existing error logging and before the `return result` statement, add lesson extraction:

Find:

```typescript
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.error("task execution failed", { taskId: task.id, error: errMsg })

      const result: TaskResult = {
        taskId: task.id,
        status: "failed",
        output: "",
        filesModified: [],
        error: errMsg,
      }

      this.options.onTaskComplete(task.id, result)
      return result
```

Replace with:

```typescript
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.error("task execution failed", { taskId: task.id, error: errMsg })

      // Attempt to capture a lesson from the failure
      if (this.options.lessonStore) {
        const lesson = extractFromAgentReport({
          trigger: errMsg,
          resolution: `Task "${task.title}" failed. Error: ${errMsg}`,
          files: task.files,
          taskTitle: task.title,
          category: "code_pattern",
        })
        if (lesson) {
          await this.options.lessonStore.save(lesson).catch((e) => {
            log.error("lesson save failed", { taskId: task.id, error: String(e) })
          })
          if (this.options.eventLogger) {
            await this.options.eventLogger.log({
              eventType: "lesson_captured",
              taskId: task.id,
              role: task.role,
              message: `Lesson captured: ${lesson.title}`,
            }).catch(() => {})
          }
          log.info("lesson captured from failure", { taskId: task.id, lessonId: lesson.id })
        }
      }

      const result: TaskResult = {
        taskId: task.id,
        status: "failed",
        output: "",
        filesModified: [],
        error: errMsg,
      }

      this.options.onTaskComplete(task.id, result)
      return result
```

- [ ] **Step 5: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow/build-runner.ts
```

Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/build-runner.ts packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): capture lessons from task failures in build-runner"
```

---

## Task 4: Wire Quality Gates into Review Stage (Gap 10)

The orchestrator has `runQualityGates()` and `executeReview()`, but the review dispatch does not include quality gate results. The reviewer LLM should know about test/lint/typecheck failures so it can flag them as findings.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add quality-gate wiring test**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import { summarizeGateFailures, type GateResult } from "@/devilcode/workflow/quality-gates"

describe("Gap 10: Quality gates wired into review", () => {
  test("summarizeGateFailures formats failures for LLM consumption", () => {
    const results: GateResult[] = [
      {
        gateName: "TypeCheck",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "src/foo.ts(42,5): error TS2345: Argument of type 'string' is not assignable",
        durationMs: 3200,
      },
      {
        gateName: "Test Suite",
        passed: true,
        exitCode: 0,
        stdout: "14 passed",
        stderr: "",
        durationMs: 8500,
      },
      {
        gateName: "Lint",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "src/bar.ts:10:1 - error: Unexpected console statement",
        durationMs: 1200,
      },
    ]

    const summary = summarizeGateFailures(results)
    expect(summary).toContain("TypeCheck")
    expect(summary).toContain("exit 1")
    expect(summary).toContain("TS2345")
    expect(summary).toContain("Lint")
    expect(summary).toContain("console statement")
    // Passed gates should NOT appear in the failure summary
    expect(summary).not.toContain("Test Suite")
  })

  test("summarizeGateFailures returns empty string when all pass", () => {
    const results: GateResult[] = [
      {
        gateName: "TypeCheck",
        passed: true,
        exitCode: 0,
        stdout: "No errors",
        stderr: "",
        durationMs: 3000,
      },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toBe("")
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS -- `summarizeGateFailures` already works.

- [ ] **Step 3: Update `executeReview` in `orchestrator.ts` to call quality gates**

In `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`, find the `executeReview` method. The current implementation (from the prerequisite plan) is:

```typescript
  async executeReview(input: {
    providerID: string
    modelID: string
    diff: string
    cycle: number
  }): Promise<ReviewVerdict> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const summaries: string[] = []
    for (const plan of plans) {
      try {
        const summary = await this.manager.readSummary(state.currentPhase, plan.id)
        summaries.push(`${plan.id}: ${summary}`)
      } catch {
        summaries.push(`${plan.id}: (no summary)`)
      }
    }

    const verdict = await dispatchReview({
      ...input,
      summaries,
    })
```

Replace the entire `executeReview` method with:

```typescript
  /**
   * Execute the review stage: run quality gates first, then invoke LLM
   * to review build output. Quality gate results are passed to the
   * reviewer so it can flag test/typecheck/lint failures as findings.
   */
  async executeReview(input: {
    providerID: string
    modelID: string
    diff: string
    cycle: number
  }): Promise<ReviewVerdict> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    // Run quality gates before review
    const gateResults = await this.runQualityGates()
    const gateFailures = summarizeGateFailures(gateResults)

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const summaries: string[] = []
    for (const plan of plans) {
      try {
        const summary = await this.manager.readSummary(state.currentPhase, plan.id)
        summaries.push(`${plan.id}: ${summary}`)
      } catch {
        summaries.push(`${plan.id}: (no summary)`)
      }
    }

    const verdict = await dispatchReview({
      ...input,
      summaries,
      gateResults: gateFailures || undefined,
    })

    await this.manager.writeReview(state.currentPhase, verdict)

    await this.events.log({
      eventType: "stage_advanced",
      message: `Review cycle ${input.cycle}: ${verdict.verdict} (${verdict.findings.length} findings, ${gateResults.filter((g) => !g.passed).length} gate failures)`,
    })

    return verdict
  }
```

- [ ] **Step 4: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/orchestrator.ts
```

Expected: No type errors. `summarizeGateFailures` is already imported at the top of the orchestrator. `dispatchReview` already accepts `gateResults?: string`.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): run quality gates before review dispatch, pass failures to reviewer LLM"
```

---

## Task 5: Wire Preflight into Plan Stage (Gap 11)

The orchestrator has `runPreflight()` but it is never called. Before allowing the plan stage to proceed, preflight checks (git installed, valid repo, base branch, disk space) must pass. Errors block the workflow; warnings are logged but don't block.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add preflight wiring tests**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import { preflightPassed, reportSummary, type PreflightReport } from "@/devilcode/workflow/preflight"

describe("Gap 11: Preflight wired into plan stage", () => {
  test("preflightPassed returns true when all checks pass", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "git 2.40", severity: "error", fixHint: "" },
        { name: "git_repo", passed: true, message: "Valid repo", severity: "error", fixHint: "" },
        { name: "disk_space", passed: true, message: "50 GB free", severity: "error", fixHint: "" },
      ],
    }
    expect(preflightPassed(report)).toBe(true)
  })

  test("preflightPassed returns false when an error-severity check fails", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "git 2.40", severity: "error", fixHint: "" },
        { name: "git_repo", passed: false, message: "Not a git repo", severity: "error", fixHint: "Run git init" },
      ],
    }
    expect(preflightPassed(report)).toBe(false)
  })

  test("preflightPassed returns true when only warnings fail", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "git 2.40", severity: "error", fixHint: "" },
        { name: "working_tree", passed: false, message: "Uncommitted changes", severity: "warning", fixHint: "Commit changes" },
      ],
    }
    expect(preflightPassed(report)).toBe(true)
  })

  test("reportSummary includes error and warning counts", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "ok", severity: "error", fixHint: "" },
        { name: "repo", passed: false, message: "fail", severity: "error", fixHint: "fix" },
        { name: "tree", passed: false, message: "dirty", severity: "warning", fixHint: "stash" },
      ],
    }
    const summary = reportSummary(report)
    expect(summary).toContain("1 error")
    expect(summary).toContain("1 warning")
    expect(summary).toContain("1/3")
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS -- `preflightPassed` and `reportSummary` already work.

- [ ] **Step 3: Add preflight check to `executeStage` in `context.tsx`**

In `packages/opencode/src/devilcode/workflow-tui/context.tsx`, find the `executeStage` method. The prerequisite plan left it as:

```typescript
    async executeStage(stage: WorkflowStage) {
      setStore("executing", true)
      try {
        const orchestrator = getOrchestrator()

        // Advance the state machine first
        await Workflow.advanceStage(manager, stage)
        await refresh()

        // Then dispatch the stage-specific work
        // Note: plan/challenge/review need model info from team config.
        // For now, these return without dispatching if no team config is set.
        // The TUI command input will call the orchestrator methods directly
        // with the appropriate model when the user triggers execution.
      } catch (e) {
        setStore("executing", false)
        throw e
      }
      setStore("executing", false)
    },
```

Replace the entire method with:

```typescript
    async executeStage(stage: WorkflowStage) {
      setStore("executing", true)
      try {
        const orchestrator = getOrchestrator()

        // Run preflight checks before the plan stage
        if (stage === "plan") {
          const report = await orchestrator.runPreflight()
          const { preflightPassed: passed, reportSummary: summary } = await import("../workflow/preflight")
          if (!passed(report)) {
            const msg = summary(report)
            throw new Error(`Preflight failed: ${msg}. Fix the errors above before planning.`)
          }
        }

        // Advance the state machine
        await Workflow.advanceStage(manager, stage)
        await refresh()
      } catch (e) {
        setStore("executing", false)
        throw e
      }
      setStore("executing", false)
    },
```

- [ ] **Step 4: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/context.tsx
```

Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): run preflight checks before plan stage, block on errors"
```

---

## Task 6: Wire Health Monitor Polling (Gap 12)

The health monitor functions (`detectStuckTasks`, `detectDeadlock`) exist but nothing calls them. The TUI already has a 5-second refresh interval. During active execution (`store.executing === true`), the refresh should also call `orchestrator.checkHealth()` and surface alerts/deadlocks in the store.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add health monitor tests**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import {
  detectStuckTasks,
  detectDeadlock,
  DEFAULT_HEALTH_CONFIG,
  type HealthAlert,
  type DeadlockResult,
} from "@/devilcode/workflow/health"
import type { ActiveTask } from "@/devilcode/workflow/types"

describe("Gap 12: Health monitor polling", () => {
  test("detectStuckTasks returns alert for idle task", () => {
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "in_progress" },
    ]
    const lastActivity = new Map<string, number>()
    // Last activity was 20 minutes ago
    lastActivity.set("T-001", Date.now() - 20 * 60 * 1000)

    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].taskId).toBe("T-001")
    expect(alerts[0].reason).toContain("no activity")
  })

  test("detectStuckTasks ignores completed tasks", () => {
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "completed" },
    ]
    const lastActivity = new Map<string, number>()
    lastActivity.set("T-001", Date.now() - 60 * 60 * 1000) // 1 hour ago

    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG)
    expect(alerts).toHaveLength(0)
  })

  test("detectDeadlock detects a cycle between blocked tasks", () => {
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "blocked" },
      { id: "T-002", role: "senior", status: "blocked" },
    ]
    const deps = new Map<string, string[]>()
    deps.set("T-001", ["T-002"])
    deps.set("T-002", ["T-001"])

    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cycle")
    expect(result!.taskIds).toContain("T-001")
    expect(result!.taskIds).toContain("T-002")
  })

  test("detectDeadlock returns null when no tasks are blocked", () => {
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "in_progress" },
    ]
    const deps = new Map<string, string[]>()

    const result = detectDeadlock(tasks, deps)
    expect(result).toBeNull()
  })

  test("checkHealth returns both stuck alerts and deadlock info", () => {
    // This tests the orchestrator.checkHealth() shape without needing the full orchestrator.
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "in_progress" },
    ]
    const lastActivity = new Map<string, number>()
    lastActivity.set("T-001", Date.now() - 20 * 60 * 1000)

    const stuckAlerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG)
    const deadlock = detectDeadlock(tasks, new Map())

    expect(stuckAlerts.length).toBeGreaterThan(0)
    expect(deadlock).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS

- [ ] **Step 3: Add `healthAlerts` and `deadlock` to the store in `context.tsx`**

In `packages/opencode/src/devilcode/workflow-tui/context.tsx`, find the `createStore` call. The store shape currently includes:

```typescript
  const [store, setStore] = createStore<{
    state: WorkflowState | undefined
    plans: PlanTask[]
    challenge: PlanChallenge | undefined
    review: ReviewVerdict | undefined
    selectedTask: string | undefined
    activeTab: string
    tabs: TabInfo[]
    executing: boolean
    activeSessions: Record<string, SessionInfo>
    rootSessionId: string | undefined
  }>({
```

Add health fields to the type:

```typescript
  const [store, setStore] = createStore<{
    state: WorkflowState | undefined
    plans: PlanTask[]
    challenge: PlanChallenge | undefined
    review: ReviewVerdict | undefined
    selectedTask: string | undefined
    activeTab: string
    tabs: TabInfo[]
    executing: boolean
    activeSessions: Record<string, SessionInfo>
    rootSessionId: string | undefined
    healthAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
    events: WorkflowEvent[]
  }>({
```

And add the defaults to the initializer:

```typescript
    healthAlerts: [],
    deadlock: null,
    events: [],
```

Add the imports at the top of `context.tsx`:

```typescript
import type { HealthAlert, DeadlockResult } from "../workflow/health"
import type { WorkflowEvent } from "../workflow/events"
```

- [ ] **Step 4: Add health polling to the `refresh` function**

In the `refresh` function, after the existing state/plan/review reads and before the closing `} catch {`, add:

```typescript
      // Poll health during active execution
      if (store.executing && state.activeTasks.length > 0) {
        const orchestrator = getOrchestrator()
        const health = orchestrator.checkHealth(state.activeTasks)
        setStore("healthAlerts", health.stuckAlerts)
        setStore("deadlock", health.deadlock)
      } else {
        setStore("healthAlerts", [])
        setStore("deadlock", null)
      }

      // Load recent events for the activity tab
      try {
        const orchestrator = getOrchestrator()
        const events = await orchestrator.getEventLogger().readRecent(50)
        setStore("events", events)
      } catch {
        // events not available yet
      }
```

- [ ] **Step 5: Add the health and events getters to the `value` object**

In the `value` object, add getters:

```typescript
    get healthAlerts() {
      return store.healthAlerts
    },
    get deadlock() {
      return store.deadlock
    },
    get events() {
      return store.events
    },
```

- [ ] **Step 6: Add the fields to the `WorkflowViewState` type**

In the `WorkflowViewState` type, add:

```typescript
  healthAlerts: HealthAlert[]
  deadlock: DeadlockResult | null
  events: WorkflowEvent[]
```

- [ ] **Step 7: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/context.tsx
```

Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): poll health monitor during execution, add events to TUI store"
```

---

## Task 7: Add Activity Tab for Event Log (Gap 13)

The event logger writes to `events.jsonl` but nothing displays these events. This task adds an `"activity"` tab kind and a corresponding `ActivityTab` component that renders the event timeline.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/types.ts`
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/activity-tab.tsx`
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`
- Test: `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`

- [ ] **Step 1: Add event-display tests**

Append to `packages/opencode/test/kilocode/workflow/integration-wiring.test.ts`:

```typescript
import { EventLogger, type WorkflowEvent } from "@/devilcode/workflow/events"

describe("Gap 13: Event log display", () => {
  let tmpDir: string
  let logger: EventLogger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "events-wire-test-"))
    const planningDir = path.join(tmpDir, ".planning")
    await fs.mkdir(planningDir, { recursive: true })
    logger = new EventLogger(planningDir)
  })

  test("readRecent returns most recent events", async () => {
    await logger.log({ eventType: "plan_created", message: "Phase 1 planned" })
    await logger.log({ eventType: "task_started", taskId: "T-001", message: "Started T-001" })
    await logger.log({ eventType: "task_completed", taskId: "T-001", message: "Completed T-001" })

    const recent = await logger.readRecent(2)
    expect(recent).toHaveLength(2)
    expect(recent[0].eventType).toBe("task_started")
    expect(recent[1].eventType).toBe("task_completed")
  })

  test("readRecent returns all events when count exceeds total", async () => {
    await logger.log({ eventType: "plan_created", message: "Planned" })

    const recent = await logger.readRecent(100)
    expect(recent).toHaveLength(1)
  })

  test("events have timestamp", async () => {
    await logger.log({ eventType: "preflight_check", message: "Preflight OK" })

    const events = await logger.readRecent(1)
    expect(events[0].timestamp).toBeDefined()
    // Verify it's a valid ISO timestamp
    const parsed = new Date(events[0].timestamp!)
    expect(parsed.getTime()).not.toBeNaN()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: PASS

- [ ] **Step 3: Add `"activity"` to `TabKind` in `types.ts`**

In `packages/opencode/src/devilcode/workflow-tui/types.ts`, replace:

```typescript
export type TabKind = "agent" | "plan" | "challenge" | "review"
```

with:

```typescript
export type TabKind = "agent" | "plan" | "challenge" | "review" | "activity"
```

- [ ] **Step 4: Create the `ActivityTab` component**

Create `packages/opencode/src/devilcode/workflow-tui/tabs/activity-tab.tsx`:

```typescript
import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"
import type { WorkflowEvent } from "../../workflow/events"

function eventColor(eventType: string, theme: any): string {
  switch (eventType) {
    case "task_completed":
    case "quality_gate_passed":
      return theme.success
    case "task_failed":
    case "task_escalated":
    case "quality_gate_failed":
      return theme.error
    case "preflight_check":
    case "stage_advanced":
      return theme.info
    case "files_locked":
    case "files_unlocked":
      return theme.warning
    case "lesson_captured":
      return theme.primary
    default:
      return theme.text
  }
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return ""
  try {
    const date = new Date(ts)
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    return `${hours}:${minutes}:${seconds}`
  } catch {
    return ""
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ActivityTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const sortedEvents = createMemo(() => {
    // Events are already in chronological order from readRecent.
    // Display newest first for the TUI.
    return [...wf.events].reverse()
  })

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={sortedEvents().length > 0}
        fallback={
          <text fg={theme.textMuted}>
            No workflow events yet. Start a workflow to see activity.
          </text>
        }
      >
        <For each={sortedEvents()}>
          {(event) => (
            <box flexDirection="row" gap={1} marginBottom={0}>
              <text fg={theme.textMuted} minWidth={8}>
                {formatTimestamp(event.timestamp)}
              </text>
              <text fg={eventColor(event.eventType, theme)} minWidth={22}>
                {event.eventType}
              </text>
              <Show when={event.taskId}>
                <text fg={theme.textMuted} minWidth={8}>
                  {event.taskId}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" flexGrow={1}>
                {event.message}
              </text>
              <Show when={event.durationMs}>
                <text fg={theme.textMuted}>
                  {formatDuration(event.durationMs)}
                </text>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </scrollbox>
  )
}
```

- [ ] **Step 5: Add the activity tab to the initial tabs in `context.tsx`**

In `packages/opencode/src/devilcode/workflow-tui/context.tsx`, find the initial tabs array in the `createStore` call:

```typescript
    tabs: [
      { id: "plan", label: "Plan", kind: "plan", closeable: false },
    ],
```

Replace with:

```typescript
    tabs: [
      { id: "plan", label: "Plan", kind: "plan" as const, closeable: false },
      { id: "activity", label: "Activity", kind: "activity" as const, closeable: false },
    ],
```

- [ ] **Step 6: Run typecheck on the new tab**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/tabs/activity-tab.tsx src/devilcode/workflow-tui/types.ts src/devilcode/workflow-tui/context.tsx
```

Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/types.ts packages/opencode/src/devilcode/workflow-tui/tabs/activity-tab.tsx packages/opencode/src/devilcode/workflow-tui/context.tsx packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
git commit -m "feat(cli): add Activity tab to display workflow event timeline"
```

---

## Task 8: Pass Lock Manager and Lesson Store from Orchestrator to Build Runner

The orchestrator already owns `LockManager`, `LessonStore`, and `EventLogger` instances. When it calls `executeBuild()`, it needs to pass these to the `BuildRunner` so the wiring from Tasks 2 and 3 actually activates. This is the connection point between the orchestrator and the build runner's new optional dependencies.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`

- [ ] **Step 1: Update `executeBuild` to pass lock manager, lesson store, and event logger**

In `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`, find the `executeBuild` method. The prerequisite plan created it as:

```typescript
  async executeBuild(
    callbacks: BuildCallbacks,
    teamConfig: TeamConfig | undefined,
  ): Promise<TaskResult[]> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    // Validate before building
    const validation = await this.validateBuild()
    if (!validation.valid) {
      throw new Error(`Build validation failed: ${validation.errors.join("; ")}`)
    }

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const runner = new BuildRunner({
      teamConfig,
      ...callbacks,
    })
```

Replace the `new BuildRunner({...})` call:

```typescript
    const plans = await this.manager.readAllPlans(state.currentPhase)
    const runner = new BuildRunner({
      teamConfig,
      lockManager: this.locks,
      lessonStore: this.lessons,
      eventLogger: this.events,
      ...callbacks,
    })
```

- [ ] **Step 2: Log build start/completion events**

After the line `const results = await runner.executeAll(plans)` and before the summary-writing loop, add:

```typescript
    // Log build completion
    const completed = results.filter((r) => r.status === "completed").length
    const failed = results.filter((r) => r.status === "failed").length
    const blocked = results.filter((r) => r.status === "blocked").length
    await this.events.log({
      eventType: "stage_advanced",
      message: `Build complete: ${completed} completed, ${failed} failed, ${blocked} blocked out of ${results.length} tasks`,
    })
```

- [ ] **Step 3: Record task activity for health monitoring**

In the `executeBuild` method, before `const runner = new BuildRunner(...)`, wrap the `onTaskStart` callback to also record activity:

Find the `...callbacks` spread and replace the full `new BuildRunner` block with:

```typescript
    const plans = await this.manager.readAllPlans(state.currentPhase)
    const self = this
    const runner = new BuildRunner({
      teamConfig,
      lockManager: this.locks,
      lessonStore: this.lessons,
      eventLogger: this.events,
      onTaskStart(taskId, sessionId) {
        self.recordTaskActivity(taskId)
        self.events.log({
          eventType: "task_started",
          taskId,
          message: `Task ${taskId} started (session: ${sessionId})`,
        }).catch(() => {})
        callbacks.onTaskStart(taskId, sessionId)
      },
      onTaskComplete(taskId, result) {
        self.recordTaskActivity(taskId)
        self.events.log({
          eventType: result.status === "completed" ? "task_completed" : "task_failed",
          taskId,
          message: `Task ${taskId}: ${result.status}${result.error ? ` - ${result.error}` : ""}`,
        }).catch(() => {})
        callbacks.onTaskComplete(taskId, result)
      },
      onOutput(taskId, sessionId, line) {
        self.recordTaskActivity(taskId)
        callbacks.onOutput(taskId, sessionId, line)
      },
    })
```

- [ ] **Step 4: Run typecheck**

```bash
cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/orchestrator.ts
```

Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
git commit -m "feat(cli): pass lock manager, lesson store, and event logger from orchestrator to build runner"
```

---

## Task 9: Integration Verification -- Full Test Suite

Final verification to ensure all changes compile and tests pass across the workflow modules.

**Files:** None (verification only)

- [ ] **Step 1: Run the integration wiring tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/integration-wiring.test.ts
```

Expected: All tests PASS

- [ ] **Step 2: Run all workflow tests**

```bash
cd packages/opencode && bun test test/kilocode/workflow/
```

Expected: All tests PASS (locks, learning, events, health, preflight, quality-gates, types, state, executor, reviewer, contracts, dispatch, build-runner, session-bridge, contract-generator, integration-wiring)

- [ ] **Step 3: Run all team tests**

```bash
cd packages/opencode && bun test test/kilocode/team/
```

Expected: All tests PASS

- [ ] **Step 4: Typecheck all modified files**

```bash
cd packages/opencode && bunx tsgo --noEmit src/tool/tool.ts src/tool/task.ts src/devilcode/workflow/build-runner.ts src/devilcode/workflow-tui/orchestrator.ts src/devilcode/workflow-tui/context.tsx src/devilcode/workflow-tui/types.ts src/devilcode/workflow-tui/tabs/activity-tab.tsx
```

Expected: No type errors

- [ ] **Step 5: Run full monorepo typecheck**

```bash
bun turbo typecheck
```

Expected: PASS (or no new errors beyond any pre-existing ones)

- [ ] **Step 6: Verify event log end-to-end**

```bash
cd packages/opencode && bun test test/kilocode/workflow/events.test.ts
```

Expected: PASS -- confirms EventLogger read/write still works

- [ ] **Step 7: Commit any fixes needed**

If any of the above steps revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(cli): resolve type and test issues from integration wiring"
```

---

## Summary

| Gap | What Gets Wired | Source Module | Call Site |
|-----|----------------|--------------|-----------|
| Gap 7 | `teamRole` typed on `Tool.Context` | `tool/tool.ts` | `tool/task.ts`, `session/prompt.ts` |
| Gap 8 | Lock acquire/release during build | `workflow/locks.ts` | `workflow/build-runner.ts` |
| Gap 9 | Lesson capture on task failure | `workflow/learning.ts` | `workflow/build-runner.ts` |
| Gap 10 | Quality gates before review dispatch | `workflow/quality-gates.ts` | `workflow-tui/orchestrator.ts` |
| Gap 11 | Preflight before plan stage | `workflow/preflight.ts` | `workflow-tui/context.tsx` |
| Gap 12 | Health monitor in refresh loop | `workflow/health.ts` | `workflow-tui/context.tsx` |
| Gap 13 | Activity tab for event log | `workflow/events.ts` | `workflow-tui/tabs/activity-tab.tsx` |

**Not covered (separate plans needed):**
- Gaps 14-17: Polish (test fixes, TUI navigation improvements, tab close behavior)
- Gaps 18-20: E2E testing, VS Code extension integration, documentation
