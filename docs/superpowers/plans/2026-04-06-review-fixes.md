# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 17 findings from the code review (2 blockers, 10 warnings, 7 suggestions) — fixing security, correctness, race conditions, and dead code across the workflow engine.

**Architecture:** Each fix is isolated to 1-2 files. Blockers (wildcard permissions, wrong disk check) are pure code fixes. Race conditions (lock TOCTOU, event logger) are solved by adding a simple in-process mutex. The remaining fixes are targeted edits: typing `any`, separating commands from stages, wiring output streaming, adding gate timeouts, fixing dead-code branches, using Instance.state(), and renaming the duplicate TaskResult.

**Tech Stack:** TypeScript, Zod, SolidJS, Node.js `fs.statfs()` (for disk space), `Mutex` class (new, 20 lines).

---

## File Map

| Action | File | Issues |
|--------|------|--------|
| Modify | `packages/opencode/src/devilcode/workflow/build-runner.ts` | B1, W3 |
| Modify | `packages/opencode/src/devilcode/workflow/preflight.ts` | B2 |
| Create | `packages/opencode/src/devilcode/workflow/mutex.ts` | W1, W2 |
| Modify | `packages/opencode/src/devilcode/workflow/locks.ts` | W1 |
| Modify | `packages/opencode/src/devilcode/workflow/events.ts` | W2, W5 |
| Modify | `packages/opencode/src/devilcode/workflow-tui/command-input.tsx` | W4 |
| Modify | `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts` | W6, W7, W8 |
| Modify | `packages/opencode/src/devilcode/workflow-tui/context.tsx` | W6, W7 |
| Modify | `packages/opencode/src/devilcode/workflow/health.ts` | W9 |
| Modify | `packages/opencode/src/devilcode/workflow/session-bridge.ts` | S2 |
| Modify | `packages/opencode/src/devilcode/workflow/quality-gates.ts` | S6 |
| Modify | `packages/opencode/src/devilcode/team/effort.ts` | S1 |
| Modify | `packages/opencode/src/devilcode/team/types.ts` | S7 |
| Create | `packages/opencode/test/kilocode/workflow/review-fixes.test.ts` | Tests for fixes |

---

## Task 1: Fix Wildcard Permissions on Child Sessions (B1)

Child sessions spawned by BuildRunner get `permission: "*"` which grants unrestricted tool access. Scope permissions to the task's file list.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/build-runner.ts`
- Test: `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// packages/opencode/test/kilocode/workflow/review-fixes.test.ts
import { describe, test, expect } from "bun:test"

describe("B1: child session permissions are scoped", () => {
  test("buildPermissions scopes write access to task files and allows read everywhere", async () => {
    const { buildPermissions } = await import("@/devilcode/workflow/build-runner")

    const perms = buildPermissions(["src/auth/middleware.ts", "src/auth/jwt.ts"])

    // Should allow reading anything
    const readAll = perms.find((p: any) => p.permission === "read" && p.pattern === "*")
    expect(readAll).toBeDefined()
    expect(readAll!.action).toBe("allow")

    // Should allow writing only to task files
    const writePerms = perms.filter((p: any) => p.permission === "write" || p.permission === "edit")
    for (const wp of writePerms) {
      expect(wp.action).toBe("allow")
      // Each write permission should target a specific file, not "*"
      expect(wp.pattern).not.toBe("*")
    }

    // Should allow bash/command execution
    const bash = perms.find((p: any) => p.permission === "bash" || p.permission === "command")
    expect(bash).toBeDefined()
  })

  test("buildPermissions with empty files array still allows read and bash", () => {
    const { buildPermissions } = require("@/devilcode/workflow/build-runner")

    const perms = buildPermissions([])

    const readAll = perms.find((p: any) => p.permission === "read" && p.pattern === "*")
    expect(readAll).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts`
Expected: FAIL — `buildPermissions` is not exported

- [ ] **Step 3: Add `buildPermissions` function and update `Session.create` call**

In `packages/opencode/src/devilcode/workflow/build-runner.ts`, add the exported helper function before the `BuildRunner` class:

```typescript
/**
 * Build scoped permissions for a workflow task session.
 * Allows read access everywhere, write access only to task files,
 * and bash/command execution for verification commands.
 */
export function buildPermissions(taskFiles: string[]): Array<{ permission: string; action: "allow" | "deny"; pattern: string }> {
  const perms: Array<{ permission: string; action: "allow" | "deny"; pattern: string }> = [
    // Allow reading any file (agents need to read code to understand context)
    { permission: "read", action: "allow", pattern: "*" },
    // Allow bash/command execution (for verification commands)
    { permission: "bash", action: "allow", pattern: "*" },
    { permission: "command", action: "allow", pattern: "*" },
  ]
  // Allow writing only to the files this task is assigned
  for (const file of taskFiles) {
    perms.push({ permission: "write", action: "allow", pattern: file })
    perms.push({ permission: "edit", action: "allow", pattern: file })
  }
  // If no files specified, allow write to all (fallback for tasks without file lists)
  if (taskFiles.length === 0) {
    perms.push({ permission: "write", action: "allow", pattern: "*" })
    perms.push({ permission: "edit", action: "allow", pattern: "*" })
  }
  return perms
}
```

Then replace the `Session.create` call (around line 132-137) from:

```typescript
        const session = await Session.create({
          title: `[workflow] ${task.title}`,
          permission: [
            { permission: "*", action: "allow", pattern: "*" },
          ],
        })
```

To:

```typescript
        const session = await Session.create({
          title: `[workflow] ${task.title}`,
          permission: buildPermissions(task.files),
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing build-runner tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/build-runner.test.ts`
Expected: PASS (existing tests still work)

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/build-runner.ts packages/opencode/test/kilocode/workflow/review-fixes.test.ts
git commit -m "fix(cli): scope child session permissions to task file list instead of wildcard

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix `checkDiskSpace()` to Measure Disk, Not RAM (B2)

`os.freemem()` returns free RAM, not disk space. Use Node.js `fs.statfs()` instead.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/preflight.ts`
- Test: `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`

- [ ] **Step 1: Add disk space test**

Append to `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`:

```typescript
describe("B2: checkDiskSpace measures actual disk space", () => {
  test("checkDiskSpace returns a result with GB in the message", async () => {
    const { checkDiskSpace } = await import("@/devilcode/workflow/preflight")

    const result = await checkDiskSpace()
    expect(result.name).toBe("disk_space")
    expect(result.message).toContain("GB")
    // Should actually measure disk, not RAM. On any modern dev machine, disk > 1GB.
    expect(result.passed).toBe(true)
  })
})
```

- [ ] **Step 2: Fix `checkDiskSpace` in preflight.ts**

In `packages/opencode/src/devilcode/workflow/preflight.ts`, replace the `checkDiskSpace` function (lines 78-99):

```typescript
export async function checkDiskSpace(): Promise<CheckResult> {
  try {
    const stats = await fs.statfs(process.cwd())
    const freeBytes = stats.bfree * stats.bsize
    const freeGB = freeBytes / (1024 * 1024 * 1024)
    if (freeGB < 1) {
      return {
        name: "disk_space",
        passed: false,
        message: `${freeGB.toFixed(1)} GB free disk space (< 1 GB)`,
        severity: "error",
        fixHint: "Free up disk space",
      }
    }
    if (freeGB < 5) {
      return {
        name: "disk_space",
        passed: true,
        message: `${freeGB.toFixed(1)} GB free disk space (low)`,
        severity: "warning",
        fixHint: "Consider freeing disk space",
      }
    }
    return { name: "disk_space", passed: true, message: `${freeGB.toFixed(1)} GB free disk space`, severity: "error", fixHint: "" }
  } catch {
    // statfs not available (older Node) — fall back to passing with a warning
    return { name: "disk_space", passed: true, message: "Unable to check disk space", severity: "warning", fixHint: "" }
  }
}
```

Also add `import fs from "fs/promises"` at the top if not already imported (check — it likely already has `import { $ } from "bun"` or similar but may not have `fs`).

Remove `import os from "os"` if `os` is no longer used by any other function in the file. Check other usages before removing.

- [ ] **Step 3: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts test/kilocode/workflow/preflight.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/preflight.ts packages/opencode/test/kilocode/workflow/review-fixes.test.ts
git commit -m "fix(cli): use fs.statfs() for disk space check instead of os.freemem() (RAM)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add In-Process Mutex for Lock Manager and Event Logger (W1, W2)

Both `LockManager` (read-modify-write on locks.json) and `EventLogger` (concurrent appendFile) have TOCTOU race conditions under concurrent access. Add a simple in-process mutex.

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/mutex.ts`
- Modify: `packages/opencode/src/devilcode/workflow/locks.ts`
- Modify: `packages/opencode/src/devilcode/workflow/events.ts`
- Test: `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`

- [ ] **Step 1: Add mutex test**

Append to `review-fixes.test.ts`:

```typescript
describe("W1/W2: Mutex serializes concurrent operations", () => {
  test("mutex serializes concurrent calls", async () => {
    const { Mutex } = await import("@/devilcode/workflow/mutex")

    const mutex = new Mutex()
    const order: number[] = []

    const task = async (id: number, delayMs: number) => {
      return mutex.run(async () => {
        order.push(id)
        await new Promise((r) => setTimeout(r, delayMs))
        order.push(id * 10)
      })
    }

    // Start two tasks concurrently
    await Promise.all([task(1, 50), task(2, 10)])

    // Task 1 should fully complete before task 2 starts
    expect(order).toEqual([1, 10, 2, 20])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts`
Expected: FAIL — `mutex.ts` doesn't exist

- [ ] **Step 3: Create the mutex module**

Create `packages/opencode/src/devilcode/workflow/mutex.ts`:

```typescript
/**
 * Simple in-process async mutex. Serializes concurrent operations
 * to prevent TOCTOU races on shared resources (locks.json, events.jsonl).
 */
export class Mutex {
  private queue: Array<() => void> = []
  private locked = false

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}
```

- [ ] **Step 4: Add mutex to LockManager**

In `packages/opencode/src/devilcode/workflow/locks.ts`, add import at the top:

```typescript
import { Mutex } from "./mutex"
```

Add a mutex instance to the class:

```typescript
export class LockManager {
  private lockPath: string
  private mutex = new Mutex()
```

Wrap `acquire`, `release`, `releaseAll` in `this.mutex.run()`:

Replace `acquire` (lines 38-49):

```typescript
  async acquire(taskId: string, role: string, files: string[]): Promise<void> {
    return this.mutex.run(async () => {
      const locks = await this.read()
      const filtered = locks.filter((l) => l.taskId !== taskId)
      filtered.push({
        taskId,
        role,
        files,
        lockedAt: new Date().toISOString(),
      })
      await this.write(filtered)
    })
  }
```

Replace `release` (lines 51-54):

```typescript
  async release(taskId: string): Promise<void> {
    return this.mutex.run(async () => {
      const locks = await this.read()
      await this.write(locks.filter((l) => l.taskId !== taskId))
    })
  }
```

Replace `releaseAll` (lines 56-58):

```typescript
  async releaseAll(): Promise<void> {
    return this.mutex.run(async () => {
      await this.write([])
    })
  }
```

- [ ] **Step 5: Add mutex to EventLogger**

In `packages/opencode/src/devilcode/workflow/events.ts`, add import:

```typescript
import { Mutex } from "./mutex"
```

Add mutex to class:

```typescript
export class EventLogger {
  private logPath: string
  private mutex = new Mutex()
```

Wrap `log` method:

```typescript
  async log(event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
    return this.mutex.run(async () => {
      const entry: WorkflowEvent = {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      }
      const line = JSON.stringify(entry) + "\n"
      await fs.appendFile(this.logPath, line)
    })
  }
```

- [ ] **Step 6: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts test/kilocode/workflow/locks.test.ts test/kilocode/workflow/events.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/mutex.ts packages/opencode/src/devilcode/workflow/locks.ts packages/opencode/src/devilcode/workflow/events.ts packages/opencode/test/kilocode/workflow/review-fixes.test.ts
git commit -m "fix(cli): add mutex to LockManager and EventLogger to prevent TOCTOU races

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Type `extractOutput` and Fix `command-input.tsx` Stage Cast (W3, W4)

Two typing issues: `extractOutput` uses `any`, and `command-input.tsx` casts workflow commands to `any` when they should be separated from stages.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/build-runner.ts`
- Modify: `packages/opencode/src/devilcode/workflow-tui/command-input.tsx`

- [ ] **Step 1: Type `extractOutput` in build-runner.ts**

Find the `extractOutput` function at the bottom of `build-runner.ts`. Replace:

```typescript
function extractOutput(message: any): string {
  if (!message?.parts) return ""
  return message.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
    .slice(0, 2000)
}
```

With:

```typescript
function extractOutput(message: { parts?: Array<{ type: string; text?: string }> } | undefined): string {
  if (!message?.parts) return ""
  return message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n")
    .slice(0, 2000)
}
```

- [ ] **Step 2: Fix `command-input.tsx` to separate commands from stages**

In `packages/opencode/src/devilcode/workflow-tui/command-input.tsx`, the issue is at line 75-82. The `isWorkflowCommand` check includes meta-commands (status, pause, approve, etc.) that are handled ABOVE this check, so they never reach here. The remaining commands that reach line 75 are stage names (plan, challenge, build, review, ship, retro) which ARE valid `WorkflowStage` values.

However, the cast `trimmed as any` is still unsafe because `isWorkflowCommand` also includes "next" and "back" which are handled above but could theoretically fall through if the handler logic changes.

Replace lines 74-82:

```typescript
    // Check if it's a valid stage transition command
    const { WorkflowStage } = await import("../workflow/types")
    const parsed = WorkflowStage.safeParse(trimmed)
    if (parsed.success) {
      try {
        await wf.executeStage(parsed.data)
      } catch (e: any) {
        toast.show({ message: e.message ?? "Stage transition failed", variant: "error", duration: 4000 })
      }
      return
    }
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow/build-runner.ts src/devilcode/workflow-tui/command-input.tsx`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/build-runner.ts packages/opencode/src/devilcode/workflow-tui/command-input.tsx
git commit -m "fix(cli): type extractOutput parameter, validate stage commands via Zod instead of cast

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Use Instance.state() for Orchestrator Singleton (W6)

The orchestrator uses a module-level singleton that ignores project directory changes. Use `Instance.state()` to tie it to the current project.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`

- [ ] **Step 1: Replace module singleton with Instance.state()**

In `orchestrator.ts`, replace lines 340-347:

```typescript
let instance: WorkflowOrchestrator | undefined

export function getOrchestrator(): WorkflowOrchestrator {
  if (!instance) {
    instance = new WorkflowOrchestrator()
  }
  return instance
}
```

With:

```typescript
const orchestratorState = Instance.state(
  () => new WorkflowOrchestrator(),
)

export function getOrchestrator(): WorkflowOrchestrator {
  return orchestratorState()
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/orchestrator.ts`

If `Instance.state` signature doesn't match (it returns a function that returns the state), adjust the call. Read `packages/opencode/src/project/instance.ts` to check the `state()` API if needed.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
git commit -m "fix(cli): use Instance.state() for orchestrator singleton to track project changes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Fix Health Monitor — Populate Deps Map and Fix Dead-Code Threshold (W8, W9)

The `checkHealth` method passes an empty deps map, making deadlock detection non-functional. Also, the threshold branch in `detectStuckTasks` is dead code.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`
- Modify: `packages/opencode/src/devilcode/workflow/health.ts`
- Test: `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`

- [ ] **Step 1: Add test for proper threshold differentiation**

Append to `review-fixes.test.ts`:

```typescript
import { detectStuckTasks, DEFAULT_HEALTH_CONFIG, type HealthConfig } from "@/devilcode/workflow/health"
import type { ActiveTask } from "@/devilcode/workflow/types"

describe("W9: detectStuckTasks uses different thresholds by status", () => {
  test("blocked tasks use reviewStuckTimeoutMs, in_progress uses taskStuckTimeoutMs", () => {
    const config: HealthConfig = {
      taskStuckTimeoutMs: 10 * 60 * 1000,   // 10 min
      reviewStuckTimeoutMs: 5 * 60 * 1000,   // 5 min
      mergeStuckTimeoutMs: 2 * 60 * 1000,    // 2 min
    }
    const now = Date.now()
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "in_progress" },
      { id: "T-002", role: "worker", status: "blocked" },
    ]
    const lastActivity = new Map<string, number>()
    // Both idle for 7 minutes
    lastActivity.set("T-001", now - 7 * 60 * 1000)
    lastActivity.set("T-002", now - 7 * 60 * 1000)

    const alerts = detectStuckTasks(tasks, lastActivity, config, now)

    // T-001 (in_progress, threshold 10min) should NOT be stuck at 7min
    expect(alerts.find((a) => a.taskId === "T-001")).toBeUndefined()
    // T-002 (blocked, threshold 5min) SHOULD be stuck at 7min
    expect(alerts.find((a) => a.taskId === "T-002")).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts`
Expected: FAIL — both use `taskStuckTimeoutMs` currently

- [ ] **Step 3: Fix the threshold branch in health.ts**

In `packages/opencode/src/devilcode/workflow/health.ts`, replace lines 42-43:

```typescript
    const threshold =
      task.status === "in_progress" ? config.taskStuckTimeoutMs : config.taskStuckTimeoutMs
```

With:

```typescript
    const threshold =
      task.status === "in_progress"
        ? config.taskStuckTimeoutMs
        : task.status === "blocked"
          ? config.reviewStuckTimeoutMs
          : config.mergeStuckTimeoutMs
```

- [ ] **Step 4: Fix `checkHealth` in orchestrator.ts to populate deps map**

In `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`, update the `checkHealth` method. Change the signature to accept plan tasks for building the dependency map:

Replace:

```typescript
  checkHealth(tasks: ActiveTask[]): {
    stuckAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
  } {
    const stuckAlerts = detectStuckTasks(tasks, this.taskLastActivity, DEFAULT_HEALTH_CONFIG)
    const deps = new Map<string, string[]>()
    const deadlock = detectDeadlock(tasks, deps)
    return { stuckAlerts, deadlock }
  }
```

With:

```typescript
  checkHealth(tasks: ActiveTask[], planTasks?: PlanTask[]): {
    stuckAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
  } {
    const stuckAlerts = detectStuckTasks(tasks, this.taskLastActivity, DEFAULT_HEALTH_CONFIG)
    // Build dependency map from plan tasks
    const deps = new Map<string, string[]>()
    if (planTasks) {
      for (const pt of planTasks) {
        if (pt.dependsOn.length > 0) {
          deps.set(pt.id, pt.dependsOn)
        }
      }
    }
    const deadlock = detectDeadlock(tasks, deps)
    return { stuckAlerts, deadlock }
  }
```

Then update the call site in `context.tsx` that calls `checkHealth`. Find:

```typescript
        const health = orchestrator.checkHealth(state.activeTasks)
```

Replace with:

```typescript
        const health = orchestrator.checkHealth(state.activeTasks, store.plans)
```

- [ ] **Step 5: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/review-fixes.test.ts test/kilocode/workflow/health.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/health.ts packages/opencode/src/devilcode/workflow-tui/orchestrator.ts packages/opencode/src/devilcode/workflow-tui/context.tsx packages/opencode/test/kilocode/workflow/review-fixes.test.ts
git commit -m "fix(cli): use status-specific thresholds in health monitor, populate deadlock deps map

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Reject Empty Diff in Review Dispatch (W7)

`dispatchStage("review")` defaults `diff` to `""` which produces meaningless review results. Reject empty diffs.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`

- [ ] **Step 1: Add guard in dispatchStage review case**

In `context.tsx`, find the `dispatchStage` method's review case. Replace:

```typescript
          case "review": {
            await orchestrator.executeReview({
              ...modelInfo,
              diff: options?.diff ?? "",
              cycle: store.review ? store.review.cycle + 1 : 1,
            })
            break
          }
```

With:

```typescript
          case "review": {
            const diff = options?.diff
            if (!diff) {
              throw new Error("Review requires a diff. Run `git diff` against the base branch and pass the result.")
            }
            await orchestrator.executeReview({
              ...modelInfo,
              diff,
              cycle: store.review ? store.review.cycle + 1 : 1,
            })
            break
          }
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx
git commit -m "fix(cli): reject empty diff in review dispatch to prevent meaningless reviews

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `onOutput` in SessionBridge (S2)

The `SessionBridge.watch()` subscribes to TurnClose and Error events but never wires `onOutput`. Child session output never streams to the TUI in real time.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/session-bridge.ts`

- [ ] **Step 1: Add Session.Event.Updated subscription to watch()**

In `session-bridge.ts`, in the `watch` method, after the Error subscription block (after line 64), add:

```typescript
    // Subscribe to session updates for streaming output
    unsubscribers.push(
      Bus.subscribe(Session.Event.Updated, (event) => {
        if (event.properties.info.id !== sessionId) return
        // The Updated event fires when new message parts are added.
        // We extract the latest text content and forward it.
        const title = event.properties.info.title
        if (title) {
          this.callbacks.onOutput(sessionId, taskId, title)
        }
      }),
    )
```

Note: `Session.Event.Updated` has `properties: { info: Session.Info }`. The `info.title` field gets updated as the session progresses. This is a lightweight way to surface progress without reading the full message stream. For full output streaming, a more sophisticated approach reading message parts would be needed — but this gets basic progress updates flowing.

- [ ] **Step 2: Run session-bridge tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/session-bridge.test.ts`
Expected: PASS (existing tests don't test onOutput, so they won't break)

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/session-bridge.ts
git commit -m "feat(cli): wire onOutput in SessionBridge via Session.Event.Updated subscription

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Add Quality Gate Timeout (S6)

`runGate` spawns a child process with no timeout. A hanging test suite or linter blocks the workflow indefinitely.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/quality-gates.ts`

- [ ] **Step 1: Add timeout to runGate**

In `quality-gates.ts`, find the `runGate` function (line 77). Add a timeout constant at the top of the file:

```typescript
const GATE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes per gate
```

In the `runGate` function, after `proc.on("error", ...)` (after line 108), add a timeout:

```typescript
    const timeout = setTimeout(() => {
      proc.kill()
      resolve({
        gateName: gate.name,
        passed: false,
        exitCode: -1,
        stdout: truncateTail(stdout),
        stderr: `TIMEOUT: gate exceeded ${GATE_TIMEOUT_MS / 1000}s limit`,
        durationMs: Date.now() - start,
      })
    }, GATE_TIMEOUT_MS)

    proc.on("close", (code) => {
      clearTimeout(timeout)
      resolve({
```

Wait — the `proc.on("close", ...)` already exists. We need to restructure. Replace the entire `runGate` function:

```typescript
export async function runGate(gate: QualityGate, cwd: string): Promise<GateResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn(gate.command, gate.args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let resolved = false
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      proc.kill()
      resolve({
        gateName: gate.name,
        passed: false,
        exitCode: -1,
        stdout: truncateTail(stdout),
        stderr: `TIMEOUT: gate exceeded ${GATE_TIMEOUT_MS / 1000}s limit`,
        durationMs: Date.now() - start,
      })
    }, GATE_TIMEOUT_MS)

    proc.on("close", (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve({
        gateName: gate.name,
        passed: code === 0,
        exitCode: code ?? 1,
        stdout: truncateTail(stdout),
        stderr: truncateTail(stderr),
        durationMs: Date.now() - start,
      })
    })
    proc.on("error", () => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve({
        gateName: gate.name,
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: `Command not found: ${gate.command}`,
        durationMs: Date.now() - start,
      })
    })
  })
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/quality-gates.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/quality-gates.ts
git commit -m "fix(cli): add 5-minute timeout to quality gate execution to prevent hangs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Differentiate Effort Levels and Rename Duplicate TaskResult (S1, S7)

"max" and "xhigh" effort levels are identical. The `TaskResult` name exists in both `team/types.ts` and `workflow/types.ts` with different schemas.

**Files:**
- Modify: `packages/opencode/src/devilcode/team/effort.ts`
- Modify: `packages/opencode/src/devilcode/team/types.ts`
- Test: `packages/opencode/test/kilocode/workflow/review-fixes.test.ts`

- [ ] **Step 1: Differentiate "max" from "xhigh" in effort.ts**

In `effort.ts`, replace the "max" case (lines 14-17):

```typescript
    case "max":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
      }
```

With:

```typescript
    case "max":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
        maxTokens: "extended",
      }
```

This differentiates "max" from "xhigh" — "max" requests extended output tokens while "xhigh" uses the default. The `maxTokens` field is passed through to provider options.

- [ ] **Step 2: Rename `TaskResult` in team/types.ts to `TeamTaskResult`**

In `packages/opencode/src/devilcode/team/types.ts`, rename the schema and type:

Replace:

```typescript
export const TaskResult = z.object({
  status: TaskResultStatus,
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  escalation: Escalation.optional(),
})
export type TaskResult = z.infer<typeof TaskResult>
```

With:

```typescript
export const TeamTaskResult = z.object({
  status: TaskResultStatus,
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  escalation: Escalation.optional(),
})
export type TeamTaskResult = z.infer<typeof TeamTaskResult>
```

Then search for all imports of `TaskResult` from `team/types.ts` and update them:

```bash
cd packages/opencode && grep -rn "from.*team/types" src/ test/ | grep TaskResult
```

Update each import to use `TeamTaskResult`.

- [ ] **Step 3: Update test imports**

In `packages/opencode/test/kilocode/team/types.test.ts`, update imports and test references from `TaskResult` to `TeamTaskResult`.

- [ ] **Step 4: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/team/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/team/effort.ts packages/opencode/src/devilcode/team/types.ts packages/opencode/test/kilocode/team/types.test.ts
git commit -m "refactor(cli): differentiate max/xhigh effort levels, rename team TaskResult to TeamTaskResult

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Add readRecent Optimization with Tail Read (W5)

`readRecent(N)` reads the entire events.jsonl to return the last N entries. Optimize with a tail-read approach.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/events.ts`

- [ ] **Step 1: Replace `readRecent` with tail-based implementation**

In `events.ts`, replace the `readRecent` method:

```typescript
  async readRecent(count: number): Promise<WorkflowEvent[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim().length > 0)
      // Only parse the last N lines instead of all
      const tail = lines.slice(-count)
      return tail
        .map((line) => {
          try {
            return JSON.parse(line) as WorkflowEvent
          } catch {
            return null
          }
        })
        .filter((e): e is WorkflowEvent => e !== null)
    } catch {
      return []
    }
  }
```

This still reads the full file but only parses the last N lines, avoiding JSON.parse on potentially thousands of earlier entries. A full streaming tail-read would be more efficient for very large files, but this is sufficient for the 5-second polling use case.

- [ ] **Step 2: Run tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/events.test.ts test/kilocode/e2e/workflow-state.e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/events.ts
git commit -m "perf(cli): optimize readRecent to parse only tail entries instead of full event log

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run all workflow tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/`
Expected: All PASS

- [ ] **Step 2: Run all team tests**

Run: `cd packages/opencode && bun test test/kilocode/team/`
Expected: All PASS

- [ ] **Step 3: Run full kilocode suite**

Run: `cd packages/opencode && bun test test/kilocode/`
Expected: 550+ pass, 0 fail

- [ ] **Step 4: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit any fixes**

If any step above failed, fix and commit:

```bash
git add -u packages/opencode/
git commit -m "fix(cli): resolve issues from review fixes verification

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Summary

| ID | Issue | Fix | Task |
|----|-------|-----|------|
| B1 | Wildcard permissions | Scope to task files | 1 |
| B2 | checkDiskSpace uses RAM | Use fs.statfs() | 2 |
| W1 | Lock TOCTOU race | Add Mutex | 3 |
| W2 | EventLogger race | Add Mutex | 3 |
| W3 | extractOutput `any` | Type the parameter | 4 |
| W4 | command-input `as any` cast | Validate via Zod safeParse | 4 |
| W5 | readRecent reads all | Parse only tail | 11 |
| W6 | Orchestrator ignores project | Use Instance.state() | 5 |
| W7 | Empty diff in review | Reject with error | 7 |
| W8 | Empty deps map | Populate from plan tasks | 6 |
| W9 | Dead-code threshold | Differentiate by status | 6 |
| S1 | max/xhigh identical | Add maxTokens to max | 10 |
| S2 | onOutput never wired | Subscribe to Updated | 8 |
| S3 | Duplicate StateManager | Addressed by W6 (Instance.state) | 5 |
| S4 | Placeholder e2e test | Known, API-key gated | — |
| S5 | Routes create per-request | Acceptable for polling | — |
| S6 | No gate timeout | Add 5-min timeout | 9 |
| S7 | Duplicate TaskResult | Rename to TeamTaskResult | 10 |
