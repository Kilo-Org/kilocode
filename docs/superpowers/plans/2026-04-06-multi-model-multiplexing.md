# Multi-Model Multiplexing & Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hierarchical multi-model team multiplexing (Claude Opus orchestrator, Codex GPT senior, Kimi worker) with a Legion-style workflow engine (plan -> challenge -> build -> review -> ship -> retro) to Devil Code.

**Architecture:** New code lives in `packages/opencode/src/devilcode/team/` and `packages/opencode/src/devilcode/workflow/`. Integration with shared code via ~38 lines across 4 files with `devilcode_change` markers. Entire system gated behind `config.team.enabled`. Uses existing Vercel AI SDK provider abstraction, session hierarchy, task tool, and batch tool.

**Tech Stack:** TypeScript, Zod, gray-matter (YAML frontmatter), Bun test runner, existing Devil Code namespace module patterns.

**Spec:** `docs/superpowers/specs/2026-04-06-multi-model-multiplexing-design.md`

---

## File Structure

### New Files (no `devilcode_change` markers needed)

```
packages/opencode/src/devilcode/team/
  config.ts          — TeamConfig, TeamRole, TeamRouting Zod schemas
  router.ts          — resolveTaskModel(), hierarchy enforcement, effort mapping
  concurrency.ts     — ConcurrencyManager with BusEvent tracking
  agents.ts          — registerWorkflowAgents(), dynamic agent definitions
  types.ts           — TaskResult, shared team types

packages/opencode/src/devilcode/workflow/
  index.ts           — Workflow namespace, stage state machine, public API
  state.ts           — .planning/ directory I/O, YAML frontmatter read/write
  planner.ts         — Phase decomposition, wave assignment, PLAN.md generation
  challenger.ts      — Plan challenge dispatch, revision loop (max 2 rounds)
  executor.ts        — Wave executor, batch dispatch with model routing
  reviewer.ts        — Review loop, finding triage, fix routing (max 3 cycles)
  shipper.ts         — Commit synthesis, ROADMAP.md updates, stage advancement
  types.ts           — All workflow Zod schemas (PlanChallenge, ReviewFinding, etc.)
  prompts/
    plan.txt         — Orchestrator planning system prompt
    challenge.txt    — Codex adversarial review prompt
    build.txt        — Build-stage context injection
    review.txt       — Review-stage instructions
    ship.txt         — Ship-stage synthesis prompt

packages/opencode/test/kilocode/team/
  config.test.ts     — Schema validation tests
  router.test.ts     — Model resolution, hierarchy enforcement tests
  concurrency.test.ts — Slot acquisition, release, limit tests

packages/opencode/test/kilocode/workflow/
  types.test.ts      — Workflow schema validation tests
  state.test.ts      — .planning/ I/O, frontmatter parsing tests
  executor.test.ts   — Wave grouping, dispatch order tests
  reviewer.test.ts   — Finding triage, fix routing tests
```

### Modified Files (with `devilcode_change` markers)

```
packages/opencode/src/config/config.ts     — +4 lines: import TeamConfig, add to Info schema
packages/opencode/src/tool/task.ts         — +20 lines: model routing + nesting unlock
packages/opencode/src/agent/agent.ts       — +6 lines: register workflow agents
packages/opencode/src/session/prompt.ts    — +8 lines: inject workflow context
```

---

## Task 1: Team Config Zod Schemas

**Files:**
- Create: `packages/opencode/src/devilcode/team/config.ts`
- Create: `packages/opencode/src/devilcode/team/types.ts`
- Test: `packages/opencode/test/kilocode/team/config.test.ts`

- [ ] **Step 1: Create the team types file**

```typescript
// packages/opencode/src/devilcode/team/types.ts
import z from "zod"

export const TaskResultStatus = z.enum(["completed", "escalated", "blocked", "failed"])

export const Escalation = z.object({
  reason: z.string(),
  suggestedRole: z.string().optional(),
  context: z.string(),
})

export const TaskResult = z.object({
  status: TaskResultStatus,
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  escalation: Escalation.optional(),
})
export type TaskResult = z.infer<typeof TaskResult>
```

- [ ] **Step 2: Create the team config schema file**

```typescript
// packages/opencode/src/devilcode/team/config.ts
import z from "zod"

export const EffortLevel = z.enum(["max", "xhigh", "high", "medium", "low", "default"]).default("default")
export type EffortLevel = z.infer<typeof EffortLevel>

export const TeamRole = z.object({
  displayName: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: EffortLevel,
  tier: z.number().int().positive(),
  canDelegate: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(z.string()).default([]),
})
export type TeamRole = z.infer<typeof TeamRole>

export const TeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: z.string(),
  escalationEnabled: z.boolean().default(true),
})
export type TeamRouting = z.infer<typeof TeamRouting>

export const TeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), TeamRole),
  routing: TeamRouting,
})
export type TeamConfig = z.infer<typeof TeamConfig>
```

- [ ] **Step 3: Write the config schema tests**

```typescript
// packages/opencode/test/kilocode/team/config.test.ts
import { describe, expect, test } from "bun:test"
import { TeamConfig, TeamRole, TeamRouting, EffortLevel } from "@/devilcode/team/config"

describe("TeamRole", () => {
  test("parses a valid role with all fields", () => {
    const input = {
      displayName: "Planner/Orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: ["planning", "decomposition"],
    }
    const result = TeamRole.parse(input)
    expect(result.displayName).toBe("Planner/Orchestrator")
    expect(result.provider).toBe("anthropic")
    expect(result.effort).toBe("max")
    expect(result.tier).toBe(1)
    expect(result.canDelegate).toEqual(["senior", "worker"])
  })

  test("applies defaults for optional fields", () => {
    const input = {
      displayName: "Worker",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      tier: 3,
    }
    const result = TeamRole.parse(input)
    expect(result.effort).toBe("default")
    expect(result.canDelegate).toEqual([])
    expect(result.maxConcurrent).toBe(3)
    expect(result.capabilities).toEqual([])
  })

  test("rejects tier 0", () => {
    const input = {
      displayName: "Bad",
      provider: "x",
      model: "y",
      tier: 0,
    }
    expect(() => TeamRole.parse(input)).toThrow()
  })

  test("rejects negative maxConcurrent", () => {
    const input = {
      displayName: "Bad",
      provider: "x",
      model: "y",
      tier: 1,
      maxConcurrent: -1,
    }
    expect(() => TeamRole.parse(input)).toThrow()
  })
})

describe("TeamRouting", () => {
  test("parses valid routing config", () => {
    const result = TeamRouting.parse({
      strategy: "hierarchical",
      defaultRole: "worker",
      escalationEnabled: true,
    })
    expect(result.strategy).toBe("hierarchical")
    expect(result.defaultRole).toBe("worker")
  })

  test("applies defaults", () => {
    const result = TeamRouting.parse({ defaultRole: "worker" })
    expect(result.strategy).toBe("hierarchical")
    expect(result.escalationEnabled).toBe(true)
  })

  test("rejects invalid strategy", () => {
    expect(() => TeamRouting.parse({ strategy: "round-robin", defaultRole: "x" })).toThrow()
  })
})

describe("TeamConfig", () => {
  const fullConfig = {
    enabled: true,
    roles: {
      orchestrator: {
        displayName: "Planner",
        provider: "anthropic",
        model: "claude-opus-4-6",
        effort: "max",
        tier: 1,
        canDelegate: ["senior", "worker"],
        maxConcurrent: 1,
        capabilities: ["planning"],
      },
      senior: {
        displayName: "Senior",
        provider: "openai",
        model: "gpt-5.4-codex",
        effort: "xhigh",
        tier: 2,
        canDelegate: ["worker"],
        maxConcurrent: 2,
        capabilities: ["debugging"],
      },
      worker: {
        displayName: "Worker",
        provider: "fireworks-ai",
        model: "kimi-k2p5-turbo",
        tier: 3,
      },
    },
    routing: {
      strategy: "hierarchical",
      defaultRole: "worker",
      escalationEnabled: true,
    },
  }

  test("parses a full three-tier team config", () => {
    const result = TeamConfig.parse(fullConfig)
    expect(result.enabled).toBe(true)
    expect(Object.keys(result.roles)).toEqual(["orchestrator", "senior", "worker"])
    expect(result.routing.defaultRole).toBe("worker")
  })

  test("defaults enabled to false", () => {
    const result = TeamConfig.parse({
      roles: fullConfig.roles,
      routing: fullConfig.routing,
    })
    expect(result.enabled).toBe(false)
  })

  test("allows custom role names", () => {
    const result = TeamConfig.parse({
      enabled: true,
      roles: {
        brain: {
          displayName: "Brain",
          provider: "anthropic",
          model: "claude-opus-4-6",
          tier: 1,
          canDelegate: ["hands"],
        },
        hands: {
          displayName: "Hands",
          provider: "fireworks-ai",
          model: "kimi-k2p5-turbo",
          tier: 2,
        },
      },
      routing: { defaultRole: "hands" },
    })
    expect(Object.keys(result.roles)).toEqual(["brain", "hands"])
  })
})

describe("EffortLevel", () => {
  test("accepts all valid effort levels", () => {
    for (const level of ["max", "xhigh", "high", "medium", "low", "default"]) {
      expect(EffortLevel.parse(level)).toBe(level)
    }
  })

  test("rejects invalid effort level", () => {
    expect(() => EffortLevel.parse("ultra")).toThrow()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/team/config.test.ts`
Expected: FAIL — imports resolve but schemas match (tests should pass once files exist). If import fails, that confirms test infra is correct.

- [ ] **Step 5: Verify tests pass**

Run: `cd packages/opencode && bun test test/kilocode/team/config.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/team/config.ts packages/opencode/src/devilcode/team/types.ts packages/opencode/test/kilocode/team/config.test.ts
git commit -m "feat(cli): add team config and task result Zod schemas for multi-model multiplexing"
```

---

## Task 2: Model Router with Hierarchy Enforcement

**Files:**
- Create: `packages/opencode/src/devilcode/team/router.ts`
- Test: `packages/opencode/test/kilocode/team/router.test.ts`

- [ ] **Step 1: Write the router tests**

```typescript
// packages/opencode/test/kilocode/team/router.test.ts
import { describe, expect, test } from "bun:test"
import { resolveTaskModel, TeamDelegationError, TeamConcurrencyError } from "@/devilcode/team/router"
import type { TeamConfig } from "@/devilcode/team/config"

const teamConfig: TeamConfig = {
  enabled: true,
  roles: {
    orchestrator: {
      displayName: "Orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      effort: "max",
      tier: 1,
      canDelegate: ["senior", "worker"],
      maxConcurrent: 1,
      capabilities: [],
    },
    senior: {
      displayName: "Senior",
      provider: "openai",
      model: "gpt-5.4-codex",
      effort: "xhigh",
      tier: 2,
      canDelegate: ["worker"],
      maxConcurrent: 2,
      capabilities: [],
    },
    worker: {
      displayName: "Worker",
      provider: "fireworks-ai",
      model: "kimi-k2p5-turbo",
      effort: "default",
      tier: 3,
      canDelegate: [],
      maxConcurrent: 5,
      capabilities: [],
    },
  },
  routing: {
    strategy: "hierarchical",
    defaultRole: "worker",
    escalationEnabled: true,
  },
}

describe("resolveTaskModel", () => {
  test("resolves worker role to fireworks model", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toEqual({
      model: { providerID: "fireworks-ai", modelID: "kimi-k2p5-turbo" },
      effort: "default",
      role: "worker",
    })
  })

  test("resolves senior role to openai model", () => {
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4-codex" },
      effort: "xhigh",
      role: "senior",
    })
  })

  test("returns undefined when team is disabled", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig: { ...teamConfig, enabled: false },
      parentRole: "orchestrator",
    })
    expect(result).toBeUndefined()
  })

  test("returns undefined for unknown role (falls back to existing behavior)", () => {
    const result = resolveTaskModel({
      subagentType: "explore",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result).toBeUndefined()
  })

  test("throws when parent cannot delegate to target role", () => {
    expect(() =>
      resolveTaskModel({
        subagentType: "senior",
        teamConfig,
        parentRole: "worker",
      }),
    ).toThrow(TeamDelegationError)
  })

  test("throws when worker tries to delegate", () => {
    expect(() =>
      resolveTaskModel({
        subagentType: "worker",
        teamConfig,
        parentRole: "worker",
      }),
    ).toThrow(TeamDelegationError)
  })

  test("allows orchestrator to delegate to worker (skipping senior)", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "orchestrator",
    })
    expect(result?.role).toBe("worker")
  })

  test("allows senior to delegate to worker", () => {
    const result = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "senior",
    })
    expect(result?.role).toBe("worker")
  })

  test("allows delegation when parentRole is undefined (top-level dispatch)", () => {
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig,
      parentRole: undefined,
    })
    expect(result?.role).toBe("senior")
  })

  test("uses flat strategy to skip hierarchy check", () => {
    const flatConfig: TeamConfig = {
      ...teamConfig,
      routing: { ...teamConfig.routing, strategy: "flat" },
    }
    const result = resolveTaskModel({
      subagentType: "senior",
      teamConfig: flatConfig,
      parentRole: "worker",
    })
    expect(result?.role).toBe("senior")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/team/router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the router**

```typescript
// packages/opencode/src/devilcode/team/router.ts
import { NamedError } from "@opencode-ai/util/error"
import type { TeamConfig } from "./config"

export const TeamDelegationError = NamedError.create(
  "TeamDelegationError",
  (parentRole: string, targetRole: string) => ({
    message: `Role "${parentRole}" cannot delegate to "${targetRole}"`,
    data: { parentRole, targetRole },
  }),
)

export const TeamConcurrencyError = NamedError.create(
  "TeamConcurrencyError",
  (role: string, maxConcurrent: number) => ({
    message: `Role "${role}" has reached max concurrency of ${maxConcurrent}`,
    data: { role, maxConcurrent },
  }),
)

export interface ResolvedTaskModel {
  model: { providerID: string; modelID: string }
  effort: string
  role: string
}

export function resolveTaskModel(input: {
  subagentType: string
  teamConfig: TeamConfig | undefined
  parentRole: string | undefined
}): ResolvedTaskModel | undefined {
  const { subagentType, teamConfig, parentRole } = input

  // 1. If team not enabled, return undefined (existing behavior)
  if (!teamConfig?.enabled) return undefined

  // 2. Check if subagentType maps to a team role
  const role = teamConfig.roles[subagentType]
  if (!role) return undefined

  // 3. Enforce hierarchy (skip for flat strategy or top-level dispatch)
  if (teamConfig.routing.strategy === "hierarchical" && parentRole) {
    const parentRoleDef = teamConfig.roles[parentRole]
    if (parentRoleDef && !parentRoleDef.canDelegate.includes(subagentType)) {
      throw TeamDelegationError(parentRole, subagentType)
    }
  }

  // 4. Return resolved model
  return {
    model: {
      providerID: role.provider,
      modelID: role.model,
    },
    effort: role.effort,
    role: subagentType,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/team/router.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/team/router.ts packages/opencode/test/kilocode/team/router.test.ts
git commit -m "feat(cli): add team model router with hierarchy enforcement"
```

---

## Task 3: Concurrency Manager

**Files:**
- Create: `packages/opencode/src/devilcode/team/concurrency.ts`
- Test: `packages/opencode/test/kilocode/team/concurrency.test.ts`

- [ ] **Step 1: Write the concurrency manager tests**

```typescript
// packages/opencode/test/kilocode/team/concurrency.test.ts
import { describe, expect, test, beforeEach } from "bun:test"
import { ConcurrencyManager } from "@/devilcode/team/concurrency"

describe("ConcurrencyManager", () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    manager = new ConcurrencyManager()
  })

  test("acquire and release a slot", () => {
    manager.acquire("worker", "task-1")
    expect(manager.getActiveCount("worker")).toBe(1)
    manager.release("worker", "task-1")
    expect(manager.getActiveCount("worker")).toBe(0)
  })

  test("tracks multiple tasks per role", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("worker", "task-2")
    manager.acquire("worker", "task-3")
    expect(manager.getActiveCount("worker")).toBe(3)
  })

  test("tracks roles independently", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("senior", "task-2")
    expect(manager.getActiveCount("worker")).toBe(1)
    expect(manager.getActiveCount("senior")).toBe(1)
  })

  test("returns 0 for unknown role", () => {
    expect(manager.getActiveCount("nonexistent")).toBe(0)
  })

  test("release is idempotent for unknown task", () => {
    manager.release("worker", "nonexistent")
    expect(manager.getActiveCount("worker")).toBe(0)
  })

  test("hasCapacity returns true when under limit", () => {
    manager.acquire("worker", "task-1")
    expect(manager.hasCapacity("worker", 5)).toBe(true)
  })

  test("hasCapacity returns false when at limit", () => {
    for (let i = 0; i < 5; i++) {
      manager.acquire("worker", `task-${i}`)
    }
    expect(manager.hasCapacity("worker", 5)).toBe(false)
  })

  test("hasCapacity returns true after release frees a slot", () => {
    for (let i = 0; i < 5; i++) {
      manager.acquire("worker", `task-${i}`)
    }
    expect(manager.hasCapacity("worker", 5)).toBe(false)
    manager.release("worker", "task-0")
    expect(manager.hasCapacity("worker", 5)).toBe(true)
  })

  test("getActiveTasks returns task IDs for a role", () => {
    manager.acquire("senior", "task-a")
    manager.acquire("senior", "task-b")
    const tasks = manager.getActiveTasks("senior")
    expect(tasks).toContain("task-a")
    expect(tasks).toContain("task-b")
    expect(tasks.length).toBe(2)
  })

  test("reset clears all state", () => {
    manager.acquire("worker", "task-1")
    manager.acquire("senior", "task-2")
    manager.reset()
    expect(manager.getActiveCount("worker")).toBe(0)
    expect(manager.getActiveCount("senior")).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/team/concurrency.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the concurrency manager**

```typescript
// packages/opencode/src/devilcode/team/concurrency.ts

export class ConcurrencyManager {
  private active = new Map<string, Set<string>>()

  acquire(role: string, taskId: string): void {
    if (!this.active.has(role)) {
      this.active.set(role, new Set())
    }
    this.active.get(role)!.add(taskId)
  }

  release(role: string, taskId: string): void {
    const tasks = this.active.get(role)
    if (tasks) {
      tasks.delete(taskId)
      if (tasks.size === 0) {
        this.active.delete(role)
      }
    }
  }

  getActiveCount(role: string): number {
    return this.active.get(role)?.size ?? 0
  }

  getActiveTasks(role: string): string[] {
    return Array.from(this.active.get(role) ?? [])
  }

  hasCapacity(role: string, maxConcurrent: number): boolean {
    return this.getActiveCount(role) < maxConcurrent
  }

  reset(): void {
    this.active.clear()
  }
}

// Singleton instance for the process
let instance: ConcurrencyManager | undefined

export function getConcurrencyManager(): ConcurrencyManager {
  if (!instance) {
    instance = new ConcurrencyManager()
  }
  return instance
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/team/concurrency.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/team/concurrency.ts packages/opencode/test/kilocode/team/concurrency.test.ts
git commit -m "feat(cli): add concurrency manager for team role slot tracking"
```

---

## Task 4: Effort Mapping Utility

**Files:**
- Create: `packages/opencode/src/devilcode/team/effort.ts`
- Depends on: `packages/opencode/src/devilcode/provider-options.ts` (read-only reference)

- [ ] **Step 1: Create the effort mapping utility**

This bridges the team config's effort levels (`max`, `xhigh`, etc.) to the provider-specific options format used by `kiloProviderOptions()`.

```typescript
// packages/opencode/src/devilcode/team/effort.ts
import type { EffortLevel } from "./config"

/**
 * Maps team effort levels to the OpenRouter-style options format
 * that kiloProviderOptions() expects as input.
 *
 * kiloProviderOptions() then transforms these to provider-specific formats:
 * - Anthropic: thinking.type + effort
 * - OpenAI: reasoningEffort
 * - OpenAI-compatible: reasoningEffort
 */
export function effortToProviderOptions(effort: EffortLevel): Record<string, any> {
  switch (effort) {
    case "max":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
      }
    case "xhigh":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "high",
      }
    case "high":
      return {
        reasoning: { enabled: true, effort: "high" },
        verbosity: "medium",
      }
    case "medium":
      return {
        reasoning: { enabled: true, effort: "medium" },
        verbosity: "medium",
      }
    case "low":
      return {
        reasoning: { enabled: false, effort: "low" },
        verbosity: "low",
      }
    case "default":
      return {}
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/team/effort.ts
git commit -m "feat(cli): add effort-to-provider-options mapping for team roles"
```

---

## Task 5: Config Integration (Shared File Change)

**Files:**
- Modify: `packages/opencode/src/config/config.ts` (lines 1135, 1333)

- [ ] **Step 1: Add TeamConfig import to config.ts**

Add import at top of file, after existing imports:

```typescript
// In packages/opencode/src/config/config.ts, after the existing imports (around line 48):
// devilcode_change start
import { TeamConfig } from "@/devilcode/team/config"
// devilcode_change end
```

- [ ] **Step 2: Add team field to Config.Info schema**

Insert the `team` field into the `Info` z.object. Place it after the `experimental` block (around line 1333) and before `.strict()`:

```typescript
// In packages/opencode/src/config/config.ts, inside the Info z.object,
// after the experimental block (line ~1333) and before .strict() (line ~1335):
      // devilcode_change start
      team: TeamConfig.optional().describe("Multi-model team configuration for hierarchical agent dispatch"),
      // devilcode_change end
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/config/config.ts
git commit -m "feat(cli): add team config schema to Config.Info"
```

---

## Task 6: Task Tool Model Routing Integration (Shared File Change)

**Files:**
- Modify: `packages/opencode/src/tool/task.ts` (lines 1-166)

This is the critical integration point where team routing plugs into the existing task dispatch.

- [ ] **Step 1: Add router import to task.ts**

```typescript
// In packages/opencode/src/tool/task.ts, after line 12 (import { PermissionNext }):
import { resolveTaskModel } from "@/devilcode/team/router" // devilcode_change
import { getConcurrencyManager } from "@/devilcode/team/concurrency" // devilcode_change
```

- [ ] **Step 2: Add model routing in execute()**

Replace the model resolution block at lines 106-109 with team-aware routing:

```typescript
// In packages/opencode/src/tool/task.ts, replace lines 106-109:
// OLD:
//   const model = agent.model ?? {
//     modelID: msg.info.modelID,
//     providerID: msg.info.providerID,
//   }

// NEW:
      // devilcode_change start — team model routing
      const teamModel = resolveTaskModel({
        subagentType: params.subagent_type,
        teamConfig: config.team,
        parentRole: ctx.metadata?.teamRole,
      })
      const model = teamModel?.model ?? agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      // devilcode_change end
```

- [ ] **Step 3: Add concurrency tracking around prompt execution**

Wrap the `SessionPrompt.prompt()` call (lines 128-143) with concurrency acquire/release:

```typescript
// In packages/opencode/src/tool/task.ts, around the SessionPrompt.prompt() call:
      // devilcode_change start — concurrency tracking
      const resolvedRole = teamModel?.role
      const concurrency = getConcurrencyManager()
      if (resolvedRole) {
        const roleConfig = config.team?.roles[resolvedRole]
        if (roleConfig && !concurrency.hasCapacity(resolvedRole, roleConfig.maxConcurrent)) {
          throw new Error(
            `Role "${resolvedRole}" at max concurrency (${roleConfig.maxConcurrent}). Wait for active tasks to complete.`,
          )
        }
        concurrency.acquire(resolvedRole, session.id)
      }
      // devilcode_change end

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          ...(allowsTask ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      // devilcode_change start — release concurrency slot
      if (resolvedRole) {
        concurrency.release(resolvedRole, session.id)
      }
      // devilcode_change end
```

Note: The release should also happen on error. Wrap the prompt call in try/finally:

```typescript
      // devilcode_change start — ensure slot release on error
      let result
      try {
        result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            ...(allowsTask ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          },
          parts: promptParts,
        })
      } finally {
        if (resolvedRole) {
          concurrency.release(resolvedRole, session.id)
        }
      }
      // devilcode_change end
```

- [ ] **Step 4: Unlock task nesting for delegating roles**

Modify the permission block (lines 75-100) to allow task nesting when team is enabled and the role can delegate:

```typescript
// In packages/opencode/src/tool/task.ts, replace the allowsTask check (line 64):
// OLD:
//   const allowsTask = agent.permission.some((rule) => rule.permission === "task" && rule.action === "allow")

// NEW:
      const allowsTask = agent.permission.some((rule) => rule.permission === "task" && rule.action === "allow")
      // devilcode_change start — unlock nesting for team roles that can delegate
      const teamCanDelegate =
        config.team?.enabled &&
        params.subagent_type &&
        config.team.roles[params.subagent_type]?.canDelegate?.length > 0
      const effectiveAllowsTask = allowsTask || !!teamCanDelegate
      // devilcode_change end
```

Then replace all references to `allowsTask` with `effectiveAllowsTask` in the permission array (lines 86-94) and tools object (line 139):

```typescript
      // Line 86: change allowsTask to effectiveAllowsTask
      ...(effectiveAllowsTask
        ? []
        : [
            {
              permission: "task" as const,
              pattern: "*" as const,
              action: "deny" as const,
            },
          ]),

      // Line 139: change allowsTask to effectiveAllowsTask
      ...(effectiveAllowsTask ? {} : { task: false }),
```

- [ ] **Step 5: Pass teamRole in metadata**

Add the resolved role to the metadata so child sessions know their role for hierarchy checks:

```typescript
// In packages/opencode/src/tool/task.ts, in the ctx.metadata() call (lines 111-117):
      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          teamRole: resolvedRole, // devilcode_change
        },
      })
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: No new type errors. If `ctx.metadata?.teamRole` doesn't exist on the type, check the ctx type definition and add it or use a different mechanism to pass the role.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/tool/task.ts
git commit -m "feat(cli): integrate team model routing and concurrency into task tool"
```

---

## Task 7: Workflow Zod Schemas

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/types.ts`
- Test: `packages/opencode/test/kilocode/workflow/types.test.ts`

- [ ] **Step 1: Write the workflow types tests**

```typescript
// packages/opencode/test/kilocode/workflow/types.test.ts
import { describe, expect, test } from "bun:test"
import {
  WorkflowStage,
  PlanTask,
  PlanChallenge,
  ReviewFinding,
  ReviewVerdict,
  WorkflowState,
} from "@/devilcode/workflow/types"

describe("WorkflowStage", () => {
  test("accepts all valid stages", () => {
    for (const stage of ["plan", "challenge", "build", "review", "ship", "retro"]) {
      expect(WorkflowStage.parse(stage)).toBe(stage)
    }
  })

  test("rejects invalid stage", () => {
    expect(() => WorkflowStage.parse("deploy")).toThrow()
  })
})

describe("PlanTask", () => {
  test("parses a valid plan task", () => {
    const result = PlanTask.parse({
      id: "01-02",
      title: "Implement JWT validation",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "high",
      files: ["src/auth/jwt.ts"],
      verification: ["bun test test/auth/jwt.test.ts"],
      description: "Implement JWT token validation middleware",
    })
    expect(result.id).toBe("01-02")
    expect(result.wave).toBe(1)
    expect(result.role).toBe("senior")
  })

  test("applies defaults for optional fields", () => {
    const result = PlanTask.parse({
      id: "01-01",
      title: "Task",
      role: "worker",
      wave: 1,
      description: "Do something",
    })
    expect(result.dependsOn).toEqual([])
    expect(result.files).toEqual([])
    expect(result.verification).toEqual([])
    expect(result.estimatedComplexity).toBe("medium")
  })
})

describe("PlanChallenge", () => {
  test("parses an approved challenge", () => {
    const result = PlanChallenge.parse({
      planId: "01",
      verdict: "approved",
      concerns: [],
      summary: "Plan looks solid",
    })
    expect(result.verdict).toBe("approved")
  })

  test("parses a challenge with concerns", () => {
    const result = PlanChallenge.parse({
      planId: "01",
      verdict: "revise",
      concerns: [
        {
          severity: "critical",
          category: "file-conflict",
          description: "Tasks 01-02 and 01-03 both modify auth.ts in wave 1",
          suggestedChange: "Move 01-03 to wave 2",
          affectedTasks: ["01-02", "01-03"],
        },
      ],
      alternativeApproach: "Consider using existing auth middleware",
      summary: "File conflict in wave 1",
    })
    expect(result.concerns.length).toBe(1)
    expect(result.concerns[0].severity).toBe("critical")
    expect(result.alternativeApproach).toBeDefined()
  })

  test("validates concern categories", () => {
    expect(() =>
      PlanChallenge.parse({
        planId: "01",
        verdict: "revise",
        concerns: [
          {
            severity: "critical",
            category: "invalid-category",
            description: "x",
            suggestedChange: "y",
            affectedTasks: [],
          },
        ],
        summary: "x",
      }),
    ).toThrow()
  })
})

describe("ReviewFinding", () => {
  test("parses a valid finding", () => {
    const result = ReviewFinding.parse({
      id: "R-01",
      severity: "blocker",
      category: "security",
      file: "src/auth/jwt.ts",
      line: 14,
      description: "JWT secret hardcoded",
      suggestedFix: "Move to env var",
      suggestedRole: "senior",
      verificationCommand: "grep -r hardcoded src/auth/",
    })
    expect(result.severity).toBe("blocker")
    expect(result.category).toBe("security")
  })
})

describe("ReviewVerdict", () => {
  test("parses a pass verdict", () => {
    const result = ReviewVerdict.parse({
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All clear",
    })
    expect(result.verdict).toBe("pass")
  })
})

describe("WorkflowState", () => {
  test("parses a valid workflow state", () => {
    const result = WorkflowState.parse({
      project: "my-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 2,
      totalWaves: 3,
      activeTasks: [
        { id: "01-02", role: "senior", status: "in_progress" },
      ],
      lastUpdated: "2026-04-06T14:30:00Z",
    })
    expect(result.currentStage).toBe("build")
    expect(result.activeTasks.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the workflow types**

```typescript
// packages/opencode/src/devilcode/workflow/types.ts
import z from "zod"

export const WorkflowStage = z.enum(["plan", "challenge", "build", "review", "ship", "retro"])
export type WorkflowStage = z.infer<typeof WorkflowStage>

export const PlanTask = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  wave: z.number().int().positive(),
  dependsOn: z.array(z.string()).default([]),
  estimatedComplexity: z.enum(["low", "medium", "high"]).default("medium"),
  files: z.array(z.string()).default([]),
  verification: z.array(z.string()).default([]),
  description: z.string(),
})
export type PlanTask = z.infer<typeof PlanTask>

export const ChallengeConcernCategory = z.enum([
  "missing-dependency",
  "wrong-wave-ordering",
  "underestimated-complexity",
  "security-risk",
  "overengineered",
  "file-conflict",
  "missing-verification",
  "incorrect-assumption",
])

export const ChallengeConcern = z.object({
  severity: z.enum(["critical", "moderate", "minor"]),
  category: ChallengeConcernCategory,
  description: z.string(),
  suggestedChange: z.string(),
  affectedTasks: z.array(z.string()),
})

export const PlanChallenge = z.object({
  planId: z.string(),
  verdict: z.enum(["approved", "revise", "reject"]),
  concerns: z.array(ChallengeConcern),
  alternativeApproach: z.string().optional(),
  summary: z.string(),
})
export type PlanChallenge = z.infer<typeof PlanChallenge>

export const ReviewFinding = z.object({
  id: z.string(),
  severity: z.enum(["blocker", "warning", "suggestion"]),
  category: z.enum([
    "security",
    "correctness",
    "performance",
    "type-safety",
    "test-coverage",
    "style",
    "architecture",
    "compatibility",
  ]),
  file: z.string(),
  line: z.number().optional(),
  description: z.string(),
  suggestedFix: z.string().optional(),
  suggestedRole: z.string().optional(),
  verificationCommand: z.string().optional(),
})
export type ReviewFinding = z.infer<typeof ReviewFinding>

export const ReviewVerdict = z.object({
  verdict: z.enum(["pass", "fail", "escalate"]),
  cycle: z.number().int().positive(),
  findings: z.array(ReviewFinding),
  blockerCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  suggestionCount: z.number().int().min(0),
  summary: z.string(),
})
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const ActiveTask = z.object({
  id: z.string(),
  role: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "escalated", "blocked", "failed"]),
})

export const WorkflowState = z.object({
  project: z.string(),
  currentPhase: z.string(),
  currentStage: WorkflowStage,
  activeWave: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
  activeTasks: z.array(ActiveTask).default([]),
  lastUpdated: z.string(),
})
export type WorkflowState = z.infer<typeof WorkflowState>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/types.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/types.ts packages/opencode/test/kilocode/workflow/types.test.ts
git commit -m "feat(cli): add workflow Zod schemas for plan, challenge, review, and state"
```

---

## Task 8: Workflow State Manager (.planning/ I/O)

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/state.ts`
- Test: `packages/opencode/test/kilocode/workflow/state.test.ts`

- [ ] **Step 1: Write state manager tests**

```typescript
// packages/opencode/test/kilocode/workflow/state.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { WorkflowStateManager } from "@/devilcode/workflow/state"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("WorkflowStateManager", () => {
  let tmpDir: string
  let manager: WorkflowStateManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-test-"))
    manager = new WorkflowStateManager(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("initializes .planning/ directory structure", async () => {
    await manager.initialize("test-project")
    const exists = await fs.stat(path.join(tmpDir, ".planning")).then(() => true).catch(() => false)
    expect(exists).toBe(true)
    const stateExists = await fs.stat(path.join(tmpDir, ".planning", "STATE.md")).then(() => true).catch(() => false)
    expect(stateExists).toBe(true)
  })

  test("reads STATE.md frontmatter", async () => {
    await manager.initialize("test-project")
    const state = await manager.readState()
    expect(state.project).toBe("test-project")
    expect(state.currentStage).toBe("plan")
  })

  test("writes and reads back state", async () => {
    await manager.initialize("test-project")
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 2,
      totalWaves: 3,
      activeTasks: [{ id: "01-02", role: "senior", status: "in_progress" }],
      lastUpdated: new Date().toISOString(),
    })
    const state = await manager.readState()
    expect(state.currentStage).toBe("build")
    expect(state.activeWave).toBe(2)
    expect(state.activeTasks.length).toBe(1)
  })

  test("creates phase directory", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth-system")
    const phaseDir = path.join(tmpDir, ".planning", "phases", "01-auth-system")
    const exists = await fs.stat(phaseDir).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  test("writes and reads plan file with frontmatter", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writePlan("01-auth", {
      id: "01-01",
      title: "Implement JWT",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "high",
      files: ["src/auth/jwt.ts"],
      verification: ["bun test"],
      description: "Implement JWT token validation middleware.\n\nHandle expiry and refresh.",
    })
    const plan = await manager.readPlan("01-auth", "01-01")
    expect(plan.id).toBe("01-01")
    expect(plan.role).toBe("senior")
    expect(plan.wave).toBe(1)
    expect(plan.description).toContain("JWT token validation")
  })

  test("reads all plans for a phase", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writePlan("01-auth", {
      id: "01-01",
      title: "Task A",
      role: "worker",
      wave: 1,
      description: "First task",
    })
    await manager.writePlan("01-auth", {
      id: "01-02",
      title: "Task B",
      role: "senior",
      wave: 1,
      description: "Second task",
    })
    const plans = await manager.readAllPlans("01-auth")
    expect(plans.length).toBe(2)
  })

  test("writes and reads review file", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writeReview("01-auth", {
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All clear",
    })
    const review = await manager.readReview("01-auth")
    expect(review.verdict).toBe("pass")
  })

  test("hasWorkflow returns false for uninitialized directory", async () => {
    expect(await manager.hasWorkflow()).toBe(false)
  })

  test("hasWorkflow returns true after initialization", async () => {
    await manager.initialize("test-project")
    expect(await manager.hasWorkflow()).toBe(true)
  })

  test("toPromptSection returns formatted context", async () => {
    await manager.initialize("test-project")
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 1,
      totalWaves: 2,
      activeTasks: [],
      lastUpdated: new Date().toISOString(),
    })
    const section = await manager.toPromptSection()
    expect(section).toContain("01-auth")
    expect(section).toContain("build")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the state manager**

```typescript
// packages/opencode/src/devilcode/workflow/state.ts
import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"
import { WorkflowState, type PlanTask, type ReviewVerdict } from "./types"

export class WorkflowStateManager {
  private basePath: string
  private planningDir: string

  constructor(basePath: string) {
    this.basePath = basePath
    this.planningDir = path.join(basePath, ".planning")
  }

  async hasWorkflow(): Promise<boolean> {
    try {
      await fs.stat(path.join(this.planningDir, "STATE.md"))
      return true
    } catch {
      return false
    }
  }

  async initialize(projectName: string): Promise<void> {
    await fs.mkdir(path.join(this.planningDir, "phases"), { recursive: true })
    await fs.mkdir(path.join(this.planningDir, "milestones"), { recursive: true })

    const now = new Date().toISOString()
    const initialState: WorkflowState = {
      project: projectName,
      currentPhase: "",
      currentStage: "plan",
      activeTasks: [],
      lastUpdated: now,
    }
    await this.writeState(initialState)

    // Create PROJECT.md stub
    const projectMd = path.join(this.planningDir, "PROJECT.md")
    try {
      await fs.stat(projectMd)
    } catch {
      await fs.writeFile(
        projectMd,
        `# ${projectName}\n\n## Vision\n\n<!-- Define the project vision -->\n\n## Constraints\n\n<!-- Define constraints -->\n\n## Success Criteria\n\n<!-- Define success criteria -->\n`,
      )
    }

    // Create ROADMAP.md stub
    const roadmapMd = path.join(this.planningDir, "ROADMAP.md")
    try {
      await fs.stat(roadmapMd)
    } catch {
      await fs.writeFile(roadmapMd, `# Roadmap\n\n<!-- Phases will be added as they are planned -->\n`)
    }
  }

  async readState(): Promise<WorkflowState> {
    const content = await fs.readFile(path.join(this.planningDir, "STATE.md"), "utf-8")
    const { data } = matter(content)
    return WorkflowState.parse(data)
  }

  async writeState(state: WorkflowState): Promise<void> {
    state.lastUpdated = new Date().toISOString()
    const content = matter.stringify("", state)
    await fs.writeFile(path.join(this.planningDir, "STATE.md"), content)
  }

  async createPhase(phaseSlug: string): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    await fs.mkdir(phaseDir, { recursive: true })

    // Create CONTEXT.md stub
    const contextMd = path.join(phaseDir, "CONTEXT.md")
    try {
      await fs.stat(contextMd)
    } catch {
      await fs.writeFile(
        contextMd,
        `# ${phaseSlug} Context\n\n## Requirements\n\n<!-- Phase requirements -->\n\n## Relevant Code\n\n<!-- Key files and modules -->\n\n## Constraints\n\n<!-- Phase-specific constraints -->\n`,
      )
    }
  }

  async writePlan(phaseSlug: string, task: PlanTask): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${task.id}-PLAN.md`
    const filePath = path.join(phaseDir, filename)

    const { description, ...frontmatterData } = task
    const content = matter.stringify(`\n## Task Description\n\n${description}\n`, frontmatterData)
    await fs.writeFile(filePath, content)
  }

  async readPlan(phaseSlug: string, taskId: string): Promise<PlanTask> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${taskId}-PLAN.md`
    const content = await fs.readFile(path.join(phaseDir, filename), "utf-8")
    const { data, content: body } = matter(content)

    // Extract description from markdown body
    const descriptionMatch = body.match(/## Task Description\s*\n\n([\s\S]*?)$/)
    const description = descriptionMatch?.[1]?.trim() ?? body.trim()

    return PlanTask.parse({ ...data, description })
  }

  async readAllPlans(phaseSlug: string): Promise<PlanTask[]> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const planFiles = files.filter((f) => f.endsWith("-PLAN.md")).sort()

    const plans: PlanTask[] = []
    for (const file of planFiles) {
      const taskId = file.replace("-PLAN.md", "")
      const plan = await this.readPlan(phaseSlug, taskId)
      plans.push(plan)
    }
    return plans
  }

  async writeSummary(phaseSlug: string, taskId: string, content: string): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${taskId}-SUMMARY.md`
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async writeReview(phaseSlug: string, verdict: ReviewVerdict): Promise<void> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const filename = `${phaseSlug.split("-")[0]}-REVIEW.md`
    const { findings, ...frontmatterData } = verdict
    const findingsMarkdown = findings
      .map(
        (f) =>
          `### ${f.id} [${f.severity.toUpperCase()}] ${f.category}: ${f.description}\n- **File:** ${f.file}${f.line ? `:${f.line}` : ""}\n${f.suggestedFix ? `- **Fix:** ${f.suggestedFix}\n` : ""}${f.suggestedRole ? `- **Assigned:** ${f.suggestedRole}\n` : ""}${f.verificationCommand ? `- **Verify:** \`${f.verificationCommand}\`\n` : ""}`,
      )
      .join("\n\n")
    const content = matter.stringify(`\n## Findings\n\n${findingsMarkdown}\n`, frontmatterData)
    await fs.writeFile(path.join(phaseDir, filename), content)
  }

  async readReview(phaseSlug: string): Promise<ReviewVerdict> {
    const phaseDir = path.join(this.planningDir, "phases", phaseSlug)
    const files = await fs.readdir(phaseDir)
    const reviewFile = files.find((f) => f.endsWith("-REVIEW.md"))
    if (!reviewFile) throw new Error(`No review file found for phase ${phaseSlug}`)
    const content = await fs.readFile(path.join(phaseDir, reviewFile), "utf-8")
    const { data } = matter(content)
    // findings are in the markdown body, but the verdict metadata is in frontmatter
    return ReviewVerdict.parse(data)
  }

  async toPromptSection(): Promise<string | undefined> {
    if (!(await this.hasWorkflow())) return undefined
    const state = await this.readState()
    return [
      `<workflow_context>`,
      `Project: ${state.project}`,
      `Phase: ${state.currentPhase || "(none)"}`,
      `Stage: ${state.currentStage}`,
      state.activeWave !== undefined ? `Wave: ${state.activeWave}/${state.totalWaves ?? "?"}` : null,
      state.activeTasks.length > 0
        ? `Active Tasks:\n${state.activeTasks.map((t) => `  - ${t.id} (${t.role}): ${t.status}`).join("\n")}`
        : null,
      `</workflow_context>`,
    ]
      .filter(Boolean)
      .join("\n")
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/state.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/state.ts packages/opencode/src/devilcode/workflow/types.ts packages/opencode/test/kilocode/workflow/state.test.ts
git commit -m "feat(cli): add workflow state manager with .planning/ directory I/O"
```

---

## Task 9: Wave Executor

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/executor.ts`
- Test: `packages/opencode/test/kilocode/workflow/executor.test.ts`

- [ ] **Step 1: Write wave executor tests**

```typescript
// packages/opencode/test/kilocode/workflow/executor.test.ts
import { describe, expect, test } from "bun:test"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "@/devilcode/workflow/executor"
import type { PlanTask } from "@/devilcode/workflow/types"

const tasks: PlanTask[] = [
  { id: "01-01", title: "A", role: "senior", wave: 1, dependsOn: [], estimatedComplexity: "high", files: ["src/a.ts"], verification: [], description: "Task A" },
  { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "low", files: ["src/b.ts"], verification: [], description: "Task B" },
  { id: "01-03", title: "C", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "low", files: ["src/c.ts"], verification: [], description: "Task C" },
  { id: "01-04", title: "D", role: "senior", wave: 2, dependsOn: ["01-01"], estimatedComplexity: "high", files: ["src/d.ts", "src/a.ts"], verification: [], description: "Task D" },
  { id: "01-05", title: "E", role: "worker", wave: 2, dependsOn: ["01-02"], estimatedComplexity: "low", files: ["src/e.ts"], verification: [], description: "Task E" },
]

describe("groupByWave", () => {
  test("groups tasks into ordered waves", () => {
    const waves = groupByWave(tasks)
    expect(waves.size).toBe(2)
    expect(waves.get(1)!.length).toBe(3)
    expect(waves.get(2)!.length).toBe(2)
  })

  test("wave 1 tasks have no dependencies", () => {
    const waves = groupByWave(tasks)
    for (const task of waves.get(1)!) {
      expect(task.dependsOn.length).toBe(0)
    }
  })

  test("returns empty map for empty task list", () => {
    const waves = groupByWave([])
    expect(waves.size).toBe(0)
  })
})

describe("validateWaveIntegrity", () => {
  test("passes for valid wave structure", () => {
    const errors = validateWaveIntegrity(tasks)
    expect(errors).toEqual([])
  })

  test("detects dependency on later wave", () => {
    const badTasks: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: ["01-02"], estimatedComplexity: "medium", files: [], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 2, dependsOn: [], estimatedComplexity: "medium", files: [], verification: [], description: "B" },
    ]
    const errors = validateWaveIntegrity(badTasks)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("01-01")
  })

  test("detects dependency within same wave", () => {
    const badTasks: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: ["01-02"], estimatedComplexity: "medium", files: [], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: [], verification: [], description: "B" },
    ]
    const errors = validateWaveIntegrity(badTasks)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe("detectFileConflicts", () => {
  test("no conflicts when files are disjoint within waves", () => {
    const conflicts = detectFileConflicts(tasks)
    expect(conflicts).toEqual([])
  })

  test("detects file conflict within a wave", () => {
    const conflicting: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "B" },
    ]
    const conflicts = detectFileConflicts(conflicting)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]).toContain("src/shared.ts")
  })

  test("allows same file across different waves", () => {
    const valid: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 2, dependsOn: ["01-01"], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "B" },
    ]
    const conflicts = detectFileConflicts(valid)
    expect(conflicts).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the wave executor utilities**

```typescript
// packages/opencode/src/devilcode/workflow/executor.ts
import type { PlanTask } from "./types"

/**
 * Groups tasks by wave number. Returns a Map with wave numbers as keys
 * and arrays of tasks as values, in wave order.
 */
export function groupByWave(tasks: PlanTask[]): Map<number, PlanTask[]> {
  const waves = new Map<number, PlanTask[]>()
  for (const task of tasks) {
    const existing = waves.get(task.wave) ?? []
    existing.push(task)
    waves.set(task.wave, existing)
  }
  return new Map([...waves.entries()].sort(([a], [b]) => a - b))
}

/**
 * Validates that wave dependencies are consistent:
 * - Tasks in wave N should only depend on tasks in waves < N
 * - No circular dependencies within a wave
 */
export function validateWaveIntegrity(tasks: PlanTask[]): string[] {
  const errors: string[] = []
  const taskWaveMap = new Map<string, number>()

  for (const task of tasks) {
    taskWaveMap.set(task.id, task.wave)
  }

  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      const depWave = taskWaveMap.get(depId)
      if (depWave === undefined) {
        errors.push(`Task ${task.id} depends on unknown task ${depId}`)
        continue
      }
      if (depWave >= task.wave) {
        errors.push(
          `Task ${task.id} (wave ${task.wave}) depends on task ${depId} (wave ${depWave}) — dependency must be in an earlier wave`,
        )
      }
    }
  }

  return errors
}

/**
 * Detects file conflicts within the same wave.
 * Two tasks in the same wave should not modify the same file.
 */
export function detectFileConflicts(tasks: PlanTask[]): string[] {
  const conflicts: string[] = []
  const waves = groupByWave(tasks)

  for (const [waveNum, waveTasks] of waves) {
    const fileOwners = new Map<string, string[]>()
    for (const task of waveTasks) {
      for (const file of task.files) {
        const owners = fileOwners.get(file) ?? []
        owners.push(task.id)
        fileOwners.set(file, owners)
      }
    }
    for (const [file, owners] of fileOwners) {
      if (owners.length > 1) {
        conflicts.push(`Wave ${waveNum}: file "${file}" modified by tasks ${owners.join(", ")}`)
      }
    }
  }

  return conflicts
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/executor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/executor.ts packages/opencode/test/kilocode/workflow/executor.test.ts
git commit -m "feat(cli): add wave executor with grouping, integrity validation, and conflict detection"
```

---

## Task 10: Review Loop Fix Router

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/reviewer.ts`
- Test: `packages/opencode/test/kilocode/workflow/reviewer.test.ts`

- [ ] **Step 1: Write reviewer tests**

```typescript
// packages/opencode/test/kilocode/workflow/reviewer.test.ts
import { describe, expect, test } from "bun:test"
import { routeFix, triageFindings } from "@/devilcode/workflow/reviewer"
import type { ReviewFinding } from "@/devilcode/workflow/types"
import type { TeamConfig } from "@/devilcode/team/config"

const teamConfig: TeamConfig = {
  enabled: true,
  roles: {
    orchestrator: { displayName: "O", provider: "a", model: "m", effort: "max", tier: 1, canDelegate: ["senior", "worker"], maxConcurrent: 1, capabilities: [] },
    senior: { displayName: "S", provider: "b", model: "n", effort: "xhigh", tier: 2, canDelegate: ["worker"], maxConcurrent: 2, capabilities: [] },
    worker: { displayName: "W", provider: "c", model: "o", effort: "default", tier: 3, canDelegate: [], maxConcurrent: 5, capabilities: [] },
  },
  routing: { strategy: "hierarchical", defaultRole: "worker", escalationEnabled: true },
}

describe("routeFix", () => {
  test("routes security findings to senior", () => {
    const finding: ReviewFinding = {
      id: "R-01", severity: "blocker", category: "security",
      file: "src/auth.ts", description: "Hardcoded secret",
    }
    expect(routeFix(finding, teamConfig)).toBe("senior")
  })

  test("routes architecture findings to senior", () => {
    const finding: ReviewFinding = {
      id: "R-02", severity: "warning", category: "architecture",
      file: "src/api.ts", description: "Circular dependency",
    }
    expect(routeFix(finding, teamConfig)).toBe("senior")
  })

  test("routes correctness blockers to senior", () => {
    const finding: ReviewFinding = {
      id: "R-03", severity: "blocker", category: "correctness",
      file: "src/logic.ts", description: "Off-by-one error",
    }
    expect(routeFix(finding, teamConfig)).toBe("senior")
  })

  test("routes style issues to worker", () => {
    const finding: ReviewFinding = {
      id: "R-04", severity: "suggestion", category: "style",
      file: "src/utils.ts", description: "Inconsistent naming",
    }
    expect(routeFix(finding, teamConfig)).toBe("worker")
  })

  test("routes type-safety issues to worker", () => {
    const finding: ReviewFinding = {
      id: "R-05", severity: "warning", category: "type-safety",
      file: "src/types.ts", description: "Missing type annotation",
    }
    expect(routeFix(finding, teamConfig)).toBe("worker")
  })

  test("honors suggestedRole when valid", () => {
    const finding: ReviewFinding = {
      id: "R-06", severity: "blocker", category: "performance",
      file: "src/db.ts", description: "N+1 query",
      suggestedRole: "senior",
    }
    expect(routeFix(finding, teamConfig)).toBe("senior")
  })

  test("ignores invalid suggestedRole", () => {
    const finding: ReviewFinding = {
      id: "R-07", severity: "suggestion", category: "style",
      file: "src/x.ts", description: "x",
      suggestedRole: "nonexistent",
    }
    expect(routeFix(finding, teamConfig)).toBe("worker")
  })
})

describe("triageFindings", () => {
  test("separates blockers from non-blockers", () => {
    const findings: ReviewFinding[] = [
      { id: "R-01", severity: "blocker", category: "security", file: "a.ts", description: "bad" },
      { id: "R-02", severity: "warning", category: "style", file: "b.ts", description: "meh" },
      { id: "R-03", severity: "suggestion", category: "performance", file: "c.ts", description: "nice" },
      { id: "R-04", severity: "blocker", category: "correctness", file: "d.ts", description: "broken" },
    ]
    const { blockers, warnings, suggestions } = triageFindings(findings)
    expect(blockers.length).toBe(2)
    expect(warnings.length).toBe(1)
    expect(suggestions.length).toBe(1)
  })

  test("returns empty arrays for no findings", () => {
    const { blockers, warnings, suggestions } = triageFindings([])
    expect(blockers.length).toBe(0)
    expect(warnings.length).toBe(0)
    expect(suggestions.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/kilocode/workflow/reviewer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the reviewer**

```typescript
// packages/opencode/src/devilcode/workflow/reviewer.ts
import type { ReviewFinding } from "./types"
import type { TeamConfig } from "../team/config"

const SENIOR_CATEGORIES = new Set(["security", "architecture"])

/**
 * Determines which team role should fix a given review finding.
 */
export function routeFix(finding: ReviewFinding, teamConfig: TeamConfig): string {
  // Security and architecture always go to senior
  if (SENIOR_CATEGORIES.has(finding.category)) {
    return "senior"
  }

  // If the finding suggests a valid role, honor it
  if (finding.suggestedRole && teamConfig.roles[finding.suggestedRole]) {
    return finding.suggestedRole
  }

  // Complex correctness bugs go to senior
  if (finding.category === "correctness" && finding.severity === "blocker") {
    return "senior"
  }

  // Everything else goes to worker (or the configured default role)
  return teamConfig.routing.defaultRole
}

/**
 * Separates findings by severity into blockers, warnings, and suggestions.
 */
export function triageFindings(findings: ReviewFinding[]): {
  blockers: ReviewFinding[]
  warnings: ReviewFinding[]
  suggestions: ReviewFinding[]
} {
  const blockers: ReviewFinding[] = []
  const warnings: ReviewFinding[] = []
  const suggestions: ReviewFinding[] = []

  for (const finding of findings) {
    switch (finding.severity) {
      case "blocker":
        blockers.push(finding)
        break
      case "warning":
        warnings.push(finding)
        break
      case "suggestion":
        suggestions.push(finding)
        break
    }
  }

  return { blockers, warnings, suggestions }
}

/**
 * Maximum number of fix-review cycles before escalating to user.
 */
export const MAX_REVIEW_CYCLES = 3
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/opencode && bun test test/kilocode/workflow/reviewer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/reviewer.ts packages/opencode/test/kilocode/workflow/reviewer.test.ts
git commit -m "feat(cli): add review fix router and finding triage for workflow review loop"
```

---

## Task 11: Workflow Namespace & Stage State Machine

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/index.ts`

- [ ] **Step 1: Implement the workflow namespace with stage transitions**

```typescript
// packages/opencode/src/devilcode/workflow/index.ts
import { WorkflowStateManager } from "./state"
import type { WorkflowStage, WorkflowState } from "./types"

/**
 * Valid stage transitions. Each stage can only advance to specific next stages.
 */
const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  plan: ["challenge"],
  challenge: ["plan", "build"],        // can go back to plan on reject
  build: ["review"],
  review: ["build", "ship"],           // can go back to build for fixes
  ship: ["retro"],
  retro: ["plan"],                     // next phase starts with plan
}

export namespace Workflow {
  export function canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
    return STAGE_TRANSITIONS[from]?.includes(to) ?? false
  }

  export function nextStage(current: WorkflowStage): WorkflowStage {
    const transitions = STAGE_TRANSITIONS[current]
    if (!transitions || transitions.length === 0) {
      throw new Error(`No transitions available from stage "${current}"`)
    }
    // Return the "forward" transition (first in list)
    return transitions[0]
  }

  export async function advanceStage(
    manager: WorkflowStateManager,
    targetStage: WorkflowStage,
  ): Promise<WorkflowState> {
    const state = await manager.readState()

    if (!canTransition(state.currentStage, targetStage)) {
      throw new Error(
        `Cannot transition from "${state.currentStage}" to "${targetStage}". Valid transitions: ${STAGE_TRANSITIONS[state.currentStage]?.join(", ")}`,
      )
    }

    const newState: WorkflowState = {
      ...state,
      currentStage: targetStage,
      activeTasks: [],
      lastUpdated: new Date().toISOString(),
    }
    await manager.writeState(newState)
    return newState
  }

  export function createManager(basePath: string): WorkflowStateManager {
    return new WorkflowStateManager(basePath)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/index.ts
git commit -m "feat(cli): add workflow namespace with stage state machine and transitions"
```

---

## Task 12: System Prompts for Workflow Stages

**Files:**
- Create: `packages/opencode/src/devilcode/workflow/prompts/plan.txt`
- Create: `packages/opencode/src/devilcode/workflow/prompts/challenge.txt`
- Create: `packages/opencode/src/devilcode/workflow/prompts/build.txt`
- Create: `packages/opencode/src/devilcode/workflow/prompts/review.txt`
- Create: `packages/opencode/src/devilcode/workflow/prompts/ship.txt`

- [ ] **Step 1: Create the plan stage prompt**

```text
# packages/opencode/src/devilcode/workflow/prompts/plan.txt

You are the Orchestrator in the PLAN stage of a multi-model workflow.

Your job is to decompose the current phase requirements into concrete, executable tasks.

## Process

1. Read the phase CONTEXT.md for requirements, relevant code, and constraints.
2. Break the work into tasks. Each task should:
   - Be completable by a single agent in one session
   - Have clear inputs, outputs, and verification criteria
   - Specify which team role should handle it (orchestrator/senior/worker)
   - List files it will modify (for conflict detection)

3. Assign tasks to waves for parallel execution:
   - Wave 1: All independent tasks with no dependencies
   - Wave 2+: Tasks that depend on earlier wave results
   - CRITICAL: Two tasks in the same wave MUST NOT modify the same files
   - CRITICAL: Dependencies must point to tasks in earlier waves only

4. For each task, write a PLAN.md file with YAML frontmatter containing:
   - id, title, role, wave, dependsOn, estimatedComplexity, files, verification

## Role Assignment Guidelines

- **senior**: Security-sensitive code, complex architecture, debugging, code review
- **worker**: Bounded implementation tasks, test writing, file operations, simple CRUD
- When in doubt, assign to senior. It's better to over-qualify than to have a worker struggle.

## Output

Write PLAN.md files for each task using the workflow state tools, then advance to the challenge stage.
```

- [ ] **Step 2: Create the challenge stage prompt**

```text
# packages/opencode/src/devilcode/workflow/prompts/challenge.txt

You are the Senior Engineer reviewing an execution plan. Your role is ADVERSARIAL — find problems before they waste execution time.

## What to Check

1. **Wave ordering & file conflicts**: Do any tasks in the same wave modify the same files? Are dependencies correctly ordered?
2. **Role assignments**: Are complex tasks assigned to workers when they should be senior? Are trivial tasks wasting senior capacity?
3. **Missing edge cases**: Does the plan account for error handling, validation, and boundary conditions?
4. **Security implications**: Does the plan introduce any security risks? Are secrets handled properly?
5. **Simpler alternatives**: Is the plan overengineered? Could fewer tasks achieve the same result?
6. **Verification completeness**: Does every task have a concrete verification command? Can the verification actually prove the task succeeded?
7. **Incorrect assumptions**: Does the plan assume APIs, interfaces, or file structures that don't exist in the current codebase?

## Your Job

You are NOT rubber-stamping. If the plan is solid, say so and explain WHY it's solid. If it has problems, be specific:
- Which tasks are affected
- What the problem is
- How to fix it

## Output

Return a PlanChallenge with:
- verdict: "approved" (proceed to build), "revise" (fix specific issues), or "reject" (fundamental rethink needed)
- concerns: array of specific issues found
- alternativeApproach: if you see a fundamentally better path, describe it
- summary: one-paragraph assessment
```

- [ ] **Step 3: Create the build stage prompt**

```text
# packages/opencode/src/devilcode/workflow/prompts/build.txt

You are executing a task as part of a multi-model workflow team.

## Context

You have been assigned a specific task from a larger execution plan. Focus ONLY on your assigned task. Do not attempt work outside your task scope.

## Rules

1. Read your task's PLAN.md for exact requirements, files to modify, and verification commands.
2. Implement the task completely — partial work is not acceptable.
3. Run ALL verification commands listed in the plan before reporting completion.
4. If you encounter a problem you cannot solve:
   - If it's outside your expertise, return status: "escalated" with the reason
   - If you're blocked by a missing dependency, return status: "blocked"
   - If you fail after reasonable attempts, return status: "failed" with what you tried
5. Report all files you modified in your result.

## Output

Return a TaskResult with status, output, and filesModified.
```

- [ ] **Step 4: Create the review stage prompt**

```text
# packages/opencode/src/devilcode/workflow/prompts/review.txt

You are reviewing code changes produced by the build stage of a multi-model workflow.

## Process

1. Read all SUMMARY.md files from the build stage to understand what was done.
2. Examine the actual code changes (git diff or file contents).
3. Run the test suite and typecheck to catch regressions.
4. Produce findings with severity and category for each issue found.

## Severity Levels

- **BLOCKER**: Must fix before shipping. Security vulnerabilities, correctness bugs, failing tests, type errors.
- **WARNING**: Should fix but won't block shipping. Missing tests, performance concerns, code smell.
- **SUGGESTION**: Nice to have. Style improvements, documentation, refactoring ideas.

## Categories

security, correctness, performance, type-safety, test-coverage, style, architecture, compatibility

## Output

For each issue, produce a ReviewFinding with:
- id (R-01, R-02, ...), severity, category, file, line (if applicable)
- description: what's wrong
- suggestedFix: how to fix it
- suggestedRole: who should fix it (senior or worker)
- verificationCommand: how to verify the fix

Be thorough but fair. Don't flag style issues as blockers. Don't ignore real bugs as suggestions.
```

- [ ] **Step 5: Create the ship stage prompt**

```text
# packages/opencode/src/devilcode/workflow/prompts/ship.txt

You are the Orchestrator in the SHIP stage. All build and review work is complete.

## Process

1. Review all SUMMARY.md and REVIEW.md files to confirm everything is resolved.
2. Verify no BLOCKER findings remain unresolved.
3. Run final verification: test suite, typecheck, and any project-specific checks.
4. Create atomic git commit(s) for the phase's changes using conventional commit format.
5. Update ROADMAP.md to mark the current phase as complete.
6. Update STATE.md to advance to the retro stage.

## Commit Guidelines

- Use conventional commits: feat:, fix:, refactor:, test:, docs:
- Include the phase name in the scope: feat(auth): ...
- One commit per logical unit of change — don't squash unrelated changes.

## Output

Report what was committed, any remaining warnings (non-blocking), and advance to retro stage.
```

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/devilcode/workflow/prompts/
git commit -m "feat(cli): add system prompts for all workflow stages"
```

---

## Task 13: Agent Registration & Prompt Injection (Shared File Changes)

**Files:**
- Create: `packages/opencode/src/devilcode/team/agents.ts`
- Modify: `packages/opencode/src/agent/agent.ts` (around line 488)
- Modify: `packages/opencode/src/session/prompt.ts`

- [ ] **Step 1: Create the team agents registration module**

```typescript
// packages/opencode/src/devilcode/team/agents.ts
import type { TeamConfig } from "./config"
import type { Agent } from "../../agent/agent"
import { PermissionNext } from "@/permission/next"

/**
 * Creates workflow-specific agent definitions based on team config.
 * These agents are registered alongside the default agents when team is enabled.
 * Returns a record of agent name -> Agent.Info to merge into the agent state.
 */
export function createWorkflowAgents(
  teamConfig: TeamConfig | undefined,
  defaults: PermissionNext.Ruleset,
): Record<string, Agent.Info> | undefined {
  if (!teamConfig?.enabled) return undefined

  const agents: Record<string, Agent.Info> = {}

  // Register each team role as a subagent
  for (const [roleName, role] of Object.entries(teamConfig.roles)) {
    // Skip if it would conflict with a built-in agent name
    const builtins = new Set(["code", "plan", "debug", "orchestrator", "ask", "general", "explore", "title", "summary", "compaction"])
    if (builtins.has(roleName)) continue

    agents[roleName] = {
      name: roleName,
      displayName: role.displayName,
      description: `Team role: ${role.displayName} (${role.provider}/${role.model})`,
      mode: role.tier === 1 ? "primary" : "subagent",
      native: false,
      permission: defaults,
      model: {
        providerID: role.provider,
        modelID: role.model,
      },
      options: {
        teamRole: roleName,
        teamTier: role.tier,
      },
    }
  }

  return Object.keys(agents).length > 0 ? agents : undefined
}
```

- [ ] **Step 2: Add team agent registration to agent.ts**

In `packages/opencode/src/agent/agent.ts`, after the state initialization builds the `result` object (around line 486, before `return result`):

```typescript
// devilcode_change start — register team workflow agents
import { createWorkflowAgents } from "@/devilcode/team/agents"

// Inside the state() init function, before `return result` (around line 486):
    const workflowAgents = createWorkflowAgents(cfg.team, defaults)
    if (workflowAgents) {
      Object.assign(result, workflowAgents)
    }
// devilcode_change end
```

Note: The import goes at the top of the file with the other imports. The `Object.assign` call goes inside the `state()` initializer, just before `return result`.

- [ ] **Step 3: Add workflow context injection to prompt.ts**

In `packages/opencode/src/session/prompt.ts`, add workflow context to the system prompt assembly. Find where the system prompt is built (look for where agent.prompt or SystemPrompt is used). Add:

```typescript
// devilcode_change start — inject workflow context
import { Workflow } from "@/devilcode/workflow"
import { Instance } from "@/project/instance"

// Inside the prompt assembly, after system prompt is built:
    const workflowManager = Workflow.createManager(Instance.directory)
    const workflowSection = await workflowManager.toPromptSection()
    if (workflowSection) {
      system.push(workflowSection)
    }
// devilcode_change end
```

The exact insertion point depends on the system prompt assembly pattern. Look for an array called `system` or a string being built up. Insert the workflow section after the agent-specific prompt but before the final assembly.

- [ ] **Step 4: Verify typecheck passes**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: No new type errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/team/agents.ts packages/opencode/src/agent/agent.ts packages/opencode/src/session/prompt.ts
git commit -m "feat(cli): register team agents and inject workflow context into system prompts"
```

---

## Task 14: Barrel Exports & Module Wiring

**Files:**
- Create: `packages/opencode/src/devilcode/team/index.ts`

- [ ] **Step 1: Create team barrel export**

```typescript
// packages/opencode/src/devilcode/team/index.ts
export { TeamConfig, TeamRole, TeamRouting, EffortLevel } from "./config"
export { resolveTaskModel, TeamDelegationError, TeamConcurrencyError } from "./router"
export type { ResolvedTaskModel } from "./router"
export { ConcurrencyManager, getConcurrencyManager } from "./concurrency"
export { effortToProviderOptions } from "./effort"
export { createWorkflowAgents } from "./agents"
export { TaskResult, Escalation, TaskResultStatus } from "./types"
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/team/index.ts
git commit -m "feat(cli): add barrel exports for team module"
```

---

## Task 15: End-to-End Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all team tests**

Run: `cd packages/opencode && bun test test/kilocode/team/`
Expected: All tests PASS

- [ ] **Step 2: Run all workflow tests**

Run: `cd packages/opencode && bun test test/kilocode/workflow/`
Expected: All tests PASS

- [ ] **Step 3: Run full typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: No errors

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd packages/opencode && bun test`
Expected: No new failures compared to baseline

- [ ] **Step 5: Verify config loading with team section**

Create a temporary test config and verify it parses:

Run: `cd packages/opencode && bun -e "
const { TeamConfig } = require('./src/devilcode/team/config');
const result = TeamConfig.parse({
  enabled: true,
  roles: {
    orchestrator: { displayName: 'O', provider: 'anthropic', model: 'claude-opus-4-6', effort: 'max', tier: 1, canDelegate: ['senior', 'worker'], maxConcurrent: 1 },
    senior: { displayName: 'S', provider: 'openai', model: 'gpt-5.4-codex', effort: 'xhigh', tier: 2, canDelegate: ['worker'], maxConcurrent: 2 },
    worker: { displayName: 'W', provider: 'fireworks-ai', model: 'kimi-k2p5-turbo', tier: 3 },
  },
  routing: { defaultRole: 'worker' },
});
console.log('Parsed', Object.keys(result.roles).length, 'roles');
console.log('Orchestrator effort:', result.roles.orchestrator.effort);
console.log('Worker maxConcurrent:', result.roles.worker.maxConcurrent);
"
`
Expected: Prints "Parsed 3 roles", "Orchestrator effort: max", "Worker maxConcurrent: 3"

- [ ] **Step 6: Final commit — verify clean state**

Run: `git status` to confirm no uncommitted changes remain. If clean, the implementation is complete.
