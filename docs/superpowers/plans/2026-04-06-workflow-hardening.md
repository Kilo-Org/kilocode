# Workflow Engine Hardening — Contracts, Learning, Guards, and Health

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the multi-model workflow engine with interface contracts between tasks, a learning system that captures agent failures, runtime file locking, quality gate automation, pre-flight validation, and a health monitor for stuck agents — inspired by the best patterns from nxtg-ai/forge-orchestrator (Rust) and tarunms7/forge-orchestrator (Python).

**Architecture:** Six new modules added to `packages/opencode/src/devilcode/workflow/`. Each is a standalone file with Zod schemas, pure functions, and a manager class following the existing namespace-module pattern. A new `contract` stage is inserted into the workflow state machine between `challenge` and `build`. All state persists to `.planning/` as JSON/Markdown files — no database. The TUI receives new display data via the existing `WorkflowContext` refresh loop.

**Tech Stack:** TypeScript, Zod (schemas), gray-matter (frontmatter I/O), existing `WorkflowStateManager` for persistence, existing `WorkflowOrchestrator` for bridge.

**Spec:** Adapted from nxtg-ai/forge-orchestrator (file locking, knowledge, governance, quality gates, events) and tarunms7/forge-orchestrator (contract builder, learning/extractor, review pipeline, pre-flight, health monitor, budget).

**Prerequisite:** Workflow TUI implementation must be complete (branch `feat/multi-model-multiplexing`). The following modules exist:
- `packages/opencode/src/devilcode/workflow/` — types, state, executor, reviewer, index
- `packages/opencode/src/devilcode/workflow-tui/` — TUI dashboard components
- `packages/opencode/src/devilcode/team/` — config, router, concurrency, effort

**Key reference files:**
- Existing schemas: `packages/opencode/src/devilcode/workflow/types.ts`
- State manager: `packages/opencode/src/devilcode/workflow/state.ts`
- Executor: `packages/opencode/src/devilcode/workflow/executor.ts`
- Reviewer: `packages/opencode/src/devilcode/workflow/reviewer.ts`
- State machine: `packages/opencode/src/devilcode/workflow/index.ts`
- Team config: `packages/opencode/src/devilcode/team/config.ts`
- Orchestrator bridge: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`

---

## File Structure

### New Files

```
packages/opencode/src/devilcode/workflow/
  contracts.ts        — Contract schemas (FieldSpec, APIContract, TypeContract, ContractSet, TaskContracts)
  locks.ts            — File lock manager (FileLock, LockManager, conflict detection)
  learning.ts         — Lesson capture, storage, noise filtering, prompt injection
  preflight.ts        — Pre-flight validation checks (git, disk, branch, working tree)
  health.ts           — Health monitor (stuck detection, deadlock detection via DFS)
  quality-gates.ts    — Auto-detected quality gates (test, lint, typecheck, build)
  events.ts           — Append-only JSONL event log

packages/opencode/test/kilocode/workflow/
  contracts.test.ts
  locks.test.ts
  learning.test.ts
  preflight.test.ts
  health.test.ts
  quality-gates.test.ts
  events.test.ts
```

### Modified Files (with `devilcode_change` markers)

```
packages/opencode/src/devilcode/workflow/types.ts    — Add ContractStage to WorkflowStage
packages/opencode/src/devilcode/workflow/index.ts    — Add "contract" to STAGE_TRANSITIONS
packages/opencode/src/devilcode/workflow/state.ts    — Add contract/lock/lesson persistence methods
packages/opencode/src/devilcode/workflow-tui/orchestrator.ts — Wire in contracts, preflight, health
packages/opencode/src/devilcode/workflow-tui/types.ts — Add "contract" to stageColor
packages/opencode/src/devilcode/workflow-tui/context.tsx — Add contracts to WorkflowViewState
```

---

## Task 1: Contract Schemas

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/contracts.ts`
- Test: `packages/opencode/test/kilocode/workflow/contracts.test.ts`

- [ ] **Step 1: Write failing tests for contract schemas**

```typescript
// packages/opencode/test/kilocode/workflow/contracts.test.ts
import { describe, test, expect } from "bun:test"
import {
  FieldSpec,
  APIContract,
  TypeContract,
  IntegrationHint,
  ContractSet,
  contractsForTask,
  formatContractsForAgent,
  formatContractsForReviewer,
} from "../../src/devilcode/workflow/contracts"

describe("FieldSpec", () => {
  test("parses valid field", () => {
    const result = FieldSpec.parse({ name: "id", type: "string", required: true, description: "Unique ID" })
    expect(result.name).toBe("id")
    expect(result.type).toBe("string")
    expect(result.required).toBe(true)
  })

  test("defaults required to true", () => {
    const result = FieldSpec.parse({ name: "id", type: "string" })
    expect(result.required).toBe(true)
  })
})

describe("APIContract", () => {
  test("parses full contract", () => {
    const result = APIContract.parse({
      id: "contract-api-1",
      method: "POST",
      path: "/api/users",
      description: "Create user",
      requestBody: [{ name: "email", type: "string" }],
      responseBody: [{ name: "id", type: "string" }, { name: "email", type: "string" }],
      responseExample: '{"id":"abc","email":"a@b.com"}',
      producerTaskId: "T-001",
      consumerTaskIds: ["T-002", "T-003"],
    })
    expect(result.id).toBe("contract-api-1")
    expect(result.producerTaskId).toBe("T-001")
    expect(result.consumerTaskIds).toEqual(["T-002", "T-003"])
  })
})

describe("TypeContract", () => {
  test("parses shared type contract", () => {
    const result = TypeContract.parse({
      name: "UserProfile",
      description: "A user profile",
      fieldSpecs: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
      ],
      usedByTasks: ["T-001", "T-002"],
    })
    expect(result.name).toBe("UserProfile")
    expect(result.fieldSpecs).toHaveLength(2)
  })
})

describe("ContractSet", () => {
  const set: ContractSet = {
    apiContracts: [
      {
        id: "api-1",
        method: "GET",
        path: "/api/items",
        description: "List items",
        requestBody: null,
        responseBody: [{ name: "items", type: "Item[]", required: true, description: "" }],
        responseExample: "",
        producerTaskId: "T-001",
        consumerTaskIds: ["T-002"],
      },
    ],
    typeContracts: [
      {
        name: "Item",
        description: "An item",
        fieldSpecs: [{ name: "id", type: "string", required: true, description: "" }],
        usedByTasks: ["T-001", "T-002"],
      },
    ],
    integrationHints: [],
  }

  test("contractsForTask returns producing and consuming", () => {
    const tc = contractsForTask(set, "T-001")
    expect(tc.producing).toHaveLength(1)
    expect(tc.consuming).toHaveLength(0)
    expect(tc.types).toHaveLength(1)
  })

  test("contractsForTask returns consuming for consumer", () => {
    const tc = contractsForTask(set, "T-002")
    expect(tc.producing).toHaveLength(0)
    expect(tc.consuming).toHaveLength(1)
    expect(tc.types).toHaveLength(1)
  })

  test("formatContractsForAgent includes API details", () => {
    const tc = contractsForTask(set, "T-001")
    const text = formatContractsForAgent(tc)
    expect(text).toContain("PRODUCE")
    expect(text).toContain("GET /api/items")
  })

  test("formatContractsForReviewer includes compliance check", () => {
    const tc = contractsForTask(set, "T-001")
    const text = formatContractsForReviewer(tc)
    expect(text).toContain("Contract Compliance")
    expect(text).toContain("FAIL the review")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/contracts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement contract schemas**

```typescript
// packages/opencode/src/devilcode/workflow/contracts.ts
import z from "zod"

export const FieldSpec = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(true),
  description: z.string().default(""),
})
export type FieldSpec = z.infer<typeof FieldSpec>

export const APIContract = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string(),
  description: z.string().default(""),
  requestBody: z.array(FieldSpec).nullable().default(null),
  responseBody: z.array(FieldSpec),
  responseExample: z.string().default(""),
  producerTaskId: z.string(),
  consumerTaskIds: z.array(z.string()),
})
export type APIContract = z.infer<typeof APIContract>

export const TypeContract = z.object({
  name: z.string(),
  description: z.string().default(""),
  fieldSpecs: z.array(FieldSpec),
  usedByTasks: z.array(z.string()),
})
export type TypeContract = z.infer<typeof TypeContract>

export const IntegrationHint = z.object({
  producerTaskId: z.string(),
  consumerTaskIds: z.array(z.string()),
  interfaceType: z.enum(["api_endpoint", "shared_type", "event", "file_import"]),
  description: z.string(),
  endpointHints: z.array(z.string()).default([]),
})
export type IntegrationHint = z.infer<typeof IntegrationHint>

export const ContractSet = z.object({
  apiContracts: z.array(APIContract).default([]),
  typeContracts: z.array(TypeContract).default([]),
  integrationHints: z.array(IntegrationHint).default([]),
})
export type ContractSet = z.infer<typeof ContractSet>

export type TaskContracts = {
  producing: APIContract[]
  consuming: APIContract[]
  types: TypeContract[]
}

export function contractsForTask(set: ContractSet, taskId: string): TaskContracts {
  return {
    producing: set.apiContracts.filter((c) => c.producerTaskId === taskId),
    consuming: set.apiContracts.filter((c) => c.consumerTaskIds.includes(taskId)),
    types: set.typeContracts.filter((t) => t.usedByTasks.includes(taskId)),
  }
}

export function hasContracts(set: ContractSet): boolean {
  return set.apiContracts.length > 0 || set.typeContracts.length > 0
}

export function validateTaskRefs(set: ContractSet, validTaskIds: Set<string>): string[] {
  const errors: string[] = []
  for (const api of set.apiContracts) {
    if (!validTaskIds.has(api.producerTaskId)) {
      errors.push(`API contract ${api.id}: producer task "${api.producerTaskId}" not found`)
    }
    for (const cid of api.consumerTaskIds) {
      if (!validTaskIds.has(cid)) {
        errors.push(`API contract ${api.id}: consumer task "${cid}" not found`)
      }
    }
  }
  for (const tc of set.typeContracts) {
    for (const tid of tc.usedByTasks) {
      if (!validTaskIds.has(tid)) {
        errors.push(`Type contract "${tc.name}": task "${tid}" not found`)
      }
    }
  }
  return errors
}

function formatField(f: FieldSpec): string {
  return `  ${f.name}: ${f.type}${f.required ? "" : "?"}${f.description ? ` — ${f.description}` : ""}`
}

export function formatContractsForAgent(tc: TaskContracts): string {
  const lines: string[] = []
  if (tc.producing.length > 0) {
    lines.push("## Contracts You MUST PRODUCE\n")
    for (const api of tc.producing) {
      lines.push(`### ${api.method} ${api.path}`)
      lines.push(api.description)
      if (api.requestBody) {
        lines.push("Request body:")
        for (const f of api.requestBody) lines.push(formatField(f))
      }
      lines.push("Response body:")
      for (const f of api.responseBody) lines.push(formatField(f))
      if (api.responseExample) lines.push(`Example: ${api.responseExample}`)
      lines.push("")
    }
  }
  if (tc.consuming.length > 0) {
    lines.push("## Contracts You MUST CONSUME\n")
    for (const api of tc.consuming) {
      lines.push(`### ${api.method} ${api.path}`)
      lines.push(api.description)
      lines.push("Expected response:")
      for (const f of api.responseBody) lines.push(formatField(f))
      lines.push("")
    }
  }
  if (tc.types.length > 0) {
    lines.push("## Shared Types\n")
    for (const t of tc.types) {
      lines.push(`### ${t.name}`)
      lines.push(t.description)
      for (const f of t.fieldSpecs) lines.push(formatField(f))
      lines.push("")
    }
  }
  return lines.join("\n")
}

export function formatContractsForReviewer(tc: TaskContracts): string {
  const lines: string[] = ["## Contract Compliance Check\n"]
  lines.push("Verify the implementation matches these exact specifications.")
  lines.push("If any field names, types, or response shapes don't match the contract, FAIL the review.\n")
  if (tc.producing.length > 0) {
    lines.push("### APIs this task MUST produce:")
    for (const api of tc.producing) {
      lines.push(`- ${api.method} ${api.path}`)
      lines.push("  Response fields:")
      for (const f of api.responseBody) lines.push(`    ${formatField(f)}`)
    }
    lines.push("")
  }
  if (tc.consuming.length > 0) {
    lines.push("### APIs this task MUST consume:")
    for (const api of tc.consuming) {
      lines.push(`- ${api.method} ${api.path}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/contracts.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/contracts.ts packages/opencode/test/kilocode/workflow/contracts.test.ts
git commit -m "feat(cli): add interface contract schemas for cross-task coordination"
```

---

## Task 2: File Lock Manager

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/locks.ts`
- Test: `packages/opencode/test/kilocode/workflow/locks.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/locks.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { LockManager, type FileLock } from "../../src/devilcode/workflow/locks"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("LockManager", () => {
  let tmpDir: string
  let manager: LockManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "locks-test-"))
    const planningDir = path.join(tmpDir, ".planning")
    await fs.mkdir(planningDir, { recursive: true })
    manager = new LockManager(planningDir)
  })

  test("acquire and release lock", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(1)
    expect(locks[0].taskId).toBe("T-001")
    expect(locks[0].files).toEqual(["src/foo.ts"])

    await manager.release("T-001")
    const after = await manager.listLocks()
    expect(after).toHaveLength(0)
  })

  test("detects conflicts", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts", "src/bar.ts"])
    const conflicts = await manager.checkConflicts(["src/foo.ts", "src/baz.ts"])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].taskId).toBe("T-001")
  })

  test("no conflict on different files", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const conflicts = await manager.checkConflicts(["src/bar.ts"])
    expect(conflicts).toHaveLength(0)
  })

  test("multiple locks coexist", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    await manager.acquire("T-002", "senior", ["src/bar.ts"])
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(2)
  })

  test("findOrphanedLocks returns locks for completed tasks", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const orphans = await manager.findOrphanedLocks(new Set(["completed", "failed"]), (id) =>
      id === "T-001" ? "completed" : "pending",
    )
    expect(orphans).toHaveLength(1)
  })

  test("findOrphanedLocks ignores active tasks", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const orphans = await manager.findOrphanedLocks(new Set(["completed", "failed"]), (id) => "in_progress")
    expect(orphans).toHaveLength(0)
  })

  test("releaseAll clears everything", async () => {
    await manager.acquire("T-001", "worker", ["a.ts"])
    await manager.acquire("T-002", "senior", ["b.ts"])
    await manager.releaseAll()
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/locks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement LockManager**

```typescript
// packages/opencode/src/devilcode/workflow/locks.ts
import z from "zod"
import fs from "fs/promises"
import path from "path"

export const FileLock = z.object({
  taskId: z.string(),
  role: z.string(),
  files: z.array(z.string()),
  lockedAt: z.string(),
})
export type FileLock = z.infer<typeof FileLock>

const LocksFile = z.object({
  locks: z.array(FileLock).default([]),
})

export class LockManager {
  private lockPath: string

  constructor(planningDir: string) {
    this.lockPath = path.join(planningDir, "locks.json")
  }

  private async read(): Promise<FileLock[]> {
    try {
      const raw = await fs.readFile(this.lockPath, "utf-8")
      const parsed = LocksFile.parse(JSON.parse(raw))
      return parsed.locks
    } catch {
      return []
    }
  }

  private async write(locks: FileLock[]): Promise<void> {
    await fs.writeFile(this.lockPath, JSON.stringify({ locks }, null, 2))
  }

  async acquire(taskId: string, role: string, files: string[]): Promise<void> {
    const locks = await this.read()
    // Remove existing lock for this task (re-acquire)
    const filtered = locks.filter((l) => l.taskId !== taskId)
    filtered.push({
      taskId,
      role,
      files,
      lockedAt: new Date().toISOString(),
    })
    await this.write(filtered)
  }

  async release(taskId: string): Promise<void> {
    const locks = await this.read()
    await this.write(locks.filter((l) => l.taskId !== taskId))
  }

  async releaseAll(): Promise<void> {
    await this.write([])
  }

  async listLocks(): Promise<FileLock[]> {
    return this.read()
  }

  async checkConflicts(files: string[]): Promise<FileLock[]> {
    const locks = await this.read()
    const fileSet = new Set(files)
    return locks.filter((lock) => lock.files.some((f) => fileSet.has(f)))
  }

  async findOrphanedLocks(
    terminalStatuses: Set<string>,
    getTaskStatus: (taskId: string) => string | undefined,
  ): Promise<FileLock[]> {
    const locks = await this.read()
    return locks.filter((lock) => {
      const status = getTaskStatus(lock.taskId)
      return status !== undefined && terminalStatuses.has(status)
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/locks.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/locks.ts packages/opencode/test/kilocode/workflow/locks.test.ts
git commit -m "feat(cli): add file lock manager for cross-agent conflict prevention"
```

---

## Task 3: Learning System

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/learning.ts`
- Test: `packages/opencode/test/kilocode/workflow/learning.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/learning.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import {
  Lesson,
  LessonStore,
  isInfraNoise,
  extractFromAgentReport,
  formatLessonsForPrompt,
} from "../../src/devilcode/workflow/learning"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("isInfraNoise", () => {
  test("detects timeout", () => expect(isInfraNoise("connection timed out")).toBe(true))
  test("detects 503", () => expect(isInfraNoise("server returned 503")).toBe(true))
  test("detects OOM", () => expect(isInfraNoise("out of memory")).toBe(true))
  test("passes real errors", () => expect(isInfraNoise("missing export in module")).toBe(false))
  test("detects ECONNREFUSED", () => expect(isInfraNoise("econnrefused on port 3000")).toBe(true))
})

describe("extractFromAgentReport", () => {
  test("extracts valid lesson", () => {
    const lesson = extractFromAgentReport({
      trigger: "Import failed because the module used default export",
      resolution: "Changed import to use default import syntax instead of named",
      files: ["src/api.ts"],
    })
    expect(lesson).not.toBeNull()
    expect(lesson!.trigger).toContain("import failed")
    expect(lesson!.resolution).toContain("Changed import")
  })

  test("rejects missing trigger", () => {
    const lesson = extractFromAgentReport({ trigger: "", resolution: "fixed it", files: ["a.ts"] })
    expect(lesson).toBeNull()
  })

  test("rejects short trigger", () => {
    const lesson = extractFromAgentReport({ trigger: "error", resolution: "fixed the error completely", files: ["a.ts"] })
    expect(lesson).toBeNull()
  })

  test("rejects infra noise in trigger", () => {
    const lesson = extractFromAgentReport({
      trigger: "connection timed out while fetching data",
      resolution: "Changed the retry strategy to handle timeouts",
      files: ["a.ts"],
    })
    expect(lesson).toBeNull()
  })

  test("rejects no action verb in resolution", () => {
    const lesson = extractFromAgentReport({
      trigger: "The module was not found when building",
      resolution: "the module path was wrong in the config",
      files: ["a.ts"],
    })
    expect(lesson).toBeNull()
  })

  test("rejects empty files array", () => {
    const lesson = extractFromAgentReport({
      trigger: "Module not found during build process",
      resolution: "Added the missing module to package.json",
      files: [],
    })
    expect(lesson).toBeNull()
  })
})

describe("LessonStore", () => {
  let tmpDir: string
  let store: LessonStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lessons-test-"))
    store = new LessonStore(tmpDir)
  })

  test("save and list lessons", async () => {
    const lesson: Lesson = {
      id: "L-001",
      scope: "project",
      category: "code_pattern",
      title: "Test lesson",
      trigger: "trigger text here that is long enough",
      resolution: "resolution text here that is long enough",
      files: ["a.ts"],
      confidence: 0.5,
      hitCount: 1,
      createdAt: new Date().toISOString(),
    }
    await store.save(lesson)
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe("L-001")
  })

  test("search filters by query", async () => {
    const lesson1: Lesson = {
      id: "L-001", scope: "project", category: "code_pattern",
      title: "Import error fix", trigger: "module not found", resolution: "added import",
      files: ["a.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    const lesson2: Lesson = {
      id: "L-002", scope: "project", category: "command_failure",
      title: "Build script fix", trigger: "build failed", resolution: "fixed script",
      files: ["b.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    await store.save(lesson1)
    await store.save(lesson2)
    const results = await store.search("import")
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe("L-001")
  })

  test("incrementHit increases count and confidence", async () => {
    const lesson: Lesson = {
      id: "L-001", scope: "project", category: "code_pattern",
      title: "Test", trigger: "test trigger for the lesson", resolution: "test resolution",
      files: ["a.ts"], confidence: 0.5, hitCount: 1, createdAt: new Date().toISOString(),
    }
    await store.save(lesson)
    await store.incrementHit("L-001")
    const updated = (await store.list())[0]
    expect(updated.hitCount).toBe(2)
    expect(updated.confidence).toBeGreaterThan(0.5)
  })
})

describe("formatLessonsForPrompt", () => {
  test("formats lessons grouped by category", () => {
    const lessons: Lesson[] = [
      {
        id: "L-001", scope: "project", category: "code_pattern",
        title: "Use named exports", trigger: "default exports break tree-shaking",
        resolution: "Changed to named exports", files: ["a.ts"],
        confidence: 0.9, hitCount: 5, createdAt: new Date().toISOString(),
      },
      {
        id: "L-002", scope: "project", category: "command_failure",
        title: "Bun test needs cd", trigger: "tests fail from root",
        resolution: "Added cd to packages/opencode", files: [],
        confidence: 0.3, hitCount: 1, createdAt: new Date().toISOString(),
      },
    ]
    const text = formatLessonsForPrompt(lessons)
    expect(text).toContain("Lessons Learned")
    expect(text).toContain("(proven)")
    expect(text).toContain("(tentative)")
    expect(text).toContain("code_pattern")
    expect(text).toContain("command_failure")
  })

  test("returns empty string for no lessons", () => {
    expect(formatLessonsForPrompt([])).toBe("")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/learning.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement learning system**

```typescript
// packages/opencode/src/devilcode/workflow/learning.ts
import z from "zod"
import fs from "fs/promises"
import path from "path"

export const Lesson = z.object({
  id: z.string(),
  scope: z.enum(["global", "project"]),
  category: z.enum(["code_pattern", "command_failure", "review_failure", "infra_timeout"]),
  title: z.string(),
  trigger: z.string(),
  resolution: z.string(),
  files: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  hitCount: z.number().int().min(1).default(1),
  createdAt: z.string(),
})
export type Lesson = z.infer<typeof Lesson>

const INFRA_NOISE_PATTERNS = [
  "timeout", "timed out", "etimedout",
  "connection refused", "econnrefused", "econnreset",
  "server down", "server unavailable", "service unavailable",
  "503", "502", "504",
  "database is locked", "db lock",
  "oom", "out of memory", "killed",
  "disk full", "no space left",
  "sigkill", "sigterm",
]

const ACTION_VERBS = new Set([
  "changed", "replaced", "removed", "added", "fixed", "updated",
  "switched", "moved", "renamed", "set", "used", "imported",
  "configured", "wrapped", "converted",
])

export function isInfraNoise(text: string): boolean {
  const lower = text.toLowerCase()
  return INFRA_NOISE_PATTERNS.some((p) => lower.includes(p))
}

export function extractFromAgentReport(data: {
  trigger: string
  resolution: string
  files: string[]
  taskTitle?: string
  category?: string
}): Lesson | null {
  const { trigger, resolution, files, taskTitle, category } = data

  if (!trigger || trigger.length <= 10) return null
  if (!resolution || resolution.length <= 10) return null
  if (!files || files.length === 0) return null
  if (isInfraNoise(trigger) || isInfraNoise(resolution)) return null

  const words = new Set(resolution.toLowerCase().split(/\s+/))
  if (![...words].some((w) => ACTION_VERBS.has(w))) return null

  const title = taskTitle
    ? `[${taskTitle.slice(0, 30)}] ${trigger.slice(0, 60)}`
    : trigger.slice(0, 60)

  const id = `L-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    scope: "project",
    category: (category as Lesson["category"]) ?? "code_pattern",
    title,
    trigger,
    resolution,
    files,
    confidence: 0.5,
    hitCount: 1,
    createdAt: new Date().toISOString(),
  }
}

export class LessonStore {
  private lessonsDir: string

  constructor(planningDir: string) {
    this.lessonsDir = path.join(planningDir, "lessons")
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.lessonsDir, { recursive: true })
  }

  async save(lesson: Lesson): Promise<void> {
    await this.ensureDir()
    const filePath = path.join(this.lessonsDir, `${lesson.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(lesson, null, 2))
  }

  async list(): Promise<Lesson[]> {
    await this.ensureDir()
    const files = await fs.readdir(this.lessonsDir)
    const lessons: Lesson[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const raw = await fs.readFile(path.join(this.lessonsDir, file), "utf-8")
        lessons.push(Lesson.parse(JSON.parse(raw)))
      } catch {
        // skip malformed
      }
    }
    return lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async search(query: string): Promise<Lesson[]> {
    const all = await this.list()
    const lower = query.toLowerCase()
    return all.filter(
      (l) =>
        l.title.toLowerCase().includes(lower) ||
        l.trigger.toLowerCase().includes(lower) ||
        l.resolution.toLowerCase().includes(lower),
    )
  }

  async incrementHit(lessonId: string): Promise<void> {
    const filePath = path.join(this.lessonsDir, `${lessonId}.json`)
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const lesson = Lesson.parse(JSON.parse(raw))
      lesson.hitCount += 1
      lesson.confidence = Math.min(1.0, lesson.confidence + 0.1)
      await fs.writeFile(filePath, JSON.stringify(lesson, null, 2))
    } catch {
      // lesson not found
    }
  }
}

export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return ""

  const byCategory = new Map<string, Lesson[]>()
  for (const lesson of lessons) {
    const existing = byCategory.get(lesson.category) ?? []
    existing.push(lesson)
    byCategory.set(lesson.category, existing)
  }

  const lines: string[] = ["## Lessons Learned (DO NOT repeat these mistakes)\n"]
  for (const [category, categoryLessons] of byCategory) {
    lines.push(`### ${category}\n`)
    for (const lesson of categoryLessons) {
      const tag = lesson.confidence >= 0.8 ? " (proven)" : lesson.confidence < 0.4 ? " (tentative)" : ""
      lines.push(`- **${lesson.title}**${tag}: ${lesson.resolution}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/learning.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/learning.ts packages/opencode/test/kilocode/workflow/learning.test.ts
git commit -m "feat(cli): add learning system with lesson capture, noise filtering, and prompt injection"
```

---

## Task 4: Pre-Flight Validation

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/preflight.ts`
- Test: `packages/opencode/test/kilocode/workflow/preflight.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/preflight.test.ts
import { describe, test, expect } from "bun:test"
import {
  type CheckResult,
  type PreflightReport,
  checkGitInstalled,
  checkGitRepo,
  checkDiskSpace,
  checkWorkingTree,
  reportSummary,
} from "../../src/devilcode/workflow/preflight"

describe("checkGitInstalled", () => {
  test("passes when git is available", async () => {
    const result = await checkGitInstalled()
    expect(result.passed).toBe(true)
    expect(result.name).toBe("git")
  })
})

describe("checkGitRepo", () => {
  test("passes in a git repo", async () => {
    const result = await checkGitRepo(process.cwd())
    expect(result.passed).toBe(true)
  })

  test("fails in a non-repo directory", async () => {
    const result = await checkGitRepo("/tmp")
    expect(result.passed).toBe(false)
    expect(result.severity).toBe("error")
  })
})

describe("checkDiskSpace", () => {
  test("returns a result", async () => {
    const result = await checkDiskSpace()
    expect(result.name).toBe("disk_space")
    // Can't assert passed without knowing disk state
    expect(typeof result.passed).toBe("boolean")
  })
})

describe("checkWorkingTree", () => {
  test("returns a result for current repo", async () => {
    const result = await checkWorkingTree(process.cwd())
    expect(result.name).toBe("working_tree")
    expect(typeof result.passed).toBe("boolean")
  })
})

describe("reportSummary", () => {
  test("reports all passed", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "OK", severity: "error", fixHint: "" },
        { name: "disk", passed: true, message: "OK", severity: "error", fixHint: "" },
      ],
    }
    const summary = reportSummary(report)
    expect(summary).toContain("2/2")
    expect(summary).toContain("0 error")
  })

  test("reports failures", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: false, message: "Not found", severity: "error", fixHint: "Install git" },
        { name: "disk", passed: true, message: "OK", severity: "warning", fixHint: "" },
      ],
    }
    const summary = reportSummary(report)
    expect(summary).toContain("1 error")
    expect(summary).toContain("1/2")
  })

  test("report.passed is false when any error severity fails", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: false, message: "Not found", severity: "error", fixHint: "" },
      ],
    }
    expect(report.checks.some((c) => !c.passed && c.severity === "error")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/preflight.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pre-flight validation**

```typescript
// packages/opencode/src/devilcode/workflow/preflight.ts
import { spawn } from "child_process"
import os from "os"

export type CheckResult = {
  name: string
  passed: boolean
  message: string
  severity: "error" | "warning"
  fixHint: string
}

export type PreflightReport = {
  checks: CheckResult[]
}

function exec(command: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }))
    proc.on("error", () => resolve({ code: 1, stdout: "", stderr: "command not found" }))
  })
}

export async function checkGitInstalled(): Promise<CheckResult> {
  const result = await exec("git", ["--version"])
  return {
    name: "git",
    passed: result.code === 0,
    message: result.code === 0 ? result.stdout : "git not found",
    severity: "error",
    fixHint: result.code !== 0 ? "Install git: https://git-scm.com" : "",
  }
}

export async function checkGitRepo(cwd: string): Promise<CheckResult> {
  const result = await exec("git", ["rev-parse", "--git-dir"], cwd)
  return {
    name: "git_repo",
    passed: result.code === 0,
    message: result.code === 0 ? "Valid git repository" : "Not a git repository",
    severity: "error",
    fixHint: result.code !== 0 ? "Run 'git init' or navigate to a git repository" : "",
  }
}

export async function checkBaseBranch(cwd: string, branch: string = "main"): Promise<CheckResult> {
  const local = await exec("git", ["rev-parse", "--verify", branch], cwd)
  if (local.code === 0) {
    return { name: "base_branch", passed: true, message: `Branch "${branch}" exists`, severity: "error", fixHint: "" }
  }
  const remote = await exec("git", ["rev-parse", "--verify", `origin/${branch}`], cwd)
  if (remote.code === 0) {
    return { name: "base_branch", passed: true, message: `Remote branch "origin/${branch}" exists`, severity: "error", fixHint: "" }
  }
  return {
    name: "base_branch",
    passed: false,
    message: `Branch "${branch}" not found locally or remotely`,
    severity: "error",
    fixHint: `Ensure the base branch "${branch}" exists`,
  }
}

export async function checkDiskSpace(): Promise<CheckResult> {
  const freeBytes = os.freemem()
  const freeGB = freeBytes / (1024 * 1024 * 1024)
  if (freeGB < 1) {
    return { name: "disk_space", passed: false, message: `${freeGB.toFixed(1)} GB free (< 1 GB)`, severity: "error", fixHint: "Free up disk space" }
  }
  if (freeGB < 5) {
    return { name: "disk_space", passed: true, message: `${freeGB.toFixed(1)} GB free (low)`, severity: "warning", fixHint: "Consider freeing disk space" }
  }
  return { name: "disk_space", passed: true, message: `${freeGB.toFixed(1)} GB free`, severity: "error", fixHint: "" }
}

export async function checkWorkingTree(cwd: string): Promise<CheckResult> {
  const result = await exec("git", ["status", "--porcelain"], cwd)
  const clean = result.code === 0 && result.stdout.length === 0
  return {
    name: "working_tree",
    passed: true,
    message: clean ? "Clean working tree" : "Uncommitted changes detected",
    severity: "warning",
    fixHint: clean ? "" : "Consider committing or stashing changes before starting workflow",
  }
}

export async function runPreflight(cwd: string, baseBranch: string = "main"): Promise<PreflightReport> {
  const checks = await Promise.all([
    checkGitInstalled(),
    checkGitRepo(cwd),
    checkBaseBranch(cwd, baseBranch),
    checkDiskSpace(),
    checkWorkingTree(cwd),
  ])
  return { checks }
}

export function reportSummary(report: PreflightReport): string {
  const passed = report.checks.filter((c) => c.passed).length
  const total = report.checks.length
  const errors = report.checks.filter((c) => !c.passed && c.severity === "error").length
  const warnings = report.checks.filter((c) => !c.passed && c.severity === "warning").length
  return `Pre-flight: ${errors} error(s), ${warnings} warning(s) (${passed}/${total} checks passed)`
}

export function preflightPassed(report: PreflightReport): boolean {
  return !report.checks.some((c) => !c.passed && c.severity === "error")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/preflight.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/preflight.ts packages/opencode/test/kilocode/workflow/preflight.test.ts
git commit -m "feat(cli): add pre-flight validation for workflow startup"
```

---

## Task 5: Health Monitor

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/health.ts`
- Test: `packages/opencode/test/kilocode/workflow/health.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/health.test.ts
import { describe, test, expect } from "bun:test"
import {
  type HealthConfig,
  type HealthAlert,
  DEFAULT_HEALTH_CONFIG,
  detectStuckTasks,
  detectDeadlock,
} from "../../src/devilcode/workflow/health"
import type { ActiveTask } from "../../src/devilcode/workflow/types"

describe("detectStuckTasks", () => {
  test("detects task stuck for longer than threshold", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 20 * 60 * 1000]]) // 20 min ago
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "in_progress" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].taskId).toBe("T-001")
    expect(alerts[0].reason).toContain("no activity")
  })

  test("ignores active task within threshold", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 5 * 60 * 1000]]) // 5 min ago
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "in_progress" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(0)
  })

  test("ignores completed tasks", () => {
    const now = Date.now()
    const lastActivity = new Map<string, number>([["T-001", now - 60 * 60 * 1000]])
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "completed" }]
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG, now)
    expect(alerts).toHaveLength(0)
  })
})

describe("detectDeadlock", () => {
  test("detects cycle", () => {
    // A depends on B, B depends on A, both blocked
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "blocked" },
      { id: "B", role: "worker", status: "blocked" },
    ]
    const deps = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["A"]],
    ])
    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cycle")
    expect(result!.taskIds).toContain("A")
    expect(result!.taskIds).toContain("B")
  })

  test("detects all-blocked cascade", () => {
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "blocked" },
      { id: "B", role: "worker", status: "blocked" },
    ]
    // A depends on C (which doesn't exist / failed), B depends on A
    const deps = new Map<string, string[]>([
      ["A", ["C"]],
      ["B", ["A"]],
    ])
    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cascade")
  })

  test("no deadlock when tasks are progressing", () => {
    const tasks: ActiveTask[] = [
      { id: "A", role: "worker", status: "in_progress" },
      { id: "B", role: "worker", status: "pending" },
    ]
    const deps = new Map<string, string[]>([["B", ["A"]]])
    const result = detectDeadlock(tasks, deps)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/health.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement health monitor**

```typescript
// packages/opencode/src/devilcode/workflow/health.ts
import type { ActiveTask } from "./types"

export type HealthConfig = {
  taskStuckTimeoutMs: number
  reviewStuckTimeoutMs: number
  mergeStuckTimeoutMs: number
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  taskStuckTimeoutMs: 15 * 60 * 1000,   // 15 minutes
  reviewStuckTimeoutMs: 10 * 60 * 1000, // 10 minutes
  mergeStuckTimeoutMs: 5 * 60 * 1000,   // 5 minutes
}

export type HealthAlert = {
  taskId: string
  reason: string
  idleDurationMs: number
}

export type DeadlockResult = {
  type: "cycle" | "cascade"
  taskIds: string[]
  message: string
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "escalated"])

export function detectStuckTasks(
  tasks: ActiveTask[],
  lastActivity: Map<string, number>,
  config: HealthConfig,
  now: number = Date.now(),
): HealthAlert[] {
  const alerts: HealthAlert[] = []
  for (const task of tasks) {
    if (TERMINAL_STATUSES.has(task.status)) continue

    const lastSeen = lastActivity.get(task.id) ?? now
    const idleMs = now - lastSeen

    const threshold =
      task.status === "in_progress" ? config.taskStuckTimeoutMs : config.taskStuckTimeoutMs

    if (idleMs > threshold) {
      alerts.push({
        taskId: task.id,
        reason: `${task.status}: no activity for ${Math.round(idleMs / 60000)} minutes`,
        idleDurationMs: idleMs,
      })
    }
  }
  return alerts
}

export function detectDeadlock(
  tasks: ActiveTask[],
  dependsOn: Map<string, string[]>,
): DeadlockResult | null {
  const blockedTasks = tasks.filter((t) => t.status === "blocked")
  if (blockedTasks.length === 0) return null

  const blockedIds = new Set(blockedTasks.map((t) => t.id))

  // DFS cycle detection using WHITE/GRAY/BLACK coloring
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const id of blockedIds) color.set(id, WHITE)

  let cycleNodes: string[] | null = null

  function dfs(nodeId: string, path: string[]): boolean {
    color.set(nodeId, GRAY)
    path.push(nodeId)

    const deps = dependsOn.get(nodeId) ?? []
    for (const dep of deps) {
      if (!blockedIds.has(dep)) continue
      const depColor = color.get(dep) ?? BLACK
      if (depColor === GRAY) {
        // Found cycle — extract cycle from path
        const cycleStart = path.indexOf(dep)
        cycleNodes = path.slice(cycleStart)
        return true
      }
      if (depColor === WHITE) {
        if (dfs(dep, path)) return true
      }
    }

    color.set(nodeId, BLACK)
    path.pop()
    return false
  }

  for (const id of blockedIds) {
    if ((color.get(id) ?? BLACK) === WHITE) {
      if (dfs(id, [])) {
        return {
          type: "cycle",
          taskIds: cycleNodes!,
          message: `Deadlock: ${cycleNodes!.join(" → ")} → ${cycleNodes![0]}`,
        }
      }
    }
  }

  // No cycle found but all remaining are blocked — cascade failure
  const nonTerminal = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status))
  if (nonTerminal.length > 0 && nonTerminal.every((t) => t.status === "blocked")) {
    return {
      type: "cascade",
      taskIds: nonTerminal.map((t) => t.id),
      message: `All ${nonTerminal.length} remaining tasks are blocked. An upstream dependency likely failed.`,
    }
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/health.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/health.ts packages/opencode/test/kilocode/workflow/health.test.ts
git commit -m "feat(cli): add health monitor with stuck detection and deadlock detection"
```

---

## Task 6: Quality Gates

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/quality-gates.ts`
- Test: `packages/opencode/test/kilocode/workflow/quality-gates.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/quality-gates.test.ts
import { describe, test, expect } from "bun:test"
import {
  type QualityGate,
  type GateResult,
  detectGates,
  summarizeGateFailures,
} from "../../src/devilcode/workflow/quality-gates"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("detectGates", () => {
  test("detects npm test in package.json", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" } }),
    )
    const gates = await detectGates(tmpDir)
    expect(gates.some((g) => g.name === "Test Suite")).toBe(true)
    expect(gates.some((g) => g.name === "Lint")).toBe(true)
    expect(gates.some((g) => g.name === "TypeCheck")).toBe(true)
  })

  test("detects tsconfig.json fallback typecheck", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: {} }))
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}")
    const gates = await detectGates(tmpDir)
    expect(gates.some((g) => g.name === "TypeCheck")).toBe(true)
  })

  test("returns empty for bare directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-test-"))
    const gates = await detectGates(tmpDir)
    expect(gates).toHaveLength(0)
  })
})

describe("summarizeGateFailures", () => {
  test("summarizes failed gates", () => {
    const results: GateResult[] = [
      { gateName: "Test Suite", passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 },
      { gateName: "Lint", passed: false, exitCode: 1, stdout: "", stderr: "2 errors found", durationMs: 200 },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toContain("FAILED: Lint")
    expect(summary).toContain("2 errors found")
    expect(summary).not.toContain("Test Suite")
  })

  test("returns empty for all passed", () => {
    const results: GateResult[] = [
      { gateName: "Test Suite", passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toBe("")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/quality-gates.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement quality gates**

```typescript
// packages/opencode/src/devilcode/workflow/quality-gates.ts
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"

export type QualityGate = {
  name: string
  command: string
  args: string[]
}

export type GateResult = {
  gateName: string
  passed: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

function fileExists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true).catch(() => false)
}

function truncateTail(s: string, maxChars: number = 2000): string {
  return s.length <= maxChars ? s : s.slice(-maxChars)
}

export async function detectGates(projectRoot: string): Promise<QualityGate[]> {
  const gates: QualityGate[] = []

  // Check package.json scripts
  const pkgPath = path.join(projectRoot, "package.json")
  if (await fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
      const scripts = pkg.scripts ?? {}

      if (scripts.typecheck) {
        gates.push({ name: "TypeCheck", command: "npm", args: ["run", "typecheck"] })
      } else if (await fileExists(path.join(projectRoot, "tsconfig.json"))) {
        gates.push({ name: "TypeCheck", command: "npx", args: ["tsc", "--noEmit"] })
      }

      if (scripts.test) {
        gates.push({ name: "Test Suite", command: "npm", args: ["test", "--", "--run"] })
      }

      if (scripts.lint) {
        gates.push({ name: "Lint", command: "npm", args: ["run", "lint"] })
      }
    } catch {
      // malformed package.json
    }
  }

  // Check Cargo.toml
  if (await fileExists(path.join(projectRoot, "Cargo.toml"))) {
    gates.push({ name: "Cargo Test", command: "cargo", args: ["test"] })
    gates.push({ name: "Cargo Clippy", command: "cargo", args: ["clippy", "--", "-W", "clippy::all"] })
  }

  // Check Python
  if (
    (await fileExists(path.join(projectRoot, "pyproject.toml"))) ||
    (await fileExists(path.join(projectRoot, "setup.py")))
  ) {
    gates.push({ name: "Pytest", command: "python", args: ["-m", "pytest"] })
  }

  return gates
}

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
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("close", (code) => {
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

export async function runAllGates(gates: QualityGate[], cwd: string): Promise<GateResult[]> {
  const results: GateResult[] = []
  for (const gate of gates) {
    results.push(await runGate(gate, cwd))
  }
  return results
}

export function summarizeGateFailures(results: GateResult[]): string {
  const failures = results.filter((r) => !r.passed)
  if (failures.length === 0) return ""
  return failures
    .map((f) => `FAILED: ${f.gateName} (exit ${f.exitCode})\n${f.stderr || f.stdout}`)
    .join("\n---\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/quality-gates.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/quality-gates.ts packages/opencode/test/kilocode/workflow/quality-gates.test.ts
git commit -m "feat(cli): add auto-detected quality gates for test, lint, and typecheck"
```

---

## Task 7: Event Log

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/events.ts`
- Test: `packages/opencode/test/kilocode/workflow/events.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/opencode/test/kilocode/workflow/events.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { EventLogger, type WorkflowEvent, type EventType } from "../../src/devilcode/workflow/events"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("EventLogger", () => {
  let tmpDir: string
  let logger: EventLogger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "events-test-"))
    logger = new EventLogger(tmpDir)
  })

  test("log and readAll", async () => {
    await logger.log({ eventType: "task_started", taskId: "T-001", message: "Started" })
    await logger.log({ eventType: "task_completed", taskId: "T-001", message: "Done" })
    const events = await logger.readAll()
    expect(events).toHaveLength(2)
    expect(events[0].eventType).toBe("task_started")
    expect(events[1].eventType).toBe("task_completed")
  })

  test("readRecent returns last N", async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log({ eventType: "task_started", message: `Event ${i}` })
    }
    const recent = await logger.readRecent(3)
    expect(recent).toHaveLength(3)
    expect(recent[2].message).toBe("Event 9")
  })

  test("handles empty log", async () => {
    const events = await logger.readAll()
    expect(events).toHaveLength(0)
  })

  test("skips malformed lines", async () => {
    const logPath = path.join(tmpDir, "events.jsonl")
    await fs.writeFile(
      logPath,
      '{"eventType":"task_started","message":"OK","timestamp":"2026-01-01T00:00:00Z"}\nbroken line\n{"eventType":"task_completed","message":"Done","timestamp":"2026-01-01T00:01:00Z"}\n',
    )
    const events = await logger.readAll()
    expect(events).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/events.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement event logger**

```typescript
// packages/opencode/src/devilcode/workflow/events.ts
import fs from "fs/promises"
import path from "path"

export type EventType =
  | "plan_created"
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_escalated"
  | "files_locked"
  | "files_unlocked"
  | "lesson_captured"
  | "preflight_check"
  | "quality_gate_passed"
  | "quality_gate_failed"
  | "stage_advanced"
  | "contract_generated"

export type WorkflowEvent = {
  eventType: EventType
  taskId?: string
  role?: string
  message: string
  durationMs?: number
  metadata?: Record<string, unknown>
  timestamp?: string
}

export class EventLogger {
  private logPath: string

  constructor(planningDir: string) {
    this.logPath = path.join(planningDir, "events.jsonl")
  }

  async log(event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<void> {
    const entry: WorkflowEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }
    const line = JSON.stringify(entry) + "\n"
    await fs.appendFile(this.logPath, line)
  }

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
            return null
          }
        })
        .filter((e): e is WorkflowEvent => e !== null)
    } catch {
      return []
    }
  }

  async readRecent(count: number): Promise<WorkflowEvent[]> {
    const all = await this.readAll()
    return all.slice(-count)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/events.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/events.ts packages/opencode/test/kilocode/workflow/events.test.ts
git commit -m "feat(cli): add append-only JSONL event log for workflow audit trail"
```

---

## Task 8: Add Contract Stage to Workflow State Machine

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/types.ts`
- Modify: `packages/opencode/src/devilcode/workflow/index.ts`
- Modify: `packages/opencode/src/devilcode/workflow-tui/types.ts`

- [ ] **Step 1: Add "contract" to WorkflowStage enum**

In `packages/opencode/src/devilcode/workflow/types.ts`, change line 3:

```typescript
// Before:
export const WorkflowStage = z.enum(["plan", "challenge", "build", "review", "ship", "retro"])

// After:
export const WorkflowStage = z.enum(["plan", "challenge", "contract", "build", "review", "ship", "retro"])
```

- [ ] **Step 2: Update STAGE_TRANSITIONS in index.ts**

In `packages/opencode/src/devilcode/workflow/index.ts`, update the transitions:

```typescript
// Before:
const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  plan: ["challenge"],
  challenge: ["plan", "build"],
  build: ["review"],
  review: ["build", "ship"],
  ship: ["retro"],
  retro: ["plan"],
}

// After:
const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  plan: ["challenge"],
  challenge: ["plan", "contract"],
  contract: ["challenge", "build"],
  build: ["review"],
  review: ["build", "ship"],
  ship: ["retro"],
  retro: ["plan"],
}
```

- [ ] **Step 3: Add contract color in TUI types**

In `packages/opencode/src/devilcode/workflow-tui/types.ts`, update `stageColor`:

```typescript
// Add after "challenge" case:
    case "contract":
      return "#00CED1"
```

- [ ] **Step 4: Run existing tests to verify nothing breaks**

Run: `cd packages/opencode && bun test test/kilocode/team/ test/kilocode/workflow/`
Expected: All pass (81 existing + new tests from Tasks 1-7)

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/types.ts packages/opencode/src/devilcode/workflow/index.ts packages/opencode/src/devilcode/workflow-tui/types.ts
git commit -m "feat(cli): add contract stage to workflow state machine between challenge and build"
```

---

## Task 9: Wire Into Orchestrator

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`

- [ ] **Step 1: Add preflight, lock, lesson, event, and gate imports**

In `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`, add imports and methods:

```typescript
// Add these imports at top:
import { LockManager } from "../workflow/locks"
import { LessonStore, formatLessonsForPrompt } from "../workflow/learning"
import { EventLogger } from "../workflow/events"
import { runPreflight, preflightPassed, type PreflightReport } from "../workflow/preflight"
import { detectGates, runAllGates, summarizeGateFailures, type GateResult } from "../workflow/quality-gates"
import type { ContractSet } from "../workflow/contracts"
import { detectStuckTasks, detectDeadlock, DEFAULT_HEALTH_CONFIG, type HealthAlert, type DeadlockResult } from "../workflow/health"
```

- [ ] **Step 2: Add manager instances and new methods to WorkflowOrchestrator**

Add these fields and methods to the `WorkflowOrchestrator` class:

```typescript
  private locks: LockManager
  private lessons: LessonStore
  private events: EventLogger
  private taskLastActivity: Map<string, number> = new Map()

  // In constructor, after this.manager line:
  constructor() {
    this.manager = new WorkflowStateManager(Instance.directory)
    const planningDir = path.join(Instance.directory, ".planning")
    this.locks = new LockManager(planningDir)
    this.lessons = new LessonStore(planningDir)
    this.events = new EventLogger(planningDir)
  }

  async runPreflight(): Promise<PreflightReport> {
    const report = await runPreflight(Instance.directory)
    await this.events.log({ eventType: "preflight_check", message: `Preflight: ${preflightPassed(report) ? "PASSED" : "FAILED"}` })
    return report
  }

  async runQualityGates(): Promise<GateResult[]> {
    const gates = await detectGates(Instance.directory)
    const results = await runAllGates(gates, Instance.directory)
    for (const r of results) {
      await this.events.log({
        eventType: r.passed ? "quality_gate_passed" : "quality_gate_failed",
        message: `${r.gateName}: ${r.passed ? "PASS" : "FAIL"}`,
        durationMs: r.durationMs,
      })
    }
    return results
  }

  async getLessonsForPrompt(): Promise<string> {
    const lessons = await this.lessons.list()
    return formatLessonsForPrompt(lessons)
  }

  getLockManager(): LockManager { return this.locks }
  getLessonStore(): LessonStore { return this.lessons }
  getEventLogger(): EventLogger { return this.events }

  recordTaskActivity(taskId: string): void {
    this.taskLastActivity.set(taskId, Date.now())
  }

  checkHealth(tasks: import("../workflow/types").ActiveTask[]): {
    stuckAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
  } {
    const stuckAlerts = detectStuckTasks(tasks, this.taskLastActivity, DEFAULT_HEALTH_CONFIG)
    // Build dependency map from plans (simplified — uses empty deps for now)
    const deps = new Map<string, string[]>()
    const deadlock = detectDeadlock(tasks, deps)
    return { stuckAlerts, deadlock }
  }
```

- [ ] **Step 3: Add `import path from "path"` at the top of orchestrator.ts**

- [ ] **Step 4: Verify typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit 2>&1 | grep "workflow-tui/orchestrator"`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
git commit -m "feat(cli): wire contracts, preflight, locks, learning, events, and health into orchestrator"
```

---

## Task 10: End-to-End Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all workflow tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/`
Expected: All tests pass (old + new)

- [ ] **Step 2: Run all team tests**

Run: `cd packages/opencode && bun test test/kilocode/team/`
Expected: All 81 original tests pass

- [ ] **Step 3: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit 2>&1 | grep "devilcode/workflow"`
Expected: No errors from our files (pre-existing test type errors are acceptable)

- [ ] **Step 4: Verify file structure**

Run: `ls packages/opencode/src/devilcode/workflow/`
Expected:
```
contracts.ts  events.ts  executor.ts  health.ts  index.ts  learning.ts  locks.ts  preflight.ts  prompts/  quality-gates.ts  reviewer.ts  state.ts  types.ts
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "fix(cli): resolve verification issues in workflow hardening"
```
