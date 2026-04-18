import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { PlanTask, ActiveTask, TaskResult } from "@/devilcode/workflow/types"
import type { WorkflowState } from "@/devilcode/workflow/types"
import type { TeamConfig } from "@/devilcode/team/config"

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
const mockInstanceProvide = mock(
  ({ fn }: { directory?: string; fn: () => Promise<unknown> | unknown }) => Promise.resolve(fn()),
)
const mockInstanceDispose = mock(() => Promise.resolve())

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

mock.module("@/project/instance", () => ({
  Instance: {
    directory: "/repo/main",
    provide: mockInstanceProvide,
    dispose: mockInstanceDispose,
  },
}))

mock.module("@/devilcode/workflow/prompts/build.txt", () => ({
  default: "You are executing a task...",
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
    mockInstanceProvide.mockReset()
    mockInstanceDispose.mockReset()
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
    mockWorktreeRemove.mockImplementation(() => Promise.resolve())
    mockInstanceProvide.mockImplementation(
      ({ fn }: { directory?: string; fn: () => Promise<unknown> | unknown }) => Promise.resolve(fn()),
    )
    mockInstanceDispose.mockImplementation(() => Promise.resolve())
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

    expect(mockWorktreeCreate).toHaveBeenCalledTimes(2)
    expect(mockInstanceProvide).toHaveBeenCalledTimes(2)
    const call = (mockInstanceProvide.mock.calls as Array<Array<{ directory?: string }>>)[0]
    expect(call?.[0]?.directory).toBe("/tmp/worktree-1")
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

  it("passes the resolved role and model into workflow task sessions", async () => {
    const runner = new BuildRunner({
      teamConfig: {
        enabled: true,
        roles: {
          worker: {
            displayName: "Worker",
            provider: "openai",
            model: "gpt-5.4-mini",
            effort: "high",
            tier: 2,
            canDelegate: [],
            maxConcurrent: 2,
            capabilities: [],
          },
        },
        // devilcode_change - audit MA1: flat strategy avoids the hierarchy check for top-level dispatch.
        routing: {
          strategy: "flat",
          defaultRole: "worker",
          escalationEnabled: true,
        },
      },
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

    await runner.executeWave([makeTask({ id: "t1", role: "worker", wave: 1 })])

    expect(mockSessionPrompt).toHaveBeenCalledTimes(1)
    const call = (mockSessionPrompt.mock.calls as Array<Array<Record<string, unknown>>>)[0]
    expect(call?.[0]).toMatchObject({
      agent: "worker",
      model: {
        providerID: "openai",
        modelID: "gpt-5.4-mini",
      },
    })
  })

  // devilcode_change start - audit MA3: re-dispatch escalated tasks to resolved target role.
  it("re-dispatches escalated tasks to the resolved target role", async () => {
    const completed: Array<{ taskId: string; status: string }> = []
    const teamConfig: TeamConfig = {
      enabled: true,
      roles: {
        senior: {
          displayName: "Senior",
          provider: "openai",
          model: "gpt-5.4",
          effort: "high",
          tier: 2,
          canDelegate: ["worker"],
          maxConcurrent: 1,
          capabilities: [],
        },
        worker: {
          displayName: "Worker",
          provider: "openai",
          model: "gpt-5.4-mini",
          effort: "default",
          tier: 1,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: [],
        },
      },
      routing: {
        strategy: "hierarchical" as const,
        defaultRole: "worker",
        escalationEnabled: true,
        parentRole: "senior",
      },
    }
    const runner = new BuildRunner({
      teamConfig,
      onTaskStart: () => {},
      onTaskComplete: (taskId, result) => completed.push({ taskId, status: result.status }),
      onOutput: () => {},
    })

    let call = 0
    mockSessionPrompt.mockImplementation(() => {
      call++
      const text =
        call === 1
          ? "Escalating to senior: this needs architecture review."
          : "Resolved successfully."
      return Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [{ type: "text", text }],
      })
    })

    const results = await runner.executeWave([makeTask({ id: "t1", role: "worker", wave: 1 })])

    expect(mockSessionPrompt).toHaveBeenCalledTimes(2)
    const promptCalls = mockSessionPrompt.mock.calls as Array<Array<Record<string, unknown>>>
    expect(promptCalls[0]?.[0]?.agent).toBe("worker")
    expect(promptCalls[1]?.[0]?.agent).toBe("senior")
    // Final result for the original task id reflects the escalated re-dispatch outcome.
    expect(results[0]?.status).toBe("completed")
    // Two onTaskComplete calls: original (escalated) + re-dispatched (completed).
    expect(completed.map((c) => c.status)).toEqual(["escalated", "completed"])
  })

  it("stops re-dispatching once MAX_ESCALATION_DEPTH is hit", async () => {
    const teamConfig: TeamConfig = {
      enabled: true,
      roles: {
        senior: {
          displayName: "Senior",
          provider: "openai",
          model: "gpt-5.4",
          effort: "high",
          tier: 2,
          canDelegate: ["worker"],
          maxConcurrent: 1,
          capabilities: [],
        },
        worker: {
          displayName: "Worker",
          provider: "openai",
          model: "gpt-5.4-mini",
          effort: "default",
          tier: 1,
          canDelegate: [],
          maxConcurrent: 2,
          capabilities: [],
        },
      },
      routing: {
        strategy: "hierarchical" as const,
        defaultRole: "worker",
        escalationEnabled: true,
        parentRole: "senior",
      },
    }
    const runner = new BuildRunner({
      teamConfig,
      onTaskStart: () => {},
      onTaskComplete: () => {},
      onOutput: () => {},
    })

    mockSessionPrompt.mockImplementation(() =>
      Promise.resolve({
        info: { role: "assistant", finish: "end-turn" },
        parts: [{ type: "text", text: "Escalating to senior: still stuck." }],
      }),
    )

    const results = await runner.executeWave([makeTask({ id: "t1", role: "worker", wave: 1 })])

    // Worker (depth 0) -> escalate -> senior (depth 1). Senior escalates back to senior;
    // self-target short-circuit returns escalated without further re-dispatch (also bounded
    // by MAX_ESCALATION_DEPTH for non-self chains).
    expect(results[0]?.status).toBe("escalated")
    expect(mockSessionPrompt).toHaveBeenCalledTimes(2)
  })
  // devilcode_change end

  it("stops after the current wave when pause is requested", async () => {
    const paused: number[] = []
    const runner = new BuildRunner({
      teamConfig: undefined,
      onWaveStart: () => {},
      onPause: (wave) => paused.push(wave),
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

    runner.requestPause()
    const results = await runner.executeAll([
      makeTask({ id: "t1", wave: 1 }),
      makeTask({ id: "t2", wave: 2 }),
    ])

    expect(results.map((result) => result.taskId)).toEqual(["t1"])
    expect(paused).toEqual([1])
    expect(runner.isPaused()).toBe(true)
    expect(mockSessionPrompt).toHaveBeenCalledTimes(1)
  })
})
