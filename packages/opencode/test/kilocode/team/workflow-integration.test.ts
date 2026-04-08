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
import { resolveTaskModel, TeamDelegationError } from "@/devilcode/team/router"
import type { TeamConfig } from "@/devilcode/team/config"
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
      maxConcurrent: 3,
      capabilities: [],
    },
  },
  routing: {
    strategy: "hierarchical",
    defaultRole: "worker",
    escalationEnabled: true,
  },
}

describe("Team + Workflow integration", () => {
  beforeEach(() => {
    mockSessionCreate.mockReset()
    mockSessionPrompt.mockReset()
    mockSessionCreate.mockImplementation(() => Promise.resolve({ id: "session-001", slug: "test-session" }))
    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({ info: { role: "assistant", finish: "end-turn" }, parts: [{ type: "text", text: "Done" }] }),
    )
  })

  it("resolves correct model for team roles in workflow", async () => {
    const resolved = resolveTaskModel({
      subagentType: "worker",
      teamConfig,
      parentRole: "orchestrator",
    })

    expect(resolved).toBeDefined()
    expect(resolved?.model.providerID).toBe("fireworks-ai")
    expect(resolved?.model.modelID).toBe("kimi-k2p5-turbo")
    expect(resolved?.role).toBe("worker")
  })

  it("enforces hierarchical delegation in workflow context", () => {
    expect(() =>
      resolveTaskModel({
        subagentType: "senior",
        teamConfig,
        parentRole: "worker",
      }),
    ).toThrow(TeamDelegationError)
  })

  it("allows orchestrator to delegate to any role", () => {
    const worker = resolveTaskModel({ subagentType: "worker", teamConfig, parentRole: "orchestrator" })
    const senior = resolveTaskModel({ subagentType: "senior", teamConfig, parentRole: "orchestrator" })

    expect(worker?.role).toBe("worker")
    expect(senior?.role).toBe("senior")
  })

  it("tracks concurrency across multiple waves", async () => {
    const manager = new ConcurrencyManager()

    manager.acquire("worker", "w1-t1")
    manager.acquire("worker", "w1-t2")
    expect(manager.getActiveCount("worker")).toBe(2)

    manager.release("worker", "w1-t1")
    manager.release("worker", "w1-t2")
    expect(manager.getActiveCount("worker")).toBe(0)
  })

  it("maintains separate concurrency for different roles", async () => {
    const manager = new ConcurrencyManager()

    manager.acquire("senior", "task-s1")
    manager.acquire("senior", "task-s2")
    manager.acquire("worker", "task-w1")

    expect(manager.getActiveCount("senior")).toBe(2)
    expect(manager.getActiveCount("worker")).toBe(1)

    expect(manager.hasCapacity("senior", 2)).toBe(false)
    expect(manager.hasCapacity("worker", 3)).toBe(true)
  })
})
