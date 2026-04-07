# Core Execution Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the multi-model multiplexing system end-to-end so that workflow stages actually dispatch LLM calls and spawn agent sessions, turning the existing plumbing into a working pipeline.

**Architecture:** Each workflow stage (plan, challenge, contract, build, review) gets a dedicated dispatch function in `dispatch.ts`. Plan/challenge/review use the Vercel AI SDK's `generateObject` for structured output. Build uses the existing `Session.create` + `SessionPrompt.prompt` to spawn child sessions with worktrees. A `SessionBridge` subscribes to child session bus events and pipes output into the TUI's reactive store.

**Tech Stack:** TypeScript, Vercel AI SDK (`generateObject`/`generateText`), Zod schemas, SolidJS stores, existing `Session`/`Provider`/`Worktree`/`Bus` namespaces.

**Scope:** This plan covers gaps 1-6 from the feature gap analysis (core execution — the "water" for the plumbing). Gaps 7-13 (integration wiring), 14-17 (polish), and 18-20 (not started) are separate plans.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/opencode/src/devilcode/workflow/dispatch.ts` | LLM dispatch for plan, challenge, review stages |
| Create | `packages/opencode/src/devilcode/workflow/build-runner.ts` | Build-stage execution loop: session creation, worktree assignment, wave sequencing |
| Create | `packages/opencode/src/devilcode/workflow/session-bridge.ts` | Subscribe to child session bus events, pipe into TUI store callbacks |
| Create | `packages/opencode/src/devilcode/workflow/contract-generator.ts` | Template-based contract generation from PlanTask integration hints |
| Create | `packages/opencode/test/kilocode/workflow/dispatch.test.ts` | Tests for dispatch module |
| Create | `packages/opencode/test/kilocode/workflow/build-runner.test.ts` | Tests for build runner |
| Create | `packages/opencode/test/kilocode/workflow/session-bridge.test.ts` | Tests for session bridge |
| Create | `packages/opencode/test/kilocode/workflow/contract-generator.test.ts` | Tests for contract generation |
| Modify | `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts` | Wire dispatch, build-runner, session-bridge into orchestrator |
| Modify | `packages/opencode/src/devilcode/workflow-tui/context.tsx` | Wire session bridge into TUI context on build stage |
| Modify | `packages/opencode/src/devilcode/workflow/types.ts` | Add TaskResult schema for build output |

---

## Task 1: Add TaskResult Schema

The build stage needs a schema for what agents return when they complete (or fail) a task. This doesn't exist yet — `types.ts` has `ActiveTask` (status tracking) and `PlanTask` (plan definition) but no result schema.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow/types.ts`
- Test: `packages/opencode/test/kilocode/workflow/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `types.test.ts`:

```typescript
// At the end of the existing test file, add:

describe("TaskResult", () => {
  it("parses a completed result", () => {
    const result = TaskResult.parse({
      taskId: "task-1",
      status: "completed",
      output: "Implemented the feature",
      filesModified: ["src/foo.ts", "src/bar.ts"],
    })
    expect(result.status).toBe("completed")
    expect(result.filesModified).toEqual(["src/foo.ts", "src/bar.ts"])
  })

  it("parses a failed result with error", () => {
    const result = TaskResult.parse({
      taskId: "task-1",
      status: "failed",
      output: "Could not resolve type error",
      filesModified: [],
      error: "TypeScript error in src/foo.ts:42",
    })
    expect(result.status).toBe("failed")
    expect(result.error).toBe("TypeScript error in src/foo.ts:42")
  })

  it("parses an escalated result", () => {
    const result = TaskResult.parse({
      taskId: "task-1",
      status: "escalated",
      output: "Security review needed",
      filesModified: [],
      escalationReason: "Found potential SQL injection",
    })
    expect(result.status).toBe("escalated")
    expect(result.escalationReason).toBe("Found potential SQL injection")
  })

  it("defaults filesModified to empty array", () => {
    const result = TaskResult.parse({
      taskId: "task-1",
      status: "completed",
      output: "Done",
    })
    expect(result.filesModified).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/types.test.ts`
Expected: FAIL — `TaskResult` is not exported from `types.ts`

- [ ] **Step 3: Add TaskResult to types.ts**

Add after the `ActiveTask` schema (after line 87):

```typescript
export const TaskResult = z.object({
  taskId: z.string(),
  status: z.enum(["completed", "failed", "escalated", "blocked"]),
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  error: z.string().optional(),
  escalationReason: z.string().optional(),
})
export type TaskResult = z.infer<typeof TaskResult>
```

- [ ] **Step 4: Update test import**

In `types.test.ts`, update the import to include `TaskResult`:

```typescript
import { WorkflowStage, PlanTask, ChallengeConcern, PlanChallenge, ReviewFinding, ReviewVerdict, ActiveTask, WorkflowState, TaskResult } from "@/devilcode/workflow/types"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/opencode && bun test test/kilocode/workflow/types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/types.ts packages/opencode/test/kilocode/workflow/types.test.ts
git commit -m "feat(cli): add TaskResult schema for build stage output"
```

---

## Task 2: Plan-Stage Dispatch — Tests

Write tests for the plan-stage dispatch function. The dispatch module uses `generateObject` from the AI SDK with the orchestrator's model to decompose a prompt into `PlanTask[]`. We mock `generateObject` since we don't call real LLMs in unit tests.

**Files:**
- Create: `packages/opencode/test/kilocode/workflow/dispatch.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { PlanTask, PlanChallenge, ReviewVerdict, ReviewFinding } from "@/devilcode/workflow/types"

// Mock the AI SDK generateObject
const mockGenerateObject = mock(() =>
  Promise.resolve({
    object: [],
  }),
)
mock.module("ai", () => ({
  generateObject: mockGenerateObject,
  jsonSchema: (s: any) => s,
}))

// Mock Provider to avoid real provider initialization
const mockGetModel = mock(() =>
  Promise.resolve({
    id: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
    capabilities: { temperature: true },
    options: {},
  }),
)
const mockGetLanguage = mock(() => Promise.resolve({ languageModel: true }))

mock.module("@/provider/provider", () => ({
  Provider: {
    getModel: mockGetModel,
    getLanguage: mockGetLanguage,
  },
}))

// Import after mocks
const { dispatchPlan, dispatchChallenge, dispatchReview } = await import(
  "@/devilcode/workflow/dispatch"
)

describe("dispatchPlan", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns parsed PlanTask array from LLM response", async () => {
    const tasks = [
      {
        id: "task-1",
        title: "Set up database schema",
        role: "worker",
        wave: 1,
        dependsOn: [],
        estimatedComplexity: "medium",
        files: ["src/db/schema.ts"],
        verification: ["bun test test/db/schema.test.ts"],
        description: "Create the database schema for user management",
      },
      {
        id: "task-2",
        title: "Implement auth middleware",
        role: "senior",
        wave: 2,
        dependsOn: ["task-1"],
        estimatedComplexity: "high",
        files: ["src/auth/middleware.ts"],
        verification: ["bun test test/auth/middleware.test.ts"],
        description: "Add JWT-based authentication middleware",
      },
    ]
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: { tasks } }))

    const result = await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "Build a user management system",
      availableRoles: ["orchestrator", "senior", "worker"],
    })

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("task-1")
    expect(result[0].wave).toBe(1)
    expect(result[1].dependsOn).toEqual(["task-1"])
  })

  it("passes phase context as user message content", async () => {
    mockGenerateObject.mockImplementation(() =>
      Promise.resolve({ object: { tasks: [] } }),
    )

    await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "My specific requirements",
      availableRoles: ["senior", "worker"],
    })

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    const call = mockGenerateObject.mock.calls[0][0]
    const userMsg = call.messages.find((m: any) => m.role === "user")
    expect(userMsg.content).toContain("My specific requirements")
  })

  it("includes available roles in the user message", async () => {
    mockGenerateObject.mockImplementation(() =>
      Promise.resolve({ object: { tasks: [] } }),
    )

    await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "Build X",
      availableRoles: ["architect", "coder", "tester"],
    })

    const call = mockGenerateObject.mock.calls[0][0]
    const userMsg = call.messages.find((m: any) => m.role === "user")
    expect(userMsg.content).toContain("architect")
    expect(userMsg.content).toContain("coder")
    expect(userMsg.content).toContain("tester")
  })
})

describe("dispatchChallenge", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns a PlanChallenge from LLM response", async () => {
    const challenge = {
      planId: "phase-1",
      verdict: "approved",
      concerns: [],
      summary: "Plan looks solid",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: challenge }))

    const result = await dispatchChallenge({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      planTasks: [
        {
          id: "task-1",
          title: "Do thing",
          role: "worker",
          wave: 1,
          dependsOn: [],
          estimatedComplexity: "low",
          files: ["src/thing.ts"],
          verification: ["bun test"],
          description: "Implement the thing",
        },
      ],
      phaseContext: "Build a feature",
    })

    expect(result.verdict).toBe("approved")
    expect(result.concerns).toEqual([])
  })

  it("returns concerns when plan has issues", async () => {
    const challenge = {
      planId: "phase-1",
      verdict: "revise",
      concerns: [
        {
          severity: "critical",
          category: "file-conflict",
          description: "Tasks 1 and 2 in wave 1 both modify src/foo.ts",
          suggestedChange: "Move task-2 to wave 2",
          affectedTasks: ["task-1", "task-2"],
        },
      ],
      summary: "File conflict detected",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: challenge }))

    const result = await dispatchChallenge({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      planTasks: [],
      phaseContext: "Build a feature",
    })

    expect(result.verdict).toBe("revise")
    expect(result.concerns).toHaveLength(1)
    expect(result.concerns[0].severity).toBe("critical")
  })
})

describe("dispatchReview", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns a ReviewVerdict from LLM response", async () => {
    const verdict = {
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All changes look good",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: verdict }))

    const result = await dispatchReview({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      summaries: ["task-1: Added schema migration"],
      diff: "diff --git a/src/db.ts ...",
      cycle: 1,
    })

    expect(result.verdict).toBe("pass")
    expect(result.cycle).toBe(1)
    expect(result.findings).toEqual([])
  })

  it("returns findings when review finds issues", async () => {
    const verdict = {
      verdict: "fail",
      cycle: 1,
      findings: [
        {
          id: "R-01",
          severity: "blocker",
          category: "security",
          file: "src/auth.ts",
          line: 42,
          description: "Password stored in plaintext",
          suggestedFix: "Use bcrypt to hash passwords",
          suggestedRole: "senior",
          verificationCommand: "bun test test/auth.test.ts",
        },
      ],
      blockerCount: 1,
      warningCount: 0,
      suggestionCount: 0,
      summary: "Security issue found",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: verdict }))

    const result = await dispatchReview({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      summaries: ["task-1: Added auth"],
      diff: "diff ...",
      cycle: 1,
    })

    expect(result.verdict).toBe("fail")
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("blocker")
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/dispatch.test.ts`
Expected: FAIL — `dispatch.ts` doesn't exist yet

- [ ] **Step 3: Commit the test file**

```bash
git add packages/opencode/test/kilocode/workflow/dispatch.test.ts
git commit -m "test(cli): add tests for workflow dispatch (plan/challenge/review)"
```

---

## Task 3: Plan-Stage Dispatch — Implementation

Implement the dispatch module that uses `generateObject` to invoke LLMs for the plan, challenge, and review stages. This module resolves the orchestrator's model via `Provider`, creates an AI SDK language model, and calls `generateObject` with the appropriate Zod schema and prompt template.

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/dispatch.ts`

- [ ] **Step 1: Create the dispatch module**

```typescript
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { mergeDeep } from "remeda"
import { Log } from "@/util/log"
import { PlanTask, PlanChallenge, ReviewVerdict, ReviewFinding } from "./types"
import PLAN_PROMPT from "./prompts/plan.txt"
import CHALLENGE_PROMPT from "./prompts/challenge.txt"
import REVIEW_PROMPT from "./prompts/review.txt"

const log = Log.create({ service: "workflow.dispatch" })

// --- Shared helper ---

async function resolveModel(providerID: string, modelID: string) {
  const model = await Provider.getModel(providerID, modelID)
  const language = await Provider.getLanguage(model)
  return { model, language }
}

// --- Plan Stage ---

export type PlanDispatchInput = {
  providerID: string
  modelID: string
  phaseContext: string
  availableRoles: string[]
  lessons?: string
}

export async function dispatchPlan(input: PlanDispatchInput): Promise<PlanTask[]> {
  log.info("dispatchPlan", { providerID: input.providerID, modelID: input.modelID })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const userContent = [
    `## Phase Requirements\n\n${input.phaseContext}`,
    `## Available Roles\n\n${input.availableRoles.join(", ")}`,
    ...(input.lessons ? [`## Lessons from Previous Runs\n\n${input.lessons}`] : []),
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.3 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: PLAN_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: z.object({
      tasks: z.array(PlanTask),
    }),
  })

  log.info("dispatchPlan complete", { taskCount: result.object.tasks.length })
  return result.object.tasks
}

// --- Challenge Stage ---

export type ChallengeDispatchInput = {
  providerID: string
  modelID: string
  planTasks: PlanTask[]
  phaseContext: string
}

export async function dispatchChallenge(input: ChallengeDispatchInput): Promise<PlanChallenge> {
  log.info("dispatchChallenge", { providerID: input.providerID, taskCount: input.planTasks.length })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const taskSummary = input.planTasks
    .map(
      (t) =>
        `- **${t.id}** (wave ${t.wave}, role: ${t.role}, complexity: ${t.estimatedComplexity}): ${t.title}\n  Files: ${t.files.join(", ") || "none"}\n  Depends on: ${t.dependsOn.join(", ") || "none"}`,
    )
    .join("\n")

  const userContent = [
    `## Phase Context\n\n${input.phaseContext}`,
    `## Plan Tasks\n\n${taskSummary}`,
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.2 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: CHALLENGE_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: PlanChallenge,
  })

  log.info("dispatchChallenge complete", { verdict: result.object.verdict })
  return result.object
}

// --- Review Stage ---

export type ReviewDispatchInput = {
  providerID: string
  modelID: string
  summaries: string[]
  diff: string
  cycle: number
  gateResults?: string
}

export async function dispatchReview(input: ReviewDispatchInput): Promise<ReviewVerdict> {
  log.info("dispatchReview", { providerID: input.providerID, cycle: input.cycle })

  const { model, language } = await resolveModel(input.providerID, input.modelID)

  const userContent = [
    `## Review Cycle ${input.cycle}`,
    `## Task Summaries\n\n${input.summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `## Code Changes\n\n\`\`\`diff\n${input.diff}\n\`\`\``,
    ...(input.gateResults ? [`## Quality Gate Results\n\n${input.gateResults}`] : []),
  ].join("\n\n")

  const result = await generateObject({
    model: language,
    temperature: model.capabilities.temperature ? 0.2 : undefined,
    providerOptions: ProviderTransform.providerOptions(
      model,
      mergeDeep(ProviderTransform.smallOptions(model), model.options),
    ),
    maxRetries: 2,
    system: REVIEW_PROMPT,
    messages: [{ role: "user" as const, content: userContent }],
    schema: ReviewVerdict,
  })

  log.info("dispatchReview complete", {
    verdict: result.object.verdict,
    findings: result.object.findings.length,
  })
  return result.object
}
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/dispatch.test.ts`
Expected: PASS — all dispatch tests should pass with the mocked AI SDK

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/dispatch.ts
git commit -m "feat(cli): add LLM dispatch for plan, challenge, and review stages"
```

---

## Task 4: Contract Generator — Tests

The contract stage generates `ContractSet` objects from `PlanTask[]` integration hints. Since LLM-based generation was deferred, this uses a template/heuristic approach: it scans task files and descriptions for shared types and API endpoints.

**Files:**
- Create: `packages/opencode/test/kilocode/workflow/contract-generator.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect } from "bun:test"
import type { PlanTask } from "@/devilcode/workflow/types"
import { generateContracts } from "@/devilcode/workflow/contract-generator"

function makeTasks(overrides: Partial<PlanTask>[]): PlanTask[] {
  return overrides.map((o, i) => ({
    id: o.id ?? `task-${i + 1}`,
    title: o.title ?? `Task ${i + 1}`,
    role: o.role ?? "worker",
    wave: o.wave ?? 1,
    dependsOn: o.dependsOn ?? [],
    estimatedComplexity: o.estimatedComplexity ?? "medium",
    files: o.files ?? [],
    verification: o.verification ?? [],
    description: o.description ?? "",
  }))
}

describe("generateContracts", () => {
  it("returns empty contract set when no tasks share files", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/a.ts"] },
      { id: "t2", files: ["src/b.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.apiContracts).toEqual([])
    expect(result.typeContracts).toEqual([])
    expect(result.integrationHints).toEqual([])
  })

  it("detects shared file as a type contract", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/types.ts", "src/a.ts"] },
      { id: "t2", files: ["src/types.ts", "src/b.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.typeContracts.length).toBeGreaterThanOrEqual(1)
    const shared = result.typeContracts.find((c) => c.name.includes("types"))
    expect(shared).toBeDefined()
    expect(shared!.usedByTasks).toContain("t1")
    expect(shared!.usedByTasks).toContain("t2")
  })

  it("generates integration hint for cross-wave dependency", () => {
    const tasks = makeTasks([
      { id: "t1", wave: 1, files: ["src/api/users.ts"] },
      { id: "t2", wave: 2, dependsOn: ["t1"], files: ["src/api/auth.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.integrationHints.length).toBeGreaterThanOrEqual(1)
    const hint = result.integrationHints[0]
    expect(hint.producerTaskId).toBe("t1")
    expect(hint.consumerTaskIds).toContain("t2")
    expect(hint.interfaceType).toBe("file_import")
  })

  it("handles tasks with no files gracefully", () => {
    const tasks = makeTasks([
      { id: "t1", files: [] },
      { id: "t2", files: [] },
    ])
    const result = generateContracts(tasks)
    expect(result.apiContracts).toEqual([])
    expect(result.typeContracts).toEqual([])
  })

  it("validates task refs in generated contracts", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/shared.ts"] },
      { id: "t2", files: ["src/shared.ts"] },
    ])
    const result = generateContracts(tasks)
    const validIds = new Set(tasks.map((t) => t.id))
    for (const tc of result.typeContracts) {
      for (const taskId of tc.usedByTasks) {
        expect(validIds.has(taskId)).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/contract-generator.test.ts`
Expected: FAIL — `contract-generator.ts` doesn't exist

- [ ] **Step 3: Commit the test file**

```bash
git add packages/opencode/test/kilocode/workflow/contract-generator.test.ts
git commit -m "test(cli): add tests for template-based contract generation"
```

---

## Task 5: Contract Generator — Implementation

Implement the contract generator. This analyzes `PlanTask[]` for shared files (type contracts) and cross-wave dependencies (integration hints). No LLM involved — pure heuristic analysis.

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/contract-generator.ts`

- [ ] **Step 1: Create the contract generator**

```typescript
import path from "path"
import type { PlanTask } from "./types"
import type { ContractSet, TypeContract, IntegrationHint } from "./contracts"

/**
 * Generates a ContractSet from PlanTask[] using heuristic analysis:
 * - Shared files between tasks → TypeContract
 * - Cross-wave dependencies → IntegrationHint
 *
 * This is a template-based approach (no LLM). A future version could use
 * LLM-based generation for richer API contracts.
 */
export function generateContracts(tasks: PlanTask[]): ContractSet {
  const typeContracts = detectSharedFiles(tasks)
  const integrationHints = detectCrossWaveDeps(tasks)

  return {
    apiContracts: [],
    typeContracts,
    integrationHints,
  }
}

function detectSharedFiles(tasks: PlanTask[]): TypeContract[] {
  // Build a map of file → list of task IDs that touch it
  const fileToTasks = new Map<string, string[]>()
  for (const task of tasks) {
    for (const file of task.files) {
      const existing = fileToTasks.get(file) ?? []
      existing.push(task.id)
      fileToTasks.set(file, existing)
    }
  }

  const contracts: TypeContract[] = []
  for (const [file, taskIds] of fileToTasks) {
    if (taskIds.length < 2) continue

    const basename = path.basename(file, path.extname(file))
    contracts.push({
      name: basename,
      description: `Shared file: ${file} — modified by tasks ${taskIds.join(", ")}`,
      fieldSpecs: [],
      usedByTasks: taskIds,
    })
  }

  return contracts
}

function detectCrossWaveDeps(tasks: PlanTask[]): IntegrationHint[] {
  // Group consumers by their dependency (producer)
  const producerToConsumers = new Map<string, Set<string>>()
  const taskMap = new Map<string, PlanTask>()
  for (const task of tasks) {
    taskMap.set(task.id, task)
  }

  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      const dep = taskMap.get(depId)
      if (!dep) continue
      if (dep.wave >= task.wave) continue // Same-wave or reverse — skip

      const consumers = producerToConsumers.get(depId) ?? new Set()
      consumers.add(task.id)
      producerToConsumers.set(depId, consumers)
    }
  }

  const hints: IntegrationHint[] = []
  for (const [producerId, consumerIds] of producerToConsumers) {
    const producer = taskMap.get(producerId)!
    const consumers = [...consumerIds]
    hints.push({
      interfaceType: "file_import",
      producerTaskId: producerId,
      consumerTaskIds: consumers,
      description: `Task "${producer.title}" produces output consumed by tasks ${consumers.join(", ")}`,
      endpointHints: [],
    })
  }

  return hints
}
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/contract-generator.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck to verify types align with contracts.ts**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow/contract-generator.ts`

If `ContractSet`, `TypeContract`, `IntegrationHint` are not directly exported as types from `contracts.ts`, adjust the import. Check `contracts.ts` for exact export shapes and align.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/contract-generator.ts
git commit -m "feat(cli): add template-based contract generator from PlanTask analysis"
```

---

## Task 6: Build Runner — Tests

The build runner is the most complex new module. It creates child sessions, assigns worktrees, and executes waves sequentially (tasks within a wave run in parallel). Each task gets its own session with the appropriate model (resolved via TeamConfig).

**Files:**
- Create: `packages/opencode/test/kilocode/workflow/build-runner.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { PlanTask, ActiveTask, TaskResult } from "@/devilcode/workflow/types"
import type { WorkflowState } from "@/devilcode/workflow/types"

// Mock dependencies
const mockSessionCreate = mock(() =>
  Promise.resolve({ id: "session-001", slug: "test-session" }),
)
const mockSessionPrompt = mock(() =>
  Promise.resolve({ info: { role: "assistant" } }),
)
const mockWorktreeCreate = mock(() =>
  Promise.resolve({ name: "brave-cabin", branch: "opencode/brave-cabin", directory: "/tmp/worktree-1" }),
)
const mockWorktreeRemove = mock(() => Promise.resolve())

mock.module("@/session", () => ({
  Session: {
    create: mockSessionCreate,
    Event: {
      TurnClose: { type: "session.turn.close" },
    },
  },
}))

mock.module("@/session/prompt", () => ({
  SessionPrompt: {
    prompt: mockSessionPrompt,
  },
}))

mock.module("@/worktree", () => ({
  Worktree: {
    create: mockWorktreeCreate,
    remove: mockWorktreeRemove,
  },
}))

mock.module("@/bus", () => ({
  Bus: {
    subscribe: mock(() => () => {}),
    publish: mock(() => Promise.resolve()),
  },
}))

const { BuildRunner } = await import("@/devilcode/workflow/build-runner")

function makeTask(overrides: Partial<PlanTask>): PlanTask {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Test task",
    role: overrides.role ?? "worker",
    wave: overrides.wave ?? 1,
    dependsOn: overrides.dependsOn ?? [],
    estimatedComplexity: overrides.estimatedComplexity ?? "medium",
    files: overrides.files ?? [],
    verification: overrides.verification ?? [],
    description: overrides.description ?? "Do the thing",
  }
}

describe("BuildRunner", () => {
  beforeEach(() => {
    mockSessionCreate.mockReset()
    mockSessionPrompt.mockReset()
    mockWorktreeCreate.mockReset()
    mockWorktreeRemove.mockReset()
    mockSessionCreate.mockImplementation(() =>
      Promise.resolve({ id: "session-001", slug: "test-session" }),
    )
    mockWorktreeCreate.mockImplementation(() =>
      Promise.resolve({
        name: "brave-cabin",
        branch: "opencode/brave-cabin",
        directory: "/tmp/worktree-1",
      }),
    )
  })

  it("groups tasks by wave and returns them sorted", () => {
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    const tasks = [
      makeTask({ id: "t1", wave: 2 }),
      makeTask({ id: "t2", wave: 1 }),
      makeTask({ id: "t3", wave: 1 }),
    ]

    const waves = runner.groupWaves(tasks)
    expect([...waves.keys()]).toEqual([1, 2])
    expect(waves.get(1)).toHaveLength(2)
    expect(waves.get(2)).toHaveLength(1)
  })

  it("calls onTaskStart for each task", async () => {
    const started: string[] = []
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: (taskId, sessionId) => started.push(taskId),
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [],
      }),
    )

    const tasks = [makeTask({ id: "t1", wave: 1 })]
    await runner.executeWave(tasks)

    expect(started).toContain("t1")
  })

  it("calls onTaskComplete when task session finishes", async () => {
    const completed: Array<{ taskId: string; status: string }> = []
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: (taskId, result) => completed.push({ taskId, status: result.status }),
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [],
      }),
    )

    const tasks = [makeTask({ id: "t1", wave: 1 })]
    await runner.executeWave(tasks)

    expect(completed).toHaveLength(1)
    expect(completed[0].taskId).toBe("t1")
    expect(completed[0].status).toBe("completed")
  })

  it("creates worktrees for parallel tasks in the same wave", async () => {
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [],
      }),
    )

    const tasks = [
      makeTask({ id: "t1", wave: 1 }),
      makeTask({ id: "t2", wave: 1 }),
    ]
    await runner.executeWave(tasks)

    // When wave has >1 task, worktrees should be created for isolation
    expect(mockWorktreeCreate).toHaveBeenCalledTimes(2)
  })

  it("skips worktree for single-task wave", async () => {
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [],
      }),
    )

    const tasks = [makeTask({ id: "t1", wave: 1 })]
    await runner.executeWave(tasks)

    // Single task in wave — no worktree needed, runs in main directory
    expect(mockWorktreeCreate).toHaveBeenCalledTimes(0)
  })

  it("marks task as failed when session throws", async () => {
    const completed: Array<{ taskId: string; status: string }> = []
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: (taskId, result) => completed.push({ taskId, status: result.status }),
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() => Promise.reject(new Error("LLM timeout")))

    const tasks = [makeTask({ id: "t1", wave: 1 })]
    await runner.executeWave(tasks)

    expect(completed).toHaveLength(1)
    expect(completed[0].status).toBe("failed")
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/build-runner.test.ts`
Expected: FAIL — `build-runner.ts` doesn't exist

- [ ] **Step 3: Commit the test**

```bash
git add packages/opencode/test/kilocode/workflow/build-runner.test.ts
git commit -m "test(cli): add tests for build-stage execution runner"
```

---

## Task 7: Build Runner — Implementation

The build runner creates child sessions for each task, optionally assigning worktrees for parallel execution. It executes waves sequentially — all tasks in wave N complete before wave N+1 starts.

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/build-runner.ts`

- [ ] **Step 1: Create the build runner module**

```typescript
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Worktree } from "@/worktree"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { resolveTaskModel } from "../team/router"
import { groupByWave } from "./executor"
import type { PlanTask, TaskResult } from "./types"
import type { TeamConfig } from "../team/config"
import BUILD_PROMPT from "./prompts/build.txt"

const log = Log.create({ service: "workflow.build-runner" })

export type BuildCallbacks = {
  onTaskStart: (taskId: string, sessionId: string) => void
  onTaskComplete: (taskId: string, result: TaskResult) => void
  onOutput: (taskId: string, sessionId: string, line: string) => void
}

export type BuildRunnerOptions = {
  teamConfig: TeamConfig | undefined
} & BuildCallbacks

export class BuildRunner {
  private options: BuildRunnerOptions

  constructor(options: BuildRunnerOptions) {
    this.options = options
  }

  /**
   * Group tasks by wave number, sorted ascending.
   */
  groupWaves(tasks: PlanTask[]): Map<number, PlanTask[]> {
    return groupByWave(tasks)
  }

  /**
   * Execute all tasks in a single wave concurrently.
   * Creates worktrees when multiple tasks run in parallel.
   */
  async executeWave(tasks: PlanTask[]): Promise<TaskResult[]> {
    const needsWorktrees = tasks.length > 1
    log.info("executeWave", { taskCount: tasks.length, needsWorktrees })

    const results = await Promise.all(
      tasks.map((task) => this.executeTask(task, needsWorktrees)),
    )
    return results
  }

  /**
   * Execute all waves sequentially. Wave N+1 starts only after all tasks
   * in wave N complete.
   */
  async executeAll(tasks: PlanTask[]): Promise<TaskResult[]> {
    const waves = this.groupWaves(tasks)
    const allResults: TaskResult[] = []

    for (const [waveNum, waveTasks] of waves) {
      log.info("starting wave", { wave: waveNum, tasks: waveTasks.length })
      const waveResults = await this.executeWave(waveTasks)
      allResults.push(...waveResults)

      // Check for blockers — if any task in this wave failed, stop
      const failures = waveResults.filter((r) => r.status === "failed")
      if (failures.length > 0) {
        log.info("wave failed, stopping build", {
          wave: waveNum,
          failures: failures.map((f) => f.taskId),
        })
        // Mark remaining tasks as blocked
        for (const [laterWave, laterTasks] of waves) {
          if (laterWave <= waveNum) continue
          for (const task of laterTasks) {
            allResults.push({
              taskId: task.id,
              status: "blocked",
              output: `Blocked: wave ${waveNum} had failures`,
              filesModified: [],
            })
          }
        }
        break
      }
    }

    return allResults
  }

  private async executeTask(task: PlanTask, useWorktree: boolean): Promise<TaskResult> {
    let worktree: Worktree.Info | undefined
    try {
      // Create worktree if running in parallel
      if (useWorktree) {
        worktree = await Worktree.create({ name: `wf-${task.id}` })
        log.info("worktree created", { taskId: task.id, directory: worktree.directory })
      }

      // Resolve model from team config if available
      const resolved = resolveTaskModel({
        subagentType: task.role,
        teamConfig: this.options.teamConfig,
        parentRole: "orchestrator",
      })

      // Create child session
      const session = await Session.create({
        title: `[workflow] ${task.title}`,
        permission: [
          { permission: "*", action: "allow", pattern: "*" },
        ],
      })

      this.options.onTaskStart(task.id, session.id)

      // Build the task prompt
      const taskPrompt = [
        BUILD_PROMPT,
        `\n## Your Task\n`,
        `**ID:** ${task.id}`,
        `**Title:** ${task.title}`,
        `**Description:** ${task.description}`,
        `**Files to modify:** ${task.files.join(", ") || "none specified"}`,
        `**Verification:** ${task.verification.join("\n- ") || "none specified"}`,
      ].join("\n")

      // Send prompt to session
      const message = await SessionPrompt.prompt({
        sessionID: session.id,
        ...(resolved
          ? {
              model: {
                providerID: resolved.model.providerID,
                modelID: resolved.model.modelID,
              },
            }
          : {}),
        parts: [{ type: "text", text: taskPrompt }],
      })

      const result: TaskResult = {
        taskId: task.id,
        status: "completed",
        output: extractOutput(message),
        filesModified: task.files,
      }

      this.options.onTaskComplete(task.id, result)
      return result
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
    } finally {
      // Clean up worktree if we created one
      if (worktree) {
        await Worktree.remove({ directory: worktree.directory }).catch((e) => {
          log.error("worktree cleanup failed", { taskId: task.id, error: String(e) })
        })
      }
    }
  }
}

function extractOutput(message: any): string {
  if (!message?.parts) return ""
  return message.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
    .slice(0, 2000) // Truncate to avoid bloating state
}
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/build-runner.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/build-runner.ts
git commit -m "feat(cli): add build-stage execution runner with wave sequencing and worktrees"
```

---

## Task 8: Session Bridge — Tests

The session bridge subscribes to Bus events from child sessions and pipes output into the TUI's reactive store. This bridges the gap between the async session execution and the TUI's display.

**Files:**
- Create: `packages/opencode/test/kilocode/workflow/session-bridge.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test"

// Track what the bridge subscribes to
const subscriptions: Array<{ type: string; callback: Function }> = []
const mockSubscribe = mock((def: any, callback: Function) => {
  subscriptions.push({ type: def.type, callback })
  return () => {
    const idx = subscriptions.findIndex((s) => s.callback === callback)
    if (idx >= 0) subscriptions.splice(idx, 1)
  }
})

mock.module("@/bus", () => ({
  Bus: {
    subscribe: mockSubscribe,
  },
}))

mock.module("@/session", () => ({
  Session: {
    Event: {
      Updated: { type: "session.updated" },
      TurnOpen: { type: "session.turn.open" },
      TurnClose: { type: "session.turn.close" },
      Error: { type: "session.error" },
    },
  },
}))

mock.module("@/session/message-v2", () => ({
  MessageV2: {
    stream: mock(() => []),
  },
}))

const { SessionBridge } = await import("@/devilcode/workflow/session-bridge")

describe("SessionBridge", () => {
  beforeEach(() => {
    subscriptions.length = 0
    mockSubscribe.mockClear()
  })

  it("subscribes to session events on start", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")

    expect(subscriptions.length).toBeGreaterThan(0)
  })

  it("calls onStatusChange when turn closes with completed", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    // Simulate TurnClose event
    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    expect(closeSubscription).toBeDefined()
    closeSubscription!.callback({
      properties: { sessionID: "session-001", reason: "completed" },
    })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe("completed")
  })

  it("calls onStatusChange with failed on error close", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    closeSubscription!.callback({
      properties: { sessionID: "session-001", reason: "error" },
    })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe("failed")
  })

  it("ignores events for unwatched sessions", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    closeSubscription!.callback({
      properties: { sessionID: "session-999", reason: "completed" },
    })

    expect(statuses).toHaveLength(0)
  })

  it("unsubscribes on unwatch", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")
    const countBefore = subscriptions.length

    bridge.unwatch("session-001")
    // Subscriptions should be cleaned up
    expect(subscriptions.length).toBeLessThan(countBefore)
  })

  it("unwatchAll cleans up all subscriptions", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")
    bridge.watch("session-002", "task-2")

    bridge.unwatchAll()
    expect(subscriptions.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd packages/opencode && bun test test/kilocode/workflow/session-bridge.test.ts`
Expected: FAIL — `session-bridge.ts` doesn't exist

- [ ] **Step 3: Commit the test**

```bash
git add packages/opencode/test/kilocode/workflow/session-bridge.test.ts
git commit -m "test(cli): add tests for session bridge (child session → TUI output pipe)"
```

---

## Task 9: Session Bridge — Implementation

The bridge watches child sessions via Bus subscriptions and forwards events to callbacks. The TUI context will wire these callbacks to its SolidJS store.

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/session-bridge.ts`

- [ ] **Step 1: Create the session bridge module**

```typescript
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Log } from "@/util/log"

const log = Log.create({ service: "workflow.session-bridge" })

export type SessionBridgeCallbacks = {
  onOutput: (sessionId: string, taskId: string, line: string) => void
  onStatusChange: (
    sessionId: string,
    status: "running" | "completed" | "failed" | "escalated",
  ) => void
}

type WatchedSession = {
  sessionId: string
  taskId: string
  unsubscribers: Array<() => void>
}

/**
 * Bridges child session Bus events into callback functions.
 * The TUI context wires these callbacks to its SolidJS store
 * to update the workflow dashboard in real time.
 */
export class SessionBridge {
  private callbacks: SessionBridgeCallbacks
  private watched = new Map<string, WatchedSession>()

  constructor(callbacks: SessionBridgeCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Start watching a child session's events.
   */
  watch(sessionId: string, taskId: string): void {
    if (this.watched.has(sessionId)) return

    log.info("watching session", { sessionId, taskId })

    const unsubscribers: Array<() => void> = []

    // Subscribe to turn close events (completion/failure)
    unsubscribers.push(
      Bus.subscribe(Session.Event.TurnClose, (event) => {
        if (event.properties.sessionID !== sessionId) return

        const reason = event.properties.reason
        const status = reason === "completed" ? "completed"
          : reason === "interrupted" ? "failed"
          : "failed"

        log.info("session turn closed", { sessionId, taskId, reason, status })
        this.callbacks.onStatusChange(sessionId, status)
      }),
    )

    // Subscribe to error events
    unsubscribers.push(
      Bus.subscribe(Session.Event.Error, (event) => {
        if (event.properties.sessionID !== sessionId) return

        log.info("session error", { sessionId, taskId })
        this.callbacks.onStatusChange(sessionId, "failed")
      }),
    )

    this.watched.set(sessionId, { sessionId, taskId, unsubscribers })
  }

  /**
   * Stop watching a specific session.
   */
  unwatch(sessionId: string): void {
    const entry = this.watched.get(sessionId)
    if (!entry) return

    log.info("unwatching session", { sessionId, taskId: entry.taskId })
    for (const unsub of entry.unsubscribers) {
      unsub()
    }
    this.watched.delete(sessionId)
  }

  /**
   * Stop watching all sessions. Call on workflow reset or stage transition.
   */
  unwatchAll(): void {
    for (const [sessionId] of this.watched) {
      this.unwatch(sessionId)
    }
  }

  /**
   * Get the task ID associated with a watched session.
   */
  getTaskId(sessionId: string): string | undefined {
    return this.watched.get(sessionId)?.taskId
  }

  /**
   * Check if a session is being watched.
   */
  isWatching(sessionId: string): boolean {
    return this.watched.has(sessionId)
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/session-bridge.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/session-bridge.ts
git commit -m "feat(cli): add session bridge for child session event → TUI output piping"
```

---

## Task 10: Wire Dispatch into Orchestrator

Connect the dispatch functions and build runner to the `WorkflowOrchestrator` so that `executeStage()` calls in the TUI actually invoke LLMs and spawn agents.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`

- [ ] **Step 1: Read the current orchestrator to confirm the exact code to replace**

Run: `cd packages/opencode && cat -n src/devilcode/workflow-tui/orchestrator.ts`

Confirm the file matches what we read earlier (174 lines, imports at top, class body, singleton at bottom).

- [ ] **Step 2: Add imports for new modules at the top of orchestrator.ts**

After the existing imports (line 16), add:

```typescript
import { dispatchPlan, dispatchChallenge, dispatchReview } from "../workflow/dispatch"
import { BuildRunner, type BuildCallbacks } from "../workflow/build-runner"
import { SessionBridge, type SessionBridgeCallbacks } from "../workflow/session-bridge"
import { generateContracts } from "../workflow/contract-generator"
import type { TaskResult } from "../workflow/types"
```

- [ ] **Step 3: Add executePlan method to WorkflowOrchestrator**

After the `advanceStage` method (after line 68), add:

```typescript
  /**
   * Execute the plan stage: invoke LLM to decompose phase requirements into PlanTask[].
   * Writes tasks to .planning/ and logs events.
   */
  async executePlan(input: {
    providerID: string
    modelID: string
    phaseContext: string
    availableRoles: string[]
  }): Promise<PlanTask[]> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const lessons = await this.getLessonsForPrompt()
    const tasks = await dispatchPlan({
      ...input,
      lessons: lessons || undefined,
    })

    // Write each task to .planning/
    for (const task of tasks) {
      await this.manager.writePlan(state.currentPhase, task)
    }

    await this.events.log({
      eventType: "plan_created",
      message: `Generated ${tasks.length} tasks in ${new Set(tasks.map((t) => t.wave)).size} waves`,
    })

    return tasks
  }
```

- [ ] **Step 4: Add executeChallenge method**

After the `executePlan` method, add:

```typescript
  /**
   * Execute the challenge stage: invoke LLM to review the current plan.
   * Returns a PlanChallenge with verdict and concerns.
   */
  async executeChallenge(input: {
    providerID: string
    modelID: string
    phaseContext: string
  }): Promise<PlanChallenge> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const challenge = await dispatchChallenge({
      ...input,
      planTasks: plans,
    })

    await this.events.log({
      eventType: "stage_advanced",
      message: `Challenge verdict: ${challenge.verdict} (${challenge.concerns.length} concerns)`,
    })

    return challenge
  }
```

- [ ] **Step 5: Add executeContracts method**

After `executeChallenge`, add:

```typescript
  /**
   * Execute the contract stage: generate contracts from plan tasks.
   */
  async executeContracts(): Promise<ContractSet> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const plans = await this.manager.readAllPlans(state.currentPhase)
    const contracts = generateContracts(plans)

    await this.events.log({
      eventType: "contract_generated",
      message: `Generated ${contracts.typeContracts.length} type contracts, ${contracts.integrationHints.length} integration hints`,
    })

    return contracts
  }
```

- [ ] **Step 6: Add executeBuild method**

After `executeContracts`, add:

```typescript
  /**
   * Execute the build stage: run all task waves sequentially.
   * Each task gets its own session, and parallel tasks get worktrees.
   */
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

    const results = await runner.executeAll(plans)

    // Write summaries for completed tasks
    for (const result of results) {
      if (result.status === "completed") {
        await this.manager.writeSummary(
          state.currentPhase,
          result.taskId,
          result.output,
        )
      }
    }

    return results
  }
```

- [ ] **Step 7: Add executeReview method**

After `executeBuild`, add:

```typescript
  /**
   * Execute the review stage: invoke LLM to review build output.
   */
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

    await this.manager.writeReview(state.currentPhase, verdict)

    await this.events.log({
      eventType: "stage_advanced",
      message: `Review cycle ${input.cycle}: ${verdict.verdict} (${verdict.findings.length} findings)`,
    })

    return verdict
  }
```

- [ ] **Step 8: Add the missing import for PlanChallenge type**

At line 14, update the type import to include `PlanChallenge`:

```typescript
import type { WorkflowStage, PlanTask, PlanChallenge, ReviewFinding, ReviewVerdict, ActiveTask, TaskResult } from "../workflow/types"
```

- [ ] **Step 9: Check if readSummary exists on WorkflowStateManager**

Run: `cd packages/opencode && grep -n "readSummary" src/devilcode/workflow/state.ts`

If `readSummary` doesn't exist, add it to `state.ts`:

```typescript
  async readSummary(phaseSlug: string, taskId: string): Promise<string> {
    const summaryPath = path.join(this.basePath, ".planning", "phases", phaseSlug, `${taskId}-SUMMARY.md`)
    return await fs.readFile(summaryPath, "utf-8")
  }
```

- [ ] **Step 10: Run tests to verify nothing broke**

Run: `cd packages/opencode && bun test test/kilocode/workflow/`
Expected: All existing workflow tests still pass

- [ ] **Step 11: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts packages/opencode/src/devilcode/workflow/state.ts
git commit -m "feat(cli): wire dispatch, build-runner, and contract-generator into orchestrator"
```

---

## Task 11: Wire Session Bridge and Build into TUI Context

Connect the session bridge into the TUI context so that when the build stage executes, child session events update the SolidJS store in real time.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`

- [ ] **Step 1: Read the current context file**

Run: `cd packages/opencode && cat -n src/devilcode/workflow-tui/context.tsx`

Confirm it matches what we read (218 lines).

- [ ] **Step 2: Add import for SessionBridge**

At the top of `context.tsx`, after the existing imports (after line 9), add:

```typescript
import { SessionBridge } from "../workflow/session-bridge"
import { getOrchestrator } from "./orchestrator"
import type { TaskResult } from "../workflow/types"
```

- [ ] **Step 3: Create bridge instance and wire into store**

Inside `WorkflowProvider`, after the `const [store, setStore] = createStore(...)` block (after line 66), add:

```typescript
  const bridge = new SessionBridge({
    onOutput(sessionId, taskId, line) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.output.push(line)
          }
        }),
      )
    },
    onStatusChange(sessionId, status) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.status = status
          }
        }),
      )
    },
  })

  // Clean up bridge subscriptions on unmount
  onCleanup(() => bridge.unwatchAll())
```

- [ ] **Step 4: Add startBuild action to the value object**

In the `value` object (inside `WorkflowProvider`), after the `setExecuting` function (around line 200), add:

```typescript
    async startBuild(teamConfig: TeamConfig | undefined) {
      setStore("executing", true)
      const orchestrator = getOrchestrator()

      try {
        const results = await orchestrator.executeBuild(
          {
            onTaskStart: (taskId, sessionId) => {
              // Register session in store
              setStore(
                produce((s) => {
                  s.activeSessions[sessionId] = {
                    sessionId,
                    taskId,
                    role: "worker",
                    status: "running",
                    output: [],
                  }
                }),
              )
              // Add agent tab for this task
              const task = store.plans.find((p) => p.id === taskId)
              value.addAgentTab({
                id: `agent-${taskId}`,
                label: task?.title ?? taskId,
                kind: "agent",
                sessionId,
                taskId,
                closeable: true,
              })
              // Start watching session events
              bridge.watch(sessionId, taskId)
            },
            onTaskComplete: (taskId, result) => {
              // Find the session for this task and update status
              const entry = Object.values(store.activeSessions).find(
                (s) => s.taskId === taskId,
              )
              if (entry) {
                setStore(
                  produce((s) => {
                    const session = s.activeSessions[entry.sessionId]
                    if (session) {
                      session.status = result.status === "completed" ? "completed" : "failed"
                    }
                  }),
                )
              }
            },
            onOutput: (taskId, sessionId, line) => {
              setStore(
                produce((s) => {
                  const session = s.activeSessions[sessionId]
                  if (session) {
                    session.output.push(line)
                  }
                }),
              )
            },
          },
          teamConfig,
        )

        // Refresh state after build completes
        await refresh()
        return results
      } finally {
        setStore("executing", false)
        bridge.unwatchAll()
      }
    },
```

- [ ] **Step 5: Add startBuild to the WorkflowViewState type**

At line 35, before the closing brace of `WorkflowViewState`, add:

```typescript
  startBuild(teamConfig: TeamConfig | undefined): Promise<TaskResult[]>
```

- [ ] **Step 6: Add TeamConfig import**

At the top of the file, add to imports:

```typescript
import type { TeamConfig } from "../team/config"
```

- [ ] **Step 7: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/context.tsx`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx
git commit -m "feat(cli): wire session bridge and build execution into TUI context"
```

---

## Task 12: Wire executeStage to Actually Dispatch

Currently `executeStage("plan")` just flips the state machine. We need to make it actually dispatch the appropriate function. This requires updating the TUI context's `executeStage` to call the orchestrator's execution methods.

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`

- [ ] **Step 1: Update executeStage in the value object**

Replace the existing `executeStage` implementation (lines 141-149) with:

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

- [ ] **Step 2: Add dispatchStage as a separate action for explicit stage execution**

In the value object, after `executeStage`, add:

```typescript
    async dispatchStage(
      stage: WorkflowStage,
      modelInfo: { providerID: string; modelID: string },
      options?: {
        phaseContext?: string
        teamConfig?: TeamConfig
        diff?: string
      },
    ) {
      setStore("executing", true)
      const orchestrator = getOrchestrator()

      try {
        switch (stage) {
          case "plan": {
            const roles = options?.teamConfig
              ? Object.keys(options.teamConfig.roles)
              : ["senior", "worker"]
            await orchestrator.executePlan({
              ...modelInfo,
              phaseContext: options?.phaseContext ?? "",
              availableRoles: roles,
            })
            break
          }
          case "challenge": {
            await orchestrator.executeChallenge({
              ...modelInfo,
              phaseContext: options?.phaseContext ?? "",
            })
            break
          }
          case "contract": {
            await orchestrator.executeContracts()
            break
          }
          case "build": {
            await value.startBuild(options?.teamConfig)
            break
          }
          case "review": {
            const state = await orchestrator.getManager().then((m) => m.readState())
            await orchestrator.executeReview({
              ...modelInfo,
              diff: options?.diff ?? "",
              cycle: store.review ? store.review.cycle + 1 : 1,
            })
            break
          }
        }
        await refresh()
      } finally {
        setStore("executing", false)
      }
    },
```

- [ ] **Step 3: Add dispatchStage to WorkflowViewState type**

In the `WorkflowViewState` type, add:

```typescript
  dispatchStage(
    stage: WorkflowStage,
    modelInfo: { providerID: string; modelID: string },
    options?: {
      phaseContext?: string
      teamConfig?: TeamConfig
      diff?: string
    },
  ): Promise<void>
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow-tui/context.tsx`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx
git commit -m "feat(cli): wire executeStage to dispatch plan/challenge/contract/build/review"
```

---

## Task 13: Integration Verification — Run All Tests

Final verification pass to ensure everything compiles and all tests pass.

**Files:** None (verification only)

- [ ] **Step 1: Run all workflow tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/`
Expected: All tests PASS (including the new dispatch, build-runner, session-bridge, and contract-generator tests)

- [ ] **Step 2: Run all team tests**

Run: `cd packages/opencode && bun test test/kilocode/team/`
Expected: All tests PASS

- [ ] **Step 3: Run typecheck on modified files**

Run: `cd packages/opencode && bunx tsgo --noEmit src/devilcode/workflow/dispatch.ts src/devilcode/workflow/build-runner.ts src/devilcode/workflow/session-bridge.ts src/devilcode/workflow/contract-generator.ts src/devilcode/workflow-tui/orchestrator.ts src/devilcode/workflow-tui/context.tsx`

Expected: No type errors

- [ ] **Step 4: Run full monorepo typecheck**

Run: `bun turbo typecheck`
Expected: PASS (or at least no NEW errors — pre-existing errors may exist)

- [ ] **Step 5: Commit if any fixes were needed**

If steps 1-4 revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(cli): resolve type and test issues from execution pipeline integration"
```

---

## Summary

This plan delivers:

| Gap | What Gets Built | Module |
|-----|----------------|--------|
| Gap 1 | Build-stage execution loop with wave sequencing and worktrees | `build-runner.ts` |
| Gap 2 | SSE/Bus subscription bridge for child sessions → TUI | `session-bridge.ts` |
| Gap 3 | Plan-stage LLM dispatch via `generateObject` | `dispatch.ts` |
| Gap 4 | Challenge-stage LLM dispatch via `generateObject` | `dispatch.ts` |
| Gap 5 | Template-based contract generation from PlanTask analysis | `contract-generator.ts` |
| Gap 6 | Review-stage LLM dispatch via `generateObject` | `dispatch.ts` |

**Not covered (separate plans needed):**
- Gaps 7-13: Integration wiring (ctx.teamRole, locks, lessons, quality gates, preflight, health, events)
- Gaps 14-17: Polish (test fixes, TUI navigation, tab close)
- Gaps 18-20: E2E testing, VS Code extension, documentation
