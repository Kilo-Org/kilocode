# Backend Architecture Audit Report - Devil Code (Kilo Code)

**Date:** 2026-04-10  
**Auditor:** Backend Architect Agent  
**Scope:** Comprehensive backend audit of packages/opencode/src/server/, packages/opencode/src/devilcode/workflow/, packages/opencode/src/storage/, packages/opencode/src/tool/, and packages/devil-vscode/src/services/cli-backend/

---

## Executive Summary

This audit examined the Devil Code monorepo's backend architecture across critical components. **9 issues** were identified ranging from **CRITICAL** to **LOW** severity. The most significant concerns are an empty catch block that could mask cache corruption, race conditions in mutex handling, and missing cleanup operations that could lead to resource leaks.

---

## Critical Findings

### 1. CRITICAL: Empty Catch Block Masking Cache Corruption

**File:** `packages/opencode/src/global/index.ts`  
**Line:** 52  
**Severity:** CRITICAL

**Issue:**
```typescript
try {
  const contents = await fs.readdir(Global.Path.cache)
  await Promise.all(
    contents.map((item) =>
      fs.rm(path.join(Global.Path.cache, item), {
        recursive: true,
        force: true,
      }),
    ),
  )
} catch (e) {} // <-- EMPTY CATCH BLOCK
```

**Why It's Problematic:**
- Cache migration failures are silently swallowed
- Could leave corrupted cache state across app restarts
- No logging means failures are invisible in production
- Violates the AGENTS.md rule: "Never leave a catch block empty"

**Suggested Fix:**
```typescript
} catch (e) {
  log.error("cache migration failed", { error: e })
  // Consider re-throwing or marking cache as corrupted
}
```

---

## High Severity Findings

### 2. HIGH: Unhandled Promise Rejection in Server Manager Kill

**File:** `packages/devil-vscode/src/services/cli-backend/server-manager.ts`  
**Lines:** 225-232 (in killProcess method)  
**Severity:** HIGH

**Issue:**
```typescript
private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (proc.pid === undefined) {
    return
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, signal)
    } else {
      proc.kill(signal)
    }
  } catch {
    // Process already gone — ignore
  }
}
```

**Why It's Problematic:**
- Only catches kill() errors but doesn't handle async cleanup failures
- `proc.on("exit")` callback not awaited - process could zombie
- No timeout fallback if SIGTERM fails to terminate

**Suggested Fix:**
```typescript
private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (proc.pid === undefined) return
  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, signal)
    } else {
      proc.kill(signal)
    }
  } catch (e) {
    log.debug("process kill failed", { pid: proc.pid, error: e })
  }
  
  // Ensure cleanup with timeout
  const timeout = setTimeout(() => {
    if (proc.exitCode === null) {
      log.warn("force killing zombie process", { pid: proc.pid })
      try { proc.kill("SIGKILL") } catch {}
    }
  }, 5000)
  timeout.unref?.()
}
```

---

### 3. HIGH: Missing Release Lock Cleanup on Build Failure

**File:** `packages/opencode/src/devilcode/workflow/build-runner.ts`  
**Lines:** 230-280  
**Severity:** HIGH

**Issue:**
```typescript
// Acquire concurrency slot before execution
if (resolved && roleConfig) {
  concurrency.acquire(resolved.role, task.id)
}

const next = worktree
  ? await Instance.provide({...})
  : await run()

// Release concurrency slot after execution
if (resolved && roleConfig) {
  concurrency.release(resolved.role, task.id) // <-- Only on success path
}
```

**Why It's Problematic:**
- Concurrency slot is NOT released in the catch block
- Failed tasks will hold concurrency slots indefinitely
- Will cause `TeamConcurrencyError` for subsequent tasks
- Creates a slow resource leak that requires restart

**Suggested Fix:**
```typescript
let next: { message: any; session: any }
try {
  next = worktree
    ? await Instance.provide({...})
    : await run()
} finally {
  // Always release slot
  if (resolved && roleConfig) {
    concurrency.release(resolved.role, task.id)
  }
}
```

---

### 4. HIGH: Mutex Queue Memory Leak on Rapid Operations

**File:** `packages/opencode/src/devilcode/workflow/mutex.ts`  
**Lines:** 17-32  
**Severity:** HIGH

**Issue:**
```typescript
private release(): void {
  const next = this.queue.shift()
  if (next) {
    next()
  } else {
    this.locked = false
  }
}
```

**Why It's Problematic:**
- No queue size limit - can grow unbounded
- Rejected/migrated promises leave orphaned resolvers in queue
- No timeout on acquire - can hang forever
- Pattern used in LockManager, EventLogger, LessonStore

**Suggested Fix:**
```typescript
export class Mutex {
  private queue: Array<() => void> = []
  private locked = false
  private maxQueueSize = 100

  async run<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    const release = await this.acquire(timeoutMs)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private acquire(timeoutMs: number): Promise<() => void> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Mutex queue overflow")
    }
    // ... implement timeout
  }
}
```

---

## Medium Severity Findings

### 5. MEDIUM: Race Condition in Workflow Routes Error Handling

**File:** `packages/opencode/src/devilcode/workflow/routes.ts`  
**Lines:** 40-50, 70-80, etc.  
**Severity:** MEDIUM

**Issue:**
```typescript
.get("/status", ...)
async (c) => {
  const manager = new WorkflowStateManager(Instance.directory)
  if (!(await manager.hasWorkflow())) {
    return c.json({ initialized: false as const })
  }
  try {
    const state = await manager.readState()
    return c.json(state)
  } catch {  // <-- Bare catch
    return c.json({ initialized: false as const })
  }
}
```

**Why It's Problematic:**
- Bare catch blocks swallow ALL errors
- File corruption vs "not found" both return same response
- No distinction between transient vs permanent failures
- Multiple endpoints share this pattern

**Suggested Fix:**
```typescript
} catch (e) {
  if (isENOENT(e)) {
    return c.json({ initialized: false })
  }
  log.error("workflow status read failed", { error: e })
  return c.json({ error: "Internal error" }, 500)
}
```

---

### 6. MEDIUM: Silent Failures in Event Log Parsing

**File:** `packages/opencode/src/devilcode/workflow/events.ts`  
**Lines:** 45-60  
**Severity:** MEDIUM

**Issue:**
```typescript
async readAll(): Promise<WorkflowEvent[]> {
  try {
    const content = await fs.readFile(this.logPath, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as WorkflowEvent
        } catch {
          return null // <-- Silent corruption
        }
      })
      .filter((e): e is WorkflowEvent => e !== null)
  } catch {
    return []
  }
}
```

**Why It's Problematic:**
- Corrupted event lines are silently dropped
- No alerting for data loss in audit trail
- Partial corruption could hide critical events
- No recovery mechanism

**Suggested Fix:**
```typescript
} catch (parseError) {
  log.warn("corrupted event log entry", { 
    line: line.substring(0, 100), 
    error: parseError 
  })
  corruptLines++
  return null
}
// After loop:
if (corruptLines > 0) {
  log.error("event log has corruption", { 
    path: this.logPath, 
    corruptLines,
    totalLines: lines.length 
  })
}
```

---

### 7. MEDIUM: Race Condition in SSE Health Check vs Connection State

**File:** `packages/devil-vscode/src/services/cli-backend/sdk-sse-adapter.ts`  
**Lines:** 225-245  
**Severity:** MEDIUM

**Issue:**
```typescript
private async checkHealth(baseUrl: string, password: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${baseUrl}/global/health`, {...})
    clearTimeout(timer)  // <-- Not cleared on error path
    return res.ok
  } catch {
    return false
  }
}
```

**Why It's Problematic:**
- Timer not cleared on error path (memory leak on repeated failures)
- 3s timeout with 10s poll interval means overlapping checks possible
- No exponential backoff on repeated failures

**Suggested Fix:**
```typescript
private async checkHealth(baseUrl: string, password: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${baseUrl}/global/health`, {...})
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)  // Always clear
  }
}
```

---

## Low Severity Findings

### 8. LOW: Inconsistent Error Handling in Workflow Routes

**File:** `packages/opencode/src/devilcode/workflow/routes.ts`  
**Multiple locations**  
**Severity:** LOW

**Issue:**
Multiple endpoints use `try { ... } catch { return c.json([]) }` pattern:
- `/locks` returns `[]` on error
- `/events` returns `[]` on error  
- `/lessons` returns `[]` on error

**Why It's Problematic:**
- Clients can't distinguish between "no data" vs "error occurred"
- Could mask underlying issues during debugging
- Inconsistent with other routes that return 500

**Suggested Fix:**
Standardize error handling - return 500 for unexpected errors, empty array only for legitimate empty state.

---

### 9. LOW: No Validation on Event Logger Append

**File:** `packages/opencode/src/devilcode/workflow/events.ts`  
**Line:** 22  
**Severity:** LOW

**Issue:**
```typescript
async log(event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
  return this.mutex.run(async () => {
    const entry: WorkflowEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }
    const line = JSON.stringify(entry) + "\n"
    await fs.appendFile(this.logPath, line)  // <-- No validation
  })
}
```

**Why It's Problematic:**
- No validation that event matches WorkflowEvent schema
- Invalid data could corrupt the log for future reads
- Should use Zod.parse() before writing

**Suggested Fix:**
```typescript
const validated = WorkflowEvent.parse(entry)
const line = JSON.stringify(validated) + "\n"
```

---

## Architecture Observations

### Positive Patterns Observed

1. **Good use of lazy initialization** in `packages/opencode/src/util/lazy.ts`
2. **Proper transaction handling** in `packages/opencode/src/storage/db.ts` with context-based transactions
3. **Comprehensive CORS configuration** in server.ts with proper whitelist handling
4. **Health check polling** in connection-service.ts for detecting zombie connections
5. **Process group management** for clean process termination

### Areas for Improvement

1. **Mutex pattern needs hardening** - consider using a battle-tested library like `async-mutex`
2. **Missing circuit breaker** for external API calls in MCP/oauth handlers
3. **No request ID propagation** - would help with debugging distributed traces
4. **Inconsistent response schemas** - some errors return plain strings, others return structured objects

---

## Test Coverage Gaps

Based on review of test files, the following areas need additional coverage:

1. Concurrency limit exhaustion scenarios in build-runner.ts
2. Mutex stress testing with high contention
3. SSE adapter reconnection behavior under network failures
4. LockManager cleanup on process crash

---

## Recommendations Summary

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Fix empty catch in global/index.ts | 30 min | Prevents silent cache corruption |
| P0 | Fix concurrency leak in build-runner.ts | 1 hour | Prevents resource exhaustion |
| P1 | Fix mutex queue overflow | 2 hours | Prevents memory DoS |
| P1 | Fix timer leak in SSE health check | 30 min | Prevents memory leak |
| P2 | Standardize error handling in workflow routes | 2 hours | Improves debugging |
| P2 | Add validation to event logging | 1 hour | Prevents data corruption |
| P3 | Add comprehensive test coverage | 4 hours | Prevents regressions |

---

## Conclusion

The backend architecture shows solid foundations with proper transaction handling and modular design. The critical issues (empty catch blocks, resource leaks) should be addressed immediately to prevent production issues. The high-severity mutex and concurrency issues require architectural improvements to ensure reliability under load.

All findings have been documented with specific file paths, line numbers, and suggested fixes for immediate remediation.
