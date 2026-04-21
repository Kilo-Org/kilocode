import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { PlanTask } from "@/devilcode/workflow/types"

const mockSessionCreate = mock(() => Promise.resolve({ id: "session-001", slug: "test-session" }))
const mockSessionPrompt = mock(() =>
  Promise.resolve({ info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] }),
)
const mockWorktreeCreate = mock(() =>
  Promise.resolve({ name: "brave-cabin", branch: "opencode/brave-cabin", directory: "/tmp/worktree-1" }),
)
const mockWorktreeRemove = mock(() => Promise.resolve())
const mockInstanceProvide = mock(({ fn }: { directory?: string; fn: () => Promise<unknown> | unknown }) =>
  Promise.resolve(fn()),
)
const mockInstanceDispose = mock(() => Promise.resolve())

mock.module("@/session", () => ({
  Session: {
    create: mockSessionCreate,
    Event: { TurnClose: { type: "session.turn.close" } },
  },
}))

mock.module("@/session/prompt", () => ({
  SessionPrompt: { prompt: mockSessionPrompt },
}))

mock.module("@/worktree", () => ({
  Worktree: { create: mockWorktreeCreate, remove: mockWorktreeRemove },
}))

mock.module("@/bus", () => ({
  Bus: { subscribe: mock(() => () => {}), publish: mock(() => Promise.resolve()) },
}))

mock.module("@/project/instance", () => ({
  Instance: { directory: "/repo/main", provide: mockInstanceProvide, dispose: mockInstanceDispose },
}))

mock.module("@/devilcode/workflow/prompts/build.txt", () => ({
  default: "You are executing a task...",
}))

import { ConcurrencyManager } from "@/devilcode/team/concurrency"
import { TeamConcurrencyError } from "@/devilcode/team/router"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
const { BuildRunner } = await import("@/devilcode/workflow/build-runner")

// Helper: cast legacy-shaped test fixtures to CanonicalTeamConfig.
// BuildRunner only accesses roles/routing by property lookup at runtime — it does not
// re-validate the Zod schema — so this is safe for behavioral testing.
function tc(o: unknown): CanonicalTeamConfig {
  return o as unknown as CanonicalTeamConfig
}

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
    escalationDepth: overrides.escalationDepth,
  }
}

describe("BuildRunner concurrency integration", () => {
  beforeEach(() => {
    mockSessionCreate.mockReset()
    mockSessionPrompt.mockReset()
    mockSessionCreate.mockImplementation(() => Promise.resolve({ id: "session-001", slug: "test-session" }))
    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({ info: { role: "assistant", finish: "end-turn" }, parts: [{ type: "text", text: "Done" }] }),
    )
  })

  it("throws TeamConcurrencyError when role at capacity", async () => {
    const manager = new ConcurrencyManager()
    manager.acquire("worker", "existing-task")
    manager.acquire("worker", "another-task")

    expect(() => {
      if (!manager.hasCapacity("worker", 2)) {
        throw new TeamConcurrencyError({ role: "worker", maxConcurrent: 2 })
      }
    }).toThrow(TeamConcurrencyError)
  })

  it("releases slot even when task fails", async () => {
    const manager = new ConcurrencyManager()
    manager.acquire("worker", "failing-task")
    expect(manager.getActiveCount("worker")).toBe(1)

    try {
      throw new Error("Task failed")
    } catch {
      // Expected error — simulating a task failure
    } finally {
      manager.release("worker", "failing-task")
    }

    expect(manager.getActiveCount("worker")).toBe(0)
  })

  // devilcode_change start - audit MA5: wave-level pre-acquire prevents oversubscription.
  it("rejects wave that would exceed role maxConcurrent", async () => {
    const { getConcurrencyManager } = await import("@/devilcode/team/concurrency")
    getConcurrencyManager().reset()
    const teamConfig = tc({
      enabled: true,
      roles: {
        worker: {
          displayName: "Worker",
          provider: "openai",
          model: "gpt-5.4-mini",
          effort: "default" as const,
          tier: 1,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: [],
        },
      },
      routing: { strategy: "flat" as const, defaultRole: "worker", escalationEnabled: true },
    })
    const runner = new BuildRunner({
      teamConfig,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    const tasks = [
      makeTask({ id: "t1", role: "worker", wave: 1 }),
      makeTask({ id: "t2", role: "worker", wave: 1 }),
      makeTask({ id: "t3", role: "worker", wave: 1 }),
    ]
    await expect(runner.executeWave(tasks)).rejects.toThrow(TeamConcurrencyError)
    // No SessionPrompt issued — fail-fast before any task starts.
    expect(mockSessionPrompt).toHaveBeenCalledTimes(0)
    // Slots should be cleanly released after rejection.
    expect(getConcurrencyManager().getActiveCount("worker")).toBe(0)
  })

  it("releases pre-acquired slots after wave completes", async () => {
    const { getConcurrencyManager } = await import("@/devilcode/team/concurrency")
    getConcurrencyManager().reset()
    const teamConfig = tc({
      enabled: true,
      roles: {
        worker: {
          displayName: "Worker",
          provider: "openai",
          model: "gpt-5.4-mini",
          effort: "default" as const,
          tier: 1,
          canDelegate: [],
          maxConcurrent: 5,
          capabilities: [],
        },
      },
      routing: { strategy: "flat" as const, defaultRole: "worker", escalationEnabled: true },
    })
    const runner = new BuildRunner({
      teamConfig,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    await runner.executeWave([
      makeTask({ id: "t1", role: "worker", wave: 1 }),
      makeTask({ id: "t2", role: "worker", wave: 1 }),
    ])

    expect(getConcurrencyManager().getActiveCount("worker")).toBe(0)
  })

  it("releases the source slot before escalating to another role", async () => {
    const { getConcurrencyManager } = await import("@/devilcode/team/concurrency")
    getConcurrencyManager().reset()
    const seen: number[] = []
    const runner = new BuildRunner({
      teamConfig: tc({
        enabled: true,
        roles: {
          senior: {
            displayName: "Senior",
            provider: "openai",
            model: "gpt-5.4",
            effort: "high" as const,
            tier: 2,
            canDelegate: ["worker"],
            maxConcurrent: 1,
            capabilities: [],
          },
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-5.4-mini",
            effort: "default" as const,
            tier: 1,
            canDelegate: [],
            maxConcurrent: 1,
            capabilities: [],
          },
        },
        routing: {
          strategy: "hierarchical" as const,
          defaultRole: "worker",
          escalationEnabled: true,
          parentRole: "senior",
        },
      }),
      onTaskStart: () => {},
      onTaskComplete: (_taskId, result) => {
        if (result.status === "escalated") {
          seen.push(getConcurrencyManager().getActiveCount("worker"))
        }
      },
      onOutput: () => {},
    })

    let call = 0
    mockSessionPrompt.mockImplementation(() => {
      call++
      return Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [{ type: "text", text: call === 1 ? "Escalating to senior: blocked." : "Done" }],
      })
    })

    await runner.executeWave([makeTask({ id: "t1", role: "worker", wave: 1 })])

    expect(seen).toEqual([0])
    expect(getConcurrencyManager().getActiveCount("worker")).toBe(0)
    expect(getConcurrencyManager().getActiveCount("senior")).toBe(0)
  })
  // devilcode_change end

  it("handles disabled team config without concurrency checks", async () => {
    const runner = new BuildRunner({
      teamConfig: undefined,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    const tasks = [makeTask({ id: "t1", wave: 1 })]
    await runner.executeWave(tasks)

    expect(mockSessionPrompt).toHaveBeenCalled()
  })
})
